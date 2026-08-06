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
import { HandWeave } from "./handWeave.js";
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
 *   time: number,
 *   sprayScale: number,
 *   handPosition: (which:number, out:Float32Array, off:number) => void,
 * }} SpellContext
 */

const _aim = new Float32Array(3);
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
const STRIKE_DELAY = { 1: 0.71, 3: 0.66, 4: 0.95, 5: 0.98 };

/**
 * Mana costs (battle prep, owner 2026-08-05). PLACEHOLDERS pending the
 * combat design doc — the shape matters now (casts gate on mana, the HUD
 * shows the spend, the ribbon drains per second), the numbers come later.
 */
const MANA_COST = { 1: 12, 3: 14, 4: 16, 5: 26 };
const RIBBON_DRAIN = 7;   // per second while the stream is held

/**
 * Cooldowns, seconds — the combat design doc's numbers (wave 4, mini-vortex
 * 6, spikes 10, great vortex 14). The stream (LMB) has none: it is the
 * mana-drained channel. The toolbar renders these as radial wipes.
 */
const COOLDOWN = { 1: 4, 3: 6, 4: 10, 5: 14 };

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

        this.water = new WaterBody(scene, sky, shadows, this.lights, this.globals);
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
            time: 0,
            sprayScale: 1,
            handPosition: (which, out, off) => this._handPosition(which, out, off),
        };

        this.sweep = new Sweep(this.ctx);
        this.ribbon = new Ribbon(this.ctx);
        this.bloom = new Bloom(this.ctx);
        this.crystallize = new Crystallize(this.ctx);
        this.vortex = new Vortex(this.ctx);

        this.spells = [this.sweep, this.ribbon, this.bloom, this.crystallize, this.vortex];

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
        /** @type {{flashMana(): void}|null} set by main.js — deny feedback. */
        this.hud = null;
        /** Cooldown expiry per spell key, in `_time` seconds. */
        this._cdUntil = { 1: 0, 3: 0, 4: 0, 5: 0 };

        this._camera = rig && rig.camera ? rig.camera : null;
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

    /** The two meshes `gfx.warmUp()` must force a draw through. */
    get warmUpMeshes() {
        return [this.water.mesh, this.crystals.mesh];
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
        this.holdRibbon(input.spellHeld2 || this.debugRibbon);
        const key = input.spellPressed;
        if (key && key !== 2) this.cast(key);
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
     * @param {number} key 1..5
     */
    cast(key) {
        const ctx = this.ctx;
        const rig = ctx.rig;

        if (key === 2) {
            this.holdRibbon(true);
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

    /** @param {boolean} held */
    holdRibbon(held) {
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
        return this.water.triangles + this.crystals.triangles;
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
    }

    /**
     * Clear the warm-up geometry. Called after the warm-up frames, not inside
     * `warmUp` — the whole point is that those frames draw it.
     */
    finishWarmUp() {
        this.water.finishWarmUp();
        this.crystals.finishWarmUp();
    }

    dispose() {
        this.water.dispose();
        this.crystals.dispose();
    }
}
