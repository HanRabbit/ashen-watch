// 浏览器公共工具：用本机已安装的 Chrome / Edge 打开构建产物（不下载浏览器）。
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { hardwareArgs, verifyHardware } from './hardware-gpu.mjs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
/** 截图与报告的输出目录。设 AW_OUT 可改到别处，不覆盖 docs/verification 里已有的记录。 */
export const OUT = process.env.AW_OUT ? path.resolve(process.env.AW_OUT) : path.join(ROOT, 'docs', 'verification');
export const BASE = process.env.AW_URL ?? 'http://localhost:4173/';

/** 临时目录放在项目内，避免占用系统盘。 */
const TMP = path.join(ROOT, '.cache', 'tmp');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = TMP;

export async function launch({ channel = 'chrome', headless = false, width = Number(process.env.AW_W) || 1920, height = Number(process.env.AW_H) || 1080 } = {}) {
  const browser = await chromium.launch({
    channel, headless,
    args: [`--window-size=${width},${height + 90}`, '--autoplay-policy=no-user-gesture-required',
      '--disable-features=CalculateNativeWinOcclusion', ...hardwareArgs()],
  });
  const recordVideo = process.env.AW_VIDEO === '1' ? { dir: OUT, size: { width, height } } : undefined;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, recordVideo });
  // 游戏捕获鼠标时会请求原始输入（unadjustedMovement）。自动化浏览器一旦拿到原始输入，
  // 就会收到这台电脑上真实鼠标的移动，把机器人的转向搅乱。这里去掉该选项，只留脚本发出的事件。
  await context.addInitScript(() => {
    const orig = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function () { return orig.call(this); };
  });
  const page = await context.newPage();
  try { await verifyHardware(page); }
  catch (error) { await browser.close(); throw error; }
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  return { browser, context, page, errors };
}

export const state = (page) => page.evaluate(() => window.__awProbe.state());
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  return file;
}

/** 点击界面上文字包含 text 的按钮（真实鼠标点击）。 */
export async function clickButton(page, text) {
  const btn = page.locator('#overlay button', { hasText: text }).first();
  await btn.waitFor({ state: 'visible', timeout: 8000 });
  await btn.click();
}

export async function waitFor(page, fn, timeout = 15000, arg) {
  await page.waitForFunction(fn, arg, { timeout, polling: 50 });
}
