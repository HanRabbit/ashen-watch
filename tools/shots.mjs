// 实机截图：用开发预设把世界摆到指定状态，再用真实的越肩镜头（或同一台固定验收机位）截图。
// 用法：node tools/shots.mjs [chrome|msedge] [--headless] [名称过滤]
import { BASE, launch, shot, sleep, waitFor } from './lib.mjs';

const channel = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'chrome';
const headless = process.argv.includes('--headless');
const filter = process.argv.slice(3).find((a) => !a.startsWith('--')) ?? '';

/** 把模拟摆到某个阶段。全部在页面里执行。 */
const stage = (page, spec) => page.evaluate((s) => {
  const d = window.__awDev;
  if (d.session.world.phase === 'tutorial' && !d.started) {
    d.started = true;
  }
  const w = d.session.world;
  Object.assign(w, { phase: s.phase, clock: s.clock ?? 0 });
  w.inv.hasLantern = true; w.quest.boardRead = true;
  w.lantern.on = !!s.lantern; w.lantern.oil = 300; w.lantern.raised = !!s.raised;
  Object.assign(w.repairs, { lamp: false, gate: false, bolt: false }, s.repairs ?? {});
  Object.assign(w.doors, { gatehouse: false, gate: false, chapelFront: false }, s.doors ?? {});
  w.bolted = !!s.bolted;
  w.lampBurn = s.lampBurn ?? 0;
  w.braziers = { chapel: 0, side: 0, ...(s.braziers ?? {}) };
  w.hearth = { lit: s.hearth ?? true, burn: 300 };
  Object.assign(w.taken, { shelf: false, crate: false, flask: false, food: false, chest: false }, s.taken ?? {});
  Object.assign(w.inv, { wood: 0, iron: 0, oil: 0, meal: 0, hasClapper: false }, s.inv ?? {});
  w.quest.installed = !!s.installed;
  Object.assign(w.player, { x: s.at[0], z: s.at[1], yaw: s.yaw, hp: s.hp ?? 100, cold: s.cold ?? 0, moving: false, sprinting: false });
  d.input.yaw = s.yaw; d.input.pitch = s.pitch ?? 0.1;
  w.ghosts = (s.ghosts ?? []).map((g) => ({
    kind: g.kind, x: g.at[0], z: g.at[1], yaw: g.yaw ?? 0, mode: g.mode ?? 'patrol', t: g.t ?? 0.3, patrolIdx: 0, path: [], goal: null,
    lastKnown: null, canSee: false, loseT: 0, senseT: 9, repathT: 9, stuckT: 0, repelCd: 0, lightT: 0, cowed: 0, sawSprint: false, flankSide: 1, bangOpens: false, waiting: false,
  }));
  d.fixedCam(s.cam ? s.cam.pos : null, s.cam ? s.cam.look : undefined);
  d.zones(!!s.zones);
  d.hud(s.hud !== false);
}, spec);

const COURT_CAM = { pos: [4, 2.0, 1.2], look: [0.5, 3.0, 19.2] };
const GHOST_CAM = { pos: [0, 1.5, 17.6], look: [0, 1.0, 22] };
const DEG = Math.PI / 180;
// 参考机位：对标 concept/03（左侧壁灯墙、中景井台、右侧东墙栅门、远处礼拜堂与远景城堡）
const REF_CAM = { pos: [-8.2, 1.75, 3.2], look: [9, 4.6, 22] };
// 天空验收机位：仰角看云层层次与月晕，礼拜堂尖塔作剪影参照
const SKY_CAM = { pos: [-8.2, 1.75, 3.2], look: [4, 30, 46] };

const SHOTS = [
  // 参考机位昼夜对照（美术第二轮的主验收图）
  ['ref-day', { phase: 'day', clock: 300, at: [-6, 1.6], yaw: 0, cam: REF_CAM, hud: false, repairs: { lamp: true, gate: true }, doors: { gatehouse: true } }],
  ['ref-night', { phase: 'night', at: [-6, 1.6], yaw: 0, cam: REF_CAM, hud: false, repairs: { lamp: true, gate: true }, lampBurn: 250, lantern: false, doors: { gatehouse: true } }],
  // 天空/云层验收（render 第三轮新增）
  ['ref-sky-day', { phase: 'day', clock: 300, at: [-6, 1.6], yaw: 0, cam: SKY_CAM, hud: false, repairs: { lamp: true, gate: true }, doors: { gatehouse: true } }],
  ['ref-sky-night', { phase: 'night', at: [-6, 1.6], yaw: 0, cam: SKY_CAM, hud: false, repairs: { lamp: true, gate: true }, lampBurn: 250, lantern: false, doors: { gatehouse: true } }],
  // A13：门房（回程地标、炉火、补油台、门闩）
  ['a13-gatehouse-hearth', { phase: 'day', clock: 200, at: [0.6, -1.6], yaw: -150 * DEG, pitch: 0.12, lantern: false }],
  ['a13-gatehouse-door-unbolted', { phase: 'night', at: [0.2, -3.2], yaw: 4 * DEG, pitch: 0.05, lantern: true, repairs: { bolt: true } }],
  ['a13-gatehouse-door-bolted', { phase: 'night', at: [0.2, -3.2], yaw: 4 * DEG, pitch: 0.05, lantern: true, repairs: { bolt: true }, bolted: true }],
  ['a13-gatehouse-bolt-broken', { phase: 'day', clock: 200, at: [0.2, -3.2], yaw: 4 * DEG, pitch: 0.05 }],
  // A13：庭院昼夜对照，同一套几何、同一台验收机位
  ['a13-courtyard-day', { phase: 'day', clock: 300, at: [0, 5], yaw: 0, cam: COURT_CAM, hud: false, repairs: { lamp: true, gate: true }, doors: { gatehouse: true } }],
  ['a13-courtyard-night-lamp-on', { phase: 'night', at: [0, 5], yaw: 0, cam: COURT_CAM, hud: false, repairs: { lamp: true, gate: true }, lampBurn: 250, lantern: true, doors: { gatehouse: true } }],
  ['a13-courtyard-night-lamp-out', { phase: 'night', at: [0, 5], yaw: 0, cam: COURT_CAM, hud: false, repairs: { lamp: true, gate: true }, lampBurn: 0, lantern: true, doors: { gatehouse: true } }],
  ['a13-courtyard-night-lantern-off', { phase: 'night', at: [0, 5], yaw: 0, cam: COURT_CAM, hud: false, repairs: { lamp: true, gate: true }, lampBurn: 0, lantern: false, doors: { gatehouse: true } }],
  // A13：第三人称下的庭院与回程
  ['a13-tp-courtyard-day', { phase: 'day', clock: 300, at: [0, 3.5], yaw: 12 * DEG, pitch: 0.06, repairs: { lamp: true } }],
  ['a13-tp-courtyard-night', { phase: 'night', at: [0, 3.5], yaw: 12 * DEG, pitch: 0.06, lantern: true, repairs: { lamp: true }, lampBurn: 250 }],
  ['a13-tp-return-night', { phase: 'night', at: [2, 21], yaw: 185 * DEG, pitch: 0.05, lantern: false, inv: { hasClapper: true }, taken: { chest: true } }],
  ['a13-lamp-zone-debug', { phase: 'night', at: [-1, 8], yaw: -35 * DEG, pitch: 0.3, lantern: true, repairs: { lamp: true }, lampBurn: 250, zones: true }],
  // A13：栅门三态
  ['a13-gate-jammed', { phase: 'day', clock: 300, at: [7.4, 6], yaw: 90 * DEG, pitch: 0.03 }],
  ['a13-gate-closed', { phase: 'day', clock: 300, at: [7.4, 6], yaw: 90 * DEG, pitch: 0.03, repairs: { gate: true } }],
  ['a13-gate-open', { phase: 'day', clock: 300, at: [7.4, 6], yaw: 90 * DEG, pitch: 0.03, repairs: { gate: true }, doors: { gate: true } }],
  ['a13-side-passage-night', { phase: 'night', at: [11.75, 4.6], yaw: 0, pitch: 0.05, lantern: true, repairs: { gate: true } }],
  // A13：礼拜堂与祭台匣
  ['a13-chapel-day', { phase: 'day', clock: 300, at: [19, 22.6], yaw: 180 * DEG, pitch: 0.02, doors: { chapelFront: true } }],
  ['a13-chapel-chest-night', { phase: 'night', at: [19, 12.2], yaw: 180 * DEG, pitch: 0.12, lantern: true }],
  ['a13-bell-dawn', { phase: 'dawn', at: [1.2, 3.4], yaw: 150 * DEG, pitch: -0.12, inv: { hasClapper: true }, taken: { chest: true } }],
  // 火盆：未点与点亮
  ['brazier-chapel-unlit', { phase: 'night', at: [19, 14.6], yaw: 150 * DEG, pitch: 0.1, lantern: true, doors: { chapelFront: true } }],
  ['brazier-chapel-lit', { phase: 'night', at: [19, 14.6], yaw: 150 * DEG, pitch: 0.1, lantern: false, doors: { chapelFront: true }, braziers: { chapel: 150 },
    ghosts: [{ kind: 'wraith', at: [15.5, 13.5], yaw: 90 * DEG }] }],
  ['brazier-side-lit', { phase: 'night', at: [11.75, 4.4], yaw: 0, pitch: 0.08, lantern: false, braziers: { side: 150 } }],
  ['brazier-side-day', { phase: 'day', clock: 200, at: [11.75, 5.4], yaw: -10 * DEG, pitch: 0.1, repairs: { gate: true } }],
  ['cot-day', { phase: 'day', clock: 200, at: [0.6, -5.2], yaw: 180 * DEG, pitch: 0.25 }],
  // A13：两种鬼的轮廓、预警与攻击动作
  ['a13-ghosts-silhouettes', { phase: 'night', at: [0, 17.2], yaw: 0, pitch: 0.04, lantern: false, ghosts: [
    { kind: 'grey', at: [-1.9, 22.5], yaw: 170 * DEG }, { kind: 'wraith', at: [2.1, 22.2], yaw: 215 * DEG }] }],
  ['a13-ghosts-lantern', { phase: 'night', at: [0, 17.2], yaw: 0, pitch: 0.04, lantern: true, ghosts: [
    { kind: 'grey', at: [-1.9, 22.5], yaw: 170 * DEG }, { kind: 'wraith', at: [2.1, 22.2], yaw: 215 * DEG }] }],
  ['a13-ghosts-closeup-day', { phase: 'day', clock: 300, at: [8, 4], yaw: 0, cam: GHOST_CAM, hud: false, ghosts: [
    { kind: 'grey', at: [-1.1, 21.2], yaw: 160 * DEG }, { kind: 'wraith', at: [1.2, 21], yaw: 250 * DEG }] }],
  ['a13-ghosts-closeup-night', { phase: 'night', at: [8, 4], yaw: 0, cam: GHOST_CAM, hud: false, ghosts: [
    { kind: 'grey', at: [-1.1, 21.2], yaw: 160 * DEG }, { kind: 'wraith', at: [1.2, 21], yaw: 250 * DEG }] }],
  ['a13-grey-alert', { phase: 'night', at: [0, 18], yaw: 0, pitch: 0.04, lantern: true, ghosts: [{ kind: 'grey', at: [0, 22.5], yaw: 180 * DEG, mode: 'alert', t: 0.3 }] }],
  ['a13-grey-windup', { phase: 'night', at: [0, 19.4], yaw: 0, pitch: 0.04, lantern: true, ghosts: [{ kind: 'grey', at: [0, 21.6], yaw: 180 * DEG, mode: 'windup', t: 0.8 }] }],
  ['a13-wraith-prowl', { phase: 'night', at: [0, 18], yaw: 0, pitch: 0.1, lantern: true, ghosts: [{ kind: 'wraith', at: [0.4, 21.6], yaw: 120 * DEG, mode: 'patrol' }] }],
  ['a13-wraith-windup', { phase: 'night', at: [0, 19.4], yaw: 0, pitch: 0.1, lantern: true, ghosts: [{ kind: 'wraith', at: [0, 21.8], yaw: 180 * DEG, mode: 'windup', t: 1.0 }] }],
  ['a13-ghost-recoil-raised', { phase: 'night', at: [0, 19], yaw: 0, pitch: 0.06, lantern: true, raised: true, ghosts: [{ kind: 'grey', at: [0, 22.4], yaw: 180 * DEG, mode: 'recoil', t: 0.6 }] }],
];

const { browser, page, errors } = await launch({ channel, headless });
await page.goto(`${BASE}?preset=dev`);
await waitFor(page, () => window.__awProbe?.state().perf.calls > 0);
await page.evaluate(() => window.__awTexReady);
// 进入「游戏中」但不捕获鼠标：模拟停住，画面与 HUD 照常更新
await page.evaluate(() => { const d = window.__awDev; d.fakeLock(true); });
await page.locator('#overlay button', { hasText: '新游戏' }).click();
await page.locator('#overlay button', { hasText: '开始' }).click();
await sleep(300);
await page.evaluate(() => { window.__awDev.input.locked = false; window.__awDev.screens.closeAll(); });

for (const [name, spec] of SHOTS) {
  if (filter && !name.includes(filter)) continue;
  await stage(page, spec);
  await sleep(spec.settle ?? 900);
  // 动画停在指定的时刻：每次截图前把状态计时重置回去
  await stage(page, spec);
  await sleep(120);
  await shot(page, `${name}.png`);
  console.log('shot', name);
}
console.log('errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);
