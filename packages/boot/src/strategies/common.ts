import { execa, type Subprocess } from "execa";
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
  const env = {
    ...process.env,
    npm_config_ignore_scripts: "true", // never run postinstall in v1
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_prefer_offline: "true",
    CI: "1",
  };
  const cmd = opts.pm === "pnpm" ? "pnpm" : opts.pm === "yarn" ? "yarn" : "npm";
  const args = ["install", "--ignore-scripts"];
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
