import { mkdir, readFile, writeFile, rename, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  RunEvent,
  RunSpec,
  RunState,
  StageState,
  ListRunsOptions,
  ListRunsResponse,
  RunListItem,
  RunMetrics,
  RunStageSummary,
  StageName,
} from "@doceomenter/shared";
import { STAGE_NAMES, redactSpec, RUN_ID_RE } from "@doceomenter/shared";

/** How many state.json files `list` reads at once when its summary cache is cold. */
const LIST_READ_CONCURRENCY = 16;

type RunSummary = { item: RunListItem; owner: string | undefined };
type CachedSummary = { mtimeMs: number; size: number; summary: RunSummary | undefined };

export class RunStore {
  /** Per-run list summaries, valid while state.json's mtime and size are unchanged. */
  private readonly summaries = new Map<string, CachedSummary>();

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
    // Writes from this process drop the cached summary outright; writes from another process
    // (the queue worker) are caught by the mtime/size check in `summary`.
    this.summaries.delete(runId);
  }

  async read(runId: string): Promise<RunState | undefined> {
    const file = join(this.runDir(runId), "state.json");
    if (!existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(await readFile(file, "utf-8"));
      if (!isValidRunState(parsed)) return undefined;
      return parsed;
    } catch {
      // A corrupt/partial state.json degrades to "no state" rather than
      // throwing and making the run permanently unreadable.
      return undefined;
    }
  }

  async list(options?: ListRunsOptions): Promise<ListRunsResponse> {
    const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
    const offset = Math.max(0, options?.offset ?? 0);
    const includeMetrics = options?.includeMetrics ?? true;

    const emptyMetrics: RunMetrics = {
      totalRuns: 0,
      queuedRuns: 0,
      runningRuns: 0,
      doneRuns: 0,
      partialRuns: 0,
      failedRuns: 0,
      cancelledRuns: 0,
      activeRuns: 0,
      successRatePct: 0,
      avgDurationMs: 0,
      totalArtifacts: 0,
    };

    const emptyResponse = (): ListRunsResponse => ({
      runs: [],
      total: 0,
      limit,
      offset,
      ...(includeMetrics ? { metrics: emptyMetrics } : {}),
    });

    if (!existsSync(this.root)) {
      return emptyResponse();
    }

    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch {
      return emptyResponse();
    }

    // 2. Filter entries matching RUN_ID_RE = /^[0-9a-f]{12}$/
    const runIds = entries
      .filter((entry) => RUN_ID_RE.test(entry.name))
      .map((entry) => entry.name);

    // 3. Summarise each run. Summaries are cached per run and keyed by state.json's mtime and
    //    size, so a poll only re-reads runs that changed since the last listing, and the reads
    //    that do happen are bounded rather than one open file per stored run at once.
    const summaries = await mapBounded(runIds, LIST_READ_CONCURRENCY, (id) => this.summary(id));
    const ownerFilter =
      options && options.ownerAccountId !== undefined ? options.ownerAccountId : undefined;
    const allItems: RunListItem[] = [];
    for (const summary of summaries) {
      if (!summary) continue;
      // `null` (a caller without an account) matches nothing: legacy runs have no owner either.
      if (ownerFilter !== undefined && (ownerFilter === null || summary.owner !== ownerFilter)) {
        continue;
      }
      allItems.push(summary.item);
    }

    // 6. Calculate aggregate RunMetrics across all valid runs:
    let queuedRuns = 0;
    let runningRuns = 0;
    let doneRuns = 0;
    let partialRuns = 0;
    let failedRuns = 0;
    let cancelledRuns = 0;
    let totalArtifacts = 0;
    let sumDurationDoneAndPartial = 0;
    let countDoneAndPartial = 0;

    const artifactKeys = [
      "reportMd",
      "deckHtml",
      "deckPdf",
      "caseStudyJson",
      "qualityJson",
      "zip",
    ] as const;

    for (const item of allItems) {
      if (item.state === "queued") queuedRuns++;
      else if (item.state === "running") runningRuns++;
      else if (item.state === "done") doneRuns++;
      else if (item.state === "partial") partialRuns++;
      else if (item.state === "failed") failedRuns++;
      else if (item.state === "cancelled") cancelledRuns++;

      if (item.state === "done" || item.state === "partial") {
        sumDurationDoneAndPartial += item.durationMs;
        countDoneAndPartial++;
      }

      if (item.artifacts) {
        for (const key of artifactKeys) {
          if (item.artifacts[key] != null) {
            totalArtifacts++;
          }
        }
      }
    }

    const totalRuns = allItems.length;
    const activeRuns = queuedRuns + runningRuns;
    const totalTerminal = doneRuns + partialRuns + failedRuns;
    const successRatePct =
      totalTerminal > 0
        ? Math.round((doneRuns / totalTerminal) * 1000) / 10
        : 0;
    const avgDurationMs =
      countDoneAndPartial > 0
        ? Math.round(sumDurationDoneAndPartial / countDoneAndPartial)
        : 0;

    const metrics: RunMetrics = {
      totalRuns,
      queuedRuns,
      runningRuns,
      doneRuns,
      partialRuns,
      failedRuns,
      cancelledRuns,
      activeRuns,
      successRatePct,
      avgDurationMs,
      totalArtifacts,
    };

    // 7. Filter by status:
    let filtered = allItems;
    if (options?.status && options.status !== "all") {
      if (options.status === "active") {
        filtered = filtered.filter(
          (item) => item.state === "queued" || item.state === "running",
        );
      } else {
        filtered = filtered.filter((item) => item.state === options.status);
      }
    }

    // 8. Filter by q (case-insensitive substring match on state.spec.url, repository
    //    owner/name, or the branch/ref the run was started for).
    if (options?.q && options.q.trim()) {
      const q = options.q.trim().toLowerCase();
      filtered = filtered.filter((item) => {
        const url = (item.spec?.url ?? "").toLowerCase();
        if (url.includes(q)) return true;
        const ref = typeof item.spec?.ref === "string" ? item.spec.ref.toLowerCase() : "";
        if (ref && ref.includes(q)) return true;
        const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
        if (match && match[1] && match[2]) {
          const owner = match[1];
          const repo = match[2];
          const ownerRepo = `${owner}/${repo}`;
          if (owner.includes(q) || repo.includes(q) || ownerRepo.includes(q)) {
            return true;
          }
        }
        return false;
      });
    }

    // 9. Sort by sortBy (default "createdAt") and sortOrder (default "desc"):
    const sortBy = options?.sortBy ?? "createdAt";
    const sortOrder = options?.sortOrder ?? "desc";
    const multiplier = sortOrder === "asc" ? 1 : -1;

    filtered.sort((a, b) => {
      let valA = 0;
      let valB = 0;
      if (sortBy === "createdAt") {
        valA = new Date(a.createdAt).getTime() || 0;
        valB = new Date(b.createdAt).getTime() || 0;
      } else if (sortBy === "updatedAt") {
        valA = new Date(a.updatedAt).getTime() || 0;
        valB = new Date(b.updatedAt).getTime() || 0;
      } else if (sortBy === "duration") {
        valA = a.durationMs;
        valB = b.durationMs;
      }
      if (valA !== valB) {
        return (valA - valB) * multiplier;
      }
      return b.runId.localeCompare(a.runId);
    });

    // 10. Paginate with offset (default 0) and limit (default 20, max 100).
    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      runs: paginated,
      total,
      limit,
      offset,
      ...(includeMetrics ? { metrics } : {}),
    };
  }

  /** The list row for one run, from cache when its state.json has not changed. */
  private async summary(runId: string): Promise<RunSummary | undefined> {
    const file = join(this.runDir(runId), "state.json");
    let mtimeMs: number;
    let size: number;
    try {
      const info = await stat(file);
      mtimeMs = info.mtimeMs;
      size = info.size;
    } catch {
      this.summaries.delete(runId);
      return undefined;
    }
    const cached = this.summaries.get(runId);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.summary;

    let summary: RunSummary | undefined;
    try {
      const state = await this.read(runId);
      summary = state ? { item: toListItem(state), owner: state.ownerAccountId } : undefined;
    } catch {
      summary = undefined;
    }
    this.summaries.set(runId, { mtimeMs, size, summary });
    return summary;
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

/** The dashboard row for one stored run: duration and a stage roll-up, no logs or assets. */
function toListItem(state: RunState): RunListItem {
  const start = new Date(state.createdAt).getTime();
  const end = new Date(state.updatedAt).getTime();
  const durationMs = Math.max(
    0,
    Number.isFinite(end) && Number.isFinite(start) ? end - start : 0,
  );

  const stages = Array.isArray(state.stages) ? state.stages : [];
  let resolved = 0;
  let failed = 0;
  let runningStage: StageName | undefined;
  let lastResolvedStage: StageName | undefined;

  for (const stage of stages) {
    if (!stage || typeof stage !== "object") continue;
    if (stage.status === "running") {
      if (!runningStage) {
        runningStage = stage.name;
      }
    } else if (
      stage.status === "done" ||
      stage.status === "degraded" ||
      stage.status === "skipped"
    ) {
      resolved++;
      lastResolvedStage = stage.name;
    } else if (stage.status === "failed") {
      failed++;
    }
  }

  const stageSummary: RunStageSummary = {
    total: Array.isArray(state.stages) ? state.stages.length : 10,
    resolved,
    failed,
    current: runningStage ?? lastResolvedStage,
  };

  return {
    runId: state.runId,
    spec: state.spec,
    state: state.state,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    durationMs,
    provider: state.provider,
    artifacts: state.artifacts,
    error: state.error,
    stageSummary,
  };
}

/** `Promise.all(items.map(fn))` with at most `limit` calls in flight. Keeps result order. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
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

export function isValidRunState(state: unknown): state is RunState {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const s = state as Record<string, unknown>;
  if (typeof s.runId !== "string" || !s.runId) return false;
  if (!s.spec || typeof s.spec !== "object" || Array.isArray(s.spec)) return false;
  const spec = s.spec as Record<string, unknown>;
  if (typeof spec.url !== "string") return false;
  if (typeof s.state !== "string") return false;
  if (typeof s.createdAt !== "string" || typeof s.updatedAt !== "string") return false;
  if (s.stages !== undefined && !Array.isArray(s.stages)) return false;
  return true;
}
