/**
 * Bloom downsample, with an optional bright-pass on the first level.
 *
 * The thirteen-tap kernel is the one from Jimenez' Call of Duty presentation: a
 * centre box plus four corner boxes, which behaves like a proper low-pass at a
 * 2x reduction and does not fall apart at 4x the way a naive bilinear chain
 * does.
 *
 * The Karis average on the prefilter level is not optional on this content. The
 * snow material emits *discrete glints* — single pixels at many times the
 * surrounding radiance, by design — and a plain mean of a 2x2 group lets one of
 * them dominate the whole group. The result is a bloom that flickers as the
 * glint field turns over, which is precisely the "crawling sparkle" the
 * acceptance criteria rule out, arriving by the back door after TAA has already
 * stabilised the glints themselves. Weighting each group by 1/(1+luma) before
 * averaging keeps the energy and drops the flicker.
 *
 * `uSrcTexel` is TWICE one source texel, set on the CPU. Each of these levels is
 * a 4x reduction, so one destination pixel covers a 4x4 block of the source; a
 * thirteen-tap kernel spaced at one texel only reaches half of it, and the half
 * it misses aliases straight into the glow.
 *
 * The threshold is applied to the raw, pre-exposure resolved scene (spec §6.6):
 * the reference's comment claims exposed units but its data path binds the TAA
 * history, which holds scene radiance. Code over comment — so `threshold 3.0`
 * and `knee 1.4` are in scene-radiance units and only mean the right thing if
 * the port reproduces the reference's absolute radiance scale.
 */

export default /* glsl */`
#include "lib/postCommon"

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

/// On the prefilter level this is the resolved scene at full resolution, bound
/// explicitly; on later levels it is the previous bloom level.
uniform sampler2D uSource;

/// One texel of the SOURCE, in UV, already multiplied by 2 on the CPU.
uniform vec2  uSrcTexel;
/// 1 on the first level: threshold and Karis-average. 0 on the rest.
uniform float uPrefilter;
/// Knee curve: (threshold, threshold - knee, 2*knee, 0.25/knee).
uniform vec4  uCurve;

vec3 tap(vec2 uv) {
    return textureLod(uSource, uv, 0.0).rgb;
}

/// Soft-knee threshold. A hard cut puts a visible contour through any smooth
/// gradient that crosses it, and on a snow field almost every gradient does.
vec3 brightPass(vec3 c, vec4 curve) {
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - curve.y, 0.0, curve.z);
    float soft = rq * rq * curve.w;
    return c * max(soft, br - curve.x) / max(br, 1e-5);
}

void main() {
    vec2 uv = vUv;
    vec2 t = uSrcTexel;

    // Inner 2x2 box (weight 0.5 total) ...
    vec3 a = tap(uv + vec2(-t.x, -t.y));
    vec3 b = tap(uv + vec2( t.x, -t.y));
    vec3 c = tap(uv + vec2(-t.x,  t.y));
    vec3 d = tap(uv + vec2( t.x,  t.y));

    // ... and the four overlapping outer boxes (weight 0.125 each).
    vec3 e = tap(uv + vec2(-2.0 * t.x, -2.0 * t.y));
    vec3 f = tap(uv + vec2( 0.0,       -2.0 * t.y));
    vec3 g = tap(uv + vec2( 2.0 * t.x, -2.0 * t.y));
    vec3 h = tap(uv + vec2(-2.0 * t.x,  0.0));
    vec3 i = tap(uv);
    vec3 j = tap(uv + vec2( 2.0 * t.x,  0.0));
    vec3 k = tap(uv + vec2(-2.0 * t.x,  2.0 * t.y));
    vec3 l = tap(uv + vec2( 0.0,        2.0 * t.y));
    vec3 m = tap(uv + vec2( 2.0 * t.x,  2.0 * t.y));

    vec3 g0 = (a + b + c + d) * 0.25;
    vec3 g1 = (e + f + h + i) * 0.25;
    vec3 g2 = (f + g + i + j) * 0.25;
    vec3 g3 = (h + i + k + l) * 0.25;
    vec3 g4 = (i + j + l + m) * 0.25;

    vec3 outCol;
    if (uPrefilter > 0.5) {
        // Weight the five groups by their own luminance before combining, then
        // threshold once. See the note in the docblock.
        float w0 = 1.0 / (1.0 + lumaPost(g0));
        float w1 = 1.0 / (1.0 + lumaPost(g1));
        float w2 = 1.0 / (1.0 + lumaPost(g2));
        float w3 = 1.0 / (1.0 + lumaPost(g3));
        float w4 = 1.0 / (1.0 + lumaPost(g4));
        float wsum = w0 * 0.5 + (w1 + w2 + w3 + w4) * 0.125;
        outCol = (g0 * w0 * 0.5 + (g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) * 0.125)
               / max(wsum, 1e-5);
        outCol = brightPass(outCol, uCurve);
    } else {
        outCol = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
    }

    fragColor = vec4(outCol, 1.0);
}
`;
