import { Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Batch } from '../src/render/geom';
import { addYardBreaks } from '../src/render/yardBreaks';
import { addGroundSlab, buildYardDrain } from '../src/render/yardSurface';
import { AREAS, inArea, SUBGRADE_GROUND_CUTOUTS } from '../src/sim/level';

it('fits the gutter dressing inside the north apron, below treads and outside shaft cutouts', () => {
  const batch = new Batch(), scene = new Group();
  const stone = new MeshStandardMaterial(), iron = new MeshStandardMaterial(), bed = new MeshStandardMaterial();
  buildYardDrain(batch, stone, iron, bed);
  batch.build(scene);
  expect(scene.children.length).toBe(3);
  const pos = new Vector3();
  for (const mesh of scene.children as Mesh[]) {
    const verts = mesh.geometry.getAttribute('position');
    for (let i = 0; i < verts.count; i++) {
      pos.fromBufferAttribute(verts, i);
      expect(pos.y).toBeLessThanOrEqual(0.03);
      expect(inArea(AREAS.courtyard, pos.x, -pos.z)).toBe(true);
      expect(-pos.z).toBeGreaterThan(27.5);
      expect(SUBGRADE_GROUND_CUTOUTS.some((r) => inArea(r, pos.x, -pos.z))).toBe(false);
    }
  }
});

it('keeps scanned paving continuous across the shaft splits without sealing the opening', () => {
  const batch = new Batch(), scene = new Group();
  const r = { x0: -10.5, z0: 0, x1: 10.5, z1: 29 }, tile = 3.6;
  addGroundSlab(batch, new MeshStandardMaterial(), r, -0.3, 0, tile);
  batch.build(scene);
  const geo = (scene.children[0] as Mesh).geometry;
  const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv'), norm = geo.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    if (norm.getY(i) < 0.99) continue;
    expect(uv.getX(i)).toBeCloseTo((pos.getX(i) - r.x0) / tile, 5);
    expect(uv.getY(i)).toBeCloseTo((-pos.getZ(i) - r.z0) / tile, 5);
  }
  const down = (x: number, z: number) => new Raycaster(new Vector3(x, 1, -z), new Vector3(0, -1, 0), 0, 2).intersectObjects(scene.children).length;
  expect(down(4.58, 9.97)).toBeGreaterThan(0);
  expect(down(4.62, 9.97)).toBe(0);
  expect(down(9.95, 9.97)).toBe(0);
});

it('keeps the broken flags in three local pockets, below a boot sole clearance and outside the shafts', () => {
  const mat = new MeshStandardMaterial(), batch = new Batch(), scene = new Group();
  addYardBreaks(batch, { flag: mat }, { rock: mat, floorDirt: mat, floorFlagWorn: mat });
  batch.build(scene);
  const areas = [
    { x0: -3.0, x1: -0.98, z0: 10.0, z1: 11.1 },
    { x0: -6.4, x1: -4.45, z0: 17.2, z1: 18.3 },
    { x0: -5.65, x1: -3.0, z0: 24.15, z1: 25.4 },
  ];
  const peaks = areas.map(() => -Infinity);
  for (const mesh of scene.children as Mesh[]) {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = -pos.getZ(i);
      const site = areas.findIndex(r => inArea(r, x, z));
      expect(site).toBeGreaterThanOrEqual(0);
      expect(SUBGRADE_GROUND_CUTOUTS.some(r => inArea(r, x, z))).toBe(false);
      peaks[site] = Math.max(peaks[site], y);
    }
  }
  for (const h of peaks) {
    expect(h).toBeGreaterThan(0.02); // Some relief must actually remain.
    expect(h).toBeLessThan(0.04);
  }
});
