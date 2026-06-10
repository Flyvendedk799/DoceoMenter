import { EventEmitter } from "node:events";
import type { Redis as IORedis } from "ioredis";
import type { RunEvent, StageState } from "@doceomenter/shared";
import type { RunStore } from "./runStore.js";

const CHANNEL_PREFIX = "doceomenter:events:";

export class RunEventBus {
  private readonly emitter = new EventEmitter();
  private subRedis: IORedis | undefined;
  private readonly subscribed = new Set<string>();

  constructor(
    private readonly store: RunStore,
    private readonly pubRedis?: IORedis,
    private readonly newSubscriber?: () => IORedis,
  ) {
    this.emitter.setMaxListeners(0);
  }

  private channelOf(runId: string): string {
    return `${CHANNEL_PREFIX}${runId}`;
  }

  private async ensureSubscribed(runId: string): Promise<void> {
    if (!this.newSubscriber) return;
    if (!this.subRedis) {
      this.subRedis = this.newSubscriber();
      let lastWarnedAt = 0;
      this.subRedis.on("error", (err) => {
        const now = Date.now();
        if (now - lastWarnedAt < 30_000) return;
        lastWarnedAt = now;
        console.warn(`[redis] pub/sub unavailable: ${(err as Error).message}`);
      });
      this.subRedis.on("message", (channel: string, message: string) => {
        if (!channel.startsWith(CHANNEL_PREFIX)) return;
        const id = channel.slice(CHANNEL_PREFIX.length);
        try {
          const event = JSON.parse(message) as RunEvent;
          this.emitter.emit(id, event);
        } catch {}
      });
    }
    if (!this.subscribed.has(runId)) {
      await this.subRedis.subscribe(this.channelOf(runId));
      this.subscribed.add(runId);
    }
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const handler = (e: RunEvent) => listener(e);
    this.emitter.on(runId, handler);
    void this.ensureSubscribed(runId).catch(() => {
      // Redis pub/sub is optional; callers will still receive local events and
      // reconnecting clients receive the persisted snapshot from RunStore.
    });
    return () => this.emitter.off(runId, handler);
  }

  async publish(runId: string, event: RunEvent): Promise<void> {
    await this.store.appendEvent(runId, event);
    // Local listeners (single-process mode).
    this.emitter.emit(runId, event);
    // Cross-process listeners (worker → web) via Redis pub/sub.
    if (this.pubRedis) {
      try {
        await this.pubRedis.publish(this.channelOf(runId), JSON.stringify(event));
      } catch {}
    }
  }

  async log(runId: string, line: string, level: "info" | "warn" | "error" = "info"): Promise<void> {
    await this.store.appendLog(runId, `[${level}] ${line}`);
    await this.publish(runId, { type: "log", line, level });
  }

  async stage(runId: string, stage: StageState): Promise<void> {
    await this.publish(runId, { type: "stage", stage });
  }
}
