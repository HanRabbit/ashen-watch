// 三层新增几何（map）：B1 拱顶/墙/储藏架、S1–S4 踏步与护栏、2F 步道/垛墙/栏板/过街桥/上廊、
// 洞口护墙、庭院掩体、柱列与 B1 封门。材质全部经 variants(m)（圣经 5.1）。
// 只读 sim 数据；可交互模型统一由 props.ts 绘制。
import * as THREE from 'three';
import { isBaileyApronFabric } from '../sim/baileyApron';
import { addReliefFooting } from './masonry';
import { isWestCourtFabric } from '../sim/courtPlan';
import { isNorthCourtFabric } from '../sim/northCourt';
import { AREAS, B1_CEILINGS, B1_FOUNDATION_BACKING, B1_Y, CHAPEL_SLABS, COLUMNS, DECK_SLABS, NORTH_GUARD, PLATFORM_SLAB, PROPS, RAISED_Y, STAIRS, STAIR_BODIES, STAIR_RAILS, STEP_RAMP, WALLS } from '../sim/level';
import { Batch } from './geom';
import { edgeStock } from './edgeStock';
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
}


function boxY(b: Batch, mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile = 2): void {
  b.box(mat, x0, z0, x1, z1, y0, y1, tile);
}

// Local +X points uphill. Only round its downhill top edge: all-round
// stock would cut into the bed against the next riser and into the shaft
// wall contacts. This closed extrusion costs 20 triangles, vs 12 for a box.
function treadNose(w: number, h: number, d: number, radius: number, tile: number): THREE.BufferGeometry {
  const x = w / 2, y = h / 2, z = d / 2, r = Math.min(radius, w * 0.16, h * 0.16);
  const k = r * (1 - Math.SQRT1_2);
  const outline = [[-x, -y], [x, -y], [x, y], [-x + r, y], [-x + k, y - k], [-x, y - r]];
  const slopes = [[0, -1], [1, 0], [0, 1], [0, 1], [-Math.SQRT1_2, Math.SQRT1_2], [-1, 0]];
  const position: number[] = [], normal: number[] = [], uv: number[] = [], index: number[] = [];
  const vertex = (i: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number) => {
    position.push(...outline[i], pz);
    normal.push(nx, ny, nz);
    uv.push(u / tile, v / tile);
  };
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length, a = position.length / 3;
    const [nx, ny] = slopes[i];
    const [mx, my] = i === 3 || i === 4 ? slopes[j] : slopes[i];
    const put = (at: number, pz: number, ax: number, ay: number) => {
      const [px, py] = outline[at];
      const end = i === 1 || i === 5;
      vertex(at, pz, ax, ay, 0, end ? z - nx * pz : px + x, end ? py + y : z + (i === 0 ? pz : -pz));
    };
    put(i, -z, nx, ny); put(j, -z, mx, my); put(j, z, mx, my); put(i, z, nx, ny);
    index.push(a, a + 1, a + 2, a, a + 2, a + 3);
  }
  for (const sign of [-1, 1]) {
    const a = position.length / 3;
    outline.forEach(([px, py], i) => vertex(i, sign * z, 0, 0, sign, x + sign * px, py + y));
    for (let i = 1; i < outline.length - 1; i++) {
      if (sign > 0) index.push(a, a + i, a + i + 1);
      else index.push(a, a + i + 1, a + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

export function addStairTreads(b: Batch, stone: THREE.Material, timber: THREE.Material): void {
  for (const [s, stair] of STAIRS.entries()) {
    const wooden = stair.id === 'S4', tile = 1.2, mat = wooden ? timber : stone;
    const boxes = STAIR_BODIES[s].boxes;
    let i = 0;
    const put = (step: typeof boxes[number], yaw = 0, alongX?: boolean) => {
      const w = step.x1 - step.x0, h = step.h - step.y0!, d = step.z1 - step.z0;
      // Landings retain their square beds against the deck and the tread.
      const g = alongX === undefined ? tiledBox(w, h, d, tile)
        : treadNose(alongX ? w : d, h, alongX ? d : w, wooden ? 0.012 : 0.028, tile);
      const uv = g.getAttribute('uv');
      // Preserve the original per-tread scan phase.
      const u = (i * 0.381966 + 0.19) % 1, v = (i % 5) * 0.173;
      for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) + u, uv.getY(j) + v);
      b.geo(mat, g, (step.x0 + step.x1) / 2, (step.y0! + step.h) / 2, (step.z0 + step.z1) / 2, yaw);
    };
    for (const run of stair.runs) {
      const alongX = run.axis === 'x', uphill = run.to > run.from;
      const yaw = alongX ? (uphill ? 0 : Math.PI) : (uphill ? Math.PI / 2 : -Math.PI / 2);
      const end = i + Math.ceil(Math.abs(run.to - run.from) / 0.18);
      for (; i < end; i++) put(boxes[i], yaw, alongX);
    }
    for (; i < boxes.length; i++) put(boxes[i]);
  }
}

export function addChapelApproach(b: Batch, stone: THREE.Material, flag: THREE.Material): void {
  const strip = (mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y0: number, top: number, tile: number) => {
    const g = treadNose(x1 - x0, top - y0, z1 - z0, 0.028, tile);
    b.geo(mat, g, (x0 + x1) / 2, (y0 + top) / 2, (z0 + z1) / 2);
  };
  const p = PLATFORM_SLAB, r = STEP_RAMP, tread = (r.x1 - r.x0) / 3;
  strip(flag, p.x0, p.z0, p.x1, p.z1, p.y0!, p.h, 2);
  for (let i = 0; i < 3; i++) strip(stone, r.x0 + i * tread, r.z0, r.x0 + (i + 1) * tread, r.z1, -0.12, RAISED_Y * (i + 0.5) / 3, 1.4);
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

  addStairTreads(b, v.wallTrim, v.woodFloorOld);
  for (const r of STAIR_RAILS) {
    const dx = r.x1 - r.x0, dy = r.to - r.from;
    const n = Math.ceil(dx / 0.55);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      b.geo(m.iron, scaleUV(new THREE.CylinderGeometry(0.029, 0.035, 1.09, 6), 1), r.x0 + dx * t, r.from + dy * t + 0.5, r.z);
    }
    for (const y of [0.18, 1.02]) b.geo(m.iron, edgeStock(Math.hypot(dx, dy), 0.065, 0.09, 1, 'iron'),
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
  addChapelApproach(b, v.wallTrim, v.floorFlagWorn);

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

  // Walkways, piers and the cellar's cut-out ceiling occlude the key. The
  // same indexed surfaces define both the beauty pass and the shadow map.
  b.build(group, true);
  b1.build(g1, true);
  group.add(g1);
  return { group };
}

/** @deprecated The slabs and ground dressing now have cutouts at creation. */
export function hideGroundHoles(_levelGroup: THREE.Group): void {}
