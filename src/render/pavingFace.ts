// Safe rectangles inside individual photographed stone faces, in GL UV order.
// Exclude joints (also in normal, roughness and AO), with spare pixels for mips.
const raw = [
  [166, 22, 313, 99], [366, 31, 478, 123], [315, 255, 448, 363],
  [479, 179, 580, 262], [419, 404, 555, 546], [134, 280, 220, 362],
  [148, 418, 253, 478], [282, 524, 367, 596], [350, 684, 467, 756],
] as const;
const dressed = [
  [.15, .778, .427, .963], [.481, .783, .765, .963], [.042, .526, .256, .715],
  [.308, .525, .565, .710], [.652, .534, .921, .712], [.14, .273, .404, .469],
  [.465, .270, .735, .466], [.069, .030, .349, .221], [.411, .027, .679, .215],
  [.788, .041, .978, .208],
] as const;

/** Every point within radius stays in its stone's crop, at any rotation. Radius
 * includes the small distance used to unfold crests/side faces into the scan. */
export function pavingFace(repair: boolean, selection: number, angle: number, x: number, z: number, radius: number) {
  let a: number, b: number, c: number, d: number;
  if (repair) [a, b, c, d] = dressed[Math.floor(selection * dressed.length) % dressed.length];
  else {
    const [left, top, right, bottom] = raw[Math.floor(selection * raw.length) % raw.length];
    [a, b, c, d] = [left / 800, 1 - bottom / 800, right / 800, 1 - top / 800];
  }
  const limit = Math.min(c - a, d - b) * .44;
  const density = Math.min(repair ? .35 : .31, limit / Math.max(.04, radius));
  const dx = Math.cos(angle) * density, dz = Math.sin(angle) * density;
  const u = (a + c) * .5, v = (b + d) * .5;
  return { crop: [a, b, c, d] as const, sample: (px: number, pz: number): [number, number] => [
    u + (px - x) * dx - (pz - z) * dz,
    v + (px - x) * dz + (pz - z) * dx,
  ] };
}
