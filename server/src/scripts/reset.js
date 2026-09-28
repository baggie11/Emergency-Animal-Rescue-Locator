import fs from 'node:fs';
import { config } from '../config.js';

// Destructive on purpose — this is the "start over" button.
if (!process.argv.includes('--yes')) {
  console.error('[reset] Refusing to delete data without --yes');
  process.exit(1);
}

let removed = 0;
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${config.databaseFile}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    removed += 1;
  }
}

if (fs.existsSync(config.uploadDir)) {
  for (const name of fs.readdirSync(config.uploadDir)) {
    fs.rmSync(`${config.uploadDir}/${name}`, { force: true });
  }
}

console.log(`[reset] removed ${removed} database file(s) and cleared uploads. Run \`npm run migrate && npm run seed\` to rebuild.`);
