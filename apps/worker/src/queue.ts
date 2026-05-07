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
};

export function createRedis(redisUrl: string, opts: Partial<RedisOptions> = {}): IORedis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, ...opts });
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
