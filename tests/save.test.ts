// 存档、重试与异常处理（对应验收 A08、A11）。
import { describe, expect, it } from 'vitest';
import { PHASE, SAVE_KEY, SAVE_VERSION } from '../src/config';
import { SaveStore, StorageLike } from '../src/sim/save';
import { Session } from '../src/sim/session';
import { step } from '../src/sim/sim';
import { World } from '../src/sim/state';
import { FIXED_DT } from '../src/config';

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
}

class BrokenStorage implements StorageLike {
  getItem(): string | null { throw new Error('denied'); }
  setItem(): void { throw new Error('denied'); }
  removeItem(): void { throw new Error('denied'); }
}

const IDLE = { forward: 0, strafe: 0, sprint: false, raise: false, yaw: 0, pitch: 0, actions: [] };

function run(s: Session, secs: number): void {
  const n = Math.round(secs / FIXED_DT);
  for (let i = 0; i < n; i++) step(s.world, IDLE, FIXED_DT, s.hooks);
}

/** 把一局推进到黄昏起点（触发快照）。 */
function toDusk(s: Session, setup?: (w: World) => void): void {
  const w = s.world;
  w.inv.hasLantern = true; w.quest.boardRead = true;
  run(s, 0.1);
  expect(s.world.phase).toBe('day');
  setup?.(s.world);
  s.world.clock = PHASE.dayLength - 0.05;
  run(s, 0.2);
  expect(s.world.phase).toBe('dusk');
}

function toNight(s: Session): void {
  s.world.clock = PHASE.duskLength - 0.05;
  run(s, 0.2);
  expect(s.world.phase).toBe('night');
}

describe('黄昏快照', () => {
  it('黄昏起点自动写入带版本号的快照，内容覆盖 PRD 9.5 列出的状态', () => {
    const st = new MemStorage();
    const s = new Session(new SaveStore(st));
    toDusk(s, (w) => {
      w.inv.wood = 3; w.inv.iron = 1; w.inv.oil = 2; w.inv.meal = 1;
      w.repairs.gate = true; w.doors.gate = true; w.taken.shelf = true; w.taken.food = true;
      w.player.x = 4; w.player.z = 9; w.player.hp = 77; w.lantern.oil = 222; w.lampBurn = 0;
    });
    expect(s.lastSavePersisted).toBe(true);
    const raw = JSON.parse(st.getItem(SAVE_KEY)!);
    expect(raw.version).toBe(SAVE_VERSION);
    expect(raw.dusk.phase).toBe('dusk');
    expect(raw.dusk.clock).toBe(0);
    expect(raw.dusk.player).toMatchObject({ x: 4, z: 9, hp: 77 });
    expect(raw.dusk.inv).toMatchObject({ wood: 3, iron: 1, oil: 2, meal: 1 });
    expect(raw.dusk.repairs.gate).toBe(true);
    expect(raw.dusk.doors.gate).toBe(true);
    expect(raw.dusk.taken).toMatchObject({ shelf: true, food: true });
    expect(raw.dusk.bolted).toBe(false);
    expect(raw.dusk.braziers).toEqual({ chapel: 0, side: 0 });
    expect(raw.dusk.hints).toEqual({ raise: false });
    expect(raw.dusk.lantern.oil).toBeCloseTo(222, 0);
    expect(Object.keys(raw)).toEqual(['version', 'savedAt', 'retries', 'completed', 'dusk']);
  });

  it('到达黄昏之前没有快照，标题不提供继续', () => {
    const s = new Session(new SaveStore(new MemStorage()));
    s.world.inv.hasLantern = true; s.world.quest.boardRead = true;
    run(s, 60);
    expect(s.hasSnapshot()).toBe(false);
    expect(s.continueFromDusk()).toBe(false);
  });
});

describe('重试当晚与重开当天（A08）', () => {
  it('黄昏后改变修复和库存，失败并重试两次：每次都回到同一黄昏状态', () => {
    const s = new Session(new SaveStore(new MemStorage()));
    toDusk(s, (w) => { w.inv.wood = 4; w.inv.iron = 4; w.inv.oil = 3; w.repairs.lamp = true; w.inv.wood -= 2; w.inv.iron -= 1; });
    const dusk = JSON.stringify(s.store.current()!.dusk);

    for (let attempt = 1; attempt <= 2; attempt++) {
      // 黄昏之后：再修一处、用掉油、拿走食材、开门
      const w = s.world;
      w.repairs.gate = true; w.inv.wood -= 1; w.inv.iron -= 2; w.inv.oil -= 1;
      w.taken.food = true; w.inv.meal = 1; w.doors.gatehouse = true; w.bolted = false;
      toNight(s);
      s.world.taken.chest = true; s.world.inv.hasClapper = true;
      s.world.player.hp = 0;
      run(s, 0.1);
      expect(s.world.phase).toBe('failed');

      expect(s.retryNight()).toBe(true);
      expect(s.retries).toBe(attempt);
      expect(s.store.current()!.retries).toBe(attempt);
      // 除累计游玩时长（重试不回退）外，与黄昏快照逐字段一致
      expect(s.world.played).toBeGreaterThan(JSON.parse(dusk).played);
      expect(JSON.stringify({ ...s.world, played: JSON.parse(dusk).played })).toBe(dusk);
      // 黄昏后做的修复被撤销，可以重选；白天修的保留
      expect(s.world.repairs).toEqual({ lamp: true, gate: false, bolt: false });
      expect(s.world.inv).toMatchObject({ wood: 2, iron: 3, oil: 3, meal: 0, hasClapper: false });
      expect(s.world.taken).toMatchObject({ food: false, chest: false });
      // 重复加载不会改动快照本身
      expect(JSON.stringify(s.store.current()!.dusk)).toBe(dusk);
    }
  });

  it('两次重试进入夜晚时，两鬼的起点与巡游状态完全一致', () => {
    const s = new Session(new SaveStore(new MemStorage()));
    toDusk(s);
    const nights: string[] = [];
    for (let i = 0; i < 3; i++) {
      toNight(s);
      nights.push(JSON.stringify(s.world.ghosts));
      run(s, 20 + i * 7);
      s.world.player.hp = 0; run(s, 0.1);
      s.retryNight();
    }
    expect(nights[1]).toBe(nights[0]);
    expect(nights[2]).toBe(nights[0]);
    expect(JSON.parse(nights[0]).map((g: { kind: string }) => g.kind)).toEqual(['grey', 'wraith']);
  });

  it('同一份快照下，相同输入得到完全相同的夜晚（可复现）', () => {
    const s = new Session(new SaveStore(new MemStorage()));
    toDusk(s);
    const outcomes: string[] = [];
    for (let i = 0; i < 2; i++) {
      toNight(s);
      run(s, 90);
      outcomes.push(JSON.stringify(s.world.ghosts.map((g) => [g.x, g.z, g.mode, g.patrolIdx])));
      s.retryNight();
    }
    expect(outcomes[1]).toBe(outcomes[0]);
  });

  it('标题「继续」不增加重试计数；重开当天清除进度并把计数归零', () => {
    const st = new MemStorage();
    const s = new Session(new SaveStore(st));
    toDusk(s);
    toNight(s);
    s.retryNight();
    expect(s.retries).toBe(1);
    // 刷新页面：新的 Session 读同一份存储
    const store2 = new SaveStore(st);
    expect(store2.load().status).toBe('ok');
    const s2 = new Session(store2);
    expect(s2.hasSnapshot()).toBe(true);
    expect(s2.continueFromDusk()).toBe(true);
    expect(s2.retries).toBe(1);
    expect(s2.world.phase).toBe('dusk');
    s2.newGame();
    expect(s2.retries).toBe(0);
    expect(s2.world.phase).toBe('tutorial');
    expect(s2.hasSnapshot()).toBe(false);
    expect(st.getItem(SAVE_KEY)).toBeNull();
  });

  it('读档时角色位置非法：回到最近的可走点', () => {
    const s = new Session(new SaveStore(new MemStorage()));
    toDusk(s, (w) => { w.player.x = -10.3; w.player.z = 14; }); // 嵌在西墙里
    s.retryNight();
    expect(s.world.player.x).toBeGreaterThan(-9.7);
    const s2 = new Session(new SaveStore(new MemStorage()));
    toDusk(s2, (w) => { w.player.x = 500; w.player.z = -900; });
    s2.retryNight();
    expect(Math.abs(s2.world.player.x)).toBeLessThan(30);
  });
});

describe('异常存档（A11）', () => {
  const cases: [string, string, string][] = [
    ['不是 JSON', '{oops', 'corrupt'],
    ['不是对象', '42', 'corrupt'],
    ['缺版本号', JSON.stringify({ dusk: null }), 'corrupt'],
    ['版本不兼容', JSON.stringify({ version: SAVE_VERSION + 1, dusk: null }), 'version'],
    ['快照结构残缺', JSON.stringify({ version: SAVE_VERSION, dusk: { phase: 'dusk', clock: 0 } }), 'corrupt'],
    ['快照阶段不对', JSON.stringify({ version: SAVE_VERSION, dusk: { phase: 'night' } }), 'corrupt'],
    ['改动前的旧存档（版本 1）', JSON.stringify({ version: 1, savedAt: '', retries: 0, completed: false, dusk: null }), 'version'],
  ];
  for (const [name, raw, status] of cases) {
    it(`${name}：给出原因，不提供继续，可以新开局`, () => {
      const st = new MemStorage();
      st.setItem(SAVE_KEY, raw);
      const store = new SaveStore(st);
      const r = store.load();
      expect(r.status).toBe(status);
      expect(r.message.length).toBeGreaterThan(0);
      const s = new Session(store);
      expect(s.hasSnapshot()).toBe(false);
      s.newGame();
      toDusk(s);
      expect(s.hasSnapshot()).toBe(true);
      expect(new SaveStore(st).load().status).toBe('ok');
    });
  }

  it('浏览器存储被禁用：说明原因，本次会话仍可在内存中重试当晚', () => {
    for (const storage of [new BrokenStorage(), null]) {
      const store = new SaveStore(storage);
      expect(store.available).toBe(false);
      const r = store.load();
      expect(r.status).toBe('unavailable');
      expect(r.message).toContain('存储不可用');
      const s = new Session(store);
      expect(s.hasSnapshot()).toBe(false);
      toDusk(s, (w) => { w.inv.oil = 2; });
      expect(s.lastSavePersisted).toBe(false);
      expect(s.hasSnapshot()).toBe(true);
      toNight(s);
      s.world.inv.oil = 0; s.world.player.hp = 0; run(s, 0.1);
      expect(s.retryNight()).toBe(true);
      expect(s.world.phase).toBe('dusk');
      expect(s.world.inv.oil).toBe(2);
      expect(s.retries).toBe(1);
    }
  });

  it('通关后保留已完成标志，重开当天不丢失', () => {
    const st = new MemStorage();
    const s = new Session(new SaveStore(st));
    toDusk(s);
    s.complete();
    expect(JSON.parse(st.getItem(SAVE_KEY)!).completed).toBe(true);
    s.newGame();
    expect(new SaveStore(st).load().env?.completed).toBe(true);
    expect(s.hasSnapshot()).toBe(false);
  });
});
