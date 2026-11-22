// 远景（art pass 3）：山崖城堡、第二城门塔楼、松林三层、山雾分层、墙外枯木。
// 城堡/城门用「手动雾混合 + 烘焙形体明暗」的无雾材质：白天被山雾吞没大半但保留体积，
// 夜晚保留冷蓝剪影 + 月勾顶 + 少量暖窗灯。对比度 ≤ 近景 40%（圣经第 6 节 Distant 层）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch } from './geom';
import { Materials, scaleUV } from './materials';
import { variants } from './materialVariants';

export interface Scenery {
  group: THREE.Group;
}

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** 低模松树：树干 + 三层锥体冠，合并为单一几何供 InstancedMesh 使用。 */
function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 1.6, 5);
  trunk.translate(0, 0.8, 0);
  parts.push(trunk);
  const tiers: [number, number, number][] = [[2.6, 3.8, 1.2], [2.1, 3.2, 2.9], [1.5, 2.8, 4.6]];
  for (const [r, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 7);
    cone.translate(0, y + h / 2, 0);
    parts.push(cone);
  }
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  return geo;
}

/** 圆塔 + 尖锥顶 + 垛口环（城堡用，局部坐标，底在 y0）。 */
function tower(parts: THREE.BufferGeometry[], x: number, z: number, y0: number, r: number, h: number, spire: number, merlons = true): void {
  const body = new THREE.CylinderGeometry(r, r * 1.08, h, 10);
  body.translate(x, y0 + h / 2, z);
  parts.push(body);
  const cap = new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.6, 10);
  cap.translate(x, y0 + h + 0.3, z);
  parts.push(cap);
  if (merlons) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.BoxGeometry(r * 0.42, 0.9, r * 0.3);
      m.rotateY(-a);
      m.translate(x + Math.cos(a) * r * 1.05, y0 + h + 0.9, z + Math.sin(a) * r * 1.05);
      parts.push(m);
    }
  }
  const cone = new THREE.ConeGeometry(r * 1.2, spire, 10);
  cone.translate(x, y0 + h + 0.6 + spire / 2, z);
  parts.push(cone);
}

/** 方形主楼 + 垛口 + 四角角塔（concept/01 的主楼语汇）。 */
function keep(parts: THREE.BufferGeometry[], x: number, z: number, y0: number, w: number, h: number): void {
  const body = new THREE.BoxGeometry(w, h, w);
  body.translate(x, y0 + h / 2, z);
  parts.push(body);
  // 垛口：四边
  const n = Math.floor(w / 1.8);
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const m = new THREE.BoxGeometry(side % 2 ? 0.9 : 1.1, 1.2, side % 2 ? 1.1 : 0.9);
      const ox = side === 0 ? t * w : side === 1 ? w / 2 : side === 2 ? t * w : -w / 2;
      const oz = side === 0 ? -w / 2 : side === 1 ? t * w : side === 2 ? w / 2 : t * w;
      m.translate(x + ox, y0 + h + 0.6, z + oz);
      parts.push(m);
    }
  }
  // 四角角塔（细高 + 尖锥）
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    tower(parts, x + dx * w / 2, z + dz * w / 2, y0 + h * 0.55, w * 0.16, h * 0.62, w * 0.42, false);
  }
}

/** 烘焙形体明暗到顶点色：顶面亮、西侧面次之、底面暗 + 高度渐变（底部沉入雾）。 */
function bakeForm(geo: THREE.BufferGeometry, y0: number, span: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i), nx = nor.getX(i);
    const top = clamp01(ny);
    const west = clamp01(-nx);
    let form = 0.42 + 0.38 * top + 0.2 * west;
    const h = clamp01((pos.getY(i) - y0) / span);
    form *= 0.7 + 0.4 * h;
    form = Math.max(0.25, Math.min(1.1, form));
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = form;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

const HALF_PI = Math.PI / 2;

export function buildScenery(m: Materials): Scenery {
  const group = new THREE.Group();
  group.name = 'scenery';
  const v = variants(m);

  // ——— 大地盘：延伸至雾外的暗色地面 ———
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a4a44, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(320, 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.62;
  ground.receiveShadow = false;
  group.add(ground);

  // ——— 山丘（岩石质感，正常场景雾）———
  const hillBatch = new Batch();
  const hillMat = v.rock; // 山体岩面（材质族 rock，env 合并后换 rock_face 贴图）
  const hills: [number, number, number, number][] = [
    // [x, z, 半径, 高]（城堡山改用下方独立岩崖）
    [-11, 78, 16, 7],   // 城门塔楼丘
    [-45, 100, 42, 16],
    [20, 125, 50, 22],
    [-80, 55, 34, 12],
    [100, 115, 46, 18],
    [45, 105, 30, 12],
  ];
  for (const [x, z, r, h] of hills) {
    const cone = new THREE.ConeGeometry(r, h, 12, 3);
    const pos = cone.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const n = Math.sin(px * 0.35 + pz * 0.27) * Math.cos(pz * 0.31 - px * 0.19);
      if (py < h / 2 - 0.1) {
        pos.setX(i, px * (1 + n * 0.14));
        pos.setZ(i, pz * (1 + n * 0.14));
        pos.setY(i, py + n * h * 0.06);
      }
    }
    cone.computeVertexNormals();
    hillBatch.geo(hillMat, scaleUV(cone, 0.06), x, h / 2 - 1.2, z);
  }

  // ——— 城堡岩崖：多面体岩石山（flat shading + 顶点扰动），顶承城堡 ———
  const cx = 70, czSim = 60, cy = 22; // 城堡基座（岩崖顶）
  const cz = -czSim;
  const cragMat = v.rock;
  const crag = new THREE.CylinderGeometry(15, 32, 26, 10, 4);
  {
    const pos = crag.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const n = Math.sin(px * 0.5 + pz * 0.33) * Math.cos(pz * 0.41 - px * 0.23);
      const n2 = Math.sin(py * 0.7 + px * 0.2);
      if (py < 12.9) {
        pos.setX(i, px * (1 + n * 0.22));
        pos.setZ(i, pz * (1 + n * 0.22));
        pos.setY(i, py + n2 * 1.6);
      }
    }
    crag.computeVertexNormals();
  }
  const cragMeshGeo = scaleUV(crag, 0.05);
  const scree = new THREE.ConeGeometry(36, 8, 10, 1);
  hillBatch.geo(cragMat, cragMeshGeo, cx, cy - 13, czSim);
  hillBatch.geo(cragMat, scaleUV(scree, 0.05), cx, -2, czSim);
  hillBatch.build(group, false);

  // ——— 山顶城堡：主楼 + 中央尖塔 + 外圈圆塔 + 城墙（剪影丰富，对标 concept/01/03）———
  const castleParts: THREE.BufferGeometry[] = [];
  keep(castleParts, cx, cz, cy, 12, 24);
  // 中央细高尖塔（天际线焦点）
  tower(castleParts, cx + 1.5, cz - 1.5, cy + 20, 2.6, 16, 10, false);
  // 外圈圆塔 + 城墙
  const ring: [number, number, number, number][] = [
    [-14, -9, 2.8, 18], [-15, 7, 2.6, 15], [13, -11, 3.0, 20], [15, 6, 2.7, 16],
    [-2, -15, 2.4, 14], [5, 14, 2.5, 15], [-9, 13, 2.2, 13],
  ];
  for (const [dx, dz, r, h] of ring) tower(castleParts, cx + dx, cz + dz, cy - 2, r, h, r * 2.4);
  const wallPairs: [number, number, number, number][] = [
    [-13, -8, -2, -14], [-2, -14, 12, -10], [12, -10, 14, 5], [14, 5, 4, 13],
    [4, 13, -8, 12], [-8, 12, -14, 6], [-14, 6, -13, -8],
  ];
  for (const [ax, az, bx, bz] of wallPairs) {
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bx - ax, bz - az);
    const wall = new THREE.BoxGeometry(1.6, 7, len);
    wall.rotateY(ang);
    wall.translate(cx + (ax + bx) / 2, cy + 1.5, cz + (az + bz) / 2);
    castleParts.push(wall);
    const n = Math.floor(len / 2.2);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const mx = ax + (bx - ax) * t, mz = az + (bz - az) * t;
      const merlon = new THREE.BoxGeometry(1.7, 1.1, 1.0);
      merlon.rotateY(ang);
      merlon.translate(cx + mx, cy + 5.5, cz + mz);
      castleParts.push(merlon);
    }
  }
  const castleGeo = mergeGeometries(castleParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of castleParts) g.dispose();
  bakeForm(castleGeo, cy - 4, 46);
  const castleMat = new THREE.MeshBasicMaterial({ color: 0x6a7480, fog: false, vertexColors: true });
  const castle = new THREE.Mesh(castleGeo, castleMat);
  castle.castShadow = false; castle.receiveShadow = false;
  group.add(castle);

  // ——— 第二城门塔楼（概念图左侧远处）：双圆塔 + 垛口 + 真实门洞 + 夜暖光 ———
  const gateParts: THREE.BufferGeometry[] = [];
  const gx = -11, gzSim = 78, gy = 5.5;
  const gz = -gzSim;
  tower(gateParts, gx - 3.4, gz, gy, 2.4, 16, 7);
  tower(gateParts, gx + 3.4, gz, gy, 2.4, 16, 7);
  const gateWall = new THREE.BoxGeometry(9.5, 12, 3);
  gateWall.translate(gx, gy + 6, gz);
  gateParts.push(gateWall);
  // 门楼山墙顶（木构坡顶语汇简化为石脊）
  const gateRoof = new THREE.ConeGeometry(5.6, 4.5, 4);
  gateRoof.rotateY(Math.PI / 4);
  gateRoof.translate(gx, gy + 14.2, gz);
  gateParts.push(gateRoof);
  // 城墙垛口
  for (let i = 0; i < 5; i++) {
    const mlon = new THREE.BoxGeometry(1.0, 1.0, 3.2);
    mlon.translate(gx - 3.8 + i * 1.9, gy + 12.5, gz);
    gateParts.push(mlon);
  }
  const gateGeo = mergeGeometries(gateParts.map((g) => g.toNonIndexed()), false)!;
  for (const g of gateParts) g.dispose();
  bakeForm(gateGeo, gy, 24);
  const gateTower = new THREE.Mesh(gateGeo, castleMat);
  gateTower.castShadow = false; gateTower.receiveShadow = false;
  group.add(gateTower);
  // 门洞：暗色凹陷（尖拱近似）+ 夜暖光 + 吊闸剪影
  const archDarkMat = new THREE.MeshBasicMaterial({ color: 0x0a0d12, fog: false });
  const archBatch = new Batch();
  archBatch.geo(archDarkMat, new THREE.BoxGeometry(2.6, 4.6, 3.4), gx, gy + 2.3, gzSim);
  archBatch.geo(archDarkMat, new THREE.BoxGeometry(2.4, 3.4, 0.12), gx, gy + 2.6, gzSim + 1.7);
  archBatch.build(group, false);
  const gateGlowMat = new THREE.MeshBasicMaterial({ color: 0xffb25e, fog: false, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const gateGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.6), gateGlowMat);
  gateGlow.position.set(gx, gy + 2.0, gz - 1.75);
  group.add(gateGlow);

  // ——— 城堡暖窗灯（夜晚少量琥珀点，不整齐排列）———
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffb25e, fog: false, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const winBatch = new Batch();
  const winSpots: [number, number, number, number][] = [
    [cx - 6.06, cy + 15, czSim - 2.5, -HALF_PI],
    [cx - 6.06, cy + 21, czSim + 1.8, -HALF_PI],
    [cx - 1.5, cy + 18, czSim - 6.06, 0],
    [cx + 12.9, cy + 12, czSim - 11.2, -1.13],
    [cx - 14.6, cy + 9, czSim - 8.4, -1.35],
    // 城门塔楼暖窗（夜剪影上的可读暖点，不整齐）
    [gx - 3.4, gy + 10, gzSim - 2.45, 0],
    [gx + 3.4, gy + 12.5, gzSim - 2.45, 0],
  ];
  for (const [x, y, z, rot] of winSpots) {
    winBatch.geo(winMat, new THREE.PlaneGeometry(0.7, 1.3), x, y, z, rot);
  }
  winBatch.build(group, false);

  // ——— 外墙延伸与外侧塔楼（庭院东北角外，正常雾）———
  const outerBatch = new Batch();
  outerBatch.box(v.wallRubble, 25, 28.5, 56, 29.5, 0, 5.5);
  for (let x = 26; x < 56; x += 1.6) outerBatch.box(v.wallTrim, x, 28.5, x + 0.8, 29.5, 5.5, 6.1);
  for (const x of [36, 52]) {
    outerBatch.geo(v.wallRubble, scaleUV(new THREE.CylinderGeometry(2.2, 2.5, 9, 10), 0.4), x, 4.5, 29);
    outerBatch.geo(v.roofShingle, scaleUV(new THREE.ConeGeometry(2.6, 4, 10), 0.4), x, 11, 29);
  }
  outerBatch.box(v.wallRubble, -10.5, 29, -9.5, 62, 0, 5);
  for (let z = 30; z < 62; z += 1.6) outerBatch.box(v.wallTrim, -10.5, z, -9.5, z + 0.8, 5, 5.6);
  outerBatch.build(group, false);

  // ——— 松林：三层 InstancedMesh，由近到远渐淡 ———
  const pineGeo = pineGeometry();
  let seed = 977;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const layers: { count: number; r0: number; r1: number; color: number; h0: number; h1: number }[] = [
    { count: 160, r0: 26, r1: 46, color: 0x2f3630, h0: 4.5, h1: 8 },
    { count: 260, r0: 46, r1: 88, color: 0x3c443c, h0: 7, h1: 13 },
    { count: 230, r0: 88, r1: 150, color: 0x4d564e, h0: 9, h1: 16 },
  ];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (const layer of layers) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const inst = new THREE.InstancedMesh(pineGeo, mat, layer.count);
    let placed = 0, guard = 0;
    while (placed < layer.count && guard++ < layer.count * 12) {
      const a = rnd() * Math.PI * 2;
      const r = layer.r0 + rnd() * (layer.r1 - layer.r0);
      const x = Math.sin(a) * r * 1.15;
      const z = 14 + Math.cos(a) * r;
      if (x > -13 && x < 27 && z > -11 && z < 32) continue;
      if (z < -20 && Math.abs(x) < 20) continue;
      if (z < 6 && rnd() < 0.7) continue;
      if (Math.hypot(x - 70, z - 60) < 32) continue; // 城堡岩崖用下方专属松环
      if (Math.hypot(x + 11, z - 78) < 16) continue;
      const h = layer.h0 + rnd() * (layer.h1 - layer.h0);
      const s = h / 7.3;
      dummy.position.set(x, -0.3, -z);
      dummy.rotation.y = rnd() * Math.PI * 2;
      dummy.scale.set(s * (0.85 + rnd() * 0.3), s, s * (0.85 + rnd() * 0.3));
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      col.setHex(layer.color).multiplyScalar(0.8 + rnd() * 0.4);
      inst.setColorAt(placed, col);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false;
    inst.receiveShadow = false;
    group.add(inst);
  }

  // ——— 城堡岩崖坡面 + 城门丘的松环（贴合坡面高度，环绕山脚）———
  const slopeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const slopeSpots: { x: number; y: number; z: number; h: number }[] = [];
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 17 + rnd() * 14; // 岩崖坡面 r16..32
    const x = cx + Math.sin(a) * r, z = czSim + Math.cos(a) * r;
    const y = -2 + 24 * clamp01((32 - r) / 16) - 0.6;
    slopeSpots.push({ x, y, z, h: 6 + rnd() * 6 });
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    if (Math.abs(a - Math.PI) < 0.7) continue; // 门洞朝南（庭院）一侧留空，保证夜暖光可读
    const r = 9 + rnd() * 6;
    const x = gx + Math.sin(a) * r, z = gzSim + Math.cos(a) * r;
    const y = -1.2 + 7 * clamp01((16 - r) / 16) - 0.4;
    slopeSpots.push({ x, y, z, h: 4 + rnd() * 4 });
  }
  const slopeInst = new THREE.InstancedMesh(pineGeo, slopeMat, slopeSpots.length);
  slopeSpots.forEach((p, i) => {
    const s = p.h / 7.3;
    dummy.position.set(p.x, p.y, -p.z);
    dummy.rotation.y = rnd() * Math.PI * 2;
    dummy.scale.set(s * (0.85 + rnd() * 0.3), s, s * (0.85 + rnd() * 0.3));
    dummy.updateMatrix();
    slopeInst.setMatrixAt(i, dummy.matrix);
    col.setHex(0x39423a).multiplyScalar(0.8 + rnd() * 0.4);
    slopeInst.setColorAt(i, col);
  });
  slopeInst.instanceMatrix.needsUpdate = true;
  if (slopeInst.instanceColor) slopeInst.instanceColor.needsUpdate = true;
  slopeInst.castShadow = false; slopeInst.receiveShadow = false;
  group.add(slopeInst);

  // ——— 墙外枯木（替换旧裸枝"X"）：可见主干 + 递归粗枝 + 少量秋叶，读作树而非漂浮棍 ———
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x3a322c, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x7a2a1c, roughness: 0.9, side: THREE.DoubleSide });
  const treeBatch = new Batch();
  const leafSpots: [number, number, number][] = [];
  const branch = (x: number, y: number, z: number, len: number, ang: number, tilt: number, depth: number): void => {
    const r0 = 0.05 * depth + 0.05, r1 = 0.04 * depth + 0.03;
    const geo = new THREE.CylinderGeometry(r1, r0, len, 6);
    const dx = Math.sin(ang) * Math.sin(tilt), dy = Math.cos(tilt), dz = Math.cos(ang) * Math.sin(tilt);
    treeBatch.geo(barkMat, geo, x + dx * len / 2, y + dy * len / 2, z + dz * len / 2, ang, tilt, 0);
    const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
    if (depth <= 0) { leafSpots.push([ex, ey, ez]); return; }
    branch(ex, ey, ez, len * 0.7, ang + 0.5, tilt + 0.3, depth - 1);
    branch(ex, ey, ez, len * 0.62, ang - 0.6, tilt + 0.45, depth - 1);
  };
  // 主干（粗、微倾）+ 三级分枝
  treeBatch.geo(barkMat, new THREE.CylinderGeometry(0.14, 0.3, 5.2, 7), -13.5, 2.6, 21, 0, 0.1, 0.06);
  branch(-13.5, 5.0, 21, 3.2, 0.3, 0.35, 3);
  branch(-13.5, 4.2, 21, 2.6, 2.6, 0.7, 2);
  branch(-13.5, 4.6, 21, 2.4, -1.4, 0.6, 2);
  for (const [lx, ly, lz] of leafSpots) {
    if (rnd() < 0.5) continue; // 稀疏秋叶
    treeBatch.geo(leafMat, new THREE.IcosahedronGeometry(0.35 + rnd() * 0.3, 0), lx, ly, lz, rnd() * 3);
  }
  treeBatch.build(group, false);

  // ——— 山雾分层：几片巨大的软雾团，横在庭院与城堡之间 ———
  const mistTex = makeMistTexture();
  const mistMat = new THREE.SpriteMaterial({ map: mistTex, color: 0x9aa2a8, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
  const mists: THREE.Sprite[] = [];
  const mistSpots: [number, number, number, number, number][] = [
    // [x, y, z, 宽, 高]
    [48, 12, 44, 55, 13], [70, 30, 62, 72, 18], [-4, 7, 46, 45, 10],
    [15, 16, 90, 80, 20], [60, 8, 36, 40, 9], [-14, 11, 70, 50, 12],
    [70, 6, 52, 60, 10],  // 城堡岩崖脚低雾（吞没山脚）
    [-11, 4, 70, 40, 8],  // 城门丘脚低雾
  ];
  for (const [x, y, z, w, h] of mistSpots) {
    const sp = new THREE.Sprite(mistMat);
    sp.position.set(x, y, -z);
    sp.scale.set(w, h, 1);
    mists.push(sp);
    group.add(sp);
  }

  // ——— 每帧大气驱动：读 scene.userData.night 判断昼夜，手动混合城堡剪影色与雾色 ———
  const dayBase = new THREE.Color(0x6a7480);
  const nightBase = new THREE.Color(0x1a2434);
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  castle.onBeforeRender = (_r, scene) => {
    const fog = scene.fog as THREE.Fog | null;
    if (!fog) return;
    const night: number = scene.userData.night ?? 0;
    const dist = 97;
    const f = clamp01((dist - fog.near) / Math.max(1, fog.far - fog.near));
    tmpA.copy(dayBase).lerp(nightBase, night);
    tmpB.copy(fog.color).multiplyScalar(1 + night * 1.6);
    // 白天吞没 ~55%（保留体积但对比 ≤ 近景 40%）；夜晚保留冷蓝剪影 ~45% 混雾
    const amount = Math.min(0.68, f * 0.5) * (1 - night) + 0.45 * night;
    castleMat.color.copy(tmpA).lerp(tmpB, Math.min(0.8, amount));
    winMat.opacity = night * 0.9;
    gateGlowMat.opacity = night * 0.55;
    archDarkMat.color.setHex(0x0a0d12).lerp(tmpB, night * 0.25);
    mistMat.opacity = 0.32 * (1 - night) + 0.06 * night;
    mistMat.color.copy(fog.color).multiplyScalar(1.45 - night * 0.25);
  };

  return { group };
}

/** 横向软雾带：上下软衰减 + 絮状噪声。 */
function makeMistTexture(): THREE.CanvasTexture {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  let s = 613;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const waves = Array.from({ length: 6 }, () => ({ fx: 1 + rnd() * 3, fy: 1 + rnd() * 2, ph: rnd() * 6.28, a: 0.5 + rnd() * 0.5 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      let n = 0;
      for (const w of waves) n += w.a * Math.cos(u * w.fx * 6 + w.ph) * Math.cos(v * w.fy * 4 + w.ph * 1.6);
      n = n / waves.length * 0.5 + 0.5;
      const vert = Math.sin(v * Math.PI);
      const horiz = Math.min(1, Math.min(u, 1 - u) * 6);
      const a = Math.pow(vert, 1.6) * horiz * (0.35 + 0.65 * n);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}