/**
 * The ice-crystal stages — beauty pair, cascade depth, and depth prepass.
 *
 * All four programs place their vertex with the identical `crystalPoint()` out of
 * `lib/crystal`, growth curve included, per ARCHITECTURE.md §5. A formation whose
 * shadow is a different shape from the formation is worse than no shadow at all,
 * and a shadow that snaps to full size on the frame a prism is planted gives the
 * whole effect away.
 *
 * VARYING BUDGET: two slots, packed.
 *
 *     vWorldH   (world.xyz, height01)
 *     vSeed     the per-crystal hash seed
 *
 * The reference declares `vBase` and `vGrowth` as well; its fragment stage reads
 * neither, so they are dropped. `vViewDist` is recomputed in the fragment as
 * `distance(world, uCameraPos)` — the identical quantity, for one slot less.
 */

/**
 * Beauty vertex stage.
 *
 * NO NORMAL IS EMITTED. The fragment stage takes it from the derivatives of the
 * world position, which gives exact flat facets for free — and a facet is what an
 * ice crystal is. Interpolated vertex normals would round the edges off and turn
 * a crystal into a lumpy cone, which is the one thing it must not look like.
 *
 * @type {string}
 */
export const vertex = /* glsl */`
#include "lib/crystal"

in vec3 position;               // (crystal, vertex, unused)

uniform sampler2D crystalTex;

out vec4 vWorldH;
out float vSeed;

void main() {
    int i = int(position.x);
    int v = int(position.y);

    vec4 a = texelFetch(crystalTex, ivec2(i, 0), 0);
    vec4 c = texelFetch(crystalTex, ivec2(i, 2), 0);

    vec3 P = crystalPoint(crystalTex, i, v);

    // Fraction of the way up the crystal, measured against the FULL height a.w
    // rather than the grown height, so a half-grown prism's tip reports ~0.5 and
    // stays frosted longer. That is intentional: the base is buried in the drift
    // and milky, the tip is clear and lit through.
    vWorldH = vec4(P, clamp((P.y - a.y) / max(a.w, 1e-3), 0.0, 1.0));
    vSeed = c.y;

    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

/**
 * Beauty fragment stage.
 *
 * What sells this spell is not the geometry. It is that a facet of clear ice does
 * three different things depending on where you stand relative to it, all at once
 * and all sharply divided by the facet edges:
 *
 *   near grazing   almost a mirror. Fresnel at 0.021 base reflectance still
 *                  returns nearly everything at 80 degrees, and against this
 *                  scene's low warm sun that is a hard bright edge.
 *   head on        you see through it, bent, and tinted by the path — which on a
 *                  30 cm crystal is a real blue, because ice absorbs red about
 *                  fifteen times faster than blue.
 *   backlit        it glows. Ice scatters internally at every inclusion and
 *                  bubble, and a crystal with the sun behind it lights up along
 *                  its whole length rather than going to silhouette.
 *
 * BLENDED, BUT DEPTH-WRITING (the material state, set in `spells/crystals.js`).
 * The usual pair of options is opaque — correct depth, no transparency — or
 * alpha-blended with depth write off — transparency, no depth. Neither is right
 * for a cluster of forty overlapping prisms: the first gives blue spikes, and the
 * second gives a grey smear where every prism blends over every other one in
 * index order. Writing depth while blending gives the third thing: the first
 * surface at a pixel blends over whatever the terrain already put there, so you
 * genuinely see the snow through the ice, and every surface behind it is
 * depth-rejected, so no crystal is ever blended over another one.
 *
 * @type {string}
 */
export const fragment = /* glsl */`
#include "lib/noise"
#include "lib/shading"
#include "lib/spellLights"
#include "lib/atmosphere"
#include "lib/shadowLookup"

in vec4 vWorldH;      // xyz world, w fraction up the crystal
in float vSeed;

layout(location = 0) out vec4 outColor;

/**
 * Absorption per metre. Real ice is roughly (1.5, 0.35, 0.10) in the visible;
 * this is a little stronger so a hand-sized crystal shows the colour a
 * glacier-sized one really would — but not so strong that the whole formation
 * saturates to one flat blue, which is what 4.2 in red did.
 */
const vec3 ICE_ABSORB = vec3(2.35, 0.60, 0.24);

void main() {
    vec3 world = vWorldH.xyz;
    float vHeight01 = vWorldH.w;

    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;                       // toward the sun

    // ---- flat facet normal, from the geometry itself ------------------------
    // HANDEDNESS / Y-FLIP: WebGPU's framebuffer Y runs downward and WebGL's runs
    // upward, so dFdy carries the opposite sign here and cross(dFdx, dFdy) comes
    // out NEGATED relative to the reference. That is self-correcting because of
    // the line immediately below, which forces the normal toward the eye
    // regardless — port it verbatim, and do NOT "clean it up" on the grounds that
    // the winding should already be right, or the ice shades inside out.
    vec3 dx = dFdx(world);
    vec3 dy = dFdy(world);
    vec3 N = normalize(cross(dx, dy));
    if (dot(N, V) < 0.0) { N = -N; }
    vec3 geoN = N;

    float NdotV = clamp(dot(N, V), 1e-4, 1.0);
    float NdotL = dot(N, L);
    float viewDist = distance(world, uCameraPos);
    float noiseRot = ign(gl_FragCoord.xy) * TAU;
    float shadow = sunShadow(world, geoN, viewDist, noiseRot);

    vec3 sun = uSunColor;

    // ---- frost --------------------------------------------------------------
    // Where the crystal comes out of the drift it is not clear — it is packed
    // with the snow it grew through. That gradient is what ATTACHES it to the
    // ground; without it a crystal looks placed on the surface rather than grown
    // out of it, which is the single failure this effect cannot afford. Confined
    // to the bottom fifth: any more and it is a white prism with a clear tip
    // rather than an ice prism standing in snow.
    float grain = noise2(world.xz * 34.0 + vSeed * 19.0) * 0.5 + 0.5;
    float frost = clamp(
        (1.0 - smoothstep(0.01, 0.22, vHeight01)) * (0.45 + 0.6 * grain),
        0.0, 1.0
    );

    // Optical path through the crystal: long across a facet seen edge-on, short
    // through one seen face-on, and longer near the thick base than at the tip.
    // The constant term carries the colour through the middle of the prism; a
    // path that only opens up at grazing puts all of the blue on the silhouette,
    // where the Fresnel reflection then replaces it with sky.
    float path = clamp(
        (0.16 + 0.42 * (1.0 - vHeight01)) * (0.7 + 2.0 * (1.0 - NdotV)),
        0.02, 1.4
    );
    vec3 transmit = exp(-ICE_ABSORB * path);

    // ---- refraction, with dispersion ---------------------------------------
    // Same construction as the spell water, tighter IORs and a sharper mip: ice
    // facets are flat, so the background through them stays sharper.
    vec3 mirror = reflect(-V, N);
    vec3 rr = refract(-V, N, 1.0 / 1.3050);
    vec3 rg = refract(-V, N, 1.0 / 1.3090);
    vec3 rb = refract(-V, N, 1.0 / 1.3170);
    vec3 dr = (dot(rr, rr) > 0.5) ? rr : mirror;
    vec3 dg = (dot(rg, rg) > 0.5) ? rg : mirror;
    vec3 db = (dot(rb, rb) > 0.5) ? rb : mirror;

    vec3 behind = vec3(
        textureLod(uSkyLUT, dirToLatLong(dr), 0.9).r,
        textureLod(uSkyLUT, dirToLatLong(dg), 0.9).g,
        textureLod(uSkyLUT, dirToLatLong(db), 0.9).b
    );
    vec3 color = behind * transmit;

    // ---- internal transport --------------------------------------------------
    // A crystal with the sun behind it lights along its whole length: the light
    // enters the far facet, scatters off inclusions, and leaves toward the eye,
    // tinted by everything it did not survive.
    float through = backScatter(N, L, V, 0.42, 2.2, 1.0);
    vec3 deepTint = mix(vec3(0.42, 0.74, 1.0), vec3(0.86, 0.95, 1.0),
                        exp(-path * 2.5));
    color += sun * INV_PI * deepTint * through * sssStrength * 1.6
           * mix(0.25, 1.0, shadow);

    // Sky through the body, which is what keeps a crystal standing in shadow
    // alive rather than black. skyIrradiance() already folds in the ambient
    // slider (lib/atmosphere), so it is not applied twice.
    color += skyIrradiance(N) * INV_PI * deepTint * 0.9;

    // ---- frosted skin --------------------------------------------------------
    if (frost > 0.002) {
        vec3 fa = vec3(0.88, 0.915, 0.965);
        vec3 fc = fa * INV_PI * sun * wrapDiffuse(NdotL, 0.62) * shadow;
        fc += fa * INV_PI * skyIrradiance(N);
        fc += snowSubsurface(N, L, V, sun, 0.4, sssStrength, 1.3)
            * fa * mix(0.4, 1.0, shadow);
        color = mix(color, fc, frost * 0.9);
    }

    // ---- surface -------------------------------------------------------------
    // Fresnel is NOT capped here — the water caps at 0.72; ice is allowed to go
    // to a full mirror at grazing. Reflection mip is driven by roughness.
    float rough = mix(0.045, 0.42, frost);
    vec3 F = fresnelSchlick(NdotV, vec3(0.021));
    vec3 skyRefl = textureLod(uSkyLUT, dirToLatLong(mirror), rough * 6.0).rgb;
    color = mix(color, skyRefl, F * (1.0 - frost * 0.75));

    if (NdotL > 0.0) {
        vec3 H = normalize(V + L);
        float D = distributionGGX(clamp(dot(N, H), 0.0, 1.0), rough);
        float Vis = visSmithGGXCorrelated(NdotV, NdotL, rough);
        vec3 Fs = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), vec3(0.021));
        color += sun * D * Vis * Fs * NdotL * shadow;
    }

    // Glints run on world.xz directly here (the water used its oblique slice) and
    // on a different footprint estimator — both are the reference's.
    if (glintIntensity > 0.001) {
        float g = snowGlints(
            world.xz, N, V, L, max(length(dx.xz) + length(dy.xz), 1e-4),
            glintIntensity * (0.4 + 1.2 * frost), glintGrazing
        );
        color += sun * g * shadow * 0.6;
    }

    if (spellLightCount > 0.5) {
        color += spellLightingSurface(
            world, N, V, mix(vec3(0.3, 0.6, 0.85), vec3(0.88), frost),
            vec3(0.021), rough, 0.5
        );
    }

    // Aerial perspective is applied BEFORE the alpha here, unlike the water.
    color = aerial(color, world);

    // ---- opacity -------------------------------------------------------------
    // Three things drive it, and they are the three things that decide how much of
    // a real crystal you can see through: the path (a thin tip is nearly clear),
    // the grazing angle (a facet seen edge-on presents a long optical path and a
    // strong reflection, and both make it opaque), and the frost (where the prism
    // is packed with the snow it grew through it is not transparent at all).
    // The 0.46 floor is high enough that a crystal never disappears against the
    // field behind it.
    float alpha = clamp(
        0.46 + 0.34 * (1.0 - exp(-path * 2.2)) + 0.26 * (1.0 - NdotV) + frost * 0.55,
        0.0, 1.0
    );

    outColor = vec4(color, alpha);
}
`;

/**
 * Cascade-depth vertex stage. Identical `crystalPoint`, growth curve included, so
 * the shadow grows with the crystal.
 *
 * `lightViewProjection` is supplied by `shadows.makeCasterMaterial()`.
 * @type {string}
 */
export const depthVertex = /* glsl */`
#include "lib/crystal"

in vec3 position;               // (crystal, vertex, unused)

uniform sampler2D crystalTex;
uniform mat4 lightViewProjection;

void main() {
    int i = int(position.x);
    int v = int(position.y);
    gl_Position = lightViewProjection * vec4(crystalPoint(crystalTex, i, v), 1.0);
}
`;

/**
 * Depth-prepass vertex stage. Same `crystalPoint` and the same growth curve.
 *
 * This is the ONLY caster in the project that writes a non-zero specular mask,
 * and it is the reason the mask channel exists: ice is the only mirror in a field
 * of matte snow, so the reflection pass can early-out on the mask and cost
 * nothing on every frame where nobody has cast Crystallise.
 *
 * `viewProjection` is supplied by `depthPass.makeCasterMaterial()`. The varying
 * declarations and `prepassEmit` come from `shaders/prepass.glsl.js`, which is
 * concatenated in front of this by the caller.
 * @type {string}
 */
export const prepassVertexBody = /* glsl */`
#include "lib/crystal"

in vec3 position;               // (crystal, vertex, unused)

uniform sampler2D crystalTex;
uniform mat4 viewProjection;

void main() {
    int i = int(position.x);
    int v = int(position.y);
    vec3 P = crystalPoint(crystalTex, i, v);
    prepassEmit(viewProjection * vec4(P, 1.0), 1.0);
}
`;
