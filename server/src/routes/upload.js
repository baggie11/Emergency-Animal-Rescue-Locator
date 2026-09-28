import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { badRequest, asyncRoute } from '../lib/http.js';

const router = Router();

// Only raster image formats are accepted. SVG and PDF are excluded on purpose:
// this directory is user-submitted content served back from the same origin.
const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = ALLOWED_MIME[file.mimetype] || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) {
      const err = new Error('Only JPEG, PNG, WebP or HEIC images are allowed');
      // Without a status this surfaces as a 500 from the error middleware.
      err.status = 400;
      cb(err);
      return;
    }
    cb(null, true);
  },
});

/**
 * POST /api/upload — accepts one photo and returns a servable URL.
 *
 * MVP storage is the local disk. To move to S3/Supabase Storage, swap the
 * multer `storage` engine for a memory engine and call putObject here; the rest
 * of the app only ever sees the returned `url`.
 */
router.post(
  '/',
  upload.single('photo'),
  asyncRoute((req, res) => {
    if (!req.file) throw badRequest('No photo uploaded (expected field name "photo")');
    res.status(201).json({
      url: `/uploads/${path.basename(req.file.path)}`,
      bytes: req.file.size,
      mimeType: req.file.mimetype,
    });
  }),
);

export { ALLOWED_MIME };
export default router;
