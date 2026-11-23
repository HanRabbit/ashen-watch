// 远景（art pass 3 · 第六轮 / 圣经 v2.9）：远景森林 = 画布程序化「林冠团块」贴图带（连续深色林体 +
// 锯齿冠廓 + 多频噪声斑驳），不再是实例化圆锥树阵列；只有最近 foothill 保留少量 3D 单株。
// 坡面/岩崖/石材用冷灰偏深固有色贴图再叠雾，不得为白；逐片段天空上限仅作保护上限。
// 城堡石砌体与深色屋面拆两个合批网格；植被落点采样实际地形高度场；大气锚定天空地平线。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Materials } from './materials';

export interface Scenery {
  group: THREE.Group;
}

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const HALF_PI = Math.PI / 2;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// —— 逐片段天空上限（与主天空同梯度+同云，共享 uniform 值）——
const SKYCAP_GLSL = /* glsl */`
uniform vec3 uScHorizon, uScZenith, uScCloudDark, uScCloudLit, uScSunColor, uScSunDir;
uniform float uScTime, uScCover, uScStars, uScGlow, uScRim;
float scHash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float scNoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  float a=scHash(i),b=scHash(i+vec2(1,0)),c=scHash(i+vec2(0,1)),d=scHash(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float scFbm(vec2 p){ float v=0.0,a=0.55; mat2 r=mat2(0.8,-0.6,0.6,0.8);
  for(int i=0;i<5;i++){ v+=a*scNoise(p); p=r*p*2.03+11.7; a*=0.5; } return v; }
float scFbm3(vec2 p){ float v=0.0,a=0.6;
  for(int i=0;i<3;i++){ v+=a*scNoise(p); p=p*2.11+7.3; a*=0.5; } return v; }
float scShape(vec2 uv){ vec2 w=vec2(scFbm3(uv*1.4+1.7),scFbm3(uv*1.4+9.2));
  float b=scFbm(uv*1.8+w*0.40); float d=scFbm3(uv*3.2+w*0.6); return b*0.65+d*0.35; }
float scGrad(vec2 uv){ return scFbm(uv*1.8); }
vec3 awSkyCap(vec3 d){
  float h=d.y;
  vec3 col=mix(uScHorizon,uScZenith,pow(clamp(h,0.0,1.0),0.55));
  vec3 sd=normalize(uScSunDir);
  float cosA=clamp(dot(d,sd),0.0,1.0);
  col+=uScSunColor*uScGlow*0.22*pow(cosA,3.0);
  float hh=max(h,0.02);
  vec2 proj=d.xz/(hh+0.35);
  vec2 uv1=proj*0.45+uScTime*vec2(0.003,0.0013)+2.3;
  float veil=smoothstep(0.55,0.95,scFbm(uv1))*0.22*(1.0-uScStars*0.6)*smoothstep(-0.02,0.12,h);
  col=mix(col,mix(uScHorizon,uScCloudLit,0.35),veil);
  vec2 uv2=proj*0.8+uScTime*vec2(0.004,0.0018);
  float dens=scShape(uv2);
  float lo=0.62-uScCover*0.20; float hi=lo+0.10;
  float cover=smoothstep(lo,hi,dens)*smoothstep(-0.02,0.08,h);
  float e=0.10;
  vec2 grad=vec2(scGrad(uv2+vec2(e,0.0))-scGrad(uv2-vec2(e,0.0)), scGrad(uv2+vec2(0.0,e))-scGrad(uv2-vec2(0.0,e)));
  vec3 cn=normalize(vec3(-grad.x*2.2,0.55,-grad.y*2.2));
  float lambert=clamp(dot(cn,sd),0.0,1.0);
  float topLight=mix(0.30,1.0,smoothstep(0.05,0.85,h));
  float thick=smoothstep(lo,hi+0.10,dens);
  float lit=clamp(0.12+0.88*lambert,0.0,1.0)*topLight*mix(1.0,0.45,thick);
  vec3 cloudCol=mix(uScCloudDark,uScCloudLit,lit);
  cloudCol+=uScSunColor*uScRim*cover*(1.0-cover)*4.0*pow(cosA,6.0);
  return mix(col,cloudCol,cover);
}
`;

/** 值噪声 + fbm（画布程序化肌理用）。 */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (a: number, b: number): number => {
    let n = a * 374761393 + b * 668265263 + seed * 1442695041;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
function fbm2(x: number, y: number, seed: number): number {
  return 0.55 * vnoise(x, y, seed) + 0.3 * vnoise(x * 2.1 + 7, y * 2.1 + 3, seed + 1) + 0.15 * vnoise(x * 4.3 + 11, y * 4.3 + 5, seed + 2);
}

/** 画布林冠团块贴图：顶边锯齿冠廓（alpha 裁切），下方连续深色林体 + 多频噪声斑驳。 */
function canopyTexture(seed: number, scale: number, hazeMix: number): THREE.CanvasTexture {
  const W = 1024, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  const waves = Array.from({ length: 7 }, () => ({ f: 1 + r() * 6, ph: r() * 6.28, a: 0.4 + r() * 0.6 }));
  const crown = (x: number): number => {
    let n = 0;
    for (const w of waves) n += w.a * Math.sin((x / W) * w.f * Math.PI * 2 * scale + w.ph);
    n /= waves.length;
    const crowns = fbm2(x * 0.3 * scale, 8.7, seed + 13);
    return H * (0.023 + (n * 0.5 + 0.5) * 0.072 + crowns * 0.036);
  };
  const img = g.createImageData(W, H);
  const haze = [142, 159, 174];
  for (let x = 0; x < W; x++) {
    const cl = crown(x);
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (y < cl) { img.data[i + 3] = 0; continue; }
      const depth = clamp01((y - cl) / (H - cl));
      // 有机多频噪声：大冠团 / 中凹凸 / 细树隙 / 竖向冠簇
      const n1 = fbm2(x * 0.018 * scale, y * 0.03, seed) * 2 - 1;
      const n2 = fbm2(x * 0.07 * scale, y * 0.1 + 40, seed + 9) * 2 - 1;
      const n3 = fbm2(x * 0.22 * scale, y * 0.22, seed + 17);
      const clump = fbm2(x * 0.045 * scale, 0.5, seed + 23) * 2 - 1;
      const lit = clamp01(0.5 + 0.62 * n1 + 0.29 * n2 + 0.32 * clump - 0.25 * depth);
      const gap = clamp01(n3 - 0.66) * 3.2; // 树隙阴影
      let rr = 34 + lit * 34 - gap * 20;
      let gg = 42 + lit * 36 - gap * 22;
      let bb = 40 + lit * 36 - gap * 20;
      // 冠顶受光边
      if (depth < 0.12) { rr += 12; gg += 13; bb += 11; }
      rr = rr * (1 - hazeMix) + haze[0] * hazeMix;
      gg = gg * (1 - hazeMix) + haze[1] * hazeMix;
      bb = bb * (1 - hazeMix) + haze[2] * hazeMix;
      img.data[i] = rr; img.data[i + 1] = gg; img.data[i + 2] = bb; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 岩石贴图：冷灰偏深 + 斑驳 + 水平岩层 + 垂直节理 + 少量苔。 */
function rockTexture(seed: number, hazeMix: number, grassy = false): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const haze = [174, 182, 191];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const n1 = fbm2(x * 0.02, y * 0.02, seed) * 2 - 1;
      const n2 = fbm2(x * 0.08, y * 0.08, seed + 5) * 2 - 1;
      const n3 = fbm2(x * 0.3, y * 0.3, seed + 11) * 2 - 1;
      let v = 0.5 + 0.5 * n1 + 0.3 * n2 + 0.15 * n3;
      const strata = fbm2(0.5, y * 0.05, seed + 41) > 0.62 ? -0.16 : 0;
      const joint = fbm2(x * 0.03, 0.5, seed + 47) > 0.72 ? -0.26 : 0;
      v = clamp01(v + strata + joint);
      let rr = 76 + v * 60, gg = 82 + v * 62, bb = 88 + v * 64;
      if (grassy) {
        const moss = clamp01(fbm2(x * 0.02, y * 0.024, seed + 31) - 0.55) * 2.4;
        rr = rr * (1 - moss * 0.5) + 75 * moss * 0.5;
        gg = gg * (1 - moss * 0.5) + 90 * moss * 0.5;
        bb = bb * (1 - moss * 0.5) + 60 * moss * 0.5;
      } else {
        const moss = clamp01(n3 * 0.5 + 0.5 - 0.78) * 2;
        rr = rr * (1 - moss * 0.4) + 75 * moss * 0.4;
        gg = gg * (1 - moss * 0.4) + 90 * moss * 0.4;
        bb = bb * (1 - moss * 0.4) + 60 * moss * 0.4;
      }
      rr = rr * (1 - hazeMix) + haze[0] * hazeMix;
      gg = gg * (1 - hazeMix) + haze[1] * hazeMix;
      bb = bb * (1 - hazeMix) + haze[2] * hazeMix;
      img.data[i] = rr; img.data[i + 1] = gg; img.data[i + 2] = bb; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 烘焙形体明暗到顶点色（contrast 控制内部对比）。 */
function bakeForm(geo: THREE.BufferGeometry, y0: number, span: number, contrast = 0.35): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const top = clamp01(nor.getY(i));
    const west = clamp01(-nor.getX(i));
    let raw = 0.5 + 0.4 * top + 0.25 * west;
    raw *= 0.8 + 0.3 * clamp01((pos.getY(i) - y0) / span);
    const form = 1 - contrast * (1 - Math.max(0.15, Math.min(1.0, raw)));
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = form;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

/** 屋面/锥顶整体压暗 + 轻微受光变化。 */
function bakeFlat(geo: THREE.BufferGeometry, base: number): void {
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const cols = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i++) {
    const v = base * (0.85 + 0.3 * clamp01(nor.getY(i)));
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

/** 圆柱全景带：顶边噪声缓起伏 + UV（u 环向重复、v 自底向顶），供林冠贴图。 */
function panoramaBand(radius: number, crest: number, amp: number, seed: number, repeatU: number): THREE.BufferGeometry {
  const SEG = 160;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const crestAt = (a: number): number =>
    crest + amp * (0.5 * Math.sin(a * 3 + seed) + 0.3 * Math.sin(a * 7 + seed * 2.3) + 0.2 * Math.sin(a * 13 + seed * 4.1));
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    const yTop = crestAt(a);
    pos.push(x, yTop, z, x, -14, z);
    const u = (i / SEG) * repeatU;
    uv.push(u, 1, u, 0);
    if (i < SEG) {
      const t0 = i * 2, b0 = i * 2 + 1, t1 = i * 2 + 2, b1 = i * 2 + 3;
      idx.push(t0, b0, t1, b0, b1, t1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 低缓 foothill mound 环（3D 近层）。 */
function moundRing(radius: number, baseH: number, varH: number, peaks: number, seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < peaks; i++) {
    const a = (i / peaks) * Math.PI * 2 + (r() - 0.5) * 0.2;
    const h = baseH + (r() - 0.35) * varH;
    const pr = radius * (0.3 + r() * 0.2);
    const cone = new THREE.ConeGeometry(pr, h, 9, 3);
    const pos = cone.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const px = pos.getX(k), py = pos.getY(k), pz = pos.getZ(k);
      const n = Math.sin(px * 0.16 + pz * 0.13 + seed) * Math.cos(pz * 0.11 - px * 0.07);
      if (py < h / 2 - 0.1) {
        pos.setX(k, px * (1 + n * 0.2));
        pos.setZ(k, pz * (1 + n * 0.2));
      }
    }
    cone.computeVertexNormals();
    cone.translate(Math.sin(a) * radius, h / 2 - 6, Math.cos(a) * radius);
    parts.push(cone);
  }
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  return geo;
}

/** 高度场：rasterize 实际地形网格，供植被落点双线性采样。 */
function heightGrid(geo: THREE.BufferGeometry, extent: number, step: number): { g: Float32Array; n: number; extent: number; step: number } {
  const n = Math.ceil((extent * 2) / step) + 1;
  const g = new Float32Array(n * n).fill(-1e9);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i), az = pos.getZ(i), ay = pos.getY(i);
    const bx = pos.getX(i + 1), bz = pos.getZ(i + 1), by = pos.getY(i + 1);
    const cx = pos.getX(i + 2), cz = pos.getZ(i + 2), cy = pos.getY(i + 2);
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) + extent) / step));
    const i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx, cx) + extent) / step));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) + extent) / step));
    const j1 = Math.min(n - 1, Math.ceil((Math.max(az, bz, cz) + extent) / step));
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = -extent + i * step, pz = -extent + j * step;
      const w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
      const w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
      const w3 = 1 - w1 - w2;
      if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
      const y = w1 * ay + w2 * by + w3 * cy;
      const k = j * n + i;
      if (y > g[k]) g[k] = y;
    }
  }
  return { g, n, extent, step };
}
type HGrid = ReturnType<typeof heightGrid>;
function sampleH(hg: HGrid, x: number, z: number): number {
  const fx = (x + hg.extent) / hg.step, fz = (z + hg.extent) / hg.step;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= hg.n - 1 || j >= hg.n - 1) return -1e9;
  const a = hg.g[j * hg.n + i], b = hg.g[j * hg.n + i + 1], c = hg.g[(j + 1) * hg.n + i], d = hg.g[(j + 1) * hg.n + i + 1];
  if (a < -1e8 || b < -1e8 || c < -1e8 || d < -1e8) return -1e9;
  const tx = fx - i, tz = fz - j;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** 近层单株松（仅 foothill，角尺寸够大）：分层枝盘 + 尖顶 + 单株明暗。 */
function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.09, 0.17, 1.6, 5);
  trunk.translate(0, 0.8, 0);
  parts.push(trunk);
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const r = 1.55 * (1 - t * 0.82);
    const skirt = new THREE.ConeGeometry(r, 0.78, 7, 1, true);
    const sp = skirt.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 8; k < 16; k++) {
      const f = k % 2 ? 1.3 : 0.72;
      sp.setX(k, sp.getX(k) * f);
      sp.setZ(k, sp.getZ(k) * f);
    }
    skirt.translate(0, 1.35 + i * 0.92 + 0.39, 0);
    parts.push(skirt);
  }
  const spike = new THREE.ConeGeometry(0.22, 1.0, 5);
  spike.translate(0, 6.9, 0);
  parts.push(spike);
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  bakeForm(geo, 0, 7.4, 1.0);
  return geo;
}

function deadTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const grow = (x: number, y: number, z: number, len: number, ang: number, tilt: number, depth: number): void => {
    const g = new THREE.CylinderGeometry(0.03 * depth + 0.02, 0.05 * depth + 0.04, len, 5);
    const dx = Math.sin(ang) * Math.sin(tilt), dy = Math.cos(tilt), dz = Math.cos(ang) * Math.sin(tilt);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x + dx * len / 2, y + dy * len / 2, z + dz * len / 2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, ang, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    ));
    parts.push(g);
    if (depth <= 0) return;
    const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
    grow(ex, ey, ez, len * 0.68, ang + 0.5, tilt + 0.35, depth - 1);
    grow(ex, ey, ez, len * 0.6, ang - 0.6, tilt + 0.5, depth - 1);
  };
  grow(0, 0, 0, 2.6, 0.3, 0.15, 3);
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  return geo;
}

/** 圆塔：分段收分 + 檐口环 + 锥顶脊线/残顶 + 垛口；石进 stone[]、屋面进 roof[]。 */
function tower(stone: THREE.BufferGeometry[], roof: THREE.BufferGeometry[], x: number, z: number, y0: number, r: number, h: number, spire: number, opts: { merlons?: boolean; broken?: boolean } = {}): void {
  const seg = 10;
  for (let b = 0; b < 3; b++) {
    const bh = h / 3;
    const rr = r * (1.12 - b * 0.09);
    const body = new THREE.CylinderGeometry(rr * 0.97, rr * 1.04, bh, seg);
    body.translate(x, y0 + bh * (b + 0.5), z);
    stone.push(body);
    if (b < 2) {
      const ring = new THREE.CylinderGeometry(rr * 1.1, rr * 1.1, 0.35, seg);
      ring.translate(x, y0 + bh * (b + 1), z);
      stone.push(ring);
    }
  }
  const cap = new THREE.CylinderGeometry(r * 1.16, r * 1.16, 0.5, seg);
  cap.translate(x, y0 + h + 0.25, z);
  stone.push(cap);
  if (opts.merlons) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const m = new THREE.BoxGeometry(r * 0.4, 0.9, r * 0.28);
      m.rotateY(-a);
      m.translate(x + Math.cos(a) * r * 1.05, y0 + h + 0.85, z + Math.sin(a) * r * 1.05);
      stone.push(m);
    }
  }
  if (opts.broken) {
    const stub = new THREE.ConeGeometry(r * 1.15, spire * 0.4, seg, 1, true);
    stub.translate(x, y0 + h + 0.5 + spire * 0.2, z);
    roof.push(stub);
    const jag = new THREE.BoxGeometry(r * 0.7, spire * 0.25, r * 0.5);
    jag.rotateY(0.6);
    jag.translate(x + r * 0.3, y0 + h + 0.5 + spire * 0.35, z);
    roof.push(jag);
  } else {
    const cone = new THREE.ConeGeometry(r * 1.2, spire, seg);
    cone.translate(x, y0 + h + 0.5 + spire / 2, z);
    roof.push(cone);
    const cR = r * 1.2;
    const slopeLen = Math.hypot(cR, spire);
    const tilt = Math.atan2(cR, spire);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const rib = new THREE.BoxGeometry(0.08, slopeLen * 0.9, 0.08);
      rib.rotateZ(tilt);
      rib.rotateY(-a);
      rib.translate(x + Math.cos(a) * cR * 0.5, y0 + h + 0.5 + spire * 0.5, z + Math.sin(a) * cR * 0.5);
      roof.push(rib);
    }
  }
}

interface SkyUniforms { uHorizon: { value: THREE.Color }; uZenith: { value: THREE.Color }; uCloudDark: { value: THREE.Color }; uCover: { value: number } }

export function buildScenery(_m: Materials): Scenery {
  const group = new THREE.Group();
  group.name = 'scenery';
  const R = rng(1234);
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();

  const skyU = {
    uScHorizon: { value: new THREE.Color() }, uScZenith: { value: new THREE.Color() },
    uScCloudDark: { value: new THREE.Color() }, uScCloudLit: { value: new THREE.Color() },
    uScSunColor: { value: new THREE.Color() }, uScSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uScTime: { value: 0 }, uScCover: { value: 0.8 }, uScStars: { value: 0 }, uScGlow: { value: 0 }, uScRim: { value: 0 },
  };
  const attachSkyCap = (mat: THREE.MeshBasicMaterial): void => {
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, skyU);
      shader.vertexShader = 'varying vec3 vAwSkyPos;\n' + shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n vec4 awPos = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n  awPos = instanceMatrix * awPos;\n#endif\nvAwSkyPos = (modelMatrix * awPos).xyz;',
      );
      shader.fragmentShader = SKYCAP_GLSL + 'varying vec3 vAwSkyPos;\n' + shader.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        'gl_FragColor.rgb = min(gl_FragColor.rgb, awSkyCap(normalize(vAwSkyPos - cameraPosition)) * 0.93);\n#include <tonemapping_fragment>',
      );
    };
    mat.customProgramCacheKey = () => 'aw-skycap';
  };

  const atmo: { mat: THREE.MeshBasicMaterial; day: THREE.Color; night: THREE.Color; df: number; nf: number }[] = [];
  const basic = (day: number, night: number, df: number, nf: number, vc = true): THREE.MeshBasicMaterial => {
    const mat = new THREE.MeshBasicMaterial({ color: day, fog: false, vertexColors: vc });
    attachSkyCap(mat);
    atmo.push({ mat, day: new THREE.Color(day), night: new THREE.Color(night), df, nf });
    return mat;
  };

  // ——— 大地盘 ———
  const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 48), new THREE.MeshStandardMaterial({ color: 0x4a4a44, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.62;
  ground.receiveShadow = false;
  group.add(ground);

  // ——— 中景 foothill（3D，岩石+枯草固有色贴图）———
  const footGeo = moundRing(70, 14, 6, 34, 71);
  bakeForm(footGeo, -6, 24, 0.6);
  const footMat = basic(0xffffff, 0x2a3644, 0, 0);
  footMat.map = rockTexture(72, 0.2, true);
  footMat.map.repeat.set(5, 2);
  footMat.needsUpdate = true;
  footMat.vertexColors = true;
  const foot = new THREE.Mesh(footGeo, footMat);
  foot.castShadow = false; foot.receiveShadow = false;
  group.add(foot);
  const hg = heightGrid(footGeo, 110, 2);

  // ——— 四层林冠团块全景带（连续深色林体 + 锯齿冠廓 + 斑驳；越远雾越多）———
  const bandSpec: [number, number, number, number, number, number, number][] = [
    // [radius, crest, amp, seed, repeatU, hazeMix, noiseScale]
    [118, 32, 9, 11, 7, 0.17, 1.0],
    [225, 73, 15, 22, 8, 0.35, 1.4],
    [345, 128, 19, 33, 10, 0.57, 1.8],
    [485, 184, 22, 44, 12, 0.74, 2.2],
  ];
  for (const [rad, crest, amp, sd, rep, hm, ns] of bandSpec) {
    const g = panoramaBand(rad, crest, amp, sd, rep);
    const mat = new THREE.MeshBasicMaterial({ map: canopyTexture(sd * 7 + 3, ns, hm), alphaTest: 0.5, side: THREE.DoubleSide, fog: false, color: 0xffffff });
    attachSkyCap(mat);
    atmo.push({ mat, day: new THREE.Color(0xffffff), night: new THREE.Color(0x567095), df: 0, nf: 0.18 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
  }

  // ——— 城堡岩崖（岩石固有色贴图 + 块面明暗 + 坡脚碎石）———
  const cx = 118, czSim = -121, cy = 53;
  const cz = -czSim;
  const crag = new THREE.CylinderGeometry(19, 46, cy + 6, 20, 10);
  {
    const pos = crag.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const ang = Math.atan2(px, pz);
      const strata = Math.floor((py + cy / 2) / 7) * 0.9;
      const joint = Math.sin(ang * 6 + 1.7) * 0.17 + Math.sin(ang * 11 + py * 0.07) * 0.09;
      const n = Math.sin(px * 0.3 + pz * 0.22) * Math.cos(pz * 0.26 - px * 0.15);
      if (py < (cy + 6) / 2 - 0.1) {
        const s = 1 + n * 0.23 + joint - strata * 0.012;
        pos.setX(i, px * s); pos.setZ(i, pz * s); pos.setY(i, py + n * 1.4);
      }
    }
    crag.computeVertexNormals();
  }
  const cragParts = [crag.toNonIndexed()];
  crag.dispose();
  const screeCone = new THREE.ConeGeometry(46, 12, 12, 2);
  screeCone.translate(0, -(cy + 6) / 2 + 6, 0);
  cragParts.push(screeCone.toNonIndexed());
  screeCone.dispose();
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2, rr = 34 + R() * 16;
    const b = new THREE.DodecahedronGeometry(1.5 + R() * 2.5, 0);
    b.translate(Math.sin(a) * rr, -(cy + 6) / 2 + 7 + R() * 3, Math.cos(a) * rr);
    cragParts.push(b.toNonIndexed());
    b.dispose();
  }
  const cragGeo = mergeGeometries(cragParts, false)!;
  for (const g of cragParts) g.dispose();
  bakeForm(cragGeo, -6, cy + 10, 0.7);
  const cragY = cy / 2 - 3;
  const cragSupport = heightGrid(cragGeo, 55, 1.5);
  const cliffTexture = rockTexture(73, 0.12, true);
  const cragMat = basic(0xadb8c0, 0x576b83, 0.05, 0.2);
  cragMat.map = cliffTexture;
  cliffTexture.repeat.set(3, 1.2);
  cragMat.needsUpdate = true;
  const cragMesh = new THREE.Mesh(cragGeo, cragMat);
  cragMesh.position.set(cx, cragY, cz);
  cragMesh.castShadow = false; cragMesh.receiveShadow = false;
  group.add(cragMesh);

  // ——— 山顶城堡（石砌体冷灰 + 深色屋面双网格）———
  const cp: THREE.BufferGeometry[] = [];
  const cr: THREE.BufferGeometry[] = [];
  const kw = 13, kh = 26;
  for (let b = 0; b < 3; b++) {
    const bh = kh / 3;
    const box = new THREE.BoxGeometry(kw - b * 0.8, bh, kw - b * 0.8);
    box.translate(cx, cy + bh * (b + 0.5), cz);
    cp.push(box);
    const band = new THREE.BoxGeometry(kw - b * 0.8 + 0.5, 0.4, kw - b * 0.8 + 0.5);
    band.translate(cx, cy + bh * (b + 1), cz);
    cp.push(band);
  }
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const pil = new THREE.BoxGeometry(dx ? 0.7 : kw * 0.9, kh, dz ? 0.7 : kw * 0.9);
    pil.translate(cx + dx * (kw / 2), cy + kh / 2, cz + dz * (kw / 2));
    cp.push(pil);
  }
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6 - 0.5;
      const m = new THREE.BoxGeometry(side % 2 ? 0.9 : 1.2, 1.3, side % 2 ? 1.2 : 0.9);
      const ox = side === 0 ? t * kw : side === 1 ? kw / 2 : side === 2 ? t * kw : -kw / 2;
      const oz = side === 0 ? -kw / 2 : side === 1 ? t * kw : side === 2 ? kw / 2 : t * kw;
      m.translate(cx + ox, cy + kh + 0.65, cz + oz);
      cp.push(m);
    }
  }
  const roof = new THREE.ConeGeometry(kw * 0.78, 12, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(cx, cy + kh + 6, cz);
  cr.push(roof);
  const ridge = new THREE.BoxGeometry(0.5, 0.5, kw * 0.5);
  ridge.translate(cx, cy + kh + 9, cz);
  cr.push(ridge);
  for (const [dx, dz] of [[-3, -2], [3, 2]]) {
    const ch = new THREE.BoxGeometry(1.2, 5, 1.2);
    ch.translate(cx + dx, cy + kh + 8, cz + dz);
    cp.push(ch);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    tower(cp, cr, cx + dx * kw / 2, cz + dz * kw / 2, cy + kh * 0.5, 2.0, kh * 0.62, 7, { broken: dx === 1 && dz === -1 });
  }
  const ring: [number, number, number, number, boolean][] = [
    [-16, -10, 3.0, 20, false], [-17, 8, 2.6, 16, true], [14, -12, 3.2, 23, false],
    [16, 7, 2.7, 17, false], [-3, -17, 2.4, 15, true], [6, 15, 2.5, 18, false], [-10, 14, 2.2, 14, false],
  ];
  for (const [dx, dz, r, h, broken] of ring) tower(cp, cr, cx + dx, cz + dz, cy - 3, r, h, r * 2.3, { merlons: true, broken });
  const wallPairs: [number, number, number, number][] = [
    [-15, -9, -3, -16], [-3, -16, 13, -11], [13, -11, 15, 6], [15, 6, 5, 14],
    [5, 14, -9, 13], [-9, 13, -16, 7], [-16, 7, -15, -9],
  ];
  let wi = 0;
  for (const [ax, az, bx, bz] of wallPairs) {
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bx - ax, bz - az);
    const collapsed = wi === 2;
    const wh = collapsed ? 3.5 : 7;
    const wall = new THREE.BoxGeometry(1.7, wh, len);
    wall.rotateY(ang);
    wall.translate(cx + (ax + bx) / 2, cy - 1 + wh / 2, cz + (az + bz) / 2);
    cp.push(wall);
    const walk = new THREE.BoxGeometry(2.6, 0.4, len);
    walk.rotateY(ang);
    walk.translate(cx + (ax + bx) / 2, cy - 1 + wh - 0.6, cz + (az + bz) / 2);
    cp.push(walk);
    const n = Math.floor(len / 2.2);
    for (let i = 0; i < n; i++) {
      if (collapsed && i % 2 === 0) continue;
      const t = (i + 0.5) / n;
      const merlon = new THREE.BoxGeometry(1.7, 1.1, 1.0);
      merlon.rotateY(ang);
      merlon.translate(cx + ax + (bx - ax) * t, cy - 1 + wh + 0.55, cz + az + (bz - az) * t);
      cp.push(merlon);
    }
    if (collapsed) {
      for (let i = 0; i < 8; i++) {
        const t = R();
        const b = new THREE.DodecahedronGeometry(0.8 + R() * 1.2, 0);
        b.translate(cx + ax + (bx - ax) * t, cy - 2 + R() * 2, cz + az + (bz - az) * t);
        cp.push(b);
      }
    }
    wi++;
  }
  tower(cp, cr, cx - 4, cz - 16, cy - 3, 2.6, 18, 7, { merlons: true });
  tower(cp, cr, cx + 4, cz - 16, cy - 3, 2.6, 18, 7, { merlons: true });
  const gateWall = new THREE.BoxGeometry(10, 14, 3);
  gateWall.translate(cx, cy + 4, cz - 16);
  cp.push(gateWall);
  const castleGeo = mergeGeometries(cp.map((g) => g.toNonIndexed()), false)!;
  for (const g of cp) g.dispose();
  bakeForm(castleGeo, cy - 6, 50, 1.4);
  const masonry = rockTexture(123, 0.12);
  const castleMat = basic(0xa2afbd, 0x526584, 0.06, 0.18);
  castleMat.map = masonry;
  const castle = new THREE.Mesh(castleGeo, castleMat);
  castle.castShadow = false; castle.receiveShadow = false;
  group.add(castle);
  for (const g of cr) bakeFlat(g, 0.13);

  // 门洞暗色 + 吊闸（合批）
  const archDark = new THREE.MeshBasicMaterial({ color: 0x0a0d12, fog: false });
  const archParts: THREE.BufferGeometry[] = [];
  const a1 = new THREE.BoxGeometry(3, 5.5, 3.6); a1.translate(cx, cy + 0.5, cz - 16); archParts.push(a1);
  const gx = 80, gzSim = 45, gz = -gzSim;
  const gateBase = sampleH(hg, gx, gz);
  const gy = gateBase < -1e8 ? -0.65 : gateBase - 1;
  const a2 = new THREE.BoxGeometry(2.8, 5, 3.4); a2.translate(gx, gy + 2.5, gz); archParts.push(a2);
  const a3 = new THREE.BoxGeometry(2.6, 3.6, 0.12); a3.translate(gx, gy + 3, gz + 1.75); archParts.push(a3);
  const archGeo = mergeGeometries(archParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of archParts) g.dispose();
  group.add(new THREE.Mesh(archGeo, archDark));
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb25e, fog: false, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const glowParts: THREE.BufferGeometry[] = [];
  const g1 = new THREE.PlaneGeometry(2.6, 4.4); g1.translate(cx, cy + 0.2, cz - 17.9); glowParts.push(g1);
  const g2 = new THREE.PlaneGeometry(2.4, 4); g2.translate(gx, gy + 2.2, gz + 1.8); glowParts.push(g2);
  const glowGeo = mergeGeometries(glowParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of glowParts) g.dispose();
  group.add(new THREE.Mesh(glowGeo, glowMat));

  // 城堡暖窗
  const winMat = new THREE.MeshBasicMaterial({ color: 0x0d1118, fog: false, side: THREE.DoubleSide });
  const winSpots: [number, number, number, number, number][] = [
    [cx - 6.6, cy + 12, cz - 3, -HALF_PI, 0.9],
    [cx - 6.6, cy + 20, cz + 2, -HALF_PI, 0.55],
    [cx - 2, cy + 16, cz - 6.6, 0, 0.75],
    [cx + 3, cy + 22, cz - 6.6, 0, 0.4],
    [cx + 14, cy + 10, cz - 12, -1.2, 0.8],
    [cx - 17, cy + 8, cz + 8, -1.4, 0.5],
    [cx - 4, cy + 12, cz - 17.6, 0, 0.65],
    [gx - 3.6, gy + 12, gz + 2.6, 0, 0.7],
    [gx + 3.6, gy + 14, gz + 2.6, 0, 0.5],
  ];
  const winInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 1.5), winMat, winSpots.length);
  winSpots.forEach(([x, y, z, rot, b], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    winInst.setMatrixAt(i, dummy.matrix);
    tmpC.setRGB(b, b * 0.92, b * 0.8);
    winInst.setColorAt(i, tmpC);
  });
  winInst.instanceMatrix.needsUpdate = true;
  if (winInst.instanceColor) winInst.instanceColor.needsUpdate = true;
  group.add(winInst);

  // ——— 第二城门塔（冷灰石材）———
  const gp: THREE.BufferGeometry[] = [];
  const gr: THREE.BufferGeometry[] = [];
  tower(gp, gr, gx - 3.6, gz, gy, 2.5, 17, 7, { merlons: true });
  tower(gp, gr, gx + 3.6, gz, gy, 2.5, 17, 7, { merlons: true, broken: true });
  const gwall = new THREE.BoxGeometry(9.5, 12, 3);
  gwall.translate(gx, gy + 6, gz);
  gp.push(gwall);
  const groof = new THREE.ConeGeometry(5.6, 4.5, 4);
  groof.rotateY(Math.PI / 4);
  groof.translate(gx, gy + 14.2, gz);
  gr.push(groof);
  const gateGeo = mergeGeometries(gp.map((g) => g.toNonIndexed()), false)!;
  for (const g of gp) g.dispose();
  bakeForm(gateGeo, gy, 26, 0.9);
  const gateMat = basic(0x8a9cac, 0x4e5d75, 0.05, 0.18);
  gateMat.map = masonry;
  const gate = new THREE.Mesh(gateGeo, gateMat);
  gate.castShadow = false; gate.receiveShadow = false;
  group.add(gate);
  for (const g of gr) bakeFlat(g, 0.13);

  // ——— 中景：下城郭 / 坍塌墙 / 瞭望塔（冷灰）———
  const midParts: THREE.BufferGeometry[] = [];
  const mr: THREE.BufferGeometry[] = [];
  const townSpots: [number, number][] = [[62, -26], [70, -10], [58, 8], [76, -38], [52, 26], [44, 48], [30, 62], [-24, 58], [-36, 44]];
  for (const [tx, tz] of townSpots) {
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const hx = tx + (R() - 0.5) * 12, hz = tz + (R() - 0.5) * 12;
      const sy = sampleH(hg, hx, -hz);
      if (sy < -1e8) continue;
      const hy = sy - 0.45;
      const hw = 2.0 + R() * 1.6, hh = 3 + R() * 1.6;
      const body = new THREE.BoxGeometry(hw, hh, hw * 1.4);
      body.translate(hx, hy + hh / 2, -hz);
      midParts.push(body);
      const rf = new THREE.ConeGeometry(hw * 0.95, 2.6, 4);
      rf.rotateY(Math.PI / 4);
      rf.translate(hx, hy + hh + 1.3, -hz);
      mr.push(rf);
    }
  }
  for (let i = 0; i < 7; i++) {
    const h = i === 3 ? 1.5 : 4 + (i % 2);
    const cwY = sampleH(hg, 46 + i * 3, 40);
    if (cwY < -1e8) continue;
    const base = cwY - 0.5;
    const seg = new THREE.BoxGeometry(3, h, 1.6);
    seg.translate(46 + i * 3, base + h / 2, -40);
    midParts.push(seg);
    if (i === 3) {
      for (let k = 0; k < 5; k++) {
        const b = new THREE.DodecahedronGeometry(0.7 + R(), 0);
        b.translate(46 + i * 3 + (R() - 0.5) * 3, base + R(), -40 + (R() - 0.5) * 3);
        midParts.push(b);
      }
    }
  }
  const wtY = sampleH(hg, -28, -62);
  if (wtY >= -1e8) tower(midParts, mr, -28, -62, wtY - 0.5, 2.2, 22, 6, { merlons: true });
  const midGeo = mergeGeometries(midParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of midParts) g.dispose();
  bakeForm(midGeo, 4, 30, 0.7);
  const midMat = basic(0x8f9ba4, 0x43566d, 0.06, 0.18);
  midMat.map = masonry;
  const mid = new THREE.Mesh(midGeo, midMat);
  mid.castShadow = false; mid.receiveShadow = false;
  group.add(mid);
  for (const g of mr) bakeFlat(g, 0.13);

  // 屋面统一合批（深色）
  const roofAll = mergeGeometries([...cr, ...gr, ...mr].map((g) => g.toNonIndexed()), false)!;
  for (const g of [...cr, ...gr, ...mr]) g.dispose();
  const roofMat = basic(0x8794a6, 0x54627c, 0.065, 0.18);
  const roofMesh = new THREE.Mesh(roofAll, roofMat);
  roofMesh.castShadow = false; roofMesh.receiveShadow = false;
  group.add(roofMesh);

  // 裸岩 outcrop（冷灰）
  const outGeo = new THREE.DodecahedronGeometry(3, 0);
  outGeo.scale(1, 0.7, 1);
  const outMat = basic(0x6a7076, 0x151d2a, 0.25, 0.3, false);
  const outInst = new THREE.InstancedMesh(outGeo, outMat, 24);
  for (let i = 0; i < 24; i++) {
    const a = R() * Math.PI * 2, rr = 45 + R() * 55;
    const ox = Math.sin(a) * rr, oz = Math.cos(a) * rr;
    const sy = sampleH(hg, ox, -oz);
    dummy.position.set(ox, sy < -1e8 ? -60 : sy - 0.5, -oz);
    dummy.rotation.set(R() * 0.4, R() * 3, R() * 0.4);
    const s = 0.7 + R() * 1.4;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    outInst.setMatrixAt(i, dummy.matrix);
  }
  outInst.instanceMatrix.needsUpdate = true;
  outInst.castShadow = false; outInst.receiveShadow = false;
  group.add(outInst);

  // ——— 仅最近 foothill 保留少量 3D 单株松 + 枯树（采样真实地形）———
  const pineSpots: { x: number; y: number; z: number; h: number }[] = [];
  for (let i = 0; i < 120; i++) {
    const a = R() * Math.PI * 2, rr = 46 + R() * 30;
    const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
    if (x > -13 && x < 32 && z > -11 && z < 32) continue;
    const sy = sampleH(hg, x, -z);
    if (sy < -1e8) continue;
    pineSpots.push({ x, y: sy - 0.4, z, h: 5 + R() * 4 });
  }
  // Colonies on the actual crag, concentrated along shelves, never against blank sky.
  for (let i = 0; i < 120; i++) {
    const a = R() * Math.PI * 2, rad = 20 + R() * 26;
    const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
    const sy = sampleH(cragSupport, x, z);
    if (sy < -1e8 || sy > cy * 0.3 || (Math.sin(a * 5) < -0.5 && R() < 0.8)) continue;
    pineSpots.push({ x: cx + x, y: cragY + sy - 0.55, z: -cz - z, h: 3.2 + R() * 3.9 });
  }
  const pineMat = basic(0x3f5757, 0x526981, 0.07, 0.17);
  const pineInst = new THREE.InstancedMesh(pineGeometry(), pineMat, pineSpots.length);
  pineSpots.forEach((p, i) => {
    const s = p.h / 7.4;
    dummy.position.set(p.x, p.y, -p.z);
    dummy.rotation.set((R() - 0.5) * 0.12, R() * Math.PI * 2, (R() - 0.5) * 0.12);
    dummy.scale.set(s * (0.85 + R() * 0.3), s, s * (0.85 + R() * 0.3));
    dummy.updateMatrix();
    pineInst.setMatrixAt(i, dummy.matrix);
    tmpC.setScalar(0.7 + R() * 0.3);
    pineInst.setColorAt(i, tmpC);
  });
  pineInst.instanceMatrix.needsUpdate = true;
  if (pineInst.instanceColor) pineInst.instanceColor.needsUpdate = true;
  pineInst.castShadow = false; pineInst.receiveShadow = false;
  group.add(pineInst);

  const deadMat = basic(0x3a322c, 0x1a222c, 0.15, 0.3, false);
  const deadInst = new THREE.InstancedMesh(deadTreeGeometry(), deadMat, 12);
  for (let i = 0; i < 12; i++) {
    const a = R() * Math.PI * 2, rr = 46 + R() * 34;
    const dx = Math.sin(a) * rr, dz = Math.cos(a) * rr;
    const sy = sampleH(hg, dx, -dz);
    const s = 1.2 + R() * 1.4;
    dummy.position.set(dx, sy < -1e8 ? -60 : sy - 0.3, -dz);
    dummy.rotation.set(0, R() * 3, (R() - 0.5) * 0.15);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    deadInst.setMatrixAt(i, dummy.matrix);
  }
  deadInst.instanceMatrix.needsUpdate = true;
  deadInst.castShadow = false; deadInst.receiveShadow = false;
  group.add(deadInst);

  // ——— 每帧大气驱动（锚定天空地平线；逐片段上限保护）———
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  let skyUniforms: SkyUniforms | null = null;
  ground.onBeforeRender = (_r, scene, _camera) => {
    const fog = scene.fog as THREE.Fog | null;
    if (!fog) return;
    if (!skyUniforms) {
      scene.traverse((o) => {
        const mm = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (!skyUniforms && mm && mm.uniforms && mm.uniforms.uHorizon && mm.uniforms.uZenith && mm.uniforms.uCloudDark) skyUniforms = mm.uniforms as unknown as SkyUniforms;
      });
    }
    const night: number = scene.userData.night ?? 0;
    const haze = skyUniforms ? skyUniforms.uHorizon.value : fog.color;
    for (const a of atmo) {
      tmpA.copy(a.day).lerp(a.night, night);
      tmpB.copy(haze).multiplyScalar(1 + night * 0.6);
      const amount = Math.min(0.95, a.df) * (1 - night) + a.nf * night;
      a.mat.color.copy(tmpA).lerp(tmpB, Math.min(0.95, amount));
    }
    if (skyUniforms) {
      skyU.uScHorizon.value.copy(skyUniforms.uHorizon.value);
      skyU.uScZenith.value.copy(skyUniforms.uZenith.value);
      skyU.uScCloudDark.value.copy(skyUniforms.uCloudDark.value);
      const su = skyUniforms as unknown as Record<string, { value: unknown }>;
      if (su.uCloudLit) skyU.uScCloudLit.value.copy(su.uCloudLit.value as THREE.Color);
      if (su.uSunColor) skyU.uScSunColor.value.copy(su.uSunColor.value as THREE.Color);
      if (su.uSunDir) skyU.uScSunDir.value.copy(su.uSunDir.value as THREE.Vector3);
      if (su.uTime) skyU.uScTime.value = su.uTime.value as number;
      if (su.uCover) skyU.uScCover.value = su.uCover.value as number;
      if (su.uStars) skyU.uScStars.value = su.uStars.value as number;
      if (su.uGlow) skyU.uScGlow.value = su.uGlow.value as number;
      if (su.uRim) skyU.uScRim.value = su.uRim.value as number;
    }
    winMat.color.setHex(night > 0.5 ? 0xffb25e : 0x0d1118);
    glowMat.opacity = night * 0.6;
    archDark.color.setHex(0x0a0d12).lerp(tmpB, night * 0.2);
  };

  return { group };
}