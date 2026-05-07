FROM node:22-bookworm-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json .npmrc ./
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
COPY apps/worker apps/worker

RUN pnpm install --frozen-lockfile=false

RUN pnpm --filter @doceomenter/shared build \
 && pnpm --filter @doceomenter/claude build \
 && pnpm --filter @doceomenter/boot build \
 && pnpm --filter @doceomenter/capture build \
 && pnpm --filter @doceomenter/render build \
 && pnpm --filter @doceomenter/worker build \
 && pnpm --filter @doceomenter/web build

RUN useradd -m -u 1001 doceo && chown -R doceo:doceo /app
USER doceo

ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["tini", "--"]
CMD ["pnpm", "--filter", "@doceomenter/web", "start"]
