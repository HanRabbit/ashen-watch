import { Box3, Triangle, Vector3 } from 'three';
import { expect, test, vi } from 'vitest';
import { PLAYER } from '../src/config';
import { BAILEY_EDGES, BAILEY_NODES } from '../src/sim/baileyApron';
import { DOORS, F2_Y, NODES, STAIRS, type Rect, type StairRun } from '../src/sim/level';
import { NORTH_EDGES } from '../src/sim/northCourt';

// The project does not require @types/node for its browser TypeScript sources.
const { readFileSync } = await vi.importActual<{ readFileSync(url: URL): Uint8Array }>('node:fs');
const glb = readFileSync(new URL('../public/models/rodin/outer-bailey.glb', import.meta.url));
const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
const jsonBytes = view.getUint32(12, true);
const binStart = 28 + jsonBytes;
const doc = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonBytes)));

function mesh() {
  expect(view.getUint32(0, true)).toBe(0x46546c67); // glTF
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(glb.byteLength);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a); // JSON
  expect(view.getUint32(24 + jsonBytes, true)).toBe(0x004e4942); // BIN
  expect(doc.scenes[doc.scene ?? 0].nodes).toEqual([0]);
  expect(doc.nodes).toHaveLength(1);
  const node = doc.nodes[0];
  for (const key of ['matrix', 'translation', 'rotation', 'scale', 'children']) expect(node[key]).toBeUndefined();
  const primitives = doc.meshes[node.mesh].primitives;
  expect(primitives).toHaveLength(1);
  const primitive = primitives[0];
  expect(primitive.mode ?? 4).toBe(4);

  function accessor(id: number, size: number) {
    const a = doc.accessors[id], buffer = doc.bufferViews[a.bufferView];
    expect(a.sparse).toBeUndefined();
    expect(buffer.buffer).toBe(0);
    const stride = buffer.byteStride ?? size;
    const offset = (buffer.byteOffset ?? 0) + (a.byteOffset ?? 0);
    expect(offset + (a.count - 1) * stride + size).toBeLessThanOrEqual(glb.byteLength - binStart);
    return { a, stride, offset: binStart + offset };
  }

  const p = accessor(primitive.attributes.POSITION, 12);
  expect(p.a.type).toBe('VEC3');
  expect(p.a.componentType).toBe(5126);
  const vertices = Array.from({ length: p.a.count }, (_, i) => {
    const at = p.offset + i * p.stride;
    // The final GLB is already in world render coordinates. All probe zones
    // below use simulation coordinates (north is positive Z).
    return new Vector3(view.getFloat32(at, true), view.getFloat32(at + 4, true), -view.getFloat32(at + 8, true));
  });
  expect(vertices.every(({ x, y, z }) => [x, y, z].every(Number.isFinite))).toBe(true);
  const isU32 = doc.accessors[primitive.indices].componentType === 5125;
  const ix = accessor(primitive.indices, isU32 ? 4 : 2);
  expect(ix.a.type).toBe('SCALAR');
  expect([5123, 5125]).toContain(ix.a.componentType);
  expect(ix.a.count % 3).toBe(0);
  const indices = Array.from({ length: ix.a.count }, (_, i) => {
    const at = ix.offset + i * ix.stride;
    return isU32 ? view.getUint32(at, true) : view.getUint16(at, true);
  });
  expect(indices.length).toBeGreaterThan(0);
  expect(indices.every(i => i < vertices.length)).toBe(true);
  return { vertices, indices };
}

type Point = { x: number; y: number; z: number };
interface Clearance {
  name: string;
  localBounds: Box3;
  toLocal(point: Vector3, target: Vector3): Vector3;
}

// From 2 cm below the tread through the body and the 1.62 m eye/pivot height.
const FOOT = -0.02;
const HEAD = 1.7;
const zone = (name: string, rect: Rect, y: number, run?: StairRun): Clearance => {
  const pitch = !run ? 0 : (run.to - run.from) / (run.axis === 'x' ? run.x1 - run.x0 : run.z1 - run.z0);
  return {
    name,
    localBounds: new Box3(new Vector3(rect.x0, FOOT, rect.z0), new Vector3(rect.x1, HEAD, rect.z1)),
    toLocal: (point, target) => target.set(point.x, point.y - y - pitch *
      (run?.axis === 'z' ? point.z - rect.z0 : point.x - rect.x0), point.z),
  };
};

function corridor(name: string, from: Point, to: Point): Clearance {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const ux = (to.x - from.x) / length, uz = (to.z - from.z) / length;
  const r = PLAYER.radius;
  return {
    name,
    localBounds: new Box3(new Vector3(-r, FOOT, -r), new Vector3(length + r, HEAD, r)),
    toLocal: (point, target) => {
      const dx = point.x - from.x, dz = point.z - from.z;
      const along = dx * ux + dz * uz;
      return target.set(along, point.y - from.y - along * ((to.y - from.y) / length), dz * ux - dx * uz);
    },
  };
}

const nodes = new Map(NODES.map(node => [node.id, node]));
function route(a: string, b: string) {
  return corridor(`${a} → ${b}`, nodes.get(a)!, nodes.get(b)!);
}

const sections: Record<string, Clearance[]> = {
  'southwest drum, apron and portal': [
    ...BAILEY_EDGES.map(e => route(e.a, e.b)),
    ...BAILEY_NODES.map(({ id, x, y, z }) => zone(`${id} standing clearance`, {
      x0: x - PLAYER.radius, x1: x + PLAYER.radius, z0: z - PLAYER.radius, z1: z + PLAYER.radius,
    }, y)),
  ],
  'west wing and north chamber elbow': [
    route('c_ws_inner', 'c_ws_bay'), route('c_ws_bay', 'c_w_knee'), route('c_w_knee', 'c_wn_turn'),
    route('c_wn_turn', 'c_wn_bay'), route('c_wn_bay', 'c_wn_gable'), route('c_wn_bay', 'c_wn_inner'),
    // Closest surveyed point on the accessible side of the west elbow.
    zone('inside the west elbow', { x0: -17.27, x1: -16.75, z0: 17.43, z1: 18.90 }, 0),
  ],
  'both northern arches and the north court': NORTH_EDGES.map(e => route(e.a, e.b)),
  'main court and open doors': [
    zone('main court', { x0: -7, x1: 4, z0: 2.5, z1: 26.9 }, 0),
    route('gh_mid', 'gh_in'), route('gh_in', 'c_s'), route('p_d', 'v_d'), route('g_gal2', 'g_land'),
    ...Object.values(DOORS).map(door => zone(door.id, door.box, door.box.y0 ?? 0)),
  ],
  'stair runs and landings': STAIRS.flatMap(stair => [
    ...stair.runs.map(run => zone(stair.id, run, run.from, run)),
    ...stair.landings.map(landing => zone(`${stair.id} landing`, landing, landing.y)),
  ]),
  'upper walks, bridge and gallery': [
    zone('west walk', { x0: -10, x1: -8.4, z0: 2.5, z1: 28.5 }, F2_Y),
    zone('north walk', { x0: -10, x1: 10, z0: 27, z1: 28.5 }, F2_Y),
    zone('east walk', { x0: 8.4, x1: 10, z0: 2.5, z1: 28.5 }, F2_Y),
    zone('bridge', { x0: 8.4, x1: 13.5, z0: 19.5, z1: 21.0 }, F2_Y),
    zone('gallery', { x0: 13.5, x1: 24, z0: 20, z1: 22 }, F2_Y),
  ],
};

const asset = mesh();

test.each(Object.entries(sections))('outer-bailey keeps clear of %s', (_name, clearances) => {
  const triangle = new Triangle();
  const faceBounds = new Box3();
  for (const clearance of clearances) {
    // Apply the affine change of basis before the triangle-box SAT. This also
    // handles a face crossing the corridor with all three vertices outside it.
    const local = asset.vertices.map(v => clearance.toLocal(v, new Vector3()));
    const hits: string[] = [];
    for (let i = 0; i < asset.indices.length; i += 3) {
      const a = local[asset.indices[i]], b = local[asset.indices[i + 1]], c = local[asset.indices[i + 2]];
      faceBounds.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c);
      if (!clearance.localBounds.intersectsBox(faceBounds)) continue;
      if (!clearance.localBounds.intersectsTriangle(triangle.set(a, b, c))) continue;
      const near = asset.vertices[asset.indices[i]].toArray().map(v => v.toFixed(3));
      hits.push(`face ${i / 3} by (${near.join(', ')})`);
      if (hits.length === 3) break;
    }
    expect(hits, clearance.name).toEqual([]);
  }
});
