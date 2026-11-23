// Frozen pixel A/B for the ruined court. Run against the current dev or preview server.
// AW_URL=http://localhost:5173/ node tools/render-compare.mjs chrome
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This function is serialized by Playwright. All browser-side dependencies are local to it.
export function compareInPage({ phase, cameraSpec }) {
  const { view, session, fixedCam } = window.__awDev;
  const { renderer, scene, camera } = view;
  const gl = renderer.getContext();
  const world = session.world;
  const playerPosition = { x: -14.35, z: 16.15, y: 0, floor: '1F' };
  const support = window.__awProbe.support(playerPosition.x, playerPosition.z, playerPosition.y);
  if (support?.y !== playerPosition.y || support.floor !== playerPosition.floor) {
    throw new Error('Expected the new west-court floor at the frozen player position.');
  }
  const time = 12;
  const clock = phase === 'day' ? 300 : 0;
  Object.assign(world, { phase, clock });
  Object.assign(world.player, playerPosition, { yaw: 0, pitch: 0, moving: false, sprinting: false });
  world.ghosts.length = 0;
  world.inv.hasLantern = true;
  Object.assign(world.lantern, { on: false, raised: false });
  world.repairs.lamp = true;
  world.lampBurn = 250;
  Object.assign(world.braziers, { chapel: 150, side: 150 });
  Object.assign(world.hearth, { lit: true, burn: 300 });
  view.setQuality('cinematic');
  fixedCam(cameraSpec.pos, cameraSpec.look);
  const pose = { x: world.player.x, z: world.player.z, y: world.player.y, ghosts: [] };
  // Settle render-side blends once. The simulation loop has already been stopped.
  for (let i = 0; i < 30; i++) view.update(world, pose, 0, 0, 1 / 60, time);

  const shadow = renderer.shadowMap;
  const ssr = view.post?.ssr;
  if (!shadow.enabled || !shadow.autoUpdate || renderer.info.autoReset || !ssr?.selective || ssr.bouncing) {
    throw new Error('Expected cinematic SSR with its mask, automatic beauty shadow updates and full-frame stats.');
  }
  const passNames = new Map([
    [ssr.beautyRenderTarget, 'beauty'],
    [ssr.normalRenderTarget, 'normal'],
    [ssr.metalnessRenderTarget, 'reflectionMask'],
  ]);
  const scenery = scene.getObjectByName('scenery');
  const cullHooks = new Map();
  scenery?.traverse((object) => {
    if (object.isMesh && Object.hasOwn(object, 'intersectsFrustum')) cullHooks.set(object, object.intersectsFrustum);
  });
  if (!cullHooks.size) throw new Error('Current build did not expose optimized scenery objects.');
  function sphereCull(frustum) { return frustum.intersectsObject(this); }

  let reuseShadow = true;
  let currentPass;
  let framePasses = [];
  const sceneRender = renderer.render;
  const shadowRender = shadow.render;
  const directDraw = renderer.renderBufferDirect;
  const count = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
  const delta = (before) => ({ calls: renderer.info.render.calls - before.calls, triangles: renderer.info.render.triangles - before.triangles });
  renderer.render = function (targetScene, ...args) {
    if (targetScene !== scene) return sceneRender.call(this, targetScene, ...args);
    const pass = passNames.get(this.getRenderTarget());
    if (!pass || currentPass) throw new Error('Unexpected application scene pass.');
    const before = count();
    currentPass = { pass, shadow: { calls: 0, triangles: 0 }, scenery: { calls: 0, triangles: 0 } };
    try {
      return sceneRender.call(this, targetScene, ...args);
    } finally {
      framePasses.push({ ...currentPass, total: delta(before) });
      currentPass = undefined;
    }
  };
  shadow.render = function (lights, targetScene, ...args) {
    const pass = currentPass;
    if (!pass || targetScene !== scene) return shadowRender.call(this, lights, targetScene, ...args);
    const before = count();
    const autoUpdate = this.autoUpdate;
    // Restore the former behavior at the WebGLShadowMap entry point. In particular,
    // SSR still supplies the actual phase-specific visibility and override materials.
    if (!reuseShadow) this.autoUpdate = true;
    try {
      return shadowRender.call(this, lights, targetScene, ...args);
    } finally {
      this.autoUpdate = autoUpdate;
      pass.shadow = delta(before);
    }
  };
  renderer.renderBufferDirect = function (drawCamera, drawScene, geometry, material, object, group) {
    const pass = currentPass;
    if (!pass || drawScene !== scene || !cullHooks.has(object)) {
      return directDraw.call(this, drawCamera, drawScene, geometry, material, object, group);
    }
    const before = count();
    const result = directDraw.call(this, drawCamera, drawScene, geometry, material, object, group);
    const draws = delta(before);
    pass.scenery.calls += draws.calls;
    pass.scenery.triangles += draws.triangles;
    return result;
  };

  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const stride = 4 * width;
  function draw() {
    framePasses = [];
    view.render();
    if (renderer.getRenderTarget() !== null || width !== gl.drawingBufferWidth || height !== gl.drawingBufferHeight) {
      throw new Error('Expected the final frame on the original default framebuffer.');
    }
    const pixels = new Uint8Array(stride * height);
    // Synchronous read in the same browser task as render, before the drawing buffer can be discarded.
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    if (error !== gl.NO_ERROR || gl.isContextLost()) throw new Error(`WebGL error ${error} reading final frame.`);
    return { pixels, total: count(), passes: framePasses };
  }

  const pngCanvas = document.createElement('canvas');
  pngCanvas.width = width;
  pngCanvas.height = height;
  const context = pngCanvas.getContext('2d');
  function encodePng(pixels) {
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const from = (height - y - 1) * stride;
      image.data.set(pixels.subarray(from, from + stride), y * stride);
    }
    context.putImageData(image, 0, 0);
    return pngCanvas.toDataURL('image/png').split(',')[1];
  }

  function compare(reference, sample) {
    let changedPixels = 0, maxChannelDelta = 0, totalAbsDelta = 0;
    let left = width, right = -1, top = height, bottom = -1;
    let heatmap;
    for (let i = 0; i < reference.length; i += 4) {
      const dr = Math.abs(reference[i] - sample[i]);
      const dg = Math.abs(reference[i + 1] - sample[i + 1]);
      const db = Math.abs(reference[i + 2] - sample[i + 2]);
      const da = Math.abs(reference[i + 3] - sample[i + 3]);
      const peak = Math.max(dr, dg, db, da);
      if (!peak) continue;
      const x = (i / 4) % width, y = height - 1 - Math.floor(i / stride);
      changedPixels++;
      maxChannelDelta = Math.max(maxChannelDelta, peak);
      totalAbsDelta += dr + dg + db + da;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      heatmap ??= new Uint8Array(reference.length);
      heatmap[i] = 255;
      heatmap[i + 1] = Math.min(255, peak * 8);
    }
    if (heatmap) for (let i = 3; i < heatmap.length; i += 4) heatmap[i] = 255;
    return {
      changedPixels,
      maxChannelDelta,
      meanAbsChannelDelta: totalAbsDelta / reference.length,
      bounds: changedPixels ? { left, top, right, bottom } : null,
      diffPng: heatmap ? encodePng(heatmap) : null,
    };
  }

  const modes = [
    { name: 'both-on', shadowReuse: true, sceneryCull: true },
    { name: 'shadow-off', shadowReuse: false, sceneryCull: true },
    { name: 'scenery-off', shadowReuse: true, sceneryCull: false },
    { name: 'both-off', shadowReuse: false, sceneryCull: false },
    { name: 'both-on-repeat', shadowReuse: true, sceneryCull: true },
  ];
  try {
    draw(); // Warm shader/texture paths and clear the composer's initial buffers before sampling.
    const fingerprint = () => JSON.stringify([world, camera.matrixWorld.elements, camera.projectionMatrix.elements]);
    const frozen = fingerprint();
    let reference;
    const frames = modes.map((mode) => {
      reuseShadow = mode.shadowReuse;
      for (const [object, hook] of cullHooks) object.intersectsFrustum = mode.sceneryCull ? hook : sphereCull;
      const { pixels, total, passes } = draw();
      if (fingerprint() !== frozen || view.time !== time) throw new Error(`Simulation, camera or scene time changed during ${mode.name}.`);
      const difference = reference ? compare(reference, pixels) : null;
      if (!reference) {
        const hasColorVariation = pixels.some((v, i) => i % 4 !== 3 && v !== pixels[i % 4]);
        if (!hasColorVariation) throw new Error('The reference framebuffer is a flat color.');
        reference = pixels;
      }
      return { ...mode, total, passes, png: encodePng(pixels), difference };
    });
    return {
      quality: view.quality, phase, clock, time, camera: cameraSpec, player: pose,
      drawingBuffer: { width, height }, devicePixelRatio: devicePixelRatio,
      gpu: window.__awProbe.gpu(), userAgent: navigator.userAgent,
      sceneryObjects: cullHooks.size, frames,
    };
  } finally {
    renderer.render = sceneRender;
    shadow.render = shadowRender;
    renderer.renderBufferDirect = directDraw;
    for (const [object, hook] of cullHooks) object.intersectsFrustum = hook;
  }
}

export function validateFrames(report) {
  const issues = [];
  const [base, , sceneryOff] = report.frames;
  const baseShadowCalls = base.passes[0]?.shadow.calls;
  for (const frame of report.frames) {
    if (frame.passes.map(p => p.pass).join(',') !== 'beauty,normal,reflectionMask') {
      issues.push(`${frame.name}: expected beauty, normal and reflection-mask scene passes.`);
    }
    const shadowPasses = frame.passes.filter(p => p.shadow.calls > 0).map(p => p.pass).join(',');
    const expected = frame.shadowReuse ? 'beauty' : 'beauty,normal,reflectionMask';
    if (shadowPasses !== expected) issues.push(`${frame.name}: shadow submissions [${shadowPasses}], expected [${expected}].`);
    if (!baseShadowCalls || frame.passes[0]?.shadow.calls !== baseShadowCalls) issues.push(`${frame.name}: beauty shadow draw count changed.`);
    if (frame.difference?.changedPixels) issues.push(`${frame.name}: ${frame.difference.changedPixels} RGBA pixels differ from both-on.`);
  }
  if (!(sceneryOff.passes[0]?.scenery.calls > base.passes[0]?.scenery.calls)) {
    issues.push('The frozen beauty view did not exercise the scenery cull toggle.');
  }
  return issues;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: AW_URL=http://localhost:5173/ node tools/render-compare.mjs [chrome|msedge|chromium] [--headless]');
    console.log('AW_AB_PHASE=day|night (default day), AW_OUT=output directory, AW_W/AW_H=viewport (default 1920×1080).');
    return;
  }
  const channel = args.find(arg => !arg.startsWith('-')) ?? 'chrome';
  const phase = process.env.AW_AB_PHASE ?? 'day';
  if (!['day', 'night'].includes(phase)) throw new Error('AW_AB_PHASE must be day or night.');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const stamp = new Date().toISOString().replaceAll(':', '-');
  process.env.AW_OUT ??= path.join(here, '..', '.cache', 'ruined-court', `render-ab-${phase}-${stamp}`);
  delete process.env.AW_VIDEO;
  const { BASE, OUT, launch } = await import('./lib.mjs');
  const url = new URL(BASE);
  url.searchParams.set('preset', 'dev');
  const cameraSpec = { pos: [-14.5, 3.3, 13.7], look: [-12.6, 2, 24.5] };
  const { browser, page, errors } = await launch({ channel, headless: args.includes('--headless') });
  const reportPath = path.join(OUT, 'render-ab.json');
  let report;
  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const renderer = window.__awDev?.view.renderer;
      if (!renderer) throw new Error('Expected __awDev from the current Ashen Watch build.');
      renderer.setAnimationLoop(null);
    });
    await page.waitForFunction(() => window.__awLoad?.done, undefined, { timeout: 30_000, polling: 50 });
    await page.evaluate(() => window.__awTexReady);
    report = await page.evaluate(compareInPage, { phase, cameraSpec });
    for (const frame of report.frames) {
      await fs.writeFile(path.join(OUT, `${frame.name}.png`), Buffer.from(frame.png, 'base64'));
      delete frame.png;
      if (frame.difference?.diffPng) {
        const file = `${frame.name}-diff.png`;
        await fs.writeFile(path.join(OUT, file), Buffer.from(frame.difference.diffPng, 'base64'));
        frame.difference.diffFile = file;
      }
      if (frame.difference) delete frame.difference.diffPng;
    }
    report.issues = validateFrames(report);
  } catch (error) {
    report ??= {};
    (report.issues ??= []).push(error.message);
  } finally {
    await browser.close();
    Object.assign(report, { url: url.href, channel, errors });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  if (report.frames) console.table(report.frames.map(frame => ({
    mode: frame.name,
    changedPixels: frame.difference?.changedPixels ?? 0,
    shadowCalls: frame.passes.reduce((sum, p) => sum + p.shadow.calls, 0),
    beautySceneryCalls: frame.passes[0]?.scenery.calls,
    totalCalls: frame.total.calls,
  })));
  console.log(reportPath);
  if (report.issues.length || errors.length) {
    console.error([...report.issues, ...errors].join('\n'));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
