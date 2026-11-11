import * as THREE from "three";

// `?water=procedural`: the tunnel wall's blue drawn by a shader instead of the
// 128 px seamless_detail.jpg tile. Experimental; the photo stays the default.
// `&wateralpha=0.3` makes the blue between the wisps that opaque (0..1), so the
// tube behind shows through.
//
// The wall's UVs run along the tube (u) and around it (v, 0..3: three tiles per
// circumference, see tunnel-geometry.js). Noise is sampled on a cylinder, so the
// seam where v wraps is invisible, and u is scaled to match, so features are
// round rather than stretched.
const RADIUS = 1.5 * 3 / (2 * Math.PI); // one photo tile ≈ 1.5 noise units around
const LENGTH_SCALE = 2 * Math.PI * RADIUS / 3;

export const waterUniforms = {
  uWaterTime: { value: 0 },
  uWaterDeep: { value: new THREE.Color(0x1f86ee) },
  uWaterLight: { value: new THREE.Color(0xa9d2f7) },
  uWaterBodyAlpha: { value: 1 }
};

const WATER_GLSL = /* glsl */ `
uniform float uWaterTime;
uniform vec3 uWaterDeep;
uniform vec3 uWaterLight;
uniform float uWaterBodyAlpha;

// Value noise: cheap enough for a full-view wall on a Quest.
float waterHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float waterNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(waterHash(i), waterHash(i + vec3(1, 0, 0)), f.x),
                 mix(waterHash(i + vec3(0, 1, 0)), waterHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(waterHash(i + vec3(0, 0, 1)), waterHash(i + vec3(1, 0, 1)), f.x),
                 mix(waterHash(i + vec3(0, 1, 1)), waterHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Soft, sparse wisps: low frequency and a high, wide threshold.
float waterWisps(vec2 uv) {
  float a = 6.2831853 * uv.y / 3.0;
  vec3 p = vec3(cos(a) * ${RADIUS.toFixed(4)}, sin(a) * ${RADIUS.toFixed(4)}, uv.x * ${LENGTH_SCALE.toFixed(4)});
  vec3 drift = vec3(0.0, 0.0, uWaterTime * 0.05);
  vec3 q = p * 2.0 + drift;
  vec3 warp = vec3(waterNoise(q), waterNoise(q + 5.2), waterNoise(q + 9.7));
  vec3 r = p * 2.5 + warp * 2.0 - drift;
  float n = 0.75 * waterNoise(r) + 0.25 * waterNoise(r * 2.1);
  return smoothstep(0.45, 1.0, n);
}
`;

export function applyProceduralWater(material, { bodyAlpha = 1 } = {}) {
  waterUniforms.uWaterBodyAlpha.value = bodyAlpha;
  if (bodyAlpha < 1) {
    material.transparent = true;
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms);
    shader.fragmentShader = WATER_GLSL + shader.fragmentShader.replace(
      "#include <map_fragment>",
      `float wisps = waterWisps(vMapUv);
      diffuseColor.rgb *= mix(uWaterDeep, uWaterLight, wisps * 0.5);
      diffuseColor.a *= mix(uWaterBodyAlpha, 1.0, wisps);`
    );
  };
  material.customProgramCacheKey = () => "tunnel-water";
  return material;
}

export function tickProceduralWater(seconds) {
  waterUniforms.uWaterTime.value = seconds;
}
