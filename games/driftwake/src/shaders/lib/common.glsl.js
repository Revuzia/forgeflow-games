/**
 * `lib/common` — the chunk every other chunk is allowed to assume.
 *
 * Two things live here and nothing else:
 *
 *  1. The shared uniform block from ARCHITECTURE §3. These names are fixed and
 *     the integrator sets all six through a single `updateGlobals()`; declaring
 *     them in one place is what guarantees the terrain vertex stage, the three
 *     cascades and the post chain agree on the type and the spelling. Unused
 *     uniforms are free — Three only uploads the ones a linked program actually
 *     reports as active.
 *
 *  2. Small, arithmetic-only helpers that would otherwise be redefined in six
 *     files with five different names. Nothing here samples a texture, nothing
 *     here has an opinion about lighting; the moment a helper needs the snow
 *     BRDF or the atmosphere it belongs in `lib/shading` or `lib/atmosphere`.
 *
 * Handedness (ARCHITECTURE §6): nothing in this file consumes a direction or
 * takes a cross product, so there is nothing here to get backwards. `uSunDir`
 * is declared, not used — it points *toward* the sun in Three's right-handed
 * Y-up world space, and every consumer is responsible for saying so in a
 * comment where it uses it.
 */

export default /* glsl */`

// ------------------------------------------------------------------ constants

const float PI     = 3.141592653589793;
const float TAU    = 6.283185307179586;
const float INV_PI = 0.3183098861837907;

// ------------------------------------------------------------- shared globals
// ARCHITECTURE.md §3. Set once per frame by the integrator's updateGlobals().

uniform vec3  uSunDir;        // toward the sun, normalised, world space
uniform vec3  uSunColor;      // linear, pre-multiplied by intensity
uniform vec3  uCameraPos;
uniform float uTime;          // seconds
uniform mat4  uViewProj;
uniform vec2  uResolution;

// -------------------------------------------------------------------- helpers

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2  saturate(vec2  x) { return clamp(x, 0.0, 1.0); }
vec3  saturate(vec3  x) { return clamp(x, 0.0, 1.0); }
vec4  saturate(vec4  x) { return clamp(x, 0.0, 1.0); }

// Deliberately unclamped. Most uses here want the extrapolation past the ends —
// a fog curve that keeps falling, a glint gate that keeps biting — and the ones
// that do not wrap the result in saturate() at the call site, where you can see
// the clamp happening.
float remap(float x, float a, float b, float c, float d) {
    return c + (d - c) * (x - a) / (b - a);
}

/**
 * Frame-rate independent exponential approach.
 *
 * The naive smooth-follow, a += (b - a) * k, is a lie the moment the frame time
 * moves: at 144 Hz it settles 2.4x faster than at 60 Hz, so the camera rig and
 * every damped value drift apart between machines — and the comparison battery
 * would read that as a pose mismatch. 1 - exp(-rate * dt) is the same curve
 * sampled correctly at any dt.
 *
 * "rate" is a reciprocal time constant, 1/s: after 1/rate seconds the value has
 * closed 63% of the gap. (No backticks anywhere below this line — the whole
 * chunk is a JS template literal and one would end it mid-shader.)
 */
float expDamp(float rate, float dt)  { return 1.0 - exp(-rate * dt); }

float expDamp(float from, float to, float rate, float dt) {
    return mix(from, to, 1.0 - exp(-rate * dt));
}
vec2  expDamp(vec2  from, vec2  to, float rate, float dt) {
    return mix(from, to, 1.0 - exp(-rate * dt));
}
vec3  expDamp(vec3  from, vec3  to, float rate, float dt) {
    return mix(from, to, 1.0 - exp(-rate * dt));
}

// ----------------------------------------------------------------- colour

// Rec.709 luminance weights, correct only on LINEAR values. Everything in this
// port is linear until the tonemap (ARCHITECTURE §6), so that is the common case;
// call it on an encoded value and the bloom threshold silently shifts.
float luminance(vec3 linearRgb) {
    return dot(linearRgb, vec3(0.2126, 0.7152, 0.0722));
}

// The exact piecewise IEC 61966-2-1 transfer functions, not the pow(x, 2.2)
// approximation: the near-black segment is where snow's shadowed side lives and
// the approximation is worst there, crushing the blue ambient shift this scene
// is built around.
//
// The renderer is left in LinearSRGBColorSpace and the tonemap pass does its own
// encode, so these exist for the few places that need a round trip (the sky LUT
// bake, debug views), not as a general output step.
vec3 srgbToLinear(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 linearToSrgb(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;
