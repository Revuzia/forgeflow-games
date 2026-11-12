# GENESIS Ultra memory plan (town, 1686x873, Apple M5 unified memory)

These figures come from a read-only audit of four categories plus a check of each proposed cut. The units are a mix of MB and MiB, and the difference is under 5%. "CPU" means arrays the page keeps alive: three.js BufferAttribute and DataTexture data, plus JS heap. On unified memory, CPU and GPU bytes draw on the same RAM.

## 1. Estimated budget

| Category | GPU | Retained CPU | Biggest items (file:line) |
|---|---|---|---|
| Render targets | ~346 | ~0 | Sun shadow atlas: D32F 4096² 64 + unused R8 colour 16 = 80 (planet/lights.ts:103-111). hdr MSAA4: RGBA16F colour 45 + D32F depth 22 (post/pipeline.ts:587-588). Clouds history A/B, 2x2 RGBA16F MRT: 45 (sky/clouds.ts:1378-1383, 1550). Canvas and swap buffers: ~28. GTAO ao + blur: 22 (post/gtao.ts:242-254). hdr resolve: 17. atmoA, atmoB, sceneCopy, prevColor: 11 each. Cloud 3D noise: 10. |
| Terrain | ~300 | ~400 | Terrain patch pages: ~63 x 2.14 = 135 GPU + 135 CPU (chunks.ts:227, BatchedMesh keeps its arrays). Water pages are a full copy of the same vertices: ~75 + 75 (chunks.ts:851-852, 1053-1054). City-lights cube: 19 GPU + 71 CPU (citylights.ts:51-66). Idle pages: 21 + 21. Worker buffers and grids: 38 CPU. ANGLE orphaned buffers: ~20-64 transient (upload.ts:18-24). Field textures: 8 GPU + 16 CPU. |
| Life (veg, buildings, roads) | ~70-110 | ~200-250 | Near vegetation pools allocated at full capacity: 64.6 CPU + ~22 GPU (vegetation.ts:899-915). Building pages: 22 + 22, plus 14 of source geometry (bldbatch.ts:322-405). Far-tree pools: ~10-30 GPU + the same on CPU after verification; the audit's 160 was too high (vegetation.ts:1384-1441). Ground cover: 19.7 CPU + ~8 GPU (groundcover.ts:189-230). Tree geometry cache: 12.7 CPU + ~5 GPU. Far-tree block cache: a few MB to ~15 MB on a 3 km planet; the audit's 212 was refuted. |
| FX, sky, misc | ~8 | ~6 | Particles: 3+3 (fx/particles.ts:481-500). Sky meshes, leaf atlas, lightning, Vfx pool: about 1-2 each. These are not the cause of the paging. |
| Per extra world (scenario-dependent) | ~0-45 | ~80-125 | Every PlanetVisual eagerly builds Vegetation + GroundCover arrays, 80.4 CPU (planetview.ts:137-141). Its chunk LOD and fields add about 15-45. Extra worlds: sandbox x1, twoworlds x2, system x6. |
| Kept after first use (not in totals) | 34-38 | 0 | Photo DOF targets: 33.7 (camera/photo.ts:238-269). Wet-lens copy: 2.8 (fx/screenfx.ts:283-289). |

The steady-state total is about 0.7-0.8 GB GPU plus 0.6-0.7 GB retained CPU, so roughly 1.3-1.5 GB. Swap grew by 3.2 GB over 45 minutes, so the static footprint does not explain the drift on its own. The likeliest growing or transient terms are:
- ANGLE-Metal copying a whole buffer for each bufferSubData into an in-use buffer: terrain pages on every patch landing, and far-tree and instance pools.
- Pages that are never freed: bldbatch pages, and idle and slack pools that are trimmed only inside evict().
- Lazily allocated render targets that are never freed.

The perf line in section 4 has to measure these before anyone treats the cuts below as the fix.

## 2. Verified cuts that keep the image the same (ranked by MB saved per unit of effort)

| # | Cut | Where | Exact change | Saves | Risk |
|---|---|---|---|---|---|
| 1 | Clouds history aux RGBA16F to RG16F | sky/clouds.ts:1378-1383 (mrt), writer :1322, readers :1289-1304 and atmosphere.ts:429 | For hist[0] and hist[1] only, set `textures[1].format = RGFormat` before first use. Leave cloudsRaw's aux alone, because .w is read at :1242. | 11.2 GPU | None; bit-identical |
| 2 | Remove the never-written R8 colour attachment of the 4096² shadow atlas | planet/lights.ts:103-121 | Build a depth-only FBO by hand, with uShadowMap on the DepthTexture. Alternatively, after init() detach COLOR_ATTACHMENT0 and delete the texture; redo this after setSize and check FBO completeness once. | 16 GPU | Image none; implementation low-medium |
| 3 | Stop the duplicate 'normal' copy in each patch page | chunks.ts:76-77 vs three BatchedMesh.js:393 | Right after a page's first addGeometry, before its first render, set `geometry.attributes.normal = geometry.attributes.position`. Add the update range only once per landing so the upload is not doubled. Pin to three r186. | ~20 (half GPU, half CPU) | Low |
| 4 | Ground cover iExtra as a single-element divisor attribute | groundcover.ts:192-196 | `new InstancedBufferAttribute(new Float32Array([0,0,0,1]),4,false,6000)`, using a divisor equal to the max capacity rather than 1<<30 to be safe on ANGLE. | 3.4 CPU + ~1 GPU | Bit-identical |
| 5 | Drop prevColor; the water samples last frame's final atmo target | renderer.ts:570, 703; pipeline.ts:593, ~632-642; ocean.ts:329 | Track lastOut, the atmo target the last composite and FX wrote. When atmoVis.length >= 1, skip keepPrevious and set tPrevColor = lastOut.texture. Keep a lazily allocated prevColor copy only for airless frames. Move sane() into the ocean's tPrevColor taps. Add an assert that nothing writes atmoA or atmoB between the composites and the next water pass. | 11.2 GPU, plus one full-res pass fewer per frame | Low |
| 6 | Alias GTAO's raw `ao` target onto sceneCopy (scale 1 only) | gtao.ts:242-254, 286-292; renderer.ts:557 then :563 | Give GtaoPass an optional scratch target and pass post.sceneCopy when aoFor(q).scale==1 and the sizes match. Make the blur and centre taps use `texelFetch(clamp(ivec2(gl_FragCoord.xy)+ivec2(i+1,j+1), ivec2(0), ivec2(uRes)-1))`. | 11.2 GPU | Low-medium; indistinguishable, not bit-exact |
| 7 | Alias GTAO's `blur` onto atmoB when an atmosphere composite follows | gtao.ts:243, 262-264; renderer.ts:557, 597-604, 644 | Move the atmoVis build above the GTAO block. If atmoVis.length>=1 and scale==1, write the blur into post.atmoB, fetched each frame rather than cached. Give resultSize and result the aliased target. Keep a lazily allocated own blur for the airless gtao.apply path at :604. | 11.2 GPU | Image none; logic medium |
| 8 | Near vegetation and ground cover pools: allocate lazily, grow by powers of two up to the same caps | vegetation.ts:899-915, 1221, 1901-1904; groundcover.ts:189-230, 546, 665 | Start at 256 and double, never above today's 1200/3000/6000 caps. Make the cap tests at :1221, :546 and :665 use the logical cap. Grow the `dist` array too. Per bucket, use a new BufferGeometry that reuses the cached attributes and index, not clone(), and holds its own iExtra. Free the old GL buffers on grow by recreating the mesh. Keep one mesh per program for warm-up. | ~60 veg + ~12 ground cover, mostly CPU (GPU ~10-20) | Low-medium. Per-bucket geometry also fixes the shared-iExtra bug, which changes the image only when there are 2+ worlds. |
| 9 | Water draws from the terrain page's own vertex buffers | chunks.ts:217-500, 763-771, 851-852, 1053-1054 | Each terrain PatchPage gets a companion water BatchedMesh (water material, layer 2) that shares the page's geometry and _geometryInfo. Water slot k is terrain slot k, with its own setVisibleAt. Mirror addGeometry and addInstance and compaction moves. No double dispose. This also removes the extract() copy and its whole-buffer uploads. | ~110 (range 85-150), half GPU, half CPU | Image none; implementation medium-high. Confirm the wet-page count with lod.batchStats() first. |
| 10 | Compact far-tree instance format | vegetation.ts:1400-1408, far vertex shader, VEG_DEPTH_VERT, shaders/zcons.ts:63-64 | Use a 3x4 affine matrix (iM0..iM2), with colour and extra as half4 and the hull id in colour.w: 96 B to 64 B per instance. This needs a path outside three's USE_INSTANCING (patch the normal and project chunks), an #ifdef in the shared depth shader, and a far-tree route for zcons. | ~25 (half GPU) | Matrix bit-identical; half floats indistinguishable; medium-high effort |
| 11 | Shadow building batch without normal and colour | buildings.ts:236-241, buildingmat.ts:756-785 | Give bShadow stripped geometries that share the source position, uv and aKit attributes, through a source-to-stripped map in geom() and dropGeom(). | ~1.6 | Low |
| 12 | Housekeeping: free photo DOF targets and the wet-lens target when unused | photo.ts:260-269, screenfx.ts:283-289 | In the early-return branch, dispose target, hist[0] and hist[1] and null them. Dispose lensRT after a few dry seconds. | 0 at the repro; 38 if used; up to ~450 after a 4K DOF capture | None |

The verified total is about 280-330 MB, of which about 140-180 MB is GPU. Render-target cuts 1, 2 and 5-7 are about 61 MiB of GPU between them.

## 3. Refuted or overstated cuts (one line each)

- **Free the CPU arrays of terrain pages:** a 0-length array throws in WebGLAttributes.update (:212) and in BatchedMesh. It also breaks context restore and the extract() wet-patch path.
- **Wall-clock idle and slack timers:** trim and compact run only inside evict(), which never runs at a static view. The real saving is about 9 MB, and only after evictions.
- **Tighter patch cache budget:** Ultra selects more than the low-quality 450-550 assumed, and the in-use floor is about 1.33x selected. The saving is about 30 MB or less, possibly 0, and it causes rebuild churn.
- **Release other planets' patches:** saves 0 in single-world scenarios (barren is the default) and about 15 MB per unseen world otherwise.
- **Gate far-tree blocks by need:** on a 3 km planet nearly every cell above the horizon is already needed. The saving is about 3 MB of CPU, and a per-cell species height bound would drop tall trees.
- **Fixed-size pages for far-tree pools:** saves about 12 MB, not 50; the "transient" share was never measured. Shrinking the arrays in compact() when cap > 2x live gets most of it.
- **Building page eviction:** saves about 0 at load, fixed pages rarely empty, and the gid encodes the page index. Only the bShadow strip, cut 11, survives.
- **Lazy Vegetation and GroundCover only for the primary planet:** the image changes because of the shared cached tree geometry's iExtra (vegetation.ts:905). Fix the bug first (cut 8). The saving is 80 MB of CPU per extra world only.
- **Free the CPU arrays of cached tree geometry:** a second Vegetation recomputes its bounding sphere from empty arrays (vegetation.ts:913-915), and a thrown tree's bounding box breaks (flights.ts:91-93). The saving is about 10 MB of CPU, with no GPU saving.
- **Photo DOF dispose (fx-misc copy):** safe, but saves 0 MB at the repro. It is the same change as cut 12.

## 4. What the "gpu mem" perf-report line should count

1. **Wrap the WebGL2 allocators** (texImage2D/3D, texStorage2D/3D, renderbufferStorage(Multisample), bufferData and the matching delete calls), keyed by GL object, so live bytes are tracked from the real driver calls rather than from three's bookkeeping.
   - Texture bytes are width x height x depth x bpp x faces (6 for a cube), with mips at x4/3 for 2D or x8/7 for 3D.
   - MSAA renderbuffers count samples x bpp.
   - Real depth bpp: D32F is 4. D24S8 counts as 8, because Apple maps it to Depth32Float_Stencil8.
   - Each MRT attachment counts on its own.
   - Buffers count their bufferData size, which is capacity, not draw count.
   - Add a constant for the canvas: back buffer + depth-stencil + 2 compositor buffers, about 28 MB at this size.
2. **Group by owner and planet:** render targets (with lazy ones flagged resident: atmoB, photo, lensRT, airless prevColor), terrain pages, water pages, idle and slack pages per pool, field and city-lights textures, veg near/far, ground cover, buildings, roads, fx. Per PlanetVisual, report whether it is primary.
3. **Retained CPU:** the summed byteLength of BufferAttribute.array and DataTexture.image.data still referenced by live geometries and textures. Add the farStats.blocks/instances/grows totals, worker recycle sets, and JS heap (`performance.memory.usedJSHeapSize`, or `measureUserAgentSpecificMemory` when the page is cross-origin isolated).
4. **ANGLE-Metal transients (the probable drift):**
   - Per frame, the count of bufferSubData calls and bufferData calls and their bytes.
   - An estimated copy cost: the full size of the target buffer for each bufferSubData into a buffer drawn in the last ~3 frames.
   - A running orphan estimate, capped at the 64 MB GC threshold.
   - Count texSubImage the same way.
5. **Logging:** print the total, top-10 owners, peak since load, and growth per minute, so a 45-minute run shows which term rises along with swap.