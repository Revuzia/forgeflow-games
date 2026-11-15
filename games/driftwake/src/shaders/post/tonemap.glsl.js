/**
 * The composite: speed streaks, shafts, exposure, bloom, contrast, the display
 * transform, vignette, grain.
 *
 * Everything that has to happen in one place happens here, because each of these
 * is defined relative to the one before it. Shafts are radiance and go in before
 * exposure; contrast is applied in linear so it pushes into the tone curve's
 * shoulder rather than clipping after it; grain goes on after the encode so it
 * reads evenly across the range instead of vanishing in the shadows.
 *
 * Snow renders die at the tonemapper. The scene is a huge, bright, low-contrast
 * surface, so any curve that saturates early turns the whole field into a flat
 * white sheet with no form — the single most common failure in snow rendering.
 * AgX is the default for exactly that reason: it desaturates toward white as it
 * approaches the shoulder instead of hue-shifting, and its shoulder is long
 * enough that a sunlit drift at 6x middle grey still has legible gradation.
 *
 * THE ORDER BELOW IS NORMATIVE. Each step's constants are calibrated against its
 * position; do not reorder.
 *
 *   1 sample DOF · 2 radial smear (scene radiance) · 3 shafts (scene radiance)
 *   4 exposure · 5 bloom · 6 spindrift (exposed linear) · 7 contrast about 0.18
 *   8 tonemap (returns display-linear) · 9 vignette · 10 sRGB encode · 11 grain
 *
 * The target this writes into is RGBA8 and the values leaving here are already
 * sRGB-encoded, so nothing downstream — not the sharpen pass, not the renderer's
 * output colour space — may encode again.
 *
 * Handedness: none. Everything here is screen space.
 */

export default /* glsl */`
#include "lib/postCommon"

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

/// The depth-of-field result — the chain's main input at this point.
uniform sampler2D uSource;
/// Quarter-resolution bright pass — the tight glow around a glint or the sun.
uniform sampler2D uBloomNear;
/// Sixteenth-resolution, blurred — the broad halo that reads as atmosphere.
uniform sampler2D uBloomFar;
uniform sampler2D uShafts;

// uExposure is declared by lib/postCommon and consumed through applyExposure().
uniform float uContrast;
uniform float uMode;          // 0 = AgX, 1 = ACES, 2 = none
uniform float uGrainAmount;
uniform float uTime;
/**
 * The grain hash's time term, ALREADY REDUCED modulo 2*pi on the CPU.
 *
 * The reference writes the grain as one expression:
 *
 *   fract(sin(dot(vUV*vec2(1920,1080) + vec2(t*91.7, t*43.3),
 *                 vec2(12.9898, 78.233))) * 43758.5453)
 *
 * The time terms only ever enter that dot product as the scalar
 * t*(91.7*12.9898 + 43.3*78.233) = t*4578.65356, so folding them to their
 * 2*pi-equivalent leaves sin() — and therefore every pixel of grain — exactly
 * where it was. It is an algebraic identity on the reference's own constants,
 * not a retune.
 *
 * It is also mandatory here. WebGPU's sin() survives a large argument; GLSL ES
 * on the ANGLE/D3D11 backend this port is verified against does not. The
 * spatial term alone reaches 1920*12.9898 + 1080*78.233 = 109432, and once the
 * accumulated time pushes the argument past 2^17 the float32 ulp doubles to
 * 1/64 — larger than the 2*pi/43758.5453 = 1.4e-4 step the fract() needs to
 * decorrelate neighbouring pixels. The hash then collapses onto a lattice and
 * the "grain" becomes a fixed ~2.4 px diagonal weave stamped over the whole
 * frame, sky included. Measured: at post.time 3.3 s the frame is clean, at
 * 5.4 s the diagonal peak in a pure-sky FFT is 16x its previous magnitude.
 * Reduced this way the argument never leaves the range it has at t = 0.
 */
uniform float uGrainPhase;
uniform float uVignette;
/// 0 = standing still, 1 = flat out on a surf run. Drives the speed streaks.
uniform float uSpeedStreak;
uniform float uBloomAmount;
uniform float uShaftAmount;

// ------------------------------------------------------------ speed streaks
//
// Two effects, both gated on the same value and both confined to the periphery,
// because that is where speed is actually read: the centre of the frame is what
// the player is looking at and blurring it just makes the demo feel broken.
//
//   radial smear   six taps drawn toward the focus. The one that does the work —
//                  it is the only thing in the chain that makes the *scene* look
//                  fast rather than decorating it.
//   spindrift      sparse radial strands of blown snow tearing past the lens,
//                  phase-advanced with time so they stream outward.
//
// Both are applied before the tonemapper so its shoulder rolls the strands off
// rather than letting them clip.

float streakStrands(vec2 d, float r, float t) {
    float ang = atan(d.y, d.x);
    float a = ang * 96.0;
    float cell = floor(a);
    float rnd = fract(sin(cell * 12.9898 + 4.1) * 43758.5453);
    // Only a fraction of the angular cells carry a strand; a strand in every one
    // reads as a zoom-blur artefact rather than as blowing snow.
    if (rnd > 0.34) { return 0.0; }

    float across = abs(fract(a) - 0.5) * 2.0;
    // The radial frequency decides whether this reads as blowing snow or as
    // scratches on the lens. At one cycle across the frame a strand is a
    // straight line from the centre to the corner; at fourteen it is a
    // two-centimetre dash, which is what a grain of spindrift crossing the frame
    // in a fifteenth of a second actually looks like.
    float phase = fract(r * (11.0 + rnd * 24.0) - t * (7.0 + rnd * 22.0));
    float seg = smoothstep(0.55, 0.86, phase) * (1.0 - smoothstep(0.86, 1.0, phase));
    return pow(1.0 - across, 20.0) * seg;
}

void main() {
    vec3 c = texture(uSource, vUv).rgb;

    // 2. Radial smear, on the scene radiance before exposure.
    vec2 dFocus = vUv - vec2(0.5, 0.5);
    float radius = length(dFocus) * 2.0;
    float streak = uSpeedStreak * smoothstep(0.34, 1.05, radius);
    if (streak > 0.002) {
        vec3 acc = c;
        for (int i = 1; i <= 6; i++) {
            float t = float(i) / 6.0 * streak * 0.026;
            // textureLod, not texture: this loop sits under a non-uniform
            // branch, where implicit derivatives are undefined.
            acc += textureLod(uSource, vUv - dFocus * t, 0.0).rgb;
        }
        c = mix(c, acc / 7.0, 0.88);
    }

    // 3. Light shafts, in scene radiance so the tone curve rolls them off with
    // everything else. ADDED rather than blended: a shaft is light arriving at
    // the lens along a path, not a surface that replaces what is behind it.
    if (uShaftAmount > 0.0001) {
        c += textureLod(uShafts, vUv, 0.0).rgb * uShaftAmount;
    }

    // 4. Exposure.
    c = applyExposure(c);

    // 5. Bloom, weighted toward the wide level: a tight halo on a snow field
    // reads as a rendering artefact, a broad one reads as glare in the air.
    if (uBloomAmount > 0.0001) {
        vec3 near = textureLod(uBloomNear, vUv, 0.0).rgb;
        vec3 far  = textureLod(uBloomFar,  vUv, 0.0).rgb;
        c += (near * 0.35 + far * 0.65) * uBloomAmount;
    }

    // 6. Blown snow, added in exposed linear so its brightness is stated
    // relative to middle grey rather than to whatever the scene sits at.
    if (streak > 0.002) {
        float s = streakStrands(dFocus, radius, uTime);
        c += vec3(0.88, 0.94, 1.06) * s * streak * 0.16;
    }

    // 7. Contrast about middle grey, in linear before the curve so it pushes
    // into the tonemapper's shoulder rather than clipping after it.
    if (abs(uContrast - 1.0) > 0.001) {
        c = 0.18 * pow(max(c / 0.18, vec3(1e-5)), vec3(uContrast));
    }

    // 8. Every branch returns DISPLAY-LINEAR, ready for one sRGB encode.
    vec3 mapped;
    if (uMode < 0.5) {
        mapped = tonemapAgX(c);
    } else if (uMode < 1.5) {
        mapped = tonemapACES(c);
    } else {
        mapped = clamp(c, vec3(0.0), vec3(1.0));
    }

    // 9. Vignette, very slight — enough to keep the eye centred on a scene with
    // no UI to anchor it.
    if (uVignette > 0.001) {
        float d = length(vUv - vec2(0.5)) * 1.414;
        mapped *= mix(1.0, smoothstep(1.05, 0.35, d), uVignette);
    }

    // 10. The one and only encode.
    vec3 outCol = linearToSrgbPost(mapped);

    // 11. Grain, after the encode so it reads evenly across the range instead of
    // vanishing in the shadows. The (1920,1080) basis is fixed, so the grain
    // cell size is the same on screen at any render resolution.
    //
    // The time term arrives pre-folded in uGrainPhase — see its declaration.
    // Same hash, same pixels; only the float32 headroom differs.
    if (uGrainAmount > 0.0001) {
        float n = fract(sin(dot(vUv * vec2(1920.0, 1080.0), vec2(12.9898, 78.233))
                + uGrainPhase) * 43758.5453);
        outCol += (n - 0.5) * uGrainAmount;
    }

    fragColor = vec4(outCol, 1.0);
}
`;
