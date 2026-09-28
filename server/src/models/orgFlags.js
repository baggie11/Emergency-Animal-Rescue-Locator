import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

export const FLAG_REASONS = ['wrong_number', 'permanently_closed', 'other'];

export const FLAG_REASON_LABELS = {
  wrong_number: 'Wrong number',
  permanently_closed: 'Permanently closed',
  other: 'Something else',
};

/**
 * Records a public report that a curated entry is wrong.
 *
 * Flags never hide or edit anything - they exist purely to move an entry to the
 * top of the admin queue. Silently hiding a listing on one anonymous report
 * would let anyone remove a rescue service from the app with a single tap.
 */
export function addFlag(organizationId, { reason, note = null }) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO org_flags (id, organization_id, reason, note) VALUES (?, ?, ?, ?)`,
  ).run(id, organizationId, reason, note);
  return db.prepare(`SELECT * FROM org_flags WHERE id = ?`).get(id);
}

/** Bumps the community confirmation counter for a curated entry. */
export function incrementConfirmation(organizationId) {
  const db = getDb();
  db.prepare(
    `UPDATE organizations
     SET confirmation_count = confirmation_count + 1,
         last_confirmed_at = datetime('now')
     WHERE id = ?`,
  ).run(organizationId);
  return db
    .prepare(`SELECT confirmation_count, last_confirmed_at FROM organizations WHERE id = ?`)
    .get(organizationId);
}

/** Flag count plus the most recent reason, for a set of organisations. */
export function flagSummaries(organizationIds) {
  if (!organizationIds.length) return new Map();
  const placeholders = organizationIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT organization_id,
              COUNT(*) AS flag_count,
              MAX(created_at) AS latest_at
       FROM org_flags
       WHERE organization_id IN (${placeholders})
       GROUP BY organization_id`,
    )
    .all(...organizationIds);

  // The correlated subquery fetches the reason matching each row's latest flag.
  const latest = getDb()
    .prepare(
      `SELECT organization_id, reason FROM org_flags f
       WHERE rowid = (
         SELECT rowid FROM org_flags g
         WHERE g.organization_id = f.organization_id
         ORDER BY g.created_at DESC, g.rowid DESC LIMIT 1
       )
       AND organization_id IN (${placeholders})`,
    )
    .all(...organizationIds);

  const reasonByOrg = new Map(latest.map((r) => [r.organization_id, r.reason]));
  return new Map(
    rows.map((r) => [
      r.organization_id,
      {
        count: r.flag_count,
        latestReason: reasonByOrg.get(r.organization_id) || null,
        latestAt: r.latest_at,
      },
    ]),
  );
}

export function listFlags(organizationId) {
  return getDb()
    .prepare(`SELECT * FROM org_flags WHERE organization_id = ? ORDER BY created_at DESC, rowid DESC`)
    .all(organizationId);
}

export function countAllFlags() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM org_flags').get().n;
}
