/**
 * The impact shockwave pool — the CPU half of `shaders/shockwave.glsl.js`.
 *
 * Eight rings in one mesh, one draw, one uniform upload of 64 floats. A ring is
 * spawned by polling `Dart.impact[]` after the spells have updated — the same
 * one-frame flags `combat/spellHits.js` reads, and reading them here consumes
 * nothing: `dart.js` clears them itself at the top of its next update.
 *
 * WHAT GETS A RING. Ground impacts only: a bolt that terminated within 35 cm of
 * the terrain under it, which covers every LMB splash and — because the Ash
 * fireball's carrier head flies through this same pool and terminates on
 * landing — the fireball detonation, at fireball scale. A leash-end fizzle in
 * mid-air stays ringless (a ground ring under empty air is a lie), and an
 * enemy hit already has the enemy itself to carry the read.
 *
 * WHY IT DOES NOT DECLARE A LIGHT. The impact already does — `dart.js` declares
 * the flash light for 0.12 s, capped so it never evicts a Vortex. The ring
 * rides under that flash in the same colour (`realm.bolt.flashR/G/B`), so the
 * two read as one event and the 4-slot pool is left exactly as it was.
 *
 * Technique adapted under MIT from LinearAbiltyCastingThreeJS — attribution
 * and the shape of the adaptation are in the shader file and CREDITS.md.
 *
 * Allocation per frame: none.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { vertex, fragment } from "../shaders/shockwave.glsl.js";

/** Pool size — must match the uniform arrays in shaders/shockwave.glsl.js. */
export const RING_MAX = 8;

/** A bolt must die within this height of the ground to leave a ring, metres. */
const GROUND_EPS = 0.35;
/** Rings sit this far above the terrain so they never z-fight the snow. */
const LIFT = 0.06;

/**
 * Splash ring for a size-1 bolt: reach (m) and life (s). The ring scales
 * CONTINUOUSLY with the projectile's own `size` (dart.js retains the fired
 * `sizeMul` per slot), so a Frost Arc fan dart (0.85) leaves a modest crackle,
 * a plain bolt (1.0) a full splash, and the Ash fireball's head (2.2) a
 * detonation front — one rule, no carrier special-case to fall out of date.
 */
const BOLT_RADIUS = 1.6;
const BOLT_LIFE = 0.42;

export class ShockwaveRings {
    /**
     * @param {THREE.Scene} scene
     * @param {Record<string, {value:any}>} globals the `lib/common` block
     */
    constructor(scene, globals) {
        /** (x, y, z, age01) per ring — age01 1 = dead. THE uniform storage. */
        this.a = new Float32Array(RING_MAX * 4);
        /** (endRadius, r, g, b) per ring. */
        this.b = new Float32Array(RING_MAX * 4);
        /** Seconds alive / seconds to live, per ring. */
        this.age = new Float32Array(RING_MAX);
        this.life = new Float32Array(RING_MAX);
        this.alive = new Uint8Array(RING_MAX);
        this._next = 0;
        this.liveCount = 0;

        // Everything starts dead, and dead means age01 = 1 in the shader.
        for (let i = 0; i < RING_MAX; i++) this.a[i * 4 + 3] = 1;

        // One quad per ring; each vertex is (ringIndex, cornerIndex, 0) and the
        // vertex stage does the rest — the dart's data-driven pattern, with
        // uniform arrays instead of a data texture because 8 x 2 vec4 fits.
        const pos = new Float32Array(RING_MAX * 4 * 3);
        const idx = new Uint16Array(RING_MAX * 6);
        for (let i = 0; i < RING_MAX; i++) {
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
                uRingA: { value: this.a },
                uRingB: { value: this.b },
            }),
            // Additive over the snow, no depth write — a pressure front is
            // light, not a surface, and eight overlapping rings must sum.
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "spellShockwaves";
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;     // with the water/spray band, over terrain
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    /**
     * Start a ring. Overwrites the oldest slot when the pool is full — eight
     * simultaneous ground impacts means the ninth is on top of one anyway.
     * @param {number} x @param {number} y @param {number} z world, y ON ground
     * @param {number} endRadius metres the front reaches at the end of life
     * @param {number} life seconds
     * @param {number} r @param {number} g @param {number} b linear tint
     */
    spawn(x, y, z, endRadius, life, r, g, b) {
        const i = this._next;
        this._next = (i + 1) % RING_MAX;

        this.age[i] = 0;
        this.life[i] = Math.max(0.05, life);
        this.alive[i] = 1;

        const o = i * 4;
        this.a[o + 0] = x;
        this.a[o + 1] = y + LIFT;
        this.a[o + 2] = z;
        this.a[o + 3] = 0;
        this.b[o + 0] = endRadius;
        this.b[o + 1] = r;
        this.b[o + 2] = g;
        this.b[o + 3] = b;
    }

    /**
     * Age the pool and poll the bolt pool for fresh ground impacts. Call after
     * the spells have updated (their impact flags are set) and before anything
     * renders.
     * @param {number} dt
     * @param {import("../spells/dart.js").Dart|null} bolt
     * @param {import("../spells/spellSystem.js").SpellContext|null} ctx
     */
    update(dt, bolt, ctx) {
        if (bolt && ctx) {
            const n = bolt.impact.length;
            for (let i = 0; i < n; i++) {
                if (!bolt.impact[i]) continue;
                const gy = ctx.terrain.heightAt(bolt.x[i], bolt.z[i]);
                if (bolt.y[i] - gy > GROUND_EPS) continue;   // died in the air
                const size = bolt.size[i] || 1;
                const p = ctx.realm.bolt;
                // The flash colour, squared per channel: same hue family as
                // the impact light the ring rides under, but saturated —
                // additive pastel over white snow is invisible, and the
                // shader's intensity constant compensates the lost energy.
                this.spawn(
                    bolt.x[i], gy, bolt.z[i],
                    BOLT_RADIUS * size,
                    BOLT_LIFE * Math.sqrt(size),
                    p.flashR * p.flashR, p.flashG * p.flashG, p.flashB * p.flashB
                );
            }
        }

        let live = 0;
        for (let i = 0; i < RING_MAX; i++) {
            if (!this.alive[i]) continue;
            this.age[i] += dt;
            const t = this.age[i] / this.life[i];
            if (t >= 1) {
                this.alive[i] = 0;
                this.a[i * 4 + 3] = 1;
                continue;
            }
            this.a[i * 4 + 3] = t;
            live++;
        }
        this.liveCount = live;

        // Three re-reads the arrays at draw time; nothing to flag dirty. The
        // mesh only draws while something is live, like the bolt pool.
        this.mesh.visible = live > 0 && S.showSpells !== false;
    }

    /** Kill every ring — the spell system's realm swap / cancel path. */
    clear() {
        for (let i = 0; i < RING_MAX; i++) {
            this.alive[i] = 0;
            this.a[i * 4 + 3] = 1;
        }
        this.liveCount = 0;
        this.mesh.visible = false;
    }
}
