/**
 * Contrast-adaptive sharpen, after the display transform.
 *
 * TAA costs sharpness — it is a weighted average over eight subpixel positions,
 * and however good the neighbourhood clip is, the result is softer than the
 * jittered frame that went in. This is the pass that buys it back, and it
 * belongs at the very end for two reasons: sharpening in linear HDR puts a dark
 * ring around every specular highlight, because the overshoot there is measured
 * in stops rather than in code values; and the eye judges acutance after the
 * tone curve, not before it.
 *
 * The local min/max clamp is what makes it "adaptive": the correction is limited
 * to the range already present in the neighbourhood, so a sharp edge is
 * steepened and a flat expanse of snow does not gain a halo it has no gradient
 * to justify.
 *
 * Input and output are display-encoded sRGB. This pass must not encode anything.
 */

export default /* glsl */`
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2  uInvRes;
uniform float uAmount;

void main() {
    vec4 c = textureLod(uSource, vUv, 0.0);

    vec3 outCol = c.rgb;
    if (uAmount >= 0.001) {
        vec2 t = uInvRes;
        vec3 l = textureLod(uSource, vUv - vec2(t.x, 0.0), 0.0).rgb;
        vec3 r = textureLod(uSource, vUv + vec2(t.x, 0.0), 0.0).rgb;
        vec3 d = textureLod(uSource, vUv - vec2(0.0, t.y), 0.0).rgb;
        vec3 u = textureLod(uSource, vUv + vec2(0.0, t.y), 0.0).rgb;

        vec3 lo = min(c.rgb, min(min(l, r), min(d, u)));
        vec3 hi = max(c.rgb, max(max(l, r), max(d, u)));

        float k = uAmount * 0.32;
        outCol = clamp(c.rgb * (1.0 + 4.0 * k) - (l + r + d + u) * k, lo, hi);
    }

    fragColor = vec4(outCol, c.a);
}
`;
