/**
 * `lib/clipmap` — vertex placement and displacement for the nested-ring terrain.
 * [TERRAIN]
 *
 * Port of `src/shaders/lib/clipmap.wgsl`, plus the shared body of the three
 * terrain vertex programs (`snow.vertex`, `terrainDepth.vertex`,
 * `terrainPrepass.vertex`), which in the reference is three copies of the same
 * twenty lines.
 *
 * The whole terrain is one static vertex buffer and one draw call. Vertices
 * carry only a grid index and a ring level; where they actually land is decided
 * here, every frame, from `lodCenter`. Nothing is rebuilt on the CPU, nothing
 * streams.
 *
 * Two things make this crack-free:
 *
 *  1. Each ring snaps its origin to TWICE its own vertex spacing, so the lattice
 *     never slides underneath the geometry and the surface does not swim. Once,
 *     rather than twice, would let the morph targets flip between frames.
 *
 *  2. Vertices morph toward the *next coarser* lattice across the outer band of
 *     their ring (CDLOD). The morph completes at normalised Chebyshev 0.86
 *     (|g| = 68.8 of 80) while the overlap band with the enclosing ring starts at
 *     |g| = 74, so by the time two rings coexist the inner one's vertices sit
 *     exactly on the coarser lattice and sample exactly the same height. No
 *     T-junctions, and no popping when a ring re-snaps.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COMPOSITE FUNCTION EXISTS (ARCHITECTURE.md §5)
 *
 * `clipmapSurface()` is the ONE call the beauty vertex stage, all three shadow
 * cascades and the depth prepass make. It carries the placement, the bicubic
 * height fetch, the sastrugi gate (`spacing < 0.42` with a 0.16 -> 0.42 fade) and
 * the deformation displacement in a single function, so the five programs are
 * identical by construction rather than by five copies staying in sync.
 *
 * The reference is blunt about the cost of getting this wrong: if the depth pass
 * displaced on a ring the beauty pass left flat — or band-limited it differently
 * — "the terrain would shadow against a surface that is not the one being drawn,
 * and every berm would acne."
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE — ARCHITECTURE.md §3 signs this chunk as "ring placement +
 * CDLOD morph, vertex-side" with no named signatures, so these are the contract:
 *
 *     struct ClipmapVertex { vec2 worldXZ; float spacing; float morph; };
 *     ClipmapVertex placeClipmapVertex(vec2 grid, float level, vec2 camXZ,
 *                                      float baseSpacing, float gridHalfN);
 *     vec2  worldToHeightUV(vec2 p, vec2 origin, float size);
 *     float sampleHeightBicubic(vec2 uv, float res);
 *
 *     struct ClipmapSurface { vec3 world; vec2 heightUV; float spacing;
 *                             float morph; float exposure; };
 *     ClipmapSurface clipmapSurface(vec3 gridAttr);
 *
 * UNIFORMS — declared here, not by the consumer. Do not re-declare them; GLSL has
 * no weak linkage and a second declaration is a compile error. `Terrain` hands
 * the whole block out by reference as `terrain.clipUniforms` so one write per
 * frame reaches all five programs:
 *
 *     sampler2D heightTex     RG32F 4096^2, CLAMP, LINEAR. .r height m, .g rock
 *     sampler2D auxTex        RGBA16F 2048^2, CLAMP, LINEAR. .a = exposure
 *     vec2      worldOrigin   (-1024, -1024)
 *     float     worldSize     2048 m
 *     float     heightRes     4096
 *     vec2      lodCenter     ring centre, world XZ — the CHARACTER, not the camera
 *     float     baseSpacing   0.085 m
 *     float     gridHalfN     80
 *     float     windAngle     radians
 *     float     sastrugiAmp   S.sastrugiStrength
 *
 * FRAGMENT STAGES must not include this chunk: it declares `heightTex`, which the
 * snow fragment has no unit to spare for (snow-shading.md §2, 8 of 16 units).
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6): every vector here is a world-XZ 2-vector or a
 * UV, both of which are chirality-free — `worldToHeightUV` maps world X to U and
 * world Z to V under either convention, and there is no cross product anywhere in
 * the file. The single world-space 3-vector, `vec3(worldXZ.x, h, worldXZ.y)`, is
 * the standard heightfield embedding y = H(x, z) and is identical in both
 * handednesses. What is NOT chirality-free is the triangle winding that consumes
 * these positions, and that is handled once on the CPU in `clipmapMesh.js`.
 */

export default /* glsl */`
#include "lib/terrain"
#include "lib/deform"

// ------------------------------------------------------------------ uniforms

uniform sampler2D heightTex;
uniform sampler2D auxTex;

uniform vec2  worldOrigin;
uniform float worldSize;
uniform float heightRes;

/// Where the clipmap rings are centred — the *character*, not the camera.
///
/// This is the whole reason carved snow holds still while you orbit. Ring 0 is
/// 6.8 m of half-extent and the spring arm sits 3-11 m behind the character, so
/// centring on the camera put the snow directly under the player right on the
/// ring 0 / ring 1 boundary: swinging the camera round re-sampled it between
/// 0.085 m and 0.17 m spacing and the trail visibly changed shape. Centring on
/// the character makes vertex placement a function of world position and player
/// position only, so no camera motion can alter the geometry.
///
/// The cost is that the ground under a fully zoomed-out camera is one ring
/// coarser than it would otherwise be. The camera never leaves ring 1, and it is
/// looking away from that ground anyway.
uniform vec2  lodCenter;
uniform float baseSpacing;
uniform float gridHalfN;

uniform float windAngle;
uniform float sastrugiAmp;

// ------------------------------------------------------------ height fetch

/// Bicubic B-spline height fetch, via the four-bilinear-tap trick.
///
/// Bilinear alone leaves diamond-shaped creases across every 0.5 m texel of a
/// smooth dune, which reads as visible faceting. B-spline is approximating rather
/// than interpolating, so it also gently low-passes the bake, which on a landform
/// is a bonus.
///
/// The four taps are real bilinear samples at non-texel-centre offsets, so this
/// depends on LinearFilter working on a FloatType texture — i.e. on
/// OES_texture_float_linear, which core/gfx.js probes and reports. Without it the
/// dunes become a stair-stepped mosaic (see the report note on the unimplemented
/// texelFetch fallback).
///
/// Only the .r channel is read; .g carries the rock mask, which the aux bake
/// forwards to the fragment stage instead.
float sampleHeightBicubic(vec2 uv, float res) {
    vec2 coord = uv * res - 0.5;
    vec2 base = floor(coord);
    vec2 f = coord - base;

    vec2 f2 = f * f;
    vec2 f3 = f2 * f;
    vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
    vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
    vec2 w3 = f3 / 6.0;

    vec2 s0 = w0 + w1;
    vec2 s1 = w2 + w3;
    vec2 o0 = (base + 0.5 - 1.0 + w1 / s0) / res;
    vec2 o1 = (base + 0.5 + 1.0 + w3 / s1) / res;

    // textureLod, not texture: this runs in a vertex stage, which has no implicit
    // derivatives to pick a mip from (and the height texture has no mips anyway).
    float t00 = textureLod(heightTex, vec2(o0.x, o0.y), 0.0).r;
    float t10 = textureLod(heightTex, vec2(o1.x, o0.y), 0.0).r;
    float t01 = textureLod(heightTex, vec2(o0.x, o1.y), 0.0).r;
    float t11 = textureLod(heightTex, vec2(o1.x, o1.y), 0.0).r;

    return mix(mix(t00, t10, s1.x), mix(t01, t11, s1.x), s1.y);
}

/// World XZ -> height-texture UV. origin (-1024,-1024), size 2048, so world
/// (0,0) lands at UV (0.5, 0.5). The texture is CLAMP on both axes.
vec2 worldToHeightUV(vec2 p, vec2 origin, float size) {
    return (p - origin) / size;
}

// -------------------------------------------------------------- placement

struct ClipmapVertex {
    vec2  worldXZ;
    float spacing;   // this vertex's effective sample spacing, post-morph
    float morph;
};

/// Place a clipmap vertex in world space.
///
/// 'grid' is the vertex's integer position within its ring, in [-80, +80].
/// 'level' is the ring index; spacing doubles each level (0.085 m to 10.88 m).
ClipmapVertex placeClipmapVertex(
    vec2 grid, float level, vec2 camXZ, float spacingBase, float halfN
) {
    float spacing = spacingBase * exp2(level);

    // Snap the ring origin to twice this level's spacing. Twice, not once, so
    // that the parity of the lattice is stable — snapping to 1x would let the
    // morph targets flip between frames and the surface would shimmer.
    float snap = spacing * 2.0;
    vec2 origin = floor(camXZ / snap) * snap;

    vec2 local = grid * spacing;

    // ---- morph toward the coarser lattice --------------------------------
    // Chebyshev distance, because the rings are square. Normalised so 1.0 is the
    // ring's outer edge.
    float extent = halfN * spacing;
    float cheb = max(abs(local.x), abs(local.y)) / extent;

    // Completes at 0.86, comfortably before the overlap band at 0.925 where this
    // ring and the next coarser one both draw.
    float morph = clamp((cheb - 0.70) / 0.16, 0.0, 1.0);

    // The coarse lattice is every second vertex of this one.
    vec2 coarseGrid = floor(grid * 0.5) * 2.0;
    vec2 coarseLocal = coarseGrid * spacing;
    local = mix(local, coarseLocal, morph);

    ClipmapVertex cv;
    cv.worldXZ = origin + local;
    cv.spacing = spacing * (1.0 + morph);
    cv.morph = morph;
    return cv;
}

// ------------------------------------------------------- the composite call

struct ClipmapSurface {
    vec3  world;      // full world position; .y is the drawn height in metres
    vec2  heightUV;
    float spacing;    // post-morph effective spacing, metres
    float morph;
    float exposure;   // aux .a — 1 on scoured crests, 0 in sheltered hollows
};

/// THE call every terrain vertex program makes. See the header: this exists so
/// the five programs cannot drift.
///
/// 'gridAttr' is the mesh's 'position' attribute, which is NOT a position:
///   .x gridI in [-80, 80]   .y ringLevel 0..7   .z gridJ in [-80, 80]
ClipmapSurface clipmapSurface(vec3 gridAttr) {
    ClipmapVertex cv = placeClipmapVertex(
        vec2(gridAttr.x, gridAttr.z), gridAttr.y,
        lodCenter, baseSpacing, gridHalfN
    );

    vec2 worldXZ = cv.worldXZ;
    vec2 hUV = worldToHeightUV(worldXZ, worldOrigin, worldSize);

    // --- macro height ------------------------------------------------------
    float h = sampleHeightBicubic(hUV, heightRes);

    float exposure = textureLod(auxTex, hUV, 0.0).a;

    // --- fine height -------------------------------------------------------
    // Displaced only where the ring is fine enough to resolve it. Past roughly
    // 40 cm spacing the sastrugi is smaller than a triangle, and displacing it
    // there would just alias — the fragment shader keeps carrying it in the
    // normal, which is where it still reads. In practice this means real
    // geometric sastrugi out to ~13 m (rings 0-2) fading through ring 3.
    if (cv.spacing < 0.42) {
        float fade = 1.0 - smoothstep(0.16, 0.42, cv.spacing);
        h += terrainFine(worldXZ, windAngle, exposure, sastrugiAmp).x * fade;
    }

    // --- deformation -------------------------------------------------------
    // Real displacement, not a normal-map trick: a trench the player can see the
    // far wall of, and berms that break the silhouette against the sky. The
    // fragment shader carries the sub-vertex detail on top.
    //
    // Reaches much further out than the fine layer above, and deliberately so. A
    // trail is the opposite shape of problem — half a metre wide but up to half a
    // metre deep — so it is worth displacing well past the point where the
    // lattice resolves its walls, provided it is band-limited on the way in.
    // lib/deform's deformDisplace() does that filtering from the same spacing,
    // and carries the 1.0 m gate and the 0.5 -> 1.0 m fade with it.
    h += deformDisplace(worldXZ, cv.spacing);

    ClipmapSurface s;
    // The heightfield embedding y = H(x, z): world X from the grid's X, world Z
    // from the grid's Z, height on +Y. Identical under either handedness.
    s.world = vec3(worldXZ.x, h, worldXZ.y);
    s.heightUV = hUV;
    s.spacing = cv.spacing;
    s.morph = cv.morph;
    s.exposure = exposure;
    return s;
}
`;
