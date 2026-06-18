import { describe, expect, it } from "vitest";
import {
  GitRefSchema,
  RunSpecSchema,
  ShotIdSchema,
  ShotSchema,
  isValidRunId,
  redactSpec,
} from "./schemas.js";

describe("ShotIdSchema", () => {
  it("accepts path/markup-safe ids", () => {
    for (const id of ["live-home", "arch_1", "shot.2", "AB-cd_3.x"]) {
      expect(ShotIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("rejects ids with quotes, slashes, angle brackets, or whitespace", () => {
    for (const id of ['x" onerror="y', "a/b", "<svg>", "a b", "../x", "", "a".repeat(65)]) {
      expect(ShotIdSchema.safeParse(id).success).toBe(false);
    }
  });
});

describe("GitRefSchema", () => {
  it("accepts branches, tags, and SHAs", () => {
    for (const r of ["main", "release/1.2", "v1.0.0", "a1b2c3d", "feature_x"]) {
      expect(GitRefSchema.safeParse(r).success).toBe(true);
    }
  });

  it("rejects option-injection and traversal refs", () => {
    for (const r of ["--upload-pack=x", "-x", "a..b", "a;rm -rf", "with space", "$(x)"]) {
      expect(GitRefSchema.safeParse(r).success).toBe(false);
    }
  });
});

describe("ShotSchema viewport bounds", () => {
  it("rejects an out-of-range viewport", () => {
    const bad = {
      id: "s1",
      kind: "screenshot",
      target: "live-app",
      route: "/",
      viewport: { w: 100, h: 100 },
      caption: "x",
      importance: 1,
    };
    expect(ShotSchema.safeParse(bad).success).toBe(false);
  });
});

describe("isValidRunId", () => {
  it("matches only 12 lowercase-hex chars", () => {
    expect(isValidRunId("0123456789ab")).toBe(true);
    expect(isValidRunId("../../etc")).toBe(false);
    expect(isValidRunId("0123456789AB")).toBe(false);
    expect(isValidRunId("0123456789")).toBe(false);
    expect(isValidRunId("0123456789abc")).toBe(false);
  });
});

describe("redactSpec", () => {
  it("removes the BYOK apiKey and keeps everything else", () => {
    const spec = RunSpecSchema.parse({
      url: "https://github.com/owner/repo",
      apiKey: "sk-secret",
      ref: "main",
    });
    const redacted = redactSpec(spec);
    expect(redacted.apiKey).toBeUndefined();
    expect("apiKey" in redacted).toBe(false);
    expect(redacted.url).toBe("https://github.com/owner/repo");
    expect(redacted.ref).toBe("main");
  });

  it("is a no-op when there is no apiKey", () => {
    const spec = RunSpecSchema.parse({ url: "https://github.com/owner/repo" });
    expect(redactSpec(spec)).toBe(spec);
  });
});
