// 远景（art pass 3 · 第三轮）：单一主导山崖城堡（画面右上）+ 柔和低矮的全景剪影远山 + 中景补充 + 分层松林。
// 远层（>=120 m）用「圆柱全景剪影带」：顶边噪声缓起伏、材质自上而下雾渐变、无光照 —— 明度可直接按验收指标调，
// 轮廓为绘画感剪影而非低模锥体，draw calls 个位数。近层 foothill 与城堡山崖保持 3D。
// 明度关系（显示空间）：天空 > 远山脊(越远越贴近天空) > 城堡(略暗于天空,差<=0.12) > 坡面 > 松树(比坡面暗0.04-0.10)。
// 近景（庭院墙/礼拜堂）保持深值不变；压的是远景与天空的差（提亮远景/加雾混合），不压天空。
// 昼夜读 scene.userData.night；驱动挂在恒可见的地盘上。大块风化（5.2）：岩层/碎石/坍塌缺口/补砌/残塔顶。
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

/** 烘焙形体明暗 + 高度渐变到顶点色（3D 近层用）。 */
function bakeForm(geo: THREE.BufferGeometry, y0: number, span: number, contrast = 0.35): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const top = clamp01(nor.getY(i));
    const west = clamp01(-nor.getX(i));
    let raw = 0.5 + 0.4 * top + 0.25 * west;
    raw *= 0.8 + 0.3 * clamp01((pos.getY(i) - y0) / span);
    // contrast=1 恢复强形体明暗（城堡/山崖/松林要读出形体）；小值=远景雾感压平
    const form = 1 - contrast * (1 - Math.max(0.15, Math.min(1.2, raw)));
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = form;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

/** 屋面/锥顶：整体压暗 + 轻微受光变化（深色锥顶是认出城堡的关键）。 */
function bakeFlat(geo: THREE.BufferGeometry, base: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = base * (0.85 + 0.3 * clamp01(nor.getY(i)));
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

/** 中景「苔斑 / 雨渍」顶点色暗示（局部，不满铺）。 */
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
    rr = rr * (1 - moss * 0.25) + 0.29 * moss * 0.25;
    gg = gg * (1 - moss * 0.25) + 0.35 * moss * 0.25;
    bb = bb * (1 - moss * 0.25) + 0.24 * moss * 0.25;
    const s = streak * 0.2;
    col.setXYZ(i, rr * (1 - s), gg * (1 - s), bb * (1 - s));
  }
  col.needsUpdate = true;
}

/** 圆柱全景剪影带：顶边 = 多频噪声缓起伏（非等腰三角），顶点色自上而下雾渐变（顶贴近天空、底略深）。 */
function panoramaBand(radius: number, crest: number, amp: number, seed: number, bottomFactor: number): THREE.BufferGeometry {
  const SEG = 160;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const crestAt = (a: number): number =>
    crest + amp * (0.5 * Math.sin(a * 3 + seed) + 0.3 * Math.sin(a * 7 + seed * 2.3) + 0.2 * Math.sin(a * 13 + seed * 4.1));
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    const yTop = crestAt(a);
    pos.push(x, yTop, z, x, -14, z);
    col.push(1, 1, 1, bottomFactor, bottomFactor, bottomFactor);
    if (i < SEG) {
      const t0 = i * 2, b0 = i * 2 + 1, t1 = i * 2 + 2, b1 = i * 2 + 3;
      idx.push(t0, b0, t1, b0, b1, t1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** 分层枝条松树：可见树干 + 6 层外伸枝盘（锯齿底环、层间留空）+ 尖顶。 */
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
  bakeForm(geo, 0, 7.4, 1.0); // 单株内部受光/背光明暗 => 森林内部对比
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
  bakeForm(geo, 0, 5.2, 1.0);
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

/** 低缓 foothill  mound 环（3D 近层）。 */
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

/** 圆塔：分段 + 收分（下粗上细）+ 檐口环 + 锥顶脊线 / 残缺顶 + 可选垛口。
 *  石砌体进 stone[]，锥顶/脊线/残顶进 roof[]（屋面比墙面暗，靠内部对比认出城堡）。 */
function tower(stone: THREE.BufferGeometry[], roof: THREE.BufferGeometry[], x: number, z: number, y0: number, r: number, h: number, spire: number, opts: { merlons?: boolean; broken?: boolean } = {}): void {
  const seg = 10;
  for (let b = 0; b < 3; b++) {
    const bh = h / 3;
    const rr = r * (1.12 - b * 0.09); // 收分
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

export function buildScenery(_m: Materials): Scenery {
  const group = new THREE.Group();
  group.name = 'scenery';
  const R = rng(1234);
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();

  const atmo: { mat: THREE.MeshBasicMaterial; day: THREE.Color; night: THREE.Color; df: number; nf: number }[] = [];
  const basic = (day: number, night: number, df: number, nf: number, vc = true): THREE.MeshBasicMaterial => {
    const mat = new THREE.MeshBasicMaterial({ color: day, fog: false, vertexColors: vc });
    atmo.push({ mat, day: new THREE.Color(day), night: new THREE.Color(night), df, nf });
    return mat;
  };

  // ——— 大地盘（恒可见，承载大气驱动）———
  const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 48), new THREE.MeshStandardMaterial({ color: 0x4a4a44, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.62;
  ground.receiveShadow = false;
  group.add(ground);

  // ——— 中景 foothill（3D 低缓 mound，承载中景元素）———
  const footGeo = moundRing(70, 14, 6, 34, 71);
  bakeForm(footGeo, -6, 24, 0.5);
  weatherTint(footGeo, 72);
  const foot = new THREE.Mesh(footGeo, basic(0x9aa4ae, 0x161e2b, 0.68, 0.4));
  foot.castShadow = false; foot.receiveShadow = false;
  group.add(foot);

  // ——— 四层全景剪影带（120/220/350/500 m）：低矮柔和、越远越贴近天空 ———
  // [radius, crest, amp, seed, day, df, bottomFactor]
  const bandSpec: [number, number, number, number, number, number, number][] = [
    [120, 40, 10, 11, 0xa8b2bc, 0.72, 0.9],
    [220, 52, 12, 22, 0xb4bec8, 0.82, 0.92],
    [350, 64, 14, 33, 0xc0cad4, 0.88, 0.94],
    [500, 78, 16, 44, 0xccd6e0, 0.93, 0.96],
  ];
  for (const [rad, crest, amp, sd, day, df, bf] of bandSpec) {
    const g = panoramaBand(rad, crest, amp, sd, bf);
    const mat = basic(day, 0x1a2433, df, 0.4 + df * 0.3);
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
  }

  // ——— 城堡岩崖（单一视觉主导，画面右上）+ 坡脚碎石 ———
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
  bakeForm(cragGeo, -6, cy + 10, 1.5);
  { // 块面明暗：节理阴影 + 岩层阴面 + 阳面/阴面
    const pp = cragGeo.getAttribute('position') as THREE.BufferAttribute;
    const cc = cragGeo.getAttribute('color') as THREE.BufferAttribute;
    const nn = cragGeo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const ang = Math.atan2(pp.getX(i), pp.getZ(i));
      let f = 0.65 + 0.55 * clamp01(-nn.getX(i));
      if (Math.sin(ang * 6) > 0.72) f *= 0.5;
      if (nn.getY(i) < -0.15) f *= 0.6;
      if (Math.floor((pp.getY(i) + 33) / 7) % 2 === 0) f *= 0.82; // 岩层阳/阴交替
      cc.setXYZ(i, cc.getX(i) * f, cc.getY(i) * f, cc.getZ(i) * f);
    }
    cc.needsUpdate = true;
  }
  weatherTint(cragGeo, 73);
  const cragMat = basic(0xb4bec8, 0x151d2a, 0.68, 0.42);
  const cragMesh = new THREE.Mesh(cragGeo, cragMat);
  cragMesh.position.set(cx, (cy + 6) / 2 - 6, cz);
  cragMesh.castShadow = false; cragMesh.receiveShadow = false;
  group.add(cragMesh);

  // ——— 山顶城堡 ———
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
  // 主楼壁柱（竖向砌体分段）
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
  weatherTint(castleGeo, 74);
  const castle = new THREE.Mesh(castleGeo, basic(0xccd6e0, 0x1a2434, 0.5, 0.45));
  castle.castShadow = false; castle.receiveShadow = false;
  group.add(castle);
  for (const g of cr) bakeFlat(g, 0.32);

  // 门洞暗色 + 吊闸（合批）
  const archDark = new THREE.MeshBasicMaterial({ color: 0x0a0d12, fog: false });
  const archParts: THREE.BufferGeometry[] = [];
  const a1 = new THREE.BoxGeometry(3, 5.5, 3.6); a1.translate(cx, cy + 0.5, cz - 16); archParts.push(a1);
  const gx = 40, gzSim = 60, gy = 16, gz = -gzSim;
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
  bakeForm(gateGeo, gy, 26, 0.7);
  for (const g of gr) bakeFlat(g, 0.32);
  weatherTint(gateGeo, 75);
  const gate = new THREE.Mesh(gateGeo, basic(0xb8c2cc, 0x182231, 0.6, 0.42));
  gate.castShadow = false; gate.receiveShadow = false;
  group.add(gate);

  // ——— 中景补充：下城郭 / 坍塌墙 / 瞭望塔 ———
  const midParts: THREE.BufferGeometry[] = [];
  const mr: THREE.BufferGeometry[] = [];
  const townSpots: [number, number][] = [[62, -26], [70, -10], [58, 8], [76, -38], [52, 26], [44, 48], [30, 62], [-24, 58], [-36, 44]];
  for (const [tx, tz] of townSpots) {
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const hx = tx + (R() - 0.5) * 12, hz = tz + (R() - 0.5) * 12;
      const rr = Math.hypot(hx, hz);
      const hy = 4 + 11 * clamp01((88 - rr) / 38) + R() * 2;
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
    seg.translate(46 + i * 3, 8 + h / 2, -40);
    midParts.push(seg);
    if (i === 3) {
      for (let k = 0; k < 5; k++) {
        const b = new THREE.DodecahedronGeometry(0.7 + R(), 0);
        b.translate(46 + i * 3 + (R() - 0.5) * 3, 8 + R(), -40 + (R() - 0.5) * 3);
        midParts.push(b);
      }
    }
  }
  tower(midParts, mr, -28, -62, 10, 2.2, 22, 6, { merlons: true });
  const midGeo = mergeGeometries(midParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of midParts) g.dispose();
  bakeForm(midGeo, 4, 30, 0.6);
  for (const g of mr) bakeFlat(g, 0.32);
  weatherTint(midGeo, 76);
  const mid = new THREE.Mesh(midGeo, basic(0x9aa4ae, 0x161e2b, 0.68, 0.4));
  mid.castShadow = false; mid.receiveShadow = false;
  group.add(mid);

  // 屋面/锥顶统一合批：比墙面暗 0.10-0.18，靠内部对比认出城堡
  const roofAll = mergeGeometries([...cr, ...gr, ...mr].map((g) => g.toNonIndexed()), false)!;
  for (const g of [...cr, ...gr, ...mr]) g.dispose();
  const roofMesh = new THREE.Mesh(roofAll, basic(0x8a94a0, 0x141c28, 0.5, 0.45));
  roofMesh.castShadow = false; roofMesh.receiveShadow = false;
  group.add(roofMesh);

  // 裸岩 outcrop
  const outGeo = new THREE.DodecahedronGeometry(3, 0);
  outGeo.scale(1, 0.7, 1);
  const outInst = new THREE.InstancedMesh(outGeo, basic(0x9aa4ae, 0x151d2a, 0.68, 0.4, false), 24);
  for (let i = 0; i < 24; i++) {
    const a = R() * Math.PI * 2, rr = 45 + R() * 55;
    dummy.position.set(Math.sin(a) * rr, 4 + R() * 6, -Math.cos(a) * rr);
    dummy.rotation.set(R() * 0.4, R() * 3, R() * 0.4);
    const s = 0.7 + R() * 1.4;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    outInst.setMatrixAt(i, dummy.matrix);
  }
  outInst.instanceMatrix.needsUpdate = true;
  outInst.castShadow = false; outInst.receiveShadow = false;
  group.add(outInst);

  // ——— 松林：foothill 单株（比坡面暗）+ 一脊带顶林冠线 + 枯阔叶 ———
  const pineGeo = pineGeometry();
  const mkPines = (spots: { x: number; y: number; z: number; h: number }[], day: number, df: number): void => {
    const inst = new THREE.InstancedMesh(pineGeo, basic(day, 0x1a2430, df, 0.4, true), spots.length);
    spots.forEach((p, i) => {
      const s = p.h / 7.4;
      dummy.position.set(p.x, p.y, -p.z);
      dummy.rotation.set((R() - 0.5) * 0.12, R() * Math.PI * 2, (R() - 0.5) * 0.12);
      dummy.scale.set(s * (0.85 + R() * 0.3), s, s * (0.85 + R() * 0.3));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      tmpC.setScalar(0.75 + R() * 0.35);
      inst.setColorAt(i, tmpC);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false; inst.receiveShadow = false;
    group.add(inst);
  };
  const footPines: { x: number; y: number; z: number; h: number }[] = [];
  for (let i = 0; i < 240; i++) {
    const a = R() * Math.PI * 2, rr = 50 + R() * 38;
    const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
    if (x > -13 && x < 32 && z > -11 && z < 32) continue;
    footPines.push({ x, y: 3 + 11 * clamp01((88 - rr) / 38) + R() * 2, z, h: 5 + R() * 4 });
  }
  mkPines(footPines, 0x747e76, 0.3); // 比 foothill 坡面(0x9aa4ae/0.62)暗

  // 一脊带顶林冠线（沿 crest 噪声放置，比带面暗）
  const crest1 = (a: number): number => 40 + 10 * (0.5 * Math.sin(a * 3 + 11) + 0.3 * Math.sin(a * 7 + 25.3) + 0.2 * Math.sin(a * 13 + 45.1));
  const canInst = new THREE.InstancedMesh(canopyGeometry(), basic(0x747e76, 0x1c2632, 0.3, 0.45, true), 220);
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * Math.PI * 2 + R() * 0.1;
    const rr = 118 + R() * 6;
    const s = (7 + R() * 5) / 5.2;
    dummy.position.set(Math.sin(a) * rr, crest1(a) - 2 + R() * 2, -Math.cos(a) * rr);
    dummy.rotation.set(0, R() * 3, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    canInst.setMatrixAt(i, dummy.matrix);
    tmpC.setScalar(0.75 + R() * 0.35);
    canInst.setColorAt(i, tmpC);
  }
  canInst.instanceMatrix.needsUpdate = true;
  if (canInst.instanceColor) canInst.instanceColor.needsUpdate = true;
  canInst.castShadow = false; canInst.receiveShadow = false;
  group.add(canInst);

  const deadInst = new THREE.InstancedMesh(deadTreeGeometry(), basic(0x8a8478, 0x1a222c, 0.5, 0.4, false), 36);
  for (let i = 0; i < 36; i++) {
    const a = R() * Math.PI * 2, rr = 46 + R() * 70;
    const s = 1.2 + R() * 1.4;
    dummy.position.set(Math.sin(a) * rr, 4 + 12 * clamp01((116 - rr) / 70), -Math.cos(a) * rr);
    dummy.rotation.set(0, R() * 3, (R() - 0.5) * 0.15);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    deadInst.setMatrixAt(i, dummy.matrix);
  }
  deadInst.instanceMatrix.needsUpdate = true;
  deadInst.castShadow = false; deadInst.receiveShadow = false;
  group.add(deadInst);

  // ——— 每帧大气驱动（挂恒可见地盘）；雾感锚定天空地平线值（uHorizon），不随 fog.color 漂移 ———
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  let skyUniforms: { uHorizon: { value: THREE.Color } } | null = null;
  ground.onBeforeRender = (_r, scene) => {
    const fog = scene.fog as THREE.Fog | null;
    if (!fog) return;
    if (!skyUniforms) {
      scene.traverse((o) => {
        const mm = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (!skyUniforms && mm && mm.uniforms && mm.uniforms.uHorizon) skyUniforms = mm.uniforms as { uHorizon: { value: THREE.Color } };
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
    winMat.color.setHex(night > 0.5 ? 0xffb25e : 0x0d1118);
    glowMat.opacity = night * 0.6;
    archDark.color.setHex(0x0a0d12).lerp(tmpB, night * 0.2);
  };

  return { group };
}