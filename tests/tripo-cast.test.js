import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Box3, MeshStandardMaterial, Quaternion, Texture, Vector3 } from 'three';
import { PLAYER } from '../src/config';
import { inArea, STAIR_BODIES, supportY } from '../src/sim/level';
import { newWorld } from '../src/sim/state';

vi.mock('../src/render/materials', async (original) => ({ ...await original(), grimeTexture: () => new Texture() }));

const ROOT = 'models/characters/';
const HUNTER = ROOT + 'hunter.glb';
const REAPER = ROOT + 'reaper.glb';
const WATCHKEEPER = ROOT + 'tripo-watchkeeper.glb';
const WRAITH = ROOT + 'tripo-ash-wraith.fbx';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Only fake the browser boundary: both loaders parse the real, unmodified
// files, including their skeletons, clips, skin weights and material links.
async function installAssets({ search = '', missing = () => false, imageGate } = {}) {
  vi.resetModules();
  const files = [], jpgs = [];
  const BrowserRequest = Request;
  vi.stubGlobal('location', { search });
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('Request', class extends BrowserRequest {
    constructor(url, init) { super(new URL(url, 'http://assets.test/build/'), init); }
  });
  vi.stubGlobal('ProgressEvent', Event);
  vi.stubGlobal('fetch', async (request) => {
    const file = new URL(request.url).pathname.replace('/build/', '');
    files.push(file);
    if (missing(file)) return new Response(null, { status: 404 });
    return new Response(readFileSync(new URL(`../public/${file}`, import.meta.url)));
  });
  vi.stubGlobal('document', { createElementNS(_namespace, tag) {
    expect(tag).toBe('img');
    return new class extends EventTarget {
      set src(url) {
        if (/\.jpg$/i.test(url)) {
          jpgs.push(url);
          // Reject incorrect paths, rather than making the FBX succeed with
          // nonexistent files. Chrome's image decoding is not under test.
          const ok = !missing(url) && readFileSync(new URL(`../public/${url}`, import.meta.url)).readUInt16BE(0) === 0xffd8;
          void (imageGate?.promise ?? Promise.resolve()).then(() => this.dispatchEvent(new Event(ok ? 'load' : 'error')));
        } else {
          queueMicrotask(() => this.dispatchEvent(new Event('load')));
        }
      }
    }();
  } });
  return { ...(await import('../src/render/characterAssets')), files, jpgs };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('defaults to the reviewed cast and starts only the requested role', async () => {
  const { loadCharacterAssets, files, jpgs } = await installAssets({ search: '?cast=unknown' });
  const first = loadCharacterAssets('hunter');
  expect(loadCharacterAssets('hunter')).toBe(first);
  const { hunter } = await first;
  expect(hunter.bones.handR.name).toMatch(/RightHand_/);
  expect(files).toEqual([HUNTER]);
  const { reaper } = await loadCharacterAssets('reaper');
  expect(reaper.body.isMesh).toBe(true);
  expect(reaper.animate).toBeUndefined();
  expect(files).toEqual([HUNTER, REAPER]);
  expect(jpgs).toEqual([]);
});

it('loads the Tripo GLB independently while both real FBX JPEGs are pending', async () => {
  const imageGate = deferred();
  const { loadCharacterAssets, files, jpgs } = await installAssets({ search: '?cast=tripo', imageGate });
  const grayPromise = loadCharacterAssets('reaper');
  let grayReady = false;
  void grayPromise.then(() => { grayReady = true; });
  const v = new Vector3();
  try {
    await vi.waitFor(() => expect(jpgs).toHaveLength(2));
    expect(files).toEqual([WRAITH]);
    const { hunter } = await loadCharacterAssets('hunter');
    expect(grayReady).toBe(false);
    expect(files).toEqual([WRAITH, WATCHKEEPER]);
    const mesh = hunter.root.getObjectByProperty('isSkinnedMesh', true);
    expect(mesh.geometry.index.count / 3).toBe(56814);
    expect(mesh.skeleton.bones).toHaveLength(41);
    expect(mesh.material.map.isTexture).toBe(true);
    const shader = { uniforms: {}, fragmentShader: '#include <common>\n#include <lights_fragment_begin>' };
    mesh.material.onBeforeCompile(shader);
    expect(shader.uniforms.uWatchmanLamp).toBe(hunter.lampSource);
    expect(shader.fragmentShader).toContain('wearDist');
    expect(hunter.bones.handR.name).toBe('R_Hand');
    expect(hunter.bones.handR.children.some(({ name }) => /Middle/.test(name))).toBe(false);
    expect(hunter.gripLocal.y).toBeCloseTo(0.06792, 4);
    const grip = hunter.bones.handR.localToWorld(hunter.gripLocal.clone());
    expect(grip.distanceTo(hunter.bones.handR.getWorldPosition(v))).toBeCloseTo(0.122, 3);
    const bounds = new Box3().setFromObject(hunter.root);
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.max.y).toBeCloseTo(1.75, 5);
    for (const [i, side] of ['L', 'R'].entries()) {
      const ankle = hunter.bones[`foot${side}`];
      expect(hunter.bones[`toe${side}`].getWorldPosition(v).z).toBeLessThan(ankle.getWorldPosition(new Vector3()).z);
      expect(Math.abs(ankle.localToWorld(hunter.feet[i].soleLocal.clone()).y)).toBeLessThan(0.012);
    }
    expect(hunter.idle.name).toBe('standing_relax');
    const hip = hunter.bones.hips, rest = hip.position.clone();
    const root = mesh.skeleton.getBoneByName('Root'), rootRest = root.position.clone();
    hunter.mixer.clipAction(hunter.idle).play();
    for (let i = 0; i < 80; i++) {
      hunter.mixer.update(0.25);
      expect(Math.hypot(hip.position.x - rest.x, hip.position.z - rest.z)).toBeLessThan(1e-6);
      expect(root.position.distanceTo(rootRest)).toBeLessThan(1e-6);
    }
  } finally {
    imageGate.resolve();
  }
  const { reaper } = await grayPromise;
  expect(jpgs).toHaveLength(2);
  expect(jpgs.filter((url) => url.endsWith('_BaseColor.jpg'))).toHaveLength(1);
  expect(jpgs.filter((url) => url.endsWith('_Normal_Bake.jpg'))).toHaveLength(1);
  expect(reaper.body.material.map.isTexture).toBe(true);
  expect(reaper.body.material.normalMap.isTexture).toBe(true);
  expect(reaper.body.geometry.attributes.position.count / 3).toBe(19640);
  expect(reaper.body.skeleton.bones).toHaveLength(41);
  expect(reaper.body.castShadow).toBe(true);
  const bounds = new Box3().setFromObject(reaper.root);
  expect(bounds.min.y).toBeCloseTo(0, 5);
  expect(bounds.max.y).toBeCloseTo(2.15, 5);
  const scene = reaper.root.children[0].children[0];
  expect(scene.animations.map(({ name }) => name)).toEqual(['angry_03.001', 'angry_02.001', 'chop.001']);

  const bone = (name) => reaper.body.skeleton.getBoneByName(name);
  const local = (joint) => reaper.root.worldToLocal(joint.getWorldPosition(new Vector3()));
  const hip = bone('Hip'), root = bone('Root'), chest = bone('Spine02');
  const hipRest = local(hip), rootRest = local(root), chestRest = chest.quaternion.clone();
  const hands = ['L_Hand', 'R_Hand'].map(bone), down = hands.map(local);
  let breath = 0, wristDrift = 0;
  for (let i = 0; i < 480; i++) {
    reaper.root.position.set(3, 1, -5);
    reaper.root.rotation.y = i / 180;
    reaper.animate(1 / 60);
    wristDrift = Math.max(wristDrift, ...hands.map((hand, j) => local(hand).distanceTo(down[j])));
    breath = Math.max(breath, chest.quaternion.angleTo(chestRest));
    expect(local(hip).distanceTo(hipRest)).toBeLessThan(1e-6);
    expect(local(root).distanceTo(rootRest)).toBeLessThan(1e-6);
  }
  expect(wristDrift).toBeLessThan(0.009);
  expect(breath).toBeGreaterThan(0.024);
  expect(breath).toBeLessThan(0.026);
  const elbows = ['L_Forearm', 'R_Forearm'].map(bone);
  const previous = elbows.map((joint) => joint.getWorldQuaternion(new Quaternion()));
  let maxElbowStep = 0;
  for (let i = 0; i <= 60; i++) {
    reaper.cloth.uArmRaise.value = i / 60 * 1.35;
    reaper.animate(1 / 60);
    for (const [j, joint] of elbows.entries()) {
      const q = joint.getWorldQuaternion(new Quaternion());
      maxElbowStep = Math.max(maxElbowStep, q.angleTo(previous[j]));
      previous[j].copy(q);
    }
  }
  expect(maxElbowStep).toBeLessThan(0.3);
  expect(local(hands[0]).distanceTo(new Vector3(-0.22, 1.52, -0.6))).toBeLessThan(0.001);
  expect(local(hands[1]).distanceTo(new Vector3(0.22, 1.52, -0.6))).toBeLessThan(0.001);
});

it('falls back per role when a Tripo JPEG or both GLBs are unavailable', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { loadCharacterAssets, files, jpgs } = await installAssets({
    search: '?cast=tripo', missing: (file) => file.endsWith('_Normal_Bake.jpg') || file.endsWith('.glb') && file !== REAPER,
  });
  const [{ hunter }, { reaper }] = await Promise.all([loadCharacterAssets('hunter'), loadCharacterAssets('reaper')]);
  expect(hunter).toBeNull(); // player keeps its procedural model
  expect(reaper.body.isMesh).toBe(true);
  expect(reaper.animate).toBeUndefined(); // legacy GLB attached instead of the untextured Tripo
  expect(files.toSorted()).toEqual([HUNTER, REAPER, WATCHKEEPER, WRAITH].toSorted());
  expect(jpgs).toHaveLength(2);
});

it('uses the actual Tripo palms and boots with the current PlayerModel IK on S2', async () => {
  const { loadCharacterAssets, files } = await installAssets({
    search: '?cast=tripo', missing: (file) => /\/(fabric|leather)_/.test(file),
  });
  const { PlayerModel } = await import('../src/render/characters');
  const material = new MeshStandardMaterial();
  const model = new PlayerModel({ iron: material, paper: material }, new Texture());
  const { hunter } = await loadCharacterAssets('hunter');
  await vi.waitFor(() => expect(hunter.root.parent).toBe(model.group));
  expect(files).toEqual([WATCHKEEPER]);
  const grip = model.group.getObjectByName('watchman-lantern-grip');
  const treads = STAIR_BODIES.find(({ id }) => id === 'S2').boxes;
  const palm = new Vector3(), ring = new Vector3(), light = new Vector3();
  for (const direction of [1, -1]) {
    const world = newWorld();
    world.inv.hasLantern = world.lantern.on = true;
    world.lantern.oil = 100;
    const at = { x: 15.1, y: direction > 0 ? -3 : 0.45, z: direction > 0 ? 16.6 : 21.42 };
    let samples = 0, worstError = 0, slip = 0, previous;
    for (let frame = 0; frame < 167; frame++) {
      if (frame) at.z += direction * PLAYER.walkSpeed / 60;
      at.y = supportY(at.x, at.z, at.y)?.y ?? at.y;
      Object.assign(world.player, at);
      world.lantern.raised = frame >= 60;
      model.update(world, at, direction > 0 ? 0 : Math.PI, 1 / 60, frame / 60);
      const { left, right } = model.readFootPlants();
      for (const [i, sole] of [left, right].entries()) {
        if (!sole.planted) continue;
        const prev = previous?.[i];
        if (prev?.planted && prev.plantId === sole.plantId) {
          slip = Math.max(slip, Math.hypot(prev.x - sole.x, prev.y - sole.y, prev.z - sole.z));
        }
        const tread = treads.find((box) => inArea(box, sole.x, -sole.z));
        if (!tread) continue;
        worstError = Math.max(worstError, Math.abs(sole.y - tread.h));
        samples++;
      }
      previous = [left, right];
      hunter.bones.handR.localToWorld(palm.copy(hunter.gripLocal));
      expect(grip.getWorldPosition(ring).distanceTo(palm)).toBeLessThan(1e-6);
      expect(model.lanternLight.getWorldPosition(light).distanceTo(hunter.lampSource.value)).toBeLessThan(1e-6);
    }
    expect(samples).toBeGreaterThan(80);
    expect(worstError).toBeLessThan(0.004);
    expect(slip).toBeLessThan(0.001);
  }
});
