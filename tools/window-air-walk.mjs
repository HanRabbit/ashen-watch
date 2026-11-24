// AW_URL=http://127.0.0.1:4199/ AW_OUT=.cache/window-air-walk AW_ANGLE=metal node tools/window-air-walk.mjs chrome --headless
// Serve a dev-preset build with the live uWindowScatter toggle. No fixed camera.
// AW_CHAPEL_AIR=1 runs only the separately seeded chapel positive control.
// AW_CHAPEL_ROUTE=1 walks the shut, unlit chapel from vestibule to altar; AW_BASELINE=1 records the old build without enforcing the daylight minima.
// AW_ROUTE_QUALITY=high selects high instead of the default cinematic tier.
import fs from 'node:fs';
import path from 'node:path';

// Simulation x/y/z (render Z has the opposite sign). Courtyard-facing hearth window.
const windowAir = { center: [-1.54, 1.94, -.58], half: [.76, .72, .50] };
const start = [.45, 0, -5.4, '1F', 0, .03];
const stops = [
  { id: 'day-approach', x: .08, z: -3.6 },
  { id: 'day-cross-angle', x: -1.35, z: -2.02 },
  { id: 'day-past-window', x: -2.52, z: -1.30 },
];
const basement = [21, -3, 15.4, 'B1', Math.PI / 2, .13];
const chapel = {
  pose: [20.75, .45, 15.85, '1F', -1.58, -.76],
  air: { center: [15.06, 8.29, 15.10], half: [.75, .53, .55] },
};
const toggle = 'uWindowScatter';
const software = /unknown|swiftshader|llvmpipe|softpipe|lavapipe|software|swangle|basic render driver|warp\b/i;

function prepare({ pose, phase }) {
  const { session, input } = window.__awDev;
  const w = session.world;
  if (pose) {
    const [x, y, z, floor, yaw, pitch] = pose;
    Object.assign(w.player, { x, y, z, floor, yaw, pitch, moving: false, sprinting: false });
    Object.assign(input, { yaw, pitch });
  }
  w.phase = phase;
  w.clock = phase === 'night' ? 30 : 120;
  w.player.cold = 0;
  w.ghosts.length = 0;
  Object.assign(w.doors, { gatehouse: false, chapelFront: false, gate: false });
  Object.assign(w.lantern, { on: false, raised: false });
  Object.assign(w.hearth, { lit: false, burn: 0 });
  w.lampBurn = 0;
  for (const id of Object.keys(w.braziers)) w.braziers[id] = 0;
}

function evidence() {
  const { view, input } = window.__awDev;
  const { mode, locked, screen, world: w } = window.__awProbe.lite();
  const { camera, renderer } = view;
  return {
    mode, locked, screen, fixedCam: !!view.fixedCam,
    pointerLock: document.pointerLockElement === renderer.domElement && !input.fakeLock,
    phase: w.phase, clock: w.clock, time: view.time, moving: w.player.moving,
    pose: [w.player.x, w.player.y, w.player.z, w.player.floor, input.yaw, input.pitch],
    camera: { position: camera.position.toArray(), rotation: camera.quaternion.toArray(), projection: camera.projectionMatrix.toArray() },
    sources: { doors: { ...w.doors }, lantern: w.lantern.on, hearth: w.hearth.lit,
      lamp: w.lampBurn, braziers: { ...w.braziers }, key: view.sun.intensity, exposure: renderer.toneMappingExposure },
  };
}

// Execute all three live compositor renders in one JS turn. The normal game update has
// already settled the view; it cannot advance simulation, grain, or weather mid-pair.
function capture({ stateSource, air, toggle, cutSources }) {
  const state = (0, eval)(`(${stateSource})`);
  const { view } = window.__awDev;
  const { renderer, camera, post } = view;
  const before = state();
  if (!before.pointerLock || !before.locked || before.fixedCam || before.mode !== 'playing' || before.screen || before.moving) {
    throw new Error(`Not stationary normal follow play: ${JSON.stringify(before)}`);
  }
  const { doors, lantern, hearth, lamp, braziers } = before.sources;
  if (lantern || hearth || lamp || Object.values(doors).some(Boolean) || Object.values(braziers).some(Boolean)) {
    throw new Error('Source controls were not cold and closed');
  }
  const materials = [...new Set([post?.glow?.material, post?.volume?.material].filter(m =>
    typeof m?.uniforms?.[toggle]?.value === 'number' && m.fragmentShader.includes(toggle)))];
  if (!materials.length) throw new Error(`${toggle} missing from active air material (expected post.glow or post.volume)`);

  let roi;
  if (air?.rect) roi = air.rect;
  else if (air) {
    const { center: [x, y, z], half: [dx, dy, dz] } = air;
    const projected = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const p = camera.position.clone().set(x + sx * dx, y + sy * dy, -(z + sz * dz)).project(camera);
      if (!Number.isFinite(p.x + p.y + p.z) || p.z <= -1 || p.z >= 1) throw new Error('Window-air ROI crosses camera clip plane');
      projected.push([(1 + p.x) / 2, (1 - p.y) / 2]);
    }
    const xs = projected.map(p => p[0]), ys = projected.map(p => p[1]);
    roi = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(1, Math.max(...xs)), Math.min(1, Math.max(...ys))];
    if ((roi[2] - roi[0]) * renderer.domElement.width < 8 || (roi[3] - roi[1]) * renderer.domElement.height < 8) {
      throw new Error(`Window air is outside the live camera: ${JSON.stringify(roi)}`);
    }
  }

  const sources = materials.map(material => ({ material, uniform: material.uniforms[toggle],
    original: material.uniforms[toggle].value, hook: material.onBeforeRender, draws: [], cut: [] }));
  try {
    for (const source of sources) source.material.onBeforeRender = function (...args) {
      source.hook.apply(this, args);
      if (cutSources) {
        for (const key of ['uWindowIrradiance', 'uKeyColour']) {
          const light = source.material.uniforms[key]?.value;
          if (!light?.isColor) throw new Error(`Cannot isolate window source ${key} in the live volume`);
          if (!source.cut.some(row => row.light === light)) source.cut.push({light, saved: light.clone()});
          light.setRGB(0, 0, 0);
        }
      }
      source.draws.push(source.uniform.value);
    };
    const frames = [['off', 0], ['on', 1], ['repeat', 0]].map(([id, value]) => {
      for (const source of sources) { source.uniform.value = value; source.draws = []; }
      view.render();
      const draws = sources.flatMap(s => s.draws.map(uniform => ({ material: s.material.name || s.material.type, uniform })));
      if (!draws.length || draws.some(draw => draw.uniform !== value)) throw new Error(`Toggle did not reach a live draw: ${JSON.stringify(draws)}`);
      const volume = post.glow?.uniforms?.uHasVolume?.value;
      if (materials.includes(post.volume?.material) && !(volume > .5)) throw new Error('Air volume draw was not resolved into the live composite');
      const png = renderer.domElement.toDataURL('image/png').split(',')[1];
      if (!png) throw new Error('Could not capture final WebGL backbuffer');
      return { id, value, draws, volume, png, calls: renderer.info.render.calls };
    });
    if (JSON.stringify(state()) !== JSON.stringify(before)) throw new Error('Camera, game state or sources changed during A/B');
    return { frames, state: before, roi };
  } finally {
    for (const s of sources) {
      s.uniform.value = s.original; s.material.onBeforeRender = s.hook;
      for (const {light, saved} of s.cut) light.copy(saved);
    }
  }
}

// Measure the exact saved PNGs in display space. Diff PNG: warm brighter, blue
// darker; magnitude boosted 32x for review only. Full-frame scan catches B1 leaks.
async function measure({ frames, roi }) {
  let width, height;
  const pixels = [];
  for (const png of frames) {
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    if (width && (width !== bmp.width || height !== bmp.height)) throw new Error('Render size changed between frames');
    ({ width, height } = bmp);
    const ctx = new OffscreenCanvas(width, height).getContext('2d', { colorSpace: 'srgb' });
    ctx.drawImage(bmp, 0, 0); bmp.close();
    pixels.push(ctx.getImageData(0, 0, width, height).data);
  }
  const [off, on, repeat] = pixels;
  const linear = Array.from({ length: 256 }, (_, i) => i <= 10 ? i / (255 * 12.92) : ((i / 255 + .055) / 1.055) ** 2.4);
  const y = (p, i) => .2126 * linear[p[i]] + .7152 * linear[p[i + 1]] + .0722 * linear[p[i + 2]];
  const delta = (a, b, i) => Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const empty = () => ({ pixels: 0, changed: 0, repeatChanged: 0, changedOverNoise: 0, brighterOverNoise: 0,
    readableOffPixels: 0, visibleGainPixels: 0, maxCode: 0, maxRepeatCode: 0, meanOffY: 0, meanSignedY: 0, meanPositiveY: 0, meanNoiseY: 0 });
  const full = empty(), window = empty();
  function add(m, code, noise, a, d, n) {
    m.readableOffPixels += +(a >= .012); // ~29/255 neutral sRGB or brighter, with scatter disabled
    m.visibleGainPixels += +(d > .006 + n && code >= 5);
    m.pixels++; m.changed += +(code > 0); m.repeatChanged += +(noise > 0);
    m.changedOverNoise += +(code > noise); m.brighterOverNoise += +(code > noise && d > n);
    m.maxCode = Math.max(code, m.maxCode); m.maxRepeatCode = Math.max(noise, m.maxRepeatCode);
    m.meanOffY += a; m.meanSignedY += d; m.meanPositiveY += Math.max(0, d); m.meanNoiseY += n;
  }
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = (row * width + col) * 4;
    const code = delta(off, on, i), noise = delta(off, repeat, i);
    const a = y(off, i), d = y(on, i) - a, n = Math.abs(y(repeat, i) - a);
    add(full, code, noise, a, d, n);
    if (roi && col + .5 >= roi[0] * width && row + .5 >= roi[1] * height && col + .5 < roi[2] * width && row + .5 < roi[3] * height) {
      add(window, code, noise, a, d, n);
    }
    const signal = 32 * Math.max(0, code - noise);
    image.data[i + 3] = 255;
    if (d >= 0) { image.data[i] = signal; image.data[i + 1] = signal * .62; }
    else image.data[i + 2] = signal;
  }
  for (const m of [full, window]) for (const key of ['meanOffY', 'meanSignedY', 'meanPositiveY', 'meanNoiseY']) {
    m[key] = m.pixels ? m[key] / m.pixels : null;
  }
  ctx.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const reader = new FileReader();
  const diff = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
  });
  return { full, window: roi ? window : null, diff };
}

async function main() {
  const quality = process.env.AW_ROUTE_QUALITY ?? 'cinematic';
  if (quality !== 'high' && quality !== 'cinematic') throw new Error('AW_ROUTE_QUALITY must be high or cinematic');
  process.env.AW_OUT ||= '.cache/window-air-walk';
  const chapelRoute = process.env.AW_CHAPEL_ROUTE === '1', baseline = process.env.AW_BASELINE === '1';
  const chapelOnly = process.env.AW_CHAPEL_AIR === '1';
  const { BASE, OUT, launch, shot, sleep, waitFor } = await import('./lib.mjs');
  const { Bot, startNewGame } = await import('./bot.mjs');
  const args = process.argv.slice(2), channel = args.find(s => !s.startsWith('--')) ?? 'chrome';
  const url = new URL(BASE);
  for (const [key, value] of Object.entries({ preset: 'dev', probe: 1, timescale: 1, dayscale: 1 })) url.searchParams.set(key, value);
  const width = Number(process.env.AW_W ?? 1280), height = Number(process.env.AW_H ?? 720);
  if (![width, height].every(n => Number.isInteger(n) && n >= 320 && n <= 3840)) throw new Error('Invalid AW_W/AW_H');
  const report = { url: url.href, channel, viewport: [width, height], quality, windowAir, toggle,
    method: 'Real pointer lock + Bot.walkTo (KeyW and mouse); same-turn live off/on/off. ROI is projected near-window air bounds. Deltas use display-relative linear Rec.709 Y; diff PNG is noise-subtracted RGB max code ×32.',
    route: [], batches: [], errors: [], console: [] };
  if (chapelOnly) {
    report.windowAir = chapel.air;
    report.chapelControl = { pose: chapel.pose, setup: 'Independently seeded daylight game state; real pointer lock and ordinary follow camera, no gatehouse route.' };
    report.method = report.method.replace('Real pointer lock + Bot.walkTo (KeyW and mouse);', 'Real pointer lock and independently seeded chapel follow camera;');
  }
  let browser;
  try {
    const { context, page, errors, browser: launched } = await launch({ channel, headless: args.includes('--headless'), width, height });
    browser = launched; report.browserErrors = errors;
    page.on('console', m => { if (report.console.length < 100) report.console.push({ type: m.type(), text: m.text() }); });
    const cdp = await browser.newBrowserCDPSession(), target = await context.newCDPSession(page);
    try {
      const { targetInfo } = await target.send('Target.getTargetInfo');
      await cdp.send('Browser.setPermission', { permission: { name: 'pointer-lock' }, setting: 'granted',
        origin: url.origin, browserContextId: targetInfo.browserContextId });
    } catch (e) { report.pointerLockPermission = e.message; }
    finally { await target.detach(); await cdp.detach(); }
    await page.addInitScript(quality => localStorage.setItem('ashen-watch/settings', JSON.stringify({ mode: 'kbm', brightness: 1, sensitivity: 1, quality })), quality);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => window.__awProbe?.lite && window.__awDev?.view?.renderer && window.__awTexReady, 60000);
    report.buildScripts = await page.evaluate(() => Array.from(document.scripts, s => s.src).filter(Boolean));
    await page.evaluate(() => Promise.race([window.__awTexReady, new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Game textures did not settle within 45 seconds')), 45000))]));
    report.gpu = await page.evaluate(() => window.__awProbe.gpu());
    if (!report.gpu || software.test(report.gpu)) throw new Error(`Game did not expose hardware WebGL: ${report.gpu}`);
    const bot = new Bot(page);
    // Cold Metal driver compilation may outlast the menu click helper’s normal timeout.
    await page.locator('#overlay button').filter({hasText: '新游戏'}).first().waitFor({state: 'visible', timeout: 90000});
    await startNewGame(bot);
    await page.evaluate(() => {
      window.__awDev.hud(false);
      const debug = document.getElementById('debug'); if (debug) debug.hidden = true;
    });
    const seed = (phase, pose) => page.evaluate(prepare, { phase, pose });
    const idle = async () => {
      await bot.stop();
      await waitFor(page, () => {
        const s = window.__awProbe.lite();
        return s.locked && !s.screen && !s.world.player.moving && document.pointerLockElement === window.__awDev.view.renderer.domElement;
      }, 5000);
      await sleep(550);
    };
    const walk = async ({ id, x, z }) => {
      const from = await page.evaluate(evidence);
      await bot.walkTo(x, z, { floor: '1F', stop: .27, maxSecs: chapelRoute ? 40 : 12 });
      await idle();
      const to = await page.evaluate(evidence);
      report.route.push({ id, input: 'WASD (KeyW) + pointer-locked mouse', target: [x, z], from, to });
      if (!to.pointerLock || to.fixedCam || Math.hypot(to.pose[0] - x, to.pose[2] - z) > .4 || Math.hypot(to.pose[0] - from.pose[0], to.pose[2] - from.pose[2]) < .45) {
        throw new Error(`${id}: did not walk to the target under the follow rig`);
      }
    };
    const aim = async () => {
      const [x, y, z] = windowAir.center;
      for (let i = 0; i < 2; i++) {
        const { camera: { position: [cx, cy, cz] } } = await page.evaluate(evidence);
        await bot.aim(Math.atan2(x - cx, z + cz), .018, -Math.atan2(y - cy, Math.hypot(x - cx, z + cz)));
        await idle();
      }
    };
    const pair = async (id, kind, air = kind === 'b1' ? null : windowAir) => {
      const batch = await page.evaluate(capture, { stateSource: evidence.toString(), air, toggle, cutSources: kind === 'cut' });
      const record = { id, kind, state: batch.state, roi: batch.roi, frames: [] };
      report.batches.push(record);
      for (const { png, ...frame } of batch.frames) {
        const file = path.join(OUT, `${id}-${frame.id}.png`);
        fs.writeFileSync(file, Buffer.from(png, 'base64'));
        record.frames.push({ ...frame, file });
      }
      const { diff, ...stats } = await page.evaluate(measure, { frames: batch.frames.map(f => f.png), roi: batch.roi });
      record.stats = stats;
      if (chapelRoute && process.env.AW_CHAPEL_PERF === '1' && kind === 'day') {
        // Ordinary animation frames, not screenshot readback or compositor A/B time.
        record.timing = await page.evaluate(async () => {
          const deltas = []; let last;
          for (let i=0; i<38; ++i) {
            const now = await new Promise(r => requestAnimationFrame(r));
            if (i >= 6) deltas.push(now-last);
            last=now;
          }
          deltas.sort((a,b)=>a-b);
          return { samples:deltas.length, medianMs:deltas[16], p95Ms:deltas[30], calls:window.__awDev.view.renderer.info.render.calls };
        });
      }
      record.diff = path.join(OUT, `${id}-delta-x32.png`);
      fs.writeFileSync(record.diff, Buffer.from(diff, 'base64'));
      const m = stats.window ?? stats.full;
      record.detected = kind === 'cut' ? m.visibleGainPixels > 0 : m.brighterOverNoise >= 16 && m.meanPositiveY > 3 * m.meanNoiseY;
      if (kind === 'day' && !baseline && !record.detected) report.errors.push(`${id}: no positive window-air signal above off-repeat noise`);
      if (kind === 'cut' && stats.full.visibleGainPixels > 0) report.errors.push(`${id}: scatter adds visible light with neither incident source`);
      if (kind !== 'day' && kind !== 'cut' && (stats.full.changedOverNoise > 0 || stats.full.meanPositiveY > stats.full.meanNoiseY)) {
        report.errors.push(`${id}: daylight scatter changed the ${kind === 'b1' ? 'sealed B1' : 'night'} frame above off-repeat noise`);
      }
      console.log(id, JSON.stringify({ detected: record.detected, ...m }));
    };

    if (chapelRoute) {
      report.method = 'Continuous collision-following play, real KeyW + pointer lock; same-turn scatter off/on/off. Normalized screen crop excludes outer vignette and most of the avatar. No image exposure correction.';
      delete report.windowAir;
      const air = { rect: [.27, .14, .88, .76] };
      const look = async (yaw, pitch) => {
        await bot.aim(yaw, .012, pitch); await idle();
        // The rig can still be slewing long after input.yaw has reached its target,
        // particularly during the first compilation of a new material variant.
        await waitFor(page, ([yaw, pitch]) => {
          const camera = window.__awDev.view.camera, d = camera.getWorldDirection(camera.position.clone());
          const e = Math.atan2(d.x, -d.z) - yaw;
          return Math.abs(Math.atan2(Math.sin(e), Math.cos(e))) < .03 && Math.abs(-Math.asin(d.y)-pitch) < .045;
        }, 9000, [yaw, pitch]);
        await sleep(350);
      };
      await seed('day', [14.4, .45, 16.5, '1F', 2.45, .015]); await look(2.45, .015);
      await pair('vestibule', 'day', air);
      await walk({id: 'partition-opening', x:16.5, z:12.7});
      await walk({id: 'to-pews', x:20, z:12.5}); await look(1.01, -.10); await pair('pews', 'day', air);
      await walk({id: 'central-aisle', x:24, z:16.5}); await look(1.48, .04); await pair('altar-approach', 'day', air);
      await look(-1.67, -.19); await pair('nave', 'day', air);
      await walk({id: 'to-altar', x:28, z:16.5}); await look(-1.02, -.17); await pair('altar-return', 'day', air);
      if (!baseline) {
        const daylight = report.batches.filter(b => b.kind === 'day');
        // These framing rectangles do not include bright clerestory glass:
        // a white pane cannot pass for a readable altar or vestibule floor.
        for (const id of ['vestibule', 'altar-approach']) {
          const m = daylight.find(b => b.id === id).stats.window;
          if (m.meanOffY < .0055 || m.readableOffPixels/m.pixels < .025) report.errors.push(`${id}: opaque chapel fabric is still crushed without scattering`);
        }
        if (daylight.filter(b => b.stats.window.visibleGainPixels / b.stats.window.pixels >= .085).length < 2) {
          report.errors.push('Fewer than two normal gameplay views show perceptible scattering over a substantial area');
        }
      }
      await pair('day-air-no-sources', 'cut', air);
      await seed('night'); await idle(); await pair('night-altar', 'night', air);
      await seed('day', basement); await idle(); await pair('sealed-b1', 'b1');
      const dark = report.batches.at(-1).stats.full;
      if (!baseline && dark.meanOffY > .00004) report.errors.push('Sealed B1 is luminous even with daylight scattering disabled');
      return;
    }
    if (chapelOnly) {
      await seed('day', chapel.pose);
      await idle();
      await pair('day-chapel-high-window', 'day', chapel.air);
      return;
    }

    await seed('day', start);
    await idle();
    for (const stop of stops.slice(0, 2)) { await walk(stop); await aim(); await pair(stop.id, 'day'); }
    const [a, b] = report.batches.map(batch => batch.state.camera);
    const separation = Math.hypot(...a.position.map((v, i) => v - b.position[i]));
    const angleDegrees = 2 * Math.acos(Math.min(1, Math.abs(a.rotation.reduce((dot, v, i) => dot + v * b.rotation[i], 0)))) * 180 / Math.PI;
    report.dayCameraSeparation = { metres: separation, degrees: angleDegrees };
    if (separation < .45 || angleDegrees < 3) throw new Error('Day stations did not produce two distinct nearby views');
    await walk(stops[2]);
    report.pastWindowScreenshot = await shot(page, 'day-past-window.png');
    await walk({ ...stops[1], id: 'night-return' });
    await seed('night'); await aim(); await pair('night-window', 'night');
    // Detached negative control; the closed-door day walk above is not teleported.
    await seed('day', basement); await idle(); await pair('day-b1-sealed', 'b1');
  } catch (error) {
    report.errors.push(error.stack ?? String(error));
  } finally {
    if (browser) await browser.close().catch(error => report.errors.push(error.message));
    report.ok = report.errors.length === 0 && !report.browserErrors?.length;
    const file = path.join(OUT, chapelRoute ? 'chapel-daylight-route.json' : chapelOnly ? 'window-air-chapel.json' : 'window-air-walk.json');
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${file}`);
    if (!report.ok) { console.error(...report.errors, ...(report.browserErrors ?? [])); process.exitCode = 1; }
  }
}

if (import.meta.main) await main();
