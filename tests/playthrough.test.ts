// 整夜通关：机器人玩家在双鬼在场的情况下，用四种修复方案各打通一次（PRD 第 8 节第 2 步、A01、A09）。
import { describe, expect, it } from 'vitest';
import { FIXED_DT, GHOST, PHASE, RepairId } from '../src/config';
import { hasLineOfSight } from '../src/sim/collision';
import { INTERACTS, InteractId, regionAt } from '../src/sim/level';
import { findPath } from '../src/sim/nav';
import { fastForwardStatus, pickTarget } from '../src/sim/sim';
import { doTutorial, Driver, openGatehouseDoor, STAND } from './driver';

/** 是否该举灯：有鬼在威胁或被逼退状态、在逼退距离内且有视线。举到它退走为止。 */
function shouldRaise(d: Driver): boolean {
  const p = d.w.player;
  return d.w.lantern.oil > 0 && d.w.ghosts.some((g) => (g.mode === 'chase' || g.mode === 'windup' || g.mode === 'alert' || g.mode === 'recoil')
    && Math.hypot(g.x - p.x, g.z - p.z) < GHOST[g.kind].repelRange - 0.5
    && hasLineOfSight(g.x, g.z, p.x, p.z, d.w.doors));
}

function chased(d: Driver): boolean {
  return d.w.ghosts.some((g) => g.mode === 'chase' || g.mode === 'windup' || g.mode === 'alert');
}

/** 夜间走位：被追时冲刺，鬼近身时举灯。 */
function nightWalk(d: Driver, x: number, z: number, stop = 0.3, maxSecs = 240): boolean {
  const max = Math.round(maxSecs / FIXED_DT);
  let path = findPath(d.w.player, { x, z }, { doors: d.w.doors, lit: [] }) ?? [];
  for (let i = 0; i < max && d.alive(); i++) {
    const p = d.w.player;
    if (Math.hypot(p.x - x, p.z - z) <= stop) return true;
    if (i % 20 === 0) path = findPath(p, { x, z }, { doors: d.w.doors, lit: [] }) ?? path;
    while (path.length > 1 && Math.hypot(path[0].x - p.x, path[0].z - p.z) < 0.3) path.shift();
    if (!path.length) return false;
    d.face(path[0].x, path[0].z);
    d.tick({ forward: 1, sprint: chased(d), raise: shouldRaise(d) });
  }
  return false;
}

function nightUse(d: Driver, id: InteractId, stand: { x: number; z: number }): boolean {
  if (!nightWalk(d, stand.x, stand.z)) return false;
  const it = INTERACTS.find((i) => i.id === id)!;
  d.face(it.x, it.z);
  d.w.player.yaw = d.yaw;
  const t = pickTarget(d.w);
  const ok = !!t && t.id === id && t.enabled;
  d.tick({ raise: shouldRaise(d) }, [{ type: 'interact' }]);
  return ok;
}

function playthrough(repairs: RepairId[]): Driver {
  const d = new Driver();
  doTutorial(d);
  // 白天：搜集、修复、做热食、补油
  openGatehouseDoor(d);
  d.goUse('shelf', STAND.shelf);
  d.goUse('crate', STAND.crate);
  d.goUse('chapelFront', STAND.frontOut);
  d.goUse('flask', STAND.flask);
  expect(d.w.inv).toMatchObject({ wood: 4, iron: 4, oil: 3 });
  for (const r of repairs) d.repair(r);
  for (const r of repairs) expect(d.w.repairs[r]).toBe(true);
  d.tick({}, [{ type: 'toggleLantern' }]); // 白天关灯省油
  d.walkTo(STAND.doorOut.x, STAND.doorOut.z);
  d.walkTo(STAND.pot.x, STAND.pot.z);
  d.use('pot');
  d.walkTo(STAND.refuel.x, STAND.refuel.z);
  d.use('refuel'); d.use('refuel');
  expect(d.waitUntil((w) => w.phase === 'dusk', 20 * 60)).toBe(true);
  expect(d.snapshots.length).toBe(1);
  expect(d.waitUntil((w) => w.phase === 'night', 5 * 60)).toBe(true);

  // 入夜：取钟舌。修了栅门走近路，否则走主路。
  const viaGate = d.w.repairs.gate;
  if (d.w.repairs.lamp && d.w.inv.oil > 0) nightUse(d, 'lamp', STAND.lamp);
  if (viaGate) {
    nightUse(d, 'gate', STAND.gateW);
    nightWalk(d, STAND.gateE.x, STAND.gateE.z);
    if (d.w.doors.gate) nightUse(d, 'gate', STAND.gateE); // 回手关门
  }
  expect(nightUse(d, 'chest', STAND.chest)).toBe(true);
  expect(d.w.inv.hasClapper).toBe(true);
  if (viaGate) {
    nightUse(d, 'gate', STAND.gateE);
    nightWalk(d, STAND.gateW.x, STAND.gateW.z);
  }
  // 回门房，关门，有门闩就加闩
  expect(nightWalk(d, STAND.doorIn.x, STAND.doorIn.z)).toBe(true);
  if (d.w.doors.gatehouse) nightUse(d, 'ghDoor', STAND.doorIn);
  if (d.w.repairs.bolt) nightUse(d, 'bolt', STAND.boltIn);
  if (d.w.inv.wood > 0) nightUse(d, 'woodpile', STAND.woodpile);
  nightWalk(d, STAND.hearth.x, STAND.hearth.z);
  // 守夜：能快进就快进，否则举灯自保到天亮
  const maxTicks = Math.round((PHASE.nightLength + 30) / FIXED_DT);
  for (let i = 0; i < maxTicks && d.w.phase === 'night'; i++) {
    if (d.w.player.hp < 60 && d.w.inv.meal > 0) d.tick({}, [{ type: 'eat' }]);
    if (fastForwardStatus(d.w).ok) { nightUse(d, 'hearth', STAND.hearth); continue; }
    const threat = d.w.ghosts.find((g) => regionAt(g.x, g.z) === 'gatehouse');
    if (threat) d.face(threat.x, threat.z);
    d.tick({ raise: shouldRaise(d) });
  }
  return d;
}

function finish(d: Driver): void {
  expect(d.w.phase).toBe('dawn');
  expect(d.w.player.hp).toBeGreaterThan(0);
  if (d.w.bolted) { d.walkTo(STAND.boltIn.x, STAND.boltIn.z); d.use('bolt'); }
  openGatehouseDoor(d);
  d.walkTo(STAND.bell.x, STAND.bell.z);
  expect(d.use('bell')).toBe(true);
  expect(d.use('bell')).toBe(true);
  expect(d.w.phase).toBe('ended');
  expect(d.w.quest).toMatchObject({ installed: true, rung: true, clapperAt: 'night', returnedBeforeDawn: true });
}

describe('整夜通关（双鬼在场）', () => {
  const plans: [string, RepairId[]][] = [
    ['壁灯 + 栅门', ['lamp', 'gate']],
    ['壁灯 + 门闩', ['lamp', 'bolt']],
    ['栅门 + 门闩', ['gate', 'bolt']],
    ['完全不修复', []],
  ];
  for (const [name, repairs] of plans) {
    it(`${name}：从教学打到敲钟`, () => {
      const d = playthrough(repairs);
      const hp = Math.round(d.w.player.hp);
      const mins = (d.w.total / 60).toFixed(1);
      finish(d);
      const hits = d.events.filter((e) => e.kind === 'hurt').length;
      console.log(`[${name}] 结束生命 ${hp}，受击 ${hits} 次，游戏时钟 ${mins} 分钟`);
    });
  }
});
