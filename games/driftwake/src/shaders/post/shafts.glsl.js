/**
 * Volumetric light shafts.
 *
 * At a thirteen-degree sun these earn their cost: every dune crest in the frame
 * is a horizon-line occluder with the sun sitting just above it, which is the
 * geometry that produces shafts. The same effect at a midday sun would be
 * invisible, and this is written so that it simply switches itself off there —
 * the weight falls with the sun's screen distance and vanishes once the sun
 * leaves the frustum.
 *
 * Occlusion comes from the depth prepass rather than a separate occlusion
 * render: a pixel where the prepass wrote nothing is sky, and sky is where the
 * beam gets through. That makes this a radial integral of sky visibility, one
 * texture fetch per step, no extra geometry pass.
 *
 * Runs at quarter resolution — shafts are the lowest-frequency thing in the
 * frame by an order of magnitude, and the composite reads this back bilinearly.
 * `gl_FragCoord.xy` is therefore in quarter-res pixels, which is what the IGN
 * dither wants.
 *
 * Handedness: nothing here consumes a direction or a cross product. The sun's
 * screen position arrives pre-projected from the CPU.
 */

export default /* glsl */`
#include "lib/postCommon"

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D uDepth;

/// Where the sun projects on screen, in the same UV space as everything else.
uniform vec2  uSunUV;
/// 1 when the sun is in front of the camera, 0 behind. No smoothing — the
/// radial weight has already faded to nothing long before the sun reaches the
/// frustum edge, so there is nothing to pop.
uniform float uSunOnScreen;
uniform vec3  uSunColor;
uniform float uEnabled;
uniform float uStrength;
/// Aspect ratio, so the angular falloff is round on screen, not elliptical.
uniform float uAspect;

const int STEPS = 24;
/// How far along the ray to the sun the march reaches. Short of 1.0 on purpose:
/// the shaft should read as light spilling *past* a crest, not as a star filter.
const float REACH = 0.82;
/// Per-step attenuation. Sets how far a shaft runs before it dies out.
const float DECAY = 0.955;

/// Sky visibility integrated along the ray toward the sun.
float marchShaft(vec2 uv, vec2 pix, float radial) {
    vec2 delta = (uSunUV - uv) * (REACH / float(STEPS));

    // Dither the start, or twenty-four steps quantise into visible rings around
    // the sun. The temporal resolve has already run by this point, so the noise
    // has to be broken up spatially rather than accumulated away — hence a
    // fixed hash rather than a per-frame one.
    vec2 p = uv + delta * ignPost(pix);

    float illum = 1.0;
    float acc = 0.0;
    for (int i = 0; i < STEPS; i++) {
        float z = textureLod(uDepth, p, 0.0).r;
        acc += isBackground(z) ? illum : 0.0;
        illum *= DECAY;
        p += delta;
    }
    acc /= float(STEPS);

    // Squared, so a beam that is half occluded reads as clearly dimmer than one
    // that is not. Linear accumulation makes every crest emit the same haze and
    // the shafts lose their shape.
    return acc * acc * radial * uStrength;
}

void main() {
    // Angular weight. Shafts belong near the sun; letting them reach the far
    // corner turns the whole frame into a radial blur, which is the failure mode
    // that makes this effect look cheap.
    vec2 d = (vUv - uSunUV) * vec2(uAspect, 1.0);
    float radial = 1.0 - smoothstep(0.03, 0.68, length(d));

    float v = 0.0;
    if (uEnabled > 0.5 && uSunOnScreen > 0.5 && radial > 0.001) {
        v = marchShaft(vUv, gl_FragCoord.xy, radial);
    }

    // Scene radiance units, pre-exposure. The composite adds it before the
    // exposure multiply.
    fragColor = vec4(uSunColor * v, 1.0);
}
`;
