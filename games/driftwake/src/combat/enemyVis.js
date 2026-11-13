/**
 * Placeholder enemy bodies — diegetic rime-construct shard creatures.
 *
 * Each enemy is a THREE.Group of 6–10 elongated ice shards orbiting a glowing
 * core, standing in for the Meshy meshes that come later. They are not grey
 * boxes: the shards run a cut-down version of the ice-crystal shading out of
 * `spells/crystals.js` — the same `lib/*` includes, the same shared globals
 * block, the same sky/shadow/spell-light uniforms, the same blended-but-
 * depth-writing state — so a construct standing in the drift is lit by the
 * same sun, shadowed by the same cascades and answered by the same spell
 * lights as the ice the player grows. That is what makes a placeholder read
 * as "a creature of this world" instead of "debug geometry".
 *
 * DRAW CALLS: one BufferGeometry (a hexagonal bipyramid shard) and ONE
 * RawShaderMaterial serve every shard, every core and every projectile bolt.
 * Silhouettes differ per archetype purely by per-child transforms, configured
 * once at spawn:
 *
 *   imp      small spiky cluster (6 shards)     — the swarm chaff
 *   sprite   floating ring of shards (8)        — hovers, slow spin
 *   stalker  low raked crescent (7)             — hugs the powder
 *   brute    massive upright slabs (10)         — a walking moraine
 *
 * Per-draw variation (telegraph flash, dissolve, core glow, seed) rides ONE
 * vec4 uniform written by a shared `onBeforeRender` — the standard
 * shared-material trick: the box's contents change between draws and Three's
 * uniform cache re-uploads exactly the 4 floats. No per-enemy materials, no
 * per-frame closures (the callback is module-scope, bound state lives on the
 * mesh), no allocation anywhere on the frame path.
 *
 * THE TELL: `flash` brightens the core (and faintly rims the shards) through
 * the enemy's windup — this is THE readable telegraph (COMBAT_DESIGN §0
 * pillar 2), driven per frame by enemies.js. Death runs a 1.2 s dissolve —
 * shards retreat into the core, the core flares — while enemies.js throws the
 * physical shatter through the spray pool.
 *
 * POLLED, NOT SUBSCRIBED: `drive()` writes SoA state; `update()` applies it
 * to the Three objects once per frame. NO Three lights anywhere — the shader
 * computes everything from the sun/sky/spell-light uniforms, like every other
 * material in the port.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";

/** Pool sizes — must cover combat/enemies.js (ENEMY_MAX 24, bolt pool 16). */
const SLOT_MAX = 24;
const BOLT_MAX = 16;
/** Shards per construct (max) + 1 core child per group. */
const SHARD_MAX = 10;
const CORE_CHILD = SHARD_MAX;

/** Same receiver constants the crystals use (`spells/crystals.js`). */
const SHADOW_SOFTNESS = 1.3;
const SHADOW_BIAS = 0.012;

const _UP = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();

/** Deterministic 0..1 hash for spawn-time jitter (stable per slot+shard). */
function h01(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
}

// --------------------------------------------------------------- the shaders
//
// The material construction mirrors `spells/crystals.js`: GLSL3
// RawShaderMaterial, `shader()`-resolved includes, uniforms assembled from
// the shared globals + shading block + sky.uniforms + shadow receiver block +
// the spell-light pool. Blended AND depth-writing for the same reason the
// crystals are — overlapping translucent shards must not smear over each
// other in pool order.

const VERT = /* glsl */`
#include "lib/common"

in vec3 position;

uniform mat4 modelMatrix;
uniform vec4 uShardState;   // x flash, y dissolve, z isCore, w seed

out vec4 vWorldH;
out float vSeed;

void main() {
    // Dissolve: shards retreat into the construct the way the crystals
    // retreat into the drift — scaled about their own base point — while the
    // core swells slightly for the final flare.
    float shrink = 1.0 - 0.9 * uShardState.y * (1.0 - uShardState.z);
    float swell = 1.0 + 0.6 * uShardState.y * uShardState.z;
    vec3 P = position * shrink * swell;
    vec4 w = modelMatrix * vec4(P, 1.0);
    vWorldH = vec4(w.xyz, clamp(position.y, 0.0, 1.0));
    vSeed = uShardState.w;
    gl_Position = uViewProj * w;
}
`;

const FRAG = /* glsl */`
#include "lib/noise"
#include "lib/shading"
#include "lib/spellLights"
#include "lib/atmosphere"
#include "lib/shadowLookup"

in vec4 vWorldH;      // xyz world, w fraction up the shard
in float vSeed;

uniform vec4 uShardState;   // x flash, y dissolve, z isCore, w seed

layout(location = 0) out vec4 outColor;

// The crystals' absorption (crystal.glsl.js) — same ice, same blue.
const vec3 ICE_ABSORB = vec3(2.35, 0.60, 0.24);
// The animus colour: pale rime-light.
const vec3 CORE_COL = vec3(0.40, 0.85, 1.0);

void main() {
    vec3 world = vWorldH.xyz;
    float h01 = vWorldH.w;
    float flash = uShardState.x;
    float dissolve = uShardState.y;
    float isCore = uShardState.z;

    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;   // toward the sun

    // Flat facet normal from the derivatives — a shard IS its facets, exactly
    // as the crystal stage argues. The eye-facing flip ports verbatim.
    vec3 dx = dFdx(world);
    vec3 dy = dFdy(world);
    vec3 N = normalize(cross(dx, dy));
    if (dot(N, V) < 0.0) { N = -N; }

    float NdotV = clamp(dot(N, V), 1e-4, 1.0);
    float NdotL = dot(N, L);
    float viewDist = distance(world, uCameraPos);
    float shadow = sunShadow(world, N, viewDist, ign(gl_FragCoord.xy) * TAU);
    vec3 sun = uSunColor;

    // Optical path: thick at the base, long at grazing (crystal.glsl.js).
    float path = clamp(
        (0.20 + 0.35 * (1.0 - h01)) * (0.7 + 2.0 * (1.0 - NdotV)),
        0.02, 1.4
    );
    vec3 transmit = exp(-ICE_ABSORB * path);

    // One refraction sample where the crystals disperse over three: a
    // construct shard is a fraction of a crystal's screen size, and the
    // chromatic split cannot be told apart at a third of the cost.
    vec3 mirror = reflect(-V, N);
    vec3 rd = refract(-V, N, 1.0 / 1.309);
    if (dot(rd, rd) < 0.5) { rd = mirror; }
    vec3 color = textureLod(uSkyLUT, dirToLatLong(rd), 1.1).rgb * transmit;

    // Internal transport — backlit shards glow along their length.
    float through = backScatter(N, L, V, 0.42, 2.2, 1.0);
    vec3 deepTint = mix(vec3(0.42, 0.74, 1.0), vec3(0.86, 0.95, 1.0),
                        exp(-path * 2.5));
    color += sun * INV_PI * deepTint * through * sssStrength * 1.6
           * mix(0.25, 1.0, shadow);
    color += skyIrradiance(N) * INV_PI * deepTint * 0.9;

    // Mirror-at-grazing Fresnel + sun GGX, straight from the crystal stage.
    float rough = 0.08;
    vec3 F = fresnelSchlick(NdotV, vec3(0.021));
    vec3 skyRefl = textureLod(uSkyLUT, dirToLatLong(mirror), rough * 6.0).rgb;
    color = mix(color, skyRefl, F);

    if (NdotL > 0.0) {
        vec3 H = normalize(V + L);
        float D = distributionGGX(clamp(dot(N, H), 0.0, 1.0), rough);
        float Vis = visSmithGGXCorrelated(NdotV, NdotL, rough);
        vec3 Fs = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), vec3(0.021));
        color += sun * D * Vis * Fs * NdotL * shadow;
    }

    // The player's spells light the constructs like they light the ice.
    if (spellLightCount > 0.5) {
        color += spellLightingSurface(
            world, N, V, vec3(0.3, 0.6, 0.85), vec3(0.021), rough, 0.5
        );
    }

    // ---- the animus ---------------------------------------------------------
    // A slow idle pulse keeps the construct readable as alive; the telegraph
    // FLASH is the tell — the core brightens hard through every windup, and
    // the shards catch a faint rim of it. Death flares the core out.
    float pulse = 0.5 + 0.5 * sin(uTime * 3.7 + vSeed * 39.0);
    float glow = isCore * (1.1 + 0.5 * pulse + 5.0 * flash + 2.5 * dissolve)
               + (1.0 - isCore) * (0.12 * pulse + 1.1 * flash)
                 * (0.25 + 0.75 * h01);
    color += CORE_COL * glow;

    // Aerial perspective before the alpha — the crystal stage's order.
    color = aerial(color, world);

    float alpha = clamp(
        0.5 + 0.3 * (1.0 - exp(-path * 2.2)) + 0.25 * (1.0 - NdotV) + isCore,
        0.0, 1.0
    ) * (1.0 - 0.85 * dissolve * (1.0 - isCore));

    outColor = vec4(color, alpha);
}
`;

// ---------------------------------------------------------- shared callbacks
// Module-scope, `this` = the mesh; bound state lives ON the mesh (slot index,
// core flag, seed, owner reference), so one function serves every child with
// zero closures. Runs immediately before each draw — the uniform box's
// contents change per draw and Three re-uploads just those 4 floats.

function _writeShardState(renderer, scene, camera, geometry, material) {
    const u = material.uniforms.uShardState.value;
    const v = this._vis;
    const i = this._slot;
    u[0] = v.flash[i];
    u[1] = v.dissolve[i];
    u[2] = this._core;
    u[3] = this._seed;
}

function _writeBoltState(renderer, scene, camera, geometry, material) {
    const u = material.uniforms.uShardState.value;
    u[0] = 1;            // a bolt is all tell
    u[1] = 0;
    u[2] = 1;            // rendered as pure core-glow
    u[3] = this._seed;
}

// ------------------------------------------------- archetype motion profiles
// Locomotion feel only — combat numbers live in enemies.js / the spec.
// [bobAmp m, bobRate 1/s, hover m, sinkDepth m, lungeLen m, spinRate rad/s]
const PROFILE = [
    [0.04, 7.0, 0.00, 0.9, 0.9, 0.0],   // imp — busy skitter bob
    [0.12, 2.2, 0.95, 0.5, 0.4, 1.2],   // sprite — floating, ring spins
    [0.03, 5.0, 0.00, 1.1, 2.5, 0.0],   // stalker — low, long eruption lunge
    [0.05, 1.6, 0.00, 0.0, 0.6, 0.0],   // brute — ponderous sway
];

export class EnemyVis {
    /**
     * Mirrors `CrystalField`'s construction inputs exactly.
     * @param {THREE.Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {import("../spells/spellLights.js").SpellLights} lights
     * @param {Record<string, {value:any}>} globals `lib/common`'s shared block
     *        (pass `spells.globals` — uViewProj/uCameraPos/uTime stay live)
     */
    constructor(scene, sky, shadows, lights, globals) {
        this.scene = scene;

        this.geometry = buildShardGeometry();

        this._shading = {
            sssStrength: { value: S.sssStrength },
            sssRadius: { value: S.sssRadius },
            glintIntensity: { value: S.glintIntensity },
            glintGrazing: { value: S.glintGrazing },
        };
        /** The per-draw state box every child writes through onBeforeRender. */
        this._stateBox = { value: new Float32Array(4) };

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(VERT),
            fragmentShader: shader(FRAG),
            uniforms: Object.assign(
                {}, globals,
                { uShardState: this._stateBox },
                this._shading,
                sky.uniforms,
                shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
                lights.uniforms
            ),
            // Same state block as the crystals: closed solids whose growing/
            // dissolving triangles get thin — cull nothing, blend over the
            // snow, WRITE depth so shards never smear over each other.
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NormalBlending,
            premultipliedAlpha: false,
        });

        // ------------------------------------------------------ body SoA state
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
        this.phase = new Float32Array(SLOT_MAX);

        // ---------------------------------------------------------- the bodies
        /** @type {THREE.Group[]} */
        this._groups = new Array(SLOT_MAX);
        for (let i = 0; i < SLOT_MAX; i++) {
            const g = new THREE.Group();
            g.visible = false;
            for (let j = 0; j <= SHARD_MAX; j++) {
                const m = new THREE.Mesh(this.geometry, this.material);
                m.matrixAutoUpdate = false;   // static within the group
                m.renderOrder = 1;            // with the terrain/crystals band
                m.visible = false;
                m._vis = this;
                m._slot = i;
                m._core = j === CORE_CHILD ? 1 : 0;
                m._seed = h01(i * 13.7 + j * 3.1);
                m.onBeforeRender = _writeShardState;
                g.add(m);
            }
            scene.add(g);
            this._groups[i] = g;
            this.phase[i] = h01(i * 7.3) * Math.PI * 2;
        }

        // ------------------------------------------------------ the bolt pool
        /** @type {THREE.Mesh[]} */
        this._boltMeshes = new Array(BOLT_MAX);
        for (let b = 0; b < BOLT_MAX; b++) {
            const m = new THREE.Mesh(this.geometry, this.material);
            m.visible = false;
            m.renderOrder = 1;
            m.scale.setScalar(0.12);
            m._seed = h01(200 + b * 5.9);
            m.onBeforeRender = _writeBoltState;
            scene.add(m);
            this._boltMeshes[b] = m;
        }

        this._time = 0;
        this._warm = false;
    }

    // ------------------------------------------------------------ public API

    /**
     * Configure slot `i` as archetype `key` and show it.
     * @param {number} i pool slot (matches enemies.js index)
     * @param {number} key ARCH_* index 0..3
     * @param {number} x @param {number} y @param {number} z
     */
    spawn(i, key, x, y, z) {
        this.used[i] = 1;
        this.key[i] = key;
        this.x[i] = x; this.y[i] = y; this.z[i] = z;
        this.yaw[i] = 0;
        this.speed01[i] = 0;
        this.flash[i] = 0;
        this.lunge[i] = 0;
        this.submerge[i] = 0;
        this.dissolve[i] = 0;
        this._configure(i, key);
        const g = this._groups[i];
        g.position.set(x, y, z);
        g.visible = true;
    }

    /** Hide slot `i` and return it to the pool. @param {number} i */
    free(i) {
        this.used[i] = 0;
        this._groups[i].visible = false;
    }

    /**
     * Per-frame body state, written by enemies.js. Pure SoA writes.
     * @param {number} i @param {number} x @param {number} y @param {number} z
     * @param {number} yaw port-frame facing (forward = (sin f, 0, −cos f))
     * @param {number} speed01 locomotion 0..1  @param {number} flash windup 0..1
     * @param {number} lunge strike thrust 0..1 @param {number} submerge 0..1
     * @param {number} dissolve death 0..1
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
     * Position one projectile bolt (or hide it).
     * @param {number} b @param {number} x @param {number} y @param {number} z
     * @param {boolean} on
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
     * Apply the driven state to the Three objects — bob, hover, lunge, sink.
     * @param {number} dt
     */
    update(dt) {
        this._time += dt;
        const t = this._time;
        for (let i = 0; i < SLOT_MAX; i++) {
            if (!this.used[i]) continue;
            const p = PROFILE[this.key[i]];
            const settle = (1 - this.submerge[i]) * (1 - this.dissolve[i]);
            const bob = Math.sin(t * p[1] + this.phase[i]
                + this.speed01[i] * t * 2) * p[0] * settle;
            const yaw = this.yaw[i] + p[5] * t;
            const fx = Math.sin(this.yaw[i]);
            const fz = -Math.cos(this.yaw[i]);
            const g = this._groups[i];
            g.position.set(
                this.x[i] + fx * this.lunge[i] * p[4],
                this.y[i] + p[2] * settle + bob - this.submerge[i] * p[3],
                this.z[i] + fz * this.lunge[i] * p[4]
            );
            // Port frame: forward (sin f, 0, −cos f) → rotation.y = −yaw.
            g.quaternion.setFromAxisAngle(_UP, -yaw);
        }
        this._shading.sssStrength.value = S.sssStrength;
        this._shading.sssRadius.value = S.sssRadius;
    }

    // -------------------------------------------------------------- warm-up
    // Same argument as CrystalField.warmUp: the blend/depth/format combination
    // only specialises when a triangle goes through it, and the alternative is
    // a first-spawn hitch mid-fight.

    /** Meshes for `gfx.warmUp(...)` — pass alongside spells.warmUpMeshes. */
    get warmUpMeshes() {
        return [this._groups[0], this._boltMeshes[0]];
    }

    /** Stand one construct + one bolt up behind the boot screen. */
    warmUp(x, y, z) {
        this._warm = true;
        this.spawn(0, 3, x, y, z);   // the brute — biggest pipeline coverage
        this.driveBolt(0, x, y + 1.5, z, true);
        this.update(0);
    }

    /** Retire the warm-up bodies before the first player-visible frame. */
    finishWarmUp() {
        if (!this._warm) return;
        this._warm = false;
        this.free(0);
        this.driveBolt(0, 0, 0, 0, false);
    }

    dispose() {
        for (let i = 0; i < SLOT_MAX; i++) {
            const g = this._groups[i];
            if (g.parent) g.parent.remove(g);
        }
        for (let b = 0; b < BOLT_MAX; b++) {
            const m = this._boltMeshes[b];
            if (m.parent) m.parent.remove(m);
        }
        this.geometry.dispose();
        this.material.dispose();
    }

    // ------------------------------------------------------ silhouette build

    /**
     * Set the per-child transforms for archetype `key` in slot `i`. Spawn-time
     * only — children stay static inside the group afterwards.
     * @param {number} i @param {number} key
     */
    _configure(i, key) {
        const g = this._groups[i];
        const kids = g.children;
        let used = 0;

        if (key === 0) {
            // IMP — small spiky cluster: 6 shards radiating up and out of a
            // tight knot, ~0.8 m tall. Chaff that reads as chaff.
            used = 6;
            for (let j = 0; j < used; j++) {
                const m = kids[j];
                const a = (j / used) * Math.PI * 2 + h01(i + j * 1.7) * 0.5;
                m.position.set(Math.cos(a) * 0.12, 0.10, Math.sin(a) * 0.12);
                _e.set(0.55 + h01(j * 2.3 + i) * 0.25, 0, 0);
                _e.y = a + Math.PI * 0.5;
                m.quaternion.setFromEuler(_e);
                m.scale.set(0.06, 0.5 + h01(j * 3.1) * 0.15, 0.06);
                this._finishChild(m);
            }
            this._core(kids, 0, 0.35, 0, 0.09);
        } else if (key === 1) {
            // SPRITE — a floating ring of 8 hanging shards around the core;
            // the group's hover + spin come from PROFILE[1].
            used = 8;
            for (let j = 0; j < used; j++) {
                const m = kids[j];
                const a = (j / used) * Math.PI * 2;
                m.position.set(Math.cos(a) * 0.35, 0.30, Math.sin(a) * 0.35);
                _e.set(Math.PI, a, 0);   // tips down
                m.quaternion.setFromEuler(_e);
                m.scale.set(0.045, 0.32 + h01(j * 5.7 + i) * 0.10, 0.045);
                this._finishChild(m);
            }
            this._core(kids, 0, 0.30, 0, 0.13);
        } else if (key === 2) {
            // STALKER — a low crescent of raked shards, prow forward, barely
            // half a metre tall: the shape that vanishes into powder.
            used = 7;
            for (let j = 0; j < used; j++) {
                const m = kids[j];
                const u = j / (used - 1) - 0.5;          // −0.5..0.5 across
                const a = u * 2.1;                        // crescent arc
                m.position.set(Math.sin(a) * 0.45, 0.06, Math.cos(a) * 0.25 - 0.1);
                _e.set(-1.0, -a * 0.6, 0);               // raked backward
                m.quaternion.setFromEuler(_e);
                const mid = 1 - Math.abs(u) * 1.4;
                m.scale.set(0.07, 0.35 + 0.3 * mid, 0.07);
                this._finishChild(m);
            }
            this._core(kids, 0, 0.30, 0.05, 0.10);
        } else {
            // BRUTE — massive slabs: six around the torso, four at the
            // shoulders, 2.4 m of walking moraine.
            used = 10;
            for (let j = 0; j < 6; j++) {
                const m = kids[j];
                const a = (j / 6) * Math.PI * 2;
                m.position.set(Math.cos(a) * 0.55, 0.25, Math.sin(a) * 0.55);
                _e.set(0.12 + h01(j * 1.3 + i) * 0.1, 0, 0);
                _e.y = a + Math.PI * 0.5;
                m.quaternion.setFromEuler(_e);
                m.scale.set(0.28, 1.5 + h01(j * 2.9) * 0.3, 0.14);
                this._finishChild(m);
            }
            for (let j = 6; j < 10; j++) {
                const m = kids[j];
                const a = ((j - 6) / 4) * Math.PI * 2 + Math.PI * 0.25;
                m.position.set(Math.cos(a) * 0.45, 1.55, Math.sin(a) * 0.45);
                _e.set(0.65, 0, 0);
                _e.y = a + Math.PI * 0.5;
                m.quaternion.setFromEuler(_e);
                m.scale.set(0.20, 0.75, 0.12);
                this._finishChild(m);
            }
            this._core(kids, 0, 1.15, 0, 0.18);
        }

        // Hide the unused shard children; the core child is always last.
        for (let j = used; j < SHARD_MAX; j++) kids[j].visible = false;
    }

    /** Place the core child. */
    _core(kids, x, y, z, s) {
        const m = kids[CORE_CHILD];
        m.position.set(x, y, z);
        m.quaternion.identity();
        m.scale.set(s, s * 1.3, s);
        this._finishChild(m);
    }

    /** @param {THREE.Mesh} m */
    _finishChild(m) {
        m.visible = true;
        m.updateMatrix();
    }
}

/**
 * The one shared shard: a hexagonal bipyramid, base apex at the origin, tip
 * at (0,1,0), ring radius 1 at y 0.3 — an elongated ice splinter. 12 flat
 * triangles; the fragment stage's derivative normals give the facets exactly,
 * so indexing costs nothing visually.
 * @returns {THREE.BufferGeometry}
 */
function buildShardGeometry() {
    const RING = 6;
    const pos = new Float32Array((RING + 2) * 3);
    // v0 = base apex.
    pos[0] = 0; pos[1] = 0; pos[2] = 0;
    for (let k = 0; k < RING; k++) {
        const a = (k / RING) * Math.PI * 2;
        const o = (1 + k) * 3;
        pos[o] = Math.cos(a);
        pos[o + 1] = 0.3;
        pos[o + 2] = Math.sin(a);
    }
    // Tip.
    const tip = (1 + RING) * 3;
    pos[tip] = 0; pos[tip + 1] = 1; pos[tip + 2] = 0;

    const idx = new Uint16Array(RING * 2 * 3);
    let ii = 0;
    for (let k = 0; k < RING; k++) {
        const k2 = (k + 1) % RING;
        // Base fan.
        idx[ii++] = 0; idx[ii++] = 1 + k; idx[ii++] = 1 + k2;
        // Tip fan.
        idx[ii++] = 1 + k; idx[ii++] = 1 + RING; idx[ii++] = 1 + k2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
}
