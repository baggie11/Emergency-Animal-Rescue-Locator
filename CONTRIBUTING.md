# Contributing to Rescue Nearby

Thank you for helping make animal rescue faster and more reliable.

---

## Quick Start

```bash
git clone https://github.com/your-org/rescue-nearby.git
cd rescue-nearby
npm install
npm run seed
npm run dev
```

Open http://localhost:5173. Admin at `/admin` (`admin` / `admin123`).

---

## Development Workflow

1. **Pick an issue** — or open a new one using our templates.
2. **Branch:** `git checkout -b feat/short-description` or `fix/...`
3. **Code** — follow the style guides below.
4. **Test:** `npm test` must pass (213 checks).
5. **Build:** `npm run build` must succeed.
6. **Commit:** Use [Conventional Commits](https://www.conventionalcommits.org/).
7. **Push & PR** — reference the issue: `Fixes #123`.

---

## Code Style

| Layer | Tool | Config |
|-------|------|--------|
| JS/JSX | ESLint (airbnb-base + react) | `.eslintrc.cjs` |
| CSS | Tailwind v4 + Prettier | `.prettierrc` |
| SQL | Raw strings in migrations | — |

Run `npx eslint .` and `npx prettier --check .` before committing.

---

## Commit Messages

Use Conventional Commits:

```
feat: add verified-only filter to nearby endpoint
fix: live vet dedupe now respects 150m + name similarity
docs: update deployment guide for Fly.io volumes
test: add mock Overpass failure scenario
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `security`.

---

## Testing Requirements

| Change Type | Required Tests |
|-------------|----------------|
| New API endpoint | API smoke test in `scripts/smoke.mjs` |
| UI component / interaction | DOM smoke test in `scripts/dom-smoke.mjs` |
| Overpass logic | Mock Overpass scenario in `scripts/mock-overpass.mjs` |
| Schema change | Migration file in `server/src/migrations/` + seed if needed |

All tests must pass locally before CI runs.

---

## Pull Request Checklist

- [ ] `npm test` passes (213 checks)
- [ ] `npm run build` succeeds
- [ ] `npx eslint .` clean
- [ ] `npx prettier --check .` clean
- [ ] No new `console.log` / `debugger` in production code
- [ ] Migration included if schema changed
- [ ] README / docs updated if user-facing behaviour changed
- [ ] Linked issue closed by PR description (`Fixes #...`)

---

## Architecture Notes for Contributors

- **Single source of truth for vocabularies:** `server/src/lib/taxonomy.js` — both server and client mirror from here.
- **Geo:** Haversine in `server/src/lib/geo.js` (JS + SQL fragment). Keep in sync.
- **Trust model:** Never auto-hide a listing on a single report. Flags surface to admin; human decides.
- **Offline:** `localStorage` cache in `web/src/lib/api.js` — 7-day TTL, visible banner.
- **Live vet lookup:** `server/src/lib/liveVetLookup.js` — grid cache, in-flight dedupe, silent failure.

---

## Security

- **No secrets in code.** Use `.env` (gitignored) and env vars in CI/CD.
- **Report vulnerabilities privately** → `security@your-org.example` (see `.github/ISSUE_TEMPLATE/security.md`).
- **Dependencies:** `npm audit` runs in CI. Fix high/critical before merge.

---

## Questions?

Open a discussion or ping maintainers in the issue. We're friendly and prefer over-communication to silence.