/**
 * Shell fur — the hood rim and the two cuffs.
 *
 * Port of `snowflow_demo/src/shaders/fur.vertex.wgsl` and `fur.fragment.wgsl`.
 *
 * Each shell is a copy of the trim's surface pushed further out, with the offset
 * already baked into the vertex position at build time (`emitFurBand` in
 * `character/build.js`). The vertex stage adds only droop; the fragment stage
 * decides, per pixel per shell, whether a strand is still present there. Two
 * hashed quantities per strand cell do all the work:
 *
 *   length   how far up the shell stack this strand survives. Uniform-length fur
 *            reads as a sponge; the variation is what makes it fur.
 *   radius   the strand's cross-section, tapering to nothing at its own tip, so
 *            the silhouette is POINTED rather than cut off flat.
 *
 * Lighting is deliberately not a surface BRDF. A strand is a fibre: it scatters
 * forward strongly, wraps light most of the way round, and its roots are buried
 * in shadow. Wrapped diffuse (w = 0.65) plus a strong transmission lobe plus
 * depth-based occlusion gets all three, and white fur against a low sun then
 * does the thing white fur does, which is glow around its edges.
 *
 * The fur casts NO shadow and is excluded from the depth prepass — see
 * `_spec/cloth-fur.md` §9.9. Reproducing that exclusion matters: including it
 * changes the hood's contact shadow.
 *
 * Because it discards rather than blends, draw order between shells does not
 * matter. Do not sort shells.
 *
 * HANDEDNESS: nothing here builds a basis or consumes a bearing. `furDroop` is a
 * world-space displacement computed on the CPU in `character/character.js`,
 * where the wind bearing's z is mirrored along with everything else.
 */

import { CHAR_VS_VARYINGS, CHAR_FS_VARYINGS } from "./char.glsl.js";

/**
 * Single-bone skin, then droop scaled by the SQUARE of the shell parameter.
 *
 * The square is what curves a strand instead of shearing it: at t = 0.5 the
 * displacement is 0.25x, at t = 1 it is 1.0x, so the tip moves four times as far
 * as the midpoint. A linear law shears the whole band into a parallelogram.
 *
 * The droop is applied AFTER skinning, in world space — it is not rotated by the
 * bone.
 * @type {string}
 */
export const FUR_VERTEX = /* glsl */`
#include "lib/charSkin"

in vec3 position;   // bind-pose world position, shell offset already included
in vec3 normal;     // shell direction, unit
in vec2 uv;         // strand-field coordinates, METRES of surface
in vec2 aux;        // (shell parameter 0..1, baked occlusion)
in vec4 boneIdx;
in vec4 boneWt;     // bound but never read: every fur vertex is weight 1 on one bone

uniform mat4 uViewProj;
uniform vec3 uCameraPos;
/// World-space displacement applied to a strand TIP, metres.
uniform vec3 furDroop;

${CHAR_VS_VARYINGS}

void main() {
    int b = int(boneIdx.x);
    vec3 world = skinPoint1(b, position);
    vec3 n = normalize(skinDir1(b, normal));

    float t = aux.x;
    world += furDroop * (t * t);

    vWorld = world;
    vNormal = n;
    vUV = uv;
    vAux = aux;
    vViewDist = distance(world, uCameraPos);
    gl_Position = uViewProj * vec4(world, 1.0);
}
`;

/**
 * The strand field and the fibre shading.
 *
 * `hash21` / `hash22` come from `lib/noise` and depend on the LOW BITS of a
 * float — at mediump the strand field degenerates into large blotches, which is
 * why `core/glsl.js` puts `precision highp float` on every fragment stage.
 *
 * @param {{spellLights?: boolean}} [opts] accepted for symmetry with
 *   `charFragment`; the reference's fur shader has no spell-light term and none
 *   is added, so this is currently ignored.
 * @returns {string}
 */
export function furFragment(opts) {
    return /* glsl */`
#include "lib/shading"
#include "lib/atmosphere"
#include "lib/shadowLookup"

${CHAR_FS_VARYINGS}

/// Strand cells per metre of surface. 250 is a 4.0 mm pitch.
///
/// The reference's WGSL comment reads "260 is a 3.8 mm pitch" but character.js
/// sets 250. The code is canonical and 250 is what this port uploads; the
/// discrepancy is recorded here rather than silently resolved.
uniform float furDensity;
/// Slightly blue-shifted white, (0.74, 0.755, 0.795). The fur does NOT read the
/// material palette — PALETTE[6] is labelled "unused by the fabric shader" and
/// wiring it here would be wrong.
uniform vec3 furColor;

layout(location = 0) out vec4 outColor;

void main() {
    float t = vAux.x;

    // ---------------------------------------------------------- strand field
    vec2 g = vUV * furDensity;
    vec2 cell = floor(g);
    float h = hash21(cell);
    // The decorrelation offsets are non-integer on purpose: an integer offset
    // would alias against the floor(g) lattice.
    vec2 jitter = hash22(cell + vec2(11.3, 5.7)) - 0.5;

    // How far up this strand reaches. Cut early and often: a shell stack where
    // most strands survive to the top is a solid shell with holes in it.
    float strandLen = 0.30 + 0.70 * h;
    if (t > strandLen) discard;

    // Distance to the strand's own axis, in cell units.
    float d = length(fract(g) - 0.5 - jitter * 0.55);
    // Taper: full width at the root, a point at the tip. sqrt() makes it a
    // PARABOLOID, so the strand stays fat almost all the way up and only sharpens
    // near the tip; a linear taper turns the silhouette from pointed to conical.
    // At t == strandLen the taper is exactly 0, so the strand ends in a point
    // rather than a cut.
    float taper = 1.0 - (t / strandLen);
    float radius = 0.46 * (0.55 + 0.45 * hash21(cell + vec2(3.1, 9.4))) * sqrt(max(taper, 0.0));
    if (d > radius) discard;

    // ------------------------------------------------------------- shading
    vec3 world = vWorld;
    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;   // toward the sun
    vec3 N = normalize(vNormal);
    if (dot(N, V) < 0.0) N = -N;

    float noiseRot = shadowIGN(gl_FragCoord.xy) * 6.28318530718;
    float shadow = sunShadow(world, N, vViewDist, noiseRot);

    // Self-occlusion down the stack. Roots see almost no sky, tips see all of it
    // — this gradient is what gives shell fur its depth, and without it the trim
    // reads as a flat white band.
    float depth = t / max(strandLen, 1e-3);
    float selfAO = 0.16 + 0.84 * depth * depth;

    vec3 sun = uSunColor;
    float NdotL = dot(N, L);

    // Fibres wrap light almost all the way round: w = 0.65 reaches ~33 degrees
    // past the terminator, so there is no hard shadow line on a fur band.
    float diff = wrapDiffuse(NdotL, 0.65);
    vec3 color = furColor * INV_PI * sun * diff * shadow * selfAO;

    // Transmission — the term that makes a fur rim light up against a low sun.
    // It survives at 40% even in full shadow, which is the halo.
    float back = backScatter(N, L, V, 0.5, 3.0, 1.0);
    color += sun * furColor * back * 0.85 * mix(0.4, 1.0, shadow) * selfAO;

    // A dim, wide specular. Fur is not glossy, but a completely matte white
    // reads as paper.
    if (NdotL > 0.0) {
        vec3 H = normalize(V + L);
        float ds = distributionGGX(clamp(dot(N, H), 0.0, 1.0), 0.75);
        color += sun * ds * 0.05 * NdotL * shadow * selfAO;
    }

    // skyIrradiance() already folds uAmbientIntensity in. vAux.y is the band's
    // baked occlusion (0.62 hood / 0.52 cuff), so the effective ambient
    // multiplier is 0.868 / 0.728.
    color += furColor * INV_PI * skyIrradiance(N) * selfAO * vAux.y * 1.4;

    color = aerial(color, world);

    outColor = vec4(color, 1.0);
}
`;
}
