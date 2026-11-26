// GENESIS — PERF s25 `wfast=3` (THE DEFAULT since the owner's Mac confirmed it, rounds 18-22; `?wfast=0` = the reference
// water of ocean.ts, exactly as before): the water fragment restructured to the
// cost class of three.js's Water.js (examples/jsm/objects/Water.js, MIT, (c) 2010-2024 three.js authors: a few tiling
// normal-map taps + an analytic sun specular + Schlick Fresnel; the technique, not its code, is reused here), keeping
// every part of the GENESIS look: wave shape, sky / cloud mirror, screen-space reflection of the banks, Beer-Lambert
// depth colour off the real scene depth, glint + glitter + moon path, surf / whitecaps / lace / surge foam, ice, silt.
//
// WHY: on the M5 (Ultra 1686x963, the sea ~70 % of the frame) the water pass cost ~100-120 ms; a constant colour after
// the discards (`wfrag=0`) 33 ms; the six `wshade` cuts together still ~117 ms. What those cuts left was per-pixel work
// on LOW-FREQUENCY quantities (sky irradiance, sun transmittance, cloud shadow, the mirrored deck's light, absorption
// coefficients, sea state, the long waves' group / warp noise) plus 7 wave loops — a long fragment with many live values.
//
// HOW (ocean.ts builds the default shaders; this file only transforms their TEXT, see fastOceanShaders):
//   VERTEX (+1 block at the end of main): the Gerstner (4) and swell (3) normals as three gradient groups (short
//     Gerstner 5.3 / 8.5 m, long 13 / 21 m, swell 34-87 m), each faded by what the vertex LATTICE can carry (spacing
//     from uMorph.z), its slope variance passed along; what the lattice cannot carry goes to the tile-B ripple map's
//     amplitude (the same wavelength band); the sun colour (transmittance x cloud shadow), sky irradiance, the moon's
//     cloud shadow, the mirrored cloud deck's light at the flat-mirror hit, the water's extinction and in-scatter
//     albedo (temperature, rivers, coast, silt zones), the ripple amplitudes (sea state x fetch x group noise).
//   FRAGMENT: the land / hidden discards of ocean.ts unchanged and FIRST; then
//     * normal = the three vertex groups (footprint-faded, LEAN variance to the roughness) + 2-4 taps of the s21
//       ripple map (wfast=2's map: 16 tiling wavelets of the ripples' own steepness law; tiles 5.3 / 3.9 m and 37 / 29 m,
//       the second of each turned a quarter and scrolled another way; mips + anisotropy; taps skipped once their mip
//       has filtered them flat, the variance going to the glint / mirror roughness), triplanar by the up vector
//       (1 projection over most of the planet); rivers: the two-phase flow map (taps x2);
//     * sky mirror = skyRadiance (2 LUT taps); clouds mirrored = 1 cube tap (the deck's density) lit by the vertex;
//     * scene mirror = a screen-space DDA (20 independent depth taps, perspective-correct, spacing u^1.8: dense near
//       the water pixel where the banks and trees stand) + 4 refine + 3 reprojected taps on a hit, run only where the
//       Fresnel can show it;
//     * refraction = 2 depth taps (the second guards the offset) + 1 colour tap, analytic extinction from the vertex;
//     * foam / shore / whitecaps / lace / surge = taps of ONE 256^2 RGBA8 tiling gradient-noise map (4 octaves in its
//       channels, std matched to snoise), 1-3 taps where foam can be, none elsewhere; the shore bite = 1 tap;
//     * glint (GGX), glitter (3 hashes), moon (2 LUT taps + GGX), sun shadow 1 tap (5 in the nearest cascade);
//     * ice and silt streaks keep their arithmetic noise (rare, gated as before).
// Sub-cuts for a Mac bisect: `?wshade3=nodetail,noreflect,nossr,norefract,nofoam,nosky,pcf5` (+ s25d single-term cuts `noglint` (glint, glitter, moon glint), `nodeck` (mirrored clouds), `norare` (ice + silt code); `spdbg`: R tile-B amplitude, G / B the short / long Gerstner shares the lattice keeps; `foamdbg`: R shore, G whitecap / gale, B crest / surge / rapids).
// STATIC COUNT (open calm sea, day, one projection): see PERF.md SESSION 25.
import {
  DataTexture, FloatType, LinearFilter, LinearMipmapLinearFilter, NearestFilter, RGBAFormat, RepeatWrapping, ShaderMaterial, UnsignedByteType,
  Vector4 as V4, WebGLRenderTarget, type IUniform, type Matrix3, type Matrix4, type Texture, type Vector3, type Vector4, type WebGLRenderer,
} from 'three';
import type { FullscreenQuad } from '../post/fsquad.ts';
import { perfList, perfNum, perfNumEff } from '../perfswitch.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';

/** `wfast=3` (the default since the release; `?wfast=0` = ocean.ts's reference water, 1 / 2 = the s21 variants): the restructured water (this file) */
export const WFAST3 = perfNumEff('wfast', 3) === 3;
const CUT = perfList('wshade3');
/** (s25b) `wshade3=seamold`: the per-level lattice spacing of s25 (the Mac's seam), for A/B */
const SEAMOLD = CUT.has('seamold');
/** (s25b) `wshade3=foamold`: s25's surf octaves and 48 m whitecap tile */
const FOAMOLD = CUT.has('foamold');
/** (s25b) `wshade3=ssrold`: s25's SSR loop (texture() taps, hit handling inside the loop), for A/B */
const SSROLD = CUT.has('ssrold');
/**
 * (s25c, s25d) `wshade3=ssrmask`: the land mask below skips rays that cannot hit (identical image). OFF by default since
 * Mac round 21: the mask was 7 ms SLOWER than the full march (60.0 vs 52.8 ms p50) and the whole SSR costs ~6 ms.
 * Without the token neither of its two passes runs and none of its code is compiled. (`ssrall` = the default, kept as a
 * no-op token so old bench strings still work.)
 */
const SSRMASK = CUT.has('ssrmask');
/** (s25c) `wshade3=ssrdbg`: paint the SSR work per pixel (black: gated off before the march, blue: skipped by the land
 *  mask, yellow ramp: depth taps taken / 24) */
const SSRDBG = CUT.has('ssrdbg');
/** (s25c) `wshade3=capold`: s25b's whitecap ramp (filtered noise, widened ramp only) */
const CAPOLD = CUT.has('capold');
/** (s25c) with ssrmask, `wshade3=ssrwin0`: march the whole segment where the mask lets a pixel through (default: only its window) */
const SSRWIN = !CUT.has('ssrwin0');
const WCT = FOAMOLD ? '48.0' : '24.0';
// (s25b) every water level's uMorph (x = K x size(level - 1) = 2 K R spacing(level), z = max(1.5, 1.5 spacing)): 1 / (K R)
// from any level whose z is not clamped; a getter, so three reads it fresh at every upload
const morphs: IUniform<Vector4>[] = [];
const krUniform = {
  get value(): number {
    for (const m of morphs) { const v = m.value; if (v.x < 1e20 && v.z > 1.5 * 1.001) return (2 * v.z / 1.5) / v.x; }
    return 0;
  },
} as IUniform<number>;

let noiseMap: DataTexture | null = null;
/**
 * the foam's noise: 4 channels of tiling 2D gradient noise (quintic fade) with 4, 8, 16, 32 lattice cells a tile
 * (R..A), each scaled to the standard deviation of GENESIS's snoise (0.37, measured over 2e5 samples) so the foam's
 * thresholds keep their meaning
 */
function foamNoiseMap(): DataTexture {
  if (noiseMap) return noiseMap;
  const N = 256, data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number, c: number): number => {
    let h = (x * 374761393 + y * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const chan: Float32Array[] = [];
  for (let c = 0; c < 4; c++) {
    const n = 4 << c, v = new Float32Array(N * N);
    let s2 = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = (x / N) * n, fy = (y / N) * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const g = (cx: number, cy: number, dx: number, dy: number): number => {
        const a = hash(((cx % n) + n) % n, ((cy % n) + n) % n, c) * 6.2831853;
        return Math.cos(a) * dx + Math.sin(a) * dy;
      };
      const u = fade(tx), w = fade(ty);
      const a = g(ix, iy, tx, ty) + (g(ix + 1, iy, tx - 1, ty) - g(ix, iy, tx, ty)) * u;
      const b = g(ix, iy + 1, tx, ty - 1) + (g(ix + 1, iy + 1, tx - 1, ty - 1) - g(ix, iy + 1, tx, ty - 1)) * u;
      const val = a + (b - a) * w;
      v[y * N + x] = val; s2 += val * val;
    }
    const k = 0.37 / Math.sqrt(s2 / (N * N));
    for (let i = 0; i < N * N; i++) v[i] = Math.max(-1, Math.min(1, v[i] * k));
    chan.push(v);
  }
  for (let i = 0; i < N * N; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round((chan[c][i] * 0.5 + 0.5) * 255);
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.name = 'water-foam-noise'; t.needsUpdate = true;
  return (noiseMap = t);
}

// ───────────────────────────── vertex: the low-frequency terms ─────────────────────────────
const VERT_DECL = /* glsl */ `
${ATMO_PARS}
${SKY_LOOKUP}
${CLOUD_DENSITY_GLSL}
uniform vec3 uSunDirBody;
uniform vec3 uMoonDirBody;
uniform vec3 uMoonE;
uniform vec3 uNightAmbient;
uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform vec4 uSilt[4];
uniform float uSiltK[4];
uniform float uF3KR;  // 1 / (K R): the LOD's lattice spacing per metre of selection distance (s25b; 0 = unknown)
// (wfast=3) xyz = a wave group's surface gradient (body frame), w = its slope variance: short Gerstner, long, swell
varying vec4 vF3A;
varying vec4 vF3B;
varying vec4 vF3S;
varying vec4 vF3Sun;  // sun colour at the surface (transmittance x cloud shadow; no cascades) + variance the lattice drops
varying vec4 vF3Sky;  // sky irradiance + night floor, w = silt
varying vec4 vF3Ext;  // extinction x 1.25 (1/m), w = the moon's cloud shadow
varying vec4 vF3Alb;  // in-scatter albedo / pi (incl. the fresh-water and silt factors), w = tile-A ripple amplitude
varying vec4 vF3Cld;  // the mirrored cloud deck's light, w = tile-B ripple amplitude (+ waves the lattice drops)
float f3CloudSh(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  vec2 hit = raySphere(P, sunB, 0.5 * (uCloudShell.x + uCloudShell.y));
  if (hit.y < 0.0) return 1.0;
  float dens = cloudDensityAt(P + sunB * hit.y, 0.35, 0.0, 0.0, false);
  return max(exp(-dens * (uCloudShell.y - uCloudShell.x) * 0.4), 0.3);
}
`;

const VERT_MAIN = /* glsl */ `
  // ── PERF s25 wfast=3: the low-frequency terms per vertex (oceanfast.ts) ──
  vF3A = vec4(0.0); vF3B = vec4(0.0); vF3S = vec4(0.0); vF3Sun = vec4(0.0); vF3Sky = vec4(0.0);
  vF3Ext = vec4(0.5, 0.25, 0.2, 1.0); vF3Alb = vec4(0.0); vF3Cld = vec4(0.0);
  if (vDepth > -40.0) {
    vec3 fP = tPos - disp;          // the rest point: the Gerstner normal belongs to it
    vec3 fUp = normalize(fP);
    // the fragment's sea state: wind x fetch (ponds sheltered, rivers keep theirs)
    float fFetch = mix(0.4, 1.0, max(smoothstep(0.3, 0.8, vSalt), smoothstep(0.15, 0.6, flowSpd)));
    float fG = seaState(vWind) * fFetch;
    float fSea = uWind * fG;
    float fCalm = smoothstep(0.3, 4.0, vDepth) * (1.0 - smoothstep(0.05, 0.4, vIce));
    // the lattice spacing here (an upper bound: ChunkLOD.skirtDepth = max(1.5, 1.5 x spacing); doubled while morphing)
    // (s25b: CONTINUOUS across patch borders: the old per-level uMorph.z / 1.5 x (1 + tMorph) clamps at 1 m for every
    // level finer than 1 m (skirtDepth = max(1.5, 1.5 spacing)), so two fine levels disagreed 2 m / 1 m along their
    // border: the waves' kept share, the roughness, the glitter and the mirrored clouds stepped there — the Mac's
    // straight diagonal seam. Now the selection distance / (K R), the spacing the LOD gives that distance once
    // morphed (= 2 x spacing at the full-morph distance, the old bound), the same function on both sides of a border)
    float fSp;
    ${SEAMOLD ? 'if (false) {' : 'if (uF3KR > 0.0) {'}
      vec3 fTv = tPos - uCamBody;
      float fDd = length(fTv);
      float fGr = 1.0 - abs(dot(position, fTv / max(fDd, 1e-3)));
      fSp = fDd / (1.0 + uMorph.w * fGr * fGr * fGr) * uF3KR;
    } else fSp = uMorph.z / 1.5 * (1.0 + tMorph);
    float fLost = 0.0, fLostS = 0.0;
    // (s25b: the long waves' group noise — snoise of P x 0.035 and x 0.09, blobs of ~14 m and ~5 m — sampled at vertices
    // tens of metres apart is aliased: a coarse patch interpolated a few random samples of it while the fine patch next
    // to it drew the blobs, so the waves' amplitude, the roughness, the glitter and the mirrored clouds changed across
    // the patch border — the Mac's straight seam. Each term fades to its mean where the lattice cannot carry it, the
    // same on both sides of a border; 'wshade3=seamold' = s25)
    vec2 fGw = ${SEAMOLD ? 'gwG' : 'gwG * vec2(1.0 - smoothstep(3.0, 6.0, fSp), 1.0 - smoothstep(1.2, 2.5, fSp))'};
    for (int i = 0; i < 4; i++) {
      float L = GW_D[i].w;
      vec3 D = normalize(GW_D[i].xyz);
      vec3 d = waveTan(D, fUp);
      float k = 6.2831853 / L;
      float a = GW_A[i] * fSea * fCalm * windFeed(d, wT, i < 2 ? 1.0 : 0.5) * smoothstep(0.15, 0.45, length(d)) * gwGroup(fGw, i) * k;
      float fv = 1.0 - smoothstep(L * ${SEAMOLD ? '0.2' : '0.12'}, L * ${SEAMOLD ? '0.4' : '0.25'}, fSp);
      vec4 g = vec4(d * (a * fv * cos(k * dot(fP, D) - sqrt(9.8 * k) * uTime + gwPhase(gwW, i))), 0.5 * a * a * fv);
      if (i < 2) vF3B += g; else vF3A += g;
      fLost += 0.5 * a * a * (1.0 - fv);
    }
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float L = 34.0 * pow(1.6, fi);
      vec3 D = normalize(vec3(cos(fi * 2.4 + 0.7), sin(fi * 1.7), sin(fi * 2.4 + 0.7)));
      vec3 d = waveTan(D, fUp);
      float k = 6.2831853 / L;
      float a = L * 0.011 * fSea * fCalm * smoothstep(1.5, 8.0, vDepth) * windFeed(d, wT, 1.0) * smoothstep(0.15, 0.45, length(d)) * k;
      float fv = 1.0 - smoothstep(L * ${SEAMOLD ? '0.2' : '0.12'}, L * ${SEAMOLD ? '0.4' : '0.25'}, fSp);
      vF3S += vec4(d * (a * fv * cos(k * dot(fP, D) - sqrt(9.8 * k) * uTime + fi * 2.1)), 0.5 * a * a * fv);
      fLostS += 0.5 * a * a * (1.0 - fv);
    }
    vF3Sun.w = fLostS;
    // the ripple map's amplitudes (wfast=2's calibration), swelling and fading with the long waves' group noise; tile B
    // also carries the Gerstner waves the lattice cannot (the same 1-9 m band; 0.0145 = the map's slope variance)
    float kA = 1.15 * uWind * mix(fG, fG * fG, 0.6) * clamp(0.6 + 0.5 * fGw.y, 0.2, 1.3);
    float kB = 1.15 * uWind * fG * clamp(0.6 + 0.5 * fGw.x, 0.2, 1.3);
    vF3Alb.w = kA;
    vF3Cld.w = sqrt(kB * kB + fLost / 0.0145);
    // light
    vec3 uP = normalize(tPos);
    float muS = dot(uP, uSunDirBody);
    vF3Sun.rgb = uSunE * sunTransmittance(length(tPos), muS) * f3CloudSh(tPos, uSunDirBody);
    vF3Sky.rgb = skyIrradiance(uP, uP, uSunDirBody) + uNightAmbient;
    vF3Ext.w = dot(uMoonE, uMoonE) > 0.0 ? f3CloudSh(tPos, uMoonDirBody) : 1.0;
    // the mirrored deck's light where the flat mirror meets the mid-shell (it changes over kilometres)
    if (uCloudOn > 0.5) {
      vec3 r0 = reflect(-normalize(uCamBody - tPos), uP);
      r0 = normalize(r0 + uP * max(0.0, -dot(r0, uP)) * 1.02);
      vec2 h0 = raySphere(tPos, r0, 0.5 * (uCloudShell.x + uCloudShell.y));
      if (h0.y > 0.0) {
        vec3 qn = normalize(tPos + r0 * h0.y);
        float storm = textureLod(uCloudCov, qn, 0.0).g;
        float muC = dot(qn, uSunDirBody);
        vF3Cld.rgb = (uSunE * sunTransmittance(length(tPos + r0 * h0.y), muC) * (0.25 + 0.2 * max(muC, 0.0)) * (1.0 - 0.5 * storm) + skyIrradiance(qn, -r0, uSunDirBody) * 0.6) / 3.14159;
      }
    }
    // the water body's optics (ocean.ts: cold seas greener, rivers silty, coasts turbid, ARC §10 silt zones)
    float riverK = smoothstep(0.15, 0.6, flowSpd);
    float saltK = smoothstep(0.3, 0.8, vSalt);
    float silt = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 sz = uSilt[i];
      if (sz.w > 0.0) silt = max(silt, uSiltK[i] * (1.0 - smoothstep(sz.w * 0.55, sz.w, distance(tPos, sz.xyz))));
    }
    silt *= 1.0 - 0.6 * saltK;
    float coastal = 1.0 - smoothstep(4.0, 30.0, vDepth);
    vec3 sA = vec3(0.45, 0.15, 0.11) + vec3(0.0, 0.02, 0.0) * smoothstep(15.0, 0.0, vTemp) + vec3(0.08, 0.16, 0.3) * riverK
      + vec3(0.04, 0.2, 0.62) * silt + vec3(0.04, 0.03, 0.06) * coastal;
    vec3 sS = vec3(0.018, 0.045, 0.05) + vec3(0.7, 0.46, 0.22) * silt
      + vec3(0.05, 0.075, 0.055) * coastal * mix(0.6, 1.0, saltK) + vec3(0.03, 0.04, 0.025) * riverK;
    vF3Ext.rgb = (sA + sS) * 1.25;
    vF3Alb.rgb = sS / (sA + sS) * mix(0.5, 1.0, max(max(max(saltK, riverK), smoothstep(2.0, 8.0, vDepth)), silt)) * (1.0 + 6.0 * silt) / 3.14159;
    vF3Sky.w = silt;
    ${CUT.has('spdbg2') ? 'vF3Ext.w = fSp; vF3Sky.w = 1.0 - smoothstep(5.3 * 0.2, 5.3 * 0.4, fSp);' : ''}
  }
`;

// ───────────────────────────── fragment ─────────────────────────────
const fragDecl = (n: number): string => /* glsl */ `
uniform sampler2D uRipMap;
uniform sampler2D uF3Noise;
uniform highp sampler2D uF3Mask;  // (s25c) per 4-px screen column: x = min, y = max screen v of land pixels, z = their nearest depth
uniform float uF3MaskOn;
float gF3Steps = -1.0;            // (ssrdbg) -1 = no SSR attempted, -2 = skipped by the mask, else depth taps taken
varying vec4 vF3A;
varying vec4 vF3B;
varying vec4 vF3S;
varying vec4 vF3Sun;
varying vec4 vF3Sky;
varying vec4 vF3Ext;
varying vec4 vF3Alb;
varying vec4 vF3Cld;
// triplanar weights (|up|^6, the ones under 2 % dropped and the rest renormalised: one projection over most of the
// planet) and the body position's screen derivatives, for explicit-gradient taps inside branches
vec3 gF3W = vec3(0.0, 1.0, 0.0);
vec3 gF3Px = vec3(0.0), gF3Py = vec3(0.0);
// a tiling map tapped along the body axes: Q in metres, inv = 1 / tile size, drift in tiles
vec4 f3Tri(sampler2D m, vec3 Q, vec3 inv, vec2 drift) {
  vec4 n = vec4(0.0);
  vec3 q = Q * inv, dx = gF3Px * inv, dy = gF3Py * inv;
  if (gF3W.x > 0.0) n += gF3W.x * textureGrad(m, q.yz + drift, dx.yz, dy.yz);
  if (gF3W.y > 0.0) n += gF3W.y * textureGrad(m, q.zx + drift, dx.zx, dy.zx);
  if (gF3W.z > 0.0) n += gF3W.z * textureGrad(m, q.xy + drift, dx.xy, dy.xy);
  return n;
}
// the foam noise: 4 octaves (lattice tile/4, /8, /16, /32), each ~snoise
// (S: a stretch of the body frame, so the taps' derivatives follow it: whitecaps and gale streaks are anisotropic)
vec4 f3N(vec3 P, vec3 S, float tile, vec2 drift) { return f3Tri(uF3Noise, P, S / tile, drift) * 2.0 - 1.0; }
vec4 f3N(vec3 P, float tile, vec2 drift) { return f3N(P, vec3(1.0), tile, drift); }
// the ripple map in one projection (wfast=2's ripTap): q, its derivatives, the tiles' amplitudes (0 = skipped)
vec2 f3RipP(vec2 q, vec2 dx, vec2 dy, float t, float kA, float kB) {
  vec2 g = vec2(0.0), r;
  if (kA > 0.0) {
    g += (textureGrad(uRipMap, q / 5.3 + vec2(0.11, 0.07) * t, dx / 5.3, dy / 5.3).rg - 0.5) * kA;
    r = textureGrad(uRipMap, vec2(q.y, -q.x) / 3.9 + vec2(-0.09, 0.13) * t, vec2(dx.y, -dx.x) / 3.9, vec2(dy.y, -dy.x) / 3.9).rg - 0.5;
    g += vec2(-r.y, r.x) * kA;
  }
  if (kB > 0.0) {
    g += (textureGrad(uRipMap, q / 37.0 + vec2(-0.05, 0.04) * t, dx / 37.0, dy / 37.0).rg - 0.5) * kB;
    r = textureGrad(uRipMap, vec2(q.y, -q.x) / 29.0 + vec2(0.06, 0.03) * t, vec2(dx.y, -dx.x) / 29.0, vec2(dy.y, -dy.x) / 29.0).rg - 0.5;
    g += vec2(-r.y, r.x) * kB;
  }
  return g;
}
vec3 f3Rip(vec3 Q, float t, float kA, float kB) {
  vec3 g = vec3(0.0);
  if (gF3W.x > 0.0) { vec2 r = f3RipP(Q.yz, gF3Px.yz, gF3Py.yz, t, kA, kB); g += gF3W.x * vec3(0.0, r); }
  if (gF3W.y > 0.0) { vec2 r = f3RipP(Q.zx, gF3Px.zx, gF3Py.zx, t, kA, kB); g += gF3W.y * vec3(r.y, 0.0, r.x); }
  if (gF3W.z > 0.0) { vec2 r = f3RipP(Q.xy, gF3Px.xy, gF3Py.xy, t, kA, kB); g += gF3W.z * vec3(r, 0.0); }
  return g;
}
// the cascades' sun shadow, 5 bilinear-PCF taps in the nearest cascade (tree shadows on the water by the bank), 1 beyond
float f3SunShadow(vec3 posView, vec3 nView) {
  if (uShadowOn < 0.5) return 1.0;
  float z = -posView.z;
  int k = z < uShadowSplits.x ? 0 : z < uShadowSplits.y ? 1 : z < uShadowSplits.z ? 2 : 3;
  if (float(k) >= uShadowCount) return 1.0;
  float bias = k == 0 ? uShadowBias.x : k == 1 ? uShadowBias.y : k == 2 ? uShadowBias.z : uShadowBias.w;
  mat4 M = k == 0 ? uShadowMat[0] : k == 1 ? uShadowMat[1] : k == 2 ? uShadowMat[2] : uShadowMat[3];
  vec4 sc4 = M * vec4(posView + nView * bias, 1.0);
  vec3 sc = sc4.xyz / sc4.w;
  vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2)) * 0.5;
  vec4 tile = vec4(o + uShadowTexel * 1.5, o + 0.5 - uShadowTexel * 1.5);
  if (sc.z >= 1.0 || sc.z <= 0.0) return 1.0;
  float s;
  if (${CUT.has('pcf5') ? 'true' : 'k == 0'}) {
    float r = uShadowTexel * 1.4;
    s = shadowTap(sc, tile) * 0.36;
    s += shadowTap(sc + vec3(-r, -r * 0.4, 0.0), tile) * 0.16;
    s += shadowTap(sc + vec3(r, r * 0.4, 0.0), tile) * 0.16;
    s += shadowTap(sc + vec3(-r * 0.4, r, 0.0), tile) * 0.16;
    s += shadowTap(sc + vec3(r * 0.4, -r, 0.0), tile) * 0.16;
  } else s = shadowTap(sc, tile);
  float last = uShadowCount < 1.5 ? uShadowSplits.x : uShadowCount < 2.5 ? uShadowSplits.y : uShadowCount < 3.5 ? uShadowSplits.z : uShadowSplits.w;
  return mix(s, 1.0, smoothstep(last * 0.88, last, z));
}
// Screen-space reflection, bounded: the reflected ray (up to 320 m, clipped to the near plane and the screen) marched in
// SCREEN space, perspective-correct (McGuire-Mara DDA: 1/w and z/w are linear on screen), ${n} samples spaced
// as u^1.8 (dense next to the water pixel, where the bank and its trees stand), a smooth per-pixel offset of the
// start, the same crossing test as ocean.ts ssr(), 4 bisection steps, then the hit reprojected into last frame's
// composited image (3 taps across the surface's tilt). Every sample's position depends only on the index: the taps
// are independent of each other. Returns rgb + confidence.
vec4 f3Ssr(vec3 posV, vec3 rV, vec3 nV) {
  if (uPrevValid < 0.5) return vec4(0.0);
  float facing = 1.0 - smoothstep(0.05, 0.3, rV.z);
  if (facing <= 0.0) return vec4(0.0);
  float len = 320.0;
  if (rV.z > 1e-4) len = min(len, (-0.5 - posV.z) / rV.z);
  vec4 c0 = uProj * vec4(posV, 1.0);
  vec4 c1 = uProj * vec4(posV + rV * len, 1.0);
  float k0 = 1.0 / c0.w, k1 = 1.0 / c1.w;
  vec2 s0 = c0.xy * k0, s1 = c1.xy * k1;
  vec2 dS = s1 - s0;
  float tm = 1.0;
  if (dS.x > 1e-6) tm = min(tm, (1.0 - s0.x) / dS.x); else if (dS.x < -1e-6) tm = min(tm, (-1.0 - s0.x) / dS.x);
  if (dS.y > 1e-6) tm = min(tm, (1.0 - s0.y) / dS.y); else if (dS.y < -1e-6) tm = min(tm, (-1.0 - s0.y) / dS.y);
  tm = max(tm, 0.0);
  vec3 Q0 = posV * k0, Q1 = mix(Q0, (posV + rV * len) * k1, tm);
  float K1 = mix(k0, k1, tm);
  vec2 S1 = s0 + dS * tm;
  if (length((S1 - s0) * uResolution) < 3.0) return vec4(0.0);
  float uLo = 0.0, uHi = 1.0;   // (s25c) the part of the segment that can hold a hit (the mask's passing cells)
  ${SSRMASK ? `// (s25c) can anything be hit? A hit needs an opaque point IN FRONT of a ray point, and every ray point lies above
  // the water; the opaque scene behind the water (the sea bed, under the surface along the same line of sight) or
  // the sky never is. So only LAND pixels (opaque points above the lowest water level, uF3Mask) can be hit: if none
  // of the 4-px columns the segment crosses holds land within its screen rows and nearer than its far end, the march
  // cannot find anything and is skipped (the same result, exactly: the output was "no hit" = sky)
  if (uF3MaskOn > 0.5) {
    // (per 4-px column the segment crosses, per 128-px screen band of it: is there land in those rows, nearer than the
    // ray gets while it is in them? depth along the segment is monotonic, so its ends bound it; margins 1-2 px, 1 %)
    vec2 m0 = (s0 * 0.5 + 0.5) * uResolution, m1 = (S1 * 0.5 + 0.5) * uResolution, dm = m1 - m0;
    ivec2 msz = textureSize(uF3Mask, 0);
    int c0 = int(min(m0.x, m1.x)) / 4, c1 = int(max(m0.x, m1.x)) / 4;
    if (c1 - c0 < 32) {
      bool any = false;
      float uL = 2.0, uH = -1.0;
      int nb = msz.y - 1;                      // the last row: each column's summary over the whole screen
      float vlo = min(m0.y, m1.y) - 2.0, vhi = max(m0.y, m1.y) + 2.0;
      float zall = max(-posV.z, -Q1.z / K1) * 1.01 + 1.0;
      for (int ci = 0; ci < 32; ci++) {
        int c = c0 + ci;
        if (c > c1) break;
        vec4 sm = texelFetch(uF3Mask, ivec2(clamp(c, 0, msz.x - 1), nb), 0);
        if (!(sm.y * uResolution.y >= vlo - 1.0 && sm.x * uResolution.y <= vhi + 1.0 && sm.z < zall)) continue;
        float ua = 0.0, ub = 1.0;
        if (abs(dm.x) > 1e-3) {
          float t0 = (float(c * 4) - 1.0 - m0.x) / dm.x, t1 = (float(c * 4 + 4) + 1.0 - m0.x) / dm.x;
          ua = max(0.0, min(t0, t1)); ub = min(1.0, max(t0, t1));
        }
        if (ua > ub) continue;
        float ylo = min(m0.y + dm.y * ua, m0.y + dm.y * ub) - 2.0, yhi = max(m0.y + dm.y * ua, m0.y + dm.y * ub) + 2.0;
        int r0 = max(int(floor(max(ylo, 0.0))) / 128, 0), r1 = min(int(floor(max(yhi, 0.0))) / 128, nb - 1);
        for (int bi = 0; bi < 8; bi++) {
          int bd = r0 + bi;
          if (bd > r1) break;
          float va = max(ylo, float(bd * 128)), vb = min(yhi, float(bd * 128 + 128));
          float uA = ua, uB = ub;
          if (abs(dm.y) > 1e-3) {
            float t0 = (va - m0.y) / dm.y, t1 = (vb - m0.y) / dm.y;
            uA = clamp(max(ua, min(t0, t1)), 0.0, 1.0); uB = clamp(min(ub, max(t0, t1)), 0.0, 1.0);
          }
          float zmax = max(-mix(Q0.z, Q1.z, uA) / mix(k0, K1, uA), -mix(Q0.z, Q1.z, uB) / mix(k0, K1, uB)) * 1.01 + 1.0;
          vec4 mk = texelFetch(uF3Mask, ivec2(clamp(c, 0, msz.x - 1), bd), 0);
          if (mk.y * uResolution.y >= va - 1.0 && mk.x * uResolution.y <= vb + 1.0 && mk.z < zmax) { any = true; uL = min(uL, uA); uH = max(uH, uB); }
        }
      }
      if (!any) { gF3Steps = -2.0; return vec4(0.0); }
      ${SSRWIN ? 'uLo = uL - 0.02; uHi = uH + 0.02;' : ''}
    }
  }` : ''}
  gF3Steps = 0.0;
  float jit = 0.5 + 0.2 * (sin(vBodyPos.x * 0.9 + vBodyPos.y * 0.4) + sin(vBodyPos.z * 0.8 + vBodyPos.y * 0.7));
  float prz = -posV.z, uPrev = 0.0;
  ${SSROLD ? `/* s25 loop */
  for (int i = 1; i <= ${n}; i++) {
    float u = (float(i) - 1.0 + jit) / ${n}.0;
    u = pow(u, 1.8);
    float kk = mix(k0, K1, u);
    float rz = -mix(Q0.z, Q1.z, u) / kk;
    float sz = texture(tSceneDepth, mix(s0, S1, u) * 0.5 + 0.5).r;
    if (sz < 1e8 && rz > sz && sz > prz - (0.5 + 0.02 * sz) && rz < sz + max(1.0, abs(rz - prz) * 1.5 + 0.01 * rz)) {
      float u0 = uPrev, u1 = u;
      for (int j = 0; j < 4; j++) {
        float um = 0.5 * (u0 + u1);
        float km = mix(k0, K1, um);
        if (-mix(Q0.z, Q1.z, um) / km > texture(tSceneDepth, mix(s0, S1, um) * 0.5 + 0.5).r) u1 = um; else u0 = um;
      }
      vec3 qh = mix(Q0, Q1, u1) / mix(k0, K1, u1);
      vec4 pc = uViewToPrevClip * vec4(qh, 1.0);
      if (pc.w <= 0.0) return vec4(0.0);
      vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
      vec2 e = smoothstep(vec2(0.0), vec2(0.08), puv) * smoothstep(vec2(1.0), vec2(0.92), puv);
      vec2 sp = nV.xy / uResolution * 6.0;
      vec3 rc = (prevTap(puv) * 2.0 + prevTap(puv + sp) + prevTap(puv - sp)) * 0.25;
      float far = 1.0 - smoothstep(0.3, 0.8, length(qh - posV) / 400.0);
      return vec4(rc, e.x * e.y * facing * far);
    }
    prz = rz; uPrev = u;
  }
  return vec4(0.0);
  /* end s25 loop */` : `// (s25b) the same samples and tests, restructured for the GPU: the depth copy is NEAREST-filtered, so texelFetch
  // reads exactly what texture() did, without implicit derivatives inside this data-dependent loop; the samples are
  // fetched four at a time (their places depend only on the index: the loads overlap) and tested in order; the
  // bisection and the reprojection run once, after the loop
  ivec2 dsz = textureSize(tSceneDepth, 0);
  vec2 dszf = vec2(dsz);
  float uHit = -1.0;
  for (int g = 0; g < ${n / 4}; g++) {
    vec4 u = pow((vec4(float(g * 4)) + vec4(0.0, 1.0, 2.0, 3.0) + jit) / ${n}.0, vec4(1.8));
    vec4 rz = -mix(vec4(Q0.z), vec4(Q1.z), u) / mix(vec4(k0), vec4(K1), u);
    // (s25c) samples outside [uLo, uHi] cannot hit (no land there, by the mask): no read, the test fails as it would
    // (their ray depth still feeds the next sample's crossing test, so the decisions are the same)
    vec4 sz = vec4(1e9);
    if (u.w >= uLo && u.x <= uHi) {
      gF3Steps += dot(step(vec4(uLo), u) * step(u, vec4(uHi)), vec4(1.0));
      sz = vec4(
        (u.x >= uLo && u.x <= uHi) ? texelFetch(tSceneDepth, clamp(ivec2((mix(s0, S1, u.x) * 0.5 + 0.5) * dszf), ivec2(0), dsz - 1), 0).r : 1e9,
        (u.y >= uLo && u.y <= uHi) ? texelFetch(tSceneDepth, clamp(ivec2((mix(s0, S1, u.y) * 0.5 + 0.5) * dszf), ivec2(0), dsz - 1), 0).r : 1e9,
        (u.z >= uLo && u.z <= uHi) ? texelFetch(tSceneDepth, clamp(ivec2((mix(s0, S1, u.z) * 0.5 + 0.5) * dszf), ivec2(0), dsz - 1), 0).r : 1e9,
        (u.w >= uLo && u.w <= uHi) ? texelFetch(tSceneDepth, clamp(ivec2((mix(s0, S1, u.w) * 0.5 + 0.5) * dszf), ivec2(0), dsz - 1), 0).r : 1e9);
    }
    for (int j = 0; j < 4; j++) {
      float r = rz[j], d = sz[j];
      if (d < 1e8 && r > d && d > prz - (0.5 + 0.02 * d) && r < d + max(1.0, abs(r - prz) * 1.5 + 0.01 * r)) { uHit = u[j]; break; }
      prz = r; uPrev = u[j];
    }
    if (uHit >= 0.0) break;
  }
  if (uHit < 0.0) return vec4(0.0);
  float u0 = uPrev, u1 = uHit;
  gF3Steps += 4.0;
  for (int j = 0; j < 4; j++) {
    float um = 0.5 * (u0 + u1);
    float dm = texelFetch(tSceneDepth, clamp(ivec2((mix(s0, S1, um) * 0.5 + 0.5) * dszf), ivec2(0), dsz - 1), 0).r;
    if (-mix(Q0.z, Q1.z, um) / mix(k0, K1, um) > dm) u1 = um; else u0 = um;
  }
  vec3 qh = mix(Q0, Q1, u1) / mix(k0, K1, u1);
  vec4 pc = uViewToPrevClip * vec4(qh, 1.0);
  if (pc.w <= 0.0) return vec4(0.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec2 e = smoothstep(vec2(0.0), vec2(0.08), puv) * smoothstep(vec2(1.0), vec2(0.92), puv);
  vec2 sp = nV.xy / uResolution * 6.0;
  vec3 rc = (prevTap(puv) * 2.0 + prevTap(puv + sp) + prevTap(puv - sp)) * 0.25;
  float far = 1.0 - smoothstep(0.3, 0.8, length(qh - posV) / 400.0);
  return vec4(rc, e.x * e.y * facing * far);`}
}
`;

interface F3Flags { detail: boolean; reflect: boolean; ssr: boolean; refract: boolean; foam: boolean; sky: boolean; landCut: boolean }

const fragMain = (f: F3Flags): string => /* glsl */ `
  // ── PERF s25 wfast=3 (oceanfast.ts): everything above is ocean.ts's, unchanged (discards first) ──
  vec3 P = vBodyPos;
  vec3 up = normalize(P);
  gF3Px = dFdx(P);
  gF3Py = dFdy(P);
  float fw = length(abs(gF3Px) + abs(gF3Py));
  float lx = length(gF3Px), ly = length(gF3Py);
  // the footprint a wave of the vertex groups is judged by (anisotropy capped at 2:1: the grazing sea keeps the waves
  // running across the line of sight, without aliasing those running along it)
  float fwE = max(min(lx, ly), max(lx, ly) * 0.5);
  vec3 wq = pow(abs(up), vec3(6.0));
  wq /= wq.x + wq.y + wq.z;
  wq *= step(0.02, wq);
  gF3W = wq / (wq.x + wq.y + wq.z);
  float calm = smoothstep(0.3, 4.0, vDepth) * (1.0 - smoothstep(0.05, 0.4, vIce));
  float flowSpd = length(vFlow);
  // ── normal: the vertex's wave groups, faded where the pixel cannot draw them (their slope variance to the roughness)
  float fA = 1.0 - smoothstep(0.04, 0.13, fwE / 5.3);
  float fB = 1.0 - smoothstep(0.04, 0.13, fwE / 13.0);
  float fS = 1.0 - smoothstep(0.025, 0.07, fwE / 34.0);
  vec3 gradLong = vF3A.xyz * fA + vF3B.xyz * fB + vF3S.xyz * fS;
  ${CUT.has('spdbg2') ? 'gl_FragColor = vec4(fract(vF3Ext.w), vF3Sky.w, clamp(vF3Alb.w / 3.0, 0.0, 1.0), 1.0); return;' : ''}
  ${CUT.has('spdbg') ? 'gl_FragColor = vec4(clamp(vF3Cld.w / 3.0, 0.0, 1.0), clamp(vF3A.w * 40.0, 0.0, 1.0), clamp(vF3B.w * 40.0, 0.0, 1.0), 1.0); return;' : ''}
  float unres = vF3A.w * (1.0 - fA) + vF3B.w * (1.0 - fB) + vF3S.w * (1.0 - fS) + vF3Sun.w;
  float res = 0.0;
  vec3 grad = gradLong;
  ${f.detail ? `{
    // the ripple map: its mips filter the fine slopes away with distance; that share of the variance widens the glint
    // and the mirror instead (by the footprint the anisotropic filter works with)
    float fwM = max(min(lx, ly), max(lx, ly) / 8.0);
    float mA = clamp(log2(max(fwM * 48.0, 1e-4)) / 4.0, 0.0, 1.0);
    float mB = clamp(log2(max(fwM * 6.9, 1e-4)) / 4.0, 0.0, 1.0);
    float kA = vF3Alb.w, kB = vF3Cld.w;
    float vA = 0.0145 * kA * kA, vBv = 0.0145 * kB * kB;
    unres += vA * mA + vBv * mB;
    res += vA * (1.0 - mA) + vBv * (1.0 - mB);
    kA = mA < 0.98 ? kA : 0.0;
    kB = mB < 0.98 ? kB : 0.0;
    vec3 g;
    if (flowSpd > 0.05) {
      // two-phase flow map: the ripples advected along the flow, half a cycle apart, cross-faded
      float t1 = fract(uTime / 2.5), t2 = fract(uTime / 2.5 + 0.5);
      g = mix(f3Rip(P - vFlow * t1 * 2.5, uTime, kA, kB), f3Rip(P - vFlow * t2 * 2.5, uTime, kA, kB), abs(t1 * 2.0 - 1.0)) * (1.0 + min(flowSpd, 3.0) * 0.4);
    } else g = f3Rip(P, uTime, kA, kB);
    grad += g - up * dot(g, up);
  }` : ''}
  vec3 nB = normalize(up - grad);
  vec3 dnx = dFdx(nB), dny = dFdy(nB);
  float nVar = min(0.5 * (dot(dnx, dnx) + dot(dny, dny)), 0.12);
  vec3 nV = normalize(uBodyToView * nB);
  vec3 vB = normalize(transpose(uBodyToView) * normalize(-vViewPos));
  // ── light (the vertex's sun colour and sky irradiance; the cascades per pixel) ──
  float muS = dot(up, uSunDirBody);
  vec3 sunCol = vF3Sun.rgb * f3SunShadow(vViewPos, nV);
  vec3 skyE = vF3Sky.rgb;
  float silt = vF3Sky.w;
  // ── refraction + absorption ──
  vec2 suv = gl_FragCoord.xy / uResolution;
  float fragZ = -vViewPos.z;
  float sceneZ0 = ${f.refract ? 'texture(tSceneDepth, suv).r' : 'fragZ + 5.0'};
  float thick0 = max(sceneZ0 - fragZ, 0.0);
  vec2 ruv = suv + nV.xy * 0.016 * clamp(thick0 * 0.25, 0.0, 1.0) / max(fragZ * 0.02, 1.0);
  float sceneZ = ${f.refract ? 'texture(tSceneDepth, ruv).r' : 'sceneZ0'};
  if (sceneZ < fragZ) { ruv = suv; sceneZ = sceneZ0; }
  float cosV = max(abs(normalize(vViewPos).z), 0.05);
  float pathLen = min(max(sceneZ - fragZ, 0.0) / cosV, 400.0);
  vec3 refr = ${f.refract ? 'texture(tSceneColor, ruv).rgb' : 'vec3(0.02, 0.05, 0.07)'};
  vec3 Tw = exp(-vF3Ext.rgb * pathLen);
  vec3 inscat = vF3Alb.rgb * (1.0 - Tw) * (sunCol * max(muS, 0.0) * 0.09 + skyE * 0.1);
  vec3 under = refr * Tw + inscat;
  // ── reflection (ocean.ts: a rough sea mirrors higher sky with less Fresnel; beyond ~30 m and at night the mirror
  // follows the long waves' normal, the ripples' slope variance folded into the roughness) ──
  float viewD = length(vViewPos);
  float skyDay = smoothstep(-0.1, 0.06, muS);
  float meanK = max(smoothstep(20.0, 45.0, viewD), 1.0 - skyDay);
  vec3 nL = normalize(up - gradLong);
  vec3 nR = normalize(mix(nB, nL, meanK));
  float sig2 = unres + meanK * res + nVar * 0.5;
  vec3 rB = reflect(-vB, nR);
  rB = normalize(rB + up * (max(0.0, -dot(rB, up)) * 1.02 + sqrt(sig2) * 0.8));
  vec3 skyR = ${f.sky ? 'skyRadiance(up, rB, uSunDirBody)' : 'skyE * 0.35 / 3.14159'} + uNightAmbient * 0.3;
  ${f.reflect && !CUT.has('nodeck') ? `if (uCloudOn > 0.5) {
    // the deck mirrored along the long waves' normal: its density where that ray crosses the mid-shell (1 cube tap),
    // lit as the vertex found it
    vec3 rL = reflect(-vB, nL);
    rL = normalize(rL + up * max(0.0, -dot(rL, up)) * 1.02);
    vec2 hitL = raySphere(P, rL, 0.5 * (uCloudShell.x + uCloudShell.y));
    if (hitL.y > 0.0) {
      float dens = cloudDensityAt(P + rL * hitL.y, 0.5, 0.0, 0.0, false);
      skyR = mix(skyR, vF3Cld.rgb, (1.0 - exp(-dens * (uCloudShell.y - uCloudShell.x) * 0.5)) * 0.75);
    }
  }` : ''}
  float NdVr = sqrt(pow(max(dot(nR, vB), 1e-3), 2.0) + sig2 * 2.0);
  float F = 0.02 + 0.98 * pow(1.0 - clamp(NdVr, 0.0, 1.0), 5.0);
  ${f.reflect && f.ssr ? `// the banks, trees and boats mirrored, where the Fresnel lets them show
  if (F > 0.03 && viewD < 3000.0) {
    vec4 sr = f3Ssr(vViewPos, normalize(uBodyToView * rB), nV);
    skyR = mix(skyR, sr.rgb, clamp(sr.a, 0.0, 1.0));
  }` : ''}
  // ── sun glint (GGX), roughness from the slope variance this pixel cannot draw ──
  vec3 nG = normalize(mix(nB, nR, 0.5 * meanK));
  float a0 = mix(0.035, 0.07, meanK);
  float a = clamp(sqrt(a0 * a0 + 2.0 * (unres + 0.5 * meanK * res) + nVar * (1.0 - 0.5 * meanK)) + (1.0 - calm) * 0.02, 0.035, 0.45);
  float NdVg = max(dot(nG, vB), 1e-3);
  float a2 = a * a;
  float kG = a * 0.5;
  float visV = NdVg * (1.0 - kG) + kG;
  vec3 hB = normalize(uSunDirBody + vB);
  float NdH = max(dot(nG, hB), 0.0);
  float NdL = max(dot(nG, uSunDirBody), 0.0);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  vec3 glint = sunCol * (a2 / (3.14159 * dd * dd)) * (0.25 / ((NdL * (1.0 - kG) + kG) * visV))
    * (0.02 + 0.98 * pow(1.0 - max(dot(hB, vB), 0.0), 5.0)) * NdL;
  // glitter: sub-pixel facets flashing where the glint is broad (ocean.ts, the same cells and hashes)
  // (s25d: its weight first, the cells and 3 hashes only where it is not zero — calm near water, far water, ponds: identical)
  float gK = smoothstep(0.06, 0.2, a) * smoothstep(0.02, 0.09, fw) * (1.0 - smoothstep(0.8, 3.0, fw)) * smoothstep(0.3, 0.8, vSalt);
  float sparkK = 1.0;
  if (gK > 0.0) {
    float cellM = exp2(floor(log2(max(fw * 2.0, 0.05))));
    vec3 gc = floor(P / cellM);
    float tk = floor(uTime * 6.0 + gn_hash13(gc) * 6.0);
    float spark = gn_hash13(gc + tk * 0.37);
    vec3 gd = P - (gc + 0.25 + 0.5 * gn_hash33(gc + tk)) * cellM;
    gd -= up * dot(gd, up);
    float dotK = exp(-dot(gd, gd) / (cellM * cellM * 0.06));
    sparkK = mix(1.0, 0.3 + 8.0 * step(0.9, spark) * dotK, gK);
  }
  // moonlight: the moonlit sky in the mirror and a path of moon glints
  if (dot(uMoonE, uMoonE) > 0.0) {
    float mUp = smoothstep(-0.03, 0.06, dot(up, uMoonDirBody));
    ${f.sky ? 'skyR += skyRadiance(up, rB, uMoonDirBody) * (uMoonE.g / max(uSunE.g, 1e-6)) * mUp;' : ''}
    vec3 hM = normalize(uMoonDirBody + vB);
    float NdHm = max(dot(nG, hM), 0.0), NdLm = max(dot(nG, uMoonDirBody), 0.0);
    float ddm = NdHm * NdHm * (a2 - 1.0) + 1.0;
    glint += uMoonE * mUp * vF3Ext.w * (a2 / (3.14159 * ddm * ddm)) * (0.25 / ((NdLm * (1.0 - kG) + kG) * visV))
      * (0.02 + 0.98 * pow(1.0 - max(dot(hM, vB), 0.0), 5.0)) * NdLm;
  }
  glint *= sparkK;
  ${CUT.has('noglint') ? 'glint = vec3(0.0);' : ''}
  // the water body's own glow never outshines what it mirrors (cap at half the mirrored sky's luminance)
  {
    vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
    float li = dot(inscat, LUM);
    float cap = 0.5 * dot(skyR, LUM) * (1.0 + 2.0 * silt);
    if (li > cap) under -= inscat * (1.0 - cap / li);
  }
  // ARC §10: a silted river, mud-brown with streaks along the current (rare: arithmetic noise kept)
  if (${CUT.has('norare') ? 'false' : 'silt > 0.0'}) {
    vec3 LUMs = vec3(0.2126, 0.7152, 0.0722);
    float lu = dot(under, LUMs);
    vec3 fd = flowSpd > 0.05 ? vFlow / flowSpd : vec3(0.0);
    vec3 sp = P - vFlow * uTime * 0.6;
    float along = dot(sp, fd);
    vec3 across = sp - fd * along;
    float streak = snoise(across * 0.11 + fd * along * 0.012) * 0.6 + snoise(sp * 0.035 + 7.0) * 0.4;
    float ls = dot(skyR, LUMs);
    under = mix(under, max(lu, 0.17 * ls) * vec3(1.9, 0.84, 0.3) * (0.66 + 0.34 * streak), 0.9 * silt);
    skyR = mix(skyR, ls * vec3(1.15, 1.0, 0.8), 0.45 * silt) * (1.0 - 0.12 * silt);
  }
  vec3 col = mix(under, skyR, F) + glint;

  // ── foam (ocean.ts's terms; their noises are taps of the foam map, only where a term can be non-zero) ──
  float vertThick = max(sceneZ0 - fragZ, 0.0) * cosV;
  vec3 cg = cross(gF3Px, gF3Py);
  float cgl = length(cg);
  float lean = 1.0 - abs(dot(cgl > 1e-20 ? cg / cgl : up, up));
  float level = 1.0 - smoothstep(0.004, 0.03, lean);
  float paper = smoothstep(0.03, 0.12, lean) * (1.0 - smoothstep(0.15, 0.6, vDepth)) * (1.0 - smoothstep(0.3, 0.8, flowSpd));
  float waveE = smoothstep(0.1, 0.5, uWind) * mix(0.12, 1.0, smoothstep(0.3, 0.8, vSalt));
  float riverK = smoothstep(0.15, 0.6, flowSpd);
  float windSpd = length(vWind);
  // the static coarse noise (tile 64 m: lattice 16 / 8 / 4 / 2 m): the shore's pulse and bite, the surge's margin
  vec4 nE = vec4(0.0);
  bool edgeOn = vertThick < 1.6 && vSimD < 0.25;
  bool shoreOn = ${f.foam ? 'true' : 'false'} && waveE > 0.0 && level > 0.0 && fw < 2.0 && vertThick < 1.4;
  bool surgeOn = ${f.foam ? 'true' : 'false'} && vSurge.x > 0.0;
  if (edgeOn || shoreOn || surgeOn) nE = f3N(P, 64.0, vec2(0.0));
  float shore = 0.0;
  if (shoreOn) {
    // the surf's streaks run up and down the beach (tile 32 m: 8 / 4 / 2 / 1 m), the band's edge drifts slowly
    // (s25b: one octave finer than s25 — 2 m streaks, a 1 m band edge: a Perlin cell reads ~2x a simplex one of the same
    // lattice, and the s25 line ran long and even where the original breaks into short bright dashes; 'wshade3=foamold')
    vec4 nS = f3N(P, 32.0, vec2(0.0, -uTime * 0.25 / 32.0 * 0.6));
    float pulse = 0.5 + 0.5 * sin(uTime * 0.9 - vertThick * 2.4 + nE.x * 3.0);
    float tN = vertThick + nS.${FOAMOLD ? 'z' : 'w'} * 0.25;
    float band = mix(0.35, 1.1, pulse);
    shore = smoothstep(0.02, 0.15, tN) * (1.0 - smoothstep(band * 0.5, band, tN)) * level * waveE;
    shore *= 1.0 - smoothstep(0.35, 2.0, fw);
    shore *= mix(0.15, 1.0, smoothstep(-0.2, 0.6, nS.${FOAMOLD ? 'y' : 'z'}));
  }
  float crest = smoothstep(0.75, 1.15, vCrest) * calm;
  float rapids = max(smoothstep(3.5, 5.0, flowSpd) * smoothstep(0.4, 1.2, vDepth), smoothstep(0.06, 0.25, lean) * smoothstep(0.15, 0.8, vDepth) * smoothstep(0.3, 1.0, flowSpd));
  float bedC = clamp(vBedCos, 1e-3, 1.0);
  float bedSlope = sqrt(max(1.0 - bedC * bedC, 0.0)) / bedC;
  float excess = vSurge.x;
  if (surgeOn) excess += (nE.y * 0.65 + nE.z * 0.35 * (1.0 - smoothstep(1.5, 5.0, fw))) * 0.045 * smoothstep(0.0, 0.06, vSurge.x);
  float surge = smoothstep(0.045, 0.16, excess) * (1.0 - smoothstep(0.12, 0.3, bedSlope)) * smoothstep(1.0, 3.0, vDepth)
    * (1.0 - smoothstep(0.5, 1.5, riverK + max(flowSpd - 2.0, 0.0)) * (1.0 - smoothstep(0.1, 0.2, excess)));
  vec3 surgeDown = -(vSurge.yzw - up * dot(vSurge.yzw, up));
  surgeDown = length(surgeDown) > 1e-5 ? normalize(surgeDown) : vec3(0.0);
  surge *= mix(0.4, 1.0, flowSpd > 0.3 ? smoothstep(-0.25, 0.35, dot(surgeDown, vFlow / flowSpd)) : 1.0);
  shore *= mix(1.0, 0.25, riverK);
  // whitecaps by wind speed, born on the crests, drawn out east-west (anisotropic body-frame noise, drifting)
  float cover = clamp(0.0012 * pow(max(windSpd * uWind - 3.5, 0.0), 2.2), 0.0, 0.35);
  float whitecap = 0.0;
  ${CAPOLD ? '' : `// (s25d) the whitecap ramp's lower edge vs the largest input the noise can give (|n| <= 1 in every octave): below it
  // the result is exactly 0, so the tap is skipped (a breeze's open sea between the crests). 'wshade3=capall' = always tap
  float wcLo = 0.0, wcMax = 1.0;
  {
    float wl0 = log2(max(fw * 0.7 * 256.0 / ${WCT}, 1e-3));
    float lG0 = smoothstep(3.0, 5.5, wl0), lA0 = smoothstep(1.0, 3.5, wl0);
    float wsd0 = 0.116 * sqrt(0.77 * max(lG0 - 0.75, 0.0) * 4.0 + 0.23 * max(lA0 - 0.75, 0.0) * 4.0) * 1.7;
    wcLo = 1.0 - cover * 4.0 - wsd0;
    wcMax = 0.5 + 0.5 * (0.55 * inversesqrt(max(1.0 - lG0, 0.25)) + 0.3 * inversesqrt(max(1.0 - lA0, 0.25)) + (vCrest - 0.6) * 0.35);
  }`}
  if (${f.foam ? 'true' : 'false'} && cover > 0.001 && vSalt > 0.3 && vDepth > 2.0 && calm > 0.0${CAPOLD || CUT.has('capall') ? '' : ' && wcMax > wcLo'}) {
    vec4 nW = f3N(P, vec3(0.38, 1.0, 0.38), ${WCT}, vec2(-0.19, 0.125) * uTime / ${WCT});
    // (a thresholded noise read through its mips: the filtered value drifts to the mean, so far out every pixel would be
    // all-white or all-clear. The share of the noise's spread the mips removed (mip level of the 48 m tile: G octave
    // 32 texels, A octave 8) widens the ramp instead: the pixel gets the expected coverage, what the point-sampled
    // original showed as a speckle of the same mean)
    float wl = log2(max(fw * 0.7 * 256.0 / ${WCT}, 1e-3));
    float lG = smoothstep(3.0, 5.5, wl), lA = smoothstep(1.0, 3.5, wl);   // the share of each octave's spread the mips removed
    ${CAPOLD ? `float wcN = nW.y * 0.55 + nW.w * 0.3 + (vCrest - 0.6) * 0.35;
    float wsd = 0.116 * sqrt(0.77 * lG + 0.23 * lA) * 1.7;` : `// (s25c) CONTRAST RESTORED first: each filtered octave is rescaled to the spread it had (up to 2x), so the patches
    // keep the hard edges the point-sampled original showed (the Mac: same amount, but softer and lower in contrast);
    // only the spread beyond that 2x widens the ramp (the expected coverage, as s25b). 'wshade3=capold' = s25b
    float kG = inversesqrt(max(1.0 - lG, 0.25)), kA = inversesqrt(max(1.0 - lA, 0.25));
    float wcN = nW.y * 0.55 * kG + nW.w * 0.3 * kA + (vCrest - 0.6) * 0.35;
    float wsd = 0.116 * sqrt(0.77 * max(lG - 0.75, 0.0) * 4.0 + 0.23 * max(lA - 0.75, 0.0) * 4.0) * 1.7;`}
    whitecap = smoothstep(1.0 - cover * 4.0 - wsd, 1.0 - cover * 2.0 + 0.02 + wsd, wcN * 0.5 + 0.5) * smoothstep(0.3, 0.8, vSalt) * calm * smoothstep(2.0, 8.0, vDepth);
  }
  if (${f.foam ? 'true' : 'false'} && windSpd * uWind > 9.0 && vSalt > 0.3 && calm > 0.0) {
    // a gale's long thin streaks along the wind (the original's 47:1 stretched noise: 1 tap of a stretched frame)
    float gN = f3N(P + vec3(103.3, 2.2, 103.3), vec3(0.03, 1.4, 0.03), 8.0, vec2(0.0)).y;
    float gsd = 0.185 * smoothstep(3.0, 5.5, log2(max(fw * 1.4 * 256.0 / 8.0, 1e-3))) * 1.7;
    whitecap = max(whitecap, smoothstep(0.75 - gsd, 0.95 + gsd, gN * 0.5 + 0.5) * smoothstep(9.0, 16.0, windSpd * uWind) * 0.5 * calm * smoothstep(0.3, 0.8, vSalt));
  }
  float foamAmt = ${f.foam ? '' : '0.0 * '}clamp(max(max(max(max(shore, crest * 0.8), rapids * 0.85), whitecap * 0.7), surge * 0.95), 0.0, 1.0);
  ${CUT.has('foamdbg') ? 'gl_FragColor = vec4(shore, whitecap, max(max(crest, surge), rapids), 1.0); return;' : ''}
  if (foamAmt > 0.01) {
    // (the coarse octaves: taken above only near a shore or a surge; open-sea whitecaps need them too)
    if (!(edgeOn || shoreOn || surgeOn)) nE = f3N(P, 64.0, vec2(0.0));
    // LACE: ridged noise at two scales drifting with the flow (tile 8 m: lattice 2 / 1 / 0.5 / 0.25 m), thinning out
    vec4 nLc = f3N(P - vFlow * uTime, 8.0, vec2(0.0, uTime * 0.07 / 8.0));
    float l1 = 1.0 - abs(nLc.${FOAMOLD ? 'y' : 'z'});   // (s25b: 0.5 / 0.25 m lattice, the simplex's 1.25 / 0.48 m look)
    float l2 = 1.0 - abs(nLc.${FOAMOLD ? 'z' : 'w'});
    float kL = 1.0 - smoothstep(0.15, 0.9, fw * 2.6);
    float l0 = 1.0 - abs(nE.w);   // (2 m lattice: Perlin cells read ~2x the simplex's of the same lattice)
    float fineK = 1.0 - smoothstep(0.03, 0.1, fw);
    float lace = mix(l0 * l0 * l0 * 0.9, l1 * l1 * l1 * 0.75 + l2 * l2 * l2 * l2 * 0.45 * kL, fineK);
    float thinP = smoothstep(0.25, 0.75, nLc.x * 0.5 + 0.5);
    float pat = mix(0.6, clamp(lace * (0.55 + 0.6 * thinP), 0.0, 1.0), 1.0 - smoothstep(0.15, 1.2, fw));
    if (lean > 0.06 && flowSpd > 1.0) pat = mix(pat, 0.75 + 0.25 * smoothstep(0.1, 0.7, nLc.w * 0.5 + 0.5), smoothstep(0.06, 0.2, lean));
    float churn = max(surge, rapids * smoothstep(3.0, 8.0, vDepth));
    float surgeStreak = 0.5;
    if (churn > 0.02) {
      // a surge's face: boils of ~2 m and ~10 m, billows of ~50 m (one more tap, 256 m)
      vec4 nC = f3N(P, 256.0, vec2(0.0, uTime * 0.12 / 256.0));
      float stF = nLc.x * (1.0 - smoothstep(0.4, 1.5, fw));
      float stC = nE.y * (1.0 - smoothstep(3.0, 12.0, fw));
      float stB = nC.y * (1.0 - smoothstep(60.0, 220.0, fw));
      surgeStreak = clamp(0.5 + 0.5 * (stF * 0.45 + stC * 0.6 + stB * 0.7), 0.0, 1.0);
      pat = mix(pat, 0.42 + 0.58 * smoothstep(0.25, 0.7, surgeStreak), churn * 0.85);
    }
    float foam = smoothstep(0.05, 0.9, foamAmt * (0.55 + 0.75 * pat)) * mix(0.8, 0.95, surge);
    foam = mix(foam, 0.95 * mix(0.3, 1.0, smoothstep(0.3, 0.72, surgeStreak)), smoothstep(0.3, 0.9, churn));
    vec3 foamC = vec3(0.85) * (sunCol * max(muS, 0.0) + skyE) / 3.14159;
    foamC *= mix(1.0, 0.7 + 0.3 * smoothstep(0.2, 0.8, surgeStreak), churn);
    col = mix(col, foamC, foam);
  }
  // ── sea ice (rare: ocean.ts's arithmetic noise and Voronoi kept) ──
  // (s25d: a real branch: as a ?: the two simplex could be evaluated on every pixel and then discarded)
  float iceW = 0.0;
  ${CUT.has('norare') ? '/* norare: no ice */ if (false) {' : 'if (vIce > 0.01) {'}
    iceW = smoothstep(0.08, 0.5, vIce + (snoise(P * 0.012) * 0.3 + snoise(P * 0.06) * 0.12) * min(1.0, vIce * 6.0));
  }
  if (iceW > 0.0) {
    vec3 iv = voronoi3(P * 0.09);
    float aa = 1.0 - smoothstep(0.1, 0.45, fw * 0.09 / 0.04);
    float cr = (1.0 - smoothstep(0.0, 0.04 + fw * 0.09, iv.y - iv.x)) * aa;
    vec3 alb = mix(vec3(0.62, 0.72, 0.8), vec3(0.85, 0.89, 0.93), smoothstep(0.3, 1.5, vIce)) * (0.9 + 0.12 * mix(0.5, iv.z, aa));
    alb = mix(alb, vec3(0.2, 0.32, 0.4), cr * 0.6);
    col = mix(col, alb * (sunCol * max(muS, 0.0) + skyE) / 3.14159 + skyR * 0.04, iceW);
  }
  // ── shore blend: the sheet thins to nothing at the ground's contour, bitten by noise (1 tap, above) ──
  {
    float edgeN = edgeOn ? nE.x * 0.3 + nE.w * 0.08 : 0.0;
    float thickE = mix(vertThick, max(vertThick, vDepth), smoothstep(0.25, 1.5, fw));
    float edge = smoothstep(0.012, 0.18, thickE + min(edgeN, 0.12) * smoothstep(1.6, 0.2, thickE) * (1.0 - smoothstep(0.1, 0.25, vSimD)));
    float film = smoothstep(0.03, 0.3, thickE);
    vec3 wetGround = mix(refr, refr * 0.8 + skyR * F * 0.3, film);
    ${f.landCut ? 'edge *= smoothstep(landCut, min(landCut + 0.06, 0.0), vDepth);' : ''}
    col = mix(wetGround, col, edge * (1.0 - paper));
  }
  if (uOverlayK.x > 0.5) {
    vec3 od = normalize(vBodyPos);
    vec4 ov = textureLod(uOverlay, vec2(atan(od.x, od.z) * 0.15915494 + 0.5, asin(clamp(od.y, -1.0, 1.0)) * 0.31830989 + 0.5), 0.0);
    float lum = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    col = mix(col, ov.rgb * (lum * 2.2 + uOverlayK.z * 0.6), ov.a * 0.8);
  }
  gl_FragColor = vec4(col, 1.0);
  ${SSRDBG ? 'gl_FragColor = gF3Steps < -1.5 ? vec4(0.0, 0.0, 1.0, 1.0) : gF3Steps < 0.0 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(vec3(1.0, 1.0, 0.0) * (0.15 + 0.85 * gF3Steps / 24.0), 1.0);' : ''}
}
`;

/**
 * The `?wfast=3` shaders from ocean.ts's default ones (their text: the discards and debug views at the start of the
 * fragment's main are kept verbatim, so changes made there carry over). Returns null (and the caller keeps the
 * default water) if an anchor is not found.
 */
export function fastOceanShaders(vert: string, frag: string, rippleMap: () => DataTexture, morph?: IUniform<Vector4>): { vert: string; frag: string; uniforms: Record<string, IUniform> } | null {
  const vMain = vert.indexOf('void main() {');
  const vEnd = vert.lastIndexOf('#include <logdepthbuf_vertex>');
  const fMain = frag.indexOf('void main() {');
  const fBody = frag.indexOf('  vec3 P = vBodyPos;\n  vec3 up = normalize(P);', fMain);
  if (vMain < 0 || vEnd < vMain || fMain < 0 || fBody < 0) {
    console.warn('wfast=3: ocean shader anchors not found, default water kept');
    return null;
  }
  if (morph && !morphs.includes(morph)) morphs.push(morph);
  const f: F3Flags = {
    detail: !CUT.has('nodetail'), reflect: !CUT.has('noreflect'), ssr: !CUT.has('nossr'), refract: !CUT.has('norefract'),
    foam: !CUT.has('nofoam'), sky: !CUT.has('nosky'), landCut: frag.slice(fMain, fBody).includes('float landCut'),
  };
  return {
    vert: vert.slice(0, vMain) + VERT_DECL + vert.slice(vMain, vEnd) + VERT_MAIN + vert.slice(vEnd),
    frag: frag.slice(0, fMain) + fragDecl(20) + frag.slice(fMain, fBody) + fragMain(f),
    uniforms: { uRipMap: { value: rippleMap() }, uF3Noise: { value: foamNoiseMap() }, uF3KR: krUniform, uF3Mask: maskU.tex, uF3MaskOn: maskU.on },
  };
}

// ───────────────────────────── (s25c) the SSR land mask ─────────────────────────────
// Built once a frame from the linear depth copy (renderer.ts hook, after the copies, before the water): pass 1 reduces
// 4 x 16-pixel blocks, pass 2 the 128-px bands of each column, into a (W/4) x (H/128) RGBA32F texture: per 4-pixel column the lowest and highest
// screen v of LAND pixels — opaque points whose body-frame radius exceeds the planet radius minus a margin (2 m and the
// tide's depression), i.e. anything that can stand above a water surface — and their nearest linear depth. Cost: 2
// small full-screen draws, 64 + ~60 texel reads per output texel.
const maskU = { tex: { value: null as Texture | null }, on: { value: 0 } };
const MASK_PARS = /* glsl */ `
uniform highp sampler2D tLin;
uniform vec4 uP;          // P00, P11, P20, P21 of the projection
uniform mat3 uB2V;
uniform vec3 uCam;
uniform float uLandR;
`;
const MASK1 = /* glsl */ `
${MASK_PARS}
void main() {
  ivec2 sz = textureSize(tLin, 0);
  ivec2 o = ivec2(gl_FragCoord.xy) * ivec2(4, 16);
  mat3 v2b = transpose(uB2V);
  float ymin = 2.0, ymax = -1.0, zmin = 1e30;
  for (int j = 0; j < 16; j++) for (int i = 0; i < 4; i++) {
    ivec2 p = o + ivec2(i, j);
    if (p.x >= sz.x || p.y >= sz.y) continue;
    float d = texelFetch(tLin, p, 0).r;
    if (!(d < 1e8)) continue;
    vec2 ndc = (vec2(p) + 0.5) / vec2(sz) * 2.0 - 1.0;
    vec3 pv = vec3(d * (ndc.x + uP.z) / uP.x, d * (ndc.y + uP.w) / uP.y, -d);
    if (length(uCam + v2b * pv) > uLandR) {
      float v = (float(p.y) + 0.5) / float(sz.y);
      ymin = min(ymin, v); ymax = max(ymax, v); zmin = min(zmin, d);
    }
  }
  gl_FragColor = vec4(ymin, ymax, zmin, 1.0);
}
`;
const MASK2 = /* glsl */ `
uniform highp sampler2D tBlk;
void main() {
  ivec2 sz = textureSize(tBlk, 0);
  ivec2 o = ivec2(gl_FragCoord.xy);
  vec3 m = vec3(2.0, -1.0, 1e30);
  int nb = (sz.y + 7) / 8;
  bool all = o.y >= nb;                     // the extra last row: the whole column
  for (int j = 0; j < 512; j++) {
    if (!all && j >= 8) break;
    int row = all ? j : o.y * 8 + j;
    if (row >= sz.y) break;
    vec3 t = texelFetch(tBlk, ivec2(o.x, row), 0).xyz;
    m = vec3(min(m.x, t.x), max(m.y, t.y), min(m.z, t.z));
  }
  gl_FragColor = vec4(m, 1.0);
}
`;
const VS = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
let mk: { m1: ShaderMaterial; m2: ShaderMaterial; t1: WebGLRenderTarget; t2: WebGLRenderTarget } | null = null;
const _p = new V4();
function maskRT(w: number, h: number): WebGLRenderTarget {
  const t = new WebGLRenderTarget(w, h, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
  t.texture.generateMipmaps = false; t.texture.name = 'water-ssr-mask';
  return t;
}
/**
 * (s25c) renderer.ts hook: build this frame's land mask for the primary planet's water. `pu` = that planet's shader
 * uniforms (uBodyToView, uCamBody, uRadius, uTide). Only with wfast=3 AND `wshade3=ssrmask`; otherwise it returns at once.
 */
export function ssrMaskUpdate(r: WebGLRenderer, fsq: FullscreenQuad, linDepth: Texture, w: number, h: number, proj: Matrix4, pu: Record<string, IUniform> | null): void {
  maskU.on.value = 0;
  if (!WFAST3 || !SSRMASK || !pu || !pu.uBodyToView || !pu.uCamBody || !pu.uRadius) return;
  const cam = pu.uCamBody.value as Vector3, R = pu.uRadius.value as number;
  const tide = pu.uTide ? Math.abs((pu.uTide.value as Vector4).w) : 0;
  if (cam.length() < R + 0.5) return;  // a camera under the sea level: march everywhere
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 16);
  if (!mk) {
    const common = { vertexShader: VS, depthTest: false, depthWrite: false };
    mk = {
      m1: new ShaderMaterial({ ...common, fragmentShader: MASK1, uniforms: { tLin: { value: null }, uP: { value: new V4() }, uB2V: { value: null }, uCam: { value: null }, uLandR: { value: 0 } } }),
      m2: new ShaderMaterial({ ...common, fragmentShader: MASK2, uniforms: { tBlk: { value: null } } }),
      t1: maskRT(bw, bh), t2: maskRT(bw, Math.ceil(bh / 8) + 1),
    };
  }
  if (mk.t1.width !== bw || mk.t1.height !== bh) { mk.t1.setSize(bw, bh); mk.t2.setSize(bw, Math.ceil(bh / 8) + 1); }
  const e = proj.elements;
  const u1 = mk.m1.uniforms;
  u1.tLin.value = linDepth;
  (u1.uP.value as V4).copy(_p.set(e[0], e[5], e[8], e[9]));
  u1.uB2V.value = pu.uBodyToView.value as Matrix3;
  u1.uCam.value = cam;
  u1.uLandR.value = R - 2 - tide;
  const prev = r.getRenderTarget();
  fsq.render(r, mk.m1, mk.t1);
  mk.m2.uniforms.tBlk.value = mk.t1.texture;
  fsq.render(r, mk.m2, mk.t2);
  r.setRenderTarget(prev);
  maskU.tex.value = mk.t2.texture;
  maskU.on.value = 1;
}

// ───────────────────────────── (s25c) `?wvdiag=1`: a TIMING-ONLY diagnostic (the image is wrong) ─────────────────────────────
/**
 * The water vertex stage's ground core (TERRAIN_VERT_CORE: 1-3 tGround evaluations, 12-36 texel reads) replaced by a
 * stub: a smooth sphere at sea level, every fragment dry (vDepth = -50 m), so each fragment dies at its first discard.
 * `P` vs `P&wvdiag=1` vs `P&water=0` splits the water pass into vertex core, raster + the pass around the draw.
 * Works with or without wfast=3.
 */
export const WVDIAG = perfNum('wvdiag', 0) === 1;
export const VDIAG_CORE = /* glsl */ `
  vec4 tA = vec4(0.0); vec3 tN = position; float tS = 0.0; float tH = 0.0; float tDA = 0.0; float tG = 50.0;
  float tLvl = 0.0;
  vec3 tPos = position * uRadius;
  vec3 tNrm = position;
  float tMorph = 0.0;
  float tZEdge = 2.0 * (3.0 * uMorph.z + 2.0);
`;
