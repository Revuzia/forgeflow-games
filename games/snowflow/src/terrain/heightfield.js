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

/** Metres across the whole baked field. */
export const WORLD_SIZE = 2048;
/** Height texture edge, texels → 0.5 m per texel. */
export const HEIGHT_RES = 4096;
/** Aux texture edge, texels → 1.0 m per texel. */
export const AUX_RES = 2048;

/** Half-extent the player is kept inside, leaving margin for the far rings. */
export const PLAY_RADIUS = 620;

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
        // Mirrored into the port's frame (`core/bearing.js`). windMat rotates the
        // sample domain by this angle, so mirroring it here is what keeps the
        // sastrugi ridges at the reference's 76 degrees to the sun rather than
        // raked along it — the bake and the clipmap must pass the same value.
        const windAngle = bearingRad(S.windDirection);

        this._heightPass.uniforms.windAngle.value = windAngle;
        this._heightPass.uniforms.heightAmp.value = S.macroHeightScale;
        this._heightPass.render(this.heightRT);

        this._auxPass.render(this.auxRT);

        this._readback();
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
     */
    _readback() {
        const gl = /** @type {WebGL2RenderingContext} */ (this.renderer.getContext());
        const res = HEIGHT_RES / 2;

        if (this.heightCPU === null || this.heightCPU.length !== res * res) {
            this.heightCPU = new Float32Array(res * res);
        }
        const dst = this.heightCPU;

        const prevTarget = this.renderer.getRenderTarget();
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
                fail("Heightfield readback: float readback unsupported");
                return;
            }
            format = implFormat;
            stride = implFormat === gl.RED ? 1 : implFormat === gl.RG ? 2 : 4;
            while (gl.getError() !== gl.NO_ERROR) { /* drain */ }
        }

        const strip = this._strip;
        const rowFloats = HEIGHT_RES * stride;

        for (let y0 = 0; y0 < HEIGHT_RES; y0 += STRIP_ROWS) {
            const rows = Math.min(STRIP_ROWS, HEIGHT_RES - y0);
            gl.readPixels(0, y0, HEIGHT_RES, rows, format, gl.FLOAT, strip);

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

    /** @returns {void} */
    dispose() {
        this.heightRT.dispose();
        this.auxRT.dispose();
        this._heightPass.dispose();
        this._auxPass.dispose();
        this.heightCPU = null;
        this._strip = null;
    }
}

// ------------------------------------------------------- module-scope scratch
// heightAt() runs per footfall and per spell impact, so it must not allocate.

const _wx = new Float32Array(4);
const _wz = new Float32Array(4);

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
