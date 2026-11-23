import { describe, expect, it } from 'vitest';
import { type Group } from 'three';
import { newWorld } from '../src/sim/state';
import { Vfx } from '../src/render/vfx';

const feetAt = (y: number, plantId: number, planted = true) => ({
  left: { x: -4, z: -8, y, plantId, planted },
  right: { x: -3.8, z: -8, y, plantId: 0, planted: true },
});
const visibleRings = (vfx: Vfx) => vfx.group.children.find((node) => (node as Group).isGroup)!.children.filter((node) => node.visible);

describe('foot-contact effects', () => {
  it('places a single ripple at the rendered landing, not at the player root or on every frame', () => {
    const world = newWorld();
    const vfx = new Vfx();
    const dt = 1 / 60;
    vfx.update(world, world.player, dt, feetAt(0, 0));
    vfx.update(world, world.player, dt, feetAt(0, 0, false));
    expect(visibleRings(vfx)).toHaveLength(0);
    vfx.update(world, world.player, dt, feetAt(0, 1));
    vfx.update(world, world.player, dt, feetAt(0, 1));
    const rings = visibleRings(vfx);
    expect(rings).toHaveLength(1);
    expect(rings[0].position.toArray()).toEqual([-4, 0.015, -8]);
  });

  it('never makes a courtyard ripple on the floor above and does not emit on a world reset', () => {
    const world = newWorld();
    const vfx = new Vfx();
    world.player.floor = '2F';
    vfx.update(world, world.player, 0.02, feetAt(4, 0));
    vfx.update(world, world.player, 0.02, feetAt(4, 1));
    const fresh = newWorld();
    vfx.update(fresh, fresh.player, 0.02, feetAt(0, 2));
    expect(visibleRings(vfx)).toHaveLength(0);
  });
});
