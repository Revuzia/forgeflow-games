/**
 * `lib/ground` — the REALM surface block: the uniforms and the three functions
 * that decide whether the ground reads as snow, sand or ash.
 *
 * NOT registered as an `#include` chunk. It is exported as plain strings and
 * CONCATENATED into the two fragment stages that need it (`snow.glsl.js` and
 * `sky.glsl.js`), because those are the only two consumers and registering a
 * fifteenth chunk would mean editing `shaders/registry.js`, which belongs to a
 * different owner. Concatenation gives the identical result with no shared
 * mutable registry state.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 *
 * Four independent mechanisms make the terrain read as SNOW, and recolouring
 * only the albedo leaves all four in place — which is exactly how a "sand"
 * realm ends up looking like tinted snow (REALM_CONTRACT §1b):
 *
 *   1. a near-white, BLUE-WEIGHTED albedo (B/R = 1.105)
 *   2. the SUBSURFACE tint pair, shallow (0.94,0.965,1.0) -> deep (0.55,0.72,1.0).
 *      `lib/shading`'s own header: "The subsurface term below is doing most of
 *      the work of making this read as snow at all."
 *   3. a WRAPPED diffuse at w = 0.62, which pushes the terminator 128 degrees
 *      around the back of every drift. Snow's mean free path is millimetres;
 *      sand's and ash's are not, and they have hard terminators.
 *   4. a BLUE CAVE TINT in every hollow, because a real snow cave is blue.
 *
 * Plus two character mechanisms that are not colour at all:
 *
 *   5. MICRO-RELIEF — sastrugi streak ALONG the wind. Aeolian sand ripples run
 *      TRANSVERSE to it, and an ash crust is a near-isotropic polygon network of
 *      channels DOWN rather than ridges up.
 *   6. SPARKLE — snow's is a tight specular glint off a crystal facet; mica is
 *      wider, rarer and gold; a cinder speck is EMISSIVE and still glows in
 *      shadow, which is what stops it reading as glitter on black sand.
 *
 * Every uniform below is SEEDED BY ITS CONSUMER with the exact literal it
 * replaces, so the default (Cold) state is byte-identical to the shipped frame.
 * `uFineMode = 0` makes `realmFine()` return zero, and `uGlintFacet.w = 0` keeps
 * the glint on its specular path.
 *
 * ---------------------------------------------------------------------------
 * MULTIPLIERS, NOT OVERRIDES, for anything the overlay also drives
 *
 * `sssStrength`, `sssRadius`, `glintIntensity` and `glintGrazing` are live
 * sliders read from `S` every frame into `lib/shading`'s block. A realm that
 * OVERWROTE them would kill four sliders; a realm that MULTIPLIES them leaves
 * every slider working and still lands on the contract's number at the default
 * position. Hence `uSssMul` and `uWrapGlint.zw`.
 *
 * ---------------------------------------------------------------------------
 * ONE MATERIAL, ONE PROGRAM. There is no `#define` variant and no second
 * permutation: the realm branch is `uFineMode` and `uGlintFacet.w`, both plain
 * uniforms, both uniform across the draw, so the hardware takes one side of the
 * branch coherently for the whole frame. Swapping realms costs a uniform write,
 * not a shader compile.
 */

/**
 * The realm block for the SNOW fragment: uniforms, the realm subsurface term,
 * the realm glints and the realm micro-relief.
 *
 * Requires, in this order before it: `lib/noise` (hash22, noise2, noised,
 * ridgedd), `lib/terrain` (refXZ, refWind, windLocal, windMat) and `lib/shading`
 * (backScatter). All three are already in the snow fragment's include chain.
 * @type {string}
 */
export const GROUND_BLOCK = /* glsl */ `
// ------------------------------------------------------- realm surface block

/// Base surface colour. Cold (0.855, 0.885, 0.945) — B/R 1.105, the blue
/// weighting that is half of why this reads as snow.
uniform vec3 uGroundAlbedo;
/// Compressed / trodden colour, mixed in at compression * 0.85.
uniform vec3 uCompressCol;
/// The "ice" channel. Repurposed per realm, never removed — SSR is gated on
/// deform.iceEverBrushed, so a realm that zeroed it would lose the reflection.
uniform vec3 uIceCol;
/// Berm colour. Invariant: a berm reads BRIGHTER than the surround and never
/// cooler than it.
uniform vec3 uLooseCol;
uniform vec3 uRockColA;
uniform vec3 uRockColB;
/// The subsurface tint pair. At radius 1.0 the tint parameter IS thickness, so
/// these two re-colour the entire depth ladder in one write.
uniform vec3 uSssShallow;
uniform vec3 uSssDeep;
/// Hollow tint. Cold's is the deep subsurface blue; a sand hollow is warm-brown
/// and an ash hollow is nearly black.
uniform vec3 uCaveTint;
/// Glint colour. White in Cold (the term was untinted), pale gold for mica,
/// cinder orange for embers.
uniform vec3 uGlintTint;

/// x base roughness, y base f0, z base thickness, w ice f0.
uniform vec4 uSurfaceParams;
/// x compressed roughness, y compressed thickness, z ice roughness, w ice thickness.
uniform vec4 uCompressParams;
/// x rock gate lo, y rock gate hi, z loose roughness, w sky bounce coefficient.
uniform vec4 uRockParams;
/// x wrap amount loose, y wrap amount compressed, z glint intensity multiplier,
/// w glint grazing multiplier.
uniform vec4 uWrapGlint;
/// x facet survival cull, y facet tilt base, z facet tilt jitter,
/// w EMISSIVE amount — 0 keeps the glint specular (sun times shadow), above 0
/// drops both the sun and the shadow and bypasses the NdotL gate.
uniform vec4 uGlintFacet;
uniform vec2 uGlintCells;
uniform vec2 uGlintSharp;
/// x subsurface strength multiplier, y subsurface radius multiplier.
uniform vec2 uSssMul;
/// The three grain-map tiling rates, per metre. Cold 7.5 / 1.7 / 0.31.
uniform vec3 uDetailScales;

/// 0 sastrugi (Cold, handled entirely by lib/terrain) - 1 dune ripples -
/// 2 crust cracks. Above 0, realmFine() adds a second, realm-shaped layer.
uniform float uFineMode;
/// x amplitude (metres, pre-divided by the realm's sastrugi multiplier so the
/// product lands on the contract number), y scour field frequency, z fragment
/// fade lo, w fragment fade hi.
uniform vec4 uFineA;
/// x primary wavelength, y ripple amplitude, z ripple wavelength,
/// w exposure-fade low end.
uniform vec4 uFineB;

// ---------------------------------------------------------------- subsurface

/// The realm subsurface term. Structurally identical to lib/shading's
/// snowSubsurface() — same backScatter call, same lobe power and amplitude
/// ladder — with the two hard-coded tints lifted to uniforms. Seeded with Cold's
/// pair it returns exactly what snowSubsurface returns.
vec3 realmSubsurface(
    vec3 N, vec3 L, vec3 V, vec3 lightColor,
    float thickness, float strength, float radius
) {
    vec3 tint = mix(uSssShallow, uSssDeep, clamp(thickness * radius, 0.0, 1.0));
    float back = backScatter(
        N, L, V, 0.28 * radius,
        mix(3.0, 9.0, thickness),
        mix(1.0, 0.30, thickness)
    );
    return lightColor * tint * back * strength;
}

// -------------------------------------------------------------------- glints

/// One octave of discrete surface sparkle, with the facet statistics lifted to
/// uniforms. Cold: cull 0.62, tilt 0.10 + 0.26 jitter — the shipped numbers.
float realmGlintOctave(
    vec2 p, float cell, vec3 N, vec3 H, vec3 T, vec3 B, float sharpness
) {
    vec2 id = floor(p / cell);
    vec2 r = hash22(id);
    vec2 r2 = hash22(id + vec2(19.73, 7.31));

    if (r2.x > uGlintFacet.x) { return 0.0; }

    vec2 centre = (id + 0.5 + (r - 0.5) * 0.72) * cell;
    float d = length(p - centre) / (cell * 0.17);
    float disc = clamp(1.0 - d * d, 0.0, 1.0);
    if (disc <= 0.0) { return 0.0; }

    float ang = r.y * 6.28318530718;
    float tilt = uGlintFacet.y + r2.y * uGlintFacet.z;
    vec3 facet = normalize(N + (T * cos(ang) + B * sin(ang)) * tilt);

    float nh = clamp(dot(facet, H), 0.0, 1.0);
    return disc * pow(nh, sharpness);
}

/// Full realm sparkle. Cold's two octaves at 0.052 / 0.185 and sharpness
/// 780 / 1500 reproduce lib/shading's snowGlints exactly.
///
/// THE EMISSIVE BRANCH IS THE WHOLE TRICK for ash. A cinder speck is not a
/// facet catching the sun, it is a small hot thing, so above uGlintFacet.w = 0
/// the sun gate is bypassed here and the caller drops sunRadiance and shadow
/// from the multiplier. An ember in the shade still glows.
float realmGlints(
    vec2 worldXZ, vec3 N, vec3 V, vec3 L,
    float pixelFootprint, float intensity, float grazeGate
) {
    if (intensity <= 0.0) { return 0.0; }

    vec3 H = normalize(V + L);

    vec3 up = (abs(N.y) > 0.95) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);

    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float graze = pow(1.0 - NdotV, mix(1.5, 5.0, grazeGate));

    float NdotL = clamp(dot(N, L), 0.0, 1.0);
    float lightGate = smoothstep(0.02, 0.35, NdotL)
                    * (1.0 - smoothstep(0.55, 0.95, NdotL) * 0.55);
    if (uGlintFacet.w > 0.0) { lightGate = 1.0; }

    float gate = graze * lightGate;
    if (gate <= 0.001) { return 0.0; }

    float sum = 0.0;

    float cellA = uGlintCells.x;
    float fadeA = smoothstep(cellA * 0.55, cellA * 2.2, pixelFootprint);
    if (fadeA < 1.0) {
        sum += realmGlintOctave(worldXZ, cellA, N, H, T, B, uGlintSharp.x)
             * (1.0 - fadeA);
    }

    float cellB = uGlintCells.y;
    float fadeB = smoothstep(cellB * 0.55, cellB * 2.2, pixelFootprint);
    if (fadeB < 1.0) {
        sum += realmGlintOctave(worldXZ + vec2(53.1, 17.9), cellB, N, H, T, B,
                                uGlintSharp.y)
             * (1.0 - fadeB) * 1.35;
    }

    return sum * gate * intensity;
}

// -------------------------------------------------------------- micro-relief

/// The realm's own fine layer, ADDED to lib/terrain's sastrugi rather than
/// replacing it — the sastrugi is scaled down to a residue by the realm's
/// sastrugi multiplier (a clipmap uniform, so BOTH twins see it and the
/// silhouette and the shading keep describing one surface), and this puts the
/// realm's own structure on top.
///
/// SCOPE, STATED PLAINLY: this is a FRAGMENT-stage layer, like the three grain
/// scales above it. lib/terrain's vertex twin still displaces sastrugi, at the
/// reduced amplitude. Branching the vertex twin as well means editing
/// lib/terrain.glsl.js, which is another owner's file.
///
/// Returns vec3(height m, dH/dx, dH/dz), zero in Cold.
vec3 realmFine(vec2 pPort, float wPort, float exposure, float amp, float fp) {
    if (uFineMode < 0.5) { return vec3(0.0); }

    vec2  p = refXZ(pPort);
    float w = refWind(wPort);

    float h = 0.0;
    vec2 d = vec2(0.0);

    vec2 wl = windLocal(p);
    float scour = 0.45 + 0.55 * smoothstep(-0.25, 0.35, noise2(p * uFineA.y));
    float fadeP = 1.0 - smoothstep(uFineA.z, uFineA.w, fp);
    float fadeR = 1.0 - smoothstep(uFineB.z * 0.14, uFineB.z * 0.72, fp);

    if (uFineMode < 1.5) {
        // ---- SAND: aeolian ripples --------------------------------------
        // sx and sy are SWAPPED against the sastrugi layer, so the crests run
        // TRANSVERSE to the flow, which is what real wind ripples do and the
        // exact opposite of sastrugi. Smooth noise, not ridged: a ripple has a
        // rounded crest AND a rounded trough, where sastrugi has a hard
        // scalloped crest over a soft one.
        //
        // A consequence worth writing down before a reviewer files it as a bug:
        // in a SAND frame the broad dune ridges and the fine ripples run the
        // SAME way. That is the negation of Cold's acceptance criterion and it
        // is deliberate.
        if (fadeP > 0.001) {
            mat2 m = windMat(w + wl.x, wl.y, 1.0, uFineB.x);
            vec3 n = noised(m * p);
            float a = uFineA.x * amp * mix(uFineB.w, 1.0, exposure) * scour * fadeP;
            h += n.x * a;
            d += (n.yz * m) * a;
        }
        if (fadeR > 0.001) {
            mat2 m2 = windMat(w + wl.x * 0.5, 1.0, 2.9, uFineB.z);
            vec3 n2 = noised(m2 * p);
            float a2 = uFineB.y * amp * mix(1.0, 0.45, exposure) * fadeR;
            h += n2.x * a2;
            d += (n2.yz * m2) * a2;
        }
    } else {
        // ---- ASH: crust cracks -------------------------------------------
        // Cracks are channels DOWN, not ridges up, and a mud or ash polygon
        // network has no wind direction at all — the near-isotropic windMat is
        // what kills the corduroy read on its own. pow(c, 2.6) narrows a rounded
        // ridged crest into a crack wall; the derivative is chained through it
        // as 2.6 * pow(c, 1.6), which is d/dc of c^2.6 written out so the two
        // can be diffed against each other.
        if (fadeP > 0.001) {
            mat2 m = windMat(w, 1.35, 1.0, uFineB.x);
            vec3 cr = ridgedd(m * p, 4, 2.07, 0.55);
            float c = clamp(cr.x, 0.0, 1.0);
            float crk = pow(c, 2.6);
            float a = uFineA.x * amp * mix(uFineB.w, 1.0, exposure) * scour * fadeP;
            h -= crk * a;
            d -= (2.6 * pow(c, 1.6) * (cr.yz * m)) * a;
        }
        if (fadeR > 0.001) {
            mat2 m2 = windMat(w, 1.0, 1.0, uFineB.z);
            vec3 n2 = noised(m2 * p);
            float a2 = uFineB.y * amp * mix(1.0, 0.45, exposure) * fadeR;
            h += n2.x * a2;
            d += (n2.yz * m2) * a2;
        }
    }

    // dH/dz flips sign back through the mirror, exactly as lib/terrain's twins
    // do: z_ref = -z_port. The height itself is a scalar and is unaffected.
    return vec3(h, d.x, -d.y);
}
`;

/**
 * The realm block for the SKY fragment. A different, smaller set: the far range
 * and the cirrus are the only two places the sky fragment hard-codes a snow fact.
 *
 * `uSssShallow` and `uSssDeep` are declared here TOO, under the same names, but
 * they are a separate uniform set on a separate program — the sky material and
 * the snow material do not share a uniform record. Both are written from the same
 * realm row, so they cannot drift.
 * @type {string}
 */
export const SKY_REALM_BLOCK = /* glsl */ `
// ---------------------------------------------------------- realm sky block

/// Far-range surface albedos. Cold: rock (0.052,0.055,0.066) under snow
/// (0.855,0.885,0.945).
uniform vec3 uFarRockAlbedo;
uniform vec3 uFarSnowAlbedo;
/// smoothstep(lo, hi, steep) — the snow-line gate. Sand sheds off steeper faces
/// than snow does, ash sticks to almost nothing.
uniform vec2 uFarSnowGate;
/// The far range's own subsurface tint pair, matching the ground's.
uniform vec3 uSssShallow;
uniform vec3 uSssDeep;
/// Cirrus underside colour. Cold's (0.52,0.60,0.74) is a cool blue-grey and is
/// a Cold fact, not a cloud fact.
uniform vec3 uCirrusColor;
`;
