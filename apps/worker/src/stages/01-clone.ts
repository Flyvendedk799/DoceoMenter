import { execa } from "execa";
import { rm } from "node:fs/promises";
import { join } from "node:path";

// Never let git block on an interactive credential prompt (private/auth-required
// repos otherwise hang until the command timeout). Fail fast instead.
const GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
} as const;

const SHA_RE = /^[0-9a-f]{7,40}$/i;

export async function cloneRepo(opts: {
  url: string;
  ref: string;
  destDir: string;
  maxRepoMb: number;
  log: (line: string) => void;
  signal?: AbortSignal;
}): Promise<{ commitSha: string; sizeBytes: number }> {
  const { url, ref, destDir, maxRepoMb, log, signal } = opts;
  // Remove existing repo dir if any (idempotent retry path).
  await rm(destDir, { recursive: true, force: true });

  const exec = (args: string[], cwd?: string) =>
    execa("git", args, {
      timeout: 4 * 60_000,
      env: GIT_ENV,
      ...(signal ? { cancelSignal: signal } : {}),
      ...(cwd ? { cwd } : {}),
    });

  if (SHA_RE.test(ref)) {
    // `git clone --branch` rejects commit SHAs — clone the default branch
    // shallowly, then fetch and check out the exact commit.
    log(`[clone] git clone (default branch) then checkout ${ref.slice(0, 12)} — ${url}`);
    await exec(["clone", "--filter=blob:none", "--no-checkout", url, destDir]);
    await exec(["fetch", "--depth=1", "origin", ref], destDir);
    await exec(["checkout", "--detach", ref], destDir);
  } else {
    log(`[clone] git clone --depth=1 --branch=${ref} ${url}`);
    await exec(["clone", "--depth=1", "--branch", ref, "--single-branch", url, destDir]);
  }

  // Get the commit sha.
  const { stdout: sha } = await exec(["rev-parse", "HEAD"], destDir);
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
  // Portable recursive byte count. `du -sb` is GNU-only (fails on macOS/BSD and
  // would silently undercount), so sum file sizes ourselves via a walk.
  let total = 0;
  const { readdir, stat } = await import("node:fs/promises");
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = join(d, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        await walk(p);
      } else if (ent.isFile()) {
        try {
          total += (await stat(p)).size;
        } catch {}
      }
    }
  };
  await walk(dir);
  return total;
}
