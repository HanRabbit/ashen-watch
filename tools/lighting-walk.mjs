// Walk a short 1F→2F lighting scout with real keyboard/mouse input. The dev
// preset sets only the initial time/light state of each run, never the camera/pose.
// Usage: AW_URL=http://localhost:4173/ AW_VIDEO=1 node tools/lighting-walk.mjs chromium --headless day|night
import fs from 'node:fs';
import path from 'node:path';
import { BASE, OUT, launch, shot, sleep, waitFor } from './lib.mjs';
import { Bot, STAND, doTutorial, startNewGame } from './bot.mjs';

const args = process.argv.slice(2);
const [channel = 'chrome', phase = 'day'] = args.filter((s) => !s.startsWith('--'));
if (!['day', 'night'].includes(phase)) throw new Error('照明阶段必须是 day 或 night');
const quality = process.env.AW_ROUTE_QUALITY ?? 'cinematic';
const { browser, context, page, errors } = await launch({ channel, headless: args.includes('--headless') });
const bot = new Bot(page);
const report = { phase, quality, viewport: page.viewportSize(), frames: [], errors };
const capture = async (name, yaw, pitch, floor) => {
  await bot.aim(yaw, 0.025, pitch);
  await sleep(450);
  const frame = await page.evaluate(() => {
    const { world, perf, locked } = window.__awProbe.state();
    const { view } = window.__awDev;
    const { x, y, z, floor } = world.player;
    return { phase: world.phase, x, y, z, floor, fixed: !!view.fixedCam, locked, camera: view.camera.position.toArray(), perf };
  });
  if (frame.fixed || !frame.locked || frame.phase !== phase || frame.floor !== floor) {
    throw new Error(`${name} 未在预期的实走视角/楼层：${JSON.stringify(frame)}`);
  }
  report.frames.push({ name, ...frame });
  await shot(page, `${phase}-${name}.png`);
  console.log(phase, name, floor, [frame.x, frame.y, frame.z].map((n) => n.toFixed(2)), frame.perf.fps.toFixed(1), 'fps');
};
const walk = (x, z, floor = '1F') => bot.walkTo(x, z, { floor, stop: 0.22, maxSecs: 40 });
try {
  await page.addInitScript((q) => localStorage.setItem('ashen-watch/settings', JSON.stringify({ mode: 'kbm', sensitivity: 1, brightness: 1, quality: q })), quality);
  await page.goto(`${BASE}?preset=dev&dayscale=1`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__awProbe?.state().perf.calls > 0, 30000);
  await page.evaluate(() => window.__awTexReady);
  report.gpu = await page.evaluate(() => window.__awProbe.gpu());
  await startNewGame(bot);
  await doTutorial(bot);
  await bot.use('ghDoor', STAND.doorIn);
  await page.evaluate((phase) => {
    const d = window.__awDev, w = d.session.world;
    document.getElementById('debug').style.display = 'none';
    w.phase = phase;
    w.clock = phase === 'day' ? 100 : 0;
    // Controlled lighting comparison, not the threat test. Location/input remain live.
    w.repairs.lamp = true;
    w.lampBurn = 250;
    w.braziers.chapel = 150;
    w.braziers.side = 150;
    w.lantern.oil = 240;
    w.lantern.on = phase === 'night';
    d.hud(false);
    window.__awProbe.resetPerf();
  }, phase);
  await walk(-5.9, 15.8);
  await capture('01-courtyard', Math.PI * 0.58, -0.11, '1F');
  await walk(-3, 19.1);
  await capture('02-courtyard-north', Math.PI * 0.43, -0.13, '1F');
  await walk(3.4, 1.4);
  await walk(9.2, 7.0, '2F');
  await capture('03-rampart-east', Math.PI * 0.64, -0.15, '2F');
  await walk(9.2, 16.2, '2F');
  await capture('04-rampart-northwest', -Math.PI * 0.34, 0.03, '2F');
} catch (e) {
  errors.push(e.message);
  await shot(page, `${phase}-error.png`).catch(() => {});
} finally {
  if (process.env.AW_VIDEO === '1') {
    const clip = page.video();
    await context.close().catch(() => {});
    if (clip) await clip.saveAs(path.join(OUT, `${phase}-lighting-walk.webm`)).catch((e) => errors.push(e.message));
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, `${phase}-lighting-walk.json`), JSON.stringify(report, null, 2));
  if (errors.length) { process.exitCode = 1; console.error(errors); }
}
