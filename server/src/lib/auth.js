import crypto from 'node:crypto';
import { config } from '../config.js';
import { unauthorized, HttpError } from './http.js';

/**
 * Admin auth for the MVP: a single shared password, exchanged for a signed,
 * httpOnly session cookie. Deliberately dependency-free.
 *
 * Password storage: either ADMIN_PASSWORD_SCRYPT ("<saltHex>:<hashHex>", from
 * `npm run make-password --workspace server`) or, for local development only,
 * a plain ADMIN_PASSWORD which is hashed in memory at boot.
 */

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const COOKIE_NAME = 'rn_admin';

const devPasswordHash = (() => {
  const password = config.admin.password;
  if (!password) return null;
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64, SCRYPT_PARAMS).toString('hex')}`;
})();

const activeHash = () => config.admin.passwordScrypt || devPasswordHash;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto
    .scryptSync(password, salt, 64, SCRYPT_PARAMS)
    .toString('hex')}`;
}

export function verifyPassword(password) {
  const stored = activeHash();
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT_PARAMS);
  return crypto.timingSafeEqual(expected, actual);
}

const sign = (payload) =>
  crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

/**
 * Session tokens are stateless, so clearing the cookie alone would leave a
 * captured token valid until it expired. Logout therefore records the token
 * here until its natural expiry. In-memory on purpose: a restart already
 * invalidates every session because the signing secret is ephemeral in dev.
 */
const revokedTokens = new Map();

const revoke = (token) => {
  const payload = readToken(token);
  if (!payload) return;
  revokedTokens.set(token, payload.exp);
  if (revokedTokens.size > 500) {
    const now = Date.now();
    for (const [key, exp] of revokedTokens) if (exp < now) revokedTokens.delete(key);
  }
};

function createToken(username) {
  const body = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + config.admin.sessionTtlMs }),
  ).toString('base64url');
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (revokedTokens.has(token)) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function login(res, username, password) {
  if (username !== config.admin.username || !verifyPassword(password)) {
    throw new HttpError(401, 'Incorrect username or password');
  }
  const token = createToken(username);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: config.admin.sessionTtlMs,
    path: '/',
  });
  return { username };
}

export function logout(req, res) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) revoke(token);
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function currentSession(req) {
  return readToken(req.cookies?.[COOKIE_NAME]);
}

export function requireAdmin(req, res, next) {
  const session = currentSession(req);
  if (!session) {
    next(unauthorized('Admin sign-in required'));
    return;
  }
  req.admin = session;
  next();
}

export { COOKIE_NAME };
