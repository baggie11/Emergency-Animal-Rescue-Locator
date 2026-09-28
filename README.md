# Rescue Nearby

> **Find the nearest animal rescue NGO, veterinary hospital, or municipal animal control — instantly.**  
> One tap to call. One tap to navigate. No login. No app install. No API keys.

[![Node](https://img.shields.io/badge/Node-20+-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/Tests-213%20passing-brightgreen)](#test-suite)
[![Build](https://img.shields.io/badge/Build-1.7s%20%7C%20218KB%20JS%20%7C%2012KB%20CSS-orange)](#key-metrics)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

---

## Problem → Solution

**Problem:** When someone finds an injured or distressed animal, they waste critical minutes searching fragmented sources — NGO lists are stale, veterinary directories don't exist for most cities, and municipal animal-control numbers are buried in PDFs or dead websites.

**Solution:** Rescue Nearby merges a **human-verified curated directory** (NGOs, municipal units) with **live OpenStreetMap veterinary data** into a single offline-capable PWA. GPS → ranked list → tap to call or navigate. Zero friction.

**Differentiator:** Explicit trust badges on every result (`Verified` / `Listed by us, not yet confirmed` / `From OpenStreetMap`) + a public correction loop (`Report a problem` / `Still correct`) that surfaces bad data to admins **without auto-hiding listings** — preventing vandalism while keeping trust honest.

---

## Key Metrics

| Metric | Value | Context |
|--------|-------|---------|
| **Test suite** | 213 passing | 118 API + 95 DOM (jsdom), real Overpass mocked locally |
| **Production build** | 218 KB JS (68 KB gz) + 12 KB CSS (gz) | Vite + Tailwind v4, sub-2s build |
| **Cold start (Docker)** | ~8 s | SQLite + migrations + optional seed |
| **Runtime dependencies** | 5 | `express`, `better-sqlite3`, `react`, `leaflet`, `scrypt` |
| **Database** | SQLite (hundreds of rows) | PostGIS migration path documented |
| **Architecture** | Single-process Node + SPA | Runs on Render, Railway, Fly.io, VPS; not serverless |

---

## Product Architecture

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
                      ├─ Directions    → Google/Apple Maps deep link
                      └─ Report / Still correct → public correction signal
```

### Why the Directory Is Hybrid

| Data Type | Source | Rationale |
|-----------|--------|-----------|
| NGOs, municipal units | **Hand-curated** | Informal, largely invisible online. No API covers them; someone must call and verify. |
| Veterinary clinics | **Live from OpenStreetMap** | Registered, mapped businesses. Hand-entry per city doesn't scale and goes stale in months. |

Every result carries `source: "curated" \| "live"` with an explicit badge:

| State | Badge | Meaning |
|-------|-------|---------|
| Curated + `verified` | 🟢 **Verified** | Human called the number; it works. |
| Curated, unverified | 🟡 **Listed by us, not yet confirmed** | We added it; nobody has phoned it. |
| Live OSM | 🟠 **From OpenStreetMap** | Mapped by contributors. Never phone-verified. |

**Dedupe:** Live clinic within 150 m of a curated vet with a similar name → curated wins, live copy dropped. Live IDs are namespaced `osm:<type>/<id>` so they never collide with curated IDs.

**Filters over live results:** OSM only says "veterinary clinic", so the app only claims what OSM actually knows:

- Category, situation, 24×7, free-text → apply to live results
- `services` → matches (clinics genuinely do first aid)
- `animals` → **excludes** live results (OSM doesn't record species treated)
- `Verified only` → excludes live entirely (never verified)

**Resilience:** Overpass request abandoned after `LIVE_LOOKUP_TIMEOUT_MS` (default 3 s). Curated list returned unchanged; `liveLookupUnavailable: true` triggers an amber footnote — **not an error**, because curated results remain usable.

**Good citizen:** Results cached per ~1 km grid cell for 24 h; concurrent requests for the same cell share one in-flight fetch. For production traffic, run your own Overpass instance and point `OVERPASS_API_URL` at it.

---

## Technical Decisions & Tradeoffs

| Area | Decision | Tradeoff Accepted |
|------|----------|-------------------|
| Database | SQLite + Haversine SQL | No KNN index; sub-ms at current scale. PostGIS migration path documented. |
| Vet data | Live Overpass + curated merge | OSM quality varies → explicit amber badges, 150 m dedupe, animal filter excludes live. |
| Offline | localStorage 7-day cache | Stale data risk mitigated by visible amber banner, not an error page. |
| Auth | Single admin + scrypt cookie | No multi-tenancy; adequate for shared admin panel. |
| Corrections | Flags + confirmations (no auto-hide) | Prevents vandalism; human-in-the-loop trust model. |
| Rate limits | In-memory per-process | Resets on restart; multi-instance needs DB-backed limits. |

---

## Quick Start

### Local Development (Node 20+)

```bash
npm install          # installs server + web workspaces
npm run seed         # creates data/rescue.db, loads 16 sample organisations
npm run dev          # API on :4000, Vite dev server on :5173
```

Open http://localhost:5173. Admin panel at `/admin` (default `admin` / `admin123` — server warns until changed).

### Production Mode (Single Process)

```bash
npm run build        # builds SPA into dist/, served by Express
npm start            # http://localhost:4000
```

### Docker (Recommended)

```bash
cp .env.example .env

# 1. Session secret
openssl rand -hex 32                       # -> SESSION_SECRET in .env

# 2. Admin password hash (uses docker build/run, NOT compose run — see note below)
docker build -t rescue-nearby:1.0.0 .
docker run --rm rescue-nearby:1.0.0 \
  node server/src/scripts/makePassword.js "your strong password"
                                              # -> ADMIN_PASSWORD_SCRYPT in .env

# 3. Launch
docker compose up -d                        # http://localhost:4000
```

> **Why not `docker compose run` for the password?** Compose refuses to start anything until `ADMIN_PASSWORD_SCRYPT` is set (fail-fast). Asking Compose to generate the value it demands would be circular. Use `docker build` + `docker run` once, then `docker compose up -d`.

The schema auto-creates on first boot. For a demo:

```bash
docker compose run --rm app npm run seed
```

---

## Deployment

### Docker Compose (VPS, VM, Local)

See [Quick Start → Docker](#docker-recommended). One process, one persistent volume (`rescue-data`). `docker compose down` keeps data; `down -v` destroys it.

### Render / Railway / Fly.io

```yaml
# fly.toml example
[[mounts]]
  source = "rescue_data"
  destination = "/data"

[env]
  DATA_DIR = "/data"
```

```
Build:  npm install && npm run build
Start:  npm start
```

Mount a persistent volume at `DATA_DIR`. Set all required env vars (see Configuration).

### Split SPA + API (Vercel/Netlify + Separate API)

```bash
# Frontend build
VITE_API_BASE=https://api.example.org

# API CORS
CORS_ORIGINS=https://app.example.org
```

The client prefixes every request with `VITE_API_BASE` and rewrites photo URLs to the API origin. Leave unset for single-process deployment.

---

## Configuration

All variables documented in [`.env.example`](./.env.example). Required for production:

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `SESSION_SECRET` | ✅ | — | 32-byte hex; sessions drop on restart without it |
| `ADMIN_PASSWORD_SCRYPT` | ✅ | — | Output of `npm run make-password --workspace server` |
| `ADMIN_USERNAME` | ❌ | `admin` | |
| `ADMIN_SESSION_TTL_HOURS` | ❌ | `12` | |
| `DIRECTORY_IS_SAMPLE_DATA` | ❌ | `true` | UI shows warnings until `false` |

### Live Veterinary Lookup

| Variable | Default | Notes |
|----------|---------|-------|
| `LIVE_LOOKUP_ENABLED` | `true` | `false` = curated only; nothing else breaks |
| `OVERPASS_API_URL` | `https://overpass-api.de/api/interpreter` | Point at self-hosted instance for production SLA |
| `LIVE_LOOKUP_CACHE_TTL_HOURS` | `24` | Grid-cell TTL |
| `LIVE_LOOKUP_RADIUS_KM` | `10` | Ceiling; user can request less via `?radiusKm=` |
| `LIVE_LOOKUP_TIMEOUT_MS` | `3000` | Hard cap; curated list returned alone on timeout |
| `OVERPASS_USER_AGENT` | `RescueNearby/1.0…` | Set your contact; Overpass requires identification |

> **Compose note:** These must be listed in `docker-compose.yml` under `environment:` — Compose only passes through named variables, so `.env` values are otherwise ignored inside the container. The compose file already forwards them.

---

## Verification Checklist (Pre-Launch Gates)

| Gate | Status | Owner |
|------|--------|-------|
| All 16 seed organisations phone-verified | ⬜ | PM |
| Helpline number confirmed (not placeholder 112) | ⬜ | PM |
| Curated directory real in launch cities | ⬜ | PM |
| `capture_only` verified per municipal unit | ⬜ | PM |
| Self-hosted Overpass deployed | ⬜ | Eng |
| Request queue alerting (Slack/PagerDuty) | ⬜ | Eng |

> **Do not launch publicly until every ⬜ is ✅.** A wrong number wastes minutes a distressed animal may not have.

---

## Roadmap

| Priority | Item | Effort | Value |
|----------|------|--------|-------|
| P0 | Self-hosted Overpass (Docker compose) | 1 day | Production SLA, no public rate limits |
| P0 | Magic-byte upload validation | 4 hrs | Security hardening |
| P1 | DB-backed rate limits (flags/confirm) | 1 day | Multi-instance ready |
| P1 | Request queue alerting (Slack/PagerDuty) | 4 hrs | Operational visibility |
| P2 | i18n string extraction | 2 days | Non-English launch |
| P2 | PostGIS migration + KNN | 2 days | Scale to 100k+ rows |
| P3 | Volunteer management dashboard | 1 week | NGO workflow integration |

---

## Known Limitations

### Architectural (require code changes to resolve)

| Limitation | Impact | Mitigation Path |
|------------|--------|-----------------|
| Photo storage on local disk | Multi-instance → 404s | Swap multer storage in `server/src/routes/upload.js` to S3/Supabase |
| Admin sessions in-memory | Restart logs everyone out | Persistent `SESSION_SECRET`; token revocation not critical |
| Sign-in rate limiting per-process | Single instance only | Redis-backed limiter if scaling |
| Flag/confirm rate limits in-memory | Resets on restart, not shared | DB-backed limiter (P1 roadmap) |
| Flags never auto-dismissed | Old reports stay visible | Read as "reported at some point", not "currently broken" |

### Product (scope decisions for v1)

| Limitation | Rationale |
|------------|-----------|
| WhatsApp message user-sent, not server-sent | Human confirms before dispatch; avoids wrong-street-at-2am |
| No SMS/email fallback | WhatsApp dominant in target regions; adds cost/complexity |
| English-only UI | All strings inline; taxonomy slugs language-neutral — extraction needed for i18n |
| No reviews/ratings, push notifications, volunteer management | Out of scope per brief; Roadmap P3 |

---

## Test Suite

```bash
npm test          # 118 API + 95 DOM = 213 checks
```

- **API (`scripts/smoke.mjs`):** Boots real Express + throwaway SQLite. Exercises every endpoint: nearby (curated+live merge, dedupe, filters, failure degradation, cache), flag/confirm/rate-limit, admin CRUD, auth, upload, WhatsApp message build.
- **DOM (`scripts/dom-smoke.mjs`):** jsdom + real React tree. Covers GPS deny/grant, manual search, filters, map pins, trust badges, no-phone live cards, verified-only toggle, live-unavailable banner, admin flag surfacing, report/confirm flows.
- **Mock Overpass (`scripts/mock-overpass.mjs`):** Local HTTP stub returns canned OSM elements. Tests never touch the network; deterministic, fast, CI-safe.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for PR process, commit style, and test requirements.  
Issues: use the templates in `.github/ISSUE_TEMPLATE/`.  
Code of Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) (Contributor Covenant v2.1).

---

## License

MIT. The code is yours to fork.