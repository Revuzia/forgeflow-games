/**
 * The snow material — the beauty vertex and fragment stages, plus the two
 * depth-only vertex stages that must place a vertex at literally the same world
 * position (ARCHITECTURE.md §5).
 *
 * Port of `snow.vertex.wgsl`, `snow.fragment.wgsl`, `terrainDepth.vertex.wgsl`
 * and `terrainPrepass.vertex.wgsl`. All four vertex programs are one line of
 * placement code each, because the placement itself lives in `lib/clipmap`'s
 * `clipmapSurface()` — see the note there on why that is not a stylistic choice.
 *
 * ---------------------------------------------------------------------------
 * NORMALS ARRIVE FROM FOUR INDEPENDENT SOURCES and have to be combined in the
 * right order or the surface stops holding together:
 *
 *   macro     baked landform gradient        tens of metres -> ~1 m   (auxTex.rg)
 *   fine      analytic sastrugi and ripples  ~2 m -> ~10 cm  (terrainFineFiltered)
 *   detail    tiled generated grain map      ~10 cm -> ~5 mm (detailTex, 3 scales)
 *   deform    the terrain state buffer       whatever the player carved
 *
 * Macro, fine and deform are all *heightfield gradients* in world space, so they
 * add as SLOPES before ever becoming a normal. Only the detail map is a
 * tangent-space normal, and it is folded in last with reoriented normal mapping.
 * Adding normals instead of slopes is the classic way to lose the landform under
 * the detail.
 *
 * ---------------------------------------------------------------------------
 * VARYINGS — 2 of the 30 available vectors (ARCHITECTURE.md §4.1).
 *
 *     vec4 vWorld      xyz = world position, w = distance to the camera
 *     vec2 vHeightUV   height/aux texture UV
 *
 * The reference carries four separate varyings (vWorld, vHeightUV, vViewDist,
 * vSpacing) = 4 slots. `vSpacing` is declared but never read in the reference's
 * fragment stage, so it is dropped; `vViewDist` is packed into vWorld.w. Nothing
 * else is interpolated — the fragment stage recomputes from world position
 * instead, which is the §4.1 instruction and is also what keeps the deformation
 * and detail layers consistent between the passes.
 *
 * ---------------------------------------------------------------------------
 * TEXTURE UNITS in the fragment stage — 8 of the 16 available:
 *   auxTex, detailTex, deformTex (lib/deform), uSkyLUT (lib/atmosphere),
 *   cascade0/1/2 (lib/shadowLookup)
 * and 3 in each vertex stage: heightTex, auxTex, deformTex.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6). Four sign-sensitive lines, all marked:
 *   · `V = normalize(uCameraPos - world)` points from the surface TOWARD the eye,
 *     and `L = uSunDir` points from the surface TOWARD the sun. Both are the
 *     conventions `lib/shading` and `lib/atmosphere` document, and they are what
 *     fixes the sign of the back-scatter lobe.
 *   · `aerial()` wants the opposite: the direction light travels toward the eye,
 *     which is `-V`. It takes the world position and derives it itself.
 *   · The (T, B, N) basis for the detail lift is right-handed in Three's frame.
 *   · `reflect(-V, N)` is the standard GLSL reflection about N; `reflect` takes
 *     the INCIDENT direction, so it is fed -V (eye toward surface), not V.
 */

import { PREPASS_VS_VARYINGS, PREPASS_EMIT } from "./prepass.glsl.js";

// ---------------------------------------------------------------------------
// Vertex stages
// ---------------------------------------------------------------------------

/**
 * Beauty-pass vertex stage.
 *
 * `position` is not a position: it packs the clipmap addressing as
 * (gridI, ringLevel, gridJ). `uViewProj` and `uCameraPos` come from `lib/common`
 * through the include chain; the camera position is used ONLY for the view
 * distance, never for placement, which is centred on `lodCenter` (the character).
 * @type {string}
 */
export const vertex = /* glsl */ `
#include "lib/clipmap"

in vec3 position;

out vec4 vWorld;      // xyz world position, w distance to the camera
out vec2 vHeightUV;

void main() {
    ClipmapSurface s = clipmapSurface(position);

    vWorld = vec4(s.world, distance(s.world, uCameraPos));
    vHeightUV = s.heightUV;

    gl_Position = uViewProj * vec4(s.world, 1.0);
}
`;

/**
 * Shadow-cascade vertex stage.
 *
 * Critically, this places the clipmap from the *same* `lodCenter` the beauty pass
 * uses, not from the light — the geometry rendered into the shadow map must be
 * the identical mesh the beauty pass draws, or the depths will not correspond and
 * the terrain will acne against its own silhouette. Only the projection differs.
 *
 * `lightViewProjection` is written in place by `ShadowSystem.render()`, once per
 * cascade; one material per cascade so nothing is swapped mid-frame.
 * @type {string}
 */
export const cascadeVertex = /* glsl */ `
#include "lib/clipmap"

in vec3 position;

uniform mat4 lightViewProjection;

void main() {
    ClipmapSurface s = clipmapSurface(position);
    gl_Position = lightViewProjection * vec4(s.world, 1.0);
}
`;

/**
 * Depth-prepass vertex stage.
 *
 * Byte-for-byte the same placement as the beauty and cascade stages, from the
 * same include. If this pass placed a vertex anywhere else, every screen-space
 * effect downstream would be integrating against a surface that is not the one on
 * screen — and the symptom of that is an ambient-occlusion halo that follows the
 * camera, which reads as a rendering bug rather than as a mismatch.
 *
 * Writes the ice channel into the prepass mask so the SSR pass knows where the
 * glaze is. Read straight rather than through `deformHeightAt`'s binomial: this
 * feeds a reflection gate, not a displacement, so smoothing it to the vertex
 * lattice would only soften the edge of a glaze the fragment stage draws hard.
 * @type {string}
 */
export const prepassVertex = /* glsl */ `
#include "lib/clipmap"
` + PREPASS_VS_VARYINGS + PREPASS_EMIT + /* glsl */ `

in vec3 position;

uniform mat4 viewProjection;   // shared by reference with depthPass; carries TAA jitter

void main() {
    ClipmapSurface s = clipmapSurface(position);
    prepassEmit(viewProjection * vec4(s.world, 1.0), deformIceMask(s.world.xz));
}
`;

// ---------------------------------------------------------------------------
// Fragment stage
// ---------------------------------------------------------------------------

const FRAGMENT_HEAD = /* glsl */ `
#include "lib/noise"
#include "lib/terrain"
#include "lib/deform"
#include "lib/shading"
`;

/**
 * `lib/spellLights` [SPELLS] declares `spellLighting()`. Included between
 * `lib/shading` and `lib/atmosphere`, matching the reference's include order —
 * the spell-light chunk calls `wrapDiffuse`, `snowSubsurface`, `distributionGGX`,
 * `visSmithGGXCorrelated` and `fresnelSchlick`, so `lib/shading` must precede it.
 */
const FRAGMENT_SPELLS = /* glsl */ `
#include "lib/spellLights"
`;

/**
 * The stand-in used only when `lib/spellLights` is not registered — i.e. while
 * SPELLS is still being built. It is a compile-time scaffold, NOT a fallback that
 * should survive into a finished port: with it in place the snow is lit by the
 * sun and the sky and nothing else, so shots 07-11 lose the spell's effect on the
 * ground entirely. `Terrain` reports which of the two it took on
 * `terrain.spellLightsBound`.
 */
const FRAGMENT_SPELLS_STUB = /* glsl */ `
vec3 spellLightingSnow(
    vec3 world, vec3 N, vec3 V, float thickness, float strength, float radius
) {
    return vec3(0.0);
}
`;

const FRAGMENT_BODY = /* glsl */ `
#include "lib/atmosphere"
// After the includes above and after this stage's own uniforms, exactly as the
// reference orders it: the cascade lookup needs nothing from here but is a large
// chunk and reads better last.
#include "lib/shadowLookup"

in vec4 vWorld;       // xyz world position, w distance to the camera
in vec2 vHeightUV;

uniform sampler2D auxTex;
uniform sampler2D detailTex;

uniform float windAngle;
uniform float sastrugiAmp;
uniform float detailStrength;

uniform float debugMode;

layout(location = 0) out vec4 outColor;

/// Unpack a two-channel tangent-space normal.
vec3 unpackN(vec2 rg) {
    vec2 xy = rg * 2.0 - 1.0;
    return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

/// Triplanar detail-normal fetch. Snow on a steep rock face has no sensible
/// planar projection, and stretching the grain up a 60-degree slope is instantly
/// legible as a smear.
///
/// Gradients are passed in rather than taken here: every call site sits behind a
/// footprint test, and taking implicit derivatives under non-uniform control flow
/// is undefined. Explicit gradients keep full mip filtering — which this
/// absolutely needs, since the whole point of the fade-in is anti-aliasing.
vec3 detailNormal(
    vec3 world, vec3 N, float scale, float blendSteep, vec3 ddxW, vec3 ddyW
) {
    vec3 n = unpackN(textureGrad(
        detailTex, world.xz * scale, ddxW.xz * scale, ddyW.xz * scale
    ).xy);

    if (blendSteep > 0.01) {
        vec3 a = unpackN(textureGrad(
            detailTex, world.xy * scale, ddxW.xy * scale, ddyW.xy * scale
        ).xy);
        vec3 b = unpackN(textureGrad(
            detailTex, world.zy * scale, ddxW.zy * scale, ddyW.zy * scale
        ).xy);
        vec3 w = abs(N);
        float sum = w.x + w.y + w.z;
        n = normalize(mix(n, (a * w.z + b * w.x + n * w.y) / sum, blendSteep));
    }
    return n;
}

void main() {
    vec3  world = vWorld.xyz;
    float viewDist = vWorld.w;
    // Surface -> eye, and surface -> sun. Both conventions are what fixes the
    // sign of the back-scatter lobe in lib/shading; see the note there.
    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;

    // World-space size of this pixel — drives every filtering decision below.
    // Taken once here, in uniform control flow, and threaded down to the texture
    // fetches that sit behind footprint tests.
    vec3 ddxW = dFdx(world);
    vec3 ddyW = dFdy(world);
    float footprint = max(length(vec2(length(ddxW.xz), length(ddyW.xz))), 1e-4);

    // The *narrow* axis of that footprint, which is a very different number.
    //
    // At grazing incidence a pixel's world footprint is a long thin sliver: one
    // axis blows up while the other stays small. 'footprint' above averages the
    // two, so simply tilting the camera down towards the horizon inflates it by an
    // order of magnitude — and anything keyed off it fades out, even though the
    // surface is no further away and is still perfectly resolvable across the
    // sliver's short axis. For the natural detail layers that trade is fine and
    // deliberate. For carved snow it is not: it means the trail changes shape when
    // you move the camera and not the player, which reads as a bug because it is
    // one. Same reasoning anisotropic texture filtering runs on.
    float footprintMin = max(min(length(ddxW.xz), length(ddyW.xz)), 1e-4);

    // ---------------------------------------------------------------- slopes
    vec4 aux = textureLod(auxTex, vHeightUV, 0.0);
    vec2  grad = aux.xy;
    float rockMask = aux.z;
    float exposure = aux.w;

    vec3 fine = terrainFineFiltered(world.xz, windAngle, exposure, sastrugiAmp, footprint);
    grad += fine.yz;

    // ------------------------------------------------------------ deformation
    // Depression, displaced berm mass, compression and ice, written by feet, the
    // surf wake and every spell. Read here so lighting responds to carved snow
    // exactly as it does to natural relief. lib/deform's deformSurface() carries
    // the widening central difference, the 5-tap state blend and the window
    // falloff — see the long note there on why the baseline widens with the pixel
    // instead of the trail being faded out with distance.
    vec2 dGrad;
    vec4 df = deformSurface(world.xz, footprintMin, dGrad);
    float deformDepth = df.r;
    float deformBerm  = df.g;
    float compression = df.b;
    float iceAmount   = df.a;
    grad += dGrad;

    vec3 N = normalFromGradient(grad);

    // The surface the *depth pass* rendered: macro landform, the analytic fine
    // layer and carved snow, but nothing finer. The shading normal below picks up
    // three tiled grain scales on top of this, and biasing the shadow lookup
    // against that would describe a surface orders of magnitude higher in
    // frequency than the one in the depth map — the offset would point off in a
    // different direction on every pixel and reintroduce the noise it exists to
    // remove.
    vec3 geoN = N;

    // ---------------------------------------------------------- detail normals
    // Three tiling scales, each faded by footprint so the finest only exists when
    // it is actually resolvable, and cross-faded so no scale ever pops in.
    float steep = smoothstep(0.55, 0.9, 1.0 - N.y);
    if (detailStrength > 0.001) {
        vec3 acc = vec3(0.0, 0.0, 1.0);

        float fA = 1.0 - smoothstep(0.004, 0.02, footprint);
        if (fA > 0.001) {
            vec3 d = detailNormal(world, N, 7.5, steep, ddxW, ddyW);
            acc = blendNormalRNM(acc, mix(vec3(0.0, 0.0, 1.0), d, fA));
        }
        float fB = 1.0 - smoothstep(0.02, 0.12, footprint);
        if (fB > 0.001) {
            vec3 d = detailNormal(world, N, 1.7, steep, ddxW, ddyW);
            acc = blendNormalRNM(acc, mix(vec3(0.0, 0.0, 1.0), d, fB * 0.85));
        }
        float fC = 1.0 - smoothstep(0.1, 0.7, footprint);
        if (fC > 0.001) {
            vec3 d = detailNormal(world, N, 0.31, steep, ddxW, ddyW);
            acc = blendNormalRNM(acc, mix(vec3(0.0, 0.0, 1.0), d, fC * 0.6));
        }

        // Lift the tangent-space result onto the geometric normal. Right-handed
        // (T, B, N) in Three's world frame; the detail is statistically isotropic
        // so the chirality is invisible, but it is written correctly anyway.
        vec3 up = (abs(N.y) > 0.99) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 T = normalize(cross(up, N));
        vec3 B = cross(N, T);
        float s = detailStrength * mix(1.0, 0.45, compression);
        N = normalize(N + (T * acc.x + B * acc.y) * s);
    }

    float cavity = textureGrad(
        detailTex, world.xz * 1.7, ddxW.xz * 1.7, ddyW.xz * 1.7
    ).z;

    // ------------------------------------------------------------- material
    // Snow albedo sits in a narrow, high, slightly blue band. It is never 1.0:
    // pushing albedo to white is what produces the blown-out clipped highlights
    // that read as "untextured white blob" rather than as snow.
    vec3  albedo = vec3(0.855, 0.885, 0.945);
    float roughness = 0.62;
    vec3  f0 = vec3(0.028);
    float thickness = 1.0;   // 1 = deep drift, 0 = thin crust

    // Compressed snow: denser, darker, tighter specular, scatters less.
    albedo = mix(albedo, vec3(0.62, 0.665, 0.755), compression * 0.85);
    roughness = mix(roughness, 0.34, compression);
    thickness = mix(thickness, 0.35, compression);

    // Refrozen ice: smooth and genuinely reflective.
    albedo = mix(albedo, vec3(0.42, 0.56, 0.70), iceAmount * 0.8);
    roughness = mix(roughness, 0.07, iceAmount);
    f0 = mix(f0, vec3(0.045), iceAmount);
    thickness = mix(thickness, 0.15, iceAmount);

    // Exposed rock. Snow keeps its grip on the flatter faces, so the mask is
    // gated by slope rather than applied flat.
    float rockExposed = rockMask * smoothstep(0.32, 0.66, 1.0 - N.y);
    if (rockExposed > 0.001) {
        float rn = noise2(world.xz * 2.3) * 0.5 + 0.5;
        vec3 rockCol = mix(vec3(0.055, 0.058, 0.068), vec3(0.115, 0.112, 0.118), rn);
        albedo = mix(albedo, rockCol, rockExposed);
        roughness = mix(roughness, 0.85, rockExposed);
        thickness = mix(thickness, 0.0, rockExposed);
    }

    // --- carved-snow surface state -----------------------------------------
    // Freshly displaced mass is the opposite of trodden snow: it has just been
    // broken up and thrown, so it is loose, bright and rough. Without this the
    // berms shade identically to the trench and the whole trail flattens into one
    // grey smear.
    //
    // Both numbers here must not make carved snow *less blue*, which is the one
    // axis this material cannot afford to lose. Drain the cool cast out of a
    // heavily worked patch and it reads as bare ground even while its luminance
    // goes up — a warm-grey patch surrounded by blue-white snow is not snow.
    //
    //  1. The loose colour is brighter than base snow in every channel and very
    //     slightly bluer, which is also the truer answer: freshly broken snow has
    //     more surface per unit volume and scatters more, and snow's scattering is
    //     what its blue comes from.
    //  2. Roughness 0.78, not higher: that term feeds the ambient sky specular
    //     through both the roughness-dependent Fresnel and a blurrier mip, and
    //     that specular is one of the bluest things in the frame. Loose snow is
    //     still rougher than packed — it should be — just not by enough to strip
    //     the sky out of it.
    if (deformBerm > 0.002) {
        float loose = clamp(deformBerm * 5.0, 0.0, 1.0);
        albedo = mix(albedo, vec3(0.895, 0.920, 0.965), loose * 0.55);
        roughness = mix(roughness, 0.78, loose * 0.7);
        thickness = mix(thickness, 1.0, loose * 0.6);
        // Broken snow has crystal faces pointing everywhere, which is where the
        // chunky granular read at a trail edge actually comes from.
        float chunk = noise2(world.xz * 34.0) * 0.5 + 0.5;
        albedo *= 1.0 - loose * 0.10 * chunk;
    }

    // Micro-occlusion in the grain crevices, and stronger in carved trenches. See
    // the note where this is applied, at the bottom: it scales the whole radiance,
    // not the ambient, and it carries a blue shift with it.
    //
    // Analytic only, deliberately. A snow field is the worst possible content for
    // a screen-space occlusion pass: an open, smooth, high-albedo surface viewed
    // at grazing angles, so the estimator has almost no real occluders to find and
    // what it returns is dominated by its own view-dependent bias — a broad, soft
    // darkening keyed to distance from the camera, which slides across the ground
    // when the camera moves and nothing else does.
    float ao = mix(1.0, cavity, 0.35 * (1.0 - smoothstep(0.02, 0.25, footprint)))
             * (1.0 - clamp(deformDepth * 1.9, 0.0, 1.0) * 0.38);

    // ------------------------------------------------------------- lighting
    float NdotL = dot(N, L);                        // deliberately NOT clamped
    float NdotV = clamp(dot(N, V), 1e-4, 1.0);

    // Stable per-pixel rotation for the shadow filter. IGN over pixel coords is
    // exactly the noise TAA is built to resolve.
    float noiseRot = ign(gl_FragCoord.xy) * 6.28318530718;

    float shadow = 1.0;
    // Skipped entirely below NdotL = -0.35, which is well past the geometric
    // terminator, because the wrapped diffuse still delivers light there.
    if (NdotL > -0.35) {
        shadow = sunShadow(world, geoN, viewDist, noiseRot);
    }

    vec3 sunRadiance = uSunColor;

    // --- direct diffuse, wrapped -------------------------------------------
    // Snow's mean free path is millimetres, so light wraps well past the
    // geometric terminator. This is why snow shadow edges are soft even where the
    // shadow map is pin sharp.
    float wrapAmount = mix(0.62, 0.15, max(compression, rockExposed));
    float diff = wrapDiffuse(NdotL, wrapAmount);
    vec3 direct = albedo * INV_PI * sunRadiance * diff * shadow;

    // --- subsurface --------------------------------------------------------
    // THE signature term. Reference argument order (N, L, V, ...).
    vec3 sss = snowSubsurface(
        N, L, V, sunRadiance, thickness,
        sssStrength * (1.0 - rockExposed), sssRadius
    );
    // Only partly shadowed: scattered light arrives through the snow, so a
    // shadowed drift lip still glows. Killing this with the shadow term is what
    // makes shadowed snow go flat and grey. The 0.42 floor is not optional.
    direct += sss * albedo * mix(0.42, 1.0, shadow);

    // --- direct specular ---------------------------------------------------
    if (NdotL > 0.0) {
        vec3  H = normalize(V + L);
        float NdotH = clamp(dot(N, H), 0.0, 1.0);
        float VdotH = clamp(dot(V, H), 0.0, 1.0);
        float D = distributionGGX(NdotH, roughness);
        float Vis = visSmithGGXCorrelated(NdotV, NdotL, roughness);
        vec3  F = fresnelSchlick(VdotH, f0);
        direct += sunRadiance * D * Vis * F * NdotL * shadow;
    }

    // --- ambient -----------------------------------------------------------
    // Sky irradiance from SH. Strongly blue by construction, which is the other
    // half of the warm-light / cool-shadow split that sells snow. skyIrradiance()
    // already folds S.ambientIntensity in (lib/atmosphere), which is why the
    // reference's explicit multiply is absent here and present on the specular.
    vec3 irradiance = skyIrradiance(N);

    // Snow bounces onto itself: a huge, bright, near-white surround. Without a
    // bounce term the troughs go far too dark for a material with 0.85 albedo.
    // bounceUp is 0 for an up-facing normal and 1 for a down-facing one — the
    // more a surface faces down, the more bounce it receives — and the term is
    // tinted by the receiving surface's own albedo, a crude colour bleed.
    float bounceUp = clamp(-N.y * 0.5 + 0.5, 0.0, 1.0);
    irradiance += skyIrradiance(vec3(0.0, 1.0, 0.0)) * 0.28 * bounceUp * albedo;

    vec3 ambient = albedo * INV_PI * irradiance;

    // Ambient specular from the sky, at a roughness-selected mip
    // (sqrt(roughness) * 6, inside skySpecular). reflect() takes the INCIDENT
    // direction, so it is fed -V.
    vec3 R = reflect(-V, N);
    vec3 skyRefl = skySpecular(R, roughness);
    vec3 Fr = fresnelSchlickRough(NdotV, f0, roughness);
    ambient += skyRefl * Fr * uAmbientIntensity * mix(1.0, 2.6, iceAmount);

    vec3 color = direct + ambient;

    // --- spell light -------------------------------------------------------
    // The same wrapped diffuse and the same transmission lobe the sun drives, so
    // a ribbon of lit water lying across a berm glows *through* the crest instead
    // of merely putting a bright patch on the near face. That through-scatter is
    // the whole reason the term is here rather than being a stock point light.
    //
    // ARCHITECTURE §3.1 signs spellLighting() WITHOUT an albedo argument, so the
    // albedo multiply the reference does inside the chunk is applied here
    // instead. If SPELLS folds a snow albedo into its own return, delete the
    // '* albedo' on this line — it is the only place the two conventions differ.
    //
    // The longer spellLightingSnow() form, not the §3.1 four-argument
    // spellLighting(), because the reference folds the ROCK MASK into the spell's
    // subsurface strength exactly as it does for the sun's:
    //     snow.fragment.wgsl:473  uniforms.sssStrength * (1.0 - rockExposed)
    // The four-argument form reads sssStrength raw from lib/shading's uniform
    // block, which would leave a spell transmitting through bare rock at full
    // strength — and at thickness 0 rock takes the WIDEST, BRIGHTEST lobe
    // (mix(1.0, 0.30, thickness)), so it is the worst place to lose the mask.
    color += spellLightingSnow(
        world, N, V, thickness, sssStrength * (1.0 - rockExposed), sssRadius
    ) * albedo;

    // --- glints ------------------------------------------------------------
    // Last among the lighting terms, and added as radiance rather than modulated
    // into the BRDF, because a glint is a specular highlight from a crystal facet
    // that the shading normal does not represent.
    if (glintIntensity > 0.001 && rockExposed < 0.5) {
        float g = snowGlints(
            world.xz, N, V, L, footprint, glintIntensity, glintGrazing
        );
        color += sunRadiance * g * shadow * (1.0 - iceAmount * 0.6) * 0.55;
    }

    // ---- occlusion, applied last and to everything -------------------------
    //
    // Two rules, and both are about hue rather than brightness.
    //
    //  1. It scales the *finished radiance*, not the ambient. The textbook says
    //     occlusion darkens ambient and leaves direct light alone, and in this
    //     scene that is actively wrong: the ambient is where all the blue lives —
    //     the sky is strongly blue-shifted by construction — and the sun is a
    //     13-degree beam at roughly 17:13:6. Attenuating one and not the other
    //     does not darken a surface, it re-weights a cool source against a warm
    //     one. A trench floor at 40% ambient and 100% sun is not a dark trench, it
    //     is a *brown* trench, and it lands there because AgX stops rolling
    //     saturation off half a stop below its shoulder.
    //
    //  2. Wherever it does darken, it goes blue in proportion. Light reaching into
    //     a hollow in snow has scattered through snow to get there, and snow
    //     absorbs red over any appreciable path — which is why a real snow cave is
    //     blue and not grey. The tint is the same deepTint the subsurface term
    //     uses, and tying it to the darkening rather than to deformDepth means the
    //     two can never drift apart.
    vec3 caveTint = mix(vec3(1.0), vec3(0.55, 0.72, 1.0), (1.0 - ao) * 0.95);
    color *= ao * caveTint;

    // ------------------------------------------------------- aerial perspective
    // lib/atmosphere's aerial() derives the view direction as
    // normalize(worldPos - uCameraPos), i.e. -V, and reads the fog block and
    // uSunColor from its own uniforms — the same four numbers the reference
    // passes explicitly.
    color = aerial(color, world);

    // ------------------------------------------------------------------ debug
    if (debugMode > 0.5) {
        if (debugMode < 1.5) {
            // Depression and berm are metres and berms are the shallower of the
            // two, so both are scaled to fill the range rather than shown raw —
            // otherwise the channel that matters most reads as black.
            color = vec3(deformDepth * 2.5, deformBerm * 5.0, compression * 0.6);
        } else if (debugMode < 2.5) {
            color = N * 0.5 + 0.5;
        } else if (debugMode < 3.5) {
            color = vec3(viewDist / 400.0);
        } else if (debugMode > 4.5 && debugMode < 5.5) {
            // Pixel footprint, log-scaled: green ~1 cm, yellow ~10 cm, red ~1 m.
            // Every detail fade in this shader is keyed off this value, so being
            // able to see it directly turns "why is there no detail here" from a
            // guess into a reading.
            float lf = log2(footprint);
            color = vec3(
                clamp((lf + 3.3) / 3.3, 0.0, 1.0),
                clamp(1.0 - abs(lf + 4.6) / 2.0, 0.0, 1.0),
                clamp(-(lf + 5.0) / 2.0, 0.0, 1.0)
            );
        } else if (debugMode > 5.5 && debugMode < 6.5) {
            // Fine normal only, with the macro landform removed, so the
            // high-frequency content can be judged on its own.
            color = normalFromGradient(fine.yz) * 0.5 + 0.5;
        } else if (debugMode > 6.5 && debugMode < 7.5) {
            // The sun visibility term on its own — cast shadow only, with no
            // N.L, no albedo, no ambient and no fog. This is the one view that
            // separates "this surface faces away from the sun" from "something is
            // occluding it", which are the two completely different causes of a
            // dark frame and are otherwise indistinguishable by eye.
            //
            // Red where the surface is back-lit (NdotL < 0), because there the
            // shadow term is not what is making it dark and reading the grey value
            // would be misleading.
            color = (NdotL <= 0.0) ? vec3(0.35, 0.06, 0.06) : vec3(shadow);
        } else if (debugMode > 7.5 && debugMode < 8.5) {
            // Lambert term alone, same framing as the shadow view above: this is
            // the *other* half of why a pixel is dark.
            color = vec3(max(NdotL, 0.0));
        } else if (debugMode > 9.5) {
            // Albedo alone, before a single lighting term touches it. The one view
            // that separates "this surface is lit badly" from "this surface is the
            // wrong colour", which are otherwise indistinguishable — and on carved
            // snow specifically, where four independent channels (compression,
            // ice, displaced mass, rock) all write here, it is the only way to see
            // which of them is talking.
            color = albedo;
        } else if (debugMode > 8.5) {
            // Depth-map agreement, in metres.
            //   blue    = point falls outside every cascade box
            //   grey    = map and receiver agree within 0.5 m
            //   red     = map claims an occluder in front, brighter with distance
            //   green   = map sits behind the receiver (should be impossible on a
            //             closed heightfield, so it means the projection is off)
            float dz = shadowMapDelta(world, geoN, viewDist);
            if (dz > 1e8) {
                color = vec3(0.0, 0.15, 0.6);
            } else {
                float mag = clamp(abs(dz) / 12.0, 0.0, 1.0);
                float agree = 1.0 - smoothstep(0.0, 0.5, abs(dz));
                color = vec3(agree * 0.45)
                      + ((dz < 0.0) ? vec3(mag, 0.0, 0.0) : vec3(0.0, mag, 0.0));
            }
        } else {
            vec3 c = vec3(float(viewDist < cascadeSplits.x),
                          float(viewDist < cascadeSplits.y),
                          float(viewDist < cascadeSplits.z));
            color = color * 0.6 + c * 0.25;
        }
    }

    outColor = vec4(color, 1.0);
}
`;

/**
 * Build the beauty fragment stage.
 *
 * @param {boolean} withSpellLights true when `lib/spellLights` is registered.
 *   False substitutes a zero-returning stub so the page still boots while SPELLS
 *   is unfinished — see FRAGMENT_SPELLS_STUB. This is the only branch in the
 *   whole material and it exists purely so a missing sibling subsystem is a
 *   dimmer frame rather than a blank page.
 * @returns {string}
 */
export function fragment(withSpellLights) {
    return FRAGMENT_HEAD
        + (withSpellLights ? FRAGMENT_SPELLS : FRAGMENT_SPELLS_STUB)
        + FRAGMENT_BODY;
}
