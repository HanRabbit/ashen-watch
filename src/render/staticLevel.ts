// 静态建筑：墙、地面、屋顶、地标与不随状态变化的陈设。按材质合并为少量网格。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PROPS, RAISED_Y, WALLS, WELL } from '../sim/level';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { archHeader, archLeaf, archRib, Batch, gable } from './geom';
import { buildFurniture } from './furniture';
import { variants } from './materialVariants';
import { grassTexture, ivyLeafTexture, leadedGlass, leafTexture, Materials, mossTexture, rugTexture, rustTexture, scaleUV, smokeTexture, tiledBox, trackPending } from './materials';

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

  const v = variants(m);
  // 世界空间 UV + 每段随机偏移：打破长墙平铺重复（圣经 5.1 反重复）
  const boxOff = (mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile: number, ou: number, ov: number): void => {
    const g = tiledBox(x1 - x0, y1 - y0, z1 - z0, tile);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + ou, uv.getY(i) + ov);
    b.geo(mat, g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); // Batch.geo 内部已对 z 取负，此处传模拟坐标
  };

  // 墙体：按区域选材质族（5.1）。勒脚/压顶用 wallTrim，幕墙 wallRubble，礼拜堂/门房外墙 wallAshlar，地窖 wallRough。
  for (const w of WALLS) {
    if (w.y0 !== undefined) continue; // map: 带 y0 的三层几何由 floors.ts 绘制
    const isChapel = w.h >= 7;
    const isGH = w.tag === 'gh';
    const isCellar = w.tag === 'cellar';
    const mat = isCellar ? v.wallRough : (isChapel || isGH) ? v.wallAshlar : v.wallRubble;
    const ou = ((Math.round(w.x0 * 7 + w.z0 * 13) % 10) / 10) * 3.1;
    const ov = ((Math.round(w.x1 * 5 + w.z1 * 3) % 10) / 10) * 2.3;
    boxOff(mat, w.x0, w.z0, w.x1, w.z1, 0, w.h, 4.5, ou, ov);
    b.box(v.wallTrim, w.x0 - 0.08, w.z0 - 0.08, w.x1 + 0.08, w.z1 + 0.08, 0, 0.35, 2.2); // 勒脚
    if (w.h >= 5) b.box(v.wallTrim, w.x0 - 0.05, w.z0 - 0.05, w.x1 + 0.05, w.z1 + 0.05, w.h - 0.12, w.h, 2.2); // 压顶
    if (w.h === 5 && w.tag !== 'cellar' && !(w.x0 === 10.5 && w.z0 === 17.5)) merlons(merlonXf, w.x0, w.z0, w.x1, w.z1, w.h);
  }
  merlons(merlonXf, -10.5, 0, -3.6, 0.5, 4.2);
  merlons(merlonXf, 3.6, 0, 10.5, 0.5, 4.2);
  // 垛口实例化：单位倒角盒 + 每实例缩放/朝向（wallTrim 细凿大石）
  {
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0); shape.lineTo(0.5, 0); shape.lineTo(0.5, 1); shape.lineTo(-0.5, 1); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1, curveSegments: 1 });
    geo.translate(0, 0, -0.5);
    scaleUV(geo, 1 / 2.2);
    const im = new THREE.InstancedMesh(geo, v.wallTrim, merlonXf.length);
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

  // 长墙打断（5.1：宽 > 6 m 用壁柱/补砌打断）：庭院西/东/南墙加壁柱 + 粗石补砌段
  {
    const pil = (x: number, z: number, nx: number, nz: number, h: number): void => {
      const w = 0.5, out = 0.16;
      const x0 = nx !== 0 ? Math.min(x, x + nx * out) - (nz !== 0 ? w / 2 : 0) : x - w / 2;
      const x1 = nx !== 0 ? Math.max(x, x + nx * out) + (nz !== 0 ? w / 2 : 0) : x + w / 2;
      const z0 = nz !== 0 ? Math.min(z, z + nz * out) - (nx !== 0 ? w / 2 : 0) : z - w / 2;
      const z1 = nz !== 0 ? Math.max(z, z + nz * out) + (nx !== 0 ? w / 2 : 0) : z + w / 2;
      b.box(v.wallTrim, x0, z0, x1, z1, 0.35, h, 2.2);
      b.box(v.wallTrim, x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, h - 0.1, h + 0.08, 2.2); // 柱帽
    };
    for (const z of [7, 14, 21]) pil(-10, z, 1, 0, 4.2);   // 西墙内面
    for (const z of [10, 17, 24]) pil(10, z, -1, 0, 5);    // 东墙内面
    for (const x of [-7, 7]) pil(x, 0.5, 0, 1, 4.2);       // 南墙内面
    // 粗石补砌段（风化修补，材质变化打断重复）
    b.box(v.wallRough, -10.02, 9.5, -9.9, 12.5, 0.35, 3.2, 2.6);
    b.box(v.wallRough, 9.9, 19, 10.02, 22, 0.35, 3.6, 2.6);
    b.box(v.wallRough, -4.5, 0.48, -1.5, 0.6, 0.35, 2.8, 2.6);
  }

  // 庭院四角与门房角的凸出角石（wallTrim）
  for (const [x, z, h] of [[-10.25, 0.25, 4.2], [10.25, 0.25, 4.2], [-10.25, 28.75, 4.2], [10.25, 28.75, 3.2], [-3.25, -8.25, 3.6], [3.25, -8.25, 3.6]] as [number, number, number][]) {
    quoin(b, v.wallTrim, x, z, h);
  }
  // 墙面少量突出石块（风化鼓出），只在庭院可见面
  {
    const r = drng(401);
    const faces: [number, number, number, number, number][] = [
      [-10, 14.5, 1, 0, 28], [10, 13, -1, 0, 25], [0, 0.5, 0, 1, 20], [13, 13, -1, 0, 23],
    ];
    for (const [fx, fz, nx, nz, len] of faces) {
      for (let i = 0; i < 9; i++) {
        const t = (r() - 0.5) * len;
        const y = 0.7 + r() * 3.4;
        const w = 0.26 + r() * 0.22, h = 0.18 + r() * 0.14, out = 0.05 + r() * 0.06;
        const x = fx + (nz !== 0 ? t : 0), z = fz + (nx !== 0 ? t : 0);
        if (nz !== 0 && Math.abs(x) < 3.6) continue;
        const bx = fx - nx * 0.06, bz = fz - nz * 0.06;
        const x0 = nx !== 0 ? Math.min(bx, bx + nx * (out + 0.06)) : x - w / 2;
        const x1 = nx !== 0 ? Math.max(bx, bx + nx * (out + 0.06)) : x + w / 2;
        const z0 = nz !== 0 ? Math.min(bz, bz + nz * (out + 0.06)) : z - w / 2;
        const z1 = nz !== 0 ? Math.max(bz, bz + nz * (out + 0.06)) : z + w / 2;
        b.box(v.wallRubble, x0, z0, x1, z1, y, y + h, 1.6);
      }
    }
  }

  // 门房内墙：全部石墙（concept/02，圣经 v2.8）——下半 wallRubble + 上半 wallAshlar，不用抹灰
  {
    const gh = (x0: number, z0: number, x1: number, z1: number): void => {
      b.box(v.wallRubble, x0, z0, x1, z1, 0.05, 1.5, 3.2);
      b.box(v.wallAshlar, x0, z0, x1, z1, 1.5, 3.5, 2.6);
      b.box(v.wallTrim, x0, z0, x1, z1, 1.46, 1.54, 2.2); // 石腰线
    };
    gh(-3.0, -8.0, -2.94, 0.0);   // 西内墙
    gh(2.94, -8.0, 3.0, 0.0);     // 东内墙
    gh(-3.0, -8.0, 3.0, -7.94);   // 北内墙（后墙）
  }

  // 门洞上方的尖拱过梁 / 券石框（wallTrim 细凿大石）
  b.geo(v.wallTrim, archHeader(1.6, 1.9, 2.6, 4.2, 0.5), 0, 0, 0.25);
  b.geo(v.wallTrim, archHeader(1.8, 2.0, 2.8, 5, 0.5), 10.25, 0, 6, HALF_PI);
  b.geo(v.wallTrim, archHeader(2, 2.3, 3.5, 5 - R, 0.5), 10.25, R, 27, HALF_PI);
  b.geo(v.wallTrim, archHeader(1.8, 2.2, 3.2, 7 - R, 0.5), 19, R, 25.25);
  b.geo(v.wallTrim, archHeader(1.6, 1.9, 2.6, 7 - R, 0.5), 13.25, R, 16, HALF_PI);
  b.geo(v.wallTrim, archHeader(2, 2.2, 3.0, 4.5 - R, 0.4), 15.2, R, 20.8);
  archFrame(b, v.wallTrim, 0, 0.25, 1.6, 1.9, 2.6, 0);
  archFrame(b, v.wallTrim, 10.25, 6, 1.8, 2.0, 2.8, -HALF_PI);
  archFrame(b, v.wallTrim, 10.25, 27, 2, 2.3, 3.5, -HALF_PI, R);
  archFrame(b, v.wallTrim, 19, 25.25, 1.8, 2.2, 3.2, Math.PI, R);
  archFrame(b, v.wallTrim, 13.25, 16, 1.6, 1.9, 2.6, -HALF_PI, R);

  // 地面分区（5.1）：主路 floorFlag 大石板，边缘 floorFlagWorn，井台/侧廊 floorCobble，墙脚 floorDirt 过渡带。
  b.box(m.gravel, -90, -70, 90, 110, -0.6, -0.04, 3);
  // 庭院地面单块 floorFlag：着色器内按世界 x + 噪声遮罩混合主路（monastery 不规则大石板）↔边缘（stone_pavers 旧石板），
  // 过渡带 0.8–1.5 m 不规则边界 + 泥土点缀，消除直缝（5.1 第 4 条）。
  b.box(v.floorFlag, -10.5, 0, 10.5, 29, -0.3, 0, 3.6);
  b.box(v.floorCobble, WELL.x - 2.3, WELL.z - 2.3, WELL.x + 2.3, WELL.z + 2.3, -0.3, 0.004, 1.6); // 井台一圈卵石
  b.box(v.floorCobble, 10.5, 1.5, 13, 17.5, -0.3, 0.004, 1.6); // 侧廊卵石
  // 墙脚泥土落叶过渡带（0.7 m，微微抬高避免 z-fight，落叶/草覆盖接缝）
  b.box(v.floorDirt, -10, 0.5, -9.3, 28.5, -0.3, 0.006, 2);
  b.box(v.floorDirt, 9.3, 0.5, 10, 28.5, -0.3, 0.006, 2);
  b.box(v.floorDirt, -10, 0.5, 10, 1.2, -0.3, 0.006, 2);
  b.box(v.floorDirt, -10, 27.8, 10, 28.5, -0.3, 0.006, 2);
  // 门房室内石板（concept/02）+ 中央织纹地毯（单幅图案 + 流苏破边 + 磨损污渍）
  b.box(v.floorInterior, -3.5, -8.5, 3.5, 0, -0.3, 0.005, 2);
  {
    const rug = rugTexture();
    const rugMat = new THREE.MeshPhysicalMaterial({
      map: rug.map, normalMap: rug.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
      color: 0xffffff, roughness: 0.95, metalness: 0,
      sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x6a4a3a),
      alphaTest: 0.4, side: THREE.DoubleSide,
    });
    b.geo(rugMat, new THREE.PlaneGeometry(2.6, 3.6), 0, 0.02, -4.4, 0, -HALF_PI, 0);
  }
  b.box(v.floorFlag, 13, 7.5, 25, 25.5, -0.3, R, 3.6);
  b.box(v.floorFlag, 10, 25.5, 25, 29, -0.3, R, 3.6);
  // 矮台阶（三级，每级 0.15 m）：外廊尖拱前、礼拜堂侧门前（wallTrim）
  for (let i = 0; i < 3; i++) {
    b.box(v.wallTrim, 8.6 + (i * 1.4) / 3, 25.5, 10, 28.5, 0, (R * (i + 1)) / 3);
    b.box(v.wallTrim, 12 + i / 3, 15.2, 13, 16.8, 0, (R * (i + 1)) / 3);
  }

  // 门房：木屋顶、山墙、粗壮横梁 + 斜撑托架（concept/02 厚重木构）
  const ghAng = Math.atan2(2, 3.9);
  b.geo(m.roof, tiledBox(4.55, 0.16, 10, 1.2), 1.95, 4.62, -4, 0, 0, -ghAng);
  b.geo(m.roof, tiledBox(4.55, 0.16, 10, 1.2), -1.95, 4.62, -4, 0, 0, ghAng);
  b.geo(v.woodBeam, gable(7.4, 2.0, 0.4), 0, 3.6, -8.25);
  b.geo(v.woodBeam, gable(7.4, 1.7, 0.4), 0, 3.9, 0.25);
  for (const z of [-6.6, -4.1, -1.6]) {
    b.box(v.woodBeam, -3.2, z - 0.16, 3.2, z + 0.16, 3.22, 3.6, 1); // 粗壮方料横梁
    b.geo(v.woodBeam, archRib(6.0, 0.72, 0.22), 0, 2.5, z); // 方料木拱肋（concept/02）
    // 梁端铁箍 + 铁钉（圣经 2 木构铁件）
    for (const sx of [-1, 1]) {
      b.geo(m.iron, new THREE.TorusGeometry(0.15, 0.022, 6, 12), sx * 2.85, 2.5, z, HALF_PI);
      b.geo(m.iron, new THREE.SphereGeometry(0.03, 6, 5), sx * 2.85, 2.62, z + 0.13);
      b.geo(m.iron, new THREE.SphereGeometry(0.03, 6, 5), sx * 2.85, 2.38, z - 0.13);
      const geo = tiledBox(0.16, 0.9, 0.16, 1);
      b.geo(v.woodBeam, geo, sx * 2.75, 2.85, z, 0, 0, sx * 0.7); // 斜撑托架
    }
  }
  b.box(v.woodBeam, -0.14, -8.4, 0.14, 0.4, 5.35, 5.66, 1); // 脊檩
  // 门房外檐：挂晨钟的木托架
  b.box(v.woodBeam, 1.5, 0.5, 1.66, 1.75, 2.95, 3.11, 1);
  b.box(v.woodBeam, 2.74, 0.5, 2.9, 1.75, 2.95, 3.11, 1);
  b.box(v.woodBeam, 1.4, 1.02, 3.0, 1.18, 3.11, 3.27, 1);
  b.geo(m.roof, tiledBox(1.9, 0.08, 1.5, 1.2), 2.2, 3.5, 1.2, 0, 0.3, 0);

  // 北墙木构挑檐 / 托架（concept/03 左上角前景框）：粗壮方料挑檐 + 斜撑，沿北墙顶伸出 ~1 m
  {
    const zWall = 28.5, yTop = 4.6;
    b.box(v.woodBeam, -10.3, zWall - 0.1, 10.3, zWall + 0.1, yTop, yTop + 0.22, 1); // 沿墙顶梁
    b.box(v.woodBeam, -10.3, zWall - 1.05, 10.3, zWall - 0.85, yTop + 0.1, yTop + 0.3, 1); // 挑檐外缘檩
    b.box(v.woodBeam, -10.3, zWall - 1.0, 10.3, zWall, yTop + 0.28, yTop + 0.34, 1.2); // 檐口木板
    for (let x = -9.5; x <= 9.5; x += 1.6) {
      b.box(v.woodBeam, x - 0.1, zWall - 1.0, x + 0.1, zWall, yTop + 0.05, yTop + 0.2, 1); // 挑椽
      const geo = tiledBox(0.14, 1.15, 0.14, 1);
      b.geo(v.woodBeam, geo, x, yTop - 0.5, zWall - 0.5, 0.78, 0, 0); // 斜撑托架（绕 x 轴斜向墙面）
    }
  }

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

  // 爬藤：从墙脚往上爬的主茎 + 簇生叶（红褐-酒红-少量橙黄，圣经 4.2）。主簇北墙（画面左墙）。
  // 主茎贴墙蜿蜒、偶有分枝；叶成簇、上密下疏、边缘破碎、前后分层；只在墙脚/门洞边/背阴处。
  const ivyR = drng(131);
  const ivyMat = new THREE.MeshStandardMaterial({ map: ivyLeafTexture(), roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.45 });
  const ivyPalette = [0x7a2a1c, 0x5e1a1a, 0x6b2418, 0x4a1616, 0xa8642a, 0x3a3a20].map((h) => new THREE.Color(h));
  interface Patch { bx: number; bz: number; nx: number; nz: number; tx: number; tz: number; u0: number; u1: number; top: number; dens: number }
  const patches: Patch[] = [
    { bx: 0, bz: 28.44, nx: 0, nz: -1, tx: 1, tz: 0, u0: -9.5, u1: -0.5, top: 4.8, dens: 1.0 }, // 北墙主簇（壁灯旁，成片攀爬，画面视觉元素）
    { bx: 0, bz: 28.42, nx: 0, nz: -1, tx: 1, tz: 0, u0: -9, u1: -1, top: 4.0, dens: 0.95 }, // 北墙主簇填充层
    { bx: 0, bz: 28.44, nx: 0, nz: -1, tx: 1, tz: 0, u0: 1.5, u1: 8, top: 3.2, dens: 0.9 },     // 北墙次簇
    { bx: -9.94, bz: 0, nx: 1, nz: 0, tx: 0, tz: 1, u0: 4, u1: 10, top: 3.8, dens: 0.9 },      // 西墙
    { bx: -9.94, bz: 0, nx: 1, nz: 0, tx: 0, tz: 1, u0: 18, u1: 24, top: 3.4, dens: 0.85 },      // 西墙北段
    { bx: 0, bz: 0.56, nx: 0, nz: 1, tx: 1, tz: 0, u0: -8, u1: -4, top: 3.0, dens: 0.85 },       // 南墙门洞边
    { bx: 9.94, bz: 0, nx: -1, nz: 0, tx: 0, tz: 1, u0: 18, u1: 24, top: 3.5, dens: 0.82 },     // 东墙背阴
    { bx: 12.94, bz: 0, nx: -1, nz: 0, tx: 0, tz: 1, u0: 9, u1: 13, top: 4.2, dens: 0.65 },      // 礼拜堂西墙脚
  ];
  const ivyPos: THREE.Vector3[] = [];
  const ivyQuat: THREE.Quaternion[] = [];
  const ivyScale: number[] = [];
  const ivyCol: THREE.Color[] = [];
  const qTmp = new THREE.Quaternion();
  const eTmp = new THREE.Euler();
  const pushLeaf = (px: number, py: number, pz: number, yaw: number, nx: number, nz: number, scale: number): void => {
    const out = 0.03 + ivyR() * 0.24; // 前后分层：贴墙到外探
    ivyPos.push(new THREE.Vector3(px + nx * out, py, -(pz + nz * out)));
    eTmp.set((ivyR() - 0.5) * 1.4, (ivyR() - 0.5) * 1.4, ivyR() * Math.PI * 2);
    qTmp.setFromEuler(eTmp);
    ivyQuat.push(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(qTmp));
    ivyScale.push(scale);
    // 降饱和：以红褐/酒红为主（圣经 4.2），橙黄少量；亮度克制避免艳红
    const c = ivyPalette[ivyR() < 0.05 ? 4 : ivyR() < 0.1 ? 5 : Math.floor(ivyR() * 4)];
    ivyCol.push(c.clone().multiplyScalar(0.7 + ivyR() * 0.3));
  };
  for (const pa of patches) {
    const yaw = Math.atan2(pa.nx, pa.nz);
    const roots = Math.max(3, Math.round((pa.u1 - pa.u0) / (pa.dens >= 0.95 ? 0.7 : 1.0)));
    for (let s = 0; s < roots; s++) {
      // 主簇间距随机化（非等距）：有的墙面光秃、有的成片
      const uRoot = pa.u0 + ivyR() * (pa.u1 - pa.u0);
      const vigor = pa.dens >= 0.95 ? 0.7 + ivyR() * 0.3 : 0.35 + ivyR() * 0.65; // 主簇更密，其余稀疏随机
      const phase = ivyR() * 6.28, amp = 0.18 + ivyR() * 0.3;
      const top = pa.top * (0.82 + ivyR() * 0.22);
      // 主茎从墙脚攀爬
      for (let y = 0.06; y < top; y += 0.11) {
        const t = y / top;
        const u = uRoot + Math.sin(y * 1.3 + phase) * amp * (0.4 + t) + (ivyR() - 0.5) * 0.08;
        const px = pa.bx + pa.tx * u, pz = pa.bz + pa.tz * u;
        decal.geo(bark, new THREE.BoxGeometry(0.02, 0.15, 0.02), px + pa.nx * 0.025, y, pz + pa.nz * 0.025, yaw, (ivyR() - 0.5) * 0.25, (ivyR() - 0.5) * 0.25);
        // 上密下疏 + 顶端破碎 + 每株长势不一：密度随高度上升，顶梢 ragged
        const densEff = pa.dens * vigor * (0.55 + 0.45 * t) * (t > 0.9 ? 0.55 : 1);
        if (ivyR() > densEff) continue; // 裸茎节点（gaps）
        const n = 5 + Math.floor(ivyR() * 6);
        const rad = 0.14 + ivyR() * 0.16;
        for (let l = 0; l < n; l++) {
          const du = (ivyR() - 0.5) * rad * 2, dv = (ivyR() - 0.5) * rad * 1.6;
          pushLeaf(px + pa.tx * du, y + dv, pz + pa.tz * du, yaw, pa.nx, pa.nz, 0.12 + ivyR() * 0.08); // 叶片缩小到 ~1/2
        }
        // 偶有分枝向外探出再缀叶
        if (ivyR() < 0.28) {
          const bu = u + (ivyR() - 0.5) * 0.6, by = y + 0.1 + ivyR() * 0.2;
          const bpx = pa.bx + pa.tx * bu, bpz = pa.bz + pa.tz * bu;
          decal.geo(bark, new THREE.BoxGeometry(0.015, 0.3, 0.015), bpx + pa.nx * 0.1, by, bpz + pa.nz * 0.1, yaw, 0.6, 0);
          for (let l = 0; l < 6; l++) pushLeaf(bpx + pa.tx * (ivyR() - 0.5) * 0.34, by + (ivyR() - 0.5) * 0.3, bpz + pa.tz * (ivyR() - 0.5) * 0.34, yaw, pa.nx, pa.nz, 0.12 + ivyR() * 0.07);
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
    grassH.push(edge ? 0.26 + gr() * 0.22 : 0.16 + gr() * 0.16);
    grassEdge.push(edge);
  };
  // 石缝枯草：成簇（每簇 1–3 株），克制数量，只在缝里
  for (let i = 0; i < 70; i++) {
    const row = 1 + Math.floor(gr() * 36);
    const z = row * 0.75 + (gr() - 0.5) * 0.12;
    const off = (row % 2) * 0.375;
    const x = (-13 + Math.floor(gr() * 27)) * 0.75 + off + (gr() - 0.5) * 0.12;
    if (x < -9.6 || x > 9.6 || z < 0.8 || z > 28.2) continue;
    const n = 1 + Math.floor(gr() * 3);
    for (let k = 0; k < n; k++) pushGrass(x + (gr() - 0.5) * 0.18, z + (gr() - 0.5) * 0.18);
  }
  // 墙脚成簇枯草（北墙主簇区加密）
  for (let i = 0; i < 45; i++) pushGrass(-9.55 + gr() * 0.55, 1 + gr() * 27, true);
  for (let i = 0; i < 40; i++) pushGrass(9.0 + gr() * 0.55, 1 + gr() * 27, true);
  for (let i = 0; i < 28; i++) pushGrass(-9 + gr() * 18, 0.65 + gr() * 0.5, true);
  for (let i = 0; i < 44; i++) pushGrass(-9 + gr() * 18, 27.6 + gr() * 0.7, true);
  for (let i = 0; i < 42; i++) {
    const a = gr() * Math.PI * 2, rr = 1.45 + gr() * 1.0;
    pushGrass(WELL.x + Math.cos(a) * rr, WELL.z + Math.sin(a) * rr, true);
  }
  // 枯黄绿（圣经 4.2，不得鲜绿）：干草色调乘到草模型上
  const grassCol = (): THREE.Color => {
    const gc = [[0.78, 0.74, 0.46], [0.88, 0.82, 0.52], [0.62, 0.64, 0.40], [0.82, 0.76, 0.48]];
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
      gm.color.setHex(0xb8b090); // 压成枯草色，避免鲜绿（圣经 4.2）
      const variants = [...small, ...mid];
      const picks: number[][] = variants.map(() => []);
      for (let i = 0; i < grassXf.length; i++) {
        const pool = grassEdge[i] ? mid : small;
        const base = grassEdge[i] ? small.length : 0;
        const poolN = Math.min(pool.length, 3); // 限制变体数，控制 draw calls
        picks[base + Math.floor(gr() * poolN)].push(i);
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
  // 铁件下方石面的锈色流痕（水造成，沿重力；壁灯支架/栅门铰链/铁箍下）
  const rustMat = new THREE.MeshStandardMaterial({ map: rustTexture(), roughness: 0.9, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [x, z, y, h, rot] of [[-9.95, 14, 1.95, 1.1, HALF_PI], [9.95, 10, 1.5, 1.0, -HALF_PI], [9.95, 20, 1.5, 1.0, -HALF_PI], [9.95, 5.1, 1.4, 1.2, -HALF_PI], [9.95, 6.9, 1.4, 1.2, -HALF_PI], [-5, 28.44, 2.6, 1.3, 0], [5.5, 0.56, 1.6, 1.1, Math.PI]] as [number, number, number, number, number][]) {
    decal.geo(rustMat, new THREE.PlaneGeometry(0.5, h), x, y, z, rot);
  }
  // 火与烟：壁灯上方扇形烟熏（北墙新灯位）、门房炉口上方熏黑（向上扩散、边缘渐淡）
  const sootMat = new THREE.MeshStandardMaterial({ map: smokeTexture(), color: 0x0b0b0d, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  decal.geo(sootMat, new THREE.PlaneGeometry(1.5, 2.2), -5, 3.5, 28.43, 0);          // 北墙壁灯上方
  decal.geo(sootMat, new THREE.PlaneGeometry(1.6, 2.0), -2.93, 2.7, -4.4, HALF_PI);  // 门房炉口上方（西内墙）
  decal.geo(sootMat, new THREE.PlaneGeometry(1.2, 1.4), -2.6, 3.4, -4.4, HALF_PI);   // 烟道熏黑

  // 散落秋叶（圣经 4.2 橙红）：墙脚/藤下/井边/墙角成堆，开放地面少量。叶片放大到可见。
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 0.9, alphaTest: 0.4, side: THREE.DoubleSide });
  const lr = drng(307);
  const leafPos: [number, number][] = [];
  for (let i = 0; i < 55; i++) leafPos.push([-8.5 + lr() * 7, 26.4 + lr() * 1.9]);   // 北墙藤下堆
  for (let i = 0; i < 35; i++) leafPos.push([-9.6 + lr() * 1.7, 3.5 + lr() * 6]);    // 西墙脚
  for (let i = 0; i < 30; i++) leafPos.push([-9.6 + lr() * 1.7, 17 + lr() * 6.5]);
  for (let i = 0; i < 36; i++) {
    const a = lr() * Math.PI * 2, rr = 1.5 + lr() * 1.7;
    leafPos.push([WELL.x + Math.cos(a) * rr, WELL.z + Math.sin(a) * rr]);            // 井边堆
  }
  for (const [cx, cz] of [[-9, 27.3], [-9, 1.6], [9, 1.6], [9, 27.3]] as [number, number][]) {
    for (let i = 0; i < 14; i++) leafPos.push([cx + (lr() - 0.5) * 1.6, cz + (lr() - 0.5) * 1.6]); // 墙角堆
  }
  for (let i = 0; i < 26; i++) leafPos.push([-9 + lr() * 18, 1.5 + lr() * 26]);      // 开放地面少量
  const leafGeo = new THREE.PlaneGeometry(1, 1, 3, 3);
  {
    const lp = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setZ(i, 0.12 * lp.getX(i) * lp.getX(i) + 0.08 * lp.getY(i) * lp.getY(i));
    leafGeo.computeVertexNormals();
  }
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, leafPos.length);
  {
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler();
    const lc = [0xa8642a, 0x7a2a1c, 0x5e1a1a, 0x8a4a20, 0x9a3a20].map((h) => new THREE.Color(h));
    for (let i = 0; i < leafPos.length; i++) {
      const s = 0.16 + lr() * 0.17;
      ee.set(-HALF_PI + (lr() - 0.5) * 0.35, 0, lr() * Math.PI * 2);
      qq.setFromEuler(ee);
      mm.compose(new THREE.Vector3(leafPos[i][0], 0.02 + lr() * 0.03, -leafPos[i][1]), qq, new THREE.Vector3(s, s, s));
      leafMesh.setMatrixAt(i, mm);
      leafMesh.setColorAt(i, lc[Math.floor(lr() * lc.length)].clone().multiplyScalar(0.9 + lr() * 0.5));
    }
    leafMesh.receiveShadow = true;
    group.add(leafMesh);
  }

  // 陈设、井台、木桶：见 furniture.ts（与地表/墙体分开，便于并行打磨）
  group.add(buildFurniture(m));

  b.build(group, true);
  far.build(group, false);
  decal.build(group, false);
  // 高窗昼夜驱动：读 scene.userData.night（view.ts 写入）。白天微弱冷天光，夜晚近黑（礼拜堂内无灯）。
  group.traverse((o) => {
    const me = o as THREE.Mesh;
    if (me.isMesh && me.material === windowMat) {
      me.onBeforeRender = (_r, scene) => {
        const night = (scene.userData.night ?? 0) as number;
        windowMat.emissive.setHex(night > 0.5 ? 0x0c1420 : 0x3a4a5c);
        windowMat.emissiveIntensity = night > 0.5 ? 0.18 : 0.45;
      };
    }
  });
  return { group, windowMat, hearthWindowMat };
}
