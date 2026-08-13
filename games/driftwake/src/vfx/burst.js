/**
 * The impact burst pool — the CPU half of `shaders/burst.glsl.js`.
 *
 * Six dissolving shells in one mesh, one draw, one upload of 96 floats. A
 * shell is spawned explicitly by the three spells that detonate — the wave
 * crescent's ignition (`sweep._ignite`, which in Ash is the fireball's
 * landing), the bloom's burst instant and the spikes' plant — through
 * `ctx.fx.burst`, the way those same sites already write their craters: the
 * detonation is an edge the spell owns, not a state anything can poll.
 *
 * REALM TINTS come from the palette row the caller passes (`ctx.realm`): the
 * core colour is the bolt flash row squared (the shockwave pool's saturation
 * trick — additive pastel over white snow is invisible), the deep colour is
 * the scatter0 row squared, and the two mode parameters are `ice` (FROST
 * plates) and "does the emissive row glow" (the FIRE tear-line), all times
 * `light.mult` so ash detonations are the brightest of the three.
 *
 * Technique adapted under MIT from LinearAbiltyCastingThreeJS
 * (src/effects/BurstSphere.js) — attribution in the shader file and
 * CREDITS.md.
 *
 * Allocation per frame: none.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { rand } from "../spells/bending.js";
import { vertex, fragment } from "../shaders/burst.glsl.js";

/** Pool size — must match the uniform arrays in shaders/burst.glsl.js. */
export const BURST_MAX = 6;

export class ImpactBursts {
    /**
     * @param {THREE.Scene} scene
     * @param {Record<string, {value:any}>} globals the `lib/common` block
     */
    constructor(scene, globals) {
        /** (x, y, z, age01) per shell — age01 1 = dead. THE uniform storage. */
        this.a = new Float32Array(BURST_MAX * 4);
        /** (endRadius, coreR, coreG, coreB). */
        this.b = new Float32Array(BURST_MAX * 4);
        /** (seed, plates, ember, squash). */
        this.c = new Float32Array(BURST_MAX * 4);
        /** (deepR, deepG, deepB, startRadius). */
        this.d = new Float32Array(BURST_MAX * 4);
        this.age = new Float32Array(BURST_MAX);
        this.life = new Float32Array(BURST_MAX);
        this.alive = new Uint8Array(BURST_MAX);
        this._next = 0;
        /** Probe/A-B switch: false collapses the pool without touching state. */
        this.enabled = true;
        /** Live counters for the harness — fields mutated, never reallocated. */
        this.stats = { active: 0, draws: 0 };

        for (let i = 0; i < BURST_MAX; i++) this.a[i * 4 + 3] = 1;

        // Six icospheres in one BufferGeometry; each vertex carries its shell
        // index and fetches state from the uniform arrays. IcosahedronGeometry
        // is non-indexed in r172; the guard keeps this correct if that ever
        // changes upstream. Detail 3 (1280 faces): at 2 the displaced shell
        // shows its facet edges as hard creases (verified on the first
        // fx_burst_cold.png); 6 x 1280 faces is still one cheap draw.
        const srcGeo = new THREE.IcosahedronGeometry(1, 3);
        const src = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo;
        const sp = src.getAttribute("position");
        const sn = src.getAttribute("normal");
        const vcount = sp.count;

        const pos = new Float32Array(BURST_MAX * vcount * 3);
        const nrm = new Float32Array(BURST_MAX * vcount * 3);
        const shellIdx = new Float32Array(BURST_MAX * vcount);
        for (let i = 0; i < BURST_MAX; i++) {
            pos.set(sp.array, i * vcount * 3);
            nrm.set(sn.array, i * vcount * 3);
            shellIdx.fill(i, i * vcount, (i + 1) * vcount);
        }
        srcGeo.dispose();

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        this.geometry.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
        this.geometry.setAttribute("aShell", new THREE.BufferAttribute(shellIdx, 1));

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            uniforms: Object.assign({}, globals, {
                uBurstA: { value: this.a },
                uBurstB: { value: this.b },
                uBurstC: { value: this.c },
                uBurstD: { value: this.d },
            }),
            // Additive shell of light, no depth write — overlapping shells sum,
            // and a detonation front is not a surface.
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "spellBursts";
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 3;     // over the ground fx band
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    /**
     * Start one shell, realm-tinted. Overwrites the oldest slot when full.
     * @param {number} x @param {number} y @param {number} z world centre
     * @param {number} endRadius metres at end of life
     * @param {number} life seconds
     * @param {number} squash vertical scale (< 1 = ground dome)
     * @param {typeof import("../spells/spellSystem.js").REALM_PALETTE.cold} realm
     */
    spawn(x, y, z, endRadius, life, squash, realm) {
        const i = this._next;
        this._next = (i + 1) % BURST_MAX;

        this.age[i] = 0;
        this.life[i] = Math.max(0.05, life);
        this.alive[i] = 1;

        const p = realm.bolt;
        const m = realm.light.mult;
        const s0 = realm.scatter0;
        const o = i * 4;
        this.a[o + 0] = x;
        this.a[o + 1] = y;
        this.a[o + 2] = z;
        this.a[o + 3] = 0;
        // Channel-squared, the shockwave pool's saturation trick; the shader's
        // 2.1 gain compensates the lost energy.
        this.b[o + 0] = endRadius;
        this.b[o + 1] = p.flashR * p.flashR * m;
        this.b[o + 2] = p.flashG * p.flashG * m;
        this.b[o + 3] = p.flashB * p.flashB * m;
        this.c[o + 0] = rand() * 10;
        this.c[o + 1] = realm.ice;                       // FROST plates
        this.c[o + 2] = realm.emissive[0] > 0 ? 1 : 0;   // FIRE tear-line
        this.c[o + 3] = squash;
        this.d[o + 0] = s0[0] * s0[0] * m;
        this.d[o + 1] = s0[1] * s0[1] * m;
        this.d[o + 2] = s0[2] * s0[2] * m;
        this.d[o + 3] = endRadius * 0.16;
    }

    /** Age the pool. Call once per frame, before anything renders. */
    update(dt) {
        let live = 0;
        for (let i = 0; i < BURST_MAX; i++) {
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
        this.mesh.visible =
            live > 0 && this.enabled && S.showSpells !== false;
        this.stats.active = live;
        this.stats.draws = this.mesh.visible ? 1 : 0;
    }

    /** Kill every shell. */
    clear() {
        for (let i = 0; i < BURST_MAX; i++) {
            this.alive[i] = 0;
            this.a[i * 4 + 3] = 1;
        }
        this.mesh.visible = false;
        this.stats.active = 0;
        this.stats.draws = 0;
    }
}
