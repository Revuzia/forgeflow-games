/**
 * The baked macro heightfield.
 *
 * Two render targets and one CPU mirror:
 *
 *   heightTex  RG32F, 4096² over a 2048 m field (0.5 m/texel). .r height in
 *              metres, .g rock mask. Sampled bicubically by the clipmap vertex
 *              programs.
 *   auxTex     RGBA16F, 2048². Slope XY, rock mask, exposure. Derived from
 *              `heightTex` rather than from the analytic function, so the normals
 *              describe exactly the surface the vertices displace to.
 *   heightCPU  Float32Array mirror of `heightTex`, at half resolution, read back
 *              once per bake.
 *
 * **The CPU mirror is the point of baking at all.** Character grounding, footfall
 * placement and spell impact points all need heights, and re-implementing the
 * noise in JavaScript would mean f32 GPU maths against f64 JS maths — the two
 * would disagree by centimetres and the character would visibly float or sink,
 * worst on the steep dune faces where it is most obvious. Reading back the exact
 * bake makes disagreement structurally impossible.
 *
 * Two channels, not four: nothing reads B or A of the height texture, and at
 * 4096² the two unused channels would be 134 MB of VRAM holding zeroes.
 * ARCHITECTURE.md §4.1 records RG32F 4096² as validated complete on the
 * verification GPU.
 *
 * Handedness (ARCHITECTURE.md §6): every position here is world (x, z) in Three's
 * right-handed Y-up frame, mirrored on no axis, per _spec/terrain.md §13.1.
 * `normalAt` builds `(-dH/dx, 1, -dH/dz)` — the gradient-to-normal identity for
 * y = H(x, z), which holds under either handedness and is not a cross product.
 */

import * as THREE from "three";
import { makeRT, FullScreenPass } from "../core/gfx.js";
import { fail } from "../core/loading.js";
import { S } from "../core/settings.js";
import { bearingRad } from "../core/bearing.js";
import heightBakeFrag from "../shaders/heightBake.glsl.js";
import auxBakeFrag from "../shaders/auxBake.glsl.js";
import landformBakeFrag from "./landformBake.glsl.js";
import {
    LANDFORM_COLD, resolveLandform, landformIsDefault, landformEquals,
    packLandform,
} from "./landform.js";

/** Metres across the whole baked field. */
export const WORLD_SIZE = 2048;
/** Height texture edge, texels → 0.5 m per texel. */
export const HEIGHT_RES = 4096;
/** Aux texture edge, texels → 1.0 m per texel. */
export const AUX_RES = 2048;

/** Half-extent the player is kept inside, leaving margin for the far rings. */
export const PLAY_RADIUS = 620;

/**
 * THE STORM EDGE. [laneE]
 *
 * The play area used to end in an invisible wall: `clampToPlayArea` simply
 * stopped the position, so a player walking out hit a treadmill in open, clear
 * air with no warning and no reason. These two bands give the boundary a body.
 *
 *   EDGE_BAND   metres of "you are in the storm front" — drives the fog ramp and
 *               the weather density (`vfx/weather.js` reads `edge01`).
 *   PUSH_BAND   metres over which the wind actually shoves back. Deliberately
 *               SHORTER than the visual band: you see the wall well before it
 *               starts fighting you, which is what makes the push read as the
 *               storm rather than as a bug.
 *   EDGE_PUSH_MAX  m/s of inward drift at the clamp itself. Above the walk speed
 *               and below the surf top speed (19.5 m/s, surfWake.js:95) on
 *               purpose: walking out is hopeless, surfing out gets you to the
 *               hard clamp, and the hard clamp is still there behind it.
 */
export const EDGE_BAND = 80;
const PUSH_BAND = 55;
const EDGE_PUSH_MAX = 7.0;

/**
 * Rows per readback strip.
 *
 * The full 4096² read in one call is 4096·4096·4 floats = **268 MB** of transient
 * JavaScript heap (WebGL2's readback format is fixed at RGBA/FLOAT, so the two
 * unused channels come along whether the target has them or not). Eight strips of
 * 512 rows is 33.5 MB, allocated once and reused, which _spec/terrain.md §13.6
 * recommends explicitly. On the 4 GB-shared-memory verification GPU the single
 * large allocation is a real failure risk, not a theoretical one.
 */
const STRIP_ROWS = 512;

const _origin = new THREE.Vector2(-WORLD_SIZE / 2, -WORLD_SIZE / 2);

export class Heightfield {
    /**
     * @param {THREE.WebGLRenderer} renderer
     */
    constructor(renderer) {
        this.renderer = renderer;

        /** World XZ of the field's minimum corner. */
        this.origin = _origin.clone();
        this.size = WORLD_SIZE;
        this.texelWorld = WORLD_SIZE / HEIGHT_RES; // 0.5 m

        /** @type {Float32Array|null} half-res mirror of the height channel */
        this.heightCPU = null;
        this.cpuRes = 0;
        this.cpuTexel = 1;

        /** Measured relief, filled in by `_readback`. */
        this.minHeight = 0;
        this.maxHeight = 0;

        // ------------------------------------------------------------ targets
        // FloatType + LinearFilter needs OES_texture_float_linear, which
        // core/gfx.js's checkCaps() reports as non-fatal-but-degrading: without it
        // sampleHeightBicubic's four bilinear taps quantise to nearest and the
        // dunes become a stair-stepped mosaic.
        this.heightRT = makeRT(HEIGHT_RES, HEIGHT_RES, {
            type: THREE.FloatType,
            format: THREE.RGFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            generateMipmaps: false,
            name: "heightTex",
        });

        this.auxRT = makeRT(AUX_RES, AUX_RES, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            generateMipmaps: false,
            name: "auxTex",
        });

        // -------------------------------------------------------------- bakes
        this._heightPass = new FullScreenPass(renderer, heightBakeFrag, {
            worldOrigin: { value: this.origin },
            worldSize: { value: this.size },
            windAngle: { value: 0 },
            heightAmp: { value: 1 },
        });

        this._auxPass = new FullScreenPass(renderer, auxBakeFrag, {
            heightTex: { value: this.heightRT.texture },
            texelWorld: { value: this.texelWorld },
            invHeightRes: { value: 1 / HEIGHT_RES },
        });

        // ----------------------------------------------------------- landform
        /**
         * The realm's ground shape. Cold's block, which `landformIsDefault`
         * recognises, so the constructed state routes to `_heightPass` and the
         * boot bake is the one that has always run.
         * @type {import("./landform.js").LandformBlock}
         */
        this.landform = resolveLandform(LANDFORM_COLD);
        this._lfDefault = true;
        /**
         * The parameterised twin, built ON FIRST NON-COLD REALM and never
         * before. Compiling it at construction would put a second 4096²-class
         * program on the boot path for a realm the player may never enter, and
         * `FullScreenPass` compiles eagerly. A realm swap is already behind a
         * loading step, which is where a compile belongs.
         * @type {FullScreenPass|null}
         */
        this._realmPass = null;
        /** Bakes run since construction. Probe surface. */
        this.bakeCount = 0;
        /** Last readback's GL error, 0 when clean. Non-zero means the mirror
         *  was left holding the PREVIOUS surface — see `_readback`. */
        this.readError = 0;

        /** Reused readback strip; allocated on first use, never in a frame. */
        this._strip = null;
        /** Channels per texel actually returned by readPixels; see `_readback`. */
        this._readStride = 4;
    }

    /** @returns {THREE.Texture} */
    get heightTex() { return this.heightRT.texture; }
    /** @returns {THREE.Texture} */
    get auxTex() { return this.auxRT.texture; }

    /**
     * Run both bakes and mirror the height to the CPU.
     *
     * Ordering is load-bearing: the aux bake *differentiates the height texture*,
     * so it has to run after it. Deriving the two independently would let lighting
     * disagree with silhouette and put phantom shading seams on smooth dunes.
     *
     * Synchronous. It is a load-time call and the readback stalls the pipeline by
     * design — that stall is what guarantees the mirror is the bake.
     * @returns {void}
     */
    bake() {
        // Mirrored into the port's frame (`core/bearing.js`), the same value
        // `Terrain` pushes to the clipmap — the bake and the five vertex
        // programs must agree or the drawn surface is not the baked one.
        // `lib/terrain` inverts this back to the reference bearing and mirrors
        // the sample point with it, which is what puts the landform in the same
        // z-mirrored frame as the camera, the sun and the character; see the
        // handedness header there.
        const windAngle = bearingRad(S.windDirection);

        if (this._lfDefault) {
            // COLD. The original program, the original two uniforms, untouched.
            // `S.macroHeightScale` is NOT multiplied by the block's
            // `heightScale` here even though it is 1: the promise this branch
            // exists to keep is that nothing in Cold's bake changed, and "1.0 is
            // a no-op multiply" is a promise about arithmetic, not about the
            // instruction stream.
            this._heightPass.uniforms.windAngle.value = windAngle;
            this._heightPass.uniforms.heightAmp.value = S.macroHeightScale;
            this._heightPass.render(this.heightRT);
        } else {
            const pass = this._realmBakePass();
            pass.uniforms.windAngle.value = windAngle;
            // The overlay's Dune-height slider stays live ON TOP of the realm's
            // relief rather than being replaced by it — the same "realm base ×
            // operator offset" shape `settings.js applyRealmGrade` uses for the
            // graded keys.
            pass.uniforms.heightAmp.value =
                S.macroHeightScale * this.landform.heightScale;
            packLandform(pass.uniforms, this.landform);
            pass.render(this.heightRT);
        }

        this._auxPass.render(this.auxRT);

        this._readback();
        this.bakeCount++;
    }

    /**
     * Give the field a realm's ground shape.
     *
     * Does NOT bake: the caller decides when to pay for that, because a bake is
     * a synchronous 268 MB readback and the only sane place for one is behind a
     * loading step or inside `Terrain.update()`'s deferred slot.
     *
     * @param {Partial<import("./landform.js").LandformBlock>} [block]
     * @returns {boolean} true when the shape actually moved — the caller's
     *   signal to schedule a re-bake, and false for a redundant re-apply
     */
    setLandform(block) {
        const next = resolveLandform(block);
        if (landformEquals(next, this.landform)) return false;
        this.landform = next;
        this._lfDefault = landformIsDefault(next);
        return true;
    }

    /**
     * Build the realm bake pass on demand. See `_realmPass`.
     * @returns {FullScreenPass}
     */
    _realmBakePass() {
        if (this._realmPass === null) {
            this._realmPass = new FullScreenPass(this.renderer, landformBakeFrag, {
                worldOrigin: { value: this.origin },
                worldSize: { value: this.size },
                windAngle: { value: 0 },
                heightAmp: { value: 1 },
                uLfDune: { value: new THREE.Vector4() },
                uLfSwell: { value: new THREE.Vector4() },
                uLfDrift: { value: new THREE.Vector4() },
                uLfBasin: { value: new THREE.Vector4() },
                uLfRock: { value: new THREE.Vector4() },
                uLfRock2: { value: new THREE.Vector4() },
            });
            this._realmPass.profileName = "landformBake";
        }
        return this._realmPass;
    }

    /**
     * Mirror `heightRT`'s red channel into `heightCPU` at half resolution.
     *
     * Half resolution (2048², 1 m spacing) is ample for grounding and avoids
     * holding 67 MB resident forever; the mirror as kept is 16.8 MB.
     *
     * **Averaged as a 2×2 box rather than point-sampled.** Point-sampling texel 2x
     * puts the sample at world (x + 0.25) while `heightAt` reconstructs as though
     * it sat at (x + 0.5), and a quarter-texel shift on a steep dune face sinks the
     * character into the surface. The box filter lands the sample exactly on the
     * centre `heightAt` assumes.
     *
     * THE PIXEL-PACK GUARD. WebGL2 rejects `readPixels` into an ArrayBufferView
     * while ANY buffer is bound to `PIXEL_PACK_BUFFER` — the view overload and
     * the offset overload are mutually exclusive — and it rejects it with
     * INVALID_OPERATION rather than with an exception. That mattered the moment
     * a re-bake became possible at runtime: `Sky.solve()` leaves a pack buffer
     * bound across the `await` in its SH projection, the frame loop keeps
     * running underneath it, and a realm swap's re-bake lands squarely inside
     * that window. MEASURED on the failing path (`_harness/qa_lf_diag3.py`):
     *
     *   before-bake  packBuf true  err 0     readStride 4
     *   after-bake   packBuf true  err 1282  readStride 2   min -4.867 (wrong)
     *   settled      packBuf false err 0     readStride 4   min -18.326 (right)
     *
     * The failure is worse than a dropped read: the probe read below errors, the
     * stride guard concludes the driver wants RG, every strip read then fails
     * too, and the mirror is rebuilt out of a STALE strip at the wrong stride —
     * a plausible-looking, silently sheared grounding field, which is exactly
     * the defect the stride guard was written to prevent. Unbinding for the
     * duration and putting the binding back is the whole fix, and it belongs
     * here rather than in `Sky`: this is the code with the requirement.
     */
    _readback() {
        const gl = /** @type {WebGL2RenderingContext} */ (this.renderer.getContext());
        const res = HEIGHT_RES / 2;

        if (this.heightCPU === null || this.heightCPU.length !== res * res) {
            this.heightCPU = new Float32Array(res * res);
        }
        const dst = this.heightCPU;

        const prevTarget = this.renderer.getRenderTarget();
        // Saved and restored around the reads, never merely cleared: whoever
        // bound it is mid-operation and expects to find it still bound.
        const prevPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
        if (prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this.renderer.setRenderTarget(this.heightRT); // binds the target's FBO

        // WebGL2 guarantees exactly two readPixels format/type pairs: RGBA8 and
        // whatever IMPLEMENTATION_COLOR_READ_FORMAT/TYPE report. EXT_color_buffer_float
        // additionally makes RGBA/FLOAT work on float colour buffers, and
        // _spec/terrain.md §13.6 calls that "the implementation-independent path"
        // — but an RG32F attachment is exactly the case where a driver may prefer
        // to report RG/FLOAT, and getting the channel stride wrong does not throw:
        // it silently shears the grounding field, which then shows up as the
        // character sinking into slopes. So the stride is *derived*, never assumed,
        // the same guard the reference applies to its own readback.
        let format = gl.RGBA;
        let stride = 4;
        while (gl.getError() !== gl.NO_ERROR) { /* drain */ }

        if (this._strip === null) {
            this._strip = new Float32Array(HEIGHT_RES * STRIP_ROWS * 4);
        }
        gl.readPixels(0, 0, HEIGHT_RES, 1, gl.RGBA, gl.FLOAT, this._strip);
        if (gl.getError() !== gl.NO_ERROR) {
            const implFormat = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
            const implType = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
            if (implType !== gl.FLOAT) {
                this.renderer.setRenderTarget(prevTarget);
                if (prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack);
                fail("Heightfield readback: float readback unsupported");
                return;
            }
            format = implFormat;
            stride = implFormat === gl.RED ? 1 : implFormat === gl.RG ? 2 : 4;
            while (gl.getError() !== gl.NO_ERROR) { /* drain */ }
        }

        const strip = this._strip;
        const rowFloats = HEIGHT_RES * stride;
        let readErr = 0;

        for (let y0 = 0; y0 < HEIGHT_RES; y0 += STRIP_ROWS) {
            const rows = Math.min(STRIP_ROWS, HEIGHT_RES - y0);
            gl.readPixels(0, y0, HEIGHT_RES, rows, format, gl.FLOAT, strip);
            // A FAILED strip read leaves `strip` holding the PREVIOUS strip,
            // and the loop below would fold that into the mirror as though it
            // were this one — a grounding field that looks like terrain, tiles
            // eight ways and puts the character underground. Better a stale
            // mirror (the last surface, entirely self-consistent) than a
            // plausible wrong one, so the whole readback is abandoned rather
            // than half-applied. `heightAt` keeps answering for the old realm
            // until the next bake, which the caller can retry.
            const e = gl.getError();
            if (e !== gl.NO_ERROR) { readErr = e; break; }

            // Two source rows collapse to one destination row.
            for (let y = 0; y < rows; y += 2) {
                const r0 = y * rowFloats;
                const r1 = (y + 1) * rowFloats;
                const dRow = ((y0 + y) >> 1) * res;
                for (let x = 0; x < res; x++) {
                    const c0 = x * 2 * stride;
                    const c1 = c0 + stride;
                    dst[dRow + x] =
                        (strip[r0 + c0] + strip[r0 + c1] +
                         strip[r1 + c0] + strip[r1 + c1]) * 0.25;
                }
            }
        }

        this.renderer.setRenderTarget(prevTarget);
        if (prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack);

        this.readError = readErr;
        if (readErr !== 0) return;

        this.cpuRes = res;
        this.cpuTexel = this.size / res; // 1.0 m
        this._readStride = stride;

        // Actual relief, for anything that needs to bound the world vertically —
        // the shadow cascades size their light volume from it. Measured rather than
        // assumed, because the bake's amplitude is a tunable and a bound that is
        // quietly wrong clips geometry out of the depth map.
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < dst.length; i++) {
            const v = dst[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        this.minHeight = lo;
        this.maxHeight = hi;
    }

    /**
     * Bicubic B-spline height lookup, matching `sampleHeightBicubic` in
     * `lib/clipmap` weight for weight, so the ground the character stands on is
     * the ground that is drawn.
     *
     * @param {number} x world X, metres
     * @param {number} z world Z, metres
     * @returns {number} height in metres
     */
    heightAt(x, z) {
        const h = this.heightCPU;
        if (h === null) return 0;
        const res = this.cpuRes;

        const fx = ((x - this.origin.x) / this.size) * res - 0.5;
        const fz = ((z - this.origin.y) / this.size) * res - 0.5;

        const ix = Math.floor(fx);
        const iz = Math.floor(fz);

        bsplineWeights(fx - ix, _wx);
        bsplineWeights(fz - iz, _wz);

        let sum = 0;
        for (let j = 0; j < 4; j++) {
            const zz = clampi(iz - 1 + j, 0, res - 1);
            const row = zz * res;
            let rowSum = 0;
            for (let i = 0; i < 4; i++) {
                const xx = clampi(ix - 1 + i, 0, res - 1);
                rowSum += h[row + xx] * _wx[i];
            }
            sum += rowSum * _wz[j];
        }
        return sum;
    }

    /**
     * Surface normal from the same reconstruction, by central difference at one
     * CPU texel (1 m). `(-dH/dx, 1, -dH/dz)` — the y = H(x, z) identity, valid in
     * Three's right-handed frame exactly as it was in the reference's left-handed
     * one (ARCHITECTURE.md §6).
     *
     * @param {number} x
     * @param {number} z
     * @param {THREE.Vector3} out
     * @returns {THREE.Vector3} `out`
     */
    normalAt(x, z, out) {
        const e = this.cpuTexel || 1;
        const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
        const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
        out.set(-hx / (2 * e), 1, -hz / (2 * e));
        out.normalize();
        return out;
    }

    /**
     * Clamp a world position to the playable disc, in place.
     * @param {{x:number, z:number}} v
     * @returns {void}
     */
    clampToPlayArea(v) {
        const r = PLAY_RADIUS;
        const d = Math.hypot(v.x, v.z);
        if (d > r) {
            const k = r / d;
            v.x *= k;
            v.z *= k;
        }
    }

    /**
     * How deep into the storm front this position is.
     *
     * 0 anywhere inside `PLAY_RADIUS - EDGE_BAND`, rising smoothly to 1 at the
     * clamp. Smoothstepped rather than linear so the fog does not switch on with
     * a visible seam the moment you cross into the band — the whole point is
     * that the wall builds.
     *
     * The single source of truth for the edge: `vfx/weather.js` drives its fog
     * boost and its particle density off this, `edgePush` scales off the same
     * distance, and the screenshot check is that they agree.
     *
     * @param {number} x @param {number} z
     * @returns {number} 0..1
     */
    edge01(x, z) {
        const d = Math.hypot(x, z);
        const t = (d - (PLAY_RADIUS - EDGE_BAND)) / EDGE_BAND;
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        return t * t * (3 - 2 * t);
    }

    /**
     * The storm's inward shove, in metres per second.
     *
     * Exactly 0 outside `PUSH_BAND`, so the integrator's add is a no-op over
     * 99.5% of the disc and costs one `Math.hypot` there. Quadratic in depth:
     * the first metres of the band are a hint, the last are a wall.
     *
     * Returns a RETAINED scratch object — call it every frame from the
     * controller step without allocating. Copy the values out if you need to
     * hold them; the next call overwrites them.
     *
     * @param {number} x @param {number} z
     * @returns {{fx:number, fz:number}} m/s, pointing back toward the origin
     */
    edgePush(x, z) {
        _push.fx = 0;
        _push.fz = 0;
        const d = Math.hypot(x, z);
        const u = (d - (PLAY_RADIUS - PUSH_BAND)) / PUSH_BAND;
        if (u <= 0 || d < 1e-4) return _push;
        const k = u >= 1 ? 1 : u * u;
        const mag = EDGE_PUSH_MAX * k;
        _push.fx = (-x / d) * mag;
        _push.fz = (-z / d) * mag;
        return _push;
    }

    /** @returns {void} */
    dispose() {
        this.heightRT.dispose();
        this.auxRT.dispose();
        this._heightPass.dispose();
        if (this._realmPass) this._realmPass.dispose();
        this._realmPass = null;
        this._auxPass.dispose();
        this.heightCPU = null;
        this._strip = null;
    }
}

// ------------------------------------------------------- module-scope scratch
// heightAt() runs per footfall and per spell impact, so it must not allocate.

const _wx = new Float32Array(4);
const _wz = new Float32Array(4);

/** `edgePush`'s retained return. Overwritten on every call, by design. */
const _push = { fx: 0, fz: 0 };

/**
 * Cubic B-spline weights — the same polynomial the GPU fetch evaluates per axis.
 * @param {number} t
 * @param {Float32Array} out
 */
function bsplineWeights(t, out) {
    const t2 = t * t;
    const t3 = t2 * t;
    out[0] = (1 - 3 * t + 3 * t2 - t3) / 6;
    out[1] = (4 - 6 * t2 + 3 * t3) / 6;
    out[2] = (1 + 3 * t + 3 * t2 - 3 * t3) / 6;
    out[3] = t3 / 6;
}

/**
 * @param {number} v @param {number} lo @param {number} hi @returns {number}
 */
function clampi(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
