import { mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  CaptureManifest,
  CaptureManifestEntry,
  CapturePlan,
  Interaction,
  Shot,
} from "@doceomenter/shared";
import { launchBrowser, type BrowserHandle } from "./browser.js";
import { evaluateImageQuality } from "./quality.js";
import { extractPosterFrame, hasFfmpeg, transcodeWebmToMp4 } from "./video.js";
import { renderMermaidToPng } from "./mermaid.js";

const SHOT_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 8_000;

export type CaptureContext = {
  liveAppUrl?: string;
  ownerRepo?: string; // "owner/repo"
  outDir: string;
  log: (line: string) => void;
};

export async function runCapturePlan(
  plan: CapturePlan,
  ctx: CaptureContext,
): Promise<CaptureManifest> {
  await mkdir(join(ctx.outDir, "screenshots"), { recursive: true });
  await mkdir(join(ctx.outDir, "videos"), { recursive: true });

  const entries: CaptureManifestEntry[] = [];
  let handle: BrowserHandle;
  try {
    handle = await launchBrowser();
  } catch (e) {
    const reason = (e as Error).message;
    ctx.log(`[capture] browser unavailable: ${reason}`);
    return {
      entries: plan.shots.map((shot) => ({
        shotId: shot.id,
        shot,
        status: "failed",
        failureReason: `browser unavailable: ${reason}`,
      })),
    };
  }
  try {
    for (const shot of plan.shots) {
      const startedAt = Date.now();
      try {
        const entry = await Promise.race<CaptureManifestEntry>([
          captureOne(handle, shot, ctx),
          rejectAfter<CaptureManifestEntry>(SHOT_TIMEOUT_MS, `shot ${shot.id} timed out`),
        ]);
        entries.push(entry);
        ctx.log(`[capture] ${shot.id} ${entry.status} in ${Date.now() - startedAt}ms`);
      } catch (e) {
        const reason = (e as Error).message;
        ctx.log(`[capture] ${shot.id} failed: ${reason}`);
        entries.push({
          shotId: shot.id,
          shot,
          status: "failed",
          failureReason: reason,
        });
      }
    }
  } finally {
    await handle.close();
  }
  return { entries };
}

async function captureOne(
  handle: BrowserHandle,
  shot: Shot,
  ctx: CaptureContext,
): Promise<CaptureManifestEntry> {
  if (shot.kind === "screenshot" && shot.target === "live-app") {
    if (!ctx.liveAppUrl) {
      return { shotId: shot.id, shot, status: "skipped", failureReason: "no live app URL" };
    }
    return captureLiveAppScreenshot(handle, shot, ctx, ctx.liveAppUrl);
  }
  if (shot.kind === "video" && shot.target === "live-app") {
    if (!ctx.liveAppUrl) {
      return { shotId: shot.id, shot, status: "skipped", failureReason: "no live app URL" };
    }
    return captureLiveAppVideo(handle, shot, ctx, ctx.liveAppUrl);
  }
  if (shot.kind === "screenshot" && shot.target === "github-readme") {
    return captureReadme(handle, shot, ctx);
  }
  if (shot.kind === "screenshot" && shot.target === "code-architecture") {
    return captureMermaid(handle, shot, ctx);
  }
  // Exhaustive check — TS narrows `shot` to `never` here.
  const _exhaustive: never = shot;
  void _exhaustive;
  return {
    shotId: (shot as Shot).id,
    shot: shot as Shot,
    status: "failed",
    failureReason: `unsupported shot kind`,
  };
}

async function captureLiveAppScreenshot(
  handle: BrowserHandle,
  shot: Extract<Shot, { kind: "screenshot"; target: "live-app" }>,
  ctx: CaptureContext,
  liveAppUrl: string,
): Promise<CaptureManifestEntry> {
  const ctxBrowser = await handle.newContext({
    blockNetwork: "third-party",
    liveAppOriginAllowList: [liveAppUrl],
  });
  const page = await ctxBrowser.newPage();
  await page.setViewportSize({ width: shot.viewport.w, height: shot.viewport.h });
  const fullUrl = new URL(shot.route, liveAppUrl).toString();
  try {
    await page.goto(fullUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS }).catch(async () => {
      await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    });
    if (shot.waitFor) {
      // Best-effort: a wrong waitFor selector should not fail an otherwise-good
      // screenshot.
      await page.waitForSelector(shot.waitFor, { timeout: 5_000 }).catch(() => {
        ctx.log(`[capture] ${shot.id} waitFor "${shot.waitFor}" not found — continuing`);
      });
    }
    if (shot.interactions) {
      await runInteractions(page, shot.interactions, 0, ctx.log);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);

    const pngPath = join(ctx.outDir, "screenshots", `${shot.id}.png`);
    await page.screenshot({
      path: pngPath,
      type: "png",
      fullPage: shot.fullPage ?? false,
      animations: "disabled",
    });
    const quality = await evaluateImageQuality(pngPath);
    if (!quality.ok) {
      return {
        shotId: shot.id,
        shot,
        status: "failed",
        failureReason: `quality gate: ${quality.reasons.join(", ")}`,
      };
    }
    const buf = await readFile(pngPath);
    return {
      shotId: shot.id,
      shot,
      status: "ok",
      outputs: {
        pngPath,
        width: quality.metrics.width,
        height: quality.metrics.height,
        bytes: buf.byteLength,
        sha256: createHash("sha256").update(buf).digest("hex"),
      },
    };
  } finally {
    await ctxBrowser.close();
  }
}

async function captureLiveAppVideo(
  handle: BrowserHandle,
  shot: Extract<Shot, { kind: "video"; target: "live-app" }>,
  ctx: CaptureContext,
  liveAppUrl: string,
): Promise<CaptureManifestEntry> {
  const videoDir = join(ctx.outDir, "videos");
  const ctxBrowser = await handle.newContext({
    recordVideoDir: videoDir,
    videoSize: { width: 1280, height: 720 },
    blockNetwork: "third-party",
    liveAppOriginAllowList: [liveAppUrl],
  });
  const page = await ctxBrowser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  const url = new URL(shot.route, liveAppUrl).toString();
  const startedAt = Date.now();
  const video = page.video();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await runInteractions(page, shot.script, 250, ctx.log);
    const elapsed = Date.now() - startedAt;
    if (elapsed < shot.maxDurationMs) {
      await page.waitForTimeout(Math.min(2000, shot.maxDurationMs - elapsed));
    }
  } finally {
    // Closing the context finalizes the recording; always do it, even on error.
    await ctxBrowser.close().catch(() => {});
  }
  const webmPath = join(videoDir, `${shot.id}.webm`);
  if (video) {
    // saveAs() waits for the recording to flush — far more robust than racing a
    // rename against an unflushed temp file.
    await video.saveAs(webmPath).catch(() => {});
    await video.delete().catch(() => {});
  }
  let webmSize = 0;
  try {
    webmSize = (await stat(webmPath)).size;
  } catch {}
  if (!video || webmSize === 0) {
    return { shotId: shot.id, shot, status: "failed", failureReason: "no video produced" };
  }
  const outputs: NonNullable<CaptureManifestEntry["outputs"]> = { webmPath, durationMs: Date.now() - startedAt };
  if (await hasFfmpeg()) {
    const mp4Path = webmPath.replace(/\.webm$/, ".mp4");
    try {
      await transcodeWebmToMp4(webmPath, mp4Path);
      outputs.mp4Path = mp4Path;
      const posterPath = mp4Path.replace(/\.mp4$/, ".jpg");
      await extractPosterFrame(mp4Path, posterPath);
      outputs.posterPath = posterPath;
    } catch (e) {
      ctx.log(`[capture] video transcode/poster failed: ${(e as Error).message}`);
    }
  } else {
    ctx.log(`[capture] ffmpeg not present — keeping WebM only`);
  }
  return { shotId: shot.id, shot, status: "ok", outputs };
}

async function captureReadme(
  handle: BrowserHandle,
  shot: Extract<Shot, { kind: "screenshot"; target: "github-readme" }>,
  ctx: CaptureContext,
): Promise<CaptureManifestEntry> {
  if (!ctx.ownerRepo) {
    return { shotId: shot.id, shot, status: "skipped", failureReason: "owner/repo unknown" };
  }
  const ctxBrowser = await handle.newContext({});
  const page = await ctxBrowser.newPage();
  try {
    const url = `https://github.com/${ctx.ownerRepo}${shot.section ? `#${shot.section}` : ""}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const md = page.locator(".markdown-body, article.markdown-body");
    const pngPath = join(ctx.outDir, "screenshots", `${shot.id}.png`);
    if (await md.count()) {
      await md.first().screenshot({ path: pngPath, type: "png", animations: "disabled" });
    } else {
      await page.screenshot({ path: pngPath, type: "png", fullPage: false, animations: "disabled" });
    }
    const q = await evaluateImageQuality(pngPath);
    if (!q.ok) {
      return { shotId: shot.id, shot, status: "failed", failureReason: `quality gate: ${q.reasons.join(", ")}` };
    }
    const buf = await readFile(pngPath);
    return {
      shotId: shot.id,
      shot,
      status: "ok",
      outputs: {
        pngPath,
        width: q.metrics.width,
        height: q.metrics.height,
        bytes: buf.byteLength,
        sha256: createHash("sha256").update(buf).digest("hex"),
      },
    };
  } finally {
    await ctxBrowser.close();
  }
}

async function captureMermaid(
  handle: BrowserHandle,
  shot: Extract<Shot, { kind: "screenshot"; target: "code-architecture" }>,
  ctx: CaptureContext,
): Promise<CaptureManifestEntry> {
  const pngPath = join(ctx.outDir, "screenshots", `${shot.id}.png`);
  try {
    const dim = await renderMermaidToPng(handle, shot.diagramSpec.mermaid, pngPath);
    const buf = await readFile(pngPath);
    return {
      shotId: shot.id,
      shot,
      status: "ok",
      outputs: {
        pngPath,
        width: dim.width,
        height: dim.height,
        bytes: buf.byteLength,
        sha256: createHash("sha256").update(buf).digest("hex"),
      },
    };
  } catch (e) {
    return { shotId: shot.id, shot, status: "failed", failureReason: (e as Error).message };
  }
}

const INTERACTION_TIMEOUT_MS = 4_000;

async function runInteractions(
  page: import("playwright").Page,
  interactions: Interaction[],
  defaultDelayMs = 0,
  log?: (line: string) => void,
): Promise<void> {
  const opts = { timeout: INTERACTION_TIMEOUT_MS };
  for (const i of interactions) {
    if (defaultDelayMs > 0) await page.waitForTimeout(defaultDelayMs);
    // Interactions are best-effort: a stale/missing selector from the generated
    // plan must not abort the whole shot (or, for video, leak its context).
    try {
      if (i.do === "click") await page.locator(i.selector).first().click({ trial: false, ...opts });
      else if (i.do === "fill") await page.locator(i.selector).first().fill(i.text, opts);
      else if (i.do === "hover") await page.locator(i.selector).first().hover(opts);
      else if (i.do === "scrollTo")
        await page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ block: "center" });
        }, i.selector);
      else if (i.do === "wait") await page.waitForTimeout(i.ms);
      else if (i.do === "press") await page.keyboard.press(i.key);
    } catch (e) {
      log?.(`[capture] interaction ${i.do} skipped: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

function rejectAfter<T>(ms: number, msg: string): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}
