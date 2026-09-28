-- 001_init.sql
-- Rescue Nearby core schema.
--
-- Coordinates are stored as REAL (degrees). Distance is computed with the
-- Haversine formula inline so the MVP needs no database extensions. To move to
-- PostGIS see the "Moving to PostGIS" section of the README.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS organizations (
  id                 TEXT PRIMARY KEY,
  name               TEXT    NOT NULL,
  category           TEXT    NOT NULL CHECK (category IN ('ngo', 'veterinary', 'municipal')),
  phone              TEXT    NOT NULL,
  alt_phone          TEXT,
  whatsapp           TEXT,
  email              TEXT,
  website            TEXT,
  address            TEXT    NOT NULL,
  city               TEXT    NOT NULL,
  state              TEXT    NOT NULL,
  lat                REAL    NOT NULL,
  lng                REAL    NOT NULL,
  services_offered   TEXT    NOT NULL DEFAULT '[]',   -- JSON array of service slugs
  animal_types       TEXT    NOT NULL DEFAULT '[]',   -- JSON array of animal slugs
  is_24x7            INTEGER NOT NULL DEFAULT 0 CHECK (is_24x7 IN (0, 1)),
  operating_hours    TEXT,                            -- free text, e.g. "9:00 AM - 6:00 PM"
  verified           INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  last_verified_date TEXT,
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes              TEXT,
  is_sample_data     INTEGER NOT NULL DEFAULT 0 CHECK (is_sample_data IN (0, 1)),
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_organizations_category ON organizations (category);
CREATE INDEX IF NOT EXISTS idx_organizations_active   ON organizations (active);
CREATE INDEX IF NOT EXISTS idx_organizations_city     ON organizations (city);

CREATE TABLE IF NOT EXISTS rescue_requests (
  id              TEXT PRIMARY KEY,
  reporter_name   TEXT,
  reporter_phone  TEXT    NOT NULL,
  lat             REAL    NOT NULL,
  lng             REAL    NOT NULL,
  address_label   TEXT,
  animal_type     TEXT    NOT NULL,
  situation_type  TEXT    NOT NULL CHECK (situation_type IN
                     ('injured', 'sick', 'trapped', 'aggressive', 'deceased')),
  description     TEXT    NOT NULL,
  photo_url       TEXT,
  status          TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'forwarded', 'resolved', 'declined')),
  forwarded_to    TEXT,                               -- organizations.id
  forwarded_at    TEXT,
  resolved_at     TEXT,
  admin_notes     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rescue_requests_status ON rescue_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rescue_requests_geo    ON rescue_requests (lat, lng);

-- Small key/value table for runtime-editable config (e.g. the helpline banner
-- number) so non-engineers can change it from the admin panel without a deploy.
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
