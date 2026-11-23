import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test, vi } from 'vitest';
import { PROPS } from '../src/sim/level';
import { addReliefFooting } from '../src/render/masonry';
import { fractureRelief, reliefBlank, seatRelief } from '../src/render/relief';
import { reliefFinish } from '../src/render/reliefFinish';
import { texturesReady } from '../src/render/materials';
import { mountRodin } from '../src/render/rodinAssets';

const prop = PROPS.find(p => p.tag === 'wallStub');
const grade = prop.y0 ?? 0;

// Read the actual sculpt, but no image decoding, renderer, or GPU is required.
function loadSculpt() {
  const bytes = readFileSync(new URL('../public/models/rodin/pilgrim-relief.glb', import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const primitive = doc.meshes[0].primitives[0];
  const g = new THREE.BufferGeometry();
  const read = id => {
    const a = doc.accessors[id], v = doc.bufferViews[a.bufferView];
    const type = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    const start = bytes.byteOffset + 28 + jsonLength + v.byteOffset + (a.byteOffset ?? 0);
    return new THREE.BufferAttribute(new type(bytes.buffer, start, a.count * width).slice(), width);
  };
  for (const [key, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) {
    g.setAttribute(name, read(primitive.attributes[key]));
  }
  g.setIndex(read(primitive.indices));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
  return group;
}

const bed = () => reliefFinish(new THREE.MeshStandardMaterial(), grade);

function checkSeating(model, material) {
  const { contact, bounds } = seatRelief(model, prop);
  addReliefFooting(model, material, prop, contact);
  const heel = model.getObjectByName('relief-fracture-bed');
  const fitted = new THREE.Box3().setFromObject(model, true);
  const foot = new THREE.Box3().setFromObject(heel, true);
  // Limit above-grade silhouettes in both mount states to the same simulation
  // solid. Also keep enough height/width that it still reads as that cover.
  expect(fitted.min.x).toBeGreaterThanOrEqual(prop.x0);
  expect(fitted.max.x).toBeLessThanOrEqual(prop.x1);
  expect(fitted.min.z).toBeGreaterThanOrEqual(-prop.z1);
  expect(fitted.max.z).toBeLessThanOrEqual(-prop.z0);
  expect(fitted.max.y).toBeLessThanOrEqual(prop.h);
  expect(bounds.max.y).toBeGreaterThan(grade + .84);
  expect(bounds.max.x - bounds.min.x).toBeGreaterThan((prop.x1 - prop.x0) * .86);
  expect(bounds.min.y).toBeLessThan(grade - .02);
  expect(foot.min.y).toBeLessThan(grade - .04);
  expect(heel.material).toBe(material);
  // Vertical ray through the high end: the buried heel actually overlaps the
  // underside (not just a box close to it), while the carved face stays clear.
  const ray = new THREE.Raycaster(new THREE.Vector3(contact.x, grade + prop.h + 1, contact.z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(heel)[0];
  expect(hit.point.y - contact.y).toBeCloseTo(.028, 4);
  expect(foot.max.x - foot.min.x).toBeLessThan((prop.x1 - prop.x0) * .68);
}

test('fractures the actual backed stone without moving its carved centre or mutating the cache', () => {
  const source = loadSculpt();
  const model = source.clone(true);
  const original = source.children[0].geometry;
  const { mesh: { geometry: g } } = fractureRelief(model);
  expect(source.children[0].geometry).toBe(original);
  expect(g.index.count).toBeGreaterThan(original.index.count);
  expect(g.index.count / 3).toBeLessThan(32_000);
  const pp = original.getAttribute('position'), qq = g.getAttribute('position'), nn = original.getAttribute('normal');
  const mask = g.getAttribute('reliefCarving');
  const rear = [];
  let carved = 0, chip = 0;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
    if (z < -.14 && nn.getZ(i) < -.95) {
      rear.push(qq.getZ(i));
      expect(mask.getX(i)).toBe(0);
    }
    if (Math.abs(x) < .154 && Math.abs(y) < .68 && z > .02 && nn.getZ(i) > .7) {
      expect(qq.getX(i)).toBeCloseTo(x, 6);
      expect(qq.getY(i)).toBeCloseTo(y, 6);
      expect(qq.getZ(i)).toBeCloseTo(z, 6);
      expect(mask.getX(i)).toBeGreaterThan(.99);
      ++carved;
    }
    if (Math.abs(qq.getX(i) - x) > .035) ++chip;
  }
  expect(carved).toBeGreaterThan(500);
  expect(chip).toBeGreaterThan(90);
  expect(Math.max(...rear) - Math.min(...rear)).toBeGreaterThan(.13);
  expect(Math.max(...rear)).toBeLessThan(-.15);
  for (const attr of [qq, mask, g.getAttribute('normal'), g.getAttribute('uv')]) {
    expect(attr.array.every(Number.isFinite)).toBe(true);
  }
  checkSeating(model, bed());
});

test('the non-GLB fallback is also a single broken stone on grade', () => {
  const material = bed();
  checkSeating(reliefBlank(material), material);
});

test('failed decode or fitting keeps the complete fallback; successful prepare removes it', async () => {
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const scan = new THREE.MeshStandardMaterial(), material = bed();
    const start = () => {
      const parent = new THREE.Group(), fallback = reliefBlank(material);
      addReliefFooting(fallback, material, prop, seatRelief(fallback, prop).contact);
      return { parent, fallback };
    };
    let { parent, fallback } = start();
    const prepare = vi.fn(() => { throw new Error('bad fit'); });
    loader.mockRejectedValueOnce(new Error('missing file'));
    mountRodin(parent, 'pilgrim-relief', fallback, scan, prepare);
    const dispose = vi.spyOn(fallback.children[0].geometry, 'dispose');
    expect(parent.children).toEqual([fallback]);
    await texturesReady;
    expect(parent.children).toEqual([fallback]);
    expect(prepare).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    loader.mockResolvedValueOnce({ scene: loadSculpt() });
    ({ parent, fallback } = start());
    mountRodin(parent, 'pilgrim-relief', fallback, scan, prepare);
    await texturesReady;
    expect(prepare).toHaveBeenCalledOnce();
    expect(parent.children).toEqual([fallback]);
    expect(fallback.getObjectByName('relief-fracture-bed')).toBeDefined();
    ({ parent, fallback } = start());
    const release = fallback.children.map(mesh => vi.spyOn(mesh.geometry, 'dispose'));
    mountRodin(parent, 'pilgrim-relief', fallback, scan, model => {
      const { mesh, atlas } = fractureRelief(model);
      mesh.material = reliefFinish(scan, grade, atlas);
      addReliefFooting(model, material, prop, seatRelief(model, prop).contact);
    });
    await texturesReady;
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe('rodin-pilgrim-relief');
    expect(parent.children[0].getObjectByName('relief-fracture-bed')).toBeDefined();
    for (const spy of release) expect(spy).toHaveBeenCalledOnce();
  } finally {
    loader.mockRestore();
    warn.mockRestore();
  }
});

test('bed and carving share all three live scan inputs but not the sculpt atlas', () => {
  const scan = new THREE.MeshStandardMaterial();
  const atlas = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture() });
  const materials = [reliefFinish(scan, grade), reliefFinish(scan, grade, atlas)];
  const shaders = materials.map(material => {
    const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
    material.onBeforeCompile(shader);
    return shader;
  });
  expect(shaders[0].uniforms.uReliefScanned.value).toBe(0);
  expect(materials[0].map).toBeNull();
  expect(materials[1].map).toBe(atlas.map);
  expect(materials[0].customProgramCacheKey()).not.toBe(materials[1].customProgramCacheKey());
  scan.map = new THREE.Texture();
  scan.normalMap = new THREE.Texture();
  expect(shaders[0].uniforms.uReliefScanned.value).toBe(0);
  scan.roughnessMap = new THREE.Texture();
  for (const { uniforms } of shaders) {
    expect(uniforms.uReliefScanned.value).toBe(1);
    expect(uniforms.uReliefAlbedo.value).toBe(scan.map);
    expect(uniforms.uReliefNormal.value).toBe(scan.normalMap);
    expect(uniforms.uReliefRough.value).toBe(scan.roughnessMap);
  }
});
