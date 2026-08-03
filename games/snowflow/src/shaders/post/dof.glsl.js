/**
 * Depth of field — very restrained.
 *
 * The focal plane tracks the character, because the character is what the player
 * is looking at and the spring arm already knows how far away it is. Everything
 * nearer than about half that distance and everything past roughly twice it
 * picks up a circle of confusion, capped at a few pixels.
 *
 * The restraint is not timidity. This scene's depth cue is aerial perspective —
 * contrast compression and a hue pull toward the sky — and that is a *physical*
 * cue that survives at any focal length. A heavy defocus competes with it and
 * wins, which trades a snow field that recedes for a snow field that is out of
 * focus. What a light one adds is the last thing missing from the near field:
 * the berm the camera is almost sitting on stops being as crisp as the ridge two
 * hundred metres away, which is the read that makes a frame look photographed.
 *
 * Sample weighting is by the *sample's own* circle of confusion, so a blurred
 * background cannot bleed onto a sharp foreground — the artefact that makes
 * cheap depth of field look like a smeared decal around every silhouette.
 *
 * Handedness: none. Every distance here is the positive linear depth the prepass
 * stored, and every offset is in screen pixels.
 */

export default /* glsl */`
#include "lib/postCommon"

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

/// The resolved scene at full resolution, bound explicitly — the chain's own
/// input at this point is the bottom of the bloom pyramid.
uniform sampler2D uScene;
uniform sampler2D uDepth;

uniform vec2  uInvRes;
uniform float uEnabled;
/// Distance to the focal plane, metres.
uniform float uFocusDist;
/// Largest circle of confusion, in pixels.
uniform float uMaxCoc;

const int TAPS = 16;
const float GOLDEN = 2.39996323;

/**
 * Where the far defocus starts and where it saturates, in METRES.
 *
 * Absolute, not a multiple of the focal distance, and that distinction is the
 * whole of a bug this pass shipped with. Keying the far ramp to focus*14 sounds
 * distant and is not: the focal plane is the spring arm, about six metres, so
 * the ramp saturated at eighty-seven metres — the near-middle of a field that
 * runs to eight hundred and seventy. Every dune past the one the player is
 * standing on sat at the full circle of confusion. The scene does not rescale
 * when the player zooms the camera in, so neither can this.
 *
 * The values are also far more conservative than a naive thin-lens model would
 * give, and deliberately: a third-person camera focused at six metres is a wide
 * lens at a small aperture, so physically nothing past about twelve metres
 * defocuses at all. What is left is a cosmetic softening of the last ridge.
 */
const float FAR_START = 130.0;
const float FAR_FULL  = 620.0;

/// Signed circle of confusion, -1 (near) .. +1 (far), before the pixel scale.
float cocOf(float z, float focus) {
    if (isBackground(z)) { return 1.0; }
    float far = smoothstep(FAR_START, FAR_FULL, z);
    // The near side stays keyed to the focal distance, because that is the right
    // anchor for it: the near limit is a property of the subject distance. A
    // descending smoothstep, so `near` is 1 at z <= focus*0.16 and 0 at
    // z >= focus*0.55.
    float near = smoothstep(focus * 0.55, focus * 0.16, z);
    return far - near;
}

/// The gather, on a uniform-area golden-angle disc rotated per pixel by IGN.
vec3 gather(vec2 uv, vec2 pix, float r, vec3 centre) {
    float rot = ignPost(pix) * 6.28318530718;

    vec3 acc = centre;
    float wsum = 1.0;
    for (int i = 0; i < TAPS; i++) {
        float fi = float(i) + 0.5;
        float a  = rot + fi * GOLDEN;
        float rr = r * sqrt(fi / float(TAPS));
        vec2 sUV = uv + vec2(cos(a), sin(a)) * rr * uInvRes;

        float sz = textureLod(uDepth, sUV, 0.0).r;
        float sCoc = cocOf(sz, uFocusDist);
        // A tap only contributes if its own blur circle is wide enough to reach
        // this pixel. That is the whole foreground-bleed fix, in one line.
        float w = clamp(abs(sCoc) * uMaxCoc - rr + 1.0, 0.0, 1.0);
        acc += textureLod(uScene, sUV, 0.0).rgb * w;
        wsum += w;
    }
    return acc / wsum;
}

void main() {
    vec4 centre = textureLod(uScene, vUv, 0.0);

    vec3 outCol = centre.rgb;
    if (uEnabled > 0.5) {
        float z = textureLod(uDepth, vUv, 0.0).r;
        float r = abs(cocOf(z, uFocusDist)) * uMaxCoc;
        // Under a pixel and a half there is nothing a gather can do that the
        // display transform will not throw away, and this is the branch almost
        // the whole frame takes.
        if (r >= 1.5) { outCol = gather(vUv, gl_FragCoord.xy, r, centre.rgb); }
    }

    fragColor = vec4(outCol, centre.a);
}
`;
