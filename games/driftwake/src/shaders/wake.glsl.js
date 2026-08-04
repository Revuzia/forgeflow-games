/**
 * The snow-surf wake's four shader programs. [WAKE]
 *
 * Port of `wake.vertex.wgsl`, `wake.fragment.wgsl`, `wakeDepth.*.wgsl` and
 * `wakePrepass.*.wgsl`. Whole stages, so they live here as plain string exports
 * rather than in the include registry (ARCHITECTURE.md §1); the *surface* they
 * share is `lib/wake`, and all four vertex programs place their vertices by
 * calling into it, which is what makes the shadow and the prepass occlusion the
 * shape of the thing actually being drawn (ARCHITECTURE.md §5).
 *
 * The mesh carries no geometry: `position` is (column, row, side) and every
 * vertex is placed from the spine data texture, so a wake that is 17 m long one
 * frame and 2 m long the next costs the same static vertex buffer and one 4.5 KiB
 * texture upload.
 *
 * ---------------------------------------------------------------------------
 * VARYING BUDGET (ARCHITECTURE.md §4.1 — 30 vectors, and a lone `float` burns a
 * whole slot). The beauty pass packs its eight scalars into three vec4s:
 *
 *     vWorld   (world.xyz, distance to the camera)
 *     vNormal  (normal.xyz, curl)
 *     vSec     (q, distance behind the bow, age 0..1, amplitude m)
 *
 * The depth and prepass stages carry one vec4 each (plus the prepass's two
 * shared scalars from `prepass.glsl.js`).
 *
 * ---------------------------------------------------------------------------
 * WHY THE DEPTH STAGES CARRY TIME AS A VARYING. The reference does it so the two
 * halves of a pass cannot end up eroding at different moments. In a linked GLSL
 * program a uniform is one value across both stages so it could not drift here
 * either, but the varying is free (it packs into the vec4 with q/along/age) and
 * keeping the reference's shape means one less thing that is "the same, but".
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6). Exactly one line in this file consumes
 * handedness — the cross product that builds the normal — and it is marked
 * PORT FRAME with its derivation. `lib/wake`'s header carries the rest.
 */

import { PREPASS_VS_VARYINGS, PREPASS_FS_VARYINGS, PREPASS_EMIT } from "./prepass.glsl.js";

/**
 * Shared by all four vertex programs: unpack the lattice attribute into the
 * surface parameters. `u` = column/127, `q` = row/17, `side` = -1 or +1.
 */
const LATTICE = /* glsl */ `
in vec3 position;   // (column, row, side) — NOT a position; see the file header

/// Lattice index -> surface parameters. wakeCols/wakeRows come from lib/wake.
void wakeParams(out float u, out float q, out float side) {
    side = position.z;
    u = position.x / max(wakeCols - 1.0, 1.0);
    q = position.y / max(wakeRows - 1.0, 1.0);
}
`;

// ---------------------------------------------------------------------- beauty

/** @type {string} the beauty vertex stage. */
export const WAKE_VERTEX = /* glsl */ `
#include "lib/wake"

${LATTICE}

out vec4 vWorld;    // xyz world position, w distance to the camera
out vec4 vNormal;   // xyz surface normal (concave side), w curl
out vec4 vSec;      // (q, distance behind the bow m, age 0..1, amplitude m)

void main() {
    float u, q, side;
    wakeParams(u, q, side);

    // Position AND both tangents out of the one function, so the normal cannot
    // disagree with the geometry — see the note on the five-argument wakePoint.
    vec3 Pu, Pq;
    vec3 P = wakePoint(u, q, side, Pu, Pq);

    // HANDEDNESS — PORT FRAME. The reference writes cross(Pq, Pu) * side in
    // Babylon's LEFT-handed world. This port's world is that world mirrored in
    // z, and a cross product is a pseudovector: for a reflection M,
    // cross(M a, M b) = -M(cross(a, b)). The mirrored surface's normal is
    // therefore the NEGATION of the reference's expression, i.e. cross(Pu, Pq).
    //
    // The '* side' is not cosmetic either. The two walls are mirror images of
    // each other, and mirroring a parametric surface reverses the handedness of
    // its tangent pair — without the factor the product points to the concave
    // side of one wall and to the CONVEX side of the other. The fragment stage
    // turns the normal toward the eye before shading, so the lit result looks
    // fine either way and the error hides in the BRDF, until the one term that
    // asks which side of the sheet it is on: the barrel occlusion lands on the
    // open outer face of the left wall and leaves the inside of the curl
    // unshaded. Debug mode 10 is the view that catches it.
    //
    // THE INVARIANT BOTH FACTORS ESTABLISH: vNormal points to the CONCAVE side
    // of the sheet on both walls.
    vec3 N = cross(Pu, Pq) * side;
    float nl = length(N);
    // Degenerate where the amplitude envelope has collapsed the strip onto its
    // own spine — the tail column, and the frames just after the player lets go.
    N = (nl > 1e-7) ? N / max(nl, 1e-8) : vec3(0.0, 1.0, 0.0);

    vec4 sc = wakeScalars(u, side);

    vWorld = vec4(P, distance(P, uCameraPos));
    vNormal = vec4(N, sc.y);
    vSec = vec4(q, sc.z, sc.w, sc.x);
    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

/**
 * The beauty fragment stage.
 *
 * `lib/spellLights` belongs to SPELLS and may not be registered yet; including a
 * missing chunk throws at material construction, which would take the whole wake
 * down rather than losing one additive term. `SurfWake` probes for it and passes
 * the answer here, exactly as `Terrain` and `Character` do.
 *
 * @param {{spellLights?: boolean}} [opts]
 * @returns {string}
 */
export function wakeFragment(opts) {
    const spells = !!(opts && opts.spellLights);

    return /* glsl */ `
#include "lib/noise"
#include "lib/shading"
${spells
        ? '#include "lib/spellLights"'
        : "// lib/spellLights not registered — the spell term is omitted"}
#include "lib/atmosphere"
#include "lib/wake"
// Last, exactly as the reference orders it: the cascade lookup needs nothing
// from above but is a large chunk and reads better at the end.
#include "lib/shadowLookup"

in vec4 vWorld;
in vec4 vNormal;
in vec4 vSec;

/// Per-term diagnostic; see the switch at the bottom. SNOWFLOW.wake.debug.
uniform float wakeDebug;

layout(location = 0) out vec4 outColor;

${spells ? "" : /* glsl */ `
/// Compile-time scaffold used only while SPELLS is unbuilt. NOT a fallback that
/// should survive into a finished port: with it in place a spell cast into the
/// inside of a curl lights nothing, and shots 07-11 lose the effect entirely.
vec3 spellLightingSnow(vec3 world, vec3 N, vec3 V,
                       float thickness, float strength, float radius) {
    return vec3(0.0);
}
const float spellLightCount = 0.0;
`}

void main() {
    float q = vSec.x;

    // 1. Erosion. Identical call in all three fragment stages, or the wake casts
    //    and occludes with a solid wall it is not drawing.
    if (wakeEroded(vSec.y, q, vSec.z, wakeTime)) { discard; }

    vec3 world = vWorld.xyz;
    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;   // toward the sun, world space, right-handed Y-up

    // 2. The wake is an open sheet with a curl in it, so both faces are visible
    //    and winding says nothing useful. Turning the normal toward the eye is
    //    right for a sheet of powder a few centimetres thick — light gets
    //    through it either way, and the alternative is a black inside face on
    //    the barrel.
    vec3 Ng = normalize(vNormal.xyz);
    float facing = (dot(Ng, V) >= 0.0) ? 1.0 : -1.0;
    vec3 N = Ng * facing;
    vec3 geoN = N;   // flipped but un-grained: what the depth pass rendered

    // Ng points to the CONCAVE side by construction (see the vertex stage), so
    // this is true exactly when the eye is inside the curl. That is the one
    // thing the shading needs to know that the normal alone cannot say: the
    // inside of a barrel of snow is a cave, and it has to go dark and blue or
    // the whole wall reads as a cut-out lit from nowhere.
    bool inside = facing > 0.0;

    // 3-4. Broken-snow grain. Without it the wall is the one surface in frame
    //      with no detail on it, which is instantly legible next to a snow field
    //      carrying three scales of it.
    vec3 ddxW = dFdx(world);
    vec3 ddyW = dFdy(world);
    float footprint = max(length(vec2(length(ddxW.xz), length(ddyW.xz))), 1e-4);
    // TWO OBLIQUE PROJECTIONS of the world position, not the XZ plane. The wave
    // face is close to vertical over most of its height, so a planar XZ lookup
    // barely moves across it and the grain comes out as horizontal banding — the
    // one pattern that reads as a rendering error rather than as snow. Slicing
    // 2D noise along two non-axis-aligned directions gives a field that varies
    // at the same rate whichever way the surface faces, for two dot products.
    vec2 gp = vec2(
        dot(world, vec3(0.91, 0.23, -0.35)),
        dot(world, vec3(0.28, 0.84, 0.46))
    );
    vec3 up = (abs(N.y) > 0.99) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);

    // Two scales, each faded out by pixel footprint, mirroring the three the
    // snow field uses. One scale alone gives the wall a single characteristic
    // grain size, which is exactly how it reads as a different substance from
    // the field it was thrown out of. Only noised()'s derivatives are used.
    float fineFade = 1.0 - smoothstep(0.012, 0.09, footprint);
    if (fineFade > 0.002) {
        vec3 g = noised(gp * 26.0);
        N = normalize(N + (T * g.y + B * g.z) * 0.15 * fineFade);
    }
    float coarseFade = 1.0 - smoothstep(0.09, 0.55, footprint);
    if (coarseFade > 0.002) {
        vec3 g = noised(gp * 5.5);
        N = normalize(N + (T * g.y + B * g.z) * 0.10 * coarseFade);
    }

    // 5. Material. Freshly displaced snow: brighter and rougher than the pack.
    vec3 albedo = vec3(0.895, 0.920, 0.965);
    float roughness = 0.80;
    vec3 f0 = vec3(0.026);

    // Thin at the lip, deep at the base. THIS GRADIENT IS THE WHOLE READ — it is
    // most of what separates the wall from a white ribbon.
    //
    // The lip end does not go to zero. A wall of thrown powder is ten to thirty
    // centimetres through, not tissue: at 0.04 the transmission lobe runs at
    // near-full amplitude with a nearly white tint, and multiplied by a
    // 13-degree sun whose beam is roughly 17:13:6 it comes out several times
    // brighter than the direct diffuse and unmistakably WARM. On white snow that
    // reads as dirt — the outer face of the wall came out brown. 0.32 is a
    // floor, not a taste.
    float thickness = mix(0.92, 0.32, smoothstep(0.15, 0.95, q));

    // 6. Shadow. geoN, not the grained N, so the lookup matches what the depth
    //    pass rendered.
    float NdotL = dot(N, L);
    float NdotV = clamp(dot(N, V), 1e-4, 1.0);
    float noiseRot = shadowIGN(gl_FragCoord.xy) * TAU;
    float shadow = sunShadow(world, geoN, vWorld.w, noiseRot);

    vec3 sun = uSunColor;

    // 7. Occlusion — analytic, because the shadow map cannot supply it. The wake
    //    is a zero-thickness sheet, so a point on it sits at exactly the depth
    //    its own caster wrote and can never self-occlude; and under a 13-degree
    //    sun the lip's cast shadow lands metres away rather than on the face
    //    beneath it. EVERY BIT of the "inside the curl is dark" read has to come
    //    from here, and its absence is what made the first version look like a
    //    white cut-out pasted over the snow.
    //
    //    Only the inside of the curl, and nothing else. Every open face renders
    //    at EXACTLY the brightness of the snow it was thrown out of, and the
    //    reason is the tonemapper rather than the lighting: AgX desaturates hard
    //    as it approaches its shoulder, which is what makes sunlit snow read
    //    white despite that warm beam. Half a stop below the shoulder the curve
    //    stops rolling the saturation off and the same beam on the same white
    //    albedo comes back as tan — so a broad, gentle AO-shaped darkening does
    //    not read as "slightly shaded snow", it reads as brown snow next to
    //    white snow.
    float barrel = inside
        ? smoothstep(0.05, 0.75, q) * (0.45 + 0.55 * vNormal.w)
        : 0.0;
    float occ = mix(1.0, 0.30, barrel);

    // 8. Direct. Wrap 0.66 — snow's terminator runs most of the way around the
    //    back of a drift.
    float diff = wrapDiffuse(NdotL, 0.66);
    vec3 directTerm = albedo * INV_PI * sun * diff * shadow;
    vec3 color = directTerm;

    // 9. Transmission, coupled much harder to the shadow term than the snow
    //    field's is. On the ground a shadowed drift is still fed by light
    //    scattering in from lit snow a few centimetres away; a wall of powder
    //    standing in its own shadow with air on both sides has no such
    //    neighbour, and leaving it at half strength was most of why the shadowed
    //    side stayed white.
    //
    //    Strength well under the terrain's (x0.45) and a WIDER radius (1.5), so
    //    the tint reaches the blue end at a lower thickness. Together those keep
    //    the backlit glow reading as light coming through snow rather than as
    //    the sun reflecting off something tan. Argument order here is the
    //    reference's (N, L, V, ...) seven-argument form from lib/shading.
    vec3 sss = snowSubsurface(N, L, V, sun, thickness, sssStrength * 0.45, 1.5);
    vec3 sssTerm = sss * albedo * mix(0.18, 1.0, shadow);
    color += sssTerm;

    // 10. GGX, only where the sun is above the horizon of this normal.
    vec3 specTerm = vec3(0.0);
    if (NdotL > 0.0) {
        vec3 H = normalize(V + L);
        float D = distributionGGX(clamp(dot(N, H), 0.0, 1.0), roughness);
        float Vis = visSmithGGXCorrelated(NdotV, NdotL, roughness);
        vec3 F = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), f0);
        specTerm = sun * D * Vis * F * NdotL * shadow;
    }
    color += specTerm;

    // 11. Ambient, plus the bounce off the enormous white surface underneath the
    //     wall: a second SH evaluation straight up at 30% of ambient, gated to
    //     downward-facing normals and tinted by albedo.
    //     skyIrradiance() already folds uAmbientIntensity in.
    vec3 irradiance = skyIrradiance(N);
    irradiance += skyIrradiance(vec3(0.0, 1.0, 0.0))
                * 0.30 * clamp(-N.y * 0.5 + 0.5, 0.0, 1.0) * albedo;
    vec3 ambientTerm = albedo * INV_PI * irradiance;
    color += ambientTerm;

    // 12. Sky reflection. skySpecular() is the reference's own selector,
    //     sqrt(roughness) * 6.0 = mip 5.366 into the equirect LUT.
    vec3 R = reflect(-V, N);
    vec3 skyTerm = skySpecular(R, roughness)
                 * fresnelSchlickRough(NdotV, f0, roughness) * uAmbientIntensity;
    color += skyTerm;

    // 13. Spell light, ABOVE the occlusion so the barrel darkens it along with
    //     everything else — a spell cast into the inside of a curl should light
    //     the cave, not shine through the wall of it.
    //
    //     spellLightingSnow() rather than the §3.1 spellLighting(): the wake
    //     runs the SAME transmission the sun runs on it, which means its own
    //     sssStrength * 0.45 and radius 1.5 — not the terrain's sssRadius, which
    //     is what the narrow contract form would substitute. It returns the
    //     response per unit albedo and already carries INV_PI, so the call site
    //     multiplies by albedo and nothing else.
    if (spellLightCount > 0.5) {
        color += spellLightingSnow(world, N, V, thickness, sssStrength * 0.45, 1.5) * albedo;
    }

    // 14. Occlusion, applied LAST and to the finished radiance, going blue in
    //     proportion wherever it darkens.
    //
    //     The textbook AO scales ambient and leaves direct light alone, but here
    //     the ambient is where all the blue lives and the sun is a warm
    //     13-degree beam — attenuating one and not the other does not darken a
    //     surface, it re-weights a warm source against a cool one. And a surface
    //     that dims without shifting hue drops below the tonemapper's
    //     desaturating shoulder still carrying the sun's warmth, and lands on
    //     tan. Real snow does not do that: light reaching into a fold of snow
    //     has scattered through snow to get there, and snow absorbs red over any
    //     appreciable path, which is why a snow cave is blue and not grey.
    //     Tying the tint to (1 - occ) rather than to 'barrel' means the two can
    //     never drift apart.
    vec3 caveTint = mix(vec3(1.0), vec3(0.55, 0.72, 1.0), (1.0 - occ) * 0.95);
    color *= occ * caveTint;

    // 15. Glints, at half the snow field's weight.
    if (glintIntensity > 0.001) {
        float g = snowGlints(world.xz, N, V, L, footprint, glintIntensity, glintGrazing);
        color += sun * g * shadow * 0.5;
    }

    // 16. Aerial perspective. aerial() builds viewDir as normalize(world -
    //     uCameraPos), which is exactly the reference's -V.
    color = aerial(color, world);

    // 17. Per-term diagnostic, because "the wall is the wrong colour" is not a
    //     question any amount of staring at the composite can answer. Each mode
    //     returns one term in the same radiance units the beauty pass works in,
    //     so the tonemapper shows it at the exposure it actually contributes at.
    //
    //       1 direct  2 subsurface  3 ambient  4 sky spec  5 sun spec
    //       6 occlusion  7 shadow  8 |N.L| x12  9 |N.L| unscaled
    //      10 red = inside the curl, green = the open outer face
    float dbg = wakeDebug;
    if (dbg > 0.5) {
        if (dbg < 1.5) { color = directTerm; }
        else if (dbg < 2.5) { color = sssTerm; }
        else if (dbg < 3.5) { color = ambientTerm; }
        else if (dbg < 4.5) { color = skyTerm; }
        else if (dbg < 5.5) { color = specTerm; }
        else if (dbg < 6.5) { color = vec3(occ * 12.0); }
        else if (dbg < 7.5) { color = vec3(shadow * 12.0); }
        else if (dbg < 8.5) { color = vec3(max(NdotL, 0.0) * 12.0); }
        // Unscaled, to line up with the snow material's own 'ndotl' view — the
        // only way to compare the two surfaces is on one screen at one scale.
        else if (dbg < 9.5) { color = vec3(max(NdotL, 0.0)); }
        // 10: the view that says whether the two mirrored walls agree. Build it;
        // it is how the '* side' bug above was found.
        else { color = inside ? vec3(9.0, 0.0, 0.0) : vec3(0.0, 9.0, 0.0); }
    }

    outColor = vec4(color, 1.0);
}
`;
}

// ----------------------------------------------------------- shadow cascades

/**
 * The cascade depth vertex stage. Same `wakePoint` as the beauty pass, and the
 * erosion travels with it — the fragment stage below discards the same texels,
 * or the wake casts the shadow of a solid wall it is not rendering, which on a
 * crest that is half powder is the difference between a shadow and a stripe.
 * @type {string}
 */
export const WAKE_DEPTH_VERTEX = /* glsl */ `
#include "lib/wake"

${LATTICE}

uniform mat4 lightViewProjection;

out vec4 vSec;   // (q, distance behind the bow m, age 0..1, wake clock s)

void main() {
    float u, q, side;
    wakeParams(u, q, side);

    vec3 P = wakePoint(u, q, side, wakeTime);
    vec4 sc = wakeScalars(u, side);

    vSec = vec4(q, sc.z, sc.w, wakeTime);
    gl_Position = lightViewProjection * vec4(P, 1.0);
}
`;

/**
 * The cascade depth fragment stage — the shared one from `prepass.glsl.js` plus
 * the erosion discard, which is the whole reason the wake cannot use it.
 * @type {string}
 */
export const WAKE_DEPTH_FRAGMENT = /* glsl */ `
#include "lib/wake"

in vec4 vSec;

layout(location = 0) out vec4 outColor;

void main() {
    if (wakeEroded(vSec.y, vSec.x, vSec.z, vSec.w)) { discard; }
    outColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
}
`;

// -------------------------------------------------------------- depth prepass

/**
 * The camera-space depth prepass vertex stage.
 *
 * The wake belongs in the prepass for two separate reasons: it is the largest
 * moving object in the frame, so the temporal resolve needs its depth to
 * reproject anything in front of it, and a two-metre wall of snow standing on
 * the field ought to occlude the trench beside it. It writes mask 0 — it is
 * matte snow, not ice.
 * @type {string}
 */
export const WAKE_PREPASS_VERTEX = /* glsl */ `
#include "lib/wake"

${LATTICE}
${PREPASS_VS_VARYINGS}
${PREPASS_EMIT}

uniform mat4 viewProjection;

out vec4 vSec;   // (q, distance behind the bow m, age 0..1, wake clock s)

void main() {
    float u, q, side;
    wakeParams(u, q, side);

    vec3 P = wakePoint(u, q, side, wakeTime);
    vec4 sc = wakeScalars(u, side);

    vSec = vec4(q, sc.z, sc.w, wakeTime);
    prepassEmit(viewProjection * vec4(P, 1.0), 0.0);
}
`;

/**
 * The depth-prepass fragment stage. Same erosion again: a wall that is visibly
 * half powder must not report itself to the post chain as solid.
 * @type {string}
 */
export const WAKE_PREPASS_FRAGMENT = /* glsl */ `
#include "lib/wake"

${PREPASS_FS_VARYINGS}
in vec4 vSec;

layout(location = 0) out vec4 outColor;

void main() {
    if (wakeEroded(vSec.y, vSec.x, vSec.z, vSec.w)) { discard; }
    outColor = vec4(vViewZ, vMask, 0.0, 1.0);
}
`;
