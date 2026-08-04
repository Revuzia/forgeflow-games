/**
 * The 2048-square aux bake. Fragment stage only, run once at load immediately
 * after the height bake, through `core/gfx.js`'s `FullScreenPass`.
 *
 * Port of `src/shaders/auxBake.fragment.wgsl`.
 *
 * Derives everything the snow material needs to know about the macro landform
 * that is not the height itself, by differentiating the *baked* height texture
 * rather than the analytic function.
 *
 * Differentiating the bake (instead of re-evaluating `terrainMacroD`) guarantees
 * the normals describe the exact surface the vertex shader displaces to. If the
 * two were derived independently, lighting would disagree with the silhouette and
 * smooth dunes would show phantom shading seams.
 *
 * Output, RGBA16F:
 *   .r .g  dH/dx, dH/dz in metres per metre
 *   .b     rock mask, 0 = snow, 1 = bare rock (forwarded from the height bake .g)
 *   .a     exposure: 1 on scoured crests, 0 in sheltered hollows
 *
 * Handedness (ARCHITECTURE.md §6): the two central differences are taken along
 * the height texture's U and V axes, which `worldToHeightUV` maps from world X
 * and world Z respectively. So (.r, .g) is (dH/dx, dH/dz) in Three's
 * right-handed Y-up world, and the snow material turns it into a normal with
 * `normalFromGradient` — the y = H(x, z) identity, valid in either handedness.
 * No axis is mirrored anywhere in the chain.
 */

export default /* glsl */`
in vec2 vUv;

uniform sampler2D heightTex;
uniform float texelWorld;    // world metres per height texel = 0.5
uniform float invHeightRes;  // 1 / 4096

layout(location = 0) out vec4 outColor;

void main() {
    vec2 uv = vUv;
    float t = invHeightRes;
    float d = texelWorld;

    // Implicit-LOD sampling is correct here: this is a fragment stage over a
    // mip-free, LinearFilter texture, and the taps sit one texel apart.
    vec4 hL = texture(heightTex, uv - vec2(t, 0.0));
    vec4 hR = texture(heightTex, uv + vec2(t, 0.0));
    vec4 hD = texture(heightTex, uv - vec2(0.0, t));
    vec4 hU = texture(heightTex, uv + vec2(0.0, t));
    vec4 hC = texture(heightTex, uv);

    // Central difference — second-order accurate, and symmetric so flat ground
    // produces exactly zero slope instead of a bias.
    float dHdx = (hR.x - hL.x) / (2.0 * d);
    float dHdz = (hU.x - hD.x) / (2.0 * d);

    // --- exposure ----------------------------------------------------------
    // Wide-stencil Laplacian: positive on convex crests (which the wind scours
    // and packs into sastrugi), negative in concave hollows (where loose drift
    // collects). Sampling six texels out deliberately ignores the fine
    // corrugation and answers only "is this a crest or a pocket".
    float w = t * 6.0;
    float wd = d * 6.0;
    float lL = texture(heightTex, uv - vec2(w, 0.0)).x;
    float lR = texture(heightTex, uv + vec2(w, 0.0)).x;
    float lD = texture(heightTex, uv - vec2(0.0, w)).x;
    float lU = texture(heightTex, uv + vec2(0.0, w)).x;
    float lap = (lL + lR + lD + lU - 4.0 * hC.x) / (wd * wd);

    // -lap so crests come out positive. The 2.2 scale is set against the actual
    // curvature of the dune field: 15 m of relief at a ~58 m wavelength gives a
    // second derivative around 0.18 m^-1, so this has to be near 1/0.18 to
    // produce a usable gradient. Anything larger saturates to a hard 0/1 mask and
    // the sastrugi/ripple cross-fade it drives stops being a cross-fade at all.
    float exposure = clamp(0.5 - lap * 2.2, 0.0, 1.0);

    outColor = vec4(dHdx, dHdz, hC.y, exposure);
}
`;
