# GENESIS on M5 / ANGLE-Metal: ranked causes, bisection switches, Mac test protocol

All paths are under `games/genesis/src/render/` unless noted. Nothing was edited and nothing was run in a browser.

## 0. What the numbers say before ranking

- **Cost per pixel.** Ultra is about 2.2 s GPU over 3.15 MP, roughly **0.70 µs/px**. High is about 0.83 s (242 ms scene + 588 ms post).
- **High renders fewer pixels than Ultra.** With the same window, High runs at maxDpr 1.5, not 2 (quality.ts:42 BASE vs :57 ultra), so 1920x925 (1.78 MP). That gives about **0.47 µs/px with no MSAA, full-res GTAO off and 16 atmosphere steps**.
- **So most of the term does not depend on MSAA.** The four verified items (atmosphere march, GTAO, the MSAA re-entries and resolves, the MSAA store/reload) add up to about 25-60 ms per frame on Ultra, which is about **2-3 %**.
- **The ~100x term is still not located.** Static reading refuted the obvious suspects. A refutation from source reading cannot price what ANGLE-Metal does with the translated shader, so the bisection in sections 2 and 3 is the deliverable that matters.
- **GPU timer spans are unreliable here.** They overlap on ANGLE-Metal, because the timer query appears to be measured per Metal command buffer. Per-pass `perfmon.mark` spans already exist (renderer.ts:520, :525, :529, :538, :577, :643, :647, :663; post/pipeline.ts:658, :684, :750, :759), but they inherit the same overlap. Section 2 adds a sync-timed alternative.

## 1. Ranked likely causes

### 1. The unlocated per-pixel term, over 90 % of the frame

Suspects in the order to bisect:

**a. Opaque-scene fragment shading.** Terrain, foliage, buildings, run through `r.render` at renderer.ts:505.
- On Ultra this is ~1 s for 3.15 MP. Removing far trees cut triangles from 28M to 11.8M and changed nothing, so it is per-pixel shading or depth/ROP behaviour, not geometry.
- **Check first:** the report header line `zcons on|off (why)` (app.ts:404). If the Mac says `zcons off (missing EXT_conservative_depth|EXT_depth_clamp)` (shaders/zcons.ts:107-110), the refuted "log depth writes gl_FragDepth, so there is no early-Z or HSR" hypothesis is live again. Every layer under trees and houses is then shaded, at 4 samples on Ultra.
- Even with zcons on, `layout(depth_greater)` gives early-Z but probably not Apple's deferred HSR. Overdraw then depends on draw order.
- Test: `?flat=1` (new). If it is fast, the cost is shading. If it is still slow, it is raster, depth or bandwidth.

**b. The cloud march inside 'post'.**
- clouds.render at renderer.ts:572-590, with cloudSteps 72 on Ultra and 48 on High. It runs every frame while the camera is in air (renderer.ts:426).
- The colleague's refutation was static. High's 588 ms post, without MSAA, fits a heavy per-marched-pixel loop better than anything else in post.
- Test: `?clouds=0` (exists), then `?cloudsteps=N` (new).

**c. Water in hdr** (renderer.ts:539-546): shading plus one re-entry.
- Test: `?water=0` (exists).

**d. Memory residency or paging.**
- About 15 full-res RGBA16F targets, the 4x MSAA hdr (151 MB), the 4096² shadow atlas and the planet field textures could exceed the GPU process's working set. Metal would then page resources on every command buffer.
- This also scales with pixels.
- Test: Chrome Task Manager "GPU memory" and Activity Monitor (GPU process memory, swap) during the run, plus the `?rscale=0.5` run in section 3.

### 2. MSAA4 hdr: 2-3 bind / store / reload / resolve cycles per frame (Ultra only)

- Where:
  - opaque pass renderer.ts:501-505, decals fx/godfx.ts:578-581 to fx/decals.ts:487 and :496-503, water renderer.ts:539-546;
  - target post/pipeline.ts:586-587;
  - three's resolve WebGLRenderer.js:1795-1798, blit WebGLTextures.js:2323-2342;
  - the MSAA buffers are never invalidated, because invalidation is limited to OculusBrowser (WebGLTextures.js:10).
- Cost: about 1-1.5 GB of bandwidth, roughly 8-15 ms, or up to 20-30 ms if ANGLE resolves D32F MSAA depth with a shader draw.
- Fixes that keep the image:
  - (a) `gl.invalidateFramebuffer` on the MSAA framebuffer, colour and depth, after the last hdr pass (renderer.ts:545). Every later reader uses the resolved hdr.texture or hdr.depthTexture.
  - (c) Merge the decal and water renders, but only if the water is drawn after the decals: the water is opaque (ocean.ts:804-810) and the decals are transparent with depthTest off (decals.ts:454). A merged render must make the water material transparent with a higher renderOrder, or use a custom sort.
  - Do not use `resolveDepthBuffer=false` for the water pass: atmosphere and clouds read post.depthTexture after it.
- Test: `?msaa=0` (renderer.ts:47, applied at :254). A saving far above ~30 ms would point to a per-sample interaction instead (gl_FragDepth with MSAA, or discard).

### 3. GTAO at full res on Ultra

- Where: post/gtao.ts:36 (scale 1, 3 slices x 6 steps). 41 depth taps, each with an exp2 decode and a mat4 (gtao.ts:48-56, :74-150). 5 shadow taps via planet/lights.ts:30-51. Blur at gtao.ts:153-171. Called at renderer.ts:513 and :521.
- The radius is about 14-38 px at 50-137 m (uProjScale at gtao.ts:290), and pixels beyond 600 m exit early (gtao.ts:79).
- Cost: about 3-10 ms.
- Fix: a prefiltered R16F view-z mip chain, XeGTAO style. Build linDepth (pipeline.ts:615-628) before gtao.compute; today it runs after.
- Test: `?gtao=0` (renderer.ts:50).

### 4. Atmosphere composite: a 24-step march per pixel, per visible air shell

- Where: sky/atmosphere.ts:405-504, shaders/atmosphere.glsl.ts:91-127 (loop at :99), uSteps at renderer.ts:624.
- Cost: about 3-6 ms per shell. The primary planet's shell is always visible in the town view (renderer.ts:1028-1039).
- Fix: an aerial-perspective froxel LUT plus a sky-view LUT (Hillaire 2020), or scale the step count by path length, since geometry within ~450 m gets almost no in-scatter (uApRamp at renderer.ts:634).
- Test: `?atmosteps=4` (new) against 24. `?atmo=0` also removes the clouds (renderer.ts:573-591) and triggers gtao.apply's copy back into MSAA hdr (renderer.ts:565, gtao.ts:309-316), so if you use it, use `?clouds=0&gtao=0` against `?clouds=0&gtao=0&atmo=0`.

### 5. Small items, under 1 ms each

- The lum chain is RG32F with LinearFilter (pipeline.ts:571). That needs OES_texture_float_linear. If it is missing, the result is wrong exposure, not slowness.
- readMeter's readPixels (pipeline.ts:776) is a dev-only call.

## 2. New URL switches for one bisection build

Register each with `perfSwitch()` (perfswitch.ts:12) so the report header prints it (app.ts:404). Default every switch to "unchanged".

| Switch | Location | Effect |
|---|---|---|
| `?passsync=1` | `PerfMonitor.mark()` perfmon.ts:90, plus `begin`/`end` :74-86 | When set: `gl.finish()`, then add `performance.now()` minus the last mark time into a per-mark-name accumulator. Print the per-mark mean ms in the report. This gives sync-exact GPU ms per pass on ANGLE-Metal, at the price of a slightly lower fps. Also add `perfmon.mark('scene:shadows')` at renderer.ts:479. |
| `?flat=1` | renderer.ts:504, just before `r.render` at :505 | `this.scene.overrideMaterial = flatMat` (a MeshBasicMaterial; it keeps logdepth and instancing), set back to `null` after :505. Separates the cost of opaque shading from the cost of raster and depth. |
| `?scene=0` | renderer.ts:505 | Replace with `r.clear()`. Post on an empty scene gives the floor of the post chain. |
| `?hide=veg,cover,life,terrain` | renderer.ts:504, restore after :505 | Set `.visible=false` on `vis.vegetation.group`, `groundCover.group`, `life.group` (planet/planetview.ts:138-142), and `material.visible=false` on `terrainMats` (planetview.ts:146-152) for the primary visual. Restore after the render. Buildings are expected to sit under `life`; confirm that when adding the switch. |
| `?shadows=0` | renderer.ts:471 | `&& SW_SHADOWS` in `wantShadows`. |
| `?rscale=0.5` | renderer.ts:252-253 | Multiply `this.quality.renderScale` by the value. Tests pixel scaling in the same window and the same build. |
| `?atmosteps=N` | renderer.ts:624 | `u.uSteps.value = N ?? q.atmoSteps`. |
| `?cloudsteps=N` | renderer.ts:590 | Replace `q.cloudSteps` with N. |
| `?decals=0` | fx/godfx.ts:579 | `if (!SW_DECALS) return;` |
| `?fx=0` | renderer.ts:648-656 | Skip `renderFx`, `godfx.renderFx`, `ships.fx.render` and `worlds.render`. |
| `?lum=0` | post/pipeline.ts:711-727 | Skip the luminance chain and the adapt pass; the exposure freezes. |
| `?recms=10000` | perfmon.ts:257 | Record length. The default stays 20000. |

Existing switches: `msaa`, `clouds`, `water`, `gtao`, `atmo` (renderer.ts:47-51), `zcons` (:130), `bloom`, `godrays` (pipeline.ts:27-28), `fartrees`, `shnear` (life/vegetation.ts:789-791). `quality=ultra` is in app.ts:79.

## 3. Mac test protocol (copy-paste for the tester)

```
SETUP
- Chrome on the M5, plugged in, no other tabs, window size fixed for the whole session (note it).
- Base URL: <game URL>?quality=ultra&perf=1&recms=10000   (call this A)
- Load the world, fly to Rubolhin, hover ~100 m above the town centre looking at it.
  Then DO NOT touch mouse/keys for the rest of each run. Wait 10 s after arriving before recording
  (streaming settles; the idle camera hold starts after ~4 s).
- For every variant: open the URL in the SAME tab (append the switch), return to the same saved view
  (same save / same teleport), wait 10 s, press "Record" in the Shift+F12 overlay, wait for "done",
  press "Copy report", paste into a text file named <order>_<variant>.txt.
- Check the report header once: it must say "zcons on". If it says "zcons off (...)", STOP and report that line first.

ORDER (interleave the baseline A to cancel thermal drift):
 A, B=msaa=0, A, C=flat=1, A, D=clouds=0, A, E=water=0, A, F=gtao=0, A,
 G=scene=0, A, H=hide=veg,cover,life, A, I=hide=terrain, A, J=shadows=0, A,
 K=clouds=0&gtao=0&atmosteps=4, A, L=fx=0&decals=0&lum=0&bloom=0&godrays=0, A,
 M=passsync=1, A
PIXEL SCALING: N=rscale=0.5, A, then resize the window to about half width and height and run A once more (note the size).
DURING ONE A RUN: open Chrome Task Manager (Window > Task Manager), note the "GPU Process" memory;
 in Activity Monitor note Memory Pressure and Swap Used.
SEND: all .txt files plus the memory notes.
```

**How to read the results:**
- Take each variant's mean frame interval minus the mean of its two neighbouring A runs.
- C fast: the cost is opaque shading. Then H and I locate the subsystem.
- D or K fast: clouds or atmosphere.
- G fast but C slow: raster, depth or bandwidth.
- Nothing fast and N about 4x faster: bandwidth or memory. Check the memory notes for paging.
- M gives exact per-pass milliseconds to confirm the winner.
