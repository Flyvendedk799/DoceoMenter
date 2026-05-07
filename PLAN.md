# DoceoMenter — Implementation Plan

> A web UI that turns a GitHub repository URL into a polished, multi‑format
> documentation pack: a written **Markdown report**, a **visual HTML
> presentation**, and a **PDF** of that presentation. The pack covers the
> project's *concept* (why it exists), *vision*, and *technical reality*, and
> embeds **high‑quality, contextually relevant screenshots and short video
> recordings** captured by Playwright from the project actually running.
>
> This document is the single source of truth for an agentic AI executor.
> It is written in sequenced phases. Phases must be completed in order
> unless a "✅ Parallelizable with" note states otherwise.

---

## Table of contents

1. [Sequence 0 — Vision & success criteria](#sequence-0--vision--success-criteria)
2. [Sequence 1 — Product surface (UX flow)](#sequence-1--product-surface-ux-flow)
3. [Sequence 2 — Architecture & tech stack](#sequence-2--architecture--tech-stack)
4. [Sequence 3 — Repository & filesystem layout](#sequence-3--repository--filesystem-layout)
5. [Sequence 4 — Job pipeline (state machine)](#sequence-4--job-pipeline-state-machine)
6. [Sequence 5 — Repo ingestion & static analysis](#sequence-5--repo-ingestion--static-analysis)
7. [Sequence 6 — Claude API: agentic content generation](#sequence-6--claude-api-agentic-content-generation)
8. [Sequence 7 — Project type detection & runtime boot](#sequence-7--project-type-detection--runtime-boot)
9. [Sequence 8 — Playwright capture engine (the hard part)](#sequence-8--playwright-capture-engine-the-hard-part)
10. [Sequence 9 — Asset post‑processing](#sequence-9--asset-postprocessing)
11. [Sequence 10 — Output rendering (Markdown, HTML deck, PDF)](#sequence-10--output-rendering-markdown-html-deck-pdf)
12. [Sequence 11 — Frontend UI implementation](#sequence-11--frontend-ui-implementation)
13. [Sequence 12 — Backend API surface](#sequence-12--backend-api-surface)
14. [Sequence 13 — Sandboxing, security & resource limits](#sequence-13--sandboxing-security--resource-limits)
15. [Sequence 14 — Configuration & secrets](#sequence-14--configuration--secrets)
16. [Sequence 15 — Testing strategy](#sequence-15--testing-strategy)
17. [Sequence 16 — Local dev & deployment](#sequence-16--local-dev--deployment)
18. [Sequence 17 — Quality bars & acceptance tests](#sequence-17--quality-bars--acceptance-tests)
19. [Sequence 18 — Stretch goals](#sequence-18--stretch-goals)
20. [Appendix A — Claude prompt library](#appendix-a--claude-prompt-library)
21. [Appendix B — File‑by‑file build order for the executor](#appendix-b--filebyfile-build-order-for-the-executor)

---

## Sequence 0 — Vision & success criteria

### Why DoceoMenter exists
Most repositories have either a sparse README or a wall of unstructured prose.
Engineers, hiring managers, investors, and end users cannot quickly grasp
**(a) what the project is**, **(b) why it exists**, and **(c) what it
actually looks/feels like in use**. Asking an LLM to summarize a repo gets
you (a) and (b) — but never (c), because the model has never seen the app
running. DoceoMenter closes that gap by combining LLM analysis with
real‑browser capture.

### Product promise (one sentence)
> Paste a GitHub URL → get a presentation deck, a PDF, and a Markdown report
> that explain the project's concept and architecture *and* show it running,
> in under ~5 minutes for a typical web project.

### Concrete success criteria
A run is "successful" when **all** of these hold:

| # | Criterion | How it is measured |
|---|---|---|
| S1 | Concept section answers *what is this and why does it exist* | Manual rubric (Appendix A) — at least 4/5 |
| S2 | Vision section is grounded, not hallucinated | Every claim cites a file/line or a README quote |
| S3 | Technical section names the actual stack & entrypoints | Cross‑checked against detected manifests |
| S4 | At least one screenshot shows the app *running*, not GitHub UI | `capture.kind === "live-app"` exists |
| S5 | Screenshots are crisp at 2× DPR, ≥1440px wide | `metadata.dpr ≥ 2 && width ≥ 1440` |
| S6 | At least one ≤30s video records a real user flow | `videos[].source === "playwright"` |
| S7 | All three output formats (md/html/pdf) are produced | Files exist on disk and are non‑empty |
| S8 | A user can rerun with the same URL and get a new run, not a cached one (idempotency by job, not by URL) | Distinct `runId` per request |

### Non‑goals (explicit)
- Not a CI/CD documentation generator (no per‑commit pipelines).
- Not multi‑repo (one URL per run).
- Not a hosting service for the analyzed app — the app is booted, captured,
  then torn down.
- No login/social/sharing in v1; outputs are downloadable artifacts.

---

## Sequence 1 — Product surface (UX flow)

The UI is intentionally narrow.

```
┌─────────────────────────────────────────────────────────────┐
│  DoceoMenter                                                │
│                                                             │
│   ┌───────────────────────────────────────────────┐         │
│   │ https://github.com/owner/repo                 │ [Generate] │
│   └───────────────────────────────────────────────┘         │
│                                                             │
│   ▾ Advanced (collapsed by default)                         │
│      Branch / ref:        [main]                            │
│      Output style:        ( ) Concise  (•) Standard  ( ) Deep dive │
│      Include video:       [✓]                               │
│      Boot the app:        [✓]   (uncheck for libraries)     │
│      Anthropic API key:   [···············] (optional, BYOK)│
└─────────────────────────────────────────────────────────────┘
```

After **Generate** is clicked, the screen transitions to a **live job view**:

```
Run #f3a91c   github.com/owner/repo @ main                ◷ 02:14
─────────────────────────────────────────────────────────
[✓] Cloning repository                              0:08
[✓] Static analysis (manifests, languages, deps)    0:11
[✓] Claude — concept & vision draft                 0:24
[●] Booting project (vite dev server on :5173)      0:42 ▌
[ ] Playwright capture (screenshots + 1 video)
[ ] Claude — technical write‑up
[ ] Rendering Markdown / HTML / PDF
─────────────────────────────────────────────────────────
Live log:
  > pnpm install --frozen-lockfile
  > vite v5.0.10 ready in 412 ms
  > navigated to http://localhost:5173 (200 OK, 1.2s)
  > captured: home-hero.png (1440×900 @2x)
```

When complete:

```
Run #f3a91c — done in 4:52
─────────────────────────────────────────────────────────
[ Open presentation ↗ ]   [ Download PDF ]   [ Download .md ]
[ Download all (zip) ]    [ Re‑run ]
─────────────────────────────────────────────────────────
Preview (deck thumbnail)        Preview (markdown)
```

### UX rules
- Single‑page; no router on v1 except `/run/:id`.
- Live progress streams via **SSE** (simpler than WebSockets for one‑way).
- A failed step does not abort the whole job — degrade gracefully and label
  the affected sections as "Partial" in the output.
- The deck is opened in a new tab; never inside an iframe (PDF print breaks).

---

## Sequence 2 — Architecture & tech stack

### Pinned choices (the executor must use these unless a phase says otherwise)

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** end‑to‑end | Playwright + Anthropic SDK both first‑class; one toolchain |
| Frontend | **Next.js 14 (App Router)** + React + Tailwind | Server actions + SSE streaming + simple deploy |
| Backend | **Same Next.js app** (route handlers) + a **worker process** | Avoid running Playwright inside the request thread |
| Queue | **BullMQ** on **Redis** | Battle‑tested, supports progress events |
| Browser automation | **Playwright** (chromium only in v1) | The mandated capability; supports video out of the box |
| LLM | **Anthropic SDK** with `claude-opus-4-7` for synthesis, `claude-haiku-4-5-20251001` for cheap classification | Latest Claude 4 family per current model lineup |
| Prompt caching | **Enabled** on the system prompt + repo file index | Multiple prompts reuse the same large context |
| Rendering deck | **Reveal.js** (vanilla) compiled into a single self‑contained HTML | Easy to print to PDF via Playwright |
| Markdown | **remark / rehype** pipeline | Lets us inject capture metadata cleanly |
| PDF | **Playwright `page.pdf()`** of the rendered deck in print mode | No extra deps |
| Video format | **WebM** from Playwright, transcoded to **MP4 (H.264)** via `ffmpeg` | Browser + slide deck compatibility |
| Image format | **PNG** captured, converted to **WebP** for the deck, **PNG** kept for the markdown | Quality + size tradeoff |
| Sandboxing | **Docker** worker container per job (one container, one job) | Untrusted code; prevents cross‑job contamination |
| Storage | **Local FS under `./data/runs/<runId>/`** in dev; **S3‑compatible** in prod | Switch via `STORAGE_DRIVER` env |
| Auth | **None in v1** (BYOK or server key via env) | Out of scope |

### High‑level diagram

```
 ┌───────────────────┐    POST /api/runs     ┌────────────────────┐
 │  Next.js Frontend │──────────────────────▶│  API route handler │
 │  (React + Tailwind)│◀───── SSE /events ─── │  (enqueues job)    │
 └───────────────────┘                       └─────────┬──────────┘
                                                       │
                                            BullMQ enqueue (Redis)
                                                       │
                                                       ▼
                                        ┌──────────────────────────┐
                                        │  Worker (Docker per job) │
                                        │ ┌────────┐  ┌──────────┐ │
                                        │ │ Cloner │  │ Analyzer │ │
                                        │ └────┬───┘  └────┬─────┘ │
                                        │      ▼           ▼       │
                                        │ ┌──────────┐ ┌─────────┐ │
                                        │ │  Booter  │ │ Claude  │ │
                                        │ └────┬─────┘ │  agent  │ │
                                        │      ▼        └────┬────┘│
                                        │ ┌────────────────┐ │     │
                                        │ │  Playwright    │◀┘     │
                                        │ │  capture engine│       │
                                        │ └────┬───────────┘       │
                                        │      ▼                   │
                                        │ ┌──────────────────────┐ │
                                        │ │  Renderer (md/html/pdf)│
                                        │ └────────────┬─────────┘ │
                                        └──────────────┼───────────┘
                                                       │
                                                       ▼
                                              data/runs/<runId>/
```

---

## Sequence 3 — Repository & filesystem layout

```
/                              # repo root (this repo: DoceoMenter)
├─ apps/
│  ├─ web/                     # Next.js 14 app (UI + API routes)
│  │  ├─ app/
│  │  │  ├─ page.tsx
│  │  │  ├─ run/[id]/page.tsx
│  │  │  └─ api/
│  │  │     ├─ runs/route.ts          # POST creates a run
│  │  │     ├─ runs/[id]/route.ts     # GET status
│  │  │     ├─ runs/[id]/events/route.ts  # SSE stream
│  │  │     └─ runs/[id]/files/[...path]/route.ts  # static-ish artifact serve
│  │  ├─ components/
│  │  │  ├─ UrlForm.tsx
│  │  │  ├─ RunProgress.tsx
│  │  │  ├─ ArtifactList.tsx
│  │  │  └─ Logo.tsx
│  │  ├─ lib/
│  │  │  ├─ sse.ts
│  │  │  └─ api.ts
│  │  └─ tailwind.config.ts
│  └─ worker/                  # Long-running BullMQ worker
│     ├─ src/
│     │  ├─ index.ts                  # boot worker
│     │  ├─ pipeline.ts               # orchestrates stages
│     │  └─ stages/
│     │     ├─ 01-clone.ts
│     │     ├─ 02-analyze.ts
│     │     ├─ 03-claude-concept.ts
│     │     ├─ 04-detect-runtime.ts
│     │     ├─ 05-boot.ts
│     │     ├─ 06-capture.ts
│     │     ├─ 07-claude-technical.ts
│     │     ├─ 08-postprocess-assets.ts
│     │     └─ 09-render.ts
│     └─ Dockerfile
├─ packages/
│  ├─ shared/                  # cross‑package types
│  │  └─ src/types.ts          # RunSpec, RunState, CaptureSpec, etc.
│  ├─ claude/                  # Anthropic SDK wrapper, prompt templates
│  │  └─ src/
│  │     ├─ client.ts
│  │     ├─ prompts.ts
│  │     └─ schemas.ts         # zod schemas for Claude tool inputs
│  ├─ capture/                 # Playwright orchestration
│  │  └─ src/
│  │     ├─ browser.ts
│  │     ├─ shotPlan.ts
│  │     ├─ runner.ts
│  │     └─ video.ts
│  ├─ boot/                    # project-type detection + boot strategies
│  │  └─ src/
│  │     ├─ detect.ts
│  │     └─ strategies/{node,vite,next,python,static,cli}.ts
│  └─ render/                  # md, html-deck, pdf
│     └─ src/
│        ├─ markdown.ts
│        ├─ deck.ts
│        └─ pdf.ts
├─ data/
│  └─ runs/<runId>/
│     ├─ repo/                 # cloned source (deleted after run)
│     ├─ assets/
│     │  ├─ screenshots/*.png
│     │  └─ videos/*.mp4
│     ├─ analysis.json         # static analysis result
│     ├─ plan.json             # Claude-produced shotPlan
│     ├─ content.json          # all generated text
│     ├─ report.md             # final markdown
│     ├─ deck.html             # final reveal.js deck (self-contained)
│     ├─ deck.pdf              # printed pdf
│     └─ run.log               # full structured log
├─ docker-compose.yml
├─ PLAN.md                     # ← this file
└─ README.md
```

---

## Sequence 4 — Job pipeline (state machine)

A single run progresses through these states. The stages from
`apps/worker/src/stages/` map 1:1.

```
queued
  └─▶ cloning
        └─▶ analyzing
              └─▶ drafting-concept            (Claude call #1)
                    └─▶ detecting-runtime
                          └─▶ booting          (may be skipped → "library" mode)
                                └─▶ capturing  (Playwright)
                                      └─▶ drafting-technical (Claude call #2,
                                          informed by what was actually captured)
                                            └─▶ post-processing-assets
                                                  └─▶ rendering
                                                        └─▶ done
                                                              ↳ failed (terminal)
                                                              ↳ partial (terminal,
                                                                 with degraded sections)
```

Rules:
- Each stage emits `progress` events of shape:
  `{ stage, pct, message, timings: { startedAt, finishedAt? } }`
- A stage may be marked `skipped` (e.g. boot for a pure library) or
  `degraded` (e.g. only 2 of 6 planned screenshots succeeded). Degradation is
  not a failure but is reflected in the output ("Partial capture" callout).
- `failed` only happens for unrecoverable errors (e.g. Claude key invalid,
  repo not found, disk full).

---

## Sequence 5 — Repo ingestion & static analysis

### Cloning (`stages/01-clone.ts`)
- Validate URL: must match `^https?://github\.com/[^/]+/[^/]+(\.git)?/?$`.
  Reject SSH URLs, gist URLs, and non‑GitHub hosts in v1.
- Clone with depth=1: `git clone --depth=1 --branch=<ref> <url> repo/`.
- Reject if repo > **500 MB** (configurable). After clone, run
  `du -sh repo/` and abort early if over budget.
- Strip `.git/` to save space (we don't need history beyond HEAD).

### Static analysis (`stages/02-analyze.ts`)
Produces `analysis.json`:

```ts
type Analysis = {
  repo: { owner: string; name: string; ref: string; commitSha: string };
  sizeBytes: number;
  fileCount: number;
  languages: Record<string, number>;          // bytes per language (use github-linguist OR a tiny extension counter)
  manifests: {
    nodePkg?: { name: string; scripts: Record<string,string>; deps: string[]; devDeps: string[]; engines?: any };
    pythonPyproject?: { name: string; deps: string[] };
    pythonRequirements?: string[];
    cargoToml?: { name: string };
    goMod?: { module: string };
    dockerfile?: { exposedPorts: number[]; cmd?: string[] };
    composeYml?: { services: string[] };
  };
  entrypoints: string[];                      // ["src/main.ts", "index.html", ...]
  readme?: { path: string; firstNHeadings: string[]; rawTrimmed: string };
  fileIndex: Array<{ path: string; bytes: number; sha: string }>;  // capped at 2000 entries
  signals: {
    hasFrontend: boolean;
    hasBackend: boolean;
    hasCLI: boolean;
    isLibrary: boolean;
    framework?: "next" | "vite" | "cra" | "astro" | "svelte-kit" | "fastapi" | "flask" | "django" | "express" | "unknown";
  };
};
```

This JSON is the **grounding context** every Claude call receives. Keeping
it deterministic and cap‑bound is what makes prompt caching effective.

---

## Sequence 6 — Claude API: agentic content generation

### Two‑call structure (deliberate)

1. **Concept & vision pass** — runs *before* boot/capture. Pure analysis.
2. **Technical & narrative pass** — runs *after* capture so Claude can
   reference what was actually seen and weave screenshot captions into the
   prose.

### Why two calls?
The shot plan (which views to capture) is itself produced by Claude in pass
#1 as a structured tool output. Pass #2 then knows what visuals exist and
writes captions that reference them by id.

### Prompt caching layout
Every call uses the following cached prefix (≥1024 tokens; eligible):

```
[cache_control: ephemeral]
<system>
You are DoceoMenter, an analyst that writes documentation grounded in real
repository contents. Cite files as `path:line` when claiming behavior.
Never fabricate dependencies or APIs. If unsure, say "not determined from
source".
</system>

<repo-context>
  <analysis>{{analysis.json, pretty}}</analysis>
  <readme>{{first 8KB of README}}</readme>
  <file-index>{{top 200 paths by importance}}</file-index>
</repo-context>
```

The user message and tool definitions are **not** cached (they vary).

### Call #1 — `concept-and-plan`
Tools exposed to Claude (forced via `tool_choice: { type: "any" }`):

```ts
// Capture plan = list of "shots" the Playwright runner will execute.
type Shot =
  | { id: string; kind: "screenshot"; target: "live-app"; route: string;
      viewport: { w: number; h: number }; waitFor?: string;
      interactions?: Interaction[]; caption: string; importance: 1|2|3 }
  | { id: string; kind: "screenshot"; target: "github-readme"; section: string; caption: string; importance: 1|2|3 }
  | { id: string; kind: "screenshot"; target: "code-architecture"; diagramSpec: MermaidSpec; caption: string; importance: 1|2|3 }
  | { id: string; kind: "video"; target: "live-app"; route: string;
      script: Interaction[]; maxDurationMs: number; caption: string };

type Interaction =
  | { do: "click"; selector: string }
  | { do: "fill"; selector: string; text: string }
  | { do: "hover"; selector: string }
  | { do: "scrollTo"; selector: string }
  | { do: "wait"; ms: number }
  | { do: "press"; key: string };
```

Tool functions Claude must call:

- `submit_concept({ what, why, vision, audience })` — strings, each 60–200
  words, citations required.
- `submit_capture_plan({ shots: Shot[] })` — 4–10 shots; **must include
  ≥1 `target: "live-app"` if `signals.hasFrontend` is true**; must include
  ≥1 architecture diagram if `signals.hasBackend` or files > 50.

### Call #2 — `technical-and-captions`
Receives the concept output **and** a manifest of what the Playwright runner
actually captured (some shots may have failed). Tools:

- `submit_technical({ stack, architecture, dataFlow, keyModules, gettingStarted })` —
  each grounded with `path:line` citations.
- `submit_captions({ captions: { shotId: string; markdown: string }[] })` —
  one caption per successful capture, ≤60 words each.
- `submit_summary({ tldr, oneLiner })` — for the deck title slide.

### Cost & latency budget
- Call #1: cap at 8K input tokens (analysis trim) + 4K output. Target ≤25s.
- Call #2: cap at 12K input + 4K output. Target ≤30s.
- Use `claude-opus-4-7` for both; fall back to `claude-sonnet-4-6` on rate
  limit. Use `claude-haiku-4-5-20251001` for the small classifier in
  Sequence 7.

---

## Sequence 7 — Project type detection & runtime boot

### Detector (`packages/boot/src/detect.ts`)
Pure function over `Analysis` → `BootStrategy`:

```ts
type BootStrategy =
  | { kind: "next";   pkgManager: "pnpm"|"npm"|"yarn"; port: number }
  | { kind: "vite";   pkgManager: "pnpm"|"npm"|"yarn"; port: number }
  | { kind: "cra";    pkgManager: "pnpm"|"npm"|"yarn"; port: number }
  | { kind: "astro";  pkgManager: "pnpm"|"npm"|"yarn"; port: number }
  | { kind: "node-server"; cmd: string; port: number }
  | { kind: "python-web";  cmd: string; port: number }   // fastapi/flask/django
  | { kind: "static";      dir: string; port: number }   // serve via `npx serve`
  | { kind: "docker";      composeService?: string; port: number }
  | { kind: "cli" }     // no boot — capture --help output as image
  | { kind: "library" } // no boot — only architecture diagrams + code shots
  | { kind: "unknown" };
```

Detection rules (priority order):
1. `next` if `next` in deps and `pages/` or `app/` exists.
2. `astro` / `svelte-kit` similarly via deps + config file.
3. `vite` if `vite` in devDeps and `vite.config.*` exists.
4. `cra` if `react-scripts` in deps.
5. `docker`/`compose` if `docker-compose.yml` exists *and*
   `--enable-docker-in-docker` flag is set on the worker (off by default for
   security).
6. `python-web` if `fastapi`/`flask`/`django` in `pyproject` or
   `requirements.txt`.
7. `node-server` if `package.json` has `start` script and it looks like a
   server (heuristic: `app.listen`, `fastify`, `express`, `koa` in source).
8. `static` if there is an `index.html` at root or in `public/`/`docs/`.
9. `cli` if `bin` field in `package.json` or `scripts/` with a clear entry.
10. `library` if `main`/`module`/`exports` in `package.json` and none of the
    above.
11. `unknown` → degrade to library mode.

### Booter (`stages/05-boot.ts`)
- Each strategy file in `packages/boot/src/strategies/` exports
  `async boot(repoDir, opts) → { url: string, kill: () => Promise<void> }`.
- Use `execa` to spawn. Capture stdout/stderr to `run.log` *and* to the SSE
  stream (truncate per line).
- **Health check**: poll `GET <url>` every 250ms until 200/2xx or timeout
  (default 60s). On timeout, mark stage `degraded` and skip live‑app shots.
- Install deps with `--prefer-offline --no-audit --no-fund` (Node) or
  `pip install --no-cache-dir` (Python). Install timeout: 4 minutes.
- **Never** run `postinstall` scripts in v1 — pass `--ignore-scripts` (npm)
  or set `npm_config_ignore_scripts=true`. This blocks a real attack vector.
- All booted processes run as a non‑root user inside the container with no
  network egress beyond the package registry mirror (see Sequence 13).

---

## Sequence 8 — Playwright capture engine (the hard part)

> This is what makes screenshots *relevant and high quality* instead of
> generic. Treat this section as load‑bearing.

### Browser baseline (`packages/capture/src/browser.ts`)
- Chromium only, headless.
- Default context options:
  - `viewport: { width: 1440, height: 900 }`
  - `deviceScaleFactor: 2` (retina)
  - `colorScheme: "light"` (a separate dark pass is opt‑in below)
  - `reducedMotion: "reduce"` — kills entrance animations that ruin shots
  - `locale: "en-US"`, `timezoneId: "UTC"`
  - `recordVideo` only enabled for shots of `kind: "video"`, in a separate
    context to avoid recording every screenshot navigation
- Block third‑party requests by default to prevent flaky shots
  (analytics, fonts CDNs that 503): allowlist = `localhost`, `127.0.0.1`,
  `0.0.0.0`. README/architecture screenshots use a different context with no
  blocking.

### Quality recipe (applied per shot)
1. Navigate to `route` with `waitUntil: "networkidle"` (cap 8s).
2. If `waitFor` selector is provided, await it (cap 5s).
3. Inject a CSS rule that disables `caret-color` and pauses CSS animations:
   ```css
   *, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }
   ```
4. Auto‑scroll to top, wait one rAF, then `page.screenshot({
   fullPage: shot.fullPage ?? false, type: "png", animations: "disabled" })`.
5. Save raw PNG; record `metadata.json` next to it with viewport, DPR, URL,
   timing, and a sha256 of the bytes.
6. Run a **quality gate** (`packages/capture/src/quality.ts`):
   - Reject if image is >95% a single color (means nothing rendered).
   - Reject if image entropy < threshold (blank page, error page).
   - Reject if HTML title contains `Error|404|500|Not Found` and the shot
     wasn't explicitly an error‑state shot.
   - On rejection, mark shot `failed` and continue.

### Shot plan execution (`packages/capture/src/runner.ts`)
- Iterate shots sequentially (parallelism = 1 in v1: simpler, more
  deterministic, gentler on the booted app).
- Wrap each shot in a 30s hard timeout.
- For `kind: "video"`:
  - Open a new context with `recordVideo: { dir, size: { width: 1280, height: 720 } }`.
  - Execute the `script` interactions with realistic delays
    (250ms between actions) so the video is watchable.
  - Hard cap at `maxDurationMs` (default 25s).
  - On context close, transcode WebM → MP4 with
    `ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4`.
- For `target: "github-readme"`:
  - Navigate to `https://github.com/<owner>/<repo>` (or `#anchor`).
  - Use `page.locator(".markdown-body")` and `boundingBox()` to clip to the
    relevant region.
- For `target: "code-architecture"`:
  - Render the Mermaid spec in a tiny local HTML harness shipped with the
    app (`packages/capture/assets/mermaid-harness.html`); screenshot the
    SVG. No external requests.

### Adaptive replanning
After the first 2 shots, the runner sends a compact summary back to Claude
(via a third, lightweight call only if **>30% of shots failed**) and asks
for a revised plan. This is the only "agentic loop" in the system; cap at
**one** replan to bound cost.

---

## Sequence 9 — Asset post‑processing

`stages/08-postprocess-assets.ts`:

- For each PNG, also write a **WebP** copy at quality 90 for the deck;
  keep the PNG for the markdown report (GitHub renders PNG reliably,
  WebP support is patchy in some markdown viewers).
- Generate a low‑res placeholder (`-thumb.webp`, 320px wide) for SSE
  preview tiles in the UI.
- For each MP4, generate a poster frame (`-poster.jpg`) by extracting
  the frame at 1.0s with `ffmpeg`.
- Write an `assets/manifest.json` listing every asset with:
  `{ id, path, kind, width, height, durationMs?, captionRefs }`.

---

## Sequence 10 — Output rendering (Markdown, HTML deck, PDF)

### Markdown (`packages/render/src/markdown.ts`)
Section order (omit a section if its source data is empty):

1. Title + one‑liner + repo metadata (owner/repo/ref/commit/date).
2. **TL;DR** (3 bullets).
3. **Concept — what is it & why does it exist** (from Claude pass #1).
4. **Vision** (from Claude pass #1).
5. **In motion** — embedded screenshots & videos with captions
   (videos linked, with poster image inline; GitHub renders MP4 in PRs but
   not always in raw md → also include a thumbnail link).
6. **Architecture** — Mermaid diagrams (rendered server‑side as PNG and
   also kept as ` ```mermaid ` blocks for editability).
7. **Tech stack & key modules** (from Claude pass #2).
8. **Getting started** (from Claude pass #2; commands fenced as bash).
9. **Footer** — generated by DoceoMenter, run id, timestamp, version.

Implementation notes:
- All image refs are **relative** (`./assets/screenshots/foo.png`) so the
  zip download works offline.
- Citations like `(see src/foo.ts:42)` are rendered as plain text in the md
  but as links to `https://github.com/<owner>/<repo>/blob/<sha>/src/foo.ts#L42`
  in the deck.

### HTML deck (`packages/render/src/deck.ts`)
- Build a self‑contained `deck.html` by inlining Reveal.js CSS/JS from
  `node_modules` into a single file (so the artifact works offline).
- Slide order mirrors the markdown sections, but each major image gets its
  own slide with the caption beneath.
- Title slide uses `submit_summary.tldr`.
- Print stylesheet (`@media print`) ensures each slide is one PDF page.

### PDF (`packages/render/src/pdf.ts`)
- Open `deck.html` in Playwright with `?print-pdf` query (Reveal's built‑in
  print mode).
- `await page.emulateMedia({ media: "print" })`.
- `await page.pdf({ format: "A4", landscape: true, printBackground: true,
  preferCSSPageSize: true })`.
- Write to `data/runs/<runId>/deck.pdf`.

---

## Sequence 11 — Frontend UI implementation

Components are intentionally minimal.

### `components/UrlForm.tsx`
- Controlled input + advanced `<details>` block.
- Client‑side validation matches the same regex as the server.
- On submit, `POST /api/runs` → receives `{ runId }` → navigates to
  `/run/<runId>`.

### `app/run/[id]/page.tsx`
- Server component fetches initial state via `GET /api/runs/<id>`.
- Mounts a client `<RunProgress runId>` that opens an SSE connection to
  `/api/runs/<id>/events` and renders the stage list.

### `components/RunProgress.tsx`
- Renders the stage table from Sequence 1.
- Tails the last 20 log lines in a monospace box.
- Renders capture thumbnails as soon as they appear in
  `events: { type: "asset", thumbnailUrl }`.
- On `events: { type: "done" }`, swaps in `<ArtifactList>`.

### `components/ArtifactList.tsx`
- Three primary buttons: **Open presentation** (new tab → `/api/runs/<id>/files/deck.html`),
  **Download PDF**, **Download .md**.
- Secondary: **Download all (zip)** (server zips on demand).
- Re‑run button posts the same `RunSpec` again.

### Styling
- Tailwind, system font stack, generous whitespace, dark mode auto.
- No animation library; transitions are CSS only.
- Accessibility: every button has an accessible name; SSE updates use
  `aria-live="polite"` on the log region.

---

## Sequence 12 — Backend API surface

| Method | Path | Purpose | Body / Response |
|---|---|---|---|
| `POST` | `/api/runs` | Create a new run | Body: `RunSpec` → `{ runId }` |
| `GET`  | `/api/runs/:id` | Snapshot of run state | `{ state, stages, artifacts? }` |
| `GET`  | `/api/runs/:id/events` | **SSE** stream of progress | `event: stage|asset|log|done|error` |
| `GET`  | `/api/runs/:id/files/*` | Static‑ish artifact serve | streamed with correct content‑type |
| `POST` | `/api/runs/:id/cancel` | Cancel a running job | `{ ok }` |

`RunSpec` (zod‑validated):

```ts
type RunSpec = {
  url: string;                   // GitHub https URL
  ref?: string;                  // default "main"
  outputStyle?: "concise"|"standard"|"deep";
  includeVideo?: boolean;        // default true
  bootApp?: boolean;             // default true
  apiKey?: string;               // BYOK; if absent uses server env
};
```

Server enforces a per‑IP rate limit (default 3 runs/hour) using a Redis
counter — *not* an auth substitute, just abuse mitigation for a public demo.

---

## Sequence 13 — Sandboxing, security & resource limits

We are running arbitrary code from the internet. This is the section the
executor should **not** skip.

- **Container per job.** The worker process pulls the next job from BullMQ
  and runs the entire pipeline inside a fresh Docker container created from
  `apps/worker/Dockerfile`. The container is destroyed after the job.
- **Non‑root user** inside the container (`USER node`). No sudo.
- **Read‑only root filesystem** with a tmpfs‑backed `/tmp` and a writable
  bind mount only at `/work` (the run directory).
- **No network egress** except:
  - GitHub (clone)
  - npm/pypi mirror (configurable `NPM_REGISTRY` / `PIP_INDEX_URL`)
  - `api.anthropic.com`
  Block everything else with an egress proxy (e.g. `tinyproxy` allowlist) or
  an `iptables` rule on the container.
- **`--ignore-scripts`** for all package installs (Node and Python). Yes,
  this means some projects won't fully build; we accept that tradeoff.
- **CPU/memory limits**: `--cpus=2 --memory=4g --pids-limit=512`.
- **Wall‑clock cap**: hard kill after 10 minutes (configurable).
- **Disk cap**: refuse repos > 500 MB; cap `/work` mount size to 2 GB.
- **API key handling**: BYOK keys live only in the job payload (Redis) and
  the worker's process env; never logged, never persisted to disk, never
  echoed to SSE.
- **URL allowlist** in v1: only `https://github.com/...`. No file://, no
  arbitrary git URLs.

---

## Sequence 14 — Configuration & secrets

`.env.example` (committed) lists:

```
ANTHROPIC_API_KEY=          # default key (BYOK overrides per request)
REDIS_URL=redis://localhost:6379
STORAGE_DRIVER=local        # local | s3
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
NPM_REGISTRY=https://registry.npmjs.org
PIP_INDEX_URL=https://pypi.org/simple
MAX_REPO_MB=500
MAX_RUN_SECONDS=600
ENABLE_DOCKER_IN_DOCKER=false
```

`apps/web/lib/config.ts` and `apps/worker/src/config.ts` both validate
their slice of env with `zod` at startup and exit on misconfiguration.

---

## Sequence 15 — Testing strategy

### Unit
- `packages/boot/src/detect.ts` — table‑driven tests over fake `Analysis`
  inputs (every strategy + ambiguities).
- `packages/capture/src/quality.ts` — fixture PNGs (blank, error page,
  real page) → expected pass/fail.
- `packages/render/src/markdown.ts` — golden‑file snapshot tests.

### Integration
- A **fixture harness** that ships 4 tiny "fake repos" inside
  `tests/fixtures/`:
  1. `static-site/` — pure `index.html`.
  2. `vite-app/` — minimal Vite + React.
  3. `node-cli/` — `bin` script that prints help.
  4. `library/` — TS lib with no app surface.
  Each fixture has an expected `analysis.json` and a tolerated
  shot count range.
- These run in CI without the real Anthropic API by stubbing the Claude
  client with deterministic fixture responses (`packages/claude/src/__mocks__/`).

### E2E
- A single Playwright test (`tests/e2e/full-run.spec.ts`) that boots the
  whole stack via `docker compose up -d`, posts a run for the
  `vite-app/` fixture (served from a local file:// → http via a tiny git
  daemon on localhost), and asserts that `deck.html`, `deck.pdf`, and
  `report.md` are produced and non‑empty.

### Manual smoke list (run before each release)
1. A real public repo (e.g. small Vite project from your own GH).
2. A non‑existent repo URL → expect a clean error.
3. A 404 branch → expect a clean error, no partial run.
4. A library‑only repo → expect mode `library`, no live‑app shots, no failure.

---

## Sequence 16 — Local dev & deployment

### Local dev
```
pnpm i
docker compose up -d redis
pnpm --filter web dev          # Next.js on :3000
pnpm --filter worker dev       # nodemon-equivalent on the worker
```

`docker-compose.yml` defines:
- `redis:7-alpine`
- (optional) `worker` building from `apps/worker/Dockerfile` for parity

### Production
- Web: any Node host (Vercel works *only if* the worker lives elsewhere,
  because Playwright + long jobs don't fit serverless). Recommend Fly.io or
  Render for both web and worker.
- Worker: dedicated VM/container with Docker‑in‑Docker enabled OR a
  Kubernetes job‑per‑run pattern.
- Object storage: S3‑compatible (Cloudflare R2 is cheap and fits).

---

## Sequence 17 — Quality bars & acceptance tests

A run is **accepted** for release‑gate purposes when, for the canonical
fixture `vite-app/`:

- `report.md` ≥ 600 words and contains all 9 sections from Sequence 10.
- `deck.html` opens in a browser with no console errors and ≥ 8 slides.
- `deck.pdf` is ≥ 5 pages and < 10 MB.
- ≥ 3 screenshots have `target: "live-app"`.
- ≥ 1 video plays in Chrome and Firefox.
- Total wall‑clock ≤ 5 minutes on a 4‑core/8GB CI runner.
- No Claude call exceeds the token caps in Sequence 6.
- Zero secret leakage in `run.log` (regex scan for `sk-`, `ANTHROPIC_`,
  `AWS_`).

---

## Sequence 18 — Stretch goals (explicitly out of scope for v1)

- Multi‑repo mode (compare two repos in one deck).
- Auth + persistent run history.
- Theming the deck (corporate skins).
- Self‑hosted Claude proxy with usage caps per user.
- "Refresh" mode that keeps the run id and only re‑captures.
- Audio narration of the deck via TTS.
- Browser‑extension that adds a "DoceoMenter this repo" button to GitHub.

---

## Appendix A — Claude prompt library

> Concrete prompt strings the executor should put in
> `packages/claude/src/prompts.ts`. Keep them in source — do **not** load
> from disk at runtime — so they travel with the build.

### A.1 — System prompt (cached)

```
You are DoceoMenter, an analyst that produces grounded, citation-rich
documentation about a software repository. You will receive a structured
<repo-context> block containing static analysis, the README, and a file
index. Treat that block as the single source of truth.

Hard rules:
1. Never invent a dependency, command, or file path. If unsure, omit.
2. Cite source with `path:line` when stating behavior. Cite the README
   with `README#heading` when paraphrasing intent.
3. Prefer plain language. No marketing adjectives ("blazing", "cutting-edge").
4. Output only via the provided tools. Do not write prose outside tools.
```

### A.2 — Concept & plan call (user message)

```
Read the <repo-context>. Then call BOTH tools, in order:

1. submit_concept with:
   - what:    one paragraph (60-120 words) describing what this project is.
   - why:     one paragraph explaining why it exists; cite README or files.
   - vision:  one paragraph on where the project appears to be going
              (only claim what the source supports; otherwise say
              "vision not stated in source").
   - audience: 1-3 short bullets for target users.

2. submit_capture_plan with 4-10 shots that, together, would let a reader
   *see* this project. Constraints:
   - If signals.hasFrontend is true, include >=1 shot with target="live-app"
     and importance=1.
   - If signals.hasBackend is true OR fileCount>50, include >=1 shot with
     target="code-architecture" and a Mermaid spec.
   - At most 1 video; only include if includeVideo is true.
   - Routes for live-app shots must be plausible from the source
     (e.g. "/" is always safe; deeper routes require evidence).
```

### A.3 — Technical & captions call (user message)

```
You previously produced a concept and a capture plan. Below is a
<capture-manifest> describing what was actually captured (some shots may
have failed).

Call all three tools:

1. submit_technical:
   - stack:        list of (technology, evidence path:line) tuples.
   - architecture: 80-160 words; reference the Mermaid diagram if present.
   - dataFlow:     60-120 words on how data moves through the system.
   - keyModules:   3-6 entries: { path, role, oneLineSummary, citations[] }.
   - gettingStarted: shell commands derived from package.json scripts /
                     README; never invent a command.

2. submit_captions: one entry per successful shot in the manifest. Each
   caption is <=60 words and explains what the reader should notice.

3. submit_summary:
   - oneLiner: <=14 words, no period at the end.
   - tldr:     exactly 3 bullets, each <=20 words.
```

---

## Appendix B — File‑by‑file build order for the executor

This is the order an agent should create files in. Each row is independently
testable.

| # | File | Acceptance check |
|---|---|---|
| 1 | `packages/shared/src/types.ts` | `tsc --noEmit` clean |
| 2 | `packages/claude/src/client.ts` + `prompts.ts` + `schemas.ts` | unit test calls a mocked Anthropic client and validates shape |
| 3 | `packages/boot/src/detect.ts` + strategies | table tests for all strategies |
| 4 | `packages/capture/src/{browser,quality,shotPlan,runner,video}.ts` | runs against a tiny local static site fixture and produces a PNG |
| 5 | `packages/render/src/{markdown,deck,pdf}.ts` | golden‑file snapshot for `vite-app` fixture |
| 6 | `apps/worker/src/stages/01..09` and `pipeline.ts` | integration test on `vite-app` fixture passes |
| 7 | `apps/worker/src/index.ts` (BullMQ wiring) + `Dockerfile` | `docker compose up worker` succeeds |
| 8 | `apps/web/app/api/runs/route.ts` + SSE handler | `curl -N` shows live events for a fixture run |
| 9 | `apps/web/components/{UrlForm,RunProgress,ArtifactList}.tsx` + pages | Playwright e2e `full-run.spec.ts` passes |
| 10 | `tests/e2e/full-run.spec.ts` + CI workflow | green in CI |
| 11 | `README.md` rewrite + `.env.example` | `pnpm setup && pnpm dev` works on a fresh clone |

When all 11 rows are green, **v1 is done**. Anything beyond is Sequence 18.
