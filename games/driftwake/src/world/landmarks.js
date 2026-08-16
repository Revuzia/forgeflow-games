/**
 * LANDMARKS — the realm-native monuments that give the field a horizon.
 *
 * Owner 2026-08-16: "no landmark language — we have a monument at spawn that
 * should match the realm, but also various three.js or assets we have of
 * landmarks or objects that fit the realm. Find various things we can put in
 * that would match the game/playable realm — base this off research."
 *
 * =============================================================================
 * THE RESEARCH, AND WHY THIS FILE IS PROCEDURAL RATHER THAN A GLB LOAD
 *
 * `F:/games/forgeflow-games-assets/3d-models` was inventoried this session.
 * Three families exist and all three were REJECTED, each for a different and
 * independent reason:
 *
 *  1. QUATERNIUS (`quaternius-rpg`, `fantasy-props`, `fantasy-props-mega`,
 *     `medieval-village`). License is clean — `quaternius-rpg/License.txt` and
 *     `fantasy-props/License_Standard.txt` both read "CC0 1.0 Universal (CC0
 *     1.0) Public Domain Dedication". But the CONTENT is human-scale interior
 *     and village dressing: the 201-entry `fantasy-props/Exports/glTF` listing
 *     is Anvil / Barrel / Bed_Twin1 / BookGroup / Candle / Chair_1 / Chalice /
 *     Mug / Stool, and `medieval-village` is a modular brick-and-timber
 *     building kit (Balcony_Cross_Corner, DoorFrame_Round_Brick). Nothing in
 *     either pack is landmark-scale and nothing fits an ice shelf, a dune sea
 *     or a volcanic plate. They also ship texture atlases that want a stock
 *     textured material, which ARCHITECTURE §0.1 forbids outright.
 *  2. UNITY ASSET STORE packs. These DO contain landmark-shaped geometry —
 *     `unity/BitGem__Cube World - Proto Series/sandstone_pillar*.glb`,
 *     `unity/Aligned Games__Polygonal Alien Cave Nature Asset Package/cliff_*.glb`,
 *     `unity/BitGem__Dungeon Builder Starter Set/arch.glb`. Every one of them
 *     carries `"license_class": "asset-store"` in `UNITY_MODELS_INDEX.json`
 *     (1409 models, that field is the only license marking in the file). The
 *     Unity Asset Store EULA is a single-entity license and is NOT clean for
 *     redistribution inside a public web build. Rejected on license, before
 *     fiction was even considered.
 *  3. POLY PIZZA (`polypizza/MANIFEST.json`). "CC-BY 3.0" with per-model
 *     attribution, so usable with credit — but the catalogue is props and
 *     creatures (spaceships, computer mice, an armadillo, a handful of trees).
 *     No realm-scale monument, and nothing in the three realms' fiction.
 *
 * So the landmarks are built the way this project's own monuments already are:
 * a data-driven prism lattice in ONE mesh, on the pattern `spells/crystals.js`
 * established and `world/shrine.js` scaled to seven formations. That pattern
 * is what buys realm tinting, cascade shadows and aerial perspective for free,
 * and it is the only route that satisfies the RawShaderMaterial rule.
 *
 * =============================================================================
 * WHAT IS BUILT — three types per realm, nine in all
 *
 * Directions taken from `_spec/_build/REALM_CONTRACT.md` §1b, which is where
 * each realm's material fiction is actually written down.
 *
 *   COLD — "The Rime Shelf"
 *     rimeCircle    a henge of eight ice monoliths round one taller spire
 *     frozenCrest   a curved rank of shards leaning downwind — a breaking wave
 *                   caught mid-curl, the one silhouette this realm owns
 *     glacierGate   two heavy piers with an ice lintel bridged across them
 *   SAND — "The Sundered Gate"
 *     sunkenColonnade  six obelisks in a descending line, an avenue going under
 *     bleachedRibs     two facing arcs of slender ribs, a carcass half-buried
 *     watchSpire       one 44 m obelisk with a collar of fallen shards
 *   ASH — "The Volcanic Plate"
 *     basaltColonnade  eleven near-regular hexagonal columns, flat-topped.
 *                      COLUMNAR BASALT IS LITERALLY A FIELD OF HEXAGONAL
 *                      PRISMS — the primitive this engine already draws is the
 *                      exact geological form, which is why ash gets the
 *                      cleanest fiction fit of the three and why its `wobble`
 *                      is 0.10 where cold's shards run 0.85.
 *     calderaRim       nine shards on a ring, all leaning outward
 *     emberVent        a squat vent mound ringed by short angled spires
 *
 * READ RANGE. `core/camera.js:110` sets `fov = 1.02` rad vertical = 58.4 deg,
 * so at the harness's 720 px viewport one degree is 12.3 px. [derived] a 20 m
 * monolith at 200 m subtends atan(20/200) = 5.71 deg = 70 px, and at 400 m
 * 2.86 deg = 35 px. Every type here stands 17-44 m, so all of them clear the
 * "reads at 200+ m" bar with room, and the tallest still reads past 400 m.
 *
 * =============================================================================
 * PLACEMENT — deterministic, no RNG anywhere
 *
 * A hashed jitter grid, dart-thrown in a per-realm scan order:
 *
 *   - 13 x 13 cells of CELL m over the play area, each cell's candidate point
 *     jittered by a pure integer hash of its (ix, iz, realm) — never
 *     `Math.random` (ARCHITECTURE §6; the same rule `particles.js:304-305`
 *     and `surfWake.js:130-136` follow).
 *   - the candidate is NUDGED to the flattest spot within +/-NUDGE_SPAN by the
 *     same `gradeAt()` scan `shrine.js` uses for its ring, and the nudge runs
 *     BEFORE the spacing tests so a nudge can never walk two landmarks into
 *     each other.
 *   - accepted only if it clears every constraint: inside the [MIN_R, MAX_R]
 *     annulus, >= SHRINE_CLEAR m from all seven `shrine.positions`, and
 *     >= MIN_SPACING m from every landmark already accepted.
 *   - the three realms walk the SAME 169 cells in three different orders — cell
 *     `(k * STRIDE[realm]) % 169`, with each stride coprime to 169 = 13^2 so
 *     the walk is a permutation — which is what puts cold's monuments
 *     somewhere other than ash's rather than merely re-tinting one layout.
 *
 * The build ASSERTS the full instance count and re-asserts every pairwise
 * distance, and THROWS rather than shipping a short or clustered layer.
 *
 * =============================================================================
 * COST
 *
 * ONE mesh, one 330 x 4 RGBA32F data texture, 330 prisms, 9,900 triangles.
 * THREE draw calls total: one beauty and two cascades (`LANDMARK_CASCADES`,
 * the same pair `shrine.js` registers). Only the active realm's prisms have
 * non-zero growth; the other two realms' collapse to a point in the vertex
 * stage and rasterise nothing — the switch-off mechanism `crystals.js:9-11`
 * describes, so a realm swap costs no draw and no reallocation.
 *
 * The cascade stage additionally collapses any prism further than
 * `SHADOW_CULL_M` from the camera. That is exact rather than approximate:
 * `shadows.js:104` splits at [26, 95, 330], so the two registered cascades see
 * nothing past 95 m, and [derived] the longest shadow this layer can throw is a
 * 44 m spire at Cold's 13 deg sun = 44/tan(13) = 191 m. At 260 m nothing that
 * could reach a cascade is ever culled, and the far ~90% of a 1100 m-wide
 * layer skips both shadow passes.
 *
 * Steady-frame allocation: none. A settled, un-swapped layer uploads nothing
 * and writes no uniforms.
 */

import * as THREE from "three";

import { shader } from "../core/glsl.js";
import { REALMS, REALM_ORDER, realmToken } from "./realms.js";
import { gradeAt } from "./shrine.js";

/* ------------------------------------------------------------------ *
 * Layout constants
 * ------------------------------------------------------------------ */

/** Instances built per type. The brief's band is 4-6. */
export const PER_TYPE = 5;

/** Minimum distance between any two landmarks, m. */
const MIN_SPACING = 150;

/** Minimum distance from any shrine in `shrine.positions`, m. */
const SHRINE_CLEAR = 120;

/** The annulus landmarks may stand in, m from world centre. The inner bound
 *  keeps them off the spawn plaza and out at readable range; the outer bound
 *  holds them clear of `PLAY_RADIUS` 620 (`heightfield.js:49`) and of the
 *  storm-wall world edge that lives just inside it. */
const MIN_R = 170;
const MAX_R = 545;

/** Candidate grid: 13 x 13 cells at CELL m, jittered +/-JITTER. */
const CELL = 90;
const GRID_N = 13;
const JITTER = 30;

/** Flat-spot nudge, the `shrine.js` recipe at a landmark's smaller span. */
const NUDGE_SPAN = 24;
const NUDGE_STEP = 8;

/** Per-realm scan strides. Each is coprime to GRID_N^2 = 169 (none is a
 *  multiple of 13), so `(k * stride) % 169` is a permutation of the cells and
 *  every realm walks all 169 candidates in its own order. */
const STRIDE = { cold: 23, sand: 47, ash: 89 };

/** Cascades a 17-44 m monument is worth drawing into — the pair `shrine.js`
 *  registers. `shadows.js:104` splits at [26, 95, 330]; taking cascade 2 as
 *  well would be a fourth draw call and is outside this layer's budget. */
const LANDMARK_CASCADES = 2;

/** Camera distance past which a prism is collapsed in the CASCADE stage only.
 *  See the header — 260 m is beyond the longest shadow this layer can throw
 *  into the 95 m cascade, so nothing that could matter is ever culled. */
const SHADOW_CULL_M = 260;

/** Vertices per prism: three hexagonal rings plus an apex. */
const VERTS = 19;
const RING = 6;

/** Triangles per prism: two ring bands of 12 plus a 6-triangle cap. */
const TRIS_PER = 30;

/** Boot growth, seconds. Slower than the shrine's 1.6 — these are bigger. */
const GROW_S = 2.2;

/** Realm cross-fade, seconds: the outgoing realm sinks and the incoming rises. */
const SWAP_S = 1.1;

/** Frames to wait after a realm swap before re-grounding. The realm heightfield
 *  re-bake runs inside the next `terrain.update()` — same reasoning, and the
 *  same count, as `shrine.js`'s REGROUND_FRAMES. */
const REGROUND_FRAMES = 3;

/** Ring samples taken around a prism's own base when seating it. Twelve, not
 *  six: the seat is a discrete minimum over a continuous ring, and at six
 *  samples the probe's own eight-sample check kept finding ground up to 0.34 m
 *  below the seat — a real, if small, float. */
const SEAT_SAMPLES = 12;

/**
 * Seat height for one prism: the LOWEST ground under its own base ring, less a
 * 2 cm bury.
 *
 * NOT the centre sample. `shrine.js:333` can use the centre because its prisms
 * are 13-34 cm across, but a landmark prism is 0.8-6.6 m in radius and the
 * flat-spot nudge only flattens the ANCHOR — the outlying members of a
 * formation (a 20 m caldera ring, a colonnade spanning 80 m) sit wherever the
 * dune puts them. Seating on the centre leaves the downhill third of the base
 * ring hanging in the air, which `qa_landmarks.py` measured at up to 0.71 m
 * before this function existed.
 *
 * Taking the minimum makes the error one-sided: the uphill side is BURIED,
 * which reads as a monument standing in its own drift, and nothing ever floats.
 *
 * @param {{heightAt:(x:number,z:number)=>number}} terrain
 * @param {number} x @param {number} z base centre
 * @param {number} rad base radius, m
 * @returns {number} world y for the prism's base point
 */
function seatY(terrain, x, z, rad) {
    let lo = terrain.heightAt(x, z);
    for (let k = 0; k < SEAT_SAMPLES; k++) {
        const a = k * (Math.PI * 2 / SEAT_SAMPLES);
        const g = terrain.heightAt(x + Math.cos(a) * rad, z + Math.sin(a) * rad);
        if (g < lo) lo = g;
    }
    return lo - 0.02;
}

/* ------------------------------------------------------------------ *
 * Material rows — per realm, with provenance
 * ------------------------------------------------------------------ */

/**
 * How a realm's monuments are made of. Fields marked "transcribed" are read
 * from `REALMS` at construction so they cannot drift from the realm table;
 * the rest are authored here with the derivation shown, in the same three-tag
 * scheme `realms.js` uses ((no tag) / [derived] / [call]).
 *
 * `rimRow` selects which realm row supplies the interior/rim colour, because
 * the same shader term carries two different fictions: in Cold and Sand it is
 * light entering the far face of a translucent mass and leaving toward the eye
 * (so it is the subsurface hue, `ground.sssDeep`); in Ash it is the crack
 * network still holding heat, so it is the ember hue, `glint.tint`, and it is
 * the one realm that also lights `glow`.
 */
const MATERIAL = {
    cold: {
        /** Glacial ice, NOT rock: cold's monuments are calved off the shelf, so
         *  `ground.rockColA/B` (a near-black grey) would be exactly wrong.
         *
         *  DARK AND BLUE, not white. These shipped at [0.50,0.60,0.74] /
         *  [0.78,0.86,0.96] — which is `ground.albedo` [0.855,0.885,0.945]
         *  almost exactly, i.e. a white monument on a white field under a white
         *  sky. `qa_landmarks.py` measured the result: 877 changed pixels in
         *  the silhouette window at 190 m, against Sand's 3579 and Ash's 8758.
         *  A landmark with no silhouette is not a landmark.
         *
         *  [derived] the physical correction is `crystal.glsl.js`'s own
         *  `ICE_ABSORB = vec3(2.35, 0.60, 0.24)` per metre. Over the ~4 m of
         *  ice a facet of a 20 m mass looks through, exp(-ICE_ABSORB * 4) is
         *  (8e-5, 0.09, 0.38) — red is gone entirely and blue survives four
         *  times better than green. Glacier ice in a snowfield is a DEEP
         *  BLUE-CYAN mass much darker than the snow around it, and that is
         *  what separates it at range. The base stays darker still: it is
         *  packed with the drift it grew through. */
        lo: [0.22, 0.34, 0.46],
        hi: [0.42, 0.58, 0.74],
        /** Which realm row the rim term takes its hue from. */
        rimRow: "sssDeep",
        /** [call] A 20 m ice mass lights along its whole length when backlit —
         *  the effect `crystal.glsl.js:179-187` argues for at 30 cm, and the
         *  reason an ice landmark cannot be shaded as opaque stone. */
        rimAmt: 0.60,
        /** [derived] `ground.wrapAmount[0]` 0.62 x 0.68. Snow wraps millimetres
         *  past the terminator (`shading.glsl.js:173-176`); solid ice wraps
         *  less, but far more than rock. */
        wrap: 0.42,
        /** [call] Bedding planes ARE the glacier read at silhouette range. */
        strata: 0.80,
        /** [derived] x `ground.roughness` 0.62 = 0.30. Ice is smoother than the
         *  snow around it, which is what makes it separate from the field. */
        roughScale: 0.48,
        /** No emissive channel in Cold — `glint.emissive` is 0.0 here. */
        glow: 0.0,
    },
    sand: {
        /** Sandstone — the authored rock band, very nearly as written:
         *  `ground.rockColA` (0.30,0.24,0.17) to just above `rockColB`
         *  (0.42,0.34,0.24), for the sun-scoured face of a standing monument.
         *
         *  These shipped at [0.34,0.27,0.19] / [0.68,0.58,0.42], and that
         *  crown was BRIGHTER than `ground.albedo` (0.620,0.505,0.345) — a
         *  pale monument on pale sand, drifting off the rock rows this comment
         *  claims to derive from. Both the provenance and the silhouette want
         *  the same correction: a butte reads DARKER than the dune it stands
         *  on, at every range. */
        lo: [0.30, 0.24, 0.17],
        hi: [0.46, 0.36, 0.25],
        rimRow: "sssDeep",
        /** [derived] x `ground.sssStrength` 0.18 / cold's 1.0 — sand transmits
         *  a little at an edge and nothing through a metre of it. */
        rimAmt: 0.14,
        /** [derived] `ground.wrapAmount[0]` 0.24 x 0.75. Sand has a hard
         *  terminator (REALM_CONTRACT §1b) and dressed stone harder still. */
        wrap: 0.18,
        /** [call] Sedimentary bedding is the most legible thing about a
         *  sandstone monolith, so this realm reads the bands hardest. */
        strata: 0.95,
        /** [derived] x `ground.roughness` 0.86 = 0.72. */
        roughScale: 0.84,
        glow: 0.0,
    },
    ash: {
        /** Basalt. [derived] `ground.rockColA` (0.030,0.028,0.028) and
         *  `rockColB` (0.094,0.078,0.070) taken very nearly as written — this
         *  is the one realm whose authored rock rows ARE the monument, because
         *  the plate and the columns are the same lava. Lifted by the same +25%
         *  readability cap the ash ground rows carry (owner 2026-08-13), or a
         *  column silhouettes as a black hole in a black field. */
        lo: [0.038, 0.035, 0.035],
        hi: [0.118, 0.098, 0.088],
        rimRow: "glintTint",
        /** [derived] x `ground.sssStrength` 0.10 — basalt transmits nothing.
         *  Ash carries its interior on `glow` instead, which is the realm's own
         *  mechanism: `glint.emissive` 4.2 exists precisely because "an ember in
         *  the shade still glows" (REALM_CONTRACT §1b). */
        rimAmt: 0.06,
        /** [derived] `ground.wrapAmount[0]` 0.34 x 0.55. */
        wrap: 0.19,
        /** [call] Columnar basalt's read is the COLUMN, not the bedding — the
         *  bands are held low so the hexagonal shafts carry the silhouette. */
        strata: 0.35,
        /** [derived] x `ground.roughness` 0.93 = 0.79. */
        roughScale: 0.85,
        /** [call] The crack network still holding heat. Sized against
         *  `glint.emissive` 4.2 and cut by ~8x because this is a continuous
         *  channel over a whole shaft, not a sparse speck field. */
        glow: 0.52,
    },
};

/* ------------------------------------------------------------------ *
 * Formation builders
 * ------------------------------------------------------------------ */

/**
 * One prism, in a formation's own frame.
 * @typedef {{dx:number, dy:number, dz:number, h:number, rad:number,
 *            ax:number, ay:number, az:number, f1:number, f2:number,
 *            t1:number, t2:number, wob:number}} Prism
 *
 * `dx`/`dz` offset from the formation anchor; `dy` lifts a prism's BASE off the
 * ground (only `glacierGate`'s lintel uses it, and the re-ground pass re-applies
 * it so a realm swap cannot drop a lintel into the dirt). `f1`/`f2` are the
 * heights of the two intermediate rings as a fraction of `h`; `t1`/`t2` their
 * radii as a fraction of `rad`; `wob` is how far the hexagon is allowed to
 * break — 0 is a regular hexagon (dressed stone, columnar basalt), 1 is a
 * fully irregular shard.
 */

/** Push helper: appends a prism with the boilerplate spelled once. */
function P(out, dx, dz, h, rad, ax, ay, az, f1, f2, t1, t2, wob, dy) {
    out.push({ dx, dy: dy || 0, dz, h, rad, ax, ay, az, f1, f2, t1, t2, wob });
    return out;
}

/** Deterministic per-instance variation in [0,1). The golden-ratio conjugate
 *  recipe `crystals.js:203-208` uses, keyed on the instance index. */
function vary(i, k) {
    return ((i + 1) * 0.618034 + k * 0.381966) % 1;
}

/**
 * The nine formations. Each returns a fresh prism list for instance `i`; `i`
 * only ever feeds `vary()`, so a rebuild is byte-identical.
 * @type {Record<string, {realm:string, label:string, build:(i:number)=>Prism[]}>}
 */
export const LANDMARK_TYPES = {

    // ------------------------------------------------------------ COLD
    /** A henge: eight monoliths leaning gently outward round one taller spire. */
    rimeCircle: {
        realm: "cold", label: "Rime Circle",
        build(i) {
            const out = [];
            const u = vary(i, 0);
            const R = 12.5 + 2.5 * u;
            // The spire. Near-vertical, a hair of lean so it is not a plumb line.
            P(out, 0, 0, 31 + 6 * u, 2.9, 0.03, 1, -0.02, 0.40, 0.86, 0.80, 0.46, 0.85);
            for (let k = 0; k < 8; k++) {
                const a = k * (Math.PI * 2 / 8) + u * 0.7;
                const v = vary(i, k + 1);
                const lean = 0.10 + 0.07 * v;
                P(out, Math.sin(a) * R, Math.cos(a) * R,
                    17 + 9 * v, 1.6 + 0.8 * v,
                    Math.sin(a) * lean, 1, Math.cos(a) * lean,
                    0.38, 0.84, 0.76, 0.42, 0.88);
            }
            return out;
        },
    },
    /** A breaking wave caught mid-curl: seven shards on an arc, heights ramping
     *  and every one leaning downwind, the tallest leaning hardest. */
    frozenCrest: {
        realm: "cold", label: "Frozen Crest",
        build(i) {
            const out = [];
            const u = vary(i, 0);
            const R = 24 + 6 * u;
            for (let k = 0; k < 7; k++) {
                const t = k / 6;                       // 0..1 along the crest
                const a = (t - 0.5) * 1.9;
                // Heights ramp along the arc so the crest has a shoulder and a
                // lip rather than reading as a fence.
                const ramp = Math.sin(t * Math.PI * 0.82 + 0.22);
                const h = 11 + 21 * ramp;
                const lean = 0.40 + 0.34 * ramp;       // the lip curls hardest
                P(out, Math.sin(a) * R, Math.cos(a) * R,
                    h, 1.3 + 1.7 * ramp,
                    Math.sin(a + 1.05) * lean, 1, Math.cos(a + 1.05) * lean,
                    0.34, 0.80, 0.70, 0.30, 0.95);
            }
            return out;
        },
    },
    /** Two heavy piers with an ice lintel bridged across them. The lintel is the
     *  one prism in the file that starts off the ground: base at `dy`, axis very
     *  nearly horizontal. */
    glacierGate: {
        realm: "cold", label: "Glacier Gate",
        build(i) {
            const out = [];
            const u = vary(i, 0);
            const span = 7.0 + 1.4 * u;
            const pierH = 24 + 4 * u;
            // Piers, tilted TOWARD each other so the gap narrows with height.
            P(out, -span, 0, pierH, 3.3, 0.13, 1, 0.02, 0.44, 0.90, 0.90, 0.70, 0.55);
            P(out, span, 0, pierH, 3.3, -0.13, 1, -0.02, 0.44, 0.90, 0.90, 0.70, 0.55);
            // The lintel: base on the left pier's crown, laid across the gap.
            // `dy` is the base lift and survives the post-swap re-ground.
            P(out, -span + 0.6, 0, 2 * span - 1.2, 2.0,
                1, 0.10, 0, 0.30, 0.88, 0.94, 0.86, 0.35, pierH * 0.90);
            // Two calved blocks at the foot, so the gate sits in its own debris.
            // MINIMUM HEIGHT 8 m, not the 4-5 m this shipped with first. A prism
            // is seated on its footprint minimum (see seatY), so the uphill side
            // is buried by the local relief — and Cold's dunes run 3.5 m of
            // relief across a 2 m base ring, which ate 36% of a 4.2 m block
            // (qa_landmarks.py, measured). A block that short also renders 15 px
            // at 200 m, so raising it costs nothing and buys the silhouette.
            P(out, -span - 4.6, 2.6, 10.5, 2.4, -0.35, 1, 0.18, 0.42, 0.86, 0.82, 0.55, 0.9);
            P(out, span + 4.0, -3.1, 8.5, 2.1, 0.32, 1, -0.20, 0.42, 0.86, 0.82, 0.55, 0.9);
            return out;
        },
    },

    // ------------------------------------------------------------ SAND
    /** An avenue going under: six obelisks in a line, each shorter than the
     *  last, the far end all but swallowed. */
    sunkenColonnade: {
        realm: "sand", label: "Sunken Colonnade",
        build(i) {
            const out = [];
            const u = vary(i, 0);
            const yaw = u * Math.PI;                   // the avenue's bearing
            const step = 16 + 3 * u;
            const sx = Math.sin(yaw), sz = Math.cos(yaw);
            for (let k = 0; k < 6; k++) {
                const v = vary(i, k + 1);
                const h = 30 - k * 4.2;
                const d = (k - 2.5) * step;
                // Each stone has settled its own way — a colonnade whose members
                // are all plumb reads as a render, not a ruin.
                const tiltA = v * Math.PI * 2;
                const lean = 0.03 + 0.09 * v;
                P(out, sx * d, sz * d, h, 1.15 + h * 0.055,
                    Math.sin(tiltA) * lean, 1, Math.cos(tiltA) * lean,
                    0.35, 0.88, 0.80, 0.26, 0.22);
            }
            return out;
        },
    },
    /** A carcass half-buried: two facing arcs of slender ribs, each leaning
     *  hard inward toward a spine that is no longer there. */
    bleachedRibs: {
        realm: "sand", label: "Bleached Ribs",
        build(i) {
            const out = [];
            const u = vary(i, 0);
            const yaw = u * Math.PI;
            const half = 9.5 + 2.0 * u;
            for (let s = 0; s < 2; s++) {
                const side = s === 0 ? 1 : -1;
                for (let k = 0; k < 3; k++) {
                    const v = vary(i, s * 3 + k + 1);
                    const along = (k - 1) * (7.5 + 1.5 * u);
                    const px = Math.sin(yaw) * along + Math.cos(yaw) * half * side;
                    const pz = Math.cos(yaw) * along - Math.sin(yaw) * half * side;
                    // Leaning inward: the axis tips back toward the spine.
                    const lx = -Math.cos(yaw) * side * (0.72 + 0.18 * v);
                    const lz = Math.sin(yaw) * side * (0.72 + 0.18 * v);
                    P(out, px, pz, 15 + 5 * v, 1.0 + 0.35 * v,
                        lx, 1, lz, 0.30, 0.82, 0.72, 0.20, 0.70);
                }
            }
            return out;
        },
    },
    /** One 44 m obelisk with a collar of shards that came off it. The tallest
     *  thing in the world, and deliberately so — sand is the realm you navigate
     *  by a single far mark. */
    watchSpire: {
        realm: "sand", label: "Watch Spire",
        build(i) {
            const out = [];
            const u = vary(i, 0);
            P(out, 0, 0, 40 + 7 * u, 3.3, 0.02, 1, 0.03, 0.32, 0.86, 0.74, 0.22, 0.18);
            for (let k = 0; k < 5; k++) {
                const v = vary(i, k + 1);
                const a = k * (Math.PI * 2 / 5) + u * 1.3;
                const r = 5.0 + 3.4 * v;
                // Floor 9 m for the same seating reason the Glacier Gate's
                // blocks carry — see that comment.
                P(out, Math.sin(a) * r, Math.cos(a) * r,
                    9 + 6 * v, 1.1 + 0.6 * v,
                    Math.sin(a) * 0.52, 1, Math.cos(a) * 0.52,
                    0.36, 0.84, 0.78, 0.34, 0.80);
            }
            return out;
        },
    },

    // ------------------------------------------------------------- ASH
    /** Columnar basalt. Eleven near-regular hexagonal shafts, parallel-sided and
     *  flat-topped, in two concentric rings round a taller centre. `wob` 0.10 is
     *  the point: real columnar jointing IS hexagonal, so this is the one
     *  formation that must NOT be broken up. */
    basaltColonnade: {
        realm: "ash", label: "Basalt Colonnade",
        build(i) {
            const out = [];
            const u = vary(i, 0);
            P(out, 0, 0, 27 + 6 * u, 2.4, 0.02, 1, 0.01, 0.50, 0.95, 0.97, 0.93, 0.10);
            for (let k = 0; k < 4; k++) {
                const v = vary(i, k + 1);
                const a = k * (Math.PI / 2) + u * 0.9;
                P(out, Math.sin(a) * 4.6, Math.cos(a) * 4.6,
                    18 + 8 * v, 2.0 + 0.5 * v,
                    Math.sin(a) * 0.04, 1, Math.cos(a) * 0.04,
                    0.50, 0.95, 0.97, 0.92, 0.12);
            }
            for (let k = 0; k < 6; k++) {
                const v = vary(i, k + 5);
                const a = k * (Math.PI / 3) + u * 1.7 + 0.4;
                P(out, Math.sin(a) * 8.8, Math.cos(a) * 8.8,
                    11 + 10 * v, 1.7 + 0.6 * v,
                    Math.sin(a) * 0.05, 1, Math.cos(a) * 0.05,
                    0.50, 0.94, 0.96, 0.90, 0.14);
            }
            return out;
        },
    },
    /** A blown-out crater rim: nine shards on a ring, every one leaning away
     *  from a centre that is no longer there. */
    calderaRim: {
        realm: "ash", label: "Caldera Rim",
        build(i) {
            const out = [];
            const u = vary(i, 0);
            const R = 20 + 5 * u;
            for (let k = 0; k < 9; k++) {
                const v = vary(i, k + 1);
                const a = k * (Math.PI * 2 / 9) + u * 1.1;
                const lean = 0.46 + 0.22 * v;
                P(out, Math.sin(a) * R, Math.cos(a) * R,
                    8 + 11 * v, 1.7 + 1.5 * v,
                    Math.sin(a) * lean, 1, Math.cos(a) * lean,
                    0.36, 0.82, 0.74, 0.38, 0.90);
            }
            return out;
        },
    },
    /** A vent: one squat slag mound with a ring of short angled spires round its
     *  shoulder. The smallest formation here on purpose — it is the near-field
     *  mark that tells you the plate is still venting. */
    emberVent: {
        realm: "ash", label: "Ember Vent",
        build(i) {
            const out = [];
            const u = vary(i, 0);
            P(out, 0, 0, 7.5 + 1.5 * u, 6.6, 0.02, 1, 0.02, 0.50, 0.90, 0.86, 0.70, 0.45);
            for (let k = 0; k < 6; k++) {
                const v = vary(i, k + 1);
                const a = k * (Math.PI / 3) + u * 2.1;
                const r = 3.2 + 2.6 * v;
                // Floor 8 m — same seating reason as the Glacier Gate's blocks.
                P(out, Math.sin(a) * r, Math.cos(a) * r,
                    8 + 7 * v, 0.8 + 0.6 * v,
                    Math.sin(a) * 0.26, 1, Math.cos(a) * 0.26,
                    0.42, 0.86, 0.78, 0.18, 0.85);
            }
            return out;
        },
    },
};

/** Type keys grouped by realm, in build order. */
export const TYPES_BY_REALM = {
    cold: ["rimeCircle", "frozenCrest", "glacierGate"],
    sand: ["sunkenColonnade", "bleachedRibs", "watchSpire"],
    ash: ["basaltColonnade", "calderaRim", "emberVent"],
};

/* ------------------------------------------------------------------ *
 * Deterministic hash — integer, pure, no RNG
 * ------------------------------------------------------------------ */

/**
 * A 3-input integer hash in [0, 1). Pure 32-bit integer arithmetic, so it is
 * bit-identical on every machine and across reloads — the property the whole
 * placement rests on. NEVER `Math.random` (ARCHITECTURE §6).
 * @param {number} a @param {number} b @param {number} c
 * @returns {number} in [0, 1)
 */
function hash3(a, b, c) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)
        + Math.imul(c | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ *
 * Shader stages — owned here, because this file owns the material fiction
 * ------------------------------------------------------------------ */

/**
 * The shared shape function. Four texture rows per prism:
 *
 *   row 0   (x, y, z, height m at full growth)
 *   row 1   (axisX, axisY, axisZ, base radius m at full growth)
 *   row 2   (growth 0..1, seed, taper1, taper2)
 *   row 3   (ring1 height fraction, ring2 height fraction, wobble, spare)
 *
 * Compiled into the beauty stage AND both cascade stages, for the reason
 * ARCHITECTURE §5 gives: a monument whose shadow is a different shape from the
 * monument is worse than no shadow at all.
 *
 * COLLAPSE AT ZERO GROWTH. Radius is gated by `smoothstep(0.0, 0.08, g)` as
 * well as height, so at `g = 0` every one of the nineteen vertices lands on the
 * single base point and all thirty triangles are degenerate. `crystals.js`
 * could leave a 22% radius floor because its prisms are 9 cm; a 3 m landmark
 * radius would leave a visible hexagonal plate lying on the ground for every
 * out-of-realm formation, which is exactly the bug this gate prevents.
 */
const SHAPE = /* glsl */`
#include "lib/common"
#include "lib/noise"

const int LM_RING  = 6;
const int LM_VERTS = 19;

vec3 landmarkPoint(sampler2D tex, int i, int v) {
    vec4 a = texelFetch(tex, ivec2(i, 0), 0);   // (pos, height)
    vec4 b = texelFetch(tex, ivec2(i, 1), 0);   // (axis, radius)
    vec4 c = texelFetch(tex, ivec2(i, 2), 0);   // (growth, seed, taper1, taper2)
    vec4 d = texelFetch(tex, ivec2(i, 3), 0);   // (f1, f2, wobble, -)

    float g  = clamp(c.x, 0.0, 1.0);
    // HEIGHT LEADS, GIRTH FOLLOWS — the growth character crystals.js:78-82
    // establishes, with the extra zero-gate the header explains.
    float gh = g * g * (3.0 - 2.0 * g);
    float gz = smoothstep(0.0, 0.08, g);
    float height = a.w * gh;
    float radius = b.w * gz * (0.30 + 0.70 * smoothstep(0.20, 1.0, g));

    vec3 local;
    if (v >= LM_VERTS - 1) {
        // The crown, nudged off the axis so no monument is a plumb cone.
        vec2 j = hash22(vec2(c.y, 3.77)) - 0.5;
        local = vec3(j.x * radius * c.w * 0.7, height, j.y * radius * c.w * 0.7);
    } else {
        int ring = v / LM_RING;                 // 0 base, 1 shoulder, 2 crown ring
        int k = v - ring * LM_RING;
        float ang = float(k) * 1.04719755 + c.y * 6.2831853;
        // Per-direction length multiplier, faded by the wobble row: at 0 the
        // is regular (dressed stone, columnar basalt), at 1 it is a shard.
        float br  = 0.70 + 0.60 * hash21(vec2(float(k) + c.y * 31.0, c.y * 17.0));
        float wob = mix(1.0, br, d.z);
        // The section twists a little up the shaft, so the vertical facet seams
        // are not perfectly straight lines. Seeded, so it never animates.
        float tw = float(ring) * 0.13 * (hash21(vec2(c.y * 7.0, 2.1)) - 0.5);
        float rm = (ring == 0) ? 1.0 : ((ring == 1) ? c.z : c.w);
        float yf = (ring == 0) ? 0.0 : ((ring == 1) ? d.x : d.y);
        float r  = radius * rm * wob;
        local = vec3(cos(ang + tw) * r, height * yf, sin(ang + tw) * r);
    }

    vec3 axis = normalize((dot(b.xyz, b.xyz) < 1e-6) ? vec3(0.0, 1.0, 0.0) : b.xyz);
    vec3 ref2 = (abs(axis.y) < 0.9) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
    vec3 ex = normalize(cross(ref2, axis));
    vec3 ez = cross(axis, ex);
    return a.xyz + ex * local.x + axis * local.y + ez * local.z;
}
`;

/** Beauty vertex stage. No normal is emitted — the fragment takes it from the
 *  derivatives of the world position, which gives exact flat facets, and a
 *  facet is what a fractured rock or ice face is. Same argument, verbatim, as
 *  `crystal.glsl.js:22-27`. */
const LM_VERTEX = SHAPE + /* glsl */`
in vec3 position;               // (prism, vertex, unused)

uniform sampler2D lmTex;

out vec4 vWorldH;               // xyz world, w fraction up the shaft
out float vSeed;

void main() {
    int i = int(position.x);
    int v = int(position.y);
    vec4 a = texelFetch(lmTex, ivec2(i, 0), 0);
    vec3 Pw = landmarkPoint(lmTex, i, v);
    // Measured against the FULL height, not the grown one, so a rising monument
    // keeps its buried base dark all the way up rather than sliding its bands.
    vWorldH = vec4(Pw, clamp((Pw.y - a.y) / max(a.w, 1e-3), 0.0, 1.0));
    vSeed = texelFetch(lmTex, ivec2(i, 2), 0).y;
    gl_Position = uViewProj * vec4(Pw, 1.0);
}
`;

/**
 * Beauty fragment stage — an OPAQUE mineral surface, which is the whole reason
 * this lane does not simply re-skin `crystal.glsl.js`.
 *
 * The crystal fragment is ice by construction: three-channel refraction through
 * the sky LUT, `ICE_ABSORB` at (2.35, 0.60, 0.24), a blue `deepTint` and an
 * uncapped Fresnel that goes to a full mirror at grazing. Tinting that for Sand
 * and Ash would produce tinted ice obelisks — precisely the "Cold with a colour
 * grade" failure `REALM_CONTRACT.md:59` names as the thing a realm must not be.
 * So the shape is shared with the crystal family and the SHADING is not.
 *
 * The bands are driven by WORLD height rather than local height, which is what
 * makes eleven basalt columns read as one jointed mass instead of eleven
 * unrelated props: adjacent prisms of a formation share their strata.
 */
const LM_FRAGMENT = /* glsl */`
#include "lib/common"
#include "lib/noise"
#include "lib/shading"
#include "lib/spellLights"
#include "lib/atmosphere"
#include "lib/shadowLookup"

in vec4 vWorldH;
in float vSeed;

uniform vec3  uLmLo;        // albedo at the buried base
uniform vec3  uLmHi;        // albedo at the weathered crown
uniform vec3  uLmCrack;     // crevice tint, multiplied in
uniform vec3  uLmRim;       // interior / ember hue
uniform float uLmRimAmt;
uniform float uLmRough;
uniform float uLmF0;
uniform float uLmWrap;
uniform float uLmStrata;
uniform float uLmGlow;

layout(location = 0) out vec4 outColor;

void main() {
    vec3 world = vWorldH.xyz;
    float up = vWorldH.w;

    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;                       // toward the sun

    // Flat facet normal from the geometry itself. HANDEDNESS: the same
    // dFdx/dFdy cross as crystal.glsl.js:120-126, forced toward the eye on the
    // next line, which is what makes the WebGL/WebGPU Y-flip self-correcting.
    vec3 dx = dFdx(world);
    vec3 dy = dFdy(world);
    vec3 N = normalize(cross(dx, dy));
    if (dot(N, V) < 0.0) { N = -N; }
    vec3 geoN = N;

    float NdotV = clamp(dot(N, V), 1e-4, 1.0);
    float NdotL = dot(N, L);
    float viewDist = distance(world, uCameraPos);
    float shadow = sunShadow(world, geoN, viewDist, ign(gl_FragCoord.xy) * TAU);
    vec3 sun = uSunColor;

    // ---- strata --------------------------------------------------------------
    // Bedding planes, on WORLD y so a formation shares them across its prisms.
    float band = noise2(vec2(world.y * 0.55, vSeed * 12.0)) * 0.5 + 0.5;
    band = mix(0.5, band, uLmStrata);

    // ---- crevices ------------------------------------------------------------
    // The channels between facets and along the joints. Weighted toward the
    // base, where a real mass is most weathered and most packed with the ground
    // it stands in.
    float seam = noise2(world.xz * 0.85 + world.y * 0.11 + vSeed * 27.0) * 0.5 + 0.5;
    float crack = smoothstep(0.60, 0.28, seam) * (0.55 + 0.45 * (1.0 - up));

    float weather = smoothstep(0.04, 0.80, up);
    vec3 albedo = mix(uLmLo, uLmHi, clamp(weather * 0.72 + band * 0.38, 0.0, 1.0));
    albedo *= mix(vec3(1.0), uLmCrack, crack * 0.80);

    // ---- direct + ambient ----------------------------------------------------
    vec3 color = albedo * INV_PI * sun * wrapDiffuse(NdotL, uLmWrap) * shadow;
    color += albedo * INV_PI * skyIrradiance(N);

    // ---- specular ------------------------------------------------------------
    float rough = clamp(uLmRough * (0.86 + 0.28 * band), 0.04, 1.0);
    if (NdotL > 0.0) {
        vec3 H = normalize(V + L);
        float D = distributionGGX(clamp(dot(N, H), 0.0, 1.0), rough);
        float Vis = visSmithGGXCorrelated(NdotV, NdotL, rough);
        vec3 Fs = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), vec3(uLmF0));
        color += sun * D * Vis * Fs * NdotL * shadow;
    }
    // Sky reflection, roughness-mipped. Small, and it is what stops a monolith
    // reading as a matte card cut out of the horizon.
    vec3 Fr = fresnelSchlickRough(NdotV, vec3(uLmF0), rough);
    color = mix(color, skySpecular(reflect(-V, N), rough), Fr * 0.6);

    // ---- interior ------------------------------------------------------------
    // ONE term, two fictions (see MATERIAL.rimRow): in Cold and Sand it is light
    // entering the far face and leaving toward the eye; in Ash the same hue
    // arrives through uLmGlow instead, out of the crack network, with no sun
    // and no shadow in it — an ember in the shade still glows.
    if (uLmRimAmt > 0.001) {
        float through = backScatter(N, L, V, 0.34, 2.0, 1.0);
        color += sun * INV_PI * uLmRim * through * uLmRimAmt * mix(0.30, 1.0, shadow);
    }
    if (uLmGlow > 0.001) {
        color += uLmRim * uLmGlow * crack;
    }

    if (spellLightCount > 0.5) {
        color += spellLightingSurface(world, N, V, albedo, vec3(uLmF0), rough, 0.35);
    }

    color = aerial(color, world);
    outColor = vec4(color, 1.0);
}
`;

/** Cascade-depth vertex stage. Identical `landmarkPoint`, growth included, plus
 *  the camera-distance collapse the header justifies. */
const LM_DEPTH_VERTEX = SHAPE + /* glsl */`
in vec3 position;

uniform sampler2D lmTex;
uniform mat4 lightViewProjection;
uniform float uLmShadowCull;

void main() {
    int i = int(position.x);
    int v = int(position.y);
    vec4 a = texelFetch(lmTex, ivec2(i, 0), 0);
    // Past the cull radius nothing this prism casts can reach a registered
    // cascade, so collapse it to its base point and skip the raster entirely.
    if (distance(a.xyz, uCameraPos) > uLmShadowCull) {
        gl_Position = lightViewProjection * vec4(a.xyz, 1.0);
        return;
    }
    gl_Position = lightViewProjection * vec4(landmarkPoint(lmTex, i, v), 1.0);
}
`;

/* ------------------------------------------------------------------ *
 * The layer
 * ------------------------------------------------------------------ */

export class Landmarks {
    /**
     * Construct AFTER the spell system (the crystal material must exist, because
     * its merged uniform block is the shared sun / sky / shadow / spell-light
     * box this material binds by reference) and AFTER the shrine network, whose
     * `positions` are the exclusion anchors.
     *
     * @param {import("../terrain/terrain.js").Terrain} terrain ground heights
     * @param {import("../spells/crystals.js").CrystalField} crystals supplies
     *   scene, shadow system and the live shared uniform block
     * @param {import("./shrine.js").SpawnShrine} shrine its `positions` are the
     *   clearance anchors — a monument may not crowd a respawn point
     */
    constructor(terrain, crystals, shrine) {
        this.terrain = terrain;

        /** Current realm token, for probes. */
        this.realm = "cold";

        /** Every instance, in build order, grouped implicitly by realm. Read-only
         *  for consumers (the probe, and any lane that needs a spawn exclusion).
         *  @type {{type:string, realm:string, label:string, x:number, z:number,
         *          y:number, prism0:number, prisms:number}[]} */
        this.instances = [];

        // ------------------------------------------------- layout, per realm
        const shrines = shrine && shrine.positions ? shrine.positions : [];
        /** @type {Prism[]} flattened, index-aligned with the data texture */
        const prisms = [];
        for (let r = 0; r < REALM_ORDER.length; r++) {
            this._layoutRealm(REALM_ORDER[r], r, terrain, shrines, prisms);
        }

        this.prismCount = prisms.length;
        if (this.prismCount === 0) throw new Error("landmarks.js: built nothing");

        // ---------------------------------------------------- data texture
        // Four rows; see SHAPE's header for the packing.
        const N = this.prismCount;
        this._texData = new Float32Array(N * 4 * 4);
        this.dataTex = new THREE.DataTexture(
            this._texData, N, 4, THREE.RGBAFormat, THREE.FloatType
        );
        this.dataTex.internalFormat = "RGBA32F";
        this.dataTex.minFilter = THREE.NearestFilter;
        this.dataTex.magFilter = THREE.NearestFilter;
        this.dataTex.wrapS = THREE.ClampToEdgeWrapping;
        this.dataTex.wrapT = THREE.ClampToEdgeWrapping;
        this.dataTex.generateMipmaps = false;
        this.dataTex.flipY = false;
        this.dataTex.needsUpdate = true;
        this._lmTex = { value: this.dataTex };

        /** Which realm each prism belongs to, 0..2 — the growth gate. */
        this._prismRealm = new Uint8Array(N);
        /** Base lift above the sampled ground, m. Re-applied on every re-ground
         *  so the Glacier Gate's lintel cannot fall to the floor on a swap. */
        this._baseOff = new Float32Array(N);
        /** Per-prism growth stagger, so a formation rises rather than pops. */
        this._stag = new Float32Array(N);
        /** Live growth 0..1 per prism — the value uploaded into row 2. */
        this._grow = new Float32Array(N);
        /** Growth target per prism: 1 for the active realm, 0 otherwise. */
        this._target = new Float32Array(N);

        this._writePrisms(prisms);

        // ---------------------------------------------------------- growth
        /** Boot/swap clock. `_settled` is the allocation-free steady state. */
        this._t = 0;
        this._rate = 1 / GROW_S;
        this._settled = false;
        this._regroundIn = 0;

        // -------------------------------------------------------- material
        // Built OVER the spell ice's merged uniform block — sun, sky LUT, SH,
        // fog, cascades and spell lights are the same live boxes every other
        // material writes, shared BY REFERENCE, so this layer costs no extra
        // per-frame uniform bookkeeping.
        const base = crystals.material.uniforms;
        this._u = {
            uLmLo: { value: new THREE.Vector3() },
            uLmHi: { value: new THREE.Vector3() },
            uLmCrack: { value: new THREE.Vector3(1, 1, 1) },
            uLmRim: { value: new THREE.Vector3(1, 1, 1) },
            uLmRimAmt: { value: 0 },
            uLmRough: { value: 0.4 },
            uLmF0: { value: 0.03 },
            uLmWrap: { value: 0.3 },
            uLmStrata: { value: 0.8 },
            uLmGlow: { value: 0 },
        };
        this._uShadowCull = { value: SHADOW_CULL_M };

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(LM_VERTEX),
            fragmentShader: shader(LM_FRAGMENT),
            uniforms: Object.assign({}, base, this._u, { lmTex: this._lmTex }),
            // OPAQUE, unlike the crystal family: these are rock and metres-thick
            // ice, and a landmark that blends is a landmark you can see the
            // horizon through.
            side: THREE.FrontSide,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });

        this.mesh = new THREE.Mesh(buildLattice(N), this.material);
        this.mesh.name = "landmarks";
        // Every vertex is placed in the vertex shader from the data texture, so
        // Three has no meaningful bounds to cull against — the same reason
        // `crystals.js:122` and `shrine.js:223` switch it off.
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 0;      // opaque, ahead of the blended ice
        crystals.scene.add(this.mesh);

        // --------------------------------------------------- shadow casters
        /** @type {THREE.RawShaderMaterial[]} */
        this._depthMats = [];
        crystals.shadows.registerCaster(this.mesh, (c) => {
            const m = crystals.shadows.makeCasterMaterial(
                LM_DEPTH_VERTEX,
                {
                    lmTex: this._lmTex,
                    uLmShadowCull: this._uShadowCull,
                    // Shared BY REFERENCE with the globals block, so the cull
                    // test reads this frame's camera without any plumbing.
                    uCameraPos: base.uCameraPos,
                },
                { defines: { LANDMARK_CASCADE: c } }
            );
            this._depthMats.push(m);
            return m;
        }, LANDMARK_CASCADES);

        this.setRealm("cold");
    }

    /**
     * Lay out and build one realm's landmarks. Pure function of the heightfield
     * and the shrine positions — rebuilds identical.
     *
     * @param {string} token realm
     * @param {number} ri realm index, the hash salt and the scan-stride key
     * @param {import("../terrain/terrain.js").Terrain} terrain
     * @param {{x:number,z:number}[]} shrines exclusion anchors
     * @param {Prism[]} out flattened prism list, appended in place
     * @returns {void}
     */
    _layoutRealm(token, ri, terrain, shrines, out) {
        const keys = TYPES_BY_REALM[token];
        const want = keys.length * PER_TYPE;
        const stride = STRIDE[token];
        const cells = GRID_N * GRID_N;
        const half = (GRID_N - 1) / 2;

        /** @type {{x:number,z:number}[]} accepted anchors, this realm only */
        const spots = [];

        for (let k = 0; k < cells && spots.length < want; k++) {
            const cell = (k * stride) % cells;
            const ix = cell % GRID_N;
            const iz = (cell / GRID_N) | 0;

            // Candidate = cell centre + hashed jitter. Salted by the realm index
            // so the three realms do not stand on each other's marks.
            const cx = (ix - half) * CELL
                + (hash3(ix, iz, ri * 71 + 13) * 2 - 1) * JITTER;
            const cz = (iz - half) * CELL
                + (hash3(ix, iz, ri * 71 + 29) * 2 - 1) * JITTER;

            // Nudge to the flattest spot FIRST, so a nudge can never walk two
            // accepted landmarks inside the spacing floor.
            let bx = cx, bz = cz, bg = Infinity;
            for (let dz = -NUDGE_SPAN; dz <= NUDGE_SPAN; dz += NUDGE_STEP) {
                for (let dx = -NUDGE_SPAN; dx <= NUDGE_SPAN; dx += NUDGE_STEP) {
                    const g = gradeAt(terrain, cx + dx, cz + dz);
                    if (g < bg) { bg = g; bx = cx + dx; bz = cz + dz; }
                }
            }

            const r = Math.hypot(bx, bz);
            if (r < MIN_R || r > MAX_R) continue;

            let ok = true;
            for (let s = 0; s < shrines.length && ok; s++) {
                if (Math.hypot(bx - shrines[s].x, bz - shrines[s].z) < SHRINE_CLEAR) {
                    ok = false;
                }
            }
            for (let s = 0; s < spots.length && ok; s++) {
                if (Math.hypot(bx - spots[s].x, bz - spots[s].z) < MIN_SPACING) {
                    ok = false;
                }
            }
            if (ok) spots.push({ x: bx, z: bz });
        }

        // Loud, not silent. A short layer means the constraints and the play
        // area no longer fit each other, and shipping nine landmarks where
        // fifteen were asked for is the kind of thing nobody notices for weeks.
        if (spots.length < want) {
            throw new Error("landmarks.js: " + token + " placed only "
                + spots.length + " of " + want + " landmarks — the grid, the "
                + "annulus [" + MIN_R + "," + MAX_R + "] and the "
                + MIN_SPACING + " m / " + SHRINE_CLEAR + " m floors no longer fit");
        }

        // Types round-robin over the accepted spots. The scan order is a stride
        // walk rather than row-major, so consecutive spots are far apart and the
        // three types interleave across the whole field instead of banding.
        for (let n = 0; n < want; n++) {
            const key = keys[n % keys.length];
            const inst = (n / keys.length) | 0;
            const spec = LANDMARK_TYPES[key];
            const local = spec.build(inst);
            const prism0 = out.length;
            const ax = spots[n].x, az = spots[n].z;
            const ay = terrain.heightAt(ax, az);

            for (let p = 0; p < local.length; p++) {
                const q = local[p];
                out.push({
                    dx: ax + q.dx, dz: az + q.dz, dy: q.dy,
                    h: q.h, rad: q.rad,
                    ax: q.ax, ay: q.ay, az: q.az,
                    f1: q.f1, f2: q.f2, t1: q.t1, t2: q.t2, wob: q.wob,
                    realm: ri,
                });
            }
            this.instances.push({
                type: key, realm: token, label: spec.label,
                x: ax, z: az, y: ay, prism0, prisms: local.length,
            });
        }
    }

    /**
     * Write the flattened prism list into the data texture and the CPU-side
     * companion arrays. Called once, at construction.
     * @param {any[]} prisms
     * @returns {void}
     */
    _writePrisms(prisms) {
        const d = this._texData;
        const w = this.prismCount * 4;
        const terrain = this.terrain;

        for (let p = 0; p < prisms.length; p++) {
            const q = prisms[p];
            const il = 1 / Math.hypot(q.ax, q.ay, q.az);
            // Seated on the LOWEST ground under its own base ring — see seatY.
            const py = seatY(terrain, q.dx, q.dz, q.rad) + q.dy;

            let o = p * 4;
            d[o] = q.dx; d[o + 1] = py; d[o + 2] = q.dz; d[o + 3] = q.h;
            o += w;
            d[o] = q.ax * il; d[o + 1] = q.ay * il; d[o + 2] = q.az * il;
            d[o + 3] = q.rad;
            o += w;
            // Growth starts at 0 for everything; setRealm picks the targets.
            d[o] = 0;
            d[o + 1] = (p * 0.618034 + q.dx * 0.137 + q.dz * 0.311) % 1;
            d[o + 2] = q.t1;
            d[o + 3] = q.t2;
            o += w;
            d[o] = q.f1; d[o + 1] = q.f2; d[o + 2] = q.wob; d[o + 3] = 0;

            this._prismRealm[p] = q.realm;
            this._baseOff[p] = q.dy;
            // Stagger by position within the formation: the centre rises first.
            this._stag[p] = Math.min(0.55, 0.04 * (p % 12));
        }
    }

    /**
     * Swap the realm: re-point the material rows, retarget every prism's growth
     * and schedule the re-ground. Called from `enterRealm`.
     *
     * @param {string} token "cold" | "sand" | "ash"
     * @returns {void}
     */
    setRealm(token) {
        const t = realmToken(token);
        const R = REALMS[t];
        const M = MATERIAL[t];
        const ri = REALM_ORDER.indexOf(t);

        const u = this._u;
        u.uLmLo.value.set(M.lo[0], M.lo[1], M.lo[2]);
        u.uLmHi.value.set(M.hi[0], M.hi[1], M.hi[2]);
        // Transcribed from the realm table, so they cannot drift from the ground
        // the monument stands on.
        const cav = R.ground.caveTint;
        u.uLmCrack.value.set(cav[0], cav[1], cav[2]);
        const rim = M.rimRow === "glintTint" ? R.glint.tint : R.ground.sssDeep;
        u.uLmRim.value.set(rim[0], rim[1], rim[2]);
        u.uLmRimAmt.value = M.rimAmt;
        u.uLmRough.value = R.ground.roughness * M.roughScale;
        u.uLmF0.value = R.ground.f0;
        u.uLmWrap.value = M.wrap;
        u.uLmStrata.value = M.strata;
        u.uLmGlow.value = M.glow;

        for (let p = 0; p < this.prismCount; p++) {
            this._target[p] = this._prismRealm[p] === ri ? 1 : 0;
        }
        this.realm = t;
        this._rate = this._settled ? 1 / SWAP_S : 1 / GROW_S;
        this._settled = false;
        this._regroundIn = REGROUND_FRAMES;
    }

    /**
     * Re-sample every prism base against the CURRENT heightfield and upload
     * once — the post-swap re-seat. Event-scoped, never a steady-frame cost.
     * The stored `_baseOff` is re-applied, so a lintel stays a lintel.
     * @returns {void}
     */
    _reground() {
        const d = this._texData;
        const terrain = this.terrain;
        const w = this.prismCount * 4;
        for (let p = 0; p < this.prismCount; p++) {
            const o = p * 4;
            // The same seat the build used, against the NEW heightfield: the
            // radius lives in row 1's w channel.
            d[o + 1] = seatY(terrain, d[o], d[o + 2], d[w + o + 3])
                + this._baseOff[p];
        }
        for (let i = 0; i < this.instances.length; i++) {
            const s = this.instances[i];
            s.y = terrain.heightAt(s.x, s.z);
        }
        this.dataTex.needsUpdate = true;
    }

    /**
     * Growth toward the per-prism targets plus the post-swap re-ground.
     * A settled, un-swapped layer is a strict no-op: no uploads, no uniform
     * writes, no allocation.
     * @param {number} dt seconds
     * @returns {void}
     */
    update(dt) {
        // Counted in FRAMES, not seconds — the re-bake this waits out runs
        // inside terrain.update() whether or not time is frozen. Same reasoning
        // as shrine.js:406-408.
        if (this._regroundIn > 0 && --this._regroundIn === 0) this._reground();

        if (this._settled || dt === 0) return;

        this._t += dt;
        const d = this._texData;
        const growRow = this.prismCount * 4 * 2;
        let moving = false;

        for (let p = 0; p < this.prismCount; p++) {
            const tgt = this._target[p];
            let g = this._grow[p];
            if (g === tgt) continue;
            // Rising is staggered so a formation grows from its centre out;
            // sinking is uniform and quicker — a monument that dissolves member
            // by member draws the eye to the swap.
            const step = dt * this._rate * (tgt > g ? (1 - this._stag[p]) : 1.6);
            g = tgt > g ? Math.min(tgt, g + step) : Math.max(tgt, g - step);
            this._grow[p] = g;
            d[growRow + p * 4] = g;
            moving = true;
        }

        if (moving) this.dataTex.needsUpdate = true;
        else this._settled = true;
    }

    /** Triangles the layer draws — the ACTIVE realm's only; the other two
     *  realms' prisms are degenerate and rasterise nothing. */
    get triangles() {
        let n = 0;
        const ri = REALM_ORDER.indexOf(this.realm);
        for (let p = 0; p < this.prismCount; p++) {
            if (this._prismRealm[p] === ri) n += TRIS_PER;
        }
        return n;
    }

    /**
     * Probe surface. Allocates — a debug entry point, never called from a frame.
     * @returns {object}
     */
    get stats() {
        const live = this.instances.filter((s) => s.realm === this.realm);
        return {
            realm: this.realm,
            draws: 1 + LANDMARK_CASCADES,
            prisms: this.prismCount,
            settled: this._settled,
            types: TYPES_BY_REALM[this.realm].slice(),
            perType: PER_TYPE,
            liveInstances: live.length,
            minSpacing: MIN_SPACING,
            shrineClear: SHRINE_CLEAR,
            instances: live.map((s) => ({
                type: s.type, label: s.label,
                x: +s.x.toFixed(2), z: +s.z.toFixed(2), y: +s.y.toFixed(2),
                prisms: s.prisms,
            })),
        };
    }

    /** Tear down: mesh, geometry, materials, texture. */
    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
        for (let i = 0; i < this._depthMats.length; i++) this._depthMats[i].dispose();
        this.dataTex.dispose();
    }
}

/**
 * Static lattice for `n` prisms: `position` is (prismIndex, vertexIndex, 0),
 * the encoding `crystals.js:329-356` established.
 *
 * Nineteen vertices — three hexagonal rings and a crown — and thirty triangles:
 * two 12-triangle ring bands plus a 6-triangle cap. One draw for the whole
 * layer, all three realms included.
 *
 * @param {number} n prism count
 * @returns {THREE.BufferGeometry}
 */
function buildLattice(n) {
    const pos = new Float32Array(n * VERTS * 3);
    const idx = new Uint32Array(n * TRIS_PER * 3);

    let vi = 0;
    let ii = 0;
    for (let i = 0; i < n; i++) {
        for (let v = 0; v < VERTS; v++) {
            pos[vi++] = i;
            pos[vi++] = v;
            pos[vi++] = 0;
        }
        const b = i * VERTS;
        const apex = b + RING * 3;
        for (let k = 0; k < RING; k++) {
            const k2 = (k + 1) % RING;
            // Band 0: base ring -> shoulder ring.
            idx[ii++] = b + k; idx[ii++] = b + RING + k; idx[ii++] = b + RING + k2;
            idx[ii++] = b + k; idx[ii++] = b + RING + k2; idx[ii++] = b + k2;
            // Band 1: shoulder ring -> crown ring.
            idx[ii++] = b + RING + k;
            idx[ii++] = b + RING * 2 + k;
            idx[ii++] = b + RING * 2 + k2;
            idx[ii++] = b + RING + k;
            idx[ii++] = b + RING * 2 + k2;
            idx[ii++] = b + RING + k2;
            // Cap: crown ring -> apex.
            idx[ii++] = b + RING * 2 + k; idx[ii++] = apex;
            idx[ii++] = b + RING * 2 + k2;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}
