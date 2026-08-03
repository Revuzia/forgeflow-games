/**
 * Cascaded shadow maps, hand-rolled.
 *
 * Three's WebGLShadowMap is perfectly good, and is not used here for a specific
 * reason — the same one that ruled out Babylon's CascadedShadowGenerator in the
 * reference: the terrain has no CPU-side geometry. Its vertices are grid indices,
 * and where they actually land is decided by the clipmap vertex shader from the
 * camera position. Any generic depth pass would render the undisplaced lattice —
 * a flat sheet at y=0 — and the terrain would shadow against a surface that does
 * not exist. The depth pass has to run the same displacement code, which means
 * owning the pass. The character (skinned from a transform texture), the cloth
 * (Catmull-Rom over simulated nodes), the wake (a lattice swept along a spine)
 * and the crystals (a growth curve) are all placed in their vertex shaders too.
 *
 * Owning it also buys the filtering: depth goes into plain R32F colour targets,
 * so PCSS can run a real blocker search. A hardware comparison sampler only ever
 * returns a pre-thresholded result, which a blocker search cannot use.
 *
 * Three cascades, not four. The fourth would cover 320 m and beyond, where the
 * aerial perspective has already compressed contrast to the point that no shadow
 * in it is legible.
 *
 * =============================================================================
 * THE REGISTRATION API — six subsystems call this.
 *
 *   shadows.registerCaster(mesh, material, cascades)
 *   shadows.registerCaster(mesh, (cascadeIndex) => material, cascades)
 *
 *     mesh      the beauty mesh. Its BufferGeometry is shared, not copied, and
 *               its `.visible` flag is honoured every frame — hide the wake and
 *               its shadow goes with it. Its world matrix is NOT applied: every
 *               caster here places its vertices in world space in the vertex
 *               shader, exactly as the reference's materials do (none of them
 *               declares a `world` uniform).
 *
 *     material  a RawShaderMaterial running THE SAME VERTEX PROGRAM the beauty
 *               pass runs, differing only in the projection matrix and the
 *               fragment stage. It must declare `uniform mat4 lightViewProjection`
 *               and have it in `material.uniforms` as a THREE.Matrix4 — this
 *               system writes into that Matrix4 in place, once per cascade, per
 *               frame. Pass a factory instead of an instance to get one material
 *               per cascade (the reference's shape: it lets each carry its own
 *               `#define`, which forces a distinct compiled program per cascade).
 *               Either form is correct; a single shared instance works because
 *               the three cascades are rendered sequentially and the matrix is
 *               re-pushed immediately before each.
 *               Set `side: THREE.DoubleSide` — every caster material in the
 *               reference sets `backFaceCulling = false`.
 *
 *     cascades  how many cascades to cast into, from the near end. Default 3.
 *               The terrain needs all three; a two-metre character does not —
 *               cascade 2 covers 330 m at 32 cm per texel, where the whole figure
 *               is two texels wide and its shadow is a grey smudge nobody can
 *               distinguish from the dune it is standing on. Skipping it saves a
 *               full re-skin and re-solve of the cloth grid per frame.
 *               Character 2, cloth 2, wake 2, crystals 2, terrain 3.
 *               Shell fur is deliberately not registered at all: its shadow lands
 *               inside the hood's own, an alpha-tested 22-shell depth pass is not
 *               cheap, and what it would contribute is a slightly fuzzier edge on
 *               a shadow already an order of magnitude softer. Water and spray
 *               are receivers only.
 *
 *   shadows.makeCasterMaterial(vertexSource, uniforms, opts)
 *     Builds a correctly configured cascade material: GLSL3, the shared depth
 *     fragment stage, DoubleSide, `lightViewProjection` already present. Use it
 *     unless you need your own fragment stage (the wake does — its erosion has to
 *     discard in the shadow pass too, or it casts the shadow of a solid wall it
 *     is not actually rendering).
 *
 *   shadows.receiverUniforms(softness, bias)
 *     The whole `lib/shadowLookup` uniform block, with the matrices, params and
 *     cascade textures SHARED BY REFERENCE across every receiver — so one
 *     `update()` reaches all six with no per-material upload bookkeeping.
 *
 * =============================================================================
 * PER-FRAME ORDER (ARCHITECTURE §4, _spec/shadows.md §2). The integrator owns it:
 *
 *   deformation.step()            ping-pong flip, and terrain must re-point the
 *                                 deform sampler on ALL of its materials — beauty,
 *                                 prepass and all three cascade materials. If one
 *                                 of them reads the previous frame's target, that
 *                                 pass places vertices on last frame's snow.
 *   sky.render()                  -> sunDir
 *   shadows.update(camera, sunDir)
 *   ...everything that consumes this frame's matrices...
 *   shadows.render()              PASS A/B/C
 *   depthPass.render(camera)      PASS D
 *   beauty                        PASS E
 */

import * as THREE from "three";
import { fail } from "../core/loading.js";
import { mark } from "../core/perf.js";
import { makeRT } from "../core/gfx.js";
import { shader } from "../core/glsl.js";
import { CASCADE_DEPTH_FRAGMENT } from "../shaders/prepass.glsl.js";

export const CASCADE_COUNT = 3;

/** Shadow map edge, texels. 3 x 2048^2 x 4 B = 48 MB of colour, plus depth. */
const RESOLUTION = 2048;

/** Far distance of each cascade, metres of view distance. */
export const SPLITS = [26, 95, 330];

/**
 * Slice overlap, and the shader's cascade blend-band start. One number, used in
 * two places that must agree: overlap the slices and the fade band has real data
 * in *both* cascades; let them drift and the band samples a cascade that does not
 * cover the pixel.
 */
const OVERLAP = 0.88;

/** Metres of slack on the cascade's lateral Y extent, covering the texel snap. */
const TEXEL_WORLD_PAD = 2;

/**
 * Metres. Absorbs carved berms, the character, and anything else standing proud
 * of the baked heightfield, at both ends of the light volume.
 */
const MARGIN = 12;

/** = -sin(2 degrees). Grazing-sun clamp: cot(0.5 deg) is 114 and runs away. */
const FY_CLAMP = -0.0349;

// ------------------------------------------------------- module-scope scratch
// Nothing below allocates once construction is done.

/** @type {THREE.Vector3[]} */
const _corners = [];
for (let i = 0; i < 8; i++) _corners.push(new THREE.Vector3());
const _center = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3();
const _lup = new THREE.Vector3();
const _edge = new THREE.Vector3();
const _invViewProj = new THREE.Matrix4();

/**
 * NDC cube corners, near face first. **GL depth range is [-1,1]**, unlike the
 * reference's WebGPU [0,1] — so the near face is z = -1, not 0 (_spec §11.2).
 */
const NDC = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];

/** Cascade clear colour: 1.0 is the far plane, so anything unwritten occludes nothing. */
const CLEAR_FAR = new Float32Array([1, 1, 1, 1]);

export class ShadowSystem {
    /**
     * @param {THREE.WebGLRenderer} renderer
     */
    constructor(renderer) {
        this.renderer = renderer;
        this.gl = /** @type {WebGL2RenderingContext} */ (renderer.getContext());

        this.resolution = RESOLUTION;
        this.texelSize = 1 / RESOLUTION;

        // Bilinear on a float texture is OES_texture_float_linear, which is not
        // core in WebGL2. index.html and gfx.checkCaps already hard-fail without
        // it, so this is belt and braces: with NearestFilter the PCSS taps are
        // still >= 1 texel apart and the only visible change is the contact edge
        // hardening by about half a texel.
        const filter = this.gl.getExtension("OES_texture_float_linear")
            ? THREE.LinearFilter
            : THREE.NearestFilter;

        /** @type {THREE.WebGLRenderTarget[]} */
        this.targets = [];
        /** @type {THREE.Scene[]} proxy scene per cascade — see the header. */
        this.scenes = [];
        /** @type {THREE.OrthographicCamera[]} */
        this.cameras = [];
        /** @type {THREE.Matrix4[]} world -> light clip, per cascade */
        this.matrices = [];
        /** @type {THREE.Vector4[]} (depthRange m, orthoWidth m, 0, 0) per cascade */
        this.params = [];
        /** @type {{mesh: THREE.Object3D, proxy: THREE.Mesh, material: any}[][]} */
        this._perCascade = [];
        /** @type {THREE.Material[]} every material we were handed, for dispose() */
        this.materials = [];

        for (let i = 0; i < CASCADE_COUNT; i++) {
            // R32F, plain colour. NOT a depth texture — see the header. A depth
            // *buffer* is still attached, for correct occlusion between casters.
            this.targets.push(makeRT(RESOLUTION, RESOLUTION, {
                type: THREE.FloatType,
                format: THREE.RedFormat,
                minFilter: filter,
                magFilter: filter,
                depthBuffer: true,
                name: "cascade" + i,
            }));

            const scene = new THREE.Scene();
            // The proxies carry no transforms and the light frustum is not the
            // camera frustum; skipping the traversal's matrix work is free.
            scene.matrixWorldAutoUpdate = false;
            this.scenes.push(scene);

            // Extents are rewritten every frame by _fitCascade.
            this.cameras.push(new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100));
            this.matrices.push(new THREE.Matrix4());
            this.params.push(new THREE.Vector4(1, 1, 0, 0));
            this._perCascade.push([]);
        }

        /** Direction the light *travels* (= -sunDir), world space, right-handed Y-up. */
        this.lightDir = new THREE.Vector3(0, -1, 0);

        /**
         * World height range the casters occupy. Feeds the light volume's depth
         * solve in `_fitCascade`; conservative until the heightfield is baked and
         * `setHeightBounds` narrows them.
         */
        this.minHeight = -60;
        this.maxHeight = 60;

        // ---- the receiver-side uniform block, shared by reference ----------
        // One object graph, handed to all six receiving materials. Three uploads
        // arrays of Matrix4/Vector4 through a globally cached scratch buffer, so
        // this allocates nothing per frame.
        this._uCascadeMatrices = { value: this.matrices };
        this._uCascadeParams = { value: this.params };
        this._uCascadeSplits = {
            value: new THREE.Vector4(SPLITS[0], SPLITS[1], SPLITS[2], SPLITS[CASCADE_COUNT - 1]),
        };
        this._uShadowTexel = { value: this.texelSize };
        this._uCascadeTex = [
            { value: this.targets[0].texture },
            { value: this.targets[1].texture },
            { value: this.targets[2].texture },
        ];
    }

    /**
     * Tell the cascade fitter how tall the world actually is. Called once after
     * the heightfield bake, as `setHeightBounds(minHeight - 4, maxHeight + 6)`.
     * @param {number} min metres
     * @param {number} max metres
     * @returns {void}
     */
    setHeightBounds(min, max) {
        this.minHeight = min;
        this.maxHeight = max;
    }

    /**
     * Build a cascade depth material around `vertexSource`. See the file header.
     *
     * @param {string} vertexSource GLSL ES 3.00 vertex stage; `#include` resolved
     * @param {Record<string, {value: any}>} [uniforms] merged in; `lightViewProjection` is added
     * @param {{defines?: Record<string, any>, fragmentSource?: string}} [opts]
     * @returns {THREE.RawShaderMaterial}
     */
    makeCasterMaterial(vertexSource, uniforms, opts) {
        const u = Object.assign({}, uniforms);
        // Written in place by render(); never reassigned, so a caller may hold it.
        u.lightViewProjection = { value: new THREE.Matrix4() };

        return new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertexSource),
            fragmentShader: shader((opts && opts.fragmentSource) || CASCADE_DEPTH_FRAGMENT),
            uniforms: u,
            defines: (opts && opts.defines) || {},
            // The reference sets backFaceCulling = false on every caster: a
            // one-sided cloth panel or wake sheet would otherwise drop out of the
            // map from the sun's side and cast nothing.
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });
    }

    /**
     * Register a shadow caster. Signature and rules: see the file header.
     *
     * @param {THREE.Object3D & {geometry?: THREE.BufferGeometry}} mesh
     * @param {THREE.Material | ((cascade: number) => THREE.Material)} material
     * @param {number} [cascades] default CASCADE_COUNT
     * @returns {void}
     */
    registerCaster(mesh, material, cascades) {
        const n = Math.min(cascades === undefined ? CASCADE_COUNT : cascades, CASCADE_COUNT);
        const geometry = mesh.geometry;

        if (!geometry) {
            fail("Shadow caster has no geometry");
            throw new Error("shadows.registerCaster: mesh has no geometry");
        }

        for (let c = 0; c < n; c++) {
            const mat = typeof material === "function" ? material(c) : material;
            const u = /** @type {any} */ (mat).uniforms;

            if (!u || !u.lightViewProjection || !u.lightViewProjection.value ||
                !u.lightViewProjection.value.isMatrix4) {
                fail("Shadow caster material lacks lightViewProjection");
                throw new Error(
                    "shadows.registerCaster: material must declare a " +
                    "lightViewProjection uniform holding a THREE.Matrix4"
                );
            }

            // Shares the beauty mesh's BufferGeometry instance — no duplicated
            // vertex buffers, and a drawRange the owner changes per frame (the
            // wake's live column count) is picked up for free.
            const proxy = new THREE.Mesh(geometry, mat);
            // The light frustum is not the camera frustum, and the terrain has no
            // meaningful bounding box — its vertices are grid indices.
            proxy.frustumCulled = false;
            // World placement happens in the vertex shader; the identity matrix
            // set at construction is the whole truth.
            proxy.matrixAutoUpdate = false;

            this.scenes[c].add(proxy);
            this._perCascade[c].push({ mesh, proxy, material: mat });
            if (this.materials.indexOf(mat) < 0) this.materials.push(mat);
        }
    }

    /**
     * The `lib/shadowLookup` uniform block for one receiving material.
     *
     * Per-material values, from _spec/shadows.md §6.5: snow 1.8 / 0.022 m,
     * character+cloth+fur 1.4 / 0.012, wake 1.5 / 0.018, crystals 1.3 / 0.012,
     * water 1.4 / 0.03, spray 1.6 / 0.05.
     *
     * @param {number} softness multiplier on the sun's angular size
     * @param {number} bias metres
     * @returns {Record<string, {value: any}>}
     */
    receiverUniforms(softness, bias) {
        return {
            cascade0: this._uCascadeTex[0],
            cascade1: this._uCascadeTex[1],
            cascade2: this._uCascadeTex[2],
            cascadeMatrices: this._uCascadeMatrices,
            cascadeParams: this._uCascadeParams,
            cascadeSplits: this._uCascadeSplits,
            shadowTexel: this._uShadowTexel,
            shadowSoftness: { value: softness },
            shadowBias: { value: bias },
        };
    }

    /**
     * Refit every cascade to the current camera frustum and sun direction.
     *
     * @param {THREE.PerspectiveCamera} camera the beauty camera
     * @param {THREE.Vector3} sunDir unit vector pointing *toward* the sun
     * @param {THREE.Matrix4} [projection] the camera's UNJITTERED projection.
     *   Prefer passing it: the TAA jitter is sub-pixel and harmless to the fit,
     *   but it does add noise to `radius`, which the relative quantisation in
     *   step 4 exists to reject. Defaults to `camera.projectionMatrix`.
     * @returns {void}
     */
    update(camera, sunDir, projection) {
        const t0 = performance.now();

        this.lightDir.copy(sunDir).multiplyScalar(-1).normalize();

        const proj = projection || camera.projectionMatrix;
        _invViewProj.multiplyMatrices(proj, camera.matrixWorldInverse).invert();

        const camNear = camera.near;
        // The camera's *far plane*, not the last cascade split: _fitCascade
        // re-parameterises the frustum's corner edges, which run near..far, so
        // that is the span each cut must be normalised against.
        const camFar = camera.far;

        let sliceNear = camNear;
        for (let c = 0; c < CASCADE_COUNT; c++) {
            const sliceFar = SPLITS[c];
            this._fitCascade(c, sliceNear, sliceFar, camNear, camFar);
            // Overlap the slices so the cross-fade band has real data in both.
            sliceNear = sliceFar * OVERLAP;
        }

        mark("shadowFit", performance.now() - t0);
    }

    /**
     * @param {number} c
     * @param {number} sliceNear
     * @param {number} sliceFar
     * @param {number} camNear
     * @param {number} camFar
     */
    _fitCascade(c, sliceNear, sliceFar, camNear, camFar) {
        // ---- 1. unproject the NDC cube ------------------------------------
        for (let i = 0; i < 8; i++) {
            const n = NDC[i];
            _corners[i].set(n[0], n[1], n[2]).applyMatrix4(_invViewProj);
        }

        // ---- 2. re-cut each of the 4 edges at the slice distances ----------
        // The unprojected corners span camNear..camFar, so the slice distances
        // are re-parameterised onto the edge rather than used directly. Note the
        // write order: farC is computed from the *unmodified* nearC first.
        const t0 = (sliceNear - camNear) / (camFar - camNear);
        const t1 = (sliceFar - camNear) / (camFar - camNear);
        for (let i = 0; i < 4; i++) {
            const nearC = _corners[i];
            const farC = _corners[i + 4];
            _edge.copy(farC).sub(nearC);
            const len = _edge.length();
            _edge.multiplyScalar(1 / len);
            farC.copy(nearC).addScaledVector(_edge, len * t1);
            nearC.addScaledVector(_edge, len * t0);
        }

        // ---- 3. bounding SPHERE, not box ----------------------------------
        // A sphere is rotation-invariant, so the fitted extent does not change as
        // the camera turns — which is what stops the shadow edges crawling when
        // you look around.
        _center.set(0, 0, 0);
        for (let i = 0; i < 8; i++) _center.add(_corners[i]);
        _center.multiplyScalar(1 / 8);

        let radius = 0;
        for (let i = 0; i < 8; i++) {
            const d = _center.distanceTo(_corners[i]);
            if (d > radius) radius = d;
        }

        // ---- 4. relative radius quantisation ------------------------------
        // Quantise the radius *relatively*, not to a fixed fraction of a metre.
        // The radius depends only on the FOV, the aspect and the two splits, but
        // it is measured by unprojecting the NDC cube through an inverted
        // view-projection, so it carries a few ULPs of round-trip noise. An
        // absolute quantum lets that noise cross a step, and a radius change
        // rescales the whole map and defeats the snapping below. 2^-8 of the
        // radius (~0.39%) sits well above the noise floor at every cascade size
        // and still tracks a real FOV change — the rig widens the FOV with speed.
        radius = Math.max(radius, 0.5);
        const q = Math.pow(2, Math.ceil(Math.log2(radius)) - 8);
        radius = Math.ceil(radius / q) * q;

        // ---- 5. degenerate-up guard ---------------------------------------
        if (Math.abs(this.lightDir.y) > 0.995) _up.set(0, 0, 1);
        else _up.set(0, 1, 0);

        // ---- 6. the light's lateral basis ---------------------------------
        // HANDEDNESS. These are Three's right-handed light-view axes, i.e. exactly
        // what THREE.Camera.lookAt(center) will build below:
        //     X = normalize(lightDir x up)      (Babylon's LookAtLH uses up x fwd,
        //                                        so this is its NEGATION — the map
        //                                        is mirrored in U vs. the reference,
        //                                        which is harmless because the
        //                                        shader reconstructs the same axis)
        //     Y = X x lightDir                  (equals Babylon's, unchanged)
        // `lib/shadowLookup` recomputes these two lines verbatim in world space.
        // All three — this, the camera below, and the shader — must agree, or the
        // normal offset points sideways.
        _right.copy(this.lightDir).cross(_up).normalize();
        _lup.copy(_right).cross(this.lightDir);

        // ---- 7. WORLD-SPACE texel snap, before the view matrix exists ------
        // Quantise the cascade centre onto the shadow map's own texel lattice, in
        // world space, along the light's two lateral axes. Without it the map
        // resamples every frame and every shadow edge crawls — which TAA smears
        // rather than fixes, and which on this content shows up as the sastrugi's
        // own self-shadowing shimmering as the camera moves.
        //
        // This has to happen HERE, before the light view matrix is built. Snapping
        // afterwards by projecting the centre through the matrix that was built to
        // look at it is self-referential: that maps it to light-space (0, 0,
        // backoff) by construction, so both quantised coordinates are identically
        // zero and the snap does nothing.
        //
        // Only the two lateral axes are quantised; the along-light coordinate is
        // left continuous. Mirroring _right (step 6) does not disturb this: a
        // multiple of texelWorld along -X is still a multiple along +X.
        const texelWorld = (radius * 2) / RESOLUTION;
        const cr = Math.floor(_center.dot(_right) / texelWorld) * texelWorld;
        const cu = Math.floor(_center.dot(_lup) / texelWorld) * texelWorld;
        const cf = _center.dot(this.lightDir);   // NOT quantised
        _center.set(
            _right.x * cr + _lup.x * cu + this.lightDir.x * cf,
            _right.y * cr + _lup.y * cu + this.lightDir.y * cf,
            _right.z * cr + _lup.z * cu + this.lightDir.z * cf
        );

        // ---- 8. solve the light volume's depth range (do NOT budget it) ----
        // At a grazing sun the ground lies almost *along* the light: it gains
        // cot(elevation) metres of light-space depth per metre travelled across
        // the light's view, which at 13 degrees is 4.33. Across cascade 2 that is
        // thousands of metres, so any fixed budget clips most of the terrain out
        // of the depth map — and because `radius` is fitted to the camera frustum,
        // the clipping planes then move whenever the camera turns.
        //
        // _right is horizontal by construction (it is a cross product with world
        // up), so a point's height depends only on its light-space Y and its
        // depth:  p.y - c.y = yRel * up.y + depth * fwd.y. Rearranged for depth
        // and evaluated at the four combinations of the box's Y extent and the
        // terrain's height extent, that is the exact range of light-space depth
        // the snow can occupy inside this cascade.
        const fy = Math.min(this.lightDir.y, FY_CLAMP);
        const relief = radius + TEXEL_WORLD_PAD;

        let gMin = Infinity;
        let gMax = -Infinity;
        for (let i = 0; i < 4; i++) {
            const yRel = i < 2 ? -relief : relief;
            const py = i % 2 === 0 ? this.minHeight : this.maxHeight;
            const g = (py - _center.y - yRel * _lup.y) / fy;
            if (g < gMin) gMin = g;
            if (g > gMax) gMax = g;
        }

        // ---- 9. eye placement and clip planes -----------------------------
        const backoff = MARGIN - gMin;
        _eye.copy(this.lightDir).multiplyScalar(-backoff).add(_center);

        const near = MARGIN * 0.5;
        const far = backoff + gMax + MARGIN;

        const cam = this.cameras[c];
        cam.left = -radius;
        cam.right = radius;
        cam.top = radius;
        cam.bottom = -radius;
        cam.near = near;
        cam.far = far;
        cam.updateProjectionMatrix();
        cam.up.copy(_up);
        cam.position.copy(_eye);
        // Right-handed: view forward is -Z, so this produces the basis in step 6.
        // No halfZRange equivalent and none wanted — GL clips at z in [-1,1] and a
        // stock OrthographicCamera is already correct (_spec §11.2). The receiver
        // remaps ndc.z to [0,1] once, after the divide.
        cam.lookAt(_center);
        cam.updateMatrixWorld(true);

        // Column-vector algebra: proj * view. (Babylon composes view.multiplyToRef
        // (proj) because it is row-vector; the rule is Babylon A*B => GLSL B*A.)
        this.matrices[c].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

        // World-space extents, so the shader's penumbra estimate is in metres:
        //   .x depthRange — metres spanned by stored depth 0..1
        //   .y orthoWidth — metres spanned by UV 0..1
        this.params[c].set(far - near, radius * 2, 0, 0);
    }

    /**
     * PASS A/B/C — draw every caster into its cascades.
     *
     * The per-cascade matrix is pushed here rather than in `update()` so that a
     * caster which registered ONE material for several cascades is still correct:
     * the three targets are rendered strictly in sequence, so each draw sees the
     * matrix written immediately before it.
     *
     * @returns {void}
     */
    render() {
        const t0 = performance.now();
        const r = this.renderer;
        const gl = this.gl;

        const prevTarget = r.getRenderTarget();
        const prevAutoClear = r.autoClear;
        r.autoClear = false;

        for (let c = 0; c < CASCADE_COUNT; c++) {
            const list = this._perCascade[c];
            for (let i = 0; i < list.length; i++) {
                const entry = list[i];
                // Hiding the beauty mesh hides its shadow — one flag, not two.
                entry.proxy.visible = entry.mesh.visible;
                entry.material.uniforms.lightViewProjection.value.copy(this.matrices[c]);
            }

            r.setRenderTarget(this.targets[c]);
            // Depth through Three (it manages the write mask), colour through raw
            // GL: setClearColor takes a THREE.Color, which is colour-managed, and
            // the far-plane value has to land as exactly 1.0 in an R32F buffer.
            r.clear(false, true, false);
            gl.clearBufferfv(gl.COLOR, 0, CLEAR_FAR);
            r.render(this.scenes[c], this.cameras[c]);
        }

        r.setRenderTarget(prevTarget);
        r.autoClear = prevAutoClear;

        mark("shadowRender", performance.now() - t0);
    }

    /**
     * Compile and *draw* every cascade program behind the loading screen.
     *
     * A draw, not just `compileAsync`: the D3D11 ANGLE backend the harness runs on
     * defers real specialisation until the first draw that binds the VAO, so a
     * program whose first triangle arrives when the player casts a spell is a
     * multi-hundred-millisecond freeze at exactly the wrong moment. Rendering
     * into the real R32F targets rather than a scratch RGBA16F one also means the
     * driver specialises against the attachment layout it will actually see.
     *
     * Call after the first `update()`, so the light cameras are real.
     * @returns {Promise<void>}
     */
    async warmUp() {
        for (let c = 0; c < CASCADE_COUNT; c++) {
            await this.renderer.compileAsync(this.scenes[c], this.cameras[c]);
        }
        this.render();
    }

    /** @returns {void} */
    dispose() {
        for (let i = 0; i < this.targets.length; i++) this.targets[i].dispose();
        for (let i = 0; i < this.materials.length; i++) this.materials[i].dispose();
    }
}
