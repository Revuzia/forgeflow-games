/**
 * The post-processing chain: nine full-screen passes in a fixed order, plus the
 * per-frame camera bookkeeping every one of them derives from.
 *
 * ## Order and sizes
 *
 * Babylon chained its post-processes by having pass *i* render into pass *i+1*'s
 * texture, so the resolution a pass rendered at was declared by the pass after
 * it — an indirection with no equivalent here and no reason to reproduce. The
 * graph below is the reference's table with that indirection resolved
 * (`_spec/post-core.md` §1.2, §1.3):
 *
 * ```
 *   pass        renders at   reads                            writes
 *   ssr          full        RT_scene, prepass                RT_ssr
 *   taa          full        RT_ssr, history[1-k], prepass    RT_history[k]
 *   shafts       1/4         prepass                          RT_shafts
 *   bloomA       1/4         RT_history[k]  (bright pass)     RT_bloom0
 *   bloomB       1/16        RT_bloom0                        RT_bloom1
 *   bloomC       1/16        RT_bloom1      (tent blur)       RT_bloom2
 *   dof          full        RT_history[k], prepass           RT_dof
 *   composite    full        RT_dof, bloom0, bloom2, shafts   RT_composite (8-bit)
 *   sharpen      full        RT_composite                     default framebuffer
 * ```
 *
 * `1/4` and `1/16` are LINEAR ratios of the full render size, not of the
 * previous level. `bloomA` and `dof` deliberately bypass the chain and read the
 * frame TAA has just resolved rather than the previous pass's output.
 *
 * ## Why every pass stays attached
 *
 * Toggling one off would restructure the graph, so instead each pass takes an
 * `enabled` uniform and early-outs in its own shader, becoming a full-screen
 * copy. The overlay's toggles are conveniences; they must not change topology.
 *
 * ## Jitter
 *
 * The temporal resolve needs the projection offset by a subpixel amount each
 * frame and everything downstream needs to agree about which offset. This class
 * owns that: it recomputes the projection clean, records the UNJITTERED
 * view-projection for next frame's reprojection, writes the offset straight into
 * the two matrix elements that shear clip x and y by w, and then nothing may
 * recompute the projection for the rest of the frame. The depth prepass and the
 * beauty pass must both rasterise through the identical jittered matrix, or the
 * resolve integrates two different samplings of the same surface.
 *
 * Three has no `freezeProjectionMatrix`; the equivalent discipline is that
 * `update()` is the single place `camera.updateProjectionMatrix()` is called
 * inside a frame, and it is called before anything renders.
 *
 * ## Handedness
 *
 * Babylon's clip.w is +view.z, Three's is -view.z, so the jitter write is
 * sign-flipped (`elements[8] -= jitterNdc.x`, spec §16.4). The invariant that
 * has to survive: after the write, a projected world point's NDC position moves
 * by **+jitterNdc**, which is exactly what the TAA shader subtracts back off
 * when it rebuilds the view ray. Everything else handedness-related lives in
 * `lib/postCommon` and the two shaders that reconstruct positions.
 *
 * ## Allocation
 *
 * Every render target, uniform object and scratch vector is created in the
 * constructor. `update()`, `render()` and `endFrame()` allocate nothing.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { makeRT, FullScreenPass } from "../core/gfx.js";

import taaFrag from "../shaders/post/taa.glsl.js";
import ssrFrag from "../shaders/post/ssr.glsl.js";
import shaftsFrag from "../shaders/post/shafts.glsl.js";
import bloomDownFrag from "../shaders/post/bloomDown.glsl.js";
import bloomBlurFrag from "../shaders/post/bloomBlur.glsl.js";
import dofFrag from "../shaders/post/dof.glsl.js";
import tonemapFrag from "../shaders/post/tonemap.glsl.js";
import sharpenFrag from "../shaders/post/sharpen.glsl.js";

const TONEMAP_MODES = { agx: 0, aces: 1, none: 2 };

/**
 * Halton(2,3). Eight subpixel positions, low-discrepancy so the accumulated
 * sample pattern is even at every prefix length rather than only after all eight
 * — which matters because the history is continuously being partially rejected
 * and rarely gets a clean run of eight.
 */
const JITTER = buildHalton(8);

// ------------------------------------------------------- module-scope scratch
const _sunWorld = new THREE.Vector3();
const _sunClip = new THREE.Vector3();
const _camFwd = new THREE.Vector3();

export class PostChain {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.PerspectiveCamera} camera the rig's camera
     * @param {Object} [deps]
     * @param {any}    [deps.depthPass] the linear-depth prepass; its RGBA16F
     *   texture is resolved each frame from `.depthTexture` / `.texture` /
     *   `.target.texture` / `.rt.texture` / `.rtt.texture`, or set
     *   `post.depthTexture` directly.
     * @param {any}    [deps.sky] needs `sunDir` (Vector3, toward the sun, world)
     *   and `sunRadiance` (Color or Vector3, linear, pre-multiplied by intensity)
     * @param {number} [deps.width]
     * @param {number} [deps.height]
     */
    constructor(renderer, camera, deps = {}) {
        this.renderer = renderer;
        this.camera = camera;
        this.depthPass = deps.depthPass || null;
        /** @type {THREE.Texture|null} overrides the depthPass lookup when set */
        this.depthTexture = null;
        this.sky = deps.sky || null;

        /** Seconds, advanced by `update`. Frozen when `S.freezeTime` makes dt 0. */
        this.time = 0;
        /**
         * 0..1, written each frame from `character.streak01`. Drives the radial
         * smear and the spindrift strands in the display transform.
         */
        this.speedStreak = 0;
        /** Eased focal distance, metres. Tracks the spring arm. */
        this.focusDist = 6.2;

        this._frame = 0;
        this._historyValid = 0;
        this._k = 0;

        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        this._w = deps.width || Math.max(1, size.x);
        this._h = deps.height || Math.max(1, size.y);

        // ---------------------------------------------------------- matrices
        this._projUnjit = new THREE.Matrix4();
        this._prevViewProj = new THREE.Matrix4();
        this._curViewProj = new THREE.Matrix4();
        this._invView = new THREE.Matrix4();

        this._projInfo = new THREE.Vector2(1, 1);
        this._invRes = new THREE.Vector2(1, 1);
        this._jitterNdc = new THREE.Vector2(0, 0);
        this._sunUV = new THREE.Vector2(0.5, 0.5);
        this._sunOnScreen = 0;
        this._sunColor = new THREE.Vector3(1, 1, 1);
        this._bloomCurve = new THREE.Vector4(3.0, 1.6, 2.8, 0.25 / 1.4);

        this._makeTargets();
        this._makePasses();
    }

    // ------------------------------------------------------------- targets

    _makeTargets() {
        const w = this._w;
        const h = this._h;
        const q = quarter(w);
        const qh = quarter(h);
        const s = sixteenth(w);
        const sh = sixteenth(h);

        // The beauty target. Owned here rather than by the integrator so that
        // everything from "the scene has been drawn" onward lives in one file.
        // Depth-attached: the opaque and transparent groups depth-test against
        // each other inside it (ARCHITECTURE §4).
        this.sceneTarget = makeRT(w, h, { depthBuffer: true, name: "RT_scene" });

        this.rtSsr = makeRT(w, h, { name: "RT_ssr" });
        // Clamp on both axes: the Catmull-Rom fetch reaches two texels outside
        // the reprojected position, and repeat-wrap would fold the opposite edge
        // of the frame into the history.
        this.history = [
            makeRT(w, h, { name: "RT_history0" }),
            makeRT(w, h, { name: "RT_history1" }),
        ];
        this.rtShafts = makeRT(q, qh, { name: "RT_shafts" });
        this.rtBloom0 = makeRT(q, qh, { name: "RT_bloom0" });
        this.rtBloom1 = makeRT(s, sh, { name: "RT_bloom1" });
        this.rtBloom2 = makeRT(s, sh, { name: "RT_bloom2" });
        this.rtDof = makeRT(w, h, { name: "RT_dof" });
        // Eight bits by design: the last stage before the swapchain is the only
        // one working on display-encoded values. NoColorSpace (makeRT's default)
        // matters here — the composite already ran linearToSrgb, and an
        // SRGB8_ALPHA8 target would encode it a second time.
        this.rtComposite = makeRT(w, h, {
            type: THREE.UnsignedByteType,
            name: "RT_composite",
        });

        this._invRes.set(1 / w, 1 / h);
    }

    // -------------------------------------------------------------- passes

    _makePasses() {
        const r = this.renderer;

        this.ssr = new FullScreenPass(r, ssrFrag, {
            uSource: { value: this.sceneTarget.texture },
            uDepth: { value: null },
            uProjInfo: { value: this._projInfo },
            uInvRes: { value: this._invRes },
            uEnabled: { value: 1 },
            // Hard-coded on the CPU in the reference, not exposed in the overlay.
            uStrength: { value: 1.0 },
        });

        this.taa = new FullScreenPass(r, taaFrag, {
            uSource: { value: this.rtSsr.texture },
            uHistory: { value: this.history[1].texture },
            uDepth: { value: null },
            uPrevViewProj: { value: this._prevViewProj },
            uInvView: { value: this._invView },
            uProjInfo: { value: this._projInfo },
            uInvRes: { value: this._invRes },
            uJitterNdc: { value: this._jitterNdc },
            uHistoryValid: { value: 0 },
            uEnabled: { value: 1 },
            uFeedback: { value: 0.9 },
        });

        this.shafts = new FullScreenPass(r, shaftsFrag, {
            uDepth: { value: null },
            uSunUV: { value: this._sunUV },
            uSunOnScreen: { value: 0 },
            uSunColor: { value: this._sunColor },
            uEnabled: { value: 1 },
            uStrength: { value: S.shaftStrength },
            uAspect: { value: 1 },
        });

        // Level 0: the bright pass, reading the resolved frame at full resolution.
        this.bloomA = new FullScreenPass(r, bloomDownFrag, {
            uSource: { value: this.history[0].texture },
            uSrcTexel: { value: new THREE.Vector2() },
            uPrefilter: { value: 1 },
            uCurve: { value: this._bloomCurve },
        });

        // Level 1: a straight 4x reduction of level 0.
        this.bloomB = new FullScreenPass(r, bloomDownFrag, {
            uSource: { value: this.rtBloom0.texture },
            uSrcTexel: { value: new THREE.Vector2() },
            uPrefilter: { value: 0 },
            uCurve: { value: new THREE.Vector4(0, 0, 0, 0) },
        });

        this.bloomC = new FullScreenPass(r, bloomBlurFrag, {
            uSource: { value: this.rtBloom1.texture },
            uSrcTexel: { value: new THREE.Vector2() },
        });

        this.dof = new FullScreenPass(r, dofFrag, {
            uScene: { value: this.history[0].texture },
            uDepth: { value: null },
            uInvRes: { value: this._invRes },
            uEnabled: { value: 1 },
            uFocusDist: { value: this.focusDist },
            uMaxCoc: { value: 1 },
        });

        this.composite = new FullScreenPass(r, tonemapFrag, {
            uSource: { value: this.rtDof.texture },
            uBloomNear: { value: this.rtBloom0.texture },
            uBloomFar: { value: this.rtBloom2.texture },
            uShafts: { value: this.rtShafts.texture },
            uExposure: { value: S.exposure },
            uContrast: { value: S.contrast },
            uMode: { value: 0 },
            uGrainAmount: { value: 0 },
            uTime: { value: 0 },
            // Not a slider in the reference either — hard-coded on the CPU.
            uVignette: { value: 0.22 },
            uSpeedStreak: { value: 0 },
            uBloomAmount: { value: 0 },
            uShaftAmount: { value: 0 },
        });

        this.sharpen = new FullScreenPass(r, sharpenFrag, {
            uSource: { value: this.rtComposite.texture },
            uInvRes: { value: this._invRes },
            uAmount: { value: 0 },
        });

        this.passes = [
            this.ssr, this.taa, this.shafts, this.bloomA, this.bloomB,
            this.bloomC, this.dof, this.composite, this.sharpen,
        ];

        this._refreshTexelSizes();
    }

    /**
     * Tap spacing is TWICE a source texel, not one. Each bloom level is a 4x
     * reduction, so one destination pixel covers a 4x4 block of the source; a
     * thirteen-tap kernel spaced at one texel only reaches half of it, and the
     * half it misses aliases straight into the glow. On a field that emits
     * discrete single-pixel glints by design, that shows up as a bloom that
     * seethes.
     */
    _refreshTexelSizes() {
        this.bloomA.uniforms.uSrcTexel.value.set(2 / this._w, 2 / this._h);
        this.bloomB.uniforms.uSrcTexel.value.set(
            2 / this.rtBloom0.width, 2 / this.rtBloom0.height
        );
        this.bloomC.uniforms.uSrcTexel.value.set(
            2 / this.rtBloom1.width, 2 / this.rtBloom1.height
        );
    }

    /**
     * This frame's projection matrix WITHOUT the temporal jitter, latched by
     * `update()` before the offset is written into it.
     *
     * Exists for the shadow refit, which documents (`render/shadows.js`,
     * `update()`) that it would rather be handed the clean projection: the
     * jitter is sub-pixel and harmless to the fit itself, but it feeds noise
     * into the cascade radius that the relative quantisation there exists to
     * reject. Read-only by contract — the returned matrix is the live one this
     * class reuses every frame, so copy it if you intend to keep it.
     * @returns {THREE.Matrix4}
     */
    get projectionUnjittered() {
        return this._projUnjit;
    }

    // --------------------------------------------------------------- update

    /**
     * Recompute the projection with this frame's subpixel offset, and publish
     * everything the screen-space passes derive from the camera.
     *
     * MUST run after the rig has moved the camera and set its field of view, and
     * before anything renders — the depth prepass and the beauty pass both
     * rasterise through `camera.projectionMatrix`, and they have to get the
     * identical jittered one.
     *
     * @param {number} dt seconds (0 when `S.freezeTime`)
     * @param {number} [streak] 0..1 speed-streak amount for this frame
     * @param {number} [focus] metres to the subject, for depth of field
     * @returns {void}
     */
    update(dt, streak, focus) {
        this.time += dt;
        if (streak !== undefined) this.speedStreak = streak;
        if (focus !== undefined) {
            // Eased: a focal plane that snaps when the spring arm re-lengthens is
            // the one thing a restrained depth of field can still make obvious.
            this.focusDist += (focus - this.focusDist) * Math.min(1, dt * 4.0);
        }

        const cam = this.camera;
        const w = this._w;
        const h = this._h;

        // ---- unjittered matrices, for reprojection and for the sun ---------
        cam.updateProjectionMatrix();
        this._projUnjit.copy(cam.projectionMatrix);
        cam.updateMatrixWorld(true);
        this._curViewProj.multiplyMatrices(this._projUnjit, cam.matrixWorldInverse);
        // The TAA shader's "view -> world" is the camera's world matrix.
        this._invView.copy(cam.matrixWorld);

        const tanHalf = Math.tan(cam.fov * (Math.PI / 180) * 0.5);
        this._projInfo.set(tanHalf * (w / h), tanHalf);

        // ---- the sun on screen, for the shafts -----------------------------
        if (this.sky && this.sky.sunDir) {
            _sunWorld.copy(this.sky.sunDir).multiplyScalar(2000).add(cam.position);
            // applyMatrix4 divides by w internally, so a point behind the camera
            // comes back mirrored rather than flagged. The dot product against
            // the view direction is the only honest test.
            _sunClip.copy(_sunWorld).applyMatrix4(this._curViewProj);
            cam.getWorldDirection(_camFwd);
            const fwdDot = this.sky.sunDir.dot(_camFwd);
            this._sunUV.set(_sunClip.x * 0.5 + 0.5, _sunClip.y * 0.5 + 0.5);
            this._sunOnScreen = fwdDot > 0.05 ? 1 : 0;
            readColor(this.sky.sunRadiance, this._sunColor);
        } else {
            this._sunOnScreen = 0;
        }

        // ---- bloom knee ----------------------------------------------------
        // Threshold in scene-radiance units, so it does not move when the
        // exposure slider does. Spec §6.6: the reference's comment says "exposed
        // units" but its data path binds the un-exposed resolved scene, and the
        // code is the authority. At 3.0 the sunlit field sits below the knee and
        // only the sun disc, the glints and lit spray reach it.
        const th = 3.0;
        const knee = 1.4;
        this._bloomCurve.set(th, th - knee, knee * 2, 0.25 / Math.max(knee, 1e-4));

        // ---- jitter ---------------------------------------------------------
        let jx = 0;
        let jy = 0;
        if (S.taa) {
            const idx = (this._frame % (JITTER.length >> 1)) * 2;
            jx = JITTER[idx];
            jy = JITTER[idx + 1];
        }
        // Pixels to NDC: NDC spans 2 units across w pixels.
        this._jitterNdc.set((2 * jx) / w, (2 * jy) / h);

        // Three's clip.w is -view.z where Babylon's is +view.z, so where the
        // reference ADDS the offset to m[8]/m[9] this SUBTRACTS it. The
        // invariant either way: the projected point moves by +jitterNdc in NDC,
        // which is what taa.glsl.js subtracts back off.
        const e = cam.projectionMatrix.elements;
        e[8] -= this._jitterNdc.x;
        e[9] -= this._jitterNdc.y;
        cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

        // ---- history ping-pong ---------------------------------------------
        // Flipped here, before the frame renders: history[k] is this frame's
        // destination (taa writes it; bloomA and dof read it afterwards) and
        // history[1-k] is last frame's resolved image.
        this._k = 1 - this._k;

        this._frame++;
    }

    // --------------------------------------------------------------- render

    /**
     * Run the nine passes. Call after the beauty pass has rendered into
     * `post.sceneTarget`; the last pass lands on the default framebuffer.
     * @returns {void}
     */
    render() {
        const k = this._k;
        const depth = this._depthTex();
        const hist = this.history[k];
        const prev = this.history[1 - k];

        // ---- 3. ssr -> RT_ssr (full) ---------------------------------------
        const su = this.ssr.uniforms;
        su.uSource.value = this.sceneTarget.texture;
        su.uDepth.value = depth;
        su.uEnabled.value = S.ssr ? 1 : 0;
        this.ssr.render(this.rtSsr);

        // ---- 4. taa -> RT_history[k] (full) --------------------------------
        const tu = this.taa.uniforms;
        tu.uSource.value = this.rtSsr.texture;
        tu.uHistory.value = prev.texture;
        tu.uDepth.value = depth;
        tu.uHistoryValid.value = this._historyValid;
        tu.uEnabled.value = S.taa ? 1 : 0;
        tu.uFeedback.value = 0.9;
        this.taa.render(hist);

        // ---- 5. shafts -> RT_shafts (quarter) ------------------------------
        const fu = this.shafts.uniforms;
        fu.uDepth.value = depth;
        fu.uSunOnScreen.value = this._sunOnScreen;
        fu.uEnabled.value = S.showLightShafts ? 1 : 0;
        fu.uStrength.value = S.shaftStrength;
        fu.uAspect.value = this._w / this._h;
        this.shafts.render(this.rtShafts);

        // ---- 6-8. bloom ----------------------------------------------------
        this.bloomA.uniforms.uSource.value = hist.texture;
        this.bloomA.render(this.rtBloom0);

        this.bloomB.uniforms.uSource.value = this.rtBloom0.texture;
        this.bloomB.render(this.rtBloom1);

        this.bloomC.uniforms.uSource.value = this.rtBloom1.texture;
        this.bloomC.render(this.rtBloom2);

        // ---- 9. dof -> RT_dof (full) ---------------------------------------
        const du = this.dof.uniforms;
        du.uScene.value = hist.texture;
        du.uDepth.value = depth;
        du.uEnabled.value = S.dof ? 1 : 0;
        du.uFocusDist.value = this.focusDist;
        // Scaled to the frame height, so the look does not change with
        // resolution or with the resolution-scale slider. 0.0024 is 3.5 px at
        // 1440p; against the pass's own 1.5 px early-out only pixels past
        // roughly three hundred metres run a gather at all.
        du.uMaxCoc.value = this._h * 0.0024;
        this.dof.render(this.rtDof);

        // ---- 10. composite -> RT_composite (full, 8-bit) -------------------
        const cu = this.composite.uniforms;
        cu.uSource.value = this.rtDof.texture;
        cu.uBloomNear.value = this.rtBloom0.texture;
        cu.uBloomFar.value = this.rtBloom2.texture;
        cu.uShafts.value = this.rtShafts.texture;
        cu.uExposure.value = S.exposure;
        cu.uContrast.value = S.contrast;
        cu.uMode.value = TONEMAP_MODES[S.tonemap] ?? 0;
        cu.uGrainAmount.value = S.grain ? S.grainStrength : 0;
        cu.uTime.value = this.time;
        cu.uSpeedStreak.value = S.windStreaks ? this.speedStreak * S.streakStrength : 0;
        cu.uBloomAmount.value = S.bloom ? S.bloomStrength : 0;
        // A binary: the artistic scale lives in S.shaftStrength, inside the pass.
        cu.uShaftAmount.value = S.showLightShafts ? 1 : 0;
        this.composite.render(this.rtComposite);

        // ---- 11. sharpen -> default framebuffer ----------------------------
        const hu = this.sharpen.uniforms;
        hu.uSource.value = this.rtComposite.texture;
        hu.uAmount.value = S.sharpen ? S.sharpenStrength : 0;
        this.sharpen.render(null);
    }

    /**
     * Latch this frame's camera for next frame's reprojection. Call after the
     * frame is submitted.
     * @returns {void}
     */
    endFrame() {
        this._prevViewProj.copy(this._curViewProj);
        // Two frames of grace: the first fills history[0], the second
        // history[1], and only then is there something at `1 - k` worth reading.
        if (this._historyValid < 1) this._historyValid += 0.5;
    }

    /** Discard the temporal history — after a teleport, or a resolution change. */
    resetHistory() {
        this._historyValid = 0;
    }

    /**
     * Compile and draw every pass once, behind the boot screen. Linking alone is
     * not enough on the D3D11 ANGLE backend the harness runs on: it defers the
     * real specialisation until the first draw that binds the VAO, and a shader
     * that first draws when the player casts a spell is a multi-hundred-
     * millisecond freeze at exactly the wrong moment.
     *
     * Safe to call before any real content exists — `historyValid` is 0, so the
     * temporal resolve is a straight copy.
     * @returns {void}
     */
    warmUp() {
        this.render();
    }

    /**
     * @param {number} w drawing-buffer width in pixels
     * @param {number} h drawing-buffer height in pixels
     * @returns {void}
     */
    setSize(w, h) {
        w = Math.max(1, w | 0);
        h = Math.max(1, h | 0);
        if (w === this._w && h === this._h) return;
        this._w = w;
        this._h = h;

        this.sceneTarget.setSize(w, h);
        this.rtSsr.setSize(w, h);
        this.history[0].setSize(w, h);
        this.history[1].setSize(w, h);
        this.rtShafts.setSize(quarter(w), quarter(h));
        this.rtBloom0.setSize(quarter(w), quarter(h));
        this.rtBloom1.setSize(sixteenth(w), sixteenth(h));
        this.rtBloom2.setSize(sixteenth(w), sixteenth(h));
        this.rtDof.setSize(w, h);
        this.rtComposite.setSize(w, h);

        this._invRes.set(1 / w, 1 / h);
        this._refreshTexelSizes();

        // The reprojection would be against a differently-shaped frustum and the
        // history against a differently-sized buffer.
        this._historyValid = 0;
    }

    /** @returns {void} */
    dispose() {
        for (let i = 0; i < this.passes.length; i++) this.passes[i].dispose();
        this.sceneTarget.dispose();
        this.rtSsr.dispose();
        this.history[0].dispose();
        this.history[1].dispose();
        this.rtShafts.dispose();
        this.rtBloom0.dispose();
        this.rtBloom1.dispose();
        this.rtBloom2.dispose();
        this.rtDof.dispose();
        this.rtComposite.dispose();
    }

    /**
     * The prepass texture. Resolved per frame rather than cached because the
     * prepass reallocates its target on resize, and a stale texture reference is
     * a silently black depth buffer.
     * @returns {THREE.Texture|null}
     */
    _depthTex() {
        if (this.depthTexture) return this.depthTexture;
        const d = this.depthPass;
        if (!d) return null;
        return (
            d.depthTexture ||
            d.texture ||
            (d.target && d.target.texture) ||
            (d.rt && d.rt.texture) ||
            (d.rtt && d.rtt.texture) ||
            null
        );
    }
}

// --------------------------------------------------------------------- helpers

/** Linear quarter of the full render size, never zero. */
function quarter(n) {
    return Math.max(1, Math.ceil(n / 4));
}

/** Linear sixteenth of the full render size, never zero. */
function sixteenth(n) {
    return Math.max(1, Math.ceil(n / 16));
}

/**
 * Read a THREE.Color or a Vector3 into `out`. The sky subsystem's
 * `sunRadiance` is linear radiance pre-multiplied by intensity; which of the two
 * types it uses is not fixed by ARCHITECTURE §3, so both are accepted.
 * @param {any} c
 * @param {THREE.Vector3} out
 */
function readColor(c, out) {
    if (!c) return;
    if (c.isColor) out.set(c.r, c.g, c.b);
    else if (c.isVector3) out.set(c.x, c.y, c.z);
}

/**
 * Halton(2,3) on [-0.5, 0.5] in PIXELS, flattened to (x, y) pairs. Starts at
 * index 1, not 0 — index 0 of a radical-inverse sequence is the origin.
 * @param {number} n
 */
function buildHalton(n) {
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
        out[i * 2] = radical(i + 1, 2) - 0.5;
        out[i * 2 + 1] = radical(i + 1, 3) - 0.5;
    }
    return out;
}

function radical(i, base) {
    let f = 1;
    let r = 0;
    let k = i;
    while (k > 0) {
        f /= base;
        r += f * (k % base);
        k = Math.floor(k / base);
    }
    return r;
}
