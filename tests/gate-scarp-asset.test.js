import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { PLAYER } from '../src/config';
import { SCARP_SOLIDS } from '../src/sim/southScarp';

const glb = readFileSync(new URL('../public/models/rodin/gate-scarp.glb', import.meta.url));
const jsonLength = glb.readUInt32LE(12);
const doc = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
const { attributes, indices, material } = doc.meshes[0].primitives[0];

function read(accessorIndex, width) {
  const accessor = doc.accessors[accessorIndex];
  const view = doc.bufferViews[accessor.bufferView];
  const Type = { 5121: Uint8Array, 5123: Uint16Array, 5126: Float32Array }[accessor.componentType];
  const start = glb.byteOffset + 28 + jsonLength + view.byteOffset + (accessor.byteOffset ?? 0);
  return new Type(glb.buffer, start, accessor.count * width);
}

const positions = read(attributes.POSITION, 3);
const triangles = read(indices, 1);
const point = index => [positions[3 * index], positions[3 * index + 1], -positions[3 * index + 2]];

test('fitted GLB stays in budget with a single indexed PBR mesh and usable normals', () => {
  expect(glb.length).toBeLessThan(4_000_000);
  expect(doc.meshes).toHaveLength(1);
  expect(doc.meshes[0].primitives).toHaveLength(1);
  expect(doc.accessors[indices].componentType).toBe(5123);
  expect(triangles.length / 3).toBeLessThan(18_500);
  const normals = read(attributes.NORMAL, 3);
  expect(doc.accessors[attributes.TEXCOORD_0]).toMatchObject({
    componentType: 5123, normalized: true, type: 'VEC2', count: positions.length / 3,
  });
  expect(doc.accessors[attributes.COLOR_0]).toMatchObject({
    componentType: 5121, normalized: true, type: 'VEC4', count: positions.length / 3,
  });
  const uv = read(attributes.TEXCOORD_0, 2);
  expect(normals.length).toBe(positions.length);
  expect(uv.length / 2).toBe(positions.length / 3);
  const pbr = doc.materials[material].pbrMetallicRoughness;
  expect(pbr.metallicFactor).toBe(0);
  expect([pbr.baseColorTexture.index, pbr.metallicRoughnessTexture.index, doc.materials[material].normalTexture.index].sort()).toEqual([0, 1, 2]);
  expect(doc.images.map(image => image.mimeType)).toEqual(['image/jpeg', 'image/jpeg', 'image/jpeg']);
  const finite = [positions, normals, uv].every(array => array.every(Number.isFinite));
  expect(finite).toBe(true);
  let shortest = 1, longest = 1;
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    shortest = Math.min(shortest, length);
    longest = Math.max(longest, length);
  }
  expect(shortest).toBeGreaterThan(0.999);
  expect(longest).toBeLessThan(1.001);
  for (let i = 0; i < triangles.length; i += 3) {
    const a = point(triangles[i]), b = point(triangles[i + 1]), c = point(triangles[i + 2]);
    const [x, y, z] = b.map((value, axis) => value - a[axis]);
    const [s, t, u] = c.map((value, axis) => value - a[axis]);
    if (!(Math.hypot(y * u - z * t, z * s - x * u, x * t - y * s) > 0)) {
      throw new Error(`Degenerate gate scarp triangle ${i / 3}`);
    }
  }
});

// Match the simulation's vertical overlap interval at courtyard level, then
// expand the projected mesh edges by the same radius as the moving player.
function clipAtY(polygon, y, side) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = (a[1] - y) * side, db = (b[1] - y) * side;
    if (da >= 0) result.push(a);
    if (da * db < 0) result.push(a.map((value, axis) => value + (b[axis] - value) * da / (da - db)));
  }
  return result;
}

test('north face tracks the floor-level player collision envelope', () => {
  const floor = 0.1, ceiling = 1.7, radius = PLAYER.radius;
  const edges = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const polygon = clipAtY(clipAtY([point(triangles[i]), point(triangles[i + 1]), point(triangles[i + 2])], floor, 1), ceiling, -1);
    for (let j = 0; j < polygon.length; j++) {
      let a = polygon[j], b = polygon[(j + 1) % polygon.length];
      if (a[0] > b[0]) [a, b] = [b, a];
      const run = b[0] - a[0], rise = b[2] - a[2];
      edges.push({ x0: a[0], x1: b[0], z: run ? a[2] : Math.max(a[2], b[2]), slope: run ? rise / run : 0,
        supportX: run ? radius * rise / Math.hypot(run, rise) : 0 });
    }
  }
  // The west curtain covers the approach past x=-10.04. The east cap is
  // exposed, so continue the samples through the radius beyond the tip.
  const solids = SCARP_SOLIDS.filter(box => box.h > floor);
  let min = Infinity, max = -Infinity;
  for (let sample = 0; sample <= 1546; sample++) {
    const x = -10.03 + sample * 0.005;
    let meshZ = -Infinity, boxZ = -Infinity;
    for (const edge of edges) {
      if (edge.x0 >= x + radius || edge.x1 <= x - radius) continue;
      const along = Math.max(edge.x0, Math.min(edge.x1, x + edge.supportX));
      const d = along - x;
      if (Math.abs(d) < radius) meshZ = Math.max(meshZ, edge.z + (along - edge.x0) * edge.slope + Math.sqrt(radius * radius - d * d));
    }
    for (const box of solids) {
      const d = x - Math.max(box.x0, Math.min(box.x1, x));
      if (Math.abs(d) < radius) boxZ = Math.max(boxZ, box.z1 + Math.sqrt(radius * radius - d * d));
    }
    min = Math.min(min, meshZ - boxZ);
    max = Math.max(max, meshZ - boxZ);
  }
  expect(min).toBeGreaterThan(-0.07);
  expect(max).toBeLessThan(0.03);
});
