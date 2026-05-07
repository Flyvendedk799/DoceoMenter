import type {
  Caption,
  CapturePlan,
  Concept,
  RunSpec,
  Shot,
  Summary,
  Technical,
} from "./schemas.js";
import type { StageName, TerminalState } from "./constants.js";

export type Manifest = {
  nodePkg?: {
    name: string;
    scripts: Record<string, string>;
    deps: string[];
    devDeps: string[];
    engines?: Record<string, string>;
  };
  pythonPyproject?: { name: string; deps: string[] };
  pythonRequirements?: string[];
  cargoToml?: { name: string };
  goMod?: { module: string };
  dockerfile?: { exposedPorts: number[]; cmd?: string[] };
  composeYml?: { services: string[] };
};

export type Signals = {
  hasFrontend: boolean;
  hasBackend: boolean;
  hasCLI: boolean;
  isLibrary: boolean;
  framework?:
    | "next"
    | "vite"
    | "cra"
    | "astro"
    | "svelte-kit"
    | "fastapi"
    | "flask"
    | "django"
    | "express"
    | "static"
    | "unknown";
};

export type Analysis = {
  repo: { owner: string; name: string; ref: string; commitSha: string };
  sizeBytes: number;
  fileCount: number;
  languages: Record<string, number>;
  manifests: Manifest;
  entrypoints: string[];
  readme?: { path: string; firstNHeadings: string[]; rawTrimmed: string };
  fileIndex: Array<{ path: string; bytes: number }>;
  signals: Signals;
};

export type BootStrategy =
  | { kind: "next"; pkgManager: "pnpm" | "npm" | "yarn"; port: number }
  | { kind: "vite"; pkgManager: "pnpm" | "npm" | "yarn"; port: number }
  | { kind: "cra"; pkgManager: "pnpm" | "npm" | "yarn"; port: number }
  | { kind: "astro"; pkgManager: "pnpm" | "npm" | "yarn"; port: number }
  | { kind: "node-server"; cmd: string; port: number }
  | { kind: "python-web"; cmd: string; port: number }
  | { kind: "static"; dir: string; port: number }
  | { kind: "docker"; composeService?: string; port: number }
  | { kind: "cli" }
  | { kind: "library" }
  | { kind: "unknown" };

export type StageStatus = "pending" | "running" | "done" | "skipped" | "degraded" | "failed";

export type StageState = {
  name: StageName;
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  pct?: number;
};

export type RunState = {
  runId: string;
  spec: RunSpec;
  state: "queued" | "running" | TerminalState;
  createdAt: string;
  updatedAt: string;
  stages: StageState[];
  artifacts?: {
    reportMd?: string;
    deckHtml?: string;
    deckPdf?: string;
    zip?: string;
  };
  error?: string;
};

export type CaptureManifestEntry = {
  shotId: string;
  shot: Shot;
  status: "ok" | "failed" | "skipped";
  failureReason?: string;
  outputs?: {
    pngPath?: string;
    webpPath?: string;
    thumbPath?: string;
    mp4Path?: string;
    webmPath?: string;
    posterPath?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    bytes?: number;
    sha256?: string;
  };
};

export type CaptureManifest = {
  entries: CaptureManifestEntry[];
};

export type GeneratedContent = {
  concept: Concept;
  capturePlan: CapturePlan;
  technical: Technical;
  captions: Caption[];
  summary: Summary;
};

export type RunEvent =
  | { type: "stage"; stage: StageState }
  | { type: "log"; line: string; level?: "info" | "warn" | "error" }
  | { type: "asset"; shotId: string; thumbnailUrl?: string; kind: "screenshot" | "video" }
  | { type: "done"; artifacts: NonNullable<RunState["artifacts"]> }
  | { type: "error"; error: string };

export type {
  Caption,
  CapturePlan,
  Concept,
  RunSpec,
  Shot,
  Summary,
  Technical,
} from "./schemas.js";
export type { StageName, TerminalState } from "./constants.js";
