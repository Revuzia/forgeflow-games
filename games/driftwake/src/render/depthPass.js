/**
 * Scene depth prepass — linear view depth and a specular mask, for the post chain.
 *
 * Every screen-space effect needs to know how far away a pixel is: TAA reprojects
 * last frame's colour through it, the light shafts test occlusion along it, depth
 * of field takes its circle of confusion from it, and the screen-space
 * reflections march it and gate on the mask.
 *
 * Three's own depth machinery cannot supply it, for the same reason Babylon's
 * `DepthRenderer` could not: nothing in this scene has CPU geometry that matches
 * what is drawn. The terrain's vertices are grid indices placed by the clipmap
 * vertex shader, the character is skinned from a transform texture, the wake is a
 * lattice evaluated from a spine, and the crystals are generated from a growth
 * curve. A generic depth pass would render five undisplaced lattices. So this
 * owns the pass, exactly as the shadow cascades do, and for the same reason — a
 * caster registers the vertex program it is actually drawn with.
 *
 * =============================================================================
 * THE REGISTRATION API — five subsystems call this.
 *
 *   depthPass.registerCaster(mesh, material)
 *
 *     mesh      the beauty mesh. Its BufferGeometry is shared, not copied, and
 *               its `.visible` flag is honoured every frame. Its world matrix is
 *               NOT applied: every caster places its vertices in world space in
 *               the vertex shader.
 *
 *     material  ONE material (unlike the cascades, there is no per-cascade
 *               multiplicity), running the same vertex program the beauty pass
 *               runs. It must write `vViewZ` and `vMask` — use
 *               `depthPass.makeCasterMaterial()`, which wires the shared
 *               `prepass.glsl.js` fragment stage and the `viewProjection`
 *               uniform for you.
 *
 *               `viewProjection` MUST be the same matrix the beauty pass uses,
 *               TAA jitter included, or the depth and the colour disagree by a
 *               sub-pixel and every screen-space consumer integrates against the
 *               wrong surface. `render(camera)` recomputes it from the camera it
 *               is handed, and every caster material shares that one uniform
 *               object by reference, so there is nothing to keep in sync.
 *
 *   depthPass.makeCasterMaterial(vertexSource, uniforms, opts)
 *     opts.fragmentSource overrides the shared stage — the wake needs its own,
 *     because its erosion has to `discard` here too: a two-metre wall that is
 *     visibly half powder must not report itself to the post chain as solid.
 *
 * Registered: terrain (writes the ice mask), character body, garments, wake
 * (depth only, mask 0), ice crystals (mask 1.0 — the entire reason the channel
 * exists). Deliberately NOT registered:
 *   · shell fur — an alpha-tested 22-shell pass, and what it would contribute is
 *     a fractionally fuzzier occlusion edge on a hood rim already inside its own
 *     baked cavity;
 *   · the water body — it is translucent and refractive, so a depth for it would
 *     tell every screen-space consumer that the snow behind it is not there,
 *     which is exactly wrong for a medium you can see through;
 *   · spray particles, and the sky (the DEPTH_FAR clear covers it).
 *
 * =============================================================================
 * WHAT IS IN EACH CHANNEL — the authoritative statement is the docblock at the
 * top of `src/shaders/prepass.glsl.js`, because that is where the fragment stage
 * that writes them lives. In brief, RGBA16F:
 *   .r linear view depth in METRES (the clip-space w, carried as a varying)
 *   .g specular mask, 0 matte snow .. 1 mirror ice
 *   .b spare (0)   ·   .a spare (1)
 *
 * Nearest filtering, deliberately: every consumer reconstructs a position from
 * this, and a bilinear tap across a silhouette returns a depth that belongs to
 * neither surface — which shows up as a halo of wrong occlusion around every edge.
 *
 * Half float rather than full: the relative precision is 2^-11, so the error is
 * 0.05% of the distance — five millimetres at ten metres, fifteen centimetres at
 * three hundred. Every consumer works in units of "fraction of the distance to
 * the pixel", so that is far below anything any of them can resolve, and it
 * halves the bandwidth of a target that is written once and read a dozen times.
 */

import * as THREE from "three";
import { fail } from "../core/loading.js";
import { mark, gpuBegin, gpuEnd } from "../core/perf.js";
import { makeRT } from "../core/gfx.js";
import { shader } from "../core/glsl.js";
import { PREPASS_FRAGMENT } from "../shaders/prepass.glsl.js";

/**
 * Cleared depth, metres. Beyond the camera's 4200 m far plane, so the sky reads
 * as "nothing here" to every consumer without any of them needing a separate
 * mask, and comfortably inside half float's 65504 maximum.
 *
 * `lib/postCommon` mirrors this as `POST_FAR` with `isBackground(z) = z > 4500`.
 * Changing one without the other silently breaks four post passes.
 */
export const DEPTH_FAR = 9000;

/** The clear, as raw floats — a THREE.Color cannot express 9000. */
const CLEAR_PREPASS = new Float32Array([DEPTH_FAR, 0, 0, 1]);

const _size = new THREE.Vector2();

export class DepthPass {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {number} [width] defaults to the renderer's drawing buffer
     * @param {number} [height]
     */
    constructor(renderer, width, height) {
        this.renderer = renderer;
        this.gl = /** @type {WebGL2RenderingContext} */ (renderer.getContext());

        renderer.getDrawingBufferSize(_size);
        const w = width || _size.x;
        const h = height || _size.y;

        /**
         * True until someone calls `setSize()`. While true, `render()` tracks the
         * drawing buffer, which is what `S.resolutionScale` ultimately moves — so
         * the prepass follows the render resolution without the integrator having
         * to remember. An integrator that renders beauty into an off-screen target
         * at some other size should call `setSize()` and take ownership.
         */
        this.autoSize = width === undefined && height === undefined;

        /** Render-target size in pixels, republished for the shaders that read it. */
        this.size = new THREE.Vector2(w, h);

        this.target = makeRT(w, h, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            depthBuffer: true,
            name: "scenePrepass",
        });

        /** What the post chain binds as `depthTex`. */
        this.texture = this.target.texture;

        this.scene = new THREE.Scene();
        this.scene.matrixWorldAutoUpdate = false;

        /**
         * Shared by every caster material by reference. Recomputed in `render()`
         * from the camera it is handed — the jittered one the beauty pass uses.
         */
        this._uViewProjection = { value: new THREE.Matrix4() };

        /** @type {{mesh: THREE.Object3D, proxy: THREE.Mesh}[]} */
        this._casters = [];
        /** @type {THREE.Material[]} */
        this.materials = [];
    }

    /**
     * Build a prepass material around `vertexSource`. See the file header.
     *
     * @param {string} vertexSource GLSL ES 3.00 vertex stage; `#include` resolved
     * @param {Record<string, {value: any}>} [uniforms] merged in; `viewProjection` is added
     * @param {{defines?: Record<string, any>, fragmentSource?: string}} [opts]
     * @returns {THREE.RawShaderMaterial}
     */
    makeCasterMaterial(vertexSource, uniforms, opts) {
        const u = Object.assign({}, uniforms);
        u.viewProjection = this._uViewProjection;

        return new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertexSource),
            fragmentShader: shader((opts && opts.fragmentSource) || PREPASS_FRAGMENT),
            uniforms: u,
            defines: (opts && opts.defines) || {},
            // As with the cascades, every prepass material in the reference sets
            // backFaceCulling = false.
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });
    }

    /**
     * The shared `viewProjection` uniform object, for a caster material built by
     * hand rather than through `makeCasterMaterial`. Spread it into the material's
     * uniforms — by reference, so it never needs re-uploading by the caller.
     * @returns {Record<string, {value: any}>}
     */
    casterUniforms() {
        return { viewProjection: this._uViewProjection };
    }

    /**
     * Draw `mesh` into the prepass with `material`. See the file header.
     * @param {THREE.Object3D & {geometry?: THREE.BufferGeometry}} mesh
     * @param {THREE.Material} material
     * @returns {void}
     */
    registerCaster(mesh, material) {
        if (!mesh.geometry) {
            fail("Prepass caster has no geometry");
            throw new Error("depthPass.registerCaster: mesh has no geometry");
        }

        const proxy = new THREE.Mesh(mesh.geometry, material);
        proxy.frustumCulled = false;    // placement is in the vertex shader
        proxy.matrixAutoUpdate = false; // identity, and it stays identity

        this.scene.add(proxy);
        this._casters.push({ mesh, proxy });
        if (this.materials.indexOf(material) < 0) this.materials.push(material);
    }

    /**
     * @param {number} w
     * @param {number} h
     * @returns {void}
     */
    setSize(w, h) {
        this.autoSize = false;
        this._resize(w, h);
    }

    /**
     * @param {number} w
     * @param {number} h
     */
    _resize(w, h) {
        const iw = Math.max(1, w | 0);
        const ih = Math.max(1, h | 0);
        if (iw === this.size.x && ih === this.size.y) return;
        this.size.set(iw, ih);
        // setSize reallocates the GL texture but keeps the THREE.Texture object,
        // so the four post passes holding `depthPass.texture` stay bound.
        this.target.setSize(iw, ih);
    }

    /**
     * PASS D — linear view depth + specular mask, at full render resolution.
     *
     * @param {THREE.Camera} camera the SAME camera object the beauty pass renders
     *   with, after the TAA jitter has been written into its projection matrix and
     *   frozen for the frame. Both passes then agree to the subpixel.
     * @returns {void}
     */
    render(camera) {
        const t0 = performance.now();
        const r = this.renderer;
        const gl = this.gl;

        if (this.autoSize) {
            r.getDrawingBufferSize(_size);
            this._resize(_size.x, _size.y);
        }

        // Column-vector algebra: proj * view.
        this._uViewProjection.value.multiplyMatrices(
            camera.projectionMatrix, camera.matrixWorldInverse
        );

        for (let i = 0; i < this._casters.length; i++) {
            this._casters[i].proxy.visible = this._casters[i].mesh.visible;
        }

        const prevTarget = r.getRenderTarget();
        const prevAutoClear = r.autoClear;
        r.autoClear = false;

        gpuBegin("depth prepass (full)");
        r.setRenderTarget(this.target);
        // Depth through Three (it owns the write mask); colour through raw GL,
        // because setClearColor takes a colour-managed THREE.Color whose channels
        // are [0,1] and cannot express the 9000 m sentinel.
        r.clear(false, true, false);
        gl.clearBufferfv(gl.COLOR, 0, CLEAR_PREPASS);
        r.render(this.scene, camera);
        gpuEnd();

        r.setRenderTarget(prevTarget);
        r.autoClear = prevAutoClear;

        mark("prepass", performance.now() - t0);
    }

    /**
     * Compile and draw every registered prepass pipeline behind the loading
     * screen, so nothing compiles mid-frame. See `ShadowSystem.warmUp` for why a
     * draw and not just a compile.
     * @param {THREE.Camera} camera
     * @returns {Promise<void>}
     */
    async warmUp(camera) {
        await this.renderer.compileAsync(this.scene, camera);
        this.render(camera);
    }

    /** @returns {void} */
    dispose() {
        this.target.dispose();
        for (let i = 0; i < this.materials.length; i++) this.materials[i].dispose();
    }
}
