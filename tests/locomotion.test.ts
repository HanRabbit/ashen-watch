import { describe, expect, it } from 'vitest';
import { Bone, Group, Quaternion, Vector3 } from 'three';
import { type FloorHeight, type PacePoint, WatchmanPace } from '../src/render/locomotion';
import { HangingAngle, LimbSolver, supportCeiling } from '../src/render/locomotionRig';

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
    for (const hz of [30, 60, 120]) {
      const { pace, at } = start();
      const dt = 1 / hz;
      const passes: number[] = [];
      for (let i = 0; i < hz * 2; i++) {
        const before = structuredClone(pace.feet);
        drive(pace, at, 0, i >= hz / 2 && i < hz * 1.45 ? 3.1 : 1.8, dt, ground, 0, dt);
        pace.feet.forEach((f, j) => {
          expect(Math.hypot(f.x - before[j].x, f.z - before[j].z)).toBeLessThan(10 * dt + 0.01);
          if (f.planted && !before[j].planted) passes.push(j);
        });
      }
      expect(passes.length).toBeGreaterThan(7);
      expect(passes.length).toBeLessThan(13);
      expect(passes.every((f, i) => i === 0 || passes[i - 1] !== f)).toBe(true);
    }
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
    expect(touchdowns).toBeGreaterThan(5);
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
    for (const direction of [1, -1]) {
      let gained = 0, lastY = at.y;
      for (let i = 0; i < 70; i++) {
        const prior = structuredClone(pace.feet);
        drive(pace, at, 0, direction * 1.8, step, tread);
        pace.feet.forEach((f, j) => {
          if (!f.planted) return;
          expect(f.pitch).toBe(0);
          expect(f.y).toBe(tread(f.x, f.z, at.y));
          if (prior[j].planted) expect(f).toEqual(prior[j]);
          else {
            if (direction * (f.y - lastY) > 0) gained++;
            lastY = f.y;
            expect(tread(f.x, f.z + 0.134, at.y)).toBeLessThanOrEqual(f.y + 0.1);
            expect(Math.abs(f.y - prior[j].y)).toBeLessThan(0.145);
          }
        });
      }
      expect(gained).toBeGreaterThan(2);
    }
  });

  it('keeps the supporting boot on individual treads and discards stale contacts on relocation', () => {
    const { pace, at } = start();
    const tread: FloorHeight = (_x, z) => Math.floor(Math.max(0, z) / 0.27) * 0.17;
    drive(pace, at, 0, 1.8, 1.1, tread);
    pace.feet.filter((f) => f.planted).forEach((f) => expect(f.y).toBe(tread(f.x, f.z, 0)));
    pace.update({ x: 20, y: 4, z: 20 }, Math.PI, step, (_x, _z, y) => y);
    expect(pace.speed).toBe(0);
    expect(pace.feet.every((f) => f.planted && f.y === 4 && f.z === 20)).toBe(true);
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
