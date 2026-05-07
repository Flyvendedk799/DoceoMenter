import { describe, expect, it } from "vitest";
import type { Analysis } from "@doceomenter/shared";
import { detectStrategy } from "./detect.js";

function mk(part: Partial<Analysis>): Analysis {
  return {
    repo: { owner: "o", name: "r", ref: "main", commitSha: "x" },
    sizeBytes: 0,
    fileCount: 1,
    languages: {},
    manifests: {},
    entrypoints: [],
    fileIndex: [],
    signals: { hasFrontend: false, hasBackend: false, hasCLI: false, isLibrary: false },
    ...part,
  };
}

describe("detectStrategy", () => {
  it("detects Next.js when next is in deps and pages/ or app/ exists", () => {
    const a = mk({
      manifests: { nodePkg: { name: "x", scripts: {}, deps: ["next"], devDeps: [] } },
      fileIndex: [{ path: "app/page.tsx", bytes: 1 }],
    });
    expect(detectStrategy(a).kind).toBe("next");
  });

  it("detects Vite", () => {
    const a = mk({
      manifests: { nodePkg: { name: "x", scripts: { dev: "vite" }, deps: [], devDeps: ["vite"] } },
      fileIndex: [{ path: "vite.config.ts", bytes: 1 }],
    });
    expect(detectStrategy(a).kind).toBe("vite");
  });

  it("detects CRA via react-scripts", () => {
    const a = mk({
      manifests: {
        nodePkg: { name: "x", scripts: { start: "react-scripts start" }, deps: ["react-scripts"], devDeps: [] },
      },
    });
    expect(detectStrategy(a).kind).toBe("cra");
  });

  it("detects Astro", () => {
    const a = mk({
      manifests: { nodePkg: { name: "x", scripts: {}, deps: ["astro"], devDeps: [] } },
    });
    expect(detectStrategy(a).kind).toBe("astro");
  });

  it("detects FastAPI as python-web", () => {
    const a = mk({
      manifests: { pythonRequirements: ["fastapi==0.110.0"] },
      fileIndex: [{ path: "main.py", bytes: 1 }],
    });
    expect(detectStrategy(a).kind).toBe("python-web");
  });

  it("detects node-server when start script and express dep present", () => {
    const a = mk({
      manifests: {
        nodePkg: {
          name: "x",
          scripts: { start: "node server.js" },
          deps: ["express"],
          devDeps: [],
        },
      },
    });
    expect(detectStrategy(a).kind).toBe("node-server");
  });

  it("detects static when index.html is at repo root", () => {
    const a = mk({ fileIndex: [{ path: "index.html", bytes: 1 }] });
    expect(detectStrategy(a).kind).toBe("static");
  });

  it("detects CLI via bin in package.json", () => {
    const a = mk({
      manifests: {
        nodePkg: {
          name: "x",
          scripts: {},
          deps: [],
          devDeps: [],
          ...({ bin: "./cli.js" } as object),
        },
      },
    });
    expect(detectStrategy(a).kind).toBe("cli");
  });

  it("detects library when main is set and nothing else matches", () => {
    const a = mk({
      manifests: {
        nodePkg: {
          name: "x",
          scripts: {},
          deps: [],
          devDeps: [],
          ...({ main: "dist/index.js" } as object),
        },
      },
      signals: { hasFrontend: false, hasBackend: false, hasCLI: false, isLibrary: true },
    });
    expect(detectStrategy(a).kind).toBe("library");
  });

  it("returns unknown when no signals match", () => {
    const a = mk({});
    expect(detectStrategy(a).kind).toBe("unknown");
  });

  it("does NOT pick docker without explicit dockerEnabled flag", () => {
    const a = mk({
      manifests: { composeYml: { services: ["app"] }, dockerfile: { exposedPorts: [3000] } },
      fileIndex: [{ path: "index.html", bytes: 1 }],
    });
    expect(detectStrategy(a, false).kind).toBe("static");
    expect(detectStrategy(a, true).kind).toBe("docker");
  });
});
