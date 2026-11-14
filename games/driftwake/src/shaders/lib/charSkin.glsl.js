/**
 * `lib/charSkin` — the character's shared vertex-side transform library.
 *
 * Port of `snowflow_demo/src/shaders/lib/charSkin.wgsl`, verbatim in arithmetic.
 *
 * Everything the character needs to place a vertex comes out of one small
 * RGBA32F texture (`charTex`, 48x64, NEAREST, CLAMP), uploaded once per frame by
 * `character/character.js`:
 *
 *   rows 0-3   bone skinning matrices. **Column = bone index, row = matrix
 *              column**, so texel (b, c) is column c of bone b's
 *              `world * inverseBind`.
 *   rows 4+    simulated cloth node positions, one rectangle per garment panel,
 *              `.rgb` = absolute world position in metres.
 *
 * A texture rather than uniform arrays for the same reason the deformation
 * brushes are one: no uniform-array packing, no size ceiling, one upload either
 * way. RGBA32F and not RGBA16F — node positions are absolute world coordinates
 * over an ~870 m field and half float quantises to ~0.5 m out there
 * (_spec/character.md §9.1).
 *
 * SEVEN vertex programs include this file — body beauty / depth / prepass, cloth
 * beauty / depth / prepass, and the fur — so the surface in the shadow map, in
 * the prepass and in the beauty pass is the same surface by construction
 * (ARCHITECTURE.md §5). That is the entire reason it is a shared chunk.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE (ARCHITECTURE.md §3.1 — do not rename or re-sign)
 *
 *   mat4  boneMatrix(int i);
 *   vec3  skinPosition(vec3 p, ivec4 idx, vec4 wt);
 *
 * Plus the reference's own entry points, which the seven stages actually call:
 *
 *   vec3  skinPoint1(int b, vec3 p);          // one bone, point
 *   vec3  skinDir1(int b, vec3 d);            // one bone, direction
 *   vec3  skinPoint(vec4 idx, vec4 wt, vec3 p);   // two-influence LBS
 *   vec3  skinNormal(vec4 idx, vec4 wt, vec3 n);
 *   vec3  clothNode(int rowBase, int cols, int rows, int i, int j);
 *   vec4  crBasis(float t);   vec4 crDeriv(float t);
 *   ClothSample sampleCloth(int rowBase, int cols, int rows, float u, float v);
 *
 * `ClothSample` is `{ vec3 pos; vec3 nrm; vec3 tanU; }`.
 *
 * VERTEX STAGE ONLY in practice — nothing here reads gl_FragCoord, so it would
 * compile in a fragment stage, but the only consumers are vertex programs and
 * the `charTex` sampler uniform it declares is bound accordingly.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS DIFFERS FROM THE WGSL, AND WHY
 *
 *  - WGSL passes `tex: texture_2d<f32>` as a function parameter. GLSL ES 3.00
 *    allows sampler parameters but Three's uniform reflection is happier with a
 *    single file-scope `uniform sampler2D charTex;`, so the parameter is dropped
 *    and the uniform is declared here, once, for every stage that includes this.
 *  - `textureLoad(tex, vec2i(x,y), 0)` -> `texelFetch(charTex, ivec2(x,y), 0)`.
 *    Core GLSL ES 3.00, no extension, and legal on RGBA32F even though that
 *    format is not linearly filterable.
 *  - The 4x4 loop in `sampleCloth` is **fully unrolled** (_spec/cloth-fur.md
 *    §13.5): the bound is a compile-time 4, and unrolling makes `wu[i]` a
 *    constant index instead of a dynamic vector index some drivers handle badly.
 *  - The double-modulo `(i % cols + cols) % cols` ports character for character:
 *    GLSL ES 3.00 `%` on signed ints truncates toward zero exactly as WGSL does.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6)
 *
 * Nothing in this file takes a cross product except `sampleCloth`'s normal, and
 * that one is discussed at its call site below. Every matrix here is consumed as
 * four column vectors, never composed with another matrix, so column-major
 * layout is the only convention that has to hold — and it is identical in WGSL,
 * GLSL and the CPU-side `Float32Array` the uploader writes. The port's world is
 * the reference's world mirrored in z (see `core/camera.js`); that mirror is
 * applied once, on the CPU, in `character/build.js` and `character/figure.js`,
 * and is invisible here.
 */

export default /* glsl */`

/// Rows 0-3 bone matrices, rows 4+ cloth nodes. NEAREST, CLAMP, RGBA32F.
uniform sampler2D charTex;

// ------------------------------------------------------------------- skinning

/// Skin a point by one bone.
vec3 skinPoint1(int b, vec3 p) {
    vec4 c0 = texelFetch(charTex, ivec2(b, 0), 0);
    vec4 c1 = texelFetch(charTex, ivec2(b, 1), 0);
    vec4 c2 = texelFetch(charTex, ivec2(b, 2), 0);
    vec4 c3 = texelFetch(charTex, ivec2(b, 3), 0);
    return c0.xyz * p.x + c1.xyz * p.y + c2.xyz * p.z + c3.xyz;
}

/// Skin a direction by one bone (no translation column).
vec3 skinDir1(int b, vec3 d) {
    vec4 c0 = texelFetch(charTex, ivec2(b, 0), 0);
    vec4 c1 = texelFetch(charTex, ivec2(b, 1), 0);
    vec4 c2 = texelFetch(charTex, ivec2(b, 2), 0);
    return c0.xyz * d.x + c1.xyz * d.y + c2.xyz * d.z;
}

/// The whole matrix, for the ARCHITECTURE §3.1 signature. Nothing in the
/// character calls it — reading four columns and multiplying by hand is what the
/// reference does and it saves the mat4 construction — but the contract asks for
/// it and a consumer outside this subsystem may want it.
mat4 boneMatrix(int i) {
    return mat4(
        texelFetch(charTex, ivec2(i, 0), 0),
        texelFetch(charTex, ivec2(i, 1), 0),
        texelFetch(charTex, ivec2(i, 2), 0),
        texelFetch(charTex, ivec2(i, 3), 0)
    );
}

/// Two-influence linear blend skinning. Two is enough for a figure whose only
/// hard joints are elbows and knees; the garments that would need more are
/// simulated instead. Renormalised by the weight sum, so a ring whose weights
/// were authored as (1-w, w) survives a builder typo without shrinking.
vec3 skinPoint(vec4 idx, vec4 wt, vec3 p) {
    vec3 r = skinPoint1(int(idx.x), p) * wt.x;
    if (wt.y > 0.0001) { r += skinPoint1(int(idx.y), p) * wt.y; }
    return r / max(1e-4, wt.x + wt.y);
}

vec3 skinNormal(vec4 idx, vec4 wt, vec3 n) {
    vec3 r = skinDir1(int(idx.x), n) * wt.x;
    if (wt.y > 0.0001) { r += skinDir1(int(idx.y), n) * wt.y; }
    return normalize(r);
}

/// ARCHITECTURE §3.1 spelling. The character's own attributes are float vec4s
/// (see _spec/character.md §9.3 — integer attributes would drag in flat
/// qualifiers nobody wants), so this is the integer-index form for consumers
/// that have one.
vec3 skinPosition(vec3 p, ivec4 idx, vec4 wt) {
    return skinPoint(vec4(idx), wt, p);
}

// -------------------------------------------------------------- cloth sampling

/// One simulated node. 'i' (around the tube) WRAPS — every garment is a closed
/// tube — and 'j' (down it) CLAMPS, because the top and bottom edges are real
/// boundaries and the clamp is what degenerates the Catmull-Rom to a natural end
/// condition there. The asymmetry is deliberate; both halves matter.
vec3 clothNode(int rowBase, int cols, int rows, int i, int j) {
    int ii = (i % cols + cols) % cols;
    int jj = clamp(j, 0, rows - 1);
    return texelFetch(charTex, ivec2(ii, rowBase + jj), 0).xyz;
}

/// Uniform Catmull-Rom, tension 0.5. crBasis(0) = (0,1,0,0) and
/// crBasis(1) = (0,0,1,0), so the curve interpolates its control points exactly.
vec4 crBasis(float t) {
    float t2 = t * t;
    float t3 = t2 * t;
    return vec4(
        0.5 * (-t3 + 2.0 * t2 - t),
        0.5 * (3.0 * t3 - 5.0 * t2 + 2.0),
        0.5 * (-3.0 * t3 + 4.0 * t2 + t),
        0.5 * (t3 - t2)
    );
}

/// Its analytic derivative. Each row sums to 0; crDeriv(0) = (-0.5, 0, 0.5, 0),
/// i.e. the tangent at P0 is (P1 - P-1)/2.
vec4 crDeriv(float t) {
    float t2 = t * t;
    return vec4(
        0.5 * (-3.0 * t2 + 4.0 * t - 1.0),
        0.5 * (9.0 * t2 - 10.0 * t),
        0.5 * (-9.0 * t2 + 8.0 * t + 1.0),
        0.5 * (3.0 * t2 - 2.0 * t)
    );
}

struct ClothSample {
    vec3 pos;
    vec3 nrm;
    vec3 tanU;
};

/// Reconstruct a smooth garment surface from its simulated grid.
///
/// This is the whole reason the solver can afford to be 36x12: the interpolant
/// is C1, so a coarse grid renders without a single visible facet, and BOTH
/// tangents fall out of the same sixteen taps as the position — no finite
/// differences, no second sampling pass, and a normal exactly consistent with
/// the surface being drawn.
///
/// Parameter mapping is asymmetric on purpose (_spec/cloth-fur.md §7.4):
///   gu = u * cols        NOT cols-1. u wraps, so u = 1 must land on node 0 again.
///   gv = v * (rows - 1)  v clamps, so v = 1 must land exactly on the last row.
ClothSample sampleCloth(int rowBase, int cols, int rows, float u, float v) {
    float gu = u * float(cols);
    float gv = v * float(rows - 1);
    float fu = floor(gu);
    float fv = floor(gv);
    int i0 = int(fu) - 1;
    int j0 = int(fv) - 1;

    vec4 wu = crBasis(gu - fu);
    vec4 du = crDeriv(gu - fu);
    vec4 wv = crBasis(gv - fv);
    vec4 dv = crDeriv(gv - fv);

    vec3 p  = vec3(0.0);
    vec3 pu = vec3(0.0);
    vec3 pv = vec3(0.0);

    // Unrolled 4x4. Sixteen texelFetch calls, constant-indexed weights.
    vec3 q0, q1, q2, q3, rowP, rowD;

    q0 = clothNode(rowBase, cols, rows, i0 + 0, j0 + 0);
    q1 = clothNode(rowBase, cols, rows, i0 + 1, j0 + 0);
    q2 = clothNode(rowBase, cols, rows, i0 + 2, j0 + 0);
    q3 = clothNode(rowBase, cols, rows, i0 + 3, j0 + 0);
    rowP = q0 * wu.x + q1 * wu.y + q2 * wu.z + q3 * wu.w;
    rowD = q0 * du.x + q1 * du.y + q2 * du.z + q3 * du.w;
    p += rowP * wv.x;  pu += rowD * wv.x;  pv += rowP * dv.x;

    q0 = clothNode(rowBase, cols, rows, i0 + 0, j0 + 1);
    q1 = clothNode(rowBase, cols, rows, i0 + 1, j0 + 1);
    q2 = clothNode(rowBase, cols, rows, i0 + 2, j0 + 1);
    q3 = clothNode(rowBase, cols, rows, i0 + 3, j0 + 1);
    rowP = q0 * wu.x + q1 * wu.y + q2 * wu.z + q3 * wu.w;
    rowD = q0 * du.x + q1 * du.y + q2 * du.z + q3 * du.w;
    p += rowP * wv.y;  pu += rowD * wv.y;  pv += rowP * dv.y;

    q0 = clothNode(rowBase, cols, rows, i0 + 0, j0 + 2);
    q1 = clothNode(rowBase, cols, rows, i0 + 1, j0 + 2);
    q2 = clothNode(rowBase, cols, rows, i0 + 2, j0 + 2);
    q3 = clothNode(rowBase, cols, rows, i0 + 3, j0 + 2);
    rowP = q0 * wu.x + q1 * wu.y + q2 * wu.z + q3 * wu.w;
    rowD = q0 * du.x + q1 * du.y + q2 * du.z + q3 * du.w;
    p += rowP * wv.z;  pu += rowD * wv.z;  pv += rowP * dv.z;

    q0 = clothNode(rowBase, cols, rows, i0 + 0, j0 + 3);
    q1 = clothNode(rowBase, cols, rows, i0 + 1, j0 + 3);
    q2 = clothNode(rowBase, cols, rows, i0 + 2, j0 + 3);
    q3 = clothNode(rowBase, cols, rows, i0 + 3, j0 + 3);
    rowP = q0 * wu.x + q1 * wu.y + q2 * wu.z + q3 * wu.w;
    rowD = q0 * du.x + q1 * du.y + q2 * du.z + q3 * du.w;
    p += rowP * wv.w;  pu += rowD * wv.w;  pv += rowP * dv.w;

    ClothSample o;
    o.pos = p;
    // cross(pv, pu), operands reversed relative to the usual cross(du, dv).
    //
    // HANDEDNESS. In the reference (Babylon, +z forward) u runs anticlockwise
    // around the tube and v runs down it, and cross(pv, pu) is then the OUTWARD
    // normal. This port mirrors the world in z, which flips the sign of every
    // cross product — so the panel generators in character/cloth.js emit their
    // columns in REVERSED order (column i holds mirrored reference column
    // cols-i). That flips the sign of pu as well, and the two sign flips cancel:
    // cross(M*pv, -M*pu) = M*cross(pv, pu) = the mirrored outward normal. Both
    // halves of that trade live in one place each and neither may move alone.
    //
    // The missing chain-rule factors (the true partials are pu*cols and
    // pv*(rows-1)) are omitted exactly as the reference omits them: both scale
    // factors are positive, so the direction is unchanged and normalize()
    // removes the magnitude. Scaling only ONE of them would give a wrong normal.
    o.nrm = normalize(cross(pv, pu));
    o.tanU = normalize(pu);
    return o;
}
`;
