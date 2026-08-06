/**
 * Training dummies — the practice room at the spawn shrine (progression doc
 * P0 / combat doc §9.6: the shrine dummies ARE the combat test harness and
 * they stay forever).
 *
 * Four frost totems stand in an arc 12–18 m from spawn, one per tier rung so
 * every combat lesson is provable on a target that never moves:
 *
 *   Frost Totem    fodder   24 HP, poise  10   (Rime Imp row, §2.1 #1)
 *   Rime Totem     light    60 HP, poise  20   (light band 40–75, §2.0/§5.1)
 *   Floe Totem     medium   95 HP, poise  35   (Scour Scout row, §2.2 #15)
 *   Glacier Totem  heavy   300 HP, poise 100   (Hail Plate Guard row, §2.1 #10)
 *
 * All stats are L10 snapshots per the progression doc's Anchor Contract (§1);
 * the registry's §5.2 CC matrix then gives the tier lessons for free — the
 * heavy totem halves Spike stuns to 0.75 s and takes 30% knockback, exactly
 * what the practice room exists to demonstrate.
 *
 * VISUALS — why this is NOT CrystalField.plant():
 * The crystals API was evaluated first and rejected for persistent clusters,
 * on three grounds read from `spells/crystals.js` this build:
 *   1. `plant()` returns no handle — there is no per-prism clear, so a killed
 *      dummy could not shatter without wiping the whole field (the only clear
 *      is the global `finishWarmUp()`).
 *   2. Lifetime is finite by design (34–42 s stand + 6 s sublimate); a dummy
 *      is permanent.
 *   3. The 96-slot pool is shared with the Crystallize spell and DROPS new
 *      prisms when full — 24 permanently-held slots would silently eat casts.
 * So this module owns a minimal instanced shard mesh of its own, built the
 * way `crystals.js` builds its pool: the identical (crystal, vertex, 0)
 * lattice, the identical 3-row RGBA32F data texture that `lib/crystal`'s
 * `crystalPoint()` reads, and a RawShaderMaterial reusing the EXACT beauty
 * stages from `shaders/crystal.glsl.js` — which carry the full include chain
 * (`lib/crystal` → `lib/common`, `lib/noise`, `lib/shading`,
 * `lib/spellLights`, `lib/atmosphere`, `lib/shadowLookup`). The uniforms
 * object is built over `crystals.material.uniforms`, so the sun, sky,
 * cascade, fog and spell-light boxes are the SAME live objects the spell ice
 * uses — one source of shading truth, and because the GLSL source is
 * byte-identical, Three's program cache reuses the pipelines the crystal
 * warm-up already compiled. NO Three lights, NO stock materials.
 *
 * Registry contract (combat/damageable.js, coded against verbatim):
 *   register({x,y,z,radius,height,tier,level,hp,poiseMax,name,kind}) -> id
 *   remove(id) on death; re-register on respawn. Never move() — dummies never
 *   move. Death is detected by polling `hp[slot] <= 0` (cheaper and
 *   order-proof versus draining the event ring, which belongs to floaters/xp).
 *
 * Death → shatter → respawn: on kill the totem's prisms collapse fast through
 * the growth channel (0.35 s — the same degenerate-triangle switch-off the
 * pool uses, run hard in reverse, which reads as the formation bursting back
 * into the drift), the slot is removed from the registry, and 8 s after the
 * kill the totem regrows at full HP. Particulate debris would need the spray
 * pool, which this room deliberately does not depend on.
 *
 * Allocation per steady frame: none. Settled totems upload nothing; the data
 * texture re-uploads only while a totem is growing or shattering. The one
 * Map.set lives inside registry.register() and runs on the respawn EDGE
 * (once per 8+ s), never in a steady frame.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { vertex, fragment, depthVertex } from "../shaders/crystal.glsl.js";
import { TIER } from "./damageable.js";

/** Totem count — one per tier rung of the §2.0 baseline table. */
const DUMMY_COUNT = 4;
/** Prisms per totem: one column + five leaning shards = a tight frost totem. */
const PRISMS = 6;
const TOTAL = DUMMY_COUNT * PRISMS;

/** Vertices per prism: two rings of six plus an apex. Matches `lib/crystal`. */
const VERTS = 13;
const RING = 6;

/** Same cascade depth the spell ice draws into (crystals.js). */
const DUMMY_CASCADES = 2;

/** Seconds from kill to the healed respawn (task directive for this room). */
const RESPAWN_S = 8.0;
/** Regrow time — brisk enough to read as "it's back", slow enough to grow. */
const GROW_S = 0.6;
/** Shatter collapse time — fast reverse growth, the kill read. */
const SHATTER_S = 0.35;

/** Totem lifecycle phases. */
const ALIVE = 0, SHATTER = 1, DEAD = 2;

/**
 * The tier ladder. HP and poise are combat-doc L10 rows (header comment);
 * `scale` is presentation only — the heavy totem LOOKS like the wall it is.
 * Arc placement: 12–18 m from spawn (task brief), fanned ±29° about the
 * arc bearing, nearest-to-farthest in tier order so the ladder reads
 * left-to-right walking out of spawn.
 */
const DEFS = [
    { name: "Frost Totem",   tier: TIER.FODDER, hp: 24,  poise: 10,  scale: 0.85, r: 12.5, ang: -0.51 },
    { name: "Rime Totem",    tier: TIER.LIGHT,  hp: 60,  poise: 20,  scale: 1.0,  r: 14.5, ang: -0.17 },
    { name: "Floe Totem",    tier: TIER.MEDIUM, hp: 95,  poise: 35,  scale: 1.1,  r: 16.0, ang: 0.17 },
    { name: "Glacier Totem", tier: TIER.HEAVY,  hp: 300, poise: 100, scale: 1.3,  r: 17.5, ang: 0.51 },
];

export class TrainingDummies {
    /**
     * Build the totems, plant their prisms and register their hit capsules.
     * Construct AFTER the spell system (the crystal material must exist) and
     * before the warm-up block, so the shared pipelines bind with everyone
     * else's behind the boot screen.
     *
     * @param {import("./damageable.js").DamageableRegistry} registry
     * @param {import("../terrain/terrain.js").Terrain} terrain ground heights
     * @param {import("../spells/crystals.js").CrystalField} crystals the spell
     *   ice — supplies scene, shadow system and the live shading uniforms
     * @param {{spawnX?:number, spawnZ?:number, bearing?:number}|null} [data]
     *   optional placement override; defaults to the (0,0) spawn, arc facing +Z
     */
    constructor(registry, terrain, crystals, data) {
        this.registry = registry;
        this.terrain = terrain;

        const spawnX = (data && data.spawnX) || 0;
        const spawnZ = (data && data.spawnZ) || 0;
        const bearing = (data && data.bearing) || 0;

        // ---------------------------------------------------------- data texture
        // Identical layout to crystals.js so `crystalPoint()` reads it unchanged:
        // rows (x,y,z,height) / (axis,radius) / (growth, seed, -, -). texelFetch
        // uses integer texel coords, so a 24-wide texture needs no shader change.
        this._texData = new Float32Array(TOTAL * 3 * 4);
        this.dataTex = new THREE.DataTexture(
            this._texData, TOTAL, 3, THREE.RGBAFormat, THREE.FloatType
        );
        this.dataTex.internalFormat = "RGBA32F";
        this.dataTex.minFilter = THREE.NearestFilter;
        this.dataTex.magFilter = THREE.NearestFilter;
        this.dataTex.wrapS = THREE.ClampToEdgeWrapping;
        this.dataTex.wrapT = THREE.ClampToEdgeWrapping;
        this.dataTex.generateMipmaps = false;
        this.dataTex.flipY = false;
        this.dataTex.needsUpdate = true;
        this._crystalTex = { value: this.dataTex };

        // ------------------------------------------------------- per-totem state
        /** Growth 0..1 per totem; drives every prism of that totem. */
        this._g = new Float32Array(DUMMY_COUNT);
        /** Lifecycle phase per totem (ALIVE | SHATTER | DEAD). */
        this._phase = new Uint8Array(DUMMY_COUNT);
        /** Per-prism growth stagger 0..0.25 — shards trail the column. */
        this._stag = new Float32Array(TOTAL);

        /**
         * The probe surface (harness + future HUD read this; contents mutated
         * in place, objects never reassigned — same contract as the
         * controller's `position`).
         * @type {{name:string, tier:number, id:number, hp:number, hpMax:number,
         *         poise:number, poiseMax:number, x:number, y:number, z:number,
         *         alive:boolean, respawnIn:number, kills:number}[]}
         */
        this.list = [];

        const d = this._texData;
        const w = TOTAL * 4;

        for (let di = 0; di < DUMMY_COUNT; di++) {
            const def = DEFS[di];
            const s = def.scale;
            const a = bearing + def.ang;
            const cx = spawnX + Math.sin(a) * def.r;
            const cz = spawnZ + Math.cos(a) * def.r;
            const cy = terrain.heightAt(cx, cz);

            // Column height doubles as the hit capsule height; radius covers
            // the shard ring. Geometry choices, not doc-defined combat numbers.
            const colH = 1.7 * s;

            for (let p = 0; p < PRISMS; p++) {
                const gi = di * PRISMS + p;
                let px, pz, h, rad, ax, ay, az;
                // Deterministic per-prism variation, same golden-ratio recipe
                // crystals.js uses for its seeds — no RNG, rebuilds identical.
                const f1 = (gi * 0.618034 + di * 0.377) % 1;
                const f2 = (gi * 0.618034 + 0.311) % 1;

                if (p === 0) {
                    // The column: tall, near-vertical, a hair of seed lean.
                    px = cx; pz = cz;
                    h = colH;
                    rad = 0.17 * s;
                    ax = (f1 - 0.5) * 0.1; ay = 1; az = (f2 - 0.5) * 0.1;
                } else {
                    // Five shards ringing the column, leaning outward — the
                    // totem silhouette. Ring rolled per totem so no two match.
                    const ra = (p - 1) * (Math.PI * 2 / 5) + di * 0.7;
                    const off = 0.34 * s;
                    px = cx + Math.sin(ra) * off;
                    pz = cz + Math.cos(ra) * off;
                    h = (0.62 + 0.45 * f1) * s;
                    rad = (0.09 + 0.05 * f2) * s;
                    ax = Math.sin(ra) * 0.38; ay = 1; az = Math.cos(ra) * 0.38;
                }
                const py = terrain.heightAt(px, pz) - 0.02;
                const il = 1 / Math.hypot(ax, ay, az);

                let o = gi * 4;
                d[o] = px; d[o + 1] = py; d[o + 2] = pz; d[o + 3] = h;
                o += w;
                d[o] = ax * il; d[o + 1] = ay * il; d[o + 2] = az * il; d[o + 3] = rad;
                o += w;
                // (growth, seed, -, -): growth starts 0 and animates in update.
                d[o] = 0;
                d[o + 1] = (gi * 0.618034 + px * 0.137 + pz * 0.311) % 1;
                d[o + 2] = 0;
                d[o + 3] = 0;

                this._stag[gi] = p === 0 ? 0 : 0.05 + 0.04 * p;
            }

            const id = registry.register({
                x: cx, y: cy, z: cz,
                radius: 0.5 * s, height: colH,
                tier: def.tier, level: 10,
                hp: def.hp, poiseMax: def.poise,
                name: def.name, kind: "dummy",
            });

            this._phase[di] = ALIVE;
            this._g[di] = 0;
            this.list.push({
                name: def.name, tier: def.tier, id,
                hp: def.hp, hpMax: def.hp,
                poise: def.poise, poiseMax: def.poise,
                x: cx, y: cy, z: cz,
                alive: true, respawnIn: 0, kills: 0,
            });
        }

        // ------------------------------------------------------------- material
        // Uniforms are built OVER the spell ice's merged block, so the globals
        // (`lib/common`), sky, cascade receivers, fog and spell-light boxes are
        // the same live objects — updated once per frame by their owners. Only
        // `crystalTex` is ours. Cached refs to the four shading knobs let this
        // module keep them fresh even on frames where no spell ice is visible
        // (crystals only pushes them while its own mesh draws).
        const base = crystals.material.uniforms;
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            uniforms: Object.assign({}, base, { crystalTex: this._crystalTex }),
            // Same state block as crystals.js, same reasons: degenerate dead
            // prisms + thin growing ones make culling a net loss; blended AND
            // depth-writing is what lets snow show through without prisms
            // blending over each other.
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NormalBlending,
            premultipliedAlpha: false,
        });
        this._shading = {
            sss: this.material.uniforms.sssStrength,
            sssRadius: this.material.uniforms.sssRadius,
            glint: this.material.uniforms.glintIntensity,
            grazing: this.material.uniforms.glintGrazing,
        };

        this.mesh = new THREE.Mesh(buildMesh(), this.material);
        this.mesh.name = "trainingDummies";
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        // With the spell ice (renderOrder 1): after the terrain, before the
        // water and the spray — the same slot the crystal state was tuned for.
        this.mesh.renderOrder = 1;
        crystals.scene.add(this.mesh);

        // Shadow casters — the identical `crystalPoint()` depth stage, so the
        // shadow grows and shatters with the totem (crystals.js pattern).
        /** @type {THREE.RawShaderMaterial[]} */
        this._depthMats = [];
        crystals.shadows.registerCaster(this.mesh, (c) => {
            const m = crystals.shadows.makeCasterMaterial(
                depthVertex,
                { crystalTex: this._crystalTex },
                { defines: { CRYSTAL_CASCADE: c } }
            );
            this._depthMats.push(m);
            return m;
        }, DUMMY_CASCADES);
        // NOT registered with the depth prepass: dummies would need the depth
        // pass instance, which this room deliberately does not depend on. Cost:
        // no specular-mask/SSR entry for totems — matte consequences only.

        /** Prisms currently non-degenerate, for the triangle report. */
        this.liveCount = 0;
        this._dirty = true;
    }

    /**
     * One frame: lifecycle machine + growth animation + probe mirror.
     * Runs AFTER spells.update (so a kill this frame is seen this frame) and
     * before the registry's endFrame(). Strict no-op at dt === 0, per the
     * combat freeze rule (§9.2).
     * @param {number} dt seconds
     * @returns {void}
     */
    update(dt) {
        if (dt === 0) return;

        // Keep the shared shading knobs live even when no spell ice draws.
        // Same values crystals pushes; shared boxes, scalar writes only.
        this._shading.sss.value = S.sssStrength;
        this._shading.sssRadius.value = S.sssRadius;
        this._shading.glint.value = S.glintIntensity;
        this._shading.grazing.value = S.glintGrazing;

        const reg = this.registry;
        let changed = this._dirty;
        let live = 0;

        for (let di = 0; di < DUMMY_COUNT; di++) {
            const dum = this.list[di];
            const phase = this._phase[di];

            if (phase === ALIVE) {
                const slot = reg.slot(dum.id);
                if (slot < 0 || reg.hp[slot] <= 0) {
                    // Killed (or the slot was reaped externally): shatter.
                    if (slot >= 0) reg.remove(dum.id);
                    dum.id = -1;
                    dum.alive = false;
                    dum.hp = 0;
                    dum.kills++;
                    dum.respawnIn = RESPAWN_S;
                    this._phase[di] = SHATTER;
                } else {
                    dum.hp = reg.hp[slot];
                    dum.poise = reg.poise[slot];
                    if (this._g[di] < 1) {
                        this._g[di] = Math.min(1, this._g[di] + dt / GROW_S);
                        this._writeGrowth(di);
                        changed = true;
                    }
                }
            }

            if (this._phase[di] === SHATTER) {
                dum.respawnIn = Math.max(0, dum.respawnIn - dt);
                this._g[di] = Math.max(0, this._g[di] - dt / SHATTER_S);
                this._writeGrowth(di);
                changed = true;
                if (this._g[di] === 0) this._phase[di] = DEAD;
            } else if (this._phase[di] === DEAD) {
                dum.respawnIn = Math.max(0, dum.respawnIn - dt);
                if (dum.respawnIn === 0) {
                    const def = DEFS[di];
                    const id = reg.register({
                        x: dum.x, y: dum.y, z: dum.z,
                        radius: 0.5 * def.scale, height: 1.7 * def.scale,
                        tier: def.tier, level: 10,
                        hp: def.hp, poiseMax: def.poise,
                        name: def.name, kind: "dummy",
                    });
                    if (id === -1) {
                        // Registry full — retry shortly rather than dropping
                        // the totem forever. Practice room over correctness of
                        // the 8 s promise in a full-arena edge case.
                        dum.respawnIn = 0.5;
                    } else {
                        dum.id = id;
                        dum.alive = true;
                        dum.hp = def.hp;
                        dum.poise = def.poise;
                        this._phase[di] = ALIVE;
                        // Growth resumes from 0 next ALIVE branch pass.
                    }
                }
            }

            if (this._g[di] > 0) live += PRISMS;
        }

        this.liveCount = live;
        if (changed) {
            this.dataTex.needsUpdate = true;
            this._dirty = false;
        }
    }

    /**
     * Stamp one totem's growth into the texture, shards staggered behind the
     * column so a respawn spears up centre-first.
     * @param {number} di
     */
    _writeGrowth(di) {
        const d = this._texData;
        const growRow = TOTAL * 4 * 2;
        const g = this._g[di];
        for (let p = 0; p < PRISMS; p++) {
            const gi = di * PRISMS + p;
            const st = this._stag[gi];
            d[growRow + gi * 4] = Math.min(1, Math.max(0, (g - st) / (1 - st)));
        }
    }

    /** Triangles drawn, for the overlay's accounting (crystals.js parity). */
    get triangles() {
        return this.liveCount * (RING * 3);
    }

    /** Tear down: registry slots, mesh, geometry, materials, texture. */
    dispose() {
        for (let di = 0; di < DUMMY_COUNT; di++) {
            const dum = this.list[di];
            if (dum.id !== -1) this.registry.remove(dum.id);
            dum.id = -1;
            dum.alive = false;
        }
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
        for (let i = 0; i < this._depthMats.length; i++) this._depthMats[i].dispose();
        this.dataTex.dispose();
    }
}

/**
 * Static lattice for TOTAL prisms: `position` is (prismIndex, vertexIndex, 0),
 * the exact encoding `crystals.js` builds — 18 triangles per prism, 432 in
 * the room, one draw.
 * @returns {THREE.BufferGeometry}
 */
function buildMesh() {
    const pos = new Float32Array(TOTAL * VERTS * 3);
    const idx = new Uint32Array(TOTAL * RING * 3 * 3);

    let vi = 0;
    let ii = 0;
    for (let i = 0; i < TOTAL; i++) {
        for (let v = 0; v < VERTS; v++) {
            pos[vi++] = i;
            pos[vi++] = v;
            pos[vi++] = 0;
        }
        const b = i * VERTS;
        for (let k = 0; k < RING; k++) {
            const k2 = (k + 1) % RING;
            const b0 = b + k;
            const b1 = b + k2;
            const s0 = b + RING + k;
            const s1 = b + RING + k2;
            const apex = b + RING * 2;
            // Side quad.
            idx[ii++] = b0; idx[ii++] = s0; idx[ii++] = s1;
            idx[ii++] = b0; idx[ii++] = s1; idx[ii++] = b1;
            // Tip.
            idx[ii++] = s0; idx[ii++] = apex; idx[ii++] = s1;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}
