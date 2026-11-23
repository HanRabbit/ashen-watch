import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { MeshStandardMaterial, Raycaster, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLAYER } from '../src/config';
import { loadCharacterAssets, loadCharTextures, prepHunter } from '../src/render/characterAssets';
import { PlayerModel } from '../src/render/characters';
import { createMotionPose, sampleWatchmanMotion } from '../src/render/watchmanMotion';

import { inArea, STAIR_BODIES, supportY } from '../src/sim/level';
import { newWorld } from '../src/sim/state';
import { step as simulate } from '../src/sim/sim';


vi.mock('../src/render/characterAssets', async (importOriginal) => ({
  ...await importOriginal(),
  loadCharacterAssets: vi.fn(),
  loadCharTextures: vi.fn(),
}));
vi.mock('../src/render/materials', async (importOriginal) => ({
  ...await importOriginal(),
  grimeTexture: () => new Texture(),
}));

// Preserve the actual rig, mesh, skinning, and clip. Only strip image bindings
// so GLTFLoader can parse the same GLB geometry without DOM or WebGL.
async function loadHunter() {
  const glb = readFileSync(new URL('../public/models/characters/hunter.glb', import.meta.url));
  const jsonEnd = 20 + glb.readUInt32LE(12);
  const json = JSON.parse(glb.toString('utf8', 20, jsonEnd));
  delete json.images;
  delete json.textures;
  json.materials = json.materials.map(() => ({}));
  const text = Buffer.from(JSON.stringify(json));
  const jsonSize = Math.ceil(text.length / 4) * 4;
  const bytes = Buffer.alloc(20 + jsonSize + glb.length - jsonEnd, 0x20);
  glb.copy(bytes, 0, 0, 20);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonSize, 12);
  text.copy(bytes, 20);
  glb.copy(bytes, 20 + jsonSize, jsonEnd);
  return prepHunter(await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, ''));
}

async function makePlayer() {
  const hunter = await loadHunter();
  const texture = new Texture();
  const tex = { map: texture, normalMap: texture, roughnessMap: texture };
  vi.mocked(loadCharacterAssets).mockResolvedValue({ hunter, reaper: null });
  vi.mocked(loadCharTextures).mockResolvedValue({ fabric: tex, leather: tex });
  const material = new MeshStandardMaterial();
  const model = new PlayerModel({ iron: material, paper: material }, texture);
  await Promise.resolve();
  return { model, hunter };
}

function weightedVertices(mesh, bones, threshold) {
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const joints = new Set(bones.map((bone) => mesh.skeleton.bones.indexOf(bone)));
  const out = [];
  for (let i = 0; i < position.count; i++) {
    let weight = 0;
    for (let j = 0; j < 4; j++) {
      if (joints.has(skinIndex.getComponent(i, j))) weight += skinWeight.getComponent(i, j);
    }
    if (weight > threshold) out.push(i);
  }
  return out;
}

function posePlayer(model, world, at, yaw, time) {
  Object.assign(world.player, at);
  model.update(world, at, yaw, 1 / 60, time);
  // Match the matrix update that precedes rendering the skinned vertices.
  model.group.updateMatrixWorld(true);
}

it('seats the loaded Hunter boots on the S2 treads in both directions', async () => {
  const { model, hunter } = await makePlayer();
  const mesh = hunter.root.getObjectByProperty('type', 'SkinnedMesh');
  const indices = ['L', 'R'].map((side) => weightedVertices(mesh,
    [hunter.bones[`foot${side}`], hunter.bones[`toe${side}`]], 0.65));
  const treads = STAIR_BODIES.find(({ id }) => id === 'S2').boxes;
  const vertex = new Vector3();
  for (const direction of [1, -1]) {
    const world = newWorld();
    world.inv.hasLantern = true;
    const at = { x: 15.1, y: direction > 0 ? -3 : 0.45, z: direction > 0 ? 16.6 : 21.42 };
    let plantedSamples = 0, swingingSamples = 0, worstPlant = 0, worstSwing = 0, soleSlip = 0;
    let prior;
    for (let frame = 0; frame < 167; frame++) {
      if (frame > 0) at.z += PLAYER.walkSpeed / 60 * direction;
      at.y = supportY(at.x, at.z, at.y)?.y ?? at.y;
      posePlayer(model, world, at, direction > 0 ? 0 : Math.PI, frame / 60);
      const plants = model.readFootPlants();
      expect(plants).not.toBeNull();
      const soles = [plants.left, plants.right];
      for (const [i, sole] of soles.entries()) {
        const prev = prior?.[i];
        if (sole.planted && prev?.planted && sole.plantId === prev.plantId) {
          soleSlip = Math.max(soleSlip, Math.hypot(sole.x - prev.x, sole.y - prev.y, sole.z - prev.z));
        }
        const tread = treads.find((box) => inArea(box, sole.x, -sole.z));
        if (sole.planted && tread) {
          expect(sole.y).toBeCloseTo(tread.h, 3);
          plantedSamples++;
        }
        for (const index of indices[i]) {
          mesh.localToWorld(mesh.getVertexPosition(index, vertex));
          const under = treads.find((box) => inArea(box, vertex.x, -vertex.z));
          if (!under) continue;
          const penetration = under.h - vertex.y;
          if (sole.planted) worstPlant = Math.max(worstPlant, penetration);
          else { worstSwing = Math.max(worstSwing, penetration); swingingSamples++; }
        }
      }
      prior = soles;
    }
    expect(plantedSamples).toBeGreaterThan(80);
    expect(swingingSamples).toBeGreaterThan(1000);
    expect(soleSlip).toBeLessThan(0.001);
    expect(worstPlant).toBeLessThan(0.012);
    expect(worstSwing).toBeLessThan(0.025);
  }
});

it('lands the skinned boots without a last-frame drop when backpedaling down S2', async () => {
  const { model, hunter } = await makePlayer();
  const world = newWorld(), player = world.player;
  Object.assign(player, { x: 15.1, y: -3, z: 16.25, floor: 'B1' });
  const hooks = { emit: () => {}, snapshot: () => {}, ui: { repair: null, board: false } };
  const treads = STAIR_BODIES.find(({ id }) => id === 'S2').boxes;
  const mesh = hunter.root.getObjectByProperty('type', 'SkinnedMesh');
  const indices = ['L', 'R'].map(side => weightedVertices(mesh, [hunter.bones[`foot${side}`], hunter.bones[`toe${side}`]], 0.65));
  const vertex = new Vector3();
  const dt = 1 / 60;
  let time = 0;
  const tick = (forward) => {
    simulate(world, { forward, strafe: 0, sprint: false, raise: false, yaw: 0, pitch: 0, actions: [] }, dt, hooks);
    posePlayer(model, world, player, 0, ++time * dt);
    const { left, right } = model.readFootPlants();
    return [left, right];
  };
  posePlayer(model, world, player, 0, 0);
  for (let n = 0; n < 167; n++) tick(1);
  expect(player.floor).toBe('1F');
  expect(player.z).toBeCloseTo(21.26, 5);
  let prior;
  for (let n = 0; n < 27; n++) prior = tick(0);
  let drop = 0, slip = 0, penetration = 0, touchdowns = 0, samples = 0;
  for (let n = 0; n < 134; n++) {
    const next = tick(-1);
    next.forEach((sole, i) => {
      const underSole = treads.find(tread => inArea(tread, sole.x, -sole.z));
      if (sole.planted && underSole) {
        expect(sole.y).toBeCloseTo(underSole.h, 3);
        const prev = prior[i];
        if (sole.plantId === prev.plantId) {
          slip = Math.max(slip, Math.hypot(sole.x - prev.x, sole.y - prev.y, sole.z - prev.z));
        } else {
          expect(prev.planted).toBe(false);
          drop = Math.max(drop, prev.y - sole.y);
          touchdowns++;
        }
      }
      if (sole.planted) return;
      for (const index of indices[i]) {
        mesh.localToWorld(mesh.getVertexPosition(index, vertex));
        const tread = treads.find(tread => inArea(tread, vertex.x, -vertex.z));
        if (!tread) continue;
        penetration = Math.max(penetration, tread.h - vertex.y);
        samples++;
      }
    });
    prior = next;
  }
  expect(player.floor).toBe('B1');
  expect(touchdowns).toBeGreaterThanOrEqual(10);
  expect(samples).toBeGreaterThan(1000);
  if (process.env.ASHEN_GAIT_METRICS) console.log(JSON.stringify({ drop, slip, penetration, touchdowns, samples }));
  expect(drop).toBeLessThan(0.09);
  expect(slip).toBeLessThan(0.001);
  expect(penetration).toBeLessThan(0.025);
});

it('keeps the trailing legs inside the Hunter cloak during the yard sprint', async () => {
  const { model, hunter } = await makePlayer();
  const mesh = hunter.root.getObjectByProperty('type', 'SkinnedMesh');
  const bones = ['upLegL', 'upLegR', 'legL', 'legR'].map((name) => hunter.bones[name]);
  const indices = weightedVertices(mesh, bones, 0.8);
  const cape = model.cloakPivot.children[0];
  const ray = new Raycaster(), origin = new Vector3(), direction = new Vector3();
  const vertex = new Vector3(), local = new Vector3();
  let sampled = 0, penetration = 0;
  // Three yard lines keep the coverage guard meaningful even when the higher
  // pelvis means fewer vertices pass behind the hem in any one frame.
  for (const x of [-0.3, 1.25, 0.55]) {
    const world = newWorld(), at = { x, y: 0, z: 3.2 };
    world.inv.hasLantern = true;
    for (let frame = 0; frame < 133; frame++) {
      if (frame > 0) at.z += (frame <= 42 ? PLAYER.walkSpeed : PLAYER.sprintSpeed) / 60;
      posePlayer(model, world, at, 0, frame / 60);
      if (frame <= 42) continue;
      direction.set(0, 0, -1).transformDirection(cape.matrixWorld);
      for (const index of indices) {
        mesh.localToWorld(mesh.getVertexPosition(index, vertex));
        cape.worldToLocal(local.copy(vertex));
        // Include the full near-cloth depth band. A filtered actor root moves
        // the cape relative to fixed boots; limiting this to >3 cm rearward
        // counted fewer rays even when the legs were safely under the cloth.
        if (local.y > -0.06 || local.y < -0.38 || Math.abs(local.x) > 0.32 || local.z < -0.04) continue;
        // Cast from behind, along the cape's local forward axis. A cloth hit
        // beyond the vertex means the skinned leg protrudes through the shell.
        ray.set(origin.copy(vertex).addScaledVector(direction, -0.7), direction);
        const hit = ray.intersectObject(cape, false)[0];
        if (!hit) continue;
        penetration = Math.max(penetration, hit.distance - 0.7);
        sampled++;
      }
    }
  }
  expect(sampled).toBeGreaterThan(100);
  expect(penetration).toBeLessThan(0.01);
});

const average = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function correlation(a, b) {
  const ma = average(a), mb = average(b);
  const ca = a.map(x => x - ma), cb = b.map(x => x - mb);
  return ca.reduce((s, x, i) => s + x * cb[i], 0) / (Math.hypot(...ca) * Math.hypot(...cb));
}

it('retargets the authored walk and sprint on the actual Hunter without crouching or sliding', async () => {
  const { model, hunter } = await makePlayer();
  const world = newWorld(), at = { x: 1.25, y: 0, z: 4.5 };
  world.inv.hasLantern = true;
  const fromClip = createMotionPose();
  const point = k => hunter.bones[k].getWorldPosition(new Vector3());
  const radians = 180 / Math.PI;
  let frame = 0;
  posePlayer(model, world, at, 0, 0);
  const neutral = point('hips').y;
  const results = [];
  for (const speed of [PLAYER.walkSpeed, PLAYER.sprintSpeed]) {
    const hips = [], flex = [], spread = [], freeArm = [], clipArm = [], bootClearance = [];
    let maxSlip = 0, maxSoleError = 0, minKneePole = Infinity, flight = 0, double = 0, last;
    for (let i = 0; i < 134; i++) {
      at.z += speed / 60;
      posePlayer(model, world, at, 0, ++frame / 60);
      const { left, right } = model.readFootPlants();
      const soles = [left, right];
      if (i < 30) continue;
      const pace = model.pace;
      sampleWatchmanMotion(fromClip, pace.clipPhase, pace.jog, pace.sprint);
      hips.push(point('hips').y);
      spread.push(point('footR').z - point('footL').z);
      freeArm.push(point('handL').z - point('armL').z);
      clipArm.push(fromClip.armL.z - fromClip.handL.z);
      if (left.planted && right.planted) double++;
      if (!left.planted && !right.planted) flight++;
      soles.forEach((sole, j) => {
        const side = j ? 'R' : 'L';
        const hip = point(`upLeg${side}`), knee = point(`leg${side}`), ankle = point(`foot${side}`);
        const axis = ankle.clone().sub(hip).normalize();
        const bend = knee.clone().sub(hip);
        bend.addScaledVector(axis, -bend.dot(axis));
        minKneePole = Math.min(minKneePole, -bend.z);
        if (!sole.planted) { bootClearance.push(sole.y); return; }
        flex.push(knee.clone().sub(hip).angleTo(ankle.sub(knee)) * radians);
        maxSoleError = Math.max(maxSoleError, Math.abs(sole.y));
        if (last?.[j].planted && last[j].plantId === sole.plantId) {
          maxSlip = Math.max(maxSlip, Math.hypot(sole.x - last[j].x, sole.y - last[j].y, sole.z - last[j].z));
        }
      });
      last = soles;
    }
    results.push({ speed, neutral, hipMean: average(hips), hipMin: Math.min(...hips),
      kneeMean: average(flex), kneeMax: Math.max(...flex), kneePole: minKneePole,
      maxSlip, maxSoleError, spreadMax: Math.max(...spread.map(Math.abs)),
      clipCorr: correlation(clipArm, freeArm), opposingCorr: correlation(spread, freeArm),
      bootClearance: Math.max(...bootClearance), flight, double });
  }
  // ASHEN_GAIT_METRICS is a text-only readback from skinned animation; no renderer.
  if (process.env.ASHEN_GAIT_METRICS) console.log(JSON.stringify(results));
  const [walk, sprint] = results;
  for (const gait of results) {
    expect(gait.hipMean).toBeGreaterThan(0.86);
    expect(gait.hipMin).toBeGreaterThan(0.73);
    expect(gait.kneeMean).toBeLessThan(40);
    expect(gait.kneePole).toBeGreaterThan(0.012);
    expect(gait.maxSlip).toBeLessThan(0.001);
    expect(gait.maxSoleError).toBeLessThan(0.001);
    expect(gait.clipCorr).toBeGreaterThan(0.88);
    expect(gait.opposingCorr).toBeGreaterThan(0.60);
  }
  expect(walk.double).toBeGreaterThan(10);
  expect(walk.flight).toBe(0);
  expect(sprint.flight).toBeGreaterThan(6);
  expect(sprint.double).toBeLessThan(6);
  expect(sprint.spreadMax).toBeGreaterThan(walk.spreadMax * 1.17);
  expect(sprint.bootClearance).toBeGreaterThan(walk.bootClearance + 0.04);
});

it('blends walk to sprint to a planted pivot and keeps the lamp attached through a moving raise', async () => {
  const { model, hunter } = await makePlayer();
  const world = newWorld(), at = { x: 1.25, y: 0, z: 4.5 };
  world.inv.hasLantern = world.lantern.on = true;
  let maxHang = 0, maxWristTick = 0, lastHand, beforeRaise, raised, rest;
  for (let i = 0; i < 245; i++) {
    const speed = i < 44 ? 1.8 : i < 114 ? 3.1 : 0;
    const yaw = i < 150 ? 0 : Math.min(Math.PI * 0.86, (i - 150) * 0.065);
    world.lantern.raised = i >= 48 && i < 143;
    at.z += speed / 60;
    posePlayer(model, world, at, yaw, i / 60);
    const hand = model.group.worldToLocal(hunter.bones.handR.getWorldPosition(new Vector3()));
    if (i < 150 && lastHand) maxWristTick = Math.max(maxWristTick, hand.distanceTo(lastHand));
    lastHand = hand;
    if (i === 47) beforeRaise = hand.y;
    if (i === 92) raised = hand.y;
    const source = model.lantern.group.localToWorld(new Vector3(0, -0.10, 0));
    expect(source.distanceTo(hunter.lampSource.value)).toBeLessThan(1e-6);
    const light = model.lanternLight.getWorldPosition(new Vector3());
    expect(light.distanceTo(source)).toBeLessThan(1e-6);
    const pitch = new Vector3(0, 1, 0).transformDirection(model.lantern.group.matrixWorld);
    maxHang = Math.max(maxHang, pitch.angleTo(new Vector3(0, 1, 0)));
    if (i === 218) rest = model.readFootPlants();
  }
  if (process.env.ASHEN_GAIT_METRICS) console.log(JSON.stringify({ maxWristTick, maxHang, lift: raised - beforeRaise }));
  expect(raised - beforeRaise).toBeGreaterThan(0.37);
  expect(maxWristTick).toBeLessThan(0.066);
  expect(maxHang).toBeLessThan(0.20);
  const final = model.readFootPlants();
  expect(final.left.planted && final.right.planted).toBe(true);
  expect(final.left.plantId).toBe(rest.left.plantId);
  expect(final.right.plantId).toBe(rest.right.plantId);
  expect(model.pace.clipWeight).toBeLessThan(0.01);
});

it('releases an overextended stance through the west jamb without marching at the solid wall', async () => {
  const { model, hunter } = await makePlayer();
  const yaw = -Math.PI / 2;
  const input = { forward: 1, strafe: 0, sprint: false, raise: false, yaw, pitch: 0, actions: [] };
  const hooks = { emit: () => {}, snapshot: () => {}, ui: { repair: null, board: false } };
  for (const z of [19, 23.9]) {
    const world = newWorld();
    world.inv.hasLantern = true;
    world.quest.boardRead = true;
    world.clock = 190;
    Object.assign(world.player, { x: -8.8, z, y: 0, floor: '1F' });
    let maxSlip = 0, minHip = Infinity, previous, stopped;
    for (let i = 0; i < 131; i++) {
      if (i > 0) simulate(world, input, 1 / 60, hooks);
      posePlayer(model, world, world.player, yaw, i / 60);
      const { left, right } = model.readFootPlants();
      const current = [left, right];
      minHip = Math.min(minHip, hunter.bones.hips.getWorldPosition(new Vector3()).y);
      current.forEach((sole, j) => {
        const last = previous?.[j];
        if (!last?.planted || !sole.planted || sole.plantId !== last.plantId) return;
        maxSlip = Math.max(maxSlip, Math.hypot(sole.x - last.x, sole.y - last.y, sole.z - last.z));
      });
      previous = current;
      if (i === 109) stopped = current;
    }
    if (process.env.ASHEN_GAIT_METRICS) console.log(JSON.stringify({ startZ: z, finalX: world.player.x, finalZ: world.player.z, maxSlip, minHip }));
    expect(maxSlip).toBeLessThan(0.001);
    expect(minHip).toBeGreaterThan(0.70);
    if (z === 19) {
      expect(world.player.z - z).toBeGreaterThan(0.31);
      expect(world.player.x).toBeLessThan(-10.5);
    } else {
      expect(world.player.moving).toBe(true);
      expect(model.pace.speed).toBeLessThan(0.035);
      expect(previous.map(({ planted, plantId }) => ({ planted, plantId })))
        .toEqual(stopped.map(({ planted, plantId }) => ({ planted, plantId })));
    }
  }
});

it('keeps the rendered Hunter connected through live key and look changes', async () => {
  const { model, hunter } = await makePlayer();
  const world = newWorld(), p = world.player;
  Object.assign(p, { x: -0.3, z: 3.2, y: 0, floor: '1F' });
  const hooks = { emit: () => {}, snapshot: () => {}, ui: { repair: null, board: false } };
  const legs = [
    [5, 1, 0, false, 0], [5, 0, 0, false, 0], [6, 1, 0, false, 0], [24, 0, 0, false, 0],
    [39, 1, 0, false, 0], [39, 1, 0, true, 0], [23, 1, 0, false, 0],
    [20, -1, 0, false, 0], [17, 0, -1, false, 0], [17, 0, 1, false, 0],
    [18, 1, 0, false, -Math.PI / 2], [50, 0, 0, false, -Math.PI / 2],
  ];
  posePlayer(model, world, p, 0, 0);
  const root = model.group.position.clone(), pelvis = new Vector3();
  let tick = 1, priorVelocity = new Vector3(), maxJump = 0, maxSlip = 0, maxHipTick = 0, samples = 0;
  let previous = model.readFootPlants(), previousY = hunter.bones.hips.getWorldPosition(pelvis).y;
  for (const [frames, forward, strafe, sprint, yaw] of legs) {
    for (let i = 0; i < frames; i++, tick++) {
      simulate(world, { forward, strafe, sprint, yaw, pitch: 0, raise: false, actions: [] }, 1 / 60, hooks);
      posePlayer(model, world, p, yaw, tick / 60);
      const next = model.group.position.clone();
      const velocity = next.clone().sub(root).multiplyScalar(60);
      maxJump = Math.max(maxJump, velocity.distanceTo(priorVelocity));
      root.copy(next); priorVelocity = velocity;
      const y = hunter.bones.hips.getWorldPosition(pelvis).y;
      maxHipTick = Math.max(maxHipTick, Math.abs(y - previousY));
      previousY = y;
      const current = model.readFootPlants();
      for (const side of ['left', 'right']) {
        const a = previous[side], b = current[side];
        if (!a.planted || !b.planted || a.plantId !== b.plantId) continue;
        samples++;
        maxSlip = Math.max(maxSlip, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      }
      previous = current;
    }
  }
  if (process.env.ASHEN_GAIT_METRICS) console.log(JSON.stringify({ maxJump, maxHipTick, maxSlip, samples }));
  expect(maxJump).toBeLessThan(1.8);
  expect(maxHipTick).toBeLessThan(0.09);
  expect(samples).toBeGreaterThan(180);
  expect(maxSlip).toBeLessThan(0.001);
  expect(previous.left.planted && previous.right.planted).toBe(true);
  expect(root.x).toBeCloseTo(p.x, 5);
  expect(root.z).toBeCloseTo(-p.z, 5);
});

it('preserves the live handheld light when a wall pushes the camera inside the coat', async () => {
  const { model } = await makePlayer();
  const w = newWorld();
  w.inv.hasLantern = true;
  Object.assign(w.lantern, { on: true, oil: 120 });
  posePlayer(model, w, { x: 4, y: -3, z: 12 }, 0, 1);
  const visible = [];
  model.setBodyVisible(false);
  model.group.traverseVisible(o => visible.push(o));
  expect(visible).toContain(model.lanternLight);
  expect(model.lanternLight.intensity).toBeGreaterThan(0);
  expect(visible.some(o => o.isMesh)).toBe(false);
  model.setBodyVisible(true);
  expect(model.asset.root.visible).toBe(true);
});
