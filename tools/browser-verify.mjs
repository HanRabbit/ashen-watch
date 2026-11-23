// 浏览器内验收：在生产构建上用真实键鼠事件跑 A01、A02、A03、A08、A11、A12 的浏览器部分。
// 用法：node tools/browser-verify.mjs [chrome|msedge] [--headless] [场景名…]
// 场景：kbm / mouse / tab / storage；step2 跑修复矩阵；route 实走三层地图。
// 需要先 npm run build && npm run preview。结果写到 docs/verification/browser-<场景>-<浏览器>.json。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, clickButton, launch, OUT, shot, sleep, waitFor } from './lib.mjs';
import { Bot, BotFailed, chooseMouseMode, doTutorial, STAND, startNewGame } from './bot.mjs';

const args = process.argv.slice(2);
const channel = args[0] && !args[0].startsWith('--') ? args[0] : 'chrome';
const headless = args.includes('--headless');
const wanted = args.slice(1).filter((a) => !a.startsWith('--'));
const ALL = ['tab', 'storage', 'mouse', 'kbm'];
const STEP2 = ['step2-mouse','step2-none','step2-lamp-bolt','step2-gate-bolt','step2-lamp-gate','step2-late'];
const scenarios = wanted.includes('step2') ? STEP2 : wanted.length ? wanted : ALL;

class Report {
  constructor(name) { this.name = name; this.checks = []; this.data = {}; this.t0 = Date.now(); }
  check(label, ok, detail = '') {
    this.checks.push({ label, ok: !!ok, detail: String(detail) });
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  —  ${detail}` : ''}`);
  }
  get failed() { return this.checks.filter((c) => !c.ok).length; }
  save(errors) {
    const out = { scenario: this.name, channel, headless, base: BASE, finishedAt: new Date().toISOString(),
      wallSecs: Math.round((Date.now() - this.t0) / 1000), failed: this.failed, consoleErrors: errors, checks: this.checks, ...this.data };
    fs.writeFileSync(path.join(OUT, `browser-${this.name}-${channel}.json`), JSON.stringify(out, null, 2));
  }
}

const liteOf = (page) => page.evaluate(() => window.__awProbe.lite());
const fullOf = (page) => page.evaluate(() => window.__awProbe.state());
const ready = (page) => waitFor(page, () => window.__awProbe?.state().perf.calls > 0);
const titleInfo = (page) => page.evaluate(() => ({
  text: document.querySelector('#overlay .panel')?.textContent ?? '',
  continueDisabled: [...document.querySelectorAll('#overlay button')].find((b) => b.textContent.includes('继续'))?.disabled ?? null,
}));

/** 性能取样：读出帧时间统计与掉帧位置，然后清零。 */
async function samplePerf(page, tag, bucket) {
  const perf = (await fullOf(page)).perf;
  const slow = await page.evaluate(() => window.__awProbe.slowFrames());
  await page.evaluate(() => window.__awProbe.resetPerf());
  if (bucket && perf.frames > 0) bucket.push({ tag, frames: perf.frames, avgMs: +perf.avgMs.toFixed(2), p95Ms: +perf.p95Ms.toFixed(1), maxMs: +perf.maxMs.toFixed(1), over20ms: perf.over20ms, slow });
}

function summarize(bucket) {
  const frames = bucket.reduce((a, b) => a + b.frames, 0);
  const avgMs = bucket.reduce((a, b) => a + b.avgMs * b.frames, 0) / Math.max(1, frames);
  const slow = bucket.flatMap((b) => b.slow);
  const where = {};
  for (const s of slow) { const k = `${s.phase} (${Math.round(s.x / 4) * 4}, ${Math.round(s.z / 4) * 4})`; where[k] = (where[k] ?? 0) + 1; }
  return { frames, avgFps: +(1000 / avgMs).toFixed(1), avgMs: +avgMs.toFixed(2), worstP95Ms: Math.max(0, ...bucket.map((b) => b.p95Ms)),
    maxMs: Math.max(0, ...bucket.map((b) => b.maxMs)), over20ms: bucket.reduce((a, b) => a + b.over20ms, 0), over25ms: slow.length,
    slowWhere: Object.entries(where).sort((a, b) => b[1] - a[1]).slice(0, 8) };
}

/** 修复确认界面：打开 → 确认或取消。返回界面上的文字与确认按钮是否可点。 */
async function repairVia(bot, id, stand, action) {
  await bot.use(id, stand, { sprint: true });
  await bot.waitScreen('repair');
  const info = await bot.page.evaluate(() => ({
    text: document.querySelector('#overlay .panel')?.textContent ?? '',
    canConfirm: !document.querySelector('#overlay button[data-act="repairOk"]').disabled,
  }));
  await bot.click(action === 'confirm' ? '确认修复' : info.canConfirm ? '取消' : '返回');
  await sleep(150);
  return info;
}

/** 白天：搜集、修复（三选二）、热食、补油。plan.repairs 是要修的两项。 */
async function day(bot, rep, plan) {
  const inv = async () => (await bot.lite()).world.inv;
  await doTutorial(bot);
  rep.check('教学结束后进入白天', (await bot.waitPhase(['day'], 3)).world.phase === 'day');
  await bot.toggleLantern(); // 白天关灯省油
  rep.check(bot.mouseOnly ? '工具栏「提灯」可熄灭提灯' : 'F 键可熄灭提灯', (await bot.lite()).world.lantern.on === false);
  await bot.use('ghDoor', STAND.doorIn);
  rep.check('打开门房门', (await bot.lite()).world.doors.gatehouse === true);
  await bot.use('shelf', STAND.shelf, { sprint: true });

  // 壁灯：要修就确认，否则打开确认界面后取消，材料应原样保留
  const before = await inv();
  const lampInfo = await repairVia(bot, 'lamp', STAND.lamp, plan.repairs.includes('lamp') ? 'confirm' : 'cancel');
  const after = await inv();
  if (plan.repairs.includes('lamp')) rep.check('修复壁灯：扣 2 木 1 铁，恰好一次', before.wood - after.wood === 2 && before.iron - after.iron === 1, `木 ${before.wood}→${after.wood}，铁 ${before.iron}→${after.iron}`);
  else rep.check('修复确认界面取消后材料不变', lampInfo.canConfirm && after.wood === before.wood && after.iron === before.iron, `木 ${after.wood}，铁 ${after.iron}`);

  await bot.use('crate', STAND.crate, { sprint: true });
  await bot.use('chapelFront', STAND.frontOut);
  await bot.use('flask', STAND.flask);
  const got = await inv();
  const spent = plan.repairs.includes('lamp') ? { wood: 2, iron: 1 } : { wood: 0, iron: 0 };
  rep.check('全图共拾得 4 木 4 铁 3 油', got.wood + spent.wood === 4 && got.iron + spent.iron === 4 && got.oil === 3, `现有 木 ${got.wood} 铁 ${got.iron} 油 ${got.oil}`);

  if (plan.repairs.includes('gate')) {
    const b = await inv();
    await repairVia(bot, 'gate', STAND.gateW, 'confirm');
    const a = await inv();
    rep.check('修复栅门：扣 1 木 2 铁，恰好一次', b.wood - a.wood === 1 && b.iron - a.iron === 2 && (await bot.lite()).world.repairs.gate, `木 ${b.wood}→${a.wood}，铁 ${b.iron}→${a.iron}`);
    await bot.use('gate', null);
    const a2 = await inv();
    rep.check('修好后再交互只是开关栅门，不再扣料', a2.wood === a.wood && a2.iron === a.iron && (await bot.lite()).world.doors.gate === true);
    await bot.use('gate', null);
  }
  if (plan.repairs.includes('bolt')) {
    const b = await inv();
    await repairVia(bot, 'bolt', STAND.boltIn, 'confirm');
    const a = await inv();
    rep.check('修复门闩：扣 2 木 2 铁，恰好一次', b.wood - a.wood === 2 && b.iron - a.iron === 2 && (await bot.lite()).world.repairs.bolt, `木 ${b.wood}→${a.wood}，铁 ${b.iron}→${a.iron}`);
  }
  // 第三项：材料不足，确认按钮不可点
  const third = plan.repairs.length === 2 && ['lamp', 'gate', 'bolt'].find((r) => !plan.repairs.includes(r));
  if (third) {
  const stand = { lamp: STAND.lamp, gate: STAND.gateW, bolt: STAND.boltIn }[third];
  const b3 = await inv();
  const info3 = await repairVia(bot, third, stand, 'cancel');
  const a3 = await inv();
  rep.check(`第三项（${third}）材料不足：确认按钮不可点，不扣料`, !info3.canConfirm && info3.text.includes('材料不足') && a3.wood === b3.wood && a3.iron === b3.iron, info3.text.match(/材料不足[^。]*/)?.[0] ?? '');

  }
  await bot.use('pot', STAND.pot, { sprint: true });
  rep.check('炉火旁做出一份热食', (await inv()).meal === 1);
  await bot.use('refuel', STAND.refuel);
  await bot.use('refuel', null);
  const oilA = (await bot.lite()).world;
  const refused = !(await bot.use('refuel', null, { expect: false }));
  const oilB = (await bot.lite()).world;
  rep.check('补油两次后第三次因将满被拒，不扣库存', refused && oilB.inv.oil === oilA.inv.oil && oilB.lantern.oil <= 300, `提灯 ${Math.round(oilB.lantern.oil)} 秒，库存 ${oilB.inv.oil} 份`);
  if (plan.skip && (await bot.lite()).world.phase === 'day') {
    // 不用干等：床铺休息到黄昏
    const before = (await bot.lite()).world;
    await bot.use('cot', STAND.cot);
    const after = (await bot.lite()).world;
    rep.check('白天在床铺休息，直接到黄昏并存档', before.phase === 'day' && after.phase === 'dusk' && (await bot.lite()).hasSnapshot === true, `白天第 ${Math.round(before.clock)} 秒休息`);
  }
  await bot.walkTo(STAND.hearth.x, STAND.hearth.z);
}

/** 入夜：取钟舌、回门房、守到晨曦。每一步都按当前状态决定，重试后可从头再来。 */
async function night(bot, rep, plan, perf) {
  const page = bot.page;
  const W = async () => (await bot.lite()).world;
  if (plan.skip && (await W()).phase === 'dusk') {
    const ok = await bot.use('hearth', STAND.hearth, { expect: false });
    if (!plan.duskSkipChecked) { rep.check('黄昏在壁炉旁等待，直接入夜', ok && (await W()).phase === 'night'); plan.duskSkipChecked = true; }
  }
  await bot.waitPhase(['night'], plan.duskWaitSecs);
  if (plan.latePickup) {
    // 不改世界：通过正常交互关门、添柴、关提灯，在炉边等完整一夜。
    if ((await W()).doors.gatehouse) await bot.use('ghDoor', STAND.doorIn);
    await bot.use('woodpile', STAND.woodpile);
    if ((await W()).lantern.on) await bot.toggleLantern();
    await bot.walkTo(STAND.hearth.x, STAND.hearth.z);
    await bot.waitPhase(['dawn'], 420);
    rep.check('不修复且未取钟舌，也能正常等到晨曦', !(await W()).inv.hasClapper && (await W()).player.hp > 0);
    await bot.use('ghDoor', STAND.doorIn);
  }
  await samplePerf(page, 'reset', null);
  let w = await W();
  if (!w.lantern.on) await bot.toggleLantern();
  if (bot.mouseOnly && !plan.raiseChecked) {
    // 纯鼠标举灯：右键长按
    await bot.setRaise(true); await sleep(600);
    const raised = (await W()).lantern.raised;
    await bot.setRaise(false); await sleep(100);
    rep.check('右键长按举灯，松开后放下且不触发交互', raised && !(await W()).lantern.raised && !(await bot.lite()).screen);
    plan.raiseChecked = true;
  }
  w = await W();
  if (!w.doors.gatehouse && w.player.z < 0.25) await bot.use('ghDoor', STAND.doorIn, { night: true });
  w = await W();
  if (w.repairs.lamp && w.lampBurn <= 0 && w.inv.oil > 0 && !w.inv.hasClapper) {
    await bot.use('lamp', STAND.lamp, { night: true });
    rep.check('入夜后可投油点亮壁灯', (await W()).lampBurn > 0);
  }
  const viaGate = w.repairs.gate;
  if (!(await W()).inv.hasClapper) {
    if (viaGate) {
      if (!(await W()).doors.gate) await bot.use('gate', STAND.gateW, { night: true });
      await bot.walkTo(STAND.gateE.x, STAND.gateE.z, { night: true });
      if ((await W()).doors.gate) await bot.use('gate', null, { night: true, expect: false }); // 回手关门
    } else if (!(await W()).doors.chapelFront) await bot.use('chapelFront', STAND.frontOut, { night: true });
    w = await W();
    if (!w.repairs.lamp && w.inv.oil > 0 && w.braziers.chapel <= 0) {
      // 没修壁灯时剩下的那份油用在祭台火盆上
      await bot.use('brazierChapel', STAND.brazierChapel, { night: true });
      const b = await W();
      if (!plan.brazierChecked) { rep.check('投 1 份油点亮祭台火盆', b.braziers.chapel > 0 && b.inv.oil === w.inv.oil - 1, `余 ${Math.round(b.braziers.chapel)} 秒`); plan.brazierChecked = true; }
    }
    await bot.use('chest', STAND.chest, { night: true });
    w = await W();
    rep.check(plan.latePickup ? '晨曦后从祭台匣补取钟舌' : '入夜后从祭台匣取出钟舌', w.inv.hasClapper && w.quest.clapperAt === (plan.latePickup ? 'dawn' : 'night'), `取回时段 ${w.quest.clapperAt}`);
    await samplePerf(page, '去程：门房→祭台', perf);
  }
  if (viaGate && (await W()).player.x > 10.25) {
    await bot.walkTo(STAND.gateE.x, STAND.gateE.z, { night: true });
    if (!(await W()).doors.gate) await bot.use('gate', null, { night: true, expect: false });
    await bot.walkTo(STAND.gateW.x, STAND.gateW.z, { night: true });
  }
  await bot.walkTo(STAND.doorIn.x, STAND.doorIn.z, { night: true });
  await samplePerf(page, '回程：祭台→门房', perf);
  if ((await W()).doors.gatehouse) await bot.use('ghDoor', null, { night: true, expect: false });
  w = await W();
  if (w.repairs.bolt && !w.bolted && !w.doors.gatehouse) {
    await bot.use('bolt', STAND.boltIn, { night: true });
    rep.check('关门后从门房内加闩', (await W()).bolted === true);
  }
  if ((await W()).inv.wood > 0) await bot.use('woodpile', STAND.woodpile, { night: true, expect: false });
  await bot.walkTo(STAND.hearth.x, STAND.hearth.z, { night: true });

  // 守夜：条件满足就在壁炉快进，否则对着进屋的鬼举灯
  const t0 = Date.now();
  let sawReason = '';
  for (;;) {
    const s = await bot.lite();
    if (s.world.phase === 'dawn') break;
    if (await bot.guard(s)) continue;
    if (Date.now() - t0 > 8 * 60 * 1000) throw new Error('守夜超时');
    const p = s.world.player;
    if (p.hp < 60 && s.world.inv.meal > 0) { await bot.eat(); continue; }
    const th = bot.threat(s);
    if (th.chased || th.raise) {
      const near = (x) => Math.hypot(x.x - p.x, x.z - p.z);
      const g = s.world.ghosts.filter((x) => x.mode === 'chase' || x.mode === 'windup' || x.mode === 'alert' || x.mode === 'recoil').sort((a, b) => near(a) - near(b))[0];
      await bot.aim(Math.atan2(g.x - p.x, g.z - p.z), 0.1);
      await bot.setRaise(th.raise);
      await sleep(60);
      continue;
    }
    await bot.setRaise(false);
    if (Math.hypot(p.x - STAND.hearth.x, p.z - STAND.hearth.z) > 0.4) { await bot.walkTo(STAND.hearth.x, STAND.hearth.z, { night: true }); continue; }
    const ok = await bot.use('hearth', null, { night: true, expect: false });
    if (!ok) { const r = (await bot.lite()).target?.reason ?? ''; if (r && !sawReason.includes(r.slice(0, 6))) sawReason += `${r}；`; }
    await sleep(700);
  }
  await bot.stop();
  await samplePerf(page, '守夜：门房', perf);
  w = await W();
  rep.check('晨曦到达，角色存活', w.phase === 'dawn' && w.player.hp > 0, `生命 ${Math.round(w.player.hp)}，快进前的提示：${sawReason || '无'}`);
  await sleep(2300);
  rep.check('晨曦后两只鬼消散', (await W()).ghosts.every((g) => g.mode === 'gone' || g.mode === 'dissolve'));
}

async function dawn(bot, rep) {
  const W = async () => (await bot.lite()).world;
  if ((await W()).bolted) await bot.use('bolt', STAND.boltIn);
  if (!(await W()).doors.gatehouse) await bot.use('ghDoor', STAND.doorIn);
  if (!(await W()).inv.hasClapper && !(await W()).quest.installed) {
    if (!(await W()).doors.chapelFront) await bot.use('chapelFront', STAND.frontOut);
    await bot.use('chest', STAND.chest);
  }
  await bot.use('bell', STAND.bell);
  rep.check('晨曦时装上钟舌', (await W()).quest.installed === true);
  await bot.use('bell', null);
  rep.check('再次交互敲响晨钟', (await W()).quest.rung === true && (await W()).phase === 'ended');
  await bot.waitScreen('ended', 12000);
  const text = await bot.page.evaluate(() => [...document.querySelectorAll('#overlay .panel tr')].map((r) => r.textContent.trim()).join(' ｜ '));
  rep.check('结算界面展示用时、修复、重试与钟舌取回时段', ['用时', '修复', '首夜重试', '钟舌取回'].every((k) => text.includes(k)), text);
  rep.data.settlement = text;
}

async function playthrough(name, { mouseOnly, query, repairs, duskWaitSecs, dayWaitSecs, skip = false, latePickup = false }) {
  console.log(`\n== ${name}：${mouseOnly ? '纯鼠标' : '键鼠'}通关（${query || '发布预设'}），修复 ${repairs.join(' + ')} ==`);
  const rep = new Report(name);
  const { browser, page, errors } = await launch({ channel, headless });
  const perf = [];
  try {
    if (headless) await setInitialQuality(page, 'high');
    await page.goto(`${BASE}?probe=1${query ? `&${query}` : ''}`);
    await ready(page);
    rep.data.gpu = await page.evaluate(() => window.__awProbe.gpu());
    rep.data.preset = (await fullOf(page)).preset;
    rep.data.viewport = page.viewportSize();
    if (mouseOnly) {
      await chooseMouseMode(page);
      rep.check('标题界面用鼠标切到纯鼠标模式', (await titleInfo(page)).text.includes('纯鼠标'));
    }
    const bot = new Bot(page, { mouseOnly });
    rep.data.damageEvents = bot.damageEvents;
    await startNewGame(bot);
    rep.check('点击「开始」后捕获鼠标，这次点击不移动角色', (await liteOf(page)).locked && Math.hypot((await liteOf(page)).world.player.x, (await liteOf(page)).world.player.z + 5.5) < 0.05);
    const plan = { repairs, duskWaitSecs, skip, latePickup, raiseChecked: false };
    await day(bot, rep, plan);
    await bot.waitPhase(['dusk', 'night'], dayWaitSecs);
    rep.check('黄昏起点自动存档', (await liteOf(page)).hasSnapshot === true);
    await shot(page, `browser-${name}-${channel}-dusk.png`);

    const deaths = [];
    for (let attempt = 0; ; attempt++) {
      try { await night(bot, rep, plan, perf); break; } catch (e) {
        const failedScreen = (await liteOf(page)).screen === 'failed';
        if (!(e instanceof BotFailed) && !failedScreen) throw e;
        if (attempt >= 3) throw new Error(`连续 ${attempt + 1} 次守夜失败：${deaths.join('；')}`);
        await bot.resetInputs();
        const why = (await liteOf(page)).world.failReason;
        deaths.push(why);
        console.log(`  · 守夜失败（${why}），点「重试当晚」`);
        await bot.click('重试当晚');
        rep.check(`第 ${attempt + 1} 次重试回到黄昏起点`, (await liteOf(page)).world.phase === 'dusk' && (await liteOf(page)).retries === attempt + 1);
      }
    }
    await shot(page, `browser-${name}-${channel}-dawn.png`);
    await dawn(bot, rep);
    await shot(page, `browser-${name}-${channel}-ended.png`);
    const w = (await liteOf(page)).world;
    rep.check('修复状态与选择方案一致', ['lamp','gate','bolt'].every(id => w.repairs[id] === repairs.includes(id)));
    rep.data.damageEvents = bot.damageEvents;
    rep.data.result = { hp: Math.round(w.player.hp), playedMin: +(w.played / 60).toFixed(1), repairs: w.repairs, retries: (await liteOf(page)).retries, deaths, unexpectedPauses: bot.unexpectedPauses, lockRetries: bot.lockRetries };
    rep.data.nightPerf = { summary: summarize(perf), segments: perf.map(({ slow, ...p }) => p) };
    console.log('  夜间性能：', JSON.stringify(rep.data.nightPerf.summary));
    rep.check('全程控制台无报错', errors.length === 0, errors.join(' | '));
  } catch (e) {
    rep.check('场景跑完', false, e.message);
    await shot(page, `browser-${name}-${channel}-error.png`).catch(() => {});
    rep.data.stateAtError = await liteOf(page).then((s) => ({ screen: s.screen, phase: s.world.phase, player: s.world.player, target: s.target, ghosts: s.world.ghosts.map((g) => ({ kind: g.kind, mode: g.mode, x: +g.x.toFixed(1), z: +g.z.toFixed(1) })) })).catch(() => null);
  }
  rep.save(errors);
  await browser.close();
  return rep;
}

/** A fresh browser context needs no clear/reload that would initialize WebGL twice. */
async function setInitialQuality(page, quality) {
  await page.addInitScript((q) => {
    localStorage.setItem('ashen-watch/settings', JSON.stringify({ mode: 'kbm', sensitivity: 1, brightness: 1, volume: 0.7, quality: q, binds: {} }));
  }, quality);
}

/** Play the whole height loop with mouse/key input. No stage changes or fixed cameras. */
async function routeScenario() {
  const rep = new Report('route');
  const { browser, context, page, errors } = await launch({ channel, headless });
  const viewport = page.viewportSize();
  const quality = process.env.AW_ROUTE_QUALITY ?? (headless ? 'high' : 'cinematic');
  rep.data.viewport = viewport;
  rep.data.quality = quality;
  rep.data.stops = [];
  const perfSegments = [];
  const bot = new Bot(page);
  const walk = (x, z, floor = '1F') => bot.walkTo(x, z, { floor, stop: 0.24, maxSecs: 30 });
  const capture = async (label, floor, yaw, pitch) => {
    await bot.aim(yaw, 0.025, pitch);
    await sleep(300);
    const { world, yaw: aim, locked } = await liteOf(page);
    const { x, y, z, floor: here } = world.player;
    const perf = (await fullOf(page)).perf;
    const camera = await page.evaluate(() => {
      const view = window.__awDev.view;
      return { fixed: !!view.fixedCam, fov: view.camera.fov, position: view.camera.position.toArray() };
    });
    rep.data.stops.push({ label, x, y, z, floor: here, yaw: aim, locked, camera, calls: perf.calls, triangles: perf.triangles });
    rep.check(`${label} — ${floor}`, here === floor && locked && !camera.fixed,
      `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})${!locked || camera.fixed ? ' · 非实时跟随' : ''}`);
    await samplePerf(page, label, perfSegments);
    await shot(page, `route-${label}.png`);
  };
  try {
    await setInitialQuality(page, quality);
    await page.goto(`${BASE}?preset=dev&dayscale=1`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.evaluate(() => window.__awTexReady);
    rep.data.gpu = await page.evaluate(() => window.__awProbe.gpu());
    await page.evaluate(() => { document.getElementById('debug').hidden = true; });
    await startNewGame(bot);
    await doTutorial(bot);
    await bot.use('ghDoor', STAND.doorIn);
    await page.evaluate(() => window.__awProbe.resetPerf());
    await walk(4.0, 9.9);
    await capture('01-cellar-entrance', '1F', Math.PI / 2, 0.4);
    await walk(10.15, 9.9, 'B1');
    await capture('02-cellar-landing', 'B1', -Math.PI / 2, -0.2);
    await bot.use('flask', STAND.flask);
    rep.check('从真实洞口进入 B1 并取得油瓶', (await liteOf(page)).world.taken.flask);
    await walk(15.15, 17.28, 'B1');
    await capture('03-store-stair', 'B1', 0, -0.2);
    await walk(16.8, 21.0);
    await capture('04-chapel-from-cellar', '1F', Math.PI, 0.3);
    await bot.use('chapelFront', STAND.frontIn);
    rep.check('礼拜堂西门从门厅可开', (await liteOf(page)).world.doors.chapelFront);
    await walk(12.55, 16.5);
    await capture('05-chapel-west-door', '1F', Math.PI / 2, 0);
    await bot.use('crate', STAND.crate);
    await bot.use('shelf', STAND.shelf);
    await walk(3.4, 1.4);
    await capture('06-wall-stair-base', '1F', Math.PI / 2, -0.25);
    await walk(9.2, 12, '2F');
    await capture('07-east-walk', '2F', -Math.PI / 3, 0.05);
    await walk(16.1, 21.15, '2F');
    await capture('08-chapel-gallery', '2F', Math.PI / 2, 0.12);
    await repairVia(bot, 'gate', STAND.gateW, 'confirm');
    await bot.use('gate', null);
    await walk(29, 21.15);
    await capture('09-nave-from-gallery', '1F', Math.PI, 0.05);
    await walk(1.45, 1.65);
    await capture('10-return-to-gatehouse', '1F', Math.PI, 0.05);
    rep.check('走过四条楼梯并回到门房门前', (await liteOf(page)).world.repairs.gate);
    rep.check('全程控制台无报错', errors.length === 0, errors.join(' | '));
  } catch (e) {
    rep.check('实走路线完成', false, e.message);
    rep.data.stateAtError = await liteOf(page).then(({world, yaw, screen}) => ({ player: world.player, doors: world.doors, yaw, screen })).catch(() => null);
    await shot(page, 'route-error.png').catch(() => {});
  } finally {
    if (process.env.AW_VIDEO === '1') {
      await context.close().catch(() => {});
      rep.data.video = await page.video()?.path().catch(() => null);
    }
    rep.data.perfSegments = perfSegments.map(({ slow, ...frameStats }) => ({ ...frameStats, slowCount: slow.length }));
    if (perfSegments.length) rep.data.perf = summarize(perfSegments);
    rep.save(errors);
    await browser.close();
  }
  return rep;
}

/** A03：按住前进时切到别的标签页再回来。 */
async function tabScenario() {
  console.log('\n== tab：按住前进时切换标签页（A03） ==');
  const rep = new Report('tab');
  const { browser, context, page, errors } = await launch({ channel, headless });
  try {
    await page.goto(`${BASE}?probe=1`); await ready(page);
    await page.evaluate(() => localStorage.clear()); await page.reload(); await ready(page);
    const bot = new Bot(page);
    await startNewGame(bot);
    await doTutorial(bot);
    await bot.aim(Math.PI); // 朝门房里面走，前方有足够空间
    await page.keyboard.down('KeyW');
    await sleep(500);
    const moving = (await liteOf(page)).world;
    rep.check('按住 W 时角色在移动、白天时钟在走', moving.player.moving && moving.clock > 0, `时钟 ${moving.clock.toFixed(2)} 秒`);
    const other = await context.newPage();
    await other.goto('about:blank'); await other.bringToFront();
    await sleep(700);
    const a = await liteOf(page);
    await sleep(1500);
    const b = await liteOf(page);
    rep.check('切走后鼠标捕获释放并进入暂停界面', a.screen === 'resume' && !a.locked);
    rep.check('离开期间世界计时暂停', b.world.clock === a.world.clock && b.world.played === a.world.played, `时钟停在 ${b.world.clock.toFixed(2)} 秒`);
    rep.check('离开期间角色不动', b.world.player.x === a.world.player.x && b.world.player.z === a.world.player.z);
    await page.bringToFront();
    await clickButton(page, '继续游戏'); // W 键一直没松开
    await waitFor(page, () => window.__awProbe.lite().locked);
    await sleep(900);
    const c = await liteOf(page);
    rep.check('回到游戏后时钟恢复', c.world.clock > b.world.clock);
    rep.check('回来后 W 仍按着也不移动，须重新按下', Math.hypot(c.world.player.x - b.world.player.x, c.world.player.z - b.world.player.z) < 0.01);
    await page.keyboard.up('KeyW'); await page.keyboard.down('KeyW');
    await sleep(600);
    await page.keyboard.up('KeyW');
    const d = await liteOf(page);
    rep.check('重新按下 W 后恢复移动', Math.hypot(d.world.player.x - c.world.player.x, d.world.player.z - c.world.player.z) > 0.3);
    rep.check('全程控制台无报错', errors.length === 0, errors.join(' | '));
  } catch (e) { rep.check('场景跑完', false, e.message); }
  rep.save(errors);
  await browser.close();
  return rep;
}

/** A11 与 A08 的浏览器部分：刷新继续、坏存档、版本不符、禁用存储、重试两次。 */
async function storageScenario() {
  console.log('\n== storage：刷新、无效存档、禁用存储与重试（A08、A11） ==');
  const rep = new Report('storage');
  const FAST = `${BASE}?preset=dev&dayscale=120&probe=1`;
  const kill = (page) => page.evaluate(() => { window.__awDev.session.world.player.hp = 0; }); // 用开发预设摆出失败
  const pick = (w) => JSON.stringify({ inv: w.inv, repairs: w.repairs, taken: w.taken, doors: w.doors, bolted: w.bolted, x: +w.player.x.toFixed(3), z: +w.player.z.toFixed(3), hp: w.player.hp, oil: Math.round(w.lantern.oil) });
  let errorsAll = [];
  {
    const { browser, page, errors } = await launch({ channel, headless });
    errorsAll = errors;
    try {
      await page.goto(FAST); await ready(page);
      await page.evaluate(() => localStorage.clear()); await page.reload(); await ready(page);
      rep.check('没有快照时「继续」不可用', (await titleInfo(page)).continueDisabled === true);
      const bot = new Bot(page);
      await startNewGame(bot);
      await doTutorial(bot);
      await bot.waitPhase(['dusk'], 30);
      const dusk0 = (await liteOf(page)).world;
      rep.check('到达黄昏后写入存档', await page.evaluate(() => JSON.parse(localStorage.getItem('ashen-watch/save')).dusk.phase === 'dusk'));

      // A08：入夜后失败，重试两次。两鬼起点在入夜事件触发的那一步记录（轮询读到时它们已经走了几步）。
      await page.evaluate(() => {
        const s = window.__awDev.session, orig = s.onEvent;
        window.__nightStarts = [];
        s.onEvent = (e) => {
          if (e.kind === 'phase' && e.id === 'night') window.__nightStarts.push(JSON.stringify(s.world.ghosts.map((g) => [g.kind, g.x, g.z, g.yaw, g.mode, g.patrolIdx])));
          orig(e);
        };
      });
      const restored = [];
      for (let i = 0; i < 3; i++) {
        await bot.waitPhase(['night'], 30);
        if (i === 2) break;
        await kill(page);
        await bot.waitScreen('failed');
        await bot.resetInputs();
        rep.check(`第 ${i + 1} 次失败界面提供「重试当晚」和「重开当天」`, await page.evaluate(() => { const t = document.querySelector('#overlay').textContent; return t.includes('重试当晚') && t.includes('重开当天'); }));
        await bot.click('重试当晚');
        const s2 = await liteOf(page);
        restored.push(pick(s2.world));
        rep.check(`第 ${i + 1} 次重试：回到黄昏，重试计数 ${i + 1}`, s2.world.phase === 'dusk' && s2.retries === i + 1);
      }
      rep.check('两次重试恢复出同一黄昏状态', restored.length === 2 && restored[0] === restored[1] && restored[0] === pick(dusk0));
      const nightStarts = await page.evaluate(() => window.__nightStarts);
      rep.check('三次入夜时两鬼起点与巡游状态一致', nightStarts.length === 3 && nightStarts.every((g) => g === nightStarts[0]), nightStarts[0]);

      // A11：刷新后继续
      await page.goto(`${BASE}?probe=1`); await ready(page);
      const t1 = await titleInfo(page);
      rep.check('刷新后标题「继续」可用并显示重试次数', t1.continueDisabled === false && t1.text.includes('已重试 2 次'));
      const bot2 = new Bot(page);
      await bot2.click('继续');
      const cont = await liteOf(page);
      rep.check('「继续」从黄昏起点恢复，不增加重试计数', cont.world.phase === 'dusk' && cont.retries === 2 && pick(cont.world) === pick(dusk0));

      // 损坏的存档
      await page.evaluate(() => localStorage.setItem('ashen-watch/save', '{"version":1,"dusk":{bad'));
      await page.goto(`${BASE}?probe=1`); await ready(page);
      const t2 = await titleInfo(page);
      rep.check('损坏的存档：说明原因，「继续」不可用', t2.text.includes('存档已损坏') && t2.continueDisabled === true);
      // 版本不兼容
      await page.evaluate(() => localStorage.setItem('ashen-watch/save', JSON.stringify({ version: 999, savedAt: '', retries: 0, completed: false, dusk: null })));
      await page.goto(`${BASE}?probe=1`); await ready(page);
      const t3 = await titleInfo(page);
      rep.check('版本不兼容的存档：说明原因，「继续」不可用', t3.text.includes('不兼容') && t3.continueDisabled === true);
      const bot3 = new Bot(page);
      await startNewGame(bot3);
      const fresh = await liteOf(page);
      rep.check('无效存档下可以直接开始新游戏', fresh.mode === 'playing' && fresh.world.phase === 'tutorial' && fresh.locked);
    } catch (e) { rep.check('存档场景跑完', false, e.message); }
    await browser.close();
  }
  {
    // 禁用存储：访问 localStorage 直接抛 SecurityError
    const { browser, context, page, errors } = await launch({ channel, headless });
    try {
      await context.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
      });
      await page.goto(FAST); await ready(page);
      rep.check('禁用存储：标题说明进度不会保留', (await titleInfo(page)).text.includes('浏览器存储不可用'));
      const bot = new Bot(page);
      await startNewGame(bot);
      await doTutorial(bot);
      await bot.waitPhase(['dusk'], 30);
      rep.check('禁用存储：黄昏快照保留在内存中', (await liteOf(page)).hasSnapshot === true);
      await bot.waitPhase(['night'], 30);
      await kill(page);
      await bot.waitScreen('failed');
      await bot.resetInputs();
      await bot.click('重试当晚');
      const s = await liteOf(page);
      rep.check('禁用存储：本次会话仍能重试当晚', s.world.phase === 'dusk' && s.retries === 1 && s.locked);
      rep.check('禁用存储：控制台无报错', errors.length === 0, errors.join(' | '));
    } catch (e) { rep.check('禁用存储场景跑完', false, e.message); }
    errorsAll = errorsAll.concat(errors);
    await browser.close();
  }
  rep.check('存档场景控制台无报错', errorsAll.length === 0, errorsAll.join(' | '));
  rep.save(errorsAll);
  return rep;
}

const matrix = (name, repairs, mouseOnly = false) => playthrough(name, {
  mouseOnly, query: process.env.AW_STEP2_FAST === '1' ? 'preset=dev&timescale=2' : '', repairs, dayWaitSecs: 420, duskWaitSecs: 120, skip: true,
});
const RUN = {
  'step2-late': () => playthrough('step2-late', {mouseOnly:false, query:'preset=dev&dayscale=1&timescale=2', repairs:[], dayWaitSecs:420,duskWaitSecs:120,skip:true,latePickup:true}),
  'step2-lamp-gate': () => matrix('step2-lamp-gate', ['lamp','gate']),
  'step2-lamp-bolt': () => matrix('step2-lamp-bolt', ['lamp','bolt']),
  'step2-gate-bolt': () => matrix('step2-gate-bolt', ['gate','bolt']),
  'step2-none': () => matrix('step2-none', []),
  'step2-mouse': () => matrix('step2-mouse', ['lamp','gate'], true),
  route: routeScenario,
  tab: tabScenario,
  storage: storageScenario,
  // 纯鼠标：开发预设但时钟不加速（只为读探针）。不跳过，让白天、黄昏两段计时自己走完
  mouse: () => playthrough('mouse', { mouseOnly: true, query: 'preset=dev&dayscale=1', repairs: ['lamp', 'gate'], dayWaitSecs: 400, duskWaitSecs: 120 }),
  // 键鼠：发布预设。白天忙完去床铺休息、黄昏在壁炉旁等入夜，夜晚按正常节奏
  kbm: () => playthrough('kbm', { mouseOnly: false, query: '', repairs: ['gate', 'bolt'], dayWaitSecs: 7 * 60, duskWaitSecs: 2 * 60, skip: true }),
};

let failed = 0;
for (const name of scenarios) {
  if (!RUN[name]) { console.error(`未知场景：${name}（可选 ${[...ALL, ...STEP2, 'step2', 'route'].join('、')}）`); process.exit(2); }
  const rep = await RUN[name]();
  failed += rep.failed;
  console.log(`  ${name}：${rep.checks.length - rep.failed}/${rep.checks.length} 项通过，用时 ${Math.round((Date.now() - rep.t0) / 1000)} 秒`);
}
console.log(failed ? `\n有 ${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
