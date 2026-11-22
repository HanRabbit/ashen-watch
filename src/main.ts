// 游戏控制器：把输入、固定步长模拟、视图、界面、声音和存档接在一起。
import * as THREE from 'three';
import { FIXED_DT, GHOST, pickPreset, RepairId } from './config';
import { GameAudio } from './audio';
import { Input } from './input';
import { RenderPose, SceneView } from './render/view';
import { loadSettings, saveSettings } from './settings';
import { ghostThreatens } from './sim/ghosts';
import { INTERACTS, regionAt } from './sim/level';
import { findPath } from './sim/nav';
import { SaveStore, StorageLike } from './sim/save';
import { Session } from './sim/session';
import { Action, confirmRepair, pickTarget, step } from './sim/sim';
import { SimEvent, World } from './sim/state';
import { Hud } from './ui/hud';
import { ScreenId, Screens } from './ui/screens';

const preset = pickPreset(location.search);
const params = new URLSearchParams(location.search);
const settings = loadSettings();
const canvas = document.getElementById('game') as HTMLCanvasElement;

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const store = new SaveStore(browserStorage());
const loaded = store.load();
const session = new Session(store);
session.retries = loaded.env?.retries ?? 0;
let storageNote = loaded.status === 'ok' || loaded.status === 'none' ? '' : loaded.message;

const view = new SceneView(canvas);
const input = new Input(canvas, settings);
const audio = new GameAudio();
const hud = new Hud(settings);

const TITLE_CAM = { pos: [-7.5, 5.2, 2.5] as [number, number, number], look: [11, 4.2, 22] as [number, number, number] };
let mode: 'title' | 'playing' = 'title';
let lockFailed = false;
let pending: Action[] = [];
let endTimer = 0;
let stepDist = 0;
let threat = 0;
let time = 0;
let acc = 0;
const frames: number[] = [];
const slowFrames: { ms: number; phase: string; x: number; z: number }[] = [];

// 渲染插值：模拟固定每秒 60 步，画面帧率另算。用上一步与这一步之间的位置出图，走动时镜头才是匀速的。
// 数组依次是角色的 x、z，然后是每只鬼的 x、z。
const pose: RenderPose = { x: 0, z: 0, ghosts: [] };
const lerpFrom: number[] = [], lerpTo: number[] = [], lerpNow: number[] = [];
let lerpWorld: World | null = null;

function positions(out: number[], w: World): void {
  out.length = 2 + w.ghosts.length * 2;
  out[0] = w.player.x; out[1] = w.player.z;
  w.ghosts.forEach((g, i) => { out[2 + i * 2] = g.x; out[3 + i * 2] = g.z; });
}

function updatePose(w: World, alpha: number): void {
  positions(lerpNow, w);
  // 读档、重开、入夜生成两鬼或调试摆位之后没有可用的上一步：直接用当前位置
  const ok = lerpWorld === w && lerpFrom.length === lerpNow.length && lerpNow.every((v, i) => v === lerpTo[i]);
  const at = (i: number): number => (ok ? lerpFrom[i] + (lerpTo[i] - lerpFrom[i]) * alpha : lerpNow[i]);
  pose.x = at(0); pose.z = at(1);
  pose.ghosts = w.ghosts.map((_, i) => ({ x: at(2 + i * 2), z: at(3 + i * 2) }));
}

function applySettings(): void {
  view.brightness = settings.brightness;
  audio.setVolume(settings.volume);
  saveSettings(settings);
}

function pause(id: ScreenId = 'resume', arg?: unknown): void {
  if (mode !== 'playing') return;
  screens.open(id, arg);
  input.releaseLock();
}

function resume(): void {
  if (mode !== 'playing') return;
  const ph = session.world.phase;
  if (ph === 'failed') { screens.replace('failed'); return; }
  if (ph === 'ended' && endTimer <= 0) { screens.replace('ended'); return; }
  input.requestLock();
}

function begin(): void {
  mode = 'playing';
  lockFailed = false;
  pending = [];
  endTimer = 0;
  acc = 0;
  view.fixedCam = null;
  input.yaw = session.world.player.yaw;
  input.pitch = 0.12;
  hud.clearTransient();
  hud.show(true);
  screens.closeAll();
  input.requestLock();
}

const screens = new Screens({
  world: () => session.world,
  settings,
  retries: () => session.retries,
  hasSnapshot: () => session.hasSnapshot(),
  saveNotice: () => '',
  storageNote: () => storageNote,
  lockFailed: () => lockFailed,
  settingsChanged: applySettings,
  captureKey: (cb) => input.captureNextKey(cb),
  cancelCapture: () => input.cancelCapture(),
  startNew: () => {
    if (loaded.status === 'corrupt' || loaded.status === 'version') storageNote = '';
    session.newGame();
    begin();
  },
  continueGame: () => { if (session.continueFromDusk()) { begin(); hud.toast('已从黄昏起点恢复'); } },
  resume,
  toTitle: () => {
    mode = 'title';
    input.releaseLock();
    hud.show(false);
    view.fixedCam = TITLE_CAM;
    screens.replace('title');
  },
  retryNight: () => {
    if (session.retryNight()) { begin(); hud.toast(`已回到黄昏起点（第 ${session.retries} 次重试）`); } else hud.toast('没有可用的黄昏存档');
  },
  restartDay: () => { session.newGame(); begin(); hud.toast('已重开当天'); },
  confirmRepair: (id: RepairId) => {
    if (confirmRepair(session.world, id, session.hooks)) resume();
    else screens.refresh();
  },
  boardClosed: () => { session.world.quest.boardRead = true; resume(); },
  toggleLantern: () => pending.push({ type: 'toggleLantern' }),
  eat: () => pending.push({ type: 'eat' }),
});

session.onEvent = (e: SimEvent) => {
  switch (e.kind) {
    case 'sfx':
      if (e.id) audio.play(e.id);
      if (e.id === 'bell') view.props.ringBell();
      break;
    case 'toast': if (e.text) hud.toast(e.text); break;
    case 'subtitle': if (e.text) hud.subtitle(e.text, session.world, input.yaw, e.x, e.z); break;
    case 'hurt':
      audio.play('hurt');
      view.player.triggerHurt();
      if (e.text) hud.toast(e.text);
      break;
    case 'phase':
      if (e.id === 'dusk' && !session.lastSavePersisted) {
        storageNote = '浏览器存储不可用：进度不会保留到下次打开，本次仍可重试当晚。';
        hud.toast('存储不可用：快照只保留在本次会话中');
      } else if (e.id === 'failed') pause('failed');
      else if (e.id === 'ended') { session.complete(); endTimer = 4.5; }
      break;
    case 'quest': case 'snapshot': break;
  }
};

input.onLockChange = (locked) => {
  if (locked) { lockFailed = false; screens.closeAll(); audio.resume(); return; }
  if (mode === 'playing' && !screens.isOpen()) screens.open('resume');
};
input.onLockError = () => {
  lockFailed = true;
  if (mode === 'playing') screens.replace('resume');
};
input.onBlur = () => {
  if (mode === 'playing' && !screens.isOpen()) pause('resume');
  if (document.hidden) audio.suspend();
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) audio.resume(); });
document.addEventListener('pointerdown', () => audio.unlock());
canvas.addEventListener('click', () => {
  // 兜底：游戏中没有任何界面、鼠标又未被捕获时，点击画面重新捕获。
  if (mode === 'playing' && !input.locked && !screens.isOpen()) input.requestLock();
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (input.fakeLock && input.locked) { pause('resume'); return; }
  const top = screens.top();
  if (top === 'settings' || top === 'confirmNew' || top === 'calibrate' || (top === 'tasks' && mode === 'title')) screens.back();
});

function tick(dt: number): void {
  const w = session.world;
  const running = mode === 'playing' && input.locked && !screens.isOpen();
  if (running) {
    for (const p of input.takePresses()) {
      if (p === 'interact') pending.push({ type: 'interact' });
      else if (p === 'toggleLantern') pending.push({ type: 'toggleLantern' });
      else if (p === 'eat') pending.push({ type: 'eat' });
      else if (p === 'tasks') { pause('tasks'); return; }
      else if (p === 'toolbar') { pause('toolbar'); return; }
    }
    const held = input.poll();
    acc = Math.min(acc + dt * preset.timeScale, FIXED_DT * 12 * preset.timeScale);
    while (acc >= FIXED_DT) {
      acc -= FIXED_DT;
      const world = session.world;
      const bx = world.player.x, bz = world.player.z;
      positions(lerpFrom, world);
      step(world, { ...held, yaw: input.yaw, pitch: input.pitch, actions: pending }, FIXED_DT, session.hooks, preset.dayClockScale);
      positions(lerpTo, world);
      lerpWorld = world;
      pending = [];
      stepDist += Math.hypot(world.player.x - bx, world.player.z - bz);
      if (stepDist > (world.player.sprinting ? 1.25 : 0.8)) {
        stepDist = 0;
        audio.step(regionAt(world.player.x, world.player.z) === 'gatehouse' ? 'wood' : 'stone', world.player.sprinting);
      }
      // 修复确认与任务板会暂停计时
      if (session.ui.repair) { const id = session.ui.repair; session.ui.repair = null; pause('repair', id); break; }
      if (session.ui.board) { session.ui.board = false; pause('board'); break; }
      if (session.world !== world || screens.isOpen()) break;
    }
    if (endTimer > 0) {
      endTimer -= dt;
      if (endTimer <= 0) pause('ended');
    }
  } else input.takePresses();

  // 声音与受威胁反馈
  let greyNear = 0, wraithNear = 0, danger = 0;
  for (const g of w.ghosts) {
    if (g.mode === 'gone' || g.mode === 'dissolve') continue;
    const near = Math.max(0, 1 - Math.hypot(g.x - w.player.x, g.z - w.player.z) / 16);
    if (g.kind === 'grey') greyNear = near; else wraithNear = g.mode === 'windup' || g.mode === 'alert' ? 0 : near;
    if (ghostThreatens(g)) danger = 1;
  }
  threat += (danger - threat) * Math.min(1, dt * 3);
  if (mode === 'playing' && running) {
    const r = regionAt(w.player.x, w.player.z);
    audio.ambient(r === 'gatehouse' ? 'gatehouse' : r === 'chapel' ? 'chapel' : 'courtyard', w.phase === 'night', w.hearth.lit, threat, greyNear, wraithNear);
  } else audio.ambient('none', false, false, 0, 0, 0);

  updatePose(w, running ? Math.min(1, acc / FIXED_DT) : 1);
  view.update(w, pose, input.yaw, input.pitch, dt, time);
  if (mode === 'playing') hud.update(w, running ? pickTarget(w) : null, threat * 0.85, input.sprintLocked);
  view.render();
}

const timer = new THREE.Timer();
timer.connect(document);
view.renderer.setAnimationLoop((now: number) => {
  // 用浏览器给的帧时间戳（对齐屏幕刷新）而不是回调实际执行的时刻，帧间隔才不受主线程抖动影响
  timer.update(now);
  const dt = Math.min(Math.max(timer.getDelta(), 0), 0.1);
  time += dt;
  frames.push(dt * 1000);
  if (frames.length > 3600) frames.shift();
  // 掉帧记录：只在游戏进行中记，供性能验收定位掉帧位置
  if (dt > 0.025 && mode === 'playing' && input.locked && !screens.isOpen() && slowFrames.length < 400) {
    const p = session.world.player;
    slowFrames.push({ ms: Math.round(dt * 1000), phase: session.world.phase, x: +p.x.toFixed(1), z: +p.z.toFixed(1) });
  }
  tick(dt);
});

applySettings();
view.fixedCam = TITLE_CAM;
screens.replace('title');

// 只读探针（?probe=1）：供自动化验收读取状态与帧时间，不改变任何玩法参数。
function probe(): Record<string, unknown> {
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
  return {
    mode, screen: screens.top(), locked: input.locked, yaw: input.yaw, pitch: input.pitch,
    retries: session.retries, hasSnapshot: session.hasSnapshot(), storageNote, preset: preset.name,
    world: JSON.parse(JSON.stringify(session.world)),
    target: mode === 'playing' ? pickTarget(session.world) : null,
    perf: {
      frames: frames.length, avgMs: avg, fps: avg > 0 ? 1000 / avg : 0,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0, maxMs: sorted[sorted.length - 1] ?? 0,
      over20ms: frames.filter((f) => f > 20).length,
      calls: view.renderer.info.render.calls, triangles: view.renderer.info.render.triangles,
    },
  };
}

const w = window as unknown as Record<string, unknown>;
if (params.get('probe') === '1' || preset.debug) {
  const gl = view.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  w.__awProbe = {
    state: probe,
    // 轻量状态：机器人每个控制周期读一次，不统计帧时间。
    lite: () => ({
      mode, screen: screens.top(), locked: input.locked, yaw: input.yaw, pitch: input.pitch,
      retries: session.retries, hasSnapshot: session.hasSnapshot(), world: session.world,
      target: mode === 'playing' ? pickTarget(session.world) : null,
    }),
    resetPerf: () => { frames.length = 0; slowFrames.length = 0; },
    slowFrames: () => slowFrames.slice(),
    interacts: () => INTERACTS,
    rules: () => ({ grey: GHOST.grey.repelRange, wraith: GHOST.wraith.repelRange, holdMargin: GHOST.repelHoldMargin }),
    gpu: () => (ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown'),
    // 只读寻路查询：自动化验收的机器人用它决定往哪走，输入仍是真实的键鼠事件。
    path: (x: number, z: number) => findPath(session.world.player, { x, z }, { doors: session.world.doors, lit: [] }),
  };
}

// 开发预设（?preset=dev）：跳阶段、摆放、固定机位。发布预设下不存在。
if (preset.debug) {
  const dbg = document.getElementById('debug') as HTMLElement;
  dbg.hidden = false;
  setInterval(() => {
    const s = probe().perf as { fps: number; calls: number; triangles: number };
    const p = session.world.player;
    dbg.textContent = `dev ×${preset.timeScale} 昼×${preset.dayClockScale}  ${s.fps.toFixed(0)} fps  ${s.calls} calls  ${s.triangles} tris\n${session.world.phase} ${session.world.clock.toFixed(0)}s  (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
  }, 500);
  w.__awDev = {
    session, input, view, screens, preset,
    fakeLock(on: boolean) { input.fakeLock = on; },
    fixedCam(pos: [number, number, number] | null, look?: [number, number, number]) { view.fixedCam = pos && look ? { pos, look } : null; },
    zones(on: boolean) { view.props.lampDebugRing.visible = on; },
    hud(on: boolean) { hud.show(on); },
  };
}
