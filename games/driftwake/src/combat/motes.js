/**
 * Health motes — the kill-drop heal economy (COMBAT_DESIGN §1.4, PROGRESSION
 * §7 item 1: "+10% of player max HP; fodder 35% / elite 100% drop").
 *
 * A pooled set of small glowing orbs, ONE draw for the whole pool: the
 * burst.js upload pattern exactly — per-mote state in one vec4 uniform array,
 * every orb a low-detail icosphere in one BufferGeometry, a dead mote
 * collapsed to zero radius in the vertex stage. RawShaderMaterial + GLSL3 +
 * the lib/common globals block; no Three lights, no stock materials.
 *
 * FEED — the registry event ring, drained READ-ONLY the way floaters.js
 * drains it (polled once per frame AFTER every damage source has run and
 * BEFORE `registry.endFrame()` clears the ring). Kill events only; dummy
 * kills drop nothing (the XP rule, same reason).
 *
 * DROP TABLE — spec numbers where the spec has them, lane fallbacks where it
 * does not (flagged):
 *   fodder/light/medium   35% chance x1   (spec anchor: "fodder 35%")
 *   heavy/elite           100% x2         (spec anchor: "elite 100%"; the x2
 *                                          count is the lane brief's — the
 *                                          spec gives chances, not counts)
 *   boss                  nothing automatic — the boss encounter calls
 *                         `motes.spawnAt(x, z, 8)` on its own death edge.
 * The 35% roll is ERROR-DIFFUSED (an accumulator, not a random draw): every
 * fodder kill banks 0.35 and a mote drops each time the bank crosses 1. The
 * realised rate converges exactly on the spec rate, deterministically — no
 * Math.random on the frame path, and no unlucky streak in a short fight.
 *
 * HEAL — +10% of player max HP on pickup (progression doc §7 redefinition:
 * exactly +10 at the L10 anchor; the lane brief's 6% was the spec-missing
 * fallback and the spec has the number, so the spec wins). Pickup rings
 * `sfx.trigger("pickup_mote", ...)` — the EVENTS row lives in audio/sfx.js.
 *
 * MOTION — CPU integrates drift only: a mote rests at hover height over its
 * drop point and, inside 4 m, eases toward the player's chest, faster the
 * closer it gets. The hover-bob and the pulse are shader-side off `uTime`
 * and a position-hashed phase — deterministic, and zero CPU writes for a
 * mote nobody is walking toward. Despawn 20 s.
 *
 * Allocation per frame: none.
 */

import * as THREE from "three";

import { shader } from "../core/glsl.js";
import { sfx } from "../audio/sfx.js";
import { TIER } from "./damageable.js";

/** Pool size — must match the uniform array literal in the shaders below. */
export const MOTE_MAX = 24;

/** Seconds a mote lives on the ground. */
const LIFE_S = 20;
/** Drop chance for fodder/light/medium kills (spec: "fodder 35%"). */
const DROP_FODDER = 0.35;
/** Motes per heavy/elite kill (spec: "elite 100%"; count from lane brief). */
const HEAVY_COUNT = 2;
/** Heal fraction of max HP per mote (progression doc §7: +10% max HP). */
const HEAL_FRAC = 0.10;
/** Drift-toward-player radius, m. */
const DRIFT_R = 4.0;
/** Consumption radius, m — measured to the player's chest point. */
const PICKUP_R = 0.85;
/** Rest height of the orb centre above the ground. */
const HOVER_M = 0.55;

const vertex = /* glsl */`
#include "lib/common"

in vec3 position;               // unit icosphere
in vec3 normal;
in float aMote;

uniform vec4 uMoteA[24];        // (x, y, z, age01) — age01 >= 1 = dead

out vec3 vNrm;
out vec3 vView;
out float vAge;
out float vSeed;

void main() {
    int i = int(aMote);
    vec4 A = uMoteA[i];
    float live = A.w < 1.0 ? 1.0 : 0.0;

    // Deterministic per-mote phase, hashed off the drop position — no CPU
    // seed upload, and two motes from one kill still bob out of step.
    float seed = fract(A.x * 0.1371 + A.z * 0.2917) * 6.28318;
    vSeed = seed;

    // Hover-bob + a slow breathing pulse, both off uTime — game-time driven,
    // so a freeze frame freezes them with everything else.
    float bob = sin(uTime * 2.1 + seed) * 0.09;
    float pulse = 1.0 + 0.10 * sin(uTime * 4.7 + seed * 2.0);
    // Spawn pop: the first ~0.25 s of the 20 s life scales the orb in.
    float pop = smoothstep(0.0, 0.012, A.w);
    float R = 0.16 * live * pulse * pop;

    vec3 world = A.xyz + vec3(0.0, bob, 0.0) + position * R;

    vNrm = normal;
    vView = uCameraPos - world;
    vAge = A.w;

    gl_Position = uViewProj * vec4(world, 1.0);
}
`;

const fragment = /* glsl */`
#include "lib/common"

in vec3 vNrm;
in vec3 vView;
in float vAge;
in float vSeed;

layout(location = 0) out vec4 outColor;

void main() {
    vec3 N = normalize(vNrm);
    vec3 V = normalize(vView);
    float fres = pow(1.0 - abs(dot(N, V)), 1.8);

    // The health colour language: a warm vital green-gold core with a
    // brighter rim — deliberately NOT realm-tinted, so a heal reads as a
    // heal in cold, sand and ash alike (the HUD's ember bar logic).
    vec3 core = vec3(0.45, 1.00, 0.42);
    vec3 rim  = vec3(0.85, 1.00, 0.55);
    vec3 col = mix(core, rim, fres);

    // Last 15% of life: fade + an urgency blink, exactly the pickup-item
    // grammar players already know.
    float late = smoothstep(0.85, 1.0, vAge);
    float blink = 1.0 - late * (0.5 + 0.5 * sin(uTime * 14.0 + vSeed));
    float fade = (1.0 - late * 0.6) * blink;

    float alpha = (0.30 + fres * 0.70) * fade;
    if (alpha < 0.004) discard;

    // Additive: the orb is a point of light over snow, not a surface.
    outColor = vec4(col * 1.6 * fade, saturate(alpha));
}
`;

export class HealthMotes {
    /**
     * @param {THREE.Scene} scene
     * @param {import("./damageable.js").DamageableRegistry} registry
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {import("../terrain/terrain.js").Terrain} terrain heightAt owner
     * @param {Record<string, {value:any}>} globals the `lib/common` block
     */
    constructor(scene, registry, controller, terrain, globals) {
        this.registry = registry;
        this.controller = controller;
        this.terrain = terrain;

        /** Probe/A-B switch: false stops spawns and hides the pool. */
        this.enabled = true;
        /** Live counters for the harness — mutated, never reallocated. */
        this.stats = { active: 0, spawned: 0, picked: 0, healed: 0 };

        // ---- pool SoA -----------------------------------------------------
        this.x = new Float32Array(MOTE_MAX);
        this.y = new Float32Array(MOTE_MAX);
        this.z = new Float32Array(MOTE_MAX);
        this.age = new Float32Array(MOTE_MAX);
        this.alive = new Uint8Array(MOTE_MAX);
        this._next = 0;

        /** The 35% error-diffusion bank (header: deterministic drop rate). */
        this._acc = 0;
        /** Deterministic scatter counter for multi-mote drops. */
        this._seed = 0x2f6e2b1 | 0;
        /** Retained scratch for `terrain.clampToPlayArea` (mutates in place) —
         *  a literal here would allocate on every drop. */
        this._clampV = { x: 0, z: 0 };

        /** (x, y, z, age01) per mote — THE uniform storage. */
        this.a = new Float32Array(MOTE_MAX * 4);
        for (let i = 0; i < MOTE_MAX; i++) this.a[i * 4 + 3] = 1;

        // ---- one mesh, one draw (burst.js lattice pattern) ---------------
        // Detail 1 (80 faces) is plenty for a 16 cm orb: 24 x 80 faces, one
        // cheap additive draw that never depends on how many motes are live.
        const srcGeo = new THREE.IcosahedronGeometry(1, 1);
        const src = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo;
        const sp = src.getAttribute("position");
        const sn = src.getAttribute("normal");
        const vcount = sp.count;

        const pos = new Float32Array(MOTE_MAX * vcount * 3);
        const nrm = new Float32Array(MOTE_MAX * vcount * 3);
        const idxA = new Float32Array(MOTE_MAX * vcount);
        for (let i = 0; i < MOTE_MAX; i++) {
            pos.set(sp.array, i * vcount * 3);
            nrm.set(sn.array, i * vcount * 3);
            idxA.fill(i, i * vcount, (i + 1) * vcount);
        }
        srcGeo.dispose();

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        this.geometry.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
        this.geometry.setAttribute("aMote", new THREE.BufferAttribute(idxA, 1));

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            uniforms: Object.assign({}, globals, {
                uMoteA: { value: this.a },
            }),
            // A floating point of light: additive, no depth write, so two
            // motes from one kill sum instead of sorting.
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "healthMotes";
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 3;     // with the bursts, over the ground fx
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    /**
     * Drop `n` motes around a world point — the boss hook (`spawnAt(x, z, 8)`
     * on the boss death edge) and the internal drop path share it. Positions
     * scatter on a deterministic hashed ring so an 8-mote boss payout reads
     * as a burst, not a stack, and every one of them is clamped into the
     * playable disc (see the clamp below) so a kill at the storm wall cannot
     * throw the payout somewhere the player is not allowed to go.
     * @param {number} x @param {number} z @param {number} n
     * @returns {void}
     */
    spawnAt(x, z, n) {
        if (!this.enabled) return;
        for (let k = 0; k < n; k++) {
            // LCG-hashed scatter — deterministic, allocation-free.
            this._seed = (Math.imul(this._seed, 1664525) + 1013904223) | 0;
            const u = ((this._seed >>> 9) & 1023) / 1023;
            this._seed = (Math.imul(this._seed, 1664525) + 1013904223) | 0;
            const v = ((this._seed >>> 9) & 1023) / 1023;
            const r = n > 1 ? 0.35 + v * 0.55 : 0;
            // CLAMP TO THE PLAY DISC. The caller's point is not guaranteed to
            // be reachable: the boss hook drops 8 motes wherever the boss
            // died, and main.js clamps the PLAYER to `terrain.playRadius`
            // (620 m) every frame — so a boss killed against the storm wall
            // scattered its whole payout outside the wall, where the player
            // is shoved back from and can never follow. Clamping through the
            // terrain's own clamp (the single source of truth for the edge,
            // the same call the character goes through) puts every drop
            // somewhere the player can actually stand. The ground height is
            // sampled AFTER the clamp so the orb hovers over real terrain.
            const cv = this._clampV;
            cv.x = x + Math.cos(u * 6.28318) * r;
            cv.z = z + Math.sin(u * 6.28318) * r;
            this.terrain.clampToPlayArea(cv);
            const px = cv.x;
            const pz = cv.z;

            const i = this._next;
            this._next = (i + 1) % MOTE_MAX;
            this.x[i] = px;
            this.y[i] = this.terrain.heightAt(px, pz) + HOVER_M;
            this.z[i] = pz;
            this.age[i] = 0;
            this.alive[i] = 1;
            this.stats.spawned++;
        }
    }

    /**
     * One frame: drain this frame's kill events into drops, integrate drift
     * and pickup, upload the pool. Runs AFTER every damage source and BEFORE
     * `registry.endFrame()` (main.js placement), read-only on the ring —
     * the floaters contract. `dt === 0` (freeze) drops nothing and moves
     * nothing, but keeps the upload path warm.
     * @param {number} dt
     * @returns {void}
     */
    update(dt) {
        const reg = this.registry;

        // ---- feed: the kill events ---------------------------------------
        if (dt > 0 && this.enabled) {
            const n = reg.eventCount;
            for (let e = 0; e < n; e++) {
                if (reg.evType[e] !== 1) continue;          // kills only
                if (reg.evKind[e] === "dummy") continue;    // the XP rule
                const tier = reg.evTier[e];
                if (tier === TIER.BOSS) continue;           // boss = laneB hook
                if (tier >= TIER.HEAVY) {
                    this.spawnAt(reg.evX[e], reg.evZ[e], HEAVY_COUNT);
                } else {
                    this._acc += DROP_FODDER;
                    if (this._acc >= 1) {
                        this._acc -= 1;
                        this.spawnAt(reg.evX[e], reg.evZ[e], 1);
                    }
                }
            }
        }

        // ---- integrate ----------------------------------------------------
        const ch = this.controller;
        const px = ch.position.x;
        const py = ch.position.y + 0.9;    // the chest point
        const pz = ch.position.z;
        let live = 0;

        for (let i = 0; i < MOTE_MAX; i++) {
            if (!this.alive[i]) continue;
            if (dt > 0) {
                this.age[i] += dt;
                if (this.age[i] >= LIFE_S) {
                    this.alive[i] = 0;
                    this.a[i * 4 + 3] = 1;
                    continue;
                }

                const dx = px - this.x[i];
                const dy = py - this.y[i];
                const dz = pz - this.z[i];
                const d = Math.hypot(dx, dy, dz);

                // [INTEGRATOR] `ch.health > 0` — a corpse does not pick up.
                // Without it a mote CANCELS a death outright, and not as a
                // corner case: this pass runs at main.js:~936 (the registry
                // drain window it must sit in), while progression's death
                // check — `if (!this.dead && c.health <= 0)` — does not run
                // until ~965. A mote inside PICKUP_R at the instant health
                // reaches 0 therefore heals the player back above 0 BEFORE
                // anything tests for death, and the death silently never
                // latches. The boss payout drops 8 motes at the player's
                // feet, so this was the standard end of every boss fight,
                // not an edge. Measured before the guard (qa_integration A3):
                // health forced to 0, `P.dead` never latched, +16.2 hp
                // healed, peak 16/54.
                //
                // The guard keeps the GOOD case intact — at 1 hp a mote
                // still saves you, which is the drop economy working — and
                // only refuses the resurrection. It also covers the 1.5 s
                // knockdown fade, where health is 0 and healing is meaningless
                // because `_respawn()` refills the pools anyway.
                if (d < PICKUP_R && ch.health > 0) {
                    // The heal: +10% max HP, clamped at full (§1.4).
                    const heal = ch.healthMax * HEAL_FRAC;
                    const before = ch.health;
                    ch.health = Math.min(ch.healthMax, ch.health + heal);
                    this.stats.healed += ch.health - before;
                    this.stats.picked++;
                    this.alive[i] = 0;
                    this.a[i * 4 + 3] = 1;
                    // The pickup cue — audio/sfx.js EVENTS."pickup_mote", a
                    // rising chime under a bright airy tick. World-placed, so
                    // it attenuates like every other combat event (at pickup
                    // range that is unity, which is the point: a heal you
                    // walked into should read at full level).
                    sfx.trigger("pickup_mote", this.x[i], this.y[i], this.z[i]);
                    continue;
                }
                if (d < DRIFT_R) {
                    // Ease toward the chest, faster the closer it gets —
                    // quadratic so the last metre feels magnetic.
                    const k = 1 - d / DRIFT_R;
                    const step = Math.min((1.2 + 7.5 * k * k) * dt, d);
                    this.x[i] += (dx / d) * step;
                    this.y[i] += (dy / d) * step;
                    this.z[i] += (dz / d) * step;
                }
            }

            const o = i * 4;
            this.a[o] = this.x[i];
            this.a[o + 1] = this.y[i];
            this.a[o + 2] = this.z[i];
            this.a[o + 3] = this.age[i] / LIFE_S;
            live++;
        }

        this.stats.active = live;
        this.mesh.visible = live > 0 && this.enabled;
    }

    /** Kill every mote (realm change, probe reset). */
    clear() {
        for (let i = 0; i < MOTE_MAX; i++) {
            this.alive[i] = 0;
            this.a[i * 4 + 3] = 1;
        }
        this.mesh.visible = false;
        this.stats.active = 0;
    }

    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.geometry.dispose();
        this.material.dispose();
    }
}
