// 三层新增几何（map）：B1 拱顶/墙/储藏架、S1–S4 踏步与护栏、2F 步道/垛墙/栏板/过街桥/上廊、
// 洞口护墙、庭院掩体、柱列、楼梯栅门门扇、B1 油瓶与封门。材质全部经 variants(m)（圣经 5.1）。
// 只读 sim 数据；旧栅门/油瓶视觉按 AABB 隐藏（props.ts 不可改）。
import * as THREE from 'three';
import { AREAS, B1_Y, COLUMNS, F2_Y, PROPS, RAISED_Y, SLABS, STAIRS, WALLS } from '../sim/level';
import { World } from '../sim/state';
import { Batch, mesh } from './geom';
import { Materials, scaleUV, tiledBox } from './materials';
import { variants } from './materialVariants';

export interface Floors {
  group: THREE.Group;
  update(w: World, dt: number): void;
}

const HALF_PI = Math.PI / 2;

/**  stepped 梯段实体（视觉踏步）。 */
function drawRun(b: Batch, mat: THREE.Material, r: { x0: number; z0: number; x1: number; z1: number; axis: 'x' | 'z'; from: number; to: number }, n: number): void {
  const yBot = Math.min(r.from, r.to);
  for (let i = 0; i < n; i++) {
    const t1 = (i + 1) / n;
    const yTop = r.from + (r.to - r.from) * t1;
    if (r.axis === 'x') {
      const xa = r.x0 + (r.x1 - r.x0) * (i / n), xb = r.x0 + (r.x1 - r.x0) * t1;
      b.box(mat, xa, r.z0, xb, r.z1, yBot - 0.4, yTop, 1.2);
    } else {
      const za = r.z0 + (r.z1 - r.z0) * (i / n), zb = r.z0 + (r.z1 - r.z0) * t1;
      b.box(mat, r.x0, za, r.x1, zb, yBot - 0.4, yTop, 1.2);
    }
  }
}

function boxY(b: Batch, mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile = 2): void {
  b.box(mat, x0, z0, x1, z1, y0, y1, tile);
}

export function buildFloors(m: Materials): Floors {
  const v = variants(m);
  const group = new THREE.Group();
  group.name = 'floors';
  const b = new Batch();
  const b1 = new Batch(); // map: B1 单独合批，玩家不在 B1 时整组隐藏省预算
  const g1 = new THREE.Group(); g1.name = 'floors-B1';

  // —— 带 y0 的墙 / 护栏 / 垛墙 / 梯体护墙（staticLevel 跳过这些）——
  for (const w of WALLS) {
    if (w.y0 === undefined) continue;
    const y0 = w.y0;
    if (w.tag === 'rail') {
      // 锻铁护栏：立柱 + 上下横杆
      const alongX = w.x1 - w.x0 > w.z1 - w.z0;
      const len = alongX ? w.x1 - w.x0 : w.z1 - w.z0;
      const n = Math.max(2, Math.round(len / 0.9));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = alongX ? w.x0 + len * t : (w.x0 + w.x1) / 2;
        const z = alongX ? (w.z0 + w.z1) / 2 : w.z0 + len * t;
        b.geo(m.iron, scaleUV(new THREE.CylinderGeometry(0.03, 0.035, w.h - y0, 6), 1), x, (y0 + w.h) / 2, z);
      }
      boxY(b, m.iron, w.x0, w.z0, w.x1, w.z1, w.h - 0.06, w.h, 1);
      boxY(b, m.iron, w.x0, w.z0, w.x1, w.z1, y0 + 0.15, y0 + 0.2, 1);
    } else if (w.tag === 'parapet') {
      boxY(b, v.wallTrim, w.x0, w.z0, w.x1, w.z1, y0, w.h, 2);
      // 垛口
      const alongX = w.x1 - w.x0 > w.z1 - w.z0;
      const len = alongX ? w.x1 - w.x0 : w.z1 - w.z0;
      const n = Math.max(1, Math.floor(len / 1.5));
      for (let i = 0; i < n; i++) {
        if ((i * 37) % 11 === 0) continue;
        const c = (alongX ? w.x0 : w.z0) + (len / n) * (i + 0.5);
        const mw = 0.62, mh = 0.5;
        if (alongX) boxY(b, v.wallTrim, c - mw / 2, w.z0, c + mw / 2, w.z1, w.h, w.h + mh, 1.4);
        else boxY(b, v.wallTrim, w.x0, c - mw / 2, w.x1, c + mw / 2, w.h, w.h + mh, 1.4);
      }
    } else if (w.tag === 'stairMass') {
      // 梯体由 drawRun 画，跳过
    } else {
      const isB1 = w.tag === 'cellar' || w.tag === 'passage' || w.tag === 'store';
      boxY(isB1 ? b1 : b, isB1 ? v.wallRough : v.wallTrim, w.x0, w.z0, w.x1, w.z1, y0, w.h, 2);
    }
  }

  // —— 楼梯踏步 + 平台 ——
  for (const s of STAIRS) {
    const mat = s.id === 'S4' ? v.woodFloorOld : v.wallTrim;
    for (const r of s.runs) drawRun(b, mat, r, s.id === 'S2' ? 12 : 20);
    for (const l of s.landings) boxY(b, mat, l.x0, l.z0, l.x1, l.z1, l.y - 0.4, l.y, 1.4);
  }

  // —— B1 拱顶（低筒拱）与地面 ——
  // 地窖顶（挖 S1 洞）：用两段横拱
  const s1 = STAIRS[0].runs[0];
  boxY(b1, v.wallRough, AREAS.cellar.x0, AREAS.cellar.z0, s1.x0, AREAS.cellar.z1, -0.75, -0.6, 2);
  boxY(b1, v.wallRough, s1.x1, AREAS.cellar.z0, AREAS.cellar.x1, AREAS.cellar.z1, -0.75, -0.6, 2);
  boxY(b1, v.wallRough, s1.x0, AREAS.cellar.z0, s1.x1, s1.z0, -0.75, -0.6, 2);
  boxY(b1, v.wallRough, s1.x0, s1.z1, s1.x1, AREAS.cellar.z1, -0.75, -0.6, 2);
  // 通道顶
  boxY(b1, v.wallRough, AREAS.passage.x0, AREAS.passage.z0, AREAS.passage.x1, AREAS.passage.z1, -0.95, -0.8, 2);
  // B1 地面（泥地 + 踏道石板）
  boxY(b1, v.floorDirt, AREAS.cellar.x0, AREAS.cellar.z0, AREAS.cellar.x1, AREAS.cellar.z1, B1_Y - 0.3, B1_Y, 2);
  boxY(b1, v.floorDirt, AREAS.passage.x0, AREAS.passage.z0, AREAS.passage.x1, AREAS.passage.z1, B1_Y - 0.3, B1_Y, 2);
  boxY(b1, v.floorFlagWorn, AREAS.store.x0, AREAS.store.z0, AREAS.store.x1, AREAS.store.z1, B1_Y - 0.3, B1_Y, 2);
  // 储藏室顶 = 礼拜堂地板底（礼拜堂地面在 1F 层画）
  // B1 石墩 / 储藏架
  for (const p of PROPS) {
    if (p.tag === 'pier' && (p.y0 ?? 0) < 0) {
      b1.geo(v.wallRough, scaleUV(new THREE.CylinderGeometry(0.3, 0.34, p.h - (p.y0 ?? 0), 8), 1), (p.x0 + p.x1) / 2, ((p.y0 ?? 0) + p.h) / 2, (p.z0 + p.z1) / 2);
    }
    if (p.tag === 'shelfB1') {
      for (const yy of [0.4, 1.0, 1.6]) boxY(b1, v.woodPlank, p.x0, p.z0, p.x1, p.z1, (p.y0 ?? 0) + yy, (p.y0 ?? 0) + yy + 0.06, 1);
      boxY(b1, v.woodBeam, p.x0, p.z0, p.x0 + 0.08, p.z1, p.y0 ?? 0, (p.y0 ?? 0) + 1.8, 1);
      boxY(b1, v.woodBeam, p.x1 - 0.08, p.z0, p.x1, p.z1, p.y0 ?? 0, (p.y0 ?? 0) + 1.8, 1);
    }
  }
  // 深层封门（地窖南端）
  b1.geo(v.wallRough, scaleUV(new THREE.BoxGeometry(1.8, 2.2, 0.3), 1), 5.9, B1_Y + 1.1, 6.4);
  b1.geo(m.iron, tiledBox(1.9, 0.1, 0.06, 1), 5.9, B1_Y + 1.2, 6.2);
  // 残烛（叙事光，克制）
  b1.geo(m.iron, scaleUV(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 6), 1), 14.6, B1_Y + 0.15, 21.4);

  // —— 1F 新地面：礼拜堂 + 平台（挖 S2 洞）， courtyard S1 洞侧壁 ——
  const hole = { x0: 14.2, z0: 17.5, x1: 16.0, z1: 21.5 };
  boxY(b, v.floorInterior, 13, 10.5, hole.x0, 22.5, 0.15, RAISED_Y, 2);
  boxY(b, v.floorInterior, hole.x0, 10.5, hole.x1, hole.z0, 0.15, RAISED_Y, 2);
  boxY(b, v.floorInterior, hole.x0, hole.z1, hole.x1, 22.5, 0.15, RAISED_Y, 2);
  boxY(b, v.floorInterior, hole.x1, 10.5, 31, 22.5, 0.15, RAISED_Y, 2);
  boxY(b, v.floorFlagWorn, 10.5, 11, 13, 22, 0.15, RAISED_Y, 2);
  // 平台西侧台阶
  for (let i = 0; i < 3; i++) boxY(b, v.wallTrim, 10.5 + i * 0.3, 11, 10.8 + i * 0.3, 22, 0, RAISED_Y * (i + 1) / 3, 1.4);
  // S1 洞侧壁
  boxY(b, v.wallTrim, s1.x0, s1.z0 - 0.2, s1.x1, s1.z0, -0.3, 0, 1.4);
  boxY(b, v.wallTrim, s1.x0, s1.z1, s1.x1, s1.z1 + 0.2, -0.3, 0, 1.4);
  boxY(b, v.wallTrim, s1.x1, s1.z0, s1.x1 + 0.3, s1.z1, -0.3, 0, 1.4);
  // S2 洞侧壁
  boxY(b, v.wallTrim, hole.x0 - 0.2, hole.z0, hole.x0, hole.z1, 0.15, RAISED_Y, 1.4);
  boxY(b, v.wallTrim, hole.x1, hole.z0, hole.x1 + 0.2, 20.5, 0.15, RAISED_Y, 1.4);
  boxY(b, v.wallTrim, hole.x0, hole.z0 - 0.2, hole.x1, hole.z0, 0.15, RAISED_Y, 1.4);

  // —— 2F deck 面 + 上廊木地板 ——
  for (const s of SLABS) {
    if ((s.y0 ?? 0) < 3) continue;
    const isGal = s.x0 >= 13.4 && s.z0 >= 20.2;
    boxY(b, isGal ? v.woodFloorOld : v.floorFlagWorn, s.x0, s.z0, s.x1, s.z1, s.h - 0.12, s.h, 2);
  }
  // 券廊尖拱（视觉，墩间）
  const pierZ = [11.6, 14.0, 14.6, 18.4, 19.0, 21.4];
  for (let i = 0; i < pierZ.length - 1; i += 2) {
    const z0 = pierZ[i], z1 = pierZ[i + 1];
    const w = z1 - z0;
    b.geo(v.wallTrim, scaleUV(new THREE.TorusGeometry(w / 2, 0.12, 6, 12, Math.PI), 1), 10.25, 3.4, (z0 + z1) / 2, 0, HALF_PI, 0);
  }

  // —— 庭院掩体 / 柱列 / 前景桶箱 ——
  for (const p of PROPS) {
    const y0 = p.y0 ?? 0;
    if (p.tag === 'cart') {
      boxY(b, v.woodPlank, p.x0, p.z0, p.x1, p.z1, y0 + 0.5, y0 + 1.2, 1.4);
      b.geo(v.woodBeam, scaleUV(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 10), 1), p.x0 + 0.5, y0 + 0.35, p.z0 + 0.2, 0, 0, HALF_PI);
      b.geo(v.woodBeam, scaleUV(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 10), 1), p.x1 - 0.5, y0 + 0.35, p.z0 + 0.2, 0, 0, HALF_PI);
      boxY(b, v.woodBeam, p.x0, p.z1 - 0.1, p.x1, p.z1, y0 + 1.2, y0 + 1.6, 1);
    } else if (p.tag === 'scaffold') {
      for (const [dx, dz] of [[0, 0], [1.6, 0], [0, 1.0], [1.6, 1.0]]) boxY(b, v.woodBeam, p.x0 + dx, p.z0 + dz, p.x0 + dx + 0.12, p.z0 + dz + 0.12, y0, y0 + 2.2, 1);
      boxY(b, v.woodPlank, p.x0, p.z0, p.x1, p.z0 + 0.1, y0 + 1.0, y0 + 1.1, 1);
      b.geo(v.woodPlank, tiledBox(2.0, 0.08, 0.4, 1), (p.x0 + p.x1) / 2, y0 + 1.6, (p.z0 + p.z1) / 2, 0, 0, 0.5);
    } else if (p.tag === 'crateStack') {
      boxY(b, v.woodPlank, p.x0, p.z0, p.x0 + 0.8, p.z0 + 0.8, y0, y0 + 0.8, 1.2);
      boxY(b, v.woodPlank, p.x0 + 0.7, p.z0 + 0.6, p.x1, p.z1, y0, y0 + 0.7, 1.2);
      boxY(b, v.woodPlank, p.x0 + 0.2, p.z0 + 0.2, p.x0 + 1.0, p.z0 + 1.0, y0 + 0.8, y0 + 1.5, 1.2);
    } else if (p.tag === 'wallStub') {
      boxY(b, v.wallRubble, p.x0, p.z0, p.x1, p.z1, y0, y0 + 1.6, 2);
      boxY(b, v.wallRough, p.x0, p.z0, p.x0 + 0.6, p.z1, y0 + 1.6, y0 + 2.1, 2);
    } else if (p.tag === 'barrels') {
      for (const [bx, bz] of [[-7.4, 27.2], [-6.6, 27.6], [-6.0, 27.0]]) b.geo(v.woodPlank, scaleUV(new THREE.CylinderGeometry(0.3, 0.26, 0.9, 10), 1), bx, y0 + 0.45, bz);
      boxY(b, v.woodPlank, -7.0, 26.8, -6.0, 27.8, y0, y0 + 0.7, 1.2);
    }
  }
  for (const c of COLUMNS) {
    b.geo(v.wallAshlar, scaleUV(new THREE.CylinderGeometry(c.r, c.r * 1.1, c.h - c.y0, 10), 1), c.x, (c.y0 + c.h) / 2, c.z);
    b.geo(v.wallTrim, scaleUV(new THREE.CylinderGeometry(c.r * 1.3, c.r * 1.4, 0.2, 10), 1), c.x, c.y0 + 0.1, c.z);
  }

  b.build(group, true);
  b1.build(g1, true); group.add(g1); // map: B1 子组
  group.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) { me.castShadow = false; me.receiveShadow = true; } }); // map: 三层几何不投影，省 shadow pass（swiftshader 稳定+预算）

  // —— 楼梯栅门门扇（随 w.doors.gate 动画）——
  const gate = new THREE.Group();
  const gb = new Batch();
  const gw = 1.6, gh = 2.4;
  for (let i = 0; i <= 6; i++) gb.geo(m.iron, scaleUV(new THREE.CylinderGeometry(0.025, 0.03, gh, 6), 1), -gw / 2 + (gw / 6) * i, gh / 2, 0);
  gb.box(m.iron, -gw / 2, -0.04, gw / 2, 0.04, 0.1, 0.16, 1);
  gb.box(m.iron, -gw / 2, -0.04, gw / 2, 0.04, gh - 0.16, gh - 0.1, 1);
  gb.build(gate, true);
  gate.position.set(24.0, F2_Y, -20.4);
  group.add(gate);

  // —— B1 油瓶（随 w.taken.flask）——
  const flask = new THREE.Group();
  const oilMat = new THREE.MeshStandardMaterial({ color: 0xb8741c, emissive: 0x7a4208, emissiveIntensity: 0.35, roughness: 0.3, transparent: true, opacity: 0.9 });
  const fb = mesh(new THREE.SphereGeometry(0.09, 10, 8), oilMat); fb.position.y = 0.085; fb.scale.y = 0.9;
  flask.add(fb);
  flask.position.set(14.8, B1_Y + 0.86, -13.0);
  group.add(flask);

  // —— 礼拜堂正门双扇（朝西，随 w.doors.chapelFront）——
  const mkLeaf = (hz: number, dir: number): THREE.Group => {
    const g = new THREE.Group();
    const lb = new Batch();
    lb.box(v.woodPlank, -0.05, 0, 0.05, 0.9 * dir, 0, 3.2, 1.2);
    for (const yy of [0.5, 1.6, 2.7]) lb.box(m.iron, -0.07, 0.05 * dir, 0.07, 0.85 * dir, yy, yy + 0.08, 1);
    lb.build(g, true);
    g.position.set(13.3, RAISED_Y, -hz);
    return g;
  };
  const frontL = mkLeaf(15.6, 1);
  const frontR = mkLeaf(17.4, -1);
  group.add(frontL, frontR);
  // —— 祭台匣（新祭台，随 w.taken.chest）——
  const chest = new THREE.Group();
  const cb = new Batch();
  cb.box(v.woodPlank, -0.5, -0.35, 0.5, 0.35, 0, 0.5, 1.2);
  cb.box(m.iron, -0.52, -0.37, 0.52, 0.37, 0.45, 0.55, 1);
  cb.build(chest, true);
  chest.position.set(29.3, RAISED_Y + 1.1, -16.5);
  group.add(chest);

  let gateOpen = 0, frontOpen = 0;
  return {
    group,
    update(w: World, dt: number): void {
      gateOpen += ((w.doors.gate ? 1 : 0) - gateOpen) * Math.min(1, dt * 6);
      gate.rotation.y = gateOpen * HALF_PI * 0.95;
      gate.rotation.z = w.repairs.gate ? 0 : 0.035;
      flask.visible = !w.taken.flask;
      g1.visible = w.player.floor === 'B1'; // map: 楼层可见性剔除
      frontOpen += ((w.doors.chapelFront ? 1 : 0) - frontOpen) * Math.min(1, dt * 6);
      frontL.rotation.y = -frontOpen * HALF_PI * 0.95;
      frontR.rotation.y = frontOpen * HALF_PI * 0.95;
      chest.visible = !w.taken.chest;
    },
  };
}

/** 按三角形重心 AABB 剔除 staticLevel 地面：S1 洞 + 旧礼拜堂/外廊地面（礼拜堂已转 90°）。 */
export function hideGroundHoles(levelGroup: THREE.Group): void {
  const boxes: [number, number, number, number, number, number][] = [
    [4.6, 10.0, -0.35, 0.05, 9.0, 10.8],   // S1 洞口
    [12.9, 25.1, -0.35, 0.5, 7.4, 25.6],   // 旧礼拜堂地面
    [9.9, 25.1, -0.35, 0.5, 25.4, 29.1],   // 旧外廊地面
  ];
  cull(levelGroup, boxes);
}

/** 隐藏 props.ts 里旧位置的栅门门扇与门厅油瓶（不可改 props.ts）。 */
export function hideMovedProps(propsGroup: THREE.Group): void {
  const boxes: [number, number, number, number, number, number][] = [
    [10.0, 10.6, 0, 3.0, 5.0, 7.0],   // 旧侧廊栅门
    [22.0, 22.6, 1.0, 1.6, 22.7, 23.3], // 旧门厅油瓶
    [17.9, 20.1, 0.4, 3.8, 25.0, 25.5], // 旧正门双扇（朝北旧位）
    [18.3, 19.7, 1.4, 2.4, 8.9, 9.8],  // 旧祭台匣（旧位）
  ];
  cull(propsGroup, boxes);
}

function cull(group: THREE.Group, boxes: [number, number, number, number, number, number][]): void {
  const inBox = (x: number, y: number, z: number): boolean => {
    for (const [x0, x1, y0, y1, z0, z1] of boxes) if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1) return true;
    return false;
  };
  group.traverse((o) => {
    const me = o as THREE.Mesh;
    if (!me.isMesh) return;
    const geo = me.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos || geo.index) return;
    const names = Object.keys(geo.attributes);
    const keep: Record<string, number[]> = {};
    for (const nm of names) keep[nm] = [];
    let removed = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const cz = -(pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      if (inBox(cx, cy, cz)) { removed++; continue; }
      for (const nm of names) {
        const at = geo.getAttribute(nm) as THREE.BufferAttribute;
        for (let k = 0; k < 3; k++) for (let c = 0; c < at.itemSize; c++) keep[nm].push(at.getComponent(i + k, c));
      }
    }
    if (!removed) return;
    if (!keep[names[0]].length) { me.visible = false; return; }
    const ng = new THREE.BufferGeometry();
    for (const nm of names) {
      const at = geo.getAttribute(nm) as THREE.BufferAttribute;
      ng.setAttribute(nm, new THREE.Float32BufferAttribute(keep[nm], at.itemSize));
    }
    me.geometry = ng;
    geo.dispose();
  });
}