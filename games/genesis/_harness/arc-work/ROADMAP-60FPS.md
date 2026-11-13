# GENESIS on the M5: PERF lane plan to a steady 30, then 60 fps, at equal or better quality

This is a read-only synthesis. No code was changed and no browser was opened. It builds on the 4 angle plans, the 2 judge rankings, the MAC-ROUND3/4/5 reports and PERF.md sessions 8-16.

## 1. Diagnosis (5 lines)

1. The page is not the bottleneck. The main thread uses 27-35 ms of a 300-1500 ms frame, and the rest is spent blocked waiting on the GPU process or the GPU itself.
2. The per-pass GPU times cannot be trusted. ANGLE-Metal adds up the duration of every command buffer that was open during a query (mtl_command_buffer.mm:641-713). A one-draw tonemap at 170 ms under passsync, with an empty queue, points to a driver, residency or contention problem, not to Genesis' shader cost.
3. The number tracks bytes touched, not passes or draws. These moved fps: msaa off 3.3, rscale 0.5 4.0, hiding terrain 3.7, flat material 6.8. These did not: shadows=0, clouds=0, gtao=0, hiding vegetation and life, and turning off single post passes.
4. Two hypotheses remain open. **H1:** memory pressure and residency, or contention in the shared GPU process (Genesis uses about 680 MB of GPU memory; the tab is 2-2.6 GB; the GPU process is 3.1 GB; swap is nearly full; fps drifted from 2.3 to 1.3 as swap grew). **H2:** wasted GPU traffic and fragment work: 62-245 uploads land inside render passes and each one breaks a Metal pass, MSAA buffers are reopened, and the gl_FragDepth write needed for log depth switches off Apple's hidden-surface removal.
5. Earlier A/B verdicts (preupload and span "harmful", invalidate counted as "noise") came from runs that were not interleaved, inside a 40% drift band. They should be treated as unproven.

## 2. Roadmap (at most 10 steps, in order; every step sits behind a URL switch, and the switch value shown turns the step off)

**Step 1. Measure cleanly. This is owner time, plus about 10 lines of code. Switch: `?gputimer=0`.**
- **Files:**
  - `_harness/arc-work/MAC-TEST-PROTOCOL.md`: interleave runs ABAB or ABBA with 3 or more pairs and compare medians. Log memory pressure colour, swap and GPU-process footprint in every run header. Run in a separate Chrome instance: `open -na 'Google Chrome' --args --user-data-dir=/tmp/genesis-perf`. Capture Activity Monitor GPU History, the CPU % of the "Chrome Helper (GPU)" process, and a 5-10 s Perfetto trace with categories gpu, viz, cc, toplevel, disabled-by-default-gpu.service.
  - `src/render/perfreport.ts`: add `gputimer=0`, which skips the TIME_ELAPSED queries. Add a header note that ANGLE per-pass ms are command-buffer spans. Make fps, interval p50/p95 and longtask ms not spent in main the headline figures.
- **Gain:** none directly, but this is the cheapest test of H1. If the separate instance runs much faster, contention and swap are a large part of the floor.
- **Proof:** two consecutive baseline runs land within 10% of each other. The Perfetto trace shows whether CrGpuMain is busy, waiting in waitUntilCompleted, or idle while the GPU is busy.

**Step 2. Two in-game diagnostics. Switches: `?gpuprobe=1` and `?freeze=1`. About 1 day.**
- **Files:**
  - `src/render/perfreport.ts`: new `probeGpu(gl)`, run at start and every 5 s while recording. It does 32 trivial copies A->B->A of fresh rgba16f targets at canvas size, inside one gl.finish. It repeats this at 64x64, and does 8 copies that sample the existing `post.hdr` texture and the shadow atlas.
  - `src/render/perfswitch.ts`: `freeze`, wired into:
    - `planet/chunks.ts`: landReady stops once landing has converged.
    - `life/vegetation.ts`: flushRanges and near rebuilds stop.
    - `life/bodies.ts`: end() skips uploadPrefix.
    - roads, particles, and field and overlay textures: no rebuilds or updates.
    - the sim runs at speed 0.
- **Gain:** none directly. These two runs decide which branch of the plan gets the effort:
  - Probe at 5-50 ms per pass in-world, fresh targets included: H1 holds. Do step 3 first, before anything else.
  - Probe fast, and freeze=1 at 15 fps or more: the cost is frame structure, and steps 4-6 carry the weight.
  - Probe fast, and freeze=1 still about 2 fps: the cost is GPU execution, and steps 7-9 carry the weight.
- **Proof, locally:** with freeze=1, the gl trace shows bufferSubData 0, texSubImage 0 and ANGLE transients 0 at identical draws and tris. Imgdiff at sim speed 0 differs only by sway.

**Step 3 (moves to first place if H1 holds). Shrink the GPU working set without touching pixels. Switch: `?rtalias=0`. Effort M.**
- **Files:**
  - `src/render/post/pipeline.ts`: alias full-res post targets whose lifetimes do not overlap. Today about 15 full-res targets each hold their own memory; liveness analysis per pass lets them share a small pool.
  - Drop the R32F linDepth copy once every consumer decodes `hdr.depthTexture` directly. This is gated on an audit of all decoders.
  - `src/render/gpumem.ts`: report the result "by owner".
  - Free CPU-side shadow copies of uploaded buffers and textures (where `onUpload` disposal is safe), to cut the tab footprint.
- **Gain:** if residency or paging is the floor, this is the main lever. It also helps every other step under memory pressure. Target: Genesis GPU memory from about 680 MB to 450 MB or less, and the tab under 1.5 GB.
- **Quality:** identical. Same targets, same formats, same resolution; only memory is shared.
- **Proof:**
  - Locally, imgdiff is bit-exact on 5 views, and the gpumem total drops.
  - On the Mac, ABAB rtalias=0/1 with pressure logged, and the gpuprobe ms per pass should fall.

**Step 4. No uploads inside render passes. Switch: `?upsched=0`. 3-4 days.**
- **Files:**
  - New `src/render/uploadsched.ts`, called in `renderer.ts render()` in the "uploads" slot before `shadows.render`.
  - `bufring.ts` uploadPrefix: write the cold ring member at frame start.
  - `upload.ts` installTexturePreUpload/flushTextureUploads: upload from a dirty set registered by each owner, not the global needsUpdate hook. Owners: `fx/vfx.ts` emitTex/blockTex, `life/bldbatch.ts` texU, `life/farcrown.ts:280`, `life/ships.ts:521`, `planet/fieldtex.ts`, `dirtex.ts`, `overlaytex.ts`.
  - Double-buffer the per-frame data textures, swapping only when their data changes.
  - Move the `citylights.ts:234` generateMipmap to frame start.
  - `chunks.ts` landReady: replace the 8 ms cap with a byte cap of about 1.5 MB per frame, landing into one cold page (FRESH_LAND). Add camera-velocity prefetch in select(). Patches whose parent is missing are never deferred.
- **Gain:** on Metal, every staged upload or blit ends the render encoder, which then stores and reloads the 64 MB D32F atlas or about 150 MB of MSAA hdr. That is up to several GB per frame of avoidable traffic. This is the main lever if step 2 shows the structure branch.
- **Quality:** same texels and bytes, at most one frame earlier or later. Prefetch prevents pop-in.
- **Proof:**
  - Locally, the perf report's "uploads inside a pass" reads about 0 in the shadows and scene slots.
  - Extend `tests/render-preupload.test.ts` with a GlTrace assertion: no tex* or generateMipmap call between the first and last draw of a bound framebuffer.
  - Pop-in check: probe-descent shots.
  - On the Mac, ABAB against upsched=0. Re-test `span` and `preupload` the same way.

**Step 5. Finish the buffer side. Switches: `?ringfence=0` and `?lifesplit=0`. About 3 days.**
- **Files:**
  - `bufring.ts` ringTick: one gl.fenceSync per frame, polled without blocking. Pick a ring member whose last draw is at or before the last frame the GPU completed. Grow the ring to 4-5 instead of the fixed RING_N=3 (bufring.ts:19).
  - Ring the remaining ad-hoc dynamic buffers:
    - `fx/meshfx.ts:683/697`
    - `fx/lightning.ts:176`
    - `fx/launch.ts`
    - `fx/tsunami.ts:475`
    - `fx/throwfx.ts:228`
    - `fx/sigilfx.ts:152`
    - `fx/miracles.ts:109`
    - `life/ships.ts:1696`
    - the godfx 288 kB buffer
    - the shadow-slot uploads (round 5 B1 showed bufferSubData at 115 ms per frame)
  - `life/bodies.ts` set()/end(): write colA/B/C and iStyle only on spawn or change.
- **Gain:** ANGLE whole-buffer copies go to 0 and BufferManager 64 MB GC drains go to 0 (`mtl_buffer_manager.mm:239` WaitUntilFinished). CPU and GPU then overlap, so a frame costs the larger of the two rather than their sum. Hitches disappear and life bytes drop about 40%.
- **Quality:** none changed.
- **Proof:**
  - Locally, `tests/render-bufring.test.ts` uses a fake fence that lags 5 frames and checks that the ring never writes a member that is still in flight.
  - On the Mac, the gpumem "angle transients" line reads 0.0 MB per frame, with 0 full GPU waits in a 20 s pan.

**Step 6. One MSAA hdr reopen instead of two. Switch: `?hdrmerge=0`. 1 day.**
- **Files:** `renderer.ts` around lines 586-602. Today `godfx.renderDecals` (`fx/decals.ts`, layer 5) and the water `r.render` (layer 2) are separate passes. Merge them into one `r.render` with camera layers 2|5, using renderOrder to keep decals before water and keeping each material's own state.
- **Gain:** one fewer 4x rgba16f+depth load, store and resolve: about 0.2-0.5 GB per frame, or 2-4 ms. Small at 2 fps, real against a 16.7 ms budget.
- **Quality:** identical. copyForWater is taken before the decals today, so the water refracts the same image.
- **Proof:**
  - The report's hdr "binds/frame" goes from 3 to 2.
  - Imgdiff of town and shore at the sway noise floor (1-2/255).

**Step 7. Pilot for hidden-surface removal: no gl_FragDepth write in the orthographic shadow depth twins. Switch: `?orthodepth=0`. Effort S.**
- **Files:**
  - `shaders/zcons.ts`: the overridden logdepthbuf_fragment chunk emits no write when `GENESIS_ORTHO_DEPTH` is defined. three writes `gl_FragDepth = gl_FragCoord.z`, an identity, for orthographic cameras.
  - Twins installed via `planet/lights.ts` swap(true): vis.swapDepth, godfx.swapDepth, ships.swapDepth. Exclude any twin that is ever drawn with a perspective camera.
- **Gain:** the depth-only pass that carries 19M of 22-28M triangles gets Apple's fixed-function depth path. This is a cheap test of H2 before the large step 8.
- **Quality:** bit-identical.
- **Proof:**
  - Locally under SwiftShader, read back the shadow atlas: exact match with and without the define.
  - On the Mac, ABAB, read together with the gpuprobe line.

**Step 8. Reversed-Z float depth in place of log depth. Switch: `?revz=0` (log depth remains the fallback). 3-5 days.**
- **First check:** that the Mac report's extension list contains EXT_clip_control. If it does not, this step is dropped and step 7 stays the only lever for hidden-surface removal.
- **Files:**
  - `renderer.ts:223-224`: `reversedDepthBuffer: true` in place of `logarithmicDepthBuffer`. three r186 supports it at three.module.js:2422 when EXT_clip_control is present.
  - Every depth decoder:
    - `shaders/atmosphere.glsl.ts` LOGDEPTH_DECODE
    - `post/pipeline.ts` linDepth
    - `post/gtao.ts`
    - `sky/clouds.ts`
    - `planet/ocean.ts`
    - `fx/decals.ts` and the soft particles
    - the god-ray mask
    - the starfield and sky test (d >= 0.999999)
    - the SunShadows compare and clear values
  - PERF.md FINDING 1(b) lists about 40 edit sites in total.
  - Keep `zcons.ts` for the fallback path.
  - Keep the draw order: foliage and buildings first, terrain at renderOrder 50.
  - No depth prepass.
- **Gain:** removes every fragment depth write, so Apple's hidden-surface removal and full early-Z work in every pass. The terrain shader (about 1900 lines) is no longer run under trees, houses and people. PERF.md estimates 3-6x overdraw in town and forest. This is the largest fragment-cost lever: under 2x today, but central to reaching 60.
- **Quality:** same or better. Precision from 0.05 m to orbit is more even, and the depth_greater fudge goes away.
- **Proof:**
  - Locally, imgdiff of region, town, ridge and orbit with mean |d| at the noise floor, 0 console errors, and z-fight checks on decals, roads and the water drape.
  - On the Mac, ABAB of revz=0 vs 1.

**Step 9. Cached far shadow cascades. Switch: `?shcache=0`. 2-3 days.**
- **Files:**
  - `planet/lights.ts` SunShadows.fit/render: store lightVP[k] per cascade. Rebuild uShadowMat every frame from the stored lightVP, so a cached cascade stays exact in world space.
  - Cascade 2 refreshes on even frames and cascade 3 every 4th frame, staggered, with a scissored clear of only the refreshed quadrant.
  - Force a refresh on any of these: the view slice leaves the cached box (2-texel margin); the sun moves more than 1/4 texel times caster height; a landing or far-tree flush, or a building add or remove, inside that frustum; cutFrames; a quality change; a ship moving more than 1/2 texel; a safety timer.
  - `renderer.ts` perCascade (around :878) skips cascades that are not being refreshed.
- **Gain:** 35-50% fewer shadow draws and triangles, and 3-6 ms less main-thread time. It pays only after the floor is gone (shadows=0 did nothing today), and it is part of the 45 to 60 fps step.
- **Quality:** identical for static casters. Tree sway (centimetres) is far below a far-cascade texel (0.4-1.4 m).
- **Proof:**
  - A node test of the refresh rules.
  - A 600-frame pan with a moving sun, comparing cached and fresh atlases: 0 difference outside the 1/4-texel margin.
  - stats.shadowTris and shadow draws in the report.

**Step 10. Main thread down to 10 ms or less, plus frame pacing, for 60. Switches: `?farmerge=0` and `?vegslice=0`. 4-6 days.**
- **Files:**
  - Far-tree draw merge: one instanced draw per hull LOD in `life/farcrown.ts` and the vegetation far buckets. This takes draws from about 1300 to about 300.
  - Cached per-layer render lists (8 scene traversals per frame today).
  - Time-slice the vegetation and cover rebuilds in `planetview.ts` and `vegetation.ts` under a ms budget.
  - `app.ts` linearDepthAt: readPixels becomes an async PBO read plus a fence.
  - Slice the worker snapshot apply across frames.
- **Gain:** main time today caps the game near 30 fps; this removes that ceiling and makes p95 close to p50.
- **Quality:** same instances and LODs.
- **Proof:**
  - The perf report's main mean/p95 and draws per frame.
  - Tests render-fartrees and render-treeshadowcut.
  - Mac: no longtask over 50 ms in a 20 s pan, and a p95/p50 ratio under 1.3.

**Expected path:** this is an estimate, not a promise.
- Steps 1-3 decide whether the floor is outside Genesis' control or inside it.
- Steps 3-6 should remove the 150-200 ms structural and residency floor, which is the 2 to 30 fps part.
- Steps 7-10 bring GPU execution under about 14 ms and main under 10 ms, which is the 30 to 60 fps part.
- If step 2 shows H1 and step 3 does not lift the probe, part of the floor is the machine's own state (swap full, a shared 3.1 GB GPU process). Then the owner must re-measure with less memory pressure before any code claim is made.

## 3. What to measure on the Mac after each step

Every run uses the separate Chrome instance, ABAB interleaving with 3 or more pairs, medians, and the same framing (Amonshis landing, Ultra). The header must carry memory pressure colour, swap and GPU-process footprint.

| After step | Read these lines |
|---|---|
| 1 | fps, interval p50/p95, longtask-minus-main. Separate vs shared instance. Activity Monitor GPU % and GPU-helper CPU %. Perfetto CrGpuMain slices. gputimer=0 vs 1. |
| 2 | The gpuprobe ms per pass at boot vs in-world, fresh vs old targets, full-size vs 64x64. fps with freeze=1 vs base. |
| 3 | gpumem total and "by owner", tab and GPU-process footprint, gpuprobe ms, fps. |
| 4 | "uploads inside a pass" (target about 0), framebuffer switches, fps, p95. |
| 5 | "angle transients" copies MB per frame (target 0.0), full GPU waits per 20 s (target 0), main ms in the shadows slot. |
| 6 | hdr binds per frame (3 to 2), fps. |
| 7 | fps and gpuprobe, ABAB orthodepth. |
| 8 | fps, p50, the scene share; the EXT_clip_control line in the header. |
| 9 | shadow tris and draws per frame, main ms in shadows, fps. |
| 10 | main mean and p95, draws per frame, longtasks, p95/p50. |

## 4. The WebGPU question

**Not now, and probably not later.** Check again only if a cheap benchmark shows at least 2x.

- **The data does not point at the API.** A trivial pass costs 170 ms with the queue drained, fps follows swap, and flat materials reach only 6.8 fps. A port does not change any of that.
- **Most of what WebGPU would bring is already in reach in WebGL2:**
  - The rings already cut copy-on-write from 8.26 to 0.43 MB per frame, and step 5 finishes the job.
  - Reversed-Z without fragment depth writes is three r186 `reversedDepthBuffer` (step 8).
  - Most of the MSAA reload waste goes away with steps 4 and 6.
  - Only memoryless MSAA attachments are WebGPU-only: about 150 MB of memory and some bandwidth, worth 10-30%, not 15x.
- **The port itself would be large and risky.** three's WebGPURenderer cannot run GLSL ShaderMaterial or onBeforeCompile, so all of about 13k GLSL lines in 44 files would have to be rewritten at once. That is 3-5 months, with pixel-parity risk under the never-lower-quality rule.
- **A hybrid is impossible in Chrome.** WebGL and WebGPU cannot share resources.
- **Reopen the question only** if, after steps 1-8, a 1-2 day synthetic WebGL2-vs-WebGPU benchmark on this Mac shows WebGPU at least 2x faster than WebGL2 with reversed-Z on the same frame.
- **Cheap insurance now:** write new materials in TSL-ready form.

## 5. Claims the judges rejected or downgraded

- **The "GPU total" and per-pass GPU ms as a basis for decisions.** Rejected: on ANGLE-Metal these are summed command-buffer spans.
- **"preupload and span are harmful" (session 9) and "invalidate is noise" (round 3).** Unproven: the A/B was not interleaved and fell inside the 40% drift. Re-test in step 4.
- **"Copies and GC waits explain the 2 fps."** Downgraded. 15-19 MB of blits is about 0.2 ms, and a drain costs at most one frame of queued work. They cause serialisation and hitches, not a 10x floor.
- **Shadow caching, coarser shadow casters and the atmosphere froxel/LUT as fixes for today.** Downgraded: shadows=0, atmo=0 and clouds=0 did not move Mac fps. Shadow caching stays as step 9 for 60 fps. The atmosphere LUT was dropped: 3-4 days, banding risk, no data support.
- **TAA in place of MSAA4+FXAA.** Not in the roadmap: ghosting and softness risk against the owner's rule, and its proven ceiling (msaa=0) is 3.3 fps. It is possible only later, behind a FLIP-vs-ground-truth gate and the owner's own side-by-side.
- **TAAU at 0.75 scale.** Rejected: it renders fewer pixels, which conflicts with "never lower quality".
- **Water rendered at 1x samples.** Rejected: water-edge quality risk.
- **"The MSAA invalidate is a no-op because it comes too late."** Unverified either way, because ANGLE may fold the resolve into StoreAndMultisampleResolve. Not scheduled until someone reads the ANGLE source.
- **A depth prepass.** Rejected: it doubles triangle work on a tile-based GPU, and hidden-surface removal via step 8 already does the job.
- **Hierarchical-Z/GPU culling, new impostors, more history buffers.** Rejected: no compute in WebGL2, pop-in risk, extra memory under pressure, and the draw count was shown not to be the limit.
- **A full WebGPU port and the hot-path hybrid.** Rejected (section 4).
- **Unverified by anyone:** whether Chrome 157 / ANGLE-Metal exposes EXT_clip_control (step 8 depends on it), and whether a `[[depth(greater)]]` depth write fully disables HSR or only partly. Step 7 answers the second cheaply.
- **Gap the judges raised that no plan addressed:** cutting the 680 MB GPU / 2-2.6 GB tab footprint. It is added here as step 3, and it moves to first place if the gpuprobe shows H1.
