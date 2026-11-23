import { Group, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildCourtContact } from '../src/render/courtContact';
import { Batch } from '../src/render/geom';
import { addCourtyardGround, buildYardDrain } from '../src/render/yardSurface';
import { addYardBreaks } from '../src/render/yardBreaks';
import { YARD_DRAIN } from '../src/render/yardWeather';
import { S1_SHAFT, supportY } from '../src/sim/level';

it('reads the actual batched soil, flags, broken stones and grate, not a smoothed copy or the slab bottom', () => {
  const b = new Batch(), group = new Group(), m = new MeshStandardMaterial();
  const model = buildCourtContact(include => b.observeGeometry(include, () => {
    addCourtyardGround(b, m, m, m);
    buildYardDrain(b, m, m, m);
    addYardBreaks(b, { flag: m }, { floorFlagWorn: m, rock: m });
  }));
  b.build(group);
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 2);
  let min = Infinity, max = -Infinity;
  // Include both sides of a tilted flag, the exposed bed, hand-placed spalls,
  // a transformed grate bar and thresholds; this ray uses the final meshes.
  const points = [[-2.3, 10.65], [-5.90, 17.87], [-5.09, 24.69], [YARD_DRAIN.x, YARD_DRAIN.z],
    [-.23, .31], [1.94, 15.93], [S1_SHAFT.x0 + .14, S1_SHAFT.z0 + .23]];
  for (let i = 0; i < 150; i++) points.push([Math.sin(i * 12.43) * 9.63, 1.21 + (i * .741) % 26.32]);
  for (const [x, z] of points) {
    ray.ray.origin.set(x, 1, -z);
    const h = model.heightAt(x, z), meshY = ray.intersectObjects(group.children)[0]?.point.y;
    if (meshY === undefined) expect(h).toBeUndefined();
    else { expect(h).toBeCloseTo(meshY, 5); min = Math.min(min, h!); max = Math.max(max, h!); }
  }
  expect(model.heightAt(4.62, 9.97)).toBeUndefined();
  expect(model.heightAt(-22, 19)).toBeUndefined();
  expect(min).toBeLessThan(-.030);
  expect(max).toBeGreaterThan(.02);
  expect(supportY(1.94, 15.93, 0)?.y).toBe(0);
});
