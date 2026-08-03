/**
 * `lib/terrain` — the landform. [TERRAIN]
 *
 * Port of the reference's `src/shaders/lib/terrain.wgsl`. Split into two halves
 * that live in different places at runtime:
 *
 *   terrainMacro()  broad dunes + long swell + medium drifts. Tens of metres down
 *                   to about a metre. Baked once into a texture at load, because
 *                   the CPU needs the same data for character grounding and
 *                   reading back a bake is the only way to guarantee the two
 *                   agree exactly.
 *
 *   terrainFine()   sastrugi ridges and wind ripples, decimetre and below.
 *                   Evaluated live in the vertex and fragment stages with exact
 *                   analytic derivatives — far too fine to bake at any sane
 *                   texture resolution, and cheap enough not to bother.
 *
 * Everything is anisotropic about a single prevailing wind direction, which is
 * most of what separates a real snow field from a bumpy one: real fields are
 * *carved*, and the carving has a direction. Broad forms run transverse to the
 * wind (dune ridges), fine forms run parallel to it (sastrugi streaks). If both
 * families run the same way in a screenshot, a windMat's sx/sy have been swapped
 * (terrain.md §14 criterion 1).
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE — ARCHITECTURE.md §3 signs this chunk as "the heightfield
 * function + its derivatives, wind anisotropy" with no named signatures, so the
 * reference's names are the contract:
 *
 *     mat2 windMat(float angle, float sx, float sy, float scale);
 *     float terrainMacro(vec2 p, float w, float amp);          // metres
 *     vec2  terrainMacroD(vec2 p, float w, float amp);         // bake-side only
 *     vec2  rockField(vec2 p, float w);                        // (height m, mask)
 *     vec2  windLocal(vec2 p);                                 // (veer rad, stretch)
 *     vec3  terrainFine(vec2 p, float w, float exposure, float amp);
 *     vec3  terrainFineFiltered(vec2 p, float w, float exposure, float amp, float fp);
 *
 * The two vec3 returns are (height in metres, dH/dx, dH/dz).
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6). This file is where the one world-space
 * convention in the terrain lives, and it is deliberately NOT converted.
 *
 * Every 'vec2 p' here is world (x, z) in Three's right-handed Y-up frame, and
 * every formula is transcribed byte-identically from the left-handed Babylon
 * reference. That is the ruling in _spec/terrain.md §13.1 — "Do not mirror any
 * axis" — and it is the same choice `render/sky.js` made (PORT-11), so the sky,
 * the wind and the terrain agree with each other. The consequence, accepted and
 * stated: the world is a mirror image in Z relative to the reference
 * screenshots, and the *relative* geometry that the look depends on — the 70-80
 * degree separation between `S.windDirection` (42) and `S.sunAzimuth` (118),
 * which is what stops the sun raking down every sastrugi ridge and flattening
 * the fine structure — is preserved exactly, because both bearings are mirrored
 * together.
 *
 * `windMat` rotates the SAMPLE DOMAIN, not the world, and takes no cross
 * product, so there is no chirality inside it to get wrong. The one line in the
 * whole chunk that touches a world direction is the gradient it returns, and
 * that is consumed by `normalFromGradient(d) = normalize(vec3(-d.x, 1, -d.y))`
 * in `lib/shading`, which is the gradient-to-normal identity for a height
 * function y = H(x, z) and holds in either handedness.
 */

export default /* glsl */`
#include "lib/noise"

// ---------------------------------------------------------------- anisotropy

/// Build the combined rotate-and-anisotropically-scale matrix for a noise layer.
/// 'sx' stretches along the wind, 'sy' across it; 'scale' is the wavelength in
/// metres. A layer's derivative maps back to world space with dHdq * M — the
/// row-vector product, which is why every call site below reads (n.yz * m).
///
/// Column-major from columns in both WGSL and GLSL, so this is verbatim.
mat2 windMat(float angle, float sx, float sy, float scale) {
    float c = cos(angle);
    float s = sin(angle);
    mat2 r = mat2(c, -s, s, c);
    mat2 d = mat2(sx / scale, 0.0, 0.0, sy / scale);
    return d * r;
}

// -------------------------------------------------------------------- macro

/// Broad + medium landform. Returns metres.
/// 'w' is the wind bearing in radians, 'amp' a global height multiplier
/// (S.macroHeightScale).
float terrainMacro(vec2 p, float w, float amp) {
    // --- broad dunes -------------------------------------------------------
    // Compressed along the wind (sx = 2.1 against sy = 1.0), so the ridge lines
    // run ACROSS it. Derivative damping keeps crests smooth and lets detail pool
    // in the troughs.
    mat2 m1 = windMat(w, 2.1, 1.0, 58.0);
    vec3 broad = fbmDamped(m1 * p, 5, 2.03, 0.5, 0.9);
    float h = broad.x * 15.5;

    // A second, much larger and gentler swell so the field never reads as one
    // repeating dune wavelength. This is what gives the horizon its long roll:
    // ~210 m period at up to +/-13 m of relief, riding under the ~58 m dunes.
    mat2 m0 = windMat(w, 1.35, 1.0, 210.0);
    vec3 swell = fbmDamped(m0 * p, 3, 2.11, 0.55, 0.3);
    h += swell.x * 26.0;

    // --- medium drifts and wind lobes --------------------------------------
    // The domain is sheared along the wind by the broad height, which steepens
    // lee faces and flattens windward ones — dune asymmetry, near enough. Drop
    // this line and the dunes become symmetric sine-like humps.
    mat2 m2 = windMat(w, 1.55, 1.0, 13.5);
    vec2 q2 = m2 * p;
    q2.x += broad.x * 2.4;
    vec3 med = fbmDamped(q2, 4, 2.07, 0.48, 1.7);

    // Drifts pile up where the broad form is concave (troughs and lee pockets)
    // and get scoured off exposed crests. Clamped at 0.15, not 0, so crests keep
    // 15% of the drift texture rather than going glassy.
    float shelter = clamp(0.5 - broad.x * 0.75, 0.15, 1.0);
    h += med.x * 2.9 * shelter;

    return h * amp;
}

/// Analytic macro derivative, by central difference at a 0.35 m step.
///
/// ONLY the bake would use this, and in fact nothing does at runtime: the
/// gradient the material shades with is read from the aux texture, which
/// differentiates the *baked* height instead. Kept so the two can be diffed —
/// differentiating the analytic function at runtime instead is what produces
/// phantom shading seams on smooth dunes (terrain.md §13.10).
vec2 terrainMacroD(vec2 p, float w, float amp) {
    float e = 0.35;
    float hx = terrainMacro(p + vec2(e, 0.0), w, amp) - terrainMacro(p - vec2(e, 0.0), w, amp);
    float hz = terrainMacro(p + vec2(0.0, e), w, amp) - terrainMacro(p - vec2(0.0, e), w, amp);
    return vec2(hx, hz) / (2.0 * e);
}

// -------------------------------------------------------------------- rocks

/// Sparse exposed rock. Jittered 165 m grid, one outcrop per cell, roughly two
/// thirds of them culled so the field stays "just snow and the player".
/// Returns vec2(height contribution in metres, rock mask 0..1).
vec2 rockField(vec2 p, float w) {
    float cell = 165.0;
    vec2 gi = floor(p / cell);

    float hSum = 0.0;
    float mask = 0.0;

    // 3x3 neighbourhood so blobs straddle cell borders cleanly.
    for (int dy = -1; dy <= 1; ++dy) {
        for (int dx = -1; dx <= 1; ++dx) {
            vec2 id = gi + vec2(float(dx), float(dy));
            vec2 r = hash22(id);
            vec2 r2 = hash22(id + 71.3);

            // Cull most cells: outcrops are meant to be sparse.
            if (r2.x > 0.34) { continue; }

            vec2 centre = (id + 0.15 + r * 0.7) * cell;
            float radius = 7.0 + r2.y * 11.0;
            float d = length(p - centre);
            if (d > radius * 1.6) { continue; }

            // Smooth dome, then broken up by ridged noise so it reads as rock
            // rather than as a lump. The noise rides the dome so it never
            // detaches from the silhouette.
            float t = clamp(1.0 - d / radius, 0.0, 1.0);
            float dome = t * t * (3.0 - 2.0 * t);
            mat2 mr = windMat(w, 1.0, 1.0, 5.5);
            float rough = ridgedd(mr * (p - centre), 3, 2.17, 0.55).x;
            float hgt = (3.5 + r2.y * 6.0);

            hSum += dome * hgt * (0.62 + 0.55 * rough);
            mask = max(mask, dome * dome);
        }
    }
    return vec2(hSum, mask);
}

// --------------------------------------------------------------------- fine

/// Local departure of the wind from its prevailing bearing, in radians, and the
/// local anisotropy of the sastrugi.
///
/// One global bearing gives every ridge in the field the same direction and the
/// same aspect ratio, and the result reads as corduroy — a woven texture laid
/// over the landform rather than snow carved by weather. Real sastrugi does not
/// do that: the wind veers as it crosses a dune, so the field breaks into patches
/// that run at slightly different angles and are streakier in some places than
/// others. Two slow noise fields, at ~120 m (veer, +/-0.42 rad = +/-24 deg) and
/// ~80 m (stretch, 2.3 to 4.7), are enough to destroy the uniformity completely
/// while leaving the prevailing direction obvious.
///
/// Both fine layers below read this, and so does the *filtered* twin further
/// down, which must produce the same surface — one is the vertex displacement and
/// the other is the fragment normal.
///
/// The layer derivatives ignore the chain-rule term from the veer varying with
/// position. The veer field's wavelength is fifty times the sastrugi's, so that
/// term is a couple of percent of a normal — well under what the detail maps
/// perturb it by anyway.
vec2 windLocal(vec2 p) {
    float veer = noise2(p * 0.0083 + vec2(31.7, 12.3)) * 0.42;
    float stretch = 2.3 + 2.4 * (noise2(p * 0.0126 + vec2(7.1, 41.9)) * 0.5 + 0.5);
    return vec2(veer, stretch);
}

/// Sastrugi + ripples + grain, unfiltered. Returns vec3(height m, dH/dx, dH/dz).
///
/// This is the VERTEX-stage twin: it displaces real geometry, and only on rings
/// fine enough to carry it (spacing < 0.42 m). 'exposure' (0..1) comes from the
/// baked curvature channel: wind scours crests into hard sastrugi and leaves
/// hollows smooth, so the two fine layers are cross-faded by it rather than
/// applied uniformly — and with OPPOSITE polarity, which is criterion 9.
vec3 terrainFine(vec2 p, float w, float exposure, float amp) {
    float h = 0.0;
    vec2 d = vec2(0.0);

    vec2 wl = windLocal(p);

    // --- sastrugi ----------------------------------------------------------
    // Compressed *across* the wind (sy = wl.y, 2.3-4.7, against sx = 1.0), so
    // the ridges streak ALONG it. Ridged noise gives the hard scalloped crest
    // and soft trough that sastrugi actually has. Real sastrugi stands 10-30 cm
    // proud and is a landform in its own right, not a texture — underscaling it
    // is what leaves a snow field looking like poured icing.
    mat2 m3 = windMat(w + wl.x, 1.0, wl.y, 2.3);
    vec3 sas = ridgedd(m3 * p, 3, 2.11, 0.52);
    float scour = 0.45 + 0.55 * smoothstep(-0.25, 0.35, noise2(p * 0.021));
    float sasAmp = 0.125 * amp * mix(0.45, 1.0, exposure) * scour;
    h += (sas.x - 0.35) * sasAmp;
    d += (sas.yz * m3) * sasAmp;

    // --- wind ripples ------------------------------------------------------
    // Fine transverse corrugation, strongest in the sheltered flats where
    // sastrugi is weak — note mix(1.0, 0.45, exposure), the inverse of the
    // sastrugi's mix(0.45, 1.0, exposure).
    //
    // Veered by HALF of what the sastrugi is: ripples form in the boundary layer
    // and follow the local flow more closely than the metre-scale forms do, but
    // giving them the same veer makes the two layers move together and the field
    // goes back to reading as one woven sheet.
    mat2 m4 = windMat(w + wl.x * 0.5, 2.9, 1.0, 0.42);
    vec3 rip = noised(m4 * p);
    float ripAmp = 0.024 * amp * mix(1.0, 0.45, exposure);
    h += rip.x * ripAmp;
    d += (rip.yz * m4) * ripAmp;

    // --- grain -------------------------------------------------------------
    // Sub-centimetre. Too small to displace geometry usefully, but it keeps the
    // normal field alive right under the camera.
    mat2 m5 = windMat(w, 1.0, 1.0, 0.115);
    vec3 gr = noised(m5 * p);
    float grAmp = 0.0075 * amp;
    h += gr.x * grAmp;
    d += (gr.yz * m5) * grAmp;

    return vec3(h, d);
}

/// Footprint-filtered fine layer, for the FRAGMENT stage.
///
/// Each layer fades out once its wavelength drops near the size of a pixel.
/// Without this the sastrugi turns into a crawling moire carpet across the
/// mid-distance the moment the camera moves — and unlike geometry aliasing, TAA
/// cannot rescue normal-map aliasing, because the signal is already wrong before
/// it is sampled. Fading is not a quality compromise here; it *is* the filter.
///
/// 'fp' is the world-space size of one pixel, from the derivative of world
/// position. It is the AVERAGED footprint, not the narrow axis: for these
/// natural layers, fading out at grazing incidence is deliberate and correct.
/// (The carved-snow gradient in the snow fragment uses the narrow axis instead,
/// for the opposite and equally deliberate reason — see the note there.)
vec3 terrainFineFiltered(vec2 p, float w, float exposure, float amp, float fp) {
    float h = 0.0;
    vec2 d = vec2(0.0);

    // Same local veer and anisotropy the vertex stage used. See windLocal.
    vec2 wl = windLocal(p);

    // Sastrugi: wavelength ~2.3 m.
    float fadeS = 1.0 - smoothstep(0.35, 1.6, fp);
    if (fadeS > 0.001) {
        mat2 m3 = windMat(w + wl.x, 1.0, wl.y, 2.3);
        vec3 sas = ridgedd(m3 * p, 3, 2.11, 0.52);
        // Modulated by a slow ~48 m field so the surface has scoured patches and
        // smooth patches rather than one uniform corduroy everywhere.
        float scour = 0.45 + 0.55 * smoothstep(-0.25, 0.35, noise2(p * 0.021));
        float a = 0.125 * amp * mix(0.45, 1.0, exposure) * scour * fadeS;
        h += (sas.x - 0.35) * a;
        d += (sas.yz * m3) * a;
    }

    // Ripples: wavelength ~0.42 m.
    float fadeR = 1.0 - smoothstep(0.06, 0.3, fp);
    if (fadeR > 0.001) {
        mat2 m4 = windMat(w + wl.x * 0.5, 2.9, 1.0, 0.42);
        vec3 rip = noised(m4 * p);
        float a = 0.024 * amp * mix(1.0, 0.45, exposure) * fadeR;
        h += rip.x * a;
        d += (rip.yz * m4) * a;
    }

    // Grain: wavelength ~0.115 m.
    float fadeG = 1.0 - smoothstep(0.016, 0.08, fp);
    if (fadeG > 0.001) {
        mat2 m5 = windMat(w, 1.0, 1.0, 0.115);
        vec3 gr = noised(m5 * p);
        float a = 0.0075 * amp * fadeG;
        h += gr.x * a;
        d += (gr.yz * m5) * a;
    }

    return vec3(h, d);
}
`;
