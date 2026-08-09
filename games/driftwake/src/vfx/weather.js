/**
 * Weather — one pooled, analytically-placed, GPU-billboarded sheet covering all
 * three realms. [WEATHER]
 *
 * Cold  blizzard / snowfall
 * Sand  sandstorm + dust devils
 * Ash   ember-fall + smoke drift (two opposite populations, one draw)
 *
 * =============================================================================
 * WHAT IT COSTS. One draw call. `weatherParticles * 2` triangles — 6,144 at the
 * `ultra` default of 3072, which is 0.34% of the 1,799,120-triangle Cold
 * baseline. Per frame: about a dozen uniform writes and ZERO bytes uploaded.
 * There is no per-particle CPU loop anywhere in this file and no data texture at
 * all, because there is no per-particle state to hold.
 *
 * =============================================================================
 * WHY IT IS NOT PART OF THE SPRAY POOL, in numbers read out of
 * `vfx/particles.js`:
 *
 *  - `CAPACITY = 5120` is "a hard cap, not a target" (particles.js:98, 36-38),
 *    and the surf plume alone targets ~3500 live at 19.5 m/s (particles.js:92-96).
 *    3500 + 3072 = 6572 against 5120 means 1452 emissions dropped per frame —
 *    and since emission at a full pool is silently DROPPED rather than queued
 *    (particles.js:41-42) and the plume emits FIRST in the frame
 *    (main.js: wake.update -> spray.update), it is the plume that thins at top
 *    speed while the weather stays fat. Precisely backwards.
 *  - `update()` walks all 5120 slots every frame (particles.js:372) and
 *    re-uploads a 160 KiB data texture unconditionally (particles.js:430);
 *    8192 slots would make that 256 KiB/frame.
 *  - Every live grain calls `terrain.heightAt()` (particles.js:406), a 16-tap
 *    bicubic (heightfield.js:289-298). 3072 more is ~49,000 taps a frame for a
 *    grounding test weather does not want — a flake that reaches the ground must
 *    wrap back to the top of the box, not settle and hold a slot.
 *  - The lifecycle is simply the wrong shape. Spray is age/life with a one-shot
 *    fade. Weather is STATIONARY IN DISTRIBUTION: it never dies, it wraps.
 *
 * The five rules that keep the two systems out of each other's way, each with
 * the line it protects:
 *
 *  1. Weather never calls `spray.emit()`. Zero shared slots.
 *  2. `renderOrder = 3` against spray's `2` (particles.js:260), so the weather
 *     sheet composites OVER the plume — correct, the plume is inside the storm.
 *  3. Not a prepass caster. The wake registers (surfWake.js:389) because it is
 *     an opaque wall; a translucent sheet in the prepass would make TAA
 *     reproject the ground behind every flake.
 *  4. Not a shadow caster. 3072 quads into two cascades is +2 draws for a shadow
 *     nobody can resolve, and it would breach the +1 draw cap on its own.
 *  5. Never calls `terrain.heightAt()`. `depthTest: true` makes the opaque depth
 *     buffer cull the particles that wrap below the ground, for free.
 *
 * =============================================================================
 * REALM DATA. `REALM_WEATHER` below is a plain table transcribed from
 * `_spec/_build/REALM_CONTRACT.md` §1e and §1f. It is deliberately NOT imported
 * from `world/realms.js`: the realm module owns the world's parameters and this
 * module owns their weather MEANING, and coupling the two would make the weather
 * system unusable from a probe, a test page or a realm that does not exist yet.
 * `setRealm(name)` picks a row out of the built-in table; `apply(block)` takes
 * any plain object with the same keys, so the realm module can override every
 * value without this file importing it.
 *
 * ALLOCATION: none after construction. Every vector is a retained scratch or a
 * uniform box; nothing in `update()` constructs anything.
 */

import * as THREE from "three";
import { S, onChange } from "../core/settings.js";
import { bearingRad } from "../core/bearing.js";
import { shader } from "../core/glsl.js";
import { WEATHER_VERTEX, weatherFragment } from "../shaders/weather.glsl.js";

// ---------------------------------------------------------------- constants

/**
 * Geometry is allocated once at this size and the preset moves
 * `setDrawRange()`. Reallocating a 4096-quad lattice on a preset click would
 * cost a buffer upload mid-frame for a value that changes a draw range.
 */
const WEATHER_MAX = 4096;

/** Velocity-stretch gain, and the speed at which it reaches 1 + gain. */
const STRETCH_BASE = 0.9;
const STRETCH_VREF = 8.0;

/** Metres. A flake nearer than this is a smear on the lens, not weather. */
const NEAR_FADE_LO = 2.5;
const NEAR_FADE_HI = 6.0;

/**
 * Where the sheet dissolves, as a fraction of the box's XZ half-DIAGONAL.
 *
 * REALM_CONTRACT §3.4 gives 0.85 of the half-EXTENT (70 m for Cold, so 59.5 m).
 * Measured against the box that number throws work away: the inscribed circle of
 * radius 59.5 covers pi*59.5^2 / 140^2 = 57% of the box's footprint, so nearly
 * half the particles would be faded out at all times while still costing their
 * vertices. Taken against the half-diagonal (99.0 m for Cold) the fade lands at
 * 84.2 m, which clips only the corners. The far particles are almost entirely
 * eaten by the fog anyway — Cold's boosted density 0.0137/m gives transmittance
 * exp(-0.0137 * 84) = 0.32 — so the fade is belt and braces over the haze rather
 * than the primary mechanism. Deviation from the contract, stated with its
 * arithmetic rather than taken silently.
 */
const FAR_FADE_FRAC = 0.85;
const FAR_FADE_START = 0.62; // of FAR_FADE_FRAC

/** Clamp of a single quad's projected half-height, in viewport heights. */
const MAX_SCREEN_H = 0.06;

/** Dust devils: hard maximum, and lattice indices reserved per devil. */
const DEVIL_MAX = 3;
const DEVIL_INDICES = 128;
/** Metres from the camera at which a devil is recycled to a fresh upwind spot. */
const DEVIL_RANGE = 90;
/** Metres below the eye a devil plants when nothing has written `groundY`. */
const DEVIL_GROUND_DROP = 5.0;

/** Gust clock, Hz. Two octaves so the storm breathes rather than pulses. */
const GUST_F1 = 0.11;
const GUST_F2 = 0.37;

/**
 * Fraction of the index range folded into the dense inner shell, and that
 * shell's extents as a fraction of the outer box. See the long note on
 * `uWxInner` in `shaders/weather.glsl.js` — 0.42^3 = 1/13.5, so the inner half
 * of the particles sit at about thirteen times the density of the outer half.
 */
const INNER_FRAC = 0.5;
const INNER_SCALE = 0.42;

/**
 * At or below this particle count the system is on its lean rung and takes ALL
 * FOUR of REALM_CONTRACT §4.3's degradations at once: half the stretch clamp,
 * no ember-glow layer, half the fog boost, no dust devils.
 *
 * Derived from `weatherParticles` rather than declared as its own preset key on
 * purpose: the preset that cuts the count to 512 is by construction the same one
 * that wants the short streaks, and one gated key cannot fall out of step with
 * itself the way two can.
 */
const LEAN_COUNT = 640;

/** Spray reads the cascades softly (particles.js:105-106); weather is softer
 *  still — it is further from every caster and has no geometry to attach to. */
const SHADOW_SOFTNESS = 1.9;
const SHADOW_BIAS = 0.06;

/** Corner order: (-1,-1), (1,-1), (1,1), (-1,1). Same as `particles.js:109`. */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

// ---------------------------------------------------------------- realm table

/**
 * The per-realm dial block, transcribed from REALM_CONTRACT §1e (the weather
 * row) and §1f (the airborne-medium shading row, shared with the spray).
 *
 * Every field is a plain number or a plain array, so `apply()` can take the same
 * shape straight out of `world/realms.js` without this module importing it.
 *
 *   fallSpeed   m/s, positive DOWN
 *   riseSpeed   m/s, positive UP — the second population (Ash smoke)
 *   risingFrac  P(a particle belongs to the rising population)
 *   windGain    multiplier on the spray's own 2.4 * S.windStrength base
 *   gustAmp     amplitude of the gust clock, +/- around 1
 *   box         spawn box extents, metres
 *   radii       [fine, coarse, glow] radius, metres
 *   alpha       [fine, coarse, glow] opacity scale
 *   coarseFrac  P(coarse) — [call], the contract gives radii and alphas but not
 *   glowFrac    P(glow)     the mix; these are the mixes those numbers imply
 *   tint        albedo of fine + coarse
 *   glowTint    emissive colour of the glow kind
 *   glowEmit    emissive scale of the glow kind
 *   stretch     velocity-stretch clamp
 *   fogBoost    multiplier on S.fogDensity / S.fogHeightFalloff
 *   devils      dust devil count
 *   wrap        wrapped-diffuse w  (§1f spray wrap)
 *   mieG        forward-lobe asymmetry (§1f spray forward lobe)
 *   mieGain     forward-lobe gain    (§1f spray forward lobe)
 *
 * @type {Record<string, any>}
 */
export const REALM_WEATHER = {
    /** Snow falls slowly and almost straight; the storm is in the fog. */
    cold: {
        fallSpeed: 1.6, riseSpeed: 0, risingFrac: 0,
        windGain: 1.00, gustAmp: 0.45,
        box: [140, 46, 140],
        radii: [0.012, 0.028, 0.020],
        alpha: [0.30, 0.42, 0.0],
        coarseFrac: 0.28, glowFrac: 0.0,
        tint: [0.94, 0.96, 1.00],
        glowTint: [1.0, 1.0, 1.0], glowEmit: 0.0,
        stretch: 6.0,
        fogBoost: [1.90, 1.00],
        devils: 0,
        wrap: 0.75, mieG: 0.55, mieGain: 0.85,
    },
    /**
     * Sand barely falls — 0.35 m/s against snow's 1.6 — and is driven sideways
     * at 2.6x the wind. That ratio IS the sandstorm: the grains travel almost
     * horizontally, which is why the stretch clamp stays at 6 while the fall
     * speed drops to a fifth.
     */
    sand: {
        fallSpeed: 0.35, riseSpeed: 0, risingFrac: 0,
        windGain: 2.60, gustAmp: 0.70,
        box: [150, 40, 150],
        radii: [0.008, 0.020, 0.016],
        alpha: [0.26, 0.38, 0.0],
        coarseFrac: 0.32, glowFrac: 0.0,
        tint: [0.74, 0.63, 0.44],
        glowTint: [1.0, 1.0, 1.0], glowEmit: 0.0,
        stretch: 6.0,
        fogBoost: [2.40, 1.00],
        devils: 3,
        wrap: 0.55, mieG: 0.68, mieGain: 1.10,
    },
    /**
     * Two populations through one draw: 60% embers and ash falling at 0.90 m/s,
     * 40% smoke rising at 0.45 m/s, split on one hash bit of the particle index.
     * The wind gain is the lowest of the three (0.55) because a smoke column
     * that blows sideways stops reading as a column.
     */
    ash: {
        fallSpeed: 0.90, riseSpeed: 0.45, risingFrac: 0.40,
        windGain: 0.55, gustAmp: 0.30,
        box: [120, 60, 120],
        radii: [0.014, 0.032, 0.020],
        alpha: [0.22, 0.34, 0.85],
        coarseFrac: 0.26, glowFrac: 0.18,
        tint: [0.30, 0.28, 0.27],
        glowTint: [1.00, 0.40, 0.10], glowEmit: 2.8,
        stretch: 3.5,
        fogBoost: [1.35, 1.00],
        devils: 0,
        wrap: 0.35, mieG: 0.45, mieGain: 0.30,
    },
};

// ------------------------------------------------------- module-scope scratch
// Nothing below allocates once construction is done.
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _velA = new THREE.Vector3();
const _velB = new THREE.Vector3();

/**
 * Smooth deterministic 1-D value noise for the gust clock. Deterministic and
 * NOT `Math.random` (ARCHITECTURE.md §6): the storm has to breathe identically
 * on every machine or the shot battery stops being reproducible with weather on.
 * @param {number} n
 * @returns {number} in [0,1)
 */
function hash1(n) {
    const s = Math.sin(n * 127.1) * 43758.5453123;
    return s - Math.floor(s);
}

/**
 * @param {number} x
 * @returns {number} smooth noise in [-1, 1]
 */
function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash1(i);
    const b = hash1(i + 1);
    const t = f * f * (3 - 2 * f);
    return (a + (b - a) * t) * 2 - 1;
}

export class WeatherField {
    /**
     * Mirrors the neighbouring systems' shape: scene first, then the two things
     * every lit surface needs (`sky` for the atmosphere block, `shadows` for the
     * cascade block), then the realm, then a deps bag.
     *
     * @param {THREE.Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {string|{name?:string, weather?:object}|null} [realm]
     *   A realm name, a realm object carrying `.name` and optionally its own
     *   `.weather` block, or null for Cold. Accepting all three is deliberate:
     *   this module must be constructible from a probe with no realm module in
     *   the tree at all.
     * @param {{globals?: Record<string, {value:any}>,
     *          spellUniforms?: Record<string, {value:any}>,
     *          groundRef?: {position: THREE.Vector3},
     *          shadow?: boolean}} [deps]
     *   `globals` hands in one shared `lib/common` block for the frame — pass
     *   `spray.globals` and weather rides the same jittered view-projection the
     *   plume does. `groundRef` is anything with a `.position` (the character
     *   controller); dust devils plant on its Y. `shadow: false` compiles the
     *   cascade lookup out of the fragment program entirely.
     */
    constructor(scene, sky, shadows, realm, deps) {
        this.scene = scene;
        this.sky = sky;
        this.shadows = shadows;

        /** Live parameter block. Never replaced, only written into. */
        this._p = Object.assign({}, REALM_WEATHER.cold);
        this.realmName = "cold";

        /**
         * Multiplicative fog boost the STORM owns, in the shape REALM_CONTRACT
         * §3.2 asks `Sky.update()` to fold in: `{density, falloff}`, defaulting
         * to 1/1 so it is a no-op until a realm sets it.
         *
         * BY REFERENCE off the sky when there is one, so `_applyQuality()`'s
         * writes land in the object `Sky.update()` actually reads. The previous
         * arrangement — a private copy here, plus a `driveFog` flag that rewrote
         * `sky.uniforms.uFog` from `S` every frame AFTER `sky.update()` had — was
         * a flagged stopgap that also made every realm's fog unobservable: the
         * per-frame rewrite clobbered it. `Sky` owns the uniform now, this owns
         * the multiplier, and the stopgap is deleted rather than disabled.
         */
        this.fogBoost = (sky && sky.fogBoost) ? sky.fogBoost : { density: 1, falloff: 1 };

        /** Published so `audio/audio.js` can pass `S.windStrength * gust` into
         *  the wind bed — a one-line change, and it is what makes a storm
         *  audible. Recommended, not required. */
        this.gust = 1;

        /** Dust devils plant here. Written by the integrator (one line:
         *  `weather.groundY = character.position.y`); until then they plant
         *  `DEVIL_GROUND_DROP` below the eye. */
        this.groundY = null;
        this._groundRef = (deps && deps.groundRef) || null;

        // ---- clocks and retained state -------------------------------------
        this._t = 0;
        this._driftA = new THREE.Vector3();
        this._driftB = new THREE.Vector3();
        this._camVel = new THREE.Vector3();
        this._prevCam = new THREE.Vector3();
        this._hasPrevCam = false;
        this._devilSeed = 1;
        /** SoA: cx, cz, radius, height, spin, strength — 6 per devil. */
        this._devil = new Float32Array(DEVIL_MAX * 6);
        this._devilPhase = new Float32Array(DEVIL_MAX);
        this._devilSpawned = false;

        // ---- uniform blocks ------------------------------------------------
        /**
         * `lib/common`'s shared globals (ARCHITECTURE.md §3). Owned here when
         * none is handed in, for the same reason `particles.js:201-208` owns
         * its own: the sheet is then correct whatever order the integrator's
         * updates run in. `uViewProj` is written in `update()` off the beauty
         * camera — a block whose `uViewProj` nobody writes stays the identity,
         * which puts every quad outside the clip volume and renders exactly
         * nothing while every counter reports a full field.
         */
        this.globals = (deps && deps.globals) || {
            uSunDir: { value: sky.sunDir },
            uSunColor: { value: sky.sunRadiance },
            uCameraPos: { value: new THREE.Vector3() },
            uTime: { value: 0 },
            uViewProj: { value: new THREE.Matrix4() },
            uResolution: { value: new THREE.Vector2(1, 1) },
        };

        this._uCamRight = { value: new THREE.Vector3(1, 0, 0) };
        this._uCamUp = { value: new THREE.Vector3(0, 1, 0) };

        // Field
        this._uBox = { value: new THREE.Vector3(140, 46, 140) };
        this._uBoxOff = { value: new THREE.Vector3(0, 13.8, 0) };
        this._uDriftA = { value: new THREE.Vector3() };
        this._uDriftB = { value: new THREE.Vector3() };
        this._uVelA = { value: new THREE.Vector3() };
        this._uVelB = { value: new THREE.Vector3() };
        this._uCamVel = { value: new THREE.Vector3() };
        this._uRise = { value: new THREE.Vector2(0, 0) };
        this._uInner = { value: new THREE.Vector2(INNER_FRAC, INNER_SCALE) };
        // Kinds
        this._uRadii = { value: new THREE.Vector3(0.012, 0.028, 0.020) };
        this._uAlpha = { value: new THREE.Vector3(0.30, 0.42, 0.0) };
        this._uKindSplit = { value: new THREE.Vector2(0.28, 0.0) };
        // Projection
        this._uShape = {
            value: new THREE.Vector4(6.0, MAX_SCREEN_H, STRETCH_BASE, STRETCH_VREF),
        };
        this._uFade = { value: new THREE.Vector4(NEAR_FADE_LO, NEAR_FADE_HI, 54, 84) };
        this._uProjY = { value: 1.0 };
        // Devils
        this._uCount = { value: 0 };
        this._uDevilA = { value: [] };
        this._uDevilB = { value: [] };
        for (let i = 0; i < DEVIL_MAX; i++) {
            this._uDevilA.value.push(new THREE.Vector4());
            this._uDevilB.value.push(new THREE.Vector4());
        }
        this._uDevilCount = { value: 0 };
        this._uDevilIdx = { value: DEVIL_INDICES };
        // Shading
        this._uTint = { value: new THREE.Vector3(0.94, 0.96, 1.0) };
        this._uGlowTint = { value: new THREE.Vector3(1, 1, 1) };
        this._uLight = { value: new THREE.Vector4(0.75, 0.55, 0.85, 0.0) };
        this._uShadowAmt = { value: 0 };

        /** Compile the cascade lookup in at all. Default on, matching the spray
         *  (`spray.glsl.js:186`); `S.weatherShadows` then gates it at runtime so
         *  a preset can zero it without a program rebuild. */
        this._shadowCompiled = !(deps && deps.shadow === false);

        const uniforms = Object.assign(
            {},
            this.globals,
            sky.uniforms,
            this._shadowCompiled && shadows
                ? shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS)
                : {},
            (deps && deps.spellUniforms) || {},
            {
                camRight: this._uCamRight,
                camUp: this._uCamUp,
                uWxBox: this._uBox,
                uWxBoxOff: this._uBoxOff,
                uWxDriftA: this._uDriftA,
                uWxDriftB: this._uDriftB,
                uWxVelA: this._uVelA,
                uWxVelB: this._uVelB,
                uWxCamVel: this._uCamVel,
                uWxRise: this._uRise,
                uWxInner: this._uInner,
                uWxRadii: this._uRadii,
                uWxAlpha: this._uAlpha,
                uWxKindSplit: this._uKindSplit,
                uWxShape: this._uShape,
                uWxFade: this._uFade,
                uWxProjY: this._uProjY,
                uWxCount: this._uCount,
                uWxDevilA: this._uDevilA,
                uWxDevilB: this._uDevilB,
                uWxDevilCount: this._uDevilCount,
                uWxDevilIdx: this._uDevilIdx,
                uWxTint: this._uTint,
                uWxGlowTint: this._uGlowTint,
                uWxLight: this._uLight,
                uWxShadowAmt: this._uShadowAmt,
            }
        );

        // ---- material --------------------------------------------------------
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(WEATHER_VERTEX),
            fragmentShader: shader(weatherFragment({ shadow: this._shadowCompiled })),
            uniforms,
            side: THREE.DoubleSide,
            transparent: true,
            // TRUE, and this is the whole reason weather never touches
            // `terrain.heightAt()`: the opaque pass has already written depth,
            // so a particle that wraps below the ground is culled for free.
            depthTest: true,
            // FALSE: the sheet must not occlude the plume behind it.
            depthWrite: false,
            blending: THREE.NormalBlending,
            // TRUE, where the spray is false (particles.js:244). Premultiplied
            // is what lets one blend state carry an absorbing flake AND an
            // emitting ember — a second additive pass would breach the +1 draw
            // cap in REALM_CONTRACT §4.2.
            premultipliedAlpha: true,
        });
        this.material.name = "weather";

        // ---- mesh ------------------------------------------------------------
        this.geometry = buildQuadLattice();
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "weather";
        // Every quad is placed in the vertex shader, so the CPU has no idea
        // where this mesh is; a frustum test against its identity bounds would
        // cull the whole sheet the moment the camera moved.
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.updateMatrix();
        // 3, against spray's 2 and the wake's/terrain's 1: the storm composites
        // over the plume, because the plume is inside the storm.
        this.mesh.renderOrder = 3;
        this.mesh.visible = S.showWeather !== false;
        if (scene) scene.add(this.mesh);

        /** For `gfx.warmUp`'s extra-mesh list. */
        this.meshes = [this.mesh];

        this.count = 0;
        this.triangles = 0;
        this._checkedCamera = false;

        // ---- settings --------------------------------------------------------
        this._unsub = [
            onChange("weatherParticles", () => this._applyCount()),
            onChange("showWeather", (v) => { this.mesh.visible = !!v; }),
            onChange("weatherShadows", () => this._applyQuality()),
        ];

        // Realm last: it needs the uniform boxes and the count to exist.
        this._applyCount();
        this.setRealm(
            typeof realm === "string" ? realm
                : (realm && realm.name) || "cold"
        );
        if (realm && typeof realm === "object" && realm.weather) {
            this.apply(realm.weather);
        }
    }

    // ------------------------------------------------------------------ realm

    /**
     * Switch realms. Called from `Realm.swap()` step 6, behind the loading
     * screen — but it is cheap enough to call from anywhere: it writes uniform
     * boxes and nothing else. No reallocation, no re-compile, no stall.
     * @param {string} name "cold" | "sand" | "ash"
     * @returns {void}
     */
    setRealm(name) {
        const row = REALM_WEATHER[name];
        this.realmName = row ? name : "cold";
        this.apply(row || REALM_WEATHER.cold);
    }

    /**
     * Apply a PLAIN parameter object. Missing keys keep their current value, so
     * a caller may hand in a partial override — `{fogBoost: [1.2, 1.0]}` is a
     * legal block. See `REALM_WEATHER` for the field list.
     *
     * This is the seam the realm module writes through: it never imports this
     * file's table and this file never imports its.
     * @param {object} block
     * @returns {void}
     */
    apply(block) {
        if (block) Object.assign(this._p, block);
        this._applyQuality();
    }

    // ---------------------------------------------------------------- internal

    /**
     * Resolve `S.weatherParticles` into a draw range. Never reallocates: the
     * lattice is always `WEATHER_MAX` quads and only the range moves.
     * @returns {void}
     */
    _applyCount() {
        const n = Math.max(0, Math.min(WEATHER_MAX, Math.round(S.weatherParticles || 0)));
        this.count = n;
        this.triangles = n * 2;
        this.geometry.setDrawRange(0, n * 6);
        this.geometry.userData.triangles = n * 2;
        this._uCount.value = n;
        this._applyQuality();
    }

    /**
     * Push the realm block through the preset gates into the uniform boxes.
     *
     * The lean rung (REALM_CONTRACT §4.3) takes all four degradations off ONE
     * derived flag — see `LEAN_COUNT`.
     * @returns {void}
     */
    _applyQuality() {
        const p = this._p;
        const lean = this.count <= LEAN_COUNT;

        const bx = p.box[0], by = p.box[1], bz = p.box[2];
        this._uBox.value.set(bx, by, bz);
        // The camera sits low in the column, so the box is biased upward: an
        // origin-centred box would put ~40% of the field under the terrain,
        // where the depth test discards it at full vertex cost.
        this._uBoxOff.value.set(0, by * 0.30, 0);

        // Fade band, from the box's XZ half-diagonal. See FAR_FADE_FRAC.
        const halfDiag = 0.5 * Math.sqrt(bx * bx + bz * bz);
        const farHi = FAR_FADE_FRAC * halfDiag;
        this._uFade.value.set(NEAR_FADE_LO, NEAR_FADE_HI, FAR_FADE_START * farHi, farHi);

        this._uRadii.value.set(p.radii[0], p.radii[1], p.radii[2]);
        this._uAlpha.value.set(p.alpha[0], p.alpha[1], p.alpha[2]);
        // Degradation 1: the ember-glow layer is dropped on the lean rung. Ash
        // still glows at ground level through the snow fragment's glint block,
        // which is already paid for.
        this._uKindSplit.value.set(p.coarseFrac, lean ? 0 : p.glowFrac);
        this._uRise.value.set(p.risingFrac, 0);

        // Degradation 2: half the stretch clamp. Shorter streaks are directly
        // less fill, and at resolutionScale 0.5 the long tail is not resolvable.
        this._uShape.value.set(
            lean ? p.stretch * 0.5 : p.stretch,
            MAX_SCREEN_H, STRETCH_BASE, STRETCH_VREF
        );

        // Degradation 3: half the fog boost. `performance` already switches the
        // far range off (settings.js:328), so there is no far field for heavy
        // haze to act on — it would just flatten the frame for nothing.
        const fd = p.fogBoost[0], ff = p.fogBoost[1];
        this.fogBoost.density = lean ? 1 + (fd - 1) * 0.5 : fd;
        this.fogBoost.falloff = lean ? 1 + (ff - 1) * 0.5 : ff;

        // Degradation 4: no dust devils; their reserved indices go back to the
        // sheet.
        const want = lean ? 0 : Math.min(DEVIL_MAX, p.devils | 0);
        if (want !== this._uDevilCount.value) this._devilSpawned = false;
        this._uDevilCount.value = want;

        this._uTint.value.set(p.tint[0], p.tint[1], p.tint[2]);
        this._uGlowTint.value.set(p.glowTint[0], p.glowTint[1], p.glowTint[2]);
        this._uLight.value.set(p.wrap, p.mieG, p.mieGain, p.glowEmit);

        this._uShadowAmt.value =
            this._shadowCompiled && S.weatherShadows !== false ? 1 : 0;
    }

    /**
     * Place the devils. Runs only while `uWxDevilCount > 0`, i.e. Sand off the
     * lean rung. Deterministic: a counter-based hash, never `Math.random`.
     * @param {number} h clamped dt
     * @param {number} wx wind x, m/s
     * @param {number} wz wind z, m/s
     * @param {number} groundY
     * @returns {void}
     */
    _updateDevils(h, wx, wz, groundY) {
        const n = this._uDevilCount.value;
        const d = this._devil;

        for (let k = 0; k < n; k++) {
            const o = k * 6;
            if (!this._devilSpawned) {
                this._spawnDevil(k, groundY);
                continue;
            }
            // Devils travel with the wind but lag it — a vortex drags.
            d[o] += wx * 0.35 * h;
            d[o + 1] += wz * 0.35 * h;
            const dx = d[o] - _camPos.x;
            const dz = d[o + 1] - _camPos.z;
            if (dx * dx + dz * dz > DEVIL_RANGE * DEVIL_RANGE) this._spawnDevil(k, groundY);
        }
        this._devilSpawned = true;

        for (let k = 0; k < DEVIL_MAX; k++) {
            const o = k * 6;
            this._uDevilA.value[k].set(d[o], d[o + 1], d[o + 2], d[o + 3]);
            this._uDevilB.value[k].set(d[o + 4], d[o + 5], groundY, this._devilPhase[k]);
        }
    }

    /**
     * Respawn one devil upwind of the camera, so it drifts across the player
     * rather than away from them.
     * @param {number} k
     * @param {number} groundY
     * @returns {void}
     */
    _spawnDevil(k, groundY) {
        const o = k * 6;
        const s = this._devilSeed++;
        const a = hash1(s * 1.7) * Math.PI * 2;
        const r = 55 + hash1(s * 3.1) * 30;
        const wa = bearingRad(S.windDirection);
        // Biased 60% upwind, 40% anywhere: a devil that only ever appears
        // dead upwind reads as a spawner.
        const bias = 0.6;
        const ang = a * (1 - bias) + (wa + Math.PI) * bias;
        this._devil[o] = _camPos.x + Math.sin(ang) * r;
        this._devil[o + 1] = _camPos.z + Math.cos(ang) * r;
        this._devil[o + 2] = 3.5 + hash1(s * 5.3) * 4.5;   // radius, m
        this._devil[o + 3] = 14 + hash1(s * 7.9) * 16;     // height, m
        this._devil[o + 4] = 0.35 + hash1(s * 11.3) * 0.45; // spin, rev/s
        this._devil[o + 5] = 0.5 + hash1(s * 13.7) * 0.5;  // strength
        this._devilPhase[k] = hash1(s * 17.1);
        // groundY is written by the caller into uWxDevilB.z every frame; the
        // parameter is here so a devil spawned before the first update still
        // has a sane plant.
        void groundY;
    }

    // ------------------------------------------------------------------ frame

    /**
     * Advance the drift clocks and push the uniforms.
     *
     * MUST run after `spray.update()` when it was handed `spray.globals`: the
     * spray writes `uViewProj` and `uCameraPos` into that block, and reading a
     * stale view-projection puts every quad a frame behind the camera at
     * 19.5 m/s. It no longer has to run after `sky.update()`: the fog boost is a
     * plain field `Sky.update()` reads, not a uniform this writes.
     *
     * Cost: no loop over particles, no upload. About a dozen uniform writes,
     * plus three more per active dust devil.
     *
     * @param {number} dt seconds
     * @param {THREE.Camera} camera the beauty camera
     * @returns {void}
     */
    update(dt, camera) {
        if (!camera || camera.isCamera !== true) return;
        if (!this.mesh.visible || this.count <= 0) return;

        // Clamped so one hitch cannot fling the whole field across the box.
        const h = Math.min(Math.max(dt, 0), 1 / 30);
        this._t += h;

        // ---- basis and eye, straight off the camera's world matrix ----------
        _right.setFromMatrixColumn(camera.matrixWorld, 0);
        _up.setFromMatrixColumn(camera.matrixWorld, 1);
        _camPos.setFromMatrixPosition(camera.matrixWorld);
        this._uCamRight.value.copy(_right);
        this._uCamUp.value.copy(_up);
        this.globals.uCameraPos.value.copy(_camPos);
        this.globals.uTime.value = this._t;
        // The beauty pass's JITTERED view-projection: `post.update()` writes the
        // TAA jitter into `camera.projectionMatrix` and this runs after it, so
        // the product is the matrix the rest of the frame rasterises through.
        // Writes in place; no allocation.
        this.globals.uViewProj.value.multiplyMatrices(
            camera.projectionMatrix, camera.matrixWorldInverse
        );
        // Element 5 is the projection's [1][1] — the screen-height clamp's only
        // input, taken from the matrix rather than from a stored FOV so it
        // tracks a resize and the jitter without this file knowing about either.
        this._uProjY.value = camera.projectionMatrix.elements[5];

        // ---- camera velocity, for the stretch --------------------------------
        if (this._hasPrevCam && h > 1e-5) {
            // Smoothed: a single-frame difference across a hitch spikes to
            // hundreds of m/s and every flake becomes a full-screen streak.
            const k = 1 - Math.exp(-12 * h);
            this._camVel.set(
                this._camVel.x + ((_camPos.x - this._prevCam.x) / h - this._camVel.x) * k,
                this._camVel.y + ((_camPos.y - this._prevCam.y) / h - this._camVel.y) * k,
                this._camVel.z + ((_camPos.z - this._prevCam.z) / h - this._camVel.z) * k
            );
        }
        this._prevCam.copy(_camPos);
        this._hasPrevCam = true;
        this._uCamVel.value.copy(this._camVel);

        // ---- wind + gust ------------------------------------------------------
        const p = this._p;
        // The gust clock lives here and NEVER writes S.windStrength — that is a
        // user slider, and a system that writes into the settings store makes
        // the overlay fight the simulation.
        this.gust = 1 + p.gustAmp * (
            0.68 * noise1(this._t * GUST_F1) + 0.32 * noise1(this._t * GUST_F2)
        );
        // The same call and the same 2.4 base the spray uses (particles.js:362-364),
        // which is what keeps the storm, the plume, the cloth, the fur, the
        // sastrugi and the cirrus in one register. A raw `windDirection` here
        // would blow the storm ACROSS the sastrugi instead of along it.
        const wa = bearingRad(S.windDirection);
        const g = 2.4 * S.windStrength * p.windGain * this.gust;
        const wx = Math.sin(wa) * g;
        const wz = Math.cos(wa) * g;

        _velA.set(wx, -p.fallSpeed, wz);
        _velB.set(wx, p.riseSpeed, wz);
        this._uVelA.value.copy(_velA);
        this._uVelB.value.copy(_velB);

        // ---- drift, integrated and PRE-WRAPPED --------------------------------
        // Wrapping on the CPU keeps the shader's mod() argument small. An
        // unwrapped `time * velocity` reaches 4,800 m after ten minutes at
        // 8 m/s, where fp32's ULP is still about half a millimetre so it would
        // in fact survive — but three modulos a frame removes the question
        // entirely, and removes it for the ten-hour case too.
        const bx = this._uBox.value.x, by = this._uBox.value.y, bz = this._uBox.value.z;
        const dA = this._driftA, dB = this._driftB;
        dA.x = (dA.x + _velA.x * h) % bx;
        dA.y = (dA.y + _velA.y * h) % by;
        dA.z = (dA.z + _velA.z * h) % bz;
        dB.x = (dB.x + _velB.x * h) % bx;
        dB.y = (dB.y + _velB.y * h) % by;
        dB.z = (dB.z + _velB.z * h) % bz;
        this._uDriftA.value.copy(dA);
        this._uDriftB.value.copy(dB);

        // ---- dust devils -------------------------------------------------------
        if (this._uDevilCount.value > 0) {
            const gy = this.groundY !== null ? this.groundY
                : (this._groundRef ? this._groundRef.position.y
                    : _camPos.y - DEVIL_GROUND_DROP);
            this._updateDevils(h, wx, wz, gy);
        }

        // No fog write here. `this.fogBoost` IS `sky.fogBoost` (constructor), and
        // `Sky.update()` folds it into `uFog` off the realm base every frame.
    }

    // ---------------------------------------------------------------- lifecycle

    /**
     * Stand the field up before the warm frames.
     *
     * There is nothing synthetic to seed — the sheet is always full, which is
     * the point of a stationary distribution — but the uniforms must be REAL or
     * the warm draw specialises a program whose `uViewProj` is the identity and
     * whose `uWxProjY` is zero, i.e. a program that has never had a fragment
     * through it. That is exactly the hitch `main.js:514-517` exists to avoid on
     * the D3D11/ANGLE backend.
     * @param {THREE.Camera} camera
     * @returns {void}
     */
    warmUpSeed(camera) {
        const was = this.mesh.visible;
        this.mesh.visible = true;
        this.update(0, camera);
        this.mesh.visible = was;
    }

    /**
     * Symmetry with the other systems' warm-up pairs. Nothing survives a warm
     * frame here — there is no pool to clear and no synthetic geometry standing
     * — so this only puts visibility back where the settings say it belongs.
     * @returns {void}
     */
    finishWarmUp() {
        this.mesh.visible = S.showWeather !== false;
    }

    /**
     * Hand the fog back to the realm untouched. Call before disabling the
     * system, or the last storm's boost stays multiplied into every frame.
     *
     * Resets the BOOST, not the uniform: `Sky.update()` rebuilds `uFog` from the
     * realm base next frame, so putting 1/1 back here is the whole release. The
     * realm's own fog survives it, which is the point — a disabled weather field
     * must not flatten Ash's smoke back to Cold's haze.
     * @returns {void}
     */
    releaseFog() {
        this.fogBoost.density = 1;
        this.fogBoost.falloff = 1;
    }

    /** @returns {void} */
    dispose() {
        for (let i = 0; i < this._unsub.length; i++) this._unsub[i]();
        this._unsub.length = 0;
        this.releaseFog();
        if (this.scene) this.scene.remove(this.mesh);
        this.geometry.dispose();
        this.material.dispose();
    }
}

// -----------------------------------------------------------------------------

/**
 * A static lattice of quads. `position` is `(particleIndex, cornerX, cornerY)`
 * and carries no geometry at all — the vertex shader places every corner from a
 * hash of the index.
 *
 * The attribute keeps the name `position` even though it is not one, matching
 * `particles.js:486-509`, `character/build.js` and `shaders/cloth.glsl.js`.
 * Three only derives a draw count from `position` on a NON-indexed geometry and
 * this one is indexed, so the name costs nothing.
 * @returns {THREE.BufferGeometry}
 */
function buildQuadLattice() {
    const pos = new Float32Array(WEATHER_MAX * 4 * 3);
    const idx = new Uint32Array(WEATHER_MAX * 6);

    for (let i = 0; i < WEATHER_MAX; i++) {
        for (let c = 0; c < 4; c++) {
            const o = (i * 4 + c) * 3;
            pos[o] = i;
            pos[o + 1] = CORNERS[c * 2];
            pos[o + 2] = CORNERS[c * 2 + 1];
        }
        const b = i * 4;
        const q = i * 6;
        idx[q] = b; idx[q + 1] = b + 1; idx[q + 2] = b + 2;
        idx[q + 3] = b; idx[q + 4] = b + 2; idx[q + 5] = b + 3;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    // OES_element_index_uint is core in WebGL2; 16384 vertices needs it.
    g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    return g;
}

export { WEATHER_MAX };
