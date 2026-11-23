import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Batch } from '../src/render/geom';
import { addCurtainDetails, addWestCourtFabric } from '../src/render/masonry';
import { wornPrism } from '../src/render/wornArris';
import { isWestCourtFabric } from '../src/sim/courtPlan';
import { WALLS } from '../src/sim/level';

class SurveyBatch extends Batch {
  pieces: THREE.BufferGeometry[] = [];
  override add(g: THREE.BufferGeometry, _m: THREE.Material, matrix: THREE.Matrix4) {
    this.pieces.push(g.applyMatrix4(matrix));
  }
}

function inspect(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  let minArea = Infinity, minDot = Infinity, minUV = Infinity, varied = false;
  const v = (attr: typeof p, i: number) => new THREE.Vector3().fromBufferAttribute(attr, i);
  for (let i = 0; i < p.count; i += 3) {
    const f = new THREE.Triangle(v(p, i), v(p, i + 1), v(p, i + 2));
    minArea = Math.min(minArea, f.getArea());
    const normal = f.getNormal(new THREE.Vector3());
    const a = new THREE.Vector2().fromBufferAttribute(uv, i);
    const b = new THREE.Vector2().fromBufferAttribute(uv, i + 1);
    const c = new THREE.Vector2().fromBufferAttribute(uv, i + 2);
    minUV = Math.min(minUV, Math.abs(b.sub(a).cross(c.sub(a))));
    for (let j = i; j < i + 3; j++) {
      const vertex = v(n, j);
      minDot = Math.min(minDot, vertex.dot(normal));
      varied ||= vertex.distanceToSquared(v(n, i)) > 0.0001;
    }
  }
  g.computeBoundingBox();
  return { g, minArea, minDot, minUV, varied, bounds: g.boundingBox!, triangles: p.count / 3 };
}

function expectClosed(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const key = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map(x => x.toFixed(6)).join(',');
  const edges = new Map<string, { count: number; winding: number }>();
  for (let i = 0; i < p.count; i += 3) for (let j = 0; j < 3; j++) {
    const a = key(i + j), b = key(i + (j + 1) % 3);
    const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
    const previous = edges.get(edge) ?? { count: 0, winding: 0 };
    edges.set(edge, { count: previous.count + 1, winding: previous.winding + (a < b ? 1 : -1) });
  }
  expect([...edges.values()].every(edge => edge.count === 2 && edge.winding === 0)).toBe(true);
}

const wallTrim = new THREE.MeshStandardMaterial(), wallRough = new THREE.MeshStandardMaterial();
const fabric = { wallTrim, wallRough, wallRubble: new THREE.MeshStandardMaterial() };

function courtyard() {
  const supports = new SurveyBatch(), wing = new SurveyBatch();
  addCurtainDetails(supports, fabric, WALLS);
  addWestCourtFabric(wing, fabric, WALLS.filter(isWestCourtFabric));
  return { supports: supports.pieces.filter(g => !g.index).map(inspect), wing: wing.pieces.filter(g => !g.index).map(inspect) };
}

describe('close-range worn arrises (CPU geometry only)', () => {
  it('keeps local non-flat normals and atlas coverage on the west arcade and curtain piers, within budget', () => {
    const { supports, wing } = courtyard();
    const worn = [...supports, ...wing].filter(p => p.varied);
    const stones = worn.filter(p => p.triangles === 84 || p.triangles === 120);
    expect(worn.some(({ bounds }) => bounds.max.x > 9.5 && bounds.min.y < 1)).toBe(true);
    expect(worn.some(({ bounds }) => bounds.min.x < -9.95 && bounds.max.x > -10 && bounds.min.y < 1)).toBe(true);
    expect(worn.some(({ bounds }) => bounds.max.y > 3.5 && bounds.max.x < -9.90)).toBe(true);
    expect(stones.length).toBeGreaterThan(60);
    for (const p of worn) {
      const name = `at ${p.bounds.min.toArray().map(v => v.toFixed(3))}, ${p.triangles} triangles`;
      expect(p.minDot, name).toBeGreaterThan(0.45);
      expect(p.minArea, name).toBeGreaterThan(1e-8);
      expect(p.minUV, name).toBeGreaterThan(1e-9);
      expect(Object.keys(p.g.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    }
    for (const { g } of stones) for (const u of g.getAttribute('uv').array) {
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
    }
    for (const { g } of stones.filter(p => p.triangles === 120)) expectClosed(g);
    // Former ring lofts: 38 (buried rear) / 60 (exposed rear) triangles.
    const increase = stones.reduce((sum, p) => sum + p.triangles - (p.triangles === 84 ? 38 : 60), 0);
    expect(increase).toBeLessThan(4800);
  });

  it('leaves the west gable window clear and wears its upper edge, without moving the sill or whole return', () => {
    const { wing } = courtyard();
    const sill = wing.find(p => p.varied && Math.abs(p.bounds.min.x + 16.59) < 1e-4 && Math.abs(p.bounds.max.y - 2.47) < 1e-4);
    expect(sill).toBeDefined();
    const { g, bounds } = sill!;
    expect(sill!.triangles).toBe(48);
    expectClosed(g);
    expect(bounds.max.x).toBeCloseTo(-15.57, 4);
    expect(bounds.min.y).toBeCloseTo(0, 4);
    expect(bounds.min.z).toBeCloseTo(-25.2, 4);
    expect(bounds.max.z).toBeCloseTo(-24.28, 4);
    const mesh = new THREE.Mesh(g, fabric.wallRubble);
    const hit = (y: number, far = false) => new THREE.Raycaster(new THREE.Vector3(-16.08, y, far ? -26 : -23.5),
      new THREE.Vector3(0, 0, far ? 1 : -1), 0, far ? 0.804 : 0.787).intersectObject(mesh).length > 0;
    expect(hit(2.40)).toBe(true);
    expect(hit(2.46)).toBe(false);
    expect(hit(2.40, true)).toBe(true);
    expect(hit(2.466, true)).toBe(false);
    expect(hit(2.48)).toBe(false);
  });

  it('keeps the broad timber faces planar and makes opposite long edges irregular inside the stock', () => {
    const outline: [number, number][] = [[-0.078, 0], [0.078, 0], [0.075, 0.65], [0.078, 1.69], [-0.075, 1.69], [-0.084, 1.08]];
    const g = wornPrism(outline, -0.0885, 0.0885, {
      front: i => [i === 2 ? 0.019 : 0.008, i === 2 ? 0.019 : 0.011, 0.22],
      back: i => [i === 5 ? 0.021 : 0.006, i === 5 ? 0.017 : 0.009, 0.28],
    }, ([x, y, z], { axis }) => [0.062 + (axis === 0 ? z : x) * 0.42, (axis === 1 ? z : y) * 0.51]);
    const { bounds, varied, minDot, minArea, minUV, triangles } = inspect(g);
    expect(triangles).toBe(72);
    expectClosed(g);
    expect(varied).toBe(true);
    expect(minDot).toBeGreaterThan(0.45);
    expect(minArea).toBeGreaterThan(1e-8);
    expect(minUV).toBeGreaterThan(1e-9);
    expect(bounds.min.toArray()).toEqual(expect.arrayContaining([expect.closeTo(-0.084, 5), 0, expect.closeTo(-0.0885, 5)]));
    expect(bounds.max.toArray()).toEqual(expect.arrayContaining([expect.closeTo(0.078, 5), expect.closeTo(1.69, 5), expect.closeTo(0.0885, 5)]));
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i)) > 0.08849) {
      expect(n.getZ(i)).toBe(Math.sign(p.getZ(i)));
    }
  });
});
