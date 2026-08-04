/**
 * The snow-surf wake — the centrepiece. [WAKE]
 *
 * Port of `snowflow_demo/src/vfx/surfWake.js`.
 *
 * Three things come out of this module and they are deliberately one system:
 *
 *   the wave    a swept mesh built from the path the board has taken, shaped as
 *               a breaking wave that rises just behind the bow, curls over, and
 *               collapses into powder about nine tenths of a second later.
 *   the plume   spray thrown off the lip of that wave, emitted from the crest
 *               position the mesh is actually drawing rather than from the
 *               player's feet.
 *   the crest   the bow. The two walls converge just ahead of the boots, so the
 *               pair reads as snow splitting around something moving through it.
 *
 * They are one system because they share one spine. A plume emitted from an
 * independent guess at where the wave is will drift out of register with it the
 * moment the player turns, and the failure is not subtle — the spray comes off
 * the wrong side of a carve.
 *
 * The spine is a ring of samples laid every 30 cm of travel. Nothing is rebuilt:
 * the mesh is a STATIC LATTICE of (column, row, side) and the vertex shader
 * places every vertex from a 96 x 3 data texture, exactly as the spray billboards
 * are placed. So a 17-metre wake and a 2-metre one cost the same vertex buffer
 * and the same 4.5 KiB upload.
 *
 * Allocation per frame: none.
 *
 * =============================================================================
 * WHERE THIS SITS IN THE FRAME (ARCHITECTURE.md §4, _spec/wake-spray.md §1.1):
 *
 *     character.update(dt, rig)          -> velocity, facing, surf, carve, speed
 *     rig.update(...)
 *     sky.render(); shadows.update(...)
 *     terrain.update(...)                -> deformation groove + berms staged
 *     wake.update(dt, camera)            <- HERE: spine advance, resolve,
 *                                           data-texture upload, plume emission
 *     spray.update(dt, camera)           <- MUST be after wake.update
 *     shadows.render(); depthPass.render(camera); beauty
 *
 * `wake.update` has to run before `shadows.render()` and before the beauty pass,
 * because all four programs read the spine uniforms it writes. It has to run
 * before `spray.update` because it emits into the pool that `spray.update` then
 * uploads; emitting after the upload costs one frame of latency and
 * desynchronises the plume from the crest during a turn.
 *
 * =============================================================================
 * HANDEDNESS (ARCHITECTURE.md §6). Four lines in this file carry it and each is
 * marked PORT FRAME. The reference is Babylon / left-handed:
 *
 *     forward = ( sin f,  cos f )        right = ( cos f, -sin f )
 *
 * This port's world is the reference's mirrored in z (`core/camera.js`,
 * `character/controller.js`), so with the same `facing` parameter:
 *
 *     forward = ( sin f, -cos f )        right = ( cos f,  sin f )
 *
 * ONE BASIS, ONE CONVENTION: only `right` is stored, in row 1 of the data
 * texture, and forward is rebuilt from it wherever it is needed —
 * `( right.z, -right.x )` here on the CPU and the identical expression in
 * `lib/wake`'s `wakePoint`. Do not store forward separately.
 *
 * Getting this wrong is silent at a standstill and obvious in a turn: the lip's
 * backward shear runs forwards, the plume leaves from ahead of the board, and
 * the two walls twist the wrong way.
 */

import * as THREE from "three";
import { S } from "../core/settings.js";
import { resolve, shader } from "../core/glsl.js";
import {
    WAKE_VERTEX,
    wakeFragment,
    WAKE_DEPTH_VERTEX,
    WAKE_DEPTH_FRAGMENT,
    WAKE_PREPASS_VERTEX,
    WAKE_PREPASS_FRAGMENT,
} from "../shaders/wake.glsl.js";

/** Spine capacity. At 30 cm a sample this is 28.5 m, comfortably past `LIFE`. */
const SPINE_MAX = 96;

/** Metres of travel between committed samples. */
const SPINE_STEP = 0.30;

/**
 * Seconds a thrown wall of snow stays up.
 *
 * This is the number that sets how long the wake is, because length is just
 * `LIFE * speed` — 17 m at the controller's top speed of 19.5 m/s, under five at
 * a jog. Tying it to time rather than to distance is what makes a slow carve
 * leave a short wave and a fast one leave a long one, without a second constant.
 */
const LIFE = 0.88;

/** How far ahead of the player the bow sits, metres. */
const BOW_LEAD = 0.55;

/**
 * Peak wall height at a full-speed hard carve, metres.
 *
 * Taller than the character, deliberately. A physically plausible 1.45 m — what
 * a real snowboard carve throws — reads as a ripple at this framing, nine metres
 * back and slightly above, beside the 0.9 m of relief the trench and its berms
 * already have. `core/settings.js` still documents `wakeHeight` against 1.45;
 * the code is authoritative (_spec/wake-spray.md §13.1).
 */
const MAX_HEIGHT = 2.4;

// Mesh lattice. Columns run along the spine, rows across the wave section. 128
// columns for at most 96 spine samples, so the lattice always OVER-samples the
// spine, never the reverse.
const COLS = 128;
const ROWS = 18;

/** How many cascades the wake casts into. Same reasoning as the character. */
const WAKE_CASCADES = 2;

/** The wake reads the cascades a little softer than the snow field does. */
const SHADOW_SOFTNESS = 1.5;
const SHADOW_BIAS = 0.018;

// ------------------------------------------------------- module-scope scratch
const _camPos = new THREE.Vector3();

/**
 * Seeded jitter for the plume.
 *
 * The reference used `Math.random()` throughout `_plume`. ARCHITECTURE.md §6
 * forbids it anywhere the shot battery can observe, and shot 06 is exactly that,
 * so this is a plain xorshift32 seeded at module load — identical input history
 * yields an identical plume, run after run. Seeded differently from
 * `character/snowContact.js`'s stream so the footfall kick and the plume do not
 * correlate.
 */
let _rng = 0x2545f491 >>> 0;
function rand01() {
    let x = _rng;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    _rng = x;
    return x / 4294967296;
}

/**
 * Is a shared chunk registered? `lib/spellLights` belongs to SPELLS and may not
 * exist yet; an `#include` of a missing chunk throws at material construction.
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

export class SurfWake {
    /**
     * @param {THREE.Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {import("./particles.js").SprayField} spray may be null
     * @param {{heightAt(x:number,z:number):number,
     *          shadingUniforms?: Record<string, {value:any}>}} terrain
     * @param {{globals?: Record<string, {value:any}>,
     *          spellUniforms?: Record<string, {value:any}>}} [deps]
     */
    constructor(scene, sky, shadows, controller, spray, terrain, deps) {
        this.scene = scene;
        this.sky = sky;
        this.shadows = shadows;
        this.controller = controller;
        this.spray = spray;
        this.terrain = terrain;

        // ---- spine ring ----------------------------------------------------
        this._x = new Float32Array(SPINE_MAX);
        this._y = new Float32Array(SPINE_MAX);
        this._z = new Float32Array(SPINE_MAX);
        /** The character's RIGHT vector at lay time. PORT FRAME: (cos f, sin f). */
        this._rx = new Float32Array(SPINE_MAX);
        this._rz = new Float32Array(SPINE_MAX);
        /** Odometer reading when the sample was laid, metres. */
        this._travel = new Float32Array(SPINE_MAX);
        /** Clock reading when the sample was laid, seconds. */
        this._laid = new Float32Array(SPINE_MAX);
        /** Wave strength captured at lay time, 0..1. */
        this._strength = new Float32Array(SPINE_MAX);
        /** Signed carve captured at lay time. Positive = turning right. */
        this._carve = new Float32Array(SPINE_MAX);

        /** Newest sample. While the player is surfing it is rewritten each frame. */
        this._head = 0;
        this._count = 0;
        this._odo = 0;
        this._clock = 0;
        this._active = false;
        this._plumeOwed = 0;
        this._driftOwed = 0;

        // Per-column resolved amplitude, so the plume can be emitted from the
        // crest the mesh is actually drawing rather than from a second estimate.
        this._ampL = new Float32Array(SPINE_MAX);
        this._ampR = new Float32Array(SPINE_MAX);
        this._dist = new Float32Array(SPINE_MAX);
        /** Ring index of each column, newest first. */
        this._col = new Int32Array(SPINE_MAX);

        // ---- the spine data texture ----------------------------------------
        // 96 wide x 3 tall, RGBA32F, NEAREST, CLAMP, no mips. One column per
        // sample, column 0 = the bow. Layout in lib/wake's header.
        //
        // NOT RGBA16F: row 0 holds absolute world coordinates that reach ~870 m
        // on this map, and fp16's relative precision at 1000 is ~0.5 m — the
        // whole wake would quantise into half-metre steps.
        this._texData = new Float32Array(SPINE_MAX * 3 * 4);
        this.dataTex = new THREE.DataTexture(
            this._texData, SPINE_MAX, 3, THREE.RGBAFormat, THREE.FloatType
        );
        this.dataTex.minFilter = THREE.NearestFilter;
        this.dataTex.magFilter = THREE.NearestFilter;
        this.dataTex.wrapS = THREE.ClampToEdgeWrapping;
        this.dataTex.wrapT = THREE.ClampToEdgeWrapping;
        this.dataTex.generateMipmaps = false;
        // Array row 0 must land on texel row 0, or the spine reads its own
        // amplitudes as positions.
        this.dataTex.flipY = false;
        this.dataTex.unpackAlignment = 4;
        this.dataTex.name = "wakeTex";
        this.dataTex.needsUpdate = true;

        // ---- uniform blocks --------------------------------------------------
        /**
         * `lib/wake`'s own block. ONE object per name, shared by reference with
         * the beauty material, both cascade materials and the prepass material,
         * so a single write per frame reaches all four and they cannot disagree
         * about where a vertex is. That is the same guarantee `lib/deform` and
         * `lib/clipmap` give the terrain.
         */
        this.wakeUniforms = {
            wakeTex: { value: this.dataTex },
            wakeCount: { value: 0 },
            wakeCols: { value: COLS },
            wakeRows: { value: ROWS },
            wakeTime: { value: 0 },
        };

        /**
         * `lib/common`'s shared globals (ARCHITECTURE.md §3), owned here for the
         * same reason `render/sky.js`, `terrain/terrain.js` and
         * `character/character.js` own theirs. `uSunDir` / `uSunColor` hold live
         * references into `sky`. `uCameraPos` **and `uViewProj`** are both
         * written by `update()` off the beauty camera it is handed, exactly as
         * `terrain/terrain.js`, `character/character.js` and `render/sky.js`
         * write theirs — see the note in `update()`. Handing in a shared block
         * as `deps.globals` still works: the write is the same matrix.
         */
        this.globals = (deps && deps.globals) || {
            uSunDir: { value: sky.sunDir },
            uSunColor: { value: sky.sunRadiance },
            uCameraPos: { value: new THREE.Vector3() },
            uTime: { value: 0 },
            uViewProj: { value: new THREE.Matrix4() },
            uResolution: { value: new THREE.Vector2(1, 1) },
        };

        this._uWakeDebug = { value: 0 };

        /** True when the real spell-light chunk was found; false = stub term. */
        this.spellLightsBound = chunkRegistered("lib/spellLights");

        // ---- geometry --------------------------------------------------------
        this.geometry = buildLattice();
        this.triangles = this.geometry.userData.triangles;

        // ---- beauty material -------------------------------------------------
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(WAKE_VERTEX),
            fragmentShader: shader(wakeFragment({ spellLights: this.spellLightsBound })),
            uniforms: Object.assign(
                {},
                this.globals,
                sky.uniforms,
                (terrain && terrain.shadingUniforms) || {},
                shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
                (deps && deps.spellUniforms) || {},
                this.wakeUniforms,
                { wakeDebug: this._uWakeDebug }
            ),
            // An open curled sheet: both faces are seen, often in the same frame
            // through the holes torn in the lip.
            side: THREE.DoubleSide,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });
        this.material.name = "surfWake";

        // ---- mesh ------------------------------------------------------------
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "surfWake";
        // Every vertex is placed in the vertex shader, so the CPU has no idea
        // where this mesh is — a frustum test against its (identity) bounds would
        // cull it the moment the player moves.
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.updateMatrix();
        // The reference's renderingGroupId = 1: opaque, after the sky.
        this.mesh.renderOrder = 1;
        this.mesh.visible = false;
        if (scene) scene.add(this.mesh);

        /** For `gfx.warmUp`'s extra-mesh list. */
        this.meshes = [this.mesh];

        // ---- shadow casters --------------------------------------------------
        // Two of three cascades, each with its OWN material so each holds its own
        // lightViewProjection with no mid-frame uniform juggling — and each runs
        // the same `wakePoint` the beauty pass runs, out of the shared include,
        // so the depth map holds the surface being drawn (ARCHITECTURE.md §5).
        /** @type {THREE.RawShaderMaterial[]} */
        this._depthMats = [];
        shadows.registerCaster(this.mesh, (c) => this._makeDepthMaterial(c), WAKE_CASCADES);

        /** @type {THREE.RawShaderMaterial|null} */
        this.prepassMat = null;

        this._enabled = true;

        /**
         * Per-term diagnostic, settable from the console as
         * `SNOWFLOW.wake.debug = n`. See the switch at the bottom of
         * `wakeFragment()` for the modes; 10 is the one that says whether the two
         * mirrored walls agree.
         */
        this.debug = 0;
    }

    /**
     * @param {number} cascade
     * @returns {THREE.RawShaderMaterial}
     */
    _makeDepthMaterial(cascade) {
        const mat = this.shadows.makeCasterMaterial(
            WAKE_DEPTH_VERTEX,
            this.wakeUniforms,
            {
                fragmentSource: WAKE_DEPTH_FRAGMENT,
                // Forces a distinct compiled program per cascade, matching the
                // reference's `defines: ["WAKE_CASCADE " + cascade]`.
                defines: { WAKE_CASCADE: cascade },
            }
        );
        mat.name = "wakeDepth" + cascade;
        this._depthMats.push(mat);
        return mat;
    }

    /**
     * Register the camera-space depth prepass.
     *
     * The wake belongs in the prepass for two separate reasons: it is the largest
     * moving object in the frame, so the temporal resolve needs its depth to
     * reproject anything in front of it, and a two-metre wall of snow standing on
     * the field ought to occlude the trench beside it.
     *
     * It does not *receive* occlusion from anything external — see the note on
     * the barrel term in `wakeFragment()`.
     *
     * @param {import("../render/depthPass.js").DepthPass} depth
     * @returns {void}
     */
    registerPrepass(depth) {
        const mat = depth.makeCasterMaterial(
            WAKE_PREPASS_VERTEX,
            this.wakeUniforms,
            { fragmentSource: WAKE_PREPASS_FRAGMENT }
        );
        mat.name = "wakePrepass";
        this.prepassMat = mat;
        depth.registerCaster(this.mesh, mat);
    }

    /**
     * @param {boolean} v
     * @returns {void}
     */
    setEnabled(v) {
        this._enabled = !!v;
        if (!this._enabled) this.mesh.visible = false;
    }

    /**
     * Advance the spine, resolve the wave, upload, shed the plume.
     *
     * Called after the controller has integrated and before anything renders, so
     * the bow is at the position the character is actually drawn at.
     *
     * @param {number} dt seconds
     * @param {THREE.Camera} camera the beauty camera
     * @returns {void}
     */
    update(dt, camera) {
        if (camera && camera.isCamera === true) {
            _camPos.setFromMatrixPosition(camera.matrixWorld);
            this.globals.uCameraPos.value.copy(_camPos);
            // The beauty pass's JITTERED view-projection. `post.update()` writes
            // the TAA jitter straight into `camera.projectionMatrix`, and this
            // runs after it, so the product is the matrix the rest of the frame
            // rasterises through.
            //
            // This has to happen HERE and not in the integrator: the wake owns
            // this globals block, and a block whose `uViewProj` nobody writes
            // stays the identity — which sends `wakePoint`'s world-space output
            // straight to clip space and puts the whole lattice outside the clip
            // volume, so the wave renders nothing at all however healthy the
            // spine looks on the CPU. Writes in place; no allocation.
            this.globals.uViewProj.value.multiplyMatrices(
                camera.projectionMatrix, camera.matrixWorldInverse
            );
        }

        this._clock += dt;

        const ch = this.controller;
        const moved = Math.hypot(ch.velocity.x, ch.velocity.z) * dt;
        this._odo += moved;

        // Below a walking pace there is nothing being displaced, and laying
        // samples anyway leaves a knot of overlapping wall wherever the player
        // coasted to a stop.
        const active = ch.surf > 0.06 && ch.speed > 1.6;

        if (active) {
            if (!this._active) this._maybeRestart();
            this._writeHead();
            this._active = true;
        } else {
            this._active = false;
        }

        // Retire BEFORE resolve, so a column that has just passed LIFE is
        // dropped rather than drawn at zero.
        this._retire();
        const maxAmp = this._resolve();

        // `S.showWake` is read here rather than only through setEnabled() so the
        // overlay's toggle drives the mesh whether or not the integrator wires
        // the two together.
        this.mesh.visible =
            this._enabled && !!S.showWake && this._count >= 2 && maxAmp > 0.01;
        if (this.mesh.visible) {
            this.dataTex.needsUpdate = true;
            this._pushUniforms();
        }

        // Runs even when the mesh is invisible: the gate inside `_plume` is
        // separate and stricter. (Reference behaviour — `S.wakeSpray` is the
        // plume's own control.)
        if (this.spray) this._plume(dt);
    }

    /**
     * A new run starts a new spine rather than continuing the last one.
     *
     * Reconnecting would sweep a wall of snow across whatever ground lies between
     * where the player stopped and where they started again — which, if they
     * turned around, is a wave running backwards through the field. 0.25 s is
     * the hysteresis.
     * @returns {void}
     */
    _maybeRestart() {
        if (this._count === 0) return;
        const age = this._clock - this._laid[this._head];
        if (age > 0.25) this._count = 0;
    }

    /**
     * Write (or rewrite) the live bow sample, and commit it once it has moved.
     * @returns {void}
     */
    _writeHead() {
        const ch = this.controller;
        const i = this._head;

        // PORT FRAME: forward = ( sin f, -cos f ). The reference, being
        // left-handed, writes ( sin f, cos f ).
        const fx = Math.sin(ch.facing);
        const fz = -Math.cos(ch.facing);
        const bx = ch.position.x + fx * BOW_LEAD;
        const bz = ch.position.z + fz * BOW_LEAD;

        this._x[i] = bx;
        this._y[i] = this.terrain.heightAt(bx, bz);
        this._z[i] = bz;
        // PORT FRAME: right = ( cos f, sin f ). The reference writes
        // ( cos f, -sin f ). This is the ONLY basis stored; `lib/wake` and
        // `_plume` both rebuild forward from it.
        this._rx[i] = Math.cos(ch.facing);
        this._rz[i] = Math.sin(ch.facing);
        this._travel[i] = this._odo;
        this._laid[i] = this._clock;
        // Speed sets how much snow there is to throw; the surf blend eases the
        // whole thing in and out so entering and leaving are never a switch.
        // Full strength at >= 11.2 m/s.
        //
        // AIRBORNE (the surf ollie, owner decision 2026-08-04) the strength is
        // ZERO: the tracker keeps FOLLOWING — samples keep committing every
        // 30 cm along the flight path, so the ring never bridges take-off to
        // landing with one giant segment — while the WRITER is gated, because a
        // zero-strength sample resolves to zero amplitude and `wakePoint`
        // collapses it onto its spine 0.10 m BELOW the ground height (the flat
        // sink term), i.e. buried. The pre-jump wall lives out its 0.88 s
        // collapse where it was laid; a fresh wall builds from the landing
        // point the moment grounded samples resume. This is the same
        // tracker-follows/writer-gates split `snowContact.js` documents for its
        // `_prevX`/`_prevZ` trap.
        this._strength[i] = ch.airborne
            ? 0
            : ch.surf * clamp01((ch.speed - 2.2) / 9.0);
        this._carve[i] = ch.carve;

        if (this._count === 0) {
            this._count = 1;
            return;
        }

        // Commit once the bow has travelled a full step from the last fixed
        // sample. The head then freezes exactly where it was and a fresh live
        // sample takes over, so the spine is A RECORD OF THE PATH rather than a
        // resampling of a smoothed one.
        const p = (i - 1 + SPINE_MAX) % SPINE_MAX;
        const dx = this._x[i] - this._x[p];
        const dz = this._z[i] - this._z[p];
        if (this._count === 1 || dx * dx + dz * dz >= SPINE_STEP * SPINE_STEP) {
            this._head = (i + 1) % SPINE_MAX;
            if (this._count < SPINE_MAX) this._count++;
            // Seed the new live sample from the one it follows, so a frame in
            // which the head has not been written yet is still a valid spine.
            const n = this._head;
            this._x[n] = this._x[i]; this._y[n] = this._y[i]; this._z[n] = this._z[i];
            this._rx[n] = this._rx[i]; this._rz[n] = this._rz[i];
            this._travel[n] = this._travel[i]; this._laid[n] = this._laid[i];
            this._strength[n] = this._strength[i]; this._carve[n] = this._carve[i];
        }
    }

    /** Drop samples that have finished collapsing. @returns {void} */
    _retire() {
        while (this._count > 0) {
            const tail = (this._head - this._count + 1 + SPINE_MAX) % SPINE_MAX;
            if (this._clock - this._laid[tail] <= LIFE) break;
            this._count--;
        }
    }

    /**
     * Resolve every column's amplitude and curl and write the data texture.
     *
     * Which side of the board is the *outside* of the turn is the one thing both
     * sides need to agree on, and it is a fact about the carve rather than about
     * geometry — so it is decided once, here, and shipped to the shader as a pair
     * of resolved amplitudes rather than as a carve the vertex shader would have
     * to re-interpret.
     *
     * Runs newest-first: column j = 0 is the bow.
     *
     * @returns {number} the largest amplitude anywhere on the wave, metres
     */
    _resolve() {
        const d = this._texData;
        const n = this._count;
        const heightScale = MAX_HEIGHT * S.wakeHeight;
        let maxAmp = 0;

        for (let j = 0; j < n; j++) {
            const i = (this._head - j + SPINE_MAX) % SPINE_MAX;
            this._col[j] = i;

            const dist = this._odo - this._travel[i] + BOW_LEAD;
            const a01 = clamp01((this._clock - this._laid[i]) / LIFE);

            // Rise: the wall is small at the bow and full by about 1.6 m behind
            // it. Fall: quadratic to EXACTLY zero at the end of life, so the tail
            // column always degenerates onto its own spine instead of ending in a
            // cut edge. That is also why wake length is LIFE * speed with no
            // second constant.
            const shape = 0.34 + 0.66 * smoothstep01((dist - 0.3) / 1.3);
            const env = (1 - a01) * (1 - a01);
            const base = heightScale * this._strength[i] * shape * env;

            // Outside of the turn takes the snow. `carve` is positive turning
            // right, and the outside of a right turn is the LEFT-hand side.
            const c = this._carve[i];
            const biasL = c < -1 ? -1 : c > 1 ? 1 : c;
            const biasR = -biasL;

            // Straight running throws a modest wall each side (0.45 of base); a
            // hard carve puts 100% outboard and 5% inboard — a 20:1 split. The
            // spread between those two is the whole reason to steer.
            const ampL = base * clampRange(0.45 + 0.55 * biasL, 0.05, 1.0);
            const ampR = base * clampRange(0.45 + 0.55 * biasR, 0.05, 1.0);
            // A wall that is barely there does not curl; a hard carve throws snow
            // far enough over that the lip hangs back across its own face.
            const curlL = clampRange(0.42 + 0.58 * biasL, 0.26, 1.0);
            const curlR = clampRange(0.42 + 0.58 * biasR, 0.26, 1.0);

            if (ampL > maxAmp) maxAmp = ampL;
            if (ampR > maxAmp) maxAmp = ampR;
            this._ampL[j] = ampL;
            this._ampR[j] = ampR;
            this._dist[j] = dist;

            const o0 = j * 4;
            const o1 = (SPINE_MAX + j) * 4;
            const o2 = (SPINE_MAX * 2 + j) * 4;
            d[o0] = this._x[i]; d[o0 + 1] = this._y[i]; d[o0 + 2] = this._z[i]; d[o0 + 3] = dist;
            d[o1] = this._rx[i]; d[o1 + 1] = this._rz[i]; d[o1 + 2] = ampL; d[o1 + 3] = ampR;
            d[o2] = curlL; d[o2 + 1] = curlR; d[o2 + 2] = a01; d[o2 + 3] = 0;
        }

        return maxAmp;
    }

    /**
     * Spray off the lip.
     *
     * Emitted from the crest position the mesh is drawing — same spine, same
     * amplitude, same side weighting — so the plume leaves the wave rather than
     * appearing near it. Rate is PER METRE TRAVELLED, not per second, so it does
     * not thin out at a higher frame rate.
     *
     * @param {number} dt
     * @returns {void}
     */
    _plume(dt) {
        const ch = this.controller;
        const sp = this.spray;
        const n = this._count;
        if (n < 3 || ch.surf < 0.15 || ch.speed < 3.0) {
            this._plumeOwed = 0;
            return;
        }
        // Airborne (the ollie) nothing is being displaced, so nothing sheds.
        // Both owed odometers reset rather than accrue: letting them run would
        // dump the whole flight's worth of grains in a burst on the landing
        // frame, over ground the board never touched.
        if (ch.airborne) {
            this._plumeOwed = 0;
            this._driftOwed = 0;
            return;
        }

        const travelled = ch.speed * dt;
        this._plumeOwed += travelled;
        this._driftOwed += travelled;

        // Two populations, because spray off a carve is two things and trying to
        // get both out of one emitter gets neither.
        //
        //   curtain   a dense, slow, short-lived sheet hugging the crest. This is
        //             the mass of it, and it is what makes the wave look like it
        //             is disintegrating rather than sliding.
        //   throw     ballistic grains flung clear, which give the plume its
        //             reach and its silhouette against the sky.
        //
        // Sizing is set by the curtain: at ten metres a six-centimetre puff is
        // six pixels, and a thousand six-pixel dots at low opacity spread over
        // twenty metres of trail is a faint haze rather than a plume.
        const perMetre = 88 * S.wakeSpray;
        let count = perMetre > 0 ? (this._plumeOwed * perMetre) | 0 : 0;
        if (count > 0) {
            this._plumeOwed -= count / perMetre;   // keep the fractional remainder
            if (count > 150) count = 150;

            // Sample the live part of the wave — roughly the first 4.5 m, which
            // is where a breaking crest is actually shedding. From column zero,
            // so the plume is attached to the board: starting a metre back leaves
            // a bare gap exactly where the eye is looking.
            //
            // FRACTIONALLY, which matters more than any of the sizing constants.
            // Picking a whole column puts every grain on one of fifteen points
            // 30 cm apart and the plume comes out as fifteen clumps of dots in a
            // row; interpolating along the spine spreads the same count over a
            // continuous line.
            const span = Math.min(n - 1, 15);

            for (let k = 0; k < count; k++) {
                const jf = rand01() * span;
                const j = jf | 0;
                const j2 = j + 1 < n ? j + 1 : j;
                const t = jf - j;

                const aL = this._ampL[j] + (this._ampL[j2] - this._ampL[j]) * t;
                const aR = this._ampR[j] + (this._ampR[j2] - this._ampR[j]) * t;
                const total = aL + aR;
                if (total < 0.12) continue;   // no wave here worth shedding from

                // Side drawn with probability proportional to that side's
                // amplitude. On a hard carve (20:1) roughly 95% of grains come
                // off the outside wall, which is what makes the spray arc OUT of
                // the turn.
                const side = rand01() * total < aL ? -1 : 1;
                const amp = side < 0 ? aL : aR;
                if (amp < 0.10) continue;

                const i = this._col[j];
                const i2 = this._col[j2];
                // Interpolated and deliberately NOT renormalised — over 0.3 m of
                // a turn the error is negligible and the reference does not
                // correct it either.
                const rx = this._rx[i] + (this._rx[i2] - this._rx[i]) * t;
                const rz = this._rz[i] + (this._rz[i2] - this._rz[i]) * t;
                // PORT FRAME: forward = ( right.z, -right.x ). The reference, in
                // its left-handed world, writes ( -right.z, right.x ). Same basis
                // the shader builds, by construction.
                const fx = rz;
                const fz = -rx;

                const sx = this._x[i] + (this._x[i2] - this._x[i]) * t;
                const sy = this._y[i] + (this._y[i2] - this._y[i]) * t;
                const sz = this._z[i] + (this._z[i2] - this._z[i]) * t;
                const dist = this._dist[j] + (this._dist[j2] - this._dist[j]) * t;

                // Just outboard of the crest's lateral maximum, at its height.
                // MIRRORS `wakePoint`'s base offset exactly, so the plume leaves
                // the lip the mesh is drawing rather than a second guess at where
                // it is.
                const l0 = 0.24 + 0.44 * smoothstep01((dist - 0.3) / 2.3);
                // The section's lateral maximum sits at about 0.65 of the
                // amplitude once the squash is applied, and the lip hooks back
                // inside that — so the shed grains leave from a BAND straddling
                // the crest rather than from a single line.
                const lat = l0 + (0.35 + rand01() * 0.55) * amp;
                const px = sx + rx * side * lat;
                const pz = sz + rz * side * lat;
                // Spread down the face but weighted toward the lip: a sqrt on a
                // uniform biases the draw upward, so most grains leave from the
                // crest — which is where the wall is actually coming apart —
                // while enough sheet down the face to avoid a horizontal rope of
                // dots. Range 0.30*amp .. 1.12*amp above the spine.
                const py = sy + (0.30 + 0.82 * Math.sqrt(rand01())) * amp;

                // ---- curtain, 72% ------------------------------------------
                // Big, slow, short-lived, HIGH drag. A puff of blown snow is a
                // cloud rather than a crystal, and at this framing it has to be
                // 20-40 cm across (diameter; the emitted value is a radius and
                // `grow` takes it up to 2.3x) to be a shape at all. It dies
                // before it can drift far enough for the size to look wrong.
                if (rand01() < 0.72) {
                    sp.emit(
                        px, py, pz,
                        rx * side * (0.4 + rand01() * 1.1) + ch.velocity.x * 0.16,
                        0.9 + rand01() * 1.8,
                        rz * side * (0.4 + rand01() * 1.1) + ch.velocity.z * 0.16,
                        0.055 + rand01() * 0.085,
                        0.34 + rand01() * 0.40,
                        0,
                        4.5
                    );
                    continue;
                }

                // ---- throw, 28% --------------------------------------------
                const out = 1.2 + rand01() * 2.6;
                const back = 0.4 + rand01() * 2.2;
                const clod = rand01() < 0.18 ? 1 : 0;

                sp.emit(
                    px, py, pz,
                    rx * side * out - fx * back + ch.velocity.x * 0.30,
                    1.6 + rand01() * 3.4 + amp * 1.5,
                    rz * side * out - fz * back + ch.velocity.z * 0.30,
                    clod ? 0.020 + rand01() * 0.022 : 0.045 + rand01() * 0.055,
                    clod ? 0.7 + rand01() * 0.5 : 0.9 + rand01() * 1.3,
                    clod,
                    // BALLISTIC — 0.7-1.8/s against the curtain's 4.5. This is a
                    // mass of snow leaving a wave and it has to actually clear
                    // the wave; see the note on `drag` in particles.js.
                    clod ? 0.7 : 1.0 + rand01() * 0.8
                );
            }
        }

        // ---- drift: a separate, slower stream of fine powder hanging low over
        // the trench. The lip spray is all ballistic and gone in a second; this
        // is the part that leaves the trail LOOKING LIKE IT IS STILL SMOKING.
        // Emitted along the whole visible wake, at ground level, with no side
        // weighting at all, and it lives 2-4x as long as anything else.
        //
        // Note `_driftOwed` is deliberately NOT reset by the gate above.
        const driftPerMetre = 7 * S.wakeSpray;
        let drift = driftPerMetre > 0 ? (this._driftOwed * driftPerMetre) | 0 : 0;
        if (drift > 0) {
            this._driftOwed -= drift / driftPerMetre;
            if (drift > 14) drift = 14;
            const dspan = Math.min(n - 3, 22);
            for (let k = 0; k < drift; k++) {
                const jf = 2 + rand01() * dspan;
                const j = jf | 0;
                const j2 = j + 1 < n ? j + 1 : j;
                const t = jf - j;
                const i = this._col[j];
                const i2 = this._col[j2];
                // A zero-strength column is the airborne gap (see `_writeHead`):
                // no trench was cut there, so nothing smokes over it. The lip
                // plume needs no such check — its amplitude gate already skips.
                if (this._strength[i] <= 0.001 && this._strength[i2] <= 0.001) continue;
                const rx = this._rx[i] + (this._rx[i2] - this._rx[i]) * t;
                const rz = this._rz[i] + (this._rz[i2] - this._rz[i]) * t;
                const lat = (rand01() - 0.5) * 1.6;   // +/- 0.8 m either side
                sp.emit(
                    this._x[i] + (this._x[i2] - this._x[i]) * t + rx * lat,
                    this._y[i] + (this._y[i2] - this._y[i]) * t + 0.08 + rand01() * 0.35,
                    this._z[i] + (this._z[i2] - this._z[i]) * t + rz * lat,
                    (rand01() - 0.5) * 1.1,
                    0.25 + rand01() * 0.9,
                    (rand01() - 0.5) * 1.1,
                    0.026 + rand01() * 0.036,
                    1.5 + rand01() * 1.6,
                    0,
                    // High drag: this stream is meant to hang over the trench and
                    // drift, not to fly.
                    4.5
                );
            }
        }
    }

    /**
     * One write per name reaches all four programs — the uniform objects are
     * shared by reference.
     * @returns {void}
     */
    _pushUniforms() {
        this.wakeUniforms.wakeCount.value = this._count;
        this.wakeUniforms.wakeTime.value = this._clock;
        this._uWakeDebug.value = this.debug;
    }

    /**
     * Lay a synthetic straight spine under the player so the warm-up frames
     * actually rasterise the wake rather than compiling four pipelines that have
     * never had a triangle through them. The first real `update()` overwrites it.
     *
     * @returns {void}
     */
    warmUpSeed() {
        const ch = this.controller;
        const d = this._texData;
        const n = 24;
        this._count = n;
        for (let j = 0; j < n; j++) {
            const dist = j * SPINE_STEP + BOW_LEAD;
            const x = ch.position.x;
            // PORT FRAME. Row 1 below stores right = (1, 0), i.e. facing 0, whose
            // forward here is ( 0, -1 ) — so the spine, which runs BACKWARD from
            // the bow, marches in +z. The reference's straight spine marches in
            // -z for exactly the mirrored reason.
            const z = ch.position.z + dist;
            const a01 = j / n;
            const amp = 0.8 * (1 - a01) * (1 - a01);
            const o0 = j * 4;
            const o1 = (SPINE_MAX + j) * 4;
            const o2 = (SPINE_MAX * 2 + j) * 4;
            d[o0] = x; d[o0 + 1] = this.terrain.heightAt(x, z); d[o0 + 2] = z; d[o0 + 3] = dist;
            d[o1] = 1; d[o1 + 1] = 0; d[o1 + 2] = amp; d[o1 + 3] = amp;
            d[o2] = 0.7; d[o2 + 1] = 0.7; d[o2 + 2] = a01; d[o2 + 3] = 0;
        }
        this.dataTex.needsUpdate = true;
        this.mesh.visible = true;
        this._pushUniforms();
    }

    /** Undo `warmUpSeed`, so nothing synthetic survives into frame one. */
    warmUpClear() {
        this._count = 0;
        this.mesh.visible = false;
        this._pushUniforms();
    }

    /** @returns {void} */
    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        for (let i = 0; i < this._depthMats.length; i++) this._depthMats[i].dispose();
        if (this.prepassMat) this.prepassMat.dispose();
        this.dataTex.dispose();
    }
}

// -----------------------------------------------------------------------------

/**
 * The static lattice. `position` is (column, row, side) and carries no geometry
 * at all — see `shaders/wake.glsl.js`.
 *
 * Vertex order is ROW-MAJOR WITHIN A COLUMN (`c * ROWS + r`); `side` is -1 for
 * the first 2304 vertices and +1 for the second. 4608 vertices, 25908 indices,
 * 8636 triangles, all built once.
 *
 * The attribute keeps the name `position` even though it is not one, matching
 * `shaders/cloth.glsl.js` and `character/build.js`, which do the same for the
 * same reason. Three only derives a draw count from `position` on a NON-indexed
 * geometry, and this one is indexed.
 * @returns {THREE.BufferGeometry}
 */
function buildLattice() {
    const perSide = COLS * ROWS;
    const pos = new Float32Array(perSide * 2 * 3);
    const idx = new Uint32Array((COLS - 1) * (ROWS - 1) * 2 * 6);

    let vi = 0;
    let ii = 0;
    for (let s = 0; s < 2; s++) {
        const side = s === 0 ? -1 : 1;
        const base = s * perSide;
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
                pos[vi++] = c;
                pos[vi++] = r;
                pos[vi++] = side;
            }
        }
        for (let c = 0; c < COLS - 1; c++) {
            for (let r = 0; r < ROWS - 1; r++) {
                const a = base + c * ROWS + r;
                const b = a + ROWS;
                idx[ii++] = a; idx[ii++] = b; idx[ii++] = b + 1;
                idx[ii++] = a; idx[ii++] = b + 1; idx[ii++] = a + 1;
            }
        }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    g.userData.triangles = idx.length / 3;
    g.userData.vertices = perSide * 2;
    return g;
}

// -------------------------------------------------------------------- helpers

function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampRange(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/** Hermite smoothstep on an already-normalised parameter. */
function smoothstep01(t) {
    const x = clamp01(t);
    return x * x * (3 - 2 * x);
}

export { COLS as WAKE_COLS, ROWS as WAKE_ROWS, SPINE_MAX as WAKE_SPINE_MAX };
