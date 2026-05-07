import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { BrowserHandle } from "./browser.js";

// dist/mermaid.js sits next to the assets folder when packaged: dist/ + ../assets/
const here = dirname(fileURLToPath(import.meta.url));
const assetsHtmlPath = resolve(here, "..", "assets", "mermaid-harness.html");

export async function renderMermaidToPng(
  handle: BrowserHandle,
  spec: string,
  outPath: string,
): Promise<{ width: number; height: number }> {
  const ctx = await handle.newContext({ blockNetwork: "all" });
  const page = await ctx.newPage();
  await page.goto("file://" + assetsHtmlPath, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof (window as any).__renderMermaid === "function", null, {
    timeout: 5_000,
  });
  await page.evaluate(async (s: string) => {
    await (window as any).__renderMermaid(s);
  }, spec);
  await page.waitForSelector("#diagram svg", { timeout: 5_000 });
  const el = page.locator("#wrap");
  await el.screenshot({ path: outPath, type: "png", omitBackground: false });
  const box = await el.boundingBox();
  await ctx.close();
  return { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
}
