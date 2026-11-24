import { CHAPEL_APERTURES } from '../src/render/probeLighting';
import { CHAPEL_AIR_BAFFLES, CHAPEL_AIR_GRID, CHAPEL_AIR_WALL_GROUPS, CHAPEL_REVEAL as REVEAL } from '../src/render/post/airVolume';

// Offline only. Regenerate with node tools/bake-chapel-sky.mjs.
const chapelRoof = (x: number, z: number) => Math.max(16.2-(5.6/5.8)*Math.abs(z+16.5),
  z > -16.5 ? 14.685-(3.8/2.9)*Math.abs(x-18) : 0); // cross-gable is a real opening into the main roof
// Same interior baffles as the live key; low S2 guards matter only to the
// source leg, not the traversable volume.
const chapelBlockers = CHAPEL_AIR_BAFFLES.map(w => [w.x0, w.y0 ?? 0, -w.z1, w.x1, w.h, -w.z0] as const);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x-a)/(b-a)));
  return t*t*(3-2*t);
};
const chapelWindows = CHAPEL_AIR_WALL_GROUPS.flat().map(i => {
  const a = CHAPEL_APERTURES[i];
  const xWall = a.axis === 'x';
  // Compact silhouette of the actual quarry layout. Approximate the lancet
  // heads/cusps at this field's resolution, not a solid white arch. The live
  // shadow map resolves fine tracery and bars for the separate direct term.
  const great = a.width > 3;
  const single = a.width < 1;
  const lancet = (u: number, v: number, c: number, r: number, spring: number, tip: number) => {
    const t = Math.abs(u-c)/r;
    return t < 1 && v > .025 && v < spring+(tip-spring)*Math.sqrt(1-t);
  };
  const taps: { u: number; h: number }[] = [];
  const nx = great ? 12 : single ? 4 : 9, ny = great ? 14 : 8;
  for (let j=0; j<ny; ++j) for (let i=0; i<nx; ++i) {
    const u = (i+.5)*2/nx-1, v = (j+.5)/ny, s = Math.abs(u);
    const open = single ? lancet(u,v,0,.88,.58,.95) : great
      ? lancet(u,v,0,.206,.494,.657) || lancet(s,v,.42,.166,.461,.581) || lancet(s,v,.783,.15,.394,.511)
        || ((s-.71)/.20)**2+((v-.64)/.115)**2 < 1 || (s/.39)**2+((v-.825)/.125)**2 < 1
      : lancet(s,v,.485,.415,.54,.76) || s/.38+Math.abs(v-.83)/.122 < 1;
    if (open) taps.push({u: u*a.width*.5, h: v*a.height});
  }
  const depth = great ? .1354 : .0833; // seat behind the inner tracery bevel
  const areaPerTap = a.width*a.height/(nx*ny);
  // CHAPEL_APERTURES contains effective glazing *and* open fraction. Here
  // the quadrature already accounts for open fraction; retain glass loss only.
  const glass = Math.min(.8, a.transmission*nx*ny/taps.length);
  return { i, a, xWall, depth, areaPerTap: areaPerTap*glass, taps };
});

/** Static diffuse transfer at a point, in render world. Used to generate the
 * compact sky field once; no window loop, per-frame bake, or extra scene draw. */
export function chapelSkyVisibility(x: number, y: number, z: number, only?: number): number {
  const [lx,ly,lz] = CHAPEL_AIR_GRID.lo, [hx,hy,hz] = CHAPEL_AIR_GRID.hi;
  if (x < lx || x > hx || y < ly || y > hy || z < lz || z > hz || y >= chapelRoof(x,z)) return 0;
  let sky = 0;
  for (const {i,a,xWall,depth,areaPerTap,taps} of chapelWindows) {
    if (only !== undefined && only !== i) continue;
    // Work in reveal coordinates until the cheap lip/elevation vetoes pass.
    const recess = xWall ? (a.plane-x)*a.side : (a.plane+z)*a.side;
    const side = xWall ? -z-a.lateral : x-a.lateral;
    const width = a.width*.5, rise = y-a.bottom;
    if (recess <= REVEAL || rise >= a.height) continue;
    const d = recess-depth, invD = 1/d;
    const outer = 1+(REVEAL+depth)*invD, inner = 1-(REVEAL-depth)*invD;
    for (const tap of taps) {
      const du = tap.u-side, dy = tap.h-rise;
      if (dy <= 0) continue; // no sky leg below the visible horizon
      const edge = (t: number) => {
        const s = Math.abs(side+du*t), h = rise+dy*t;
        const u = Math.sqrt(Math.max(0,1-s/width));
        const head = a.spring+(a.height-a.spring)*u*(1.44-.44*u);
        return Math.min(width-s,h,head-h);
      };
      const reveal = Math.min(edge(outer), edge(inner));
      if (reveal <= 0) continue;
      const dx = xWall ? a.side*d : du, dz = xWall ? -du : -a.side*d;
      // Box legs use the actual partition and gallery/slabs. The door isn't
      // a diffuse emitter in this field, even when it's open.
      const ix = 1/(dx || 1e-6), iy = 1/dy, iz = 1/(dz || 1e-6);
      let blocked = false;
      for (const [x0,y0,z0,x1,y1,z1] of chapelBlockers) {
        if ((y > y1) || (y+dy < y0)) continue;
        const ax=(x0-x)*ix, bx=(x1-x)*ix, ay=(y0-y)*iy, by=(y1-y)*iy, az=(z0-z)*iz, bz=(z1-z)*iz;
        if (Math.max(0,Math.min(ax,bx),ay,Math.min(az,bz)) < Math.min(1,Math.max(ax,bx),by,Math.max(az,bz))) {
          blocked = true; break;
        }
      }
      if (blocked) continue;
      const d2 = d*d+du*du+dy*dy, invLength = 1/Math.sqrt(d2);
      const elevation = dy*invLength;
      // Soft overcast dome: ~3:1 zenith vs horizon luminance, with low sky
      // further masked by surrounding terrain/stone. Projected solid angle
      // (cosine / r²) and soft reveals shape the field under each opening.
      // Not aligned to the key, and no constant ambient floor under the lobes.
      const skyLobe = smooth(.18,.78,elevation)*(.34+.66*elevation);
      sky += smooth(0,.09,reveal)*skyLobe*d*invLength*areaPerTap/(Math.PI*d2+areaPerTap);
    }
  }
  return sky;
}

export function bakeChapelSkyField(): Uint8Array<ArrayBuffer> {
  const {lo,hi,size:[nx,ny,nz],maxSky} = CHAPEL_AIR_GRID;
  const data = new Uint8Array(nx*ny*nz);
  for (let k=0,i=0; k<nz; ++k) for (let j=0; j<ny; ++j) for (let l=0; l<nx; ++l) {
    const x=lo[0]+(hi[0]-lo[0])*l/(nx-1), y=lo[1]+(hi[1]-lo[1])*j/(ny-1), z=lo[2]+(hi[2]-lo[2])*k/(nz-1);
    data[i++] = Math.round(255*Math.sqrt(Math.min(1,chapelSkyVisibility(x,y,z)/maxSky)));
  }
  return data;
}
