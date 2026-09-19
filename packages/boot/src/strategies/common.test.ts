import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkspacePackages } from "./common.js";

describe("buildWorkspacePackages", () => {
  it("builds packages/* that export dist/ and skips apps/*", async () => {
    const root = await mkdtemp(join(tmpdir(), "doceomenter-ws-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "mono",
        private: true,
        workspaces: ["packages/*", "apps/*"],
      }),
    );
    await mkdir(join(root, "packages", "core"), { recursive: true });
    await mkdir(join(root, "apps", "web"), { recursive: true });

    const marker = join(root, "packages", "core", "built.txt");
    await writeFile(
      join(root, "packages", "core", "package.json"),
      JSON.stringify({
        name: "@demo/core",
        main: "./dist/index.js",
        scripts: {
          // Portable: touch a marker file instead of needing tsc.
          build: `node -e "require('fs').writeFileSync('built.txt','ok')"`,
        },
      }),
    );
    await writeFile(
      join(root, "apps", "web", "package.json"),
      JSON.stringify({
        name: "@demo/web",
        main: "./dist/index.js",
        scripts: {
          build: `node -e "require('fs').writeFileSync('should-not-exist.txt','bad')"`,
        },
      }),
    );

    const logs: string[] = [];
    await buildWorkspacePackages({
      repoDir: root,
      skipDir: join(root, "apps", "web"),
      pm: "npm",
      log: (l) => logs.push(l),
    });

    const { readFile } = await import("node:fs/promises");
    expect(await readFile(marker, "utf-8")).toBe("ok");
    expect(logs.some((l) => l.includes("@demo/core"))).toBe(true);
  });

  it("no-ops when root has no workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "doceomenter-nows-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "solo" }));
    const logs: string[] = [];
    await buildWorkspacePackages({
      repoDir: root,
      pm: "npm",
      log: (l) => logs.push(l),
    });
    expect(logs.some((l) => /no workspace library/.test(l))).toBe(true);
  });
});
