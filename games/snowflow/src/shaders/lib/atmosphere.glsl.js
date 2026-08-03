/**
 * `lib/atmosphere` — the one atmosphere every surface in the scene is hazed by.
 *
 * Port of `src/shaders/lib/atmosphere.wgsl` (runtime half). The bake half —
 * `nishitaSky` and its planet constants — lives in `skyBake.glsl.js` instead,
 * because nothing at runtime calls it and every material that includes this
 * chunk would otherwise carry a dead 32x8 nested loop through its compile.
 *
 * WHY THIS CHUNK IS SHARED RATHER THAN COPIED
 * The clipmap's far edge and the far range's feet are adjacent pixels in the
 * frame. If they resolve to two different "fully hazed" colours there is a
 * visible line between them whatever else is right, so the invariant the whole
 * horizon rests on is:
 *
 *     shadeRidge at ext -> 1  ==  skySample(dir)  ==  aerial(anything) at ext -> 1
 *
 * Three code paths, one number. That is only guaranteed if all three call the
 * functions below rather than reimplementing them.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE (ARCHITECTURE.md 3.1 — do not rename or re-sign)
 *
 *   vec3  skySample(vec3 dir);                  // radiance along dir, baked LUT
 *   vec3  skyIrradiance(vec3 N);                // SH irradiance, includes the snow bounce
 *   vec3  skySpecular(vec3 R, float roughness); // mip-based specular probe
 *   vec3  aerial(vec3 color, vec3 worldPos);    // fog + aerial perspective, applied last
 *
 * Also public, because the far range and the snow field need the pieces
 * separately (the range inlines the last two steps so it can pass the skybox
 * ray as the view direction):
 *
 *   vec2  dirToLatLong(vec3 d);
 *   vec3  latLongToDir(vec2 uv);
 *   float phaseRayleigh(float mu);
 *   float phaseMie(float mu, float g);
 *   float aerialTransmittance(vec3 camPos, vec3 worldPos,
 *                             float density, float heightFalloff, float fogStart);
 *   vec3  aerialNearSky(vec3 viewDir);
 *   vec3  aerialInscatterSky(vec3 viewDir, vec3 sunDir, vec3 sunColor, float ext);
 *   vec3  applyAerial(vec3 color, vec3 camPos, vec3 worldPos, vec3 viewDir,
 *                     vec3 sunDir, vec3 sunColor,
 *                     float density, float heightFalloff, float fogStart, float strength);
 *
 * ---------------------------------------------------------------------------
 * UNIFORMS THIS CHUNK DECLARES, AND WHO FILLS THEM
 *
 *   uniform sampler2D uSkyLUT;          // 512x256 RGBA16F equirect, full mip chain
 *   uniform vec4      uSkySH[9];        // 9 SH coefficients, rgb in .xyz
 *   uniform float     uAmbientIntensity;
 *   uniform vec4      uFog;             // x density, y heightFalloff, z fogStart,
 *                                       // w aerialStrength
 *
 * `render/sky.js` owns the values and exposes them as `sky.uniforms` — a map of
 * live Three uniform objects. Spread it into the `uniforms` of every material
 * that includes this chunk:
 *
 *     uniforms: { ...sky.uniforms, ...myOwnUniforms }
 *
 * The objects are shared by reference, so `sky` updating one updates every
 * material at once and no per-frame copying is needed. `uCameraPos`, `uSunDir`
 * and `uSunColor` come from `lib/common` and are the integrator's
 * `updateGlobals()` to set. `uSunColor` is the sun's radiance at the ground —
 * linear, premultiplied by intensity, roughly (16.9, 12.9, 6.5) at defaults —
 * NOT the normalised hue. See QUIRK-2 below.
 *
 * The four fog numbers are packed into one vec4 rather than four floats
 * deliberately: a `float` uniform is cheap but four of them in eight materials
 * is eight more names to keep spelled identically, and the packing keeps the
 * "these four always travel together" invariant visible.
 *
 * ---------------------------------------------------------------------------
 * AMBIENT SLIDER: folded into `skyIrradiance` ONLY.
 *
 * The reference writes `shIrradiance(N, shR) * ambientIntensity` at every call
 * site, and `skyIrradiance()` takes no second argument, so the multiply has to
 * live on one side or the other. It lives inside, so a consumer cannot forget
 * it and silently break the slider. The specular probe does NOT include it —
 * the reference's ambient specular is `... * fresnel * ambientIntensity * mix(1.0, 2.6, ice)`,
 * and the water/crystal refraction lookups take raw radiance with no ambient
 * term at all, so folding it into `skySpecular` would be wrong twice over.
 * Multiply the probe by `uAmbientIntensity` yourself where the reference does.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md 6)
 *
 * Nothing in this file takes a cross product or builds a basis. Every function
 * consumes raw world XYZ directions and is handedness-agnostic *internally*:
 * `dirToLatLong` maps (x, y, z) to (atan(x, z), acos(y)) in whatever frame it is
 * handed, and the bake writes the LUT through the exact inverse. The only
 * convention that matters is that `uSunDir` points *toward* the sun and that the
 * bake, the skybox and every consumer agree on the world frame — which they do,
 * because there is one LUT.
 *
 * The reference is Babylon/left-handed and this is Three/right-handed; per
 * PORT-11 the sun-vector formula in `render/sky.js` is transcribed unchanged,
 * which mirrors the world in Z relative to the reference. That decision is made
 * once, on the CPU, and is invisible here.
 */

export default /* glsl */`
#include "lib/common"

// ------------------------------------------------------------------ uniforms

uniform sampler2D uSkyLUT;
uniform vec4      uSkySH[9];
uniform float     uAmbientIntensity;
/// x = fogDensity (1/m), y = fogHeightFalloff (1/m), z = fogStart (m),
/// w = aerialStrength (exponent on transmittance).
uniform vec4      uFog;

// -------------------------------------------------------- phase functions

float phaseRayleigh(float mu) {
    return (3.0 / (16.0 * PI)) * (1.0 + mu * mu);
}

float phaseMie(float mu, float g) {
    float g2 = g * g;
    float n = (1.0 - g2) * (1.0 + mu * mu);
    float d = (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5);
    return (3.0 / (8.0 * PI)) * n / d;
}

// ------------------------------------------------------ lat-long projection

// The sky is stored as an equirectangular 2D LUT rather than a cubemap. A cube
// would be six render targets, six readbacks and seam handling, to buy accuracy
// at the poles that a sky gradient does not have and cannot use.
//
// Row convention, load-bearing in three places (the bake, the CPU SH projection
// and every lookup below):
//   v = 0.0  ->  theta = 0     ->  dir = (0, +1, 0)  = zenith
//   v = 0.5  ->  mathematical horizon
//   v = 1.0  ->  nadir, which holds the solved snow bounce
// u wraps (REPEAT); azimuth 0 (+Z) sits at u = 0.5, so the seam is at +/-Z.

vec2 dirToLatLong(vec3 d) {
    float u = atan(d.x, d.z) / TAU + 0.5;
    float v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2(u, v);
}

vec3 latLongToDir(vec2 uv) {
    float phi = (uv.x - 0.5) * TAU;
    float theta = uv.y * PI;
    float st = sin(theta);
    return vec3(st * sin(phi), cos(theta), st * cos(phi));
}

// ------------------------------------------------------------- LUT sampling

/// Radiance along dir. Mip 0, explicit LOD.
///
/// The explicit level is not optional: dirToLatLong has a derivative
/// discontinuity at the u wrap seam, and an implicit-LOD texture() there
/// selects mip 0 on one side and the 1x1 mip on the other, drawing a bright
/// vertical line at azimuth 180 degrees. Same reason every lookup below is a
/// textureLod.
vec3 skySample(vec3 dir) {
    return textureLod(uSkyLUT, dirToLatLong(normalize(dir)), 0.0).rgb;
}

/// Nine-coefficient SH irradiance for a normal, times the ambient slider.
///
/// Radiance-scaled: callers apply the 1/PI Lambert factor themselves, exactly
/// as the reference does (albedo * INV_PI * skyIrradiance(N)).
///
/// The band-2 quadratics use n.z as the polar axis while the world's up axis is
/// y. That is the Ramamoorthi-Hanrahan listing verbatim, and the CPU projection
/// in sky.js uses the matching convention, so the pair is self-consistent.
/// Changing one without the other rotates the ambient by 90 degrees.
///
/// Contains sky + solved snow bounce and never the sun: the solar disc is added
/// after the LUT, in the sky material only, so a 100000x spike cannot blow out
/// the SH fit. Direct sun is applied separately by every material from uSunColor.
vec3 skyIrradiance(vec3 N) {
    const float c1 = 0.429043;
    const float c2 = 0.511664;
    const float c3 = 0.743125;
    const float c4 = 0.886227;
    const float c5 = 0.247708;

    vec3 e =
          uSkySH[0].rgb * c4
        + uSkySH[1].rgb * 2.0 * c2 * N.y
        + uSkySH[2].rgb * 2.0 * c2 * N.z
        + uSkySH[3].rgb * 2.0 * c2 * N.x
        + uSkySH[4].rgb * 2.0 * c1 * N.x * N.y
        + uSkySH[5].rgb * 2.0 * c1 * N.y * N.z
        + uSkySH[6].rgb * (c3 * N.z * N.z - c5)
        + uSkySH[7].rgb * 2.0 * c1 * N.x * N.z
        + uSkySH[8].rgb * c1 * (N.x * N.x - N.y * N.y);

    return e * uAmbientIntensity;
}

/// Blurred probe along a reflection vector. sqrt(roughness) * 6 is the
/// reference's selector everywhere it appears (snow, character, wake), and 6 is
/// the 8x4 level of a 512x256 chain — so the chain has to be complete or a rough
/// reflection reads black.
vec3 skySpecular(vec3 R, float roughness) {
    float lod = sqrt(clamp(roughness, 0.0, 1.0)) * 6.0;
    return textureLod(uSkyLUT, dirToLatLong(normalize(R)), lod).rgb;
}

// --------------------------------------------------------- aerial perspective

/// Height-falloff extinction. Returns transmittance 0..1.
/// Integrates exp(-k*y) analytically along the segment, so fog thins with
/// altitude the way real haze does instead of sitting in a flat slab.
///
/// At defaults (k = 0.045) the haze scale height is 22.2 m: a 2 km summit sits
/// almost entirely clear of it while its own feet are buried, which is what lets
/// one atmosphere serve both a 600 m dune and a 20 km massif.
float aerialTransmittance(
    vec3 camPos, vec3 worldPos,
    float density, float heightFalloff, float fogStart
) {
    vec3 d = worldPos - camPos;
    float dist = max(0.0, length(d) - fogStart);
    if (dist <= 0.0) return 1.0;

    float dy = d.y;
    float integral;
    if (abs(dy) < 0.01) {
        integral = exp(-heightFalloff * camPos.y) * dist;
    } else {
        float k = heightFalloff;
        integral = (exp(-k * camPos.y) - exp(-k * worldPos.y)) / (k * dy) * length(d);
        integral = integral * (dist / max(1e-4, length(d)));
    }

    return exp(-density * max(0.0, integral));
}

/// The colour that fills a *short*, ground-level path.
///
/// Not the sky's radiance in the view direction. The horizon band of this sky is
/// the colour of a hundred-kilometre path; borrowing it as the inscatter colour
/// for three hundred metres of haze paints the middle distance with a sunset it
/// is three orders of magnitude too short to have earned, and the whole far
/// field goes yellow. What actually fills a short path is the whole hemisphere,
/// dominated by the bright cool dome overhead — hence the +0.42 tilt and mip 3.
vec3 aerialNearSky(vec3 viewDir) {
    vec3 d = normalize(viewDir + vec3(0.0, 0.42, 0.0));
    return textureLod(uSkyLUT, dirToLatLong(d), 3.0).rgb;
}

/// The inscatter colour for a path of a given total extinction.
///
/// A surface at total extinction is *invisible*: what reaches the eye from it is
/// by definition the sky in that exact direction. Converge on anything else and
/// the far edge of the clipmap draws as a hard silhouette at a fixed radius from
/// the player with the mountains apparently standing on it.
///
/// The forward-scatter lobe is INSIDE the crossfade, not added on top. It is a
/// short-path correction standing in for sunlight scattered into the first few
/// hundred metres; over kilometres the LUT already *is* that integral, aureole
/// and all, so adding the lobe as well double-counts it — which turned the
/// horizon shelf into a hard-topped saturated wall.
///
/// QUIRK-2, reproduced: the parameter is named sunColor but every reference call
/// site passes sunRadiance — (16.9, 12.9, 6.5) at defaults, not the normalised
/// (1.0, 0.764, 0.385). Passing the normalised hue makes sun-facing haze ~23x
/// too dim. `aerial()` below therefore passes uSunColor, which this project
/// defines as the premultiplied radiance.
vec3 aerialInscatterSky(vec3 viewDir, vec3 sunDir, vec3 sunColor, float ext) {
    // Mip 0 and no tilt: this has to match the skybox's own lookup exactly, or
    // "fully hazed" and "sky" are two different colours again.
    vec3 exact = textureLod(uSkyLUT, dirToLatLong(normalize(viewDir)), 0.0).rgb;

    float mu = dot(viewDir, sunDir);
    float fwd = phaseMie(mu, 0.62) * 5.5;
    vec3 near = aerialNearSky(viewDir) + sunColor * fwd * 0.16;

    // Ramps across roughly 100 m to 700 m on the current fog settings.
    return mix(near, exact, smoothstep(0.55, 0.995, ext));
}

/// Fold aerial perspective into a shaded colour. Explicit-parameter form, for
/// the far range and for anything that needs a view direction that is not
/// simply (worldPos - camPos).
vec3 applyAerial(
    vec3 color, vec3 camPos, vec3 worldPos, vec3 viewDir, vec3 sunDir,
    vec3 sunColor, float density, float heightFalloff, float fogStart, float strength
) {
    float t = aerialTransmittance(camPos, worldPos, density, heightFalloff, fogStart);
    float ext = clamp(1.0 - pow(t, strength), 0.0, 1.0);
    vec3 inscatter = aerialInscatterSky(viewDir, sunDir, sunColor, ext);
    return mix(color, inscatter, ext);
}

/// The form every opaque surface calls, last, on its finished colour.
///
/// Distance does three things at once and all three matter: contrast compresses,
/// hue pulls toward the sky, and the sun direction picks up a forward-scatter
/// bloom. Extinction alone only does the first.
///
/// viewDir is normalize(worldPos - uCameraPos) — the direction light travels
/// toward the eye, in world space, right-handed Y-up like everything else here.
/// It must be unit length: the forward lobe's mu is a raw dot product with it.
vec3 aerial(vec3 color, vec3 worldPos) {
    vec3 viewDir = normalize(worldPos - uCameraPos);
    return applyAerial(
        color, uCameraPos, worldPos, viewDir, uSunDir, uSunColor,
        uFog.x, uFog.y, uFog.z, uFog.w
    );
}
`;
