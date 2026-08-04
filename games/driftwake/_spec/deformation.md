# SNOWFLOW — Persistent Toroidal Terrain Deformation State Buffer

**Implementation spec for a Three.js r172 / WebGL2 / GLSL ES 3.00 port.**

Extracted from the WebGPU + Babylon.js + WGSL reference. This document is the complete
description of the subsystem: it must be possible to re-implement the buffer, the
simulation pass, the write API and all five read consumers **without access to the
reference source**.

Reference files transcribed in full for this spec:

| File | Role |
|---|---|
| `src/terrain/deformation.js` | CPU owner: ping-pong targets, brush staging, uniform push, warm-up |
| `src/shaders/deformSim.fragment.wgsl` | The single combined scroll + relax + splat + clamp pass |
| `src/shaders/lib/deform.wgsl` | The shared read-side include (`#include<snowDeform>`) |
| `src/character/snowContact.js` | Feet, body drag and surf-wake write path |

Supporting files read to resolve constants, control flow and consumers:
`src/core/settings.js`, `src/terrain/terrain.js`, `src/terrain/clipmapMesh.js`,
`src/terrain/heightfield.js`, `src/shaders/snow.vertex.wgsl`,
`src/shaders/terrainDepth.vertex.wgsl`, `src/shaders/terrainPrepass.vertex.wgsl`,
`src/shaders/snow.fragment.wgsl`, `src/shaders/lib/clipmap.wgsl`,
`src/shaders/lib/noise.wgsl`, `src/shaders/registry.js`, `src/core/gpuUtil.js`,
`src/render/shadows.js`, `src/main.js`, and the brush call sites in
`src/spells/{sweep,ribbon,bloom,crystallize,vortex}.js`.

---

## 0. One-paragraph statement of the subsystem

Two 2048×2048 RGBA16F render targets hold a **persistent, additive, world-anchored record
of every mark made in the snow**. One full-screen fragment pass per frame ping-pongs
between them and does four jobs in one dispatch: it re-interprets which world position each
texel stands for as the window follows the player (toroidally, so nothing is ever copied),
detects and zeroes texels that have just wrapped in from the trailing edge, relaxes the
state (anisotropic diffusion, wind-driven upwind infill, berm-into-depression slump, and
four independent exponential decays), and splats every brush queued this frame by feet, the
surf wake and all five spells. The four channels are depression depth (R, metres, positive =
down), displaced mass (G, metres, positive = up), compression (B, 0..1) and ice (A, 0..1).
The G channel is what makes a trail a trench with berms instead of a flat footprint decal.
Downstream, one shared GLSL include reads the buffer as **real vertex displacement** in the
beauty pass, in all three shadow cascades and in the depth prepass — from the identical
band-limited function — so trails self-shadow and berm crests break the silhouette.

---

## 1. Coordinate and window geometry

### 1.1 The window

| Symbol | Value | Units | Bound in |
|---|---|---|---|
| `COVERAGE` / `size` | **80** | metres | `deformation.js` export |
| `res` | `max(512, S.deformResolution)` = **2048** | texels | `deformation.js` ctor |
| `texel` | `size / res` = **0.0390625** | metres (3.90625 cm) | `deformation.js` ctor |
| half-window | `size * 0.5` = **40** | metres | used in scroll test and CPU cull |
| `S.deformResolution` | **2048** (ultra/high), **1024** (balanced preset) | texels | `settings.js` |

The window is a square of 80 m centred on the **player** (`character.position`), *never* on
the camera. `terrain.js` passes `focus = character.position`; the camera may orbit freely and
the marks stay put.

### 1.2 Texel snapping (per frame, CPU)

```js
this._prevCenter.copyFrom(this.center);
const t = this.texel;
this.center.x = Math.round(focus.x / t) * t;
this.center.y = Math.round(focus.z / t) * t;   // NOTE: .y of the Vector2 carries world Z
```

Without this snap the toroidal mapping shifts by a fraction of a texel every frame and the
whole field crawls. `center` is a `Vector2` whose `.x` is world X and whose `.y` is world Z.

### 1.3 Toroidal addressing — the two directions

**Read (world → uv), in `lib/deform.wgsl`:**

```wgsl
fn deformUV(worldXZ: vec2f, size: f32) -> vec2f {
    return fract(worldXZ / size);
}
```

That is the entire addressing scheme. No offset by `center`, no scroll, no copy. The sampler
**must** be in wrap/repeat mode on both axes or this is wrong everywhere.

**Write (uv → world), in `deformSim.fragment.wgsl`:**

```wgsl
/// Recover the world position a texel stands for.
///
/// `uv * size` only pins the position modulo the window, so the correct branch is
/// the one nearest the window centre — which, by construction, is the only one
/// inside the window at all.
fn texelWorld(uv: vec2f, centre: vec2f, size: f32) -> vec2f {
    let base = uv * size;
    return base + size * round((centre - base) / size);
}
```

These two are exact inverses on the window: `deformUV(texelWorld(uv, c, s), s) == uv` for any
`uv ∈ [0,1)²`.

**Consequence:** the toroidal seam (where `worldXZ / size` crosses an integer) sits wherever
the world happens to put it, at most 40 m from the player. A one-texel bilinear artefact
there is below the resolvable threshold, *and* the read-side falloff (§5.2) has already faded
the buffer's authority to zero by 38.4 m, so wrapped-around content is never visible at any
weight.

**Precision note:** the player is clamped to `PLAY_RADIUS = 620` m (`heightfield.js`), so
`worldXZ / size` is at most ±7.75. `fract` of that in fp32 retains ~21 bits of fraction —
about 0.02 texel. Safe. A port that removes the play-area clamp must revisit this.

---

## 2. Resources

### 2.1 The two state targets

| Property | Value | Reason |
|---|---|---|
| Count | **2** (ping-pong) | one read, one write, swapped each frame |
| Dimensions | `res × res` = 2048 × 2048 | |
| Format | `RGBA` | four channels, see §3 |
| Type | **HALF FLOAT** (`TEXTURETYPE_HALF_FLOAT`, IEEE binary16) | channels are metres in roughly ±1, where half float resolves well under 0.1 mm. Full float would double the bandwidth of a pass that runs every frame and buy nothing. |
| Mipmaps | **none** (`generateMipMaps: false`) | |
| Sampling | **BILINEAR** (`TEXTURE_BILINEAR_SAMPLINGMODE`) | required: the read side samples at arbitrary world positions and the upwind tap is at a fractional offset |
| Wrap U / Wrap V | **WRAP / REPEAT** (`TEXTURE_WRAP_ADDRESSMODE`) | *"Toroidal addressing depends on this."* |
| `refreshRate` | **0** | Babylon must not auto-render it; the owner calls `render()` explicitly |
| `autoClear` | **false** | *"The pass writes every texel unconditionally, so clearing first is pure bandwidth."* |
| Scene registration | skipped | |

Memory: 2048² × 8 B = **33.55 MB** per target, **67.1 MB** total. (README quotes ~350 MB total
VRAM for the whole demo including a 4096² height texture and three 2048² cascades.)

Ping-pong bookkeeping:

```js
this._targets = [this._makeTarget(0), this._makeTarget(1)];
this._write = 0;
this.texture = this._targets[0];   // the target holding this frame's state
...
// in update():
const pt   = this._targets[this._write];
const prev = this._targets[1 - this._write];
pt.setTexture("prevTex", prev);
...
pt.render();
this.texture = pt;
this._write = 1 - this._write;
this._brushCount = 0;
```

So frame *N* writes `targets[N mod 2]` and reads `targets[(N+1) mod 2]`, and the texture that
every consumer binds for the rest of frame *N* is the one just written.

### 2.2 The brush data texture

| Property | Value |
|---|---|
| Width | `MAX_BRUSHES` = **96** |
| Height | `BRUSH_ROWS` = **3** |
| Format / type | `RGBA` / **FLOAT** (32-bit — mandatory, see below) |
| Sampling | **NEAREST** |
| Wrap | **CLAMP** on both axes |
| Mipmaps | none |
| Invert Y | **false** |
| Backing array | `Float32Array(96 * 3 * 4)` = **1152 floats** = **4608 bytes** |

Full float is not optional: row 0 carries **absolute world X and Z in metres**, up to ±620.
In half float the ULP at 620 is 0.5 m — every brush would land half a metre from where it was
asked for. (The shader's own comment says "one 3 KB upload per frame"; the array is actually
4608 B / 4.5 KiB. Reported as measured.)

Row layout (this is the data-texture row convention the whole subsystem depends on):

```
row 0 (v = 0):  ( worldX,      worldZ,       radius,          elongation )
row 1 (v = 1):  ( cos(yaw),    sin(yaw),     depression,      berm       )
row 2 (v = 2):  ( compression, ice,          edgeRoughness,   seed       )
```

The CPU writes with an explicit stride, so the memory order is *row-major by row*, all 96
column-0 entries of row 0 first:

```js
const stride = MAX_BRUSHES * 4;   // 384 floats per row
const a = i * 4;
d[a]                = x;
d[a + 1]            = z;
d[a + 2]            = radius;
d[a + 3]            = elongation || 1;
d[stride + a]       = Math.cos(yw);
d[stride + a + 1]   = Math.sin(yw);
d[stride + a + 2]   = depth;
d[stride + a + 3]   = berm;
d[stride*2 + a]     = compression;
d[stride*2 + a + 1] = ice;
d[stride*2 + a + 2] = edge === undefined ? 1 : edge;
d[stride*2 + a + 3] = (x * 0.37 + z * 0.71) % 100;   // seed
```

The reference chose a texture over a uniform array deliberately: *"it sidesteps uniform-array
packing entirely, costs one upload per frame, and scales past the point where a uniform block
would stop fitting."*

### 2.3 The seed

```js
d[stride * 2 + a + 3] = (x * 0.37 + z * 0.71) % 100;
```

A position hash, **not** a random number: the same spot always gets the same rim wobble, so a
splat re-applied on consecutive frames does not shimmer, while a line of footprints does not
repeat one silhouette. Coefficients 0.37 and 0.71 are incommensurate; modulus 100 keeps the
value in the range the noise function is well-behaved over.

---

## 3. The four channels

| Ch | Name | Units | Sign convention | Clamp | Decay τ |
|---|---|---|---|---|---|
| **R** | depression depth | metres | **positive = pushed down** | `[0, maxDepth]` | 400 s |
| **G** | displaced mass ("berm") | metres | **positive = piled up** | `[0, maxBerm]` | 250 s |
| **B** | compression | 0..1 | denser, darker, tighter specular, scatters less | `[0, 1]` | 300 s |
| **A** | ice | 0..1 | refrozen, smooth, reflective | `[0, 1]` | 900 s |

Net vertical offset applied to the terrain is **`G − R`** (see `deformHeight`, §5.3).

`maxDepth` and `maxBerm` are uniforms, computed on the CPU each frame:

```js
pt.setFloat("maxDepth", 0.55 * S.deformDepth);   // metres
pt.setFloat("maxBerm",  0.34 * S.deformBerm);    // metres
```

With the shipped sliders at 1.0 that is **0.55 m** of maximum depression and **0.34 m** of
maximum berm. *"Depression bottoms out: below about half a metre you are on packed snow and
nothing more moves. Without this, standing still while surfing would dig an unbounded pit."*

### 3.1 Why the second channel is the whole thing

> *"Channels are depression depth, displaced mass, compression and ice. That second channel is
> what separates a trail with raised berms from a flat footprint decal."* — README

A single-channel deformation buffer can only push the surface **down**. Everything it produces
is a hole; holes in a high-albedo, low-contrast material like snow at a 13° sun read as *dark
paint*, because the only signal is the shading of the interior slope and the eye has no raised
edge to key the depth off. Splitting the state into R (removed) and G (deposited) buys four
things simultaneously, and all four are needed:

1. **Silhouette.** `G − R` raises geometry above the undisturbed surface, so a berm crest
   breaks the horizon line and occludes what is behind it. A depression-only buffer can never
   produce an occluding edge.
2. **Self-shadowing.** The berm ring is what casts the small hard shadow *into* the print. The
   same displacement runs in all three shadow cascades (§6), so this is a real cast shadow, not
   an ambient-occlusion darkening.
3. **A separate material.** The fragment shader treats G as *freshly broken snow* — brighter,
   bluer, rougher, thicker — while B (compression) treats the trench floor as *packed snow* —
   darker, smoother, thinner. The two channels give the trail its light rim / dark core
   contrast (§7). One channel can only give one material.
4. **Mass conservation.** Because the displaced mass is stored, it can be given back: the slump
   term (§4.4) moves min(G, R) out of both, so a berm sitting against its own trench fills that
   trench rather than evaporating.

The berm is not painted as a ring in the material — it is a **Gaussian ring of G** deposited at
1.04 brush radii (§4.6), which then evolves independently: it diffuses three times faster than
the trench floor, it slumps back into the hole, and it decays with its own 250 s constant.

---

## 4. The simulation pass — `deformSim.fragment.wgsl`

One full-screen fragment pass. Executed by the CPU-side `update()` **before** `scene.render()`,
so every consumer in the same frame reads state that already includes this frame's brushes:
*"the material must sample the target that was written this frame, not the one from last frame,
or every mark lands a frame late and fast movement leaves a visible stagger."*

### 4.1 Uniform block — exact names, types, order

Declared in this order in the WGSL source:

| Name | Type | Units / meaning |
|---|---|---|
| `center` | `vec2f` | window centre this frame, texel-snapped (x = world X, y = world Z) |
| `prevCenter` | `vec2f` | window centre last frame |
| `size` | `f32` | window coverage, metres (80) |
| `res` | `f32` | texels across (2048) |
| `dt` | `f32` | **seconds of relaxation to apply this dispatch — not the frame time** |
| `brushCount` | `f32` | number of live brushes this frame (0..96) |
| `refillRate` | `f32` | `S.refillRate`, master multiplier on all relax rates (slider 0..4, default 1) |
| `maxDepth` | `f32` | metres, R clamp |
| `maxBerm` | `f32` | metres, G clamp |
| `windAngle` | `f32` | radians = `S.windDirection * π / 180`; default `S.windDirection` = **42°** |

Samplers: `prevTex` (the other ping-pong target, WRAP + BILINEAR), `brushTex` (CLAMP + NEAREST).
Varying: `vUV: vec2f`, the full-screen quad's UV — must evaluate to exactly `(i + 0.5) / res` at
each fragment centre.

### 4.2 Stage 1 — scroll and the newly-exposed test

```wgsl
let uv = input.vUV;
let size = uniforms.size;
let dt = uniforms.dt;
let world = texelWorld(uv, uniforms.center, size);

var dep = 0.0;
var berm = 0.0;
var comp = 0.0;
var ice = 0.0;

// Inside last frame's window? If not this texel just wrapped in from the
// trailing edge and holds state from the far side of the field.
let wasInside = all(abs(world - uniforms.prevCenter) <= vec2f(size * 0.5));

if (wasInside) {
    ... load, relax ...
}
```

This is the entire scroll implementation, and it is the load-bearing trick of the subsystem:

- The four accumulators are **initialised to zero**.
- If the texel's world position was inside *last* frame's window, the previous state is loaded
  and relaxed.
- If it was not — i.e. the window moved and this texel just wrapped around from the trailing
  edge — the previous contents are simply **never read**, and the accumulators stay at zero.
  The texel is thereby cleared *by omission*, in the same pass, with no branch cost beyond the
  one already there, no separate clear pass, no copy, no scroll.

`world` is the *unique* representative of this texel's toroidal class nearest to `center`. The
test compares it against `prevCenter` with a half-window Chebyshev bound. Because `center`
moves at most a few texels per frame, the newly-exposed set is a one-to-few-texel-wide L-shaped
band on the trailing edges each frame.

**Warm-up exploits exactly this** (`warmUp()`): two dispatches with

```js
_far.set(this.center.x + 1e6, this.center.y + 1e6);
pt.setVector2("prevCenter", _far);
```

make `wasInside` false for **every** texel, so the pass writes zero everywhere. Both targets are
cleared by the same code path that runs every frame, rather than by a special case that could
rot. `dt = 0`, `brushCount = 0`, `refillRate = 1`, `maxDepth = maxBerm = 1`, `windAngle = 0` for
those two passes, and both targets are cycled through `_write`.

### 4.3 Stage 2a — the five-point load and anisotropic diffusion

```wgsl
let t = 1.0 / uniforms.res;
let c  = textureSampleLevel(prevTex, prevTexSampler, uv, 0.0);
let xl = textureSampleLevel(prevTex, prevTexSampler, uv - vec2f(t, 0.0), 0.0);
let xr = textureSampleLevel(prevTex, prevTexSampler, uv + vec2f(t, 0.0), 0.0);
let zd = textureSampleLevel(prevTex, prevTexSampler, uv - vec2f(0.0, t), 0.0);
let zu = textureSampleLevel(prevTex, prevTexSampler, uv + vec2f(0.0, t), 0.0);

dep = c.r;  berm = c.g;  comp = c.b;  ice = c.a;

let k = clamp(uniforms.refillRate * dt, 0.0, 1.0);
let kDep  = min(0.22, 0.004 * k);
let kBerm = min(0.22, 0.012 * k);

let lapDep  = (xl.r + xr.r + zd.r + zu.r) - 4.0 * dep;
let lapBerm = (xl.g + xr.g + zd.g + zu.g) - 4.0 * berm;
dep  += lapDep  * kDep;
berm += lapBerm * kBerm;
```

Verbatim annotation from the source:

> *"Explicit five-point Laplacian, so the coefficient has to stay under 0.25 or it goes unstable
> and the buffer rings. These coefficients are per second and tiny on purpose. This pass runs
> every frame, so at 140 FPS a rate that looks conservative per frame has been applied 8,400
> times a minute later. Diffusion spreads as sqrt(2·D·t): at D = 0.05/s a footprint's rim softens
> by about 2.5 texels (8 cm) over a minute, which is the whole budget. Loose piled snow slumps
> faster than a compacted trench floor, so the berm channel gets three times the depression's
> rate. That difference is what makes a trail soften from its edges inward."*

**Reported as measured, not as documented:** the shipped coefficients are `D_dep = 0.004`
texel²/s and `D_berm = 0.012` texel²/s (the `k` factor already carries the `dt`, so summing over
any interval T gives a total coefficient of `0.004 · refillRate · T`). Those give a diffusion
length over 60 s of

- depression: `sqrt(2 · 0.004 · 60)` = **0.69 texels = 2.7 cm**
- berm: `sqrt(2 · 0.012 · 60)` = **1.20 texels = 4.7 cm**

The comment's "D = 0.05/s → 2.5 texels / 8 cm" describes the design *target*, not the constant
that shipped. A port that reproduces the shipped constants (0.004 / 0.012) will match the
reference's on-screen behaviour; a port that reproduces the comment's 0.05 will spread ~3.5×
faster than the reference does. **Use 0.004 and 0.012.**

Key properties a port must preserve:

- **The 3:1 anisotropy.** `kBerm / kDep = 0.012 / 0.004 = 3` exactly. Loose berms slump three
  times faster than the packed trench floor. This is the mechanism behind "a trail softens from
  its edges inward": the crest rounds off while the floor stays a floor.
- **Only R and G diffuse.** B (compression) and A (ice) are *not* diffused — they only decay.
  Compression and glaze do not creep sideways.
- **The `min(0.22, …)` caps are never binding** for the shipped parameters, because `k` is
  clamped to 1 and `0.012 · 1 < 0.22`. They exist as a stability guard against a port that
  changes `RELAX_STEP`, and must be kept: the explicit five-point Laplacian is unstable above
  0.25.
- **`k` saturates.** `k = clamp(refillRate · dt, 0, 1)`. With `dt ≈ 0.4167` s and `refillRate = 4`
  (slider max), `k` clamps to 1 rather than 1.67, so the effective diffusion at the top of the
  slider is 2.4× the base rate, not 4×. The slump term (§4.4) does *not* use `k` and therefore
  does scale linearly. That asymmetry is in the shipped behaviour; reproduce it.

### 4.4 Stage 2b — wind-driven upwind infill

```wgsl
// Drift blows into the trench from upwind, so pull a little of the
// upwind neighbour's state across. Asymmetric on purpose: a trail
// filling evenly from both sides looks like a blur, filling from one
// side looks like weather.
let wdir = vec2f(sin(uniforms.windAngle), cos(uniforms.windAngle));
let upwind = uv - wdir * (t * 1.6);
let uw = textureSampleLevel(prevTex, prevTexSampler, upwind, 0.0);
let kAdv = min(0.2, 0.002 * k);
dep  = mix(dep,  uw.r, kAdv * 0.6);
berm = mix(berm, uw.g, kAdv);
```

| Constant | Value | Meaning |
|---|---|---|
| wind direction vector | `vec2(sin θ, cos θ)` | θ = `windAngle`; note **sin on X, cos on Y** — a compass bearing, not a maths angle |
| upwind tap distance | **1.6 texels** = 6.25 cm | fractional — this tap *must* be a bilinear sample, not a texel fetch |
| `kAdv` | **0.002 /s**, capped at 0.2 | berm mixing weight |
| depression factor | **0.6** | depression advects at `0.002 · 0.6` = **0.0012 /s** |

This is a first-order upwind advection scheme. Its two visible effects:

1. **Directional drift.** Effective drift velocity = `mix weight × tap distance` =
   `0.002 × 1.6` = 0.0032 texel/s for berm (0.00192 for depression). Over 60 s that is ~0.19
   texel — small in absolute terms, but *one-sided*, which is the point: the trench cross-section
   becomes asymmetric rather than symmetrically blurred.
2. **Numerical diffusion.** An upwind scheme carries `D_num = v·Δx/2` = 0.0026 texel²/s for berm
   and 0.0015 texel²/s for depression — i.e. it adds ~38% on top of the explicit depression
   diffusion. A port that "cleans this up" into a symmetric second-order scheme will lose both
   the asymmetry **and** a measurable share of the 60-second decay budget.

**`S.windDirection` default is 42°** (degrees, compass bearing; the same value drives sastrugi
shear and dune orientation, held 70–80° from the sun azimuth of 118°).

### 4.5 Stage 2c — berm-into-depression slump

```wgsl
// Piled mass falls back into the hole it came out of. Taking the min
// keeps it mass-conserving and means an isolated berm with no adjacent
// depression does not evaporate — it has to diffuse away instead.
//
// Per second, like the diffusion above.
let slump = min(berm, dep) * min(0.6, 0.002 * uniforms.refillRate * dt);
dep  -= slump;
berm -= slump;
```

| Constant | Value |
|---|---|
| slump rate | **0.002 /s** at `refillRate = 1` |
| cap | 0.6 (never binding for shipped parameters) |

Note carefully: this term uses `uniforms.refillRate * dt` **directly**, not the clamped `k`. So
it scales linearly with the slider all the way to 4.

`min(berm, dep)` is what makes it mass-conserving and what makes it *local*: it only removes
material where a berm and a depression coexist in the same texel — i.e. at the rim, where the
berm ring overlaps the depression shoulder. An isolated berm (e.g. the outer wall thrown clear
by a carve, or Vortex's give-back deposit) has `dep ≈ 0` at its texels, so `slump ≈ 0` and the
berm can only flatten by diffusion. Reproducing `min()` rather than, say, multiplying the two,
is required for that behaviour.

If the depression is the smaller of the two (the usual case at the rim), this is a second
exponential on R with time constant `1 / 0.002` = **500 s**.

### 4.6 Stage 2d — the four decays, and why `dt` is banked

```wgsl
let r = uniforms.refillRate;
dep  *= exp(-dt * r / 400.0);
berm *= exp(-dt * r / 250.0);
comp *= exp(-dt * r / 300.0);
// Ice is the one thing here that is meant to feel permanent within a
// session — a spell that "permanently alters the surface" should not
// visibly melt while the player watches it.
ice  *= exp(-dt * r / 900.0);
```

| Channel | τ (s) | Half-life (s) | Survives 60 s |
|---|---|---|---|
| R depression | **400** | 277.3 | 86.07 % |
| G berm | **250** | 173.3 | 78.66 % |
| B compression | **300** | 207.9 | 81.87 % |
| A ice | **900** | 623.8 | 93.55 % |

Now the part that a naive port will get wrong. Quoted verbatim, because it is the single most
important engineering note in the file:

> *"Time constants, seconds, at refillRate = 1. The reason `dt` is banked rather than per-frame
> lives here.*
>
> *A 400-second time constant is a per-frame multiply by 0.999985 at 165 FPS. Half float carries
> an 11-bit significand, so one ULP near 0.5 is a relative 4.9e-4 — thirty times **larger** than
> the 1.5e-5 the decay is trying to subtract. Every store therefore lands between two
> representable values, and because the product is always slightly below the input it
> consistently resolves to the lower one: the buffer loses a full ULP per frame instead of the
> sliver it asked for.*
>
> *That is a decay of 2^-11 per frame — about 8% per second, a ten-second half-life, entirely
> independent of the constant written here and proportional to frame rate. It is why three rounds
> of retuning these numbers changed the measured decay by nothing at all, and why setting
> refillRate to 0 (which makes exp() return exactly 1) froze the buffer solid. Banking the time
> and spending it in steps of ~0.4 s puts each multiply two ULPs clear of the noise floor, and
> the constants below now mean what they say."*

The CPU side implements the banking:

```js
const RELAX_STEP = 0.4;   // seconds of relaxation banked before it is worth applying
...
this._relaxOwed += dt;
let relaxDt = 0;
if (this._relaxOwed >= RELAX_STEP) {
    relaxDt = this._relaxOwed;
    this._relaxOwed = 0;
}
...
pt.setFloat("dt", relaxDt);
```

Arithmetic that must survive the port:

- 0.4 s of a 400 s decay is a relative change of **1e-3**, versus a half-float ULP of **4.9e-4** —
  i.e. **2 ULPs**, comfortably clear of the quantisation floor, and far too small a step to see.
- The relax block therefore fires at most **2.5 Hz**; the splat block fires **every frame**.
- **Every relax term is an exact no-op at `dt = 0`**: `k = 0` ⟹ `kDep = kBerm = kAdv = 0`,
  `slump = 0`, `exp(0) = 1`. This is what makes the banking safe, and it is a hard requirement
  on any reformulation.
- On a `dt = 0` frame the pass is a **pure copy plus splat**. For that copy to be lossless, the
  centre sample must land exactly on the texel centre — see the porting note in §8.4. If the
  full-screen pass is off by half a texel, the buffer bilinearly blurs itself into nothing within
  a second or two, which will look like "the decay is far too fast" and send you hunting in the
  wrong file.

#### 4.6.1 What actually survives 60 seconds

Derivation, at `refillRate = 1`, for depression:

| Term | Factor over 60 s |
|---|---|
| Explicit decay `exp(-60/400)` | 0.8607 |
| Slump (τ = 500 s where berm ≥ dep) `exp(-60/500)` | 0.8869 |
| Diffusion + upwind numerical diffusion, at trail scale | ≈ 0.91–0.99 depending on feature width |
| **Product** | **≈ 0.70 – 0.76** |

Which is the README's claim:

> *"slow exponential decay: **~71% of trail depth survives a minute**, visibly spreading and
> softening as it goes."*

The effective combined time constant is `-60 / ln(0.71)` ≈ **175 s**. Feature-width dependence is
real and intended: a 0.2 m footprint (≈5 texels, dominant wavelength ≈10 texels) loses ~9% to
diffusion over the minute, while a 0.6 m surf groove (≈15 texels) loses ~1%. **Narrow marks
heal faster than wide ones**, which is exactly right physically and is a checkable acceptance
criterion.

### 4.7 Stage 3 — splat

Runs unconditionally, outside the `wasInside` branch, so a brush written onto a just-exposed
texel still lands (it accumulates on top of the zeros).

```wgsl
let n = i32(uniforms.brushCount);
for (var i = 0; i < n; i++) {
    let a = textureLoad(brushTex, vec2i(i, 0), 0);
    let b = textureLoad(brushTex, vec2i(i, 1), 0);
    let c = textureLoad(brushTex, vec2i(i, 2), 0);

    let radius = a.z;
    if (radius <= 0.0) { continue; }

    // Wrap the offset too, so a brush written near the seam still reaches
    // the texels on the far side of it.
    var p = world - a.xy;
    p -= size * round(p / size);

    // Cheap reject before the trig. The berm ring lives out to ~1.35, and
    // the edge wobble can push it a little past that.
    let reach = radius * max(a.w, 1.0) * 1.6;
    if (abs(p.x) > reach || abs(p.y) > reach) { continue; }

    // Into brush space: rotate by the brush yaw, then squash the long axis.
    let q = vec2f(
        (p.x * b.x + p.y * b.y) / (radius * a.w),
        (-p.x * b.y + p.y * b.x) / radius
    );
    let d = length(q);
    if (d > 1.55) { continue; }

    let ang = atan2(q.y, q.x);
    let wob = 1.0 + c.z * 0.22 * noise2(vec2f(cos(ang), sin(ang)) * 2.7 + c.w);
    let dn = d / wob;

    // Depression: flat-ish floor, then a fast shoulder. Not a Gaussian —
    // a boot compresses a floor, it does not dimple.
    let core = 1.0 - smoothstep(0.42, 1.0, dn);

    // Berm: a ring sitting just outside the depression rim, where the
    // displaced mass actually ends up.
    let ringD = (dn - 1.04) * 3.4;
    let ring = exp(-ringD * ringD);
    let grain = 0.72 + 0.56 * (noise2(q * 7.5 + c.w * 3.1) * 0.5 + 0.5);

    dep  += b.z * core;
    berm += b.w * ring * grain;
    comp += c.x * core;
    ice   = max(ice, c.y * core);
}
```

Step by step:

**Toroidal offset wrap.** `p -= size * round(p / size)` selects the shortest toroidal
displacement, so a brush written near the seam still reaches texels on the far side of it. This
is the same `round`-based minimum-image convention as `texelWorld`.

**Cheap reject.** `reach = radius · max(elongation, 1.0) · 1.6`, tested as an axis-aligned box on
the **unrotated** offset — conservative for any yaw. The 1.6 covers the berm ring (which peaks at
1.04 and has meaningful energy to ~1.35) plus the edge wobble.

**Brush space.** The `q` construction rotates by yaw then divides: the **x** component by
`radius · elongation` (the long axis) and the **y** component by `radius` (the short axis). So
`radius` is the *short-axis* radius in metres and `elongation` is the long-axis multiple.

WGSL matrix convention note for the port: `b.x = cos(yaw)`, `b.y = sin(yaw)`, and the rotation is
written out by hand as dot products — there is no matrix, so there is no column-order hazard here.
Transcribe the two lines literally.

**Rim wobble.**

```
wob = 1 + edgeRoughness · 0.22 · noise2( (cos ang, sin ang) · 2.7 + seed )
dn  = d / wob
```

- Amplitude **0.22**: at `edgeRoughness = 1` the rim radius varies by ±22%.
- Frequency **2.7**: sampling gradient noise on a circle of radius 2.7 gives a circumference of
  `2π · 2.7 ≈ 17` noise cells, so about **17 lobes** around the rim.
- `seed` (row 2, w) decorrelates the wobble between brushes.
- *"A clean analytic bevel at the trail edge is the tell that reads as 'decal'; breaking the rim
  radius with angular noise and granulating the berm is what gives it the chunky displaced look."*

**Depression profile.** `core = 1 - smoothstep(0.42, 1.0, dn)`. Flat at full depth out to
`dn = 0.42`, then a smooth shoulder to zero at `dn = 1.0`. **Not a Gaussian** — *"a boot compresses
a floor, it does not dimple."*

**Berm profile.** `ring = exp(-((dn - 1.04)·3.4)²)`. A Gaussian ring:

- peak at `dn = 1.04` → **1.04 · radius** from centre on the short axis (`1.04 · radius · elong`
  on the long axis)
- σ = `1/(3.4·√2)` = **0.208** in `dn` units → 0.208·radius in metres on the short axis
- FWHM = 2.355σ = **0.49 · radius**
- at the `d > 1.55` reject (worst case `wob = 1`) the ring is still at `exp(-((1.55-1.04)·3.4)²)`
  = **4.9%** of peak — an acceptable, deliberate truncation.

**Berm granularity.** `grain = 0.72 + 0.56·(noise2(q·7.5 + seed·3.1)·0.5 + 0.5)`, i.e. a
multiplier in **[0.72, 1.28]** with mean 1.0, at ~7.5 noise cells per unit of brush space
(feature size ≈ 0.133 · radius; for a 0.10 m boot that is ~1.3 cm granules). The `seed · 3.1`
offset makes the granularity independent between brushes.

**Accumulation semantics — critical:**

| Channel | Operator | Note |
|---|---|---|
| R depression | `+=  depression · core` | additive; a brush may be negative (Vortex give-back) |
| G berm | `+=  berm · ring · grain` | additive, ring-shaped, granulated |
| B compression | `+=  compression · core` | additive, core-shaped |
| A ice | `= max(ice, ice_brush · core)` | **max, not add** — glaze does not stack |

The ice channel taking a `max` (documented in `brush()` as *"0..1, taken as a max rather than
added"*) is the reason repeated Ribbon passes over the same ground do not saturate the glaze
into a mirror.

### 4.8 Stage 4 — clamp and output

```wgsl
dep  = clamp(dep,  0.0, uniforms.maxDepth);
berm = clamp(berm, 0.0, uniforms.maxBerm);
comp = clamp(comp, 0.0, 1.0);
ice  = clamp(ice,  0.0, 1.0);

fragmentOutputs.color = vec4f(dep, berm, comp, ice);
```

The **lower clamp at 0** on R is load-bearing: Vortex writes a negative depression while its
snow falls back, and that negative can only ever *cancel* existing depression, never mound the
ground through R. Mounding is G's job, and Vortex accordingly also writes a positive berm on
the give-back.

---

## 5. The read side — `lib/deform.wgsl` (`#include<snowDeform>`)

> *"Three consumers sample this: the snow vertex shader (displacement), the shadow depth vertex
> shader (so carved snow casts its own shadow), and the snow fragment shader (normals and surface
> state). They must agree exactly — if the depth pass placed a vertex a centimetre off the beauty
> pass, the trail would acne against its own floor. Hence one include rather than three copies."*

(In the shipped build there are in fact **five** programs that include it: beauty vertex, three
per-cascade depth vertex materials, and the depth-prepass vertex.)

### 5.1 `deformUV` — already given in §1.3.

### 5.2 `deformFalloff` — the window fade

```wgsl
/// How much of the buffer's authority applies here, 0..1.
///
/// Faded rather than cut: the window edge is a straight line ~32 m from the
/// player, and a hard cutoff there would drag a visible seam across the field
/// every time the player moved. The fade completes before the toroidal seam, so
/// the wrapped-around content is never visible at any weight.
fn deformFalloff(worldXZ: vec2f, centre: vec2f, size: f32) -> f32 {
    let d = abs(worldXZ - centre) / (size * 0.5);
    return 1.0 - smoothstep(0.80, 0.96, max(d.x, d.y));
}
```

Chebyshev (square) falloff, normalised so 1.0 is the window edge:

- full authority out to `0.80 × 40 m` = **32 m** from the player
- zero authority beyond `0.96 × 40 m` = **38.4 m**
- fade band width = **6.4 m**

Every consumer gates on this: `if (dWeight > 0.001)` in the fragment and prepass, and
`if (w <= 0.0) return 0.0;` inside `deformHeight`. *"the whole clipmap is 870 m across and the
deformation window is 80 m, so the falloff test rejects the overwhelming majority of vertices
before a single fetch."*

### 5.3 `deformHeight` — band-limited displacement

```wgsl
fn deformHeight(
    tex: texture_2d<f32>, samp: sampler,
    worldXZ: vec2f, centre: vec2f, size: f32, scale: f32, spacing: f32
) -> f32 {
    let w = deformFalloff(worldXZ, centre, size);
    if (w <= 0.0) { return 0.0; }

    let base = deformUV(worldXZ, size);
    let r = spacing / size; // tap offset, in UV

    var acc = 0.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            // Binomial [1,2,1] x [1,2,1] / 16.
            let wt = f32((2 - abs(i)) * (2 - abs(j))) * (1.0 / 16.0);
            let uv = base + vec2f(f32(i), f32(j)) * r;
            let s = textureSampleLevel(tex, samp, uv, 0.0);
            acc += (s.g - s.r) * wt;
        }
    }
    return acc * scale * w;
}
```

**Nine taps**, separable 3×3 binomial, weights `[1,2,1]⊗[1,2,1] / 16` (centre 4/16, edge 2/16,
corner 1/16), **tap spacing = one clipmap vertex spacing in world metres**, converted to UV by
`spacing / size`.

Per tap the value accumulated is **`s.g - s.r`** — displaced mass minus depression — i.e. the
signed net height offset in metres. Result is multiplied by `scale` (= `S.deformDepth`, uniform
`deformDepthScale`) and by the falloff weight.

Why the filter exists, verbatim:

> *"The filter is not optional polish — without it the surf groove tears itself into a row of
> triangular peaks. The clipmap rings are centred on the camera, so orbiting or zooming slides a
> ring boundary across a stationary trail: the same patch of snow gets re-sampled from 0.085 m
> spacing to 0.34 m, and a 0.6 m-wide groove with a narrower berm crest ends up with less than one
> vertex across its ridge. Each triangle then spans the whole berm and the ridge collapses into
> facets that swim as the camera moves. Fading the displacement out with distance hides it but
> also deletes the trail; filtering fixes it.*
>
> *A separable 3x3 binomial with taps one `spacing` apart puts the filter's first zero exactly at
> the lattice Nyquist (wavelength 2 x spacing), so content the vertices cannot represent is removed
> rather than aliased, while a broad trench at 8 x spacing still passes at 85%. Because `spacing`
> is continuous through the CDLOD morph, so is the filter — two rings meeting at a shared vertex
> compute the same width and the same height, and the mesh stays crack-free."*

Transfer function check: for `[1,2,1]/4` with tap spacing `h`, `H(k) = (1 + cos(k·h))/2`.
First zero at `k·h = π` ⟹ wavelength `2h` = the lattice Nyquist ✓. At wavelength `8h`,
`H = (1 + cos(π/4))/2` = **0.854** ✓ ("85%").

**Because `spacing` is continuous through the CDLOD morph, the filter width is continuous too.**
That is what keeps the mesh crack-free: two rings meeting at a shared vertex must compute the
identical filter width and therefore the identical height.

### 5.4 Scale is quadratic in the depth slider — note this

`maxDepth = 0.55 · S.deformDepth` (clamp, CPU) and `scale = S.deformDepth` (read side). The
displayed displacement therefore saturates at `0.55 · S.deformDepth²` metres. At the default
slider value of 1.0 this is invisible; at the slider max of 3.0 it is a factor of 9. Shipped
behaviour — reproduce it rather than "fixing" it, or the slider will not feel the same.

---

## 6. Where the displacement is applied — one include, five programs

### 6.1 The shared gate

The **identical** block appears in `snow.vertex.wgsl` (beauty), `terrainDepth.vertex.wgsl`
(shadow cascades) and `terrainPrepass.vertex.wgsl` (depth prepass):

```wgsl
if (cv.spacing < 1.0) {
    let dfade = 1.0 - smoothstep(0.5, 1.0, cv.spacing);
    h += deformHeight(
        deformTex, deformTexSampler, worldXZ,
        uniforms.deformCenter, uniforms.deformSize, uniforms.deformDepthScale,
        cv.spacing
    ) * dfade;
}
```

with the source-level warning:

> *"This gate and the filter argument must be mirrored exactly in terrainDepth.vertex.wgsl, or the
> terrain will shadow against a surface it is not drawing."*
>
> *"If this pass displaced on a ring the beauty pass left flat — or band-limited it differently —
> the terrain would shadow against a surface that is not the one being drawn, and every berm would
> acne."*

| Constant | Value |
|---|---|
| displacement gate | `spacing < 1.0` m |
| `dfade` smoothstep | **0.5 → 1.0** m of vertex spacing |

For orientation, the clipmap that feeds `cv.spacing`: `BASE_SPACING` = **0.085 m**, `LEVELS` = **8**
rings, `GRID_N` = 160 quads per side (`GRID_HALF_N` = 80), spacing doubles per ring, CDLOD morph
`clamp((cheb - 0.70)/0.16, 0, 1)` and post-morph `spacing_eff = spacing · (1 + morph)`. So rings 0–2
always pass the gate, ring 3 (0.68 → 1.36 m post-morph) fades out through it, and rings 4–7 never
displace. In practice `deformFalloff` (38.4 m) closes before the spacing gate does, because
ring 3's inner boundary sits at ~27 m and its outer at ~54 m.

Compare the *fine* (sastrugi) layer's gate in the same shaders — `spacing < 0.42` with fade
`0.16 → 0.42` — and the source's justification for the difference:

> *"Sastrugi is a 2 m wavelength at +/-12 cm, so past 0.42 m spacing it is smaller than a triangle
> and there is nothing to be done but drop it. A trail is the opposite shape of problem — half a
> metre wide but up to half a metre deep — so it is worth displacing well past the point where the
> lattice resolves its walls, provided it is band-limited on the way in."*

### 6.2 The five programs and how they get the same numbers

| Program | Vertex shader | View-projection uniform | Notes |
|---|---|---|---|
| Beauty | `snow.vertex.wgsl` | `viewProjection` (TAA-jittered) | also reads the buffer again in the fragment stage |
| Shadow cascade 0 | `terrainDepth.vertex.wgsl`, define `SNOW_CASCADE 0` | `lightViewProjection` | separate `ShaderMaterial` per cascade so each carries its own matrix with no mid-frame uniform swapping |
| Shadow cascade 1 | same, `SNOW_CASCADE 1` | `lightViewProjection` | |
| Shadow cascade 2 | same, `SNOW_CASCADE 2` | `lightViewProjection` | |
| Depth prepass | `terrainPrepass.vertex.wgsl` | `viewProjection` (jittered) | additionally emits an **ice mask** varying |

Shadow system: `CASCADE_COUNT = 3`, each map **2048²**, cascade far splits **[26, 95, 330]** m.
The terrain registers as a caster into all three.

All five materials are pointed at the *same* target every frame by one call:

```js
setDeformTexture(tex) {
    this._boundDeform = tex;
    this.material.setTexture("deformTex", tex);
    for (i in this._depthMats) this._depthMats[i].setTexture("deformTex", tex);
    if (this.prepassMat) this.prepassMat.setTexture("deformTex", tex);
}
```

and all five receive the identical `deformCenter`, `deformSize`, `deformDepthScale` uniforms in
the same `Terrain.update()`. The shadow-pass vertex shader **uses the camera-relative clipmap
placement, not a light-relative one** — the geometry in the shadow map must be the identical mesh
the beauty pass draws; only the view-projection differs.

The shadow bias is `0.022` m and shadow softness `1.8`; the cascade fitter is given world height
bounds of `[minHeight - 4, maxHeight + 6]`, the margin explicitly *"covers carved berms and
anything standing on the snow."*

### 6.3 The prepass ice mask — read raw, deliberately

```wgsl
// The ice channel, read straight rather than through `deformHeight`'s
// binomial: this feeds a reflection gate, not a displacement, so smoothing it
// to the vertex lattice would only soften the edge of a glaze that the
// fragment stage draws hard.
let dWeight = deformFalloff(worldXZ, uniforms.deformCenter, uniforms.deformSize);
if (dWeight > 0.001) {
    let s = textureSampleLevel(
        deformTex, deformTexSampler, deformUV(worldXZ, uniforms.deformSize), 0.0
    );
    mask = clamp(s.a, 0.0, 1.0) * dWeight;
}
```

`vMask` becomes the SSR gate: the screen-space-reflection post pass is a fetch and a branch on
any frame where nobody has cast Crystallise.

---

## 7. The fragment-side read — normals and surface state

In `snow.fragment.wgsl`, after the macro and fine gradients have been accumulated into `grad`:

```wgsl
let dWeight = deformFalloff(world.xz, uniforms.deformCenter, uniforms.deformSize);
if (dWeight > 0.001) {
    let dUV = deformUV(world.xz, uniforms.deformSize);
    let c = textureSampleLevel(deformTex, deformTexSampler, dUV, 0.0);

    let step = max(uniforms.deformTexel * 2.0, footprintMin * 1.4);
    let eUV = step / uniforms.deformSize;

    let dxA = textureSampleLevel(deformTex, deformTexSampler, dUV + vec2f(eUV, 0.0), 0.0);
    let dxB = textureSampleLevel(deformTex, deformTexSampler, dUV - vec2f(eUV, 0.0), 0.0);
    let dzA = textureSampleLevel(deformTex, deformTexSampler, dUV + vec2f(0.0, eUV), 0.0);
    let dzB = textureSampleLevel(deformTex, deformTexSampler, dUV - vec2f(0.0, eUV), 0.0);
    let sx = (dxA.g - dxA.r) - (dxB.g - dxB.r);
    let sz = (dzA.g - dzA.r) - (dzB.g - dzB.r);

    let wide = clamp(footprintMin / (uniforms.deformTexel * 4.0), 0.0, 1.0) * 0.8;
    let df = mix(c, (c + dxA + dxB + dzA + dzB) * 0.2, wide);

    deformDepth = df.r * dWeight;
    deformBerm  = df.g * dWeight;
    compression = clamp(df.b, 0.0, 1.0) * dWeight;
    iceAmount   = clamp(df.a, 0.0, 1.0) * dWeight;

    grad += vec2f(sx, sz) / (2.0 * step) * uniforms.deformDepthScale * dWeight;
}
```

**The widening central difference.** The differencing baseline is
`step = max(deformTexel · 2.0, footprintMin · 1.4)` — i.e. never narrower than two texels, and
otherwise 1.4× the *narrow* axis of the pixel's world footprint. Rationale, verbatim:

> *"Two texels differenced at 30 m is a normal sampled far below the pixel's own footprint, so it
> aliases. Fading it out fixes the aliasing but stops the trail existing about fifteen metres out,
> and a run should be visible from across the field. Widening the baseline is the better answer: it
> is the low-pass filter the fade was standing in for. The difference stays bounded while the
> divisor grows, so the gradient rolls off smoothly with distance instead of being switched off,
> and the trail survives as a tonal line long after it has stopped being a shape.*
>
> *Keyed to the narrow footprint axis, so the width tracks how far away the snow is and not how
> obliquely it is being looked at."*

`footprintMin = max(min(|ddx(world).xz|, |ddy(world).xz|), 1e-4)` — the *short* axis of the
anisotropic pixel footprint, not the average. This is the same reasoning anisotropic texture
filtering runs on, and it is why a carved trail does not change shape when you tilt the camera
toward the horizon.

**The state blend.** `wide = clamp(footprintMin / (deformTexel · 4.0), 0, 1) · 0.8` and
`df = mix(c, (c + 4 neighbours) · 0.2, wide)` — once the pixel is wider than four texels, the
state channels blend toward a 5-tap box average, *"stops a distant trail breaking into a dotted
line"*, and it is free because the four neighbours were fetched for the gradient anyway.

Note that the fragment path deliberately does **not** apply `deformHeight`'s binomial nor the
`dfade` spacing gate — it carries the sub-vertex detail that the displaced geometry cannot.

### 7.1 Material response — the numbers that make a trail readable

Base snow, before any deformation state:

```
albedo    = (0.855, 0.885, 0.945)
roughness = 0.62
f0        = 0.028
thickness = 1.0     // 1 = deep drift, 0 = thin crust
```

**Compression (channel B) — packed snow:**
```
albedo    = mix(albedo, (0.62, 0.665, 0.755), compression * 0.85)
roughness = mix(roughness, 0.34, compression)
thickness = mix(thickness, 0.35, compression)
detailStrength *= mix(1.0, 0.45, compression)   // grain normals flattened where trodden
```

**Ice (channel A) — refrozen glaze:**
```
albedo    = mix(albedo, (0.42, 0.56, 0.70), iceAmount * 0.8)
roughness = mix(roughness, 0.07, iceAmount)
f0        = mix(f0, vec3(0.045), iceAmount)
thickness = mix(thickness, 0.15, iceAmount)
```

**Berm (channel G) — freshly broken snow:**
```
if (deformBerm > 0.002) {
    loose     = clamp(deformBerm * 5.0, 0.0, 1.0);
    albedo    = mix(albedo, (0.895, 0.920, 0.965), loose * 0.55);
    roughness = mix(roughness, 0.78, loose * 0.7);
    thickness = mix(thickness, 1.0, loose * 0.6);
    chunk     = noise2(world.xz * 34.0) * 0.5 + 0.5;
    albedo   *= 1.0 - loose * 0.10 * chunk;
}
```

with the art direction stated explicitly, and it is a hard constraint on any port that retunes
these:

> *"Both numbers here must not make carved snow **less blue**, which is the one axis this material
> cannot afford to lose. Drain the cool cast out of a heavily worked patch and it reads as bare
> ground even while its luminance goes up — a warm-grey patch surrounded by blue-white snow is not
> snow. 1. The loose colour was a whiter white — B/R 1.078 against snow's 1.105 — so brightening
> toward it desaturated. It is now brighter than snow in every channel and very slightly bluer…
> 2. Roughness at 0.78 cut the ambient sky specular… Loose snow is still rougher than packed — it
> should be — just not by enough to strip the sky out of it."*

Check the ratios yourself: base B/R = 0.945/0.855 = **1.105**; loose B/R = 0.965/0.895 = **1.078**
before the fix and the shipped loose colour is brighter in *every* channel than base snow. The
`loose` ramp saturates at `deformBerm = 0.2` m.

**Occlusion and the cave tint:**
```
ao = mix(1.0, cavity, 0.35 * (1.0 - smoothstep(0.02, 0.25, footprint)))
   * (1.0 - clamp(deformDepth * 1.9, 0.0, 1.0) * 0.38);
...
caveTint = mix(vec3(1.0), vec3(0.55, 0.72, 1.0), (1.0 - ao) * 0.95);
color *= ao * caveTint;
```

A depression of `1/1.9` = 0.53 m saturates the depth term, darkening by up to **38%** — and the
darkening carries a **blue** shift with it, *"Light reaching into a hollow in snow has scattered
through snow to get there, and snow absorbs red over any appreciable path — which is why a real
snow cave is blue and not grey."* The tint is tied to the darkening, not to `deformDepth`, so the
two can never drift apart.

**Debug view** (`debugMode == 1`, `S.debugView = "deform"`):
```
color = vec3(deformDepth * 2.5, deformBerm * 5.0, compression * 0.6);
```
Scales chosen because *"depression and berm are metres and berms are the shallower of the two, so
both are scaled to fill the range rather than shown raw."*

---

## 8. The `brush()` API — the shared write path

**Everything that touches the snow goes through this one function.** *"That shared write path is
what makes the effects part of the snow rather than decals floating above it."*

### 8.1 Full signature and semantics

```js
/**
 * @param {number} x           world X, absolute metres
 * @param {number} z           world Z, absolute metres
 * @param {number} radius      metres, across the SHORT axis
 * @param {number} depth       metres of depression at the centre (may be negative)
 * @param {number} berm        metres of displaced mass thrown to the rim
 * @param {number} compression 0..1 added to the compression channel
 * @param {number} ice         0..1, taken as a MAX rather than added
 * @param {number} [yaw]       radians, orients the long axis (default 0)
 * @param {number} [elongation] long-axis multiple of `radius`, 1 = round (default 1)
 * @param {number} [edge]      0..1 rim roughness; 0 is a clean bevel (default 1)
 */
brush(x, z, radius, depth, berm, compression, ice, yaw, elongation, edge)
```

Semantics that a port must preserve exactly:

- **Positions are absolute world metres.** *"the shader wraps them into the window itself, so
  callers never think about the toroid."*
- **Accumulates additively** into whatever is already there, within this frame *and* across
  frames (the buffer is persistent).
- **Queue-per-frame, consumed by the next simulation pass.** `_brushCount` is reset to 0 at the
  end of `update()`.
- **Zero allocation.** Brushes are written straight into the pre-sized staging `Float32Array`.

### 8.2 Guards, in order

```js
if (this._brushCount >= MAX_BRUSHES) return;       // 96 brushes per frame, silently dropped after
if (radius <= 0) return;                            // radius 0 is also the shader's skip test

const halfPlus = this.size * 0.5 + radius * 2;      // 40 m + 2·radius
if (Math.abs(x - this.center.x) > halfPlus) return;
if (Math.abs(z - this.center.y) > halfPlus) return;
```

Note the cull margin uses `radius * 2`, **not** `radius · elongation · 1.6`, so a strongly
elongated brush right at the window edge can be culled marginally early. Shipped behaviour;
harmless because the read-side falloff has already zeroed that region.

### 8.3 Tail cleanup

```js
_uploadBrushes() {
    // Only the live brushes carry meaning; the shader reads exactly
    // `brushCount` of them, so the tail can stay stale. But radius 0 is the
    // shader's own skip test, so clearing it is a cheap safety net.
    const d = this._brushData;
    for (let i = this._brushCount; i < MAX_BRUSHES; i++) d[i * 4 + 2] = 0;   // radius := 0
    this.brushTex.update(d);
}
```

called from `update()` when `_brushDirty || _brushCount > 0`, i.e. *"Zero out the tail of the
brush texture once after a busy frame, so a stale radius can never be picked up by a later,
shorter frame."*

### 8.4 The CPU frame sequence

From `deformation.js update(dt, focus)` in exact order:

1. `_prevCenter ← center`
2. `center ← round(focus / texel) · texel` (both axes)
3. upload brushes if dirty or non-empty
4. `_relaxOwed += dt`; if `>= 0.4` then `relaxDt = _relaxOwed`, `_relaxOwed = 0`; else `relaxDt = 0`
5. bind `prevTex ← targets[1 - _write]`
6. push uniforms: `center`, `prevCenter`, `size`, `res`, `dt = relaxDt`, `brushCount`,
   `refillRate = S.refillRate`, `maxDepth = 0.55·S.deformDepth`, `maxBerm = 0.34·S.deformBerm`,
   `windAngle = S.windDirection·π/180`
7. `pt.render()`
8. `this.texture = pt`; `_write = 1 - _write`; `_brushCount = 0`; return `pt`

And the enclosing per-frame order from `main.js`, which is what guarantees zero-latency marks:

```
character.update(dt)            // physics, facing, speed, surf, carve
heightfield.clampToPlayArea()
figure.update(dt)               // pose the skeleton -> touchdown[] and plant[] exist
contact.update(dt)              // -> brush() for footfalls, body drag, surf groove + 2 berms
rig.update(dt)
post.update(dt)                 // TAA jitter written into the projection
sky.update(); sky.render()
shadows.update()                // cascade refit
spells.update(dt)               // -> brush() for all five spells   <-- BEFORE terrain
terrain.update(cameraPos, character.position, dt)
    -> deform.update(dt, focus) -> sim pass renders -> rebind deformTex on 5 materials
figure.sync(); wake.update(); spray.update()
scene.render()                  // prepass, 3 cascades, beauty — all read this frame's target
```

with the source comment: *"After the shadow refit, so the water and the ice carry this frame's
cascade matrices; **before the terrain, so the brushes every spell writes are in the staging array
when the simulation pass runs**."*

Warm-up order in `terrain.warmUp()` also matters: `deform.warmUp()` runs **before** the snow
material compiles, *"because its first compile binds whatever is in the deformation target and
reading uninitialised VRAM as a height can put NaN into a vertex position."*

---

## 9. Every caller of `brush()` — complete catalogue

All values below are the literal arguments. `k`-style factors are given with their formulas so
the same marks can be reproduced.

### 9.1 Character — `snowContact.js`

Module constants:

| Name | Value | Note |
|---|---|---|
| `BOOT_WIDTH` | **0.10** m | short-axis radius ⟹ print 20 cm across |
| `BOOT_ELONG` | **1.7** | ⟹ print 34 cm long — *"a boot plus the collapse of the snow around it"* |
| `SURF_WIDTH` | **0.30** m | |
| `SURF_ELONG` | **2.6** | |

Mode gates: `if (ch.surf > 0.02) _surf(...)`, `if (ch.surf < 0.98) _walk(...)`. Footfalls fire in
both modes; the gait suppresses them while surfing because the feet are on the board.

**(a) Footfall** — one splat per plant, fired from the figure's own touchdown event (`fig.touchdown[i]
&& ch.stepping`), using the figure's frozen plant position `fig.plant[i*3 + {0,1,2}]`:

```js
const impact = Math.min(1.3, 0.35 + ch.speed / 5.4);
f.brush(px, pz,
    0.10,                       // radius = BOOT_WIDTH
    0.17 + 0.14 * impact,       // depth  — 17..31 cm ("a boot sinks 13-27 cm into unpacked snow")
    0.10 + 0.08 * impact,       // berm   — 10..19 cm
    0.9,                        // compression: trodden snow is dense
    0,                          // no ice
    ch.facing,                  // yaw
    1.7,                        // BOOT_ELONG
    1.0                         // full rim roughness — boots tear edges
);
```

`impact` is recomputed here rather than read off the controller *"so it cannot be a frame stale
relative to the plant it is describing."* Only the figure knows where the boot actually planted.

**(b) Body drag / walking scuff** — `_walk(dt, moved)`, skipped below `ch.speed < 0.25`:

```js
const w = 1 - ch.surf;
const k = Math.min(moved, 0.35);      // scaled by DISTANCE, not dt
this.field.brush(
    ch.position.x, ch.position.z,
    0.22,                 // radius
    0.20 * k * w,         // depth
    0.22 * k * w,         // berm
    0.8  * k * w,         // compression (deliberately below saturation)
    0,                    // ice
    ch.facing, 1.5, 0.85
);
```

> *"Scaled by distance travelled, not by dt, so the groove has the same depth per metre at any speed
> or frame rate. A given patch of ground sits under the brush for (2 · radius / moved) frames, so the
> depth it ends up at is roughly rate · 2 · radius · profile — independent of both speed and frame
> rate, which is the point."*
>
> *"Compression stays deliberately below saturation here. If the scuff packed the whole path to 1.0,
> the boot prints stamped on top would have nothing left to darken and the trail would read as one
> flat ribbon instead of as a line of prints in a churned path."*

**(c) Surf wake** — `_surf(dt, moved)`, **three brushes**:

```js
const speedK = Math.min(1, ch.speed / 6);  if (speedK < 0.05) return;
const k    = Math.min(moved, 0.6) * ch.surf * speedK;
const fast = Math.min(1, Math.max(0, ch.speed - 6) / 12);
const yaw  = ch.facing;
const rx   =  Math.cos(yaw);
const rz   = -Math.sin(yaw);          // the LATERAL axis
const lean = ch.carve;                // positive turning right
```

*groove* (offset toward the lean by 0.12·lean, because *"the board rides the inside edge in a turn"*):
```js
f.brush(
    ch.position.x + rx*lean*0.12, ch.position.z + rz*lean*0.12,
    0.30 * (1 + 0.35 * fast),   // radius widens with speed
    1.20 * k,                   // depth — "a run should be visible from across the field"
    0.30 * k,                   // berm
    4.0  * k,                   // compression — "the board packs the trench floor hard"
    0,
    yaw, 2.6, 0.55              // "the board's edge is cleaner than a boot's"
);
```

*two thrown-mass berms*, one per side:
```js
const outside = Math.min(1, Math.abs(lean));
const sideL   = 0.5 + lean * 0.5;      // weight on the LEFT berm
const sideR   = 0.5 - lean * 0.5;
const off     = 0.30 * (1.5 + 0.5 * fast);
const throwK  = 0.75 * k * (0.55 + 0.9 * outside) * (1 + 0.5 * fast);

f.brush(x - rx*off, z - rz*off, 0.30*0.95, 0, throwK*sideL*2.0, 0, 0, yaw, 2.6*0.8, 1.0);
f.brush(x + rx*off, z + rz*off, 0.30*0.95, 0, throwK*sideR*2.0, 0, 0, yaw, 2.6*0.8, 1.0);
```

> *"The outside of the turn takes most of it, and the outside of a right turn is the left-hand side —
> the board resists the turn and throws snow away from its centre, the same way a carving snowboard's
> spray arcs out of the turn rather than into it. `carve` is positive turning right, so the weights
> run against it. The wake mesh in `src/vfx/surfWake.js` resolves its sides from the same sign, so the
> airborne wave and the mark it leaves agree."*

Note these two brushes write **zero depression** — pure G. They are the isolated-berm case the
slump term's `min()` protects.

`_surf` also gates: *"Past the point where the trench stops deepening, extra speed still means extra
snow moved — it goes into width and into the walls, which is what makes a fast run's scar read as
bigger rather than just longer."*

### 9.2 Spell 1 — Sweep (`sweep.js _plough`)

Cadence: **one rank of brushes every 0.25 m of advance** (*"Denser than that just re-cuts the same
trench; sparser leaves it scalloped"*), `k = min(brushOwed, 0.7)`. **N = 13** brushes across the arc,
weight `w = bell(u)`, skipped below `w < 0.06`. Yaw is the arc **tangent**, so *"the trench is
continuous rather than a row of round pits."*

```js
f.brush(x, z,
    0.34,                    // radius
    0.95 * k * env * w,      // channel
    0.62 * k * env * w,      // berms at the rim
    0.55 * k * env * w,      // slush packs what it runs over
    0.16 * k * env * w,      // and refreezes a little of it
    yaw, 2.2, 0.9);
```

### 9.3 Spell 2 — Ribbon (`ribbon.js`)

**Scoring** (`_score`): cadence **1/60 s**, `k = min(scoreOwed, 0.05)`. Walks only the head end —
`span = min(n-1, 10)` samples, stride 2 — *"re-cutting it every frame is how a light trace turns into
a gouge."* Only where the body is low enough: `clear = y - terrain.heightAt(x,z)`, skip if
`clear > 0.34`, weight `w = 1 - clamp01(clear / 0.34)`.

```js
f.brush(x, z,
    0.13,                            // radius — a score, not a trench
    1.15 * k * w * this.blend,       // depth
    0.55 * k * w * this.blend,       // a small lip of pushed snow
    2.6  * k * w * this.blend,       // packed hard by running water
    1.9  * k * w * this.blend,       // and glazed
    0, 1, 0.65);
```

**Impact** (on the released head landing): one main brush plus three satellites —
*"Shallower than a Bloom crater and much wetter: this is water landing, so it packs and glazes far
more than it displaces."*

```js
ctx.deform.brush(x, z, 0.62, 0.16, 0.13, 1.0, 0.85, atan2(iz, ix), 1.35, 1.0);
for (i = 0..2) {
    a = rand·2π;  d = 0.55 + rand·0.65;
    ctx.deform.brush(x + cos(a)*d, z + sin(a)*d,
        0.30 + rand*0.22, 0.05, 0.07, 0.6, 0.5, a, 1.3, 1.0);
}
```

### 9.4 Spell 3 — Bloom (`bloom.js _crater`)

```js
ctx.deform.brush(this.x, this.z,
    1.15,                 // radius
    0.52,                 // depression
    0.40,                 // rim — "the mass has to go somewhere and this is where"
    0.72,                 // packed by the blast
    0.30,                 // and partly glazed
    Math.random() * Math.PI,
    1.15,                 // very slightly oval, so it is not a stamped circle
    1.0);

// "A broken outer ring, thrown clear of the rim. Four smaller brushes rather than one
//  wide one: a crater with a perfectly even rim is the tell that gives a single radial
//  brush away."
for (i = 0..3) {
    a = (i/4)·2π + rand·1.2;   d = 1.5 + rand·0.7;
    ctx.deform.brush(x + cos(a)*d, z + sin(a)*d,
        0.5 + rand*0.35, 0, 0.20 + rand*0.14, 0.15, 0, a, 1.4, 1.0);
}
```

### 9.5 Spell 4 — Crystallise (`crystallize.js`)

On trigger, **before any prism is visible** (*"the ground has already changed material by the time
the first prism is tall enough to see"*):

```js
f.brush(x, z, 1.55, 0.10, 0.16, 0.85, 1.0, rand*π, 1.2, 0.85);   // ice = 1.0, the glaze
for (i = 0..2) {
    a = rand·2π;  d = 1.1 + rand·1.3;
    f.brush(x + cos(a)*d, z + sin(a)*d,
        0.55 + rand*0.5, 0.04, 0.10, 0.5, 0.75, a, 1.5, 1.0);
}
```

Then per prism, **every other one** (`if ((i & 1) === 0)`), *"a little snow pushed aside where each
one broke the surface"*:

```js
ctx.deform.brush(x, z, radius * 3.2, 0.05, 0.09, 0.4, 0.9, ang, 1.2, 1.0);
```

This is the only writer that pushes ice to 1.0, and with τ_ice = 900 s the glaze is what remains
long after the depression around it has healed.

### 9.6 Spell 5 — Vortex (`vortex.js _strip`) — the negative-depression writer

```js
const holding = this.t < RAMP + HOLD;
this.ring = holding
    ? Math.min(3.1, this.ring + dt * 0.85)     // grows while held
    : Math.max(0.9, this.ring - dt * 2.2);     // retreats while fading

this._stripOwed += dt;
if (this._stripOwed < 1/45) return;
const k = Math.min(this._stripOwed, 0.05);

const N = 9;
const give = holding ? -1 : 1;
for (i = 0..8) {
    // "Rotating with the column, so the ring is scoured rather than stamped:
    //  a fixed set of angles leaves nine radial scars."
    const a = (i / N) * 2π + this.spin * 0.6;
    const r = this.ring * (0.82 + Math.random() * 0.3);
    f.brush(x + cos(a)*r, z + sin(a)*r,
        0.55,
        give < 0 ?  0.95 * k * env : -1.7 * k,    // depression  (NEGATIVE on give-back)
        give < 0 ?  0.05 * k * env :  0.85 * k,   // berm
        give < 0 ?  0.30 * k * env : -0.6 * k,    // compression (also negative)
        0,
        a + π*0.5, 1.9, 1.0);
}
```

> *"Holding: take snow away — depression up, no berm, because the mass is in the air rather than
> piled at the rim. Fading: put it back, as negative depression plus a little loose berm, because
> what lands is broken snow sitting proud of what it fell on."*
>
> *"The ring grows outward while the spell holds and retreats while it fades, so the snow comes back
> from the outside in — which is what settling snow does, since the outermost material was lifted the
> least far."*

The negative writes are exactly why the shader's clamp has a **lower bound at 0**: the give-back can
cancel the strip but can never invert it.

---

## 10. WebGL2 / Three.js r172 porting notes

### 10.1 Construct-by-construct map

| WebGPU / WGSL / Babylon | WebGL2 / GLSL ES 3.00 / Three.js r172 |
|---|---|
| `ProceduralTexture(..., ShaderLanguage.WGSL)` with `refreshRate = 0` | `THREE.WebGLRenderTarget` + a full-screen quad `THREE.Mesh` in an ortho scene; render manually with `renderer.setRenderTarget(rt); renderer.render(quadScene, quadCam); renderer.setRenderTarget(null)` |
| `TEXTURETYPE_HALF_FLOAT` + `TEXTUREFORMAT_RGBA` | `{ type: THREE.HalfFloatType, format: THREE.RGBAFormat }`. **Requires `EXT_color_buffer_float`** (or `EXT_color_buffer_half_float`) to be renderable — query it and fail loudly if absent. Linear *filtering* of half-float is core WebGL2 (no `OES_texture_float_linear` needed). |
| `TEXTURE_WRAP_ADDRESSMODE` on the RT | `rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping` on **both** targets, set immediately after construction. Without this the entire toroidal scheme silently becomes clamp-to-edge and marks smear off the window edge. |
| `TEXTURE_BILINEAR_SAMPLINGMODE` | `minFilter = magFilter = THREE.LinearFilter`, `generateMipmaps = false` |
| `autoClear = false` | `renderer.autoClear = false` around the pass, or clear-less RT config. The pass writes every texel, so clearing is pure bandwidth. |
| RT depth/stencil | `{ depthBuffer: false, stencilBuffer: false, samples: 0 }` |
| Colour management | `rt.texture.colorSpace = THREE.NoColorSpace` — this is data, and three will otherwise inject an sRGB decode |
| `RawTexture.CreateRGBATexture(f32Array, 96, 3, …, TEXTURETYPE_FLOAT, NEAREST)` | `new THREE.DataTexture(f32, 96, 3, THREE.RGBAFormat, THREE.FloatType)`; `magFilter = minFilter = THREE.NearestFilter`; `wrapS = wrapT = THREE.ClampToEdgeWrapping`; `flipY = false`; `generateMipmaps = false`; set `needsUpdate = true` each frame you re-upload. **Must be FloatType** (§2.2). |
| `textureLoad(brushTex, vec2i(i, row), 0)` | `texelFetch(brushTex, ivec2(i, row), 0)` — row 0 is `v = 0`; keep `flipY = false` so the CPU row order survives |
| `textureSampleLevel(tex, samp, uv, 0.0)` | `textureLod(tex, uv, 0.0)` (combined sampler; required in vertex shaders, which have no implicit derivatives) |
| separate `texture_2d<f32>` + `sampler` | one `uniform sampler2D` per texture — WebGL2 has no separate sampler objects in GLSL |
| `uniforms.foo` | plain `uniform float foo;` etc. |
| `input.vUV` / `fragmentOutputs.color` | `in vec2 vUv;` / `layout(location = 0) out vec4 fragColor;` with `THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3 })` |
| `vec2f` / `vec2i` / `f32` / `i32` | `vec2` / `ivec2` / `float` / `int` |
| `atan2(y, x)` | `atan(y, x)` (two-argument form) |
| `all(abs(v) <= vec2f(h))` | `all(lessThanEqual(abs(v), vec2(h)))` |
| `select(a, b, cond)` | `cond ? b : a` — **note the argument order flips** |
| `i32(uniforms.brushCount)` | `int(brushCount)` — same truncation-toward-zero |
| `fract(x)` | `fract(x)` — identical semantics (`x - floor(x)`), including for negative `x`. Safe to transcribe. |
| `round(x)` | WGSL `round` is round-half-to-even; GLSL `round` is **implementation-defined at .5**. In `texelWorld` and the seam wrap `p -= size*round(p/size)`, ties fall exactly on the window boundary. Use **`floor(x + 0.5)`** in the port for determinism. (Note the CPU uses `Math.round`, which is ties-toward-+∞ — the two only disagree on a measure-zero set, but a flickering seam texel is a nasty bug to chase.) |
| `mat2x2f(c,-s,s,c)` and `v * m` in `lib/noise.wgsl` | GLSL `mat2(c,-s,s,c)` is column-major with the same argument order, and `v * m` is likewise row-vector × matrix. The noise library transcribes **1:1** with no transpose. |
| dynamic loop `for (var i = 0; i < n; i++)` with uniform `n` | legal in GLSL ES 3.00, but prefer `for (int i = 0; i < 96; ++i) { if (i >= n) break; … }` for driver-portability. `continue` is legal. |
| WGSL `#include<snowDeform>` via `ShaderStore.IncludesShadersStoreWGSL` | `THREE.ShaderChunk['snow_deform'] = deformGLSL;` then `#include <snow_deform>` in every one of the five programs. **Do not copy-paste the text into each shader** — the whole point of the include is that the five programs are byte-identical. |
| WebGPU timestamp queries | unavailable. Use `EXT_disjoint_timer_query_webgl2` if present, else CPU-side `performance.now()` around `renderer.render`. Not needed by this subsystem. |
| Storage textures / compute shaders | **not needed** — the reference is already a single full-screen fragment pass. Ping-pong two `WebGLRenderTarget`s and swap. |

### 10.2 Precision — do not "upgrade" to RGBA32F without retuning

The half-float storage is not an accident and its quantisation is *modelled* by the design. If a
port uses `THREE.FloatType` (RGBA32F) instead:

- The ULP argument in §4.6 evaporates, and per-frame decay would then be representable.
- The `RELAX_STEP = 0.4` banking is then no longer *required* for correctness — but keep it anyway,
  because it is also a ~66× reduction in the relax work at 165 fps, and because removing it changes
  the visible decay (the shipped constants are calibrated against banked stepping).
- RGBA32F doubles the bandwidth of a pass that runs every frame and doubles VRAM to 134 MB.

**Recommendation: match the reference — `HalfFloatType`, `RELAX_STEP = 0.4`, constants as shipped.**
IEEE binary16 is bit-identical across WebGPU and WebGL2, so the numerical behaviour transfers exactly.

Also add `precision highp float;` and `precision highp sampler2D;` at the top of the GLSL fragment
stage. `mediump` in the sim pass would be catastrophic: the world coordinates in `texelWorld` and
`p = world - a.xy` need well over 10 bits of mantissa.

### 10.3 The half-texel trap — the single most likely port bug

On any frame with `dt = 0` (the common case — the relax block fires at 2.5 Hz while the pass runs at
frame rate) the pass reduces to *copy `prevTex` at `uv`, then splat*. That copy is **lossless only if
`uv` lands exactly on a texel centre**, `(i + 0.5) / res`.

- Babylon's `ProceduralTexture` full-screen quad interpolates `vUV = position·0.5 + 0.5`, which is
  exactly that at each fragment centre.
- In the port, compute `vec2 uv = gl_FragCoord.xy / res;` — at fragment centres `gl_FragCoord.xy` is
  `(i + 0.5, j + 0.5)`, so this is exact — or use a full-screen triangle with the equivalent varying.
- **Belt and braces:** fetch the centre and the four Laplacian neighbours with `texelFetch` and manual
  toroidal wrapping:
  ```glsl
  ivec2 P = ivec2(gl_FragCoord.xy);
  int R = int(res);
  vec4 c  = texelFetch(prevTex, P, 0);
  vec4 xl = texelFetch(prevTex, ivec2((P.x + R - 1) % R, P.y), 0);
  // …etc
  ```
  but **keep the upwind tap as a filtered `textureLod`**, because its offset of 1.6 texels is
  deliberately fractional and its bilinear interpolation is part of the advection scheme.
- Symptom if you get this wrong: everything decays to nothing within a second or two, and no amount
  of retuning τ in §4.6 fixes it.

Related: the render viewport must be exactly `res × res` with no scissor and no MSAA. Any resolve or
scale re-filters the buffer every frame.

### 10.4 Feedback-loop safety

Never bind the same texture as both sampler and colour attachment. The ping-pong guarantees this if
`_write` is flipped **after** `render()`, not before. Assert `pt !== prev` in debug builds; WebGL2
will otherwise produce undefined results rather than an error on most drivers.

### 10.5 Vertex texture fetch

The displacement is entirely vertex-side: 9 taps of the binomial in `deformHeight`, plus 4 bilinear
taps for the bicubic height fetch and the aux fetch, per vertex, for a mesh of ~333k triangles.
WebGL2 guarantees `MAX_VERTEX_TEXTURE_IMAGE_UNITS >= 16`, so this is available everywhere, but it is
not free — the `deformFalloff` early-out (`if (w <= 0.0) return 0.0;`) and the `spacing < 1.0` gate
are what keep it cheap. **Port both gates before profiling.**

### 10.6 Shadow cascades in Three.js

Three's built-in `DirectionalLightShadow` cannot drive a custom vertex program that displaces from a
data texture the way this needs (and `customDepthMaterial` does not cover a hand-rolled cascade rig).
Do what the reference does: hand-roll three cascade render targets (2048², splits 26 / 95 / 330 m),
three materials sharing the same injected `snow_deform` chunk and the same clipmap chunk, and render
the terrain mesh into each with the matching `lightViewProjection`. The mandatory invariant is:

> the `spacing < 1.0` gate, the `smoothstep(0.5, 1.0, spacing)` fade and the `spacing` passed as the
> filter width must be **character-for-character identical** in the beauty vertex shader, all three
> cascade vertex shaders and the prepass vertex shader.

If they differ, the terrain shadows against a surface it is not drawing, and every berm acnes.

### 10.7 Uniform-array alternative to the brush texture

If you would rather avoid a float `DataTexture`: 96 brushes × 3 rows = 288 `vec4` = 1152 floats. That
**exceeds** the guaranteed `MAX_FRAGMENT_UNIFORM_VECTORS` minimum of 224, so a plain uniform array is
not portable. A **UBO** works (`MAX_FRAGMENT_UNIFORM_BLOCK_SIZE` minimum is 16 KB, and 288 vec4 =
4608 B), and Three.js r172 supports `THREE.UniformsGroup`. The data texture is still recommended for
parity with the reference and because `texelFetch` indexing is unconditionally dynamic-index-safe.

### 10.8 Miscellaneous

- `dpdx/dpdy` → `dFdx/dFdy` (fragment only) for the `footprint` / `footprintMin` computation the
  fragment read path depends on.
- Babylon's `Vector2.y` carries **world Z** throughout this subsystem. Keep the convention or rename
  consistently; mixing them produces a deformation window that follows the player in the wrong axis
  and is surprisingly hard to see.
- The reference's `whenReady()` polls `isReady()` with a **25 s** timeout before declaring a shader
  compile failure. The Three.js equivalent is `renderer.compileAsync(scene, camera)` before the first
  frame; do the equivalent two-pass zeroing warm-up (§4.2) regardless, because a freshly allocated
  RT's contents are not guaranteed and a NaN read as a height destroys a vertex position.

---

## 11. VISUAL ACCEPTANCE CRITERIA

A harsh critic should be able to decide from screenshots (and one 60-second timed pair) whether the
port reproduced this subsystem. These are the deliverable.

1. **A walked trail is a line of countable prints, not a ribbon.** After walking 20 m and stopping,
   individual boot prints are individually distinguishable — each roughly **20 cm across and 34 cm
   long**, oriented along the direction of travel — sitting inside a *shallower, wider, continuous*
   scuff. If the trail reads as one uniform ski-track groove, the body-drag brush is too deep or the
   compression is saturating the print's contrast away.

2. **Every print has a raised, brighter rim.** A ring of displaced mass peaks at about **1.04 print
   radii** from the centre, is visibly **brighter and no less blue** than undisturbed snow (loose
   albedo 0.895/0.920/0.965 against base 0.855/0.885/0.945), and reads as *piled material*, not as a
   bright outline. A trail whose rim is grey, warm, or merely a lighter shade of the trench floor has
   lost the G channel's material response.

3. **The rim is irregular and the berm is granular, and no two prints match.** The rim radius wobbles
   by up to **±22%** with roughly **17 lobes** around the circumference, and the berm has visible
   granularity at about **0.13 × radius** (≈1.3 cm for a boot). Consecutive prints in a line have
   visibly *different* silhouettes — if they are identical stamps, the position-hash seed
   (`(x·0.37 + z·0.71) mod 100`) is not reaching the shader.

4. **A carve is asymmetric.** Hold a hard right turn: the wall of snow on the **left** (outside of the
   turn) is visibly taller and heavier than the one on the right, and the trench itself is offset
   slightly toward the lean. A symmetric furrow means `carve` sign handling or the `sideL/sideR`
   weights are wrong.

5. **Trench floor dark, walls bright.** The surf groove's floor is distinctly **darker and glossier**
   than surrounding snow (compression → albedo 0.62/0.665/0.755, roughness 0.34), while the two walls
   are brighter and rougher. The light-rim / dark-core contrast is the whole read of the mark; a
   uniformly-dark or uniformly-bright trench has lost either B or G.

6. **Carved snow self-shadows.** At the shipped 13° sun, the far wall of a fresh groove casts a real
   shadow onto the trench floor, and a berm crest occludes ground behind it. Toggling the deformation
   off must change the **shadow map**, not only the shading. Diagnostic: a trail viewed with the sun
   behind it should show shadow *inside* the depression, not just a darker diffuse response.

7. **Berms break the silhouette.** Viewed from near ground level along a fresh surf run, berm crests
   are visible as bumps against the sky / distant terrain — proof the displacement is geometry, not a
   normal-map trick. In wireframe, the clipmap triangles visibly bend along the trench.

8. **No faceting and no swimming under camera motion.** Orbit and zoom the camera fully across a
   stationary trail. The groove stays smooth; it must **not** break into triangular facets, and the
   trail must not change shape as a clipmap ring boundary sweeps over it. (This is the binomial
   filter working; the failure mode is a row of triangular peaks that slide with the camera.)

9. **Toroidal window: smooth fade, no seam, no ghost copy.** Run 80+ m in a straight line. The trail
   behind you fades out smoothly beginning about **32 m** from the player and is fully gone by about
   **38 m**. There must be no hard straight-line edge dragging across the field, and no wrapped-around
   copy of your own trail appearing 80 m ahead of you.

10. **~71% survives 60 seconds, and the mark visibly *spreads* while it fades.** Stamp a trail, stand
    still, screenshot at t=0 and t=60 s. The trench is still clearly a trench, at roughly **70% of its
    original depth**, and measurably **wider and softer** than at t=0. The berm crest has flattened
    noticeably more than the trench floor has (berm loses ~21% to decay and spreads ~1.2 texels;
    the floor loses ~14% and spreads ~0.7 texels — the **3:1 anisotropy** should be apparent as the
    rim rounding off while the floor stays a floor). If the mark is gone in ten seconds, you have the
    half-float ULP bug (§4.6) or the half-texel copy bug (§10.3).

11. **Narrow marks heal faster than wide ones.** In the same 60 s test, a footprint (≈0.2 m wide)
    softens visibly more than an adjacent surf groove (≈0.6 m wide). Uniform fading of both means the
    diffusion term is not scale-dependent — i.e. someone replaced the Laplacian with a flat multiply.

12. **Ice is the permanent one; the depression is not.** Cast Crystallise, then wait a minute. The
    glaze under the formation is still plainly there — dark blue-shifted (0.42/0.56/0.70) and sharply
    specular (roughness 0.07) — while the depression around it has visibly healed further. Ice must
    also not saturate: casting Ribbon repeatedly over the same ground must not turn the snow into a
    mirror (the ice channel is a `max`, not a sum).

13. *(bonus check on the negative-write path)* **Vortex is the only thing that gives snow back.**
    While held, a ring around the player is stripped; while it fades, the ring **retreats inward** and
    the ground refills from the outside in, ending slightly **proud** (loose berm) rather than flat.
    If the ground ends as a permanent pit, the give-back's negative depression is being clamped away
    or the give branch is not firing.

---

## 12. Constant ledger

Every distinct numeric constant captured by this spec, by section. Counts are the number of distinct
bound values (a colour triple counts once, a min/max pair counts once).

| Section | Contents | Count |
|---|---|---|
| **A. Window geometry & resources** (§1, §2) | COVERAGE 80 m; RES 2048; RES floor 512; balanced RES 1024; texel 0.0390625 m; half-window 40 m; MAX_BRUSHES 96; BRUSH_ROWS 3; 4 floats/entry; 1152-float array; 4608-byte upload; 2 targets; 8 B/texel; 33.55 MB/target; 67.1 MB total; RELAX_STEP 0.4 s; relax cadence 2.5 Hz; maxDepth coeff 0.55; maxBerm coeff 0.34; CPU cull margin ×2; seed coeffs 0.37 / 0.71 / mod 100; warm-up passes 2; warm-up far offset 1e6; π/180 | **26** |
| **B. Relax stage** (§4.3–4.6) | 1/res tap; Laplacian centre 4.0; kDep 0.004/s; kBerm 0.012/s; ratio 3; diffusion cap 0.22; stability limit 0.25; k clamp 1.0; upwind 1.6 texels; kAdv 0.002/s; kAdv cap 0.2; dep advection 0.6; slump 0.002/s; slump cap 0.6; τ 400 / 250 / 300 / 900 s; four half-lives; four 60-s survival fractions; dep+slump 76.3%; README 71%; effective τ 175 s; diffusion lengths 0.69 / 1.20 texels | **31** |
| **C. Splat stage** (§4.7) | reach ×1.6; reject 1.55; wobble amp 0.22; wobble freq 2.7; ≈17 lobes; core 0.42 → 1.0; ring centre 1.04; ring width 3.4; σ 0.208; FWHM 0.49r; truncation 4.9%; grain base 0.72; grain amp 0.56; range 0.72–1.28; grain freq 7.5; seed mult 3.1; B/A clamps 0..1 | **18** |
| **D. Read side & consumers** (§5, §6) | falloff 0.80 / 0.96 (32 m / 38.4 m); binomial 1/16; weights 1,2,1; 9 taps; tap offset = spacing; first zero 2×spacing; 85.4% at 8×; gate spacing < 1.0; dfade 0.5 → 1.0; prepass ε 0.001; fragment ε 0.001; BASE_SPACING 0.085; LEVELS 8; GRID_HALF_N 80; morph 0.70 / 0.16; cascades 3 @ 2048²; splits 26/95/330; shadow bias 0.022 / softness 1.8 | **18** |
| **E. Fragment material response** (§7) | step floor ×2.0; footprintMin ×1.4; wide divisor 4.0; wide weight 0.8; 5-tap 0.2; base albedo (0.855,0.885,0.945); base roughness 0.62; base f0 0.028; comp albedo (0.62,0.665,0.755) @0.85; comp roughness 0.34; comp thickness 0.35; detail damp 0.45; ice albedo (0.42,0.56,0.70) @0.8; ice roughness 0.07; ice f0 0.045; ice thickness 0.15; berm ε 0.002; loose gain 5.0; loose albedo (0.895,0.920,0.965) @0.55; loose roughness 0.78 @0.7; loose thickness @0.6; chunk freq 34.0; chunk darkening 0.10; ao gain 1.9 @0.38; caveTint (0.55,0.72,1.0) @0.95; debug scales 2.5/5.0/0.6; B/R ratios 1.105 / 1.078; sun elevation 13°; wind bearing 42° | **30** |
| **F. Character brushes** (§9.1) | BOOT_WIDTH 0.10; BOOT_ELONG 1.7; print 0.20×0.34; impact cap 1.3 / base 0.35 / divisor 5.4; foot depth 0.17+0.14; foot berm 0.10+0.08; foot comp 0.9; foot edge 1.0; surf gate 0.02; walk gate 0.98; walk speed 0.25; walk cap 0.35; walk radius 0.22; walk depth 0.20; walk berm 0.22; walk comp 0.8; walk elong 1.5; walk edge 0.85; SURF_WIDTH 0.30; SURF_ELONG 2.6; speedK ÷6; speedK gate 0.05; k cap 0.6; fast offset 6 / ÷12; lean offset 0.12; radius gain 0.35; groove depth 1.20; groove berm 0.30; groove comp 4.0; groove edge 0.55; side offset 1.5 + 0.5·fast; side radius 0.95; throwK 0.75; outside 0.55 + 0.9; fast gain 0.5; doubling 2.0; side elong ×0.8 | **44** |
| **G. Spell brushes** (§9.2–9.6) | Sweep 11; Ribbon score 12; Ribbon impact 16; Bloom crater 16; Crystallise 24; Vortex 19 | **98** |
| **H. Documented half-float diagnostics** (§4.6) | 11-bit significand; ULP 4.9e-4; 2^-11 = 4.88e-4; target 1.5e-5; 0.999985/frame; ~8%/s pathological; ~10 s half-life; 165 fps ref; 140 fps ref; 8400 applications/min; 1e-3 relative step; 2-ULP margin; design D 0.05/s; design spread 2.5 texels / 8 cm | **14** |
| | **TOTAL** | **279** |
