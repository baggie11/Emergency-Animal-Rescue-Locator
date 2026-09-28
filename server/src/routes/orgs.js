import { Router } from 'express';
import {
  parseBool,
  parseInt,
  parseLatLng,
  parseText,
  parseEnum,
  badRequest,
  notFound,
  tooManyRequests,
  asyncRoute,
  CATEGORY_IDS,
  SERVICE_IDS,
  ANIMAL_TYPE_IDS,
} from '../lib/http.js';
import { findNearby, getById, listAll, createOrg, updateOrg, deleteOrg, countOrgs } from '../models/organizations.js';
import { getDb } from '../db/index.js';
import { requireAdmin } from '../lib/auth.js';
import { config } from '../config.js';
import { fetchLiveVets, dedupeAgainstCurated, filterLiveVets } from '../lib/liveVetLookup.js';
import { addFlag, incrementConfirmation, FLAG_REASONS } from '../models/orgFlags.js';
import { parseOrgInput } from './orgInput.js';

const router = Router();

const csv = (v) =>
  typeof v === 'string' && v.trim() !== ''
    ? v.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(v)
      ? v
      : [];

/** GET /api/orgs/nearby?lat=&lng= — the core, login-free endpoint. */
router.get(
  '/nearby',
  asyncRoute(async (req, res) => {
    const { lat, lng } = parseLatLng(req.query.lat, req.query.lng);

    const radiusKm = req.query.radiusKm ? Number.parseFloat(req.query.radiusKm) : null;
    if (radiusKm !== null && (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 20000)) {
      throw badRequest('radiusKm must be a positive number up to 20000');
    }

    const categories = csv(req.query.categories).filter((c) => CATEGORY_IDS.includes(c));
    const services = csv(req.query.services).filter((s) => SERVICE_IDS.includes(s));
    const animals = csv(req.query.animals).filter((a) => ANIMAL_TYPE_IDS.includes(a));
    const is24x7 = parseBool(req.query.is24x7);
    const verifiedOnly = parseBool(req.query.verifiedOnly);
    const q =
      typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 80) : null;

    // Curated (SQLite) and live (Overpass) results are gathered in parallel:
    // the live call can take up to 3s and should not serialise behind the query.
    const [curated, liveAll] = await Promise.all([
      findNearby({
        lat,
        lng,
        categories,
        services,
        animals,
        is24x7,
        verifiedOnly,
        q,
        limit: parseInt(req.query.limit, 50),
        radiusKm,
      }),
      maybeLiveVets({ lat, lng, categories, verifiedOnly, radiusKm }),
    ]);

    // The SQL filters above do not reach the merged-in live rows, so the same
    // filters are applied here in JS.
    const live = filterLiveVets(liveAll, { services, animals, is24x7, q });

    // Curated entries win a near-duplicate contest, so a vetted vet is never
    // shadowed by the same clinic arriving from OpenStreetMap.
    const merged = [...curated, ...dedupeAgainstCurated(live, curated)].sort(
      (a, b) => a.distanceKm - b.distanceKm,
    );

    const limit = parseInt(req.query.limit, 50);
    const results = merged.slice(0, limit);

    const payload = {
      origin: { lat, lng },
      count: results.length,
      results,
    };

    // Tell the client the live half is missing so it can say so plainly instead
    // of letting a short list imply "there are no vets here".
    if (liveAll.unavailable) {
      payload.liveLookupUnavailable = true;
      payload.liveCount = 0;
      payload.curatedCount = curated.length;
    }

    res.json(payload);
  }),
);

/**
 * Decides whether a live lookup is even worth making, then makes it.
 *
 * Skipped when the operator has disabled it, when the user asked for verified
 * entries only (live results are never verified), or when the category filter
 * already excludes veterinary. Skipping the useless cases matters: every
 * skipped call is a request the public Overpass instance never has to serve.
 */
async function maybeLiveVets({ lat, lng, categories, verifiedOnly, radiusKm }) {
  if (!config.liveVets.enabled) return [];
  if (verifiedOnly) return [];
  if (categories.length && !categories.includes('veterinary')) return [];
  return fetchLiveVets(lat, lng, radiusKm ?? config.liveVets.radiusKm);
}

/**
 * GET /api/orgs/search?q=chennai — locality lookup for the manual location
 * picker. Returns a centroid per city so a user who denied GPS can still get a
 * sensible map centre and a distance-sorted list.
 */
router.get(
  '/search',
  asyncRoute((req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 25), 1), 100);
    const like = `%${q}%`;

    const COLUMNS = `
      city AS label, city AS value, COUNT(*) AS count,
      AVG(lat) AS lat, AVG(lng) AS lng
    `;

    const rows = q
      ? getDb()
          .prepare(
            `SELECT ${COLUMNS} FROM organizations
             WHERE active = 1 AND (city LIKE ? OR state LIKE ? OR name LIKE ? OR address LIKE ?)
             GROUP BY city ORDER BY count DESC, city LIMIT ?`,
          )
          .all(like, like, like, like, limit)
      : getDb()
          .prepare(
            `SELECT ${COLUMNS} FROM organizations
             WHERE active = 1 GROUP BY city ORDER BY count DESC LIMIT ?`,
          )
          .all(limit);

    res.json({
      query: q,
      localities: rows.map((r) => ({
        ...r,
        lat: Math.round(r.lat * 1e5) / 1e5,
        lng: Math.round(r.lng * 1e5) / 1e5,
      })),
    });
  }),
);

/** GET /api/orgs — full directory including deactivated entries. Admin-ish, but read-only and harmless. */
router.get(
  '/',
  asyncRoute((_req, res) => {
    res.json({ organizations: listAll({ includeInactive: true }), total: countOrgs() });
  }),
);

router.get(
  '/admin/all',
  requireAdmin,
  asyncRoute((_req, res) => {
    res.json({ organizations: listAll({ includeInactive: true }), total: countOrgs() });
  }),
);

router.get(
  '/:id',
  asyncRoute((req, res) => {
    const org = getById(req.params.id);
    if (!org) throw notFound('Organisation not found');
    res.json({ organization: org });
  }),
);

router.post('/admin', requireAdmin, (req, res) => {
  res.status(201).json({ organization: createOrg(parseOrgInput(req.body)) });
});

router.put('/admin/:id', requireAdmin, (req, res) => {
  if (!getById(req.params.id)) throw notFound('Organisation not found');
  res.json({ organization: updateOrg(req.params.id, parseOrgInput(req.body, { partial: true })) });
});

router.delete('/admin/:id', requireAdmin, (req, res) => {
  if (!deleteOrg(req.params.id)) throw notFound('Organisation not found');
  res.status(204).end();
});

/**
 * Community correction loop (public, no auth).
 *
 * These endpoints are deliberately unauthenticated - the whole point is that a
 * passer-by can say "this number is dead" without an account. In exchange they
 * must not be able to inflate the signal, so both are rate limited per IP and
 * per organisation. Neither hides, edits or deactivates anything: a flag only
 * moves an entry to the top of the admin queue, and a human still decides.
 */

/**
 * Fixed-window, in-memory rate limiter.
 *
 * Good enough for the single-process deployment this app runs on. It resets on
 * restart and is per-instance, so a multi-instance deploy would need this moved
 * into the database or a shared cache.
 */
const signalWindows = new Map();

function allowSignal(req, key, { max, windowMs }) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const id = `${key}:${ip}`;

  const entry = signalWindows.get(id);
  if (!entry || now > entry.resetAt) {
    signalWindows.set(id, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
}

// Opportunistic cleanup so a long-running process does not grow this forever.
const sweepSignalWindows = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of signalWindows) {
    if (now > entry.resetAt) signalWindows.delete(id);
  }
}, 60 * 60 * 1000);
sweepSignalWindows.unref?.();

/** POST /api/orgs/:id/flag — "this listing is wrong". Surfaces it to admins only. */
router.post(
  '/:id/flag',
  asyncRoute((req, res) => {
    const org = getById(req.params.id);
    if (!org) throw notFound('Organisation not found');

    const reason = parseEnum(req.body?.reason, FLAG_REASONS, 'reason');
    const note = parseText(req.body?.note, 'note', { required: false, max: 500 });

    if (!allowSignal(req, `flag:${org.id}`, { max: 3, windowMs: 24 * 60 * 60 * 1000 })) {
      throw tooManyRequests('You have already reported this listing a few times. Thank you.');
    }

    const flag = addFlag(org.id, { reason, note });
    res.status(201).json({
      flag,
      message: 'Thanks - an admin will check this listing.',
    });
  }),
);

/** POST /api/orgs/:id/confirm — "still correct". Bumps the community counter. */
router.post(
  '/:id/confirm',
  asyncRoute((req, res) => {
    const org = getById(req.params.id);
    if (!org) throw notFound('Organisation not found');

    if (!allowSignal(req, `confirm:${org.id}`, { max: 1, windowMs: 6 * 60 * 60 * 1000 })) {
      throw tooManyRequests('Thanks - you have already confirmed this listing recently.');
    }

    const updated = incrementConfirmation(org.id);
    res.json({
      confirmationCount: updated.confirmation_count,
      lastConfirmedAt: updated.last_confirmed_at,
      message: 'Thanks for confirming.',
    });
  }),
);

export default router;
