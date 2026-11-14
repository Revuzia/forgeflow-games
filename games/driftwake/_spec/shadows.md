# SNOWFLOW — Implementation Spec: CSM Cascades with World-Space PCSS + Depth Prepass

**Target port:** Three.js r172 / WebGL2 / hand-written GLSL 3.00 es (`RawShaderMaterial` + `glslVersion: THREE.GLSL3`).
**Reference:** WebGPU + Babylon.js + WGSL.
**Scope of this document:** everything in `src/render/shadows.js`, `src/render/depthPass.js`,
`src/shaders/lib/shadowLookup.wgsl`, the PCSS core in `src/shaders/lib/shading.wgsl`, all six
`*Depth.vertex.wgsl` / `terrainDepth.fragment.wgsl` casters, and all six `*Prepass.*.wgsl` casters.

Everything here is transcribed from the reference source. No number in this document is invented.

---

## 0. One-paragraph summary

Three hand-rolled orthographic shadow cascades write **NDC depth as plain R32F colour** (not a
hardware depth/comparison texture) into three 2048² render targets. Each cascade is fitted to a
slice of the camera frustum using a **rotation-invariant bounding sphere**, its radius is
**relatively quantised**, its centre is **snapped to its own world-space texel lattice before the
light view matrix is built**, and its near/far planes are **solved** (not budgeted) from the
world's height extent and the sun's elevation. The receiver runs **world-space PCSS**: an 8-tap
rotated-Poisson blocker search inside a radius capped at 1.8 m, a similar-triangles penumbra
estimate using the sun's 0.53° angular diameter, then a 12-tap rotated-Poisson PCF at the estimated
width, with a receiver-plane depth gradient and a texel-sized normal offset absorbing all bias.
Separately, a full-resolution **RGBA16F camera-space depth prepass** writes linear view depth
(`clip.w`, carried as a varying) in `.r` and a specular mask in `.g`. Both the cascade pass and the
prepass use the **per-caster custom-vertex-program registration pattern**: because the terrain (and
the character, the wake and the crystals) have **no CPU geometry matching what is drawn**, every
caster must re-declare and re-run the exact vertex program its beauty pass uses, differing only in
the projection matrix and the fragment stage.

---

## 1. Why the pass is owned rather than delegated

Verbatim reasoning from `src/render/shadows.js` header (this is the constraint that drives the whole
port, so it is reproduced):

> Babylon's CascadedShadowGenerator is perfectly good, and is not used here for a specific reason:
> the terrain has no CPU-side geometry. Its vertices are grid indices, and where they actually land
> is decided by the clipmap vertex shader from the camera position. Any generic depth pass would
> render the undisplaced lattice — a flat sheet at y=0 — and the terrain would shadow against a
> surface that does not exist. The depth pass has to run the same displacement code, which means
> owning the pass.
>
> Owning it also buys the filtering: depth goes into plain R32F colour targets, so PCSS can run a
> real blocker search. A hardware comparison sampler only ever returns a pre-thresholded result,
> which a blocker search cannot use.
>
> Three cascades, not four. The fourth would cover 320 m and beyond, where the aerial perspective has
> already compressed contrast to the point that no shadow in it is legible.

The same argument holds verbatim for `depthPass.js`: the terrain's vertices are grid indices, the
character is skinned from a transform texture, the wake is a lattice evaluated from a spine, and the
crystals are generated from a growth curve. **Three.js `MeshDepthMaterial` / `customDepthMaterial`
would render five undisplaced lattices.** See §11.6 for the porting pattern.

---

## 2. Pass graph and per-frame ordering

Render targets are registered in this order and Babylon renders `scene.customRenderTargets` in
registration order, so the ordering *is* the scheduling:

```
per frame (main.js run loop):
  1. character.update(dt)                    CPU: controller integrate
  2. figure.update(dt) / contact.update(dt)  CPU: skeleton + cloth + footprint stamping
  3. rig.update(dt, ...)                     CPU: camera spring arm
  4. post.update(dt, ...)                    CPU: writes TAA jitter INTO camera.projectionMatrix
                                                  and freezes it for the frame
  5. sky.update() / sky.render(rig, time)
  6. shadows.update(rig.camera, sky.sunDir)  CPU: refit all 3 cascades, upload matrices to
                                                  every registered depth material + every receiver
  7. spells.update(dt, cameraPos)            (after the refit — carries THIS frame's matrices)
  8. terrain.update(cameraPos, focus, dt)    deform sim ping-pong, then bind, then uniforms
  9. figure.sync(cameraPos)                  (after the refit, same reason)
 10. wake.update(dt) / spray.update(dt)
 11. scene.render():
       PASS A  cascade 0    (2048², R32F, cleared to 1.0)
       PASS B  cascade 1    (2048², R32F, cleared to 1.0)
       PASS C  cascade 2    (2048², R32F, cleared to 1.0)
       PASS D  scenePrepass (full-res, RGBA16F, cleared to (9000, 0, 0, 1))
       PASS E  beauty       group 0 = sky, group 1 = opaque, group 2 = alpha
                            (depth NOT auto-cleared between groups 1 and 2)
 12. post.endFrame()                          post chain reads PASS D and the beauty target
```

**Critical ordering invariant:** the TAA jitter is written into the projection matrix at step 4 and
frozen. Both PASS D and PASS E read the same `scene.getTransformMatrix()`, so the prepass and the
beauty pass agree to the subpixel. The cascades do **not** use the jittered matrix — they use
`lightViewProjection`, which is unjittered.

**Second ordering invariant:** the deformation field is ping-ponged inside `terrain.update()` *before*
uniforms are bound, and `setDeformTexture()` re-points **all four** terrain materials at the new
target: the beauty material, the prepass material and all three cascade depth materials. If any one
of them reads the previous frame's target, that pass places vertices on last frame's snow.

---

## 3. Cascade render targets

Per cascade `i` in `[0, 1, 2]`:

| Property | Value | Note |
|---|---|---|
| Name | `"cascade" + i` | |
| Size | `2048 × 2048` | `RESOLUTION = 2048` |
| Colour format | `TEXTUREFORMAT_RED` + `TEXTURETYPE_FLOAT` → **R32F** | plain colour, **not** a depth texture |
| Mipmaps | none (`generateMipMaps: false`) | |
| Depth buffer | **yes** (`generateDepthBuffer: true`) | needed for correct occlusion between casters |
| Sampling | `TEXTURE_BILINEAR_SAMPLINGMODE` | PCSS taps are `textureSampleLevel(..., 0.0)` |
| Wrap U / V | `TEXTURE_CLAMP_ADDRESSMODE` | UV is also `clamp()`-ed in the shader |
| Clear colour | `(1, 1, 1, 1)` | **the far plane.** Anything unwritten occludes nothing. |
| Refresh | `REFRESHRATE_RENDER_ONEVERYFRAME` | |
| `skipInitialClear` | `false` | |

`texelSize = 1 / RESOLUTION = 1 / 2048 = 0.00048828125` (uniform `shadowTexel`, units: UV).

VRAM: 3 × 2048² × 4 bytes = 48 MB for colour, plus depth.

---

## 4. Cascade fitting — `ShadowSystem.update()` / `_fitCascade()`

### 4.1 Constants

```js
export const CASCADE_COUNT = 3;
const RESOLUTION = 2048;
/** Far distance of each cascade, metres. */
const SPLITS = [26, 95, 330];
```

Camera (from `src/core/camera.js`): `minZ = 0.12`, `maxZ = 4200`, `fov = 1.02` rad (~58.4° vertical).
Sun elevation default `13.0°`, slider range `0.5°` … `45°`.

Height bounds, set once after the heightfield bake (`terrain.js`):
```js
shadows.setHeightBounds(heightfield.minHeight - 4, heightfield.maxHeight + 6);
```
Defaults before that call: `minHeight = -60`, `maxHeight = 60`.
`texelWorldPad = 2` (metres of slack on the cascade's lateral Y extent, covering the texel snap).

### 4.2 Slice assignment (with deliberate overlap)

```js
let sliceNear = camera.minZ;                 // 0.12
for (let c = 0; c < 3; c++) {
    const sliceFar = SPLITS[c];
    _fitCascade(c, sliceNear, sliceFar, camera.minZ, camera.maxZ);
    // Overlap slices so the cross-fade band has real data in BOTH cascades.
    sliceNear = sliceFar * 0.88;
}
```

Resulting slices (metres of view distance):

| Cascade | near | far | world extent (2·radius) at 58° FOV | approx texel |
|---|---|---|---|---|
| 0 | 0.12 | 26 | fitted per frame | ~1.5 cm |
| 1 | 22.88 (= 26 × 0.88) | 95 | fitted per frame | ~5 cm |
| 2 | 83.60 (= 95 × 0.88) | 330 | fitted per frame | **~32 cm** (quoted in source) |

The `0.88` overlap factor is the **same number** as the shader's cascade blend band start
(`sp.x * 0.88`, `sp.y * 0.88`) — they must match or the fade band samples a cascade that does not
cover the pixel.

`this.splits` is a `Float32Array(4)`: `[SPLITS[0], SPLITS[1], SPLITS[2], SPLITS[2]]` — the fourth
component duplicates the last split (the shader only reads `.x .y .z`, but the vec4 is uploaded whole).

### 4.3 `_fitCascade` — full algorithm, in order

**Step 1 — unproject the NDC cube.**
```js
const NDC = [
    [-1,-1,0], [1,-1,0], [1,1,0], [-1,1,0],   // near face  (WebGPU depth 0)
    [-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1],   // far  face  (WebGPU depth 1)
];
view.multiplyToRef(proj, _invViewProj); _invViewProj.invert();
for (i in 0..7) _corners[i] = TransformCoordinates(NDC[i], _invViewProj);
```
> **WebGPU depth range is `[0,1]`, not `[-1,1]`.** See porting note §11.2.

**Step 2 — re-cut each of the 4 frustum edges at the slice distances.**
The unprojected corners span `camNear..camFar`, so the slice distances are re-parameterised onto the
edge, *not* used directly:
```js
for (i in 0..3) {
    nearC = _corners[i]; farC = _corners[i+4];
    dir = normalize(farC - nearC); len = |farC - nearC|;
    t0 = (sliceNear - camNear) / (camFar - camNear);
    t1 = (sliceFar  - camNear) / (camFar - camNear);
    farC  = nearC + dir * (len * t1);
    nearC = nearC + dir * (len * t0);
}
```
Note the write order: `farC` is computed from the *unmodified* `nearC` first, then `nearC` is moved.

**Step 3 — bounding SPHERE (not box).**
```js
_center = mean of the 8 corners;
radius  = max over the 8 corners of |corner - _center|;
```
> A sphere is rotation-invariant, so the fitted extent does not change as the camera turns — which is
> what stops the shadow edges crawling when you look around.

**Step 4 — relative radius quantisation.**
```js
radius = max(radius, 0.5);
const q = Math.pow(2, Math.ceil(Math.log2(radius)) - 8);   // ~0.39% of the radius
radius = Math.ceil(radius / q) * q;
```
> Quantise the radius *relatively*, not to a fixed fraction of a metre. The radius depends only on
> the FOV, the aspect and the two splits, but it is measured by unprojecting the NDC cube through an
> inverted view-projection, so it carries a few ULPs of round-trip noise. An absolute quantum lets
> that noise cross a step, and a radius change rescales the whole map and defeats the snapping.
> ~0.4% of the radius sits well above the noise floor at every cascade size and still tracks a real
> FOV change (the rig widens the FOV with speed).

Constants: floor `0.5` m; exponent offset `8` (i.e. 256 steps per octave of radius).

**Step 5 — degenerate-up guard.**
```js
if (abs(lightDir.y) > 0.995) _up = (0, 0, 1); else _up = (0, 1, 0);
```
(`lightDir = normalize(-sunDir)` — the direction the light *travels*.)

**Step 6 — build the light's lateral basis.**
```js
_right = normalize(cross(_up, lightDir));
_lup   = cross(lightDir, _right);
```
This is exactly the pair `Matrix.LookAtLHToRef` rebuilds, and exactly the pair the shader
reconstructs (§6.1). All three must agree or the normal offset points sideways.

**Step 7 — WORLD-SPACE TEXEL SNAP (before the view matrix exists).**
```js
const texelWorld = (radius * 2) / RESOLUTION;              // metres per shadow texel
const cr = Math.floor(dot(_center, _right)   / texelWorld) * texelWorld;
const cu = Math.floor(dot(_center, _lup)     / texelWorld) * texelWorld;
const cf =            dot(_center, lightDir);              // NOT quantised
_center = _right * cr + _lup * cu + lightDir * cf;         // recompose in world space
```
> This has to happen **here, in world space, before the light view matrix is built**. Snapping
> afterwards by projecting `_center` through the matrix that was built to look at it is
> self-referential: that maps it to light-space `(0, 0, backoff)` by construction, so both quantised
> coordinates are identically zero and the snap does nothing.

Only the two **lateral** axes are quantised. The along-light coordinate is left continuous.

**Step 8 — solve the light volume's depth range (do NOT budget it).**
```js
// cot(elevation) metres of light-space depth per metre travelled across the light's view.
// At 13 degrees that is 4.33. Clamp at 2 degrees (sin 2 deg = 0.0349); cot(0.5 deg) = 114 runs away.
const fy = Math.min(lightDir.y, -0.0349);
const relief = radius + this.texelWorldPad;     // texelWorldPad = 2

let gMin = +Infinity, gMax = -Infinity;
for (let i = 0; i < 4; i++) {
    const yRel = (i < 2) ? -relief : relief;                       // box Y extent
    const py   = (i % 2 === 0) ? this.minHeight : this.maxHeight;  // terrain height extent
    const g = (py - _center.y - yRel * _lup.y) / fy;
    gMin = min(gMin, g); gMax = max(gMax, g);
}
```
Derivation, as given in the source: `_right` is horizontal by construction (up × forward with
up = +Y), so a point's height depends only on its light-space Y and its depth:
`p.y - c.y = yRel * up.y + depth * fwd.y`. Rearranged for depth and evaluated at the four
combinations of the box's Y extent and the terrain's height extent, that is the exact range of
light-space depth the snow can occupy inside this cascade.

**Step 9 — eye placement and clip planes.**
```js
const MARGIN = 12;                     // metres; absorbs carved berms, the character,
                                       // and anything standing proud of the baked heightfield
const backoff = MARGIN - gMin;
_eye = _center - lightDir * backoff;

Matrix.LookAtLHToRef(_eye, _center, _up, _lightView);

const near = MARGIN * 0.5;             // 6 m
const far  = backoff + gMax + MARGIN;

Matrix.OrthoOffCenterLHToRef(
    -radius, radius,      // left, right
    -radius, radius,      // bottom, top
    near, far,
    _lightProj,
    /* halfZRange = */ true            // <-- NOT OPTIONAL under WebGPU
);
```
> The 8th argument is `halfZRange` and it is not optional here. It defaults to false, which maps view
> depth to NDC z in `[-1, 1]` — the OpenGL convention. WebGPU clips at `[0, 1]`, so everything at
> `z < 0` would be thrown away by the rasteriser: half the volume, and the half nearest the sun,
> which is the half that casts.

**Step 10 — compose and publish.**
```js
_lightView.multiplyToRef(_lightProj, this.matrices[c]);   // Babylon row-vector: view THEN proj
this.params[c].set(far - near, radius * 2, 0, 0);         // (depthRange m, orthoWidth m, 0, 0)
for (mat of this._perCascade[c]) mat.setMatrix("lightViewProjection", this.matrices[c]);
```

**Step 11 — flatten for the receivers' UBO.**
```js
this.matrixData = Float32Array(16 * 3);   // matrices[c].copyToArray(matrixData, c*16)
this.paramData  = Float32Array(4  * 3);   // (x,y,z,w) per cascade
```
`params[c].x` = **depthRange in metres spanned by NDC z 0..1**.
`params[c].y` = **orthoWidth in metres spanned by UV 0..1** (= `2 * radius`).
`.z`, `.w` unused (0).

Both are what makes the PCSS penumbra estimate work in metres rather than NDC.

---

## 5. Caster registration — the shadow side

### 5.1 API

```js
registerCaster(mesh, makeMaterial, cascades)
```
- `makeMaterial(cascadeIndex) -> ShaderMaterial` — **one material instance per cascade**, so each can
  hold its own `lightViewProjection` without mid-frame uniform-buffer juggling. Every per-cascade
  material carries a distinct `defines: ["<TAG>_CASCADE " + c]` purely to force a distinct compiled
  `Effect` per cascade.
- `cascades` (optional, default 3) — how many cascades this caster is drawn into, **from the near end**.
- Internally: `maps[i].renderList.push(mesh)` + `maps[i].setMaterialForRendering(mesh, mat)`.

### 5.2 Who casts, into how many cascades, with which vertex program

| Caster | mesh | cascades | vertex program | fragment program | extra uniforms | samplers |
|---|---|---|---|---|---|---|
| Terrain clipmap | `terrain.mesh` | **3** (all) | `terrainDepth` | `terrainDepth` | `cameraPos`, `lodCenter`, `baseSpacing`, `gridHalfN`, `worldOrigin`, `worldSize`, `heightRes`, `windAngle`, `sastrugiAmp`, `deformCenter`, `deformSize`, `deformDepthScale` | `heightTex`, `auxTex`, `deformTex` |
| Character body | `bodyMesh` | **2** (`CHAR_CASCADES`) | `charDepth` | `terrainDepth` | — | `charTex` |
| Garments | `clothMesh` | **2** | `clothDepth` | `terrainDepth` | `panelParams: array<vec4f,6>` | `charTex` |
| Surf wake | `wake.mesh` | **2** (`WAKE_CASCADES`) | `wakeDepth` | **`wakeDepth`** (own — it discards) | `wakeCount`, `wakeCols`(=128), `wakeRows`(=18), `wakeTime` | `wakeTex` |
| Ice crystals | `crystals.mesh` | **2** (`CRYSTAL_CASCADES`) | `crystalDepth` | `terrainDepth` | — | `crystalTex` |
| Shell fur | — | **0** — deliberately not registered | | | | |
| Water body | — | **0** — receiver only | | | | |
| Spray particles | — | **0** — receiver only | | | | |

Every caster material sets `backFaceCulling = false`.

Rationale for the 2-cascade limit, verbatim:
> The terrain needs all three; a two-metre character does not — cascade 2 covers 330 m at 32 cm per
> texel, where the whole figure is two texels wide and its shadow is a grey smudge nobody can
> distinguish from the dune it is standing on. Skipping it saves a full re-skin and re-solve of the
> cloth grid per frame.

Rationale for excluding fur:
> Its shadow lands inside the hood's own, an alpha-tested 22-shell depth pass is not cheap, and what
> it would contribute is a slightly fuzzier edge on a shadow already an order of magnitude softer.

### 5.3 The shared depth fragment stage — `terrainDepth.fragment.wgsl` (complete)

```wgsl
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    fragmentOutputs.color = vec4f(input.position.z, 0.0, 0.0, 1.0);
}
```
`input.position` is the WGSL fragment builtin position; `.z` is window-space depth in `[0,1]`.
Stored as plain R32F colour **so PCSS can do its blocker search with ordinary filtered fetches — a
comparison sampler would only ever hand back a pre-thresholded result, which the blocker search
cannot use.**

### 5.4 Caster vertex programs — verbatim

**`charDepth.vertex.wgsl`** (identical skinning path to `char.vertex.wgsl`, only the matrix differs):
```wgsl
#include<snowCharSkin>
attribute position: vec3f;
attribute boneIdx:  vec4f;
attribute boneWt:   vec4f;
uniform lightViewProjection: mat4x4f;
var charTex: texture_2d<f32>;
var charTexSampler: sampler;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let world = skinPoint(charTex, vertexInputs.boneIdx, vertexInputs.boneWt, vertexInputs.position);
    vertexOutputs.position = uniforms.lightViewProjection * vec4f(world, 1.0);
}
```

**`clothDepth.vertex.wgsl`** (identical Catmull-Rom reconstruction to `cloth.vertex.wgsl`):
```wgsl
#include<snowCharSkin>
attribute position: vec3f;                     // (u, v, panel index)
uniform lightViewProjection: mat4x4f;
uniform panelParams: array<vec4f, 6>;          // (rowBase, cols, rows, 0) per panel
var charTex: texture_2d<f32>;  var charTexSampler: sampler;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let pp = uniforms.panelParams[i32(vertexInputs.position.z)];
    let s = sampleCloth(charTex, i32(pp.x), i32(pp.y), i32(pp.z),
                        vertexInputs.position.x, vertexInputs.position.y);
    vertexOutputs.position = uniforms.lightViewProjection * vec4f(s.pos, 1.0);
}
```
> A robe that casts the shape of its bind pose while drawing the shape of its simulation is worse
> than no shadow at all.

**`crystalDepth.vertex.wgsl`** (identical `crystalPoint`, **including the growth curve**):
```wgsl
#include<snowNoise>
#include<snowCrystal>
attribute position: vec3f;                     // (crystal index, vertex index, unused)
uniform lightViewProjection: mat4x4f;
var crystalTex: texture_2d<f32>;  var crystalTexSampler: sampler;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let i = i32(vertexInputs.position.x);
    let v = i32(vertexInputs.position.y);
    let P = crystalPoint(crystalTex, i, v);
    vertexOutputs.position = uniforms.lightViewProjection * vec4f(P, 1.0);
}
```
> …the shadow has to grow with the crystal rather than snapping to full size on the frame it is planted.

**`wakeDepth.vertex.wgsl`** (identical `wakePoint`; carries the erosion inputs to its own fragment stage):
```wgsl
#include<snowNoise>
#include<snowWake>
attribute position: vec3f;                     // (column, row, side)
uniform lightViewProjection: mat4x4f;
uniform wakeCount: f32;   uniform wakeCols: f32;   uniform wakeRows: f32;   uniform wakeTime: f32;
var wakeTex: texture_2d<f32>;  var wakeTexSampler: sampler;

varying vQ: f32;  varying vAlong: f32;  varying vAge: f32;
/// Carried through rather than re-declared in the fragment stage, so the two halves of the
/// depth pass cannot end up eroding at different moments.
varying vTime: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let side = vertexInputs.position.z;
    let u = vertexInputs.position.x / max(uniforms.wakeCols - 1.0, 1.0);
    let q = vertexInputs.position.y / max(uniforms.wakeRows - 1.0, 1.0);
    let P  = wakePoint  (wakeTex, uniforms.wakeCount, u, q, side, uniforms.wakeTime);
    let sc = wakeScalars(wakeTex, uniforms.wakeCount, u, side);
    vertexOutputs.vQ = q;  vertexOutputs.vAlong = sc.z;  vertexOutputs.vAge = sc.w;
    vertexOutputs.vTime = uniforms.wakeTime;
    vertexOutputs.position = uniforms.lightViewProjection * vec4f(P, 1.0);
}
```

**`wakeDepth.fragment.wgsl`** — the one caster with its own fragment stage:
```wgsl
#include<snowNoise>
#include<snowWake>
varying vQ: f32;  varying vAlong: f32;  varying vAge: f32;  varying vTime: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    if (wakeEroded(input.vAlong, input.vQ, input.vAge, input.vTime)) { discard; }
    fragmentOutputs.color = vec4f(input.position.z, 0.0, 0.0, 1.0);
}
```
> The erosion has to travel with it — the fragment stage discards the same texels — or the wake would
> cast the shadow of a solid wall it is not actually rendering, which on a crest that is half powder
> is the difference between a shadow and a stripe.

Wake lattice: `COLS = 128`, `ROWS = 18`, spine data texture `96 × 3` RGBA32F, `SPINE_MAX = 96`,
`SPINE_STEP = 0.30` m. `wakeCount` and `wakeTime` are pushed to **every** depth material and the
prepass material each frame from `_pushUniforms()`.

**`terrainDepth.vertex.wgsl`** — the load-bearing one:
```wgsl
#include<snowNoise>  #include<snowTerrain>  #include<snowDeform>  #include<snowClipmap>
attribute position: vec3f;                 // (gridX, ringLevel, gridZ)
uniform lightViewProjection: mat4x4f;
uniform cameraPos: vec3f;
uniform lodCenter: vec2f;                  // the CHARACTER, matching snow.vertex.wgsl exactly
uniform baseSpacing: f32;  uniform gridHalfN: f32;
uniform worldOrigin: vec2f; uniform worldSize: f32; uniform heightRes: f32;
uniform windAngle: f32;    uniform sastrugiAmp: f32;
uniform deformCenter: vec2f; uniform deformSize: f32; uniform deformDepthScale: f32;
var heightTex / auxTex / deformTex : texture_2d<f32> (+ samplers)

@vertex fn main(...) {
    let grid  = vec2f(position.x, position.z);
    let level = position.y;
    let cv = placeClipmapVertex(grid, level, uniforms.lodCenter,
                                uniforms.baseSpacing, uniforms.gridHalfN);
    let worldXZ = cv.worldXZ;
    let hUV = worldToHeightUV(worldXZ, uniforms.worldOrigin, uniforms.worldSize);
    var h = sampleHeightBicubic(heightTex, heightTexSampler, hUV, uniforms.heightRes);

    let exposure = textureSampleLevel(auxTex, auxTexSampler, hUV, 0.0).a;
    if (cv.spacing < 0.42) {                                     // FINE-LAYER GATE
        let fade = 1.0 - smoothstep(0.16, 0.42, cv.spacing);
        h += terrainFine(worldXZ, uniforms.windAngle, exposure, uniforms.sastrugiAmp).x * fade;
    }
    if (cv.spacing < 1.0) {                                      // DEFORMATION GATE
        let dfade = 1.0 - smoothstep(0.5, 1.0, cv.spacing);
        h += deformHeight(deformTex, deformTexSampler, worldXZ,
                          uniforms.deformCenter, uniforms.deformSize,
                          uniforms.deformDepthScale, cv.spacing) * dfade;
    }
    vertexOutputs.position = uniforms.lightViewProjection * vec4f(worldXZ.x, h, worldXZ.y, 1.0);
}
```

**Three constraints that must survive the port exactly:**
1. `lodCenter` is the **character**, not the light and not the camera. The clipmap rings are placed
   from the camera-side parameters in *all* passes. > "Critically, this uses the *camera* position to
   place the clipmap, not the light — the geometry rendered into the shadow map must be the identical
   mesh the beauty pass draws, or the depths will not correspond and the terrain will acne against
   its own silhouette. Only the view-projection differs."
2. The fine-layer gate (`spacing < 0.42`, fade `smoothstep(0.16, 0.42, spacing)`) and the deformation
   gate (`spacing < 1.0`, fade `smoothstep(0.5, 1.0, spacing)`) are **byte-identical** in
   `snow.vertex.wgsl`, `terrainDepth.vertex.wgsl` and `terrainPrepass.vertex.wgsl`.
   > If this pass displaced on a ring the beauty pass left flat — or band-limited it differently —
   > the terrain would shadow against a surface that is not the one being drawn, and every berm
   > would acne.
3. The deformation must be in the depth pass at all. > "Carved snow must cast and receive its own
   shadow… A trail that does not self-shadow reads as a decal painted on flat ground."

Clipmap constants for reference: `BASE_SPACING = 0.085` m, `GRID_HALF_N` from `clipmapMesh.js`,
8 rings, ~870 m outer extent, `WORLD_SIZE = 2048` m, `HEIGHT_RES = 4096` (0.5 m/texel).

---

## 6. The receiver — `shadowLookup.wgsl`

### 6.1 Contract (uniforms every receiving material must declare)

```
uniform sunDir:          vec3f                  // points TOWARD the sun
uniform cascadeMatrices: array<mat4x4f, 3>
uniform cascadeSplits:   vec4f                  // (26, 95, 330, 330)
uniform cascadeParams:   array<vec4f, 3>        // (depthRange m, orthoWidth m, -, -)
uniform shadowTexel:     f32                    // 1/2048
uniform shadowSoftness:  f32                    // per-material, see 6.5
uniform shadowBias:      f32                    // per-material, metres, see 6.5
var cascade0 / cascade1 / cascade2 : texture_2d<f32>  + matching samplers
```
and must `#include<snowShading>` **first**, for `pcssShadow`.

Receiving materials (all six): snow terrain, character body, garments, shell fur, surf wake, ice
crystals, water body, spray particles.

### 6.2 `sampleCascadeTex` — verbatim WGSL with annotations

```wgsl
fn sampleCascadeTex(
    tex: texture_2d<f32>, samp: sampler,
    m: mat4x4f, params: vec4f,
    world: vec3f,
    geoN: vec3f,        // the surface the *depth pass* rendered, not the shading normal
    biasWorld: f32, softness: f32, noiseRot: f32
) -> f32 {
    let depthRange = params.x;
    let orthoWidth = params.y;
    let texelWorld = orthoWidth * uniforms.shadowTexel;      // metres per shadow texel
```
`texelWorld` is ~1.5 cm in cascade 0 and ~32 cm in cascade 2.

```wgsl
    // ---- the light's own basis, reconstructed (never passed in) -----------
    let lf = -uniforms.sunDir;
    let lr = normalize(cross(vec3f(0.0, 1.0, 0.0), lf));
    let lu = cross(lf, lr);
```
> Reconstructed here rather than passed in, so it cannot drift out of sync with the matrix. This
> mirrors `Matrix.LookAtLHToRef` in shadows.js exactly: forward is the direction the light travels,
> right = up × forward, and the world up is only swapped out for a near-zenith sun, which this
> scene's 0.5–45 degree elevation range never reaches.

```wgsl
    let nl = vec3f(dot(geoN, lr), dot(geoN, lu), dot(geoN, lf));
    let nz = select(min(nl.z, -1e-3), max(nl.z, 1e-3), nl.z >= 0.0);
    let grad = clamp(vec2f(-nl.x / nz, -nl.y / nz), vec2f(-6.0), vec2f(6.0));
```
`nl.z` is the cosine between the normal and the light's direction of travel; it goes to zero exactly
at the terminator, where the depth gradient is genuinely infinite. Epsilon `1e-3`, sign-preserving.
**Slope clamped to ±6.0** (about 80°); > "past which extrapolating further would start detaching real
shadows from their casters rather than preventing acne."

```wgsl
    // Metres of light-space travel per unit UV. Y keeps its sign, because the
    // render-target flip below means v runs *with* light-space Y, not against it.
    let planeNdcPerUV = vec2f(grad.x, grad.y) * orthoWidth / depthRange;
```
Units: **NDC z per unit UV**. This is the receiver-plane gradient handed to PCSS.

```wgsl
    // ---- normal-offset bias ----------------------------------------------
    let sinL = sqrt(clamp(1.0 - nl.z * nl.z, 0.0, 1.0));
    let biased = world + geoN * (texelWorld * 1.5 * max(sinL, 0.2));
```
Constants: multiplier **1.5** texels; `sinL` floor **0.2**.
> Move the receiver off the surface by a texel's worth before projecting, scaled by how obliquely the
> light meets it. This is what absorbs the depth quantisation of the map itself, and because it is
> expressed in this cascade's own texels it needs no per-cascade multiplier: 3 cm in cascade 0, where
> contact shadows must stay attached, and 40 cm out in cascade 2 where a texel covers that much
> ground anyway.

```wgsl
    let clip = m * vec4f(biased, 1.0);
    let ndc = clip.xyz / clip.w;
    if (any(abs(ndc.xy) > vec2f(1.0)) || ndc.z < 0.0 || ndc.z > 1.0) { return 1.0; }
```
Returns **1.0 (fully lit)** outside the cascade extent, so callers fall through to a coarser one.

```wgsl
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 + ndc.y * 0.5);
```
**The Y sign is `+`, and this is the single most easily mis-ported line in the subsystem.** The
reference's own note, in full, because the reasoning is what has to be reproduced (not the sign):

> It is `+` because the map was rendered into a *render target*, and Babylon flips clip-space Y for
> those — WebGPU's texture origin is top-left where the framebuffer convention is bottom-left, so the
> engine negates Y in the vertex stage to compensate. The depth map is therefore already stored
> flipped, and applying the usual top-down flip here as well undoes it, mirroring every lookup about
> the middle row of the map.
>
> Measured, on the CPU, against a readback of cascade 0: sampling with `0.5 - ndc.y*0.5` put the map
> and the receiver up to 30 m apart, with the error passing through zero exactly at v = 0.5 and
> growing linearly either side — the mirror axis. With `0.5 + ndc.y*0.5` the same five points agree
> to within 0.4 m… That mirror axis sits at the cascade centre, which is fitted to the camera
> frustum, which is why the shadows appeared to slide around with camera angle, zoom and player
> position.

See §11.3 — in WebGL2 the *same expression* is correct, for a different reason.

```wgsl
    return pcssShadow(tex, samp, uv, ndc.z, uniforms.shadowTexel,
                      depthRange, orthoWidth, softness, noiseRot, biasWorld, planeNdcPerUV);
}
```

### 6.3 `sunShadow` — cascade selection and cross-fade, verbatim

```wgsl
fn sunShadow(world: vec3f, geoN: vec3f, viewDist: f32, noiseRot: f32) -> f32 {
    // A small constant bias, and nothing else. Slope scaling and per-cascade texel-footprint
    // multipliers are both handled inside sampleCascadeTex, exactly and in world units, by the
    // receiver-plane gradient and the texel-sized normal offset. Stacking more on top only
    // peter-pans the shadows off their casters.
    let biasWorld = uniforms.shadowBias;
    let sp   = uniforms.cascadeSplits;      // (26, 95, 330, 330)
    let soft = uniforms.shadowSoftness;

    if (viewDist >= sp.z) { return 1.0; }                       // beyond 330 m: lit

    if (viewDist < sp.x) {                                      // cascade 0 region
        let s = sampleCascadeTex(cascade0, cascade0Sampler, uniforms.cascadeMatrices[0],
                                 uniforms.cascadeParams[0], world, geoN, biasWorld, soft, noiseRot);
        let blendStart = sp.x * 0.88;                           // 22.88 m
        if (viewDist <= blendStart) { return s; }
        let s2 = sampleCascadeTex(cascade1, ...);
        return mix(s, s2, clamp((viewDist - blendStart) / (sp.x - blendStart), 0.0, 1.0));
    }

    if (viewDist < sp.y) {                                      // cascade 1 region
        let s = sampleCascadeTex(cascade1, ...);
        let blendStart = sp.y * 0.88;                           // 83.60 m
        if (viewDist <= blendStart) { return s; }
        let s2 = sampleCascadeTex(cascade2, ...);
        return mix(s, s2, clamp((viewDist - blendStart) / (sp.y - blendStart), 0.0, 1.0));
    }

    let s = sampleCascadeTex(cascade2, ...);
    // Fade the last cascade out at its far edge rather than cutting to lit.
    return mix(s, 1.0, smoothstep(sp.z * 0.85, sp.z, viewDist));  // 280.5 m -> 330 m
}
```

Blend bands, explicitly:
- cascade 0 → 1: linear `mix` over `22.88 m … 26 m` (12% of the split).
- cascade 1 → 2: linear `mix` over `83.60 m … 95 m` (12%).
- cascade 2 → lit: `smoothstep` over `280.5 m … 330 m` (15%).

Both blend bands re-run the *entire* PCSS chain in a second cascade — 2 × (8 + 12) = 40 taps inside
the band. That is accepted; the band is narrow and coherent.

> The cascades are separate bindings rather than one atlas because WGSL cannot index a texture by a
> runtime value without binding arrays. The branch costs almost nothing: cascade choice is a function
> of view distance, so it is coherent across essentially every wavefront.

### 6.4 Call sites — `geoN`, `viewDist`, `noiseRot`

The per-pixel filter rotation, identical in all six receivers:
```wgsl
let noiseRot = ign(input.position.xy) * 6.28318530718;   // 2*PI

// noise.wgsl:
fn ign(pix: vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(pix, vec2f(0.06711056, 0.00583715))));
}
```
Interleaved Gradient Noise over **pixel coordinates**. > "IGN over pixel coords is exactly the noise
TAA is built to resolve." Do not substitute a hash of world position or UV — the port depends on TAA
resolving it.

Back-face gate (skip the whole lookup where the surface faces away from the sun):
- snow: `if (NdotL > -0.35) { shadow = sunShadow(...); }`
- character / cloth: `if (NdotL > -0.4) { ... }`
- fur / spray / wake / crystals / water: unconditional.

`geoN` **must be the geometric normal the depth pass rendered**, not the shading normal. In
`snow.fragment.wgsl`:
```wgsl
var N = normalFromGradient(grad);   // macro landform + analytic fine layer + carved deformation
let geoN = N;                       // captured BEFORE the three tiled detail-normal scales
```
> The surface the *depth pass* rendered: macro landform, the analytic fine layer and carved snow, but
> nothing finer. The shading normal below picks up three tiled grain scales on top of this, and
> biasing the shadow lookup against that would describe a surface orders of magnitude higher in
> frequency than the one in the depth map — the offset would point off in a different direction on
> every pixel and reintroduce the noise it exists to remove.

`viewDist` is the **distance from the camera in metres**, supplied by the receiver (a varying
`vViewDist` on the character/wake/crystal/water/spray; computed in the snow fragment shader).

### 6.5 Per-material shadow parameters (all six receivers)

| Material | `shadowSoftness` | `shadowBias` (m) | Source |
|---|---|---|---|
| Snow terrain | **1.8** | **0.022** | `terrain.js:303,306` |
| Character body / garments / fur | **1.4** | **0.012** | `character.js:458,463` |
| Surf wake | **1.5** | **0.018** | `surfWake.js:631,632` |
| Ice crystals | **1.3** | **0.012** | `crystals.js:287,288` |
| Water body | **1.4** | **0.03** | `waterBody.js:296,297` |
| Spray particles | **1.6** | **0.05** | `particles.js:285,286` |

All six share the same `shadowTexel = 1/2048`.

Rationale for the character's tighter bias, verbatim:
> Tighter than the terrain's: the figure is small, its cascade is the near one, and a large bias here
> detaches the contact shadow between the boots and the snow — which is the shadow that tells you the
> character is standing on the ground rather than in it.

And for the terrain's:
> Metres. Snow has no thin geometry to peter-pan, so this can stay small and keep contact shadows
> attached.

---

## 7. The PCSS chain — `pcssShadow` in `shading.wgsl`

### 7.1 The rotated Poisson disc — the actual tap table

```wgsl
/// Poisson-ish disc, precomputed. Rotated per pixel so 12 taps look like far more than 12.
const POISSON: array<vec2f, 12> = array<vec2f, 12>(
    vec2f(-0.326, -0.406), vec2f(-0.840, -0.074), vec2f(-0.696,  0.457),
    vec2f(-0.203,  0.621), vec2f( 0.962, -0.195), vec2f( 0.473, -0.480),
    vec2f( 0.519,  0.767), vec2f( 0.185, -0.893), vec2f( 0.507,  0.064),
    vec2f( 0.896,  0.412), vec2f(-0.322, -0.933), vec2f(-0.792, -0.598)
);
```
Unit-disc coordinates; magnitudes range from 0.511 (`0.507, 0.064`) to 0.981 (`0.962,-0.195`).
**The blocker search uses the first 8 taps (`i = 0..7`); the filter uses all 12.**

### 7.2 Full function, verbatim, with annotations

```wgsl
fn pcssShadow(
    shadowMap: texture_2d<f32>, shadowSamp: sampler,
    uv: vec2f,
    receiverDepth: f32,     // ndc.z of the (normal-offset) receiver, [0,1]
    texelSize: f32,         // one shadow texel, in UV  (1/2048)
    depthRange: f32,        // metres spanned by NDC z 0..1   (cascadeParams.x)
    orthoWidth: f32,        // metres spanned by UV 0..1      (cascadeParams.y)
    softness: f32,          // multiplier on the sun's angular size
    noiseRot: f32,
    biasWorld: f32,         // depth bias, metres
    planeNdcPerUV: vec2f    // receiver's own depth slope, NDC z per unit UV
) -> f32 {
    let bias = biasWorld / depthRange;          // metres -> NDC z
    let planeAt = planeNdcPerUV;

    // Widest penumbra we will ever produce, in UV — also the search radius,
    // since an occluder further away than this cannot soften anything more.
    let maxPenumbraUV = min(24.0 * texelSize, 1.8 / orthoWidth);

    let cs = cos(noiseRot);
    let sn = sin(noiseRot);
    let rot = mat2x2f(cs, -sn, sn, cs);

    // ---- blocker search (8 taps) -----------------------------------------
    var blockerDepthSum = 0.0;
    var blockerCount = 0.0;
    for (var i = 0; i < 8; i++) {
        let off = rot * POISSON[i] * maxPenumbraUV;
        let s = clamp(uv + off, vec2f(0.0), vec2f(1.0));
        let d = textureSampleLevel(shadowMap, shadowSamp, s, 0.0).r;
        let cmp = receiverDepth + dot(off, planeAt) - bias;      // RECEIVER-PLANE EXTRAPOLATION
        if (d < cmp) {
            blockerDepthSum += cmp - d;                          // distance in FRONT OF THE PLANE
            blockerCount += 1.0;
        }
    }

    // Nothing in front of the receiver: fully lit, and we skip the filter.
    if (blockerCount < 0.5) { return 1.0; }

    // ---- penumbra estimate (similar triangles, in metres) -----------------
    let blockerDist   = (blockerDepthSum / blockerCount) * depthRange;   // metres
    let penumbraWorld = blockerDist * 0.0093 * softness;                 // metres
    let filterR = clamp(penumbraWorld / orthoWidth, texelSize, maxPenumbraUV);

    // ---- filter (12 taps) --------------------------------------------------
    var lit = 0.0;
    for (var i = 0; i < 12; i++) {
        let off = rot * POISSON[i] * filterR;
        let s = clamp(uv + off, vec2f(0.0), vec2f(1.0));
        let d = textureSampleLevel(shadowMap, shadowSamp, s, 0.0).r;
        let cmp = receiverDepth + dot(off, planeAt) - bias;
        lit += select(1.0, 0.0, d < cmp);
    }
    return lit / 12.0;
}
```

### 7.3 The three non-obvious design decisions, and why they are load-bearing

**(a) Everything is in metres, not NDC.**
> The usual formulation estimates the penumbra as a ratio of raw depth-buffer values. That silently
> fails here: the cascades are orthographic over a range of hundreds of metres, so a two-metre step
> between blocker and receiver is a few thousandths in NDC, the estimate rounds to nothing, and the
> filter collapses to one texel — pin-sharp shadows regardless of how far the occluder actually is.
> Converting to metres first is what makes the softening real.

**(b) Receiver-plane depth bias — `cmp = receiverDepth + dot(off, planeAt) - bias`.**
> Both loops sample the map *away* from the shading point and then have to decide whether what they
> found is an occluder. Comparing against the shading point's own depth is only valid if the surface
> is flat in light space, and under a 13-degree sun it is nothing of the sort: the light meets level
> snow at 77 degrees from the normal, so the surface's own depth falls `1.8 * tan(77) = 7.8 m` across
> the 1.8 m blocker search radius, against a bias measured in centimetres. Every offset sample then
> reports the snow as its own occluder and the cascade floods solid black.
>
> That flood is also why the artefact looked camera-driven: the search radius is capped in metres, so
> it only exceeds the bias in the coarser cascades, and which cascade a pixel lands in is a function
> of its distance from the *camera*. Orbiting or zooming moved the boundary, and the flood moved with it.

The blocker accumulator stores `cmp - d` (distance in front of the **plane**), not `receiverDepth - d`,
so the penumbra estimate inherits the same correction.

**(c) The penumbra coefficient `0.0093`.**
> Similar triangles, in metres. The sun subtends about half a degree, so a blocker `d` metres in front
> of the receiver casts a penumbra of roughly `0.0093*d` — `softness` opens that up, because pure
> geometric penumbra is tighter than snow actually looks once sky light fills the shadow.

(0.0093 rad ≈ 0.533°, the sun's angular diameter.)

### 7.4 Numeric behaviour of the search radius cap

`maxPenumbraUV = min(24 * texelSize, 1.8 / orthoWidth)`:
- `24 * (1/2048)` = **0.01171875 UV** = 24 shadow texels.
- `1.8 / orthoWidth` UV = **1.8 metres**, whichever is smaller.

Which term wins:
- The texel term wins when `24 * orthoWidth / 2048 < 1.8`, i.e. `orthoWidth < 153.6 m` — cascade 0
  (~30 m across) and cascade 1 (~110 m across) are texel-limited.
- The metre term wins for cascade 2 (~660 m across) — capped at 1.8 m of world blur.

Filter radius floor is `texelSize` (one texel) — contact stays crisp.

---

## 8. The camera-space depth prepass — `depthPass.js`

### 8.1 Target

| Property | Value |
|---|---|
| Name | `"scenePrepass"` |
| Size | **full render resolution** (`engine.getRenderWidth/Height()`), resized on `onResizeObservable` |
| Format | `TEXTUREFORMAT_RGBA` + `TEXTURETYPE_HALF_FLOAT` → **RGBA16F** |
| Mipmaps | none |
| Depth buffer | **yes** |
| Sampling | **`TEXTURE_NEAREST_SAMPLINGMODE`** — deliberately |
| Wrap U / V | clamp |
| Clear colour | **`(DEPTH_FAR, 0, 0, 1)` = `(9000, 0, 0, 1)`** |
| Refresh | every frame |
| Registration | `scene.customRenderTargets.push(rtt)` — **after** the three cascades, before the beauty pass |

Nearest filtering, verbatim:
> Every consumer reconstructs a position from this, and a bilinear tap across a silhouette returns a
> depth that belongs to neither surface — which shows up as a halo of wrong occlusion around every edge.

Half float rather than full, verbatim:
> The relative precision is 2⁻¹¹, so the error is 0.05% of the distance — five millimetres at ten
> metres, fifteen centimetres at three hundred. Every consumer works in units of "fraction of the
> distance to the pixel", so that is far below anything any of them can resolve, and it halves the
> bandwidth of a target that is written once and read a dozen times.

### 8.2 Channel layout

| Channel | Contents | Units |
|---|---|---|
| **`.r`** | **linear view depth** = the clip-space `w`, which for a perspective projection **is** the view-space `z` | metres |
| **`.g`** | **specular mask**: `0` = matte snow, `1` = mirror ice. Only the SSR pass reads it, and only where non-zero. | 0..1 |
| `.b` | spare (written 0) | |
| `.a` | spare (written 1) | |

`DEPTH_FAR = 9000` (exported constant). Mirrored in `postCommon.wgsl` as `const POST_FAR: f32 = 9000.0`
with the background test:
```wgsl
fn isBackground(z: f32) -> bool { return z > POST_FAR * 0.5; }   // > 4500
```
> Beyond the camera's far plane [4200], so the sky reads as "nothing here" to every consumer without
> any of them needing a separate mask.

Consumers reconstruct view-space position with:
```wgsl
fn viewFromDepth(uv: vec2f, z: f32, projInfo: vec2f) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    return vec3f(ndc.x * projInfo.x, ndc.y * projInfo.y, 1.0) * z;
}
// projInfo = (tan(fovY/2) * aspect, tan(fovY/2))
```
Consumers: TAA (reprojection), volumetric light shafts (occlusion march), depth of field (circle of
confusion), SSR (march + `.g` gate). Four `setTexture("depthTex", depthTex)` bindings in `postChain.js`.

### 8.3 Prepass caster registration

```js
registerCaster(mesh, material)   // rtt.renderList.push(mesh); rtt.setMaterialForRendering(mesh, mat)
```
Single material per caster (no per-cascade multiplicity). **The material must declare `viewProjection`
— Babylon binds the active camera's, which during this target's render is the jittered one the beauty
pass will use, so the depth and the colour line up to the subpixel.**

| Caster | vertex program | fragment program | writes `.g` | Registered in |
|---|---|---|---|---|
| Terrain clipmap | `terrainPrepass` | `prepass` | **ice glaze × deform falloff** | `main.js:123` |
| Character body | `charPrepass` | `prepass` | 0.0 | `character.js:320` |
| Garments | `clothPrepass` | `prepass` | 0.0 | `character.js:320` |
| Surf wake | `wakePrepass` | **`wakePrepass`** (discards) | 0.0 | `surfWake.js:253` |
| Ice crystals | `crystalPrepass` | `prepass` | **1.0** | `crystals.js:178` |
| Shell fur | — not registered | | | |
| Water body | — not registered | | | |
| Spray particles | — not registered | | | |
| Sky | — not registered (the clear value covers it) | | | |

Exclusions, verbatim:
- Fur: > "an alpha-tested twenty-two-shell pass, and what it would contribute is a fractionally
  fuzzier occlusion edge on a hood rim that is already inside its own baked cavity."
- Water: > "the water body is translucent and refractive, so a depth for it would tell every
  screen-space consumer that the snow behind it is not there — which is exactly wrong for a medium
  you can see through."
- Wake is included because > "it is the largest moving object in the frame, so the temporal resolve
  needs its depth to reproject anything in front of it, and a two-metre wall of snow standing on the
  field ought to occlude the trench beside it." (It writes depth but does **not** receive occlusion.)

### 8.4 The shared prepass fragment stage — `prepass.fragment.wgsl` (complete)

```wgsl
varying vViewZ: f32;
/// 0 matte snow, 1 mirror ice. Only the reflection pass reads it.
varying vMask: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    fragmentOutputs.color = vec4f(input.vViewZ, input.vMask, 0.0, 1.0);
}
```
> Linear view depth arrives as a varying rather than being reconstructed from `position.z`: for a
> perspective projection the clip-space `w` *is* the view-space `z`, so carrying it costs one
> interpolant and is exact, where linearising the depth buffer would spend a divide to recover a
> number the vertex stage already had.

### 8.5 Prepass vertex programs — verbatim

**`charPrepass.vertex.wgsl`**
```wgsl
#include<snowCharSkin>
attribute position: vec3f;  attribute boneIdx: vec4f;  attribute boneWt: vec4f;
uniform viewProjection: mat4x4f;
var charTex: texture_2d<f32>;  var charTexSampler: sampler;
varying vViewZ: f32;  varying vMask: f32;

@vertex fn main(...) {
    let world = skinPoint(charTex, vertexInputs.boneIdx, vertexInputs.boneWt, vertexInputs.position);
    let clip  = uniforms.viewProjection * vec4f(world, 1.0);
    vertexOutputs.vViewZ = clip.w;
    vertexOutputs.vMask  = 0.0;
    vertexOutputs.position = clip;
}
```

**`clothPrepass.vertex.wgsl`** — same, with `panelParams` + `sampleCloth(...)`:
```wgsl
let pp = uniforms.panelParams[i32(vertexInputs.position.z)];
let s  = sampleCloth(charTex, i32(pp.x), i32(pp.y), i32(pp.z),
                     vertexInputs.position.x, vertexInputs.position.y);
let clip = uniforms.viewProjection * vec4f(s.pos, 1.0);
vertexOutputs.vViewZ = clip.w;  vertexOutputs.vMask = 0.0;  vertexOutputs.position = clip;
```

**`crystalPrepass.vertex.wgsl`** — the only caster that writes a non-zero mask:
```wgsl
let i = i32(vertexInputs.position.x);
let v = i32(vertexInputs.position.y);
let P = crystalPoint(crystalTex, i, v);
let clip = uniforms.viewProjection * vec4f(P, 1.0);
vertexOutputs.vViewZ = clip.w;
vertexOutputs.vMask  = 1.0;                 // <-- the entire reason the mask channel exists
vertexOutputs.position = clip;
```

**`wakePrepass.vertex.wgsl`** — carries the erosion varyings AND `vViewZ`:
```wgsl
let side = vertexInputs.position.z;
let u = vertexInputs.position.x / max(uniforms.wakeCols - 1.0, 1.0);
let q = vertexInputs.position.y / max(uniforms.wakeRows - 1.0, 1.0);
let P  = wakePoint  (wakeTex, uniforms.wakeCount, u, q, side, uniforms.wakeTime);
let sc = wakeScalars(wakeTex, uniforms.wakeCount, u, side);
let clip = uniforms.viewProjection * vec4f(P, 1.0);
vertexOutputs.vQ = q;  vertexOutputs.vAlong = sc.z;  vertexOutputs.vAge = sc.w;
vertexOutputs.vTime = uniforms.wakeTime;  vertexOutputs.vViewZ = clip.w;
vertexOutputs.position = clip;
```

**`wakePrepass.fragment.wgsl`** (complete):
```wgsl
#include<snowNoise>
#include<snowWake>
varying vQ: f32;  varying vAlong: f32;  varying vAge: f32;  varying vTime: f32;  varying vViewZ: f32;

@fragment fn main(input: FragmentInputs) -> FragmentOutputs {
    if (wakeEroded(input.vAlong, input.vQ, input.vAge, input.vTime)) { discard; }
    fragmentOutputs.color = vec4f(input.vViewZ, 0.0, 0.0, 1.0);
}
```
(Mask is 0 — the wake is not a mirror.)

**`terrainPrepass.vertex.wgsl`** — byte-identical clipmap/deform code to the beauty and depth passes,
plus the ice mask:
```wgsl
// ... identical placeClipmapVertex / sampleHeightBicubic / fine-layer gate (0.42, smoothstep 0.16..0.42)
//     / deformation gate (1.0, smoothstep 0.5..1.0) as terrainDepth.vertex.wgsl ...

// The ice channel, read straight rather than through deformHeight's binomial: this feeds a
// reflection gate, not a displacement, so smoothing it to the vertex lattice would only soften
// the edge of a glaze that the fragment stage draws hard.
var mask = 0.0;
let dWeight = deformFalloff(worldXZ, uniforms.deformCenter, uniforms.deformSize);
if (dWeight > 0.001) {
    let s = textureSampleLevel(deformTex, deformTexSampler,
                               deformUV(worldXZ, uniforms.deformSize), 0.0);
    mask = clamp(s.a, 0.0, 1.0) * dWeight;      // deform .a = ice channel
}
let clip = uniforms.viewProjection * vec4f(worldXZ.x, h, worldXZ.y, 1.0);
vertexOutputs.vViewZ = clip.w;
vertexOutputs.vMask  = mask;
vertexOutputs.position = clip;
```
Constant: `dWeight` threshold `0.001`. Deformation texture channel meanings (for the `.a` read):
`.r` depression depth, `.g` displaced mass/berm, `.b` compression, **`.a` ice**.

> If this pass placed a vertex anywhere else, every screen-space effect downstream would be
> integrating against a surface that is not the one on screen — and the symptom of that is an
> ambient-occlusion halo that follows the camera, which reads as a rendering bug rather than as a
> mismatch.

Terrain prepass material sets `backFaceCulling = false` (as do all prepass materials).

### 8.6 Warm-up

`DepthPass.warmUp()` awaits `material.isReady(mesh, false)` for every registered prepass material,
behind the loading screen, so no pipeline compiles mid-frame. Each caster does the same for its
cascade materials (`terrain.warmUp()`, `wake.warmUp()`, `figure.warmUp()`, `spells.warmUp()`).
The wake lays a **synthetic 24-sample straight spine** first, so the warm-up frames actually rasterise
triangles through the pipeline rather than compiling one that has never had a triangle through it.

---

## 9. Uniform / data layout summary (for a UBO port)

### 9.1 Shadow block, shared by all receivers

| Field | Type | Size | Value source |
|---|---|---|---|
| `cascadeMatrices` | `mat4x4f[3]` | 192 B | `ShadowSystem.matrixData` (`Float32Array(48)`), cascade-major |
| `cascadeSplits` | `vec4f` | 16 B | `(26, 95, 330, 330)` |
| `cascadeParams` | `vec4f[3]` | 48 B | `(far-near, 2*radius, 0, 0)` per cascade |
| `shadowTexel` | `f32` | 4 B | `1/2048` |
| `shadowSoftness` | `f32` | 4 B | per material, §6.5 |
| `shadowBias` | `f32` | 4 B | per material, metres, §6.5 |
| `sunDir` | `vec3f` | 12 B | unit vector **toward** the sun |

Matrix upload avoids allocation via `bindMatrixArray()`, which writes the caller's `Float32Array`
directly into `ShaderMaterial._matrixArrays[name]` so `effect.setMatrices` takes the byte-identical
path minus the copy. Six materials × 3 matrices per frame otherwise = ~1 KB of garbage per frame.

### 9.2 Shadow data-texture conventions used by the casters

- **Character transform texture** (`charTex`, RGBA32F, nearest, clamp): rows 0–3 = bone matrices,
  rows 4+ = simulated cloth nodes. `panelParams[i] = (rowBase, cols, rows, 0)` for up to 6 panels.
- **Wake spine texture** (`wakeTex`, `96 × 3` RGBA32F, nearest, clamp):
  row 0 = `(x, y, z, alongDist)`, row 1 = `(tangentX, tangentZ, ampL, ampR)`,
  row 2 = `(curlL, curlR, age01, 0)` (as written by `_syntheticSpine`).
- **Crystal texture** (`crystalTex`, `96 × 3` RGBA32F, nearest, clamp):
  row 0 = `(x, y, z, height)`, row 1 = `(axisX, axisY, axisZ, radius)`, row 2 = `(growth, seed, tint, -)`.
  `CRYSTAL_MAX = 96`, `VERTS = 13` per crystal (two rings of `RING = 6` plus an apex).
- **Deformation texture** (`deformTex`, 2048² RGBA16F, ping-ponged, toroidal `fract(worldXZ/size)`):
  `.r` depression depth, `.g` displaced mass, `.b` compression, `.a` ice.

---

## 10. Debug views (worth porting — they are how you validate the port)

`snow.fragment.wgsl` `debugMode` values (`DEBUG_MODES` in `terrain.js`):

| Mode | Name | What it draws |
|---|---|---|
| 4 | `cascades` | `color * 0.6 + vec3(viewDist<split.x, viewDist<split.y, viewDist<split.z) * 0.25` |
| 7 | `shadow` | The sun-visibility term alone (no N·L, albedo, ambient, fog). **Red `(0.35, 0.06, 0.06)` where `NdotL <= 0`** so a back-lit surface is not misread as an occluded one. |
| 8 | `ndotl` | `vec3(max(NdotL, 0))` — the *other* reason a pixel is dark |
| 9 | `shadowMap` | **Depth-map agreement, in metres** — see below |

`shadowMapDelta(world, geoN, viewDist)` projects **exactly as `sampleCascadeTex` does** (same
`params.y * shadowTexel * 1.5 * max(sinL, 0.2)` normal offset, same cascade selection, same
`uv = (ndc.x*0.5+0.5, 0.5 + ndc.y*0.5)`), takes the **single centre tap**, and returns
`(stored - ndc.z) * params.x` — the disagreement in metres. Returns `1e9` when the point is outside
every cascade box.

Colour key (reproduce it — it is the fastest port-validation tool in the codebase):
- **blue `(0.0, 0.15, 0.6)`** — point falls outside every cascade box
- **grey** — map and receiver agree within 0.5 m (`agree = 1 - smoothstep(0, 0.5, |dz|)`, × 0.45)
- **red** — map claims an occluder in front, brighter with distance (`mag = clamp(|dz|/12, 0, 1)`)
- **green** — map sits behind the receiver; > "should be impossible on a closed heightfield, so it
  means the projection is off"

> Near zero means the two passes are describing the same surface and any remaining artefact is a bias
> or filter question. Hundreds of metres means they are not, and no amount of bias tuning is going to help.

---

## 11. WEBGL2 / THREE.JS r172 PORTING NOTES

### 11.1 Float colour render targets

| Reference | WebGL2 / Three.js r172 |
|---|---|
| `TEXTUREFORMAT_RED` + `TEXTURETYPE_FLOAT` (R32F) | `new THREE.WebGLRenderTarget(2048, 2048, { format: THREE.RedFormat, type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping })` |
| implicit | **Requires `EXT_color_buffer_float`.** Call `renderer.getContext().getExtension("EXT_color_buffer_float")` and hard-fail if absent — R32F is not colour-renderable in WebGL2 core. |
| bilinear on a float texture | **Requires `OES_texture_float_linear`.** If absent, drop to `THREE.NearestFilter`; PCSS taps are ≥1 texel apart so the visual delta is small, but the contact edge hardens by roughly half a texel. |
| `TEXTURETYPE_HALF_FLOAT` + RGBA (RGBA16F) | `type: THREE.HalfFloatType`, `format: THREE.RGBAFormat`. Also gated on `EXT_color_buffer_float` (or `EXT_color_buffer_half_float`). `9000` is well inside half-float's 65504 max. |

**Do not** substitute an R16F cascade target. NDC depth lives in `[0,1]`; half-float's ~2⁻¹¹ relative
precision near 1.0 is ~0.0005, which multiplied by cascade 2's `depthRange` (frequently >1000 m under
a 13° sun — see §4.3 step 8) is metres of quantisation, and the 2.2 cm terrain bias cannot absorb it.

### 11.2 Depth range `[0,1]` vs `[-1,1]`

WebGPU clips at `z ∈ [0,1]`; WebGL2 clips at `z ∈ [-1,1]`.

- **Projection:** drop the `halfZRange = true` argument. A stock `THREE.OrthographicCamera` produces
  the GL convention and is correct as-is. **Do not** try to reproduce the `[0,1]` mapping — it will
  clip the half of the volume nearest the sun.
- **NDC cube unprojection (§4.3 step 1):** the near-face `z` becomes **`-1`**, not `0`:
  `[-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1], [-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1]`.
- **Stored depth:** `gl_FragCoord.z` in GLSL is window-space depth, already in `[0,1]` under the
  default `glDepthRange(0,1)` — so `fragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);` is the exact
  equivalent of `input.position.z` and stores the **same numbers**.
- **Receiver:** `ndc.z` from `lightVP * world` is now in `[-1,1]`. Remap **once**, immediately after
  the divide, and everything downstream (bias, `planeNdcPerUV`, `cmp`, `depthRange` scaling) stays
  numerically identical to the reference:
  ```glsl
  vec3 ndc = clip.xyz / clip.w;
  if (any(greaterThan(abs(ndc.xy), vec2(1.0))) || abs(ndc.z) > 1.0) return 1.0;
  float receiverDepth = ndc.z * 0.5 + 0.5;      // <-- the only new line
  ```
  Keep `bias = biasWorld / depthRange` and `planeNdcPerUV = grad * orthoWidth / depthRange` unchanged:
  after the remap, one unit of `receiverDepth` still spans `depthRange` metres.

### 11.3 The Y-flip

Babylon negates clip-space Y when rendering into a render target (WebGPU top-left texture origin vs
bottom-left framebuffer convention), so the reference's `v = 0.5 + ndc.y * 0.5` is a *double* flip
that cancels.

**Three.js / WebGL2 does not flip Y for render targets.** The correct WebGL2 line is the textbook one:

```glsl
vec2 uv = ndc.xy * 0.5 + 0.5;     // == the reference's expression, for a different reason
```

**The expression is identical. The reason is not.** Do not "fix" it to `0.5 - ndc.y * 0.5`. If a port
regression puts the map and receiver up to ~30 m apart with the error passing through zero at
`v = 0.5` and growing linearly either side, this is the line — validate with the mode-9 debug view
(§10), which will show a clean mirror axis through the cascade centre.

Corollary: the comment in `sampleCascadeTex` — "Y keeps its sign, because the render-target flip
below means v runs *with* light-space Y" — is **still true in WebGL2** but for the opposite reason
(no flip at all, on either side). `planeNdcPerUV.y` keeps `grad.y`'s sign in both APIs.

### 11.4 Matrix convention

- Babylon uses **row-vector** algebra: `A.multiplyToRef(B, out)` means `out = A · B` applied as
  `v · A · B`. The reference composes `view.multiplyToRef(proj, matrices[c])` and the shader writes
  `m * vec4f(world, 1.0)`. Babylon's `Matrix.m` storage happens to make that shader multiply correct.
- GLSL/Three.js use **column-vector** algebra. Compose in the opposite order:
  ```js
  lightVP.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse); // proj * view
  ```
  and in GLSL: `vec4 clip = lightViewProjection * vec4(world, 1.0);` (unchanged).
- Rule of thumb for every matrix in `shadows.js`: **Babylon `A.multiplyToRef(B)` ⇒ GLSL `B * A`.**
- `Matrix.LookAtLHToRef` is **left-handed** (forward = `+Z` in view space). `THREE.Camera.lookAt` is
  right-handed (forward = `−Z`). Do not try to reproduce the handedness — reproduce the *invariants*:
  the ortho half-extent is `radius` on both lateral axes, the eye sits `backoff` metres back along
  `−lightDir` from the snapped centre, `near = 6`, `far = backoff + gMax + 12`. Build the light camera
  as:
  ```js
  lightCam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, near, far);
  lightCam.up.copy(upVector);              // (0,1,0), or (0,0,1) if |lightDir.y| > 0.995
  lightCam.position.copy(eye);
  lightCam.lookAt(center);
  lightCam.updateMatrixWorld(true);
  ```
- **Do the texel snap on the CPU in world space with your own `right`/`lup`**, exactly as the
  reference does (§4.3 step 7), *before* constructing the camera. Do not extract the basis from
  `lightCam.matrixWorld` and snap afterwards — that is the self-referential failure the reference
  calls out, and it silently produces a no-op snap.
- The shader-side basis reconstruction (`lf = -sunDir; lr = normalize(cross(vec3(0,1,0), lf)); lu = cross(lf, lr);`)
  uses only world-space vectors and **ports verbatim**. It must agree with the CPU basis; if the
  handedness of your light camera makes `lu` point the other way from the map's +V axis, the normal
  offset and the receiver-plane gradient will both be wrong in `y` only — which shows as acne that
  appears on lee faces but not windward faces. Validate with mode 9.

### 11.5 WGSL → GLSL 3.00 es transliteration table

| WGSL | GLSL 3.00 es |
|---|---|
| `textureSampleLevel(tex, samp, uv, 0.0)` | `textureLod(tex, uv, 0.0)` (combined sampler; `tex` is a `sampler2D` uniform) |
| `select(a, b, cond)` | `(cond ? b : a)` — **note the argument order flips** |
| `any(abs(v) > vec2f(1.0))` | `any(greaterThan(abs(v), vec2(1.0)))` |
| `const POISSON: array<vec2f,12> = array<vec2f,12>(...)` | `const vec2 POISSON[12] = vec2[12](vec2(-0.326,-0.406), ...);` — legal in GLSL ES 3.00, and dynamic indexing by a loop counter is legal |
| `mat2x2f(cs, -sn, sn, cs)` | `mat2(cs, -sn, sn, cs)` — **GLSL `mat2` is column-major, WGSL `mat2x2f` is also column-major, so the same four scalars give the same matrix.** `rot * POISSON[i]` behaves identically. |
| `uniforms.foo` | plain `foo` uniforms, or a `layout(std140) uniform ShadowBlock { ... }` UBO |
| `vertexOutputs.position` / `fragmentOutputs.color` | `gl_Position` / `out vec4 fragColor` |
| `input.position.xy` (fragment builtin) | `gl_FragCoord.xy` — same window coords, **but `gl_FragCoord.y` counts from the bottom in GL and from the top in WebGPU.** For `ign()` this only changes which pixels get which rotation, which is visually irrelevant; do not chase it. |
| `input.position.z` (fragment builtin) | `gl_FragCoord.z` |
| `fract` | `fract` — identical semantics (`x - floor(x)`) for both signs |
| `discard;` | `discard;` |
| `array<vec4f, 6>` uniform | `uniform vec4 panelParams[6];` — with std140 in a UBO, `vec4[N]` has a natural 16-byte stride, no padding surprises. **Never use `float[N]` in a UBO** (16-byte stride per element). |
| `i32(x)` / `f32(x)` | `int(x)` / `float(x)` |

Use `THREE.RawShaderMaterial` with `glslVersion: THREE.GLSL3` so Three prepends nothing and you own
the whole program. Declare `precision highp float; precision highp int;` and — importantly for the
cascades — `precision highp sampler2D;` so the R32F fetches are not demoted.

### 11.6 The per-caster custom-vertex-program registration pattern — **the core port**

Babylon's mechanism is `RenderTargetTexture.renderList` + `setMaterialForRendering(mesh, material)`:
the same `Mesh` is drawn into up to five different targets with five different materials, never
touching `mesh.material`.

**Three.js has no direct equivalent. Evaluate the three candidates:**

| Candidate | Verdict |
|---|---|
| `Material.onBeforeCompile` | **Wrong tool.** It patches Three's *built-in* shader chunks. Every program here is hand-written GLSL3 in a `RawShaderMaterial`; there is no built-in shader to patch, and `onBeforeCompile` cannot give you a different vertex *entry point* per pass. |
| `mesh.customDepthMaterial` | **Insufficient.** It is consulted only by `WebGLShadowMap`, which is not being used, and it is a single material — this subsystem needs **one material per cascade** (three for the terrain) plus a separate prepass material. |
| `scene.overrideMaterial` | **Wrong.** It is one material for the whole scene; each caster has a *different* vertex program (clipmap vs skinning vs Catmull-Rom vs spine-sweep vs growth curve). Overriding with one material is precisely the "five undisplaced lattices" failure the reference exists to avoid. |

**Recommended pattern — parallel proxy scenes sharing geometry:**

```
casterScene[0], casterScene[1], casterScene[2]     // one THREE.Scene per cascade
prepassScene                                        // one THREE.Scene for the prepass

For each caster (terrain, body, cloth, wake, crystals):
  for c in 0 .. (cascadeCount(caster) - 1):
      proxy = new THREE.Mesh(SHARED_GEOMETRY, depthMaterial[caster][c]);
      proxy.frustumCulled = false;          // the light frustum is not the camera frustum,
                                            // and the terrain has no meaningful bounding box
      proxy.matrixAutoUpdate = false;       // world placement happens in the vertex shader
      casterScene[c].add(proxy);
  prepassProxy = new THREE.Mesh(SHARED_GEOMETRY, prepassMaterial[caster]);
  prepassProxy.frustumCulled = false;
  prepassScene.add(prepassProxy);
```

`SHARED_GEOMETRY` is the **same `BufferGeometry` instance** as the beauty mesh — no duplicated
vertex buffers, no CPU cost. This reproduces `renderList` + `setMaterialForRendering` exactly, with
no per-frame material swapping and no state thrash.

**Per-frame render:**
```js
renderer.autoClear = false;
for (let c = 0; c < 3; c++) {
    renderer.setRenderTarget(cascadeRT[c]);
    renderer.setClearColor(0xffffff, 1.0); renderer.clear(true, true, false);   // depth = 1.0 = far
    renderer.render(casterScene[c], lightCam[c]);
}
renderer.setRenderTarget(prepassRT);
// see 11.7 for the 9000 clear
renderer.render(prepassScene, camera);        // the SAME jittered camera the beauty pass uses
renderer.setRenderTarget(null);
renderer.render(beautyScene, camera);
```

**Uniform synchronisation is now the port's main hazard.** In the reference, `terrain.update()`
explicitly re-pushes the *identical* clipmap/deform uniforms to the beauty material, the prepass
material and all three depth materials every frame (see `terrain.js` lines 280–371), and
`setDeformTexture()` re-points all five at the flipped ping-pong target. Reproduce this with **one
shared `THREE.UniformsGroup` (WebGL2 UBO)** bound to all five materials for the scalar block:
```
lodCenter, baseSpacing, gridHalfN, worldOrigin, worldSize, heightRes,
windAngle, sastrugiAmp, deformCenter, deformSize, deformDepthScale, cameraPos
```
so the only thing that can drift is `lightViewProjection` (which is *supposed* to differ) and the
`deformTex` **texture binding** (which is a per-material sampler and must still be re-pointed on
every ping-pong flip — a UBO cannot carry it). Same for the wake: `wakeCount`, `wakeCols`, `wakeRows`,
`wakeTime` go to all four of its materials; the reference does this in `_pushUniforms()`.

**Factor the vertex source, do not copy it.** The reference's `#include<snowClipmap>` /
`#include<snowTerrain>` / `#include<snowDeform>` / `#include<snowCharSkin>` / `#include<snowWake>` /
`#include<snowCrystal>` exist precisely so the beauty, depth and prepass programs compile *literally
the same text*. In the port, either register the chunks in `THREE.ShaderChunk` and use
`#include <snowClipmap>` (Three's `ShaderMaterial` resolves those even for GLSL3), or build the
source with a JS template that concatenates shared strings. Three duplicated copies of
`placeClipmapVertex` is the failure mode this whole architecture is designed to prevent.

**Pipeline warm-up** has no Three equivalent of `material.isReady(mesh, false)`. Use
`renderer.compile(scene, camera)` per proxy scene (r172 returns a Promise via
`renderer.compileAsync`), and render 3 throwaway frames with the wake's synthetic spine planted,
mirroring `main.js` lines 192–201.

### 11.7 Clearing the prepass to 9000

`renderer.setClearColor()` takes a `THREE.Color`, whose components are `[0,1]` and colour-managed —
**it cannot express 9000.** Three options, best first:

1. **Raw `clearBufferfv`** after binding the target:
   ```js
   renderer.setRenderTarget(prepassRT);
   const gl = renderer.getContext();
   gl.clearBufferfv(gl.COLOR, 0, new Float32Array([9000, 0, 0, 1]));
   gl.clear(gl.DEPTH_BUFFER_BIT);
   renderer.autoClear = false;
   renderer.render(prepassScene, camera);
   ```
2. A full-screen triangle drawn first with `depthTest: false, depthWrite: false` writing
   `vec4(9000.0, 0.0, 0.0, 1.0)`.
3. Change `DEPTH_FAR` to `1.0` and invert every consumer's background test — **not recommended**,
   because `isBackground(z) = z > 4500` and the DoF / shafts / SSR maths all assume the sentinel is a
   large *distance*, not a flag.

Keep the sentinel comfortably beyond `camera.far = 4200` and inside half-float range: **9000 is the
value; do not change it without changing `POST_FAR` in the post-chain common include to match.**

### 11.8 TAA jitter must be shared with the prepass

The reference writes the jitter directly into the projection matrix and freezes it for the frame, so
`scene.getTransformMatrix()` returns the same jittered matrix to both the prepass and the beauty pass.
In Three.js:
```js
camera.updateProjectionMatrix();                 // once, before jitter
camera.projectionMatrix.elements[8]  += jitterNdcX;   // m[2][0] in column-major = elements[8]
camera.projectionMatrix.elements[9]  += jitterNdcY;   // elements[9]
camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
// DO NOT call updateProjectionMatrix() again this frame.
```
`jitterNdc = (2 * halton.x / width, 2 * halton.y / height)`, Halton(2,3), **8 samples**, on
`[-0.5, 0.5]`. The cascade fit uses `camera.getViewMatrix()` and `camera.getProjectionMatrix()` — in
the reference these are read *before* the jitter is applied in the same frame ordering; using the
jittered matrix for the frustum-corner unprojection is harmless (sub-pixel) but adds noise to
`radius`, which the relative quantisation (§4.3 step 4) is specifically sized to reject. Prefer the
unjittered matrix for the cascade fit.

### 11.9 Things WebGL2 simply does not have

| Reference feature | WebGL2 status |
|---|---|
| Compute shaders / storage textures | Not used by this subsystem — everything is already vertex + fragment. No change required. |
| WebGPU timestamp queries (`engine.getGPUFrameTimeCounter()`) | Unavailable. Use `EXT_disjoint_timer_query_webgl2` where present, else CPU-side `performance.now()` around `renderer.render`. The perf overlay's "GPU frame" row becomes an estimate. |
| `textureLoad` (unfiltered fetch by integer coords) | Use `texelFetch(tex, ivec2(coord), 0)` — needed for the `charTex` / `wakeTex` / `crystalTex` data-texture reads inside the shared includes. |
| Array-of-textures binding | Not needed: the reference already binds `cascade0/1/2` as three separate samplers with a static branch, precisely because WGSL cannot index a texture by a runtime value. Port that structure as-is. GLSL ES 3.00 also cannot index a `sampler2D` array by a non-constant expression, so this is the correct shape in both APIs. |
| `alphaMode = ALPHA_COMBINE` + `forceDepthWrite` (crystals) | `material.transparent = true; material.depthWrite = true;` and place the crystals in the opaque sort bucket by `renderOrder` — the reference deliberately keeps `renderingGroupId = 1` (opaque group) with blending on. |
| Auto-clear-depth-between-groups control | Three has no rendering groups; use `renderOrder` on a single scene, or two `renderer.render()` calls with `autoClearDepth = false` between them. The invariant to preserve: **the alpha group must depth-test against the opaque group, so depth must NOT be cleared between them.** |

---

## 12. VISUAL ACCEPTANCE CRITERIA

A harsh critic checking screenshots (and two short clips) should be able to answer **yes** to all of
these. Sun elevation 13°, default settings.

1. **Contact shadows are welded, and there is no acne.** The dark under each planted boot touches the
   sole with no gap of lit snow between shadow and caster, in the same frame in which open, unoccluded
   snow shows **zero** stippled acne — no speckle, no moiré, no dotted pattern on windward dune faces.
   Failing one of these two while passing the other means the bias strategy was replaced with a
   constant bias; both must hold simultaneously.

2. **Penumbra visibly widens with distance from the contact point.** Follow a single dune-ridge shadow
   downwind: within roughly a metre of the ridge line the edge is razor-sharp (one to two texels); tens
   of metres out it is a soft gradient several tens of centimetres wide. The widening is **continuous**,
   not a step. Equally: the blur **stops** widening — no shadow anywhere in frame is softer than about
   1.8 m of world blur, so a 200 m long shadow does not dissolve into a grey wash.

3. **Shadow edges do not crawl or swim under camera motion.** Orbit and zoom the camera with the player
   standing still: every shadow boundary stays welded to the snow it lies on. Specifically, the
   sastrugi's own fine self-shadowing must not shimmer, sparkle or boil. Then walk forward 20 m: the
   edges still do not slide relative to the ground. (Failure here means the world-space texel snap or
   the relative radius quantisation was dropped.)

4. **Cascade boundaries are invisible in the beauty image and exact in the debug view.** Walking outward
   through 26 m and 95 m there is no step in filter softness, no brightness seam, and no visible arc
   across the snow. Switching to the cascade debug tint (mode 4), the red/green/blue bands appear at
   exactly 26 m, 95 m and 330 m from the camera.

5. **The far cascade dissolves, it does not cut.** Between roughly 280 m and 330 m the shadowing fades
   smoothly to fully lit. There is no hard circle, ring or arc at 330 m, and no sudden brightening
   step visible while walking or panning across that range.

6. **Carved snow self-shadows.** A fresh footprint has a distinctly darker **far** wall (the wall away
   from the sun), not a uniform grey oval. A fresh surf trench shows its downwind wall in shade and its
   berm crest casting a thin shadow line down into the trench. A trail that reads as a flat decal
   painted on level ground is a failure — the deformation is missing from the depth pass.

7. **Trail shadows age with the trail.** Over the ~60 s a trail takes to relax and spread, its cast
   shadow softens and spreads with it. At no point is there a shadow of a berm that is no longer there,
   nor a raised berm without a shadow. (Failure means the depth pass and the beauty pass are reading
   different sides of the ping-pong.)

8. **The wake's shadow is torn, not solid.** While snow-surfing, the shadow the breaking wall throws on
   the snow beside it has holes and a ragged, disintegrating edge that **match** the holes visible in
   the wall itself. A solid dark stripe under a wall that is visibly half powder is a failure — the
   erosion `discard` is missing from the shadow fragment stage.

9. **Shadowed snow is blue and still alive.** Inside a cast shadow the snow retains a clear blue cast —
   never neutral grey, never black — and a thin drift lip or berm crest lying **inside** a shadow still
   glows visibly brighter than the flat field around it. Shadowed snow that reads as flat, dead grey
   means the shadow term was applied to the subsurface contribution at full strength instead of
   `mix(0.42, 1.0, shadow)`.

10. **The character casts into the near field only, and you cannot tell.** Standing within ~90 m the
    figure has a legible cast shadow; beyond ~95 m it has none. There must be no visible pop, flicker
    or fade artefact at the transition — at that range the shadow would be about two texels wide, so
    its absence should be unnoticeable in a still.

11. **The depth-agreement debug view is uniformly grey.** In mode 9 the entire visible field reads as
    flat mid-grey (map and receiver agree within 0.5 m). Any of the following is a failed port:
    red or green **rings** at clipmap ring boundaries (the depth pass band-limited the deformation or
    the fine layer differently); a red/green **gradient that mirrors about a horizontal line** through
    the middle of the view (the shadow-map V flip is inverted, §11.3); large blue regions inside the
    330 m radius (the light volume's near/far solve is clipping casters out).

12. **Ice is the only thing with a specular mask.** With no Crystallise cast, the screen-space
    reflection pass produces literally nothing and costs a fetch and a branch. After casting
    Crystallise, reflections appear on the ice prisms and on the glazed snow around them — and nowhere
    else, in particular not on the character, the wake or plain snow.

---

## 13. CONSTANTS APPENDIX

Every numeric constant captured, with its binding identifier and units.

### 13.1 Cascade geometry (`shadows.js`)

| # | Identifier | Value | Units |
|---|---|---|---|
| 1 | `CASCADE_COUNT` | 3 | count |
| 2 | `RESOLUTION` | 2048 | texels (square) |
| 3 | `SPLITS[0]` | 26 | m (view distance) |
| 4 | `SPLITS[1]` | 95 | m |
| 5 | `SPLITS[2]` | 330 | m |
| 6 | slice overlap factor | 0.88 | ratio |
| 7 | `texelSize` / `shadowTexel` | 1/2048 = 0.00048828125 | UV |
| 8 | cascade clear colour | 1.0 (RGBA all 1) | NDC depth (far) |
| 9 | default `minHeight` | −60 | m |
| 10 | default `maxHeight` | 60 | m |
| 11 | `texelWorldPad` | 2 | m |
| 12 | radius floor | 0.5 | m |
| 13 | radius quantiser exponent offset | 8 (⇒ 2⁻⁸ ≈ 0.39% steps) | — |
| 14 | zenith up-vector guard | \|lightDir.y\| > 0.995 | cosine |
| 15 | grazing-sun clamp `fy` | −0.0349 (= −sin 2°) | cosine |
| 16 | `MARGIN` | 12 | m |
| 17 | near-plane factor | 0.5 (⇒ near = 6 m) | ratio |
| 18 | NDC near-face z (WebGPU) | 0 | NDC |
| 19 | NDC far-face z (WebGPU) | 1 | NDC |
| 20 | height-bounds low margin | −4 | m |
| 21 | height-bounds high margin | +6 | m |

### 13.2 Camera / sun

| # | Identifier | Value | Units |
|---|---|---|---|
| 22 | `cam.minZ` | 0.12 | m |
| 23 | `cam.maxZ` | 4200 | m |
| 24 | `cam.fov` (vertical) | 1.02 | rad (~58.4°) |
| 25 | `S.sunElevation` default | 13.0 | degrees |
| 26 | `sunElevation` slider min | 0.5 | degrees |
| 27 | `sunElevation` slider max | 45 | degrees |

### 13.3 `shadowLookup.wgsl`

| # | Identifier | Value | Units |
|---|---|---|---|
| 28 | `nz` epsilon | 1e-3 | cosine |
| 29 | receiver-plane gradient clamp | ±6.0 | slope (≈80°) |
| 30 | normal-offset texel multiplier | 1.5 | texels |
| 31 | normal-offset `sinL` floor | 0.2 | sine |
| 32 | UV remap scale/offset | 0.5 / 0.5 | — |
| 33 | cascade 0→1 blend start factor | 0.88 | ratio (⇒ 22.88 m) |
| 34 | cascade 1→2 blend start factor | 0.88 | ratio (⇒ 83.60 m) |
| 35 | final fade start factor | 0.85 | ratio (⇒ 280.5 m) |
| 36 | out-of-cascade return value | 1.0 | visibility |

### 13.4 PCSS (`shading.wgsl`)

| # | Identifier | Value | Units |
|---|---|---|---|
| 37–60 | `POISSON[0..11]` — 24 scalars: (−0.326,−0.406), (−0.840,−0.074), (−0.696,0.457), (−0.203,0.621), (0.962,−0.195), (0.473,−0.480), (0.519,0.767), (0.185,−0.893), (0.507,0.064), (0.896,0.412), (−0.322,−0.933), (−0.792,−0.598) | unit disc |
| 61 | blocker-search tap count | 8 | taps |
| 62 | filter tap count | 12 | taps |
| 63 | filter normalisation divisor | 12.0 | — |
| 64 | max-penumbra texel multiplier | 24.0 | texels |
| 65 | max-penumbra world cap | 1.8 | m |
| 66 | blocker-count threshold | 0.5 | count |
| 67 | sun angular-size coefficient | 0.0093 | rad (≈0.533°) |
| 68 | filter radius lower clamp | `texelSize` (1/2048) | UV |
| 69 | UV tap clamp bounds | 0.0 / 1.0 | UV |

### 13.5 Per-material shadow parameters

| # | Identifier | Value | Units |
|---|---|---|---|
| 70 | terrain `shadowSoftness` | 1.8 | multiplier |
| 71 | terrain `shadowBias` | 0.022 | m |
| 72 | character `shadowSoftness` | 1.4 | multiplier |
| 73 | character `shadowBias` | 0.012 | m |
| 74 | wake `shadowSoftness` | 1.5 | multiplier |
| 75 | wake `shadowBias` | 0.018 | m |
| 76 | crystal `shadowSoftness` | 1.3 | multiplier |
| 77 | crystal `shadowBias` | 0.012 | m |
| 78 | water `shadowSoftness` | 1.4 | multiplier |
| 79 | water `shadowBias` | 0.03 | m |
| 80 | spray `shadowSoftness` | 1.6 | multiplier |
| 81 | spray `shadowBias` | 0.05 | m |

### 13.6 Caster cascade counts and gates

| # | Identifier | Value | Units |
|---|---|---|---|
| 82 | terrain cascades (default) | 3 | count |
| 83 | `CHAR_CASCADES` | 2 | count |
| 84 | `WAKE_CASCADES` | 2 | count |
| 85 | `CRYSTAL_CASCADES` | 2 | count |
| 86 | snow lookup gate `NdotL >` | −0.35 | cosine |
| 87 | character lookup gate `NdotL >` | −0.4 | cosine |
| 88 | subsurface-in-shadow floor `mix(0.42, 1.0, shadow)` | 0.42 | ratio |

### 13.7 Filter rotation noise (`ign`)

| # | Identifier | Value | Units |
|---|---|---|---|
| 89 | IGN multiplier | 52.9829189 | — |
| 90 | IGN dot x | 0.06711056 | — |
| 91 | IGN dot y | 0.00583715 | — |
| 92 | 2π rotation scale | 6.28318530718 | rad |

### 13.8 Depth prepass

| # | Identifier | Value | Units |
|---|---|---|---|
| 93 | `DEPTH_FAR` / `POST_FAR` | 9000 | m |
| 94 | `isBackground` threshold factor | 0.5 (⇒ 4500 m) | ratio |
| 95 | crystal specular mask | 1.0 | 0..1 |
| 96 | non-ice specular mask | 0.0 | 0..1 |
| 97 | terrain ice-mask `dWeight` threshold | 0.001 | weight |
| 98 | half-float relative precision | 2⁻¹¹ (0.05%) | ratio |
| 99 | Halton jitter sample count | 8 | samples |
| 100 | Halton bases | 2, 3 | — |
| 101 | jitter range | [−0.5, 0.5] | pixels |

### 13.9 Shared caster-geometry gates (must match across all three passes)

| # | Identifier | Value | Units |
|---|---|---|---|
| 102 | fine-layer spacing gate | < 0.42 | m (clipmap spacing) |
| 103 | fine-layer fade smoothstep low | 0.16 | m |
| 104 | fine-layer fade smoothstep high | 0.42 | m |
| 105 | deformation spacing gate | < 1.0 | m |
| 106 | deformation fade smoothstep low | 0.5 | m |
| 107 | deformation fade smoothstep high | 1.0 | m |
| 108 | `heightRes` | 4096 | texels |
| 109 | `WORLD_SIZE` | 2048 | m |
| 110 | `BASE_SPACING` | 0.085 | m |
| 111 | wake `COLS` | 128 | columns |
| 112 | wake `ROWS` | 18 | rows |
| 113 | wake `SPINE_MAX` / data-texture width | 96 | samples |
| 114 | wake data-texture height | 3 | rows |
| 115 | `CRYSTAL_MAX` / data-texture width | 96 | crystals |
| 116 | crystal `VERTS` per prism | 13 | vertices |
| 117 | crystal `RING` | 6 | vertices |
| 118 | `panelParams` array length | 6 | vec4s |

### 13.10 Debug view (mode 9)

| # | Identifier | Value | Units |
|---|---|---|---|
| 119 | outside-cascade sentinel | 1e9 | m |
| 120 | outside-cascade colour | (0.0, 0.15, 0.6) | RGB |
| 121 | agreement smoothstep high | 0.5 | m |
| 122 | agreement grey level | 0.45 | luminance |
| 123 | magnitude normaliser | 12.0 | m |
| 124 | back-lit marker colour (mode 7) | (0.35, 0.06, 0.06) | RGB |
| 125 | cascade tint base/overlay (mode 4) | 0.6 / 0.25 | ratio |

**Total distinct numeric constants captured: 125.**
