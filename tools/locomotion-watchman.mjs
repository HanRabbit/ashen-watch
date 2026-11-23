// Render locomotion acceptance. Dev stages the initial pose only; the camera,
// travel, sprint/stop, blocking, raising the lantern and turning use real input.
// AW_URL=http://127.0.0.1:4181 AW_OUT=/tmp/watchman AW_ANGLE=metal node tools/locomotion-watchman.mjs [yard|wall|stairs]
import { chromium } from 'playwright-core';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const base = process.env.AW_URL ?? 'http://127.0.0.1:4181';
const out = process.env.AW_OUT ?? '/tmp/watchman-locomotion';
const name = process.argv[2] ?? 'yard';
const spec = {
  yard: { at: [-0.3, 0, 3.2, '1F'], yaw: 0, pitch: 0.2 },
  wall: { at: [-8.8, 0, 19, '1F'], yaw: -Math.PI / 2, pitch: 0.0 },
  stairs: { at: [15.1, -3, 16.25, 'B1'], yaw: 0, pitch: 0.12 },
}[name];
if (!spec) throw Error('Select yard, wall or stairs');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.AW_BROWSER ?? 'chromium', headless: true, args: [
  ...(process.env.AW_ANGLE ? [`--use-angle=${process.env.AW_ANGLE}`] : []), '--autoplay-policy=no-user-gesture-required',
] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, recordVideo: { dir: out, size: { width: 960, height: 540 } } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
let frames = [];
try {
  await page.addInitScript(() => localStorage.setItem('ashen-watch/settings', JSON.stringify({ quality: 'high' })));
  await page.goto(`${base}/?preset=dev&dayscale=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__awDev?.view.player.asset);
  await page.evaluate(async () => { await window.__awTexReady; window.__awDev.fakeLock(true); });
  await page.getByRole('button', { name: '新游戏' }).click();
  await page.getByRole('button', { name: '开始' }).click();
  await page.evaluate(({ at, yaw, pitch }) => {
    const { session, input, view, screens, hud } = window.__awDev;
    const w = session.world;
    const [x, y, z, floor] = at;
    Object.assign(w, { phase: 'day', clock: 190, ghosts: [] });
    Object.assign(w.player, { x, y, z, floor, yaw, pitch });
    Object.assign(w.lantern, { on: true, oil: 300 });
    w.inv.hasLantern = true; w.quest.boardRead = true;
    Object.assign(input, { yaw, pitch });
    screens.closeAll(); hud(false); document.querySelector('#debug').hidden = true;
    if (view.fixedCam) throw Error('Expected ordinary follow camera');
    window.__strideFrames = [];
    window.__strideLabel = 'ready';
    // Observe each completed pose, including actual posed bones; don't drive position or animation.
    const model = view.player;
    const update = model.update.bind(model);
    const point = model.group.position.clone(), socket = model.group.position.clone();
    const up = model.group.position.clone();
    const pelvis = model.asset.bones.hips;
    const round = (v) => +v.toFixed(4);
    model.update = (world, pose, facing, dt, clock) => {
      update(world, pose, facing, dt, clock);
      const pace = model.pace;
      const readback = model.readFootPlants?.();
      const feet = pace.feet.map((f, i) => {
        const ankle = model.asset.bones[i === 0 ? 'footL' : 'footR'];
        // Look at a real boot-space contact marker when available, not only the desired target.
        const sole = i === 0 ? readback?.left : readback?.right;
        return { ...f, ankle: ankle.getWorldPosition(point).toArray().map(round),
          sole: sole ? [sole.x, sole.y, sole.z].map(round) : null,
          apiMatches: !sole || (sole.planted === f.planted && sole.plantId === f.plantId) };
      });
      const core = model.lantern.group.localToWorld(point.set(0, -0.10, 0));
      const heatError = model.lanternLight.getWorldPosition(socket).distanceTo(core);
      window.__strideFrames.push({ label: window.__strideLabel, clock, dt, at: [pose.x, pose.y, pose.z], floor: world.player.floor,
        flameY: core.y, reset: pace.resetThisFrame ?? false,
        pelvis: pelvis.getWorldPosition(socket).toArray().map(round),
        lampAngle: Math.acos(Math.max(-1, Math.min(1, up.set(0, 1, 0).transformDirection(model.lantern.group.matrixWorld).y))),
        yaw: facing, speed: pace.speed, forward: pace.forward, lateral: pace.lateral, run: pace.run,
        moving: world.player.moving, sprint: world.player.sprinting, raise: world.lantern.raised, heatError, feet });
    };
  }, spec);
  const wait = (ms) => page.waitForTimeout(ms);
  const label = (v) => page.evaluate((v) => { window.__strideLabel = v; }, v);
  const shot = (v) => page.screenshot({ path: join(out, `${name}-${v}.png`) });
  const resetFrames = () => page.evaluate(() => { window.__strideFrames.length = 0; });
  const key = (direction, code) => page.keyboard[direction](code);
  const hold = async (code, ms) => { await key('down', code); await wait(ms); await key('up', code); };
  const walk = async (tag, code, ms) => { await label(tag); await hold(code, ms); await label(`${tag}-settle`); };
  await wait(500);
  await resetFrames();
  await shot('idle');
  if (name === 'yard') {
    await label('walk'); await key('down', 'w'); await wait(720); await shot('walk');
    await label('sprint'); await key('down', 'Shift'); await wait(720); await shot('sprint');
    await label('walk-again'); await key('up', 'Shift'); await wait(450);
    await label('stop'); await key('up', 'w'); await wait(760); await shot('stop');
    await walk('left', 'a', 610); await wait(260);
    await walk('right', 'd', 700); await wait(280);
    await walk('back', 's', 700); await wait(280);
    await label('turn'); await page.mouse.move(490, 270); await page.mouse.move(685, 270, {steps: 10}); await wait(350);
    await label('raise'); await page.mouse.down({button:'right'}); await wait(420); await shot('raise'); await label('lower'); await page.mouse.up({button:'right'}); await wait(650);
  } else if (name === 'wall') {
    await label('blocked'); await key('down', 'w'); await wait(1450); await shot('blocked'); await key('up', 'w');
    await walk('slide', 'd', 800);
  } else {
    await label('stairs'); await key('down','w');
    await page.waitForFunction(() => window.__awProbe.lite().world.player.y > -1.65, null, { timeout: 5200 });
    await shot('on-stair');
    await page.waitForFunction(() => window.__awProbe.lite().world.player.z > 21.25, null, { timeout: 5200 });
    await key('up','w'); await wait(350); await shot('landing');
    await label('descent'); await key('down','s');
    await page.waitForFunction(() => window.__awProbe.lite().world.player.y < -1.65, null, { timeout: 5200 });
    await shot('descent');
    await page.waitForFunction(() => window.__awProbe.lite().world.player.z < 17.25, null, { timeout: 5200 });
    await label('bottom'); await key('up','s'); await wait(400);
    await shot('bottom');
  }
  frames = await page.evaluate(() => window.__strideFrames);
  const end = (tag, n = 12) => frames.filter((f) => f.label === tag).slice(-n);
  const assert = (ok, why) => { if (!ok) throw Error(why); };
  assert(!errors.length, errors.join('\n'));
  assert(frames.every((f) => f.heatError < 0.001), 'Lantern light drifted from the candle');
  assert(frames.length > 60, 'Too few pose samples');
  assert(frames.every((f) => f.feet.every((boot) => boot.sole && boot.apiMatches)), 'Rendered foot plant readback missing or stale');
  assert(frames.every((f) => f.lampAngle < 0.24), 'Lantern broke its near-vertical hang');
  let compared = 0, peakStanceSlip = 0, peakSwingRise = 0, peakSoleError = 0;
  const pelvisTravel = [];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].reset || frames[i - 1].label !== frames[i].label) continue;
    pelvisTravel.push(Math.abs(frames[i].pelvis[1] - frames[i - 1].pelvis[1]));
    frames[i].feet.forEach((f, j) => {
      const prior = frames[i - 1].feet[j];
      if (f.planted && f.sole) peakSoleError = Math.max(peakSoleError, Math.abs(f.sole[1] - f.y));
      assert(f.plantId - prior.plantId === Number(f.planted && !prior.planted), 'Plant ID did not follow touchdown');
      if (!prior.planted || !f.planted) {
        peakSwingRise = Math.max(peakSwingRise, Math.abs(f.ankle[1] - prior.ankle[1]));
        return;
      }
      ++compared;
      peakStanceSlip = Math.max(peakStanceSlip, Math.hypot(...f.ankle.map((v, axis) => v - prior.ankle[axis])));
    });
  }
  assert(compared > 45 && peakStanceSlip <= 0.006, `Visible ankle slid ${(peakStanceSlip * 1000).toFixed(1)}mm while planted`);
  assert(peakSoleError < 0.006, 'Planted midsole did not reach target height');
  const status = (tag, fn) => end(tag).length > 2 && end(tag).every(fn);
  if (name === 'yard') {
    assert(status('walk', (f) => f.speed > 1.3 && f.speed < 2.1), 'Walk speed not derived from displacement');
    assert(status('sprint', (f) => f.speed > 2.6 && f.run > 0.5), 'Sprint never reaches the run gait');
    assert(status('stop', (f) => f.speed < 0.05 && f.feet.every((f) => f.planted)), 'Boots did not settle on stop');
    assert(status('left', (f) => f.lateral < -0.9) && status('right', (f) => f.lateral > 0.9), 'Strafe feet not driven by signed lateral direction');
    assert(status('back', (f) => f.forward < -0.9), 'Backpedal not driven by backward displacement');
    assert(Math.abs(end('turn').at(-1).yaw - end('back').at(-1).yaw) > 0.12, 'Mouse did not turn the follow camera');
    assert(end('raise').at(-1)?.raise && !end('lower').at(-1)?.raise, 'Mouse did not raise and lower the lantern');
    assert(end('raise').at(-1).flameY - end('lower').at(-1).flameY > 0.34, 'Raised lantern never reached the ready pose');
  } else if (name === 'wall') {
    assert(status('blocked', (f) => f.moving && f.speed < 0.035 && f.feet.every((f) => f.planted)), 'Character continued stepping against a wall');
  } else {
    assert(frames.some((f) => f.feet[0].planted && Math.abs(f.feet[0].y - f.feet[1].y) > 0.22), 'Both ankles stayed on the same height on the stairs');
    assert(end('stairs').at(-1).floor === '1F', 'Stair climb failed');
    assert(frames.at(-1).floor === 'B1', 'Stair descent failed');
  }
  const p95Pelvis = pelvisTravel.sort((a, b) => a - b)[Math.floor(pelvisTravel.length * 0.95)];
  console.log(`${name}: ${frames.length} poses, ${compared} planted checks, peak ankle slip ${(peakStanceSlip * 1000).toFixed(1)}mm/frame, peak ankle swing height change ${(peakSwingRise * 1000).toFixed(1)}mm/frame, planted sole height error ${(peakSoleError * 1000).toFixed(1)}mm, pelvis p95 ${(p95Pelvis * 1000).toFixed(1)}mm/frame, no browser errors`);
} finally {
  if (!frames.length && !page.isClosed()) frames = await page.evaluate(() => window.__strideFrames ?? []).catch(() => []);
  await writeFile(join(out, `${name}.json`), JSON.stringify({ name, errors, frames }));
  const video = page.video();
  await page.close().catch(() => {});
  if (video) {
    await video.saveAs(join(out, `${name}.webm`));
    await unlink(await video.path());
  }
  await browser.close();
}
