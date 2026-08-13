/**
 * The spell system — dispatch, shared context, and the casting pose.
 *
 * Owns the five spells, the water body they draw into, the ice they leave, and
 * the light pool every material reads. One `update()` per frame, in this order,
 * and THE ORDER IS LOAD-BEARING:
 *
 *   1. clear the light pool
 *   2. dispatch input
 *   3. update every spell — they declare lights and write brushes here
 *   4. publish the pool to every consumer
 *   5. upload the water and the crystals
 *
 * The lights have to be cleared BEFORE the spells run and published AFTER, or a
 * spell that ended last frame keeps lighting the snow for one more frame.
 *
 * `SpellSystem.update()` must also be called BEFORE `terrain.update()`. The
 * deformation simulation pass consumes the brush queue for the frame and the
 * spells write brushes in step 3, so they must land before the sim runs. The
 * order `main.js` wants is: character -> figure -> contact -> spells -> terrain.
 *
 * Allocation per frame: none.
 */

import * as THREE from "three";

import { input } from "../core/input.js";
import { S } from "../core/settings.js";
import { SpellLights } from "./spellLights.js";
import { WaterBody } from "./waterBody.js";
import { CrystalField } from "./crystals.js";
import { Sweep } from "./sweep.js";
import { Ribbon } from "./ribbon.js";
import { Bloom } from "./bloom.js";
import { Crystallize } from "./crystallize.js";
import { Vortex } from "./vortex.js";
import { Dart } from "./dart.js";
import { HandWeave } from "./handWeave.js";
import { ShockwaveRings } from "../vfx/shockwave.js";
import { aimPoint, expDamp } from "./bending.js";

/**
 * @typedef {{
 *   controller: {position: THREE.Vector3, facing: number, cast: number,
 *                castAimX: number, castAimY: number, castAimZ: number},
 *   figure: {handPosition(which:number, out:Float32Array, off:number): void}|null,
 *   rig: {forward: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3,
 *         camera: THREE.Camera, addTrauma(a:number): void},
 *   terrain: {heightAt(x:number, z:number): number},
 *   deform: {brush(x:number,z:number,radius:number,depth:number,berm:number,
 *                  compression:number,ice:number,yaw:number,elongation:number,
 *                  edge:number): void}|null,
 *   spray: {emit(x:number,y:number,z:number,vx:number,vy:number,vz:number,
 *                size:number,life:number,kind:number,drag:number): void}|null,
 *   water: WaterBody,
 *   crystals: CrystalField,
 *   lights: SpellLights,
 *   bolt: Dart,
 *   realm: typeof REALM_PALETTE.cold,
 *   time: number,
 *   sprayScale: number,
 *   handPosition: (which:number, out:Float32Array, off:number) => void,
 * }} SpellContext
 */

const _aim = new Float32Array(3);
/** The muzzle. Preallocated: `cast(6)` runs 2.2 times a second. */
const _hand = new Float32Array(3);
const _viewProj = new THREE.Matrix4();

/**
 * Seconds from keypress to the cast clip's HAND STRIKE, per spell key —
 * measured on the hero_v2 GLB (peak combined hand speed, 2026-08-05) and
 * divided by meshChar's CAST_RATE for that clip:
 *   1: 2H Magic Attack 04   0.955 s / 1.35 = 0.71
 *   3: 1H Magic Attack 03   0.824 s / 1.25 = 0.66
 *   4: 2H Area Attack    1.285 s / 1.35 = 0.95
 *   5: 2H Cast Spell     1.273 s / 1.30 = 0.98
 * Re-measure BOTH together if the clips or rates change.
 */
const STRIKE_DELAY = { 1: 0.71, 3: 0.66, 4: 0.95, 5: 0.98, 6: 0 };

/**
 * The primary bolt — internal id 6, the ONE new engine id (1..5 are taken and
 * are never renumbered). `progression.js`'s UNLOCK_LEVEL and its save-load
 * guard both stop at 5; the bolt is the level-1 filler that is never locked, so
 * `cast()` exempts it from the unlock gate rather than waiting for that file.
 */
export const BOLT_KEY = 6;
/** The frost-arc hotkey (owner 2026-08-12: the arc lives on KEY 1,
 *  not LMB). Cast edge from Digit1; free like the bolt, but with a
 *  short cooldown so an AoE-with-slow cannot be strobed. */
export const ARC_KEY = 7;
const ARC_COOLDOWN = 1.5;

/**
 * The bolt's engine numbers, transcribed from `combat/combatData.js`
 * SPELLS.LMB the same way STRIKE_DELAY / MANA_COST / COOLDOWN are transcribed —
 * this module owns no combat import, and the two tables are kept in step by
 * hand exactly as the docblock in combatData.js says.
 *
 *   fireCycleS  0.45  -> 12 damage / 0.45 s = 26.7 DPS planted
 *   speed       21 m/s, range 40 m aim leash / 18 m fallback
 *
 * Damage, splash, poise and the anti-kite falloff are NOT here: they belong to
 * `combat/spellHits.js`, which reads them out of `combatData.bolt`.
 */
const BOLT_CYCLE = 0.45;
const BOLT_SPEED = 21;
const BOLT_RANGE = 40;
const BOLT_FALLBACK = 18;

/**
 * The cold FROST ARC's geometry, transcribed from `combatData.bolt.arc` the
 * same way BOLT_CYCLE is transcribed from SPELLS.LMB — this module owns no
 * combat import, and the two tables are kept in step by hand. The DAMAGE
 * volume is resolved in `combat/spellHits.js` against `combatData.bolt.arc`;
 * these two only shape the visual fan and the ground glaze.
 */
const ARC_HALF = 1.05;   // rad — combatData.bolt.arc.halfAngle
const ARC_REACH = 8;     // m   — combatData.bolt.arc.reach
/** Carrier darts per arc cast — visual only (`own = 1` never damages). */
const ARC_FAN = 5;

/**
 * THE REALM PALETTE — the eighteen identities, as three frozen rows.
 *
 * The governing rule (owner directive 4): the mechanic is constant across
 * realms; the fiction and the FX change. Nothing in this table is a gameplay
 * number. Every damage, radius, duration, cooldown and mana cost lives in
 * `combatData.js` and is realm-invariant.
 *
 * Two kinds of entry, and the split is what makes the swap cost nothing:
 *
 *   uniform    `absorb`..`surface` are written into `realmUniforms` — preallocated
 *              `{value}` boxes the materials already share. A swap writes numbers
 *              into boxes the linked programs sample at draw time. No material is
 *              rebuilt, no program is compiled, no draw call is added.
 *   CPU        `milk`, `light`, `spray`, `ice`, `bolt` and the three per-realm
 *              behaviour flags are read by the spells themselves each frame, out
 *              of `ctx.realm`. They feed arguments those spells ALREADY pass —
 *              `water.setParams`'s milkiness, `lights.add`'s rgb, `spray.emit`'s
 *              kind/drag/life, `deform.brush`'s ice channel — so they are free
 *              in the same sense: data that was being uploaded anyway.
 *
 * COLD IS THE SHIPPED LOOK, EXACTLY. Every cold number below is quoted from the
 * file that held it before this table existed, so `setRealm("cold")` reproduces
 * the build byte for byte: milk from sweep.js:193 / ribbon.js:702 / bloom.js:180
 * / vortex.js:193, light multipliers of 1, ice 1, spray identity.
 */
export const REALM_PALETTE = {
    cold: Object.freeze({
        key: "cold",
        status: "Chill", statusMax: "Brittle",
        names: Object.freeze({
            lmb: "Rime Arc", stream: "Rime Ribbon", wave: "Frost Wave",
            bloom: "Powder Bloom", spikes: "Crystal Spikes",
            vortex: "Great Vortex",
        }),
        // --- uniform block ------------------------------------------------
        absorb: [3.40, 0.72, 0.34],        // water.glsl.js:185 WATER_ABSORB
        scatter0: [0.40, 0.80, 1.00],      // water.glsl.js:309 lo
        scatter1: [0.72, 0.94, 1.00],      // water.glsl.js:309 hi
        body: [0.86, 0.90, 0.96],          // water.glsl.js:329 slushAlbedo
        foam: [0.93, 0.955, 0.99],         // water.glsl.js:348 foamAlbedo
        grain: [0.92, 0.94, 0.98],         // spray.glsl.js:192
        litTint: [0.35, 0.62, 0.78],       // water.glsl.js:404
        emissive: [0, 0, 0],               // ice does not emit
        surface: [0.07, 1.0, 2.0, 0.0],    // rough, translucency, emisPow, opacity+
        // --- CPU side ------------------------------------------------------
        milk: Object.freeze({ sweep: 0.48, ribbon: 0.14, bloom: 0.42, vortex: 0.88 }),
        light: Object.freeze({ r: 1, g: 1, b: 1, mult: 1 }),
        spray: Object.freeze({
            clodBias: 0, grainDragMul: 1, dustDragMul: 1,
            lifeMul: 1, sizeMul: 1,
        }),
        ice: 1,                            // the glaze channel, full
        bolt: Object.freeze({
            len: 0.62, wid: 0.11,
            trailKind: 0, trailDrag: 4.0, trailLife: 0.33, trailSize: 1,
            flashR: 0.52, flashG: 0.80, flashB: 1.0, flashK: 9,
        }),
        streamCone: false,                 // slot 1 stays a rope
        waveThrowM: 0,                     // slot 2 is born at the feet
        spikeCrater: false,                // slot 4 grows, it does not detonate
        /** COLD LMB = the FROST ARC (owner redesign 2026-08-11): a forgiving
         *  frontal cone that hits everything in front, chill-slows it and
         *  glazes the ground — not a projectile. The ONE deliberate gameplay
         *  divergence in this table; numbers in `combatData.bolt.arc`. */
        boltArc: true,
    }),

    sand: Object.freeze({
        key: "sand",
        status: "Abrade", statusMax: "Scoured",
        names: Object.freeze({
            lmb: "Fulgurite Dart", stream: "Scourging Ribbon", wave: "Dune Surge",
            bloom: "Blowout", spikes: "Sand Explosion", vortex: "Sand Tornado",
        }),
        // Blue is absorbed hardest, which is what makes a metre of it ochre.
        absorb: [1.10, 1.45, 2.35],
        scatter0: [0.86, 0.66, 0.36],
        scatter1: [0.96, 0.88, 0.68],
        body: [0.82, 0.68, 0.44],          // tan-ochre grit
        foam: [0.93, 0.85, 0.66],          // the airborne veil off the lip
        grain: [0.88, 0.76, 0.54],
        litTint: [0.78, 0.62, 0.34],
        emissive: [0, 0, 0],               // sand does not glow either
        surface: [0.34, 0.45, 2.6, 0.25],  // rougher, half-transmissive glass
        // Dry sand transmits nothing, so every body is far more opaque.
        milk: Object.freeze({ sweep: 0.88, ribbon: 0.62, bloom: 0.62, vortex: 0.92 }),
        // The cold cyan (~0.45, 0.77, 1.0) times this lands on warm ochre, and
        // sand does not glow, so the intensity comes DOWN.
        light: Object.freeze({ r: 2.22, g: 0.94, b: 0.34, mult: 0.85 }),
        spray: Object.freeze({
            clodBias: 0.45,                // grit is hard-edged, not powder
            grainDragMul: 0.55,            // and it falls rather than hanging
            dustDragMul: 1.25,             // but the fine fallout hangs LONGER
            lifeMul: 0.95, sizeMul: 0.95,
        }),
        ice: 0.55,                         // it sinters to glass, not to ice
        bolt: Object.freeze({
            len: 0.62, wid: 0.115,
            trailKind: 1, trailDrag: 1.6, trailLife: 0.30, trailSize: 1.1,
            flashR: 0.95, flashG: 0.72, flashB: 0.36, flashK: 8,
        }),
        streamCone: false,
        waveThrowM: 0,                     // "the wave is still fine for sand"
        spikeCrater: true,                 // SAND EXPLOSION — a real crater
        boltArc: false,                    // sand keeps the Fulgurite DART
    }),

    ash: Object.freeze({
        key: "ash",
        status: "Scorch", statusMax: "Cracked",
        names: Object.freeze({
            lmb: "Cinder Spike", stream: "Fire Cone", wave: "Fireball",
            bloom: "Fumarole", spikes: "Basalt Columns", vortex: "Firestorm",
        }),
        absorb: [0.85, 1.90, 3.40],
        scatter0: [0.55, 0.24, 0.10],
        scatter1: [0.95, 0.55, 0.22],
        body: [0.16, 0.15, 0.15],          // charcoal crust
        foam: [1.00, 0.46, 0.14],          // the incandescent tear-line
        grain: [0.28, 0.22, 0.20],         // soot, with embers among it
        litTint: [0.85, 0.40, 0.16],
        emissive: [1.35, 0.42, 0.10],      // THE row that is non-zero
        surface: [0.52, 0.05, 1.5, 0.40],  // rough, opaque, emissive in the cracks
        milk: Object.freeze({ sweep: 0.80, ribbon: 0.72, bloom: 0.66, vortex: 0.90 }),
        light: Object.freeze({ r: 2.22, g: 0.55, b: 0.14, mult: 1.45 }),
        spray: Object.freeze({
            clodBias: 0.55, grainDragMul: 0.35, dustDragMul: 1.05,
            lifeMul: 1.25, sizeMul: 0.9,
        }),
        ice: 0,                            // fire scorches; it does not glaze
        bolt: Object.freeze({
            len: 0.60, wid: 0.13,
            trailKind: 1, trailDrag: 0.7, trailLife: 0.42, trailSize: 1.25,
            flashR: 1.0, flashG: 0.52, flashB: 0.18, flashK: 13,
        }),
        streamCone: true,                  // FIRE CONE from the hands
        waveThrowM: 5.0,                   // FIREBALL: thrown, then detonates
        spikeCrater: false,                // basalt columns still GROW
        boltArc: false,                    // ash keeps the Cinder Spike DART
    }),
};

/**
 * Mana costs (battle prep, owner 2026-08-05). PLACEHOLDERS pending the
 * combat design doc — the shape matters now (casts gate on mana, the HUD
 * shows the spend, the ribbon drains per second), the numbers come later.
 */
const MANA_COST = { 1: 15, 3: 25, 4: 30, 5: 45, 6: 0 };   // spec §1.1, QA-verified
const RIBBON_DRAIN = 0;   // §1.1: the Bolt/stream is the resource-neutral filler

/**
 * Cooldowns, seconds — the combat design doc's numbers (wave 4, mini-vortex
 * 6, spikes 10, great vortex 14). The stream (LMB) has none: it is the
 * mana-drained channel. The toolbar renders these as radial wipes.
 */
const COOLDOWN = { 1: 4, 3: 6, 4: 10, 5: 14, 6: 0 };

export class SpellSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {import("../terrain/terrain.js").Terrain} terrain
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {import("../character/figure.js").Figure|null} figure
     * @param {import("../core/camera.js").CameraRig} rig
     * @param {{emit: Function}|null} [spray] the [WAKE]-owned SprayField
     */
    constructor(scene, sky, shadows, terrain, controller, figure, rig, spray) {
        /**
         * `lib/common`'s shared globals (ARCHITECTURE.md §3), owned here rather
         * than read from the integrator so the spells are correct whatever order
         * `updateGlobals()` runs in — the same choice `render/sky.js` and
         * `terrain/terrain.js` made. They are plain `{value}` boxes, so an
         * integrator that wants one set for the whole frame may assign over this
         * map before the first `update()`. `uSunDir` and `uSunColor` hold live
         * references to the Sky's own vectors and never need copying.
         * @type {Record<string, {value:any}>}
         */
        this.globals = {
            uSunDir: { value: sky.sunDir },
            uSunColor: { value: sky.sunRadiance },
            uCameraPos: { value: new THREE.Vector3() },
            uTime: { value: 0 },
            uViewProj: { value: new THREE.Matrix4() },
            uResolution: { value: new THREE.Vector2(1, 1) },
        };

        this.lights = new SpellLights();
        /**
         * The 4-slot light block, for `new Terrain(..., { spellUniforms })` and
         * any other material that would rather share the pool by reference than
         * be copied into. Same objects the spells write.
         * @type {Record<string, {value:any}>}
         */
        this.spellUniforms = this.lights.uniforms;

        /**
         * THE REALM PALETTE BLOCK — the GPU half of the eighteen identities.
         *
         * Preallocated `{value}` boxes, shared by reference into every spell
         * material that reads them. `setRealm()` writes numbers INTO these
         * vectors; it never replaces a box, never rebuilds a material and
         * never touches a `#define`. Three keeps a `{value}` box per uniform
         * and samples it at draw time (the contract `spellLights.js:14-28`
         * already documents and relies on), so a realm crossing compiles
         * nothing and adds no draw call — provable by reading
         * `renderer.info.programs.length` across a swap.
         *
         * Consumed by `dart.js`'s material, which declares `uRealmAbsorb /
         * uRealmBody / uRealmEmissive / uRealmLitTint / uRealmSurface`
         * (`shaders/dart.glsl.js:155-159`), and — since the promotion — by
         * `waterBody.js`'s, which declares all of those but `uRealmSurface`
         * plus `uRealmScatter0/1` and `uRealmFoam`.
         *
         * That second consumer is the one that mattered. While `water.glsl.js`
         * held its palette as compile-time constants, EVERY water-bodied spell
         * — the stream, the wave, the bloom and the vortex, four of the six
         * slots — rendered as ice in all three realms, and the CPU half below
         * (milkiness, light colour, spray, deform ice) only ever changed how
         * MUCH ice. `_harness/spellrealm_truth.py` measured it as a chromatic
         * inversion: in Sand the casts added blue-dominant light over ochre
         * dunes, which no ochre material can do.
         *
         * STILL A COMPILE-TIME CONSTANT, and deliberately: `crystal.glsl.js`.
         * Its palette is shared with `combat/dummies.js`, which builds its own
         * material and would not supply a promoted uniform — and an undeclared
         * uniform reads zero, which is precisely how a shader once shipped with
         * a black albedo. Promoting it requires the dummies' material to pass
         * this block in the same commit. Slot 4's crystals therefore keep
         * Cold's body colour in every realm; its spray, light, and the Sand
         * crater below do vary.
         * @type {Record<string, {value:any}>}
         */
        this.realmUniforms = {
            uRealmAbsorb: { value: new THREE.Vector3() },
            uRealmScatter0: { value: new THREE.Vector3() },
            uRealmScatter1: { value: new THREE.Vector3() },
            uRealmBody: { value: new THREE.Vector3() },
            uRealmFoam: { value: new THREE.Vector3() },
            uRealmGrain: { value: new THREE.Vector3() },
            uRealmLitTint: { value: new THREE.Vector3() },
            uRealmEmissive: { value: new THREE.Vector3() },
            /** (roughness, translucency 0..1, emissiveMaskPow, opacity bias) */
            uRealmSurface: { value: new THREE.Vector4() },
        };

        /** @type {"cold"|"sand"|"ash"} */
        this.realm = "cold";

        this.water = new WaterBody(scene, sky, shadows, this.lights, this.globals,
            this.realmUniforms);
        this.crystals = new CrystalField(scene, sky, shadows, this.lights, this.globals);

        /** @type {SpellContext} */
        this.ctx = {
            controller,
            figure: figure || null,
            rig,
            terrain,
            deform: terrain && terrain.deform ? terrain.deform : null,
            spray: spray || null,
            water: this.water,
            crystals: this.crystals,
            lights: this.lights,
            // Filled in immediately below — the spells hold the ctx by
            // reference, so assigning after construction is fine and keeps
            // the Dart's own ctx.realm read (dart.js:213) from ever seeing
            // undefined.
            bolt: null,
            realm: REALM_PALETTE.cold,
            time: 0,
            sprayScale: 1,
            handPosition: (which, out, off) => this._handPosition(which, out, off),
        };

        /**
         * The primary bolt (internal id 6). Constructed BEFORE the other
         * spells because two of them reach for it: the Ash Sweep throws a
         * carrier head through this pool, and `spellHits` walks it directly.
         */
        this.bolt = new Dart(
            this.ctx, scene, sky, shadows, this.lights,
            this.globals, this.realmUniforms
        );
        this.ctx.bolt = this.bolt;

        /**
         * The impact shockwave rings (vfx/shockwave.js) — visual only, spawned
         * by polling the bolt pool's one-frame impact flags after the spells
         * have updated. Owned here because this is the file that knows the
         * update order those flags depend on.
         */
        this.shockwave = new ShockwaveRings(scene, this.globals);

        this.sweep = new Sweep(this.ctx);
        this.ribbon = new Ribbon(this.ctx);
        this.bloom = new Bloom(this.ctx);
        this.crystallize = new Crystallize(this.ctx);
        this.vortex = new Vortex(this.ctx);

        /**
         * THE SPELL ARRAY. The bolt has to be in here or `_cancelAll()` and
         * `activeCount` skip it — a cancelled spell must take its volumes with
         * it (spellHits §9.2), and a pool of live projectiles is a volume.
         */
        this.spells = [
            this.sweep, this.ribbon, this.bloom, this.crystallize,
            this.vortex, this.bolt,
        ];

        /**
         * Materials outside the spell system that shade with the spell lights.
         *
         * Pushed rather than pulled, because the pool is only complete once every
         * spell has declared and that is later in the frame than any of these
         * systems runs. Registering them here keeps "who is lit by a spell" a
         * single list in one file instead of an `apply()` call scattered across
         * five unrelated update methods.
         * @type {{uniforms?: Record<string, {value:any}>}[]}
         */
        this._consumers = [];

        /** Aim direction, refreshed each frame from the rig. */
        this.aim = new THREE.Vector3(0, 0, 1);
        /** 0..1 eased: how far into a casting stance the figure should be. */
        this.castBlend = 0;
        this._lastCast = -99;
        this._time = 0;
        /** The idle palm-to-palm water strand (spell-2 renderer). */
        this.handWeave = new HandWeave(this.ctx);
        /** The one scheduled cast (key 0 = none) — see _schedule/_drainPending. */
        this._pending = { key: 0, t: 0, a0: 0, a1: 0, a2: 0 };
        /** Console override for the Ribbon hold. */
        this.debugRibbon = false;
        /** Console/harness override for the LMB bolt hold — the harness cannot
         *  forge pointer lock, so it cannot dispatch a real `mousedown`. */
        this.debugBolt = false;
        /** @type {{flashMana(): void}|null} set by main.js — deny feedback. */
        this.hud = null;
        /**
         * Cooldown expiry per spell key, in `_time` seconds. Key 6 is present
         * and permanently 0 — harmless, because `cooldownFrac` early-outs on
         * `!COOLDOWN[key]` before it ever reads this, so the toolbar never
         * renders a wipe on the primary.
         */
        this._cdUntil = { 1: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        /**
         * The bolt's next legal fire time, in `_time` seconds. NOT a cooldown:
         * it is the 0.45 s FIRE CYCLE, which is a rate limit on a spell whose
         * cooldown is zero, and it is deliberately kept out of `_cdUntil` /
         * `COOLDOWN` so nothing renders it as a cooling spell.
         */
        this._boltNext = 0;

        /**
         * FROST ARC cast edge (cold LMB). `arcGen` bumps once per arc cast;
         * `combat/spellHits.js` polls it and resolves the cone against the
         * registry the same frame (main.js order: spells -> registry ->
         * spellHits). Origin, ground height and flat direction are captured
         * at the cast — the aim can move on before the pass runs.
         */
        this.arcGen = 0;
        this.arcX = 0; this.arcZ = 0; this.arcY = 0;
        this.arcDirX = 0; this.arcDirZ = 1;

        this._camera = rig && rig.camera ? rig.camera : null;

        // Cold is the shipped look, and `setRealm` early-outs on an unchanged
        // realm — so seed the uniform block explicitly here rather than
        // relying on a swap that will never happen in a Cold-only build.
        this._writeRealm(REALM_PALETTE.cold);
    }

    /**
     * Declare a material that includes `lib/spellLights`.
     *
     * Harmless on a material that already shares `spellUniforms`: the copy is
     * skipped by identity.
     * @param {...{uniforms?: Record<string, {value:any}>}} mats
     */
    addConsumers(...mats) {
        for (let i = 0; i < mats.length; i++) {
            const m = mats[i];
            if (!m || this._consumers.indexOf(m) >= 0) continue;
            // Install the pool's uniform boxes if the material has none of its
            // own, which must happen before its program is first built.
            this.lights.bind(m);
            this._consumers.push(m);
        }
    }

    /**
     * Override the camera the water/crystal materials build `uViewProj` from.
     * Defaults to `rig.camera`, which is the beauty camera; pass the same object
     * `renderer.render()` gets, after any TAA jitter has been frozen for the
     * frame, so the spell meshes land on the same subpixel as everything else.
     * @param {THREE.Camera} camera
     */
    setCamera(camera) {
        this._camera = camera || null;
    }

    /** The three meshes `gfx.warmUp()` must force a draw through. */
    get warmUpMeshes() {
        return [
            this.water.mesh, this.crystals.mesh, this.bolt.mesh,
            this.shockwave.mesh,
        ];
    }

    /**
     * Where a hand is, in world space.
     *
     * Falls back to a point in front of the chest when the figure is hidden, so a
     * spell cast with the character switched off still comes from somewhere
     * sensible rather than from the origin. Only the Ribbon calls this, and it
     * always asks for hand 1 (right).
     *
     * PORT FRAME: `controller.js` defines forward = (sin f, 0, -cos f) and
     * right = (cos f, 0, sin f), which is Three's right-handed Y-up world. The
     * reference's fallback is written for its own frame — forward (sin f, cos f),
     * lateral (cos f, -sin f) — so both Z components are negated here relative to
     * `_spec/spells.md` §1.6. The offsets themselves (0.35 m forward, +/-0.28 m
     * lateral, 1.25 m up) are unchanged.
     */
    _handPosition(which, out, off) {
        const fig = this.ctx.figure;
        if (fig && S.showCharacter !== false) {
            fig.handPosition(which, out, off);
            return;
        }
        const ch = this.ctx.controller;
        const f = ch.facing;
        const fx = Math.sin(f);
        const fz = -Math.cos(f);           // port frame: forward
        const sx = Math.cos(f);
        const sz = Math.sin(f);            // port frame: right
        const side = which === 0 ? -0.28 : 0.28;
        out[off] = ch.position.x + fx * 0.35 + sx * side;
        out[off + 1] = ch.position.y + 1.25;
        out[off + 2] = ch.position.z + fz * 0.35 + sz * side;
    }

    /**
     * @param {number} dt
     * @param {THREE.Vector3} cameraPos
     * @param {THREE.Camera} [camera] overrides `setCamera` for this frame only
     */
    update(dt, cameraPos, camera) {
        const ctx = this.ctx;
        this._time += dt;
        ctx.time = this._time;
        ctx.sprayScale = S.spellSpray;
        this.lights.scale = S.spellLight;

        // --- shared globals ---------------------------------------------------
        const cam = camera || this._camera;
        const g = this.globals;
        if (cameraPos) g.uCameraPos.value.copy(cameraPos);
        else if (cam) g.uCameraPos.value.copy(cam.position);
        if (cam) {
            _viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
            g.uViewProj.value.copy(_viewProj);
        }
        g.uTime.value = this._time;

        // Aim comes off the rig rather than the character: the player points with
        // the camera, and the figure turns to follow.
        this.aim.copy(ctx.rig.forward);

        this.lights.begin();

        if (S.showSpells !== false) this._dispatch();
        else this._cancelAll();
        this._drainPending();

        for (let i = 0; i < this.spells.length; i++) this.spells[i].update(dt);

        // After the bolt has updated (its impact flags are fresh for exactly
        // this frame), before anything renders. Reading the flags consumes
        // nothing — dart.js clears them itself next frame.
        this.shockwave.update(dt, this.bolt, ctx);

        // The casting stance eases in while anything is up and out again after.
        // Nothing about it is a switch.
        const casting =
            this.ribbon.active || this._time - this._lastCast < 0.55 ? 1 : 0;
        this.castBlend = expDamp(this.castBlend, casting, casting ? 7.0 : 3.2, dt);
        const ch = ctx.controller;
        ch.cast = this.castBlend;
        ch.castAimX = this.aim.x;
        ch.castAimY = this.aim.y;
        ch.castAimZ = this.aim.z;

        // --- idle water play --------------------------------------------------
        // The rider toying with a live strand of water between the palms
        // (owner ask 2026-08-05, "like spell 2" — the first droplet pass read
        // as snow). Spell 2's own tube renderer; ribbon-held suppresses it so
        // the two never fight over the hands.
        const ifx = (ch.idleFx || 0) * (this.ribbon.held ? 0 : 1);
        this.handWeave.update(dt, ifx);

        // The stream pays as it flows: drain while held, release on empty.
        if (this.ribbon.held) {
            ch.mana = Math.max(0, ch.mana - RIBBON_DRAIN * dt);
            if (ch.mana <= 0) this.holdRibbon(false);
        }

        // Everything that answers a spell light, after the LAST declaration and
        // before anything renders.
        this.lights.commit();
        for (let i = 0; i < this._consumers.length; i++) {
            this.lights.apply(this._consumers[i]);
        }

        this.water.update(dt, g.uCameraPos.value);
        this.crystals.update(dt, g.uCameraPos.value);
    }

    _dispatch() {
        // Ribbon is a hold, so it is POLLED rather than edge-triggered.
        // `debugRibbon` lets the console hold it without synthesising a key event
        // — the poll would otherwise release it on the very next frame.
        // The WRITER of `spellHeld2` moved from LMB to Digit1 with the
        // 2026-08-08 remap; this read is unchanged, and so is the flag's name,
        // because it carries INTERNAL id 2 and every harness pin uses it.
        this.holdRibbon(input.spellHeld2 || this.debugRibbon);
        const key = input.spellPressed;
        if (key && key !== 2) this.cast(key);

        // THE BOLT AUTO-REPEATS. LMB down fires one immediately through the
        // `spellPressed` edge above (input.js writes 6 on mousedown); holding
        // it fires another every `BOLT_CYCLE`. Polled, not edge-triggered, for
        // exactly the reason the ribbon is: an edge only arrives once.
        // `cast()` owns the rate limit, so a spammed edge cannot beat the
        // cycle and this call cannot double-fire on the press frame.
        if (input.boltHeld || this.debugBolt) this.cast(BOLT_KEY);
    }

    /**
     * Cast one spell, by key. `SNOWFLOW.spells.cast(n)` is the console and
     * harness handle, which is why this is separated from the input poll.
     *
     * TIMING (owner 2026-08-05: "animation goes a little BEFORE the spell —
     * they should be same time"): the keypress starts the character's cast
     * clip and CAPTURES the aim, but the spell itself fires when the clip's
     * hands strike — STRIKE_DELAY below, measured per clip as the peak-hand-
     * speed moment divided by the clip's play rate (meshChar CAST_RATE).
     * Aim is captured at the press because that is the player's intent; the
     * strike releases what they aimed.
     *
     * THE BOLT (key 6) IS THE ONE EXCEPTION TO THE STRIKE DELAY, and it is not
     * an oversight. `STRIKE_DELAY[6]` is 0 because the muzzle IS the hand:
     * there is no travel from a wind-up pose to a release point to wait for.
     * More concretely, the shortest cast clip's measured strike is 0.66 s
     * (CL_CAST3 at rate 1.25) and the fire cycle is 0.45 s, so a scheduled
     * bolt would fall permanently behind its own stream. It therefore bypasses
     * `_schedule` entirely rather than sharing the single `_pending` slot with
     * a Vortex wind-up.
     * @param {number} key 1..6
     */
    cast(key) {
        const ctx = this.ctx;
        const rig = ctx.rig;

        // Spell unlock gate (progression §7): a locked key does nothing at
        // all — no wind-up, no spend. `unlocked` is progression's live Set
        // of INTERNAL ids, pushed once at attach (identity is stable).
        //
        // The BOLT and the ARC are exempt. They are the never-locked filler
        // pair (COMBAT_DESIGN §0; owner 2026-08-12 put the arc on key 1),
        // and progression's UNLOCK_LEVEL table stops at id 5 — an
        // unexempted gate would disable them for the whole game.
        // `ui/spellbar.js` exempts them identically.
        if (key !== BOLT_KEY && key !== ARC_KEY &&
            this.unlocked && !this.unlocked.has(key)) return;

        if (key === 2) {
            this.holdRibbon(true);
            return;
        }

        if (key === BOLT_KEY) {
            // The fire-cycle rate limit, checked before anything is spent or
            // animated, so a held button and a spammed edge produce the same
            // 2.2 shots a second.
            if (this._time < this._boltNext) return;
            this._boltNext = this._time + BOLT_CYCLE;
            this._lastCast = this._time;
            // Reuse the one-handed magic clip (engine key 3 -> CL_CAST3).
            // meshChar has no row for key 6 yet; writing 6 would fall through
            // its `?? CL_CAST` default onto the TWO-handed clip, which owns
            // the whole body while standing and would re-trigger 2.2 times a
            // second. See the report for the one-line meshChar addition that
            // replaces this with a proper additive-layer row.
            ctx.controller.castWave = 3;
            // LMB is ALWAYS the bolt again (owner 2026-08-12: "LMB was fine
            // as a bolt" — the arc moved to ARC_KEY below; the palette's
            // boltArc flag is retired from this path).
            this._fireBolt();
            return;
        }

        if (key === ARC_KEY) {
            // The FROST ARC on hotkey 1 (owner 2026-08-12). Free like the
            // bolt — the filler pair shares the no-mana economy — but an
            // AoE that slows cannot be strobed, so it runs a real cooldown
            // through the same `_cdUntil` map the toolbar wipes read.
            if (this._time < (this._cdUntil[ARC_KEY] || 0)) return;
            this._cdUntil[ARC_KEY] = this._time + ARC_COOLDOWN;
            this._lastCast = this._time;
            ctx.controller.castWave = 3;
            this._fireArc();
            return;
        }

        // Cooldown gate first (a cooling spell costs nothing to ask for),
        // then the mana gate: a cast the pool cannot pay never starts — no
        // wind-up, no scheduled fire — and the HUD's mana bar flashes.
        if (this._time < (this._cdUntil[key] || 0)) return;
        const cost = MANA_COST[key] || 0;
        const c = ctx.controller;
        if (c.mana < cost) {
            if (this.hud) this.hud.flashMana();
            return;
        }
        c.mana -= cost;
        this._cdUntil[key] = this._time + (COOLDOWN[key] || 0);

        this._lastCast = this._time;
        // The rider winds up NOW; the flag carries the key so meshChar picks
        // the right clip (1 = 2H attack, 3 = 1H throw, 4 = area slam,
        // 5 = channel). Consumed in meshChar._step.
        ctx.controller.castWave = key;

        if (key === 1) {
            // FLAT aim: the crescent runs along the ground, so a camera pointed at
            // the sky must not launch it into the air. Captured at press.
            const fl = Math.hypot(this.aim.x, this.aim.z) || 1;
            this._schedule(key, this.aim.x / fl, 0, this.aim.z / fl);
            return;
        }

        if (key === 3 || key === 4) {
            // Both are placed where the player is looking, and the ray starts at
            // the EYE, so what the spell hits is exactly what is under the centre
            // of the screen — the only targeting rule that needs no explanation and
            // no reticle.
            //
            // Capped at 22 m of ray, not the 40 the terrain could answer for.
            // Looking out across a dune field the first surface the ray meets is
            // often forty metres away on the next ridge, and a Bloom that goes off
            // over there is an effect the player has to squint at. Beyond the cap
            // the spell lands at the 13 m fallback instead, which is always in
            // front of them and always at a size worth looking at.
            const eye = rig.camera.position;
            aimPoint(
                _aim, ctx.terrain,
                eye.x, eye.y, eye.z,
                this.aim.x, this.aim.y, this.aim.z,
                22, 13
            );
            this._schedule(key, _aim[0], _aim[1], _aim[2]);
            return;
        }

        if (key === 5) {
            this._schedule(key, 0, 0, 0);
        }
    }

    /**
     * Spawn one bolt at the hand, heading at the crosshair's point.
     *
     * The aim is an EYE RAY against the terrain, capped at the bolt's own 40 m
     * leash with an 18 m fallback (`combatData.js` SPELLS.LMB), so what the
     * bolt flies at is exactly what is under the centre of the screen — the
     * same targeting rule Bloom and Crystallize use, with a longer cap because
     * a projectile is allowed to reach the next ridge.
     *
     * The muzzle is the RIGHT HAND, through the same `_handPosition` the
     * Ribbon uses, so the bolt leaves the character rather than the camera.
     * Allocation: none — `_aim` and `_hand` are module-scope scratch.
     * @param {number} [own] 0 = damaging primary, 1 = a carrier that only draws
     * @param {number} [sizeMul] multiplies the realm's bolt length and width
     * @param {number} [range] metres of leash; defaults to the bolt's own
     * @returns {number} the pool slot, or -1 when the pool is full
     */
    _fireBolt(own, sizeMul, range) {
        const ctx = this.ctx;
        const eye = ctx.rig.camera.position;
        aimPoint(
            _aim, ctx.terrain,
            eye.x, eye.y, eye.z,
            this.aim.x, this.aim.y, this.aim.z,
            BOLT_RANGE, BOLT_FALLBACK
        );
        this._handPosition(1, _hand, 0);

        let dx = _aim[0] - _hand[0];
        let dy = _aim[1] - _hand[1];
        let dz = _aim[2] - _hand[2];
        const l = Math.hypot(dx, dy, dz);
        if (l < 1e-4) {
            // Degenerate only if the aim point landed inside the hand. Fall
            // back to the flat facing rather than firing a zero-length bolt,
            // which would terminate on the ground on its first frame.
            dx = this.aim.x; dy = 0; dz = this.aim.z;
            const fl = Math.hypot(dx, dz) || 1;
            dx /= fl; dz /= fl;
        } else {
            dx /= l; dy /= l; dz /= l;
        }

        return this.bolt.fire(
            _hand[0], _hand[1], _hand[2],
            dx, dy, dz,
            BOLT_SPEED, range || BOLT_RANGE, own || 0, sizeMul || 1
        );
    }

    /**
     * The cold FROST ARC (owner redesign 2026-08-11): one forgiving frontal
     * cone instead of a projectile that whiffed at exact aim (QA
     * `_harness/qa_dart.py`: 1.84 hp landed of ~60 over five dead-on casts).
     *
     * Three things happen on the cast edge, all through existing machinery:
     *
     *   HIT VOLUME  recorded here (`arcGen`/`arcX..DirZ`), resolved by
     *               `spellHits._frostArc()` via the registry's own
     *               `forEachInCone` — the wave's precedent. Damage, chill and
     *               the 40% slow live in `combatData.bolt.arc`.
     *   VISUAL      a fan of ARC_FAN carrier darts (`own = 1` — they draw,
     *               trail, flash and burst, never damage; dart.js docblock).
     *               The existing pool: at 8 m reach a fan is gone in 0.38 s,
     *               so two casts in flight is 10 of the 12 slots, no steal.
     *   GROUND      an ice-glaze sector painted along the arc through the
     *               deform ice channel — crystallize's own brush recipe,
     *               thinned (15 brushes, well under the 96/frame cap). SSR
     *               picks the glaze up as the frozen-ground read.
     *
     * The aim is FLATTENED like the wave's: the arc is a ground fan and a
     * sky-pointed camera must not lift the hit cone. Allocation: none —
     * scalars and the module scratch only.
     */
    _fireArc() {
        const ctx = this.ctx;
        const ch = ctx.controller;
        let ax = this.aim.x, az = this.aim.z;
        const fl = Math.hypot(ax, az) || 1;
        ax /= fl; az /= fl;

        this.arcX = ch.position.x;
        this.arcZ = ch.position.z;
        this.arcY = ch.position.y;
        this.arcDirX = ax; this.arcDirZ = az;
        this.arcGen = (this.arcGen + 1) | 0;

        // The visual fan, spread over the inner 80% of the cone. A slight
        // droop lands the tips near the glaze they painted.
        this._handPosition(1, _hand, 0);
        for (let k = 0; k < ARC_FAN; k++) {
            const off = (k / (ARC_FAN - 1) - 0.5) * 2 * ARC_HALF * 0.8;
            const c = Math.cos(off), s = Math.sin(off);
            this.bolt.fire(
                _hand[0], _hand[1], _hand[2],
                ax * c - az * s, -0.06, ax * s + az * c,
                BOLT_SPEED, ARC_REACH, 1, 0.85
            );
        }

        // The ground freeze: three rings of elongated glaze brushes fanned
        // across the sector. `ice` is realm-scaled exactly like crystallize's
        // (cold glazes fully; the flag is cold-only today, but the scale
        // keeps the recipe realm-correct if that ever changes).
        const f = ctx.deform;
        if (f) {
            const R = ctx.realm;
            for (let ring = 0; ring < 3; ring++) {
                const r = 2.0 + ring * 2.3;            // 2.0 / 4.3 / 6.6 m
                const n = 3 + ring * 2;                // 3 / 5 / 7 brushes
                for (let k = 0; k < n; k++) {
                    const a = (k / (n - 1) - 0.5) * 2 * ARC_HALF * 0.85;
                    const c = Math.cos(a), s = Math.sin(a);
                    const dx = ax * c - az * s;
                    const dz = ax * s + az * c;
                    f.brush(
                        this.arcX + dx * r, this.arcZ + dz * r,
                        1.15, 0.03, 0.02, 0.6, 0.9 * R.ice,
                        Math.atan2(dz, dx), 1.7, 0.7
                    );
                }
            }
        }
    }

    /**
     * Queue a spell to fire at its clip's strike moment. Slots, not an
     * array: casts are rare edges and the drain is allocation-free.
     * @param {number} key @param {number} a0 @param {number} a1 @param {number} a2
     */
    _schedule(key, a0, a1, a2) {
        const p = this._pending;
        p.key = key;
        p.t = this._time + (STRIKE_DELAY[key] || 0);
        p.a0 = a0; p.a1 = a1; p.a2 = a2;
    }

    /** Fire whatever scheduled cast has reached its strike moment. */
    _drainPending() {
        const p = this._pending;
        if (!p.key || this._time < p.t) return;
        const key = p.key;
        p.key = 0;
        const rig = this.ctx.rig;
        if (key === 1) {
            this.sweep.trigger(p.a0, p.a2);
            rig.addTrauma(0.12);
        } else if (key === 3) {
            this.bloom.trigger(p.a0, p.a1, p.a2);
        } else if (key === 4) {
            this.crystallize.trigger(p.a0, p.a1, p.a2);
        } else if (key === 5) {
            this.vortex.trigger();
            rig.addTrauma(0.10);
        }
    }

    /**
     * Remaining cooldown for a spell key, as {frac 0..1, secs}. frac 1 =
     * just cast, 0 = ready. The toolbar polls this per frame.
     * @param {number} key
     * @returns {number} remaining fraction of the full cooldown
     */
    cooldownFrac(key) {
        const total = COOLDOWN[key];
        if (!total) return 0;
        const left = (this._cdUntil[key] || 0) - this._time;
        return left <= 0 ? 0 : Math.min(1, left / total);
    }

    /** Remaining cooldown seconds for a key (0 when ready). @param {number} key */
    cooldownLeft(key) {
        const left = (this._cdUntil[key] || 0) - this._time;
        return left <= 0 ? 0 : left;
    }

    /**
     * THE REALM SWAP — the eighteen identities, in one call.
     *
     * Costs, and all three are assertable from a probe:
     *   programs compiled   ZERO. Every target is a preallocated `{value}` box
     *                       the linked programs already sample at draw time.
     *   draw calls added    ZERO. Nothing is created, hidden or shown here.
     *   allocation          ZERO. Every destination is a preallocated
     *                       Vector3/Vector4 written through `.set()`, and every
     *                       source is a frozen module-scope literal.
     *
     * What actually changes is split in two, and the split is the whole trick:
     * the GPU half is the uniform block, and the CPU half is a swapped
     * reference on `ctx.realm` that the six spells read every frame for
     * arguments they were passing anyway — `water.setParams`'s milkiness,
     * `lights.add`'s rgb, `spray.emit`'s kind/drag/life, `deform.brush`'s ice
     * channel. Nothing in the palette is a gameplay number (owner directive 4:
     * the mechanic is constant, the fiction changes), which is exactly what a
     * probe asserts by casting the same spell in all three realms against a
     * pinned dummy and comparing damage, poise, CC type and CC duration.
     *
     * @param {"cold"|"sand"|"ash"} name
     * @returns {boolean} true if the realm changed
     */
    setRealm(name) {
        const p = REALM_PALETTE[name];
        if (!p || name === this.realm) return false;
        this.realm = name;
        this._writeRealm(p);
        return true;
    }

    /**
     * Write one palette row into the uniform block and fan it out.
     * Separated from `setRealm` only so the constructor can seed Cold without
     * tripping the "already in this realm" early-out.
     * @param {typeof REALM_PALETTE.cold} p
     */
    _writeRealm(p) {
        const u = this.realmUniforms;
        u.uRealmAbsorb.value.set(p.absorb[0], p.absorb[1], p.absorb[2]);
        u.uRealmScatter0.value.set(p.scatter0[0], p.scatter0[1], p.scatter0[2]);
        u.uRealmScatter1.value.set(p.scatter1[0], p.scatter1[1], p.scatter1[2]);
        u.uRealmBody.value.set(p.body[0], p.body[1], p.body[2]);
        u.uRealmFoam.value.set(p.foam[0], p.foam[1], p.foam[2]);
        u.uRealmGrain.value.set(p.grain[0], p.grain[1], p.grain[2]);
        u.uRealmLitTint.value.set(p.litTint[0], p.litTint[1], p.litTint[2]);
        u.uRealmEmissive.value.set(p.emissive[0], p.emissive[1], p.emissive[2]);
        u.uRealmSurface.value.set(
            p.surface[0], p.surface[1], p.surface[2], p.surface[3]
        );

        // The CPU half: one reference swap, and every spell picks it up on its
        // next frame because they all read `ctx.realm` rather than caching it.
        this.ctx.realm = p;
        // Two spells carry per-object state that a swap has to reach —
        // the bolt pool's per-slot geometry, and any spell holding a
        // realm-derived value across frames. Everything else is a live read.
        for (let i = 0; i < this.spells.length; i++) {
            const s = this.spells[i];
            if (s.setRealm) s.setRealm(p);
        }
    }

    /** @param {boolean} held */
    holdRibbon(held) {
        if (held && this.unlocked && !this.unlocked.has(2)) return;
        if (held) {
            if (!this.ribbon.held) {
                this.ribbon.trigger();
                this._lastCast = this._time;
            }
        } else if (this.ribbon.held) {
            this.ribbon.release();
        }
    }

    _cancelAll() {
        for (let i = 0; i < this.spells.length; i++) this.spells[i].cancel();
    }

    /** Live spell count, for the overlay. */
    get activeCount() {
        let n = 0;
        for (let i = 0; i < this.spells.length; i++) if (this.spells[i].active) n++;
        return n;
    }

    /**
     * Register the ice formations with the depth prepass.
     *
     * ONLY the crystals: the water body is translucent and refractive, so a depth
     * for it would tell every screen-space consumer that the snow behind it is not
     * there — exactly wrong for a medium you can see through.
     *
     * @param {import("../render/depthPass.js").DepthPass} depth
     */
    registerPrepass(depth) {
        this.crystals.registerPrepass(depth);
    }

    get triangles() {
        return this.water.triangles + this.crystals.triangles
             + this.bolt.triangles;
    }

    /**
     * Stand real geometry up in both meshes so the warm-up frames actually
     * rasterise water and ice.
     *
     * The first cast of any spell must not hitch, and this is the only thing
     * standing between that and a multi-hundred-millisecond freeze the first time
     * somebody presses 3. Both water profiles and the ice material are exercised
     * with real geometry — a pipeline compiled against an empty draw is a warm-up
     * that quietly covers nothing.
     *
     * Call before `gfx.warmUp(renderer, scene, camera, spells.warmUpMeshes)`, and
     * `finishWarmUp()` after the warm frames have drawn.
     */
    warmUp(x, y, z) {
        this.water.warmUp(x, y, z);
        this.crystals.warmUp(x, y, z);
        // The bolt pays the same price if it is skipped: the blend/depth/
        // target-format combination only binds when a triangle actually goes
        // through it, and without this the first LMB press pays for the
        // pipeline specialisation.
        this.bolt.warmUp(x, y, z);
    }

    /**
     * Clear the warm-up geometry. Called after the warm-up frames, not inside
     * `warmUp` — the whole point is that those frames draw it.
     */
    finishWarmUp() {
        this.water.finishWarmUp();
        this.crystals.finishWarmUp();
        this.bolt.finishWarmUp();
    }

    dispose() {
        this.water.dispose();
        this.crystals.dispose();
        this.bolt.dispose();
    }
}
