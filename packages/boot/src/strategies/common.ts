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
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status >= 200 && res.status < 500) {
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

export function spawnDev(opts: {
  cwd: string;
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  log?: Logger;
}): Subprocess {
  const child = execa(opts.cmd, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env, NODE_ENV: "development", BROWSER: "none" },
    reject: false,
    cleanup: true,
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

export async function killProcess(p: Subprocess | undefined): Promise<void> {
  if (!p) return;
  try {
    p.kill("SIGTERM");
  } catch {}
  await Promise.race([
    (async () => {
      try {
        await p;
      } catch {}
    })(),
    delay(2000),
  ]);
  try {
    p.kill("SIGKILL");
  } catch {}
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
  const args = opts.pm === "yarn" ? ["install", "--ignore-scripts"] : ["install", "--ignore-scripts"];
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
