import type { BootStrategy } from "@doceomenter/shared";
import type { BootedApp, Logger } from "./strategies/common.js";
import { bootNodeLike } from "./strategies/node.js";
import { bootStatic } from "./strategies/static.js";
import { bootPythonWeb } from "./strategies/python.js";
import { bootDockerCompose } from "./strategies/docker.js";
import { bootNoop } from "./strategies/cli.js";

export type { BootedApp } from "./strategies/common.js";

export type BootOptions = {
  strategy: BootStrategy;
  repoDir: string;
  log: Logger;
};

export async function boot(opts: BootOptions): Promise<BootedApp> {
  const { strategy, repoDir, log } = opts;
  switch (strategy.kind) {
    case "next":
    case "vite":
    case "cra":
    case "astro":
    case "node-server":
      return bootNodeLike(strategy, repoDir, log);
    case "static":
      return bootStatic(repoDir, strategy.dir, strategy.port, log);
    case "python-web":
      return bootPythonWeb(strategy.cmd, strategy.port, repoDir, log);
    case "docker":
      return bootDockerCompose(strategy.composeService, strategy.port, repoDir, log);
    case "cli":
    case "library":
    case "unknown":
      return bootNoop(repoDir, log);
  }
}
