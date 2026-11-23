import { describe, expect, it } from 'vitest';
import { Bone, Group, Quaternion, Vector3 } from 'three';
import { type FloorHeight, type PacePoint, WatchmanPace } from '../src/render/locomotion';
import { HangingAngle, LimbSolver, supportCeiling, watchmanFacing, WatchmanRoot } from '../src/render/locomotionRig';
import { inArea, rampY, STAIR_BODIES, STAIRS } from '../src/sim/level';
import { Driver } from './driver';

const ground = () => 0;
const step = 1 / 60;
function drive(pace: WatchmanPace, at: PacePoint, vx: number, vz: number, seconds: number, floor: FloorHeight = ground, yaw = 0, dt = step): void {
  for (let t = 0; t < seconds - dt * 0.25; t += dt) {
    at.x += vx * dt; at.z += vz * dt;
    at.y = floor(at.x, at.z, at.y);
    pace.update(at, yaw, dt, floor);
  }
}

function start(): { pace: WatchmanPace; at: PacePoint } {
  const pace = new WatchmanPace(), at = { x: 0, y: 0, z: 0 };
  pace.update(at, 0, step, ground);
  return { pace, at };
}

describe('displacement-driven watchman', () => {
  it('refuses to march in place and recovers both feet after a sudden stop', () => {
    const { pace, at } = start();
    drive(pace, at, 0, 0, 2);
    expect(pace.speed).toBe(0);
    drive(pace, at, 0, 3.1, 0.72);
    expect(pace.run).toBeGreaterThan(0.8);
    drive(pace, at, 0, 0, 0.9);
    expect(pace.speed).toBeLessThan(0.01);
    expect(pace.feet.every((f) => f.planted && Math.abs(f.z - at.z) < 0.11)).toBe(true);
    const rest = structuredClone(pace.feet);
    drive(pace, at, 0, 0, 1);
    expect(pace.feet).toEqual(rest);
  });

  it('plants in world space and preserves signed travel when strafing and backpedaling', () => {
    const { pace, at } = start();
    for (const [vx, vz] of [[1.8, 0], [-1.8, 0], [0, -1.8], [0, 1.8]]) {
      for (let i = 0; i < 50; i++) {
        const before = structuredClone(pace.feet);
        drive(pace, at, vx, vz, step);
        expect(pace.feet.some((f) => f.planted)).toBe(true);
        pace.feet.forEach((f, j) => { if (f.planted && before[j].planted) expect(f).toEqual(before[j]); });
      }
      expect(pace.lateral).toBeCloseTo(vx, 1);
      expect(pace.forward).toBeCloseTo(vz, 1);
    }
  });

  it('retains swing phase and contact through speed changes independent of frame rate', () => {
    const times: number[][] = [];
    for (const hz of [30, 60, 120]) {
      const { pace, at } = start();
      const dt = 1 / hz;
      const passes: number[] = [], touchdowns: number[] = [];
      for (let i = 0; i < hz * 2; i++) {
        const before = structuredClone(pace.feet);
        drive(pace, at, 0, i >= hz / 2 && i < hz * 1.45 ? 3.1 : 1.8, dt, ground, 0, dt);
        pace.feet.forEach((f, j) => {
          expect(Math.hypot(f.x - before[j].x, f.z - before[j].z)).toBeLessThan(10 * dt + 0.01);
          if (f.planted && !before[j].planted) { passes.push(j); touchdowns.push((i + 1) * dt); }
        });
      }
      expect(passes.length).toBeGreaterThanOrEqual(6);
      expect(passes.length).toBeLessThanOrEqual(8);
      times.push(touchdowns);
      expect(passes.every((f, i) => i === 0 || passes[i - 1] !== f)).toBe(true);
    }
    for (const touchdowns of times.slice(1)) {
      expect(touchdowns).toHaveLength(times[0].length);
      touchdowns.forEach((time, i) => expect(Math.abs(time - times[0][i])).toBeLessThan(0.05));
    }
  });

  it('lengthens the step at sprint speed without matching the speed increase in cadence', () => {
    const intervals = [1.8, 3.1].map((speed) => {
      const { pace, at } = start();
      drive(pace, at, 0, speed, 1);
      const count = () => pace.feet[0].plantId + pace.feet[1].plantId;
      const plants = count();
      drive(pace, at, 0, speed, 6);
      return [speed * 6 / (count() - plants), (count() - plants) / 6];
    });
    expect(intervals[0][0]).toBeGreaterThan(0.50);
    expect(intervals[1][0]).toBeGreaterThan(intervals[0][0] * 1.16);
    expect(intervals[1][1]).toBeGreaterThan(intervals[0][1] * 1.25);
    expect(intervals[1][1]).toBeLessThan(5);
  });

  it('loads a new stance at touchdown and never issues another plant while blocked', () => {
    const { pace, at } = start();
    let touchdowns = 0, doubleSupport = 0;
    for (let i = 0; i < 100; i++) {
      const prior = structuredClone(pace.feet);
      drive(pace, at, 0, 1.8, step);
      pace.feet.forEach((f, j) => {
        const landed = !prior[j].planted && f.planted;
        expect(f.plantId - prior[j].plantId).toBe(Number(landed));
        if (landed) {
          expect(f.pitch).toBe(0);
          expect(pace.compression).toBeGreaterThan(0.35);
          touchdowns++;
        }
      });
      if (pace.feet.every((f) => f.planted)) doubleSupport++;
    }
    expect(touchdowns).toBeGreaterThanOrEqual(5);
    expect(doubleSupport).toBeGreaterThan(touchdowns);
    drive(pace, at, 0, 0, 0.9);
    const rest = structuredClone(pace.feet);
    drive(pace, at, 0, 0, 0.5);
    expect(pace.feet).toEqual(rest);
    expect(Math.abs(pace.support)).toBeLessThan(0.02);
  });

  it('keeps a flat foot level and controls swing on treads in both directions', () => {
    const { pace, at } = start();
    const tread: FloorHeight = (_x, z) => Math.floor((z + 1e-8) / 0.19) * 0.17;
    for (const [direction, yaw] of [[1, 0], [-1, 0], [-1, Math.PI]]) {
      let gained = 0, lastY = at.y;
      for (let i = 0; i < 70; i++) {
        const prior = structuredClone(pace.feet);
        drive(pace, at, 0, direction * 1.8, step, tread, yaw);
        pace.feet.forEach((f, j) => {
          if (!f.planted) return;
          expect(f.pitch).toBe(0);
          expect(f.y).toBe(tread(f.x, f.z, at.y));
          if (prior[j].planted) expect(f).toEqual(prior[j]);
          else {
            if (direction * (f.y - lastY) > 0) gained++;
            lastY = f.y;
            for (const reach of [-0.164, 0.137]) {
              expect(tread(f.x, f.z + Math.cos(f.yaw) * reach, at.y)).toBeLessThanOrEqual(f.y + 0.065);
            }
            expect(Math.abs(f.y - prior[j].y)).toBeLessThan(0.18);
          }
        });
      }
      expect(gained).toBeGreaterThan(2);
    }
  });

  it('does not hold the swing boot on a padded nosing until downhill touchdown', () => {
    const run = STAIRS.find(stair => stair.id === 'S2')!.runs[0];
    const treads = STAIR_BODIES.find(stair => stair.id === 'S2')!.boxes;
    const tread: FloorHeight = (x, z) => treads.find(box => inArea(box, x, z))?.h
      ?? (z < run.z0 ? run.from : run.to);
    const pace = new WatchmanPace(), at = { x: 15.1, y: run.to, z: 21.26 };
    pace.update(at, 0, step, tread);

    let touchdowns = 0, maxDrop = 0;
    for (let i = 0; i < 60; i++) {
      const before = structuredClone(pace.feet);
      // Backpedal without turning: the root follows the continuous ramp,
      // but the boot's toe still clears the discrete, uphill nosing.
      at.z -= 1.8 * step;
      at.y = rampY(run, at.x, at.z);
      pace.update(at, 0, step, tread);
      pace.feet.forEach((f, j) => {
        if (!f.planted) return;
        if (before[j].planted) {
          expect(f).toEqual(before[j]);
        } else if (treads.some(box => inArea(box, f.x, f.z))) {
          expect(f.y).toBe(tread(f.x, f.z, at.y));
          expect(f.plantId).toBe(before[j].plantId + 1);
          maxDrop = Math.max(maxDrop, before[j].y - f.y);
          touchdowns++;
        }
      });
    }
    expect(touchdowns).toBeGreaterThanOrEqual(5);
    // This route produced a ~164 mm final-frame sole drop before the fix.
    // Don't constrain airborne cross-tread movement with this contact metric.
    expect(maxDrop).toBeLessThan(0.09);
  });

  it('seats on a shallow lip under the toe without relocating the plant', () => {
    const { pace, at } = start();
    const flat = structuredClone(pace.feet);
    const lip: FloorHeight = (_x, z) => z > 0.17 ? 0.024 : 0;
    pace.reset();
    pace.update(at, 0, step, lip);
    for (const [i, f] of pace.feet.entries()) {
      expect(lip(f.x, f.z, at.y)).toBe(0);
      expect(f).toEqual({ ...flat[i], y: 0.024 });
    }
    const seated = structuredClone(pace.feet);
    drive(pace, at, 0, 0, 0.3, lip);
    expect(pace.feet).toEqual(seated);
  });

  it('keeps the supporting boot on individual treads and discards stale contacts on relocation', () => {
    const { pace, at } = start();
    const tread: FloorHeight = (_x, z) => Math.floor(Math.max(0, z) / 0.27) * 0.17;
    drive(pace, at, 0, 1.8, 1.1, tread);
    pace.feet.filter((f) => f.planted).forEach((f) => expect(f.y).toBe(tread(f.x, f.z, 0)));
    pace.update({ x: 20, y: 4, z: 20 }, Math.PI, step, (_x, _z, y) => y);
    expect(pace.speed).toBe(0);
    expect(pace.feet.every((f) => f.planted && f.y === 4 && Math.hypot(f.x - 20, f.z - 20) < 0.15)).toBe(true);
  });
});

it('solves an arbitrarily rotated, scaled limb rather than assuming a bone-local hinge axis', () => {
  const root = new Group(), upper = new Bone(), lower = new Bone(), tip = new Bone();
  root.add(upper); upper.add(lower); lower.add(tip);
  root.rotation.set(0.14, 1.3, -0.06); root.scale.setScalar(0.1);
  upper.rotation.set(0.3, 0.4, 0.8);
  lower.rotation.set(-0.18, 0.3, -0.24);
  lower.position.set(1, 4, -0.4); tip.position.set(-0.2, 3.7, 0.4);
  const target = new Vector3(-0.3, -0.51, 0.18);
  const solver = new LimbSolver();
  solver.solve(upper, lower, tip, target, new Vector3(0, 0, -1));
  expect(tip.getWorldPosition(new Vector3()).distanceTo(target)).toBeLessThan(0.001);
  solver.orient(tip, new Quaternion());
  expect(tip.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion())).toBeLessThan(0.001);
});


it('keeps a planted ankle reachable with a knee-flex margin', () => {
  const limit = supportCeiling(0.12, 0.43, 0.91);
  expect(Math.hypot(limit - 0.12, 0.43)).toBeCloseTo(0.898, 6);
  expect(supportCeiling(-0.13, 0.43, 0.91)).toBeCloseTo(limit - 0.25, 6);
});

it('gives the hanging lantern a lagged, frame-rate-independent return', () => {
  const a = new HangingAngle(), b = new HangingAngle();
  const initial = a.update(0.12, step);
  expect(initial).toBeGreaterThan(0);
  expect(initial).toBeLessThan(0.03);
  for (let i = 0; i < 29; i++) a.update(0.12, step);
  for (let i = 0; i < 60; i++) b.update(0.12, step / 2);
  expect(a.value).toBeCloseTo(b.value, 8);
  for (let i = 0; i < 60; i++) a.update(0, step);
  expect(Math.abs(a.value)).toBeLessThan(0.001);
  a.reset();
  expect(a.value).toBe(0);
});


describe('watchman input transitions', () => {
  it('eases the visible root at the real controller’s start, sprint, reverse and release without moving collision', () => {
    const d = new Driver(), root = new WatchmanRoot();
    const p = d.w.player;
    Object.assign(p, { x: -0.3, z: 3.2, y: 0, floor: '1F' });
    root.update(p.x, p.z, step, true);
    function frame(forward: number, sprint = false): { sim: number; visible: number } {
      const z = p.z, shown = root.z;
      d.tick({ forward, sprint });
      root.update(p.x, p.z, step, false);
      expect(Math.hypot(root.x - p.x, root.z - p.z)).toBeLessThanOrEqual(0.08501);
      return { sim: (p.z - z) / step, visible: (root.z - shown) / step };
    }
    const start = frame(1);
    expect(start.sim).toBeCloseTo(1.8, 6);
    expect(start.visible).toBeGreaterThan(0.4);
    expect(start.visible).toBeLessThan(0.8);
    for (let i = 0; i < 20; i++) frame(1);
    const sprint = frame(1, true);
    expect(sprint.sim).toBeCloseTo(3.1, 6);
    expect(sprint.visible).toBeGreaterThan(1.9);
    expect(sprint.visible).toBeLessThan(2.4);
    for (let i = 0; i < 13; i++) frame(1, true);
    const reverse = frame(-1, true);
    expect(reverse.sim).toBeCloseTo(-3.1, 6);
    expect(reverse.visible).toBeGreaterThan(0);
    expect(reverse.visible).toBeLessThan(1.8);
    expect(frame(-1, true).visible).toBeLessThan(0);
    for (let i = 0; i < 9; i++) frame(-1, true);
    const back = frame(-1, true);
    const release = frame(0);
    expect(release.sim).toBe(0);
    expect(Math.abs(release.visible)).toBeLessThan(Math.abs(back.visible));
    for (let i = 0; i < 24; i++) frame(0);
    expect(root.z).toBeCloseTo(p.z, 6);
    root.update(20, -10, step, true);
    expect([root.x, root.z]).toEqual([20, -10]);
  });

  it('keeps root travel and short-arc facing consistent across frame subdivisions', () => {
    const roots = [30, 60, 120].map(hz => {
      const root = new WatchmanRoot();
      let x = 0, z = 0, yaw = Math.PI - 0.06;
      root.update(x, z, 1 / hz, true);
      for (let i = 1; i <= hz; i++) {
        if (i <= hz / 3) z += 1.8 / hz;
        else if (i <= hz * 2 / 3) x += 3.1 / hz;
        root.update(x, z, 1 / hz, false);
        if (i > hz / 3) yaw = watchmanFacing(yaw, Math.PI / 2, 1 / hz);
      }
      return [root.x, root.z, yaw];
    });
    for (const [x, z, yaw] of roots.slice(1)) {
      expect(x).toBeCloseTo(roots[0][0], 8);
      expect(z).toBeCloseTo(roots[0][1], 8);
      expect(yaw).toBeCloseTo(roots[0][2], 8);
    }
    expect(watchmanFacing(Math.PI - 0.042, -Math.PI + 0.042, step)).toBeGreaterThan(Math.PI - 0.042);
    expect(watchmanFacing(0, Math.PI, step)).toBeLessThanOrEqual(12 * step);
  });

  it.each([[1.8, 41], [3.1, 54]])('finishes a live swing smoothly on key release at %s m/s', (speed, frames) => {
    const { pace, at } = start();
    drive(pace, at, 0, speed, step * (frames - 1));
    const before = structuredClone(pace.feet);
    drive(pace, at, 0, speed, step);
    const release = structuredClone(pace.feet), phase = pace.clipPhase;
    expect(release.some(f => !f.planted)).toBe(true);
    drive(pace, at, 0, 0, step);
    // A second difference measures the release's one-frame velocity change,
    // not merely whether both feet eventually returned to their idle stance.
    for (const [i, f] of pace.feet.entries()) {
      expect(Math.hypot(f.x - 2 * release[i].x + before[i].x, f.z - 2 * release[i].z + before[i].z)).toBeLessThan(0.057);
      if (release[i].planted && f.planted) expect(f).toEqual(release[i]);
    }
    const phaseAdvance = (pace.clipPhase - phase + 1) % 1;
    expect(phaseAdvance).toBeGreaterThan(0.007);
    expect(phaseAdvance).toBeLessThan(0.04);
    drive(pace, at, 0, 0, 0.8);
    expect(pace.feet.every(f => f.planted && Math.hypot(f.x - at.x, f.z - at.z) < 0.18)).toBe(true);
  });

  it('replans a mistimed swing across a forward reversal and immediate alternating strafes', () => {
    const { pace, at } = start();
    let velocity = [[0, 0], [0, 0]];
    for (const [frames, x, z] of [[60, 0, 1.8], [47, 0, -1.8], [14, 1.8, 0], [14, -1.8, 0], [24, 0, 1.8]]) {
      for (let n = 0; n < frames; n++) {
        const before = structuredClone(pace.feet);
        drive(pace, at, x, z, step);
        expect(pace.feet.some(f => f.planted)).toBe(true);
        velocity = pace.feet.map((f, i) => {
          if (before[i].planted && f.planted) expect(f).toEqual(before[i]);
          const vx = (f.x - before[i].x) / step, vz = (f.z - before[i].z) / step;
          expect(Math.hypot(vx - velocity[i][0], vz - velocity[i][1])).toBeLessThan(6.5);
          expect(Math.hypot(at.x - f.x + Math.sin(f.yaw) * 0.095, at.z - f.z + Math.cos(f.yaw) * 0.095)).toBeLessThan(0.64);
          return [vx, vz];
        });
      }
    }
  });

  it('leads a sidestep with the outside boot from rest, not a crossed first step', () => {
    for (const direction of [-1, 1]) {
      const { pace, at } = start();
      drive(pace, at, direction * 1.8, 0, step);
      expect(pace.feet[direction < 0 ? 0 : 1].planted).toBe(false);
      expect(pace.feet[direction < 0 ? 1 : 0].planted).toBe(true);
    }
  });
});
