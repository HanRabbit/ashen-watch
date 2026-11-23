import * as THREE from 'three';
import type { Batch } from './geom';
import { isBaileyApronSlab } from '../sim/baileyApron';
import { MAIN_COURT } from '../sim/courtPlan';
import { NORTH_ARCHES, NORTH_OPENING, NORTH_OUTLINE, NORTH_SLAB_BOTTOM } from '../sim/northCourt';
import { COURTYARD_SLABS, cutRect, type Rect, SUBGRADE_GROUND_CUTOUTS } from '../sim/level';
import { tiledBox } from './materials';
import { addBaileyApronGround } from './baileyApron';
import { addBaileyPaving, YARD_DRAIN_CHANNEL } from './baileyPaving';
import { addNorthGroundSlab, addNorthPaving } from './northCourt';
import { YARD_DRAIN } from './yardWeather';

/** Top UVs use the unsplit slab's lower-left corner, not the centre of each piece.
 * tiledBox UVs start at zero even when a cut has changed the width/depth. */
export function addGroundSlab(b: Batch, mat: THREE.Material, rect: Rect, y0: number, h: number, tile: number, origin: Rect = rect): void {
  const pieces = SUBGRADE_GROUND_CUTOUTS.reduce((slabs, cut) => slabs.flatMap((r) => cutRect(r, cut)), [rect]);
  for (const p of pieces) {
    const g = tiledBox(p.x1 - p.x0, h - y0, p.z1 - p.z0, tile);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + (p.x0 - origin.x0) / tile, uv.getY(i) + (p.z0 - origin.z0) / tile);
    b.geo(mat, g, (p.x0 + p.x1) / 2, (y0 + h) / 2, (p.z0 + p.z1) / 2);
  }
}

/** The main court uses a fitted surface. Wing slabs and the two polygonal
 * outer courts share its grade at the survey seams. */
export function addCourtyardGround(b: Batch, flags: THREE.Material, cobbles: THREE.Material, wornFlags = flags): void {
  for (const s of COURTYARD_SLABS) {
    if (s.tag === 'northSlab' || isBaileyApronSlab(s)) continue;
    if (s.x1 <= MAIN_COURT.x0) addGroundSlab(b, cobbles, s, s.y0!, s.h, 3.6, MAIN_COURT);
  }
  addBaileyPaving(b, flags, wornFlags);
  addBaileyApronGround(b, cobbles, wornFlags);
  addNorthGroundSlab(b, cobbles, NORTH_OUTLINE, NORTH_SLAB_BOTTOM);
  // Surviving flags fan out from the two throats. The rest is exposed cobble.
  const pavingEnd = NORTH_OPENING.z1 + 1.25;
  for (const [i, bay] of NORTH_ARCHES.entries()) {
    const { x0, x1, z1, center } = bay;
    const drift = i === 0 ? -.56 : .5;
    addNorthPaving(b, wornFlags, [
      { x: x0 + .24, z: z1 + .035 }, { x: x1 - .22, z: z1 + .035 },
      { x: center + drift + 1.28, z: pavingEnd - .18 }, { x: center + drift + .38, z: pavingEnd + .21 },
      { x: center + drift - .98, z: pavingEnd },
    ], .005, 2.35);
  }
}

/** Set into the apron, with its shallow relief wholly below a boot tread. The
 * dark bottom prevents the flat underlying scan from showing between the bars. */
export function buildYardDrain(b: Batch, stone: THREE.Material, iron: THREE.Material, bed: THREE.Material): void {
  const { x, z, length: l, width: w } = YARD_DRAIN;
  const { x0, x1, z0, z1 } = YARD_DRAIN_CHANNEL;
  b.box(bed, x0, z0, x1, z1, -0.036, -0.027, 0.42);
  for (const side of [-1, 1]) {
    const zz = z + side * (w / 2 + 0.074);
    // Replaced curb pieces straddle different joints on the two faces of the gutter.
    const seams = side < 0 ? [-0.77, -0.31, 0.14, 0.60, 0.82] : [-0.84, -0.53, -0.12, 0.44, 0.79];
    for (let i = 1; i < seams.length; i++) {
      const a = seams[i - 1], c = seams[i];
      const d = (i % 3) * 0.012;
      b.box(stone, x + a + 0.009, zz - 0.073 + d, x + c - 0.007, zz + 0.07,
        -0.025, 0.019 + 0.003 * (i % 3), 0.87);
    }
  }
  for (const zz of [z0 + 0.018, z1 - 0.019]) b.box(iron, x0, zz - 0.017, x1, zz + 0.017, 0.003, 0.02, 0.73);
  for (let i = 0; i < 13; i++) {
    const xx = x0 + 0.022 + (l - 0.046) * i / 12;
    const drift = 0.008 * Math.sin(i * 1.37);
    b.geo(iron, new THREE.BoxGeometry(0.029 + (i % 3) * 0.003, 0.019, w - 0.024), xx + drift, 0.016, z,
      0.042 * Math.sin(i * 3.4));
  }
}
