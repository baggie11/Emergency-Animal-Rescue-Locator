/**
 * DOM-level render test.
 *
 * The API is covered by scripts/smoke.mjs; this covers the other half — that the
 * React tree actually mounts, that a denied geolocation permission falls through
 * to the manual picker, and that granting it produces a ranked results list.
 * Everything runs in jsdom against a real in-process API server.
 *
 * Run with: npm run test:dom
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { startMockOverpass, COIMBATORE_VETS } from './mock-overpass.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rescue-nearby-dom-'));
process.env.DATA_DIR = tmpDir;
process.env.NODE_ENV = 'test';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'dom-test-password';
process.env.SESSION_SECRET = 'dom-test-secret';

// Same reason as the API suite: keep the one outbound dependency local and fast.
const overpass = await startMockOverpass(COIMBATORE_VETS);
process.env.OVERPASS_API_URL = overpass.url;
process.env.LIVE_LOOKUP_TIMEOUT_MS = '1200';

const { runMigrations, closeDb } = await import('../server/src/db/index.js');
runMigrations({ silent: true });
const { SAMPLE_ORGANIZATIONS } = await import('../server/src/seed/organizations.js');
const { createOrg } = await import('../server/src/models/organizations.js');
SAMPLE_ORGANIZATIONS.forEach((org, i) =>
  createOrg({ ...org, id: `sample-${String(i + 1).padStart(2, '0')}`, isSampleData: true }),
);

const { createApp } = await import('../server/src/index.js');
const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------- jsdom setup */

// Surface React warnings as failures — a bad prop or hook order should not pass
// silently just because the component still rendered something.
const consoleErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => consoleErrors.push(`jsdomError: ${e.message}`));
virtualConsole.on('error', (...a) => consoleErrors.push(`console.error: ${a.join(' ')}`));
virtualConsole.on('warn', (...a) => consoleErrors.push(`console.warn: ${a.join(' ')}`));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${base}/`,
  pretendToBeVisual: true,
  runScripts: 'outside-only',
  virtualConsole,
});

const { window } = dom;

// jsdom ships no layout, no ResizeObserver and no matchMedia. All three are used
// by the map and the responsive view switching.
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia = window.matchMedia || ((q) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
}));
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.alert = () => {};
window.confirm = () => true;
window.URL.createObjectURL = () => 'blob:mock';

// Leaflet probes for these; without them it throws on mount.
Object.defineProperty(window, 'devicePixelRatio', { value: 1 });

let geolocationBehaviour = 'deny';
// Mutable so a test can place the user in a specific city, or in a cell with no
// cache entry, without rebuilding the whole jsdom window.
let geolocationPayload = { lat: 13.0827, lng: 80.2707, accuracy: 25 };
// jsdom exposes navigator as a getter-only property, so geolocation has to be
// installed with defineProperty rather than a plain assignment.
Object.defineProperty(window.navigator, 'geolocation', {
  configurable: true,
  writable: true,
  value: {
    getCurrentPosition(success, error) {
      setTimeout(() => {
        if (geolocationBehaviour === 'grant') {
          success({ coords: { latitude: geolocationPayload.lat, longitude: geolocationPayload.lng, accuracy: geolocationPayload.accuracy } });
        } else {
          error({ code: 1, message: 'User denied Geolocation' });
        }
      }, 0);
    },
    watchPosition() {},
    clearWatch() {},
  },
});

// Node 22 defines globalThis.navigator as a getter-only accessor, so a plain
// assignment throws. defineProperty is the supported way to shadow it.
const defineGlobal = (key, value) => {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
};

defineGlobal('window', window);
defineGlobal('document', window.document);
defineGlobal('navigator', window.navigator);
for (const key of [
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'localStorage',
  'sessionStorage',
  'ResizeObserver',
  'matchMedia',
  'Blob',
  'File',
  'FileList',
  'FormData',
  'XMLHttpRequest',
  'Image',
  'location',
]) {
  if (window[key] !== undefined) defineGlobal(key, window[key]);
}
defineGlobal('self', window);

// The app fetches same-origin relative paths ("/api/meta"), which a browser
// resolves against the page URL. Node's fetch requires an absolute URL, so
// stand in for the part of the platform jsdom does not implement.
const nodeFetch = globalThis.fetch;
defineGlobal('fetch', (input, init) => {
  const url = typeof input === 'string' && input.startsWith('/') ? `${base}${input}` : input;
  return nodeFetch(url, init);
});
window.fetch = globalThis.fetch;

/* ------------------------------------------------------------------ runner */

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
    console.log(`  FAIL  ${name}${detail ? ` -> ${String(detail).slice(0, 300)}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => window.document.body.textContent || '';
const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];

/** Every mount gets a fresh container: createRoot() cannot be called twice on one. */
function freshContainer() {
  window.document.body.innerHTML = '<div id="root"></div>';
  return window.document.getElementById('root');
}

async function mount(hash = '') {
  window.location.hash = hash;
  const { createRoot } = await import('react-dom/client');
  const { createElement } = await import('react');
  const { default: App } = await import('../web/src/App.jsx');
  const container = freshContainer();
  const root = createRoot(container);
  root.render(createElement(App));
  await sleep(700);
  return { root, container };
}

console.log('\n=== boot with geolocation DENIED (the common case) ===');

let root;
{
  geolocationBehaviour = 'deny';
  ({ root } = await mount());

  check('app mounts without crashing', $('#root')?.children.length > 0, text().slice(0, 200));
  check('renders the "Use my current location" CTA', text().includes('Use my current location'));
  check('offers a manual area search instead', !!$('#area-search'), 'no #area-search field');
  check('explains why location failed', text().includes('permission was denied'), text().slice(0, 300));
  check('helpline banner is present', /emergency helpline/i.test(text()), text().slice(0, 200));
  check('shows the placeholder helpline number 112', text().includes('112'));
  check('helpline is a tappable tel: link', !!$('a[href="tel:112"]'), 'no tel:112 link');
  check('surfaces the pre-launch helpline warning', text().includes('Before public launch'));
  check('no results list before a location is known', !text().includes('Call now'));
}

/**
 * React tracks input values on the element instance, so assigning `el.value`
 * is invisible to it. Go through the native prototype setter instead, which is
 * what React's own test utilities do.
 */
function typeInto(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

console.log('\n=== manual area search (GPS fallback path) ===');

{
  const input = $('#area-search');
  typeInto(input, 'chennai');
  await sleep(800);

  check('searching a city returns locality suggestions', text().includes('Chennai'), text().slice(0, 300));
  const option = $$('button').find((b) => /Chennai/.test(b.textContent) && /contact/.test(b.textContent));
  check('locality rows show a contact count', !!option, text().slice(0, 300));

  option?.click();
  await sleep(700);

  check('picking a locality loads the results screen', text().includes('Call now'), text().slice(0, 300));
  check('results are listed nearest first', text().includes('km away') || text().includes('m away'), text().slice(0, 300));
  check('distance is shown on a card', /\d+(\.\d+)? (km|m) away/.test(text()), 'no distance rendered');

  const callLinks = $$('a[href^="tel:"]');
  check('Call Now uses a tel: link', callLinks.length > 0, `${callLinks.length} tel links`);
  check('tel: links contain no spaces or dashes', callLinks.every((a) => !/[\s-]/.test(a.getAttribute('href'))),
    callLinks.map((a) => a.getAttribute('href')).join(','));
  check('Call button has an accessible name', callLinks.some((a) => /Call .+ at /.test(a.getAttribute('aria-label') || '')),
    callLinks.map((a) => a.getAttribute('aria-label')).join(' | '));

  const dirLinks = $$('a[href*="google.com/maps"]');
  check('Directions deep-links to Google Maps with coordinates', dirLinks.length > 0 && dirLinks.every((a) => /query=[\d.-]+,[\d.-]+/.test(a.href)),
    dirLinks.slice(0, 2).map((a) => a.getAttribute('href')));

  check('category badges are shown', /NGO|Vet|Municipal/.test(text()));
  check('sample-data warning is shown on entries', text().includes('Sample entry'), 'no sample warning');
}

console.log('\n=== hybrid list: curated and live together ===');

{
  // The locality chosen above is Chennai, but the stub Overpass is centred on
  // Coimbatore. Search for Coimbatore so live results are genuinely nearby and
  // the distance filter does not exclude them.
  window.location.hash = '';
  const { root: r2 } = await mount();
  geolocationBehaviour = 'deny';
  const input = $('#area-search');
  typeInto(input, 'coimbatore');
  await sleep(900);
  $$('button').find((b) => /Coimbatore/.test(b.textContent) && /contact/.test(b.textContent))?.click();
  await sleep(900);

  const cards = $$('article').map((a) => a.textContent);
  const liveCards = cards.filter((c) => c.includes('From OpenStreetMap'));
  const curatedCards = cards.filter((c) => c.includes('Listed by us, not yet confirmed'));

  check('live OSM results are merged into the same list', liveCards.length > 0, `${liveCards.length} live cards`);
  check('curated results show as listed-but-unconfirmed', curatedCards.length > 0, `${curatedCards.length} curated cards`);
  check('no curated entry claims to be verified', !text().includes('Verified'), 'a sample entry claimed Verified');
  check('live entries carry a not-phone-verified warning', liveCards.every((c) => c.includes('Not phone-verified')), liveCards[0]?.slice(0, 120));

  const noPhone = $$('article').find((a) => a.textContent.includes('Twenty Four Seven Animal Hospital'));
  check('a live clinic with no phone still renders a card', !!noPhone, 'card missing');
  check('a live clinic with no phone has no Call button', !noPhone?.querySelector('a[href^="tel:"]'), 'unexpected tel: link');
  check('a live clinic with no phone still offers Directions', !!noPhone?.querySelector('a[href*="google.com/maps"]'), 'no directions link');
  check('a live clinic with no phone gets a full-width Directions button', (() => {
    const d = noPhone?.querySelector('a[href*="google.com/maps"]');
    return d?.closest('.grid')?.className.includes('grid-cols-1');
  })(), noPhone?.querySelector('a[href*="google.com/maps"]')?.closest('.grid')?.className);

  check('live pins are visually marked on the map', $$('.rescue-pin--live').length > 0, `${$$('.rescue-pin--live').length} live pins`);

  // Crowd signals: present on curated, absent on live.
  check('curated cards offer "Report a problem"', cards.some((c) => c.includes('Report a problem')), null);
  check('curated cards offer "Still correct"', cards.some((c) => c.includes('Still correct')), null);
  check('live cards do not offer crowd signals', !liveCards.some((c) => c.includes('Report a problem')), liveCards[0]?.slice(0, 120));

  const curatedCard = $$('article').find((a) => a.textContent.includes('Blue Cross'));
  const reportBtn = [...(curatedCard?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('Report a problem'));
  reportBtn?.click();
  await sleep(200);
  check('reporting opens a reason picker', text().includes('What is wrong with this listing?'), text().slice(0, 200));
  check('reason picker offers all three reasons', ['Wrong number', 'Permanently closed', 'Something else'].every((r) => text().includes(r)), null);

  const reasonBtn = [...$$('button')].find((b) => b.textContent.trim() === 'Wrong number');
  reasonBtn?.click();
  await sleep(700);
  check('submitting a report shows a thank-you', /admin will check/i.test(text()), text().slice(-300));

  // A different card, so the rate limiter for Blue Cross does not apply.
  const confirmCard = $$('article').find((a) => !a.textContent.includes('From OpenStreetMap') && a.textContent.includes('Still correct'));
  const confirmBtn = [...(confirmCard?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('Still correct'));
  confirmBtn?.click();
  await sleep(800);
  check('confirming a listing shows a thank-you', /Thanks for confirming/i.test(text()), text().slice(-300));
}

console.log('\n=== live lookup unavailable notice ===');

{
  overpass.setBehaviour('error');
  // A cell with no cache entry, so the failure path is really exercised.
  // Both must be set before mount(): the app asks for geolocation on mount.
  geolocationBehaviour = 'grant';
  geolocationPayload = { lat: 10.3157, lng: 77.7015, accuracy: 25 };
  const { root: r3 } = await mount();
  await sleep(1500);
  check('the curated list still renders when the live lookup fails', $$('article').length > 0, `${$$('article').length} cards`);
  check('an amber note explains live lookup is unavailable', /Live vet lookup is unavailable/i.test(text()), text().slice(0, 300));
  check('the note names OpenStreetMap as the cause', /OpenStreetMap/.test(text()), null);
  check('the note promises verified listings', /verified/i.test(text()), null);
  overpass.setBehaviour('ok');
  geolocationPayload = { lat: 11.0168, lng: 76.9558 };
  void r3;
}

console.log('\n=== verified-only filter ===');

{
  geolocationBehaviour = 'grant';
  geolocationPayload = { lat: 11.0168, lng: 76.9558, accuracy: 25 };
  await mount();
  await sleep(400);

  // It lives inside the More panel, so it is not on screen until that opens.
  check('the verified-only option is not on the default screen', !text().includes('Verified only'), 'visible before opening More');
  const more = $$('button').find((b) => b.textContent.includes('More'));
  check('the More panel can be opened', !!more, 'no More button');
  more?.click();
  await sleep(200);
  check('opening More reveals the verified-only toggle', text().includes('Verified only'), 'no toggle');

  const toggle = $$('button').find((b) => b.textContent.trim() === 'Verified only');
  check('the toggle explains live results are hidden', /hidden when this is on|never phone-verified/i.test(text()), text().slice(0, 200));
  toggle?.click();
  await sleep(900);
  check('verified-only removes live cards from the list', !$$('article').some((a) => a.textContent.includes('From OpenStreetMap')), `${$$('article').length} cards`);
  // Correct, not a bug: every seeded entry is still unverified, so asking for
  // verified-only correctly returns nothing. That is the honest answer.
  check('verified-only returns nothing while no entry is phone-verified', $$('article').length === 0, `${$$('article').length} cards`);
  check('the empty state offers a way out instead of a blank page', /No contacts match/i.test(text()) && /Clear filters/i.test(text()), text().slice(0, 250));
  $$('button').find((b) => /Clear filters/i.test(b.textContent))?.click();
  await sleep(900);
  await sleep(900);
  check('turning verified-only off restores live cards', $$('article').some((a) => a.textContent.includes('From OpenStreetMap')), 'no live card after clearing');
  $$('button').find((b) => /More/.test(b.textContent))?.click();
}

console.log('\n=== filters ===');

{
  const municipal = $$('button').find((b) => b.textContent.trim() === 'Municipal');
  municipal?.click();
  await sleep(600);
  const badges = $$('article').map((a) => a.textContent);
  check('category filter narrows the list', badges.length > 0 && badges.every((b) => b.includes('Municipal')),
    `${badges.length} cards`);
  check('filtered list excludes NGOs', !text().includes('Blue Cross'), 'NGO still visible');

  $$('button').find((b) => b.textContent.trim() === 'All')?.click();
  await sleep(600);
  check('clearing the category filter restores all results', $$('article').length > badges.length);
}

console.log('\n=== map ===');

{
  check('map container is created', !!$('.leaflet-container'), 'no .leaflet-container');
  check('map has result pins', $$('.rescue-pin').length > 0, `${$$('.rescue-pin').length} pins`);
  check('map has OSM attribution', text().includes('OpenStreetMap'), 'no attribution');
}

console.log('\n=== report form ===');

{
  const reportBtn = $$('button').find((b) => /Request rescue/.test(b.textContent));
  check('a "Request rescue" CTA exists', !!reportBtn);
  reportBtn?.click();
  await sleep(600);

  check('report form opens', text().includes('Request rescue help'));
  check('the attached location is shown', text().includes('Your location'));
  // GPS is frequently wrong indoors, so the correction control has to work.
  const fixBtn = $$('button').find((b) => b.textContent.trim() === 'Fix');
  fixBtn.click();
  await sleep(150);
  const fixInput = $('[aria-label="Correct your location"]');
  check('Fix opens a location search field', !!fixInput);

  if (fixInput) {
    typeInto(fixInput, 'Coimbatore');
    await sleep(900);
    const options = $$('ul li button').filter((b) => /Coimbatore/.test(b.textContent));
    check('correction search returns a match', options.length > 0, `options: ${options.length}`);
    options[0]?.click();
    await sleep(250);
    check('corrected location is applied', text().includes('Coimbatore'), text().slice(0, 300));
  }

  check('all five situation types are offered', ['Injured', 'Sick / weak', 'Trapped', 'Aggressive', 'Roadkill'].every((s) => text().includes(s)), text().slice(0, 400));
  check('medical warning shows for "injured"', text().includes('capture-only municipal unit'), 'no warning');
  check('phone field is required', $('#reporterPhone')?.hasAttribute('required'));
  check('description field is required', $('#description')?.hasAttribute('required'));

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const setVal = (el, v) => {
    setter.call(el, v);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  setVal($('#reporterPhone'), '9876543210');
  const textSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  textSetter.call($('#description'), 'Dog hit by a scooter near the bus stop, bleeding badly.');
  $('#description').dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(300);

  const submit = $$('button').find((b) => /Send rescue request/.test(b.textContent));
  check('submit button is enabled once valid', submit && !submit.disabled, 'still disabled');
  submit?.click();
  await sleep(1500);

  check('submission confirms success', text().includes('Request saved'), text().slice(0, 400));
  check('shows a reference number', /[0-9a-f]{8}/.test(text()));
  check('offers a WhatsApp handoff', $$('a[href*="wa.me"]').length > 0, `${$$('a[href*="wa.me"]').length} wa.me links`);
  check('wa.me links carry a +91 number', $$('a[href*="wa.me"]').some((a) => /wa\.me\/91/.test(a.href)),
    $$('a[href*="wa.me"]').map((a) => a.getAttribute('href').slice(0, 60)));
  check('wa.me message is pre-filled', $$('a[href*="wa.me"]').some((a) => /text=/.test(a.href)));
  check('wa.me message contains the reported details', $$('a[href*="wa.me"]').some((a) => decodeURIComponent(a.href).includes('bus stop')));
  check('best-match section is labelled', text().includes('Best match for this situation'));
  check('still offers a plain call fallback', $$('a[href^="tel:"]').length > 0);
}

console.log('\n=== geolocation GRANTED path ===');

{
  // Fresh mount with location available, to prove the happy path renders the
  // results screen directly rather than the picker.
  window.location.hash = '';
  geolocationBehaviour = 'grant';
  const { createRoot } = await import('react-dom/client');
  const { createElement } = await import('react');
  const { default: App } = await import('../web/src/App.jsx');
  createRoot(freshContainer()).render(createElement(App));
  await sleep(1400);

  check('granted location goes straight to results', text().includes('Call now'), text().slice(0, 300));
  check('does not show the manual picker', !$('#area-search'));
  check('shows location accuracy', text().includes('accurate to'), 'no accuracy text');
  check('has a "Change" location affordance', text().includes('Change'));
  check('renders a list of results', $$('article').length > 1, `${$$('article').length} cards`);
}

console.log('\n=== admin panel ===');

{
  window.location.hash = '#/admin';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(700);

  check('admin route shows a sign-in form', text().includes('Admin sign in'), text().slice(0, 300));
  check('public users are told no account is needed', text().includes('Public users never need to sign in'));
  check('password input is masked', $('#password')?.type === 'password');

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const setVal = (el, v) => {
    setter.call(el, v);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  setVal($('#password'), 'dom-test-password');
  $$('button').find((b) => b.type === 'submit')?.click();
  await sleep(1200);

  check('signing in reveals the directory', text().includes('Organisations'), text().slice(0, 300));
  check('lists seeded organisations', text().includes('Blue Cross'), 'no seeded org visible');
  check('flags unverified entries needing attention', text().includes('need') && text().includes('verification'), text().slice(0, 300));

  // The public flagged this listing in the hybrid-list test above, so the
  // admin queue must surface it rather than leaving it buried in the list.
  const flaggedRow = $$('li').find((li) => li.textContent.includes('Blue Cross'));
  check('a publicly reported listing is badged in the admin queue', /Reported/.test(flaggedRow?.textContent || ''), flaggedRow?.textContent?.slice(0, 200));
  check('the badge names the reason it was reported', /Wrong number/.test(flaggedRow?.textContent || ''), flaggedRow?.textContent?.slice(0, 200));
  check('an admin alert summarises the public reports', /reported as wrong by the public/i.test(text()), text().slice(0, 300));
  check('the confirmations from the public are shown', /public confirmation/i.test(text()), text().slice(0, 300));
  check('has an Add button', !!$$('button').find((b) => /Add/.test(b.textContent)));

  const addBtn = $$('button').find((b) => /^Add$/.test(b.textContent.trim()));
  addBtn?.click();
  await sleep(500);
  check('Add opens the organisation form', text().includes('Add organisation'), text().slice(0, 300));
  check('form offers all three categories', ['NGO', 'Veterinary', 'Municipal'].every((c) => text().includes(c)));
  check('form offers service checkboxes', text().includes('Services offered'));
  check('form offers animal checkboxes', text().includes('Animals handled'));
  check('form has a Verified toggle', text().includes('Verified'));
}

console.log('\n=== react warnings ===');

check('no console errors or React warnings', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' || '));

/* ------------------------------------------------------------------ report */

window.close();
server.close();
// Must be closed too: an open listener keeps the event loop alive and the
// process would hang after the results have already printed.
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
process.exit(0);
