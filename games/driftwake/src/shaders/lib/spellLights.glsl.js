/**
 * `lib/spellLights` [SPELLS] — the light a spell puts into the snow.
 *
 * ARCHITECTURE.md §3.1 signs exactly one entry point here:
 *
 *     vec3 spellLighting(vec3 worldPos, vec3 N, vec3 V, float thickness);
 *
 * It returns the pooled lights' response for a snow-like surface **without the
 * albedo**, because every consumer written against the contract multiplies by
 * its own albedo at the call site (`snow.glsl.js:495`,
 * `char.glsl.js:439`). Factoring the albedo out of the reference's
 * `albedo*(1/PI)*wrap*radiance + snowSubsurface(...)*albedo` is exact.
 *
 * Three further forms are published for the materials the reference gives them
 * to — `spellLightingSurface` for fabric, fur, water and ice, and
 * `spellLightingParticle` for airborne grains. They are additions, not
 * replacements: the §3.1 signature above is never renamed or re-signed.
 *
 * A small pool of tight-radius dynamic lights with one behaviour an ordinary
 * point light does not give you: a spell lights the snow *from inside* the drift
 * it is touching. That is not a diffuse term with a falloff on it — it is the
 * same transmission lobe the sun drives, fed by a light two metres away instead
 * of 150 million kilometres. Stand a glowing ribbon of water on a berm and the
 * near face goes bright while the *far* side of the crest glows through, because
 * the light entered the snow and came back out. Dropping that term and keeping
 * only the diffuse is the difference between a spell that lights the snow and a
 * spell that has a decal of light under it.
 *
 * Four lights, not six. Only two spells are ever up at once in practice, and a
 * loop the whole snow field pays for on every pixel is not the place to buy
 * headroom nothing spends. The `spellLightCount > 0.5` gate at each call site
 * skips the loop outright on the overwhelming majority of frames.
 *
 * Compiles and returns black with nothing cast: `count` is 0, the loop breaks on
 * its first iteration, and the accumulator is still zero. Every lit surface in
 * the project includes this chunk whether or not a spell is up, so that has to
 * be true rather than merely likely.
 *
 * HANDEDNESS: nothing in this file takes a cross product or consumes a chirality.
 * `L` is built as `normalize(lightPos - world)` — it points from the surface
 * *toward* the light, which is the same convention `uSunDir` uses and the sign
 * `backScatter` inside `snowSubsurface` depends on.
 *
 * Uniform block — declared here rather than at each call site, because six
 * unrelated materials include this and none of them should have to restate it:
 *
 *     spellLightPos[4]   xyz world position, w radius in metres
 *     spellLightCol[4]   rgb linear colour, w intensity (already scaled by
 *                        S.spellLight on the CPU)
 *     spellLightCount    live slot count, 0..4
 */

export default /* glsl */`
#include "lib/common"
#include "lib/shading"

// ------------------------------------------------------------------ uniforms

uniform vec4  spellLightPos[4];
uniform vec4  spellLightCol[4];
uniform float spellLightCount;

const int SPELL_LIGHT_MAX = 4;

// -------------------------------------------------------------- attenuation

/**
 * Windowed inverse square.
 *
 * Pure 1/d^2 never reaches zero, so a light with any reach at all keeps writing
 * a faint wash across the entire clipmap — which reads as the fog density
 * changing whenever a spell is cast. The window forces it to exactly zero at
 * 'radius', and the fourth power keeps the falloff physical everywhere except
 * the last fifth of the way out.
 *
 * The 0.25 in the denominator is a soft core: without it the term runs away at
 * the light's own position, and every spell that puts its emitter on the snow —
 * which is most of them — burns a clipped white disc into the ground.
 */
float spellAttenuation(float dist2, float radius) {
    float t2 = dist2 / max(radius * radius, 1e-4);
    if (t2 >= 1.0) { return 0.0; }
    float win = 1.0 - t2 * t2;
    return win * win / (dist2 + 0.25);
}

// ------------------------------------------------------------------- snow

/**
 * Snow's full response: wrapped diffuse plus transmission, per unit albedo.
 *
 * 'thickness' and 'sssRadius' are the same numbers the sun's term uses, so a
 * compressed trench answers a spell exactly as it answers the sun — tighter,
 * darker, less scattering — without any of that being restated here.
 *
 * Wrap constant for snow is 0.66, from the reference.
 */
vec3 spellLightingSnow(
    vec3 world, vec3 N, vec3 V, float thickness, float strength, float radius
) {
    vec3 acc = vec3(0.0);
    int n = int(spellLightCount);

    // Constant bound with a dynamic break, exactly as the reference writes it:
    // GLSL ES 3.00 allows a dynamic bound, but the constant form unrolls and is
    // what every driver in the target set handles identically.
    for (int i = 0; i < SPELL_LIGHT_MAX; i++) {
        if (i >= n) { break; }

        vec4 p = spellLightPos[i];
        vec3 d = p.xyz - world;
        float dist2 = dot(d, d);
        float att = spellAttenuation(dist2, p.w);
        if (att <= 0.0) { continue; }

        // Toward the light — the same sense as uSunDir.
        vec3 L = d * inversesqrt(max(dist2, 1e-8));
        vec3 radiance = spellLightCol[i].rgb * spellLightCol[i].w * att;

        acc += INV_PI * wrapDiffuse(dot(N, L), 0.66) * radiance;
        acc += snowSubsurface(N, L, V, radiance, thickness, strength, radius);
    }

    return acc;
}

/**
 * ARCHITECTURE.md §3.1. Strength and radius come from 'lib/shading''s uniform
 * block, which is where the sun's own term reads them from too.
 */
vec3 spellLighting(vec3 worldPos, vec3 N, vec3 V, float thickness) {
    return spellLightingSnow(worldPos, N, V, thickness, sssStrength, sssRadius);
}

// ------------------------------------------------------------- non-snow

/**
 * The same lights, for a surface that is not snow — fabric, fur, water, ice.
 *
 * Diffuse plus a GGX lobe, with a wrap the caller sizes: wool wraps a long way,
 * wet ice barely at all. No transmission, because the materials that want it
 * (the robe's thin under-layer, the water body itself) already have their own
 * and would double-count.
 *
 * Unlike the snow form this one takes the albedo, because the specular lobe is
 * not proportional to it and the two cannot be factored apart.
 */
vec3 spellLightingSurface(
    vec3 world, vec3 N, vec3 V, vec3 albedo, vec3 f0, float roughness, float wrap
) {
    vec3 acc = vec3(0.0);
    int n = int(spellLightCount);
    float NdotV = clamp(dot(N, V), 1e-4, 1.0);

    for (int i = 0; i < SPELL_LIGHT_MAX; i++) {
        if (i >= n) { break; }

        vec4 p = spellLightPos[i];
        vec3 d = p.xyz - world;
        float dist2 = dot(d, d);
        float att = spellAttenuation(dist2, p.w);
        if (att <= 0.0) { continue; }

        vec3 L = d * inversesqrt(max(dist2, 1e-8));
        vec3 radiance = spellLightCol[i].rgb * spellLightCol[i].w * att;

        acc += albedo * INV_PI * wrapDiffuse(dot(N, L), wrap) * radiance;

        float NdotL = dot(N, L);
        if (NdotL > 0.0) {
            vec3 H = normalize(V + L);
            float D = distributionGGX(clamp(dot(N, H), 0.0, 1.0), roughness);
            float Vis = visSmithGGXCorrelated(NdotV, NdotL, roughness);
            vec3 F = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), f0);
            acc += radiance * D * Vis * F * NdotL;
        }
    }

    return acc;
}

/**
 * Lights on airborne snow: a billboarded grain has no thickness worth
 * modelling, so this is a single wide-wrap (0.8) term. Cheap, because the spray
 * is the one system here that can have three thousand alpha-blended instances of
 * itself in flight — and it is why a Bloom's fallout curtain reads as lit from
 * within rather than as grey powder over a glow.
 */
vec3 spellLightingParticle(vec3 world, vec3 N, vec3 albedo) {
    vec3 acc = vec3(0.0);
    int n = int(spellLightCount);

    for (int i = 0; i < SPELL_LIGHT_MAX; i++) {
        if (i >= n) { break; }

        vec4 p = spellLightPos[i];
        vec3 d = p.xyz - world;
        float dist2 = dot(d, d);
        float att = spellAttenuation(dist2, p.w);
        if (att <= 0.0) { continue; }

        vec3 L = d * inversesqrt(max(dist2, 1e-8));
        acc += albedo * INV_PI * wrapDiffuse(dot(N, L), 0.8)
             * spellLightCol[i].rgb * spellLightCol[i].w * att;
    }

    return acc;
}
`;
