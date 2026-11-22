// 集中配置：时段、移动、燃烧、伤害、修复价格与测试预设（PRD 第 9 节）。
// 所有时间单位为「活动秒」（游戏时钟，暂停不推进），距离单位为米。

export type RepairId = 'lamp' | 'gate' | 'bolt';

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'ashen-watch/save';
export const SETTINGS_KEY = 'ashen-watch/settings';

export const FIXED_DT = 1 / 60;

export const PHASE = {
  dayLength: 6 * 60,
  duskWarnAt: 5 * 60,
  duskLength: 90,
  nightLength: 6 * 60,
};

export const PLAYER = {
  radius: 0.35,
  height: 1.8,
  walkSpeed: 1.8,
  sprintSpeed: 3.1,
  maxHp: 100,
  interactDist: 2.0,
  interactHalfAngle: (80 * Math.PI) / 180,
};

export const LANTERN = {
  startOil: 60,
  oilPerUnit: 100,
  maxOil: 300,
  raiseMultiplier: 3,
  /** 每次举起先耗掉的油（秒）：连点右键不比一直举着省。 */
  raiseStartCost: 3,
  lightRadius: 7,
  raiseLongPressMs: 250,
};

/** 固定光源的亮区：圆形，且只在所在房间的矩形内生效（光不穿墙）。 */
export interface LightZone { x: number; z: number; r: number; x0: number; z0: number; x1: number; z1: number; floor: 'B1' | '1F' | '2F' }

export const WALL_LAMP = {
  burnTime: 180,
  oilCost: 1,
  // 视觉、AI 禁入与调试边界共用这一处定义（PRD 9.4）。
  zone: { x: -4, z: 21, r: 7, x0: -10, z0: 0.5, x1: 10, z1: 28.5, floor: '1F' } as LightZone,
};

export type BrazierId = 'chapel' | 'side';

/** 火盆：不用修，投 1 份油就能点。亮区规则与壁灯相同。 */
export const BRAZIER = {
  burnTime: 180,
  oilCost: 1,
  zones: {
    chapel: { x: 27, z: 18.5, r: 4.5, x0: 13.5, z0: 11, x1: 30.5, z1: 20.3, floor: '1F' },
    side: { x: -9.2, z: 14, r: 3, x0: -10, z0: 2.5, x1: -8.4, z1: 28.5, floor: '2F' },
  } as Record<BrazierId, LightZone>,
};

export const BRAZIER_NAME: Record<BrazierId, string> = { chapel: '祭台火盆', side: '步道火盆' };

export const HEARTH = {
  nightBurn: 240,
  woodBonus: 160,
  warmRate: 2,
  coldRate: 1,
  coldThreshold: 160,
  coldDamagePerSec: 1,
  fastForwardSafeSecs: 10,
  /** 2F 露天步道/桥夜间冷量累积倍率（寒风）。上廊有顶不加成。 */
  walkColdFactor: 1.5,
};

export const MEAL = { heal: 30, coldFactor: 0.5 };

export const REPAIR_COST: Record<RepairId, { wood: number; iron: number }> = {
  lamp: { wood: 2, iron: 1 },
  gate: { wood: 1, iron: 2 },
  bolt: { wood: 2, iron: 2 },
};

export const REPAIR_NAME: Record<RepairId, string> = {
  lamp: '庭院壁灯',
  gate: '楼梯栅门',
  bolt: '门房门闩',
};

export const GHOST = {
  radius: 0.4,
  sharedAttackGap: 2.0,
  perceiveHz: 8,
  /** 举灯期间鬼一直不敢扑；放下后它还会退这么久。 */
  repelDuration: 1,
  /** 逼退的音效和字幕最短间隔，避免一直举着时刷屏。 */
  repelCueGap: 6,
  /** 被灯光压住累计这么久，它就放弃退走，并在一段时间内不再理会玩家。 */
  giveUpAfter: 3,
  /** 已经在后退的鬼，灯光在逼退距离之外这么远仍压得住它（不然它会在边缘来回试探）。 */
  repelHoldMargin: 3,
  cowedSecs: 8,
  alertPause: 1.0,
  loseSightAfter: 4.0,
  hitRange: 2.0,
  grey: {
    patrolSpeed: 1.1,
    chaseSpeed: 2.4,
    sightLit: 15,
    sightDark: 6.5,
    fovHalf: (65 * Math.PI) / 180,
    windup: 1.2,
    recover: 1.6,
    damage: 25,
    attackRange: 1.7,
    repelRange: 4.5,
    doorBangSecs: 3.0,
    doorEnterPause: 1.2,
  },
  wraith: {
    patrolSpeed: 1.25,
    chaseSpeed: 2.3,
    sightLit: 13,
    sightDark: 5.5,
    fovHalf: (75 * Math.PI) / 180,
    windup: 1.6,
    recover: 1.8,
    damage: 20,
    attackRange: 1.7,
    repelRange: 7,
    flankOffset: 2.6,
  },
  noise: { sprint: 9, gate: 14, chest: 40, door: 6 },
  dissolveSecs: 2.0,
};

export interface Preset {
  name: string;
  /** 整个模拟的倍率（含移动与敌人）。发布预设为 1，自动化验证可用 ?timescale= 调高。 */
  timeScale: number;
  /** 只加速白天与黄昏的时钟，移动和夜晚保持正常速度。发布预设为 1。 */
  dayClockScale: number;
  /** 开发预设允许从调试接口跳阶段。 */
  debug: boolean;
}

export const PRESETS: Record<string, Preset> = {
  release: { name: 'release', timeScale: 1, dayClockScale: 1, debug: false },
  dev: { name: 'dev', timeScale: 1, dayClockScale: 6, debug: true },
};

export function pickPreset(search: string): Preset {
  const p = new URLSearchParams(search);
  const name = p.get('preset');
  const base = name && PRESETS[name] ? { ...PRESETS[name] } : { ...PRESETS.release };
  const ts = Number(p.get('timescale'));
  if (name === 'dev' && ts > 0 && ts <= 60) base.timeScale = ts;
  const ds = Number(p.get('dayscale'));
  if (name === 'dev' && ds > 0 && ds <= 120) base.dayClockScale = ds;
  return base;
}
