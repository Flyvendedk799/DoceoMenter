import sharp from "sharp";

export type QualityResult = {
  ok: boolean;
  reasons: string[];
  metrics: { width: number; height: number; entropy: number; meanLum: number; uniformity: number };
};

const MIN_ENTROPY = 1.5;
const MAX_UNIFORMITY = 0.985;

export async function evaluateImageQuality(pngPath: string): Promise<QualityResult> {
  const img = sharp(pngPath);
  const meta = await img.metadata();
  const stats = await img.stats();
  const { data, info } = await img
    .clone()
    .greyscale()
    .resize(160, 160, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 1) {
    histogram[data[i]!]! += 1;
  }
  const total = info.width * info.height;
  let entropy = 0;
  let mode = 0;
  let modeCount = 0;
  for (let i = 0; i < 256; i += 1) {
    const c = histogram[i]!;
    if (c > modeCount) {
      mode = i;
      modeCount = c;
    }
    if (c === 0) continue;
    const p = c / total;
    entropy += -p * Math.log2(p);
  }
  const uniformity = modeCount / total;
  void mode;
  const meanLum = stats.channels.reduce((a, c) => a + c.mean, 0) / stats.channels.length;

  const reasons: string[] = [];
  if (entropy < MIN_ENTROPY) reasons.push(`low entropy ${entropy.toFixed(2)}`);
  if (uniformity > MAX_UNIFORMITY) reasons.push(`uniformity ${(uniformity * 100).toFixed(1)}%`);
  if ((meta.width ?? 0) < 320 || (meta.height ?? 0) < 240) {
    reasons.push(`tiny ${meta.width}×${meta.height}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    metrics: {
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      entropy,
      meanLum,
      uniformity,
    },
  };
}
