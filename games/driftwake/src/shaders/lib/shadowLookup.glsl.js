/**
 * `lib/shadowLookup` — the receiving half of the cascaded shadow maps.
 *
 * Lifted out of the snow material in the reference once the character needed the
 * identical lookup, and kept that way here for the same reason: the light-space
 * basis, the receiver-plane gradient and the normal offset are all things that
 * are invisible to inspection and wrong in ways that only ever show up as "the
 * shadows swim a bit". One include, one convention.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE (ARCHITECTURE.md §3.1, plus the reference's own entry points)
 *
 *   float shadowAt(vec3 worldPos, vec3 N);   // 1 = lit, 0 = occluded
 *   int   cascadeIndexAt(vec3 worldPos);     // 0/1/2, -1 past the last cascade
 *
 *   // the reference's signature, for receivers that already carry a view
 *   // distance varying and their own filter rotation:
 *   float sunShadow(vec3 world, vec3 geoN, float viewDist, float noiseRot);
 *   float shadowIGN(vec2 pix);               // the filter-rotation noise
 *   float shadowMapDelta(vec3 world, vec3 geoN, float viewDist);  // debug mode 9
 *
 * `shadowAt` is the convenience form: it takes the view distance as
 * `distance(worldPos, uCameraPos)` — which is exactly what every receiver's
 * `vViewDist` varying carries in the reference — and rotates the filter from
 * `gl_FragCoord.xy`. Receivers that already have both should call `sunShadow`
 * directly and save the two recomputes.
 *
 * FRAGMENT STAGE ONLY. `shadowAt` reads `gl_FragCoord`, so including this chunk
 * in a vertex program will not compile.
 *
 * ---------------------------------------------------------------------------
 * UNIFORMS — declared *here*, not by the consumer. Do not re-declare them; GLSL
 * has no weak linkage and a second declaration is a compile error. Get the whole
 * block, correctly shared, from `shadows.receiverUniforms(softness, bias)`:
 *
 *   sampler2D cascade0 / cascade1 / cascade2   R32F, NDC depth as plain colour
 *   mat4      cascadeMatrices[3]               world -> light clip, per cascade
 *   vec4      cascadeSplits                    (26, 95, 330, 330) metres
 *   vec4      cascadeParams[3]                 (depthRange m, orthoWidth m, 0, 0)
 *   float     shadowTexel                      1/2048, in UV
 *   float     shadowSoftness                   per material, _spec/shadows.md §6.5
 *   float     shadowBias                       per material, metres
 *
 * `uSunDir` (toward the sun) and `uCameraPos` come from `lib/common`.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS — the one thing in this file that is not a transliteration.
 *
 * The reference builds the light view with Babylon's `Matrix.LookAtLHToRef`,
 * whose view basis is  X = up x forward,  Y = forward x X,  Z = forward
 * (forward = the direction the light travels). Three's `Camera.lookAt` is
 * right-handed and gives  X = -(up x forward),  Y = forward x X,  Z = -forward.
 *
 * So the port's shadow map is **mirrored in U** relative to the reference's, and
 * identical in V. That is harmless as long as every consumer of the light basis
 * agrees, which is what these two lines are for:
 *
 *     lr = normalize(cross(lf, vec3(0,1,0)))   // = -(up x lf), Three's view +X
 *     lu = cross(lr, lf)                       // = (lf x right_LH), unchanged
 *
 * Both are world-space expressions in Three's right-handed Y-up convention, and
 * both must match `_fitCascade` in `render/shadows.js`, which uses the identical
 * two formulas on the CPU. If they ever disagree in Y only, the symptom is acne
 * that appears on lee faces but not windward ones — check with debug mode 9.
 *
 * The V sign in the NDC->UV remap is `ndc.y * 0.5 + 0.5`, the textbook one: Three
 * does not flip clip-space Y when rendering into a render target, so there is no
 * double flip to undo (_spec/shadows.md §11.3). The reference's expression is the
 * same, for the opposite reason. Do not "fix" it to `0.5 - ndc.y * 0.5`.
 *
 * Depth: Three's orthographic projection is the GL convention, NDC z in [-1,1],
 * so `ndc.z` is remapped once to [0,1] immediately after the divide. Everything
 * downstream — the bias, `planeNdcPerUV`, `cmp`, the `depthRange` scaling — is
 * then numerically identical to the reference, and the stored `gl_FragCoord.z`
 * already lives in [0,1] (_spec §11.2).
 */

export default /* glsl */`
#include "lib/common"

// ------------------------------------------------------------------- uniforms

uniform sampler2D cascade0;
uniform sampler2D cascade1;
uniform sampler2D cascade2;

uniform mat4  cascadeMatrices[3];
uniform vec4  cascadeSplits;      // (26, 95, 330, 330) metres of view distance
uniform vec4  cascadeParams[3];   // (depthRange m, orthoWidth m, 0, 0)
uniform float shadowTexel;        // 1/2048, in UV
uniform float shadowSoftness;
uniform float shadowBias;         // metres

// ----------------------------------------------------------------- PCSS core

// Poisson-ish disc, precomputed. Rotated per pixel so 12 taps look like far more
// than 12. The blocker search uses the first 8; the filter uses all 12.
const vec2 POISSON[12] = vec2[12](
    vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696,  0.457),
    vec2(-0.203,  0.621), vec2( 0.962, -0.195), vec2( 0.473, -0.480),
    vec2( 0.519,  0.767), vec2( 0.185, -0.893), vec2( 0.507,  0.064),
    vec2( 0.896,  0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

/**
 * Interleaved Gradient Noise over pixel coordinates — the per-pixel filter
 * rotation, identical in all six receivers.
 *
 * Named \`shadowIGN\` rather than \`ign\` so that registering \`lib/noise\` (which
 * carries the reference's \`ign\`) alongside this chunk cannot collide: two
 * identical GLSL signatures in one stage is a redefinition error, not a merge.
 *
 * IGN over pixel coords is exactly the noise TAA is built to resolve — do not
 * substitute a hash of world position or UV, the port depends on the resolve.
 *
 * gl_FragCoord.y counts from the bottom in GL and from the top in WebGPU, so a
 * given pixel gets a different rotation than in the reference. That only shuffles
 * which pixel gets which angle; it is visually irrelevant and is not worth
 * chasing (_spec §11.5).
 */
float shadowIGN(vec2 pix) {
    return fract(52.9829189 * fract(dot(pix, vec2(0.06711056, 0.00583715))));
}

/**
 * Percentage-closer *soft* shadows, worked entirely in world units.
 *
 * The usual formulation estimates the penumbra as a ratio of raw depth-buffer
 * values. That silently fails here: the cascades are orthographic over a range of
 * hundreds of metres, so a two-metre step between blocker and receiver is a few
 * thousandths in NDC, the estimate rounds to nothing, and the filter collapses to
 * one texel — pin-sharp shadows regardless of how far the occluder actually is.
 * Converting to metres first is what makes the softening real.
 *
 * receiverDepth  [0,1] depth of the (normal-offset) receiver
 * texelSize      one shadow texel, in UV
 * depthRange     metres spanned by depth 0..1        (cascadeParams.x)
 * orthoWidth     metres spanned by UV 0..1           (cascadeParams.y)
 * planeNdcPerUV  the receiver's own depth slope, [0,1]-depth per unit UV
 */
float pcssShadow(
    sampler2D shadowMap,
    vec2  uv,
    float receiverDepth,
    float texelSize,
    float depthRange,
    float orthoWidth,
    float softness,
    float noiseRot,
    float biasWorld,
    vec2  planeNdcPerUV
) {
    float bias = biasWorld / depthRange;      // metres -> depth units
    vec2  planeAt = planeNdcPerUV;

    // Widest penumbra we will ever produce, in UV — also the search radius, since
    // an occluder further away than this cannot soften anything more. 24 texels
    // wins below an ortho width of 153.6 m (cascades 0 and 1); the 1.8 m world cap
    // wins for cascade 2.
    float maxPenumbraUV = min(24.0 * texelSize, 1.8 / orthoWidth);

    float cs = cos(noiseRot);
    float sn = sin(noiseRot);
    mat2  rot = mat2(cs, -sn, sn, cs);   // column-major, same four scalars as WGSL

    // ---- blocker search (8 taps) -----------------------------------------
    //
    // Both loops sample the map *away* from the shading point and then have to
    // decide whether what they found is an occluder. Comparing against the
    // shading point's own depth is only valid if the surface is flat in light
    // space, and under a 13-degree sun it is nothing of the sort: the light meets
    // level snow at 77 degrees from the normal, so the surface's own depth falls
    // 1.8 * tan(77) = 7.8 m across the 1.8 m search radius, against a bias
    // measured in centimetres. Every offset sample then reports the snow as its
    // own occluder and the cascade floods solid black. So the comparison depth is
    // extrapolated along the receiver's own plane to wherever the sample landed.
    //
    // The accumulator stores \`cmp - d\` — distance in front of the *plane*, not of
    // the shading point — so the penumbra estimate inherits the same correction.
    float blockerDepthSum = 0.0;
    float blockerCount = 0.0;

    for (int i = 0; i < 8; i++) {
        vec2  off = rot * POISSON[i] * maxPenumbraUV;
        vec2  s = clamp(uv + off, vec2(0.0), vec2(1.0));
        float d = textureLod(shadowMap, s, 0.0).r;
        float cmp = receiverDepth + dot(off, planeAt) - bias;
        if (d < cmp) {
            blockerDepthSum += cmp - d;
            blockerCount += 1.0;
        }
    }

    // Nothing in front of the receiver: fully lit, and we skip the filter.
    if (blockerCount < 0.5) { return 1.0; }

    // ---- penumbra estimate (similar triangles, in metres) -----------------
    // The sun subtends about half a degree, so a blocker d metres in front of the
    // receiver casts a penumbra of roughly 0.0093*d. \`softness\` opens that up,
    // because pure geometric penumbra is tighter than snow actually looks once sky
    // light fills the shadow. The floor of one texel is what keeps contact crisp.
    float blockerDist = (blockerDepthSum / blockerCount) * depthRange;
    float penumbraWorld = blockerDist * 0.0093 * softness;
    float filterR = clamp(penumbraWorld / orthoWidth, texelSize, maxPenumbraUV);

    // ---- filter (12 taps) -------------------------------------------------
    float lit = 0.0;
    for (int i = 0; i < 12; i++) {
        vec2  off = rot * POISSON[i] * filterR;
        vec2  s = clamp(uv + off, vec2(0.0), vec2(1.0));
        float d = textureLod(shadowMap, s, 0.0).r;
        float cmp = receiverDepth + dot(off, planeAt) - bias;
        lit += (d < cmp) ? 0.0 : 1.0;
    }

    return lit / 12.0;
}

// ------------------------------------------------------------- cascade lookup

/**
 * Project into one cascade and run PCSS. Returns 1.0 (lit) outside the cascade's
 * extent, so callers can fall through to a coarser one.
 *
 * \`geoN\` must be the geometric normal the *depth pass* rendered — macro landform,
 * the analytic fine layer and carved deformation, but nothing finer. Biasing
 * against a shading normal that carries three tiled grain scales would describe a
 * surface orders of magnitude higher in frequency than the one in the depth map:
 * the offset would point somewhere different on every pixel and reintroduce
 * exactly the noise it exists to remove.
 */
float sampleCascadeTex(
    sampler2D tex,
    mat4  m,
    vec4  params,
    vec3  world,
    vec3  geoN,
    float biasWorld,
    float softness,
    float noiseRot
) {
    float depthRange = params.x;
    float orthoWidth = params.y;
    float texelWorld = orthoWidth * shadowTexel;   // metres per shadow texel

    // ---- the light's own basis, reconstructed (never passed in) -----------
    // Rebuilt here so it cannot drift out of sync with the matrix. These two
    // lines mirror _fitCascade() in render/shadows.js exactly — see the file
    // header: Three's right-handed lookAt puts the map's +U along
    // -(worldUp x lightDir), which is why the cross is (lf, up) and not (up, lf).
    // The world up is only ever swapped out for a near-zenith sun, which this
    // scene's 0.5-45 degree elevation range never reaches, so it is a constant.
    vec3 lf = -uSunDir;                                 // direction the light travels
    vec3 lr = normalize(cross(lf, vec3(0.0, 1.0, 0.0))); // map +U, world space
    vec3 lu = cross(lr, lf);                             // map +V, world space

    // nl.z is the cosine between the normal and the light's direction of travel,
    // so it goes to zero exactly at the terminator — where the plane is edge-on to
    // the light and its depth gradient is genuinely infinite. Epsilon is
    // sign-preserving. Slope clamped to 6 (about 80 degrees), past which
    // extrapolating further would start detaching real shadows from their casters
    // rather than preventing acne.
    vec3  nl = vec3(dot(geoN, lr), dot(geoN, lu), dot(geoN, lf));
    float nz = (nl.z >= 0.0) ? max(nl.z, 1e-3) : min(nl.z, -1e-3);
    vec2  grad = clamp(vec2(-nl.x / nz, -nl.y / nz), vec2(-6.0), vec2(6.0));

    // Depth per unit UV: metres of light-space travel per unit UV (orthoWidth),
    // divided by the metres one unit of stored depth spans (depthRange). Y keeps
    // its sign — v runs *with* light-space Y here, because neither side flips.
    vec2 planeNdcPerUV = grad * orthoWidth / depthRange;

    // ---- normal-offset bias ----------------------------------------------
    // Move the receiver off the surface by a texel and a half before projecting,
    // scaled by how obliquely the light meets it. This is what absorbs the depth
    // quantisation of the map itself, and because it is expressed in this
    // cascade's own texels it needs no per-cascade multiplier: 3 cm in cascade 0,
    // where contact shadows must stay attached, and 40 cm out in cascade 2 where a
    // texel covers that much ground anyway.
    float sinL = sqrt(clamp(1.0 - nl.z * nl.z, 0.0, 1.0));
    vec3  biased = world + geoN * (texelWorld * 1.5 * max(sinL, 0.2));

    vec4 clip = m * vec4(biased, 1.0);
    vec3 ndc = clip.xyz / clip.w;
    // GL clip volume: z in [-1,1], unlike WebGPU's [0,1].
    if (any(greaterThan(abs(ndc.xy), vec2(1.0))) || abs(ndc.z) > 1.0) { return 1.0; }

    // The only line the [0,1] depth convention costs us. After it, one unit of
    // receiverDepth still spans depthRange metres, so every constant below is the
    // reference's unchanged.
    float receiverDepth = ndc.z * 0.5 + 0.5;
    vec2  uv = ndc.xy * 0.5 + 0.5;

    return pcssShadow(tex, uv, receiverDepth, shadowTexel, depthRange, orthoWidth,
                      softness, noiseRot, biasWorld, planeNdcPerUV);
}

/**
 * Pick a cascade and evaluate PCSS, cross-fading over the last 12% of each slice
 * so the filter width never visibly steps. The 0.88 here is the same number as
 * the slice overlap in shadows.js — they must match, or the fade band samples a
 * cascade that does not cover the pixel.
 *
 * Three separate bindings with a static branch rather than one atlas or a sampler
 * array: GLSL ES 3.00 cannot index a sampler2D array by a non-constant expression
 * either. The branch costs almost nothing — cascade choice is a function of view
 * distance, so it is coherent across essentially every wavefront.
 *
 * Both blend bands re-run the entire PCSS chain in a second cascade — 2 x (8 + 12)
 * = 40 taps inside the band. That is accepted; the band is narrow and coherent.
 */
float sunShadow(vec3 world, vec3 geoN, float viewDist, float noiseRot) {
    // A small constant bias, and nothing else. Slope scaling and per-cascade
    // texel-footprint multipliers are both handled inside sampleCascadeTex,
    // exactly and in world units, by the receiver-plane gradient and the
    // texel-sized normal offset. Stacking more on top only peter-pans the shadows
    // off their casters.
    float biasWorld = shadowBias;
    vec4  sp = cascadeSplits;
    float soft = shadowSoftness;

    if (viewDist >= sp.z) { return 1.0; }

    if (viewDist < sp.x) {
        float s = sampleCascadeTex(cascade0, cascadeMatrices[0], cascadeParams[0],
                                   world, geoN, biasWorld, soft, noiseRot);
        float blendStart = sp.x * 0.88;                 // 22.88 m
        if (viewDist <= blendStart) { return s; }
        float s2 = sampleCascadeTex(cascade1, cascadeMatrices[1], cascadeParams[1],
                                    world, geoN, biasWorld, soft, noiseRot);
        return mix(s, s2, clamp((viewDist - blendStart) / (sp.x - blendStart), 0.0, 1.0));
    }

    if (viewDist < sp.y) {
        float s = sampleCascadeTex(cascade1, cascadeMatrices[1], cascadeParams[1],
                                   world, geoN, biasWorld, soft, noiseRot);
        float blendStart = sp.y * 0.88;                 // 83.60 m
        if (viewDist <= blendStart) { return s; }
        float s2 = sampleCascadeTex(cascade2, cascadeMatrices[2], cascadeParams[2],
                                    world, geoN, biasWorld, soft, noiseRot);
        return mix(s, s2, clamp((viewDist - blendStart) / (sp.y - blendStart), 0.0, 1.0));
    }

    float s = sampleCascadeTex(cascade2, cascadeMatrices[2], cascadeParams[2],
                               world, geoN, biasWorld, soft, noiseRot);
    // Fade the last cascade out at its far edge rather than cutting to lit:
    // 280.5 m -> 330 m.
    return mix(s, 1.0, smoothstep(sp.z * 0.85, sp.z, viewDist));
}

// -------------------------------------------------------- ARCHITECTURE §3.1

/**
 * The project-wide entry point. 1 = lit, 0 = occluded.
 *
 * View distance is the straight-line distance to the camera, which is what every
 * receiver's vViewDist varying carries in the reference (snow.vertex.wgsl:117 is
 * distance(world, cameraPos), not a view-space z).
 */
float shadowAt(vec3 worldPos, vec3 N) {
    return sunShadow(worldPos, N,
                     distance(worldPos, uCameraPos),
                     shadowIGN(gl_FragCoord.xy) * TAU);
}

/** Which cascade a point lands in; -1 past the last split. Debug view "cascades". */
int cascadeIndexAt(vec3 worldPos) {
    float d = distance(worldPos, uCameraPos);
    if (d < cascadeSplits.x) { return 0; }
    if (d < cascadeSplits.y) { return 1; }
    if (d < cascadeSplits.z) { return 2; }
    return -1;
}

/**
 * Diagnostic for debug view "shadowMap": how far the depth map and the receiver
 * disagree, in metres. Projects exactly as sampleCascadeTex does — same normal
 * offset, same cascade selection, same UV remap — but takes the single centre tap.
 *
 * Near zero means the two passes are describing the same surface and any
 * remaining artefact is a bias or filter question. Hundreds of metres means they
 * are not, and no amount of bias tuning is going to help. Returns 1e9 when the
 * point falls outside every cascade box.
 *
 * Colour key the caller should reproduce (_spec §10):
 *   blue (0.0,0.15,0.6) outside every cascade · grey agree within 0.5 m ·
 *   red map claims an occluder in front · green map sits behind the receiver
 *   (impossible on a closed heightfield, so it means the projection is off).
 */
float shadowMapDelta(vec3 world, vec3 geoN, float viewDist) {
    vec4 sp = cascadeSplits;
    mat4 m = cascadeMatrices[2];
    vec4 params = cascadeParams[2];
    int  idx = 2;
    if (viewDist < sp.x) { m = cascadeMatrices[0]; params = cascadeParams[0]; idx = 0; }
    else if (viewDist < sp.y) { m = cascadeMatrices[1]; params = cascadeParams[1]; idx = 1; }

    vec3 lf = -uSunDir;
    vec3 lr = normalize(cross(lf, vec3(0.0, 1.0, 0.0)));
    vec3 nl3 = vec3(dot(geoN, lr), dot(geoN, cross(lr, lf)), dot(geoN, lf));
    float sinL = sqrt(clamp(1.0 - nl3.z * nl3.z, 0.0, 1.0));
    vec3 biased = world + geoN * (params.y * shadowTexel * 1.5 * max(sinL, 0.2));

    vec4 clip = m * vec4(biased, 1.0);
    vec3 ndc = clip.xyz / clip.w;
    if (any(greaterThan(abs(ndc.xy), vec2(1.0))) || abs(ndc.z) > 1.0) { return 1e9; }

    float receiverDepth = ndc.z * 0.5 + 0.5;
    vec2  uv = ndc.xy * 0.5 + 0.5;

    float d = 0.0;
    if (idx == 0) { d = textureLod(cascade0, uv, 0.0).r; }
    else if (idx == 1) { d = textureLod(cascade1, uv, 0.0).r; }
    else { d = textureLod(cascade2, uv, 0.0).r; }

    return (d - receiverDepth) * params.x;
}
`;
