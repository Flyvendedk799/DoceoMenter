FROM node:22-bookworm-slim

# System deps for Playwright Chromium and ffmpeg.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl tini ffmpeg \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json .npmrc ./
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/worker apps/worker

RUN pnpm install --frozen-lockfile=false

# Install Playwright browsers
RUN pnpm --filter @doceomenter/capture exec playwright install --with-deps chromium

RUN pnpm --filter @doceomenter/shared build \
 && pnpm --filter @doceomenter/claude build \
 && pnpm --filter @doceomenter/boot build \
 && pnpm --filter @doceomenter/capture build \
 && pnpm --filter @doceomenter/render build \
 && pnpm --filter @doceomenter/worker build

# Run as non-root.
RUN useradd -m -u 1001 doceo && chown -R doceo:doceo /app
USER doceo

ENV NODE_ENV=production
ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/worker/dist/index.js"]
