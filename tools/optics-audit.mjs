// AW_URL=http://127.0.0.1:4199/ AW_OUT=.cache/rodin-production/optics-after AW_ANGLE=metal node tools/optics-audit.mjs chrome --headless
// AW_OPTICS=glass|wet selects one effect. AW_W/AW_H default to 1280x720.
import fs from 'node:fs';
import path from 'node:path';

// Set before loading lib.mjs, whose default output directory is tracked documentation.
process.env.AW_OUT ||= '.cache/rodin-production/optics-audit';

const stations = [
  {
    id: 'gatehouse-overcast', effect: 'glass',
    pose: [.38, 0, -4.3, '1F', -.26, .37],
    // The live day key [-.58,.68,-.42] threads the courtyard-facing window.
    // Galileo's CPU scene raycast found hits at x[-.453,-.057], game z[-1.125,-.917].
    // Keep a narrow margin for refraction; this patch is right of the player in the follow camera.
    rois: { windowFloor: [-.53, .005, -1.22, .01, -.85], deepFloor: [.85, .005, -4.12, 1.72, -3.08] },
    target: 'windowFloor',
  },
  {
    id: 'east-pool', effect: 'wet',
    // The pool reflects the S1 shaft's stone guard.
    pose: [5.12, 0, 15.284, '1F', 3.05, .20],
    rois: { pool: [5.60, .01, 11.60, 6.40, 12.40], dryStone: [6.98, .01, 11.65, 7.42, 12.35] },
    target: 'pool',
  },
  {
    id: 'north-pool', effect: 'wet',
    // The pool reflects the ruined court wall.
    pose: [1.041, 0, 20.959, '1F', 5.328, .20],
    rois: { pool: [-2.46, .01, 23.54, -1.54, 24.46], dryStone: [-2.37, .01, 22.39, -1.72, 22.83] },
    target: 'pool',
  },
];

// A single snapshot of each receiver plane projected into the real camera. Top-left screen origin.
function projectROIs(camera, rois) {
  return Object.fromEntries(Object.entries(rois).map(([id, [x0, y, z0, x1, z1]]) => {
    const polygon = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => {
      const p = camera.position.clone().set(x, y, -z).project(camera);
      if (![p.x, p.y, p.z].every(Number.isFinite) || p.z <= -1 || p.z >= 1) {
        throw new Error(`${id}: receiver plane crosses the camera clip plane`);
      }
      return [(p.x + 1) / 2, (1 - p.y) / 2];
    });
    if (polygon.some(([x, y]) => Math.min(x, y) <= 0 || Math.max(x, y) >= 1)) {
      throw new Error(`${id}: projected receiver is clipped: ${JSON.stringify(polygon)}`);
    }
    return [id, polygon];
  }));
}

function polygonPixels(polygon, width, height) {
  const xs = polygon.map(([x]) => x * width), ys = polygon.map(([, y]) => y * height);
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  const indices = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let inside = false;
      for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
        if ((ys[i] > y + .5) !== (ys[j] > y + .5) &&
            x + .5 < xs[i] + (xs[j] - xs[i]) * (y + .5 - ys[i]) / (ys[j] - ys[i])) inside = !inside;
      }
      if (inside) indices.push(y * width + x);
    }
  }
  return { rect: [x0, y0, x1 - x0, y1 - y0], indices };
}

// Screenshots are the stock final backbuffer, including grade and grain. Decode the same PNGs we save.
async function measurePNGs({ frames, polygons, gain, polygonSource }) {
  const polygonPixels = (0, eval)(`(${polygonSource})`);
  const srgb = Array.from({ length: 256 }, (_, i) => {
    const x = i / 255;
    return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
  });
  const luma = (d, i) => .2126 * srgb[d[i]] + .7152 * srgb[d[i + 1]] + .0722 * srgb[d[i + 2]];
  const decoded = {};
  let width, height;
  for (const { id, png } of frames) {
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    if (width !== undefined && (width !== bmp.width || height !== bmp.height)) throw new Error('PNG dimensions changed');
    ({ width, height } = bmp);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    decoded[id] = ctx.getImageData(0, 0, width, height).data;
  }
  const { off, on, repeat } = decoded;
  const diffCanvas = new OffscreenCanvas(width, height);
  const ctx = diffCanvas.getContext('2d', { colorSpace: 'srgb' });
  const diffImage = ctx.createImageData(width, height);
  for (let i = 3; i < diffImage.data.length; i += 4) diffImage.data[i] = 255;
  const stats = {};
  for (const [id, polygon] of Object.entries(polygons)) {
    const { rect, indices } = polygonPixels(polygon, width, height);
    if (indices.length < 64) throw new Error(`${id}: too few projected pixels (${indices.length})`);
    const m = { rect, pixels: indices.length, changed: 0, changedWithStableOff: 0, offRepeatChanged: 0,
      maxChannelDelta: 0, maxPositiveChannelDelta: 0, meanOffY: 0, meanOnY: 0,
      meanSignedY: 0, meanAbsY: 0, meanPositiveY: 0, offRepeatMeanAbsY: 0 };
    for (const p of indices) {
      const i = p * 4;
      const a = luma(off, i), b = luma(on, i), r = luma(repeat, i);
      const delta = b - a;
      let changed = false, noise = false;
      for (let c = 0; c < 3; c++) {
        const x = on[i + c] - off[i + c];
        changed ||= x !== 0;
        noise ||= repeat[i + c] !== off[i + c];
        m.maxChannelDelta = Math.max(m.maxChannelDelta, Math.abs(x));
        m.maxPositiveChannelDelta = Math.max(m.maxPositiveChannelDelta, x);
        diffImage.data[i + c] = Math.abs(x) * gain;
      }
      m.changed += Number(changed);
      m.changedWithStableOff += Number(changed && !noise);
      m.offRepeatChanged += Number(noise);
      m.meanOffY += a;
      m.meanOnY += b;
      m.meanSignedY += delta;
      m.meanAbsY += Math.abs(delta);
      m.meanPositiveY += Math.max(0, delta);
      m.offRepeatMeanAbsY += Math.abs(r - a);
    }
    for (const key of Object.keys(m)) {
      if (key.startsWith('mean') || key === 'offRepeatMeanAbsY') m[key] /= m.pixels;
    }
    stats[id] = m;
  }
  ctx.putImageData(diffImage, 0, 0);
  const bytes = new Uint8Array(await (await diffCanvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return { stats, diff: btoa(binary) };
}

// Keep one real game update (including the settled follow camera and the original game clock).
// Within one JS turn, replay the stock renderer before the scene, lighting, weather and grain advance.
// Synchronous canvas capture avoids crossing a browser presentation/frame boundary.
function renderBatch({ station, dark, helpers }) {
  const [projectROIs, polygonPixels] = helpers.map(source => (0, eval)(`(${source})`));
  const { view, input, session } = window.__awDev;
  const { camera, renderer, scene, sun, post } = view;
  const { mode, locked, screen } = window.__awProbe.lite();
  if (view.fixedCam || !locked || input.fakeLock || document.pointerLockElement !== renderer.domElement ||
      mode !== 'playing' || screen) throw new Error('Expected real pointer lock and the ordinary follow rig');
  const glass = view.glassCaustics ?? window.__awDev.glassCaustics;
  const wet = post?.ssr;
  const useGlass = station.effect === 'glass';
  if (useGlass && (typeof glass?.enabled !== 'boolean' || !(glass.beamFraction > 0))) {
    throw new Error('Glass caustics requires a wired installGlassCaustics() handle at __awDev.view.glassCaustics with a positive live beamFraction');
  }
  const radiance = wet?.ssrMaterial?.uniforms?.uAwSceneColor;
  if (!useGlass && (!radiance || radiance.value !== wet.beautyRenderTarget.texture || wet.output !== 0 || wet.bouncing)) {
    throw new Error('Expected the cinematic wet trace with live beauty input (uAwSceneColor), default output and no temporal bouncing');
  }
  if (!useGlass && (!(wet.opacity > 0) || !wet.enabled || !wet.ssrRenderTarget)) {
    throw new Error('Expected active wet trace with positive opacity and a raw hit target');
  }
  const original = { glass: glass?.enabled, key: sun.intensity, opacity: wet?.opacity, radiance: radiance?.value };
  if (!(original.key > 0)) throw new Error('Expected a positive live key before applying the source control');
  const polygons = projectROIs(camera, station.rois);
  const snapshot = () => {
    const lights = [];
    scene.traverse(object => {
      if (!object.isLight) return;
      let visible = camera.layers.test(object.layers);
      for (let current = object; current; current = current.parent) visible &&= current.visible;
      lights.push({ name: object.name || `${object.type}#${lights.length}`, type: object.type,
        intensity: object.intensity, visible, color: object.color.getHexString(),
        position: object.getWorldPosition(camera.position.clone()).toArray(),
        target: object.target?.getWorldPosition(camera.position.clone()).toArray() });
    });
    const w = session.world;
    const towardKey = sun.getWorldPosition(camera.position.clone())
      .sub(sun.target.getWorldPosition(camera.position.clone())).normalize();
    return {
      pose: [w.player.x, w.player.y, w.player.z, w.player.floor, input.yaw, input.pitch],
      phase: w.phase, clock: w.clock, renderTime: view.time,
      camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
        fov: camera.fov, projection: camera.projectionMatrix.toArray() },
      lights, environmentIntensity: scene.environmentIntensity, exposure: renderer.toneMappingExposure,
      key: { intensity: sun.intensity, shadowEnabled: sun.castShadow && renderer.shadowMap.enabled,
        shadowDepth: !!sun.shadow.map?.depthTexture, cover: view.rig?.cover, towardKey: towardKey.toArray() },
      glass: glass && { enabled: glass.enabled, beamFraction: glass.beamFraction },
      wet: wet && { enabled: wet.enabled, opacity: wet.opacity, liveRadiance: radiance?.value === wet.beautyRenderTarget.texture },
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    };
  };
  const readTrace = () => {
    const rt = wet.ssrRenderTarget;
    const { width, height } = rt;
    const gl = renderer.getContext();
    const byteTarget = rt.texture.type === 1009; // Three UnsignedByteType
    const scale = byteTarget ? 1 / 255 : 1;
    const out = {};
    const prev = renderer.getRenderTarget();
    try {
      // The raw trace stores linear radiance in RGB and hit weight in alpha.
      // Read float attachments as FLOAT to preserve values below one RGBA8 code.
      renderer.setRenderTarget(rt);
      for (const [name, polygon] of Object.entries(polygons)) {
        const { rect: [x, y, w, h], indices } = polygonPixels(polygon, width, height);
        const values = byteTarget ? new Uint8Array(w * h * 4) : new Float32Array(w * h * 4);
        gl.readPixels(x, height - y - h, w, h, gl.RGBA, byteTarget ? gl.UNSIGNED_BYTE : gl.FLOAT, values);
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw new Error(`Raw SSR readback failed (texture type ${rt.texture.type}, GL 0x${error.toString(16)})`);
        let hits = 0, litHits = 0, rgbPixels = 0, maxAlpha = 0, maxRGB = 0;
        for (const p of indices) {
          const col = p % width - x;
          const row = h - 1 - (Math.floor(p / width) - y);
          const i = (row * w + col) * 4;
          const rgb = Math.max(Math.abs(values[i]), Math.abs(values[i + 1]), Math.abs(values[i + 2]));
          const alpha = values[i + 3];
          if (!Number.isFinite(rgb) || !Number.isFinite(alpha)) throw new Error('Nonfinite value in raw SSR hit target');
          hits += Number(alpha > 0);
          litHits += Number(alpha > 0 && rgb > 0);
          rgbPixels += Number(rgb > 0);
          maxAlpha = Math.max(maxAlpha, alpha);
          maxRGB = Math.max(maxRGB, rgb);
        }
        out[name] = { width, height, format: byteTarget ? 'RGBA8' : 'float RGBA', pixels: indices.length,
          hits, litHits, rgbPixels, maxAlpha: maxAlpha * scale, maxRGB: maxRGB * scale };
      }
    } finally {
      renderer.setRenderTarget(prev);
    }
    return out;
  };

  let blackTarget;
  let traceDraws = 0;
  const renderPass = wet?._renderPass;
  try {
    if (dark && useGlass) sun.intensity = 0;
    if (!useGlass) {
      // Count submissions to the raw trace target, and require actual nonzero alpha on hits below.
      wet._renderPass = function (renderer, material, target, ...args) {
        if (material === wet.ssrMaterial && target === wet.ssrRenderTarget) traceDraws++;
        return renderPass.call(this, renderer, material, target, ...args);
      };
      if (dark) {
        // Keep the actual beauty/G-buffer and only set the trace's incident radiance to zero.
        // Same dimensions because the production shader addresses the source with texelFetch.
        blackTarget = wet.beautyRenderTarget.clone();
        blackTarget.samples = 0;
        blackTarget.depthBuffer = false;
        blackTarget.depthTexture = null;
        const prev = renderer.getRenderTarget();
        const clear = renderer.getClearColor(scene.background.clone());
        const alpha = renderer.getClearAlpha();
        try {
          renderer.setRenderTarget(blackTarget);
          renderer.setClearColor(0, 0);
          renderer.clear(true, false, false);
        } finally {
          renderer.setClearColor(clear, alpha);
          renderer.setRenderTarget(prev);
        }
        radiance.value = blackTarget.texture;
      }
    }
    const frames = [];
    for (const [id, enabled] of [['off', false], ['on', true], ['repeat', false]]) {
      if (useGlass) glass.enabled = enabled;
      else wet.opacity = enabled ? original.opacity : 0;
      traceDraws = 0;
      const gpuStart = performance.now();
      view.render();
      const png = renderer.domElement.toDataURL('image/png').split(',')[1];
      const renderAndReadbackMs = performance.now() - gpuStart;
      if (!png) throw new Error('Could not encode the live WebGL framebuffer');
      frames.push({ id, png, state: snapshot(), rawTrace: useGlass ? undefined : readTrace(),
        traceDraws: useGlass ? undefined : traceDraws, renderAndReadbackMs });
    }
    return { frames, polygons };
  } finally {
    if (glass) glass.enabled = original.glass;
    sun.intensity = original.key;
    if (wet) {
      wet.opacity = original.opacity;
      wet._renderPass = renderPass;
    }
    if (radiance) radiance.value = original.radiance;
    blackTarget?.dispose();
  }
}

const haveSignal = m => m.changedWithStableOff >= 8 && m.meanAbsY > 3 * m.offRepeatMeanAbsY;
const positiveOutsideNoise = m => m.maxPositiveChannelDelta > 0 && m.meanPositiveY > 3 * m.offRepeatMeanAbsY;

function checkBatch(station, kind, batch, stats) {
  const [off, on, repeat] = batch.frames;
  const expect = (condition, message) => { if (!condition) throw new Error(`${station.id}/${kind}: ${message}`); };
  const frameInvariants = s => ({ camera: s.camera, lights: s.lights, time: s.renderTime,
    pose: s.pose, phase: s.phase, clock: s.clock, environmentIntensity: s.environmentIntensity, exposure: s.exposure });
  const invariant = JSON.stringify(frameInvariants(off.state));
  expect([on, repeat].every(f => JSON.stringify(frameInvariants(f.state)) === invariant), 'follow camera or original light sources differ between captures');
  const [x, y, z, floor] = off.state.pose;
  const [wantedX, wantedY, wantedZ, wantedFloor] = station.pose;
  expect(floor === wantedFloor && Math.hypot(x - wantedX, y - wantedY, z - wantedZ) < .10, 'player drifted away from the authored station');
  const isGlass = station.effect === 'glass';
  for (const [i, { state }] of batch.frames.entries()) {
    expect(state.phase === 'day', 'expected the ordinary overcast day rig');
    if (isGlass) {
      expect(state.key.shadowEnabled && state.key.shadowDepth, 'expected the real key shadow/depth');
      expect(state.glass.enabled === (i === 1), 'caustic toggle did not hold');
      expect(kind === 'dark' ? state.key.intensity === 0 : state.key.intensity > 0, 'unexpected directional key intensity');
    } else {
      expect(state.wet.liveRadiance === (kind === 'live'), 'wrong scene radiance input');
      expect(i === 1 ? state.wet.opacity > 0 : state.wet.opacity === 0, 'reflection toggle did not hold');
    }
  }
  const target = stats[station.target];
  if (isGlass) {
    if (kind === 'dark') {
      expect(Object.values(stats).every(m => m.changedWithStableOff === 0 && m.meanAbsY <= m.offRepeatMeanAbsY), 'caustic changed receiver pixels with its real directional source at zero');
    }
    return { detected: kind === 'live' && haveSignal(target) };
  }
  expect(batch.frames.every(f => f.traceDraws > 0), 'expected a draw into the real trace render target');
  expect([off, repeat].every(f => Object.values(f.rawTrace).every(r => r.hits === 0 && r.rgbPixels === 0)), 'trace still populated the receiver during the off capture');
  expect(on.rawTrace.dryStone.hits === 0 && on.rawTrace.dryStone.rgbPixels === 0, 'raw trace leaked onto the dry-stone control');
  const hit = on.rawTrace[station.target];
  if (kind === 'dark') {
    expect(Object.values(on.rawTrace).every(r => r.rgbPixels === 0), 'zero incident radiance produced nonzero raw reflection RGB');
    expect(Object.values(stats).every(m => !positiveOutsideNoise(m)), 'zero incident radiance brightened final receiver pixels');
  }
  return { hits: hit.hits, litHits: hit.litHits, detected: kind === 'live' && hit.litHits > 0 && haveSignal(target) };
}

function seedStation([x, y, z, floor, yaw, pitch]) {
  const { session, input } = window.__awDev;
  const w = session.world;
  Object.assign(w.player, { x, y, z, floor, yaw, pitch });
  input.yaw = yaw;
  input.pitch = pitch;
  w.phase = 'day';
  w.clock = 120;
}

async function main() {
  const { BASE, OUT, clickButton, launch, sleep, waitFor } = await import('./lib.mjs');
  const args = process.argv.slice(2);
  const channel = args.find(s => !s.startsWith('--')) ?? 'chrome';
  const selection = process.env.AW_OPTICS ?? 'all';
  if (!['all', 'glass', 'wet'].includes(selection)) throw new Error('AW_OPTICS must be all, glass or wet');
  const route = stations.filter(s => selection === 'all' || selection === s.effect);
  const url = new URL(BASE);
  for (const [key, value] of Object.entries({ preset: 'dev', probe: '1', timescale: '1', dayscale: '1' })) {
    url.searchParams.set(key, value);
  }
  const width = Number(process.env.AW_W ?? 1280), height = Number(process.env.AW_H ?? 720);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240) {
    throw new Error('AW_W/AW_H must be integer viewport dimensions of at least 320x240');
  }
  const gain = 32;
  const report = {
    url: url.href, channel, viewport: [width, height], quality: 'cinematic', selection, stations: route,
    method: 'Real game follow camera and stock WebGL passes. Off/on/off replay within one game update freezes the camera, lights, time, weather and grain. ROIs are projected game-space receiver rectangles. Primary comparisons retain the normal game sources.',
    delta: 'Final PNG sRGB code changes and linear Rec.709 display-relative Y. Detection requires >=8 pixels changed over a stable off pair and mean absolute Y delta >3x off-repeat noise. Diff images show absolute RGB code differences x32 within the receiver polygons.',
    controls: {
      glass: 'Set the live directional key intensity to zero for the entire control batch. Leave other sources and exposure as-is.',
      wet: 'Supply a cleared, black texture to the incident radiance sampler for the entire control batch. Leave beauty and G-buffers live. Require geometrical hits, no raw reflection RGB and no final receiver brightening.',
    },
    batches: [], errors: [],
  };
  let browser;
  try {
    const launched = await launch({ channel, headless: args.includes('--headless'), width, height });
    const { context, page } = launched;
    browser = launched.browser;
    report.browserErrors = launched.errors;
    const cdp = await browser.newBrowserCDPSession();
    const target = await context.newCDPSession(page);
    try {
      const { targetInfo } = await target.send('Target.getTargetInfo');
      await cdp.send('Browser.setPermission', { permission: { name: 'pointer-lock' }, setting: 'granted',
        origin: url.origin, browserContextId: targetInfo.browserContextId });
    } catch (error) {
      report.pointerLockPermission = error.message;
    } finally {
      await target.detach();
      await cdp.detach();
    }
    await page.addInitScript(() => localStorage.setItem('ashen-watch/settings', JSON.stringify({
      mode: 'kbm', brightness: 1, sensitivity: 1, quality: 'cinematic',
    })));
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => window.__awProbe?.lite && window.__awDev?.view?.renderer, 60000);
    await page.evaluate(() => window.__awTexReady);
    report.buildScripts = await page.evaluate(() => Array.from(document.scripts, s => s.src).filter(Boolean));
    report.gpu = await page.evaluate(() => window.__awProbe.gpu());
    if (!report.gpu || /unknown|swiftshader|llvmpipe|softpipe|lavapipe|software|swangle|basic render driver|warp\b/i.test(report.gpu)) {
      throw new Error(`The game did not expose a hardware renderer (${report.gpu || 'unknown'})`);
    }
    await clickButton(page, '新游戏');
    await clickButton(page, '开始');
    await waitFor(page, () => window.__awProbe.lite().locked && document.pointerLockElement === document.getElementById('game'), 5000);
    await page.evaluate(() => {
      window.__awDev.hud(false);
      const debug = document.getElementById('debug');
      if (debug) debug.hidden = true;
    });
    for (const station of route) {
      await page.evaluate(seedStation, station.pose);
      await sleep(1000);
      for (const kind of ['live', 'dark']) {
        const result = { station: station.id, effect: station.effect, kind };
        report.batches.push(result);
        try {
          const batch = await page.evaluate(renderBatch, { station, dark: kind === 'dark',
            helpers: [projectROIs.toString(), polygonPixels.toString()] });
          const prefix = `optics-${station.id}-${kind}`;
          result.polygons = batch.polygons;
          result.frames = batch.frames.map(({ png, ...frame }) => {
            const image = path.join(OUT, `${prefix}-${frame.id}.png`);
            fs.writeFileSync(image, Buffer.from(png, 'base64'));
            return { ...frame, image };
          });
          const { stats, diff } = await page.evaluate(measurePNGs, {
            frames: batch.frames.map(({ id, png }) => ({ id, png })), polygons: batch.polygons, gain, polygonSource: polygonPixels.toString(),
          });
          result.rois = stats;
          result.diff = path.join(OUT, `${prefix}-diff.png`);
          fs.writeFileSync(result.diff, Buffer.from(diff, 'base64'));
          result.verdict = checkBatch(station, kind, batch, stats);
          console.log(`${station.id}/${kind}`, JSON.stringify({ ...result.verdict, target: stats[station.target] }));
        } catch (error) {
          result.error = error.message;
          report.errors.push(`${station.id}/${kind}: ${error.message}`);
        }
      }
    }
    // Two pools are sampled so missing SSR coverage at one view stays visible in the report.
    // Require a pool with real lit hits in the primary A/B and real black hits in its paired control.
    if (selection !== 'wet' && !report.batches.some(b => b.effect === 'glass' && b.verdict?.detected)) {
      report.errors.push('Glass: no overcast receiver signal above off-repeat noise');
    }
    if (selection !== 'glass' && !route.some(s => s.effect === 'wet' &&
      report.batches.some(b => b.station === s.id && b.kind === 'live' && b.verdict?.detected) &&
      report.batches.some(b => b.station === s.id && b.kind === 'dark' && b.verdict?.hits > 0))) {
      report.errors.push('Wet: no pool with a visible primary A/B, lit GPU hits and corresponding zero-radiance hits');
    }
  } catch (error) {
    report.errors.push(error.stack ?? String(error));
  } finally {
    if (browser) await browser.close().catch(error => report.errors.push(error.message));
    report.ok = !report.errors.length && !report.browserErrors?.length;
    const output = path.join(OUT, 'optics-audit.json');
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${output}`);
    if (!report.ok) {
      console.error(...report.errors, ...(report.browserErrors ?? []));
      process.exitCode = 1;
    }
  }
}

await main();
