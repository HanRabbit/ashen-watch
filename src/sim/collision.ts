// 2D 碰撞与视线：圆对轴对齐盒、圆对井台、线段遮挡。墙、关闭的门各有独立碰撞（PRD 9.2）。
import { Box, DOORS, DoorId, PROPS, WALLS, WELL } from './level';

export type DoorOpen = Record<DoorId, boolean>;

const DOOR_IDS = Object.keys(DOORS) as DoorId[];

/** 当前生效的阻挡盒：墙、道具与关闭的门。 */
export function solidBoxes(doors: DoorOpen): Box[] {
  const out = WALLS.concat(PROPS);
  for (const id of DOOR_IDS) if (!doors[id]) out.push(DOORS[id].box);
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
  // 圆心在盒内：沿最近的面推出。
  const l = p.x - b.x0, rt = b.x1 - p.x, n = p.z - b.z0, f = b.z1 - p.z;
  const m = Math.min(l, rt, n, f);
  dx = 0; dz = 0;
  if (m === l) dx = -(l + r); else if (m === rt) dx = rt + r; else if (m === n) dz = -(n + r); else dz = f + r;
  p.x += dx; p.z += dz;
  return true;
}

function pushOutOfWell(p: { x: number; z: number }, r: number): boolean {
  const dx = p.x - WELL.x, dz = p.z - WELL.z;
  const min = WELL.r + r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 1e-4;
  p.x = WELL.x + (dx / d) * min;
  p.z = WELL.z + (dz / d) * min;
  return true;
}

/**
 * 移动一个圆形碰撞体并解算穿插。分小步推进，单步位移不超过半径的一半，
 * 高倍速或掉帧时也不会穿墙。
 */
export function moveCircle(p: { x: number; z: number }, dx: number, dz: number, r: number, boxes: Box[]): void {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
  for (let s = 0; s < steps; s++) {
    p.x += dx / steps;
    p.z += dz / steps;
    for (let it = 0; it < 3; it++) {
      let hit = false;
      for (const b of boxes) if (pushOutOfBox(p, r, b)) hit = true;
      if (pushOutOfWell(p, r)) hit = true;
      if (!hit) break;
    }
  }
}

export function circleBlocked(x: number, z: number, r: number, boxes: Box[]): boolean {
  for (const b of boxes) {
    const cx = Math.max(b.x0, Math.min(x, b.x1));
    const cz = Math.max(b.z0, Math.min(z, b.z1));
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r - 1e-6) return true;
  }
  return (x - WELL.x) ** 2 + (z - WELL.z) ** 2 < (WELL.r + r) ** 2 - 1e-6;
}

/**
 * 门洞辅助用：角色贴着一面墙（法线 nx、nz 指向角色）往里走却被挡住时，
 * 沿墙面在 reach 米内找最近的、往墙里 ahead 米都走得通的位置。
 * 返回应沿切向 (nz, -nx) 移动的方向（1 或 -1），找不到返回 0。only 非零时只找这一侧。
 */
export function findOpening(
  p: { x: number; z: number }, nx: number, nz: number, r: number, boxes: Box[],
  only = 0, reach = 1.2, ahead = 0.9,
): number {
  const tx = nz, tz = -nx;
  const open = [only >= 0, only <= 0];
  for (let o = 0.1; o <= reach + 1e-6; o += 0.1) {
    for (let i = 0; i < 2; i++) {
      if (!open[i]) continue;
      const side = i === 0 ? 1 : -1;
      // 探测点略微离墙，避免把贴墙的浮点误差算成穿插
      const cx = p.x + tx * o * side + nx * 0.02, cz = p.z + tz * o * side + nz * 0.02;
      // 沿墙的路上被挡住，这一侧不再往远处找
      if (circleBlocked(cx, cz, r, boxes)) { open[i] = false; continue; }
      let clear = true;
      for (let a = 0.15; a <= ahead + 1e-6 && clear; a += 0.15) clear = !circleBlocked(cx - nx * a, cz - nz * a, r, boxes);
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

/** 线段与盒的首个交点参数 t∈[0,1]，不相交返回 Infinity（slab 法）。 */
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

function segCircleHit(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((cx - ax) * dx + (cz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - cx, pz = az + dz * t - cz;
  return px * px + pz * pz < r * r;
}

/** 两点间是否有直接视线。关闭的门与实墙遮挡；矮道具不遮挡。 */
export function hasLineOfSight(
  ax: number, az: number, bx: number, bz: number, doors: DoorOpen, ignoreDoor?: DoorId,
): boolean {
  for (const b of WALLS) if (segBoxT(ax, az, bx, bz, b) !== Infinity) return false;
  for (const b of PROPS) if (b.los && segBoxT(ax, az, bx, bz, b) !== Infinity) return false;
  for (const id of DOOR_IDS) {
    if (doors[id] || id === ignoreDoor) continue;
    if (segBoxT(ax, az, bx, bz, DOORS[id].box) !== Infinity) return false;
  }
  return !segCircleHit(ax, az, bx, bz, WELL.x, WELL.z, WELL.losR);
}

/** 镜头避墙：返回从 a 到 b 的可用比例（0–1），按盒高度过滤。 */
export function cameraClearT(
  ax: number, az: number, ay: number, bx: number, bz: number, by: number, doors: DoorOpen,
): number {
  let best = 1;
  const test = (b: Box): void => {
    const t = segBoxT(ax, az, bx, bz, b);
    if (t === Infinity || t >= best) return;
    const yAt = ay + (by - ay) * t;
    if (yAt <= b.h + 0.15) best = t;
  };
  for (const b of WALLS) test(b);
  for (const b of PROPS) if (b.h > 1.2) test(b);
  for (const id of DOOR_IDS) if (!doors[id]) test(DOORS[id].box);
  return best;
}
