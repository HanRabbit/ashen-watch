import { Color, DoubleSide, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { chapelGlass, finishChapelGlazing, glazedWall } from '../src/render/chapelWindows';
import { Batch } from '../src/render/geom';

it('keeps the great window open through both wall faces, with load-bearing stone between the lights', () => {
  const mat = () => new MeshStandardMaterial({ side: DoubleSide });
  const ash = mat(), trim = mat(), iron = mat(), glass = mat();
  const b = new Batch(), scene = new Group();
  glazedWall(b, { ash, trim, iron, glass, lead: iron }, { x: 0, y: 0, z: 0, rot: 0, width: 11, eaves: 4, peak: 9.2,
    lights: [{ u: 0, sill: 0.9, width: 4, spring: 3.10, height: 6.10, pattern: 'great' }],
  });
  b.build(scene); finishChapelGlazing(scene, glass); scene.updateMatrixWorld(true);
  for (const object of scene.children as Mesh[]) {
    expect(object.castShadow).toBe(object.material !== glass);
    expect(object.receiveShadow).toBe(object.material !== glass); // VSM also draws receivers
  }
  for (const side of [-1, 1]) {
    const cast = (x: number, y: number) => new Raycaster(new Vector3(x,y,side), new Vector3(0,0,-side), 0, 2)
      .intersectObjects(scene.children);
    const hits = (x: number, y: number) => cast(x,y).map(hit => (hit.object as Mesh).material);
    const pane = cast(0.13, 2.2).find(hit => (hit.object as Mesh).material === glass);
    expect(pane?.point.z).toBeCloseTo(-0.1354, 4);

    for (const [x,y] of [[0.13, 2.2], [0.75, 2.2], [-1.45, 2.2], [0.01, 6.23]]) {
      const through = hits(x,y);
      expect(through).toContain(glass);
      expect(through).not.toContain(ash);
      expect(through).not.toContain(trim);
    }
    expect(hits(0.461, 2.2)).toContain(trim);
    expect(hits(2.7, 1.8)).toContain(ash);
  }
  const seat = new Vector3(0.21, 2.2, -0.1354);
  const first = (side: number) => {
    const origin = seat.clone().add(new Vector3(side, 0, side));
    return new Raycaster(origin, seat.clone().sub(origin).normalize(), 0, 2).intersectObjects(scene.children)[0];
  };
  // The very same spot on the central light is hidden behind a mullion from
  // the raking exterior angle, but is glass-first from the nave side.
  expect((first(1).object as Mesh).material).toBe(trim);
  expect((first(-1).object as Mesh).material).toBe(glass);
});

it('drives the quarry transmission from the staged sky rather than a residual emissive floor', () => {
  const sky = new Color(0, 0, 0);
  const { glass, lead } = chapelGlass(sky);
  expect(glass.emissive).toBe(sky);
  expect(glass.emissive.getHex()).toBe(0);
  sky.setRGB(.7, .8, 1);
  expect(glass.emissive.b * glass.emissiveIntensity).toBeGreaterThan(0);
  expect(lead.emissive.getHex()).toBe(0);
});
