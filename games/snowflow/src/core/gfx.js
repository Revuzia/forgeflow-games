/**
 * The WebGL2/Three helpers every subsystem shares: capability probe, render
 * target factories, the fullscreen pass, a float readback, and the pipeline
 * warm-up.
 *
 * The reference had no file like this because WebGPU handed it explicit
 * pipelines and Babylon handed it `ProceduralTexture`. On WebGL2 the equivalent
 * plumbing has to be written once and used everywhere — five subsystems each
 * hand-rolling a fullscreen quad is five chances to disagree about half-pixel
 * offsets, colour space or depth state.
 *
 * Allocation policy (ARCHITECTURE §0.3): nothing in this file allocates inside
 * `render()`. Everything a pass needs — geometry, camera, scene, material — is
 * built in the constructor, and the shared triangle geometry is built once for
 * the whole page. `makeRT`, `makePingPong` and `warmUp` allocate by definition;
 * they are load-time and resize-time calls only.
 */

import * as THREE from "three";
import { shader } from "./glsl.js";

// ---------------------------------------------------------------------- caps

/**
 * The capabilities whose absence stops the port dead, and nothing else.
 *
 * `EXT_color_buffer_float` makes RGBA16F/RG32F colour-renderable — every HDR
 * target and the heightfield bake render into one, so without it there is
 * literally nothing to draw into and the first `setRenderTarget` throws.
 *
 * This list is duplicated, deliberately, by the inline gate in `index.html`
 * (`noWebGL2 || noFloatRT`). It cannot be shared: that gate has to run *before*
 * the module graph loads, because on a browser without WebGL2 every line of the
 * renderer throws and the player gets a stack trace instead of the `#nogpu`
 * panel. The two lists must be edited together.
 */
const FATAL_CAPS = ["WebGL2", "EXT_color_buffer_float"];

/**
 * @typedef {Object} Caps
 * @property {boolean}  ok       **branch on this.** True when the port can run.
 *                               Equivalent to `fatal.length === 0` — a degraded
 *                               but renderable GPU reports `ok: true`.
 * @property {string[]} fatal    the missing capabilities that make `ok` false;
 *                               empty when `ok` is true. Name these in `#nogpu`.
 * @property {string[]} missing  everything absent, fatal or not — for reporting
 *                               only. Non-empty with `ok: true` means "runs, but
 *                               degraded"; never gate the boot on this.
 */

/**
 * Probe the WebGL2 capabilities the port depends on.
 *
 * Two tiers, and the distinction is the point. `EXT_color_buffer_float` is
 * fatal (see `FATAL_CAPS`). `OES_texture_float_linear` is **not**: it is what
 * allows `LinearFilter` on the FloatType heightfield, and without it the terrain
 * samples nearest and the ground steps visibly at grazing angles — worse pixels,
 * not no pixels. It is recorded in `missing` so the panel and the perf overlay
 * can name it, and the scene still resolves.
 *
 * `index.html` runs a probe of the same two tiers before any module loads, so
 * the hard failure is a panel rather than a stack trace; this one re-runs it
 * against the renderer's real context. The two agree on which capabilities are
 * fatal, but this one is the richer report — the inline copy cannot import
 * anything.
 *
 * Note `renderer.capabilities.isWebGL2` is gone in r16x+ (Three dropped WebGL1),
 * so the context type is checked directly.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @returns {Caps}
 */
export function checkCaps(renderer) {
    /** @type {string[]} */
    const missing = [];
    const gl = renderer.getContext();

    const isWebGL2 =
        typeof WebGL2RenderingContext !== "undefined" &&
        gl instanceof WebGL2RenderingContext;

    if (!isWebGL2) {
        missing.push("WebGL2");
    } else {
        if (!gl.getExtension("EXT_color_buffer_float")) missing.push("EXT_color_buffer_float");
        if (!gl.getExtension("OES_texture_float_linear")) missing.push("OES_texture_float_linear");
    }

    const fatal = missing.filter((m) => FATAL_CAPS.indexOf(m) >= 0);

    return { ok: fatal.length === 0, fatal, missing };
}

// ------------------------------------------------------------- render targets

/**
 * Render target with the defaults this project wants everywhere, so no caller
 * has to remember them.
 *
 * The two that bite if you forget them:
 *  - `colorSpace: NoColorSpace`. Everything is linear until the tonemap
 *    (ARCHITECTURE §6). A target left on SRGBColorSpace gets an sRGB encode
 *    baked in on write and the post chain then operates on gamma-space values,
 *    which mostly looks like "the bloom threshold is wrong".
 *  - `depthBuffer: false`. Most targets here are ping-pong sim buffers and post
 *    chain stages that never depth-test; a depth attachment on each of a dozen
 *    full-resolution targets is tens of megabytes of VRAM doing nothing. The
 *    beauty and prepass targets pass `depthBuffer: true` explicitly.
 *
 * @param {number} w
 * @param {number} h
 * @param {Object} [opts] any `WebGLRenderTarget` option; overrides the defaults
 * @returns {THREE.WebGLRenderTarget}
 */
export function makeRT(w, h, opts) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        colorSpace: THREE.NoColorSpace,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
        ...opts,
    });

    // Named targets make a WebGL debugger's texture list readable; free at runtime.
    if (opts && opts.name) {
        for (let i = 0; i < rt.textures.length; i++) rt.textures[i].name = opts.name;
    }

    return rt;
}

/**
 * @typedef {Object} PingPong
 * @property {THREE.WebGLRenderTarget} read  sample this
 * @property {THREE.WebGLRenderTarget} write render into this
 * @property {() => void} swap              call after the pass; allocation-free
 * @property {(w:number, h:number) => void} setSize
 * @property {() => void} dispose
 */

/**
 * A read/write pair for iterative passes — the deformation sim, the TAA history,
 * the separable blurs. `swap()` exchanges two references and nothing else, so it
 * is safe to call every frame.
 *
 * @param {number} w
 * @param {number} h
 * @param {Object} [opts] forwarded to `makeRT` for both halves
 * @returns {PingPong}
 */
export function makePingPong(w, h, opts) {
    return {
        read: makeRT(w, h, opts),
        write: makeRT(w, h, opts),

        swap() {
            const t = this.read;
            this.read = this.write;
            this.write = t;
        },

        setSize(w2, h2) {
            this.read.setSize(w2, h2);
            this.write.setSize(w2, h2);
        },

        dispose() {
            this.read.dispose();
            this.write.dispose();
        },
    };
}

// ----------------------------------------------------------- fullscreen pass

/**
 * One triangle, not a quad.
 *
 * A quad splits the screen along a diagonal, and every 2×2 quad of fragments
 * straddling that diagonal is rasterised twice — measurable on the post chain,
 * where a dozen passes run at full resolution. Worse for this project, the
 * diagonal is a derivative discontinuity: `dFdx`/`fwidth` are computed per 2×2
 * block, and the crystallise pass builds its flat facets from screen-space
 * derivatives (ARCHITECTURE §7 shot 10). One oversized triangle clipped to the
 * viewport has no interior seam at all.
 *
 * Clip space directly, no matrices: verts at (-1,-1), (3,-1), (-1,3) cover
 * [-1,1]² after clipping, and the UV falls out of the position, so there is no
 * second attribute to keep in sync.
 *
 * `position` (not `aPosition`) because Three reads `geometry.attributes.position.count`
 * to decide the draw count for a non-indexed geometry, and itemSize 3 (not 2)
 * because `computeBoundingBox`/`computeBoundingSphere` assume three components
 * if anything ever calls them.
 */
const TRI_VERTS = new Float32Array([
    -1, -1, 0,
     3, -1, 0,
    -1,  3, 0,
]);

/** @type {THREE.BufferGeometry|null} */
let triGeometry = null;

function fullScreenTriangle() {
    if (triGeometry === null) {
        triGeometry = new THREE.BufferGeometry();
        triGeometry.setAttribute("position", new THREE.BufferAttribute(TRI_VERTS, 3));
    }
    return triGeometry;
}

const TRI_VERTEX_SHADER = /* glsl */ `
precision highp float;

in vec3 position;
out vec2 vUv;

void main() {
    // The triangle spans [-1,3] in both axes, so this maps the *visible*
    // [-1,1] region to [0,1] and lets the rest be clipped away.
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * A single fullscreen fragment pass.
 *
 * The fragment source is run through `glsl.shader()`, so it may use
 * `#include "lib/..."` and gets the shared precision preamble. It receives
 * `in vec2 vUv` and must declare it, and it must declare its own outputs —
 * GLSL ES 3.00 has no `gl_FragColor`:
 *
 *     layout(location = 0) out vec4 outColor;
 */
export class FullScreenPass {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {string} fragmentSource GLSL ES 3.00 fragment stage
     * @param {Record<string, {value:any}>} [uniforms] Three-style uniform objects
     * @param {Record<string, any>} [defines] emitted as `#define k v`
     */
    constructor(renderer, fragmentSource, uniforms, defines) {
        this._renderer = renderer;

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: TRI_VERTEX_SHADER,
            fragmentShader: shader(fragmentSource),
            uniforms: uniforms || {},
            defines: defines || {},
            depthTest: false,
            depthWrite: false,
            // The triangle's third vertex is off-screen; with culling on, a
            // driver that disagrees about winding drops the whole draw.
            side: THREE.DoubleSide,
            transparent: false,
            blending: THREE.NoBlending,
        });

        this._mesh = new THREE.Mesh(fullScreenTriangle(), this.material);
        this._mesh.frustumCulled = false; // clip-space verts: the frustum test is meaningless
        this._mesh.matrixAutoUpdate = false;

        this._scene = new THREE.Scene();
        this._scene.add(this._mesh);

        // Never referenced by the shader — `renderer.render` just requires one.
        this._camera = new THREE.Camera();
    }

    /** @returns {Record<string, {value:any}>} */
    get uniforms() {
        return this.material.uniforms;
    }

    /**
     * @param {THREE.WebGLRenderTarget|null} [target] null renders to the canvas
     * @returns {void}
     */
    render(target = null) {
        const r = this._renderer;

        // Save/restore rather than assume: passes are chained, and a pass that
        // leaves the renderer pointing somewhere else breaks its caller.
        const prevTarget = r.getRenderTarget();
        const prevAutoClear = r.autoClear;

        // The triangle covers every pixel with depth test and blending off, so
        // the clear is pure bandwidth — and on an accumulation target it is
        // actively wrong.
        r.autoClear = false;

        r.setRenderTarget(target);
        r.render(this._scene, this._camera);

        r.setRenderTarget(prevTarget);
        r.autoClear = prevAutoClear;
    }

    /**
     * Update `uResolution` if this pass declares it. Called on resize; passes
     * that key off other size-derived uniforms override or extend this.
     * @param {number} w
     * @param {number} h
     * @returns {void}
     */
    setSize(w, h) {
        const u = this.material.uniforms;
        if (u.uResolution && u.uResolution.value && u.uResolution.value.isVector2) {
            u.uResolution.value.set(w, h);
        }
    }

    /**
     * Drops the material's GPU program. The triangle geometry is shared by every
     * pass on the page and is deliberately *not* disposed here.
     * @returns {void}
     */
    dispose() {
        this.material.dispose();
    }
}

// -------------------------------------------------------------------- readback

/**
 * Mirror a float render target into a `Float32Array`.
 *
 * Used at load time to build the CPU-side heightfield behind `terrain.heightAt()`
 * (ARCHITECTURE §4) — the drawn surface and the queried surface have to be the
 * same surface, and the only way to guarantee that is to read the bake back
 * rather than re-evaluate it in JS.
 *
 * Deliberately *not* `renderer.readRenderTargetPixels`: that passes the texture's
 * own type through to `readPixels`, which for a HalfFloatType target means
 * `HALF_FLOAT` and a `Uint16Array` the caller then has to decode by hand. WebGL2
 * accepts `RGBA`/`FLOAT` from any float or half-float colour buffer (that is what
 * `EXT_color_buffer_float` buys), so reading straight from the bound framebuffer
 * gives real floats for both FloatType and HalfFloatType targets.
 *
 * Always RGBA, four floats per texel, whatever the target's format — WebGL2's
 * readback format is fixed. An RG32F heightfield therefore comes back as
 * (h, material, 0, 1) per texel and the caller strides by 4. Budget for it:
 * a 4096² read is 268 MB, so read once and keep the strided copy you need.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.WebGLRenderTarget} target
 * @param {Float32Array} [out] reused if it is at least `w*h*4` long
 * @returns {Float32Array}
 */
export function readbackFloat(renderer, target, out) {
    const gl = /** @type {WebGL2RenderingContext} */ (renderer.getContext());
    const w = target.width;
    const h = target.height;
    const need = w * h * 4;

    const dst = out && out.length >= need ? out : new Float32Array(need);

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target); // binds the target's framebuffer
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, dst);
    renderer.setRenderTarget(prevTarget);

    return dst;
}

// --------------------------------------------------------------------- warm-up

/** Tiny scratch target for warm-up draws; created once, kept for the session. */
let warmTarget = null;

/**
 * Force every program in `scene` to compile *and draw* before the boot screen
 * lifts (ARCHITECTURE §4, load-time step 4).
 *
 * `compileAsync` alone is not enough. It links the programs, but several drivers
 * — the D3D11 ANGLE backend the harness runs on among them — defer the real
 * specialisation until the first draw that actually binds the VAO and the
 * uniform block. A shader that first draws when the player casts a spell is a
 * multi-hundred-millisecond freeze at exactly the wrong moment, and the
 * comparison battery would catch it as a black frame in shot 07.
 *
 * `meshes` is for objects that are not in the scene graph during boot — the
 * spell meshes, the wake, the crystals, all of which spend most of their life
 * detached or invisible. They are attached and made visible for the one warm
 * draw, then put back exactly as they were.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {THREE.Object3D[]} [meshes] extra objects to force through a draw
 * @returns {Promise<void>}
 */
export async function warmUp(renderer, scene, camera, meshes) {
    if (warmTarget === null) {
        // 16×16 with a depth buffer: big enough that nothing degenerates, small
        // enough that a full scene draw costs nothing, and depth-attached so
        // depth-testing materials link against the same attachment layout they
        // will see in the beauty pass.
        warmTarget = makeRT(16, 16, { depthBuffer: true, name: "warmUp" });
    }

    /** @type {THREE.Object3D[]} */
    const attached = [];
    /** @type {boolean[]} */
    const wasVisible = [];

    if (meshes) {
        for (let i = 0; i < meshes.length; i++) {
            const m = meshes[i];
            wasVisible.push(m.visible);
            m.visible = true;
            if (m.parent === null) {
                scene.add(m);
                attached.push(m);
            }
        }
    }

    // Lights are gathered from `scene`, so the extras must already be attached.
    await renderer.compileAsync(scene, camera);

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(warmTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);

    for (let i = 0; i < attached.length; i++) scene.remove(attached[i]);
    if (meshes) {
        for (let i = 0; i < meshes.length; i++) meshes[i].visible = wasVisible[i];
    }
}
