import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { RunSpecSchema } from "@doceomenter/shared";
import { getBus, getQueue, getStore, getConfig } from "../../../lib/server";
import { initialRunState, runPipeline } from "@doceomenter/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = RunSpecSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
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
  const useInProcess =
    process.env.DOCEOMENTER_INPROCESS === "1" || !(await redisReachable(config.REDIS_URL));
  if (useInProcess) {
    const bus = getBus();
    const sharedStore = getStore();
    setImmediate(async () => {
      try {
        await runPipeline({ runId, spec, config, store: sharedStore, bus });
      } catch (e) {
        // pipeline records its own error; log so we can debug.
        console.error(`[run ${runId}] in-process pipeline failed:`, e);
      }
    });
  } else {
    const queue = getQueue();
    await queue.add(
      "run",
      { runId, spec },
      { removeOnComplete: 100, removeOnFail: 100, attempts: 1 },
    );
  }
  return NextResponse.json({ runId });
}

function generateRunId(): string {
  return randomBytes(6).toString("hex");
}

async function redisReachable(url: string): Promise<boolean> {
  try {
    const ioredis = await import("ioredis");
    const Redis = ioredis.Redis ?? (ioredis as unknown as { default: typeof ioredis.Redis }).default;
    const r = new Redis(url, { lazyConnect: true, connectTimeout: 1000, maxRetriesPerRequest: 0 });
    await r.connect();
    await r.ping();
    await r.quit();
    return true;
  } catch {
    return false;
  }
}
