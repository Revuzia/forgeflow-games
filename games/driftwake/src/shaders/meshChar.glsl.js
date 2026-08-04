/**
 * The GLB mesh character's shader stages: beauty vertex + fragment, the shadow
 * cascade vertex and the depth prepass vertex.
 *
 * Whole shader STAGES, not `lib/` chunks (ARCHITECTURE.md §1) — plain string
 * exports imported by `character/meshChar.js`. The one registered piece is
 * `lib/meshSkin`, because all four programs here must place a vertex at
 * literally the same world position (ARCHITECTURE.md §5).
 *
 * ---------------------------------------------------------------------------
 * WHY THE GLB'S OWN MATERIAL CANNOT BE USED
 *
 * This scene has no Three lights: the sun, the sky SH, the cascades and the
 * spell pool all live in hand-written GLSL. A stock MeshStandardMaterial
 * evaluates Three's light uniforms — all zero here — and renders BLACK. So the
 * loader keeps only the GLB's three textures (baseColor / normal /
 * metallicRoughness, WebP 1024) and this fragment relights them with the SAME
 * stack the procedural figure uses: `sunShadow` from `lib/shadowLookup`,
 * `skyIrradiance`/`skySpecular`/`aerial` from `lib/atmosphere`, the wrapped
 * diffuse + back-scatter pair from `lib/shading`, and the pooled spell lights.
 * That shared downstream code is what makes the new rider sit in the same
 * light as the field instead of looking pasted on.
 *
 * The baseColor texture is tagged sRGB by GLTFLoader, so the hardware decodes
 * it to linear at sample time — consistent with the everything-linear rule
 * (ARCHITECTURE.md §6) even though `THREE.ColorManagement` is disabled, because
 * texture internal formats are not colour management.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS
 *
 * Nothing here builds a basis from a bearing. `cotangentFrame` is the same
 * chirality-neutral screen-space construction `char.glsl.js` uses (two cross
 * products of derivatives of the same world position), and the normal map is
 * applied through it because the Draco-compressed geometry carries no authored
 * tangents.
 */

import { PREPASS_VS_VARYINGS, PREPASS_EMIT } from "./prepass.glsl.js";

/**
 * The four varyings the beauty pair shares. Four interpolant vectors against
 * the measured MAX_VARYING_VECTORS of 30 (ARCHITECTURE.md §4.1).
 */
const BEAUTY_VARYINGS = /* glsl */`
vec3 vWorld;      // world position, metres
vec3 vNormal;     // skinned surface normal, unit
vec2 vUV;         // the GLB's authored UVs
float vViewDist;  // distance(world, uCameraPos)
`;

const VS_VARYINGS = BEAUTY_VARYINGS.replace(/^(\w)/gm, "out $1");
const FS_VARYINGS = BEAUTY_VARYINGS.replace(/^(\w)/gm, "in $1");

// -----------------------------------------------------------------------------
//  Vertex stages
// -----------------------------------------------------------------------------

/** Beauty. @type {string} */
export const MESH_CHAR_VERTEX = /* glsl */`
#include "lib/meshSkin"

in vec3 position;
in vec3 normal;
in vec2 uv;
in vec4 skinIndex;
in vec4 skinWeight;

uniform mat4 uViewProj;
uniform vec3 uCameraPos;

${VS_VARYINGS}

void main() {
    vec3 world = meshSkinPoint(position, skinIndex, skinWeight);
    vWorld = world;
    vNormal = meshSkinNormal(normal, skinIndex, skinWeight);
    vUV = uv;
    vViewDist = distance(world, uCameraPos);
    gl_Position = uViewProj * vec4(world, 1.0);
}
`;

/**
 * Shadow-cascade vertex stage. The identical skinning path through the shared
 * include; only the projecting matrix differs (ARCHITECTURE.md §5).
 * @type {string}
 */
export const MESH_CHAR_DEPTH_VERTEX = /* glsl */`
#include "lib/meshSkin"

in vec3 position;
in vec4 skinIndex;
in vec4 skinWeight;

uniform mat4 lightViewProjection;

void main() {
    vec3 world = meshSkinPoint(position, skinIndex, skinWeight);
    gl_Position = lightViewProjection * vec4(world, 1.0);
}
`;

/**
 * Depth-prepass vertex stage. Same skinning path again. `vMask = 0` — the
 * rider contributes no specular/SSR mask, exactly like the procedural body.
 * @type {string}
 */
export const MESH_CHAR_PREPASS_VERTEX = /* glsl */`
#include "lib/meshSkin"

in vec3 position;
in vec4 skinIndex;
in vec4 skinWeight;

uniform mat4 viewProjection;

${PREPASS_VS_VARYINGS}
${PREPASS_EMIT}

void main() {
    vec3 world = meshSkinPoint(position, skinIndex, skinWeight);
    prepassEmit(viewProjection * vec4(world, 1.0), 0.0);
}
`;

// -----------------------------------------------------------------------------
//  Fragment stage
// -----------------------------------------------------------------------------

/**
 * Textured PBR-lite over the port's shared lighting stack.
 *
 * @param {{spellLights?: boolean}} [opts] mirrors `charFragment` — a parameter
 *   rather than a `#define` because the include resolver runs before the
 *   preprocessor (see char.glsl.js).
 * @returns {string}
 */
export function meshCharFragment(opts) {
    const spells = !!(opts && opts.spellLights);
    return /* glsl */`
#include "lib/shading"
#include "lib/atmosphere"
#include "lib/shadowLookup"
${spells ? '#include "lib/spellLights"' : "// lib/spellLights not registered — term omitted"}

${FS_VARYINGS}

uniform sampler2D baseColorMap;   // sRGB-tagged: hardware-decoded to linear
uniform sampler2D normalMap;      // tangent space, +Y up
uniform sampler2D metalRoughMap;  // glTF packing: .g roughness, .b metallic
// NB: sssStrength is declared by lib/shading, not here.

layout(location = 0) out vec4 outColor;

/// Karis' analytic split-sum environment BRDF — the same correction
/// char.glsl.js carries, for the same reason: fresnelSchlickRough alone turns
/// every rough silhouette pixel into 20% of the whole sky.
vec3 envBRDFApprox(vec3 f0, float roughness, float NdotV) {
    vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = vec4(roughness) * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
    return f0 * (-1.04 * a004 + r.z) + (1.04 * a004 + r.w);
}

/// Screen-space cotangent frame (Mikkelsen) — no authored tangents survive the
/// Draco round trip, and this is the identical construction the fabric uses.
mat3 cotangentFrame(vec3 N, vec3 dp1, vec3 dp2, vec2 duv1, vec2 duv2) {
    vec3 dp2perp = cross(dp2, N);
    vec3 dp1perp = cross(N, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 Bv = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax = inversesqrt(max(max(dot(T, T), dot(Bv, Bv)), 1e-12));
    return mat3(T * invmax, Bv * invmax, N);
}

void main() {
    vec3 world = vWorld;
    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;   // toward the sun, world space, right-handed Y-up

    // Face the viewer, as the fabric does: the material renders double-sided
    // (hood interior, sleeve openings), and for those thin shells the flipped
    // normal is also physically the right answer.
    vec3 N = normalize(vNormal);
    if (dot(N, V) < 0.0) N = -N;
    vec3 geoN = N;

    vec4 base = texture(baseColorMap, vUV);
    vec3 albedo = base.rgb;
    vec2 mrTap = texture(metalRoughMap, vUV).gb;
    float roughness = clamp(mrTap.x, 0.06, 1.0);
    float metallic = mrTap.y;

    // ------------------------------------------------------ normal mapping
    vec3 dp1 = dFdx(world);
    vec3 dp2 = dFdy(world);
    vec2 duv1 = dFdx(vUV);
    vec2 duv2 = dFdy(vUV);
    vec3 nm = texture(normalMap, vUV).xyz * 2.0 - 1.0;
    N = normalize(cotangentFrame(N, dp1, dp2, duv1, duv2) * nm);

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

    // Wrapped, like the fabric: clothing is not opaque at fibre scale and a
    // hard terminator on a sleeve reads as painted plastic.
    float diff = wrapDiffuse(NdotL, 0.18);
    vec3 color = diffColor * INV_PI * sun * diff * shadow;

    // A sliver of through-fibre back-scatter — the subsurface character look,
    // kept far below the robe's thin-layer value because these garments are
    // opaque and a warm sun through blue cloth desaturates (char.glsl.js).
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
    // a figure on an 85%-albedo field is lit from below almost as much as from
    // above — leaving it out is what makes composited characters look cut out.
    vec3 irradiance = skyIrradiance(N);
    float up = clamp(-N.y * 0.5 + 0.5, 0.0, 1.0);
    irradiance += skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.40 * up;
    color += diffColor * INV_PI * irradiance;

    // Ambient specular at a roughness-selected mip; the ambient slider is not
    // folded into skySpecular, so it is applied here (as char.glsl.js does).
    vec3 R = reflect(-V, N);
    color += skySpecular(R, roughness) * envBRDFApprox(f0, roughness, NdotV)
           * uAmbientIntensity;
${spells ? `
    // --- spell light --------------------------------------------------------
    // The caster stands INSIDE the thing they cast; for most framings the sun
    // is behind the figure and the pool is the dominant source. Non-snow
    // response, same call the fabric makes.
    if (spellLightCount > 0.5) {
        color += spellLightingSurface(world, N, V, diffColor, f0, roughness, 0.35);
    }
` : ""}
    // ------------------------------------------------------ aerial perspective
    color = aerial(color, world);

    outColor = vec4(color, 1.0);
}
`;
}
