// 陈设（从 staticLevel.ts 拆出）：井台、门房/礼拜堂家具、木桶木箱、点缀小物。
// 碰撞盒在 sim/level.ts 的 PROPS / WELL，这里只画视觉，不得越出碰撞盒太多。
// 外部 GLB（public/models/props，CC0/CC-BY 见 CREDITS.md）经 propAssets 归一到圣经第 5 节材质；加载失败回退程序化。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BARRELS, PROPS, RAISED_Y, WELL } from '../sim/level';
import { edgeStock } from './edgeStock';
import { Batch, put } from './geom';
import { Materials, scaleUV, tiledBox, trackPending } from './materials';
import { applyWear, heroFinish, heroOutline, heroSolid, loadProp, mergeByMaterial, sackGeometry, sackTie } from './propAssets';
import { Variants, variants } from './materialVariants';
import { wornPrism } from './wornArris';

const R = RAISED_Y;
const HALF_PI = Math.PI / 2;

function crateBox(b: Batch, v: Variants, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): void {
  b.box(v.woodPlank, x0, z0, x1, z1, y0, y1, 0.9);
  const t = 0.07, o = 0.02;
  const w = x1 - x0, d = z1 - z0, h = y1 - y0;
  for (const [cx, cz] of [[x0 + t / 2, z0 + t / 2], [x1 - t / 2, z0 + t / 2], [x0 + t / 2, z1 - t / 2], [x1 - t / 2, z1 - t / 2]]) {
    b.box(v.woodPlank, cx - t / 2, cz - t / 2, cx + t / 2, cz + t / 2, y0, y1, 0.9);
  }
  // Prioritize the projecting frame; the flush core/posts and thin diagonal straps stay square.
  for (const y of [y0 + t / 2, y1 - t / 2]) {
    b.edgeBox('timber', v.woodPlank, x0 - o, z0 - o, x1 + o, z0 + t, y - t / 2, y + t / 2, 0.9);
    b.edgeBox('timber', v.woodPlank, x0 - o, z1 - t, x1 + o, z1 + o, y - t / 2, y + t / 2, 0.9);
    b.edgeBox('timber', v.woodPlank, x0 - o, z0, x0 + t, z1, y - t / 2, y + t / 2, 0.9);
    b.edgeBox('timber', v.woodPlank, x1 - t, z0, x1 + o, z1, y - t / 2, y + t / 2, 0.9);
  }
  // 斜撑：±z 面与 ±x 面各一根
  const diagZ = Math.hypot(w - 2 * t, h - 2 * t), angZ = Math.atan2(h - 2 * t, w - 2 * t);
  for (const z of [z0 - o - 0.012, z1 + o + 0.012]) {
    b.geo(v.woodBeam, tiledBox(diagZ, 0.09, 0.025, 0.9), (x0 + x1) / 2, (y0 + y1) / 2, z, 0, 0, angZ);
  }
  const diagX = Math.hypot(d - 2 * t, h - 2 * t), angX = Math.atan2(h - 2 * t, d - 2 * t);
  for (const x of [x0 - o - 0.012, x1 + o + 0.012]) {
    b.geo(v.woodBeam, tiledBox(diagX, 0.09, 0.025, 0.9), x, (y0 + y1) / 2, (z0 + z1) / 2, HALF_PI, 0, angX);
  }
}

/** 搭在箱顶的麻布：顶面 + 垂坠褶皱 + 破边 + 底部潮湿深色（顶点色），concept/03 左下。 */
function drapedCloth(cx: number, cz: number, top: number, w: number, d: number, hangE: number, hangS: number): THREE.BufferGeometry {
  const NX = 14, NZ = 14;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const rnd = (i: number): number => { const x = Math.sin(i * 91.7) * 43758.5453; return x - Math.floor(x); };
  for (let iz = 0; iz <= NZ; iz++) {
    const hS = hangS * (0.7 + 0.6 * rnd(iz * 3 + 1)) * (rnd(iz * 7 + 2) > 0.82 ? 0.45 : 1);
    for (let ix = 0; ix <= NX; ix++) {
      const hE = hangE * (0.7 + 0.6 * rnd(ix * 5 + 3)) * (rnd(ix * 11 + 4) > 0.82 ? 0.45 : 1);
      const u = ix / NX, v = iz / NZ;
      const px = -hE + u * (w + 2 * hE);
      const pz = -hS + v * (d + 2 * hS);
      const overX = Math.max(0, -px) + Math.max(0, px - w);
      const overZ = Math.max(0, -pz) + Math.max(0, pz - d);
      const drop = Math.max(overX, overZ);
      const fold = (Math.sin(u * 14 + v * 6) * 0.03 + Math.sin(v * 17 + u * 3) * 0.018) * (0.5 + drop * 2.2);
      const y = top + fold - drop * 0.92;
      const x = cx + Math.min(Math.max(px, 0), w) + (px > w ? 0.02 : px < 0 ? -0.02 : 0);
      const z = cz + Math.min(Math.max(pz, 0), d) + (pz > d ? 0.02 : pz < 0 ? -0.02 : 0);
      pos.push(x, y, z);
      uv.push(u * 2, v * 2);
    }
  }
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
    const a = iz * (NX + 1) + ix, b = a + 1, c = a + NX + 1, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 炉罩/热源上方烟熏扇形贴花：下浓上淡、边缘渐隐。 */
function sootTexture(): THREE.CanvasTexture {
  const W = 128, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, H, 0, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.4)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const rad = g.createRadialGradient(W / 2, H * 0.85, 8, W / 2, H * 0.85, W * 0.75);
  rad.addColorStop(0, 'rgba(0,0,0,1)');
  rad.addColorStop(0.7, 'rgba(0,0,0,0.5)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad; g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** 挂旗：顶部铁杆 + 吊环 + 微波浪布面。原点在杆中心，布面向下垂。 */
function makeBanner(m: Materials, v: Variants, w: number, h: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, h, 10, 16);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const t = (h / 2 - y) / h; // 0 顶 → 1 底
    pos.setZ(i, Math.sin(x * 4.2 + t * 5.5 + seed) * 0.035 * t + Math.sin(t * 9.0) * 0.02 * t);
    // 燕尾：底部中央向上收尖，两角留尾
    if (t > 0.78) {
      const notch = (t - 0.78) / 0.22;
      const center = 1 - Math.min(1, Math.abs(x) / (w * 0.5));
      pos.setY(i, y + notch * center * h * 0.2);
    }
  }
  // 破边：删掉下摆若干三角
  const idxArr = Array.from(geo.index!.array);
  const keep: number[] = [];
  for (let i = 0; i < idxArr.length; i += 3) {
    const cy = (pos.getY(idxArr[i]) + pos.getY(idxArr[i + 1]) + pos.getY(idxArr[i + 2])) / 3;
    const t = (h / 2 - cy) / h;
    const cx = (pos.getX(idxArr[i]) + pos.getX(idxArr[i + 1]) + pos.getX(idxArr[i + 2])) / 3;
    const bite = t > 0.9 && Math.sin(cx * 31 + seed * 7) > 0.55;
    if (!bite) keep.push(idxArr[i], idxArr[i + 1], idxArr[i + 2]);
  }
  geo.setIndex(keep);
  geo.computeVertexNormals();
  const cloth = new THREE.Mesh(geo, v.clothBanner);
  cloth.position.y = -h / 2 - 0.04;
  cloth.castShadow = true; cloth.receiveShadow = true;
  g.add(cloth);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, w + 0.18, 6), m.iron);
  rod.rotation.z = HALF_PI; rod.castShadow = true;
  g.add(rod);
  for (const x of [-w * 0.42, w * 0.42]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 5, 10), m.iron);
    ring.position.set(x, -0.03, 0);
    g.add(ring);
  }
  mergeByMaterial(g);
  return g;
}

/** Well: sawn coping over a staggered stone curb, socketed oak trusses and a hand-cranked windlass. */
function courtyardWell(m: Materials, v: Variants): THREE.Group {
  const g = new THREE.Group();
  g.name = 'courtyard-well';
  const stone = heroFinish(v.wallTrim, 'well-stone', /* glsl */`
    vec3 p = vHeroPos;
    float r = length(p.xz);
    vec2 streakUV = vec2(p.x + p.z * 0.83, p.y);
    float drips = smoothstep(0.45, 0.74, awFbm(streakUV * vec2(12.0, 2.6)));
    float inland = 1.0 - smoothstep(0.66, 0.76, r);
    float splash = (1.0 - smoothstep(0.085, 0.36, p.y)) * (0.65 + 0.35 * drips);
    float runoff = drips * smoothstep(0.24, 0.58, p.y) * (1.0 - smoothstep(0.67, 0.81, p.y));
    float damp = max(inland * 0.93, max(splash, runoff * 0.76));
    float rim = smoothstep(0.752, 0.82, p.y);
    float hand = rim * (1.0 - smoothstep(0.08, 0.52, distance(p.xz, vec2(-0.21, 0.80))));
    float grain = awFbm(streakUV * 32.0 + p.xz * 9.0);
    float patina = awFbm(streakUV * 4.2 + p.xz * 2.8);
    float shade = mix(0.35, 1.0, smoothstep(0.05, 0.75, p.z));
    float moss = smoothstep(0.37, 0.72, patina * 0.78 + grain * 0.22)
      * (1.0 - smoothstep(0.21, 0.59, p.y)) * shade;
    diffuseColor.rgb *= (0.84 + 0.27 * patina + 0.14 * grain) * (1.0 - 0.56 * damp);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.037, 0.046, 0.023) * (0.70 + 0.55 * grain), moss * 0.58);
    roughnessFactor = mix(max(0.55, roughnessFactor - 0.15 * hand), 0.42, damp * 0.78);
  `);
  const mortar = heroFinish(v.wallRough, 'well-mortar', /* glsl */`
    float grain = awFbm(vHeroPos.xz * 19.0 + vHeroPos.y * 23.0);
    diffuseColor.rgb *= mix(0.23, 0.40, grain) * smoothstep(-0.23, 0.6, vHeroPos.y);
    roughnessFactor = 0.84;
  `);
  const slate = heroFinish(v.roofShingle, 'well-slate', /* glsl */`
    float eave = smoothstep(0.25, 0.65, abs(vHeroPos.z));
    diffuseColor.rgb *= mix(1.19, 0.73, eave);
    roughnessFactor = max(0.51, roughnessFactor - 0.12 * eave);
  `);
  const oak = heroFinish(v.woodPlank, 'well-oak', /* glsl */`
    float foot = (1.0 - smoothstep(0.8, 1.12, vHeroPos.y)) * smoothstep(0.62, 0.82, abs(vHeroPos.x));
    // Socketed posts hold moisture. The rope only burnishes the centre of the drum.
    float rope = (1.0 - smoothstep(0.17, 0.23, abs(vHeroPos.x)))
      * (1.0 - smoothstep(0.065, 0.091, length(vHeroPos.yz - vec2(1.465, 0.0))));
    diffuseColor.rgb *= 1.12 - 0.42 * foot - 0.08 * rope;
    roughnessFactor = mix(roughnessFactor, 0.66, 0.84 * foot);
    roughnessFactor = mix(roughnessFactor, 0.73, 0.72 * rope);
  `);
  const wornIron = heroFinish(m.iron, 'well-hand-iron', /* glsl */`
    diffuseColor.rgb = diffuseColor.rgb * 1.55 + vec3(0.012, 0.012, 0.011);
    roughnessFactor = max(0.39, roughnessFactor * 0.75);
    metalnessFactor *= 0.83;
  `);
  const add = (mat: THREE.Material, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
    const part = new THREE.Mesh(geo, mat);
    part.position.set(x, y, z); g.add(part);
    return part;
  };
  // Deterministic hand-cut deviations; joints stagger between lifts, not across one flat texture.
  const rnd = (n: number) => THREE.MathUtils.euclideanModulo(Math.sin(n * 37.19 + 0.8) * 17393.13, 1);
  const tau = Math.PI * 2;
  const masonry = (n: number, inner: number, outer: number, lo: number, hi: number, phase: number, bevel: number) => {
    const edges = Array.from({ length: n + 1 }, (_, i) =>
      (i + phase + (rnd(i % n + phase * 71) - 0.5) * 0.36) * tau / n);
    for (let i = 0; i < n; i++) {
      const seed = i + phase * 89;
      const gap = 0.005 + rnd(seed + 27) * 0.011;
      const a = edges[i] + gap, b = edges[i + 1] - gap;
      const mid = (a + b) / 2;
      const r = outer + (rnd(seed) - 0.5) * 0.069;
      const point = (t: number, d: number): [number, number] => [Math.cos(t) * d, Math.sin(t) * d];
      const chip = 0.003 + 0.027 * rnd(seed + 36);
      const poly = heroOutline([
        point(a, inner + chip * 0.3), point(a, r - chip), point(THREE.MathUtils.lerp(a, b, 0.18), r),
        point(mid, r + (rnd(seed + 16) - 0.37) * 0.035), point(THREE.MathUtils.lerp(a, b, 0.77), r - chip * 0.36),
        point(b, r - chip), point(b, inner + 0.009), point(mid, inner - chip * 0.47),
      ]);
      const y = (lo + hi) / 2 + (rnd(seed + 25) - 0.5) * 0.032;
      const cut = bevel * (0.59 + rnd(seed + 15) * 0.83);
      const geo = heroSolid(poly, hi - lo + (rnd(seed + 9) - 0.5) * 0.032, cut).rotateX(-HALF_PI);
      const p = geo.attributes.position, normals = geo.attributes.normal, uv = geo.attributes.uv;
      // Pick the unjointed part of the scan. Profile variations change the edges, not just the albedo.
      const u0 = 0.555 + rnd(seed + 19) * 0.15, v0 = 0.378 + rnd(seed + 29) * 0.038;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), z = p.getZ(k), yy = p.getY(k);
        const tang = x * -Math.sin(mid) - z * Math.cos(mid);
        const rad = x * Math.cos(mid) - z * Math.sin(mid);
        const up = Math.abs(normals.getY(k)) > 0.5;
        const lean = tang * (rnd(seed + 11) - 0.5) * 0.10 + (rad - r) * (rnd(seed + 6) - 0.5) * 0.085;
        // Small spall at an exposed rim block, easing in toward the sheltered throat.
        const spall = hi > 0.8 && i === 2 && yy > 0 && rad > outer - 0.13
          ? Math.max(0, 0.027 - Math.abs(tang) * 0.12) : 0;
        p.setY(k, yy + lean + Math.sin(tang * 32 + seed) * 0.005 - spall);
        uv.setXY(k, u0 + tang * 0.42, v0 + (up ? (rad - r) * 0.39 : yy * 0.48));
      }
      geo.computeVertexNormals();
      add(stone, geo, 0, y);
    }
  };
  masonry(15, 0.59, 1.244, -0.039, 0.06, 0.18, 0.012); // footings bed into the existing cobbles
  masonry(11, 0.59, 0.953, 0.044, 0.297, 0.58, 0.022);
  masonry(12, 0.61, 0.918, 0.273, 0.507, 1.04, 0.021);
  masonry(11, 0.61, 0.908, 0.484, 0.712, 0.62, 0.023);
  masonry(9, 0.605, 0.964, 0.69, 0.849, 0.88, 0.029); // wider hand-worn coping
  // Recessed mortar backing and the darker wet throat, not a solid cylinder across the opening.
  add(mortar, new THREE.CylinderGeometry(0.852, 0.893, 0.715, 36, 1, true), 0, 0.35);
  add(mortar, new THREE.CylinderGeometry(0.667, 0.646, 0.73, 36, 1, true).scale(-1, 1, 1), 0, 0.35);
  const water = new THREE.MeshStandardMaterial({ color: 0x191d20, roughness: 0.28, metalness: 0.05 });
  add(water, new THREE.CircleGeometry(0.665, 32).rotateX(-HALF_PI), 0, 0.027);

  // All timber is cut with the grain along its axis, including the angled braces and rafters.
  const timber = (a: [number, number, number], b: [number, number, number], width: number, depth: number, seed: number, wornPost = false) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const h = start.distanceTo(end);
    const outline: [number, number][] = [
      [-width * 0.5, 0], [width * 0.5, 0], [width * 0.48, h * 0.38],
      [width * 0.5, h], [-width * 0.48, h], [-width * 0.54, h * 0.64],
    ];
    const u0 = 0.062 + (seed % 7) * 0.127, v0 = rnd(seed);
    const cut = Math.min(0.013, width * 0.15, depth * 0.22);
    let geo: THREE.BufferGeometry;
    if (wornPost) {
      // The tall socketed posts are within arm's reach. Long hand-hewn edges
      // and local loss at one mid-height station; no rounding on the joinery.
      const edge = (i: number, side: number): [number, number, number] => {
        const t = rnd(seed * 9 + i * 17 + side);
        const worn = (side === 1 ? i === 2 : i === 5) ? 0.007 : 0;
        return [cut * (0.39 + 0.69 * t) + worn, cut * (0.49 + 0.58 * (1 - t)) + worn * 0.64,
          0.14 + 0.22 * rnd(seed * 3 + i * 11 + side)];
      };
      geo = wornPrism(outline, -depth / 2, depth / 2, { front: i => edge(i, 1), back: i => edge(i, -1) },
        ([x, y, z], { axis, sign }) => [u0 + (axis === 0 ? z / depth : x / width) * 0.067,
          v0 + 0.51 * (axis === 1 ? (sign > 0 ? h : 0) + z : y)]);
    } else {
      geo = heroSolid(heroOutline(outline), depth, cut);
      const uv = geo.attributes.uv, p = geo.attributes.position, normals = geo.attributes.normal;
      for (let k = 0; k < p.count; k++) {
        const s = Math.abs(normals.getZ(k)) >= Math.abs(normals.getX(k)) ? p.getX(k) / width : p.getZ(k) / depth;
        uv.setXY(k, u0 + s * 0.067, p.getY(k) * 0.51 + v0);
      }
    }
    const member = add(oak, geo, ...a);
    member.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  };
  const pin = (x: number, y: number, z: number, alongX: boolean, r = 0.019, l = 0.026) => {
    const geo = new THREE.CylinderGeometry(r * 0.8, r, l, 6);
    if (alongX) geo.rotateZ(HALF_PI); else geo.rotateX(HALF_PI);
    add(m.iron, geo, x, y, z);
  };
  const ridge = 2.58, eave = 1.81, run = 0.655;
  timber([-1.07, 2.46, 0], [1.07, 2.46, 0], 0.105, 0.11, 6);
  for (const [i, x] of [-0.808, 0.808].entries()) {
    timber([x, 0.78, 0], [x + 0.009, 2.47, 0], 0.156, 0.177, 14 + i * 3, true);
    timber([x, 1.83, -0.58], [x, 1.83, 0.58], 0.124, 0.117, 9 + i);
    timber([x, 1.12, 0], [x * 0.48, 1.85, 0], 0.103, 0.108, 12 + i);
    for (const side of [-1, 1]) {
      timber([x, 1.39, 0], [x, 1.87, side * 0.41], 0.08, 0.095, i * 5 + side + 3);
      timber([x, eave - 0.025, side * 0.67], [x, ridge - 0.085, 0], 0.101, 0.096, i * 3 + side + 8);
      pin(x + Math.sign(x) * 0.084, 1.82, side * 0.37, true);
      pin(x, 1.29, side * 0.094, false);
    }
  }
  const pitch = Math.atan2(ridge - eave, run);
  const slope = Math.hypot(ridge - eave, run);
  for (const side of [-1, 1]) {
    // Individual split slates overlap up the pitch. Non-periodic tail lengths and chipped corners.
    const field = new THREE.Group();
    field.rotation.x = side * pitch;
    field.position.set(0, eave, side * run);
    g.add(field);
    for (let row = 0; row < 5; row++) {
      const start = row * slope / 5;
      timber([-1.027, eave + start * Math.sin(pitch) - 0.042, side * (run - start * Math.cos(pitch))],
        [1.027, eave + start * Math.sin(pitch) - 0.042, side * (run - start * Math.cos(pitch))], 0.044, 0.052, row + 4);
      const n = 8 + row % 2;
      const edges = Array.from({ length: n + 1 }, (_, k) => -1.077 + 2.154 * k / n + (k > 0 && k < n ? 0.041 * (rnd(k + row * 19) - 0.5) : 0));
      for (let k = 0; k < n; k++) {
        const seed = row * 29 + k + (side === 1 ? 300 : 0);
        const l = edges[k] + 0.002, r = edges[k + 1] - 0.002;
        const tail = start + (rnd(seed) - 0.5) * 0.035;
        const head = Math.min(slope + 0.016, start + slope / 5 + 0.08);
        const chip = 0.013 + 0.025 * rnd(seed + 17);
        const tile = heroSolid(heroOutline([[l, tail + chip], [l + chip, tail], [r - chip * 0.65, tail + 0.004],
          [r, tail + chip], [r, head], [l + 0.008, head]]), 0.023, 0.004);
        const p = tile.attributes.position, uv = tile.attributes.uv;
        const u0 = 0.041 + 0.14 * (k % 7), v0 = 0.025 + 0.112 * (Math.floor(rnd(seed + 50) * 8));
        for (let j = 0; j < p.count; j++) uv.setXY(j, u0 + (p.getX(j) - l) * 0.34, v0 + (p.getY(j) - tail) * 0.29);
        // From the XY profile into the local roof plane. The higher course lies on top of the lap.
        tile.rotateX(-side * HALF_PI);
        tile.translate(0, 0.011 + row * 0.009 + rnd(seed + 7) * 0.004, 0);
        field.add(new THREE.Mesh(tile, slate));
      }
    }
  }
  // Split ridge covers wrap the apex and hide the heads of the last courses.
  for (let i = 0; i < 7; i++) {
    const l = -1.08 + i * 0.308;
    for (const side of [-1, 1]) {
      const cap = heroSolid(heroOutline([[l, -0.066], [l + 0.321, -0.072], [l + 0.312, 0.062], [l + 0.004, 0.067]]), 0.029, 0.006);
      cap.rotateX(-HALF_PI - side * pitch * 0.8);
      add(slate, cap, 0, ridge + 0.02, side * 0.046);
    }
  }

  const axleY = 1.465;
  const drum = new THREE.CylinderGeometry(0.077, 0.075, 1.38, 12).rotateZ(HALF_PI);
  const drumUV = drum.attributes.uv;
  for (let i = 0; i < drumUV.count; i++) drumUV.setXY(i, 0.45 + drumUV.getX(i) * 0.07, drumUV.getY(i) * 0.66);
  add(oak, drum, 0, axleY);
  add(m.iron, new THREE.CylinderGeometry(0.025, 0.025, 1.92, 10).rotateZ(HALF_PI), 0, axleY);
  for (const x of [-0.91, -0.663, 0.663, 0.91]) {
    const r = Math.abs(x) < 0.9 ? 0.082 : 0.04;
    add(m.iron, new THREE.CylinderGeometry(r, r, 0.031, 12).rotateZ(HALF_PI), x, axleY);
  }
  const crank = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.935, axleY, 0), new THREE.Vector3(-0.974, axleY - 0.03, 0.042),
    new THREE.Vector3(-0.974, axleY - 0.153, 0.17), new THREE.Vector3(-1.016, axleY - 0.19, 0.195),
  ]);
  add(m.iron, new THREE.TubeGeometry(crank, 14, 0.022, 6, false));
  add(wornIron, new THREE.CapsuleGeometry(0.028, 0.116, 3, 10).rotateZ(HALF_PI), -1.092, axleY - 0.19, 0.195);

  const spool: THREE.Vector3[] = [];
  for (let i = 0; i <= 88; i++) {
    const t = i / 88, a = t * 16 * tau;
    spool.push(new THREE.Vector3(-0.205 + t * 0.375, axleY - Math.sin(a) * 0.089, Math.cos(a) * 0.089));
  }
  const ropeX = spool.at(-1)!.x;
  // Leave the drum at its side tangent, then hang under load from the bail.
  spool.push(new THREE.Vector3(ropeX, axleY - 0.115, 0.089), new THREE.Vector3(ropeX, 1.195, 0.088));
  add(m.cloth, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spool), 250, 0.0125, 6, false));
  const bucket = new THREE.Group();
  bucket.position.set(ropeX, 0.855, 0.088);
  g.add(bucket);
  const staveDepth = 0.016;
  for (let i = 0; i < 12; i++) {
    const a = i * tau / 12;
    const l = 0.024, r = 0.032;
    const shape = heroOutline([[-l, 0], [l, 0], [r, 0.21], [-r, 0.21]]);
    const stave = heroSolid(shape, staveDepth, 0.003).rotateX(0.17).translate(0, 0, 0.093);
    const uv = stave.attributes.uv, p = stave.attributes.position;
    for (let j = 0; j < p.count; j++) uv.setXY(j, 0.048 + (i % 7) * 0.127 + p.getX(j) * 0.9, 0.16 + p.getY(j) * 1.9);
    const plank = new THREE.Mesh(stave, oak);
    plank.rotation.y = a; bucket.add(plank);
  }
  bucket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.096, 0.095, 0.017, 12), oak));
  for (const [y, r] of [[0.042, 0.103], [0.173, 0.127]]) {
    const hoop = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(r - 0.006, -0.011), new THREE.Vector2(r + 0.001, -0.011),
      new THREE.Vector2(r + 0.003, 0.012), new THREE.Vector2(r - 0.006, 0.012),
    ], 12), m.iron);
    hoop.position.y = y; bucket.add(hoop);
  }
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.131, 0.008, 6, 16, Math.PI), wornIron);
  bail.position.y = 0.204; bucket.add(bail);
  mergeByMaterial(g);
  g.rotation.y = -0.22;
  g.position.set(WELL.x, 0, -WELL.z);
  return g;
}

export function buildFurniture(m: Materials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'furniture';
  const b = new Batch();
  const v = variants(m);
  // These shared families also cover the courtyard cart, staging and crates.
  applyWear(v.woodPlank, { kind: 'wood', groundY: 0 });
  applyWear(v.woodBeam, { kind: 'wood', groundY: 0 });
  applyWear(v.woodFloorOld, { kind: 'wood' });
  applyWear(m.wood, { kind: 'wood' });
  applyWear(v.clothLinen, {
    kind: 'cloth', center: [-4.52, -27.57], rimY: 1.17,
    sacks: [[-2.5, -2.0, 0.32], [-2.0, -1.6, 0.28], [-9.3, 8.6, 0.3], [-9.0, 9.3, 0.26], [-2.05, -2.2, 0.18]],
  });
  // 共享金属/织物实例（非 5.1 族类）：铜烛座与旗巾，便于按材质合批
  const bronze = new THREE.MeshStandardMaterial({ color: 0xa89060, roughness: 0.45, metalness: 1 });
  const wineCloth = new THREE.MeshPhysicalMaterial({ color: 0x5b1f24, roughness: 0.95, sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x6a4a44) });
  const barrelSlots: { x: number; z: number; y0: number; h: number; ry: number; r?: number }[] = [];

  group.add(courtyardWell(m, v));

  // 不随状态变化的陈设（碰撞盒见 level.ts 的 PROPS）
  for (const p of PROPS) {
    const y0 = p.y0 ?? (p.x0 >= 13 || p.z0 >= 25.5 ? R : 0); // map:
    switch (p.tag) {
      case 'hearth': {
        // 石砌开放壁炉（concept/02）：烟囱胸墙从墙里长出 + 敞开炉膛 + 石炉台 + 炉罩烟熏
        const hx = p.x0, hz0 = p.z0, hz1 = p.z1;
        b.edgeBox('stone', v.wallTrim, hx, hz0 - 0.1, hx + 0.85, hz1 + 0.1, 0, 0.16); // 炉前石台
        b.edgeBox('stone', v.wallAshlar, hx, hz0, hx + 0.55, hz0 + 0.45, 0.16, 1.5); // 左垛
        b.edgeBox('stone', v.wallAshlar, hx, hz1 - 0.45, hx + 0.55, hz1, 0.16, 1.5); // 右垛
        b.box(v.wallRough, hx, hz0 + 0.45, hx + 0.15, hz1 - 0.45, 0.16, 1.5); // 炉膛背
        b.box(v.wallRough, hx, hz0 + 0.45, hx + 0.55, hz1 - 0.45, 0.16, 0.24); // 炉膛底
        // 尖拱券眉 + 托石 + 炉罩 mantel
        for (const sz of [-1, 1]) {
          b.geo(v.wallTrim, edgeStock(0.16, 0.16, 0.85, 1, 'stone'), hx + 0.27, 1.32, -4.4 + sz * 0.42, -sz * 0.35, 0, 0);
          b.edgeBox('stone', v.wallTrim, hx + 0.45, -4.4 + sz * 0.78 - 0.09, hx + 0.62, -4.4 + sz * 0.78 + 0.09, 1.34, 1.5);
        }
        b.edgeBox('stone', v.wallTrim, hx, hz0 - 0.06, hx + 0.68, hz1 + 0.06, 1.5, 1.64); // mantel
        // 收分炉罩（四棱台）+ 烟道
        const hood = scaleUV(new THREE.CylinderGeometry(0.72, 1.7, 1.1, 4, 1), 1.5);
        hood.rotateY(Math.PI / 4);
        hood.scale(0.24, 1, 1);
        b.geo(v.wallAshlar, hood, hx + 0.28, 2.19, -4.4);
        b.box(v.wallAshlar, hx + 0.05, -4.85, hx + 0.5, -3.95, 2.72, 3.5);
        // 炉膛正上方铁吊杆 + 吊环（吊锅挂这里）
        b.box(m.iron, hx + 0.22, hz0 + 0.45, hx + 0.34, hz1 - 0.45, 1.42, 1.47);
        b.geo(m.iron, new THREE.TorusGeometry(0.035, 0.01, 5, 8), hx + 0.28, 1.38, -4.4);
        // 炉罩烟熏：贴附炉罩表面的渐淡壳（热源正上方，圣经 5.2）
        const sootMat = new THREE.MeshBasicMaterial({
          map: sootTexture(), transparent: true, depthWrite: false, color: 0x0a0908, opacity: 0.6,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        const sootHood = new THREE.Mesh(hood.clone().scale(1.03, 1.0, 1.03), sootMat);
        sootHood.position.set(hx + 0.28, 2.19, -4.4);
        sootHood.renderOrder = 1;
        group.add(sootHood);
        const sootBack = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), sootMat);
        sootBack.rotation.y = HALF_PI;
        sootBack.position.set(hx + 0.16, 1.1, -4.4);
        sootBack.renderOrder = 1;
        group.add(sootBack);
        // 炉膛内柴堆
        const logs = loadProp({
          name: 'firewood', size: 1.0,
          normDefault: { color: 0x6b5038, wear: { kind: 'wood' } },
        });
        logs.position.set(hx + 0.28, 0.24, 4.4);
        group.add(logs);
        // 吊锅：铁链挂在炉膛正上方
        const pot = loadProp({
          name: 'cauldron', size: 0.95,
          normDefault: { color: 0x5a5d62, roughness: 0.8, metalness: 0.3, wear: { kind: 'soot', seed: 6, sootY: 0.55 } },
        });
        pot.position.set(hx + 0.28, 0.5, 4.4);
        group.add(pot);
        break;
      }
      case 'pot': {
        // 炉旁石墩：备餐台（热食碗/食材），锅已挂在炉膛上方
        b.edgeBox('stone', v.wallTrim, p.x0, p.z0, p.x1, p.z1, 0, 0.3);
        break;
      }
      case 'woodpile': {
        const pile = loadProp({
          name: 'firewood', size: 1.05,
          normDefault: { color: 0x8a7a62, wear: { kind: 'wood' } },
        });
        pile.position.set(-2.6, 0, 6.45);
        group.add(pile);
        const pile2 = loadProp({
          name: 'firewood', size: 0.8, rotY: 0.14, yOff: 0.3,
          normDefault: { color: 0x7a6a52, wear: { kind: 'wood' } },
        });
        pile2.position.set(-2.6, 0, 6.45);
        group.add(pile2);
        break;
      }
      case 'bench': {
        const table = loadProp({
          name: 'table', size: 2.2, rotY: HALF_PI, stretch: [1, 1.35, 1],
          // Worktop height after normalization and the vertical stretch.
          normDefault: { color: 0x6b5038, wear: { kind: 'wood', contactY: 0.906 } },
        });
        table.position.set(2.6, 0, 4.5);
        group.add(table);
        b.box(v.woodBeam, 2.72, p.z0 + 0.1, 3, p.z1 - 0.1, 1.75, 1.8, 1);
        break;
      }
      case 'cot': {
        const bed = loadProp({
          name: 'bed', size: 1.95, rotY: HALF_PI, stretch: [0.62, 0.6, 1],
          normDefault: { color: 0x9a8a72, wear: { kind: 'wood' } },
        });
        bed.position.set(0.6, 0, 7.55);
        group.add(bed);
        break;
      }
      case 'stool': {
        const stool = loadProp({
          name: 'stool', size: 0.66,
          // The seat sits just below the normalized longest dimension (depth).
          normDefault: { color: 0x7a6a52, wear: { kind: 'wood', contactY: 0.653 } },
        });
        stool.position.set(1.8, 0, 6.3);
        group.add(stool);
        break;
      }
      case 'shelf': {
        const shelf = loadProp({
          // The open +Z face of the GLB becomes north (-Z in the renderer).
          name: 'shelf', size: p.h - y0, rotY: Math.PI, stretch: [2.4, 1, 2.1],
          normDefault: { color: 0x4a3a2c, wear: { kind: 'wood', groundY: y0 } },
        });
        group.add(put(shelf, (p.x0 + p.x1) / 2, y0, (p.z0 + p.z1) / 2));
        break;
      }
      case 'crates':
        crateBox(b, v, p.x0, p.z0, p.x0 + 0.75, p.z0 + 0.75, 0, 0.75);
        crateBox(b, v, p.x0 + 0.5, p.z0 + 0.6, p.x1, p.z1, 0, 0.6);
        barrelSlots.push({ x: p.x0 + 0.4, z: p.z0 + 0.4, y0: 0.75, h: 0.85, ry: 0.6 });
        break;
      case 'rubble': break; // 地表瓦砾属于环境，见 staticLevel.ts
      case 'crate':
        crateBox(b, v, p.x0, p.z0, p.x1, p.z1, y0, y0 + p.h);
        break;
      case 'flaskTable':
        b.edgeBox('timber', v.woodPlank, p.x0, p.z0, p.x1, p.z1, y0 + 0.78, y0 + 0.86, 1);
        for (const [dx, dz] of [[0.05, 0.05], [0.05, 0.65], [0.65, 0.05], [0.65, 0.65]]) {
          b.edgeBox('timber', v.woodBeam, p.x0 + dx, p.z0 + dz, p.x0 + dx + 0.1, p.z0 + dz + 0.1, y0, y0 + 0.78, 1);
        }
        break;
      case 'altar':
        b.edgeBox('stone', v.wallTrim, p.x0, p.z0, p.x1, p.z1, y0, y0 + 0.2);
        b.edgeBox('stone', v.wallAshlar, p.x0 + 0.15, p.z0 + 0.12, p.x1 - 0.15, p.z1 - 0.12, y0 + 0.2, y0 + 0.95);
        b.edgeBox('stone', v.wallTrim, p.x0, p.z0, p.x1, p.z1, y0 + 0.95, y0 + 1.1);
        break;
      case 'brazier': break; // 由 props.ts 画（随状态变化）
      case 'pew': {
        const pew = loadProp({
          name: 'pew', size: 1.95, rotY: Math.PI,
          matOverride: { NewMat01: wineCloth, NewMat02: wineCloth },
          norm: {
            Default: { color: 0xb09880, wear: { kind: 'wood', contactY: y0 + 0.45 } },
            NewMat03: { color: 0xc9b891, roughness: 1, metalness: 0 },
          },
          // Keep the replacement cloth's existing tint and roughness.
          normDefault: { color: 0xb09880, roughness: 0.8, metalness: 0 },
        });
        pew.position.set((p.x0 + p.x1) / 2, y0, -((p.z0 + p.z1) / 2));
        group.add(pew);
        break;
      }
    }
  }

  // —— 旗：东墙褪色酒红长旗 + 门房旗（统一燕尾破边） ——
  const eastBanner = makeBanner(m, v, 0.95, 2.5, 171);
  eastBanner.rotation.y = -HALF_PI;
  eastBanner.position.set(9.94, 4.1, -22.5);
  group.add(eastBanner);
  const ghBanner = makeBanner(m, v, 0.85, 1.8, 293);
  ghBanner.position.set(-1.6, 3.1, 7.84);
  group.add(ghBanner);

  // 点缀：麻袋、跪凳
  // 麻袋：扎口颈 + 塌口 + 布褶 + 摊平底，大小/倾斜/塌陷各异
  b.geo(v.clothLinen, sackGeometry(3, 0.3, 0.44, 0.35), -2.5, 0, -2.0, 0, 0.5, 0.1);
  b.geo(v.clothLinen, sackTie(0.3, 0.44), -2.5, 0, -2.0, 0, 0.5, 0.1);
  b.geo(v.clothLinen, sackGeometry(11, 0.26, 0.36, 0.4), -2.0, 0, -1.6, 0.05, 0.7, 0);
  b.geo(v.clothLinen, sackTie(0.26, 0.36), -2.0, 0, -1.6, 0.05, 0.7, 0);
  b.edgeBox('timber', v.woodBeam, 18.2, 10.7, 19.8, 11.0, R, R + 0.14, 1);

  // —— 木桶（鼓腹+铁箍 GLB）：ref 机位前景一组 ——
  const barrelFallbacks: THREE.Group[] = [];
  const addBarrel = (x: number, z: number, y0: number, h: number, ry = 0): void => {
    barrelSlots.push({ x, z, y0, h, ry });
  };
  const buildBarrelFallback = (slot: { x: number; z: number; y0: number; h: number; ry: number; r?: number }): THREE.Group => {
    const { x, z, y0, h, ry } = slot;
    const rad = (slot.r ?? 0.345) / 0.345;
    const g = new THREE.Group();
    const prof: THREE.Vector2[] = [];
    const rp = (t: number): number => (0.26 + 0.085 * Math.sin(t * Math.PI)) * rad;
    for (let i = 0; i <= 8; i++) prof.push(new THREE.Vector2(rp(i / 8), (i / 8) * h));
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), v.woodPlank);
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    for (const t of [0.14, 0.86]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(rp(t) + 0.008, 0.016, 5, 16), m.iron);
      hoop.rotation.x = HALF_PI; hoop.position.y = t * h;
      hoop.castShadow = true;
      g.add(hoop);
    }
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(rp(1) - 0.02, rp(1) - 0.02, 0.025, 14), v.woodPlank);
    lid.position.y = h - 0.01; lid.castShadow = true;
    g.add(lid);
    g.position.set(x, y0, -z);
    g.rotation.y = ry;
    group.add(g);
    return g;
  };
  barrelSlots.push(...BARRELS.map((slot) => ({ ...slot, y0: 0 })));
  addBarrel(8.6, 21, 0, 0.85, 2.2);
  addBarrel(-8.25, 5.12, 0, 0.8, 0.9);
  addBarrel(-9.2, 9, 0, 0.8, 0.9);
  for (const slot of barrelSlots) barrelFallbacks.push(buildBarrelFallback(slot));

  // 前景货箱 + 搭布（西墙shelf北端，不挡中央路径）
  crateBox(b, v, -4.9, 27.2, -4.15, 27.95, 0, 0.7);
  crateBox(b, v, -4.72, 27.35, -4.3, 27.8, 0.7, 1.15);
  const drapeW = drapedCloth(-4.9, -27.95, 1.17, 0.75, 0.75, 0.5, 0.5);
  b.geo(v.clothLinen, drapeW, 0, 0, 0);
  // 断柱与倒落的柱头
  b.geo(v.wallTrim, scaleUV(new THREE.CylinderGeometry(0.34, 0.38, 0.75, 12), 1), 7, 0.375, 24);
  b.geo(v.wallTrim, new THREE.CylinderGeometry(0.34, 0.34, 0.5, 12), 7.9, 0.34, 24.6, 0, 0, HALF_PI);
  b.edgeBox('stone', v.wallRough, 6.4, 23.4, 7.0, 24.0, 0, 0.3);
  // 东墙装饰灯座（未点）
  for (const z of [10, 20]) {
    b.box(m.iron, 9.8, z - 0.06, 9.95, z + 0.06, 2.0, 2.5);
    b.geo(m.iron, new THREE.CylinderGeometry(0.1, 0.06, 0.1, 8), 9.72, 2.1, z);
    b.geo(m.iron, new THREE.TorusGeometry(0.07, 0.015, 4, 8, Math.PI), 9.8, 2.3, z, HALF_PI);
  }
  // 东货箱搭布与额外麻袋
  const drapeE = drapedCloth(9.3, -10.2, 0.62, 0.7, 0.6, 0.26, 0.26);
  b.geo(v.clothLinen, drapeE, 0, 0, 0);
  b.geo(v.clothLinen, sackGeometry(15, 0.28, 0.4, 0.3), -9.3, 0, 8.6, 0, 2.4, -0.08);
  b.geo(v.clothLinen, sackTie(0.28, 0.4), -9.3, 0, 8.6, 0, 2.4, -0.08);
  b.geo(v.clothLinen, sackGeometry(21, 0.24, 0.32, 0.6), -9.0, 0, 9.3, 0.16, 0.8, 0);
  b.geo(v.clothLinen, sackTie(0.24, 0.32), -9.0, 0, 9.3, 0.16, 0.8, 0);
  // 井旁空桶与篮筐（叙事物：打水的家伙什）
  const bucket = loadProp({
    name: 'bucket', size: 0.5, rotY: 0.7,
    norm: { wooden_bucket_01: { color: 0x8a7a62, wear: { kind: 'wood', packedMetal: true, groundY: 0 } } },
  });
  bucket.position.set(1.7, 0, -12.6);
  group.add(bucket);
  const basket = loadProp({
    name: 'basket', size: 0.42, rotY: 1.2,
    norm: { wicker_basket_01: { color: 0x7a6a52, wear: { kind: 'wood' } } },
  });
  basket.position.set(-3.6, 0, -27.9);
  group.add(basket);

  // 礼拜堂祭台烛台（蜡油覆盖的铜烛台，CC0）
  const candles = loadProp({
    name: 'candles', size: 0.6,
    matOverride: { brass_candleholders_01: bronze, brass_candleholders_02: bronze, brass_candleholders_03: bronze },
    norm: {
      brass_candleholders_flame: { color: 0x1a0d02, emissive: 0xffb25e, emissiveIntensity: 1.5, roughness: 0.5, metalness: 0, opacity: 0.95 },
      brass_candleholders_candles: { color: 0xd8d2c0, roughness: 0.6, metalness: 0 },
    },
  });
  candles.position.set(18.3, R + 1.1, -9.0);
  group.add(candles);

  // glTF 木桶模型（Poly Haven wine_barrel_01，CC0）：归一化尺度后原位替换兜底桶
  trackPending(new Promise<void>((resolve) => {
    new GLTFLoader().load('models/wine_barrel_01/wine_barrel_01.gltf', (gltf) => {
      const src = gltf.scene;
      src.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(src);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      barrelSlots.forEach((slot, i) => {
        const clone = src.clone(true);
        const ky = slot.h / size.y;
        const kr = slot.r ? slot.r * 2 / Math.max(size.x, size.z) : ky;
        const barrel = new THREE.Group();
        clone.scale.set(kr, ky, kr);
        clone.position.set(-center.x * kr, -box.min.y * ky, -center.z * kr);
        barrel.position.set(slot.x, slot.y0, -slot.z);
        barrel.rotation.y = slot.ry;
        barrel.add(clone);
        const vr = (k: number): number => { const x = Math.sin((i + 1) * 77.7 + k * 13.1) * 43758.5453; return x - Math.floor(x); };
        clone.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            const src = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (src.isMeshStandardMaterial) {
              // Preserve atlas alignment across the staves and iron hoops. Vary only the timber tint.
              const mc = src.clone();
              mc.color.setHex(0x8a7a62).multiplyScalar(0.92 + vr(1) * 0.16);
              mc.envMapIntensity = 0.7;
              applyWear(mc, { kind: 'wood', packedMetal: true, groundY: slot.y0 === 0 ? 0 : undefined });
              (o as THREE.Mesh).material = mc;
            }
          }
        });
        mergeByMaterial(clone);
        group.add(barrel);
        group.remove(barrelFallbacks[i]);
      });
      resolve();
    }, undefined, () => resolve());
  }));

  b.build(group, true);
  return group;
}
