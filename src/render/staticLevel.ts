// 静态建筑：墙、地面、屋顶、地标与不随状态变化的陈设。按材质合并为少量网格。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PROPS, RAISED_Y, WALLS, WELL } from '../sim/level';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { archHeader, archLeaf, Batch, gable } from './geom';
import { buildFurniture } from './furniture';
import { grassTexture, ivyLeafTexture, leadedGlass, leafTexture, Materials, mossTexture, rustTexture, scaleUV, tiledBox, trackPending } from './materials';

const R = RAISED_Y;
const HALF_PI = Math.PI / 2;

/** 确定性随机（装饰分布用，保证每次构建一致）。 */
function drng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StaticLevel {
  group: THREE.Group;
  /** 高窗：白天透进冷光，夜里几乎全黑。 */
  windowMat: THREE.MeshStandardMaterial;
  /** 门房朝庭院的窗：炉火点着时透出琥珀色，是回程地标。 */
  hearthWindowMat: THREE.MeshStandardMaterial;
}

interface MerlonXf { x: number; y: number; z: number; ry: number; w: number; h: number; t: number }
/** 垛口：带倒角的顶缘 + 宽度/高度轻微不规则，少数风化残缺。收集变换供 InstancedMesh。 */
function merlons(list: MerlonXf[], x0: number, z0: number, x1: number, z1: number, y: number): void {
  const alongX = x1 - x0 > z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  const n = Math.max(1, Math.floor(len / 1.5));
  const stepLen = len / n;
  const r = drng(Math.round(x0 * 7 + z0 * 13 + y * 3) + 5);
  const thick = alongX ? z1 - z0 : x1 - x0;
  for (let i = 0; i < n; i++) {
    const c = (alongX ? x0 : z0) + stepLen * (i + 0.5);
    // 风化：少数垛口残缺或降低，避免整齐如新
    const wear = ((i * 37 + Math.round(c * 3)) % 11);
    if (wear === 0) continue;
    const h = (wear === 1 ? 0.3 : 0.55 + r() * 0.14);
    const w = 0.62 + r() * 0.16;
    if (alongX) list.push({ x: c, y, z: (z0 + z1) / 2, ry: 0, w, h, t: thick });
    else list.push({ x: (x0 + x1) / 2, y, z: c, ry: HALF_PI, w, h, t: thick });
  }
}

/** 墙角凸出角石（quoin）：大小交替、微微出墙，从勒脚砌到墙顶。 */
function quoin(b: Batch, mat: THREE.Material, x: number, z: number, h: number): void {
  const r = drng(Math.round(x * 31 + z * 17) + 9);
  let y = 0.3;
  let i = 0;
  while (y < h - 0.2) {
    const ch = 0.36 + r() * 0.12;
    const long = i % 2 === 0;
    const sx = long ? 0.72 : 0.5;
    const sz = long ? 0.5 : 0.72;
    b.box(mat, x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, y, Math.min(y + ch, h), 1.4);
    y += ch + 0.02;
    i++;
  }
}

/** 门洞/拱的石砌框：两侧门 jamb 砌块 + 沿尖拱曲线的券石（voussoir），微出墙面。 */
function archFrame(b: Batch, mat: THREE.Material, cx: number, cz: number, w: number, s: number, p: number, rotY: number, y0 = 0): void {
  const r = drng(Math.round(cx * 13 + cz * 7 + w * 3) + 21);
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  // 本地 (u,v) → 世界 (x,z)：u 沿墙横方向，v 为高度；墙面法线本地 +z
  const at = (u: number, v: number, out: number): [number, number, number] =>
    [cx + u * cos + out * sin, v, cz - u * sin + out * cos];
  // 门侧砌块
  for (const side of [-1, 1]) {
    let y = y0;
    let i = 0;
    while (y < y0 + s - 0.1) {
      const ch = 0.4 + r() * 0.12;
      const [x, , z] = at(side * (w / 2 + 0.14), 0, 0);
      const bw = 0.3 + r() * 0.08;
      const geo = tiledBox(bw, ch, 0.62, 1.4);
      b.geo(mat, geo, x, y + ch / 2, z, rotY);
      y += ch + 0.02;
      i++;
    }
  }
  // 券石：沿两条二次曲线采样，朝向切线
  const k = s + (p - s) * 0.72;
  const n = 7;
  for (const side of [-1, 1]) {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // 二次贝塞尔：P0=(side*w/2,s) P1=(side*w/2,k) P2=(0,p)
      const u = (1 - t) * (1 - t) * (side * w / 2) + 2 * (1 - t) * t * (side * w / 2);
      const v = (1 - t) * (1 - t) * s + 2 * (1 - t) * t * k + t * t * p;
      const du = 2 * (1 - t) * 0 + 2 * t * (0 - side * w / 2);
      const dv = 2 * (1 - t) * (k - s) + 2 * t * (p - k);
      const ang = Math.atan2(dv, du) - HALF_PI;
      const rl = Math.hypot(u, v - s) || 1;
      const [x, , z] = at(u + (u / rl) * 0.16, v + ((v - s) / rl) * 0.16, 0);
      const geo = tiledBox(0.24, 0.42, 0.6, 1.4);
      b.geo(mat, geo, x, y0 + v + ((v - s) / rl) * 0.16, z, rotY, 0, ang);
    }
  }
  // 拱顶锁石
  const [kx, , kz] = at(0, p, 0);
  b.geo(mat, tiledBox(0.3, 0.5, 0.64, 1.4), kx, y0 + p + 0.16, kz, rotY);
}

/** 斜撑木框货箱：芯板 + 四角立柱 + 上下横档 + 四面斜撑，保持原碰撞盒尺寸。 */

export function buildStaticLevel(m: Materials): StaticLevel {
  const group = new THREE.Group();
  const b = new Batch();
  const merlonXf: MerlonXf[] = [];
  const rubbleXf: { x: number; y: number; z: number; s: number; r: number }[] = [];
  // 高窗：暗玻璃 + 铅条窗格。白天微弱冷天光（不再过曝成白洞），夜晚近乎全黑。
  const coldGlass = leadedGlass(false);
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x2a3440, map: coldGlass.map, roughness: 0.22, metalness: 0.05,
    emissive: 0x3a4a5c, emissiveMap: coldGlass.panes, emissiveIntensity: 0.45,
  });
  // 门房朝庭院的窗：炉火点着时透过铅条窗格透出琥珀暖光，是回程地标。
  const warmGlass = leadedGlass(true);
  const hearthWindowMat = new THREE.MeshStandardMaterial({
    color: 0x3a2a1c, map: warmGlass.map, roughness: 0.3, metalness: 0.05,
    emissive: 0xff9a3c, emissiveMap: warmGlass.panes, emissiveIntensity: 1.2,
  });

  // 墙体：勒脚（加宽基座）+ 墙身 + 压顶。贴图 3.5 m 一格 → 砌块约 0.4 m 宽。
  for (const w of WALLS) {
    const mat = w.h >= 7 ? m.stoneDark : m.stone;
    b.box(mat, w.x0, w.z0, w.x1, w.z1, 0, w.h, 4.5);
    b.box(m.stoneDark, w.x0 - 0.08, w.z0 - 0.08, w.x1 + 0.08, w.z1 + 0.08, 0, 0.35, 4.5);
    if (w.h >= 5) b.box(m.stoneDark, w.x0 - 0.05, w.z0 - 0.05, w.x1 + 0.05, w.z1 + 0.05, w.h - 0.12, w.h, 4.5);
    if (w.h === 5 && w.tag !== 'cellar' && !(w.x0 === 10.5 && w.z0 === 17.5)) merlons(merlonXf, w.x0, w.z0, w.x1, w.z1, w.h);
  }
  merlons(merlonXf, -10.5, 0, -3.6, 0.5, 4.2);
  merlons(merlonXf, 3.6, 0, 10.5, 0.5, 4.2);
  // 垛口实例化：单位倒角盒 + 每实例缩放/朝向
  {
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0); shape.lineTo(0.5, 0); shape.lineTo(0.5, 1); shape.lineTo(-0.5, 1); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1, curveSegments: 1 });
    geo.translate(0, 0, -0.5);
    scaleUV(geo, 1 / 4.5);
    const im = new THREE.InstancedMesh(geo, m.stone, merlonXf.length);
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion();
    merlonXf.forEach((t, i) => {
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ry);
      mm.compose(new THREE.Vector3(t.x, t.y, -t.z), qq, new THREE.Vector3(t.w, t.h, t.t));
      im.setMatrixAt(i, mm);
      const k = 0.82 + ((i * 37) % 10) / 40;
      im.setColorAt(i, new THREE.Color(k, k, k * 1.03));
    });
    im.castShadow = im.receiveShadow = true;
    group.add(im);
  }

  // 庭院四角与门房角的凸出角石
  for (const [x, z, h] of [[-10.25, 0.25, 4.2], [10.25, 0.25, 4.2], [-10.25, 28.75, 4.2], [10.25, 28.75, 3.2], [-3.25, -8.25, 3.6], [3.25, -8.25, 3.6]] as [number, number, number][]) {
    quoin(b, m.stoneDark, x, z, h);
  }
  // 墙面少量突出石块（风化鼓出），只在庭院可见面
  {
    const r = drng(401);
    const faces: [number, number, number, number, number][] = [
      // [x, z, 法线x, 法线z, 沿墙长度]：西墙内面、东墙内面、南墙内面、礼拜堂西面
      [-10, 14.5, 1, 0, 28], [10, 13, -1, 0, 25], [0, 0.5, 0, 1, 20], [13, 13, -1, 0, 23],
    ];
    for (const [fx, fz, nx, nz, len] of faces) {
      for (let i = 0; i < 9; i++) {
        const t = (r() - 0.5) * len;
        const y = 0.7 + r() * 3.4;
        const w = 0.26 + r() * 0.22, h = 0.18 + r() * 0.14, out = 0.05 + r() * 0.06;
        const x = fx + (nz !== 0 ? t : 0), z = fz + (nx !== 0 ? t : 0);
        if (nz !== 0 && Math.abs(x) < 3.6) continue; // 门房占位
        const bx = fx - nx * 0.06, bz = fz - nz * 0.06;
        const x0 = nx !== 0 ? Math.min(bx, bx + nx * (out + 0.06)) : x - w / 2;
        const x1 = nx !== 0 ? Math.max(bx, bx + nx * (out + 0.06)) : x + w / 2;
        const z0 = nz !== 0 ? Math.min(bz, bz + nz * (out + 0.06)) : z - w / 2;
        const z1 = nz !== 0 ? Math.max(bz, bz + nz * (out + 0.06)) : z + w / 2;
        b.box(m.stone, x0, z0, x1, z1, y, y + h, 1.6);
      }
    }
  }

  // 门洞上方的尖拱过梁
  b.geo(m.stone, archHeader(1.6, 1.9, 2.6, 4.2, 0.5), 0, 0, 0.25);
  b.geo(m.stone, archHeader(1.8, 2.0, 2.8, 5, 0.5), 10.25, 0, 6, HALF_PI);
  b.geo(m.stone, archHeader(2, 2.3, 3.5, 5 - R, 0.5), 10.25, R, 27, HALF_PI);
  b.geo(m.stoneDark, archHeader(1.8, 2.2, 3.2, 7 - R, 0.5), 19, R, 25.25);
  b.geo(m.stoneDark, archHeader(1.6, 1.9, 2.6, 7 - R, 0.5), 13.25, R, 16, HALF_PI);
  b.geo(m.stoneDark, archHeader(2, 2.2, 3.0, 4.5 - R, 0.4), 15.2, R, 20.8);
  // 石砌门框 / 券石框
  archFrame(b, m.stoneDark, 0, 0.25, 1.6, 1.9, 2.6, 0);
  archFrame(b, m.stoneDark, 10.25, 6, 1.8, 2.0, 2.8, -HALF_PI);
  archFrame(b, m.stoneDark, 10.25, 27, 2, 2.3, 3.5, -HALF_PI, R);
  archFrame(b, m.stone, 19, 25.25, 1.8, 2.2, 3.2, Math.PI, R);
  archFrame(b, m.stone, 13.25, 16, 1.6, 1.9, 2.6, -HALF_PI, R);

  // 地面
  b.box(m.gravel, -90, -70, 90, 110, -0.6, -0.04, 3);
  b.box(m.flag, -10.5, 0, 10.5, 29, -0.3, 0, 3);
  b.box(m.woodFloor, -3.5, -8.5, 3.5, 0, -0.3, 0.005, 1.6);
  b.box(m.gravel, 10.5, 1.5, 13, 17.5, -0.3, 0.004, 2);
  b.box(m.flag, 13, 7.5, 25, 25.5, -0.3, R, 3);
  b.box(m.flag, 10, 25.5, 25, 29, -0.3, R, 3);
  // 矮台阶（三级，每级 0.15 m）：外廊尖拱前、礼拜堂侧门前
  for (let i = 0; i < 3; i++) {
    b.box(m.stone, 8.6 + (i * 1.4) / 3, 25.5, 10, 28.5, 0, (R * (i + 1)) / 3);
    b.box(m.stone, 12 + i / 3, 15.2, 13, 16.8, 0, (R * (i + 1)) / 3);
  }

  // 门房：木屋顶、山墙、横梁
  const ghAng = Math.atan2(2, 3.9);
  b.geo(m.roof, tiledBox(4.55, 0.16, 10, 1.2), 1.95, 4.62, -4, 0, 0, -ghAng);
  b.geo(m.roof, tiledBox(4.55, 0.16, 10, 1.2), -1.95, 4.62, -4, 0, 0, ghAng);
  b.geo(m.wood, gable(7.4, 2.0, 0.4), 0, 3.6, -8.25);
  b.geo(m.wood, gable(7.4, 1.7, 0.4), 0, 3.9, 0.25);
  for (const z of [-6.6, -4.1, -1.6]) b.box(m.wood, -3.2, z - 0.12, 3.2, z + 0.12, 3.3, 3.54, 1);
  b.box(m.wood, -0.1, -8.4, 0.1, 0.4, 5.4, 5.62, 1);
  // 门房外檐：挂晨钟的木托架
  b.box(m.wood, 1.5, 0.5, 1.66, 1.75, 2.95, 3.11, 1);
  b.box(m.wood, 2.74, 0.5, 2.9, 1.75, 2.95, 3.11, 1);
  b.box(m.wood, 1.4, 1.02, 3.0, 1.18, 3.11, 3.27, 1);
  b.geo(m.roof, tiledBox(1.9, 0.08, 1.5, 1.2), 2.2, 3.5, 1.2, 0, 0.3, 0);

  // 礼拜堂：石拱顶（西坡中段残缺）、山墙
  const chAng = Math.atan2(3.5, 6.3);
  b.geo(m.roof, tiledBox(7.3, 0.2, 18.6, 1.4), 22.15, 8.75, 16.5, 0, 0, -chAng);
  b.geo(m.roof, tiledBox(7.3, 0.2, 5.0, 1.4), 15.85, 8.75, 9.7, 0, 0, chAng);
  b.geo(m.roof, tiledBox(7.3, 0.2, 8.6, 1.4), 15.85, 8.75, 21.5, 0, 0, chAng);
  b.geo(m.roof, tiledBox(3.2, 0.2, 5.0, 1.4), 17.7, 9.78, 14.7, 0, 0, chAng);
  b.geo(m.stoneDark, gable(12.6, 3.5, 0.5), 19, 7, 7.75);
  b.geo(m.stoneDark, gable(12.6, 3.5, 0.5), 19, 7, 25.25);
  for (const z of [10.5, 13.5, 16.5, 19.5, 22.5]) b.box(m.wood, 13.5, z - 0.14, 24.5, z + 0.14, 6.7, 6.98, 1);
  // 朝庭院的山墙与空钟架：从门房出口即可辨认的地标
  b.geo(m.stoneDark, gable(6.5, 3.4, 0.5), 13.25, 7, 21, HALF_PI);
  b.box(m.stoneDark, 13, 20.45, 13.5, 20.7, 10.2, 11.7);
  b.box(m.stoneDark, 13, 21.3, 13.5, 21.55, 10.2, 11.7);
  b.geo(m.stoneDark, gable(1.5, 0.7, 0.5), 13.25, 11.7, 21, HALF_PI);
  // 扶壁与压顶
  for (const z of [9, 12, 18.5, 23.5]) {
    b.box(m.stoneDark, 12.75, z - 0.35, 13, z + 0.35, 5, 6.6);
    b.geo(m.stoneDark, new THREE.ConeGeometry(0.42, 0.55, 4), 12.875, 6.85, z, Math.PI / 4);
  }
  // 高窗窗花：中梃 + 横棂，把整片玻璃分成尖拱小格
  for (const z of [9.6, 12.4, 18.6, 23]) {
    b.box(m.stoneDark, 12.95, z - 0.03, 13.55, z + 0.03, 3.3, 5.7);
    b.box(m.stoneDark, 12.95, z - 0.45, 13.55, z + 0.45, 4.4, 4.47);
  }
  for (const z of [10, 13, 16, 19, 22.8]) {
    b.box(m.stoneDark, 24.4, z - 0.03, 24.55, z + 0.03, 3.0, 5.4);
    b.box(m.stoneDark, 24.4, z - 0.45, 24.55, z + 0.45, 4.1, 4.17);
  }
  // 正门罩拱（向外挑出的线脚）与侧门罩拱
  b.geo(m.stoneDark, archHeader(2.2, 2.3, 3.5, 4.2, 0.18), 19, R, 25.62);
  b.geo(m.stoneDark, archHeader(2.0, 2.3, 3.2, 4.0, 0.16), 13.1, R, 16, HALF_PI);
  // 钟架山墙的小尖塔与十字顶饰
  for (const z of [20.45, 21.55]) b.geo(m.stoneDark, new THREE.ConeGeometry(0.16, 0.8, 4), 13.25, 12.1, z, Math.PI / 4);
  b.box(m.stoneDark, 13.18, 20.95, 13.32, 21.05, 12.4, 13.1);
  b.box(m.stoneDark, 13.18, 20.78, 13.32, 21.22, 12.85, 12.95);

  // 高窗（朝庭院与室内两面）
  const lancet = (): THREE.BufferGeometry => scaleUV(archLeaf(0.9, 2.2, 3.0, 0.05), 0.2);
  for (const z of [9.6, 12.4, 18.6, 23]) {
    b.geo(windowMat, lancet(), 12.97, 3.3, z, HALF_PI);
    b.geo(windowMat, lancet(), 13.53, 3.3, z, HALF_PI);
  }
  for (const z of [10, 13, 16, 19, 22.8]) b.geo(windowMat, lancet(), 24.47, 3.0, z, HALF_PI);
  b.geo(windowMat, archLeaf(1.7, 3.0, 4.5, 0.05), 19, 2.0, 8.03);
  b.geo(windowMat, archLeaf(1.5, 1.6, 2.6, 0.05), 13.2, 7.3, 21, HALF_PI);
  // 门房窗：后墙一扇冷光窗，朝庭院一扇透出炉火
  b.geo(windowMat, archLeaf(0.7, 1.0, 1.5, 0.05), 0.6, 1.5, -7.97);
  b.geo(hearthWindowMat, archLeaf(0.7, 0.9, 1.3, 0.05), -2.0, 1.5, 0.53);
  b.geo(hearthWindowMat, archLeaf(0.7, 0.9, 1.3, 0.05), -2.0, 1.5, -0.03);

  // 外廊披檐
  b.geo(m.roof, tiledBox(14.6, 0.14, 3.7, 1.2), 17.7, 3.75, 27.2, 0, -0.16, 0);
  for (const x of [13, 16.5, 20, 23.5]) b.box(m.wood, x - 0.1, 25.5, x + 0.1, 28.5, 3.2, 3.42, 1);

  // 地下封门：砌死的石拱，只作预告
  b.geo(m.stoneDark, archLeaf(1.7, 1.5, 2.3, 0.12), 11.75, 0, 2.04);
  b.geo(m.iron, tiledBox(1.9, 0.1, 0.06, 1), 11.75, 1.1, 2.12);
  b.geo(m.iron, tiledBox(0.1, 2.0, 0.06, 1), 11.75, 1.0, 2.12);

  // 远景：带尖顶的城堡轮廓与山崖，没有可玩入口
  const far = new Batch();
  // 西北城堡：主塔 + 尖顶 + 副塔 + 连墙
  far.box(m.far, -49, 65, -37, 77, -5, 34);
  far.geo(m.far, new THREE.ConeGeometry(6.2, 13, 6), -43, 40.5, 71);
  far.box(m.far, -55, 62, -49, 68, -5, 26);
  far.geo(m.far, new THREE.ConeGeometry(3.4, 8, 6), -52, 30, 65);
  far.box(m.far, -55, 68, -37, 70, -5, 18);
  // 东北塔楼
  far.box(m.far, 38, 70, 48, 80, -5, 26);
  far.geo(m.far, new THREE.ConeGeometry(5.2, 11, 6), 43, 31.5, 75);
  far.box(m.far, 48, 72, 54, 78, -5, 16);
  // 山崖
  far.box(m.far, -90, 48, -58, 100, -5, 12);
  far.box(m.far, 55, 40, 95, 105, -5, 9);
  far.box(m.far, -30, 84, 34, 100, -5, 16);

  // —— 地表细节：爬藤（实例化叶片）、苔痕、草丛（实例化）、落叶（实例化）、枯木、瓦砾 ——
  const decal = new Batch();
  const mossMat = new THREE.MeshStandardMaterial({ map: mossTexture(), roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const bark = new THREE.MeshStandardMaterial({ color: 0x3a322c, roughness: 1 });
  // 墙脚苔痕（竖贴）与井台、地面苔斑
  for (const [x, z, w, rot] of [[-9.95, 12, 5, HALF_PI], [-9.95, 22, 4, HALF_PI], [9.95, 12, 5, -HALF_PI], [0, 28.45, 6, 0]] as [number, number, number, number][]) {
    decal.geo(mossMat, new THREE.PlaneGeometry(w, 0.7), x, 0.35, z, rot);
  }

  // 爬藤：程序生成藤枝 + 数千片实例化叶（红褐-酒红-少量橙黄），从墙头垂下
  const ivyR = drng(131);
  const ivyMat = new THREE.MeshStandardMaterial({ map: ivyLeafTexture(), roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.45 });
  const ivyPalette = [0x7a2a1c, 0x5e1a1a, 0x6b2418, 0x4a1616, 0xa8642a, 0x3a3a20].map((h) => new THREE.Color(h));
  interface Patch { bx: number; bz: number; nx: number; nz: number; tx: number; tz: number; u0: number; u1: number; top: number; bot: number; dens: number }
  const patches: Patch[] = [
    { bx: -9.94, bz: 0, nx: 1, nz: 0, tx: 0, tz: 1, u0: 3.5, u1: 9, top: 4.15, bot: 0.3, dens: 0.9 },
    { bx: -9.94, bz: 0, nx: 1, nz: 0, tx: 0, tz: 1, u0: 17, u1: 23, top: 4.15, bot: 0.4, dens: 0.9 },
    { bx: -9.94, bz: 0, nx: 1, nz: 0, tx: 0, tz: 1, u0: 24, u1: 27.5, top: 4.15, bot: 1.0, dens: 0.85 },
    { bx: 0, bz: 0.56, nx: 0, nz: 1, tx: 1, tz: 0, u0: -7.5, u1: -3.6, top: 4.15, bot: 0.4, dens: 0.85 },
    { bx: 9.94, bz: 0, nx: -1, nz: 0, tx: 0, tz: 1, u0: 18, u1: 24.5, top: 4.95, bot: 1.8, dens: 0.8 },
    { bx: 12.94, bz: 0, nx: -1, nz: 0, tx: 0, tz: 1, u0: 9, u1: 14, top: 6.9, bot: 2.6, dens: 0.6 },
  ];
  const ivyPos: THREE.Vector3[] = [];
  const ivyQuat: THREE.Quaternion[] = [];
  const ivyScale: number[] = [];
  const ivyCol: THREE.Color[] = [];
  const qTmp = new THREE.Quaternion();
  const eTmp = new THREE.Euler();
  for (const pa of patches) {
    const yaw = Math.atan2(pa.nx, pa.nz);
    const stems = Math.max(3, Math.ceil((pa.u1 - pa.u0) / 0.35));
    for (let s = 0; s < stems; s++) {
      const uBase = pa.u0 + ((s + 0.5) * (pa.u1 - pa.u0)) / stems + (ivyR() - 0.5) * 0.3;
      const phase = ivyR() * 6.28, amp = 0.22 + ivyR() * 0.35;
      let step = 0;
      for (let y = pa.top; y > pa.bot; y -= 0.085) {
        const u = uBase + Math.sin(y * 1.7 + phase) * amp + (ivyR() - 0.5) * 0.1;
        const px = pa.bx + pa.tx * u, pz = pa.bz + pa.tz * u;
        // 藤茎段（隔步放置，合并进 decal）
        if (step % 2 === 0) {
          decal.geo(bark, new THREE.BoxGeometry(0.022, 0.17, 0.022), px + pa.nx * 0.03, y, pz + pa.nz * 0.03, yaw, (ivyR() - 0.5) * 0.3, (ivyR() - 0.5) * 0.3);
        }
        step++;
        const n = ivyR() < pa.dens ? 4 : 2;
        for (let l = 0; l < n; l++) {
          const du = (ivyR() - 0.5) * 0.44, dv = (ivyR() - 0.5) * 0.22, out = 0.04 + ivyR() * 0.11;
          ivyPos.push(new THREE.Vector3(px + pa.tx * du + pa.nx * out, y + dv, -(pz + pa.tz * du + pa.nz * out)));
          eTmp.set((ivyR() - 0.5) * 1.5, (ivyR() - 0.5) * 1.5, ivyR() * Math.PI * 2);
          qTmp.setFromEuler(eTmp);
          ivyQuat.push(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(qTmp));
          ivyScale.push(0.17 + ivyR() * 0.1);
          const c = ivyPalette[ivyR() < 0.1 ? 4 : ivyR() < 0.18 ? 5 : Math.floor(ivyR() * 4)];
          const k = 1.0 + ivyR() * 0.6;
          ivyCol.push(c.clone().multiplyScalar(k));
        }
      }
    }
  }
  const ivyMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), ivyMat, ivyPos.length);
  {
    const mm = new THREE.Matrix4();
    for (let i = 0; i < ivyPos.length; i++) {
      mm.compose(ivyPos[i], ivyQuat[i], new THREE.Vector3(ivyScale[i], ivyScale[i], ivyScale[i]));
      ivyMesh.setMatrixAt(i, mm);
      ivyMesh.setColorAt(i, ivyCol[i]);
    }
    ivyMesh.castShadow = false;
    ivyMesh.receiveShadow = true;
    group.add(ivyMesh);
  }

  // 石板缝草丛：实例化十字面片，墙脚 / 井台周围 / 板缝，数量提高
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, side: THREE.DoubleSide, alphaTest: 0.4 });
  const gr = drng(211);
  const grassPos: [number, number, number][] = [];
  const grassH: number[] = [];
  const grassEdge: boolean[] = [];
  const pushGrass = (x: number, z: number, edge = false): void => {
    grassPos.push([x, 0, z]);
    grassH.push(edge ? 0.2 + gr() * 0.2 : 0.1 + gr() * 0.12);
    grassEdge.push(edge);
  };
  // 石板缝（0.75 m 错缝网格）：草丛主要长在缝里
  for (let i = 0; i < 150; i++) {
    const row = 1 + Math.floor(gr() * 36);
    const z = row * 0.75 + (gr() - 0.5) * 0.12;
    const off = (row % 2) * 0.375;
    const x = (-13 + Math.floor(gr() * 27)) * 0.75 + off + (gr() - 0.5) * 0.12;
    if (x < -9.6 || x > 9.6 || z < 0.8 || z > 28.2) continue;
    pushGrass(x, z);
  }
  for (let i = 0; i < 60; i++) pushGrass(-9.55 + gr() * 0.5, 1 + gr() * 27, true);
  for (let i = 0; i < 50; i++) pushGrass(9.0 + gr() * 0.55, 1 + gr() * 27, true);
  for (let i = 0; i < 30; i++) pushGrass(-9 + gr() * 18, 0.65 + gr() * 0.5, true);
  for (let i = 0; i < 24; i++) pushGrass(-9 + gr() * 18, 27.7 + gr() * 0.6, true);
  for (let i = 0; i < 50; i++) {
    const a = gr() * Math.PI * 2, rr = 1.45 + gr() * 0.9;
    pushGrass(WELL.x + Math.cos(a) * rr, WELL.z + Math.sin(a) * rr, true);
  }
  for (let i = 0; i < 12; i++) pushGrass(-8.5 + gr() * 17, 2 + gr() * 25);
  const grassCol = (): THREE.Color => {
    const gc = [[0.85, 0.88, 0.6], [1.0, 0.98, 0.68], [0.72, 0.8, 0.52], [1.0, 0.94, 0.62]];
    const c = gc[Math.floor(gr() * gc.length)];
    return new THREE.Color(c[0], c[1], c[2]);
  };
  // 兜底：十字 alpha 面片草丛（离线时）
  const gp1 = new THREE.PlaneGeometry(1, 1.2); gp1.translate(0, 0.6, 0);
  const gp2 = gp1.clone(); gp2.rotateY(HALF_PI);
  const grassGeo = mergeGeometries([gp1, gp2], false)!;
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, grassPos.length);
  const grassXf: THREE.Matrix4[] = [];
  {
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ss = new THREE.Vector3();
    for (let i = 0; i < grassPos.length; i++) {
      const s = grassH[i] / 1.2;
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), gr() * Math.PI);
      ss.set(s, s, s);
      mm.compose(new THREE.Vector3(grassPos[i][0], grassPos[i][1], -grassPos[i][2]), qq, ss);
      grassXf.push(mm.clone());
      grassMesh.setMatrixAt(i, mm);
      grassMesh.setColorAt(i, grassCol());
    }
    grassMesh.castShadow = true;
    grassMesh.receiveShadow = true;
    group.add(grassMesh);
  }
  // 真实草丛模型（Poly Haven grass_medium_01，CC0）：gltf 里并排放着 17 个变体（共 24.7k 三角）。
  // 按节点拆成变体、每个实例只画一个变体，每个变体一个 InstancedMesh：
  // 石缝/空地用 tiny/small（30–830 三角），墙脚/井边用 mid（1.3k–2.3k），large 不用。
  trackPending(new Promise<void>((resolve) => {
    new GLTFLoader().load('models/grass_medium_01/grass_medium_01.gltf', (gltf) => {
      const small: THREE.BufferGeometry[] = [], mid: THREE.BufferGeometry[] = [];
      let mat: THREE.Material | null = null;
      gltf.scene.traverse((o) => {
        const me = o as THREE.Mesh;
        if (!me.isMesh) return;
        const bucket = /_(tiny|small)_/.test(me.name) ? small : /_mid_/.test(me.name) ? mid : null;
        if (!bucket) return;
        const g = me.geometry.clone();
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        g.computeBoundingBox();
        bucket.push(g);
        if (!mat) mat = me.material as THREE.Material;
      });
      if (!small.length || !mid.length || !mat) { resolve(); return; }
      const gm = mat as THREE.MeshStandardMaterial;
      gm.alphaTest = 0.4;
      gm.side = THREE.DoubleSide;
      gm.roughness = 0.9;
      const variants = [...small, ...mid];
      const picks: number[][] = variants.map(() => []);
      for (let i = 0; i < grassXf.length; i++) {
        const pool = grassEdge[i] ? mid : small;
        const base = grassEdge[i] ? small.length : 0;
        picks[base + Math.floor(gr() * pool.length)].push(i);
      }
      const mm = new THREE.Matrix4(), sc = new THREE.Matrix4();
      variants.forEach((geo, v) => {
        if (!picks[v].length) return;
        const h0 = geo.boundingBox!.max.y - geo.boundingBox!.min.y || 1;
        const im = new THREE.InstancedMesh(geo, gm, picks[v].length);
        picks[v].forEach((i, k) => {
          // 兜底矩阵的缩放是 h/1.2；模型按 h/h0 重新缩放
          const s = 1.2 / h0;
          sc.makeScale(s, s, s);
          mm.copy(grassXf[i]).multiply(sc);
          im.setMatrixAt(k, mm);
          im.setColorAt(k, grassCol());
        });
        im.castShadow = false; // 草丛太小，阴影贴图里只有噪点；接触暗部交给 GTAO
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      });
      group.remove(grassMesh);
      resolve();
    }, undefined, () => resolve());
  }));

  // 枯木（ENV-07）：递归分枝，探出墙头
  const branch = (x: number, y: number, z: number, len: number, ang: number, tilt: number, depth: number): void => {
    const geo = new THREE.CylinderGeometry(0.03 * depth + 0.02, 0.05 * depth + 0.03, len, 5);
    const dx = Math.sin(ang) * Math.sin(tilt), dy = Math.cos(tilt), dz = Math.cos(ang) * Math.sin(tilt);
    decal.geo(bark, geo, x + dx * len / 2, y + dy * len / 2, z + dz * len / 2, ang, tilt, 0);
    if (depth <= 0) return;
    const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
    branch(ex, ey, ez, len * 0.68, ang + 0.5, tilt + 0.35, depth - 1);
    branch(ex, ey, ez, len * 0.6, ang - 0.6, tilt + 0.5, depth - 1);
  };
  branch(-13.5, 0, 21, 4.5, 0.3, 0.12, 3);
  branch(12.5, 0, 31, 3.8, 2.4, 0.18, 3);
  // PROPS 里的瓦砾堆（碰撞盒）归环境层：实例化石块
  for (const p of PROPS) {
    if (p.tag !== 'rubble') continue;
    for (let i = 0; i < 7; i++) {
      const s = 0.28 + ((i * 37) % 10) / 28;
      rubbleXf.push({ x: p.x0 + 0.2 + ((i * 53) % 10) / 12, y: s * 0.5, z: p.z0 + 0.2 + ((i * 71) % 10) / 12, s, r: i });
    }
  }
  // 额外瓦砾堆
  for (const [bx, bz] of [[8.5, 22], [-8, 3.5]]) {
    for (let i = 0; i < 6; i++) {
      const s = 0.2 + ((i * 31) % 10) / 30;
      rubbleXf.push({ x: bx + ((i * 53) % 10) / 11, y: s * 0.5, z: bz + ((i * 71) % 10) / 11, s, r: i + 3 });
    }
  }
  // 瓦砾实例化
  {
    const geo = scaleUV(new THREE.DodecahedronGeometry(1, 0), 1 / 1.2);
    const im = new THREE.InstancedMesh(geo, m.stone, rubbleXf.length);
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler();
    rubbleXf.forEach((t, i) => {
      ee.set(t.r * 0.7, t.r * 1.3, t.r * 0.4);
      qq.setFromEuler(ee);
      mm.compose(new THREE.Vector3(t.x, t.y, -t.z), qq, new THREE.Vector3(t.s, t.s * 0.8, t.s));
      im.setMatrixAt(i, mm);
      const k = 0.5 + ((i * 29) % 10) / 30;
      im.setColorAt(i, new THREE.Color(k, k, k * 1.04));
    });
    im.castShadow = im.receiveShadow = true;
    group.add(im);
  }
  // 铁件下方石面的锈色流痕（故事层）
  const rustMat = new THREE.MeshStandardMaterial({ map: rustTexture(), roughness: 0.9, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [x, z, y, h, rot] of [[-9.95, 14, 1.95, 1.1, HALF_PI], [9.95, 10, 1.5, 1.0, -HALF_PI], [9.95, 20, 1.5, 1.0, -HALF_PI], [9.95, 5.1, 1.4, 1.2, -HALF_PI], [9.95, 6.9, 1.4, 1.2, -HALF_PI]] as [number, number, number, number, number][]) {
    decal.geo(rustMat, new THREE.PlaneGeometry(0.5, h), x, y, z, rot);
  }

  // 散落的秋叶：实例化单叶，墙脚 / 藤下 / 井台周围成片
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 1, alphaTest: 0.4, side: THREE.DoubleSide });
  const lr = drng(307);
  const leafPos: [number, number][] = [];
  for (let i = 0; i < 45; i++) leafPos.push([-9.4 + lr() * 2.4, 3.5 + lr() * 6]);
  for (let i = 0; i < 40; i++) leafPos.push([-9.4 + lr() * 2.6, 17 + lr() * 6.5]);
  for (let i = 0; i < 30; i++) {
    const a = lr() * Math.PI * 2, rr = 1.5 + lr() * 1.8;
    leafPos.push([WELL.x + Math.cos(a) * rr, WELL.z + Math.sin(a) * rr]);
  }
  for (let i = 0; i < 60; i++) leafPos.push([-9 + lr() * 18, 1 + lr() * 27]);
  const leafGeo = new THREE.PlaneGeometry(1, 1, 3, 3);
  {
    const lp = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setZ(i, 0.12 * lp.getX(i) * lp.getX(i) + 0.08 * lp.getY(i) * lp.getY(i));
    leafGeo.computeVertexNormals();
  }
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, leafPos.length);
  {
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler();
    const lc = [0xa8642a, 0x7a2a1c, 0x5e1a1a, 0x8a4a20].map((h) => new THREE.Color(h));
    for (let i = 0; i < leafPos.length; i++) {
      const s = 0.12 + lr() * 0.15;
      ee.set(-HALF_PI + (lr() - 0.5) * 0.3, 0, lr() * Math.PI * 2);
      qq.setFromEuler(ee);
      mm.compose(new THREE.Vector3(leafPos[i][0], 0.02 + lr() * 0.02, -leafPos[i][1]), qq, new THREE.Vector3(s, s, s));
      leafMesh.setMatrixAt(i, mm);
      leafMesh.setColorAt(i, lc[Math.floor(lr() * lc.length)].clone().multiplyScalar(0.7 + lr() * 0.6));
    }
    leafMesh.receiveShadow = true;
    group.add(leafMesh);
  }

  // 陈设、井台、木桶：见 furniture.ts（与地表/墙体分开，便于并行打磨）
  group.add(buildFurniture(m));

  b.build(group, true);
  far.build(group, false);
  decal.build(group, false);
  return { group, windowMat, hearthWindowMat };
}
