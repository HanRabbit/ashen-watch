// 陈设（从 staticLevel.ts 拆出）：井台、门房/礼拜堂家具、木桶木箱、点缀小物。
// 碰撞盒在 sim/level.ts 的 PROPS / WELL，这里只画视觉，不得越出碰撞盒太多。
// 外部 GLB（public/models/props，CC0/CC-BY 见 CREDITS.md）经 propAssets 归一到圣经第 5 节材质；加载失败回退程序化。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PROPS, RAISED_Y, WELL } from '../sim/level';
import { Batch } from './geom';
import { Materials, scaleUV, tiledBox, trackPending } from './materials';
import { applyWear, loadProp, mergeByMaterial, sackGeometry, sackTie } from './propAssets';
import { Variants, variants } from './materialVariants';

const R = RAISED_Y;
const HALF_PI = Math.PI / 2;

function crateBox(b: Batch, v: Variants, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): void {
  b.box(v.woodPlank, x0, z0, x1, z1, y0, y1, 0.9);
  const t = 0.07, o = 0.02;
  const w = x1 - x0, d = z1 - z0, h = y1 - y0;
  for (const [cx, cz] of [[x0 + t / 2, z0 + t / 2], [x1 - t / 2, z0 + t / 2], [x0 + t / 2, z1 - t / 2], [x1 - t / 2, z1 - t / 2]]) {
    b.box(v.woodPlank, cx - t / 2, cz - t / 2, cx + t / 2, cz + t / 2, y0, y1, 0.9);
  }
  for (const y of [y0 + t / 2, y1 - t / 2]) {
    b.box(v.woodPlank, x0 - o, z0 - o, x1 + o, z0 + t, y - t / 2, y + t / 2, 0.9);
    b.box(v.woodPlank, x0 - o, z1 - t, x1 + o, z1 + o, y - t / 2, y + t / 2, 0.9);
    b.box(v.woodPlank, x0 - o, z0, x0 + t, z1, y - t / 2, y + t / 2, 0.9);
    b.box(v.woodPlank, x1 - t, z0, x1 + o, z1, y - t / 2, y + t / 2, 0.9);
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

export function buildFurniture(m: Materials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'furniture';
  const b = new Batch();
  const v = variants(m);
  applyWear(v.woodPlank, { kind: 'wood', seed: 31 });
  applyWear(v.woodBeam, { kind: 'wood', seed: 33 });
  applyWear(v.clothLinen, {
    kind: 'cloth', center: [-4.52, -27.57], rimY: 1.17,
    sacks: [[-2.5, -2.0, 0.32], [-2.0, -1.6, 0.28], [-9.3, 8.6, 0.3], [-9.0, 9.3, 0.26], [-2.05, -2.2, 0.18]],
  });
  // 共享金属/织物实例（非 5.1 族类）：铜烛座与旗巾，便于按材质合批
  const bronze = new THREE.MeshStandardMaterial({ color: 0xa89060, roughness: 0.45, metalness: 1 });
  const wineCloth = new THREE.MeshPhysicalMaterial({ color: 0x5b1f24, roughness: 0.95, sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x6a4a44) });
  const barrelSlots: { x: number; z: number; y0: number; h: number; ry: number }[] = [];

  // —— 井台（hero）：GLB 石圈+木柱斜撑+木瓦顶+辘轳绳筒吊桶；程序化兜底 ——
  const wellFallback = new THREE.Group();
  {
    const f = wellFallback;
    const ring = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(WELL.r - 0.15, WELL.r - 0.1, 0.85, 14, 1, true), 2), v.wallTrim);
    ring.position.set(WELL.x, 0.425, -WELL.z); ring.castShadow = ring.receiveShadow = true; f.add(ring);
    const rim = new THREE.Mesh(scaleUV(new THREE.TorusGeometry(WELL.r - 0.12, 0.09, 6, 14), 2), v.wallTrim);
    rim.rotation.x = HALF_PI; rim.position.set(WELL.x, 0.85, -WELL.z); rim.castShadow = true; f.add(rim);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(tiledBox(0.16, 1.7, 0.16, 1), v.woodBeam);
      post.position.set(WELL.x + sx * 1.05, 1.6, -WELL.z); post.castShadow = true; f.add(post);
      const brace = new THREE.Mesh(tiledBox(0.1, 0.7, 0.1, 1), v.woodBeam);
      brace.position.set(WELL.x + sx * 0.85, 2.1, -WELL.z); brace.rotation.z = sx * 0.6; brace.castShadow = true; f.add(brace);
    }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.9, 8), v.woodBeam);
    drum.rotation.z = HALF_PI; drum.position.set(WELL.x, 2.05, -WELL.z); drum.castShadow = true; f.add(drum);
    for (const sx of [-1, 1]) {
      const slope = new THREE.Mesh(tiledBox(1.5, 0.08, 2.3, 1), v.roofShingle);
      slope.position.set(WELL.x + sx * 0.62, 2.72, -WELL.z); slope.rotation.z = -sx * 0.55; slope.castShadow = true; f.add(slope);
    }
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 5), m.cloth);
    rope.position.set(WELL.x + 0.25, 1.6, -WELL.z); f.add(rope);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.2, 8), v.woodBeam);
    bucket.position.set(WELL.x + 0.25, 1.05, -WELL.z); bucket.castShadow = true; f.add(bucket);
    group.add(f);
  }
  const well = loadProp({
    name: 'well', size: 3.3, rotY: 0.15,
    norm: {
      Well: { color: 0xd0d4da, roughness: 0.86, metalness: 0, wear: { kind: 'stone', seed: 11, center: [WELL.x, -WELL.z], rimY: 0.85 } },
      Roof: { color: 0xb8bcc2, roughness: 0.8, metalness: 0, wear: { kind: 'stone', seed: 3 } },
      Bucket: { color: 0xb0a890, roughness: 0.8, metalness: 0, wear: { kind: 'wood', seed: 5 } },
      rope: { color: 0xa89878, roughness: 0.95, metalness: 0 },
    },
    onReady: () => { group.remove(wellFallback); },
  });
  well.position.set(WELL.x, 0, -WELL.z);
  group.add(well);
  // 底座台阶圈（concept/03 井底石阶）
  b.geo(v.floorCobble, scaleUV(new THREE.CylinderGeometry(1.42, 1.5, 0.12, 18), 2), WELL.x, 0.06, WELL.z);
  b.geo(v.floorCobble, scaleUV(new THREE.CylinderGeometry(1.02, 1.08, 0.08, 18), 2), WELL.x, 0.14, WELL.z);

  // 不随状态变化的陈设（碰撞盒见 level.ts 的 PROPS）
  for (const p of PROPS) {
    const y0 = p.x0 >= 13 || p.z0 >= 25.5 ? R : 0;
    switch (p.tag) {
      case 'hearth': {
        // 石砌开放壁炉（concept/02）：烟囱胸墙从墙里长出 + 敞开炉膛 + 石炉台 + 炉罩烟熏
        const hx = p.x0, hz0 = p.z0, hz1 = p.z1;
        b.box(v.wallTrim, hx, hz0 - 0.1, hx + 0.85, hz1 + 0.1, 0, 0.16); // 炉前石台
        b.box(v.wallAshlar, hx, hz0, hx + 0.55, hz0 + 0.45, 0.16, 1.5); // 左垛
        b.box(v.wallAshlar, hx, hz1 - 0.45, hx + 0.55, hz1, 0.16, 1.5); // 右垛
        b.box(v.wallRough, hx, hz0 + 0.45, hx + 0.15, hz1 - 0.45, 0.16, 1.5); // 炉膛背
        b.box(v.wallRough, hx, hz0 + 0.45, hx + 0.55, hz1 - 0.45, 0.16, 0.24); // 炉膛底
        // 尖拱券眉 + 托石 + 炉罩 mantel
        for (const sz of [-1, 1]) {
          b.geo(v.wallTrim, tiledBox(0.16, 0.16, 0.85, 1), hx + 0.27, 1.32, -4.4 + sz * 0.42, -sz * 0.35, 0, 0);
          b.box(v.wallTrim, hx + 0.45, -4.4 + sz * 0.78 - 0.09, hx + 0.62, -4.4 + sz * 0.78 + 0.09, 1.34, 1.5);
        }
        b.box(v.wallTrim, hx, hz0 - 0.06, hx + 0.68, hz1 + 0.06, 1.5, 1.64); // mantel
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
          normDefault: { color: 0x6b5038, roughness: 0.85, metalness: 0, wear: { kind: 'wood', seed: 41 } },
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
        b.box(v.wallTrim, p.x0, p.z0, p.x1, p.z1, 0, 0.3);
        break;
      }
      case 'woodpile': {
        const pile = loadProp({
          name: 'firewood', size: 1.05,
          normDefault: { color: 0x8a7a62, roughness: 0.85, metalness: 0, wear: { kind: 'wood', seed: 8 } },
        });
        pile.position.set(-2.6, 0, 6.45);
        group.add(pile);
        const pile2 = loadProp({
          name: 'firewood', size: 0.8, rotY: 0.14, yOff: 0.3,
          normDefault: { color: 0x7a6a52, roughness: 0.85, metalness: 0, wear: { kind: 'wood', seed: 12 } },
        });
        pile2.position.set(-2.6, 0, 6.45);
        group.add(pile2);
        break;
      }
      case 'bench': {
        const table = loadProp({
          name: 'table', size: 2.2, rotY: HALF_PI, stretch: [1, 1.35, 1],
          normDefault: { color: 0x6b5038, roughness: 0.8, metalness: 0, wear: { kind: 'wood', seed: 14 } },
        });
        table.position.set(2.6, 0, 4.5);
        group.add(table);
        b.box(v.woodBeam, 2.72, p.z0 + 0.1, 3, p.z1 - 0.1, 1.75, 1.8, 1);
        break;
      }
      case 'cot': {
        const bed = loadProp({
          name: 'bed', size: 1.95, rotY: HALF_PI, stretch: [0.62, 0.6, 1],
          normDefault: { color: 0x9a8a72, roughness: 0.85, metalness: 0, wear: { kind: 'wood', seed: 16 } },
        });
        bed.position.set(0.6, 0, 7.55);
        group.add(bed);
        break;
      }
      case 'stool': {
        const stool = loadProp({
          name: 'stool', size: 0.66,
          normDefault: { color: 0x7a6a52, roughness: 0.8, metalness: 0, wear: { kind: 'wood', seed: 18 } },
        });
        stool.position.set(1.8, 0, 6.3);
        group.add(stool);
        break;
      }
      case 'shelf': {
        const shelf = loadProp({
          name: 'shelf', size: 1.9, rotY: HALF_PI,
          normDefault: { color: 0x4a3a2c, roughness: 0.82, metalness: 0, wear: { kind: 'wood', seed: 20 } },
        });
        shelf.position.set(-9.85, 0, -6.2);
        group.add(shelf);
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
        b.box(v.woodPlank, p.x0, p.z0, p.x1, p.z1, y0 + 0.78, y0 + 0.86, 1);
        for (const [dx, dz] of [[0.05, 0.05], [0.05, 0.65], [0.65, 0.05], [0.65, 0.65]]) {
          b.box(v.woodBeam, p.x0 + dx, p.z0 + dz, p.x0 + dx + 0.1, p.z0 + dz + 0.1, y0, y0 + 0.78, 1);
        }
        break;
      case 'altar':
        b.box(v.wallTrim, p.x0, p.z0, p.x1, p.z1, y0, y0 + 0.2);
        b.box(v.wallAshlar, p.x0 + 0.15, p.z0 + 0.12, p.x1 - 0.15, p.z1 - 0.12, y0 + 0.2, y0 + 0.95);
        b.box(v.wallTrim, p.x0, p.z0, p.x1, p.z1, y0 + 0.95, y0 + 1.1);
        break;
      case 'brazier': break; // 由 props.ts 画（随状态变化）
      case 'pew': {
        const pew = loadProp({
          name: 'pew', size: 1.95, rotY: Math.PI,
          matOverride: { NewMat01: wineCloth, NewMat02: wineCloth },
          norm: {
            NewMat03: { color: 0xc9b891, roughness: 1, metalness: 0 },
          },
          normDefault: { color: 0xb09880, roughness: 0.8, metalness: 0, wear: { kind: 'wood', seed: 22 } },
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
  b.box(v.woodBeam, 18.2, 10.7, 19.8, 11.0, R, R + 0.14, 1);

  // —— 木桶（鼓腹+铁箍 GLB）：ref 机位前景一组 ——
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
  addBarrel(-6.7, 27.5, 0, 0.9, 0.4);
  addBarrel(-5.85, 27.95, 0, 0.78, 1.3);
  addBarrel(8.6, 21, 0, 0.85, 2.2);
  addBarrel(-9.35, 6.3, 0, 0.8, 0.9);
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
  b.box(v.wallRough, 6.4, 23.4, 7.0, 24.0, 0, 0.3);
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
    normDefault: { color: 0x8a7a62, roughness: 0.8, metalness: 0 },
  });
  bucket.position.set(1.7, 0, -12.6);
  group.add(bucket);
  const basket = loadProp({
    name: 'basket', size: 0.42, rotY: 1.2,
    normDefault: { color: 0x7a6a52, roughness: 0.9, metalness: 0 },
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
        const k = slot.h / size.y;
        clone.scale.setScalar(k);
        clone.position.set(slot.x - center.x * k, slot.y0 - box.min.y * k, -slot.z - center.z * k);
        clone.rotation.y = slot.ry;
        const vr = (k: number): number => { const x = Math.sin((i + 1) * 77.7 + k * 13.1) * 43758.5453; return x - Math.floor(x); };
        clone.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            const src = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (src.isMeshStandardMaterial) {
              // 实例差异：颜色 ±8%、roughness ±0.06、贴图偏移随机（圣经 5.2 去单调）
              const mc = src.clone();
              const v = 0.92 + vr(1) * 0.16;
              mc.color.setHex(0x8a7a62).multiplyScalar(v);
              mc.roughness = 0.8 + (vr(2) - 0.5) * 0.12;
              mc.metalness = 0;
              mc.envMapIntensity = 0.7;
              if (mc.map) { mc.map = mc.map.clone(); mc.map.offset.set(vr(3), vr(4)); mc.map.needsUpdate = true; }
              applyWear(mc, { kind: 'wood', seed: i * 7 + 1 });
              (o as THREE.Mesh).material = mc;
            }
          }
        });
        mergeByMaterial(clone);
        group.add(clone);
        group.remove(barrelFallbacks[i]);
      });
      resolve();
    }, undefined, () => resolve());
  }));

  b.build(group, true);
  return group;
}