/**
 * Snow spray — a pooled, CPU-simulated, GPU-billboarded particle system. [WAKE]
 *
 * Port of `snowflow_demo/src/vfx/particles.js`.
 *
 * =============================================================================
 * THE EMIT API — the surf plume, the footfall kick and all five spells call it.
 *
 *     spray.emit(x, y, z, vx, vy, vz, size, life, kind, drag)
 *
 *   x, y, z     world position, metres.
 *   vx, vy, vz  world velocity, m/s.
 *   size        RADIUS in metres, not diameter. A powder puff grows to 2.3x this
 *               over its life; a clod does not grow at all. Below about 2 cm a
 *               grain is sub-pixel at any sane framing and contributes nothing
 *               but fill cost; above about 20 cm it reads as a cotton ball.
 *   life        seconds. The alpha ramps in over the first eighth of it and out
 *               quadratically over the rest, so a grain never pops.
 *   kind        0 = powder puff, 1 = heavy clod. APPEARANCE ONLY — it selects
 *               the edge falloff (soft gaussian vs hard rim), the alpha scale
 *               (0.36 vs 0.55), whether the billboard grows, and how much
 *               forward scatter it gets. It does NOT decide how the grain flies.
 *   drag        OPTIONAL linear drag coefficient, 1/s. Omit it and you get the
 *               fall-in-place default for the kind (5.2 powder / 1.1 clod);
 *               pass something near 1 for anything genuinely thrown.
 *
 * `drag` is separate from `kind` on purpose, and it is the single most important
 * thing a caller has to get right. A plume has to LOOK like powder — soft-edged,
 * translucent, puffy — and FLY like a stone, because it is a mass of snow
 * launched off a wave at eight metres a second rather than a grain drifting
 * down. With drag welded to appearance, asking for the look costs 5.2/s of drag,
 * which stops the grain dead in 120 ms and inside the wave that threw it.
 *
 * Rules of the pool:
 *  - CAPACITY is a hard cap, not a target. An emission arriving at a full pool
 *    is silently DROPPED, never queued — at these counts it never happens, and a
 *    hitch is worse than a missing grain.
 *  - Emit as much as you like per frame; there is no per-call cost beyond a
 *    bounded free-slot scan. Rate-limit by DISTANCE TRAVELLED rather than by
 *    time if the effect is attached to something moving, or it thins out at a
 *    higher frame rate.
 *  - Everything is world space. Nothing is parented.
 *
 * =============================================================================
 * WHY IT IS ONE SYSTEM. A separate emitter per effect means separate pipelines,
 * separate warm-up, separate sorting, and five slightly different ideas about
 * what lit snow powder looks like. There is one pipeline here and one lighting
 * model.
 *
 * Simulation is on the CPU because the particle count is small (a footfall is
 * eighteen grains) and the alternative — a compute pass plus indirect draw —
 * costs more in dispatch overhead than the whole simulation costs to run. What
 * IS on the GPU is the expansion: the mesh is a static grid of quads whose only
 * vertex attribute is a particle index and a corner, and the vertex shader
 * fetches the particle's state out of a small data texture. So the CPU writes
 * eight floats per live particle per frame and nothing else crosses the bus.
 *
 * Allocation: none per frame. Everything is a typed array sized at construction,
 * and dead particles are recycled through a free-scan ring rather than compacted.
 *
 * =============================================================================
 * HANDEDNESS (ARCHITECTURE.md §6). Two places touch a world convention:
 *
 *  1. The wind vector, `(sin(bearing), cos(bearing)) * 2.4 * windStrength`, is
 *     transcribed from the reference UNCHANGED — the same decision `render/sky.js`
 *     and `lib/terrain` made. This port's world is the reference's mirrored in z,
 *     so an unconverted bearing mirrors with it and every wind-driven system
 *     stays in register with every other one.
 *  2. The billboard basis is read as the world-space COLUMNS of the camera's
 *     `matrixWorld` (column 0 = right, column 1 = up). The reference lifts the
 *     first two ROWS of Babylon's view matrix, which is the same two vectors —
 *     rows of a view matrix are the columns of its inverse — but "columns of
 *     matrixWorld" is true in Three regardless of storage or vector convention,
 *     so it cannot be transcribed wrong.
 */

import * as THREE from "three";
import { S } from "../core/settings.js";
import { bearingRad } from "../core/bearing.js";
import { fail } from "../core/loading.js";
import { resolve, shader } from "../core/glsl.js";
import { SPRAY_VERTEX, sprayFragment } from "../shaders/spray.glsl.js";

/**
 * Pool size. A hard cap, not a target.
 *
 * Sized for the surf plume, which is the heaviest consumer by an order of
 * magnitude and which needs sheer count more than it needs anything else: at
 * 1200 live grains the plume renders as a field of separated soft discs —
 * legible as bokeh, not as snow — and the only thing that turns that into a
 * continuous mass is enough of them to overlap. 88 + 7 a metre at 19.5 m/s
 * across two populations lands near 3500 live, and the footfall kick and the
 * spells still have to fit alongside.
 *
 * The cost of the headroom is one pass over the array per frame — 5120
 * iterations of a dozen flops — plus 160 KiB of data texture.
 */
const CAPACITY = 5120;

/** Terminal fall speed of a snow grain, m/s. Drag is tuned to land here. */
const TERMINAL = 1.9;

/** Spray reads the cascades softer and with a looser bias than the wake does,
 *  because a billboard has no real geometry to attach a shadow to. */
const SHADOW_SOFTNESS = 1.6;
const SHADOW_BIAS = 0.05;

/** Corner order: (-1,-1), (1,-1), (1,1), (-1,1). */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

// ------------------------------------------------------- module-scope scratch
// Nothing below allocates once construction is done.
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _camPos = new THREE.Vector3();

/**
 * Is a shared chunk registered?
 *
 * `lib/spellLights` belongs to SPELLS and may not exist yet; an `#include` of a
 * missing chunk throws at material construction, which would take the whole
 * spray system down rather than losing one additive term. `resolve()` caches by
 * source string, so this costs one map lookup after the first call.
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

export class SprayField {
    /**
     * @param {THREE.Scene} scene
     * @param {{heightAt(x:number,z:number):number,
     *          shadingUniforms?: Record<string, {value:any}>}} terrain
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {{globals?: Record<string, {value:any}>,
     *          spellUniforms?: Record<string, {value:any}>}} [deps]
     *   `globals` lets the integrator hand in one shared `lib/common` block for
     *   the whole frame; omitted, this object owns its own and the integrator
     *   writes into `spray.globals` (see the note there).
     */
    constructor(scene, terrain, sky, shadows, deps) {
        this.scene = scene;
        this.terrain = terrain;
        this.sky = sky;
        this.shadows = shadows;

        // ---- pool, structure-of-arrays -------------------------------------
        this.pos = new Float32Array(CAPACITY * 3);
        this.vel = new Float32Array(CAPACITY * 3);
        this.age = new Float32Array(CAPACITY);
        this.life = new Float32Array(CAPACITY);
        this.size = new Float32Array(CAPACITY);
        this.seed = new Float32Array(CAPACITY);
        /** 0 = powder puff, 1 = heavy clod. Drives edge hardness and opacity. */
        this.kind = new Float32Array(CAPACITY);
        /** Linear drag coefficient, 1/s. See the API block at the top. */
        this.drag = new Float32Array(CAPACITY);
        /** Index of the next slot to try. Wraps; a live slot is skipped. */
        this._next = 0;
        this.liveCount = 0;

        // ---- data texture --------------------------------------------------
        // Row 0 = (x, y, z, size), row 1 = (age01, seed, kind, alpha).
        this._texData = new Float32Array(CAPACITY * 2 * 4);
        this.dataTex = new THREE.DataTexture(
            this._texData, CAPACITY, 2, THREE.RGBAFormat, THREE.FloatType
        );
        this.dataTex.minFilter = THREE.NearestFilter;
        this.dataTex.magFilter = THREE.NearestFilter;
        this.dataTex.wrapS = THREE.ClampToEdgeWrapping;
        this.dataTex.wrapT = THREE.ClampToEdgeWrapping;
        this.dataTex.generateMipmaps = false;
        // Row 0 of the array must land on texel row 0, or every grain reads its
        // neighbour's state.
        this.dataTex.flipY = false;
        this.dataTex.unpackAlignment = 4;
        this.dataTex.name = "sprayTex";
        this.dataTex.needsUpdate = true;

        // ---- uniform blocks --------------------------------------------------
        /**
         * `lib/common`'s shared globals (ARCHITECTURE.md §3), owned here for the
         * same reason `render/sky.js`, `terrain/terrain.js` and
         * `character/character.js` own theirs: the spray is then correct whatever
         * order the integrator's `updateGlobals()` runs in. `uSunDir` and
         * `uSunColor` hold live references into `sky`, so they never need
         * copying. `uCameraPos` **and `uViewProj`** are both written by
         * `update()` off the beauty camera it is handed, exactly as
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

        this._uCamRight = { value: new THREE.Vector3(1, 0, 0) };
        this._uCamUp = { value: new THREE.Vector3(0, 1, 0) };

        /** True when the real spell-light chunk was found; false = stub term. */
        this.spellLightsBound = chunkRegistered("lib/spellLights");

        this._uSprayAlbedo = { value: new Float32Array([0.92, 0.94, 0.98]) };
        const uniforms = Object.assign(
            {},
            { uSprayAlbedo: this._uSprayAlbedo },
            this.globals,
            sky.uniforms,
            (terrain && terrain.shadingUniforms) || {},
            shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
            (deps && deps.spellUniforms) || {},
            {
                sprayTex: { value: this.dataTex },
                camRight: this._uCamRight,
                camUp: this._uCamUp,
            }
        );

        // ---- material --------------------------------------------------------
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(SPRAY_VERTEX),
            fragmentShader: shader(sprayFragment({ spellLights: this.spellLightsBound })),
            uniforms,
            // Babylon's backFaceCulling = false / disableDepthWrite /
            // ALPHA_COMBINE. Non-premultiplied: the fragment stage returns a
            // straight colour and a straight alpha.
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
            premultipliedAlpha: false,
        });
        this.material.name = "spray";

        // ---- mesh ------------------------------------------------------------
        this.geometry = buildQuadMesh();
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "spray";
        // Every quad is placed in the vertex shader, so the CPU has no idea where
        // this mesh is; a frustum test against its (identity) bounds would cull
        // it the moment the camera moves.
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.updateMatrix();
        // The reference's renderingGroupId = 2: after the opaque pass, sharing
        // the depth buffer it wrote.
        this.mesh.renderOrder = 2;
        if (scene) scene.add(this.mesh);

        this.triangles = CAPACITY * 2;
        /** For `gfx.warmUp`'s extra-mesh list. */
        this.meshes = [this.mesh];

        this._checkedCamera = false;
        this._t = 0;
    }

    /**
     * Emit one grain. Everything is world space. See the API block at the top of
     * the file — especially the note on `drag`.
     *
     * @param {number} x @param {number} y @param {number} z
     * @param {number} vx @param {number} vy @param {number} vz
     * @param {number} size metres, RADIUS
     * @param {number} life seconds
     * @param {number} kind 0 powder, 1 clod — appearance only
     * @param {number} [drag] 1/s; defaults to 5.2 (powder) / 1.1 (clod)
     * @returns {void}
     */
    /**
     * Realm grain color (owner 2026-08-13): kicked powder is the realm's
     * ground, not always snow. realms.js vfx.sprayAlbedo row.
     * @param {{vfx?: {sprayAlbedo?: number[]}}} block a realms.js realm row
     * @returns {void}
     */
    applyRealm(block) {
        const a = block && block.vfx && block.vfx.sprayAlbedo;
        if (!a) return;
        const u = this._uSprayAlbedo.value;
        u[0] = a[0]; u[1] = a[1]; u[2] = a[2];
    }

    emit(x, y, z, vx, vy, vz, size, life, kind, drag) {
        // Bounded free-slot scan. After CAPACITY tries the pool is full and the
        // emission is simply dropped, which at these counts never happens and is
        // the right failure anyway.
        let i = this._next;
        for (let n = 0; n < CAPACITY; n++) {
            if (this.age[i] >= this.life[i]) break;
            i = (i + 1) % CAPACITY;
            if (n === CAPACITY - 1) return;
        }
        this._next = (i + 1) % CAPACITY;

        const o = i * 3;
        this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
        this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
        this.age[i] = 0;
        this.life[i] = life;
        this.size[i] = size;
        this.kind[i] = kind;
        this.drag[i] = drag === undefined ? (kind > 0.5 ? 1.1 : 5.2) : drag;
        // Deterministic: a function of the slot and of where the grain was born,
        // never Math.random() (ARCHITECTURE.md §6).
        this.seed[i] = (i * 0.618033 + x * 0.137 + z * 0.311) % 1;
    }

    /**
     * Advance every slot and upload.
     *
     * MUST run after `wake.update()` in the frame: the wake decides where its own
     * lip is and emits grains into this pool, and those grains have to be in the
     * pool before it is uploaded. Emitting after the upload costs one frame of
     * latency and desynchronises the plume from the crest during a turn.
     *
     * @param {THREE.Camera} camera the beauty camera — the billboard basis and
     *   the camera position are both taken off its `matrixWorld`
     * @param {number} dt seconds
     * @returns {void}
     */
    update(dt, camera) {
        if (!this._checkedCamera) {
            this._checkedCamera = true;
            if (!camera || camera.isCamera !== true) {
                fail("spray.update() needs the beauty camera, not a position");
                return;
            }
        }
        if (!camera || camera.isCamera !== true) return;

        this._t += dt;

        // Billboard basis and eye position, straight off the camera's world
        // matrix — see the handedness note in the file header.
        _right.setFromMatrixColumn(camera.matrixWorld, 0);
        _up.setFromMatrixColumn(camera.matrixWorld, 1);
        _camPos.setFromMatrixPosition(camera.matrixWorld);
        this._uCamRight.value.copy(_right);
        this._uCamUp.value.copy(_up);
        this.globals.uCameraPos.value.copy(_camPos);
        // The beauty pass's JITTERED view-projection. `post.update()` writes the
        // TAA jitter straight into `camera.projectionMatrix` (postChain.js, "the
        // beauty pass must rasterise through camera.projectionMatrix"), and this
        // runs after it, so the product is the matrix the rest of the frame uses.
        //
        // This has to happen HERE and not in the integrator: the spray owns this
        // globals block, and a block whose `uViewProj` nobody writes stays the
        // identity — which multiplies every billboard's world position straight
        // into clip space, puts all 5120 quads outside the clip volume, and
        // renders exactly nothing while the pool reports thousands of live
        // grains. Writes in place; no allocation.
        this.globals.uViewProj.value.multiplyMatrices(
            camera.projectionMatrix, camera.matrixWorldInverse
        );

        // Clamped so a frame hitch cannot fling every live grain through the
        // ground in one step.
        const h = Math.min(dt, 1 / 30);
        // Transcribed unchanged from the reference; see the header, note 1. The
        // bearing is mirrored into the port's frame (`core/bearing.js`) so the
        // drift agrees with the cloth, the fur and the sastrugi.
        const wa = bearingRad(S.windDirection);
        const wx = Math.sin(wa) * 2.4 * S.windStrength;
        const wz = Math.cos(wa) * 2.4 * S.windStrength;

        const d = this._texData;
        const pos = this.pos;
        const vel = this.vel;
        const terrain = this.terrain;
        let live = 0;

        for (let i = 0; i < CAPACITY; i++) {
            const o = i * 3;
            const to = i * 4;
            const t1 = (CAPACITY + i) * 4;

            if (this.age[i] >= this.life[i]) {
                // A dead slot still has to be written, or the last frame's corpse
                // keeps rendering. Zero size collapses all four corners onto one
                // point and the rasteriser produces no fragments at all —
                // cheaper than any branch on the GPU.
                d[to + 3] = 0;
                d[t1 + 3] = 0;
                continue;
            }

            this.age[i] += h;
            const a01 = this.age[i] / this.life[i];

            // Drag toward the WIND horizontally and toward TERMINAL vertically.
            // The horizontal step is an explicit-Euler-safe lerp, min(1, k*h);
            // the vertical is a plain forward-Euler step. Reproduce both exactly
            // or the drag response changes at high k.
            const k = this.drag[i];
            const vy = vel[o + 1];
            vel[o] += (wx - vel[o]) * Math.min(1, k * h);
            vel[o + 2] += (wz - vel[o + 2]) * Math.min(1, k * h);
            vel[o + 1] = vy + (-9.81 - k * (vy + TERMINAL)) * h;

            pos[o] += vel[o] * h;
            pos[o + 1] += vel[o + 1] * h;
            pos[o + 2] += vel[o + 2] * h;

            // Settle on the snow instead of falling through it. The grain does
            // not bounce — it is snow landing on snow — it just stops and fades.
            const g = terrain.heightAt(pos[o], pos[o + 2]);
            if (pos[o + 1] < g) {
                pos[o + 1] = g;
                vel[o] *= 0.2; vel[o + 1] = 0; vel[o + 2] *= 0.2;
                this.age[i] += h * 2.5;   // kill it faster once it is down
            }

            // Puffs expand as they disperse; clods do not.
            const grow = this.kind[i] > 0.5 ? 1.0 : 1.0 + a01 * 1.3;
            // Fade in fast, out slowly.
            const alpha = Math.min(1, a01 * 8) * (1 - a01) * (1 - a01);

            d[to] = pos[o];
            d[to + 1] = pos[o + 1];
            d[to + 2] = pos[o + 2];
            d[to + 3] = this.size[i] * grow;
            d[t1] = a01;
            d[t1 + 1] = this.seed[i];
            d[t1 + 2] = this.kind[i];
            d[t1 + 3] = alpha;
            live++;
        }

        this.liveCount = live;
        this.dataTex.needsUpdate = true;
    }

    /**
     * Compile and draw the pipeline behind the loading screen.
     *
     * A few grains are seeded first so the warm draw actually rasterises
     * billboards rather than specialising a program that has never had a
     * fragment through it, then killed again so nothing survives into frame one.
     * @returns {void}
     */
    warmUpSeed() {
        for (let k = 0; k < 24; k++) {
            this.emit(
                k * 0.05, 1.0, 0,
                0, 0.01, 0,
                0.08, 1.0,
                k % 4 === 0 ? 1 : 0,
                5.2
            );
        }
    }

    /** Kill every live grain. Used after the warm-up draw, and by `setEnabled`. */
    clear() {
        for (let i = 0; i < CAPACITY; i++) {
            this.age[i] = 0;
            this.life[i] = 0;
            this._texData[i * 4 + 3] = 0;
            this._texData[(CAPACITY + i) * 4 + 3] = 0;
        }
        this._next = 0;
        this.liveCount = 0;
        this.dataTex.needsUpdate = true;
    }

    /** @returns {void} */
    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.dataTex.dispose();
    }
}

// -----------------------------------------------------------------------------

/**
 * A static grid of quads. `position` is `(particleIndex, cornerX, cornerY)` and
 * carries no geometry at all — the vertex shader places every corner.
 *
 * The attribute keeps the name `position` even though it is not one, matching
 * `character/build.js` and `shaders/cloth.glsl.js`, which do the same. Three only
 * derives a draw count from `position` on a NON-indexed geometry, and this one is
 * indexed, so the name costs nothing here.
 * @returns {THREE.BufferGeometry}
 */
function buildQuadMesh() {
    const pos = new Float32Array(CAPACITY * 4 * 3);
    const idx = new Uint32Array(CAPACITY * 6);

    for (let i = 0; i < CAPACITY; i++) {
        for (let c = 0; c < 4; c++) {
            const o = (i * 4 + c) * 3;
            pos[o] = i;
            pos[o + 1] = CORNERS[c * 2];
            pos[o + 2] = CORNERS[c * 2 + 1];
        }
        const b = i * 4;
        const q = i * 6;
        idx[q] = b; idx[q + 1] = b + 1; idx[q + 2] = b + 2;
        idx[q + 3] = b; idx[q + 4] = b + 2; idx[q + 5] = b + 3;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    // OES_element_index_uint is core in WebGL2; 20480 vertices needs it.
    g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    g.userData.triangles = CAPACITY * 2;
    return g;
}

export { CAPACITY as SPRAY_CAPACITY };
