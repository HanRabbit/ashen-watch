import * as THREE from 'three';
import { B1_FOUNDATION_BACKING, cutRect, DOORS, PROPS, S1_SHAFT, SLABS, WALLS, type Box, type Rect } from '../sim/level';
import { MAIN_COURT } from '../sim/courtPlan';
import { GATEHOUSE_LIGHTS, windowWallPieces } from './gatehouseWindows';

const rayBias = 0.035; // metres, both ends, so a receiving surface does not shadow itself
const maxVisits = 128;
const rowWidth = 256;
const parallelEpsilon = 1e-5;

type Bounds = THREE.Box3;
type Node = { bounds: Bounds; escape: number; leaf: boolean };
type Leaf = { pivot: THREE.Object3D; width: number; depth: number; spring: number; peak: number; half: boolean };

function worldBounds({ x0, x1, z0, z1, h, y0 = 0 }: Pick<Box, 'x0' | 'x1' | 'z0' | 'z1' | 'y0' | 'h'>): Bounds {
  return new THREE.Box3(new THREE.Vector3(x0, y0, -z1), new THREE.Vector3(x1, h, -z0));
}

function archTop(fraction: number, spring: number, peak: number): number {
  const t = Math.sqrt(THREE.MathUtils.clamp(fraction, 0, 1));
  const control = spring + (peak - spring) * 0.72;
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(spring, control, t), THREE.MathUtils.lerp(control, peak, t), t);
}

function buildBlockers(): Bounds[] {
  const boxes: Bounds[] = [];
  function add(x0: number, x1: number, z0: number, z1: number, y0: number, h: number) {
    if (h > y0) boxes.push(worldBounds({ x0, x1, z0, z1, y0, h }));
  }
  for (const wall of [...WALLS, ...B1_FOUNDATION_BACKING]) {
    // These collision envelopes describe porous iron rails, not solid walls.
    if (!wall.los || wall.tag === 'rail' || wall.tag === 'northIron') continue;
    for (const piece of windowWallPieces({ ...wall, y0: wall.y0 ?? 0 })) boxes.push(worldBounds(piece));
  }
  // Gameplay uses a level walking plane; the rendered main court has exposed
  // clay, wheel ruts and stone shoulders up to ~4.3 cm BELOW that plane.
  // A proxy capped at zero put their receivers inside a solid: a moving lamp
  // lit each crown and cut to black along its polygon. Model the opaque core,
  // not the collision surface. All other floors retain their surveyed heights.
  const coreTop = -0.048;
  for (const slab of SLABS) {
    const main = slab.y0 === -0.3 && slab.h === 0 && slab.x0 >= MAIN_COURT.x0 && slab.x1 <= MAIN_COURT.x1
      && slab.z0 >= MAIN_COURT.z0 && slab.z1 <= MAIN_COURT.z1;
    boxes.push(worldBounds(main ? { ...slab, h: coreTop } : slab));
  }
  // Keep the actual vertical faces reaching grade on both the outer slab
  // edge and the S1 cutout. No ring intrudes into the aperture, no general
  // ray bias is increased, and the continuous 25 cm core still seals B1.
  function inset(r: Rect, d: number): Rect {
    return { x0: r.x0 + d, x1: r.x1 - d, z0: r.z0 + d, z1: r.z1 - d };
  }
  const edge = 0.008;
  for (const band of [...cutRect(MAIN_COURT, inset(MAIN_COURT, edge)), ...cutRect(inset(S1_SHAFT, -edge), S1_SHAFT)]) {
    boxes.push(worldBounds({ ...band, y0: coreTop, h: 0 }));
  }
  add(-3.5, 3.5, -8.5, 0, -0.30, 0.005); // gatehouse floor

  // Aperture heads match the section of the rendered pointed arches. Inscribed
  // masonry strips keep the true passage open along the bevelled arch edge.
  function header(x: number, width: number, z0: number, z1: number, spring: number, peak: number, top: number) {
    const half = width / 2, step = half / 6;
    for (let i = 0; i < 6; i++) {
      const outside = half - i * step, inside = half - (i + 1) * step;
      const bottom = archTop((i + 1) / 6, spring, peak);
      add(x - outside, x - inside, z0, z1, bottom, top);
      add(x + inside, x + outside, z0, z1, bottom, top);
    }
  }
  for (const window of GATEHOUSE_LIGHTS) {
    header(window.x, window.width, window.z0, window.z1, window.bottom + window.spring,
      window.bottom + window.peak, window.bottom + window.peak + 0.05);
  }
  const gatehouse = DOORS.gatehouse.box;
  header(0, gatehouse.x1 - gatehouse.x0, 0, 0.5, 1.9, gatehouse.h, gatehouse.h);
  add(gatehouse.x0, gatehouse.x1, 0, 0.5, gatehouse.h, 4.2);

  // Stable gable closure under the two main roof slopes. The narrow overlapping
  // bands cover the slope without putting a flat shadow ceiling over the room.
  for (let i = 0; i < 12; i++) {
    const a = 3.7 * i / 12, b = 3.7 * (i + 1) / 12;
    const low = 5.53 - b * 0.51, high = 5.68 - a * 0.51;
    add(a, b, -8.5, 0.5, low, high);
    add(-b, -a, -8.5, 0.5, low, high);
    add(a, b, -8.5, -8, 3.59, high);
    add(-b, -a, -8.5, -8, 3.59, high);
    add(a, b, 0, 0.5, 4.18, high);
    add(-b, -a, 0, 0.5, 4.18, high);
  }
  // The disused wood portal has a back board below the 2F bridge opening.
  add(13.30, 13.37, 19.5, 21, 0.45, 3.86);
  for (const shelf of PROPS.filter(p => p.tag === 'shelfB1')) {
    for (const height of [0.4, 1.0, 1.6]) {
      const y = (shelf.y0 ?? 0) + height;
      add(shelf.x0, shelf.x1, shelf.z0, shelf.z1, y, y + 0.06);
    }
  }
  return boxes;
}

function surfaceArea(bounds: Bounds): number {
  const { min, max } = bounds;
  const x = max.x - min.x, y = max.y - min.y, z = max.z - min.z;
  return 2 * (x * y + y * z + z * x);
}

function splitForTraversal(items: Bounds[]): [Bounds[], Bounds[]] {
  const count = items.length;
  let best = Infinity, split = count >> 1, order = items;
  for (const axis of ['x', 'y', 'z'] as const) {
    const sorted = items.slice().sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
    const leftArea: number[] = [];
    const bounds = new THREE.Box3();
    for (let i = 0; i < count; i++) leftArea.push(surfaceArea(bounds.union(sorted[i])));
    bounds.makeEmpty();
    // Prefer low overlap and reject very imbalanced splits. Only the immutable
    // tree build pays for sorting and prefix/suffix areas.
    const minimum = Math.max(1, Math.floor(count / 8));
    for (let i = count - 1; i >= minimum; i--) {
      bounds.union(sorted[i]);
      if (count - i < minimum) continue;
      const cost = leftArea[i - 1] * i + surfaceArea(bounds) * (count - i);
      if (cost < best) {
        best = cost;
        split = i;
        order = sorted;
      }
    }
  }
  return [order.slice(0, split), order.slice(split)];
}

function buildTree(boxes: Bounds[]): Node[] {
  const nodes: Node[] = [];
  function visit(items: Bounds[]) {
    const bounds = items.reduce((union, box) => union.union(box), new THREE.Box3());
    const node = { bounds, escape: 0, leaf: items.length === 1 };
    nodes.push(node);
    if (!node.leaf) {
      const [left, right] = splitForTraversal(items);
      visit(left);
      visit(right);
    }
    node.escape = nodes.length;
  }
  visit(boxes);
  return nodes;
}

const nodes = buildTree(buildBlockers());
const height = Math.ceil(nodes.length * 2 / rowWidth);
const treeData = new Float32Array(rowWidth * height * 4);
for (const [i, { bounds, escape, leaf }] of nodes.entries()) {
  treeData.set([bounds.min.x, bounds.min.y, bounds.min.z, escape,
    bounds.max.x, bounds.max.y, bounds.max.z, Number(leaf)], i * 8);
}
const texture = new THREE.DataTexture(treeData, rowWidth, height, THREE.RGBAFormat, THREE.FloatType);
texture.name = 'Local-light masonry BVH';
texture.needsUpdate = true;
const leafCount = 3;
// A flat typed array is intentional: Three's uniform cloning preserves the
// storage reference, so every material sees the moving leaves in the same frame.
const doorData = new Float32Array(leafCount * 3 * 4);
export const LOCAL_LIGHT_UNIFORMS = {
  uAwLocalTree: { value: texture },
  uAwLocalLeaves: { value: doorData },
};

/** Instanced by Props. Gate bars stay porous. Only solid swinging leaves are included. */
export class LocalLightDoors {
  private readonly leaves: Leaf[];
  private readonly worldPosition = new THREE.Vector3();
  private readonly worldRotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();

  constructor(gatehouse: THREE.Group, chapelL: THREE.Group, chapelR: THREE.Group) {
    const gh = DOORS.gatehouse.box, ch = DOORS.chapelFront.box;
    const chHeight = ch.h - (ch.y0 ?? 0);
    const chapel = { width: (ch.z1 - ch.z0) / 2, depth: .12, spring: chHeight * (2.2 / 3.2), peak: chHeight, half: true };
    this.leaves = [
      { pivot: gatehouse, width: gh.x1 - gh.x0, depth: .09, spring: 1.9, peak: gh.h - (gh.y0 ?? 0), half: false },
      { ...chapel, pivot: chapelL }, { ...chapel, pivot: chapelR },
    ];
  }

  update(): void {
    for (const [i, leaf] of this.leaves.entries()) {
      const p = leaf.pivot.getWorldPosition(this.worldPosition);
      leaf.pivot.getWorldQuaternion(this.worldRotation);
      const { y: yaw } = this.euler.setFromQuaternion(this.worldRotation, 'YXZ');
      doorData.set([p.x, p.y, p.z, 1, Math.cos(yaw), Math.sin(yaw), leaf.width, leaf.depth * 0.5,
        leaf.spring, leaf.peak, Number(leaf.half), 0], i * 12);
    }
  }
}

/** World-space visibility shared by the PBR point light hook and available to the glow pass. */
export const LOCAL_LIGHT_TRANSPORT_GLSL = /* glsl */`
uniform highp sampler2D uAwLocalTree;
uniform vec4 uAwLocalLeaves[${leafCount * 3}];

vec3 awLocalInvRay(vec3 ray) {
  return mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), ray)) / max(abs(ray), vec3(${parallelEpsilon}));
}
vec2 awLocalInterval(vec3 origin, vec3 invRay, bvec3 parallel, vec3 lo, vec3 hi) {
  if (any(bvec3(parallel.x && (origin.x < lo.x || origin.x > hi.x),
                parallel.y && (origin.y < lo.y || origin.y > hi.y),
                parallel.z && (origin.z < lo.z || origin.z > hi.z)))) return vec2(1.0, -1.0);
  vec3 a = (lo - origin) * invRay, b = (hi - origin) * invRay;
  vec3 near = mix(min(a, b), vec3(-1e6), parallel);
  vec3 far = mix(max(a, b), vec3(1e6), parallel);
  return vec2(max(near.x, max(near.y, near.z)), min(far.x, min(far.y, far.z)));
}
vec3 awLocalLeafSpace(vec3 p, vec2 cs) {
  return vec3(dot(p.xz, vec2(cs.x, -cs.y)), p.y, dot(p.xz, vec2(cs.y, cs.x)));
}
float awLocalArchGap(vec3 p, float width, vec3 arch) {
  float across = arch.z > 0.5 ? p.x / width : 1.0 - abs(2.0 * p.x / width - 1.0);
  float t = sqrt(clamp(across, 0.0, 1.0));
  float control = mix(arch.x, arch.y, 0.72);
  return p.y - mix(mix(arch.x, control, t), mix(control, arch.y, t), t);
}
float awLocalVisibility(vec3 source, vec3 receiver) {
  vec3 delta = receiver - source;
  float len = length(delta);
  const float bias = ${rayBias};
  if (len <= 2.0 * bias) return 1.0;
  vec3 ray = delta / len;
  vec3 invRay = awLocalInvRay(ray);
  bvec3 parallel = lessThan(abs(ray), vec3(${parallelEpsilon}));
  int index = 0;
  for (int visit = 0; visit < ${maxVisits}; ++visit) {
    if (index >= ${nodes.length}) break;
    int texel = index * 2;
    ivec2 uv = ivec2(texel % ${rowWidth}, texel / ${rowWidth});
    vec4 lo = texelFetch(uAwLocalTree, uv, 0);
    vec4 hi = texelFetch(uAwLocalTree, uv + ivec2(1, 0), 0);
    vec2 hit = awLocalInterval(source, invRay, parallel, lo.xyz, hi.xyz);
    bool intersects = max(hit.x, bias) < min(hit.y, len - bias);
    if (intersects && hi.w > 0.5) return 0.0;
    index = intersects ? index + 1 : int(lo.w);
  }
  // A traversal budget overrun must err on the side of shadow.
  if (index < ${nodes.length}) return 0.0;
  for (int i = 0; i < ${leafCount * 3}; i += 3) {
    vec4 anchor = uAwLocalLeaves[i];
    if (anchor.w < 0.5) continue;
    vec4 leaf = uAwLocalLeaves[i + 1];
    vec3 arch = uAwLocalLeaves[i + 2].xyz;
    vec3 p = awLocalLeafSpace(source - anchor.xyz, leaf.xy);
    vec3 d = awLocalLeafSpace(ray, leaf.xy);
    vec2 hit = awLocalInterval(p, awLocalInvRay(d), lessThan(abs(d), vec3(${parallelEpsilon})),
      vec3(0.0, 0.0, -leaf.w), vec3(leaf.z, arch.y, leaf.w));
    hit = vec2(max(hit.x, bias), min(hit.y, len - bias));
    if (hit.x >= hit.y) continue;
    float middle = 0.5 * (hit.x + hit.y);
    if (min(awLocalArchGap(p + d * middle, leaf.z, arch),
            min(awLocalArchGap(p + d * hit.x, leaf.z, arch), awLocalArchGap(p + d * hit.y, leaf.z, arch))) <= 0.0) return 0.0;
  }
  return 1.0;
}
`;

function guardPointBrdf(chunk: string): string {
  // Scope the insertion to Three's point loop. Keep the getPointLightInfo call
  // intact for the watchman's onBeforeCompile hook and leave skyExposure's
  // receiver setup and directional branch untouched, regardless of install order.
  const point = chunk.indexOf('getPointLightInfo( pointLight, geometryPosition, directLight );');
  const end = chunk.indexOf('#pragma unroll_loop_end', point);
  if (point < 0 || end < 0) return chunk;
  const guarded = chunk.slice(point, end).replace(/^([ \t]*)(RE_Direct\( directLight, [^\n]*\);)$/m,
    (_, indent: string, call: string) => `${indent}#ifdef STANDARD
${indent}if ( any( notEqual( directLight.color, vec3( 0.0 ) ) ) )
${indent}#endif
${indent}${call}`);
  return chunk.slice(0, point) + guarded + chunk.slice(end);
}

let installed = false;
export function installLocalLightTransport(): void {
  if (installed) return;
  installed = true;
  // The physical pars include comes after Three defines getPointLightInfo and
  // before the light loop calls it. Wrap only the point-light queries here.
  THREE.ShaderChunk.lights_physical_pars_fragment += /* glsl */`
#if defined(STANDARD) && NUM_POINT_LIGHTS > 0
${LOCAL_LIGHT_TRANSPORT_GLSL}
void awGetLocalPointLightInfo(const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light) {
  getPointLightInfo(pointLight, geometryPosition, light);
  if (light.visible) {
    vec3 source = cameraPosition + pointLight.position * mat3(viewMatrix);
    vec3 receiver = cameraPosition + geometryPosition * mat3(viewMatrix);
    light.color *= awLocalVisibility(source, receiver);
    light.visible = light.color != vec3(0.0);
  }
}
#define getPointLightInfo awGetLocalPointLightInfo
#endif
`;
  // After attenuation, transport, material shielding and point shadows, skip
  // the physical BRDF only if all three incident channels are exactly zero.
  THREE.ShaderChunk.lights_fragment_begin = guardPointBrdf(THREE.ShaderChunk.lights_fragment_begin);
  Object.assign(THREE.ShaderLib.standard.uniforms, LOCAL_LIGHT_UNIFORMS);
  Object.assign(THREE.ShaderLib.physical.uniforms, LOCAL_LIGHT_UNIFORMS);
}

/** CPU reference against the packed shader data, used for route/coverage tests. */
export function traceLocalLight(source: THREE.Vector3, receiver: THREE.Vector3): { visible: boolean; visits: number } {
  const delta = receiver.clone().sub(source), distance = delta.length();
  let visits = 0;
  if (distance <= 2 * rayBias) return { visible: true, visits };
  const ray = delta.multiplyScalar(1 / distance);
  function interval(origin: THREE.Vector3, direction: THREE.Vector3, lo: THREE.Vector3, hi: THREE.Vector3) {
    let enter = rayBias, exit = distance - rayBias;
    for (const axis of ['x', 'y', 'z'] as const) {
      if (Math.abs(direction[axis]) < parallelEpsilon) {
        if (origin[axis] < lo[axis] || origin[axis] > hi[axis]) return [1, -1];
        continue;
      }
      const inverse = 1 / direction[axis];
      const a = (lo[axis] - origin[axis]) * inverse, b = (hi[axis] - origin[axis]) * inverse;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
    return [enter, exit];
  }
  let index = 0;
  const lo = new THREE.Vector3(), hi = new THREE.Vector3();
  while (index < nodes.length && visits < maxVisits) {
    visits++;
    const texel = index * 8;
    const [enter, exit] = interval(source, ray, lo.fromArray(treeData, texel), hi.fromArray(treeData, texel + 4));
    const intersects = enter < exit;
    if (intersects && treeData[texel + 7]) return { visible: false, visits };
    index = intersects ? index + 1 : treeData[texel + 3];
  }
  if (index < nodes.length) return { visible: false, visits };
  for (let i = 0; i < doorData.length; i += 12) {
    const [x, y, z, active, cos, sin, width, halfDepth, spring, peak, half] = doorData.subarray(i, i + 12);
    if (!active) continue;
    function leafSpace(p: THREE.Vector3) {
      return new THREE.Vector3(cos * p.x - sin * p.z, p.y, cos * p.z + sin * p.x);
    }
    const p = leafSpace(source.clone().sub(new THREE.Vector3(x, y, z))), d = leafSpace(ray);
    const [enter, exit] = interval(p, d, lo.set(0, 0, -halfDepth), hi.set(width, peak, halfDepth));
    if (enter >= exit) continue;
    for (const t of [enter, (enter + exit) * 0.5, exit]) {
      const fx = (p.x + d.x * t) / width;
      if (p.y + d.y * t <= archTop(half ? fx : 1 - Math.abs(2 * fx - 1), spring, peak)) return { visible: false, visits };
    }
  }
  return { visible: true, visits };
}
