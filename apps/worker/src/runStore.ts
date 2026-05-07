import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunEvent, RunSpec, RunState, StageState } from "@doceomenter/shared";
import { STAGE_NAMES } from "@doceomenter/shared";

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
    await writeFile(join(dir, "state.json"), JSON.stringify(state, null, 2));
  }

  async read(runId: string): Promise<RunState | undefined> {
    const file = join(this.runDir(runId), "state.json");
    if (!existsSync(file)) return undefined;
    return JSON.parse(await readFile(file, "utf-8")) as RunState;
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
    spec,
    state: "queued",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    stages,
  };
}
