import { createServer } from "node:http";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Logger, BootedApp } from "./common.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function bootStatic(
  repoDir: string,
  subdir: string,
  port: number,
  log: Logger,
): Promise<BootedApp> {
  const root = resolve(repoDir, subdir);
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    let target = normalize(join(root, urlPath === "/" ? "" : urlPath));
    if (target !== root && !target.startsWith(root + sep)) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
    try {
      const s = statSync(target);
      if (s.isDirectory()) {
        const indexCandidates = [
          "index.html",
          "Index.html",
          "Landing.html",
          "landing.html",
          "home.html",
          "Home.html",
        ];
        let found: string | undefined;
        for (const name of indexCandidates) {
          try {
            statSync(join(target, name));
            found = join(target, name);
            break;
          } catch {
            /* try next */
          }
        }
        if (!found) {
          // First HTML in the directory (prototype bundles often lack index.html).
          try {
            const html = readdirSync(target).find(
              (n) => /\.html?$/i.test(n) && !/^404\.html?$/i.test(n),
            );
            if (html) found = join(target, html);
          } catch {
            /* ignore */
          }
        }
        if (found) target = found;
        else target = join(target, "index.html");
      }
    } catch {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    try {
      statSync(target);
    } catch {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const mime = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("content-type", mime);
    res.setHeader("cache-control", "no-store");
    createReadStream(target).pipe(res);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => resolveListen());
  });
  log(`[boot] static server on http://127.0.0.1:${port} (root=${root})`);
  return {
    url: `http://127.0.0.1:${port}`,
    kill: async () => {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
