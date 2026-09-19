import type { BootStrategy } from "@doceomenter/shared";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  installDeps,
  killProcess,
  pollUntilReady,
  spawnDev,
  type BootedApp,
  type Logger,
} from "./common.js";

export async function bootNodeLike(
  strategy: Extract<BootStrategy, { kind: "next" | "vite" | "cra" | "astro" | "node-server" }>,
  repoDir: string,
  log: Logger,
): Promise<BootedApp> {
  const nestedCwd =
    "cwd" in strategy && strategy.cwd ? resolve(repoDir, strategy.cwd) : undefined;
  const appCwd = nestedCwd ?? repoDir;
  // npm/pnpm workspaces: install at the repo root so workspace packages resolve,
  // then run the bundler from the app directory (CraftMagic apps/web).
  const installCwd =
    nestedCwd && existsSync(join(repoDir, "package.json")) ? repoDir : appCwd;

  if ("pkgManager" in strategy) {
    await installDeps({ cwd: installCwd, pm: strategy.pkgManager, log });
  } else {
    await installDeps({ cwd: installCwd, pm: "npm", log });
  }

  const port = strategy.port;
  let cmd: string;
  let args: string[];

  switch (strategy.kind) {
    case "next": {
      cmd = strategy.pkgManager === "pnpm" ? "pnpm" : strategy.pkgManager === "yarn" ? "yarn" : "npx";
      args = strategy.pkgManager === "yarn" ? ["next", "dev", "-p", String(port)] : ["next", "dev", "-p", String(port)];
      break;
    }
    case "vite": {
      cmd = strategy.pkgManager === "pnpm" ? "pnpm" : "npx";
      args = ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
      break;
    }
    case "cra": {
      cmd = strategy.pkgManager === "pnpm" ? "pnpm" : "npx";
      args = ["react-scripts", "start"];
      break;
    }
    case "astro": {
      cmd = strategy.pkgManager === "pnpm" ? "pnpm" : "npx";
      args = ["astro", "dev", "--host", "127.0.0.1", "--port", String(port)];
      break;
    }
    case "node-server": {
      const [first, ...rest] = strategy.cmd.split(" ");
      cmd = first ?? "node";
      args = rest;
      break;
    }
  }

  const env: NodeJS.ProcessEnv = { PORT: String(port), HOST: "127.0.0.1" };
  const child = spawnDev({ cwd: appCwd, cmd, args, env, log });
  const url = `http://127.0.0.1:${port}`;
  try {
    await pollUntilReady(url, 60_000, log);
  } catch (e) {
    // The server never became ready — kill the orphaned child before the error
    // propagates, otherwise it leaks (and holds its port) for the worker's life.
    await killProcess(child);
    throw e;
  }
  return {
    url,
    kill: async () => killProcess(child),
  };
}
