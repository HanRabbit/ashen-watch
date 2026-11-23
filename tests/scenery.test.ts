import { Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildScenery } from '../src/render/scenery';
import { SUBGRADE_GROUND_CUTOUTS } from '../src/sim/level';

it('does not draw valley terrain in either stair opening or under the storeroom ceiling', () => {
  const { group } = buildScenery();
  const land = group.children.filter((o) => o.name === 'valley terrain and ridges');
  group.updateMatrixWorld(true);
  const count = (x: number, z: number) =>
    new Raycaster(new Vector3(x, 2, -z), new Vector3(0, -1, 0), 0, 4).intersectObjects(land).length;
  for (const r of SUBGRADE_GROUND_CUTOUTS) {
    // Check near the exact edges as well as at the centre so a whole grid cell
    // cannot quietly overlap one side of a shaft.
    for (const x of [r.x0 + 0.015, (r.x0 + r.x1) / 2, r.x1 - 0.015]) {
      for (const z of [r.z0 + 0.015, (r.z0 + r.z1) / 2, r.z1 - 0.015]) {
        expect(count(x, z)).toBe(0);
      }
    }
  }
  expect(count(4.55, 9.9)).toBeGreaterThan(0);
});
