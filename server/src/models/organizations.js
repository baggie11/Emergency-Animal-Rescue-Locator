import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { SQL_DISTANCE_KM, DISTANCE_SQL_PARAMS } from '../lib/geo.js';

/** Maps a DB row (snake_case, JSON columns, 0/1 ints) to the public camelCase shape. */
export function rowToOrg(row) {
  if (!row) return null;
  const parse = (v) => {
    if (!v) return [];
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  };
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    phone: row.phone,
    altPhone: row.alt_phone,
    whatsapp: row.whatsapp,
    email: row.email,
    website: row.website,
    address: row.address,
    city: row.city,
    state: row.state,
    lat: row.lat,
    lng: row.lng,
    servicesOffered: parse(row.services_offered),
    animalTypesHandled: parse(row.animal_types),
    is24x7: !!row.is_24x7,
    operatingHours: row.operating_hours,
    verified: !!row.verified,
    lastVerifiedDate: row.last_verified_date,
    active: !!row.active,
    isSampleData: !!row.is_sample_data,
    notes: row.notes,
    distanceKm: row.distance_km != null ? Math.round(row.distance_km * 100) / 100 : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Provenance. Curated rows always live in SQLite; live veterinary results
    // come from Overpass and are merged in after this mapping (see
    // lib/liveVetLookup.js). Consumers can trust `source === 'curated'` to mean
    // "a human put this here", but NOT that the phone number is correct -
    // that is the separate `verified` flag.
    source: 'curated',
    confirmationCount: row.confirmation_count ?? 0,
    lastConfirmedAt: row.last_confirmed_at ?? null,
    flagCount: row.flag_count ?? 0,
    latestFlagReason: row.latest_flag_reason ?? null,
    latestFlagAt: row.latest_flag_at ?? null,
  };
}

const SELECT_COLUMNS = `
  id, name, category, phone, alt_phone, whatsapp, email, website, address, city, state,
  lat, lng, services_offered, animal_types, is_24x7, operating_hours, verified,
  last_verified_date, active, is_sample_data, notes, created_at, updated_at,
  confirmation_count, last_confirmed_at
`;

/**
 * Finds organisations sorted by distance from (lat, lng).
 *
 * @param {object} opts
 * @param {number} opts.lat
 * @param {number} opts.lng
 * @param {string[]} [opts.categories]   e.g. ['ngo','veterinary']
 * @param {boolean} [opts.is24x7]
 * @param {string[]} [opts.services]     org must offer ANY of these
 * @param {string[]} [opts.animals]      org handles ANY of these
 * @param {string} [opts.q]              free-text over name/address/city/services
 * @param {boolean} [opts.includeInactive]
 * @param {boolean} [opts.verifiedOnly]
 * @param {number} [opts.limit]
 * @param {number} [opts.radiusKm]       optional hard cap
 */
export function findNearby(opts) {
  const db = getDb();
  const { lat, lng } = opts;

  const where = [];
  // The distance expression is always the first predicate so its bind params
  // lead the array. SQLite rejects HAVING on a non-aggregate query, so the
  // radius cap has to live in WHERE.
  const params = [];

  if (opts.radiusKm) {
    where.push(`${SQL_DISTANCE_KM} <= ?`);
    params.push(...DISTANCE_SQL_PARAMS(lat, lng), opts.radiusKm);
  }

  if (!opts.includeInactive) where.push('active = 1');

  if (opts.categories?.length) {
    where.push(`category IN (${opts.categories.map(() => '?').join(',')})`);
    params.push(...opts.categories);
  }

  if (opts.is24x7) where.push('is_24x7 = 1');
  if (opts.verifiedOnly) where.push('verified = 1');

  if (opts.services?.length) {
    // services_offered is a JSON array; json_each lets us match on membership.
    where.push(
      `EXISTS (SELECT 1 FROM json_each(organizations.services_offered) s WHERE s.value IN (${opts.services
        .map(() => '?')
        .join(',')}))`,
    );
    params.push(...opts.services);
  }

  if (opts.animals?.length) {
    where.push(
      `EXISTS (SELECT 1 FROM json_each(organizations.animal_types) a WHERE a.value IN (${opts.animals
        .map(() => '?')
        .join(',')}))`,
    );
    params.push(...opts.animals);
  }

  if (opts.q) {
    where.push(
      `(name LIKE ? OR address LIKE ? OR city LIKE ? OR state LIKE ? OR services_offered LIKE ? OR animal_types LIKE ?)`,
    );
    const like = `%${opts.q}%`;
    params.push(like, like, like, like, like, like);
  }

  const distanceExpr = SQL_DISTANCE_KM;
  const distanceParams = DISTANCE_SQL_PARAMS(lat, lng);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const sql = `
    SELECT ${SELECT_COLUMNS},
           ${distanceExpr} AS distance_km
    FROM organizations
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY distance_km ASC, is_24x7 DESC, verified DESC, name ASC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...distanceParams, ...params, limit);
  return rows.map(rowToOrg);
}

/**
 * Same as findNearby but with no origin point — used for the admin list.
 *
 * Includes the community flag summary so the admin queue can sort flagged
 * entries to the top without a second round trip.
 */
export function listAll({ includeInactive = true, limit = 500 } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS},
              (SELECT COUNT(*) FROM org_flags f
                WHERE f.organization_id = organizations.id) AS flag_count,
              (SELECT f.reason FROM org_flags f
                WHERE f.organization_id = organizations.id
                ORDER BY f.created_at DESC, f.rowid DESC LIMIT 1) AS latest_flag_reason,
              (SELECT f.created_at FROM org_flags f
                WHERE f.organization_id = organizations.id
                ORDER BY f.created_at DESC, f.rowid DESC LIMIT 1) AS latest_flag_at
       FROM organizations
       ${includeInactive ? '' : 'WHERE active = 1'}
       ORDER BY category, name LIMIT ?`,
    )
    .all(limit);
  return rows.map(rowToOrg);
}

export function getById(id) {
  const db = getDb();
  return rowToOrg(db.prepare(`SELECT ${SELECT_COLUMNS} FROM organizations WHERE id = ?`).get(id));
}

export function createOrg(input) {
  const db = getDb();
  const id = input.id || randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organizations (
      id, name, category, phone, alt_phone, whatsapp, email, website, address, city, state,
      lat, lng, services_offered, animal_types, is_24x7, operating_hours, verified,
      last_verified_date, active, notes, is_sample_data, created_at, updated_at
    ) VALUES (
      @id, @name, @category, @phone, @alt_phone, @whatsapp, @email, @website, @address, @city, @state,
      @lat, @lng, @services_offered, @animal_types, @is_24x7, @operating_hours, @verified,
      @last_verified_date, @active, @notes, @is_sample_data, @created_at, @updated_at
    )`,
  ).run({
    id,
    name: input.name,
    category: input.category,
    phone: input.phone,
    alt_phone: input.altPhone ?? null,
    whatsapp: input.whatsapp ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    address: input.address,
    city: input.city,
    state: input.state,
    lat: input.lat,
    lng: input.lng,
    services_offered: JSON.stringify(input.servicesOffered ?? []),
    animal_types: JSON.stringify(input.animalTypesHandled ?? []),
    is_24x7: input.is24x7 ? 1 : 0,
    operating_hours: input.operatingHours ?? null,
    verified: input.verified ? 1 : 0,
    last_verified_date: input.lastVerifiedDate ?? null,
    active: input.active === false ? 0 : 1,
    notes: input.notes ?? null,
    is_sample_data: input.isSampleData ? 1 : 0,
    created_at: now,
    updated_at: now,
  });
  return getById(id);
}

const UPDATABLE = {
  name: 'name',
  category: 'category',
  phone: 'phone',
  altPhone: 'alt_phone',
  whatsapp: 'whatsapp',
  email: 'email',
  website: 'website',
  address: 'address',
  city: 'city',
  state: 'state',
  lat: 'lat',
  lng: 'lng',
  operatingHours: 'operating_hours',
  lastVerifiedDate: 'last_verified_date',
  notes: 'notes',
};

export function updateOrg(id, input) {
  const db = getDb();
  const existing = getById(id);
  if (!existing) return null;

  const sets = [];
  const params = { id, updated_at: new Date().toISOString() };

  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (input[key] !== undefined) {
      sets.push(`${column} = @${column}`);
      params[column] = input[key];
    }
  }

  if (input.servicesOffered !== undefined) {
    sets.push('services_offered = @services_offered');
    params.services_offered = JSON.stringify(input.servicesOffered);
  }
  if (input.animalTypesHandled !== undefined) {
    sets.push('animal_types = @animal_types');
    params.animal_types = JSON.stringify(input.animalTypesHandled);
  }
  for (const [key, column] of [
    ['is24x7', 'is_24x7'],
    ['verified', 'verified'],
    ['active', 'active'],
    ['isSampleData', 'is_sample_data'],
  ]) {
    if (input[key] !== undefined) {
      sets.push(`${column} = @${column}`);
      params[column] = input[key] ? 1 : 0;
    }
  }

  if (!sets.length) return existing;

  sets.push('updated_at = @updated_at');
  db.prepare(`UPDATE organizations SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getById(id);
}

export function deleteOrg(id) {
  const db = getDb();
  return db.prepare('DELETE FROM organizations WHERE id = ?').run(id).changes > 0;
}

export function countOrgs() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM organizations').get().n;
}
