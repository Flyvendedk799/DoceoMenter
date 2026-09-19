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

  // Dark empty-state UI: mostly black with a bright header band (nav + title).
  // Mirrors CraftMagic /library — low entropy but real chrome; must pass.
  const darkUi = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      if (y < 72 || (y < 160 && x < 420)) {
        darkUi[i] = 240;
        darkUi[i + 1] = 245;
        darkUi[i + 2] = 250;
      } else if (y < 90 && x > w - 180) {
        darkUi[i] = 80;
        darkUi[i + 1] = 220;
        darkUi[i + 2] = 160;
      } else {
        darkUi[i] = 12;
        darkUi[i + 1] = 14;
        darkUi[i + 2] = 18;
      }
    }
  }
  const darkPng = await sharp(darkUi, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  writeFileSync(join(dir, "dark-empty-ui.png"), darkPng);
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
  it("accepts a dark empty-state UI with real chrome", async () => {
    const r = await evaluateImageQuality(join(dir, "dark-empty-ui.png"));
    expect(r.metrics.entropy).toBeLessThan(1.5);
    expect(r.ok).toBe(true);
  });
});
