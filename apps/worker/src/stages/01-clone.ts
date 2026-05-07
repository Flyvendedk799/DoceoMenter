import { execa } from "execa";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";

export async function cloneRepo(opts: {
  url: string;
  ref: string;
  destDir: string;
  maxRepoMb: number;
  log: (line: string) => void;
}): Promise<{ commitSha: string; sizeBytes: number }> {
  const { url, ref, destDir, maxRepoMb, log } = opts;
  // Remove existing repo dir if any (idempotent retry path).
  await rm(destDir, { recursive: true, force: true });
  log(`[clone] git clone --depth=1 --branch=${ref} ${url}`);
  await execa(
    "git",
    ["clone", "--depth=1", "--branch", ref, "--single-branch", url, destDir],
    { timeout: 4 * 60_000 },
  );

  // Get the commit sha.
  const { stdout: sha } = await execa("git", ["rev-parse", "HEAD"], { cwd: destDir });
  // Strip .git to save space.
  await rm(join(destDir, ".git"), { recursive: true, force: true });

  const sizeBytes = await diskUsage(destDir);
  const sizeMb = Math.ceil(sizeBytes / (1024 * 1024));
  if (sizeMb > maxRepoMb) {
    throw new Error(`repository ${sizeMb}MB exceeds limit ${maxRepoMb}MB`);
  }
  log(`[clone] ${sizeMb}MB, sha=${sha.trim().slice(0, 12)}`);
  return { commitSha: sha.trim(), sizeBytes };
}

async function diskUsage(dir: string): Promise<number> {
  // Recursive size; uses du for portability/speed when available.
  try {
    const { stdout } = await execa("du", ["-sb", dir], { timeout: 30_000 });
    const n = parseInt(stdout.split(/\s+/)[0] ?? "0", 10);
    if (!Number.isNaN(n)) return n;
  } catch {}
  // Fallback to stat (less accurate).
  try {
    const s = await stat(dir);
    return s.size;
  } catch {
    return 0;
  }
}
