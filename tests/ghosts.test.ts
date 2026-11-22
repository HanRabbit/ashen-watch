// 双鬼：感知、门与灯的反应、共享攻击间隔、门闩与晨曦清场（对应验收 A05、A06、A10）。
import { describe, expect, it } from 'vitest';
import { BRAZIER, BrazierId, FIXED_DT, GHOST, PHASE, WALL_LAMP } from '../src/config';
import { inZone } from '../src/sim/nav';
import { GhostKind, GhostState, newGhost, World } from '../src/sim/state';
import { Driver, STAND } from './driver';

/** 直接布置一个夜间场景：玩家与两鬼的位置由测试指定。 */
function nightScene(px: number, pz: number, py = 0, pf: 'B1'|'1F'|'2F' = '1F'): Driver {
  const d = new Driver();
  const w = d.w;
  w.phase = 'night'; w.clock = 0; w.nightT = 0;
  w.inv.hasLantern = true; w.quest.boardRead = true;
  w.lantern = { oil: 400, on: false, raised: false };
  w.hearth = { lit: true, burn: 9999 };
  w.player.x = px; w.player.z = pz; w.player.y = py; w.player.floor = pf;
  w.ghosts = [];
  return d;
}

function place(w: World, kind: GhostKind, x: number, z: number, mode: GhostState['mode'] = 'patrol', y?: number, floor?: 'B1'|'1F'|'2F'): GhostState {
  const g = newGhost(kind);
  g.x = x; g.z = z; g.mode = mode;
  g.y = y ?? 0; g.floor = floor ?? '1F';
  g.yaw = Math.atan2(w.player.x - x, w.player.z - z);
  if (mode === 'chase') { g.canSee = true; g.lastKnown = { x: w.player.x, z: w.player.z }; }
  w.ghosts.push(g);
  return g;
}

const zoneDist = (g: { x: number; z: number }): number => Math.hypot(g.x - WALL_LAMP.zone.x, g.z - WALL_LAMP.zone.z);

describe('察觉与预警', () => {
  it('灰影察觉后先转头停顿约 1 秒再接近，并给出音效和字幕', () => {
    const d = nightScene(0, 20);
    d.w.lantern.on = true;
    const g = place(d.w, 'grey', 0, 26);
    d.waitUntil(() => g.mode === 'alert', 2);
    expect(g.mode).toBe('alert');
    const x0 = g.x, z0 = g.z;
    d.wait(GHOST.alertPause - 0.1);
    expect(g.mode).toBe('alert');
    expect(Math.hypot(g.x - x0, g.z - z0)).toBeLessThan(0.01);
    d.wait(0.3);
    expect(g.mode).toBe('chase');
    expect(d.events.some((e) => e.id === 'greyAlert')).toBe(true);
    expect(d.texts().some((t) => t.includes('灰影') && t.includes('察觉'))).toBe(true);
  });

  it('两种鬼的警觉与扑击预警各不相同（音效 id 与字幕）', () => {
    const d = nightScene(0, 20);
    d.w.lantern.on = true;
    place(d.w, 'grey', -4, 23);
    place(d.w, 'wraith', 4, 23);
    d.wait(8);
    const ids = new Set(d.events.filter((e) => e.kind === 'sfx').map((e) => e.id));
    expect(ids.has('greyAlert')).toBe(true);
    expect(ids.has('wraithAlert')).toBe(true);
    expect(ids.has('greyWindup') || ids.has('wraithWindup')).toBe(true);
    expect(d.texts().some((t) => t.startsWith('【灰影】'))).toBe(true);
    expect(d.texts().some((t) => t.startsWith('【黑影】'))).toBe(true);
  });

  it('关灯站在暗处时察觉距离明显缩短', () => {
    const lit = nightScene(6, 12); lit.w.lantern.on = true;
    const g1 = place(lit.w, 'grey', 6, 22);
    lit.tick(); lit.tick();
    expect(g1.canSee).toBe(true);
    const dark = nightScene(6, 12);
    const g2 = place(dark.w, 'grey', 6, 22);
    dark.tick(); dark.tick();
    expect(g2.canSee).toBe(false);
    // 走近到暗处察觉距离以内就会被看见
    dark.w.player.z = 22 - GHOST.grey.sightDark + 0.5;
    dark.wait(0.3);
    expect(g2.canSee).toBe(true);
  });

  it('冲刺的声音会把灰影引来调查', () => {
    const d = nightScene(8, 3);
    const g = place(d.w, 'grey', 7, 11);
    g.yaw = 0; // 背对玩家
    d.face(-8, 3);
    d.wait(0.5, { forward: 1, sprint: true });
    expect(['investigate', 'alert', 'chase']).toContain(g.mode);
  });

  it('打开祭台匣的响声会把两只鬼引向祭台', () => {
    const d = nightScene(STAND.chest.x, STAND.chest.z);
    d.w.doors.chapelFront = true;
    const a = place(d.w, 'grey', 0, 23); a.yaw = Math.PI;
    const b = place(d.w, 'wraith', 16.9, 21.0, 'patrol', -3, 'B1'); b.yaw = Math.PI;
    expect(d.use('chest')).toBe(true);
    expect(a.mode).toBe('investigate');
    expect(b.mode).toBe('investigate');
  });
});

describe('共享攻击许可（A06）', () => {
  it('两鬼同时逼近时不会并发扑击，相邻两次前摇至少间隔 2 秒', () => {
    const d = nightScene(0, 20);
    place(d.w, 'grey', -2.4, 20, 'chase');
    place(d.w, 'wraith', 2.4, 20, 'chase');
    const starts: { t: number; kind: string }[] = [];
    const ends: number[] = [];
    let prev = new Map<string, string>();
    let maxConcurrent = 0;
    d.onStep = (w) => {
      let n = 0;
      for (const g of w.ghosts) {
        if (g.mode === 'windup') n++;
        const was = prev.get(g.kind);
        if (g.mode === 'windup' && was !== 'windup') starts.push({ t: w.nightT, kind: g.kind });
        if (g.mode !== 'windup' && was === 'windup') ends.push(w.nightT);
      }
      maxConcurrent = Math.max(maxConcurrent, n);
      prev = new Map(w.ghosts.map((g) => [g.kind, g.mode]));
    };
    d.wait(30);
    expect(maxConcurrent).toBe(1);
    expect(starts.length).toBeGreaterThanOrEqual(3);
    expect(new Set(starts.map((s) => s.kind)).size).toBe(2);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i].t - ends[i - 1]).toBeGreaterThanOrEqual(GHOST.sharedAttackGap - FIXED_DT * 1.5);
    }
  });

  it('另一只鬼在前摇时，这一只保持等待', () => {
    const d = nightScene(0, 20);
    const a = place(d.w, 'grey', -1.5, 20, 'chase');
    const b = place(d.w, 'wraith', 1.5, 20, 'chase');
    d.waitUntil(() => a.mode === 'windup' || b.mode === 'windup', 3);
    const other = a.mode === 'windup' ? b : a;
    d.tick();
    expect(other.mode).toBe('chase');
    expect(other.waiting).toBe(true);
  });
});

describe('退避（A06）', () => {
  it('扑击前摇中举灯：本次不掉血；只要举着它就一直退，照够时间后退走一阵子', () => {
    const d = nightScene(0, 20);
    const g = place(d.w, 'grey', 1.5, 20, 'chase');
    d.waitUntil(() => g.mode === 'windup', 3);
    expect(g.mode).toBe('windup');
    d.tick({ raise: true });
    expect(g.mode).toBe('recoil');
    expect(d.w.attack.holder).toBeNull();
    let windups = 0;
    d.onStep = () => { if (g.mode === 'windup') windups++; };
    d.wait(GHOST.giveUpAfter - 0.3, { raise: true });
    expect(g.mode).toBe('recoil');
    // 照够时间：它放弃，退回巡游，这段时间看不见玩家
    d.wait(0.6, { raise: true });
    expect(g.mode).toBe('patrol');
    expect(g.cowed).toBeGreaterThan(0);
    expect(d.texts().some((t) => t.includes('退走了'))).toBe(true);
    d.wait(GHOST.cowedSecs - 1.5);
    expect(g.mode).toBe('patrol');
    expect(windups).toBe(0);
    expect(d.w.player.hp).toBe(100);
    expect(d.events.filter((e) => e.id === 'recoil').length).toBe(1);
  });

  it('一直举着灯站在两只鬼面前 30 秒：一次也不会被扑', () => {
    const d = nightScene(0, 20);
    place(d.w, 'grey', -2.4, 20, 'chase');
    place(d.w, 'wraith', 2.4, 20, 'chase');
    let windups = 0;
    d.onStep = (w) => { if (w.ghosts.some((g) => g.mode === 'windup')) windups++; };
    d.wait(30, { raise: true });
    expect(windups).toBe(0);
    expect(d.w.player.hp).toBe(100);
    // 代价是油：30 秒耗掉约 90 秒的量
    expect(400 - d.w.lantern.oil).toBeGreaterThan(85);
  });

  it('举一下就放：它只多退一小会儿，退走的那阵子过后还会回来', () => {
    const d = nightScene(0, 20);
    const g = place(d.w, 'grey', 3, 20, 'chase');
    d.wait(0.5, { raise: true });
    expect(g.mode).toBe('recoil');
    d.wait(GHOST.repelDuration + 0.3);
    expect(g.mode).toBe('chase');
    d.wait(8);
    expect(d.w.player.hp).toBeLessThan(100);
  });

  it('第一次被发现时提示举灯，只提示一次', () => {
    const d = nightScene(0, 20);
    d.w.lantern.on = true;
    place(d.w, 'grey', 0, 26);
    place(d.w, 'wraith', 4, 26);
    d.wait(4);
    expect(d.w.hints.raise).toBe(true);
    expect(d.events.filter((e) => e.kind === 'toast' && e.text!.includes('按住右键举灯')).length).toBe(1);
  });

  it('黑影看见举灯会退开', () => {
    const d = nightScene(0, 20);
    const g = place(d.w, 'wraith', 5, 20, 'chase');
    const d0 = Math.hypot(g.x - d.w.player.x, g.z - d.w.player.z);
    d.wait(1.5, { raise: true });
    expect(g.mode).toBe('recoil');
    expect(Math.hypot(g.x - d.w.player.x, g.z - d.w.player.z)).toBeGreaterThan(d0);
    expect(d.w.player.hp).toBe(100);
  });

  it('没有油时举灯无效', () => {
    const d = nightScene(0, 20);
    d.w.lantern.oil = 0;
    const g = place(d.w, 'grey', 1.5, 20, 'chase');
    d.wait(4, { raise: true });
    expect(d.w.lantern.raised).toBe(false);
    expect(g.repelCd).toBe(0);
    expect(d.w.player.hp).toBeLessThan(100);
  });

  it('前摇中跑出攻击距离：扑空不掉血', () => {
    const d = nightScene(0, 20);
    const g = place(d.w, 'grey', 1.5, 20, 'chase');
    d.waitUntil(() => g.mode === 'windup', 3);
    d.face(-8, 20);
    d.waitUntil(() => g.mode !== 'windup', 3, { forward: 1, sprint: true });
    expect(d.w.player.hp).toBe(100);
    expect(d.texts().some((t) => t.includes('扑空'))).toBe(true);
  });

  it('前摇中绕到井台后面：视线被挡，不掉血', () => {
    const d = nightScene(0, 12.2);
    const g = place(d.w, 'grey', 0, 10.6, 'chase');
    d.waitUntil(() => g.mode === 'windup', 3);
    // 井台在 (0,14)，直接把玩家放到井台另一侧来隔离「遮挡」这一条规则
    d.w.player.x = 0; d.w.player.z = 15.8;
    g.x = 0; g.z = 12.3;
    d.waitUntil(() => g.mode !== 'windup', 3);
    expect(d.w.player.hp).toBe(100);
  });
});

describe('门与栅门（A05）', () => {
  it('关闭的楼梯栅门截断视线和通行，打开后恢复', () => {
    const d = nightScene(22.5, 21.15, 4, '2F');
    d.w.repairs.gate = true; d.w.lantern.on = true;
    const g = place(d.w, 'grey', 25.5, 21.15, 'patrol', 4, '2F');
    d.wait(3);
    expect(g.canSee).toBe(false);
    expect(g.mode).toBe('patrol');
    d.w.doors.gate = true;
    g.x = 25.5; g.z = 21.15; g.yaw = -Math.PI / 2; g.path = []; g.senseT = 0; g.mode = 'patrol';
    d.wait(0.5);
    expect(g.canSee).toBe(true);
  });

  it('追逐中玩家回手关上栅门：鬼过不来', () => {
    const d = nightScene(STAND.gateW.x, STAND.gateW.z, 4, '2F');
    d.w.repairs.gate = true; d.w.doors.gate = true; d.w.lantern.on = true;
    const a = place(d.w, 'grey', 26, 21.15, 'chase', 4, '2F');
    expect(d.use('gate')).toBe(true);
    expect(d.w.doors.gate).toBe(false);
    let crossed = false;
    d.onStep = () => { if (a.x < 23.9) crossed = true; };
    d.wait(12);
    expect(crossed).toBe(false);
    expect(d.w.player.hp).toBe(100);
  });

  it('加闩的门房门：灰影拍门后离去，门不会被拍开', () => {
    const d = nightScene(0, -3);
    d.w.repairs.bolt = true; d.w.bolted = true;
    const g = place(d.w, 'grey', 0, 6, 'chase');
    g.canSee = false; g.lastKnown = { x: 0, z: 0.9 };
    let entered = false, banged = false;
    d.onStep = () => { if (g.z < 0.4) entered = true; if (g.mode === 'bang') banged = true; };
    d.wait(20);
    expect(banged).toBe(true);
    expect(entered).toBe(false);
    expect(d.w.doors.gatehouse).toBe(false);
    expect(g.mode).toBe('patrol');
    expect(d.texts().some((t) => t.includes('拍不开'))).toBe(true);
    expect(d.w.player.hp).toBe(100);
  });

  it('未加闩的门房门：灰影先拍门预警，随后进屋，玩家仍可举灯', () => {
    const d = nightScene(0, -5);
    const g = place(d.w, 'grey', 0, 6, 'chase');
    g.canSee = false; g.lastKnown = { x: 0, z: 0.9 };
    d.waitUntil(() => g.mode === 'bang', 10);
    expect(g.mode).toBe('bang');
    const t0 = d.w.nightT;
    expect(d.w.doors.gatehouse).toBe(false);
    d.waitUntil((w) => w.doors.gatehouse, 6);
    expect(d.w.doors.gatehouse).toBe(true);
    expect(d.w.nightT - t0).toBeGreaterThanOrEqual(GHOST.grey.doorBangSecs - 0.1);
    expect(d.events.filter((e) => e.id === 'bang').length).toBeGreaterThanOrEqual(3);
    d.face(0, 0);
    d.waitUntil(() => g.mode === 'recoil', 8, { raise: true });
    expect(g.mode).toBe('recoil');
    expect(d.w.player.hp).toBe(100);
  });

  it('拍门途中加闩：立刻禁止破门', () => {
    const d = nightScene(0.4, -1.1);
    d.w.repairs.bolt = true;
    const g = place(d.w, 'grey', 0, 6, 'chase');
    g.canSee = false; g.lastKnown = { x: 0, z: 0.9 };
    d.waitUntil(() => g.mode === 'bang', 10);
    d.wait(0.8);
    expect(d.use('bolt')).toBe(true);
    expect(d.w.bolted).toBe(true);
    d.wait(6);
    expect(d.w.doors.gatehouse).toBe(false);
    expect(g.mode).toBe('patrol');
  });

  it('黑影不主动破门', () => {
    const d = nightScene(0, -3);
    const g = place(d.w, 'wraith', 0, 6, 'chase');
    g.canSee = false; g.lastKnown = { x: 0, z: 0.9 };
    let entered = false;
    d.onStep = () => { if (g.z < 0.4) entered = true; };
    d.wait(40);
    expect(entered).toBe(false);
    expect(d.w.doors.gatehouse).toBe(false);
    expect(d.events.some((e) => e.id === 'bang')).toBe(false);
  });

  it('门只能从门房内加闩，且门关上才可加闩', () => {
    const d = nightScene(STAND.boltIn.x, STAND.boltIn.z);
    d.w.repairs.bolt = true; d.w.doors.gatehouse = true;
    expect(d.use('bolt')).toBe(false);
    expect(d.lastToast()).toContain('门关上才可加闩');
    d.w.doors.gatehouse = false;
    expect(d.use('bolt')).toBe(true);
    expect(d.w.bolted).toBe(true);
    d.w.player.x = STAND.doorIn.x; d.w.player.z = STAND.doorIn.z;
    expect(d.use('ghDoor')).toBe(false);
    d.w.player.x = STAND.boltIn.x; d.w.player.z = STAND.boltIn.z;
    expect(d.use('bolt')).toBe(true);
    expect(d.w.bolted).toBe(false);
  });
});

describe('庭院壁灯（A05）', () => {
  it('点亮期间两只鬼都不进入亮区；燃尽后恢复可走', () => {
    const d = nightScene(0, -4);
    d.w.repairs.lamp = true; d.w.lampBurn = 120;
    const a = place(d.w, 'grey', 6, 23);
    const b = place(d.w, 'wraith', 8.8, 6);
    let minLit = 99, minDark = 99;
    d.onStep = (w) => {
      const m = Math.min(zoneDist(a), zoneDist(b));
      if (w.lampBurn > 0) minLit = Math.min(minLit, m); else minDark = Math.min(minDark, m);
    };
    d.wait(120.5);
    expect(d.w.lampBurn).toBe(0);
    expect(minLit).toBeGreaterThanOrEqual(WALL_LAMP.zone.r - 0.05);
    expect(d.texts().some((t) => t.includes('壁灯燃尽'))).toBe(true);
    d.wait(240);
    expect(minDark).toBeLessThan(WALL_LAMP.zone.r - 1);
  });

  it('灯新亮起时，位于亮区内的鬼退到最近的暗处', () => {
    const d = nightScene(0, -4);
    d.w.repairs.lamp = true;
    const g = place(d.w, 'grey', -5, 20);
    d.wait(0.2);
    d.w.lampBurn = 300;
    d.tick();
    expect(g.mode).toBe('flee');
    d.wait(4);
    expect(zoneDist(g)).toBeGreaterThanOrEqual(WALL_LAMP.zone.r - 0.05);
  });

  it('玩家站在亮区里，追来的鬼停在亮区外', () => {
    const d = nightScene(WALL_LAMP.zone.x, WALL_LAMP.zone.z);
    d.w.repairs.lamp = true; d.w.lampBurn = 300;
    const a = place(d.w, 'grey', 6, 23, 'chase');
    const b = place(d.w, 'wraith', 6, 20, 'chase');
    let min = 99;
    d.onStep = () => { min = Math.min(min, zoneDist(a), zoneDist(b)); };
    d.wait(30);
    expect(min).toBeGreaterThanOrEqual(WALL_LAMP.zone.r - 0.05);
    expect(d.w.player.hp).toBe(100);
  });
});

describe('火盆', () => {
  const zoneOf = (id: BrazierId) => BRAZIER.zones[id];

  it('不用修：有油就能点，扣 1 份油，燃烧中不能重复投油，燃尽后可以再点', () => {
    const d = nightScene(STAND.brazierChapel.x, STAND.brazierChapel.z);
    d.w.inv.oil = 0;
    expect(d.use('brazierChapel')).toBe(false);
    expect(d.lastToast()).toContain('灯油');
    d.w.inv.oil = 2;
    expect(d.use('brazierChapel')).toBe(true);
    expect(d.w.inv.oil).toBe(1);
    expect(d.w.braziers.chapel).toBeCloseTo(BRAZIER.burnTime, 0);
    expect(d.use('brazierChapel')).toBe(false);
    expect(d.w.inv.oil).toBe(1);
    d.w.braziers.chapel = 0.5;
    d.wait(1);
    expect(d.w.braziers.chapel).toBe(0);
    expect(d.texts().some((t) => t.includes('祭台火盆燃尽'))).toBe(true);
    expect(d.use('brazierChapel')).toBe(true);
    expect(d.w.inv.oil).toBe(0);
  });

  it('白天也能点（提前布置），燃烧计时照常走', () => {
    const d = nightScene(STAND.brazierSide.x, STAND.brazierSide.z, 4, '2F');
    d.w.phase = 'day'; d.w.inv.oil = 1;
    expect(d.use('brazierSide')).toBe(true);
    d.wait(10);
    expect(BRAZIER.burnTime - d.w.braziers.side).toBeCloseTo(10, 0);
  });

  it('祭台火盆亮着时，追来的两只鬼都停在亮区外，玩家站在里面不掉血', () => {
    const zn = zoneOf('chapel');
    const d = nightScene(20, 11);
    d.w.doors.chapelFront = true; d.w.braziers.chapel = 120;
    const a = place(d.w, 'grey', 19, 19.5, 'chase');
    const b = place(d.w, 'wraith', 14.6, 15, 'chase');
    let inside = 0;
    d.onStep = () => { if (inZone(zn, a.x, a.z, -0.05) || inZone(zn, b.x, b.z, -0.05)) inside++; };
    d.wait(40);
    expect(inside).toBe(0);
    expect(d.w.player.hp).toBe(100);
  });

  it('火盆新亮起时，位于亮区内的鬼退到暗处；燃尽后恢复可走', () => {
    const zn = zoneOf('chapel');
    const d = nightScene(0, -4);
    d.w.doors.chapelFront = true;
    const g = place(d.w, 'wraith', 26, 17.5);
    d.wait(0.2);
    d.w.braziers.chapel = 20;
    d.tick();
    expect(g.mode).toBe('flee');
    d.wait(6);
    expect(inZone(zn, g.x, g.z, -0.05)).toBe(false);
    let entered = false;
    d.onStep = (w) => { if (w.braziers.chapel <= 0 && inZone(zn, g.x, g.z, -1)) entered = true; };
    d.wait(240);
    expect(entered).toBe(true);
  });

  it('步道火盆亮着时把西步道截成两段：鬼过不去，玩家安全', () => {
    const zn = zoneOf('side');
    expect(inZone(zn, -7, 14, 0, '2F')).toBe(false); // 亮区不越出步道
    const d = nightScene(-9.2, 4, 4, '2F');
    d.w.braziers.side = 120; d.w.lantern.on = true;
    const g = place(d.w, 'wraith', -9.2, 20, 'chase', 4, '2F');
    let inside = 0;
    d.onStep = () => { if (inZone(zn, g.x, g.z, -0.05, '2F')) inside++; };
    d.wait(30);
    expect(inside).toBe(0);
    expect(d.w.player.hp).toBe(100);
  });

  it('祭台火盆亮着时黑影的巡游路线不会卡住', () => {
    const d = nightScene(0, -4);
    d.w.braziers.chapel = 9999;
    const a = place(d.w, 'grey', -6, 26.2);
    const b = place(d.w, 'wraith', 5.5, 7.6, 'patrol', -3, 'B1');
    let still = 0, worst = 0, lx = b.x, lz = b.z;
    d.onStep = () => {
      still = Math.hypot(b.x - lx, b.z - lz) < 1e-4 ? still + FIXED_DT : 0;
      worst = Math.max(worst, still); lx = b.x; lz = b.z;
    };
    d.wait(240);
    expect(worst).toBeLessThan(3);
    expect(a.mode).toBe('patrol');
    expect(b.mode).toBe('patrol');
  });
});

describe('晨曦清场（A10）', () => {
  it('天亮的那一步清空攻击许可，之后没有追踪和伤害', () => {
    const d = nightScene(0, 20);
    d.w.clock = PHASE.nightLength - 0.5;
    const a = place(d.w, 'grey', 1.5, 20, 'chase');
    const b = place(d.w, 'wraith', -3, 20, 'chase');
    d.waitUntil(() => a.mode === 'windup', 0.4);
    expect(a.mode).toBe('windup');
    d.waitUntil((w) => w.phase === 'dawn', 1);
    expect(d.w.phase).toBe('dawn');
    expect(d.w.attack.holder).toBeNull();
    expect(a.mode).toBe('dissolve');
    expect(b.mode).toBe('dissolve');
    d.wait(10);
    expect(d.w.player.hp).toBe(100);
    expect(a.mode).toBe('gone');
    expect(b.mode).toBe('gone');
  });
});

describe('巡游', () => {
  it('两只鬼各走各的暗路，长时间巡游不会卡住', () => {
    const d = nightScene(0, -4);
    const a = place(d.w, 'grey', 0, 23);
    const b = place(d.w, 'wraith', 5.5, 13.2, 'patrol', -3, 'B1');
    const still = new Map<string, number>();
    const last = new Map<string, { x: number; z: number }>();
    let worst = 0;
    const visited = { grey: new Set<number>(), wraith: new Set<number>() };
    d.onStep = () => {
      for (const g of [a, b]) {
        const l = last.get(g.kind);
        const s = l && Math.hypot(g.x - l.x, g.z - l.z) < 1e-4 ? (still.get(g.kind) ?? 0) + FIXED_DT : 0;
        still.set(g.kind, s); worst = Math.max(worst, s);
        last.set(g.kind, { x: g.x, z: g.z });
        visited[g.kind].add(g.patrolIdx);
      }
    };
    d.wait(300);
    expect(worst).toBeLessThan(3);
    expect(visited.grey.size).toBeGreaterThanOrEqual(5);
    expect(visited.wraith.size).toBeGreaterThanOrEqual(5);
    expect(a.mode).toBe('patrol');
    expect(b.mode).toBe('patrol');
  });
});
