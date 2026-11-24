import * as THREE from 'three';
import { retainKeyVSMDepth } from './keyShadowDepth';

// The rig supplies the effective sky-key half angle, not the decorative
// sprite radius. Keep the cap at 24 cm (~8 texels in the 2048 site map).
const SKY_KEY_DISK = {
  radiusCap: 0.24,
  // Three opposite pairs on an evenly spaced, rotated hexagon. Fixed in
  // shadow space rather than rotated per screen pixel; no temporal noise.
  filterPairs: [[0.8500, 0.2278], [0.2278, 0.8500], [-0.6223, 0.6223]],
} as const;

const diskState = new Float32Array([-1, 0, 0, 0]); // slot, depth span × tan(half angle), X/Y metres per texel
// Unlike a JS array or a Texture, Three's built-in uniform cloning retains
// this array-like object by reference. Its sampler-array uploader reads
// length and indexed entries; no per-material hook or cloned depth texture.
const depthSlot = { 0: null as THREE.DepthTexture | null, length: 1 };
const DISK_UNIFORMS = {
  uAwDiskState: { value: diskState },
  uAwDiskDepth: { value: depthSlot },
};
const STOCK_KEY_SHADOW = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
const gl = (value: number) => value.toFixed(6);

const DISK_GLSL = /* glsl */`
#if defined( STANDARD ) && defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_VSM ) && NUM_DIR_LIGHT_SHADOWS > 0
uniform vec4 uAwDiskState;
uniform highp sampler2D uAwDiskDepth[1];
const float awDiskCap = ${gl(SKY_KEY_DISK.radiusCap)};

// Derive receiver-plane depth per shadow texel from the biased vertex
// position. Otherwise neighbouring samples on sloping ground can look
// like blockers (particularly with the low dusk key).
vec3 awDiskGradient(vec3 q, vec2 size) {
  vec3 p = vec3(q.xy * size, q.z);
  vec3 dx = dFdx(p), dy = dFdy(p);
  float det = dx.x*dy.y - dx.y*dy.x;
  if (abs(det) <= 0.0001 * max(length(dx.xy)*length(dy.xy), 1e-8)) return vec3(0.0);
  return vec3(vec2(dx.z*dy.y - dx.y*dy.z, dx.x*dy.z - dx.z*dy.x) / det, 1.0);
}

struct AwDiskReceiver {
  vec2 texel;
  vec2 slope;
  ivec2 size;
  float rawZ;
  float biasedZ;
};

// Nonnegative = blocked by this raw depth sample. Return the penumbra
// radius in metres: axial distance × tan(half angle), not a depth ratio.
float awDiskTap(AwDiskReceiver r, ivec2 ij) {
  ij = clamp(ij, ivec2(0), r.size - 1);
  float depth = texelFetch(uAwDiskDepth[0], ij, 0).r;
  float plane = r.biasedZ + dot(r.slope, vec2(ij) - r.texel);
  #ifdef USE_REVERSED_DEPTH_BUFFER
    return depth > plane ? max(0.0, depth - r.rawZ) * uAwDiskState.y : -1.0;
  #else
    return depth < plane ? max(0.0, r.rawZ - depth) * uAwDiskState.y : -1.0;
  #endif
}

vec4 awDiskQuad(AwDiskReceiver r, ivec2 ij) {
  return vec4(awDiskTap(r, ij), awDiskTap(r, ij + ivec2(1, 0)),
              awDiskTap(r, ij + ivec2(0, 1)), awDiskTap(r, ij + ivec2(1, 1)));
}

float awDiskBilinear(vec4 gaps, vec2 f) {
  // Compare first, interpolate visibility second. Filtering raw depths
  // instead would move the silhouette between receiver and caster.
  vec4 lit = vec4(1.0) - step(vec4(0.0), gaps);
  return mix(mix(lit.x, lit.y, f.x), mix(lit.z, lit.w, f.x), f.y);
}

float awDiskPCF(AwDiskReceiver r, vec2 tap) {
  return awDiskBilinear(awDiskQuad(r, ivec2(floor(tap))), fract(tap));
}

float awDiskVisibility(vec3 q, vec3 grad, float bias) {
  if (any(lessThan(q, vec3(0.0))) || any(greaterThan(q, vec3(1.0)))) return 1.0;
  ivec2 size = textureSize(uAwDiskDepth[0], 0);
  vec2 texel = q.xy * vec2(size) - 0.5;
  #ifdef USE_REVERSED_DEPTH_BUFFER
    float biasedZ = q.z - bias;
  #else
    float biasedZ = q.z + bias;
  #endif
  AwDiskReceiver r = AwDiskReceiver(texel, grad.xy, size, q.z, biasedZ);
  vec4 local = awDiskQuad(r, ivec2(floor(texel)));
  float centre = awDiskBilinear(local, fract(texel));
  if (grad.z == 0.0) return centre; // unstable grazing receiver plane

  // Use the closest confirmed caster, not a moment or average. A distant
  // roof in the search window must not open the contact shadow of a foot.
  vec4 candidate = mix(vec4(1e6), local, step(vec4(0.0), local));
  float blockerRadius = min(min(candidate.x, candidate.y), min(candidate.z, candidate.w));
  vec2 metres = uAwDiskState.zw;
  if (blockerRadius <= 0.75 * min(metres.x, metres.y)) return centre;

  // Probe both the lit and the occluded sides of the edge. The search box
  // encloses the capped disk even on a diagonal. Thin remote silhouettes
  // can still fall between these sparse probes; the central PCF survives.
  ivec2 origin = ivec2(floor(texel + 0.5));
  ivec2 reach = ivec2(ceil(vec2(awDiskCap) / metres));
  int blocked = 0;
  for (int y = -1; y <= 1; ++y) for (int x = -1; x <= 1; ++x) {
    if (x == 0 && y == 0) continue;
    float gap = awDiskTap(r, origin + ivec2(x, y) * reach);
    if (gap >= 0.0) {
      blockerRadius = min(blockerRadius, gap);
      blocked++;
    }
  }
  if ((blocked == 0 && centre == 1.0) || (blocked == 8 && centre == 0.0)) return centre;
  vec2 radius = min(awDiskCap, blockerRadius) / metres;
  float penumbra = smoothstep(0.75, 1.5, max(radius.x, radius.y));
  if (penumbra <= 0.0) return centre;

  float sum = centre;
  ${SKY_KEY_DISK.filterPairs.map(([x, y], i) => /* glsl */`
  vec2 off${i} = radius * vec2(${gl(x)}, ${gl(y)});
  sum += awDiskPCF(r, texel + off${i}) + awDiskPCF(r, texel - off${i});`).join('')}
  return mix(centre, sum / 7.0, penumbra);
}
#endif
`;

function installDiskShader(): boolean {
  if (THREE.ShaderChunk.shadowmap_pars_fragment.includes('float awDiskVisibility(')) return true;
  const lights = THREE.ShaderChunk.lights_fragment_begin;
  if (!lights.includes(STOCK_KEY_SHADOW)) return false;
  THREE.ShaderChunk.shadowmap_pars_fragment += DISK_GLSL;
  // Keep the stock statement as the fallback and as glassCaustics' insertion
  // anchor. An existing glass multiplier appended there runs in both paths.
  THREE.ShaderChunk.lights_fragment_begin = lights.replace(STOCK_KEY_SHADOW, /* glsl */`
    #if defined( STANDARD ) && defined( SHADOWMAP_TYPE_VSM )
    if (uAwDiskState.x == float(UNROLLED_LOOP_INDEX)) {
      vec4 shadowCoord = vDirectionalShadowCoord[ i ];
      vec3 q = shadowCoord.xyz / shadowCoord.w;
      // Uniform branch: derivatives precede per-fragment visibility tests.
      vec3 grad = awDiskGradient(q, directionalLightShadow.shadowMapSize);
      if (directLight.visible && receiveShadow && any(greaterThan(directLight.color, vec3(0.0)))) {
        float visibility = awDiskVisibility(q, grad, directionalLightShadow.shadowBias);
        directLight.color *= mix(1.0, visibility, directionalLightShadow.shadowIntensity);
      }
    } else
    #endif
    ${STOCK_KEY_SHADOW}`);
  for (const shader of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) Object.assign(shader.uniforms, DISK_UNIFORMS);
  return true;
}

function unstageDisk() {
  diskState[0] = -1;
  depthSlot[0] = null;
}

/** Stage the raw attachment after Three allocates/updates it and before
 * opaque lit draws. PCF tiers, other scenes/lights and unverified targets
 * retain Three's stock shadow path. */
export function installSkyKeyDiskShadow(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, key: THREE.DirectionalLight, diskTan: () => number,
): () => void {
  if (!installDiskShader()) return () => {};
  const lease = retainKeyVSMDepth(renderer, key, (lights, renderedScene) => {
    unstageDisk();
    if (renderedScene !== scene || !(key.intensity > 0)) return;
    const depth = lease.getDepth();
    if (!depth) return;
    let index = 0;
    for (const light of lights) {
      if (light === key) {
        // r187 stable-sorts shadow casters first; DirectionalLight has no
        // projected map slot. Other light types use their own shadow arrays.
        const { camera, map } = key.shadow;
        if (!map) return;
        depthSlot[0] = depth;
        diskState[0] = index;
        diskState[1] = (camera.far - camera.near) * diskTan();
        diskState[2] = (camera.right - camera.left) / map.width;
        diskState[3] = (camera.top - camera.bottom) / map.height;
        return;
      }
      if ((light as THREE.DirectionalLight).isDirectionalLight) index++;
    }
  });
  const prior = scene.onAfterRender;
  const after: typeof prior = function (this: THREE.Scene, ...args) {
    if (args[0] === renderer) unstageDisk();
    prior.apply(this, args);
  };
  scene.onAfterRender = after;
  return () => {
    unstageDisk();
    if (scene.onAfterRender === after) scene.onAfterRender = prior;
    lease.dispose();
  };
}
