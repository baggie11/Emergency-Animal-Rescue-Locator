import { getDb } from '../db/index.js';

const DEFAULTS = {
  helplinePhone: '112',
  helplineLabel: 'National Emergency Helpline',
  helplineNote: 'PLACEHOLDER — confirm the correct state/city animal helpline before launch.',
  dataDisclaimer:
    'Contact details are crowd-sourced and may be out of date. Call to confirm before travelling.',
  isSampleData: 'true',
  supportEmail: 'contact@example.org',
};

export function getConfig() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM app_config').all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored };
}

export function setConfig(patch) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) stmt.run(k, String(v));
  });
  tx(Object.entries(patch));
  return getConfig();
}
