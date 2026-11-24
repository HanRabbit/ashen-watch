// 地标（art pass 2）：礼拜堂哥特化。只加视觉，不改碰撞。
// 坐标约定与 staticLevel 一致：Batch 接收模拟坐标 (x, y, z)，渲染 z 取负。
import * as THREE from 'three';
import { RAISED_Y } from '../sim/level';
import { archBand, archHeader, archLeaf, Batch } from './geom';
import { Materials, scaleUV, tiledBox } from './materials';
import { variants } from './materialVariants';
import { mountRodin } from './rodinAssets';
import { chapelGlass, finishChapelGlazing, glazedWall, type Light } from './chapelWindows';

const R = RAISED_Y;
const HALF_PI = Math.PI / 2;

export interface Landmarks {
  group: THREE.Group;
}

/** 小尖塔：八角塔身 + 卷叶饰 + 尖锥 + 顶珠。y0 为基座底。 */
function pinnacle(b: Batch, mat: THREE.Material, x: number, z: number, y0: number, scale = 1): void {
  const s = scale;
  b.geo(mat, scaleUV(new THREE.CylinderGeometry(0.3 * s, 0.34 * s, 2.0 * s, 8), 0.5), x, y0 + 1.0 * s, z);
  b.geo(mat, scaleUV(new THREE.CylinderGeometry(0.38 * s, 0.3 * s, 0.22 * s, 8), 0.5), x, y0 + 2.05 * s, z);
  // 卷叶饰（crocket）：塔身四角的小钩状凸饰
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.geo(mat, new THREE.ConeGeometry(0.07 * s, 0.22 * s, 4), x + Math.cos(a) * 0.3 * s, y0 + 1.55 * s, z + Math.sin(a) * 0.3 * s, a);
  }
  b.geo(mat, scaleUV(new THREE.ConeGeometry(0.32 * s, 1.7 * s, 8), 0.5), x, y0 + 3.0 * s, z);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.geo(mat, new THREE.ConeGeometry(0.05 * s, 0.16 * s, 4), x + Math.cos(a) * 0.2 * s, y0 + 2.6 * s, z + Math.sin(a) * 0.2 * s, a);
  }
  b.geo(mat, new THREE.SphereGeometry(0.08 * s, 6, 5), x, y0 + 3.9 * s, z);
}

/** 十字架顶饰。 */
function cross(b: Batch, mat: THREE.Material, x: number, z: number, y0: number, h: number): void {
  b.box(mat, x - 0.06, z - 0.06, x + 0.06, z + 0.06, y0, y0 + h, 0.5);
  b.box(mat, x - 0.05, z - 0.3 * h * 0.5, x + 0.05, z + 0.3 * h * 0.5, y0 + h * 0.62, y0 + h * 0.74, 0.5);
}

/** 扶壁：三级收分 + 斜压顶 + 小尖顶。朝西（-x）出挑。 */
function buttress(b: Batch, mat: THREE.Material, z: number, tall: boolean): void {
  const top = tall ? 10.9 : 8.2;
  b.box(mat, 12.55, z - 0.42, 13.0, z + 0.42, 0, 4.2);
  b.box(mat, 12.7, z - 0.34, 13.0, z + 0.34, 4.2, 7.4);
  b.box(mat, 12.82, z - 0.28, 13.0, z + 0.28, 7.4, top);
  // 斜压顶
  b.geo(mat, tiledBox(0.5, 0.16, 0.8, 0.6), 12.78, top + 0.1, z, 0, 0, 0.5);
  if (tall) pinnacle(b, mat, 12.9, z, top + 0.15, 0.9);
  else b.geo(mat, new THREE.ConeGeometry(0.3, 0.9, 4), 12.9, top + 0.6, z, Math.PI / 4);
}

export function buildLandmarks(m: Materials, skyIrradiance: THREE.Color): Landmarks {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const b = new Batch();
  // 材质族（圣经 5.1）：立面/侧墙 ashlar，门窗套/券石/扶壁/线脚/尖塔/台阶/压顶 trim，墙基/补砌 rough。
  const v = variants(m);
  const ash = v.wallAshlar, trim = v.wallTrim, rough = v.wallRough;
  const woodPlank = v.woodPlank, woodBeam = v.woodBeam;

  const { glass: glassMat, lead } = chapelGlass(skyIrradiance);
  const windowFabric = { ash, trim, iron: m.iron, glass: glassMat, lead };
  const narrow = (u: number): Light => ({ u, sill: 0.53, width: 1.25, spring: 1.54, height: 2.65, pattern: 'pair' });
  const waxMat = new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.85 });
  const ribbonMat = new THREE.MeshStandardMaterial({ color: 0x6e5a48, roughness: 1, side: THREE.DoubleSide });
  const ribbonRed = new THREE.MeshStandardMaterial({ color: 0x5b1f24, roughness: 1, side: THREE.DoubleSide });
  const crowMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.9 });

  // The authored west long wall faces south after the landmark rotation.
  // One continuous perforated wall per bay: no overlapping panels or cross-eave over the panes.
  glazedWall(b, windowFabric, { x: 13.25, z: 12.55, y: 7, rot: -HALF_PI, width: 10.1, eaves: 4,
    lights: [9.6, 12.4, 15.2].map(z => narrow(12.55 - z)) });
  b.box(ash, 13, 23.4, 13.5, 25.5, 7, 11);
  b.geo(trim, archBand(1.0, 1.7, 2.7, 0.1, 0.1), 13.0, 7.8, 24.45, HALF_PI);
  glazedWall(b, windowFabric, { x: 13.25, y: 7, z: 20.5, rot: -HALF_PI, width: 5.8, eaves: 4, peak: 7.8,
    lights: [{ u: 0, sill: 0.9, width: 3.36, spring: 2.93, height: 5.68, pattern: 'great' }] });
  // 山墙压顶（两条斜脊）
  const bayAng = Math.atan2(3.8, 2.9);
  const baySlope = Math.hypot(3.8, 2.9) + 0.3;
  b.geo(trim, tiledBox(0.7, 0.2, baySlope, 0.6), 13.25, 12.95, 19.05, 0, bayAng, 0);
  b.geo(trim, tiledBox(0.7, 0.2, baySlope, 0.6), 13.25, 12.95, 21.95, 0, -bayAng, 0);
  cross(b, trim, 13.25, 20.5, 14.75, 1.1);
  // bay 两侧小尖塔落在扶壁上（见 buttress tall）

  // ——— 西 bay 礼仪正门（视觉主角，对标 concept/03 中央立面）———
  // 封闭的双开木门 + 铁件：旧礼仪入口，现由侧门通行（叙事：被遗弃的要塞）。
  // 门洞 recessed，两层退缩罩拱 + 门侧束柱，门前多级石阶与侧挡墙。
  b.geo(rough, scaleUV(archLeaf(2.5, 2.35, 3.55, 0.05), 0.4), 13.34, R, 20.5, HALF_PI); // 洞内暗背
  b.geo(woodPlank, scaleUV(archLeaf(2.2, 2.2, 3.4, 0.07), 0.5), 13.2, R, 20.5, HALF_PI); // 双开门扇
  b.box(rough, 13.15, 20.46, 13.24, 20.54, R, R + 3.3); // 中缝
  // 铁箍横带 + 门环 + 铆钉（每扇三条）
  for (const [z0, z1] of [[19.45, 20.44], [20.56, 21.55]] as [number, number][]) {
    for (const y of [R + 0.55, R + 1.5, R + 2.45]) {
      b.box(m.iron, 13.13, z0, 13.19, z1, y - 0.05, y + 0.05, 0.6);
      for (let i = 0; i < 4; i++) b.geo(m.iron, new THREE.SphereGeometry(0.035, 5, 4), 13.12, y, z0 + 0.12 + i * ((z1 - z0 - 0.24) / 3));
    }
    b.geo(m.iron, new THREE.TorusGeometry(0.11, 0.022, 5, 10), 13.12, R + 1.5, (z0 + z1) / 2, HALF_PI); // 门环
    b.geo(m.iron, new THREE.SphereGeometry(0.05, 6, 5), 13.13, R + 1.62, (z0 + z1) / 2); // 环座
  }
  // 两层退缩罩拱 + 束柱
  b.geo(trim, archBand(2.2, 2.2, 3.4, 0.16, 0.2), 12.95, R, 20.5, HALF_PI);
  b.geo(trim, archBand(2.6, 2.4, 3.7, 0.14, 0.18), 12.86, R, 20.5, HALF_PI);
  for (const dz of [-1.28, 1.28]) {
    b.geo(trim, new THREE.CylinderGeometry(0.09, 0.1, 2.4, 8), 12.92, R + 1.2, 20.5 + dz);
    b.geo(trim, new THREE.CylinderGeometry(0.14, 0.16, 0.14, 8), 12.92, R + 2.45, 20.5 + dz);
  }
  // 门前多级石阶（三级）+ 两侧挡墙（斜压顶）
  for (let i = 0; i < 3; i++) {
    const x1 = 13.0 - i * 0.35, x0 = x1 - 0.35;
    b.box(trim, x0, 19.2, x1, 21.8, 0, R * (3 - i) / 3);
  }
  for (const z of [19.0, 21.8]) {
    b.box(trim, 11.95, z, 13.0, z + 0.22, 0, 0.62);
    b.geo(trim, tiledBox(1.15, 0.12, 0.3, 0.6), 12.48, 0.66, z + 0.11, 0, 0, 0.28);
  }
  // 门与玫瑰窗之间的腰线 + 盲拱四叶饰，打破空白墙
  b.box(trim, 12.9, 17.8, 13.12, 23.2, 4.95, 5.15);
  b.geo(trim, archBand(1.2, 1.0, 1.8, 0.1, 0.1), 12.98, 5.4, 20.5, HALF_PI);

  // Authored north gable = actual west door / yard hero. The flanks are real
  // pierced lancets, not strips in front of an uncut ashlar wall.
  glazedWall(b, windowFabric, { x: 19, y: 7, z: 25.25, rot: Math.PI, width: 11, eaves: 4, peak: 9.2, lights: [
    { u: 0, sill: 0.90, width: 4, spring: 3.10, height: 6.10, pattern: 'great' },
    ...[-3.68, 3.68].map((u): Light => ({ u, sill: 0.94, width: 0.89, spring: 1.54, height: 2.44, pattern: 'single' })),
  ] });
  // 山墙压顶 + 十字
  const nAng = Math.atan2(5.2, 5.5);
  const nSlope = Math.hypot(5.2, 5.5) + 0.35;
  b.geo(trim, tiledBox(nSlope, 0.2, 0.7, 0.6), 16.25, 13.6, 25.25, 0, 0, nAng);
  b.geo(trim, tiledBox(nSlope, 0.2, 0.7, 0.6), 21.75, 13.6, 25.25, 0, 0, -nAng);
  cross(b, trim, 19, 25.25, 16.15, 1.25);
  // 立面两端角塔
  // A lower, chipped crocket catches the rake of the sun on the gate side.
  for (const [x, height, angle] of [[13.75, 3.27, 0.94], [24.25, 3.94, -1.48]]) {
    const original = new Batch();
    pinnacle(original, trim, x, 25.25, 11, 1.05);
    const fallback = new THREE.Group();
    original.build(fallback);
    mountRodin(group, 'chapel-pinnacle', fallback, v.rock, model => {
      const bounds = new THREE.Box3().setFromObject(model);
      const scale = height / (bounds.max.y - bounds.min.y);
      model.scale.setScalar(scale);
      model.rotation.y = angle;
      model.position.set(x, 10.95 - bounds.min.y * scale, -25.25);
    });
  }
  // 山墙坡面小尖塔
  pinnacle(b, trim, 16.1, 25.25, 13.15, 0.6);
  pinnacle(b, trim, 21.9, 25.25, 13.15, 0.6);
  // The opening in the sim wall is rectangular; this infill closes the head above
  // the leaves. The archivolts are open-bottom bands, so neither triangles nor a
  // porch intersect the passage or float in front of the hinge when the door opens.
  b.geo(ash, archHeader(1.8, 2.2, 3.2, 6.55, 0.5), 19, R, 25.25);
  for (const [w, spring, peak, ring, z] of [
    [1.85, 2.2, 3.22, 0.21, 25.55],
    [2.27, 2.37, 3.51, 0.23, 25.7],
    [2.74, 2.52, 3.84, 0.21, 25.83],
  ]) b.geo(trim, archBand(w, spring, peak, ring, 0.3), 19, R, z);
  for (const dx of [-1.43, -1.17, 1.17, 1.43]) {
    b.geo(trim, new THREE.CylinderGeometry(0.11, 0.14, 0.16, 8), 19 + dx, R + 0.08, 25.93);
    b.geo(trim, new THREE.CylinderGeometry(0.075, 0.09, 2.25, 8), 19 + dx, R + 1.29, 25.93);
    b.geo(trim, new THREE.CylinderGeometry(0.13, 0.1, 0.17, 8), 19 + dx, R + 2.48, 25.93);
  }
  b.box(trim, 17.1, 25.58, 20.9, 25.95, R - 0.02, R + 0.07);
  b.box(rough, 17.04, 25.94, 20.96, 26.23, R - 0.03, R + 0.035);
  // 北立面扶壁（出挑 0.45，贴墙）
  for (const x of [13.75, 24.25]) {
    b.box(trim, x - 0.4, 25.5, x + 0.4, 25.95, 0, 7.4);
    b.box(trim, x - 0.32, 25.5, x + 0.32, 25.85, 7.4, 11);
    b.geo(trim, tiledBox(0.8, 0.16, 0.6, 0.6), x, 11.05, 25.7, 0, 0.4, 0);
  }

  // ——— 东墙与南墙高窗层 + 南山墙 ———
  glazedWall(b, windowFabric, { x: 24.75, y: 7, z: 16.5, rot: HALF_PI, width: 18, eaves: 4,
    lights: [9.3, 12.1, 15.2, 20.4, 24.6].map(z => narrow(z - 16.5)) });
  glazedWall(b, windowFabric, { x: 19, y: 7, z: 7.75, rot: 0, width: 11.6, eaves: 4, peak: 9.2,
    lights: [{ u: 0, sill: 0.92, width: 2.28, spring: 2.54, height: 4.42, pattern: 'pair' }] });
  b.geo(trim, tiledBox(nSlope, 0.2, 0.7, 0.6), 16.25, 13.6, 7.75, 0, 0, nAng);
  b.geo(trim, tiledBox(nSlope, 0.2, 0.7, 0.6), 21.75, 13.6, 7.75, 0, 0, -nAng);
  cross(b, trim, 19, 7.75, 16.15, 1.0);
  // ——— 勒脚（墙基粗石，凸出墙面）+ 水平腰线/壁柱：打断连续墙面（≤6 m）并给出结构层次 ———
  b.box(rough, 12.8, 7.5, 13.0, 25.5, 0, 0.55);   // 西勒脚
  b.box(rough, 13, 25.5, 25, 25.7, 0, 0.55);      // 北勒脚
  b.box(rough, 25, 7.5, 25.2, 25.5, 0, 0.55);     // 东勒脚
  b.box(rough, 13, 7.3, 25, 7.5, 0, 0.55);        // 南勒脚
  b.box(trim, 12.88, 7.6, 13.0, 17.5, 5.0, 5.2);  // 西腰线
  b.box(trim, 13.2, 25.5, 24.8, 25.62, 5.0, 5.2); // 北腰线
  b.box(trim, 25, 7.6, 25.12, 25.4, 5.0, 5.2);    // 东腰线
  for (const x of [16.6, 21.4]) b.box(trim, x - 0.25, 25.5, x + 0.25, 25.66, 0.55, 7.0); // 北壁柱

  // ——— 陡峭石板瓦屋顶（屋脊 ~16.2 m）———
  const roofAng = Math.atan2(5.6, 5.8);
  const roofSlope = Math.hypot(5.6, 5.8) + 0.35;
  b.geo(m.roof, tiledBox(roofSlope, 0.18, 19.0, 1.2), 21.9, 13.4, 16.5, 0, 0, -roofAng);
  // The tall side light needs an actual cross-gable, or the old continuous
  // roof slices the upper glass in half on the reverse view from the nave.
  const xEdge = 16.1 - 0.5 * roofSlope * Math.cos(roofAng), xRidge = 32.2 - xEdge;
  const mainY = (x: number) => 13.4 + (x - 16.1) * Math.tan(roofAng);
  const bayY = (z: number) => 14.78 - Math.abs(z - 20.5) * Math.tan(bayAng);
  const valley = (14.78 - mainY(xEdge)) / Math.tan(bayAng);
  const zL = 20.5 - valley, zR = 20.5 + valley, xMeet = 16.1 + (14.78 - 13.4) / Math.tan(roofAng);
  const roofPatch = (outline: [number, number][], y: (x: number, z: number) => number) => {
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.19, bevelEnabled: false });
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getY(i);
      pos.setXYZ(i, x, y(x, z) - 0.095 + pos.getZ(i), -z);
    }
    g.computeVertexNormals(); b.geo(m.roof, scaleUV(g, 1 / 1.2), 0, 0, 0);
  };
  roofPatch([[xEdge, 7], [xRidge, 7], [xRidge, 26], [xEdge, 26], [xEdge, zR], [xMeet, 20.5], [xEdge, zL]], mainY);
  roofPatch([[xEdge, zL], [xMeet, 20.5], [xEdge, 20.5]], (_, z) => bayY(z));
  roofPatch([[xEdge, 20.5], [xMeet, 20.5], [xEdge, zR]], (_, z) => bayY(z));
  b.box(trim, 18.82, 7.0, 19.18, 26.0, 16.05, 16.32); // 脊瓦
  // 檐口线脚
  for (const [a, z] of [[7.5, 17.6], [23.4, 25.5]]) b.box(trim, 12.8, a, 13.5, z, 10.45, 10.65);
  b.box(trim, 24.5, 7.5, 25.2, 25.5, 10.45, 10.65);

  // ——— 屋脊小尖塔（flèche）：八角鼓座 + 尖锥 + 十字，全庭院可见的导航地标 ———
  const fz = 20.5;
  b.geo(trim, scaleUV(new THREE.CylinderGeometry(0.72, 0.85, 1.5, 8), 0.5), 19, 16.95, fz);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
    b.geo(glassMat, new THREE.PlaneGeometry(0.17, 0.70), 19 + Math.cos(a) * 0.75, 16.95, fz + Math.sin(a) * 0.75, a + HALF_PI);
  }
  b.geo(m.roof, scaleUV(new THREE.ConeGeometry(0.95, 3.4, 8), 0.5), 19, 19.4, fz);
  for (let tier = 0; tier < 3; tier++) {
    const y = 18.1 + tier * 0.95, r = 0.72 - tier * 0.2;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + tier * 0.4;
      b.geo(trim, new THREE.ConeGeometry(0.06, 0.2, 4), 19 + Math.cos(a) * r, y, fz + Math.sin(a) * r, a);
    }
  }
  cross(b, m.iron, 19, fz, 21.05, 0.85);

  // ——— 西墙扶壁（含 bay 两侧高扶壁承小尖塔）———
  for (const z of [8.3, 11.9, 14.6]) buttress(b, trim, z, false);
  buttress(b, trim, 17.6, true);
  buttress(b, trim, 23.4, true);
  // 侧门罩拱（两层线脚）
  b.geo(trim, archBand(1.7, 2.0, 2.9, 0.15, 0.18), 13.0, R, 16, HALF_PI);
  b.geo(trim, archBand(2.1, 2.2, 3.2, 0.14, 0.14), 13.02, R, 16, HALF_PI);

  // ———  interior 系梁（高屋顶下的拉结木梁）———
  for (const z of [10.7, 13.5, 16.5, 17.85, 23.35]) b.box(woodBeam, 13.5, z - 0.12, 24.5, z + 0.12, 9.3, 9.55, 1);

  // ——— 任务 C：环境叙事 ———
  // 门前熄灭的烛台 ×2（蜡油堆，靠墙不挡门）
  for (const x of [16.4, 21.6]) {
    b.geo(m.iron, new THREE.CylinderGeometry(0.16, 0.22, 0.06, 8), x, R + 0.03, 25.72);
    b.geo(m.iron, new THREE.CylinderGeometry(0.03, 0.04, 1.0, 6), x, R + 0.55, 25.72);
    b.geo(m.iron, new THREE.CylinderGeometry(0.2, 0.14, 0.05, 8), x, R + 1.06, 25.72);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const cx = x + Math.cos(a) * 0.12, cz = 25.72 + Math.sin(a) * 0.12;
      b.geo(waxMat, new THREE.CylinderGeometry(0.03, 0.035, 0.12 + (i % 2) * 0.08, 6), cx, R + 1.15, cz);
      b.geo(waxMat, new THREE.SphereGeometry(0.045, 6, 5), cx + 0.02, R + 1.08, cz); // 蜡油
    }
    b.geo(waxMat, new THREE.SphereGeometry(0.09, 7, 5), x + 0.1, R + 0.02, 25.8); // 地上蜡油堆
  }
  // 褪色祈祷布条：挂在门洞外拱与西墙罩拱上
  for (const [x, y, z, red] of [[17.7, 3.3, 25.95, 1], [18.4, 3.6, 25.95, 0], [19.7, 3.55, 25.95, 1], [20.4, 3.25, 25.95, 0], [13.0, 2.6, 15.4, 1], [13.0, 2.5, 16.7, 0]] as [number, number, number, number][]) {
    b.geo(red ? ribbonRed : ribbonMat, new THREE.PlaneGeometry(0.09, 0.55), x, y - 0.27, z, red ? 0.2 : -0.15, 0, 0.06);
  }
  // 墙根瓦砾（庭院西墙外、礼拜堂南墙外——均不在通行区）
  for (const [bx, bz] of [[-11.4, 10], [-11.6, 20.5], [16.5, 6.6], [21, 6.4], [26.2, 12]] as [number, number][]) {
    for (let i = 0; i < 6; i++) {
      const s = 0.2 + ((i * 31) % 10) / 26;
      b.geo(rough, new THREE.DodecahedronGeometry(s, 0), bx + ((i * 53) % 10) / 9, s * 0.45 - 0.05, bz + ((i * 71) % 10) / 9, i);
    }
  }
  // 城垛与尖塔上的乌鸦（静态剪影）
  const crow = (x: number, y: number, z: number, rot: number): void => {
    b.geo(crowMat, scaleUV(new THREE.SphereGeometry(0.11, 7, 6), 1), x, y + 0.1, z, rot);
    b.geo(crowMat, new THREE.SphereGeometry(0.06, 6, 5), x + Math.sin(rot) * 0.1, y + 0.2, z + Math.cos(rot) * 0.1);
    b.geo(crowMat, new THREE.ConeGeometry(0.02, 0.08, 4), x + Math.sin(rot) * 0.16, y + 0.19, z + Math.cos(rot) * 0.16, rot, HALF_PI, 0);
    b.geo(crowMat, tiledBox(0.05, 0.02, 0.2, 0.2), x - Math.sin(rot) * 0.12, y + 0.12, z - Math.cos(rot) * 0.12, rot, 0.3, 0);
  };
  crow(10.25, 4.8, 11.5, 2.2);
  crow(10.25, 4.8, 19.2, -1.1);
  crow(12.9, 14.55, 23.4, 0.7);

  b.build(group, true);
  finishChapelGlazing(group, glassMat);

  // map: 礼拜堂转 90°，正门朝西面向庭院（构图对齐 concept/03）。
  // 旧占地 x13.5–24.5/z8–25 → 新占地 x13.5–30.5/z11–22。渲染 z=−sim.z。
  group.rotation.y = Math.PI / 2;
  group.position.set(38.5, 0, 2.5);
  return { group };
}

/**
 * 隐藏旧礼拜堂屋顶/山墙/钟架与旧远景圆锥。
 * staticLevel 的 Batch 按材质合并网格，无法按名字分离；这里按世界坐标 AABB
 * 逐三角形剔除（以三角形重心判定），只动旧几何，不影响碰撞。
 */
export function hideLegacy(levelGroup: THREE.Group): void {
  // 模拟坐标 AABB：[x0, x1, y0, y1, z0, z1]
  const boxes: [number, number, number, number, number, number][] = [
    [18.5, 25.7, 7.0, 11.1, 6.9, 26.1],   // 东坡旧瓦
    [12.3, 19.5, 7.0, 11.1, 6.9, 26.1],   // 西坡旧瓦（含补块）
    [12.5, 25.5, 7.0, 10.6, 24.95, 25.55], // 北旧山墙
    [12.5, 25.5, 7.0, 10.6, 7.45, 8.05],  // 南旧山墙
    [12.9, 13.6, 7.0, 10.5, 17.6, 24.4],  // 旧钟架山墙
    [12.9, 13.6, 10.1, 13.3, 20.2, 21.8], // 旧钟架立柱/小尖塔/十字
    [17.8, 20.2, 2.6, 4.8, 25.45, 25.85], // 旧正门罩拱
    [13.4, 24.6, 6.6, 7.05, 10.0, 23.2],  // 旧系梁
    [16.4, 21.6, 3.2, 4.3, 25.3, 29.1],   // 外廊披檐在门 bay 的开洞
    [16.3, 20.2, 3.1, 3.5, 25.4, 28.6],   // 开洞内的旧托梁
    // —— 构图对齐：礼拜堂转 90° 后，旧朝向的悬浮装饰剔除 ——
    [24.3, 24.6, 2.9, 5.8, 9.5, 23.5],    // 旧东墙高窗/窗棂（现悬于正厅内）
    [18.0, 20.0, 1.9, 6.6, 7.9, 8.2],     // 旧南山墙大窗
    [13.0, 13.4, 7.2, 10.0, 20.2, 21.8],  // 旧钟架高窗
    [12.9, 13.6, 3.2, 5.8, 9.1, 10.1],    // 旧西墙高窗 z9.6（新墙外）
    [12.9, 13.6, 3.2, 5.8, 22.5, 23.5],   // 旧西墙高窗 z23（新墙外）
    [18.0, 20.0, 0.0, 5.0, 25.0, 25.6],   // 旧正门尖拱过梁/门框
    [14.2, 16.2, 0.0, 4.5, 20.6, 21.0],   // 旧门厅隔墙拱（现悬于门厅）
    [8.5, 10.0, 0.0, 0.5, 25.4, 28.6],    // 旧外廊台阶
    [10.6, 25.1, 3.0, 4.3, 25.3, 29.1],   // 旧外廊披檐 + 托梁
  ];
  for (const z of [9, 12, 18.5, 23.5]) boxes.push([12.6, 13.1, 4.9, 7.3, z - 0.5, z + 0.5]); // 旧扶壁

  // 旧枯木（staticLevel 递归裸枝）探出墙头形成天际线"X"形漂浮物。
  // 裸枝与爬藤茎共用 bark 材质，无法整网格隐藏；这里复刻其分枝中心线，
  // 仅剔除 bark 网格中落在枝干半径内的三角形（含过墙枝梢），不伤墙体/垛口/爬藤。
  const segs: [number, number, number, number, number, number][] = [];
  const grow = (x: number, y: number, z: number, len: number, ang: number, tilt: number, depth: number): void => {
    const dx = Math.sin(ang) * Math.sin(tilt), dy = Math.cos(tilt), dz = Math.cos(ang) * Math.sin(tilt);
    const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
    segs.push([x, y, z, ex, ey, ez]);
    if (depth <= 0) return;
    grow(ex, ey, ez, len * 0.68, ang + 0.5, tilt + 0.35, depth - 1);
    grow(ex, ey, ez, len * 0.6, ang - 0.6, tilt + 0.5, depth - 1);
  };
  grow(-13.5, 0, 21, 4.5, 0.3, 0.12, 3);
  grow(12.5, 0, 31, 3.8, 2.4, 0.18, 3);
  // 兜底 AABB：礼拜堂西北角枯木过墙枝梢（门廊屋顶以上、山墙以西，无墙体几何）。
  boxes.push([11.9, 13.6, 6.9, 8.2, 26.6, 28.2]);
  const nearTree = (x: number, y: number, z: number): boolean => {
    for (const [ax, ay, az, bx, by, bz] of segs) {
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby + (z - az) * abz) / (abx * abx + aby * aby + abz * abz + 1e-9)));
      const px = ax + abx * t - x, py = ay + aby * t - y, pz = az + abz * t - z;
      if (px * px + py * py + pz * pz < 0.04) return true; // 半径 ~0.2（含较粗主干表面）
    }
    return false;
  };

  const inBox = (x: number, y: number, zSim: number): boolean => {
    for (const [x0, x1, y0, y1, z0, z1] of boxes) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && zSim >= z0 && zSim <= z1) return true;
    }
    return false;
  };

  levelGroup.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // 旧远景（灰色圆锥城堡）：staticLevel 中唯一的 MeshBasicMaterial 合并网格
    if ((mesh.material as THREE.Material).type === 'MeshBasicMaterial') {
      mesh.visible = false;
      return;
    }
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos || geo.index) return;
    const stdMat = mesh.material as THREE.MeshStandardMaterial;
    const isBark = stdMat.type === 'MeshStandardMaterial' && !!stdMat.color && stdMat.color.getHex() === 0x3a322c && !stdMat.map;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const keepP: number[] = [], keepN: number[] = [], keepU: number[] = [];
    let removed = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const cz = -(pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      if (inBox(cx, cy, cz) || (isBark && nearTree(cx, cy, cz))) { removed++; continue; }
      for (let k = 0; k < 3; k++) {
        keepP.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
        if (nor) keepN.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
        if (uv) keepU.push(uv.getX(i + k), uv.getY(i + k));
      }
    }
    if (!removed) return;
    if (keepP.length === 0) { mesh.visible = false; return; }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
    if (nor) ng.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
    if (uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(keepU, 2));
    mesh.geometry = ng;
    geo.dispose();
  });
}