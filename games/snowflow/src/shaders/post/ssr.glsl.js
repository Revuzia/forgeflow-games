/**
 * Screen-space reflections, on ice only.
 *
 * A snow field is a rough dielectric with a 0.028 F0 — there is nothing to
 * reflect off it that the sky lookup in the material does not already give
 * exactly. The one genuinely specular surface here is what Crystallise leaves
 * behind: hexagonal prisms at roughness 0.07, and the glaze they write into the
 * terrain state buffer's ice channel. So the pass is gated on the prepass mask
 * (`.g`), and the mask is non-zero on precisely those pixels. On every frame
 * where nobody has cast Crystallise it costs one texture fetch and a branch,
 * which is why it can afford to march at full resolution when it does fire.
 *
 * What it buys: the ice already reflects the *sky* correctly and cheaply. What
 * it cannot know analytically is that there is a dune, a trench, or the
 * character standing in the direction it is reflecting.
 *
 * ## Handedness — read before "fixing" the normal
 *
 * Spec §4.5 documents the reference's shipped behaviour precisely: under its
 * left-handed view space, `cross(dx, dy)` yields the normal pointing AWAY from
 * the camera, so `dot(-V, N)` is <= 0 on front-facing geometry, `clamp` drives
 * it to 0, and the Schlick term evaluates to `f = 0.045 + 0.955 = 1.0`. The
 * effective blend weight is therefore `clamp(mask * edgeFade * strength, 0, 1)`
 * — where the march finds geometry the reflection REPLACES the shaded colour
 * almost entirely. That is what the reference screenshots show.
 *
 * Three's view space is right-handed, so the identical expression `cross(dx,dy)`
 * yields the normal pointing TOWARD the camera and `f` collapses to 0.045 — a
 * twenty-two-fold weaker reflection. To reproduce the documented behaviour the
 * cross product is written `cross(dy, dx)` here. `reflect(I, N)` is invariant
 * under N -> -N, so R and the march are identical either way; only the Schlick
 * term moves. This is a deliberate, single-line deviation from the literal text
 * of §16.5's porting table in favour of §4.5's statement of shipped behaviour.
 */

export default /* glsl */`
#include "lib/postCommon"

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

/// The beauty buffer: both the colour this pass writes through and the thing it
/// reflects. Reflections come out of the un-resolved scene, before TAA.
uniform sampler2D uSource;
uniform sampler2D uDepth;

uniform vec2  uProjInfo;
uniform vec2  uInvRes;
uniform float uEnabled;
uniform float uStrength;

/// Coarse steps along the ray, then a short binary refine on the hit.
const int STEPS = 28;
const int REFINE = 5;
/// Thickness the depth buffer is assumed to have, in metres. A screen-space ray
/// can only see the front surface of anything, so a hit is accepted when it
/// lands behind the buffer by less than this — too small and reflections
/// dropped by grazing rays flicker, too large and the ray "hits" the sky behind
/// a dune.
const float THICKNESS = 0.55;

/// The reflection, or a negative weight when the march found nothing.
vec4 reflectionAt(vec2 uv, vec2 pix, float z, float mask) {
    vec4 miss = vec4(0.0, 0.0, 0.0, -1.0);

    vec3 P = viewFromDepth(uv, z, uProjInfo);

    // Facet normal from the depth buffer. On a hexagonal prism that is exactly
    // right — the facets are flat by construction, and the crystal material
    // builds its own shading normal the same way, from screen-space derivatives.
    vec2 e = uInvRes;
    float zr = textureLod(uDepth, uv + vec2(e.x, 0.0), 0.0).r;
    float zu = textureLod(uDepth, uv + vec2(0.0, e.y), 0.0).r;
    if (isBackground(zr) || isBackground(zu)) { return miss; }

    vec3 dx = viewFromDepth(uv + vec2(e.x, 0.0), zr, uProjInfo) - P;
    vec3 dy = viewFromDepth(uv + vec2(0.0, e.y), zu, uProjInfo) - P;
    // cross(dy, dx), not cross(dx, dy) — see the handedness note in the docblock.
    // This is the normal pointing AWAY from the camera, matching the reference's
    // shipped sign in its left-handed view space.
    vec3 N = normalize(cross(dy, dx));

    vec3 V = normalize(P);           // the camera sits at the view-space origin
    vec3 R = reflect(V, N);
    // A ray heading back toward the eye has nothing on screen to find. In Three
    // "forward" is -z, so the reference's (R.z < 0.02) becomes (-R.z < 0.02).
    if (-R.z < 0.02) { return miss; }

    // Step length set so the ray crosses roughly one pixel per step near the
    // surface, jittered to break the banding a fixed step leaves on a flat facet.
    float stride = max(0.06, z * 0.035);
    float t = stride * (0.5 + ignPost(pix));
    float prevT = 0.0;
    float hitT = -1.0;

    for (int i = 0; i < STEPS; i++) {
        vec3 Q = P + R * t;
        vec2 sUV = uvFromView(Q, uProjInfo);
        if (any(lessThan(sUV, vec2(0.0))) || any(greaterThan(sUV, vec2(1.0)))) { break; }

        float sz = textureLod(uDepth, sUV, 0.0).r;
        // -Q.z is the ray's distance along the view axis, in the same positive
        // units the prepass stored.
        float diff = -Q.z - sz;
        if (diff > 0.0 && diff < THICKNESS) {
            // Binary refine between the last miss and this hit.
            float lo = prevT;
            float hi = t;
            for (int k = 0; k < REFINE; k++) {
                float mid = (lo + hi) * 0.5;
                vec3 M = P + R * mid;
                float mz = textureLod(uDepth, uvFromView(M, uProjInfo), 0.0).r;
                if (-M.z - mz > 0.0) { hi = mid; } else { lo = mid; }
            }
            hitT = hi;
            break;
        }
        prevT = t;
        // Geometric growth: the near field needs fine steps, and the far field
        // is where the ray runs out of screen anyway.
        t += stride * (1.0 + float(i) * 0.16);
    }

    if (hitT < 0.0) { return miss; }

    vec2 hitUV = uvFromView(P + R * hitT, uProjInfo);

    // Fade at the screen edge, or the reflection ends in a hard line wherever
    // the ray ran out of buffer.
    float edge = min(min(hitUV.x, 1.0 - hitUV.x), min(hitUV.y, 1.0 - hitUV.y));
    float edgeFade = smoothstep(0.0, 0.10, edge);

    // Schlick against ice's F0. With N facing away from the eye this saturates
    // to 1.0 on front-facing geometry — see the docblock; it is the shipped
    // behaviour, not a bug to correct.
    float f = 0.045 + 0.955 * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 5.0);

    vec3 refl = textureLod(uSource, hitUV, 0.0).rgb;
    return vec4(refl, clamp(mask * f * edgeFade * uStrength, 0.0, 1.0));
}

void main() {
    vec4 src = textureLod(uSource, vUv, 0.0);
    vec4 g   = textureLod(uDepth, vUv, 0.0);

    vec3 outCol = src.rgb;
    // .r = linear view depth (metres), .g = specular mask. Below 0.02 the pixel
    // is matte snow and the pass does nothing.
    if (uEnabled > 0.5 && g.g >= 0.02 && !isBackground(g.r)) {
        vec4 r = reflectionAt(vUv, gl_FragCoord.xy, g.r, g.g);
        if (r.w > 0.0) { outCol = mix(src.rgb, r.rgb, r.w); }
    }

    fragColor = vec4(outCol, src.a);
}
`;
