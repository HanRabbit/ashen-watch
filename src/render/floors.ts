// 三层新增几何（map）：B1 拱顶/墙/储藏架、S1–S4 踏步与护栏、2F 步道/垛墙/栏板/过街桥/上廊、
// 洞口护墙、庭院掩体、柱列与 B1 封门。材质全部经 variants(m)（圣经 5.1）。
// 只读 sim 数据；可交互模型统一由 props.ts 绘制。
import * as THREE from 'three';
import { isBaileyApronFabric } from '../sim/baileyApron';
import { addReliefFooting } from './masonry';
import { isWestCourtFabric } from '../sim/courtPlan';
import { isNorthCourtFabric } from '../sim/northCourt';
import { AREAS, B1_CEILINGS, B1_FOUNDATION_BACKING, B1_Y, CHAPEL_SLABS, COLUMNS, DECK_SLABS, NORTH_GUARD, PLATFORM_SLAB, PROPS, RAISED_Y, S1_SHAFT, S2_SHAFT, STAIR_BODIES, STAIR_RAILS, STEP_RAMP, WALLS } from '../sim/level';
import { World } from '../sim/state';
import { Batch } from './geom';
import { Materials, scaleUV, tiledBox } from './materials';
import { variants } from './materialVariants';
import { addYardProp } from './yardProps';
import { addYardArcade } from './yardArcade';
import { addNorthWalkGuard } from './northCourt';
import { mountRodin } from './rodinAssets';
import { fractureRelief, reliefBlank, seatRelief } from './relief';
import { reliefFinish } from './reliefFinish';
import { addRampartEdge } from './rampartEdges';

export interface Floors {
  group: THREE.Group;
  update(w: World): void;
}


function boxY(b: Batch, mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile = 2): void {
  b.box(mat, x0, z0, x1, z1, y0, y1, tile);
}

export function buildFloors(m: Materials): Floors {
  const v = variants(m);
  const group = new THREE.Group();
  group.name = 'floors';
  const b = new Batch();
  const b1 = new Batch(); // Separate batch, but keep the cellar visible through both stairs.
  const g1 = new THREE.Group(); g1.name = 'floors-B1';

  addNorthWalkGuard(b, NORTH_GUARD, v.wallTrim, m.iron, v.woodBeam);

  // —— 带 y0 的墙 / 护栏 / 垛墙 / 梯体护墙（staticLevel 跳过这些）——
  for (const w of WALLS) {
    if (w.y0 === undefined || w.tag === 'gateScarp' || isWestCourtFabric(w) || isNorthCourtFabric(w) || isBaileyApronFabric(w)) continue; // Ruin and corbels are batched by staticLevel.
    const y0 = w.y0;
    if (w.tag === 'rail') {
      if (addRampartEdge(b, v, w)) continue;
      // 东廊和桥保留通透的锻铁护栏。
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
    } else if (w.tag === 'slopeRail') {
      // Draw the continuous rail below, not the collision approximation.
    } else {
      const isB1 = w.tag === 'cellar' || w.tag === 'passage' || w.tag === 'store';
      boxY(isB1 ? b1 : b, isB1 ? v.wallRough : v.wallTrim, w.x0, w.z0, w.x1, w.z1, y0, w.h, 2);
    }
  }

  for (const s of STAIR_BODIES) {
    const mat = s.id === 'S4' ? v.woodFloorOld : v.wallTrim;
    for (const [i, step] of s.boxes.entries()) {
      const g = tiledBox(step.x1 - step.x0, step.h - step.y0!, step.z1 - step.z0, 1.2);
      const uv = g.getAttribute('uv');
      // Each nosing was cut from a different length of stock. Previously every
      // riser had the same nick and the same dark joint in a vertical line up S3.
      const u = (i * 0.381966 + 0.19) % 1, v = (i % 5) * 0.173;
      for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) + u, uv.getY(j) + v);
      b.geo(mat, g, (step.x0 + step.x1) / 2, (step.y0! + step.h) / 2, (step.z0 + step.z1) / 2);
    }
  }
  for (const r of STAIR_RAILS) {
    const dx = r.x1 - r.x0, dy = r.to - r.from;
    const n = Math.ceil(dx / 0.55);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      b.geo(m.iron, scaleUV(new THREE.CylinderGeometry(0.029, 0.035, 1.09, 6), 1), r.x0 + dx * t, r.from + dy * t + 0.5, r.z);
    }
    for (const y of [0.18, 1.02]) b.geo(m.iron, tiledBox(Math.hypot(dx, dy), 0.065, 0.09, 1),
      (r.x0 + r.x1) / 2, (r.from + r.to) / 2 + y, r.z, 0, 0, Math.atan2(dy, dx));
  }

  for (const w of B1_FOUNDATION_BACKING) boxY(b1, v.wallRough, w.x0, w.z0, w.x1, w.z1, w.y0!, w.h);

  // The B1 ceiling pieces share the shaft cutout and collision bounds.
  for (const c of B1_CEILINGS) boxY(b1, v.wallRough, c.x0, c.z0, c.x1, c.z1, c.y0!, c.h, 2);
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

  for (const s of CHAPEL_SLABS) boxY(b, v.floorInterior, s.x0, s.z0, s.x1, s.z1, s.y0!, s.h);
  const p = PLATFORM_SLAB;
  boxY(b, v.floorFlagWorn, p.x0, p.z0, p.x1, p.z1, p.y0!, p.h);
  const r = STEP_RAMP, tread = (r.x1 - r.x0) / 3;
  for (let i = 0; i < 3; i++) boxY(b, v.wallTrim, r.x0 + i * tread, r.z0, r.x0 + (i + 1) * tread, r.z1, -0.12, RAISED_Y * (i + 0.5) / 3, 1.4);

  for (const s of DECK_SLABS) {
    const isGal = s.x0 >= 13.4 && s.z0 >= 20.0;
    boxY(b, isGal ? v.woodFloorOld : v.floorFlagWorn, s.x0, s.z0, s.x1, s.z1, s.y0!, s.h);
  }
  addYardArcade(b, v.wallAshlar, v.wallTrim);

  // —— 庭院掩体 / 柱列 / 前景桶箱 ——
  for (const p of PROPS) {
    const y0 = p.y0 ?? 0;
    if (p.tag === 'cart' || p.tag === 'scaffold' || p.tag === 'crateStack') {
      addYardProp(b, p, m, v);
    } else if (p.tag === 'wallStub') {
      const bed = reliefFinish(v.rock, y0);
      const fallback = reliefBlank(bed);
      addReliefFooting(fallback, bed, p, seatRelief(fallback, p).contact);
      mountRodin(group, 'pilgrim-relief', fallback, v.rock, model => {
        const { mesh, atlas } = fractureRelief(model);
        const { contact } = seatRelief(model, p);
        mesh.material = reliefFinish(v.rock, y0, atlas);
        addReliefFooting(model, bed, p, contact);
      });
    }
  }
  for (const c of COLUMNS) {
    b.geo(v.wallAshlar, scaleUV(new THREE.CylinderGeometry(c.r, c.r * 1.1, c.h - c.y0, 10), 1), c.x, (c.y0 + c.h) / 2, c.z);
    b.geo(v.wallTrim, scaleUV(new THREE.CylinderGeometry(c.r * 1.3, c.r * 1.4, 0.2, 10), 1), c.x, c.y0 + 0.1, c.z);
  }

  b.build(group, true);
  b1.build(g1, true); group.add(g1); // map: B1 子组
  group.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) { me.castShadow = false; me.receiveShadow = true; } }); // map: 三层几何不投影，省 shadow pass（swiftshader 稳定+预算）

  // Subtle local bounce makes the first few descending treads legible at
  // their mouths without illuminating the whole cellar or changing AI light zones.
  const fill1 = new THREE.PointLight(0xaebccd, 6.5, 6, 2);
  fill1.position.set(S1_SHAFT.x0 + 2.4, -0.55, -(S1_SHAFT.z0 + S1_SHAFT.z1) / 2);
  const fill2 = new THREE.PointLight(0xdeab7b, 4.2, 5.5, 2);
  fill2.position.set((S2_SHAFT.x0 + S2_SHAFT.x1) / 2, -0.32, -(S2_SHAFT.z1 - 1.65));
  group.add(fill1, fill2);
  return {
    group,
    update(w: World): void {
      const daylight = w.phase === 'night' ? 0.32 : w.phase === 'dusk' ? 0.65 : 1;
      fill1.intensity = 6.5 * daylight;
      fill2.intensity = 4.2 * daylight;
    },
  };
}

/** @deprecated The slabs and ground dressing now have cutouts at creation. */
export function hideGroundHoles(_levelGroup: THREE.Group): void {}
