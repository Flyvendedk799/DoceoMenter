import { describe, expect, it } from "vitest";
import {
  CapturePlanSchema,
  GitRefSchema,
  RunSpecSchema,
  ShotIdSchema,
  ShotSchema,
  isValidRunId,
  redactSpec,
  resolveEffectiveCaptureSurface,
  resolveRunSpec,
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

  it("defaults viewport when omitted on live-app screenshots via CapturePlanSchema", () => {
    const plan = CapturePlanSchema.safeParse({
      shots: [
        {
          id: "home",
          kind: "screenshot",
          target: "live-app",
          route: "/",
          caption: "Landing page",
          importance: "2",
        },
      ],
    });
    expect(plan.success).toBe(true);
    if (plan.success) {
      expect(plan.data.shots[0]).toMatchObject({
        viewport: { w: 1440, h: 900 },
        importance: 2,
      });
    }
  });

  it("defaults maxDurationMs and coerces stringy video fields", () => {
    const plan = CapturePlanSchema.safeParse({
      shots: [
        {
          id: "tour of the app!",
          kind: "video",
          target: "live-app",
          route: "/demo",
          script: [{ do: "wait", ms: "500" }],
          caption: "Walkthrough",
        },
      ],
    });
    expect(plan.success).toBe(true);
    if (plan.success) {
      const shot = plan.data.shots[0]!;
      expect(shot.id).toBe("tour-of-the-app");
      expect(shot).toMatchObject({ kind: "video", maxDurationMs: 8000 });
      if (shot.kind === "video") {
        expect(shot.script[0]).toEqual({ do: "wait", ms: 500 });
      }
    }
  });

  it("maps Gemini aliases and drops invented interaction verbs", () => {
    const plan = CapturePlanSchema.safeParse({
      shots: [
        {
          id: "home",
          kind: "image",
          target: "live_app",
          route: "dashboard",
          viewport: { width: "1280", height: "720" },
          caption: "",
          importance: 0,
          interactions: [
            { action: "navigate", url: "/x" },
            { do: "scroll", selector: "#main" },
            { type: "sleep", ms: "800" },
          ],
        },
        {
          id: "arch",
          kind: "screenshot",
          target: "architecture",
          diagramSpec: "graph TD; A-->B",
          caption: "Architecture",
          importance: "1",
        },
        {
          id: "tour",
          kind: "recording",
          target: "app",
          script: [{ action: "type", selector: "input", text: "hi" }],
        },
      ],
    });
    expect(plan.success).toBe(true);
    if (!plan.success) return;
    const [home, arch, tour] = plan.data.shots;
    expect(home).toMatchObject({
      kind: "screenshot",
      target: "live-app",
      route: "/dashboard",
      viewport: { w: 1280, h: 720 },
      importance: 1,
    });
    if (home && home.kind === "screenshot" && home.target === "live-app") {
      expect(home.interactions).toEqual([
        { do: "scrollTo", selector: "#main" },
        { do: "wait", ms: 800 },
      ]);
    }
    expect(arch).toMatchObject({
      kind: "screenshot",
      target: "code-architecture",
      diagramSpec: { mermaid: "graph TD; A-->B" },
    });
    expect(tour).toMatchObject({ kind: "video", target: "live-app" });
    if (tour && tour.kind === "video") {
      expect(tour.script[0]).toEqual({ do: "fill", selector: "input", text: "hi" });
    }
  });

  it("accepts Gemini media/title/description shaped shots from havekongen", () => {
    const plan = CapturePlanSchema.safeParse({
      shots: [
        {
          title: "Havekongen Landing & Storefront",
          description: "Main homepage presenting garden management tools.",
          id: "landing-page",
          target: "live-app",
          media: "image",
          importance: 1,
          route: "/",
        },
        {
          description: "3D digital twin of the garden.",
          route: "/havemaaler/3d",
          target: "live-app",
          title: "3D Garden Twin Scene",
          importance: 2,
          media: "video",
          id: "garden-3d",
        },
        {
          id: "garden-3d-twin",
          isVideo: true,
          title: "3D Digital Twin Viewer",
          target: "live-app",
          route: "/havemaaler/3d",
          importance: 2,
        },
        {
          id: "architecture",
          mermaid:
            "graph TD\n  Client[React] -->|JWT| API[PostgREST]\n  API --> DB[(Postgres)]",
          importance: 2,
        },
      ],
    });
    expect(plan.success).toBe(true);
    if (!plan.success) return;
    expect(plan.data.shots.map((s) => s.kind)).toEqual([
      "screenshot",
      "video",
      "video",
      "screenshot",
    ]);
    expect(plan.data.shots[0]).toMatchObject({
      target: "live-app",
      caption: "Main homepage presenting garden management tools.",
    });
    expect(plan.data.shots[3]).toMatchObject({
      target: "code-architecture",
    });
  });

  it("maps Gemini code/code-snippet file shots to github-readme (c71f7cb4085c)", () => {
    const plan = CapturePlanSchema.safeParse({
      shots: [
        {
          importance: 1,
          description: "Architecture of ai-auth.",
          spec: "graph TD\n  UI --> Core\n  Core --> Store",
          target: "code-architecture",
        },
        {
          description: "ClaudeTerminal mounted on a demo page.",
          importance: 1,
          route: "/",
          target: "live-app",
        },
        {
          description: "The main React frontend component for OAuth login flows.",
          target: "code",
          importance: 2,
          file: "src/react/ClaudeTerminal.tsx",
        },
        {
          target: "code-snippet",
          description: "Shortest useful example from the README.",
          importance: 2,
        },
      ],
    });
    expect(plan.success).toBe(true);
    if (!plan.success) return;
    expect(plan.data.shots.map((s) => ("target" in s ? s.target : null))).toEqual([
      "code-architecture",
      "live-app",
      "github-readme",
      "github-readme",
    ]);
  });

  it("dedupes omitted shot ids so captures do not overwrite each other", () => {
    const plan = CapturePlanSchema.safeParse({
      shots: [
        { description: "Readme", target: "github-readme", importance: 1 },
        {
          description: "Arch A",
          target: "code-architecture",
          importance: 2,
          spec: "graph TD\n  A --> B\n  B --> C",
        },
        {
          description: "Arch B",
          target: "code-architecture",
          importance: 2,
          spec: "graph TD\n  X --> Y\n  Y --> Z",
        },
      ],
    });
    expect(plan.success).toBe(true);
    if (!plan.success) return;
    const ids = plan.data.shots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
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

describe("provider selection", () => {
  it("accepts each of the six ways of paying", () => {
    for (const provider of ["anthropic", "claude-code", "openai", "codex", "gemini", "gemini-cli"]) {
      const spec = RunSpecSchema.parse({ url: "https://github.com/owner/repo", provider });
      expect(spec.provider).toBe(provider);
    }
  });

  it("still reads a run recorded before the split, as the key it meant", () => {
    // "claude" predates the provider/wire distinction and meant an Anthropic API key. A run
    // persisted then has to keep parsing, and has to keep meaning the same thing.
    const spec = RunSpecSchema.parse({ url: "https://github.com/owner/repo", provider: "claude" });
    expect(spec.provider).toBe("anthropic");
  });

  it("rejects a provider it does not know", () => {
    expect(
      RunSpecSchema.safeParse({ url: "https://github.com/owner/repo", provider: "mistral" }).success,
    ).toBe(false);
  });

  it("defaults to the provider that works without any credential", () => {
    const resolved = resolveRunSpec(RunSpecSchema.parse({ url: "https://github.com/owner/repo" }));
    expect(resolved.provider).toBe("anthropic");
    expect(resolved.model).toBeUndefined();
  });

  it("defaults live capture to if-possible / auto surface / auto plan", () => {
    const resolved = resolveRunSpec(RunSpecSchema.parse({ url: "https://github.com/owner/repo" }));
    expect(resolved.liveMedia).toBe("if-possible");
    expect(resolved.captureSurface).toBe("auto");
    expect(resolved.capturePlanMode).toBe("auto");
  });

  it("accepts guided targets and a free-text brief", () => {
    const spec = RunSpecSchema.parse({
      url: "https://github.com/owner/repo",
      liveMedia: "required",
      captureSurface: "cli",
      capturePlanMode: "guided",
      captureTargets: ["node dist/cli.js --help", "--version"],
      captureBrief: "Show the login paste flow",
    });
    expect(spec.captureTargets).toHaveLength(2);
    expect(spec.captureSurface).toBe("cli");
  });

  it("takes a model id but not a path or a shell fragment", () => {
    expect(
      RunSpecSchema.parse({ url: "https://github.com/owner/repo", model: "claude-opus-5" }).model,
    ).toBe("claude-opus-5");
    for (const model of ["../secrets", "claude opus", "a".repeat(65), ""]) {
      expect(
        RunSpecSchema.safeParse({ url: "https://github.com/owner/repo", model }).success,
      ).toBe(false);
    }
  });
});

describe("resolveEffectiveCaptureSurface", () => {
  it("prefers electron, then browser, then cli", () => {
    expect(
      resolveEffectiveCaptureSurface({
        override: "auto",
        strategyKind: "library",
        hasFrontend: false,
        hasCLI: true,
        hasElectron: true,
      }),
    ).toBe("electron");
    expect(
      resolveEffectiveCaptureSurface({
        override: "auto",
        strategyKind: "vite",
        hasFrontend: true,
        hasCLI: false,
        hasElectron: false,
      }),
    ).toBe("browser");
    expect(
      resolveEffectiveCaptureSurface({
        override: "auto",
        strategyKind: "cli",
        hasFrontend: false,
        hasCLI: true,
        hasElectron: false,
      }),
    ).toBe("cli");
  });

  it("honors an explicit override", () => {
    expect(
      resolveEffectiveCaptureSurface({
        override: "none",
        strategyKind: "vite",
        hasFrontend: true,
        hasCLI: false,
        hasElectron: false,
      }),
    ).toBe("none");
  });
});
