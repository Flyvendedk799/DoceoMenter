import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { RunEvent, RunSpec, RunState, StageState } from "@doceomenter/shared";
import { STAGE_NAMES, redactSpec } from "@doceomenter/shared";

export class RunStore {
  constructor(private readonly root: string) {}

  runDir(runId: string): string {
    return resolve(this.root, runId);
  }

  async ensure(runId: string): Promise<string> {
    const dir = this.runDir(runId);
    await mkdir(join(dir, "assets", "screenshots"), { recursive: true });
    await mkdir(join(dir, "assets", "videos"), { recursive: true });
    return dir;
  }

  async write(runId: string, state: RunState): Promise<void> {
    const dir = await this.ensure(runId);
    const target = join(dir, "state.json");
    // Write to a unique temp file then atomically rename, so a crash mid-write
    // can never leave a truncated/corrupt state.json behind.
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, target);
  }

  async read(runId: string): Promise<RunState | undefined> {
    const file = join(this.runDir(runId), "state.json");
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(await readFile(file, "utf-8")) as RunState;
    } catch {
      // A corrupt/partial state.json degrades to "no state" rather than
      // throwing and making the run permanently unreadable.
      return undefined;
    }
  }

  async appendLog(runId: string, line: string): Promise<void> {
    const dir = await this.ensure(runId);
    const stamp = new Date().toISOString();
    await writeFile(join(dir, "run.log"), `${stamp} ${line}\n`, { flag: "a" });
  }

  async appendEvent(runId: string, event: RunEvent): Promise<void> {
    const dir = await this.ensure(runId);
    const stamp = new Date().toISOString();
    await writeFile(
      join(dir, "events.log"),
      `${stamp} ${JSON.stringify(event)}\n`,
      { flag: "a" },
    );
  }
}

export function initialRunState(runId: string, spec: RunSpec, now = new Date()): RunState {
  const stages: StageState[] = STAGE_NAMES.map((name) => ({ name, status: "pending" }));
  return {
    runId,
    // Never persist the BYOK key; it stays only in the in-memory job payload.
    spec: redactSpec(spec),
    state: "queued",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    stages,
  };
}
