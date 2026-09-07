import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaptureManifestEntry } from "@doceomenter/shared";
import type { RenderInput } from "./types.js";
import { assetRef, hasRenderableMedia } from "./assets.js";

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, "..", "assets");

/** The deck stage. Every size below is written for these dimensions; Reveal scales the rest. */
const STAGE = { width: 1280, height: 800 };

export async function renderDeck(input: RenderInput, outPath: string): Promise<string> {
  const html = await buildDeckHtml(input);
  await writeFile(outPath, html, "utf-8");
  // Copy needed media assets next to the deck so it works as a static bundle.
  // Caller is responsible for ensuring assetsBasePath resolves.
  return html;
}

async function buildDeckHtml(input: RenderInput): Promise<string> {
  const [revealCss, revealJs] = await Promise.all([
    readFile(join(ASSETS, "reveal.min.css"), "utf-8"),
    readFile(join(ASSETS, "reveal.min.js"), "utf-8"),
  ]);

  const slides = buildSlides(input);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.analysis.repo.owner)}/${escapeHtml(input.analysis.repo.name)} — DoceoMenter</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>${revealCss}</style>
<style>${DECK_THEME}</style>
</head>
<body>
<div class="reveal"><div class="slides">${slides}</div></div>
<script>${revealJs}</script>
<script>
  if (typeof Reveal !== "undefined") {
    Reveal.initialize({
      hash: false,
      controls: true,
      progress: true,
      pdfMaxPagesPerSlide: 1,
      width: ${STAGE.width},
      height: ${STAGE.height},
      margin: 0
    });
  }
</script>
</body>
</html>`;
}

/*
 * The deck theme.
 *
 * DoceoMenter's own design system, not a Reveal theme: graphite ground, one
 * cyan signal, borders instead of shadows, serif for voice and mono for fact.
 * The tokens are the literal values from the system so a slide and a product
 * screen put side by side are recognisably the same object. Fonts resolve
 * locally — a deck has to render identically on a machine with no network,
 * because that is where the PDF is printed.
 */
const DECK_THEME = `
  :root {
    --ink-900:#0E1013; --ink-850:#101317; --ink-800:#14171B; --well:#0B0D0F;
    --line:rgba(255,255,255,.08); --line-strong:rgba(255,255,255,.16);
    --fg:#F2F4F6; --fg-soft:#C6CDD4; --fg-muted:#99A2AC; --fg-faint:#66707A;
    --accent:#5AD8E6; --accent-deep:#0E8C99; --haze:#2B4C7E;
    --warn:#E8B44F; --fail:#E8685A;
    --font-display:"Instrument Serif",Georgia,"Times New Roman",serif;
    --font-sans:"Helvetica Neue",Helvetica,Arial,sans-serif;
    --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }

  html, body, .reveal { background: var(--ink-900); }
  .reveal {
    font-family: var(--font-sans);
    font-size: 20px;
    color: var(--fg);
    -webkit-font-smoothing: antialiased;
  }
  .reveal ::selection { background: rgba(90,216,230,.28); color:#fff; }
  .reveal .slides { text-align: left; }
  .reveal .slides section { padding: 0; height: 100%; }
  .reveal a { color: var(--accent); text-decoration: none; }

  /* Reveal toggles \`display\` on the section itself, so the flex layout lives
     one level in. Every slide is a full-bleed stage with its own padding. */
  .reveal .dm-slide {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; justify-content: center;
    gap: 26px; padding: 64px 88px; overflow: hidden;
  }
  .reveal .dm-slide.dm-split {
    display: grid; grid-template-columns: 36% 64%; gap: 0; padding: 0;
  }

  .reveal .dm-eyebrow {
    font-family: var(--font-mono); font-size: 13px; letter-spacing: .24em;
    text-transform: uppercase; color: var(--accent); margin: 0;
  }
  .reveal .dm-meta {
    font-family: var(--font-mono); font-size: 13px; color: var(--fg-faint); margin: 0;
  }
  .reveal h1, .reveal h2, .reveal h3 {
    font-family: var(--font-display); font-weight: 400; text-transform: none;
    letter-spacing: -.02em; color: var(--fg); margin: 0; text-shadow: none;
  }
  .reveal h1 { font-size: 82px; line-height: .98; }
  .reveal h2 { font-size: 46px; line-height: 1.05; max-width: 22ch; }
  .reveal h2.dm-long { font-size: 34px; max-width: 30ch; }
  .reveal h3 { font-size: 30px; line-height: 1.1; }
  .reveal p { font-size: 21px; line-height: 1.55; color: var(--fg-soft); margin: 0; max-width: 62ch; }
  .reveal p.dm-lede { font-size: 24px; color: var(--fg-soft); max-width: 48ch; }
  .reveal p.dm-small { font-size: 17px; color: var(--fg-muted); }

  /* Hairline grid: the 1px gaps are the border. */
  .reveal .dm-grid {
    display: grid; gap: 1px; background: var(--line);
    border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
  }
  .reveal .dm-grid-2 { grid-template-columns: repeat(2, 1fr); }
  .reveal .dm-grid-3 { grid-template-columns: repeat(3, 1fr); }
  .reveal .dm-grid-4 { grid-template-columns: repeat(4, 1fr); }
  .reveal .dm-cell {
    background: var(--ink-800); padding: 26px 28px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .reveal .dm-cell .dm-n { font-family: var(--font-mono); font-size: 13px; color: var(--fg-faint); }
  .reveal .dm-cell .dm-title { font-size: 20px; font-weight: 600; line-height: 1.25; color: var(--fg); }
  .reveal .dm-cell .dm-body { font-size: 16px; line-height: 1.5; color: var(--fg-muted); }
  .reveal .dm-cell .dm-value {
    font-family: var(--font-display); font-size: 52px; line-height: 1; color: var(--accent);
  }
  .reveal .dm-cell ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
  .reveal .dm-cell li { font-size: 16px; line-height: 1.5; color: var(--fg-muted); }

  .reveal .dm-rows { display: flex; flex-direction: column; }
  .reveal .dm-row {
    display: flex; gap: 22px; align-items: flex-start;
    padding: 13px 0; border-bottom: 1px solid rgba(255,255,255,.06);
  }
  .reveal .dm-row:last-child { border-bottom: none; }
  .reveal .dm-row .dm-key {
    font-family: var(--font-mono); font-size: 15px; color: var(--accent);
    min-width: 300px; flex-shrink: 0; word-break: break-all;
  }
  .reveal .dm-row .dm-val { font-size: 17px; line-height: 1.5; color: var(--fg-soft); }

  .reveal code, .reveal pre {
    font-family: var(--font-mono); text-shadow: none; box-shadow: none;
  }
  .reveal :not(pre) > code {
    color: var(--accent); background: rgba(90,216,230,.08);
    padding: 1px 6px; border-radius: 5px; font-size: .88em;
  }
  .reveal pre {
    width: 100%; margin: 0; font-size: 17px; line-height: 1.85;
    border: 1px solid var(--line); border-radius: 14px; background: var(--well);
  }
  .reveal pre code {
    display: block; padding: 26px 28px; max-height: 460px; overflow: auto;
    background: transparent; color: #B8C0C8; white-space: pre;
  }

  .reveal figure { margin: 0; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
  .reveal img, .reveal video {
    display: block; max-width: 100%; max-height: 560px; margin: 0 auto;
    object-fit: contain; border-radius: 14px; border: 1px solid var(--line); box-shadow: none;
  }
  .reveal .dm-split figure { height: 100%; justify-content: center; padding: 40px 56px 40px 0; }
  .reveal .dm-split .dm-pane {
    display: flex; flex-direction: column; justify-content: center; gap: 20px;
    padding: 64px 40px 64px 88px;
  }
  .reveal .dm-caption { font-family: var(--font-mono); font-size: 14px; color: var(--fg-faint); margin: 0; }

  .reveal .dm-quote {
    font-family: var(--font-display); font-size: 62px; line-height: 1.05;
    letter-spacing: -.02em; max-width: 22ch; margin: 0; color: var(--fg);
  }

  .reveal .dm-chips { display: flex; flex-wrap: wrap; gap: 9px; }
  .reveal .dm-chip {
    padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line-strong);
    font-family: var(--font-mono); font-size: 14px; color: var(--fg-muted);
  }
  .reveal .dm-flag { color: var(--warn); }

  /* Atmosphere. Two drifting fields behind the opening and closing slides,
     slow enough to read as weather rather than as activity. */
  .reveal .dm-mesh { position: absolute; inset: -20%; filter: blur(80px); opacity: .5; pointer-events: none; }
  .reveal .dm-mesh span { position: absolute; border-radius: 50%; display: block; }
  .reveal .dm-mesh .a {
    left: 2%; bottom: 0; width: 44%; height: 70%;
    background: radial-gradient(circle, var(--accent-deep), transparent 62%);
    animation: dmDeckDrift 26s ease-in-out infinite;
  }
  .reveal .dm-mesh .b {
    right: 6%; top: -6%; width: 38%; height: 64%;
    background: radial-gradient(circle, var(--haze), transparent 62%);
    animation: dmDeckDrift 34s ease-in-out infinite reverse;
  }
  .reveal .dm-mesh .c {
    right: 4%; bottom: -10%; width: 46%; height: 72%;
    background: radial-gradient(circle, var(--accent), transparent 62%);
    animation: dmDeckDrift 30s ease-in-out infinite;
  }
  .reveal .dm-slide > *:not(.dm-mesh) { position: relative; }

  @keyframes dmDeckDrift {
    0%   { transform: translate3d(0,0,0) scale(1); }
    50%  { transform: translate3d(5%,-4%,0) scale(1.14); }
    100% { transform: translate3d(0,0,0) scale(1); }
  }

  .reveal .progress { color: var(--accent); height: 2px; }
  .reveal .controls { color: var(--accent); }

  @media (prefers-reduced-motion: reduce) {
    .reveal .dm-mesh span { animation: none; }
  }

  @media print {
    .reveal .dm-mesh span { animation: none; }
    .reveal img, .reveal video { box-shadow: none; }
    html, body, .reveal, .reveal .dm-slide {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
  }
`;

function buildSlides(input: RenderInput): string {
  const { content, analysis, capture, assetsBasePath, runId, generatedAt } = input;
  const { concept, caseBrief, technical, summary, captions } = content;
  const { repo } = analysis;

  const sections: string[] = [];
  let chapter = 0;
  /** Section openers are numbered in the deck the way they are in the report. */
  const eyebrow = (label: string) => {
    chapter += 1;
    return `<p class="dm-eyebrow">${String(chapter).padStart(2, "0")} — ${escapeHtml(label)}</p>`;
  };

  // 01 — Title. The one slide that carries the gradient field.
  sections.push(
    slide(
      "Title",
      `${MESH_OPEN}
      <p class="dm-eyebrow">Case study · ${escapeHtml(shortDate(generatedAt))}</p>
      <h1>${escapeHtml(repo.name)}</h1>
      <p class="dm-lede">${escapeHtml(summary.oneLiner)}</p>
      <p class="dm-meta">github.com/${escapeHtml(repo.owner)}/${escapeHtml(repo.name)} @ ${escapeHtml(
        repo.ref,
      )} · ${escapeHtml(repo.commitSha.slice(0, 7))}</p>`,
    ),
  );

  // TL;DR as a numbered hairline grid.
  const tldr = summary.tldr.slice(0, 4);
  if (tldr.length > 0) {
    sections.push(
      slide(
        "TL;DR",
        `${eyebrow("TL;DR")}
        <div class="dm-grid dm-grid-${gridCols(tldr.length)}">
          ${tldr
            .map(
              (line, index) =>
                `<div class="dm-cell"><span class="dm-n">${String(index + 1).padStart(
                  2,
                  "0",
                )}</span><span class="dm-body">${escapeHtml(line)}</span></div>`,
            )
            .join("")}
        </div>`,
      ),
    );
  }

  // The problem, stated as the headline it is.
  sections.push(
    slide(
      "Problem",
      `${eyebrow("The problem")}
      ${heading(caseBrief.problem)}
      <p>${escapeHtml(caseBrief.productNarrative)}</p>`,
    ),
  );

  sections.push(
    slide(
      "Audience",
      `${eyebrow("Audience & evidence")}
      <div class="dm-grid dm-grid-2">
        <div class="dm-cell">
          <span class="dm-title">Audience fit</span>
          <ul>${caseBrief.audienceFit
            .slice(0, 4)
            .map((a) => `<li><strong>${escapeHtml(a.audience)}</strong>: ${escapeHtml(a.need)}</li>`)
            .join("")}</ul>
        </div>
        <div class="dm-cell">
          <span class="dm-title">Evidence register</span>
          <ul>${caseBrief.evidence
            .slice(0, 4)
            .map((e) => `<li>${escapeHtml(e.claim)} <code>${escapeHtml(e.source)}</code></li>`)
            .join("")}</ul>
        </div>
      </div>`,
    ),
  );

  // Audit metrics: serif numbers over mono labels, four to a strip.
  const metrics = caseBrief.auditMetrics.slice(0, 4);
  // The first gap gets named on the evidence slide — a deck that hides its own
  // caveats is the thing the quality gate exists to prevent.
  const firstGap = caseBrief.risksAndGaps[0];
  if (metrics.length > 0) {
    sections.push(
      slide(
        "Evidence",
        `${eyebrow("Evidence")}
        <div class="dm-grid dm-grid-${gridCols(metrics.length)}">
          ${metrics
            .map(
              (m) =>
                `<div class="dm-cell"><span class="dm-n">${escapeHtml(
                  m.label.toUpperCase(),
                )}</span><span class="dm-value">${escapeHtml(
                  m.value,
                )}</span><span class="dm-body"><code>${escapeHtml(m.evidence)}</code></span></div>`,
            )
            .join("")}
        </div>
        ${
          firstGap
            ? `<p class="dm-small">Stated rather than hidden: <span class="dm-flag">${escapeHtml(
                firstGap.gap,
              )}</span> — ${escapeHtml(firstGap.recommendation)}</p>`
            : ""
        }`,
      ),
    );
  }

  sections.push(
    slide(
      "Media plan",
      `${eyebrow("Media plan & gaps")}
      <div class="dm-grid dm-grid-2">
        <div class="dm-cell">
          <span class="dm-title">Media surfaces</span>
          <ul>${caseBrief.mediaPlan
            .slice(0, 5)
            .map(
              (m) =>
                `<li><strong>${escapeHtml(m.surface)}</strong>: ${escapeHtml(m.purpose)} ${
                  m.captureId ? `<code>${escapeHtml(m.captureId)}</code>` : "<em>gap</em>"
                }</li>`,
            )
            .join("")}</ul>
        </div>
        <div class="dm-cell">
          <span class="dm-title">Risks & gaps</span>
          <ul>${caseBrief.risksAndGaps
            .slice(0, 4)
            .map((g) => `<li><strong>${escapeHtml(g.gap)}</strong>: ${escapeHtml(g.recommendation)}</li>`)
            .join("")}</ul>
        </div>
      </div>`,
    ),
  );

  // Concept.
  sections.push(
    slide(
      "What",
      `${eyebrow("Concept")}
      ${heading("What is it?")}
      <p>${escapeHtml(concept.what)}</p>`,
    ),
  );
  sections.push(
    slide("Why", `<p class="dm-eyebrow">Concept</p>${heading("Why does it exist?")}<p>${escapeHtml(concept.why)}</p>`),
  );
  sections.push(
    slide(
      "Vision",
      `<p class="dm-eyebrow">Concept</p>${heading("Vision")}<p>${escapeHtml(concept.vision)}</p>`,
    ),
  );
  sections.push(
    slide(
      "Audience",
      `<p class="dm-eyebrow">Concept</p>${heading("Who it is for")}
      <div class="dm-chips">${concept.audience
        .map((a) => `<span class="dm-chip">${escapeHtml(a)}</span>`)
        .join("")}</div>`,
    ),
  );

  // Capture slides — the split layout, one per entry with renderable media.
  const successful = capture.entries.filter((e) => e.status === "ok" && hasRenderableMedia(e));
  successful.forEach((entry, index) => {
    const captionMd =
      captions.find((c) => c.shotId === entry.shotId)?.markdown ??
      ("caption" in entry.shot ? entry.shot.caption : "");
    sections.push(
      splitSlide(
        `Running ${index + 1}`,
        `<p class="dm-eyebrow">Running</p>
         <h2 class="dm-long">Captured from the booted app.</h2>
         <p class="dm-small">${escapeHtml(captionMd || entry.shotId)}</p>`,
        `<figure>${embedAsset(entry, "", assetsBasePath)}<figcaption class="dm-caption">${escapeHtml(
          entry.shotId,
        )}</figcaption></figure>`,
      ),
    );
  });

  // Stack as a hairline grid rather than a table: each cell is one fact.
  const stack = technical.stack.slice(0, 9);
  if (stack.length > 0) {
    sections.push(
      slide(
        "Stack",
        `${eyebrow("Technical stack")}
        <div class="dm-grid dm-grid-3">
          ${stack
            .map(
              (s) =>
                `<div class="dm-cell"><span class="dm-title">${escapeHtml(
                  s.technology,
                )}</span><span class="dm-body"><code>${escapeHtml(s.evidence)}</code></span></div>`,
            )
            .join("")}
        </div>`,
      ),
    );
  }

  sections.push(
    slide(
      "Architecture",
      `${eyebrow("Architecture")}${heading("How it is put together")}<p>${escapeHtml(
        technical.architecture,
      )}</p>`,
    ),
  );
  sections.push(
    slide(
      "Data flow",
      `<p class="dm-eyebrow">Architecture</p>${heading("Data flow")}<p>${escapeHtml(technical.dataFlow)}</p>`,
    ),
  );

  sections.push(
    slide(
      "Key modules",
      `${eyebrow("Key modules")}
      <div class="dm-rows">
        ${technical.keyModules
          .slice(0, 6)
          .map(
            (m) =>
              `<div class="dm-row"><span class="dm-key">${escapeHtml(
                m.path,
              )}</span><span class="dm-val">${escapeHtml(m.oneLineSummary)}</span></div>`,
          )
          .join("")}
      </div>`,
    ),
  );

  sections.push(
    slide(
      "Getting started",
      `${eyebrow("Getting started")}
      <pre><code>${technical.gettingStarted.map(escapeHtml).join("\n")}</code></pre>`,
    ),
  );

  // Closing slide — the second and last place the gradient appears.
  sections.push(
    slide(
      "Takeaway",
      `${MESH_CLOSE}
      <p class="dm-eyebrow">Takeaway</p>
      <p class="dm-quote">${escapeHtml(summary.oneLiner)}</p>
      <p class="dm-meta">Generated by DoceoMenter · report.md · deck.pdf · case-study.json</p>
      <p class="dm-meta">run ${escapeHtml(runId)} · ${escapeHtml(generatedAt)}</p>`,
    ),
  );

  return sections.join("\n");
}

const MESH_OPEN = `<div class="dm-mesh"><span class="a"></span><span class="b"></span></div>`;
const MESH_CLOSE = `<div class="dm-mesh"><span class="c"></span></div>`;

/**
 * A slide. `data-title` is what names it in a filmstrip — the app's outputs
 * viewer reads it straight off the section, so short labels here beat parsing
 * a heading that may be a whole sentence.
 */
function slide(title: string, body: string): string {
  return `<section data-title="${escapeHtml(title)}"><div class="dm-slide">${body}</div></section>`;
}

function splitSlide(title: string, left: string, right: string): string {
  return `<section data-title="${escapeHtml(
    title,
  )}"><div class="dm-slide dm-split"><div class="dm-pane">${left}</div>${right}</div></section>`;
}

/**
 * Serif headings are display type, so a sentence that would set at 46px and
 * overflow the stage steps down a size instead of being truncated.
 */
function heading(text: string): string {
  const long = text.length > 64;
  return `<h2${long ? ' class="dm-long"' : ""}>${escapeHtml(text)}</h2>`;
}

/** Hairline grids come in two, three and four columns — nothing else reads well at this size. */
function gridCols(count: number): 2 | 3 | 4 {
  if (count >= 4) return 4;
  if (count === 3) return 3;
  return 2;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date
    .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    .toUpperCase();
}

function embedAsset(e: CaptureManifestEntry, captionMd: string, base: string): string {
  if (!e.outputs) return `<p class="dm-caption">(no asset)</p>`;
  const captionBlock = captionMd ? `<p class="dm-caption">${escapeHtml(captionMd)}</p>` : "";
  if (e.outputs.webpPath || e.outputs.pngPath) {
    const path = e.outputs.webpPath ?? e.outputs.pngPath!;
    const src = escapeHtml(assetRef(base, path, "screenshots"));
    return `<img src="${src}" alt="${escapeHtml(captionMd || "capture")}" />${captionBlock}`;
  }
  if (e.outputs.mp4Path || e.outputs.webmPath) {
    const v = e.outputs.mp4Path ?? e.outputs.webmPath!;
    const ext = extname(v).slice(1);
    const mime = ext === "mp4" ? "video/mp4" : "video/webm";
    const poster = e.outputs.posterPath
      ? ` poster="${escapeHtml(assetRef(base, e.outputs.posterPath, "videos"))}"`
      : "";
    const src = escapeHtml(assetRef(base, v, "videos"));
    return `<video controls preload="metadata"${poster}>
      <source src="${src}" type="${mime}" />
    </video>${captionBlock}`;
  }
  return `<p class="dm-caption">(no asset)</p>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
