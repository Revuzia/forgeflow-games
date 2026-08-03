/**
 * The terrain state buffer — persistent, additive snow deformation.
 *
 * Two RGBA16F targets ping-ponged by one full-screen pass per frame — except on
 * the frames where `_isIdentityStep` proves the pass would copy the buffer onto
 * itself, which are skipped outright
 * (`shaders/deformSim.glsl.js`). The pass scrolls, relaxes and splats in a single
 * dispatch; there is no separate clear, no copy and no readback. WebGL2 has no
 * compute and no storage textures, and it does not need them here: the reference
 * was already a single fragment pass, so the port is a `FullScreenPass` writing
 * into the write target while sampling the read target, then a swap.
 *
 * Geometry:
 *   COVERAGE metres of world, `res` texels across, centred on the PLAYER (never
 *   the camera) and snapped to texel boundaries so the field does not swim under
 *   the surface. Addressing is toroidal — a texel's UV is `fract(worldXZ / size)`
 *   — so following the player costs nothing, and the texels that wrap in from the
 *   trailing edge are detected and zeroed by the same pass that relaxes.
 *
 * Everything that touches the snow writes here through `brush()` — feet, the surf
 * wake, every spell. That shared write path is what makes the effects part of the
 * snow rather than decals floating above it.
 *
 * ===========================================================================
 * THE WRITE API — four other subsystems call this
 * ===========================================================================
 *
 *   brush(x, z, radius, depth, berm, compression, ice, yaw, elongation, edge)
 *
 *     x, z         world metres, ABSOLUTE. The shader wraps them into the window
 *                  itself, so callers never think about the toroid.
 *     radius       metres, across the SHORT axis
 *     depth        metres of depression at the centre. MAY BE NEGATIVE — Vortex
 *                  writes a negative depression on its give-back, which cancels
 *                  existing depression but can never mound the ground (the
 *                  shader clamps R at 0; mounding is the berm channel's job).
 *     berm         metres of displaced mass thrown to the rim, deposited as a
 *                  granulated Gaussian ring at 1.04 radii — not painted as a ring
 *                  in the material, but as real state that then diffuses three
 *                  times faster than the trench floor and slumps back into it.
 *     compression  0..1 added to the compression channel
 *     ice          0..1, taken as a MAX rather than added, so repeated passes
 *                  over the same ground do not saturate the glaze into a mirror
 *     yaw          radians, orients the long axis (default 0)
 *     elongation   long-axis multiple of `radius`, 1 = round (default 1)
 *     edge         0..1 rim roughness; 0 is a clean bevel (default 1)
 *
 *   Brushes accumulate additively, within the frame and across frames — the
 *   buffer is persistent. They are queued into a pre-sized staging array and
 *   consumed by the next simulation pass, then the count resets. Up to
 *   MAX_BRUSHES (96) per frame; past that they are silently dropped.
 *
 *   CALL ORDER MATTERS. Every writer must run BEFORE `update()` in the same
 *   frame, or its marks land a frame late and fast movement leaves a visible
 *   stagger. The frame order this expects is: character -> figure -> contact ->
 *   spells -> terrain (which calls `update()`) -> render.
 *
 * ===========================================================================
 * THE READ SIDE — how a consumer binds the buffer
 * ===========================================================================
 *
 *   material.uniforms = { ...myUniforms, ...deform.uniforms }
 *
 * `uniforms` holds the five `{value}` objects `lib/deform` declares
 * (`deformTex`, `deformCenter`, `deformSize`, `deformTexel`, `deformDepthScale`).
 * They are shared by reference, so `update()` refreshing them refreshes every
 * material that spread them — no per-frame rebinding of five programs, and no
 * chance of the beauty pass and a shadow cascade disagreeing about which target
 * they are reading.
 *
 * Allocation: none per frame. The brush staging array and every uniform vector
 * are sized once at construction and written in place.
 */

import * as THREE from "three";

import { S, onChange } from "../core/settings.js";
import { bearingRad } from "../core/bearing.js";
import { FullScreenPass, makePingPong } from "../core/gfx.js";
import deformSimSource from "../shaders/deformSim.glsl.js";

/**
 * Window coverage in metres: 80 m at 2048², so 3.9 cm texels.
 *
 * The trade favours area. A surf run crosses 80 m in four seconds and the whole
 * groove should stay in frame; halving the texel instead would mean a 4096²
 * target — 4x the VRAM and 4x the cost of a pass that runs every frame — to
 * resolve detail the fragment shader's grain layer already synthesises.
 */
export const COVERAGE = 80;

/** Rows in the brush data texture. Must match `deformSim.glsl.js`. */
const BRUSH_ROWS = 3;
const MAX_BRUSHES = 96;

/** Seconds of relaxation banked before it is worth applying. See `_relaxOwed`. */
const RELAX_STEP = 0.4;

export class DeformationField {
    /** @param {THREE.WebGLRenderer} renderer */
    constructor(renderer) {
        this.renderer = renderer;
        this.res = Math.max(512, S.deformResolution | 0);
        this.size = COVERAGE;
        this.texel = this.size / this.res;

        /**
         * Window centre this frame, texel-snapped.
         * `.x` is world X and `.y` is world Z — the reference's convention
         * throughout this subsystem, kept rather than renamed, because mixing
         * them produces a window that follows the player in the wrong axis and
         * is surprisingly hard to see.
         */
        this.center = new THREE.Vector2(0, 0);
        this._prevCenter = new THREE.Vector2(0, 0);
        /** Scratch for warm-up's "impossibly far away" previous centre. */
        this._far = new THREE.Vector2(0, 0);

        // ------------------------------------------------------------ brushes
        // (x, z, radius, elongation) / (cos, sin, depth, berm) /
        // (compression, ice, edgeRoughness, seed)
        this._brushData = new Float32Array(MAX_BRUSHES * BRUSH_ROWS * 4);
        this._brushCount = 0;
        this._brushDirty = false;

        /**
         * True once any brush has written a non-zero ice channel.
         *
         * Read by `post/postChain.js` to decide whether the screen-space
         * reflection pass can be skipped outright. The prepass docblock
         * (`shaders/prepass.glsl.js`) states that the specular mask is written
         * non-zero by exactly two casters — the ice crystals and the terrain's
         * own glaze — and the crystals cannot exist without a glaze first:
         * `spells/crystallize.js` `trigger()` lays `ice = 1.0` here *before* it
         * plants a single prism, deliberately, so that the ground has changed
         * material by the time the first one is visible. So this flag is a
         * superset of "the prepass mask can be non-zero anywhere", which is what
         * makes it safe to gate a pass on.
         *
         * MONOTONE, deliberately. The ice channel is written as a max and decays
         * only by leaving the deformation window, and nothing on the CPU knows
         * when the last icy texel has scrolled out — so this latches on and
         * never clears. The consequence is stated where it is consumed: the
         * saving is real until the first glazing spell of the session and zero
         * afterwards. Un-latching correctly would need a reduction of the ice
         * channel read back to the CPU, which costs more than the pass it saves.
         */
        this.iceEverBrushed = false;

        // FloatType is not optional: row 0 carries absolute world X and Z, up to
        // +/-620 m, where a half float's ULP is 0.5 m — every brush would land
        // half a metre from where it was asked for.
        this.brushTex = new THREE.DataTexture(
            this._brushData, MAX_BRUSHES, BRUSH_ROWS,
            THREE.RGBAFormat, THREE.FloatType
        );
        this.brushTex.magFilter = THREE.NearestFilter;
        this.brushTex.minFilter = THREE.NearestFilter;
        this.brushTex.wrapS = THREE.ClampToEdgeWrapping;
        this.brushTex.wrapT = THREE.ClampToEdgeWrapping;
        this.brushTex.generateMipmaps = false;
        // The shader texelFetches by row index, so the CPU's row order has to
        // survive the upload untouched.
        this.brushTex.flipY = false;
        this.brushTex.colorSpace = THREE.NoColorSpace;
        this.brushTex.name = "deformBrushes";
        this.brushTex.needsUpdate = true;

        /**
         * The uniform objects `lib/deform` declares, shared by reference with
         * every consumer material. See the header.
         */
        this.uniforms = {
            deformTex: { value: null },
            deformCenter: { value: new THREE.Vector2(0, 0) },
            deformSize: { value: this.size },
            deformTexel: { value: this.texel },
            deformDepthScale: { value: S.deformDepth },
        };

        this._pass = new FullScreenPass(
            renderer,
            deformSimSource,
            {
                prevTex: { value: null },
                brushTex: { value: this.brushTex },
                center: { value: new THREE.Vector2(0, 0) },
                prevCenter: { value: new THREE.Vector2(0, 0) },
                size: { value: this.size },
                res: { value: this.res },
                dt: { value: 0 },
                brushCount: { value: 0 },
                refillRate: { value: 1 },
                maxDepth: { value: 1 },
                maxBerm: { value: 1 },
                windAngle: { value: 0 },
            },
            { MAX_BRUSHES: MAX_BRUSHES }
        );
        // GPU profiler scope (`S.debugProfile`). This pass runs at
        // `S.deformResolution`², not at the output resolution — which is the
        // whole point of reading it next to the post chain.
        this._pass.profileName = "deform sim (2048²)";

        // -------------------------------------------------------- ping-pong
        this._pp = null;
        this._allocate(this.res);

        /**
         * Seconds of relaxation owed to the buffer but not yet spent.
         *
         * The relax terms are too slow to survive a half-float store at frame
         * cadence: a 400-second decay asks for a change well under one ULP, and
         * the rounding turns it into a ten-second decay. Time is banked here and
         * spent in steps big enough to land on a different number.
         */
        this._relaxOwed = 0;

        /**
         * The two clamp caps the last EXECUTED pass wrote with. `_isIdentityStep`
         * compares against these rather than against "the settings did not
         * change", because the clamp is only idempotent while its bounds hold
         * still: tighten `S.deformDepth` and the buffer really does have to be
         * re-clamped, even on a frame with no brushes and no relaxation.
         * NaN until the first step, so the first step can never be skipped.
         */
        this._lastMaxDepth = NaN;
        this._lastMaxBerm = NaN;

        /**
         * Diagnostic counters for the skip below — how many frames actually
         * dispatched the 2048² pass and how many proved they did not need to.
         * Read by the overlay and by `_harness/abprobe.py`; nothing reads them
         * inside the frame.
         */
        this.stepsRun = 0;
        this.stepsSkipped = 0;

        this._warmed = false;

        // The balanced preset drops the buffer to 1024². Reallocating is a
        // load-time-shaped operation, and it only ever happens from the overlay
        // or a preset switch — never from the render loop.
        this._unsubscribe = onChange("deformResolution", () => {
            const next = Math.max(512, S.deformResolution | 0);
            if (next !== this.res) this._allocate(next);
        });
    }

    /**
     * (Re)build the two state targets at `res` and zero them.
     * @param {number} res
     */
    _allocate(res) {
        if (this._pp) this._pp.dispose();

        this.res = res;
        this.texel = this.size / res;

        // RepeatWrapping is the entire toroidal scheme. Without it the addressing
        // silently becomes clamp-to-edge and marks smear off the window edge.
        this._pp = makePingPong(res, res, {
            wrapS: THREE.RepeatWrapping,
            wrapT: THREE.RepeatWrapping,
            name: "deform",
        });

        /** The target holding this frame's state. Bound by every consumer. */
        this.texture = this._pp.read.texture;

        this._pass.uniforms.res.value = res;
        this.uniforms.deformTexel.value = this.texel;
        this.uniforms.deformTex.value = this.texture;

        this._zero();
    }

    /**
     * Queue a brush for this frame. See the API block at the top of the file.
     *
     * @param {number} x world X, absolute metres
     * @param {number} z world Z, absolute metres
     * @param {number} radius metres, across the short axis
     * @param {number} depth metres of depression at the centre (may be negative)
     * @param {number} berm metres of displaced mass thrown to the rim
     * @param {number} compression 0..1 added to the compression channel
     * @param {number} ice 0..1, taken as a max rather than added
     * @param {number} [yaw] radians, orients the long axis
     * @param {number} [elongation] long-axis multiple of `radius`, 1 = round
     * @param {number} [edge] 0..1 rim roughness; 0 is a clean bevel
     * @returns {void}
     */
    brush(x, z, radius, depth, berm, compression, ice, yaw, elongation, edge) {
        if (this._brushCount >= MAX_BRUSHES) return;
        if (radius <= 0) return;

        // Outside the window entirely — nothing it could write to. The margin is
        // `radius * 2` rather than `radius * elongation * 1.6`, so a strongly
        // elongated brush right at the window edge is culled marginally early;
        // harmless, because the read-side falloff has already zeroed that region.
        const halfPlus = this.size * 0.5 + radius * 2;
        if (Math.abs(x - this.center.x) > halfPlus) return;
        if (Math.abs(z - this.center.y) > halfPlus) return;

        // Latched here rather than at the call sites: five spells and the
        // character contact all reach `brush()`, and four of them glaze.
        if (ice > 0) this.iceEverBrushed = true;

        const i = this._brushCount++;
        const d = this._brushData;
        const stride = MAX_BRUSHES * 4;
        const a = i * 4;

        const yw = yaw || 0;
        d[a] = x;
        d[a + 1] = z;
        d[a + 2] = radius;
        d[a + 3] = elongation || 1;

        d[stride + a] = Math.cos(yw);
        d[stride + a + 1] = Math.sin(yw);
        d[stride + a + 2] = depth;
        d[stride + a + 3] = berm;

        d[stride * 2 + a] = compression;
        d[stride * 2 + a + 1] = ice;
        d[stride * 2 + a + 2] = edge === undefined ? 1 : edge;
        // A POSITION HASH, not a random number: the same spot always gets the
        // same rim wobble, so a splat re-applied on consecutive frames does not
        // shimmer, while a line of footprints does not repeat one silhouette.
        // 0.37 and 0.71 are incommensurate; mod 100 keeps the value in the range
        // the noise function is well-behaved over.
        d[stride * 2 + a + 3] = (x * 0.37 + z * 0.71) % 100;

        this._brushDirty = true;
    }

    /**
     * Advance the simulation one frame and return the texture holding the result.
     *
     * Must run BEFORE anything renders this frame: every consumer in the same
     * frame has to read state that already includes this frame's brushes, or
     * every mark lands a frame late.
     *
     * @param {number} dt seconds
     * @param {{x:number, y:number, z:number}} focus world position the window
     *   follows — the player, not the camera
     * @returns {THREE.Texture} this frame's state
     */
    update(dt, focus) {
        this._prevCenter.copy(this.center);

        // Snap to texel boundaries. Without this the toroidal mapping shifts by a
        // fraction of a texel every frame and the whole field crawls.
        const t = this.texel;
        this.center.x = Math.round(focus.x / t) * t;
        this.center.y = Math.round(focus.z / t) * t;

        // Zero out the tail of the brush texture once after a busy frame, so a
        // stale radius can never be picked up by a later, shorter frame.
        if (this._brushDirty || this._brushCount > 0) {
            this._uploadBrushes();
        }

        // Bank the frame's time and spend it only once it is worth spending.
        // 0.4 s of a 400 s decay is a relative change of 1e-3, comfortably clear
        // of the 4.9e-4 half-float ULP, and far too small a step to see. Every
        // relax term is an exact no-op at dt = 0, which is what makes this safe;
        // the splat block runs every frame regardless.
        this._relaxOwed += dt;
        let relaxDt = 0;
        if (this._relaxOwed >= RELAX_STEP) {
            relaxDt = this._relaxOwed;
            this._relaxOwed = 0;
        }

        const u = this._pass.uniforms;
        u.center.value.copy(this.center);
        u.prevCenter.value.copy(this._prevCenter);
        u.dt.value = relaxDt;
        u.brushCount.value = this._brushCount;
        u.refillRate.value = S.refillRate;
        u.maxDepth.value = 0.55 * S.deformDepth;
        u.maxBerm.value = 0.34 * S.deformBerm;
        // Mirrored into the port's frame — see `core/bearing.js`.
        u.windAngle.value = bearingRad(S.windDirection);

        if (this._isIdentityStep(relaxDt)) {
            this.stepsSkipped++;
            // Nothing swapped, so `this.texture` is still the state every consumer
            // is already bound to and `deformTex` needs no republishing. These two
            // are not outputs of the pass — they track their settings — so they
            // are refreshed on the skip path exactly as `_step` refreshes them.
            this.uniforms.deformCenter.value.copy(this.center);
            this.uniforms.deformDepthScale.value = S.deformDepth;
        } else {
            this._step();
            this.stepsRun++;
        }

        this._brushCount = 0;
        return this.texture;
    }

    /**
     * Would this frame's pass write back exactly what it read?
     *
     * The 2048² dispatch is 4.2M texels and 7% of the frame, and it does not get
     * cheaper when a weak GPU drops the output resolution — so the frames on
     * which it provably cannot change a single texel are worth not dispatching.
     * All four conditions are needed, and each maps to one block of
     * `shaders/deformSim.glsl.js`:
     *
     *   relaxDt === 0     every relax term is an exact identity at dt = 0 (the
     *                     shader gates the whole block on it for the same reason)
     *   no brushes        the splat loop runs `brushCount` times and is skipped
     *   centre unmoved    `wasInside` is then true for every texel, so no texel
     *                     is cleared by the scroll's omission path
     *   caps unmoved      the final `clamp` is idempotent only against the same
     *                     bounds the previous pass already clamped to
     *
     * With all four, the fragment stage reduces to `outColor = texelFetch(prevTex,
     * P, 0)` at exact texel centres — a bit-identical copy. Skipping it and NOT
     * swapping the ping-pong leaves that same state in `this.texture`, so this is
     * an equivalence and not an approximation: no trail behaviour changes, no
     * decay rate changes, and a walking player (who moves the centre and writes
     * brushes every frame) never takes this path at all.
     *
     * @param {number} relaxDt seconds of relaxation this dispatch would apply
     * @returns {boolean}
     */
    _isIdentityStep(relaxDt) {
        if (relaxDt !== 0) return false;
        if (this._brushCount !== 0) return false;
        if (this.center.x !== this._prevCenter.x) return false;
        if (this.center.y !== this._prevCenter.y) return false;
        const u = this._pass.uniforms;
        if (u.maxDepth.value !== this._lastMaxDepth) return false;
        if (u.maxBerm.value !== this._lastMaxBerm) return false;
        return true;
    }

    /**
     * Render the pass into the write target, swap, and republish.
     *
     * The swap happens strictly AFTER the render: binding the same texture as
     * sampler and colour attachment is undefined on WebGL2 rather than an error,
     * so the ordering here is the only thing preventing a feedback loop.
     * @returns {void}
     */
    _step() {
        this._pass.uniforms.prevTex.value = this._pp.read.texture;
        this._pass.render(this._pp.write);
        this._pp.swap();

        // The bounds this pass clamped to, for `_isIdentityStep`.
        this._lastMaxDepth = this._pass.uniforms.maxDepth.value;
        this._lastMaxBerm = this._pass.uniforms.maxBerm.value;

        this.texture = this._pp.read.texture; // post-swap: the one just written
        this.uniforms.deformTex.value = this.texture;
        this.uniforms.deformCenter.value.copy(this.center);
        this.uniforms.deformDepthScale.value = S.deformDepth;
    }

    /** @returns {void} */
    _uploadBrushes() {
        // Only the live brushes carry meaning; the shader reads exactly
        // `brushCount` of them, so the tail can stay stale. But radius 0 is the
        // shader's own skip test, so clearing it is a cheap safety net.
        const d = this._brushData;
        for (let i = this._brushCount; i < MAX_BRUSHES; i++) {
            d[i * 4 + 2] = 0;
        }
        // Re-uploads the existing array in place — no allocation.
        this.brushTex.needsUpdate = true;
        this._brushDirty = false;
    }

    /**
     * Zero both targets through the ordinary code path.
     *
     * The targets start as uninitialised VRAM. Two passes with the previous
     * centre placed far outside the window make every texel read as "just
     * scrolled in", which the shader answers by writing zero — so the buffer is
     * cleared by the same code that runs every frame, rather than by a special
     * case that could rot.
     * @returns {void}
     */
    _zero() {
        const u = this._pass.uniforms;
        const prevDt = u.dt.value;

        u.center.value.copy(this.center);
        // Far enough away that no texel can have been inside it.
        this._far.set(this.center.x + 1e6, this.center.y + 1e6);
        u.prevCenter.value.copy(this._far);
        u.dt.value = 0;
        u.brushCount.value = 0;
        u.refillRate.value = 1;
        u.maxDepth.value = 1;
        u.maxBerm.value = 1;
        u.windAngle.value = 0;

        this._brushCount = 0;
        this._uploadBrushes();

        for (let i = 0; i < 2; i++) this._step();

        u.dt.value = prevDt;
    }

    /**
     * Compile the pass and zero both targets, behind the loading screen.
     *
     * Must run before the snow material first compiles: that compile binds
     * whatever is in the deformation target, and reading uninitialised VRAM as a
     * height can put a NaN into a vertex position.
     * @returns {Promise<void>}
     */
    async warmUp() {
        this._zero();
        this._warmed = true;
    }

    /** @returns {void} */
    dispose() {
        if (this._unsubscribe) this._unsubscribe();
        this._pp.dispose();
        this._pass.dispose();
        this.brushTex.dispose();
    }
}
