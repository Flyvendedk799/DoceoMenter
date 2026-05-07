import type { Analysis } from "@doceomenter/shared";

const README_BUDGET = 8000; // chars
const FILE_INDEX_BUDGET = 200; // entries

export function buildRepoContext(a: Analysis): string {
  const trimmedAnalysis = {
    repo: a.repo,
    sizeBytes: a.sizeBytes,
    fileCount: a.fileCount,
    languages: a.languages,
    manifests: a.manifests,
    entrypoints: a.entrypoints,
    signals: a.signals,
  };

  const readmeRaw = a.readme?.rawTrimmed?.slice(0, README_BUDGET) ?? "";

  const top = a.fileIndex
    .slice()
    .sort((x, y) => importance(y.path) - importance(x.path))
    .slice(0, FILE_INDEX_BUDGET)
    .map((f) => `${f.path} (${f.bytes}B)`)
    .join("\n");

  return [
    `<repo-context>`,
    `<analysis>${JSON.stringify(trimmedAnalysis, null, 2)}</analysis>`,
    `<readme>${readmeRaw}</readme>`,
    `<file-index>${top}</file-index>`,
    `</repo-context>`,
  ].join("\n");
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
