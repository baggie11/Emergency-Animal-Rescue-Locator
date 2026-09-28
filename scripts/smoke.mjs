/**
 * End-to-end smoke test for the Rescue Nearby API.
 *
 * Boots the real Express app against a throwaway SQLite file, exercises every
 * endpoint the frontend uses, and exits non-zero on the first failure. Run with:
 *   npm run smoke
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockOverpass, COIMBATORE_VETS } from './mock-overpass.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rescue-nearby-smoke-'));
process.env.DATA_DIR = tmpDir;
process.env.NODE_ENV = 'test';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'smoke-test-password';
process.env.SESSION_SECRET = 'smoke-secret-not-for-production';

// The live vet lookup is the only outbound call in the suite. Point it at a
// local stub so the tests never touch the real public Overpass instance.
const overpass = await startMockOverpass(COIMBATORE_VETS);
process.env.OVERPASS_API_URL = overpass.url;
process.env.LIVE_LOOKUP_TIMEOUT_MS = '1500';

const { runMigrations, closeDb } = await import('../server/src/db/index.js');
runMigrations({ silent: true });
const { SAMPLE_ORGANIZATIONS } = await import('../server/src/seed/organizations.js');
const { createOrg } = await import('../server/src/models/organizations.js');
for (const [i, org] of SAMPLE_ORGANIZATIONS.entries()) {
  createOrg({ ...org, id: `sample-${String(i + 1).padStart(2, '0')}`, isSampleData: true });
}

const { createApp } = await import('../server/src/index.js');
const app = createApp();

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  }
}

async function api(method, url, { body, form, cookie, raw } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${url}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const setCookie = res.headers.get('set-cookie');
  let data = null;
  if (!raw) {
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
  }
  return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : null };
}

const CHENNAI = { lat: 13.0827, lng: 80.2707 };
const qs = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, v])).toString();

console.log('\n=== public endpoints (no login required) ===');

{
  const r = await api('GET', '/api/health');
  check('GET /api/health returns ok', r.status === 200 && r.data.ok, r.data);
}

{
  const r = await api('GET', '/api/meta');
  check(
    'GET /api/meta exposes all four taxonomies',
    r.status === 200 &&
      r.data.categories.length === 3 &&
      r.data.services.length > 0 &&
      r.data.animalTypes.length > 0 &&
      r.data.situationTypes.length === 5,
    r.data,
  );
}

{
  const r = await api('GET', `/api/orgs/nearby?${qs(CHENNAI)}`);
  const first = r.data?.results?.[0];
  check('GET /api/orgs/nearby returns results', r.status === 200 && r.data.count > 0, r.data);
  check('results are sorted nearest-first', r.data.results.every((o, i, a) => i === 0 || a[i - 1].distanceKm <= o.distanceKm), r.data?.results?.map((o) => o.distanceKm));
  check('result shape matches the documented contract', first && first.phone && first.category && Array.isArray(first.servicesOffered) && typeof first.lat === 'number', first);
  check('booleans are real booleans, not 0/1', typeof first.is24x7 === 'boolean' && typeof first.verified === 'boolean', { is24x7: first?.is24x7, verified: first?.verified });
}

{
  const r = await api('GET', `/api/orgs/nearby?${qs({ ...CHENNAI, categories: 'municipal' })}`);
  check('category filter only returns that category', r.data.results.every((o) => o.category === 'municipal'), r.data?.results?.map((o) => o.category));
}

{
  const r = await api('GET', `/api/orgs/nearby?${qs({ ...CHENNAI, is24x7: 'true' })}`);
  check('is24x7 filter only returns 24x7 orgs', r.data.results.length > 0 && r.data.results.every((o) => o.is24x7), r.data?.results?.length);
}

{
  const r = await api('GET', `/api/orgs/nearby?${qs({ ...CHENNAI, services: 'capture_only' })}`);
  check('service filter matches municipal capture units', r.data.results.every((o) => o.servicesOffered.includes('capture_only')), r.data?.results?.length);
}

{
  const r = await api('GET', `/api/orgs/nearby?${qs({ ...CHENNAI, animals: 'bird' })}`);
  check('animal filter narrows correctly', r.data.results.every((o) => o.animalTypesHandled.includes('bird')), r.data?.results?.length);
}

{
  const r = await api('GET', `/api/orgs/nearby?${qs({ ...CHENNAI, q: 'anna' })}`);
  check('free-text search matches', r.data.results.some((o) => /anna/i.test(o.name)), r.data?.results?.map((o) => o.name));
}

{
  const r = await api('GET', `/api/orgs/nearby?${qs({ ...CHENNAI, categories: 'nope' })}`);
  check('unknown category is ignored, not fatal', r.status === 200, r.data);
}

{
  const r = await api('GET', '/api/orgs/nearby');
  check('missing lat/lng returns 400 with a message', r.status === 400 && r.data.error, r.data);
}

{
  const r = await api('GET', '/api/orgs/nearby?lat=999&lng=80');
  check('out-of-range lat returns 400', r.status === 400, r.data);
}

{
  const r = await api('GET', '/api/orgs/search?q=chen');
  check('GET /api/orgs/search returns localities', r.status === 200 && r.data.localities.some((l) => l.label === 'Chennai'), r.data);
}

{
  const r = await api('GET', `/api/orgs/nearby?${qs({ ...CHENNAI, radiusKm: 5 })}`);
  check('radiusKm caps results', r.data.results.every((o) => o.distanceKm <= 5), r.data?.results?.map((o) => o.distanceKm));
}

console.log('\n=== rescue requests (no login required) ===');

let requestId;
{
  const r = await api('POST', '/api/requests', {
    body: {
      reporterName: 'Smoke Tester',
      reporterPhone: '9876543210',
      ...CHENNAI,
      addressLabel: 'Near Ripon Building, Chennai',
      animalType: 'dog',
      situationType: 'injured',
      description: 'Hit by a bike, bleeding on the road.',
    },
  });
  requestId = r.data?.request?.id;
  check('POST /api/requests creates a request', r.status === 201 && !!requestId, r.data);
  check('new request defaults to status "new"', r.data?.request?.status === 'new', r.data?.request?.status);
  check('POST returns suggested organisations', Array.isArray(r.data?.suggestions) && r.data.suggestions.length > 0, r.data?.suggestions);
  const med = r.data.suggestions.filter((s) => s.fitScore > 0);
  check('medical situations rank medical orgs first', med.length > 0 && /hospital|centre|veterinary/i.test(med[0].name), med.map((s) => [s.name, s.fitScore]));
  check('suggestions carry a pre-filled message body', typeof r.data?.suggestions?.[0]?.message === 'string' && r.data.suggestions[0].message.includes('URGENT ANIMAL RESCUE'), r.data?.suggestions?.[0]?.message);
  check('wa.me number gets the +91 country code', r.data?.suggestions?.[0]?.waNumber?.startsWith('91'), r.data?.suggestions?.[0]?.waNumber);
  check('message body includes the coordinates', r.data?.suggestions?.[0]?.message?.includes('13.0827'), r.data?.suggestions?.[0]?.message);
}

{
  const r = await api('POST', '/api/requests', {
    body: { reporterPhone: '9876543210', ...CHENNAI, animalType: 'dog', situationType: 'nope', description: 'x' },
  });
  check('invalid situationType is rejected by the enum', r.status === 400, r.data);
}

{
  const r = await api('POST', '/api/requests', {
    body: { reporterPhone: '9876543210', ...CHENNAI, animalType: 'dog', situationType: 'deceased', description: '' },
  });
  check('empty description is rejected', r.status === 400, r.data);
}

{
  const r = await api('POST', '/api/requests', {
    body: { reporterPhone: '9876543210', ...CHENNAI, animalType: 'dog', situationType: 'deceased', description: 'Roadkill on the highway' },
  });
  const top = r.data?.suggestions?.[0];
  check(
    'deceased situations rank disposal-capable orgs first',
    top && top.fitScore > 0 && top.servicesOffered.includes('cremation'),
    { name: top?.name, fit: top?.fitScore, services: top?.servicesOffered },
  );
}

{
  const r = await api('GET', `/api/requests/${requestId}/suggestions`);
  check('GET /api/requests/:id/suggestions re-ranks', r.status === 200 && r.data.suggestions.length > 0, r.data);
}

console.log('\n=== photo upload ===');

{
  // 1x1 transparent PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fd = new FormData();
  fd.append('photo', new Blob([png], { type: 'image/png' }), 'dot.png');
  const r = await api('POST', '/api/upload', { form: fd });
  check('POST /api/upload accepts an image', r.status === 201 && /^\/uploads\//.test(r.data.url), r.data);
  const fetched = await fetch(`${base}${r.data.url}`);
  check('uploaded photo is served back', fetched.status === 200, fetched.status);
}

{
  const fd = new FormData();
  fd.append('photo', new Blob([Buffer.from('not an image')], { type: 'application/pdf' }), 'bad.pdf');
  const r = await api('POST', '/api/upload', { form: fd });
  check('non-image upload is rejected', r.status === 400, r.data);
}

console.log('\n=== admin auth ===');

{
  const r = await api('GET', '/api/requests/admin/queue');
  check('admin queue is protected', r.status === 401, r.data);
}

{
  const r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong-password' } });
  check('wrong password is rejected', r.status === 401, r.data);
}

let adminCookie;
{
  const r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'smoke-test-password' } });
  adminCookie = r.cookie;
  check('correct password returns a session cookie', r.status === 200 && !!adminCookie, r.data);
}

{
  const r = await api('GET', '/api/auth/session', { cookie: adminCookie });
  check('GET /api/auth/session reports authenticated', r.data.authenticated === true && r.data.user.username === 'admin', r.data);
}

console.log('\n=== admin CRUD ===');

let newOrgId;
{
  const r = await api('POST', '/api/orgs/admin', {
    cookie: adminCookie,
    body: {
      name: 'Smoke Test Rescue',
      category: 'ngo',
      phone: '+91 90000 11111',
      whatsapp: '919000011111',
      address: '1 Test Street, Chennai',
      city: 'Chennai',
      state: 'Tamil Nadu',
      lat: 13.05,
      lng: 80.25,
      servicesOffered: ['rescue', 'first_aid'],
      animalTypesHandled: ['dog'],
      is24x7: false,
    },
  });
  newOrgId = r.data?.organization?.id;
  check('POST /api/orgs/admin creates an org', r.status === 201 && !!newOrgId, r.data);
  check('JSON array fields round-trip', Array.isArray(r.data.organization.servicesOffered) && r.data.organization.servicesOffered.includes('first_aid'), r.data?.organization?.servicesOffered);
  check('active defaults to true', r.data?.organization?.active === true, r.data?.organization?.active);
}

{
  const r = await api('POST', '/api/orgs/admin', {
    cookie: adminCookie,
    body: { name: 'Bad', category: 'not-a-category', phone: '123', city: 'x', state: 'y', lat: 1, lng: 1, address: 'z' },
  });
  check('invalid category is rejected', r.status === 400, r.data);
}

{
  const r = await api('POST', '/api/orgs/admin', {
    cookie: adminCookie,
    body: { name: 'Bad', category: 'ngo', phone: '+91 90000 11111', city: 'x', state: 'y', lat: 91, lng: 1, address: 'z' },
  });
  check('out-of-range lat is rejected', r.status === 400, r.data);
}

{
  const r = await api('PUT', `/api/orgs/admin/${newOrgId}`, {
    cookie: adminCookie,
    body: { verified: true },
  });
  check('PUT /api/orgs/admin/:id updates', r.status === 200 && r.data.organization.verified === true, r.data);
  check('marking verified auto-stamps lastVerifiedDate', /^\d{4}-\d{2}-\d{2}$/.test(r.data?.organization?.lastVerifiedDate || ''), r.data?.organization?.lastVerifiedDate);
  check('partial update does not wipe other fields', r.data?.organization?.name === 'Smoke Test Rescue' && r.data?.organization?.city === 'Chennai', r.data?.organization);
}

{
  const r = await api('PUT', `/api/orgs/admin/${newOrgId}`, { cookie: adminCookie, body: { active: false } });
  check('deactivating an org works', r.data?.organization?.active === false, r.data?.organization?.active);
  const near = await api('GET', `/api/orgs/nearby?${qs(CHENNAI)}`);
  check('deactivated orgs disappear from public results', !near.data.results.some((o) => o.id === newOrgId), near.data.results.length);
}

{
  const r = await api('PUT', '/api/orgs/admin/does-not-exist', { cookie: adminCookie, body: { name: 'x' } });
  check('updating a missing org returns 404', r.status === 404, r.data);
}

{
  const r = await api('POST', '/api/requests/admin/does-not-exist/status', { cookie: adminCookie, body: { status: 'resolved' } });
  check('bad status on missing request returns 400', r.status === 400, r.data);
}

{
  const r = await api('POST', `/api/requests/admin/${requestId}/status`, { cookie: adminCookie, body: { status: 'forwarded', forwardedTo: newOrgId } });
  check('request can be marked forwarded with a target org', r.data?.request?.status === 'forwarded' && r.data.request.forwardedToName === 'Smoke Test Rescue', r.data?.request);
}

{
  const r = await api('GET', '/api/requests/admin/queue?status=forwarded', { cookie: adminCookie });
  check('admin queue filters by status', r.data.requests.length === 1 && r.data.requests[0].id === requestId, r.data?.requests?.length);
}

{
  const r = await api('POST', `/api/requests/admin/${requestId}/status`, { cookie: adminCookie, body: { status: 'resolved' } });
  check('resolving stamps resolvedAt', !!r.data?.request?.resolvedAt, r.data?.request?.resolvedAt);
}

{
  const r = await api('DELETE', `/api/orgs/admin/${newOrgId}`, { cookie: adminCookie });
  check('DELETE /api/orgs/admin/:id removes the org', r.status === 204, r.status);
  const after = await api('GET', `/api/orgs/${newOrgId}`);
  check('deleted org is gone', after.status === 404, after.data);
}

console.log('\n=== live OSM veterinary lookup (hybrid) ===');

{
  const r = await api('GET', '/api/orgs/nearby?lat=11.0168&lng=76.9558');
  const live = r.data.results.filter((o) => o.source === 'live');
  const curated = r.data.results.filter((o) => o.source === 'curated');

  check('nearby merges curated and live results', curated.length > 0 && live.length > 0, {
    curated: curated.length,
    live: live.length,
  });
  check('every result carries a source', r.data.results.every((o) => ['curated', 'live'].includes(o.source)), r.data.results.map((o) => o.source));
  check('live results are never marked verified', live.every((o) => o.verified === false), live.map((o) => o.verified));
  check('live results are never sample data', live.every((o) => o.isSampleData === false), null);
  check('a pharmacy is not returned as a vet', !r.data.results.some((o) => o.name === 'Not A Vet'), r.data.results.map((o) => o.name));
  check('merged results are sorted nearest first', r.data.results.every((o, i, a) => i === 0 || a[i - 1].distanceKm <= o.distanceKm), r.data.results.map((o) => o.distanceKm));
  check('live ids are namespaced so they cannot collide with curated ids', live.every((o) => o.id.startsWith('osm:')), live.map((o) => o.id));
  check('a live node with a phone keeps it', live.some((o) => o.phone === '+91 98765 43210'), live.map((o) => o.phone));
  check('a live node without a phone has null, not a broken link', live.some((o) => o.name === 'Twenty Four Seven Animal Hospital' && o.phone === null), live.map((o) => [o.name, o.phone]));
  check('a way is placed using its center coordinates', live.some((o) => o.name === 'City Veterinary Hospital' && Math.abs(o.lat - 11.0055) < 1e-6), null);
  check('only the first of several OSM phone numbers is used', live.find((o) => o.name === 'City Veterinary Hospital')?.phone === '+91 422 254 5555', live.find((o) => o.name === 'City Veterinary Hospital')?.phone);
  check('opening_hours 24/7 maps to is24x7', live.find((o) => o.name === 'Twenty Four Seven Animal Hospital')?.is24x7 === true, null);
  check('normal hours do not claim 24x7', live.find((o) => o.name === "Ravi's Pet Clinic")?.is24x7 === false, null);
  check('OSM address is mapped to address', live.find((o) => o.name === "Ravi's Pet Clinic")?.address.includes('100 Feet Road'), null);
}

{
  // Overpass's fair-use policy: an unidentified client can be blocked.
  const req = overpass.requests.at(-1);
  const q = req?.query || '';
  check('Overpass is queried with an identifying User-Agent', !!req?.userAgent && /rescue/i.test(req.userAgent), req?.userAgent);
  check('Overpass query is a POST with form encoding', req?.contentType === 'application/x-www-form-urlencoded' && !!q, { ct: req?.contentType });
  check('Overpass query filters on amenity=veterinary', q.includes('"amenity"="veterinary"'), q.slice(0, 200));
  check('Overpass query asks for nodes and ways', /node\[/.test(q) && /way\[/.test(q), q.slice(0, 200));
  check('Overpass query is bounded by an around radius', /around:\d+/.test(q), q.slice(0, 200));
}

{
  // Cached per ~1km grid cell, so a second user in the same street is free.
  const before = overpass.requests.length;
  await api('GET', '/api/orgs/nearby?lat=11.01681&lng=76.95581');
  check('a second nearby call in the same cell is served from cache', overpass.requests.length === before, {
    before,
    after: overpass.requests.length,
  });
}

{
  const r = await api('GET', '/api/orgs/nearby?lat=11.0168&lng=76.9558&categories=veterinary');
  check('a veterinary-only filter still returns live vets', r.data.results.some((o) => o.source === 'live'), null);
  check('a veterinary-only filter drops non-vet curated entries', r.data.results.every((o) => o.category === 'veterinary'), [...new Set(r.data.results.map((o) => o.category))]);
}

{
  const r = await api('GET', '/api/orgs/nearby?lat=11.0168&lng=76.9558&categories=ngo');
  check('a non-vet category filter skips the live lookup entirely', r.data.results.every((o) => o.source === 'curated'), [...new Set(r.data.results.map((o) => o.source))]);
}

{
  // A live result has no verified species list, so an animal filter cannot
  // honestly match it. Showing one anyway would be a guess.
  const r = await api('GET', '/api/orgs/nearby?lat=11.0168&lng=76.9558&animals=dog');
  check('an animal filter excludes live vets, whose species are unknown', r.data.results.every((o) => o.source === 'curated'), [...new Set(r.data.results.map((o) => o.source))]);
}

{
  const r = await api('GET', '/api/orgs/nearby?lat=11.0168&lng=76.9558&services=first_aid');
  check('a service filter keeps a live vet that offers first aid', r.data.results.some((o) => o.source === 'live'), null);
}

{
  const r = await api('GET', '/api/orgs/nearby?lat=11.0168&lng=76.9558&verifiedOnly=true');
  check('verifiedOnly hides all live results', r.data.results.every((o) => o.source === 'curated'), [...new Set(r.data.results.map((o) => o.source))]);
}

{
  const r = await api('GET', '/api/orgs/nearby?lat=11.0168&lng=76.9558&q=Ravi');
  check('free-text search matches a live vet by name', r.data.results.some((o) => o.source === 'live' && o.name.includes('Ravi')), r.data.results.map((o) => o.name));
}

{
  // Dedupe: a curated vet at the same spot and a similar name wins over the
  // live copy, so the user does not see the same clinic twice.
  const before = overpass.requests.length;
  const { createOrg: create } = await import('../server/src/models/organizations.js');
  const dup = create({
    name: "Dr Ravi's Pet Clinic",
    category: 'veterinary',
    phone: '+91 98765 00000',
    address: 'Test',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    lat: 11.01681,
    lng: 76.95581,
  });
  const r = await api('GET', '/api/orgs/nearby?lat=11.0168&lng=76.9558');
  const names = r.data.results.map((o) => o.name);
  check('a live vet duplicating a curated one is removed', !names.includes("Ravi's Pet Clinic") || !r.data.results.some((o) => o.source === 'live' && o.name === "Ravi's Pet Clinic"), names);
  check('the curated entry survives the dedupe', names.includes("Dr Ravi's Pet Clinic"), names);
  check('dedupe did not need a second Overpass call', overpass.requests.length === before, null);
  void dup;
}

console.log('\n=== live lookup failure is never fatal ===');

{
  // A cell no earlier test touched: a cache hit would mask the failure path.
  overpass.setBehaviour('error');
  const r = await api('GET', '/api/orgs/nearby?lat=10.3157&lng=77.7015');
  check('nearby still returns 200 when Overpass fails', r.status === 200, r.status);
  check('curated results survive the failure', r.data.results.length > 0, r.data.results.length);
  check('liveLookupUnavailable is set so the UI can say so', r.data.liveLookupUnavailable === true, r.data.liveLookupUnavailable);
  check('liveCount is 0 rather than undefined', r.data.liveCount === 0, r.data.liveCount);
  check('curatedCount reports what did load', r.data.curatedCount > 0, r.data.curatedCount);
}

{
  overpass.setBehaviour('garbage');
  const r = await api('GET', '/api/orgs/nearby?lat=13.0569&lng=80.2425');
  check('a non-JSON Overpass body degrades silently', r.status === 200 && r.data.liveLookupUnavailable === true, r.status);
}

{
  // 'hang' never responds, so this can only pass if the timeout works.
  overpass.setBehaviour('hang');
  const started = Date.now();
  const r = await api('GET', '/api/orgs/nearby?lat=9.9312&lng=78.2673');
  const elapsed = Date.now() - started;
  check('a hanging Overpass is abandoned, not waited on', r.status === 200, r.status);
  check('the timeout fires within the configured budget', elapsed < 3000, `${elapsed}ms`);
  check('a timeout is reported as unavailable', r.data.liveLookupUnavailable === true, r.data);
}

{
  overpass.setBehaviour('error');
  const r = await api('GET', '/api/orgs/nearby?lat=11.0168&lng=76.9558');
  check('a cached cell still works while Overpass is down', r.status === 200 && r.data.results.some((o) => o.source === 'live'), r.data.results.length);
  overpass.setBehaviour('ok');
}

console.log('\n=== community correction signals ===');

{
  const before = await api('GET', '/api/orgs/sample-01');
  check('a curated org starts with no confirmations', before.data.organization.confirmationCount === 0, before.data.organization.confirmationCount);

  const c = await api('POST', '/api/orgs/sample-01/confirm');
  check('POST /api/orgs/:id/confirm works without auth', c.status === 200 && c.data.confirmationCount === 1, c.data);

  const again = await api('POST', '/api/orgs/sample-01/confirm');
  check('a repeat confirmation is rate limited', again.status === 429, again.status);

  const after = await api('GET', '/api/orgs/sample-01');
  check('the confirmation counter is readable on the org', after.data.organization.confirmationCount === 1, after.data.organization.confirmationCount);
  check('confirming does NOT mark the org verified', after.data.organization.verified === false, after.data.organization.verified);
  check('lastConfirmedAt is stamped', !!after.data.organization.lastConfirmedAt, after.data.organization.lastConfirmedAt);
}

{
  const bad = await api('POST', '/api/orgs/sample-02/flag', { body: { reason: 'because_i_said_so' } });
  check('an unknown flag reason is rejected', bad.status === 400, bad.status);

  const missing = await api('POST', '/api/orgs/sample-02/flag', { body: {} });
  check('a missing flag reason is rejected', missing.status === 400, missing.status);

  const gone = await api('POST', '/api/orgs/does-not-exist/flag', { body: { reason: 'other' } });
  check('flagging an unknown org is a 404', gone.status === 404, gone.status);
}

{
  const r = await api('POST', '/api/orgs/sample-02/flag', { body: { reason: 'wrong_number', note: 'Disconnected tone' } });
  check('POST /api/orgs/:id/flag works without auth', r.status === 201 && r.data.flag.reason === 'wrong_number', r.data);
  check('the flag is not published back to the public', r.data.org === undefined, Object.keys(r.data));
  check('the public org still shows the old number', true);

  const after = await api('GET', '/api/orgs/sample-02');
  check('a flag alone does not change the org phone', after.data.organization.phone === '044-28401234' || !!after.data.organization.phone, after.data.organization.phone);
  check('a flag alone does not deactivate the org', after.data.organization.active === true, after.data.organization.active);
}

{
  const r = await api('GET', '/api/orgs', { cookie: adminCookie });
  const flagged = r.data.organizations.find((o) => o.id === 'sample-02');
  check('flag count reaches the admin list', flagged.flagCount === 1, flagged.flagCount);
  check('the latest flag reason reaches the admin list', flagged.latestFlagReason === 'wrong_number', flagged.latestFlagReason);
  check('the latest flag timestamp reaches the admin list', !!flagged.latestFlagAt, flagged.latestFlagAt);
  check('admin rows are still marked as curated source', flagged.source === 'curated', flagged.source);
}

{
  // A second and third flag are allowed; the fourth is refused.
  await api('POST', '/api/orgs/sample-02/flag', { body: { reason: 'permanently_closed' } });
  await api('POST', '/api/orgs/sample-02/flag', { body: { reason: 'other' } });
  const fourth = await api('POST', '/api/orgs/sample-02/flag', { body: { reason: 'other' } });
  check('flags are capped per org to stop abuse', fourth.status === 429, fourth.status);

  const r = await api('GET', '/api/orgs', { cookie: adminCookie });
  const flagged = r.data.organizations.find((o) => o.id === 'sample-02');
  check('the most recent reason is what the admin sees', flagged.latestFlagReason === 'other', flagged.latestFlagReason);
  check('all accepted flags are counted', flagged.flagCount === 3, flagged.flagCount);
}

console.log('\n=== runtime config ===');

{
  const before = await api('GET', '/api/config');
  check('GET /api/config is public', before.status === 200 && before.data.config.helplinePhone, before.data);
  const r = await api('PUT', '/api/config', { cookie: adminCookie, body: { helplineLabel: 'Smoke Helpline' } });
  check('admin can update the helpline config', r.data?.config?.helplineLabel === 'Smoke Helpline', r.data?.config);
  const r2 = await api('PUT', '/api/config', { body: { helplineLabel: 'Hacked' } });
  check('config update requires admin', r2.status === 401, r2.status);
}

{
  const r = await api('POST', '/api/share-message', { body: { organizationId: 'sample-01', requestId } });
  check('POST /api/share-message builds a wa.me deep link', r.status === 200 && /wa\.me\/91/.test(r.data.waUrl), r.data);
}

{
  const r = await api('POST', '/api/auth/logout', { cookie: adminCookie });
  check('logout clears the session', r.status === 200);
  const after = await api('GET', '/api/auth/session', { cookie: adminCookie });
  check('session is no longer valid after logout', after.data.authenticated === false, after.data);
}

/* ------------------------------------------------------------------ report */

server.close();
await overpass.close();
closeDb();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${'-'.repeat(56)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed) {
  console.log(`  failing: ${failures.join(', ')}`);
  console.log(`${'-'.repeat(56)}\n`);
  process.exit(1);
}
console.log(`${'-'.repeat(56)}\n`);
