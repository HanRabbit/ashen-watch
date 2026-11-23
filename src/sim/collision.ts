// 碰撞与视线：圆对轴对齐盒（带竖向范围）、圆对圆柱、3D 线段遮挡。
// 墙、关闭的门、楼板各有独立碰撞；按实体高度过滤，三层互不干扰（PRD 9.6）。
import { Box, COLUMNS, Cylinder, DOORS, DoorId, PROPS, SLABS, STAIR_MASS, WALLS, WELL } from './level';

export type DoorOpen = Record<DoorId, boolean>;

const DOOR_IDS = Object.keys(DOORS) as DoorId[];
// Camera clearance includes decorative merlons (0.5 m) and a margin for the
// foreground silhouette. Keep this separate from the walk and sight blockers.
const CAMERA_WALLS = WALLS.map((b) => b.tag === 'parapet' ? { ...b, h: b.h + 0.85 } : b);

/** 实体竖向占用范围 [y+0.1, y+1.7] 与盒 [y0, h] 是否重叠。 */
function overlapsY(b: Box, y: number): boolean {
  const y0 = b.y0 ?? 0;
  return y0 < y + 1.7 && b.h > y + 0.1;
}

/** 当前生效的阻挡盒：墙、道具、梯体与关闭的门，按实体高度 y 过滤（缺省 0 = 1F）。 */
export function solidBoxes(doors: DoorOpen, y = 0): Box[] {
  const out: Box[] = [];
  for (const b of WALLS) if (overlapsY(b, y)) out.push(b);
  for (const b of PROPS) if (overlapsY(b, y)) out.push(b);
  // Low treads are walkable; a higher step body is solid when approached
  // from below (for example, walking across the room beside a staircase).
  for (const b of STAIR_MASS) if (b.h > y + 0.55 && overlapsY(b, y)) out.push(b);
  for (const id of DOOR_IDS) if (!doors[id] && overlapsY(DOORS[id].box, y)) out.push(DOORS[id].box);
  return out;
}

/** 与实体高度重叠的圆柱障碍（井台 / 柱列）。 */
export function cylsAt(y: number): Cylinder[] {
  const out: Cylinder[] = [];
  for (const c of [WELL, ...COLUMNS]) if (c.y0 < y + 1.7 && c.h > y + 0.1) out.push(c);
  return out;
}

function pushOutOfBox(p: { x: number; z: number }, r: number, b: Box): boolean {
  const cx = Math.max(b.x0, Math.min(p.x, b.x1));
  const cz = Math.max(b.z0, Math.min(p.z, b.z1));
  let dx = p.x - cx;
  let dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const push = r - d;
    p.x += (dx / d) * push;
    p.z += (dz / d) * push;
    return true;
  }
  const l = p.x - b.x0, rt = b.x1 - p.x, n = p.z - b.z0, f = b.z1 - p.z;
  const m = Math.min(l, rt, n, f);
  dx = 0; dz = 0;
  if (m === l) dx = -(l + r); else if (m === rt) dx = rt + r; else if (m === n) dz = -(n + r); else dz = f + r;
  p.x += dx; p.z += dz;
  return true;
}

function pushOutOfCyl(p: { x: number; z: number }, r: number, c: Cylinder): boolean {
  const dx = p.x - c.x, dz = p.z - c.z;
  const min = c.r + r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 1e-4;
  p.x = c.x + (dx / d) * min;
  p.z = c.z + (dz / d) * min;
  return true;
}

/** 移动圆形碰撞体并解算穿插（分小步，单步 ≤ 半径一半）。 */
export function moveCircle(p: { x: number; z: number }, dx: number, dz: number, r: number, boxes: Box[], cyls: Cylinder[] = []): void {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
  for (let s = 0; s < steps; s++) {
    p.x += dx / steps;
    p.z += dz / steps;
    for (let it = 0; it < 3; it++) {
      let hit = false;
      for (const b of boxes) if (pushOutOfBox(p, r, b)) hit = true;
      for (const c of cyls) if (pushOutOfCyl(p, r, c)) hit = true;
      if (!hit) break;
    }
  }
}

export function circleBlocked(x: number, z: number, r: number, boxes: Box[], cyls: Cylinder[] = []): boolean {
  for (const b of boxes) {
    const cx = Math.max(b.x0, Math.min(x, b.x1));
    const cz = Math.max(b.z0, Math.min(z, b.z1));
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r - 1e-6) return true;
  }
  for (const c of cyls) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2 - 1e-6) return true;
  return false;
}

/** 门洞辅助：贴墙被挡时沿墙找最近可通行门洞。 */
export function findOpening(
  p: { x: number; z: number }, nx: number, nz: number, r: number, boxes: Box[],
  only = 0, reach = 1.2, ahead = 0.9, cyls: Cylinder[] = [],
): number {
  const tx = nz, tz = -nx;
  const open = [only >= 0, only <= 0];
  for (let o = 0.1; o <= reach + 1e-6; o += 0.1) {
    for (let i = 0; i < 2; i++) {
      if (!open[i]) continue;
      const side = i === 0 ? 1 : -1;
      const cx = p.x + tx * o * side + nx * 0.02, cz = p.z + tz * o * side + nz * 0.02;
      if (circleBlocked(cx, cz, r, boxes, cyls)) { open[i] = false; continue; }
      let clear = true;
      for (let a = 0.15; a <= ahead + 1e-6 && clear; a += 0.15) clear = !circleBlocked(cx - nx * a, cz - nz * a, r, boxes, cyls);
      if (clear) return side;
    }
  }
  return 0;
}

export function circleOverlapsBox(x: number, z: number, r: number, b: Box): boolean {
  const cx = Math.max(b.x0, Math.min(x, b.x1));
  const cz = Math.max(b.z0, Math.min(z, b.z1));
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

/** True only if the actor's body overlaps the box on the same vertical span. */
export function bodyOverlapsBox(p: { x: number; y: number; z: number }, r: number, b: Box): boolean {
  return overlapsY(b, p.y) && circleOverlapsBox(p.x, p.z, r, b);
}

/** 2D 线段与盒首个交点参数 t（slab 法），不相交 Infinity。导航用。 */
export function segBoxT(ax: number, az: number, bx: number, bz: number, b: Box): number {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (let axis = 0; axis < 2; axis++) {
    const o = axis === 0 ? ax : az, d = axis === 0 ? dx : dz;
    const lo = axis === 0 ? b.x0 : b.z0, hi = axis === 0 ? b.x1 : b.z1;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

/** 3D 线段与带竖向范围的盒首个交点参数 t。视线 / 镜头用。 */
export function segBox3T(ax: number, ay: number, az: number, bx: number, by: number, bz: number, b: Box): number {
  let t0 = 0, t1 = 1;
  const d = [bx - ax, by - ay, bz - az];
  const o = [ax, ay, az];
  const lo = [b.x0, b.y0 ?? 0, b.z0], hi = [b.x1, b.h, b.z1];
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(d[axis]) < 1e-9) {
      if (o[axis] < lo[axis] || o[axis] > hi[axis]) return Infinity;
    } else {
      let ta = (lo[axis] - o[axis]) / d[axis], tb = (hi[axis] - o[axis]) / d[axis];
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

function segCylHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: Cylinder, r: number): boolean {
  // 先按竖向范围粗判，再 2D 圆交
  const dy = by - ay;
  if (Math.abs(dy) > 1e-9) {
    const t0 = (c.y0 - ay) / dy, t1 = (c.h - ay) / dy;
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
    if (lo > hi) return false;
  } else if (ay < c.y0 || ay > c.h) return false;
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((c.x - ax) * dx + (c.z - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - c.x, pz = az + dz * t - c.z;
  return px * px + pz * pz < r * r;
}

/** 两点间 3D 直接视线。墙 / 楼板 / 关闭的门 / 高道具遮挡；矮道具与护栏不遮。 */
export function hasLineOfSight(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  doors: DoorOpen, ignoreDoor?: DoorId,
): boolean {
  for (const b of WALLS) if (segBox3T(ax, ay, az, bx, by, bz, b) !== Infinity) return false;
  for (const b of PROPS) if (b.los && segBox3T(ax, ay, az, bx, by, bz, b) !== Infinity) return false;
  for (const b of STAIR_MASS) if (segBox3T(ax, ay, az, bx, by, bz, b) !== Infinity) return false;
  for (const b of SLABS) if (segBox3T(ax, ay, az, bx, by, bz, b) !== Infinity) return false;
  for (const id of DOOR_IDS) {
    if (doors[id] || id === ignoreDoor) continue;
    if (segBox3T(ax, ay, az, bx, by, bz, DOORS[id].box) !== Infinity) return false;
  }
  for (const c of [WELL, ...COLUMNS]) if (segCylHit(ax, ay, az, bx, by, bz, c, c.losR)) return false;
  return true;
}

/** 镜头避墙：返回 a→b 可用比例（0–1），按盒高度过滤，含楼板与梯体。 */
export function cameraClearT(
  ax: number, az: number, ay: number, bx: number, bz: number, by: number, doors: DoorOpen,
): number {
  let best = 1;
  const test = (b: Box): void => {
    const t = segBox3T(ax, ay, az, bx, by, bz, b);
    if (t === Infinity || t >= best) return;
    best = t;
  };
  for (const b of CAMERA_WALLS) test(b);
  for (const b of PROPS) if (b.h > 1.2) test(b);
  for (const b of STAIR_MASS) test(b);
  for (const b of SLABS) test(b);
  for (const id of DOOR_IDS) if (!doors[id]) test(DOORS[id].box);
  return best;
}