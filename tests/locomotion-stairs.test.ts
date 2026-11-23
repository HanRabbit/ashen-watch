import { expect, it } from 'vitest';
import { type FootContact, type FloorHeight, WATCHMAN_SOLE_FORWARD, WatchmanPace } from '../src/render/locomotion';
import { inArea, STAIR_MASS, STAIRS, supportY } from '../src/sim/level';
import { Driver } from './driver';

const s2 = STAIRS.find(stair => stair.id === 'S2')!.runs[0];
// Mirror the render-side surface selection without constructing a renderer.
const floor: FloorHeight = (x, z, y) => {
  let nearest = y, error = 0.69;
  for (const tread of STAIR_MASS) {
    if (!inArea(tread, x, z)) continue;
    const delta = Math.abs(tread.h - y);
    if (delta < error) { nearest = tread.h; error = delta; }
  }
  if (error < 0.69) return nearest;
  const flat = supportY(x, z, y);
  return flat && Math.abs(flat.y - y) < 0.47 ? flat.y : y;
};

// The rig tracks a sole marker, not the ankle. Include the rendered boot
// offsets measured in the recording so pitch changes also count in the peak.
const ankleY = (f: FootContact, i: number) => f.y + (i === 0 ? 0.1165 : 0.1170) * Math.cos(f.pitch)
  - WATCHMAN_SOLE_FORWARD * Math.sin(f.pitch);
const sole = [[0, 0], [0, 0.137], [-0.048, 0.115], [0.048, 0.115], [-0.063, 0], [0.063, 0],
  [-0.043, -0.148], [0.043, -0.148], [0, -0.164]] as const;

it.each([
  { hz: 30, rise: 0.205, fall: 0.215, upTouch: 0.085, downTouch: 0.165, planar: 10.5 },
  { hz: 60, rise: 0.115, fall: 0.11, upTouch: 0.040, downTouch: 0.085, planar: 11.5 },
  { hz: 120, rise: 0.080, fall: 0.062, upTouch: 0.030, downTouch: 0.043, planar: 14 },
])('keeps the S2 round trip clear with bounded swing and touchdown at $hz Hz', limits => {
  const { hz } = limits, dt = 1 / hz;
  const d = new Driver(), p = d.w.player, pace = new WatchmanPace();
  Object.assign(p, { x: 15.1, y: s2.from, z: 16.25, floor: 'B1' });
  let priorZ = p.z, tick = 0;
  let rise = 0, fall = 0, penetration = 0, peakPlanar = 0;
  const feet = [0, 1].map(() => ({ touchdown: 0, plants: 0 }));
  for (let i = 0; i <= hz * 6.5; i++) {
    const simFrame = i * 60 / hz;
    while (tick < Math.floor(simFrame)) {
      priorZ = p.z;
      d.tick({ forward: tick < 167 ? 1 : tick >= 192 && tick < 326 ? -1 : 0 });
      tick++;
    }
    if (i === hz * 3) {
      expect(p.floor).toBe('1F');
      expect(p.z).toBeCloseTo(21.26, 5);
    }
    // Interpolate XZ between physics ticks as the view does. The pace uses
    // authoritative player Y to select the support layer.
    const z = priorZ + (p.z - priorZ) * (simFrame % 1);
    const descent = tick >= 192;
    const score = feet[+descent];
    const before = pace.feet.map(f => ({ ...f }));
    pace.update({ x: p.x, y: p.y, z }, 0, dt, floor);
    expect(pace.resetThisFrame).toBe(i === 0);
    expect(pace.feet.some(f => f.planted)).toBe(true);
    for (const [j, f] of pace.feet.entries()) {
      if (i > 0) {
        const prev = before[j], dy = ankleY(f, j) - ankleY(prev, j);
        peakPlanar = Math.max(peakPlanar, Math.hypot(f.x - prev.x, f.z - prev.z) / dt);
        if (f.planted && prev.planted) expect(f).toEqual(prev);
        if (!f.planted && !prev.planted) {
          rise = Math.max(rise, dy);
          fall = Math.max(fall, -dy);
        }
        if (f.planted && !prev.planted) {
          expect(f.plantId).toBe(prev.plantId + 1);
          score.touchdown = Math.max(score.touchdown, -dy);
          score.plants++;
        }
      }
      const cos = Math.cos(f.yaw), sin = Math.sin(f.yaw);
      for (const [side, length] of sole) {
        const reach = length * Math.cos(f.pitch);
        const h = floor(f.x + reach * sin + side * cos, f.z + reach * cos - side * sin, p.y);
        penetration = Math.max(penetration, h - (f.y + length * Math.sin(f.pitch)));
      }
    }
  }
  expect(p.floor).toBe('B1');
  expect(p.z).toBeCloseTo(17.24, 5);
  expect(pace.feet.every(f => f.planted && f.y === s2.from)).toBe(true);
  expect(feet[0].plants).toBe(16);
  expect(feet[1].plants).toBeGreaterThanOrEqual(14);
  expect(penetration).toBeLessThan(1e-6);
  expect(peakPlanar).toBeLessThan(limits.planar);
  expect(rise).toBeLessThan(limits.rise);
  expect(fall).toBeLessThan(limits.fall);
  expect(feet[0].touchdown).toBeLessThan(limits.upTouch);
  expect(feet[1].touchdown).toBeLessThan(limits.downTouch);
});
