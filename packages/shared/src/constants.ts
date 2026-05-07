export const DEFAULT_VIEWPORT = { width: 1440, height: 900 } as const;
export const DEFAULT_DPR = 2;
export const VIDEO_VIEWPORT = { width: 1280, height: 720 } as const;

export const STAGE_NAMES = [
  "clone",
  "analyze",
  "draft-concept",
  "detect-runtime",
  "boot",
  "capture",
  "draft-technical",
  "post-process",
  "render",
] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export const TERMINAL_STATES = ["done", "failed", "partial", "cancelled"] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];
