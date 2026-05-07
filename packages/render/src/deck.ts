import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, basename, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaptureManifestEntry } from "@doceomenter/shared";
import type { RenderInput } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, "..", "assets");

export async function renderDeck(input: RenderInput, outPath: string): Promise<string> {
  const html = await buildDeckHtml(input);
  await writeFile(outPath, html, "utf-8");
  // Copy needed media assets next to the deck so it works as a static bundle.
  // Caller is responsible for ensuring assetsBasePath resolves.
  return html;
}

async function buildDeckHtml(input: RenderInput): Promise<string> {
  const [revealCss, themeCss, revealJs] = await Promise.all([
    readFile(join(ASSETS, "reveal.min.css"), "utf-8"),
    readFile(join(ASSETS, "reveal-theme.min.css"), "utf-8"),
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
<style>${themeCss}</style>
<style>
  :root { --r-main-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif; --r-heading-font: var(--r-main-font); }
  .reveal .slides { text-align: left; }
  .reveal h1, .reveal h2, .reveal h3 { text-transform: none; letter-spacing: -0.01em; }
  .reveal img { max-height: 70vh; object-fit: contain; box-shadow: 0 8px 32px rgba(0,0,0,0.12); border-radius: 8px; }
  .reveal video { max-height: 70vh; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.12); }
  .reveal .caption { font-size: 0.55em; color: #555; margin-top: 0.6em; }
  .reveal table { font-size: 0.6em; }
  .reveal pre code { max-height: 60vh; }
  .reveal .meta { font-size: 0.5em; color: #777; margin-top: 1em; }
  .reveal .tldr li { margin-bottom: 0.4em; }
  @media print {
    .reveal img, .reveal video { box-shadow: none; }
  }
</style>
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
      width: 1280,
      height: 800,
      margin: 0.06
    });
  }
</script>
</body>
</html>`;
}

function buildSlides(input: RenderInput): string {
  const { content, analysis, capture, assetsBasePath, runId, generatedAt } = input;
  const { concept, technical, summary, captions } = content;
  const { repo } = analysis;

  const sections: string[] = [];

  // Title slide
  sections.push(`<section>
    <h1>${escapeHtml(repo.name)}</h1>
    <p style="font-size: 1.4em;">${escapeHtml(summary.oneLiner)}</p>
    <p class="meta"><code>${escapeHtml(repo.owner)}/${escapeHtml(repo.name)}</code> @ <code>${escapeHtml(repo.ref)}</code> &middot; ${escapeHtml(generatedAt)}</p>
  </section>`);

  // TL;DR
  sections.push(`<section>
    <h2>TL;DR</h2>
    <ul class="tldr">${summary.tldr.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
  </section>`);

  // Concept
  sections.push(`<section>
    <h2>What is it?</h2>
    <p>${escapeHtml(concept.what)}</p>
  </section>`);
  sections.push(`<section>
    <h2>Why does it exist?</h2>
    <p>${escapeHtml(concept.why)}</p>
  </section>`);
  sections.push(`<section>
    <h2>Vision</h2>
    <p>${escapeHtml(concept.vision)}</p>
  </section>`);
  sections.push(`<section>
    <h2>Audience</h2>
    <ul>${concept.audience.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
  </section>`);

  // Capture slides — one per successful entry
  const successful = capture.entries.filter((e) => e.status === "ok");
  for (const e of successful) {
    const captionMd = captions.find((c) => c.shotId === e.shotId)?.markdown ??
      ("caption" in e.shot ? e.shot.caption : "");
    sections.push(`<section>${embedAsset(e, captionMd, assetsBasePath)}</section>`);
  }

  // Stack table
  sections.push(`<section>
    <h2>Stack</h2>
    <table>
      <thead><tr><th>Technology</th><th>Evidence</th></tr></thead>
      <tbody>${technical.stack.map((s) => `<tr><td>${escapeHtml(s.technology)}</td><td><code>${escapeHtml(s.evidence)}</code></td></tr>`).join("")}</tbody>
    </table>
  </section>`);

  sections.push(`<section>
    <h2>Architecture</h2>
    <p style="font-size: 0.7em;">${escapeHtml(technical.architecture)}</p>
  </section>`);

  sections.push(`<section>
    <h2>Data flow</h2>
    <p style="font-size: 0.7em;">${escapeHtml(technical.dataFlow)}</p>
  </section>`);

  sections.push(`<section>
    <h2>Key modules</h2>
    <ul style="font-size: 0.65em;">${technical.keyModules
      .map(
        (m) => `<li><code>${escapeHtml(m.path)}</code> — <em>${escapeHtml(m.role)}</em>: ${escapeHtml(m.oneLineSummary)}</li>`,
      )
      .join("")}</ul>
  </section>`);

  sections.push(`<section>
    <h2>Getting started</h2>
    <pre><code class="bash">${technical.gettingStarted.map(escapeHtml).join("\n")}</code></pre>
  </section>`);

  // Footer
  sections.push(`<section>
    <h2>Generated by DoceoMenter</h2>
    <p class="meta">Run id: <code>${escapeHtml(runId)}</code></p>
    <p class="meta">${escapeHtml(generatedAt)}</p>
  </section>`);

  return sections.join("\n");
}

function embedAsset(e: CaptureManifestEntry, captionMd: string, base: string): string {
  if (!e.outputs) return `<p>(no asset)</p>`;
  const captionBlock = captionMd ? `<p class="caption">${escapeHtml(captionMd)}</p>` : "";
  if (e.outputs.webpPath || e.outputs.pngPath) {
    const path = e.outputs.webpPath ?? e.outputs.pngPath!;
    return `<img src="${base}/${lastTwo(path)}" alt="${escapeHtml(captionMd || "capture")}" />${captionBlock}`;
  }
  if (e.outputs.mp4Path || e.outputs.webmPath) {
    const v = e.outputs.mp4Path ?? e.outputs.webmPath!;
    const ext = extname(v).slice(1);
    const mime = ext === "mp4" ? "video/mp4" : "video/webm";
    const poster = e.outputs.posterPath ? ` poster="${base}/${lastTwo(e.outputs.posterPath)}"` : "";
    return `<video controls preload="metadata"${poster}>
      <source src="${base}/${lastTwo(v)}" type="${mime}" />
    </video>${captionBlock}`;
  }
  return `<p>(no asset)</p>`;
}

function lastTwo(p: string): string {
  return p.split(/[/\\]/).slice(-2).join("/");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
