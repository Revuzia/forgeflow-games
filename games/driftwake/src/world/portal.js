/**
 * The REALM PORTAL — the gate that rises where a realm boss died (owner
 * 2026-08-16: "once the realm boss dies, a portal opens for the next realm").
 *
 * ONE crystal formation, built on exactly the pattern `world/shrine.js` uses,
 * for exactly the same reasons: twelve prisms packed into ONE lattice mesh
 * over ONE 12x3 RGBA32F data texture — the (crystal, vertex, 0) encoding
 * `spells/crystals.js` draws and `lib/crystal`'s `crystalPoint()` reads — and
 * a RawShaderMaterial whose GLSL is the spell ice's beauty pair with ONE
 * injected seam, its uniforms built OVER `crystals.material.uniforms` so sun,
 * sky, cascades, fog and spell lights stay the same live boxes. One draw when
 * the gate is up, ZERO when it is not (`mesh.visible = false`).
 *
 * THE SEAM (the shrine's trick, with the gate's own uniform names): the
 * fragment gains `color = mix(color, color * uPortalTint, uPortalTintAmt)`
 * immediately before the aerial term, injected by a build-time string
 * transform of the imported crystal fragment. The transform THROWS if either
 * anchor drifts, so an upstream shader edit fails the boot loudly instead of
 * silently shipping an untinted gate.
 *
 * THE TINT IS THE DESTINATION. `open(x, z, token)` takes the NEXT realm's
 * token and tints the gate with THAT realm's palette row
 * (`spellSystem.REALM_PALETTE[token].arcInk`, luma-normalised and scaled by
 * the row's light mult — the identical derivation the shrine network uses),
 * so a portal standing in the snow already reads as ochre sand or ember ash.
 * The tint amount breathes: `PULSE_BASE ± PULSE_AMP` on a PULSE_S cycle, one
 * scalar uniform write per frame while the gate is up.
 *
 * SHAPE: two tall pylons flanking a walk-through gap, and a ten-shard arch
 * ring leaning INWARD over it — the shrine's petal formation turned into a
 * doorway. Prisms grow out of the ground over GROW_S when the gate opens.
 *
 * WALKING IN: `update(dt, px, pz)` tests the player against ENTER_M (2.5 m,
 * owner) and fires `onEnter(token)` ONCE, latched — the realm change it
 * triggers is async, and a portal that fired twice would race the roster.
 *
 * Steady-frame allocation: none. A closed gate is a strict no-op.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { vertex, fragment, depthVertex } from "../shaders/crystal.glsl.js";
import { REALM_PALETTE } from "../spells/spellSystem.js";

/** Prisms: 2 pylons + a 10-shard arch. */
const PYLONS = 2;
const ARCH = 10;
const PRISMS = PYLONS + ARCH;

/** Vertices per prism — two rings of six plus an apex (`lib/crystal`). */
const VERTS = 13;
const RING = 6;

/** Gate geometry, metres. */
const GATE_HALF = 1.9;      // pylon offset from centre, half the doorway
const ARCH_R = 2.6;         // radius the arch shards stand on
const PYLON_H = 4.4;
const PYLON_R = 0.36;

/** Rise time when the gate opens, seconds. */
const GROW_S = 1.6;

/** Tint pulse: amount = base ± amp on this cycle (seconds). */
const PULSE_BASE = 0.55;
const PULSE_AMP = 0.16;
const PULSE_S = 2.6;

/** Walking within this enters the realm (owner 2026-08-16). */
const ENTER_M = 2.5;

/**
 * The one shader seam this module owns — the shrine's transform with the
 * gate's uniform names. Fails loudly if the crystal fragment moves.
 * @returns {string}
 */
function tintedFragment() {
    const A1 = "in float vSeed;";
    const A2 = "color = aerial(color, world);";
    if (fragment.indexOf(A1) < 0 || fragment.indexOf(A2) < 0) {
        throw new Error(
            "portal.js: crystal fragment anchors moved — re-seat the tint seam");
    }
    return fragment
        .replace(A1, A1 + "\nuniform vec3 uPortalTint;\nuniform float uPortalTintAmt;")
        .replace(A2,
            "color = mix(color, color * uPortalTint, uPortalTintAmt);\n    " + A2);
}

export class RealmPortal {
    /**
     * Construct alongside the shrine (after the spell system, before the
     * warm-up block) so the gate's pipeline compiles behind the loading
     * screen with everyone else's. The mesh starts hidden.
     *
     * @param {import("../terrain/terrain.js").Terrain} terrain ground heights
     * @param {import("../spells/crystals.js").CrystalField} crystals the spell
     *   ice — supplies scene, shadow system and the live shading uniforms
     */
    constructor(terrain, crystals) {
        this.terrain = terrain;

        /** Gate centre and the realm it leads to. */
        this.x = 0;
        this.z = 0;
        this.y = 0;
        /** @type {string|null} */
        this.token = null;
        /** @type {((token:string)=>void)|null} fired once, on entry. */
        this.onEnter = null;

        this._open = false;
        this._entered = false;
        /** Growth 0..1 while the gate rises. */
        this._g = 0;
        this._pulseT = 0;

        this._tint = { value: new THREE.Vector3(1, 1, 1) };
        this._tintAmt = { value: PULSE_BASE };

        // ---------------------------------------------------- data texture
        // Same layout as crystals.js / shrine.js: rows (x,y,z,height) /
        // (axis, radius) / (growth, seed, -, -).
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

        /** Per-prism growth stagger — the arch trails its pylons. */
        this._stag = new Float32Array(PRISMS);

        // Seed the formation at the origin so the warm-up draw rasterises
        // real geometry; `open()` re-seats it.
        this._build(0, 0);

        // -------------------------------------------------------- material
        const base = crystals.material.uniforms;
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(tintedFragment()),
            uniforms: Object.assign({}, base, {
                crystalTex: this._crystalTex,
                uPortalTint: this._tint,
                uPortalTintAmt: this._tintAmt,
            }),
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
        this.mesh.name = "realmPortal";
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 1;      // with the shrine and the spell ice
        this.mesh.visible = false;      // a closed gate costs zero draws
        crystals.scene.add(this.mesh);

        // Deliberately NO shadow caster: the gate is up for a few seconds of
        // a run, and two extra cascade draws for it are not worth the budget.
        // (The shrine network registers casters because it is always up.)
        this._depthVertex = depthVertex;   // kept for a future caster pass
    }

    /** Is the gate up? @returns {boolean} */
    get isOpen() { return this._open; }

    /**
     * Raise the gate at (x, z), tinted with the palette of the realm it leads
     * to. Re-opening moves it and restarts the rise.
     * @param {number} x @param {number} z
     * @param {"cold"|"sand"|"ash"} token the NEXT realm
     * @returns {void}
     */
    open(x, z, token) {
        this.x = x;
        this.z = z;
        this.y = this.terrain.heightAt(x, z);
        this.token = token;
        this._open = true;
        this._entered = false;
        this._g = 0;
        this._pulseT = 0;

        const p = REALM_PALETTE[token] || REALM_PALETTE.cold;
        const ink = p.arcInk;
        const luma = 0.2126 * ink.r + 0.7152 * ink.g + 0.0722 * ink.b;
        const m = (p.light && p.light.mult ? p.light.mult : 1) / Math.max(luma, 1e-3);
        this._tint.value.set(ink.r * m, ink.g * m, ink.b * m);
        this._tintAmt.value = PULSE_BASE;

        this._build(x, z);
        this.dataTex.needsUpdate = true;
        this.mesh.visible = true;
    }

    /** Drop the gate. @returns {void} */
    close() {
        this._open = false;
        this._entered = false;
        this.mesh.visible = false;
        this.token = null;
    }

    /**
     * One frame: rise, breathe, and test the player. A closed gate is a
     * strict no-op and allocates nothing when up.
     * @param {number} dt seconds
     * @param {number} px @param {number} pz player position
     * @returns {void}
     */
    update(dt, px, pz) {
        if (!this._open || dt <= 0) return;

        // Keep the shared shading knobs live (the spell ice only pushes them
        // while its own mesh draws) — the shrine's rule, same reason.
        this._shading.sss.value = S.sssStrength;
        this._shading.sssRadius.value = S.sssRadius;
        this._shading.glint.value = S.glintIntensity;
        this._shading.grazing.value = S.glintGrazing;

        if (this._g < 1) {
            this._g = Math.min(1, this._g + dt / GROW_S);
            const d = this._texData;
            const growRow = PRISMS * 4 * 2;
            for (let p = 0; p < PRISMS; p++) {
                const st = this._stag[p];
                d[growRow + p * 4] =
                    Math.min(1, Math.max(0, (this._g - st) / (1 - st)));
            }
            this.dataTex.needsUpdate = true;
        }

        this._pulseT += dt;
        this._tintAmt.value = PULSE_BASE +
            PULSE_AMP * Math.sin(this._pulseT * (Math.PI * 2 / PULSE_S));

        if (!this._entered) {
            const dx = px - this.x, dz = pz - this.z;
            if (dx * dx + dz * dz <= ENTER_M * ENTER_M) {
                this._entered = true;
                const t = this.token;
                if (this.onEnter && t) this.onEnter(t);
            }
        }
    }

    /**
     * Write the twelve-prism gate into the data texture at (x, z).
     * @param {number} x @param {number} z @returns {void}
     */
    _build(x, z) {
        const d = this._texData;
        const w = PRISMS * 4;
        const terrain = this.terrain;

        for (let p = 0; p < PRISMS; p++) {
            let px, pz, h, rad, ax, ay, az;
            // Deterministic per-prism variation — the golden-ratio recipe
            // crystals.js and shrine.js both use. No RNG: rebuilds identical.
            const f1 = (p * 0.618034 + 0.377) % 1;
            const f2 = (p * 0.618034 + 0.311) % 1;

            if (p < PYLONS) {
                // The two pylons: tall, near-vertical, leaning a hair apart.
                const side = p === 0 ? -1 : 1;
                px = x + side * GATE_HALF;
                pz = z;
                h = PYLON_H + 0.3 * f1;
                rad = PYLON_R;
                ax = side * 0.10; ay = 1; az = (f2 - 0.5) * 0.05;
                this._stag[p] = 0;
            } else {
                // The arch: ten shards on the ring, leaning INWARD over the
                // doorway, tallest at the crown.
                const k = p - PYLONS;
                const a = (k / ARCH) * Math.PI * 2 + 0.31;
                px = x + Math.sin(a) * ARCH_R;
                pz = z + Math.cos(a) * ARCH_R;
                h = 1.5 + 1.1 * f2;
                rad = 0.15 + 0.06 * f1;
                ax = -Math.sin(a) * 0.55; ay = 1; az = -Math.cos(a) * 0.55;
                this._stag[p] = 0.12 + 0.045 * k;
            }
            const py = terrain.heightAt(px, pz) - 0.02;
            const il = 1 / Math.hypot(ax, ay, az);

            let o = p * 4;
            d[o] = px; d[o + 1] = py; d[o + 2] = pz; d[o + 3] = h;
            o += w;
            d[o] = ax * il; d[o + 1] = ay * il; d[o + 2] = az * il; d[o + 3] = rad;
            o += w;
            d[o] = 0;                                        // growth
            d[o + 1] = (p * 0.618034 + px * 0.137 + pz * 0.311) % 1;
            d[o + 2] = 0;
            d[o + 3] = 0;
        }
    }

    /** Triangles drawn while the gate is up, for the overlay's accounting. */
    get triangles() {
        return this._open ? PRISMS * (RING * 3) : 0;
    }

    /** Probe surface. */
    get stats() {
        return {
            open: this._open, token: this.token, entered: this._entered,
            x: this.x, z: this.z, y: this.y,
            grow: this._g, tintAmt: this._tintAmt.value,
            tint: [this._tint.value.x, this._tint.value.y, this._tint.value.z],
            enterM: ENTER_M, prisms: PRISMS,
        };
    }

    /** Tear down. @returns {void} */
    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
        this.dataTex.dispose();
    }
}

/**
 * Static lattice for PRISMS prisms: `position` is (prismIndex, vertexIndex, 0)
 * — the exact encoding crystals.js builds, one draw for the whole gate.
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
            idx[ii++] = b0; idx[ii++] = s0; idx[ii++] = s1;
            idx[ii++] = b0; idx[ii++] = s1; idx[ii++] = b1;
            idx[ii++] = s0; idx[ii++] = apex; idx[ii++] = s1;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}
