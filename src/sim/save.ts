// 存档：带版本号的本地浏览器存储，只保留最近一份黄昏快照与已完成标志（PRD 第 5 节、9.5）。
// 存储不可用时退回内存，本次会话仍可重试。
import { SAVE_KEY, SAVE_VERSION } from '../config';
import { cloneWorld, World } from './state';

export interface SaveEnvelope {
  version: number;
  savedAt: string;
  retries: number;
  completed: boolean;
  /** 黄昏起点的世界状态。尚未到达黄昏时为 null。 */
  dusk: World | null;
}

export type LoadStatus = 'none' | 'ok' | 'corrupt' | 'version' | 'unavailable';

export interface LoadResult { status: LoadStatus; env: SaveEnvelope | null; message: string }

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MESSAGES: Record<LoadStatus, string> = {
  none: '',
  ok: '',
  corrupt: '存档已损坏，无法读取。可以开始新游戏。',
  version: '存档来自不兼容的版本。可以开始新游戏。',
  unavailable: '浏览器存储不可用：进度不会保留到下次打开，本次仍可重试当晚。',
};

function isWorld(v: unknown): v is World {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  const p = w.player as Record<string, unknown> | undefined;
  const inv = w.inv as Record<string, unknown> | undefined;
  return w.phase === 'dusk'
    && typeof w.clock === 'number' && Number.isFinite(w.clock)
    && !!p && typeof p.x === 'number' && typeof p.z === 'number' && typeof p.hp === 'number'
    && Number.isFinite(p.x) && Number.isFinite(p.z)
    && !!inv && typeof inv.wood === 'number' && typeof inv.iron === 'number' && typeof inv.oil === 'number'
    && !!w.repairs && !!w.doors && !!w.taken && !!w.quest && !!w.lantern && !!w.hearth && !!w.braziers && !!w.hints
    && Array.isArray(w.ghosts);
}

export class SaveStore {
  private mem: SaveEnvelope | null = null;
  private storage: StorageLike | null;
  /** 最近一次读写是否落到了浏览器存储。 */
  available = true;

  constructor(storage: StorageLike | null | undefined) {
    this.storage = storage ?? null;
    if (!this.storage) { this.available = false; return; }
    try {
      const probe = `${SAVE_KEY}/probe`;
      this.storage.setItem(probe, '1');
      this.storage.removeItem(probe);
    } catch {
      this.available = false;
    }
  }

  load(): LoadResult {
    if (!this.available || !this.storage) {
      return { status: this.mem ? 'ok' : 'unavailable', env: this.mem, message: MESSAGES.unavailable };
    }
    let raw: string | null;
    try {
      raw = this.storage.getItem(SAVE_KEY);
    } catch {
      this.available = false;
      return { status: 'unavailable', env: this.mem, message: MESSAGES.unavailable };
    }
    if (raw === null) return { status: 'none', env: null, message: '' };
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return { status: 'corrupt', env: null, message: MESSAGES.corrupt };
    }
    if (!data || typeof data !== 'object') return { status: 'corrupt', env: null, message: MESSAGES.corrupt };
    const e = data as Partial<SaveEnvelope>;
    if (typeof e.version !== 'number') return { status: 'corrupt', env: null, message: MESSAGES.corrupt };
    if (e.version !== SAVE_VERSION) return { status: 'version', env: null, message: MESSAGES.version };
    if (e.dusk !== null && !isWorld(e.dusk)) return { status: 'corrupt', env: null, message: MESSAGES.corrupt };
    const env: SaveEnvelope = {
      version: SAVE_VERSION,
      savedAt: typeof e.savedAt === 'string' ? e.savedAt : '',
      retries: typeof e.retries === 'number' && e.retries >= 0 ? Math.floor(e.retries) : 0,
      completed: e.completed === true,
      dusk: e.dusk ?? null,
    };
    this.mem = env;
    return { status: 'ok', env, message: '' };
  }

  private write(env: SaveEnvelope): boolean {
    this.mem = env;
    if (!this.available || !this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(env));
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  current(): SaveEnvelope | null {
    return this.mem;
  }

  /** 黄昏起点建立快照。返回是否写入了浏览器存储。 */
  saveDusk(w: World, retries: number): boolean {
    return this.write({
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      retries,
      completed: this.mem?.completed ?? false,
      dusk: cloneWorld(w),
    });
  }

  setRetries(retries: number): void {
    if (this.mem) this.write({ ...this.mem, retries });
  }

  markCompleted(): void {
    if (this.mem) this.write({ ...this.mem, completed: true });
    else this.write({ version: SAVE_VERSION, savedAt: new Date().toISOString(), retries: 0, completed: true, dusk: null });
  }

  /** 重开当天：清除本次进度，保留已完成标志。 */
  clearProgress(): void {
    const completed = this.mem?.completed ?? false;
    if (completed) this.write({ version: SAVE_VERSION, savedAt: new Date().toISOString(), retries: 0, completed, dusk: null });
    else {
      this.mem = null;
      if (this.available && this.storage) {
        try { this.storage.removeItem(SAVE_KEY); } catch { this.available = false; }
      }
    }
  }

  /** 取一份快照副本用于恢复。重复加载不会共享或复制已消耗的资源。 */
  duskCopy(): World | null {
    return this.mem?.dusk ? cloneWorld(this.mem.dusk) : null;
  }
}
