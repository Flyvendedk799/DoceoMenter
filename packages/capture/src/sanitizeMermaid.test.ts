import { describe, expect, it } from "vitest";
import { sanitizeMermaidSpec } from "./sanitizeMermaid.js";

describe("sanitizeMermaidSpec", () => {
  it("quotes unquoted labels that contain parentheses", () => {
    const input = `graph TD
    A[apps/web (React/Three.js)] -->|API / WebSocket| B[apps/server (Fastify)]
    B -->|AI Generation| C[Claude Pipeline]
    B <-->|Agent Gateway| D[Fabric Mod in Minecraft]
    E[packages/core] -->|Shared IR & Expander| A`;
    const out = sanitizeMermaidSpec(input);
    expect(out).toContain('A["apps/web (React/Three.js)"]');
    expect(out).toContain('B["apps/server (Fastify)"]');
    expect(out).toContain("C[Claude Pipeline]");
    expect(out).toContain("D[Fabric Mod in Minecraft]");
    expect(out).toContain("E[packages/core]");
  });

  it("leaves already-quoted labels alone", () => {
    const input = `graph TD\n A["apps/web (React)"] --> B[server]`;
    expect(sanitizeMermaidSpec(input)).toBe(input);
  });

  it("leaves simple labels alone", () => {
    const input = "graph TD; A[App] --> B[Core]";
    expect(sanitizeMermaidSpec(input)).toBe(input);
  });
});
