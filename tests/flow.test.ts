// 流程、修复与生存规则（对应验收 A01、A04、A07、A09、A10 的规则部分）。
import { describe, expect, it } from 'vitest';
import { HEARTH, LANTERN, PHASE, REPAIR_COST, RepairId } from '../src/config';
import { fastForwardStatus } from '../src/sim/sim';
import { doTutorial, Driver, openGatehouseDoor, STAND } from './driver';

/** 教学后走完白天的搜集：货架、货箱、油瓶。回到庭院南端。 */
function gather(d: Driver): void {
  openGatehouseDoor(d);
  d.goUse('shelf', STAND.shelf);
  d.goUse('crate', STAND.crate);
  d.goUse('chapelFront', STAND.frontOut);
  d.goUse('flask', STAND.flask);
}

function skipTo(d: Driver, phase: string): void {
  expect(d.waitUntil((w) => w.phase === phase, 30 * 60)).toBe(true);
}

describe('开局教学与时段', () => {
  it('教学期间时钟不走、没有敌人，拾灯并关闭任务板后才开始白天', () => {
    const d = new Driver();
    d.wait(30);
    expect(d.w.phase).toBe('tutorial');
    expect(d.w.total).toBe(0);
    expect(d.w.ghosts.length).toBe(0);
    d.walkTo(STAND.lantern.x, STAND.lantern.z);
    expect(d.use('lantern')).toBe(true);
    expect(d.w.inv.hasLantern).toBe(true);
    expect(d.w.lantern.oil).toBeCloseTo(LANTERN.startOil, 1);
    d.wait(1);
    expect(d.w.phase).toBe('tutorial');
    d.walkTo(STAND.board.x, STAND.board.z);
    expect(d.use('board')).toBe(true);
    expect(d.ui.board).toBe(true);
    d.tick({}, [{ type: 'boardClosed' }]);
    d.tick();
    expect(d.w.phase).toBe('day');
  });

  it('教学未完成时门房门打不开', () => {
    const d = new Driver();
    d.walkTo(STAND.doorIn.x, STAND.doorIn.z);
    expect(d.use('ghDoor')).toBe(false);
    expect(d.w.doors.gatehouse).toBe(false);
  });

  it('白天 6 分钟、第 5 分钟提示、黄昏 1 分半并存档、夜间 6 分钟后晨曦', () => {
    expect([PHASE.dayLength, PHASE.duskWarnAt, PHASE.duskLength, PHASE.nightLength]).toEqual([360, 300, 90, 360]);
    const d = new Driver();
    doTutorial(d);
    d.tick();
    d.w.lantern.on = false;
    d.wait(PHASE.duskWarnAt - 1);
    expect(d.w.duskWarned).toBe(false);
    d.wait(2);
    expect(d.w.duskWarned).toBe(true);
    skipTo(d, 'dusk');
    expect(d.w.total).toBeCloseTo(PHASE.dayLength, 0);
    expect(d.snapshots.length).toBe(1);
    expect(d.snapshots[0].phase).toBe('dusk');
    expect(d.snapshots[0].clock).toBe(0);
    skipTo(d, 'night');
    expect(d.w.total).toBeCloseTo(PHASE.dayLength + PHASE.duskLength, 0);
    expect(d.w.ghosts.map((g) => g.kind)).toEqual(['grey', 'wraith']);
    expect(d.w.hearth.burn).toBeCloseTo(HEARTH.nightBurn, 0);
    expect(d.events.some((e) => e.id === 'ring')).toBe(true);
    skipTo(d, 'dawn');
    expect(d.w.total).toBeCloseTo(PHASE.dayLength + PHASE.duskLength + PHASE.nightLength, 0);
  });
});

describe('跳过等待', () => {
  it('白天在床铺休息到黄昏：照常存档，累计时间按整个白天算；教学期间和黄昏后不可用', () => {
    const d = new Driver();
    d.walkTo(STAND.cot.x, STAND.cot.z);
    expect(d.use('cot')).toBe(false);
    doTutorial(d);
    d.tick();
    d.wait(20);
    d.walkTo(STAND.cot.x, STAND.cot.z);
    expect(d.use('cot')).toBe(true);
    expect(d.w.phase).toBe('dusk');
    expect(d.w.clock).toBeLessThan(0.1);
    expect(d.w.total).toBeCloseTo(PHASE.dayLength, 0);
    expect(d.snapshots.length).toBe(1);
    expect(d.snapshots[0].phase).toBe('dusk');
    expect(d.events.filter((e) => e.kind === 'phase' && e.id === 'dusk').length).toBe(1);
    // 黄昏照常能修复
    d.w.inv.wood = 4; d.w.inv.iron = 4;
    d.repair('bolt');
    expect(d.w.repairs.bolt).toBe(true);
    expect(d.use('cot')).toBe(false);
    expect(d.w.phase).toBe('dusk');
    // 跳过之后不会再补一次「日头偏西」的提示
    expect(d.events.some((e) => e.id === 'duskWarn')).toBe(false);
  });

  it('黄昏在壁炉旁等到入夜：两鬼与炉火按正常规则初始化；白天不可用', () => {
    const d = new Driver();
    doTutorial(d);
    d.tick();
    d.walkTo(STAND.hearth.x, STAND.hearth.z);
    expect(d.use('hearth')).toBe(false);
    expect(d.w.phase).toBe('day');
    d.walkTo(STAND.cot.x, STAND.cot.z);
    d.use('cot');
    d.wait(5);
    d.walkTo(STAND.hearth.x, STAND.hearth.z);
    expect(d.use('hearth')).toBe(true);
    expect(d.w.phase).toBe('night');
    expect(d.w.clock).toBeLessThan(0.1);
    expect(d.w.total).toBeCloseTo(PHASE.dayLength + PHASE.duskLength, 0);
    expect(d.w.ghosts.map((g) => g.kind)).toEqual(['grey', 'wraith']);
    expect(d.w.hearth.burn).toBeCloseTo(HEARTH.nightBurn, 0);
    expect(d.snapshots.length).toBe(1);
    // 入夜后同一个壁炉变回「等到晨曦」，条件不满足时不会再跳
    expect(d.use('hearth')).toBe(false);
    expect(d.w.phase).toBe('night');
  });

  it('两处都跳过：从教学结束到入夜不到一分钟', () => {
    const d = new Driver();
    doTutorial(d);
    const t0 = d.w.played;
    d.walkTo(STAND.cot.x, STAND.cot.z); d.use('cot');
    d.walkTo(STAND.hearth.x, STAND.hearth.z); d.use('hearth');
    expect(d.w.phase).toBe('night');
    expect(d.w.played - t0).toBeLessThan(60);
  });
});

describe('路线耗时（步行实测）', () => {
  it('主路单程约 30–40 秒，侧廊修好后约 15–20 秒', () => {
    const d = new Driver();
    doTutorial(d);
    openGatehouseDoor(d);
    d.walkTo(STAND.doorOut.x, STAND.doorOut.z);
    // 主路：门房门外 → 礼拜堂正门 → 祭台匣（含开门）
    let t = d.walkTo(STAND.frontOut.x, STAND.frontOut.z);
    d.use('chapelFront');
    t += d.walkTo(STAND.chest.x, STAND.chest.z);
    console.log(`实测：主路 ${t.toFixed(1)} 秒`);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThanOrEqual(40);
    // 侧廊：修好栅门后从祭台匣走回门房门外（含开门）
    d.w.repairs.gate = true;
    let s = d.walkTo(STAND.gateE.x, STAND.gateE.z);
    d.use('gate');
    s += d.walkTo(STAND.doorOut.x, STAND.doorOut.z);
    console.log(`实测：侧廊 ${s.toFixed(1)} 秒`);
    expect(s).toBeGreaterThanOrEqual(15);
    expect(s).toBeLessThanOrEqual(20);
  });
});

describe('修复（A04）', () => {
  it('白天与黄昏共可获得 4 木 4 铁 3 油，每处拾取只生效一次', () => {
    const d = new Driver();
    doTutorial(d);
    gather(d);
    expect(d.w.inv).toMatchObject({ wood: 4, iron: 4, oil: 3 });
    d.goUse('shelf', STAND.shelf);
    d.goUse('crate', STAND.crate);
    expect(d.w.inv).toMatchObject({ wood: 4, iron: 4, oil: 3 });
  });

  const pairs: [RepairId, RepairId, RepairId][] = [['lamp', 'gate', 'bolt'], ['lamp', 'bolt', 'gate'], ['gate', 'bolt', 'lamp']];
  for (const [a, b, c] of pairs) {
    it(`组合 ${a}+${b}：扣料恰好一次，第三项 ${c} 材料不足`, () => {
      const d = new Driver();
      doTutorial(d);
      d.tick();
      d.w.inv.wood = 4; d.w.inv.iron = 4;
      d.repair(a);
      expect(d.w.repairs[a]).toBe(true);
      const after = { wood: 4 - REPAIR_COST[a].wood, iron: 4 - REPAIR_COST[a].iron };
      expect(d.w.inv).toMatchObject(after);
      // 重复确认同一修复点：不再扣料
      d.repair(a); d.repair(a);
      expect(d.w.inv).toMatchObject(after);
      d.repair(b);
      expect(d.w.repairs[b]).toBe(true);
      const left = { wood: after.wood - REPAIR_COST[b].wood, iron: after.iron - REPAIR_COST[b].iron };
      expect(d.w.inv).toMatchObject(left);
      d.repair(c);
      expect(d.w.repairs[c]).toBe(false);
      expect(d.w.inv).toMatchObject(left);
      expect(d.lastToast()).toContain('材料不足');
    });
  }

  it('对准修复点交互只打开确认界面，取消时保留材料；入夜后停止新修复', () => {
    const d = new Driver();
    doTutorial(d);
    openGatehouseDoor(d);
    d.w.inv.wood = 4; d.w.inv.iron = 4;
    d.walkTo(STAND.lamp.x, STAND.lamp.z);
    expect(d.use('lamp')).toBe(true);
    expect(d.ui.repair).toBe('lamp');
    expect(d.w.inv).toMatchObject({ wood: 4, iron: 4 });
    expect(d.w.repairs.lamp).toBe(false);
    d.ui.repair = null;
    d.w.phase = 'night';
    d.repair('lamp');
    expect(d.w.repairs.lamp).toBe(false);
    expect(d.w.inv).toMatchObject({ wood: 4, iron: 4 });
    expect(d.use('lamp')).toBe(false);
  });
});

describe('提灯、补油、炉火与热食（A07）', () => {
  it('点亮每秒耗 1 秒油，举灯耗 3 秒并在举起时先耗 3 秒，关灯不耗，油量不为负并自动熄灭', () => {
    const d = new Driver();
    doTutorial(d);
    d.tick();
    const o0 = d.w.lantern.oil;
    d.wait(10);
    expect(o0 - d.w.lantern.oil).toBeCloseTo(10, 1);
    d.wait(10, { raise: true });
    expect(o0 - d.w.lantern.oil).toBeCloseTo(10 + LANTERN.raiseStartCost + 10 * LANTERN.raiseMultiplier, 1);
    expect(LANTERN.raiseMultiplier).toBe(3);
    d.tick({}, [{ type: 'toggleLantern' }]);
    const o1 = d.w.lantern.oil;
    d.wait(10);
    expect(d.w.lantern.oil).toBe(o1);
    d.wait(120, { raise: true });
    expect(d.w.lantern.oil).toBe(0);
    expect(d.w.lantern.on).toBe(false);
    expect(d.w.lantern.raised).toBe(false);
    // 零油时长按举灯也点不亮
    d.wait(1, { raise: true });
    expect(d.w.lantern.on).toBe(false);
  });

  it('补油每份 +100 秒，上限 300 秒，预计超过上限时拒绝且不扣油', () => {
    const d = new Driver();
    doTutorial(d);
    d.tick();
    d.w.lantern.on = false;
    d.w.lantern.oil = 0; d.w.inv.oil = 5;
    d.walkTo(STAND.refuel.x, STAND.refuel.z);
    expect(d.use('refuel')).toBe(true);
    expect(d.use('refuel')).toBe(true);
    expect(d.use('refuel')).toBe(true);
    expect(d.w.lantern.oil).toBe(300);
    expect(d.w.inv.oil).toBe(2);
    expect(d.use('refuel')).toBe(false);
    expect(d.w.lantern.oil).toBe(300);
    expect(d.w.inv.oil).toBe(2);
    expect(d.lastToast()).toContain('浪费');
    d.w.lantern.oil = 201;
    expect(d.use('refuel')).toBe(false);
    expect(d.w.inv.oil).toBe(2);
    d.w.lantern.oil = 200;
    expect(d.use('refuel')).toBe(true);
    expect(d.w.inv.oil).toBe(1);
  });

  it('室外夜间冷量约 2 分 40 秒后才开始掉血，回门房炉火旁立即停止并回暖', () => {
    const d = new Driver();
    doTutorial(d);
    openGatehouseDoor(d);
    d.walkTo(0, 3);
    d.w.lantern.on = false;
    d.w.phase = 'night'; d.w.clock = 0; d.w.hearth = { lit: true, burn: 9999 };
    d.wait(HEARTH.coldThreshold - 2);
    expect(d.w.player.hp).toBe(100);
    d.wait(12);
    expect(d.w.player.hp).toBeLessThan(100);
    expect(d.w.player.hp).toBeGreaterThan(85);
    d.walkTo(0, -3);
    const hp = d.w.player.hp, cold = d.w.player.cold;
    d.wait(10);
    expect(d.w.player.hp).toBe(hp);
    expect(cold - d.w.player.cold).toBeCloseTo(10 * HEARTH.warmRate, 0);
  });

  it('炉火入夜维持 4 分钟，添 1 木延长 2 分 40 秒；熄灭后门房不再回暖，也做不了热食', () => {
    const d = new Driver();
    doTutorial(d);
    d.tick();
    d.w.lantern.on = false;
    d.w.inv.wood = 1;
    d.w.phase = 'dusk'; d.w.clock = PHASE.duskLength - 0.5;
    d.wait(1);
    expect(d.w.phase).toBe('night');
    d.w.ghosts = [];
    expect(HEARTH.nightBurn - d.w.hearth.burn).toBeLessThan(1);
    d.walkTo(STAND.woodpile.x, STAND.woodpile.z);
    const before = d.w.hearth.burn;
    expect(d.use('woodpile')).toBe(true);
    expect(d.w.hearth.burn - before).toBeCloseTo(HEARTH.woodBonus, 0);
    expect(d.w.inv.wood).toBe(0);
    d.w.hearth.burn = 1;
    d.wait(2);
    expect(d.w.hearth.lit).toBe(false);
    const c0 = d.w.player.cold;
    d.wait(10);
    expect(d.w.player.cold - c0).toBeCloseTo(10, 0);
    d.walkTo(STAND.pot.x, STAND.pot.z);
    expect(d.use('pot')).toBe(false);
    expect(d.w.inv.meal).toBe(0);
  });

  it('热食只能做一份，恢复 30 生命并立即把当前冷量减半', () => {
    const d = new Driver();
    doTutorial(d);
    d.tick();
    d.walkTo(STAND.pot.x, STAND.pot.z);
    expect(d.use('pot')).toBe(true);
    expect(d.use('pot')).toBe(false);
    expect(d.w.inv.meal).toBe(1);
    d.w.player.hp = 50; d.w.player.cold = 200;
    d.tick({}, [{ type: 'eat' }]);
    expect(d.w.player.hp).toBe(80);
    expect(d.w.player.cold).toBeLessThanOrEqual(100);
    expect(d.w.inv.meal).toBe(0);
    d.tick({}, [{ type: 'eat' }]);
    expect(d.w.player.hp).toBe(80);
  });
});

describe('钟舌、快进与晨钟（A09、A10）', () => {
  it('祭台匣白天上锁，入夜后打开一次性交付钟舌', () => {
    const d = new Driver();
    doTutorial(d);
    openGatehouseDoor(d);
    d.goUse('chapelFront', STAND.frontOut);
    d.walkTo(STAND.chest.x, STAND.chest.z);
    expect(d.use('chest')).toBe(false);
    expect(d.w.inv.hasClapper).toBe(false);
    d.w.phase = 'night'; d.w.clock = 0;
    expect(d.use('chest')).toBe(true);
    expect(d.w.inv.hasClapper).toBe(true);
    expect(d.w.quest.clapperAt).toBe('night');
    expect(d.events.filter((e) => e.id === 'chest').length).toBe(1);
    d.use('chest');
    expect(d.events.filter((e) => e.id === 'chest').length).toBe(1);
  });

  it('不修复、把钟舌留到晨曦再取，走主路可通关（A09）', () => {
    const d = new Driver();
    doTutorial(d);
    d.tick();
    d.w.lantern.on = false;
    // 整夜待在关着门的门房里，添不了柴也没关系
    skipTo(d, 'dawn');
    expect(d.w.repairs).toEqual({ lamp: false, gate: false, bolt: false });
    expect(d.w.player.hp).toBeGreaterThan(0);
    d.wait(3);
    expect(d.w.ghosts.every((g) => g.mode === 'gone')).toBe(true);
    openGatehouseDoor(d);
    d.walkTo(STAND.bell.x, STAND.bell.z);
    expect(d.use('bell')).toBe(false);
    d.goUse('chapelFront', STAND.frontOut);
    expect(d.goUse('chest', STAND.chest)).toBe(true);
    expect(d.w.quest.clapperAt).toBe('dawn');
    d.walkTo(STAND.bell.x, STAND.bell.z);
    expect(d.use('bell')).toBe(true);
    expect(d.w.quest.installed).toBe(true);
    expect(d.w.phase).toBe('dawn');
    expect(d.use('bell')).toBe(true);
    expect(d.w.phase).toBe('ended');
    expect(d.w.quest.returnedBeforeDawn).toBe(false);
  });

  it('晨钟只在晨曦且持有钟舌时可装配', () => {
    const d = new Driver();
    doTutorial(d);
    openGatehouseDoor(d);
    d.walkTo(STAND.bell.x, STAND.bell.z);
    d.w.phase = 'night'; d.w.inv.hasClapper = true; d.w.ghosts = [];
    expect(d.use('bell')).toBe(false);
    expect(d.lastToast()).toContain('晨曦');
    expect(d.w.quest.installed).toBe(false);
  });

  it('快进：燃料不足时拒绝并说明；燃料足够且安全满 10 秒后结算余量进入晨曦（A10）', () => {
    const d = new Driver();
    doTutorial(d);
    d.tick();
    d.w.lantern.on = false;
    d.w.phase = 'dusk'; d.w.clock = PHASE.duskLength - 0.2;
    d.wait(1);
    d.w.ghosts = [];
    d.walkTo(STAND.hearth.x, STAND.hearth.z);
    expect(fastForwardStatus(d.w).reason).toContain('钟舌');
    d.w.inv.hasClapper = true;
    // 夜间余 6 分钟，炉火只有 4 分钟：不足
    expect(fastForwardStatus(d.w).ok).toBe(false);
    expect(fastForwardStatus(d.w).reason).toContain('柴火撑不到天亮');
    expect(d.use('hearth')).toBe(false);
    expect(d.w.phase).toBe('night');
    d.w.hearth.burn += HEARTH.woodBonus;
    d.w.safeT = 0;
    d.tick();
    expect(fastForwardStatus(d.w).reason).toContain('安全停留');
    d.wait(HEARTH.fastForwardSafeSecs + 0.5);
    d.w.lampBurn = 100; d.w.lantern.on = true; d.w.lantern.oil = 50;
    const burn = d.w.hearth.burn, remain = PHASE.nightLength - d.w.clock;
    expect(d.use('hearth')).toBe(true);
    expect(d.w.phase).toBe('dawn');
    // 结算余量时同步推进所有燃烧计时
    expect(d.w.hearth.burn).toBeCloseTo(burn - remain, 0);
    expect(d.w.lampBurn).toBe(0);
    expect(d.w.lantern.oil).toBe(0);
    expect(d.w.lantern.on).toBe(false);
  });
});
