import type { EffectiveCaptureSurface, ResolvedRunSpec } from "@doceomenter/shared";

/**
 * When to abort because live product capture failed.
 *
 * - skip: never hard-fail on missing live media
 * - required: hard-fail if zero live successes (any surface that was supposed to capture)
 * - if-possible: hard-fail only when a browser URL was booted and Playwright still got 0/N
 *   (CLI/Electron without a URL is skippable; Electron window capture is not ready yet)
 */
export function shouldHardFailMissingLiveApp(opts: {
  plannedLive: number;
  liveOk: number;
  liveAppUrl: string | undefined;
  liveMedia: ResolvedRunSpec["liveMedia"];
  surface: EffectiveCaptureSurface;
}): boolean {
  if (opts.liveMedia === "skip") return false;
  if (opts.liveOk > 0) return false;
  if (opts.liveMedia === "required") {
    // Required live media with nothing captured — fail for surfaces we can attempt.
    // "none" means the product has no live surface; do not fail.
    if (opts.surface === "none") return false;
    return opts.plannedLive > 0 || opts.surface === "cli" || opts.surface === "browser";
  }
  // if-possible: only treat as outage when browser was available
  return opts.plannedLive > 0 && Boolean(opts.liveAppUrl) && opts.surface === "browser";
}

export function shouldAttemptCliLiveCapture(opts: {
  liveMedia: ResolvedRunSpec["liveMedia"];
  surface: EffectiveCaptureSurface;
  liveAppUrl: string | undefined;
}): boolean {
  if (opts.liveMedia === "skip") return false;
  if (opts.liveAppUrl) return false;
  return opts.surface === "cli" || opts.surface === "electron";
}
