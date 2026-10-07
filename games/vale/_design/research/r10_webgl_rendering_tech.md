# R10: High-End WebGL2 Rendering in Three.js r186, with a Quality Ladder for 1080p60

**Project:** VALE (Forgeflow Games), an original browser-based competitive lane-brawler (custom TypeScript + Three.js client)
**Date:** 2026-10-07
**Committed stack (as installed in `games/vale/package.json`):** three 0.186.1 [2], postprocessing 6.39.5 [81], n8ao 2.0.1 [82], @gltf-transform 4.5.1, meshoptimizer 1.3.0, Vite 8; art in Blender 5.2.
**Target:** a stable 60 fps at 1920x1080 on a reasonable gaming PC, with Low/Medium/High/Ultra presets that scale down cleanly.

**Method note.** Facts come from four kinds of source:
1. **Primary source code and docs** for the exact versions we ship. The three 0.186.1, postprocessing 6.39.5, n8ao 2.0.1, @gltf-transform/cli 4.5.1 and ktx2-encoder 0.6.0 tarballs were pulled from the npm registry and read directly. three.js r186 examples and manual pages were read from the `r186` tag on raw.githubusercontent.com. MDN pages and browser-compat data were read from MDN's GitHub sources.
2. **Web search snippets**, for community threads and vendor pages. The egress proxy blocked direct fetches from threejs.org, developer.mozilla.org and github.khronos.org.
3. **Local experiments** in this container. A Blender 5.2.2 LTS build (`bpy` as a Python module) is installed here, so the Blender claims below were checked against the real exporter and renderer. Experiments are labeled **[L1]–[L6]** and described in the "Local verification log" at the end.
4. **My own engineering analysis**, labeled *analysis*.

The shared web-search budget ran out partway through, before the character-crowd and VAT topics were searched. Those sections lean on source code and local experiments instead. Numbers that could not be confirmed are marked **[unverified]**.

---

## 0. Executive summary

1. **Keep `WebGLRenderer` and pmndrs `postprocessing` for launch.** The three.js manual itself still calls `WebGPURenderer` experimental. It also says `onBeforeCompile`, `ShaderMaterial` and `EffectComposer` don't work there, and N8AO doesn't support WebGPU yet [73][13]. r186 adds a real migration path: TSL node materials can now run inside `WebGLRenderer` through `WebGLNodesHandler` [52][75]. Use that path for new custom shaders where possible.
2. **Use the new r186 `SunLight` (or a hand-fitted single shadow map) for sun shadows, not the old CSM addon.** `SunLight` ships with r186. It casts two cascaded maps, fits each cascade with a bounding sphere, and snaps them to the texel grid to stop shimmer [1][16][17]. Also note that `PCFSoftShadowMap` is deprecated in r186: setting it logs a warning and the renderer falls back to `PCFShadowMap`, which now samples a rotated Vogel disk [3][18][19].
3. **Post chain:** half-float buffers → N8AO → mipmap bloom → AgX (or Neutral) tone mapping → 3D LUT → vignette → SMAA. Tone mapping belongs at the end of the post chain, with the renderer's own tone mapping turned off [9]. N8AO's README rules out hardware MSAA and recommends SMAA [13].
4. **Terrain:** splat-mapped PBR with 4 to 8 layers, stored as texture arrays. KTX2 files with several layers already load as `CompressedArrayTexture` [38]. Restrict triplanar sampling to cliffs.
5. **Characters:** heroes stay `SkinnedMesh` with GPU skinning through a bone texture [47][87]. Minion crowds go through `InstancedMesh` with vertex-animation textures (VAT). VAT baking works from Blender [L6], but the bake must use the **final, welded** vertex order [L4].
6. **Pipeline:** Blender 5.2 exports each action as its own glTF clip [L3]. Compress with gltf-transform using `EXT_meshopt_compression` [42][L4]. Encode KTX2 with an npm-only encoder (ktx2-encoder) or with KTX-Software ≥ 4.4.0 [44][L4][L5].
7. **Competitive fairness:** no quality preset may change what a player can *see* in gameplay terms. Fog of war, telegraphs, brush and silhouettes must look the same at every tier (*analysis*).

---

## 1. Post-processing and image pipeline

### 1.1 Tone mapping: AgX vs ACES vs Neutral

- **What r186 offers.** Renderer tone-mapping constants are `NoToneMapping`, `Linear`, `Reinhard`, `Cineon`, `ACESFilmic`, `Custom`, `AgX` (6) and `Neutral` (7) [3]. postprocessing's `ToneMappingEffect` mirrors these as `ToneMappingMode.ACES_FILMIC`, `AGX` and `NEUTRAL` [10].
- **ACES Filmic in three** is a fitted approximation, not a full ACES pipeline. The shader comment says it was changed for a brighter viewing environment with a subjective 1/0.6 scale [4]. Forum users report that it washes out textures, lowers contrast and saturation, and shifts hues [8]. Hue shift is a known ACES trait [6].
- **AgX in three** follows Filament's port of Blender's AgX, using Rec.2020 primaries. It applies **no "look"**: the look call is commented out, and gamut mapping is a plain clamp [4]. Community comparisons describe AgX as handling highlights better than ACES but looking less saturated and flatter by default. Blender's "Punchy" look is closer to ACES saturation [6][7].
- **Neutral (Khronos PBR Neutral)** is Khronos' recommended tone mapper for glTF/PBR content. It keeps base-color hue and saturation and only compresses highlights. Khronos released the spec in May 2024, and three.js is listed among the adopters [5].
- **Blender parity.** Blender 5.2's view transforms include `AgX` (the default), `Khronos PBR Neutral`, `Filmic`, `Standard`, `ACES 1.3` and `ACES 2.0` [L2]. *Analysis:* artists can preview heroes in Blender with exactly the operator the game uses (AgX with no look, or Khronos PBR Neutral). Blender's ACES 1.3/2.0 will **not** match three's fitted ACES.

*Recommendation (analysis):* use **AgX** for the game view, and apply the punch (contrast and saturation) through the 3D LUT rather than through the tone mapper. Keep **Neutral** for the hero-select and store showcase, where accurate skin and cosmetic colors sell the product. Expose exposure as a single owned value, because double-applied exposure is a common bug [7].

### 1.2 Where tone mapping lives with postprocessing

- postprocessing's README says that when its composer is in use, `renderer.toneMapping` should stay at `NoToneMapping` and high-precision frame buffers should be on. A `ToneMappingEffect` then goes at the end of the chain. Otherwise colors are clamped to [0,1] at the start of the pipeline [9].
- The library's default intermediate buffers are 8-bit sRGB, which band in dark scenes. `frameBufferType: HalfFloatType` is the recommended setting for HDR work on desktop [9]. three's color-management manual makes the same point: linear data needs at least 12 bits (half float) to avoid banding [79].
- postprocessing's README also recommends creating the renderer with `antialias:false, stencil:false, depth:false` and `powerPreference:"high-performance"` [9].
- `EffectPass` merges compatible effects into one full-screen shader. **Convolution** effects (SMAA, bokeh, chromatic aberration) cannot be merged with each other [9][10].

### 1.3 Color grading with a 3D LUT

- postprocessing 6.39.5 exports `LUT3DEffect`, `LUT1DEffect`, `LUTCubeLoader` (`.cube`), `LUT3dlLoader` (`.3dl`) and `LookupTexture`. `LookupTexture.createNeutral(size)` builds an identity LUT, and `TetrahedralUpscaler` is included [10].
- `LUT3DEffect` options are `blendFunction`, `tetrahedralInterpolation` (default false) and `inputColorSpace` (default sRGB) [10]. Tetrahedral interpolation avoids the precision loss of hardware trilinear filtering [11].
- three's own example grades with `LUTPass`, `LUTCubeLoader`, `LUT3dlLoader` and `LUTImageLoader`, which reads PNG LUT strips [80].
- **LUT authoring workflow (analysis):**
  1. Render a reference screenshot that already has AgX applied, then place an identity LUT strip next to it. The identity can come from `LookupTexture.createNeutral(32)` exported to PNG, or from three's `LUTImageLoader` format.
  2. Grade that screenshot in any image editor, or in a grading tool that exports `.cube`.
  3. Load the result with `LUTCubeLoader` or `LUTImageLoader`. A LUT of size 32 or 33 is plenty.
  4. Keep one LUT per map or biome, plus a separate LUT for menus.
  5. Because the input is sRGB by default [10], put the LUT **after** tone mapping.

### 1.4 Bloom

- postprocessing's `BloomEffect` defaults to `mipmapBlur: true`, `luminanceThreshold: 1.0`, `luminanceSmoothing: 0.03`, `intensity: 1`, `radius: 0.85` and `levels: 8`. The older kernel-size and resolution-scale options are marked deprecated in favor of mipmap blur [10].
- Mipmap blur builds a chain of progressively blurred mip levels and combines them with weights, which gives good quality per millisecond [12].
- *Analysis:* with HDR buffers and a threshold of 1.0, only real highlights bloom: spell cores, crystals, emissive runes. That fits the VFX-hierarchy rule from R04 (the most dangerous part of an effect gets the most contrast). Scale `levels` by tier (5 / 6 / 8 / 8) instead of turning bloom off. Bloom is part of how players read ability strength.

### 1.5 Anti-aliasing: SMAA vs FXAA vs MSAA

- **MSAA conflicts with N8AO.** The N8AO README says hardware antialiasing does not work with its AO and recommends an SMAA pass [13]. postprocessing's composer does accept `multisampling` on WebGL2 [10], but we can't combine it with N8AO.
- **Cost evidence.** NVIDIA's FXAA 3.11 sample reports about 0.88 ms per frame at 1920x1080 on a GTX 460 and 0.39 ms on a GTX 560 [14]. Forum comparisons describe SMAA as costing about the same as FXAA while staying sharper [15]. Both figures are old hardware. *Analysis:* on a current mid-to-high GPU, either costs well under 0.5 ms at 1080p **[unverified for our scene]**.
- postprocessing's `SMAAEffect` defaults to `preset: MEDIUM` and `edgeDetectionMode: COLOR`. Predication is off by default. It is a convolution effect [10].
- *Recommendation:* SMAA at HIGH or ULTRA on High and Ultra tiers, MEDIUM on Medium, FXAA (`FXAAEffect` [10]) on Low. Run SMAA in its own `EffectPass` **after** tone mapping, so edge detection works on display-referred values (*analysis*).

### 1.6 N8AO (screen-space AO and contact darkening)

All of the following comes from the N8AO 2.0.1 README [13] unless marked otherwise:
- With pmndrs postprocessing, use `N8AOPostPass` after a `RenderPass`. Gamma correction is set automatically based on where the pass sits in the chain.
- **Quality modes:**

| Mode | AO samples | Denoise samples | Denoise radius |
|---|---|---|---|
| Performance | 8 | 4 | 12 |
| Low | 16 | 4 | 12 |
| Medium (default) | 16 | 8 | 12 |
| High | 64 | 8 | 6 |
| Ultra | 64 | 16 | 6 |

  2.0 also adds three neural-denoise modes: **Neural-Low**, **Neural-Medium** and **Neural-High**. They run 16 AO samples and 4/8/16 denoise samples at full resolution, and cost extra GPU time.
- **`halfRes = true`** is usually 2–4x faster. Depth-aware upsampling adds roughly 1 ms of fixed cost, and the README advises keeping it on. Half-res Ultra costs a bit more than full-res Performance but looks much better.
- **Changing quality settings recompiles the AO shaders.** Set them at startup or when the user changes the preset, never every frame.
- **Transparency awareness renders transparent objects twice.** Mark VFX quads `userData.treatAsOpaque` or keep `depthWrite:false`, which makes them "look completely correct". Otherwise turn off `transparencyAware` explicitly.
- `aoRadius` is in world units, and the README suggests one or two orders of magnitude below scene scale. `distanceFalloff` defaults to 1. `screenSpaceRadius` mode is also available.
- `enableDebugMode()` reports the pass's GPU time. It depends on `EXT_disjoint_timer_query_webgl2`, which browser-compat data lists for Chrome/Edge only, not Firefox or Safari [13][65].
- *Analysis for VALE:* the camera has a fixed pitch and narrow zoom range, so a world-space radius tuned once per map is stable. A plausible starting point is `aoRadius` 1.5–3 m with `distanceFalloff` 1 **[unverified, tune in-engine]**.

### 1.7 Contact shadows, vignette, sharpening

- **Contact shadows.** Between N8AO and real shadow maps, units get grounding for free on Medium and above. three's `webgl_shadow_contact` example renders depth from below into a 512² target and blurs it onto a plane [78]. *Analysis:* that technique suits a single hero on the select screen, but is too expensive per unit in a match. For the Low tier (no dynamic shadows), use an instanced "blob" shadow quad under each unit.
- **Vignette.** postprocessing's `VignetteEffect` has `DEFAULT` and `ESKIL` techniques [10]. It merges into the tone-mapping `EffectPass` at almost no cost (*analysis*). Keep it subtle and identical across tiers.
- **Sharpening.** postprocessing 6.39.5 has **no** sharpen effect; the full export list has none [10]. r186 ships RCAS sharpening (`SharpenNode` [86]), FSR1 upscaling (`FSR1Node`) and TAAU **only as TSL nodes** for the WebGPU post stack [77]. *Analysis:* we need sharpening only when dynamic resolution drops below 1.0. Port a small RCAS-style shader as a custom `Effect`, or skip sharpening until WebGPU.

### 1.8 Recommended pass order

```
WebGLRenderer({ antialias:false, depth:false, stencil:false, powerPreference:'high-performance' })
renderer.toneMapping = NoToneMapping; outputColorSpace = SRGBColorSpace        [9]
EffectComposer({ frameBufferType: HalfFloatType })                               [9]
 1. RenderPass(scene, camera)
 2. N8AOPostPass (quality per tier; halfRes on Medium)                            [13]
 3. EffectPass(camera, Bloom(mipmap), ToneMapping(AGX), LUT3D, Vignette)          [10]
 4. EffectPass(camera, SMAA)   // or FXAA on Low                                  [10]
 (5. custom RCAS sharpen only when renderScale < 1)
```

---

## 2. Shadows

### 2.1 What r186 provides

- **`SunLight` (new in r186).** It is an addon (`three/addons/lights/SunLight.js`) that works with `WebGLRenderer` and, once registered, with `WebGPURenderer`. It has no target: the light points from its position toward the origin [16]. Its `SunLightShadow` uses **two** cascades. Each cascade is fitted to a slice of the view frustum out to `shadow.camera.far` and enclosed by a **bounding sphere**, so the projection stays stable as the camera rotates. Each cascade is **snapped to the texel grid** to prevent shimmer, and neighboring cascades blend over 10% of their depth range. The default `mapSize` is 1024² per cascade, and the frustum's left/right/top/bottom are ignored [16]. The r186 release notes confirm that cascades were cut to two "for efficiency" [1]. The official example uses `mapSize` 2048, `far` 1000 and `normalBias` 0.05 [17].
- **CSM addon (`three/addons/csm/CSM.js`).** It works with `WebGLRenderer` only; WebGPU uses `CSMShadowNode` [21]. It creates one `DirectionalLight` per cascade (default 3) and patches each material through `setupMaterial()`, which **sets `material.onBeforeCompile`** [22]. *Analysis:* that collides with our own `onBeforeCompile` patches on terrain and units. It is the main reason to prefer `SunLight`.
- **Filtering.** `PCFSoftShadowMap` is deprecated in r186: the renderer logs "has been removed" and switches to `PCFShadowMap` [3][19]. The r186 PCF path takes 5 hardware-compared taps on a Vogel disk, rotated per pixel with interleaved gradient noise, and scaled by `shadow.radius` [18]. `LightShadow` defaults are `radius` 1, `blurSamples` 8 (VSM only), `mapSize` 512², `bias`/`normalBias` 0, plus `autoUpdate` and `needsUpdate` flags [20]. VSM remains available [3].

### 2.2 Why a fitted single map may beat cascades for VALE (analysis)

A lane-brawler camera looks down at roughly 50–60° with capped zoom (R04). The visible ground is a small trapezoid, around 40–60 m across at default zoom **[unverified until the camera is final]**. Cascades exist for views that reach far toward the horizon, and ours never does.

A **single directional shadow map fitted to that trapezoid** gives very high texel density. A 2048² map over a 50 m footprint is about 2.4 cm per texel. The steps:
1. Intersect the four screen-corner rays with the ground plane at y = 0 and at y = max caster height.
2. Transform those eight points into light space and take their bounding box.
3. Pad the box, then **quantize its size** to a few fixed steps so it doesn't change every frame.
4. **Snap its center** to whole texels. This is the same stabilization `SunLightShadow` uses [16] and the standard technique described by Microsoft and on GameDev.net [23][24].

**Decision:** try `SunLight` first because it costs nothing to integrate. If cascade two is wasted on a top-down view, switch to a hand-fitted `DirectionalLight` that uses the snapping math above.

### 2.3 Map size and filtering per tier (analysis)

| Tier | Dynamic sun shadows | Map size | PCF `radius` | Notes |
|---|---|---|---|---|
| Low | Off. Instanced blob shadows under units. | — | — | Structures could use baked lightmaps or AO from Blender **[unverified pipeline]**. |
| Medium | Fitted single map | 1024² | 1–2 | Shadow pass may skip tiny casters (`castShadow=false` on minion VFX). |
| High | Fitted map or `SunLight` | 2048² | 2 | |
| Ultra | `SunLight` 2x2048² or fitted 4096² | 2048–4096² | 2–3 | |

The cheapest big win is cutting shadow **draw calls**. Turn off `castShadow` on terrain chunks that can't shadow anything, on decals and on particles.

---

## 3. Sky, environment lighting and fog

### 3.1 Image-based lighting from a Blender-rendered sky

- Blender 5.0 added a **Multiple Scattering** sky model (based on work by Fernando García Liñán). The old Nishita model was renamed **Single Scattering** and is described as legacy [25][26]. The manual notes that both are very bright by default because they are physically scaled [26].
- In Blender 5.2.2 the Sky Texture node's `sky_type` options are `SINGLE_SCATTERING`, `MULTIPLE_SCATTERING` (the default), `PREETHAM` and `HOSEK_WILKIE`. Parameters include sun elevation/rotation, altitude, and air/aerosol/ozone density [L1].
- **Verified in this container [L1]:** headless Cycles (CPU, 16 spp) rendered a 256x128 equirectangular Multiple Scattering sky to a Radiance `.hdr` in 0.38 s. The result had a peak of 44.0 and a mean of 2.05, which confirms it is unclamped HDR. Scripting it raises a deprecation warning that `World.use_nodes` will be removed in Blender 6.0.
- **On the three side:**
  - Load the equirect with `HDRLoader`; `RGBELoader` has been deprecated since r180 [29].
  - Prefilter it with `PMREMGenerator` and assign it to `scene.environment`. `Scene` exposes `environmentIntensity`, `environmentRotation` and `backgroundBlurriness` [28].
  - `UltraHDRLoader` reads gain-map JPEGs [30]. Community reports put them at roughly 10–30x smaller than `.hdr`, with faster decoding through the browser's JPEG path [31].
- **Recommendation (analysis):**
  - Bake one sky per map or time of day at 1024x512 with the **sun disc turned off**, and let the sun be the dynamic light. three's `Sky` docs give the same advice to avoid artifacts when generating environment maps [27].
  - Ship the bake as UltraHDR JPEG.
  - Set `environmentIntensity` per map and keep `toneMappingExposure` at 1.
  - The sky is almost never visible from a lane camera, so its main jobs are diffuse/specular IBL and the fog palette. Use `backgroundBlurriness` only in menu and showcase scenes [28].

### 3.2 Real-time Sky shader (alternative)

three's `Sky` addon implements the analytic Preetham model and works only with `WebGLRenderer`; WebGPU uses `SkyMesh` [27]. The r186 SunLight example uses it to drive both the visible sky and a `pmremGenerator.fromScene()` environment, which it regenerates when the sun moves [17]. *Analysis:* this is useful if we ever animate time of day, for example in a menu backdrop. For fixed-time competitive maps, a pre-rendered Blender sky gives art direction more control and costs nothing per frame.

### 3.3 Fog and atmosphere

- three offers `Fog` (linear, near/far) and `FogExp2` (exponential density). The manual calls `FogExp2` more realistic and `Fog` more common [32]. Both measure **distance from the camera**.
- *Analysis:* with an angled top-down camera, camera-distance fog makes the top of the screen hazier than the bottom. That changes readability by screen position, which is unacceptable in a competitive game. A community `XZFog` patch exists because standard fog is wrong for top-down and isometric games. It uses `onBeforeCompile` to compute fog from horizontal distance only [33].
- **Height fog** in WebGL is usually built by replacing the `fog_fragment` chunk and fading on world-space height [34]. In WebGPU it is a built-in TSL helper, `exponentialHeightFogFactor` [35].
- *Recommendation:* turn off scene fog in gameplay. Add one shared shader include that applies:
  1. a very subtle **height fog**, for low river and valley mist only,
  2. **map-edge fog**, based on distance from the playable bounds, to hide the world's edges,
  3. the **fog-of-war** darkening (Section 6).

  All three are computed in world space, never from camera distance, so a unit looks the same wherever it sits on screen.

---

## 4. Terrain

### 4.1 Splat-mapped PBR terrain (4–8 layers)

- **Texture arrays.** `DataArrayTexture` stores a stack of 2D layers, needs WebGL2 and is sampled with `sampler2DArray`. That avoids GLSL ES 3.0's ban on indexing an array of samplers with a dynamic value [36]. It also supports per-layer updates (`addLayerUpdate`) [36].
- **Compressed arrays.** r186's `KTX2Loader` returns a **`CompressedArrayTexture`** when the container has more than one layer, and also handles cubemaps [38]. Examples `webgl_texture2darray_compressed` and `webgl_texture2darray_layerupdate` cover the pattern [39][56].
- **Classic splatting.** Encode up to four blend weights per RGBA control map, then blend layer samples in the fragment shader [37].
- **Proposed layout (analysis):**
  - **Control:** two RGBA8 splat maps (8 weights), or one index map plus one weight map ("top-2 layers per texel"). The second option cuts fetches to 2 per pixel, whatever the layer count.
  - **Arrays:** one `CompressedArrayTexture` each for albedo+height (RGBA), normals (RG) and ORM (R occlusion, G roughness, B metalness), with 4–8 layers each. That gives three array bindings in total.
  - **Height-blend** layer transitions using the albedo alpha, so they look crisp from a top-down view.
  - **Triplanar** only where the world normal's slope passes a threshold, on cliffs. It costs three times the fetches, so put it behind a branch or a separate cliff material.
  - Implement it as a `MeshStandardMaterial` patched with `onBeforeCompile` (today) **or** as a TSL node material run through `WebGLNodesHandler` (Section 9). Keep the code in one module either way.

### 4.2 KTX2/Basis compression: tools and availability

- **KTX-Software is not on npm.** Since version 4.3, `ktx create` replaces `toktx` [40]. Its source shows `--encode` (basis-lz / uastc), `--generate-mipmap`, `--layers`, `--normal-mode` and `--assign-tf` [41], which covers terrain arrays and normal maps.
- **gltf-transform 4.5.1** shells out to the `ktx` binary for its `etc1s` / `uastc` / `--texture-compress ktx2` commands. It checks for **KTX-Software ≥ 4.4.0** (`KTX_SOFTWARE_VERSION_MIN = "4.4.0"`) [43][L4]. Its own help recommends UASTC for normal maps and ETC1S for other textures [L4].
- **An npm-only path exists.** `ktx2-encoder` 0.6.0 wraps the Basis Universal encoder as WASM, runs in Node and the browser, and provides a gltf-transform `ktx2()` transform [44][85]. **Verified [L5]:** in Node, a 256² test PNG (209 KB) encoded with mips to ETC1S at 14.3 KB in about 1.0 s, and to UASTC at 44.7 KB in about 0.5 s.
- **three runtime.** Call `KTX2Loader.setTranscoderPath(...)` and `detectSupport(renderer)`. The WASM transcoder ships in `examples/jsm/libs/basis/` [38]. Copy that folder into `public/` with Vite.
- **Recommendation (analysis):** use `ktx2-encoder` in `npm run content`, so CI and new machines need no native installs. Use UASTC for normal maps and hero faces, and ETC1S for terrain albedo and props. Generate mips offline.

### 4.3 Mipmaps and anisotropy

- `renderer.capabilities.getMaxAnisotropy()` reports the hardware limit [46]. `EXT_texture_filter_anisotropic` is supported in every major browser [45].
- *Analysis:* a 50–60° view is exactly where trilinear filtering blurs ground textures. Set terrain-array anisotropy to 4 / 8 / 16 / 16 by tier; the cost is small on desktop GPUs **[unverified for our scene]**.

### 4.4 Texture memory arithmetic (analysis)

A 2048² RGBA8 texture with its full mip chain takes about 21 MiB of GPU memory. If BC7 runs at 8 bits per texel and BC1 at 4 **[unverified rates]**, the same texture compressed is about 5.3 MiB and 2.7 MiB. That gap is why KTX2 matters: it is the difference between roughly 1.5 GB and roughly 300 MB for a typical arena of maps, heroes and VFX.

---

## 5. Characters, crowds and LOD

### 5.1 Heroes: SkinnedMesh with GPU skinning

- three skins on the GPU. Bone matrices are packed into a float `DataTexture` (`Skeleton.computeBoneTexture()`) and read in the vertex shader with `texelFetch`. Each vertex has four influences (`skinIndex` / `skinWeight` vec4) [47][87]. The CPU still pays for `AnimationMixer` evaluation and bone-matrix updates for each skeleton (*analysis*).
- **Frustum-culling trap.** A `SkinnedMesh` computes its bounding sphere **once**, on the CPU, by skinning every vertex. The docs say to recompute it every frame if the mesh is animated [48]. *Analysis:* recomputing every frame for 10 heroes wastes CPU. Instead, give each hero a fixed, conservative bounding sphere authored to cover all its clips, or cull at the entity level from sim positions.
- *Analysis budget:* 10 heroes × 1–2 materials × 2 passes (main + shadow) comes to about 20–40 draw calls. Use one `AnimationMixer` per hero. Update off-screen or dead heroes at a lower rate, but never the *simulation*.

### 5.2 Minions and monsters: InstancedMesh + VAT

- **`InstancedMesh`** draws many copies of one geometry/material in a single draw call [54].
- Sharing one skinned pose across instances is a **WebGPU** example (`webgpu_skinning_instancing`): every instance plays the same animation frame [49]. Per-instance poses use **compute-shader skinning** (`webgpu_skinning_instancing_individual`) [50]. *Analysis:* neither is available on our WebGL path today.
- **VAT** (vertex animation textures) is the WebGL-friendly answer. Bake each clip's per-vertex offsets into a float texture, with vertices along X and frames along Y. A vertex shader then reads it using per-instance attributes (clip row offset, start time, speed, team tint). **Verified [L6]:** a 25-line `bpy` script baked a 24-frame action on a 1,248-vertex mesh into a float EXR in about 0.01 s.
- **Vertex-order trap (verified [L4]).** The raw Blender export had 1,248 vertices. After `gltf-transform optimize` (weld on by default), the same mesh had **625**. A VAT baked against one vertex order is garbage on the other. Pick one fix:
  - **(a)** bake VAT **after** the final gltf-transform pass, by re-importing the shipped GLB, or
  - **(b)** bake in Node/three from the shipped GLB by stepping the mixer and reading `SkinnedMesh.getVertexPosition()` [48]. That guarantees an exact order match.
- **Batching static props.** `BatchedMesh` draws many *different* geometries that share one material in one multi-draw call. It supports per-object frustum culling and sorting [51]. It depends on `WEBGL_multi_draw`, which browser-compat data lists for Chrome 86+ and Safari 15+ but **not Firefox** [53]. Without the extension, r186 **loops one draw call per instance** [52]. *Analysis:* for static props, merging geometry per map chunk (one mesh per material per chunk) is the most portable choice. Keep `BatchedMesh` for dynamic, mixed props.
- **Helper libraries:** `@three.ez/instanced-mesh` 0.3.16 adds per-instance frustum culling, BVH raycasting, sorting and visibility management on top of `InstancedMesh` [61].

### 5.3 LOD

three's `LOD` object switches child meshes by camera distance [55]. gltf-transform can generate reduced meshes with meshoptimizer (`simplify`) [42]. r186 also has a `webgl_batch_lod_bvh` example [56]. *Analysis:* with a capped-zoom camera, LOD matters mostly for the spectator's zoomed-out view and for the shadow pass. Ship two LODs per hero (LOD1 at about 50% of LOD0) and use LOD1 for shadow casting on Medium and below.

---

## 6. Fog of war, telegraphs, particles and trails

### 6.1 Fog-of-war rendering (analysis, built on documented APIs)

1. The **simulation** (and, online, the server) decides visibility. Hidden enemy entities are **never rendered or even sent**. The shader effect is cosmetic only.
2. **Vision grid → texture.** Keep one `DataTexture` per local team in `RedFormat` / `UnsignedByteType` (R8). For example, a 160 m map at 0.5 m cells is a 320² texture of about 100 KB. Write it each sim tick. `Texture.addUpdateRange()` lets you upload only changed spans [59].
3. **Smoothing.** Use `LinearFilter` for free bilinear filtering. Add temporal easing (each texel moves toward its target by a fixed rate) so edges fade in and out rather than popping. Optionally run a small blur pass into a render target at 2–4x grid resolution (Medium and above).
4. **Sampling.** One shared uniform texture plus world bounds maps `worldPos.xz → uv`. The terrain, props and water shaders darken and desaturate there. Units are culled on the CPU, not in the shader.
5. **Fairness.** The grid, its resolution and its smoothing must be **identical at every quality tier**, because they define what a player sees.

### 6.2 Telegraphs and decals

- `DecalGeometry` clips and projects target-mesh triangles **on the CPU** to build a new mesh. Its docs warn of distortion around corners [57]. The example uses `polygonOffset` with factor −4 and depth testing [58]. *Analysis:* that suits persistent scorch marks on props, but is too expensive for dozens of telegraphs per second on a large terrain mesh.
- **Recommendation (analysis):** draw telegraphs as **ground-aligned quads** with signed-distance-field shaders (circle, ring, cone, line, rectangle, with fill progress), instanced by shape type. Lift them slightly with `polygonOffset`, set `depthWrite:false`, and sample terrain height in the vertex shader if the ground isn't flat. Render order is opaque → telegraphs → units' transparent effects. Telegraph colors and contrast follow R04's VFX hierarchy and stay fixed across tiers.

### 6.3 GPU particles and trails (analysis unless cited)

- Draw particles as instanced camera-facing quads: one instanced geometry per material or atlas, flipbook UVs from a per-instance frame index, and lifetime curves evaluated in the vertex shader.
- **Blending.** Additive blending is order-independent, so it needs no sorting. Alpha blending needs back-to-front order. Premultiplied alpha (`ONE, ONE_MINUS_SRC_ALPHA`) lets one material do both additive-like and alpha-like looks **[unverified as a cited claim, standard technique]**.
- **Overdraw, not vertex count, is the cost.** Scale particle spawn density by tier, not effect lifetime, so readability is preserved.
- **Soft particles** need the depth texture, which the post chain already has.
- **Library option.** `three.quarks` 0.17.1 is a general-purpose particle system that needs three ≥ 0.182 [60]. Weigh it against a small in-house instanced system, which is easier to keep fair and deterministic.
- **Trails** are ribbon meshes fed by a ring buffer of recent positions, with UVs running along the ribbon. Update them on the CPU into a dynamic `BufferAttribute`.

---

## 7. Budgets, measurement, frame pacing and resolution

### 7.1 Measurement tools

- `renderer.info` reports `render.calls`, `render.triangles`, `memory.geometries`, `memory.textures` and `programs`. With post-processing (many renders per frame), set `info.autoReset = false` and call `info.reset()` once per frame [52].
- Per-pass GPU timing needs `EXT_disjoint_timer_query_webgl2`, which is Chrome/Edge only [65]. N8AO's debug mode uses it [13]. `stats-gl` 4.2.3 is a maintained three overlay [84].
- `renderer.compileAsync()` uses `KHR_parallel_shader_compile` to compile shaders without blocking [52]. That extension exists in Chrome 76+ and Safari 14.1+ but **not Firefox** [66]. *Analysis:* pre-compile every quality-tier permutation during the loading screen, so a preset change or the first spell cast never hitches.

### 7.2 Planning budgets for 1080p60 on a mid-high GPU (analysis, [unverified]; to be replaced by probe data)

| Resource | Target (worst-case teamfight) |
|---|---|
| Frame | 16.6 ms total, with about 4 ms CPU render submission and 10–11 ms GPU at High |
| Draw calls (all passes, including post) | ≤ 500, of which shadow pass ≤ 150 |
| Triangles (main pass) | ≤ 1.5 M |
| Texture memory | ≤ 1 GB at Ultra, ≤ 512 MB at Low |
| Post chain GPU | ≤ 3 ms at High (AO ≤ 1.5 ms, bloom ≤ 0.6 ms, SMAA ≤ 0.4 ms) |
| Skinned characters on screen | 10 heroes + ≤ 6 large monsters as `SkinnedMesh`. Everything else uses VAT instancing. |

### 7.3 Frame pacing and the render loop

- `requestAnimationFrame` fires at the display's refresh rate: 60 Hz is common, but 75, 120 and 144 Hz are widespread. It is paused in background tabs, and animation must use the timestamp or it will run faster on high-refresh screens [62].
- `THREE.Clock` has been deprecated since r183. `THREE.Timer` replaces it, can hook the Page Visibility API (`timer.connect(document)`) to avoid huge deltas after a tab switch, and allows repeated `getDelta()` reads within one step [67][88].
- *Analysis:*
  - Run the **simulation on a fixed tick** and interpolate rendering between ticks.
  - Render at the display rate by default, with an optional cap (60 / 120 / 144 / uncapped) that skips frames based on rAF timestamps.
  - Never use `setTimeout` for pacing.

### 7.4 devicePixelRatio and dynamic resolution

- `devicePixelRatio` is the ratio of physical to CSS pixels. Page zoom changes it, and dragging the window to another monitor can change it too. Use `matchMedia` to detect the change [63].
- The three manual recommends sizing the drawing buffer yourself (`clientWidth × dpr`) rather than relying on `setPixelRatio`. It also recommends **capping the total pixel count** (its example caps at 3840×2160), because fractional OS scaling can otherwise inflate GPU load [64].
- *Analysis, dynamic resolution:*
  - Keep a `renderScale` in {1.0, 0.9, 0.8, 0.7}, applied to the canvas drawing buffer and the composer size.
  - Feed it a smoothed frame time (GPU timer queries where available [65], otherwise rAF intervals).
  - Use hysteresis and a cooldown of at least 2 s between changes, because resizing reallocates every render target.
  - The DOM/Preact HUD stays at native resolution, so text never blurs.

---

## 8. Quality ladder

The **must-not-change** column lists things that affect competitive information. Everything else may scale. (*Analysis*, built from the costs documented above.)

| Setting | Low | Medium | High | Ultra |
|---|---|---|---|---|
| DPR cap / max pixels | 1.0 | 1.0 | min(dpr, 1.5) | min(dpr, 2), ≤ 3840×2160 [64] |
| Dynamic resolution floor | 0.7 | 0.8 | 0.9 | off |
| Frame buffers | HalfFloat | HalfFloat | HalfFloat | HalfFloat |
| Anti-aliasing | FXAA | SMAA MEDIUM | SMAA HIGH | SMAA ULTRA |
| N8AO | off | Performance or Low, `halfRes` | Medium, full res | High, or Neural-Medium if budget allows |
| Bloom (mipmap) | levels 5 | 6 | 8 | 8 |
| Tone map + LUT + vignette | on | on | on | on (same look at every tier) |
| Sun shadows | off, blob quads | fitted 1024² | fitted 2048² or SunLight 2×1024 | SunLight 2×2048 or fitted 4096² |
| Shadow casters | structures only | + heroes | + heroes, monsters, minions | all |
| Terrain | 4 layers, no triplanar, aniso 4 | 6 layers, aniso 8 | 8 layers, triplanar cliffs, aniso 16 | same, plus parallax/height-blend detail |
| Texture resolution | skip top mip (half-res) | full | full | full |
| Particle density | 50% spawn, no soft particles | 75% | 100%, soft particles | 100%, soft + distortion |
| Animation update | off-screen units at 15 Hz | 30 Hz | full | full |
| Environment detail | props LOD1, no grass animation | LOD0 near | LOD0 | LOD0, extra ambient FX |
| **Must not change** | Fog-of-war grid and smoothing, telegraph shapes and colors, brush opacity rules, unit outlines and health bars, camera FOV and zoom limits. These are the same at every tier. |||| 

Default the preset from the GPU renderer string plus a 5-second benchmark during the first load. Store the choice per device (*analysis*).

---

## 9. WebGPU in r186: ship it or keep it as a seam?

- **What r186 says about itself:**
  - The manual calls `WebGPURenderer` "the next-generation renderer". It falls back to WebGL 2 when WebGPU is missing and supports TSL, which transpiles to WGSL or GLSL. It is also "still in an experimental state" and may be missing features or run slower than `WebGLRenderer` for some scenes [73].
  - `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` and `EffectComposer` passes are **not** supported there; code must be ported to TSL and the node post stack [73].
  - `WebGLRenderer` "is still maintained and the recommended choice for pure WebGL 2 applications", but there are no plans for large new features [73]. The constructor confirms the automatic WebGL2 fallback and a `forceWebGL` flag [74].
- **What r186 added on the WebGPU side:** `DirectRenderPipeline`, `compileComputeAsync()`, a new `SSAONode`, `OITPassNode` (order-independent transparency) and faster `BloomNode` blurs [1]. The TSL post stack also includes TRAA, TAAU, FSR1, RCAS sharpening, GTAO and SSGI [77].
- **Our dependencies:** N8AO says it is "not yet compatible with WebGPU" [13]. pmndrs postprocessing v6 targets `EffectComposer` on WebGL.
- **Browser support** (MDN browser-compat data) [76]:
  - **Chrome:** full support since 144 on ChromeOS, macOS, Windows and Linux (Intel Gen12+ only). Chrome 113–143 had partial support without Linux.
  - **Firefox:** partial since 141. It works on Windows, and on Apple-silicon macOS from 145/147, but **not on Linux** or Intel Macs.
  - **Safari:** supported since 26.
- **The seam r186 provides:** `renderer.setNodesHandler(new WebGLNodesHandler())` lets **TSL node materials render inside `WebGLRenderer`** "to prepare for migration to WebGPURenderer" [52][75]. The `webgl_tsl_instancing`, `webgl_tsl_skinning` and `webgl_tsl_shadowmap` examples demonstrate it [56][83]. The handler's own source lists its limitations [75]:
  - no VSM shadows
  - no MRT
  - no transmission
  - no WebGPU post stack
  - no storage textures
  - fog and environment don't update automatically
  - instanced geometry can't be shared

**Recommendation (analysis):**
- **Ship `WebGLRenderer`.** It keeps N8AO and pmndrs postprocessing, it's predictable on every browser, and Firefox-on-Linux players aren't left out.
- **Build the seam now:**
  1. Put all custom shading (terrain, fog of war, telegraphs, VAT, particles) in a `render/materials/` module behind small factory functions.
  2. Spike writing two of them (telegraphs and fog of war) in **TSL via `WebGLNodesHandler`**. If perf and features hold, write new materials in TSL from then on.
  3. Keep post-processing behind one `PostChain` interface, so a WebGPU node-based chain can replace it later.
- **Re-evaluate** when N8AO ships WebGPU support, or when three drops the "experimental" wording.

---

## 10. glTF pipeline: Blender 5.2 → gltf-transform → three

### 10.1 Blender 5.2 exporter settings for skinned heroes

All option names and defaults below were read from the Blender 5.2.2 `export_scene.gltf` operator, glTF addon version 5.2.40 [68][69][L3].

| Option | Default | Use for heroes | Why |
|---|---|---|---|
| `export_format` | — | `GLB` | One file, embedded buffers |
| `export_animation_mode` | `ACTIONS` | `ACTIONS` | "Export actions (actives and on NLA tracks) as separate animations." **Verified:** two actions became two glTF clips named `Attack` and `Idle` [L3]. `NLA_TRACKS` exports each track as a clip, and `ACTIVE_ACTIONS` merges them. |
| `export_def_bones` | false | **true** | Deform bones only. Drops control and mechanism bones. |
| `export_influence_nb` | 4 | 4 | Matches three's vec4 skin attributes [47] |
| `export_force_sampling` | true | true | Bakes constraints and IK into keys |
| `export_optimize_animation_size` | true | true | Drops duplicate keys |
| `export_anim_slide_to_zero` | false | true for loop clips | Clip starts at 0 s |
| `export_reset_pose_bones` | true | true | Stops one clip's pose leaking into the next |
| `export_rest_position_armature` | true | true | Uses the rest pose as the bind pose |
| `export_apply` | false | false | Applying modifiers blocks shape-key export |
| `export_yup` | true | true | glTF's Y-up convention |
| `export_extras` | false | true | Custom properties become `extras`, for sockets, VFX anchors and hitbox hints |
| `export_tangents` | false | false | Let three derive tangents, or bake them with gltf-transform `tangents` if needed |
| `export_image_format` | `AUTO` | `AUTO` (PNG masters) | Recompress to KTX2 downstream |
| `export_meshopt_compression_enable` | false | **false** | See below |

- **Blender's own meshopt export is not reliable as our only compression step.** Blender 5.2 can write `EXT_meshopt_compression` or `KHR_meshopt_compression` [68][L3], but only when a bundled native library (`bf_intern_meshopt_bridge`) is present. In this container's `bpy` build, the library was missing and the exporter **silently fell back** to an uncompressed file of identical size [L3].
- **`KHR_meshopt_compression`** is still a Release Candidate spec [70]. three r186's `GLTFLoader` reads both the EXT and KHR variants [71], but gltf-transform 4.5.1 implements only `EXT_meshopt_compression` [72][L4].
- **Rule:** export uncompressed from Blender and compress in gltf-transform.
- Blender also offers an optional `export_use_gltfpack` step (simplify plus KTX2) [L3]. The gltfpack binary's availability was not checked **[unverified]**.

### 10.2 Naming conventions (verified behavior + analysis)

- glTF **node** names come from Blender **object** names, and glTF **mesh** names come from the mesh **datablock** name. In the test, the object was `HERO_test_body` but its mesh was exported as `Cylinder` [L3]. Rename datablocks as well as objects.
- **Proposed convention:**
  - `HERO_<id>_rig`, `HERO_<id>_body`, `HERO_<id>_<part>` (for swappable skin parts)
  - deform bones `DEF_<name>`
  - sockets as empties named `SOCKET_<name>`, exported with extras
  - clips (actions) `<verb>[_<variant>]`: `idle`, `run`, `attack_1`, `cast_q`, `death`, `recall`, `emote_<n>`
  - one `.blend` per hero, one GLB per hero, plus one GLB per skin if meshes differ
- gltf-transform keeps node names unless `join`/`flatten` merges them [L4].

### 10.3 gltf-transform settings (verified defaults [L4])

- `gltf-transform optimize` turns on by default: `--simplify true` (error 0.0001), `--join true`, `--flatten true`, `--instance true`, `--palette true`, `--weld true`, `--compress meshopt` and `--texture-compress auto`, with `--texture-size 2048` [L4]. **Simplify, join and palette are destructive defaults for hero assets.**
- **Verified:** on the test rig, `optimize` cut 80.5 KB to 13.75 KB and wrote `EXT_meshopt_compression` + `KHR_mesh_quantization`. Both animation clips survived [L4].
- **Recommended hero command (analysis):**
  `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress false --simplify false --join false --flatten false --palette false --instance false`
  Then run a separate KTX2 step: `ktx2-encoder`'s `ktx2()` transform in our build script, or `gltf-transform uastc` / `etc1s` if KTX-Software ≥ 4.4.0 is installed [42][43][44].
- **Static landmark command:** the defaults are fine, including `join` and `instance`, but check the `simplify` error visually.
- **VAT meshes:** bake after this step (Section 5.2).

### 10.4 three runtime loading

- Configure `GLTFLoader` once with `setMeshoptDecoder(MeshoptDecoder)` (from `three/addons/libs/meshopt_decoder.module.js`) and `setKTX2Loader(ktx2Loader.detectSupport(renderer))` [71][38].
- `GLTFLoader` r186 also reads `KHR_texture_basisu` and `EXT_mesh_gpu_instancing` [71].
- *Analysis:* use embedded textures inside GLB for per-hero uniqueness. Keep shared textures (terrain arrays, VFX atlases, LUTs) as standalone `.ktx2`/`.cube` files so they load once.

---

## 11. Implications for Vale (concrete recommendations)

1. **Renderer.** Use `WebGLRenderer({antialias:false, depth:false, stencil:false, powerPreference:'high-performance'})` with `toneMapping = NoToneMapping` and an `EffectComposer({frameBufferType: HalfFloatType})` [9]. Do not adopt `WebGPURenderer` for launch.
2. **Post chain.** RenderPass → N8AOPostPass → EffectPass(Bloom mipmap, ToneMapping **AGX**, LUT3D, Vignette) → EffectPass(SMAA). Use Neutral tone mapping only in hero-select and store scenes. Pre-set N8AO quality at load, because changing it recompiles shaders [13].
3. **Grading.** Author one `.cube` LUT per map (size 32–33, tetrahedral interpolation on High and Ultra) against AgX screenshots. Preview heroes in Blender with the AgX view transform and **no look**, to match three [4][L2].
4. **Shadows.** Integrate r186 `SunLight` first. Keep a hand-fitted, texel-snapped single `DirectionalLight` map as the fallback if the second cascade is wasted [16][23]. Use `PCFShadowMap` (soft is deprecated) [3][19]. Avoid the CSM addon, because it overwrites `onBeforeCompile` [22].
5. **Sky.** Bake a Multiple Scattering sky per map in Blender 5.2 (sun disc off, 1024×512) using a script like [L1]. Convert it to UltraHDR, PMREM it, and use it for IBL only [26][30]. Drive the sun with the dynamic light.
6. **Fog.** No camera-distance fog in gameplay. Add one world-space include for height mist, map-edge fog and fog-of-war darkening [33][34].
7. **Terrain.** Use KTX2 texture arrays (albedo+height, normal, ORM) with 2 splat maps or an index+weight scheme, triplanar on cliffs only, and per-tier anisotropy [36][38][46].
8. **Textures.** Add `ktx2-encoder` to the content build for an npm-only KTX2 pipeline: UASTC for normals and faces, ETC1S for the rest [44][L5].
9. **Heroes.** Use `SkinnedMesh` with fixed authored bounding spheres [48] and one mixer each. **Minions** use VAT + `InstancedMesh`, baked from the *final* GLB [L4][L6]. Static props are merged per chunk, because `BatchedMesh` degrades to a draw loop on Firefox [52][53].
10. **Fog of war.** Use an R8 `DataTexture` per team, updated per tick with `addUpdateRange`, temporally eased and identical at every tier [59]. Visibility is enforced in the simulation, never in shaders.
11. **Telegraphs.** Use instanced SDF ground quads, not `DecalGeometry` [57].
12. **Measurement.** Add a debug overlay built on `renderer.info` (autoReset off) plus `stats-gl` [52][84]. Feed it into the existing `npm run probe` harness, and record draw calls, triangles and GPU ms per scenario against the Section 7.2 budgets.
13. **Pacing.** Run the sim on a fixed tick and render with `THREE.Timer` (connected to `document`) at display rate with an optional cap [62][67]. Size the drawing buffer manually with a pixel-count cap [64]. Use stepped dynamic resolution with hysteresis.
14. **Shader warm-up.** Call `compileAsync` on every tier permutation behind the loading screen. Firefox lacks parallel compile, so budget extra load time there [52][66].
15. **Blender export preset.** `GLB`, `ACTIONS`, deform bones only, 4 influences, sampling on, extras on, meshopt **off**. Then run gltf-transform with `--simplify false --join false --flatten false --palette false --instance false` for heroes [L3][L4].
16. **WebGPU seam.** Isolate custom materials and the post chain behind interfaces. Spike telegraph and fog-of-war materials in TSL through `WebGLNodesHandler` [75]. Revisit WebGPU when N8AO supports it and three drops "experimental" [13][73].
17. **Fairness.** Any visual that carries competitive information must be locked across all tiers (Section 8).

### Open questions
- The final camera pitch, FOV and zoom range (R04) decide shadow-map footprint, texel density and LOD distances. Measure these before tuning Section 2.3.
- Does the 2-cascade `SunLight` waste its second cascade on our camera? Compare GPU ms against the fitted single map in a probe.
- How limited is `WebGLNodesHandler` for our material set? Is the performance of TSL materials on WebGL comparable to `onBeforeCompile` materials?
- Do official Blender 5.2 desktop builds ship the meshopt bridge library? It only matters if artists want compressed previews straight out of Blender.

---

## Local verification log

All local experiments ran in this repository's container on 2026-10-07. Scratch files were kept out of the repo.

- **[L1] Blender sky bake.** `bpy` 5.2.2 LTS (build 2026-09-15). Read the `ShaderNodeTexSky.sky_type` enum: `SINGLE_SCATTERING`, `MULTIPLE_SCATTERING` (default), `PREETHAM`, `HOSEK_WILKIE`. Built a World with a Multiple Scattering sky and rendered it through an equirectangular panoramic camera in Cycles (CPU, 16 spp, 256×128) to Radiance `.hdr`. Render time 0.38 s, output 64 KB, pixel max 44.0, mean 2.05. Blender warned that `World.use_nodes` is expected to be removed in Blender 6.0.
- **[L2] Blender view transforms.** Confirmed that `AgX` (default), `Khronos PBR Neutral`, `Filmic`, `Standard`, `ACES 1.3` and `ACES 2.0` are accepted on an sRGB display device.
- **[L3] Blender glTF exporter (addon 5.2.40).** Dumped every `export_scene.gltf` property and default. Built a test rig (subdivided cylinder, 2-bone armature, `Idle` and `Attack` actions on NLA tracks) and exported GLB with `ACTIONS` mode. The result had two animations named `Attack` and `Idle`, joints `root` and `spine`, nodes named after objects, and the mesh named after its datablock (`Cylinder`). With `export_meshopt_compression_enable=True` the file was byte-identical in size (80,512 B) and had no `extensionsUsed`. The exporter disables meshopt when `is_meshopt_available()` fails, because the native library is absent in this `bpy` build.
- **[L4] gltf-transform 4.5.1.**
  - `optimize ... --compress meshopt` reduced 80.5 KB to 13.75 KB, with `EXT_meshopt_compression` and `KHR_mesh_quantization` both used and required, and both clips intact.
  - Vertex count went from 1,248 (raw) to 625 (after weld).
  - `optimize --help` confirms the defaults: simplify, join, flatten, instance, palette and weld all on, compress meshopt, texture-compress auto, texture-size 2048.
  - CLI source contains `KTX_SOFTWARE_VERSION_MIN = "4.4.0"` and spawns `ktx`.
  - `@gltf-transform/extensions` 4.5.1 references only `EXT_meshopt_compression`.
  - No `ktx`, `toktx` or `basisu` binaries are installed in the container.
- **[L5] ktx2-encoder 0.6.0 in Node.** A 256² RGBA PNG (209,486 B) with mipmaps encoded to ETC1S at 14,294 B in about 1.0 s, and to UASTC at 44,724 B in about 0.5 s. Both outputs start with the KTX 2.0 magic bytes.
- **[L6] VAT bake.** Re-imported the exported GLB, stepped the `Attack` action over 24 frames, read evaluated vertex positions, stored offsets from the rest pose in a float RGBA image of 1,248 × 24, and saved it as OpenEXR (480 KB). Time about 0.01 s.

---

## Sources

1. https://github.com/mrdoob/three.js/releases/tag/r186
2. https://www.npmjs.com/package/three
3. https://github.com/mrdoob/three.js/blob/r186/src/constants.js
4. https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js
5. https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products
6. https://discourse.threejs.org/t/is-agx-tonemapping-implemented-correctly/60609
7. https://discourse.threejs.org/t/pmndrs-post-processing-tone-mapping-guidance/59374/2
8. https://discourse.threejs.org/t/acesfilmictonemapping-leading-to-low-contrast-textures/15484
9. https://github.com/pmndrs/postprocessing
10. https://pmndrs.github.io/postprocessing/public/docs/ (verified against the 6.39.5 build in the npm tarball, https://www.npmjs.com/package/postprocessing)
11. https://react-postprocessing.docs.pmnd.rs/effects/lut
12. https://react-postprocessing.docs.pmnd.rs/effects/bloom
13. https://github.com/N8python/n8ao (README of n8ao 2.0.1, https://www.npmjs.com/package/n8ao)
14. https://docs.nvidia.com/gameworks/content/gameworkslibrary/graphicssamples/d3d_samples/fxaa311sample.htm
15. https://forums.anandtech.com/threads/smaa-is-free-aa-and-it-looks-better-than-msaa.2335176
16. https://github.com/mrdoob/three.js/blob/r186/examples/jsm/lights/SunLightShadow.js (and SunLight.js in the same folder)
17. https://github.com/mrdoob/three.js/blob/r186/examples/webgl_lights_sunlight.html
18. https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js
19. https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLShadowMap.js
20. https://github.com/mrdoob/three.js/blob/r186/src/lights/LightShadow.js
21. https://threejs.org/docs/pages/CSM.html
22. https://github.com/mrdoob/three.js/blob/r186/examples/jsm/csm/CSM.js
23. https://learn.microsoft.com/en-us/windows/win32/dxtecharts/common-techniques-to-improve-shadow-depth-maps
24. https://gamedev.net/forums/topic/707159-stable-cascaded-shadow-maps
25. https://developer.blender.org/docs/release_notes/5.0/rendering/
26. https://docs.blender.org/manual/en/5.0/render/shader_nodes/textures/sky.html
27. https://github.com/mrdoob/three.js/blob/r186/examples/jsm/objects/Sky.js
28. https://github.com/mrdoob/three.js/blob/r186/src/scenes/Scene.js
29. https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/RGBELoader.js
30. https://threejs.org/docs/pages/UltraHDRLoader.html
31. https://discourse.threejs.org/t/reduce-the-size-of-hdr-files/60755
32. https://github.com/mrdoob/three.js/blob/r186/manual/pages/fog.html
33. https://discourse.threejs.org/t/xzfog-horizontal-distance-fog-for-three-js-top-down-isometric-games/87619
34. https://discourse.threejs.org/t/shader-error-fog-height/38665
35. https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_fog_height.html
36. https://threejs.org/docs/pages/DataArrayTexture.html
37. https://discourse.threejs.org/t/how-to-create-a-multiple-textured-terrain/5069/2
38. https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/KTX2Loader.js
39. https://github.com/mrdoob/three.js/blob/r186/examples/webgl_texture2darray_compressed.html
40. https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.3.2
41. https://github.com/KhronosGroup/KTX-Software/blob/main/tools/ktx/command_create.cpp
42. https://gltf-transform.dev/cli
43. https://www.npmjs.com/package/@gltf-transform/cli
44. https://github.com/gz65555/ktx2-encoder
45. https://github.com/mdn/browser-compat-data/blob/main/api/EXT_texture_filter_anisotropic.json
46. https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLCapabilities.js
47. https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/skinning_pars_vertex.glsl.js
48. https://github.com/mrdoob/three.js/blob/r186/src/objects/SkinnedMesh.js
49. https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_skinning_instancing.html
50. https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_skinning_instancing_individual.html
51. https://github.com/mrdoob/three.js/blob/r186/src/objects/BatchedMesh.js
52. https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js
53. https://github.com/mdn/browser-compat-data/blob/main/api/WEBGL_multi_draw.json
54. https://github.com/mrdoob/three.js/blob/r186/src/objects/InstancedMesh.js
55. https://github.com/mrdoob/three.js/blob/r186/src/objects/LOD.js
56. https://github.com/mrdoob/three.js/blob/r186/examples/files.json
57. https://github.com/mrdoob/three.js/blob/r186/examples/jsm/geometries/DecalGeometry.js
58. https://github.com/mrdoob/three.js/blob/r186/examples/webgl_decals.html
59. https://github.com/mrdoob/three.js/blob/r186/src/textures/Texture.js
60. https://www.npmjs.com/package/three.quarks
61. https://www.npmjs.com/package/@three.ez/instanced-mesh
62. https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame (content read from https://github.com/mdn/content/blob/main/files/en-us/web/api/window/requestanimationframe/index.md)
63. https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio (content read from https://github.com/mdn/content/blob/main/files/en-us/web/api/window/devicepixelratio/index.md)
64. https://github.com/mrdoob/three.js/blob/r186/manual/pages/responsive.html
65. https://github.com/mdn/browser-compat-data/blob/main/api/EXT_disjoint_timer_query_webgl2.json
66. https://github.com/mdn/browser-compat-data/blob/main/api/KHR_parallel_shader_compile.json
67. https://github.com/mrdoob/three.js/blob/r186/src/core/Timer.js
68. https://github.com/KhronosGroup/glTF-Blender-IO (addons/io_scene_gltf2; behavior checked in the Blender 5.2.2 bundled addon)
69. https://pypi.org/project/bpy/
70. https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_meshopt_compression/README.md
71. https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js
72. https://github.com/donmccurdy/glTF-Transform/blob/main/packages/extensions/src/ext-meshopt-compression/meshopt-compression.ts
73. https://github.com/mrdoob/three.js/blob/r186/manual/pages/webgpurenderer.html
74. https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPURenderer.js
75. https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/WebGLNodesHandler.js
76. https://github.com/mdn/browser-compat-data/blob/main/api/GPU.json
77. https://github.com/mrdoob/three.js/tree/r186/examples/jsm/tsl/display (SharpenNode.js, FSR1Node.js, TAAUNode.js, TRAANode.js, GTAONode.js, SSGINode.js)
78. https://github.com/mrdoob/three.js/blob/r186/examples/webgl_shadow_contact.html
79. https://github.com/mrdoob/three.js/blob/r186/manual/pages/color-management.html
80. https://github.com/mrdoob/three.js/blob/r186/examples/webgl_postprocessing_3dlut.html
81. https://www.npmjs.com/package/postprocessing
82. https://www.npmjs.com/package/n8ao
83. https://github.com/mrdoob/three.js/blob/r186/examples/webgl_tsl_instancing.html
84. https://www.npmjs.com/package/stats-gl
85. https://www.npmjs.com/package/ktx2-encoder
86. https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/SharpenNode.js
87. https://github.com/mrdoob/three.js/blob/r186/src/objects/Skeleton.js
88. https://github.com/mrdoob/three.js/blob/r186/src/core/Clock.js
