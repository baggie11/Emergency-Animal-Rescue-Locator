import { runMigrations, closeDb } from '../db/index.js';
import { createOrg, countOrgs, listAll } from '../models/organizations.js';
import { setConfig } from '../models/appConfig.js';
import { SAMPLE_ORGANIZATIONS } from '../seed/organizations.js';

runMigrations();

const existing = countOrgs();
const force = process.argv.includes('--force');

if (existing > 0 && !force) {
  console.log(`[seed] ${existing} organisation(s) already in the database — nothing to do.`);
  console.log('[seed] Re-run with --force to wipe the directory and re-seed. (Any real data you added is lost.)');
  closeDb();
  process.exit(0);
}

if (existing > 0) {
  // Re-seeding means clearing both tables so ids and content stay predictable.
  const { getDb } = await import('../db/index.js');
  const db = getDb();
  db.exec('DELETE FROM rescue_requests; DELETE FROM organizations;');
  console.log(`[seed] cleared ${existing} existing organisation(s)`);
}

let created = 0;
for (const org of SAMPLE_ORGANIZATIONS) {
  // A stable id makes demo links and screenshots reproducible across re-seeds.
  const id = `sample-${String(created + 1).padStart(2, '0')}`;
  createOrg({ ...org, id, isSampleData: true, verified: false, active: true });
  created += 1;
}

setConfig({
  helplinePhone: '112',
  helplineLabel: 'National Emergency Helpline',
  helplineNote:
    'PLACEHOLDER. 112 is the Indian national emergency number. Confirm the correct Tamil Nadu / Chennai animal helpline before launch.',
  isSampleData: 'true',
});

console.log(`[seed] inserted ${created} sample organisation(s) across ${new Set(SAMPLE_ORGANIZATIONS.map((o) => o.city)).size} cities`);
console.log('[seed] *** ALL SEEDED ROWS ARE PLACEHOLDER DATA — VERIFY BEFORE PUBLIC LAUNCH ***');
console.log(`[seed] done: ${listAll().length} organisation(s) total`);
closeDb();
