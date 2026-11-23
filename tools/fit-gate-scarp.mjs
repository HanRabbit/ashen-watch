// Offline post-pack step: recover the terrain-matched Rodin core, dress it with
// failed masonry, then replace the source atlas with site-matched PBR scans.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { fitGateScarp } from './gateScarpFit.ts';
import { dressGateCollapse } from './gateCollapse.mjs';
import { scarpStoneAtlas } from './scarpStoneAtlas.mjs';

const [, , input, output] = process.argv;
if (!input || !output) throw new Error('Usage: node tools/fit-gate-scarp.mjs <packed.glb> <fitted.glb>');
const data = readFileSync(input);
const jsonLength = data.readUInt32LE(12);
const doc = JSON.parse(data.toString('utf8', 20, 20 + jsonLength));
const bin = data.subarray(28 + jsonLength);
const primitive = doc.meshes[0]?.primitives[0];
const node = doc.nodes[0];
if (doc.meshes.length !== 1 || doc.meshes[0].primitives.length !== 1 || doc.nodes.length !== 1 ||
    node.mesh !== 0 || node.matrix || node.rotation || node.scale || node.translation || node.children ||
    !primitive || !doc.images?.every(image => image.bufferView !== undefined)) {
  throw new Error('Unexpected packed gate-scarp GLB layout');
}

function readAttribute(index, Type, width) {
  const accessor = doc.accessors[index], view = doc.bufferViews[accessor.bufferView];
  const componentType = Type === Float32Array ? 5126 : Type === Uint16Array ? 5123 : 5125;
  if (accessor.componentType !== componentType || accessor.sparse || view.byteStride || view.buffer !== 0) {
    throw new Error(`Unexpected accessor layout for gate-scarp (${index})`);
  }
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return new THREE.BufferAttribute(new Type(bin.buffer, start, accessor.count * width), width);
}
const original = new THREE.BufferGeometry();
original.setAttribute('position', readAttribute(primitive.attributes.POSITION, Float32Array, 3));
original.setAttribute('uv', readAttribute(primitive.attributes.TEXCOORD_0, Float32Array, 2));
const indexType = doc.accessors[primitive.indices].componentType === 5123 ? Uint16Array : Uint32Array;
original.setIndex(readAttribute(primitive.indices, indexType, 1));
const fitted = await dressGateCollapse(fitGateScarp(original));

const atlas = scarpStoneAtlas();
const imageData = [atlas.nor, atlas.diff, atlas.rough];
doc.images.forEach((image,i)=>{image.name=['fallen-stone-normal','fallen-stone-albedo','fallen-stone-roughness'][i];});
const material = doc.materials[primitive.material];
material.name = 'Weathered curtain / shattered lime core';
material.pbrMetallicRoughness.metallicFactor = 0;
material.pbrMetallicRoughness.roughnessFactor = 1;
material.normalTexture.scale = .84;
doc.meshes[0].name='Gatehouse Curtain Collapse';
doc.accessors = [];
doc.bufferViews = [];
const chunks = [];
let offset = 0;
function append(bytes, target) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) chunks.push(Buffer.alloc(pad));
  offset += pad;
  const i = doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target }) - 1;
  chunks.push(bytes);
  offset += bytes.length;
  return i;
}
function storeAttribute(attribute, bounds, normalized = false) {
  const { array, count, itemSize } = attribute;
  const bufferView = append(Buffer.from(array.buffer, array.byteOffset, array.byteLength), itemSize === 1 ? 34963 : 34962);
  const type = ['SCALAR', 'VEC2', 'VEC3', 'VEC4'][itemSize - 1];
  const componentType = array instanceof Float32Array ? 5126 : array instanceof Uint16Array ? 5123 : array instanceof Uint8Array ? 5121 : 5125;
  return doc.accessors.push({ bufferView, componentType, count, type, ...(normalized ? { normalized: true } : {}), ...bounds }) - 1;
}
// Pack vertex tint and atlas coordinates at native glTF normalized precision.
// Float32 world positions still meet the collision silhouette tolerance.
const quantize = (name, T, scale, width) => {
  const {array,itemSize,count} = fitted.getAttribute(name);
  // 4-byte alignment per vertex in glTF; RGB vertex tint uses an implicit opaque alpha.
  const packed = new T(count*(width ?? itemSize));
  if (width) packed.fill(scale);
  for (let i=0;i<count;i++) for (let j=0;j<itemSize;j++)
    packed[i*(width ?? itemSize)+j]=Math.round(THREE.MathUtils.clamp(array[i*itemSize+j],0,1)*scale);
  return new THREE.BufferAttribute(packed,width ?? itemSize);
};
primitive.attributes = {
  POSITION: storeAttribute(fitted.getAttribute('position'), { min: fitted.boundingBox.min.toArray(), max: fitted.boundingBox.max.toArray() }),
  NORMAL: storeAttribute(fitted.getAttribute('normal')),
  TEXCOORD_0: storeAttribute(quantize('uv',Uint16Array,65535), undefined, true),
  COLOR_0: storeAttribute(quantize('color',Uint8Array,255,4), undefined, true),
};
primitive.indices = storeAttribute(fitted.getIndex());
const geometryBytes = offset;
for (const [i, image] of doc.images.entries()) image.bufferView = append(imageData[i]);
const binary = Buffer.concat([...chunks, Buffer.alloc((4 - (offset % 4)) % 4)]);
doc.buffers[0].byteLength = binary.length;
const json = Buffer.from(JSON.stringify(doc));
const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.write('glTF');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + padded.length + binary.length, 8);
header.writeUInt32LE(padded.length, 12);
header.write('JSON', 16);
binHeader.writeUInt32LE(binary.length);
binHeader.write('BIN\0', 4);
const encoded = Buffer.concat([header, padded, binHeader, binary]);
const temporary = `${output}.${process.pid}.tmp`;
writeFileSync(temporary, encoded);
renameSync(temporary, output);
console.log(`gate-scarp fit: ${fitted.getAttribute('position').count} vertices, ${fitted.getIndex().count / 3} triangles, ` +
  `${geometryBytes} geometry bytes, ${imageData.reduce((sum, image) => sum + image.length, 0)} image bytes, ${encoded.length} GLB bytes`);
