import { AREAS, WELL } from '../sim/level';

/** Survey in level coordinates. The north gutter carries wall-walk runoff past the old wall stub. */
export const YARD_DRAIN = { x: -7.16, z: 27.94, length: 1.20, width: 0.27 } as const;

// World directions are (x, -z). GLSL values are metres, irrespective of scan UV/geometry splits.
export const YARD_WEATHER_GLSL = /* glsl */`
float awEllipse(vec2 p, vec2 origin, vec2 invAxes) {
  return length((p - origin) * invAxes);
}
// x = dressed flagstones, y = traffic, z = wall-foot sediment, w = retained rainwater.
vec4 awYardSurface(vec2 p) {
  vec2 q = vec2(p.x, -p.y);
  float brokenEdge = awNoise(p * 1.75 + 28.0) - 0.5;
  // The oldest dressed runs connect the gatehouse threshold to the chapel, and
  // then to the north walk landing. The open work yard has rougher pitch-ins.
  float east = smoothstep(5.0, 20.0, q.y);
  float treadAxis = mix(-0.45, 4.0, east) - 0.65 * smoothstep(21.0, 28.0, q.y);
  float mainRun = abs(q.x - treadAxis);
  float chapelRun = abs(q.y - (15.05 + (q.x - 4.8) * 0.28));
  float spur = smoothstep(4.7, 6.0, q.x) * (1.0 - smoothstep(0.60, 1.58, chapelRun));
  float traffic = max((1.0 - smoothstep(0.48, 2.0, mainRun)), spur);
  float laid = max(1.0 - smoothstep(1.40, 2.32, mainRun + brokenEdge * 0.95),
                  smoothstep(4.5, 6.3, q.x) * (1.0 - smoothstep(0.94, 1.88, chapelRun + brokenEdge * 0.8)));
  // A second crew relaid blocks by the leaky well curb and inside the north lane.
  float well = awEllipse(q, vec2(${WELL.x.toFixed(2)}, ${WELL.z.toFixed(2)}) + vec2(-0.18, 0.26), vec2(0.51, 0.39));
  float north = awEllipse(q, vec2(-4.5, 26.7), vec2(0.22, 0.61));
  laid = max(laid, (1.0 - smoothstep(0.75, 1.10, north + brokenEdge * 0.46)) * 0.94);
  laid = max(laid, (1.0 - smoothstep(0.83, 1.12, well + brokenEdge * 0.48)) * 0.86);

  const float westWall = ${AREAS.courtyard.x0.toFixed(2)}, eastWall = ${AREAS.courtyard.x1.toFixed(2)};
  const float southWall = ${AREAS.courtyard.z0.toFixed(2)}, northWall = ${AREAS.courtyard.z1.toFixed(2)};
  // No east wall under the chapel arcade; the buildup breaks at the gatehouse opening.
  float openEast = smoothstep(10.90, 11.55, q.y) * (1.0 - smoothstep(21.35, 22.03, q.y));
  float openSouth = 1.0 - smoothstep(0.8, 1.15, abs(q.x));
  float rim = min(min(q.x - westWall, eastWall - q.x + 2.0 * openEast),
                  min(q.y - southWall + 2.0 * openSouth, northWall - q.y));
  float depositExtent = mix(0.20, 0.68, awFbm(p * 0.55 + vec2(71.3, 14.5)));
  float sediment = (1.0 - smoothstep(0.05, depositExtent, rim + 0.18 * brokenEdge)) * (1.0 - 0.90 * traffic);
  float soak = 1.0 - smoothstep(0.28, 1.27, rim + brokenEdge * 0.42);
  float apron = 1.0 - smoothstep(0.45, 1.24, well + brokenEdge * 0.38);
  float gutter = 1.0 - smoothstep(0.18, 1.0, awEllipse(q, vec2(${YARD_DRAIN.x.toFixed(2)}, ${YARD_DRAIN.z.toFixed(2)}), vec2(0.45, 1.45)) + brokenEdge * 0.41);
  float rain = max(max(soak * 0.66, apron * 0.68), gutter) * (1.0 - 0.28 * traffic);
  return vec4(laid, traffic, sediment, rain);
}
`;

/** Local deposits measured in metres, not another tiling pattern on every floor.
 * Evaluate only for the yard substrate and sheltered interior floor variants. */
export const FLOOR_HISTORY_GLSL = /* glsl */`
#ifdef AW_FLOOR_HISTORY
uniform sampler2D uAwHumus;
float awMudCover;
float awSoilBay(vec2 q, vec2 centre, vec2 axis, vec2 invRadius, float erode) {
  vec2 d = q - centre;
  vec2 rot = vec2(dot(d, axis), dot(d, vec2(-axis.y, axis.x)));
  return 1.0 - smoothstep(0.52, 1.12, length(rot * invRadius) + erode);
}
vec3 awDeposit(vec2 q, vec4 yard, float grain, float pocket) {
  float rag = (grain - 0.49) * 0.92;
#if AW_FLOOR_HISTORY == 1
  // Saturated apron fans below the scaffold and cart, with two broken wheel tracks that
  // follow the loaded cart's axle. The worn high points disappear first under boots.
  float apron = max(awSoilBay(q, vec2(-6.87,17.54), vec2(.94,.342), vec2(.33,.64), rag),
                    awSoilBay(q, vec2(-3.95,8.83), vec2(.98,-.199), vec2(.30,.72), rag));
  float toe = awSoilBay(q, vec2(2.78,12.86), vec2(.72,.694), vec2(.40,.48), rag);
  float wash = max(awSoilBay(q, vec2(-6.50,26.03), vec2(.951,.309), vec2(.24,.52), rag),
                   awSoilBay(q, vec2(7.36,22.60), vec2(.79,-.613), vec2(.50,.58), rag));
  float wheelZ = 8.92 + .18 * (q.x + 3.5) + .08 * sin(q.x * 1.6);
  float rails = 1.0 - smoothstep(.06, .235, abs(abs(q.y - wheelZ) - .55) + rag * .11);
  float wheel = rails * smoothstep(-7.7,-5.9,q.x) * (1.0 - smoothstep(-1.0,1.20,q.x));
  // Water mixes clay into a long, broken tongue below the loaded wheel; the
  // sheltered margin holds detritus while the centre of the main lane stays worn.
  float tail = awSoilBay(q, vec2(-2.38,10.20), vec2(.86,.51), vec2(.33,1.28), rag);
  float hollow = max(max(apron, wash), max(max(yard.z, toe * .86), tail * .88));
  float mottled = smoothstep(.29,.64,grain + .11 * sin(q.x * 2.0 - q.y * .75));
  float mat = hollow * (.57 + .51 * mottled) + wheel * (.55 + .29 * mottled);
  float seams = pocket * (.13 + .38 * grain + .46 * hollow) * (1.0 - .64 * yard.y);
  float mud = clamp(max(mat * (1.0 - .46 * yard.y), seams), 0.0, .97);
  return vec3(mud, max(wheel * .67,hollow * .62), clamp(wash + yard.z + toe * .73,0.0,1.0));
#elif AW_FLOOR_HISTORY == 3
  // The open gable collects washed-in leaf mould. Keep the centre of the worn
  // passage visible where feet turn around the cross-wall into the north room.
  float lee = awSoilBay(q, vec2(-16.55,23.78), vec2(.96,.28), vec2(.37,.68),rag);
  float pocketAtKnee = awSoilBay(q, vec2(-16.91,17.70), vec2(.43,.903), vec2(.60,.91),rag);
  float scree = awSoilBay(q, vec2(-14.66,14.62), vec2(.20,.980), vec2(.48,1.13),rag);
  float deposit = max(lee, max(pocketAtKnee, scree));
  float cover = deposit * (.61 + .64 * grain) + pocket * (.17 + deposit * .32);
  return vec3(min(.98, cover), deposit * .69, lee + .46 * pocketAtKnee);
#else
  // Tracked-in earth fans from the gatehouse and west chapel portals; only dry dust
  // gathers behind the pews/against interior edges, not outdoor moss or rainwater.
  float mat = awSoilBay(q, vec2(.08,-.45), vec2(.12,-.993), vec2(.43,.93), rag) * .83;
  mat = max(mat, awSoilBay(q,vec2(14.33,16.52), vec2(1,0), vec2(.50,.87),rag) * .87);
  float ash = awSoilBay(q,vec2(-2.19,-4.55),vec2(.48,.877),vec2(.67,1.02),rag);
  float bench = awSoilBay(q,vec2(21.87,13.9),vec2(.985,.174),vec2(.27,.72),rag);
  float cover = max(mat * (.38 + .52 * grain), max(ash * .60,bench * .54) * (.30 + .70 * grain));
  return vec3(max(cover, pocket * (.12 + .25 * grain + .40 * cover)), mat * .34, 0.0);
#endif
}
#endif
`;
