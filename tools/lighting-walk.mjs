// Walk a short 1F→2F lighting scout with real keyboard/mouse input. The dev
// preset sets only the initial time/light state of each run, never the camera/pose.
// Usage: AW_URL=http://localhost:4173/ AW_VIDEO=1 node tools/lighting-walk.mjs chromium --headless day|night
// AW_ART_WALK=1 looks through both sides of the gatehouse window, then circles the cart, west wall and gutter.
// AW_RODIN_WALK=1 runs the ground-floor Rodin scout instead of the rampart route.
// AW_RUBBLE_WALK=1 skips the outer loop to inspect collapsed masonry on foot, in both directions.
// AW_GATE_ROOF=1 (or before) circles the gatehouse with the normal follow camera; old builds need no new roof.
// AW_GATE_ROOF=after requires live coverage of the new roof. AW_ROOF_CHECK=off|optional|required
// controls the independent probe on the ordinary roof route (defaults to optional).
// AW_GROUND_WALK=1 watches scan relief and bedding from opposing traversals of the cart run.
import fs from 'node:fs';
import path from 'node:path';
import { BASE, OUT, launch, shot, sleep, waitFor } from './lib.mjs';
import { Bot, STAND, doTutorial, startNewGame } from './bot.mjs';

const args = process.argv.slice(2);
const [channel = 'chrome', phase = 'day'] = args.filter((s) => !s.startsWith('--'));
if (!['day', 'night'].includes(phase)) throw new Error('照明阶段必须是 day 或 night');
const quality = process.env.AW_ROUTE_QUALITY ?? 'cinematic';
const artWalk = process.env.AW_ART_WALK === '1';
const roofMode = process.env.AW_GATE_ROOF;
const roofWalk = ['1', 'before', 'after'].includes(roofMode);
const roofCheck = roofMode === 'after' ? 'required' : process.env.AW_ROOF_CHECK ?? 'optional';
if (roofWalk && !['off', 'optional', 'required'].includes(roofCheck)) throw new Error('AW_ROOF_CHECK must be off, optional or required');
const westWalk = process.env.AW_WEST_WALK === '1';
const northWalk = process.env.AW_NORTH_WALK === '1';
const rubbleWalk = process.env.AW_RUBBLE_WALK === '1';
const groundWalk = !rubbleWalk && process.env.AW_GROUND_WALK === '1';
const rodinWalk = !rubbleWalk && !groundWalk && process.env.AW_RODIN_WALK === '1';
const runName = `${phase}-${roofWalk ? 'gatehouse' : rubbleWalk ? 'rubble' : groundWalk ? 'ground' : rodinWalk ? 'rodin' : 'lighting'}-walk`;
const { browser, context, page, errors } = await launch({ channel, headless: args.includes('--headless') });
const bot = new Bot(page);
const report = { phase, quality, artWalk, roofWalk, westWalk, northWalk, rodinWalk, rubbleWalk, groundWalk, viewport: page.viewportSize(), frames: [], errors };
const capture = async (name, yaw, pitch, floor, roofShot = false) => {
  await bot.aim(yaw, 0.025, pitch);
  await sleep(450);
  // A 180° keyboard/mouse turn can take longer than the fixed pause in CameraRig.
  // Capture only once the lens (not just the input) is facing the planned subject.
  if (roofShot) {
    await waitFor(page, ({ yaw, pitch }) => {
      const c = window.__awDev.view.camera;
      const d = c.getWorldDirection(c.position.clone());
      const lensYaw = Math.atan2(d.x, -d.z);
      const az = Math.atan2(Math.sin(lensYaw - yaw), Math.cos(lensYaw - yaw));
      const el = Math.atan2(-d.y, Math.hypot(d.x, d.z)) - pitch;
      return Math.abs(az) <= .035 && Math.abs(el) <= .055;
    }, 4000, { yaw, pitch });
  }
  const frame = await page.evaluate((roofShot) => {
    const { world, perf, locked } = window.__awProbe.state();
    const { input, view } = window.__awDev;
    const { x, y, z, floor } = world.player;
    const camera = view.camera;
    const lens = roofShot ? { direction: camera.getWorldDirection(camera.position.clone()).toArray(), fov: camera.fov } : undefined;
    return { phase: world.phase, x, y, z, floor, volume: view.post.volume ? [view.post.volume.target.width, view.post.volume.target.height, view.post.glow.uniforms.uHasVolume.value] : null, fixed: !!view.fixedCam, locked: locked && !input.fakeLock && (!roofShot || document.pointerLockElement === view.renderer.domElement), camera: camera.position.toArray(), lens, perf };
  }, roofShot);
  if (frame.fixed || !frame.locked || frame.phase !== phase || frame.floor !== floor) {
    throw new Error(`${name} 未在预期的实走视角/楼层：${JSON.stringify(frame)}`);
  }
  if (quality !== 'low' && frame.volume?.[2] !== 1) throw Error(`${name}: live shadow-volume pass inactive`);
  report.frames.push({ name, ...frame });
  await shot(page, `${phase}-${name}.png`);
  console.log(phase, name, floor, [frame.x, frame.y, frame.z].map((n) => n.toFixed(2)), frame.perf.fps.toFixed(1), 'fps');
  return report.frames.at(-1);
};
const walk = (x, z, floor = '1F') => bot.walkTo(x, z, { floor, stop: 0.22, maxSecs: 40 });

const rodinPlacements = [
  { name: 'rodin-outer-bailey' },
  { name: 'rodin-gate-scarp' },
  { name: 'rodin-pilgrim-relief' },
  // landmarks.ts rotates the facade Y +90° and translates it by (38.5, 0, 2.5).
  // Each GLB base sits 5 cm below the 11 m pier top.
  { name: 'rodin-chapel-pinnacle', expectedWorldXZ: [13.25, -11.25], expectedWorldMinY: 10.95 },
  { name: 'rodin-chapel-pinnacle', expectedWorldXZ: [13.25, -21.75], expectedWorldMinY: 10.95 },
];
function inspectRodinAssets({ placements, readyOnly }) {
  const { scene } = window.__awDev.view;
  const assets = placements.map(({ name, expectedWorldXZ, expectedWorldMinY }) => {
    let root, placement;
    if (expectedWorldXZ) {
      const [expectedX, expectedZ] = expectedWorldXZ;
      const candidates = scene.getObjectsByProperty('name', name).map((node) => ({
        node, worldAnchor: node.getWorldPosition(node.position.clone()).toArray(),
      }));
      const match = candidates.find(({ worldAnchor: [x, , z] }) => Math.hypot(x - expectedX, z - expectedZ) <= 0.15);
      root = match?.node;
      placement = { expectedWorldXZ, worldAnchor: match?.worldAnchor ?? null, expectedWorldMinY, worldMinY: null };
      if (!match) placement.candidateWorldAnchors = candidates.map(({ worldAnchor }) => worldAnchor);
    } else {
      root = scene.getObjectByName(name);
    }
    const source = root?.userData.source ?? null;
    let meshes = 0;
    if (root) {
      let visible = true;
      for (let node = root; node; node = node.parent) visible &&= node.visible;
      if (visible) {
        const vertex = placement ? root.position.clone() : null;
        let minY = Infinity;
        if (vertex) root.updateWorldMatrix(true, true);
        root.traverseVisible((node) => {
          const positions = node.geometry?.attributes.position;
          if (!node.isMesh || !positions || positions.count < 3) return;
          meshes++;
          if (vertex) {
            for (let i = 0; i < positions.count; i++) {
              node.getVertexPosition(i, vertex).applyMatrix4(node.matrixWorld);
              minY = Math.min(minY, vertex.y);
            }
          }
        });
        if (placement && Number.isFinite(minY)) placement.worldMinY = minY;
      }
    }
    return { name, found: Boolean(root), source, meshes, ...placement };
  });
  if (readyOnly && assets.some(({ source, meshes, expectedWorldMinY, worldMinY }) => {
    if (source !== 'hyper3d' || meshes === 0) return true;
    return expectedWorldMinY !== undefined && (worldMinY === null || Math.abs(worldMinY - expectedWorldMinY) > 0.005);
  })) return false;
  return assets;
}

async function verifyRodinAssets() {
  try {
    const assets = await page.waitForFunction(inspectRodinAssets, { placements: rodinPlacements, readyOnly: true }, { timeout: 10000, polling: 100 });
    report.rodinAssets = await assets.jsonValue();
  } catch (error) {
    report.rodinAssets = await page.evaluate(inspectRodinAssets, { placements: rodinPlacements, readyOnly: false }).catch(() => null);
    throw new Error(`Rodin GLB 未就绪（需要 hyper3d 根节点、可见网格及尖塔落位）：${JSON.stringify(report.rodinAssets)}\n${error.message}`);
  }
}

async function walkRodin() {
  await walk(-1.45, 5.3);
  await walk(-4.9, 6.95);
  await capture('rodin-01-scarp-silhouette', -2.85, -0.06, '1F');

  // Face south and strafe west along the rock so it remains in view during the walk.
  await bot.aim(Math.PI, 0.025, -0.12);
  await page.keyboard.down('KeyD');
  try {
    await waitFor(page, () => {
      const { locked, world: { player } } = window.__awProbe.lite();
      return locked && player.floor === '1F' && player.x <= -7.4;
    }, 8000);
  } finally {
    await page.keyboard.up('KeyD');
  }
  await capture('rodin-02-scarp-side', 2.59, 0.04, '1F');

  if (rubbleWalk) {
    // Look back across the freshly exposed face while tracking east along its toe.
    await walk(-7.32, 6.3);
    await capture('rubble-03-low-rake', 2.55, .10, '1F');
    await walk(-4.03, 6.2);
    await capture('rubble-04-gate-toe', -2.8, .34, '1F');
    await walk(-5.76, 15.7);
    await walk(-6.3, 18.6);
    await walk(-6.5, 19.6);
    await capture('rubble-05-west-heap', -0.94, .37, '1F');
    await walk(-6.62, 21.82);
    await capture('rubble-06-west-heap-reverse', -2.08, .45, '1F');
  } else {
    // baileyApron.ts: cross the portal between c_bailey_inner and c_bailey_outer,
    // then turn from BAILEY_STOPS.drum toward its surveyed view into the opening.
    const inner = [-8.24, 8.37];
    const outer = [-11.42, 8.37];
    await walk(...inner);
    await walk(...outer);
    await walk(-17.07, 4.68);
    const { world: { player } } = await bot.lite();
    const portalYaw = Math.atan2(-8.20 - player.x, 8.74 - player.z);
    await capture('rodin-02b-bailey-drum-lookback', portalYaw, -0.08, '1F');
    // From the same stop, face the southwest bend and frame its crest above the wall face.
    await capture('rodin-02c-bailey-drum-wall', -1.87, -0.16, '1F');
    await walk(...outer);
    await walk(...inner);
  }

  // Sprint the courtyard transit, then circle the old wallStub centered at (-4.55, 25.7).
  await bot.walkTo(-4.55, 22.95, { floor: '1F', stop: 0.22, maxSecs: 20, sprint: true });
  await capture('rodin-03-relief-front', 0, 0.30, '1F');
  // Turn back toward both pinnacles from the same walkable courtyard stop.
  await capture('rodin-03b-chapel-lookback', 1.92, -0.49, '1F');
  await walk(-2.75, 24.15);
  await capture('rodin-04-relief-oblique', -0.86, 0.34, '1F');
  await walk(-2.6, 26.8);
  await walk(-4.55, 27.55);
  await capture('rodin-05-relief-back', Math.PI, 0.41, '1F');

  await walk(.01, 25.4);
  await walk(.01, 30.44);
  await capture('rodin-06-north-arch-lookback', -3.02, -0.12, '1F');
}

async function walkGround() {
  report.groundMaterials = await page.evaluate(() => {
    const { view } = window.__awDev;
    const pools = view.groundMeshes();
    const materials = pools.map(mesh => mesh.material);
    return [materials.find(mat => mat.name === 'Bailey compacted earth and grit'),
      materials.find(mat => mat.map?.image?.src?.endsWith('/monastery_stone_floor_diff.jpg'))].map(mat => {
      const relief = mat.userData.aw;
      return { normal: mat.normalScale.x, enabled: relief.uAwHasDisp.value === 1,
        height: relief.uAwHeightScale.value, steps: relief.uAwSteps.value,
        sources: [mat.map, mat.normalMap, ...(relief.uAwHasDisp.value ? [relief.uAwHeightMap.value] : [])].map(t => new URL(t.image.src).pathname) };
    });
  });
  // Exposed earth still uses scan parallax. On the fitted paving the geometry
  // already supplies the shoulders: a second height offset is a regression.
  const [earth, paving] = report.groundMaterials;
  if (!earth.enabled || !(earth.height > 0) || paving.enabled || paving.height !== 0 ||
      report.groundMaterials.some(m => m.normal < .75 || (m.steps > 0) !== (quality !== 'low'))) {
    throw Error(`Invalid ground detail: ${JSON.stringify(report.groundMaterials)}`);
  }
  // Observe the skinned sole (not its IK target) on each new landing. The
  // court index is independently checked against rays on the batched meshes.
  await page.evaluate(() => {
    const { player, level } = window.__awDev.view;
    const read = player.readFootPlants.bind(player), last = [-1, -1];
    const outline = [[0, 0], [0, .137], [-.048, .115], [.048, .115], [-.063, 0], [.063, 0],
      [-.043, -.148], [.043, -.148], [0, -.164]];
    const stats = window.__awCourtBoots = { landings: 0, belowGrade: 0, aboveGrade: 0, maxGap: 0,
      minY: Infinity, maxY: -Infinity, flatPeakError: 0 };
    player.readFootPlants = () => {
      const result = read();
      if (result) for (const [i, foot] of [result.left, result.right].entries()) {
        if (!foot.planted || foot.plantId === last[i]) continue;
        last[i] = foot.plantId;
        const { yaw } = player.pace.feet[i], ux = Math.sin(yaw), uz = Math.cos(yaw);
        let h = -Infinity;
        for (const [s, f] of outline) {
          const surface = level.courtContact.heightAt(foot.x + f * ux + s * uz, -foot.z + f * uz - s * ux);
          if (surface !== undefined) h = Math.max(h, surface);
        }
        if (!Number.isFinite(h)) continue;
        stats.landings++;
        if (h < -.005) stats.belowGrade++;
        if (h > .005) stats.aboveGrade++;
        stats.minY = Math.min(stats.minY, foot.y); stats.maxY = Math.max(stats.maxY, foot.y);
        stats.flatPeakError = Math.max(stats.flatPeakError, Math.abs(h));
        stats.maxGap = Math.max(stats.maxGap, Math.abs(foot.y - h));
      }
      return result;
    };
  });
  await walk(-.82, 2.98);
  await capture('g1-threshold', -.24, .53, '1F');
  await walk(-1.7, 5.8);
  await capture('g2-stone-and-clay', -.45, .46, '1F');
  await walk(-.82, 12.2);
  await capture('g3-cart-run-lookback', -2.62, .52, '1F');
  await walk(-5.9, 15.8);
  await capture('g4-bedding-rake', .71, .34, '1F');
  await walk(-3, 19.1);
  await capture('g5-paving-oblique', Math.PI * .63, .43, '1F');
  await walk(-5.75, 18.85);
  await capture('g6-reverse', -2.0, .39, '1F');
  await walk(-7.0, 25.5);
  await capture('g7-gutter', .02, .65, '1F');
  const soles = report.soles = await page.evaluate(() => window.__awCourtBoots);
  if (soles.landings < 36 || soles.aboveGrade < 4 || soles.belowGrade < 4 || soles.maxGap > .006) {
    throw Error(`Ground contact did not follow both stone and mud: ${JSON.stringify(soles)}`);
  }
}

// staticLevel.ts -> gatehouseRoof.ts: the replacement and the named GLB meshes are
// distinct from the old roof and the independent bell eave/room trusses.
const gateRoof = {
  root: 'rodin-gatehouse-roof', fallback: 'gatehouse-roof-fallback',
  parts: ['GatehouseSlate', 'GatehouseOuterOak', 'GatehouseSoffit'],
};
let roofMath;

function inspectGateRoof({ spec, math }) {
  const { view } = window.__awDev;
  const { scene, camera } = view;
  const roots = scene.getObjectsByProperty('name', spec.root);
  const root = roots[0];
  const fallback = scene.getObjectByName(spec.fallback);
  const visible = (o) => {
    if (!o) return false;
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  const materials = (o) => Array.isArray(o.material) ? o.material : [o.material];
  const opaque = (m) => m && m.visible !== false && m.depthWrite && (!m.transparent || m.opacity >= .95);
  const isMesh = (o) => o.isMesh && o.geometry?.attributes.position?.count >= 3;
  const allMeshes = [];
  root?.traverse((o) => { if (isMesh(o)) allMeshes.push(o); });
  const meshes = allMeshes.filter((o) => visible(o) && camera.layers.test(o.layers) && materials(o).some(opaque));
  const parts = spec.parts.map((name) => {
    const found = allMeshes.filter((o) => o.name === name);
    const o = found[0];
    return { name, count: found.length, visible: meshes.includes(o),
      triangles: o ? (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 : 0 };
  });
  const asset = { roots: roots.length, source: root?.userData.source ?? null, rootVisible: visible(root),
    fallbackPresent: !!fallback, fallbackVisible: visible(fallback), parts };
  const ready = roots.length === 1 && asset.source === 'hyper3d' && asset.rootVisible && !asset.fallbackVisible &&
    allMeshes.length === parts.length && parts.every((p) => p.count === 1 && p.visible && p.triangles > 0);
  if (!math || !ready) return { status: ready ? 'mounted' : root ? 'incomplete' : 'missing', ...asset };

  // Sample at native follow-camera pixel coordinates. Roof-only first hits say
  // where the roof projects; then opaque, depth-writing world geometry can block
  // those hits. Bounds/coverage below are sample estimates, not GPU pixel masks.
  const { Raycaster, Vector2 } = math;
  const grid = { columns: 32, rows: 18 };
  const { clientWidth: width, clientHeight: height } = view.renderer.domElement;
  const ray = new Raycaster();
  const xy = new Vector2();
  ray.layers.mask = camera.layers.mask;
  ray.near = camera.near;
  const setRay = ({ x, y }, far) => {
    ray.far = far;
    ray.setFromCamera(xy.set(2 * x / width - 1, 1 - 2 * y / height), camera);
  };
  const onOpaque = ({ object, face }) => opaque(materials(object)[face?.materialIndex ?? 0]);
  const blockers = [];
  const roofMeshes = new Set(allMeshes);
  scene.traverseVisible((o) => {
    if (isMesh(o) && !roofMeshes.has(o) && camera.layers.test(o.layers) && materials(o).some(opaque)) blockers.push(o);
  });
  const hits = new Map(spec.parts.map((name) => [name, []]));
  for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.columns; x++) {
    const sample = { x: width * (x + .5) / grid.columns, y: height * (y + .5) / grid.rows };
    setRay(sample, camera.far);
    const hit = ray.intersectObjects(meshes, false).find(onOpaque);
    if (hit) hits.get(hit.object.name).push({ ...sample, depth: hit.distance });
  }
  const rect = (samples) => samples.length ? [
    Math.min(...samples.map((s) => s.x)), Math.min(...samples.map((s) => s.y)),
    Math.max(...samples.map((s) => s.x)), Math.max(...samples.map((s) => s.y)),
  ].map(Math.round) : null;
  const projection = parts.map(({ name }) => {
    const projected = hits.get(name);
    // Limit full-scene raycasts so the probe does not dominate the walk. The
    // evenly spaced selection still covers the silhouette from top to bottom.
    const n = Math.min(24, projected.length);
    const exposed = [];
    for (let i = 0; i < n; i++) {
      const hit = projected[Math.floor((i + .5) * projected.length / n)];
      setRay(hit, hit.depth - .002);
      if (!ray.intersectObjects(blockers, false).some(onOpaque)) exposed.push(hit);
    }
    const projectedBoundsPx = rect(projected), visibleBoundsPx = rect(exposed);
    return { name, projectedSamples: projected.length, projectedBoundsPx, testedSamples: n, visibleSamples: exposed.length,
      occludedSamples: n - exposed.length, visibleBoundsPx,
      status: !n ? 'not-projected' : !exposed.length ? 'occluded' : exposed.length < n ? 'partial' : 'visible' };
  });
  return { status: 'sampled', grid, viewport: [width, height], projection };
}

async function prepareGateRoofProbe() {
  report.roof = { mode: roofCheck, spec: gateRoof };
  if (roofCheck === 'off') return;
  const asset = await page.evaluate(inspectGateRoof, { spec: gateRoof });
  report.roof.asset = asset;
  if (asset.status !== 'mounted') {
    if (roofCheck === 'required') throw new Error(`Required roof not mounted: ${JSON.stringify(asset)}`);
    console.log(`Gatehouse roof probe: ${asset.status}; the route will still capture the baseline.`);
    return;
  }
  // Use local Three math for the read-only probe even on built packages that do
  // not serve the library as a standalone module. Never alter the game camera.
  const source = fs.readFileSync(new URL('./three.core.js', import.meta.resolve('three')), 'utf8');
  roofMath = await page.evaluateHandle(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      const { Raycaster, Vector2 } = await import(url);
      return { Raycaster, Vector2 };
    } finally { URL.revokeObjectURL(url); }
  }, source);
}

async function captureGateRoof(id, target, floor = '1F', probe = true) {
  const { world: { player: p } } = await bot.lite();
  const dx = target[0] - p.x, dz = target[2] - p.z;
  const range = Math.hypot(dx, dz);
  // Game +z is toward the yard, whereas Three.js uses -z there. Match the
  // 0.78 m right shoulder and 1.62 m pivot instead of aiming from the feet.
  const shoulder = Math.min(.78, range * .7);
  const yaw = Math.atan2(dx, dz) - Math.asin(shoulder / range);
  const pitch = Math.atan2(p.y + 1.62 - target[1], Math.sqrt(range ** 2 - shoulder ** 2));
  const frame = await capture(id, yaw, pitch, floor, true);
  frame.roofAim = { targetGameXYZ: target, yaw, pitch };
  if (probe && roofMath) frame.roofProjection = await page.evaluate(inspectGateRoof, { spec: gateRoof, math: roofMath });
}

async function walkGateRoof() {
  await walk(-.93, -3.48);
  await captureGateRoof('r1-hearth-reveal', [-.9, 2.65, .15]);
  await walk(.3, -4.9);
  await captureGateRoof('r2-rear-window', [0, 3.05, -7.86]);
  await walk(-.82, 2.98);
  await captureGateRoof('r3-door-and-eave', [0, 3.25, .3]);
  await walk(-1.5, 6.2);
  await captureGateRoof('r4-timber-gable', [0, 4.30, .12]);
  // Yard side of the south curtain, not the unwalkable exterior flank at z < 0.
  await walk(-3.75, 4.2);
  await captureGateRoof('r4b-west-eave-close', [-.7, 4.25, .30]);
  await walk(-1.5, 6.2);
  // The old (2,12.5) target lies inside the well at (3,13), even before
  // adding player radius. Stay on its south/west side and clear the S1 lip.
  await walk(1.8, 10.2);
  await captureGateRoof('r5-gatehouse-context', [0, 4.10, -.10]);
  await walk(1.65, 6.2);
  await walk(3.4, 1.4);
  await walk(9.2, 4.3, '2F');
  await captureGateRoof('r6-roof-from-wall', [0, 4.75, -3.1], '2F');
  await walk(9.2, 12.55, '2F');
  await capture('r7-chapel-tracery', .73, -.71, '2F', true);
  await captureGateRoof('r8-roof-and-valley', [0, 4.75, -3.1], '2F');

  if (!roofMath) return;
  const heroFrames = [
    ['r2-rear-window', 'GatehouseSoffit'],
    ['r4b-west-eave-close', 'GatehouseOuterOak'],
    ['r6-roof-from-wall', 'GatehouseSlate'],
  ];
  report.roof.coverage = heroFrames.map(([id, part]) => {
    const frame = report.frames.find((frame) => frame.name === id);
    const sample = frame?.roofProjection?.projection?.find((p) => p.name === part);
    return { frame: id, part, ok: (sample?.visibleSamples ?? 0) >= 2, sample: sample ?? null };
  });
  const missed = report.roof.coverage.filter((p) => !p.ok);
  if (missed.length) {
    const message = `Live roof coverage missed: ${JSON.stringify(missed)}`;
    if (roofCheck === 'required') errors.push(message);
    else console.warn(message);
  }
}

async function walkLighting() {
  if (westWalk || northWalk) {
    await walk(-.45, 3.1);
    await capture('gate-outcrop', -1.58, -0.13, '1F');
    await walk(-1.45, 5.3);
    await capture('gate-to-north', 0.07, -0.075, '1F');
  }
  if (artWalk) {
    await walk(-.93, -3.48);
    await capture('w1-hearth-window-inside', -.28, -.05, '1F');
    await walk(-.82, 2.98);
    await capture('w2-hearth-window-outside', -Math.PI + .38, -.06, '1F');
    await walk(-1.7, 5.8);
    await capture('a-cart-approach', -0.36, 0.09, '1F');
    await walk(-0.8, 12.2);
    await capture('a2-split-flags', -2.62, 0.52, '1F');
    await bot.walkTo(-5.9, 15.8, { floor: '1F', stop: 0.22, maxSecs: 35, sprint: true });
  } else await walk(-5.9, 15.8);
  await capture('01-courtyard', Math.PI * 0.58, -0.11, '1F');
  await walk(-3, 19.1);
  await capture('02-courtyard-north', Math.PI * 0.43, -0.13, '1F');
  if (artWalk) {
    await capture('w3-chapel-from-yard', 1.48, -0.48, '1F');
    await walk(-5.75, 18.85);
    await capture('b-scaffold-and-wall', -1.97, 0.07, '1F');
    await walk(-7.0, 25.5);
    await capture('c-north-gutter', 0.02, 0.28, '1F');
  }
  if (westWalk) {
    await walk(-5.3, 11.85);
    await capture('west-01-approach', -1.58, -0.09, '1F');
    await walk(-10.25, 11.85);
    await walk(-14.26, 11.85);
    await capture('west-02-south-room', -0.30, -0.17, '1F');
    await walk(-14.35, 16.15);
    await capture('west-03-gable', -0.22, -0.22, '1F');
    await walk(-16.20, 20.05);
    await capture('west-04-return-arch', 1.70, -0.13, '1F');
    await walk(-15.9, 23.2);
    await capture('west-05-rooms', 2.51, -0.03, '1F');
    await walk(-10.25, 20);
    await walk(-6.0, 20);
  }
  if (northWalk) {
    await walk(.01, 25.4);
    await capture('north-01-opening', .04, -.12, '1F');
    await walk(.01, 30.44);
    await capture('north-02-breakwater', -.37, -.11, '1F');
    await walk(-1.70, 33.13);
    await walk(.32, 35.14);
    await capture('north-03-looking-back', 2.86, -.12, '1F');
    await walk(3.95, 33.03);
    await walk(4.84, 30.42);
    await walk(4.84, 25.45);
  }
  await walk(3.4, 1.4);
  await walk(9.2, 7.0, '2F');
  await capture('03-rampart-east', Math.PI * 0.64, -0.15, '2F');
  if (artWalk) {
    await walk(9.2, 12.55, '2F');
    await capture('w4-chapel-from-rampart', 0.73, -0.71, '2F');
  }
  await walk(9.2, 16.2, '2F');
  await capture('04-rampart-northwest', -Math.PI * 0.34, 0.03, '2F');
  if (westWalk) await capture('west-06-from-parapet', -1.33, 0.13, '2F');
  if (northWalk) {
    await walk(9.20, 27.75, '2F');
    await walk(1.35, 27.75, '2F');
    await capture('north-04-parapet', -.17, .34, '2F');
  }
}

try {
  await page.addInitScript((q) => localStorage.setItem('ashen-watch/settings', JSON.stringify({ mode: 'kbm', sensitivity: 1, brightness: 1, quality: q })), quality);
  await page.goto(`${BASE}?preset=dev&dayscale=1`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__awProbe?.state().perf.calls > 0, 30000);
  report.gpu = await page.evaluate(() => window.__awProbe.gpu());
  await page.evaluate(() => window.__awTexReady);
  if (roofWalk) await prepareGateRoofProbe();
  else if (rodinWalk || rubbleWalk) await verifyRodinAssets();
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
  if (roofWalk) await walkGateRoof();
  else if (rodinWalk || rubbleWalk) await walkRodin();
  else if (groundWalk) await walkGround();
  else await walkLighting();
} catch (e) {
  errors.push(e.message);
  await shot(page, `${runName}-error.png`).catch(() => {});
} finally {
  if (process.env.AW_VIDEO === '1') {
    const clip = page.video();
    await context.close().catch(() => {});
    if (clip) await clip.saveAs(path.join(OUT, `${runName}.webm`)).catch((e) => errors.push(e.message));
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, `${runName}.json`), JSON.stringify(report, null, 2));
  if (errors.length) { process.exitCode = 1; console.error(errors); }
}
