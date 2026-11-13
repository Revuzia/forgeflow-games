/**
 * `lib/shading` — the snow BRDF, the subsurface term and the glints.
 * [TERRAIN-SNOW]
 *
 * Port of `src/shaders/lib/shading.wgsl`, minus the two blocks this project
 * assigned elsewhere: `pcssShadow`/`POISSON` belong to `lib/shadowLookup`
 * [SHADOWS] and `shIrradiance` belongs to `lib/atmosphere` [SKY] as
 * `skyIrradiance()`. Everything else transcribes verbatim.
 *
 * Snow is not a dielectric with a white albedo. It is a densely packed scatterer
 * with a mean free path of a few millimetres, which means:
 *
 *   * light wraps well past the terminator, so shadow edges are soft in a way no
 *     amount of shadow-map filtering reproduces;
 *   * thin drift edges glow from behind;
 *   * shadowed snow is lit almost entirely by the sky, so it goes *blue*, never
 *     grey and never black;
 *   * individual surface crystals catch the sun as discrete sparkles at grazing
 *     angles, and only at grazing angles.
 *
 * The reference's own header, kept because it is the priority order for anyone
 * cutting scope: "The subsurface term below is doing most of the work of making
 * this read as snow at all. If you disable exactly one thing in this file to see
 * what it was worth, disable that."
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE
 *
 * ARCHITECTURE.md §3.1 signs three functions, and they are provided EXACTLY as
 * signed, for consumers written against the contract before this file existed:
 *
 *     vec3  snowSubsurface(vec3 L, vec3 V, vec3 N, vec3 lightColor, float thickness);
 *     float snowGGX(vec3 L, vec3 V, vec3 N, float roughness);
 *     vec3  snowGlints(vec3 worldPos, vec3 V, vec3 N, float gate);
 *
 * The reference's own longer forms are ALSO provided, overloaded on arity, and
 * are what the snow material itself calls — they take the strength/radius and
 * intensity/gate values explicitly, which is how the material folds in the
 * rock mask (`sssStrength * (1 - rockExposed)`):
 *
 *     vec3  snowSubsurface(vec3 N, vec3 L, vec3 V, vec3 lightColor,
 *                          float thickness, float strength, float radius);
 *     float snowGlints(vec2 worldXZ, vec3 N, vec3 V, vec3 L,
 *                      float pixelFootprint, float intensity, float grazeGate);
 *
 * NOTE THE ARGUMENT ORDER DIFFERS between the two `snowSubsurface` forms: §3.1
 * signs (L, V, N, ...) and the reference is (N, L, V, ...). Both are three vec3s,
 * so a mis-ordered call compiles and renders wrong. The arities differ (5 vs 7),
 * so the overload itself is unambiguous.
 *
 * Plus the rest of the reference's surface, unchanged:
 *
 *     float distributionGGX(float NdotH, float roughness);
 *     float visSmithGGXCorrelated(float NdotV, float NdotL, float roughness);
 *     vec3  fresnelSchlick(float u, vec3 f0);
 *     vec3  fresnelSchlickRough(float u, vec3 f0, float roughness);
 *     float wrapDiffuse(float NdotL, float w);
 *     float backScatter(vec3 N, vec3 L, vec3 V, float distortion, float power,
 *                       float thickness);
 *     float glintOctave(vec2 p, float cell, vec3 N, vec3 H, vec3 T, vec3 B,
 *                       float sharpness);
 *     vec3  blendNormalRNM(vec3 base, vec3 detail);
 *     vec3  normalFromGradient(vec2 d);
 *     float luma(vec3 c);
 *
 * UNIFORMS — declared here, not by the consumer, because the §3.1 short forms
 * take no strength or intensity argument and have to read them from somewhere.
 * Do not re-declare them. `Terrain` exposes the matching {value} objects as
 * `terrain.shadingUniforms` so every lit surface can share one set:
 *
 *     float sssStrength     S.sssStrength      default 1.0
 *     float sssRadius       S.sssRadius        default 1.0
 *     float glintIntensity  S.glintIntensity   default 0.55
 *     float glintGrazing    S.glintGrazing     default 0.72
 *
 * `snowGlints` in either form is FRAGMENT-ONLY (the short form takes fwidth of
 * the world position); everything else compiles in a vertex stage.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6)
 *
 * Every direction here is world-space and right-handed Y-up, as the rest of this
 * port is. Three places would break if a convention were flipped, and all three
 * are marked at the line:
 *
 *  1. `backScatter` builds its transmission vector from **+L** (surface toward
 *     the sun) and measures the lobe against **-H**. That sign is not a
 *     handedness question but it is the same class of error, and it is the single
 *     most consequential sign in the project — see the note on the function.
 *  2. `snowGlints` and the detail-normal lift both build a tangent basis with
 *     `T = normalize(cross(up, N)); B = cross(N, T)`. In a right-handed frame
 *     that is a right-handed (T, B, N) triple. The facets are randomly oriented
 *     in the tangent plane and the RNM blend is symmetric in T/B, so a flipped
 *     chirality here would be invisible — it is written right-handed anyway so
 *     that it is not the thing anyone has to check twice.
 *  3. `normalFromGradient(d) = normalize(vec3(-d.x, 1, -d.y))` is the
 *     gradient-to-normal identity for a height function y = H(x, z). It is not a
 *     cross product and holds under either handedness.
 */

export default /* glsl */`
#include "lib/noise"

// ------------------------------------------------------------------ uniforms

uniform float sssStrength;
uniform float sssRadius;
uniform float glintIntensity;
uniform float glintGrazing;

// ---------------------------------------------------------------- microfacet
//
// alpha = roughness^2 (perceptual roughness), so a2 = roughness^4 inside D. The
// visibility term is the height-correlated Smith form and ALREADY contains the
// 1/(4 NdotL NdotV) factor, so the specular is D * Vis * F * NdotL with no
// further division by 4.

float distributionGGX(float NdotH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(1e-7, PI * d * d);
}

float visSmithGGXCorrelated(float NdotV, float NdotL, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
    float gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
    return 0.5 / max(1e-7, gv + gl);
}

vec3 fresnelSchlick(float u, vec3 f0) {
    float f = pow(1.0 - u, 5.0);
    return f0 + (vec3(1.0) - f0) * f;
}

vec3 fresnelSchlickRough(float u, vec3 f0, float roughness) {
    float f = pow(1.0 - u, 5.0);
    return f0 + (max(vec3(1.0 - roughness), f0) - f0) * f;
}

/**
 * ARCHITECTURE.md §3.1. The SCALAR half of the direct specular lobe:
 * D * Vis * NdotL, with the Fresnel left to the caller because F is a vec3 and
 * this signature returns a float. A consumer wanting the reference's exact term
 * writes
 *
 *     spec = sunColor * snowGGX(L, V, N, roughness)
 *          * fresnelSchlick(clamp(dot(V, normalize(V + L)), 0.0, 1.0), f0);
 *
 * which is what the snow material does inline.
 */
float snowGGX(vec3 L, vec3 V, vec3 N, float roughness) {
    float NdotL = dot(N, L);
    if (NdotL <= 0.0) { return 0.0; }
    float NdotV = clamp(dot(N, V), 1e-4, 1.0);
    vec3  H = normalize(V + L);
    float NdotH = clamp(dot(N, H), 0.0, 1.0);
    return distributionGGX(NdotH, roughness)
         * visSmithGGXCorrelated(NdotV, NdotL, roughness)
         * NdotL;
}

// ---------------------------------------------------------------- subsurface

/// Wrapped diffuse. 'w' = 0 is Lambert; snow wants 0.5-0.7, which pushes the
/// terminator most of the way around the back of a drift. At w = 0.62 the
/// terminator sits at NdotL = -0.62, about 128 degrees from the light.
///
/// The (1+w)^2 denominator is normalisation: a wrap redistributes light, it does
/// not brighten the surface overall.
float wrapDiffuse(float NdotL, float w) {
    float denom = (1.0 + w) * (1.0 + w);
    return max(0.0, (NdotL + w) / denom);
}

/// Back-scatter transmission — light that entered the surface, scattered, and
/// left toward the eye. Peaks looking into the light through a thin edge, which
/// is what lights up drift lips and the far walls of footprints.
///
/// THE SIGN HERE IS THE MOST CONSEQUENTIAL ONE IN THE PROJECT. 'L' points from
/// the surface *toward* the sun, which fixes the sign of the transmission
/// vector: it is 'L + N*distortion', and the lobe is measured against its
/// negation — the direction the scattered light continues in after passing
/// through. Building it from '-L' instead inverts the whole term, so it peaks
/// with the sun behind the camera and switches off looking into it, which is the
/// exact opposite of what translucency does. That reads as snow going flat and
/// dead in the one direction where it should be at its most alive
/// (snow-shading.md §13 criterion 2 is exactly this test).
float backScatter(vec3 N, vec3 L, vec3 V, float distortion, float power, float thickness) {
    vec3 H = normalize(L + N * distortion);
    float vh = pow(clamp(dot(V, -H), 0.0, 1.0), power);
    return vh * thickness;
}

/// Combined snow subsurface response for one light. The reference's form.
/// Returns the RGB radiance contribution to add to the diffuse lobe; the caller
/// multiplies by albedo.
vec3 snowSubsurface(
    vec3 N, vec3 L, vec3 V, vec3 lightColor,
    float thickness,   // 0 = thin edge, 1 = deep drift
    float strength,
    float radius
) {
    // Deeper snow scatters longer and comes back bluer, because red is absorbed
    // first over any appreciable path length. This is the entire reason snow
    // shadows are blue rather than merely dark. At the default radius of 1.0 the
    // tint parameter IS thickness, so the material's thickness ladder is the
    // blue ladder: fresh snow 1.0 -> (0.550, 0.720, 1.0), compressed 0.35 ->
    // (0.803, 0.879, 1.0), ice 0.15 -> (0.882, 0.928, 1.0).
    vec3 shallowTint = vec3(0.94, 0.965, 1.0);
    vec3 deepTint    = vec3(0.55, 0.72, 1.0);
    vec3 tint = mix(shallowTint, deepTint, clamp(thickness * radius, 0.0, 1.0));

    // Lobe width and amplitude both key off thickness, and both run the OPPOSITE
    // way to how they read at first glance. Do not "fix" them: a *thin* edge — a
    // drift lip, a berm crest, the far wall of a footprint — transmits brightly
    // and over a wide range of angles, because the path through it is short from
    // almost anywhere. Deep snow transmits little, and only close to
    // straight-through, because anything else is a longer path than the light
    // survives. Having deep snow carry the broader lobe lights the whole open
    // field evenly and reads as haze rather than as translucency.
    //
    //   power     mix(3.0, 9.0, thickness)   thin = 3 (wide), deep = 9 (tight)
    //   amplitude mix(1.0, 0.30, thickness)  thin = 1 (bright), deep = 0.3 (dim)
    float back = backScatter(
        N, L, V, 0.28 * radius,
        mix(3.0, 9.0, thickness),
        mix(1.0, 0.30, thickness)
    );

    return lightColor * tint * back * strength;
}

/**
 * ARCHITECTURE.md §3.1. Same term, reading strength and radius from the uniform
 * block above.
 *
 * ARGUMENT ORDER IS (L, V, N), which is NOT the reference's (N, L, V). All three
 * are vec3, so a mis-ordered call compiles silently; the contract's order wins
 * here because parallel builders wrote consumers against it.
 */
vec3 snowSubsurface(vec3 L, vec3 V, vec3 N, vec3 lightColor, float thickness) {
    return snowSubsurface(N, L, V, lightColor, thickness, sssStrength, sssRadius);
}

// -------------------------------------------------------------------- glints

/// One octave of discrete surface sparkle.
///
/// Each cell owns a single jittered facet. The disc falloff makes the glint round
/// instead of square, and because both the position and the orientation hash
/// purely off the world-space cell index, a glint is NAILED TO THE GROUND: it
/// does not crawl when the camera moves, which is what lets TAA keep it
/// (snow-shading.md §13 criterion 6 — strafe the camera and the sparkles must
/// extinguish in place, never travel).
float glintOctave(
    vec2 p, float cell, vec3 N, vec3 H, vec3 T, vec3 B, float sharpness
) {
    vec2 id = floor(p / cell);
    vec2 r = hash22(id);
    vec2 r2 = hash22(id + vec2(19.73, 7.31));

    // Only a fraction of cells hold a crystal facet oriented to catch anything.
    if (r2.x > 0.62) { return 0.0; }

    vec2 centre = (id + 0.5 + (r - 0.5) * 0.72) * cell;
    float d = length(p - centre) / (cell * 0.17);
    float disc = clamp(1.0 - d * d, 0.0, 1.0);
    if (disc <= 0.0) { return 0.0; }

    // Tilt the facet off the surface normal by a random amount in the tangent
    // plane. Small tilts (0.10-0.36 rad), or every facet fires at once and it
    // reads as glitter.
    float ang = r.y * 6.28318530718;
    float tilt = 0.10 + r2.y * 0.26;
    vec3 facet = normalize(N + (T * cos(ang) + B * sin(ang)) * tilt);

    float nh = clamp(dot(facet, H), 0.0, 1.0);
    return disc * pow(nh, sharpness);
}

/// Full glint response. The reference's form.
///
/// Two world-space octaves, each faded out once its cell drops under a few pixels
/// — that keeps them from aliasing into a shimmering carpet in the mid-distance
/// while never resizing a cell (which would make them crawl).
///
/// Gated hard on grazing view angle: snow sparkles when you look *across* it into
/// the sun, and stays matte when you look down at it. Losing that gate is what
/// turns this effect into glitter.
float snowGlints(
    vec2 worldXZ, vec3 N, vec3 V, vec3 L,
    float pixelFootprint, float intensity, float grazeGate
) {
    if (intensity <= 0.0) { return 0.0; }

    vec3 H = normalize(V + L);

    // Any stable tangent frame will do — the facets are random anyway. Written
    // right-handed (T, B, N) in Three's world frame; see the header, note 2.
    vec3 up = (abs(N.y) > 0.95) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);

    // Grazing gate: 1 looking along the surface, 0 looking straight down.
    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float graze = pow(1.0 - NdotV, mix(1.5, 5.0, grazeGate));

    // The sun must be low relative to the surface too, or a facet has nothing to
    // bounce toward the eye. The second factor rolls the response back off again
    // above NdotL 0.55, so a face square-on to the sun does not sparkle either.
    float NdotL = clamp(dot(N, L), 0.0, 1.0);
    float lightGate = smoothstep(0.02, 0.35, NdotL)
                    * (1.0 - smoothstep(0.55, 0.95, NdotL) * 0.55);

    float gate = graze * lightGate;
    if (gate <= 0.001) { return 0.0; }

    float sum = 0.0;

    float cellA = 0.052;
    float fadeA = smoothstep(cellA * 0.55, cellA * 2.2, pixelFootprint);
    if (fadeA < 1.0) {
        sum += glintOctave(worldXZ, cellA, N, H, T, B, 780.0) * (1.0 - fadeA);
    }

    float cellB = 0.185;
    float fadeB = smoothstep(cellB * 0.55, cellB * 2.2, pixelFootprint);
    if (fadeB < 1.0) {
        sum += glintOctave(worldXZ + vec2(53.1, 17.9), cellB, N, H, T, B, 1500.0)
             * (1.0 - fadeB) * 1.35;
    }

    return sum * gate * intensity;
}

/**
 * ARCHITECTURE.md §3.1. FRAGMENT STAGE ONLY — it takes fwidth of the world
 * position to size its own footprint.
 *
 * The contract's 'gate' parameter is an extra multiplier on the finished
 * response, which is how the snow material folds in shadow and the ice mask; the
 * light direction comes from uSunDir and the two tunables from the uniform block.
 * Returns RGB so it can be added to radiance directly, per the signed return
 * type; the response itself is monochrome, exactly as the reference's is.
 */
vec3 snowGlints(vec3 worldPos, vec3 V, vec3 N, float gate) {
    vec3 ddxW = dFdx(worldPos);
    vec3 ddyW = dFdy(worldPos);
    float fp = max(length(vec2(length(ddxW.xz), length(ddyW.xz))), 1e-4);
    float g = snowGlints(worldPos.xz, N, V, uSunDir, fp, glintIntensity, glintGrazing);
    return vec3(g * gate);
}

// ------------------------------------------------------------------- helpers

/// Reoriented normal mapping — blends a detail normal onto a base normal without
/// the base's tilt being lost, unlike a naive add-and-normalise. Both arguments
/// are tangent-space (+Z up).
vec3 blendNormalRNM(vec3 base, vec3 detail) {
    vec3 t = base + vec3(0.0, 0.0, 1.0);
    vec3 u = detail * vec3(-1.0, -1.0, 1.0);
    return normalize(t * dot(t, u) - u * t.z);
}

/// Build a world normal from a heightfield gradient. 'd' is (dH/dx, dH/dz).
/// The gradient-to-normal identity for y = H(x, z); not a cross product, so it
/// holds in either handedness.
vec3 normalFromGradient(vec2 d) {
    return normalize(vec3(-d.x, 1.0, -d.y));
}

/// Luminance, Rec.709. Correct only on LINEAR values, which is everything in this
/// port before the tonemap. Duplicates lib/common's luminance() under the
/// reference's name, because consumers ported from the reference call luma().
float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
`;
