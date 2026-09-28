import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';

import { config } from './config.js';
import { runMigrations } from './db/index.js';
import { HttpError } from './lib/http.js';

import orgRoutes from './routes/orgs.js';
import requestRoutes from './routes/requests.js';
import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import uploadRoutes from './routes/upload.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin and non-browser callers send no Origin header.
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  if (!config.env.startsWith('prod')) {
    app.use((req, _res, next) => {
      const started = Date.now();
      _res.on('finish', () => {
        console.log(`${req.method} ${req.originalUrl} -> ${_res.statusCode} (${Date.now() - started}ms)`);
      });
      next();
    });
  }

  // Photos. Local disk for the MVP; see routes/upload.js for the S3 swap.
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false }));
  app.use('/api/upload', uploadRoutes);

  app.get('/api/health', (_req, res) => res.json({ ok: true, env: config.env, time: new Date().toISOString() }));

  app.use('/api/orgs', orgRoutes);
  app.use('/api/requests', requestRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api', metaRoutes);

  // In production the API also serves the built SPA, so the whole app deploys as
  // one process with no CORS or separate-origin concerns.
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { maxAge: '1h', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.originalUrl });
  });

  // Single error shape for the whole API: { error, details? }
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 8 MB)' : `Upload failed: ${err.message}`;
      res.status(400).json({ error: message });
      return;
    }
    const status = err instanceof HttpError ? err.status : err.status || 500;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.message || 'Internal server error', details: err.details });
  });

  return app;
}

// Run migrations then listen — but only when this file is the entrypoint, so
// tests and scripts can import createApp() without binding a port.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runMigrations();
  const app = createApp();
  app.listen(config.port, config.host, () => {
    console.log(`[api] Rescue Nearby listening on http://${config.host}:${config.port} (${config.env})`);
    console.log(`[api] database: ${config.databaseFile}`);
  });
}
