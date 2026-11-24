// Offline only: node tools/bake-chapel-sky.mjs
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const asset = new URL('../src/render/baked/chapel-sky.r8', import.meta.url);
// Vite needs an asset to resolve when generating the field from scratch.
if (!existsSync(asset)) writeFileSync(asset, '');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { bakeChapelSkyField } = await vite.ssrLoadModule('/tools/bake-chapel-air.ts');
  const start = performance.now();
  const baked = bakeChapelSkyField();
  const elapsed = performance.now()-start;
  writeFileSync(asset, baked);
  console.info(`Chapel sky: ${baked.byteLength} bytes, offline bake ${elapsed.toFixed(0)} ms`);
} finally { await vite.close(); }
