// 输入：键鼠与纯鼠标共用移动、交互、举灯、冲刺动作（PRD 9.3）。
// 鼠标按下、释放、失焦分别处理；失去捕获或失焦时清除连续输入与冲刺锁定。
import { LANTERN } from './config';
import { BindAction, Settings } from './settings';

export type Press = 'interact' | 'toggleLantern' | 'eat' | 'tasks' | 'toolbar';

const PITCH_LIMIT = (55 * Math.PI) / 180;
const BASE_SENS = 0.0023;

export class Input {
  yaw = 0;
  pitch = 0.12;
  locked = false;
  /** 调试用：不依赖浏览器鼠标捕获（仅开发预设）。 */
  fakeLock = false;

  private keys = new Set<string>();
  private walking = false;
  private sprintLock = false;
  private rightDown = false;
  private rightDownAt = 0;
  private rightLong = false;
  private presses: Press[] = [];
  private rebind: ((code: string) => void) | null = null;
  /** 刚发出原始输入捕获请求：它的失败事件不上报，由 lock() 自动退回普通捕获。 */
  private rawTry = false;

  onLockChange: (locked: boolean) => void = () => {};
  onLockError: () => void = () => {};
  /** 失焦或标签页隐藏。 */
  onBlur: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement, private settings: Settings) {
    document.addEventListener('pointerlockchange', () => {
      if (this.fakeLock) return;
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.rawTry = false;
      else this.clear();
      this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      // 原始输入请求的失败事件只吞一次：它与 Promise 拒绝谁先到不确定
      if (this.rawTry) { this.rawTry = false; return; }
      this.onLockError();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const k = BASE_SENS * this.settings.sensitivity;
      this.yaw += e.movementX * k;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + e.movementY * k));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      if (e.button === 0 && this.settings.mode === 'mouse') this.walking = true;
      else if (e.button === 2) { this.rightDown = true; this.rightDownAt = performance.now(); this.rightLong = false; }
      else if (e.button === 1 && this.settings.mode === 'mouse') this.presses.push('toolbar');
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.walking = false;
      else if (e.button === 2) {
        // 纯鼠标：短按释放才交互；长按已转为举灯，取消本次短按动作。
        if (this.locked && this.rightDown && !this.rightLong
          && performance.now() - this.rightDownAt < LANTERN.raiseLongPressMs && this.settings.mode === 'mouse') this.presses.push('interact');
        this.rightDown = false; this.rightLong = false;
      }
    });
    document.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (!this.locked || this.settings.mode !== 'mouse') return;
      if (e.deltaY < 0) this.sprintLock = true;
      else if (e.deltaY > 0) this.sprintLock = false;
    }, { passive: true });
    document.addEventListener('keydown', (e) => {
      if (this.rebind) {
        e.preventDefault();
        const cb = this.rebind;
        this.rebind = null;
        cb(e.code);
        return;
      }
      if (e.code === 'Tab') e.preventDefault();
      if (!this.locked || e.repeat) return;
      this.keys.add(e.code);
      const b = this.settings.binds;
      if (e.code === b.interact) this.presses.push('interact');
      else if (e.code === b.lantern) this.presses.push('toggleLantern');
      else if (e.code === b.eat) this.presses.push('eat');
      else if (e.code === b.tasks) this.presses.push('tasks');
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.clear(); this.onBlur(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.clear(); this.onBlur(); }
    });
  }

  /** 必须在用户点击的回调里调用。失败时触发 onLockError，由界面提示并允许重试。 */
  requestLock(): void {
    if (this.fakeLock) { this.locked = true; this.onLockChange(true); return; }
    this.lock(true);
  }

  /**
   * raw 为 true 时请求原始鼠标输入：不受系统「提高指针精确度」加速影响，同样的手部移动转过同样的角度。
   * 浏览器不支持时退回普通捕获。
   */
  private lock(raw: boolean): void {
    if (raw) this.rawTry = true;
    const fail = (): void => { if (raw) this.lock(false); else this.onLockError(); };
    try {
      const r = this.canvas.requestPointerLock(raw ? { unadjustedMovement: true } : undefined) as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(fail);
      else this.rawTry = false; // 旧版浏览器不返回 Promise，也不识别该选项：失败只能从事件得知
    } catch {
      fail();
    }
  }

  releaseLock(): void {
    this.clear();
    if (this.fakeLock) { this.locked = false; this.onLockChange(false); return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** 清除连续输入与冲刺锁定，回到游戏后须重新按下才移动。 */
  clear(): void {
    this.keys.clear();
    this.walking = false;
    this.sprintLock = false;
    this.rightDown = false;
    this.rightLong = false;
    this.presses.length = 0;
  }

  private down(a: BindAction): boolean {
    const code = this.settings.binds[a];
    if (this.keys.has(code)) return true;
    return a === 'sprint' && code === 'ShiftLeft' && this.keys.has('ShiftRight');
  }

  /** 每帧读取连续输入。 */
  poll(): { forward: number; strafe: number; sprint: boolean; raise: boolean } {
    if (!this.locked) return { forward: 0, strafe: 0, sprint: false, raise: false };
    let forward = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
    const strafe = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    if (this.walking) forward = 1;
    let raise = false;
    if (this.rightDown) {
      if (this.settings.mode === 'kbm') raise = true;
      else if (performance.now() - this.rightDownAt >= LANTERN.raiseLongPressMs) { this.rightLong = true; raise = true; }
    }
    return { forward, strafe, sprint: this.down('sprint') || this.sprintLock, raise };
  }

  takePresses(): Press[] {
    const p = this.presses;
    this.presses = [];
    return p;
  }

  get sprintLocked(): boolean {
    return this.sprintLock;
  }

  captureNextKey(cb: (code: string) => void): void {
    this.rebind = cb;
  }

  cancelCapture(): void {
    this.rebind = null;
  }
}
