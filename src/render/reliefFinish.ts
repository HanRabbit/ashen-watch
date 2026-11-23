import * as THREE from 'three';

const scanSample = /* glsl */`
  uniform sampler2D uReliefAlbedo;
  uniform sampler2D uReliefNormal;
  uniform sampler2D uReliefRough;
  uniform float uReliefScanned;
  uniform float uReliefGrade;
  varying vec3 vReliefPosition;
  varying vec3 vReliefNormal;
  #ifdef AW_RELIEF_ATLAS
    varying float vReliefCarving;
  #endif

  void readReliefPlane(vec2 uv, vec2 dx, vec2 dy, float w, vec3 u, vec3 v,
    inout vec3 grain, inout vec3 slope, inout float rough) {
    if (w <= 0.) return;
    grain += w * textureGrad(uReliefAlbedo, uv, dx, dy).rgb;
    vec3 n = textureGrad(uReliefNormal, uv, dx, dy).rgb * 2. - 1.;
    slope += w * (u * n.x + v * n.y) / max(.65, n.z);
    rough += w * textureGrad(uReliefRough, uv, dx, dy).g;
  }
`;

const stoneColour = /* glsl */`
  vec3 reliefN = normalize(vReliefNormal);
  vec3 facing = abs(reliefN);
  vec3 w = smoothstep(.32, 1., facing / max(max(facing.x, facing.y), facing.z));
  w /= dot(w, vec3(1.));
  vec3 m = vReliefPosition * 1.65; // ~60 cm per scan repeat, on all sides and in the bed.
  vec3 dx = dFdx(m), dy = dFdy(m);
  vec3 grain = vec3(0.), slope = vec3(0.);
  float scanRough = 0.;
  if (uReliefScanned > .5) {
    const vec3 X = vec3(1.,0.,0.), Y = vec3(0.,1.,0.), Z = vec3(0.,0.,1.);
    readReliefPlane(m.zy, dx.zy, dy.zy, w.x, Z, Y, grain, slope, scanRough);
    readReliefPlane(m.xz, dx.xz, dy.xz, w.y, X, Z, grain, slope, scanRough);
    readReliefPlane(m.xy, dx.xy, dy.xy, w.z, X, Y, grain, slope, scanRough);
  } else {
    grain = vec3(.071); // No masonry-grid placeholder on a single stone.
    scanRough = .62;
  }
  const vec3 luma = vec3(.2126,.7152,.0722);
  float scanValue = dot(grain, luma);
  // Broad buff-grey lenses in the matrix, modulated by real pores from the
  // same jointless scan. Not a brighter material assigned to the face.
  float bedding = sin(dot(vReliefPosition, vec3(5.2, 9.7, 3.4))
    + .8 * sin(dot(vReliefPosition, vec3(-4.8, 2.1, 5.3))));
  float dryMineral = smoothstep(-.66, .81, bedding + 5.6 * (scanValue - .071));
  float mineral = clamp(mix(.112, .190, dryMineral) + 1.18 * (scanValue - .071), .051, .265);
  vec3 limestone = mineral * mix(vec3(.91, .96, 1.), vec3(1.055, 1.015, .94), dryMineral);
  #ifdef AW_RELIEF_ATLAS
    // Keep contact/chisel marks on the sculpture, not its baked pale highlights
    // or the baked black back. All newly exposed faces use the same mineral base.
    float carving = smoothstep(.08, .78, vReliefCarving);
    float value = dot(diffuseColor.rgb, luma);
    float incision = mix(.56, 1.27, smoothstep(.040, .61, value));
    limestone *= mix(1., incision, carving);
  #endif
  float baseMoisture = 1. - smoothstep(-.017, .13, vReliefPosition.y - uReliefGrade);
  diffuseColor.rgb = limestone * mix(1., .77, baseMoisture);
`;

/** Specialize only this fragment after mountRodin's generic finish, without
 * mutating cached GLTF materials or material variants. Read the shared jointless
 * rock_face scan live; it loads independently of the GLB and already has mips. */
export function reliefFinish(scan: THREE.MeshStandardMaterial, grade: number,
  atlas?: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ name: atlas ? 'relief-limestone-sculpt' : 'relief-limestone-bed',
    side: atlas?.side ?? THREE.FrontSide, map: atlas?.map ?? null, normalMap: atlas?.normalMap ?? null,
    normalScale: new THREE.Vector2(.5, .5), roughness: .88, metalness: 0,
  });
  if (atlas) mat.defines = { ...mat.defines, AW_RELIEF_ATLAS: 1 };
  mat.customProgramCacheKey = () => atlas ? 'aw-relief-limestone-sculpt' : 'aw-relief-limestone-bed';
  mat.onBeforeCompile = shader => {
    shader.uniforms.uReliefAlbedo = { get value() { return scan.map; } };
    shader.uniforms.uReliefNormal = { get value() { return scan.normalMap; } };
    shader.uniforms.uReliefRough = { get value() { return scan.roughnessMap; } };
    shader.uniforms.uReliefScanned = { get value() {
      // enhance() may finish the three scans in separate frames. Switch only
      // when all have replaced the CanvasTextures of the base variant.
      return [scan.map, scan.normalMap, scan.roughnessMap].every(t => t && !(t instanceof THREE.CanvasTexture)) ? 1 : 0;
    } };
    shader.uniforms.uReliefGrade = { value: grade };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vReliefPosition;
      varying vec3 vReliefNormal;
      #ifdef AW_RELIEF_ATLAS
        attribute float reliefCarving;
        varying float vReliefCarving;
      #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vReliefPosition = (modelMatrix * vec4(transformed, 1.)).xyz;
        vReliefNormal = transformNormalByInverseViewMatrix(transformedNormal, viewMatrix);
        #ifdef AW_RELIEF_ATLAS
          vReliefCarving = reliefCarving;
        #endif`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${scanSample}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${stoneColour}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(.79 + .18 * scanRough - .05 * baseMoisture - .025 * dryMineral, .73, .97);`)
      .replace('#include <normal_fragment_maps>', `
        vec3 reliefBaseNormal = normal;
        #include <normal_fragment_maps>
        #ifdef AW_RELIEF_ATLAS
          normal = normalize(mix(reliefBaseNormal, normal, carving));
        #endif
        vec3 reliefDetail = slope - reliefN * dot(reliefN, slope);
        normal = normalize(normal + mat3(viewMatrix) * reliefDetail * (.62 - .20 * baseMoisture) * faceDirection);`);
  };
  return mat;
}
