// Local render verification. Serve a dev-preset build first. For example:
// AW_URL=http://127.0.0.1:4183 AW_ANGLE=metal AW_OUT=/tmp/lighting AW_VIDEO=1 node tools/render-lighting-scout.mjs night cinematic
import fs from 'node:fs';
import path from 'node:path';
import { BASE, OUT, launch, shot, sleep, waitFor } from './lib.mjs';
import { Bot, STAND, doTutorial, startNewGame } from './bot.mjs';

const [phase = 'day', quality = 'cinematic'] = process.argv.slice(2);
if (!['day', 'night'].includes(phase) || !['low', 'high', 'cinematic'].includes(quality)) throw new Error('Expected day|night low|high|cinematic');
const { browser, context, page, errors } = await launch({ channel: 'chromium', headless: true });
const bot = new Bot(page);
const id = `${phase}-${quality}`;
const report = { phase, quality, viewport: page.viewportSize(), frames: [], errors };
const capture = async (name, yaw, pitch, area) => {
  await bot.aim(yaw, 0.025, pitch);
  await sleep(350);
  const frame = await page.evaluate(async () => {
    const { view } = window.__awDev, probe = window.__awProbe;
    const gl = view.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const render = view.render;
    const queries = [], gpu = [];
    let issued = 0, disjoint = false;
    const poll = () => {
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint = true;
      while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
        const query = queries.shift();
        gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
    };
    if (ext) view.render = function () {
      poll();
      if (issued < 24 && queries.length < 6) {
        const query = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        try { render.call(this); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); }
        queries.push(query);
        issued++;
      } else render.call(this);
    };
    probe.resetPerf();
    try { await new Promise((resolve) => setTimeout(resolve, 1400)); }
    finally {
      view.render = render;
      if (ext) {
        poll();
        for (const query of queries) gl.deleteQuery(query);
      }
    }
    gpu.sort((a, b) => a - b);
    const { world, perf, locked } = probe.state();
    return { phase: world.phase, player: world.player, locked, fixed: !!view.fixedCam, camera: view.camera.position.toArray(), perf,
      gpuMs: ext ? { issued, samples: gpu.length, disjoint, p50: !disjoint ? gpu[Math.floor(gpu.length * 0.5)] : null,
        p90: !disjoint ? gpu[Math.floor(gpu.length * 0.9)] : null } : { unavailable: true } };
  });
  if (frame.fixed || !frame.locked || frame.phase !== phase || frame.player.floor !== '1F' || !area(frame.player)) {
    throw new Error(`${name}: unexpected view ${JSON.stringify(frame)}`);
  }
  report.frames.push({ name, ...frame });
  await shot(page, `${id}-${name}.png`);
  console.log(id, name, `${frame.perf.fps.toFixed(1)} fps`, frame.gpuMs);
};
try {
  await page.addInitScript((q) => localStorage.setItem('ashen-watch/settings', JSON.stringify({ mode: 'kbm', sensitivity: 1, brightness: 1, quality: q })), quality);
  await page.goto(`${BASE}?preset=dev&dayscale=1`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__awProbe?.state().perf.calls > 0, 30000);
  await page.evaluate(() => window.__awTexReady);
  report.gpu = await page.evaluate(() => window.__awProbe.gpu());
  await startNewGame(bot);
  await doTutorial(bot);
  await page.evaluate((phase) => {
    const d = window.__awDev, w = d.session.world;
    document.getElementById('debug').style.display = 'none';
    w.phase = phase;
    w.clock = phase === 'day' ? 100 : 0;
    w.repairs.lamp = true;
    w.lampBurn = 250;
    w.braziers.chapel = 150;
    w.braziers.side = 150;
    w.lantern.oil = 240;
    w.lantern.on = phase === 'night';
    d.hud(false);
  }, phase);
  const walk = (x, z) => bot.walkTo(x, z, { floor: '1F', stop: 0.22, maxSecs: 35 });
  await walk(0.6, -4.2);
  await capture('01-gatehouse', -Math.PI * 0.37, 0.025, (p) => p.z < -2);
  await bot.use('ghDoor', STAND.doorIn);
  await walk(0, -1.35);
  await capture('02-threshold', 0, 0.055, (p) => p.z < 0);
  await walk(-5.9, 15.8);
  await capture('03-courtyard', Math.PI * 0.58, -0.11, (p) => p.z > 10);
  if (phase === 'day') await bot.toggleLantern();
  await walk(4.0, 9.9);
  await capture('04-s1-lantern', Math.PI / 2, 0.4, (p) => p.x > 3 && p.z > 9);
  if (process.env.AW_SSR_AB === '1' && quality === 'cinematic') {
    // Let the moving camera settle naturally, then render the same state twice to isolate SSR.
    await walk(-3.2, 15.0);
    await bot.aim(Math.PI / 2, 0.025, 0.16);
    await sleep(350);
    await page.evaluate(() => {
      const { view } = window.__awDev;
      view.renderer.setAnimationLoop(null);
      window.__awReflectionFrame = (enabled) => {
        if (!enabled) view.post.ssr.opacity = 0;
        view.render();
      };
    });
    await page.evaluate(() => window.__awReflectionFrame(true));
    await shot(page, `${id}-ssr-on.png`);
    await page.evaluate(() => window.__awReflectionFrame(false));
    await shot(page, `${id}-ssr-off.png`);
  }
} catch (error) {
  errors.push(String(error));
  await shot(page, `${id}-error.png`).catch(() => {});
} finally {
  if (process.env.AW_VIDEO === '1') {
    const clip = page.video();
    await context.close().catch(() => {});
    if (clip) await clip.saveAs(path.join(OUT, `${id}.webm`)).catch((error) => errors.push(String(error)));
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(report, null, 2));
  if (errors.length) { process.exitCode = 1; console.error(errors); }
}
