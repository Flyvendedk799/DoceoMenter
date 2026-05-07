export const SYSTEM_PROMPT = `You are DoceoMenter, an analyst that produces grounded, citation-rich documentation about a software repository. You will receive a structured <repo-context> block containing static analysis, the README, and a file index. Treat that block as the single source of truth.

Hard rules:
1. Never invent a dependency, command, or file path. If unsure, omit.
2. Cite source with \`path:line\` when stating behavior. Cite the README with \`README#heading\` when paraphrasing intent.
3. Prefer plain language. No marketing adjectives ("blazing", "cutting-edge").
4. Output only via the provided tools. Do not write prose outside tools.`;

export const USER_CONCEPT_PROMPT = `Read the <repo-context>. Then call BOTH tools, in order:

1. submit_concept with:
   - what: one paragraph (60-120 words) describing what this project is.
   - why: one paragraph explaining why it exists; cite README or files.
   - vision: one paragraph on where the project appears to be going (only claim what the source supports; otherwise say "vision not stated in source").
   - audience: 1-3 short bullets for target users.

2. submit_capture_plan with 4-10 shots that, together, would let a reader *see* this project. Constraints:
   - If signals.hasFrontend is true, include >=1 shot with target="live-app" and importance=1.
   - If signals.hasBackend is true OR fileCount>50, include >=1 shot with target="code-architecture" and a Mermaid spec.
   - At most 1 video; only include if includeVideo is true.
   - Routes for live-app shots must be plausible from the source (e.g. "/" is always safe; deeper routes require evidence).`;

export const USER_TECHNICAL_PROMPT = `You previously produced a concept and a capture plan. Below is a <capture-manifest> describing what was actually captured (some shots may have failed).

Call all three tools:

1. submit_technical:
   - stack: list of (technology, evidence path:line) tuples.
   - architecture: 80-160 words; reference the Mermaid diagram if present.
   - dataFlow: 60-120 words on how data moves through the system.
   - keyModules: 3-6 entries: { path, role, oneLineSummary, citations[] }.
   - gettingStarted: shell commands derived from package.json scripts / README; never invent a command.

2. submit_captions: one entry per successful shot in the manifest. Each caption is <=60 words and explains what the reader should notice.

3. submit_summary:
   - oneLiner: <=14 words, no period at the end.
   - tldr: exactly 3 bullets, each <=20 words.`;
