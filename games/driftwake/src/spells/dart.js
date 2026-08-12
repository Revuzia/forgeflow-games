/**
 * The primary bolt — LMB, internal spell id 6.
 *
 * A fixed pool of twelve projectiles in one data-driven mesh: one draw, one
 * 12 x 3 upload, and no geometry generated at any point. A bolt that is not
 * alive has zero scale, which collapses every one of its twelve triangles onto
 * its base point — the same switch-off `crystals.js` and `waterBody.js` use, and
 * the reason the draw call does not depend on how many bolts are in the air.
 *
 * WHY TWELVE. Max flight time is range / speed = 40 / 21 = 1.905 s
 * (`combatData.js` SPELLS.LMB). At the 0.45 s fire cycle a player holding the
 * button has ceil(1.905 / 0.45) = 5 bolts up at once. Double it for the splash
 * hold frames and any second source, round up: twelve. 12 x 12 = 144 triangles.
 *
 * WHAT THIS OBJECT DOES NOT DO. It does not know what an enemy is. It flies,
 * it draws, it trails, and it terminates on the ground or at the end of its
 * leash. `combat/spellHits.js` owns whether a bolt connected and calls `hitAt()`
 * to say so — that is the single write from the damage pass into this pool, and
 * it is deliberate: the pass owns the hit test, this file owns what a hit looks
 * like, and neither reaches into the other.
 *
 * NO LIGHT IN FLIGHT. `MAX_SPELL_LIGHTS` is 4 and `SpellLights.add()` drops the
 * fifth silently (spellLights.js:83) — five bolts each declaring a light would
 * evict every other spell's light every frame. Only the IMPACT declares one, for
 * 0.12 s, and only while a slot is still free for it.
 *
 * Allocation per frame: none.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { vertex, fragment } from "../shaders/dart.glsl.js";
import { rand } from "./bending.js";

/** Pool size — see the docblock. */
export const BOLT_MAX = 12;

/** Vertices per bolt: a tail apex, a ring of six, a tip. */
const VERTS = 8;
const RING = 6;

/** Seconds an impact flash lives. Short: it fires 2.2 times a second. */
const FLASH_LIFE = 0.12;

/** Camera trauma per impact. NOT the ribbon's 0.09 — at 2.2 impacts per second
 *  that is a permanent shake rather than a punctuation. */
const IMPACT_TRAUMA = 0.03;

/** Trail emission, particles per second per bolt, before `sprayScale`. */
const TRAIL_RATE = 90;

export class Dart {
    /**
     * @param {import("./spellSystem.js").SpellContext} ctx
     * @param {THREE.Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {import("./spellLights.js").SpellLights} lights
     * @param {Record<string, {value:any}>} globals `lib/common`'s shared block
     * @param {Record<string, {value:any}>} realm the realm palette block
     */
    constructor(ctx, scene, sky, shadows, lights, globals, realm) {
        this.ctx = ctx;

        // ---- pool, SoA ------------------------------------------------------
        this.x = new Float32Array(BOLT_MAX);
        this.y = new Float32Array(BOLT_MAX);
        this.z = new Float32Array(BOLT_MAX);
        /** Position at the END of last frame — the tail of this frame's swept
         *  hit segment. Seeded to the muzzle on spawn, so the first test is a
         *  point test at the hand rather than a sweep from the origin. */
        this.px = new Float32Array(BOLT_MAX);
        this.py = new Float32Array(BOLT_MAX);
        this.pz = new Float32Array(BOLT_MAX);
        this.vx = new Float32Array(BOLT_MAX);
        this.vy = new Float32Array(BOLT_MAX);
        this.vz = new Float32Array(BOLT_MAX);
        /** Metres still on the leash. */
        this.left = new Float32Array(BOLT_MAX);
        this.age = new Float32Array(BOLT_MAX);
        this.alive = new Uint8Array(BOLT_MAX);
        /**
         * Bumped every time a slot is fired. `spellHits` compares it against its
         * own copy to tell "the same projectile, next frame" from "a new
         * projectile in a recycled slot" — which is what makes the anti-kite
         * capture per-projectile rather than per-slot.
         */
        this.gen = new Int32Array(BOLT_MAX);
        /** 0 = a damaging primary bolt, 1 = a carrier head that only draws. */
        this.own = new Uint8Array(BOLT_MAX);
        /**
         * The `sizeMul` the slot was fired with — 1 for a plain bolt, 0.85 for
         * a Frost Arc fan dart, 2.2 for the Ash fireball's head. Retained
         * because `own` alone no longer says how big the landing is (the arc
         * fan made carriers common), and the shockwave ring scales off this.
         */
        this.size = new Float32Array(BOLT_MAX);
        /** Set for exactly ONE frame, on the frame a slot terminates. */
        this.impact = new Uint8Array(BOLT_MAX);
        /** Set by the damage pass once a slot has spent its one direct hit. */
        this.spent = new Uint8Array(BOLT_MAX);
        this._flash = new Float32Array(BOLT_MAX);
        this._fx = new Float32Array(BOLT_MAX);
        this._fy = new Float32Array(BOLT_MAX);
        this._fz = new Float32Array(BOLT_MAX);
        this._trailOwed = new Float32Array(BOLT_MAX);
        this._next = 0;
        this.liveCount = 0;

        // ---- the pool's texture --------------------------------------------
        // Rows: (x,y,z,scale) / (dx,dy,dz,age01) / (len,wid,kind,spin)
        this._texData = new Float32Array(BOLT_MAX * 3 * 4);
        this.dataTex = new THREE.DataTexture(
            this._texData, BOLT_MAX, 3, THREE.RGBAFormat, THREE.FloatType
        );
        // RGBA32F is core in WebGL2 as long as it is never FILTERED, and every
        // read in the vertex stage is a texelFetch — waterBody.js:104-115.
        this.dataTex.internalFormat = "RGBA32F";
        this.dataTex.minFilter = THREE.NearestFilter;
        this.dataTex.magFilter = THREE.NearestFilter;
        this.dataTex.wrapS = THREE.ClampToEdgeWrapping;
        this.dataTex.wrapT = THREE.ClampToEdgeWrapping;
        this.dataTex.generateMipmaps = false;
        this.dataTex.flipY = false;
        this.dataTex.needsUpdate = true;

        this.geometry = buildMesh();

        this._shading = {
            sssStrength: { value: S.sssStrength },
            sssRadius: { value: S.sssRadius },
            glintIntensity: { value: S.glintIntensity },
            glintGrazing: { value: S.glintGrazing },
        };

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            uniforms: Object.assign(
                {}, globals,
                { boltTex: { value: this.dataTex } },
                realm,
                this._shading,
                sky.uniforms,
                shadows.receiverUniforms(1.3, 0.012),
                lights.uniforms
            ),
            // The crystals' state block, for the crystals' reason: a closed
            // solid whose dead triangles are degenerate — cull nothing, blend
            // over the snow, WRITE depth so bolts never smear over each other.
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NormalBlending,
            premultipliedAlpha: false,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "spellBolts";
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        // With the terrain and the crystals, ahead of the water and the spray.
        this.mesh.renderOrder = 1;
        this.mesh.visible = false;
        scene.add(this.mesh);

        this._dirty = true;
    }

    /**
     * The spell-array contract: `SpellSystem._cancelAll()` and `activeCount`
     * both walk `this.spells`, so the bolt has to answer both.
     */
    get active() {
        return this.liveCount > 0;
    }

    /**
     * Fire one bolt.
     *
     * @param {number} x @param {number} y @param {number} z muzzle (the hand)
     * @param {number} dx @param {number} dy @param {number} dz unit heading
     * @param {number} speed m/s
     * @param {number} range metres of leash
     * @param {number} own 0 = damaging primary, 1 = a carrier that only draws
     * @param {number} sizeMul multiplies the realm's length and width
     * @returns {number} the slot, or -1 when the pool is full
     */
    fire(x, y, z, dx, dy, dz, speed, range, own, sizeMul) {
        let i = this._next;
        for (let n = 0; n < BOLT_MAX; n++) {
            if (!this.alive[i]) break;
            i = (i + 1) % BOLT_MAX;
            // Pool full: DROP the shot rather than stealing the oldest bolt.
            // Stealing would delete a projectile mid-flight that the damage pass
            // is still integrating a swept segment for.
            if (n === BOLT_MAX - 1) return -1;
        }
        this._next = (i + 1) % BOLT_MAX;

        this.x[i] = x; this.y[i] = y; this.z[i] = z;
        this.px[i] = x; this.py[i] = y; this.pz[i] = z;
        this.vx[i] = dx * speed;
        this.vy[i] = dy * speed;
        this.vz[i] = dz * speed;
        this.left[i] = range;
        this.age[i] = 0;
        this.alive[i] = 1;
        this.own[i] = own | 0;
        this.size[i] = sizeMul || 1;
        this.impact[i] = 0;
        this.spent[i] = 0;
        this._flash[i] = 0;
        this._trailOwed[i] = 0;
        this.gen[i] = (this.gen[i] + 1) | 0;

        const p = this.ctx.realm.bolt;
        this._write(i, p.len * (sizeMul || 1), p.wid * (sizeMul || 1),
            own ? 1 : 0, rand() * Math.PI * 2);
        this._dirty = true;
        return i;
    }

    /**
     * The damage pass connected this bolt with something. Terminate it here, at
     * its current position, so the impact and the damage are one event.
     * @param {number} i slot
     */
    hitAt(i) {
        if (!this.alive[i]) return;
        this._terminate(i);
    }

    /** @param {number} dt */
    update(dt) {
        const ctx = this.ctx;
        const terrain = ctx.terrain;
        let live = 0;

        for (let i = 0; i < BOLT_MAX; i++) {
            // The one-frame impact flag is cleared HERE, before anything moves,
            // so `spellHits` (which runs after every spell) reads it exactly
            // once and needs no latch of its own.
            this.impact[i] = 0;
            if (this._flash[i] > 0) this._flash[i] -= dt;
            if (!this.alive[i]) continue;

            this.px[i] = this.x[i];
            this.py[i] = this.y[i];
            this.pz[i] = this.z[i];

            const vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
            const step = Math.hypot(vx, vy, vz) * dt;
            this.x[i] += vx * dt;
            this.y[i] += vy * dt;
            this.z[i] += vz * dt;
            this.age[i] += dt;
            this.left[i] -= step;

            this._trail(i, dt);

            // Terminate on the ground, or at the end of the leash. No gravity:
            // this is a bolt, and a ballistic primary is a different weapon.
            const g = terrain.heightAt(this.x[i], this.z[i]);
            if (this.y[i] <= g + 0.05) {
                this.y[i] = g + 0.05;
                this._terminate(i);
                continue;
            }
            if (this.left[i] <= 0) {
                this._terminate(i);
                continue;
            }
            live++;
        }

        this.liveCount = live;

        // The impact light, declared out here rather than in `_terminate`, so it
        // survives the frames after the bolt itself is gone. Capped at one, and
        // only while the pool has room — a bolt must never evict a Vortex.
        for (let i = 0; i < BOLT_MAX; i++) {
            if (this._flash[i] <= 0) continue;
            if (ctx.lights.count >= 3) break;
            const p = ctx.realm.bolt;
            const k = this._flash[i] / FLASH_LIFE;
            ctx.lights.add(
                this._fx[i], this._fy[i] + 0.25, this._fz[i], 4.2,
                p.flashR, p.flashG, p.flashB, p.flashK * k
            );
            break;
        }

        this.mesh.visible = live > 0 && S.showSpells !== false;
        if (this.mesh.visible || this._dirty) {
            this._upload();
            this.dataTex.needsUpdate = true;
            this._dirty = false;
        }
        if (this.mesh.visible) this._pushUniforms();
    }

    /**
     * Impact: a wide, low fan of spray, a brush into the snow, and a flash.
     *
     * Wide and low for the reason `ribbon._splash` gives at length — a vertical
     * burst reads as an explosion, and this is a 62 cm splinter arriving at
     * 21 m/s, not a charge going off. Carrier heads (the Ash fireball's travel
     * phase) skip the brush and the trauma: their landing is the Sweep's cast,
     * and the Sweep writes its own ground.
     * @param {number} i
     */
    _terminate(i) {
        const ctx = this.ctx;
        const p = ctx.realm;
        const x = this.x[i], y = this.y[i], z = this.z[i];

        this.alive[i] = 0;
        this.impact[i] = 1;
        this._flash[i] = FLASH_LIFE;
        this._fx[i] = x; this._fy[i] = y; this._fz[i] = z;
        this._texData[i * 4 + 3] = 0;          // scale 0 — the triangles go away
        this._dirty = true;

        const carrier = this.own[i] === 1;
        const sp = ctx.spray;
        if (sp) {
            const sl = Math.hypot(this.vx[i], this.vy[i], this.vz[i]) || 1;
            const ix = this.vx[i] / sl, iz = this.vz[i] / sl;
            const n = ((carrier ? 90 : 40) * ctx.sprayScale) | 0;
            for (let k = 0; k < n; k++) {
                const a = rand() * Math.PI * 2;
                const ca = Math.cos(a), sa = Math.sin(a);
                const out = 1.4 + rand() * 3.6;
                const clod = rand() < 0.35 + p.spray.clodBias ? 1 : 0;
                sp.emit(
                    x + ca * 0.10, y + 0.03 + rand() * 0.10, z + sa * 0.10,
                    ca * out + ix * 2.2,
                    0.9 + rand() * 2.6,
                    sa * out + iz * 2.2,
                    (clod ? 0.018 + rand() * 0.026 : 0.040 + rand() * 0.060)
                        * p.spray.sizeMul,
                    (0.4 + rand() * 0.6) * p.spray.lifeMul,
                    clod,
                    (clod ? 0.8 : 1.9) * p.spray.grainDragMul
                );
            }
        }

        if (carrier) return;

        const f = ctx.deform;
        if (f) {
            f.brush(
                x, z, 0.28,
                0.10, 0.09, 0.42, 0.55 * p.ice,
                rand() * Math.PI, 1.25, 1.0
            );
        }
        ctx.rig.addTrauma(IMPACT_TRAUMA);
    }

    /**
     * The trail. The existing `SprayField`, through the same `emit()` every
     * other spell calls, so it costs zero new draw calls. The realm difference
     * is entirely in the arguments: cold powder at drag 4.0 HANGS where the bolt
     * has been, sand grit at 1.6 falls behind and down, ash embers at 0.7 streak
     * backward in a plume.
     * @param {number} i @param {number} dt
     */
    _trail(i, dt) {
        const ctx = this.ctx;
        const sp = ctx.spray;
        if (!sp) return;
        const p = ctx.realm.bolt;

        this._trailOwed[i] += dt * TRAIL_RATE * ctx.sprayScale;
        let n = this._trailOwed[i] | 0;
        if (n <= 0) return;
        this._trailOwed[i] -= n;
        if (n > 12) n = 12;

        // Spread along the segment actually travelled this frame, not stamped at
        // the head: at 21 m/s and 13 fps the head moves 1.6 m per frame and a
        // point emitter leaves the trail in visible clumps.
        const dx = this.x[i] - this.px[i];
        const dy = this.y[i] - this.py[i];
        const dz = this.z[i] - this.pz[i];
        for (let k = 0; k < n; k++) {
            const u = rand();
            sp.emit(
                this.px[i] + dx * u + (rand() - 0.5) * 0.06,
                this.py[i] + dy * u + (rand() - 0.5) * 0.06,
                this.pz[i] + dz * u + (rand() - 0.5) * 0.06,
                (rand() - 0.5) * 0.7,
                (rand() - 0.5) * 0.7 + 0.2,
                (rand() - 0.5) * 0.7,
                (0.012 + rand() * 0.020) * p.trailSize,
                p.trailLife * (0.7 + rand() * 0.6),
                p.trailKind,
                p.trailDrag
            );
        }
    }

    /** Write one bolt's row-2 constants. @param {number} i */
    _write(i, len, wid, kind, spin) {
        const d = this._texData;
        const o = BOLT_MAX * 8 + i * 4;
        d[o] = len; d[o + 1] = wid; d[o + 2] = kind; d[o + 3] = spin;
    }

    /** Rows 0 and 1, for every live slot. */
    _upload() {
        const d = this._texData;
        const w = BOLT_MAX * 4;
        for (let i = 0; i < BOLT_MAX; i++) {
            const o = i * 4;
            if (!this.alive[i]) { d[o + 3] = 0; continue; }
            d[o] = this.x[i]; d[o + 1] = this.y[i]; d[o + 2] = this.z[i];
            d[o + 3] = 1;
            const vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
            const l = Math.hypot(vx, vy, vz) || 1;
            const q = w + o;
            d[q] = vx / l; d[q + 1] = vy / l; d[q + 2] = vz / l;
            d[q + 3] = Math.min(1, this.age[i] / 2);
        }
    }

    _pushUniforms() {
        const sh = this._shading;
        sh.sssStrength.value = S.sssStrength;
        sh.sssRadius.value = S.sssRadius;
        sh.glintIntensity.value = S.glintIntensity;
        sh.glintGrazing.value = S.glintGrazing;
    }

    /**
     * The realm swap, pool side. Every uniform the material reads is written by
     * `SpellSystem.setRealm` into boxes this material already shares; what is
     * left here is the per-slot geometry, which is CPU data in a texture that is
     * re-uploaded every frame anyway. Zero allocation, zero recompile.
     * @param {{bolt:{len:number,wid:number}}} p a frozen REALM_PALETTE row
     */
    setRealm(p) {
        for (let i = 0; i < BOLT_MAX; i++) {
            if (!this.alive[i]) continue;
            const o = BOLT_MAX * 8 + i * 4;
            const carrier = this._texData[o + 2] > 0.5;
            this._texData[o] = p.bolt.len * (carrier ? 2.2 : 1);
            this._texData[o + 1] = p.bolt.wid * (carrier ? 3.4 : 1);
        }
        this._dirty = true;
    }

    get triangles() {
        return this.mesh.visible ? this.liveCount * RING * 2 : 0;
    }

    /**
     * Stand one bolt up and LEAVE IT STANDING through the warm-up frames.
     *
     * Same reasoning as `WaterBody.warmUp` and `CrystalField.warmUp`: compiling
     * the program is not the same as specialising the pipeline, and the
     * blend/depth/target-format combination only binds when a triangle actually
     * goes through it. Without this the first LMB press pays for it.
     */
    warmUp(x, y, z) {
        const d = this._texData;
        const w = BOLT_MAX * 4;
        d[0] = x; d[1] = y + 1.2; d[2] = z; d[3] = 1;
        d[w] = 0; d[w + 1] = 0; d[w + 2] = 1; d[w + 3] = 0.2;
        this._write(0, 0.62, 0.11, 0, 0.4);
        this.dataTex.needsUpdate = true;
        this.mesh.visible = true;
        this._pushUniforms();
    }

    /** Take the warm-up bolt down, after the warm frames have drawn it. */
    finishWarmUp() {
        this._texData.fill(0);
        this.dataTex.needsUpdate = true;
        this.mesh.visible = false;
    }

    /**
     * `S.showSpells = false` or a lost pointer lock. Bolts in the air are
     * DROPPED without an impact — a cancelled spell takes its volumes with it
     * (spellHits.js §9.2), and an impact here would be damage from a spell the
     * player just switched off.
     */
    cancel() {
        for (let i = 0; i < BOLT_MAX; i++) {
            this.alive[i] = 0;
            this._flash[i] = 0;
        }
        this.liveCount = 0;
        this._texData.fill(0);
        this._dirty = true;
    }

    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.geometry.dispose();
        this.material.dispose();
        this.dataTex.dispose();
    }
}

/**
 * Static lattice: `position` is (boltIndex, vertexIndex, 0) and carries no
 * geometry at all — the same encoding as `crystals.js:334-340`.
 *
 * Six base triangles and six tip triangles = 12 per bolt, 144 in the pool,
 * 96 vertices, one draw.
 * @returns {THREE.BufferGeometry}
 */
function buildMesh() {
    const pos = new Float32Array(BOLT_MAX * VERTS * 3);
    const idx = new Uint16Array(BOLT_MAX * RING * 2 * 3);

    let vi = 0;
    let ii = 0;
    for (let i = 0; i < BOLT_MAX; i++) {
        for (let v = 0; v < VERTS; v++) {
            pos[vi++] = i;
            pos[vi++] = v;
            pos[vi++] = 0;
        }
        const b = i * VERTS;
        for (let k = 0; k < RING; k++) {
            const k2 = (k + 1) % RING;
            idx[ii++] = b; idx[ii++] = b + 1 + k; idx[ii++] = b + 1 + k2;
            idx[ii++] = b + 1 + k; idx[ii++] = b + 7; idx[ii++] = b + 1 + k2;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // Never computeBoundingSphere(): `position` is (bolt, vertex, 0), not a
    // coordinate — waterBody.js:406-409 records what happens without this.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}
