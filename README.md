# DoceoMenter

> Paste a GitHub URL → get a Markdown report, an HTML presentation, and a PDF — with real screenshots and a short video of the project running.

DoceoMenter is a small full-stack app that turns a repository URL into a documentation pack:

- **`report.md`** — a written summary covering concept, vision, technical stack, key modules, and getting started.
- **`deck.html`** — a self-contained Reveal.js presentation built from the report and capture assets.
- **`deck.pdf`** — the deck rendered to print-quality PDF.
- **`case-study.json`** — a portable portfolio/case payload with narrative, metrics, media references, and tech stack.
- **`quality.json`** — the evidence/media quality gate used to mark a run as done or partial.

Each artifact embeds **real screenshots** of the project (and optionally a **short video walkthrough**) captured by booting the project in a headless Chromium via Playwright. Reports and decks also include a **reference case brief**: a source-grounded quality layer that separates the problem, audience fit, evidence register, media plan, audit metrics, and gaps so the output can be reviewed like a real case artifact instead of a generic repo summary.

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

---

## Who pays for a run

DoceoMenter uses [`ai-auth`](https://github.com/Flyvendedk799/ai-auth) for credentials, which
means there are four ways to pay for the model calls a run makes, chosen in the panel at the top
of the form:

| Provider | Credential | Where it comes from |
|---|---|---|
| **Claude subscription** | OAuth, the same exchange `claude` runs | The visitor signs in from the page; the credential is stored encrypted against their browser |
| **Anthropic API key** | A metered key | Pasted into the panel (encrypted at rest) or `ANTHROPIC_API_KEY` on the server |
| **ChatGPT subscription (Codex)** | The `codex` login on the host | Read from the CLI's own file, never modified |
| **OpenAI API key** | A metered key | Pasted into the panel or `OPENAI_API_KEY` on the server |

The point of the first row is that a run costs the person who asked for it rather than whoever
set the server up. Signing in never puts a token in the browser: the PKCE verifier stays on the
server for the length of the login, the credential is sealed with AES-256-GCM afterwards, and
the only thing a page can ever read back about a stored key is a mask (`sk-ant-…9ZQ`).

Nothing spendable travels through the job queue either. The run carries the *account id* from a
signed http-only cookie, and the worker resolves — and refreshes — the credential at the moment
it needs one, so a queued job cannot run on a token that expired while it waited.

**With no credential at all**, a metered provider falls back to a deterministic fixture client
that produces plausible structured output, so the pipeline, the tests and a first look at the
product all work with nothing configured. A subscription provider does not: it fails with a
message saying what to connect, because quietly returning fixtures for a run someone asked their
own plan to pay for would be a lie about where the output came from.

`ai-auth` is installed from git (`git+https://github.com/Flyvendedk799/ai-auth.git`), which
means two things worth knowing: pnpm has to run the package's own `prepare` build, allowed by
the `onlyBuiltDependencies` entry in `pnpm-workspace.yaml`, and an environment with no GitHub ssh
key needs `git config --global url."https://github.com/".insteadOf "git@github.com:"` — CI and
both Dockerfiles set it.

### Self-hosting notes

- Set **`DOCEOMENTER_SECRET_KEY`** as soon as the web app and the worker are separate processes.
  It is half of the encryption key for every stored credential (and signs the account cookie);
  two processes deriving different keys read each other's rows as unreadable, which surfaces as
  people being signed out for no stated reason. Left unset, a key is generated once beside the
  credential file — fine for one host, useless for two.
- **`ALLOW_LOCAL_CLI`** (default `true`) decides whether a `claude` or `codex` login on the host
  may be used. Turn it **off** for any deployment a stranger can open, or one visitor's run bills
  the operator's own plan.
- Credentials live in `<DATA_ROOT>/../credentials/credentials.json` (`0600`) by default, or in
  Postgres when `CREDENTIALS_DATABASE_URL` is set — that path wants `pg` installed and `ai-auth`'s
  `SCHEMA_SQL` applied through your own migrations.
- The consent screen for the subscription login says **Claude Code**, because that is whose
  client id the flow uses. Read Anthropic's and OpenAI's subscription terms before pointing a
  hosted product at consumer plans.

---

## Layout

```
apps/
├── web/           Next.js 14 UI + API routes (Tailwind)
└── worker/        BullMQ worker, pipeline, stages, Dockerfile
packages/
├── shared/        Cross-package types and schemas (zod)
├── auth/          ai-auth wiring: credential stores, provider resolution, sessions
├── claude/        Provider transports (Anthropic / OpenAI / Codex), prompts, fixtures
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
| `DOCEOMENTER_SECRET_KEY` | generated | Encrypts stored credentials; signs the account cookie |
| `CREDENTIALS_DIR` | `<DATA_ROOT>/../credentials` | Where sealed credentials are kept |
| `CREDENTIALS_DATABASE_URL` | — | Use Postgres for credentials instead of a file |
| `ALLOW_LOCAL_CLI` | `true` | May a `claude`/`codex` login on the host be used |
| `ANTHROPIC_API_KEY` | — | Deployment-wide key; absent and nothing stored → fixture client |
| `ANTHROPIC_MODEL_PRIMARY` | `claude-opus-5` | Primary model |
| `ANTHROPIC_MODEL_FALLBACK` | `claude-sonnet-5` | Used when the primary is rate-limited |
| `OPENAI_API_KEY` | — | Deployment-wide key for the OpenAI provider |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Queue + pub/sub |
| `DATA_ROOT` | `data/runs` | Where artifacts are persisted |
| `RUN_MODE` | `in-process` | `in-process` or `container` |
| `MAX_REPO_MB` | `500` | Reject larger repos at clone time |
| `MAX_RUN_SECONDS` | `600` | Hard kill after this many seconds |

Sandboxing rules implemented in code (see `PLAN.md` § 13):

- Credentials are encrypted at rest (AES-256-GCM, keyed from the host secret with a per-store
  label) and a stored key has no read-back path — only a mask.
- API keys are namespaced per browser, so a key pasted by one visitor is never spent by the next.
- All package installs run with `--ignore-scripts` (npm/yarn/pnpm/pip).
- URLs are restricted to `https://github.com/<owner>/<repo>` (file:// allowed only by the test harness).
- Repo size capped before any other work.
- Worker is run as non-root inside its Dockerfile.
- Container-per-job mode (`RUN_MODE=container`) is the production path; `in-process` is the dev default.

---

## Status

The plan in `PLAN.md` is implemented end-to-end. All packages build, all unit tests pass, the integration test runs the full pipeline against a real repo, and the e2e Playwright test drives the UI against a running stack.
