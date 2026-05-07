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
let _bus: RunEventBus | undefined;
let _queue: Queue<RunJobData> | undefined;

export function getConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

export function getStore() {
  if (!_store) _store = new RunStore(getConfig().DATA_ROOT);
  return _store;
}

export function getBus() {
  if (!_bus) {
    const cfg = getConfig();
    _bus = new RunEventBus(
      getStore(),
      createRedis(cfg.REDIS_URL),
      () => createRedis(cfg.REDIS_URL),
    );
  }
  return _bus;
}

export function getQueue() {
  if (!_queue)
    _queue = new Queue<RunJobData>(QUEUE_NAME, {
      connection: createRedis(getConfig().REDIS_URL),
    });
  return _queue;
}
