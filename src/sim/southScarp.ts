import type { Box } from './level';

/** Survey sections across the exposed bedrock between the gatehouse and the shelf.
 * Each row measures east position, north extent and the height of its bedding ridge. */
const sections = [
  [-10.04, 4.63, 4.82], [-9.36, 4.42, 4.38], [-8.89, 4.61, 4.49],
  [-8.05, 4.41, 3.97], [-7.58, 4.14, 4.11], [-6.91, 4.25, 3.48],
  [-6.43, 3.81, 3.36], [-5.83, 3.53, 2.67], [-5.29, 3.35, 2.76],
  [-4.95, 2.82, 2.20], [-4.35, 2.44, 1.87], [-4.02, 1.89, 1.38],
  [-3.48, 1.53, 1.22], [-3.12, 1.04, 0.53], [-2.62, 0.53, 0.12],
] as const;

export const SCARP_SECTIONS = sections.map(([x, toe, height], i) => {
  const relief = toe - 0.37;
  const fracture = Math.sin(i * 2.36);
  return [[x, -0.20, toe], [x, height * 0.19, toe - relief * 0.06],
    [x, height * (0.29 + 0.04 * fracture), toe - relief * 0.23],
    [x, height * 0.33, toe - relief * (0.21 + 0.012 * fracture)],
    [x, height * 0.68, toe - relief * (0.34 + 0.035 * fracture)],
    [x, height * 0.73, toe - relief * 0.52], [x, height * 0.79, toe - relief * 0.48],
    [x, height, toe - relief * (0.71 + 0.044 * fracture)], [x, height * 0.91, 0.37]] as [number, number, number][];
});

// Short columns follow the same bedding planes used by the mesh. Use finer
// subdivisions across large breaks to keep the camera close to the sloping face.
export const SCARP_SOLIDS: Box[] = [];
for (let i = 1; i < SCARP_SECTIONS.length; i++) {
  const a = SCARP_SECTIONS[i - 1], b = SCARP_SECTIONS[i];
  for (const t of [0.25, 0.75]) {
    const at = (j: number, k: number) => a[j][k] + t * (b[j][k] - a[j][k]);
    const width = (b[0][0] - a[0][0]) * 0.5;
    for (const [front, back] of [[0, 2], [2, 5], [5, 8]]) {
      SCARP_SOLIDS.push({ x0: at(0,0) - width/2, x1: at(0,0) + width/2,
        z0: at(back,2), z1: at(front,2), h: (at(front+1,1) + at(back,1)) / 2,
        kind: 'wall', los: true, y0: -0.20, tag: 'gateScarp' });
    }
  }
}
