import { Router } from 'express';
import {
  badRequest,
  notFound,
  parseEnum,
  parseLatLng,
  parseText,
  parseInt,
  asyncRoute,
  ANIMAL_TYPE_IDS,
  SITUATION_IDS,
} from '../lib/http.js';
import {
  createRequest,
  getRequestById,
  listRequests,
  updateRequestStatus,
  suggestOrgsForSituation,
} from '../models/rescueRequests.js';
import { animalLabel, situationLabel } from '../lib/taxonomy.js';
import { requireAdmin } from '../lib/auth.js';

const router = Router();

/** Digits only, ready for wa.me. Indian 10-digit numbers get the +91 country code. */
export function waNumber(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `91${digits}` : digits;
}

function absoluteUrl(p, base) {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  return base ? new URL(p, base).toString() : p;
}

/**
 * Builds the pre-filled WhatsApp text a user sends to the chosen organisation.
 *
 * This is the whole "auto-forward" mechanism for v1: the user reads the message,
 * WhatsApp opens with the org's number, they press send. No third-party
 * messaging API, no WhatsApp Business account, no per-message cost, and — most
 * importantly — a human confirms before a rescue team is dispatched.
 */
export function buildWhatsAppMessage({ request, org, shareUrl }) {
  const where = request.addressLabel || `${request.lat.toFixed(5)}, ${request.lng.toFixed(5)}`;
  const lines = [
    'URGENT ANIMAL RESCUE REQUEST (via Rescue Nearby)',
    '',
    `Situation: ${situationLabel(request.situationType)}`,
    `Animal: ${animalLabel(request.animalType)}`,
    `Location: ${where}`,
    `Map: https://www.google.com/maps/search/?api=1&query=${request.lat},${request.lng}`,
  ];

  if (request.description) lines.push('', `Details: ${request.description}`);
  if (request.reporterName || request.reporterPhone) {
    lines.push('', `From: ${[request.reporterName, request.reporterPhone].filter(Boolean).join(' — ')}`);
  }
  const photo = absoluteUrl(request.photoUrl, shareUrl);
  if (photo) lines.push(`Photo: ${photo}`);
  if (org?.name) lines.push('', `Sent via Rescue Nearby to ${org.name} (${org.category}).`);
  lines.push('', `Request ref: ${request.id}`);
  return lines.join('\n');
}

function parseRequestInput(body) {
  const { lat, lng } = parseLatLng(body.lat, body.lng);
  return {
    reporterName: parseText(body.reporterName, 'reporterName', { required: false, max: 120 }),
    reporterPhone: parseText(body.reporterPhone, 'reporterPhone', { max: 30, min: 6 }),
    lat,
    lng,
    addressLabel: parseText(body.addressLabel, 'addressLabel', { required: false, max: 300 }),
    animalType: parseEnum(body.animalType, ANIMAL_TYPE_IDS, 'animalType'),
    situationType: parseEnum(body.situationType, SITUATION_IDS, 'situationType'),
    description: parseText(body.description, 'description', { max: 1500 }),
    photoUrl: parseText(body.photoUrl, 'photoUrl', { required: false, max: 500 }),
  };
}

const withMessage = (s, request, shareUrl) => ({
  ...s,
  message: buildWhatsAppMessage({ request, org: s, shareUrl }),
  waNumber: waNumber(s.whatsapp || s.phone),
});

/** POST /api/requests — login-free. Stores the request and returns a ready-to-send WhatsApp link. */
router.post(
  '/',
  asyncRoute((req, res) => {
    const input = parseRequestInput(req.body);
    const request = createRequest(input);
    const shareUrl = `${req.protocol}://${req.get('host')}`;

    const suggestions = suggestOrgsForSituation({
      lat: input.lat,
      lng: input.lng,
      situationType: input.situationType,
      animalType: input.animalType,
    });

    res.status(201).json({ request, suggestions: suggestions.map((s) => withMessage(s, request, shareUrl)) });
  }),
);

router.get(
  '/:id/suggestions',
  asyncRoute((req, res) => {
    const request = getRequestById(req.params.id);
    if (!request) throw notFound('Request not found');
    const suggestions = suggestOrgsForSituation({
      lat: request.lat,
      lng: request.lng,
      situationType: request.situationType,
      animalType: request.animalType,
    });
    res.json({
      request,
      suggestions: suggestions.map((s) => ({
        ...s,
        waNumber: waNumber(s.whatsapp || s.phone),
      })),
    });
  }),
);

router.get(
  '/:id',
  asyncRoute((req, res) => {
    const request = getRequestById(req.params.id);
    if (!request) throw notFound('Request not found');
    res.json({ request });
  }),
);

/* ------------------------------------------------------------------ admin */

router.get(
  '/admin/queue',
  requireAdmin,
  asyncRoute((req, res) => {
    res.json({
      requests: listRequests({
        status: req.query.status || undefined,
        limit: parseInt(req.query.limit, 100),
        offset: parseInt(req.query.offset, 0),
      }),
    });
  }),
);

router.post(
  '/admin/:id/status',
  requireAdmin,
  (req, res) => {
    const updated = updateRequestStatus(req.params.id, req.body?.status, {
      forwardedTo: req.body?.forwardedTo,
      adminNotes: req.body?.adminNotes,
    });
    if (!updated) throw badRequest('Unknown status, or request not found');
    res.json({ request: updated });
  },
);

export default router;
