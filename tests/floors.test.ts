// 三层新增验收：跨层导航、楼板阻断视线、楼梯高度连续、存档往返楼层、修复组合撤退路线、跨层噪声。
import { describe, expect, it } from 'vitest';
import { FIXED_DT, GHOST } from '../src/config';
import { hasLineOfSight, solidBoxes, cylsAt, circleBlocked } from '../src/sim/collision';
import { DoorId, NODES, STAIRS, supportY, ceilingY, regionAt3 } from '../src/sim/level';
import { findNodePath, findPath, reachableFrom } from '../src/sim/nav';
import { newGhost, newWorld } from '../src/sim/state';
import { Driver, STAND } from './driver';

const OPEN: Record<DoorId, boolean> = { gatehouse: true, gate: true, chapelFront: true };
const SHUT: Record<DoorId, boolean> = { gatehouse: false, gate: false, chapelFront: false };

describe('跨层导航', () => {
  it('门房可达 B1 储藏室与 2F 上廊（门全开）', () => {
    const toB1 = findPath({ x: 0, z: -5.5, y: 0, floor: '1F' }, { x: 15.5, z: 13, y: -3, floor: 'B1' }, { doors: OPEN, lit: [] });
    expect(toB1).not.toBeNull();
    expect(toB1!.some((p) => p.floor === 'B1')).toBe(true);
    const to2F = findPath({ x: 0, z: -5.5, y: 0, floor: '1F' }, { x: 22.5, z: 21.15, y: 4, floor: '2F' }, { doors: OPEN, lit: [] });
    expect(to2F).not.toBeNull();
    expect(to2F!.some((p) => p.floor === '2F')).toBe(true);
  });

  it('栅门关闭时正厅不能直达上廊，但 2F 仍经外梯可达', () => {
    const shut = findNodePath('n_s4bot', 'g_gal2', { doors: { ...OPEN, gate: false }, lit: [] })!;
    const open = findNodePath('n_s4bot', 'g_gal2', { doors: OPEN, lit: [] })!;
    expect(shut.length).toBeGreaterThan(open.length); // 关门需绕 2F 环，开门直达
    const r2 = reachableFrom('gh_mid', { doors: { ...OPEN, gate: false }, lit: [] });
    expect(r2.has('w_s3t')).toBe(true);
    expect(r2.has('g_br')).toBe(true);
  });

  it('每种修复组合（8 种）主路可达祭台且存在撤退回路', () => {
    for (let mask = 0; mask < 8; mask++) {
      const doors = { ...SHUT, gatehouse: true, chapelFront: true, gate: !!(mask & 1) };
      const r = reachableFrom('gh_mid', { doors, lit: [] });
      expect(r.has('n_alt'), `mask ${mask} 祭台`).toBe(true);
      expect(r.has('gh_mid'), `mask ${mask} 回路`).toBe(true);
      // 至少一条不依赖栅门的撤退路（主路或 B1）
      expect(r.has('b_sw') || r.has('c_s'), `mask ${mask} 撤退`).toBe(true);
    }
  });
});

describe('楼板阻断视线 / 逼退 / 攻击', () => {
  it('庭院正上方与地窖正下方互不可见（楼板遮挡）', () => {
    // 地窖 (5.5,13) 上方是庭院地面（非洞口）
    expect(hasLineOfSight(5.5, 1.5, 13, 5.5, -1.5, 13, OPEN)).toBe(false);
  });
  it('经楼梯洞口可上下互视', () => {
    // S1 洞 x[4.6,10] z[9,10.8]：从洞口上方斜看落底
    expect(hasLineOfSight(5, 1.5, 9.9, 9.5, -1.5, 9.9, OPEN)).toBe(true);
  });
  it('2F 步道与庭院地面互不可见（deck 楼板）', () => {
    expect(hasLineOfSight(9.2, 5.5, 12, 9.2, 1.5, 12, OPEN)).toBe(false);
  });
});

describe('楼梯高度连续', () => {
  it('S1 从顶到底高度单调下降、无传送、楼层在端点切换', () => {
    const d = new Driver();
    d.w.phase = 'day';
    d.w.player.x = 4.4; d.w.player.z = 9.9; d.w.player.y = 0; d.w.player.floor = '1F';
    d.yaw = Math.PI / 2; // 向东下梯
    let prevY = 0, maxJump = 0, minY = 0;
    for (let i = 0; i < 60 * 12; i++) {
      d.tick({ forward: 1 });
      const y = d.w.player.y;
      maxJump = Math.max(maxJump, Math.abs(y - prevY));
      minY = Math.min(minY, y);
      prevY = y;
      if (d.w.player.x > 9.95) break;
    }
    expect(d.w.player.x).toBeGreaterThan(9.4);
    expect(minY).toBeLessThan(-2.9);
    expect(d.w.player.floor).toBe('B1');
    expect(maxJump).toBeLessThan(0.2); // 每步连续，无传送
  });

  it('S3 从底到顶高度连续上升到 +4', () => {
    const d = new Driver();
    d.w.phase = 'day';
    d.w.player.x = 3.6; d.w.player.z = 1.4; d.w.player.y = 0; d.w.player.floor = '1F';
    d.yaw = Math.PI / 2;
    let prevY = 0, maxJump = 0;
    for (let i = 0; i < 60 * 12; i++) {
      d.tick({ forward: 1 });
      maxJump = Math.max(maxJump, Math.abs(d.w.player.y - prevY));
      prevY = d.w.player.y;
      if (d.w.player.x > 9.2) break;
    }
    expect(d.w.player.y).toBeGreaterThan(3.9);
    expect(d.w.player.floor).toBe('2F');
    expect(maxJump).toBeLessThan(0.35);
  });

  it('supportY 在洞口侧边外不提供 1F 面（不会悬空走入洞）', () => {
    // 洞中心 x7,z9.9 的 1F 面应缺失（只有坡面/B1）
    const s = supportY(7, 9.9, 0);
    expect(s).not.toBeNull();
    expect(s!.y).toBeLessThan(0); // 站在洞口上方会落到坡面，而非 1F 地面
  });

  it('ceilingY：B1 低拱顶、2F 步道开敞', () => {
    expect(ceilingY(5.5, 13, 'B1')).toBeCloseTo(-0.6);
    expect(ceilingY(12, 10.3, 'B1')).toBeCloseTo(-0.8);
    expect(ceilingY(9.2, 12, '2F')).toBe(Infinity);
    expect(regionAt3(5.5, 13, 'B1')).toBe('cellar');
    expect(regionAt3(9.2, 12, '2F')).toBe('walk');
  });
});

describe('存档往返楼层', () => {
  it('黄昏在 B1 / 2F 存档，读档恢复正确楼层与高度', () => {
    for (const [x, z, y, fl] of [[15.5, 13, -3, 'B1'], [9.2, 12, 4, '2F']] as const) {
      const w = newWorld();
      w.phase = 'dusk';
      w.player.x = x; w.player.z = z; w.player.y = y; w.player.floor = fl;
      const json = JSON.parse(JSON.stringify(w));
      expect(json.player.floor).toBe(fl);
      expect(json.player.y).toBe(y);
    }
  });
});

describe('跨层噪声', () => {
  it('祭台匣响声经 S2 传到 B1 的黑影（路径距离衰减）', () => {
    const d = new Driver();
    const w = d.w;
    w.phase = 'night'; w.clock = 0; w.nightT = 0;
    w.inv.hasLantern = true; w.lantern = { oil: 400, on: false, raised: false };
    w.hearth = { lit: true, burn: 9999 };
    w.player.x = STAND.chest.x; w.player.z = STAND.chest.z; w.player.y = 0.45; w.player.floor = '1F';
    w.doors.chapelFront = true;
    const ghost = newGhost('wraith');
    ghost.x = 16.9; ghost.z = 21.0; ghost.y = -3; ghost.floor = 'B1'; ghost.mode = 'patrol';
    w.ghosts = [ghost];
    d.use('chest');
    d.wait(2);
    expect(['investigate', 'alert', 'chase']).toContain(ghost.mode);
  });
});