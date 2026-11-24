// Offline only: node tools/bake-chapel-surface.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const asset = new URL('../src/render/baked/chapel-surface.irr.bin', import.meta.url);
const check = process.argv.includes('--check');
if (!existsSync(asset) && !check) writeFileSync(asset, '');
const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const { bakeChapelSurfaceTransport } = await vite.ssrLoadModule('/tools/chapelSurfaceBake.ts');
  const start = performance.now();
  const baked = bakeChapelSurfaceTransport();
  if (check) {
    if (!readFileSync(asset).equals(baked)) throw new Error('Chapel surface field is stale');
  } else {
    writeFileSync(asset, baked);
  }
  console.info(`Chapel surface field: ${baked.byteLength} bytes, ${(performance.now() - start).toFixed(0)} ms CPU`);
} finally {
  await vite.close();
}
