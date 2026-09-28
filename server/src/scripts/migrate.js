import { runMigrations, closeDb } from '../db/index.js';

const ran = runMigrations();
if (ran.length) console.log(`[migrate] ${ran.length} migration(s) applied`);
closeDb();
