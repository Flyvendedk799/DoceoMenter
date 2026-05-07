import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { evaluateImageQuality } from "./quality.js";

let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "doceomenter-test-"));
  // Solid white image — should fail uniformity.
  const blank = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  writeFileSync(join(dir, "blank.png"), blank);
  // Random noise image — should pass.
  const w = 800;
  const h = 600;
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
  const noise = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  writeFileSync(join(dir, "noise.png"), noise);
});

describe("evaluateImageQuality", () => {
  it("rejects a blank image", async () => {
    const r = await evaluateImageQuality(join(dir, "blank.png"));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(",")).toMatch(/uniformity|entropy/);
  });
  it("accepts a noisy image", async () => {
    const r = await evaluateImageQuality(join(dir, "noise.png"));
    expect(r.ok).toBe(true);
  });
});
