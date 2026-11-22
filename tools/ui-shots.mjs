// UI 专项截图：标题、暂停、设置、任务、工具栏、结算与昼夜 HUD。
// 用法：AW_URL=http://localhost:5186/ AW_OUT=/tmp/aw3-ui node tools/ui-shots.mjs chrome --headless [名称过滤]
// 分辨率用 AW_W / AW_H（默认 1920×1080）。只读开发预设摆位，不改玩法。
import { BASE, launch, shot, sleep, waitFor } from './lib.mjs';

const channel = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'chrome';
const headless = process.argv.includes('--headless');
const filter = process.argv.slice(3).find((a) => !a.startsWith('--')) ?? '';
const W = Number(process.env.AW_W) || 1920;
const suffix = W === 1920 ? '' : `-${W}`;

const { browser, page, errors } = await launch({ channel, headless });
// 加载页：错开节流外部贴图/模型，让真实百分比爬升，抓中段（而非 0% 或 100%）。
let req = 0;
let throttling = true;
const slow = async (r) => {
  if (throttling) await sleep(150 + (req++ % 12) * 220);
  try { await r.continue(); } catch { /* 请求已被处理 */ }
};
await page.route('**/textures/**', slow);
await page.route('**/models/**', slow);
await page.goto(`${BASE}?preset=dev`, { waitUntil: 'domcontentloaded' });
if (!filter || 'ui-boot'.includes(filter)) {
  await waitFor(page, () => window.__awLoad && window.__awLoad.total > 0);
  await sleep(1100);
  await shot(page, `ui-boot${suffix}.png`);
  console.log('shot', 'ui-boot' + suffix, await page.evaluate(() => window.__awLoad));
}
throttling = false;
await waitFor(page, () => window.__awProbe?.state().perf.calls > 0);
await page.evaluate(() => window.__awTexReady);
await sleep(600);

const take = async (name) => {
  if (filter && !name.includes(filter)) return;
  await sleep(450);
  await shot(page, `${name}${suffix}.png`);
  console.log('shot', name + suffix);
};

// 标题页（游戏内实际渲染作底）
await take('ui-title');
// 标题 → 设置
await page.locator('#overlay button', { hasText: '设置' }).click();
await take('ui-title-settings');
await page.locator('#overlay button', { hasText: '完成' }).click();

// 进入游戏但不捕获鼠标
await page.evaluate(() => { window.__awDev.fakeLock(true); });
await page.locator('#overlay button', { hasText: '新游戏' }).click();
await take('ui-calibrate');
await page.locator('#overlay button', { hasText: '开始' }).click();
await sleep(300);
await page.evaluate(() => { window.__awDev.input.locked = false; window.__awDev.screens.closeAll(); });

const stage = (spec) => page.evaluate((s) => {
  const d = window.__awDev;
  const w = d.session.world;
  Object.assign(w, { phase: s.phase, clock: s.clock ?? 0 });
  w.inv.hasLantern = true; w.quest.boardRead = true;
  w.lantern.on = !!s.lantern; w.lantern.oil = s.oil ?? 300; w.lantern.raised = false;
  Object.assign(w.repairs, { lamp: false, gate: false, bolt: false }, s.repairs ?? {});
  Object.assign(w.inv, { wood: 0, iron: 0, oil: 0, meal: 0, hasClapper: false }, s.inv ?? {});
  w.hearth = { lit: true, burn: 300 };
  w.lampBurn = s.lampBurn ?? 0;
  Object.assign(w.player, { x: s.at[0], z: s.at[1], yaw: s.yaw, hp: s.hp ?? 100, cold: s.cold ?? 0, moving: false, sprinting: false });
  d.input.yaw = s.yaw; d.input.pitch = s.pitch ?? 0.1;
  d.fixedCam(null);
  d.hud(true);
}, spec);

const DEG = Math.PI / 180;
// 夜晚庭院 HUD（含目标、状态条、工具栏）
await stage({ phase: 'night', at: [0, 3.5], yaw: 12 * DEG, pitch: 0.06, lantern: true, repairs: { lamp: true }, lampBurn: 250 });
await take('ui-hud-night');
// 夜晚低状态：生命垂危、寒意高、灯油将尽、持有钟舌与热食
await stage({ phase: 'night', at: [0, 3.5], yaw: 12 * DEG, pitch: 0.06, lantern: true, oil: 22, hp: 26, cold: 200, inv: { wood: 2, iron: 1, oil: 1, meal: 1, hasClapper: true } });
await take('ui-hud-night-low');
// 白天门房 HUD
await stage({ phase: 'day', clock: 200, at: [0.6, -1.6], yaw: -150 * DEG, pitch: 0.12, lantern: false, inv: { wood: 2, iron: 2, oil: 1 } });
await take('ui-hud-day');
// 白天庭院第三人称
await stage({ phase: 'day', clock: 300, at: [0, 3.5], yaw: 12 * DEG, pitch: 0.06, repairs: { lamp: true }, inv: { wood: 1, iron: 2, oil: 1, meal: 1 } });
await take('ui-hud-tp-day');

// 暂停 / 设置 / 任务 / 工具栏 / 结算（在夜晚场景上打开，检查暗底对比）
await stage({ phase: 'night', at: [0, 3.5], yaw: 12 * DEG, pitch: 0.06, lantern: true, repairs: { lamp: true }, lampBurn: 250 });
await page.evaluate(() => window.__awDev.screens.open('resume'));
await take('ui-pause');
await page.evaluate(() => window.__awDev.screens.open('settings'));
await take('ui-settings');
await page.evaluate(() => window.__awDev.screens.replace('tasks'));
await take('ui-tasks');
await page.evaluate(() => window.__awDev.screens.replace('toolbar'));
await take('ui-toolbar');
await page.evaluate(() => window.__awDev.screens.replace('ended'));
await take('ui-ended');
await page.evaluate(() => window.__awDev.screens.replace('failed'));
await take('ui-failed');
await page.evaluate(() => window.__awDev.screens.closeAll());

console.log('errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);