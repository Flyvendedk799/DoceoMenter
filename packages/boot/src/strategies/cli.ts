import type { BootedApp, Logger } from "./common.js";

/**
 * For CLI / library / unknown projects there is nothing to boot. The
 * capture engine will handle these via architecture diagrams + GitHub
 * README screenshots, so this returns a "noop" booted app whose URL is
 * unusable — the runner must check strategy.kind and skip live-app shots.
 */
export async function bootNoop(_repoDir: string, log: Logger): Promise<BootedApp> {
  log("[boot] no-op boot (cli/library/unknown)");
  return {
    url: "about:blank",
    kill: async () => {},
  };
}
