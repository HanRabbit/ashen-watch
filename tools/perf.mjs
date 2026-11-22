// 夜间性能取样（A12、PRD 第 10 节）：1080p 下沿主路从门房走到祭台再走回来，记录平均帧率与掉帧位置。
// 用开发预设摆出入夜状态（壁灯与提灯点亮、两鬼在场），不捕获真实鼠标，取样期间可以照常用电脑。
// 用法：node tools/perf.mjs [chrome|msedge] [--headless]
// 结果写到 docs/verification/perf-night-<浏览器>.json。需要先 npm run preview。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch, OUT, sleep, waitFor } from './lib.mjs';

const channel = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'chrome';
const headless = process.argv.includes('--headless');

const { browser, page, errors } = await launch({ channel, headless });
await page.goto(`${BASE}?preset=dev&dayscale=1`);
await waitFor(page, () => window.__awProbe?.state().perf.calls > 0);
await page.evaluate(() => window.__awDev.fakeLock(true));
await page.locator('#overlay button', { hasText: '新游戏' }).click();
await page.locator('#overlay button', { hasText: '开始' }).click();
await sleep(300);

// 摆到黄昏的最后一刻，让模拟自己入夜：炉火与两鬼按正常规则初始化
await page.evaluate(() => {
  const w = window.__awDev.session.world;
  w.inv.hasLantern = true; w.quest.boardRead = true;
  w.lantern.on = true; w.lantern.oil = 300;
  w.repairs.lamp = true; w.lampBurn = 180;
  w.doors.gatehouse = true; w.doors.chapelFront = true;
  Object.assign(w.player, { x: 0, z: -1, yaw: 0 });
  window.__awDev.input.yaw = 0;
  w.phase = 'dusk'; w.clock = 89.9;
});
await waitFor(page, () => window.__awProbe.lite().world.phase === 'night');

/** 沿导航图走到 (x, z)，secs 为 0 时原地停留 hold 秒。角色不会倒下：取样只关心帧时间。 */
const segment = (tag, x, z, hold = 0) => page.evaluate(async ([tx, tz, holdMs]) => {
  const d = window.__awDev, probe = window.__awProbe;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const key = (type) => document.dispatchEvent(new KeyboardEvent(type, { code: 'KeyW' }));
  probe.resetPerf();
  const t0 = performance.now();
  let n = 0, route = null, pauses = 0, arrived = holdMs > 0;
  if (!holdMs) key('keydown');
  for (;;) {
    await frame();
    const p = d.session.world.player;
    p.hp = 100; p.cold = 0;
    if (d.screens.isOpen()) {
      // 窗口失焦会暂停游戏：点「继续游戏」并重新按下前进
      pauses++;
      document.querySelector('#overlay button[data-act="resume"]')?.click();
      if (!holdMs) key('keydown');
      continue;
    }
    const el = performance.now() - t0;
    if (holdMs) { if (el > holdMs) break; continue; }
    if (Math.hypot(p.x - tx, p.z - tz) < 0.4) { arrived = true; break; }
    if (el > 90000) break;
    if (!route || n % 10 === 0) route = probe.path(tx, tz);
    n++;
    if (!route || !route.length) break;
    const wp = route.find((q) => Math.hypot(q.x - p.x, q.z - p.z) > 0.35) ?? route[route.length - 1];
    // 每帧最多转 4°，接近真人转动鼠标的速度
    let e = Math.atan2(wp.x - p.x, wp.z - p.z) - d.input.yaw;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    d.input.yaw += Math.max(-0.07, Math.min(0.07, e));
  }
  key('keyup');
  const perf = probe.state().perf;
  return { arrived, pauses, secs: +((performance.now() - t0) / 1000).toFixed(1), frames: perf.frames, avgMs: +perf.avgMs.toFixed(2), fps: +perf.fps.toFixed(1),
    p95Ms: +perf.p95Ms.toFixed(1), maxMs: +perf.maxMs.toFixed(1), over20ms: perf.over20ms, calls: perf.calls, triangles: perf.triangles, slow: probe.slowFrames() };
}, [x, z, hold * 1000]).then((r) => ({ tag, ...r }));

const segs = [];
for (const [tag, x, z, hold] of [
  ['去程：门房→祭台（主路）', 19, 10.9, 0],
  ['回程：祭台→门房（主路）', -0.2, -1.0, 0],
  ['守夜：门房炉火旁', 0, 0, 15],
]) {
  const r = await segment(tag, x, z, hold);
  segs.push(r);
  const { slow, ...brief } = r;
  console.log(JSON.stringify(brief));
}

// 掉帧位置：超过 25 ms 的帧按 4 m 网格归并
const where = {};
for (const s of segs.flatMap((g) => g.slow)) {
  const k = `(${Math.round(s.x / 4) * 4}, ${Math.round(s.z / 4) * 4})`;
  where[k] = where[k] ?? { count: 0, worstMs: 0 };
  where[k].count++; where[k].worstMs = Math.max(where[k].worstMs, s.ms);
}
const frames = segs.reduce((a, b) => a + b.frames, 0);
const avgMs = segs.reduce((a, b) => a + b.avgMs * b.frames, 0) / Math.max(1, frames);
const out = {
  channel, headless, finishedAt: new Date().toISOString(),
  gpu: await page.evaluate(() => window.__awProbe.gpu()),
  viewport: page.viewportSize(),
  canvas: await page.evaluate(() => { const c = document.getElementById('game'); return { width: c.width, height: c.height }; }),
  summary: { frames, avgFps: +(1000 / avgMs).toFixed(1), avgMs: +avgMs.toFixed(2), worstP95Ms: Math.max(...segs.map((s) => s.p95Ms)), maxMs: Math.max(...segs.map((s) => s.maxMs)),
    over20ms: segs.reduce((a, b) => a + b.over20ms, 0), over25ms: segs.reduce((a, b) => a + b.slow.length, 0) },
  slowWhere: Object.entries(where).sort((a, b) => b[1].count - a[1].count).slice(0, 10).map(([at, v]) => ({ at, ...v })),
  segments: segs.map(({ slow, ...s }) => s),
  consoleErrors: errors,
};
fs.writeFileSync(path.join(OUT, `perf-night-${channel}.json`), JSON.stringify(out, null, 2));
console.log('合计：', JSON.stringify(out.summary));
console.log('掉帧位置：', JSON.stringify(out.slowWhere));
console.log('gpu:', out.gpu, ' canvas:', JSON.stringify(out.canvas), ' errors:', errors);
await browser.close();
process.exit(errors.length || segs.some((s) => !s.arrived) ? 1 : 0);
