import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(ROOT, '..');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(REPO_ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const int = (v, fallback) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',

  dataDir: DATA_DIR,
  databaseFile: process.env.DATABASE_FILE
    ? path.resolve(process.env.DATABASE_FILE)
    : path.join(DATA_DIR, 'rescue.db'),
  uploadDir: path.join(DATA_DIR, 'uploads'),

  webDist: path.join(REPO_ROOT, 'web', 'dist'),

  // Comma separated list of extra origins allowed to call the API in dev.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    // Either provide ADMIN_PASSWORD (plain, hashed at boot) or ADMIN_PASSWORD_SCRYPT (preferred).
    password: process.env.ADMIN_PASSWORD || null,
    passwordScrypt: process.env.ADMIN_PASSWORD_SCRYPT || null,
    sessionTtlMs: int(process.env.ADMIN_SESSION_TTL_HOURS, 12) * 60 * 60 * 1000,
  },

  // Random per-boot secret means admin sessions drop on restart. Set this in production.
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),

  // Data-quality guard: the seeded directory is demo data, not verified public info.
  directoryIsSampleData: process.env.DIRECTORY_IS_SAMPLE_DATA !== 'false',

  // Live veterinary lookup via the OpenStreetMap Overpass API.
  //
  // NGOs and municipal animal control stay fully curated because they have no
  // public API to query. Veterinary clinics are registered businesses already
  // mapped on OSM, so they are fetched live instead of being hand-entered.
  // Setting LIVE_LOOKUP_ENABLED=false falls back to curated-only behaviour.
  liveVets: {
    enabled: process.env.LIVE_LOOKUP_ENABLED !== 'false',
    overpassUrl: process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter',
    cacheTtlMs: int(process.env.LIVE_LOOKUP_CACHE_TTL_HOURS, 24) * 60 * 60 * 1000,
    radiusKm: Math.max(Number.parseFloat(process.env.LIVE_LOOKUP_RADIUS_KM) || 10, 0.1),
    timeoutMs: int(process.env.LIVE_LOOKUP_TIMEOUT_MS, 3000),
    // Overpass's fair-use policy requires an identifying User-Agent. Point this
    // at a real contact address before relying on the public instance.
    userAgent:
      process.env.OVERPASS_USER_AGENT ||
      'RescueNearby/1.0 (+https://github.com/rescue-nearby; set OVERPASS_USER_AGENT to your contact)',
  },
};

export const isProd = config.env === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  console.warn(
    '[config] SESSION_SECRET is not set. Admin sessions will be invalidated on every restart. Set it in production.',
  );
}
if (isProd && config.admin.password) {
  console.warn(
    '[config] ADMIN_PASSWORD (plain text) is set. Prefer ADMIN_PASSWORD_SCRYPT in production.',
  );
}

const hasUsablePassword = Boolean(config.admin.passwordScrypt || config.admin.password);

if (!hasUsablePassword) {
  console.warn(
    '[config] No admin password is configured, so the admin panel cannot be signed in to. Run `npm run make-password --workspace server -- "your password"` and set ADMIN_PASSWORD_SCRYPT.',
  );
} else if (config.admin.password === 'admin123') {
  console.warn(
    '[config] Admin password is the insecure development default ("admin123"). Run `npm run make-password --workspace server -- "your password"` and set ADMIN_PASSWORD_SCRYPT.',
  );
}
