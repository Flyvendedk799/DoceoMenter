# DoceoMenter

> Paste a GitHub URL → get a Markdown report, an HTML presentation, and a PDF — with real screenshots and a short video of the project running.

DoceoMenter is a small full-stack app that turns a repository URL into three artifacts:

- **`report.md`** — a written summary covering concept, vision, technical stack, key modules, and getting started.
- **`deck.html`** — a self-contained Reveal.js presentation built from the report and capture assets.
- **`deck.pdf`** — the deck rendered to print-quality PDF.

Each artifact embeds **real screenshots** of the project (and optionally a **short video walkthrough**) captured by booting the project in a headless Chromium via Playwright.

The full implementation plan lives in [`PLAN.md`](./PLAN.md).

---

## How it works

```
┌─────────┐    POST /api/runs    ┌──────────────┐
│ Web UI  │─────────────────────▶│  Web (Next)  │
│ (React) │◀─── SSE  events ─────│  + API route │
└─────────┘                      └──────┬───────┘
                                        │ BullMQ enqueue
                                        ▼
                                 ┌──────────────┐
                                 │  Redis       │
                                 │  (queue +    │
                                 │  pub/sub)    │
                                 └──────┬───────┘
                                        │
                                        ▼
                       ┌──────────────────────────────┐
                       │  Worker (Node + Playwright)  │
                       │  clone → analyze → Claude    │
                       │  → boot → capture → render   │
                       └──────────────────────────────┘
```

- The web app accepts a GitHub URL, validates it, and enqueues a `RunJobData` on Redis.
- The worker pulls the job, runs the 9-stage pipeline (see `PLAN.md` § 4), and persists artifacts under `data/runs/<id>/`.
- Stage events stream from worker → web over Redis pub/sub → SSE → React.
- Files are served back to the browser through `/api/runs/:id/files/*`.

---

## Quick start (local dev)

```bash
# 1. Install
pnpm install

# 2. Build packages (once)
pnpm build

# 3. Start Redis (or use docker compose)
redis-server --daemonize yes

# 4. Install Playwright Chromium (once)
pnpm --filter @doceomenter/capture exec playwright install --with-deps chromium

# 5. Run the stack
./scripts/start-stack.sh
# → Web on http://localhost:3010

# 6. Tear down
./scripts/stop-stack.sh
```

Bring your own Anthropic API key:

- **Per request:** paste it into the form's *Advanced* section (BYOK).
- **Server-wide:** export `ANTHROPIC_API_KEY=sk-…` before starting the worker.
- **Without a key:** the pipeline runs against a deterministic fixture client that produces plausible structured output. Useful for local testing.

---

## Layout

```
apps/
├── web/           Next.js 14 UI + API routes (Tailwind)
└── worker/        BullMQ worker, pipeline, stages, Dockerfile
packages/
├── shared/        Cross-package types and schemas (zod)
├── claude/        Anthropic SDK client, prompts, fixture client
├── boot/          Project-type detection + boot strategies
├── capture/       Playwright runner, quality gates, mermaid harness, video
└── render/        Markdown, Reveal.js deck, PDF
tests/
├── e2e/           Playwright end-to-end test (web + worker)
└── fixtures/      static-site, vite-app, node-cli, library
data/
└── runs/<id>/     Cloned repo, analysis, generated content, artifacts
```

---

## Tests

```bash
# Unit + integration (per package)
pnpm test

# End-to-end (assumes the stack is running on :3010)
./scripts/start-stack.sh
pnpm --filter @doceomenter/e2e test
```

The integration test in `apps/worker/src/pipeline.test.ts` exercises the full pipeline against a local bare git repo containing the static-site fixture. It runs in ~16 seconds and produces a real `report.md` + `deck.html` + `deck.pdf`.

---

## Config (excerpt — see `.env.example`)

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Server-wide Claude key; absent → fixture client |
| `ANTHROPIC_MODEL_PRIMARY` | `claude-opus-4-7` | Primary model |
| `ANTHROPIC_MODEL_FALLBACK` | `claude-sonnet-4-6` | Used on rate-limit |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Queue + pub/sub |
| `DATA_ROOT` | `data/runs` | Where artifacts are persisted |
| `RUN_MODE` | `in-process` | `in-process` or `container` |
| `MAX_REPO_MB` | `500` | Reject larger repos at clone time |
| `MAX_RUN_SECONDS` | `600` | Hard kill after this many seconds |

Sandboxing rules implemented in code (see `PLAN.md` § 13):

- All package installs run with `--ignore-scripts` (npm/yarn/pnpm/pip).
- URLs are restricted to `https://github.com/<owner>/<repo>` (file:// allowed only by the test harness).
- Repo size capped before any other work.
- Worker is run as non-root inside its Dockerfile.
- Container-per-job mode (`RUN_MODE=container`) is the production path; `in-process` is the dev default.

---

## Status

The plan in `PLAN.md` is implemented end-to-end. All packages build, all unit tests pass, the integration test runs the full pipeline against a real repo, and the e2e Playwright test drives the UI against a running stack.
