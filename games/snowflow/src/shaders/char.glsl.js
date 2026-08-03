/**
 * The character's body stages, and the fabric material both the body and the
 * garments are shaded with.
 *
 * Port of `snowflow_demo/src/shaders/char.vertex.wgsl`, `char.fragment.wgsl`,
 * `charDepth.vertex.wgsl` and `charPrepass.vertex.wgsl`.
 *
 * These are whole shader STAGES, not `lib/` chunks, so per ARCHITECTURE.md §1
 * they are plain string exports imported by the subsystem that owns them rather
 * than entries in the include registry. The one thing that *is* registered is
 * `lib/charSkin`, because all four programs here — plus the three in
 * `cloth.glsl.js` and the one in `fur.glsl.js` — must place a vertex at
 * literally the same world position (ARCHITECTURE.md §5).
 *
 * ---------------------------------------------------------------------------
 * WHY A PLAIN PBR DIELECTRIC IS THE WRONG MODEL, AND WHAT REPLACES IT
 *
 *   sheen        A retroreflective lobe from fibres standing proud of the
 *                surface. It is why wool has a bright RIM rather than a bright
 *                HIGHLIGHT, and it is the single term that stops this reading as
 *                painted plastic. Charlie distribution — an inverted Gaussian,
 *                so energy piles up at grazing angles instead of around the
 *                mirror direction.
 *   anisotropy   The weave has a direction. A GGX lobe stretched along the warp
 *                gives the soft directional streak real woven cloth has, and is
 *                what makes the mantle's shoulder read as a fabric plane rather
 *                than a shaded cylinder.
 *   transmission Thin fabric over a lit edge glows. The same back-scatter term
 *                the snow uses — not a coincidence, the same physics at a
 *                different mean free path.
 *
 * On top of that a procedural weave supplies a normal and a cavity at a scale
 * far below the geometry, faded out by pixel footprint so it never aliases.
 *
 * ---------------------------------------------------------------------------
 * SHARED CODE THIS STAGE DEPENDS ON
 *
 * Everything downstream of the fabric-specific BRDF is the identical code the
 * snow runs, from the registry, because the character has to sit in the same
 * light as the field or it will look pasted on no matter how good the fabric is:
 *
 *   lib/shading       wrapDiffuse, backScatter, visSmithGGXCorrelated,
 *                     fresnelSchlick, distributionGGX — and it DECLARES
 *                     `sssStrength`, so this file must not.
 *                     Get the block from `terrain.shadingUniforms`.
 *   lib/noise         hash21, hash22, noise2 (the yarn slub).
 *   lib/atmosphere    skyIrradiance, skySpecular, aerial. Declares uSkyLUT /
 *                     uSkySH / uAmbientIntensity / uFog — from `sky.uniforms`.
 *   lib/shadowLookup  sunShadow, shadowIGN. Declares the cascade block — from
 *                     `shadows.receiverUniforms(1.4, 0.012)`.
 *   lib/common        PI, INV_PI, uSunDir, uSunColor, uCameraPos (via the above).
 *
 * Only five functions are local, and all five are fabric-specific: the Charlie
 * sheen distribution, Ashikhmin's visibility term, anisotropic GGX, the
 * procedural weave, and Karis' split-sum environment BRDF.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS
 *
 * Nothing here consumes a bearing or builds a world-space basis from an angle.
 * `cotangentFrame` takes two cross products, but of screen-space derivatives of
 * a world position against the same fragment's normal — it is chirality-neutral,
 * producing a frame in whatever handedness its inputs already live in. The z
 * mirror that converts the reference's world to this port's is applied on the
 * CPU in `character/build.js` and `character/figure.js` and is invisible in every
 * shader in this subsystem except `sampleCloth`'s normal, which is discussed at
 * length in `lib/charSkin`.
 */

import { PREPASS_VS_VARYINGS, PREPASS_EMIT } from "./prepass.glsl.js";

/**
 * The five varyings every character beauty vertex stage emits and the fabric
 * fragment stage consumes. Declared once so the two halves cannot drift.
 *
 * Five interpolants (vec3, vec3, vec2, vec2, float) against the measured
 * MAX_VARYING_VECTORS of 30 (ARCHITECTURE.md §4.1) — comfortable.
 */
const BEAUTY_VARYINGS = /* glsl */`
vec3 vWorld;      // world position, metres
vec3 vNormal;     // surface normal, unit, outward
vec2 vUV;         // METRES of surface — the weave / strand-field coordinates
vec2 vAux;        // (materialId, bakedAO);  on the fur, (shellT, bakedAO)
float vViewDist;  // distance(world, uCameraPos)
`;

/** `out` form, for a vertex stage. @type {string} */
export const CHAR_VS_VARYINGS = BEAUTY_VARYINGS.replace(/^(\w)/gm, "out $1");
/** `in` form, for a fragment stage. @type {string} */
export const CHAR_FS_VARYINGS = BEAUTY_VARYINGS.replace(/^(\w)/gm, "in $1");

// -----------------------------------------------------------------------------
//  Vertex stages
// -----------------------------------------------------------------------------

/**
 * The body: two-influence linear blend skinning straight out of the transform
 * texture.
 * @type {string}
 */
export const CHAR_VERTEX = /* glsl */`
#include "lib/charSkin"

in vec3 position;   // bind-pose world position
in vec3 normal;     // bind-pose world normal
in vec2 uv;         // weave coordinates, metres of surface
in vec2 aux;        // (material id, baked occlusion)
in vec4 boneIdx;
in vec4 boneWt;

uniform mat4 uViewProj;
uniform vec3 uCameraPos;

${CHAR_VS_VARYINGS}

void main() {
    vec3 world = skinPoint(boneIdx, boneWt, position);
    vec3 n = skinNormal(boneIdx, boneWt, normal);

    vWorld = world;
    vNormal = n;
    vUV = uv;
    vAux = aux;
    vViewDist = distance(world, uCameraPos);
    gl_Position = uViewProj * vec4(world, 1.0);
}
`;

/**
 * Shadow-cascade vertex stage for the body. The identical skinning path as
 * CHAR_VERTEX through the shared include, so the surface in the depth map is the
 * surface being drawn; the only difference is which matrix projects it.
 * @type {string}
 */
export const CHAR_DEPTH_VERTEX = /* glsl */`
#include "lib/charSkin"

in vec3 position;
in vec4 boneIdx;
in vec4 boneWt;

uniform mat4 lightViewProjection;

void main() {
    vec3 world = skinPoint(boneIdx, boneWt, position);
    gl_Position = lightViewProjection * vec4(world, 1.0);
}
`;

/**
 * Depth-prepass vertex stage for the body. Same skinning path again.
 * `vMask = 0` — the character contributes no specular/SSR mask.
 * @type {string}
 */
export const CHAR_PREPASS_VERTEX = /* glsl */`
#include "lib/charSkin"

in vec3 position;
in vec4 boneIdx;
in vec4 boneWt;

uniform mat4 viewProjection;

${PREPASS_VS_VARYINGS}
${PREPASS_EMIT}

void main() {
    vec3 world = skinPoint(boneIdx, boneWt, position);
    prepassEmit(viewProjection * vec4(world, 1.0), 0.0);
}
`;

// -----------------------------------------------------------------------------
//  The fabric fragment stage
// -----------------------------------------------------------------------------

/**
 * The fabric material, shared by the skinned body and the simulated garments.
 *
 * @param {{spellLights?: boolean}} [opts] `spellLights` includes
 *   `lib/spellLights` and adds the pooled-light term. It is a parameter rather
 *   than a `#define` because the include resolver runs before the preprocessor:
 *   an `#ifdef`-guarded `#include` of a chunk SPELLS has not registered yet still
 *   expands, throws, and takes the whole character down with it.
 * @returns {string}
 */
export function charFragment(opts) {
    const spells = !!(opts && opts.spellLights);
    return /* glsl */`
#include "lib/shading"
#include "lib/atmosphere"
#include "lib/shadowLookup"
${spells ? '#include "lib/spellLights"' : "// lib/spellLights not registered — term omitted"}

${CHAR_FS_VARYINGS}

/// Per material slot: rgb = albedo, a = base roughness.
uniform vec4 matAlbedo[8];
/// Per material slot: (sheen, anisotropy, transmission, weave depth).
uniform vec4 matParams[8];
/// Weave threads per metre. UVs arrive in METRES of surface, so this is the only
/// place the physical scale of the cloth is decided.
uniform float weaveDensity;
// NB: sssStrength is declared by lib/shading, not here.

layout(location = 0) out vec4 outColor;

/// Charlie sheen distribution. 'roughness' is the FIBRE roughness and wants to
/// be high — 0.3 or below turns the rim into a hard line.
float dCharlie(float NdotH, float roughness) {
    float invR = 1.0 / max(0.05, roughness);
    float cos2h = NdotH * NdotH;
    float sin2h = max(1.0 - cos2h, 1e-4);
    return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * PI);
}

/// Ashikhmin's visibility term — cheap, and the only one that keeps sheen energy
/// sane at the grazing angles where the whole lobe lives.
float vAshikhmin(float NdotV, float NdotL) {
    return 1.0 / max(1e-4, 4.0 * (NdotL + NdotV - NdotL * NdotV));
}

/// Anisotropic GGX, Burley's parameterisation.
float dGGXAniso(float TdotH, float BdotH, float NdotH, float ax, float ay) {
    float a2 = ax * ay;
    vec3 d = vec3(ay * TdotH, ax * BdotH, a2 * NdotH);
    float d2 = dot(d, d);
    if (d2 < 1e-9) return 0.0;
    float b2 = a2 / d2;
    return a2 * b2 * b2 / PI;
}

/// Procedural plain weave: a tangent-space normal in xy and a cavity in z.
///
/// Warp and weft ALTERNATE which one is on top, and the one on top gets the
/// stronger ridge. That alternation is the whole read — two crossed sine ridges
/// without it look like a grid, not a textile.
vec3 weave(vec2 uvIn) {
    vec2 p = uvIn * 6.28318530718;
    float warp = sin(p.x);
    float weft = sin(p.y);
    float over = smoothstep(-0.35, 0.35, warp * weft);
    float nx = cos(p.x) * mix(0.30, 1.0, over);
    float ny = cos(p.y) * mix(1.0, 0.30, over);
    // Cavity is deepest where neither thread is at its crown.
    float cav = 0.55 + 0.45 * max(abs(warp), abs(weft));
    return vec3(nx, ny, cav);
}

/// Karis' analytic split-sum environment BRDF.
///
/// NOT an optimisation — a CORRECTION. Multiplying prefiltered sky radiance by
/// fresnelSchlickRough alone overestimates badly at grazing angles on a rough
/// surface: the roughness clamp makes reflectance run to (1 - roughness) there,
/// which for wool is 0.2 of the WHOLE SKY on every silhouette pixel. The result
/// was a navy robe rendering pale grey whenever the camera looked across it,
/// with the dark albedo having nothing to do with the outcome.
vec3 envBRDFApprox(vec3 f0, float roughness, float NdotV) {
    vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = vec4(roughness) * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
    return f0 * (-1.04 * a004 + r.z) + (1.04 * a004 + r.w);
}

/// Screen-space cotangent frame (Mikkelsen). Works identically for the skinned
/// body and the Catmull-Rom garments, neither of which carries an authored
/// tangent. Columns: [0] = T, [1] = B, [2] = N.
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

    // Garments are open sheets and the cowl is a shell, so the camera sees both
    // sides of nearly everything. Rather than depend on winding — which for
    // procedurally lofted geometry is one sign error away from inside-out — the
    // normal is simply turned to face the viewer. For a surface this thin that
    // is also physically the right answer.
    vec3 N = normalize(vNormal);
    if (dot(N, V) < 0.0) N = -N;
    vec3 geoN = N;

    int slot = clamp(int(vAux.x + 0.5), 0, 7);
    vec4 alb4 = matAlbedo[slot];
    vec4 par = matParams[slot];
    vec3 albedo = alb4.rgb;
    float roughness = alb4.a;
    float sheenAmt = par.x;
    float aniso = par.y;
    float transmit = par.z;
    float weaveDepth = par.w;

    // ------------------------------------------------------------ weave detail
    vec2 wuv = vUV * weaveDensity;
    vec3 dp1 = dFdx(world);
    vec3 dp2 = dFdy(world);
    vec2 duv1 = dFdx(wuv);
    vec2 duv2 = dFdy(wuv);
    mat3 TBN = cotangentFrame(N, dp1, dp2, duv1, duv2);

    // Fade the weave out once a thread is under a pixel, or it aliases into a
    // crawling moire. At 210 threads a metre the weave only exists in the near
    // field, which is exactly where a real one is visible.
    float uvFoot = max(length(duv1), length(duv2));
    float weaveFade = 1.0 - smoothstep(0.10, 0.45, uvFoot);
    float cavity = 1.0;
    if (weaveDepth > 0.001 && weaveFade > 0.001) {
        vec3 w = weave(wuv);
        N = normalize(N + (TBN[0] * w.x + TBN[1] * w.y) * weaveDepth * weaveFade * 0.5);
        cavity = mix(1.0, w.z, weaveFade * 0.8);
    }

    // Slub: real yarn is not uniform, and a little variation in the base tone
    // does more for "this is a woven thing" than another specular term. It runs
    // at CENTIMETRE scale, an order of magnitude coarser than the weave, so
    // unlike the weave it survives to the distance the figure is actually seen
    // at. Deliberately anisotropic — 9 along U, 26 along V, because yarn runs
    // one way.
    float slub = noise2(vUV * vec2(9.0, 26.0)) * 0.5 + 0.5;
    albedo *= 0.90 + 0.20 * slub;
    roughness = clamp(roughness * (0.94 + 0.12 * slub), 0.05, 1.0);

    // Baked at the vertex, times the weave cavity. No screen-space occlusion: it
    // is a two-metre silhouette against forty metres of snow and the pass does
    // not pay for itself on this content.
    float ao = vAux.y * cavity;

    // ------------------------------------------------------------- lighting
    float NdotL = dot(N, L);
    float NdotV = clamp(dot(N, V), 1e-4, 1.0);
    float noiseRot = shadowIGN(gl_FragCoord.xy) * 6.28318530718;

    float shadow = 1.0;
    if (NdotL > -0.4) {
        shadow = sunShadow(world, geoN, vViewDist, noiseRot);
    }

    vec3 sun = uSunColor;

    // --- diffuse -----------------------------------------------------------
    // Wrapped a little: fabric is not opaque at fibre scale and the terminator
    // on a sleeve is genuinely soft.
    float diff = wrapDiffuse(NdotL, 0.18);
    vec3 color = albedo * INV_PI * sun * diff * shadow;

    // --- transmission through thin cloth -----------------------------------
    // Careful with this one: sunlight through a BLUE robe multiplied by a WARM
    // sun comes back grey, so a generous transmission term does not make the
    // garment glow, it desaturates it until the albedo stops mattering. Only the
    // thin under-layer (slot 2) carries a real value.
    if (transmit > 0.001) {
        float back = backScatter(N, L, V, 0.4, 4.0, 1.0);
        color += sun * albedo * back * transmit * sssStrength * mix(0.35, 1.0, shadow);
    }

    // --- specular: anisotropic weave ---------------------------------------
    if (NdotL > 0.0) {
        vec3 H = normalize(V + L);
        float NdotH = clamp(dot(N, H), 0.0, 1.0);
        float VdotH = clamp(dot(V, H), 0.0, 1.0);

        float ar = max(0.04, roughness * roughness);
        float ax = ar * (1.0 + aniso);   // stretched along the warp
        float ay = ar / (1.0 + aniso);
        float D = dGGXAniso(dot(TBN[0], H), dot(TBN[1], H), NdotH, ax, ay);
        float Vis = visSmithGGXCorrelated(NdotV, max(NdotL, 1e-4), roughness);
        vec3 F = fresnelSchlick(VdotH, vec3(0.035));
        color += sun * D * Vis * F * NdotL * shadow;

        // --- sheen ---------------------------------------------------------
        // Tinted toward the albedo but DESATURATED: fibre scatter is closer to
        // white than the bulk colour, which is why a navy robe rims pale blue.
        //
        // Two corrections, both learned from the render rather than the paper.
        // First, the Ashikhmin visibility term runs away when both cosines are
        // small, so the lobe is clamped to 0.25. Second — the one that mattered
        // — Charlie is an INVERTED distribution: near its peak everywhere except
        // close to the mirror direction, so applied flat it is not a rim, it is
        // a uniform veil over the entire garment. At full strength it lifted a
        // navy robe to the same value as the snow behind it and erased the
        // silhouette completely. The grazing gate puts the energy back where
        // fibre scatter actually shows: the edge, where the line of sight passes
        // ALONG the pile rather than into it.
        vec3 sheenTint = mix(vec3(1.0), normalize(albedo + 1e-4), 0.35);
        float ds = dCharlie(NdotH, 0.42);
        float graze = 0.16 + 0.84 * pow(1.0 - NdotV, 2.0);
        float sheenLobe = min(ds * vAshikhmin(NdotV, max(NdotL, 1e-4)) * NdotL, 0.25);
        color += sun * sheenTint * sheenLobe * graze * sheenAmt * shadow;
    }

    // --- ambient ------------------------------------------------------------
    // skyIrradiance() already folds uAmbientIntensity in (lib/atmosphere), which
    // is where the reference's explicit (* ambientIntensity) went.
    vec3 irradiance = skyIrradiance(N);
    // SNOW BOUNCE. A figure standing on an 85%-albedo field is lit from below
    // almost as much as from above, and leaving it out is what makes characters
    // composited into snow scenes look cut out. Gated on downward-facing normals.
    float up = clamp(-N.y * 0.5 + 0.5, 0.0, 1.0);
    irradiance += skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.40 * up;

    color += albedo * INV_PI * irradiance * ao;

    // Ambient sheen: the sky wrapping around a fuzzy silhouette, and most of
    // what reads as "fuzz" when the sun is behind the figure. Kept deliberately
    // small — this term is albedo-INDEPENDENT, so any generosity erases the
    // difference between a dark robe and a light one.
    float rim = pow(1.0 - NdotV, 4.0);
    vec3 skyAmb = skyIrradiance(N) * INV_PI;
    color += skyAmb * rim * sheenAmt * 0.55 * ao;

    // Ambient specular from the sky at a roughness-selected mip. skySpecular()
    // is exactly the reference's textureSampleLevel(skyLUT, ..., sqrt(r) * 6);
    // the ambient slider is NOT folded into it, so it is applied here.
    vec3 R = reflect(-V, N);
    color += skySpecular(R, roughness) * envBRDFApprox(vec3(0.035), roughness, NdotV)
           * uAmbientIntensity * ao;
${spells ? `
    // --- spell light --------------------------------------------------------
    // The caster stands INSIDE the thing they are casting, so this is the one
    // material where the spell lights are almost always the DOMINANT source: a
    // 13-degree sun is behind the figure for most of this demo's framing, and a
    // robe lit only by sky ambient is a silhouette.
    //
    // The reference calls spellLightingSurface(world, N, V, albedo, f0,
    // roughness, wrap = 0.35, ...), which returns a fully shaded contribution.
    // ARCHITECTURE.md §3.1 publishes the narrower spellLighting(worldPos, N, V,
    // thickness), so that is what is called here and the albedo / Lambert factor
    // is applied outside it. If SPELLS ships the wider signature, this is the
    // line to change.
    color += spellLighting(world, N, V, 1.0) * albedo * INV_PI * ao;
` : ""}
    // ------------------------------------------------------- aerial perspective
    // The identical call the snow makes, on the finished colour, last.
    color = aerial(color, world);

    outColor = vec4(color, 1.0);
}
`;
}
