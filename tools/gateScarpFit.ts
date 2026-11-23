import * as THREE from 'three';
import { SCARP_SOLIDS } from '../src/sim/southScarp.ts';

// The GLB is a diagonal slab: local -Z is its high end, +Z its low end,
// and +Y carries the exposed fractured bedding. The corners and back of the
// slab are rounded/trimmed. This measured chart stays on the upper surface.
const SOURCE_Z0 = -0.675;
const SOURCE_Z1 = 0.79;
const SOURCE_X0 = -0.19;
const SOURCE_X1 = 0.20;
const TILE_METRES = 3.20;
const TOE_JOIN = 0.004;
const RELIEF = 0.035;

// [source Z, upper bedding datum, cut between the upper skin and back].
const SOURCE_BEDDING = [
  [-0.72, 0.695, 0.44], [-0.5, 0.69, 0.46], [-0.3, 0.63, 0.36],
  [-0.1, 0.48, 0.10], [0.1, 0.31, -0.05], [0.3, 0.151, -0.26],
  [0.5, -0.053, -0.39], [0.7, -0.332, -0.51], [0.82, -0.503, -0.61],
] as const;

function bedding(z: number, channel: 1 | 2): number {
  const last = SOURCE_BEDDING.length - 1;
  let i = 1;
  while (i < last && z > SOURCE_BEDDING[i][0]) i++;
  const a = SOURCE_BEDDING[i - 1], b = SOURCE_BEDDING[i];
  return THREE.MathUtils.lerp(a[channel], b[channel], THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1));
}

const BODY_FLOOR = 0.10; // Lower edge of the player interval in sim/collision.ts.

type Pair = readonly [number, number];
interface Skin {
  along: number; across: number; u: number; v: number; relief: number; aboveBack: number;
}
interface Surface {
  point: THREE.Vector3; along: number; across: number; relief: number;
}
type Face = [Surface, Surface, Surface];

/** Use the collision toe and step corners as anchors. Cut across the top
 * corner of each tier and pitch the shelf below the next exposed fracture. */
function collisionProfiles() {
  const strips: { west: number; east: number; profile: Pair[] }[] = [];
  for (let i = 0; i < SCARP_SOLIDS.length; i += 3) {
    const [toe, middle, crest] = SCARP_SOLIDS.slice(i, i + 3);
    const bands = [toe, middle, crest];
    const floor = toe.y0 ?? 0;
    const profile: Pair[] = [[floor, toe.z1]];
    for (let j = 0; j < bands.length; j++) {
      const band = bands[j], below = bands[j - 1]?.h ?? floor;
      const span = band.z1 - band.z0, rise = band.h - below;
      const pitch = 0.5 + 0.5 * Math.sin(i * 0.31 + 2 * j);
      const contact = below < BODY_FLOOR && band.h > BODY_FLOOR
        ? Math.min(BODY_FLOOR + 0.005, (BODY_FLOOR + band.h) * 0.5)
        : below;
      const edge = Math.max(below + Math.min(0.1, rise * 0.42), contact);
      const cut = Math.min(0.24, rise * (0.42 + 0.14 * pitch), (band.h - edge) * 0.90);
      const run = Math.min(0.50, span * (0.54 + 0.22 * pitch));
      profile.push(
        [edge, band.z1],
        [band.h - cut, band.z1 - Math.min(0.26, span * (0.26 + 0.13 * pitch), rise * 0.65)],
        [band.h - cut * 0.2, band.z1 - run],
        [band.h, band.z0],
      );
    }
    strips.push({ west: toe.x0, east: toe.x1, profile });
  }
  return strips;
}

function fitSurface() {
  const strips = collisionProfiles();
  const west = strips[0].west, east = strips[strips.length - 1].east;
  const sections = strips.flatMap(({ west, east, profile }, i) => {
    const extraBevel = Math.min(0.093, (east - west) * 0.44 - TOE_JOIN);
    return [
      { x: west + (i ? TOE_JOIN : 0), profile, distance: 0, bevel: i ? extraBevel : 0 },
      { x: east - (i === strips.length - 1 ? 0 : TOE_JOIN), profile, distance: 0,
        bevel: i === strips.length - 1 ? 0 : -extraBevel },
    ];
  });
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1], b = sections[i];
    const run = Math.max(...a.profile.map(([y, z], j) => Math.hypot(b.x - a.x, b.profile[j][0] - y, b.profile[j][1] - z)));
    b.distance = a.distance + run;
  }
  const length = sections[sections.length - 1].distance;
  const surface = sections.map(({ x, profile, distance, bevel }) => profile.map(([y, z]): Surface => ({
    point: new THREE.Vector3(
      x + bevel * THREE.MathUtils.smoothstep(y, BODY_FLOOR, 0.9),
      y + Math.sin(x * 3.2 + y * 1.8) * 0.06 * THREE.MathUtils.smoothstep(y, 0.24, 0.9) *
        Math.min(1, (x - west) / 0.3, (east - x) / 0.3),
      -z,
    ),
    along: THREE.MathUtils.lerp(SOURCE_Z0, SOURCE_Z1, distance / length),
    // Measured in metres along the vertical/horizontal bedding. Crop at the
    // low tip, instead of squeezing the scan's full width into each section.
    across: y - profile[0][0] + profile[0][1] - z,
    relief: z > 0.5 ? Math.min(1, (z - 0.5) / 0.2, (x - west) / 0.18, (east - x) / 0.18) : 0,
  })));
  const faces: Face[] = [];
  for (let i = 1; i < surface.length; i++) {
    const a = surface[i - 1], b = surface[i];
    for (let j = 1; j < a.length; j++) {
      // Render Z = -simulation Z. These faces point north or up.
      faces.push([a[j - 1], b[j], b[j - 1]], [a[j - 1], a[j], b[j]]);
    }
  }
  // The far end meets the west curtain. Close both ends with separate planar
  // charts, so the east tip cannot expose the hollow back of the veneer.
  for (const isEast of [false, true]) {
    const { x, profile } = sections[isEast ? sections.length - 1 : 0];
    const capPoint = ([y, z]: Pair): Surface => ({
      point: new THREE.Vector3(x, y, -z), along: 0.64 - y * 0.29, across: z, relief: 0,
    });
    const edge = profile.map(capPoint);
    const inside = capPoint([profile[0][0], profile[profile.length - 1][1]]);
    for (let j = 1; j < edge.length; j++) {
      faces.push(isEast ? [inside, edge[j - 1], edge[j]] : [inside, edge[j], edge[j - 1]]);
    }
  }
  return faces;
}

function blendSkin(a: Skin, b: Skin, t: number): Skin {
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    along: mix(a.along, b.along), across: mix(a.across, b.across),
    u: mix(a.u, b.u), v: mix(a.v, b.v), relief: mix(a.relief, b.relief), aboveBack: mix(a.aboveBack, b.aboveBack),
  };
}

/** Intersections interpolate the original GLB UVs within their source triangle. */
function clip(poly: Skin[], distance: (p: Skin) => number): Skin[] {
  const out: Skin[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = distance(a), db = distance(b);
    if (da >= 0) out.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) out.push(blendSkin(a, b, da / (da - db)));
  }
  return out;
}

function readSkin(geometry: THREE.BufferGeometry) {
  const pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  if (!pos || !uv || uv.count !== pos.count) throw new Error('Gate scarp GLB requires positions and UVs');
  const vertices = Array.from({ length: pos.count }, (_, i): Skin => {
    const along = pos.getZ(i), across = pos.getX(i), y = pos.getY(i);
    return {
      along, across, u: uv.getX(i), v: uv.getY(i), aboveBack: y - bedding(along, 2),
      relief: RELIEF * Math.tanh((y - bedding(along, 1)) * 17),
    };
  });
  const index = geometry.getIndex();
  const patches: { poly: Skin[]; z0: number; z1: number; x0: number; x1: number }[] = [];
  for (let i = 0; i < (index?.count ?? pos.count); i += 3) {
    const corners = [0, 1, 2].map(n => vertices[index?.getX(i + n) ?? i + n]);
    let poly = clip(corners, p => p.aboveBack);
    poly = clip(poly, p => p.across - SOURCE_X0);
    poly = clip(poly, p => SOURCE_X1 - p.across);
    if (poly.length < 3) continue;
    const z0 = Math.min(...poly.map(p => p.along)), z1 = Math.max(...poly.map(p => p.along));
    if (z1 < SOURCE_Z0 || z0 > SOURCE_Z1) continue;
    patches.push({ poly, z0, z1, x0: Math.min(...poly.map(p => p.across)), x1: Math.max(...poly.map(p => p.across)) });
  }
  if (!patches.length) throw new Error('Gate scarp GLB is missing its upper bedding');
  return patches;
}

export function fitGateScarp(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const skin = readSkin(source);
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  // Keep distinct UV islands, while adjacent clipped faces can share normals.
  const vertices = new Map<string, number>();
  function vertex(p: THREE.Vector3, uv: Skin): number {
    const values = [p.x, p.y, p.z, uv.u, uv.v].map(Math.fround);
    const key = values.map(x => Math.round(x * 1e7)).join('/');
    const found = vertices.get(key);
    if (found !== undefined) return found;
    const id = positions.length / 3;
    vertices.set(key, id);
    positions.push(...values.slice(0, 3));
    uvs.push(...values.slice(3));
    return id;
  }

  const fit = (face: Face, tile: number) => {
    const toAcross = (metres: number) => {
      const t = metres / TILE_METRES - tile;
      // Mirror alternate tiles so UVs meet along the same cut of the scan.
      return THREE.MathUtils.lerp(SOURCE_X0, SOURCE_X1, tile % 2 ? 1 - t : t);
    };
    const [a, b, c] = face;
    const ax = toAcross(a.across), bx = toAcross(b.across), cx = toAcross(c.across);
    const dz1 = b.along - a.along, dz2 = c.along - a.along;
    const dx1 = bx - ax, dx2 = cx - ax;
    const det = dz1 * dx2 - dx1 * dz2;
    if (Math.abs(det) < 1e-10) return;
    const z0 = Math.min(a.along, b.along, c.along), z1 = Math.max(a.along, b.along, c.along);
    const x0 = Math.max(SOURCE_X0, Math.min(ax, bx, cx)), x1 = Math.min(SOURCE_X1, Math.max(ax, bx, cx));
    const weightB = (p: Skin) => ((p.along - a.along) * dx2 - (p.across - ax) * dz2) / det;
    const weightC = (p: Skin) => (dz1 * (p.across - ax) - dx1 * (p.along - a.along)) / det;
    const point = (p: Skin) => {
      const wb = weightB(p), wc = weightC(p), wa = 1 - wb - wc;
      const position = a.point.clone().multiplyScalar(wa).addScaledVector(b.point, wb).addScaledVector(c.point, wc);
      const offset = p.relief * (wa * a.relief + wb * b.relief + wc * c.relief);
      // Shared displacement direction keeps the bedding cuts closed.
      position.y += offset * 0.7 * THREE.MathUtils.smoothstep(position.y, 0.12, 0.28);
      position.z -= offset;
      return position.set(Math.fround(position.x), Math.fround(position.y), Math.fround(position.z));
    };
    for (const patch of skin) {
      if (patch.z1 < z0 || patch.z0 > z1 || patch.x1 < x0 || patch.x0 > x1) continue;
      let poly = clip(patch.poly, weightB);
      poly = clip(poly, weightC);
      poly = clip(poly, p => 1 - weightB(p) - weightC(p));
      if (poly.length < 3) continue;
      const points = poly.map(point);
      for (let i = 1; i < poly.length - 1; i++) {
        const cross = points[i].clone().sub(points[0]).cross(points[i + 1].clone().sub(points[0]));
        if (cross.lengthSq() < 1e-18) continue;
        const first = vertex(points[0], poly[0]), second = vertex(points[i], poly[i]), third = vertex(points[i + 1], poly[i + 1]);
        if (first === second || second === third || first === third) continue;
        if (det > 0) indices.push(first, second, third);
        else indices.push(first, third, second);
      }
    }
  };
  for (const face of fitSurface()) {
    const tiles = face.map(p => Math.floor(p.across / TILE_METRES));
    for (let tile = Math.min(...tiles); tile <= Math.max(...tiles); tile++) fit(face, tile);
  }
  if (!indices.length) throw new Error('Gate scarp bedding does not cover the collision profile');

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}
