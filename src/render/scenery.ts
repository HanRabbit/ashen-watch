// 远景（art pass 3 · 第二轮）：360° 多层山脊 + 山崖城堡 + 中景下城郭/坍塌墙/瞭望塔/第二城门 +
// 分层松林 + 层间雾带。全部 Distant/Background 大气简化：无贴图、烘焙顶点色、合批 + InstancedMesh。
// 抬升地形让墙头以上的天空带被山脊与林冠填到约 2/3（相机 1.7 m、7 m 墙在 ~17 m 外挡住 ~19° 仰角以下）。
// 昼夜读 scene.userData.night；每层手动雾混合（basic + 顶点色/实例色），越远越淡、对比 ≤ 近景 40%（圣经 6）。
// 大块风化（5.2）：岩层剥落、坡脚碎石、城墙坍塌缺口 + 补砌、塔顶残缺；中景苔斑雨渍用顶点色暗示。
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

/** 烘焙形体明暗 + 高度渐变到顶点色。 */
function bakeForm(geo: THREE.BufferGeometry, y0: number, span: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const top = clamp01(nor.getY(i));
    const west = clamp01(-nor.getX(i));
    let form = 0.5 + 0.34 * top + 0.16 * west;
    form *= 0.78 + 0.3 * clamp01((pos.getY(i) - y0) / span);
    form = Math.max(0.35, Math.min(1.08, form));
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = form;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

/** 中景「苔斑 / 雨渍」顶点色暗示（局部，不满铺；色留板内）。 */
function weatherTint(geo: THREE.BufferGeometry, seed: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  const r = rng(seed);
  const patches = Array.from({ length: 14 }, () => ({ x: (r() - 0.5) * 220, z: (r() - 0.5) * 220, y: r() * 30, rad: 4 + r() * 9, kind: r() < 0.5 ? 0 : 1 }));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let moss = 0, streak = 0;
    for (const p of patches) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (p.kind === 0 && y < p.y + 6 && d < p.rad) moss = Math.max(moss, 1 - d / p.rad);
      if (p.kind === 1 && Math.abs(x - p.x) < 1.2 && y < p.y && y > p.y - 14) streak = Math.max(streak, 1 - Math.abs(x - p.x) / 1.2);
    }
    let rr = col.getX(i), gg = col.getY(i), bb = col.getZ(i);
    rr = rr * (1 - moss * 0.3) + 0.29 * moss * 0.3;
    gg = gg * (1 - moss * 0.3) + 0.35 * moss * 0.3;
    bb = bb * (1 - moss * 0.3) + 0.24 * moss * 0.3;
    const s = streak * 0.25;
    col.setXYZ(i, rr * (1 - s), gg * (1 - s), bb * (1 - s));
  }
  col.needsUpdate = true;
}

/** 分层枝条松树：可见树干 + 6 层外伸枝盘（层间留空）+ 尖顶。 */
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
    for (let k = 8; k < 16; k++) { // 底环：长短交替 => 枝条锯齿剪影
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
  return geo;
}

function canopyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(1.5 * (1 - i * 0.3), 1.6, 6, 1, true);
    c.translate(0, 1.4 + i * 1.3, 0);
    parts.push(c);
  }
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
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

/** 不规则山脊环：重叠扰动峰锥 + 缺口 + 副峰。 */
function ridgeGeometry(radius: number, baseH: number, varH: number, peaks: number, seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < peaks; i++) {
    const a = (i / peaks) * Math.PI * 2 + (r() - 0.5) * 0.2;
    const notch = r() < 0.18 ? 0.45 : 1;
    const h = (baseH + (r() - 0.35) * varH) * notch;
    const pr = radius * (0.2 + r() * 0.16);
    const cone = new THREE.ConeGeometry(pr, h, 9, 4);
    const pos = cone.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const px = pos.getX(k), py = pos.getY(k), pz = pos.getZ(k);
      const n = Math.sin(px * 0.16 + pz * 0.13 + seed) * Math.cos(pz * 0.11 - px * 0.07);
      if (py < h / 2 - 0.1) {
        pos.setX(k, px * (1 + n * 0.24));
        pos.setZ(k, pz * (1 + n * 0.24));
        pos.setY(k, py + n * h * 0.05);
      }
    }
    cone.computeVertexNormals();
    cone.translate(Math.sin(a) * radius, h / 2 - 6, Math.cos(a) * radius);
    parts.push(cone);
    if (r() < 0.5) {
      const sub = new THREE.ConeGeometry(pr * 0.5, h * 0.6, 7, 2);
      sub.translate(Math.sin(a) * radius + pr * 0.7, h * 0.3 - 6, Math.cos(a) * radius + pr * 0.4);
      parts.push(sub);
    }
  }
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  return geo;
}

/** 圆塔：分段塔身 + 檐口环 + 锥顶（带脊线）/ 残缺顶 + 可选垛口。 */
function tower(parts: THREE.BufferGeometry[], x: number, z: number, y0: number, r: number, h: number, spire: number, opts: { merlons?: boolean; broken?: boolean } = {}): void {
  const seg = 10;
  for (let b = 0; b < 3; b++) {
    const bh = h / 3;
    const rr = r * (1.06 - b * 0.03);
    const body = new THREE.CylinderGeometry(rr, rr * 1.04, bh, seg);
    body.translate(x, y0 + bh * (b + 0.5), z);
    parts.push(body);
    if (b < 2) {
      const ring = new THREE.CylinderGeometry(rr * 1.1, rr * 1.1, 0.35, seg);
      ring.translate(x, y0 + bh * (b + 1), z);
      parts.push(ring);
    }
  }
  const cap = new THREE.CylinderGeometry(r * 1.16, r * 1.16, 0.5, seg);
  cap.translate(x, y0 + h + 0.25, z);
  parts.push(cap);
  if (opts.merlons) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const m = new THREE.BoxGeometry(r * 0.4, 0.9, r * 0.28);
      m.rotateY(-a);
      m.translate(x + Math.cos(a) * r * 1.05, y0 + h + 0.85, z + Math.sin(a) * r * 1.05);
      parts.push(m);
    }
  }
  if (opts.broken) {
    const stub = new THREE.ConeGeometry(r * 1.15, spire * 0.4, seg, 1, true);
    stub.translate(x, y0 + h + 0.5 + spire * 0.2, z);
    parts.push(stub);
    const jag = new THREE.BoxGeometry(r * 0.7, spire * 0.25, r * 0.5);
    jag.rotateY(0.6);
    jag.translate(x + r * 0.3, y0 + h + 0.5 + spire * 0.35, z);
    parts.push(jag);
  } else {
    const cone = new THREE.ConeGeometry(r * 1.2, spire, seg);
    cone.translate(x, y0 + h + 0.5 + spire / 2, z);
    parts.push(cone);
    const cR = r * 1.2;
    const slopeLen = Math.hypot(cR, spire);
    const tilt = Math.atan2(cR, spire);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const rib = new THREE.BoxGeometry(0.08, slopeLen * 0.9, 0.08);
      rib.rotateZ(tilt);
      rib.rotateY(-a);
      rib.translate(x + Math.cos(a) * cR * 0.5, y0 + h + 0.5 + spire * 0.5, z + Math.sin(a) * cR * 0.5);
      parts.push(rib);
    }
  }
}

export function buildScenery(_m: Materials): Scenery {
  const group = new THREE.Group();
  group.name = 'scenery';
  const R = rng(1234);
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();

  // 大气层注册表：手动雾混合，越远越淡
  const atmo: { mat: THREE.MeshBasicMaterial; day: THREE.Color; night: THREE.Color; df: number; nf: number }[] = [];
  const basic = (day: number, night: number, df: number, nf: number, vc = true): THREE.MeshBasicMaterial => {
    const mat = new THREE.MeshBasicMaterial({ color: day, fog: false, vertexColors: vc });
    atmo.push({ mat, day: new THREE.Color(day), night: new THREE.Color(night), df, nf });
    return mat;
  };

  // ——— 大地盘 ———
  const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 48), new THREE.MeshStandardMaterial({ color: 0x4a4a44, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.62;
  ground.receiveShadow = false;
  group.add(ground);

  // ——— 中景 foothill 环（抬升承载中景元素越过墙头）———
  const footGeo = ridgeGeometry(70, 20, 14, 30, 71);
  bakeForm(footGeo, -6, 34);
  weatherTint(footGeo, 72);
  const foot = new THREE.Mesh(footGeo, basic(0x7d8791, 0x161e2b, 0.45, 0.4));
  foot.castShadow = false; foot.receiveShadow = false;
  group.add(foot);

  // ——— 四层 360° 山脊 ———
  const ridgeSpec: [number, number, number, number, number, number, number, number][] = [
    [120, 66, 26, 40, 11, 0x8a949e, 0x182231, 0.5],
    [220, 112, 34, 36, 22, 0x939da7, 0x1a2433, 0.62],
    [350, 178, 44, 32, 33, 0x9ca6b0, 0x1c2635, 0.72],
    [500, 252, 54, 30, 44, 0xa5afb9, 0x1e2837, 0.8],
  ];
  for (const [rad, bh, vh, pk, sd, day, night, df] of ridgeSpec) {
    const g = ridgeGeometry(rad, bh, vh, pk, sd);
    bakeForm(g, -6, bh + vh);
    const mesh = new THREE.Mesh(g, basic(day, night, df, 0.4 + df * 0.3));
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
  }

  // ——— 城堡岩崖（东偏南 = 画面右上）+ 坡脚碎石（合批同材质）———
  const cx = 120, czSim = -55, cy = 60;
  const cz = -czSim;
  const crag = new THREE.CylinderGeometry(16, 40, cy + 6, 12, 7);
  {
    const pos = crag.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const ang = Math.atan2(px, pz);
      const strata = Math.floor((py + cy / 2) / 7) * 0.9;
      const joint = Math.sin(ang * 6) > 0.72 ? -2.2 : 0;
      const n = Math.sin(px * 0.3 + pz * 0.22) * Math.cos(pz * 0.26 - px * 0.15);
      if (py < (cy + 6) / 2 - 0.1) {
        const s = 1 + n * 0.16 + joint * 0.02 - strata * 0.012;
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
  bakeForm(cragGeo, -6, cy + 10);
  weatherTint(cragGeo, 73);
  const cragMat = basic(0x767c82, 0x151d2a, 0.48, 0.42);
  const cragMesh = new THREE.Mesh(cragGeo, cragMat);
  cragMesh.position.set(cx, (cy + 6) / 2 - 6, cz);
  cragMesh.castShadow = false; cragMesh.receiveShadow = false;
  group.add(cragMesh);

  // ——— 山顶城堡 ———
  const cp: THREE.BufferGeometry[] = [];
  const kw = 13, kh = 26;
  for (let b = 0; b < 3; b++) {
    const bh = kh / 3;
    const box = new THREE.BoxGeometry(kw - b * 0.6, bh, kw - b * 0.6);
    box.translate(cx, cy + bh * (b + 0.5), cz);
    cp.push(box);
    const band = new THREE.BoxGeometry(kw - b * 0.6 + 0.5, 0.4, kw - b * 0.6 + 0.5);
    band.translate(cx, cy + bh * (b + 1), cz);
    cp.push(band);
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
  cp.push(roof);
  const ridge = new THREE.BoxGeometry(0.5, 0.5, kw * 0.5);
  ridge.translate(cx, cy + kh + 9, cz);
  cp.push(ridge);
  for (const [dx, dz] of [[-3, -2], [3, 2]]) {
    const ch = new THREE.BoxGeometry(1.2, 5, 1.2);
    ch.translate(cx + dx, cy + kh + 8, cz + dz);
    cp.push(ch);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    tower(cp, cx + dx * kw / 2, cz + dz * kw / 2, cy + kh * 0.5, 2.0, kh * 0.62, 7, { broken: dx === 1 && dz === -1 });
  }
  const ring: [number, number, number, number, boolean][] = [
    [-16, -10, 3.0, 20, false], [-17, 8, 2.6, 16, true], [14, -12, 3.2, 23, false],
    [16, 7, 2.7, 17, false], [-3, -17, 2.4, 15, true], [6, 15, 2.5, 18, false], [-10, 14, 2.2, 14, false],
  ];
  for (const [dx, dz, r, h, broken] of ring) tower(cp, cx + dx, cz + dz, cy - 3, r, h, r * 2.3, { merlons: true, broken });
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
  tower(cp, cx - 4, cz - 16, cy - 3, 2.6, 18, 7, { merlons: true });
  tower(cp, cx + 4, cz - 16, cy - 3, 2.6, 18, 7, { merlons: true });
  const gateWall = new THREE.BoxGeometry(10, 14, 3);
  gateWall.translate(cx, cy + 4, cz - 16);
  cp.push(gateWall);
  const castleGeo = mergeGeometries(cp.map((g) => g.toNonIndexed()), false)!;
  for (const g of cp) g.dispose();
  bakeForm(castleGeo, cy - 6, 50);
  weatherTint(castleGeo, 74);
  const castle = new THREE.Mesh(castleGeo, basic(0x7a848e, 0x1a2434, 0.5, 0.45));
  castle.castShadow = false; castle.receiveShadow = false;
  group.add(castle);

  // 门洞暗色 + 吊闸（两处城门合批同材质）
  const archDark = new THREE.MeshBasicMaterial({ color: 0x0a0d12, fog: false });
  const archParts: THREE.BufferGeometry[] = [];
  const a1 = new THREE.BoxGeometry(3, 5.5, 3.6); a1.translate(cx, cy + 0.5, cz - 16); archParts.push(a1);
  const gx = 40, gzSim = 60, gy = 16, gz = -gzSim;
  const a2 = new THREE.BoxGeometry(2.8, 5, 3.4); a2.translate(gx, gy + 2.5, gz); archParts.push(a2);
  const a3 = new THREE.BoxGeometry(2.6, 3.6, 0.12); a3.translate(gx, gy + 3, gz + 1.75); archParts.push(a3);
  const archGeo = mergeGeometries(archParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of archParts) g.dispose();
  group.add(new THREE.Mesh(archGeo, archDark));
  // 夜暖光（两处门洞合批同材质）
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb25e, fog: false, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const glowParts: THREE.BufferGeometry[] = [];
  const g1 = new THREE.PlaneGeometry(2.6, 4.4); g1.translate(cx, cy + 0.2, cz - 17.9); glowParts.push(g1);
  const g2 = new THREE.PlaneGeometry(2.4, 4); g2.translate(gx, gy + 2.2, gz + 1.8); glowParts.push(g2);
  const glowGeo = mergeGeometries(glowParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of glowParts) g.dispose();
  group.add(new THREE.Mesh(glowGeo, glowMat));

  // 城堡暖窗（不整齐、亮度不一；白天暗洞）
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

  // ——— 第二城门塔（画面左侧远景）———
  const gp: THREE.BufferGeometry[] = [];
  tower(gp, gx - 3.6, gz, gy, 2.5, 17, 7, { merlons: true });
  tower(gp, gx + 3.6, gz, gy, 2.5, 17, 7, { merlons: true, broken: true });
  const gwall = new THREE.BoxGeometry(9.5, 12, 3);
  gwall.translate(gx, gy + 6, gz);
  gp.push(gwall);
  const groof = new THREE.ConeGeometry(5.6, 4.5, 4);
  groof.rotateY(Math.PI / 4);
  groof.translate(gx, gy + 14.2, gz);
  gp.push(groof);
  const gateGeo = mergeGeometries(gp.map((g) => g.toNonIndexed()), false)!;
  for (const g of gp) g.dispose();
  bakeForm(gateGeo, gy, 26);
  weatherTint(gateGeo, 75);
  const gate = new THREE.Mesh(gateGeo, basic(0x7a848e, 0x182231, 0.42, 0.42));
  gate.castShadow = false; gate.receiveShadow = false;
  group.add(gate);

  // ——— 中景补充：下城郭屋顶群 / 坍塌城墙 / 瞭望塔 ———
  const midParts: THREE.BufferGeometry[] = [];
  const townSpots: [number, number][] = [[62, -26], [70, -10], [58, 8], [76, -38], [52, 26], [44, 48], [30, 62], [-24, 58], [-36, 44]];
  for (const [tx, tz] of townSpots) {
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const hx = tx + (R() - 0.5) * 12, hz = tz + (R() - 0.5) * 12;
      const rr = Math.hypot(hx, hz);
      const hy = 6 + 15 * clamp01((88 - rr) / 38) + R() * 2;
      const hw = 2.0 + R() * 1.6, hh = 3 + R() * 1.6;
      const body = new THREE.BoxGeometry(hw, hh, hw * 1.4);
      body.translate(hx, hy + hh / 2, -hz);
      midParts.push(body);
      const rf = new THREE.ConeGeometry(hw * 0.95, 2.6, 4);
      rf.rotateY(Math.PI / 4);
      rf.translate(hx, hy + hh + 1.3, -hz);
      midParts.push(rf);
    }
  }
  for (let i = 0; i < 7; i++) {
    const h = i === 3 ? 1.5 : 4 + (i % 2);
    const seg = new THREE.BoxGeometry(3, h, 1.6);
    seg.translate(46 + i * 3, 10 + h / 2, -40);
    midParts.push(seg);
    if (i === 3) {
      for (let k = 0; k < 5; k++) {
        const b = new THREE.DodecahedronGeometry(0.7 + R(), 0);
        b.translate(46 + i * 3 + (R() - 0.5) * 3, 10 + R(), -40 + (R() - 0.5) * 3);
        midParts.push(b);
      }
    }
  }
  tower(midParts, -28, -62, 12, 2.2, 22, 6, { merlons: true });
  const midGeo = mergeGeometries(midParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of midParts) g.dispose();
  bakeForm(midGeo, 4, 34);
  weatherTint(midGeo, 76);
  const mid = new THREE.Mesh(midGeo, basic(0x7d8791, 0x161e2b, 0.45, 0.4));
  mid.castShadow = false; mid.receiveShadow = false;
  group.add(mid);

  // 裸岩 outcrop（实例化）
  const outGeo = new THREE.DodecahedronGeometry(3, 0);
  outGeo.scale(1, 0.7, 1);
  const outInst = new THREE.InstancedMesh(outGeo, basic(0x767c82, 0x151d2a, 0.45, 0.4, false), 30);
  for (let i = 0; i < 30; i++) {
    const a = R() * Math.PI * 2, rr = 45 + R() * 55;
    dummy.position.set(Math.sin(a) * rr, 6 + R() * 8, -Math.cos(a) * rr);
    dummy.rotation.set(R() * 0.4, R() * 3, R() * 0.4);
    const s = 0.7 + R() * 1.4;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    outInst.setMatrixAt(i, dummy.matrix);
  }
  outInst.instanceMatrix.needsUpdate = true;
  outInst.castShadow = false; outInst.receiveShadow = false;
  group.add(outInst);

  // ——— 松林：近层单株（foothill / 一脊）+ 远层林冠 + 枯阔叶；basic 手动雾与山脊同调 ———
  const pineGeo = pineGeometry();
  const mkPines = (spots: { x: number; y: number; z: number; h: number }[], day: number, night: number, df: number): void => {
    const inst = new THREE.InstancedMesh(pineGeo, basic(day, night, df, 0.4, false), spots.length);
    spots.forEach((p, i) => {
      const s = p.h / 7.4;
      dummy.position.set(p.x, p.y, -p.z);
      dummy.rotation.set((R() - 0.5) * 0.12, R() * Math.PI * 2, (R() - 0.5) * 0.12);
      dummy.scale.set(s * (0.85 + R() * 0.3), s, s * (0.85 + R() * 0.3));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      tmpC.setScalar(0.7 + R() * 0.3);
      inst.setColorAt(i, tmpC);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false; inst.receiveShadow = false;
    group.add(inst);
  };
  const footPines: { x: number; y: number; z: number; h: number }[] = [];
  for (let i = 0; i < 380; i++) {
    const a = R() * Math.PI * 2, rr = 50 + R() * 38;
    const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
    if (x > -13 && x < 32 && z > -11 && z < 32) continue;
    footPines.push({ x, y: 6 + 16 * clamp01((88 - rr) / 38) + R() * 3, z, h: 5 + R() * 4 });
  }
  mkPines(footPines, 0x55604f, 0x1a2430, 0.4);
  const ridgePines: { x: number; y: number; z: number; h: number }[] = [];
  for (let i = 0; i < 420; i++) {
    const a = R() * Math.PI * 2, rr = 104 + R() * 34;
    ridgePines.push({ x: Math.sin(a) * rr, y: 10 + 40 * clamp01((138 - rr) / 34) + R() * 4, z: Math.cos(a) * rr, h: 7 + R() * 6 });
  }
  mkPines(ridgePines, 0x647059, 0x1c2632, 0.45);

  const canInst = new THREE.InstancedMesh(canopyGeometry(), basic(0x74806f, 0x1e2834, 0.55, 0.45, false), 320);
  for (let i = 0; i < 320; i++) {
    const a = (i / 320) * Math.PI * 2 + R() * 0.1;
    const rr = 208 + R() * 26;
    const s = (9 + R() * 6) / 5.2;
    dummy.position.set(Math.sin(a) * rr, 40 + 50 * clamp01((234 - rr) / 26) + R() * 6, -Math.cos(a) * rr);
    dummy.rotation.set(0, R() * 3, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    canInst.setMatrixAt(i, dummy.matrix);
    tmpC.setScalar(0.85 + R() * 0.3);
    canInst.setColorAt(i, tmpC);
  }
  canInst.instanceMatrix.needsUpdate = true;
  if (canInst.instanceColor) canInst.instanceColor.needsUpdate = true;
  canInst.castShadow = false; canInst.receiveShadow = false;
  group.add(canInst);

  const deadInst = new THREE.InstancedMesh(deadTreeGeometry(), basic(0x6a6258, 0x1a222c, 0.5, 0.4, false), 46);
  for (let i = 0; i < 46; i++) {
    const a = R() * Math.PI * 2, rr = 46 + R() * 80;
    const s = 1.2 + R() * 1.4;
    dummy.position.set(Math.sin(a) * rr, 6 + 20 * clamp01((126 - rr) / 80), -Math.cos(a) * rr);
    dummy.rotation.set(0, R() * 3, (R() - 0.5) * 0.15);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    deadInst.setMatrixAt(i, dummy.matrix);
  }
  deadInst.instanceMatrix.needsUpdate = true;
  deadInst.castShadow = false; deadInst.receiveShadow = false;
  group.add(deadInst);

  // ——— 层间雾带（3 圈）———
  const mistRings: THREE.Mesh[] = [];
  const ringSpec: [number, number, number][] = [[95, 14, 0.2], [180, 30, 0.16], [300, 55, 0.13]];
  for (const [rr, yy, op] of ringSpec) {
    const mm = new THREE.MeshBasicMaterial({ color: 0x9aa2a8, fog: false, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr * 1.06, 26, 40, 1, true), mm);
    ring.position.y = yy;
    ring.renderOrder = 5;
    mistRings.push(ring);
    group.add(ring);
  }

  // ——— 每帧大气驱动 ———
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  ground.onBeforeRender = (_r, scene) => {
    const fog = scene.fog as THREE.Fog | null;
    if (!fog) return;
    const night: number = scene.userData.night ?? 0;
    for (const a of atmo) {
      tmpA.copy(a.day).lerp(a.night, night);
      tmpB.copy(fog.color).multiplyScalar(1 + night * 1.6);
      const amount = Math.min(0.88, a.df) * (1 - night) + a.nf * night;
      a.mat.color.copy(tmpA).lerp(tmpB, Math.min(0.88, amount));
    }
    winMat.color.setHex(night > 0.5 ? 0xffb25e : 0x0d1118);
    glowMat.opacity = night * 0.6;
    archDark.color.setHex(0x0a0d12).lerp(tmpB, night * 0.2);
    for (let i = 0; i < mistRings.length; i++) {
      const mm = mistRings[i].material as THREE.MeshBasicMaterial;
      mm.opacity = ringSpec[i][2] * (1 - night * 0.6);
      mm.color.copy(fog.color).multiplyScalar(1.4 - night * 0.3);
    }
  };

  return { group };
}