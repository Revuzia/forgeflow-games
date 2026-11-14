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

import { S, onChange, set as setS } from "../core/settings.js";
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
 * COLD, as the game ships — the reference point every realm multiplier is taken
 * against, so a realm row that repeats Cold's number produces a multiplier of
 * exactly 1.0 and the frame is byte-identical.
 *
 * These four are LIVE OVERLAY SLIDERS (`S.sssStrength`, `S.sssRadius`,
 * `S.glintIntensity`, `S.glintGrazing`), which is why the realm multiplies them
 * rather than overwriting them: an override would leave four dead sliders, and
 * "a lever that lies" is the exact failure `core/settings.js` was written to
 * prevent.
 */
const COLD = {
    sssStrength: 1.0,       // settings.js:79
    sssRadius: 1.0,         // settings.js:80
    glintIntensity: 0.55,   // settings.js:77
    glintGrazing: 0.72,     // settings.js:78
    fineAmplitude: 0.125,   // lib/terrain.glsl.js:282
};

/**
 * How much of lib/terrain's SASTRUGI survives in each realm, by fine mode.
 *
 * The sastrugi layer is not colour, it is shape: a corduroy of ridges streaking
 * along the wind. A sand or ash realm that left it at full amplitude would read
 * as recoloured snow however the albedo is graded, because the silhouette and
 * the normal field would still be snow's. This multiplier goes into the
 * `sastrugiAmp` CLIPMAP uniform, which both fine twins read — the vertex
 * displacement and the fragment normal — so the two never describe different
 * ground. The realm's own layer (`realmFine` in `lib/ground`) is then added on
 * top with its amplitude pre-divided by this number, so the realm's contract
 * amplitude lands exactly at the slider's default.
 *
 * Index = `fine.mode`: 0 sastrugi, 1 dune ripples, 2 crust cracks.
 */
const SASTRUGI_RESIDUE = [1.0, 0.30, 0.22];

/** @param {any} v @param {number} d @returns {number} */
function num(v, d) {
    return typeof v === "number" && isFinite(v) ? v : d;
}

/** @param {any} a @param {number} i @param {number} d @returns {number} */
function at(a, i, d) {
    return Array.isArray(a) ? num(a[i], d) : d;
}

/**
 * Write a 3-array into a Vector3 uniform, leaving it untouched if the row does
 * not carry the key. A realm row missing a field must degrade to the current
 * value, never to zero: a zeroed albedo is a black terrain, and that is exactly
 * the failure a previous attempt at this shipped.
 * @param {{value: THREE.Vector3}} u @param {any} a @returns {void}
 */
function setV3(u, a) {
    if (Array.isArray(a) && a.length >= 3
        && isFinite(a[0]) && isFinite(a[1]) && isFinite(a[2])) {
        u.value.set(a[0], a[1], a[2]);
    }
}

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

        /**
         * `lib/ground`'s block — THE REALM SURFACE.
         *
         * Every entry is seeded with the exact literal it replaced in
         * `snow.glsl.js`, quoted at the line, so the constructed state is Cold
         * and the frame is byte-identical to the one before this block existed.
         * `applyRealm()` is the only writer.
         *
         * Shared BY REFERENCE with the snow material, exactly as `sky.uniforms`
         * and `deform.uniforms` are, so one write per swap reaches the program.
         * @type {Record<string, {value:any}>}
         */
        this.realmUniforms = {
            uGroundAlbedo: { value: new THREE.Vector3(0.855, 0.885, 0.945) }, // :342
            uCompressCol: { value: new THREE.Vector3(0.62, 0.665, 0.755) },   // :348
            uIceCol: { value: new THREE.Vector3(0.42, 0.56, 0.70) },          // :353
            uLooseCol: { value: new THREE.Vector3(0.895, 0.920, 0.965) },     // :391
            uRockColA: { value: new THREE.Vector3(0.055, 0.058, 0.068) },     // :363
            uRockColB: { value: new THREE.Vector3(0.115, 0.112, 0.118) },     // :363
            // shading.glsl.js:212-213, lifted out of the function body.
            uSssShallow: { value: new THREE.Vector3(0.94, 0.965, 1.0) },
            uSssDeep: { value: new THREE.Vector3(0.55, 0.72, 1.0) },
            uCaveTint: { value: new THREE.Vector3(0.55, 0.72, 1.0) },         // :541
            // Implicit in Cold: the glint term was multiplied by nothing.
            uGlintTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
            // x roughness :343, y f0 :344, z thickness :345, w ice f0 :355
            uSurfaceParams: { value: new THREE.Vector4(0.62, 0.028, 1.0, 0.045) },
            // x compressed rough :349, y compressed thick :350,
            // z ice rough :354, w ice thick :356
            uCompressParams: { value: new THREE.Vector4(0.34, 0.35, 0.07, 0.15) },
            // x rock gate lo :360, y rock gate hi :360, z loose rough :392,
            // w sky bounce coefficient :473
            uRockParams: { value: new THREE.Vector4(0.32, 0.66, 0.78, 0.28) },
            // x wrap loose :434, y wrap compressed :434, z glint intensity
            // multiplier, w glint grazing multiplier — the last two are 1 in Cold
            // so the sliders read through untouched.
            uWrapGlint: { value: new THREE.Vector4(0.62, 0.15, 1.0, 1.0) },
            // x facet cull (shading.glsl.js:266), y tilt base, z tilt jitter
            // (:277), w EMISSIVE — 0 keeps the glint on its specular path.
            uGlintFacet: { value: new THREE.Vector4(0.62, 0.10, 0.26, 0.0) },
            uGlintCells: { value: new THREE.Vector2(0.052, 0.185) },   // :323,329
            uGlintSharp: { value: new THREE.Vector2(780.0, 1500.0) },  // :326,332
            uSssMul: { value: new THREE.Vector2(1.0, 1.0) },
            uDetailScales: { value: new THREE.Vector3(7.5, 1.7, 0.31) }, // :310,315,320
            uFineMode: { value: 0 },
            // x amplitude, y scour freq, z frag fade lo, w frag fade hi —
            // lib/terrain.glsl.js:282, :281, :339. Unread while uFineMode is 0.
            uFineA: { value: new THREE.Vector4(0.125, 0.021, 0.35, 1.6) },
            // x primary wavelength :279, y ripple amp :297, z ripple
            // wavelength :295, w exposure-fade low end :282.
            uFineB: { value: new THREE.Vector4(2.3, 0.024, 0.42, 0.45) },
        };

        /**
         * Realm state that is not a uniform: the sastrugi residue folded into
         * `sastrugiAmp` each frame, and the grain-map tiling rate, which is a
         * BAKE input rather than a shading one.
         */
        this._sastrugiMul = 1.0;
        this._grainScale = GRAIN_SCALE;
        /** Realm token last applied. Read by probes. */
        this.realmName = "cold";

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
                this.realmUniforms,
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
        // The reference's renderingGroupId 1, against the sky's 0. 1 matches the
        // mapping the wake and character specs use, and it must stay BELOW the
        // sky's renderOrder: the sky is now drawn last in the opaque queue so
        // that the depth this draw writes kills its far-range raymarch by
        // early-Z. See the long note in render/sky.js.
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
        /** [laneE] Set by `update()` on the frame a re-bake lands; see
         *  `consumeGroundDirty()`. */
        this.groundDirty = false;
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

    /**
     * Give the ground a realm.
     *
     * Takes a PLAIN OBJECT, never a module import: `Terrain` has to stay
     * constructible by tools and probes that have no realm module, and a static
     * import here would put all three realms' data on the boot path. The shape
     * is one row of `src/world/realms.js` REALMS — `{ ground, grain, glint,
     * fine }` — and every field is optional: a missing key leaves the current
     * value standing rather than writing a zero. A zeroed albedo is a black
     * terrain, which is precisely how an earlier attempt at this shipped huge
     * black patches across Cold.
     *
     * COST: one pass over ~22 uniforms, plus ONE 1024-square grain re-bake if
     * and only if the tiling rate actually moved. No geometry, no heightfield,
     * no allocation.
     *
     * @param {Object} [block] a realm row: { token, ground, grain, glint, fine }
     * @returns {void}
     */
    applyRealm(block) {
        const b = block || {};
        const u = this.realmUniforms;
        const g = b.ground || {};
        const gr = b.grain || {};
        const gl = b.glint || {};
        const fn = b.fine || {};

        if (typeof b.token === "string") this.realmName = b.token;

        // THE REALM'S OWN WIND (owner 2026-08-16). `realms.js` authors
        // `wind.direction` per realm (Cold 42, Sand 130, Ash 150) precisely so
        // each realm's sun sits the contract's 76 degrees off its wind; the
        // heightfield and every windMat in the ground shader read
        // `S.windDirection`, which nothing but the settings panel ever wrote.
        // Set it here, beside the realm's other terrain data: the `onChange`
        // subscription at the top of this file already routes a direction
        // change into the same re-bake slot `applyRealm` schedules, so the two
        // coalesce into one bake rather than two. Cold's row is the default
        // (42), so boot is byte-identical.
        const wnd = b.wind || {};
        if (typeof wnd.direction === "number") {
            setS("windDirection", wnd.direction);
        }

        setV3(u.uGroundAlbedo, g.albedo);
        setV3(u.uCompressCol, g.compressCol);
        setV3(u.uIceCol, g.iceCol);
        setV3(u.uLooseCol, g.looseCol);
        setV3(u.uRockColA, g.rockColA);
        setV3(u.uRockColB, g.rockColB);
        setV3(u.uSssShallow, g.sssShallow);
        setV3(u.uSssDeep, g.sssDeep);
        setV3(u.uCaveTint, g.caveTint);
        setV3(u.uGlintTint, gl.tint);

        const sp = u.uSurfaceParams.value;
        sp.set(num(g.roughness, sp.x), num(g.f0, sp.y),
               num(g.thickness, sp.z), num(g.iceF0, sp.w));

        const cp = u.uCompressParams.value;
        cp.set(num(g.compressRough, cp.x), num(g.compressThick, cp.y),
               num(g.iceRough, cp.z), num(g.iceThick, cp.w));

        const rp = u.uRockParams.value;
        rp.set(at(g.rockGate, 0, rp.x), at(g.rockGate, 1, rp.y),
               num(g.looseRough, rp.z), num(g.bounceCoef, rp.w));

        // The two glint knobs are MULTIPLIERS on the live sliders, so the realm
        // lands on its contract number at the default slider position and the
        // slider still works everywhere else.
        const wg = u.uWrapGlint.value;
        wg.set(at(g.wrapAmount, 0, wg.x), at(g.wrapAmount, 1, wg.y),
               num(gl.intensity, COLD.glintIntensity) / COLD.glintIntensity,
               num(gl.grazing, COLD.glintGrazing) / COLD.glintGrazing);

        const gf = u.uGlintFacet.value;
        gf.set(num(gl.facetCull, gf.x), at(gl.facetTilt, 0, gf.y),
               at(gl.facetTilt, 1, gf.z), num(gl.emissive, 0));

        u.uGlintCells.value.set(at(gl.cells, 0, u.uGlintCells.value.x),
                                at(gl.cells, 1, u.uGlintCells.value.y));
        u.uGlintSharp.value.set(at(gl.sharpness, 0, u.uGlintSharp.value.x),
                                at(gl.sharpness, 1, u.uGlintSharp.value.y));

        u.uSssMul.value.set(
            num(g.sssStrength, COLD.sssStrength) / COLD.sssStrength,
            num(g.sssRadius, COLD.sssRadius) / COLD.sssRadius
        );

        const ds = u.uDetailScales.value;
        ds.set(at(gr.detailScales, 0, ds.x), at(gr.detailScales, 1, ds.y),
               at(gr.detailScales, 2, ds.z));

        // ---- micro-relief ---------------------------------------------------
        const mode = Math.max(0, Math.min(2, Math.round(num(fn.mode, 0))));
        u.uFineMode.value = mode;
        this._sastrugiMul = SASTRUGI_RESIDUE[mode];

        const fa = u.uFineA.value;
        // Pre-divided by the residue, so `amplitude * sastrugiAmp` lands on the
        // realm's contract amplitude at S.sastrugiStrength = 1.
        fa.set(num(fn.amplitude, COLD.fineAmplitude) / this._sastrugiMul,
               num(fn.scourFreq, fa.y),
               at(fn.fragFade, 0, fa.z), at(fn.fragFade, 1, fa.w));

        const fb = u.uFineB.value;
        fb.set(num(fn.primaryScale, fb.x), num(fn.rippleAmp, fb.y),
               num(fn.rippleScale, fb.z), at(fn.exposureFade, 0, fb.w));

        // ---- grain map ------------------------------------------------------
        // A BAKE input, not a shading one: changing it means re-rendering the
        // 1024-square tile. Guarded on an actual change so a redundant
        // applyRealm() costs nothing.
        const gs = num(gr.grainScale, this._grainScale);
        if (gs !== this._grainScale) {
            this._grainScale = gs;
            this._detailPass.material.uniforms.grainScale.value = gs;
            this._detailPass.render(this.detailRT);
        }

        // ---- landform [laneE] -----------------------------------------------
        //
        // THE SHAPE OF THE GROUND, and the one realm input that is neither a
        // uniform write nor a 1024² tile: it is the 4096² macro bake plus its
        // synchronous readback. Before this, `wind.macroHeightScale` and the
        // rest of the realm's landform data reached nothing at all — the bake
        // ran once at boot off `S` and every realm stood on Cold's ground (see
        // the header of `terrain/landform.js` for the measurement).
        //
        // DEFERRED, not run here. `applyRealm` is called mid-swap with a frame
        // in flight, and `Heightfield.bake()` stalls the pipeline for a few
        // hundred milliseconds. `_rebakeDue` is the slot `update()` already
        // drains for the two settings sliders, and draining it there is also
        // what `world/shrine.js` expects: it schedules its own re-ground for a
        // few frames after a realm swap and needs the new heights to exist by
        // then. Guarded on an ACTUAL change, so re-entering the same realm — or
        // any realm whose landform is Cold's — costs nothing and re-bakes
        // nothing.
        if (this.heightfield.setLandform(b.landform)) this._rebakeDue = true;
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
            // [laneE] The ground under everything standing on it just moved by
            // metres. Consumers that cached a height re-ground themselves off
            // this edge; `world/shrine.js` already schedules its own pass a few
            // frames after a realm swap, which is why the re-bake has to land
            // inside `update()` rather than at some later idle moment.
            this.groundDirty = true;
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
        // The realm's sastrugi residue, folded into the slider rather than
        // replacing it. One uniform, read by both fine twins.
        c.sastrugiAmp.value = S.sastrugiStrength * this._sastrugiMul;

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

    /**
     * Storm-front depth at a position, 0..1. See `Heightfield.edge01`.
     * @param {number} x @param {number} z @returns {number}
     */
    edge01(x, z) {
        return this.heightfield.edge01(x, z);
    }

    /**
     * The storm's inward shove in m/s — a RETAINED object, see
     * `Heightfield.edgePush`. Zero outside the last 55 m of the disc.
     * @param {number} x @param {number} z
     * @returns {{fx:number, fz:number}}
     */
    edgePush(x, z) {
        return this.heightfield.edgePush(x, z);
    }

    /** Half-extent of the playable disc, metres. Probe + HUD surface. */
    get playRadius() { return PLAY_RADIUS; }

    /** Macro bakes run since boot. 1 until a realm reshapes the ground. */
    get rebakeCount() { return this.heightfield.bakeCount; }

    /**
     * True once since the last re-bake — the integrator's cue to re-seat
     * anything holding a stale ground height. Reading it clears it, so two
     * consumers cannot both claim the same edge.
     * @returns {boolean}
     */
    consumeGroundDirty() {
        const d = this.groundDirty === true;
        this.groundDirty = false;
        return d;
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
