import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { execa } from "execa";

const require = createRequire(import.meta.url);

/**
 * Download Chromium for the Playwright version pinned in this package.
 * Used when launch fails with the classic "Executable doesn't exist" gap on a
 * host that ran `pnpm install` without `playwright install`.
 */
export async function ensureChromiumInstalled(
  log: (line: string) => void = () => {},
): Promise<void> {
  const pkgJson = require.resolve("playwright/package.json");
  const cli = join(dirname(pkgJson), "cli.js");
  log(`[capture] installing Playwright Chromium via ${cli}`);
  await execa(process.execPath, [cli, "install", "chromium"], {
    timeout: 3 * 60_000,
    reject: true,
  });
}

export function isMissingBrowserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /Executable doesn't exist/i.test(message) ||
    /browserType\.launch/i.test(message) ||
    /Please run the following command to download new browsers/i.test(message)
  );
}
