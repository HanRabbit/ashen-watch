#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;

uniform sampler2D uBvh;
uniform sampler2D uProbes;
uniform usampler2D uSky;
uniform vec3 uRays[64];
uniform vec3 uReflectance[3];
uniform vec3 uGridOrigin;
uniform vec3 uGridSpacing;
uniform ivec3 uGridSize;
uniform int uBvhEntries;
uniform int uPass;
layout(location = 0) out uvec4 outProbe;

const float MAX_DISTANCE = 44.0;
const float INV_RAY_COUNT = 1.0 / 64.0;

vec4 bvhTexel(int i) {
  int width = textureSize(uBvh, 0).x;
  return texelFetch(uBvh, ivec2(i % width, i / width), 0);
}

struct Hit {
  float distance;
  int axis;
  int material;
};

Hit traceRay(vec3 origin, vec3 direction) {
  vec3 reciprocal = 1.0 / direction;
  Hit hit = Hit(MAX_DISTANCE, 0, 0);
  int node = 0;
  while (node < uBvhEntries) {
    vec4 lo = bvhTexel(2 * node);
    vec4 hi = bvhTexel(2 * node + 1);
    vec3 a = (lo.xyz - origin) * reciprocal;
    vec3 b = (hi.xyz - origin) * reciprocal;
    vec3 enter = min(a, b);
    vec3 leave = max(a, b);
    float nearT = max(enter.x, max(enter.y, enter.z));
    float farT = min(leave.x, min(leave.y, leave.z));
    if (farT < max(0.0, nearT) || nearT >= hit.distance) {
      node = int(lo.w);
      continue;
    }
    int material = int(hi.w);
    if (material != 0 && nearT > 1e-5) {
      int axis = enter.x == nearT ? 0 : enter.y == nearT ? 1 : 2;
      hit = Hit(nearT, axis, material);
      if (uPass == 0) return hit;
    }
    node++;
  }
  return hit;
}

ivec2 probeTexel(vec3 p) {
  vec3 location = floor((p - uGridOrigin) / uGridSpacing + 0.5);
  ivec3 cell = ivec3(clamp(location, vec3(0.0), vec3(uGridSize - 1)));
  return ivec2(cell.x, cell.z + uGridSize.z * cell.y);
}

uvec4 quantize(vec4 value) {
  return uvec4(floor(clamp(value, 0.0, 1.0) * 255.0 + 0.5));
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  int rowWidth = uGridSize.x;
  vec4 probe = texelFetch(uProbes, texel, 0);
  int donor = int(probe.w);
  if (donor != texel.x + rowWidth * texel.y) {
    // The direct/bounce readback is extended into buried probes after both passes.
    outProbe = uvec4(0u);
    return;
  }

  vec3 rgb = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 64; ++i) {
    vec3 ray = uRays[i];
    if (uPass == 0 && ray.y < 0.0) continue;
    Hit hit = traceRay(probe.xyz, ray);
    if (uPass == 0) {
      if (hit.material == 0) {
        rgb += ray * INV_RAY_COUNT;
        alpha += INV_RAY_COUNT;
      }
    } else if (hit.material != 0) {
      float outward = -sign(ray[hit.axis]);
      vec3 at = probe.xyz + hit.distance * ray;
      at[hit.axis] += outward * 0.48;
      ivec2 skyTexel = probeTexel(at);
      int skyDonor = int(texelFetch(uProbes, skyTexel, 0).w);
      vec4 sky = vec4(texelFetch(uSky, ivec2(skyDonor % rowWidth, skyDonor / rowWidth), 0)) / 255.0;
      float incident = clamp(sky.a * 0.5 + 2.0 * (sky[hit.axis] - 0.5) * outward, 0.0, 1.0);
      rgb += uReflectance[hit.material - 1] * incident * INV_RAY_COUNT;
      float proximity = max(0.0, 1.0 - hit.distance / 3.8);
      alpha += proximity * proximity * INV_RAY_COUNT;
    }
  }
  outProbe = uPass == 0 ? quantize(vec4(0.5 + rgb, 2.0 * alpha)) : quantize(vec4(4.0 * rgb, alpha));
}
