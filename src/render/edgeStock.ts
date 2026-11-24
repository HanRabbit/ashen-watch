import { BufferAttribute, BufferGeometry } from 'three';

export type EdgeStockProfile = 'stone' | 'timber' | 'iron';

// Radius in world metres, also capped as a fraction of the thinnest side.
// No absolute minimum: a nail or a thin strap must still have two flat faces.
const radii = { stone: [.038, .10], timber: [.014, .065], iron: [.0035, .04] } as const;

// BoxGeometry / tiledBox group order. Local +U cross +V points outward.
// [U axis, U sign, V axis, V sign, normal axis, normal sign]
const charts = [
  [2, -1, 1, 1, 0,  1], [2,  1, 1, 1, 0, -1],
  [0,  1, 2,-1, 1,  1], [0,  1, 2, 1, 1, -1],
  [0,  1, 1, 1, 2,  1], [0, -1, 1, 1, 2, -1],
] as const;

/** A centred, closed box with real inset shoulders. Each quarter-round has two
 * facets and analytic radial normals; UV seams split vertices, not normals.
 * Exactly 80 chart vertices and 92 triangles independent of dimensions. */
export function edgeStock(w: number, h: number, d: number, tile: number, profile: EdgeStockProfile): BufferGeometry {
  if (![w, h, d, tile].every(v => Number.isFinite(v) && v > 0)) {
    throw new RangeError('edgeStock requires positive finite dimensions and tile size');
  }
  const [cap, fraction] = radii[profile];
  const r = Math.min(cap, Math.min(w, h, d) * fraction);
  const half = [w / 2, h / 2, d / 2], core = half.map(a => a - r);
  const pos = new Float32Array(80 * 3), norm = new Float32Array(80 * 3), uv = new Float32Array(80 * 2);
  const indices = new Uint16Array(92 * 3), geo = new BufferGeometry();
  let count = 0, at = 0;
  for (const [face, [u, us, v, vs, n, ns]] of charts.entries()) {
    const start = at;
    // Offset a core corner along a unit normal in this chart's frame. Project
    // onto the original full face, not the smaller flat patch (no UV stretching).
    const vertex = (su: number, sv: number, nu: number, nv: number, nn: number) => {
      const i = count++, k = i * 3;
      const pu = su * core[u] + r * nu, pv = sv * core[v] + r * nv;
      pos[k + u] = us * pu; pos[k + v] = vs * pv; pos[k + n] = ns * (core[n] + r * nn);
      norm[k + u] = us * nu; norm[k + v] = vs * nv; norm[k + n] = ns * nn;
      uv[i * 2] = (pu + half[u]) / tile; uv[i * 2 + 1] = (pv + half[v]) / tile;
      return i;
    };
    // 4x4 grid minus its four corners: one flat quad, four half-shoulder
    // quads and four corner triangles. Adjacent charts meet at the 45° rail.
    const grid = new Int16Array(16).fill(-1), mid = Math.SQRT1_2;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const ru = x === 0 || x === 3, rv = y === 0 || y === 3;
      if (ru && rv) continue;
      const su = x < 2 ? -1 : 1, sv = y < 2 ? -1 : 1;
      grid[y * 4 + x] = vertex(su, sv, ru ? su * mid : 0, rv ? sv * mid : 0, ru || rv ? mid : 1);
    }
    const tri = (a: number, b: number, c: number) => { indices[at++] = a; indices[at++] = b; indices[at++] = c; };
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const k = y * 4 + x, a = grid[k], b = grid[k + 1], c = grid[k + 5], e = grid[k + 4];
      if (a < 0) tri(b, c, e);
      else if (c < 0) tri(a, b, e);
      else { if (b >= 0) tri(a, b, c); if (e >= 0) tri(a, c, e); }
    }
    // Three 45° rails leave a triangle at each octant. Map it once into the
    // adjacent +/-Y chart; only its third vertex needs another UV copy.
    if (n === 1) for (const sv of [-1, 1]) for (const su of [-1, 1]) {
      const x = su < 0 ? 0 : 3, y = sv < 0 ? 0 : 3;
      const a = grid[(y - sv) * 4 + x], b = grid[y * 4 + x - su];
      const c = vertex(su, sv, su * mid, sv * mid, 0);
      if (su === sv) tri(a, c, b); else tri(a, b, c);
    }
    geo.addGroup(start, at - start, face);
  }
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(norm, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setIndex(new BufferAttribute(indices, 1));
  return geo;
}
