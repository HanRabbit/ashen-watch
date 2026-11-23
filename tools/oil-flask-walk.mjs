// B1 oil-flask acceptance, using a real pointer lock and the regular follow camera.
// Baseline (only once port/GPU use is coordinated):
//   AW_URL=http://127.0.0.1:4214/ AW_OUT=.cache/oil-flask AW_ANGLE=metal node tools/oil-flask-walk.mjs chrome --headless before
// Replacement: same command with its build's URL and `after` (reuse AW_OUT to compare cameras).
// If the replacement has an unrelated filename, set AW_ASSET to a substring of its GLB/GLTF URL.
import fs from 'node:fs';
import path from 'node:path';
import { BASE, OUT, launch, shot, sleep, waitFor } from './lib.mjs';
import { Bot, startNewGame } from './bot.mjs';

const args = process.argv.slice(2);
const run = args.find((arg) => arg === 'before' || arg === 'after') ?? 'before';
const [channel = 'chrome', ...extra] = args.filter((arg) => !['--headless', 'before', 'after'].includes(arg));
if (extra.length || args.filter((arg) => arg === 'before' || arg === 'after').length > 1 || channel.startsWith('--')) {
  throw new Error('Usage: node tools/oil-flask-walk.mjs [chrome|chromium|msedge] [--headless] [before|after]');
}
const quality = process.env.AW_ROUTE_QUALITY ?? 'cinematic';
const url = new URL(BASE);
url.searchParams.set('preset', 'dev');
url.searchParams.set('probe', '1');
url.searchParams.set('dayscale', '1');
url.searchParams.set('timescale', '1');
const name = `oil-flask-${run}`;
const spawn = { x: 17.7, y: -3, z: 13, floor: 'B1' };
const legacy = {
  interact: { id: 'flask', x: 14.8, y: -2, z: 13, floor: 'B1' },
  renderAnchor: [14.8, -2.14, -13], // Three.js uses -gameZ.
  table: { x0: 14.4, x1: 15.2, z0: 12.6, z1: 13.4, top: -2.14 },
  radius: 0.35,
};
const front = [16.62, 13];
const eastTurn = [16.62, 14.84];
const side = [14.8, 14.84];
// A passage return blocks the direct west flank. Approach from the clear south aisle.
const southTurn = [16.62, 12.06];
const back = [13.49, 12.06];
const maxOil = 300;
const report = {
  run, url: url.href, channel, quality, angle: process.env.AW_ANGLE ?? (process.platform === 'darwin' ? 'metal' : 'default'),
  route: { spawn, front, eastTurn, side, southTurn, back, lanternOil: maxOil }, legacy,
  frames: [], waypoints: [], collision: [], checks: {}, warnings: [], errors: [],
};
const check = (label, ok, detail) => {
  report.checks[label] = { ok: !!ok, detail };
  if (!ok) report.errors.push(`${label}: ${JSON.stringify(detail)}`);
};
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const near = (a, b, tolerance = 0.001) => Math.abs(a - b) <= tolerance;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const modelUrl = (value) => /\.(?:gltf|glb)$/i.test(new URL(value).pathname);
const matchingAsset = (value) => {
  const pathname = decodeURIComponent(new URL(value).pathname).toLowerCase();
  return process.env.AW_ASSET ? pathname.includes(process.env.AW_ASSET.toLowerCase()) : /oil|flask/.test(pathname);
};

let browser, context, page, bot, flaskRoot, three;
const modelResponses = [];
const assetWarnings = [];

// Observations never write input, transforms, or simulation state.
function liveState() {
  const { mode, screen, locked, yaw, pitch, target, world } = window.__awProbe.lite();
  const { input, view } = window.__awDev;
  return {
    mode, screen, yaw, pitch, target, phase: world.phase, played: world.played,
    player: world.player, lantern: world.lantern, inventory: world.inv, taken: world.taken.flask,
    realLock: locked && !input.fakeLock && document.pointerLockElement === document.getElementById('game'),
    fixedCamera: !!view.fixedCam,
  };
}
async function live() {
  const s = await page.evaluate(liveState);
  assert(s.realLock && !s.fixedCamera && s.mode === 'playing' && !s.screen && s.player.floor === 'B1',
    `Expected a live B1 follow camera with real pointer lock: ${JSON.stringify(s)}`);
  assert(s.inventory.hasLantern && s.lantern.on, 'The B1 route needs the carried lantern lit');
  return s;
}

async function aim(yaw, pitch) {
  for (let i = 0; i < 12; i++) {
    const s = await live();
    const dy = wrap(yaw - s.yaw), dp = pitch - s.pitch;
    if (Math.abs(dy) <= 0.006 && Math.abs(dp) <= 0.008) return;
    // Bot.nudge emits a Playwright mouse move, not a synthetic DOM event or dev write.
    await bot.nudge(dy, dp);
    await sleep(35);
  }
  throw new Error(`Mouse did not reach yaw=${yaw}, pitch=${pitch}`);
}

async function forwardUntil(fn, arg, timeout = 8000) {
  await page.keyboard.down('KeyW');
  try { await page.waitForFunction(fn, arg, { timeout, polling: 'raf' }); }
  finally { await page.keyboard.up('KeyW'); }
  await waitFor(page, () => !window.__awProbe.lite().world.player.moving, 3000);
}

// Deterministic short straight legs around the table; no nav snapping near furniture.
async function walk([x, z]) {
  for (let i = 0; i < 7; i++) {
    const { player: p } = await live();
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= 0.10) {
      report.waypoints.push({ want: [x, z], got: [p.x, p.z], errorM: d });
      return;
    }
    const nx = (x - p.x) / d, nz = (z - p.z) / d;
    await aim(Math.atan2(nx, nz), 0.12);
    await forwardUntil(([x, z, nx, nz]) => {
      const p = window.__awProbe.lite().world.player;
      return (p.x - x) * nx + (p.z - z) * nz >= -0.062;
    }, [x, z, nx, nz]);
  }
  throw new Error(`Did not reach (${x}, ${z}) with KeyW`);
}

async function pressIntoTable(label) {
  await walk(front);
  await aim(-Math.PI / 2, 0.12);
  const start = await live();
  let contact, held;
  await page.keyboard.down('KeyW');
  try {
    const sampleAfter = async (played) => {
      await waitFor(page, (end) => window.__awProbe.lite().world.played >= end, 8000, played);
      return live();
    };
    contact = await sampleAfter(start.played + 1.05);
    held = await sampleAfter(contact.played + 0.25);
  } finally { await page.keyboard.up('KeyW'); }
  await waitFor(page, () => !window.__awProbe.lite().world.player.moving, 3000);
  const stopX = legacy.table.x1 + legacy.radius;
  report.collision.push({ label, key: 'KeyW', side: 'east', expectedStopX: stopX, start, contact, held });
  check(`legacy-table-collision-${label}`,
    start.player.x > stopX + 0.8 && contact.player.moving && held.player.moving &&
    near(contact.player.x, stopX, 0.025) && near(held.player.x, stopX, 0.025) &&
    near(held.player.x, contact.player.x, 0.015) && near(held.player.z, legacy.interact.z, 0.18),
    { expectedX: stopX, startX: start.player.x, contactX: contact.player.x, heldX: held.player.x, heldZ: held.player.z });
}

// Read the mounted subtree, project its size, and estimate occlusion using a 7x7 grid of
// rays from the actual camera. Only rays hitting the bottle count. This is a geometric
// estimate (not a test of brightness, GPU skin/alpha effects, or the HUD).
function inspect({ root, T, cast }) {
  const { view } = window.__awDev;
  const camera = view.camera;
  const effective = (o) => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  const materials = (o) => Array.isArray(o.material) ? o.material : [o.material];
  const drawable = (m) => m && m.visible !== false && m.opacity > 0;
  const isMesh = (o) => o.isMesh && o.geometry?.attributes.position?.count >= 3;
  const meshes = [], visible = [], nodes = [], bounds = new T.Box3();
  root.traverse((o) => {
    if (o.name || o.userData.source || o.userData.asset || o.userData.url) {
      nodes.push({ name: o.name, source: o.userData.source, asset: o.userData.asset, url: o.userData.url, visible: effective(o) });
    }
    if (!isMesh(o)) return;
    const enabled = effective(o) && camera.layers.test(o.layers) && materials(o).some(drawable);
    meshes.push({ uuid: o.uuid, name: o.name, geometry: o.geometry.type, enabled,
      triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
      materials: materials(o).map((m) => ({ name: m.name, type: m.type, metalness: m.metalness, roughness: m.roughness,
        maps: ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].filter((key) => m[key]) })),
    });
    if (!enabled) return;
    visible.push(o);
    bounds.union(new T.Box3().setFromBufferAttribute(o.geometry.attributes.position).applyMatrix4(o.matrixWorld));
  });
  let inScene = false;
  for (let p = root; p; p = p.parent) if (p === view.scene) inScene = true;
  const cameraInfo = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov };
  const anchor = root.getWorldPosition(new T.Vector3()).toArray();
  const asset = {
    uuid: root.uuid, group: root.isGroup, sameRoot: root === view.props.flask, inScene,
    rootVisible: root.visible, effectivelyVisible: effective(root), anchor, scale: root.scale.toArray(),
    nodes, meshes, visibleMeshes: visible.length,
    bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new T.Vector3()).toArray() },
  };
  if (!cast || bounds.isEmpty()) return { camera: cameraInfo, asset, occlusion: { status: visible.length ? 'not-sampled' : 'hidden' } };

  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    corners.push(new T.Vector3(x, y, z).project(camera));
  }
  const { clientWidth: w, clientHeight: h } = view.renderer.domElement;
  const rect = {
    left: Math.min(...corners.map((v) => (v.x + 1) * w / 2)), right: Math.max(...corners.map((v) => (v.x + 1) * w / 2)),
    top: Math.min(...corners.map((v) => (1 - v.y) * h / 2)), bottom: Math.max(...corners.map((v) => (1 - v.y) * h / 2)),
  };
  const inFrame = corners.every((v) => Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && Math.abs(v.z) <= 1);
  if (!inFrame) return { camera: cameraInfo, asset, rect, occlusion: { status: 'out-of-frame' } };

  const blockers = [];
  const bottleNodes = new Set(visible);
  view.scene.traverseVisible((o) => {
    if (isMesh(o) && !bottleNodes.has(o) && camera.layers.test(o.layers) &&
        materials(o).some((m) => drawable(m) && m.depthWrite && (!m.transparent || m.opacity >= 0.95))) blockers.push(o);
  });
  const ray = new T.Raycaster();
  ray.layers.mask = camera.layers.mask;
  ray.near = camera.near;
  const hitsMaterial = ({ object, face }) => {
    const m = materials(object)[face?.materialIndex ?? 0];
    return drawable(m) && m.depthWrite && (!m.transparent || m.opacity >= 0.95);
  };
  const blockerNames = {};
  let hit = 0, blocked = 0;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const dx = rect.left + (x + 0.5) * (rect.right - rect.left) / 7;
    const dy = rect.top + (y + 0.5) * (rect.bottom - rect.top) / 7;
    ray.setFromCamera(new T.Vector2(2 * dx / w - 1, 1 - 2 * dy / h), camera);
    ray.far = camera.far;
    const bottle = ray.intersectObjects(visible, false).find(({ object, face }) => drawable(materials(object)[face?.materialIndex ?? 0]));
    if (!bottle) continue;
    hit++;
    ray.far = bottle.distance - 0.003;
    const block = ray.intersectObjects(blockers, false).find(hitsMaterial);
    if (block) {
      blocked++;
      let p = block.object, label;
      for (; p && p !== view.scene; p = p.parent) {
        if (p === view.player.group) { label = 'player/held-lantern'; break; }
        label ??= p.name || undefined;
      }
      label ??= 'unnamed world geometry';
      blockerNames[label] = (blockerNames[label] ?? 0) + 1;
    }
  }
  return { camera: cameraInfo, asset, rect, occlusion: {
    status: !hit ? 'no-surface-samples' : blocked === hit ? 'occluded' : blocked ? 'partial' : 'clear',
    hit, blocked, blockerNames,
  } };
}

async function capture(id, cast = true) {
  const s = await live();
  assert(!s.player.moving, `${id}: camera still moving`);
  await page.evaluate(() => window.__awProbe.resetPerf());
  await sleep(1200); // Stationary timing window, before screenshot and CPU ray queries.
  const player = await live();
  const perf = await page.evaluate(() => window.__awProbe.state().perf);
  const image = await shot(page, `${name}-${id}.png`);
  const observed = await page.evaluate(inspect, { root: flaskRoot, T: three, cast });
  await live();
  const frame = { id, image, player, perf, ...observed };
  report.frames.push(frame);
  check(`${id}-live-perf`, perf.frames > 0 && perf.calls > 0 && perf.triangles > 0, perf);
  if (cast) {
    const status = frame.occlusion.status;
    check(`${id}-visible`, frame.asset.visibleMeshes > 0 && ['clear', 'partial'].includes(status), frame.occlusion);
    if (status !== 'clear') report.warnings.push(`${id}: ${status}; review the screenshot (ray test approximates depth occlusion)`);
  }
  console.log(`${run}/${id}: ${perf.fps.toFixed(1)} fps, ${perf.calls} calls, ${perf.triangles} tris, ${frame.occlusion.status}`);
  return frame;
}

// Crop real rendered pixels from the exact source PNG (no resampling and no game lens/scale changes).
async function cropClose(frame) {
  if (!frame.rect || frame.occlusion.status === 'out-of-frame') return;
  const { width, height } = report.viewport;
  const { left, right, top, bottom } = frame.rect;
  const x = Math.max(0, Math.floor(left - 56)), y = Math.max(0, Math.floor(top - 56));
  const w = Math.min(width, Math.ceil(right + 56)) - x, h = Math.min(height, Math.ceil(bottom + 56)) - y;
  const encoded = await page.evaluate(async ({ data, x, y, w, h }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const png = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), x, y, w, h);
    const crop = new OffscreenCanvas(w, h);
    crop.getContext('2d').drawImage(png, 0, 0);
    png.close();
    const result = new Uint8Array(await (await crop.convertToBlob()).arrayBuffer());
    let binary = '';
    for (let i = 0; i < result.length; i += 16384) binary += String.fromCharCode(...result.subarray(i, i + 16384));
    return btoa(binary);
  }, { data: fs.readFileSync(frame.image).toString('base64'), x, y, w, h });
  const file = path.join(OUT, `${name}-close-crop.png`);
  fs.writeFileSync(file, Buffer.from(encoded, 'base64'));
  report.crop = { file, source: frame.image, x, y, width: w, height: h, resampled: false };
}

function compareCamera(a, b) {
  const dot = a.quaternion.reduce((sum, q, i) => sum + q * b.quaternion[i], 0);
  return { translationM: dist(a.position, b.position), rotationDeg: 2 * Math.acos(Math.min(1, Math.abs(dot))) * 180 / Math.PI,
    fovDeg: Math.abs(a.fov - b.fov) };
}

try {
  let browserErrors;
  ({ browser, page, context, errors: browserErrors } = await launch({ channel, headless: args.includes('--headless') }));
  report.browserErrors = browserErrors;
  report.viewport = page.viewportSize();
  // Chromium versions with a pointer-lock permission prompt need an explicit
  // origin grant in automation. The game still acquires and uses native lock.
  const targetCDP = await context.newCDPSession(page);
  const browserCDP = await browser.newBrowserCDPSession();
  try {
    const { targetInfo } = await targetCDP.send('Target.getTargetInfo');
    await browserCDP.send('Browser.setPermission', {
      permission: { name: 'pointer-lock' }, setting: 'granted',
      origin: url.origin, browserContextId: targetInfo.browserContextId,
    });
    report.pointerLockPermission = 'granted';
  } catch (error) {
    report.pointerLockPermission = error.message;
  } finally {
    await targetCDP.detach();
    await browserCDP.detach();
  }
  page.on('response', (r) => { if (modelUrl(r.url())) modelResponses.push({ url: r.url(), status: r.status() }); });
  page.on('console', (m) => { if (m.type() === 'warning' && /oil|flask|fallback/i.test(m.text())) assetWarnings.push(m.text()); });
  report.modelResponses = modelResponses;
  report.assetWarnings = assetWarnings;
  await page.addInitScript((quality) => localStorage.setItem('ashen-watch/settings', JSON.stringify({
    mode: 'kbm', sensitivity: 1, brightness: 1, quality,
  })), quality);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__awProbe?.state().perf.calls > 0 && !!window.__awDev?.view.props.flask && window.__awLoad?.done, 60000);
  await page.evaluate(() => window.__awTexReady);
  report.gpu = await page.evaluate(() => window.__awProbe.gpu());
  assert(report.gpu && !/unknown|swiftshader|llvmpipe|softpipe|lavapipe|software|swangle|basic render driver|warp\b/i.test(report.gpu),
    `The game context did not report a hardware GPU: ${report.gpu}`);

  // Use the local Three core only as a read-only math/Raycaster helper. It also works
  // against a static/older bundle where Vite does not expose any source modules.
  const core = fs.readFileSync(new URL('./three.core.js', import.meta.resolve('three')), 'utf8');
  three = await page.evaluateHandle(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      const { Box3, Vector2, Vector3, Raycaster } = await import(url);
      return { Box3, Vector2, Vector3, Raycaster };
    } finally { URL.revokeObjectURL(url); }
  }, core);
  bot = new Bot(page);
  await startNewGame(bot);
  // The only dev writes: seed the B1 starting feet and carried, lit lantern once.
  // Do not write simulation, yaw, camera, pickup, collision or mesh state after this.
  await page.evaluate(({ spawn, maxOil }) => {
    const w = window.__awDev.session.world;
    Object.assign(w.player, spawn);
    w.inv.hasLantern = true;
    Object.assign(w.lantern, { on: true, oil: maxOil });
    const debug = document.getElementById('debug');
    if (debug) debug.hidden = true;
  }, { spawn, maxOil });
  await live();
  flaskRoot = await page.evaluateHandle(() => window.__awDev.view.props.flask);
  const interact = await page.evaluate(() => window.__awProbe.interacts().find((it) => it.id === 'flask'));
  check('legacy-interaction-position', interact && ['x', 'y', 'z'].every((key) => near(interact[key], legacy.interact[key])) &&
    interact.floor === legacy.interact.floor, interact);

  await pressIntoTable('before-pickup');
  await walk(front);
  await walk(eastTurn);
  await walk(side);
  await aim(Math.PI, 0.49);
  await capture('side-north');
  for (const point of [eastTurn, southTurn, back]) await walk(point);
  await aim(Math.atan2(legacy.interact.x - back[0], legacy.interact.z - back[1]), 0.53);
  const close = await capture('back-southwest');
  // The southwest aisle naturally brings the normal camera nearer to the bottle.
  await cropClose(close);
  for (const point of [southTurn, front]) await walk(point);
  await aim(-Math.PI / 2, 0.49);
  const before = await capture('front-east');
  if (!report.crop) await cropClose(before);

  const asset = before.asset;
  const geometries = asset.meshes.filter((m) => m.enabled).map((m) => m.geometry).sort();
  const legacyPieces = ['CylinderGeometry', 'CylinderGeometry', 'SphereGeometry', 'TorusGeometry'];
  const hasLegacyBottle = [...new Set(legacyPieces)].every((kind) =>
    geometries.filter((g) => g === kind).length >= legacyPieces.filter((g) => g === kind).length);
  const procedural = hasLegacyBottle && geometries.length === legacyPieces.length;
  const matchedResponses = modelResponses.filter((r) => matchingAsset(r.url));
  const fetched = matchedResponses.some((r) => (r.status >= 200 && r.status < 300) || r.status === 304);
  const annotated = asset.nodes.some((node) => node.visible && /rodin|hyper3d|\.gl(?:b|tf)\b/i.test(JSON.stringify(node)));
  report.asset = { ...asset, procedural, hasLegacyBottle, fetched, annotated, matchedResponses,
    tabletopGapM: asset.bounds ? asset.bounds.min[1] - legacy.table.top : null };
  check('legacy-flask-parent-and-anchor', asset.sameRoot && asset.inScene && asset.group &&
    dist(asset.anchor, legacy.renderAnchor) <= 0.001, { anchor: asset.anchor, group: asset.group, inScene: asset.inScene });
  check('asset-for-build', run === 'before' ? procedural : asset.visibleMeshes > 0 && !hasLegacyBottle && (fetched || annotated),
    { expected: run === 'before' ? 'legacy procedural' : 'mounted replacement with GLB/source evidence', geometries, hasLegacyBottle, matchedResponses, annotated });

  // This is the real in-world prompt + trusted KeyE, not a dev pickup or a flag assignment.
  const pre = await live();
  report.pickup = { key: 'KeyE', pre };
  assert(!pre.taken && pre.target?.id === 'flask' && pre.target.enabled, `Flask not interactable before KeyE: ${JSON.stringify(pre.target)}`);
  await page.keyboard.press('KeyE');
  await waitFor(page, () => window.__awProbe.lite().world.taken.flask, 5000);
  const after = await capture('picked-up-east', false);
  const post = after.player;
  report.pickup.post = post;
  check('KeyE-takes-exactly-one-oil', post.taken && post.inventory.oil === pre.inventory.oil + 1 &&
    Object.keys(pre.inventory).every((key) => key === 'oil' || pre.inventory[key] === post.inventory[key]) &&
    post.target?.id !== 'flask', { preInventory: pre.inventory, postInventory: post.inventory, taken: post.taken, target: post.target });
  const hidden = after.asset;
  check('same-pickup-parent-hides-entire-subtree', hidden.sameRoot && hidden.inScene && !hidden.rootVisible &&
    !hidden.effectivelyVisible && hidden.visibleMeshes === 0 && dist(hidden.anchor, asset.anchor) <= 0.001 &&
    hidden.meshes.map((m) => m.uuid).join(',') === asset.meshes.map((m) => m.uuid).join(','),
    { uuid: hidden.uuid, inScene: hidden.inScene, rootVisible: hidden.rootVisible, sameRoot: hidden.sameRoot, visibleMeshes: hidden.visibleMeshes });
  const pickupDelta = compareCamera(before.camera, after.camera);
  check('pickup-matched-camera', pickupDelta.translationM <= 0.025 && pickupDelta.rotationDeg <= 0.5 && pickupDelta.fovDeg <= 0.05, pickupDelta);
  await page.keyboard.press('KeyE');
  await waitFor(page, (played) => window.__awProbe.lite().world.played > played + 0.10, 3000, post.played);
  const repeated = await live();
  check('KeyE-cannot-collect-twice', repeated.taken && repeated.inventory.oil === post.inventory.oil, repeated.inventory.oil);
  await pressIntoTable('after-pickup');

  const baselineFile = path.join(OUT, 'oil-flask-before.json');
  if (run === 'after' && fs.existsSync(baselineFile)) {
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    report.baselineCameraDelta = report.frames.flatMap((frame) => {
      const old = baseline.frames.find((f) => f.id === frame.id);
      return old ? [{ frame: frame.id, ...compareCamera(old.camera, frame.camera) }] : [];
    });
    if (baseline.quality !== quality || baseline.viewport?.width !== report.viewport.width || baseline.viewport?.height !== report.viewport.height ||
        report.baselineCameraDelta.length !== report.frames.length ||
        report.baselineCameraDelta.some((d) => d.translationM > 0.22 || d.rotationDeg > 1.5 || d.fovDeg > 0.1)) {
      report.warnings.push('Baseline framing differs; see baselineCameraDelta and viewport/quality before comparing pixels or performance.');
    }
  }
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  if (page) await shot(page, `${name}-error.png`).catch(() => {});
} finally {
  if (process.env.AW_VIDEO === '1' && context && page) {
    const video = page.video();
    await context.close().catch(() => {});
    if (video) await video.saveAs(path.join(OUT, `${name}.webm`)).catch((error) => report.errors.push(error.message));
  }
  if (browser) await browser.close().catch((error) => report.errors.push(error.message));
  report.ok = !report.errors.length && !report.browserErrors?.length;
  const file = path.join(OUT, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${file}`);
  if (!report.ok) {
    console.error(...report.errors, ...(report.browserErrors ?? []));
    process.exitCode = 1;
  }
}
