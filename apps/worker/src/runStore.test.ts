import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore, initialRunState } from "./runStore.js";
import type { RunSpec } from "@doceomenter/shared";

function tmpStore(): RunStore {
  return new RunStore(mkdtempSync(join(tmpdir(), "doceomenter-store-")));
}

const spec: RunSpec = { url: "https://github.com/owner/repo", apiKey: "sk-secret" };

describe("RunStore", () => {
  it("round-trips state via an atomic write", async () => {
    const store = tmpStore();
    const state = initialRunState("aabbccddeeff", spec);
    await store.write("aabbccddeeff", state);
    const read = await store.read("aabbccddeeff");
    expect(read?.runId).toBe("aabbccddeeff");
    expect(read?.state).toBe("queued");
  });

  it("never persists the BYOK apiKey", async () => {
    const store = tmpStore();
    await store.write("aabbccddeeff", initialRunState("aabbccddeeff", spec));
    const read = await store.read("aabbccddeeff");
    expect(read?.spec.apiKey).toBeUndefined();
    expect(read?.spec.url).toBe("https://github.com/owner/repo");
  });

  it("returns undefined for a corrupt state file instead of throwing", async () => {
    const store = tmpStore();
    await store.write("aabbccddeeff", initialRunState("aabbccddeeff", spec));
    // Truncate/corrupt the persisted file (simulating a crash mid-write).
    writeFileSync(join(store.runDir("aabbccddeeff"), "state.json"), "{ not json");
    await expect(store.read("aabbccddeeff")).resolves.toBeUndefined();
  });

  it("returns undefined for an unknown run", async () => {
    const store = tmpStore();
    await expect(store.read("ffffffffffff")).resolves.toBeUndefined();
  });
});
