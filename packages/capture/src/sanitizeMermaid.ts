/**
 * Mermaid treats `(` inside unquoted `[...]` node labels as a shape token
 * (`PS`), which throws a parse object that Playwright surfaces as
 * `page.evaluate: Object`. Quote those labels so LLM-generated diagrams
 * like `A[apps/web (React)]` still render.
 */
export function sanitizeMermaidSpec(spec: string): string {
  return spec.replace(/(\b[\w.-]+)\[([^\]"\n]+)\]/g, (full, id: string, label: string) => {
    // Already safe, or no special shape/punctuation that breaks the lexer.
    if (!/[(){}<>]/.test(label)) return full;
    const escaped = label.replace(/\\/g, "\\\\").replace(/"/g, "#quot;");
    return `${id}["${escaped}"]`;
  });
}
