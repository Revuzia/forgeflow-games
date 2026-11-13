/**
 * The per-realm LANDFORM block — the shape of the ground, as data. [TERRAIN — laneE]
 *
 * =============================================================================
 * WHAT THIS FIXES. `world/realms.js` has always carried `wind.macroHeightScale`
 * (Cold 1.0, Sand 1.25, Ash 0.65) and `realmSettings()` has always returned it,
 * but `applyRealmGrade` (settings.js REALM_GRADE_KEYS) picks only the seven
 * fog/tone keys out of that patch, and `Terrain.applyRealm()` writes only
 * shading uniforms. Nothing ever reached `Heightfield.bake()`, whose only two
 * inputs are `S.windDirection` and `S.macroHeightScale` — so the 4096² macro
 * bake ran exactly once at boot and every realm stood on Cold's ground, byte
 * for byte. Measured, not assumed: 20 fixed points sampled through
 * `terrain.heightAt` before and after six realm switches were identical to the
 * last bit (`_harness/qa_landform_edge.py`).
 *
 * A realm now carries a whole landform: wavelengths, amplitudes, anisotropy,
 * crest shape, domain warp, basins and rock. `Heightfield` re-bakes when it
 * changes, and because the CPU mirror IS a readback of that bake, `heightAt`
 * and the clipmap's GPU displacement cannot disagree — the lockstep is
 * structural, not maintained.
 *
 * =============================================================================
 * COLD IS THE IDENTITY. Every value in `LANDFORM_COLD` is the literal it
 * replaced in `shaders/lib/terrain.glsl.js`, quoted at the line. A block that
 * equals it is not merely equivalent to the original bake, it is routed to the
 * ORIGINAL PROGRAM (`landformIsDefault` → `Heightfield._heightPass`), so Cold's
 * heightfield is the same instruction stream it has always been. See the header
 * of `landformBake.glsl.js` for why "same maths" was not judged good enough.
 *
 * Pure data and pure functions: no imports, no GPU, no `S`. A probe can read
 * and diff these without standing a renderer up.
 */

/**
 * @typedef {Object} LandformBlock
 * @property {number} duneLen      broad dune wavelength, metres
 * @property {number} duneAmp      broad dune amplitude, metres
 * @property {number} duneAniso    along-wind compression of the dune layer
 * @property {number} duneRidge    0 rounded drifts .. 1 fully folded crests
 * @property {number} swellLen     long swell wavelength, metres
 * @property {number} swellAmp     long swell amplitude, metres
 * @property {number} swellAniso   along-wind compression of the swell
 * @property {number} warp         domain warp, metres (0 = straight ridge lines)
 * @property {number} driftLen     medium drift wavelength, metres
 * @property {number} driftAmp     medium drift amplitude, metres
 * @property {number} driftAniso   along-wind compression of the drift layer
 * @property {number} driftShear   lee-face shear, in dune-height units
 * @property {number} basinCell    basin grid cell, metres (0 = no basins)
 * @property {number} basinDepth   basin depth, metres
 * @property {number} basinRadius  basin radius, metres
 * @property {number} basinCull    P(a cell holds a basin), 0..1
 * @property {number} rockCell     outcrop grid cell, metres
 * @property {number} rockCull     P(a cell holds an outcrop), 0..1
 * @property {number} rockBase     outcrop height floor, metres
 * @property {number} rockVar      outcrop height variance, metres
 * @property {number} rockRadMin   outcrop radius floor, metres
 * @property {number} rockRadVar   outcrop radius variance, metres
 * @property {number} rockWave     outcrop roughness wavelength, metres
 * @property {number} rockRough    outcrop roughness mix
 * @property {number} heightScale  overall relief multiplier
 */

/**
 * COLD — the identity block. Every number is the literal it replaced.
 * @type {LandformBlock}
 */
export const LANDFORM_COLD = Object.freeze({
    duneLen: 58.0,      // lib/terrain.glsl.js:132 windMat(w, 2.1, 1.0, 58.0)
    duneAmp: 15.5,      // :134  broad.x * 15.5
    duneAniso: 2.1,     // :132
    duneRidge: 0.0,     // no fold in the original
    swellLen: 210.0,    // :139  windMat(w, 1.35, 1.0, 210.0)
    swellAmp: 26.0,     // :141  swell.x * 26.0
    swellAniso: 1.35,   // :139
    warp: 0.0,          // no warp in the original
    driftLen: 13.5,     // :147  windMat(w, 1.55, 1.0, 13.5)
    driftAmp: 2.9,      // :156  med.x * 2.9 * shelter
    driftAniso: 1.55,   // :147
    driftShear: 2.4,    // :149  q2.x += broad.x * 2.4
    basinCell: 0.0,     // no basins in the original
    basinDepth: 0.0,
    basinRadius: 0.0,
    basinCull: 0.0,
    rockCell: 165.0,    // :188  float cell = 165.0
    rockCull: 0.34,     // :202  if (r2.x > 0.34) continue
    rockBase: 3.5,      // :216  hgt = (3.5 + r2.y * 6.0)
    rockVar: 6.0,       // :216
    rockRadMin: 7.0,    // :205  radius = 7.0 + r2.y * 11.0
    rockRadVar: 11.0,   // :205
    rockWave: 5.5,      // :214  windMat(w, 1.0, 1.0, 5.5)
    rockRough: 0.55,    // :218  (0.62 + 0.55 * rough)
    heightScale: 1.0,   // realms.js cold wind.macroHeightScale
});

/** The key list, in declaration order. Probe surface, and the diff order. */
export const LANDFORM_KEYS = Object.freeze(Object.keys(LANDFORM_COLD));

/**
 * Fill a partial block out to a whole one against Cold.
 *
 * A missing key takes Cold's value rather than 0 — the same rule
 * `Terrain.applyRealm()` already applies to the shading block, and for the same
 * reason: a zeroed `duneLen` is a divide by zero inside `windMat`, which bakes
 * a NaN heightfield and drops the character through the world with no error
 * anywhere.
 *
 * @param {Partial<LandformBlock>} [block]
 * @returns {LandformBlock} a fresh object; never aliases the input
 */
export function resolveLandform(block) {
    const b = block || {};
    /** @type {any} */
    const out = {};
    for (let i = 0; i < LANDFORM_KEYS.length; i++) {
        const k = LANDFORM_KEYS[i];
        const v = /** @type {any} */ (b)[k];
        out[k] = (typeof v === "number" && isFinite(v))
            ? v : /** @type {any} */ (LANDFORM_COLD)[k];
    }
    return out;
}

/**
 * Is this block Cold's, to the bit?
 *
 * The gate on the byte-identity promise. `===` and not an epsilon: "close
 * enough to Cold" is exactly the answer that would let a re-bake through and
 * move the shot battery.
 *
 * @param {LandformBlock} a
 * @returns {boolean}
 */
export function landformIsDefault(a) {
    for (let i = 0; i < LANDFORM_KEYS.length; i++) {
        const k = LANDFORM_KEYS[i];
        if (/** @type {any} */ (a)[k] !== /** @type {any} */ (LANDFORM_COLD)[k]) {
            return false;
        }
    }
    return true;
}

/**
 * @param {LandformBlock} a
 * @param {LandformBlock} b
 * @returns {boolean} true when every key matches exactly
 */
export function landformEquals(a, b) {
    if (!a || !b) return false;
    for (let i = 0; i < LANDFORM_KEYS.length; i++) {
        const k = LANDFORM_KEYS[i];
        if (/** @type {any} */ (a)[k] !== /** @type {any} */ (b)[k]) return false;
    }
    return true;
}

/**
 * Write a block into the six `vec4` uniform boxes `landformBake.glsl.js`
 * declares. Writes IN PLACE into vectors the pass already owns — a bake is not
 * a frame, but there is no reason for it to allocate either.
 *
 * @param {Record<string, {value: {set: Function}}>} u the pass's uniform map
 * @param {LandformBlock} b
 * @returns {void}
 */
export function packLandform(u, b) {
    u.uLfDune.value.set(b.duneLen, b.duneAmp, b.duneAniso, b.duneRidge);
    u.uLfSwell.value.set(b.swellLen, b.swellAmp, b.swellAniso, b.warp);
    u.uLfDrift.value.set(b.driftLen, b.driftAmp, b.driftAniso, b.driftShear);
    u.uLfBasin.value.set(b.basinCell, b.basinDepth, b.basinRadius, b.basinCull);
    u.uLfRock.value.set(b.rockCell, b.rockCull, b.rockBase, b.rockVar);
    u.uLfRock2.value.set(b.rockRadMin, b.rockRadVar, b.rockWave, b.rockRough);
}
