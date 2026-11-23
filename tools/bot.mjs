// 浏览器里的机器人玩家：只读探针决定往哪走，操作全部是真实的键鼠事件（PRD 第 7 节的验收方式）。
// 走位逻辑与 tests/driver.ts 的无头驱动一致，站位表也取自那里。
import { clickButton, sleep } from './lib.mjs';
import { assessThreat } from './threat.mjs';

/** 站位：从这些点对准对应交互点时一定在 2 m 内且无遮挡（同 tests/driver.ts）。 */
export const STAND = {
  lantern: { x: 0.9, z: -5.6 },
  board: { x: 1.9, z: -1.6 },
  refuel: { x: 1.4, z: -4.5 },
  hearth: { x: -1.3, z: -4.4 },
  pot: { x: -1.5, z: -2.0 },
  woodpile: { x: -1.3, z: -6.3 },
  doorIn: { x: -0.2, z: -1.0 },
  doorOut: { x: -0.2, z: 1.4 },
  boltIn: { x: 0.4, z: -1.1 },
  bell: { x: 1.4, z: 1.5 },
  shelf: { x: -8.2, z: 6.2 },
  lamp: { x: -5, z: 27.4 },
  gateW: { x: 23.2, z: 21.15 },
  gateE: { x: 24.6, z: 21.15 },
  crate: { x: 12.1, z: 19.4 },
  frontOut: { x: 12.6, z: 16.5 },
  frontIn: { x: 14.4, z: 16.5 },
  flask: { x: 15.8, z: 13.0 },
  chest: { x: 27.6, z: 16.5 },
  cot: { x: 0.6, z: -6.5 },
  brazierChapel: { x: 26.2, z: 18.5 },
  brazierSide: { x: -9.2, z: 15.2 },
  s1Top: { x: 4.0, z: 9.9 },
  s2Top: { x: 16.8, z: 21.0 },
  s3Bot: { x: 3.4, z: 1.4 },
  s4Bot: { x: 29.0, z: 21.2 },
};

/** 每像素转过的弧度（src/input.ts 的 BASE_SENS，灵敏度为默认值 1）。 */
const K = 0.0023;
const PITCH = 0.1;
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/** 角色倒下：由上层决定重试当晚还是终止。 */
export class BotFailed extends Error {}

export class Bot {
  constructor(page, { mouseOnly = false } = {}) {
    this.page = page;
    this.mouseOnly = mouseOnly;
    const { width, height } = page.viewportSize();
    this.centerX = width / 2; this.centerY = height / 2;
    this.mx = this.centerX; this.my = this.centerY;
    this.fwd = false; this.sprint = false; this.raise = false; this.raiseAt = 0;
    this.unexpectedPauses = 0;
    this.lockRetries = 0;
    this.interacts = [];
    this.damageEvents = []; this.history = []; this.lastHp = null;
  }

  async init() {
    this.interacts = await this.page.evaluate(() => window.__awProbe.interacts());
    this.rules = await this.page.evaluate(() => window.__awProbe.rules());
  }

  async lite() {
    const s = await this.page.evaluate(() => window.__awProbe.lite());
    const w = s.world;
    const sample = { played: w.played, clock: w.clock, phase: w.phase, hp: w.player.hp,
      x: w.player.x, z: w.player.z, oil: w.lantern.oil, raised: w.lantern.raised,
      holdingRight: this.raise, screen: s.screen,
      ghosts: w.ghosts.map(g => ({kind:g.kind, mode:g.mode, distance:Math.hypot(g.x-w.player.x,g.z-w.player.z), lightT:g.lightT, cowed:g.cowed})) };
    if (this.lastHp !== null && w.player.hp < this.lastHp) this.damageEvents.push({before:this.lastHp, after:w.player.hp, recent:[...this.history, sample]});
    this.lastHp = w.player.hp;
    this.history.push(sample);
    if (this.history.length > 40) this.history.shift();
    return s;
  }

  // —— 输入 ——

  async setForward(on) {
    if (on === this.fwd) return;
    this.fwd = on;
    if (this.mouseOnly) await (on ? this.page.mouse.down({ button: 'left' }) : this.page.mouse.up({ button: 'left' }));
    else await (on ? this.page.keyboard.down('KeyW') : this.page.keyboard.up('KeyW'));
  }

  async setSprint(on) {
    if (on === this.sprint) return;
    this.sprint = on;
    if (this.mouseOnly) await this.page.mouse.wheel(0, on ? -120 : 120);
    else await (on ? this.page.keyboard.down('ShiftLeft') : this.page.keyboard.up('ShiftLeft'));
  }

  async setRaise(on) {
    if (on === this.raise) return;
    // 纯鼠标：右键不足 250 ms 松开会被当成交互，举灯至少按住 400 ms。
    if (!on && this.mouseOnly) {
      const held = Date.now() - this.raiseAt;
      if (held < 400) await sleep(400 - held);
    }
    this.raise = on;
    if (on) this.raiseAt = Date.now();
    await (on ? this.page.mouse.down({ button: 'right' }) : this.page.mouse.up({ button: 'right' }));
  }

  async stop() {
    await this.setForward(false);
    await this.setRaise(false);
    await this.setSprint(false);
  }

  /** 界面打开时游戏已清掉连续输入：这里把按着的键松开，让两边状态一致。 */
  async resetInputs() {
    if (this.fwd) await (this.mouseOnly ? this.page.mouse.up({ button: 'left' }) : this.page.keyboard.up('KeyW'));
    if (this.raise) await this.page.mouse.up({ button: 'right' });
    if (this.sprint && !this.mouseOnly) await this.page.keyboard.up('ShiftLeft');
    this.fwd = this.sprint = this.raise = false;
  }

  async pressInteract() {
    if (this.mouseOnly) {
      await this.setRaise(false);
      await this.page.mouse.down({ button: 'right' });
      await sleep(30);
      await this.page.mouse.up({ button: 'right' });
    } else await this.page.keyboard.press('KeyE');
  }

  /** 点界面按钮。之后把鼠标放回已知位置，转向用闭环校正。 */
  async click(text, { expectLock = true } = {}) {
    await this.resetInputs();
    for (let i = 0; ; i++) {
      await clickButton(this.page, text);
      await this.page.mouse.move(this.centerX, this.centerY);
      this.mx = this.centerX; this.my = this.centerY;
      if (!expectLock) return;
      try {
        await this.page.waitForFunction(() => window.__awProbe.lite().locked, null, { timeout: 2500, polling: 50 });
        return;
      } catch (e) {
        // 浏览器拒绝捕获时游戏留在暂停界面并允许重试（PRD 9.3）：稍等再点一次「继续游戏」。
        if (i >= 3) throw new Error(`点击「${text}」后未能捕获鼠标`);
        this.lockRetries++;
        text = '继续游戏';
        await sleep(1500);
      }
    }
  }

  async waitScreen(id, timeout = 6000) {
    await this.page.waitForFunction((want) => window.__awProbe.lite().screen === want, id, { timeout, polling: 50 });
  }

  /** 纯鼠标：中键打开工具栏后点按钮。键鼠：直接按键。 */
  async toolbar(text) {
    await this.stop();
    await this.page.mouse.down({ button: 'middle' });
    await this.page.mouse.up({ button: 'middle' });
    await this.waitScreen('toolbar');
    await this.click(text);
  }

  async toggleLantern() {
    if (this.mouseOnly) await this.toolbar('提灯：');
    else await this.page.keyboard.press('KeyF');
    await sleep(120);
  }

  async eat() {
    if (this.mouseOnly) await this.toolbar('热食');
    else await this.page.keyboard.press('KeyH');
    await sleep(120);
  }

  // —— 转向与走位 ——

  async nudge(ey, ep) {
    // 鼠标被捕获后只看位移量，坐标可以走出视口。
    this.mx += ey / K; this.my += ep / K;
    await this.page.mouse.move(this.mx, this.my);
  }

  async aim(yaw, tol = 0.02, pitch = PITCH) {
    for (let i = 0; i < 10; i++) {
      const s = await this.lite();
      const ey = wrap(yaw - s.yaw), ep = pitch - s.pitch;
      if (Math.abs(ey) < tol && Math.abs(ep) < 0.05) return;
      await this.nudge(ey, ep);
      await sleep(20);
    }
  }

  /** 失败界面抛 BotFailed；意外的暂停（窗口失焦）点「继续游戏」。返回 true 表示处理过界面。 */
  async guard(s) {
    if (s.screen === 'failed') {
      await this.resetInputs();
      throw new BotFailed(s.world.failReason || '守夜失败');
    }
    if (s.screen === 'resume') {
      this.unexpectedPauses++;
      await this.click('继续游戏');
      return true;
    }
    return false;
  }

  /** 是否被追、是否该举灯（同 tests/playthrough.test.ts，只是不查视线）。 */
  threat(s) {
    return assessThreat(s.world, this.rules);
  }

  /** 沿导航图走到某点附近。night 为 true 时被追就冲刺、鬼近身就举灯。 */
  async walkTo(x, z, { stop = 0.3, sprint = false, night = false, maxSecs = 150, floor } = {}) {
    const t0 = Date.now();
    let path = null, n = 0, mark = null, markAt = Date.now();
    try {
      for (;;) {
        if (Date.now() - t0 > maxSecs * 1000) throw new Error(`walkTo(${x}, ${z}) 超时`);
        const s = await this.lite();
        if (await this.guard(s)) { path = null; markAt = Date.now(); continue; }
        if (s.screen) throw new Error(`走位时出现意外界面：${s.screen}`);
        if (s.world.phase === 'ended') return;
        const p = s.world.player;
        if (Math.hypot(p.x - x, p.z - z) <= stop && (!floor || p.floor === floor)) return;
        if (!path || n % 6 === 0) {
          path = await this.page.evaluate(([a, b, f]) => window.__awProbe.path(a, b, f ?? undefined), [x, z, floor ?? null]);
          if (!path || !path.length) throw new Error(`从 (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) 到 (${x}, ${z}) 没有路径`);
        }
        n++;
        const wp = path.find((q) => Math.hypot(q.x - p.x, q.z - p.z) > 0.35) ?? path[path.length - 1];
        const err = wrap(Math.atan2(wp.x - p.x, wp.z - p.z) - s.yaw);
        await this.nudge(err, PITCH - s.pitch);
        const th = night ? this.threat(s) : { chased: false, raise: false };
        await this.setRaise(th.raise);
        await this.setSprint(sprint || th.chased);
        await this.setForward(Math.abs(err) < 0.6);
        // 停滞保护
        if (!mark || Math.hypot(p.x - mark.x, p.z - mark.z) > 0.2) { mark = { x: p.x, z: p.z }; markAt = Date.now(); }
        else if (Date.now() - markAt > 6000) throw new Error(`卡在 (${p.x.toFixed(2)}, ${p.z.toFixed(2)})，目标 (${x}, ${z})`);
        await sleep(35);
      }
    } finally {
      await this.setForward(false);
    }
  }

  /** 走到站位、对准交互点并交互一次。返回当时准星是否命中该目标且可用。 */
  async use(id, stand, { night = false, sprint = false, expect = true } = {}) {
    const it = this.interacts.find((i) => i.id === id);
    if (stand) await this.walkTo(stand.x, stand.z, { night, sprint, floor: it.floor });
    await this.setForward(false);
    let s = await this.lite();
    for (let i = 0; i < 3; i++) {
      await this.guard(s);
      await this.aim(Math.atan2(it.x - s.world.player.x, it.z - s.world.player.z));
      await sleep(70); // 等一个模拟步，角色朝向跟上镜头
      s = await this.lite();
      if (!s.screen) break;
    }
    const ok = !!s.target && s.target.id === id && s.target.enabled;
    if (!ok && expect) {
      const p = s.world.player;
      throw new Error(`交互 ${id} 不可用：目标 ${JSON.stringify(s.target)}，位置 (${p.x.toFixed(2)}, ${p.z.toFixed(2)})，阶段 ${s.world.phase}`);
    }
    await this.pressInteract();
    await sleep(140);
    return ok;
  }

  /** 原地等到某几个阶段之一。期间处理失败与意外暂停。 */
  async waitPhase(phases, maxSecs) {
    const t0 = Date.now();
    for (;;) {
      const s = await this.lite();
      if (phases.includes(s.world.phase)) return s;
      await this.guard(s);
      if (Date.now() - t0 > maxSecs * 1000) throw new Error(`等待阶段 ${phases.join('/')} 超时（当前 ${s.world.phase}）`);
      await sleep(200);
    }
  }
}

/** 标题界面切到纯鼠标（只用鼠标点击）。 */
export async function chooseMouseMode(page) {
  await clickButton(page, '设置');
  await clickButton(page, '纯鼠标');
  await clickButton(page, '完成');
}

/** 标题 → 新游戏 → 亮度校准 → 开始。 */
export async function startNewGame(bot) {
  await clickButton(bot.page, '新游戏');
  await bot.click('开始');
  await bot.init();
}

/** 教学：拾提灯、看任务板并收起。 */
export async function doTutorial(bot) {
  await bot.use('lantern', STAND.lantern);
  await bot.use('board', STAND.board);
  await bot.waitScreen('board');
  await bot.click('收起任务板');
}
