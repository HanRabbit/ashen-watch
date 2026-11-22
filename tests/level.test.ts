// 关卡数据自检：节点不在障碍里、通道可走、交互点可用、各修复组合都留撤退路线（三层）。
import { describe, expect, it } from 'vitest';
import { PLAYER, WALL_LAMP } from '../src/config';
import { circleBlocked, cylsAt, hasLineOfSight, solidBoxes } from '../src/sim/collision';
import { DOORS, DoorId, EDGES, GHOST_SPAWN, INTERACTS, NODES, PATROL } from '../src/sim/level';
import { findNodePath, findPath, node, reachableFrom, walkClear } from '../src/sim/nav';
import { describe as describeTarget, pickTarget } from '../src/sim/sim';
import { newWorld } from '../src/sim/state';
import { STAND } from './driver';

const ALL_OPEN: Record<DoorId, boolean> = { gatehouse: true, gate: true, chapelFront: true };
const ALL_SHUT: Record<DoorId, boolean> = { gatehouse: false, gate: false, chapelFront: false };

describe('关卡数据（三层）', () => {
  it('导航节点都不在障碍物内', () => {
    for (const n of NODES) {
      const boxes = solidBoxes(ALL_SHUT, n.y);
      expect(circleBlocked(n.x, n.z, PLAYER.radius, boxes, cylsAt(n.y)), n.id).toBe(false);
    }
  });

  it('同层通道门开时可直线行走；带门的通道关门时被阻断', () => {
    for (const e of EDGES) {
      const a = node(e.a), b = node(e.b);
      if (a.floor !== b.floor) continue; // 楼梯跨层边为坡面，单独测
      const open = solidBoxes(ALL_OPEN, a.y);
      expect(walkClear(a.x, a.z, b.x, b.z, open, PLAYER.radius, cylsAt(a.y)), `${e.a}-${e.b}`).toBe(true);
      if (e.door) {
        const shut = solidBoxes({ ...ALL_OPEN, [e.door]: false }, a.y);
        expect(walkClear(a.x, a.z, b.x, b.z, shut, PLAYER.radius, cylsAt(a.y)), `${e.a}-${e.b} 关门`).toBe(false);
        expect(hasLineOfSight(a.x, a.y + 1.5, a.z, b.x, b.y + 1.5, b.z, { ...ALL_OPEN, [e.door]: false }), `${e.a}-${e.b} 视线`).toBe(false);
      }
    }
  });

  it('通行宽度：门洞净宽不小于 1.5 m', () => {
    for (const d of Object.values(DOORS)) {
      const w = Math.max(d.box.x1 - d.box.x0, d.box.z1 - d.box.z0);
      expect(w, d.id).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('所有节点在门全开时连通（含 B1/2F）', () => {
    const seen = reachableFrom('gh_mid', { doors: ALL_OPEN, lit: [] });
    expect(seen.size).toBe(NODES.length);
  });

  it('两鬼出生点与巡游锚点互不重叠', () => {
    const shared = PATROL.grey.filter((id) => PATROL.wraith.includes(id));
    expect(shared).toEqual([]);
    const g = GHOST_SPAWN.grey, w = GHOST_SPAWN.wraith;
    expect(Math.hypot(g.x - w.x, g.z - w.z, g.y - w.y)).toBeGreaterThan(10);
    expect(circleBlocked(g.x, g.z, 0.4, solidBoxes(ALL_SHUT, g.y), cylsAt(g.y))).toBe(false);
    expect(circleBlocked(w.x, w.z, 0.4, solidBoxes(ALL_SHUT, w.y), cylsAt(w.y))).toBe(false);
  });

  it('不修栅门时主路可通；修好栅门后 2F 近路成立且主路仍在', () => {
    const main = findPath({ x: 0, z: 1.2, y: 0, floor: '1F' }, { x: 28, z: 16.5, y: 0.45, floor: '1F' }, { doors: { ...ALL_OPEN, gate: false }, lit: [] });
    expect(main).not.toBeNull();
    const withGate = reachableFrom('gh_mid', { doors: ALL_OPEN, lit: [] });
    expect(withGate.has('g_gal2')).toBe(true);
    expect(withGate.has('n_alt')).toBe(true);
    const noGate = { doors: { ...ALL_OPEN, gate: false }, lit: [] };
    expect(reachableFrom('gh_mid', noGate).has('n_alt')).toBe(true); // 主路不受栅门影响
    expect(findNodePath('g_land', 'g_gal2', noGate)!.length).toBeGreaterThan(findNodePath('g_land', 'g_gal2', { doors: ALL_OPEN, lit: [] })!.length); // 未修需绕远路
    expect(reachableFrom('gh_mid', noGate).has('w_s3t')).toBe(true); // 2F 仍可经外梯到达
  });

  it('壁灯点亮后鬼的可达区不含亮区节点，且主路东侧仍连通', () => {
    const ctx = { doors: ALL_OPEN, lit: [WALL_LAMP.zone] };
    const lit = reachableFrom('c_ne', ctx);
    expect(lit.has('c_nw')).toBe(false); // 亮区节点不可达
    expect(lit.has('c_n')).toBe(false);
    expect(lit.has('c_s')).toBe(true);
    expect(findNodePath('c_ne', 'c_s', ctx)).not.toBeNull();
  });

  it('每个交互点从站位出发都在 2 m 内、可见、能被准星选中', () => {
    const stands: Record<string, { x: number; z: number; y?: number; floor?: 'B1' | '1F' | '2F' }> = {
      lantern: STAND.lantern, board: STAND.board, refuel: STAND.refuel, hearth: STAND.hearth, pot: STAND.pot,
      woodpile: STAND.woodpile, ghDoor: STAND.doorIn, bolt: STAND.boltIn, bell: STAND.bell, shelf: STAND.shelf,
      lamp: STAND.lamp, gate: STAND.gateW, crate: { ...STAND.crate, y: 0.45 }, chapelFront: { ...STAND.frontOut, y: 0.45 }, flask: STAND.flask,
      chest: { ...STAND.chest, y: 0.45 }, cellar: STAND.cellar, cot: STAND.cot, brazierChapel: { ...STAND.brazierChapel, y: 0.45 }, brazierSide: STAND.brazierSide,
    };
    for (const it of INTERACTS) {
      const s = stands[it.id];
      expect(s, it.id).toBeDefined();
      const y = s.y ?? (it.floor === 'B1' ? -3 : it.floor === '2F' ? 4 : 0);
      const w = newWorld();
      w.player.x = s.x; w.player.z = s.z; w.player.y = y; w.player.floor = it.floor;
      expect(circleBlocked(s.x, s.z, PLAYER.radius, solidBoxes(ALL_SHUT, y), cylsAt(y)), `${it.id} 站位被挡`).toBe(false);
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
        w.player.x = s.x; w.player.z = s.z; w.player.y = it.floor === '2F' ? 4 : 0; w.player.floor = it.floor;
        w.player.yaw = Math.atan2(it.x - s.x, it.z - s.z);
        expect(pickTarget(w)?.id, `${id} @${s.x},${s.z}`).toBe(id);
      }
    }
  });
});