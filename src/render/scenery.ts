import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SUBGRADE_GROUND_CUTOUTS } from '../sim/level';

export interface Scenery {
  group: THREE.Group;
}

const TAU = 2 * Math.PI;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function rng(seed: number): () => number {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(x: number, z: number, seed: number, period = 0): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const hash = (a: number, b: number) => {
    if (period) { a = (a + period) % period; b = (b + period) % period; }
    const n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed, 1274126177);
    const h = Math.imul(n ^ (n >>> 13), 1597334677);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return mix(mix(hash(ix, iz), hash(ix + 1, iz), smooth(0, 1, x - ix)),
    mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), smooth(0, 1, x - ix)), smooth(0, 1, z - iz));
}

function relief(x: number, z: number, seed: number): number {
  return noise(x, z, seed) * 0.62 + noise(x * 2.1, z * 2.1, seed + 1) * 0.25
    + noise(x * 4.4, z * 4.4, seed + 2) * 0.13;
}

// These are render-space coordinates (the simulation's z is negated in the camera rig).
const KEEP = { x: 143, z: 94, y: 49 };
const GATE = { x: 94, z: -51 };
const ROAD: [number, number][] = [[33, -37], [51, -40], [63, -50], [80, -51], [102, -51], [119, -48], [137, -56], [158, -64]];

// The escarpment faces the manor across the valley. Its long axis runs away
// from the courtyard; the oblique lower ledge is exposed on the walk as well.
const keepRun = (dx: number, dz: number) => dx * .85 + dz * .53;
const keepSide = (dx: number, dz: number) => -dx * .53 + dz * .85;
function escarpment(x: number, z: number): number {
  const dx = x - KEEP.x, dz = z - KEEP.z;
  const run = keepRun(dx, dz), side = keepSide(dx, dz);
  return (1 - smooth(46, 71, Math.abs(run)))
    * (1 - smooth(27, 48, Math.abs(side))) * (1 - smooth(-14, 16, run));
}

function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < ROAD.length; i++) {
    const [ax, az] = ROAD[i - 1], dx = ROAD[i][0] - ax, dz = ROAD[i][1] - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    const sx = x - ax - t * dx, sz = z - az - t * dz;
    best = Math.min(best, sx * sx + sz * sz);
  }
  return Math.sqrt(best);
}

// Overlapping massifs with uneven passes, not nested skyline walls. The inner valley is
// held below the playable map; vegetation and foundations sample the triangulated result.
type Massif = { x: number; z: number; width: number; length: number; height: number; s: number; c: number };
function makeMassifs(): Massif[] {
  const r = rng(8127);
  const hills: Massif[] = [];
  const row = (count: number, radius: number, width: number, depth: number, height: number, offset: number) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count + offset) * TAU + (r() - .5) * .28;
      const d = radius * (.84 + r() * .32);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const axis = a + (r() - .5) * 1.1;
      const eastPass = x > 0 && z > -d * .72 && z < d * .81;
      hills.push({ x, z, width: width * (.8 + r() * .52), length: depth * (.75 + r() * .6),
        height: height * (.7 + r() * .56) * (eastPass ? .62 : 1), s: Math.sin(axis), c: Math.cos(axis) });
    }
  };
  row(12, 108, 61, 50, 25, .06);
  row(13, 219, 102, 90, 56, .015);
  row(14, 353, 128, 105, 101, .04);
  row(16, 479, 144, 143, 124, .006);
  return hills;
}

function geology(x: number, z: number, hills: Massif[]): number {
  const distance = Math.hypot(x - 5, z + 9);
  if (distance < 32) return -.62;
  const n = relief(x * .031, z * .031, 6);
  const a = (noise(x * .019, z * .028, 201) - .5) * 25;
  const b = (noise(x * .027, z * .021, 292) - .5) * 23;
  let major = 0, overlap = 0;
  for (const h of hills) {
    const dx = x + a - h.x, dz = z + b - h.z;
    if (Math.abs(dx) > 225 || Math.abs(dz) > 225) continue;
    const along = (dx * h.c + dz * h.s) / h.length;
    const across = (-dx * h.s + dz * h.c) / h.width;
    const l = Math.hypot(along, across);
    const rise = h.height * (1 - smooth(.04, 1.29, l));
    overlap += Math.min(.27 * rise, 21);
    major = Math.max(major, rise);
  }
  let y = -3.4 + (major * .72 + overlap) * (.86 + n * .27) + (n - .47) * mix(6, 30, smooth(120, 430, distance));
  const kx = x - KEEP.x, kz = z - KEEP.z;
  if (Math.abs(kx) < 116 && Math.abs(kz) < 96) {
    const run = keepRun(kx, kz), side = keepSide(kx, kz);
    // The two breaks are staggered across the face: a steep headwall under the
    // masonry, a lower shelf, then talus into the existing valley terrain.
    const ribs = noise(side * .14, run * .036, 87);
    const lip = run + side * .16 + (ribs - .5) * 9;
    const summit = (1 - smooth(17, 32, -lip)) * (1 - smooth(29, 65, run))
      * (1 - smooth(14, 32, Math.abs(side + run * .14)));
    const bench = (1 - smooth(32, 45, -run + side * .27 + (ribs - .5) * 7))
      * (1 - smooth(25, 53, Math.abs(side - 4))) * (1 - smooth(41, 75, run));
    const apron = 18 * (1 - smooth(.22, 1.08, Math.hypot((run + 23) / 65, (side - 3) / 47)));
    const shelves = 18 * bench + 15.5 * summit;
    // Two oblique drainage clefts cut the lower shelf, not the summit deck.
    // Their wider mouths meet the talus; the remaining ribs carry the walls.
    const cleft = 7.5 * (1 - smooth(1, 7, Math.abs(side - 23 + run * .21)))
      + 4.8 * (1 - smooth(1, 6, Math.abs(side + 18 - run * .12)));
    const exposure = smooth(-56, -37, run) * (1 - smooth(-19, -7, run)) * (1 - smooth(29, 47, Math.abs(side)));
    y = Math.max(y, apron + shelves - 2 - cleft * exposure + (ribs - .5) * 6 * Math.max(bench, summit));
  }
  // A broad bench at the pass keeps the approach, gate and adjacent rooflines tied together.
  if (x > 31 && x < 163 && z < -29 && z > -78) {
    const trail = (1 - smooth(5, 22, roadDistance(x, z))) * smooth(32, 55, x) * (1 - smooth(139, 163, x));
    y = mix(y, 3.5 + (x - 60) * .078, trail);
  }
  return mix(-.62, y, smooth(32, 54, distance));
}

function stand(x: number, z: number): number {
  return relief((x + z * .25) * .056, (z - x * .23) * .048, 29);
}

function forestCover(x: number, z: number, y: number, slope: number): number {
  const broad = stand(x, z);
  const edge = noise(x * .13, z * .13, 18);
  const living = smooth(.31, .63, broad * .88 + edge * .12);
  return living * (1 - smooth(.34, .70, slope)) * (1 - smooth(53, 92, y))
    * (1 - .93 * escarpment(x, z) * smooth(29, 42, y))
    * smooth(36, 55, Math.hypot(x - 5, z + 9)) * smooth(3, 10, roadDistance(x, z));
}

interface Terrain {
  tiles: THREE.BufferGeometry[];
  height: (x: number, z: number) => number;
}

function terrain(): Terrain {
  // Fine at the playable edges and fortress, progressively coarser at the far ridges.
  const axis = [0];
  for (let x = 0; x < 596;) {
    x += x < 61 ? 3 : x < 174 ? 4 : x < 283 ? 7 : 13;
    axis.unshift(-x);
    axis.push(x);
  }
  // Insert exact shaft and basement edges before triangulating. The visible ground
  // can't cap the actual floor openings or put a second ceiling in the storeroom.
  for (const cut of SUBGRADE_GROUND_CUTOUTS) axis.push(cut.x0, cut.x1, -cut.z0, -cut.z1);
  const grid = [...new Set(axis)].sort((a, b) => a - b);
  const n = grid.length, hills = makeMassifs();
  const vertices = new Float32Array(n * n * 3), indices: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = grid[i], z = grid[j], k = j * n + i;
    vertices.set([x, geology(x, z, hills), z], 3 * k);
    if (i + 1 < n && j + 1 < n) indices.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const norms = g.getAttribute('normal');
  const color = new Float32Array(n * n * 3), biomes = new Float32Array(n * n * 2);
  const soil = new THREE.Color(0x4b4c3c), grass = new THREE.Color(0x565e4d);
  const timber = new THREE.Color(0x273730), stone = new THREE.Color(0x565d62);
  const scree = new THREE.Color(0x42494d), path = new THREE.Color(0x6b6658);
  const tint = new THREE.Color();
  for (let k = 0; k < n * n; k++) {
    const x = vertices[k * 3], y = vertices[k * 3 + 1], z = vertices[k * 3 + 2];
    const slope = 1 - norms.getY(k);
    const cover = forestCover(x, z, y, slope);
    const patch = relief(x * .058, z * .058, 187);
    const divide = smooth(0, .30, slope) * mix(.4, 1.0, smooth(.32, .67, patch));
    const scarp = escarpment(x, z) * smooth(18, 35, y);
    const rock = Math.max(divide, smooth(42, 89, y) * .74, scarp * .94);
    tint.copy(soil).lerp(grass, smooth(.27, .7, patch)).lerp(timber, cover * .98);
    tint.lerp(scree, rock * .69).lerp(stone, rock * smooth(.39, .72, patch) * .62);
    // Exposed faces share the keep's cold stone family; benches retain darker
    // scree and the same forest-floor tint as the surrounding stands.
    tint.lerp(stone, scarp * mix(.35, .78, smooth(.18, .55, slope)));
    const crossLight = norms.getX(k) * -.53 + norms.getZ(k) * .85;
    tint.multiplyScalar(mix(1, mix(.62, 1.05, smooth(-.66, .42, crossLight)), scarp));
    tint.lerp(path, (1 - smooth(1.8, 4.2, roadDistance(x, z))) * .85);
    const face = norms.getX(k) * -.56 + norms.getZ(k) * -.48 + norms.getY(k) * .67;
    tint.multiplyScalar(mix(.64, 1.25, smooth(-.55, .88, face)) * mix(.8, 1.17, patch));
    tint.toArray(color, 3 * k);
    biomes[2 * k] = rock;
    biomes[2 * k + 1] = cover;
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aBiome', new THREE.BufferAttribute(biomes, 2));
  const cell = (v: number) => {
    let a = 0, b = n - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (grid[m] > v) b = m; else a = m; }
    return a;
  };
  const height = (x: number, z: number) => {
    const i = cell(x), j = cell(z), k = (j * n + i) * 3 + 1;
    const u = clamp01((x - grid[i]) / (grid[i + 1] - grid[i]));
    const v = clamp01((z - grid[j]) / (grid[j + 1] - grid[j]));
    const a = vertices[k], b = vertices[k + 3], c = vertices[k + n * 3], d = vertices[k + (n + 1) * 3];
    // Same diagonal as the render mesh, including where grid spacing changes.
    return u + v < 1 ? a * (1 - u - v) + b * u + c * v : d * (u + v - 1) + b * (1 - v) + c * (1 - u);
  };
  // Cut the finished surface into tiles, preserving shared-edge vertices and normals.
  const tiles: THREE.BufferGeometry[] = [];
  const stops = [0, cell(-164), cell(0), cell(164), n - 1];
  for (let j = 0; j < stops.length - 1; j++) for (let i = 0; i < stops.length - 1; i++) {
    const minX = stops[i], minZ = stops[j], width = stops[i + 1] - minX + 1, depth = stops[j + 1] - minZ + 1;
    const tile = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'aBiome']) {
      const attrib = g.getAttribute(name) as THREE.BufferAttribute, components = attrib.itemSize;
      const data = new Float32Array(width * depth * components);
      for (let row = 0; row < depth; row++) {
        const start = ((minZ + row) * n + minX) * components;
        data.set((attrib.array as Float32Array).subarray(start, start + width * components), row * width * components);
      }
      tile.setAttribute(name, new THREE.BufferAttribute(data, components));
    }
    const tris: number[] = [];
    for (let row = 0; row < depth - 1; row++) for (let col = 0; col < width - 1; col++) {
      const xi = minX + col, zi = minZ + row;
      const x = (grid[xi] + grid[xi + 1]) * 0.5, z = -(grid[zi] + grid[zi + 1]) * 0.5;
      if (SUBGRADE_GROUND_CUTOUTS.some((cut) => x > cut.x0 && x < cut.x1 && z > cut.z0 && z < cut.z1)) continue;
      const k = row * width + col;
      tris.push(k, k + width, k + 1, k + 1, k + width, k + width + 1);
    }
    tile.setIndex(tris);
    tile.computeBoundingBox();
    tile.computeBoundingSphere();
    tiles.push(tile);
  }
  g.dispose();
  return { tiles, height };
}

function grain(): THREE.DataTexture {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const k = (z * size + x) * 4;
    data[k] = 255 * (.56 * noise(x / 8, z / 8, 74, 16) + .44 * noise(x / 2, z / 2, 17, 64));
    data[k + 1] = 255 * noise(x / 4, z / 8, 31, 32); // seam and strata grain
    data[k + 2] = 255 * noise(x / 16, z / 16, 93, 8);
    data[k + 3] = 255;
  }
  const map = new THREE.DataTexture(data, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

// Subtle aerial perspective on opaque scenery only. Full-scene volumetrics belong
// to the lighting rig; don't obscure the close slopes or add a second fog layer.
const AERIAL = /* glsl */`
uniform vec3 uLandAir;
uniform float uLandNight;
varying vec3 vLandPos;
vec3 landAir(vec3 base, float drift, float density) {
  vec3 ray = vLandPos - cameraPosition;
  float d = length(ray);
  float low = exp(-max(vLandPos.y - 4.0, 0.0) * .042);
  float cloudBank = exp(-abs(vLandPos.y - 18.0) * .083);
  float join = smoothstep(53.0, 173.0, d);
  float veil = (low * (.045 + .10 * drift) + cloudBank * smoothstep(.24, .75, drift) * .13) * join;
  veil *= mix(1.0, 1.3, uLandNight);
  float distanceHaze = smoothstep(74.0, 572.0, d) * .81;
  float t = min(.94, (distanceHaze + veil) * density);
  vec3 moon = vec3(.155, .217, .330);
  return mix(base * mix(vec3(1.0), moon, uLandNight), uLandAir, t);
}
`;

function palette(): { land: THREE.MeshBasicMaterial; trees: THREE.MeshBasicMaterial; stone: THREE.MeshBasicMaterial;
  roof: THREE.MeshBasicMaterial; apertures: THREE.MeshBasicMaterial; update: (scene: THREE.Scene) => void } {
  const map = grain();
  const air = { value: new THREE.Color(0x7f8b95) }, night = { value: 0 };
  const make = (kind: 'land' | 'trees' | 'stone' | 'roof') => {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    mat.customProgramCacheKey = () => `aw-landscape:${kind}`;
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { uLandAir: air, uLandNight: night, uLandGrain: { value: map } });
      shader.vertexShader = `varying vec3 vLandPos;\n${kind === 'land' ? 'attribute vec2 aBiome; varying vec2 vBiome;\n' : ''}${shader.vertexShader}`
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 pLand = vec4(transformed,1.0);
          #ifdef USE_INSTANCING
            pLand = instanceMatrix * pLand;
          #endif
          vLandPos = (modelMatrix * pLand).xyz;
          ${kind === 'land' ? 'vBiome = aBiome;' : ''}`);
      const geology = /* glsl */`
        vec3 mottling = texture2D(uLandGrain, vLandPos.xz * .044).rgb;
        vec2 seamSpace = vec2((vLandPos.x * .73 + vLandPos.z * .48) * .043, (vLandPos.y + vLandPos.z * .27 + vLandPos.x * .15) * .114);
        seamSpace.y += mottling.b * .19;
        float seams = texture2D(uLandGrain, seamSpace).g;
        float joints = texture2D(uLandGrain, seamSpace * vec2(3.1, .37) + 0.28).r;
        float crowns = texture2D(uLandGrain, vLandPos.xz * .34).g;
        base *= mix(.68, 1.29, mottling.r) * mix(1.0, mix(.62, 1.28, seams) * mix(.63, 1.26, joints), vBiome.x);
        base *= mix(1.0, mix(.52, 1.23, crowns), vBiome.y);
        drift = texture2D(uLandGrain, vLandPos.xz * .005).b;
      `;
      const masonry = /* glsl */`
        vec3 norm = abs(cross(dFdx(vLandPos), dFdy(vLandPos)));
        vec2 brick = vec2(norm.x > norm.z ? vLandPos.z : vLandPos.x, vLandPos.y) * vec2(.72, 1.44);
        brick.x += mod(floor(brick.y), 2.0) * .5;
        vec2 scaleAA = max(fwidth(brick), vec2(.001));
        vec2 cell = abs(fract(brick) - .5);
        vec2 mortar = smoothstep(vec2(.465) - scaleAA, vec2(.49) + scaleAA, cell);
        float grain = texture2D(uLandGrain, vLandPos.xz * .09 + vLandPos.y * .047).r;
        float age = texture2D(uLandGrain, (vLandPos.xz + vLandPos.y * vec2(.15, .08)) * .025).b;
        base *= mix(.80, 1.24, grain) * mix(.74, 1.09, age) * (1.0 - max(mortar.x * .52, mortar.y) * .20);
      `;
      shader.fragmentShader = `${AERIAL}\nuniform sampler2D uLandGrain;\n${kind === 'land' ? 'varying vec2 vBiome;\n' : ''}${shader.fragmentShader}`
        .replace('#include <tonemapping_fragment>', `vec3 base = gl_FragColor.rgb;
          float drift = .5;
          ${kind === 'land' ? geology : kind === 'stone' ? masonry : ''}
          gl_FragColor.rgb = landAir(base, drift, ${kind === 'land' || kind === 'trees' ? '1.0' : '.80'});
          #include <tonemapping_fragment>`);
    };
    return mat;
  };
  const apertures = new THREE.MeshBasicMaterial({ color: 0x252829, fog: false, side: THREE.DoubleSide, vertexColors: true });
  let horizon: THREE.Color | undefined;
  let foundSky = false;
  return { land: make('land'), trees: make('trees'), stone: make('stone'), roof: make('roof'), apertures, update(scene) {
    if (!foundSky) {
      scene.traverse(o => {
        const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms;
        if (u?.uHorizon && u?.uZenith && u?.uCloudDark) horizon = u.uHorizon.value;
      });
      foundSky = true;
    }
    night.value = scene.userData.night ?? 0;
    const fog = (scene.fog as THREE.Fog | null)?.color;
    if (fog) air.value.copy(fog).multiplyScalar(mix(.79, 1.0, night.value));
    if (horizon) air.value.lerp(horizon, .09 + .26 * night.value);
    air.value.multiplyScalar(1.0 + .85 * night.value);
    const lit = smooth(.34, .88, night.value);
    apertures.color.setHex(0x252829).lerp(warmWindow, lit).multiplyScalar(1 + lit * 2.08);
  } };
}
const warmWindow = new THREE.Color(0xffb45f);

// A narrow leader with overlapping branch fans, not a continuous zig-zag cone.
// Upper sprays catch skylight; their folded undersides leave quiet dark pockets.
// Both tiers are closed, opaque, and cheap enough for the existing depth pass.
function fir(near: boolean): THREE.BufferGeometry {
  const p: number[] = [], c: number[] = [], index: number[] = [];
  const shade = new THREE.Color(0x202e28), lit = new THREE.Color(0x566355), tint = new THREE.Color();
  const add = (x: number, y: number, z: number, exposure: number) => {
    p.push(x, y, z);
    tint.copy(shade).lerp(lit, exposure);
    c.push(tint.r, tint.g, tint.b);
    return p.length / 3 - 1;
  };
  const sides = near ? 4 : 3;
  const rings = near ? [[.04, .025], [.18, .066], [.43, .092], [.71, .056]]
    : [[.04, .027], [.22, .100], [.60, .069]];
  rings.forEach(([h, radius], j) => {
    for (let i = 0; i < sides; i++) {
      const a = TAU * i / sides + j * .21;
      const k = add(radius * Math.cos(a), h, radius * Math.sin(a), .12 + h * .48 + .11 * Math.cos(a));
      const m = j * sides + (i + 1) % sides;
      if (j + 1 < rings.length) index.push(k, k + sides, m, m, k + sides, m + sides);
    }
  });
  const foot = add(0, -.10, 0, .015), bud = add(.019, 1, -.013, .70);
  for (let i = 0; i < sides; i++) {
    const m = (i + 1) % sides, k = (rings.length - 1) * sides;
    index.push(foot, i, m, k + i, bud, k + m);
  }
  // Angle, shoulder height, reach, and spread. Stagger individual sprays
  // vertically and leave a slimmer leader above the last one.
  const fans = near ? [
    [.08, .24, .221, .080], [2.32, .19, .218, .088], [4.48, .32, .201, .080],
    [1.00, .44, .179, .071], [3.18, .49, .176, .075], [5.61, .50, .153, .068],
    [2.19, .66, .127, .058], [4.67, .73, .108, .043],
  ] : [[.45, .24, .215, .116], [2.58, .30, .209, .105], [4.60, .40, .193, .114], [1.46, .62, .145, .084]];
  for (const [a, h, reach, spread] of fans) {
    const ux = Math.cos(a), uz = Math.sin(a);
    const point = (r: number, y: number, t: number, light: number) => add(ux * r - uz * t, y, uz * r + ux * t, light);
    const loop = [point(.018, h + .064, 0, .15), point(reach * .55, h + .020, spread, .46)];
    loop.push(point(reach, h - .065 * (1 - h), spread * -.25, .57));
    if (near) loop.push(point(reach * .63, h - .006, -spread * .78, .31));
    const shoulder = point(reach * .39, h + .095, -spread * .14, .81);
    const keel = point(reach * .37, h - .045, spread * .12, .01);
    for (let i = 0; i < loop.length; i++) {
      const k = loop[i], m = loop[(i + 1) % loop.length];
      index.push(shoulder, k, m, keel, m, k);
    }
  }
  const tree = new THREE.BufferGeometry();
  tree.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  tree.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  tree.setIndex(index);
  tree.computeVertexNormals();
  return tree;
}

type Tree = { x: number; z: number; y: number; h: number; yaw: number; tone: number; width: number };
function plant(group: THREE.Group, ground: Terrain, mat: THREE.MeshBasicMaterial): void {
  const r = rng(443), p = new THREE.Object3D(), color = new THREE.Color();
  const meshes = [fir(true), fir(false)];
  const sectors: Tree[][] = Array.from({ length: 12 * meshes.length }, () => []);
  const plantAt = (bx: number, bz: number, near: boolean) => {
    // Gather candidates toward the same coherent stand field that colors the
    // ground. Overlap crowns in groves rather than filling the gaps with trees.
    const pull = near ? 7.4 : 9.5;
    const x = bx + pull * (stand(bx + 3, bz) - stand(bx - 3, bz));
    const z = bz + pull * (stand(bx, bz + 3) - stand(bx, bz - 3));
    const y = ground.height(x, z);
    const dx = (ground.height(x + 2, z) - ground.height(x - 2, z)) / 4;
    const dz = (ground.height(x, z + 2) - ground.height(x, z - 2)) / 4;
    const slope = 1 - 1 / Math.hypot(1, dx, dz);
    const forest = forestCover(x, z, y, slope);
    const dist = Math.hypot(x, z);
    const kx = x - KEEP.x, kz = z - KEEP.z;
    if ((Math.abs(keepSide(kx, kz)) < 21 && keepRun(kx, kz) > -33 && keepRun(kx, kz) < 24)
      || Math.hypot(x - GATE.x, z - GATE.z) < 12
      || Math.hypot(x - 77, z + 62) < 13 || Math.hypot(x - 119, z + 39) < 11
      || dist < 41 || r() > smooth(.27, .67, forest) * .89) return;
    const age = r();
    const h = mix(2.25, near ? 8.4 : 8.5, age ** 1.47) * mix(.80, 1.22, forest);
    const width = mix(1.22, .85, age) * mix(.84, 1.34, r());
    const a = ((Math.atan2(z, x) + TAU) % TAU) / TAU;
    const cell = Math.floor(a * 12) * meshes.length + (near ? 0 : 1);
    sectors[cell].push({ x, z, y: y - .06, h, yaw: r() * TAU,
      tone: mix(.72, 1.03, r()) * mix(.96, 1.05, age), width });
  };
  for (const [min, max, step, near] of [[41, 100, 4.05, true], [100, 239, 6.0, false]] as const) {
    for (let z = -max; z < max; z += step) for (let x = -max; x < max; x += step) {
      const bx = x + r() * step, bz = z + r() * step, d = Math.hypot(bx, bz);
      if (d < min || d >= max) continue;
      plantAt(bx, bz, near);
    }
  }
  // A few anchored stands silhouette the fortress spur and the sides of its scree gullies.
  for (let i = 0; i < 360; i++) {
    const a = r() * TAU, d = 23 + 45 * r();
    const x = KEEP.x + Math.sin(a) * d, z = KEEP.z + Math.cos(a) * d;
    const h = ground.height(x, z);
    if (h > 11 && h < 44) plantAt(x, z, false);
  }
  sectors.forEach((trees, i) => {
    if (!trees.length) return;
    const lod = i % meshes.length;
    const mesh = new THREE.InstancedMesh(meshes[lod], mat, trees.length);
    mesh.name = lod ? 'distant fir stands' : 'near fir stands';
    trees.forEach((t, k) => {
      p.position.set(t.x, t.y, t.z);
      // A few degrees of lean vary the leader without moving the buried foot.
      p.rotation.set(Math.sin(t.yaw * 2) * .061, t.yaw, Math.cos(t.yaw * 3) * .065);
      p.scale.set(t.h * t.width, t.h, t.h * t.width);
      p.updateMatrix();
      mesh.setMatrixAt(k, p.matrix);
      color.setRGB(t.tone * .94, t.tone, t.tone * .96);
      mesh.setColorAt(k, color);
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
}

type Material = 'stone' | 'roof' | 'apertures';
function architecture(group: THREE.Group, ground: Terrain, paints: ReturnType<typeof palette>): void {
  // A single indexed batch per finish: the keep, pass gate, road hamlet and western ruin.
  const bins: Record<Material, THREE.BufferGeometry[]> = { stone: [], roof: [], apertures: [] };
  const tint = new THREE.Color(), source = new THREE.Color();
  const add = (g: THREE.BufferGeometry, color: number, finish: Material) => {
    const pos = g.getAttribute('position'), n = g.getAttribute('normal');
    g.computeBoundingBox();
    const box = g.boundingBox!, ymin = box.min.y, height = Math.max(1, box.max.y - ymin);
    const c = new Float32Array(pos.count * 3);
    source.setHex(color);
    for (let i = 0; i < pos.count; i++) {
      const face = n.getX(i) * -.52 + n.getZ(i) * -.42 + n.getY(i) * .71;
      tint.copy(source).multiplyScalar(finish === 'apertures' ? 1 : mix(.56, 1.15, smooth(-.94, .88, face))
        * mix(.77, 1.12, smooth(0, 1, (pos.getY(i) - ymin) / height)));
      tint.toArray(c, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    if (!g.index) g.setIndex(Array.from({ length: pos.count }, (_, k) => k));
    bins[finish].push(g);
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, tint: number, angle = 0, finish: Material = 'stone') =>
    add(new THREE.BoxGeometry(w, h, d).rotateY(angle).translate(x, y, z), tint, finish);
  const cylinder = (x: number, y: number, z: number, r1: number, r2: number, h: number, tint: number, finish: Material = 'stone') =>
    add(new THREE.CylinderGeometry(r1, r2, h, 10).translate(x, y, z), tint, finish);
  const common = { wall: 0x697480, trim: 0x747d87, roof: 0x36414c, footing: 0x586064 };
  const keep = { wall: 0x515c65, trim: 0x61696f, roof: 0x2f3943, footing: 0x444e53 };
  const { wall: wallColor, trim: edge, roof: roofColor, footing: rubble } = common;
  const base = (x: number, z: number, w: number, d: number, a = 0) => {
    let level = ground.height(x, z);
    for (const u of [-.5, 0, .5]) for (const v of [-.5, 0, .5]) {
      const sx = w * u, sz = d * v;
      level = Math.min(level, ground.height(x + sx * Math.cos(a) + sz * Math.sin(a), z - sx * Math.sin(a) + sz * Math.cos(a)));
    }
    return level - .6;
  };
  const opening = (w: number, h: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2, h * .63);
    shape.quadraticCurveTo(w / 2, h * .84, 0, h);
    shape.quadraticCurveTo(-w / 2, h * .84, -w / 2, h * .63);
    shape.closePath();
    return shape;
  };
  const slit = (x: number, y: number, z: number, w: number, h: number, a: number, strength: number) => {
    add(new THREE.ShapeGeometry(opening(w, h), 4).rotateY(a).translate(x, y, z), strength, 'apertures');
  };
  const curtain = (ax: number, az: number, bx: number, bz: number, top: number, cren = true, finish = common) => {
    const x = (ax + bx) / 2, z = (az + bz) / 2, span = Math.hypot(bx - ax, bz - az), a = Math.atan2(bx - ax, bz - az);
    const y = Math.min(top - .55, base(x, z, 2.2, span, a));
    box(x, (y + top) / 2, z, 2.2, top - y, span + .4, finish.wall, a);
    box(x, top - .4, z, 2.65, .62, span + .5, finish.trim, a);
    const n = Math.floor(span / 2.35);
    if (cren) for (let i = 0; i <= n; i++) {
      const t = (i + .35) / (n + 1);
      box(mix(ax, bx, t), top + .44, mix(az, bz, t), 2.25, 1, 1.11, finish.trim, a);
    }
  };
  const tower = (x: number, z: number, foot: number, r: number, top: number, spire: number, ragged = false, finish = common) => {
    const y = Math.min(top - 4, base(x, z, r * 2, r * 2));
    const skirt = Math.min(top - 1.5, Math.max(foot + 2.1, y + 2.1));
    cylinder(x, (y + skirt) / 2, z, r, r * 1.22, skirt - y, finish.footing);
    cylinder(x, (skirt + top) / 2, z, r * .88, r, top - skirt, finish.wall);
    cylinder(x, top - .2, z, r * 1.06, r * .91, .75, finish.trim);
    cylinder(x, top + .38, z, r * 1.06, r * 1.06, .58, finish.wall);
    if (spire > 0) {
      cylinder(x, top + spire * .15 + .65, z, r * .77, r * 1.22, spire * .30, finish.roof, 'roof');
      cylinder(x, top + spire * .65 + .65, z, .05, r * .77, spire * .70, finish.roof, 'roof');
      cylinder(x, top + spire + 1.02, z, .025, .08, .85, finish.trim);
    } else {
      for (let i = 0; i < 9; i++) {
        if (ragged && (i === 3 || i === 4 || i === 5 || i === 7)) continue;
        const a = i / 9 * TAU;
        box(x + Math.sin(a) * r * .82, top + (ragged && i % 2 ? .9 : 1.32), z + Math.cos(a) * r * .82, .81, ragged && i % 2 ? .68 : 1.32, .65, finish.trim, a);
      }
    }
    // Cardinal slits laid against the taper, above the retaining bank.
    for (const a of [-Math.PI / 2, 0, Math.PI, Math.PI / 2]) {
      slit(x + Math.sin(a) * r * .96, top - 5.4, z + Math.cos(a) * r * .96, .48, 2, a,
        (a === -Math.PI / 2 || a === Math.PI) && spire > 0 ? 0x998471 : 0x463a31);
    }
  };
  const { x, y, z } = KEEP;
  // A recessed upper hall, projecting lower wing, and a descending outer
  // curtain share the same ledge. Feet are cut into the triangulated rock.
  const hallX = x + 3, hallZ = z + 1.8, hallW = 16, hallD = 13.6;
  const hallFoot = base(hallX, hallZ, hallW, hallD), hallTop = y + 24.5;
  box(hallX, (hallFoot + hallTop) / 2, hallZ, hallW, hallTop - hallFoot, hallD, keep.wall);
  box(hallX, hallTop - .9, hallZ, hallW + .56, .68, hallD + .56, keep.trim);
  for (const side of [-1, 1]) {
    for (const dx of [-6.7, -4.0, -1.3, 1.4, 4.1, 6.8])
      box(hallX + dx, hallTop + .52, hallZ + side * hallD / 2, 1.13, 1.26, .82, keep.trim);
    for (const dz of [-4.2, -1.4, 1.4, 4.2])
      box(hallX + side * hallW / 2, hallTop + .52, hallZ + dz, .82, 1.26, 1.15, keep.trim);
  }
  const wingX = x - 8.1, wingZ = z + 1.4, wingTop = y + 15.8;
  const wingFoot = base(wingX, wingZ, 8.8, 16.4);
  box(wingX, (wingFoot + wingTop) / 2, wingZ, 8.8, wingTop - wingFoot, 16.4, 0x465159);
  box(wingX, wingTop - .38, wingZ, 9.1, .62, 16.7, keep.trim);
  for (const dz of [-5.5, -.8, 4.0]) {
    const bx = wingX - 4.5, bz = wingZ + dz;
    const foot = base(bx, bz, 2.6, 1.4), shoulder = wingTop - 1.35;
    box(bx, (foot + shoulder) / 2, bz, 2.35, shoulder - foot, 1.34, keep.footing);
    slit(wingX - 4.43, y + 8.3, bz + 2.0, .88, 3.30, -Math.PI / 2, dz > 0 ? 0x77715a : 0xaca18a);
  }
  for (const dz of [-3.3, 1.3, 5.0])
    slit(hallX - hallW / 2 - .028, y + 18.1, hallZ + dz, .79, 3.6, -Math.PI / 2, dz > 0 ? 0x967f66 : 0x50443b);
  for (const [dx, dy] of [[-4.5, 17.3], [0, 14.4], [4.6, 17.3]])
    slit(hallX + dx, y + dy, hallZ - hallD / 2 - .025, .80, 3.32, Math.PI, dx > 3 ? 0x565044 : 0xa88a6f);
  tower(x - 6.8, z - 8.1, y - 1.8, 3, y + 27, 12.4, false, keep);
  tower(x + 2.3, z + 9.4, y - 1.8, 3.2, y + 31, 15.6, false, keep);
  tower(x + 9.4, z - 6.7, y - 1.8, 2.75, y + 22, 8.5, false, keep);
  tower(x - 27, z - 12.2, y - 13, 3.15, y + 8.7, 8.3, false, keep);
  tower(x - 19, z + 12, y - 10, 3, y + 6.6, 0, false, keep);
  tower(x + 1.5, z + 18.5, y - 8, 2.8, y + 10, 0, false, keep);
  curtain(x - 27, z - 12.2, x - 19, z + 12, y + 2.9, true, keep);
  curtain(x - 19, z + 12, x + 1.5, z + 18.5, y + 4.6, true, keep);
  curtain(x + 1.5, z + 18.5, x + 10.5, z + 7.6, y + 6.8, true, keep);
  curtain(x - 27, z - 12.2, x - 6.8, z - 8.1, y + 5.45, true, keep);
  // The downhill curtain ties the low tower into the base rather than leaving
  // an isolated turret on the skyline. Its slits follow the wall plane.
  const a = Math.atan2(20.2, 4.1);
  for (const t of [.22, .43, .63]) {
    const px = mix(x - 27, x - 6.8, t), pz = mix(z - 12.2, z - 8.1, t);
    slit(px + Math.cos(a) * 1.12, y + 1.5, pz - Math.sin(a) * 1.12, .68, 1.77, a + Math.PI / 2, 0x87705d);
  }

  // Pass gate bridges the road with an actual open pointed arch, viewed from the west.
  const gx = GATE.x, gz = GATE.z, gy = ground.height(gx, gz) - .2, facing = -Math.PI / 2;
  const archW = 4.7, archH = 7.5;
  const portal = new THREE.Shape();
  portal.moveTo(-5.9, -.8); portal.lineTo(-archW / 2, -.8); portal.lineTo(-archW / 2, archH * .63);
  portal.quadraticCurveTo(-archW / 2, archH * .84, 0, archH);
  portal.quadraticCurveTo(archW / 2, archH * .84, archW / 2, archH * .63);
  portal.lineTo(archW / 2, -.8); portal.lineTo(5.9, -.8); portal.lineTo(5.9, 11); portal.lineTo(-5.9, 11); portal.closePath();
  add(new THREE.ExtrudeGeometry(portal, { depth: 5.7, bevelEnabled: false, curveSegments: 6 })
    .translate(0, 0, -2.85).rotateY(facing).translate(gx, gy, gz), wallColor, 'stone');
  // Grated front and the small, recessed gate light behind it.
  slit(gx + 2.4, gy + .18, gz, 3.8, 6.55, facing, 0x7c6550);
  for (let dz = -1.8; dz <= 1.8; dz += .46) box(gx - 2.53, gy + 2.6, gz + dz, .12, 5.22, .12, 0x25292d, 0, 'roof');
  for (let i = -2; i <= 2; i++) box(gx, gy + 11.5, gz + i * 1.72, 6.2, 1.18, .86, edge);
  tower(gx, gz - 5.5, gy, 2.85, gy + 14.6, 5.3);
  tower(gx, gz + 5.5, gy, 2.85, gy + 13.7, 0);
  curtain(gx, gz + 5.5, gx + 3, gz + 16, gy + 7.1);
  curtain(gx, gz - 5.5, gx + 8, gz - 17, gy + 6.2);
  for (const dz of [-1.7, 1.7]) slit(gx - 2.88, gy + 8.3, gz + dz, .64, 1.63, facing, 0x829083);

  const cottage = (x: number, z: number, width: number, depth: number, height: number, a: number) => {
    const top = ground.height(x, z) + height, foot = base(x, z, width, depth, a), lift = width * .38;
    box(x, (foot + top) / 2, z, width, top - foot, depth, rubble, a);
    const gable = new THREE.Shape();
    gable.moveTo(-width * .59, 0); gable.lineTo(0, lift); gable.lineTo(width * .59, 0); gable.closePath();
    add(new THREE.ExtrudeGeometry(gable, { depth: depth + .5, bevelEnabled: false })
      .translate(0, 0, -(depth + .5) / 2).rotateY(a).translate(x, top, z), roofColor, 'roof');
    box(x + Math.cos(a) * width * .28, top + lift * .53, z - Math.sin(a) * width * .28, .62, 2.1, .67, edge, a);
    const w = width * .51;
    slit(x - Math.cos(a) * w, top - height * .63, z + Math.sin(a) * w, .58, .95, a - Math.PI / 2, 0x7e6249);
  };
  cottage(77, -58, 4.4, 7, 3.6, .24);
  cottage(71, -61, 4.0, 4.8, 3.4, -.23);
  cottage(82, -62, 3.5, 4.5, 2.9, -.15);
  cottage(111, -40, 4.5, 5.8, 4.2, -.3);
  cottage(119, -36, 4.0, 6.2, 4, .38);
  cottage(125, -40, 3.5, 4.7, 2.8, -.1);

  const wx = -88, wz = -54, wy = ground.height(wx, wz);
  tower(wx, wz, wy, 3.5, wy + 12.3, 0, true);
  curtain(wx, wz, wx - 9, wz - 4, wy + 3.9, false);
  curtain(wx - 9, wz - 4, wx - 14, wz - 3, wy + 2.3, false);

  for (const kind of ['stone', 'roof', 'apertures'] as const) {
    const geometry = mergeGeometries(bins[kind])!;
    bins[kind].forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geometry, paints[kind]);
    mesh.name = `distant architecture: ${kind}`;
    group.add(mesh);
  }
}

export function buildScenery(): Scenery {
  const group = new THREE.Group();
  group.name = 'scenery';
  const ground = terrain(), paints = palette();
  for (const tile of ground.tiles) {
    const land = new THREE.Mesh(tile, paints.land);
    land.name = 'valley terrain and ridges';
    group.add(land);
  }
  architecture(group, ground, paints);
  plant(group, ground, paints.trees);
  // Refresh once per render, even if the first visible object is not terrain.
  let frame = -1;
  for (const mesh of group.children) mesh.onBeforeRender = (renderer, scene) => {
    if (frame === renderer.info.render.frame) return;
    frame = renderer.info.render.frame;
    paints.update(scene);
  };
  return { group };
}
