// World-local sky visibility approximation: a surface under a roof receives masonry bounce,
// not the full hemisphere or a sharp reflection of open sky. Fire/lantern lighting is separate.
import * as THREE from 'three';
import { AREAS, type Rect } from '../sim/level';
import { COURT_TRANSPORT_GLSL, loadCourtTransport } from './probeLighting';

let installed = false;

export function installSkyExposure(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.common += /* glsl */`
#if defined( STANDARD )
  varying vec3 vAwExposurePosition;
#endif
`;
  const world = THREE.ShaderChunk.worldpos_vertex;
  THREE.ShaderChunk.worldpos_vertex = world.replace('#if defined( USE_ENVMAP )', '#if defined( STANDARD ) || defined( USE_ENVMAP )') + /* glsl */`
#if defined( STANDARD )
  vAwExposurePosition = worldPosition.xyz * vec3( 1.0, 1.0, -1.0 );
#endif
`;
  const { gatehouse, chapel } = AREAS;
  const room = ({ x0, x1, z0, z1 }: Rect) => `vec4(${x0.toFixed(2)}, ${z0.toFixed(2)}, ${x1.toFixed(2)}, ${z1.toFixed(2)})`;
  THREE.ShaderChunk.lights_pars_begin += /* glsl */`
#if defined( STANDARD )
  ${COURT_TRANSPORT_GLSL}
  uniform vec2 uAwPortal;
  uniform vec3 uAwPortalIrradiance;
  float awCovered( vec2 p, vec4 room ) {
    vec2 d = min( p - room.xy, room.zw - p );
    return smoothstep( -0.19, 0.20, min( d.x, d.y ) );
  }
  vec3 awSkyExposure( vec3 p ) {
    // Diffuse portal spread is wider further inside; it is not a bright decal on the floor.
    float gateDepth = max(0.0, -p.z);
    float chapelDepth = max(0.0, p.x - 13.5);
    float gateSpill = exp2(-gateDepth * 0.83) * (1.0 - smoothstep(0.55, 1.32 + 0.55 * gateDepth, abs(p.x)));
    float chapelSpill = exp2(-chapelDepth * 0.48) * (1.0 - smoothstep(0.75, 1.65 + 0.56 * chapelDepth, abs(p.z - 16.5)));
    float gatehouse = awCovered(p.xz, ${room(gatehouse)}) * (1.0 - smoothstep(3.45, 4.55, p.y));
    float chapel = awCovered(p.xz, ${room(chapel)}) * (1.0 - smoothstep(7.1, 10.3, p.y));
    float belowGrade = 1.0 - smoothstep(-1.7, -0.15, p.y);
    float shelter = max(belowGrade * 0.96, max(gatehouse, chapel));
    float loss = max(belowGrade * 0.74, max(gatehouse * (0.55 - 0.34 * uAwPortal.x * gateSpill),
                                          chapel * (0.51 - 0.31 * uAwPortal.y * chapelSpill)));
    return vec3(1.0 - loss, shelter, chapel);
  }
  float awOpeningIrradiance(vec3 p, vec3 n, vec3 exposure) {
    if (exposure.y < 0.01 || p.y < 0.0) return 0.0;
    if (exposure.z > 0.01) {
      // High chapel openings feed the gallery first, then fall off to the nave.
      float depth = max(0.0, p.x - 13.5);
      float height = smoothstep(0.45, 4.5, p.y);
      float upper = smoothstep(18.0, 20.05, p.z) * exp2(-max(0.0, depth - 2.0) * 0.095);
      float facing = max(0.0, dot(n, vec3(-0.55, 0.76, -0.35)));
      float doorway = uAwPortal.y * exp2(-0.66 * depth) * (1.0 - smoothstep(0.65, 3.0, abs(p.z - 16.5)));
      return exposure.z * ((0.20 + 0.86 * facing) * height * (0.27 + 0.73 * upper) + doorway * 0.32);
    }
    // Gatehouse: a small daylight band near the south pane plus courtyard spill.
    float toWindow = max(0.0, 8.0 + p.z);
    float window = exp2(-0.51 * toWindow) * (1.0 - smoothstep(0.28, 1.03 + 0.35 * toWindow, abs(p.x - 0.6)));
    float windowFacing = max(0.0, dot(n, vec3(0.0, 0.65, -0.76)));
    float toDoor = max(0.0, -p.z);
    float doorway = uAwPortal.x * exp2(-0.78 * toDoor) * (1.0 - smoothstep(0.53, 1.33 + 0.51 * toDoor, abs(p.x)));
    return exposure.y * (0.53 * window * (0.2 + 0.8 * windowFacing) + 0.48 * doorway * max(0.0, 0.3 + 0.5 * n.y + 0.4 * n.z));
  }
#endif
`;
  // The single site key (sun/moon) must not fill a cellar or a room through the minimum VSM
  // shadow floor. Keep warm point lights and material emissives completely outside this term.
  THREE.ShaderChunk.lights_fragment_begin = /* glsl */`
#if defined( STANDARD )
  vec3 awExposure = awSkyExposure(vAwExposurePosition);
#endif
` + THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', /* glsl */`
    getDirectionalLightInfo( directionalLight, directLight );
    #if defined( STANDARD )
      directLight.color *= 1.0 - 0.92 * awExposure.y;
    #endif
`);
  THREE.ShaderChunk.lights_fragment_end += /* glsl */`
#if defined( STANDARD )
    vec3 awN = transformNormalByInverseViewMatrix(geometryNormal, viewMatrix) * vec3(1.0, 1.0, -1.0);
    float skyVisibility, nearOcclusion;
    vec3 bouncedSky;
    awCourtTransport(vAwExposurePosition, awN, skyVisibility, bouncedSky, nearOcclusion);
    reflectedLight.indirectDiffuse *= awExposure.x * skyVisibility;
    reflectedLight.indirectDiffuse += BRDF_Lambert(material.diffuseColor) * uAwPortalIrradiance * bouncedSky * 2.10;
    reflectedLight.indirectDiffuse += BRDF_Lambert(material.diffuseColor) * uAwPortalIrradiance
      * awOpeningIrradiance(vAwExposurePosition, awN, awExposure);
    reflectedLight.indirectSpecular *= (1.0 - 0.48 * nearOcclusion) * awExposure.x * (1.0 - 0.82 * awExposure.y);
#endif
`;
  const courtTransport = loadCourtTransport();
  for (const shader of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) {
    if (shader.uniforms.fogColor) Object.assign(shader.uniforms, { uAwCourtTransport: { value: courtTransport }, uAwPortal: { value: new THREE.Vector2() }, uAwPortalIrradiance: { value: new THREE.Color(0) } });
  }
}
