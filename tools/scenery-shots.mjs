// scenery 专用验收截图（避免与 map 改 tools/shots.mjs 冲突）。用 __awDev.fixedCam 摆机位。
// 用法：AW_URL=... AW_OUT=... node tools/scenery-shots.mjs chrome --headless [名称过滤]
import { launch, shot, sleep, waitFor } from './lib.mjs';

const channel = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'chrome';
const headless = process.argv.includes('--headless');
const filter = process.argv.slice(3).find((a) => !a.startsWith('--')) ?? '';

// 新参考机位（朝东看）：画面左=北(+z_sim)、右=南(−z_sim)
const REF_CAM = { pos: [-7.5, 1.7, 16.5], look: [19, 4.6, 16.5] };
const CASTLE_CAM = { pos: [58, 46, -18], look: [120, 72, -70] };
const PANO_CAM = { pos: [-30, 70, 70], look: [60, 45, -50] };
const GATE_CAM = { pos: [10, 22, 22], look: [40, 28, 60] };

const stage = (page, spec) => page.evaluate((s) => {
  const d = window.__awDev;
  if (d.session.world.phase === 'tutorial' && !d.started) d.started = true;
  const w = d.session.world;
  Object.assign(w, { phase: s.phase, clock: s.clock ?? 0 });
  w.inv.hasLantern = true; w.quest.boardRead = true;
  w.lantern.on = !!s.lantern; w.lantern.oil = 300;
  Object.assign(w.repairs, { lamp: true, gate: true });
  Object.assign(w.doors, { gatehouse: true });
  Object.assign(w.player, { x: s.at[0], z: s.at[1], yaw: 0, moving: false });
  d.input.yaw = 0; d.input.pitch = 0.1;
  d.fixedCam(s.cam.pos, s.cam.look);
  d.hud(false);
}, spec);

const SHOTS = [
  ['scenery2-ref-day', { phase: 'day', clock: 300, at: [-6, 16.5], cam: REF_CAM }],
  ['scenery2-ref-night', { phase: 'night', at: [-6, 16.5], cam: REF_CAM, lantern: false }],
  ['scenery2-castle-day', { phase: 'day', clock: 300, at: [-6, 16.5], cam: CASTLE_CAM }],
  ['scenery2-castle-night', { phase: 'night', at: [-6, 16.5], cam: CASTLE_CAM }],
  ['scenery2-gate-night', { phase: 'night', at: [-6, 16.5], cam: GATE_CAM }],
  ['scenery2-pano-day', { phase: 'day', clock: 300, at: [-6, 16.5], cam: PANO_CAM }],
];

const { browser, page, errors } = await launch({ channel, headless });
await page.goto(`${process.env.AW_URL ?? 'http://localhost:5183/'}?preset=dev`);
await waitFor(page, () => window.__awProbe?.state().perf.calls > 0);
await page.evaluate(() => window.__awTexReady);
await page.evaluate(() => { window.__awDev.fakeLock(true); });
await page.locator('#overlay button', { hasText: '新游戏' }).click();
await page.locator('#overlay button', { hasText: '开始' }).click();
await sleep(300);
await page.evaluate(() => { window.__awDev.input.locked = false; window.__awDev.screens.closeAll(); });

for (const [name, spec] of SHOTS) {
  if (filter && !name.includes(filter)) continue;
  await stage(page, spec);
  await sleep(900);
  await stage(page, spec);
  await sleep(120);
  await shot(page, `${name}.png`);
  const perf = await page.evaluate(() => window.__awProbe.state().perf);
  console.log('shot', name, 'calls', perf.calls, 'tris', perf.triangles);
}
console.log('errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);