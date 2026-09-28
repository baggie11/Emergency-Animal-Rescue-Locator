import { CATEGORY_IDS, SERVICE_IDS, ANIMAL_TYPE_IDS, SITUATION_IDS } from './taxonomy.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);
export const tooManyRequests = (msg = 'Too many requests') => new HttpError(429, msg);

export function parseJsonArray(value, allowed, field) {
  if (value == null || value === '') return [];
  let arr = value;
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value);
    } catch {
      throw badRequest(`${field} must be a JSON array`);
    }
  }
  if (!Array.isArray(arr)) throw badRequest(`${field} must be an array`);
  const invalid = arr.filter((v) => !allowed.includes(v));
  if (invalid.length) {
    throw badRequest(`${field} contains unsupported values: ${invalid.join(', ')}`, {
      allowed,
    });
  }
  return [...new Set(arr)];
}

const PHONE_RE = /^[+()\d][\d\s\-().]{4,24}$/;

export function parsePhone(value, field, { required = true } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const phone = String(value).trim();
  if (!PHONE_RE.test(phone)) throw badRequest(`${field} is not a valid phone number`);
  return phone;
}

export function parseLatLng(lat, lng) {
  const a = typeof lat === 'number' ? lat : Number.parseFloat(lat);
  const b = typeof lng === 'number' ? lng : Number.parseFloat(lng);
  if (!Number.isFinite(a)) throw badRequest('lat must be a number');
  if (!Number.isFinite(b)) throw badRequest('lng must be a number');
  if (a < -90 || a > 90) throw badRequest('lat must be between -90 and 90');
  if (b < -180 || b > 180) throw badRequest('lng must be between -180 and 180');
  return { lat: a, lng: b };
}

export function parseText(value, field, { required = true, max = 500, min = 1 } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const text = String(value).trim();
  if (text.length < min) throw badRequest(`${field} must be at least ${min} characters`);
  if (text.length > max) throw badRequest(`${field} must be under ${max} characters`);
  return text;
}

export function parseBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function parseEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`, { allowed });
  }
  return value;
}

export const parseInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export { CATEGORY_IDS, SERVICE_IDS, ANIMAL_TYPE_IDS, SITUATION_IDS };

/** Wraps an async express handler so rejections reach the error middleware. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
