# Rescue Nearby

Find the nearest animal rescue NGO, veterinary hospital or municipal animal
control when you find an animal in distress. Open it, see who's closest, tap to
call or navigate. No account, no app install, no API keys.

Built mobile-first because the user is usually standing on a street, holding a
phone one-handed, with a bleeding animal at their feet.

> **The seeded directory is placeholder data.** Every phone number in it is
> illustrative and must be verified by phone before this is shown to the public.
> See [What still needs real-world verification](#what-still-needs-real-world-verification).

---

## Quick start

```bash
npm install          # installs server + web workspaces
npm run seed         # creates data/rescue.db and loads sample organisations
npm run dev          # API on :4000, Vite dev server on :5173
```

Open http://localhost:5173.

To run it the way production does (one process serving API + built SPA):

```bash
npm run build
npm start            # http://localhost:4000
```

The admin panel is at **/admin** (default credentials `admin` / `admin123` —
the server prints a warning on every boot until you change it).

### Verifying it works

```bash
npm test             # 57 API checks + 59 DOM render checks
```

`npm test` boots the real server against a throwaway database and exercises
every endpoint and every major screen, so a green run means the whole stack
works, not just the parts you poked at.

---

## Stack, and why

| Concern | Choice | Reason |
| --- | --- | --- |
| Frontend | React 18 + Vite + Tailwind v4 | Fast builds, tiny output (12 KB CSS gzipped) |
| Map | Leaflet + OpenStreetMap tiles | **No API key, no billing setup** — swap for Google Maps later |
| Backend | Node + Express | Small, boring, one process |
| Database | SQLite via `better-sqlite3` | Zero native build (prebuilt binaries), free, and the geo query is a few lines of SQL |
| Auth | scrypt + signed httpOnly cookie | Dependency-free, adequate for a single shared admin account |

**Total install: 5 runtime dependencies.** No cloud account is required to run
this end to end.

The brief suggested Postgres + PostGIS or Supabase. Both are reasonable; SQLite
ships faster because there is nothing to provision, nothing to bill, and no
credentials to leak. The one thing you lose is an indexed nearest-neighbour
query. At this directory size (hundreds of rows, not millions) a Haversine
expression over the whole table is sub-millisecond, and there is a documented
migration path below.

### Moving to PostGIS later

1. Add a geometry column and a GiST index:

   ```sql
   ALTER TABLE organizations
     ADD COLUMN geom geometry(Point, 4326);
   UPDATE organizations
     SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326);
   CREATE INDEX idx_organizations_geom ON organizations USING GIST (geom);
   ```

2. In `server/src/models/organizations.js`, swap `SQL_DISTANCE_KM` for
   `ST_Distance(geom, ST_SetSRID(ST_MakePoint(?, ?), 4326)) / 1000` and
   `ORDER BY geom <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)` for the index-backed
   KNN ordering.

Everything else — routes, controllers, UI — is unaffected.

---

## How it works

```
User opens page
  └─ asks for GPS (denied? → manual city search, same result screen)
       └─ GET /api/orgs/nearby?lat&lng&filters
            ├─ curated half  → SQLite, Haversine in SQL
            ├─ live half     → Overpass (OSM vets), JS-filtered
            │                   both run in parallel, then merged
            └─ dedupe + sort nearest-first
                 └─ scrollable list  +  Leaflet map, same results
                      ├─ Call Now      → tel: link (omitted if no phone)
                      ├─ Directions   → Google/Apple Maps deep link
                      └─ Report / Still correct  → public correction signal
```

**No login is required for anything a member of the public would do.** Only the
admin panel is behind a password.

### Why the directory is hybrid

The app mixes two sources on purpose, because one alone leaves a real gap.

| | Source | Why |
|---|---|---|
| NGOs, municipal units | **Hand-curated** | Informal and largely invisible online. No API covers them, so someone has to call and check. |
| Veterinary clinics | **Live from OpenStreetMap** | Registered, mapped businesses. Hand-entering them per city does not scale and goes stale within months. |

So any city gets vet coverage with no manual data entry, while the entries that
genuinely need a human to check stay human-checked.

Every result carries `source: "curated" | "live"`, and the UI is explicit about
what that means:

| State | Badge | Meaning |
|---|---|---|
| Curated + `verified` | green **Verified** | Someone called the number. |
| Curated, unverified | grey **Listed by us, not yet confirmed** | We put it here; nobody has phoned it. |
| Live OSM | amber **From OpenStreetMap** | Mapped by contributors. Never phone-verified. |

The middle row is the one that keeps this honest. Seed data is fabricated, so
presenting it as "Verified" would be a lie that ends with someone driving to a
number that does not exist.

**Dedupe.** When a live clinic lands within 150m of a curated vet with a
similar name, the curated one wins and the live copy is dropped — otherwise the
same clinic appears twice in the list. Live ids are namespaced `osm:<type>/<id>`
so they can never collide with a curated id.

**Filters over live results.** OSM only says a place is a veterinary clinic, so
the app only claims what OSM actually knows:

- Category, situation, 24x7 and free-text filters apply to live results.
- `services` matches because a clinic genuinely does first aid.
- `animals` **excludes** live results, because OSM does not record which species
  a clinic treats. Showing one for "dog" would be a guess.
- `Verified only` excludes them entirely, since a live result is never verified.

**When Overpass is down**, the request is abandoned after
`LIVE_LOOKUP_TIMEOUT_MS`, the curated list is returned unchanged, and the
response sets `liveLookupUnavailable: true`. The UI shows an amber note saying
live vet lookup is unavailable — a footnote, not an error, because the curated
results are still perfectly usable.

**Not hammering a free service.** Results are cached per ~1km grid cell for
24h, and concurrent requests for the same cell share one in-flight fetch. For
real traffic, run your own Overpass instance and point `OVERPASS_API_URL` at it.

### The community correction loop

Every public card carries **Report a problem** (wrong number / permanently
closed / something else) and **Still correct**.

Neither one edits anything, and that is the point. A flag never hides a listing —
one anonymous tap should not be able to remove a rescue service from the app.
Instead flags move the entry to the top of the admin queue with the reason
attached, so a human decides. Confirmations bump a counter and a timestamp.

Both are unauthenticated by design (a passer-by with no account should be able
to say "this number is dead") and rate limited in exchange: one confirmation and
three flags per IP per organisation, in memory, resetting on restart. A
multi-instance deployment would need that moved into the database.

### The two filters that matter most

Not every organisation can help with every situation. A municipal animal
control unit typically removes strays but has no medical capability, so sending
an injured dog there wastes the one hour that matters.

- The **Situation** filter translates to required services
  (`injured` → `first_aid | ambulance | rescue`,
  `deceased` → `cremation | capture_only`) and filters the list.
- The **Report** form ranks organisations by *fit*: an org offering `ambulance`
  for an injured animal outranks one that only offers `rescue`, regardless of
  distance. A capture-only unit is still listed, but never as "best match".

The mapping lives in exactly two places, both short and both commented:
`server/src/lib/taxonomy.js` (source of truth) and `SITUATION_SERVICES` in
`web/src/App.jsx` (mirror for client-side filtering).

### "Auto-forwarding" a rescue request

Requests are stored in the database, then the user is shown the best-matching
organisations with a **pre-filled WhatsApp message** — situation, animal type,
coordinates, a map link, their description, their callback number, the photo URL
and a reference id. They tap through to `wa.me`, review, and press send.

This is deliberate rather than a shortcut. It needs no paid messaging API and no
WhatsApp Business account, and — more importantly — a human confirms before a
rescue team is dispatched. Silently paging a volunteer team from a web form is
how you get a team driving to the wrong street at 2am.

The message text is built server-side (`buildWhatsAppMessage` in
`server/src/routes/requests.js`) so the admin preview and the real send can never
drift apart.

### Offline behaviour

The last successful results list is cached in `localStorage` for 7 days. On a
cold load with no connection, the app renders the saved list and says so, rather
than showing an error page. The GPS-denied path is treated as a first-class
route, not an error — people are often indoors or on locked-down browsers.

---

## Project layout

```
server/
  src/
    index.js                 Express app, static SPA hosting, error shape
    config.js                Env parsing + loud dev warnings
    db/index.js              SQLite connection + migration runner
    migrations/              001_init.sql, 002_live_vets_and_community_signals.sql
    lib/
      taxonomy.js            Controlled vocabularies (single source of truth)
      geo.js                 Haversine, in JS and as a SQL fragment
      liveVetLookup.js       Overpass query, grid cache, normalise, dedupe
      auth.js                scrypt hashing, signed session cookies
      http.js                Validation helpers + HttpError
    models/                  organisations, orgFlags, rescueRequests, appConfig
    routes/                  orgs, requests, upload, auth, meta
    seed/organizations.js    Sample Chennai/Tamil Nadu directory
    scripts/                 migrate, seed, reset, makePassword
web/
  src/
    App.jsx                  Home screen, filters, routing
    lib/api.js               fetch wrapper, offline cache, upload progress
    lib/format.js            Distance/tel/maps/WhatsApp formatting
    lib/flags.js             Flag reason labels (mirror of the server list)
    hooks/                   useAppData (geolocation + bootstrap), useAsync
    components/              HelplineBanner, LocationPicker, Filters, OrgCard,
                             RescueMap, RescuePin, ReportForm, AdminPanel, icons
scripts/
  smoke.mjs                  API test suite (118 checks)
  dom-smoke.mjs              jsdom render test suite (95 checks)
  mock-overpass.mjs          Local Overpass stub, so tests never touch the network
  jsx-loader.mjs             esbuild loader so tests import real .jsx sources
```

---

## Admin panel

`/admin` — password only, no user accounts to manage.

- **Organisations** — full CRUD. The list is sorted so entries needing attention
  float to the top, with **publicly reported listings first**, then unverified,
  then any not re-checked in 180 days, then deactivated. Ticking *Verified*
  stamps today's date automatically. A listing someone has reported carries a
  red badge showing the reason ("Wrong number", "Permanently closed"), and
  confirmations from the public are counted alongside the verification date.
- **Rescue requests** — the queue of submitted reports with status transitions
  (`new → forwarded → resolved`, plus `declined`) and a record of which
  organisation each was forwarded to.
- **Settings** — the helpline number and disclaimers. Editable at runtime so a
  wrong number can be corrected without a redeploy.

## Configuration

All env vars are documented in [`.env.example`](./.env.example). The two that
matter before going live:

```bash
# Required: otherwise admin sessions silently drop on every restart
SESSION_SECRET=<random 32-byte hex>

# Required: replaces the admin123 development default
ADMIN_PASSWORD_SCRYPT=<output of: npm run make-password --workspace server -- "your password">
```

The live veterinary lookup is configured with these:

| Variable | Default | Notes |
|---|---|---|
| `LIVE_LOOKUP_ENABLED` | `true` | `false` serves only the curated directory. Nothing else breaks. |
| `OVERPASS_API_URL` | `overpass-api.de` | Point this at your own instance for real traffic. |
| `LIVE_LOOKUP_CACHE_TTL_HOURS` | `24` | How stale a grid cell's results may get. |
| `LIVE_LOOKUP_RADIUS_KM` | `10` | Ceiling for the live search. A user can request less. |
| `LIVE_LOOKUP_TIMEOUT_MS` | `3000` | Hard cap; beyond this the curated list is returned alone. |
| `OVERPASS_USER_AGENT` | app identity | Set your own contact; Overpass asks clients to identify themselves. |

When running under Docker Compose, all of these must be listed in the service's
`environment:` block — Compose only passes through variables it names, so values
in `.env` are otherwise ignored inside the container. `docker-compose.yml`
already forwards them.

---

## Deployment

The server serves the built SPA, so the whole app is a single Node process plus
a persistent disk volume. That works on Render, Railway, Fly.io, or a VPS. It
does **not** work on most serverless platforms, because those have a
read-only/ephemeral filesystem and SQLite needs neither.

### Docker (recommended)

One process, one volume, no cloud account.

```bash
cp .env.example .env

# generate a session secret
openssl rand -hex 32                       # -> SESSION_SECRET in .env

# generate the admin password hash.
# This uses `docker build`/`docker run`, NOT `docker compose run`: compose
# refuses to start anything until ADMIN_PASSWORD_SCRYPT is set, so asking it to
# generate the value it demands would be circular.
docker build -t rescue-nearby:1.0.0 .
docker run --rm rescue-nearby:1.0.0 \
  node server/src/scripts/makePassword.js "your strong password"
                                              # -> ADMIN_PASSWORD_SCRYPT in .env

docker compose up -d                        # http://localhost:4000
```

The schema is created automatically on first boot. The directory starts empty,
so for a demo load the sample data:

```bash
docker compose run --rm app npm run seed
```

`compose` deliberately refuses to start without `SESSION_SECRET` and
`ADMIN_PASSWORD_SCRYPT` rather than falling back to a guessable admin password.
`docker compose down` keeps the data volume; `down -v` destroys it.

### Render / Railway / Fly.io

```
Build command:  npm install && npm run build
Start command:  npm start
```

Mount a persistent volume and point `DATA_DIR` at it. On Fly:

```toml
[[mounts]]
  source = "rescue_data"
  destination = "/data"

[env]
  DATA_DIR = "/data"
```

**Vercel / Netlify + separate API** — deploy `web/` as a static site and
`server/` as a separate service, then:

```bash
# at frontend build time
VITE_API_BASE=https://api.example.org
```

and add the frontend origin to the API's `CORS_ORIGINS`. The API client prefixes
every request with `VITE_API_BASE` and rewrites the returned photo URL to the
same origin, so nothing else changes. Leave it unset for the single-process
deployment above.

After deploying, remember the database starts empty:

```bash
npm run migrate && npm run seed   # seed only for a demo; skip for a real directory
```

---

## What still needs real-world verification

This is the part that decides whether the app is useful or actively harmful.
Someone standing next to an injured animal will call the first number this app
shows them. A wrong number wastes minutes they may not have.

### 1. Every seeded phone number is fabricated

The 16 organisations in `server/src/seed/organizations.js` are **illustrative**.
They model a realistic mix of NGO / veterinary / municipal, with plausible
Chennai-area addresses and real neighbourhood coordinates, but **the numbers are
made up.** They were not scraped from any registry.

Before public launch, for each entry:

1. Call the number. Confirm a human answers and that they handle the case type
   the listing claims.
2. Confirm the address and operating hours.
3. Correct the entry in `/admin`, tick **Verified**, and clear the *Sample* flag
   by editing the row.
4. Once the whole directory is verified, set `isSampleData` to **false** in
   `/admin → Settings`. This removes the "sample data" warnings from the UI.

### 2. The helpline number is a placeholder

The banner shows `112` (India's national emergency number) labelled
"National Emergency Helpline". **Confirm the correct Tamil Nadu or Chennai
animal-rescue helpline** and update it in `/admin → Settings`. The exact number
is a project decision — verify it, don't assume it.

### 3. Multi-city coverage is uneven

The **curated** directory covers Chennai, Coimbatore, Madurai, Ooty and
Kanchipuram. A user in any other city sees only the live OSM vets near them —
a real improvement, but a list with no NGO or municipal unit in it. The empty
state is handled honestly (it offers to submit a request), but **do not launch
nationally until the curated directory is real in the areas you claim to
cover.** A user who is told "3 km away" and finds nothing will lose trust in
every other listing too.

### 3b. Live vet coverage depends on OpenStreetMap, not on you

Vets come from volunteer-mapped OSM data, so real-world coverage is uneven and
varies by city. Data quality is the community's, not the app's: a clinic may be
mis-tagged, out of date, or missing a phone number entirely (the card then shows
Directions only, no Call button). Nothing here is phone-verified, which is why
the badge says so. If you need guarantees, add the clinics you care about to
the curated directory — a curated entry within 150m of a matching live clinic
automatically wins and hides the live copy.

### 4. Organisation details that are assumed, not confirmed

- Whether any municipal unit genuinely offers 24x7 capture (assumed: no).
- Which NGOs run a real ambulance (assumed: `rescue` only).
- The `capture_only` flag is what makes the app route injuries to a vet instead
  of animal control. **Verify this per organisation** — it is the single most
  consequential field in the schema.

### 5. Nothing is monitored

There is no alerting on incoming requests, no uptime check, and no error
reporting. A request submitted at 3am is stored and then waits for a human to
open `/admin`. For a real launch, wire the request queue to a channel somebody
actually watches.

## Known gaps

Deliberately out of scope for v1 (per the brief): native apps, reviews/ratings,
volunteer management, push notifications, non-English UI.

Known limitations in what *is* built:

- **Photo storage is local disk.** Fine for one instance; on a multi-instance
  deploy, uploaded photos will 404. Swap the multer storage engine in
  `server/src/routes/upload.js` for S3 or Supabase Storage — the rest of the app
  only ever sees the returned URL.
- **Uploads are validated by the client-declared MIME type, not the file's
  actual bytes.** A file containing HTML or a script is accepted if the uploader
  labels it `image/png`. Practical impact is limited, because `express.static`
  sets the response `Content-Type` from the stored `.png` extension so the
  browser will not execute it — but it does allow arbitrary bytes to be stored
  and served from your origin. Validate magic bytes after upload if that matters
  to you.
- **Admin sessions are in-memory.** A restart logs everyone out (harmless), and
  token revocation does not survive a restart (also harmless, since the signing
  secret rotates with it). Set a persistent `SESSION_SECRET` in production.
- **Sign-in rate limiting is per-process.** Fine for a single instance.
- **The community-signal rate limits are per-process and in memory** (one
  confirmation and three flags per IP per organisation). They reset on restart
  and are not shared across instances, so a multi-instance deploy would need
  them in the database. This is a speed bump against casual abuse, not a
  security boundary.
- **A flag is never dismissed.** Every public report stays attached to the
  listing until an admin edits or deactivates it. There is no
  `resolved_at` column, so an old report is still visible after the underlying
  problem is fixed — read it as "someone reported this at some point", not
  "this is currently broken".
- **The WhatsApp message is user-sent, not server-sent.** See the reasoning
  above. If you later want genuine auto-dispatch, that is a different design
  decision with real consequences.
- **No email or SMS fallback** if a user has no WhatsApp.
- **Text is inline English.** All user-facing strings would need extraction into
  a message catalogue before localising; the taxonomy slugs are already
  language-neutral.

---

## Licence

MIT. The code is yours to fork.
