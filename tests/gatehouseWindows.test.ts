import { Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildGatehouseLights, GATEHOUSE_LIGHTS, type WallPiece, windowWallPieces } from '../src/render/gatehouseWindows';
import { Batch } from '../src/render/geom';
import { WALLS } from '../src/sim/level';

for (const a of GATEHOUSE_LIGHTS) {
  it(`opens the ${a.hearth ? 'court' : 'rear'} window on both faces, with a deep reveal, intact sill and head`, () => {
    const scene = new Group(), b = new Batch();
    const stone = new MeshStandardMaterial(), lead = new MeshStandardMaterial();
    // Include the simulation's full-thickness wall, plus the separate inner stone skin.
    const walls: WallPiece[] = WALLS.filter(w => w.y0 === undefined).map(w => ({ ...w, y0: 0 }));
    walls.push({ x0: -3, x1: 3, z0: -8, z1: -7.94, y0: 0.05, h: 3.5 });
    for (const wall of walls) for (const p of windowWallPieces(wall)) {
      b.box(stone, p.x0, p.z0, p.x1, p.z1, p.y0, p.h);
    }
    const { windowMat, hearthWindowMat } = buildGatehouseLights(b, scene, stone, lead);
    const glazing = a.hearth ? hearthWindowMat : windowMat;
    b.build(scene);
    scene.updateMatrixWorld(true);
    // Both lights reuse a single opaque stone batch and a single opaque iron batch.
    expect(scene.children).toHaveLength(4);
    expect(glazing.transparent && !glazing.depthWrite).toBe(true);
    expect(glazing.specularIntensity).toBeLessThan(0.6);
    for (const side of [-1, 1]) {
      const mid = (a.z0+a.z1)/2, travel = (a.z1-a.z0)+0.75;
      const cast = (dx: number, dy: number) => new Raycaster(
        new Vector3(a.x+dx, a.bottom+dy, -mid + side*travel/2), new Vector3(0,0,-side), 0, travel,
      ).intersectObjects(scene.children);
      const clear = cast(0.093, 0.47);
      expect(clear.map(hit => (hit.object as Mesh).material)).not.toContain(stone);
      const panes = clear.filter(hit => (hit.object as Mesh).material instanceof MeshPhysicalMaterial);
      expect(panes.map(hit => (hit.object as Mesh).material)).toEqual([glazing]);
      const mouth = side === 1 ? a.z0 : a.z1;
      const weather = a.hearth ? side === -1 : side === 1;
      expect(Math.abs(-panes[0].point.z - mouth)).toBeGreaterThan(weather ? 0.32 : 0.15);
      for (const [dx, dy] of [[0, -0.05], [a.width/2+0.04, 0.45], [0, a.peak+0.06]]) {
        expect(cast(dx, dy).some(hit => (hit.object as Mesh).material === stone)).toBe(true);
      }

      // Start inside the width of the mouth, then skim across the same jamb
      // from both sides. The solid splay, not a dark pane or the exterior wall,
      // must be the first thing that blocks the view.
      const standoff = 0.38, slope = 0.65;
      const oblique = new Raycaster(new Vector3(a.x+0.28-slope*standoff, a.bottom+0.47, -mouth+side*standoff),
        new Vector3(slope, 0, -side).normalize(), 0, travel).intersectObjects(scene.children);
      const hit = oblique[0];
      expect((hit.object as Mesh).material).toBe(stone);
      expect(hit.face!.normal.x).toBeLessThan(-0.65);
      expect(Math.abs(-hit.point.z - mouth)).toBeGreaterThan(0.05);
      expect(oblique.some(h => (h.object as Mesh).material === glazing)).toBe(false);
    }
  });
}
