import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execa } from "execa";
import type { Analysis, Manifest, Signals } from "@doceomenter/shared";

const FILE_INDEX_CAP = 2000;
const README_CAP = 16_000;
const HEADING_RE = /^#{1,3}\s+(.+)$/gm;

const EXTENSION_TO_LANG: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  cpp: "C++",
  c: "C",
  h: "C",
  swift: "Swift",
  scala: "Scala",
  clj: "Clojure",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  html: "HTML",
  css: "CSS",
  scss: "Sass",
  sass: "Sass",
  md: "Markdown",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  sh: "Shell",
  bash: "Shell",
  dockerfile: "Dockerfile",
};

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "out",
  ".turbo",
  ".cache",
  ".venv",
  "__pycache__",
  ".pnpm-store",
  "coverage",
  "vendor",
  "target",
  ".idea",
  ".vscode",
]);

export async function analyzeRepo(opts: {
  repoDir: string;
  repoOwner: string;
  repoName: string;
  ref: string;
  commitSha: string;
  sizeBytes: number;
  log: (line: string) => void;
}): Promise<Analysis> {
  const { repoDir } = opts;
  const fileIndex: Analysis["fileIndex"] = [];
  const languages: Record<string, number> = {};

  await walk(repoDir, async (full, rel) => {
    if (fileIndex.length >= FILE_INDEX_CAP) return;
    const s = await stat(full);
    if (!s.isFile()) return;
    fileIndex.push({ path: rel, bytes: s.size });
    const ext = (rel.split(".").pop() ?? "").toLowerCase();
    const lang = EXTENSION_TO_LANG[ext];
    if (lang) languages[lang] = (languages[lang] ?? 0) + s.size;
  });

  const manifests: Manifest = {};

  if (existsSync(join(repoDir, "package.json"))) {
    try {
      const pkgRaw = await readFile(join(repoDir, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgRaw) as {
        name?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        engines?: Record<string, string>;
        bin?: unknown;
        main?: string;
        module?: string;
        exports?: unknown;
      };
      const node: NonNullable<Manifest["nodePkg"]> & {
        bin?: unknown;
        main?: string;
        module?: string;
        exports?: unknown;
      } = {
        name: pkg.name ?? opts.repoName,
        scripts: pkg.scripts ?? {},
        deps: Object.keys(pkg.dependencies ?? {}),
        devDeps: Object.keys(pkg.devDependencies ?? {}),
      };
      if (pkg.engines) node.engines = pkg.engines;
      if (pkg.bin !== undefined) node.bin = pkg.bin;
      if (pkg.main !== undefined) node.main = pkg.main;
      if (pkg.module !== undefined) node.module = pkg.module;
      if (pkg.exports !== undefined) node.exports = pkg.exports;
      manifests.nodePkg = node;
    } catch (e) {
      opts.log(`[analyze] package.json parse failed: ${(e as Error).message}`);
    }
  }
  if (existsSync(join(repoDir, "pyproject.toml"))) {
    const raw = await readFile(join(repoDir, "pyproject.toml"), "utf-8");
    const nameMatch = raw.match(/name\s*=\s*"([^"]+)"/);
    const deps = Array.from(
      raw.matchAll(/(?:^|\n)\s*(?:dependencies|deps)\s*=\s*\[([^\]]+)\]/g),
    ).flatMap((m) => Array.from(m[1]?.matchAll(/"([^"]+)"/g) ?? []).map((mm) => mm[1] ?? ""));
    manifests.pythonPyproject = { name: nameMatch?.[1] ?? opts.repoName, deps };
  }
  if (existsSync(join(repoDir, "requirements.txt"))) {
    const raw = await readFile(join(repoDir, "requirements.txt"), "utf-8");
    manifests.pythonRequirements = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }
  if (existsSync(join(repoDir, "Cargo.toml"))) {
    const raw = await readFile(join(repoDir, "Cargo.toml"), "utf-8");
    const m = raw.match(/\[package\][^\[]*name\s*=\s*"([^"]+)"/);
    manifests.cargoToml = { name: m?.[1] ?? opts.repoName };
  }
  if (existsSync(join(repoDir, "go.mod"))) {
    const raw = await readFile(join(repoDir, "go.mod"), "utf-8");
    const m = raw.match(/^module\s+(\S+)/m);
    if (m) manifests.goMod = { module: m[1] ?? "" };
  }
  if (existsSync(join(repoDir, "Dockerfile"))) {
    const raw = await readFile(join(repoDir, "Dockerfile"), "utf-8");
    const ports = Array.from(raw.matchAll(/^EXPOSE\s+(\d+)/gm)).map((m) => Number(m[1]));
    const cmdMatch = raw.match(/^CMD\s+\[([^\]]+)\]/m);
    const cmd = cmdMatch?.[1]
      ?.split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    manifests.dockerfile = { exposedPorts: ports, ...(cmd ? { cmd } : {}) };
  }
  for (const f of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    if (existsSync(join(repoDir, f))) {
      const raw = await readFile(join(repoDir, f), "utf-8");
      const services = Array.from(raw.matchAll(/^\s{2}([a-zA-Z0-9_-]+):/gm)).map((m) => m[1] ?? "");
      manifests.composeYml = { services: services.filter(Boolean) };
      break;
    }
  }

  let readme: Analysis["readme"] | undefined;
  for (const candidate of ["README.md", "readme.md", "README.MD", "Readme.md"]) {
    if (existsSync(join(repoDir, candidate))) {
      const raw = await readFile(join(repoDir, candidate), "utf-8");
      const headings = Array.from(raw.matchAll(HEADING_RE))
        .slice(0, 8)
        .map((m) => (m[1] ?? "").trim());
      readme = {
        path: candidate,
        firstNHeadings: headings,
        rawTrimmed: raw.slice(0, README_CAP),
      };
      break;
    }
  }

  const entrypoints = collectEntrypoints(manifests, fileIndex.map((f) => f.path));
  const signals = computeSignals(manifests, fileIndex.map((f) => f.path), languages);

  return {
    repo: { owner: opts.repoOwner, name: opts.repoName, ref: opts.ref, commitSha: opts.commitSha },
    sizeBytes: opts.sizeBytes,
    fileCount: fileIndex.length,
    languages,
    manifests,
    entrypoints,
    ...(readme ? { readme } : {}),
    fileIndex,
    signals,
  };
}

async function walk(root: string, visit: (full: string, rel: string) => Promise<void>) {
  async function rec(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue;
      const full = join(dir, e.name);
      const rel = relative(root, full);
      if (e.isDirectory()) {
        await rec(full);
      } else if (e.isFile()) {
        await visit(full, rel);
      }
    }
  }
  await rec(root);
}

function collectEntrypoints(m: Manifest, paths: string[]): string[] {
  const out = new Set<string>();
  if (m.nodePkg) {
    const np = m.nodePkg as unknown as { main?: string; module?: string };
    if (np.main) out.add(np.main);
    if (np.module) out.add(np.module);
    for (const candidate of [
      "src/main.tsx",
      "src/main.ts",
      "src/index.ts",
      "src/index.tsx",
      "src/main.js",
      "index.html",
      "app/page.tsx",
      "pages/index.tsx",
      "pages/index.js",
    ]) {
      if (paths.includes(candidate)) out.add(candidate);
    }
  }
  if (m.pythonPyproject || m.pythonRequirements) {
    for (const candidate of ["main.py", "app.py", "manage.py", "src/main.py"]) {
      if (paths.includes(candidate)) out.add(candidate);
    }
  }
  return Array.from(out).slice(0, 6);
}

function computeSignals(
  m: Manifest,
  paths: string[],
  languages: Record<string, number>,
): Signals {
  const deps = new Set<string>([
    ...(m.nodePkg?.deps ?? []),
    ...(m.nodePkg?.devDeps ?? []),
  ]);
  const hasFrontendIndicator =
    deps.has("react") ||
    deps.has("vue") ||
    deps.has("svelte") ||
    deps.has("preact") ||
    deps.has("solid-js") ||
    deps.has("vite") ||
    deps.has("next") ||
    deps.has("astro") ||
    paths.includes("index.html") ||
    paths.includes("public/index.html");
  const hasBackendIndicator =
    deps.has("express") ||
    deps.has("fastify") ||
    deps.has("koa") ||
    deps.has("hono") ||
    deps.has("@nestjs/core") ||
    !!m.pythonPyproject ||
    !!m.pythonRequirements;
  const np = m.nodePkg as { bin?: unknown; main?: string; module?: string; exports?: unknown } | undefined;
  const hasCLI = !!np?.bin;
  const isLibrary = !hasFrontendIndicator && !hasBackendIndicator &&
    !!(np?.main || np?.module || np?.exports);

  let framework: Signals["framework"] = "unknown";
  if (deps.has("next")) framework = "next";
  else if (deps.has("astro")) framework = "astro";
  else if (deps.has("@sveltejs/kit")) framework = "svelte-kit";
  else if (deps.has("vite")) framework = "vite";
  else if (deps.has("react-scripts")) framework = "cra";
  else if (deps.has("express")) framework = "express";
  else if (paths.includes("index.html")) framework = "static";

  void languages;
  return {
    hasFrontend: hasFrontendIndicator,
    hasBackend: hasBackendIndicator,
    hasCLI,
    isLibrary,
    framework,
  };
}
