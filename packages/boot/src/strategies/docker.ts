import { execa } from "execa";
import { pollUntilReady, type BootedApp, type Logger } from "./common.js";

export async function bootDockerCompose(
  service: string | undefined,
  port: number,
  repoDir: string,
  log: Logger,
): Promise<BootedApp> {
  log(`[boot] docker compose up -d ${service ?? ""}`);
  await execa("docker", ["compose", "up", "-d", ...(service ? [service] : [])], {
    cwd: repoDir,
    timeout: 5 * 60_000,
  });
  const url = `http://127.0.0.1:${port}`;
  await pollUntilReady(url, 60_000, log);
  return {
    url,
    kill: async () => {
      try {
        await execa("docker", ["compose", "down"], { cwd: repoDir, timeout: 60_000 });
      } catch (e) {
        log(`[boot] docker compose down failed: ${(e as Error).message}`);
      }
    },
  };
}
