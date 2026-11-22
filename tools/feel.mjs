// 手感测量：镜头在行走时是否匀速、原地转向时是否跳变。用开发预设摆位，读真实越肩镜头的位置。
// 用法：node tools/feel.mjs [chrome|msedge] [--headless] [标签]
// 结果写到 docs/verification/feel-<标签>.json。需要先 npm run preview。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch, OUT, sleep, waitFor } from './lib.mjs';

const channel = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'chrome';
const headless = process.argv.includes('--headless');
const label = process.argv.slice(3).find((a) => !a.startsWith('--')) ?? 'run';

/** 原地转向的测点：门房中央、刚出门房门、礼拜堂正门内、侧廊中段、庭院空地（对照）。 */
const SPOTS = [
  { name: '门房中央', at: [0, -4], doors: {} },
  { name: '门房门外 1 m', at: [0, 1.5], doors: { gatehouse: true } },
  { name: '门房门内 1 m', at: [0, -0.9], doors: { gatehouse: true } },
  { name: '礼拜堂正门内', at: [19, 24], doors: { chapelFront: true } },
  { name: '侧廊中段', at: [11.75, 9.5], doors: {} },
  { name: '庭院空地', at: [-4, 20], doors: {} },
];

const { browser, page, errors } = await launch({ channel, headless });
await page.goto(`${BASE}?preset=dev&dayscale=1`);
await waitFor(page, () => window.__awProbe?.state().perf.calls > 0);
await page.evaluate(() => window.__awDev.fakeLock(true));
await page.locator('#overlay button', { hasText: '新游戏' }).click();
await page.locator('#overlay button', { hasText: '开始' }).click();
await sleep(300);

const place = (spec) => page.evaluate((s) => {
  const d = window.__awDev, w = d.session.world;
  w.phase = 'day'; w.clock = 60; w.inv.hasLantern = true; w.quest.boardRead = true; w.lantern.on = false;
  Object.assign(w.doors, { gatehouse: false, gate: false, chapelFront: false }, s.doors);
  Object.assign(w.player, { x: s.at[0], z: s.at[1], yaw: s.yaw ?? 0 });
  d.input.yaw = s.yaw ?? 0; d.input.pitch = 0.12;
  d.fixedCam(null);
}, spec);

/**
 * 以固定角速度原地转 turns 圈。每帧从镜头自身的朝向反推它用的转角，记录镜头到角色的距离 r 与
 * 横向偏移 lat 每转过 1° 变化多少米：平滑收放时这个值很小，镜头一帧跳到位时很大。
 */
const spin = (degPerSec, turns) => page.evaluate(async ([rate, n]) => {
  const d = window.__awDev, cam = d.view.camera, p = d.session.world.player;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const yaw0 = d.input.yaw, DEG = Math.PI / 180;
  const dir = cam.position.clone();
  let t0 = await frame(), last = null, maxR = 0, maxL = 0, maxDr = 0, maxDl = 0, jumps = 0, frames = 0, hitches = 0;
  for (;;) {
    const t = await frame();
    const want = yaw0 + ((t - t0) / 1000) * rate * DEG;
    if (want - yaw0 > n * Math.PI * 2) break;
    d.input.yaw = want;
    cam.getWorldDirection(dir);
    const yaw = Math.atan2(dir.x, -dir.z);
    const dx = cam.position.x - p.x, dz = -cam.position.z - p.z;
    const r = Math.hypot(dx, dz), lat = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    if (last && frames > 20) {
      let dy = Math.abs(yaw - last.yaw) / DEG;
      if (dy > 180) dy = 360 - dy;
      // 单帧超过 60 ms 算卡顿，不计入镜头跳变
      if (t - last.t > 60) hitches++;
      else if (dy > 0.2) {
        const dr = Math.abs(r - last.r), dl = Math.abs(lat - last.lat);
        maxR = Math.max(maxR, dr / dy); maxL = Math.max(maxL, dl / dy);
        maxDr = Math.max(maxDr, dr); maxDl = Math.max(maxDl, dl);
        if (dr > 0.5 || dl > 0.3) jumps++;
      }
    }
    last = { r, lat, yaw, t }; frames++;
  }
  return { frames, fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1), hitches, distPerDeg: +maxR.toFixed(3), sidePerDeg: +maxL.toFixed(3), maxDr: +maxDr.toFixed(2), maxDl: +maxDl.toFixed(2), jumps };
}, [degPerSec, turns]);

/**
 * 直线行走 secs 秒，逐帧比较两种出图位置的速度：模拟位置（不插值，旧做法）与角色模型的实际位置。
 * 匀速时标准差接近 0。时间用浏览器的帧时间戳。
 */
const walk = async (secs) => {
  await page.keyboard.down('KeyW');
  await sleep(400);
  const res = await page.evaluate(async (ms) => {
    const d = window.__awDev, model = d.view.player.group.position, p = d.session.world.player;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const raw = [], shown = [], dts = [];
    let t0 = await frame(), tp = t0, rp = p.z, sp = -model.z;
    for (;;) {
      const t = await frame();
      if (t - t0 > ms) break;
      const dt = (t - tp) / 1000;
      raw.push((p.z - rp) / dt); shown.push((-model.z - sp) / dt); dts.push(t - tp);
      tp = t; rp = p.z; sp = -model.z;
    }
    const stat = (v) => {
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
      return { mean: +mean.toFixed(2), sd: +sd.toFixed(2), min: +Math.min(...v).toFixed(2), max: +Math.max(...v).toFixed(2), stalled: v.filter((x) => x < 0.2).length };
    };
    return { frames: dts.length, fps: +(1000 / (dts.reduce((a, b) => a + b, 0) / dts.length)).toFixed(1), simPosition: stat(raw), rendered: stat(shown) };
  }, secs * 1000);
  await page.keyboard.up('KeyW');
  return res;
};

const out = { label, channel, headless, finishedAt: '', gpu: await page.evaluate(() => window.__awProbe.gpu()), walk: null, spins: [] };
await place({ at: [-5, 7], doors: {} });
await sleep(300);
out.walk = await walk(5);
console.log('直线行走：', JSON.stringify(out.walk));
for (const s of SPOTS) {
  for (const rate of [90, 240]) {
    await place(s);
    await sleep(500);
    const r = await spin(rate, 2);
    out.spins.push({ spot: s.name, degPerSec: rate, ...r });
    console.log(`${s.name} @${rate}°/s：`, JSON.stringify(r));
  }
}
out.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(OUT, `feel-${label}.json`), JSON.stringify(out, null, 2));
console.log('gpu:', out.gpu, ' errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);
