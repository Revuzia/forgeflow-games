/**
 * `lib/deform` — the read side of the terrain state buffer.
 *
 * Five programs sample this chunk: the beauty vertex stage (displacement), the
 * three shadow-cascade depth vertex stages (so carved snow casts its own
 * shadow), the depth-prepass vertex stage (displacement + the ice mask), and the
 * snow fragment stage (normals and surface state). They must agree *exactly* —
 * if the depth pass placed a vertex a centimetre off the beauty pass, the trail
 * would acne against its own floor. Hence one chunk rather than five copies.
 *
 * Addressing is toroidal. The buffer is never scrolled or copied; the window
 * simply re-interprets which world position each texel stands for, so the UV is
 * just the world position wrapped into one window: `fract(worldXZ / size)`. The
 * sampler on `deformTex` **must** be in REPEAT mode on both axes or this whole
 * scheme silently becomes clamp-to-edge and marks smear off the window edge.
 *
 * ---------------------------------------------------------------------------
 * CANONICAL SIGNATURES — ARCHITECTURE.md §3.1, kept true:
 *
 *     vec4  deformSample(vec2 worldXZ);   // .x depression m · .y displaced mass m
 *                                         // .z compression 0..1 · .w ice 0..1
 *     float deformHeight(vec2 worldXZ);   // net vertical offset, metres (berm minus trench)
 *     vec2  deformGradient(vec2 worldXZ); // d(deformHeight)/d(worldXZ), for normals
 *
 * The three above are the contract and take world XZ only, so the buffer's own
 * parameters live in this chunk as uniforms rather than in every call site. The
 * consumer supplies these five, and `DeformationField.uniforms` hands out the
 * exact `{value}` objects to splat into a material so there is one source of
 * truth and no per-frame rebinding (names transcribed from the reference's
 * `Terrain.update()`):
 *
 *     uniform sampler2D deformTex;        // RGBA16F state, REPEAT + LINEAR
 *     uniform vec2      deformCenter;     // window centre, world (x = X, y = Z)
 *     uniform float     deformSize;       // window coverage, metres (80)
 *     uniform float     deformTexel;      // deformSize / res, metres
 *     uniform float     deformDepthScale; // S.deformDepth
 *
 * ADDITIONS (permitted by §3.1 — nothing above is renamed or re-signed):
 *
 *     float deformDisplace(vec2 worldXZ, float spacing);
 *         THE ONE CALL THE FIVE VERTEX PROGRAMS MAKE. Carries the `spacing < 1.0`
 *         gate, the `smoothstep(0.5, 1.0, spacing)` fade and the band-limiting
 *         filter width in a single function, so the five programs are identical
 *         by construction instead of by five people mirroring three lines
 *         correctly. The spec's warning is blunt about the cost of getting this
 *         wrong: "the terrain would shadow against a surface that is not the one
 *         being drawn, and every berm would acne."  USE THIS, not deformHeight,
 *         in the beauty / cascade / prepass vertex stages:
 *
 *             h += deformDisplace(worldXZ, cv.spacing);
 *
 *     float applyDeform(vec2 worldXZ, float spacing);   // alias of deformDisplace
 *     vec4  sampleDeform(vec2 worldXZ);                 // alias of deformSample
 *         The §3 table names the chunk's contents `sampleDeform()` / `applyDeform()`
 *         while §3.1 signs them `deformSample` / (gated) displacement. Both spellings
 *         resolve, so a consumer written against either half of the contract compiles.
 *
 *     float deformHeightAt(vec2 worldXZ, float spacing);
 *         `deformHeight` with an explicit band-limit width. `deformHeight(p)` is
 *         this at one buffer texel, which is the finest limit the buffer carries.
 *
 *     vec4  deformSampleRaw(vec2 worldXZ);      // state before the window falloff
 *     float deformFalloff(vec2 worldXZ);        // the window's authority here, 0..1
 *     float deformIceMask(vec2 worldXZ);        // prepass SSR gate — raw A × falloff
 *     vec2  deformGradientAt(vec2 worldXZ, float footprintMin);
 *     vec4  deformSurface(vec2 worldXZ, float footprintMin, out vec2 grad);
 *         The whole fragment-side block from the reference's snow.fragment: the
 *         widening central difference, the 5-tap state blend, and the falloff
 *         weighting, in one call. `footprintMin` is
 *         `max(min(|dFdx(world).xz|, |dFdy(world).xz|), 1e-4)` — the SHORT axis of
 *         the anisotropic pixel footprint, which is why a carved trail does not
 *         change shape when the camera tilts toward the horizon.
 * ---------------------------------------------------------------------------
 *
 * Handedness (ARCHITECTURE §6): nothing in this chunk takes a cross product or
 * builds a basis. Every vector here is a plain world-XZ 2-vector or a UV, and
 * both are handedness-free — `deformUV` maps world X to U and world Z to V under
 * either convention. The one place a consumer can get this wrong is the gradient:
 * `deformGradient` returns d(height)/d(worldXZ), so the surface normal is
 * `normalize(vec3(-g.x, 1.0, -g.y))` in Three's right-handed Y-up world.
 */

export default /* glsl */`

// ------------------------------------------------------------------ uniforms
// Supplied by the consumer material; DeformationField.uniforms hands out the
// matching {value} objects so all five programs share one set.

uniform sampler2D deformTex;
uniform vec2      deformCenter;
uniform float     deformSize;
uniform float     deformTexel;
uniform float     deformDepthScale;

// ----------------------------------------------------------------- addressing

/// World XZ -> deformation-buffer UV. The sampler must be in wrap mode.
///
/// This is the entire addressing scheme: no offset by the centre, no scroll, no
/// copy. The seam (where worldXZ/size crosses an integer) therefore sits wherever
/// the world happens to put it, at most 40 m from the player — and deformFalloff
/// has already faded the buffer's authority to zero by 38.4 m, so the wrapped
/// content is never visible at any weight.
vec2 deformUV(vec2 worldXZ) {
    return fract(worldXZ / deformSize);
}

/// How much of the buffer's authority applies here, 0..1.
///
/// Faded rather than cut: the window edge is a straight line ~32 m from the
/// player, and a hard cutoff there would drag a visible seam across the field
/// every time the player moved. Chebyshev (square) distance, normalised so 1.0
/// is the window edge: full authority to 0.80 (32 m), zero past 0.96 (38.4 m).
float deformFalloff(vec2 worldXZ) {
    vec2 d = abs(worldXZ - deformCenter) / (deformSize * 0.5);
    return 1.0 - smoothstep(0.80, 0.96, max(d.x, d.y));
}

// --------------------------------------------------------------- state fetch

/// Raw buffer state, before the window falloff.
/// .x depression m (positive = down) · .y displaced mass m (positive = up)
/// .z compression 0..1 · .w ice 0..1
vec4 deformSampleRaw(vec2 worldXZ) {
    // textureLod, not texture: this chunk is compiled into vertex stages, which
    // have no implicit derivatives to pick a mip from (and the buffer has no
    // mips anyway).
    return textureLod(deformTex, deformUV(worldXZ), 0.0);
}

/// Buffer state weighted by the window falloff — what every consumer wants.
/// ARCHITECTURE §3.1.
vec4 deformSample(vec2 worldXZ) {
    float w = deformFalloff(worldXZ);
    if (w <= 0.001) return vec4(0.0);
    vec4 s = deformSampleRaw(worldXZ);
    return vec4(s.r, s.g, clamp(s.b, 0.0, 1.0), clamp(s.a, 0.0, 1.0)) * w;
}
vec4 sampleDeform(vec2 worldXZ) { return deformSample(worldXZ); }

/// The ice channel read straight, not through deformHeight's binomial: this
/// feeds the SSR reflection gate, not a displacement, so smoothing it to the
/// vertex lattice would only soften the edge of a glaze the fragment stage draws
/// hard.
float deformIceMask(vec2 worldXZ) {
    float w = deformFalloff(worldXZ);
    if (w <= 0.001) return 0.0;
    return clamp(deformSampleRaw(worldXZ).a, 0.0, 1.0) * w;
}

// -------------------------------------------------------------- displacement

/// Net height offset in metres — piled mass minus depression — band-limited to
/// what a lattice of \`spacing\` metres can actually carry.
///
/// The filter is not optional polish. The clipmap rings are centred on the
/// CAMERA, so orbiting or zooming slides a ring boundary across a stationary
/// trail: the same patch of snow gets re-sampled from 0.085 m spacing to 0.34 m,
/// and a 0.6 m groove with a narrower berm crest ends up with less than one
/// vertex across its ridge. Each triangle then spans the whole berm and the ridge
/// collapses into facets that swim with the camera. Fading the displacement out
/// with distance hides that but also deletes the trail; filtering fixes it.
///
/// A separable 3x3 binomial with taps one \`spacing\` apart puts the first zero
/// exactly at the lattice Nyquist (wavelength 2 x spacing), so content the
/// vertices cannot represent is removed rather than aliased, while a broad trench
/// at 8 x spacing still passes at 85.4%. Because \`spacing\` is continuous through
/// the CDLOD morph, so is the filter — two rings meeting at a shared vertex
/// compute the same width and the same height, and the mesh stays crack-free.
///
/// Cost is close to free in practice: the clipmap is 870 m across and the window
/// is 80 m, so the falloff early-out rejects the overwhelming majority of
/// vertices before a single fetch.
float deformHeightAt(vec2 worldXZ, float spacing) {
    float w = deformFalloff(worldXZ);
    if (w <= 0.0) return 0.0;

    vec2 base = deformUV(worldXZ);
    float r = spacing / deformSize; // tap offset, in UV

    float acc = 0.0;
    for (int j = -1; j <= 1; ++j) {
        for (int i = -1; i <= 1; ++i) {
            // Binomial [1,2,1] x [1,2,1] / 16 — centre 4/16, edge 2/16, corner 1/16.
            float wt = float((2 - abs(i)) * (2 - abs(j))) * (1.0 / 16.0);
            vec4 s = textureLod(deformTex, base + vec2(float(i), float(j)) * r, 0.0);
            // Displaced mass minus depression: the signed net offset, in metres.
            acc += (s.g - s.r) * wt;
        }
    }
    return acc * deformDepthScale * w;
}

/// ARCHITECTURE §3.1. Band-limited to one buffer texel, i.e. the finest detail
/// the state buffer itself carries. Vertex stages want deformDisplace() instead,
/// which limits to the vertex spacing and carries the LOD gate with it.
float deformHeight(vec2 worldXZ) {
    return deformHeightAt(worldXZ, deformTexel);
}

/// The displacement call for the beauty vertex stage, all three shadow cascades
/// and the depth prepass. One function so the gate cannot drift between them.
///
/// Gate at 1.0 m of vertex spacing with a 0.5 -> 1.0 m fade: rings 0-2 of the
/// clipmap always displace, ring 3 fades out through the gate, rings 4-7 never
/// do. In practice deformFalloff (38.4 m) closes before the spacing gate does,
/// because ring 3's inner boundary sits at ~27 m.
///
/// A trail is displaced well past the point where the lattice resolves its walls
/// — half a metre wide but up to half a metre deep — which is only safe because
/// deformHeightAt band-limits it on the way in. (Contrast the sastrugi layer,
/// gated at 0.42 m: a 2 m wavelength at +/-12 cm is smaller than a triangle past
/// that and there is nothing to be done but drop it.)
float deformDisplace(vec2 worldXZ, float spacing) {
    if (spacing >= 1.0) return 0.0;
    float dfade = 1.0 - smoothstep(0.5, 1.0, spacing);
    return deformHeightAt(worldXZ, spacing) * dfade;
}
float applyDeform(vec2 worldXZ, float spacing) { return deformDisplace(worldXZ, spacing); }

// ------------------------------------------------------------------ gradient

/// d(deformHeight)/d(worldXZ), by central difference over a widening baseline.
///
/// \`footprintMin\` is the short axis of the pixel's world footprint; pass 0.0 from
/// a stage that has no derivatives and the baseline falls back to its two-texel
/// floor. Two texels differenced at 30 m is a normal sampled far below the pixel's
/// own footprint, so it aliases; fading it out fixes the aliasing but stops the
/// trail existing about fifteen metres out, and a run should be visible from
/// across the field. Widening the baseline is the low-pass filter the fade was
/// standing in for: the difference stays bounded while the divisor grows, so the
/// gradient rolls off smoothly with distance and the trail survives as a tonal
/// line long after it has stopped being a shape.
vec2 deformGradientAt(vec2 worldXZ, float footprintMin) {
    float w = deformFalloff(worldXZ);
    if (w <= 0.001) return vec2(0.0);

    vec2 dUV = deformUV(worldXZ);
    float step = max(deformTexel * 2.0, footprintMin * 1.4);
    float eUV = step / deformSize;

    vec4 dxA = textureLod(deformTex, dUV + vec2(eUV, 0.0), 0.0);
    vec4 dxB = textureLod(deformTex, dUV - vec2(eUV, 0.0), 0.0);
    vec4 dzA = textureLod(deformTex, dUV + vec2(0.0, eUV), 0.0);
    vec4 dzB = textureLod(deformTex, dUV - vec2(0.0, eUV), 0.0);

    float sx = (dxA.g - dxA.r) - (dxB.g - dxB.r);
    float sz = (dzA.g - dzA.r) - (dzB.g - dzB.r);

    return vec2(sx, sz) / (2.0 * step) * deformDepthScale * w;
}

/// ARCHITECTURE §3.1. Two-texel baseline; add the pixel footprint with
/// deformGradientAt() wherever derivatives are available.
vec2 deformGradient(vec2 worldXZ) {
    return deformGradientAt(worldXZ, 0.0);
}

/// The complete fragment-side read: falloff-weighted state AND the gradient, in
/// one call, sharing the four neighbour fetches between them.
///
/// Once the pixel is wider than four texels the state channels blend toward a
/// 5-tap box average, which stops a distant trail breaking into a dotted line —
/// and it is free, because the four neighbours were fetched for the gradient
/// anyway.
///
/// Deliberately does NOT apply deformHeightAt's binomial nor the spacing gate:
/// this path carries the sub-vertex detail the displaced geometry cannot.
///
/// @param footprintMin short axis of the pixel's world footprint, metres
/// @param grad  out: d(height)/d(worldXZ), to be added into the surface gradient
/// @returns (depression m, berm m, compression 0..1, ice 0..1), falloff-weighted
vec4 deformSurface(vec2 worldXZ, float footprintMin, out vec2 grad) {
    grad = vec2(0.0);

    float w = deformFalloff(worldXZ);
    if (w <= 0.001) return vec4(0.0);

    vec2 dUV = deformUV(worldXZ);
    vec4 c = textureLod(deformTex, dUV, 0.0);

    // Never narrower than two texels, and otherwise 1.4x the narrow axis of the
    // pixel's footprint — keyed to the narrow axis so the width tracks how far
    // away the snow is and not how obliquely it is being looked at.
    float step = max(deformTexel * 2.0, footprintMin * 1.4);
    float eUV = step / deformSize;

    vec4 dxA = textureLod(deformTex, dUV + vec2(eUV, 0.0), 0.0);
    vec4 dxB = textureLod(deformTex, dUV - vec2(eUV, 0.0), 0.0);
    vec4 dzA = textureLod(deformTex, dUV + vec2(0.0, eUV), 0.0);
    vec4 dzB = textureLod(deformTex, dUV - vec2(0.0, eUV), 0.0);

    float sx = (dxA.g - dxA.r) - (dxB.g - dxB.r);
    float sz = (dzA.g - dzA.r) - (dzB.g - dzB.r);

    float wide = clamp(footprintMin / (deformTexel * 4.0), 0.0, 1.0) * 0.8;
    vec4 df = mix(c, (c + dxA + dxB + dzA + dzB) * 0.2, wide);

    grad = vec2(sx, sz) / (2.0 * step) * deformDepthScale * w;

    return vec4(df.r * w, df.g * w,
                clamp(df.b, 0.0, 1.0) * w,
                clamp(df.a, 0.0, 1.0) * w);
}
`;
