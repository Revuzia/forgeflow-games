/**
 * WORLD ACTIVITIES — the four shader families lane W draws with
 * (_spec/QUEST_DESIGN.md §3.1 relic caches, §3.2 wake trial gates, §7 the
 * waypoint beacon). RawShaderMaterial + GLSL3 only, `lib/common` globals
 * block, no Three lights, no stock materials.
 *
 *   CACHE      the crystal family's own beauty pair — `lib/crystal`'s
 *              `crystalPoint()` places every vertex, and the fragment IS
 *              `shaders/crystal.glsl.js`'s ice fragment with one injected
 *              seam (the `world/shrine.js` technique: a build-time string
 *              transform that THROWS if its anchors drift). The seam adds a
 *              realm tint and a per-prism pulsing EMBER of light carried in
 *              the data texture's spare row-2 channels (z = glow amount,
 *              w = gold mix), so an unopened cache breathes and an opened one
 *              is dark ice. One draw for all fifteen caches of a realm.
 *
 *   GLINT      the far-visible sparkle over an unopened cache: one
 *              camera-facing star per cache, additive, pulsing, at FULL
 *              strength out to its read range ("visible from 90 m",
 *              QUEST §3.1: caches.js passes 90 m + a 15 m camera arm, as
 *              CAMERA distance) and distance-faded to nothing over the
 *              next 20%.
 *              Its world size grows with distance so it keeps a readable
 *              angular size out to the fade. One draw for all fifteen.
 *
 *   GATE       a wake-trial ring gate: a torus stood upright across the
 *              surf line, additive ice-light with a Fresnel rim and a flow
 *              band running round the ring. Every gate of every trial in the
 *              realm is one instance of one lattice — one draw.
 *
 *   BEACON     the waypoint light column (QUEST §7a): a camera-facing
 *              vertical ribbon, realm-tinted ice-light, rising bands, a bright
 *              pool at its foot. Full strength out to 400 m (faded to nothing
 *              over the next 10%), faded out inside 15 m so a player standing
 *              at the target is not blinded. One draw.
 *
 * All animation is shader-side off `uTime` (the spell system's game clock), so
 * a pause freezes it with everything else and no CPU time is spent on it.
 *
 * EMISSION. The scene is HDR and tone-mapped at `S.exposure` (settings.js,
 * 0.105 by default and graded per realm), so a radiance of ~1 lands at ~10%
 * of display white. GLINT, GATE and BEACON are SIGNALS — "ride here" — not
 * scene lights, so their output is authored in DISPLAY units: the shader's
 * intensity times `uXxxGain = gain / S.exposure`, written by the owning
 * system each frame (only on a change). Measured 2026-09-30 in the live page
 * before this: the beacon at 200 m was ~2/255 over the sky (invisible) and a
 * gate at 29 m a pale ring. CACHE is crystal-family scene geometry and keeps
 * scene units.
 */

import { fragment as crystalFragment } from "./crystal.glsl.js";

/** The exposure the emission gains are calibrated at (settings.js default). */
export const REF_EXPOSURE = 0.105;

/**
 * Display-unit gain for an additive signal at the live exposure (see
 * EMISSION). Build-time / probe helper; the frame path inlines the division.
 * @param {number} gain @param {{exposure?:number}|null|undefined} S
 * @returns {number}
 */
export function emissionGain(gain, S) {
    const ex = S && S.exposure > 0 ? S.exposure : REF_EXPOSURE;
    return gain / ex;
}

/* ------------------------------------------------------------------ *
 * CACHE — crystal-family formation
 * ------------------------------------------------------------------ */

/**
 * Beauty vertex: `crystal.glsl.js`'s vertex stage verbatim plus ONE varying,
 * the row-2 spare pair (glow amount, gold mix) the fragment seam reads.
 * @type {string}
 */
export const cacheVertex = /* glsl */`
#include "lib/crystal"

in vec3 position;               // (crystal, vertex, unused)

uniform sampler2D crystalTex;

out vec4 vWorldH;
out float vSeed;
out vec2 vGlow;                 // (amount, gold mix) — row 2 .zw

void main() {
    int i = int(position.x);
    int v = int(position.y);

    vec4 a = texelFetch(crystalTex, ivec2(i, 0), 0);
    vec4 c = texelFetch(crystalTex, ivec2(i, 2), 0);

    vec3 P = crystalPoint(crystalTex, i, v);

    vWorldH = vec4(P, clamp((P.y - a.y) / max(a.w, 1e-3), 0.0, 1.0));
    vSeed = c.y;
    vGlow = c.zw;

    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

/**
 * The crystal ice fragment with the cache seam injected. Same anchors the
 * shrine and the portal use; the transform throws if they move so an upstream
 * shader edit fails the boot loudly instead of silently shipping an unlit cache.
 * @returns {string}
 */
export function cacheFragment() {
    const A1 = "in float vSeed;";
    const A2 = "color = aerial(color, world);";
    if (crystalFragment.indexOf(A1) < 0 || crystalFragment.indexOf(A2) < 0) {
        throw new Error(
            "worldact.glsl.js: crystal fragment anchors moved — re-seat the cache seam");
    }
    return crystalFragment
        .replace(A1, A1 +
            "\nin vec2 vGlow;" +
            "\nuniform vec3 uCacheTint;" +
            "\nuniform float uCacheTintAmt;" +
            "\nuniform vec3 uCacheGlowIce;" +
            "\nuniform vec3 uCacheGlowGold;")
        .replace(A2,
            // Realm tint first (the shrine's seam), then the ember. The ember
            // is strongest low in the prism — light pooled in the heart of the
            // cache — and breathes on a per-prism phase so a formation
            // shimmers rather than blinking as one lamp.
            "color = mix(color, color * uCacheTint, uCacheTintAmt);\n    " +
            "float cBreath = 0.62 + 0.38 * sin(uTime * 2.4 + vSeed * 6.2831853);\n    " +
            "float cHeart = 0.55 + 0.45 * (1.0 - vHeight01);\n    " +
            "color += mix(uCacheGlowIce, uCacheGlowGold, vGlow.y) * vGlow.x * cBreath * cHeart;\n    " +
            A2);
}

/* ------------------------------------------------------------------ *
 * GLINT — the far sparkle
 * ------------------------------------------------------------------ */

/** Pool size for the glint uniform arrays — one per cache in a realm. */
export const GLINT_MAX = 15;

/** GLSL smoothstep, for the CPU twins below. */
function smoothstepJS(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/**
 * CPU twin of the glint vertex stage's distance fade (keep in step with
 * `glintVertex`): 1 inside `far`, 0 past 1.2 x far. For probes and any HUD
 * that wants to know whether a glint is on screen.
 * @param {number} d camera distance, m @param {number} far @returns {number}
 */
export function glintFade(d, far) {
    return 1 - smoothstepJS(far, far * 1.2, d);
}

/**
 * CPU twin of the beacon vertex stage's fade (keep in step with
 * `beaconVertex`): 0 inside near/3, 1 from `near` to `far`, 0 past 1.1 x far.
 * @param {number} d horizontal camera distance, m
 * @param {number} far @param {number} near @returns {number}
 */
export function beaconFade(d, far, near) {
    return (1 - smoothstepJS(far, far * 1.1, d)) * smoothstepJS(near * 0.33, near, d);
}

export const glintVertex = /* glsl */`
#include "lib/common"

in vec3 position;               // (corner x -1..1, corner y -1..1, glint index)

uniform vec4 uGlintA[${GLINT_MAX}];     // (x, y, z, base half-size m)
uniform vec4 uGlintB[${GLINT_MAX}];     // (r, g, b, intensity; 0 = hidden)
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uGlintFar;                // read range, m: full strength inside it,
                                        // faded to nothing over the next 20%

out vec2 vUv;
out vec4 vCol;

void main() {
    int i = int(position.z);
    vec4 A = uGlintA[i];
    vec4 B = uGlintB[i];

    float d = distance(A.xyz, uCameraPos);
    float fade = 1.0 - smoothstep(uGlintFar, uGlintFar * 1.2, d);
    float live = step(0.0001, B.a) * fade;

    // Per-cache phase hashed off the position: fifteen caches never pulse in
    // step, and nothing is uploaded to make it so.
    float phase = fract(A.x * 0.01371 + A.z * 0.02917) * 6.2831853;
    float pulse = 0.5 + 0.5 * sin(uTime * 2.4 + phase);

    // Angular floor: past ~20-30 m the star keeps ~2.5 deg of screen instead
    // of shrinking to a speck, which is what makes it a far read at all
    // (at 0.016 / ~1.8 deg its visible core was ~5 px at 90 m, measured).
    float size = max(A.w, d * 0.022) * (0.8 + 0.35 * pulse) * live;

    vec3 P = A.xyz + (uCamRight * position.x + uCamUp * position.y) * size;

    vUv = position.xy;
    vCol = vec4(B.rgb, B.a * fade * (0.45 + 0.55 * pulse));
    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

export const glintFragment = /* glsl */`
#include "lib/common"

in vec2 vUv;
in vec4 vCol;

uniform float uGlintGain;       // exposure-normalised emission (see EMISSION below)

layout(location = 0) out vec4 outColor;

void main() {
    vec2 p = vUv;
    float r2 = dot(p, p);
    // A soft core plus four thin rays and a fainter diagonal pair — the
    // snow-glint grammar the ground shader's own glints already speak.
    float core = exp(-r2 * 22.0) * 1.6 + exp(-r2 * 5.0) * 0.28;
    float rays = exp(-abs(p.x) * 26.0) * exp(-p.y * p.y * 2.2)
               + exp(-abs(p.y) * 26.0) * exp(-p.x * p.x * 2.2);
    vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.70710678;
    float diag = (exp(-abs(q.x) * 34.0) * exp(-q.y * q.y * 6.0)
                + exp(-abs(q.y) * 34.0) * exp(-q.x * q.x * 6.0)) * 0.35;
    float edge = 1.0 - smoothstep(0.75, 1.0, max(abs(p.x), abs(p.y)));
    float I = (core + rays * 0.8 + diag) * edge * vCol.a;
    if (I < 0.002) discard;
    outColor = vec4(vCol.rgb * (I * uGlintGain), 1.0);
}
`;

/* ------------------------------------------------------------------ *
 * GATE — wake trial ring
 * ------------------------------------------------------------------ */

/** Pool size for the gate uniform arrays: 3 trials x 12 gates. */
export const GATE_MAX = 36;
/** Torus tessellation: segments round the ring, sides round the tube. */
export const GATE_SEG = 40;
export const GATE_SIDES = 6;

export const gateVertex = /* glsl */`
#include "lib/common"

in vec3 position;               // (theta 0..1, phi 0..1, gate index)

uniform vec4 uGateA[${GATE_MAX}];   // (x, centre y, z, heading rad of the gate normal)
uniform vec4 uGateB[${GATE_MAX}];   // (intensity, highlight 0..1, ring radius m, passed 0..1)

out vec3 vN;
out vec3 vW;
out float vTheta;
out vec3 vS;                    // (intensity, highlight, passed)

void main() {
    int i = int(position.z);
    vec4 A = uGateA[i];
    vec4 B = uGateB[i];

    float theta = position.x * 6.2831853;
    float phi = position.y * 6.2831853;

    // Gate frame. n = the travel direction the ring faces (PORT FRAME
    // forward = (sin h, 0, -cos h), the controller's own convention), t = the
    // horizontal across-track axis, up = world up.
    vec3 n = vec3(sin(A.w), 0.0, -cos(A.w));
    vec3 t = vec3(cos(A.w), 0.0, sin(A.w));
    vec3 up = vec3(0.0, 1.0, 0.0);

    float live = step(0.0001, B.x);
    // The next gate swells a touch so it is the one the eye finds.
    float R = B.z * (1.0 + 0.06 * B.y) * live;
    float tube = (0.10 + 0.07 * B.y) * live;

    vec3 ringDir = t * cos(theta) + up * sin(theta);
    vec3 tubeN = ringDir * cos(phi) + n * sin(phi);
    vec3 P = A.xyz + ringDir * R + tubeN * tube;

    vN = tubeN;
    vW = P;
    vTheta = theta;
    vS = vec3(B.x, B.y, B.w);
    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

export const gateFragment = /* glsl */`
#include "lib/common"

in vec3 vN;
in vec3 vW;
in float vTheta;
in vec3 vS;

uniform vec3 uGateTint;         // realm ice-light
uniform vec3 uGateHot;          // the next-gate accent
uniform float uGateGain;        // exposure-normalised emission (see EMISSION below)

layout(location = 0) out vec4 outColor;

void main() {
    vec3 V = normalize(uCameraPos - vW);
    vec3 N = normalize(vN);
    float fres = pow(1.0 - abs(dot(N, V)), 2.0);

    // Light running round the ring toward the rider: the flow band reads as
    // "this way through" without any arrow.
    float flow = 0.72 + 0.28 * sin(vTheta * 6.0 - uTime * 5.0);
    vec3 col = mix(uGateTint, uGateHot, vS.y);
    float I = vS.x * (0.35 + 1.25 * fres) * flow;
    // A passed gate flashes white and dies away (vS.z rises 0 -> 1 as it fades).
    col = mix(col, vec3(1.0), vS.z * 0.6);
    if (I < 0.002) discard;
    outColor = vec4(col * (I * uGateGain), 1.0);
}
`;

/* ------------------------------------------------------------------ *
 * BEACON — the waypoint light column
 * ------------------------------------------------------------------ */

/** Vertical subdivisions of the ribbon (the gradient needs a few rows). */
export const BEACON_ROWS = 12;

export const beaconVertex = /* glsl */`
#include "lib/common"

in vec3 position;               // (u -1..1 across, v 0..1 up, unused)

uniform vec4 uBeaconA;          // (x, ground y, z, on 0/1)
uniform float uBeaconH;         // column height, m
uniform float uBeaconFar;       // read range, m: full strength inside it
uniform float uBeaconNear;      // fading out inside this, m (gone at 1/3 of it)

out vec2 vUv;
out float vFade;

void main() {
    vec3 base = uBeaconA.xyz;
    vec3 toCam = uCameraPos - base;
    float d = length(toCam.xz);
    // Face the camera about the vertical axis only: a light column stays
    // upright however the rider pitches the view.
    vec2 fl = d > 1e-3 ? toCam.xz / d : vec2(0.0, 1.0);
    vec3 right = vec3(-fl.y, 0.0, fl.x);

    // Constant-ish angular width: ~0.9 deg at every range out to 400 m.
    float halfW = clamp(d * 0.0078, 0.9, 3.4);
    float fade = uBeaconA.w
        * (1.0 - smoothstep(uBeaconFar, uBeaconFar * 1.1, d))
        * smoothstep(uBeaconNear * 0.33, uBeaconNear, d);

    vec3 P = base + right * (position.x * halfW) + vec3(0.0, position.y * uBeaconH, 0.0);
    // A dead column collapses to its foot and rasterises nothing.
    P = mix(base, P, step(0.0001, fade));

    vUv = position.xy;
    vFade = fade;
    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

export const beaconFragment = /* glsl */`
#include "lib/common"

in vec2 vUv;
in float vFade;

uniform vec3 uBeaconTint;
uniform float uBeaconH;
uniform float uBeaconGain;      // exposure-normalised emission (see EMISSION below)

layout(location = 0) out vec4 outColor;

void main() {
    float x = vUv.x;
    float v = vUv.y;
    float hM = v * uBeaconH;                      // metres up the column

    float core = exp(-x * x * 26.0);
    float halo = exp(-x * x * 3.2) * 0.30;
    float soft = 1.0 - x * x;                     // no hard ribbon edge

    // Bands rising up the column, a slow facet-shimmer riding on them.
    float bands = 0.70 + 0.30 * sin((hM * 0.085 - uTime * 0.55) * 6.2831853);
    float shimmer = 0.90 + 0.10 * sin(hM * 0.9 + uTime * 3.1);
    float up = pow(1.0 - v, 1.35);                 // thins toward the top
    float pool = exp(-hM * 0.28) * 1.4;            // bright pool at the foot

    float I = (core * 2.1 + halo) * soft * (up * bands * shimmer + pool) * vFade;
    if (I < 0.002) discard;
    // Ice-white core, realm tint in the halo — the crystal family's read.
    vec3 col = mix(uBeaconTint, vec3(0.92, 0.97, 1.0), core * 0.55);
    outColor = vec4(col * (I * uBeaconGain), 1.0);
}
`;
