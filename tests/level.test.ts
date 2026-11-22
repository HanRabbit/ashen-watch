// 关卡数据自检：节点不在障碍里、通道可走、交互点从站位可用、各修复组合都留有撤退路线。
import { describe, expect, it } from 'vitest';
import { PLAYER, WALL_LAMP } from '../src/config';
import { circleBlocked, hasLineOfSight, solidBoxes } from '../src/sim/collision';
import { DOORS, DoorId, EDGES, GHOST_SPAWN, INTERACTS, NODES, PATROL } from '../src/sim/level';
import { findNodePath, findPath, node, reachableFrom, walkClear } from '../src/sim/nav';
import { describe as describeTarget, pickTarget } from '../src/sim/sim';
import { newWorld } from '../src/sim/state';
import { STAND } from './driver';

const ALL_OPEN: Record<DoorId, boolean> = { gatehouse: true, gate: true, chapelFront: true, chapelSide: true };
const ALL_SHUT: Record<DoorId, boolean> = { gatehouse: false, gate: false, chapelFront: false, chapelSide: true };

describe('关卡数据', () => {
  it('导航节点都不在障碍物内', () => {
    const boxes = solidBoxes(ALL_SHUT);
    for (const n of NODES) expect(circleBlocked(n.x, n.z, PLAYER.radius, boxes), n.id).toBe(false);
  });

  it('每条通道在门打开时可直线行走，带门的通道在关门时被阻断', () => {
    const open = solidBoxes(ALL_OPEN);
    for (const e of EDGES) {
      const a = node(e.a), b = node(e.b);
      expect(walkClear(a.x, a.z, b.x, b.z, open, PLAYER.radius), `${e.a}-${e.b}`).toBe(true);
      if (e.door && e.door !== 'chapelSide') {
        const shut = solidBoxes({ ...ALL_OPEN, [e.door]: false });
        expect(walkClear(a.x, a.z, b.x, b.z, shut, PLAYER.radius), `${e.a}-${e.b} 关门`).toBe(false);
        expect(hasLineOfSight(a.x, a.z, b.x, b.z, { ...ALL_OPEN, [e.door]: false }), `${e.a}-${e.b} 视线`).toBe(false);
      }
    }
  });

  it('通行宽度：四个门洞净宽不小于 1.5 m', () => {
    for (const d of Object.values(DOORS)) {
      const w = Math.max(d.box.x1 - d.box.x0, d.box.z1 - d.box.z0);
      expect(w, d.id).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('所有节点在门全开时连通', () => {
    const seen = reachableFrom('gh_mid', { doors: ALL_OPEN, lit: [] });
    expect(seen.size).toBe(NODES.length);
  });

  it('两鬼的出生点与巡游锚点互不重叠', () => {
    const shared = PATROL.grey.filter((id) => PATROL.wraith.includes(id));
    expect(shared).toEqual([]);
    const g = GHOST_SPAWN.grey, w = GHOST_SPAWN.wraith;
    expect(Math.hypot(g.x - w.x, g.z - w.z)).toBeGreaterThan(10);
    const boxes = solidBoxes(ALL_SHUT);
    expect(circleBlocked(g.x, g.z, 0.4, boxes)).toBe(false);
    expect(circleBlocked(w.x, w.z, 0.4, boxes)).toBe(false);
  });

  it('不修栅门时主路可通，修好栅门后出现更短的近路', () => {
    const main = findPath({ x: 0, z: 1.2 }, { x: 19, z: 11 }, { doors: { ...ALL_OPEN, gate: false }, lit: [] });
    const short = findPath({ x: 0, z: 1.2 }, { x: 19, z: 11 }, { doors: ALL_OPEN, lit: [] });
    expect(main).not.toBeNull();
    expect(short).not.toBeNull();
    const len = (p: { x: number; z: number }[]): number => {
      let l = 0, x = 0, z = 1.2;
      for (const q of p) { l += Math.hypot(q.x - x, q.z - z); x = q.x; z = q.z; }
      return l;
    };
    expect(len(short!)).toBeLessThan(len(main!) * 0.65);
  });

  it('壁灯点亮后玩家回程仍有不经过亮区的鬼路线之外的撤退路径（鬼的可达区不含亮区节点）', () => {
    const lit = reachableFrom('c_n', { doors: ALL_OPEN, lit: [WALL_LAMP.zone] });
    expect(lit.has('c_w')).toBe(false);
    expect(lit.has('c_wellw')).toBe(false);
    // 亮区外的主路东侧仍连通，鬼不会被困死，也不会堵死唯一通道。
    expect(lit.has('c_s')).toBe(true);
    expect(findNodePath('c_n', 'c_s', { doors: ALL_OPEN, lit: [WALL_LAMP.zone] })).not.toBeNull();
  });

  it('每个交互点从站位出发都在 2 m 内、可见，并能被准星选中', () => {
    const stands: Record<string, { x: number; z: number }> = {
      lantern: STAND.lantern, board: STAND.board, refuel: STAND.refuel, hearth: STAND.hearth, pot: STAND.pot,
      woodpile: STAND.woodpile, ghDoor: STAND.doorIn, bolt: STAND.boltIn, bell: STAND.bell, shelf: STAND.shelf,
      lamp: STAND.lamp, gate: STAND.gateW, crate: STAND.crate, chapelFront: STAND.frontOut, flask: STAND.flask,
      chest: STAND.chest, cellar: { x: 11.75, z: 3.4 },
      cot: STAND.cot, brazierChapel: STAND.brazierChapel, brazierSide: STAND.brazierSide,
    };
    const boxes = solidBoxes(ALL_SHUT);
    for (const it of INTERACTS) {
      const s = stands[it.id];
      expect(s, it.id).toBeDefined();
      expect(circleBlocked(s.x, s.z, PLAYER.radius, boxes), `${it.id} 站位被挡`).toBe(false);
      const w = newWorld();
      w.player.x = s.x; w.player.z = s.z;
      w.player.yaw = Math.atan2(it.x - s.x, it.z - s.z);
      expect(Math.hypot(it.x - s.x, it.z - s.z), `${it.id} 距离`).toBeLessThanOrEqual(PLAYER.interactDist);
      expect(describeTarget(w, it.id), it.id).not.toBeNull();
      expect(pickTarget(w)?.id, `${it.id} 准星`).toBe(it.id);
    }
  });

  it('门的两侧都能操作同一扇门', () => {
    for (const [id, a, b] of [
      ['ghDoor', STAND.doorIn, STAND.doorOut], ['gate', STAND.gateW, STAND.gateE], ['chapelFront', STAND.frontOut, STAND.frontIn],
    ] as const) {
      const it = INTERACTS.find((i) => i.id === id)!;
      for (const s of [a, b]) {
        const w = newWorld();
        w.phase = 'day'; w.repairs.gate = true;
        w.player.x = s.x; w.player.z = s.z;
        w.player.yaw = Math.atan2(it.x - s.x, it.z - s.z);
        expect(pickTarget(w)?.id, `${id} @${s.x},${s.z}`).toBe(id);
      }
    }
  });
});
