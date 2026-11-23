/** Dense only around the playable court. XYZ here are simulation metres (north = +Z).
 * Texels are laid out X,Z,Y; the two banks share one trilinearly filtered 3D texture. */
export const PROBE_GRID = { x: -20.8, z: -2.4, y: 0.12, nx: 45, nz: 55, ny: 11, dx: 0.80, dy: 0.90 } as const;
export const PROBE_COUNT = PROBE_GRID.nx * PROBE_GRID.nz * PROBE_GRID.ny;
