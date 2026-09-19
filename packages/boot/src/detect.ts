import type { Analysis, BootStrategy } from "@doceomenter/shared";

const DEFAULT_PORT = 5173;

const STATIC_HTML_DIRS = [
  "project",
  "admin",
  "client",
  "frontend",
  "web",
  "www",
  "site",
  "static",
  "public",
  "docs",
  "design",
  "prototype",
  "prototypes",
] as const;

export function detectStrategy(a: Analysis, dockerEnabled = false): BootStrategy {
  const pkg = a.manifests.nodePkg;
  const packageDir = a.manifests.packageDir ?? ".";

  // 1. Next.js — supports both the root and the common `src/` layout.
  if (pkg && (pkg.deps.includes("next") || pkg.devDeps.includes("next"))) {
    if (a.fileIndex.some((f) => /^(src\/)?(app|pages)\//.test(f.path))) {
      return { kind: "next", pkgManager: detectPM(a), port: 3000 };
    }
  }

  // 2. Astro
  if (pkg && (pkg.deps.includes("astro") || pkg.devDeps.includes("astro"))) {
    return { kind: "astro", pkgManager: detectPM(a), port: 4321 };
  }

  // 3. SvelteKit (treat as astro shape — booted via dev script)
  if (pkg && (pkg.deps.includes("@sveltejs/kit") || pkg.devDeps.includes("@sveltejs/kit"))) {
    return { kind: "astro", pkgManager: detectPM(a), port: 5173 };
  }

  // 4. Vite (root or nested monorepo app, e.g. CraftMagic apps/web)
  const viteApp = findViteAppDir(a);
  if (viteApp) {
    return {
      kind: "vite",
      pkgManager: detectPM(a),
      port: DEFAULT_PORT,
      ...(viteApp !== "." ? { cwd: viteApp } : {}),
    };
  }

  // 5. CRA
  if (pkg && (pkg.deps.includes("react-scripts") || pkg.devDeps.includes("react-scripts"))) {
    return { kind: "cra", pkgManager: detectPM(a), port: 3000 };
  }

  // 6. Docker (gated)
  if (dockerEnabled && a.manifests.composeYml) {
    const port = a.manifests.dockerfile?.exposedPorts?.[0] ?? DEFAULT_PORT;
    return {
      kind: "docker",
      composeService: a.manifests.composeYml.services[0],
      port,
    };
  }

  // 7. Python web framework
  const pyDeps = [
    ...(a.manifests.pythonPyproject?.deps ?? []),
    ...(a.manifests.pythonRequirements ?? []),
  ].map((d) => d.toLowerCase());
  if (pyDeps.some((d) => d.startsWith("fastapi"))) {
    return { kind: "python-web", cmd: pickPythonCmd(a, "fastapi"), port: 8000 };
  }
  if (pyDeps.some((d) => d.startsWith("flask"))) {
    return { kind: "python-web", cmd: pickPythonCmd(a, "flask"), port: 5000 };
  }
  if (pyDeps.some((d) => d.startsWith("django"))) {
    return { kind: "python-web", cmd: pickPythonCmd(a, "django"), port: 8000 };
  }

  // 8. Static HTML prototypes / sites (before node-server so design handoffs
  // like FM-Ecommerce — HTML in project/ + Express in backend/ — get live UI shots).
  const staticDir = findStaticHtmlDir(a);
  if (staticDir !== undefined) {
    return { kind: "static", dir: staticDir, port: DEFAULT_PORT };
  }

  // 9. Node server (root or nested packageDir e.g. backend/)
  if (pkg && pkg.scripts.start && looksLikeServer(a)) {
    const pm = detectPM(a);
    const cwd = packageDir !== "." ? packageDir : undefined;
    return {
      kind: "node-server",
      cmd: `${pm} run start`,
      port: pickPortFromCode(a) ?? 3000,
      ...(cwd ? { cwd } : {}),
    };
  }

  // 10. Electron (desktop window — not a browser URL Playwright can open yet)
  if (a.signals.hasElectron) {
    return { kind: "electron" };
  }
  if (pkg && (pkg.deps.includes("electron") || pkg.devDeps.includes("electron"))) {
    return { kind: "electron" };
  }

  // 11. CLI
  if (pkg && (pkg as { bin?: unknown }).bin !== undefined) {
    return { kind: "cli" };
  }
  if (pkg && hasFile(a, /^scripts\/.+\.(t|j)s$/)) {
    return { kind: "cli" };
  }

  // 12. Library
  if (pkg) {
    const p = pkg as { main?: string; module?: string; exports?: unknown };
    if (p.main || p.module || p.exports) return { kind: "library" };
  }
  if (pkg && a.signals.isLibrary) {
    return { kind: "library" };
  }

  // 13. Unknown — degrade to library
  return { kind: "unknown" };
}

/** Prefer well-known prototype/site dirs with HTML; used by prompts for live routes. */
export function findStaticHtmlDir(a: Analysis): string | undefined {
  const allPaths = new Set(a.fileIndex.map((f) => f.path));
  const html = a.fileIndex
    .map((f) => f.path)
    .filter(
      (p) =>
        /\.html?$/i.test(p) &&
        !p.includes("node_modules/") &&
        !isBundlerSpaHtml(p, allPaths),
    );
  if (html.length === 0) return undefined;

  if (html.includes("index.html")) return ".";
  if (html.includes("public/index.html")) return "public";
  if (html.includes("docs/index.html")) return "docs";

  const counts = new Map<string, { n: number; files: string[] }>();
  for (const p of html) {
    const slash = p.indexOf("/");
    if (slash < 0) continue;
    const top = p.slice(0, slash);
    // Monorepo `apps/` is almost never a static prototype root — skip unless it
    // also matches a known prototype dir name below (it does not).
    if (top === "apps" || top === "packages") continue;
    const cur = counts.get(top) ?? { n: 0, files: [] };
    cur.n += 1;
    cur.files.push(p.slice(slash + 1));
    counts.set(top, cur);
  }

  for (const dir of STATIC_HTML_DIRS) {
    const hit = counts.get(dir);
    if (hit && hit.n >= 1) return dir;
  }

  let best: string | undefined;
  let bestN = 0;
  for (const [dir, { n }] of counts) {
    if (n > bestN) {
      best = dir;
      bestN = n;
    }
  }
  return bestN >= 1 ? best : undefined;
}

/**
 * Directory containing a Vite app (`.` or e.g. `apps/web`). Prefer apps/web,
 * then other apps/*, then any vite.config in the tree.
 */
export function findViteAppDir(a: Analysis): string | undefined {
  const pkg = a.manifests.nodePkg;
  if (
    pkg &&
    (pkg.deps.includes("vite") || pkg.devDeps.includes("vite")) &&
    hasFile(a, /^vite\.config\.(t|j|m)s$/)
  ) {
    return ".";
  }

  const configs = a.fileIndex
    .map((f) => f.path)
    .filter((p) => /(^|\/)vite\.config\.(t|j|m)s$/.test(p) && !p.includes("node_modules/"));
  if (configs.length === 0) return undefined;

  const rank = (p: string): number => {
    if (p === "vite.config.ts" || p === "vite.config.js" || p === "vite.config.mjs") return 0;
    if (/^apps\/web\//.test(p)) return 1;
    if (/^web\//.test(p)) return 2;
    if (/^apps\/[^/]+\//.test(p)) return 3;
    if (/^client\//.test(p) || /^frontend\//.test(p)) return 4;
    return 5;
  };
  configs.sort((x, y) => rank(x) - rank(y) || x.length - y.length);
  const best = configs[0]!;
  const slash = best.lastIndexOf("/");
  return slash < 0 ? "." : best.slice(0, slash);
}

/** HTML entry next to a bundler config is a SPA shell, not a static prototype. */
function isBundlerSpaHtml(htmlPath: string, allPaths: Set<string>): boolean {
  const parts = htmlPath.split("/");
  // Check this dir and ancestors for vite/next/astro config.
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts.slice(0, i).join("/");
    const prefix = dir ? `${dir}/` : "";
    const markers = [
      "vite.config.ts",
      "vite.config.js",
      "vite.config.mjs",
      "vite.config.cjs",
      "next.config.js",
      "next.config.mjs",
      "next.config.ts",
      "astro.config.mjs",
      "astro.config.ts",
    ];
    if (markers.some((m) => allPaths.has(`${prefix}${m}`))) return true;
  }
  return false;
}

/** Suggested live-app routes for a static HTML dir (Landing.html → /Landing.html). */
export function suggestStaticRoutes(a: Analysis, dir: string, limit = 6): string[] {
  const prefix = dir === "." ? "" : `${dir}/`;
  const preferredNames = [
    "Landing.html",
    "index.html",
    "Index.html",
    "home.html",
    "Home.html",
    "Kategorier.html",
    "shop.html",
    "Shop.html",
  ];
  const files = a.fileIndex
    .map((f) => f.path)
    .filter((p) => p.startsWith(prefix) && /\.html?$/i.test(p) && !p.includes("node_modules/"))
    .map((p) => (prefix ? p.slice(prefix.length) : p))
    .filter((p) => p.length > 0 && !p.includes("/"));

  const ordered: string[] = [];
  for (const name of preferredNames) {
    if (files.includes(name)) ordered.push(`/${name}`);
  }
  for (const f of files.sort()) {
    const route = `/${f}`;
    if (!ordered.includes(route) && !/404\.html?$/i.test(f)) ordered.push(route);
  }
  return ordered.slice(0, limit);
}

function detectPM(a: Analysis): "pnpm" | "npm" | "yarn" {
  if (a.fileIndex.some((f) => f.path === "pnpm-lock.yaml" || f.path.endsWith("/pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (a.fileIndex.some((f) => f.path === "yarn.lock" || f.path.endsWith("/yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

function hasFile(a: Analysis, re: RegExp): boolean {
  return a.fileIndex.some((f) => re.test(f.path));
}

function looksLikeServer(a: Analysis): boolean {
  const serverDeps = ["express", "koa", "fastify", "hono", "@nestjs/core"];
  const pkg = a.manifests.nodePkg;
  if (!pkg) return false;
  return serverDeps.some((d) => pkg.deps.includes(d) || pkg.devDeps.includes(d));
}

function pickPortFromCode(_a: Analysis): number | undefined {
  return undefined; // out of scope — could grep for app.listen(<n>)
}

function pickPythonCmd(a: Analysis, framework: "fastapi" | "flask" | "django"): string {
  if (framework === "fastapi") {
    const main = a.fileIndex.find((f) => /\bmain\.py$/.test(f.path));
    const mod = main ? main.path.replace(/\//g, ".").replace(/\.py$/, "") : "main";
    return `python -m uvicorn ${mod}:app --host 0.0.0.0 --port 8000`;
  }
  if (framework === "flask") {
    // `flask run` needs to know the app module; without --app it only works if
    // an app.py/wsgi.py sits in the cwd. Point it at a discovered entry module.
    const entry = a.fileIndex.find((f) => /(^|\/)(app|wsgi|main|application)\.py$/.test(f.path));
    const mod = entry ? entry.path.replace(/\//g, ".").replace(/\.py$/, "") : "app";
    return `python -m flask --app ${mod} run --host 0.0.0.0 --port 5000`;
  }
  // Django: locate manage.py rather than assuming it is at the repo root.
  const manage = a.fileIndex.find((f) => /(^|\/)manage\.py$/.test(f.path));
  return `python ${manage ? manage.path : "manage.py"} runserver 0.0.0.0:8000`;
}
