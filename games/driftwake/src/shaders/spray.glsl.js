/**
 * Snow spray — the billboard vertex stage and the powder shading. [WAKE]
 *
 * Port of `spray.vertex.wgsl` and `spray.fragment.wgsl`. One pipeline serves
 * every source of airborne snow in the demo: the surf plume, the footfall kick
 * and all five spells. That is deliberate — a separate emitter per effect means
 * separate pipelines, separate warm-up, separate sorting, and five slightly
 * different ideas about what lit snow powder looks like.
 *
 * Airborne snow is not a fogged sprite. It is a cloud of ice crystals, and the
 * two things that make it read are the two a plain alpha billboard leaves out:
 *
 *   forward scatter   Looking toward the sun through a puff it is BRIGHTER than
 *                     the snow behind it, and warm. Looking down-sun it is a dim
 *                     blue-grey. That swing is well over a stop and it is the
 *                     entire difference between "spray catching the light" and
 *                     "grey smoke".
 *   shadowing         Spray thrown inside the figure's own shadow must go dark,
 *                     or every footfall looks self-illuminated. It reads the
 *                     same cascades everything else does.
 *
 * The billboard is shaded as a SPHERE: the normal is reconstructed from the
 * quad's own coordinates, so a puff has a lit side and a dark side instead of
 * being a flat disc.
 *
 * ---------------------------------------------------------------------------
 * VARYING BUDGET (ARCHITECTURE.md §4.1): three vectors.
 *     vWorld   (world.xyz, distance to the camera)
 *     vCorner  the UNROTATED billboard corner
 *     vState   (age01, seed, kind, alpha)
 *
 * HANDEDNESS (ARCHITECTURE.md §6): nothing here consumes a world basis it did
 * not receive. `camRight` / `camUp` are lifted straight off the view matrix on
 * the CPU (`particles.js`) and the spherical normal is built in that same basis,
 * so the frame is Three's own whichever way the world is mirrored. There is no
 * cross product in this file.
 */

// ---------------------------------------------------------------------- vertex

/**
 * The billboard expansion. The mesh carries no geometry: `position` is
 * (particle index, cornerX, cornerY) and every corner is placed here from the
 * particle data texture, which keeps the vertex buffer static and the per-frame
 * traffic down to eight floats per live grain.
 * @type {string}
 */
export const SPRAY_VERTEX = /* glsl */ `
#include "lib/common"

in vec3 position;   // (particle index, cornerX, cornerY) — NOT a position

/// 5120 x 2 RGBA32F, NEAREST, CLAMP.
///   row 0  (x, y, z, radius m — already scaled by 'grow')
///   row 1  (age01, seed, kind, alpha)
/// RGBA32F and not RGBA16F: row 0 holds absolute world coordinates that reach
/// ~870 m on this map, where fp16 quantises to about half a metre.
uniform sampler2D sprayTex;
/// Realm grain color (owner 2026-08-13). realms.js vfx.sprayAlbedo via
/// SprayField.applyRealm; default = Cold's old hardcode.
uniform vec3 uSprayAlbedo;
/// The camera's right and up in world space — the first two ROWS of the view
/// matrix, lifted on the CPU so the basis cannot disagree with the projection.
uniform vec3 camRight;
uniform vec3 camUp;

out vec4 vWorld;    // xyz world position, w distance to the camera
out vec2 vCorner;   // the UNROTATED corner; see below
out vec4 vState;    // (age01, seed, kind, alpha)

void main() {
    int i = int(position.x);
    vec2 corner = position.yz;

    vec4 a = texelFetch(sprayTex, ivec2(i, 0), 0);
    vec4 b = texelFetch(sprayTex, ivec2(i, 1), 0);

    // A dead grain has radius zero, which collapses all four corners onto one
    // point. The rasteriser then produces no fragments at all — a cheaper way to
    // skip a particle than any branch would be.
    float radius = a.w;

    // Spin, hashed off the seed, so a burst is not four hundred identical discs:
    // a per-grain static phase plus a per-grain signed spin rate of up to
    // +/-1.5 rad over the particle's whole life. Rotating the CORNER rather than
    // a texture keeps the billboard square-free.
    float ang = b.y * 6.28318530718 + b.x * (b.y - 0.5) * 3.0;
    float cs = cos(ang);
    float sn = sin(ang);
    vec2 rc = vec2(corner.x * cs - corner.y * sn, corner.x * sn + corner.y * cs);

    vec3 world = a.xyz + (camRight * rc.x + camUp * rc.y) * radius;

    vWorld = vec4(world, distance(world, uCameraPos));
    // The UNROTATED corner is what the fragment shades. Its disc test, edge
    // falloff and spherical normal are all built in the billboard's own
    // unrotated frame; only the vertex positions are rotated. That is what keeps
    // the billboard square-free while the shading stays axis-consistent.
    vCorner = corner;
    vState = b;
    gl_Position = uViewProj * vec4(world, 1.0);
}
`;

// -------------------------------------------------------------------- fragment

/**
 * The powder fragment stage.
 *
 * `lib/spellLights` belongs to SPELLS and may not be registered yet; including a
 * missing chunk throws at material construction, which would take the whole
 * spray system down rather than losing one additive term. `SprayField` probes
 * for it and passes the answer here, exactly as `Terrain` and `Character` do.
 *
 * @param {{spellLights?: boolean}} [opts]
 * @returns {string}
 */
export function sprayFragment(opts) {
    const spells = !!(opts && opts.spellLights);

    return /* glsl */ `
#include "lib/noise"
#include "lib/shading"
${spells
        ? '#include "lib/spellLights"'
        : "// lib/spellLights not registered — the spell term is omitted"}
#include "lib/atmosphere"
#include "lib/shadowLookup"

in vec4 vWorld;
in vec2 vCorner;
in vec4 vState;

uniform vec3 camRight;
uniform vec3 camUp;
/// Realm grain color — consumed below in main(). Declared HERE as well as in
/// SPRAY_VERTEX: cf1de2e4 promoted the albedo to a uniform but only declared
/// it in the vertex stage, and an undeclared identifier fails the whole
/// fragment compile (bootcheck: "Material Name: spray ... 'uSprayAlbedo' :
/// undeclared identifier"), leaving every puff on the invalid-program path.
uniform vec3 uSprayAlbedo;

layout(location = 0) out vec4 outColor;

${spells ? "" : /* glsl */ `
/// Compile-time scaffold used only while SPELLS is unbuilt. NOT a fallback that
/// should survive into a finished port: airborne snow inside a spell is the most
/// legible thing the dynamic lights do.
vec3 spellLightingParticle(vec3 world, vec3 N, vec3 albedo) {
    return vec3(0.0);
}
const float spellLightCount = 0.0;
`}

void main() {
    float r2 = dot(vCorner, vCorner);
    if (r2 > 1.0) { discard; }

    vec4 state = vState;
    float kind = state.z;

    // Break the disc's edge — a perfectly circular puff is the tell that gives
    // billboards away, and a hashed radial wobble costs one noise fetch. Sampled
    // ON THE UNIT CIRCLE so the field is continuous around the rim.
    float ang = atan(vCorner.y, vCorner.x);
    float wob = 1.0 + 0.34 * noise2(vec2(cos(ang), sin(ang)) * 2.4 + state.y * 37.0);
    float r = sqrt(r2) / wob;
    if (r > 1.0) { discard; }

    // Soft-edged for powder, harder for a clod of thrown snow. The mix by 'kind'
    // is a straight 0/1 selector in practice.
    float edge = mix(
        pow(clamp(1.0 - r * r, 0.0, 1.0), 1.6),
        smoothstep(1.0, 0.65, r),
        kind
    );
    // Powder is close to transparent on its own; density has to come from many
    // grains overlapping, or a single one turns into a decal. 0.26 was low enough
    // that even fifteen hundred live grains read as haze rather than as spray —
    // this number was raised deliberately.
    float alpha = state.w * edge * mix(0.36, 0.55, kind);
    if (alpha < 0.004) { discard; }

    vec3 world = vWorld.xyz;
    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;   // toward the sun, world space, right-handed Y-up

    // Spherical normal from the billboard's own coordinates: nz = sqrt(1 - r^2)
    // reconstructs a hemisphere normal in the camera basis, so a puff has a lit
    // side and a dark side instead of being a flat disc.
    float nz = sqrt(max(0.0, 1.0 - r2));
    vec3 N = normalize(camRight * vCorner.x + camUp * vCorner.y + V * nz);

    float noiseRot = shadowIGN(gl_FragCoord.xy) * TAU;
    float shadow = sunShadow(world, N, vWorld.w, noiseRot);

    vec3 sun = uSunColor;

    // Snow crystals in air scatter almost isotropically at the surface and very
    // strongly forward through the volume, so both terms are needed.
    vec3 albedo = uSprayAlbedo;
    float diff = wrapDiffuse(dot(N, L), 0.75);
    vec3 color = albedo * INV_PI * sun * diff * shadow;

    // Forward scatter through the puff. 'mu' is 1 looking straight into the sun.
    //
    // The coefficient is small and has to be. A phase function is normalised over
    // the sphere, so using it as a direct multiplier on radiance — without the
    // optical depth and scattering albedo that belong in front of it — overstates
    // the peak by more than an order of magnitude: at 4.2 a footfall puff comes
    // out four times brighter than sunlit snow and clips to flat white.
    //
    // Mie asymmetry g = 0.55 here; the atmosphere uses 0.62 for its own lobe.
    float mu = dot(-V, L);
    float fwd = phaseMie(mu, 0.55) * 0.85;
    // mix(0.25, 1.0, shadow): spray thrown inside the figure's own shadow must go
    // dark. (1 - kind*0.5): clods scatter forward half as much as powder.
    color += sun * albedo * fwd * mix(0.25, 1.0, shadow) * (1.0 - kind * 0.5);

    // Sky, which is what fills the shadowed side and keeps it blue.
    // skyIrradiance() already folds uAmbientIntensity in.
    color += albedo * INV_PI * skyIrradiance(N);

    // Spell light. A mist of crystals a metre from a bright emitter picks up far
    // more of it than the ground does, which is why a Bloom's fallout curtain
    // reads as lit from within rather than as grey powder over a glow.
    //
    // spellLightingParticle(): a single wide-wrap (0.8) term with no
    // transmission, because a billboarded grain has no thickness worth
    // modelling. It carries its own albedo and INV_PI.
    if (spellLightCount > 0.5) {
        color += spellLightingParticle(world, N, albedo);
    }

    color = aerial(color, world);

    outColor = vec4(color, alpha);
}
`;
}
