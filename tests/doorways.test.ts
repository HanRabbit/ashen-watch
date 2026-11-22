// 门洞通行：越肩镜头下角色偏在准星一侧，对着门洞走时常会顶在门框旁的墙上。
// 这里从各个横向偏移正对门洞按住前进，要求都能在合理时间内穿过去。
import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { circleBlocked, solidBoxes } from '../src/sim/collision';
import { DoorId } from '../src/sim/level';
import { Driver } from './driver';

interface Doorway {
  name: string;
  door?: DoorId;
  /** 门洞中心、穿行方向（朝向角）与起点到门洞中心的距离。 */
  cx: number; cz: number; yaw: number; back: number;
}

const DOORWAYS: Doorway[] = [
  { name: '门房门（出）', door: 'gatehouse', cx: 0, cz: 0.25, yaw: 0, back: 1.6 },
  { name: '门房门（进）', door: 'gatehouse', cx: 0, cz: 0.25, yaw: Math.PI, back: 1.6 },
  { name: '侧廊栅门（向东）', door: 'gate', cx: 10.25, cz: 6, yaw: Math.PI / 2, back: 1.6 },
  { name: '侧廊栅门（向西）', door: 'gate', cx: 10.25, cz: 6, yaw: -Math.PI / 2, back: 1.2 },
  { name: '外廊尖拱（向东）', cx: 10.25, cz: 27, yaw: Math.PI / 2, back: 1.6 },
  { name: '外廊尖拱（向西）', cx: 10.25, cz: 27, yaw: -Math.PI / 2, back: 1.6 },
  { name: '礼拜堂正门（进）', door: 'chapelFront', cx: 19, cz: 25.25, yaw: Math.PI, back: 1.6 },
  { name: '礼拜堂正门（出）', door: 'chapelFront', cx: 19, cz: 25.25, yaw: 0, back: 1.6 },
  { name: '礼拜堂侧门（向东）', cx: 13.25, cz: 16, yaw: Math.PI / 2, back: 1.2 },
  { name: '礼拜堂侧门（向西）', cx: 13.25, cz: 16, yaw: -Math.PI / 2, back: 1.2 },
  { name: '门厅隔墙（向南）', cx: 15.2, cz: 20.8, yaw: Math.PI, back: 1.2 },
  { name: '门厅隔墙（向北）', cx: 15.2, cz: 20.8, yaw: 0, back: 1.2 },
];

/** 越过门洞中心这么远算穿过（墙厚 0.5 m，碰撞体已完全出洞）。 */
const THROUGH = 0.9;

/** 把角色摆到门洞前、横移 offset（向右为正）处。起点在障碍里时返回 null。 */
function setup(dw: Doorway, offset: number, open = true): Driver | null {
  const d = new Driver();
  d.w.phase = 'day';
  if (dw.door) d.w.doors[dw.door] = open;
  const fx = Math.sin(dw.yaw), fz = Math.cos(dw.yaw);
  d.w.player.x = dw.cx - fx * dw.back + fz * offset;
  d.w.player.z = dw.cz - fz * dw.back - fx * offset;
  d.yaw = dw.yaw;
  return circleBlocked(d.w.player.x, d.w.player.z, PLAYER.radius, solidBoxes(d.w.doors)) ? null : d;
}

const depth = (d: Driver, dw: Doorway): number =>
  (d.w.player.x - dw.cx) * Math.sin(dw.yaw) + (d.w.player.z - dw.cz) * Math.cos(dw.yaw);

/** 正对门洞按住前进，返回穿过所用秒数，穿不过返回 -1。 */
function passTime(d: Driver, dw: Doorway, maxSecs = 6): number {
  for (let i = 0; i < maxSecs * 60; i++) {
    d.tick({ forward: 1 });
    if (depth(d, dw) >= THROUGH) return (i + 1) / 60;
  }
  return -1;
}

describe('门洞通行', () => {
  for (const dw of DOORWAYS) {
    it(`${dw.name}：偏在门洞两侧 1.6 m 以内正对着走都能穿过`, () => {
      const direct = (dw.back + THROUGH) / PLAYER.walkSpeed;
      let tried = 0;
      for (let off = -1.6; off <= 1.6001; off += 0.05) {
        const d = setup(dw, off);
        if (!d) continue;
        tried++;
        const t = passTime(d, dw);
        expect(t, `偏移 ${off.toFixed(2)} m`).toBeGreaterThan(0);
        // 沿墙横移按步行速度计，再留 0.8 秒余量
        expect(t, `偏移 ${off.toFixed(2)} m 用时`).toBeLessThan(direct + Math.abs(off) / PLAYER.walkSpeed + 0.8);
      }
      expect(tried).toBeGreaterThan(30);
    });
  }

  it('关着的门不会被带过去，角色也不会被横向拖走', () => {
    for (const dw of DOORWAYS) {
      if (!dw.door) continue;
      for (const off of [-1, 0, 1]) {
        const d = setup(dw, off, false);
        if (!d) continue;
        const x0 = d.w.player.x, z0 = d.w.player.z;
        d.wait(4, { forward: 1 });
        expect(depth(d, dw), `${dw.name} 偏移 ${off}`).toBeLessThan(0);
        const fx = Math.sin(dw.yaw), fz = Math.cos(dw.yaw);
        const lateral = (d.w.player.x - x0) * fz - (d.w.player.z - z0) * fx;
        expect(Math.abs(lateral), `${dw.name} 偏移 ${off} 横移`).toBeLessThan(0.02);
      }
    }
  });

  it('正对一整面实墙时停在墙前，不会被横向带走', () => {
    const d = new Driver();
    d.w.phase = 'day';
    d.w.player.x = -6; d.w.player.z = 3;
    d.yaw = Math.PI; // 朝南走向庭院南墙，最近的门洞在 5 m 外
    d.wait(3, { forward: 1 });
    expect(Math.abs(d.w.player.x + 6)).toBeLessThan(0.02);
    expect(d.w.player.z).toBeCloseTo(0.5 + PLAYER.radius, 2);
  });

  it('顶在陈设上不触发辅助：走到长凳前停住，不会自己绕过去', () => {
    const d = new Driver();
    d.w.phase = 'day';
    d.w.player.x = 17.6; d.w.player.z = 15.9; // 长凳东端内侧 0.4 m，端头外就是过道
    d.yaw = Math.PI;
    d.wait(3, { forward: 1 });
    expect(Math.abs(d.w.player.x - 17.6)).toBeLessThan(0.02);
    expect(d.w.player.z).toBeCloseTo(15.1 + PLAYER.radius, 2);
  });

  it('斜着蹭墙时照常沿墙滑动，不会被拉回身后的门洞', () => {
    const d = new Driver();
    d.w.phase = 'day';
    d.w.doors.gatehouse = true;
    d.w.player.x = -1.4; d.w.player.z = -0.6; // 门洞在右手边 0.6 m 外
    d.yaw = -0.5; // 朝左前方走
    d.wait(1.5, { forward: 1 });
    expect(d.w.player.x).toBeLessThan(-1.8);
    expect(d.w.player.z).toBeLessThan(0);
  });
});
