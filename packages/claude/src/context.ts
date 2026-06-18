import type { Analysis } from "@doceomenter/shared";

const README_BUDGET = 8000; // chars
const FILE_INDEX_BUDGET = 200; // entries
const MAX_LANGUAGES = 40;
const MAX_DEPS = 120;
const MAX_ENTRYPOINTS = 40;

export function buildRepoContext(a: Analysis): string {
  // Cap every unbounded collection so a pathological repo (thousands of deps /
  // languages) can't blow past the model's context window.
  const trimmedAnalysis = {
    repo: a.repo,
    sizeBytes: a.sizeBytes,
    fileCount: a.fileCount,
    languages: capRecord(a.languages, MAX_LANGUAGES),
    manifests: capManifests(a.manifests),
    entrypoints: a.entrypoints.slice(0, MAX_ENTRYPOINTS),
    signals: a.signals,
  };

  const readmeRaw = neutralizeTags(a.readme?.rawTrimmed?.slice(0, README_BUDGET) ?? "");

  const top = neutralizeTags(
    a.fileIndex
      .slice()
      .sort((x, y) => importance(y.path) - importance(x.path))
      .slice(0, FILE_INDEX_BUDGET)
      .map((f) => `${f.path} (${f.bytes}B)`)
      .join("\n"),
  );

  return [
    `<repo-context>`,
    `<analysis>${JSON.stringify(trimmedAnalysis, null, 2)}</analysis>`,
    `<readme>${readmeRaw}</readme>`,
    `<file-index>${top}</file-index>`,
    `</repo-context>`,
  ].join("\n");
}

/** Prevent untrusted content from closing/opening context tags to inject instructions. */
function neutralizeTags(s: string): string {
  return s.replace(/<(\/?)(repo-context|readme|file-index|analysis)>/gi, "‹$1$2›");
}

function capRecord(rec: Record<string, number>, max: number): Record<string, number> {
  const entries = Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);
  return Object.fromEntries(entries);
}

function capManifests(m: Analysis["manifests"]): Analysis["manifests"] {
  const out: Analysis["manifests"] = { ...m };
  if (out.nodePkg) {
    out.nodePkg = {
      ...out.nodePkg,
      deps: out.nodePkg.deps.slice(0, MAX_DEPS),
      devDeps: out.nodePkg.devDeps.slice(0, MAX_DEPS),
    };
  }
  if (out.pythonPyproject) {
    out.pythonPyproject = { ...out.pythonPyproject, deps: out.pythonPyproject.deps.slice(0, MAX_DEPS) };
  }
  if (out.pythonRequirements) {
    out.pythonRequirements = out.pythonRequirements.slice(0, MAX_DEPS);
  }
  return out;
}

function importance(p: string): number {
  let s = 0;
  if (/^(README|readme)/.test(p)) s += 100;
  if (/^package\.json$/.test(p)) s += 90;
  if (/^pyproject\.toml$/.test(p)) s += 90;
  if (/^Cargo\.toml$/.test(p)) s += 90;
  if (/^Dockerfile$/.test(p)) s += 80;
  if (/^docker-compose\.ya?ml$/.test(p)) s += 80;
  if (/^src\//.test(p)) s += 50;
  if (/^app\//.test(p)) s += 50;
  if (/^pages\//.test(p)) s += 50;
  if (/^lib\//.test(p)) s += 40;
  if (/index\.(ts|tsx|js|jsx)$/.test(p)) s += 30;
  if (/^tests?\//.test(p)) s -= 20;
  if (/node_modules/.test(p)) s -= 1000;
  if (/^\./.test(p)) s -= 10;
  s -= Math.floor(p.length / 32);
  return s;
}
