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

  it("stays on the panel model with no auto-fallback", () => {
    expect(
      resolveRunModels({
        wire: "gemini",
        requestedModel: "gemini-3.1-pro",
        configuredPrimary: "gemini-2.5-flash",
        configuredFallback: "gemini-1.5-flash",
      }),
    ).toEqual({
      primary: "gemini-3.1-pro",
      fallback: "gemini-3.1-pro",
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
