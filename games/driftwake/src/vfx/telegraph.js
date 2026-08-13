/**
 * Enemy windup telegraph rings — the CPU half of `shaders/telegraph.glsl.js`.
 *
 * Eight rings in one mesh, one draw. Each frame the pool is refilled from
 * `enemies.js`'s live SoA state: any alive enemy whose windup flash has begun
 * (`flash > 0.05`) with a committed attack (`atk >= 0`) gets a ring at its
 * feet, radius = THE STRIKE TEST'S OWN NUMBER (`u.aRadius[atk] +
 * STRIKE_PAD_M`, the same `reach + MELEE_PAD` / `aRadius + MELEE_PAD` that
 * `_strike` lands with), fill = the flash itself — which `enemies.js` ramps
 * to exactly 1 at the strike frame, so the ring FILLS when the hit lands.
 *
 * Ranged volleys (PROJ) are skipped in v1 — a projectile's danger volume is
 * its flight path, not a disc at the caster's feet — and CHANNEL attacks
 * carry no damage volume at all.
 *
 * Pool sized to the mixer budget (8 at ultra, meshEnemies.js): more than
 * eight SIMULTANEOUS windups inside perception range does not happen under
 * the token system, and a ninth would be on top of one anyway.
 *
 * Technique adapted under MIT from LinearAbiltyCastingThreeJS
 * (src/effects/ZoneIndicator.js) — attribution in the shader file and
 * CREDITS.md.
 *
 * Owned and updated by `main.js`, AFTER `enemies.update` so the rings carry
 * this frame's flash, before anything renders. Allocation per frame: none.
 */

import * as THREE from "three";

import { shader } from "../core/glsl.js";
import { vertex, fragment } from "../shaders/telegraph.glsl.js";
import { ENEMY_MAX, ATTACK_KIND, STRIKE_PAD_M } from "../combat/enemies.js";

/** Pool size — must match the uniform arrays in shaders/telegraph.glsl.js. */
export const TELE_MAX = 8;

/** Rings sit this far above the terrain so they never z-fight the snow. */
const LIFT = 0.07;

export class TelegraphRings {
    /**
     * @param {THREE.Scene} scene
     * @param {Record<string, {value:any}>} globals the `lib/common` block
     * @param {import("../combat/enemies.js").Enemies} enemies
     * @param {{heightAt(x:number,z:number):number}} terrain
     * @param {import("../spells/spellSystem.js").SpellSystem} spells realm tint
     */
    constructor(scene, globals, enemies, terrain, spells) {
        this.enemies = enemies;
        this.terrain = terrain;
        this.spells = spells;

        /** (x, y, z, fill01) per ring — fill < 0 = dead. THE uniform storage. */
        this.a = new Float32Array(TELE_MAX * 4);
        /** (radius, r, g, b) per ring. */
        this.b = new Float32Array(TELE_MAX * 4);
        /** Probe/A-B switch: false collapses the pool without touching state. */
        this.enabled = true;
        this.stats = { active: 0, draws: 0 };

        for (let i = 0; i < TELE_MAX; i++) this.a[i * 4 + 3] = -1;

        const pos = new Float32Array(TELE_MAX * 4 * 3);
        const idx = new Uint16Array(TELE_MAX * 6);
        for (let i = 0; i < TELE_MAX; i++) {
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
                uTeleA: { value: this.a },
                uTeleB: { value: this.b },
            }),
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "enemyTelegraphs";
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;     // the ground-fx band, with the shockwaves
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    /**
     * Refill the pool from the enemies' live windup state.
     * @param {number} dt unused — the rings are stateless, driven by flash
     */
    update(dt) {
        const e = this.enemies;
        let j = 0;

        if (this.enabled && e) {
            // Warning tint: the realm's flash hue pulled 65% toward red-hot,
            // so a hostile ring never reads as one of the player's own.
            const p = this.spells.ctx.realm.bolt;
            const wr = p.flashR + (1.35 - p.flashR) * 0.65;
            const wg = p.flashG + (0.30 - p.flashG) * 0.65;
            const wb = p.flashB + (0.16 - p.flashB) * 0.65;

            for (let i = 0; i < ENEMY_MAX && j < TELE_MAX; i++) {
                if (!e.alive[i]) continue;
                const a = e.atk[i];
                if (a < 0 || e.flash[i] <= 0.05) continue;
                const u = e.units[e.unitOf[i]];
                const kind = u.aKind[a];
                if (kind === ATTACK_KIND.PROJ || kind === ATTACK_KIND.CHANNEL) {
                    continue;
                }
                const o = j * 4;
                this.a[o + 0] = e.x[i];
                this.a[o + 1] = this.terrain.heightAt(e.x[i], e.z[i]) + LIFT;
                this.a[o + 2] = e.z[i];
                this.a[o + 3] = Math.min(1, e.flash[i]);
                this.b[o + 0] = u.aRadius[a] + STRIKE_PAD_M;
                this.b[o + 1] = wr;
                this.b[o + 2] = wg;
                this.b[o + 3] = wb;
                j++;
            }
        }
        for (let k = j; k < TELE_MAX; k++) this.a[k * 4 + 3] = -1;

        this.mesh.visible = j > 0;
        this.stats.active = j;
        this.stats.draws = this.mesh.visible ? 1 : 0;
    }

    /** Kill every ring (probe A/B and realm sweeps). */
    clear() {
        for (let i = 0; i < TELE_MAX; i++) this.a[i * 4 + 3] = -1;
        this.mesh.visible = false;
        this.stats.active = 0;
        this.stats.draws = 0;
    }
}
