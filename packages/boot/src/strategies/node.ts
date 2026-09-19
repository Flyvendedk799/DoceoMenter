import type { BootStrategy } from "@doceomenter/shared";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertNoViteEntryFailure,
  buildWorkspacePackages,
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
  const pm = "pkgManager" in strategy ? strategy.pkgManager : "npm";

  await installDeps({ cwd: installCwd, pm, log });

  // Monorepo libraries that export dist/ (no committed build) must be compiled
  // before Vite can resolve them — otherwise we screenshot the error overlay.
  if (installCwd === repoDir && (strategy.kind === "vite" || strategy.kind === "next")) {
    await buildWorkspacePackages({
      repoDir,
      skipDir: appCwd,
      pm,
      log,
    });
  }

  const port = strategy.port;
  let cmd: string;
  let args: string[];

  switch (strategy.kind) {
    case "next": {
      cmd = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npx";
      args = ["next", "dev", "-p", String(port)];
      break;
    }
    case "vite": {
      cmd = pm === "pnpm" ? "pnpm" : "npx";
      args = ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
      break;
    }
    case "cra": {
      cmd = pm === "pnpm" ? "pnpm" : "npx";
      args = ["react-scripts", "start"];
      break;
    }
    case "astro": {
      cmd = pm === "pnpm" ? "pnpm" : "npx";
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
  const bootErrors: string[] = [];
  const onErr = (b: Buffer) => {
    const text = b.toString();
    if (/packageEntryFailure|Failed to resolve entry for package|Failed to resolve import/i.test(text)) {
      bootErrors.push(text.replace(/\s+/g, " ").slice(0, 300));
    }
  };
  child.stderr?.on("data", onErr);
  try {
    await pollUntilReady(url, 60_000, log);
    if (bootErrors.length > 0) {
      throw new Error(`Vite resolve failed during boot: ${bootErrors[0]}`);
    }
    if (strategy.kind === "vite") {
      await assertNoViteEntryFailure(url, log);
      // Give dep-scan a moment; catch late packageEntryFailure from optimizeDeps.
      await new Promise((r) => setTimeout(r, 800));
      if (bootErrors.length > 0) {
        throw new Error(`Vite resolve failed during boot: ${bootErrors[0]}`);
      }
    }
  } catch (e) {
    // The server never became ready — kill the orphaned child before the error
    // propagates, otherwise it leaks (and holds its port) for the worker's life.
    await killProcess(child);
    throw e;
  } finally {
    child.stderr?.off("data", onErr);
  }
  return {
    url,
    kill: async () => killProcess(child),
  };
}
