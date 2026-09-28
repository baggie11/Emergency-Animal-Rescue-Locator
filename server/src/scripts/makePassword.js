import { hashPassword } from '../lib/auth.js';

const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run make-password --workspace server -- "your strong password"');
  process.exit(1);
}

if (password.length < 10) {
  console.error('Refusing: use at least 10 characters.');
  process.exit(1);
}

console.log('\nAdd this to your .env (do not commit the .env):\n');
console.log(`ADMIN_PASSWORD_SCRYPT=${hashPassword(password)}\n`);
console.log('And remove any ADMIN_PASSWORD line so the plaintext default is not used.');
