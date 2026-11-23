import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, expect, test, vi } from 'vitest';

const glb = readFileSync(new URL('../public/models/rodin/oil-flask.glb', import.meta.url));
const jsonLength = glb.readUInt32LE(12);
const doc = JSON.parse(glb.subarray(20, 20 + jsonLength));
const bin = 28 + jsonLength;
const prim = doc.meshes[0].primitives[0];
const { POSITION, NORMAL, TEXCOORD_0 } = prim.attributes;

function bufferView(i) {
  const { byteOffset, byteLength } = doc.bufferViews[i];
  return glb.subarray(bin + byteOffset, bin + byteOffset + byteLength);
}

function read(i, width, Type) {
  const a = doc.accessors[i];
  const data = bufferView(a.bufferView);
  return new Type(data.buffer, data.byteOffset + (a.byteOffset ?? 0), width * a.count);
}

function dimensions(bytes, mime) {
  if (mime === 'image/png') return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  expect(mime).toBe('image/jpeg');
  expect(bytes.readUInt16BE(0)).toBe(0xffd8);
  for (let i = 2; i < bytes.length;) {
    const marker = bytes.readUInt16BE(i);
    if (marker === 0xffc0 || marker === 0xffc2) return [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  throw new Error('Missing JPEG frame');
}

// The clearcoat/roughness atlas is a lossless, un-interlaced RGB8 PNG.
function readAtlas(bytes) {
  expect([...bytes.subarray(24, 29)]).toEqual([8, 2, 0, 0, 0]);
  const [w, h] = dimensions(bytes, 'image/png');
  const chunks = [];
  for (let i = 8; i < bytes.length;) {
    const size = bytes.readUInt32BE(i);
    if (bytes.toString('ascii', i + 4, i + 8) === 'IDAT') chunks.push(bytes.subarray(i + 8, i + 8 + size));
    i += size + 12;
  }
  const rows = inflateSync(Buffer.concat(chunks)), stride = w * 3;
  const rgb = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const offset = y * (stride + 1), filter = rows[offset];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 3 ? rgb[i - 3] : 0;
      const b = y > 0 ? rgb[i - stride] : 0;
      const c = x >= 3 && y > 0 ? rgb[i - stride - 3] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      rgb[i] = rows[offset + x + 1] + predictor;
    }
  }
  return (u, v) => rgb.subarray((Math.floor(v * h) * w + Math.floor(u * w)) * 3).subarray(0, 3);
}

const pos = read(POSITION, 3, Float32Array);
const normal = read(NORMAL, 3, Float32Array);
const uv = read(TEXCOORD_0, 2, Float32Array);
const indices = read(prim.indices, 1, Uint16Array);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('packed flask is one web-sized, table-fitted primitive with intact UVs and normals', () => {
  expect(glb.length).toBeLessThanOrEqual(1_000_000);
  expect(glb.toString('ascii', 0, 4)).toBe('glTF');
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.length);
  expect(glb.readUInt32LE(bin - 8) + bin).toBe(glb.length);
  expect(doc.scenes).toEqual([{ nodes: [0] }]);
  expect(doc.nodes).toEqual([{ mesh: 0, name: expect.any(String) }]);
  expect(doc.meshes).toHaveLength(1);
  expect(doc.meshes[0].primitives).toHaveLength(1);
  expect(indices.length / 3).toBe(6000);
  const n = pos.length / 3;
  expect(normal.length / 3).toBe(n);
  expect(uv.length / 2).toBe(n);
  expect(indices.every(i => i < n)).toBe(true);
  expect(pos.every(Number.isFinite)).toBe(true);
  expect(uv.every(v => v > 0 && v < 1)).toBe(true);
  for (let i = 0; i < normal.length; i += 3) {
    const len = Math.hypot(normal[i], normal[i + 1], normal[i + 2]);
    if (Math.abs(len - 1) > 1e-4 || !Number.isFinite(len)) throw new Error(`Invalid normal ${i / 3}`);
  }
  const bounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(pos, 3));
  expect(bounds.min.toArray()).toEqual(doc.accessors[POSITION].min);
  expect(bounds.max.toArray()).toEqual(doc.accessors[POSITION].max);
  expect(bounds.min.y).toBe(0);
  expect(bounds.max.y).toBeCloseTo(0.26, 6);
  expect(bounds.max.x).toBeCloseTo(0.096, 5);
  expect(bounds.max.z).toBeCloseTo(0.096, 4);
  expect(bounds.getCenter(new THREE.Vector3()).toArray()).toEqual([0, bounds.max.y / 2, 0]);
});

test('one opaque, nonmetallic PBR material masks the glass sheen away from hemp and cork', () => {
  expect(doc.materials).toHaveLength(1);
  const material = doc.materials[prim.material];
  expect(material.pbrMetallicRoughness.metallicFactor).toBe(0);
  expect(material.alphaMode ?? 'OPAQUE').toBe('OPAQUE');
  expect(material.emissiveFactor ?? [0, 0, 0]).toEqual([0, 0, 0]);
  expect(material.emissiveTexture).toBeUndefined();
  expect(doc.extensionsUsed).toEqual(['KHR_materials_clearcoat']);
  expect(doc.images).toHaveLength(3);
  for (const image of doc.images) expect(dimensions(bufferView(image.bufferView), image.mimeType)).toEqual([512, 512]);
  const mr = material.pbrMetallicRoughness.metallicRoughnessTexture.index;
  expect(material.extensions.KHR_materials_clearcoat.clearcoatTexture.index).toBe(mr);
  const atlas = readAtlas(bufferView(doc.images[doc.textures[mr].source].bufferView));
  let wet = 0, matte = 0, cork = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.subarray(i, i + 3);
    const average = (arr, stride, axis) => (arr[a * stride + axis] + arr[b * stride + axis] + arr[c * stride + axis]) / 3;
    const [r, g, blue] = atlas(average(uv, 2, 0), average(uv, 2, 1));
    if (blue !== 0) throw new Error('Nonzero metalness in the packed atlas');
    const y = average(pos, 3, 1);
    if (y > 0.24) {
      cork++;
      if (r !== 0 || g < 195) throw new Error('The stopper should remain uncoated and matte');
    }
    if (y < 0.22 && r >= 160 && g <= 165) wet++;
    if (y < 0.22 && r === 0 && g >= 200) matte++;
  }
  expect(cork).toBeGreaterThan(60);
  expect(wet).toBeGreaterThan(500);
  expect(matte).toBeGreaterThan(500);
});

function placement(mountOilFlask, yaw) {
  const parent = new THREE.Group();
  const fallback = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  fallback.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  const dispose = vi.spyOn(geometry, 'dispose');
  mountOilFlask(parent, fallback, yaw);
  return { parent, fallback, dispose, yaw };
}

async function freshLoader() {
  vi.resetModules();
  const ready = await import('../src/render/materials');
  const { mountOilFlask } = await import('../src/render/oilFlaskAsset');
  return { ready, place: yaw => placement(mountOilFlask, yaw) };
}

test('rejected or incomplete loads retain the legacy meshes and can retry in a later scene', async () => {
  const { ready, place } = await freshLoader();
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
    .mockRejectedValueOnce(new Error('missing GLB'))
    .mockResolvedValueOnce({ scene: new THREE.Group() });
  const a = place(0), b = place(Math.PI);
  await ready.texturesReady;
  expect(load).toHaveBeenCalledTimes(1);
  const retry = place(0);
  await ready.texturesReady;
  expect(load).toHaveBeenCalledTimes(2);
  expect(log).toHaveBeenCalledTimes(2);
  for (const { parent, fallback, dispose } of [a, b, retry]) {
    expect(parent.children).toEqual([fallback]);
    expect(dispose).not.toHaveBeenCalled();
  }
});

test('Three parses the shipped GLB once; swaps three children without changing their parent state', async () => {
  const { ready, place } = await freshLoader();
  vi.stubGlobal('self', globalThis);
  // Node lacks browser image decoding; parse the embedded headers while using the real GLTFLoader.
  const createImage = vi.fn(async blob => {
    const [width, height] = dimensions(Buffer.from(await blob.arrayBuffer()), blob.type);
    return { width, height };
  });
  vi.stubGlobal('createImageBitmap', createImage);
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(function () {
    return this.parseAsync(Uint8Array.from(glb).buffer, '');
  });
  const placements = [place(Math.PI), place(0), place(Math.PI / 2)];
  const hidden = placements[2].parent;
  const anchor = new THREE.Vector3(14.8, -2.14, -13);
  hidden.position.copy(anchor);
  hidden.visible = false;
  placements[0].parent.scale.setScalar(0.8);
  for (const { parent, fallback } of placements) expect(parent.children).toEqual([fallback]);
  await ready.texturesReady;
  expect(load).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/models\/rodin\/oil-flask\.glb$/));
  expect(createImage).toHaveBeenCalledTimes(3);
  const [shelf, crate, cellar] = placements.map(({ parent, dispose, yaw }) => {
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(1);
    const mesh = parent.children[0];
    expect(mesh.name).toBe('rodin-oil-flask');
    expect(mesh.rotation.y).toBe(yaw);
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    expect(mesh.material.clearcoatMap).toBe(mesh.material.roughnessMap);
    expect(mesh.material.normalMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(mesh.material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    return mesh;
  });
  expect(new Set([shelf, crate, cellar]).size).toBe(3);
  expect(shelf.geometry).toBe(cellar.geometry);
  expect(shelf.material).toBe(crate.material);
  expect(crate.material).toBe(cellar.material);
  expect(hidden.visible).toBe(false);
  expect(hidden.position).toEqual(anchor);
  expect(new THREE.Box3().setFromObject(hidden).min.y).toBeCloseTo(anchor.y, 6);
  expect(new THREE.Box3().setFromObject(placements[0].parent).max.y).toBeCloseTo(0.208, 6);
});
