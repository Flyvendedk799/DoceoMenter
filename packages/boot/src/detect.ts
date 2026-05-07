import type { Analysis, BootStrategy } from "@doceomenter/shared";

const DEFAULT_PORT = 5173;

export function detectStrategy(a: Analysis, dockerEnabled = false): BootStrategy {
  const pkg = a.manifests.nodePkg;

  // 1. Next.js
  if (pkg && (pkg.deps.includes("next") || pkg.devDeps.includes("next"))) {
    if (
      a.fileIndex.some((f) => f.path.startsWith("pages/")) ||
      a.fileIndex.some((f) => f.path.startsWith("app/"))
    ) {
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

  // 4. Vite
  if (pkg && pkg.devDeps.includes("vite") && hasFile(a, /^vite\.config\.(t|j|m)s$/)) {
    return { kind: "vite", pkgManager: detectPM(a), port: 5173 };
  }
  if (pkg && pkg.deps.includes("vite") && hasFile(a, /^vite\.config\.(t|j|m)s$/)) {
    return { kind: "vite", pkgManager: detectPM(a), port: 5173 };
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

  // 8. Node server
  if (pkg && pkg.scripts.start) {
    if (looksLikeServer(a)) {
      return {
        kind: "node-server",
        cmd: `${detectPM(a)} run start`,
        port: pickPortFromCode(a) ?? 3000,
      };
    }
  }

  // 9. Static
  if (a.fileIndex.some((f) => f.path === "index.html")) {
    return { kind: "static", dir: ".", port: DEFAULT_PORT };
  }
  if (a.fileIndex.some((f) => f.path === "public/index.html")) {
    return { kind: "static", dir: "public", port: DEFAULT_PORT };
  }
  if (a.fileIndex.some((f) => f.path === "docs/index.html")) {
    return { kind: "static", dir: "docs", port: DEFAULT_PORT };
  }

  // 10. CLI
  if (pkg && (pkg as { bin?: unknown }).bin !== undefined) {
    return { kind: "cli" };
  }
  if (pkg && hasFile(a, /^scripts\/.+\.(t|j)s$/)) {
    return { kind: "cli" };
  }

  // 11. Library
  if (pkg) {
    const p = pkg as { main?: string; module?: string; exports?: unknown };
    if (p.main || p.module || p.exports) return { kind: "library" };
  }
  if (pkg && a.signals.isLibrary) {
    return { kind: "library" };
  }

  // 12. Unknown — degrade to library
  return { kind: "unknown" };
}

function detectPM(a: Analysis): "pnpm" | "npm" | "yarn" {
  if (a.fileIndex.some((f) => f.path === "pnpm-lock.yaml")) return "pnpm";
  if (a.fileIndex.some((f) => f.path === "yarn.lock")) return "yarn";
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
    return `python -m flask run --host 0.0.0.0 --port 5000`;
  }
  return `python manage.py runserver 0.0.0.0:8000`;
}
