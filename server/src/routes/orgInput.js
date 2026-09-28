import {
  badRequest,
  parseEnum,
  parseJsonArray,
  parseBool,
  parsePhone,
  parseLatLng,
  parseText,
  CATEGORY_IDS,
  SERVICE_IDS,
  ANIMAL_TYPE_IDS,
} from '../lib/http.js';

/**
 * Single validator for both create and (partial) update, so the admin panel and
 * any future import script cannot write a row the UI cannot render.
 *
 * With `partial: true` every absent key is left out of the returned object, so
 * the UPDATE statement only touches the columns the admin actually changed.
 */
export function parseOrgInput(body = {}, { partial = false } = {}) {
  const out = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const set = (key, value) => {
    if (value !== undefined) out[key] = value;
  };
  const needed = (key) => !partial || has(key);

  if (needed('name')) set('name', parseText(body.name, 'name', { max: 160 }));
  if (needed('category')) set('category', parseEnum(body.category, CATEGORY_IDS, 'category'));

  if (needed('phone')) set('phone', parsePhone(body.phone, 'phone'));
  if (has('altPhone')) set('altPhone', parsePhone(body.altPhone, 'altPhone', { required: false }));
  if (has('whatsapp')) set('whatsapp', parsePhone(body.whatsapp, 'whatsapp', { required: false }));

  if (has('email')) {
    const email = parseText(body.email, 'email', { required: false, max: 200 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('email is not a valid address');
    set('email', email);
  }

  if (has('website')) {
    const website = parseText(body.website, 'website', { required: false, max: 300 });
    if (website && !/^https?:\/\//i.test(website)) throw badRequest('website must start with http:// or https://');
    set('website', website);
  }

  if (needed('address')) set('address', parseText(body.address, 'address', { max: 400 }));
  if (needed('city')) set('city', parseText(body.city, 'city', { max: 120 }));
  if (needed('state')) set('state', parseText(body.state, 'state', { max: 120 }));

  if (needed('lat') || needed('lng')) {
    const { lat, lng } = parseLatLng(body.lat, body.lng);
    set('lat', lat);
    set('lng', lng);
  }

  if (has('servicesOffered')) {
    set('servicesOffered', parseJsonArray(body.servicesOffered, SERVICE_IDS, 'servicesOffered'));
  }
  if (has('animalTypesHandled')) {
    set('animalTypesHandled', parseJsonArray(body.animalTypesHandled, ANIMAL_TYPE_IDS, 'animalTypesHandled'));
  }

  if (has('is24x7')) set('is24x7', parseBool(body.is24x7));
  if (has('operatingHours')) {
    set('operatingHours', parseText(body.operatingHours, 'operatingHours', { required: false, max: 200 }));
  }
  if (has('verified')) set('verified', parseBool(body.verified));
  if (has('active')) set('active', parseBool(body.active, true));
  if (has('isSampleData')) set('isSampleData', parseBool(body.isSampleData));
  if (has('notes')) set('notes', parseText(body.notes, 'notes', { required: false, max: 2000 }));

  if (has('lastVerifiedDate')) {
    const date = parseText(body.lastVerifiedDate, 'lastVerifiedDate', { required: false, max: 10 });
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw badRequest('lastVerifiedDate must be YYYY-MM-DD');
    }
    set('lastVerifiedDate', date);
  }

  // Ticking "verified" stamps today's date automatically, so the admin list can
  // surface entries nobody has re-checked in months.
  if (out.verified === true && !has('lastVerifiedDate')) {
    out.lastVerifiedDate = new Date().toISOString().slice(0, 10);
  }

  return out;
}
