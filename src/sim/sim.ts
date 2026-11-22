// 固定步长模拟：时段、角色、生存、交互与修复（PRD 第 4、9 节）。不依赖渲染，可在 Node 下测试。
import { BRAZIER, BRAZIER_NAME, BrazierId, GHOST, HEARTH, LANTERN, MEAL, PHASE, PLAYER, REPAIR_COST, REPAIR_NAME, RepairId, WALL_LAMP } from '../config';
import { circleBlocked, circleOverlapsBox, cylsAt, findOpening, hasLineOfSight, moveCircle, solidBoxes } from './collision';
import { dissolveGhosts, ghostThreatens, invalidatePaths, Noise, updateGhosts } from './ghosts';
import { Box, DOORS, DoorId, FloorId, INTERACTS, InteractDef, InteractId, NODES, PROPS, regionAt, regionAt3, SPAWN, supportY } from './level';
import { cloneWorld, newGhost, SimEvent, UiRequest, World } from './state';

export type Action =
  | { type: 'interact' } | { type: 'toggleLantern' } | { type: 'eat' }
  | { type: 'confirmRepair'; id: RepairId } | { type: 'boardClosed' };

export interface StepInput {
  /** 相对镜头朝向：forward 前进为正，strafe 向右为正。 */
  forward: number; strafe: number;
  sprint: boolean; raise: boolean;
  yaw: number; pitch: number;
  actions: Action[];
}

export interface Hooks {
  emit: (e: SimEvent) => void;
  /** 黄昏起点：先保存快照，再推进当帧交互。 */
  snapshot: (w: World) => void;
  ui: UiRequest;
}

export interface Target { id: InteractId; label: string; enabled: boolean; reason: string }

const fmt = (s: number): string => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function repairGap(w: World, id: RepairId): { wood: number; iron: number } {
  const c = REPAIR_COST[id];
  return { wood: Math.max(0, c.wood - w.inv.wood), iron: Math.max(0, c.iron - w.inv.iron) };
}

export function canRepairNow(w: World): boolean {
  return w.phase === 'day' || w.phase === 'dusk';
}

function repairTarget(w: World, id: RepairId, what: string): Omit<Target, 'id'> {
  const c = REPAIR_COST[id];
  if (!canRepairNow(w)) {
    return { label: what, enabled: false, reason: w.phase === 'tutorial' ? '先完成门房里的准备' : '入夜后无法再修复' };
  }
  return { label: `修复${REPAIR_NAME[id]}（${c.wood} 木、${c.iron} 铁）`, enabled: true, reason: '' };
}

const BRAZIER_OF: Partial<Record<InteractId, BrazierId>> = { brazierChapel: 'chapel', brazierSide: 'side' };

function brazierTarget(w: World, id: BrazierId): Omit<Target, 'id'> {
  const name = BRAZIER_NAME[id];
  if (w.braziers[id] > 0) return { label: `${name}燃烧中（余 ${fmt(w.braziers[id])}）`, enabled: false, reason: '燃尽后才能续油' };
  if (w.inv.oil < BRAZIER.oilCost) return { label: `${name}（未点）`, enabled: false, reason: '需要 1 份灯油' };
  return { label: `投入 1 份油点亮${name}（${BRAZIER.burnTime / 60} 分钟，亮着时鬼不敢靠近）`, enabled: true, reason: '' };
}

export function inWarmZone(w: World): boolean {
  return w.hearth.lit && w.player.floor === '1F' && regionAt(w.player.x, w.player.z) === 'gatehouse';
}

export function playerSafe(w: World): boolean {
  if (!inWarmZone(w)) return false;
  for (const g of w.ghosts) {
    if (g.mode === 'gone' || g.mode === 'dissolve') continue;
    if (ghostThreatens(g) || (g.floor === '1F' && regionAt(g.x, g.z) === 'gatehouse')) return false;
  }
  return true;
}

export function fastForwardStatus(w: World): { ok: boolean; reason: string } {
  if (w.phase !== 'night') return { ok: false, reason: '入夜后可在炉火旁等待晨曦' };
  if (!w.inv.hasClapper) return { ok: false, reason: '需要先带回钟舌' };
  if (!w.hearth.lit) return { ok: false, reason: '炉火已熄，添柴后才能等待' };
  const remain = PHASE.nightLength - w.clock;
  if (w.hearth.burn < remain) {
    return { ok: false, reason: `柴火撑不到天亮（还差 ${fmt(remain - w.hearth.burn)}），可在柴堆添 1 木` };
  }
  if (w.safeT < HEARTH.fastForwardSafeSecs) {
    return { ok: false, reason: `需在炉火旁安全停留 10 秒（已 ${Math.floor(w.safeT)} 秒）` };
  }
  return { ok: true, reason: '' };
}

/** 某交互点当前的提示、是否可用与不可用原因。返回 null 表示该点已无交互。 */
export function describe(w: World, id: InteractId): Omit<Target, 'id'> | null {
  const inv = w.inv;
  const night = w.phase === 'night';
  const ok = (label: string): Omit<Target, 'id'> => ({ label, enabled: true, reason: '' });
  const no = (label: string, reason: string): Omit<Target, 'id'> => ({ label, enabled: false, reason });
  switch (id) {
    case 'lantern': return inv.hasLantern ? null : ok('拾取提灯');
    case 'board': return ok('查看任务板');
    case 'refuel':
      if (!inv.hasLantern) return no('补油台', '先拾取提灯');
      if (inv.oil < 1) return no('补油台', '没有灯油');
      if (w.lantern.oil + LANTERN.oilPerUnit > LANTERN.maxOil) return no('补油台', '油仓将满，再补会浪费');
      return ok(`补充灯油（+${LANTERN.oilPerUnit} 秒，余 ${inv.oil} 份）`);
    case 'hearth': {
      if (w.phase === 'dusk') return ok('在炉火旁等到入夜（入夜后不能再修复）');
      if (!night) return no(w.hearth.lit ? '壁炉（炉火正旺）' : '壁炉（已熄）', w.phase === 'dawn' ? '天已经亮了' : w.phase === 'day' ? '黄昏时可在此等到入夜；想跳过白天去床铺休息' : '入夜后可在此等待晨曦');
      const ff = fastForwardStatus(w);
      const head = w.hearth.lit ? `壁炉（余 ${fmt(w.hearth.burn)}）` : '壁炉（已熄）';
      return ff.ok ? ok('在炉火旁等到晨曦') : no(head, ff.reason);
    }
    case 'woodpile':
      if (!night) return no('柴堆', w.phase === 'dawn' ? '天已经亮了' : '入夜后才需要添柴');
      if (inv.wood < 1) return no('柴堆', '没有多余的木料');
      return ok(`添 1 木（炉火 +${HEARTH.woodBonus / 60} 分钟）`);
    case 'pot':
      if (w.taken.food) return no('烹煮锅（已空）', '储备食材已用完');
      if (!w.hearth.lit) return no('烹煮锅', '炉火熄了，做不了热食');
      return ok('用储备食材做热食');
    case 'ghDoor':
      if (w.phase === 'tutorial') return no('门房门', '先拾取提灯并看过任务板');
      if (w.bolted) return no('门房门（已加闩）', '先解除门闩');
      return ok(w.doors.gatehouse ? '关上门房门' : '打开门房门');
    case 'bolt':
      if (!w.repairs.bolt) return repairTarget(w, 'bolt', '损坏的门闩');
      if (regionAt(w.player.x, w.player.z) !== 'gatehouse') return no('门闩', '只能从门房内操作');
      if (w.bolted) return ok('解除门闩');
      if (w.doors.gatehouse) return no('门闩', '门关上才可加闩');
      return ok('加闩');
    case 'bell':
      if (w.quest.rung) return null;
      if (w.quest.installed) return ok('敲响晨钟');
      if (!inv.hasClapper) return no('晨钟（缺钟舌）', '入夜后到礼拜堂祭台取出钟舌');
      if (w.phase !== 'dawn') return no('晨钟（缺钟舌）', '等到晨曦才能装配');
      return ok('装上钟舌');
    case 'shelf': return w.taken.shelf ? null : ok('取走货架物资（木 2、铁 2、油 1）');
    case 'crate': return w.taken.crate ? null : ok('取走货箱物资（木 2、铁 2、油 1）');
    case 'flask': return w.taken.flask ? null : ok('拾取油瓶（油 1）');
    case 'lamp':
      if (!w.repairs.lamp) return repairTarget(w, 'lamp', '缺件的壁灯');
      if (w.lampBurn > 0) return no(`壁灯燃烧中（余 ${fmt(w.lampBurn)}）`, '燃尽后才能续油');
      if (inv.oil < WALL_LAMP.oilCost) return no('壁灯（未点）', '需要 1 份灯油');
      return ok(`投入 1 份油点亮壁灯（${WALL_LAMP.burnTime / 60} 分钟）`);
    case 'gate':
      if (!w.repairs.gate) return repairTarget(w, 'gate', '卡死的栅门');
      return ok(w.doors.gate ? '关上栅门' : '打开栅门');
    case 'chapelFront': return ok(w.doors.chapelFront ? '关上礼拜堂正门' : '打开礼拜堂正门');
    case 'chest':
      if (w.taken.chest) return null;
      if (night || w.phase === 'dawn') return ok('打开祭台匣，取出钟舌');
      return no('祭台匣（上锁）', '入夜后才会开启');
    case 'cellar': return no('地下封门', '封死的石拱后有风声——日后再探');
    case 'cot':
      if (w.phase === 'day') return ok('休息到黄昏（白天没做完的事，黄昏还能做）');
      if (w.phase === 'tutorial') return no('床铺', '先拾取提灯并看过任务板');
      if (w.phase === 'dusk') return no('床铺', '天快黑了。准备好了就去壁炉旁等入夜');
      return no('床铺', night ? '夜里睡不得' : '天已经亮了');
    case 'brazierChapel': return brazierTarget(w, 'chapel');
    case 'brazierSide': return brazierTarget(w, 'side');
  }
}

/** 准星与近距离判定：2 m 内、可见，多个目标取准星最接近者（PRD 9.2）。 */
export function pickTarget(w: World): Target | null {
  const p = w.player;
  let best: InteractDef | null = null, bestInfo: Omit<Target, 'id'> | null = null, bestScore = Infinity;
  for (const it of INTERACTS) {
    if (it.floor !== p.floor) continue;
    const dx = it.x - p.x, dz = it.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > PLAYER.interactDist) continue;
    let ang = 0;
    if (d > 0.5) {
      ang = Math.acos(Math.max(-1, Math.min(1, (Math.sin(p.yaw) * dx + Math.cos(p.yaw) * dz) / d)));
      if (ang > PLAYER.interactHalfAngle) continue;
    }
    // 视线终点向玩家收回一小段，避免贴墙的点被自身所在的墙面挡住。
    const k = d > 0.25 ? (d - 0.2) / d : 0;
    if (!hasLineOfSight(p.x, p.y + 1.5, p.z, p.x + dx * k, it.y, p.z + dz * k, w.doors, it.ownDoor)) continue;
    const info = describe(w, it.id);
    if (!info) continue;
    const score = ang + d * 0.05;
    if (score < bestScore) { best = it; bestInfo = info; bestScore = score; }
  }
  return best && bestInfo ? { id: best.id, ...bestInfo } : null;
}

function toggleDoor(w: World, id: DoorId, h: Hooks, noises: Noise[]): void {
  const box = DOORS[id].box;
  if (w.doors[id]) {
    const blocked = circleOverlapsBox(w.player.x, w.player.z, PLAYER.radius, box)
      || w.ghosts.some((g) => g.mode !== 'gone' && circleOverlapsBox(g.x, g.z, GHOST.radius, box));
    if (blocked) { h.emit({ kind: 'toast', text: '门口有东西挡着，关不上' }); return; }
  }
  w.doors[id] = !w.doors[id];
  h.emit({ kind: 'sfx', id: id === 'gate' ? 'gate' : 'door' });
  const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
  if (w.phase === 'night') {
    const nf = id === 'gate' ? '2F' as const : '1F' as const;
    if (id === 'gate' && w.doors[id]) noises.push({ x: cx, z: cz, floor: nf, r: GHOST.noise.gate, kind: 'gate' });
    else noises.push({ x: cx, z: cz, floor: nf, r: GHOST.noise.door, kind: 'door' });
  }
  invalidatePaths(w);
}

function take(w: World, wood: number, iron: number, oil: number, h: Hooks): void {
  w.inv.wood += wood; w.inv.iron += iron; w.inv.oil += oil;
  const parts = [wood && `木料 +${wood}`, iron && `铁件 +${iron}`, oil && `灯油 +${oil}`].filter(Boolean);
  h.emit({ kind: 'sfx', id: 'pickup' });
  h.emit({ kind: 'toast', text: `获得 ${parts.join('、')}` });
}

function interact(w: World, h: Hooks, noises: Noise[]): void {
  const t = pickTarget(w);
  if (!t) return;
  if (!t.enabled) { h.emit({ kind: 'toast', text: `${t.label}：${t.reason}` }); h.emit({ kind: 'sfx', id: 'deny' }); return; }
  const inv = w.inv;
  switch (t.id) {
    case 'lantern':
      inv.hasLantern = true; w.lantern.on = true;
      h.emit({ kind: 'sfx', id: 'pickup' }); h.emit({ kind: 'sfx', id: 'light' });
      h.emit({ kind: 'toast', text: `拾起提灯（油量 ${fmt(LANTERN.startOil)}）。F 开关，按住右键举灯` });
      break;
    case 'board': h.ui.board = true; break;
    case 'refuel':
      inv.oil -= 1; w.lantern.oil += LANTERN.oilPerUnit;
      h.emit({ kind: 'sfx', id: 'pour' });
      h.emit({ kind: 'toast', text: `提灯油量 ${fmt(w.lantern.oil)}` });
      break;
    case 'hearth':
      if (w.phase === 'dusk') {
        w.total += PHASE.duskLength - w.clock;
        h.emit({ kind: 'sfx', id: 'ring' });
        enterNight(w, h);
      } else fastForward(w, h);
      break;
    case 'woodpile':
      inv.wood -= 1; w.hearth.burn += HEARTH.woodBonus; w.hearth.lit = true;
      h.emit({ kind: 'sfx', id: 'repair' });
      h.emit({ kind: 'toast', text: `添了柴，炉火可维持 ${fmt(w.hearth.burn)}` });
      break;
    case 'pot':
      w.taken.food = true; inv.meal += 1;
      h.emit({ kind: 'sfx', id: 'pickup' });
      h.emit({ kind: 'toast', text: '做好一份热食（H 或工具栏食用）' });
      break;
    case 'ghDoor': toggleDoor(w, 'gatehouse', h, noises); break;
    case 'bolt':
      if (!w.repairs.bolt) { h.ui.repair = 'bolt'; break; }
      w.bolted = !w.bolted;
      h.emit({ kind: 'sfx', id: 'bolt' });
      h.emit({ kind: 'toast', text: w.bolted ? '门已加闩' : '门闩已解除' });
      invalidatePaths(w);
      break;
    case 'bell':
      if (!w.quest.installed) {
        w.quest.installed = true; inv.hasClapper = false;
        h.emit({ kind: 'sfx', id: 'bolt' });
        h.emit({ kind: 'toast', text: '钟舌装回了晨钟。再交互一次敲响它' });
        h.emit({ kind: 'quest' });
      } else {
        w.quest.rung = true; w.phase = 'ended';
        h.emit({ kind: 'sfx', id: 'bell' });
        h.emit({ kind: 'phase', id: 'ended' });
      }
      break;
    case 'shelf': w.taken.shelf = true; take(w, 2, 2, 1, h); break;
    case 'crate': w.taken.crate = true; take(w, 2, 2, 1, h); break;
    case 'flask': w.taken.flask = true; take(w, 0, 0, 1, h); break;
    case 'lamp':
      if (!w.repairs.lamp) { h.ui.repair = 'lamp'; break; }
      inv.oil -= WALL_LAMP.oilCost; w.lampBurn = WALL_LAMP.burnTime;
      h.emit({ kind: 'sfx', id: 'pour' }); h.emit({ kind: 'sfx', id: 'light' });
      h.emit({ kind: 'toast', text: `壁灯点亮，可燃 ${WALL_LAMP.burnTime / 60} 分钟` });
      invalidatePaths(w);
      break;
    case 'gate':
      if (!w.repairs.gate) { h.ui.repair = 'gate'; break; }
      toggleDoor(w, 'gate', h, noises);
      break;
    case 'chapelFront': toggleDoor(w, 'chapelFront', h, noises); break;
    case 'chest':
      w.taken.chest = true; inv.hasClapper = true;
      w.quest.clapperAt = w.phase === 'dawn' ? 'dawn' : 'night';
      h.emit({ kind: 'sfx', id: 'chest' });
      h.emit({ kind: 'toast', text: w.phase === 'dawn' ? '取得钟舌。回门房外装上晨钟' : '取得钟舌——匣盖的响声传遍了礼拜堂。带它回门房，等到晨曦' });
      h.emit({ kind: 'quest' });
      if (w.phase === 'night') noises.push({ x: w.player.x, z: w.player.z, y: w.player.y, floor: w.player.floor, r: GHOST.noise.chest, kind: 'chest' });
      break;
    case 'cellar': break;
    case 'cot':
      w.total += PHASE.dayLength - w.clock;
      w.duskWarned = true;
      enterDusk(w, h);
      break;
    case 'brazierChapel': case 'brazierSide': {
      const b = BRAZIER_OF[t.id]!;
      inv.oil -= BRAZIER.oilCost; w.braziers[b] = BRAZIER.burnTime;
      h.emit({ kind: 'sfx', id: 'pour' }); h.emit({ kind: 'sfx', id: 'light' });
      h.emit({ kind: 'toast', text: `${BRAZIER_NAME[b]}点亮，可燃 ${BRAZIER.burnTime / 60} 分钟。亮光里鬼不敢进来` });
      invalidatePaths(w);
      break;
    }
  }
}

/** 修复确认：完成时一次性扣料并写入状态，重复确认不再扣料。 */
export function confirmRepair(w: World, id: RepairId, h: Hooks): boolean {
  if (w.repairs[id]) { h.emit({ kind: 'toast', text: `${REPAIR_NAME[id]}已经修好了` }); return false; }
  if (!canRepairNow(w)) { h.emit({ kind: 'toast', text: '入夜后无法再修复' }); return false; }
  const gap = repairGap(w, id);
  if (gap.wood > 0 || gap.iron > 0) {
    const parts = [gap.wood && `木料缺 ${gap.wood}`, gap.iron && `铁件缺 ${gap.iron}`].filter(Boolean);
    h.emit({ kind: 'toast', text: `材料不足：${parts.join('、')}` });
    h.emit({ kind: 'sfx', id: 'deny' });
    return false;
  }
  const c = REPAIR_COST[id];
  w.inv.wood -= c.wood; w.inv.iron -= c.iron;
  w.repairs[id] = true;
  h.emit({ kind: 'sfx', id: 'repair' });
  h.emit({ kind: 'toast', text: `修好了${REPAIR_NAME[id]}` });
  invalidatePaths(w);
  return true;
}

function burnLantern(w: World, secs: number, h: Hooks): void {
  if (!w.lantern.on) return;
  w.lantern.oil = Math.max(0, w.lantern.oil - secs);
  if (w.lantern.oil <= 0) {
    w.lantern.on = false; w.lantern.raised = false;
    h.emit({ kind: 'toast', text: '灯油耗尽，提灯熄灭' });
    h.emit({ kind: 'sfx', id: 'snuff' });
  }
}

function enterDawn(w: World, h: Hooks): void {
  w.phase = 'dawn'; w.clock = 0;
  dissolveGhosts(w);
  h.emit({ kind: 'phase', id: 'dawn' });
  h.emit({ kind: 'toast', text: w.inv.hasClapper ? '晨曦到了。到门房外装上钟舌，敲响晨钟' : '晨曦到了，两只鬼消散。去礼拜堂祭台取钟舌' });
}

/** 壁炉快进：先结算余下的夜，同步推进所有燃烧计时，再进入晨曦。 */
function fastForward(w: World, h: Hooks): void {
  const st = fastForwardStatus(w);
  if (!st.ok) { h.emit({ kind: 'toast', text: st.reason }); return; }
  const remain = PHASE.nightLength - w.clock;
  w.hearth.burn -= remain;
  w.lampBurn = Math.max(0, w.lampBurn - remain);
  w.braziers.chapel = Math.max(0, w.braziers.chapel - remain);
  w.braziers.side = Math.max(0, w.braziers.side - remain);
  burnLantern(w, remain, h);
  w.total += remain; w.nightT += remain;
  w.player.cold = 0;
  h.emit({ kind: 'toast', text: `在炉火旁守过了余下的 ${fmt(remain)}` });
  enterDawn(w, h);
}

/** 黄昏起点：先保存快照（PRD 9.5）。 */
function enterDusk(w: World, h: Hooks): void {
  w.phase = 'dusk'; w.clock = 0;
  h.snapshot(w);
  h.emit({ kind: 'phase', id: 'dusk' });
  h.emit({ kind: 'toast', text: `黄昏（已自动存档）。补油、做热食，${fmt(PHASE.duskLength)} 后入夜；准备好了可在壁炉旁直接等到入夜` });
}

function enterNight(w: World, h: Hooks): void {
  w.phase = 'night'; w.clock = 0; w.nightT = 0; w.safeT = 0;
  w.hearth = { lit: true, burn: HEARTH.nightBurn };
  w.player.cold = 0;
  w.ghosts = [newGhost('grey'), newGhost('wraith')];
  w.attack = { holder: null, lastRelease: -100, last: null };
  h.emit({ kind: 'phase', id: 'night' });
  h.emit({ kind: 'toast', text: '入夜了。礼拜堂的祭台匣已开启——取回钟舌' });
}

function advancePhase(w: World, rawDt: number, h: Hooks, dayClockScale: number): void {
  if (w.phase === 'tutorial') {
    if (w.inv.hasLantern && w.quest.boardRead) {
      w.phase = 'day'; w.clock = 0;
      h.emit({ kind: 'phase', id: 'day' });
      h.emit({ kind: 'toast', text: '白天开始。搜集木料和铁件，三处修复最多修两处。忙完可回床铺休息到黄昏' });
    }
    return;
  }
  if (w.phase !== 'day' && w.phase !== 'dusk' && w.phase !== 'night') return;
  const dt = w.phase === 'night' ? rawDt : rawDt * dayClockScale;
  const before = w.clock;
  w.clock += dt; w.total += dt;
  if (w.phase === 'day') {
    if (!w.duskWarned && w.clock >= PHASE.duskWarnAt) {
      w.duskWarned = true;
      h.emit({ kind: 'sfx', id: 'duskWarn' });
      h.emit({ kind: 'toast', text: `日头偏西：再过 ${fmt(PHASE.dayLength - PHASE.duskWarnAt)} 黄昏，入夜后不能再修复` });
    }
    if (w.clock >= PHASE.dayLength) enterDusk(w, h);
  } else if (w.phase === 'dusk') {
    const ringAt = PHASE.duskLength - 6;
    if (before < ringAt && w.clock >= ringAt) {
      h.emit({ kind: 'sfx', id: 'ring' });
      h.emit({ kind: 'subtitle', text: '【钟架】铁环一声闷响——夜要来了' });
    }
    if (w.clock >= PHASE.duskLength) enterNight(w, h);
  } else if (w.clock >= PHASE.nightLength) {
    enterDawn(w, h);
  }
}

/**
 * 门洞辅助：越肩镜头下角色偏在准星一侧，对着门洞走时常会正顶在门框旁的墙上。
 * 这一步几乎被墙挡死时，沿墙把角色带向 1.2 m 内最近的门洞。陈设、井台与关着的门不触发。
 */
function doorAssist(p: { x: number; z: number; y?: number }, x0: number, z0: number, dx: number, dz: number, boxes: Box[]): void {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  // 碰撞把角色推回的量：方向即墙面法线，大小接近步长说明几乎没走动
  const cx = p.x - (x0 + dx), cz = p.z - (z0 + dz);
  const push = Math.hypot(cx, cz);
  if (push < len * 0.8) return;
  const tx0 = x0 + dx, tz0 = z0 + dz;
  for (const b of PROPS) if (circleOverlapsBox(tx0, tz0, PLAYER.radius, b)) return;
  for (const c of cylsAt(p.y ?? 0)) if (Math.hypot(tx0 - c.x, tz0 - c.z) < c.r + PLAYER.radius) return;
  const nx = cx / push, nz = cz / push;
  const tx = nz, tz = -nx;
  // 明显斜着走时只往滑动的那一侧找，不把角色往回拉
  const along = (dx * tx + dz * tz) / len;
  const side = findOpening(p, nx, nz, PLAYER.radius, boxes, Math.abs(along) > 0.25 ? Math.sign(along) : 0, 1.2, 0.9, cylsAt(p.y ?? 0));
  if (!side) return;
  // 沿墙的合速度不超过当前移动速度
  const slid = ((p.x - x0) * tx + (p.z - z0) * tz) * side;
  const add = Math.max(0, len - slid);
  moveCircle(p, tx * side * add, tz * side * add, PLAYER.radius, boxes, cylsAt(p.y ?? 0));
}

/** 推进一个固定步长。顺序：时段转换 → 光源与门 → 角色 → 敌人（PRD 9.4）。 */
export function step(w: World, input: StepInput, dt: number, h: Hooks, dayClockScale = 1): void {
  if (w.phase === 'ended' || w.phase === 'failed') return;
  const noises: Noise[] = [];
  w.played += dt;
  advancePhase(w, dt, h, dayClockScale);
  if ((w.phase as string) === 'ended') return;
  w.hurtFlash = Math.max(0, w.hurtFlash - dt);

  // 光源
  const night = w.phase === 'night';
  if (w.lampBurn > 0) {
    w.lampBurn = Math.max(0, w.lampBurn - dt);
    if (w.lampBurn <= 0) {
      h.emit({ kind: 'sfx', id: 'snuff' });
      h.emit({ kind: 'toast', text: '庭院壁灯燃尽了' });
      invalidatePaths(w);
    }
  }
  for (const id of ['chapel', 'side'] as BrazierId[]) {
    if (w.braziers[id] <= 0) continue;
    w.braziers[id] = Math.max(0, w.braziers[id] - dt);
    if (w.braziers[id] <= 0) {
      h.emit({ kind: 'sfx', id: 'snuff' });
      h.emit({ kind: 'toast', text: `${BRAZIER_NAME[id]}燃尽了` });
      invalidatePaths(w);
    }
  }
  if (night && w.hearth.lit) {
    w.hearth.burn -= dt;
    if (w.hearth.burn <= 0) {
      w.hearth.burn = 0; w.hearth.lit = false;
      h.emit({ kind: 'sfx', id: 'snuff' });
      h.emit({ kind: 'toast', text: '门房炉火熄了，这里不再回暖' });
    }
  }

  // 角色朝向与一次性动作（门的开合在敌人更新之前生效）
  const p = w.player;
  p.yaw = input.yaw; p.pitch = input.pitch;
  for (const a of input.actions) {
    if (a.type === 'interact') interact(w, h, noises);
    else if (a.type === 'confirmRepair') confirmRepair(w, a.id, h);
    else if (a.type === 'boardClosed') w.quest.boardRead = true;
    else if (a.type === 'toggleLantern') {
      if (!w.inv.hasLantern) continue;
      if (!w.lantern.on && w.lantern.oil <= 0) { h.emit({ kind: 'toast', text: '灯油耗尽，回门房补油' }); continue; }
      w.lantern.on = !w.lantern.on;
      h.emit({ kind: 'sfx', id: w.lantern.on ? 'light' : 'snuff' });
    } else if (a.type === 'eat') {
      if (w.inv.meal < 1) { h.emit({ kind: 'toast', text: '没有热食' }); continue; }
      w.inv.meal -= 1;
      p.hp = Math.min(PLAYER.maxHp, p.hp + MEAL.heal);
      p.cold *= MEAL.coldFactor;
      h.emit({ kind: 'sfx', id: 'eat' });
      h.emit({ kind: 'toast', text: `吃下热食：生命 +${MEAL.heal}，寒意减半` });
    }
    if ((w.phase as string) === 'ended') return;
  }

  // 提灯：举灯在有油时可直接点亮，零油立即熄灭并取消举灯。每次举起先耗一小口油。
  const lan = w.lantern;
  if (w.inv.hasLantern && input.raise && lan.oil > 0) {
    if (!lan.on) { lan.on = true; h.emit({ kind: 'sfx', id: 'light' }); }
    if (!lan.raised) lan.oil = Math.max(0.01, lan.oil - LANTERN.raiseStartCost);
    lan.raised = true;
  } else lan.raised = false;
  burnLantern(w, dt * (lan.raised ? LANTERN.raiseMultiplier : 1), h);

  // 位移：先算角色移动与碰撞，镜头随后跟随。
  const mag = Math.hypot(input.forward, input.strafe);
  p.moving = mag > 0.01;
  p.sprinting = p.moving && input.sprint;
  if (p.moving) {
    const f = input.forward / Math.max(1, mag), s = input.strafe / Math.max(1, mag);
    const sp = p.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const dx = (sin * f + cos * s) * sp * dt, dz = (cos * f - sin * s) * sp * dt;
    const boxes = solidBoxes(w.doors, p.y);
    const cyls = cylsAt(p.y);
    const x0 = p.x, z0 = p.z;
    moveCircle(p, dx, dz, PLAYER.radius, boxes, cyls);
    doorAssist(p, x0, z0, dx, dz, boxes);
    const sup = supportY(p.x, p.z, p.y);
    if (sup) { p.y = sup.y; p.floor = sup.floor; }
    if (p.sprinting && night) noises.push({ x: p.x, z: p.z, y: p.y, floor: p.floor, r: GHOST.noise.sprint, kind: 'sprint' });
  }

  // 寒冷：夜间门房以外或炉火已熄时累积，炉火旁回暖。
  if (night) {
    w.nightT += dt;
    if (inWarmZone(w)) p.cold = Math.max(0, p.cold - HEARTH.warmRate * dt);
    else {
      const open2F = p.floor === '2F' && (regionAt3(p.x, p.z, '2F') === 'walk' || regionAt3(p.x, p.z, '2F') === 'bridge');
      p.cold = Math.min(HEARTH.coldThreshold, p.cold + HEARTH.coldRate * (open2F ? HEARTH.walkColdFactor : 1) * dt);
      if (p.cold >= HEARTH.coldThreshold) {
        p.hp = Math.max(0, p.hp - HEARTH.coldDamagePerSec * dt);
        if (p.hp <= 0) w.failReason = '你冻倒在了夜里';
      }
    }
    w.safeT = playerSafe(w) ? w.safeT + dt : 0;
    if (w.inv.hasClapper && p.floor === '1F' && regionAt(p.x, p.z) === 'gatehouse' && !w.quest.returnedBeforeDawn) {
      w.quest.returnedBeforeDawn = true;
      h.emit({ kind: 'toast', text: '钟舌带回了门房。守住炉火，等到晨曦' });
      h.emit({ kind: 'quest' });
    }
  } else if (p.cold > 0) p.cold = Math.max(0, p.cold - HEARTH.warmRate * dt);

  // 敌人：晨曦后只播放消散，不再有追踪与伤害判定。
  if (w.ghosts.length) updateGhosts(w, dt, night ? noises : [], h.emit);

  if (p.hp <= 0) {
    w.phase = 'failed';
    h.emit({ kind: 'phase', id: 'failed' });
  }
}

/**
 * 由快照重建运行状态：先恢复环境，再校验角色位置。位置非法时回到最近的可走点（PRD 9.5）。
 * 返回的是副本，重复加载不会改动快照本身。
 */
export function restoreWorld(snapshot: World): World {
  const w = cloneWorld(snapshot);
  const p = w.player;
  const bad = !Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.y) || Math.abs(p.x) > 40 || Math.abs(p.z) > 40
    || circleBlocked(p.x, p.z, PLAYER.radius, solidBoxes(w.doors, p.y), cylsAt(p.y));
  if (bad) {
    let best = { x: SPAWN.x, z: SPAWN.z, y: 0, floor: '1F' as FloorId }, bestD = Infinity;
    if (Number.isFinite(p.x) && Number.isFinite(p.z)) {
      // 优先同层最近安全节点（PRD 9.6）
      for (const n of NODES) {
        const same = n.floor === p.floor ? 0 : 1000;
        const d = same + (n.x - p.x) ** 2 + (n.z - p.z) ** 2;
        if (d < bestD) { bestD = d; best = { x: n.x, z: n.z, y: n.y, floor: n.floor }; }
      }
    }
    p.x = best.x; p.z = best.z; p.y = best.y; p.floor = best.floor;
  }
  const sup = supportY(p.x, p.z, p.y);
  if (sup) { p.y = sup.y; p.floor = sup.floor; }
  if (!Number.isFinite(p.yaw)) p.yaw = 0;
  if (!Number.isFinite(p.pitch)) p.pitch = 0;
  p.hp = Math.max(1, Math.min(PLAYER.maxHp, Number.isFinite(p.hp) ? p.hp : PLAYER.maxHp));
  w.hurtFlash = 0;
  return w;
}
