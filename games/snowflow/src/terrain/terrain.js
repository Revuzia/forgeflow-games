/**
 * The terrain system: owns the heightfield, the clipmap mesh, the generated snow
 * grain map, the snow material, and the four depth-only materials that must place
 * a vertex exactly where the beauty pass does.
 *
 * Per frame this writes a handful of uniforms and nothing else. No geometry is
 * rebuilt, no buffer is re-uploaded, nothing is allocated.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS OWNS AND WHAT IT DOES NOT
 *
 * The reference's `Terrain` also constructed and stepped the `DeformationField`.
 * Here it does not: `terrain/deformation.js` belongs to [DEFORM] and the
 * integrator steps it (ARCHITECTURE.md §4, per-frame step 1, before the shadow
 * cascades). This class only *reads* the deformation state, through the uniform
 * block `lib/deform` declares. Pass `deform` in — the object with a `.uniforms`
 * record of `{value}` holders — and every one of the five programs shares it by
 * reference, so a ping-pong flip that reassigns `deformTex.value` reaches all of
 * them at once with no bookkeeping here.
 *
 * ---------------------------------------------------------------------------
 * INTEGRATION — what main.js has to do
 *
 *     registerShaders();                       // BEFORE constructing this
 *     const terrain = new Terrain(renderer, { sky, shadows, depthPass, deform });
 *     await terrain.build();                   // bakes; sets shadow height bounds
 *     scene.add(terrain.mesh);
 *
 *     // per frame, after deformation.step() and before shadows.render():
 *     terrain.update(camera, character.position, timeSeconds);
 *
 * `terrain.heightAt(x, z)` is live from the end of `build()` and is the surface
 * the mesh actually draws (ARCHITECTURE.md §2).
 *
 * Casters are registered in the constructor, so `shadows.render()` and
 * `depthPass.render()` pick the terrain up with no further calls.
 *
 * ---------------------------------------------------------------------------
 * ALLOCATION (ARCHITECTURE.md §0.3): everything is built in the constructor or in
 * `build()`. `update()` writes into pre-existing Vector2/Vector3/Matrix4 objects
 * and touches no allocator. `_rebake()` allocates nothing either — the readback
 * strip is retained on the Heightfield — but it is a load/slider-time call and is
 * deferred to the top of an `update()` rather than run from a settings callback,
 * so it can never land in the middle of a render.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6): no direction, basis or cross product is built
 * in this file. `lodCenter` is a world-XZ 2-vector, `uCameraPos` is copied
 * straight from the Three camera, and `uViewProj` is `projection * viewInverse`
 * in Three's own column-vector convention. The two places chirality enters the
 * subsystem are the triangle winding (`clipmapMesh.js`, handled on the CPU) and
 * the gradient-to-normal identity (`lib/shading`), and both say so at the line.
 */

import * as THREE from "three";

import { S, onChange } from "../core/settings.js";
import { bearingRad } from "../core/bearing.js";
import { resolve, shader } from "../core/glsl.js";
import { makeRT, FullScreenPass } from "../core/gfx.js";
import { nextFrame } from "../core/loading.js";

import { Heightfield, HEIGHT_RES, WORLD_SIZE, PLAY_RADIUS } from "./heightfield.js";
import {
    buildClipmapGeometry, BASE_SPACING, GRID_HALF_N, INNER_EXTENT, OUTER_EXTENT,
} from "./clipmapMesh.js";

import detailBakeFrag from "../shaders/detailBake.glsl.js";
import { vertex, cascadeVertex, prepassVertex, fragment } from "../shaders/snow.glsl.js";

/** Snow grain map edge, texels. */
const DETAIL_RES = 1024;

/**
 * Tilts a grain dome's flank to roughly 30 degrees. Higher reads as gravel,
 * lower stops registering at all.
 */
const GRAIN_SCALE = 0.013;

/**
 * Anisotropic filtering taps on the snow grain map.
 *
 * 4 is not a taste call: it is Babylon's `BaseTexture.DEFAULT_ANISOTROPIC_
 * FILTERING_LEVEL`, which is what the reference's `detailTex` runs at — probed
 * live on the deployed reference, `terrain.detailTex.anisotropicFilteringLevel`
 * = 4, against Three's `Texture.DEFAULT_ANISOTROPY` = 1 that this port silently
 * inherited. It is the single largest filtering divergence in the subsystem.
 *
 * Why it matters more here than on a normal material: all three detail scales
 * are the SAME 1024-square tile sampled through `textureGrad`, and the snow is
 * almost always seen at a grazing angle, where a pixel's world footprint is a
 * long thin sliver. Isotropic trilinear has to pick a mip for the LONG axis, so
 * it blurs away structure the short axis still resolves perfectly — the grain
 * flattens toward the horizon and the ripple field dissolves into a plastic
 * sheet, which is exactly the "detail does not survive past the near field"
 * failure. It also lets the tile beat against the pixel grid on steep faces.
 *
 * ARCHITECTURE.md §4.1 records `EXT_texture_filter_anisotropic` as present on
 * the verification GPU, so this costs nothing but bandwidth.
 */
const DETAIL_ANISOTROPY = 4;

/**
 * Shadow receiver tuning for snow, from _spec/shadows.md §6.5. The bias is in
 * metres and can stay this small because snow has no thin geometry to peter-pan,
 * which is what keeps contact shadows attached.
 */
const SHADOW_SOFTNESS = 1.8;
const SHADOW_BIAS = 0.022;

/** `S.debugView` -> the `debugMode` uniform. Order matches the snow fragment. */
const DEBUG_MODES = {
    beauty: 0, deform: 1, normals: 2, depth: 3, cascades: 4,
    footprint: 5, fineNormals: 6, shadow: 7, ndotl: 8, shadowMap: 9,
    albedo: 10,
};

/**
 * True when a `lib/` chunk has been registered.
 *
 * Used for exactly one thing: `lib/spellLights` is owned by [SPELLS] and this
 * material is one of its consumers. Until that chunk exists, resolving the snow
 * fragment throws and the whole page is blank — which during parallel
 * construction means a missing sibling subsystem hides every bug in this one. So
 * the material substitutes a zero-returning stub instead and records the fact on
 * `terrain.spellLightsBound`, which SHOULD be true in a finished port.
 *
 * `resolve()` is cached by source string, so the probe costs one map lookup after
 * the first call and leaves no state behind.
 *
 * @param {string} name
 * @returns {boolean}
 */
function chunkRegistered(name) {
    try {
        resolve('#include "' + name + '"');
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * A neutral stand-in for `lib/deform`'s uniform block, used only when no
 * `DeformationField` is supplied.
 *
 * Like the spell-light stub, this is scaffolding for parallel construction, not a
 * shipping fallback: with it in place nothing the player carves ever appears, so
 * shots 05, 06 and 07-11 lose their subject. `terrain.deformBound` records which
 * one is in use.
 *
 * @returns {Record<string, {value:any}>}
 */
function makeDeformStub() {
    const tex = new THREE.DataTexture(
        new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType
    );
    // REPEAT because lib/deform addresses toroidally with fract(); a 1x1 texture
    // makes that a no-op, but the wrap mode is part of the contract.
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    return {
        deformTex: { value: tex },
        deformCenter: { value: new THREE.Vector2() },
        deformSize: { value: 80 },
        deformTexel: { value: 80 / 2048 },
        deformDepthScale: { value: 0 },
    };
}

export class Terrain {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {Object} deps
     * @param {import("../render/sky.js").Sky} deps.sky
     * @param {import("../render/shadows.js").ShadowSystem} deps.shadows
     * @param {import("../render/depthPass.js").DepthPass} deps.depthPass
     * @param {{uniforms: Record<string, {value:any}>}} [deps.deform] the
     *   DeformationField; its `.uniforms` is shared by reference with all five
     *   programs. Omitted only while [DEFORM] is unbuilt — see `makeDeformStub`.
     * @param {Record<string, {value:any}>} [deps.spellUniforms] the 4-slot spell
     *   light block from [SPELLS]. Omitted, the pool reads as empty (GLSL zeroes
     *   an unset uniform, so `spellLightCount` is 0) and nothing is lit by it.
     */
    constructor(renderer, deps) {
        this.renderer = renderer;
        this.sky = deps.sky;
        this.shadows = deps.shadows;
        this.depthPass = deps.depthPass;

        this.heightfield = new Heightfield(renderer);

        /** Whether the real deformation field and spell-light chunk are bound. */
        this.deformBound = !!(deps.deform && deps.deform.uniforms);
        this.spellLightsBound = chunkRegistered("lib/spellLights");

        // ------------------------------------------------------- detail bake
        // RGBA8 with a full mip chain and REPEAT wrapping: the three detail scales
        // are literally this one texture at three tiling rates, and the finest is
        // under a millimetre per texel at close range, so trilinear filtering is
        // what stops it aliasing into a crawling carpet.
        this.detailRT = makeRT(DETAIL_RES, DETAIL_RES, {
            type: THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearMipmapLinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.RepeatWrapping,
            wrapT: THREE.RepeatWrapping,
            generateMipmaps: true,
            anisotropy: DETAIL_ANISOTROPY,
            name: "detailTex",
        });
        this._detailPass = new FullScreenPass(renderer, detailBakeFrag, {
            resolution: { value: DETAIL_RES },
            grainScale: { value: GRAIN_SCALE },
        });

        // ---------------------------------------------------------- geometry
        const built = buildClipmapGeometry();
        this.geometry = built.geometry;
        this.triangles = built.triangles;
        this.vertices = built.vertices;

        // ------------------------------------------------------ uniform blocks
        // Every block below is shared BY REFERENCE across the five programs, so
        // one write per frame reaches all of them. This is the whole reason the
        // beauty, cascade and prepass passes cannot disagree about where a vertex
        // is: they are not copies of the same number, they are the same number.

        /** `lib/clipmap`'s block — the four vertex programs. */
        this.clipUniforms = {
            heightTex: { value: this.heightfield.heightTex },
            auxTex: { value: this.heightfield.auxTex },
            worldOrigin: { value: this.heightfield.origin },
            worldSize: { value: WORLD_SIZE },
            heightRes: { value: HEIGHT_RES },
            lodCenter: { value: new THREE.Vector2() },
            baseSpacing: { value: BASE_SPACING },
            gridHalfN: { value: GRID_HALF_N },
            // Must match the heightfield bake exactly — see `core/bearing.js`.
            windAngle: { value: bearingRad(S.windDirection) },
            sastrugiAmp: { value: S.sastrugiStrength },
        };

        /** `lib/shading`'s block — offered to every lit surface in the scene. */
        this.shadingUniforms = {
            sssStrength: { value: S.sssStrength },
            sssRadius: { value: S.sssRadius },
            glintIntensity: { value: S.glintIntensity },
            glintGrazing: { value: S.glintGrazing },
        };

        /**
         * `lib/common`'s shared globals (ARCHITECTURE.md §3).
         *
         * Owned here rather than read from the integrator, so the terrain is
         * correct whatever order `updateGlobals()` runs in — the same choice
         * `render/sky.js` made. They are plain `{value}` objects, so an integrator
         * that wants one set for the whole frame can assign over this map before
         * the first `update()`. `uSunDir` and `uSunColor` hold live references to
         * the Sky's own vectors, so they never need copying.
         */
        this.globals = {
            uSunDir: { value: this.sky.sunDir },
            uSunColor: { value: this.sky.sunRadiance },
            uCameraPos: { value: new THREE.Vector3() },
            uTime: { value: 0 },
            uViewProj: { value: new THREE.Matrix4() },
            uResolution: { value: new THREE.Vector2(1, 1) },
        };

        this.deformUniforms = this.deformBound
            ? deps.deform.uniforms
            : makeDeformStub();

        /** Fragment-only, plus the two the vertex block also carries. */
        this._frag = {
            detailTex: { value: this.detailRT.texture },
            detailStrength: { value: S.detailNormalStrength },
            debugMode: { value: 0 },
        };

        // -------------------------------------------------------- materials
        const vsUniforms = Object.assign(
            {}, this.globals, this.clipUniforms, this.deformUniforms
        );

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment(this.spellLightsBound)),
            uniforms: Object.assign(
                {}, vsUniforms, this._frag, this.shadingUniforms,
                this.sky.uniforms,
                this.shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
                deps.spellUniforms || {}
            ),
            // The winding was flipped for Three in clipmapMesh.js, so FrontSide is
            // correct and the reference's backFaceCulling = true is preserved.
            side: THREE.FrontSide,
            depthTest: true,
            depthWrite: true,
            transparent: false,
            blending: THREE.NoBlending,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "terrain";
        // The real extent is decided in the vertex shader and the mesh is always
        // centred on the player; the CPU frustum test is meaningless here.
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        // The reference's renderingGroupId 1, against the sky's 0. The sky sets
        // renderOrder -1000, so any non-negative value orders correctly; 1 matches
        // the mapping the wake and character specs use.
        this.mesh.renderOrder = 1;

        // ----------------------------------------------------- depth casters
        // One material per cascade so each carries its own light matrix without
        // any mid-frame uniform swapping — the reference's shape, reproduced.
        /** @type {THREE.RawShaderMaterial[]} */
        this._cascadeMats = [];
        this.shadows.registerCaster(this.mesh, (c) => {
            const m = this.shadows.makeCasterMaterial(
                cascadeVertex, vsUniforms, { defines: { SNOW_CASCADE: c } }
            );
            this._cascadeMats.push(m);
            return m;
        });

        this.prepassMaterial = this.depthPass.makeCasterMaterial(
            prepassVertex, vsUniforms
        );
        this.depthPass.registerCaster(this.mesh, this.prepassMaterial);

        // ------------------------------------------------------------- state
        //
        // QUIRK-3, deliberately fixed rather than reproduced. The reference bakes
        // the 4096-square macro heightfield exactly once (its terrain.js:200 is the
        // only `bake()` call site) and subscribes to only four settings in total —
        // resolutionScale, showTerrain, showCharacter, showWake (main.js:76,122,
        // 133,144). Nothing re-bakes. So in the reference the overlay's Dune-height
        // slider is entirely DEAD, and Wind-dir moves only the fine sastrugi layer,
        // which is a per-frame uniform rather than baked data.
        //
        // Measured through the real overlay widget, not through S — the two paths
        // differ, because a direct `S.<key> =` write bypasses `set()` and every
        // subscriber (_shots/sweep/SWEEP.md, "The UI path is not the S path"):
        //
        //   Dune height 0.4 -> 1.8   port changes 75.80% of the frame; reference
        //                            0.04%, i.e. pixel-identical
        //   Wind dir    0 -> 150     port 73.91%; reference 52.72%
        //
        // Kept live because the overlay is documented as exposing every art
        // parameter as a working control, and a slider that silently does nothing
        // is worse than one that costs a re-bake. This cannot affect any
        // comparison shot: every shot in the battery runs at defaults, and the
        // re-bake only fires on a change. Flagged here because it is the port
        // doing MORE than the reference, which is the direction of departure that
        // otherwise goes unnoticed.
        this._rebakeDue = false;
        this._unsub = onChange(
            ["windDirection", "macroHeightScale"],
            () => { this._rebakeDue = true; }
        );
    }

    /**
     * Run the load-time bakes: the snow grain map, then the height field, then
     * the aux derivative field, then the CPU mirror.
     *
     * Ordering matters twice over. The aux bake differentiates the height bake, so
     * it must follow it (`Heightfield.bake` enforces that internally). And the
     * shadow system needs the *measured* vertical extent of the world to size each
     * cascade's light volume, which only exists once the mirror has been read
     * back — a bound that is quietly wrong clips geometry out of the depth map.
     *
     * @returns {Promise<void>}
     */
    async build() {
        this._detailPass.render(this.detailRT);

        // Yield once so the boot bar can paint before the 4096-square bake and its
        // synchronous readback, which together take a few hundred milliseconds.
        await nextFrame();

        this.heightfield.bake();
        this._applyHeightBounds();
    }

    /** Push the measured relief to the cascade fitter, with margin. */
    _applyHeightBounds() {
        // A margin at both ends covers carved berms and anything standing on the
        // snow — the character, the wake wall, a crystal.
        this.shadows.setHeightBounds(
            this.heightfield.minHeight - 4,
            this.heightfield.maxHeight + 6
        );
    }

    /**
     * Advance this frame's uniforms.
     *
     * The clipmap rings follow the **player**, not the viewer — see the note on
     * `lodCenter` in `lib/clipmap`. The camera is used only for the view distance
     * and the projection.
     *
     * Call AFTER `deformation.step()` (so the material samples the target written
     * this frame, not last frame's — otherwise every mark lands a frame late and
     * fast movement leaves a visible stagger) and BEFORE `shadows.render()`.
     *
     * @param {THREE.Camera} camera the same camera object the beauty pass renders
     *   with, after any TAA jitter has been written into its projection matrix and
     *   frozen for the frame. `depthPass.render()` derives its own matrix from the
     *   same camera, so the two agree to the subpixel.
     * @param {{x:number, z:number}} focus world position the clipmap centres on —
     *   the character's feet.
     * @param {number} [time] seconds, for `uTime`.
     * @returns {void}
     */
    update(camera, focus, time) {
        if (this._rebakeDue) {
            this._rebakeDue = false;
            this.heightfield.bake();
            this._applyHeightBounds();
        }

        const g = this.globals;
        g.uCameraPos.value.copy(camera.position);
        g.uViewProj.value.multiplyMatrices(
            camera.projectionMatrix, camera.matrixWorldInverse
        );
        if (time !== undefined) g.uTime.value = time;
        this.renderer.getDrawingBufferSize(_size);
        g.uResolution.value.copy(_size);

        const c = this.clipUniforms;
        // No extra snapping here; placeClipmapVertex snaps per ring already.
        c.lodCenter.value.set(focus.x, focus.z);
        c.windAngle.value = bearingRad(S.windDirection);
        c.sastrugiAmp.value = S.sastrugiStrength;

        const sh = this.shadingUniforms;
        sh.sssStrength.value = S.sssStrength;
        sh.sssRadius.value = S.sssRadius;
        sh.glintIntensity.value = S.glintIntensity;
        sh.glintGrazing.value = S.glintGrazing;

        this._frag.detailStrength.value = S.detailNormalStrength;
        this._frag.debugMode.value = DEBUG_MODES[S.debugView] || 0;

        this.material.wireframe = S.wireframe;
        this.mesh.visible = S.showTerrain;
    }

    /**
     * CPU height of the drawn surface. ARCHITECTURE.md §2.
     *
     * This is the *macro* surface — the baked landform, which is what the
     * character stands on. It deliberately excludes the analytic sastrugi (a
     * +/-12 cm ripple the feet sink into anyway) and the deformation (the
     * character's own trench, which it must not fall into). Both are the
     * reference's behaviour.
     *
     * @param {number} x @param {number} z @returns {number} metres
     */
    heightAt(x, z) {
        return this.heightfield.heightAt(x, z);
    }

    /**
     * @param {number} x @param {number} z @param {THREE.Vector3} out
     * @returns {THREE.Vector3}
     */
    normalAt(x, z, out) {
        return this.heightfield.normalAt(x, z, out);
    }

    /**
     * Clamp a position to the playable disc (620 m), in place.
     * @param {{x:number, z:number}} v @returns {void}
     */
    clampToPlayArea(v) {
        this.heightfield.clampToPlayArea(v);
    }

    /** @returns {void} */
    dispose() {
        this._unsub();
        this.geometry.dispose();
        this.material.dispose();
        for (let i = 0; i < this._cascadeMats.length; i++) {
            this._cascadeMats[i].dispose();
        }
        this.prepassMaterial.dispose();
        this._detailPass.dispose();
        this.detailRT.dispose();
        this.heightfield.dispose();
    }
}

export { PLAY_RADIUS, INNER_EXTENT, OUTER_EXTENT, WORLD_SIZE };

// ------------------------------------------------------- module-scope scratch
const _size = new THREE.Vector2();
