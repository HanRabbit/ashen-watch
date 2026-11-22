// Browser acceptance policy only; never changes the game world.
export function assessThreat(world, rules) {
  const p = world.player;
  let chased = false, raise = false;
  for (const g of world.ghosts) {
    const distance = Math.hypot(g.x - p.x, g.z - p.z);
    const range = rules[g.kind] - 0.5;
    if (g.mode === 'recoil') {
      // Keep the beam through the game's recoil hysteresis until the ghost gives up.
      if (world.lantern.oil > 0 && distance < range + rules.holdMargin) raise = true;
      continue;
    }
    if (!['chase', 'windup', 'alert'].includes(g.mode)) continue;
    chased = true;
    if (world.lantern.oil > 0 && distance < range) raise = true;
  }
  return {chased, raise};
}
