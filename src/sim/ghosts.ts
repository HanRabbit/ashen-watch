// 双鬼：感知（3D 视线/距离）→ 决策 → 寻路（节点图，跨层经楼梯）→ 位移（supportY 连续高度）。
// 两鬼共用一个攻击许可（PRD 第 4 节、9.4、9.6）。
import { GHOST, LightZone } from '../config';
import { cylsAt, hasLineOfSight, moveCircle, solidBoxes } from './collision';
import { PATROL, regionAt, supportY } from './level';
import { findPath, inAnyZone, inZone, litZones, NavCtx, nearestNode, node, pathLength } from './nav';
import { GhostMode, GhostState, SimEvent, Vec2, World } from './state';

export interface Noise { x: number; z: number; y?: number; floor?: 'B1' | '1F' | '2F'; r: number; kind: 'sprint' | 'gate' | 'chest' | 'door' }

const DOOR_FRONT: Vec2 = { x: 0, z: 1.25 };
const NAME = { grey: '灰影', wraith: '黑影' } as const;
const EYE = 1.5;

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
  if (inAnyZone(litZones(w), p.x, p.z, 0, p.floor)) return true;
  return w.hearth.lit && p.floor === '1F' && regionAt(p.x, p.z) === 'gatehouse';
}

function dist3(g: GhostState, p: World['player']): number {
  return Math.hypot(p.x - g.x, p.z - g.z, p.y - g.y);
}
function los(w: World, g: GhostState): boolean {
  return hasLineOfSight(g.x, g.y + EYE, g.z, w.player.x, w.player.y + EYE, w.player.z, w.doors);
}

/** 感知：距离 → 视锥 → 3D 视线（楼板阻断）。 */
function sense(g: GhostState, w: World): void {
  const cfg = GHOST[g.kind];
  const p = w.player;
  const dx = p.x - g.x, dz = p.z - g.z;
  const d2 = dx * dx + dz * dz + (p.y - g.y) ** 2;
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
  if (see) see = los(w, g);
  g.canSee = see;
  if (see) {
    g.lastKnown = { x: p.x, z: p.z };
    g.loseT = 0;
    if (p.sprinting) g.sawSprint = true;
  }
}

function setGoal(g: GhostState, w: World, goal: { x: number; z: number; y?: number; floor?: 'B1' | '1F' | '2F' }, exact = true): boolean {
  const path = findPath({ x: g.x, z: g.z, y: g.y, floor: g.floor }, goal, ctxOf(w), exact);
  g.goal = { x: goal.x, z: goal.z };
  g.path = path ?? [];
  g.repathT = 0.4;
  return path !== null;
}

/** 沿路径走一步并更新高度/楼层。返回 true 表示到达终点。 */
function stepAlong(g: GhostState, w: World, speed: number, dt: number): boolean {
  const reach = Math.max(0.3, speed * dt);
  while (g.path.length && Math.hypot(g.path[0].x - g.x, g.path[0].z - g.z) < reach) g.path.shift();
  if (!g.path.length) return true;
  const t = g.path[0];
  const d = Math.hypot(t.x - g.x, t.z - g.z) || 1e-4;
  const bx = g.x, bz = g.z;
  const boxes = solidBoxes(w.doors, g.y);
  moveCircle(g, ((t.x - g.x) / d) * speed * dt, ((t.z - g.z) / d) * speed * dt, GHOST.radius, boxes, cylsAt(g.y));
  const sup = supportY(g.x, g.z, g.y);
  if (sup) { g.y = sup.y; g.floor = sup.floor; }
  faceTo(g, t.x, t.z, dt);
  const moved = Math.hypot(g.x - bx, g.z - bz);
  g.stuckT = moved < speed * dt * 0.25 ? g.stuckT + dt : 0;
  if (g.stuckT > 2) { g.stuckT = 0; g.path = []; g.repathT = 0; }
  return false;
}

function keepOutOfLight(g: GhostState, lit: LightZone[], w: World): void {
  if (g.mode === 'flee') return;
  for (const zn of lit) {
    if (!inZone(zn, g.x, g.z, 0, g.floor)) continue;
    const dx = g.x - zn.x, dz = g.z - zn.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) continue;
    const nx = zn.x + (dx / d) * zn.r, nz = zn.z + (dz / d) * zn.r;
    if (nx < zn.x0 + GHOST.radius || nx > zn.x1 - GHOST.radius || nz < zn.z0 + GHOST.radius || nz > zn.z1 - GHOST.radius) continue;
    g.x = nx; g.z = nz;
    moveCircle(g, 0, 0, GHOST.radius, solidBoxes(w.doors, g.y), cylsAt(g.y));
  }
}

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
    if (setGoal(g, w, { x: n.x, z: n.z, y: n.y, floor: n.floor }) && g.path.length) return true;
    g.patrolIdx = (g.patrolIdx + 1) % list.length;
  }
  g.path = [];
  return false;
}

/** 噪声可达：同层欧氏距离；跨层只经开放楼梯、按导航路径长度衰减。 */
function noiseReach(w: World, g: GhostState, n: Noise, r: number): boolean {
  const nf = n.floor ?? '1F';
  if (nf === g.floor) return (n.x - g.x) ** 2 + (n.z - g.z) ** 2 <= r * r;
  const path = findPath({ x: n.x, z: n.z, y: n.y, floor: nf }, { x: g.x, z: g.z, y: g.y, floor: g.floor }, ctxOf(w), false);
  if (!path) return false;
  return pathLength(path, { x: n.x, z: n.z, y: n.y }) <= r;
}

function hear(g: GhostState, w: World, noises: Noise[], emit: (e: SimEvent) => void): void {
  if (g.mode !== 'patrol' && g.mode !== 'investigate') return;
  for (const n of noises) {
    const r = g.kind === 'wraith' && n.kind !== 'chest' ? n.r * 0.5 : n.r;
    if (!noiseReach(w, g, n, r)) continue;
    if (!setGoal(g, w, { x: n.x, z: n.z, y: n.y, floor: n.floor }) && !g.path.length) continue;
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

function updateGhost(g: GhostState, w: World, dt: number, noises: Noise[], emit: (e: SimEvent) => void): void {
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
  const dist = dist3(g, p);
  const lit = litZones(w);

  if (g.mode !== 'flee' && inAnyZone(lit, g.x, g.z, -0.05, g.floor)) {
    releasePermit(w, g);
    const dark = nearestNode(g.x, g.z, g.floor, g.y, ctxOf(w)) ?? nearestNode(g.x, g.z, g.floor, g.y, ctxOf(w), false);
    g.path = dark ? [{ x: dark.x, z: dark.z, y: dark.y, floor: dark.floor }] : [];
    setMode(g, 'flee');
    emit({ kind: 'subtitle', text: `【${NAME[g.kind]}】被灯光逼出了亮处`, x: g.x, z: g.z });
  }

  const raised = w.lantern.raised && w.lantern.on && w.lantern.oil > 0;
  const repelled = raised && dist < cfg.repelRange && los(w, g);
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
      if (stepAlong(g, w, cfg.patrolSpeed, dt)) {
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
      const arrived = stepAlong(g, w, cfg.patrolSpeed * 1.35, dt);
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
      const inGatehouse = p.floor === '1F' && regionAt(p.x, p.z) === 'gatehouse';
      const lk = g.lastKnown;
      const lkInGatehouse = !!lk && lk.z < 0.6 && Math.abs(lk.x) < 3.5;
      const lkNearDoor = !!lk && Math.hypot(lk.x - DOOR_FRONT.x, lk.z - DOOR_FRONT.z) < 6;
      if (g.kind === 'grey' && g.floor === '1F' && !w.doors.gatehouse && (lkInGatehouse || (inGatehouse && lkNearDoor)) && g.z > 0.5) {
        g.loseT = 0;
        if (Math.hypot(g.x - DOOR_FRONT.x, g.z - DOOR_FRONT.z) < 0.7) {
          g.bangOpens = !w.bolted;
          setMode(g, 'bang');
          emit({ kind: 'sfx', id: 'bang', x: g.x, z: g.z });
          emit({ kind: 'subtitle', text: '【灰影】开始拍门——加闩，或者准备举灯', x: g.x, z: g.z });
          break;
        }
        if (g.repathT <= 0 || !g.path.length) setGoal(g, w, DOOR_FRONT);
        stepAlong(g, w, cfg.chaseSpeed, dt);
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
      if (w.attack.holder !== null && w.attack.holder !== g.kind && g.canSee && dist < 3.2) {
        g.waiting = true;
        faceTo(g, p.x, p.z, dt, 5);
        break;
      }
      if (g.repathT <= 0 || !g.path.length) {
        let target: { x: number; z: number; y?: number; floor?: 'B1' | '1F' | '2F' } | null = g.canSee ? { x: p.x, z: p.z, y: p.y, floor: p.floor } : g.lastKnown;
        if (target && g.kind === 'wraith' && g.sawSprint && g.canSee && dist > 3.2) {
          const nx = -(p.z - g.z) / dist, nz = (p.x - g.x) / dist;
          const off = GHOST.wraith.flankOffset * g.flankSide;
          const fx = p.x + nx * off, fz = p.z + nz * off;
          if (hasLineOfSight(fx, g.y + EYE, fz, p.x, p.y + EYE, p.z, w.doors)) target = { x: fx, z: fz, y: p.y, floor: p.floor };
          else g.flankSide = -g.flankSide;
        }
        if (!target || !setGoal(g, w, target, true)) {
          if (g.path.length === 0) { g.loseT += 0.4; }
        }
      }
      stepAlong(g, w, cfg.chaseSpeed, dt);
      break;
    }
    case 'windup': {
      faceTo(g, p.x, p.z, dt, 3);
      if (g.t >= cfg.windup) {
        const hit = dist <= GHOST.hitRange && los(w, g);
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
      const held = repelled || (raised && dist < cfg.repelRange + GHOST.repelHoldMargin && los(w, g));
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
      if (dist < cfg.repelRange) {
        moveCircle(g, ((g.x - p.x) / d) * sp * dt, ((g.z - p.z) / d) * sp * dt, GHOST.radius, solidBoxes(w.doors, g.y), cylsAt(g.y));
        const sup = supportY(g.x, g.z, g.y);
        if (sup) { g.y = sup.y; g.floor = sup.floor; }
      }
      faceTo(g, p.x, p.z, dt, 4);
      if (g.t >= GHOST.repelDuration) { g.path = []; setMode(g, g.canSee ? 'chase' : 'patrol'); }
      break;
    }
    case 'flee': {
      const done = stepAlong(g, w, cfg.chaseSpeed, dt);
      if (!inAnyZone(lit, g.x, g.z, 0.3, g.floor) || done) { g.path = []; setMode(g, 'patrol'); }
      break;
    }
    case 'bang': {
      if (w.doors.gatehouse) { setMode(g, 'chase'); break; }
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
  keepOutOfLight(g, lit, w);
}

export function updateGhosts(w: World, dt: number, noises: Noise[], emit: (e: SimEvent) => void): void {
  for (const g of w.ghosts) updateGhost(g, w, dt, noises, emit);
  if (w.attack.holder !== null) {
    const h = w.ghosts.find((g) => g.kind === w.attack.holder);
    if (!h || h.mode !== 'windup') { w.attack.holder = null; w.attack.lastRelease = w.nightT; }
  }
}

export function invalidatePaths(w: World): void {
  for (const g of w.ghosts) g.repathT = 0;
}

export function dissolveGhosts(w: World): void {
  w.attack.holder = null;
  for (const g of w.ghosts) if (g.mode !== 'gone' && g.mode !== 'dissolve') setMode(g, 'dissolve');
}

export function ghostThreatens(g: GhostState): boolean {
  return g.mode === 'chase' || g.mode === 'windup' || g.mode === 'alert' || g.mode === 'bang';
}