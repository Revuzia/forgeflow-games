/**
 * The two shared depth-pass fragment stages, and the varying declarations their
 * vertex halves must match.
 *
 * These are not `lib/` chunks and are deliberately not in the include registry:
 * they are whole shader *stages*, and ARCHITECTURE.md §1 keeps stages as plain
 * string exports imported by the subsystem that owns the caster. Import what you
 * need from here directly:
 *
 *     import { PREPASS_FRAGMENT, PREPASS_VS_VARYINGS } from "../shaders/prepass.glsl.js";
 *
 * Six subsystems build casters against this file. Between them they must produce
 * three programs per caster — beauty, cascade depth, prepass — whose vertex
 * stages place a vertex at *literally the same world position*. Share the
 * placement code through a `lib/` include (`lib/clipmap`, `lib/deform`,
 * `lib/charSkin`, `lib/wake`, `lib/crystal`); do not copy it. A depth pass that
 * displaces on a ring the beauty pass left flat makes the terrain shadow against
 * a surface that is not the one being drawn, and every berm acnes.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS IN THE PREPASS TARGET — four post passes read this, so it is spelled
 * out once, here, and nowhere else. RGBA16F, full render resolution, NEAREST.
 *
 *   .r  linear view depth, METRES. It is the clip-space `w`, which for a
 *       perspective projection *is* the view-space z, carried through as a
 *       varying rather than reconstructed from the depth buffer: exact, and it
 *       costs one interpolant where linearising gl_FragCoord.z would spend a
 *       divide to recover a number the vertex stage already had.
 *       Cleared to DEPTH_FAR = 9000, which is beyond the camera's 4200 m far
 *       plane, so the sky reads as "nothing here" to every consumer without any
 *       of them needing a separate mask. `isBackground(z)` is `z > 4500`.
 *   .g  specular mask. 0 = matte snow, 1 = mirror ice. Only the SSR pass reads
 *       it, and only where it is non-zero. Written non-zero by exactly two
 *       casters: the ice crystals (1.0, flat) and the terrain (the deform
 *       texture's ice channel times its falloff weight).
 *   .b  spare, written 0.
 *   .a  spare, written 1.
 *
 * Consumers reconstruct a view-space position as
 *   `vec3(ndc.x * projInfo.x, ndc.y * projInfo.y, 1.0) * z`
 * with `projInfo = (tan(fovY/2) * aspect, tan(fovY/2))` and `ndc = uv*2-1`.
 *
 * ---------------------------------------------------------------------------
 * CASCADE DEPTH — plain R32F colour, not a hardware depth/comparison texture.
 * `gl_FragCoord.z` is window-space depth, already in [0,1] under the default
 * `glDepthRange(0,1)`, so it stores the *same numbers* WebGPU's builtin
 * `position.z` does (_spec/shadows.md §11.2). Colour rather than a comparison
 * sampler because PCSS has to run a real blocker search, and a comparison
 * sampler only ever hands back a pre-thresholded result the search cannot use.
 */

/**
 * The shared cascade depth fragment stage — every caster but the wake, which
 * needs its own because its erosion has to `discard` in the shadow pass too.
 * @type {string}
 */
export const CASCADE_DEPTH_FRAGMENT = /* glsl */ `
layout(location = 0) out vec4 outColor;

void main() {
    outColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
}
`;

/**
 * The shared prepass fragment stage — every caster that has nothing to discard.
 * @type {string}
 */
export const PREPASS_FRAGMENT = /* glsl */ `
in float vViewZ;   // metres, linear
in float vMask;    // 0 matte snow, 1 mirror ice

layout(location = 0) out vec4 outColor;

void main() {
    outColor = vec4(vViewZ, vMask, 0.0, 1.0);
}
`;

/**
 * Paste into a prepass **vertex** stage. Kept here so the two halves cannot end
 * up declaring different names or a different order.
 * @type {string}
 */
export const PREPASS_VS_VARYINGS = /* glsl */ `
out float vViewZ;
out float vMask;
`;

/**
 * Paste into a prepass **fragment** stage that supplies its own `main` — today
 * only the wake's, which discards eroded texels so that a two-metre wall of half
 * powder does not report itself to the post chain as solid.
 * @type {string}
 */
export const PREPASS_FS_VARYINGS = /* glsl */ `
in float vViewZ;
in float vMask;
`;

/**
 * The two lines every prepass vertex stage ends with, given a clip-space
 * position and a mask. Written as a function rather than a snippet so the
 * `clip.w` -> `vViewZ` identity is stated in exactly one place.
 *
 * Usage in a vertex stage:
 *
 *     #include nothing — this is a string, concatenate it
 *     ...
 *     void main() {
 *         vec3 world = <however this caster places its vertex>;
 *         prepassEmit(uViewProj * vec4(world, 1.0), 0.0);
 *     }
 *
 * @type {string}
 */
export const PREPASS_EMIT = /* glsl */ `
// Sets gl_Position and both varyings. clip.w IS the view-space z for a
// perspective projection, which is the whole reason .r is exact and free.
void prepassEmit(vec4 clip, float mask) {
    vViewZ = clip.w;
    vMask = mask;
    gl_Position = clip;
}
`;
