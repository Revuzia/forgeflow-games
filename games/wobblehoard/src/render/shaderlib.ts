// GLSL snippets shared by several materials (noise, hashes). Plain strings, injected with string concatenation.

export const NOISE_GLSL = /* glsl */`
float whHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float whHash31(vec3 p) {
  vec3 p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 whHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float whNoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(whHash21(i), whHash21(i + vec2(1.0, 0.0)), f.x),
             mix(whHash21(i + vec2(0.0, 1.0)), whHash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float whNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(whHash31(i), whHash31(i + vec3(1, 0, 0)), f.x), mix(whHash31(i + vec3(0, 1, 0)), whHash31(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(whHash31(i + vec3(0, 0, 1)), whHash31(i + vec3(1, 0, 1)), f.x), mix(whHash31(i + vec3(0, 1, 1)), whHash31(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
`;
