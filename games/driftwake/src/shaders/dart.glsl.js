/**
 * The primary-bolt stages — one beauty pair, nothing else.
 *
 * The bolt is a hexagonal bipyramid oriented along its own velocity: an
 * elongated splinter, sharp by construction. It is the same primitive
 * `combat/enemyVis.js` builds for its ice shards (8 vertices, 12 triangles),
 * for the same reason — a single closed solid whose facets come out exactly
 * flat when the fragment stage takes its normal from screen-space derivatives.
 * Twelve of them in flight is 144 triangles against a measured baseline of
 * 1,799,120, so the whole pool costs less than a rounding error and one draw.
 *
 * NO SHADOW CASTER AND NO PREPASS ENTRY. A bolt is 62 cm long, travels at
 * 21 m/s and lives 1.9 s at the outside; a cascade render of it would cost two
 * more draws per frame to move a shadow the player cannot follow. The crystals
 * pay that because they *stand*.
 *
 * THE REALM SWAP LIVES ENTIRELY IN THIS FILE'S UNIFORMS. Cold ice, sand
 * fulgurite and ash cinder are one program: the ice path (refraction through
 * the body, sky transmitted, blue absorption) and the opaque path (a lit crust
 * with light coming out of its fractures) are BOTH evaluated every fragment and
 * lerped by `uRealmSurface.y`. No branch, no `#define`, no variant — and
 * therefore no pipeline re-specialisation at a realm boundary, which is exactly
 * the stutter a realm boundary must not have. The added cost is ALU on 144
 * triangles.
 *
 * VARYING BUDGET: two slots.
 *
 *     vWorldH    (world.xyz, h01 — 0 at the tip, 1 at the tail apex)
 *     vAgeKind   (age 0..1, kind — 0 sharp bolt, 1 fat thrown head)
 */

/**
 * Beauty vertex stage.
 *
 * Data texture, three rows, one column per bolt:
 *
 *   row 0   (x, y, z, scale)      scale 0 = dead, and a dead bolt collapses
 *                                 all eight of its vertices onto one point, so
 *                                 its twelve triangles have no area and the
 *                                 rasteriser skips them. This is the same
 *                                 switch-off `waterBody.js` and `crystals.js`
 *                                 use, and it is why the draw call and the
 *                                 vertex count do not depend on how many bolts
 *                                 are up.
 *   row 1   (dx, dy, dz, age01)   unit velocity direction + normalised age
 *   row 2   (length, width, kind, spin)
 *
 * The local frame puts the TIP at the origin and the tail apex at -Y, so the
 * texture's position IS the leading point of the projectile — which is what the
 * swept hit test in `combat/spellHits.js` integrates, and the two must agree to
 * the centimetre or the bolt visibly passes through what it damaged.
 *
 * @type {string}
 */
export const vertex = /* glsl */`
#include "lib/common"

in vec3 position;               // (boltIndex, vertexIndex, unused)

uniform sampler2D boltTex;

out vec4 vWorldH;
out vec2 vAgeKind;

/**
 * One vertex of the bipyramid, in local space, tip at the origin.
 *
 * v 0      tail apex, (0, -1, 0)
 * v 1..6   the ring, radius 1 at y = -0.7 — 30 % of the way back from the tip,
 *          which is what makes the front cone long and the back cone short:
 *          a dart, not a diamond.
 * v 7      the tip, (0, 0, 0)
 */
vec3 boltVert(int v) {
    if (v == 0) return vec3(0.0, -1.0, 0.0);
    if (v == 7) return vec3(0.0,  0.0, 0.0);
    float a = float(v - 1) * (TAU / 6.0);
    return vec3(cos(a), -0.7, sin(a));
}

void main() {
    int i = int(position.x);
    int v = int(position.y);

    vec4 a = texelFetch(boltTex, ivec2(i, 0), 0);   // pos, scale
    vec4 b = texelFetch(boltTex, ivec2(i, 1), 0);   // dir, age01
    vec4 c = texelFetch(boltTex, ivec2(i, 2), 0);   // len, wid, kind, spin

    vec3 L = boltVert(v);

    // An orthonormal frame about the flight direction. The reference axis is
    // swapped near vertical for the usual reason: cross(up, up) is zero, and a
    // bolt fired straight down at a target below the player is not a rare case.
    vec3 f = normalize(b.xyz + vec3(0.0, 1e-6, 0.0));
    vec3 ref = abs(f.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 r = normalize(cross(ref, f));
    vec3 u = cross(f, r);

    // Roll about the axis, so the hexagon does not present the same edge to the
    // camera on every shot. Free: it is one sin/cos on a 2-vector.
    float sn = sin(c.w);
    float cs = cos(c.w);
    vec2 rot = vec2(L.x * cs - L.z * sn, L.x * sn + L.z * cs);

    vec3 P = a.xyz
           + f * (L.y * c.x * a.w)
           + r * (rot.x * c.y * a.w)
           + u * (rot.y * c.y * a.w);

    vWorldH = vec4(P, -L.y);
    vAgeKind = vec2(b.w, c.z);

    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

/**
 * Beauty fragment stage.
 *
 * Three materials out of one program, selected by the realm block and not by a
 * branch:
 *
 *   cold   `uRealmSurface.y` = 1 — the refracted path wins. Clear ice: the sky
 *          is transmitted through the body, tinted by `uRealmAbsorb` over an
 *          optical path that is long at grazing and short face-on, with a
 *          near-mirror Fresnel at the silhouette. `uRealmEmissive` is (0,0,0),
 *          so the emissive term contributes nothing and costs one madd.
 *   sand   0.45 — half. Fulgurite is fused glass with a grit crust: it carries
 *          a smeared warm reflection rather than a clean transmitted image, so
 *          the two paths sit on top of each other and the roughness
 *          (`uRealmSurface.x`) does the rest.
 *   ash    0.05 — the opaque path wins. A charcoal crust lit by the sun and the
 *          sky, with cinder-orange coming OUT of it along the ridge lines and
 *          the tip, which is where the crust has torn. That is the emissive
 *          mask: strongest at the leading point, strongest at grazing, and
 *          broken up by a crust noise so it reads as fracture rather than as a
 *          gradient.
 *
 * @type {string}
 */
export const fragment = /* glsl */`
#include "lib/common"
#include "lib/noise"
#include "lib/shading"
#include "lib/spellLights"
#include "lib/atmosphere"
#include "lib/shadowLookup"

in vec4 vWorldH;      // xyz world, w = 0 at the tip -> 1 at the tail
in vec2 vAgeKind;     // age01, kind

layout(location = 0) out vec4 outColor;

/** The realm palette. Written on a realm boundary, read at draw time. */
uniform vec3 uRealmAbsorb;      // absorption per metre through the body
uniform vec3 uRealmBody;        // opaque-path albedo
uniform vec3 uRealmEmissive;    // light coming out of the material; cold = 0
uniform vec3 uRealmLitTint;     // albedo the spell-light pool shades against
uniform vec4 uRealmSurface;     // (roughness, translucency, emisPow, opacity+)

void main() {
    vec3 world = vWorldH.xyz;
    float h01 = vWorldH.w;
    float age = vAgeKind.x;

    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;

    // Flat facets from the geometry itself — the crystal stage's construction,
    // including the forced flip. See crystal.glsl.js: dFdy carries the opposite
    // sign under WebGL and the flip is what makes that self-correcting.
    vec3 dx = dFdx(world);
    vec3 dy = dFdy(world);
    vec3 N = normalize(cross(dx, dy));
    if (dot(N, V) < 0.0) { N = -N; }

    float NdotV = clamp(dot(N, V), 1e-4, 1.0);
    float NdotL = dot(N, L);
    float viewDist = distance(world, uCameraPos);
    float shadow = sunShadow(world, N, viewDist, ign(gl_FragCoord.xy) * TAU);
    vec3 sun = uSunColor;
    float rough = uRealmSurface.x;

    // ---- the transmitted path ------------------------------------------------
    // Thickest at the ring, thin at both points, and long at grazing. One
    // refraction sample rather than the crystals' three: a bolt is a fraction of
    // a prism's screen size and the chromatic split cannot be told apart.
    float thick = 1.0 - abs(h01 - 0.3) * 1.4;
    float path = clamp((0.10 + 0.30 * thick) * (0.7 + 2.0 * (1.0 - NdotV)),
                       0.02, 1.4);
    vec3 mirror = reflect(-V, N);
    vec3 rd = refract(-V, N, 1.0 / 1.309);
    if (dot(rd, rd) < 0.5) { rd = mirror; }
    vec3 clear = textureLod(uSkyLUT, dirToLatLong(rd), 1.1).rgb
               * exp(-uRealmAbsorb * path);
    // Backlit bodies light along their length, tinted by what survived.
    clear += sun * INV_PI * uRealmBody
           * backScatter(N, L, V, 0.42, 2.2, 1.0) * sssStrength * 1.4
           * mix(0.25, 1.0, shadow);
    clear += skyIrradiance(N) * INV_PI * uRealmBody * 0.9;

    // ---- the opaque path -----------------------------------------------------
    vec3 solid = uRealmBody * INV_PI
               * (sun * wrapDiffuse(NdotL, 0.35) * shadow + skyIrradiance(N));

    vec3 color = mix(solid, clear, uRealmSurface.y);

    // ---- what comes out of the material -------------------------------------
    // Cold and sand write (0,0,0) here and this whole block folds to a multiply
    // by zero. Ash writes the cinder, and the mask puts it where a crust
    // actually tears: at the tip, along the silhouette, and in the noise.
    float crust = noise2(world.xz * 26.0 + age * 7.0) * 0.5 + 0.5;
    float emisMask = pow(clamp(1.0 - h01, 0.0, 1.0), uRealmSurface.z)
                   * (0.45 + 0.9 * pow(1.0 - NdotV, 2.0))
                   * (0.55 + 0.75 * crust);
    color += uRealmEmissive * emisMask;

    // ---- surface -------------------------------------------------------------
    vec3 F = fresnelSchlick(NdotV, vec3(0.021));
    vec3 skyRefl = textureLod(uSkyLUT, dirToLatLong(mirror), rough * 6.0).rgb;
    color = mix(color, skyRefl, F * (1.0 - rough));

    if (NdotL > 0.0) {
        vec3 H = normalize(V + L);
        float D = distributionGGX(clamp(dot(N, H), 0.0, 1.0), rough);
        float Vis = visSmithGGXCorrelated(NdotV, NdotL, rough);
        vec3 Fs = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), vec3(0.021));
        color += sun * D * Vis * Fs * NdotL * shadow;
    }

    // The player's own spells light the bolt like they light everything else.
    if (spellLightCount > 0.5) {
        color += spellLightingSurface(world, N, V, uRealmLitTint,
                                      vec3(0.021), rough, 0.5);
    }

    color = aerial(color, world);

    // Opaque enough to read at 21 m/s against a bright snowfield, and the realm
    // adds to it: fused glass and slag are both less transparent than ice.
    float alpha = clamp(
        0.52 + 0.34 * (1.0 - NdotV) + uRealmSurface.w, 0.0, 1.0
    );

    outColor = vec4(color, alpha);
}
`;
