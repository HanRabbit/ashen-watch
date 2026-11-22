// 静态建筑：墙、地面、屋顶、地标与不随状态变化的陈设。按材质合并为少量网格。
import * as THREE from 'three';
import { PROPS, RAISED_Y, WALLS, WELL } from '../sim/level';
import { archHeader, archLeaf, Batch, gable } from './geom';
import { Materials, scaleUV, tiledBox } from './materials';

const R = RAISED_Y;
const HALF_PI = Math.PI / 2;

export interface StaticLevel {
  group: THREE.Group;
  /** 高窗：白天透进冷光，夜里几乎全黑。 */
  windowMat: THREE.MeshStandardMaterial;
  /** 门房朝庭院的窗：炉火点着时透出琥珀色，是回程地标。 */
  hearthWindowMat: THREE.MeshStandardMaterial;
}

function merlons(b: Batch, mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y: number): void {
  const alongX = x1 - x0 > z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  const n = Math.max(1, Math.floor(len / 1.5));
  const stepLen = len / n;
  for (let i = 0; i < n; i++) {
    const c = (alongX ? x0 : z0) + stepLen * (i + 0.5);
    if (alongX) b.box(mat, c - 0.35, z0, c + 0.35, z1, y, y + 0.6);
    else b.box(mat, x0, c - 0.35, x1, c + 0.35, y, y + 0.6);
  }
}

export function buildStaticLevel(m: Materials): StaticLevel {
  const group = new THREE.Group();
  const b = new Batch();
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, emissive: 0xa9c0d6, emissiveIntensity: 0.9, roughness: 0.4 });
  const hearthWindowMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, emissive: 0xff9a3c, emissiveIntensity: 1.2, roughness: 0.5 });

  // 墙体
  for (const w of WALLS) {
    const mat = w.h >= 7 ? m.stoneDark : m.stone;
    b.box(mat, w.x0, w.z0, w.x1, w.z1, 0, w.h);
    if (w.h === 5 && w.tag !== 'cellar' && !(w.x0 === 10.5 && w.z0 === 17.5)) merlons(b, m.stone, w.x0, w.z0, w.x1, w.z1, w.h);
  }
  merlons(b, m.stone, -10.5, 0, -3.6, 0.5, 4.2);
  merlons(b, m.stone, 3.6, 0, 10.5, 0.5, 4.2);

  // 门洞上方的尖拱过梁
  b.geo(m.stone, archHeader(1.6, 1.9, 2.6, 4.2, 0.5), 0, 0, 0.25);
  b.geo(m.stone, archHeader(1.8, 2.0, 2.8, 5, 0.5), 10.25, 0, 6, HALF_PI);
  b.geo(m.stone, archHeader(2, 2.3, 3.5, 5 - R, 0.5), 10.25, R, 27, HALF_PI);
  b.geo(m.stoneDark, archHeader(1.8, 2.2, 3.2, 7 - R, 0.5), 19, R, 25.25);
  b.geo(m.stoneDark, archHeader(1.6, 1.9, 2.6, 7 - R, 0.5), 13.25, R, 16, HALF_PI);
  b.geo(m.stoneDark, archHeader(2, 2.2, 3.0, 4.5 - R, 0.4), 15.2, R, 20.8);

  // 地面
  b.box(m.gravel, -90, -70, 90, 110, -0.6, -0.04, 3);
  b.box(m.flag, -10.5, 0, 10.5, 29, -0.3, 0, 2.4);
  b.box(m.woodFloor, -3.5, -8.5, 3.5, 0, -0.3, 0.005, 1.6);
  b.box(m.gravel, 10.5, 1.5, 13, 17.5, -0.3, 0.004, 2);
  b.box(m.flag, 13, 7.5, 25, 25.5, -0.3, R, 2.4);
  b.box(m.flag, 10, 25.5, 25, 29, -0.3, R, 2.4);
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
  // 扶壁
  for (const z of [9, 12, 18.5, 23.5]) b.box(m.stoneDark, 12.75, z - 0.35, 13, z + 0.35, 5, 6.6);

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

  // 井台：石圈、立柱、小棚顶
  b.geo(m.stone, scaleUV(new THREE.CylinderGeometry(WELL.r, WELL.r, 0.9, 14, 1, true), 2), WELL.x, 0.45, WELL.z);
  b.geo(m.stone, scaleUV(new THREE.RingGeometry(WELL.r - 0.35, WELL.r, 14), 2), WELL.x, 0.9, WELL.z, 0, -HALF_PI);
  b.geo(m.stoneDark, new THREE.CylinderGeometry(WELL.r - 0.35, WELL.r - 0.35, 0.9, 14, 1, true), WELL.x, 0.45, WELL.z);
  b.box(m.wood, WELL.x - 1.2, WELL.z - 0.09, WELL.x - 1.02, WELL.z + 0.09, 0.9, 2.5, 1);
  b.box(m.wood, WELL.x + 1.02, WELL.z - 0.09, WELL.x + 1.2, WELL.z + 0.09, 0.9, 2.5, 1);
  b.geo(m.wood, new THREE.CylinderGeometry(0.09, 0.09, 2.3, 8), WELL.x, 2.0, WELL.z, 0, 0, HALF_PI);
  b.geo(m.roof, tiledBox(1.7, 0.1, 2.2, 1), WELL.x - 0.72, 2.85, WELL.z, 0, 0, 0.55);
  b.geo(m.roof, tiledBox(1.7, 0.1, 2.2, 1), WELL.x + 0.72, 2.85, WELL.z, 0, 0, -0.55);

  // 地下封门：砌死的石拱，只作预告
  b.geo(m.stoneDark, archLeaf(1.7, 1.5, 2.3, 0.12), 11.75, 0, 2.04);
  b.geo(m.iron, tiledBox(1.9, 0.1, 0.06, 1), 11.75, 1.1, 2.12);
  b.geo(m.iron, tiledBox(0.1, 2.0, 0.06, 1), 11.75, 1.0, 2.12);

  // 不随状态变化的陈设（碰撞盒见 level.ts 的 PROPS）
  for (const p of PROPS) {
    const y0 = p.x0 >= 13 || p.z0 >= 25.5 ? R : 0;
    switch (p.tag) {
      case 'hearth': {
        // 壁炉：两侧石柱、炉台、烟罩，炉膛朝东敞开
        b.box(m.stone, p.x0, p.z0, p.x1, p.z0 + 0.45, 0, 1.5);
        b.box(m.stone, p.x0, p.z1 - 0.45, p.x1, p.z1, 0, 1.5);
        b.box(m.stoneDark, p.x0, p.z0 + 0.45, p.x0 + 0.2, p.z1 - 0.45, 0, 1.5);
        b.box(m.stoneDark, p.x0, p.z0 + 0.45, p.x1 + 0.25, p.z1 - 0.45, 0, 0.22);
        b.box(m.stone, p.x0, p.z0 - 0.1, p.x1 + 0.2, p.z1 + 0.1, 1.5, 1.85);
        b.box(m.stone, p.x0, p.z0 + 0.3, p.x1 - 0.15, p.z1 - 0.3, 1.85, 3.5);
        break;
      }
      case 'pot':
        b.box(m.stoneDark, p.x0, p.z0, p.x1, p.z1, 0, 0.3);
        break;
      case 'woodpile':
        for (let i = 0; i < 7; i++) {
          const row = i < 4 ? 0 : 1;
          const k = i < 4 ? i : i - 4 + 0.5;
          b.geo(m.wood, new THREE.CylinderGeometry(0.12, 0.12, 0.75, 7), p.x0 + 0.4, 0.13 + row * 0.22, p.z0 + 0.17 + k * 0.25, 0, 0, HALF_PI);
        }
        break;
      case 'bench':
        b.box(m.wood, p.x0, p.z0, p.x1, p.z1, 0.82, 0.95, 1);
        for (const [dx, dz] of [[0.08, 0.08], [0.08, 2.0], [0.62, 0.08], [0.62, 2.0]]) {
          b.box(m.wood, p.x0 + dx, p.z0 + dz, p.x0 + dx + 0.1, p.z0 + dz + 0.1, 0, 0.82, 1);
        }
        b.box(m.wood, p.x0 + 0.1, p.z0 + 0.2, p.x1 - 0.05, p.z0 + 0.95, 0.02, 0.5, 1);
        b.box(m.wood, 2.72, p.z0 + 0.1, 3, p.z1 - 0.1, 1.75, 1.8, 1);
        break;
      case 'cot':
        b.box(m.wood, p.x0, p.z0, p.x1, p.z1, 0.18, 0.34, 1);
        b.box(m.cloth, p.x0 + 0.05, p.z0 + 0.05, p.x1 - 0.05, p.z1 - 0.05, 0.34, 0.48, 1);
        b.box(m.cloth, p.x1 - 0.5, p.z0 + 0.15, p.x1 - 0.1, p.z1 - 0.15, 0.48, 0.58, 1);
        for (const x of [p.x0, p.x1 - 0.1]) b.box(m.wood, x, p.z0, x + 0.1, p.z1, 0, 0.6, 1);
        break;
      case 'stool':
        b.geo(m.wood, new THREE.CylinderGeometry(0.28, 0.28, 0.07, 10), 1.8, 0.71, -6.3);
        for (const a of [0.5, 2.6, 4.7]) b.geo(m.wood, new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), 1.8 + Math.cos(a) * 0.18, 0.35, -6.3 + Math.sin(a) * 0.18);
        break;
      case 'shelf':
        for (const y of [0.35, 1.0, 1.65]) b.box(m.wood, p.x0, p.z0, p.x1, p.z1, y, y + 0.07, 1);
        for (const z of [p.z0, p.z1 - 0.1]) {
          b.box(m.wood, p.x0, z, p.x0 + 0.1, z + 0.1, 0, 1.9, 1);
          b.box(m.wood, p.x1 - 0.1, z, p.x1, z + 0.1, 0, 1.9, 1);
        }
        break;
      case 'crates':
        b.box(m.wood, p.x0, p.z0, p.x0 + 0.75, p.z0 + 0.75, 0, 0.75, 0.8);
        b.box(m.wood, p.x0 + 0.5, p.z0 + 0.6, p.x1, p.z1, 0, 0.6, 0.8);
        b.geo(m.wood, new THREE.CylinderGeometry(0.34, 0.3, 0.85, 10), p.x0 + 0.4, 1.17, p.z0 + 0.4);
        break;
      case 'rubble':
        for (let i = 0; i < 7; i++) {
          const s = 0.28 + ((i * 37) % 10) / 28;
          b.geo(m.stone, new THREE.DodecahedronGeometry(s, 0), p.x0 + 0.2 + ((i * 53) % 10) / 12, s * 0.5, p.z0 + 0.2 + ((i * 71) % 10) / 12, i);
        }
        break;
      case 'crate':
        b.box(m.wood, p.x0, p.z0, p.x1, p.z1, y0, y0 + p.h, 0.8);
        break;
      case 'flaskTable':
        b.box(m.wood, p.x0, p.z0, p.x1, p.z1, y0 + 0.78, y0 + 0.86, 1);
        for (const [dx, dz] of [[0.05, 0.05], [0.05, 0.65], [0.65, 0.05], [0.65, 0.65]]) {
          b.box(m.wood, p.x0 + dx, p.z0 + dz, p.x0 + dx + 0.1, p.z0 + dz + 0.1, y0, y0 + 0.78, 1);
        }
        break;
      case 'altar':
        b.box(m.stoneDark, p.x0, p.z0, p.x1, p.z1, y0, y0 + 0.2);
        b.box(m.stone, p.x0 + 0.15, p.z0 + 0.12, p.x1 - 0.15, p.z1 - 0.12, y0 + 0.2, y0 + 0.95);
        b.box(m.stoneDark, p.x0, p.z0, p.x1, p.z1, y0 + 0.95, y0 + 1.1);
        break;
      case 'brazier': break; // 由 props.ts 画（随状态变化）
      case 'pew':
        b.box(m.wood, p.x0, p.z0 + 0.15, p.x1, p.z1, y0 + 0.4, y0 + 0.47, 1);
        b.box(m.wood, p.x0, p.z0, p.x1, p.z0 + 0.1, y0, y0 + 0.9, 1);
        for (const x of [p.x0, p.x1 - 0.08]) b.box(m.wood, x, p.z0, x + 0.08, p.z1, y0, y0 + 0.47, 1);
        break;
    }
  }
  // 点缀：残旗、麻袋、空桶、跪凳
  b.geo(m.banner, new THREE.PlaneGeometry(0.9, 1.9), -1.6, 2.2, -7.96);
  b.geo(m.banner, new THREE.PlaneGeometry(1.0, 2.6), 9.96, 3.2, 18, HALF_PI);
  b.geo(m.cloth, new THREE.SphereGeometry(0.3, 8, 6), -2.4, 0.25, -0.9);
  b.geo(m.cloth, new THREE.SphereGeometry(0.26, 8, 6), -1.9, 0.22, -0.7);
  b.geo(m.wood, new THREE.CylinderGeometry(0.33, 0.29, 0.8, 10), -9.2, 0.4, 9);
  b.box(m.wood, 18.2, 10.7, 19.8, 11.0, R, R + 0.14, 1);

  // 远景：只有轮廓的塔与山崖，没有可玩入口
  const far = new Batch();
  far.box(m.far, -52, 62, -34, 80, -5, 34);
  far.box(m.far, -49, 65, -37, 77, 34, 44);
  far.box(m.far, 38, 70, 48, 80, -5, 26);
  far.box(m.far, 39.5, 71.5, 46.5, 78.5, 26, 33);
  far.box(m.far, -90, 48, -58, 100, -5, 12);
  far.box(m.far, 55, 40, 95, 105, -5, 9);
  far.box(m.far, -30, 84, 34, 100, -5, 16);

  b.build(group, true);
  far.build(group, false);
  return { group, windowMat, hearthWindowMat };
}
