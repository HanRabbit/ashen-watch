// 门洞通行：越肩镜头下偏在门洞两侧正对走都能穿过（含 2F 栅门、券廊、门厅隔墙）。
import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { circleBlocked, cylsAt, solidBoxes } from '../src/sim/collision';
import { DoorId, supportY } from '../src/sim/level';
import { Driver } from './driver';

interface Doorway {
  name: string;
  door?: DoorId;
  cx: number; cz: number; yaw: number; back: number;
  y?: number; floor?: 'B1' | '1F' | '2F'; half?: number;
}

const DOORWAYS: Doorway[] = [
  { name: '门房门（出）', door: 'gatehouse', cx: 0, cz: 0.25, yaw: 0, back: 1.6, half: 1.0 },
  { name: '门房门（进）', door: 'gatehouse', cx: 0, cz: 0.25, yaw: Math.PI, back: 1.6, half: 1.0 },
  { name: '券廊中 bay（向东）', cx: 10.25, cz: 16.5, yaw: Math.PI / 2, back: 1.6 },
  { name: '券廊中 bay（向西）', cx: 10.25, cz: 16.5, yaw: -Math.PI / 2, back: 1.6 },
  { name: '礼拜堂正门（进）', door: 'chapelFront', cx: 13.25, cz: 16.5, yaw: Math.PI / 2, back: 1.6, y: 0.45, half: 1.0 },
  { name: '礼拜堂正门（出）', door: 'chapelFront', cx: 13.25, cz: 16.5, yaw: -Math.PI / 2, back: 1.6, y: 0.45, half: 1.0 },
  { name: '门厅隔墙（向东）', cx: 17.7, cz: 12.7, yaw: Math.PI / 2, back: 1.2, y: 0.45 },
  { name: '门厅隔墙（向西）', cx: 17.7, cz: 12.7, yaw: -Math.PI / 2, back: 1.2, y: 0.45 },
  { name: '楼梯栅门（向东）', door: 'gate', cx: 24.0, cz: 21.15, yaw: Math.PI / 2, back: 0.5, y: 4, floor: '2F', half: 0.4 },
  { name: '楼梯栅门（向西）', door: 'gate', cx: 24.0, cz: 21.15, yaw: -Math.PI / 2, back: 0.5, y: 4, floor: '2F', half: 0.4 },
];

const THROUGH = 0.9;

function setup(dw: Doorway, offset: number, open = true): Driver | null {
  const d = new Driver();
  d.w.phase = 'day';
  if (dw.door) d.w.doors[dw.door] = open;
  const y = dw.y ?? 0;
  d.w.player.y = y; d.w.player.floor = dw.floor ?? '1F';
  const fx = Math.sin(dw.yaw), fz = Math.cos(dw.yaw);
  d.w.player.x = dw.cx - fx * dw.back + fz * offset;
  d.w.player.z = dw.cz - fz * dw.back - fx * offset;
  d.yaw = dw.yaw;
  const sup = supportY(d.w.player.x, d.w.player.z, y);
  if (dw.floor && (!sup || sup.floor !== dw.floor)) return null;
  return circleBlocked(d.w.player.x, d.w.player.z, PLAYER.radius, solidBoxes(d.w.doors, y), cylsAt(y)) ? null : d;
}

const depth = (d: Driver, dw: Doorway): number =>
  (d.w.player.x - dw.cx) * Math.sin(dw.yaw) + (d.w.player.z - dw.cz) * Math.cos(dw.yaw);

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
      const half = dw.half ?? 1.6;
      for (let off = -half; off <= half + 0.001; off += 0.05) {
        const d = setup(dw, off);
        if (!d) continue;
        tried++;
        const t = passTime(d, dw);
        expect(t, `偏移 ${off.toFixed(2)} m`).toBeGreaterThan(0);
        expect(t, `偏移 ${off.toFixed(2)} m 用时`).toBeLessThan(direct + Math.abs(off) / PLAYER.walkSpeed + 0.8);
      }
      expect(tried).toBeGreaterThan(10);
    });
  }

  it('关着的门不会被带过去，角色也不会被横向拖走', () => {
    for (const dw of DOORWAYS) {
      if (!dw.door || dw.floor === '2F') continue;
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
    d.w.player.x = 2.45; d.w.player.z = 3; // Unbroken south curtain, east of the gate.
    d.yaw = Math.PI;
    d.wait(3, { forward: 1 });
    expect(Math.abs(d.w.player.x - 2.45)).toBeLessThan(0.02);
    expect(d.w.player.z).toBeCloseTo(0.5 + PLAYER.radius, 2);
  });

  it('顶在长凳上不触发辅助：走到长凳前停住', () => {
    const d = new Driver();
    d.w.phase = 'day';
    d.w.player.x = 20.3; d.w.player.z = 16.2; d.w.player.y = 0.45;
    d.yaw = Math.PI; // 朝南走向 z15.5 长凳排
    d.wait(3, { forward: 1 });
    expect(Math.abs(d.w.player.x - 20.3)).toBeLessThan(0.02);
    expect(d.w.player.z).toBeCloseTo(15.5 + PLAYER.radius, 2);
  });

  it('斜着蹭墙时照常沿墙滑动', () => {
    const d = new Driver();
    d.w.phase = 'day';
    d.w.doors.gatehouse = true;
    d.w.player.x = -1.4; d.w.player.z = -0.6;
    d.yaw = -0.5;
    d.wait(1.5, { forward: 1 });
    expect(d.w.player.x).toBeLessThan(-1.8);
    expect(d.w.player.z).toBeLessThan(0);
  });
});