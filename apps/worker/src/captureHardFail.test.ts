import { describe, expect, it } from "vitest";
import { shouldHardFailMissingLiveApp } from "./captureHardFail.js";

describe("shouldHardFailMissingLiveApp", () => {
  it("hard-fails when a live URL existed but zero live-app shots succeeded", () => {
    expect(
      shouldHardFailMissingLiveApp({
        plannedLive: 3,
        liveOk: 0,
        liveAppUrl: "http://127.0.0.1:5173",
      }),
    ).toBe(true);
  });

  it("does not hard-fail when there was no browser URL (CLI/TUI/Electron/library)", () => {
    expect(
      shouldHardFailMissingLiveApp({
        plannedLive: 3,
        liveOk: 0,
        liveAppUrl: undefined,
      }),
    ).toBe(false);
  });

  it("does not hard-fail when at least one live-app shot succeeded", () => {
    expect(
      shouldHardFailMissingLiveApp({
        plannedLive: 3,
        liveOk: 1,
        liveAppUrl: "http://127.0.0.1:5173",
      }),
    ).toBe(false);
  });
});
