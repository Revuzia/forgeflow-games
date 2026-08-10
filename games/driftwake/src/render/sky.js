/**
 * Procedural sky, image-based lighting, and the sun's own colour.
 *
 * Port of `src/render/sky.js` from the WebGPU reference.
 *
 * No HDRI. The whole look rests on a sun 5-15 degrees up, and with an analytic
 * model the elevation slider drags the horizon warmth, the zenith gradient and
 * the ambient tint along with it, consistently. A captured HDRI would freeze all
 * of that at whatever elevation it was shot at.
 *
 * The scattering integral is far too heavy for per-pixel work, so it bakes into
 * an equirectangular LUT at load and again when the sun changes. Everything
 * downstream — skybox, ambient SH, specular probes, aerial inscatter, and the
 * water and crystal refraction lookups — reads that one texture.
 *
 * ---------------------------------------------------------------------------
 * WHAT OTHER SUBSYSTEMS NEED FROM THIS FILE
 *
 *   sky.uniforms   the `lib/atmosphere` uniform block — uSkyLUT, uSkySH,
 *                  uAmbientIntensity, uFog — as live Three uniform objects.
 *                  Spread it into every material that includes lib/atmosphere:
 *                      uniforms: { ...sky.uniforms, ...mine }
 *                  Shared by reference, so this file updating one updates them
 *                  all and nothing has to be copied per frame.
 *
 *   sky.sunDir        Vector3, unit, toward the sun, world space.
 *   sky.sunColor      Vector3, normalised hue of the beam (max channel = 1).
 *   sky.sunRadiance   Vector3, direct solar irradiance at the ground, in the
 *                     same units the LUT stores radiance in. This is what the
 *                     integrator must publish as `uSunColor` — ARCHITECTURE.md
 *                     3 defines that uniform as linear and premultiplied by
 *                     intensity, and putting the normalised hue there instead
 *                     makes every lit surface ~23x too dim and the sun-facing
 *                     haze wrong (QUIRK-2).
 *   sky.sunScale      float, S.sunIntensity * 5.5 — the one radiometric scale
 *                     shared by the sun and the baked sky.
 *   sky.sh            Float32Array(36), 9 SH coefficients laid out as vec4.
 *
 * `sunRadiance` and the LUT being on ONE radiometric scale is the entire
 * warm-light / cool-shadow look. Do not introduce a separate sun-intensity
 * multiplier downstream.
 *
 * ---------------------------------------------------------------------------
 * BOOT ORDER (ARCHITECTURE.md 4)
 *
 *     const sky = new Sky(renderer, scene);
 *     await sky.solve();            // BEFORE any other material is constructed
 *
 * The terrain, character, wake, spray, water and crystal materials all take the
 * sky LUT and the SH coefficients as construction inputs, so nothing else may be
 * built until the solve resolves.
 *
 * Per frame, in this order:  sky.update();  sky.render(camera, time);
 */

import * as THREE from "three";
import { S, onChange } from "../core/settings.js";
import { bearingRad } from "../core/bearing.js";
import { makeRT, FullScreenPass } from "../core/gfx.js";
import { fail } from "../core/loading.js";
import skyBakeFrag from "../shaders/skyBake.glsl.js";
import { vertex as skyVert, fragment as skyFrag } from "../shaders/sky.glsl.js";
import { shader } from "../core/glsl.js";

const LUT_W = 512;
const LUT_H = 256;
const SH_W = 64;   // low-res copy, read back on the CPU for the SH projection
const SH_H = 32;

/**
 * Converts the `sunIntensity` slider into the shared radiometric scale used by
 * both the sky integral and the direct sun. Its absolute value is arbitrary —
 * exposure handles overall brightness — but it must be *one* number applied to
 * both, or the sun/sky ratio stops meaning anything.
 */
const SUN_SCALE_BASE = 5.5;

/**
 * Fresh snow reflects most of what hits it, slightly more at the blue end.
 *
 * This is the DEFAULT of `this.groundAlbedo`, which `applyRealm()` replaces.
 * It is not cosmetic: `_updateGroundBounce()` computes L = albedo * E / PI and
 * the solve iterates it three times, so the bounce compounds by roughly
 * albedo-cubed — Cold's mean 0.867 lands at 0.652, and an ash mean of 0.071
 * lands at 0.00036. That factor of ~1800 in how much the ground lights the sky
 * is the mechanism that makes an ash plain feel like a pit rather than a bright
 * field, and Cold's blue-weighted bounce is the single largest source of blue
 * anywhere in the frame.
 */
const SNOW_ALBEDO = [0.83, 0.86, 0.91];

/** Cold's sun, for the realm multipliers. `settings.js:53, 55, 72`. */
const COLD_SUN_INTENSITY = 4.2;
const COLD_AMBIENT = 1.0;
const COLD_MOUNTAIN_H = 2150;

/**
 * The per-realm ATMOSPHERE GRADE, applied to the baked LUT.
 *
 * ⚑ WHAT THIS IS AND WHAT IT IS NOT. The physically right lever is the bake's
 * own scattering constants — BETA_M, MIE_G, BETA_R, H_MIE, MS_BOOST — which live
 * in `shaders/skyBake.glsl.js` and belong to another owner. This is the lever
 * available here: one extra fullscreen pass over the freshly baked LUT that
 * desaturates the Rayleigh blue away, tints what is left, and pushes a warm band
 * across the horizon rows in place of the forward-scattering aureole a real Mie
 * coefficient would produce.
 *
 * It is applied to BOTH LUTs, so it reaches everything: the skybox samples the
 * 512x256, the SH projection reads the 64x32, and the SH is what lights the
 * terrain, the character and every particle. It is a grade, and it is labelled
 * one — but it is a grade on the SOURCE of the light rather than on the finished
 * frame, which is why the ambient, the specular probe and the aerial inscatter
 * all follow it instead of only the dome.
 *
 *   desat   pull toward luminance, i.e. kill the blue dome     [call]
 *   band    half-width of the horizon band, in LUT v units     [call]
 *   amount  how far the band is pushed to `horizon`            [call]
 *   gain    overall multiplier                                 [call]
 *
 * COLD IS THE IDENTITY: desat 0, tint (1,1,1), amount 0, gain 1, so
 * `_gradeActive` stays false and the extra pass is never allocated or run.
 */
const SKY_GRADE = {
    cold: { tint: [1, 1, 1], horizon: [1, 1, 1], desat: 0, band: 0.25, amount: 0, gain: 1 },
    sand: {
        tint: [1.28, 1.02, 0.64], horizon: [1.36, 1.08, 0.70],
        desat: 0.66, band: 0.44, amount: 0.55, gain: 1.00,
    },
    ash: {
        tint: [0.86, 0.38, 0.23], horizon: [1.02, 0.36, 0.17],
        // gain 0.40 shipped a foreground that read as pure black with ember
        // dots (owner 2026-08-10: "almost impossible to play"). 0.52 keeps the
        // soot ceiling and the pit mood but leaves enough dome light for the
        // terrain relief to silhouette. Tuned WITH realms.js ash
        // `vfx.exposure` and `ambientIntensity` — move the three together.
        desat: 0.86, band: 0.50, amount: 0.62, gain: 0.52,
    },
};

/**
 * BEAM EXTINCTION — the stand-in for the Mie the bake does not carry.
 *
 * `realms.js` gives Sand and Ash a HIGHER `sky.sunIntensity` than Cold (5.4 and
 * 5.6 against 4.2) and the contract says why: those are PRE-EXTINCTION numbers,
 * chosen because a realm with heavy aerosol eats most of its own beam. That
 * extinction lives in `skyBake.glsl.js`'s BETA_M / H_MIE, which this file does
 * not own — so taking the raw intensity ratio and nothing else makes Ash BRIGHTER
 * than Cold, which is the exact opposite of the intent.
 *
 * THE TEMPERED TABLE THAT USED TO LIVE HERE IS DELETED, not re-tuned, exactly as
 * its own note asked. It read `{cold: 1.0, sand: 0.94, ash: 0.45}` and Ash's 0.45
 * was three times the derived 0.161 for one reason: `S.exposure` was Cold's 0.105
 * in every realm, and at that exposure the physical number renders an all-but-
 * black frame. Exposure is realm data now (`settings.js` `applyRealmGrade`,
 * `realms.js` `vfx.exposure` — Ash 0.300, 2.86x Cold's), so the realm can be lit
 * correctly and dimmed honestly instead of being faked bright.
 *
 * The value itself moved to the realm row as `sky.beamExtinction`, where the
 * derivation sits next to the `sunIntensity` it corrects. Missing = 1.
 */

/**
 * The grade pass. `texelFetch`, not `texture`, so there is no filtering between
 * the bake and the grade and Cold's identity path is bit-exact.
 */
const GRADE_FRAG = /* glsl */`
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uSrc;
uniform vec3 uGradeTint;
uniform vec3 uHorizonTint;
/// x desaturate, y horizon band half-width, z horizon amount, w gain.
uniform vec4 uGradeParams;
void main() {
    vec4 s = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
    vec3 c = s.rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 g = mix(c, vec3(lum), uGradeParams.x) * uGradeTint;
    float band = 1.0 - smoothstep(0.0, max(uGradeParams.y, 1e-4), abs(vUv.y - 0.5));
    g = mix(g, vec3(lum) * uHorizonTint, band * uGradeParams.z);
    outColor = vec4(g * uGradeParams.w, s.a);
}
`;

/** @param {any} v @param {number} d @returns {number} */
function num(v, d) {
    return typeof v === "number" && isFinite(v) ? v : d;
}

/** @param {any} a @param {number} i @param {number} d @returns {number} */
function at(a, i, d) {
    return Array.isArray(a) ? num(a[i], d) : d;
}

/**
 * Write a 3-array into a Vector3 uniform, leaving it standing if the row does
 * not carry the key — never zeroing it.
 * @param {{value: THREE.Vector3}} u @param {any} a @returns {void}
 */
function setV3(u, a) {
    if (Array.isArray(a) && a.length >= 3
        && isFinite(a[0]) && isFinite(a[1]) && isFinite(a[2])) {
        u.value.set(a[0], a[1], a[2]);
    }
}

/**
 * Milliseconds a sun change waits before the LUT is re-solved. Ours, not the
 * reference's: the reference re-solves on the frame the slider moves and lets
 * the async readback settle over the next few frames. Four full bakes plus four
 * 2048-texel readbacks per drag-frame is fine on the RTX the reference was
 * profiled on and is not fine on the Iris Xe the harness runs (ARCHITECTURE
 * 4.1), so the solve is coalesced to the end of a drag instead. Long enough to
 * swallow a slider drag, short enough to feel immediate on release.
 */
const REBAKE_DEBOUNCE_MS = 150;

const _dir = new THREE.Vector3();
const _shBasis = new Float32Array(9);
const _irrTmp = new Float32Array(3);

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Samples the sky LUT at one uv and one explicit mip, into a 1x1 RGBA32F target.
 *
 * Exists for a single documented silent failure (PORT-2): if the mip chain is
 * not actually generated, `textureLod(uSkyLUT, uv, 6.0)` returns black, the
 * near-field half of the aerial perspective goes black with it, and the symptom
 * — a dark band across the middle distance — looks like a fog bug rather than a
 * texture-setup bug. Verifying it costs one draw at load.
 */
const PROBE_FRAG = /* glsl */`
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uSkyLUT;
uniform vec2 uProbeUv;
uniform float uProbeLod;
void main() {
    outColor = textureLod(uSkyLUT, uProbeUv, uProbeLod);
}
`;

export class Sky {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.Scene} [scene] if given, the skybox mesh is added to it
     */
    constructor(renderer, scene) {
        this.renderer = renderer;

        /** Unit vector pointing *toward* the sun, world space. */
        this.sunDir = new THREE.Vector3(0, 0.2, 1);
        /** Normalised hue of direct sunlight, for tinting effects. */
        this.sunColor = new THREE.Vector3(1, 0.85, 0.66);
        /**
         * Direct solar irradiance reaching the ground, in the *same units the
         * sky LUT stores radiance in*. Everything downstream reads this rather
         * than an intensity-times-colour pair, because the sun and the sky have
         * to be on one scale or the balance between them is arbitrary — and that
         * balance is the entire cool-shadow / warm-light look.
         */
        this.sunRadiance = new THREE.Vector3(1, 1, 1);
        /** Shared radiometric scale for the sun and the baked sky. */
        this.sunScale = 1;
        /** Radiance leaving the snow field, solved iteratively. */
        this.groundBounce = new THREE.Vector3(0, 0, 0);
        /** 36 floats: 9 SH coefficients as vec4, for the shader. */
        this.sh = new Float32Array(36);

        this._dirty = true;
        this._solving = false;
        this._rebakeAt = 0;
        /**
         * Which framebuffer row the zenith landed on, measured rather than
         * assumed — see `_detectRowOrder`. Null until the first readback.
         */
        this._rowZeroIsZenith = null;
        this._mipsVerified = false;
        /** Last baked sun scale / warmth, so a direct write to S is caught too. */
        this._lastScale = NaN;
        this._lastWarm = NaN;

        // ------------------------------------------------------------ realm
        /** Realm token last applied. Read by probes. */
        this.realmName = "cold";
        /**
         * Ground albedo feeding `_updateGroundBounce()`. A COPY, so a realm row
         * handed in cannot be mutated from here.
         */
        this.groundAlbedo = SNOW_ALBEDO.slice();
        /**
         * Realm multipliers on the four settings the sky reads. Multipliers, not
         * overrides, so the overlay's sun/ambient/mountain sliders keep working
         * and a realm still lands on its contract number at the default.
         */
        this._sunScaleMul = 1;
        this._ambientMul = 1;
        this._ridgeMul = 1;
        /** The realm row's `sky.beamExtinction`, kept separately from the product
         *  above so a probe can read the aerosol term back on its own. */
        this._beamExtinction = 1;
        /** Realm hue on the beam and the disc. Applied to BOTH so they agree. */
        this._sunTintMul = new THREE.Vector3(1, 1, 1);
        /**
         * THE STORM'S MULTIPLIER ON THE FOG — REALM_CONTRACT §3.2's `fogBoost`,
         * folded into the `uFog` write in `update()` below.
         *
         * The REALM's fog is not here. It arrives as `S.fogDensity` /
         * `S.fogHeightFalloff` / `S.fogStart` / `S.aerialStrength`, re-based per
         * realm by `settings.js` `applyRealmGrade()`, which is what makes the
         * §1c INVERSION land: Sand's 0.070 falloff pools the dust in the hollows,
         * Ash's 0.026 hangs the smoke up the whole column, against Cold's 0.045.
         * This object is the weather layer ON TOP of that, and it is owned here
         * rather than in `weather.js` for one measured reason: `WeatherField`
         * used to write `uFog` itself, every frame, AFTER `sky.update()` had
         * rebuilt it from `S` (`weather.js`, `driveFog`, now deleted). Any realm
         * fog written anywhere was overwritten before it could be sampled. One
         * owner for the uniform, one multiplier hanging off it.
         *
         * Defaults 1/1, so a build with no weather in it renders the realm's fog
         * exactly and the overlay's fog sliders keep working as overrides.
         * @type {{density:number, falloff:number}}
         */
        this.fogBoost = { density: 1, falloff: 1 };
        /** True once a realm asks for a non-identity LUT grade. */
        this._gradeActive = false;
        this._gradeRT = null;
        this._gradeSH = null;
        this._grade = null;
        this._gradeUniforms = {
            uSrc: { value: null },
            uGradeTint: { value: new THREE.Vector3(1, 1, 1) },
            uHorizonTint: { value: new THREE.Vector3(1, 1, 1) },
            uGradeParams: { value: new THREE.Vector4(0, 0.25, 0, 1) },
        };

        // ------------------------------------------------------------- LUTs
        // RGBA16F with a full mip chain. Mip 6 is 8x4, which is the coarsest
        // level any consumer asks for (sqrt(roughness) * 6 tops out at 6), so
        // the chain has to be complete; Three regenerates it at the end of every
        // render into this target because generateMipmaps is on and the min
        // filter is a mipmap filter.
        //
        // wrapS = Repeat and wrapT = ClampToEdge are not optional. With wrapT
        // repeating, the zenith row bleeds into the nadir row through mip
        // filtering and the top of the sky picks up ground bounce; with wrapS
        // clamped, a seam appears at azimuth 180 degrees.
        this.lut = makeRT(LUT_W, LUT_H, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearMipmapLinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.RepeatWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            generateMipmaps: true,
            name: "skyLUT",
        });

        // The same content at 64x32 in full float, existing purely so the CPU
        // readback has the precision for the SH fit. Never filtered, so it needs
        // no OES_texture_float_linear.
        this.shLut = makeRT(SH_W, SH_H, {
            type: THREE.FloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            generateMipmaps: false,
            name: "skySH",
        });

        this._px = new Float32Array(SH_W * SH_H * 4);

        // ---------------------------------------------- the atmosphere block
        // Shared by reference with every material that includes lib/atmosphere.
        /** @type {Record<string, {value:any}>} */
        this.uniforms = {
            uSkyLUT: { value: this.lut.texture },
            uSkySH: { value: [] },
            uAmbientIntensity: { value: S.ambientIntensity },
            // x density, y heightFalloff, z fogStart, w aerialStrength
            uFog: { value: new THREE.Vector4(
                S.fogDensity, S.fogHeightFalloff, S.fogStart, S.aerialStrength
            ) },
        };
        for (let i = 0; i < 9; i++) this.uniforms.uSkySH.value.push(new THREE.Vector4());

        // --------------------------------------------------------- bake pass
        this._bakeUniforms = {
            uSunDir: { value: this.sunDir },
            uSunScale: { value: this.sunScale },
            uGroundBounce: { value: this.groundBounce },
        };
        this._bake = new FullScreenPass(renderer, skyBakeFrag, this._bakeUniforms);
        // GPU profiler scope. Only runs when the sun moves, so a non-zero row
        // here during a steady measurement means something is re-baking the LUT
        // every frame — which is a bug, not a cost.
        this._bake.profileName = "sky LUT bake";

        // -------------------------------------------------------- mip probe
        this._probeRT = makeRT(1, 1, {
            type: THREE.FloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            name: "skyProbe",
        });
        this._probeUniforms = {
            uSkyLUT: this.uniforms.uSkyLUT,
            uProbeUv: { value: new THREE.Vector2(0.5, 0.35) },
            uProbeLod: { value: 6.0 },
        };
        this._probe = new FullScreenPass(renderer, PROBE_FRAG, this._probeUniforms);
        this._probePx = new Float32Array(4);

        // ----------------------------------------------------------- skybox
        // Size 2 so positions are exactly +/-1 and vDir is a raw cube direction.
        // The mesh stays at the origin with an identity transform — the shader
        // builds world position itself as position * skyScale + cameraPosition,
        // exactly as the reference does.
        const geo = new THREE.BoxGeometry(2, 2, 2);

        this._skyUniforms = {
            ...this.uniforms,
            // The shared globals (ARCHITECTURE.md 3). Owned here rather than
            // read from the integrator so the sky is correct whatever order
            // updateGlobals() runs in; they are plain uniform objects, so an
            // integrator that wants to share them can assign over this map.
            uSunDir: { value: this.sunDir },
            uSunColor: { value: this.sunRadiance },
            uCameraPos: { value: new THREE.Vector3() },
            uTime: { value: 0 },
            uViewProj: { value: new THREE.Matrix4() },
            uResolution: { value: new THREE.Vector2(1, 1) },

            uSkyScale: { value: 2100 },
            uSunTint: { value: this.sunColor },
            uSunScale: { value: this.sunScale },
            uWindDir: { value: new THREE.Vector2(0, 1) },
            // Was hard-coded in the reference's render(); now realm data, so
            // Sand can have almost no cirrus and Ash a soot ceiling.
            uCloudAmount: { value: 0.55 },
            uRidgeAmp: { value: 0 },

            // ---- lib/ground's SKY_REALM_BLOCK, seeded with the literals it
            // replaced in sky.glsl.js. Cold by construction.
            uFarRockAlbedo: { value: new THREE.Vector3(0.052, 0.055, 0.066) },
            uFarSnowAlbedo: { value: new THREE.Vector3(0.855, 0.885, 0.945) },
            uFarSnowGate: { value: new THREE.Vector2(0.46, 0.80) },
            uSssShallow: { value: new THREE.Vector3(0.94, 0.965, 1.0) },
            uSssDeep: { value: new THREE.Vector3(0.55, 0.72, 1.0) },
            uCirrusColor: { value: new THREE.Vector3(0.52, 0.60, 0.74) },
        };

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(skyVert),
            fragmentShader: shader(skyFrag),
            uniforms: this._skyUniforms,
            // Babylon's backFaceCulling = false. The cube is drawn from inside,
            // and a driver disagreeing about winding would drop it entirely.
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false,
            transparent: false,
            blending: THREE.NoBlending,
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.name = "sky";
        // LAST in the opaque queue, not first.
        //
        // The reference relies on renderingGroupId = 0 against the terrain's 1,
        // i.e. sky first; Three has no groups, so this used to be renderOrder
        // -1000. Drawn first, the far-range raymarch runs on every pixel in the
        // band dir.y in (-0.05, 0.230) — and on this camera that band is mostly
        // BELOW the horizon, where the clipmap paints over it a few draws later.
        // The march was shading pixels that no longer exist by the end of the
        // pass.
        //
        // Drawn last, the depth test does that rejection for free and before the
        // fragment shader runs: the vertex stage clamps the box to z/w =
        // 0.999999, so every pixel the terrain, the character or the wake has
        // already written fails LEQUAL and is killed by early-Z. Nothing about
        // the output moves — the sky was being overwritten by those same draws
        // anyway, this only stops it being computed first. It is safe precisely
        // because every other material in the opaque queue writes depth where it
        // writes colour (the three transparent ones — water, crystals, spray —
        // are in Three's transparent list and still draw after this).
        //
        // The one thing this does spend: the beauty target's colour clear is now
        // load-bearing. With the sky first it was arguably redundant, since the
        // sky covers the frame; it is not redundant now.
        this.mesh.renderOrder = 1000;
        // Clip-space is decided in the vertex shader; the CPU frustum test would
        // cull the box the moment the camera leaves the origin.
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;

        if (scene) scene.add(this.mesh);

        // QUIRK-1, deliberately fixed rather than reproduced. In the reference
        // nothing marks the sky dirty except a change in sun *direction*, so
        // dragging Intensity or Warmth updates sunRadiance immediately while the
        // LUT keeps the old scale until the sun next moves — the sky and the sun
        // then disagree about how bright the day is. Acceptance criterion 6 asks
        // for all four responses to move together, so all four sun settings
        // schedule a re-solve here.
        this._unsub = onChange(
            ["sunAzimuth", "sunElevation", "sunIntensity", "sunTempWarm"],
            () => this._markDirty()
        );
    }

    _markDirty() {
        this._dirty = true;
        this._rebakeAt = performance.now() + REBAKE_DEBOUNCE_MS;
    }

    /**
     * Recompute the sun vector and colour from the settings, and mark the LUT
     * for a rebake if anything actually moved. Cheap enough to run every frame.
     * @returns {void}
     */
    syncFromSettings() {
        // Azimuth 0 = +Z, 90 = +X. PORT-11 originally applied the reference
        // formula unchanged, on the argument that it was correct as long as the
        // terrain, the wind and the character used the same convention — but the
        // camera and the character do NOT: they are z-mirrored (see
        // `core/bearing.js`). That left the sun 53.9 degrees off the camera
        // forward at shot 14's pose, where the reference has it dead centre, and
        // pushed the sun disc clean out of frame in every shot. `bearingRad`
        // mirrors it into the camera's frame; because sin(PI-a) = sin(a) and
        // cos(PI-a) = -cos(a), the formula below is otherwise untouched, and the
        // sun/wind separation survives because the wind is mirrored with it.
        const az = bearingRad(S.sunAzimuth);
        const el = (S.sunElevation * Math.PI) / 180;
        const ce = Math.cos(el);
        _dir.set(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce);

        if (
            Math.abs(_dir.x - this.sunDir.x) > 1e-6 ||
            Math.abs(_dir.y - this.sunDir.y) > 1e-6 ||
            Math.abs(_dir.z - this.sunDir.z) > 1e-6
        ) {
            this.sunDir.copy(_dir);
            this._markDirty();
        }

        // ONE scale for the sun and the baked sky, realm included. The realm
        // multiplier goes in HERE rather than on sunRadiance downstream: a
        // separate downstream multiplier is exactly what the file header forbids,
        // because it makes the sun/sky ratio — the whole warm-light / cool-shadow
        // look — arbitrary.
        this.sunScale = S.sunIntensity * SUN_SCALE_BASE * this._sunScaleMul;

        // The intensity and warmth sliders change the *baked* sky as well as the
        // beam, and they are caught here rather than only through onChange
        // because onChange fires from settings.set() alone — a direct write to S
        // (which is how the harness and any preset applied by hand mutate it)
        // would otherwise leave the LUT on the old scale while sunRadiance moved,
        // reintroducing QUIRK-1 through the back door. Two float compares.
        if (this._lastScale !== this.sunScale || this._lastWarm !== S.sunTempWarm) {
            this._lastScale = this.sunScale;
            this._lastWarm = S.sunTempWarm;
            this._markDirty();
        }

        // Direct sunlight reddens as it grazes: the lower the sun, the longer
        // the path through the atmosphere and the more of the blue end is
        // scattered out of the beam. At 13 degrees the beam has already lost
        // most of its blue, which is what makes the warm-light / cool-shadow
        // split physical rather than an art choice.
        const zenithDeg = (Math.acos(clamp(this.sunDir.y, -1, 1)) * 180) / Math.PI;

        // Kasten-Young air mass — stays finite at the horizon, unlike 1/cos.
        const denom =
            Math.cos((zenithDeg * Math.PI) / 180) +
            0.50572 * Math.pow(Math.max(1e-3, 96.07995 - zenithDeg), -1.6364);
        const airMass = Math.min(denom > 0 ? 1 / denom : 40, 40);

        // Vertical optical depth: scattering coefficient x scale height. These
        // are exactly the shader's constants integrated — 5.8e-6 * 8000 = 0.0464
        // and so on — so the CPU beam attenuation and the baked sky cannot
        // disagree. sunTempWarm scales only the Rayleigh part, so 0 gives a
        // neutral beam that still loses energy to Mie.
        const warm = S.sunTempWarm;
        const r = Math.exp(-(0.0464 * warm + 0.0252) * airMass);
        const g = Math.exp(-(0.108 * warm + 0.0252) * airMass);
        const b = Math.exp(-(0.265 * warm + 0.0252) * airMass);

        // The realm hue, on the beam AND on the disc tint, so the two agree.
        const tm = this._sunTintMul;
        const rr = r * tm.x, rg = g * tm.y, rb = b * tm.z;

        this.sunRadiance.set(rr * this.sunScale, rg * this.sunScale, rb * this.sunScale);

        const m = Math.max(rr, Math.max(rg, rb)) || 1;
        this.sunColor.set(rr / m, rg / m, rb / m);
    }

    /**
     * Re-solve if the sun moved. Safe to call every frame: it only does work
     * when something actually changed, and it coalesces a slider drag into one
     * solve. Allocation-free on the steady-state path.
     * @returns {boolean} true if a solve was started this frame
     */
    update() {
        this.syncFromSettings();

        this.uniforms.uAmbientIntensity.value = S.ambientIntensity * this._ambientMul;
        // Realm base (S, re-based by applyRealmGrade) x storm boost. REALM_CONTRACT
        // §3.2: the boost cannot compound across frames because the base is
        // re-read from S every time, and a slider drag still overrides both.
        this.uniforms.uFog.value.set(
            S.fogDensity * this.fogBoost.density,
            S.fogHeightFalloff * this.fogBoost.falloff,
            S.fogStart,
            S.aerialStrength
        );

        if (!this._dirty || this._solving) return false;
        if (performance.now() < this._rebakeAt) return false;

        this._dirty = false;
        // Not awaited: the readback is async and the solve settles over the next
        // few frames, which is invisible while dragging a slider and avoids a
        // stall on the main thread.
        this.solve();
        return true;
    }

    /**
     * Bake the sky and the snow bounce together.
     *
     * The two are mutually dependent: the sky lights the snow, the snow bounces
     * ~85% of that straight back up, and that bounce is itself a major source of
     * sky-hemisphere light. Solved by iteration — bake, project to SH, work out
     * what the ground is now radiating, bake again. Three passes converge,
     * because each round trip is multiplied by the ~0.87 mean albedo. Then a
     * fourth bake so the LUT reflects the converged bounce, and a fourth
     * projection so the SH the shaders use matches the LUT they sample.
     * @returns {Promise<void>}
     */
    async solve() {
        this.syncFromSettings();
        this._solving = true;
        this._dirty = false;

        try {
            this.groundBounce.set(0, 0, 0);
            for (let i = 0; i < 3; i++) {
                this.bake();
                await this.projectSH();
                this._updateGroundBounce();
            }
            this.bake();
            await this.projectSH();

            if (!this._mipsVerified) {
                this._mipsVerified = true;
                this._verifyMipChain();
            }
        } catch (e) {
            fail("Sky bake failed");
            throw e;
        } finally {
            this._solving = false;
        }
    }

    /**
     * One pass of the integral into both LUTs. Same shader, same uniforms, two
     * resolutions, so the two hold byte-identical content.
     * @returns {void}
     */
    bake() {
        // NOTE: the *scale*, not S.sunIntensity — the reference uploads
        // sunScale into a uniform it happens to have named sunIntensity, and
        // uploading the raw slider instead makes the sky 5.5x too dim against a
        // sun that is not.
        this._bakeUniforms.uSunScale.value = this.sunScale;

        if (!this._gradeActive) {
            this._bake.render(this.lut);
            this._bake.render(this.shLut);
            return;
        }

        // Realm atmosphere: bake into a scratch target and grade into the real
        // one. Both LUTs, so the SH projection reads the SAME atmosphere the
        // skybox samples — grading only the big one would light the world in
        // Cold's blue under a Sand dome.
        this._ensureGradeTargets();
        this._bake.render(this._gradeRT);
        this._gradeUniforms.uSrc.value = this._gradeRT.texture;
        this._grade.render(this.lut);
        this._bake.render(this._gradeSH);
        this._gradeUniforms.uSrc.value = this._gradeSH.texture;
        this._grade.render(this.shLut);
    }

    /** Allocate the grade scratch targets. Lazy: Cold never pays for them. */
    _ensureGradeTargets() {
        if (this._grade) return;
        this._gradeRT = makeRT(LUT_W, LUT_H, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            generateMipmaps: false,
            name: "skyLUTraw",
        });
        this._gradeSH = makeRT(SH_W, SH_H, {
            type: THREE.FloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            generateMipmaps: false,
            name: "skySHraw",
        });
        this._grade = new FullScreenPass(this.renderer, GRADE_FRAG, this._gradeUniforms);
        this._grade.profileName = "sky realm grade";
    }

    /**
     * Give the sky a realm.
     *
     * Takes a PLAIN OBJECT — one row of `src/world/realms.js` REALMS — so `Sky`
     * stays constructible with no realm module present. Every field is optional
     * and a missing one leaves the current value standing.
     *
     * DOES NOT re-bake. The caller decides: `await sky.solve()` inside a loading
     * phase (so the first frame of the new realm is already lit by the new LUT),
     * or `_markDirty()` for the debounced path. The debounce is untouched.
     *
     * @param {Object} [block] { token, sky: {...}, ground: {...} }
     * @returns {void}
     */
    applyRealm(block) {
        const b = block || {};
        const sk = b.sky || {};
        const gd = b.ground || {};
        const u = this._skyUniforms;

        const token = typeof b.token === "string" ? b.token : this.realmName;
        this.realmName = token;

        // The bounce solve. The single most consequential number here.
        if (Array.isArray(sk.groundAlbedo) && sk.groundAlbedo.length >= 3) {
            this.groundAlbedo = [
                num(sk.groundAlbedo[0], SNOW_ALBEDO[0]),
                num(sk.groundAlbedo[1], SNOW_ALBEDO[1]),
                num(sk.groundAlbedo[2], SNOW_ALBEDO[2]),
            ];
        }

        setV3(u.uFarRockAlbedo, sk.farRockAlbedo);
        setV3(u.uFarSnowAlbedo, sk.farSnowAlbedo);
        setV3(u.uCirrusColor, sk.cirrusColor);
        // The far range's subsurface pair tracks the ground's, so a massif and
        // the field in front of it are made of the same stuff.
        setV3(u.uSssShallow, gd.sssShallow);
        setV3(u.uSssDeep, gd.sssDeep);
        u.uFarSnowGate.value.set(at(sk.farSnowLineGate, 0, u.uFarSnowGate.value.x),
                                 at(sk.farSnowLineGate, 1, u.uFarSnowGate.value.y));
        u.uCloudAmount.value = num(sk.cloudAmount, u.uCloudAmount.value);

        // The contract's intensity is PRE-extinction; the bake carries none, so
        // the missing aerosol is folded in here, from the realm row. See the
        // BEAM EXTINCTION note above for why the local table is gone.
        this._beamExtinction = num(sk.beamExtinction, 1);
        this._sunScaleMul =
            (num(sk.sunIntensity, COLD_SUN_INTENSITY) / COLD_SUN_INTENSITY)
            * this._beamExtinction;
        this._ambientMul = num(sk.ambientIntensity, COLD_AMBIENT) / COLD_AMBIENT;
        this._ridgeMul = sk.showMountains === false
            ? 0
            : num(sk.mountainHeight, COLD_MOUNTAIN_H) / COLD_MOUNTAIN_H;

        // ---- the atmosphere grade -------------------------------------------
        const G = SKY_GRADE[token] || SKY_GRADE.cold;
        this._gradeUniforms.uGradeTint.value.set(G.tint[0], G.tint[1], G.tint[2]);
        this._gradeUniforms.uHorizonTint.value.set(
            G.horizon[0], G.horizon[1], G.horizon[2]
        );
        this._gradeUniforms.uGradeParams.value.set(G.desat, G.band, G.amount, G.gain);
        this._gradeActive =
            G.desat !== 0 || G.amount !== 0 || G.gain !== 1
            || G.tint[0] !== 1 || G.tint[1] !== 1 || G.tint[2] !== 1;

        // The beam's hue follows the dome's: the grade is a scattering stand-in,
        // and a warm dome over a neutral sun reads as a colour filter rather than
        // as an atmosphere.
        this._sunTintMul.set(
            0.5 + 0.5 * G.tint[0], 0.5 + 0.5 * G.tint[1], 0.5 + 0.5 * G.tint[2]
        );

        this._dirty = true;
    }

    /** Radiance leaving the snow, from everything currently landing on it. */
    _updateGroundBounce() {
        // Irradiance arriving on horizontal ground: direct sun (cosine-weighted)
        // plus the whole sky hemisphere, which the SH already integrates.
        const up = this._irradianceUp();
        const c = Math.max(0, this.sunDir.y);
        const er = this.sunRadiance.x * c + up[0];
        const eg = this.sunRadiance.y * c + up[1];
        const eb = this.sunRadiance.z * c + up[2];

        // Lambertian re-emission: L = albedo * E / PI. The albedo is
        // blue-weighted, which is why the light coming back up off the field is
        // slightly cooler than the light going down onto it — and it compounds
        // over the three iterations.
        const k = 1 / Math.PI;
        const a = this.groundAlbedo;
        this.groundBounce.set(a[0] * er * k, a[1] * eg * k, a[2] * eb * k);
    }

    /**
     * SH irradiance for an up-facing normal — `skyIrradiance((0,1,0))` unrolled
     * to the bands that survive. Cross-check against lib/atmosphere: c4 =
     * 0.886227, 2*c2 = 1.023328, -c5 = -0.247708, -c1 = -0.429043.
     * @returns {Float32Array}
     */
    _irradianceUp() {
        const sh = this.sh;
        const out = _irrTmp;
        for (let k = 0; k < 3; k++) {
            out[k] =
                sh[0 * 4 + k] * 0.886227 +
                sh[1 * 4 + k] * 2 * 0.511664 +
                sh[6 * 4 + k] * -0.247708 +
                sh[8 * 4 + k] * -0.429043;
        }
        return out;
    }

    /**
     * Decide, from the data rather than from an assumption, which end of the
     * readback holds the zenith (PORT-6).
     *
     * `gl.readPixels` returns rows bottom-to-top in framebuffer space, and the
     * bake writes v = 0 (zenith) wherever the fullscreen triangle's vUv.y = 0
     * lands. Those two are expected to agree, but "expected" is exactly the
     * wrong basis for this: get it backwards and the SH ambient comes out warm
     * from below and cool from above, snow shadows go beige, `_irradianceUp`
     * returns the ground-bounce colour instead of the sky colour, and the
     * three-iteration solve amplifies the error every round.
     *
     * The measurement is exact rather than heuristic. On the first bake
     * groundBounce is (0,0,0), so every row below the handover is *identically*
     * zero, while the zenith row is the brightest part of the LUT at any
     * elevation the slider allows.
     * @param {Float32Array} px
     * @returns {void}
     */
    _detectRowOrder(px) {
        let first = 0;
        let last = 0;
        const lastRow = (SH_H - 1) * SH_W * 4;
        for (let x = 0; x < SH_W; x++) {
            const i = x * 4;
            first += px[i] + px[i + 1] + px[i + 2];
            const j = lastRow + x * 4;
            last += px[j] + px[j + 1] + px[j + 2];
        }
        this._rowZeroIsZenith = first >= last;
    }

    /**
     * Project the baked sky into 9 SH coefficients on the CPU.
     *
     * On the CPU rather than the GPU because it is a one-off reduction over 2048
     * texels — dispatching that would cost more to set up than to run — and
     * because the coefficients have to reach a uniform array anyway.
     * @returns {Promise<void>}
     */
    async projectSH() {
        const px = this._px;
        await this.renderer.readRenderTargetPixelsAsync(
            this.shLut, 0, 0, SH_W, SH_H, px
        );

        if (this._rowZeroIsZenith === null) this._detectRowOrder(px);
        const flip = this._rowZeroIsZenith === false;

        const sh = this.sh;
        const Y = _shBasis;
        sh.fill(0);

        // Each texel subtends dOmega = sin(theta) * (2pi/W) * (pi/H).
        const dOmega = ((2 * Math.PI) / SH_W) * (Math.PI / SH_H);

        for (let y = 0; y < SH_H; y++) {
            // y indexes *sky* rows: 0 = zenith, SH_H-1 = nadir. `row` is where
            // that landed in the readback.
            const row = flip ? SH_H - 1 - y : y;

            const theta = ((y + 0.5) / SH_H) * Math.PI;
            const st = Math.sin(theta);
            const ct = Math.cos(theta);
            const w = st * dOmega;

            for (let x = 0; x < SH_W; x++) {
                // Identical to latLongToDir at uv = ((x+0.5)/W, (y+0.5)/H).
                const phi = ((x + 0.5) / SH_W - 0.5) * 2 * Math.PI;
                const dx = st * Math.sin(phi);
                const dy = ct;
                const dz = st * Math.cos(phi);

                // Real SH basis, bands 0..2. The band-2 quadratics use dz as the
                // polar axis while the world's up axis is y — the textbook
                // Ramamoorthi-Hanrahan listing verbatim, matching the evaluation
                // in lib/atmosphere. Changing one without the other rotates the
                // ambient by 90 degrees.
                Y[0] = 0.282095;
                Y[1] = 0.488603 * dy;
                Y[2] = 0.488603 * dz;
                Y[3] = 0.488603 * dx;
                Y[4] = 1.092548 * dx * dy;
                Y[5] = 1.092548 * dy * dz;
                Y[6] = 0.315392 * (3 * dz * dz - 1);
                Y[7] = 1.092548 * dx * dz;
                Y[8] = 0.546274 * (dx * dx - dy * dy);

                const i = (row * SH_W + x) * 4;
                const r = px[i] * w;
                const g = px[i + 1] * w;
                const b = px[i + 2] * w;

                for (let c = 0; c < 9; c++) {
                    sh[c * 4] += r * Y[c];
                    sh[c * 4 + 1] += g * Y[c];
                    sh[c * 4 + 2] += b * Y[c];
                }
            }
        }

        const dst = this.uniforms.uSkySH.value;
        for (let c = 0; c < 9; c++) {
            dst[c].set(sh[c * 4], sh[c * 4 + 1], sh[c * 4 + 2], 0);
        }
    }

    /**
     * Confirm the mip chain is populated by sampling it the way the shaders do.
     *
     * `textureLod(uSkyLUT, uv, 6.0)` is the coarsest level any consumer reads
     * and 8x4 is the level it lands on; if Three's automatic regeneration did
     * not run, that lookup is black, the near-field half of the aerial
     * perspective goes black with it, and the symptom reads as a fog bug rather
     * than a texture-setup one. One draw at load turns a silent failure into a
     * loud one.
     * @returns {void}
     */
    _verifyMipChain() {
        this._probe.render(this._probeRT);
        this.renderer.readRenderTargetPixels(this._probeRT, 0, 0, 1, 1, this._probePx);
        const p = this._probePx;
        if (!(p[0] + p[1] + p[2] > 0)) {
            fail("Sky LUT mip chain is empty");
        }
    }

    /**
     * Publish this frame's uniforms. Allocation-free.
     * @param {THREE.Camera} camera
     * @param {number} time seconds — must be the same clock the terrain's wind
     *   uses, or the cirrus desynchronises from the ground.
     * @returns {void}
     */
    render(camera, time) {
        const u = this._skyUniforms;

        // Mirrored with the sun — see `core/bearing.js`. The formula is the
        // reference's; only the angle is converted into the port's frame.
        const a = bearingRad(S.windDirection);
        u.uWindDir.value.set(Math.sin(a), Math.cos(a));

        u.uCameraPos.value.copy(camera.position);
        u.uViewProj.value.multiplyMatrices(
            camera.projectionMatrix, camera.matrixWorldInverse
        );
        // Half the far plane: 2100 m at the reference's maxZ of 4200. The cube
        // is parked at the far plane by the vertex shader's depth clamp, not by
        // its size, so this only has to be comfortably inside it.
        u.uSkyScale.value = camera.far * 0.5;
        u.uTime.value = time;
        u.uSunScale.value = this.sunScale;

        // The far range. Lit by the same radiance and the same SH the snow is,
        // and hazed by the field's own fog, so the two meet at one colour.
        u.uRidgeAmp.value = S.showMountains ? S.mountainHeight * this._ridgeMul : 0;

        // uSunDir / uSunColor / uSunTint hold live references to sunDir,
        // sunRadiance and sunColor, so syncFromSettings has already updated
        // them; uFog and uAmbientIntensity are refreshed in update().
    }

    /** @returns {void} */
    dispose() {
        this._unsub();
        this.lut.dispose();
        this.shLut.dispose();
        this._probeRT.dispose();
        this._bake.dispose();
        this._probe.dispose();
        if (this._grade) this._grade.dispose();
        if (this._gradeRT) this._gradeRT.dispose();
        if (this._gradeSH) this._gradeSH.dispose();
        this.material.dispose();
        this.mesh.geometry.dispose();
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    }
}
