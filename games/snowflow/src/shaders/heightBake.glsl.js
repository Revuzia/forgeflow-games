/**
 * The 4096-square macro height bake. Fragment stage only — it is run once at load
 * through `core/gfx.js`'s `FullScreenPass`, which supplies `vUv` over [0,1]^2.
 *
 * Port of `src/shaders/heightBake.fragment.wgsl`.
 *
 * Baked rather than evaluated live for one reason: the CPU needs the same heights
 * for character grounding, footfall placement and spell hit points, and reading
 * back a GPU bake is the only way to guarantee the two never disagree.
 * Re-implementing the noise in JavaScript would drift the moment f32 and f64
 * rounding diverged, and the character would float or sink by centimetres — worse
 * on steep faces, which is exactly where it is most visible.
 *
 * Output, into an RG32F target over a 2048 m field (0.5 m per texel):
 *   .r  height in metres — macro landform plus rock displacement
 *   .g  rock mask 0..1
 *
 * Two channels, not four: nothing reads B or A, and at 4096 square the two unused
 * channels would be 134 MB of VRAM holding zeroes.
 *
 * Handedness (ARCHITECTURE.md §6): `p` is world (x, z) in Three's right-handed
 * Y-up frame and every formula in `lib/terrain` is transcribed unmirrored, per
 * _spec/terrain.md §13.1. Nothing here takes a cross product.
 */

export default /* glsl */`
#include "lib/terrain"

in vec2 vUv;

uniform vec2  worldOrigin;   // (-1024, -1024)
uniform float worldSize;     // 2048 m
uniform float windAngle;     // S.windDirection in radians
uniform float heightAmp;     // S.macroHeightScale

layout(location = 0) out vec4 outColor;

void main() {
    vec2 p = worldOrigin + vUv * worldSize;

    float h = terrainMacro(p, windAngle, heightAmp);

    // Rock displaces snow upward; snow then re-accumulates on the flatter faces,
    // which the snow material resolves from the mask the aux bake forwards.
    vec2 rock = rockField(p, windAngle);
    h += rock.x;

    outColor = vec4(h, rock.y, 0.0, 1.0);
}
`;
