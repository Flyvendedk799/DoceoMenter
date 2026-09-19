import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { BrowserHandle } from "./browser.js";
import { sanitizeMermaidSpec } from "./sanitizeMermaid.js";

// dist/mermaid.js sits next to the assets folder when packaged: dist/ + ../assets/
const here = dirname(fileURLToPath(import.meta.url));
const assetsHtmlPath = resolve(here, "..", "assets", "mermaid-harness.html");

export async function renderMermaidToPng(
  handle: BrowserHandle,
  spec: string,
  outPath: string,
): Promise<{ width: number; height: number }> {
  const sanitized = sanitizeMermaidSpec(spec);
  const ctx = await handle.newContext({ blockNetwork: "all" });
  try {
    const page = await ctx.newPage();
    await page.goto("file://" + assetsHtmlPath, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof (window as any).__renderMermaid === "function", null, {
      timeout: 5_000,
    });
    // Mermaid parse failures throw plain objects ({ str, message, ... }), which
    // Playwright serializes as `page.evaluate: Object`. Re-throw as Error.
    await page.evaluate(async (s: string) => {
      try {
        await (window as any).__renderMermaid(s);
      } catch (e: unknown) {
        const err = e as { str?: string; message?: string };
        const msg =
          (typeof err?.str === "string" && err.str) ||
          (typeof err?.message === "string" && err.message) ||
          (typeof e === "string" ? e : "mermaid render failed");
        throw new Error(msg);
      }
    }, sanitized);
    await page.waitForSelector("#diagram svg", { timeout: 5_000 });
    const el = page.locator("#wrap");
    const box = await el.boundingBox();
    const width = Math.round(box?.width ?? 0);
    const height = Math.round(box?.height ?? 0);
    if (width === 0 || height === 0) {
      throw new Error("mermaid diagram rendered with zero dimensions");
    }
    await el.screenshot({ path: outPath, type: "png", omitBackground: false });
    return { width, height };
  } finally {
    await ctx.close().catch(() => {});
  }
}
