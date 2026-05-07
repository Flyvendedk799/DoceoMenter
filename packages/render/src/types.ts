import type {
  Analysis,
  CaptureManifest,
  GeneratedContent,
} from "@doceomenter/shared";

export type RenderInput = {
  runId: string;
  generatedAt: string;
  analysis: Analysis;
  content: GeneratedContent;
  capture: CaptureManifest;
  /** Relative paths the renderer should use (e.g. "./assets/screenshots/foo.png"). */
  assetsBasePath: string;
};
