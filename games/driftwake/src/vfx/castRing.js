/**
 * The player cast-ring pool — the CPU half of `shaders/castring.glsl.js`.
 *
 * Watches the spell system's single scheduled-cast slot (`_pending`) and draws
 * the AoE promise for the two casts that HAVE a ground footprint:
 *
 *   key 3 (Bloom)    at the CAPTURED TARGET (`_pending.a0..a2` — where the
 *                    eruption will actually land), radius = the eruption's
 *                    tested one-shot sphere, `combatData.bloom.burstRadius`.
 *   key 5 (Vortex)   under the PLAYER, following them (it is their vortex),
 *                    radius = the DoT ring's full reach — the 3.1 m ceiling
 *                    `vortex.js _strip` grows `this.ring` to and
 *                    `spellHits._vortex` tests against. `combatData.vortex`
 *                    transcribes `_strip`'s clocks but not this radius, so it
 *                    is transcribed here the way spellSystem.js transcribes
 *                    BOLT_CYCLE — kept in step by hand.
 *
 * The ring grows in over the clip's windup (reveal eased outCubic) and on the
 * release edge SNAPS OUT — radius overshoots on `sin(pi * t^1.7)` and settles
 * while the ring flashes white and fades — the reference indicator's
 * signature move. All curves run here; the shader is dumb.
 *
 * Pool of two: the schedule slot holds ONE pending cast, so the second slot
 * only ever carries the release tail of the previous ring under a fast
 * recast.
 *
 * Technique adapted under MIT from LinearAbiltyCastingThreeJS
 * (src/effects/AimIndicator.js, ZoneIndicator.js) — attribution in the
 * shader file and CREDITS.md. Allocation per frame: none.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { combatData } from "../combat/combatData.js";
import { vertex, fragment } from "../shaders/castring.glsl.js";

/** Pool size — must match the uniform arrays in shaders/castring.glsl.js. */
export const CAST_MAX = 2;

/** Rings sit this far above the terrain so they never z-fight the snow. */
const LIFT = 0.07;
/** Seconds the release snap-out lives. */
const RELEASE_S = 0.42;
/**
 * The vortex DoT ring's full reach, metres — `vortex.js _strip`'s
 * `Math.min(3.1, ...)` ceiling, the radius `spellHits._vortex` tests
 * (`vx.ring + reg.radius`). Transcribed by hand; see the docblock.
 */
const VORTEX_RING_M = 3.1;

export class CastRing {
    /**
     * @param {THREE.Scene} scene
     * @param {Record<string, {value:any}>} globals the `lib/common` block
     */
    constructor(scene, globals) {
        /** (x, y, z, alpha01) — alpha < 0 = dead. THE uniform storage. */
        this.a = new Float32Array(CAST_MAX * 4);
        /** (drawnRadius, r, g, b). */
        this.b = new Float32Array(CAST_MAX * 4);
        /** (hot, seed, baseRadius, 0). */
        this.c = new Float32Array(CAST_MAX * 4);
        /** Per-slot CPU state: 0 free, 1 winding, 2 releasing. */
        this.phase = new Uint8Array(CAST_MAX);
        this.release = new Float32Array(CAST_MAX);
        this._live = -1;      // slot of the CURRENT winding ring
        this._penKey = 0;     // pending key being tracked
        this._penT = 0;       // its strike time, to spot a fresh schedule
        this._total = 1;      // seconds of windup, captured at first sight
        this.enabled = true;
        this.stats = { active: 0, draws: 0 };

        for (let i = 0; i < CAST_MAX; i++) this.a[i * 4 + 3] = -1;

        const pos = new Float32Array(CAST_MAX * 4 * 3);
        const idx = new Uint16Array(CAST_MAX * 6);
        for (let i = 0; i < CAST_MAX; i++) {
            for (let v = 0; v < 4; v++) {
                pos[(i * 4 + v) * 3 + 0] = i;
                pos[(i * 4 + v) * 3 + 1] = v;
            }
            const o = i * 4;
            idx[i * 6 + 0] = o;
            idx[i * 6 + 1] = o + 1;
            idx[i * 6 + 2] = o + 2;
            idx[i * 6 + 3] = o;
            idx[i * 6 + 4] = o + 2;
            idx[i * 6 + 5] = o + 3;
        }
        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        this.geometry.setIndex(new THREE.BufferAttribute(idx, 1));

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            uniforms: Object.assign({}, globals, {
                uCastA: { value: this.a },
                uCastB: { value: this.b },
                uCastC: { value: this.c },
            }),
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "spellCastRings";
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    /**
     * Track the schedule slot and age the release tails. Call from
     * `SpellSystem.update`, AFTER `_drainPending` so the release edge is seen
     * the frame it fires.
     * @param {number} dt
     * @param {import("../spells/spellSystem.js").SpellSystem} sp
     */
    update(dt, sp) {
        const p = sp._pending;
        const ctx = sp.ctx;

        // ---- the winding ring ---------------------------------------------
        if ((p.key === 3 || p.key === 5) && this.enabled) {
            if (this._penKey !== p.key || this._penT !== p.t) {
                // Fresh schedule: claim a slot (prefer a free one, else steal
                // the older release tail).
                let s = -1;
                for (let i = 0; i < CAST_MAX; i++) {
                    if (this.phase[i] === 0) { s = i; break; }
                }
                if (s < 0) s = this._live === 0 ? 1 : 0;
                this._live = s;
                this._penKey = p.key;
                this._penT = p.t;
                this._total = Math.max(0.05, p.t - sp._time);
                this.phase[s] = 1;
                this.c[s * 4 + 1] = (p.t % 1);   // seed: desyncs two sweeps
            }
            const s = this._live;
            const o = s * 4;
            const R = p.key === 3
                ? combatData.bloom.burstRadius
                : VORTEX_RING_M;
            const reveal = Math.min(
                1, Math.max(0, 1 - (p.t - sp._time) / this._total)
            );
            const ease = 1 - Math.pow(1 - reveal, 3);         // outCubic
            let x, z;
            if (p.key === 3) { x = p.a0; z = p.a2; }
            else {
                x = ctx.controller.position.x;
                z = ctx.controller.position.z;
            }
            this.a[o + 0] = x;
            this.a[o + 1] = ctx.terrain.heightAt(x, z) + LIFT;
            this.a[o + 2] = z;
            this.a[o + 3] = 0.25 + 0.75 * reveal;             // fade-in gate
            const t = ctx.realm.bolt;
            this.b[o + 0] = Math.max(0.05, R * ease);
            this.b[o + 1] = t.flashR * t.flashR;
            this.b[o + 2] = t.flashG * t.flashG;
            this.b[o + 3] = t.flashB * t.flashB;
            this.c[o + 0] = 0;
            this.c[o + 2] = R;
        } else if (this._penKey) {
            // Release edge — the drain fired (or the pending was replaced by
            // a key with no footprint). Snap the live ring out where it stood.
            const s = this._live;
            if (s >= 0 && this.phase[s] === 1) {
                this.phase[s] = 2;
                this.release[s] = 0;
            }
            this._penKey = 0;
            this._live = -1;
        }

        // ---- the release tails --------------------------------------------
        let live = 0;
        for (let i = 0; i < CAST_MAX; i++) {
            if (this.phase[i] === 0) { this.a[i * 4 + 3] = -1; continue; }
            if (this.phase[i] === 2) {
                this.release[i] += dt / RELEASE_S;
                const rel = this.release[i];
                if (rel >= 1) {
                    this.phase[i] = 0;
                    this.a[i * 4 + 3] = -1;
                    continue;
                }
                const o = i * 4;
                const R = this.c[o + 2];
                // The snap-out: overshoot on sin(pi * t^1.7), dead at 1.
                const bump = Math.sin(Math.PI * Math.pow(rel, 1.7));
                this.b[o + 0] = R * (1 + 0.16 * bump);
                this.a[o + 3] = 1 - rel;
                this.c[o + 0] = bump;                          // the flash
            }
            live++;
        }

        this.mesh.visible =
            live > 0 && this.enabled && S.showSpells !== false;
        this.stats.active = live;
        this.stats.draws = this.mesh.visible ? 1 : 0;
    }

    /** Kill every ring and forget the tracked schedule. */
    clear() {
        for (let i = 0; i < CAST_MAX; i++) {
            this.phase[i] = 0;
            this.a[i * 4 + 3] = -1;
        }
        this._penKey = 0;
        this._live = -1;
        this.mesh.visible = false;
        this.stats.active = 0;
        this.stats.draws = 0;
    }
}
