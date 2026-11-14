/**
 * `lib/meshSkin` — vertex-side skinning for the GLB mesh character.
 *
 * The imported rider (assets/char/driftwake_char_web.glb) is a stock Three
 * SkinnedMesh: 41 Mixamo bones, four influences per vertex, bone matrices in
 * the renderer-managed `boneTexture` (a square RGBA32F texture, four texels
 * per bone, laid out exactly as Three's own `getBoneMatrix` reads it). This is
 * a SEPARATE rig from the procedural figure's 48x64 `charTex` — different
 * texture, different layout, different bone count — which is why this is its
 * own chunk rather than an extension of `lib/charSkin`.
 *
 * FOUR programs include this file — mesh beauty, both shadow cascades and the
 * depth prepass — so the surface in the shadow map, in the prepass and in the
 * beauty pass is the same skinned surface by construction (ARCHITECTURE.md §5).
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO MODEL MATRIX HERE
 *
 * The SkinnedMesh is left in Three's default `attached` bind mode, where
 * `bindMatrixInverse` tracks the mesh node's own inverse world matrix — so the
 * stock chain `model * bindMatrixInverse * (Σ w·bone) * bindMatrix` collapses
 * to `(Σ w·bone) * bindMatrix`: the bone matrices are world-space (they live
 * under the root group `meshChar.js` moves every frame) and carry ALL of the
 * root motion, scale included. Dropping the two cancelling matrices is not an
 * optimisation, it is what makes the shadow/prepass PROXIES correct: they are
 * plain `THREE.Mesh`es (`registerCaster` builds them), the renderer only
 * auto-binds skinning uniforms on `isSkinnedMesh` objects, and a proxy's own
 * `matrixWorld` is the identity. Everything this chunk needs arrives through
 * `material.uniforms`, identically on all four programs.
 *
 * On the beauty mesh — a real SkinnedMesh — the renderer ALSO auto-binds
 * `boneTexture` and `bindMatrix` from the object. Same texture, same matrix,
 * by reference; the double write is harmless and keeping the stock uniform
 * names is what lets it happen at all.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE
 *
 *   mat4  meshBoneMatrix(float i);                       // Three's boneTexture layout
 *   vec3  meshSkinPoint(vec3 p, vec4 idx, vec4 wt);      // -> world position, metres
 *   vec3  meshSkinNormal(vec3 n, vec4 idx, vec4 wt);     // -> world normal, unit
 *
 * VERTEX STAGE ONLY in practice, exactly like `lib/charSkin`.
 *
 * HANDEDNESS (ARCHITECTURE.md §6): matrices are consumed as opaque column
 * transforms and never composed against a bearing; the asset itself was
 * authored front = +Z in Three's right-handed Y-up world, and the one place
 * that maps `character.facing` onto it is `meshChar.js` (`_syncRoot`).
 */

export default /* glsl */`

/// Square RGBA32F, four texels per bone: Three's Skeleton.computeBoneTexture
/// layout, fetched exactly as Three's own getBoneMatrix does.
uniform highp sampler2D boneTexture;
/// The mesh's world matrix at bind time — geometry -> bind-pose world.
uniform mat4 bindMatrix;

mat4 meshBoneMatrix(float i) {
    int size = textureSize(boneTexture, 0).x;
    int j = int(i) * 4;
    int x = j % size;
    int y = j / size;
    return mat4(
        texelFetch(boneTexture, ivec2(x,     y), 0),
        texelFetch(boneTexture, ivec2(x + 1, y), 0),
        texelFetch(boneTexture, ivec2(x + 2, y), 0),
        texelFetch(boneTexture, ivec2(x + 3, y), 0)
    );
}

/// Four-influence linear blend skinning, straight to world space (see header).
/// Renormalised by the weight sum so a quantised WEIGHTS_0 accessor that sums
/// to 0.998 does not shrink the figure.
vec3 meshSkinPoint(vec3 p, vec4 idx, vec4 wt) {
    vec4 bindP = bindMatrix * vec4(p, 1.0);
    vec4 acc = (meshBoneMatrix(idx.x) * bindP) * wt.x
             + (meshBoneMatrix(idx.y) * bindP) * wt.y
             + (meshBoneMatrix(idx.z) * bindP) * wt.z
             + (meshBoneMatrix(idx.w) * bindP) * wt.w;
    return acc.xyz / max(1e-4, wt.x + wt.y + wt.z + wt.w);
}

/// Direction form: no translation, normalised at the end. The rig's scale is
/// uniform (one scalar on the root), so the plain linear part is proportional
/// to the inverse-transpose and normalize() absorbs the difference.
vec3 meshSkinNormal(vec3 n, vec4 idx, vec4 wt) {
    vec4 bindN = bindMatrix * vec4(n, 0.0);
    vec4 acc = (meshBoneMatrix(idx.x) * bindN) * wt.x
             + (meshBoneMatrix(idx.y) * bindN) * wt.y
             + (meshBoneMatrix(idx.z) * bindN) * wt.z
             + (meshBoneMatrix(idx.w) * bindN) * wt.w;
    return normalize(acc.xyz);
}
`;
