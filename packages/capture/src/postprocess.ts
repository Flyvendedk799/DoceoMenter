import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";
import sharp from "sharp";
import type { CaptureManifest } from "@doceomenter/shared";

export async function postProcessAssets(manifest: CaptureManifest, outDir: string): Promise<void> {
  for (const e of manifest.entries) {
    if (e.status !== "ok" || !e.outputs?.pngPath) continue;
    const png = e.outputs.pngPath;
    const dir = dirname(png);
    const base = basename(png, extname(png));
    const webp = join(dir, `${base}.webp`);
    const thumb = join(dir, `${base}-thumb.webp`);
    const buf = await readFile(png);
    await sharp(buf).webp({ quality: 90 }).toFile(webp);
    await sharp(buf).resize({ width: 320 }).webp({ quality: 80 }).toFile(thumb);
    e.outputs.webpPath = webp;
    e.outputs.thumbPath = thumb;
  }
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}
