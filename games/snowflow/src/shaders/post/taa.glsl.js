/**
 * Temporal anti-aliasing.
 *
 * The one post-process this content genuinely cannot do without. The snow
 * material's whole detail budget is spent on things that live at or below the
 * pixel: two octaves of discrete crystal glints, three tiled grain scales,
 * sastrugi at a decimetre, a rotated Poisson shadow filter dithered per pixel,
 * and a plume of two-centimetre grains. Every one of those is built to be
 * *resolved* by an accumulation rather than to survive on its own — the glint
 * hash is nailed to world space and the shadow rotation is interleaved-gradient
 * noise precisely so that a temporal filter can integrate them. Without one, the
 * field crawls.
 *
 * The reprojection is depth-based rather than motion-vector based, and that is a
 * deliberate trade the port must not "improve": almost everything on screen is
 * static world geometry, so the camera's own motion accounts for essentially all
 * the parallax; the character, the wake and the spray are small, fast and
 * high-contrast, which is exactly the case the neighbourhood clip rejects
 * history for anyway. Adding motion vectors changes the ghosting signature the
 * rest of the chain is tuned against.
 *
 * Handedness: the only line that changes from the reference is the view-ray
 * rebuild, which uses -1.0 for the forward component because Three's view space
 * looks down -z (spec §16.5). `uPrevViewProj` is a column-vector matrix here
 * rather than Babylon's row-vector one, but the two hold the same sixteen
 * numbers in the same slots and `M * vec4(p,1)` means the same thing in both.
 */

export default /* glsl */`
#include "lib/postCommon"

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

/// This frame, unresolved — the SSR pass's output.
uniform sampler2D uSource;
/// Last frame's resolved image.
uniform sampler2D uHistory;
uniform sampler2D uDepth;

/// Last frame's view-projection, UNJITTERED. Reprojecting with a jittered matrix
/// would fold last frame's offset into this frame's history lookup.
uniform mat4  uPrevViewProj;
/// This frame's view -> world (i.e. camera.matrixWorld).
uniform mat4  uInvView;
uniform vec2  uProjInfo;
uniform vec2  uInvRes;
/// Subpixel offset baked into this frame's projection, in NDC.
uniform vec2  uJitterNdc;
/// 0 on the first frame and after a resize — the history is uninitialised VRAM
/// there, and a single NaN in it would propagate for the rest of the session.
uniform float uHistoryValid;
uniform float uEnabled;
/// How much history to keep at rest, 0..1.
uniform float uFeedback;

/**
 * Five-tap Catmull-Rom fetch of the history.
 *
 * The single largest quality decision in this file, and it is not about aliasing
 * at all — it is about accumulated blur. History is resampled at a fractional
 * offset *every frame* and each resample feeds the next, so a bilinear tap does
 * not soften the image once, it convolves it with a tent kernel again and again.
 * Standing still at 0.9 feedback that is roughly ten applications, and the
 * result is visibly softer than the frame the renderer produced — which on a
 * field whose entire detail budget is subpixel-scale is the difference between
 * snow and a grey slope. The bicubic's negative lobes undo most of that.
 *
 * Five bilinear taps rather than sixteen point fetches, by folding each pair of
 * weights into one offset tap. The four corner terms are dropped and NO
 * compensating divide is applied — the weights sum to 1.0 at zero fractional
 * offset and about 0.984 at a half texel in both axes. Normalising them
 * produces a slightly brighter, slightly different-contrast history that will
 * not match the reference.
 */
vec3 historyCatmullRom(vec2 uv, vec2 texSize) {
    vec2 samplePos = uv * texSize;
    vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
    vec2 f = samplePos - texPos1;

    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);

    vec2 w12 = w1 + w2;
    vec2 off12 = w2 / w12;

    vec2 p0  = (texPos1 - 1.0) / texSize;
    vec2 p3  = (texPos1 + 2.0) / texSize;
    vec2 p12 = (texPos1 + off12) / texSize;

    vec3 acc = vec3(0.0);
    acc += textureLod(uHistory, vec2(p12.x, p0.y),  0.0).rgb * (w12.x * w0.y);
    acc += textureLod(uHistory, vec2(p0.x,  p12.y), 0.0).rgb * (w0.x  * w12.y);
    acc += textureLod(uHistory, vec2(p12.x, p12.y), 0.0).rgb * (w12.x * w12.y);
    acc += textureLod(uHistory, vec2(p3.x,  p12.y), 0.0).rgb * (w3.x  * w12.y);
    acc += textureLod(uHistory, vec2(p12.x, p3.y),  0.0).rgb * (w12.x * w3.y);

    // The negative lobes can undershoot past zero on a hard edge, and a negative
    // radiance survives the clip below as a black fringe.
    return max(acc, vec3(0.0));
}

/// The resolve, as a helper — the reference keeps it that way because Babylon
/// forbids a bare return in a fragment main, and the structure reads better.
vec3 resolveTaa(vec2 uv) {
    vec3 cur = textureLod(uSource, uv, 0.0).rgb;

    if (uEnabled < 0.5 || uHistoryValid < 0.5) { return cur; }

    // ---- reprojection ------------------------------------------------------
    // The depth stored here was rasterised through the JITTERED projection, so
    // the ray this pixel actually looked along is the jittered one. Removing the
    // offset before reconstructing is worth the one subtraction: at 0.5 px it is
    // the difference between history that lands on the same surface and history
    // that lands on the far side of a berm crest.
    float z = textureLod(uDepth, uv, 0.0).r;
    vec2 ndc = uv * 2.0 - 1.0 - uJitterNdc;
    // -1.0, not the reference's +1.0: Three's view space looks down -z. `z`
    // itself is still the positive distance the prepass stored, and min() clamps
    // sky pixels to 9000 m so they reproject through a finite point rather than
    // through infinity.
    vec3 view = vec3(ndc.x * uProjInfo.x, ndc.y * uProjInfo.y, -1.0) * min(z, POST_FAR);
    vec4 world = uInvView * vec4(view, 1.0);

    vec4 prevClip = uPrevViewProj * vec4(world.xyz, 1.0);
    // Behind last frame's camera: clip.w is -viewZ in Three, positive in front.
    if (prevClip.w <= 1e-4) { return cur; }

    vec2 prevUV = (prevClip.xy / prevClip.w) * 0.5 + 0.5;

    // Off the edge of last frame is a disocclusion by definition.
    if (any(lessThan(prevUV, vec2(0.0))) || any(greaterThan(prevUV, vec2(1.0)))) {
        return cur;
    }

    // ---- neighbourhood statistics ------------------------------------------
    // Variance clipping rather than a min/max box. A box built from nine taps of
    // a field that *contains* discrete glints is enormous — one lit crystal in
    // the corner of the neighbourhood opens the box wide enough to admit any
    // ghost at all, which is the failure that makes naive TAA smear moving
    // objects across the frame. Clipping to the local distribution instead
    // tracks the surface and ignores the outlier. Gathered in Karis-weighted
    // space, and the history is compared in the same space.
    vec3 m1 = vec3(0.0);
    vec3 m2 = vec3(0.0);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec3 s = tonemapWeight(
                textureLod(uSource, uv + vec2(float(i), float(j)) * uInvRes, 0.0).rgb
            );
            m1 += s;
            m2 += s * s;
        }
    }
    vec3 mu = m1 / 9.0;
    vec3 sigma = sqrt(max(vec3(0.0), m2 / 9.0 - mu * mu));
    vec3 lo = mu - sigma * 1.35;
    vec3 hi = mu + sigma * 1.35;

    // The fetch itself runs in linear HDR; tonemapWeight is applied to its result.
    vec3 raw = tonemapWeight(historyCatmullRom(prevUV, 1.0 / uInvRes));
    // Second line of defence after uHistoryValid: a NaN survives a clamp and
    // would propagate for the rest of the session.
    if (any(notEqual(raw, raw))) { raw = mu; }
    vec3 hist = clamp(raw, lo, hi);

    vec3 curW = tonemapWeight(cur);

    // ---- feedback ----------------------------------------------------------
    // Two things pull it down. Fast screen-space motion, because a long
    // reprojection is a poor prediction and the resampling blur compounds every
    // frame it is kept. And a history that had to be clipped hard, because that
    // is the signal that this pixel is not the same surface it was.
    float motion = length((prevUV - uv) / uInvRes);          // pixels travelled
    float motionFade = 1.0 - clamp(motion / 64.0, 0.0, 1.0) * 0.35;
    float clipFade   = 1.0 - clamp(length(hist - raw) * 4.0, 0.0, 1.0) * 0.45;

    float k = clamp(uFeedback * motionFade * clipFade, 0.0, 0.97);
    return tonemapUnweight(mix(curW, hist, k));
}

void main() {
    fragColor = vec4(resolveTaa(vUv), 1.0);
}
`;
