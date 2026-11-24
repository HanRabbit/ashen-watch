import * as THREE from 'three';
import { WALLS } from '../sim/level';
import { archHeader, Batch } from './geom';

/** The walk is carried on three arches in the vertical Z/Y plane. Take the span
 * from the *faces* of the same piers players walk between, not decorative centres. */
export function addYardArcade(b: Batch, rubble: THREE.Material, dressed: THREE.Material): void {
  const piers = WALLS.filter(w => w.tag === 'pier').sort((a, c) => a.z0 - c.z0);
  const spring = 2.48, crown = 3.48;
  for (const p of piers) {
    b.edgeBox('stone', dressed, p.x0 - 0.07, p.z0 - 0.047, p.x1 + 0.065, p.z1 + 0.047, spring - 0.12, spring, 1.6);
  }
  for (let bay = 1; bay < piers.length; bay++) {
    const near = piers[bay-1], far = piers[bay];
    const cx = (near.x0+near.x1)/2, cz = (far.z0+near.z1)/2, span = far.z0-near.z1;
    const depth = near.x1-near.x0;
    b.geo(rubble, archHeader(span, spring, crown, 3.707, depth), cx, 0, cz, Math.PI/2);
    // Narrow bed joints expose the backing masonry; the intrados and two weather
    // faces belong to the same voussoir, rather than a curved tube hung below the walk.
    const point = (side: number, t: number, ring: number): [number, number] => [
      side * (span/2+ring) * (1-t*t), spring + (crown-spring+ring) * (1.44*(1-t)*t+t*t),
    ];
    const n = span > 3 ? 6 : 5;
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
      const a = (i+0.013)/n, c = (i+0.987)/n, mid = (a+c)/2;
      const band = 0.15 + 0.023*Math.cos((i+bay)*2.1);
      const shape = new THREE.Shape();
      shape.moveTo(...point(side, a, -0.012));
      for (const t of [mid, c]) shape.lineTo(...point(side, t, -0.012));
      for (const t of [c, mid, a]) shape.lineTo(...point(side, t, band));
      shape.closePath();
      const d = depth+0.066+0.014*Math.sin(i*1.74+side);
      const stone = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSegments: 1, bevelThickness: 0.004, bevelSize: 0.004 });
      const uv = stone.getAttribute('uv');
      for (let j = 0; j < uv.count; j++) uv.setXY(j, 0.28 + 0.097*uv.getX(j), 0.30 + 0.087*uv.getY(j) + (i%3)*0.24);
      stone.translate(0, 0, -d/2);
      b.geo(dressed, stone, cx, 0, cz, Math.PI/2);
    }
  }
}
