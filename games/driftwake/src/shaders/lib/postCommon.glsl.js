/**
 * `lib/postCommon` — the conventions every screen-space pass shares.
 *
 * Ported from the reference's `shaders/lib/postCommon.wgsl`, plus the two
 * tonemap curves that `ARCHITECTURE.md` §3.1 puts in this chunk (the reference
 * kept them inside `tonemap.fragment.wgsl`; moving them here is the only
 * structural change, and it is what the contract asks for).
 *
 * ## The coordinate agreement, derived once
 *
 * Getting this wrong is silent: a vertically mirrored depth lookup still
 * produces plausible-looking occlusion, it is just occlusion belonging to a
 * different part of the frame.
 *
 * The reference derives that `vUV` and `fragCoord.xy / renderSize` are the same
 * number and that a world point projected with the scene transform lands at
 * `ndc * 0.5 + 0.5` — no flip anywhere. In WebGL2 that relationship holds
 * naturally: the texture origin is bottom-left, `gl_FragCoord`'s origin is
 * bottom-left, and `gfx.js`'s fullscreen triangle emits `vUv = position.xy*0.5
 * + 0.5` straight out of clip space. So nothing below introduces a flip, and
 * nothing anywhere in the chain may introduce one either — it has to be in all
 * four places (sun UV, reprojection, depth sampling, colour sampling) or none.
 *
 * ## Handedness (ARCHITECTURE §6, spec §16.5)
 *
 * The reference's view space is **left-handed with +z forward**. Three's is
 * **right-handed with −z forward**. The port takes the spec's Option A: keep the
 * reference's math and negate at the boundary. Concretely, the prepass stores a
 * *positive* linear distance in `.r` exactly as the reference does, and
 * `viewFromDepth` reconstructs a point with a **negative** z — a genuine Three
 * view-space position. Every consumer that wants "distance along the view axis"
 * therefore writes `-p.z`, and those are the only sign changes in the chain.
 */

export default /* glsl */`

// ----------------------------------------------------------------- constants

/// Cleared value of the depth prepass. Must match DEPTH_FAR in depthPass.js.
const float POST_FAR = 9000.0;

/// True where the prepass wrote nothing — sky, or a discarded fragment.
bool isBackground(float z) {
    return z > POST_FAR * 0.5;
}

// --------------------------------------------------------- position rebuild

/**
 * View-space position of a pixel.
 *
 * projInfo is (tan(fovY/2) * aspect, tan(fovY/2)), so the reconstruction is one
 * multiply and needs no matrix. "z" is the linear view depth the prepass stored:
 * a POSITIVE distance, which for a perspective projection is the clip-space w.
 *
 * The -1.0 in the third component (the reference has +1.0) is the whole of the
 * handedness change: Three's view space looks down -z, so a point at distance z
 * in front of the camera has view z = -z.
 */
vec3 viewFromDepth(vec2 uv, float z, vec2 projInfo) {
    vec2 ndc = uv * 2.0 - 1.0;
    return vec3(ndc.x * projInfo.x, ndc.y * projInfo.y, -1.0) * z;
}

/// Screen UV of a view-space position. The exact inverse of viewFromDepth —
/// which is why it divides by -p.z rather than the reference's +p.z.
vec2 uvFromView(vec3 p, vec2 projInfo) {
    float d = -p.z;
    vec2 ndc = vec2(p.x / (projInfo.x * d), p.y / (projInfo.y * d));
    return ndc * 0.5 + 0.5;
}

// -------------------------------------------------------------- small helpers

/// Interleaved gradient noise — the cheapest per-pixel dither that TAA resolves
/// cleanly, because its spectrum is close to blue over a 3x3 neighbourhood.
float ignPost(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

/// Rec.709 luminance. Deliberately a separate name from lib/common's
/// luminance() so a pass may include both chunks without a redefinition.
float lumaPost(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

/**
 * Karis' tonemap/inverse pair — an exact inverse of each other.
 *
 * Averaging HDR samples with a linear weight lets one 200-nit firefly dominate
 * sixteen taps of ordinary snow; averaging in this compressed space and
 * expanding afterwards keeps the mean where the eye expects it. Used by the
 * temporal resolve and the bloom prefilter, and mandatory on this content — the
 * snow emits discrete single-pixel glints by design.
 */
vec3 tonemapWeight(vec3 c) {
    return c / (1.0 + lumaPost(c));
}

vec3 tonemapUnweight(vec3 c) {
    return c / max(1e-4, 1.0 - lumaPost(c));
}

// -------------------------------------------------------------- display chain

/// Set by the composite. Declared here because ARCHITECTURE §3.1 signs
/// applyExposure() with a colour and nothing else; an unused uniform costs
/// nothing in any other stage that includes this chunk.
uniform float uExposure;

vec3 applyExposure(vec3 c) {
    return c * uExposure;
}

// ------------------------------------------------------------------- AgX
//
// WGSL's mat3x3f(a,b,c, d,e,f, g,h,i) builds column-by-column and so does
// GLSL's mat3(...), with the same argument order — so these transcribe
// UNCHANGED. Do not transpose. The matrices are near-symmetric, so a
// transposition error is subtle rather than obvious: it shows up as a small hue
// rotation in saturated highlights only.

const mat3 AGX_IN = mat3(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104
);

const mat3 AGX_OUT = mat3(
     1.19687900512017,  -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417,   -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116
);

/// Sixth-order fit of the AgX contrast curve.
vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2
         - 40.14 * x4 * x
         + 31.96 * x4
         - 6.868 * x2 * x
         + 0.4298 * x2
         + 0.1191 * x
         - 0.00232;
}

vec3 agxInset(vec3 color) {
    const float MIN_EV = -12.47393;
    const float MAX_EV = 4.026069;

    vec3 v = AGX_IN * max(color, vec3(0.0));
    v = clamp(log2(max(v, vec3(1e-10))), vec3(MIN_EV), vec3(MAX_EV));
    v = (v - MIN_EV) / (MAX_EV - MIN_EV);
    return agxContrast(v);
}

/// Gentle saturation recovery. AgX deliberately desaturates highlights; without
/// a little of it back, the cool shadow / warm light split the whole look rests
/// on gets flattened out along with the clipping it was there to prevent.
vec3 agxLook(vec3 color, float sat) {
    float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return max(vec3(0.0), l + (color - l) * sat);
}

/**
 * AgX, end to end. Returns DISPLAY-LINEAR, ready for one sRGB encode.
 *
 * The 2.2 power is mandatory: AgX's contrast polynomial already emits
 * display-encoded values, so it needs its EOTF applied before the shared sRGB
 * encode at the bottom of the composite. Skipping it double-encodes the image —
 * everything lifts toward mid grey and the whole frame goes flat and milky,
 * which on snow is indistinguishable from "the shader is wrong".
 */
vec3 tonemapAgX(vec3 c) {
    vec3 v = agxInset(c);
    v = agxLook(v, 1.14);
    return pow(max(AGX_OUT * v, vec3(0.0)), vec3(2.2));
}

// ------------------------------------------------------------------ ACES

/// Narkowicz fit. Already display-linear, so no extra matrices and no 2.2.
vec3 tonemapACES(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3(0.0), vec3(1.0));
}

// ------------------------------------------------------------------ transfer

/// IEC 61966-2-1, exactly as the reference's linearToSrgb. Named apart from
/// lib/common's linearToSrgb so the two chunks can coexist in one stage.
vec3 linearToSrgbPost(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
}
`;
