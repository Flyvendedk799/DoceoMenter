import { chromium } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function renderPdfFromDeck(deckHtmlPath: string, outPdfPath: string): Promise<void> {
  const url = pathToFileURL(resolve(deckHtmlPath)).toString() + "?print-pdf";
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(500);
    await page.pdf({
      path: outPdfPath,
      format: "A4",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
  } finally {
    await browser.close();
  }
}
