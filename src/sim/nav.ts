// 房间节点 + 通道连接的寻路（PRD 第 7 节）。门的开合与亮区即时改变节点和边的可达性。
import { BRAZIER, BrazierId, LightZone, WALL_LAMP } from '../config';
import { Box, EDGES, NavNode, NODES, WELL } from './level';
import { DoorOpen, segBoxT, solidBoxes } from './collision';
import { Vec2, World } from './state';

const NODE_BY_ID = new Map<string, NavNode>(NODES.map((n) => [n.id, n]));
const ADJ = new Map<string, { to: string; door?: string; cost: number }[]>();
for (const n of NODES) ADJ.set(n.id, []);
for (const e of EDGES) {
  const a = NODE_BY_ID.get(e.a)!, b = NODE_BY_ID.get(e.b)!;
  const cost = Math.hypot(a.x - b.x, a.z - b.z);
  ADJ.get(e.a)!.push({ to: e.b, door: e.door, cost });
  ADJ.get(e.b)!.push({ to: e.a, door: e.door, cost });
}

/** lit 是当前点亮的固定光源亮区（壁灯与火盆），鬼不进入。 */
export interface NavCtx { doors: DoorOpen; lit: LightZone[] }

const BRAZIER_IDS = Object.keys(BRAZIER.zones) as BrazierId[];

/** 当前点亮的亮区。 */
export function litZones(w: World): LightZone[] {
  const out: LightZone[] = [];
  if (w.lampBurn > 0) out.push(WALL_LAMP.zone);
  for (const id of BRAZIER_IDS) if (w.braziers[id] > 0) out.push(BRAZIER.zones[id]);
  return out;
}

export function node(id: string): NavNode {
  return NODE_BY_ID.get(id)!;
}

export function inZone(zn: LightZone, x: number, z: number, margin = 0): boolean {
  if (x < zn.x0 || x > zn.x1 || z < zn.z0 || z > zn.z1) return false;
  return (x - zn.x) ** 2 + (z - zn.z) ** 2 < (zn.r + margin) ** 2;
}

export function inAnyZone(lit: LightZone[], x: number, z: number, margin = 0): boolean {
  for (const zn of lit) if (inZone(zn, x, z, margin)) return true;
  return false;
}

/** 线段上离亮区中心最近的一点是否落在亮区内。亮区不穿墙，线段也不会穿墙，取这一点就够了。 */
function segHitsZone(zn: LightZone, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((zn.x - ax) * dx + (zn.z - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return inZone(zn, ax + dx * t, az + dz * t);
}

function segHitsLit(lit: LightZone[], ax: number, az: number, bx: number, bz: number): boolean {
  for (const zn of lit) if (segHitsZone(zn, ax, az, bx, bz)) return true;
  return false;
}

function nodeOpen(n: NavNode, ctx: NavCtx): boolean {
  return !inAnyZone(ctx.lit, n.x, n.z);
}

function edgeOpen(a: NavNode, b: NavNode, door: string | undefined, ctx: NavCtx): boolean {
  if (door && !ctx.doors[door as keyof DoorOpen]) return false;
  return !segHitsLit(ctx.lit, a.x, a.z, b.x, b.z);
}

/** 两点间能否直线行走（半径膨胀后的盒与井台均不相交）。 */
export function walkClear(ax: number, az: number, bx: number, bz: number, boxes: Box[], r = 0.3): boolean {
  for (const b of boxes) {
    const inflated = { ...b, x0: b.x0 - r, z0: b.z0 - r, x1: b.x1 + r, z1: b.z1 + r };
    if (segBoxT(ax, az, bx, bz, inflated) !== Infinity) return false;
  }
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((WELL.x - ax) * dx + (WELL.z - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const wr = WELL.r + r;
  return (ax + dx * t - WELL.x) ** 2 + (az + dz * t - WELL.z) ** 2 >= wr * wr;
}

/** 距某点最近、且可直线走到的开放节点。 */
export function nearestNode(x: number, z: number, ctx: NavCtx, boxes: Box[], needClear = true): NavNode | null {
  let best: NavNode | null = null, bestD = Infinity;
  for (const n of NODES) {
    if (!nodeOpen(n, ctx)) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d >= bestD) continue;
    if (needClear && !walkClear(x, z, n.x, n.z, boxes)) continue;
    best = n; bestD = d;
  }
  return best;
}

/** A*（启发为直线距离，边权为直线距离，满足可采纳性）。 */
export function findNodePath(from: string, to: string, ctx: NavCtx): string[] | null {
  if (from === to) return [from];
  const goal = NODE_BY_ID.get(to)!;
  const open = new Set<string>([from]);
  const g = new Map<string, number>([[from, 0]]);
  const came = new Map<string, string>();
  const h = (id: string): number => {
    const n = NODE_BY_ID.get(id)!;
    return Math.hypot(n.x - goal.x, n.z - goal.z);
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

export function pathLength(p: Vec2[], from: Vec2): number {
  let len = 0, px = from.x, pz = from.z;
  for (const q of p) { len += Math.hypot(q.x - px, q.z - pz); px = q.x; pz = q.z; }
  return len;
}

/**
 * 任意两点间的路径（路点序列，含终点）。无有效路径返回 null。
 * 终点不可直达时，路径止于离它最近的可达节点。
 */
export function findPath(from: Vec2, to: Vec2, ctx: NavCtx, exactGoal = true): Vec2[] | null {
  const boxes = solidBoxes(ctx.doors);
  const lampBlocksDirect = segHitsLit(ctx.lit, from.x, from.z, to.x, to.z);
  if (!lampBlocksDirect && walkClear(from.x, from.z, to.x, to.z, boxes)) return [{ x: to.x, z: to.z }];
  const a = nearestNode(from.x, from.z, ctx, boxes) ?? nearestNode(from.x, from.z, ctx, boxes, false);
  const b = nearestNode(to.x, to.z, ctx, boxes) ?? nearestNode(to.x, to.z, ctx, boxes, false);
  if (!a || !b) return null;
  const ids = findNodePath(a.id, b.id, ctx);
  if (!ids) return null;
  const pts: Vec2[] = ids.map((id) => ({ x: NODE_BY_ID.get(id)!.x, z: NODE_BY_ID.get(id)!.z }));
  // 起点已能直达第二个节点时跳过第一个，避免回头。
  while (pts.length > 1 && walkClear(from.x, from.z, pts[1].x, pts[1].z, boxes)
    && !segHitsLit(ctx.lit, from.x, from.z, pts[1].x, pts[1].z)) pts.shift();
  const last = pts[pts.length - 1];
  const goalLit = inAnyZone(ctx.lit, to.x, to.z);
  if (exactGoal && !goalLit && walkClear(last.x, last.z, to.x, to.z, boxes)) pts.push({ x: to.x, z: to.z });
  return pts;
}

/** 从节点出发可达的节点集合（给定门与亮区状态）。 */
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
