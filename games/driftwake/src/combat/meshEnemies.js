/**
 * Skinned-mesh enemy bodies — the thirty rigged Meshy units, drawn with the
 * port's own lighting stack, driven by the five scalars `combat/enemies.js`
 * already writes.
 *
 * DROP-IN FOR `combat/enemyVis.js`. Same constructor, same `spawn / free /
 * drive / driveBolt / update / material / warmUpMeshes / warmUp /
 * finishWarmUp / dispose`, same side-effect contract. `enemies.js` needs no
 * change and does not know a body has a skeleton — it never has (enemies.js:1-6
 * "nothing in here knows what a body looks like").
 *
 * ===========================================================================
 * 1. WHY ONE MATERIAL PER BODY TYPE IS ENOUGH, AND HOW SKINNING STILL WORKS
 *
 * The obvious objection to sharing a material across instances is that
 * `boneTexture` and `bindMatrix` are per-SKELETON, and Three uploads uniforms
 * per material, not per draw. That objection is wrong here, for a reason worth
 * writing down because it is what makes the whole file cheap:
 *
 *   three.module.js:16727-16742 — for any `object.isSkinnedMesh`, the renderer
 *   pushes `bindMatrix` from the OBJECT and `boneTexture` from `object.skeleton`
 *   on EVERY draw. That block sits outside the `refreshMaterial` guard, with
 *   the comment "skinning and morph target uniforms must be set even if
 *   material didn't change".
 *
 * So the beauty pass gets correct per-instance skinning for free — PROVIDED
 * the material does not also declare those two uniforms. It must not, because:
 *
 *   three.module.js:5520-5532 — `seqWithValue` builds the material's upload
 *   list from `u.id in values`, i.e. only uniforms PRESENT in
 *   `material.uniforms`; and three.module.js:16820 runs that upload AFTER the
 *   skinned block, so a `boneTexture` left in `material.uniforms` would
 *   overwrite the correct per-object one with a stale shared one.
 *
 * Hence: `boneTexture` / `bindMatrix` are deliberately ABSENT from the beauty
 * material's uniform map. `lib/meshSkin` still declares them in GLSL; the
 * renderer still binds them; the chunk's own header says exactly this
 * (meshSkin.glsl.js:31-35, "keeping the stock uniform names is what lets it
 * happen at all"). Do not "fix" this by adding them back.
 *
 * THE CASCADE AND PREPASS PROXIES ARE THE OPPOSITE CASE. They are plain
 * `THREE.Mesh`es built inside `registerCaster` (shadows.js:322,
 * depthPass.js:201) — not SkinnedMeshes — so nothing auto-binds for them and
 * the two uniforms MUST live in the caster material. One material per pass is
 * still enough, because the values are swapped per draw in the proxy's own
 * `onBeforeRender` (§2).
 *
 * ===========================================================================
 * 2. THE PER-DRAW UNIFORM BOX — and the one thing enemyVis.js gets wrong
 *
 * The house pattern is `enemyVis.js:216-232`: one shared material, a
 * module-scope `onBeforeRender`, bound state on the mesh, zero closures and
 * zero per-frame allocation. This file keeps all of that — and adds the piece
 * that makes it actually reach the GPU.
 *
 * Writing `material.uniforms.X.value` from `onBeforeRender` is NOT sufficient
 * on its own with a shared material. `_currentMaterialId` is reset only in
 * `render()` (three.module.js:15966) and `setRenderTarget` (:17091), so
 * `refreshMaterial` is true for the FIRST draw of a material in a pass and
 * false for every draw after it — and the uniform upload at :16820 is inside
 * `if (refreshMaterial)`. Twenty-four bodies sharing one material would
 * therefore all render with slot one's telegraph.
 *
 * The supported per-draw path is the next branch down, three.module.js:16824:
 *
 *     if ( material.isShaderMaterial && material.uniformsNeedUpdate === true )
 *
 * so every `onBeforeRender` here ends with `material.uniformsNeedUpdate = true`.
 * The cost is one pass over the material's uniform list per draw; every
 * `SingleUniform` cache-compares and issues no GL call when unchanged, so what
 * is actually uploaded is the handful of floats that moved.
 *
 * ===========================================================================
 * 3. THE FIVE SCALARS -> CLIPS
 *
 * `drive()`'s channels are the animation contract (MESH_ENEMY_CONTRACT §1.4).
 * Nothing else reaches this layer, so this table is the whole state machine:
 *
 *   speed01   idle <-> walk <-> run, a continuous two-way blend, with each
 *             locomotion action's timeScale tracking the blend so the feet
 *             stay with the ground instead of skating.
 *   flash     THE TELEGRAPH, and the one channel that may not be approximated.
 *             The attack action is PAUSED and SCRUBBED: `act.time = flash *
 *             windup`, so the windup pose is locked frame-for-frame to the
 *             telegraph ramp `enemies.js:610-611` computes from the row's
 *             `telegraphMs`. A free-running clip would drift off the number the
 *             player is actually being timed against. The shader's emissive rim
 *             rides the same scalar (`enemySkin.glsl.js`), so the tell is
 *             carried twice — pose AND light — and survives a bad camera angle.
 *   lunge     the strike. Un-pauses the scrubbed action at the windup mark and
 *             lets it play its follow-through, plus a forward root thrust.
 *   submerge  the powder dive: the crouch/stealth clip if the role has one, and
 *             a root sink of 0.75 body-heights.
 *   dissolve  death. The `death` clip, time-scaled so its duration is exactly
 *             the 1.2 s `enemies.js:96` DEATH_S window, plus a late root sink
 *             into the drift. Both are ROOT/BONE motion, so the cascade and the
 *             prepass follow through the same bone matrices with no extra work
 *             — which is why death is not an alpha fade (the shared depth
 *             fragment stages cannot discard).
 *
 * `hit` is in every ROLE_KIT but no `drive` channel carries a hit event, so it
 * is loaded and never played. Closing that needs a sixth scalar in
 * `enemies.js`, which this file does not own.
 *
 * Crossfades are manual weight ramps for `meshChar.js:44-47`'s reason: every
 * action is `.play()`ed once at load and stays scheduled at weight >= 0, since
 * `fadeIn/fadeOut` build an interpolant per call and a weight-0 action costs the
 * mixer one early-out test. With eight live mixers that is the single most
 * important CPU rule in the file. Every LoopOnce action sets
 * `clampWhenFinished = true` — `meshChar.js:475-484` documents the failure it
 * prevents (an unclamped LoopOnce disables itself at its last frame, the
 * mixer's total weight dips, and the body blends toward BIND POSE: a T-pose
 * flash). Thirty bodies with attack one-shots is thirty chances to reproduce it.
 *
 * ===========================================================================
 * 4. LOADING — per realm, and never on the first frame
 *
 * Ten Cold bodies are ~2.96 MiB of mesh plus ~3.0 MiB of clips (roster.js:51,
 * manifest.json `realmBudgetMiB`), i.e. about 5x the rider's 1.23 MB GLB, on
 * top of a boot that already awaits the sky solve, the heightfield bake and
 * `meshChar.load()`. So the boot blocks on exactly ONE body:
 *
 *   `await load(realm)`  fetches manifest.json + the single PRIORITY body
 *                        (mesh + clips, ~0.8 MB). That is enough to warm the
 *                        three programs against real skinned geometry, and
 *                        Three's program cache keys on source + defines, so
 *                        bodies 2..10 arriving seconds later hit the cache and
 *                        compile nothing.
 *   `stream()`           after `loading.done()`, walks the rest of the realm
 *                        ONE GLB at a time, yielding to the frame between each
 *                        (`_yield`). Never parallel: ten concurrent Draco
 *                        decodes on the main thread is the hitch this avoids.
 *
 * `spawn()` on a body that has not landed yet does NOT throw, does not block
 * and does not return anything the caller inspects (enemies.js:365 ignores the
 * result). The slot is recorded as PENDING and binds itself the moment its type
 * resolves. `ready(key)` is the clean gate for the director to consult before
 * it queues a unit at all.
 *
 * ===========================================================================
 * 5. BUDGET
 *
 * Beauty: 1 draw per visible body (the shard placeholder cost 7-11 per body —
 * enemyVis.js:483-561 — so at eight brutes this is 88 draws down to 8).
 * Prepass: 1 per visible body, which the placeholder never paid at all and
 * which closes a real defect: enemies were absent from the prepass
 * (depthPass.js:3-8), so TAA reprojected enemy pixels against the terrain
 * behind them.
 * Cascades: cascade 0 only for a standard body, 0-1 for a boss. Cascade 0
 * covers 26 m (shadows.js:104 SPLITS) and every melee reach and telegraph in
 * `enemies.js` is inside it; cascade 1 starts where shadows.js:53-55's own
 * texel-density argument is already biting.
 *
 * Distance rungs are tied to those same splits, because they are the engine's
 * own statement of where detail stops mattering (shadows.js:20-22):
 *
 *   < 26 m    mixer every frame
 *   26-95 m   mixer every other frame at dt*2
 *   95-330 m  mixer frozen; the body still moves, it just stops animating
 *   > 330 m   `mesh.visible = false` — one flag hides beauty, prepass AND
 *             cascade (shadows.js:583-584, depthPass.js:258, "one flag, not two")
 *
 * plus a hard per-frame mixer budget (8 at ultra, 4 at performance) walked by a
 * round-robin cursor, so a full 24-slot pool degrades in animation rate rather
 * than in frame time. Alternate-frame stepping is safe because combat already
 * tolerates a frame of latency by design (enemies.js:42-44) and because the
 * telegraph the player reads is `flash`, a uniform, not a clip.
 *
 * ALLOCATION PER FRAME: none. Every array, box, scratch and action exists once
 * an instance is built. No closures on the frame path (all four
 * `onBeforeRender` callbacks are module-scope, state lives on the object), no
 * `Math.random` anywhere (the render harnesses depend on repeatable frames —
 * meshChar.js:328-330), and `update()` is never called at dt 0 because
 * `enemies.update` returns early (enemies.js:391), so a paused game is
 * pixel-stable by construction.
 */

import * as THREE from "three";
import { GLTFLoader } from "../../assets/vendor/three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "../../assets/vendor/three/examples/jsm/loaders/DRACOLoader.js";
import { clone as cloneSkinned } from "../../assets/vendor/three/examples/jsm/utils/SkeletonUtils.js";

import { S } from "../core/settings.js";
import { resolve, shader } from "../core/glsl.js";
import { SPLITS } from "../render/shadows.js";
import {
    ENEMY_SKIN_VERTEX, ENEMY_SKIN_DEPTH_VERTEX, ENEMY_SKIN_PREPASS_VERTEX,
    enemySkinFragment,
} from "../shaders/enemySkin.glsl.js";

// `COLD_KEYS` (the old 4-archetype name table) was DELETED when enemies.js grew
// from 4 archetypes to the 30-unit / 15-role roster. Its replacement is `UNITS`
// — 36 spawnable identities (30 bodies + 6 mesh-reuse dress-ups) each carrying
// the body `slug` this renderer needs. Importing the dead name link-errors the
// whole module graph, which only stayed invisible while nothing imported this
// file yet.
import { UNITS, BOLT_MAX } from "./enemies.js";
import { ROSTER, BY_REALM, bodyForKey, clipSlotsFor, KEY_BY_SLUG } from "./roster.js";

/** Slot pool — must cover enemies.js ENEMY_MAX (24). The bolt pool size is
 * IMPORTED from enemies.js rather than restated: the two pools index each
 * other one-to-one, and a restated `16` here against a raised `32` there made
 * `Enemies.clear()` throw on bolt 16 (audit 2026-08-10, observed live). */
const SLOT_MAX = 24;

/**
 * Asset locations. `ENEMY_GLB_V` MUST be bumped on every asset rebuild, for the
 * reason spelled out at meshChar.js:96-102: the CDN serves these with
 * max-age=86400, so an in-place swap leaves players on yesterday's body for up
 * to a day. The query string changes the cache key.
 */
const ENEMY_GLB_V = "e1";
const ENEMY_DIR = "./assets/enemies/";
const MANIFEST_URL = ENEMY_DIR + "manifest.json?v=" + ENEMY_GLB_V;
const DRACO_PATH = "./assets/vendor/three/examples/jsm/libs/draco/gltf/";

/**
 * Receiver params: the CHARACTER band, 1.4 / 0.012 (shadows.js:339-341, from
 * _spec/shadows.md §6.5). A skinned body IS a character — `enemyVis.js:56-57`
 * took the CRYSTAL band because a shard construct is literally ice.
 */
const SHADOW_SOFTNESS = 1.4;
const SHADOW_BIAS = 0.012;

/** Cascades a body casts into. Cascade 0 reaches 26 m (shadows.js:104). */
const CASCADES_STD = 1;
const CASCADES_BOSS = 2;

/**
 * Hard ceiling on resident instances. There is NO unregister on either caster
 * system (shadows.js has `registerCaster` at :297 and no removal; likewise
 * depthPass.js:195), so an instance, once built, is permanent — pooled per body
 * TYPE and reused, never freed. Steady state is bounded by the sum over types of
 * their peak concurrency, which for a director capping live enemies at 8
 * (encounters.js:115-117) against a 24-slot pool sits far below this. The cap
 * exists so a pathological session degrades visibly (a warning, a missing body)
 * instead of leaking skeletons.
 */
const INSTANCE_MAX = 40;

/** Mixers stepped per frame, by preset. Contract §5.5 caps this at 8. */
const MIXER_BUDGET = {
    ultra: 8, high: 8, balanced: 6, performance: 4,
};

/** Locomotion blend break points on `speed01`. */
const SPEED_WALK = 0.02;
const SPEED_RUN = 0.50;

/** Manual crossfade times, seconds. A death is not a crossfade. */
const FADE = 0.15;
const FADE_DEATH = 0.07;

/** Death window — `enemies.js:96` DEATH_S. The death clip is scaled to fill it. */
const DEATH_S = 1.2;

/**
 * Fraction of the attack clip that is windup. The strike lands near the middle
 * of a Mixamo attack; scrubbing 0..0.45 of the clip across the flash ramp puts
 * the wind-back at flash 0 and the committed pose at flash 1, which is where
 * `enemies.js` fires the strike.
 */
const WINDUP_FRAC = 0.45;

/** Core clip slots — the first five of every ROLE_KIT list (roster.js:74-105). */
const CL_IDLE = 0, CL_WALK = 1, CL_RUN = 2, CL_DEATH = 4;
/** First attack slot; everything from here up is a role attack. */
const CL_ATTACK0 = 5;

/**
 * MESH_REUSE tint tokens -> colour. roster.js:628-629 states these are TOKENS,
 * not hex values, and that "the material work is the renderer's call" — so this
 * table is that call, made here and nowhere else. Multiplied into albedo.
 */
const TINT = {
    "cyan-emissive": [0.45, 0.95, 1.25],
    "glass-refractive": [0.80, 0.92, 1.10],
    "sand-palette": [1.25, 1.05, 0.72],
    "sand-brass": [1.30, 1.02, 0.55],
};

/**
 * Per-body-type surface response, by `animRole`. Two numbers, no texture:
 * (roughness, metallic). Constructs and plate read tighter than hide and wrap.
 * Anything unlisted takes the default.
 */
const MR_DEFAULT = [0.62, 0.0];
const MR_BY_ROLE = {
    golem: [0.48, 0.0], knight: [0.34, 0.35], sentinel: [0.36, 0.30],
    boss: [0.38, 0.25], warden: [0.42, 0.20], guardian: [0.40, 0.30],
    mummy: [0.78, 0.0], swarm: [0.70, 0.0], stalker: [0.66, 0.0],
    assassin: [0.58, 0.05], mage: [0.60, 0.0], cultist: [0.60, 0.0],
    brute: [0.55, 0.0], raider: [0.58, 0.05], bandit: [0.60, 0.05],
};

// ------------------------------------------------------- module-scope scratch
// Nothing below allocates once construction is done.

const _v = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _box = new THREE.Box3();

/** No-op raycast, shared by every body (they are not pickable). */
function _noRaycast() {}

/** Deterministic 0..1 hash — spawn-time jitter only, never on the frame path. */
function h01(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
}

function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Is a shared chunk registered? Same guard `meshChar.js:206` uses, same reason.
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

// ---------------------------------------------------------- shared callbacks
// Module scope, `this` = the object being drawn, bound state ON that object —
// the enemyVis.js:216-232 pattern, with the `uniformsNeedUpdate` flush the
// shared-material path actually needs (see the header, §2).

/**
 * Beauty draw. Writes the per-instance telegraph/death/tint box.
 * `boneTexture` / `bindMatrix` are NOT touched here: the renderer auto-binds
 * them from this SkinnedMesh (header §1).
 */
function _writeBodyState(renderer, scene, camera, geometry, material) {
    const inst = this._inst;
    const u = material.uniforms;
    u.uEnemyState.value = inst.state;
    u.uEnemyTint.value = inst.tint;
    material.uniformsNeedUpdate = true;
}

/**
 * Cascade / prepass draw. The proxy is a plain Mesh, so the two skinning
 * uniforms have to be pushed by hand — one material serves every instance.
 */
function _writeCasterSkin(renderer, scene, camera, geometry, material) {
    const inst = this._inst;
    const u = material.uniforms;
    u.boneTexture.value = inst.boneTexture;
    u.bindMatrix.value = inst.bindMatrix;
    material.uniformsNeedUpdate = true;
}

/** Bolt draw — a bolt is all tell, so only its seed and fade vary. */
function _writeBoltState(renderer, scene, camera, geometry, material) {
    material.uniforms.uBoltState.value = this._state;
    material.uniformsNeedUpdate = true;
}

// ------------------------------------------------------------- bolt stages
//
// The projectile pool is unrelated to skinning and the contract still owes it
// (MESH_ENEMY_CONTRACT §1.5): `driveBolt` is called from enemies.js:380, :992
// and :999 whatever the bodies are made of. It is kept here rather than left
// behind in enemyVis.js so that swapping the body layer does not leave a second
// 280-object placeholder resident in the scene just to draw sixteen sparks.

const BOLT_VERT = /* glsl */`
#include "lib/common"

in vec3 position;

uniform mat4 modelMatrix;     // auto-bound per object (three.module.js:16842)

out vec3 vWorld;
out float vUp;

void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vUp = clamp(position.y, 0.0, 1.0);
    gl_Position = uViewProj * w;
}
`;

const BOLT_FRAG = /* glsl */`
#include "lib/atmosphere"

in vec3 vWorld;
in float vUp;

uniform vec4 uBoltState;   // x seed, y fade 0..1, z,w spare

layout(location = 0) out vec4 outColor;

/// The same rime-light the telegraph uses (enemySkin.glsl.js TELL_COL): an
/// incoming bolt and an incoming melee windup are the same warning.
const vec3 BOLT_COL = vec3(0.40, 0.85, 1.00);

void main() {
    vec3 V = normalize(uCameraPos - vWorld);
    // Flat facet normal from the derivatives — a splinter IS its facets, the
    // argument enemyVis.js:131-136 makes for the shard stage.
    vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (dot(N, V) < 0.0) { N = -N; }

    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.6);
    float core = 1.0 - 0.55 * vUp;
    float flick = 0.88 + 0.12 * sin(uTime * 31.0 + uBoltState.x * 37.0);

    vec3 color = BOLT_COL * (2.4 * core + 1.6 * rim) * flick * uBoltState.y;
    color = aerial(color, vWorld);
    outColor = vec4(color, 1.0);
}
`;

/**
 * The bolt splinter: a hexagonal bipyramid, base at the origin, tip at
 * (0,1,0). Twelve flat triangles; the fragment's derivative normals give the
 * facets, so indexing costs nothing visually. Ported from the shard geometry
 * `enemyVis.js:587-618` builds, because a bolt is the one thing about the
 * placeholder that was never a placeholder.
 * @returns {THREE.BufferGeometry}
 */
function buildBoltGeometry() {
    const RING = 6;
    const pos = new Float32Array((RING + 2) * 3);
    pos[0] = 0; pos[1] = 0; pos[2] = 0;
    for (let k = 0; k < RING; k++) {
        const a = (k / RING) * Math.PI * 2;
        const o = (1 + k) * 3;
        pos[o] = Math.cos(a);
        pos[o + 1] = 0.3;
        pos[o + 2] = Math.sin(a);
    }
    const tip = (1 + RING) * 3;
    pos[tip] = 0; pos[tip + 1] = 1; pos[tip + 2] = 0;

    const idx = new Uint16Array(RING * 2 * 3);
    let ii = 0;
    for (let k = 0; k < RING; k++) {
        const k2 = (k + 1) % RING;
        idx[ii++] = 0; idx[ii++] = 1 + k; idx[ii++] = 1 + k2;
        idx[ii++] = 1 + k; idx[ii++] = 1 + RING; idx[ii++] = 1 + k2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
}

/**
 * A spawn key -> the roster name a body can be looked up by.
 *
 * `enemies.js` calls `spawn()` with either a UNITS index (the hot path — the AI
 * works in indices) or a slug/combatData key (the console and the harness use
 * names). Both resolve here so every other method downstream sees one shape.
 * A stale or out-of-range index returns null rather than throwing: a body that
 * cannot be identified must degrade to "not rendered", never to a dead frame.
 * @param {string|number} key
 * @returns {string|null}
 */
function _unitName(key) {
    if (typeof key !== "number") return key || null;
    const u = UNITS[key];
    // The COMBAT KEY, not the slug. `roster.bodyForKey()` is indexed by
    // combatData key ("rimeImp"), and a slug ("01_cold_rime_imp") misses it
    // silently — the slot just never fills, the AI keeps driving an empty body,
    // and the only symptom is that nothing is on screen. Slugs are still
    // accepted on the way in; `_bodyFor` translates them.
    return u ? (u.key || u.slug || null) : null;
}

export class MeshEnemies {
    /**
     * Construction is cheap and synchronous; `load()` does the work. Mirrors
     * `EnemyVis`'s inputs exactly (enemyVis.js:254), so the `main.js:490` call
     * site changes only its class name.
     *
     * @param {THREE.Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {import("../spells/spellLights.js").SpellLights} lights
     * @param {Record<string, {value:any}>} globals `lib/common`'s shared block.
     *        Pass `spells.globals` — `uViewProj` / `uCameraPos` / `uTime` are
     *        LIVE boxes written by `spells.update` at main.js:649, six lines
     *        before `enemies.update` runs this. Owning private copies would
     *        require a `sync(camera)` call in main.js; sharing needs nothing.
     */
    constructor(scene, sky, shadows, lights, globals) {
        this.scene = scene;
        this.sky = sky;
        this.shadows = shadows;
        this.lights = lights;
        this.globals = globals;

        /** @type {import("../render/depthPass.js").DepthPass|null} */
        this.depth = null;

        /** Does `lib/spellLights` exist in this build? (meshChar.js:406) */
        this._spellLights = hasChunk("lib/spellLights");

        /**
         * `lib/shading` declares sssStrength/sssRadius/glintIntensity/
         * glintGrazing and no fragment stage does (shading.glsl.js:106-109), so
         * something must supply them. `meshChar` borrows `terrain.shadingUniforms`;
         * this file owns its own four and refreshes them from `S` in `update()`,
         * exactly as enemyVis.js:259-264 + :433-434 does — one fewer constructor
         * dependency than the rider needs.
         */
        this._shading = {
            sssStrength: { value: S.sssStrength },
            sssRadius: { value: S.sssRadius },
            glintIntensity: { value: S.glintIntensity },
            glintGrazing: { value: S.glintGrazing },
        };

        /**
         * The two skinning boxes the CASTER materials share. Swapped per draw
         * by `_writeCasterSkin`; never read by the beauty material (§1).
         */
        this._uCasterBone = { value: null };
        this._uCasterBind = { value: null };

        // ---- caster materials: three in total, for any number of bodies -----
        /** @type {THREE.RawShaderMaterial[]} one per cascade index. */
        this._depthMats = [];
        for (let c = 0; c < CASCADES_BOSS; c++) {
            const m = shadows.makeCasterMaterial(ENEMY_SKIN_DEPTH_VERTEX, {
                boneTexture: this._uCasterBone,
                bindMatrix: this._uCasterBind,
            }, {
                // A distinct compiled program per cascade, as the rider's
                // (meshChar.js:604-605, shadows.js:42-45).
                defines: { ENEMY_CASCADE: c },
            });
            m.name = "enemyDepth" + c;
            this._depthMats.push(m);
        }
        /** @type {THREE.RawShaderMaterial|null} built in registerPrepass. */
        this._prepassMat = null;

        // ---- body SoA state — same field names as EnemyVis ------------------
        this.used = new Uint8Array(SLOT_MAX);
        this.key = new Uint8Array(SLOT_MAX);
        this.x = new Float32Array(SLOT_MAX);
        this.y = new Float32Array(SLOT_MAX);
        this.z = new Float32Array(SLOT_MAX);
        this.yaw = new Float32Array(SLOT_MAX);
        this.speed01 = new Float32Array(SLOT_MAX);
        this.flash = new Float32Array(SLOT_MAX);
        this.lunge = new Float32Array(SLOT_MAX);
        this.submerge = new Float32Array(SLOT_MAX);
        this.dissolve = new Float32Array(SLOT_MAX);

        /** Resolved combatData key per slot, or null. @type {(string|null)[]} */
        this._slotKey = new Array(SLOT_MAX).fill(null);
        /** The bound instance per slot, or null while pending. @type {any[]} */
        this._slotInst = new Array(SLOT_MAX).fill(null);

        // ---- body types, keyed by roster slug --------------------------------
        /** @type {Map<string, any>} slug -> type record */
        this._types = new Map();
        /** Live materials, one per resident body type. @type {THREE.RawShaderMaterial[]} */
        this.materials = [];
        /** Every instance ever built, for update/dispose. @type {any[]} */
        this._insts = [];
        /** Parsed manifest.json. @type {object|null} */
        this.manifest = null;
        /** The realm currently resident. @type {string|null} */
        this.realm = null;
        /** Background streaming promise, or null. @type {Promise<void>|null} */
        this.streaming = null;

        /**
         * Optional hook, called with each body type's beauty material as it is
         * created. Not required for spell lights — `lights.uniforms` is spread
         * into every material at build time, which is spellLights.js's "share"
         * mode ("Nothing further is needed"). It exists so an integrator can
         * also route new materials into `spells.addConsumers` if some future
         * consumer needs the registration rather than the boxes.
         * @type {((m: THREE.RawShaderMaterial) => void)|null}
         */
        this.onMaterial = null;

        // ---- the loaders ------------------------------------------------------
        // ONE DRACOLoader for the whole session, disposed only when the last
        // background body has resolved. meshChar.js:376 disposes its own
        // immediately, so a second `new DRACOLoader()` here re-instantiates the
        // 192 KB wasm module; sharing one across the ten bodies of a realm is
        // what keeps that to a single init. (The contract's `character/gltf.js`
        // would let this be shared with the rider too, but that file is outside
        // this module's ownership — cost: one extra wasm init at boot.)
        this._draco = new DRACOLoader();
        this._draco.setDecoderPath(DRACO_PATH);
        this._gltf = new GLTFLoader();
        this._gltf.setDRACOLoader(this._draco);

        // ---- the bolt pool ----------------------------------------------------
        this._boltGeo = buildBoltGeometry();
        this.boltMaterial = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(BOLT_VERT),
            fragmentShader: shader(BOLT_FRAG),
            uniforms: Object.assign({}, globals, sky.uniforms, {
                uBoltState: { value: new Float32Array(4) },
            }),
            side: THREE.DoubleSide,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });
        this.boltMaterial.name = "enemyBolt";

        /** @type {THREE.Mesh[]} */
        this._boltMeshes = new Array(BOLT_MAX);
        for (let b = 0; b < BOLT_MAX; b++) {
            const m = new THREE.Mesh(this._boltGeo, this.boltMaterial);
            m.visible = false;
            m.renderOrder = 1;
            m.scale.setScalar(0.12);
            m.raycast = _noRaycast;
            m._state = new Float32Array([h01(200 + b * 5.9), 1, 0, 0]);
            m.onBeforeRender = _writeBoltState;
            scene.add(m);
            this._boltMeshes[b] = m;
        }

        this._time = 0;
        this._warm = false;
        /** Round-robin cursor for the per-frame mixer budget. */
        this._mixCursor = 0;
        /** Frame counter, for the 26-95 m alternate-frame rung. */
        this._frame = 0;
        /** Diagnostics for the harness — cheap counters, no allocation. */
        this.stats = {
            visible: 0, mixersStepped: 0, instances: 0, types: 0, pending: 0,
        };
    }

    // ====================================================================
    //  Loading
    // ====================================================================

    /**
     * Fetch the manifest and the ONE priority body, then return. Await this
     * inside the boot sequence (between "fitting the rider" and "compiling
     * pipelines") so the warm-up has real skinned geometry to compile against;
     * everything else streams later. See the header §4.
     *
     * @param {string} realm "cold" | "sand" | "ash"
     * @param {string} [priority] slug to block on; defaults to the first body
     *   the level-1 gate can spawn (the realm's swarm unit).
     * @returns {Promise<void>}
     */
    async load(realm, priority) {
        this.realm = realm;
        // A realm switch starts a fresh background walk: the old `streaming`
        // promise belongs to the old realm's slug list, and holding on to it
        // made stream() a boot-only one-shot (audit 2026-08-10 — the other
        // nine bodies of every later realm never loaded).
        this.streaming = null;
        const res = await fetch(MANIFEST_URL);
        if (!res.ok) throw new Error("meshEnemies: manifest " + res.status);
        this.manifest = await res.json();

        const slugs = BY_REALM[realm];
        if (!slugs || !slugs.length) {
            throw new Error("meshEnemies: no bodies for realm " + realm);
        }
        const first = priority && slugs.indexOf(priority) >= 0 ? priority : slugs[0];
        await this._loadType(first);
    }

    /**
     * Stream the rest of the realm in the background, one GLB at a time, with a
     * frame yield between each. Call AFTER the boot screen lifts; it never
     * throws (a body that fails to load is logged and simply never `ready`).
     * @returns {Promise<void>}
     */
    stream() {
        if (this.streaming) return this.streaming;
        // Pin the realm at walk start: `enterRealm` can retarget `this.realm`
        // mid-walk, and finishing the OLD list against the NEW realm both
        // wastes decodes and races `load()`'s own fetch.
        const token = this.realm;
        this.streaming = (async () => {
            const slugs = BY_REALM[token] || [];
            for (let i = 0; i < slugs.length; i++) {
                if (this.realm !== token) return;   // realm switched: stand down
                if (this._types.has(slugs[i])) continue;
                try {
                    await this._loadType(slugs[i]);
                } catch (e) {
                    console.warn("meshEnemies: " + slugs[i] + " failed:", e);
                }
                await this._yield();
            }
            // The DRACOLoader is deliberately KEPT: realm switches re-enter
            // this walk, and `_loadType` still routes through `this._gltf`,
            // which holds the decoder. Disposing it here (as this build once
            // did) crashed the second realm's stream and left `_gltf` holding
            // a disposed instance. It is released in dispose(), once.
        })();
        return this.streaming;
    }

    /** One frame of breathing room between background decodes. */
    _yield() {
        return new Promise((r) => requestAnimationFrame(() => r()));
    }

    /**
     * Can this combatData key be spawned with a real body right now? The clean
     * gate for the director: an un-loaded unit is simply not selected, rather
     * than spawned invisible (MESH_ENEMY_CONTRACT §5.8.4).
     * @param {string|number} key combatData key, or an archetype index
     * @returns {boolean}
     */
    ready(key) {
        const body = this._bodyFor(key);
        if (!body) return false;
        const t = this._types.get(body.slug);
        return !!t && t.state === 1;
    }

    /**
     * @param {string|number} key
     * @returns {{slug:string, scale:number, tint:string|null}|null}
     */
    _bodyFor(key) {
        const name = _unitName(key);
        if (!name) return null;
        // Callers legitimately hold either identifier: the AI works in UNITS
        // indices, the console and the harness spawn by slug, and combatData
        // rows are keyed by combat key. Accept all three rather than making
        // every call site remember which one this function wants.
        return bodyForKey(name) || bodyForKey(KEY_BY_SLUG[name]) || null;
    }

    /**
     * Fetch one body: mesh GLB + (if the manifest says it has any) its clip
     * bundle, build the shared geometry/texture/material, and register nothing
     * — instances and their casters are built on first spawn.
     * @param {string} slug
     * @returns {Promise<void>}
     */
    async _loadType(slug) {
        if (this._types.has(slug)) return;
        const unit = ROSTER[slug];
        if (!unit) throw new Error("meshEnemies: " + slug + " is not a roster slug");

        /** Reserve the key immediately so two callers cannot both fetch it. */
        const type = {
            slug, unit, state: 0, geometry: null, map: null, material: null,
            proto: null, protoMesh: null, clipNames: clipSlotsFor(slug) || [],
            clips: null, insts: [], free: [],
            // R_y(yawFront - yaw) maps the model's front onto the port's
            // forward. Measured at load, never assumed — see _measureFront.
            yawFront: Math.PI,
            heightM: unit.aabbHeightM * unit.engineScale,
            cascades: unit.bossKind === "realm_boss" || unit.sizeScale > 1.5
                ? CASCADES_BOSS : CASCADES_STD,
        };
        this._types.set(slug, type);

        const ent = this.manifest && this.manifest.enemies
            ? this.manifest.enemies[slug] : null;
        const meshFile = (ent && ent.mesh) || unit.mesh;

        const gltf = await this._gltf.loadAsync(
            ENEMY_DIR + meshFile + "?v=" + ENEMY_GLB_V);

        /** @type {THREE.SkinnedMesh|null} */
        let mesh = null;
        gltf.scene.traverse((o) => {
            if (!mesh && /** @type {any} */ (o).isSkinnedMesh) {
                mesh = /** @type {THREE.SkinnedMesh} */ (o);
            }
        });
        if (!mesh) throw new Error("meshEnemies: no SkinnedMesh in " + meshFile);

        // The stock material is unusable — this scene has no THREE.Light at all
        // (main.js:178-180), so a MeshStandardMaterial evaluates Three's light
        // uniforms, finds them zero, and renders BLACK (meshChar.glsl.js:12-18).
        // Keep the one map it ships and discard the rest; unlike the rider
        // (meshChar.js:393, which throws without all three) a missing normal or
        // metal-rough map is EXPECTED here, so only baseColor is required.
        const std = /** @type {THREE.MeshStandardMaterial} */ (mesh.material);
        const map = std.map || null;
        if (!map) throw new Error("meshEnemies: " + slug + " has no base colour map");
        std.dispose();   // textures survive material disposal
        type.map = map;
        type.geometry = mesh.geometry;
        type.proto = gltf.scene;
        type.protoMesh = mesh;
        type.yawFront = this._measureFront(mesh);

        // ---- clips ------------------------------------------------------------
        // `anims: null` is how the manifest says a body is BIND-POSE ONLY
        // (roster.js:43-45). That is not an error: the body loads, gets no
        // mixer, and is driven by its root transform alone.
        const anims = ent && ent.anims;
        if (anims && anims.file) {
            const cg = await this._gltf.loadAsync(
                ENEMY_DIR + anims.file + "?v=" + ENEMY_GLB_V);
            type.clips = cg.animations || null;
        }

        type.material = this._buildMaterial(type);
        type.state = 1;
        this.stats.types = this._types.size;

        // Any slot that spawned this body while it was still in flight binds now.
        for (let i = 0; i < SLOT_MAX; i++) {
            if (this.used[i] && !this._slotInst[i] && this._slotKey[i]) {
                const b = this._bodyFor(this._slotKey[i]);
                if (b && b.slug === slug) this._bind(i, b);
            }
        }
    }

    /**
     * Which way does this body face in bind pose?
     *
     * MESH_ENEMY_CONTRACT §2.5 flags this as "the single highest-risk one-line
     * error in the port": the shard placeholder is radially symmetric, so
     * `-yaw` (enemyVis.js:430-431) never showed an error there, while the rider
     * needs `PI - yaw` (meshChar.js:653) because its model front is +Z. Get it
     * wrong and every body walks backwards. So it is MEASURED, not assumed.
     *
     * The test: with forward = +Z and up = +Y in a right-handed world, a
     * character's RIGHT is cross(+Z, +Y) = -X, so its LEFT arm sits at +X.
     * Reading the sign of the left arm's bind-pose x therefore decides the
     * front axis directly, per body, and a mixed-orientation asset batch
     * reports itself instead of shipping.
     *
     * @param {THREE.SkinnedMesh} mesh
     * @returns {number} the `yawFront` offset: PI for a +Z-front body, 0 for -Z
     */
    _measureFront(mesh) {
        const sk = mesh.skeleton;
        let left = null;
        let right = null;
        for (let i = 0; i < sk.bones.length; i++) {
            const n = sk.bones[i].name;
            if (!left && /LeftArm$/.test(n)) left = sk.bones[i];
            if (!right && /RightArm$/.test(n)) right = sk.bones[i];
        }
        if (!left || !right) return Math.PI;   // mixamorig default
        mesh.updateMatrixWorld(true);
        left.getWorldPosition(_v);
        const lx = _v.x;
        right.getWorldPosition(_v);
        return lx > _v.x ? Math.PI : 0;
    }

    /**
     * One RawShaderMaterial per body TYPE. The uniform groups are assembled in
     * `meshChar.js:411-424`'s order, with two deliberate differences:
     *
     *  - `boneTexture` / `bindMatrix` are ABSENT. See the header, §1. This is
     *    load-bearing; adding them breaks per-instance skinning.
     *  - `lights.uniforms` is spread in HERE rather than left to
     *    `spells.addConsumers`, which is what enemyVis.js:278 does and what
     *    spellLights.js calls "share" mode: "Nothing further is needed".
     *    `addConsumers` remains safe and idempotent on top (spellLights.js:121-128
     *    only fills in boxes that are missing), so the main.js:492 line can stay
     *    exactly as it is — it simply has nothing left to do.
     *
     * @param {any} type
     * @returns {THREE.RawShaderMaterial}
     */
    _buildMaterial(type) {
        const mr = MR_BY_ROLE[type.unit.animRole] || MR_DEFAULT;
        const mat = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(ENEMY_SKIN_VERTEX),
            fragmentShader: shader(enemySkinFragment({
                spellLights: this._spellLights,
            })),
            uniforms: Object.assign(
                {},
                this.globals,
                this.sky.uniforms,
                this._shading,
                this.shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
                this.lights.uniforms,
                {
                    baseColorMap: { value: type.map },
                    uEnemyMR: { value: new THREE.Vector2(mr[0], mr[1]) },
                    // Rebound per draw by `_writeBodyState`; the initial arrays
                    // exist only so the first program build has something.
                    uEnemyState: { value: new Float32Array(4) },
                    uEnemyTint: { value: new Float32Array([1, 1, 1, 0]) },
                }
            ),
            // FrontSide, unlike the rider. `meshChar.js:427-429` takes
            // DoubleSide for hood interiors and sleeve openings; a watertight
            // Meshy body has no thin shells, so single-sided is equally correct
            // and halves the rasterised triangles on the beauty pass. (The
            // CASTER materials stay DoubleSide regardless — makeCasterMaterial
            // sets it, shadows.js:279-282 says why.)
            side: THREE.FrontSide,
            // Opaque and depth-writing, copying meshChar.js:428-432 and NOT
            // enemyVis.js:284-288: that material is blended because translucent
            // ice shards must, and an opaque body in the transparent bucket
            // sorts every frame for nothing.
            transparent: false,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });
        mat.name = "enemySkin:" + type.slug;
        this.materials.push(mat);
        if (this.onMaterial) this.onMaterial(mat);
        return mat;
    }

    // ====================================================================
    //  Instances
    // ====================================================================

    /**
     * Take a free instance of this body type, building one if the pool is dry.
     * @param {any} type
     * @returns {any|null} null past INSTANCE_MAX
     */
    _acquire(type) {
        if (type.free.length) {
            const inst = type.free.pop();
            inst.live = 1;
            return inst;
        }
        if (this._insts.length >= INSTANCE_MAX) {
            console.warn("meshEnemies: INSTANCE_MAX reached; " + type.slug +
                " spawned without a body");
            return null;
        }
        return this._build(type);
    }

    /**
     * Build one renderable instance: a skinned clone, its mixer and actions,
     * and its cascade/prepass casters. Called on demand, never on the frame
     * path — the first spawn of a body type pays for it.
     * @param {any} type
     * @returns {any}
     */
    _build(type) {
        // `SkeletonUtils.clone` deep-copies the node hierarchy and rebinds a
        // fresh Skeleton to it while SHARING geometry and material references,
        // which is the whole reason it is vendored: N bodies of one type cost N
        // skeletons and one vertex buffer.
        const root = cloneSkinned(type.proto);

        /** @type {THREE.SkinnedMesh|null} */
        let mesh = null;
        root.traverse((o) => {
            if (!mesh && /** @type {any} */ (o).isSkinnedMesh) {
                mesh = /** @type {THREE.SkinnedMesh} */ (o);
            }
        });
        if (!mesh) throw new Error("meshEnemies: clone lost its SkinnedMesh");

        mesh.material = type.material;
        mesh.name = "enemy:" + type.slug;
        // Bind-pose bounds on a rig that roams (meshChar.js:437). Culling is
        // done by hand in update(), against the camera, with the result written
        // to `mesh.visible` — the one flag both caster systems honour.
        mesh.frustumCulled = false;
        mesh.raycast = _noRaycast;
        mesh.renderOrder = 1;        // terrain/crystal band (dummies.js:274-276)
        mesh.visible = false;

        const skeleton = mesh.skeleton;
        if (skeleton.boneTexture === null) skeleton.computeBoneTexture();

        const holder = new THREE.Group();
        holder.add(root);
        holder.visible = false;
        this.scene.add(holder);

        const inst = {
            type,
            root: holder,
            mesh,
            skeleton,
            boneTexture: skeleton.boneTexture,
            bindMatrix: mesh.bindMatrix,
            mixer: null,
            /** @type {(THREE.AnimationAction|null)[]} parallel to type.clipNames */
            acts: [],
            weights: null,
            targets: null,
            /** vec4 (flash, dissolve, seed, tintMix) — the per-draw box. */
            state: new Float32Array(4),
            /** vec4 (r,g,b,-) — the MESH_REUSE dress-up colour. */
            tint: new Float32Array([1, 1, 1, 0]),
            live: 1,
            slot: -1,
            /** Attack slot currently scrubbed, or -1. */
            atk: -1,
            /** Deterministic attack picker (never Math.random). */
            seq: 0,
            /** True once `lunge` released the scrubbed windup. */
            striking: false,
            /** Death-entry edge. The CL_DEATH action is a LoopOnce that was
             *  `.play()`ed at build like every action (§3), so it runs to its
             *  final frame at weight 0 within seconds of the build and CLAMPS.
             *  Ramping weight onto that finished action shows a static corpse
             *  pose instead of the fall — on the FIRST death, and again on
             *  every pooled reuse. This flag is how `_clips` knows to
             *  `reset()` it exactly once, on the frame death begins. */
            dying: false,
            /** Rung 1 (26-95 m) steps on alternate frames; this is its parity. */
            parity: this._insts.length & 1,
        };
        inst.state[2] = h01(this._insts.length * 13.7);

        mesh._inst = inst;
        mesh.onBeforeRender = _writeBodyState;

        if (type.clips && type.clips.length) {
            inst.mixer = new THREE.AnimationMixer(root);
            const n = type.clipNames.length;
            inst.weights = new Float32Array(n);
            inst.targets = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const clip = THREE.AnimationClip.findByName(
                    type.clips, type.clipNames[i]);
                if (!clip) { inst.acts.push(null); continue; }
                const a = inst.mixer.clipAction(clip);
                if (i >= CL_ATTACK0 || i === CL_DEATH) {
                    a.setLoop(THREE.LoopOnce, 1);
                    // MUST be true — meshChar.js:475-484: an unclamped LoopOnce
                    // DISABLES itself at its last frame, the mixer's total
                    // weight dips, and the body blends toward BIND POSE.
                    a.clampWhenFinished = true;
                }
                if (i === CL_DEATH) {
                    // Fill exactly the DEATH_S window enemies.js:96 gives it.
                    a.setEffectiveTimeScale(clip.duration / DEATH_S);
                }
                a.play();                  // scheduled forever; weights talk
                a.setEffectiveWeight(0);
                inst.acts.push(a);
            }
            if (inst.acts[CL_IDLE]) {
                inst.weights[CL_IDLE] = 1;
                inst.targets[CL_IDLE] = 1;
                inst.acts[CL_IDLE].setEffectiveWeight(1);
            }
            // Settle onto frame 0 so the first drawn frame is a pose, not bind.
            inst.mixer.update(0);
        }

        holder.updateMatrixWorld(true);
        skeleton.update();

        this._registerCasters(inst, type.cascades);

        type.insts.push(inst);
        this._insts.push(inst);
        this.stats.instances = this._insts.length;
        return inst;
    }

    /**
     * Join the shadow cascades and the depth prepass.
     *
     * `registerCaster` builds the proxy internally and does not return it, so
     * it is claimed off the proxy scene it was just appended to — both
     * `shadows.scenes` (shadows.js:182, :330) and `depthPass.scene`
     * (depthPass.js:137, :205) are public and the add is the last statement of
     * the registration, so `children[length - 1]` is this instance's proxy by
     * construction. The identity assert below turns any future reordering into
     * a loud failure at load rather than a silent wrong-skeleton shadow.
     *
     * Why the proxy needs claiming at all: it is a plain Mesh, so the renderer
     * does not auto-bind skinning uniforms for it (§1) and one shared caster
     * material has to be told which skeleton this draw belongs to (§2).
     *
     * @param {any} inst
     * @param {number} cascades
     */
    _registerCasters(inst, cascades) {
        const sh = this.shadows;
        sh.registerCaster(inst.mesh, (c) => this._depthMats[c], cascades);
        for (let c = 0; c < cascades; c++) {
            this._claimProxy(sh.scenes[c], this._depthMats[c], inst,
                "shadow cascade " + c);
        }
        if (this.depth && this._prepassMat) {
            this.depth.registerCaster(inst.mesh, this._prepassMat);
            this._claimProxy(this.depth.scene, this._prepassMat, inst, "prepass");
        }
    }

    /**
     * @param {THREE.Scene} scene @param {THREE.Material} mat
     * @param {any} inst @param {string} what
     */
    _claimProxy(scene, mat, inst, what) {
        const kids = scene.children;
        const proxy = /** @type {any} */ (kids[kids.length - 1]);
        if (!proxy || proxy.material !== mat ||
            proxy.geometry !== inst.mesh.geometry || proxy._inst !== undefined) {
            throw new Error("meshEnemies: could not claim the " + what +
                " proxy for " + inst.type.slug);
        }
        proxy._inst = inst;
        proxy.onBeforeRender = _writeCasterSkin;
    }

    /**
     * Register the prepass. Call once, BEFORE any body loads — instances built
     * later register themselves against it. Closing this hole is one of the two
     * pre-existing defects the replacement fixes: enemies were absent from the
     * prepass entirely (MESH_ENEMY_CONTRACT §3.1), so every screen-space
     * consumer — TAA reprojection above all — saw terrain depth where an enemy
     * was, and enemy pixels smeared against the ground behind them.
     * @param {import("../render/depthPass.js").DepthPass} depth
     * @returns {void}
     */
    registerPrepass(depth) {
        this.depth = depth;
        const mat = depth.makeCasterMaterial(ENEMY_SKIN_PREPASS_VERTEX, {
            boneTexture: this._uCasterBone,
            bindMatrix: this._uCasterBind,
        });
        mat.name = "enemyPrepass";
        this._prepassMat = mat;
        // Anything already built (only possible if load() ran first) joins now.
        for (let i = 0; i < this._insts.length; i++) {
            depth.registerCaster(this._insts[i].mesh, mat);
            this._claimProxy(depth.scene, mat, this._insts[i], "prepass");
        }
    }

    // ====================================================================
    //  The EnemyVis API
    // ====================================================================

    /**
     * The material `spells.addConsumers` is handed at main.js:492. With one
     * material per body TYPE there is no single answer, so this returns the
     * first resident one; the registration is a no-op anyway, because every
     * material is built with `lights.uniforms` already spread in (see
     * `_buildMaterial`). `materials` is the whole live list.
     * @returns {THREE.RawShaderMaterial|null}
     */
    get material() {
        return this.materials.length ? this.materials[0] : this.boltMaterial;
    }

    /**
     * Configure slot `i` as `key` and show it. Synchronous, never throws, and
     * returns nothing the caller inspects (enemies.js:365).
     *
     * @param {number} i pool slot, matching the enemies.js SoA index
     * @param {number|string} key archetype index into `COLD_KEYS`, or a
     *   combatData key directly — both resolve through `roster.bodyForKey`, so
     *   widening the key space upstream needs no change here.
     * @param {number} x @param {number} y @param {number} z
     * @returns {void}
     */
    spawn(i, key, x, y, z) {
        // Re-spawning a slot that still holds a body RELEASES it first.
        // Without this the old instance is orphaned — live=1, visible=true,
        // never returned to the type pool — and stands frozen at its
        // fresh-bind pose forever: a T-posed statue in the field. The AI
        // never double-spawns, but probes and future callers can
        // (2026-08-10: three "enemies are in T-pose" reports traced to
        // exactly these orphans, manufactured by a harness).
        if (this._slotInst[i]) this.free(i);
        this.used[i] = 1;
        this.key[i] = typeof key === "number" ? key : 0;
        this.x[i] = x; this.y[i] = y; this.z[i] = z;
        this.yaw[i] = 0;
        this.speed01[i] = 0;
        this.flash[i] = 0;
        this.lunge[i] = 0;
        this.submerge[i] = 0;
        this.dissolve[i] = 0;

        const body = this._bodyFor(key);
        this._slotKey[i] = body ? _unitName(key) : null;
        this._slotInst[i] = null;
        if (!body) return;

        const type = this._types.get(body.slug);
        if (!type || type.state !== 1) {
            // Not resident yet. The slot stays used and invisible, and binds
            // itself the moment `_loadType` finishes. `ready(key)` exists so
            // the director can avoid ever reaching this branch.
            return;
        }
        this._bind(i, body);
    }

    /**
     * The roster-aware spawn `enemies.js` PREFERS (enemies.js:844: it probes
     * for this method and only falls back to `spawn(i, u.legacyArch, ...)` —
     * the 0..3 placeholder bucket — when it is absent). Absent was the state
     * the 30-body port shipped in, so every live enemy rendered as one of the
     * first four roster identities (audit 2026-08-10, fatal). The record's
     * combat key routes through the same `_bodyFor` resolution `spawn()`
     * uses, so MESH_REUSE dress-ups keep their tint and scale.
     * @param {number} i pool slot
     * @param {{key:string}} u the UNITS identity record
     * @param {number} x @param {number} y @param {number} z
     * @returns {void}
     */
    spawnUnit(i, u, x, y, z) {
        this.spawn(i, u && u.key ? u.key : 0, x, y, z);
    }

    /**
     * Attach a resident body type to a slot that already wants it.
     * @param {number} i
     * @param {{slug:string, scale:number, tint:string|null}} body
     */
    _bind(i, body) {
        const type = this._types.get(body.slug);
        const inst = this._acquire(type);
        if (!inst) return;

        inst.slot = i;
        this._slotInst[i] = inst;

        // engineScale ALREADY folds the roster's size intent (roster.js:111-120
        // — "multiply the two together and the golem comes out 4.8x"), so it is
        // applied verbatim; `body.scale` on top is only the MESH_REUSE dress-up
        // factor, which is 1 for a body wearing itself.
        inst.root.scale.setScalar(type.unit.engineScale * body.scale);

        const tint = body.tint ? TINT[body.tint] : null;
        if (tint) {
            inst.tint[0] = tint[0]; inst.tint[1] = tint[1]; inst.tint[2] = tint[2];
            inst.state[3] = 1;
        } else {
            inst.tint[0] = 1; inst.tint[1] = 1; inst.tint[2] = 1;
            inst.state[3] = 0;
        }
        inst.state[0] = 0;
        inst.state[1] = 0;
        inst.atk = -1;
        inst.striking = false;
        inst.dying = false;

        if (inst.mixer) {
            inst.targets.fill(0);
            inst.weights.fill(0);
            for (let c = 0; c < inst.acts.length; c++) {
                if (inst.acts[c]) inst.acts[c].setEffectiveWeight(0);
            }
            if (inst.acts[CL_IDLE]) {
                inst.weights[CL_IDLE] = 1;
                inst.targets[CL_IDLE] = 1;
                inst.acts[CL_IDLE].setEffectiveWeight(1);
            }
        }

        inst.root.position.set(this.x[i], this.y[i], this.z[i]);
        inst.root.rotation.y = type.yawFront;
        inst.root.visible = true;
        inst.mesh.visible = true;
        inst.root.updateMatrixWorld(true);
        inst.skeleton.update();
    }

    /**
     * Hide slot `i` and return its body to the type pool. Idempotent, and safe
     * on a slot that was never spawned — enemies.js calls it from four places
     * (`:374`, `:444`, `:458`, `:473`), one of which is a blanket `clear()`.
     * @param {number} i
     * @returns {void}
     */
    free(i) {
        this.used[i] = 0;
        this._slotKey[i] = null;
        const inst = this._slotInst[i];
        if (!inst) return;
        this._slotInst[i] = null;
        inst.slot = -1;
        inst.live = 0;
        // One flag hides the beauty mesh, its cascade proxy and its prepass
        // proxy (shadows.js:583-584, depthPass.js:258).
        inst.mesh.visible = false;
        inst.root.visible = false;
        inst.type.free.push(inst);
    }

    /**
     * Per-frame body state, written by enemies.js. Pure SoA writes — no Three
     * object is touched here, exactly as enemyVis.js:385-391.
     * @param {number} i @param {number} x @param {number} y @param {number} z
     * @param {number} yaw port-frame facing (forward = (sin f, 0, −cos f))
     * @param {number} speed01 locomotion 0..1  @param {number} flash windup 0..1
     * @param {number} lunge strike thrust 0..1 @param {number} submerge 0..1
     * @param {number} dissolve death 0..1
     * @returns {void}
     */
    drive(i, x, y, z, yaw, speed01, flash, lunge, submerge, dissolve) {
        this.x[i] = x; this.y[i] = y; this.z[i] = z;
        this.yaw[i] = yaw;
        this.speed01[i] = speed01;
        this.flash[i] = flash;
        this.lunge[i] = lunge;
        this.submerge[i] = submerge;
        this.dissolve[i] = dissolve;
    }

    /**
     * Position one projectile bolt, or hide it.
     * @param {number} b @param {number} x @param {number} y @param {number} z
     * @param {boolean} on
     * @returns {void}
     */
    driveBolt(b, x, y, z, on) {
        const m = this._boltMeshes[b];
        m.visible = on;
        if (on) {
            m.position.set(x, y, z);
            m.rotation.y = this._time * 9 + b;
        }
    }

    /**
     * Apply the driven state: root transforms, clip weights, mixers, skeletons.
     *
     * Called once per frame at the END of `enemies.update` (enemies.js:401),
     * which main.js:655 runs AFTER `shadows.update` (:645) and AFTER
     * `spells.update` (:649) — so the shared globals hold this frame's camera —
     * and BEFORE `drawFrame()` (:687). That ordering is what makes the sequence
     * below legal, and the sequence itself is NOT negotiable
     * (MESH_ENEMY_CONTRACT §4.2.3, meshChar.js:636-662):
     *
     *   (a) write the root transform from the SoA
     *   (b) mixer.update(dt)
     *   (c) root.updateMatrixWorld(true)
     *   (d) skeleton.update()
     *
     * (d) has to happen here rather than being left to the renderer because the
     * frame's FIRST consumers are the shadow cascades, whose proxy scenes
     * contain no SkinnedMesh, so Three never refreshes the skeleton for them
     * (meshChar.js:76-80). A skeleton left to the beauty pass would cast last
     * frame's pose.
     *
     * @param {number} dt seconds; enemies.js never calls this at 0
     * @returns {void}
     */
    update(dt) {
        this._time += dt;
        this._frame++;

        const cam = this.globals.uCameraPos ? this.globals.uCameraPos.value : null;
        const vp = this.globals.uViewProj ? this.globals.uViewProj.value : null;
        if (vp) _frustum.setFromProjectionMatrix(vp);

        const budget = MIXER_BUDGET[S.preset] || 8;
        let stepped = 0;
        let visible = 0;
        let pending = 0;

        // The round-robin start point, so a pool larger than the budget shares
        // the mixer time out evenly instead of starving the tail slots.
        const start = this._mixCursor;
        for (let n = 0; n < SLOT_MAX; n++) {
            const i = (start + n) % SLOT_MAX;
            if (!this.used[i]) continue;
            const inst = this._slotInst[i];
            if (!inst) { pending++; continue; }
            const type = inst.type;

            // ---- (a) root transform ------------------------------------------
            const yaw = this.yaw[i];
            const fx = Math.sin(yaw);
            const fz = -Math.cos(yaw);
            const h = type.heightM;
            const lungeM = this.lunge[i] * h * 0.35;
            const sink = this.submerge[i] * h * 0.75;
            // The corpse settles into the drift over the LAST 40% of the death,
            // so the death clip plays out on the surface first. Root motion, so
            // the cascade and prepass follow through the same bone matrices —
            // which is the whole reason death is not an alpha dissolve.
            const dSink = Math.max(0, (this.dissolve[i] - 0.6) / 0.4) * h * 0.45;

            const root = inst.root;
            root.position.set(
                this.x[i] + fx * lungeM,
                this.y[i] - sink - dSink,
                this.z[i] + fz * lungeM
            );
            // Port frame: forward at facing f is (sin f, 0, −cos f), and
            // R_y(yawFront − f) maps the model's measured front onto it. For a
            // +Z-front mixamorig body yawFront is PI, i.e. meshChar.js:653.
            root.rotation.y = type.yawFront - yaw;

            // ---- visibility: distance + frustum, one flag for three passes ----
            let dist = 0;
            if (cam) {
                const ddx = this.x[i] - cam.x;
                const ddy = this.y[i] - cam.y;
                const ddz = this.z[i] - cam.z;
                dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            }
            let show = dist <= SPLITS[2];
            // Frustum culling only beyond 30 m: inside that band a body just
            // off-screen can still cast into cascade 0 (which reaches 26 m,
            // shadows.js:104), and hiding it would delete a shadow the player
            // can see. Past the cascade there is nothing left to lose.
            if (show && vp && dist > 30) {
                _sphere.center.set(this.x[i], this.y[i] + h * 0.5, this.z[i]);
                _sphere.radius = h;
                show = _frustum.intersectsSphere(_sphere);
            }
            inst.mesh.visible = show;
            root.visible = show;
            if (!show) continue;
            visible++;

            // ---- (b) clips + mixer --------------------------------------------
            if (inst.mixer) {
                // Rungs, tied to the cascade splits because they are the
                // engine's own statement of where detail stops mattering
                // (shadows.js:20-22).
                let step = 0;
                if (dist < SPLITS[0]) step = 1;
                else if (dist < SPLITS[1]) step = (this._frame & 1) === inst.parity ? 2 : 0;
                if (step && stepped >= budget) step = 0;

                if (step) {
                    this._clips(inst, i, dt * step);
                    inst.mixer.update(dt * step);
                    stepped++;
                }
            }

            // ---- per-draw box -------------------------------------------------
            inst.state[0] = this.flash[i];
            inst.state[1] = this.dissolve[i];

            // ---- (c) + (d) ------------------------------------------------------
            root.updateMatrixWorld(true);
            inst.skeleton.update();
        }
        this._mixCursor = (this._mixCursor + 1) % SLOT_MAX;

        // Bolts spin off the shared clock; `_time` only advances in here, so a
        // frozen game is pixel-stable (enemies.js:391 never calls us at dt 0).
        for (let b = 0; b < BOLT_MAX; b++) {
            const m = this._boltMeshes[b];
            if (m.visible) m.rotation.y = this._time * 9 + b;
        }

        // S-driven shading refresh, as enemyVis.js:433-434 and terrain.js:449-453.
        this._shading.sssStrength.value = S.sssStrength;
        this._shading.sssRadius.value = S.sssRadius;
        this._shading.glintIntensity.value = S.glintIntensity;
        this._shading.glintGrazing.value = S.glintGrazing;

        this.stats.visible = visible;
        this.stats.mixersStepped = stepped;
        this.stats.pending = pending;
    }

    /**
     * One frame of clip selection and weight ramping for one instance. See the
     * header §3 for the channel table this implements. No allocation: `targets`
     * and `weights` are typed arrays built with the instance, and `fill` on a
     * TypedArray writes in place.
     *
     * @param {any} inst
     * @param {number} i slot
     * @param {number} dt effective seconds (already scaled by the LOD rung)
     */
    _clips(inst, i, dt) {
        const acts = inst.acts;
        const t = inst.targets;
        const w = inst.weights;
        t.fill(0);

        const dissolve = this.dissolve[i];
        let fade = FADE;

        if (dissolve > 0) {
            // Death owns the body outright, and enters fast — a corpse that
            // crossfades slowly out of a run looks like it changed its mind.
            if (!inst.dying) {
                // The death EDGE: restart the one-shot from frame 0. Without
                // this the action is already finished-and-clamped (see the
                // `dying` field note) and the ramp shows the final pose only.
                inst.dying = true;
                if (acts[CL_DEATH]) acts[CL_DEATH].reset();
            }
            if (acts[CL_DEATH]) t[CL_DEATH] = 1;
            fade = FADE_DEATH;
            if (inst.atk >= 0) { inst.atk = -1; inst.striking = false; }
        } else {
            inst.dying = false;
            // ---- locomotion: a continuous two-way blend ---------------------
            const s = this.speed01[i];
            let wIdle = 0, wWalk = 0, wRun = 0;
            if (s <= SPEED_WALK) {
                wIdle = 1;
            } else if (s < SPEED_RUN) {
                const k = (s - SPEED_WALK) / (SPEED_RUN - SPEED_WALK);
                wIdle = 1 - k; wWalk = k;
            } else {
                const k = Math.min(1, (s - SPEED_RUN) / (1 - SPEED_RUN));
                wWalk = 1 - k; wRun = k;
            }

            // ---- the attack layer -------------------------------------------
            const flash = this.flash[i];
            const lunge = this.lunge[i];
            const wantAtk = flash > 0.001 || lunge > 0.001;
            if (wantAtk && inst.atk < 0) {
                // Deterministic round-robin over the role's attack slots —
                // never Math.random (meshChar.js:328-330: the harnesses depend
                // on repeatable frames).
                const n = acts.length - CL_ATTACK0;
                if (n > 0) {
                    let pick = -1;
                    for (let k = 0; k < n; k++) {
                        const c = CL_ATTACK0 + ((inst.seq + k) % n);
                        if (acts[c]) { pick = c; break; }
                    }
                    inst.seq++;
                    if (pick >= 0) {
                        inst.atk = pick;
                        inst.striking = false;
                        const a = acts[pick];
                        a.reset();
                        a.paused = true;
                        a.time = 0;
                    }
                }
            } else if (!wantAtk && inst.atk >= 0) {
                const a = acts[inst.atk];
                a.paused = false;
                inst.atk = -1;
                inst.striking = false;
            }

            if (inst.atk >= 0) {
                const a = acts[inst.atk];
                const dur = a.getClip().duration;
                if (!inst.striking) {
                    if (lunge > 0.02) {
                        // The strike frame: release the scrub and let the
                        // follow-through play at its own rate.
                        inst.striking = true;
                        a.paused = false;
                        a.time = dur * WINDUP_FRAC;
                    } else {
                        // THE TELL. The windup pose is scrubbed in lockstep
                        // with the telegraph ramp enemies.js:610-611 computes
                        // from the row's telegraphMs, so what the player sees
                        // IS the number they are being timed against.
                        a.paused = true;
                        a.time = clamp01(flash) * dur * WINDUP_FRAC;
                    }
                }
                // The attack takes the body over as it commits; the legs keep
                // a fraction of the stride so a moving lunge does not snap.
                const aw = Math.max(clamp01(flash), lunge);
                t[inst.atk] = aw;
                const rest = 1 - aw * 0.85;
                wIdle *= rest; wWalk *= rest; wRun *= rest;
            }

            if (acts[CL_IDLE]) t[CL_IDLE] += wIdle;
            if (acts[CL_WALK]) t[CL_WALK] += wWalk;
            if (acts[CL_RUN]) t[CL_RUN] += wRun;

            // Cadence follows ground speed so the feet track the snow rather
            // than skating, the same lever meshChar.js:903-904 pulls.
            if (acts[CL_WALK]) {
                acts[CL_WALK].setEffectiveTimeScale(
                    Math.max(0.45, Math.min(1.8, s / 0.30)));
            }
            if (acts[CL_RUN]) {
                acts[CL_RUN].setEffectiveTimeScale(
                    Math.max(0.55, Math.min(1.7, s / 0.85)));
            }
        }

        // Manual linear ramps toward the target row — never fadeIn/fadeOut,
        // which build an interpolant per call (meshChar.js:44-47).
        const step = dt / fade;
        for (let c = 0; c < acts.length; c++) {
            const a = acts[c];
            if (!a) continue;
            const cur = w[c];
            const tgt = t[c];
            const nw = cur < tgt ? Math.min(tgt, cur + step)
                                 : Math.max(tgt, cur - step);
            if (nw !== cur) {
                w[c] = nw;
                a.setEffectiveWeight(nw);
            }
        }
    }

    // ====================================================================
    //  Warm-up
    // ====================================================================
    //
    // MESH_ENEMY_CONTRACT §1.7 is blunt about the state of play: EnemyVis's
    // warmUp / finishWarmUp / warmUpMeshes / dispose are NEVER CALLED — the
    // absence search is quoted there — so "the enemy material's program has
    // never been compiled or drawn behind the boot screen. The first enemy
    // spawn in a live session compiles its pipeline mid-frame", which
    // gfx.js:396-403 and shadows.js:606-616 both put at multiple hundreds of
    // milliseconds on the ANGLE/D3D11 backend. These four are written to be
    // called; the exact main.js lines are in this file's PR notes.

    /**
     * Meshes for `gfx.warmUp(...)`, alongside `spells.warmUpMeshes`.
     *
     * A GETTER, not a method — `EnemyVis` declares it as `get warmUpMeshes()`
     * (enemyVis.js:443) and API parity is the contract. Note that
     * `meshChar.warmUpMeshes()` is a METHOD (meshChar.js:1036), so the
     * main.js:537-540 list spreads this one WITHOUT parentheses.
     * @returns {THREE.Object3D[]}
     */
    get warmUpMeshes() {
        const out = [];
        for (let k = 0; k < this._insts.length; k++) out.push(this._insts[k].mesh);
        out.push(this._boltMeshes[0]);
        return out;
    }

    /**
     * Stand one real body and one bolt up behind the boot screen so their
     * pipelines are compiled AND DRAWN before the first player-visible frame.
     * A draw, not just a compile: ANGLE/D3D11 defers the real specialisation
     * until the first draw that binds the VAO (gfx.js:396-403).
     *
     * Slot 0 is used and released by `finishWarmUp`, so nothing synthetic
     * survives into frame one. Safe to call before `load()` resolves — it
     * simply warms the bolt.
     *
     * @param {number} x @param {number} y @param {number} z
     * @returns {void}
     */
    warmUp(x, y, z) {
        this._warm = true;
        // The first resident body type; whichever `load()` blocked on.
        let key = null;
        for (const slug of this._types.keys()) {
            const t = this._types.get(slug);
            if (t && t.state === 1) { key = t.unit.combatKey; break; }
        }
        if (key) {
            this.spawn(0, key, x, y, z);
            this.drive(0, x, y, z, 0, 1, 1, 0, 0, 0);
        }
        this.driveBolt(0, x, y + 1.5, z, true);
        // One pass with a real dt so the mixer poses the body and the skeleton
        // texture holds something other than bind — a bind-pose warm draw still
        // specialises the pipeline, but posing it also exercises the bone
        // texture upload path.
        this.update(1 / 60);
    }

    /**
     * Retire the warm-up body and bolt. Call after the warm frames, next to
     * `spells.finishWarmUp()`.
     * @returns {void}
     */
    finishWarmUp() {
        if (!this._warm) return;
        this._warm = false;
        this.free(0);
        this.driveBolt(0, 0, 0, 0, false);
    }

    /** @returns {void} */
    dispose() {
        for (let k = 0; k < this._insts.length; k++) {
            const inst = this._insts[k];
            if (inst.mixer) inst.mixer.stopAllAction();
            if (inst.root.parent) inst.root.parent.remove(inst.root);
            inst.skeleton.dispose();   // frees this instance's bone texture
        }
        for (const slug of this._types.keys()) {
            const t = this._types.get(slug);
            if (t.geometry) t.geometry.dispose();
            if (t.map) t.map.dispose();
            if (t.material) t.material.dispose();
        }
        for (let b = 0; b < BOLT_MAX; b++) {
            const m = this._boltMeshes[b];
            if (m.parent) m.parent.remove(m);
        }
        this._boltGeo.dispose();
        this.boltMaterial.dispose();
        for (let c = 0; c < this._depthMats.length; c++) this._depthMats[c].dispose();
        if (this._prepassMat) this._prepassMat.dispose();
        if (this._draco) { this._draco.dispose(); this._draco = null; }
    }
}
