import { describe, expect, it } from "vitest";
import {
  shouldAttemptCliLiveCapture,
  shouldHardFailMissingLiveApp,
} from "./captureHardFail.js";

describe("shouldHardFailMissingLiveApp", () => {
  it("hard-fails when a browser URL existed but zero live-app shots succeeded", () => {
    expect(
      shouldHardFailMissingLiveApp({
        plannedLive: 3,
        liveOk: 0,
        liveAppUrl: "http://127.0.0.1:5173",
        liveMedia: "if-possible",
        surface: "browser",
      }),
    ).toBe(true);
  });

  it("does not hard-fail when there was no browser URL (CLI/TUI/Electron/library)", () => {
    expect(
      shouldHardFailMissingLiveApp({
        plannedLive: 3,
        liveOk: 0,
        liveAppUrl: undefined,
        liveMedia: "if-possible",
        surface: "cli",
      }),
    ).toBe(false);
  });

  it("does not hard-fail when at least one live-app shot succeeded", () => {
    expect(
      shouldHardFailMissingLiveApp({
        plannedLive: 3,
        liveOk: 1,
        liveAppUrl: "http://127.0.0.1:5173",
        liveMedia: "if-possible",
        surface: "browser",
      }),
    ).toBe(false);
  });

  it("hard-fails when liveMedia=required and CLI got zero live shots", () => {
    expect(
      shouldHardFailMissingLiveApp({
        plannedLive: 2,
        liveOk: 0,
        liveAppUrl: undefined,
        liveMedia: "required",
        surface: "cli",
      }),
    ).toBe(true);
  });

  it("never hard-fails when liveMedia=skip", () => {
    expect(
      shouldHardFailMissingLiveApp({
        plannedLive: 5,
        liveOk: 0,
        liveAppUrl: "http://127.0.0.1:5173",
        liveMedia: "skip",
        surface: "browser",
      }),
    ).toBe(false);
  });
});

describe("shouldAttemptCliLiveCapture", () => {
  it("attempts CLI capture for cli/electron without a browser URL", () => {
    expect(
      shouldAttemptCliLiveCapture({
        liveMedia: "if-possible",
        surface: "cli",
        liveAppUrl: undefined,
      }),
    ).toBe(true);
    expect(
      shouldAttemptCliLiveCapture({
        liveMedia: "required",
        surface: "electron",
        liveAppUrl: undefined,
      }),
    ).toBe(true);
  });

  it("skips when liveMedia=skip or a browser URL exists", () => {
    expect(
      shouldAttemptCliLiveCapture({
        liveMedia: "skip",
        surface: "cli",
        liveAppUrl: undefined,
      }),
    ).toBe(false);
    expect(
      shouldAttemptCliLiveCapture({
        liveMedia: "if-possible",
        surface: "cli",
        liveAppUrl: "http://127.0.0.1:5173",
      }),
    ).toBe(false);
  });
});
