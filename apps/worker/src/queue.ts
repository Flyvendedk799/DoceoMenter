import { Queue, Worker, type Job } from "bullmq";
import { Redis as IORedis, type RedisOptions } from "ioredis";
import type { RunSpec } from "@doceomenter/shared";
import { loadConfig } from "./config.js";
import { RunStore, initialRunState } from "./runStore.js";
import { RunEventBus } from "./eventBus.js";
import { runPipeline } from "./pipeline.js";

export const QUEUE_NAME = "doceomenter-runs";

export type RunJobData = {
  runId: string;
  spec: RunSpec;
  /**
   * Whose credential the run may spend, from the signed cookie on the request that started it.
   *
   * An id rather than a token, deliberately: the worker resolves (and refreshes) the
   * credential when it actually needs it, so nothing spendable is ever written to Redis.
   */
  accountId?: string;
};

export function createRedis(redisUrl: string, opts: Partial<RedisOptions> = {}): IORedis {
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, ...opts });
  let lastWarnedAt = 0;
  redis.on("error", (err) => {
    const now = Date.now();
    if (now - lastWarnedAt < 30_000) return;
    lastWarnedAt = now;
    console.warn(`[redis] connection error for ${redisUrl}: ${(err as Error).message}`);
  });
  return redis;
}

export function createQueue(redisUrl: string): Queue<RunJobData> {
  return new Queue<RunJobData>(QUEUE_NAME, {
    connection: createRedis(redisUrl),
  });
}

export function startWorker(): { worker: Worker; bus: RunEventBus; store: RunStore } {
  const config = loadConfig();
  const store = new RunStore(config.DATA_ROOT);
  const bus = new RunEventBus(
    store,
    createRedis(config.REDIS_URL),
    () => createRedis(config.REDIS_URL),
  );
  const worker = new Worker<RunJobData>(
    QUEUE_NAME,
    async (job: Job<RunJobData>) => {
      await runPipeline({
        runId: job.data.runId,
        spec: job.data.spec,
        ...(job.data.accountId ? { accountId: job.data.accountId } : {}),
        config,
        store,
        bus,
      });
    },
    {
      connection: createRedis(config.REDIS_URL),
      concurrency: 1,
      lockDuration: 5 * 60_000,
    },
  );
  return { worker, bus, store };
}

export { loadConfig, initialRunState };
