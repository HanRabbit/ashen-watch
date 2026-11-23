import * as THREE from 'three';
import { expect, it } from 'vitest';
import { fillLUT, FilmOutputShader, makeLUT } from '../src/render/post/grade';

// Emulate WebGL's trilinear sample at the shader's texel-centred coordinates.
function sampleLut(tex: THREE.Data3DTexture, rgb: [number, number, number]): number[] {
  const n = tex.image.width;
  const xyz = rgb.map(v => v * (n - 1));
  const lo = xyz.map(Math.floor), t = xyz.map((v, i) => v - lo[i]);
  const data = tex.image.data as Uint8Array;
  const result = [0, 0, 0];
  for (let z = 0; z <= 1; z++) for (let y = 0; y <= 1; y++) for (let x = 0; x <= 1; x++) {
    const [r, g, b] = [x, y, z].map((offset, i) => Math.min(n - 1, lo[i] + offset));
    const weight = (x ? t[0] : 1 - t[0]) * (y ? t[1] : 1 - t[1]) * (z ? t[2] : 1 - t[2]);
    for (let c = 0; c < 3; c++) result[c] += weight * data[4 * ((b * n + g) * n + r) + c] / 255;
  }
  return result;
}

it('maintains sub-code-value precision on a smooth ramp without a larger LUT', () => {
  const tex = makeLUT();
  fillLUT(tex, { sat: 1, contrast: 1, tintS: 0, tintH: 0 });
  expect(tex.image.data?.byteLength).toBe(32 ** 3 * 4);
  expect(tex.minFilter).toBe(THREE.LinearFilter);
  expect(tex.magFilter).toBe(THREE.LinearFilter);
  let previous = -1;
  for (let i = 0; i <= 1024; i++) {
    const t = i / 1024;
    const [r, g, b] = sampleLut(tex, [t, 0.19 + t * 0.15, 0.26 + t * 0.18]);
    expect(r).toBeGreaterThan(previous);
    expect(Math.abs(r - t) * 255).toBeLessThanOrEqual(0.5);
    expect(Math.abs(g - (0.19 + t * 0.15)) * 255).toBeLessThanOrEqual(0.5);
    expect(Math.abs(b - (0.26 + t * 0.18)) * 255).toBeLessThanOrEqual(0.5);
    previous = r;
  }
});

it('keeps the night grade endpoints and cool split tone', () => {
  const tex = makeLUT();
  fillLUT(tex, { sat: 0.89, contrast: 1.05, tintS: 0x24364c, tintH: 0xffb25e });
  expect(sampleLut(tex, [0, 0, 0])).toEqual([0, 0, 0]);
  expect(sampleLut(tex, [1, 1, 1])).toEqual([1, 1, 1]);
  const [r, , b] = sampleLut(tex, [0.23, 0.23, 0.23]);
  expect(b).toBeGreaterThan(r);
});

it('uses stable sub-code grain for smooth haze and blends, rather than steps, the animated detail grain', () => {
  const { fragmentShader: shader } = FilmOutputShader;
  // Static shader contract: the browser suite owns actual GPU compilation and capture.
  const flatWeight = Number(shader.match(/mix\(dither \* ([\d.]+), grain, detail\) \* uGrain/)?.[1]);
  expect(flatWeight).toBeGreaterThan(0);
  // Maximum documented rig grain (0.022), before shadow/highlight attenuation.
  expect(flatWeight * 0.022 * 255).toBeLessThan(1.25);
  expect(shader).toContain('fwidth(luma)');
  expect(shader).toMatch(/float dither = [^;]*dot\(pixel,/);
  expect(shader).toContain('smoothstep(0.0, 1.0, fract(tick))');
  expect(shader).toMatch(/mix\(filmNoise\(pixel, mod\(phase, 251\.0\)\), filmNoise\(pixel, mod\(phase \+ 1\.0, 251\.0\)\), fade\)/);
  // One colour sample and the existing 3D LUT: no spatial filter or grain texture.
  expect(shader.match(/\btexture(?:2D)?\(/g)).toHaveLength(2);
});

it('keeps zero radiance at black and reveals faint positive radiance without affecting midtones', () => {
  const shade = FilmOutputShader.fragmentShader;
  const [, slopeValue, capValue] = shade.match(/float toeY = ([\d.]+) \* sceneY \/ \(1.0 \+ [\d.]+ \* sceneY \/ ([\d.]+)\)/) ?? [];
  const slope = Number(slopeValue), cap = Number(capValue);
  const aces = (y: number) => { const v = y / .6; return Math.max(0, (v * (v + .0245786) - .000090537) / (v * (.983729 * v + .432951) + .238081)); };
  const out = (y: number) => Math.max(aces(y), slope * y / (1 + slope * y / cap));
  expect(out(0)).toBe(0);
  expect(aces(.0013)).toBe(0);
  expect(out(.0013)).toBeGreaterThan(.001);
  let last = 0;
  for (let i = 1; i <= 1000; i++) { const value = out(i / 10000); expect(value).toBeGreaterThan(last); last = value; }
  for (const y of [.05,.18,1,4]) expect(out(y)).toBe(aces(y));
});
