// 无头测试用的驱动：用与游戏相同的固定步长推进模拟，并让「机器人玩家」沿导航图走位、对准并交互。
import { FIXED_DT, RepairId } from '../src/config';
import { INTERACTS, InteractId } from '../src/sim/level';
import { findPath } from '../src/sim/nav';
import { Action, Hooks, pickTarget, step, StepInput } from '../src/sim/sim';
import { cloneWorld, newWorld, SimEvent, UiRequest, World } from '../src/sim/state';

export class Driver {
  w: World = newWorld();
  events: SimEvent[] = [];
  snapshots: World[] = [];
  ui: UiRequest = { repair: null, board: false };
  hooks: Hooks = {
    emit: (e) => { this.events.push(e); },
    snapshot: (w) => { this.snapshots.push(cloneWorld(w)); },
    ui: this.ui,
  };
  yaw = 0;
  /** 每步结束后的观察回调（用于断言不变量）。 */
  onStep: ((w: World) => void) | null = null;

  tick(partial: Partial<StepInput> = {}, actions: Action[] = []): void {
    const input: StepInput = {
      forward: 0, strafe: 0, sprint: false, raise: false, yaw: this.yaw, pitch: 0, actions, ...partial,
    };
    step(this.w, input, FIXED_DT, this.hooks);
    this.onStep?.(this.w);
  }

  wait(secs: number, partial: Partial<StepInput> = {}): void {
    const n = Math.round(secs / FIXED_DT);
    for (let i = 0; i < n && this.alive(); i++) this.tick(partial);
  }

  alive(): boolean {
    return this.w.phase !== 'failed' && this.w.phase !== 'ended';
  }

  waitUntil(pred: (w: World) => boolean, maxSecs: number, partial: Partial<StepInput> = {}): boolean {
    const n = Math.round(maxSecs / FIXED_DT);
    for (let i = 0; i < n; i++) {
      if (pred(this.w)) return true;
      if (!this.alive()) return false;
      this.tick(partial);
    }
    return pred(this.w);
  }

  face(x: number, z: number): void {
    this.yaw = Math.atan2(x - this.w.player.x, z - this.w.player.z);
  }

  /** 沿导航图走到某点附近。返回所用的活动秒；走不到返回 -1。 */
  walkTo(x: number, z: number, opts: { sprint?: boolean; stopDist?: number; maxSecs?: number; raise?: boolean; floor?: 'B1' | '1F' | '2F' } = {}): number {
    const stop = opts.stopDist ?? 0.25;
    const max = Math.round((opts.maxSecs ?? 120) / FIXED_DT);
    let path = findPath(this.w.player, { x, z, floor: opts.floor }, { doors: this.w.doors, lit: [] });
    if (!path) return -1;
    let steps = 0, repath = 0;
    while (steps < max && this.alive()) {
      const p = this.w.player;
      if (Math.hypot(p.x - x, p.z - z) <= stop) return steps * FIXED_DT;
      while (path.length > 1 && Math.hypot(path[0].x - p.x, path[0].z - p.z) < 0.3) path.shift();
      if (!path.length) {
        const np = findPath(p, { x, z, floor: opts.floor }, { doors: this.w.doors, lit: [] });
        if (!np) return -1;
        path = np;
        continue;
      }
      if (path.length === 1 && Math.hypot(path[0].x - p.x, path[0].z - p.z) < 0.05) return steps * FIXED_DT;
      this.face(path[0].x, path[0].z);
      this.tick({ forward: 1, sprint: !!opts.sprint, raise: !!opts.raise });
      steps++;
      if (++repath >= 30) {
        repath = 0;
        const np = findPath(p, { x, z, floor: opts.floor }, { doors: this.w.doors, lit: [] });
        if (np) path = np;
      }
    }
    return Math.hypot(this.w.player.x - x, this.w.player.z - z) <= stop + 0.6 ? steps * FIXED_DT : -1;
  }

  /** 沿楼梯坡面直走（固定朝向），直到越过目标坐标。用于确定性地上下梯。 */
  driveStair(axis: 'x' | 'z', target: number, yaw: number, maxSecs = 20): boolean {
    this.yaw = yaw;
    const max = Math.round(maxSecs / FIXED_DT);
    for (let i = 0; i < max && this.alive(); i++) {
      const c = axis === 'x' ? this.w.player.x : this.w.player.z;
      if (yaw === 0 || yaw === Math.PI / 2 ? c >= target : c <= target) return true;
      this.tick({ forward: 1 });
    }
    const c = axis === 'x' ? this.w.player.x : this.w.player.z;
    return yaw === 0 || yaw === Math.PI / 2 ? c >= target : c <= target;
  }

  /** 对准某交互点并按一次交互。返回当时准星命中的目标是否就是它且可用。 */
  use(id: InteractId): boolean {
    const it = INTERACTS.find((i) => i.id === id)!;
    this.face(it.x, it.z);
    this.w.player.yaw = this.yaw;
    const t = pickTarget(this.w);
    const ok = !!t && t.id === id && t.enabled;
    this.tick({}, [{ type: 'interact' }]);
    return ok;
  }

  /** 走到交互点旁边再交互。 */
  goUse(id: InteractId, from?: { x: number; z: number }, sprint = false): boolean {
    const it = INTERACTS.find((i) => i.id === id)!;
    const at = from ?? { x: it.x, z: it.z };
    this.walkTo(at.x, at.z, { stopDist: from ? 0.3 : 1.4, sprint });
    return this.use(id);
  }

  repair(id: RepairId): void {
    this.ui.repair = null;
    this.tick({}, [{ type: 'confirmRepair', id }]);
  }

  texts(): string[] {
    return this.events.filter((e) => e.text).map((e) => e.text!);
  }

  lastToast(): string {
    const t = this.events.filter((e) => e.kind === 'toast');
    return t.length ? t[t.length - 1].text ?? '' : '';
  }
}

/** 站位：从这些点对准对应交互点时一定在 2 m 内且无遮挡。 */
export const STAND = {
  lantern: { x: 0.9, z: -5.6 },
  board: { x: 1.9, z: -1.6 },
  refuel: { x: 1.4, z: -4.5 },
  hearth: { x: -1.3, z: -4.4 },
  pot: { x: -1.5, z: -2.0 },
  woodpile: { x: -1.3, z: -6.3 },
  doorIn: { x: -0.2, z: -1.0 },
  doorOut: { x: -0.2, z: 1.4 },
  boltIn: { x: 0.4, z: -1.1 },
  bell: { x: 1.4, z: 1.5 },
  shelf: { x: -8.2, z: 6.2 },
  lamp: { x: -5, z: 27.4 },
  gateW: { x: 23.2, z: 21.15 },   // 上廊侧（栅门西）
  gateE: { x: 24.6, z: 21.15 },   // 平台侧（栅门东）
  crate: { x: 12.1, z: 19.4 },
  frontOut: { x: 12.6, z: 16.5 },
  frontIn: { x: 14.4, z: 16.5 },
  flask: { x: 15.8, z: 13.0 },    // B1 储藏室
  chest: { x: 27.6, z: 16.5 },
  cot: { x: 0.6, z: -6.5 },
  brazierChapel: { x: 26.2, z: 18.5 },
  brazierSide: { x: -9.2, z: 15.2 }, // 2F 西步道
  cellar: { x: 5.9, z: 8.0 },     // B1 地窖
  s1Top: { x: 4.0, z: 9.9 },
  s2Top: { x: 14.9, z: 21.2 },
  s3Bot: { x: 3.4, z: 1.4 },
  s4Bot: { x: 29.0, z: 21.2 },
} as const;

/** 教学：拾提灯、看任务板并关闭。 */
export function doTutorial(d: Driver): void {
  d.walkTo(STAND.lantern.x, STAND.lantern.z);
  d.use('lantern');
  d.walkTo(STAND.board.x, STAND.board.z);
  d.use('board');
  d.ui.board = false;
  d.tick({}, [{ type: 'boardClosed' }]);
}

export function openGatehouseDoor(d: Driver): void {
  d.walkTo(STAND.doorIn.x, STAND.doorIn.z);
  if (!d.w.doors.gatehouse) d.use('ghDoor');
}
