/**
 * The character system.
 *
 * Port of `snowflow_demo/src/character/character.js`. Owns the skeleton, the
 * garment simulation, the three meshes and the nine draws that place them, and
 * the single small texture that carries every per-frame transform to the GPU.
 *
 * THE TRANSFORM TEXTURE IS THE SPINE OF THE WHOLE THING. Rows 0-3 hold bone
 * skinning matrices, rows 4 and beyond hold simulated cloth nodes, and one
 * `update()` per frame writes both into a pre-allocated staging array and
 * uploads it once. Nothing else crosses to the GPU: no per-frame buffers, no
 * matrix uniforms, no vertex data. 48 x 64 x RGBA32F = 48 KiB per frame.
 *
 * Allocation per frame: none.
 *
 * ---------------------------------------------------------------------------
 * WIRING — what the integrator has to do
 *
 *     const character = new Character(scene, terrain, sky, shadows, controller);
 *     character.registerPrepass(depthPass);        // after depthPass exists
 *     ...
 *     controller.update(dt, rig);                  // 1. motion
 *     terrain.clampToPlayArea(controller.position);// 2.
 *     character.update(dt);                        // 3. pose -> settle -> cloth -> upload
 *     contact.update(dt);                          // 4. reads character.figure.plant
 *     rig.update(...); shadows.update(...);        // 5.
 *     character.sync(camera);                      // 7. AFTER the cascade refit
 *
 * The split between `update` and `sync` is deliberate and is a real visual bug
 * if merged: the garments have to be solved before the contact system reads the
 * feet, but the uniforms cannot be written until the camera has moved and the
 * cascades have been refitted. Doing both at one point leaves one of them a
 * frame stale, and the symptom — a shadow lagging the figure by a frame during a
 * fast carve — reads as *cheap* without being identifiable.
 *
 * `SNOWFLOW.character` (ARCHITECTURE.md §2) is the CONTROLLER, not this object;
 * `SNOWFLOW.figure` is this object, matching `_spec/character.md` §8. The posed
 * skeleton `SnowContact` wants is `character.figure`, and for safety this class
 * also aliases the two arrays it reads (`plant`, `touchdown`) so passing either
 * object works.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS
 *
 * One line: `furDroop`'s z component. The wind bearing is a reference-frame
 * bearing and the port's world is the reference's mirrored in z, so the cosine
 * term is negated exactly as it is in the cloth solver's apparent wind. Marked
 * PORT FRAME at the line. Everything else here is bookkeeping.
 */

import * as THREE from "three";

import { Figure, BONE_COUNT } from "./figure.js";
import { makePanels, ClothSolver } from "./cloth.js";
import { buildBody, buildFur, buildClothMesh } from "./build.js";
import { S, onChange } from "../core/settings.js";
import { bearingRad } from "../core/bearing.js";
import { shader, resolve } from "../core/glsl.js";
import { fail } from "../core/loading.js";
import {
    CHAR_VERTEX, CHAR_DEPTH_VERTEX, CHAR_PREPASS_VERTEX, charFragment,
} from "../shaders/char.glsl.js";
import {
    CLOTH_VERTEX, CLOTH_DEPTH_VERTEX, CLOTH_PREPASS_VERTEX,
} from "../shaders/cloth.glsl.js";
import { FUR_VERTEX, furFragment } from "../shaders/fur.glsl.js";

/** Transform texture geometry. Width covers the widest of bones or panel cols. */
const TEX_W = 48;
const TEX_H = 64;
/** First texture row available to cloth panels; 0-3 are the bone matrices. */
const CLOTH_ROW0 = 4;

/** How many of the three cascades the figure casts into. */
const CHAR_CASCADES = 2;

/** Per _spec/shadows.md §6.5, and tighter than the terrain's — see below. */
const SHADOW_SOFTNESS = 1.4;
/**
 * Metres. A larger bias detaches the contact shadow between the boots and the
 * snow, and that is the shadow that tells you the character is standing ON the
 * ground rather than IN it.
 */
const SHADOW_BIAS = 0.012;

/**
 * Threads per metre. Coarse hand-woven wool, which is what puts the weave right
 * at the edge of visibility at the distance the figure is normally framed —
 * present in a close-up, gone by ten metres.
 */
const WEAVE_DENSITY = 210;

/** Strand cells per metre of surface: a 4.0 mm pitch. */
const FUR_DENSITY = 250;

/**
 * Material palette. Eight slots, uploaded as two vec4 arrays so every value is
 * live-tunable and nothing is baked into the shader.
 *
 * Two properties of these numbers are deliberate, were MEASURED off the render
 * rather than picked as colours, and a port that "corrects" them will look wrong.
 *
 * They are very SATURATED. At thirteen degrees the sun has lost most of its blue
 * — the direct beam here is roughly 17:13:6 — so a merely blue-ish albedo comes
 * back out of the multiply as warm grey. The blue has to be about four times the
 * red in the albedo just to survive to two-to-one in the lit areas.
 *
 * They are very DARK. AgX compresses hard, so an eighth of the snow's albedo is
 * only about three stops down and lands near mid grey on screen. Anything
 * lighter stops reading as a silhouette against the field, which is the one
 * thing the figure has to do at fifteen metres.
 */
const PALETTE = [
    // rgb, roughness
    [0.030, 0.048, 0.125, 0.80], // 0 robe, deep indigo
    [0.075, 0.105, 0.185, 0.74], // 1 mantle, blue-grey
    [0.230, 0.225, 0.205, 0.82], // 2 collar lining, warm pale
    [0.048, 0.033, 0.024, 0.60], // 3 leather
    [0.135, 0.095, 0.072, 0.85], // 4 skin, deep in shade
    [0.120, 0.195, 0.310, 0.70], // 5 trim / scarf, pale blue
    [0.700, 0.720, 0.760, 0.85], // 6 fur (unused — the fur shader has its own colour)
    [0.100, 0.100, 0.100, 0.80], // 7 spare
];

/**
 * (sheen, anisotropy, transmission, weave depth) per slot.
 *
 * Transmission is the number to be careful with. Sunlight through a *blue* robe,
 * multiplied by a *warm* sun, comes back grey — so a generous transmission term
 * does not make the garment glow, it desaturates it to the point where the
 * albedo stops mattering. Heavy wool is close to opaque; only the thin
 * under-layer gets a real value.
 */
const PARAMS = [
    [0.22, 0.55, 0.05, 1.00],
    [0.28, 0.45, 0.07, 0.90],
    [0.35, 0.30, 0.22, 1.10],
    [0.06, 0.20, 0.01, 0.35],
    [0.05, 0.00, 0.08, 0.00],
    [0.25, 0.60, 0.12, 1.00],
    [1.00, 0.00, 0.90, 0.00],
    [0.20, 0.00, 0.00, 0.50],
];

/** Slightly blue-shifted white. Not PALETTE[6] — see fur.glsl.js. */
const FUR_COLOR = [0.74, 0.755, 0.795];

const _screen = new THREE.Vector2();

/**
 * Is a shared chunk registered?
 *
 * `lib/spellLights` belongs to SPELLS and may not exist yet; a `#include` of a
 * missing chunk throws at material construction, which would take the entire
 * character down rather than losing one additive term. `resolve()` is the public
 * API and caches by source string, so this costs one map lookup after the first
 * call.
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

export class Character {
    /**
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

        this.figure = new Figure(terrain);
        this.panels = makePanels();
        this.solver = new ClothSolver(this.panels, terrain);

        // Aliases so `new SnowContact(controller, field, characterOrFigure)` works
        // with either object. Same arrays by reference, not copies.
        this.plant = this.figure.plant;
        this.touchdown = this.figure.touchdown;

        // ---- transform texture ---------------------------------------------
        this._texData = new Float32Array(TEX_W * TEX_H * 4);
        let row = CLOTH_ROW0;
        /** Flat (rowBase, cols, rows, 0) per panel, for the vertex shaders. */
        this._panelParams = new Float32Array(6 * 4);
        for (let i = 0; i < this.panels.length; i++) {
            const p = this.panels[i];
            if (p.cols > TEX_W) {
                fail("cloth panel wider than the transform texture");
                throw new Error("panel wider than the transform texture");
            }
            p.nodeRow = row;
            this._panelParams[i * 4] = row;
            this._panelParams[i * 4 + 1] = p.cols;
            this._panelParams[i * 4 + 2] = p.rows;
            row += p.rows;
        }
        if (row > TEX_H) {
            fail("transform texture too short for the cloth panels");
            throw new Error("transform texture too short for the panels");
        }

        // RGBA32F, NEAREST, CLAMP, no mips. NOT RGBA16F: node positions are
        // absolute world coordinates over an ~870 m field, and half float
        // quantises to roughly half a metre out there — the garment explodes
        // into blocks (_spec/cloth-fur.md §13.2).
        this.charTex = new THREE.DataTexture(
            this._texData, TEX_W, TEX_H, THREE.RGBAFormat, THREE.FloatType
        );
        this.charTex.minFilter = THREE.NearestFilter;
        this.charTex.magFilter = THREE.NearestFilter;
        this.charTex.wrapS = THREE.ClampToEdgeWrapping;
        this.charTex.wrapT = THREE.ClampToEdgeWrapping;
        this.charTex.generateMipmaps = false;
        this.charTex.flipY = false;
        this.charTex.unpackAlignment = 4;
        this.charTex.needsUpdate = true;
        this.charTex.name = "charTex";

        // ---- palette --------------------------------------------------------
        this._matAlbedo = new Float32Array(32);
        this._matParams = new Float32Array(32);
        for (let i = 0; i < 8; i++) {
            for (let k = 0; k < 4; k++) {
                this._matAlbedo[i * 4 + k] = PALETTE[i][k];
                this._matParams[i * 4 + k] = PARAMS[i][k];
            }
        }

        // ---- uniform blocks --------------------------------------------------
        /**
         * `lib/common`'s shared globals (ARCHITECTURE.md §3), owned here for the
         * same reason `render/sky.js` and `terrain/terrain.js` own theirs: the
         * character is then correct whatever order the integrator's
         * `updateGlobals()` runs in. `uSunDir` and `uSunColor` hold live
         * references into `sky`, so they need no per-frame copy.
         */
        this.globals = {
            uSunDir: { value: sky.sunDir },
            uSunColor: { value: sky.sunRadiance },
            uCameraPos: { value: new THREE.Vector3() },
            uTime: { value: 0 },
            uViewProj: { value: new THREE.Matrix4() },
            uResolution: { value: _screen.clone() },
        };

        this._uCharTex = { value: this.charTex };
        this._uPanelParams = { value: this._panelParams };
        this._uFurDroop = { value: new THREE.Vector3() };

        const surfaceUniforms = Object.assign(
            {},
            this.globals,
            sky.uniforms,
            terrain.shadingUniforms,                                   // declares sssStrength
            shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
            {
                charTex: this._uCharTex,
                matAlbedo: { value: this._matAlbedo },
                matParams: { value: this._matParams },
                weaveDensity: { value: WEAVE_DENSITY },
            }
        );

        // ---- geometry --------------------------------------------------------
        const bodyGeo = buildBody();
        const clothGeo = buildClothMesh(this.panels);
        const furGeo = buildFur();

        // ---- materials -------------------------------------------------------
        // The body and the garments differ ONLY in their vertex program: the
        // fabric shading, the shadow lookup and the aerial perspective are
        // literally the same code.
        const spellLights = hasChunk("lib/spellLights");
        this._spellLights = spellLights;
        const fabricFrag = shader(charFragment({ spellLights }));

        this.bodyMat = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(CHAR_VERTEX),
            fragmentShader: fabricFrag,
            uniforms: surfaceUniforms,
            // Every garment is an open sheet and the cowl is a shell, so both
            // faces are visible. The fragment shader turns N toward the viewer
            // rather than trusting winding — see the note there.
            side: THREE.DoubleSide,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });
        this.bodyMat.name = "charBody";

        this.clothMat = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(CLOTH_VERTEX),
            fragmentShader: fabricFrag,
            uniforms: Object.assign({}, surfaceUniforms, { panelParams: this._uPanelParams }),
            side: THREE.DoubleSide,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });
        this.clothMat.name = "charCloth";

        this.furMat = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(FUR_VERTEX),
            fragmentShader: shader(furFragment({})),
            uniforms: Object.assign(
                {},
                this.globals,
                sky.uniforms,
                terrain.shadingUniforms,
                shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),
                {
                    charTex: this._uCharTex,
                    furDroop: this._uFurDroop,
                    furDensity: { value: FUR_DENSITY },
                    furColor: {
                        value: new THREE.Vector3(FUR_COLOR[0], FUR_COLOR[1], FUR_COLOR[2]),
                    },
                }
            ),
            // Alpha-TESTED via discard, not blended — so it stays opaque, writes
            // depth, and shell draw order does not matter. Do not sort shells.
            side: THREE.DoubleSide,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NoBlending,
        });
        this.furMat.name = "charFur";

        // ---- meshes ----------------------------------------------------------
        this.bodyMesh = this._makeMesh(bodyGeo, this.bodyMat, "charBody");
        this.clothMesh = this._makeMesh(clothGeo, this.clothMat, "charCloth");
        this.furMesh = this._makeMesh(furGeo, this.furMat, "charFur");
        scene.add(this.bodyMesh, this.clothMesh, this.furMesh);

        /** Every mesh, for `gfx.warmUp` and for the integrator's bookkeeping. */
        this.meshes = [this.bodyMesh, this.clothMesh, this.furMesh];

        this.triangles =
            bodyGeo.userData.triangles + clothGeo.userData.triangles + furGeo.userData.triangles;

        // ---- shadow casters --------------------------------------------------
        // Two of three cascades. Each cascade gets its OWN material so each can
        // hold its own lightViewProjection with no mid-frame uniform juggling —
        // and each runs the same vertex program the beauty pass runs, because
        // there is no CPU geometry matching what is drawn (ARCHITECTURE.md §5).
        /** @type {THREE.RawShaderMaterial[]} */
        this._depthMats = [];
        shadows.registerCaster(
            this.bodyMesh,
            (c) => this._makeDepthMaterial(CHAR_DEPTH_VERTEX, c, false),
            CHAR_CASCADES
        );
        shadows.registerCaster(
            this.clothMesh,
            (c) => this._makeDepthMaterial(CLOTH_DEPTH_VERTEX, c, true),
            CHAR_CASCADES
        );
        // The FUR is deliberately not a caster. Its shadow lands inside the
        // hood's own, an alpha-tested 22-shell depth pass is not cheap, and what
        // it would contribute is a fractionally fuzzier edge on a shadow already
        // an order of magnitude softer than that.

        /** @type {THREE.RawShaderMaterial[]} */
        this._prepassMats = [];

        this._needSettle = true;
        this._visible = true;
        this.setVisible(S.showCharacter !== false);
        this._offChange = onChange("showCharacter", () => this.setVisible(S.showCharacter));
    }

    /**
     * Everything is placed by the vertex shader from bone matrices, so the world
     * matrix is the identity for ever and the bounding sphere is a lie. For the
     * cloth mesh the `position` attribute is `(u, v, panelIndex)` and any
     * computed bounds would be meaningless.
     */
    _makeMesh(geometry, material, name) {
        const m = new THREE.Mesh(geometry, material);
        m.name = name;
        m.frustumCulled = false;
        m.matrixAutoUpdate = false;
        m.matrix.identity();
        m.matrixWorld.identity();
        m.raycast = () => {};
        // Above the terrain in the opaque sort, matching renderingGroupId = 1.
        m.renderOrder = 1;
        return m;
    }

    _makeDepthMaterial(vertexSource, cascade, isCloth) {
        const u = { charTex: this._uCharTex };
        if (isCloth) u.panelParams = this._uPanelParams;
        const mat = this.shadows.makeCasterMaterial(vertexSource, u, {
            // Matches the reference's `defines: ["CHAR_CASCADE " + cascade]`,
            // which exists to force a distinct compiled program per cascade.
            defines: { CHAR_CASCADE: cascade },
        });
        mat.name = (isCloth ? "clothDepth" : "charDepth") + cascade;
        this._depthMats.push(mat);
        return mat;
    }

    /**
     * Depth-prepass materials for the body and the garments.
     *
     * The fur is left out on the same grounds it is left out of the cascades: it
     * is an alpha-tested twenty-two-shell pass, and what it would contribute is
     * a fractionally fuzzier occlusion edge on a hood rim already inside its own
     * baked cavity.
     *
     * @param {import("../render/depthPass.js").DepthPass} depth
     * @returns {void}
     */
    registerPrepass(depth) {
        const specs = [
            { mesh: this.bodyMesh, vs: CHAR_PREPASS_VERTEX, cloth: false, name: "charPrepass" },
            { mesh: this.clothMesh, vs: CLOTH_PREPASS_VERTEX, cloth: true, name: "clothPrepass" },
        ];
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            const u = { charTex: this._uCharTex };
            if (spec.cloth) u.panelParams = this._uPanelParams;
            const mat = depth.makeCasterMaterial(spec.vs, u);
            mat.name = spec.name;
            this._prepassMats.push(mat);
            depth.registerCaster(spec.mesh, mat);
        }
    }

    /** @param {boolean} v @returns {void} */
    setVisible(v) {
        this._visible = !!v;
        this.bodyMesh.visible = this._visible;
        this.clothMesh.visible = this._visible;
        this.furMesh.visible = this._visible;
    }

    /**
     * Advance the figure and the garments, then push one texture upload.
     *
     * Order matters: the skeleton has to be posed before the cloth can find its
     * kinematic targets, and both have to be written before the texture goes up,
     * or the garments render one frame behind the body they hang from.
     *
     * @param {number} dt seconds
     * @returns {void}
     */
    update(dt) {
        const ch = this.controller;
        this.figure.update(dt, ch);
        if (this._needSettle) {
            this._settleCloth();
            this._needSettle = false;
        }
        this.solver.update(dt, this.figure, ch);
        this._uploadTransforms();
    }

    /**
     * Push this frame's camera-dependent uniforms. Split from `update` — see the
     * file header.
     *
     * @param {THREE.Camera} camera the beauty camera, after the rig has moved it
     *   and after `shadows.update()` has refitted the cascades
     * @returns {void}
     */
    sync(camera) {
        const g = this.globals;
        g.uCameraPos.value.copy(camera.position);
        g.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

        // Fur droop: gravity, plus the apparent wind, plus the character's own
        // acceleration thrown the other way. Metres of TIP travel — the vertex
        // shader scales it by t*t. At a full-speed carve the velocity term alone
        // (30 mm at 19 m/s) is most of a 48 mm hood strand, so the fur visibly
        // sweeps back by most of its own length.
        const ch = this.controller;
        // PORT FRAME: `bearingRad` already mirrors the bearing into the port's
        // frame (`core/bearing.js`), so the cosine is used as written rather than
        // hand-negated here — the hand-negation this replaces was correct but
        // duplicated the invariant, which is how the sun drifted out of frame.
        // `ch.velocity` and `ch.acceleration` are already in the port frame.
        const a = bearingRad(S.windDirection);
        const ws = 0.6 * S.windStrength;   // note: NOT the cloth solver's 3.2
        this._uFurDroop.value.set(
            Math.sin(a) * ws * 0.006 - ch.velocity.x * 0.0016 - ch.acceleration.x * 0.00018,
            -0.018,
            Math.cos(a) * ws * 0.006 - ch.velocity.z * 0.0016 - ch.acceleration.z * 0.00018
        );
    }

    /**
     * Drop every garment straight onto its kinematic target.
     *
     * Done once, on the first update. The panels are authored in bind space at
     * the world origin, and letting them fall from there to wherever the player
     * actually spawned takes a second of visible flapping — behind the loading
     * screen if we are lucky, in shot if we are not.
     */
    _settleCloth() {
        const skin = this.figure.skin;
        for (let pi = 0; pi < this.panels.length; pi++) {
            const p = this.panels[pi];
            for (let k = 0; k < p.count; k++) {
                const b = p.bone[k] * 16;
                const o = k * 3;
                const x = p.bindPos[o], y = p.bindPos[o + 1], z = p.bindPos[o + 2];
                p.pos[o] = skin[b] * x + skin[b + 4] * y + skin[b + 8] * z + skin[b + 12];
                p.pos[o + 1] = skin[b + 1] * x + skin[b + 5] * y + skin[b + 9] * z + skin[b + 13];
                p.pos[o + 2] = skin[b + 2] * x + skin[b + 6] * y + skin[b + 10] * z + skin[b + 14];
            }
            p.prev.set(p.pos);   // zero velocity
        }
    }

    _uploadTransforms() {
        const d = this._texData;
        const skin = this.figure.skin;

        // Rows 0-3: bone matrices, one COLUMN per bone, one ROW per matrix
        // column. Four separate row writes rather than one blit, because the
        // texture is column-major in bones and row-major in memory.
        for (let b = 0; b < BONE_COUNT; b++) {
            const s = b * 16;
            for (let c = 0; c < 4; c++) {
                const o = (c * TEX_W + b) * 4;
                d[o] = skin[s + c * 4];
                d[o + 1] = skin[s + c * 4 + 1];
                d[o + 2] = skin[s + c * 4 + 2];
                d[o + 3] = skin[s + c * 4 + 3];
            }
        }

        // Rows 4+: one rectangle per panel, .rgb = absolute world position.
        for (let pi = 0; pi < this.panels.length; pi++) {
            const p = this.panels[pi];
            const pos = p.pos;
            for (let j = 0; j < p.rows; j++) {
                const rowO = ((p.nodeRow + j) * TEX_W) * 4;
                for (let i = 0; i < p.cols; i++) {
                    const s = (j * p.cols + i) * 3;
                    const o = rowO + i * 4;
                    d[o] = pos[s];
                    d[o + 1] = pos[s + 1];
                    d[o + 2] = pos[s + 2];
                    d[o + 3] = 1;
                }
            }
        }

        // ONE upload. Three re-uploads the whole 48 KiB rather than a
        // texSubImage2D over rows 0-38; at 48 KiB a frame that is not worth a
        // hand-rolled GL path.
        this.charTex.needsUpdate = true;
    }

    /**
     * Every mesh that must be drawn once behind the loading screen. Hand these
     * to `gfx.warmUp` — the shadow and prepass proxies are already in their own
     * scenes and are warmed by those systems.
     * @returns {THREE.Object3D[]}
     */
    warmUpMeshes() {
        return this.meshes;
    }

    dispose() {
        if (this._offChange) this._offChange();
        for (let i = 0; i < this.meshes.length; i++) {
            const m = this.meshes[i];
            if (m.parent) m.parent.remove(m);
            m.geometry.dispose();
        }
        this.bodyMat.dispose();
        this.clothMat.dispose();
        this.furMat.dispose();
        for (let i = 0; i < this._depthMats.length; i++) this._depthMats[i].dispose();
        for (let i = 0; i < this._prepassMats.length; i++) this._prepassMats[i].dispose();
        this.charTex.dispose();
    }
}
