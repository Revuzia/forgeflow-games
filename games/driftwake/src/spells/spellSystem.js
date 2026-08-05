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
        /** Idle water-play emission accumulator + hand alternator. */
        this._idleFxOwed = 0;
        this._idleFxAlt = false;
        /** Console override for the Ribbon hold. */
        this.debugRibbon = false;

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
        // The hand-wave idle (Standing Idle 03) reads as the rider toying with
        // water in the palms (owner ask 2026-08-05, "like spell 2"): a thin
        // swirl of droplets orbiting each hand, gated by meshChar's idle
        // blend so it fades with the first step and never shows mid-spell.
        const ifx = (ch.idleFx || 0) * (this.castBlend > 0.4 ? 0 : 1);
        if (ifx > 0.3 && ctx.spray) {
            this._idleFxOwed += dt * 46 * ifx * ctx.sprayScale;
            while (this._idleFxOwed >= 1) {
                this._idleFxOwed -= 1;
                const hand = this._idleFxAlt ? 1 : 0;
                this._idleFxAlt = !this._idleFxAlt;
                this._handPosition(hand, _aim, 0);
                const th = this._time * 5.2 + hand * Math.PI;
                const r = 0.10 + 0.05 * Math.sin(this._time * 2.3 + hand);
                ctx.spray.emit(
                    _aim[0] + Math.cos(th) * r,
                    _aim[1] + 0.04 + 0.05 * Math.sin(th * 2),
                    _aim[2] + Math.sin(th) * r,
                    // Tangential drift: the swirl reads as held water, not a leak.
                    -Math.sin(th) * 0.55,
                    0.22 + 0.18 * Math.sin(th * 3),
                    Math.cos(th) * 0.55,
                    0.014 + 0.016 * ((th * 7.13) % 1),
                    0.35 + 0.3 * ((th * 3.71) % 1),
                    1,      // water droplet
                    0.85    // high drag: it hangs, it does not spray away
                );
            }
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
     * Fire one spell, by key. `SNOWFLOW.spells.cast(n)` is the console and harness
     * handle, which is why this is separated from the input poll.
     * @param {number} key 1..5
     */
    cast(key) {
        const ctx = this.ctx;
        const rig = ctx.rig;

        if (key === 2) {
            this.holdRibbon(true);
            return;
        }

        this._lastCast = this._time;

        if (key === 1) {
            // FLAT aim: the crescent runs along the ground, so a camera pointed at
            // the sky must not launch it into the air.
            const fl = Math.hypot(this.aim.x, this.aim.z) || 1;
            this.sweep.trigger(this.aim.x / fl, this.aim.z / fl);
            // The mesh rider answers with the 2H Magic Attack (owner ask
            // 2026-08-05); one-frame flag, consumed by meshChar._step.
            ctx.controller.castWave = true;
            rig.addTrauma(0.12);
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
            if (key === 3) this.bloom.trigger(_aim[0], _aim[1], _aim[2]);
            else this.crystallize.trigger(_aim[0], _aim[1], _aim[2]);
            return;
        }

        if (key === 5) {
            this.vortex.trigger();
            rig.addTrauma(0.10);
        }
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
