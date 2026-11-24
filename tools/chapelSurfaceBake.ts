// CPU only. Regenerate the surface field with node tools/bake-chapel-surface.mjs.
import * as THREE from 'three';
import { AREAS, DECK_SLABS, RAISED_Y, STAIRS, WALLS, type Box } from '../src/sim/level';
import { CHAPEL_APERTURES, CHAPEL_SURFACE_GRID as grid, type Aperture } from '../src/render/probeLighting';

const chapelGlassStart = CHAPEL_APERTURES.findIndex(a => a.bottom >= 7);
const chapelGlazing = CHAPEL_APERTURES.slice(chapelGlassStart);
const chapelPartition = WALLS.filter(w => w.x0 === 17.5 && w.x1 === 17.9);
const chapelGallery = DECK_SLABS.find(s => s.x0 === AREAS.gallery.x0 && s.x1 === AREAS.gallery.x1 && s.z0 === AREAS.gallery.z0)!;
const chapelStair = STAIRS.find(s => s.id === 'S4')!;
const stair = chapelStair.runs[0];
const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const box = (b: Box) => new THREE.Box3(vec(b.x0, b.y0 ?? 0, b.z0), vec(b.x1, b.h, b.z1));
const shaftMasonry = WALLS.filter(w => w.tag === 'holeGuard' && w.y0 === RAISED_Y).map(box);
const stairMasonry = [
  ...WALLS.filter(w => w.tag === 'stairEnd').map(box),
  ...chapelStair.landings.map(l => new THREE.Box3(vec(l.x0, RAISED_Y, l.z0), vec(l.x1, l.y, l.z1))),
];
const chapelStairSlope = (stair.to - stair.from) / (stair.x1 - stair.x0);
const chapelStairBox = new THREE.Box3(vec(stair.x0, RAISED_Y, stair.z0), vec(stair.x1, stair.from, stair.z1));
const chapelMasonryBoxes = [box(chapelGallery), ...chapelPartition.map(w => box({ ...w, y0: RAISED_Y })),
  ...shaftMasonry, ...stairMasonry];

function segmentBox(p: THREE.Vector3, q: THREE.Vector3, b: THREE.Box3) {
  let near = .003, far = .997;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = q[axis] - p[axis];
    const inv = (d < 0 ? -1 : 1) / Math.max(Math.abs(d), .0001);
    const a = (b.min[axis] - p[axis]) * inv;
    const h = (b.max[axis] - p[axis]) * inv;
    near = Math.max(near, Math.min(a, h));
    far = Math.min(far, Math.max(a, h));
  }
  return near < far;
}

export function chapelDaylightBlocked(p: THREE.Vector3, q: THREE.Vector3) {
  if (chapelMasonryBoxes.some(b => segmentBox(p, q, b))) return true;
  // Clip the segment below the pitch of S4; one wedge, not all the treads.
  const above = (v: THREE.Vector3) => v.y - stair.from - (v.x - stair.x0) * chapelStairSlope;
  const a = above(p), b = above(q);
  if (a > 0 && b > 0) return false;
  if (a > 0) p = p.clone().lerp(q, a / (a - b));
  else if (b > 0) q = p.clone().lerp(q, a / (a - b));
  return segmentBox(p, q, chapelStairBox);
}

// Unit-sky irradiance for bake quadrature. Use the same representative ray,
// two reveal planes and projected area as the visible-pane surface path.
function chapelPaneIncident(a: Aperture, p: THREE.Vector3) {
  const lateral = a.axis === 'x' ? 'z' : 'x';
  const depth = (a.plane - p[a.axis]) * a.side;
  if (depth < -.20) return;
  const near = 1 - THREE.MathUtils.smoothstep(depth, .15, 2);
  const target = vec(0, a.bottom + a.height * THREE.MathUtils.lerp(.52,
    THREE.MathUtils.clamp((p.y - a.bottom) / a.height, .25, .78), near), 0);
  target[a.axis] = a.plane + a.side * .25;
  target[lateral] = a.lateral + near * THREE.MathUtils.clamp(p[lateral] - a.lateral, -.3 * a.width, .3 * a.width);
  const reveal = (q: THREE.Vector3) => {
    const u = Math.abs(q[lateral] - a.lateral), h = q.y - a.bottom;
    const t = Math.sqrt(Math.max(0, 1 - 2 * u / a.width));
    const top = THREE.MathUtils.lerp(a.spring, a.height, t * (1.44 - .44 * t));
    return THREE.MathUtils.smoothstep(Math.min(a.width * .5 - u, h, top - h), -.025, .025);
  };
  const inner = p.clone().lerp(target, Math.max(0, (depth - .23) / (depth + .25)));
  const frame = reveal(inner) * reveal(target);
  if (!frame || chapelDaylightBlocked(p, target)) return;
  const ray = target.sub(p), d2 = ray.lengthSq(), dir = ray.normalize();
  const area = .86 * a.width * a.height;
  const flux = Math.PI * frame * a.transmission * Math.max(0, dir[a.axis] * a.side) * area / (Math.PI * d2 + area);
  return { dir, flux };
}

export function chapelPaneIrradiance(a: Aperture, p: THREE.Vector3, n: THREE.Vector3) {
  const incident = chapelPaneIncident(a, p);
  return incident ? incident.flux * Math.max(0, n.dot(incident.dir)) : 0;
}

// Small, non-overlapping pieces of the actual stone receiving the panes.
// The floor cells sit in the clear aisle (and off S2); the wall cells face
// back over the floor. Bake first-leg transfer with a 3x3 quadrature, collapse
// outgoing transport to one bounded Lambertian patch per cell. Only the
// glazing drives this return so it cannot bypass a closed movable door.
const chapelStoneCells = [
  { center: vec(15.4, RAISED_Y + .025, 14.2), n: vec(0, 1, 0), u: vec(2.8, 0, 0), v: vec(0, 0, 2.8) },
  ...[19.8, 23.7, 27.6].map(x => ({ center: vec(x, RAISED_Y + .025, 16.5), n: vec(0, 1, 0), u: vec(3.8, 0, 0), v: vec(0, 0, 1.8) })),
  ...[16.3, 22, 27.65].map(x => ({ center: vec(x, 3.7, AREAS.chapel.z0 + .025), n: vec(0, 0, 1), u: vec(5.5, 0, 0), v: vec(0, 6, 0) })),
  ...[16.3, 22, 27.65].map(x => ({ center: vec(x, 5.6, AREAS.chapel.z1 - .025), n: vec(0, 0, -1), u: vec(5.5, 0, 0), v: vec(0, 2.8, 0) })),
  { center: vec(AREAS.chapel.x1 - .025, 3.3, 16.5), n: vec(-1, 0, 0), u: vec(0, 0, 5.2), v: vec(0, 2.6, 0) },
];
export const CHAPEL_STONE_RETURN = chapelStoneCells.map(({ center, n, u, v }) => {
  const area = u.length() * v.length();
  let irradiance = 0;
  for (const du of [-1/3, 0, 1/3]) for (const dv of [-1/3, 0, 1/3]) {
    const p = center.clone().addScaledVector(u, du).addScaledVector(v, dv);
    for (const opening of chapelGlazing) irradiance += chapelPaneIrradiance(opening, p, n) / 9;
  }
  // Diffuse stone albedo times incident energy. No feedback or cross-cell gain.
  const flux = .40 * irradiance * area;
  return { center, n, area, flux };
});

const axes = ['x', 'y', 'z'] as const;
function accumulate(cube: number[], dir: THREE.Vector3, flux: number) {
  for (const [i, axis] of axes.entries()) {
    const component = dir[axis];
    if (component !== 0) cube[i + (component < 0 ? 3 : 0)] += flux * Math.abs(component);
  }
}

export function bakeChapelSurfaceTransport(): Uint8Array<ArrayBuffer> {
  const { nx, ny, nz, step, range } = grid;
  const bankStride = 4 * nx * nz * ny;
  const data = new Uint8Array(2 * bankStride);
  const p = vec(0, 0, 0);
  for (let y = 0; y < ny; ++y) for (let z = 0; z < nz; ++z) for (let x = 0; x < nx; ++x) {
    const height = grid.y + Math.min(y,grid.fineLayers)*step + Math.max(0,y-grid.fineLayers)*grid.upperStep;
    p.set(grid.x + x * step, height, grid.z + z * step);
    const vault = Math.max(16.2 - (5.6/5.8)*Math.abs(p.z-16.5), p.z < 16.5 ? 14.685-(3.8/2.9)*Math.abs(p.x-18) : 0);
    if (p.y > vault) continue;
    // Black probes inside masonry prevent interpolating transport straight
    // across solid baffles. Runtime samples bias onto the geometric air side.
    if (chapelMasonryBoxes.some(b => b.containsPoint(p)) ||
        (chapelStairBox.containsPoint(p) && p.y < stair.from + (p.x - stair.x0) * chapelStairSlope)) continue;
    const direct = [0, 0, 0, 0, 0, 0], bounce = [0, 0, 0, 0, 0, 0];
    for (const pane of chapelGlazing) {
      const incident = chapelPaneIncident(pane, p);
      // The legacy diffuse coefficients hold the projected hemisphere
      // fraction; add only the missing radiance-to-irradiance conversion.
      // A downward view through the pane sees the ground, not open sky.
      // Ease through the horizon rather than turning the high vault emissive.
      if (incident) accumulate(direct, incident.dir, (1 - 1 / Math.PI) * incident.flux * THREE.MathUtils.smoothstep(incident.dir.y, 0, .12));
    }
    for (const stone of CHAPEL_STONE_RETURN) {
      const dir = stone.center.clone().sub(p), d2 = dir.lengthSq();
      if (d2 < 1e-8) continue;
      dir.multiplyScalar(1 / Math.sqrt(d2));
      const facing = -dir.dot(stone.n);
      if (facing <= 0 || chapelDaylightBlocked(p, stone.center)) continue;
      accumulate(bounce, dir, stone.flux * facing / (Math.PI * d2 + stone.area));
    }
    const offset = 4 * (x + nx * (z + nz * y));
    for (let channel = 0; channel < 6; ++channel) {
      const transfer = Math.min(direct[channel], .82) + Math.min(bounce[channel], .22);
      const address = offset + channel % 3 + (channel >= 3 ? bankStride : 0);
      // Square-root storage keeps the faintest useful return above one LSB.
      data[address] = Math.round(255 * Math.sqrt(Math.min(1, transfer / range)));
    }
  }
  return data;
}
