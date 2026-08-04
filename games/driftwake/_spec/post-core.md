# SNOWFLOW — Implementation Spec: Post Chain, Core Systems, Frame Orchestration

**Target of the port:** Three.js r172 / WebGL2 / hand-written GLSL 3.00 es.
**Source of truth for this document:** the SNOWFLOW reference tree (WebGPU + Babylon.js + WGSL).

Files transcribed in full for this spec:

```
src/post/postChain.js
src/shaders/post/taa.fragment.wgsl
src/shaders/post/ssr.fragment.wgsl
src/shaders/post/shafts.fragment.wgsl
src/shaders/post/bloomDown.fragment.wgsl
src/shaders/post/bloomBlur.fragment.wgsl
src/shaders/post/dof.fragment.wgsl
src/shaders/post/tonemap.fragment.wgsl
src/shaders/post/sharpen.fragment.wgsl
src/shaders/lib/postCommon.wgsl
src/core/settings.js
src/core/camera.js
src/core/input.js
src/core/perf.js
src/core/loading.js
src/ui/overlay.js
src/main.js
```

Supporting files read for contract-completeness (channel semantics the post chain
depends on): `src/render/depthPass.js`, `src/shaders/prepass.fragment.wgsl`,
`src/shaders/terrainPrepass.vertex.wgsl`, `src/shaders/charPrepass.vertex.wgsl`,
`src/shaders/clothPrepass.vertex.wgsl`, `src/shaders/crystalPrepass.vertex.wgsl`,
`src/core/gpuUtil.js`, `src/render/sky.js` (sun radiance scale only),
`src/character/controller.js` (the three values it publishes to the chain), `index.html`.

Everything in this document that is stated as a value was read out of those files this
session. Where the reference's own comments and the reference's own code disagree, both
are given and the disagreement is called out explicitly (see §7.2).

---

# 0. What this subsystem is

Nine full-screen passes, run in a fixed order after the beauty pass, plus the CPU-side
orchestration that feeds them: a camera spring arm that publishes the focal distance, a
settings store that every pass reads, an input layer, and a per-frame update order in
`main.js` whose sequencing is load-bearing (jitter must be written into the projection
before either depth or colour is rasterised).

The chain's single non-negotiable is **TAA**. The snow material spends its entire detail
budget below the pixel — two octaves of discrete crystal glints, three tiled grain scales,
sastrugi at decimetre scale, a rotated-Poisson shadow filter dithered per pixel, and
two-centimetre airborne grains. All of it is authored to be *resolved by accumulation*.
Without the temporal integrator the field crawls, and every other pass in the chain is
tuned on the assumption that TAA already ran.

---

# 1. Pass topology

## 1.1 The reference's own table (verbatim from `postChain.js`)

Babylon chains post-processes by having pass *i* render into pass *i+1*'s texture — so the
resolution a pass renders at is declared by the pass *after* it. The reference states the
resulting table as the source of truth:

```
  pass        renders at   reads                        writes into
  ssr          full        scene, depth                 taa's texture
  taa          full        ssr result, history, depth   history[k]   (forced)
  shafts       1/4         depth                        bloomA's texture
  bloomA       1/4         history[k]  (bright pass)    bloomB's texture
  bloomB       1/16        bloomA result                bloomC's texture
  bloomC       1/16        bloomB result (tent blur)    dof's texture
  dof          full        history[k], depth            composite's texture
  composite    full        dof result, bloom, shafts    sharpen's texture
  sharpen      full        composite result             the swapchain
```

`1/4` and `1/16` are **linear** ratios (width/4 and height/4; width/16 and height/16).
At 2560×1440 that is 640×360 and 160×90.

`shafts` carries a forced output texture (`shafts._forcedOutputTexture =
history[k].renderTarget`), which does three things at once: it gives the temporal resolve
somewhere persistent to land, it means `shafts` allocates no target of its own, and it puts
the resolved frame in a texture the chain owns — so `bloomA` and `dof` can read the
full-resolution resolved scene even though the chain has moved on to sixteenth-resolution
bloom levels by then. Two history textures alternate, because a pass may not sample the
target it is writing to.

**Why every pass stays attached:** toggling a post-process off in Babylon detaches it from
the camera and reshuffles which texture every remaining pass renders into, mid-frame.
Instead every pass takes an `enabled` uniform and early-outs in its own shader, becoming a
full-screen copy. Reproduce this: the toggles are settings-overlay conveniences and must
not restructure the graph.

## 1.2 The port's explicit render-target table

A WebGL2 port has no "pass i writes into pass i+1's texture" indirection. Allocate these
targets explicitly and the graph becomes trivial. Column "format" is the reference format;
substitutions are in §16.

| Target | Size | Format | Filter / Wrap | Written by | Read by |
|---|---|---|---|---|---|
| `RT_prepass` | full | RGBA16F | **NEAREST**, clamp | depth prepass | taa, ssr, shafts, dof |
| `RT_scene` | full | RGBA16F | bilinear, clamp | beauty pass | ssr |
| `RT_ssr` | full | RGBA16F | bilinear, clamp | ssr | taa (as `textureSampler`) |
| `RT_history[0]`, `RT_history[1]` | full | RGBA16F | bilinear, **clamp** | taa (writes `[k]`) | taa (reads `[1-k]`), bloomA (reads `[k]`), dof (reads `[k]`) |
| `RT_shafts` | 1/4 | RGBA16F | bilinear, clamp | shafts | composite |
| `RT_bloom0` | 1/4 | RGBA16F | bilinear, clamp | bloomA (prefilter) | bloomB, composite (`bloomNear`) |
| `RT_bloom1` | 1/16 | RGBA16F | bilinear, clamp | bloomB | bloomC |
| `RT_bloom2` | 1/16 | RGBA16F | bilinear, clamp | bloomC (tent blur) | composite (`bloomFar`) |
| `RT_dof` | full | RGBA16F | bilinear, clamp | dof | composite |
| `RT_composite` | full | **RGBA8** | bilinear, clamp | composite | sharpen |
| default framebuffer | full | 8-bit sRGB | — | sharpen | display |

Notes that matter:

* `RT_composite` is 8-bit *by design*. The reference declares `sharpen`'s texture type as
  `TEXTURETYPE_UNSIGNED_BYTE` with the comment: *"The last stage before the swapchain, and
  the only one working on display-encoded values — eight bits is exactly what it needs."*
  The composite's output is already sRGB-encoded (§8.10), so 8 bits is the right container
  and the sharpen pass operates on display-encoded values, which is where the eye judges
  acutance.
* Every other intermediate is half float.
* `RT_prepass` is **nearest-filtered on purpose**. The reference comment: every consumer
  reconstructs a position from it, and a bilinear tap across a silhouette returns a depth
  belonging to neither surface, which shows up as a halo of wrong occlusion around every
  edge. Do not "improve" this to LINEAR.
* History textures are **clamp-to-edge** on both axes. The Catmull-Rom fetch reaches two
  texels outside the reprojected position and repeat-wrap would fold the opposite edge of
  the frame into the history.

## 1.3 Pass execution order (the exact chain)

```
1. depth prepass        -> RT_prepass          (custom render target, before the beauty pass)
2. beauty pass          -> RT_scene
3. ssr                  -> RT_ssr              full res
4. taa                  -> RT_history[k]       full res    (k flipped this frame)
5. shafts               -> RT_shafts           quarter res
6. bloomA (prefilter)   -> RT_bloom0           quarter res
7. bloomB (downsample)  -> RT_bloom1           sixteenth res
8. bloomC (tent blur)   -> RT_bloom2           sixteenth res
9. dof                  -> RT_dof              full res
10. composite (tonemap) -> RT_composite        full res, 8-bit
11. sharpen             -> default framebuffer full res
```

Dependencies worth stating because they are not obvious from the order:

* `bloomA` and `dof` both read **`RT_history[k]`** — the frame TAA just resolved — *not*
  the previous pass's output. They deliberately bypass the chain.
* `composite` reads `RT_dof` as its main input, plus `RT_bloom0` (near), `RT_bloom2` (far)
  and `RT_shafts`.
* `taa` reads `RT_ssr` as `textureSampler` (current frame), `RT_history[1-k]` as history,
  and `RT_prepass` for depth.
* `ssr` reads `RT_scene` as both the source colour *and* the thing it reflects. Reflections
  come out of the un-resolved beauty buffer, before TAA.

## 1.4 Per-pass uniform and sampler declarations (field order preserved)

Preserving the declaration order costs nothing and makes the port diff-able against the
reference.

| Pass | Shader name | Declared ratio | Uniforms (in order) | Samplers (in order) | Declared texture type |
|---|---|---|---|---|---|
| ssr | `snowSsr` | 1.0 | `projInfo, invRes, enabled, strength` | `depthTex` | HALF_FLOAT |
| taa | `snowTaa` | 1.0 | `prevViewProj, invView, projInfo, invRes, jitterNdc, historyValid, enabled, feedback` | `historyTex, depthTex` | HALF_FLOAT |
| shafts | `snowShafts` | 1.0 | `sunUV, sunOnScreen, sunColor, enabled, strength, aspect` | `depthTex` | HALF_FLOAT |
| bloomA | `snowBloomDown` | 0.25 | `srcTexel, prefilter, curve` | `sourceTex` | HALF_FLOAT |
| bloomB | `snowBloomDown` | 0.25 | `srcTexel, prefilter, curve` | `sourceTex` | HALF_FLOAT |
| bloomC | `snowBloomBlur` | 0.0625 | `srcTexel` | — | HALF_FLOAT |
| dof | `snowDof` | 0.0625 | `invRes, enabled, focusDist, maxCoc` | `sceneTex, depthTex` | HALF_FLOAT |
| composite | `snowTonemap` | 1.0 | `exposure, contrast, mode, grainAmount, time, vignette, speedStreak, bloomAmount, shaftAmount` | `bloomNear, bloomFar, shaftsTex` | HALF_FLOAT |
| sharpen | `snowSharpen` | 1.0 | `invRes, amount` | — | UNSIGNED_BYTE |

Every pass is created with `samplingMode: TEXTURE_BILINEAR_SAMPLINGMODE`, `reusable:
false`, and the scene camera.

---

# 2. Shared conventions — `postCommon.wgsl`

This include is short and every pass depends on it. Transcribed verbatim, then annotated.

```wgsl
/// Cleared value of the depth prepass. Must match `DEPTH_FAR` in depthPass.js.
const POST_FAR: f32 = 9000.0;

/// True where the prepass wrote nothing — sky, or a discarded fragment.
fn isBackground(z: f32) -> bool {
    return z > POST_FAR * 0.5;
}

/// View-space position of a pixel.
fn viewFromDepth(uv: vec2f, z: f32, projInfo: vec2f) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    return vec3f(ndc.x * projInfo.x, ndc.y * projInfo.y, 1.0) * z;
}

/// Screen UV of a view-space position. The inverse of `viewFromDepth`.
fn uvFromView(p: vec3f, projInfo: vec2f) -> vec2f {
    let ndc = vec2f(p.x / (projInfo.x * p.z), p.y / (projInfo.y * p.z));
    return ndc * 0.5 + 0.5;
}

/// Interleaved gradient noise.
fn ignPost(p: vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

/// Rec.709 luminance.
fn lumaPost(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

/// Karis' tonemap/inverse pair.
fn tonemapWeight(c: vec3f) -> vec3f {
    return c / (1.0 + lumaPost(c));
}

fn tonemapUnweight(c: vec3f) -> vec3f {
    return c / max(1e-4, 1.0 - lumaPost(c));
}
```

## 2.1 Constants

| Identifier | Value | Units | Meaning |
|---|---|---|---|
| `POST_FAR` | `9000.0` | metres | Prepass clear depth. Must equal `DEPTH_FAR` in the prepass. |
| background test | `z > POST_FAR * 0.5` = `z > 4500` | metres | Sky / nothing-written test. |
| IGN magic | `52.9829189` | — | Interleaved gradient noise scale. |
| IGN dot vector | `(0.06711056, 0.00583715)` | — | IGN frequency pair. |
| Rec.709 luma | `(0.2126, 0.7152, 0.0722)` | — | Used by `lumaPost` and by `agxLook`. |
| Karis floor | `1e-4` | — | Guard in `tonemapUnweight`. |

## 2.2 The coordinate agreement (derived once, must not be re-derived)

The reference states the agreement explicitly, because getting it wrong is silent — a
vertically mirrored depth lookup still produces plausible-looking occlusion, it is just
occlusion belonging to a different part of the frame.

* Babylon's WGSL processor multiplies `position.y` by an internal `yFactor` of −1 when the
  destination is a render target and compensates in the fragment stage when it is not. The
  net effect is that **`vUV` and `fragmentInputs.position.xy / renderSize` are the same
  number in every pass**, and both run bottom-up: `vUV.y == 1` is the top of the image.
* Therefore NDC y in the ordinary unflipped sense is `vUV.y * 2 - 1`, and a world point
  projected with the scene transform matrix lands at `ndc * 0.5 + 0.5` — **no flip
  anywhere**.
* **View space is left-handed with +z forward**, matching the camera. `viewFromDepth`
  builds `(ndc.x*projInfo.x, ndc.y*projInfo.y, 1.0) * z` with `z` a positive linear
  distance; `uvFromView` divides by `+p.z`.

`projInfo` is `(tan(fovY/2) * aspect, tan(fovY/2))`, so position reconstruction is one
multiply and needs no matrix. `z` is the linear view depth the prepass stored, which for a
perspective projection is the clip-space `w`.

The single invariant a port must preserve: **a world point projected with the same
(jittered) view-projection the beauty pass used must land at exactly the UV at which the
post chain samples `RT_scene` and `RT_prepass`.** If a flip is introduced anywhere, it must
be introduced in all four places (sun UV, reprojection, depth sampling, colour sampling) or
none.

## 2.3 The Karis weight pair

`tonemapWeight(c) = c / (1 + luma(c))` and `tonemapUnweight(c) = c / max(1e-4, 1 - luma(c))`
are an exact inverse pair. Averaging HDR samples with a linear weight lets one 200-nit
firefly dominate sixteen taps of ordinary snow; averaging in this compressed space and
expanding afterwards keeps the mean where the eye expects it. **Used by the temporal
resolve (§3) and the bloom prefilter (§7).** Both uses are mandatory on this content —
the snow emits discrete single-pixel glints by design.

---

# 3. TAA — `taa.fragment.wgsl` + the jitter in `postChain.js`

## 3.1 Why depth-based reprojection, not motion vectors

The reference's stated trade: almost everything on screen is static world geometry, so the
camera's own motion accounts for essentially all the parallax; the character, the wake and
the spray are small, fast and high-contrast, which is exactly the case the neighbourhood
clip rejects history for anyway. A motion-vector buffer would be a second full-screen
target and a velocity output in five vertex programs, to improve the one part of the frame
that already refuses history. **The port should not add motion vectors** — it changes the
ghosting signature the rest of the chain is tuned against.

## 3.2 Halton(2,3) jitter — generation

Eight subpixel positions, low-discrepancy so the accumulated sample pattern is even at
every prefix length rather than only after all eight — which matters because the history is
continuously being partially rejected and rarely gets a clean run of eight.

```js
const JITTER = buildHalton(8);

function buildHalton(n) {
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
        out[i * 2]     = radical(i + 1, 2) - 0.5;   // note: i+1, so the sequence starts at index 1
        out[i * 2 + 1] = radical(i + 1, 3) - 0.5;
    }
    return out;
}

function radical(i, base) {
    let f = 1, r = 0, k = i;
    while (k > 0) { f /= base; r += f * (k % base); k = Math.floor(k / base); }
    return r;
}
```

Range is **[-0.5, +0.5]** in **pixels**. The eight pairs, computed from the above (the port
may hard-code these):

| frame index | jx (px) | jy (px) |
|---|---|---|
| 0 | `+0.0` | `-0.16666667` |
| 1 | `-0.25` | `+0.16666667` |
| 2 | `+0.25` | `-0.38888889` |
| 3 | `-0.375` | `-0.05555556` |
| 4 | `+0.125` | `+0.27777778` |
| 5 | `-0.125` | `-0.27777778` |
| 6 | `+0.375` | `+0.05555556` |
| 7 | `-0.4375` | `+0.38888889` |

## 3.3 Halton jitter — written into the projection and FROZEN

Per frame, in `PostChain.update(dt, streak, focus)`, in this exact order:

```js
// 1. unjittered matrices, for reprojection and for the sun
cam.unfreezeProjectionMatrix();
_view.copyFrom(cam.getViewMatrix(true));
_proj.copyFrom(cam.getProjectionMatrix(true));
_view.multiplyToRef(_proj, this._curViewProj);   // UNJITTERED view-projection, this frame
_view.invertToRef(this._invView);                // view -> world

const tanHalf = Math.tan(cam.fov * 0.5);
this._projInfo.set(tanHalf * (w / h), tanHalf);

// ... sun projection, bloom knee (see §5, §7) ...

// 2. jitter
let jx = 0, jy = 0;
if (S.taa) {
    const idx = (this._frame % (JITTER.length >> 1)) * 2;   // JITTER.length >> 1 == 8
    jx = JITTER[idx];
    jy = JITTER[idx + 1];
}
this._jitterNdc.set((2 * jx) / w, (2 * jy) / h);

const pm = cam.getProjectionMatrix();
pm.m[8] += this._jitterNdc.x;
pm.m[9] += this._jitterNdc.y;
pm.markAsUpdated();
cam.freezeProjectionMatrix();    // nothing may recompute this for the rest of the frame

// 3. history ping-pong
this._k = 1 - this._k;
this.shafts._forcedOutputTexture = this.history[this._k].renderTarget;

this._frame++;
```

Key facts:

* `jitterNdc = (2*jx/w, 2*jy/h)` — pixels converted to NDC (NDC spans 2 units across `w`
  pixels).
* `pm.m[8]` and `pm.m[9]` are the two matrix elements that **shear clip x and y by w**. In
  Babylon's row-vector convention `clip.w = view.z` for a left-handed perspective
  projection, so `clip.x += jitterNdc.x * w` ⇒ **the projected point moves +jitterNdc.x in
  NDC**. Same for y. That is the sign the TAA shader's reprojection assumes.
* `freezeProjectionMatrix()` after the write is not decoration. **The depth prepass and the
  beauty pass both read `scene.getTransformMatrix()`**, so both must get the identical
  jittered matrix. If anything recomputes the projection mid-frame, the resolve integrates
  two different samplings of the same surface.
* When `S.taa` is false, jitter is **zero** but the pass still runs (it early-outs to a
  copy).
* The ping-pong flip happens at the end of `update()`, **before** `scene.render()`. So
  during the frame: `history[k]` is this frame's destination (taa writes it via the
  `shafts` forced target; bloomA and dof read it after taa has written it), and
  `history[1-k]` is last frame's resolved image (taa's `historyTex`).

`endFrame()`, called after `scene.render()`:

```js
this._prevViewProj.copyFrom(this._curViewProj);
if (this._historyValid < 1) this._historyValid += 0.5;
```

`historyValid` ramps `0 → 0.5 → 1.0`. *"Two frames of grace: the first fills history[0],
the second history[1], and only then is there something at `1 - k` worth reading."* The
shader gates on `historyValid < 0.5`.

`resetHistory()` sets `_historyValid = 0` — used after a teleport or a resolution change.
The engine resize observer also resizes both history textures and zeroes `_historyValid`,
*"the reprojection would be against a differently-shaped frustum and the history against a
differently-sized buffer."*

## 3.4 The five-tap Catmull-Rom history fetch (verbatim)

This is described in the reference as *"the single largest quality decision in this file,
and it is not about aliasing at all — it is about accumulated blur."* History is resampled
at a fractional offset every frame and each resample feeds the next, so a bilinear tap does
not soften the image once, it convolves it with a tent kernel again and again. Standing
still at 0.9 feedback that is roughly ten applications, and the result is visibly softer
than the frame the renderer produced — on a field whose entire detail budget is
subpixel-scale, the difference between snow and a grey slope. The bicubic's negative lobes
undo most of that. Five bilinear taps instead of sixteen point fetches, by folding each pair
of weights into one offset tap.

```wgsl
fn historyCatmullRom(uv: vec2f, texSize: vec2f) -> vec3f {
    let samplePos = uv * texSize;
    let texPos1 = floor(samplePos - 0.5) + 0.5;
    let f = samplePos - texPos1;

    let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    let w3 = f * f * (-0.5 + 0.5 * f);

    let w12 = w1 + w2;
    let off12 = w2 / w12;

    let p0  = (texPos1 - 1.0) / texSize;
    let p3  = (texPos1 + 2.0) / texSize;
    let p12 = (texPos1 + off12) / texSize;

    var acc = vec3f(0.0);
    acc += textureSampleLevel(historyTex, historyTexSampler, vec2f(p12.x, p0.y),  0.0).rgb
         * (w12.x * w0.y);
    acc += textureSampleLevel(historyTex, historyTexSampler, vec2f(p0.x,  p12.y), 0.0).rgb
         * (w0.x  * w12.y);
    acc += textureSampleLevel(historyTex, historyTexSampler, vec2f(p12.x, p12.y), 0.0).rgb
         * (w12.x * w12.y);
    acc += textureSampleLevel(historyTex, historyTexSampler, vec2f(p3.x,  p12.y), 0.0).rgb
         * (w3.x  * w12.y);
    acc += textureSampleLevel(historyTex, historyTexSampler, vec2f(p12.x, p3.y),  0.0).rgb
         * (w12.x * w3.y);

    // The negative lobes can undershoot past zero on a hard edge, and a negative
    // radiance survives the clip below as a black fringe.
    return max(acc, vec3f(0.0));
}
```

Expanded weight polynomials (`f` is the per-axis fractional offset in [0,1)):

```
w0 = -0.5 f + 1.0 f^2 - 0.5 f^3
w1 =  1.0      - 2.5 f^2 + 1.5 f^3
w2 =  0.5 f + 2.0 f^2 - 1.5 f^3
w3 =            -0.5 f^2 + 0.5 f^3
```

Tap table — five taps, exactly these five, in this order:

| # | u coordinate | v coordinate | weight |
|---|---|---|---|
| 1 | `p12.x` | `p0.y` | `w12.x * w0.y` |
| 2 | `p0.x` | `p12.y` | `w0.x * w12.y` |
| 3 | `p12.x` | `p12.y` | `w12.x * w12.y` |
| 4 | `p3.x` | `p12.y` | `w3.x * w12.y` |
| 5 | `p12.x` | `p3.y` | `w12.x * w3.y` |

**Do not normalise the weight sum.** The reference does not. The four corner terms
(`w0.x*w0.y`, `w3.x*w3.y`, `w0.x*w3.y`, `w3.x*w0.y`) are dropped and no compensating divide
is applied, so the weights sum to `w12.x + w12.y − w12.x·w12.y`, which is exactly 1.0 at
zero fractional offset and ≈ 0.984 at a half-texel offset in both axes. A port that
normalises will produce a slightly brighter, slightly different-contrast history and will
not match.

`texSize` is passed as `1.0 / uniforms.invRes` — i.e. the **full render resolution in
pixels**.

## 3.5 The resolve, step by step (verbatim body)

```wgsl
fn resolve(uv: vec2f) -> vec3f {
    let cur = textureSampleLevel(textureSampler, textureSamplerSampler, uv, 0.0).rgb;

    if (uniforms.enabled < 0.5 || uniforms.historyValid < 0.5) { return cur; }

    // ---- reprojection ----
    let z = textureSampleLevel(depthTex, depthTexSampler, uv, 0.0).r;
    let ndc = uv * 2.0 - 1.0 - uniforms.jitterNdc;
    let view = vec3f(ndc.x * uniforms.projInfo.x, ndc.y * uniforms.projInfo.y, 1.0)
             * min(z, POST_FAR);
    let world = uniforms.invView * vec4f(view, 1.0);

    let prevClip = uniforms.prevViewProj * vec4f(world.xyz, 1.0);
    if (prevClip.w <= 1e-4) { return cur; }

    let prevUV = (prevClip.xy / prevClip.w) * 0.5 + 0.5;

    // Off the edge of last frame is a disocclusion by definition.
    if (any(prevUV < vec2f(0.0)) || any(prevUV > vec2f(1.0))) { return cur; }

    // ---- neighbourhood statistics ----
    var m1 = vec3f(0.0);
    var m2 = vec3f(0.0);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let s = tonemapWeight(textureSampleLevel(
                textureSampler, textureSamplerSampler,
                uv + vec2f(f32(i), f32(j)) * uniforms.invRes, 0.0
            ).rgb);
            m1 += s;
            m2 += s * s;
        }
    }
    let mu = m1 / 9.0;
    let sigma = sqrt(max(vec3f(0.0), m2 / 9.0 - mu * mu));
    let lo = mu - sigma * 1.35;
    let hi = mu + sigma * 1.35;

    var raw = tonemapWeight(historyCatmullRom(prevUV, 1.0 / uniforms.invRes));
    if (any(raw != raw)) { raw = mu; }          // NaN survives a clamp
    let hist = clamp(raw, lo, hi);

    let curW = tonemapWeight(cur);

    // ---- feedback ----
    let motion = length((prevUV - uv) / uniforms.invRes);       // pixels travelled
    let motionFade = 1.0 - clamp(motion / 64.0, 0.0, 1.0) * 0.35;
    let clipFade   = 1.0 - clamp(length(hist - raw) * 4.0, 0.0, 1.0) * 0.45;

    let k = clamp(uniforms.feedback * motionFade * clipFade, 0.0, 0.97);
    return tonemapUnweight(mix(curW, hist, k));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    fragmentOutputs.color = vec4f(resolve(input.vUV), 1.0);
}
```

Annotations, each load-bearing:

1. **The jitter is removed before reconstruction.** `ndc = uv*2-1 - jitterNdc`. The depth
   stored in the prepass was rasterised through the *jittered* projection, so the ray this
   pixel actually looked along is the jittered one. The reference: *"at 0.5 px it is the
   difference between history that lands on the same surface and history that lands on the
   far side of a berm crest."*
2. **`min(z, POST_FAR)`** clamps sky pixels to 9000 m so they reproject through a finite
   point rather than infinity.
3. **`prevViewProj` is the UNJITTERED matrix of the previous frame.** Reprojecting with a
   jittered matrix would introduce last frame's jitter into this frame's history lookup.
4. **`prevClip.w <= 1e-4`** rejects points that were behind last frame's camera.
5. **Off-screen `prevUV` is a disocclusion by definition** — return `cur` unblended.
6. **Variance clipping, not a min/max box.** Reference rationale: a box built from nine taps
   of a field that *contains* discrete glints is enormous — one lit crystal in the corner of
   the neighbourhood opens the box wide enough to admit any ghost at all, which is the
   failure that makes naive TAA smear moving objects across the frame. Clipping to the local
   distribution instead tracks the surface and ignores the outlier.
7. **Statistics are gathered in Karis-weighted space** (`tonemapWeight` applied to each of
   the nine taps), and the history is compared in the same space. The Catmull-Rom fetch
   itself runs in **linear HDR**, and `tonemapWeight` is applied to its result.
8. **`clamp`, not a ray-box clip.** The reference clamps component-wise to `[mu − 1.35σ, mu
   + 1.35σ]`.
9. **NaN guard** (`any(raw != raw)`) is the second line of defence after `historyValid`,
   because a NaN survives a clamp and would propagate for the rest of the session.
10. **Two things pull feedback down**: fast screen-space motion (a long reprojection is a
    poor prediction and the resampling blur compounds every frame it is kept), and a history
    that had to be clipped hard (the signal that this pixel is not the same surface it was).

### 3.5.1 TAA numeric constants

| Identifier / expression | Value | Units | Effect |
|---|---|---|---|
| `feedback` (uniform, set on CPU) | `0.90` | fraction | History kept at rest. |
| variance width | `1.35` | σ | Clip half-width in standard deviations. |
| neighbourhood | `3 × 3` = 9 taps | pixels | 1-texel spacing (`invRes`). |
| motion normaliser | `64.0` | pixels | Screen distance at which motion fade saturates. |
| motion fade depth | `0.35` | fraction | Max feedback reduction from motion (min factor 0.65). |
| clip-distance gain | `4.0` | 1/units | Scales `length(hist − raw)` into the clip fade ramp. |
| clip fade depth | `0.45` | fraction | Max feedback reduction from clipping (min factor 0.55). |
| feedback ceiling | `0.97` | fraction | Hard clamp on `k`. |
| `prevClip.w` reject | `1e-4` | — | Behind-camera test. |
| history-valid gate | `< 0.5` | — | First two frames pass through. |
| `historyValid` step | `+0.5` per frame, capped at 1 | — | Two frames of grace. |

Effective feedback range: **min 0.90 × 0.65 × 0.55 = 0.32175**, **max 0.90**.

---

# 4. SSR — `ssr.fragment.wgsl`

## 4.1 What it is for, and why it is gated

A snow field is a rough dielectric with a 0.028 F0 — there is nothing to reflect off it
that the sky lookup in the material does not already give exactly. The one genuinely
specular surface is what Crystallise leaves behind: hexagonal prisms at roughness 0.07, and
the glaze they write into the terrain state buffer's ice channel. So the pass is **gated on
the prepass mask**, and the mask is non-zero on precisely those pixels. On every frame where
nobody has cast Crystallise it costs one texture fetch and a branch — which is why it can
afford to march at full resolution when it does fire.

What it buys: the ice already reflects the *sky* correctly and cheaply. What it cannot know
analytically is that there is a dune, a trench, or the character standing in the direction
it is reflecting. That is the entire content of this pass.

## 4.2 Gate and entry (verbatim)

```wgsl
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = input.vUV;
    let src = textureSampleLevel(textureSampler, textureSamplerSampler, uv, 0.0);
    let g   = textureSampleLevel(depthTex, depthTexSampler, uv, 0.0);

    var outCol = src.rgb;
    if (uniforms.enabled > 0.5 && g.g >= 0.02 && !isBackground(g.r)) {
        let r = reflectionAt(uv, input.position.xy, g.r, g.g);
        if (r.w > 0.0) { outCol = mix(src.rgb, r.rgb, r.w); }
    }

    fragmentOutputs.color = vec4f(outCol, src.a);
}
```

* `g.r` = linear view depth (metres). `g.g` = specular mask.
* **Mask threshold `0.02`.** Below that the pixel is matte snow and the pass does nothing.
* Alpha is passed through from the source.

## 4.3 The march (verbatim)

```wgsl
const STEPS: i32 = 28;
const REFINE: i32 = 5;
const THICKNESS: f32 = 0.55;

fn reflectionAt(uv: vec2f, pix: vec2f, z: f32, mask: f32) -> vec4f {
    let miss = vec4f(0.0, 0.0, 0.0, -1.0);

    let P = viewFromDepth(uv, z, uniforms.projInfo);

    // Facet normal from the depth buffer.
    let e = uniforms.invRes;
    let zr = textureSampleLevel(depthTex, depthTexSampler, uv + vec2f(e.x, 0.0), 0.0).r;
    let zu = textureSampleLevel(depthTex, depthTexSampler, uv + vec2f(0.0, e.y), 0.0).r;
    if (isBackground(zr) || isBackground(zu)) { return miss; }

    let dx = viewFromDepth(uv + vec2f(e.x, 0.0), zr, uniforms.projInfo) - P;
    let dy = viewFromDepth(uv + vec2f(0.0, e.y), zu, uniforms.projInfo) - P;
    let N = normalize(cross(dx, dy));

    let V = normalize(P);            // the camera sits at the view-space origin
    let R = reflect(V, N);
    if (R.z < 0.02) { return miss; } // a ray heading back toward the eye finds nothing

    let stride = max(0.06, z * 0.035);
    var t = stride * (0.5 + ignPost(pix));
    var prevT = 0.0;
    var hitT = -1.0;

    for (var i = 0; i < STEPS; i++) {
        let Q = P + R * t;
        let sUV = uvFromView(Q, uniforms.projInfo);
        if (any(sUV < vec2f(0.0)) || any(sUV > vec2f(1.0))) { break; }

        let sz = textureSampleLevel(depthTex, depthTexSampler, sUV, 0.0).r;
        let diff = Q.z - sz;
        if (diff > 0.0 && diff < THICKNESS) {
            var lo = prevT;
            var hi = t;
            for (var k = 0; k < REFINE; k++) {
                let mid = (lo + hi) * 0.5;
                let M = P + R * mid;
                let mz = textureSampleLevel(
                    depthTex, depthTexSampler, uvFromView(M, uniforms.projInfo), 0.0
                ).r;
                if (M.z - mz > 0.0) { hi = mid; } else { lo = mid; }
            }
            hitT = hi;
            break;
        }
        prevT = t;
        t += stride * (1.0 + f32(i) * 0.16);   // geometric growth
    }

    if (hitT < 0.0) { return miss; }

    let hitUV = uvFromView(P + R * hitT, uniforms.projInfo);

    let edge = min(min(hitUV.x, 1.0 - hitUV.x), min(hitUV.y, 1.0 - hitUV.y));
    let edgeFade = smoothstep(0.0, 0.10, edge);

    let f = 0.045 + 0.955 * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 5.0);

    let refl = textureSampleLevel(textureSampler, textureSamplerSampler, hitUV, 0.0).rgb;
    return vec4f(refl, clamp(mask * f * edgeFade * uniforms.strength, 0.0, 1.0));
}
```

## 4.4 SSR constants

| Identifier | Value | Units | Meaning |
|---|---|---|---|
| `STEPS` | `28` | — | Coarse march steps. |
| `REFINE` | `5` | — | Binary-search refine iterations on the hit. |
| `THICKNESS` | `0.55` | metres | Assumed depth-buffer thickness. Too small and reflections dropped by grazing rays flicker; too large and the ray "hits" the sky behind a dune. |
| mask gate | `0.02` | — | Minimum prepass `.g` to run the pass. |
| `R.z` reject | `0.02` | view-space z | Rays heading back toward the eye. |
| stride floor | `0.06` | metres | Minimum step length. |
| stride scale | `0.035` | metres per metre of depth | `stride = max(0.06, z*0.035)` — roughly one pixel per step near the surface. |
| jitter offset | `0.5 + ignPost(pix)` | steps | First-step dither; breaks the banding a fixed step leaves on a flat facet. |
| step growth | `0.16` per iteration | — | `t += stride * (1 + i*0.16)`. |
| edge fade width | `0.10` | UV | `smoothstep(0, 0.10, edge)`. |
| Schlick F0 | `0.045` | — | Ice F0. |
| Schlick complement | `0.955` | — | `1 − F0`. |
| Schlick exponent | `5.0` | — | Standard. |
| `strength` (uniform) | `1.0` | — | Hard-coded on the CPU side, not exposed in the overlay. |

## 4.5 Sign convention warning for the port (read before "fixing" anything)

Under the stated convention (left-handed view space, +z forward; `vUV.y` increasing upward),
`dx` points +x and `dy` points +y for a camera-facing surface, so `cross(dx, dy)` yields
**+z — the normal pointing away from the camera**, i.e. the negated geometric normal.

Two consequences, both of which the port must reproduce rather than correct:

* `reflect(I, N)` is invariant under `N → −N` (`I − 2·dot(N,I)·N` is unchanged), so **`R`
  is geometrically correct** and the march is correct.
* `dot(-V, N)` is therefore ≤ 0 on front-facing geometry, and `clamp(..., 0, 1)` drives it
  to 0, so the Schlick term evaluates to **`f = 0.045 + 0.955 = 1.0`** wherever the march
  reaches. The effective blend weight is `clamp(mask · edgeFade · strength, 0, 1)`.

That is the shipped behaviour and it is what the reference screenshots show: where an ice
prism's march finds geometry, the reflection **replaces** the shaded colour almost entirely
(modulated only by the ice mask and the screen-edge fade), it is not a subtle
Fresnel-weighted blend. If the port computes an outward normal instead, it will produce a
near-invisible reflection at face-on angles and will not match. Reproduce the expression as
written.

---

# 5. Volumetric light shafts — `shafts.fragment.wgsl`

## 5.1 Concept

At a 13° sun every dune crest in the frame is a horizon-line occluder with the sun sitting
just above it — the geometry that produces shafts. The same effect at a midday sun would be
invisible, and the pass is written so that it **switches itself off there**: the weight falls
with the sun's screen distance and vanishes once the sun leaves the frustum.

Occlusion comes from the depth prepass rather than a separate occlusion render: a pixel
where the prepass wrote nothing is sky, and sky is where the beam gets through. That makes
this a **radial integral of sky visibility**, one texture fetch per step, no extra geometry
pass. Runs at **quarter resolution** — shafts are the lowest-frequency thing in the frame by
an order of magnitude, and the composite reads this back bilinearly.

## 5.2 The march (verbatim)

```wgsl
const STEPS: i32 = 24;
const REACH: f32 = 0.82;
const DECAY: f32 = 0.955;

fn marchShaft(uv: vec2f, pix: vec2f, radial: f32) -> f32 {
    let delta = (uniforms.sunUV - uv) * (REACH / f32(STEPS));

    // Dither the start, or twenty-four steps quantise into visible rings around
    // the sun. The temporal resolve has already run by this point, so the noise
    // has to be broken up spatially rather than accumulated away — hence a fixed
    // hash rather than a per-frame one.
    var p = uv + delta * ignPost(pix);

    var illum = 1.0;
    var acc = 0.0;
    for (var i = 0; i < STEPS; i++) {
        let z = textureSampleLevel(depthTex, depthTexSampler, p, 0.0).r;
        acc += select(0.0, illum, isBackground(z));
        illum *= DECAY;
        p += delta;
    }
    acc /= f32(STEPS);

    return acc * acc * radial * uniforms.strength;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = input.vUV;

    let d = (uv - uniforms.sunUV) * vec2f(uniforms.aspect, 1.0);
    let radial = 1.0 - smoothstep(0.03, 0.68, length(d));

    var v = 0.0;
    if (uniforms.enabled > 0.5 && uniforms.sunOnScreen > 0.5 && radial > 0.001) {
        v = marchShaft(uv, input.position.xy, radial);
    }

    fragmentOutputs.color = vec4f(uniforms.sunColor * v, 1.0);
}
```

* `select(0.0, illum, cond)` in WGSL is `cond ? illum : 0.0` (WGSL's argument order is
  `select(false_value, true_value, condition)`). In GLSL: `acc += isBackground(z) ? illum :
  0.0;`.
* **`acc*acc` — squared on purpose.** A beam that is half occluded reads as clearly dimmer
  than one that is not. Linear accumulation makes every crest emit the same haze and the
  shafts lose their shape.
* **`REACH = 0.82` is short of 1.0 on purpose**: the shaft should read as light spilling
  *past* a crest, not as a star filter.
* `input.position.xy` here is the **quarter-resolution** fragment coordinate, so the IGN
  dither pattern is at quarter-res scale.
* Output is `sunColor * v` in **scene radiance units** (pre-exposure). The composite adds it
  before the exposure multiply.

## 5.3 Shafts constants

| Identifier | Value | Units | Meaning |
|---|---|---|---|
| `STEPS` | `24` | — | March steps toward the sun. |
| `REACH` | `0.82` | fraction of the uv-distance to the sun | March length. |
| `DECAY` | `0.955` | per step | Attenuation; total after 24 steps = 0.955²³ ≈ 0.345. |
| radial inner | `0.03` | aspect-corrected UV | `smoothstep` start. |
| radial outer | `0.68` | aspect-corrected UV | `smoothstep` end — beyond this, zero. |
| radial skip gate | `0.001` | — | Below this the march is skipped entirely. |
| `sunOnScreen` gate | `> 0.5` | — | Binary, set on the CPU. |
| `strength` | `S.shaftStrength`, default `0.30`, range `0…2`, step `0.01` | — | Overlay slider. |
| `aspect` | `renderWidth / renderHeight` | — | Makes the angular falloff round on screen, not elliptical. |

## 5.4 The sun on screen (CPU side, `postChain.update`)

```js
_sunWorld.copyFrom(this.sky.sunDir).scaleInPlace(2000).addInPlace(cam.position);
Vector3.TransformCoordinatesToRef(_sunWorld, this._curViewProj, _sunClip);
// TransformCoordinates divides by w internally, so a point behind the camera comes back
// mirrored rather than flagged. The dot product against the view direction is the only
// honest test.
const fwdDot = Vector3.Dot(this.sky.sunDir, _camForward(cam));
this._sunUV.set(_sunClip.x * 0.5 + 0.5, _sunClip.y * 0.5 + 0.5);
this._sunOnScreen = fwdDot > 0.05 ? 1 : 0;
this._sunColor.copyFrom(this.sky.sunRadiance);
```

with

```js
function _camForward(cam) {
    const m = cam.getViewMatrix().m;
    // Third column of the view matrix is the world-space view direction.
    return _fwdScratch.set(m[2], m[6], m[10]);
}
```

| Identifier | Value | Units | Meaning |
|---|---|---|---|
| sun proxy distance | `2000` | metres | Point placed along `sunDir` from the camera and projected. |
| `sunOnScreen` threshold | `0.05` | cosine | `dot(sunDir, camForward) > 0.05`. No smoothing — *"the radial weight has already faded to nothing long before the sun reaches the frustum edge, so there is nothing to pop."* |
| projection matrix used | `_curViewProj` (**unjittered**) | — | Same matrix used for reprojection. |

`sky.sunRadiance` for reference (so the port can reproduce absolute magnitudes): it is
`(r,g,b) × sunScale` where `sunScale = S.sunIntensity × 5.5` and `r,g,b =
exp(−(τ_R·warm + τ_M) · airMass)` with `τ_R = [0.0464, 0.108, 0.265]`, `τ_M = 0.0252`, and
Kasten–Young air mass. At the defaults (`sunIntensity 4.2`, `sunElevation 13°`,
`sunTempWarm 1.0`) that evaluates to approximately `(17.0, 13.0, 6.6)`.

---

# 6. Bloom — three levels

## 6.1 Level structure

| Level | Pass | Renders at | Source | Kernel | Prefilter |
|---|---|---|---|---|---|
| 0 | `bloomA` (`snowBloomDown`) | quarter | `RT_history[k]`, full res, bound explicitly | 13-tap Jimenez | **yes** (Karis + bright pass) |
| 1 | `bloomB` (`snowBloomDown`) | sixteenth | level 0 (quarter) | 13-tap Jimenez | no |
| 2 | `bloomC` (`snowBloomBlur`) | sixteenth | level 1 (sixteenth) | 9-tap tent | n/a |

The composite reads level 0 as `bloomNear` and level 2 as `bloomFar`. Level 1 is an
intermediate only.

## 6.2 Tap spacing — the "twice a texel" rule

```js
this.bloomA.onApply = (e) => {
    e.setFloat2("srcTexel", this._invRes.x * 2, this._invRes.y * 2);
    e.setFloat("prefilter", 1);
    e.setFloat4("curve", c.x, c.y, c.z, c.w);
    e.setTexture("sourceTex", this.history[this._k]);
};

this.bloomB.onApply = (e) => {
    const t = _texelOf(this.bloomA, _tmpTexel);   // one texel of bloomA's OUTPUT, in UV
    e.setFloat2("srcTexel", t.x * 2, t.y * 2);
    e.setFloat("prefilter", 0);
    e.setFloat4("curve", 0, 0, 0, 0);
    e.setTextureFromPostProcessOutput("sourceTex", this.bloomA);
};

this.bloomC.onApply = (e) => {
    const t = _texelOf(this.bloomB, _tmpTexel);
    e.setFloat2("srcTexel", t.x * 2.0, t.y * 2.0);
};
```

The reference's rationale, which the port must honour because it is the difference between
a stable bloom and a seething one:

> The tap spacing is *twice* a source texel, not one. Each of these levels is a 4× reduction,
> so one destination pixel covers a 4×4 block of the source; a thirteen-tap kernel spaced at
> one texel only reaches half of it, and the half it misses aliases straight into the glow.
> On a field that emits discrete single-pixel glints by design, that shows up as a bloom that
> seethes.

For `bloomC`: *"Spread wider than one texel: this is the level that has to read as haze in
the air rather than as a ring around the sun."*

Port formula: **`srcTexel = 2.0 / sourceTextureSize`** for all three, where
`sourceTextureSize` is the resolution of the texture that pass is *reading*
(full for bloomA, quarter for bloomB, sixteenth for bloomC).

## 6.3 `bloomDown.fragment.wgsl` (verbatim)

Thirteen-tap kernel from Jimenez' Call of Duty presentation: a centre box plus four corner
boxes, which behaves like a proper low-pass at a 2× reduction and does not fall apart at 4×
the way a naive bilinear chain does.

```wgsl
uniform srcTexel: vec2f;   // one texel of the SOURCE, in UV (already ×2, see above)
uniform prefilter: f32;    // 1 on the first level: threshold and Karis-average. 0 on the rest.
uniform curve: vec4f;      // (threshold, threshold - knee, 2*knee, 0.25/knee)

fn tap(uv: vec2f) -> vec3f {
    return textureSampleLevel(sourceTex, sourceTexSampler, uv, 0.0).rgb;
}

/// Soft-knee threshold. A hard cut puts a visible contour through any smooth
/// gradient that crosses it, and on a snow field almost every gradient does.
fn brightPass(c: vec3f, curve: vec4f) -> vec3f {
    let br = max(c.r, max(c.g, c.b));
    let rq = clamp(br - curve.y, 0.0, curve.z);
    let soft = rq * rq * curve.w;
    return c * max(soft, br - curve.x) / max(br, 1e-5);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = input.vUV;
    let t = uniforms.srcTexel;

    // Inner 2x2 box (weight 0.5 total) ...
    let a = tap(uv + vec2f(-t.x, -t.y));
    let b = tap(uv + vec2f( t.x, -t.y));
    let c = tap(uv + vec2f(-t.x,  t.y));
    let d = tap(uv + vec2f( t.x,  t.y));

    // ... and the four overlapping outer boxes (weight 0.125 each).
    let e = tap(uv + vec2f(-2.0 * t.x, -2.0 * t.y));
    let f = tap(uv + vec2f( 0.0,       -2.0 * t.y));
    let g = tap(uv + vec2f( 2.0 * t.x, -2.0 * t.y));
    let h = tap(uv + vec2f(-2.0 * t.x,  0.0));
    let i = tap(uv);
    let j = tap(uv + vec2f( 2.0 * t.x,  0.0));
    let k = tap(uv + vec2f(-2.0 * t.x,  2.0 * t.y));
    let l = tap(uv + vec2f( 0.0,        2.0 * t.y));
    let m = tap(uv + vec2f( 2.0 * t.x,  2.0 * t.y));

    var g0 = (a + b + c + d) * 0.25;
    var g1 = (e + f + h + i) * 0.25;
    var g2 = (f + g + i + j) * 0.25;
    var g3 = (h + i + k + l) * 0.25;
    var g4 = (i + j + l + m) * 0.25;

    var outCol: vec3f;
    if (uniforms.prefilter > 0.5) {
        let w0 = 1.0 / (1.0 + lumaPost(g0));
        let w1 = 1.0 / (1.0 + lumaPost(g1));
        let w2 = 1.0 / (1.0 + lumaPost(g2));
        let w3 = 1.0 / (1.0 + lumaPost(g3));
        let w4 = 1.0 / (1.0 + lumaPost(g4));
        let wsum = w0 * 0.5 + (w1 + w2 + w3 + w4) * 0.125;
        outCol = (g0 * w0 * 0.5 + (g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) * 0.125)
               / max(wsum, 1e-5);
        outCol = brightPass(outCol, uniforms.curve);
    } else {
        outCol = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
    }

    fragmentOutputs.color = vec4f(outCol, 1.0);
}
```

**Tap positions**, expressed in units of `srcTexel`:

| name | offset (×`t`) | group membership |
|---|---|---|
| `a` | `(-1, -1)` | g0 |
| `b` | `(+1, -1)` | g0 |
| `c` | `(-1, +1)` | g0 |
| `d` | `(+1, +1)` | g0 |
| `e` | `(-2, -2)` | g1 |
| `f` | `( 0, -2)` | g1, g2 |
| `g` | `(+2, -2)` | g2 |
| `h` | `(-2,  0)` | g1, g3 |
| `i` | `( 0,  0)` | g1, g2, g3, g4 |
| `j` | `(+2,  0)` | g2, g4 |
| `k` | `(-2, +2)` | g3 |
| `l` | `( 0, +2)` | g3, g4 |
| `m` | `(+2, +2)` | g4 |

Group weights: **g0 = 0.5**, **g1..g4 = 0.125 each**. Each group is the mean of its four
taps (`× 0.25`).

**Karis average** (prefilter level only): weight each of the five *groups* by
`1/(1+luma(group))` before combining, then divide by the weighted sum, then threshold once.
Reference rationale: *"The snow material emits discrete glints — single pixels at many times
the surrounding radiance, by design — and a plain mean of a 2×2 group lets one of them
dominate the whole group. The result is a bloom that flickers as the glint field turns over,
which is precisely the 'crawling sparkle' the acceptance criteria rule out, arriving by the
back door after TAA has already stabilised the glints themselves."*

## 6.4 `bloomBlur.fragment.wgsl` (verbatim) — the tent

Nine-tap tent blur at the bottom of the chain. A tent rather than a box because the
composite samples this bilinearly at sixteen times the resolution, and a box's flat top makes
the upsample's own linear interpolation visible as facets.

```wgsl
uniform srcTexel: vec2f;   // one texel of the source, in UV, times the desired spread

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = input.vUV;
    let t = uniforms.srcTexel;

    var c = tap(uv + vec2f(-t.x,  t.y)) * 1.0;
    c += tap(uv + vec2f( 0.0,   t.y)) * 2.0;
    c += tap(uv + vec2f( t.x,   t.y)) * 1.0;
    c += tap(uv + vec2f(-t.x,   0.0)) * 2.0;
    c += tap(uv)                      * 4.0;
    c += tap(uv + vec2f( t.x,   0.0)) * 2.0;
    c += tap(uv + vec2f(-t.x,  -t.y)) * 1.0;
    c += tap(uv + vec2f( 0.0,  -t.y)) * 2.0;
    c += tap(uv + vec2f( t.x,  -t.y)) * 1.0;

    fragmentOutputs.color = vec4f(c * (1.0 / 16.0), 1.0);
}
```

Weights `[1,2,1; 2,4,2; 1,2,1] / 16`. Source is `textureSampler` (the chain input), not
`sourceTex`.

## 6.5 The bloom knee, computed on the CPU (`postChain.update`)

```js
const th = 3.0;
const knee = 1.4;
this._bloomCurve.x = th;                        // 3.0
this._bloomCurve.y = th - knee;                 // 1.6
this._bloomCurve.z = knee * 2;                  // 2.8
this._bloomCurve.w = 0.25 / Math.max(knee, 1e-4); // 0.17857143
```

| Field | Expression | Value at defaults |
|---|---|---|
| `curve.x` | `threshold` | `3.0` |
| `curve.y` | `threshold − knee` | `1.6` |
| `curve.z` | `2 · knee` | `2.8` |
| `curve.w` | `0.25 / knee` | `0.178571428…` |

## 6.6 A discrepancy the port must be told about

The reference comment above this block reads:

> Threshold in exposed units, so it does not move when the exposure slider does. Sunlit snow
> here exposes to ~1.26, so anything near 1.0 puts the entire lit half of the frame above the
> knee and the bloom becomes a uniform milky veil. At 3.0 the field sits a stop and a half
> below it and only the sun disc, the glints and lit spray reach it.

**The data path does not multiply by exposure before the bright pass.** Verified this
session: `S.exposure` appears in exactly one shader — `tonemap.fragment.wgsl` line 177,
`c *= uniforms.exposure` — and `bloomA` binds `sourceTex = this.history[this._k]`, which
holds the TAA-resolved scene in raw radiance. So the shipped behaviour is:

> **The bright pass thresholds the raw, pre-exposure resolved scene at `threshold = 3.0`,
> `knee = 1.4`.**

That is the normative rule for the port. Two consequences to be aware of:

1. The threshold **does** stay fixed when the exposure slider moves — the comment's headline
   claim is true — but the number `3.0` is in scene-radiance units, not in exposed units.
2. Reproducing the reference look therefore requires reproducing the reference's absolute
   radiance scale (`sunScale = S.sunIntensity × 5.5`, §5.4). If the port's beauty pass emits
   radiance on a different scale, `threshold` and `knee` must be rescaled by the same factor,
   or a different fraction of the frame will pass the knee and the bloom will read as either
   a veil or as nothing.

I could not reconcile the comment's arithmetic (`~1.26` for sunlit snow) with the bound
buffer (raw radiance, stated elsewhere in the repo as `~12` linear for sunlit snow). The
code is quoted above; treat the code as authority and the comment as the author's stated
intent.

## 6.7 Bloom constants summary

| Identifier | Value | Units |
|---|---|---|
| `threshold` (`th`) | `3.0` | scene radiance |
| `knee` | `1.4` | scene radiance |
| inner-box group weight | `0.5` | — |
| outer-box group weight | `0.125` (×4) | — |
| group mean divisor | `0.25` | — |
| Karis group weight | `1/(1 + luma)` | — |
| `wsum` floor | `1e-5` | — |
| `brightPass` divide floor | `1e-5` | — |
| tent weights | `1,2,1,2,4,2,1,2,1` / `16` | — |
| tap spacing multiplier | `2.0` × source texel | UV |
| level 0 / level 1,2 ratios | `1/4` / `1/16` | linear |

---

# 7. Depth of field — `dof.fragment.wgsl`

## 7.1 The design position (why it is deliberately slight)

> The restraint is not timidity. This scene's depth cue is aerial perspective — contrast
> compression and a hue pull toward the sky — and that is a *physical* cue that survives at
> any focal length. A heavy defocus competes with it and wins, which trades a snow field
> that recedes for a snow field that is out of focus. What a light one adds is the last
> thing missing from the near field: the berm the camera is almost sitting on stops being as
> crisp as the ridge two hundred metres away, which is the read that makes a frame look
> photographed.

Sample weighting is by the **sample's own** circle of confusion, so a blurred background
cannot bleed onto a sharp foreground — the artefact that makes cheap DOF look like a smeared
decal around every silhouette.

## 7.2 Focal plane tracking the spring arm (CPU side)

```js
// PostChain.update(dt, streak, focus)   — main.js calls post.update(dt, character.streak01, rig.distance)
if (focus !== undefined) {
    // Eased: a focal plane that snaps when the spring arm re-lengthens is the one thing
    // a restrained depth of field can still make obvious.
    this.focusDist += (focus - this.focusDist) * Math.min(1, dt * 4.0);
}
```

| Identifier | Value | Units |
|---|---|---|
| `focusDist` initial | `6.2` | metres (matches `CameraRig.distance` initial) |
| ease rate | `4.0` | per second (`min(1, dt*4)` per frame) |
| `focus` source | `rig.distance` — the eased spring-arm length, metres | metres |

And the max circle of confusion:

```js
// Scaled to the frame height, so the look does not change with resolution or with the
// resolution-scale slider. 0.0024 is 3.5 px at 1440p; against the pass's own 1.5 px
// early-out only pixels past roughly three hundred metres run a gather at all.
e.setFloat("maxCoc", this.engine.getRenderHeight() * 0.0024);
```

| Identifier | Value | Units |
|---|---|---|
| `maxCoc` | `renderHeight × 0.0024` | pixels (= 3.456 px at 1440p) |

## 7.3 The pass (verbatim)

```wgsl
const TAPS: i32 = 16;
const GOLDEN: f32 = 2.39996323;

/// Where the far defocus starts and where it saturates, in **metres**.
const FAR_START: f32 = 130.0;
const FAR_FULL:  f32 = 620.0;

/// Signed circle of confusion, -1 (near) .. +1 (far), before the pixel scale.
fn cocOf(z: f32, focus: f32) -> f32 {
    if (isBackground(z)) { return 1.0; }
    let far  = smoothstep(FAR_START, FAR_FULL, z);
    let near = smoothstep(focus * 0.55, focus * 0.16, z);
    return far - near;
}

fn gather(uv: vec2f, pix: vec2f, r: f32, centre: vec3f) -> vec3f {
    let rot = ignPost(pix) * 6.28318530718;

    var acc = centre;
    var wsum = 1.0;
    for (var i = 0; i < TAPS; i++) {
        let fi = f32(i) + 0.5;
        let a  = rot + fi * GOLDEN;
        let rr = r * sqrt(fi / f32(TAPS));
        let sUV = uv + vec2f(cos(a), sin(a)) * rr * uniforms.invRes;

        let sz = textureSampleLevel(depthTex, depthTexSampler, sUV, 0.0).r;
        let sCoc = cocOf(sz, uniforms.focusDist);
        // A tap only contributes if its own blur circle is wide enough to reach
        // this pixel. That is the whole foreground-bleed fix, in one line.
        let w = clamp(abs(sCoc) * uniforms.maxCoc - rr + 1.0, 0.0, 1.0);
        acc += textureSampleLevel(sceneTex, sceneTexSampler, sUV, 0.0).rgb * w;
        wsum += w;
    }
    return acc / wsum;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = input.vUV;
    let centre = textureSampleLevel(sceneTex, sceneTexSampler, uv, 0.0);

    var outCol = centre.rgb;
    if (uniforms.enabled > 0.5) {
        let z = textureSampleLevel(depthTex, depthTexSampler, uv, 0.0).r;
        let r = abs(cocOf(z, uniforms.focusDist)) * uniforms.maxCoc;
        // Under a pixel and a half there is nothing a gather can do that the
        // display transform will not throw away, and this is the branch almost
        // the whole frame takes.
        if (r >= 1.5) { outCol = gather(uv, input.position.xy, r, centre.rgb); }
    }

    fragmentOutputs.color = vec4f(outCol, centre.a);
}
```

## 7.4 FAR_START / FAR_FULL — absolute metres, and the bug that made them so

The reference documents this at length and it is worth reproducing because a porter's
instinct is to re-key the far ramp to the focal distance:

> Absolute, not a multiple of the focal distance, and that distinction is the whole of a bug
> this pass shipped with. Keying the far ramp to `focus * 14` sounds distant and is not: the
> focal plane is the spring arm, about six metres, so the ramp saturated at eighty-seven
> metres — the near-middle of a field that runs to eight hundred and seventy. Every dune past
> the one the player is standing on sat at the full circle of confusion. The scene does not
> rescale when the player zooms the camera in, so neither can this.
>
> The values are also far more conservative than a naive thin-lens model would give, and
> deliberately. A third-person camera focused at six metres is a wide lens at a small
> aperture; its hyperfocal distance is a few metres, so physically *nothing* past about
> twelve metres defocuses at all. What is left here is a cosmetic softening of the last
> ridge, where aerial perspective has already taken three quarters of the contrast.

The **near** ramp *is* keyed to the focal distance, because the near limit is a property of
the subject distance: `smoothstep(focus*0.55, focus*0.16, z)` — a *descending* smoothstep, so
`near` is 1 at `z ≤ focus*0.16` and 0 at `z ≥ focus*0.55`. At the default 6.2 m arm that is
1.0 at ≤0.992 m, 0.0 at ≥3.41 m.

## 7.5 DOF constants

| Identifier | Value | Units |
|---|---|---|
| `TAPS` | `16` | — |
| `GOLDEN` | `2.39996323` | radians (golden angle) |
| `FAR_START` | `130.0` | metres |
| `FAR_FULL` | `620.0` | metres |
| near far-edge factor | `0.55` | × focusDist |
| near near-edge factor | `0.16` | × focusDist |
| tap radius law | `rr = r · sqrt((i+0.5)/TAPS)` | pixels | uniform-area disc |
| tap angle law | `a = rot + (i+0.5) · GOLDEN` | radians | |
| rotation dither | `ignPost(fragCoord) × 6.28318530718` | radians | |
| per-tap weight | `clamp(|sCoc|·maxCoc − rr + 1.0, 0, 1)` | — | |
| centre weight | `1.0` (seeded into `acc`/`wsum`) | — | |
| gather early-out | `r < 1.5` | pixels | |
| background CoC | `+1.0` (sky is fully far) | — | |
| `maxCoc` scale | `0.0024 × renderHeight` | pixels | |
| `focusDist` ease | `min(1, dt·4.0)` | — | |

---

# 8. Composite / tonemap — `tonemap.fragment.wgsl`

## 8.1 Why everything happens here

> Everything that has to happen in one place happens here, because each of these is defined
> relative to the one before it. Shafts are radiance and go in before exposure; bloom is
> thresholded in *exposed* units so its knee means something fixed; contrast is applied in
> linear so it pushes into the tone curve's shoulder rather than clipping after it; grain
> goes on after the encode so it reads evenly across the range instead of vanishing in the
> shadows.
>
> Snow renders die at the tonemapper. The scene is a huge, bright, low-contrast surface, so
> any curve that saturates early turns the whole field into a flat white sheet with no form —
> the single most common failure in snow rendering.
>
> AgX is the default here rather than ACES for exactly that reason: it desaturates toward
> white as it approaches the shoulder instead of hue-shifting, and its shoulder is long
> enough that a sunlit drift at 6× middle grey still has legible gradation instead of
> clipping to 1.0. ACES is offered for comparison and does visibly worse on this content —
> it pushes bright snow toward a warm cast and crushes the last stop.

(See §6.6 for the "exposed units" caveat.)

## 8.2 The EXACT order inside the composite

1. Sample the DOF result (`textureSample`, implicit-LOD).
2. **Radial speed smear** — six extra taps, on scene radiance, *before* exposure.
3. **Light shafts** — added in scene radiance, *before* exposure.
4. **`c *= exposure`**.
5. **Bloom** — `c += (near·0.35 + far·0.65) · bloomAmount`.
6. **Spindrift strands** — added in exposed linear.
7. **Contrast about middle grey (0.18)** — in linear, before the curve.
8. **Tonemap** — AgX / ACES / clamp. Every branch returns *display-linear*.
9. **Vignette** — multiplicative, on display-linear.
10. **`linearToSrgb`** — one encode.
11. **Grain** — added *after* the encode.

Do not reorder. Each step's constants are calibrated against its position.

## 8.3 Speed streaks — radial smear

```wgsl
let dFocus = input.vUV - vec2f(0.5, 0.5);
let radius = length(dFocus) * 2.0;
let streak = uniforms.speedStreak * smoothstep(0.34, 1.05, radius);
if (streak > 0.002) {
    var acc = c;
    for (var i = 1; i <= 6; i++) {
        let t = f32(i) / 6.0 * streak * 0.026;
        // textureSampleLevel, not textureSample: this loop sits under a
        // non-uniform branch, where implicit derivatives are undefined.
        acc += textureSampleLevel(
            textureSampler, textureSamplerSampler, input.vUV - dFocus * t, 0.0
        ).rgb;
    }
    c = mix(c, acc / 7.0, 0.88);
}
```

* Both streak effects are **confined to the periphery**, because that is where speed is
  actually read: the centre of the frame is what the player is looking at, and blurring it
  just makes the demo feel broken.
* The radial smear *"is the one that does the work — it is the only thing in the chain that
  makes the *scene* look fast rather than decorating it."*
* Both are applied **before the tonemapper** so its shoulder rolls the strands off rather
  than letting them clip, and both cost nothing when `speedStreak` is zero.

| Identifier | Value | Units |
|---|---|---|
| `radius` | `length(vUV − 0.5) × 2.0` | 0 at centre, ~1.414 at corner |
| periphery ramp | `smoothstep(0.34, 1.05, radius)` | — |
| activation gate | `streak > 0.002` | — |
| smear taps | `6` (plus centre) | — |
| smear reach | `streak × 0.026` at `i = 6` | fraction of `dFocus` |
| smear divisor | `7.0` | (6 taps + original) |
| smear mix | `0.88` | fraction |

## 8.4 Speed streaks — spindrift strands

```wgsl
fn streakStrands(d: vec2f, r: f32, t: f32) -> f32 {
    let ang = atan2(d.y, d.x);
    let a = ang * 96.0;
    let cell = floor(a);
    let rnd = fract(sin(cell * 12.9898 + 4.1) * 43758.5453);
    // Only a fraction of the angular cells carry a strand; a strand in every one
    // reads as a zoom-blur artefact rather than as blowing snow.
    if (rnd > 0.34) { return 0.0; }

    let across = abs(fract(a) - 0.5) * 2.0;
    // The radial frequency is the number that decides whether this reads as
    // blowing snow or as scratches on the lens. At one cycle across the frame a
    // strand is a straight line from the centre to the corner; at fourteen it is
    // a two-centimetre dash, which is what a grain of spindrift crossing the
    // frame in a fifteenth of a second actually looks like.
    let phase = fract(r * (11.0 + rnd * 24.0) - t * (7.0 + rnd * 22.0));
    let seg = smoothstep(0.55, 0.86, phase) * (1.0 - smoothstep(0.86, 1.0, phase));
    return pow(1.0 - across, 20.0) * seg;
}
```

Applied as:

```wgsl
if (streak > 0.002) {
    let s = streakStrands(dFocus, radius, uniforms.time);
    c += vec3f(0.88, 0.94, 1.06) * s * streak * 0.16;
}
```

| Identifier | Value | Units |
|---|---|---|
| angular cell count | `96.0` | cells per 2π (`ang * 96`) |
| hash multiplier | `12.9898`, offset `4.1`, scale `43758.5453` | — |
| strand occupancy | `rnd > 0.34 → no strand` | ⇒ ~34% of cells carry a strand |
| across-strand falloff | `pow(1 − across, 20.0)` | — |
| radial frequency | `11.0 + rnd × 24.0` | cycles across the radius (11…35) |
| scroll rate | `7.0 + rnd × 22.0` | cycles/second (7…29) |
| dash window | `smoothstep(0.55, 0.86, phase) × (1 − smoothstep(0.86, 1.0, phase))` | — |
| strand colour | `(0.88, 0.94, 1.06)` | linear RGB — cool, slightly blue |
| strand gain | `× streak × 0.16` | exposed linear |

## 8.5 Shafts add

```wgsl
if (uniforms.shaftAmount > 0.0001) {
    c += textureSampleLevel(shaftsTex, shaftsTexSampler, input.vUV, 0.0).rgb
       * uniforms.shaftAmount;
}
```

> Light shafts, in scene radiance so the tone curve rolls them off with everything else.
> **Added** rather than blended: a shaft is light arriving at the lens along a path, not a
> surface that replaces what is behind it.

`shaftAmount` is `S.showLightShafts ? 1 : 0` — a binary. The artistic scale lives in
`S.shaftStrength` inside the shafts pass.

## 8.6 Exposure and bloom add

```wgsl
c *= uniforms.exposure;

if (uniforms.bloomAmount > 0.0001) {
    let near = textureSampleLevel(bloomNear, bloomNearSampler, input.vUV, 0.0).rgb;
    let far  = textureSampleLevel(bloomFar,  bloomFarSampler,  input.vUV, 0.0).rgb;
    // Weighted toward the wide level: a tight halo on a snow field reads as a
    // rendering artefact, a broad one reads as glare in the air.
    c += (near * 0.35 + far * 0.65) * uniforms.bloomAmount;
}
```

| Identifier | Value |
|---|---|
| `exposure` | `S.exposure`, default `0.105`, range `0.01…0.6`, step `0.005` |
| near weight | `0.35` |
| far weight | `0.65` |
| `bloomAmount` | `S.bloom ? S.bloomStrength : 0`, default `0.22`, range `0…1`, step `0.005` |
| activation gate | `> 0.0001` |

## 8.7 Contrast

```wgsl
// Contrast about middle grey, applied in linear before the curve so it
// pushes into the tonemapper's shoulder rather than clipping after it.
if (abs(uniforms.contrast - 1.0) > 0.001) {
    c = 0.18 * pow(max(c / 0.18, vec3f(1e-5)), vec3f(uniforms.contrast));
}
```

| Identifier | Value |
|---|---|
| middle grey pivot | `0.18` |
| `contrast` | `S.contrast`, default `1.14`, range `0.5…2`, step `0.01` |
| activation gate | `abs(contrast − 1) > 0.001` |
| pow floor | `1e-5` |

## 8.8 AgX — transcribed verbatim

```wgsl
const AGX_IN = mat3x3f(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104
);

const AGX_OUT = mat3x3f(
     1.19687900512017,  -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417,   -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116
);

/// Sixth-order fit of the AgX contrast curve.
fn agxContrast(x: vec3f) -> vec3f {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5   * x4 * x2
         - 40.14  * x4 * x
         + 31.96  * x4
         -  6.868 * x2 * x
         +  0.4298 * x2
         +  0.1191 * x
         -  0.00232;
}

fn agx(color: vec3f) -> vec3f {
    const MIN_EV: f32 = -12.47393;
    const MAX_EV: f32 =   4.026069;

    var v = AGX_IN * max(color, vec3f(0.0));
    v = clamp(log2(max(v, vec3f(1e-10))), vec3f(MIN_EV), vec3f(MAX_EV));
    v = (v - MIN_EV) / (MAX_EV - MIN_EV);
    return agxContrast(v);
}

/// Gentle saturation recovery. AgX deliberately desaturates highlights; without
/// a little of it back, the cool shadow / warm light split the whole look rests
/// on gets flattened out along with the clipping it was there to prevent.
fn agxLook(color: vec3f, sat: f32) -> vec3f {
    let lw = vec3f(0.2126, 0.7152, 0.0722);
    let l = dot(color, lw);
    return max(vec3f(0.0), l + (color - l) * sat);
}
```

### 8.8.1 WGSL matrix constructor order — critical for the GLSL port

`mat3x3f(a, b, c,  d, e, f,  g, h, i)` in WGSL builds the matrix **column by column**:
column 0 = `(a, b, c)`, column 1 = `(d, e, f)`, column 2 = `(g, h, i)`. GLSL's `mat3(...)`
constructor is **also column-major with the same argument order**, so the literal argument
lists above transcribe **unchanged** into GLSL:

```glsl
const mat3 AGX_IN = mat3(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104
);
```

and `AGX_IN * v` means the same thing in both languages (matrix × column vector). **Do not
transpose.** The matrices are near-symmetric, so a transposition error will be subtle rather
than obvious — it shows up as a small hue rotation in saturated highlights only.

### 8.8.2 AgX application in `main` — the 2.2 power is mandatory

```wgsl
if (uniforms.mode < 0.5) {
    // AgX's contrast polynomial already emits display-encoded values, so it
    // needs its EOTF (the 2.2 power) applied before the shared sRGB encode
    // at the bottom. Skipping that double-encodes the image: everything
    // lifts toward mid grey and the whole frame goes flat and milky —
    // which on snow is indistinguishable from "the shader is wrong".
    var v = agx(c);
    v = agxLook(v, 1.14);
    mapped = pow(max(AGX_OUT * v, vec3f(0.0)), vec3f(2.2));
}
```

Order: `agx()` → `agxLook(v, 1.14)` → `AGX_OUT * v` → `max(…, 0)` → `pow(…, 2.2)`.
Note `agxLook` runs in **AgX working space, before the outset matrix**.

### 8.8.3 AgX constants

| Identifier | Value | Units |
|---|---|---|
| `MIN_EV` | `-12.47393` | log2 stops |
| `MAX_EV` | `4.026069` | log2 stops |
| log2 floor | `1e-10` | — |
| polynomial `x^6` | `15.5` | — |
| polynomial `x^5` | `-40.14` | — |
| polynomial `x^4` | `31.96` | — |
| polynomial `x^3` | `-6.868` | — |
| polynomial `x^2` | `0.4298` | — |
| polynomial `x^1` | `0.1191` | — |
| polynomial `x^0` | `-0.00232` | — |
| `agxLook` saturation | `1.14` | — |
| AgX EOTF power | `2.2` | — |
| `AGX_IN` | 9 constants, above | — |
| `AGX_OUT` | 9 constants, above | — |

Total EV range = `MAX_EV − MIN_EV` = `16.499999` stops.

## 8.9 ACES — Narkowicz fit, transcribed verbatim

```wgsl
fn acesFitted(x: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
```

`mapped = acesFitted(c);` — the Narkowicz fit is already display-linear, so **no 2.2 power
and no extra matrices**. Selected by `mode` in `[0.5, 1.5)`.

| Identifier | Value |
|---|---|
| `a` | `2.51` |
| `b` | `0.03` |
| `c` | `2.43` |
| `d` | `0.59` |
| `e` | `0.14` |

## 8.10 Mode selection, vignette, sRGB encode, grain

```wgsl
uniform mode: f32;       // 0 = AgX, 1 = ACES, 2 = none

var mapped: vec3f;
if (uniforms.mode < 0.5)      { /* AgX, §8.8.2 */ }
else if (uniforms.mode < 1.5) { mapped = acesFitted(c); }
else                          { mapped = clamp(c, vec3f(0.0), vec3f(1.0)); }

// Vignette, very slight — enough to keep the eye centred on a scene with no
// UI to anchor it.
if (uniforms.vignette > 0.001) {
    let d = length(input.vUV - vec2f(0.5)) * 1.414;
    mapped *= mix(1.0, smoothstep(1.05, 0.35, d), uniforms.vignette);
}

var outCol = linearToSrgb(mapped);

// Grain, added after the encode so it reads evenly across the range instead
// of vanishing in the shadows.
if (uniforms.grainAmount > 0.0001) {
    let n = fract(sin(dot(input.vUV * vec2f(1920.0, 1080.0)
            + vec2f(uniforms.time * 91.7, uniforms.time * 43.3),
            vec2f(12.9898, 78.233))) * 43758.5453);
    outCol += (n - 0.5) * uniforms.grainAmount;
}

fragmentOutputs.color = vec4f(outCol, 1.0);
```

with

```wgsl
fn linearToSrgb(c: vec3f) -> vec3f {
    let lo = c * 12.92;
    let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
    return select(hi, lo, c <= vec3f(0.0031308));
}
```

`TONEMAP_MODES = { agx: 0, aces: 1, none: 2 }`, and the uniform is set as
`TONEMAP_MODES[S.tonemap] ?? 0`.

| Identifier | Value | Units |
|---|---|---|
| `mode` values | `0` AgX, `1` ACES, `2` none | — |
| `vignette` | `0.22` (hard-coded on the CPU, not a slider) | fraction |
| vignette radius scale | `1.414` | (so the corner is ≈1.0) |
| vignette ramp | `smoothstep(1.05, 0.35, d)` (descending) | — |
| vignette gate | `> 0.001` | — |
| sRGB linear segment | `× 12.92` below `0.0031308` | — |
| sRGB gamma segment | `1.055 · c^(1/2.4) − 0.055` | — |
| grain resolution basis | `(1920.0, 1080.0)` | pixels — fixed, resolution-independent grain size |
| grain time scroll | `(91.7, 43.3)` | per second, x and y |
| grain hash vector | `(12.9898, 78.233)` | — |
| grain hash scale | `43758.5453` | — |
| grain amplitude | `(n − 0.5) × grainAmount`, `grainAmount = S.grain ? S.grainStrength : 0`, default `0.022` | — |
| grain gate | `> 0.0001` | — |

`select(hi, lo, cond)` in WGSL = `cond ? lo : hi`. In GLSL: `mix(hi, lo,
vec3(lessThanEqual(c, vec3(0.0031308))))` or a component-wise ternary.

**The composite writes into an 8-bit target and the values are already sRGB-encoded** — so
the port must bind an `RGBA8` (non-`SRGB8_ALPHA8`) target and must not let the GL sRGB
conversion run on top of `linearToSrgb`.

## 8.11 Composite uniform sources (CPU)

```js
this.composite.onApply = (e) => {
    e.setFloat("exposure", S.exposure);
    e.setFloat("contrast", S.contrast);
    e.setFloat("mode", TONEMAP_MODES[S.tonemap] ?? 0);
    e.setFloat("grainAmount", S.grain ? S.grainStrength : 0);
    e.setFloat("time", this.time);
    e.setFloat("vignette", 0.22);
    e.setFloat("speedStreak", S.windStreaks ? this.speedStreak * S.streakStrength : 0);
    e.setFloat("bloomAmount", S.bloom ? S.bloomStrength : 0);
    e.setFloat("shaftAmount", S.showLightShafts ? 1 : 0);
    e.setTextureFromPostProcessOutput("bloomNear", this.bloomA);
    e.setTextureFromPostProcessOutput("bloomFar", this.bloomC);
    e.setTextureFromPostProcessOutput("shaftsTex", this.shafts);
};
```

`this.time` accumulates `dt` in `PostChain.update` — and `dt` is **0 when `S.freezeTime` is
set**, so grain and spindrift freeze with the scene.

`this.speedStreak` is written each frame from `character.streak01`:

```js
this.streak01 = this.surf * Scalar.Clamp((this.speed - 7) / 11, 0, 1);
```

i.e. 0 unless surfing, ramping from 7 m/s to 18 m/s of ground speed (the surf top speed
constant is `SURF_MAX = 19.5` m/s).

---

# 9. Contrast-adaptive sharpen — `sharpen.fragment.wgsl`

## 9.1 Why it is last

> TAA costs sharpness — it is a weighted average over eight subpixel positions, and however
> good the neighbourhood clip is, the result is softer than the jittered frame that went in.
> This is the pass that buys it back, and it belongs at the very end for two reasons:
> sharpening in linear HDR puts a dark ring around every specular highlight, because the
> overshoot there is measured in stops rather than in code values; and the eye judges
> acutance after the tone curve, not before it.
>
> The local min/max clamp is what makes it "adaptive": the correction is limited to the range
> already present in the 3×3 neighbourhood, so a sharp edge is steepened and a flat expanse
> of snow does not gain a halo it has no gradient to justify.

## 9.2 The pass (verbatim)

```wgsl
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = input.vUV;
    let c = textureSampleLevel(textureSampler, textureSamplerSampler, uv, 0.0);

    var outCol = c.rgb;
    if (uniforms.amount >= 0.001) {
        let t = uniforms.invRes;
        let l = textureSampleLevel(textureSampler, textureSamplerSampler, uv - vec2f(t.x, 0.0), 0.0).rgb;
        let r = textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(t.x, 0.0), 0.0).rgb;
        let d = textureSampleLevel(textureSampler, textureSamplerSampler, uv - vec2f(0.0, t.y), 0.0).rgb;
        let u = textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(0.0, t.y), 0.0).rgb;

        let lo = min(c.rgb, min(min(l, r), min(d, u)));
        let hi = max(c.rgb, max(max(l, r), max(d, u)));

        let k = uniforms.amount * 0.32;
        outCol = clamp(c.rgb * (1.0 + 4.0 * k) - (l + r + d + u) * k, lo, hi);
    }

    fragmentOutputs.color = vec4f(outCol, c.a);
}
```

| Identifier | Value | Units |
|---|---|---|
| kernel | 5-tap cross (centre + L/R/U/D at 1 texel) | pixels |
| `k` | `amount × 0.32` | — |
| centre gain | `1 + 4k` | — |
| neighbour gain | `−k` each | — |
| clamp range | local min/max over the 5 taps | — |
| activation gate | `amount >= 0.001` | — |
| `amount` | `S.sharpen ? S.sharpenStrength : 0`, default `0.55`, range `0…1`, step `0.01` | — |

At the default, `k = 0.176`, centre gain `1.704`.

---

# 10. The depth prepass contract (what the post chain consumes)

Not in this assignment's file list, but every pass above reads it, so the contract is
normative for the port.

**Format:** RGBA16F, full render resolution, `generateDepthBuffer: true`, no mips,
**NEAREST** sampling, clamp on both axes.
**Clear colour:** `(DEPTH_FAR, 0, 0, 1)` = `(9000, 0, 0, 1)`.
**Refresh:** every frame. Rendered as a custom render target **after the shadow cascades and
before the beauty pass** — the scene renders custom targets in registration order.

Channels:

| Channel | Contents | Units |
|---|---|---|
| `.r` | Linear view depth — the clip-space `w`, carried through as a **varying** rather than reconstructed from the depth buffer. Exact, one interpolant. | metres |
| `.g` | Specular mask: `0` matte snow, `1` mirror ice. Only the reflection pass reads it, and only where non-zero. | 0..1 |
| `.b`, `.a` | Spare (written as `0.0, 1.0`). | — |

Fragment shader in full:

```wgsl
varying vViewZ: f32;
varying vMask: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    fragmentOutputs.color = vec4f(input.vViewZ, input.vMask, 0.0, 1.0);
}
```

Mask values written by each caster (verified this session):

| Caster | `vMask` |
|---|---|
| terrain (`terrainPrepass.vertex.wgsl`) | `clamp(deformSample.a, 0, 1) * dWeight` — the ice channel of the deformation buffer, faded out with the clipmap's deform weight |
| crystals (`crystalPrepass.vertex.wgsl`) | `1.0` |
| character body (`charPrepass.vertex.wgsl`) | `0.0` |
| cloth (`clothPrepass.vertex.wgsl`) | `0.0` |

Half float rather than full is deliberate: relative precision is 2⁻¹¹, so the error is 0.05%
of the distance — five millimetres at ten metres, fifteen centimetres at three hundred. Every
consumer works in units of "fraction of the distance to the pixel".

Each caster registers **the vertex program it is actually rendered with**
(`rtt.setMaterialForRendering(mesh, material)`). This is not optional: nothing in the scene
has CPU geometry that matches what is drawn — the terrain's vertices are grid indices placed
by the clipmap vertex shader, the character is skinned from a transform texture, the wake is
a lattice evaluated from a spine, the crystals are generated from a growth curve. A generic
depth pass would render five undisplaced lattices.

The prepass material must declare `viewProjection`, and the engine binds the active camera's
— which during this target's render is **the jittered one the beauty pass will use**, so
depth and colour line up to the subpixel.

---

# 11. Camera rig — `core/camera.js`

## 11.1 Concept

Third-person spring-arm rig, action-MMO framing. The arm is deliberately **not** rigid: the
pivot chases the character through a damped spring, so hard acceleration pulls the camera
back and the character drifts forward in frame. FOV widens with speed, the rig banks into
carves, everything eases, nothing snaps. Open snow field, so **there is no obstacle collision
solve** — only the ground itself pushes the arm up, which buys a rig that never pops through
a drift.

## 11.2 Construction constants

```js
const cam = new UniversalCamera("cam", new Vector3(0, 3, -6), scene);
cam.minZ = 0.12;
cam.maxZ = 4200;
cam.fov  = 1.02;      // ~58deg vertical
cam.inertia = 0;
cam.rotation.set(0, 0, 0);
// No attachControl — this rig drives the transform itself.
```

| Field | Initial value | Units |
|---|---|---|
| initial position | `(0, 3, −6)` | metres |
| `minZ` (near plane) | `0.12` | metres |
| `maxZ` (far plane) | `4200` | metres |
| `fov` / `baseFov` | `1.02` | radians vertical (≈58.4°) |
| `inertia` | `0` | — |
| `yaw` | `2.4` | radians |
| `pitch` | `0.17` | radians (positive = looking down) |
| `distance`, `distanceTarget` | `6.2` | metres |
| `shoulder` | `0.85` | metres, camera-space right offset |
| `pivotHeight` | `1.62` | metres above the character's feet |
| `roll`, `rollTarget` | `0` | radians |
| `trauma`, `shakeTime` | `0` | — |
| `groundClearance` | `1.35` | metres of snow the camera must keep beneath it |
| `groundLift` | `0` | metres |
| `forward` / `right` / `up` | `(0,0,1)` / `(1,0,0)` / `(0,1,0)` | republished every frame |

Module constants:

| Identifier | Value | Units |
|---|---|---|
| `ARM_SAMPLES` | `5` | height probes along the arm (loop runs `i = 0…5`, so **6 samples**) |
| `PITCH_MIN` | `-0.62` | radians (looking up) |
| `PITCH_MAX` | `1.05` | radians (looking down) |
| `DIST_MIN` | `2.6` | metres |
| `DIST_MAX` | `11.0` | metres |

## 11.3 `update(dt, targetPos, targetVel, lean, speed01)` — exact order

```js
// ---- look
this.yaw += input.lookX;
this.pitch = Scalar.Clamp(this.pitch + input.lookY, PITCH_MIN, PITCH_MAX);

// ---- zoom
this.distanceTarget = Scalar.Clamp(
    this.distanceTarget + input.zoomDelta * (this.distanceTarget * 0.35),
    DIST_MIN, DIST_MAX
);
this.distance = expDamp(this.distance, this.distanceTarget, 9, dt);

// ---- pivot
_pivot.copyFrom(targetPos);
_pivot.y += this.pivotHeight;

// Lead the camera slightly into the direction of travel.
const lead = Math.min(1, speed01) * 1.35;
_pivot.x += targetVel.x * lead * 0.09;
_pivot.z += targetVel.z * lead * 0.09;

if (this._first) { this.pivot.copyFrom(_pivot); this._first = false; }
else {
    // Softer spring under acceleration = the arm stretches, then recovers.
    springDamp(this.pivot, this.pivotVel, _pivot, 7.5, 1.0, dt);
}

// ---- fov
const fovWant = this.baseFov * (1 + speed01 * 0.19);
this.fov = expDamp(this.fov, fovWant, 3.2, dt);

// ---- bank
this.rollTarget = -lean * 0.085;
this.roll = expDamp(this.roll, this.rollTarget, 5.0, dt);

// ---- shake
this.trauma = Math.max(0, this.trauma - dt * 1.15);
this.shakeTime += dt;
const shake = this.trauma * this.trauma;

// ---- compose transform
const cp = Math.cos(this.pitch);
_fwd.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
_right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
Vector3.CrossToRef(_right, _fwd, _up);
_up.normalize();

this.forward.copyFrom(_fwd);
this.right.copyFrom(_right);
this.up.copyFrom(_up);

_desired.copyFrom(this.pivot);
_desired.addInPlace(_fwd   * -this.distance);
_desired.addInPlace(_right *  this.shoulder);
_desired.addInPlace(_up    *  0.22);
```

Then the ground-clearance solve, then shake, then the write to the camera.

## 11.4 Ground clearance

```js
if (this.groundAt) {
    // Worst case over the whole arm, not just the eye: a crest between the player
    // and the camera can fill the view while the eye itself is legally above the snow.
    let need = 0;
    for (let i = 0; i <= ARM_SAMPLES; i++) {
        const t = i / ARM_SAMPLES;
        const x = this.pivot.x + (_desired.x - this.pivot.x) * t;
        const z = this.pivot.z + (_desired.z - this.pivot.z) * t;
        const y = this.pivot.y + (_desired.y - this.pivot.y) * t;
        // Clearance eases in along the arm so it does not shove the camera up
        // merely for being near the player's own feet.
        const gh = this.groundAt(x, z) + this.groundClearance * (0.35 + 0.65 * t);
        const d = gh - y;
        if (d > need) need = d;
    }

    // The lift rises quickly and relaxes slowly: snapping down the instant a crest
    // passes under the arm reads as a jolt, while being slow to rise means a frame
    // or two actually inside the snow.
    this.groundLift = expDamp(this.groundLift, need, need > this.groundLift ? 26 : 4.5, dt);
    _desired.y += this.groundLift;
}
```

| Identifier | Value | Units |
|---|---|---|
| samples along the arm | `i = 0…5` (6 points, `t = 0, 0.2, 0.4, 0.6, 0.8, 1.0`) | — |
| clearance ease along arm | `groundClearance × (0.35 + 0.65·t)` | metres — 35% at the pivot, 100% at the eye |
| lift rise rate | `26` | per second (fast) |
| lift relax rate | `4.5` | per second (slow) |

`rig.groundAt` is injected in `main.js` as `(x, z) => terrain.heightAt(x, z)`, which samples
the CPU mirror of the same 4096² RG32F height texture the vertex shader displaces with.

## 11.5 Trauma shake

Squirrel Eiserloh style: `shake = trauma²`, so it falls off perceptually rather than
linearly.

```js
if (shake > 0.0001) {
    const t = this.shakeTime * 26;
    _desired.x += (noise1(t)        * 2 - 1) * shake * 0.16;
    _desired.y += (noise1(t + 31.7) * 2 - 1) * shake * 0.16;
    _desired.z += (noise1(t + 71.3) * 2 - 1) * shake * 0.10;
}

cam.position.copyFrom(_desired);
cam.fov = this.fov;
cam.rotation.set(
    this.pitch + (shake > 0.0001 ? (noise1(this.shakeTime * 31 + 11) * 2 - 1) * shake * 0.02 : 0),
    this.yaw   + (shake > 0.0001 ? (noise1(this.shakeTime * 29 + 53) * 2 - 1) * shake * 0.02 : 0),
    this.roll  + (shake > 0.0001 ? (noise1(this.shakeTime * 23 + 97) * 2 - 1) * shake * 0.05 : 0)
);
```

| Identifier | Value | Units |
|---|---|---|
| trauma decay | `1.15` | per second |
| shake law | `trauma²` | — |
| positional shake frequency | `shakeTime × 26` | Hz-ish |
| positional offsets | `31.7`, `71.3` | noise phase offsets for y and z |
| positional amplitude | `0.16` (x), `0.16` (y), `0.10` (z) | metres at full trauma |
| rotational frequencies | `31`, `29`, `23` | with phase offsets `11`, `53`, `97` |
| rotational amplitudes | `0.02` (pitch), `0.02` (yaw), `0.05` (roll) | radians at full trauma |
| shake activation gate | `> 0.0001` | — |
| `addTrauma` | `trauma = min(1, trauma + amount)` | — |
| trauma source | `controller.js`: `if (load > 0.25) rig.addTrauma((load - 0.25) * 1.35 * h)` | — |

## 11.6 Helper functions (verbatim)

```js
/** Framerate-independent exponential approach. */
export function expDamp(cur, target, rate, dt) {
    return target + (cur - target) * Math.exp(-rate * dt);
}

/** Semi-implicit damped spring toward `target`, mutating `pos` and `vel`. */
function springDamp(pos, vel, target, freq, damping, dt) {
    const k = freq * freq;
    const c = 2 * damping * freq;
    // Clamp dt so a hitch can't blow the integrator up.
    const h = Math.min(dt, 1 / 45);
    vel.x += (k * (target.x - pos.x) - c * vel.x) * h;
    vel.y += (k * (target.y - pos.y) - c * vel.y) * h;
    vel.z += (k * (target.z - pos.z) - c * vel.z) * h;
    pos.x += vel.x * h;
    pos.y += vel.y * h;
    pos.z += vel.z * h;
}

/** Cheap smooth 1D value noise for shake. Deterministic, no allocation. */
function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

function hash1(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
}
```

| Identifier | Value | Units |
|---|---|---|
| spring `freq` | `7.5` | rad/s |
| spring `damping` | `1.0` | critical |
| spring integrator clamp | `1/45` s | seconds |
| zoom sensitivity | `zoomDelta × distanceTarget × 0.35` | metres — proportional, so zoom feels the same at any arm length |
| zoom ease rate | `9` | per second |
| FOV widening | `baseFov × (1 + speed01 × 0.19)` | radians — up to `1.2138` (≈69.5°) |
| FOV ease rate | `3.2` | per second |
| lead gain | `speed01 × 1.35 × 0.09` on `targetVel.xz` | seconds of lead |
| roll target | `−lean × 0.085` | radians (max ±4.87°) |
| roll ease rate | `5.0` | per second |
| eye rise above pivot | `+0.22` along `up` | metres |
| `hash1` constants | `127.1`, `43758.5453` | — |

## 11.7 Basis convention (used by the spells too)

```js
_fwd   = ( sin(yaw)·cos(pitch), −sin(pitch), cos(yaw)·cos(pitch) )
_right = ( cos(yaw),             0,          −sin(yaw)            )
_up    = normalize(cross(_right, _fwd))
```

Left-handed, +y up. `getFlatForward(out)` returns `(sin(yaw), 0, cos(yaw))` and
`getFlatRight(out)` returns `(cos(yaw), 0, −sin(yaw))` — used for camera-relative movement.

The rig's basis is republished every frame so *"the spells aim with the same three vectors,
so there is only one place the convention for 'forward' is written down."*

---

# 12. Input — `core/input.js`

## 12.1 The state struct (polled, never event-driven into game code)

```js
export const input = {
    moveX: 0, moveZ: 0, moving: false,   // camera-relative, normalised to a unit disc
    lookX: 0, lookY: 0,                  // accumulated mouse delta since endFrame(), radians
    zoomDelta: 0,                        // consumed by the camera rig
    surf: false,                         // RMB held
    sprint: false,                       // shift
    spellPressed: 0,                     // 0 = none, else 1..5 — set on keydown, cleared each frame
    spellHeld2: false,                   // spell 2 (Ribbon) is a held cast
    locked: false,
};
```

## 12.2 Bindings

| Input | Action |
|---|---|
| Click on canvas | `canvas.requestPointerLock()` if not already locked |
| Mouse move (locked only) | `lookX += movementX × LOOK_SCALE`, `lookY += movementY × LOOK_SCALE` |
| Wheel (locked only) | `zoomDelta += deltaY × 0.0016`, `preventDefault()`, listener registered `{ passive: false }` |
| Right mouse down (button 2, locked only) | `surf = true` |
| Right mouse up (button 2) | `surf = false` |
| `contextmenu` on canvas | `preventDefault()` — frees RMB for snow-surf |
| `KeyW` / `ArrowUp` | `z += 1` |
| `KeyS` / `ArrowDown` | `z -= 1` |
| `KeyD` / `ArrowRight` | `x += 1` |
| `KeyA` / `ArrowLeft` | `x -= 1` |
| `ShiftLeft` / `ShiftRight` | `sprint` |
| `Digit1` … `Digit5` | `spellPressed = 1…5`; `Digit2` additionally sets `spellHeld2 = true` on down, `false` on up |
| `F1` or `Backquote` | `preventDefault()`, toggle overlay — **works whether or not the pointer is locked**, and returns before touching `keys` |
| Key repeat | ignored (`if (e.repeat) return`) |
| Pointer-lock lost | all keys cleared, `surf = false`, `spellHeld2 = false` |
| Window `blur` | all keys cleared, `surf = false`, `spellHeld2 = false` |

| Identifier | Value | Units |
|---|---|---|
| `LOOK_SCALE` | `0.0022` | radians per pixel of mouse movement |
| wheel scale | `0.0016` | per `deltaY` unit |

## 12.3 Per-frame functions

```js
/** Resolve held keys into movement axes. Called once per frame BEFORE update. */
export function pollInput() {
    // ... accumulate x, z from keys ...
    const len = Math.sqrt(x * x + z * z);
    if (len > 1) { x /= len; z /= len; }   // clamp to a unit disc so diagonals aren't faster
    input.moveX = x;
    input.moveZ = z;
    input.moving = len > 0.001;
    input.sprint = !!(keys.ShiftLeft || keys.ShiftRight);
}

/** Clear per-frame accumulators. Called at the VERY END of the frame. */
export function endFrame() {
    input.lookX = 0;
    input.lookY = 0;
    input.zoomDelta = 0;
    input.spellPressed = 0;
}
```

`moving` threshold is `len > 0.001`. Note that `lookX`/`lookY` accumulate raw deltas across
the frame and are consumed *unscaled by dt* by the rig (`this.yaw += input.lookX`) — mouse
look is displacement-based, not rate-based, which is correct and must not be dt-scaled in the
port.

---

# 13. Settings — `core/settings.js`

`S` is a **flat plain object read directly by systems every frame** — no getters, no proxies,
no allocation. `SCHEMA` is metadata the overlay builds its widgets from, and `onChange` lets
systems react to edits that need work (rebuilding a render target, re-freezing a material)
rather than just being sampled next frame.

## 13.1 Full key list, defaults, ranges

| Key | Default | Type | Min | Max | Step | Group | Notes |
|---|---|---|---|---|---|---|---|
| `preset` | `"ultra"` | string | — | — | — | Quality | `ultra` / `high` / `balanced` |
| `resolutionScale` | `1.0` | float | `0.5` | `1.5` | `0.05` | Systems | `engine.setHardwareScalingLevel(1/resolutionScale)` |
| `sunAzimuth` | `118` | float | `0` | `360` | `1` | Sun & Sky | degrees, compass bearing |
| `sunElevation` | `13.0` | float | `0.5` | `45` | `0.1` | Sun & Sky | *"Low enough for long raking shadows, high enough that the beam still carries real energy — below ~10 degrees the air mass eats so much of it that the scene goes flat and sky-lit."* |
| `sunIntensity` | `4.2` | float | `0` | `10` | `0.05` | Sun & Sky | `sunScale = sunIntensity × 5.5` |
| `sunTempWarm` | `1.0` | float | `0` | `1` | `0.01` | Sun & Sky | 0 = neutral white, 1 = full warm low-sun tint |
| `ambientIntensity` | `1.0` | float | `0` | `3` | `0.01` | Sun & Sky | |
| `ambientBlue` | `1.0` | float | `0` | `2` | `0.01` | Sun & Sky | strength of the cool shadow shift |
| `fogDensity` | `0.0072` | float | `0` | `0.03` | `0.0001` | Atmosphere | |
| `fogHeightFalloff` | `0.045` | float | `0` | `0.3` | `0.001` | Atmosphere | |
| `fogStart` | `24` | float | — | — | — | (not exposed) | metres |
| `aerialStrength` | `1.0` | float | `0` | `2` | `0.01` | Atmosphere | |
| `windDirection` | `42` | float | `0` | `360` | `1` | Atmosphere | *"Held 70-80 degrees away from `sunAzimuth`: sastrugi ridges run along the wind, so when the two align the sun rakes down every ridge, lights both flanks identically and the fine structure reads as flat ground."* |
| `windStrength` | `1.0` | float | `0` | `2` | `0.01` | Atmosphere | |
| `showMountains` | `true` | bool | — | — | — | Atmosphere | far-field range on the skybox |
| `mountainHeight` | `2150` | float | `0` | `2500` | `10` | Atmosphere | metres |
| `showLightShafts` | `true` | bool | — | — | — | Atmosphere | gates both the shafts pass and the composite add |
| `shaftStrength` | `0.30` | float | `0` | `2` | `0.01` | Atmosphere | |
| `glintIntensity` | `0.55` | float | `0` | `2` | `0.01` | Snow | |
| `glintGrazing` | `0.72` | float | `0` | `1` | `0.01` | Snow | how hard the grazing-angle gate bites |
| `sssStrength` | `1.0` | float | `0` | `3` | `0.01` | Snow | |
| `sssRadius` | `1.0` | float | `0.1` | `3` | `0.01` | Snow | |
| `detailNormalStrength` | `1.0` | float | `0` | `2` | `0.01` | Snow | |
| `macroHeightScale` | `1.0` | float | `0` | `2` | `0.01` | Snow | dune height |
| `sastrugiStrength` | `1.0` | float | `0` | `2` | `0.01` | Snow | |
| `deformDepth` | `1.0` | float | `0` | `3` | `0.01` | Deformation | |
| `deformBerm` | `1.0` | float | `0` | `3` | `0.01` | Deformation | |
| `refillRate` | `1.0` | float | `0` | `4` | `0.01` | Deformation | |
| `deformResolution` | `2048` | int | — | — | — | (preset only) | |
| `wakeHeight` | `1.0` | float | `0` | `2` | `0.01` | Snow-surf | multiple of 1.45 m |
| `wakeSpray` | `1.0` | float | `0` | `2.5` | `0.01` | Snow-surf | plume density |
| `windStreaks` | `true` | bool | — | — | — | Snow-surf | screen-space speed streaks |
| `streakStrength` | `1.0` | float | `0` | `2` | `0.01` | Snow-surf | |
| `showWake` | `true` | bool | — | — | — | Snow-surf | wake mesh |
| `showSpells` | `true` | bool | — | — | — | Spells | master toggle |
| `spellLight` | `1.0` | float | `0` | `3` | `0.01` | Spells | |
| `spellSpray` | `1.0` | float | `0` | `2.5` | `0.01` | Spells | |
| `waterDepthTint` | `1.0` | float | `0` | `3` | `0.01` | Spells | absorption path scale |
| `taa` | `true` | bool | — | — | — | Post | |
| `ssr` | `true` | bool | — | — | — | Post | "SSR (ice)" |
| `dof` | `true` | bool | — | — | — | Post | |
| `bloom` | `true` | bool | — | — | — | Post | |
| `grain` | `true` | bool | — | — | — | Post | |
| `sharpen` | `true` | bool | — | — | — | Post | |
| `tonemap` | `"agx"` | enum | — | — | — | Post | `agx` / `aces` / `none` |
| `exposure` | `0.105` | float | `0.01` | `0.6` | `0.005` | Post | *"Measured, not guessed: sunlit snow here sits around 12 in linear, and at this exposure it lands near AgX normalised 0.79, where the curve's slope is 0.09 per stop."* |
| `contrast` | `1.14` | float | `0.5` | `2` | `0.01` | Post | |
| `bloomStrength` | `0.22` | float | `0` | `1` | `0.005` | Post | |
| `grainStrength` | `0.022` | float | `0` | `0.1` | `0.001` | Post | |
| `sharpenStrength` | `0.55` | float | `0` | `1` | `0.01` | Post | |
| `showTerrain` | `true` | bool | — | — | — | Systems | |
| `showCharacter` | `true` | bool | — | — | — | Systems | |
| `wireframe` | `false` | bool | — | — | — | Systems | |
| `freezeTime` | `false` | bool | — | — | — | Systems | forces `dt = 0` |
| `debugView` | `"beauty"` | enum | — | — | — | Systems | see below |

`debugView` options (overlay list, longer than the `S` comment): `beauty`, `deform`,
`normals`, `depth`, `cascades`, `footprint`, `fineNormals`, `shadow`, `ndotl`, `shadowMap`,
`albedo`.

## 13.2 SCHEMA group order (the overlay renders in this order)

`Sun & Sky` → `Atmosphere` → `Snow` → `Deformation` → `Snow-surf` → `Spells` → `Post` →
`Systems`.

Widget type codes: `"f"` float slider, `"b"` bool toggle, `"e"` enum select.

## 13.3 Presets

```js
export const PRESETS = {
    ultra: {},
    high:     { deformResolution: 2048, resolutionScale: 1.0,  ssr: true,  dof: true },
    balanced: { deformResolution: 1024, resolutionScale: 0.85, ssr: false, dof: false },
};
```

Only the keys that differ from `ultra` need listing. `applyPreset(name)` sets `S.preset` then
calls `set(k, v)` for each key so listeners fire.

## 13.4 The change bus

```js
const listeners = new Map();   // key -> Set<fn>

export function onChange(keys, fn) { /* subscribe to one key or an array; returns unsubscribe */ }

export function set(k, v) {
    if (S[k] === v) return;    // no-op on identical writes
    S[k] = v;
    const set_ = listeners.get(k);
    if (set_) for (const fn of set_) fn(v, k);
}
```

`set()` is **never called from the render loop** — only from the overlay and preset
application. Systems read `S.x` directly, per frame, with no indirection.

`onChange` subscriptions registered in `main.js`:

| Key | Handler |
|---|---|
| `resolutionScale` | `engine.setHardwareScalingLevel(1 / S.resolutionScale)` |
| `showTerrain` | `terrain.mesh.isVisible = v` |
| `showCharacter` | `figure.setVisible(v)` |
| `showWake` | `wake.setEnabled(v)` |

---

# 14. Perf, overlay, loading

## 14.1 `core/perf.js`

Averages hide hitches, so everything is **percentile-based**: the headline numbers are the
median and the 1% low (the 99th-percentile frame time). Allocation policy: every buffer is
created once at module load; `sample()` allocates nothing; `recompute()` sorts an in-place
typed-array copy and is throttled.

| Identifier | Value | Units |
|---|---|---|
| `CAP` | `512` | frames (~5.7 s at 90 fps) |
| recompute throttle | `250` | ms of accumulated frame time (≈4 Hz) |
| spike threshold | `median + 4` | ms |
| percentile indices | `median = view[(n*0.5)|0]`, `p95 = view[min(n-1, (n*0.95)|0)]`, `p99 = view[min(n-1, (n*0.99)|0)]` | — |
| `fps` | `1000 / median` | |
| `fpsLow` | `1000 / p99` | |

`stats` is mutated in place, never reassigned, so consumers can hold a reference. Fields:
`last, median, mean, p99, p95, max, fps, fpsLow, drawCalls, triangles, gpuMs`.

**Draw counter.** Counts draws by wrapping `engine.drawElementsType` and
`engine.drawArraysType`, *"rather than reading `engine._drawCalls`, which counts something
other than draws and does not reset on the frame boundary."* Latched by `endFrameDraws()`
once, after `scene.render()`.

**Frame graph** (`FrameGraph`): 2D canvas, `304 × 66` px, `alpha: true, desynchronized: true`.

| Identifier | Value | Units |
|---|---|---|
| y-axis initial | `22` | ms |
| y-axis target | `max(22, min(60, stats.max × 1.25))` | ms |
| y-axis ease | `× 0.08` per draw | — |
| 90-fps guide | `11.1` ms, `rgba(143,196,232,0.10)` | |
| 60-fps guide | `16.7` ms, `rgba(232,160,120,0.12)` | |
| bar colour | `> 16.7` → `#e8734f`; `> 11.1` → `#e8b04f`; else `#6fb2e0` | |
| median line | `rgba(219,230,242,0.55)` | |
| bar walk order | oldest → newest, so the graph scrolls left | |

## 14.2 `ui/overlay.js`

The only UI in the demo. Built once from `SCHEMA`, hidden by default, toggled with
`F1` / backtick.

| Refresh | Interval | Reason |
|---|---|---|
| numeric readouts | `250` ms (4 Hz) | *"formatting numbers into strings 90 times a second is steady garbage for no benefit"* |
| frame graph | `50` ms (20 Hz) | *"fast enough to watch a hitch appear, cheap enough to ignore"* |
| camera readout | `100` ms (10 Hz) | *"at 4 Hz you can't tell which way you nudged the rig"* |

Panel: `336` px wide, fixed to the right edge, `z-index: 80`, `rgba(8,12,19,0.86)` with
`backdrop-filter: blur(18px) saturate(1.2)`, monospace 11 px, colour `#cddaea`.

Readout rows: `fps`, `1% low`, `median`, `99th`, `gpu ms`, `draws`, `tris`, `spikes`, `res`.
Then `Frame budget` (lazily-created per-system rows from `systemMs`), then `Camera`
(`eye`, `yaw / pitch`, `arm / fov`, `player`, `speed / facing`), a copy-pose one-liner, the
quality preset buttons, then the SCHEMA groups.

Warning colours:

| Row | warn | bad |
|---|---|---|
| `fps` | `< 88` | `< 60` |
| `1% low` | `< 75` | `< 60` |
| `spikes` | `> 0` | — |

`gpu ms` shows an em dash rather than `0.00` when the adapter has no timestamp query: *"an
unavailable number and a zero one are not the same claim."*

Number formatting: `fmtNum(v, step)` → 0 dp if `step >= 1`, 2 dp if `step >= 0.01`, 3 dp if
`step >= 0.001`, else 4 dp. `fmtK(n)` → `x.xxM` above 1e6, `xk` above 1e3. `fmt2(v)` is
sign-padded fixed-width metres (CSS uses `white-space: pre` so the padding survives).

## 14.3 `core/loading.js`

A phase-weighted progress model: each phase declares how much of the bar it owns, and **the
bar only ever moves forward** (`progress = Math.max(progress, to)`). `phase()` also yields to
the browser (double `requestAnimationFrame`) so the DOM actually repaints between heavy
synchronous steps.

Phase table, from `main.js`:

| Progress | Label |
|---|---|
| `0.05` | `creating device` |
| `0.12` | `building scene` |
| `0.20` | `integrating atmosphere` |
| `0.34` | `baking heightfield` |
| `0.62` | `placing character` |
| `0.78` | `compiling pipelines` |
| `0.92` | `warming render targets` |
| `1.00` | `ready` (from `done()`) |

`done()` waits `360` ms after `ready` so the bar visibly lands, then adds `.gone` to `#boot`
(a 900 ms opacity transition) and `.show` to `#hint`; after `6000` ms it removes `#boot` and
un-shows the hint. `fail(message)` removes `#boot` and shows `#nogpu`, replacing its `<b>`
text.

DOM contract (`index.html`): `#view` (canvas), `#boot`, `#boot-bar`, `#boot-phase`, `#hint`,
`#nogpu`.

---

# 15. `main.js` — boot and the exact per-frame update order

## 15.1 Engine and scene setup

```js
const engine = new WebGPUEngine(canvas, {
    antialias: false,        // TAA handles edges; MSAA here would just cost bandwidth
    stencil: false,
    powerPreference: "high-performance",
    enableAllFeatures: true,
    setMaximumLimits: true,
});
```

```js
const scene = new Scene(engine);
scene.clearColor = new Color4(0.02, 0.03, 0.05, 1);
scene.autoClear = true;
// Do NOT clear depth between rendering groups. Babylon clears depth before every group by
// default; here group 1 is the opaque scene and group 2 is the alpha-blended water and
// spray, which must depth-test against it.
scene.setRenderingAutoClearDepthStencil(1, false);
scene.setRenderingAutoClearDepthStencil(2, false);
// No stock lights: every material here computes its own lighting.
scene.ambientColor = new Color3(0, 0, 0);
```

Rendering groups: **0 = sky**, **1 = opaque scene (terrain, character, wake)**, **2 =
alpha-blended water and spray**. Depth must survive from group 1 into group 2.

## 15.2 Construction order (which fixes render-target scheduling)

1. `CameraRig` → `scene.activeCamera`
2. `Sky` (renderingGroupId 0), `await sky.solve()`
3. `ShadowSystem`
4. **`DepthPass`** — *"It is a custom render target, and the scene renders those in
   registration order — so creating it here, after the cascades and before anything that
   draws, is the whole of the scheduling."*
5. `Terrain` (renderingGroupId 1), `await terrain.build()`, register prepass caster
6. `CharacterController`, placed at `(0, terrain.heightAt(0,0), 0)`
7. `Character` (figure) + prepass registration
8. `SprayField`
9. `SnowContact`
10. `SurfWake` + prepass registration
11. `SpellSystem` + `addConsumers(terrain.material, figure.bodyMat, figure.clothMat,
    wake.material, spray.material)` + prepass registration
12. `rig.groundAt = (x, z) => terrain.heightAt(x, z)`
13. **`PostChain(scene, rig.camera, depthPass, sky)`**
14. `Overlay`, `initInput`

## 15.3 Warm-up (behind the loading screen)

*"Everything that can compile, compiles here."* In order: `shadows.update`, `sky.render`,
`terrain.warmUp` + `terrain.update`, `figure.update(0)` + `figure.sync` + `figure.warmUp`,
`spray.update(0)` + `spray.warmUp`, `wake.warmUp`, `spells.warmUp(playerX+3, playerY,
playerZ+3)`, `whenReady(sky.material)`, `depthPass.warmUp()`, **`post.update(0, 0,
rig.distance)`** then `whenReady` on all nine post passes.

Then three real `scene.render()` calls interleaved with `loading.nextFrame()` — *"A few real
frames so every render target is allocated and every pipeline has actually been bound at
least once"* — and only then `spells.finishWarmUp()`, because *"the spell meshes had to be
standing through those frames for their render pipelines to exist."*

`whenReady` polls `isReady()` on `requestAnimationFrame` with a **25 000 ms** timeout whose
error message says the failure is *"almost always a WGSL compile error"*.

## 15.4 THE PER-FRAME ORDER (normative — reproduce exactly)

```js
engine.runRenderLoop(() => {
    const now = performance.now();
    let dtMs = now - prev;
    prev = now;
    if (dtMs > 100) dtMs = 100;                       // hitch clamp, 100 ms
    const dt = S.freezeTime ? 0 : dtMs / 1000;
    time += dt;

    pollInput();

    const tFrame = performance.now();

    character.update(dt, rig);
    terrain.heightfield.clampToPlayArea(character.position);
    // Pose and simulate before the contact pass: the footprints are stamped
    // at the boot's actual planted position, which only exists once the
    // figure has been solved.
    figure.update(dt);
    contact.update(dt);
    const tChar = performance.now();

    _vel.copyFrom(character.velocity);
    rig.update(dt, character.position, _vel, character.lean, character.speed01);

    // Jitters the projection and republishes everything the screen-space
    // passes derive from the camera. Must be after the rig has moved and
    // before anything reads `scene.getTransformMatrix()` — which the depth
    // prepass and the beauty pass both do.
    post.update(dt, character.streak01, rig.distance);
    sky.update();
    sky.render(rig, time);
    shadows.update(rig.camera, sky.sunDir);
    // After the shadow refit, so the water and the ice carry this frame's
    // cascade matrices; before the terrain, so the brushes every spell
    // writes are in the staging array when the simulation pass runs.
    spells.update(dt, rig.camera.position);
    const tSpells = performance.now();
    terrain.update(rig.camera.position, character.position, dt);
    const tTerrain = performance.now();
    // After the shadow refit, so the figure's uniforms carry this frame's
    // cascade matrices rather than last frame's.
    figure.sync(rig.camera.position);
    // Before the spray: the wake decides where its own lip is, and the
    // grains it sheds have to be in the pool before the pool is uploaded.
    wake.update(dt, rig.camera.position);
    spray.update(dt, rig.camera.position);
    const tVfx = performance.now();

    scene.render();
    post.endFrame();
    const tRender = performance.now();

    mark("cpu character", tChar - tFrame);
    mark("cpu spells",    tSpells - tChar);
    mark("cpu terrain",   tTerrain - tSpells);
    mark("cpu wake+spray",tVfx - tTerrain);
    mark("cpu submit",    tRender - tVfx);
    mark("cpu total",     tRender - tFrame);
    stats.gpuMs = engine.getGPUFrameTimeCounter().lastSecAverage / 1e6;

    endFrameDraws();
    stats.triangles =
        (terrain.mesh.metadata ? terrain.mesh.metadata.triangles : 0) +
        (S.showCharacter ? figure.triangles : 0) +
        (wake.mesh.isVisible ? wake.mesh.metadata.triangles : 0) +
        spells.triangles +
        spray.liveCount * 2;

    sample(dtMs);
    checkSpike(dtMs);
    overlay.update(dtMs, engine);

    endFrame();      // input accumulators cleared LAST
});
```

### The ordering constraints, restated as rules

| # | Rule | Reason (from the source comments) |
|---|---|---|
| 1 | `pollInput()` first | Resolve held keys into axes before anything reads them. |
| 2 | `character.update` before `figure.update` before `contact.update` | *"the footprints are stamped at the boot's actual planted position, which only exists once the figure has been solved."* |
| 3 | `rig.update` after the character moves | The spring chases the character's new position. |
| 4 | **`post.update` immediately after `rig.update`, before anything renders** | *"Must be after the rig has moved and before anything reads `scene.getTransformMatrix()` — which the depth prepass and the beauty pass both do."* This is where the jitter is written and frozen. |
| 5 | `sky.update()` then `sky.render()` | Re-bake the LUTs only if the sun moved, then draw the skybox. |
| 6 | `shadows.update` before `spells.update` and before `figure.sync` | *"so the water and the ice carry this frame's cascade matrices"* / *"so the figure's uniforms carry this frame's cascade matrices rather than last frame's."* |
| 7 | `spells.update` **before** `terrain.update` | *"so the brushes every spell writes are in the staging array when the simulation pass runs"* (the deformation sim is inside `terrain.update`). |
| 8 | `wake.update` before `spray.update` | *"the wake decides where its own lip is, and the grains it sheds have to be in the pool before the pool is uploaded."* |
| 9 | `scene.render()` then `post.endFrame()` | Latch `prevViewProj` and advance `historyValid` only after the frame is submitted. |
| 10 | `endFrameDraws()` after `scene.render()` | Latch a whole frame's draw count, not a partial one. |
| 11 | `endFrame()` (input) very last | Clear `lookX/lookY/zoomDelta/spellPressed` after every consumer has read them. |

| Identifier | Value | Units |
|---|---|---|
| hitch clamp | `100` | ms |
| `dt` when `freezeTime` | `0` | s |
| GPU ms conversion | `lastSecAverage / 1e6` | ns → ms |
| triangle count for spray | `liveCount × 2` | two triangles per billboard |
| spike-counter reset delay | `800` ms after `loading.done()` | |

`globalThis.SNOWFLOW` is populated at the end with every system plus `S`, `input` and
`perfStats` — used by the overlay's copy-pose one-liner.

---

# 16. WebGL2 / Three.js r172 PORTING NOTES

## 16.1 Compute and storage

| Reference construct | WebGL2 equivalent |
|---|---|
| WebGPU compute shaders | **None exist in WebGL2.** Every pass in this chain is already a full-screen fragment pass, so nothing here needs porting — but the deformation simulation (outside this spec) must stay a full-screen fragment pass too. |
| Storage textures / read-write bindings | Ping-ponged framebuffers. This chain already ping-pongs `history[0..1]`; keep it. |
| `_forcedOutputTexture` indirection | Delete it. Bind targets explicitly per §1.2; the reference's aliasing (shafts writing into bloomA's texture, etc.) is a Babylon artefact, not a design element. |
| WebGPU timestamp queries (`engine.captureGPUFrameTime`) | **Unavailable.** `EXT_disjoint_timer_query_webgl2` is not exposed in browsers by default. Show a dash for `gpu ms`, exactly as the overlay already does when the counter reads 0. Keep the CPU `performance.now()` marks — they are the real content of the "Frame budget" panel anyway (the overlay labels them `cpu` for that reason). |

## 16.2 Texture formats

| Reference | WebGL2 |
|---|---|
| `TEXTURETYPE_HALF_FLOAT` + `TEXTUREFORMAT_RGBA` render target | `RGBA16F` internal format. **Requires `EXT_color_buffer_float`** (or `EXT_color_buffer_half_float`) to be renderable. Three.js: `new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat })`. Check `renderer.extensions.get('EXT_color_buffer_float')` at boot and fail loudly, the way the reference fails loudly on missing WebGPU. |
| Bilinear filtering of RGBA16F | Guaranteed in WebGL2 core for half-float (`OES_texture_half_float_linear` behaviour is core). Full-float linear filtering is **not** — but this chain only needs half-float. |
| `TEXTURETYPE_UNSIGNED_BYTE` composite target | `RGBA8` — **not** `SRGB8_ALPHA8`. The composite already emits sRGB-encoded values via `linearToSrgb`. In Three.js set `renderTarget.texture.colorSpace = THREE.NoColorSpace` and `renderer.outputColorSpace = THREE.NoColorSpace` for the final blit, or the encode runs twice and the frame goes flat and milky. |
| Prepass RGBA16F, NEAREST | Same. `minFilter = magFilter = THREE.NearestFilter`, `wrapS = wrapT = THREE.ClampToEdgeWrapping`. |
| Clear colour `(9000, 0, 0, 1)` on a half-float target | Half float max is 65504, so 9000 is representable exactly enough. Use `renderer.setClearColor` with a `Vector4`-style manual clear or `gl.clearBufferfv(gl.COLOR, 0, [9000,0,0,1])` — Three.js `setClearColor` clamps to [0,1], so **clear this target manually** or write 9000 from a sky/background fragment. This is a real trap. |

## 16.3 WGSL → GLSL 3.00 es translation table

| WGSL | GLSL 3.00 es |
|---|---|
| `textureSampleLevel(t, s, uv, 0.0)` | `textureLod(t, uv, 0.0)` |
| `textureSample(t, s, uv)` | `texture(t, uv)` (implicit LOD — only legal outside non-uniform control flow) |
| `textureLoad(t, coord, 0)` | `texelFetch(t, ivec2(coord), 0)` |
| separate `texture_2d<f32>` + `sampler` | one combined `sampler2D` uniform |
| `select(f, t, cond)` | `cond ? t : f` (scalar) or `mix(f, t, vec3(cond))` (vector) — **note the reversed argument order** |
| `vec2f/vec3f/vec4f` | `vec2/vec3/vec4` |
| `mat3x3f(a,b,c, d,e,f, g,h,i)` | `mat3(a,b,c, d,e,f, g,h,i)` — same column-major argument order, **no transpose** |
| `mat4x4f * vec4f` | `mat4 * vec4` — same convention |
| `let` / `var` | `const`-ish local / mutable local; GLSL `const` requires a constant initialiser, so use plain locals |
| `any(v < vec2f(0.0))` | `any(lessThan(v, vec2(0.0)))` |
| `any(raw != raw)` (NaN test) | `any(notEqual(raw, raw))` — and be aware some drivers optimise this away under fast-math; a belt-and-braces alternative is `any(lessThan(abs(raw), vec3(0.0)))` or a `max(raw, vec3(0.0))` sanitiser |
| `f32(i)` | `float(i)` |
| `i32` loop counters | `int` |
| `fract` | `fract` — **identical semantics** (`x - floor(x)`), including for negatives. Both languages define it the same way, so `ignPost`, the grain hash and `streakStrands` port unchanged. |
| `atan2(y, x)` | `atan(y, x)` |
| `input.position.xy` (fragment builtin) | `gl_FragCoord.xy` — both are pixel-centre (`+0.5`) coordinates |
| `varying vUV: vec2f` | `in vec2 vUV` in the fragment stage |
| `fragmentOutputs.color = …` | `out vec4 fragColor; fragColor = …;` |
| early `return` inside `main` | Legal in GLSL. The reference wraps every early-out in a helper because *"Babylon rewrites a fragment `main` to return its `FragmentOutputs` struct, so a bare `return` inside one does not compile."* The port may inline them, but keeping the helpers preserves the structure. |

## 16.4 Matrix conventions

* **Babylon** stores `Matrix.m` as 16 floats with **row-vector** semantics (`v_row × M`), rows
  at `m[0..3]`, `m[4..7]`, `m[8..11]`, `m[12..15]`; translation at `m[12..14]`.
* **Three.js / GLSL** use **column-vector** semantics (`M × v_col`) with `Matrix4.elements`
  in **column-major** order (`elements[col*4 + row]`); translation at `elements[12..14]`.
* Numerically, a Babylon matrix's `m` array and the equivalent Three.js matrix's `elements`
  array hold **the same 16 numbers in the same slots** — Babylon's row-major-with-row-vectors
  and Three's column-major-with-column-vectors are transposes of each other twice over. So
  `m[8]` ↔ `elements[8]` is the same element: **row 0, column 2** of the mathematical matrix,
  the coefficient that multiplies view-space `z` into clip-space `x`.

**The jitter write, ported:**

```js
// Reference (Babylon, left-handed, clip.w = +view.z):
pm.m[8] += jitterNdc.x;   //  ndc.x moves by +jitterNdc.x
pm.m[9] += jitterNdc.y;

// Three.js (right-handed, clip.w = -view.z):
camera.projectionMatrix.elements[8] -= jitterNdc.x;   // sign FLIPPED
camera.projectionMatrix.elements[9] -= jitterNdc.y;
camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
```

The **invariant to preserve**: after the write, a projected world point's NDC position must
move by **+jitterNdc**, and the TAA shader must subtract the same `jitterNdc` when
reconstructing the view ray (`ndc = uv*2 - 1 - jitterNdc`). Verify with a one-off test: render
a 1-pixel marker at a known world position with jitter `(+0.5, 0)` px and confirm it moves
right, not left.

Three.js has no `freezeProjectionMatrix`. The equivalent discipline: apply the jitter **once**
per frame, after any `camera.updateProjectionMatrix()` call, and **never call
`updateProjectionMatrix()` again** before the frame is submitted — including inside a resize
handler that fires mid-frame. A defensive pattern is to keep an unjittered
`projectionMatrixUnjittered` copy, rebuild it explicitly when fov/aspect change, and derive
the jittered matrix from it each frame.

## 16.5 Handedness — the changes that follow from Three.js's right-handed view space

The reference's view space is **left-handed with +z forward**. Three.js's is right-handed with
**−z forward**. Two options; pick one and be consistent:

**Option A (recommended): keep the reference's math, negate at the boundary.** Define the
port's "view z" as a **positive distance** (`-viewPos.z`), exactly what the prepass already
stores. Then:

| Reference | Port |
|---|---|
| `viewFromDepth` returns `(ndc.x·pi.x, ndc.y·pi.y, 1.0) · z` | `(ndc.x·pi.x, ndc.y·pi.y, **-1.0**) · z` — z is still a positive distance |
| `uvFromView`: `p.x / (pi.x · p.z)` | `p.x / (pi.x · **(-p.z)**)`, same for y |
| SSR `if (R.z < 0.02) return miss;` | `if (**-R.z** < 0.02) return miss;` |
| SSR `let diff = Q.z - sz;` | `float diff = **-Q.z** - sz;` |
| SSR `if (M.z - mz > 0.0)` | `if (**-M.z** - mz > 0.0)` |
| SSR `let V = normalize(P);` | unchanged (still camera-origin-to-surface) |
| SSR `cross(dx, dy)` | unchanged — see §4.5; reproduce the sign as-is |
| TAA `view = (…, 1.0) * min(z, POST_FAR)` | `(…, **-1.0**) * min(z, POST_FAR)` |
| `invView * vec4(view, 1)` | `camera.matrixWorld * vec4(view, 1)` |
| `_camForward` from `m[2], m[6], m[10]` | `camera.getWorldDirection(v)` |

**Option B:** flip the whole port to +z-forward with custom matrices. Do not — it fights the
library everywhere else.

`projInfo = (tan(fovY/2) · aspect, tan(fovY/2))` is handedness-free and ports unchanged.
In Three.js: `const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);`
(Three stores fov in **degrees**; the reference stores radians).

## 16.6 The vertical-flip question

The reference derives, once, that `vUV` and `fragCoord.xy / renderSize` are the same number
and that a projected world point lands at `ndc·0.5 + 0.5` with **no flip anywhere**.

In WebGL2 that relationship holds naturally when rendering into FBOs: texture origin is
bottom-left, `gl_FragCoord` origin is bottom-left, and `uv = gl_FragCoord.xy / resolution` is
consistent with `ndc·0.5 + 0.5`. So a straight port with a fullscreen triangle and
`vUv = position.xy * 0.5 + 0.5` needs **no flip** in any of: the sun UV, the TAA
reprojection, depth sampling, colour sampling, or the shafts march.

The one place to check is the **final blit to the default framebuffer**, where some setups
(and some Three.js `WebGLRenderTarget` round-trips) introduce a flip. Verification procedure:
enable the shafts pass with a sun near the top of the frame; if the shafts converge on a point
at the **bottom** of the image, exactly one flip has been introduced somewhere upstream.

## 16.7 Precision and half-float behaviour

* Prepass depth in half float: relative precision 2⁻¹¹ ≈ 0.05% of the distance — 5 mm at 10 m,
  15 cm at 300 m. Every consumer works in "fraction of the distance to the pixel" units, so
  this is safe. Keep half float; do not "upgrade" to RGBA32F (it doubles the bandwidth of a
  target written once and read a dozen times, and full-float linear filtering is not core).
* `POST_FAR = 9000.0` is exactly representable in half float (9000 = 1.098×2¹³, well within
  the 2048–65504 range where the spacing is 8; the nearest half-float values are 8996 and
  9004 — the `> 4500` background test has enormous margin, so this does not matter).
* Fragment shaders must declare `precision highp float;` **and** `precision highp sampler2D;`
  — a `mediump` sampler on a half-float depth target will quantise 9000 into nothing useful.
* AgX's `log2(max(v, 1e-10))` needs highp. `1e-10` is below the mediump denormal floor.
* The grain hash `fract(sin(x) * 43758.5453)` is precision-sensitive on some mobile drivers;
  on desktop WebGL2 with highp it matches.

## 16.8 Loop and branch restrictions

GLSL 3.00 es requires loops with a constant-expression bound to be unrollable on some
drivers. All the loops here have compile-time constant bounds (`STEPS 24`, `STEPS 28`,
`REFINE 5`, `TAPS 16`, `3×3`, `6`, `9`, `13`) — no changes needed. Keep them as literal
`const int`s, not uniforms.

The reference notes that in the composite's smear loop it uses `textureSampleLevel` rather
than `textureSample` because *"this loop sits under a non-uniform branch, where implicit
derivatives are undefined."* Same rule in GLSL: inside `if (streak > 0.002)` use
`textureLod(..., 0.0)`, not `texture(...)`.

## 16.9 Things that have no equivalent and should simply be dropped or replaced

| Reference | Port |
|---|---|
| `engine.setHardwareScalingLevel(1 / S.resolutionScale)` | `renderer.setPixelRatio()` / explicit `setSize(w*scale, h*scale, false)`. Every render target must be resized with it, and `postChain.resetHistory()` must be called. |
| `PostProcess` / `ShaderStore` / `IncludesShadersStoreWGSL` | A hand-rolled fullscreen-quad pass runner and a `#include`-style string preprocessor for `postCommon`. |
| `setTextureFromPostProcessOutput` | Explicit target binding (§1.2). |
| `whenReady(obj, label)` / `isReady()` gating | `renderer.compile(scene, camera)` plus a warm-up loop that draws each post pass once into a 1×1 target before the loading screen lifts. The intent — *"a shader that first compiles when the player casts a spell is a multi-hundred-millisecond freeze"* — is what must survive, not the API. |
| `Constants.TEXTURE_CLAMP_ADDRESSMODE` | `THREE.ClampToEdgeWrapping` |
| `scene.setRenderingAutoClearDepthStencil(group, false)` | Render opaque and transparent in two explicit passes into the same target without clearing depth between them. |

---

# 17. VISUAL ACCEPTANCE CRITERIA

A harsh critic should be able to check each of these from screenshots or a short capture.
They are ordered from "most likely to be wrong" to "polish".

1. **The snow field is stable, not crawling.** Hold the camera still for three seconds at the
   default 13° sun. The glint field must be *present* (individual sparkle points visible on
   sunlit slopes) and *stationary* — no shimmering, no twinkling that migrates across the
   surface, no aliased ants on the sastrugi ridges. A port with TAA disabled, with the jitter
   applied to only one of the depth/beauty passes, or with a wrong-signed `jitterNdc`
   subtraction in the reprojection, will show a field that visibly seethes. This is the single
   highest-value check in the document.

2. **Motion does not smear.** Sprint past a dune crest, then stop. During motion, the
   character and the surf wake must have crisp silhouettes with no comet-tail of previous
   frames trailing behind them, and the terrain behind them must not show a ghost of where the
   character was. If ghosting appears, the variance clip (`mu ± 1.35σ`) is wrong — most likely
   the statistics were gathered in linear rather than Karis-weighted space, or a min/max box
   was substituted for the variance clip.

3. **The resolved frame is not softer than the raw render.** Toggle sharpen off and compare a
   still frame against a TAA-off, jitter-off render at the same pose. The TAA-on frame may be
   *marginally* softer, never obviously so. A frame that looks like a grey slope where the raw
   render shows grain means the Catmull-Rom history fetch was replaced by a bilinear tap, or
   the five weights were normalised.

4. **Bloom is a broad atmospheric glare, not a ring.** Point the camera at the sun. The glow
   must be dominated by the wide, soft, sixteenth-resolution level (weighted `0.65`) with only
   a tight core from the quarter-resolution level (weighted `0.35`). A visible hard-edged
   annulus around the sun disc, or faceting in the halo, means the tent blur or the ×2 tap
   spacing is wrong.

5. **Bloom does not flicker as the glint field turns over.** Rotate the camera slowly across a
   sunlit slope while watching only the glow. The bloom must change smoothly. Pulsing or
   fizzing in the glow — even while the glints themselves are stable — is the Karis average
   missing from the prefilter.

6. **Light shafts converge on the sun, fade out radially, and vanish at a high sun.** With the
   default sun, crests must throw visible fan-shaped beams that emanate from the sun's screen
   position and die out well before the frame corners. Drag `sunElevation` to 45°: the shafts
   must become effectively invisible **without a pop**. Turn the camera 180°: they must
   disappear entirely (`sunOnScreen` gate). Concentric rings or steps around the sun mean the
   IGN start dither is missing.

7. **Shafts are additive light, not a haze overlay.** Where a shaft crosses a dark shadowed
   slope it must *lift* that slope's colour toward the sun's warm hue without flattening its
   texture. If shadowed detail disappears under a uniform milky wash, the shaft was blended
   rather than added, or it was added after exposure instead of before.

8. **Depth of field is barely there.** The near berm the camera is nearly sitting on is
   *slightly* soft; the ridge two hundred metres away is essentially sharp; only the far
   range past ~300 m picks up any visible defocus at all. If dunes one or two hundred metres
   out are obviously blurry, `FAR_START`/`FAR_FULL` were re-keyed to the focal distance —
   the exact bug §7.4 documents.

9. **No defocus bleed across silhouettes.** Where the character stands against a defocused
   far ridge, there must be **no soft halo of background colour spilling onto the character's
   outline**. The per-tap CoC weight
   (`clamp(|sCoc|·maxCoc − rr + 1, 0, 1)`) is the only thing preventing this.

10. **Ice reflects the world, not just the sky — and only ice does.** Cast Crystallise, then
    look at the prisms at a grazing angle with a dune behind the reflection direction. The
    prism faces must show the *dune* (and the character, if it is in the reflected direction),
    not a plain sky gradient, and the reflection must **fade out smoothly** where the reflected
    ray leaves the screen rather than ending in a hard line. On any frame with no ice on
    screen, nothing anywhere in the image may change when SSR is toggled.

11. **Bright sunlit snow retains form; it does not clip to a white sheet.** With AgX at the
    default exposure `0.105` and contrast `1.14`, the brightest lit dune face must still show
    readable gradation across its slope — the reference target is roughly AgX-normalised 0.79,
    a stop and a quarter below the shoulder. Switch to ACES: the frame must visibly get
    *worse* on this content — bright snow pushes warm and the last stop crushes. If AgX and
    ACES look about the same, the AgX 2.2 EOTF power was skipped (which double-encodes and
    lifts everything toward flat, milky mid-grey) or the AGX_IN/AGX_OUT matrices were
    transposed.

12. **Cool shadows, warm light.** Shadowed snow must be distinctly blue-shifted and lit snow
    distinctly warm — the split must survive the tonemapper. `agxLook(v, 1.14)` is what
    prevents AgX's highlight desaturation from flattening it. A frame where lit and shadowed
    snow differ only in brightness has lost the saturation recovery.

13. **Speed streaks live only in the periphery.** Hold right mouse and carve at full speed:
    radial smear and sparse blue-white spindrift strands must appear around the edges of the
    frame while the centre — where the character is — stays sharp. Strands in every angular
    cell, or a smear that reaches the centre, is wrong (`smoothstep(0.34, 1.05, radius)` and
    the `rnd > 0.34` occupancy gate).

14. **Grain is even across the tonal range and does not swim.** It must be equally visible in
    the darkest shadow and the brightest lit slope (it is applied *after* the sRGB encode), and
    it must scintillate per frame at a fixed screen-space cell size independent of render
    resolution (the `(1920, 1080)` basis). Grain that vanishes in shadows was applied in
    linear.

15. **Sharpening steepens edges without haloing flat snow.** Compare `sharpenStrength` 0 and
    0.55. Ridge lines and the character's silhouette get crisper; a flat expanse of lit snow
    gains no bright rim and no dark ring. A visible halo means the local min/max clamp was
    dropped, or the pass was moved before the tonemapper.

16. **The camera never enters the snow, and never jolts out of it.** Surf across a crest with
    the camera behind you. The arm must lift *before* the crest fills the frame (the six-point
    arm probe, not just the eye) and settle back down slowly (rise rate 26/s, relax rate
    4.5/s). A frame or two of white filling the screen, or a snap downward as the crest
    passes, are both failures.

17. **The vignette is barely perceptible.** At `0.22` it should be noticeable only by A/B —
    a slight darkening in the corners that keeps the eye centred. If the corners read as
    obviously shaded, the `smoothstep(1.05, 0.35, d)` bounds or the `1.414` radius scale are
    wrong.

---

# Appendix A — index of every numeric constant captured

Grouped by subsystem. Count is given per group and totalled at the end.

## A.1 postCommon (6)

`POST_FAR 9000.0` · background factor `0.5` · IGN scale `52.9829189` · IGN vector
`(0.06711056, 0.00583715)` · Rec.709 luma `(0.2126, 0.7152, 0.0722)` · Karis unweight floor
`1e-4`

## A.2 TAA + jitter (20)

Halton bases `2` and `3` · Halton count `8` · Halton offset `-0.5` · jitter NDC factor `2` ·
`feedback 0.90` · variance width `1.35` · neighbourhood `3×3`/`9` · motion normaliser `64.0`
· motion fade depth `0.35` · clip gain `4.0` · clip fade depth `0.45` · feedback ceiling
`0.97` · `prevClip.w` reject `1e-4` · history-valid gate `0.5` · history-valid step `0.5` ·
Catmull-Rom coefficients `-0.5`, `1.0`, `-2.5`, `1.5`, `0.5`, `2.0` (six distinct polynomial
coefficients counted as one entry each) · CR neighbour offsets `-1.0`, `+2.0` · history
texture count `2`

## A.3 SSR (13)

`STEPS 28` · `REFINE 5` · `THICKNESS 0.55` · mask gate `0.02` · `R.z` reject `0.02` · stride
floor `0.06` · stride scale `0.035` · start dither `0.5` · step growth `0.16` · edge fade
`0.10` · Schlick F0 `0.045` · Schlick complement `0.955` · Schlick exponent `5.0` ·
`strength 1.0`

## A.4 Shafts (9)

`STEPS 24` · `REACH 0.82` · `DECAY 0.955` · radial inner `0.03` · radial outer `0.68` ·
radial skip `0.001` · sun proxy distance `2000` · `sunOnScreen` threshold `0.05` ·
`shaftStrength 0.30`

## A.5 Bloom (12)

threshold `3.0` · knee `1.4` · curve.w numerator `0.25` · knee floor `1e-4` · inner group
weight `0.5` · outer group weight `0.125` · group mean `0.25` · tap offsets `1` and `2` ·
divide floors `1e-5` · tent weights `1,2,4` and `1/16` · tap spacing multiplier `2.0` ·
ratios `0.25` and `0.0625`

## A.6 DOF (13)

`TAPS 16` · `GOLDEN 2.39996323` · `FAR_START 130.0` · `FAR_FULL 620.0` · near far-edge
`0.55` · near near-edge `0.16` · tap `+0.5` · `2π = 6.28318530718` · gather early-out `1.5` ·
per-tap weight `+1.0` · background CoC `1.0` · `maxCoc` scale `0.0024` · focus ease `4.0` ·
initial focus `6.2`

## A.7 Composite / tonemap (46)

radius scale `2.0` · periphery smoothstep `0.34`, `1.05` · streak gate `0.002` · smear taps
`6` · smear reach `0.026` · smear divisor `7.0` · smear mix `0.88` · angular cells `96.0` ·
hash `12.9898`, `4.1`, `43758.5453` · occupancy `0.34` · across power `20.0` · radial
frequency `11.0`, `24.0` · scroll `7.0`, `22.0` · dash window `0.55`, `0.86`, `1.0` · strand
colour `(0.88, 0.94, 1.06)` · strand gain `0.16` · shaft gate `0.0001` · bloom near `0.35` ·
bloom far `0.65` · bloom gate `0.0001` · middle grey `0.18` · contrast gate `0.001` · pow
floor `1e-5` · AGX_IN 9 values · AGX_OUT 9 values · `MIN_EV -12.47393` · `MAX_EV 4.026069` ·
log2 floor `1e-10` · polynomial `15.5`, `-40.14`, `31.96`, `-6.868`, `0.4298`, `0.1191`,
`-0.00232` · `agxLook` sat `1.14` · AgX EOTF `2.2` · ACES `2.51`, `0.03`, `2.43`, `0.59`,
`0.14` · mode thresholds `0.5`, `1.5` · vignette `0.22` · vignette radius `1.414` · vignette
ramp `1.05`, `0.35` · vignette gate `0.001` · sRGB `12.92`, `1.055`, `0.055`, `2.4`,
`0.0031308` · grain basis `(1920.0, 1080.0)` · grain scroll `91.7`, `43.3` · grain hash
`12.9898`, `78.233`, `43758.5453` · grain centring `0.5` · grain gate `0.0001`

## A.8 Sharpen (3)

`k` scale `0.32` · centre gain factor `4.0` · activation gate `0.001`

## A.9 Depth prepass (3)

`DEPTH_FAR 9000` · clear `(9000, 0, 0, 1)` · mask values `0.0` / `1.0`

## A.10 Camera rig (34)

initial position `(0, 3, -6)` · `minZ 0.12` · `maxZ 4200` · `fov 1.02` · `inertia 0` · `yaw
2.4` · `pitch 0.17` · `distance 6.2` · `shoulder 0.85` · `pivotHeight 1.62` ·
`groundClearance 1.35` · `ARM_SAMPLES 5` · `PITCH_MIN -0.62` · `PITCH_MAX 1.05` · `DIST_MIN
2.6` · `DIST_MAX 11.0` · zoom sensitivity `0.35` · zoom ease `9` · lead `1.35`, `0.09` ·
spring freq `7.5` · spring damping `1.0` · integrator clamp `1/45` · FOV gain `0.19` · FOV
ease `3.2` · roll gain `0.085` · roll ease `5.0` · eye rise `0.22` · clearance ease `0.35`,
`0.65` · lift rise `26` · lift relax `4.5` · trauma decay `1.15` · shake freq `26` · shake
offsets `31.7`, `71.3` · shake amplitudes `0.16`, `0.10` · rot shake freqs `31`, `29`, `23` ·
rot shake offsets `11`, `53`, `97` · rot shake amplitudes `0.02`, `0.05` · shake gate
`0.0001` · noise hash `127.1`, `43758.5453`

## A.11 Input (3)

`LOOK_SCALE 0.0022` · wheel scale `0.0016` · move threshold `0.001`

## A.12 Character values consumed by the chain (4)

`streak01` low bound `7` m/s · `streak01` range `11` m/s · `SURF_MAX 19.5` m/s · trauma load
threshold `0.25` and gain `1.35`

## A.13 Settings defaults and ranges (49 keys)

Every key in §13.1 with its default, min, max and step. Counted as **49 distinct default
values** (the ranges add a further 100+ bounds, not counted separately here).

## A.14 Perf / overlay / loading (24)

`CAP 512` · recompute throttle `250` ms · spike threshold `+4` ms · percentiles `0.5`,
`0.95`, `0.99` · graph size `304×66` · axis initial `22` · axis clamp `60` · axis gain
`1.25` · axis ease `0.08` · budget guides `11.1`, `16.7` · graph refresh `50` ms · camera
refresh `100` ms · readout refresh `250` ms · panel width `336` px · fps warn `88` / bad `60`
· 1%-low warn `75` / bad `60` · loading phases `0.05`, `0.12`, `0.20`, `0.34`, `0.62`,
`0.78`, `0.92`, `1.0` · `done()` delay `360` ms · hint timeout `6000` ms · spike reset delay
`800` ms

## A.15 Frame orchestration (5)

hitch clamp `100` ms · warm-up frames `3` · spell warm-up offset `+3` m · `whenReady` timeout
`25000` ms · GPU ns→ms divisor `1e6`

---

## Total distinct numeric constants captured

| Group | Count |
|---|---|
| A.1 postCommon | 6 |
| A.2 TAA + jitter | 20 |
| A.3 SSR | 13 |
| A.4 Shafts | 9 |
| A.5 Bloom | 12 |
| A.6 DOF | 13 |
| A.7 Composite / tonemap | 46 |
| A.8 Sharpen | 3 |
| A.9 Depth prepass | 3 |
| A.10 Camera rig | 34 |
| A.11 Input | 3 |
| A.12 Character values | 4 |
| A.13 Settings defaults | 49 |
| A.14 Perf / overlay / loading | 24 |
| A.15 Frame orchestration | 5 |
| **Total** | **244** |
