/**
 * The frost-arc decal pool — the CPU half of `shaders/arcdecal.glsl.js`.
 *
 * Two sector decals in one mesh, one draw. Spawned by polling the spell
 * system's `arcGen` counter — the same cast edge `combat/spellHits.js`
 * resolves the damage cone from — with the origin, ground height and flat
 * direction the cast captured (`arcX/arcZ/arcDirX/arcDirZ`), so the decal and
 * the hit volume cannot disagree about where the arc went.
 *
 * The cone's geometry comes from `combatData.bolt.arc` (reach 8 m, halfAngle
 * 1.05 rad) — the DAMAGE numbers, not the visual fan's transcriptions — which
 * is the point: this decal is the telegraph of what was tested.
 *
 * Two is enough: the arc runs a 1.5 s cooldown and the decal lives 1.1 s, so
 * a third live decal cannot exist.
 *
 * Technique adapted under MIT from LinearAbiltyCastingThreeJS
 * (src/effects/GroundDecals.js, FROST) — attribution in the shader file and
 * CREDITS.md. Allocation per frame: none.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { rand } from "../spells/bending.js";
import { combatData } from "../combat/combatData.js";
import { vertex, fragment } from "../shaders/arcdecal.glsl.js";
import { buildGroundFxGrid } from "./groundfxGrid.js";

/** Pool size — must match the uniform arrays in shaders/arcdecal.glsl.js. */
export const ARC_MAX = 2;

/** Seconds the flash lives; the durable glaze is the deform ice channel. */
const LIFE = 1.1;

export class ArcDecal {
    /**
     * @param {THREE.Scene} scene
     * @param {Record<string, {value:any}>} globals the `lib/common` block
     * @param {import("../terrain/terrain.js").Terrain} terrain supplies
     *   `clipUniforms` + `deformUniforms` (shared by reference) for the
     *   `lib/groundfx` chain the vertex stage drapes the decal with
     */
    constructor(scene, globals, terrain) {
        /** (x, y, z, age01) — age01 1 = dead. THE uniform storage. */
        this.a = new Float32Array(ARC_MAX * 4);
        /** (dirX, dirZ, reach, halfAng). */
        this.b = new Float32Array(ARC_MAX * 4);
        /** (r, g, b, seed). */
        this.c = new Float32Array(ARC_MAX * 4);
        this.age = new Float32Array(ARC_MAX);
        this.alive = new Uint8Array(ARC_MAX);
        this._next = 0;
        this._gen = 0;        // last arcGen consumed
        this.enabled = true;
        this.stats = { active: 0, draws: 0 };

        for (let i = 0; i < ARC_MAX; i++) this.a[i * 4 + 3] = 1;

        // 16x16 grid per slot (vfx/groundfxGrid.js): the vertex stage drapes
        // every grid vertex onto the terrain's own height chain. One mesh,
        // one draw, exactly as the flat quads were.
        this.geometry = buildGroundFxGrid(ARC_MAX);

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            // clipUniforms + deformUniforms feed lib/groundfx — shared BY
            // REFERENCE with the terrain's five programs, so the decal reads
            // the same height/deform state the snow is drawn from.
            uniforms: Object.assign({}, globals,
                terrain.clipUniforms, terrain.deformUniforms, {
                uArcA: { value: this.a },
                uArcB: { value: this.b },
                uArcC: { value: this.c },
            }),
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "spellArcDecals";
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    /**
     * Poll the arc cast edge and age the pool. Call from
     * `SpellSystem.update`, after the spells have updated.
     * @param {number} dt
     * @param {import("../spells/spellSystem.js").SpellSystem} sp
     */
    update(dt, sp) {
        if (sp.arcGen !== this._gen) {
            this._gen = sp.arcGen;
            const i = this._next;
            this._next = (i + 1) % ARC_MAX;
            this.age[i] = 0;
            this.alive[i] = 1;

            const arc = combatData.bolt.arc;
            const t = sp.ctx.realm.bolt;
            const o = i * 4;
            this.a[o + 0] = sp.arcX;
            // CPU anchor height, for probes: the vertex stage re-derives the
            // drawn height per grid vertex from the GPU chain (lib/groundfx)
            // and ignores this.
            this.a[o + 1] = sp.ctx.terrain.heightAt(sp.arcX, sp.arcZ);
            this.a[o + 2] = sp.arcZ;
            this.a[o + 3] = 0;
            this.b[o + 0] = sp.arcDirX;
            this.b[o + 1] = sp.arcDirZ;
            this.b[o + 2] = arc.reach;
            this.b[o + 3] = arc.halfAngle;
            // Authored decal ink (owner 2026-08-13): the squared flash
            // tint was near-white over snow. arcInk is final color.
            const ink = sp.ctx.realm.arcInk ||
                { r: t.flashR, g: t.flashG, b: t.flashB };
            this.c[o + 0] = ink.r;
            this.c[o + 1] = ink.g;
            this.c[o + 2] = ink.b;
            this.c[o + 3] = rand() * 10;
        }

        let live = 0;
        for (let i = 0; i < ARC_MAX; i++) {
            if (!this.alive[i]) continue;
            this.age[i] += dt;
            const t = this.age[i] / LIFE;
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

    /** Kill every decal. */
    clear() {
        for (let i = 0; i < ARC_MAX; i++) {
            this.alive[i] = 0;
            this.a[i * 4 + 3] = 1;
        }
        this.mesh.visible = false;
        this.stats.active = 0;
        this.stats.draws = 0;
    }
}
