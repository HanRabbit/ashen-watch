// 房间节点 + 通道连接寻路（PRD 第 7 节）。节点带楼层；跨层只经楼梯边。
// 门开合与亮区即时改变可达性；亮区按楼层生效。
import { BRAZIER, BrazierId, LightZone, WALL_LAMP } from '../config';
import { Box, Cylinder, EDGES, FloorId, floorCandidates, INTERACTS, NavNode, NODES, STAIRS } from './level';
import { DoorOpen, segBoxT, solidBoxes, cylsAt } from './collision';
import { World } from './state';

const NODE_BY_ID = new Map<string, NavNode>(NODES.map((n) => [n.id, n]));
const ADJ = new Map<string, { to: string; door?: string; cost: number }[]>();
for (const n of NODES) ADJ.set(n.id, []);
for (const e of EDGES) {
  const a = NODE_BY_ID.get(e.a)!, b = NODE_BY_ID.get(e.b)!;
  // S1's short cellar landing costs extra maneuvering; don't send marginal
  // courtyard shortcuts down and back up through the basement.
  const cost = Math.hypot(a.x - b.x, a.z - b.z, a.y - b.y) + (e.a === 'c_s1top' && e.b === 'b_land' ? 12 : 0);
  ADJ.get(e.a)!.push({ to: e.b, door: e.door, cost });
  ADJ.get(e.b)!.push({ to: e.a, door: e.door, cost });
}

export interface NavCtx { doors: DoorOpen; lit: LightZone[] }

const BRAZIER_IDS = Object.keys(BRAZIER.zones) as BrazierId[];

export function litZones(w: World): LightZone[] {
  const out: LightZone[] = [];
  if (w.lampBurn > 0) out.push(WALL_LAMP.zone);
  for (const id of BRAZIER_IDS) if (w.braziers[id] > 0) out.push(BRAZIER.zones[id]);
  return out;
}

export function node(id: string): NavNode {
  return NODE_BY_ID.get(id)!;
}

export function inZone(zn: LightZone, x: number, z: number, margin = 0, floor?: FloorId): boolean {
  if (floor && zn.floor !== floor) return false;
  if (x < zn.x0 || x > zn.x1 || z < zn.z0 || z > zn.z1) return false;
  return (x - zn.x) ** 2 + (z - zn.z) ** 2 < (zn.r + margin) ** 2;
}

export function inAnyZone(lit: LightZone[], x: number, z: number, margin = 0, floor?: FloorId): boolean {
  for (const zn of lit) if (inZone(zn, x, z, margin, floor)) return true;
  return false;
}

function segHitsZone(zn: LightZone, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((zn.x - ax) * dx + (zn.z - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return inZone(zn, ax + dx * t, az + dz * t);
}

function segHitsLit(lit: LightZone[], ax: number, az: number, bx: number, bz: number, floor?: FloorId): boolean {
  for (const zn of lit) if ((!floor || zn.floor === floor) && segHitsZone(zn, ax, az, bx, bz)) return true;
  return false;
}

function nodeOpen(n: NavNode, ctx: NavCtx): boolean {
  return !inAnyZone(ctx.lit, n.x, n.z, 0, n.floor);
}

function edgeOpen(a: NavNode, b: NavNode, door: string | undefined, ctx: NavCtx): boolean {
  if (door && !ctx.doors[door as keyof DoorOpen]) return false;
  if (a.floor !== b.floor) return true; // 楼梯跨层边不受水平亮区阻挡
  return !segHitsLit(ctx.lit, a.x, a.z, b.x, b.z, a.floor);
}

/** 两点同层直线可走（半径膨胀盒 + 圆柱）。 */
export function walkClear(ax: number, az: number, bx: number, bz: number, boxes: Box[], r = 0.3, cyls: Cylinder[] = []): boolean {
  for (const b of boxes) {
    const inflated = { ...b, x0: b.x0 - r, z0: b.z0 - r, x1: b.x1 + r, z1: b.z1 + r };
    if (segBoxT(ax, az, bx, bz, inflated) !== Infinity) return false;
  }
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  for (const c of cyls) {
    let t = len2 > 0 ? ((c.x - ax) * dx + (c.z - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const wr = c.r + r;
    if ((ax + dx * t - c.x) ** 2 + (az + dz * t - c.z) ** 2 < wr * wr) return false;
  }
  return true;
}

export function nearestNode(x: number, z: number, floor: FloorId, y: number, ctx: NavCtx, needClear = true): NavNode | null {
  const boxes = solidBoxes(ctx.doors, y);
  const cyls = cylsAt(y);
  let best: NavNode | null = null, bestD = Infinity;
  for (const n of NODES) {
    if (n.floor !== floor || !nodeOpen(n, ctx)) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d >= bestD) continue;
    if (needClear && !walkClear(x, z, n.x, n.z, boxes, 0.3, cyls)) continue;
    best = n; bestD = d;
  }
  return best;
}

/** A*（启发为 3D 直线距离，可采纳）。 */
export function findNodePath(from: string, to: string, ctx: NavCtx): string[] | null {
  if (from === to) return [from];
  const goal = NODE_BY_ID.get(to)!;
  const open = new Set<string>([from]);
  const g = new Map<string, number>([[from, 0]]);
  const came = new Map<string, string>();
  const h = (id: string): number => {
    const n = NODE_BY_ID.get(id)!;
    return Math.hypot(n.x - goal.x, n.z - goal.z, n.y - goal.y);
  };
  while (open.size) {
    let cur = '', curF = Infinity;
    for (const id of open) {
      const f = g.get(id)! + h(id);
      if (f < curF) { curF = f; cur = id; }
    }
    if (cur === to) {
      const path = [cur];
      while (came.has(cur)) { cur = came.get(cur)!; path.push(cur); }
      return path.reverse();
    }
    open.delete(cur);
    const cn = NODE_BY_ID.get(cur)!;
    for (const e of ADJ.get(cur)!) {
      const nn = NODE_BY_ID.get(e.to)!;
      if (!nodeOpen(nn, ctx) || !edgeOpen(cn, nn, e.door, ctx)) continue;
      const ng = g.get(cur)! + e.cost;
      if (ng < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, ng); came.set(e.to, cur); open.add(e.to);
      }
    }
  }
  return null;
}

export interface PathPoint { x: number; z: number; y?: number; floor?: FloorId }

export function pathLength(p: PathPoint[], from: { x: number; z: number; y?: number }): number {
  let len = 0, px = from.x, pz = from.z, py = from.y ?? 0;
  for (const q of p) { len += Math.hypot(q.x - px, q.z - pz, (q.y ?? py) - py); px = q.x; pz = q.z; py = q.y ?? py; }
  return len;
}

/** 推断目标楼层：显式 floor → 唯一可走层 → 2.5m 内交互点所在层 → from.floor → 1F。 */
export function inferFloor(x: number, z: number, fromFloor?: FloorId, explicit?: FloorId): FloorId {
  if (explicit) return explicit;
  const cands = floorCandidates(x, z);
  if (cands.length === 1) return cands[0];
  for (const it of INTERACTS) {
    if (Math.hypot(it.x - x, it.z - z) < 2.5 && cands.includes(it.floor)) return it.floor;
  }
  if (fromFloor && cands.includes(fromFloor)) return fromFloor;
  return cands.includes('1F') ? '1F' : cands[0] ?? '1F';
}

/** 任意两点路径（含终点）。跨层经楼梯；终点不可直达时止于最近可达节点。 */
export function findPath(
  from: { x: number; z: number; y?: number; floor?: FloorId },
  to: { x: number; z: number; y?: number; floor?: FloorId },
  ctx: NavCtx, exactGoal = true,
): PathPoint[] | null {
  const fy = from.y ?? 0;
  const ff = from.floor ?? '1F';
  const tf = inferFloor(to.x, to.z, ff, to.floor);
  const ty = to.y ?? (tf === 'B1' ? -3 : tf === '2F' ? 4 : 0);
  const boxesF = solidBoxes(ctx.doors, fy);
  const cylsF = cylsAt(fy);
  if (ff === tf) {
    const lampBlocks = segHitsLit(ctx.lit, from.x, from.z, to.x, to.z, ff);
    if (!lampBlocks && walkClear(from.x, from.z, to.x, to.z, boxesF, 0.3, cylsF)) return [{ x: to.x, z: to.z, y: ty, floor: tf }];
  }
  let a = nearestNode(from.x, from.z, ff, fy, ctx) ?? nearestNode(from.x, from.z, ff, fy, ctx, false);
  // 起点在楼梯坡面上时，朝目标楼层的出口节点走，避免把身后端点加回导致振荡
  for (const st of STAIRS) {
    if (st.runs.some((r) => from.x >= r.x0 && from.x <= r.x1 && from.z >= r.z0 && from.z <= r.z1)) {
      const na = node(st.a), nb = node(st.b);
      a = na.floor === tf ? na : nb;
      break;
    }
  }
  const boxesT = solidBoxes(ctx.doors, ty);
  const cylsT = cylsAt(ty);
  const b = nearestNode(to.x, to.z, tf, ty, ctx) ?? nearestNode(to.x, to.z, tf, ty, ctx, false);
  if (!a || !b) return null;
  const ids = findNodePath(a.id, b.id, ctx);
  if (!ids) return null;
  const pts: PathPoint[] = ids.map((id) => { const n = NODE_BY_ID.get(id)!; return { x: n.x, z: n.z, y: n.y, floor: n.floor }; });
  while (pts.length > 1 && pts[0].floor === ff && pts[1].floor === ff && walkClear(from.x, from.z, pts[1].x, pts[1].z, boxesF, 0.3, cylsF)
    && !segHitsLit(ctx.lit, from.x, from.z, pts[1].x, pts[1].z, ff)) pts.shift();
  const last = pts[pts.length - 1];
  const goalLit = inAnyZone(ctx.lit, to.x, to.z, 0, tf);
  if (exactGoal && !goalLit && last.floor === tf && walkClear(last.x, last.z, to.x, to.z, boxesT, 0.3, cylsT)) {
    pts.push({ x: to.x, z: to.z, y: ty, floor: tf });
  }
  return pts;
}

export function reachableFrom(start: string, ctx: NavCtx): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    const cn = NODE_BY_ID.get(cur)!;
    for (const e of ADJ.get(cur)!) {
      const nn = NODE_BY_ID.get(e.to)!;
      if (seen.has(e.to) || !nodeOpen(nn, ctx) || !edgeOpen(cn, nn, e.door, ctx)) continue;
      seen.add(e.to); stack.push(e.to);
    }
  }
  return seen;
}