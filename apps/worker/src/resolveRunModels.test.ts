import { describe, expect, it } from "vitest";
import { resolveRunModels } from "./resolveRunModels.js";

describe("resolveRunModels", () => {
  it("uses env primary/fallback when the panel sent no model", () => {
    expect(
      resolveRunModels({
        wire: "gemini",
        configuredPrimary: "gemini-3.1-pro",
        configuredFallback: "gemini-1.5-flash",
      }),
    ).toEqual({
      primary: "gemini-3.1-pro",
      fallback: "gemini-1.5-flash",
      fromPanel: false,
    });
  });

  it("keeps a flash fallback when the panel pins a non-flash Antigravity model", () => {
    expect(
      resolveRunModels({
        wire: "gemini",
        requestedModel: "gemini-3.1-pro",
        configuredPrimary: "gemini-2.5-flash",
        configuredFallback: "gemini-1.5-flash",
      }),
    ).toEqual({
      primary: "gemini-3.1-pro",
      fallback: "gemini-3-flash",
      fromPanel: true,
    });
  });

  it("does not invent a second model when the panel already picked flash", () => {
    expect(
      resolveRunModels({
        wire: "gemini",
        requestedModel: "gemini-3-flash",
        configuredPrimary: "gemini-3.1-pro",
        configuredFallback: "gemini-3-flash",
      }),
    ).toEqual({
      primary: "gemini-3-flash",
      fallback: "gemini-3-flash",
      fromPanel: true,
    });
  });

  it("ignores a model that belongs to another wire", () => {
    expect(
      resolveRunModels({
        wire: "gemini",
        requestedModel: "claude-opus-5",
        configuredPrimary: "gemini-3.1-pro",
        configuredFallback: "gemini-3-flash",
      }),
    ).toEqual({
      primary: "gemini-3.1-pro",
      fallback: "gemini-3-flash",
      fromPanel: false,
    });
  });
});
