// 操作与显示设置：键位、灵敏度、亮度、音量、操作方式。与进度存档分开保存，重开当天不清除。
import { SETTINGS_KEY } from './config';

export type BindAction =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'interact' | 'lantern' | 'eat' | 'tasks';

export const BIND_LABEL: Record<BindAction, string> = {
  forward: '前进', back: '后退', left: '左移', right: '右移', sprint: '冲刺',
  interact: '交互', lantern: '提灯开关', eat: '用热食', tasks: '任务与资源',
};

export const DEFAULT_BINDS: Record<BindAction, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft',
  interact: 'KeyE', lantern: 'KeyF', eat: 'KeyH', tasks: 'Tab',
};

export interface Settings {
  mode: 'kbm' | 'mouse';
  sensitivity: number;
  brightness: number;
  volume: number;
  quality: 'high' | 'low';
  binds: Record<BindAction, string>;
}

export function defaultSettings(): Settings {
  return { mode: 'kbm', sensitivity: 1, brightness: 1, volume: 0.7, quality: 'high', binds: { ...DEFAULT_BINDS } };
}

const clamp = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return s;
    const d = JSON.parse(raw) as Partial<Settings>;
    if (d.mode === 'mouse' || d.mode === 'kbm') s.mode = d.mode;
    s.sensitivity = clamp(d.sensitivity, 0.2, 3, 1);
    s.brightness = clamp(d.brightness, 0.5, 2, 1);
    s.volume = clamp(d.volume, 0, 1, 0.7);
    if (d.quality === 'high' || d.quality === 'low') s.quality = d.quality;
    if (d.binds && typeof d.binds === 'object') {
      for (const k of Object.keys(DEFAULT_BINDS) as BindAction[]) {
        const v = (d.binds as Record<string, unknown>)[k];
        if (typeof v === 'string' && v && v !== 'Escape') s.binds[k] = v;
      }
    }
  } catch {
    // 存储不可用或内容损坏：使用默认设置。
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // 存储不可用时设置只在本次会话生效。
  }
}

const KEY_NAMES: Record<string, string> = {
  ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl',
  AltLeft: '左 Alt', AltRight: '右 Alt', Space: '空格', Tab: 'Tab', Enter: '回车',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};

export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
