/**
 * The shrine NETWORK — seven crystal monuments across the playable field
 * (owner 2026-08-14: "respawn points spread across the world — within a
 * range, spaced evenly, not TOO many"; the monument matches the realm).
 *
 * LAYOUT, DETERMINISTIC BY CONSTRUCTION (no RNG anywhere):
 *   shrine 0  the spawn monument, at the authored (x, z) the constructor is
 *             handed (5.0, 5.5 in main.js) — the game still starts on one,
 *             and `progression.lastShrineId = "cold_spawn"` still names it.
 *   1..6      a hexagon of ring shrines at RING_RADIUS (350 m) around the
 *             spawn, each NUDGED to the flattest spot within ±NUDGE_SPAN m
 *             by a build-time `terrain.heightAt` grade scan (min |∇h|, ties
 *             broken by scan order — a pure function of the heightfield).
 *             Hexagon side = radius, so adjacent ring shrines sit 350 m
 *             apart before the nudge and ≥ 270 m after it; the build
 *             asserts the >250 m spacing loudly rather than shipping a
 *             cluster.
 *
 * Every shrine is the SAME 12-prism formation the spawn monument shipped
 * with (monolith + 7 shard ring + 4 outliers), all seven packed into ONE
 * lattice mesh over ONE 84x3 RGBA32F data texture — the exact
 * (crystal, vertex, 0) encoding `spells/crystals.js` draws, `lib/crystal`'s
 * `crystalPoint()` reads, and a RawShaderMaterial whose GLSL is the spell
 * ice's beauty pair with ONE injected seam (below), uniforms built OVER
 * `crystals.material.uniforms` so sun, sky, cascades, fog and spell lights
 * stay the same live boxes. One beauty draw + two cascade draws for the
 * whole network — identical to the single shrine it replaces.
 *
 * REALM TINT (owner: "the spawn monument should MATCH THE REALM"): the
 * fragment gains `color = mix(color, color * uShrineTint, uShrineTintAmt)`
 * immediately before the aerial term, injected by a build-time string
 * transform of the imported crystal fragment (this module owns no shader
 * file; the transform THROWS if either anchor drifts, so an upstream shader
 * edit fails the boot loudly instead of silently shipping untinted).
 * `setRealm(token)` writes the tint from the realm palette rows
 * (spellSystem.js REALM_PALETTE): hue = arcInk normalised to luma 1, scaled
 * by the light row's mult, amount 0 in Cold (the shipped look, byte for
 * byte) and ~0.55 in Sand/Ash. It also schedules a re-ground: three frames
 * after a swap (the realm heightfield re-bake runs inside the next
 * `terrain.update`) every prism base is re-sampled through `heightAt` and
 * the texture re-uploaded once — an event, never a steady-frame cost.
 *
 * Steady-frame allocation: none. A settled, un-swapped network uploads
 * nothing and writes no uniforms.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { vertex, fragment, depthVertex } from "../shaders/crystal.glsl.js";
import { REALM_PALETTE } from "../spells/spellSystem.js";

/** Shrines in the network: the spawn + a hexagon of six. */
export const SHRINE_COUNT = 7;

/** Ring radius, m — the hexagon the six respawn shrines stand on. */
const RING_RADIUS = 350;

/** Flat-spot nudge: scan ±span at step, pick the min-grade point. */
const NUDGE_SPAN = 40;
const NUDGE_STEP = 8;

/** Grade sample half-width, m (central differences). */
const GRADE_E = 2;

/** The build-time spacing floor the layout must clear, m. */
const MIN_SPACING = 250;

/** Prisms per shrine: the monolith, a ring of 7 shards, 4 low outliers. */
const PRISMS_PER = 12;
const PRISMS = SHRINE_COUNT * PRISMS_PER;

/** Vertices per prism: two rings of six plus an apex — `lib/crystal`. */
const VERTS = 13;
const RING = 6;

/** Same cascade depth the spell ice draws into (crystals.js). */
const SHRINE_CASCADES = 2;

/** Boot growth: monument-slow against the spell ice's snap. */
const GROW_S = 1.6;

/** Frames to wait after a realm swap before re-grounding (the realm
 *  heightfield re-bake happens inside the next terrain.update()). */
const REGROUND_FRAMES = 3;

/** Shrine ids, index-aligned. 0 must stay "cold_spawn" — it is
 *  progression.js's never-null default. */
export const SHRINE_IDS = [
    "cold_spawn", "shrine_e", "shrine_ne", "shrine_nw",
    "shrine_w", "shrine_sw", "shrine_se",
];

/** Terrain grade |∇h| at a point — the quantity the flat-spot scan and the
 *  worldnet probe both use, central differences over 2·GRADE_E m.
 *  @param {{heightAt:(x:number,z:number)=>number}} terrain
 *  @param {number} x @param {number} z @returns {number} */
export function gradeAt(terrain, x, z) {
    const gx = (terrain.heightAt(x + GRADE_E, z) - terrain.heightAt(x - GRADE_E, z))
        / (2 * GRADE_E);
    const gz = (terrain.heightAt(x, z + GRADE_E) - terrain.heightAt(x, z - GRADE_E))
        / (2 * GRADE_E);
    return Math.hypot(gx, gz);
}

/**
 * The one shader seam this module owns: tint the lit color toward
 * `color * uShrineTint` just before aerial perspective, so the fog stays the
 * atmosphere's. Applied to the IMPORTED fragment — the crystal shader file
 * is not this lane's, so the seam lives here, and it fails loudly.
 * @returns {string}
 */
function tintedFragment() {
    const A1 = "in float vSeed;";
    const A2 = "color = aerial(color, world);";
    if (fragment.indexOf(A1) < 0 || fragment.indexOf(A2) < 0) {
        throw new Error(
            "shrine.js: crystal fragment anchors moved — re-seat the tint seam");
    }
    return fragment
        .replace(A1, A1 + "\nuniform vec3 uShrineTint;\nuniform float uShrineTintAmt;")
        .replace(A2,
            "color = mix(color, color * uShrineTint, uShrineTintAmt);\n    " + A2);
}

export class SpawnShrine {
    /**
     * Construct AFTER the spell system (the crystal material must exist) and
     * before the warm-up block, so the shared pipelines bind with everyone
     * else's behind the boot screen. Signature unchanged from the single
     * spawn shrine — main.js's construction line did not move.
     *
     * @param {import("../terrain/terrain.js").Terrain} terrain ground heights
     * @param {import("../spells/crystals.js").CrystalField} crystals the spell
     *   ice — supplies scene, shadow system and the live shading uniforms
     * @param {number} x world x of the SPAWN monolith (network center)
     * @param {number} z world z of the SPAWN monolith
     */
    constructor(terrain, crystals, x, z) {
        this.terrain = terrain;

        /** The exclusion anchor `encounters._shrineNear` reads (the spawn). */
        this.x = x;
        this.z = z;
        this.y = terrain.heightAt(x, z);

        /**
         * The network, world positions — read-only for consumers: progression
         * (respawn targets), the minimap (blips via SNOWFLOW.shrine.positions)
         * and the worldnet probe. y refreshes on re-ground.
         * @type {{id:string, x:number, z:number, y:number}[]}
         */
        this.positions = this._layout(terrain, x, z);

        /** Boot growth 0..1; drives every prism through the stagger. */
        this._g = 0;
        this._settled = false;

        /** Re-ground countdown after a realm swap; 0 = idle. */
        this._regroundIn = 0;

        /** The realm tint seam's uniforms (written by setRealm). */
        this._tint = { value: new THREE.Vector3(1, 1, 1) };
        this._tintAmt = { value: 0 };
        /** Current realm token, for probes. */
        this.realm = "cold";

        // ---------------------------------------------------------- data texture
        // Identical layout to crystals.js: rows (x,y,z,height) / (axis,radius)
        // / (growth, seed, -, -), width = all 84 prisms of the network.
        this._texData = new Float32Array(PRISMS * 3 * 4);
        this.dataTex = new THREE.DataTexture(
            this._texData, PRISMS, 3, THREE.RGBAFormat, THREE.FloatType
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

        /** Per-prism growth stagger — shards trail their monolith. */
        this._stag = new Float32Array(PRISMS);

        for (let s = 0; s < SHRINE_COUNT; s++) {
            this._buildFormation(s, this.positions[s].x, this.positions[s].z);
        }

        // ------------------------------------------------------------- material
        // Built OVER the spell ice's merged uniform block (see header); the
        // fragment carries the injected realm-tint seam.
        const base = crystals.material.uniforms;
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(tintedFragment()),
            uniforms: Object.assign({}, base, {
                crystalTex: this._crystalTex,
                uShrineTint: this._tint,
                uShrineTintAmt: this._tintAmt,
            }),
            // Same state block as crystals.js, same reasons.
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

        this.mesh = new THREE.Mesh(buildLattice(), this.material);
        this.mesh.name = "shrineNetwork";
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 1;   // with the spell ice: terrain, then this
        crystals.scene.add(this.mesh);

        // Shadow casters — the identical `crystalPoint()` depth stage, so the
        // monuments' shadows grow with them.
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
        }, SHRINE_CASCADES);
    }

    /**
     * Deterministic network layout: authored spawn + flat-nudged hexagon.
     * Pure function of the heightfield — rebuilds identical.
     * @param {import("../terrain/terrain.js").Terrain} terrain
     * @param {number} cx @param {number} cz spawn
     * @returns {{id:string, x:number, z:number, y:number}[]}
     */
    _layout(terrain, cx, cz) {
        const out = [{ id: SHRINE_IDS[0], x: cx, z: cz, y: terrain.heightAt(cx, cz) }];
        for (let k = 0; k < 6; k++) {
            const a = k * (Math.PI / 3);
            const nx = cx + Math.cos(a) * RING_RADIUS;
            const nz = cz + Math.sin(a) * RING_RADIUS;
            // Flat-spot nudge: min grade over the scan grid, ties to the
            // first-scanned cell — deterministic, no RNG.
            let bx = nx, bz = nz, bg = Infinity;
            for (let dz = -NUDGE_SPAN; dz <= NUDGE_SPAN; dz += NUDGE_STEP) {
                for (let dx = -NUDGE_SPAN; dx <= NUDGE_SPAN; dx += NUDGE_STEP) {
                    const g = gradeAt(terrain, nx + dx, nz + dz);
                    if (g < bg) { bg = g; bx = nx + dx; bz = nz + dz; }
                }
            }
            out.push({
                id: SHRINE_IDS[k + 1], x: bx, z: bz,
                y: terrain.heightAt(bx, bz),
            });
        }
        // The spacing floor is structural (radius 350, nudge ±40) — assert it
        // rather than trust it, so a future radius edit fails the boot.
        for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                const d = Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z);
                if (d < MIN_SPACING) {
                    throw new Error("shrine.js: shrines " + out[i].id + "/" +
                        out[j].id + " only " + d.toFixed(0) + " m apart");
                }
            }
        }
        return out;
    }

    /**
     * Write one shrine's 12-prism formation into the data texture — the
     * exact recipe the single spawn monument shipped with, offset to (x, z).
     * @param {number} s shrine index @param {number} x @param {number} z
     * @returns {void}
     */
    _buildFormation(s, x, z) {
        const d = this._texData;
        const w = PRISMS * 4;
        const terrain = this.terrain;

        for (let q = 0; q < PRISMS_PER; q++) {
            const p = s * PRISMS_PER + q;
            let px, pz, h, rad, ax, ay, az;
            // Deterministic per-prism variation, the golden-ratio recipe
            // crystals.js uses — no RNG, rebuilds identical.
            const f1 = (q * 0.618034 + 0.377) % 1;
            const f2 = (q * 0.618034 + 0.311) % 1;

            if (q === 0) {
                // THE MONOLITH: tall, near-vertical, a hair of seed lean.
                px = x; pz = z;
                h = 3.6;
                rad = 0.34;
                ax = (f1 - 0.5) * 0.06; ay = 1; az = (f2 - 0.5) * 0.06;
                this._stag[p] = 0;
            } else if (q <= 7) {
                // Seven shards ringing it, leaning OUTWARD — petals of a
                // formation, not a palisade.
                const ra = (q - 1) * (Math.PI * 2 / 7) + 0.4;
                const off = 0.95 + 0.25 * f1;
                px = x + Math.sin(ra) * off;
                pz = z + Math.cos(ra) * off;
                h = 1.1 + 0.75 * f2;
                rad = 0.13 + 0.06 * f1;
                ax = Math.sin(ra) * 0.42; ay = 1; az = Math.cos(ra) * 0.42;
                this._stag[p] = 0.10 + 0.05 * (q - 1);
            } else {
                // Four low outliers scattered wider — the formation bleeding
                // into the drift, so the monument doesn't sit on a disc.
                const ra = (q - 8) * (Math.PI * 2 / 4) + 1.1;
                const off = 2.1 + 0.9 * f1;
                px = x + Math.sin(ra) * off;
                pz = z + Math.cos(ra) * off;
                h = 0.35 + 0.40 * f2;
                rad = 0.08 + 0.05 * f1;
                ax = Math.sin(ra) * 0.55; ay = 1; az = Math.cos(ra) * 0.55;
                this._stag[p] = 0.30 + 0.06 * (q - 8);
            }
            const py = terrain.heightAt(px, pz) - 0.02;
            const il = 1 / Math.hypot(ax, ay, az);

            let o = p * 4;
            d[o] = px; d[o + 1] = py; d[o + 2] = pz; d[o + 3] = h;
            o += w;
            d[o] = ax * il; d[o + 1] = ay * il; d[o + 2] = az * il; d[o + 3] = rad;
            o += w;
            // (growth, seed, -, -): growth starts 0 and animates in update.
            d[o] = 0;
            d[o + 1] = (p * 0.618034 + px * 0.137 + pz * 0.311) % 1;
            d[o + 2] = 0;
            d[o + 3] = 0;
        }
    }

    /**
     * Hand the network to progression: registers all seven as respawn
     * targets WITHOUT touching `lastShrineId` (that stays the spawn until a
     * touch activates another). main.js calls this once, after Progression
     * is constructed.
     * @param {import("../progression/progression.js").Progression} progression
     * @returns {void}
     */
    register(progression) {
        for (let i = 0; i < this.positions.length; i++) {
            const p = this.positions[i];
            progression.registerShrine(p.id, p.x, p.z);
        }
    }

    /**
     * Re-tint for a realm (enterRealm hook) and schedule the re-ground.
     * Tint rows: REALM_PALETTE[token].arcInk (hue, luma-normalised) scaled
     * by the light row's mult. Cold keeps amount 0 — the shipped frost look.
     * @param {"cold"|"sand"|"ash"} token
     * @returns {void}
     */
    setRealm(token) {
        const p = REALM_PALETTE[token] || REALM_PALETTE.cold;
        const ink = p.arcInk;
        const luma = 0.2126 * ink.r + 0.7152 * ink.g + 0.0722 * ink.b;
        const m = (p.light && p.light.mult ? p.light.mult : 1) / Math.max(luma, 1e-3);
        this._tint.value.set(ink.r * m, ink.g * m, ink.b * m);
        this._tintAmt.value = token === "cold" ? 0 : 0.55;
        this.realm = token;
        this._regroundIn = REGROUND_FRAMES;
    }

    /** Re-sample every prism base against the CURRENT heightfield and upload
     *  once — the post-swap re-seat. Event-scoped. @returns {void} */
    _reground() {
        const d = this._texData;
        const terrain = this.terrain;
        for (let p = 0; p < PRISMS; p++) {
            const o = p * 4;
            d[o + 1] = terrain.heightAt(d[o], d[o + 2]) - 0.02;
        }
        for (let i = 0; i < this.positions.length; i++) {
            const s = this.positions[i];
            s.y = terrain.heightAt(s.x, s.z);
        }
        this.y = this.positions[0].y;
        this.dataTex.needsUpdate = true;
    }

    /**
     * Boot growth + the post-swap re-ground countdown. A settled, un-swapped
     * network is a strict no-op (no uploads, no uniform writes).
     * @param {number} dt seconds
     * @returns {void}
     */
    update(dt) {
        // Counted in FRAMES, not seconds: the re-bake this waits out runs
        // inside terrain.update() whether or not time is frozen.
        if (this._regroundIn > 0 && --this._regroundIn === 0) this._reground();

        if (this._settled || dt === 0) return;

        // Keep the shared shading knobs live while we animate (crystals only
        // pushes them while its own mesh draws).
        this._shading.sss.value = S.sssStrength;
        this._shading.sssRadius.value = S.sssRadius;
        this._shading.glint.value = S.glintIntensity;
        this._shading.grazing.value = S.glintGrazing;

        this._g = Math.min(1, this._g + dt / GROW_S);
        const d = this._texData;
        const growRow = PRISMS * 4 * 2;
        for (let p = 0; p < PRISMS; p++) {
            const st = this._stag[p];
            d[growRow + p * 4] =
                Math.min(1, Math.max(0, (this._g - st) / (1 - st)));
        }
        this.dataTex.needsUpdate = true;
        if (this._g >= 1) this._settled = true;
    }

    /** Triangles drawn, for the overlay's accounting. */
    get triangles() {
        return PRISMS * (RING * 3);
    }

    /** Tear down: mesh, geometry, materials, texture. */
    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
        for (let i = 0; i < this._depthMats.length; i++) this._depthMats[i].dispose();
        this.dataTex.dispose();
    }
}

/**
 * Static lattice for PRISMS prisms: `position` is (prismIndex, vertexIndex,
 * 0), the exact encoding `crystals.js` builds — 18 triangles per prism, one
 * draw for the whole network.
 * @returns {THREE.BufferGeometry}
 */
function buildLattice() {
    const pos = new Float32Array(PRISMS * VERTS * 3);
    const idx = new Uint32Array(PRISMS * RING * 3 * 3);

    let vi = 0;
    let ii = 0;
    for (let i = 0; i < PRISMS; i++) {
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
