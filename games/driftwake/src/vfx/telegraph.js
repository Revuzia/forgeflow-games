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
import { buildGroundFxGrid } from "./groundfxGrid.js";

/** Pool size — must match the uniform arrays in shaders/telegraph.glsl.js. */
export const TELE_MAX = 8;

export class TelegraphRings {
    /**
     * @param {THREE.Scene} scene
     * @param {Record<string, {value:any}>} globals the `lib/common` block
     * @param {import("../combat/enemies.js").Enemies} enemies
     * @param {import("../terrain/terrain.js").Terrain} terrain heightAt for
     *   the CPU anchor, plus `clipUniforms` + `deformUniforms` (shared by
     *   reference) for the `lib/groundfx` chain the vertex stage drapes with
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

        // 16x16 grid per slot (vfx/groundfxGrid.js): the vertex stage drapes
        // every grid vertex onto the terrain's own height chain. One mesh,
        // one draw, exactly as the flat quads were.
        this.geometry = buildGroundFxGrid(TELE_MAX);

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            // clipUniforms + deformUniforms feed lib/groundfx — shared BY
            // REFERENCE with the terrain's five programs, so the ring reads
            // the same height/deform state the snow is drawn from.
            uniforms: Object.assign({}, globals,
                terrain.clipUniforms, terrain.deformUniforms, {
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
                // CPU anchor height, for probes: the vertex stage re-derives
                // the drawn height per grid vertex from the GPU chain
                // (lib/groundfx) and ignores this.
                this.a[o + 1] = this.terrain.heightAt(e.x[i], e.z[i]);
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
