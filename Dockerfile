# Production image: one container runs the API and serves the built web app on the same origin
# (so the SameSite=Strict refresh cookie works without any CORS set-up).
#
#   docker compose -f docker-compose.prod.yml up -d --build

FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.23.0
WORKDIR /app

# Manifests first, so dependency installation is cached until they change.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/calc/package.json packages/calc/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @dalmia/api exec prisma generate \
 && pnpm --filter @dalmia/api build \
 && pnpm --filter @dalmia/web build

FROM node:22-slim AS run
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Asia/Kolkata
WORKDIR /app
COPY --from=build /app /app
# The API serves apps/web/dist when WEB_DIST points at it.
ENV WEB_DIST=/app/apps/web/dist
WORKDIR /app/apps/api
USER node
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Apply pending migrations, then start. Seeding is a deliberate, separate step (see README).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
