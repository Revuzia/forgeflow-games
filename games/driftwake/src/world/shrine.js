/**
 * The spawn shrine — the crystal monument every run starts at (owner
 * 2026-08-10: "make sure we start on one when the game begins"). One tall
 * monolith ringed by leaning shards, echoing the key-art monolith; it is the
 * visual anchor of `progression.lastShrineId = "cold_spawn"` and the point
 * CONTINUE falls back to when a save carries no position.
 *
 * PURE SET DRESSING: no registry slot, no HP, not targetable, spawns nothing.
 * The training-dummy arc that used to stand here was removed the same day
 * (owner: real enemies only); this module inherits its proven render path —
 * the exact (crystal, vertex, 0) lattice `spells/crystals.js` draws, the
 * identical 3-row RGBA32F data texture `lib/crystal`'s `crystalPoint()`
 * reads, and a RawShaderMaterial reusing the EXACT beauty stages from
 * `shaders/crystal.glsl.js`, uniforms built OVER `crystals.material.uniforms`
 * so sun, sky, cascades, fog and spell lights are the same live boxes the
 * spell ice uses. NO Three lights, NO stock materials, and the GLSL being
 * byte-identical means Three's program cache reuses the pipelines the crystal
 * warm-up already compiled.
 *
 * The formation GROWS once at boot (1.6 s, shards staggered behind the
 * column) — the monument spearing out of the drift is the "run begins" read.
 * Once settled it uploads nothing: growth is the only animated channel, and
 * the update() early-outs the moment it completes.
 *
 * Allocation per steady frame: none.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { vertex, fragment, depthVertex } from "../shaders/crystal.glsl.js";

/** Prisms: the monolith, a ring of 7 leaning shards, 4 low outliers. */
const PRISMS = 12;

/** Vertices per prism: two rings of six plus an apex — `lib/crystal`'s shape. */
const VERTS = 13;
const RING = 6;

/** Same cascade depth the spell ice draws into (crystals.js). */
const SHRINE_CASCADES = 2;

/** Boot growth: monument-slow against the spell ice's snap. */
const GROW_S = 1.6;

export class SpawnShrine {
    /**
     * Construct AFTER the spell system (the crystal material must exist) and
     * before the warm-up block, so the shared pipelines bind with everyone
     * else's behind the boot screen.
     *
     * @param {import("../terrain/terrain.js").Terrain} terrain ground heights
     * @param {import("../spells/crystals.js").CrystalField} crystals the spell
     *   ice — supplies scene, shadow system and the live shading uniforms
     * @param {number} x world x of the monolith
     * @param {number} z world z of the monolith
     */
    constructor(terrain, crystals, x, z) {
        /** The exclusion anchor `encounters._shrineNear` reads. */
        this.x = x;
        this.z = z;
        this.y = terrain.heightAt(x, z);

        /** Boot growth 0..1; drives every prism through the stagger. */
        this._g = 0;
        this._settled = false;

        // ---------------------------------------------------------- data texture
        // Identical layout to crystals.js: rows (x,y,z,height) / (axis,radius)
        // / (growth, seed, -, -).
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

        /** Per-prism growth stagger — shards trail the monolith. */
        this._stag = new Float32Array(PRISMS);

        const d = this._texData;
        const w = PRISMS * 4;

        for (let p = 0; p < PRISMS; p++) {
            let px, pz, h, rad, ax, ay, az;
            // Deterministic per-prism variation, the golden-ratio recipe
            // crystals.js uses — no RNG, rebuilds identical.
            const f1 = (p * 0.618034 + 0.377) % 1;
            const f2 = (p * 0.618034 + 0.311) % 1;

            if (p === 0) {
                // THE MONOLITH: tall, near-vertical, a hair of seed lean.
                px = x; pz = z;
                h = 3.6;
                rad = 0.34;
                ax = (f1 - 0.5) * 0.06; ay = 1; az = (f2 - 0.5) * 0.06;
                this._stag[p] = 0;
            } else if (p <= 7) {
                // Seven shards ringing it, leaning OUTWARD — petals of a
                // formation, not a palisade.
                const ra = (p - 1) * (Math.PI * 2 / 7) + 0.4;
                const off = 0.95 + 0.25 * f1;
                px = x + Math.sin(ra) * off;
                pz = z + Math.cos(ra) * off;
                h = 1.1 + 0.75 * f2;
                rad = 0.13 + 0.06 * f1;
                ax = Math.sin(ra) * 0.42; ay = 1; az = Math.cos(ra) * 0.42;
                this._stag[p] = 0.10 + 0.05 * (p - 1);
            } else {
                // Four low outliers scattered wider — the formation bleeding
                // into the drift, so the monument doesn't sit on a disc.
                const ra = (p - 8) * (Math.PI * 2 / 4) + 1.1;
                const off = 2.1 + 0.9 * f1;
                px = x + Math.sin(ra) * off;
                pz = z + Math.cos(ra) * off;
                h = 0.35 + 0.40 * f2;
                rad = 0.08 + 0.05 * f1;
                ax = Math.sin(ra) * 0.55; ay = 1; az = Math.cos(ra) * 0.55;
                this._stag[p] = 0.30 + 0.06 * (p - 8);
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

        // ------------------------------------------------------------- material
        // Built OVER the spell ice's merged uniform block (see header).
        const base = crystals.material.uniforms;
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            uniforms: Object.assign({}, base, { crystalTex: this._crystalTex }),
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
        this.mesh.name = "spawnShrine";
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 1;   // with the spell ice: terrain, then this
        crystals.scene.add(this.mesh);

        // Shadow casters — the identical `crystalPoint()` depth stage, so the
        // monument's shadow grows with it.
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
     * Boot growth only; a settled shrine is a strict no-op (no uploads, no
     * uniform writes beyond the shared shading knobs while growing).
     * @param {number} dt seconds
     * @returns {void}
     */
    update(dt) {
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
 * draw for the whole monument.
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
