// 陈设（从 staticLevel.ts 拆出）：井台、门房/礼拜堂家具、木桶木箱、点缀小物。
// 碰撞盒在 sim/level.ts 的 PROPS / WELL，这里只画视觉，不得越出碰撞盒太多。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PROPS, RAISED_Y, WELL } from '../sim/level';
import { Batch } from './geom';
import { Materials, scaleUV, tiledBox, trackPending } from './materials';

const R = RAISED_Y;
const HALF_PI = Math.PI / 2;

function crateBox(b: Batch, m: Materials, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): void {
  b.box(m.wood, x0, z0, x1, z1, y0, y1, 0.9);
  const t = 0.07, o = 0.02;
  const w = x1 - x0, d = z1 - z0, h = y1 - y0;
  for (const [cx, cz] of [[x0 + t / 2, z0 + t / 2], [x1 - t / 2, z0 + t / 2], [x0 + t / 2, z1 - t / 2], [x1 - t / 2, z1 - t / 2]]) {
    b.box(m.wood, cx - t / 2, cz - t / 2, cx + t / 2, cz + t / 2, y0, y1, 0.9);
  }
  for (const y of [y0 + t / 2, y1 - t / 2]) {
    b.box(m.wood, x0 - o, z0 - o, x1 + o, z0 + t, y - t / 2, y + t / 2, 0.9);
    b.box(m.wood, x0 - o, z1 - t, x1 + o, z1 + o, y - t / 2, y + t / 2, 0.9);
    b.box(m.wood, x0 - o, z0, x0 + t, z1, y - t / 2, y + t / 2, 0.9);
    b.box(m.wood, x1 - t, z0, x1 + o, z1, y - t / 2, y + t / 2, 0.9);
  }
  // 斜撑：±z 面与 ±x 面各一根
  const diagZ = Math.hypot(w - 2 * t, h - 2 * t), angZ = Math.atan2(h - 2 * t, w - 2 * t);
  for (const z of [z0 - o - 0.012, z1 + o + 0.012]) {
    b.geo(m.wood, tiledBox(diagZ, 0.09, 0.025, 0.9), (x0 + x1) / 2, (y0 + y1) / 2, z, 0, 0, angZ);
  }
  const diagX = Math.hypot(d - 2 * t, h - 2 * t), angX = Math.atan2(h - 2 * t, d - 2 * t);
  for (const x of [x0 - o - 0.012, x1 + o + 0.012]) {
    b.geo(m.wood, tiledBox(diagX, 0.09, 0.025, 0.9), x, (y0 + y1) / 2, (z0 + z1) / 2, HALF_PI, 0, angX);
  }
}

export function buildFurniture(m: Materials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'furniture';
  const b = new Batch();
  const barrelSlots: { x: number; z: number; y0: number; h: number; ry: number }[] = [];

  // 井台：石圈、立柱、小棚顶
  b.geo(m.stone, scaleUV(new THREE.CylinderGeometry(WELL.r, WELL.r, 0.9, 14, 1, true), 2), WELL.x, 0.45, WELL.z);
  b.geo(m.stone, scaleUV(new THREE.RingGeometry(WELL.r - 0.35, WELL.r, 14), 2), WELL.x, 0.9, WELL.z, 0, -HALF_PI);
  b.geo(m.stoneDark, new THREE.CylinderGeometry(WELL.r - 0.35, WELL.r - 0.35, 0.9, 14, 1, true), WELL.x, 0.45, WELL.z);
  b.box(m.wood, WELL.x - 1.2, WELL.z - 0.09, WELL.x - 1.02, WELL.z + 0.09, 0.9, 2.5, 1);
  b.box(m.wood, WELL.x + 1.02, WELL.z - 0.09, WELL.x + 1.2, WELL.z + 0.09, 0.9, 2.5, 1);
  b.geo(m.wood, new THREE.CylinderGeometry(0.09, 0.09, 2.3, 8), WELL.x, 2.0, WELL.z, 0, 0, HALF_PI);
  b.geo(m.roof, tiledBox(1.7, 0.1, 2.2, 1), WELL.x - 0.72, 2.85, WELL.z, 0, 0, 0.55);
  b.geo(m.roof, tiledBox(1.7, 0.1, 2.2, 1), WELL.x + 0.72, 2.85, WELL.z, 0, 0, -0.55);
  // 井台：加宽基座、辘轳绳与吊桶
  b.geo(m.stoneDark, scaleUV(new THREE.CylinderGeometry(WELL.r + 0.18, WELL.r + 0.24, 0.16, 16), 2), WELL.x, 0.08, WELL.z);
  b.geo(m.cloth, new THREE.CylinderGeometry(0.015, 0.015, 1.0, 5), WELL.x + 0.3, 1.5, WELL.z);
  b.geo(m.wood, new THREE.CylinderGeometry(0.13, 0.1, 0.2, 8), WELL.x + 0.3, 0.95, WELL.z);
  b.geo(m.iron, new THREE.TorusGeometry(0.12, 0.012, 4, 8), WELL.x + 0.3, 1.05, WELL.z, 0, 0, HALF_PI);


  // 不随状态变化的陈设（碰撞盒见 level.ts 的 PROPS）
  for (const p of PROPS) {
    const y0 = p.y0 ?? (p.x0 >= 13 || p.z0 >= 25.5 ? R : 0); // map:
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
        crateBox(b, m, p.x0, p.z0, p.x0 + 0.75, p.z0 + 0.75, 0, 0.75);
        crateBox(b, m, p.x0 + 0.5, p.z0 + 0.6, p.x1, p.z1, 0, 0.6);
        barrelSlots.push({ x: p.x0 + 0.4, z: p.z0 + 0.4, y0: 0.75, h: 0.85, ry: 0.6 });
        break;
      case 'rubble': break; // 地表瓦砾属于环境，见 staticLevel.ts
      case 'crate':
        crateBox(b, m, p.x0, p.z0, p.x1, p.z1, y0, y0 + p.h);
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


  // —— 陈设点缀：木桶（鼓腹 + 铁箍，glTF 模型替换）、断柱、壁挂灯座、麻袋、货箱搭布 ——
  // 程序化兜底桶：车削鼓腹轮廓 + 两道铁箍；模型加载成功后原位替换
  const barrelFallbacks: THREE.Group[] = [];
  const addBarrel = (x: number, z: number, y0: number, h: number, ry = 0): void => {
    barrelSlots.push({ x, z, y0, h, ry });
  };
  const buildBarrelFallback = (slot: { x: number; z: number; y0: number; h: number; ry: number }): THREE.Group => {
    const { x, z, y0, h, ry } = slot;
    const g = new THREE.Group();
    const prof: THREE.Vector2[] = [];
    const rp = (t: number): number => 0.26 + 0.085 * Math.sin(t * Math.PI);
    for (let i = 0; i <= 8; i++) prof.push(new THREE.Vector2(rp(i / 8), (i / 8) * h));
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), m.wood);
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    for (const t of [0.14, 0.86]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(rp(t) + 0.008, 0.016, 5, 16), m.iron);
      hoop.rotation.x = HALF_PI; hoop.position.y = t * h;
      hoop.castShadow = true;
      g.add(hoop);
    }
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(rp(1) - 0.02, rp(1) - 0.02, 0.025, 14), m.wood);
    lid.position.y = h - 0.01; lid.castShadow = true;
    g.add(lid);
    g.position.set(x, y0, -z);
    g.rotation.y = ry;
    group.add(g);
    return g;
  };
  addBarrel(-8.6, 3.2, 0, 0.85, 0.4);
  addBarrel(-8.95, 4.5, 0, 0.8, 1.3);
  addBarrel(8.6, 21, 0, 0.85, 2.2);
  addBarrel(-9.2, 9, 0, 0.8, 0.9);
  for (const slot of barrelSlots) barrelFallbacks.push(buildBarrelFallback(slot));
  // 断柱与倒落的柱头
  b.geo(m.stone, scaleUV(new THREE.CylinderGeometry(0.34, 0.38, 0.75, 12), 1), 7, 0.375, 24);
  b.geo(m.stone, new THREE.CylinderGeometry(0.34, 0.34, 0.5, 12), 7.9, 0.34, 24.6, 0, 0, HALF_PI);
  b.box(m.stoneDark, 6.4, 23.4, 7.0, 24.0, 0, 0.3);
  // 东墙装饰灯座（未点）
  for (const z of [10, 20]) {
    b.box(m.iron, 9.8, z - 0.06, 9.95, z + 0.06, 2.0, 2.5);
    b.geo(m.iron, new THREE.CylinderGeometry(0.1, 0.06, 0.1, 8), 9.72, 2.1, z);
    b.geo(m.iron, new THREE.TorusGeometry(0.07, 0.015, 4, 8, Math.PI), 9.8, 2.3, z, HALF_PI);
  }
  // 货箱搭布与额外麻袋
  b.geo(m.cloth, new THREE.PlaneGeometry(1.25, 1.25), 9.4, 1.13, 9.6, 0, -HALF_PI);
  b.geo(m.cloth, new THREE.SphereGeometry(0.28, 9, 7), -9.3, 0.24, 8.6);
  b.geo(m.cloth, new THREE.SphereGeometry(0.24, 9, 7), -9.0, 0.2, 9.3);
  // 井台垂链
  for (let i = 0; i < 4; i++) b.geo(m.iron, new THREE.TorusGeometry(0.04, 0.01, 4, 6), WELL.x - 0.3, 1.9 - i * 0.09, WELL.z, i % 2 ? HALF_PI : 0);

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
        const k = slot.h / size.y;
        clone.scale.setScalar(k);
        clone.position.set(slot.x - center.x * k, slot.y0 - box.min.y * k, -slot.z - center.z * k);
        clone.rotation.y = slot.ry;
        clone.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
        group.add(clone);
        group.remove(barrelFallbacks[i]);
      });
      resolve();
    }, undefined, () => resolve());
  }));

  b.build(group, true);
  return group;
}
