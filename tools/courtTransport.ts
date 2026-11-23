// OFFLINE input preparation for the GPU transport. Coordinates are simulation XYZ.
import { COURTYARD_SLABS, DECK_SLABS, PROPS, STAIR_MASS, WALLS, WELL, type Box } from '../src/sim/level';
import { PROBE_COUNT, PROBE_GRID } from '../src/render/probeGrid';

type Point = [number, number, number];
type Solid = { lo: Point; hi: Point; material: number };
const STONE = 1, WOOD = 2, FLAGS = 3;
const REFLECTANCE = [0.25, 0.23, 0.20, 0.24, 0.146, 0.073, 0.23, 0.21, 0.18];
const RAY_COUNT = 64;
const BVH_WIDTH = 256;

type BakeBox = Pick<Box, 'x0' | 'z0' | 'x1' | 'z1' | 'h' | 'y0'>;

function collectSolids(outerCurtain: BakeBox[]): Solid[] {
  const box = (a: BakeBox, material: number): Solid => ({
    lo: [a.x0, a.y0 ?? 0, a.z0], hi: [a.x1, a.h, a.z1], material,
  });
  const solids = WALLS.filter(w => w.los && w.tag !== 'holeGuard').map(w => box(w, STONE));
  for (const wall of outerCurtain) solids.push(box(wall, STONE));
  for (const slab of [...COURTYARD_SLABS, ...DECK_SLABS, ...STAIR_MASS]) solids.push(box(slab, FLAGS));
  for (const prop of PROPS) {
    if (prop.h < 0 || prop.tag === 'brazier' || prop.tag === 'pot') continue;
    const wooden = /crate|cart|shelf|scaffold|barrel|bench|woodpile|cot|stool/i.test(prop.tag ?? '');
    const solid = box(prop, wooden ? WOOD : STONE);
    // Only the loaded body or staging occludes diffuse light.
    if (prop.tag === 'cart') solid.lo[1] = 0.52;
    if (prop.tag === 'scaffold') solid.lo[1] = prop.h - 0.26;
    solids.push(solid);
  }
  solids.push(
    box({ x0: WELL.x - 1.02, x1: WELL.x + 1.02, z0: WELL.z - 1.02, z1: WELL.z + 1.02, h: 0.82 }, STONE),
    box({ x0: WELL.x - 1.19, x1: WELL.x + 1.19, z0: WELL.z - 1.25, z1: WELL.z + 1.25, y0: 2.26, h: 2.53 }, WOOD),
  );
  for (const solid of solids) {
    if (![...solid.lo, ...solid.hi].every(Number.isFinite)) throw new Error('Invalid transport occluder');
  }
  return solids;
}

/** Two RGBA32F texels per entry: (minimum, escape index), (maximum, material).
 * Branches have material 0. Preorder + escape links allow stackless GPU traversal. */
function packBvh(solids: Solid[]) {
  const records: number[] = [];
  function append(items: Solid[]): void {
    const offset = records.length;
    if (items.length === 1) {
      const { lo, hi, material } = items[0];
      records.push(...lo, offset / 8 + 1, ...hi, material);
      return;
    }
    const lo: Point = [Infinity, Infinity, Infinity], hi: Point = [-Infinity, -Infinity, -Infinity];
    for (const item of items) for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], item.lo[i]);
      hi[i] = Math.max(hi[i], item.hi[i]);
    }
    records.push(...lo, 0, ...hi, 0);
    if (items.length <= 4) {
      for (const solid of items) append([solid]);
    } else {
      const axis = [0, 1, 2].sort((a, b) => (hi[b] - lo[b]) - (hi[a] - lo[a]))[0];
      items.sort((a, b) => a.lo[axis] + a.hi[axis] - b.lo[axis] - b.hi[axis]);
      const middle = items.length >> 1;
      append(items.slice(0, middle));
      append(items.slice(middle));
    }
    records[offset + 3] = records.length / 8;
  }
  append(solids.slice());
  const height = Math.ceil(records.length / (4 * BVH_WIDTH));
  const pixels = new Float32Array(BVH_WIDTH * height * 4);
  pixels.set(records);
  return { width: BVH_WIDTH, height, entries: records.length / 8, pixels };
}

/** Give each buried probe an air donor with the original ordered, six-connected flood fill. */
function packProbes(solids: Solid[]) {
  const { x: startX, y: startY, z: startZ, nx, ny, nz, dx, dy } = PROBE_GRID;
  const plane = nx * nz;
  const pixels = new Float32Array(PROBE_COUNT * 4);
  const donors = new Int32Array(PROBE_COUNT).fill(-1);
  const queue: number[] = [];
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const i = x + nx * z + plane * y;
    const point = [startX + x * dx, startY + y * dy, startZ + z * dx];
    pixels.set(point, i * 4);
    const buried = solids.some(({ lo, hi }) => point.every((v, axis) => v > lo[axis] && v < hi[axis]));
    if (!buried) { donors[i] = i; queue.push(i); }
  }
  if (!queue.length) throw new Error('No air probes in the court transport grid');
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % nx, z = Math.floor(i / nx) % nz, y = Math.floor(i / plane);
    const visit = (neighbor: number, adjacent: boolean) => {
      if (adjacent && donors[neighbor] < 0) { donors[neighbor] = donors[i]; queue.push(neighbor); }
    };
    visit(i - 1, x > 0);
    visit(i + 1, x + 1 < nx);
    visit(i - nx, z > 0);
    visit(i + nx, z + 1 < nz);
    visit(i - plane, y > 0);
    visit(i + plane, y + 1 < ny);
  }
  for (let i = 0; i < PROBE_COUNT; i++) pixels[i * 4 + 3] = donors[i];
  return { pixels, buried: PROBE_COUNT - donors.reduce((n, donor, i) => n + Number(donor === i), 0) };
}

export function prepareCourtTransport(outerCurtain: BakeBox[] = []) {
  const solids = collectSolids(outerCurtain);
  const bvh = packBvh(solids);
  const probes = packProbes(solids);
  const rays: number[] = [];
  for (let i = 0; i < RAY_COUNT; i++) {
    const y = (i + 0.5) * 2 / RAY_COUNT - 1;
    const radius = Math.sqrt(1 - y * y), azimuth = i * 2.399963229728653 + 0.319;
    rays.push(Math.cos(azimuth) * radius, y, Math.sin(azimuth) * radius);
  }
  return {
    grid: PROBE_GRID, solidCount: solids.length, reflectance: REFLECTANCE, rays,
    bvh: { ...bvh, pixels: Array.from(bvh.pixels) },
    probes: { ...probes, pixels: Array.from(probes.pixels) },
  };
}
