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
    buildGatehouseLights(b, scene, stone, lead);
    b.build(scene);
    scene.updateMatrixWorld(true);
    for (const side of [-1, 1]) {
      const mid = (a.z0+a.z1)/2, travel = (a.z1-a.z0)+0.75;
      const cast = (dx: number, dy: number) => new Raycaster(
        new Vector3(a.x+dx, a.bottom+dy, -mid + side*travel/2), new Vector3(0,0,-side), 0, travel,
      ).intersectObjects(scene.children);
      const clear = cast(0.093, 0.47).map(hit => (hit.object as Mesh).material);
      expect(clear).not.toContain(stone);
      const pane = clear.filter(mat => mat instanceof MeshPhysicalMaterial);
      expect(pane).toHaveLength(1);
      expect((pane[0] as MeshPhysicalMaterial).transparent).toBe(true);
      for (const [dx, dy] of [[0, -0.05], [a.width/2+0.04, 0.45], [0, a.peak+0.06]]) {
        expect(cast(dx, dy).some(hit => (hit.object as Mesh).material === stone)).toBe(true);
      }
    }
  });
}
