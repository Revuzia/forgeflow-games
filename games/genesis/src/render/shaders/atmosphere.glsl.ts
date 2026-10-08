// GENESIS — the atmosphere model in GLSL (Bruneton/Hillaire-style single scattering + multiple-scattering LUT).
//
// One set of uniforms describes one planet's air: radii, Rayleigh / Mie / ozone coefficients, the precomputed
// transmittance LUT and multiple-scattering LUT. Every shader that needs sunlight colour or sky light includes
// ATMO_PARS: the composite pass, clouds, terrain and water. The planet is small (R ≈ 3 km, shell ≈ 600 m), so the
// vertical optical depths are tuned for an Earth-like sky and sunsets (see sky/atmosphere.ts) and scene geometry uses
// a reduced "aerial perspective density" so terrain a few kilometres away is hazy, not fogged out.
//
// Positions are relative to the planet CENTRE, in metres, in whatever frame the caller uses (only dot products).

export const ATMO_PARS = /* glsl */ `
#ifndef GENESIS_ATMO
#define GENESIS_ATMO
uniform float uRg;            // ground (datum) radius, m
uniform float uRt;            // top of the atmosphere, m
uniform vec3 uBetaR;          // Rayleigh scattering at the ground, 1/m
uniform float uHR;            // Rayleigh scale height, m
uniform vec3 uBetaMs;         // Mie scattering, 1/m
uniform vec3 uBetaMe;         // Mie extinction, 1/m
uniform float uHM;            // Mie scale height, m
uniform float uMieG;
uniform vec3 uBetaO;          // ozone absorption at the layer peak, 1/m
uniform vec2 uOzone;          // (peak height, half width), m
uniform vec3 uSunE;           // sun illuminance at this planet (colour × intensity)
uniform float uHasAtmo;       // 0 = airless
uniform sampler2D uTransLUT;  // 256 × 64
uniform sampler2D uMsLUT;     // 32 × 32

const float ATMO_PI = 3.14159265359;

vec2 raySphere(vec3 o, vec3 d, float R) {
  // numerically stable for distant origins (closest-approach form)
  float b = dot(o, d);
  vec3 qc = o - b * d;
  float h = R * R - dot(qc, qc);
  if (h < 0.0) return vec2(1e30, -1e30);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

vec3 atmoDensity(float h) {
  h = max(h, 0.0);
  return vec3(exp(-h / uHR), exp(-h / uHM), max(0.0, 1.0 - abs(h - uOzone.x) / uOzone.y));
}
vec3 atmoExtinction(vec3 dens) {
  return uBetaR * dens.x + uBetaMe * dens.y + uBetaO * dens.z;
}

float phaseRayleigh(float nu) { return 3.0 / (16.0 * ATMO_PI) * (1.0 + nu * nu); }
float phaseMie(float nu, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * ATMO_PI) * ((1.0 - g2) * (1.0 + nu * nu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * nu, 1e-4), 1.5));
}

vec2 transLutUV(float r, float mu) {
  float H = sqrt(max(0.0, uRt * uRt - uRg * uRg));
  float rho = sqrt(max(0.0, r * r - uRg * uRg));
  float disc = r * r * (mu * mu - 1.0) + uRt * uRt;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dmin = uRt - r;
  float dmax = rho + H;
  float xmu = (d - dmin) / max(dmax - dmin, 1e-3);
  float xr = rho / max(H, 1e-3);
  return vec2(0.5 / 256.0 + xmu * (255.0 / 256.0), 0.5 / 64.0 + xr * (63.0 / 64.0));
}

// transmittance from radius r toward direction cosine mu up to the top of the atmosphere, with the planet's shadow
// (soft over the sun's disc so the terminator is not a hard line)
vec3 sunTransmittance(float r, float mu) {
  if (uHasAtmo < 0.5) {
    float muH = -sqrt(max(0.0, 1.0 - (uRg * uRg) / (r * r)));
    return vec3(smoothstep(muH - 0.01, muH + 0.01, mu));
  }
  r = clamp(r, uRg + 0.5, uRt);
  float muH = -sqrt(max(0.0, 1.0 - (uRg * uRg) / (r * r)));
  vec3 t = texture(uTransLUT, transLutUV(r, max(mu, muH + 0.004))).rgb;
  return t * smoothstep(muH - 0.012, muH + 0.006, mu);
}

vec3 msLookup(float r, float muS) {
  vec2 uv = vec2(0.5 / 32.0 + (muS * 0.5 + 0.5) * (31.0 / 32.0), 0.5 / 32.0 + clamp((r - uRg) / (uRt - uRg), 0.0, 1.0) * (31.0 / 32.0));
  return texture(uMsLUT, uv).rgb;
}

// Integrate single (+ multiple) scattering along o + d·t for t in [t0, t1]. o is relative to the planet centre.
// densScale scales the air density (aerial perspective on geometry), tMark records the partial integral at a distance
// (cloud layer). Returns L (radiance per unit sun illuminance already multiplied by uSunE) and T (transmittance).
void atmoIntegrate(vec3 o, vec3 d, vec3 sunDir, float t0, float t1, int steps, float jitter, float densScale,
                   float tMark, out vec3 L, out vec3 T, out vec3 Lm, out vec3 Tm) {
  L = vec3(0.0); T = vec3(1.0); Lm = vec3(0.0); Tm = vec3(1.0);
  if (t1 <= t0) return;
  float nu = dot(d, sunDir);
  float pR = phaseRayleigh(nu);
  float pM = phaseMie(nu, uMieG);
  float segLen = (t1 - t0);
  float dt = segLen / float(steps);
  bool marked = tMark <= t0;
  if (marked) { Lm = vec3(0.0); Tm = vec3(1.0); }
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    float t = t0 + (float(i) + jitter) * dt;
    vec3 p = o + d * t;
    float r = length(p);
    vec3 up = p / r;
    float h = r - uRg;
    vec3 dens = atmoDensity(h) * densScale;
    vec3 ext = atmoExtinction(dens);
    float muS = dot(up, sunDir);
    vec3 Ts = sunTransmittance(r, muS);
    vec3 scatR = uBetaR * dens.x;
    vec3 scatM = uBetaMs * dens.y;
    vec3 S = (scatR * pR + scatM * pM) * Ts + (scatR + scatM) * msLookup(r, muS);
    // analytic integration over the step (energy conserving, Hillaire 2015)
    vec3 stepT = exp(-ext * dt);
    vec3 Sint = (S - S * stepT) / max(ext, vec3(1e-9));
    if (!marked && t + 0.5 * dt >= tMark) { Lm = L; Tm = T; marked = true; }
    L += T * Sint;
    T *= stepT;
  }
  if (!marked) { Lm = L; Tm = T; }
  L *= uSunE;
  Lm *= uSunE;
}
#endif
`;

/** decode three.js logarithmic depth (gl_FragDepth = log2(1 + w) / log2(far + 1)) to view-space distance along -Z */
export const LOGDEPTH_DECODE = /* glsl */ `
#ifndef GENESIS_LOGDEPTH
#define GENESIS_LOGDEPTH
float viewZFromLogDepth(float d, float far) {
  return exp2(d * log2(far + 1.0)) - 1.0;
}
#endif
`;

/**
 * Lookups into the per-planet sky LUTs for surface shading (terrain ambient, water reflections, cloud ambient).
 * uSkyLUT: radiance seen by an observer at sea level, atlas of 16 azimuth slices × (32 view-zenith × 32 sun-zenith).
 * uIrrSH: L1 spherical-harmonic sky irradiance per sun zenith (64 × 4), in a frame with the sun azimuth along +X.
 * Both are per unit sun illuminance; the result is scaled by uSunE.
 */
export const SKY_LOOKUP = /* glsl */ `
#ifndef GENESIS_SKYLOOKUP
#define GENESIS_SKYLOOKUP
uniform sampler2D uSkyLUT;
uniform sampler2D uIrrSH;

float skyMuToU(float mu) {
  return mu < 0.0 ? 0.25 * clamp((mu + 0.2) / 0.2, 0.0, 1.0) : 0.25 + 0.75 * sqrt(min(mu, 1.0));
}
float skyMuSToV(float muS) { return clamp((muS + 0.35) / 1.35, 0.0, 1.0); }

vec3 skyRadiance(vec3 up, vec3 dir, vec3 sunDir) {
  if (uHasAtmo < 0.5) return vec3(0.0);
  float mu = dot(up, dir);
  float muS = dot(up, sunDir);
  vec3 dp = dir - up * mu;
  vec3 sp = sunDir - up * muS;
  float cphi = dot(dp, sp) * inversesqrt(max(dot(dp, dp) * dot(sp, sp), 1e-12));
  float s = acos(clamp(cphi, -1.0, 1.0)) / 3.14159265 * 15.0;
  float s0 = floor(s);
  float s1 = min(s0 + 1.0, 15.0);
  float f = s - s0;
  float u = skyMuToU(mu) * 31.0 + 0.5;
  float v = (skyMuSToV(muS) * 31.0 + 0.5) / 32.0;
  vec3 a = texture(uSkyLUT, vec2((s0 * 32.0 + u) / 512.0, v)).rgb;
  vec3 b = texture(uSkyLUT, vec2((s1 * 32.0 + u) / 512.0, v)).rgb;
  return mix(a, b, f) * uSunE;
}

vec3 skyIrradiance(vec3 up, vec3 n, vec3 sunDir) {
  if (uHasAtmo < 0.5) return vec3(0.0);
  float muS = dot(up, sunDir);
  vec3 sx = sunDir - up * muS;
  float sl = length(sx);
  sx = sl > 1e-4 ? sx / sl : normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 sz = cross(sx, up);
  vec3 nl = vec3(dot(n, sx), dot(n, up), dot(n, sz));
  float u = 0.5 / 64.0 + skyMuSToV(muS) * (63.0 / 64.0);
  vec3 c0 = texture(uIrrSH, vec2(u, 0.125)).rgb;
  vec3 c1 = texture(uIrrSH, vec2(u, 0.375)).rgb;
  vec3 c2 = texture(uIrrSH, vec2(u, 0.625)).rgb;
  vec3 c3 = texture(uIrrSH, vec2(u, 0.875)).rgb;
  vec3 e = 3.14159265 * 0.282095 * c0 + 2.0943951 * 0.488603 * (c1 * nl.y + c2 * nl.z + c3 * nl.x);
  return max(e, vec3(0.0)) * uSunE;
}
#endif
`;
