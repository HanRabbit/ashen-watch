// Actual-game lighting states, normal follow camera, hardware WebGL only.
// AW_URL=http://127.0.0.1:4214/ AW_OUT=.cache/rodin-production/light-before AW_ANGLE=metal node tools/light-source-audit.mjs chrome --headless
// Set identical AW_W/AW_H and AW_ROUTE_QUALITY when comparing builds (defaults: 1280x720, cinematic).
import fs from 'node:fs';
import path from 'node:path';
import { BASE, OUT, clickButton, launch, shot, sleep, waitFor } from './lib.mjs';

const args = process.argv.slice(2);
const channel = args.find((s) => !s.startsWith('--')) ?? 'chrome';
const quality = process.env.AW_ROUTE_QUALITY ?? 'cinematic';
const url = new URL(BASE);
url.searchParams.set('preset', 'dev');
url.searchParams.set('probe', '1');
url.searchParams.set('dayscale', '1');
url.searchParams.set('timescale', '1');
const name = 'light-source-audit';
const stations = [
  {
    id: 'b1-store', pose: [21.0, -3, 15.4, 'B1', Math.PI / 2, .13],
    rois: { eastStone: [.64, .30, .18, .19], rightFloor: [.63, .70, .19, .13] },
    states: [{ id: 'lantern-off', phase: 'day' }, { id: 'lantern-on', phase: 'day', keyF: true }],
    comparisons: [['lantern-off', 'lantern-on', 'lantern only; all other controllable sources remain off']],
  },
  {
    id: 'gatehouse', pose: [.22, 0, -4.8, '1F', Math.PI - .12, -.20],
    rois: { belowRearWindow: [.445, .627, .089, .061], deepLeftStone: [.07, .46, .128, .14], hearthSideMasonry: [.86, .57, .105, .143] },
    states: [{ id: 'day-all-off', phase: 'day' }, { id: 'night-all-off', phase: 'night' }, { id: 'night-hearth-on', phase: 'night', hearth: true }],
    comparisons: [['night-all-off', 'night-hearth-on', 'hearth only; lantern stays off'],
      ['night-all-off', 'day-all-off', 'day/night window and deep-room contrast with all controllable sources off']],
    withinFrame: [['day-all-off', 'deepLeftStone', 'belowRearWindow']],
  },
  {
    id: 'courtyard', pose: [-5.9, 0, 15.8, '1F', Math.PI * .58, -.05],
    rois: { rightPaving: [.69, .73, .19, .13], eastStone: [.67, .44, .15, .14] },
    states: [{ id: 'night-all-off', phase: 'night' }, { id: 'day-all-off', phase: 'day' }],
    comparisons: [['night-all-off', 'day-all-off', 'daylight reference; phase changes sky, direct key, environment and grading together']],
  },
];
const report = {
  url: url.href, channel, quality, mode: 'game-world states; no lights, shaders, geometry or camera overridden',
  sampling: 'Final screenshot sRGB bytes decoded to linear Rec.709 Y (display-relative, not scene illuminance). Phase pairs include sky, atmosphere, exposure and grade. Light intensities are live scene samples bracketing each PNG; fire/lantern can flicker.',
  stations, frames: [], comparisons: [], spatialComparisons: [], errors: [],
};
let browser, context, page;

function seedStation([x, y, z, floor, yaw, pitch]) {
  const { session, input } = window.__awDev;
  Object.assign(session.world.player, { x, y, z, floor, yaw, pitch });
  // The same ordinary camera rig follows this initial game pose throughout the station.
  input.yaw = yaw;
  input.pitch = pitch;
  session.world.doors.gatehouse = false;
  session.world.doors.chapelFront = false;
}
function seedSources({ phase, hearth, keepLantern }) {
  const w = window.__awDev.session.world;
  // This only prepares legal World states; applyLighting()/Props.update() still own the lighting.
  w.phase = phase;
  w.clock = phase === 'day' ? 120 : 30;
  w.player.cold = 0;
  w.ghosts.length = 0;
  w.inv.hasLantern = true;
  if (!keepLantern) w.lantern.on = false;
  w.lantern.oil = 240;
  w.hearth.lit = !!hearth;
  w.hearth.burn = hearth ? 240 : 0;
  w.lampBurn = 0;
  for (const id of Object.keys(w.braziers)) w.braziers[id] = 0;
}
function snapshot() {
  const { view, input } = window.__awDev;
  const { world: w, mode, screen, locked } = window.__awProbe.lite();
  const { scene, camera, props, player, renderer } = view;
  const named = new Map();
  for (const [prefix, record] of [['view', view], ['props', props], ['player', player]]) {
    for (const [key, object] of Object.entries(record ?? {})) if (object?.isLight) named.set(object, `${prefix}.${key}`);
  }
  for (const [i, sconce] of (props?.sconces ?? []).entries()) named.set(sconce.light, `props.sconces[${i}]`);
  const lights = [];
  scene.traverse((object) => {
    if (!object.isLight) return;
    let visible = true;
    for (let p = object; p; p = p.parent) visible &&= p.visible;
    const layers = camera.layers.test(object.layers);
    const pos = object.getWorldPosition(camera.position.clone()).toArray();
    const target = object.target?.getWorldPosition(camera.position.clone()).toArray();
    lights.push({ id: named.get(object) ?? (object.name || `${object.type}#${lights.length}`), type: object.type,
      intensity: object.intensity, effective: visible && layers && object.intensity > 0, visible, layers, pos, target,
      color: `#${object.color.getHexString()}`, distance: object.distance, decay: object.decay, castShadow: object.castShadow });
  });
  const indirect = {
    environment: { present: !!scene.environment, intensity: scene.environmentIntensity },
    toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure,
    fog: scene.fog ? { color: `#${scene.fog.color.getHexString()}`, near: scene.fog.near, far: scene.fog.far } : null,
    windowEmission: { dayPane: view.level?.windowMat?.emissiveIntensity, hearthPane: view.level?.hearthWindowMat?.emissiveIntensity },
    portalIrradiance: view.portalIrradiance?.toArray(), portalOpenAmount: view.portal?.toArray(),
  };
  return {
    mode, screen, realLock: locked && !input.fakeLock && document.pointerLockElement === renderer.domElement,
    fixed: !!view.fixedCam, floor: w.player.floor, feetGameXYZ: [w.player.x, w.player.y, w.player.z],
    camera: { pos: camera.position.toArray(), quat: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect },
    world: { phase: w.phase, clock: w.clock, played: w.played, lantern: w.lantern, hearth: w.hearth, lampBurn: w.lampBurn,
      braziers: w.braziers, doors: w.doors, ghosts: w.ghosts.length },
    lights, indirect, perf: window.__awProbe.state().perf,
  };
}
function assertFrame(frame, station, state, lantern) {
  if (frame.fixed || !frame.realLock || frame.mode !== 'playing' || frame.screen || frame.floor !== station.pose[3] ||
      frame.world.phase !== state.phase || frame.world.lantern.on !== lantern || frame.world.hearth.lit !== !!state.hearth ||
      frame.world.lampBurn !== 0 || Object.values(frame.world.braziers).some((v) => v !== 0)) {
    throw new Error(`${station.id}/${state.id}: unexpected live world or camera: ${JSON.stringify(frame)}`);
  }
}
const delta = (a, b) => ({
  translationM: Math.hypot(...a.pos.map((v, i) => v - b.pos[i])),
  rotationDeg: 2 * Math.acos(Math.min(1, Math.abs(a.quat.reduce((sum, v, i) => sum + v * b.quat[i], 0)))) * 180 / Math.PI,
  fovDeg: Math.abs(a.fov - b.fov),
});
const matched = (d) => d.translationM <= .018 && d.rotationDeg <= .4 && d.fovDeg <= .05;

// Decode the actual saved PNGs, never a pre-tone-map buffer or a new render.
async function pixels({ images, rois, pairs }) {
  const srgb = Array.from({ length: 256 }, (_, i) => {
    const c = i / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.floor((sorted.length - 1) * p)];
    return { n: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, p05: at(.05), p50: at(.5), p95: at(.95) };
  };
  const all = {}, frames = {};
  for (const { id, png } of images) {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    ctx.drawImage(image, 0, 0);
    image.close();
    frames[id] = {};
    all[id] = {};
    for (const [key, [nx, ny, nw, nh]] of Object.entries(rois)) {
      const x = Math.round(nx * canvas.width), y = Math.round(ny * canvas.height);
      const w = Math.round(nw * canvas.width), h = Math.round(nh * canvas.height);
      const { data } = ctx.getImageData(x, y, w, h);
      const Y = new Float32Array(w * h);
      for (let i = 0; i < Y.length; i++) Y[i] = .2126 * srgb[data[i * 4]] + .7152 * srgb[data[i * 4 + 1]] + .0722 * srgb[data[i * 4 + 2]];
      all[id][key] = Y;
      frames[id][key] = { xywhPx: [x, y, w, h], ...summarize(Y), nearBlackFraction: Y.filter((n) => n <= .003).length / Y.length };
    }
  }
  const comparisons = pairs.map(([a, b, meaning]) => ({ a, b, meaning, rois: Object.fromEntries(Object.keys(rois).map((key) => {
    const diff = all[b][key].map((n, i) => n - all[a][key][i]);
    return [key, { signedBMinusA: summarize(diff), absDelta: summarize(diff.map(Math.abs)),
      brighterFraction: diff.filter((n) => n > .002).length / diff.length }];
  })) }));
  return { frames, comparisons };
}

try {
  ({ browser, context, page, errors: report.browserErrors } = await launch({ channel, headless: args.includes('--headless'),
    width: Number(process.env.AW_W) || 1280, height: Number(process.env.AW_H) || 720 }));
  report.viewport = page.viewportSize();
  const target = await context.newCDPSession(page), cdp = await browser.newBrowserCDPSession();
  try {
    const { targetInfo } = await target.send('Target.getTargetInfo');
    await cdp.send('Browser.setPermission', { permission: { name: 'pointer-lock' }, setting: 'granted', origin: url.origin,
      browserContextId: targetInfo.browserContextId });
  } catch (e) { report.pointerLockPermission = e.message; }
  finally { await target.detach(); await cdp.detach(); }
  await page.addInitScript((quality) => localStorage.setItem('ashen-watch/settings', JSON.stringify({ mode: 'kbm', brightness: 1, sensitivity: 1, quality })), quality);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__awProbe?.state().perf.calls > 0 && !!window.__awDev?.session, 60000);
  await page.evaluate(() => window.__awTexReady);
  report.buildScripts = await page.evaluate(() => Array.from(document.scripts, (s) => s.src).filter(Boolean));
  report.gpu = await page.evaluate(() => window.__awProbe.gpu());
  if (!report.gpu || /unknown|swiftshader|llvmpipe|softpipe|lavapipe|software|swangle|basic render driver|warp\b/i.test(report.gpu)) {
    throw new Error(`The live game did not expose a hardware renderer: ${report.gpu}`);
  }
  await clickButton(page, '新游戏');
  await clickButton(page, '开始');
  await waitFor(page, () => window.__awProbe.lite().locked && document.pointerLockElement === document.getElementById('game'), 5000);
  await page.evaluate(() => {
    window.__awDev.hud(false);
    const debug = document.getElementById('debug');
    if (debug) debug.hidden = true;
  });
  for (const station of stations) {
    await page.evaluate(seedStation, station.pose);
    const frames = [];
    for (const state of station.states) {
      await page.evaluate(seedSources, { ...state, keepLantern: !!state.keyF });
      if (state.keyF) {
        await page.keyboard.press('KeyF');
        await waitFor(page, () => window.__awProbe.lite().world.lantern.on, 4000);
      }
      await sleep(frames.length ? 600 : 950);
      const prePNG = await page.evaluate(snapshot);
      assertFrame(prePNG, station, state, !!state.keyF);
      const image = await shot(page, `${name}-${station.id}-${state.id}.png`);
      const postPNG = await page.evaluate(snapshot);
      assertFrame(postPNG, station, state, !!state.keyF);
      const withinCapture = delta(prePNG.camera, postPNG.camera);
      const frame = { station: station.id, id: state.id, image, trigger: state.keyF ? 'KeyF' : 'controlled World state', prePNG, postPNG, withinCapture };
      frames.push(frame);
      report.frames.push(frame);
      if (!matched(withinCapture)) report.errors.push(`${station.id}/${state.id}: moved during screenshot ${JSON.stringify(withinCapture)}`);
    }
    const measured = await page.evaluate(pixels, { images: frames.map(({ id, image }) => ({ id, png: fs.readFileSync(image).toString('base64') })),
      rois: station.rois, pairs: station.comparisons });
    for (const frame of frames) frame.rois = measured.frames[frame.id];
    for (const result of measured.comparisons) {
      const a = frames.find((f) => f.id === result.a), b = frames.find((f) => f.id === result.b);
      const cameraDelta = delta(a.prePNG.camera, b.prePNG.camera);
      const cameraMatched = matched(cameraDelta);
      report.comparisons.push({ station: station.id, cameraDelta, cameraMatched, ...result });
      if (!cameraMatched) report.errors.push(`${station.id}/${result.a}/${result.b}: camera mismatch ${JSON.stringify(cameraDelta)}`);
      console.log(`${station.id} ${result.a} → ${result.b}:`, Object.fromEntries(Object.entries(result.rois).map(([n, m]) => [n, +m.signedBMinusA.mean.toFixed(6)])));
    }
    for (const [id, a, b] of station.withinFrame ?? []) {
      const rois = measured.frames[id];
      report.spatialComparisons.push({ station: station.id, id, a, b, meanBMinusA: rois[b].mean - rois[a].mean });
    }
  }
  // Baselines may contain the bugs under study. Release mode checks actual
  // receiver pixels as well as source state, with tolerances above 8-bit dither.
  if (args.includes('--accept')) {
    const mean = (station, state, roi) => report.frames.find(f => f.station === station && f.id === state).rois[roi].mean;
    const off = mean('b1-store', 'lantern-off', 'eastStone');
    const daylight = mean('gatehouse', 'day-all-off', 'belowRearWindow');
    const night = mean('gatehouse', 'night-all-off', 'belowRearWindow');
    report.receiverChecks = {
      sealedCellarDark: off < .0005,
      lanternReachesCellarStone: mean('b1-store', 'lantern-on', 'eastStone') > off + .001,
      windowDaylightSurvives: daylight > night + .0006,
      windowBrighterThanDeepStone: daylight > mean('gatehouse', 'day-all-off', 'deepLeftStone') + .0004,
      hearthLightsItsSurround: mean('gatehouse', 'night-hearth-on', 'hearthSideMasonry') >
        mean('gatehouse', 'night-all-off', 'hearthSideMasonry') + .01,
      courtyardRetainsDaylight: mean('courtyard', 'day-all-off', 'rightPaving') > .03,
    };
    for (const [check, ok] of Object.entries(report.receiverChecks)) if (!ok) report.errors.push(`Receiver regression: ${check}`);
  }
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  if (page) await shot(page, `${name}-error.png`).catch(() => {});
} finally {
  if (browser) await browser.close().catch((e) => report.errors.push(e.message));
  report.ok = !report.errors.length && !report.browserErrors?.length;
  const output = path.join(OUT, `${name}.json`);
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${output}`);
  if (!report.ok) {
    console.error(...report.errors, ...(report.browserErrors ?? []));
    process.exitCode = 1;
  }
}
