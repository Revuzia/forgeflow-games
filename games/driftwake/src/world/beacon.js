/**
 * THE WAYPOINT BEACON — the world-space light column at the tracked target
 * (_spec/QUEST_DESIGN.md §7a). "Ghost of Tsushima: a guiding element IN THE
 * WORLD, not just a HUD arrow, points the way."
 *
 * Listens to the quest engine's 'quest:waypoint' event ({x, z, realm, label}
 * or null to clear) and stands a column of realm-tinted ice-light on the
 * ground there: crystal-family colour (the shrine / portal derivation —
 * REALM_PALETTE arcInk, luma-normalised — in the halo, ice-white in the core),
 * rising bands, a bright pool at the foot. Visible to 400 m, faded out inside
 * 15 m so a rider arriving at the target is not blinded by it. Beyond ~115 m
 * it keeps a roughly constant ~0.9 deg angular width (never narrower than
 * 1.8 m nearer in), so it reads as the same mark at 120 m and at 400 m. Its
 * emission is in DISPLAY units (BEACON_GAIN / S.exposure — see
 * shaders/worldact.glsl.js EMISSION), measured in the live page at 200 m and
 * 380 m (qa_worldact.py --stage visual).
 *
 * A waypoint in ANOTHER realm is held but not drawn until that realm is live
 * (the quest engine may point across a portal). The foot is grounded from
 * `terrain.heightAt` on a new waypoint, on a realm swap and whenever
 * `terrain.rebakeCount` moves, so a realm re-bake under a standing waypoint
 * cannot leave it floating — and a steady frame samples nothing.
 *
 * ONE draw while a waypoint is live in this realm, ZERO otherwise
 * (`mesh.visible = false`). No shadow, no depth write (additive light).
 *
 * `set(wp)` / `clear()` are the direct API (the probe uses them); the bus
 * event is the production path. If the quest engine emitted its first
 * waypoint before this beacon subscribed, call `set()` once with its current
 * waypoint (see the lane report).
 *
 * Steady-frame allocation: none.
 */

import * as THREE from "three";

import { shader } from "../core/glsl.js";
import { realmToken } from "./realms.js";
import { bus as coreBus } from "../quests/events.js";
import { realmTint } from "./caches.js";
import {
    beaconVertex, beaconFragment, BEACON_ROWS, REF_EXPOSURE, emissionGain,
} from "../shaders/worldact.glsl.js";

/** QUEST §7a. */
export const BEACON_FAR = 400;
export const BEACON_NEAR = 15;
/** Column height, m. */
const BEACON_H = 110;
/** Frames between re-grounds when the terrain has no `rebakeCount`. */
const REGROUND_FALLBACK = 30;
/** Display-unit emission gain (worldact.glsl.js EMISSION). */
export const BEACON_GAIN = 1.0;

export class WaypointBeacon {
    /**
     * @param {object} ctx meaning-layer context: terrain, bus, spells
     *   (globals) or crystals, getRealm.
     */
    constructor(ctx) {
        this.ctx = ctx;
        this.terrain = ctx.terrain;
        this.bus = ctx.bus || coreBus;
        this.realm = realmToken(ctx.getRealm ? ctx.getRealm() : "cold");

        /** The held waypoint: x, z, realm (null = any), label; `on` = held. */
        this.target = { on: false, x: 0, z: 0, realm: null, label: "" };

        /** uBeaconA = (x, ground y, z, on 0/1), a Float32Array (three's
         *  uniform4fv path) written element-wise: per-frame double stores
         *  into a shared Vector4's fields boxed ~80 B/frame (measured). */
        this._a = { value: new Float32Array(4) };
        /** Re-ground bookkeeping (see update): `_grounded` false = sample the
         *  ground on the next frame; `_bake` = terrain.rebakeCount it was
         *  sampled against; `_groundIn` = frames to the next fallback
         *  re-ground for a terrain that exposes no bake counter. */
        this._grounded = false;
        this._bake = -1;
        this._groundIn = 0;
        this._tint = { value: new THREE.Vector3(0.5, 0.9, 1.6) };
        /** Emission gain in display units; the uniform is gain / S.exposure. */
        this.gain = BEACON_GAIN;
        this._gain = { value: emissionGain(this.gain, ctx.S) };
        const g = ctx.spells && ctx.spells.globals ? ctx.spells.globals
            : ctx.crystals.material.uniforms;
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(beaconVertex),
            fragmentShader: shader(beaconFragment),
            uniforms: {
                uCameraPos: g.uCameraPos, uViewProj: g.uViewProj, uTime: g.uTime,
                uBeaconA: this._a,
                uBeaconH: { value: BEACON_H },
                uBeaconFar: { value: BEACON_FAR },
                uBeaconNear: { value: BEACON_NEAR },
                uBeaconTint: this._tint,
                uBeaconGain: this._gain,
            },
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.mesh = new THREE.Mesh(buildRibbon(), this.material);
        this.mesh.name = "waypointBeacon";
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 3;
        this.mesh.visible = false;
        const scene = ctx.scene || (ctx.crystals && ctx.crystals.scene);
        scene.add(this.mesh);

        this._off = this.bus.on("quest:waypoint", (wp) => this.set(wp));
        this.setRealm(this.realm);
    }

    /**
     * Point the beacon (or clear it with null). The 'quest:waypoint' payload.
     * @param {{x:number, z:number, realm?:string, label?:string}|null} wp
     */
    set(wp) {
        const t = this.target;
        if (!wp || !Number.isFinite(+wp.x) || !Number.isFinite(+wp.z)) {
            t.on = false;
            this._a.value[3] = 0;
            this.mesh.visible = false;
            return;
        }
        t.on = true;
        t.x = +wp.x;
        t.z = +wp.z;
        t.realm = wp.realm ? realmToken(wp.realm) : null;
        t.label = wp.label || "";
        this._grounded = false;         // ground the new foot on the next frame
    }

    /** Clear the waypoint. */
    clear() { this.set(null); }

    /** Realm swap: re-tint. @param {string} token */
    setRealm(token) {
        this.realm = realmToken(token);
        const v = realmTint(this.realm, this._tint.value);
        // Halo hue: the realm's ink, lifted toward ice so it glows, not stains.
        v.set(0.30 + v.x * 0.45, 0.42 + v.y * 0.45, 0.60 + v.z * 0.45);
        this._grounded = false;
    }

    /** A column 40 m off (x, z) for the warm-up draws (inside the 15 m fade
     *  it would collapse and specialise nothing); undo with finishWarmUp().
     *  @param {number} x @param {number} z */
    warmUpSeed(x, z) {
        const a = this._a.value;
        a[0] = x + 40; a[1] = this.terrain.heightAt(x + 40, z); a[2] = z; a[3] = 1;
        this.mesh.visible = true;
    }

    finishWarmUp() {
        this._a.value[3] = 0;
        this.mesh.visible = false;   // the next update() re-derives it
        this._grounded = false;
    }

    /** Is the column drawing this frame? */
    get visible() { return this.mesh.visible; }
    get draws() { return this.mesh.visible ? 1 : 0; }
    get warmUpMeshes() { return [this.mesh]; }

    /** Horizontal distance from the camera to the held target (probe). */
    distanceFrom(x, z) {
        return Math.hypot(this.target.x - x, this.target.z - z);
    }

    /**
     * One frame: re-ground the foot and decide visibility. The fades
     * themselves run in the vertex stage off the camera. dt 0 (pause) is a
     * no-op — a paused frame keeps the column it had.
     * @param {number} dt @returns {void}
     */
    update(dt) {
        if (dt === 0) return;
        if (this.ctx.getRealm) {
            // EDGE-triggered: follow getRealm() only when IT changes. main.js
            // publishes its token after `await sky.solve()`, i.e. AFTER the
            // setRealm hooks ran -- a level test would flip back to the old realm.
            const live = this.ctx.getRealm();
            if (this._lastLive === undefined) this._lastLive = live;
            if (live !== this._lastLive) {
                this._lastLive = live;
                if (live && realmToken(live) !== this.realm) this.setRealm(live);
            }
        }
        const t = this.target;
        const a = this._a.value;
        const on = t.on && (t.realm === null || t.realm === this.realm);
        if (!on) {
            if (this.mesh.visible) this.mesh.visible = false;
            a[3] = 0;
            return;
        }
        // Re-ground the foot only when the answer can have changed: a new
        // waypoint, a realm swap, or a terrain re-bake (`terrain.rebakeCount`,
        // terrain.js). A terrain with no bake counter (a stub) is re-sampled
        // every REGROUND_FALLBACK frames. A steady frame samples nothing and
        // stores nothing: a per-frame heightAt boxed ~48 B (measured).
        const T = this.terrain;
        const bake = T.rebakeCount;
        let reground = !this._grounded;
        if (typeof bake === "number") {
            if (bake !== this._bake) { this._bake = bake; reground = true; }
        } else if (--this._groundIn <= 0) {
            reground = true;
        }
        if (reground) {
            a[0] = t.x;
            a[1] = T.heightAt(t.x, t.z) - 0.2;
            a[2] = t.z;
            this._grounded = true;
            this._groundIn = REGROUND_FALLBACK;
        }
        if (a[3] !== 1) a[3] = 1;
        // Display-unit emission at the live (realm-graded) exposure.
        const S = this.ctx.S;
        const gain = this.gain / (S && S.exposure > 0 ? S.exposure : REF_EXPOSURE);
        if (this._gain.value !== gain) this._gain.value = gain;
        if (!this.mesh.visible) this.mesh.visible = true;
    }

    dispose() {
        if (this._off) this._off();
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
    }
}

/** A vertical ribbon: 2 columns x (BEACON_ROWS + 1) rows, position = (u, v, 0). */
function buildRibbon() {
    const R = BEACON_ROWS;
    const pos = new Float32Array((R + 1) * 3 * 3);
    const idx = new Uint16Array(R * 2 * 6);
    let vi = 0;
    for (let r = 0; r <= R; r++) {
        // Rows packed toward the foot, where the pool and the core live.
        const v = Math.pow(r / R, 1.6);
        for (let c = 0; c < 3; c++) {
            pos[vi++] = c - 1; pos[vi++] = v; pos[vi++] = 0;
        }
    }
    let ii = 0;
    for (let r = 0; r < R; r++) {
        for (let c = 0; c < 2; c++) {
            const a = r * 3 + c, b = a + 1, d = a + 3, e = a + 4;
            idx[ii++] = a; idx[ii++] = b; idx[ii++] = e;
            idx[ii++] = a; idx[ii++] = e; idx[ii++] = d;
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}
