import data from '../src/render/baked/court.irr.bin?url&inline';
import { expect, it } from 'vitest';
import { PROBE_COUNT, PROBE_GRID as g } from '../src/render/probeGrid';
import { SCARP_SOLIDS } from '../src/sim/southScarp';
import { circleBlocked } from '../src/sim/collision';

it('stores a directional sky field, a warmer bounce, and stronger near occlusion below the arcade', () => {
  const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c => c.charCodeAt(0));
  expect(bytes.length).toBe(PROBE_COUNT * 8);
  function probe(x: number, y: number, z: number) {
    const i = 4 * (Math.round((x-g.x)/g.dx) + g.nx * (Math.round((z-g.z)/g.dx) + g.nz * Math.round((y-g.y)/g.dy)));
    const reflected = 4 * PROBE_COUNT + i;
    return { sky: bytes[i+3], up: bytes[i+1], red: bytes[reflected], blue: bytes[reflected+2], near: bytes[reflected+3] };
  }
  const roof = probe(-10.26, 2.83, 11.9), court = probe(0, 0.9, 8), sky = probe(0, 9, 15);
  expect(court.sky).toBeGreaterThan(roof.sky + 50);
  expect(roof.near).toBeGreaterThan(court.near);
  expect(roof.red).toBeGreaterThan(roof.blue);
  expect(roof.blue).toBeGreaterThan(0);
  expect(sky.up).toBeGreaterThan(180);
  expect(sky.sky).toBeGreaterThan(240);
});

it('the exposed bedding narrows the inner gate approach and opens diagonally towards the cart', () => {
  const blocked = (x: number, z: number) => circleBlocked(x,z,0.25,SCARP_SOLIDS,[]);
  expect(blocked(-9, 3.8)).toBe(true);
  expect(blocked(-4.4, 3.8)).toBe(false);
  expect(blocked(-4.4, 1.2)).toBe(true);
  expect(blocked(-2.0, 1.2)).toBe(false);
});
