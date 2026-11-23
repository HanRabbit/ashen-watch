import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AREAS, DOORS, NODES, WALLS } from '../src/sim/level';
import { GATEHOUSE_LIGHTS } from '../src/render/gatehouseWindows';
import { mountGatehouseRoof } from '../src/render/gatehouseRoof';
import { texturesReady } from '../src/render/materials';

const file = readFileSync(new URL('../public/models/rodin/gatehouse-roof.glb', import.meta.url));
const jsonSize = file.readUInt32LE(12);
const doc = JSON.parse(file.toString('utf8', 20, 20 + jsonSize));
const binaryStart = 28 + jsonSize;

function read(id) {
  const acc = doc.accessors[id];
  const view = doc.bufferViews[acc.bufferView];
  const types = { 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array };
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[acc.type];
  const data = new types[acc.componentType](file.buffer, file.byteOffset + binaryStart + view.byteOffset, acc.count*width);
  return new THREE.BufferAttribute(data, width, acc.normalized);
}

function model() {
  const group = new THREE.Group();
  const mats = doc.materials.map(() => new THREE.MeshStandardMaterial({
    map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture(), vertexColors: true,
  }));
  for (const node of doc.nodes) {
    const [p] = doc.meshes[node.mesh].primitives;
    const g = new THREE.BufferGeometry();
    for (const [k, v] of Object.entries({ POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', COLOR_0: 'color' })) {
      g.setAttribute(v, read(p.attributes[k]));
    }
    g.setIndex(read(p.indices));
    const mesh = new THREE.Mesh(g, mats[p.material]);
    mesh.name = node.name;
    group.add(mesh);
  }
  return group;
}

function hit(group, from, direction) {
  const ray = new THREE.Raycaster(new THREE.Vector3(from[0], from[1], -from[2]),
    new THREE.Vector3(direction[0], direction[1], -direction[2]));
  return ray.intersectObject(group)[0]?.point;
}

function jpegSize(image) {
  const view = doc.bufferViews[image.bufferView];
  const offset = binaryStart + view.byteOffset;
  expect(file.readUInt16BE(offset)).toBe(0xffd8);
  for (let i = offset+2; i < offset+view.byteLength;) {
    const marker = file.readUInt16BE(i);
    if (marker === 0xffc0) return [file.readUInt16BE(i+7), file.readUInt16BE(i+5)];
    i += 2 + file.readUInt16BE(i+2);
  }
  throw new Error(`No JPEG frame for ${image.name}`);
}

test('registered roof is one static indexed GLB with bounded draws, maps and geometry', () => {
  expect(file.toString('utf8', 0, 4)).toBe('glTF');
  expect(file.readUInt32LE(8)).toBe(file.length);
  expect(file.length).toBeLessThan(1_550_000);
  expect(doc.scenes[0].nodes).toEqual([0, 1, 2]);
  expect(doc.nodes.map(node => node.name)).toEqual(['GatehouseSlate', 'GatehouseOuterOak', 'GatehouseSoffit']);
  expect(doc.materials).toHaveLength(2);
  expect(doc.images.map(jpegSize)).toEqual([[128, 128], [128, 128], [128, 128], [256, 256], [256, 256], [256, 256]]);
  for (const [i, mat] of doc.materials.entries()) {
    expect(mat.pbrMetallicRoughness).toMatchObject({ metallicFactor: 0, baseColorTexture: { index: 3*i },
      metallicRoughnessTexture: { index: 3*i+2 } });
    expect(mat.normalTexture.index).toBe(3*i+1);
  }
  let tris = 0;
  for (const { primitives } of doc.meshes) {
    expect(primitives).toHaveLength(1);
    const [p] = primitives;
    const indices = read(p.indices);
    const normal = read(p.attributes.NORMAL), positions = read(p.attributes.POSITION);
    expect(indices.array).toBeInstanceOf(Uint16Array);
    expect(read(p.attributes.COLOR_0)).toMatchObject({count: positions.count, normalized: true, itemSize: 3});
    expect(read(p.attributes.TEXCOORD_0).count).toBe(positions.count);
    const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), n = a.clone();
    for (let i = 0; i < positions.count; i++) {
      if (!Number.isFinite(a.fromBufferAttribute(positions, i).lengthSq()) || Math.abs(n.fromBufferAttribute(normal, i).length() - 1) > .001) {
        throw new Error(`Bad packed vertex ${i}`);
      }
    }
    for (let i = 0; i < indices.count; i += 3) {
      a.fromBufferAttribute(positions, indices.getX(i));
      b.fromBufferAttribute(positions, indices.getX(i+1));
      c.fromBufferAttribute(positions, indices.getX(i+2));
      if (!(b.sub(a).cross(c.sub(a)).lengthSq() > 0)) throw new Error(`Degenerate triangle ${i/3}`);
    }
    tris += indices.count / 3;
  }
  expect(tris).toBeGreaterThan(15_000);
  expect(tris).toBeLessThanOrEqual(20_000);
});

test('courtyard truss faces the return route, the eaves clear the walls, and roof never intrudes into apertures', () => {
  const group = model();
  const bounds = new THREE.Box3().setFromObject(group, true);
  const side = WALLS.filter(w => w.tag === 'gh');
  const xMax = Math.max(AREAS.gatehouse.x1, ...side.map(w => w.x1));
  const backZ = Math.min(AREAS.gatehouse.z0, ...side.map(w => w.z0));
  expect(bounds.max.x - xMax).toBeGreaterThan(.4);
  expect(bounds.max.z + backZ).toBeGreaterThan(.4);
  const oak = group.children[1];
  const toward = hit(oak, [0, 5.41, 2.2], [0, 0, -1]);
  expect(-toward.z).toBeGreaterThan(DOORS.gatehouse.box.z1 + .2);
  expect(-toward.z).toBeLessThan(.99);
  const back = hit(oak, [0, 5.41, -10], [0, 0, 1]);
  expect(-back.z).toBeLessThan(-8.85);
  expect(NODES.find(n => n.id === 'c_s').z).toBeGreaterThan(-bounds.min.z);
  expect(bounds.min.y).toBeGreaterThan(Math.max(DOORS.gatehouse.box.h, ...GATEHOUSE_LIGHTS.map(w => w.bottom+w.peak)) + .5);
});

test('weather skin sheds towards both long eaves and courtyard apron, above the continuous pitched room liner', () => {
  const group = model(), soffit = group.children[2];
  const above = (x, z) => hit(group, [x, 7, z], [0, -1, 0])?.y;
  for (const z of [-8.11, -6.3, -4.4, -3.01]) {
    for (const s of [-1, 1]) {
      const heights = [0.04, .9, 1.9, 2.72, 3.49, 3.88].map(x => above(s*x, z));
      expect(heights.slice(1).every((h, i) => h < heights[i] - .06)).toBe(true);
    }
  }
  for (const x of [-3.25, -2.52, 2.52, 3.25]) {
    const apron = [-1.11, -.74, -.39, .04, .42].map(z => above(x, z));
    expect(apron.slice(1).every((h, i) => h <= apron[i]+.025)).toBe(true);
    expect(apron.at(-1)).toBeGreaterThan(4.2);
  }
  for (const z of [-8.06, -6.0, -4.4, -3.4, -2.25, -1.43, -.63, -.11, .19]) {
    for (const x of [-3.03, -2.72, -1.64, -.37, .04, .73, 1.6, 2.6, 3.03]) {
      const y = hit(soffit, [x, 3.13, z], [0, 1, 0])?.y;
      const oldLid = 4.62 +(1.95-Math.abs(x))*2/3.9 -.08*Math.hypot(3.9, 2)/3.9;
      expect(y).toBeGreaterThan(oldLid - (z < -3.1 ? .09 : .49));
      expect(y).toBeLessThan(oldLid + .01);
      expect(above(x, z) - y).toBeGreaterThan(.08);
    }
  }
  // No seam exposes the old 28 cm purlin, including where it crosses the new saddle.
  for (const z of [-8.36, -7.4, -5.7, -4.4, -3.01, -2.7, -2.38, -1.94, -.3, .32]) {
    for (const x of [-.14, 0, .14]) expect(above(x, z)).toBeGreaterThan(5.676);
  }
  // A room-facing shadow surface seals both the wall head and the gable caps.
  expect(hit(soffit, [0, 4.5, -3.9], [0, 0, 1]).z).toBeCloseTo(-.29, 3);
  expect(hit(soffit, [0, 4.5, -3.9], [0, 0, -1]).z).toBeCloseTo(8.25, 3);
  expect(hit(soffit, [0, 3.64, -4.4], [1, 0, 0]).x).toBeCloseTo(3.52, 3);
});

test('only a complete roof replaces the authored shell, with no frame lacking a roof', async () => {
  const parent = new THREE.Group();
  const fallback = () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    return group;
  };
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    load.mockRejectedValueOnce(new Error('missing GLB')).mockResolvedValueOnce({ scene: new THREE.Group() })
      .mockResolvedValueOnce({ scene: model() });
    for (let i = 0; i < 2; i++) {
      const old = fallback();
      mountGatehouseRoof(parent, old);
      await texturesReady;
      expect(parent.children).toEqual([old]);
      old.removeFromParent();
    }
    const old = fallback();
    const dispose = vi.spyOn(old.children[0].geometry, 'dispose');
    mountGatehouseRoof(parent, old);
    expect(parent.children).toEqual([old]);
    await texturesReady;
    expect(parent.children.map(x => x.name)).toEqual(['rodin-gatehouse-roof']);
    expect(parent.children[0].children.every(mesh => mesh.isMesh && mesh.castShadow && mesh.receiveShadow)).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('models/rodin/gatehouse-roof.glb');
  } finally {
    load.mockRestore();
    warn.mockRestore();
  }
});
