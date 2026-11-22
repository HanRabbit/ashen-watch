// 一局游戏的进度管理：新开局、继续、重试当晚、重开当天（PRD 第 5 节、9.5）。不依赖渲染。
import { SaveStore } from './save';
import { Hooks, restoreWorld } from './sim';
import { newWorld, SimEvent, UiRequest, World } from './state';

export class Session {
  world: World = newWorld();
  retries = 0;
  ui: UiRequest = { repair: null, board: false };
  /** 最近一次黄昏快照是否写进了浏览器存储。 */
  lastSavePersisted = false;
  onEvent: (e: SimEvent) => void = () => {};

  readonly hooks: Hooks;

  constructor(readonly store: SaveStore) {
    this.hooks = {
      emit: (e) => this.onEvent(e),
      // 黄昏起点先保存快照，再推进当帧交互。
      snapshot: (w) => { this.lastSavePersisted = this.store.saveDusk(w, this.retries); },
      ui: this.ui,
    };
  }

  private resetUi(): void {
    this.ui.repair = null;
    this.ui.board = false;
  }

  hasSnapshot(): boolean {
    return this.store.current()?.dusk != null;
  }

  /** 新游戏或「重开当天」：清除本次进度并重置计数，操作与显示设置另存，不受影响。 */
  newGame(): void {
    this.store.clearProgress();
    this.world = newWorld();
    this.retries = 0;
    this.resetUi();
  }

  /** 标题「继续」：从黄昏起点恢复，不增加重试计数。 */
  continueFromDusk(): boolean {
    const copy = this.store.duskCopy();
    if (!copy) return false;
    this.world = restoreWorld(copy);
    this.retries = this.store.current()?.retries ?? 0;
    this.resetUi();
    return true;
  }

  /** 失败后「重试当晚」：从黄昏起点恢复并增加重试计数。 */
  retryNight(): boolean {
    const copy = this.store.duskCopy();
    if (!copy) return false;
    this.retries += 1;
    this.store.setRetries(this.retries);
    const played = this.world.played;
    this.world = restoreWorld(copy);
    this.world.played = Math.max(played, this.world.played);
    this.resetUi();
    return true;
  }

  complete(): void {
    this.store.markCompleted();
  }
}
