import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { RunSpecSchema } from "@doceomenter/shared";
import { getBus, getQueue, getStore, getConfig, isRedisReachable } from "../../../lib/server";
import { resolveCaller, withAccountCookie } from "../../../lib/auth";
import { initialRunState, runPipeline } from "@doceomenter/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bound concurrent in-process pipelines (each clones a repo + boots a browser)
// so an unauthenticated request loop can't exhaust CPU / file descriptors.
const MAX_INPROCESS_RUNS = 3;
let inProcessRuns = 0;

export async function POST(req: Request) {
  // Resolved before anything else so the run is tied to the browser that started it: the
  // worker looks the credential up by this id when it needs one, rather than being handed a
  // token that has to survive a queue.
  const caller = await resolveCaller(req);
  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = RunSpecSchema.safeParse(body);
  if (!parsed.success) {
    // Return curated field paths only — never the raw zod message (leaks schema
    // internals).
    const fields = Object.keys(parsed.error.flatten().fieldErrors);
    return withAccountCookie(
      NextResponse.json(
        { error: "Invalid request body", fields: fields.length ? fields : undefined },
        { status: 400 },
      ),
      caller,
    );
  }
  const spec = parsed.data;
  const runId = generateRunId();
  const store = getStore();
  await store.write(runId, initialRunState(runId, spec));

  // Two paths:
  //  - In container/queue mode: enqueue on BullMQ.
  //  - In single-process dev mode (no Redis available): run the pipeline
  //    in-process via setImmediate so the HTTP request returns quickly.
  const config = getConfig();
  const redisAvailable = await isRedisReachable();
  const useInProcess = process.env.DOCEOMENTER_INPROCESS === "1" || !redisAvailable;
  if (useInProcess) {
    if (inProcessRuns >= MAX_INPROCESS_RUNS) {
      return withAccountCookie(
        NextResponse.json(
          { error: "Server busy — too many runs in progress, try again shortly." },
          { status: 429 },
        ),
        caller,
      );
    }
    inProcessRuns += 1;
    const bus = getBus(false);
    const sharedStore = getStore();
    setImmediate(async () => {
      try {
        await runPipeline({
          runId,
          spec,
          accountId: caller.accountId,
          config,
          store: sharedStore,
          bus,
        });
      } catch (e) {
        console.error(`[run ${runId}] in-process pipeline failed:`, e);
        // Ensure the run reaches a terminal state even if it threw before the
        // pipeline recorded its own failure, so the UI doesn't hang on "queued".
        try {
          const current = await sharedStore.read(runId);
          if (current && current.state !== "failed") {
            current.state = "failed";
            current.error = current.error ?? (e as Error).message;
            current.updatedAt = new Date().toISOString();
            await sharedStore.write(runId, current);
            await bus.publish(runId, { type: "error", error: current.error });
          }
        } catch {}
      } finally {
        inProcessRuns -= 1;
      }
    });
  } else {
    const queue = getQueue();
    await queue.add(
      "run",
      { runId, spec, accountId: caller.accountId },
      { removeOnComplete: 100, removeOnFail: 100, attempts: 1 },
    );
  }
  return withAccountCookie(NextResponse.json({ runId }), caller);
}

function generateRunId(): string {
  return randomBytes(6).toString("hex");
}
