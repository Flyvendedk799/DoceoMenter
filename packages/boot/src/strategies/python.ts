import { execa } from "execa";
import {
  killProcess,
  pollUntilReady,
  spawnDev,
  type BootedApp,
  type Logger,
} from "./common.js";

export async function bootPythonWeb(
  cmd: string,
  port: number,
  repoDir: string,
  log: Logger,
): Promise<BootedApp> {
  // Best-effort install if a requirements.txt exists; ignore failures.
  try {
    await execa("pip", ["install", "--no-cache-dir", "-r", "requirements.txt"], {
      cwd: repoDir,
      timeout: 4 * 60_000,
    });
  } catch (e) {
    log(`[boot] pip install skipped/failed: ${(e as Error).message.slice(0, 160)}`);
  }
  const [first, ...rest] = cmd.split(" ");
  const child = spawnDev({ cwd: repoDir, cmd: first ?? "python", args: rest, log });
  const url = `http://127.0.0.1:${port}`;
  await pollUntilReady(url, 60_000, log);
  return { url, kill: async () => killProcess(child) };
}
