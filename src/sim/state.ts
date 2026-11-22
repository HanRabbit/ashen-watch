// 世界状态：纯数据，可整体 JSON 序列化为黄昏快照（PRD 第 5 节、9.5）。
import { BrazierId, LANTERN, PLAYER, RepairId } from '../config';
import { DoorId, GHOST_SPAWN, SPAWN } from './level';

export type Phase = 'tutorial' | 'day' | 'dusk' | 'night' | 'dawn' | 'ended' | 'failed';
export type GhostKind = 'grey' | 'wraith';
export type GhostMode =
  | 'patrol' | 'investigate' | 'alert' | 'chase' | 'windup' | 'recover'
  | 'recoil' | 'flee' | 'bang' | 'dissolve' | 'gone';

export interface Vec2 { x: number; z: number }

export interface GhostState {
  kind: GhostKind;
  x: number; z: number; yaw: number;
  mode: GhostMode;
  /** 当前状态已持续的活动秒。 */
  t: number;
  patrolIdx: number;
  path: Vec2[];
  goal: Vec2 | null;
  lastKnown: Vec2 | null;
  canSee: boolean;
  loseT: number;
  senseT: number;
  repathT: number;
  stuckT: number;
  /** 逼退提示（音效与字幕）的冷却。 */
  repelCd: number;
  /** 被举起的提灯压住的累计秒数，回到巡游时清零。 */
  lightT: number;
  /** 被灯吓退后不理会玩家的剩余秒数。 */
  cowed: number;
  sawSprint: boolean;
  flankSide: number;
  /** 拍门结束后是否破门（未加闩时为 true）。 */
  bangOpens: boolean;
  /** 等待另一只鬼释放攻击许可。 */
  waiting: boolean;
}

export interface World {
  phase: Phase;
  /** 当前阶段内的活动秒。 */
  clock: number;
  /** 教学结束后累计的活动秒。 */
  total: number;
  /** 本局累计游玩的活动秒（含教学与晨曦，重试不回退），结算用。 */
  played: number;
  duskWarned: boolean;
  player: { x: number; z: number; yaw: number; pitch: number; hp: number; cold: number; moving: boolean; sprinting: boolean };
  inv: { wood: number; iron: number; oil: number; meal: number; hasLantern: boolean; hasClapper: boolean };
  lantern: { oil: number; on: boolean; raised: boolean };
  repairs: Record<RepairId, boolean>;
  doors: Record<DoorId, boolean>;
  bolted: boolean;
  lampBurn: number;
  /** 两个火盆各自剩余的燃烧秒数，0 为未点。 */
  braziers: Record<BrazierId, number>;
  hearth: { lit: boolean; burn: number };
  taken: { shelf: boolean; crate: boolean; flask: boolean; food: boolean; chest: boolean };
  quest: {
    boardRead: boolean;
    clapperAt: 'night' | 'dawn' | null;
    returnedBeforeDawn: boolean;
    installed: boolean;
    rung: boolean;
  };
  ghosts: GhostState[];
  /** last 是上一次扑击的鬼：两只都在等时让另一只先来。 */
  attack: { holder: GhostKind | null; lastRelease: number; last: GhostKind | null };
  /** 夜间累计活动秒，供攻击间隔等使用。 */
  nightT: number;
  safeT: number;
  failReason: string;
  /** 只提示一次的教学。 */
  hints: { raise: boolean };
  /** 结算用：黄昏快照之后才重置的计数由存档信封保存。 */
  hurtFlash: number;
}

export interface SimEvent {
  kind: 'sfx' | 'toast' | 'subtitle' | 'phase' | 'hurt' | 'quest' | 'snapshot';
  id?: string;
  text?: string;
  x?: number;
  z?: number;
}

/** 不进存档的界面请求。 */
export interface UiRequest { repair: RepairId | null; board: boolean }

export function newGhost(kind: GhostKind): GhostState {
  const s = GHOST_SPAWN[kind];
  return {
    kind, x: s.x, z: s.z, yaw: s.yaw, mode: 'patrol', t: 0, patrolIdx: 0, path: [], goal: null,
    lastKnown: null, canSee: false, loseT: 0, senseT: kind === 'grey' ? 0 : 0.06, repathT: 0, stuckT: 0,
    repelCd: 0, lightT: 0, cowed: 0, sawSprint: false, flankSide: 1, bangOpens: false, waiting: false,
  };
}

export function newWorld(): World {
  return {
    phase: 'tutorial', clock: 0, total: 0, played: 0, duskWarned: false,
    player: { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, pitch: 0, hp: PLAYER.maxHp, cold: 0, moving: false, sprinting: false },
    inv: { wood: 0, iron: 0, oil: 0, meal: 0, hasLantern: false, hasClapper: false },
    lantern: { oil: LANTERN.startOil, on: false, raised: false },
    repairs: { lamp: false, gate: false, bolt: false },
    // 礼拜堂侧门的门扇早已松脱，只剩门洞，恒为敞开；其余门默认关闭。
    doors: { gatehouse: false, gate: false, chapelFront: false, chapelSide: true },
    bolted: false,
    lampBurn: 0,
    braziers: { chapel: 0, side: 0 },
    hearth: { lit: true, burn: 0 },
    taken: { shelf: false, crate: false, flask: false, food: false, chest: false },
    quest: { boardRead: false, clapperAt: null, returnedBeforeDawn: false, installed: false, rung: false },
    ghosts: [],
    attack: { holder: null, lastRelease: -100, last: null },
    nightT: 0, safeT: 0, failReason: '', hints: { raise: false }, hurtFlash: 0,
  };
}

export function cloneWorld(w: World): World {
  return JSON.parse(JSON.stringify(w)) as World;
}
