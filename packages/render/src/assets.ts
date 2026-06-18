import type { CaptureManifestEntry } from "@doceomenter/shared";

/**
 * True when an `ok` capture entry actually has a renderable image or video on
 * disk. Guards against emitting empty "(no asset)" slides / blank markdown for
 * entries that are marked ok but carry no usable output.
 */
export function hasRenderableMedia(entry: CaptureManifestEntry): boolean {
  const o = entry.outputs;
  if (!o) return false;
  // A bare poster (no image/video) is not on its own renderable content.
  return Boolean(o.webpPath || o.pngPath || o.mp4Path || o.webmPath);
}

/**
 * Flatten a capture output path to an asset-relative reference, preserving the
 * `screenshots/` or `videos/` sub-folder when present and falling back to a
 * known sub-folder otherwise. Shared by the markdown and deck renderers so they
 * never diverge on which file they point at.
 */
export function assetRef(base: string, path: string, fallbackDir: "screenshots" | "videos"): string {
  const segments = path.split(/[/\\]/);
  const lastTwo = segments.slice(-2);
  if (lastTwo.length === 2 && (lastTwo[0] === "screenshots" || lastTwo[0] === "videos")) {
    return `${base}/${lastTwo.join("/")}`;
  }
  return `${base}/${fallbackDir}/${segments[segments.length - 1] ?? ""}`;
}
