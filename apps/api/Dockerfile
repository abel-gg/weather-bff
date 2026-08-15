# Multi-stage build. The layers are ordered so that a code change does not
# invalidate the dependency install — manifests first, source last — which is
# the difference between a 10-second rebuild and a 3-minute one on every push.
#
# Built from the repository root: docker build -f apps/api/Dockerfile .

# --- dependencies (including dev, needed to compile) ---------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/ui/package.json ./apps/ui/
# Scoped to this workspace. An unscoped `npm ci` in a monorepo installs every
# workspace's dev dependencies — here that meant pulling Vite, Rollup and
# esbuild into an image that only ever runs `tsc`.
RUN npm ci --workspace @weather/api --include-workspace-root

# --- compile TypeScript ---------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY apps/api ./apps/api
RUN npm run build --workspace @weather/api

# --- production dependencies only ----------------------------------------
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/ui/package.json ./apps/ui/
RUN npm ci --omit=dev --workspace @weather/api --include-workspace-root

# --- runtime --------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Never run as root. A container escape should not start from uid 0.
RUN addgroup -S app && adduser -S app -G app

COPY --from=prod-deps --chown=app:app /app ./
COPY --from=build --chown=app:app /app/apps/api/dist ./apps/api/dist

USER app
EXPOSE 3001

# The container's own opinion of its health. Alpine ships no curl, and Node's
# built-in fetch means we do not need to install one just to probe a port.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No npm in the entrypoint: npm swallows signals, so SIGTERM would never reach
# the process and every deploy would end in a 10-second SIGKILL instead of the
# graceful shutdown the app implements.
CMD ["node", "apps/api/dist/index.js"]
