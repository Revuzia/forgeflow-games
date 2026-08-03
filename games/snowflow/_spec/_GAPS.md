# SNOWFLOW spec set — completeness audit

Audit of the ten spec documents in this directory against the reference source at
`snowflow_demo/src` (96 files) and the reference `README.md`.

**Headline: the per-subsystem specs are unusually complete.** Every one of the 96 reference
source files is named by at least one spec (verified by diffing `find src -type f` against
`grep -l <basename> _spec/*.md`). Every subsystem the README names has an owning document.
Spot-checks for the "uses noise, no numbers" failure mode came back clean — the noise library,
the wake cross-section, the deformation decay constants, the PCSS tap table, the AgX matrices,
the controller integrator and the cloth solver are all transcribed verbatim with constant
appendices. The WebGL2 porting notes are the strongest part of the set: float-format
substitutions, the `OES_texture_float_linear` fallback ladder, the `readPixels` strip plan,
the 9000-clear trap, and the Y-flip verification procedure are all present and correct.

**What is missing is almost entirely cross-cutting** — the things that are nobody's subsystem.
Ten specs written in parallel each solved their own boundary and none owns the seams. Below,
in priority order. Items P0-1 through P0-5 will each independently stop or visibly corrupt a
port; P1-6 through P1-8 are missing content with identified reference answers.

---

## P0-1 — Nothing owns the shader include registry, and include *order* is load-bearing

**Missing.** `src/shaders/registry.js` (146 lines) is covered by no spec. Verification:
`grep -c registerShaders _spec/*.md` → **zero hits in all ten files**. The include names
`snowWater`, `snowPostCommon` and `snowRidge` likewise appear **nowhere**; `snowShadowLookup`
appears twice, both in `spells.md`, in passing.

Three separate things are unspecified:

1. **The 14 chunk names and their file map.** `snowNoise, snowTerrain, snowShading,
   snowShadowLookup, snowAtmosphere, snowClipmap, snowDeform, snowCharSkin, snowWake,
   snowSpellLights, snowWater, snowCrystal, snowPostCommon, snowRidge`. Specs reference
   includes by name (`#include<snowDeform>`, `#include<snowShading>`) with no dictionary.
2. **The per-shader include manifest.** Which of the 40 shader files pulls which chunks.
   Nowhere stated; it must be recovered by grepping the reference.
3. **The include ORDER, which is a hard compile requirement in GLSL ES 3.00.** WGSL permits
   module-scope forward references; GLSL does not — a function or uniform must be declared
   before use. The reference exploits this. `char.fragment.wgsl` reads:

   ```
   30:#include<snowNoise>
   31:#include<snowShading>
   32:#include<snowSpellLights>
   33:#include<snowAtmosphere>
   ...
   82:#include<snowShadowLookup>      <-- AFTER the uniform block, deliberately
   ```

   `snowSpellLights` must follow `snowShading` (it calls `wrapDiffuse`, `snowSubsurface`,
   `distributionGGX`, `visSmithGGXCorrelated`, `fresnelSchlick`). `snowShadowLookup` must
   follow the material's own uniform declarations, because `sunShadow` reads uniforms the
   *material* declares (`cascade0..2`, `cascadeMatrix`, `cascadeSplits`, `shadowParams`) —
   which is why the reference puts it 50 lines further down the file, not at the top.
   Only `spells.md` §13.4 mentions any ordering constraint at all ("must include
   `<snowShading>` first"), and only for one chunk.

**Reference files that answer it.** `src/shaders/registry.js` (the two maps, `INCLUDES` and
`SHADERS`, plus the Babylon store names `<name>VertexShader` / `<name>PixelShader`); the
`#include` lines of all 40 files under `src/shaders/`.

**Why it matters visually.** A port that hoists all includes to the top of each file will not
compile. A port that gets the order wrong between `snowShading` and `snowSpellLights` will
fail to link with an undeclared-identifier error that names a function the porter *knows*
exists. Neither failure is visual — it is total. Three.js resolves `#include<name>` against
`THREE.ShaderChunk` natively, so the mechanism ports directly, but only if the manifest and
order are written down.

**Fix.** One new short document (`includes.md`): chunk→file table, per-shader include list in
file order, the two ordering rules above stated as rules, and the note that
`snowShadowLookup` goes after the uniform block.

---

## P0-2 — Handedness: three specs give three different rulings, and one forbids what another recommends

**Missing.** A single normative decision. What exists instead:

- `terrain.md:1707` — "**Do not mirror any axis.** `windAngle`, the wind-anisotropy matrices
  and the dune orientation are all expressed in the same world XZ frame; flipping Z would
  reverse the lee-face asymmetry relative to the sun." Its recommendation is to fix winding by
  swapping the last two indices of every triangle.
- `sky.md` PORT-11 — "The cheapest correct port keeps every formula byte-identical and accepts
  that the world is a **mirror image** in Z relative to the reference screenshots… If matching
  reference screenshots exactly matters, negate Z when converting content-space to Three world
  space — **consistently, across sky, terrain, wind and character**."
- `post-core.md` §16.5 — a clean Option A/Option B ruling, but scoped to **view space only**
  (the prepass, SSR, TAA, DOF reconstruction). Silent on world space.
- `character.md` §1 — declares all bind-pose geometry authored in Babylon's left-handed
  +X right / +Y up / **+Z forward** frame, with `forward = (sin(facing), 0, cos(facing))`.

A porter who reads `sky.md` first and negates Z violates `terrain.md`'s explicit prohibition
and inverts the wind/sun separation the sastrugi look depends on. A porter who reads
`terrain.md` first gets a Z-mirrored sky relative to the reference screenshots and no
instruction about what that means for the character's yaw convention.

**Reference files that answer it.** `src/core/camera.js` (basis construction), `src/core/mat4.js`,
`src/character/controller.js:27-39` and the `facing` convention, `src/terrain/clipmapMesh.js`
(index emission), `src/shaders/lib/crystal.wgsl` + `crystal.fragment.wgsl` (facet normal from
screen-space derivatives — sign-sensitive), `src/shaders/post/ssr.fragment.wgsl`.

**Why it matters visually.** The whole look hangs on a 70–80° separation between wind bearing
and sun azimuth (`sky.md` PORT-11 says so explicitly). Mirror Z inconsistently and the dune
lee faces light from the wrong side: the sastrugi shadow the wrong way, the subsurface
back-scatter fires on the wrong flank, and the "sun 10–15° up" grazing look the README calls
the point of the demo collapses. It is also the class of bug that looks *plausible* — nothing
crashes, the scene just reads subtly wrong forever.

**Fix.** One page at the top of the set: the ruling (recommend — keep every world-space formula
byte-identical, mirror nothing, flip triangle winding, and accept the Z-mirror relative to the
screenshots), then a consequences table naming every site that changes: clipmap index winding,
character `facing`/`forward`/`right`, camera basis, cross-product sign in the crystal facet
normal, SSR/TAA view-space negation per post-core §16.5, and a note that `sky.md` PORT-11's
"negate Z" alternative is **withdrawn**.

---

## P0-3 — No normative beauty-pass draw order, and the per-spec `renderOrder` assignments collide

**Missing.** A single table of the beauty pass's draw order and per-mesh render state. The
reference assignments (grepped from source) are:

| Mesh | `renderingGroupId` | `alphaIndex` | Source |
|---|---|---|---|
| sky | 0 | — | `main.js:105`, `sky.js:110` |
| terrain clipmap | 1 | — | `main.js:120` |
| character body / cloth / fur | 1 | — | `character.js:163` |
| surf wake | 1 | — | `surfWake.js:144` |
| ice crystals | 1 | — | `crystals.js:84` |
| water body | 2 | **0** | `waterBody.js:128-129` |
| spray particles | 2 | — | `particles.js:110` |

What the specs say, independently and inconsistently:

- `wake-spray.md:1810` — maps `renderingGroupId = 1 / = 2` to `mesh.renderOrder = 1 / 2`.
- `spells.md:3154-3156` — crystals `renderOrder = 1`, water `renderOrder = 2`,
  spray `renderOrder = 3`.
- `character.md:1731` — "give the character meshes a `renderOrder` above the terrain, or just…"
  (no number).
- `shadows.md:1382` — crystals: `transparent = true; depthWrite = true;` placed in the opaque
  sort bucket by `renderOrder`.

Follow each spec on its own and spray lands at `renderOrder` 2 *and* 3 depending on which
document you read last, and the terrain has no assigned number at all.

**Reference files that answer it.** `src/main.js:105,120`, `src/render/sky.js:110`,
`src/character/character.js:163`, `src/vfx/surfWake.js:144`, `src/vfx/particles.js:110`,
`src/spells/crystals.js:84`, `src/spells/waterBody.js:128-129`, plus each `_makeMaterial` for
the blend/depth/cull state.

**Why it matters visually.** Water must draw after every opaque and must not write depth, or
the snow behind it disappears. Spray must draw after water or the fallout curtain sorts in
front of the column that threw it. Crystals are the odd one — alpha-blended *and*
depth-writing *inside* the opaque group, which is exactly the arrangement the README calls
out ("you see the snow through the ice but never one prism through another"); get the bucket
wrong and prisms show through each other.

**Fix.** One table: mesh, group, `renderOrder`, `transparent`, `depthWrite`, `depthTest`,
`blending`, `side`/culling, and the sort-bucket note for crystals.

---

## P0-4 — No consolidated resource inventory (formats, filters, wraps, extensions, VRAM)

**Missing.** `post-core.md` §1.2 has an excellent explicit render-target table — but it covers
only the **11 post-chain targets**. Every scene-side resource is described inside its own
subsystem document, and nothing aggregates them:

| Resource | Format / size | Where specified |
|---|---|---|
| `heightTex` | 4096² RG32F, clamp, no mips | `terrain.md` §9, `snow-shading.md` §2.1 |
| `auxTex` | 2048² RGBA16F, clamp | `terrain.md` §10, `snow-shading.md` §2.2 |
| `detailTex` | 1024² RGBA8, **repeat**, trilinear + mips | `snow-shading.md` §2.3 |
| deform state ×2 | 2048² RGBA16F, **repeat/toroidal**, bilinear | `deformation.md` §2.1 |
| deform brush texture | — | `deformation.md` §2.2 |
| shadow cascades ×3 | 2048² R32F, clamp, bilinear, clear 1.0 | `shadows.md` §3 |
| `skyLUT` | 512×256 RGBA16F, wrap-U / clamp-V, trilinear + **mips** | `sky.md` §2.1 |
| character transform texture | rows 0–3 bones, 4+ cloth nodes | `character.md` §6 |
| wake spine texture | 96×3 | `wake-spray.md` §2.8 |
| spray particle texture | — | `wake-spray.md` §6.4 |
| water strand texture | — | `spells.md` §3.4 |
| crystal texture | — | `spells.md` §11.2 |

Three consequences, all unowned:

1. **No boot capability check.** `post-core.md` §16.2 says to check `EXT_color_buffer_float`
   and fail loudly; `terrain.md` §13.3 says `OES_texture_float_linear` is "the critical one".
   Nobody assembles the list a port must probe at boot (the reference's analogue is the
   `navigator.gpu` check and the `#nogpu` page in `loading.js`).
2. **The README's "roughly 350 MB" VRAM figure is never reconciled.** `grep -c VRAM` finds
   3 hits in `deformation.md`, 1 in `shadows.md`, 2 in `terrain.md` — all local.
3. **No per-material sampler budget.** WebGL2 guarantees only 16 fragment texture units.
   `snow.fragment.wgsl` alone declares 7 sampler pairs (`auxTex, detailTex, skyLUT,
   cascade0, cascade1, cascade2, deformTex`) and Three.js will add its own. Nobody counts.

**Why it matters visually.** Getting `detailTex` to `clamp` instead of `repeat` kills every
tiled grain layer. Getting the deform targets to `clamp` breaks toroidal addressing and the
trail smears at the window edge. Getting `skyLUT` mips wrong removes mip-based specular and
the ice goes matte. Each is specified correctly in its own document; the risk is a port that
allocates textures in one file and never reads eight different specs to do it.

**Fix.** One resource table with the twelve rows above plus post-core's eleven: name, size,
format, filter, wrap, mips, WebGL2 substitution, extension required, bytes. Total the bytes
and reconcile against 350 MB.

---

## P0-5 — No performance budget or quality-scaling plan for the WebGL2 target

**Missing.** The README's measured numbers are the demo's headline claim — GPU frame **3.22 ms**,
base scene 1.64 ms, post ~1.1 ms, far range ~1.2 ms, **15–19 draw calls**, **~353,000 triangles**,
at 2560×1440 on an RTX 5070 Ti. None of it appears as a port acceptance target:
`grep -c "353,000"` → **0 hits**; `grep -ci "draw call"` → 3 hits, none a budget;
`"quality tier"`, `"resolution scale"`, `"renderScale"` → **0 hits each**.

`resolutionScale` and the `high` / `balanced` / `low` presets *are* fully specified
(`post-core.md` §13.1, §13.3, §16.9) — so the mechanism exists. What is missing is the
judgement: what a WebGL2/Three.js port should degrade first and in what order, given it will
be materially slower than the WebGPU reference on the same hardware (three cascades of
world-space PCSS at 12 taps, a nine-pass post chain, and a full-resolution far-range
raymarch). Only `wake-spray.md` §11.7 has a "cheap-out points, ranked by visual cost" list,
and it is scoped to the wake alone.

**Reference files that answer it.** `README.md` performance table; `src/core/settings.js:220-222`
(the preset definitions); `src/core/perf.js` (what to measure); the per-pass ratios in
`post-core.md` §1.2.

**Why it matters visually.** Without a stated budget the port has no definition of "done", and
the first thing a struggling port reaches for — dropping TAA — is the one pass `post-core.md`
§0 declares non-negotiable ("the snow material spends its entire detail budget below the
pixel… without the temporal integrator the field crawls").

**Fix.** A short budget section: target frame time and resolution for the port, the degradation
ladder in order (far-range march resolution → DOF → SSR → cascade 2 resolution → PCSS tap count
→ `resolutionScale`), and TAA marked as never-drop.

---

## P1-6 — `SnowContact._kick`: the footfall spray puff is specified nowhere

**Missing.** `grep -c "_kick" _spec/*.md` → **zero hits in all ten files**.
`deformation.md` §9.1 catalogues `snowContact.js`'s three `brush()` writers (footfall, body
drag, surf wake) completely and correctly — and stops there, because it is a document about
the deformation buffer. `wake-spray.md` §7 covers only `SurfWake._plume`. So the fourth thing
`snowContact.js` does — emitting spray at every foot plant — falls between them.

The unspecified numbers, from `src/character/snowContact.js:130-165`:

```
gate:   ch.speed < 0.4  -> no emission
count:  n = 6 + ((impact * 14) | 0)        // per plant
spread: 0.9                                 // rx, rz = (random()-0.5)*spread
up:     0.9 + random()*1.9
back:   0.5 + random()*1.6*impact
clod:   random() < 0.22 ? 1 : 0            // 22% heavier fraction
pos:    (x + rx*0.09, y + 0.03 + random()*0.05, z + rz*0.09)
vel:    (-fx*back + rx*1.3 + ch.velocity.x*0.25,
         up * (clod ? 1.25 : 1.0),
         -fz*back + rz*1.3 + ch.velocity.z*0.25)
size:   clod ? 0.014 + random()*0.012 : 0.020 + random()*0.030
life:   clod ? 0.55 + random()*0.35 : 0.55 + random()*0.60
kind:   clod
```

Note the source comment giving the design constraint: *"the size at which a puff stops reading
as powder and starts reading as a cotton ball is somewhere around five centimetres, and it is a
hard threshold"* — which is why the sizes cap at 5 cm.

**Reference file.** `src/character/snowContact.js:130-165` (`_kick`), called from the footfall
branch alongside the boot `brush()`.

**Why it matters visually.** This is the only spray population that fires while **not**
surfing. Without it every footstep is a silent dent in the snow — the print appears, the powder
does not. Kicked powder at the boot is most of what sells walking in deep snow, and its absence
is the difference between a character walking *in* the field and a decal sliding over it. It
also carries `ch.velocity * 0.25`, so the puff trails behind a running character rather than
puffing straight up.

---

## P1-7 — `spellLightingSurface` and `spellLightingParticle` are quoted as fragments, not verbatim

**Missing.** `grep "fn spellLightingSurface"` and `grep "fn spellLightingParticle"` →
**0 hits**. `spells.md` §13.4 gives `spellAttenuation` and `spellLighting` verbatim (correctly
— `spellLighting` is the headline snow response), but reduces the other two to their inner
accumulation line only. Not specified: the full signatures and parameter order, the
`let NdotV = clamp(dot(N, V), 1e-4, 1.0)` hoist outside the loop, and the
`if (i >= n) { break; }` / `if (att <= 0.0) { continue; }` loop structure.

This matters more than it looks, because **four of the six lit materials call these two, not
`spellLighting`** — per `spells.md` §13.4's own call-site table, `char.fragment` (wrap 0.35),
`water.fragment` (wrap 0.55) and `crystal.fragment` (wrap 0.5) call `spellLightingSurface`,
and `spray.fragment` calls `spellLightingParticle` (wrap 0.8 fixed). Only `snow.fragment` and
`wake.fragment` call `spellLighting`.

**Reference file.** `src/shaders/lib/spellLights.wgsl:90-169`.

**Why it matters visually.** The README's claim for this system — *"The snow, the robe, the
wake, the airborne spray, the water and the ice all read the same pool out of one include"* —
is that a spell lights *everything* coherently. Get the robe's or the spray's variant wrong
and a Bloom's fallout curtain reads as grey powder over a glow instead of lit from within,
which `spells.md` §13.4 itself names as the visual tell.

**Fix.** Transcribe both functions verbatim into `spells.md` §13.4, and add the GLSL note that
the `break`/`continue` pattern over a uniform-bounded loop is legal in GLSL ES 3.00 but should
keep the constant `SPELL_LIGHT_MAX` bound so the loop is unrollable.

---

## P1-8 — `nishitaSky` and `ridgeMarch` are the only major functions with no verbatim body

**Missing.** `grep "fn nishitaSky"` and `grep "fn ridgeMarch"` → **0 hits**, against a spec set
where essentially every other comparable function *is* transcribed verbatim (`wakePoint`,
`waterPoint`, `pcssShadow`, `sampleCascadeTex`, `sampleCloth`, `terrainMacro`, `ridgeField`,
`fbmd`, `deformHeight`, …). `sky.md` covers both in detailed annotated prose — §4.1–4.11 for
the integral, §8.4 for the march — with every constant tabulated in Appendix A.3 and A.9, so
they are probably reconstructible. But they are reconstructible *by reasoning*, not by
transcription, and they are the two most expensive loops in the frame: the far range alone is
~1.2 ms of the README's 3.22 ms.

**Reference files.** `src/shaders/lib/atmosphere.wgsl:57-265` (`nishitaSky`),
`src/shaders/lib/ridge.wgsl:157-253` (`ridgeMarch`), `:254-268` (`ridgeShadow`).

**Why it matters visually.** The sky LUT is the input to everything else — SH ambient, the
solved snow bounce, mip-based specular, the water's refraction lookup, the far range's haze.
An error in the view-march step schedule or in the shadowed-sample accumulation propagates into
every surface in the frame at once, and will read as "the whole thing is slightly wrong" rather
than as a sky bug. The far-range march's step schedule is what makes ridges occlude ridges;
get the schedule wrong and the range either shimmers or goes soft.

**Fix.** Transcribe both verbatim into `sky.md` §4 and §8.4, keeping the existing annotations.

---

## P2 — Thin, but low visual risk (record, do not necessarily fix)

- **`src/ui/overlay.js` (503 lines) gets ~35 lines** in `post-core.md` §14.2. The panel's
  layout, refresh rates, warning thresholds, colours and number formatting *are* specified; the
  widget builders (`_mkGroup`, `_mkNum`, `_txt`, `_syncWidgets`, `_syncPresets`, `_copyPose`,
  `_poseScript`, `_updateCamera`) are not. The README sells the overlay as a feature ("every
  art parameter as a live slider"), and it is the instrument you tune the port with — but it is
  reconstructible from `post-core.md` §13.2's SCHEMA group order and §14.2's styling.
  `core/perf.js` and `core/loading.js`, by contrast, are fully specified.

- **`src/core/gpuUtil.js`** has no owning section, but is adequately covered in effect:
  `whenReady` is described in `post-core.md` §15.3 (including the 25 000 ms timeout and its
  error message), the Three.js substitution is given in `sky.md` PORT-13
  (`renderer.compileAsync`), and `bindMatrixArray`'s purpose is explained in `shadows.md`.
  No action needed.

- **Colour-space convention is stated exactly once**, in `post-core.md` §16.2: `RGBA8` **not**
  `SRGB8_ALPHA8` for the composite, `colorSpace = NoColorSpace` on both the target and
  `renderer.outputColorSpace`, because the composite already emits sRGB via `linearToSrgb`.
  It is correct and sufficient — but it lives in the post document while the rule ("there are
  no sRGB textures anywhere in this project; every texture is linear data; encode happens once,
  in the composite") is global. Worth promoting into the cross-cutting page suggested in P0-2/P0-4.

---

## What was checked and found sound

For the record, so this list is not re-derived:

- **File coverage.** All 96 files under `src/` are named by at least one spec. No orphans.
- **Shared shading library.** Every function in `lib/shading.wgsl` has a verbatim body in at
  least one spec (`distributionGGX`, `visSmithGGXCorrelated`, `fresnelSchlick`,
  `fresnelSchlickRough`, `wrapDiffuse`, `backScatter`, `snowSubsurface`, `glintOctave`,
  `snowGlints`, `POISSON`, `pcssShadow`, `shIrradiance`, `blendNormalRNM`,
  `normalFromGradient`, `luma`). Same for `lib/noise.wgsl` (all 17 functions, in `terrain.md` §6),
  `lib/deform.wgsl`, `lib/clipmap.wgsl`, `lib/shadowLookup.wgsl`, `lib/charSkin.wgsl`,
  `lib/wake.wgsl`, `lib/water.wgsl`, `lib/crystal.wgsl`, `lib/postCommon.wgsl`, and the
  runtime aerial-perspective half of `lib/atmosphere.wgsl`.
- **The depth-prepass contract** — the cross-cutting one that four post passes consume — is
  fully specified in `shadows.md` §8.2 including the `.g` specular-mask writers, the
  `DEPTH_FAR = 9000` / `POST_FAR` mirror, the `isBackground` threshold, and the exclusion list
  with reasons.
- **The shared shadow uniform block** is specified once for all six receivers in `shadows.md`
  §9.1, with per-material parameters in §6.5 / §13.5.
- **The per-frame update order** is normative and annotated with all eleven ordering
  constraints in `post-core.md` §15.4.
- **Render-pass order for the post chain**, and every intermediate's format, filter and wrap,
  are explicit in `post-core.md` §1.2 / §1.3.
- **WebGPU-only capabilities** are handled honestly throughout: no compute shaders are needed
  (every reference "dispatch" is already a full-screen fragment pass, stated in five specs);
  storage textures map to ping-ponged FBOs; there is no MRT anywhere (the prepass writes one
  RGBA16F); timestamp queries are correctly declared unavailable with the em-dash fallback
  (`post-core.md` §16.1, `sky.md` PORT-12); 32-bit float storage gets an explicit three-option
  fallback ladder in `terrain.md` §13.3 and a `readPixels` strip plan in §13.6.
- **Vagueness sweep** found no instance of an effect described without its numbers. Hedged
  language ("roughly", "about") occurs only in explanatory prose adjacent to exact constants.
- **Debug views** — the port's validation instruments — are specified twice over
  (`snow-shading.md` §10.1 for all eleven modes, `shadows.md` §10 for the shadow-agreement
  colour key), and cover all five the README advertises.
