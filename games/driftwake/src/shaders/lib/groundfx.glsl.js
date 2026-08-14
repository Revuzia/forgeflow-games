/**
 * `lib/groundfx` — the ONE height call every ground-conforming FX vertex stage
 * makes. [SPELLS/FX]
 *
 * WHY THIS EXISTS (owner 2026-08-13, twice): the ground FX — the frost-arc
 * decal, the enemy telegraph rings and the player cast rings — were flat
 * quads at the cast point's height. On this dune map (grades of 0.6 are
 * ordinary at the spawn bowl) the quad intersects the landform: the uphill
 * half of every footprint was BURIED under the snow and the downhill half
 * floated in the air. Measured before the fix (`_harness/qa_groundfx.py`,
 * grade-0.62 slope): uphill/downhill visible-pixel ratio 0.0 for the cast
 * ring, 0.027 for the telegraph, and the arc decal contributed exactly ZERO
 * changed pixels to the frame — invisible, which is what the owner was
 * looking at.
 *
 * THE DESIGN: the FX draw a 16x16-tessellated grid per pool slot and this
 * chunk displaces every grid vertex by THE TERRAIN'S OWN HEIGHT CHAIN —
 * chosen over screen-space depth-projected decals because the entire chain
 * is already GPU-resident and shared (`lib/clipmap`'s `heightTex` bicubic +
 * `lib/terrain`'s analytic fine field + `lib/deform`'s state buffer), so the
 * decal hugs even snow the player has carved, needs no depth readback, no
 * extra pass, keeps one draw per system, and cannot smear along view rays at
 * grazing angles the way projected decals do.
 *
 * The three ingredients mirror `clipmapSurface()` term for term:
 *
 *   macro   sampleHeightBicubic(heightTex) — the exact fetch the terrain
 *           vertex stage displaces by (and the CPU `heightAt` reconstructs).
 *   fine    terrainFine(...) * fade — same 0.16 -> 0.42 fade the clipmap
 *           applies, but keyed to the DECAL grid's own cell size: a lattice
 *           that cannot carry the sastrugi must not alias it in.
 *   deform  deformHeightAt(worldXZ, cell) — the band-limited trench/berm
 *           field. Deliberately NOT deformDisplace(): that call's >= 1 m
 *           gate is a clipmap-ring LOD policy, and a wide decal's coarse
 *           cell must still follow a trench rather than switch it off.
 *
 * The residue is whatever fine detail the decal lattice cannot represent —
 * bounded by the sastrugi amplitude (~0.10 m worst case at amp 1). The lift
 * covers it: the base 0.07 m anti-z-fight lift grows by up to 0.06 m as the
 * fine fade closes, so unresolved crests cannot poke through the decal. Net
 * placement error stays within ~0.1 m of the drawn surface on any slope,
 * against multi-metre burial before.
 *
 * Cost: per grid vertex, 4 bilinear height taps + 1 aux tap + 9 deform taps
 * + the fine field's noise when the cell is fine enough. Worst case all
 * three pools live is ~3.5 k vertices — vertex-stage noise, dwarfed by the
 * clipmap itself.
 *
 * Included by: shaders/arcdecal.glsl.js, shaders/telegraph.glsl.js,
 * shaders/castring.glsl.js (vertex stages only — this pulls in lib/clipmap,
 * which declares `heightTex` and must stay out of fragment stages). The
 * consumer material must carry `terrain.clipUniforms` and
 * `terrain.deformUniforms` (shared by reference, like every other block).
 */

export default /* glsl */`
#include "lib/clipmap"

/// How much of the analytic fine field (sastrugi + ripples) a decal lattice
/// of 'cell' metres can carry — the clipmap's own 0.16 -> 0.42 m fade, keyed
/// to the decal grid instead of the ring spacing.
float groundFxFineFade(float cell) {
    return 1.0 - smoothstep(0.16, 0.42, cell);
}

/// Drawn-terrain height at a world XZ, for a decal whose grid cells are
/// 'cell' metres wide. The three terms are clipmapSurface()'s, band-limited
/// to what the decal lattice resolves; see the file header.
float groundFxHeight(vec2 worldXZ, float cell) {
    vec2 hUV = worldToHeightUV(worldXZ, worldOrigin, worldSize);
    float h = sampleHeightBicubic(hUV, heightRes);

    float fade = groundFxFineFade(cell);
    if (fade > 0.001) {
        float exposure = textureLod(auxTex, hUV, 0.0).a;
        h += terrainFine(worldXZ, windAngle, exposure, sastrugiAmp).x * fade;
    }

    // deformHeightAt, not deformDisplace: no ring-LOD gate, just the
    // binomial band-limit at the decal's own cell (floored at one buffer
    // texel, the finest width the state carries).
    h += deformHeightAt(worldXZ, max(cell, deformTexel));
    return h;
}

/// Anti-z-fight lift, metres. Base 0.07 (the FX's historical flat lift) plus
/// up to 0.06 as the fine fade closes, covering the sastrugi crests the
/// lattice left unresolved so they cannot poke through the decal.
float groundFxLift(float cell) {
    return 0.07 + 0.06 * smoothstep(0.16, 0.42, cell);
}
`;
