import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { SITUATION_TYPES, animalLabel, situationLabel } from '../lib/taxonomy.js';

export function rowToRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    reporterName: row.reporter_name,
    reporterPhone: row.reporter_phone,
    lat: row.lat,
    lng: row.lng,
    addressLabel: row.address_label,
    animalType: row.animal_type,
    animalTypeLabel: animalLabel(row.animal_type),
    situationType: row.situation_type,
    situationTypeLabel: situationLabel(row.situation_type),
    description: row.description,
    photoUrl: row.photo_url,
    status: row.status,
    forwardedTo: row.forwarded_to,
    forwardedToName: row.forwarded_to_name ?? null,
    forwardedAt: row.forwarded_at,
    resolvedAt: row.resolved_at,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
  };
}

const safeJsonArray = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const SELECT_COLUMNS = `
  r.id, r.reporter_name, r.reporter_phone, r.lat, r.lng, r.address_label, r.animal_type,
  r.situation_type, r.description, r.photo_url, r.status, r.forwarded_to, r.forwarded_at,
  r.resolved_at, r.admin_notes, r.created_at,
  o.name AS forwarded_to_name
`;

export function createRequest(input) {
  const db = getDb();
  const id = input.id || randomUUID();
  db.prepare(
    `INSERT INTO rescue_requests (
      id, reporter_name, reporter_phone, lat, lng, address_label, animal_type,
      situation_type, description, photo_url, status, created_at
    ) VALUES (
      @id, @reporter_name, @reporter_phone, @lat, @lng, @address_label, @animal_type,
      @situation_type, @description, @photo_url, 'new', @created_at
    )`,
  ).run({
    id,
    reporter_name: input.reporterName ?? null,
    reporter_phone: input.reporterPhone,
    lat: input.lat,
    lng: input.lng,
    address_label: input.addressLabel ?? null,
    animal_type: input.animalType,
    situation_type: input.situationType,
    description: input.description,
    photo_url: input.photoUrl ?? null,
    created_at: new Date().toISOString(),
  });
  return getRequestById(id);
}

export function getRequestById(id) {
  const db = getDb();
  return rowToRequest(
    db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM rescue_requests r
         LEFT JOIN organizations o ON o.id = r.forwarded_to WHERE r.id = ?`,
      )
      .get(id),
  );
}

export function listRequests({ status, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE r.status = ?';
    params.push(status);
  }
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM rescue_requests r
       LEFT JOIN organizations o ON o.id = r.forwarded_to
       ${where}
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return rows.map(rowToRequest);
}

const STATUSES = new Set(['new', 'forwarded', 'resolved', 'declined']);

export function updateRequestStatus(id, status, { forwardedTo = undefined, adminNotes } = {}) {
  if (!STATUSES.has(status)) return null;
  const db = getDb();
  if (!getRequestById(id)) return null;

  const sets = ['status = @status', 'resolved_at = @resolved_at'];
  const params = { id, status, resolved_at: status === 'resolved' ? new Date().toISOString() : null };

  if (forwardedTo !== undefined) {
    sets.push('forwarded_to = @forwarded_to', 'forwarded_at = @forwarded_at');
    params.forwarded_to = forwardedTo;
    params.forwarded_at = new Date().toISOString();
  }
  if (adminNotes !== undefined) {
    sets.push('admin_notes = @admin_notes');
    params.admin_notes = adminNotes;
  }

  db.prepare(`UPDATE rescue_requests SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getRequestById(id);
}

/**
 * Picks the organisations that best match a situation.
 *
 * Reasoning: a request that needs medical help is worthless to a capture-only
 * unit, so we rank by whether the org actually offers the right service, then
 * by whether it is open 24x7, then by verified status, then by distance. This
 * drives the "who should I send this to?" suggestion in the form and the admin
 * queue.
 */
export function suggestOrgsForSituation({ lat, lng, situationType, animalType, limit = 5 }) {
  const situation = SITUATION_TYPES.find((s) => s.id === situationType) || null;

  // Service slugs that would genuinely help, most specific first. The CASE
  // below scores an org against these in order.
  const servicePreference = [];
  if (situation?.needsMedical) servicePreference.push('ambulance', 'first_aid', 'rescue');
  if (situation?.needsCapture) servicePreference.push('capture_only', 'rescue');
  if (situation?.needsDisposal) servicePreference.push('cremation', 'capture_only');

  const where = ['active = 1'];
  const params = [lat, lat, lng];

  // json_each walks the JSON array properly. A LIKE '%"dog"%' on a JSON blob
  // would also match "hotdog"-style slugs, so avoid that.
  if (animalType) {
    where.push('EXISTS (SELECT 1 FROM json_each(organizations.animal_types) a WHERE a.value = ?)');
    params.push(animalType);
  }

  const fitScoreSql = servicePreference.length
    ? `, (SELECT COALESCE(MIN(priority), 0) FROM (
         ${servicePreference
           .map(
             (slug, i) => `SELECT ${i + 1} AS priority WHERE EXISTS (
            SELECT 1 FROM json_each(organizations.services_offered) s WHERE s.value = '${slug}')`,
           )
           .join(' UNION ALL ')}
       )) AS fit_score`
    : ', 0 AS fit_score';

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, category, phone, whatsapp, is_24x7, verified, services_offered,
              2 * 6371 * asin(min(1, sqrt(
                power(sin((? - lat) * 0.017453292519943295 / 2), 2) +
                cos(lat * 0.017453292519943295) * cos(? * 0.017453292519943295) *
                power(sin((? - lng) * 0.017453292519943295 / 2), 2)
              ))) AS distance_km
              ${fitScoreSql}
       FROM organizations
       WHERE ${where.join(' AND ')}
       ORDER BY
         -- Unmatched orgs (fit_score 0) sink to the bottom, then best match first.
         (fit_score = 0),
         fit_score ASC,
         is_24x7 DESC,
         verified DESC,
         distance_km ASC
       LIMIT ?`,
    )
    .all(...params, limit);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    phone: r.phone,
    whatsapp: r.whatsapp,
    is24x7: !!r.is_24x7,
    verified: !!r.verified,
    servicesOffered: safeJsonArray(r.services_offered),
    distanceKm: r.distance_km != null ? Math.round(r.distance_km * 100) / 100 : null,
    // 0 means "no matching service". The UI only shows a match hint above 0.
    fitScore: r.fit_score,
  }));
}
