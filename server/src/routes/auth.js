import { Router } from 'express';
import { login, logout, currentSession, requireAdmin } from '../lib/auth.js';
import { config } from '../config.js';
import { asyncRoute } from '../lib/http.js';

const router = Router();

/** Minimal in-process rate limit so the admin password cannot be brute-forced. */
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function throttle(req) {
  const key = req.ip;
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(key, { first: now, count: 1 });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    const err = new Error('Too many failed sign-in attempts. Try again in a few minutes.');
    err.status = 429;
    throw err;
  }
}

router.post(
  '/login',
  asyncRoute((req, res) => {
    throttle(req);
    const { username, password } = req.body || {};
    const session = login(res, String(username || ''), String(password || ''));
    res.json({ user: session });
  }),
);

router.post('/logout', (req, res) => {
  logout(req, res);
  res.json({ ok: true });
});

router.get('/session', (req, res) => {
  const session = currentSession(req);
  res.json({ authenticated: !!session, user: session ? { username: session.u } : null });
});

router.get('/config', requireAdmin, (_req, res) => {
  res.json({
    sessionTtlHours: config.admin.sessionTtlMs / 3_600_000,
    usesPlainPassword: !config.admin.passwordScrypt,
  });
});

export default router;
