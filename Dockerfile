# syntax=docker/dockerfile:1
#
# Multi-stage build for the monorepo:
#   deps   -> production dependencies for the API (server workspace only)
#   build  -> Vite bundle for the SPA
#   runtime-> Node + API + built SPA, no build toolchain, non-root
#
# The final image contains no npm, no compiler and no dev dependencies, so the
# only native module that ships is better-sqlite3's prebuilt binary.

# ---------------------------------------------------------------------------
# base: node plus a native build toolchain
#
# The toolchain is needed because `npm ci` runs `node-gyp rebuild` for
# better-sqlite3 rather than using the prebuilds it bundles (reproducible with
# npm 10.9 on this lockfile). A build that fails here is much harder to debug
# than one that is slightly slower. This stage is never used directly, and the
# toolchain does not reach the runtime image.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        build-essential \
        g++ \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# deps: production dependencies for the API only
# ---------------------------------------------------------------------------
FROM base AS deps

WORKDIR /app

# Manifests first so this layer is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

# Only the server workspace plus the root are needed at runtime. This installs
# the api's 5 runtime dependencies and skips react, leaflet, vite and the tests.
# NOTE: do not delete better-sqlite3/prebuilds. The `node-gyp rebuild` above
# does not leave a usable binary behind, and lib/binding.js resolves the module
# from the bundled prebuilds/ directory. Removing it breaks the app with
# MODULE_NOT_FOUND. The 17MB of prebuilds for other platforms is the price.
RUN npm ci --omit=dev --workspace server --include-workspace-root \
    && npm cache clean --force

# ---------------------------------------------------------------------------
# build: compile the frontend
# ---------------------------------------------------------------------------
FROM base AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci

COPY web ./web
RUN npm run build

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

WORKDIR /app

# better-sqlite3's native module links against libstdc++.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/web/dist      ./web/dist

# Kept so `docker compose run --rm app npm run ...` still resolves workspaces.
COPY package.json ./
COPY server/package.json ./server/
COPY server/src ./server/src

# The database (WAL mode also writes -wal and -shm) and uploaded photos live
# here. Owned by the unprivileged `node` user from the base image.
RUN mkdir -p /app/data/uploads \
    && chown -R node:node /app/data

USER node

EXPOSE 4000
VOLUME ["/app/data"]

# Uses node's built-in fetch so the image needs no curl or wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run node directly rather than through npm: fewer processes, and npm does not
# forward signals to the child, so graceful shutdown would not work.
CMD ["node", "server/src/index.js"]
