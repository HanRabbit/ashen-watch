import type { BufferGeometry } from 'three';
import { MAIN_COURT } from '../sim/courtPlan';

/** Visual-only top of the fitted court, in simulation coordinates. Build once
 * from the same transformed triangles the renderer batches, before merging
 * them with unrelated masonry. No GPU readback or per-frame scene raycast. */
export interface CourtContact { heightAt(x: number, z: number): number | undefined }

const { x0, x1, z0, z1 } = MAIN_COURT;
const cellsPerMetre = 4;
const cols = Math.ceil((x1 - x0) * cellsPerMetre), rows = Math.ceil((z1 - z0) * cellsPerMetre);
const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - x0) * cellsPerMetre)));
const row = (z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - z0) * cellsPerMetre)));

export function buildCourtContact(collect: (include: (geo: BufferGeometry) => void) => void): CourtContact {
  // Barycentric transform + three heights per triangle; cells hold offsets
  // only. Keep setup precision at thin bevels and small, oblique grate bars.
  const faces: number[] = [], bins: number[][] = Array.from({ length: cols * rows }, () => []);
  collect(geo => {
    const p = geo.getAttribute('position'), ix = geo.index;
    for (let n = 0, count = ix?.count ?? p.count; n < count; n += 3) {
      const a = ix ? ix.getX(n) : n, b = ix ? ix.getX(n + 1) : n + 1, c = ix ? ix.getX(n + 2) : n + 2;
      const ax = p.getX(a), az = -p.getZ(a), bx = p.getX(b), bz = -p.getZ(b), cx = p.getX(c), cz = -p.getZ(c);
      const lx = Math.min(ax, bx, cx), hx = Math.max(ax, bx, cx), lz = Math.min(az, bz, cz), hz = Math.max(az, bz, cz);
      if (lx >= x1 || hx <= x0 || lz >= z1 || hz <= z0) continue;
      const dx = bx - ax, dz = bz - az, ex = cx - ax, ez = cz - az, det = dx * ez - dz * ex;
      if (det <= 1e-10) continue; // Reversed underside/vertical wall cannot support a boot.
      const i = faces.length, ay = p.getY(a);
      faces.push(ax, az, ez / det, -ex / det, -dz / det, dx / det, ay, p.getY(b) - ay, p.getY(c) - ay);
      for (let j = row(lz); j <= row(hz); j++) for (let k = col(lx); k <= col(hx); k++) bins[j * cols + k].push(i);
    }
  });
  const tri = Float64Array.from(faces), offsets = new Uint32Array(bins.length + 1);
  for (let i = 0; i < bins.length; i++) offsets[i + 1] = offsets[i] + bins[i].length;
  const indices = new Uint32Array(offsets[bins.length]);
  for (let i = 0; i < bins.length; i++) indices.set(bins[i], offsets[i]);
  return { heightAt(x, z) {
    if (x < x0 || x > x1 || z < z0 || z > z1) return undefined;
    const bin = row(z) * cols + col(x);
    let highest = -Infinity;
    for (let n = offsets[bin]; n < offsets[bin + 1]; n++) {
      const i = indices[n], dx = x - tri[i], dz = z - tri[i + 1];
      const u = dx * tri[i + 2] + dz * tri[i + 3], v = dx * tri[i + 4] + dz * tri[i + 5];
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) highest = Math.max(highest, tri[i + 6] + u * tri[i + 7] + v * tri[i + 8]);
    }
    return highest === -Infinity ? undefined : highest;
  } };
}
