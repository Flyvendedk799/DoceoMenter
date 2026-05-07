import type { BootStrategy } from "@doceomenter/shared";
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
  if ("pkgManager" in strategy) {
    await installDeps({ cwd: repoDir, pm: strategy.pkgManager, log });
  } else {
    await installDeps({ cwd: repoDir, pm: "npm", log });
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
  const child = spawnDev({ cwd: repoDir, cmd, args, env, log });
  const url = `http://127.0.0.1:${port}`;
  await pollUntilReady(url, 60_000, log);
  return {
    url,
    kill: async () => killProcess(child),
  };
}
