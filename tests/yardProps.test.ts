import { Box3, Group, MeshPhysicalMaterial, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Batch } from '../src/render/geom';
import { addYardProp } from '../src/render/yardProps';
import { PROPS } from '../src/sim/level';

for (const tag of ['cart', 'scaffold', 'crateStack']) {
  it(`keeps ${tag} and its projecting hardware inside the original cover footprint`, () => {
    const p = PROPS.find((p) => p.tag === tag)!;
    const mat = new MeshPhysicalMaterial();
    const yardWood = { woodBeam: mat, woodPlank: mat, woodFloorOld: mat, wallTrim: mat, clothLinen: mat };
    const batch = new Batch(), scene = new Group();
    addYardProp(batch, p, { iron: mat }, yardWood);
    batch.build(scene);
    const bounds = new Box3().setFromObject(scene, true);
    const limit = new Box3(new Vector3(p.x0, p.y0 ?? 0, -p.z1), new Vector3(p.x1, p.h, -p.z0)).expandByScalar(1e-5);
    expect(bounds.isEmpty()).toBe(false);
    expect(limit.containsBox(bounds)).toBe(true);
    // A replacement that fits but no longer provides a cover silhouette also fails.
    expect(bounds.max.y).toBeGreaterThan(p.h * 0.82);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan((p.x1 - p.x0) * 0.85);
  });
}
