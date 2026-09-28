import { Router } from 'express';
import { CATEGORIES, SERVICES, ANIMAL_TYPES, SITUATION_TYPES } from '../lib/taxonomy.js';
import { getConfig, setConfig } from '../models/appConfig.js';
import { requireAdmin } from '../lib/auth.js';
import { asyncRoute, badRequest, parseText } from '../lib/http.js';
import { getById } from '../models/organizations.js';
import { getRequestById } from '../models/rescueRequests.js';
import { buildWhatsAppMessage, waNumber } from './requests.js';

const router = Router();

/** Everything the frontend needs to render filter chips and badges. */
router.get('/meta', (_req, res) => {
  res.json({
    categories: CATEGORIES,
    services: SERVICES,
    animalTypes: ANIMAL_TYPES,
    situationTypes: SITUATION_TYPES,
  });
});

/** Runtime-editable app config (helpline number, disclaimers). */
router.get('/config', (_req, res) => {
  res.json({ config: getConfig() });
});

router.put(
  '/config',
  requireAdmin,
  asyncRoute((req, res) => {
    const patch = {};
    for (const key of ['helplinePhone', 'helplineLabel', 'helplineNote', 'dataDisclaimer', 'supportEmail', 'isSampleData']) {
      if (req.body?.[key] !== undefined) {
        patch[key] = parseText(req.body[key], key, { required: false, max: 400 });
      }
    }
    if (patch.helplinePhone) {
      const digits = String(patch.helplinePhone).replace(/\D/g, '');
      if (digits.length < 3) throw badRequest('helplinePhone needs at least 3 digits');
    }
    res.json({ config: setConfig(patch) });
  }),
);

/**
 * Builds the WhatsApp deep link client-side-avoidance: the client already has the
 * organisation, but the message format lives on the server so the admin preview
 * and the actual send are guaranteed identical.
 */
router.post(
  '/share-message',
  asyncRoute((req, res) => {
    const { organizationId, requestId } = req.body || {};
    const org = organizationId ? getById(organizationId) : null;
    if (organizationId && !org) throw badRequest('Unknown organisation');

    const request = requestId ? getRequestById(requestId) : null;
    if (!request) throw badRequest('requestId is required to build a message');

    const shareUrl = `${req.protocol}://${req.get('host')}`;
    const number = waNumber(org?.whatsapp || org?.phone);
    const text = buildWhatsAppMessage({ request, org, shareUrl });

    res.json({
      text,
      number,
      waUrl: number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null,
    });
  }),
);

export default router;
