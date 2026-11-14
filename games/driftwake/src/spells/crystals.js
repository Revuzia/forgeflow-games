/**
 * The ice formations Crystallise grows.
 *
 * A fixed pool of prisms in one data-driven mesh: one draw, one 3 x 96 upload,
 * and no geometry generated at any point. A crystal that is not alive has zero
 * growth, hence zero height, which collapses every one of its eighteen triangles
 * onto its base point — the same switch-off mechanism the water strands use.
 *
 * Lifetime is deliberately long. The spell alters the surface semi-permanently
 * through the ice channel of the terrain state buffer, which decays on a
 * fifteen-minute constant, so a patch of glazed snow is still there long after
 * the geometry has gone. The prisms stand for 34-42 s and then sublimate over
 * 6 s — long enough that the player can walk around a formation and look at it,
 * short enough that a session does not silently fill up with ice.
 *
 * BLENDED AND DEPTH-WRITING. See the note at the top of the crystal fragment
 * stage: it is what gives transparency against the snow without letting forty
 * prisms blend over each other.
 *
 * Allocation per frame: none.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { vertex, fragment, depthVertex, prepassVertexBody } from "../shaders/crystal.glsl.js";
import { PREPASS_VS_VARYINGS, PREPASS_EMIT } from "../shaders/prepass.glsl.js";

/** Pool size. Two full formations' worth. */
export const CRYSTAL_MAX = 96;

/** Vertices per crystal: two rings of six, plus an apex. Matches `lib/crystal`. */
const VERTS = 13;
const RING = 6;

/** How many cascades a 40 cm prism is worth drawing into. */
const CRYSTAL_CASCADES = 2;

/** Seconds a prism takes to retreat back into the drift once its life expires. */
const SUBLIMATE = 6.0;

/** _spec/spells.md §11.2. The water uses 1.4 / 0.03. */
const SHADOW_SOFTNESS = 1.3;
const SHADOW_BIAS = 0.012;

export class CrystalField {
    /**
     * @param {THREE.Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {import("./spellLights.js").SpellLights} lights
     * @param {Record<string, {value:any}>} globals `lib/common`'s shared block
     */
    constructor(scene, sky, shadows, lights, globals) {
        this.scene = scene;
        this.sky = sky;
        this.shadows = shadows;
        this.lights = lights;

        // Rows: (x,y,z,height) / (axis,radius) / (growth, seed, tint, -)
        this._texData = new Float32Array(CRYSTAL_MAX * 3 * 4);
        this.dataTex = new THREE.DataTexture(
            this._texData, CRYSTAL_MAX, 3, THREE.RGBAFormat, THREE.FloatType
        );
        this.dataTex.internalFormat = "RGBA32F";
        this.dataTex.minFilter = THREE.NearestFilter;
        this.dataTex.magFilter = THREE.NearestFilter;
        this.dataTex.wrapS = THREE.ClampToEdgeWrapping;
        this.dataTex.wrapT = THREE.ClampToEdgeWrapping;
        this.dataTex.generateMipmaps = false;
        this.dataTex.flipY = false;
        this.dataTex.needsUpdate = true;

        // CPU-side lifetime. Kept out of the texture because no shader reads any
        // of it and packing it there would mean re-uploading merely to age.
        this.age = new Float32Array(CRYSTAL_MAX);
        this.life = new Float32Array(CRYSTAL_MAX);
        /** Seconds the crystal spends growing from nothing to full size. */
        this.grow = new Float32Array(CRYSTAL_MAX);
        this.alive = new Uint8Array(CRYSTAL_MAX);
        this._next = 0;
        this.liveCount = 0;

        this.geometry = buildMesh();

        this._shading = {
            sssStrength: { value: S.sssStrength },
            sssRadius: { value: S.sssRadius },
            glintIntensity: { value: S.glintIntensity },
            glintGrazing: { value: S.glintGrazing },
        };
        this._crystalTex = { value: this.dataTex };

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            uniforms: Object.assign(
                {}, globals,
                { crystalTex: this._crystalTex },
                this._shading,
                sky.uniforms,
                shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
                lights.uniforms
            ),
            // A prism is a closed solid, but a dead crystal's triangles are
            // degenerate and a growing one is very thin — culling buys nothing and
            // costs a black inside face wherever the winding flips.
            side: THREE.DoubleSide,
            // Blended AND depth-writing. Babylon: alphaMode ALPHA_COMBINE with
            // forceDepthWrite; Three: transparent with depthWrite left on.
            transparent: true,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NormalBlending,
            premultipliedAlpha: false,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "iceCrystals";
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        // The reference's renderingGroupId 1 — with the terrain, ahead of the
        // water and the spray.
        this.mesh.renderOrder = 1;
        this.mesh.visible = false;
        scene.add(this.mesh);

        // ------------------------------------------------------ shadow casters
        // The identical crystalPoint(), growth curve included, so the shadow grows
        // with the crystal rather than snapping to full size when it is planted.
        /** @type {THREE.RawShaderMaterial[]} */
        this._depthMats = [];
        shadows.registerCaster(this.mesh, (c) => {
            const m = shadows.makeCasterMaterial(
                depthVertex,
                { crystalTex: this._crystalTex },
                { defines: { CRYSTAL_CASCADE: c } }
            );
            this._depthMats.push(m);
            return m;
        }, CRYSTAL_CASCADES);

        /** @type {THREE.RawShaderMaterial|null} */
        this.prepassMaterial = null;
        this._dirty = true;
    }

    /**
     * Register with the depth prepass.
     *
     * ONLY the crystals. The water body is deliberately left out: it is
     * translucent and refractive, so a depth for it would tell every screen-space
     * consumer that the snow behind it is not there — exactly wrong for a medium
     * you can see through.
     *
     * This is also the one caster in the project that writes a non-zero specular
     * mask, and the only reason the mask channel exists: ice is the sole mirror in
     * a field of matte snow, so the SSR pass can early-out on it and cost nothing
     * on every frame where nobody has cast Crystallise.
     *
     * @param {import("../render/depthPass.js").DepthPass} depth
     */
    registerPrepass(depth) {
        if (this.prepassMaterial) return;
        this.prepassMaterial = depth.makeCasterMaterial(
            PREPASS_VS_VARYINGS + PREPASS_EMIT + prepassVertexBody,
            { crystalTex: this._crystalTex }
        );
        depth.registerCaster(this.mesh, this.prepassMaterial);
    }

    /**
     * Plant one crystal.
     *
     * @param {number} x @param {number} y @param {number} z base, world
     * @param {number} ax @param {number} ay @param {number} az growth axis
     * @param {number} height metres at full growth
     * @param {number} radius metres at full growth
     * @param {number} growSeconds time from nothing to full size
     * @param {number} life seconds before it starts sublimating
     */
    plant(x, y, z, ax, ay, az, height, radius, growSeconds, life) {
        let i = this._next;
        for (let n = 0; n < CRYSTAL_MAX; n++) {
            if (!this.alive[i]) break;
            i = (i + 1) % CRYSTAL_MAX;
            // Pool full: DROP the new crystal. Hunting for the oldest formation
            // costs more than it is worth, and losing one prism out of a cluster
            // of forty is invisible.
            if (n === CRYSTAL_MAX - 1) return;
        }
        this._next = (i + 1) % CRYSTAL_MAX;

        const d = this._texData;
        const w = CRYSTAL_MAX * 4;
        let o = i * 4;
        d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = height;
        o += w;
        d[o] = ax; d[o + 1] = ay; d[o + 2] = az; d[o + 3] = radius;
        o += w;
        // 0.618034 is the golden-ratio conjugate: it decorrelates the per-crystal
        // hexagon wobble between adjacent pool slots. JS '%' is fmod, so a
        // negative world x or z gives a negative seed — that is harmless (the
        // shader only feeds it into hash21/hash22, which fract internally, and
        // into a rotation) and "fixing" it with Math.abs would make formations
        // differ from the reference.
        d[o] = 0;
        d[o + 1] = (i * 0.618034 + x * 0.137 + z * 0.311) % 1;
        d[o + 2] = 0;
        d[o + 3] = 0;

        this.age[i] = 0;
        this.life[i] = life;
        this.grow[i] = Math.max(growSeconds, 0.05);
        this.alive[i] = 1;
        this._dirty = true;
    }

    /**
     * Age the field and upload.
     * @param {number} dt
     * @param {THREE.Vector3} cameraPos
     */
    update(dt, cameraPos) {
        const d = this._texData;
        const w = CRYSTAL_MAX * 4;
        const growRow = w * 2;
        let live = 0;

        for (let i = 0; i < CRYSTAL_MAX; i++) {
            if (!this.alive[i]) continue;
            this.age[i] += dt;
            const a = this.age[i];
            const life = this.life[i];

            let g;
            if (a < this.grow[i]) {
                g = a / this.grow[i];
            } else if (a < life) {
                g = 1;
            } else {
                // Sublimation: the prism RETREATS rather than fading, so it goes
                // back into the drift it came out of. Nothing here pops.
                const t = (a - life) / SUBLIMATE;
                if (t >= 1) {
                    this.alive[i] = 0;
                    d[growRow + i * 4] = 0;
                    this._dirty = true;
                    continue;
                }
                g = 1 - t;
            }

            d[growRow + i * 4] = g;
            live++;
        }

        this.liveCount = live;
        this.mesh.visible = live > 0 && S.showSpells !== false;

        if (this.mesh.visible || this._dirty) {
            this.dataTex.needsUpdate = true;
            this._dirty = false;
        }
        if (this.mesh.visible) this._pushUniforms();
    }

    _pushUniforms() {
        const sh = this._shading;
        sh.sssStrength.value = S.sssStrength;
        sh.sssRadius.value = S.sssRadius;
        sh.glintIntensity.value = S.glintIntensity;
        sh.glintGrazing.value = S.glintGrazing;
    }

    get triangles() {
        return this.mesh.visible ? this.liveCount * (RING * 3) : 0;
    }

    /**
     * Plant one crystal and LEAVE IT STANDING through the warm-up frames.
     *
     * Same reasoning as `WaterBody.warmUp`: compiling the program is not the same
     * as specialising the pipeline, and the blend/depth/target-format combination
     * only binds when a triangle goes through it. Hiding the mesh here moved a
     * measured 156 ms hitch onto the first cast.
     *
     * `update(0.21, ...)` advances past the 0.2 s grow window so what stands is a
     * real prism rather than a degenerate one.
     */
    warmUp(x, y, z) {
        this.plant(x, y + 0.02, z, 0.1, 1, 0.05, 0.6, 0.09, 0.2, 999);
        this.update(0.21, null);
        this.mesh.visible = true;
        this._pushUniforms();
    }

    /**
     * Retire the warm-up crystal, after the warm-up frames have drawn it. It must
     * not be standing in the first frame the player sees.
     */
    finishWarmUp() {
        for (let i = 0; i < CRYSTAL_MAX; i++) this.alive[i] = 0;
        this._texData.fill(0);
        this.dataTex.needsUpdate = true;
        this.liveCount = 0;
        this._next = 0;
        this.mesh.visible = false;
    }

    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.geometry.dispose();
        this.material.dispose();
        for (let i = 0; i < this._depthMats.length; i++) this._depthMats[i].dispose();
        if (this.prepassMaterial) this.prepassMaterial.dispose();
        this.dataTex.dispose();
    }
}

/**
 * Static lattice: `position` is (crystalIndex, vertexIndex, 0).
 *
 * Six side quads and six tip triangles = 18 triangles per crystal, 1,728 in the
 * pool, 1,248 vertices, one draw.
 */
function buildMesh() {
    const pos = new Float32Array(CRYSTAL_MAX * VERTS * 3);
    const idx = new Uint32Array(CRYSTAL_MAX * RING * 3 * 3);

    let vi = 0;
    let ii = 0;
    for (let i = 0; i < CRYSTAL_MAX; i++) {
        for (let v = 0; v < VERTS; v++) {
            pos[vi++] = i;
            pos[vi++] = v;
            pos[vi++] = 0;
        }
        const b = i * VERTS;
        for (let k = 0; k < RING; k++) {
            const k2 = (k + 1) % RING;
            const b0 = b + k;
            const b1 = b + k2;
            const s0 = b + RING + k;
            const s1 = b + RING + k2;
            const apex = b + RING * 2;
            // Side quad.
            idx[ii++] = b0; idx[ii++] = s0; idx[ii++] = s1;
            idx[ii++] = b0; idx[ii++] = s1; idx[ii++] = b1;
            // Tip.
            idx[ii++] = s0; idx[ii++] = apex; idx[ii++] = s1;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}
