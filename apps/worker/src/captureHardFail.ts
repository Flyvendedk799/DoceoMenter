/**
 * When to abort because *browser* live-app Playwright capture failed.
 *
 * A missing liveAppUrl is not a Playwright failure — many real products are not
 * an HTML page (CLI/TUI, Electron, libraries with a terminal demo). Those shots
 * are skipped today, not "failed capture." Hard-fail only when we had a
 * browser URL and still got zero live-app successes (run c71f7cb4085c wrongly
 * treated ai-auth's library skip as a Playwright outage).
 */
export function shouldHardFailMissingLiveApp(opts: {
  plannedLive: number;
  liveOk: number;
  liveAppUrl: string | undefined;
}): boolean {
  return opts.plannedLive > 0 && opts.liveOk === 0 && Boolean(opts.liveAppUrl);
}
