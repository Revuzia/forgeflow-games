/**
 * The tileable snow-grain detail map, 1024 square RGBA8 with mips, sampled by the
 * snow material at three world scales (7.5, 1.7 and 0.31 texture-repeats per
 * metre). Fragment stage only, run once at load through `FullScreenPass`.
 *
 * Port of `src/shaders/detailBake.fragment.wgsl`.
 *
 * Generated rather than sourced from a scan (ARCHITECTURE.md §0.2 forbids assets
 * anyway, but the reference chose this on merit): snow grain is statistically
 * uniform — there is no hand-authored structure a photograph would bring — and
 * generating it means it tiles *exactly*, has no baked-in lighting to fight, and
 * is authored directly in the units the shader wants.
 *
 * Output channels:
 *   .r .g  tangent-space normal XY, biased to [0,1] (Z reconstructed in the shader)
 *   .b     cavity / crevice occlusion
 *   .a     height, for the contact-detail parallax at trail edges
 *
 * The target must be RepeatWrapping with a full mip chain and trilinear
 * filtering: the three scales are literally the same texture at three tiling
 * rates, and the finest one is under a millimetre per texel at close range.
 *
 * Handedness (ARCHITECTURE.md §6): the output is a tangent-space normal with +Z
 * out of the surface, and the snow material lifts it onto the geometric normal
 * with its own (T, B, N) basis. Nothing in this file touches a world direction.
 */

export default /* glsl */`
#include "lib/noise"

in vec2 vUv;

uniform float resolution;   // 1024
uniform float grainScale;   // 0.013 — tilts a grain dome's flank to roughly 30 deg

layout(location = 0) out vec4 outColor;

/// Tileable hash: cell indices wrap at 'period', so the field is seamless.
vec2 hashTile(vec2 id, float period) {
    vec2 w = id - floor(id / period) * period;
    return hash22(w);
}

/// Packed-grain height field. Snow at close range is a jam of rounded crystals
/// with deep, dark crevices between them — spheres, not noise bumps, and the
/// crevices matter as much as the grains.
vec2 grainHeight(vec2 p, float cells, float period) {
    vec2 gp = p * cells;
    vec2 gi = floor(gp);

    float h = 0.0;
    float cav = 1.0;

    for (int dy = -1; dy <= 1; ++dy) {
        for (int dx = -1; dx <= 1; ++dx) {
            vec2 id = gi + vec2(float(dx), float(dy));
            vec2 r = hashTile(id, period);
            vec2 r2 = hashTile(id + vec2(37.0, 91.0), period);

            vec2 centre = id + 0.25 + r * 0.5;
            float radius = 0.30 + r2.x * 0.26;
            float d = length(gp - centre) / radius;

            if (d < 1.0) {
                // Spherical cap profile — gives a real rounded highlight rather
                // than the soft blob a smoothstep would.
                float dome = sqrt(max(0.0, 1.0 - d * d)) * (0.55 + r2.y * 0.45);
                h = max(h, dome);
                cav = min(cav, 1.0 - (1.0 - d) * 0.5);
            }
        }
    }
    return vec2(h, cav);
}

vec2 detailHeight(vec2 uv) {
    // Three grain sizes stacked, each tiling on its own period. The offsets stop
    // the three lattices sharing corners, which would read as a plaid.
    vec2 a = grainHeight(uv, 26.0, 26.0);
    vec2 b = grainHeight(uv + vec2(0.37, 0.11), 61.0, 61.0);
    vec2 c = grainHeight(uv + vec2(0.71, 0.53), 137.0, 137.0);

    float h = a.x * 1.0 + b.x * 0.42 + c.x * 0.17;
    float cav = a.y * 0.55 + b.y * 0.30 + c.y * 0.15;
    return vec2(h, cav);
}

void main() {
    vec2 uv = vUv;
    float e = 1.0 / resolution;

    vec2 c = detailHeight(uv);
    float hL = detailHeight(uv - vec2(e, 0.0)).x;
    float hR = detailHeight(uv + vec2(e, 0.0)).x;
    float hD = detailHeight(uv - vec2(0.0, e)).x;
    float hU = detailHeight(uv + vec2(0.0, e)).x;

    // Slope of the height field in UV space, then tilted into a normal.
    //
    // The division by the sample spacing is the part that is easy to get wrong:
    // without it the "slope" is a per-texel height *difference*, which scales
    // with resolution and, at 1024 px, comes out around 25 — every normal ends up
    // lying almost flat in the tangent plane and the detail reads as noise rather
    // than as grain. grainScale then only has to bring a real slope into a
    // sensible tilt.
    float dx = (hR - hL) / (2.0 * e);
    float dz = (hU - hD) / (2.0 * e);
    vec3 n = normalize(vec3(-dx * grainScale, -dz * grainScale, 1.0));

    outColor = vec4(n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, c.y, c.x);
}
`;
