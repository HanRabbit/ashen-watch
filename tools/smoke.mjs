// 冒烟：生产构建能否在浏览器里画出画面、捕获鼠标并响应真实的键鼠事件。
import { BASE, clickButton, launch, shot, sleep, state, waitFor } from './lib.mjs';

const channel = process.argv[2] ?? 'chrome';
const headless = process.argv.includes('--headless');
const { browser, page, errors } = await launch({ channel, headless });
await page.goto(`${BASE}?probe=1`);
await waitFor(page, () => window.__awProbe?.state().perf.calls > 0);
await sleep(600);
await shot(page, `smoke-${channel}-title.png`);
const s0 = await state(page);
console.log('title:', { screen: s0.screen, calls: s0.perf.calls, tris: s0.perf.triangles });

await clickButton(page, '新游戏');
await clickButton(page, '开始');
await sleep(500);
const s1 = await state(page);
console.log('after start:', { mode: s1.mode, screen: s1.screen, locked: s1.locked, phase: s1.world.phase });

// 真实鼠标移动应转动镜头；真实按键应移动角色
await page.mouse.move(900, 500);
await page.mouse.move(1000, 520, { steps: 5 });
await sleep(100);
const s2 = await state(page);
console.log('yaw after mouse move:', s1.yaw.toFixed(3), '->', s2.yaw.toFixed(3));
await page.keyboard.down('KeyW');
await sleep(1000);
await page.keyboard.up('KeyW');
const s3 = await state(page);
console.log('pos after W 1s:', [s2.world.player.x.toFixed(2), s2.world.player.z.toFixed(2)], '->', [s3.world.player.x.toFixed(2), s3.world.player.z.toFixed(2)]);
await shot(page, `smoke-${channel}-gatehouse.png`);
console.log('fps:', s3.perf.fps.toFixed(1), 'errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);
