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
