import { execa } from "execa";

let cached: boolean | undefined;
export async function hasFfmpeg(): Promise<boolean> {
  if (cached !== undefined) return cached;
  try {
    await execa("ffmpeg", ["-version"], { timeout: 3000 });
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

export async function transcodeWebmToMp4(inputWebm: string, outputMp4: string): Promise<void> {
  await execa(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputWebm,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      outputMp4,
    ],
    { timeout: 60_000 },
  );
}

export async function extractPosterFrame(inputMp4OrWebm: string, outputJpg: string): Promise<void> {
  await execa(
    "ffmpeg",
    ["-y", "-ss", "1.0", "-i", inputMp4OrWebm, "-vframes", "1", "-q:v", "3", outputJpg],
    { timeout: 30_000 },
  );
}
