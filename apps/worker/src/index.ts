// Public exports for the web app to import directly:
export { loadConfig } from "./config.js";
export { RunStore, initialRunState } from "./runStore.js";
export { RunEventBus } from "./eventBus.js";
export { runPipeline } from "./pipeline.js";
export { createRedis, createQueue, startWorker, QUEUE_NAME } from "./queue.js";
export type { RunJobData } from "./queue.js";

import { fileURLToPath } from "node:url";
import { startWorker } from "./queue.js";

// CLI / standalone entrypoint: only run when the file is invoked directly.
const isEntrypoint = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isEntrypoint || process.env.DOCEOMENTER_AUTOSTART_WORKER === "1") {
  const { worker } = startWorker();
  console.log(`[worker] listening on queue doceomenter-runs`);
  worker.on("ready", () => console.log("[worker] ready"));
  worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} failed:`, err));
  worker.on("completed", (job) => console.log(`[worker] job ${job.id} done`));
  const shutdown = async () => {
    console.log("[worker] shutting down");
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
