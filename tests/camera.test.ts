import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/render/camera';
import { cameraClearT } from '../src/sim/collision';
import { newWorld } from '../src/sim/state';

describe('over-shoulder camera', () => {
  it('clips a lagging boom when the player crosses a narrow threshold', () => {
    const camera = new PerspectiveCamera(55, 16 / 9, 0.08, 610);
    const rig = new CameraRig(camera);
    const w = newWorld();
    w.doors.gatehouse = true;
    Object.assign(w.player, { x: 0, y: 0, z: -1.1, moving: true });
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.update(w, w.player, 0, 0, dt);
    // Lurch to the side after crossing the gate (including a low frame rate).
    for (let i = 0; i <= 12; i++) {
      w.player.x = i / 12 * -1.3;
      w.player.z = 0.9 + i / 12 * 0.5;
      const d = rig.update(w, w.player, -Math.PI / 2, 0.15, 1 / 30);
      const t = cameraClearT(w.player.x, w.player.z, 1.62,
        camera.position.x, -camera.position.z, camera.position.y, w.doors);
      // The lateral shoulder itself isn't the player pivot, but a valid boom
      // must either remain visible through the door gap or retract to the courtyard.
      expect(t === 1 || -camera.position.z > 0.5).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('2F rampart camera', () => {
  it('retracts inside the parapet instead of shooting over the merlons at the player', () => {
    const camera = new PerspectiveCamera(55, 16 / 9, 0.08, 610);
    const rig = new CameraRig(camera);
    const w = newWorld();
    Object.assign(w.player, { x: 9.2, y: 4, z: 11.83, floor: '2F' });
    for (let i = 0; i < 60; i++) rig.update(w, w.player, -Math.PI / 3, 0.05, 1 / 60);
    expect(camera.position.x).toBeLessThan(10);
  });
});

describe('movement-driven framing', () => {
  const setup = () => {
    const camera = new PerspectiveCamera(55, 16 / 9, 0.08, 610);
    const rig = new CameraRig(camera);
    const w = newWorld();
    Object.assign(w.player, { x: 0, y: 0, z: 13, floor: '1F' });
    rig.update(w, w.player, 0, 0.12, 1 / 60);
    return { camera, rig, w };
  };

  it('does not zoom out merely because the player holds sprint against a wall', () => {
    const { rig, camera, w } = setup();
    const start = camera.position.clone();
    Object.assign(w.player, { moving: true, sprinting: true });
    for (let i = 0; i < 60; i++) rig.update(w, w.player, 0, 0.12, 1 / 60);
    expect(camera.fov).toBeCloseTo(55);
    expect(camera.position.distanceTo(start)).toBeLessThan(0.001);

    for (let i = 0; i < 60; i++) {
      w.player.z += 3.1 / 60;
      rig.update(w, w.player, 0, 0.12, 1 / 60);
    }
    expect(camera.fov).toBeGreaterThan(57.8);
    for (let i = 0; i < 120; i++) rig.update(w, w.player, 0, 0.12, 1 / 60);
    expect(camera.fov).toBeCloseTo(55, 1);
  });

  it('lands on the same held boom target after a long frame or several short frames', () => {
    const held = (steps: number[]) => {
      const { camera, rig, w } = setup();
      w.player.x += 0.48;
      for (const dt of steps) rig.update(w, w.player, 0, 0.12, dt);
      return camera.position.clone();
    };
    expect(held([0.1]).distanceTo(held(Array(12).fill(1 / 120)))).toBeLessThan(0.00001);
  });

  it('returns from a fixed shot without sweeping through the world to the player', () => {
    const { rig, camera, w } = setup();
    const follow = camera.position.clone();
    rig.fixedCam = { pos: [40, 50, 60], look: [0, 0, 0] };
    rig.update(w, w.player, 0, 0.12, 1 / 60);
    expect(camera.position.distanceTo(follow)).toBeGreaterThan(50);
    rig.fixedCam = null;
    rig.update(w, w.player, 0, 0.12, 1 / 60);
    expect(camera.position.distanceTo(follow)).toBeLessThan(0.00001);
  });
});

it('limits a sudden heading change across the yaw seam and converges without a snap', () => {
  const camera = new PerspectiveCamera(55, 16 / 9, .08, 610);
  const rig = new CameraRig(camera), w = newWorld();
  Object.assign(w.player, { x: -2.8, y: 0, z: 17.5, floor: '1F' });
  const dt = 1 / 60;
  rig.update(w, w.player, 2.96, 0, dt);
  const initial = camera.quaternion.clone(), prev = initial.clone();
  for (let i = 0; i < 100; i++) {
    rig.update(w, w.player, -1.2, 0, dt);
    expect(camera.quaternion.angleTo(prev)).toBeLessThan(.12);
    prev.copy(camera.quaternion);
  }
  expect(camera.quaternion.angleTo(initial)).toBeGreaterThan(1.9);
  rig.update(w, w.player, -1.2, 0, dt);
  expect(camera.quaternion.angleTo(prev)).toBeLessThan(.001);
});
