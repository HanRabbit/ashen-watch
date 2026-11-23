import { Group, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Batch } from '../src/render/geom';
import { addYardArcade } from '../src/render/yardArcade';
import { WALLS } from '../src/sim/level';

it('spans the actual piers, with a solid head and standing clearance across each bay', () => {
  const scene = new Group(), b = new Batch(), stone = new MeshStandardMaterial();
  addYardArcade(b, stone, stone); b.build(scene);
  const hits = (y: number, z: number) => new Raycaster(new Vector3(9.5,y,-z), new Vector3(1,0,0), 0, 1.3).intersectObjects(scene.children).length;
  const piers = WALLS.filter(w => w.tag === 'pier').sort((a,c) => a.z0-c.z0);
  expect(piers.length - 1).toBe(3);
  for (let i = 1; i < piers.length; i++) {
    const l = piers[i-1].z1, r = piers[i].z0;
    for (const z of [l+0.05, (l+r)/2, r-0.05]) expect(hits(2.30,z)).toBe(0);
    expect(hits(3.0,(l+r)/2)).toBe(0);
    expect(hits(3.60,(l+r)/2)).toBeGreaterThan(0);
    expect(hits(3.15,l+0.065)).toBeGreaterThan(0);
  }
});
