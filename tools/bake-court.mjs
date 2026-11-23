// Regenerate the binary when the courtyard footprint, decks or major props move.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { outerBaileyOccluders } from './outer-bailey-occluders.mjs';
import { hardwareArgs } from './hardware-gpu.mjs';
import { runCourtTransport } from './courtTransportGpu.mjs';

const check = process.argv.includes('--check');
const target = fileURLToPath(new URL('../src/render/baked/court.irr.bin', import.meta.url));
const fragmentSource = fs.readFileSync(new URL('./courtTransport.frag.glsl', import.meta.url), 'utf8');
const args = hardwareArgs();
const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error' });
let browser;
try {
  const { prepareCourtTransport } = await vite.ssrLoadModule('/tools/courtTransport.ts');
  const input = prepareCourtTransport(outerBaileyOccluders());
  browser = await chromium.launch({ channel: process.env.AW_BROWSER ?? 'chrome', headless: true, args });
  const page = await browser.newPage();
  const gpu = await page.evaluate(runCourtTransport, { input, fragmentSource });
  const data = Buffer.from(gpu.bytes, 'base64');
  const probeCount = input.grid.nx * input.grid.ny * input.grid.nz;
  const bankSize = probeCount * 4;
  if (data.length !== 2 * bankSize) throw new Error(`Unexpected GPU transport readback length ${data.length}`);

  // Extend each GPU bank into buried texels for trilinear sampling at thin walls.
  for (let i = 0; i < probeCount; i++) {
    const donor = input.probes.pixels[i * 4 + 3];
    if (donor === i) continue;
    data.copyWithin(i * 4, donor * 4, donor * 4 + 4);
    data.copyWithin(bankSize + i * 4, bankSize + donor * 4, bankSize + donor * 4 + 4);
  }
  console.log(`GPU: ${gpu.renderer}`);
  console.log(`Court transport: ${probeCount} probes, ${input.probes.buried} buried, ${input.solidCount} occluders, ${data.length} bytes`);
  console.log(`WebGL setup ${gpu.setupMs.toFixed(1)} ms, two draws + readback ${gpu.drawReadbackMs.toFixed(1)} ms`);
  if (check) {
    if (!fs.readFileSync(target).equals(data)) throw new Error('Stale courtyard irradiance: run npm run bake:light');
    console.log('Courtyard irradiance matches the hardware bake byte for byte.');
  } else {
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, data, { flag: 'wx' });
    try { fs.renameSync(temp, target); }
    finally { fs.rmSync(temp, { force: true }); }
  }
} finally {
  try { await browser?.close(); }
  finally { await vite.close(); }
}
