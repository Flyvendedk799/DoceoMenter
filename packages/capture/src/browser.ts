import { chromium, type Browser, type BrowserContext } from "playwright";
import { DEFAULT_VIEWPORT, DEFAULT_DPR } from "@doceomenter/shared";

export type BrowserHandle = {
  browser: Browser;
  newContext: (opts?: ContextOpts) => Promise<BrowserContext>;
  close: () => Promise<void>;
};

export type ContextOpts = {
  recordVideoDir?: string;
  videoSize?: { width: number; height: number };
  blockNetwork?: "third-party" | "all" | "none";
  liveAppOriginAllowList?: string[];
  colorScheme?: "light" | "dark";
};

const ANIMATION_KILLER_CSS = `
*, *::before, *::after {
  animation-play-state: paused !important;
  transition: none !important;
  caret-color: transparent !important;
}
`;

export async function launchBrowser(): Promise<BrowserHandle> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--font-render-hinting=none"],
  });

  const newContext = async (opts: ContextOpts = {}) => {
    const ctx = await browser.newContext({
      viewport: { ...DEFAULT_VIEWPORT },
      deviceScaleFactor: DEFAULT_DPR,
      colorScheme: opts.colorScheme ?? "light",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
      recordVideo: opts.recordVideoDir
        ? {
            dir: opts.recordVideoDir,
            size: opts.videoSize ?? { width: 1280, height: 720 },
          }
        : undefined,
      bypassCSP: true,
      ignoreHTTPSErrors: true,
    });

    if (opts.blockNetwork && opts.blockNetwork !== "none") {
      const allow = new Set(
        (opts.liveAppOriginAllowList ?? []).map((u) => new URL(u).origin),
      );
      await ctx.route("**/*", (route) => {
        const origin = new URL(route.request().url()).origin;
        if (
          opts.blockNetwork === "all" &&
          origin.startsWith("http") &&
          !allow.has(origin) &&
          !origin.startsWith("http://127.0.0.1") &&
          !origin.startsWith("http://localhost")
        ) {
          route.abort();
          return;
        }
        if (opts.blockNetwork === "third-party" && !allow.has(origin) &&
            !origin.startsWith("http://127.0.0.1") && !origin.startsWith("http://localhost")) {
          route.abort();
          return;
        }
        route.continue();
      });
    }

    await ctx.addInitScript(`document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = ${JSON.stringify(ANIMATION_KILLER_CSS)};
      document.head.appendChild(s);
    });`);

    return ctx;
  };

  return {
    browser,
    newContext,
    close: () => browser.close(),
  };
}
