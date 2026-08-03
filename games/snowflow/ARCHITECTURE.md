# SNOWFLOW — Three.js / WebGL2 port · architecture contract

This is the binding contract for every agent building this port. Read it in full before
writing a line. Where it conflicts with a `_spec/*.md` document, **this file wins on
structure and interfaces; the spec wins on numbers, formulas and visual behaviour.**

Goal: reproduce the visual output of the SNOWFLOW WebGPU/Babylon reference
(https://snowflow-lilac.vercel.app/) in Three.js r172 on WebGL2, closely enough that a
harsh critic comparing matched screenshots blind cannot reliably say which is which.

---

## 0. Non-negotiables

1. **Three.js r172, WebGL2, hand-written GLSL ES 3.00.** Use
   `THREE.RawShaderMaterial` with `glslVersion: THREE.GLSL3` for every custom material.
   No `MeshStandardMaterial`, no node materials, no TSL, no WebGPURenderer.
2. **No third-party assets.** Every texture, environment map and mesh is generated at
   load time, exactly as in the reference. No image files, no GLB, no HDRI, no fonts
   beyond system stacks. If you find yourself wanting an asset, generate it.
3. **Nothing allocates in the render loop.** Every buffer, render target, typed array
   and material is created at construction. Per-frame writes go into pre-allocated
   typed arrays. No `new` inside `update()`.
4. **Match the reference's numbers.** Frequencies, amplitudes, radii, time constants,
   colour constants and thresholds come from `_spec/*.md`, which transcribed them from
   the reference source. Do not re-tune by eye; if a number looks wrong, say so in your
   report rather than silently changing it.
5. **Import Three as a bare specifier**: `import * as THREE from "three";`. r172 is
   already vendored at `games/snowflow/assets/vendor/three/build/three.module.js` (with
   its sibling `three.core.js`), and `index.html` carries the import map that resolves
   it. No CDN, no bundler — native ES modules loaded straight from disk, which is how
   every other game in this repo ships.

   ```html
   <script type="importmap">
   { "imports": { "three": "./assets/vendor/three/build/three.module.js" } }
   </script>
   ```

---

## 1. Layout and ownership

Each builder owns a **disjoint** set of files. Never edit a file you do not own — if you
need a change in someone else's file, note it in your report and code against the
documented interface.

```
games/snowflow/
  index.html                 [FOUNDATION]
  ARCHITECTURE.md            (this file)
  _spec/*.md                 (read-only input)
  _harness/                  (read-only; the comparison harness)
  src/
    main.js                  [INTEGRATOR]
    core/
      settings.js            [FOUNDATION]   S, SCHEMA, PRESETS, onChange, set
      input.js               [FOUNDATION]   input, initInput, pollInput, endFrame
      loading.js             [FOUNDATION]   phase, fail, done, nextFrame
      perf.js                [FOUNDATION]   sample, stats, mark, draw counter
      glsl.js                [FOUNDATION]   #include resolver + chunk registry
      gfx.js                 [FOUNDATION]   RT helpers, fullscreen pass, caps
      camera.js              [POST-CORE]    CameraRig (spring arm)
    terrain/
      heightfield.js         [TERRAIN]
      clipmapMesh.js         [TERRAIN]
      terrain.js             [TERRAIN]
      deformation.js         [DEFORM]
    render/
      sky.js                 [SKY]
      shadows.js             [SHADOWS]
      depthPass.js           [SHADOWS]
    character/
      build.js               [CHARACTER]
      figure.js              [CHARACTER]
      character.js           [CHARACTER]
      controller.js          [CHARACTER]
      cloth.js               [CLOTH]
      snowContact.js         [DEFORM]
    vfx/
      particles.js           [WAKE]
      surfWake.js            [WAKE]
    spells/
      spellSystem.js  waterBody.js  sweep.js  ribbon.js  bloom.js
      crystallize.js  crystals.js   vortex.js spellLights.js        [SPELLS]
    post/
      postChain.js           [POST-CORE]
    ui/
      overlay.js             [POST-CORE]
    shaders/
      lib/*.glsl.js          shared includes — see §3 for who owns which
      <name>.glsl.js         one module per shader stage, owned by its subsystem
```

Shader modules export plain strings:

```js
// src/shaders/lib/noise.glsl.js
export default /* glsl */`
float hash11(float p) { ... }
`;
```

**Never put an unescaped backtick inside that literal.** It ends the template string
mid-shader, so the module becomes a JS syntax error — and the reported error is a stray
identifier tens of lines further down, blaming whoever imported the file rather than the
file itself. Because `registry.js` imports the shared chunks, one such module takes down
`registerShaders()` and with it every `#include` in the port. This has bitten six files
across three owners, every time because the author reached for the backtick-quoting habit
that is correct in the JSDoc *above* the literal and fatal *inside* it. Inside the shader,
quote identifiers with 'single quotes' or (parentheses). If you genuinely need a backtick,
escape it: `` \` ``.

Guard, ~200 ms, no server or GPU — run it before you commit:

```bash
node games/snowflow/_tools/shadercheck.mjs
```

It imports every `src/shaders/**/*.glsl.js`, names the offending file, and prints the
suspect backtick line. `_harness/modulecheck.py` also catches these, but only
transitively and only once an importer exists.

---

## 2. The `SNOWFLOW` global — required, do not change

`main.js` must publish exactly this at the end of boot. **The comparison harness drives
the port and the reference through this identical surface; if it drifts, every
screenshot comparison silently breaks.**

```js
globalThis.SNOWFLOW = {
  renderer, scene, rig, character, figure, contact, spray, wake, spells,
  overlay, terrain, sky, shadows, post, depthPass,
  S, input, perfStats: stats,
};
```

Required behaviour of the members the harness touches:

| Member | Contract |
|---|---|
| `S` | the live settings object; mutating a field takes effect on the next frame |
| `rig.yaw` / `rig.pitch` | radians; writable — the next `update()` must start from the written value, not overwrite it (look deltas are *added*) |
| `rig.distance` / `rig.distanceTarget` | metres; writable |
| `character.position` | `THREE.Vector3`, feet position, writable |
| `character.velocity` | `THREE.Vector3`, writable |
| `character.surfActive` | bool, set from `input.surf` each frame |
| `character.yaw` | radians, the figure's facing; readable and writable |
| `terrain.heightAt(x, z)` | metres, CPU-side, samples the *same* surface that is drawn |
| `spells.cast(n)` | n = 1..5, fires that spell immediately |
| `spells.holdRibbon(b)` | begins / ends the held cast |
| `input` | live input state. `surf` and `spellHeld2` must be **plain, configurable data properties** — the harness pins them with `Object.defineProperty` to hold a button down, because pointer lock needs a user gesture it cannot forge. Do not make them accessors, and do not read them through a cached local. |

`index.html` must keep the reference's DOM ids: `#view` (canvas), `#boot` (gets class
`gone` when loading finishes), `#boot-bar`, `#boot-phase`, `#nogpu` (gets class `show`),
`#hint`. The harness hides `#boot`, `#hint` and `#overlay` before every screenshot.

---

## 3. Shader include system

`core/glsl.js` exports:

```js
register(name, source)   // add a chunk
resolve(source)          // expand every  #include "name"  recursively, once, cached
```

Includes are textual, resolved once at material construction. Cycles throw. Every shared
chunk is registered by `shaders/registry.js`.

**`registry.js` is the one shared-write exception to §1.** It is FOUNDATION's file, but each
chunk owner adds their own registration to it. It ships with a commented-out import line and
a matching `CHUNKS` entry for every chunk in the table below, tagged with its owner, so
registering yours means deleting two slashes. Rules, because builders edit it concurrently:

- Uncomment **only your own two lines**. Never rewrite the import block or the `CHUNKS`
  object wholesale — another builder is editing the file between your read and your write,
  and a block replacement silently deletes their registration.
- If an edit fails because the text moved, re-read and redo just that one line.
- Registering a name twice throws at boot, so a collision fails loudly rather than
  resolving to whichever import happened to run last.

**Shared includes and their owners** — everyone reads these, only the owner writes:

| Chunk | Owner | Contents |
|---|---|---|
| `lib/noise` | TERRAIN | hashes, value/gradient noise **with analytic derivatives**, fbm |
| `lib/terrain` | TERRAIN | the heightfield function + its derivatives, wind anisotropy |
| `lib/clipmap` | TERRAIN | ring placement + CDLOD morph, vertex-side |
| `lib/deform` | DEFORM | `sampleDeform(worldXZ)`, toroidal addressing, `applyDeform()` displacement — **included by the beauty pass and all three shadow cascades** |
| `lib/shadowLookup` | SHADOWS | cascade select + PCSS filter, single entry point `shadowAt(worldPos, N)` |
| `lib/atmosphere` | SKY | sky LUT sampling, aerial perspective, fog, SH irradiance eval |
| `lib/shading` | SNOW-SHADING | `snowSubsurface()`, wrapped diffuse, GGX, glints, the snow BRDF |
| `lib/spellLights` | SPELLS | the 4-slot pooled light block + evaluation; **every lit surface includes this** |
| `lib/water` | SPELLS | swept-surface evaluation, refraction, absorption |
| `lib/crystal` | SPELLS | hex prism support |
| `lib/wake` | WAKE | `wakePoint()` — the swept breaking-wave surface |
| `lib/charSkin` | CHARACTER | bone-matrix fetch + skinning from the data texture |
| `lib/postCommon` | POST-CORE | tonemap curves, exposure, sampling helpers |

### 3.1 Canonical chunk signatures

These are the **minimum required public surface** of each shared chunk. You may add to a
chunk you own; you may **not** rename or re-sign anything below, because parallel builders
are writing consumers against it before your code exists. Repeat each signature in a
comment header at the top of your chunk, and keep that header true.

```glsl
// lib/deform  [DEFORM]
vec4  deformSample(vec2 worldXZ);   // .x depression m · .y displaced mass m
                                    // .z compression 0..1 · .w ice 0..1
float deformHeight(vec2 worldXZ);   // net vertical offset, metres (berm minus trench)
vec2  deformGradient(vec2 worldXZ); // d(deformHeight)/d(worldXZ), for normals

// lib/shadowLookup  [SHADOWS]
float shadowAt(vec3 worldPos, vec3 N);   // 1 = lit, 0 = occluded; PCSS, cascade-blended
int   cascadeIndexAt(vec3 worldPos);     // for the `cascades` debug view

// lib/atmosphere  [SKY]
vec3  skySample(vec3 dir);                  // radiance along dir, from the baked LUT
vec3  skyIrradiance(vec3 N);                // SH irradiance, includes the snow bounce
vec3  skySpecular(vec3 R, float roughness); // mip-based specular probe
vec3  aerial(vec3 color, vec3 worldPos);    // fog + aerial perspective, applied last

// lib/shading  [TERRAIN-SNOW]
vec3  snowSubsurface(vec3 L, vec3 V, vec3 N, vec3 lightColor, float thickness);
float snowGGX(vec3 L, vec3 V, vec3 N, float roughness);
vec3  snowGlints(vec3 worldPos, vec3 V, vec3 N, float gate);

// lib/spellLights  [SPELLS]
vec3  spellLighting(vec3 worldPos, vec3 N, vec3 V, float thickness);  // sums the 4-slot pool

// lib/postCommon  [POST-CORE]
vec3  applyExposure(vec3 c);
vec3  tonemapAgX(vec3 c);
vec3  tonemapACES(vec3 c);

// lib/wake  [WAKE]
vec3  wakePoint(float u, float v, float side, out vec3 dPdu, out vec3 dPdv);

// lib/charSkin  [CHARACTER-CLOTH]
mat4  boneMatrix(int i);
vec3  skinPosition(vec3 p, ivec4 idx, vec4 wt);
```

**Every lit surface** — snow, the figure's body, cloth, fur, wake, spray, water, ice —
calls `spellLighting()` and runs the *same* `snowSubsurface()` the sun runs. That is what
makes a spell light the snow *through* a berm crest instead of putting a bright patch on
the near face of it. Do not write a private lighting path.

**Uniform naming is shared and fixed.** All of these are set by the integrator via a
single `updateGlobals()` and must be declared identically wherever they are used:

```glsl
uniform vec3  uSunDir;        // toward the sun, normalised, world space
uniform vec3  uSunColor;      // linear, pre-multiplied by intensity
uniform vec3  uCameraPos;
uniform float uTime;          // seconds
uniform mat4  uViewProj;
uniform vec2  uResolution;
```

---

## 4. Render pass order

Fixed. The integrator owns this sequence; nobody else changes it.

**Load-time bakes** (behind the boot screen, in this order):
1. Sky: Nishita integral → equirect LUT + SH coefficients + specular mip chain.
2. Heightfield: 4096² RG32F (height + material), mirrored to a CPU `Float32Array`
   for `heightAt()`.
3. Detail LUTs: snow grain / sastrugi tiles.
4. Pipeline warm-up: every material compiled and drawn at least once with real
   geometry, before the boot screen lifts.

**Per frame:**
1. `deformation.step()` — one full-screen pass, ping-pong, scroll + relax + splat.
2. Shadow cascades ×3 — depth only, each caster rendered with **its own** vertex
   program (§5).
3. Depth prepass — linear view depth + specular/ice mask into RGBA16F.
4. Beauty into an RGBA16F HDR target:
   a. sky + raymarched far range (renders first, depth-write off, at far plane)
   b. opaque: terrain, character body, cloth, fur
   c. transparent, depth-tested against (b), depth-write per material: crystals
      (blend **and** depth-write), water, wake, spray
5. Post chain — exact order per `_spec/post-core.md`, terminating in tonemap +
   sharpen + grain + vignette to the default framebuffer.

Render targets are allocated once and resized on `resize`. HDR targets are
`THREE.HalfFloatType`; the heightfield is `THREE.FloatType` with `LinearFilter`.

### 4.1 Measured capabilities — the dev/verification GPU

Probed on the machine the comparison harness runs on, so these are facts, not guesses:
ANGLE / Intel Iris Xe (0x9A60) / D3D11, GLSL ES 3.00.

| Extension | |
|---|---|
| `EXT_color_buffer_float` · `OES_texture_float_linear` · `EXT_float_blend` | present |
| `EXT_texture_filter_anisotropic` · `EXT_disjoint_timer_query_webgl2` | present |
| derivatives (`dFdx`/`fwidth`) | core in WebGL2 |

Every render target the design needs was created and validated complete:
RGBA16F 2048² (×1 and ×2 MRT), **RG32F 4096²**, R32F 2048², RGBA16F 1280×720 ×2, RGBA32F 4096².
So the reference's formats port across unchanged — do not downgrade them.

| Limit | Value | Consequence |
|---|---|---|
| `MAX_VARYING_VECTORS` | **30** | **the binding constraint.** Budget varyings deliberately; pack aggressively (a `vec4` carrying four scalars beats four `float`s, which each burn a whole slot). If you need more, recompute in the fragment shader from world position instead of interpolating. |
| `MAX_TEXTURE_IMAGE_UNITS` | 16 | the snow fragment shader alone wants height + aux + detail + deform + skyLUT + 3 cascades = 8. Fits, but it is not free — do not add a sampler casually. |
| `MAX_VERTEX_TEXTURE_IMAGE_UNITS` | 16 | vertex-side height/deform/bone fetches are fine |
| `MAX_FRAGMENT_UNIFORM_VECTORS` | 1024 | comfortable |
| `MAX_DRAW_BUFFERS` / `MAX_COLOR_ATTACHMENTS` | 8 | MRT prepass is fine |
| `MAX_TEXTURE_SIZE` | 16384 | the 4096² heightfield is comfortable |

This GPU is far weaker than the RTX 5070 Ti the reference was profiled on. **Frame rate is
not an acceptance criterion here — fidelity is.** Do not cut quality for speed. Do keep the
`preset` machinery working so quality can be scaled deliberately rather than by accident.

### 4.2 Foundation gotchas the builders must know

Measured by FOUNDATION on this machine, not assumed:

- **`installDrawCounter()` sets `renderer.info.autoReset = false`.** The integrator must call
  `endFrameDraws()` exactly once per frame, or the counters grow without bound.
- **`FullScreenPass.render()` forces `renderer.autoClear = false`** for its own draw and
  restores it after. The triangle covers every pixel with depth test and blending off, so the
  clear is pure bandwidth — and on an accumulation target it is actively wrong.
- **`shader()` emits the `precision` lines before your source**, so a stage using it cannot
  carry its own `#extension` directive. Nothing this port needs requires one in ES 3.00.
- **`readbackFloat()` always returns RGBA — 4 floats per texel**, because WebGL2's readback
  format is fixed. Reading a 4096² target therefore costs 268 MB. Read once and stride down
  to the mirror you actually want immediately; do not hold the full buffer.
- `EXT_disjoint_timer_query_webgl2` **is** present here, so `stats.gpuMs` is a real GPU
  number rather than presentation cadence.
- `S.fogStart` and `S.deformResolution` exist in `S` with no `SCHEMA` widget. That is exactly
  how the reference is — it is not a porting omission, do not "fix" it.

---

## 5. The custom-caster pattern (critical)

The terrain has **no CPU geometry matching what is drawn** — placement, CDLOD morph and
displacement all happen in the vertex shader. So Three's automatic shadow and depth
passes cannot be used for it, and the same is true for the cloth, the wake and the
crystals, which are all placed in their vertex shaders too.

Every such object must register, for each of the three passes it appears in, the
**same vertex program** it is beauty-rendered with:

```js
mesh.customDepthMaterial = new THREE.RawShaderMaterial({ /* same VS, depth-only FS */ });
depthPass.registerCaster(mesh, prepassMaterial);   // linear-depth variant
shadows.registerCaster(mesh, cascadeMaterial);     // cascade variant
```

Do not try to make one über-material serve all three. Do share the vertex source through
a `lib/` include so they cannot drift — that is exactly what `lib/deform`,
`lib/clipmap` and `lib/wake` are for.

---

## 6. Conventions

- **Units are metres and seconds.** Angles in the settings object are degrees; convert
  once at the edge.
- **Colour**: everything is linear until the tonemap. `renderer.outputColorSpace =
  THREE.LinearSRGBColorSpace` and the tonemap pass does the sRGB encode itself, so the
  AgX/ACES curve is applied in the right space. Do not set `toneMapping` on the renderer.
- **Handedness**: Three is right-handed, Y-up, and the reference (Babylon) is
  left-handed. The spec documents transcribe reference formulas as written — when
  porting anything that consumes a direction or a cross product, check the handedness
  and say in a comment which convention the line is in. Getting this wrong flips
  normals, lighting and the wind bearing; it is the single most likely source of a
  "close but wrong" result.
- **Comments explain why, not what.** Match the reference's commenting register: dense
  where a number is non-obvious, silent where the code is plain.
- **No `console.log` left in.** Errors go through `loading.fail()`.
- **Determinism**: no `Math.random()` anywhere the shot battery can observe. Seeded
  hashes only. Grain is time-hashed, which is fine.

---

## 7. Definition of done, per subsystem

You are done when **all** of these hold:

1. The page loads with no console errors and no WebGL warnings
   (`_shots/port/console.log` is clean).
2. Your subsystem's **visual acceptance criteria** from your `_spec/*.md` are each
   observably met in a screenshot from `_harness/shoot.py`.
3. A blind side-by-side against the matched reference shot does not immediately give
   away which is the port.
4. Nothing allocates per frame in your code path.
5. `SNOWFLOW` still exposes everything in §2 and the harness still runs green.

"It compiles" and "no errors" are **not** done. Done is the observed pixels.

---

## 8. How to see your work

The dev server runs on **port 8799**, not 8788 — 8788 is occupied by an unrelated project on
this machine and serves a different site, so a request there returns someone else's page or a
404. All three harness scripts already default to 8799; pass no `--url` and you get it right.

```bash
# serve, if it is not already up (repo root, no-cache)
python forgeflow-games/serve_nocache.py 8799
```

Three checks, cheapest first. Use them in this order — each one rules out a class of failure
that would otherwise waste a full run of the next.

```bash
cd games/snowflow/_harness

# 1. seconds, no GPU context. Catches a broken import, a duplicate chunk
#    registration, and an #include naming a chunk nobody wrote.
python modulecheck.py

# 2. one page load. Catches shader compile/link failures, uncaught errors, and
#    "boots but draws nothing". Saves _shots/bootcheck.png — LOOK AT IT.
python bootcheck.py

# 3. minutes. The full 14-shot battery, reloading per shot.
python shoot.py --out ../_shots/port                # all shots
python shoot.py --out ../_shots/port --shots 01-hero  # one, while iterating
```

Then look at the PNGs in `_shots/port/` beside `_shots/ref/`. If yours is worse, it is not
done. `RESULT: OK` from bootcheck means no errors — it does **not** mean the frame is right.
