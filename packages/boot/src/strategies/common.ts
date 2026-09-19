import { execa, type Subprocess } from "execa";
import { existsSync } from "node:fs";
import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type BootedApp = {
  url: string;
  kill: () => Promise<void>;
};

export type Logger = (line: string) => void;

export async function pollUntilReady(url: string, timeoutMs = 60_000, log?: Logger): Promise<void> {
  const startedAt = Date.now();
  let lastError: string | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
      // Only treat a real success/redirect as "ready". A 4xx/5xx means the dev
      // server is up but the app errored (or a foreign server holds the port),
      // which would otherwise screenshot an error page.
      if (res.status >= 200 && res.status < 400) {
        log?.(`[boot] ${url} responded ${res.status} after ${Date.now() - startedAt}ms`);
        return;
      }
      lastError = `status=${res.status}`;
    } catch (e) {
      lastError = (e as Error).message;
    }
    await delay(250);
  }
  throw new Error(`boot health check timed out after ${timeoutMs}ms: ${lastError}`);
}

// Only these env vars are forwarded to booted (untrusted) repo processes — never
// the worker's secrets (ANTHROPIC_API_KEY, REDIS_URL, cloud creds, …).
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SHELL",
  "TERM",
  "PWD",
  "SystemRoot",
  "NVM_DIR",
];

function safeBaseEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function spawnDev(opts: {
  cwd: string;
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  log?: Logger;
}): Subprocess {
  const child = execa(opts.cmd, opts.args, {
    cwd: opts.cwd,
    env: {
      ...safeBaseEnv(),
      NODE_ENV: "development",
      BROWSER: "none",
      CI: "1",
      ...opts.env,
    },
    extendEnv: false,
    reject: false,
    cleanup: true,
    // Own process group so we can tear down the whole dev-server tree, and never
    // block on an interactive prompt.
    detached: true,
    stdin: "ignore",
  });
  child.stdout?.on("data", (b: Buffer) => {
    for (const line of b.toString().split("\n")) {
      if (line.trim()) opts.log?.(`[stdout] ${line.slice(0, 500)}`);
    }
  });
  child.stderr?.on("data", (b: Buffer) => {
    for (const line of b.toString().split("\n")) {
      if (line.trim()) opts.log?.(`[stderr] ${line.slice(0, 500)}`);
    }
  });
  return child;
}

function signalGroup(p: Subprocess, sig: NodeJS.Signals): void {
  // The child was spawned `detached`, so it leads its own process group. Signal
  // the whole group (negative pid) to take down dev-server children/workers;
  // fall back to signalling just the child if the group send fails.
  const pid = p.pid;
  if (pid !== undefined) {
    try {
      process.kill(-pid, sig);
      return;
    } catch {}
  }
  try {
    p.kill(sig);
  } catch {}
}

export async function killProcess(p: Subprocess | undefined): Promise<void> {
  if (!p) return;
  signalGroup(p, "SIGTERM");
  await Promise.race([
    (async () => {
      try {
        await p;
      } catch {}
    })(),
    delay(2000),
  ]);
  signalGroup(p, "SIGKILL");
}

export async function installDeps(opts: {
  cwd: string;
  pm: "pnpm" | "npm" | "yarn";
  log?: Logger;
  timeoutMs?: number;
}): Promise<void> {
  // Target repos almost always keep the bundler (vite/next/…) in
  // `devDependencies`. ServerHoster runs DoceoMenter with NODE_ENV=production,
  // and a bare `npm install` would skip those packages — then `npx vite` dies
  // with ERR_MODULE_NOT_FOUND (havekongen run 13e01d6149d7).
  const env = {
    ...process.env,
    NODE_ENV: "development",
    npm_config_production: "false",
    npm_config_include: "dev",
    npm_config_ignore_scripts: "true", // never run postinstall in v1
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_prefer_offline: "true",
    CI: "1",
  };
  const cmd = opts.pm === "pnpm" ? "pnpm" : opts.pm === "yarn" ? "yarn" : "npm";
  const args =
    opts.pm === "npm"
      ? ["install", "--ignore-scripts", "--include=dev"]
      : opts.pm === "pnpm"
        ? ["install", "--ignore-scripts", "--prod=false"]
        : ["install", "--ignore-scripts"];
  opts.log?.(`[boot] ${cmd} ${args.join(" ")} (cwd=${opts.cwd})`);
  const child = execa(cmd, args, {
    cwd: opts.cwd,
    env,
    timeout: opts.timeoutMs ?? 4 * 60_000,
    all: true,
  });
  child.all?.on("data", (b: Buffer) => {
    for (const line of b.toString().split("\n").slice(-1)) {
      if (line.trim()) opts.log?.(`[install] ${line.slice(0, 300)}`);
    }
  });
  await child;
}

type WorkspacePkg = {
  name: string;
  dir: string;
  hasBuild: boolean;
  /** True when package.json main/exports point at dist (needs a build before Vite). */
  needsDistBuild: boolean;
};

/**
 * Build local workspace library packages (e.g. packages/core) before starting a
 * nested Vite app. CraftMagic's @craftmagic/core exports `./dist/index.js` with
 * no committed dist — `npx vite` then fails with packageEntryFailure while still
 * returning HTTP 200 (error overlay), so Documenter screenshots look "successful".
 */
export async function buildWorkspacePackages(opts: {
  repoDir: string;
  /** Skip building this package (the app we are about to boot). */
  skipDir?: string;
  pm: "pnpm" | "npm" | "yarn";
  log?: Logger;
  timeoutMs?: number;
}): Promise<void> {
  const pkgs = await listWorkspacePackages(opts.repoDir);
  const skipAbs = opts.skipDir ? join(opts.skipDir) : undefined;
  const toBuild = pkgs.filter((p) => {
    if (!p.hasBuild || !p.needsDistBuild) return false;
    if (skipAbs && join(p.dir) === skipAbs) return false;
    // Prefer packages/* libraries over apps/* (apps are the thing we boot).
    const rel = p.dir.slice(opts.repoDir.length).replace(/^[\\/]/, "");
    if (/^apps([\\/]|$)/.test(rel)) return false;
    return true;
  });
  if (toBuild.length === 0) {
    opts.log?.("[boot] no workspace library packages to build");
    return;
  }

  const env = {
    ...process.env,
    NODE_ENV: "development",
    CI: "1",
  };
  const timeout = opts.timeoutMs ?? 3 * 60_000;

  for (const pkg of toBuild) {
    const cmd = opts.pm === "pnpm" ? "pnpm" : opts.pm === "yarn" ? "yarn" : "npm";
    const args =
      opts.pm === "pnpm"
        ? ["--filter", pkg.name, "run", "build"]
        : opts.pm === "yarn"
          ? ["workspace", pkg.name, "run", "build"]
          : ["run", "build", `--workspace=${pkg.name}`];
    opts.log?.(`[boot] building workspace package ${pkg.name}`);

    // Stale *.tsbuildinfo after a wiped dist makes `tsc -b` exit 0 with no output.
    await clearTsBuildInfo(pkg.dir);

    try {
      const child = execa(cmd, args, {
        cwd: opts.repoDir,
        env,
        timeout,
        all: true,
        reject: false,
      });
      child.all?.on("data", (b: Buffer) => {
        for (const line of b.toString().split("\n").slice(-1)) {
          if (line.trim()) opts.log?.(`[build] ${line.slice(0, 300)}`);
        }
      });
      const result = await child;
      if (result.exitCode !== 0) {
        opts.log?.(
          `[boot] ${cmd} build for ${pkg.name} exited ${result.exitCode}; retrying in-package`,
        );
        await clearTsBuildInfo(pkg.dir);
        await execa(opts.pm === "yarn" ? "yarn" : "npm", ["run", "build"], {
          cwd: pkg.dir,
          env,
          timeout,
          all: true,
        });
      }
    } catch (e) {
      opts.log?.(
        `[boot] workspace build failed for ${pkg.name}: ${(e as Error).message.slice(0, 200)}`,
      );
      throw e;
    }

    const entry = await resolvePackageEntryFile(pkg.dir);
    if (entry && !existsSync(entry)) {
      const buildScript = await readBuildScript(pkg.dir);
      if (buildScript && /\btsc\b/.test(buildScript)) {
        opts.log?.(`[boot] ${pkg.name} entry missing after build (${entry}); forcing tsc -b`);
        await clearTsBuildInfo(pkg.dir);
        const forced = await execa("npx", ["tsc", "-b", "--force"], {
          cwd: pkg.dir,
          env,
          timeout,
          reject: false,
          all: true,
        });
        if (forced.exitCode !== 0 || !existsSync(entry)) {
          throw new Error(
            `Workspace package ${pkg.name} did not produce ${entry} after build`,
          );
        }
      } else {
        opts.log?.(
          `[boot] warning: ${pkg.name} entry ${entry} still missing after build script`,
        );
      }
    }
  }
}

async function readBuildScript(pkgDir: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts?.build;
  } catch {
    return undefined;
  }
}

async function clearTsBuildInfo(pkgDir: string): Promise<void> {
  try {
    for (const name of await readdir(pkgDir)) {
      if (name.endsWith(".tsbuildinfo")) {
        await unlink(join(pkgDir, name)).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

async function resolvePackageEntryFile(pkgDir: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf-8")) as {
      main?: string;
      exports?: unknown;
    };
    if (typeof pkg.main === "string") return join(pkgDir, pkg.main);
    if (pkg.exports && typeof pkg.exports === "object" && pkg.exports !== null) {
      const exp = pkg.exports as Record<string, unknown>;
      const dot = exp["."];
      if (typeof dot === "string") return join(pkgDir, dot);
      if (dot && typeof dot === "object") {
        const d = dot as Record<string, unknown>;
        const path = (d.default ?? d.import ?? d.require) as string | undefined;
        if (typeof path === "string") return join(pkgDir, path);
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

async function listWorkspacePackages(repoDir: string): Promise<WorkspacePkg[]> {
  const rootPkgPath = join(repoDir, "package.json");
  if (!existsSync(rootPkgPath)) return [];

  let workspaces: string[] = [];
  try {
    const raw = JSON.parse(await readFile(rootPkgPath, "utf-8")) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const ws = raw.workspaces;
    workspaces = Array.isArray(ws) ? ws : (ws?.packages ?? []);
  } catch {
    return [];
  }
  if (workspaces.length === 0) return [];

  const dirs = new Set<string>();
  for (const pattern of workspaces) {
    // Support the common `packages/*` / `apps/*` forms (no brace expansion).
    if (pattern.endsWith("/*")) {
      const parent = join(repoDir, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const name of await readdir(parent)) {
        const dir = join(parent, name);
        if (existsSync(join(dir, "package.json"))) dirs.add(dir);
      }
    } else {
      const dir = join(repoDir, pattern);
      if (existsSync(join(dir, "package.json"))) dirs.add(dir);
    }
  }

  const out: WorkspacePkg[] = [];
  for (const dir of dirs) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8")) as {
        name?: string;
        scripts?: Record<string, string>;
        main?: string;
        module?: string;
        types?: string;
        exports?: unknown;
      };
      if (!pkg.name) continue;
      const entryBlob = JSON.stringify({
        main: pkg.main,
        module: pkg.module,
        types: pkg.types,
        exports: pkg.exports,
      });
      out.push({
        name: pkg.name,
        dir,
        hasBuild: typeof pkg.scripts?.build === "string",
        needsDistBuild: /(["'/]|^)dist\//.test(entryBlob),
      });
    } catch {
      // skip unreadable package.json
    }
  }
  return out;
}

/**
 * Vite serves HTTP 200 even when import-analysis fails (client error overlay).
 * Probe the HTML entry module; if Vite reports a resolve/transform error, fail boot.
 */
export async function assertNoViteEntryFailure(
  url: string,
  log?: Logger,
): Promise<void> {
  let html: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    html = await res.text();
  } catch (e) {
    log?.(`[boot] vite entry probe skipped: ${(e as Error).message}`);
    return;
  }

  // Vite injects /@vite/client into served HTML — skip internals and probe the
  // app entry (typically /src/main.tsx).
  const scriptSrcs = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi),
  ]
    .map((m) => m[1] ?? "")
    .filter(Boolean);
  const entrySrc =
    scriptSrcs.find((s) => /\/src\//.test(s) && !s.includes("/@")) ??
    scriptSrcs.find(
      (s) =>
        !s.includes("/@vite/") &&
        !s.includes("/@react-refresh") &&
        !s.includes("/@id/") &&
        /\.(t|j)sx?([?#]|$)/.test(s),
    );
  if (!entrySrc) {
    log?.("[boot] vite entry probe: no app module script in index.html");
    return;
  }

  const entryUrl = new URL(entrySrc, url).href;
  const entryRes = await fetch(entryUrl, { signal: AbortSignal.timeout(10_000) });
  const body = await entryRes.text();
  const failed =
    !entryRes.ok ||
    /Failed to resolve entry for package|packageEntryFailure|Failed to resolve import/i.test(
      body,
    );
  if (failed) {
    const snippet = body.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      `Vite entry module failed (${entryRes.status}): ${entrySrc} — ${snippet}`,
    );
  }
  log?.(`[boot] vite entry ok: ${entrySrc}`);
}
