import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addChapelApproach, addStairTreads } from '../src/render/floors';
import { buildGatehouseLights, GATEHOUSE_LIGHTS, windowWallPieces } from '../src/render/gatehouseWindows';
import { Batch } from '../src/render/geom';
import { addMasonryTrim } from '../src/render/masonry';
import { addGatehousePortal } from '../src/render/staticLevel';
import { DOORS, PLATFORM_SLAB, RAISED_Y, STAIR_BODIES, STAIRS, STEP_RAMP, WALLS } from '../src/sim/level';

const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const count = (g: THREE.BufferGeometry) => (g.index?.count ?? g.getAttribute('position').count) / 3;
const mat = () => new THREE.MeshStandardMaterial();
const cast = (object: THREE.Object3D, at: THREE.Vector3, direction: THREE.Vector3, far = 3) =>
  new THREE.Raycaster(at, direction, 0, far).intersectObject(object, true);
const shootDown = (object: THREE.Object3D, x: number, top: number, z: number) => cast(object, vec(x, top + 0.08, z), vec(0, -1, 0))[0];

function observe(b: Batch, add: () => void) {
  const parts: THREE.BufferGeometry[] = [];
  b.observeGeometry(g => parts.push(g), add);
  return parts;
}

/** Chart seams split UVs and normals, but each positional edge must still pair. */
function expectClosed(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), idx = g.index!;
  const point = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map(x => Math.round(x * 1e5)).join(',');
  const edges = new Map<string, number>();
  for (let i = 0; i < idx.count; i += 3) {
    const v = [0, 1, 2].map(j => point(idx.getX(i + j)));
    expect(new Set(v).size).toBe(3);
    for (let j = 0; j < 3; j++) {
      const key = [v[j], v[(j + 1) % 3]].sort().join('/');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  expect([...new Set(edges.values())]).toEqual([2]);
}

describe('architectural nosings', () => {
  it('rounds the downhill edge of each run with a closed 20-triangle tread, keeping landings square', () => {
    const b = new Batch(), stone = mat(), wood = mat(), scene = new THREE.Group();
    const parts = observe(b, () => addStairTreads(b, stone, wood));
    expect(parts).toHaveLength(STAIR_BODIES.flatMap(s => s.boxes).length);
    let i = 0;
    for (const [s, stair] of STAIRS.entries()) {
      const runs = stair.runs.flatMap(run => Array(Math.ceil(Math.abs(run.to - run.from) / 0.18)).fill(run) as (typeof run)[]);
      for (const [j, step] of STAIR_BODIES[s].boxes.entries()) {
        const g = parts[i++], run = runs[j], mesh = new THREE.Mesh(g, stair.id === 'S4' ? wood : stone);
        expect(count(g)).toBe(run ? 20 : 12);
        expectClosed(g);
        g.computeBoundingBox();
        for (const [actual, expected] of [
          [g.boundingBox!.min.toArray(), [step.x0, step.y0!, -step.z1]],
          [g.boundingBox!.max.toArray(), [step.x1, step.h, -step.z0]],
        ]) actual.forEach((v, k) => expect(v).toBeCloseTo(expected[k], 5));
        if (!run) continue;
        const alongX = run.axis === 'x', uphill = Math.sign(run.to - run.from);
        const low = alongX ? (uphill > 0 ? step.x0 : step.x1) : (uphill > 0 ? step.z0 : step.z1);
        const high = alongX ? (uphill > 0 ? step.x1 : step.x0) : (uphill > 0 ? step.z1 : step.z0);
        const xc = (step.x0 + step.x1) / 2, zc = (step.z0 + step.z1) / 2;
        const sample = (at: number) => shootDown(mesh, alongX ? at : xc, step.h, -(alongX ? zc : at));
        const lip = sample(low + uphill * 0.004);
        expect(lip.face!.normal.y).toBeGreaterThan(0.2);
        expect(lip.face!.normal.y).toBeLessThan(0.96);
        expect((alongX ? -lip.face!.normal.x : lip.face!.normal.z) * uphill).toBeGreaterThan(0.2);
        expect(step.h - lip.point.y).toBeGreaterThan(0.001);
        // On the opposite edge, the top still reaches the next riser.
        expect(sample(high - uphill * 0.001).point.y).toBeCloseTo(step.h, 5);
      }
    }
    const extra = parts.reduce((sum, g) => sum + count(g) - 12, 0);
    expect(extra).toBeLessThanOrEqual(720);
    b.build(scene);
    expect(scene.children).toHaveLength(2);
    expect(scene.children.every(mesh => mesh.castShadow)).toBe(true);
  });

  it('keeps the chapel approach flush at the uphill beds and intact below the nosing', () => {
    const b = new Batch(), scene = new THREE.Group(), trim = mat(), flag = mat();
    const parts = observe(b, () => addChapelApproach(b, trim, flag));
    expect(parts.map(count)).toEqual([20, 20, 20, 20]);
    b.build(scene);
    const r = STEP_RAMP, z = -(r.z0 + r.z1) / 2, dx = (r.x1 - r.x0) / 3;
    const treads = [...Array.from({ length: 3 }, (_, i) => [r.x0 + i * dx, r.x0 + (i + 1) * dx, RAISED_Y * (i + 0.5) / 3]),
      [PLATFORM_SLAB.x0, PLATFORM_SLAB.x1, PLATFORM_SLAB.h]];
    for (const [i, [low, high, y]] of treads.entries()) {
      expect(shootDown(scene, low + 0.007, y, z).face!.normal.y).toBeLessThan(0.96);
      expect(shootDown(scene, high - 0.001, y, z).point.y).toBeCloseTo(y, 5);
      // A side ray just above the bottom of both bodies must not see a seam.
      if (i > 0) {
        const bed = i === 3 ? PLATFORM_SLAB.y0! : -0.12;
        // Both adjoining courses must actually exist at the sample height.
        const level = (bed + treads[i-1][2]) / 2;
        const side = (x: number, y: number) => cast(scene, vec(x, y, -r.z0 + 0.05), vec(0, 0, -1))[0];
        for (const offset of [-0.001, 0, 0.001]) {
          expect(side(low + offset, level)?.point.z, `tread joint ${i}, offset ${offset}`).toBeCloseTo(-r.z0, 5);
        }
        if (i === 1) {
          // The former 0.19 m sample is above the 0.075 m lower tread.
          expect(side(low - 0.001, 0.19)).toBeUndefined();
          expect(side(low + 0.001, 0.19)?.point.z).toBeCloseTo(-r.z0, 5);
        }
      }
    }
  });
});

describe('architectural openings and masonry bands', () => {
  it('rounds applied gatehouse jambs without opening the structural header bed or plugging the portal', () => {
    const b = new Batch(), scene = new THREE.Group(), stone = mat();
    const [header, jamb, ...rest] = observe(b, () => addGatehousePortal(b, stone));
    expect(count(header)).toBeLessThan(150);
    expect(count(jamb)).toBe(92);
    expect(rest.reduce((n, g) => n + count(g), 0) + count(jamb)).toBeLessThanOrEqual(2600);
    jamb.computeBoundingBox();
    const aabb = jamb.boundingBox!, y = aabb.getCenter(vec(0, 0, 0)).y;
    const shoulder = cast(new THREE.Mesh(jamb, stone), vec(aabb.min.x + 0.006, y, aabb.max.z + 0.4), vec(0, 0, -1))[0];
    expect(shoulder.point.z).toBeLessThan(aabb.max.z - 0.004);
    expect(shoulder.face!.normal.x).toBeLessThan(-0.2);
    for (const w of WALLS.filter(w => w.z0 === 0 && w.z1 === 0.5 && w.h === 4.2)) {
      b.box(stone, w.x0, w.z0, w.x1, w.z1, 0, w.h);
    }
    b.build(scene);
    expect(scene.children).toHaveLength(1);
    for (const side of [-1, 1]) {
      const through = (x: number, y: number) => cast(scene, vec(x, y, -DOORS.gatehouse.hinge.z + side), vec(0, 0, -side), 2);
      expect(through(0, 1.3)).toHaveLength(0);
      for (const x of [-0.801, -0.799, 0.799, 0.801]) expect(through(x, 3.85).length).toBeGreaterThan(0);
    }
  });

  it('rounds only the projecting building trim while preserving contact with its square backing', () => {
    const b = new Batch(), scene = new THREE.Group(), stone = mat(), core = mat();
    const m = { wallTrim: stone, wallRough: core };
    const walls = WALLS.filter(w => w.y0 === undefined && (w.h >= 7 || w.tag === 'gh' || w.tag === 'balustrade'));
    const parts = observe(b, () => { for (const w of walls) addMasonryTrim(b, m, w); });
    expect(parts).toHaveLength(17);
    expect(parts.every(g => count(g) === 92)).toBe(true);
    for (const w of walls) b.box(core, w.x0, w.z0, w.x1, w.z1, 0, w.h);
    b.build(scene);
    // Both gatehouse plinths have a round shoulder and a straight exterior wall
    // behind it. Neither the vertical return nor the junction is a new aperture.
    const w = walls.find(w => w.tag === 'gh' && w.x1 === -3)!;
    const hit = shootDown(scene, w.x0 - 0.074, 0.35, 4.0);
    expect((hit.object as THREE.Mesh).material).toBe(stone);
    expect(hit.face!.normal.x).toBeLessThan(-0.25);
    for (const x of [w.x0 + 0.001, w.x1 - 0.001]) {
      const hits = cast(scene, vec(x, 0.35, 9.5), vec(0, 0, -1), 2);
      expect(hits.some(h => (h.object as THREE.Mesh).material === core)).toBe(true);
    }
    const distant = observe(b, () => addMasonryTrim(b, m, { x0: -9.5, x1: -7, z0: -10, z1: -9.5, h: 5, los: true, kind: 'wall' }));
    expect(distant.map(count)).toEqual([12, 12]);
  });

  it('rolls the sill lips into the reveal while preserving the glazing throat and blocked seams', () => {
    for (const a of GATEHOUSE_LIGHTS) {
      const b = new Batch(), scene = new THREE.Group(), stone = mat(), metal = mat();
      const wall = { x0: a.x - 1, x1: a.x + 1, z0: a.z0, z1: a.z1, y0: 0, h: 4 };
      for (const p of windowWallPieces(wall)) b.box(stone, p.x0, p.z0, p.x1, p.z1, p.y0, p.h);
      const parts = observe(b, () => buildGatehouseLights(b, scene, stone, metal));
      expect(parts[1] && count(parts[1])).toBeLessThanOrEqual(160); // liner only, not lead quarries
      b.build(scene); scene.updateMatrixWorld(true);
      const isStone = (h: THREE.Intersection) => (h.object as THREE.Mesh).material === stone;
      const z = THREE.MathUtils.lerp(a.z0, a.z1, a.hearth ? 0.34 : 0.66), sill = a.hearth ? 0.067 : 0.048;
      const seat = shootDown(scene, a.x, a.bottom + sill, -z);
      expect(seat.point.y).toBeCloseTo(a.bottom + sill, 6);
      for (const side of [-1, 1]) {
        const mouth = side > 0 ? a.z0 : a.z1;
        const rim = shootDown(scene, a.x, a.bottom + 0.08, -mouth - side * 0.002);
        expect(isStone(rim)).toBe(true);
        expect(rim.face!.normal.y).toBeGreaterThan(0.18);
        expect(rim.face!.normal.y).toBeLessThan(0.90);
        const through = (dx: number, dy: number) => cast(scene, vec(a.x + dx, a.bottom + dy, -mouth + side * 0.5), vec(0, 0, -side));
        expect(through(0.09, 0.4).some(isStone)).toBe(false);
        expect(through(0.09, sill - 0.003).some(isStone)).toBe(true);
        for (const x of [-1, 1]) expect(through(x * (a.width / 2 + 0.002), 0.017).some(isStone)).toBe(true);
        expect(through(0, a.peak + 0.05 - 0.002).some(isStone)).toBe(true);
        expect(through(0, a.peak + 0.05 + 0.002).some(isStone)).toBe(true);
      }
    }
  });
});
