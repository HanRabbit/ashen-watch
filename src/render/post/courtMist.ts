import { BAILEY_GROUND_Y } from '../../sim/baileyApron';
import { WEST_PASSAGES } from '../../sim/courtPlan';
import { YARD_DRAIN } from '../yardWeather';

const southArchMid = (WEST_PASSAGES[0].z0 + WEST_PASSAGES[0].z1) * 0.5;

/** Extra extinction (m^-1), in render world metres; time is in seconds.
 * Conservative support AABB (render XYZ): [-18.3, -0.16, -28.5] to [-1.1, 1.4, -2.0].
 * This is a density term only: the volume owns ray sampling, lighting and transmittance. */
export const COURT_MIST_GLSL = /* glsl */`
float awCourtMistBank(vec2 q, vec2 center, vec2 invRadius, float shear) {
  vec2 d = q - center;
  d.x += shear * d.y;
  d *= invRadius;
  float edge = max(0.0, 1.0 - dot(d, d));
  return edge * edge;
}
float awCourtMistJoin(float a, float b) {
  return a + b * (1.0 - a);
}
float awCourtMistClumps(vec2 q, float time) {
  // One broad octave of value noise, advected 6 cm/s east and 1.8 cm/s south.
  // The terrain and bank envelopes stay put; only the air inside them moves.
  vec2 p = q * vec2(0.34, 0.56) - time * vec2(0.0204, -0.01008);
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 h = fract((cell.x + vec4(0.0, 1.0, 0.0, 1.0)) * 0.1031
               + (cell.y + vec4(0.0, 0.0, 1.0, 1.0)) * 0.31783);
  h = fract(h * (h + 19.19) * (h + 7.17));
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}
float awCourtyardMist(vec3 worldRenderPosition, float time) {
  vec2 q = vec2(worldRenderPosition.x, -worldRenderPosition.z); // level plan: north is +Z
  float y = worldRenderPosition.y;
  if (y <= -0.16 || y >= 1.4 || q.x <= -18.3 || q.x >= -1.1 || q.y <= 2.0 || q.y >= 28.5) return 0.0;

  float bank, grade, ceiling;
  if (q.x < -9.35 && q.y < 14.0) {
    grade = ${BAILEY_GROUND_Y.toFixed(3)}; // The low apron and lower arch meet at the original slab datum.
    ceiling = 1.30;
    if (q.y < 8.0) {
      // Inside the old drum. The second lobe stops short of the flag fan and portal turn.
      float drum = awCourtMistBank(q, vec2(-15.85, 3.95), vec2(0.46, 0.57), -0.40);
      float returnLee = awCourtMistBank(q, vec2(-14.12, 5.92), vec2(0.58, 0.83), 0.20);
      bank = awCourtMistJoin(0.89 * drum, 0.56 * returnLee);
    } else {
      // North shoulder of the low south arch, not across the through-route.
      const float throat = ${southArchMid.toFixed(3)};
      bank = 0.78 * awCourtMistBank(q, vec2(-12.0, throat + 1.05), vec2(0.49, 1.03), 0.40);
      bank *= smoothstep(throat + 0.42, throat + 0.96, q.y)
            * (1.0 - smoothstep(throat + 1.42, throat + 1.60, q.y));
    }
  } else if (q.y > 23.5) {
    // Drain bed and the oblique spill off the wall toe. Stay inside the masonry
    // and west of the two north throats; don't blanket the annex or upper walk.
    const vec2 drain = vec2(${YARD_DRAIN.x.toFixed(3)}, ${YARD_DRAIN.z.toFixed(3)});
    float gutter = awCourtMistBank(q, drain + vec2(-0.09, -0.61), vec2(0.29, 0.67), 0.60);
    float spill = awCourtMistBank(q, drain + vec2(1.86, -2.02), vec2(0.37, 0.63), 0.55);
    bank = awCourtMistJoin(gutter, 0.64 * spill);
    grade = -0.018 - 0.017 * gutter; // Coarse paving datum down to the gutter bed.
    ceiling = 1.40;
    bank *= smoothstep(-10.0, -9.47, q.x) * (1.0 - smoothstep(28.12, 28.5, q.y));
  } else {
    // Wet lane on the work-yard side, in two unequal reaches (wheel and scaffold).
    // Feather into the west service run and the drier gate-to-north cartway.
    float wheel = awCourtMistBank(q, vec2(-3.92, 12.70), vec2(0.43, 0.252), 0.19);
    float scaffold = awCourtMistBank(q, vec2(-5.10, 17.95), vec2(0.39, 0.245), -0.30);
    bank = awCourtMistJoin(0.56 * wheel, 0.73 * scaffold);
    grade = -0.019 - 0.021 * bank; // Centimetre-scale hollow, not flagstone micro-relief.
    ceiling = 1.14;
    float cartAxis = -0.90 + 0.10 * max(q.y - 7.0, 0.0) + 0.95 * smoothstep(13.0, 20.0, q.y);
    bank *= smoothstep(9.1, 10.8, q.y) * (1.0 - smoothstep(-2.1, -0.90, q.x - cartAxis));
  }
  // Don't pay for noise in empty samples. Soft grade entry accommodates slabs/grate
  // offset by a few cm; the compact cap leaves no eye-height haze or deep spill.
  float h = y - grade;
  if (bank <= 0.0 || h <= -0.12 || h >= ceiling) return 0.0;
  float layer = smoothstep(-0.12, 0.06, h) * (1.0 - smoothstep(0.07, ceiling, h));
  float clumps = smoothstep(0.18, 0.84, awCourtMistClumps(q, time));
  return 0.065 * bank * layer * mix(0.40, 1.0, clumps);
}
`;
