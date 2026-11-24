// Standard/Physical share a world-space receiver, including skinned, instanced,
// imported and material-customized meshes. Visibility is applied to incident
// energy before the BRDF so diffuse, sheen, clearcoat and IBL stay consistent.
import * as THREE from 'three';
import { COURT_TRANSPORT_GLSL, loadChapelSurfaceTransport, loadCourtTransport } from './probeLighting';
import { skyExposureSourceUniforms } from './skyExposureSources';

let installed = false;

const RECEIVER = /* glsl */`
#if defined( STANDARD )
  vec3 awGeometricN = normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal, viewMatrix)) * vec3(1.0,1.0,-1.0);
  vec3 awReceiverP = vAwExposurePosition;
  int awRoom = awReceiverRoom(awReceiverP, awGeometricN);
#endif
`;

const INCIDENT_LIGHT = /* glsl */`
#if defined( STANDARD ) && defined( RE_IndirectDiffuse )
  vec3 awN = normalize(transformNormalByInverseViewMatrix(geometryNormal, viewMatrix)) * vec3(1.0,1.0,-1.0);
  AwReceiverLight awLight = awReceiverLight(awReceiverP, awN, awGeometricN, awRoom);
  irradiance *= awLight.ambient;
  iblIrradiance *= awLight.ambient;
  irradiance += uAwSkyIrradiance * (awLight.courtyardBounce * 2.10 + vec3(awLight.aperture.x + awLight.aperture.y));

  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    vec3 awReflection = reflect(-geometryViewDir, geometryNormal);
    awReflection = normalize(mix(awReflection, geometryNormal, pow4(material.roughness)));
    awReflection = transformDirectionByInverseViewMatrix(awReflection, viewMatrix) * vec3(1.0,1.0,-1.0);
    radiance *= awSpecularOpening(awReceiverP, awReflection, material.roughness, awRoom, awLight);
    #ifdef USE_CLEARCOAT
      vec3 awCoatReflection = reflect(-geometryViewDir, geometryClearcoatNormal);
      awCoatReflection = normalize(mix(awCoatReflection, geometryClearcoatNormal, pow4(material.clearcoatRoughness)));
      awCoatReflection = transformDirectionByInverseViewMatrix(awCoatReflection, viewMatrix) * vec3(1.0,1.0,-1.0);
      clearcoatRadiance *= awSpecularOpening(awReceiverP, awCoatReflection, material.clearcoatRoughness, awRoom, awLight);
    #endif
  #endif
#endif
`;

export function installSkyExposure(): void {
  if (installed) return;
  installed = true;

  THREE.ShaderChunk.common += /* glsl */`
#if defined( STANDARD )
  varying vec3 vAwExposurePosition;
#endif
`;
  THREE.ShaderChunk.worldpos_vertex = THREE.ShaderChunk.worldpos_vertex.replace(
    '#if defined( USE_ENVMAP )', '#if defined( STANDARD ) || defined( USE_ENVMAP )',
  ) + /* glsl */`
#if defined( STANDARD )
  vAwExposurePosition = worldPosition.xyz * vec3(1.0, 1.0, -1.0);
#endif
`;
  THREE.ShaderChunk.lights_pars_begin += /* glsl */`
#if defined( STANDARD )
${COURT_TRANSPORT_GLSL}
#endif
`;
  // Soft shadow-map filtering alone cannot resolve every small opening.
  // Require a path through the architectural aperture before applying the
  // directional shadow map. Point and spot light transport stays independent.
  THREE.ShaderChunk.lights_fragment_begin = RECEIVER + THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );', /* glsl */`
    getDirectionalLightInfo( directionalLight, directLight );
    #if defined( STANDARD )
      if (awRoom != AW_OUTSIDE) {
        vec3 awKey = transformDirectionByInverseViewMatrix(directLight.direction, viewMatrix) * vec3(1.0,1.0,-1.0);
        directLight.color *= awKeyOpening(awReceiverP + awGeometricN*0.025, awKey, awRoom);
      }
    #endif
`,
  );
  // This goes after Three assembles source radiances and before it consumes
  // them. lights_fragment_end remains available to the direct specular cap.
  THREE.ShaderChunk.lights_fragment_maps += INCIDENT_LIGHT;

  const uniforms = {
    uAwCourtTransport: { value: loadCourtTransport() },
    uAwChapelSurface: { value: loadChapelSurfaceTransport() },
    ...skyExposureSourceUniforms,
  };
  for (const shader of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) Object.assign(shader.uniforms, uniforms);
}
