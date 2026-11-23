import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { addBaileyPaving } from '../src/render/baileyPaving';
import { buildFallenRubble, fallenRubbleGeometry } from '../src/render/fallenRubble';
import { Batch } from '../src/render/geom';
import { inArea, NODES, PROPS, WALLS } from '../src/sim/level';
import { circleOverlapsBox } from '../src/sim/collision';

const mesh = buildFallenRubble();
const { material } = mesh;
const geo = mesh.geometry;
const pos = geo.getAttribute('position'), index = geo.index!;
const read = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
const key = (p: THREE.Vector3) => p.toArray().map(n => Math.round(n * 1e6)).join(',');
const triangles = Array.from({ length: index.count / 3 }, (_, t) => {
  const ids = [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)];
  return { ids, face: new THREE.Triangle(...ids.map(read) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]) };
});
const edges = new Map<string, { id: number; sign: number }[]>();
triangles.forEach(({ face: { a, b, c } }, id) => {
  for (const [p, q] of [[a, b], [b, c], [c, a]]) {
    const x = key(p), y = key(q), k = [x, y].sort().join('/');
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k)!.push({ id, sign: x < y ? 1 : -1 });
  }
});
const neighbours = triangles.map(() => new Set<number>());
for (const run of edges.values()) for (const { id } of run) for (const other of run) neighbours[id].add(other.id);
const visited = new Set<number>();
const pieces = triangles.flatMap((_, start) => {
  if (visited.has(start)) return [];
  const ids = new Set([start]);
  for (const i of ids) for (const j of neighbours[i]) ids.add(j);
  const faces = [...ids].map(i => triangles[i].face);
  const points = [...new Map(faces.flatMap(t => [t.a, t.b, t.c]).map(v => [key(v), v])).values()];
  for (const i of ids) visited.add(i);
  return [{ points, faces, bounds: new THREE.Box3().setFromPoints(points) }];
});

function apart(a: typeof pieces[number], b: typeof pieces[number]): boolean {
  if (!a.bounds.intersectsBox(b.bounds)) return true;
  const from = ({ faces }: typeof a) => faces.flatMap(({ a, b, c }) => [b.clone().sub(a), c.clone().sub(b), a.clone().sub(c)]);
  const normals = [...a.faces, ...b.faces].map(f => f.getNormal(new THREE.Vector3()));
  for (const u of from(a)) for (const v of from(b)) normals.push(u.clone().cross(v));
  return normals.some(n => {
    if (n.lengthSq() < 1e-12) return false;
    n.normalize();
    const aa = a.points.map(p => p.dot(n)), bb = b.points.map(p => p.dot(n));
    return Math.max(...aa) <= Math.min(...bb) + 1e-5 || Math.max(...bb) <= Math.min(...aa) + 1e-5;
  });
}

function massCenter({ faces, points }: typeof pieces[number]): THREE.Vector3 {
  const origin = points[0];
  const center = new THREE.Vector3();
  let volume6 = 0;
  for (const { a, b, c } of faces) {
    const av = a.clone().sub(origin), bv = b.clone().sub(origin), cv = c.clone().sub(origin);
    const tetra = av.dot(bv.clone().cross(cv));
    volume6 += tetra;
    center.addScaledVector(av.add(bv).add(cv), tetra / 4);
  }
  return center.divideScalar(volume6).add(origin);
}

function rect({ min, max }: THREE.Box3) {
  return { x0: min.x, x1: max.x, z0: -max.z, z1: -min.z };
}

const box = PROPS.find(p => p.tag === 'rubble' && (p.y0 ?? 0) === 0 && inArea(p, -8, 21))!;
const west = pieces.filter(p => p.bounds.max.x < 0), east = pieces.filter(p => p.bounds.min.x > 0);
const withinProxy = (b: THREE.Box3) => {
  const r = rect(b);
  return r.x0 >= box.x0 && r.x1 <= box.x1 && r.z0 >= box.z0 && r.z1 <= box.z1;
};

describe('fallen masonry (CPU, no renderer)', () => {
  it('batches distinct watertight blocks/spalls, with consistent outward winding and UVs', () => {
    expect(Array.isArray(mesh.material)).toBe(false);
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    expect(geo.groups).toHaveLength(0);
    expect(geo.getAttribute('color').count).toBe(pos.count);
    expect(geo.boundingSphere!.containsPoint(geo.boundingBox!.getCenter(new THREE.Vector3()))).toBe(true);
    expect(pieces).toHaveLength(20);
    expect(index.count / 3).toBeLessThan(1400);
    expect(fallenRubbleGeometry().getAttribute('position').array).toEqual(pos.array);
    for (const run of edges.values()) {
      expect(run).toHaveLength(2);
      expect(run[0].sign + run[1].sign).toBe(0);
    }
    for (const { face, ids } of triangles) {
      const n = face.getNormal(new THREE.Vector3());
      expect(face.getArea()).toBeGreaterThan(1e-9);
      const uv = ids.map(i => new THREE.Vector2().fromBufferAttribute(geo.getAttribute('uv') as THREE.BufferAttribute, i));
      expect(uv.every(p => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1)).toBe(true);
      expect(uv[1].clone().sub(uv[0]).cross(uv[2].clone().sub(uv[0]))).toBeGreaterThan(0);
      for (const i of ids) expect(n.dot(new THREE.Vector3().fromBufferAttribute(geo.getAttribute('normal'), i))).toBeGreaterThan(.999);
    }
  });

  it('composes the dirt rind with the shared PBR shader without using floor puddles', () => {
    expect(material.vertexColors).toBe(true);
    expect(material.userData.aw.uAwYard.value).toBe(0);
    const shader = { ...THREE.ShaderLib.standard, uniforms: {} } as Parameters<typeof material.onBeforeCompile>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const body = shader.fragmentShader.slice(shader.fragmentShader.indexOf('void main()'));
    expect(body).toContain('float rubbleMud = ');
    expect(body).toContain('roughnessFactor = mix(roughnessFactor, 0.965, rubbleMud);');
    expect(body.indexOf('vec4 awSample')).toBeLessThan(body.indexOf('float rubbleMud'));
    expect(body.indexOf('float rubbleMud')).toBeLessThan(body.indexOf('#include <lights_physical_fragment>'));
  });

  it('keeps all substantial pieces in the true west prop and preserves the portal route', () => {
    expect(west).toHaveLength(17);
    expect(east).toHaveLength(3);
    for (const p of west) {
      const r = rect(p.bounds);
      if (!withinProxy(p.bounds)) {
        expect(p.bounds.max.y).toBeLessThan(.015);
        expect(r.x0).toBeGreaterThanOrEqual(box.x1 - .09);
        expect(r.x1).toBeLessThan(-7.02);
        expect(r.z0).toBeGreaterThan(20.30);
        expect(r.z1).toBeLessThan(box.z1);
      }
      expect(p.bounds.max.y).toBeLessThan(box.h);
      for (const [from, to] of [['c_wn_bay', 'c_wn_inner'], ['c_wn_inner', 'c_wn_return'],
        ['c_wn_return', 'c_nw'], ['c_w', 'c_nw']]) {
        const a = NODES.find(n => n.id === from)!, b = NODES.find(n => n.id === to)!;
        for (let i = 0; i <= 32; i++) {
          const x = THREE.MathUtils.lerp(a.x, b.x, i / 32), z = THREE.MathUtils.lerp(a.z, b.z, i / 32);
          expect(circleOverlapsBox(x, z, PLAYER.radius, { ...box, ...r })).toBe(false);
        }
      }
    }
    for (const p of east) {
      const r = rect(p.bounds);
      expect(r.x0).toBeGreaterThan(10 - PLAYER.radius);
      expect(r.x1).toBeLessThan(9.925); // plinth toe, x≈9.92
      expect(r.z0).toBeGreaterThan(22.06);
      expect(r.z1).toBeLessThan(22.85);
      expect(p.bounds.max.y - p.bounds.min.y).toBeLessThan(.07);
    }
    for (const { bounds } of pieces) {
      const r = rect(bounds);
      expect(WALLS.some(w => w.x1 > r.x0 && w.x0 < r.x1 && w.z1 > r.z0 && w.z0 < r.z1
        && w.h > bounds.min.y && (w.y0 ?? 0) < bounds.max.y)).toBe(false);
    }
  });

  it('rests on buried bearing faces at the actual paving without intersecting', () => {
    const group = new THREE.Group(), batch = new Batch();
    addBaileyPaving(batch, new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial());
    batch.build(group);
    const down = new THREE.Vector3(0, -1, 0), ray = new THREE.Raycaster();
    for (const [i, piece] of pieces.entries()) {
      const { bounds, faces } = piece;
      const y = bounds.min.y;
      const supported = (f: THREE.Triangle) => [f.a, f.b, f.c].every(p => Math.abs(p.y - y) < 1e-6);
      const sole = faces.filter(supported);
      expect(sole.reduce((a, f) => a + f.getArea(), 0)).toBeGreaterThan(.003);
      const center = massCenter(piece).setY(y);
      expect(sole.some(f => f.containsPoint(center))).toBe(true);
      for (const point of [center, ...piece.points.filter(p => Math.abs(p.y - y) < 1e-6),
        ...sole.map(f => f.getMidpoint(new THREE.Vector3()))]) {
        ray.set(point.clone().setY(.15), down);
        const hit = ray.intersectObjects(group.children, false)[0];
        expect(hit, `paving under ${point.x},${-point.z}`).toBeDefined();
        expect(hit.point.y - y, `embed at ${point.x},${-point.z}`).toBeGreaterThanOrEqual(0);
        expect(hit.point.y - y).toBeLessThan(.020);
      }
      if (bounds.max.x < 0 && !withinProxy(bounds)) {
        const crest = piece.points.reduce((h, p) => p.y > h.y ? p : h);
        ray.set(crest.clone().setY(.15), down);
        expect(crest.y - ray.intersectObjects(group.children, false)[0].point.y).toBeLessThan(.037);
      }
      for (const other of pieces.slice(i + 1)) expect(apart(piece, other), `pieces overlap at ${rect(bounds).x0}/${rect(other.bounds).x0}`).toBe(true);
    }
    const longest = west.reduce((a, b) => a.bounds.max.y > b.bounds.max.y ? a : b);
    const { min, max } = longest.bounds;
    const edgeHeight = (at: (p: THREE.Vector3) => boolean) => Math.max(...longest.points.filter(at).map(p => p.y));
    expect(max.y).toBeGreaterThan(.29);
    expect(max.y).toBeLessThan(.48);
    expect(max.x - min.x).toBeGreaterThan(.8);
    expect(edgeHeight(p => p.x <= min.x + .22) - edgeHeight(p => p.x >= max.x - .22)).toBeGreaterThan(.12);
  });
});
