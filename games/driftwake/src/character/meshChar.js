/**
 * The GLB mesh character — the rigged, animated rider that replaces the
 * procedural figure's VISUAL while every game system keeps running against the
 * figure it always ran against.
 *
 * What this owns: loading `assets/char/driftwake_char_web.glb` (Draco, WebP
 * textures), the custom skinned RawShaderMaterial that relights it with the
 * port's own stack (there are no Three lights in this scene — a stock
 * MeshStandardMaterial renders black), the AnimationMixer and its clip state
 * machine, the procedural surf-pose layer, and the shadow/prepass caster
 * registration (ARCHITECTURE.md §5 — this project never uses Three's built-in
 * shadow path).
 *
 * What this deliberately does NOT own: simulation. `SNOWFLOW.character` is
 * still the controller and `SNOWFLOW.figure` keeps simulating while hidden
 * (spells read its hands). But since 2026-08-04 the ACTIVE body owns the
 * GAIT: while `S.meshCharacter` is on, this file emits the footfall contract
 * from its clips' measured plant phases (`_emitFootfalls`) and snowContact
 * stamps from `controller.footPos` via its no-figure branch — the
 * controller's distance clock and the figure's plants stand down (wired in
 * `main.js` applyBodyVisibility; the settings toggle restores the legacy
 * path wholesale).
 *
 * ---------------------------------------------------------------------------
 * THE STATE MACHINE — polled, not subscribed
 *
 * Exactly like `audio/audio.js`: every trigger is an edge found by comparing
 * this frame's controller state to held scalars, so `SNOWFLOW.character`
 * writes from the harness drive the animation for free and no file this owner
 * does not own grows a callback.
 *
 *   grounded, speed < 0.3   idle
 *   grounded, speed < 4.2   walk        timeScale ~ speed / 1.9
 *   grounded, speed >= 4.2  run         timeScale ~ speed / 5.4
 *   airborne, vertVel > 0   jump        (LoopOnce, clamped)
 *   airborne, vertVel <= 0  fall
 *   landed edge             ROLL, always (owner rule 2026-08-05) — unless
 *                           the carve is held through touchdown (surf > 0.5),
 *                           which resumes the surf instead
 *   grounded, !stepping     SURF stance as a braced slide (post-surf run-out)
 *   surf > 0.5              SURF: idle base + the procedural pose layer below
 *
 * Crossfades are manual weight ramps (0.12-0.25 s): every action is `.play()`ed
 * once at load and stays scheduled at weight >= 0, which keeps the per-frame
 * path allocation-free — `AnimationAction.fadeIn/fadeOut` build an interpolant
 * per call, and a weight-0 action costs the mixer one early-out test.
 *
 * ---------------------------------------------------------------------------
 * THE SURF POSE LAYER (owner decision 2026-08-04)
 *
 * Mixamo has no surf/snowboard clip, so the carve stance is POSED, not played:
 * after the mixer writes the base clip, the mixamorig bones are composed with
 * a crouch (hips drop + knee bend, deepening with speed and tucking in the
 * ollie), a continuous lean into the carve driven live from `character.lean`,
 * a stance twist with balancing arms (rear arm higher), and a head
 * counter-rotation that keeps the look travel-forward. Everything scales with
 * the eased `character.surf`, so entering and leaving the carve is smooth
 * against the locomotion clips. During the ollie (airborne with surf held) the
 * layer HOLDS, slightly tucked — the jump/fall clips are for off-board air.
 * All writes are in-place quaternion composes through two module scratches.
 *
 * The tunables live on `this.pose` so they can be trimmed live from the
 * console (`SNOWFLOW.meshChar.pose.leanSpine = ...`) — they are baked numbers,
 * not settings.
 *
 * ---------------------------------------------------------------------------
 * SKINNING PLUMBING — why the shader needs only two uniforms
 *
 * See `shaders/lib/meshSkin.glsl.js`. The SkinnedMesh stays in `attached`
 * bind mode, so bone world matrices (which live under `this.root` and carry
 * its whole transform) times `bindMatrix` map geometry straight to world —
 * no model matrix, no bindMatrixInverse. That is what makes the cascade and
 * prepass PROXIES (plain `THREE.Mesh`es built by `registerCaster`) correct
 * with the same source: everything arrives through shared uniform boxes, and
 * the renderer's auto-binding on the real SkinnedMesh writes the same values.
 *
 * `skeleton.update()` is called HERE, every frame, after the root has moved:
 * the renderer only refreshes skeletons while traversing scenes that contain
 * the SkinnedMesh itself, and the frame's first consumers are the shadow
 * cascades, whose proxy scenes do not.
 *
 * Allocation per frame: none. The mixer's propertyBindings, the weight arrays
 * and both scratches exist after `load()` resolves.
 */

import * as THREE from "three";
import { GLTFLoader } from "../../assets/vendor/three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "../../assets/vendor/three/examples/jsm/loaders/DRACOLoader.js";

import { resolve, shader } from "../core/glsl.js";
import {
    MESH_CHAR_VERTEX, MESH_CHAR_DEPTH_VERTEX, MESH_CHAR_PREPASS_VERTEX,
    meshCharFragment,
} from "../shaders/meshChar.glsl.js";

/** Asset + decoder locations, resolved against the document (index.html). */
// CHAR_GLB_V MUST be bumped on every GLB rebuild: the CDN serves this asset
// with max-age=86400, so an in-place swap leaves players on yesterday's file
// for up to a day (the 2026-08-04 folded-arm fix was invisible through the
// browser cache). The query string changes the cache key — bump = fresh fetch.
const CHAR_GLB_V = "hero2a";
const GLB_URL = "./assets/char/driftwake_char_web.glb?v=" + CHAR_GLB_V;
const DRACO_PATH = "./assets/vendor/three/examples/jsm/libs/draco/gltf/";

/**
 * hero_v2 native height 1.901 m (probed). The silhouette target carried over
 * from the original calibration is ~1.84 m on screen (old rig 2.0 m x 0.92,
 * measured against the procedural figure in the 13-char-closeup framing), so
 * 1.84 / 1.901 = 0.97. The foot offset and the pelvis-drop unit are
 * calibrated AFTER this scale is applied, so they track any change here
 * automatically.
 */
const SCALE = 0.97;

/** Same receiver params as the procedural figure (_spec/shadows.md §6.5). */
const SHADOW_SOFTNESS = 1.4;
const SHADOW_BIAS = 0.012;
/** Cascades 0-1 only, for the same texel-density argument as the figure. */
const CHAR_CASCADES = 2;

/** The clips the state machine drives. The GLB also ships `stoprun` and
 *  `turnleft`, currently unused, plus a stray Mixamo export stub skipped by
 *  this exact-name lookup. */
// "skate" (Mixamo Skateboarding, In Place) is the surf BASE — a side-on board
// stance with authored weight shift; the procedural carve layer poses on top of
// it. "lookaround"/"weightshift" are the idle variations (owner ask
// 2026-08-04): occasional one-shots blended over the base idle. All three are
// OPTIONAL: an older GLB without them still loads — surf falls back to the
// idle base and the variation scheduler simply never arms — so the asset and
// the code can ship independently.
const CLIP_NAMES = ["idle", "walk", "run", "jump", "fall", "land", "roll",
                    "skate", "lookaround", "weightshift", "cast"];
const OPTIONAL_CLIPS = new Set(["skate", "lookaround", "weightshift", "cast"]);

/** State ids — indices into the weight-target table. */
const ST_IDLE = 0, ST_WALK = 1, ST_RUN = 2, ST_JUMP = 3, ST_FALL = 4,
      ST_LAND = 5, ST_ROLL = 6, ST_SURF = 7, ST_CAST = 8;
/** Clip-only indices (not states): the idle variations, the cast one-shot. */
const CL_LOOK = 8, CL_SHIFT = 9, CL_CAST = 10;

/**
 * Foot-plant phases of the locomotion clips, measured off the shipped GLB by
 * `_harness/footphase.html` (toe-base height-dwell centres, 2026-08-05,
 * hero_v2 / Magic Locomotion clips): walk 1.167 s — left 0.519 / right
 * 0.985; run 0.767 s — left 0.517 / right 0.035. These, scaled by the
 * action's live timeScale, are the ONLY footstep clock while the mesh is the
 * active body: the sound fires when the visible foot plants, by
 * construction. Re-measure if the clips change.
 */
const PLANT_PHASES = {
    [ST_WALK]: [0.519, 0.985],   // [left, right]
    [ST_RUN]: [0.517, 0.035],
};

/** Seconds the spell-1 cast one-shot owns the body before locomotion
 *  resumes; movement, jumping or the board cancel it early. */
const CAST_HOLD = 1.15;

/** Seconds the landing absorb holds before locomotion resumes. */
const LAND_HOLD = 0.35;

/** Default crossfade, and the two exceptions. */
const FADE = 0.18;
const FADE_IMPACT = 0.12;   // into land/roll — a landing is sudden
const FADE_SURF = 0.25;     // out of the carve — matches the surf ease

/** Bones the surf pose layer touches, by mixamorig suffix. */
const POSE_BONES = [
    "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
    "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg",
    "LeftArm", "LeftForeArm", "RightArm", "RightForeArm",
];

// ------------------------------------------------------- module-scope scratch
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** Compose an extra local rotation onto a bone the mixer already posed. */
function addRot(bone, x, y, z) {
    _q.setFromEuler(_e.set(x, y, z));
    bone.quaternion.multiply(_q);
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Is a shared chunk registered? Same guard `character.js` uses, same reason.
 * @param {string} name
 * @returns {boolean}
 */
function hasChunk(name) {
    try {
        resolve('#include "' + name + '"');
        return true;
    } catch (e) {
        return false;
    }
}

export class MeshCharacter {
    /**
     * Construction is cheap; `load()` does the work.
     * @param {THREE.Scene} scene
     * @param {import("../terrain/terrain.js").Terrain} terrain
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {import("./controller.js").CharacterController} controller
     */
    constructor(scene, terrain, sky, shadows, controller) {
        this.scene = scene;
        this.terrain = terrain;
        this.sky = sky;
        this.shadows = shadows;
        this.controller = controller;

        /** @type {THREE.Group} moved every frame from the controller. */
        this.root = new THREE.Group();
        // Rotation order YXZ so z (carve roll, about the model's +Z front) and
        // x (attack pitch, about the model's lateral axis) compose in MODEL
        // space and y then yaws the finished lean — with the default XYZ the
        // pitch would land about the WORLD x axis and skew with heading.
        this.root.rotation.order = "YXZ";

        /** @type {THREE.SkinnedMesh|null} set by load(). */
        this.mesh = null;
        /** @type {THREE.RawShaderMaterial|null} the beauty material. */
        this.material = null;
        /** @type {THREE.AnimationMixer|null} */
        this.mixer = null;

        /** Live surf-pose tunables — see the file header. Radians and metres. */
        this.pose = {
            crouchBase: 0.34,   // knee/hip flex at a standstill carve
            crouchSpeed: 0.20,  // extra flex at full speed
            crouchTuck: 0.26,   // extra flex mid-ollie
            hipsDropM: 0.19,    // metres the pelvis sinks at full crouch
            stanceYaw: 0.34,    // body twist onto the board
            leanHips: 0.26,     // carve roll distribution, hips -> head
            leanSpine: 0.42,
            leanHead: 0.30,     // head counter-roll, keeps the horizon level
            carveTwist: 0.26,   // shoulders counter-rotate against the turn
            armOut: 0.80,       // balance arms abduction
            armCounter: 0.22,   // arm swing against the carve
            armRearLift: 0.30,  // the trailing arm rides higher
            armForeBend: 0.35,  // elbows soften
            attackPitch: 0.10,  // whole-root nose-down into the slope
        };

        // ---- state machine ---------------------------------------------------
        this._state = ST_IDLE;
        /** True while the current airborne arc began from a carve — decides the
         *  landing per the owner's rules (2026-08-04): plain jumps never roll;
         *  a surf jump lands hard, and rolls only if the board was released. */
        this._tookOffSurfing = false;
        this._wasAirborne = false;
        /** Eased grounded factor gating the procedural surf pose: in the air
         *  the JUMP/FALL clips own the body, so the pose layer fades out. */
        this._groundPose = 1;
        this._stateT = 0;
        this._rollHold = 1.0;      // refined from the clip duration at load
        /** @type {THREE.AnimationAction[]} indexed like CLIP_NAMES. */
        this._acts = [];
        this._weights = new Float32Array(CLIP_NAMES.length);
        this._targets = new Float32Array(CLIP_NAMES.length);
        this._fade = FADE;

        /** Per-state weight targets, [state][clip index]. SURF idles under the
         *  pose layer. Columns 8-9 (idle variations) stay 0 in every row: the
         *  variation blend is a sublayer of the idle slot, applied after the
         *  ramp. Built once; rows are reused, never reallocated. */
        this._stateWeights = [
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // idle
            [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], // walk
            [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0], // run
            [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], // jump
            [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0], // fall
            [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], // land
            [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0], // roll
            [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], // surf (skate base; demoted to
                                               // idle at load if absent)
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], // cast (spell-1 one-shot;
                                               // demoted to idle if absent)
        ];

        // ---- clip-locked footfalls ------------------------------------------
        /** Previous locomotion clip phase, for plant-crossing detection. */
        this._gaitPrevPhase = 0;
        this._gaitPrevState = -1;
        /** Diagnostic: footfalls emitted since load (F3 / harness). */
        this.footfallCount = 0;

        // ---- idle variation scheduler ---------------------------------------
        /** Active variation clip index, or -1. */
        this._idleVar = -1;
        /** Variation blend 0..1 over the base idle. */
        this._idleVarW = 0;
        /** Seconds of idle remaining until the next variation arms. */
        this._idleVarT = 7;
        /** Deterministic sequence counter (no Math.random: the render
         *  harnesses depend on repeatable frames). */
        this._idleVarSeq = 0;

        /** @type {Record<string, THREE.Bone>} pose-layer bones, cached at load. */
        this._bones = {};
        /** Metres -> hips-local units, measured at load (Mixamo rigs are cm). */
        this._hipsUnit = 1;
        /** World-Y offset that puts the boots on `character.position.y`. */
        this._footY = 0;

        this._uBoneTex = { value: null };
        this._uBindMatrix = { value: null };

        /**
         * `lib/common`'s shared globals, owned here exactly as `character.js`
         * owns its own copy: correct whatever order the integrator syncs in.
         * `uSunDir` / `uSunColor` hold live references into `sky`.
         */
        this.globals = {
            uSunDir: { value: sky.sunDir },
            uSunColor: { value: sky.sunRadiance },
            uCameraPos: { value: new THREE.Vector3() },
            uViewProj: { value: new THREE.Matrix4() },
        };

        /** @type {THREE.RawShaderMaterial[]} cascade materials, for dispose. */
        this._depthMats = [];
        /** @type {THREE.RawShaderMaterial|null} */
        this._prepassMat = null;
        /** @type {THREE.Texture[]} the GLB's maps, for dispose. */
        this._maps = [];

        this._visible = true;
    }

    /**
     * Fetch and assemble the rider. Await this before the pipeline warm-up so
     * its programs compile behind the boot screen with everything else.
     * @returns {Promise<void>}
     */
    async load() {
        const draco = new DRACOLoader();
        draco.setDecoderPath(DRACO_PATH);
        const loader = new GLTFLoader();
        loader.setDRACOLoader(draco);

        const gltf = await loader.loadAsync(GLB_URL);
        draco.dispose(); // the decoder worker is done; keep zero of it resident

        /** @type {THREE.SkinnedMesh|null} */
        let mesh = null;
        gltf.scene.traverse((o) => {
            if (!mesh && /** @type {any} */ (o).isSkinnedMesh) {
                mesh = /** @type {THREE.SkinnedMesh} */ (o);
            }
        });
        if (!mesh) throw new Error("mesh character: no SkinnedMesh in " + GLB_URL);
        this.mesh = mesh;

        // ---- textures off the stock material, which is then discarded -------
        const std = /** @type {THREE.MeshStandardMaterial} */ (mesh.material);
        const map = std.map;
        const normalMap = std.normalMap;
        const mrMap = std.metalnessMap || std.roughnessMap;
        if (!map || !normalMap || !mrMap) {
            throw new Error("mesh character: GLB is missing one of its three maps");
        }
        this._maps.push(map, normalMap, mrMap);
        std.dispose(); // textures survive material disposal

        // ---- skinning plumbing ----------------------------------------------
        const skeleton = mesh.skeleton;
        if (skeleton.boneTexture === null) skeleton.computeBoneTexture();
        this._uBoneTex.value = skeleton.boneTexture;
        this._uBindMatrix.value = mesh.bindMatrix;

        // ---- the beauty material --------------------------------------------
        const spellLights = hasChunk("lib/spellLights");
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(MESH_CHAR_VERTEX),
            fragmentShader: shader(meshCharFragment({ spellLights })),
            uniforms: Object.assign(
                {},
                this.globals,
                this.sky.uniforms,
                this.terrain.shadingUniforms,   // declares sssStrength
                this.shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
                {
                    boneTexture: this._uBoneTex,
                    bindMatrix: this._uBindMatrix,
                    baseColorMap: { value: map },
                    normalMap: { value: normalMap },
                    metalRoughMap: { value: mrMap },
                }
            ),
            // Hood interior and sleeve openings show their backs; the fragment
            // turns N toward the viewer, matching the fabric material.
            side: THREE.DoubleSide,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });
        this.material.name = "meshChar";
        mesh.material = this.material;

        mesh.name = "meshChar";
        mesh.frustumCulled = false;  // bounds are bind-pose; the rig roams
        mesh.raycast = () => {};
        mesh.renderOrder = 1;        // above the terrain, like the figure

        this.root.scale.setScalar(SCALE);
        this.root.add(gltf.scene);
        this.scene.add(this.root);

        // ---- animation -------------------------------------------------------
        this.mixer = new THREE.AnimationMixer(gltf.scene);
        for (let i = 0; i < CLIP_NAMES.length; i++) {
            const clip = THREE.AnimationClip.findByName(gltf.animations, CLIP_NAMES[i]);
            if (!clip) {
                if (CLIP_NAMES[i] === "skate") {
                    // Optional clip absent: surf rides the idle base instead.
                    // (Weight aliasing is safe only because row 7's own column
                    // stays untouched — the ramp's null-guard skips holes, and
                    // the idle column drives the shared action.)
                    this._stateWeights[7] = this._stateWeights[0];
                    this._acts.push(this._acts[0]);
                    continue;
                }
                if (OPTIONAL_CLIPS.has(CLIP_NAMES[i])) {
                    // Optional clip absent: hole in the table — the idle
                    // variation scheduler never arms (null check), and a
                    // missing cast demotes its state to the idle base.
                    if (CLIP_NAMES[i] === "cast") {
                        this._stateWeights[ST_CAST] = this._stateWeights[ST_IDLE];
                    }
                    this._acts.push(null);
                    continue;
                }
                throw new Error("mesh character: clip missing: " + CLIP_NAMES[i]);
            }
            const a = this.mixer.clipAction(clip);
            if (CLIP_NAMES[i] === "jump" || CLIP_NAMES[i] === "land" ||
                CLIP_NAMES[i] === "roll") {
                a.setLoop(THREE.LoopOnce, 1);
                a.clampWhenFinished = true;
            }
            if (CLIP_NAMES[i] === "lookaround" || CLIP_NAMES[i] === "weightshift") {
                // One-shots that hand the body back to the base idle.
                a.setLoop(THREE.LoopOnce, 1);
                a.clampWhenFinished = false;
            }
            if (CLIP_NAMES[i] === "cast") {
                // The 2.7 s Magic Attack sped to fit the CAST_HOLD window:
                // wind-up and release read, the slow recover is cut.
                a.setLoop(THREE.LoopOnce, 1);
                a.clampWhenFinished = true;
                a.setEffectiveTimeScale(1.35);
            }
            a.play(); // scheduled for ever; weights do the talking
            a.setEffectiveWeight(0);
            this._acts.push(a);
        }
        this._weights[ST_IDLE] = 1;
        this._targets[ST_IDLE] = 1;
        this._acts[ST_IDLE].setEffectiveWeight(1);
        // The land clip is 2 s of absorb-and-recover; only the absorb fits the
        // 0.35 s window, so it runs fast. The roll holds nearly its whole clip.
        this._acts[ST_LAND].setEffectiveTimeScale(1.6);
        const rollClip = this._acts[ST_ROLL].getClip();
        this._acts[ST_ROLL].setEffectiveTimeScale(1.25);
        this._rollHold = rollClip.duration / 1.25 - FADE;

        // ---- pose-layer bones ------------------------------------------------
        const prefix = skeleton.bones[0].name.startsWith("mixamorig") ?
            skeleton.bones[0].name.slice(0, skeleton.bones[0].name.length - "Hips".length) : "";
        for (let i = 0; i < POSE_BONES.length; i++) {
            const n = POSE_BONES[i];
            const bone = skeleton.getBoneByName(prefix + n) ||
                skeleton.bones.find((b) => b.name.endsWith(n));
            if (!bone) throw new Error("mesh character: bone missing: " + n);
            this._bones[n] = bone;
        }
        // Foot bones for the clip-locked footfall positions (world-space read
        // on plant frames only). Fail soft: without them the emission falls
        // back to the body-centre side offset, same as the legacy path.
        this._feet = [
            skeleton.getBoneByName(prefix + "LeftFoot") ||
                skeleton.bones.find((b) => b.name.endsWith("LeftFoot")) || null,
            skeleton.getBoneByName(prefix + "RightFoot") ||
                skeleton.bones.find((b) => b.name.endsWith("RightFoot")) || null,
        ];
        // Hand bones: the spell system reads the ACTIVE body's palms through
        // handPosition() below — ribbon swirl and idle water FX track them.
        this._hands = [
            skeleton.getBoneByName(prefix + "LeftHand") ||
                skeleton.bones.find((b) => b.name.endsWith("LeftHand")) || null,
            skeleton.getBoneByName(prefix + "RightHand") ||
                skeleton.bones.find((b) => b.name.endsWith("RightHand")) || null,
        ];

        // ---- calibration: settle into idle frame 0, then measure -------------
        this.mixer.update(0);
        this.root.updateMatrixWorld(true);
        skeleton.update();

        // Metres per hips-local unit, so the crouch's pelvis drop is authored
        // in metres whatever unit the rig was exported in.
        _v.setFromMatrixScale(this._bones.Hips.parent.matrixWorld);
        this._hipsUnit = 1 / Math.max(1e-6, _v.y);

        // Boot-sole offset: the lowest skinned vertex in the idle pose, with
        // the root at the origin — `character.position` is the FEET, so the
        // root rides up by exactly this much.
        const posAttr = mesh.geometry.attributes.position;
        let minY = Infinity;
        for (let i = 0; i < posAttr.count; i++) {
            mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld);
            if (_v.y < minY) minY = _v.y;
        }
        this._footY = -minY;
    }

    /**
     * Register the prepass caster. Call after `load()` resolves.
     * @param {import("../render/depthPass.js").DepthPass} depth
     * @returns {void}
     */
    registerPrepass(depth) {
        const mat = depth.makeCasterMaterial(MESH_CHAR_PREPASS_VERTEX, {
            boneTexture: this._uBoneTex,
            bindMatrix: this._uBindMatrix,
        });
        mat.name = "meshCharPrepass";
        this._prepassMat = mat;
        depth.registerCaster(this.mesh, mat);
    }

    /**
     * Register the shadow casters. Call after `load()` resolves.
     * @returns {void}
     */
    registerShadows() {
        this.shadows.registerCaster(
            this.mesh,
            (c) => {
                const mat = this.shadows.makeCasterMaterial(MESH_CHAR_DEPTH_VERTEX, {
                    boneTexture: this._uBoneTex,
                    bindMatrix: this._uBindMatrix,
                }, {
                    // A distinct compiled program per cascade, as the figure's.
                    defines: { MESH_CHAR_CASCADE: c },
                });
                mat.name = "meshCharDepth" + c;
                this._depthMats.push(mat);
                return mat;
            },
            CHAR_CASCADES
        );
    }

    /** @param {boolean} v @returns {void} */
    setVisible(v) {
        this._visible = !!v;
        // The flag lives on the MESH, not the root: the cascade and prepass
        // proxies mirror `mesh.visible` each frame, so one write hides all
        // three passes at once (see shadows.render / depthPass.render).
        if (this.mesh) this.mesh.visible = this._visible;
    }

    /**
     * Advance the mixer, run the state machine, apply the surf pose layer,
     * move the root and republish the bone texture. Call between
     * `figure.update` and the shadow render; the figure it visually replaces
     * keeps simulating regardless.
     * @param {number} dt seconds
     * @returns {void}
     */
    update(dt) {
        if (!this.mesh) return;
        const ch = this.controller;

        this._step(dt, ch);
        this.mixer.update(dt);

        // The pose layer rides only the GROUNDED part of a carve; airborne the
        // jump/fall clips own the body and the layer eases out in ~80 ms.
        this._groundPose += ((ch.airborne ? 0 : 1) - this._groundPose) *
            Math.min(1, dt * 12);
        const s = ch.surf * this._groundPose;
        if (s > 0.001) this._applySurfPose(s, ch);

        // ---- root: position, facing, lean -----------------------------------
        // `character.position` is the feet; `_footY` puts the boot soles there.
        this.root.position.set(
            ch.position.x, ch.position.y + this._footY, ch.position.z
        );
        // Model front is +Z; port forward at facing f is (sin f, 0, -cos f).
        // R_y(PI - f) maps +Z onto exactly that vector.
        this.root.rotation.y = Math.PI - ch.facing;
        // Whole-body roll into the carve: subtle at a walk, committed on the
        // board. rotation.z is about the model's own front axis (order YXZ).
        this.root.rotation.z = ch.lean * (0.10 + 0.35 * s);
        this.root.rotation.x = this.pose.attackPitch * s;

        this.root.updateMatrixWorld(true);
        // The shadow cascades are this frame's first consumers and their proxy
        // scenes contain no SkinnedMesh, so the renderer will not do this.
        this.mesh.skeleton.update();

        // After the matrix update: plant frames read foot bones in world space.
        this._emitFootfalls(ch);

        // The idle water-play FX gate (spellSystem reads it): full while the
        // hand-wave idle owns the body, zero everywhere else.
        ch.idleFx = (this._state === ST_IDLE && !ch.airborne)
            ? this._weights[ST_IDLE] : 0;
    }

    /**
     * Clip-locked footstep events. While this mesh is the active body
     * (`controller.clipGait`), the walk/run clips' measured plant phases are
     * the ONLY footstep clock: the controller's own distance-driven gait is
     * silenced and this writes the same `footfall / footIndex / footImpact /
     * footPos` contract, so audio (audio.js footsteps) and footprints
     * (snowContact's no-figure branch) consume real foot timing and real bone
     * positions with zero changes of their own. The impact formula is kept
     * IDENTICAL to the controller's (0.35 + speed/RUN_SPEED): the step-vs-wind
     * loudness calibration in audio.js was measured against it.
     * @param {import("./controller.js").CharacterController} ch
     */
    _emitFootfalls(ch) {
        if (!ch.clipGait) return;
        const st = this._state;
        const plants = PLANT_PHASES[st];
        // Not in stepped locomotion (idle/surf/air/glide/land/roll): no clock.
        // The dominance gate keeps half-faded walk from double-firing against
        // an incoming one-shot; the stepping gate mirrors the legacy path.
        if (!plants || !ch.stepping || this._weights[st] < 0.5) {
            this._gaitPrevState = -1;
            return;
        }
        const act = this._acts[st];
        const dur = act.getClip().duration;
        const phase = (act.time % dur) / dur;
        if (this._gaitPrevState !== st) {
            // Fresh entry: prime the edge detector, never fire on the seam.
            this._gaitPrevState = st;
            this._gaitPrevPhase = phase;
            return;
        }
        const prev = this._gaitPrevPhase;
        this._gaitPrevPhase = phase;
        if (phase === prev) return;

        for (let f = 0; f < 2; f++) {
            const p = plants[f];
            const crossed = prev < phase
                ? (p > prev && p <= phase)
                : (p > prev || p <= phase);   // wrapped past the loop seam
            if (!crossed) continue;
            ch.footfall = true;
            ch.footIndex = f;                 // 0 = left, matches the legacy side
            ch.footImpact = clamp(0.35 + ch.speed / 5.4, 0, 1.3);
            this.footfallCount++;
            const bone = this._feet[f];
            if (bone) {
                bone.getWorldPosition(ch.footPos);
            } else {
                // Legacy body-centre fallback, same numbers as the controller.
                const side = f === 0 ? -0.17 : 0.17;
                ch.footPos.set(
                    ch.position.x + Math.cos(ch.facing) * side,
                    ch.position.y,
                    ch.position.z + Math.sin(ch.facing) * side
                );
            }
        }
    }

    /**
     * Camera-dependent uniforms. After the cascade refit, exactly like
     * `figure.sync` and for the same one-frame-stale reason.
     * @param {THREE.Camera} camera
     * @returns {void}
     */
    sync(camera) {
        if (!this.mesh) return;
        const g = this.globals;
        g.uCameraPos.value.copy(camera.position);
        g.uViewProj.value.multiplyMatrices(
            camera.projectionMatrix, camera.matrixWorldInverse
        );
    }

    /**
     * Palm world position — `figure.handPosition`-compatible (0 = left,
     * 1 = right), so `main.js` can hand the spell system whichever body is
     * active. Bone matrices are fresh: update() runs before the spells.
     * @param {number} which
     * @param {Float32Array} out
     * @param {number} off
     * @returns {void}
     */
    handPosition(which, out, off) {
        const b = this._hands ? this._hands[which === 0 ? 0 : 1] : null;
        if (!b) {
            out[off] = this.root.position.x;
            out[off + 1] = this.root.position.y + 1.25;
            out[off + 2] = this.root.position.z;
            return;
        }
        b.getWorldPosition(_v);
        out[off] = _v.x;
        out[off + 1] = _v.y;
        out[off + 2] = _v.z;
    }

    // ------------------------------------------------------- state machine

    /**
     * One frame of clip selection + weight ramps. Pure polling — see header.
     * @param {number} dt
     * @param {import("./controller.js").CharacterController} ch
     */
    _step(dt, ch) {
        this._stateT += dt;

        let next;
        // One-shots hold their window — unless the ground disappears under
        // them (an immediate re-jump) or the board comes back (carve resumes).
        if (this._state === ST_LAND &&
            this._stateT < (ch.surf > 0.5 ? Math.min(LAND_HOLD, 0.22) : LAND_HOLD) &&
            !ch.airborne) {
            next = ST_LAND;
        } else if (this._state === ST_ROLL && this._stateT < this._rollHold &&
            !ch.airborne) {
            next = ST_ROLL;
        } else if (this._state === ST_CAST && this._stateT < CAST_HOLD &&
            !ch.airborne && ch.speed < 0.6 && ch.surf <= 0.5) {
            // The spell-1 cast owns the body for its window; moving, jumping
            // or the board hands it straight back to locomotion.
            next = ST_CAST;
        } else if (ch.castWave && !ch.airborne && ch.surf <= 0.5 &&
            this._acts[CL_CAST]) {
            ch.castWave = false;   // consumed (set after our update last frame)
            next = ST_CAST;
        } else if (ch.surf > 0.5 && !ch.airborne) {
            // Surfing owns the body ON THE GROUND. In the air the jump/fall
            // clips play even mid-carve — owner decision 2026-08-04, reversing
            // the earlier held-tuck ollie.
            next = ST_SURF;
        } else if (ch.airborne) {
            if (!this._wasAirborne) this._tookOffSurfing = ch.surf > 0.3;
            next = ch.vertVel > 0 ? ST_JUMP : ST_FALL;
        } else if (!ch.stepping) {
            // Grounded, board released, but still above sprint speed: the surf
            // run-out. The controller's gait calls this a glide (its comment:
            // "a sprint is the fastest anyone walks; above it, glide") and
            // emits no footfalls — so the body must not pump the run clip
            // either, or the feet pound silently. The braced board stance,
            // sans lean (the pose layer's amplitude rides `surf`, already
            // near zero here), reads as sliding on the boots.
            next = ST_SURF;
        } else if (ch.speed < 0.3) {
            next = ST_IDLE;
        } else if (ch.speed < 4.2) {
            next = ST_WALK;
        } else {
            next = ST_RUN;
        }

        // Landing edge outranks the locomotion pick — once, on the frame.
        // Owner rule 2026-08-05: EVERY landing goes into the roll. The one
        // exception stands from the earlier ollie rule: a carve held through
        // touchdown (board still engaged, surf > 0.5) resumes the surf — a
        // roll there would break the carve the player is deliberately
        // holding. The LAND clip is now unused but stays in the GLB.
        if (ch.landed) {
            next = ch.surf > 0.5 ? ST_SURF : ST_ROLL;
            this._tookOffSurfing = false;
        }
        this._wasAirborne = ch.airborne;

        if (next !== this._state) {
            this._state = next;
            this._stateT = 0;
            this._fade =
                next === ST_LAND || next === ST_ROLL ? FADE_IMPACT :
                next === ST_SURF ? FADE_SURF : FADE;
            // One-shots restart from their first frame on entry.
            if (next === ST_JUMP) this._acts[ST_JUMP].reset();
            else if (next === ST_LAND) this._acts[ST_LAND].reset();
            else if (next === ST_CAST && this._acts[CL_CAST]) {
                this._acts[CL_CAST].reset();
            }
            else if (next === ST_ROLL) {
                this._acts[ST_ROLL].reset();
                // One-frame flag for the audio layer: the roll is a second
                // body contact after the landing thud, and it was silent.
                ch.rolled = true;
            }
            const w = this._stateWeights[next];
            for (let i = 0; i < this._targets.length; i++) this._targets[i] = w[i];
        }

        // Locomotion cadence follows ground speed, so the feet track the snow.
        // Reference speeds (timeScale 1) re-derived for hero_v2's Magic
        // Locomotion clips: no-slide speed = step_len × SCALE × 2 / duration —
        // walk 1.09 m × 0.97 × 2 / 1.167 s ≈ 1.81 m/s → divisor 1.8; run
        // 1.23 m × 0.97 × 2 / 0.767 s ≈ 3.11 m/s. The run divisor sits at
        // 4.2 (not 3.11): fully honest cadence needs timeScale 1.74 at
        // sprint, past where the clip stays readable — 4.2 trades a little
        // foot slide at top speed for a stride that still looks human.
        // Footstep audio locks to the CLIP either way (PLANT_PHASES), so
        // heard and seen steps stay identical by construction.
        this._acts[ST_WALK].setEffectiveTimeScale(clamp(ch.speed / 1.8, 0.4, 2.2));
        this._acts[ST_RUN].setEffectiveTimeScale(clamp(ch.speed / 4.2, 0.5, 1.6));

        // Manual crossfade: linear ramps toward the target row.
        const step = dt / Math.max(1e-3, this._fade);
        for (let i = 0; i < this._acts.length; i++) {
            if (!this._acts[i]) continue;   // optional clip absent from GLB
            const w = this._weights[i];
            const t = this._targets[i];
            const nw = w < t ? Math.min(t, w + step) : Math.max(t, w - step);
            if (nw !== w) {
                this._weights[i] = nw;
                this._acts[i].setEffectiveWeight(nw);
            }
        }

        this._idleVariations(dt);
    }

    /**
     * Occasional head-turn / weight-shift over the base idle (owner ask
     * 2026-08-04). A sublayer of the idle SLOT: the variation and the base
     * split the idle clip's ramped weight, so every state transition already
     * fades the pair correctly. Deterministic cadence — the render harnesses
     * need repeatable frames, so no Math.random.
     * @param {number} dt
     */
    _idleVariations(dt) {
        const iw = this._weights[ST_IDLE];
        if (this._idleVar < 0) {
            if (this._state !== ST_IDLE || iw < 0.95) return;
            this._idleVarT -= dt;
            if (this._idleVarT > 0) return;
            // Arm: alternate look/shift; skip if the GLB lacks the clip.
            const pick = (this._idleVarSeq % 2 === 0) ? CL_LOOK : CL_SHIFT;
            const act = this._acts[pick] === this._acts[ST_IDLE] ? null : this._acts[pick];
            this._idleVarSeq++;
            // 9 / 12.5 / 16 s between variations, cycling.
            this._idleVarT = 9 + 3.5 * (this._idleVarSeq % 3);
            if (!act) return;
            this._idleVar = pick;
            this._idleVarW = 0;
            act.reset().play();
            return;
        }

        const act = this._acts[this._idleVar];
        const dur = act.getClip().duration;
        // Leave the sublayer when the one-shot ends or anything but a
        // full-weight idle takes over; 0.35 s ramps both ways.
        const wantOut = this._state !== ST_IDLE || act.time >= dur - 0.45;
        const target = wantOut ? 0 : 1;
        const r = dt / 0.35;
        this._idleVarW += clamp(target - this._idleVarW, -r, r);
        if (wantOut && this._idleVarW <= 0.001) {
            act.stop();
            this._idleVar = -1;
            this._idleVarW = 0;
            this._acts[ST_IDLE].setEffectiveWeight(this._weights[ST_IDLE]);
            return;
        }
        const v = this._idleVarW;
        this._acts[ST_IDLE].setEffectiveWeight(iw * (1 - v));
        act.setEffectiveWeight(iw * v);
    }

    // ------------------------------------------------------ surf pose layer

    /**
     * Compose the carve stance over whatever the mixer just wrote. Runs while
     * `surf > 0.001`; every term scales with `s` so the ease in `controller.js`
     * is the whole transition.
     * @param {number} s the eased surf blend, 0..1
     * @param {import("./controller.js").CharacterController} ch
     */
    _applySurfPose(s, ch) {
        const P = this.pose;
        const b = this._bones;
        const lean = ch.lean;    // signed, right positive
        const carve = ch.carve;  // signed, positive = turning right
        const sp = 0.5 + 0.5 * ch.speed01;
        const tuck = ch.airborne ? P.crouchTuck : 0;
        const crouch = s * (P.crouchBase + P.crouchSpeed * sp + tuck);

        // Pelvis sinks so the bent knees keep the boots on the deck. The mixer
        // rewrites Hips.position every frame, so this offset never accumulates.
        b.Hips.position.y -= crouch * P.hipsDropM * this._hipsUnit;

        // Stance twist + forward attack + roll into the carve, distributed up
        // the spine so no single joint folds. Hips pitch kept moderate — at
        // 0.45 the torso read near-horizontal in the A/B against the figure.
        addRot(b.Hips, crouch * 0.32, P.stanceYaw * s, -lean * P.leanHips * s);
        addRot(b.Spine, crouch * 0.20, -P.stanceYaw * s * 0.35 - carve * P.carveTwist * s * 0.5,
            -lean * P.leanSpine * s * 0.5);
        addRot(b.Spine1, crouch * 0.12, -carve * P.carveTwist * s * 0.3,
            -lean * P.leanSpine * s * 0.3);
        addRot(b.Spine2, crouch * 0.10, -carve * P.carveTwist * s * 0.2,
            -lean * P.leanSpine * s * 0.2);

        // Head looks travel-forward: unwind the stance yaw and most of the
        // accumulated pitch/roll so the eyes stay on the line.
        const pitchSum = crouch * (0.32 + 0.20 + 0.12 + 0.10);
        addRot(b.Neck, -pitchSum * 0.5, -P.stanceYaw * s * 0.35, lean * P.leanHead * s * 0.5);
        addRot(b.Head, -pitchSum * 0.4, -P.stanceYaw * s * 0.30, lean * P.leanHead * s * 0.5);

        // The crouch: thighs forward, knees folded back. Fold kept shy of the
        // pelvis drop's geometric ideal — the carve trench already swallows
        // ankles on BOTH bodies (A/B 23/24), and a deeper fold reads as buried.
        addRot(b.LeftUpLeg, -crouch * 0.70, 0, 0);
        addRot(b.RightUpLeg, -crouch * 0.70, 0, 0);
        addRot(b.LeftLeg, crouch * 1.25, 0, 0);
        addRot(b.RightLeg, crouch * 1.25, 0, 0);

        // Balance arms: out to the sides, the trailing (right) arm higher, and
        // a small counter-rotation against the carve.
        const aOut = P.armOut * s;
        const aCounter = carve * P.armCounter * s;
        addRot(b.LeftArm, 0, aCounter, -aOut * 0.8);
        addRot(b.RightArm, 0, aCounter, aOut * 0.8 + P.armRearLift * s);
        addRot(b.LeftForeArm, 0, 0, -P.armForeBend * s);
        addRot(b.RightForeArm, 0, 0, P.armForeBend * s);
    }

    /**
     * The mesh, for `gfx.warmUp`'s forced draw behind the loading screen.
     * @returns {THREE.Object3D[]}
     */
    warmUpMeshes() {
        return this.mesh ? [this.mesh] : [];
    }

    dispose() {
        if (this.root.parent) this.root.parent.remove(this.root);
        if (this.mixer) this.mixer.stopAllAction();
        if (this.mesh) {
            this.mesh.geometry.dispose();
            this.mesh.skeleton.dispose(); // frees the bone texture
        }
        if (this.material) this.material.dispose();
        if (this._prepassMat) this._prepassMat.dispose();
        for (let i = 0; i < this._depthMats.length; i++) this._depthMats[i].dispose();
        for (let i = 0; i < this._maps.length; i++) this._maps[i].dispose();
    }
}
