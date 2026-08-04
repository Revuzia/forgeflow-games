/**
 * The bent-water renderer — one mesh, one material, one draw, eight strands.
 *
 * Four of the five spells move a coherent body of water, and they are all the
 * same object: a swept surface along a spine, with a radius, a transported frame
 * and a foam channel. Giving each spell its own mesh would mean four pipelines,
 * four warm-ups, four sets of shadow-and-fog uniforms, and four slightly
 * different ideas about what lit water looks like. There is one of each here.
 *
 * A strand is claimed with `acquire()`, written per frame with `column()`, and
 * dropped with `release()`. Releasing zeroes the strand's rows, which is also how
 * it is switched off: a zero radius puts every vertex of that strand on one
 * point, so its triangles have no area and the rasteriser skips them. **The draw
 * call and the vertex count therefore do not depend on how many spells are up** —
 * _spec/spells.md §16 criterion 22 is exactly this.
 *
 * The frame is parallel-transported along the spine on the CPU rather than
 * rebuilt from a fixed up-vector. A ribbon drawn through the air passes through
 * vertical, and a Frenet or up-referenced frame flips there — the section spins
 * 180 degrees in one sample and the ribbon visibly folds. Transport has no such
 * degeneracy.
 *
 * Allocation per frame: none.
 */

import * as THREE from "three";

import { S } from "../core/settings.js";
import { shader } from "../core/glsl.js";
import { vertex, fragment } from "../shaders/water.glsl.js";

/** Must match `strandParams[8]` in the water vertex stage. */
export const STRAND_MAX = 8;

/**
 * Spine *samples* per strand — the width of the data texture, and the most
 * columns any spell may write.
 *
 * Raised from 48 for the Vortex, whose helices are the tightest curve anything
 * here draws. A cubic through samples on a circular arc carries a radial error
 * that is zero at every knot and peaks in the middle of each span — exactly a
 * scallop per sample, and on a 12 cm tube wound round a 2.5 m helix at thirty
 * samples a turn it was a tenth of the radius. The helices came out looking like
 * vertebrae. The error falls with the square of the sample spacing, so sixty-four
 * takes it under a percent.
 */
export const STRAND_COLS = 64;

/**
 * Spine *vertices* per strand — the width of the lattice.
 *
 * Decoupled from the sample count, and it has to be. The surface is a spline
 * through the samples, so it has real curvature between them; drawing it at
 * barely more than one vertex per sample renders that curvature as a polygon and
 * the body comes out visibly segmented — the thing that makes a swept tube look
 * like a length of pipe rather than like moving water. Nearly three vertices per
 * sample is where the segmentation stops being findable.
 */
const LATTICE_COLS = 176;

/**
 * Vertices around the section.
 *
 * The last one coincides with the first — a tube is closed, so ring 23 sits one
 * step short of theta = 2*PI and the quad to ring 0 closes it. Duplicating the
 * seam vertex rather than wrapping the index is what lets the same lattice serve
 * the open sheet profile, where the last ring is genuinely the far edge.
 *
 * Twenty-four rather than twelve. A twelve-sided tube seen at two metres has a
 * readable dodecagonal silhouette, and once you have noticed it you cannot stop.
 * It also caps how much detail the relief field may put *around* the section —
 * and detail around the section, rather than along it, is exactly what stops a
 * tube reading as a string of beads.
 */
const RING = 24;

export const PROFILE_TUBE = 0;
export const PROFILE_SHEET = 1;

/** Per-material shadow filter, _spec/spells.md §3.8. Ice uses 1.3 / 0.012. */
const SHADOW_SOFTNESS = 1.4;
const SHADOW_BIAS = 0.03;

export class WaterBody {
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

        // Three rows per strand: (pos, radius) / (right, twist) / (dist, age, foam, flatten)
        this._texData = new Float32Array(STRAND_COLS * STRAND_MAX * 3 * 4);
        this.dataTex = new THREE.DataTexture(
            this._texData, STRAND_COLS, STRAND_MAX * 3,
            THREE.RGBAFormat, THREE.FloatType
        );
        // RGBA32F sampling is core in WebGL2 as long as it is never FILTERED, and
        // every read is a texelFetch. No extension is required, and none is asked
        // for. (OES_texture_float_linear would only be needed for LINEAR.)
        this.dataTex.internalFormat = "RGBA32F";
        this.dataTex.minFilter = THREE.NearestFilter;
        this.dataTex.magFilter = THREE.NearestFilter;
        this.dataTex.wrapS = THREE.ClampToEdgeWrapping;
        this.dataTex.wrapT = THREE.ClampToEdgeWrapping;
        this.dataTex.generateMipmaps = false;
        // DataTexture defaults flipY false, which is what makes row 3s+n in the
        // array land on texel row 3s+n. Stated rather than assumed.
        this.dataTex.flipY = false;
        this.dataTex.needsUpdate = true;

        /** (profile, milkiness, alpha, column count) per strand. */
        this._params = new Float32Array(STRAND_MAX * 4);
        /** @type {boolean[]} */
        this._used = new Array(STRAND_MAX).fill(false);

        this.geometry = buildLattice();
        this.triangleCount = this.geometry.getIndex().count / 3;

        /** This material's own copies of `lib/shading`'s uniform block. */
        this._shading = {
            sssStrength: { value: S.sssStrength },
            sssRadius: { value: S.sssRadius },
            glintIntensity: { value: S.glintIntensity },
            glintGrazing: { value: S.glintGrazing },
        };
        this._own = {
            waterTex: { value: this.dataTex },
            waterCols: { value: LATTICE_COLS },
            waterRings: { value: RING },
            waterTime: { value: 0 },
            strandParams: { value: this._params },
            waterDepthTint: { value: S.waterDepthTint },
        };

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(vertex),
            fragmentShader: shader(fragment),
            uniforms: Object.assign(
                {}, globals, this._own, this._shading,
                sky.uniforms,
                shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
                lights.uniforms
            ),
            // A transparent body seen from BOTH sides — looking through the near
            // wall at the far one is most of what makes it read as a volume.
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
            premultipliedAlpha: false,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = "spellWater";
        // The bounding box computed from index values is meaningless — `position`
        // is (column, ring, strand), not a coordinate.
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        // With the spray, after the opaque pass. Water FIRST within the group:
        // mist hanging in front of a body of water is much commoner than the
        // reverse, and neither writes depth. (Babylon: renderingGroupId 2,
        // alphaIndex 0.)
        this.mesh.renderOrder = 2;
        this.mesh.visible = false;
        scene.add(this.mesh);

        this._t = 0;
        this._live = 0;
    }

    // ------------------------------------------------------------ strand pool

    /** @returns {number} strand index, or -1 when the pool is exhausted. */
    acquire() {
        for (let i = 0; i < STRAND_MAX; i++) {
            if (!this._used[i]) {
                this._used[i] = true;
                this.clear(i);
                return i;
            }
        }
        return -1;
    }

    /** @param {number} s */
    release(s) {
        if (s < 0 || s >= STRAND_MAX) return;
        this._used[s] = false;
        this.clear(s);
    }

    /** Zero a strand's rows and parameters. */
    clear(s) {
        const d = this._texData;
        const base = s * 3 * STRAND_COLS * 4;
        d.fill(0, base, base + STRAND_COLS * 3 * 4);
        const p = s * 4;
        this._params[p] = 0;
        this._params[p + 1] = 0;
        this._params[p + 2] = 0;
        this._params[p + 3] = 0;
    }

    /**
     * Per-strand constants for this frame.
     * @param {number} s
     * @param {number} profile PROFILE_TUBE or PROFILE_SHEET
     * @param {number} milkiness 0 clear water, 1 opaque slush
     * @param {number} alpha global fade, 0 hides the strand
     * @param {number} count live columns, 2..STRAND_COLS
     */
    setParams(s, profile, milkiness, alpha, count) {
        const p = s * 4;
        this._params[p] = profile;
        this._params[p + 1] = milkiness;
        this._params[p + 2] = alpha;
        this._params[p + 3] = count < 2 ? 0 : Math.min(count, STRAND_COLS);
    }

    /**
     * Write one spine sample.
     *
     * `rx/ry/rz` is the reference right vector; it does not have to be exactly
     * perpendicular to the tangent, since the shader re-orthogonalises. It does
     * have to be *transported* — see the note at the top of the file.
     *
     * `radius` must taper to ~0 at both ends of any strand, or the tube shows an
     * open section as a disc of backface.
     *
     * @param {number} s strand
     * @param {number} c column, 0 = head / leading edge, always
     * @param {number} x @param {number} y @param {number} z world position
     * @param {number} radius metres
     * @param {number} rx @param {number} ry @param {number} rz reference right
     * @param {number} twist section roll (tube) or curl (sheet)
     * @param {number} dist metres along the spine
     * @param {number} age 0..1
     * @param {number} foam 0..1
     * @param {number} flatten vertical squash of the section, 1 = round
     */
    column(s, c, x, y, z, radius, rx, ry, rz, twist, dist, age, foam, flatten) {
        if (c < 0 || c >= STRAND_COLS) return;
        const d = this._texData;
        const row = s * 3;
        const w = STRAND_COLS * 4;
        let o = row * w + c * 4;
        d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = radius;
        o += w;
        d[o] = rx; d[o + 1] = ry; d[o + 2] = rz; d[o + 3] = twist;
        o += w;
        d[o] = dist; d[o + 1] = age; d[o + 2] = foam; d[o + 3] = flatten;
    }

    // ---------------------------------------------------------------- frame

    /**
     * Upload and push uniforms. Called after every spell has written its strands.
     * @param {number} dt
     * @param {THREE.Vector3} cameraPos
     */
    update(dt, cameraPos) {
        this._t += dt;

        let live = 0;
        for (let i = 0; i < STRAND_MAX; i++) {
            if (this._params[i * 4 + 2] > 0.003 && this._params[i * 4 + 3] >= 2) live++;
        }
        this._live = live;

        this.mesh.visible = live > 0 && S.showSpells !== false;
        if (!this.mesh.visible) return;

        // One 24 KB upload. Three re-uploads the whole DataTexture on this flag,
        // which is the equivalent of Babylon's RawTexture.update(array).
        this.dataTex.needsUpdate = true;
        this._pushUniforms();
    }

    _pushUniforms() {
        const o = this._own;
        o.waterTime.value = this._t;
        o.waterDepthTint.value = S.waterDepthTint;

        const sh = this._shading;
        sh.sssStrength.value = S.sssStrength;
        sh.sssRadius.value = S.sssRadius;
        sh.glintIntensity.value = S.glintIntensity;
        sh.glintGrazing.value = S.glintGrazing;
    }

    /** Live strand count, for the overlay. */
    get liveStrands() {
        return this._live;
    }

    /** Triangles the overlay should attribute to this system. */
    get triangles() {
        return this.mesh.visible ? (this._live / STRAND_MAX) * this.triangleCount : 0;
    }

    /**
     * Lay two synthetic strands and LEAVE THEM STANDING through the warm-up
     * frames; `finishWarmUp()` takes them down afterwards.
     *
     * Leaving them up is the whole point. Compiling the program is not the same
     * as specialising the pipeline: the blend state, the depth state, the cull
     * mode and the target formats only bind when a triangle actually goes through
     * it, and on the ANGLE/D3D11 backend the harness runs that specialisation is
     * deferred to the first real draw. Hiding the mesh here moved a ~250 ms
     * freeze onto the first cast.
     *
     * Both profiles are exercised, because they are genuinely different code
     * paths through one vertex shader and only one of them being covered is how a
     * warm-up quietly stops covering half of what it claims to.
     */
    warmUp(x, y, z) {
        for (let c = 0; c < 24; c++) {
            const t = c / 23;
            this.column(
                0, c, x + t * 3, y + 1.2 + Math.sin(t * 3) * 0.5, z,
                0.22 * Math.sin(t * Math.PI),
                0, 0, 1, 0, t * 3, t, t < 0.2 ? 1 : 0, 1
            );
        }
        this.setParams(0, PROFILE_TUBE, 0.2, 1, 24);

        for (let c = 0; c < 24; c++) {
            const t = c / 23;
            this.column(
                1, c, x + t * 4 - 2, y, z + 2,
                0.5 * Math.sin(t * Math.PI),
                0, 0, 1, 0.6, t * 4, t, 0.4, 1
            );
        }
        this.setParams(1, PROFILE_SHEET, 0.6, 1, 24);

        this.dataTex.needsUpdate = true;
        this.mesh.visible = true;
        this._pushUniforms();
    }

    /** Take the synthetic strands down, after the warm-up frames have drawn. */
    finishWarmUp() {
        this.clear(0);
        this.clear(1);
        this.dataTex.needsUpdate = true;
        this.mesh.visible = false;
    }

    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.geometry.dispose();
        this.material.dispose();
        this.dataTex.dispose();
    }
}

/**
 * The static lattice: `position` is (column, ring, strand) and carries no
 * geometry at all.
 *
 * Strands are separate index ranges in ONE buffer rather than separate meshes, so
 * the whole system is a single draw however many spells are up.
 *
 * 176 * 24 = 4,224 vertices per strand; 33,792 vertices and 64,400 triangles in
 * total. Uint32 indices are core in WebGL2.
 */
function buildLattice() {
    const perStrand = LATTICE_COLS * RING;
    const pos = new Float32Array(perStrand * STRAND_MAX * 3);
    const idx = new Uint32Array((LATTICE_COLS - 1) * (RING - 1) * 6 * STRAND_MAX);

    let vi = 0;
    let ii = 0;
    for (let s = 0; s < STRAND_MAX; s++) {
        const base = s * perStrand;
        for (let c = 0; c < LATTICE_COLS; c++) {
            for (let r = 0; r < RING; r++) {
                pos[vi++] = c;
                pos[vi++] = r;
                pos[vi++] = s;
            }
        }
        for (let c = 0; c < LATTICE_COLS - 1; c++) {
            for (let r = 0; r < RING - 1; r++) {
                const a = base + c * RING + r;
                const b = a + RING;
                idx[ii++] = a; idx[ii++] = b; idx[ii++] = b + 1;
                idx[ii++] = a; idx[ii++] = b + 1; idx[ii++] = a + 1;
            }
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // Never call computeBoundingSphere(): Three would happily fit a sphere around
    // (0..175, 0..23, 0..7) and cull the mesh the moment the camera leaves the
    // world origin.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}
