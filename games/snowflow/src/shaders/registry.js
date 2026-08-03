/**
 * Registers every shared GLSL chunk into the include registry in `core/glsl.js`.
 *
 * The reference did this against Babylon's `ShaderStore` and also registered
 * whole shader stages there, because Babylon resolves materials by name. Three
 * does not: a `RawShaderMaterial` is handed its source directly, so whole stages
 * stay as plain string exports imported by the subsystem that owns them. Only
 * the *shared* `lib/*` chunks — the ones two or more subsystems include — need a
 * registry, and this is it.
 *
 * `main.js` must call `registerShaders()` once, before the first material is
 * constructed. Nothing here has side effects until it is called, so import order
 * between subsystems cannot matter.
 */

import { registerAll } from "../core/glsl.js";

import common from "./lib/common.glsl.js";
import deform from "./lib/deform.glsl.js";       // [DEFORM]

// ---------------------------------------------------------------------------
// TODO — subsystem builders plug in here.
//
// Add your chunk as (a) an import above and (b) an entry in CHUNKS below, using
// exactly the name from ARCHITECTURE.md §3 so that every `#include` written
// against the contract resolves. Only the owner named in §3 writes a given
// chunk; everyone else includes it.
//
// The imports are commented rather than absent so that adding one is a matter of
// deleting two slashes and creating the file, and so a missing chunk fails at
// module load with a clear name rather than deep inside a shader compile.
//
import noise from "./lib/noise.glsl.js";                    // [TERRAIN]
import terrain from "./lib/terrain.glsl.js";                // [TERRAIN]
import clipmap from "./lib/clipmap.glsl.js";                // [TERRAIN]
//   import deform       from "./lib/deform.glsl.js";       // [DEFORM]
import shadowLookup from "./lib/shadowLookup.glsl.js";     // [SHADOWS]
import atmosphere from "./lib/atmosphere.glsl.js";   // [SKY]
import shading from "./lib/shading.glsl.js";                // [SNOW-SHADING]
//   import spellLights  from "./lib/spellLights.glsl.js";  // [SPELLS]
//   import water        from "./lib/water.glsl.js";        // [SPELLS]
//   import crystal      from "./lib/crystal.glsl.js";      // [SPELLS]
//   import wake         from "./lib/wake.glsl.js";         // [WAKE]
import charSkin from "./lib/charSkin.glsl.js";             // [CHARACTER]
import postCommon from "./lib/postCommon.glsl.js";         // [POST-CORE]
//
// ...and the matching CHUNKS entries:
//
//   "lib/noise":        noise,          // hashes, value/gradient noise with
//                                       //   analytic derivatives, fbm
//   "lib/terrain":      terrain,        // heightfield + derivatives, wind anisotropy
//   "lib/clipmap":      clipmap,        // ring placement + CDLOD morph, vertex side
//   "lib/deform":       deform,         // sampleDeform(), toroidal addressing,
//                                       //   applyDeform() — included by the beauty
//                                       //   pass AND all three shadow cascades
//   "lib/shadowLookup": shadowLookup,   // cascade select + PCSS, entry shadowAt(P, N)
//   "lib/atmosphere":   atmosphere,     // sky LUT, aerial perspective, fog, SH eval
//   "lib/shading":      shading,        // snowSubsurface(), wrapped diffuse, GGX, glints
//   "lib/spellLights":  spellLights,    // 4-slot pooled light block — every lit
//                                       //   surface includes this
//   "lib/water":        water,          // swept surface, refraction, absorption
//   "lib/crystal":      crystal,        // hex prism support
//   "lib/wake":         wake,           // wakePoint() — swept breaking-wave surface
//   "lib/charSkin":     charSkin,       // bone-matrix fetch + skinning from the
//                                       //   data texture
//   "lib/postCommon":   postCommon,     // tonemap curves, exposure, sampling helpers
//
// Two rules the resolver enforces for you, so you do not have to be careful:
//  - Registering a name twice throws. If two of you claim one chunk, boot fails
//    loudly instead of resolving to whichever import ran last.
//  - A chunk is expanded at most once per shader, so including `lib/noise` from
//    both `lib/terrain` and `lib/deform` in the same stage is fine.
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const CHUNKS = {
    // Constants, saturate/remap/expDamp, sRGB transfer pair, luminance, and the
    // shared uniform block from ARCHITECTURE.md §3. [FOUNDATION]
    "lib/common": common,

    // Hashes, gradient noise with exact analytic derivatives, damped/ridged fBm,
    // shaping helpers. The bake and the runtime must evaluate byte-identical
    // functions or the character floats. [TERRAIN]
    "lib/noise": noise,
    // windMat + the landform: terrainMacro / rockField / windLocal /
    // terrainFine(Filtered). Anisotropic about one prevailing wind. [TERRAIN]
    "lib/terrain": terrain,
    // Ring placement + CDLOD morph + the bicubic height fetch, and the single
    // clipmapSurface() call the beauty, cascade and prepass vertex stages share
    // so they cannot drift. Vertex stages only. [TERRAIN]
    "lib/clipmap": clipmap,
    // The snow BRDF: wrapped diffuse, the back-scatter subsurface term with its
    // depth-dependent blue tint, GGX, procedural grazing-gated glints, RNM normal
    // blending. Declares the sss/glint uniform block. [SNOW-SHADING]
    "lib/shading": shading,

    // Equirect sky-LUT sampling, SH irradiance (ambient slider folded in),
    // mip specular probe, and the one aerial perspective every hazed surface
    // in the frame shares. Declares the atmosphere uniform block — get it from
    // sky.uniforms. [SKY]
    "lib/atmosphere": atmosphere,
    // Tonemap curves, exposure, position rebuild, sampling helpers. [POST-CORE]
    "lib/postCommon": postCommon,

    // Bone-matrix fetch + two-influence LBS from the 48x64 transform texture,
    // and the Catmull-Rom cloth reconstruction. Declares `charTex`. Included by
    // all seven character vertex programs so beauty, depth and both cascades
    // place a vertex at literally the same world position. [CHARACTER-CLOTH]
    "lib/charSkin": charSkin,

    // Toroidal read side of the terrain state buffer: deformSample / deformHeight
    // / deformGradient, plus deformDisplace(), the single gated-displacement call
    // the beauty pass, all three shadow cascades and the depth prepass share so
    // the gate cannot drift between them. [DEFORM]
    "lib/deform": deform,

    // Cascade select + world-space PCSS. Entry point shadowAt(worldPos, N), plus
    // sunShadow() for receivers carrying their own vViewDist, and the mode-9
    // shadowMapDelta() diagnostic. Declares the whole shadow uniform block —
    // get it from shadows.receiverUniforms(). Fragment stages only. [SHADOWS]
    "lib/shadowLookup": shadowLookup,
};

let registered = false;

/**
 * Idempotent. Call once from `main.js` before constructing any material.
 * @returns {void}
 */
export function registerShaders() {
    if (registered) return;
    registered = true;
    registerAll(CHUNKS);
}
