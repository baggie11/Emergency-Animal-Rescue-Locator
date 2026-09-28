-- 002_live_vets_and_community_signals.sql
-- Two additions:
--   1. Cached Overpass responses, keyed by a ~1km grid cell, so nearby users
--      share one request instead of hammering the public Overpass instance.
--   2. Community correction signals on curated entries (confirmations + flags),
--      so admins can prioritise what to re-check instead of re-verifying the
--      whole directory blind.
--
-- SQLite has no real DATETIME type. These columns are TEXT holding
-- 'YYYY-MM-DD HH:MM:SS' UTC, matching created_at/updated_at in 001_init.sql.

CREATE TABLE IF NOT EXISTS live_lookup_cache (
  cell_key  TEXT PRIMARY KEY,
  payload   TEXT NOT NULL,                    -- JSON array of normalised vets
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_flags (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  reason          TEXT NOT NULL CHECK (reason IN ('wrong_number', 'permanently_closed', 'other')),
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_org_flags_org ON org_flags (organization_id, created_at DESC);

-- Community "yes, this is still correct" signal.
ALTER TABLE organizations ADD COLUMN confirmation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN last_confirmed_at  TEXT;
