import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { createHash } from "node:crypto";
import type { CaptureManifestEntry, Shot } from "@doceomenter/shared";
import type { BrowserHandle } from "./browser.js";

const CLI_TIMEOUT_MS = 12_000;

export type CliCaptureContext = {
  repoDir: string;
  /** Preferred commands (from captureTargets or derived bin --help). */
  commands: string[];
  outDir: string;
  log: (line: string) => void;
};

/**
 * Run a CLI command in the repo and screenshot a terminal-styled HTML page of
 * its output. Used when the product surface is CLI/TUI (or Electron fallback)
 * so we still get live product media without a browser URL.
 */
export async function captureCliLiveShot(
  handle: BrowserHandle,
  shot: Extract<Shot, { kind: "screenshot"; target: "live-app" }>,
  ctx: CliCaptureContext,
): Promise<CaptureManifestEntry> {
  const command = pickCommand(shot, ctx.commands);
  ctx.log(`[capture] cli live: ${command}`);

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await execa("bash", ["-lc", command], {
      cwd: ctx.repoDir,
      timeout: CLI_TIMEOUT_MS,
      reject: false,
      env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
    exitCode = result.exitCode ?? 0;
  } catch (e) {
    stderr = (e as Error).message;
    exitCode = 1;
  }

  const body = [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)";
  const html = terminalHtml({
    title: shot.caption || command,
    cwd: ctx.repoDir.split("/").slice(-2).join("/"),
    command,
    body,
    exitCode,
  });

  await mkdir(join(ctx.outDir, "screenshots"), { recursive: true });
  const htmlPath = join(ctx.outDir, "screenshots", `${shot.id}.cli.html`);
  await writeFile(htmlPath, html, "utf-8");

  const browserCtx = await handle.newContext({ blockNetwork: "all", colorScheme: "dark" });
  try {
    const page = await browserCtx.newPage();
    await page.setViewportSize({
      width: shot.viewport?.w ?? 1280,
      height: shot.viewport?.h ?? 800,
    });
    await page.goto(`file://${htmlPath}`, { waitUntil: "domcontentloaded", timeout: 8_000 });
    const pngPath = join(ctx.outDir, "screenshots", `${shot.id}.png`);
    await page.screenshot({ path: pngPath, type: "png", fullPage: true });
    const { stat } = await import("node:fs/promises");
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(pngPath);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const st = await stat(pngPath);
    return {
      shotId: shot.id,
      shot,
      status: "ok",
      outputs: {
        pngPath,
        width: shot.viewport?.w ?? 1280,
        height: shot.viewport?.h ?? 800,
        bytes: st.size,
        sha256,
      },
    };
  } finally {
    await browserCtx.close();
  }
}

function pickCommand(
  shot: Extract<Shot, { kind: "screenshot"; target: "live-app" }>,
  commands: string[],
): string {
  const route = typeof shot.route === "string" ? shot.route.trim() : "";
  // Guided targets may put a shell command in route (not a URL path).
  if (route && !route.startsWith("/") && /[a-zA-Z0-9_-]/.test(route)) {
    return route;
  }
  if (commands.length > 0) return commands[0]!;
  return "echo 'no CLI command configured'";
}

/** Derive sensible default CLI commands from package.json bin + user targets. */
export function deriveCliCommands(opts: {
  bin?: unknown;
  packageName?: string;
  captureTargets?: string[];
}): string[] {
  const fromUser = (opts.captureTargets ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.startsWith("/"));
  if (fromUser.length > 0) return fromUser.slice(0, 5);

  const bins: string[] = [];
  if (typeof opts.bin === "string") bins.push(opts.bin);
  else if (opts.bin && typeof opts.bin === "object") {
    for (const [name, path] of Object.entries(opts.bin as Record<string, string>)) {
      bins.push(name);
      void path;
    }
  }
  if (bins.length > 0) {
    const primary = bins[0]!;
    // Prefer local node entry via package bin path when it looks like a file.
    if (primary.includes("/") || primary.endsWith(".js") || primary.endsWith(".mjs")) {
      return [`node ${primary} --help`, `node ${primary}`];
    }
    return [`npx --no-install ${primary} --help`, `node ./node_modules/.bin/${primary} --help`];
  }
  if (opts.packageName) {
    return [`npx --no-install ${opts.packageName} --help`];
  }
  return ["ls -la", "cat package.json | head -40"];
}

function terminalHtml(opts: {
  title: string;
  cwd: string;
  command: string;
  body: string;
  exitCode: number;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${esc(opts.title)}</title>
<style>
  html,body{margin:0;padding:0;background:#0c0f0e;color:#d7e0d9;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .win{min-height:100vh;padding:28px 32px 40px}
  .bar{display:flex;gap:8px;align-items:center;margin-bottom:18px;color:#7f8b82;font-size:12px}
  .dot{width:10px;height:10px;border-radius:50%}
  .r{background:#e35d5d}.y{background:#e3b55d}.g{background:#5de39a}
  .prompt{color:#7dcea0}.cmd{color:#f4f7f5}
  pre{white-space:pre-wrap;word-break:break-word;margin:10px 0 0;color:#c5d0c7}
  .meta{margin-top:16px;color:#667066;font-size:12px}
</style></head><body><div class="win">
  <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
  <span>${esc(opts.cwd)}</span></div>
  <div><span class="prompt">$</span> <span class="cmd">${esc(opts.command)}</span></div>
  <pre>${esc(opts.body)}</pre>
  <div class="meta">exit ${opts.exitCode} · live CLI capture</div>
</div></body></html>`;
}
