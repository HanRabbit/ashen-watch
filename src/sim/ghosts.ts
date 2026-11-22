// 双鬼：感知（写入事实）→ 决策（状态机）→ 寻路（节点图）→ 位移。两鬼共用一个攻击许可（PRD 第 4 节、9.4）。
import { GHOST, LightZone } from '../config';
import { hasLineOfSight, moveCircle, solidBoxes } from './collision';
import { Box, PATROL, regionAt } from './level';
import { findPath, inAnyZone, inZone, litZones, NavCtx, nearestNode, node } from './nav';
import { GhostMode, GhostState, SimEvent, Vec2, World } from './state';

export interface Noise { x: number; z: number; r: number; kind: 'sprint' | 'gate' | 'chest' | 'door' }

const DOOR_FRONT: Vec2 = { x: 0, z: 1.25 };
const NAME = { grey: '灰影', wraith: '黑影' } as const;

function ctxOf(w: World): NavCtx {
  return { doors: w.doors, lit: litZones(w) };
}

function setMode(g: GhostState, mode: GhostMode): void {
  if (mode === 'patrol') g.lightT = 0;
  g.mode = mode;
  g.t = 0;
  g.waiting = false;
}

function releasePermit(w: World, g: GhostState): void {
  if (w.attack.holder === g.kind) {
    w.attack.holder = null;
    w.attack.lastRelease = w.nightT;
  }
}

function faceTo(g: GhostState, x: number, z: number, dt: number, rate = 6): void {
  const want = Math.atan2(x - g.x, z - g.z);
  let d = want - g.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  g.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
}

function playerLit(w: World): boolean {
  const p = w.player;
  if (w.lantern.on && w.lantern.oil > 0) return true;
  if (inAnyZone(litZones(w), p.x, p.z)) return true;
  return w.hearth.lit && regionAt(p.x, p.z) === 'gatehouse';
}

/** 感知：由近到远、由便宜到贵（距离 → 视锥 → 视线）。 */
function sense(g: GhostState, w: World): void {
  const cfg = GHOST[g.kind];
  const p = w.player;
  const dx = p.x - g.x, dz = p.z - g.z;
  const d2 = dx * dx + dz * dz;
  const range = playerLit(w) ? cfg.sightLit : cfg.sightDark;
  let see = g.cowed <= 0 && d2 < range * range;
  if (see) {
    const engaged = g.mode === 'chase' || g.mode === 'windup' || g.mode === 'alert' || g.mode === 'recover';
    if (!engaged && d2 > 2.2 * 2.2) {
      const d = Math.sqrt(d2);
      const dot = (Math.sin(g.yaw) * dx + Math.cos(g.yaw) * dz) / d;
      if (dot < Math.cos(cfg.fovHalf)) see = false;
    }
  }
  if (see) see = hasLineOfSight(g.x, g.z, p.x, p.z, w.doors);
  g.canSee = see;
  if (see) {
    g.lastKnown = { x: p.x, z: p.z };
    g.loseT = 0;
    if (p.sprinting) g.sawSprint = true;
  }
}

function setGoal(g: GhostState, w: World, goal: Vec2, exact = true): boolean {
  const path = findPath({ x: g.x, z: g.z }, goal, ctxOf(w), exact);
  g.goal = goal;
  g.path = path ?? [];
  g.repathT = 0.4;
  return path !== null;
}

/** 沿路径走一步。返回 true 表示已到达路径终点。 */
function stepAlong(g: GhostState, w: World, speed: number, dt: number, boxes: Box[]): boolean {
  const reach = Math.max(0.3, speed * dt);
  while (g.path.length && Math.hypot(g.path[0].x - g.x, g.path[0].z - g.z) < reach) g.path.shift();
  if (!g.path.length) return true;
  const t = g.path[0];
  const d = Math.hypot(t.x - g.x, t.z - g.z);
  const bx = g.x, bz = g.z;
  moveCircle(g, ((t.x - g.x) / d) * speed * dt, ((t.z - g.z) / d) * speed * dt, GHOST.radius, boxes);
  faceTo(g, t.x, t.z, dt);
  // 停滞保护：2 秒内几乎没动就重新寻路。
  const moved = Math.hypot(g.x - bx, g.z - bz);
  g.stuckT = moved < speed * dt * 0.25 ? g.stuckT + dt : 0;
  if (g.stuckT > 2) { g.stuckT = 0; g.path = []; g.repathT = 0; }
  return false;
}

/** 亮区边缘是一堵看不见的墙：踩进来的鬼沿半径推回去。推出去会越过房间边界时不推，交给「退到暗处」处理。 */
function keepOutOfLight(g: GhostState, lit: LightZone[], boxes: Box[]): void {
  if (g.mode === 'flee') return;
  for (const zn of lit) {
    if (!inZone(zn, g.x, g.z)) continue;
    const dx = g.x - zn.x, dz = g.z - zn.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) continue;
    const nx = zn.x + (dx / d) * zn.r, nz = zn.z + (dz / d) * zn.r;
    if (nx < zn.x0 + GHOST.radius || nx > zn.x1 - GHOST.radius || nz < zn.z0 + GHOST.radius || nz > zn.z1 - GHOST.radius) continue;
    g.x = nx; g.z = nz;
    moveCircle(g, 0, 0, GHOST.radius, boxes);
  }
}

/** 鬼察觉玩家：音效、字幕，第一次时教玩家举灯。 */
function spot(g: GhostState, w: World, emit: (e: SimEvent) => void, text: string): void {
  setMode(g, 'alert');
  emit({ kind: 'sfx', id: g.kind === 'grey' ? 'greyAlert' : 'wraithAlert', x: g.x, z: g.z });
  emit({ kind: 'subtitle', text, x: g.x, z: g.z });
  if (!w.hints.raise) {
    w.hints.raise = true;
    emit({ kind: 'toast', text: `它们怕光：按住右键举灯，照它约 ${GHOST.giveUpAfter} 秒它就会退走（举灯耗油更快）` });
  }
}

function nextPatrol(g: GhostState, w: World): boolean {
  const list = PATROL[g.kind];
  for (let i = 0; i < list.length; i++) {
    const n = node(list[g.patrolIdx % list.length]);
    if (setGoal(g, w, { x: n.x, z: n.z }) && g.path.length) return true;
    g.patrolIdx = (g.patrolIdx + 1) % list.length;
  }
  g.path = [];
  return false;
}

function hear(g: GhostState, w: World, noises: Noise[], emit: (e: SimEvent) => void): void {
  if (g.mode !== 'patrol' && g.mode !== 'investigate') return;
  for (const n of noises) {
    // 黑影主要靠眼睛盯冲刺目标，对声音只有一半敏感。
    const r = g.kind === 'wraith' && n.kind !== 'chest' ? n.r * 0.5 : n.r;
    if ((n.x - g.x) ** 2 + (n.z - g.z) ** 2 > r * r) continue;
    if (!setGoal(g, w, { x: n.x, z: n.z }) && !g.path.length) continue;
    if (g.mode !== 'investigate') {
      emit({ kind: 'subtitle', text: `【${NAME[g.kind]}】被响动引了过去`, x: g.x, z: g.z });
    }
    setMode(g, 'investigate');
    return;
  }
}

function tryAttack(g: GhostState, w: World, emit: (e: SimEvent) => void): boolean {
  if (w.attack.holder !== null) return false;
  if (w.nightT - w.attack.lastRelease < GHOST.sharedAttackGap) return false;
  // 上一次是自己扑的、另一只也在近身等着：让给它，两只轮流
  if (w.attack.last === g.kind && w.ghosts.some((o) => o !== g && o.mode === 'chase' && o.waiting)) return false;
  w.attack.holder = g.kind;
  w.attack.last = g.kind;
  setMode(g, 'windup');
  emit({ kind: 'sfx', id: g.kind === 'grey' ? 'greyWindup' : 'wraithWindup', x: g.x, z: g.z });
  emit({
    kind: 'subtitle',
    text: g.kind === 'grey' ? '【灰影】扬臂前扑——快退开或举灯！' : '【黑影】扬起披布，一声干涩的拖擦——要扑了！',
    x: g.x, z: g.z,
  });
  return true;
}

function updateGhost(g: GhostState, w: World, dt: number, boxes: Box[], noises: Noise[], emit: (e: SimEvent) => void): void {
  if (g.mode === 'gone') return;
  g.t += dt;
  if (g.mode === 'dissolve') {
    if (g.t >= GHOST.dissolveSecs) setMode(g, 'gone');
    return;
  }
  const cfg = GHOST[g.kind];
  const p = w.player;
  g.repelCd = Math.max(0, g.repelCd - dt);
  g.cowed = Math.max(0, g.cowed - dt);
  g.repathT -= dt;
  g.senseT -= dt;
  if (g.senseT <= 0) { g.senseT = 1 / GHOST.perceiveHz; sense(g, w); }
  if (!g.canSee) g.loseT += dt;
  const dist = Math.hypot(p.x - g.x, p.z - g.z);
  const lit = litZones(w);

  // 固定灯新亮起：位于亮区内的鬼优先退到最近可达暗处。
  if (g.mode !== 'flee' && inAnyZone(lit, g.x, g.z, -0.05)) {
    releasePermit(w, g);
    const dark = nearestNode(g.x, g.z, ctxOf(w), boxes) ?? nearestNode(g.x, g.z, ctxOf(w), boxes, false);
    g.path = dark ? [{ x: dark.x, z: dark.z }] : [];
    setMode(g, 'flee');
    emit({ kind: 'subtitle', text: `【${NAME[g.kind]}】被灯光逼出了亮处`, x: g.x, z: g.z });
  }

  // 举灯逼退：需要有油、点亮、有直接视线。只要举着，范围内的鬼就一直后退，不会进入前摇。
  const raised = w.lantern.raised && w.lantern.on && w.lantern.oil > 0;
  const repelled = raised && dist < cfg.repelRange && hasLineOfSight(g.x, g.z, p.x, p.z, w.doors);
  const repellable = g.mode === 'chase' || g.mode === 'windup' || g.mode === 'alert' || g.mode === 'investigate' || g.mode === 'recover';
  if (repelled && repellable) {
    releasePermit(w, g);
    setMode(g, 'recoil');
    if (g.repelCd <= 0) {
      g.repelCd = GHOST.repelCueGap;
      emit({ kind: 'sfx', id: 'recoil', x: g.x, z: g.z });
      emit({ kind: 'subtitle', text: g.kind === 'grey' ? '【灰影】被灯光逼退' : '【黑影】畏光，退向墙边', x: g.x, z: g.z });
    }
  }

  switch (g.mode) {
    case 'patrol': {
      if (g.canSee) {
        spot(g, w, emit, g.kind === 'grey' ? '【灰影】短促的吸气声——它察觉到你了' : '【黑影】布料拖擦，它抬起了身子');
        break;
      }
      hear(g, w, noises, emit);
      if (g.mode !== 'patrol') break;
      if (g.repathT <= 0 || !g.path.length) {
        if (!nextPatrol(g, w)) break;
        g.repathT = 1.0;
      }
      if (stepAlong(g, w, cfg.patrolSpeed, dt, boxes)) {
        g.patrolIdx = (g.patrolIdx + 1) % PATROL[g.kind].length;
        g.path = [];
      }
      break;
    }
    case 'investigate': {
      if (g.canSee) {
        spot(g, w, emit, `【${NAME[g.kind]}】发现了你`);
        break;
      }
      hear(g, w, noises, emit);
      if (g.repathT <= 0 && g.goal) { setGoal(g, w, g.goal); g.repathT = 1.0; }
      const arrived = stepAlong(g, w, cfg.patrolSpeed * 1.35, dt, boxes);
      if (!arrived) g.t = 0;
      else if (g.t > 2.5) setMode(g, 'patrol');
      break;
    }
    case 'alert': {
      faceTo(g, p.x, p.z, dt, 5);
      if (g.t >= GHOST.alertPause) setMode(g, g.canSee || g.lastKnown ? 'chase' : 'patrol');
      break;
    }
    case 'chase': {
      const inGatehouse = regionAt(p.x, p.z) === 'gatehouse';
      const lk = g.lastKnown;
      const lkInGatehouse = !!lk && lk.z < 0.6 && Math.abs(lk.x) < 3.5;
      const lkNearDoor = !!lk && Math.hypot(lk.x - DOOR_FRONT.x, lk.z - DOOR_FRONT.z) < 6;
      // 灰影把人一路追进关着门的门房：到门前拍门。
      if (g.kind === 'grey' && !w.doors.gatehouse && (lkInGatehouse || (inGatehouse && lkNearDoor)) && g.z > 0.5) {
        g.loseT = 0;
        if (Math.hypot(g.x - DOOR_FRONT.x, g.z - DOOR_FRONT.z) < 0.7) {
          g.bangOpens = !w.bolted;
          setMode(g, 'bang');
          emit({ kind: 'sfx', id: 'bang', x: g.x, z: g.z });
          emit({ kind: 'subtitle', text: '【灰影】开始拍门——加闩，或者准备举灯', x: g.x, z: g.z });
          break;
        }
        if (g.repathT <= 0 || !g.path.length) setGoal(g, w, DOOR_FRONT);
        stepAlong(g, w, cfg.chaseSpeed, dt, boxes);
        break;
      }
      if (g.loseT > GHOST.loseSightAfter) {
        g.sawSprint = false;
        if (g.lastKnown && setGoal(g, w, g.lastKnown)) setMode(g, 'investigate');
        else setMode(g, 'patrol');
        break;
      }
      if (g.canSee && dist <= cfg.attackRange) {
        faceTo(g, p.x, p.z, dt, 8);
        if (!tryAttack(g, w, emit)) g.waiting = true;
        break;
      }
      g.waiting = false;
      // 另一只鬼持有许可时，在外圈等待，不与它挤在一起。
      if (w.attack.holder !== null && w.attack.holder !== g.kind && g.canSee && dist < 3.2) {
        g.waiting = true;
        faceTo(g, p.x, p.z, dt, 5);
        break;
      }
      if (g.repathT <= 0 || !g.path.length) {
        let target: Vec2 | null = g.canSee ? { x: p.x, z: p.z } : g.lastKnown;
        if (target && g.kind === 'wraith' && g.sawSprint && g.canSee && dist > 3.2) {
          // 侧面靠近：目标点偏到玩家朝向的一侧。
          const nx = -(p.z - g.z) / dist, nz = (p.x - g.x) / dist;
          const off = GHOST.wraith.flankOffset * g.flankSide;
          const fx = p.x + nx * off, fz = p.z + nz * off;
          if (hasLineOfSight(fx, fz, p.x, p.z, w.doors)) target = { x: fx, z: fz };
          else g.flankSide = -g.flankSide;
        }
        if (!target || !setGoal(g, w, target, true)) {
          // 无有效路径：回最近可达巡逻点。
          if (g.path.length === 0) { g.loseT += 0.4; }
        }
      }
      stepAlong(g, w, cfg.chaseSpeed, dt, boxes);
      break;
    }
    case 'windup': {
      faceTo(g, p.x, p.z, dt, 3);
      if (g.t >= cfg.windup) {
        // 前摇结束才结算：离开距离、躲到阻挡物后都不掉血。
        const hit = dist <= GHOST.hitRange && hasLineOfSight(g.x, g.z, p.x, p.z, w.doors);
        emit({ kind: 'sfx', id: g.kind === 'grey' ? 'greyStrike' : 'wraithStrike', x: g.x, z: g.z });
        if (hit) {
          w.player.hp = Math.max(0, w.player.hp - cfg.damage);
          w.hurtFlash = 0.6;
          emit({ kind: 'hurt', text: `被${NAME[g.kind]}击中 −${cfg.damage}` });
          if (w.player.hp <= 0) w.failReason = `你倒在了${NAME[g.kind]}的扑击下`;
        } else {
          emit({ kind: 'subtitle', text: `【${NAME[g.kind]}】扑空了`, x: g.x, z: g.z });
        }
        releasePermit(w, g);
        setMode(g, 'recover');
      }
      break;
    }
    case 'recover': {
      if (g.t >= cfg.recover) setMode(g, g.canSee ? 'chase' : 'patrol');
      break;
    }
    case 'recoil': {
      // 背向玩家后撤，贴到墙边即止。灯还举着就一直退，放下后再退一小段。
      // 退到逼退距离外就停住，只要灯还照着它就不回头
      const held = repelled || (raised && dist < cfg.repelRange + GHOST.repelHoldMargin && hasLineOfSight(g.x, g.z, p.x, p.z, w.doors));
      if (held) {
        g.t = 0;
        g.lightT += dt;
        if (g.lightT >= GHOST.giveUpAfter) {
          g.cowed = GHOST.cowedSecs;
          g.canSee = false; g.lastKnown = null; g.sawSprint = false; g.path = [];
          setMode(g, 'patrol');
          emit({ kind: 'subtitle', text: `【${NAME[g.kind]}】受不了灯光，退走了`, x: g.x, z: g.z });
          break;
        }
      }
      const d = Math.max(dist, 1e-3);
      const sp = cfg.chaseSpeed * 0.8;
      if (dist < cfg.repelRange) moveCircle(g, ((g.x - p.x) / d) * sp * dt, ((g.z - p.z) / d) * sp * dt, GHOST.radius, boxes);
      faceTo(g, p.x, p.z, dt, 4);
      if (g.t >= GHOST.repelDuration) { g.path = []; setMode(g, g.canSee ? 'chase' : 'patrol'); }
      break;
    }
    case 'flee': {
      const done = stepAlong(g, w, cfg.chaseSpeed, dt, boxes);
      if (!inAnyZone(lit, g.x, g.z, 0.3) || done) { g.path = []; setMode(g, 'patrol'); }
      break;
    }
    case 'bang': {
      if (w.doors.gatehouse) { setMode(g, 'chase'); break; }
      // 加闩立刻禁止破门。
      if (w.bolted && g.bangOpens) { g.bangOpens = false; g.t = Math.max(g.t, GHOST.grey.doorBangSecs - 1.2); }
      if (Math.floor(g.t / 0.7) !== Math.floor((g.t - dt) / 0.7)) emit({ kind: 'sfx', id: 'bang', x: g.x, z: g.z });
      const need = g.bangOpens ? GHOST.grey.doorBangSecs : Math.min(GHOST.grey.doorBangSecs, 1.8);
      if (g.t >= need) {
        if (g.bangOpens) {
          w.doors.gatehouse = true;
          emit({ kind: 'sfx', id: 'doorBurst', x: g.x, z: g.z });
          emit({ kind: 'subtitle', text: '【灰影】撞开了门房门——撤出去，或者举灯', x: g.x, z: g.z });
          g.lastKnown = { x: p.x, z: p.z };
          g.loseT = 0;
          setMode(g, 'alert');
        } else {
          emit({ kind: 'subtitle', text: '【灰影】拍不开加闩的门，转身离去', x: g.x, z: g.z });
          g.lastKnown = null;
          g.sawSprint = false;
          g.path = [];
          setMode(g, 'patrol');
        }
      }
      break;
    }
  }
  keepOutOfLight(g, lit, boxes);
}

export function updateGhosts(w: World, dt: number, noises: Noise[], emit: (e: SimEvent) => void): void {
  const boxes = solidBoxes(w.doors);
  for (const g of w.ghosts) updateGhost(g, w, dt, boxes, noises, emit);
  // 许可持有者已不在前摇（被逼退或消散）时回收，避免死锁。
  if (w.attack.holder !== null) {
    const h = w.ghosts.find((g) => g.kind === w.attack.holder);
    if (!h || h.mode !== 'windup') { w.attack.holder = null; w.attack.lastRelease = w.nightT; }
  }
}

/** 门、栅门、壁灯或火盆状态变化时调用，让两鬼即时重算路线。 */
export function invalidatePaths(w: World): void {
  for (const g of w.ghosts) g.repathT = 0;
}

/** 晨曦：清空攻击许可与伤害判定，两鬼消散。 */
export function dissolveGhosts(w: World): void {
  w.attack.holder = null;
  for (const g of w.ghosts) if (g.mode !== 'gone' && g.mode !== 'dissolve') setMode(g, 'dissolve');
}

export function ghostThreatens(g: GhostState): boolean {
  return g.mode === 'chase' || g.mode === 'windup' || g.mode === 'alert' || g.mode === 'bang';
}
