/**
 * The skinned ENEMY body's fragment stage — the reduced sibling of
 * `meshChar.glsl.js`.
 *
 * Whole shader STAGES, not `lib/` chunks (ARCHITECTURE.md §1): plain string
 * exports imported by `combat/meshEnemies.js`. The one registered piece is
 * `lib/meshSkin`, and it arrives here only because the three VERTEX stages are
 * re-exported from `meshChar.glsl.js` VERBATIM rather than copied. That is not
 * tidiness — it is the ARCHITECTURE.md §5 property: beauty, both cascade
 * programs and the depth prepass must place a vertex at literally the same
 * world position, and the cheapest proof of that is that they run the same
 * source text. A copy here would be a second thing to keep in step.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE FRAGMENT STAGE AND NOT `meshCharFragment`
 *
 * The rider's GLB ships three maps — baseColor, normal, metallicRoughness
 * (`meshChar.js:389-397` throws without all three). The thirty enemy GLBs ship
 * exactly ONE: a base-colour JPEG (`assets/enemies/manifest.json` carries a
 * single `textureBytes` per body). Binding 1x1 dummies for the missing two
 * would cost two texture units, two samples and a screen-space cotangent frame
 * per fragment to reconstruct nothing, so they are DROPPED instead:
 *
 *   dropped   uniform sampler2D normalMap;      meshChar.glsl.js:150
 *   dropped   uniform sampler2D metalRoughMap;  meshChar.glsl.js:151
 *   dropped   the cotangentFrame() helper       meshChar.glsl.js:169-176
 *   dropped   the normal-mapping block          meshChar.glsl.js:196-202
 *   dropped   the mrTap read                    meshChar.glsl.js:192-194
 *
 * `roughness` and `metallic` become a per-body-type `uEnemyMR` vec2 instead of
 * a texture read: a rime construct, a bone knight and a slag brute do want
 * different values, but none of them wants them to vary ACROSS one body, and a
 * uniform costs nothing where a sample costs a unit.
 *
 * EVERYTHING ELSE STAYS, and that is the point. `sunShadow` from
 * `lib/shadowLookup`, `wrapDiffuse` + `backScatter` from `lib/shading`,
 * `skyIrradiance` / `skySpecular` / `aerial` from `lib/atmosphere`, the pooled
 * spell lights, and — most importantly — the 0.40 snow-bounce up-term, whose
 * justification at `meshChar.glsl.js:242-243` ("a figure on an 85%-albedo field
 * is lit from below almost as much as from above — leaving it out is what makes
 * composited characters look cut out") applies to a creature standing in the
 * same drift with exactly the same force. An enemy lit by a different stack is
 * an enemy that reads as pasted on.
 *
 * ---------------------------------------------------------------------------
 * THE TWO PER-DRAW BOXES
 *
 * One material serves every instance of one body type, so the two things that
 * differ between instances ride uniform boxes rewritten by the shared
 * `onBeforeRender` in `meshEnemies.js` (the `enemyVis.js:216` house pattern):
 *
 *   uEnemyState  x flash 0..1   THE TELEGRAPH. The single most important
 *                               readable channel in combat (COMBAT_DESIGN §0
 *                               pillar 2) — it drives an emissive rim that
 *                               climbs the body through the windup, and it is
 *                               deliberately additive AFTER the lighting so no
 *                               shadow, sun angle or fog can swallow it.
 *                y dissolve 0..1  death, 1.2 s
 *                z seed 0..1      per-instance phase, kills lockstep pulsing
 *                w tintMix 0..1   how much of uEnemyTint to fold into albedo
 *   uEnemyTint   rgb              the MESH_REUSE dress-up colour (roster.js's
 *                                 `tint` is a TOKEN, not a hex — "the material
 *                                 work is the renderer's call", roster.js:628)
 *
 * DISSOLVE IS NOT AN ALPHA FADE. The material is opaque and depth-writing
 * (`meshChar.js:428-432`, NOT `enemyVis.js:284-288` — an opaque body in the
 * transparent bucket sorts every frame for nothing), and the shadow cascade and
 * prepass stages are the SHARED depth fragments, which cannot discard. So the
 * death is carried by the death CLIP plus a root-level sink driven in
 * `meshEnemies.js`: the body's world position comes out of the bone matrices,
 * so beauty, prepass and cascade all sink together by construction. All this
 * stage adds is the ember flare — the light going out of the thing.
 */

import {
    MESH_CHAR_VERTEX, MESH_CHAR_DEPTH_VERTEX, MESH_CHAR_PREPASS_VERTEX,
} from "./meshChar.glsl.js";

/**
 * Beauty vertex stage — `meshChar`'s, unchanged. Skins through `lib/meshSkin`
 * and emits `vWorld / vNormal / vUV / vViewDist`.
 * @type {string}
 */
export const ENEMY_SKIN_VERTEX = MESH_CHAR_VERTEX;

/**
 * Shadow-cascade vertex stage — `meshChar`'s, unchanged.
 * @type {string}
 */
export const ENEMY_SKIN_DEPTH_VERTEX = MESH_CHAR_DEPTH_VERTEX;

/**
 * Depth-prepass vertex stage — `meshChar`'s, unchanged. Emits `vMask = 0`,
 * which is right for an enemy for the same reason it is right for the rider:
 * flesh and rime plate are not mirror ice, and the SSR gate is the mask.
 * @type {string}
 */
export const ENEMY_SKIN_PREPASS_VERTEX = MESH_CHAR_PREPASS_VERTEX;

/**
 * The four varyings the beauty pair shares — identical to
 * `meshChar.glsl.js:45-50`, because the vertex stage above is literally that
 * file's. Four interpolant vectors against the measured MAX_VARYING_VECTORS of
 * 30 (ARCHITECTURE.md §4.1).
 */
const FS_VARYINGS = /* glsl */`
in vec3 vWorld;      // world position, metres
in vec3 vNormal;     // skinned surface normal, unit
in vec2 vUV;         // the GLB's authored UVs
in float vViewDist;  // distance(world, uCameraPos)
`;

/**
 * Single-map PBR-lite over the port's shared lighting stack, plus the
 * telegraph.
 *
 * @param {{spellLights?: boolean}} [opts] mirrors `meshCharFragment` — a
 *   parameter rather than a `#define`, because the include resolver runs before
 *   the preprocessor (see `char.glsl.js`).
 * @returns {string}
 */
export function enemySkinFragment(opts) {
    const spells = !!(opts && opts.spellLights);
    return /* glsl */`
#include "lib/shading"
#include "lib/atmosphere"
#include "lib/shadowLookup"
${spells ? '#include "lib/spellLights"' : "// lib/spellLights not registered — term omitted"}

${FS_VARYINGS}

uniform sampler2D baseColorMap;   // sRGB-tagged: hardware-decoded to linear
uniform vec2 uEnemyMR;            // per body TYPE: x roughness, y metallic
uniform vec4 uEnemyState;         // per DRAW: x flash, y dissolve, z seed, w tintMix
uniform vec4 uEnemyTint;          // per DRAW: rgb dress-up colour
// NB: sssStrength is declared by lib/shading, not here.

layout(location = 0) out vec4 outColor;

/// The telegraph colour: pale rime-light, the SAME value the shard placeholder
/// flares (enemyVis.js:119 CORE_COL). Deliberate — a player who has learned
/// "cyan glow means it is about to hit you" keeps that reading when the shard
/// constructs are replaced by real bodies.
const vec3 TELL_COL = vec3(0.40, 0.85, 1.00);
/// Death's ember: the complement, so a death never reads as another windup.
const vec3 EMBER_COL = vec3(1.00, 0.62, 0.28);

/// Karis' analytic split-sum environment BRDF — the same correction
/// meshChar.glsl.js carries, for the same reason: fresnelSchlickRough alone
/// turns every rough silhouette pixel into 20% of the whole sky.
vec3 envBRDFApprox(vec3 f0, float roughness, float NdotV) {
    vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = vec4(roughness) * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
    return f0 * (-1.04 * a004 + r.z) + (1.04 * a004 + r.w);
}

void main() {
    vec3 world = vWorld;
    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;   // toward the sun, world space, right-handed Y-up

    // Face the viewer. A watertight Meshy body has no thin shells, so the
    // material renders FrontSide (meshEnemies.js) and this flip is belt and
    // braces at silhouette pixels where the interpolated normal has already
    // turned past grazing — one instruction, and it costs nothing to keep the
    // diff against meshChar.glsl.js:186-188 readable.
    vec3 N = normalize(vNormal);
    if (dot(N, V) < 0.0) N = -N;
    vec3 geoN = N;

    float flash = uEnemyState.x;
    float dissolve = uEnemyState.y;
    float seed = uEnemyState.z;

    vec4 base = texture(baseColorMap, vUV);
    // The MESH_REUSE dress-up: six combatData rows have no body of their own
    // and wear another unit's mesh (roster.js MESH_REUSE). Tinting the albedo
    // is the whole difference between "the Ice Cultist again" and a Hoarfrost
    // Sprite, and it costs one mix.
    vec3 albedo = mix(base.rgb, base.rgb * uEnemyTint.rgb, uEnemyState.w);
    float roughness = clamp(uEnemyMR.x, 0.06, 1.0);
    float metallic = uEnemyMR.y;

    // ------------------------------------------------------------ lighting
    float NdotL = dot(N, L);
    float NdotV = clamp(dot(N, V), 1e-4, 1.0);
    float noiseRot = shadowIGN(gl_FragCoord.xy) * 6.28318530718;

    float shadow = 1.0;
    if (NdotL > -0.4) {
        shadow = sunShadow(world, geoN, vViewDist, noiseRot);
    }

    vec3 sun = uSunColor;
    vec3 diffColor = albedo * (1.0 - metallic);

    // Wrapped, exactly as the rider is: a hard terminator on a hide or a
    // bandage wrap reads as painted plastic at this sun elevation.
    float diff = wrapDiffuse(NdotL, 0.18);
    vec3 color = diffColor * INV_PI * sun * diff * shadow;

    // A sliver of through-body back-scatter, kept at the rider's opaque-garment
    // value rather than the robe's thin-layer one.
    float back = backScatter(N, L, V, 0.4, 4.0, 1.0);
    color += sun * diffColor * back * 0.06 * sssStrength * mix(0.35, 1.0, shadow);

    // --- specular ----------------------------------------------------------
    vec3 f0 = mix(vec3(0.04), albedo, metallic);
    if (NdotL > 0.0) {
        vec3 H = normalize(V + L);
        float NdotH = clamp(dot(N, H), 0.0, 1.0);
        float VdotH = clamp(dot(V, H), 0.0, 1.0);
        float D = distributionGGX(NdotH, roughness);
        float Vis = visSmithGGXCorrelated(NdotV, max(NdotL, 1e-4), roughness);
        vec3 F = fresnelSchlick(VdotH, f0);
        color += sun * D * Vis * F * NdotL * shadow;
    }

    // --- ambient ------------------------------------------------------------
    // skyIrradiance() folds uAmbientIntensity in (lib/atmosphere). SNOW BOUNCE:
    // the 0.40 up-term is what stops a body on an 85%-albedo field reading as
    // a cut-out (meshChar.glsl.js:242-247) — an enemy needs it as much as the
    // rider, and more, because it is usually the thing being looked at.
    vec3 irradiance = skyIrradiance(N);
    float up = clamp(-N.y * 0.5 + 0.5, 0.0, 1.0);
    irradiance += skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.40 * up;
    color += diffColor * INV_PI * irradiance;

    vec3 R = reflect(-V, N);
    color += skySpecular(R, roughness) * envBRDFApprox(f0, roughness, NdotV)
           * uAmbientIntensity;
${spells ? `
    // --- spell light --------------------------------------------------------
    // The player fights INSIDE their own spells; for most framings the pool is
    // brighter on an enemy's near face than the low sun is.
    if (spellLightCount > 0.5) {
        color += spellLightingSurface(world, N, V, diffColor, f0, roughness, 0.35);
    }
` : ""}
    // ------------------------------------------------------------ THE TELL
    // The telegraph rim. Added AFTER the lighting and BEFORE the aerial
    // perspective, deliberately: a windup that a cast shadow or a fog bank can
    // hide is not a telegraph, it is a coin flip. It rides the Fresnel so it
    // reads as the body's own edge lighting up rather than a flat wash, and it
    // climbs with 'flash' so the eye reads PROGRESS, not just presence — the
    // player is being told how long is left, which is the entire contract.
    float rim = pow(1.0 - NdotV, 2.4);
    float pulse = 0.85 + 0.15 * sin(uTime * 26.0 + seed * 31.0);
    color += TELL_COL * flash * pulse * (0.55 * rim + 0.18 * flash);

    // Death: the light goes out of it. The BODY's motion is the death clip
    // plus the root sink in meshEnemies.js (which the cascades and the prepass
    // follow for free, through the same bone matrices); this is only the
    // ember — a short warm flare that decays, over an albedo draining to ash.
    if (dissolve > 0.0) {
        float ember = dissolve * (1.0 - dissolve) * 4.0;
        color = mix(color, color * 0.28, dissolve);
        color += EMBER_COL * ember * (0.35 + 0.65 * rim);
    }

    // ------------------------------------------------------ aerial perspective
    color = aerial(color, world);

    outColor = vec4(color, 1.0);
}
`;
}
