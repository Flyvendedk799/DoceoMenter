import "server-only";
import { Queue } from "bullmq";
import {
  loadConfig,
  RunStore,
  RunEventBus,
  createRedis,
  QUEUE_NAME,
  type RunJobData,
} from "@doceomenter/worker";

let _config: ReturnType<typeof loadConfig> | undefined;
let _store: RunStore | undefined;
let _localBus: RunEventBus | undefined;
let _redisBus: RunEventBus | undefined;
let _queue: Queue<RunJobData> | undefined;
let _redisReachable: Promise<boolean> | undefined;
let _redisReachableCheckedAt = 0;

const REDIS_REACHABILITY_TTL_MS = 5_000;

export function getConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

export function getStore() {
  if (!_store) _store = new RunStore(getConfig().DATA_ROOT);
  return _store;
}

export function getBus(useRedis = true) {
  if (!useRedis) {
    if (!_localBus) _localBus = new RunEventBus(getStore());
    return _localBus;
  }

  if (!_redisBus) {
    const cfg = getConfig();
    _redisBus = new RunEventBus(
      getStore(),
      createRedis(cfg.REDIS_URL),
      () => createRedis(cfg.REDIS_URL),
    );
  }
  return _redisBus;
}

export function getQueue() {
  if (!_queue)
    _queue = new Queue<RunJobData>(QUEUE_NAME, {
      connection: createRedis(getConfig().REDIS_URL),
    });
  return _queue;
}

export async function isRedisReachable(): Promise<boolean> {
  const now = Date.now();
  if (!_redisReachable || now - _redisReachableCheckedAt > REDIS_REACHABILITY_TTL_MS) {
    _redisReachableCheckedAt = now;
    _redisReachable = checkRedisReachable(getConfig().REDIS_URL);
  }
  return _redisReachable;
}

async function checkRedisReachable(url: string): Promise<boolean> {
  let redis: InstanceType<typeof import("ioredis").Redis> | undefined;
  try {
    const ioredis = await import("ioredis");
    const Redis = ioredis.Redis ?? (ioredis as unknown as { default: typeof ioredis.Redis }).default;
    redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 1000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on("error", () => {
      // Redis is optional for single-process development mode.
    });
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis?.disconnect();
  }
}
