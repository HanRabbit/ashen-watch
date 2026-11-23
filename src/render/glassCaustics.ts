import * as THREE from 'three';
import { AREAS } from '../sim/level';
import { GATEHOUSE_LIGHTS } from './gatehouseWindows';
import { GATEHOUSE_APERTURES } from './probeLighting';

const PANE_NAMES = ['Hearth window quarries', 'Gatehouse rear quarries'] as const;
const REACH = 4.35;
const SEAT_HALF_DEPTH = 0.027;
const MIN_INCIDENCE = 0.24;
const room = AREAS.gatehouse;

interface Arch {
  x: number;
  y: number;
  halfWidth: number;
  spring: number;
  peak: number;
}

interface Portal {
  pane: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshPhysicalMaterial>;
  seat: Arch;
  outside: Arch;
  inside: Arch;
  z: number;
  inward: number;
  outsideZ: number;
  insideZ: number;
  segments: number;
  transmission: number;
  quarries: readonly [count: number, aspect: number, phaseU: number, phaseV: number];
  bars: readonly [number, number];
}

function readPortal(root: THREE.Object3D, index: number): Portal | undefined {
  const object = root.getObjectByName(PANE_NAMES[index]);
  if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshPhysicalMaterial) ||
      !object.material.normalMap || !(object.geometry instanceof THREE.ShapeGeometry)) return;
  const pane: Portal['pane'] = object;
  const { shapes, curveSegments: segments } = pane.geometry.parameters;
  if (Array.isArray(shapes)) return;
  const points = shapes.getPoints(segments);
  pane.updateWorldMatrix(true, false);
  const origin = pane.getWorldPosition(new THREE.Vector3());
  const aperture = GATEHOUSE_LIGHTS[index];
  const halfWidth = Math.max(...points.map(point => point.x));
  const seat: Arch = {
    x: origin.x, y: origin.y, halfWidth,
    spring: Math.max(...points.filter(point => Math.abs(point.x) === halfWidth).map(point => point.y)),
    peak: Math.max(...points.map(point => point.y)),
  };
  // Match the two dressed mouth rings in buildGatehouseLights. The narrower
  // rings come from ShapeGeometry itself. All coordinates here are Three world metres.
  const mouth = (sill: number): Arch => ({
    x: aperture.x, y: aperture.bottom + sill, halfWidth: aperture.width * 0.5,
    spring: aperture.spring - sill, peak: aperture.peak - sill,
  });
  const front = aperture.hearth;
  return {
    pane, seat, z: origin.z, segments, inward: front ? 1 : -1,
    transmission: GATEHOUSE_APERTURES[index + 1].transmission,
    outsideZ: -(front ? aperture.z1 : aperture.z0), insideZ: -(front ? aperture.z0 : aperture.z1),
    outside: mouth(front ? 0.008 : 0.009), inside: mouth(front ? 0.022 : 0.026),
    // Opaque came divisions and inner saddle bars from gatehouseWindows.ts.
    quarries: front ? [4.35, 1.13, 0.19, -0.09] : [5.15, 1.01, -0.13, 0.21],
    bars: front ? [0.34, 0.70] : [0.30, 0.79],
  };
}

const glFloat = (value: number) => value.toFixed(6);
const glVec = (...values: number[]) => `vec${values.length}(${values.map(glFloat).join(', ')})`;
const glArch = ({ x, y, halfWidth, spring, peak }: Arch) =>
  `AwGlassArch(${glVec(x, y)}, ${glVec(halfWidth, spring, peak)})`;

const PORTAL_GLSL = /* glsl */`
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 ) && ( defined( SHADOWMAP_TYPE_VSM ) || defined( SHADOWMAP_TYPE_PCF ) )
uniform int uAwGlassKey;
uniform float uAwGlassBeam;
uniform float uAwGlassShadowBias;
uniform bool uAwGlassShadowReady;
#ifdef SHADOWMAP_TYPE_VSM
uniform sampler2D uAwGlassDepth;
#else
uniform highp sampler2DShadow uAwGlassDepth;
#endif
uniform mat4 uAwGlassShadowMatrix;

float awGlassShadowVisibility(vec4 coord, float bias) {
  vec3 p = coord.xyz / coord.w;
  if (any(lessThanEqual(p, vec3(0.0))) || any(greaterThanEqual(p, vec3(1.0)))) return 0.0;
  #ifdef USE_REVERSED_DEPTH_BUFFER
    p.z -= bias;
  #else
    p.z += bias;
  #endif
  #ifdef SHADOWMAP_TYPE_VSM
    float blocker = textureLod(uAwGlassDepth, p.xy, 0.0).r;
    #ifdef USE_REVERSED_DEPTH_BUFFER
      return step(blocker, p.z);
    #else
      return step(p.z, blocker);
    #endif
  #else
    return smoothstep(0.55, 1.0, texture(uAwGlassDepth, p));
  #endif
}

struct AwGlassArch { vec2 origin; vec3 shape; };

bool awGlassInArch(vec2 xy, AwGlassArch arch, float segments) {
  vec2 p = xy - arch.origin;
  float side = abs(p.x) / arch.shape.x;
  if (side >= 1.0 || p.y <= 0.0 || p.y >= arch.shape.z) return false;
  if (p.y < arch.shape.y) return true;
  // Invert x(t) of archPath and interpolate the same polygon edges as ShapeGeometry.
  float t = floor(sqrt(1.0 - side) * segments) / segments;
  float next = t + 1.0 / segments;
  float along = (1.0-side - t*t) / (next*next - t*t);
  float chord = mix(t*(1.44 - 0.44*t), next*(1.44 - 0.44*next), along);
  return p.y < mix(arch.shape.y, arch.shape.z, chord);
}

bool awGlassClearCames(vec2 xy, vec2 slope, AwGlassArch seat, vec4 quarry) {
  vec2 scale = vec2(0.5 / seat.shape.x, 1.0 / seat.shape.z);
  vec2 uv = (xy - seat.origin) * scale + vec2(0.5, 0.0);
  vec2 divider = vec2(uv.x - uv.y*quarry.y, uv.x + uv.y*quarry.y);
  vec2 distanceToCame = abs(fract(divider*quarry.x - quarry.zw + 0.5) - 0.5) / quarry.x;
  float radius = 0.0035 * length(scale * vec2(1.0, quarry.y));
  vec2 uvSlope = slope * scale;
  return all(greaterThan(distanceToCame,
    radius + 0.006*abs(vec2(uvSlope.x - uvSlope.y*quarry.y, uvSlope.x + uvSlope.y*quarry.y))));
}

bool awGlassClearBars(vec2 xy, vec2 slope, AwGlassArch seat, vec2 bars) {
  float height = xy.y + slope.y * 0.021 - seat.origin.y;
  return all(greaterThan(abs(vec2(height) - bars), vec2(0.008 + 0.006*abs(slope.y))));
}

bool awGlassOpenReveal(vec2 xy, vec2 slope, AwGlassArch seat, AwGlassArch outside,
    AwGlassArch inside, vec4 planes, float segments) {
  return awGlassInArch(xy, seat, segments) &&
    awGlassInArch(xy + planes.z*slope, outside, segments) &&
    awGlassInArch(xy + planes.w*slope, inside, segments) &&
    awGlassInArch(xy - ${glFloat(SEAT_HALF_DEPTH)}*slope, seat, segments) &&
    awGlassInArch(xy + ${glFloat(SEAT_HALF_DEPTH)}*slope, seat, segments);
}

// Exact straight-through transport for the existing key. The coarse sky
// aperture extrudes the narrow seat all the way to both mouths, so it can
// extinguish an oblique ray that actually fits through the splayed reveals.
bool awGlassFlatPath(vec3 point, vec3 towardKey, AwGlassArch seat, AwGlassArch outside,
    AwGlassArch inside, vec4 planes, vec4 quarry, vec2 bars, float segments) {
  float depth = (point.z-planes.x)*planes.y;
  float incidence = -towardKey.z*planes.y;
  if (depth < planes.w + 0.002 || incidence < ${glFloat(MIN_INCIDENCE)}) return false;
  vec2 slope = -towardKey.xy / incidence;
  vec2 xy = point.xy - depth*slope;
  return awGlassOpenReveal(xy, slope, seat, outside, inside, planes, segments) &&
    awGlassClearCames(xy, slope, seat, quarry) && awGlassClearBars(xy, slope, seat, bars);
}

vec2 awGlassSlope(sampler2D waves, vec2 uv, vec2 normalScale, float ior, vec3 inGlass) {
  vec3 wave = textureLod(waves, uv, 0.0).xyz*2.0 - 1.0;
  vec3 outgoing = refract(inGlass, normalize(vec3(normalScale*wave.xy, -wave.z)), ior);
  return outgoing.z > 0.01 ? outgoing.xy / outgoing.z : vec2(1e3);
}

float awGlassGather(vec3 point, vec3 towardKey, AwGlassArch seat, AwGlassArch outside, AwGlassArch inside,
    vec4 planes, vec4 quarry, vec2 bars, sampler2D waves, vec2 normalScale, float ior, float segments, float shadowBias) {
  // pane Z, inward sign, outside and inside distances measured into the room from the pane.
  float depth = (point.z-planes.x)*planes.y;
  float incidence = -towardKey.z*planes.y;
  if (depth < planes.w + 0.002 || depth >= ${glFloat(REACH)} || incidence < ${glFloat(MIN_INCIDENCE)} || towardKey.y <= 0.0) return 0.0;
  vec3 incoming = vec3(-towardKey.xy, incidence);
  vec2 flatSlope = incoming.xy / incidence;
  vec2 centre = point.xy - depth*flatSlope;
  if (!awGlassOpenReveal(centre, flatSlope, seat, outside, inside, planes, segments)) return 0.0;

  // A plane entry face and a locally tilted exit face model a weak prism.
  // Work in the actual quarry UVs. A local Jacobian predicts how a source
  // footprint contracts after free travel at this receiver's depth.
  vec3 inGlass = refract(incoming, vec3(0.0, 0.0, -1.0), 1.0/ior);
  vec2 dimensions = vec2(seat.shape.x*2.0, seat.shape.z);
  vec2 originUV = (centre-seat.origin)/dimensions + vec2(0.5, 0.0);
  vec2 slopeAtCentre = awGlassSlope(waves, originUV, normalScale, ior, inGlass);
  vec2 shift = depth*(slopeAtCentre-flatSlope);
  if (dot(shift, shift) > 0.035) return 0.0;
  vec2 hit = centre - shift;
  if (!awGlassInArch(hit, seat, segments) ||
      !awGlassInArch(hit + planes.z*flatSlope, outside, segments) ||
      !awGlassInArch(hit - ${glFloat(SEAT_HALF_DEPTH)}*flatSlope, seat, segments) ||
      !awGlassClearCames(hit, flatSlope, seat, quarry)) return 0.0;
  vec2 uv = (hit-seat.origin)/dimensions + vec2(0.5, 0.0);
  vec2 slope = awGlassSlope(waves, uv, normalScale, ior, inGlass);
  if (!awGlassInArch(hit + planes.w*slope, inside, segments) ||
      !awGlassInArch(hit + ${glFloat(SEAT_HALF_DEPTH)}*slope, seat, segments) ||
      !awGlassClearBars(hit, slope, seat, bars)) return 0.0;
  vec3 entry = vec3(hit - 0.006*flatSlope, planes.x - 0.006*planes.y);
  float exposed = awGlassShadowVisibility(uAwGlassShadowMatrix*vec4(entry, 1.0), shadowBias);
  if (exposed <= 0.0) return 0.0;

  // Symmetric difference over a finite footprint suppresses subpixel folds.
  float radius = 0.012 + 0.007*depth;
  vec2 dx = vec2(radius / dimensions.x, 0.0), dy = vec2(0.0, radius / dimensions.y);
  vec2 u = vec2(1.0, 0.0) + depth/(2.0*radius) *
    (awGlassSlope(waves, uv+dx, normalScale, ior, inGlass)-awGlassSlope(waves, uv-dx, normalScale, ior, inGlass));
  vec2 v = vec2(0.0, 1.0) + depth/(2.0*radius) *
    (awGlassSlope(waves, uv+dy, normalScale, ior, inGlass)-awGlassSlope(waves, uv-dy, normalScale, ior, inGlass));
  float area = u.x*v.y-u.y*v.x;
  // Regularize the peak at a fold. Unity is the undeformed beam's area.
  float flux = inversesqrt(0.09 + 0.91*area*area) - 1.0;
  float residual = length(hit + depth*(slope-flatSlope) - centre);
  return flux * exposed * (1.0-smoothstep(radius, radius*3.0, residual)) *
    (1.0-smoothstep(3.45, ${glFloat(REACH)}, depth));
}
#endif
`;

function receiverGLSL(portals: readonly Portal[]): string {
  const cases = (body: (args: string, p: Portal, i: number) => string) => portals.map((p, i) => {
    const args = `point, towardKey, ${glArch(p.seat)}, ${glArch(p.outside)}, ${glArch(p.inside)},
      ${glVec(p.z, p.inward, (p.outsideZ-p.z)*p.inward, (p.insideZ-p.z)*p.inward)}, ${glVec(...p.quarries)}, ${glVec(...p.bars)}`;
    return /* glsl */`
    if (towardKey.z*${glFloat(p.inward)} < 0.0) {
      ${body(args, p, i)}
    }
  `;
  }).join('');
  return PORTAL_GLSL + /* glsl */`
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 ) && ( defined( SHADOWMAP_TYPE_VSM ) || defined( SHADOWMAP_TYPE_PCF ) )
${portals.map((_, i) => `uniform sampler2D uAwGlassWaves${i};\nuniform vec2 uAwGlassScale${i};\nuniform float uAwGlassIor${i};`).join('\n')}
bool awGlassInRoom(vec3 point) {
  return point.x >= ${glFloat(room.x0+0.025)} && point.x <= ${glFloat(room.x1-0.025)} &&
         point.z >= ${glFloat(-room.z1)} && point.z <= ${glFloat(-room.z0-0.06)} && point.y >= 0.0 && point.y <= 3.5;
}
float awGlassFlatTransmission(vec3 point, vec3 towardKey) {
  ${cases((args, p) => `return awGlassFlatPath(${args}, ${glFloat(p.segments)}) ? ${glFloat(p.transmission)} : 0.0;`)}
  return 0.0;
}
float awGlassReceiver(vec3 point, vec3 towardKey, float shadowBias) {
  ${cases((args, p, i) => `return awGlassGather(${args}, uAwGlassWaves${i}, uAwGlassScale${i}, uAwGlassIor${i}, ${glFloat(p.segments)}, shadowBias);`)}
  return 0.0;
}
#endif
`;
}

const SKY_OPENING = 'directLight.color *= awKeyOpening(awReceiverP + awGeometricN*0.025, awKey, awRoom);';
const SKY_OPENING_GLSL = /* glsl */`
    float awGateOpening = awKeyOpening(awReceiverP + awGeometricN*0.025, awKey, awRoom);
    #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_VSM ) || defined( SHADOWMAP_TYPE_PCF ) )
    if (awRoom == AW_GATEHOUSE && uAwGlassKey == UNROLLED_LOOP_INDEX && uAwGlassShadowReady &&
        receiveShadow && directLight.visible && dot(nonPerturbedNormal, directLight.direction) > 0.0) {
      vec3 glassPoint = awReceiverP * vec3(1.0, 1.0, -1.0);
      if (awGlassInRoom(glassPoint)) {
        float paneThroughput = awGlassFlatTransmission(glassPoint, awKey * vec3(1.0, 1.0, -1.0));
        // Only restore the authored window path if the real key reaches it.
        // Stock soft directional shadows are still applied below.
        if (paneThroughput > awGateOpening && awGlassShadowVisibility(vDirectionalShadowCoord[ i ], uAwGlassShadowBias) > 0.0) {
          awGateOpening = paneThroughput;
        }
      }
    }
    #endif
    directLight.color *= awGateOpening;
`;

const LIGHT_SHADOW = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
const APPLY_GLSL = /* glsl */`
    #if defined( SHADOWMAP_TYPE_VSM ) || defined( SHADOWMAP_TYPE_PCF )
    if (uAwGlassKey == UNROLLED_LOOP_INDEX && uAwGlassBeam > 0.0 && uAwGlassShadowReady &&
        receiveShadow && directLight.visible && any(greaterThan(directLight.color, vec3(0.0))) &&
        dot(nonPerturbedNormal, directLight.direction) > 0.0) {
      vec3 point = (-vViewPosition - viewMatrix[3].xyz) * mat3(viewMatrix);
      if (awGlassInRoom(point)) {
        float bias = directionalLightShadow.shadowBias;
        float visibility = awGlassShadowVisibility(vDirectionalShadowCoord[ i ], bias);
        if (visibility > 0.0) {
          vec3 towardKey = transformDirectionByInverseViewMatrix(directLight.direction, viewMatrix);
          float flux = awGlassReceiver(point, towardKey, bias * 0.25);
          directLight.color *= 1.0 + uAwGlassBeam*flux*visibility;
        }
      }
    }
    #endif
`;

function excludeKeyShadow(pane: THREE.Mesh, key: THREE.DirectionalLight): () => void {
  const before = pane.onBeforeShadow, after = pane.onAfterShadow;
  let saved: { depth: boolean; color: boolean } | undefined;
  const suppress: typeof before = function (this: THREE.Mesh, ...args) {
    before.apply(this, args);
    const [, , , shadowCamera, , material] = args;
    if (shadowCamera !== key.shadow.camera) return;
    saved = { depth: material.depthWrite, color: material.colorWrite };
    material.depthWrite = material.colorWrite = false;
  };
  const restore: typeof after = function (this: THREE.Mesh, ...args) {
    const [, , , shadowCamera, , material] = args;
    if (shadowCamera === key.shadow.camera && saved) {
      material.depthWrite = saved.depth;
      material.colorWrite = saved.color;
      saved = undefined;
    }
    after.apply(this, args);
  };
  pane.onBeforeShadow = suppress;
  pane.onAfterShadow = restore;
  return () => {
    if (pane.onBeforeShadow === suppress) pane.onBeforeShadow = before;
    if (pane.onAfterShadow === restore) pane.onAfterShadow = after;
  };
}

/** Three r187 writes horizontal VSM moments back into the depth-bearing
 * source target. Preserve the geometric depth attachment during that one
 * clear and fullscreen draw; the RG moments and other shadows are unchanged. */
function preserveKeyVSMDepth(renderer: THREE.WebGLRenderer, key: THREE.DirectionalLight) {
  const shadowMap = renderer.shadowMap;
  const render = shadowMap.render;
  let preserved: THREE.DepthTexture | null = null;
  const wrapped: typeof render = function (this: typeof shadowMap, ...args) {
    if (this.type !== THREE.VSMShadowMap) return render.apply(this, args);
    const clear = renderer.clear, draw = renderer.renderBufferDirect;
    let verticalDone = false;
    renderer.clear = function (color = true, depth = true, stencil = true) {
      const isKeyTarget = key.shadow.map !== null && renderer.getRenderTarget() === key.shadow.map;
      if (isKeyTarget && !verticalDone) preserved = null;
      clear.call(this, color, depth && !(isKeyTarget && verticalDone), stencil);
    };
    renderer.renderBufferDirect = function (...drawArgs) {
      const material = drawArgs[3] as THREE.ShaderMaterial;
      const { map, mapPass } = key.shadow;
      const target = renderer.getRenderTarget();
      if (!material.isShaderMaterial || material.defines.VSM_SAMPLES === undefined ||
          !map?.depthTexture || !mapPass) return draw.apply(this, drawArgs);
      const input = material.uniforms.shadow_pass?.value;
      if (target === mapPass && input === map.depthTexture && !material.defines.HORIZONTAL_PASS) {
        draw.apply(this, drawArgs);
        verticalDone = true;
      } else if (verticalDone && target === map && input === mapPass.texture && material.defines.HORIZONTAL_PASS) {
        const { depthTest, depthWrite } = material;
        material.depthTest = material.depthWrite = false;
        try {
          draw.apply(this, drawArgs);
          preserved = map.depthTexture;
        } finally {
          material.depthTest = depthTest;
          material.depthWrite = depthWrite;
          verticalDone = false;
        }
      } else draw.apply(this, drawArgs);
    };
    try { render.apply(this, args); }
    finally {
      renderer.clear = clear;
      renderer.renderBufferDirect = draw;
    }
  };
  shadowMap.render = wrapped;
  return {
    hasDepth: (depth: THREE.DepthTexture) => depth === preserved,
    dispose() { if (shadowMap.render === wrapped) shadowMap.render = render; },
  };
}

export interface GlassCaustics {
  enabled: boolean;
  /** Fraction of the live directional key still in a coherent beam (0–1). */
  beamFraction: number;
  dispose(): void;
}

const installed = new WeakMap<THREE.Scene, GlassCaustics>();

/** Install once after the finished level and its live sky key have been added to the scene. */
export function installGlassCaustics(scene: THREE.Scene, level: THREE.Object3D, key: THREE.DirectionalLight): GlassCaustics {
  const prior = installed.get(scene);
  if (prior) return prior;
  const portals = PANE_NAMES.map((_, i) => readPortal(level, i)).filter((p): p is Portal => !!p);
  const begin = THREE.ShaderChunk.lights_fragment_begin;
  if (!portals.length || !begin.includes(LIGHT_SHADOW)) {
    return { enabled: false, beamFraction: 0, dispose() {} };
  }

  const uniforms: Record<string, THREE.IUniform> = {
    uAwGlassKey: { value: -1 }, uAwGlassBeam: { value: 0 },
    uAwGlassShadowBias: { value: key.shadow.bias },
    uAwGlassShadowReady: { value: false }, uAwGlassDepth: { value: null },
    uAwGlassShadowMatrix: { value: key.shadow.matrix },
  };
  for (const [i, { pane }] of portals.entries()) {
    uniforms[`uAwGlassWaves${i}`] = { value: pane.material.normalMap };
    uniforms[`uAwGlassScale${i}`] = { value: pane.material.normalScale };
    uniforms[`uAwGlassIor${i}`] = { value: pane.material.ior };
  }
  const receiver = receiverGLSL(portals);
  const portalKey = portals.map(({ z, seat }) => [z, seat.x, seat.y, seat.peak]).flat().join(',');
  const patched = new Map<THREE.Material, THREE.Material>();
  const depthHooks = new Map<THREE.WebGLRenderer, ReturnType<typeof preserveKeyVSMDepth>>();
  const bindings: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; bound: THREE.Material | THREE.Material[] }[] = [];
  function bind(original: THREE.Material): THREE.Material {
    if (!(original instanceof THREE.MeshStandardMaterial) || original.transparent) return original;
    const previous = patched.get(original);
    if (previous) return previous;
    const material = original.clone();
    material.userData = original.userData;
    let sourceVersion = original.version;
    const compile = original.onBeforeCompile;
    material.onBeforeRender = function (renderer, ...args) {
      // Scan maps are installed asynchronously on the source material.
      if (original.version !== sourceVersion) {
        sourceVersion = original.version;
        material.copy(original);
        material.userData = original.userData;
        material.needsUpdate = true;
      }
      original.onBeforeRender.call(this, renderer, ...args);
      // Shadow targets are allocated inside WebGLRenderer.render, after Scene.onBeforeRender.
      const depth = key.shadow.map?.depthTexture;
      const vsm = renderer.shadowMap.type === THREE.VSMShadowMap;
      uniforms.uAwGlassShadowReady.value = !!depth && (vsm
        ? depth.compareFunction === null && depthHooks.get(renderer)?.hasDepth(depth) === true
        : depth.compareFunction !== null);
      uniforms.uAwGlassDepth.value = uniforms.uAwGlassShadowReady.value ? depth : null;
    };
    material.onBeforeCompile = function (shader, renderer) {
      compile.call(this, shader, renderer);
      const chunk = THREE.ShaderChunk.lights_fragment_begin;
      if (!shader.fragmentShader.includes('#include <lights_fragment_begin>') || !chunk.includes(LIGHT_SHADOW)) return;
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>',
        chunk.replace(SKY_OPENING, SKY_OPENING_GLSL).replace(LIGHT_SHADOW, LIGHT_SHADOW + APPLY_GLSL));
      shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',
        '#include <shadowmap_pars_fragment>\n' + receiver);
    };
    material.customProgramCacheKey = () => original.customProgramCacheKey() + '|aw-glass-caustics:' + portalKey;
    patched.set(original, material);
    return material;
  }

  // Coarse CPU cull of receiver batches. The shader clips the same batches
  // again in world space, before any refraction or texture fetch.
  const zones = portals.map(p => new THREE.Box3(
    new THREE.Vector3(room.x0, 0, Math.min(p.insideZ, p.z+p.inward*REACH)),
    new THREE.Vector3(room.x1, 3.5, Math.max(p.insideZ, p.z+p.inward*REACH)),
  ));
  level.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  level.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.receiveShadow) return;
    const { geometry, material: original } = object;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    bounds.copy(geometry.boundingBox!).applyMatrix4(object.matrixWorld);
    if (!zones.some(zone => zone.intersectsBox(bounds))) return;
    const bound = Array.isArray(original) ? original.map(bind) : bind(original);
    if (Array.isArray(bound) ? bound.every((m, i) => m === (original as THREE.Material[])[i]) : bound === original) return;
    object.material = bound;
    bindings.push({ mesh: object, original, bound });
  });

  // r187 includes VSM receivers in shadow maps even with castShadow off.
  // Do not let transparent glazing write depth into the chosen directional map.
  const restorePanes = portals.map(({ pane }) => excludeKeyShadow(pane, key));
  const beforeRender = scene.onBeforeRender;
  const update: typeof beforeRender = function (this: THREE.Scene, ...args) {
    beforeRender.apply(this, args);
    const [renderer, , camera] = args;
    if (renderer.shadowMap.type === THREE.VSMShadowMap && typeof renderer.shadowMap.render === 'function' && !depthHooks.has(renderer)) {
      depthHooks.set(renderer, preserveKeyVSMDepth(renderer, key));
    }
    uniforms.uAwGlassKey.value = -1;
    uniforms.uAwGlassBeam.value = 0;
    if (!renderer.shadowMap.enabled || !key.castShadow ||
        !(key.intensity > 0) || !key.layers.test(camera.layers)) return;
    let index = 0;
    // r187's stable light sort puts shadow casters first. DirectionalLights
    // have no map slot in the project. Other light types have separate arrays.
    scene.traverseVisible(object => {
      if (uniforms.uAwGlassKey.value >= 0 || !(object instanceof THREE.DirectionalLight) ||
          !object.castShadow || !object.layers.test(camera.layers)) return;
      if (object === key) uniforms.uAwGlassKey.value = index;
      index++;
    });
    uniforms.uAwGlassShadowBias.value = key.shadow.bias;
    // Keep straight-through transport the same on both sides of the A/B.
    if (uniforms.uAwGlassKey.value >= 0 && handle.enabled && handle.beamFraction > 0) {
      uniforms.uAwGlassBeam.value = 0.85 * Math.min(handle.beamFraction, 1);
    }
  };
  const handle: GlassCaustics = {
    enabled: true, beamFraction: 0.30,
    dispose() {
      if (installed.get(scene) !== handle) return;
      installed.delete(scene);
      handle.enabled = false;
      uniforms.uAwGlassKey.value = -1;
      if (scene.onBeforeRender === update) scene.onBeforeRender = beforeRender;
      for (const { mesh, original, bound } of bindings) if (mesh.material === bound) mesh.material = original;
      restorePanes.forEach(restore => restore());
      for (const hook of depthHooks.values()) hook.dispose();
      depthHooks.clear();
      for (const material of patched.values()) material.dispose();
    },
  };
  scene.onBeforeRender = update;
  installed.set(scene, handle);
  return handle;
}
