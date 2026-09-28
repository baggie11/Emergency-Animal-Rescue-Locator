import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { haversineKm } from './geo.js';

/**
 * Live veterinary lookups from the OpenStreetMap Overpass API.
 *
 * Why this is hybrid: NGOs and municipal animal control units are informal and
 * essentially invisible online, so they stay hand-curated. Veterinary clinics
 * are registered businesses that are already mapped on OSM, so hand-entering
 * them per city does not scale and goes stale. This module supplies the vet
 * half of the directory live, so coverage extends to any city with no manual
 * data entry.
 *
 * Every result produced here is `source: 'live'` and `verified: false`. It is
 * never presented as confirmed, because nothing here has been phoned.
 *
 * Design constraints, all deliberate:
 *  - Fail silently. A user looking for a vet with two bars of signal must still
 *    get their curated list. This module never throws.
 *  - Never hammer Overpass. Its public instance rate-limits abusive callers, so
 *    results are cached per ~1km grid cell for 24h and concurrent requests for
 *    the same cell share one in-flight fetch.
 */

const DEG_PER_KM_LAT = 1 / 110.574;

/**
 * Cell size in degrees. ~1.1km in latitude, so two people standing in the same
 * street hit the same cache entry. Longitude is divided by cos(lat) so cells
 * stay roughly square instead of stretching towards the poles.
 */
const CELL_DEG_LAT = 1 / 100;

const cellKeyFor = (lat, lng) => {
  const latCell = Math.floor(lat / CELL_DEG_LAT);
  const lngScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lngCell = Math.floor(lng / (CELL_DEG_LAT / lngScale));
  return `${latCell}:${lngCell}`;
};

/** Centre of a cell, used as the query centre so a cell's cached result covers the whole cell. */
const cellCentre = (lat, lng) => {
  const latCell = Math.floor(lat / CELL_DEG_LAT);
  const lngScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lngCell = Math.floor(lng / (CELL_DEG_LAT / lngScale));
  return {
    lat: (latCell + 0.5) * CELL_DEG_LAT,
    lng: (lngCell + 0.5) * (CELL_DEG_LAT / lngScale),
  };
};

/** Diagonal of a cell, so the query radius is grown enough to cover it. */
const cellRadiusKm = (lat) =>
  (Math.sqrt(2) * CELL_DEG_LAT) * (1 / DEG_PER_KM_LAT) * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);

/* -------------------------------------------------------------- cache ---- */

const readCache = (cellKey) => {
  try {
    const row = getDb()
      .prepare('SELECT payload, fetched_at FROM live_lookup_cache WHERE cell_key = ?')
      .get(cellKey);
    if (!row) return null;

    const fetchedAt = Date.parse(`${row.fetched_at.replace(' ', 'T')}Z`);
    if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > config.liveVets.cacheTtlMs) {
      getDb().prepare('DELETE FROM live_lookup_cache WHERE cell_key = ?').run(cellKey);
      return null;
    }
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
};

const writeCache = (cellKey, payload) => {
  try {
    getDb()
      .prepare(
        `INSERT INTO live_lookup_cache (cell_key, payload, fetched_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT (cell_key) DO UPDATE SET payload = excluded.payload,
                                            fetched_at = excluded.fetched_at`,
      )
      .run(cellKey, JSON.stringify(payload));
  } catch {
    // A cache write failure must never fail the request that triggered it.
  }
};

/** One in-flight fetch per cell, so a burst of identical requests is one call. */
const inFlight = new Map();

/* ------------------------------------------------------------ Overpass ---- */

const buildQuery = (lat, lng, radiusM) => `
[out:json][timeout:${Math.max(Math.ceil(config.liveVets.timeoutMs / 1000), 1)}];
(
  node["amenity"="veterinary"](around:${radiusM},${lat},${lng});
  way["amenity"="veterinary"](around:${radiusM},${lat},${lng});
  relation["amenity"="veterinary"](around:${radiusM},${lat},${lng});
);
out center ${Math.max(Math.ceil(config.liveVets.radiusKm * 4), 60)};
`;

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(';').map((s) => s.trim()).filter(Boolean);
  return [];
};

/** Pulls a usable phone number out of the several ways OSM records one. */
const phoneFromTags = (tags = {}) => {
  const raw =
    tags.phone ||
    tags['contact:phone'] ||
    tags['contact:mobile'] ||
    tags['phone:mobile'] ||
    null;
  if (!raw) return null;
  return String(raw).split(';')[0].trim() || null;
};

const isOpen247 = (tags = {}) => {
  const hours = String(tags.opening_hours || '').replace(/\s/g, '');
  return hours === '24/7' || hours === '24hours' || hours === '*';
};

/**
 * Normalises one Overpass element to the curated organisation shape so the UI
 * can render both sources through a single card component.
 */
function normaliseVet(element, origin) {
  const tags = element.tags || {};

  // Ways and relations carry their geometry in `center`, not `lat`/`lng`.
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.lng ?? element.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const address = asArray(tags['addr:full']).join(', ')
    || [tags['addr:street'], tags['addr:housenumber'], tags['addr:suburb'], tags['addr:city']]
        .filter(Boolean)
        .join(', ');

  return {
    id: `osm:${element.type || 'node'}/${element.id}`,
    osmId: element.id,
    osmType: element.type || 'node',
    name: tags.name || tags['official_name'] || 'Veterinary clinic (unnamed)',
    category: 'veterinary',
    phone: phoneFromTags(tags),
    altPhone: null,
    whatsapp: null,
    email: tags.email || tags['contact:email'] || null,
    website: tags.website || tags['contact:website'] || null,
    address: address || 'Address not listed on OpenStreetMap',
    city: tags['addr:city'] || tags['addr:district'] || null,
    state: tags['addr:state'] || null,
    lat,
    lng,
    // Only first aid is claimed. Ambulance, cremation, rehab and rescue are
    // per-clinic capabilities that OSM does not record, and over-claiming them
    // would send someone to a clinic that cannot take an animal in distress.
    servicesOffered: ['first_aid'],
    // Unknown on purpose. OSM does not record which species a clinic treats, and
    // an empty list is filtered as "no information" rather than "cannot help".
    animalTypesHandled: [],
    is24x7: isOpen247(tags),
    operatingHours: tags.opening_hours || null,
    verified: false,
    lastVerifiedDate: null,
    active: true,
    isSampleData: false,
    notes: null,
    distanceKm: Math.round(haversineKm(origin.lat, origin.lng, lat, lng) * 100) / 100,
    createdAt: null,
    updatedAt: null,
    source: 'live',
    confirmationCount: 0,
    lastConfirmedAt: null,
  };
}

async function queryOverpass(lat, lng, radiusKm) {
  const centre = cellCentre(lat, lng);
  // Query from the cell centre with the cell diagonal added, so every caller in
  // this cell gets a result set that genuinely covers their own radius even
  // though the response is cached per cell.
  const radiusM = Math.round((radiusKm + cellRadiusKm(lat)) * 1000);

  const res = await fetch(config.liveVets.overpassUrl, {
    method: 'POST',
    headers: {
      // Overpass's fair-use policy requires a descriptive User-Agent.
      'User-Agent': config.liveVets.userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ data: buildQuery(centre.lat, centre.lng, radiusM) }).toString(),
    signal: AbortSignal.timeout(config.liveVets.timeoutMs),
  });

  if (!res.ok) throw new Error(`Overpass returned ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.elements) ? json.elements : [];
}

/**
 * Fetches veterinary clinics near a point from OpenStreetMap.
 *
 * Never throws. On any failure - disabled, timeout, HTTP error, malformed
 * payload - it resolves to an empty array, and the array carries
 * `unavailable: true` so the caller can tell the user why the list is short
 * without turning a degraded data source into a broken page.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radiusKm] defaults to config.liveVets.radiusKm
 * @returns {Promise<Array<object> & {unavailable?: boolean}>}
 */
export async function fetchLiveVets(lat, lng, radiusKm = config.liveVets.radiusKm) {
  const unavailable = (reason) => {
    const empty = [];
    empty.unavailable = true;
    empty.reason = reason;
    return empty;
  };

  if (!config.liveVets.enabled) {
    // Not a failure: the operator turned it off deliberately.
    return [];
  }

  const cellKey = cellKeyFor(lat, lng);

  let cached = readCache(cellKey);
  if (!cached) {
    // One fetch per cell at a time; everyone else waits on the same promise.
    let pending = inFlight.get(cellKey);
    if (!pending) {
      pending = queryOverpass(lat, lng, radiusKm)
        .then((elements) => {
          const vets = elements
            .map((el) => normaliseVet(el, { lat, lng }))
            .filter((v) => v && v.distanceKm <= radiusKm);
          writeCache(cellKey, vets);
          return vets;
        })
        .catch((err) => {
          console.warn(`[live-vets] Overpass lookup failed: ${err.message}`);
          return null;
        })
        .finally(() => inFlight.delete(cellKey));
      inFlight.set(cellKey, pending);
    }
    cached = await pending;
    if (cached === null) return unavailable('lookup_failed');
  }

  // Re-filter on a cache hit: two callers in one cell asked for different radii.
  return cached
    .filter((v) => v.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Test seam: drops the memoised in-flight fetches. */
export function __resetInFlight() {
  inFlight.clear();
}

/* -------------------------------------------------------------- dedupe ---- */

/** Strips punctuation and case so "Dr. Smith's Vet Clinic" ≈ "dr smiths vet". */
const normaliseName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(dr|doctor|veterinary|vets|vet|clinic|hospital|pvt|ltd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * True when two names plausibly refer to the same place: either one contains
 * the other, or they share at least two significant words. Deliberately
 * conservative - a false positive would hide a real vet.
 */
function namesMatch(a, b) {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const words = (s) => new Set(s.split(' ').filter((w) => w.length > 2));
  const wa = words(na);
  const wb = words(nb);
  if (wa.size < 1 || wb.size < 1) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared >= 2 || (shared >= 1 && (wa.size === 1 || wb.size === 1));
}

export const DEDUPE_DISTANCE_KM = 0.15;

/**
 * Applies the same filters the SQL query applies to curated rows.
 *
 * The policy is "claim only what OSM actually says":
 *  - services: a tagged veterinary clinic genuinely does first aid, so it is
 *    kept when the user filters for medical help.
 *  - animals: EXCLUDED. OSM does not record which species a clinic treats, so
 *    someone filtering for "dog" would be shown a clinic we cannot confirm
 *    treats dogs. Better to under-promise than send them to the wrong place.
 *  - is24x7: only kept when explicitly tagged `opening_hours=24/7`.
 *  - q: matched against name/address, same as the curated search.
 *  - verifiedOnly: always excluded, since a live result is never verified.
 */
export function filterLiveVets(live, { services = [], animals = [], is24x7 = false, q = null } = {}) {
  const needle = q ? q.trim().toLowerCase() : null;

  return live.filter((v) => {
    if (animals.length) return false;
    if (is24x7 && !v.is24x7) return false;
    if (services.length && !services.some((s) => v.servicesOffered.includes(s))) return false;
    if (needle) {
      const haystack = `${v.name} ${v.address} ${v.city || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * Drops live vets that duplicate a curated vet, because the curated entry is
 * the one a human has checked.
 *
 * @param {object[]} live
 * @param {object[]} curated
 * @returns {object[]}
 */
export function dedupeAgainstCurated(live, curated) {
  const curatedVets = curated.filter((o) => o.category === 'veterinary');
  if (!curatedVets.length) return live;

  return live.filter((v) => {
    const duplicate = curatedVets.some(
      (c) =>
        haversineKm(v.lat, v.lng, c.lat, c.lng) <= DEDUPE_DISTANCE_KM && namesMatch(v.name, c.name),
    );
    return !duplicate;
  });
}

export const __testing = { cellKeyFor, cellCentre, namesMatch, DEDUPE_DISTANCE_KM };
