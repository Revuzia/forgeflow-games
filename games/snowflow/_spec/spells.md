# SNOWFLOW — Spell Subsystem Implementation Spec

**Scope:** the five spells, the shared water body, the ice crystals, the four-slot dynamic
light pool, and refraction-without-a-scene-copy.

**Source of truth:** `snowflow_demo/src/spells/*.js`, `src/shaders/water.{vertex,fragment}.wgsl`,
`src/shaders/crystal.{vertex,fragment}.wgsl`, `src/shaders/lib/{water,crystal,spellLights,wake}.wgsl`.

**Target:** Three.js r172 / WebGL2 / hand-written GLSL 3.00 es.

Every number in this document is transcribed verbatim from the reference. Units are noted.
Section 15 is the WebGL2 porting delta. Section 16 is the visual acceptance test.
Section 17 is the full constant table.

---

## 1. System overview

### 1.1 What the subsystem is

Five spells, bound to keys `1`–`5`. Key `2` (Ribbon) is a **held** cast; the other four are
edge-triggered.

| Key | Spell | Renders as | Writes terrain? | Declares light? |
|---|---|---|---|---|
| 1 | Sweep | 1 water strand, SHEET profile | yes (channel + berms) | yes, 1 |
| 2 | Ribbon | 1 water strand, TUBE profile | yes (thin scores + splash) | **no** |
| 3 | Bloom | 1 water strand, TUBE profile | yes (crater + rim ring) | yes, 2 |
| 4 | Crystallise | N ice prisms (separate mesh) | yes (glaze + per-prism) | yes, 1 |
| 5 | Vortex | 3 water strands, TUBE profile | yes, **negative depression** | yes, 1 |

Four of the five (Sweep, Ribbon, Bloom, Vortex) are *structurally identical*: a swept surface
along a spine, with a per-sample radius, a parallel-transported reference frame, a twist, and a
foam channel. They differ only in what generates the spine and what the envelopes are.

Crystallise is the odd one out: it is not a swept surface at all, it is a pool of hexagonal
prisms in a second data-driven mesh with its own material.

### 1.2 Ownership graph

```
SpellSystem
 ├── SpellLights          4-slot pooled dynamic light array (CPU-side, 2 Float32Arrays)
 ├── WaterBody            1 mesh, 1 material, 1 draw, 8 strands
 ├── CrystalField         1 mesh, 1 material, 1 draw, 96 prisms
 └── spells[5]            Sweep, Ribbon, Bloom, Crystallize, Vortex
```

`SpellContext` — the single struct every spell reads (`spellSystem.js:38-52`):

```
{
  controller,          // CharacterController: .position (Vector3), .facing (rad),
                       //   .cast, .castAimX/Y/Z written back by the system
  figure,              // Figure|null: .handPosition(which, out, off)
  rig,                 // CameraRig: .forward, .right, .up (Vector3),
                       //   .camera.position, .addTrauma(amount)
  terrain,             // .heightAt(x, z) -> metres   (CPU mirror of the GPU heightfield)
  deform,              // DeformationField: .brush(...)
  spray,               // SprayField: .emit(...)
  water,               // WaterBody
  crystals,            // CrystalField
  lights,              // SpellLights
  time,                // seconds since SpellSystem construction, monotonic
  sprayScale,          // S.spellSpray, default 1.0
  handPosition,        // (which, out, off) => void   -- forwards to figure, or falls back
}
```

### 1.3 Per-frame update order — LOAD-BEARING

`SpellSystem.update(dt, cameraPos)` runs in exactly this order, and the order is a correctness
requirement, not a style choice (`spellSystem.js:1-20, 156-193`):

```
1.  _time += dt;  ctx.time = _time;  ctx.sprayScale = S.spellSpray;  lights.scale = S.spellLight
2.  aim.copyFrom(rig.forward)
3.  lights.begin()                      // count = 0. MUST be before the spells run.
4.  if (S.showSpells !== false) _dispatch()  else  _cancelAll()
5.  for each spell: spell.update(dt)    // spells declare lights and write brushes HERE
6.  castBlend easing -> controller.cast, controller.castAimX/Y/Z
7.  for each registered consumer material: lights.apply(mat)   // AFTER the last declaration
8.  water.update(dt, cameraPos)         // uploads the strand table + pushes uniforms
9.  crystals.update(dt, cameraPos)      // ages the pool + uploads
```

Two hard constraints:

* **Lights cleared before, uploaded after.** If the pool were uploaded before the spells ran,
  a spell that ended last frame would keep lighting the snow for one more frame.
* **`SpellSystem.update()` must be called BEFORE `terrain.update()`.** The deformation
  simulation pass consumes the brush queue for the frame; spells write brushes during step 5,
  so they must land before the sim runs. In `main.js` the call order is
  `character contact → spells.update() → terrain.update()`.

### 1.4 Input dispatch

`_dispatch()` (`spellSystem.js:195-202`):

```
holdRibbon(input.spellHeld2 || debugRibbon)   // polled, not edge-triggered
key = input.spellPressed                       // 1..5, cleared each frame by the input module
if (key && key !== 2) cast(key)
```

`cast(key)` (`spellSystem.js:212-260`):

* `key === 2` → `holdRibbon(true)`, return (no `_lastCast` update via this path).
* otherwise `_lastCast = _time`.
* `key === 1` (Sweep): flatten the aim —
  `fl = hypot(aim.x, aim.z) || 1; sweep.trigger(aim.x/fl, aim.z/fl); rig.addTrauma(0.12)`.
  Flattening is required: a camera pointed at the sky must not launch the crescent upward.
* `key === 3 || key === 4` (Bloom / Crystallise): ground-target from the **eye**, not the hand:
  ```
  aimPoint(_aim, terrain, eye.x, eye.y, eye.z, aim.x, aim.y, aim.z,
           maxDist = 22, fallback = 13)
  ```
  22 m ray cap (the terrain could answer 40); beyond the cap the spell lands at the *fallback*
  distance 13 m in the flattened aim direction, dropped onto the surface.
* `key === 5` (Vortex): `vortex.trigger(); rig.addTrauma(0.10)`.

`holdRibbon(held)`: on rising edge `ribbon.trigger(); _lastCast = _time`. On falling edge
`ribbon.release()`.

### 1.5 Casting pose feedback

```
casting  = (ribbon.active || (_time - _lastCast) < 0.55) ? 1 : 0
castBlend = expDamp(castBlend, casting, casting ? 7.0 : 3.2, dt)
controller.cast      = castBlend
controller.castAimX/Y/Z = aim.xyz
```

`expDamp(cur, target, rate, dt) = target + (cur - target) * exp(-rate * dt)`.
Ease-in rate 7.0 s⁻¹, ease-out rate 3.2 s⁻¹, hold window 0.55 s after a cast.

### 1.6 Hand position fallback

When the figure is hidden (`S.showCharacter === false`) or absent, `_handPosition` synthesises
a point in front of the chest (`spellSystem.js:137-150`):

```
fx = sin(facing);  fz = cos(facing)
side = (which === 0) ? -0.28 : +0.28          // 0 = left hand, 1 = right hand
out[0] = pos.x + fx*0.35 + cos(facing)*side
out[1] = pos.y + 1.25
out[2] = pos.z + fz*0.35 - sin(facing)*side
```

Only the Ribbon uses `handPosition`, and it always requests hand `1` (right).

---

## 2. Shared bending primitives (`spells/bending.js`)

Zero-allocation helpers every spell shares.

```
clamp01(v)              = v<0 ? 0 : v>1 ? 1 : v
clampRange(v, lo, hi)
smooth01(t)             x = clamp01(t);  return x*x*(3 - 2*x)          // Hermite smoothstep
bell(t)                 x = clamp01(t);  s = sin(PI*x);  return s*s    // sin², 0 at both ends
expDamp(cur,target,rate,dt) = target + (cur-target)*exp(-rate*dt)
```

`bell()` is *the* amplitude envelope in this subsystem. Every arc, every crescent horn, every
helix taper uses it. A linear ramp leaves a visible corner at both ends; `sin²` has zero slope
at 0 and 1.

### 2.1 Parallel transport — `transport(out, o, r, t0, t1)`

Rotates reference vector `r` by the **minimal rotation taking tangent `t0` to tangent `t1`**.
This is what stops the swept section from spinning as the spine curves, and it has no
degeneracy — unlike the Frenet frame (undefined on straight spans, flips 180° at every
inflection, and a figure-eight has two by definition) and unlike an up-referenced frame
(degenerate wherever the spine passes through vertical, which a thrown ribbon does constantly).

```
a = cross(t0, t1)
s = |a|
if (s < 1e-7) { out = r; return }              // parallel: frame carries over unchanged
a /= s
c   = dot(t0, t1)
ang = atan2(s, c)
cs = cos(ang);  sn = sin(ang)
// Rodrigues
dot_ = dot(a, r)
cx   = cross(a, r)
o    = r*cs + cx*sn + a*dot_*(1 - cs)
out  = o / (|o| || 1)                          // renormalised
```

**Note the `atan2(s, c)` rather than `acos(c)`** — it is stable across the full angle range.

### 2.2 Ground ray — `groundRay(terrain, o, d, maxDist)`

Coarse march + bisection refine against the CPU height mirror.

```
STEP = 0.6                     // metres per coarse step
prevAbove = o.y - heightAt(o.x, o.z)
if (prevAbove < 0) prevAbove = 0.001          // started buried: treat as above,
                                              //  so the ray exits the drift and hits the far side
for (t = STEP; t <= maxDist; t += STEP):
    above = (o.y + d.y*t) - heightAt(o.x + d.x*t, o.z + d.z*t)
    if (above <= 0):
        lo = prevT; hi = t
        repeat 8 times:                       // 8 bisections -> hit inside ~1 cm at STEP=0.6
            mid = (lo+hi)*0.5
            if ((o.y + d.y*mid) - heightAt(o.x + d.x*mid, o.z + d.z*mid) > 0) lo = mid
            else hi = mid
        return (lo+hi)*0.5
    prevT = t
return -1                                     // miss
```

### 2.3 Aim point — `aimPoint(out, terrain, o, d, maxDist, fallback)`

```
t = groundRay(...)
if (t > 0) { out = o + d*t; return t }
// miss: flatten the direction and step out, then drop onto the surface
fl = hypot(d.x, d.z) || 1
out.x = o.x + (d.x/fl)*fallback
out.z = o.z + (d.z/fl)*fallback
out.y = heightAt(out.x, out.z)
return fallback
```

Called with `maxDist = 22`, `fallback = 13` for both Bloom and Crystallise.

---

## 3. The shared water body — CPU side (`spells/waterBody.js`)

### 3.1 The invariant

> **One water material, one mesh, one draw, eight strands.** A strand that is not in use is
> switched off by zeroing its rows. Radius 0 collapses every vertex of that strand onto a single
> point, so its triangles have zero area and the rasteriser produces no fragments. The draw call
> and the vertex count therefore do not depend on how many spells are up.

### 3.2 Sizing constants

| Identifier | Value | Meaning |
|---|---|---|
| `STRAND_MAX` | **8** | strands; must match `array<vec4f, 8>` in the vertex shader |
| `STRAND_COLS` | **64** | spine **samples** per strand = width of the data texture |
| `LATTICE_COLS` | **176** | spine **vertices** per strand = width of the lattice |
| `RING` | **24** | vertices around the section; last coincides with first |
| `PROFILE_TUBE` | **0** | closed tube |
| `PROFILE_SHEET` | **1** | open breaking sheet (borrows the wake's section integral) |

**Why 64 samples, not 48.** Raised for the Vortex, whose helices are the tightest curve drawn.
A cubic through samples on a circular arc carries radial error that is zero at every knot and
peaks mid-span — a scallop per sample. On a 12 cm tube wound round a 2.5 m helix at 30
samples/turn that was ~10% of the radius ("vertebrae"). Error falls with the square of sample
spacing; 64 puts it under 1%.

**Why 176 lattice columns, not ~64.** The surface is a *spline* through the samples, so it has
real curvature between them. Drawing at ~1 vertex/sample renders that curvature as a polygon and
the body reads as pipe. ~2.75 vertices per sample is where segmentation stops being findable.

**Why 24 ring vertices, not 12.** A 12-sided tube at 2 m has a readable dodecagonal silhouette.
24 also caps how much detail the relief field may put *around* the section — and detail around
the section (rather than along it) is what stops a tube reading as a string of beads.

### 3.3 Lattice construction (baked once at load)

`buildLattice(scene)` — attribute `position` carries **no geometry**, only indices:

```
perStrand = LATTICE_COLS * RING                      = 176 * 24 = 4224 vertices
positions = Float32Array(perStrand * STRAND_MAX * 3) = 4224 * 8 * 3 = 101,376 floats
indices   = Uint32Array((LATTICE_COLS-1) * (RING-1) * 6 * STRAND_MAX)
          = 175 * 23 * 6 * 8 = 193,200 indices = 64,400 triangles

for s in 0..7:
    base = s * perStrand
    for c in 0..175:
        for r in 0..23:
            position = (c, r, s)                     // vec3: (column, ring, strand)
    for c in 0..174:
        for r in 0..22:
            a = base + c*RING + r
            b = a + RING
            emit (a, b, b+1) and (a, b+1, a+1)
```

Total: **33,792 vertices, 64,400 triangles** in one buffer, one draw.

Mesh flags: `alwaysSelectAsActiveMesh = true`, `isPickable = false`, `freezeWorldMatrix()`,
`doNotSyncBoundingInfo = true`. (Bounding info is meaningless — positions are indices.)

### 3.4 The strand data texture

```
format      RGBA32F  (TEXTURETYPE_FLOAT)
filtering   NEAREST (both min and mag)
wrap        CLAMP on U and V
width       STRAND_COLS      = 64
height      STRAND_MAX * 3   = 24
backing     Float32Array(64 * 24 * 4) = 6144 floats = 24,576 bytes
```

**Row convention — strand `s` occupies rows `3s`, `3s+1`, `3s+2`:**

| Row | `.r` | `.g` | `.b` | `.a` |
|---|---|---|---|---|
| `3s + 0` | world X (m) | world Y (m) | world Z (m) | **radius** (m) |
| `3s + 1` | rightX | rightY | rightZ | **twist** (rad) — section roll (tube) or *curl* (sheet) |
| `3s + 2` | **dist** along spine (m) | **age** 0..1 | **foam** 0..1 | **flatten** (1 = round) |

Column 0 is always the **head / leading edge**. `u` therefore always means "distance behind the
leading edge", for every strand in the project. This is not a per-spell convention — Bloom's
column 0 is the top of the column, Vortex's column 0 is the top of the helix, Ribbon's column 0
is the live tip, Sweep's column 0 is one horn of the crescent.

The reference right vector `rx/ry/rz` does **not** have to be exactly perpendicular to the
tangent (the shader re-orthogonalises) but it **must be parallel-transported**.

Radius must taper to ~0 at both ends of any strand, or the tube shows an open section as a disc
of backface.

### 3.5 Per-strand uniform

```
strandParams[s] = vec4(profile, milkiness, alpha, columnCount)
```

* `profile` — 0 = tube, 1 = sheet
* `milkiness` — 0 = clear water, 1 = opaque slush (an *opaque diffuse population inside the body*,
  not a colour)
* `alpha` — global fade; 0 hides the strand
* `columnCount` — live columns, clamped: `count < 2 ? 0 : min(count, 64)`

Backing store: `Float32Array(STRAND_MAX * 4)` = 32 floats, uploaded whole every frame.

### 3.6 Pool API

```
acquire()  -> first index with _used[i]==false, marks used, calls clear(i); -1 if exhausted
release(s) -> _used[s] = false; clear(s)
clear(s)   -> zero the strand's 3*64*4 floats in _texData AND its 4 params
setParams(s, profile, milkiness, alpha, count)
column(s, c, x,y,z, radius, rx,ry,rz, twist, dist, age, foam, flatten)
```

`column()` addressing (`waterBody.js:241-252`):

```
row = s * 3
w   = STRAND_COLS * 4          = 256
o   = row*w + c*4
d[o+0..3] = (x, y, z, radius)
o += w;  d[o+0..3] = (rx, ry, rz, twist)
o += w;  d[o+0..3] = (dist, age, foam, flatten)
```

Guard: `if (c < 0 || c >= STRAND_COLS) return`.

### 3.7 Per-frame update

```
_t += dt
live = count of strands with (params[i*4+2] > 0.003 && params[i*4+3] >= 2)
mesh.isVisible = live > 0 && S.showSpells !== false
if (!visible) return                          // nothing uploaded, no uniforms pushed
dataTex.update(_texData)                      // one 24 KB upload
_pushUniforms()
```

Triangle accounting for the overlay: `(live / STRAND_MAX) * mesh.metadata.triangles`.

### 3.8 Material state

```
vertex/fragment       "water"
attributes            ["position"]
samplers              waterTex, skyLUT, cascade0, cascade1, cascade2
backFaceCulling       false          // a transparent body seen from both sides:
                                     //  looking through the near wall at the far one
                                     //  is most of what makes it read as a volume
disableDepthWrite     true
alphaMode             ALPHA_COMBINE  (src*a + dst*(1-a))
needAlphaBlending     () => true
renderingGroupId      2              // with the spray, after the opaque pass
alphaIndex            0              // water FIRST within group 2:
                                     //  mist in front of water is commoner than the reverse,
                                     //  and neither writes depth
waterCols  = LATTICE_COLS = 176      // set once
waterRings = RING         = 24       // set once
```

Per-frame uniforms (`_pushUniforms`): `cameraPos`, `waterTime` (= `_t`), `strandParams[8]`,
`sunDir`, `sunRadiance`, `shR[9]`, `cascadeMatrices[3]`, `cascadeSplits`, `cascadeParams[3]`,
`shadowTexel`, `shadowSoftness = 1.4`, `shadowBias = 0.03`, `fogDensity`, `fogHeightFalloff`,
`fogStart`, `aerialStrength`, `ambientIntensity`, `sssStrength`, `glintIntensity`,
`glintGrazing`, `waterDepthTint`, plus the three spell-light uniforms.

**Water shadow params differ from the crystals': softness 1.4 / bias 0.03 for water,
softness 1.3 / bias 0.012 for ice.**

### 3.9 Warm-up (pipeline pre-compilation)

Two synthetic strands are laid **and left standing** through the warm-up frames, then taken down
by `finishWarmUp()` after `main` has rendered 3 real frames.

```
strand 0 — TUBE:
  for c in 0..23:  t = c/23
    column(0, c, x + t*3, y + 1.2 + sin(t*3)*0.5, z,
           radius = 0.22*sin(t*PI),
           right = (0,0,1), twist = 0,
           dist = t*3, age = t, foam = (t<0.2 ? 1 : 0), flatten = 1)
  setParams(0, PROFILE_TUBE, milk 0.2, alpha 1, count 24)

strand 1 — SHEET:
  for c in 0..23:  t = c/23
    column(1, c, x + t*4 - 2, y, z + 2,
           radius = 0.5*sin(t*PI),
           right = (0,0,1), twist = 0.6,
           dist = t*4, age = t, foam = 0.4, flatten = 1)
  setParams(1, PROFILE_SHEET, milk 0.6, alpha 1, count 24)
```

Both profiles are exercised because they are different code paths through one vertex shader.
`isReady()` compiles the shader *modules*; the render *pipeline* (blend state, depth state, cull
mode, target formats) is only built when a triangle actually goes through it. Hiding the mesh
during warm-up moved a ~250 ms hitch onto the first cast.

---

## 4. The swept-surface evaluator — `shaders/lib/water.wgsl`

### 4.1 Texel fetch

```wgsl
fn waterTexel(tex: texture_2d<f32>, row: i32, col: i32) -> vec4f {
    return textureLoad(tex, vec2i(col, row), 0);
}
```

Unfiltered integer fetch. **Note the argument order is (row, col) but the texel coordinate is
`vec2i(col, row)`.**

### 4.2 Catmull-Rom row interpolation

```wgsl
fn waterRow(tex: texture_2d<f32>, row: i32, count: f32, u: f32) -> vec4f {
    let n = max(count, 2.0);
    let f = clamp(u, 0.0, 1.0) * (n - 1.0);
    let i1 = i32(floor(f));
    let fr = f - f32(i1);
    let last = i32(n) - 1;

    let p0 = waterTexel(tex, row, max(i1 - 1, 0));
    let p1 = waterTexel(tex, row, i1);
    let p2 = waterTexel(tex, row, min(i1 + 1, last));
    let p3 = waterTexel(tex, row, min(i1 + 2, last));

    let t2 = fr * fr;
    let t3 = t2 * fr;
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * fr
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    );
}
```

Standard uniform Catmull-Rom basis, coefficient `0.5`. End knots are **clamped** (duplicated),
not wrapped.

**Why Catmull-Rom and not smoothstep.** Smoothstep is C1 but its derivative is *zero at every
knot*. Difference a normal out of a surface whose radius is interpolated that way and the shading
picks up a ripple at exactly the sample pitch — one horizontal ring per spine sample, so a column
reads as a stack of discs. Catmull-Rom's tangent at a knot is the chord through its neighbours,
so the interpolant carries straight through.

`waterSpine()` is the identical function on `base` row `.xyz`.

### 4.3 Analytic spline tangent — NOT a finite difference

```wgsl
fn waterSpineTangent(tex, base, count, u) -> vec3f {
    // ... same p0..p3 fetch, same f/i1/fr/last ...
    let d = 0.5 * (
        (-p0 + p2)
        + 2.0 * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * fr
        + 3.0 * (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * fr * fr
    );
    let l = length(d);
    return select(vec3f(0.0, 1.0, 0.0), d / l, l > 1e-7);
}
```

The exact derivative of `waterSpine` w.r.t. the *local* parameter (the `(n-1)` chain factor is
omitted — irrelevant after normalisation). Sampling the spline a fraction of a knot spacing away
would give a *chord*, and the chord error depends on where inside the knot span it starts, so the
frame would wobble with a period of exactly one spine sample and scallop the tube at every knot.

Degenerate fallback `(0,1,0)` fires only where the spine has collapsed (a retiring tail, or the
frames right after a spell ends).

### 4.4 Surface relief — band-limited in PARAMETER space

```wgsl
fn waterRelief(u: f32, theta: f32, t: f32) -> f32 {
    let c = vec2f(cos(theta), sin(theta));
    return noise2(c * 0.85 + vec2f(u * 4.0 - t * 1.6, u * 2.3)) * 0.60
         + noise2(c * 1.50 + vec2f(u * 7.5 + 11.3, -u * 5.1 - t * 3.1)) * 0.40;
}

fn waterReliefOpen(u: f32, v: f32, t: f32) -> f32 {
    return noise2(vec2f(u * 4.0 - t * 1.6, v * 2.60)) * 0.60
         + noise2(vec2f(u * 7.5 - t * 3.1, v * 4.40 + 11.3)) * 0.40;
}
```

Three rules encoded here, all of them load-bearing:

1. **Frequencies are in cycles per strand, not per metre.** The lattice carries a fixed vertex
   count along the spine whatever the strand is doing, so what the displacement field may contain
   is fixed in parameter space too. Keying to world distance means the frequency *in samples*
   depends on how long the strand happens to be — a 6 m column at 13 cells/m lands at half a
   sample per cell, far past Nyquist, where the field produces a **beat**, not detail.

2. **Section frequencies are HIGHER than spine frequencies.** Gradient noise sampled with a fast
   first coordinate and a slow second is nearly one-dimensional in the first, so relief that
   varies quickly along the spine and slowly around the section produces a ring bulge at every
   cell — a string of beads. Water varies far more *across* a stream than along one.

3. **Sampled around a CIRCLE, not along `theta`.** A tube is closed: ring 0 and ring 23+1 are the
   same point at θ and θ+2π, and plain 2D noise is not periodic, so feeding the angle in directly
   gives two different answers there — a hairline crease running the whole length of every tube.
   Walking a circle `(cos θ, sin θ)` through the noise field makes the function periodic by
   construction.

   **Circle radii set feature count around the section:** a radius-`r` circle has a circumference
   of `2πr` noise cells. `0.85` → ~5.3 features (≈4.5 vertices per feature), `1.50` → ~9.4
   features (≈2.5 vertices per feature). The `u` offset slides the circle through the field,
   which is what makes the pattern travel along the strand.

Octave weights: **0.60 / 0.40**. Time drift: `-1.6` on the coarse octave, `-3.1` on the fine.

### 4.5 `waterPoint` — the surface

```wgsl
fn waterPoint(tex, base: i32, count: f32, profile: f32, u: f32, q: f32, t: f32) -> vec3f {
    let r0 = waterRow(tex, base,     count, u);   // (pos, radius)
    let r1 = waterRow(tex, base + 1, count, u);   // (right, twist)
    let r2 = waterRow(tex, base + 2, count, u);   // (dist, age, foam, flatten)

    let pos     = waterSpine(tex, base, count, u);
    let radius  = r0.w;
    let dist    = r2.x;
    let flatten = max(r2.w, 0.02);                // floor: never fully degenerate

    let tangent = waterSpineTangent(tex, base, count, u);

    // Re-orthogonalise the transported right vector (interpolation between two
    // transported frames does not preserve the right angle exactly).
    var rgt = r1.xyz - tangent * dot(r1.xyz, tangent);
    let rlen = length(rgt);
    rgt = select(
        normalize(cross(tangent, vec3f(0.0, 0.0, 1.0)) + vec3f(1e-5, 0.0, 0.0)),
        rgt / max(rlen, 1e-8),
        rlen > 1e-5
    );
    let up = cross(tangent, rgt);

    if (profile < 0.5) {
        // ---- closed tube ----
        let theta = q * 6.28318530718 + r1.w;                   // twist rolls the section
        let rel   = waterRelief(clamp(u, 0.0, 1.0), theta, t);
        let rr    = radius * (1.0 + rel * 0.22);                // relief scaled BY radius
        return pos + rgt * (cos(theta) * rr)
                   + up  * (sin(theta) * rr * flatten);
    }

    // ---- open breaking sheet ----
    let sec = wakeSection(q, r1.w);                             // r1.w is CURL here, not twist
    let rel = waterReliefOpen(clamp(u,0,1), q * 3.0, t) * 0.13 * smoothstep(0.1, 0.7, q);
    return pos
        + rgt * ((sec.x + rel) * radius)
        + vec3f(0.0, (sec.y + rel * 0.5) * radius * flatten, 0.0);
}
```

Key facts:

* **`q` means different things per profile.** Tube: angle around the section, `q ∈ [0,1] → θ ∈ [0,2π]`.
  Sheet: height up the face, `q = 0` at the base against the trench, `q = 1` at the tip of the lip.
* **Relief is scaled by the radius** on the tube (`rel * 0.22` of the radius), so a thin trailing
  wisp is not covered in the same centimetre-scale lumps as a metre-wide column.
* **Relief amplitude on the sheet is `0.13`**, faded in by `smoothstep(0.1, 0.7, q)` so the base
  (which is held by the ground) stays clean and the crest (which is free) gathers.
* **The sheet's vertical axis is world +Y, not the transported `up`.** The section stands in the
  vertical plane containing the outward radial. That is what makes a Sweep crescent lie on the
  ground correctly however the frame was transported.
* `flatten` squashes only the `up` component of the tube and only the Y component of the sheet.
  It is what lets one strand be a round airborne tube at its head and a wide shallow sheet where
  it lies over the snow, with no second code path.

### 4.6 The borrowed wake section — `lib/wake.wgsl`

The SHEET profile calls `wakeSection(q, curl)` verbatim. Reproduced in full because Sweep depends
on it and it is not in the spells directory:

```wgsl
const WAKE_STEPS:   i32 = 20;
const WAKE_NORM:    f32 = 3.35;
const WAKE_LATERAL: f32 = 0.70;

fn wakeSection(q: f32, curl: f32) -> vec2f {
    let th0 = -0.24;                     // base flares outward and slightly DOWN
    let th1 = 1.65 + curl * 3.30;        // 95 deg (heap) .. 284 deg (plunging)
    var p = vec2f(0.0, 0.0);
    let dt = q / f32(WAKE_STEPS);
    for (var i = 0; i < WAKE_STEPS; i++) {
        let t = (f32(i) + 0.5) * dt;     // midpoint rule
        let th = th0 + (th1 - th0) * pow(t, 1.65);
        p += vec2f(cos(th), sin(th)) * (1.0 - 0.40 * t) * dt;   // section thins as it climbs
    }
    return vec2f(p.x * WAKE_LATERAL, p.y) * WAKE_NORM;
}
```

The curve is defined by its **turning tangent**, not by its position. The tangent sweeps from
just below horizontal at the base, through vertical partway up the face, to well past 180° at the
tip — so the lip hangs *back* over the face it came off. At `curl = 1` the sweep reaches 284°: the
tip sits at 47% of the crest's lateral offset and 65% of its height, so it genuinely overhangs.
Stop short of ~270° and the tip is still outboard of the crest, which reads as a rounded ridge.

The `1.65` exponent puts most of the arc length into the face and compresses the hook into the
last fifth. A linear sweep gives a circle, which reads as a rolled tube rather than something
thrown. `WAKE_NORM = 3.35` normalises so the crest lands near 1.0, which lets amplitude be one
number in metres. `WAKE_LATERAL = 0.70` squashes the section *across*, not uniformly — steepening
it is the difference between a bank and a wave.

---

## 5. `water.vertex.wgsl` — per-vertex placement

### 5.1 Signature

```wgsl
attribute position: vec3f;              // (column, ring, strand)

uniform viewProjection: mat4x4f;
uniform cameraPos: vec3f;
uniform waterCols: f32;                 // 176
uniform waterRings: f32;                // 24
uniform waterTime: f32;
uniform strandParams: array<vec4f, 8>;

var waterTex: texture_2d<f32>;

varying vWorld, vNormal: vec3f;
varying vQ, vU, vRadius, vFoam, vMilk, vAlpha, vViewDist: f32;
```

### 5.2 Body

```wgsl
let strand = i32(position.z);
let sp     = strandParams[strand];
let count  = max(sp.w, 2.0);
let base   = strand * 3;

let u = position.x / max(waterCols  - 1.0, 1.0);      // 0..1 along the spine
let q = position.y / max(waterRings - 1.0, 1.0);      // 0..1 around/up the section
let tm = waterTime;

let alive = sp.z > 0.001 && sp.w >= 2.0;
```

**The `alive` branch is a deliberate optimisation, not defensive coding.** All 33,792 vertices run
this shader whether or not their strand is in use, and each evaluates the swept surface *four*
times. Letting dead strands fall out of the maths (radius 0 collapses them anyway) cost **1.4 ms
per frame**. The branch is perfectly wavefront-coherent because a strand is thousands of
contiguous vertices, and the common case is one strand live out of eight.

```wgsl
var P = vec3f(0.0);
var N = vec3f(0.0, 1.0, 0.0);
var radius = 0.0;
var foam = 0.0;

if (alive) {
    P = waterPoint(waterTex, base, count, sp.x, u, q, tm);

    // Central-ish differences, offset FLIPPED near either edge so the pair
    // never straddles a clamp (which returns a zero-length tangent -> NaN normal).
    let du = 0.65 / max(waterCols  - 1.0, 1.0);
    let dq = 0.65 / max(waterRings - 1.0, 1.0);
    let su = select(1.0, -1.0, u > 0.5);
    let sq = select(1.0, -1.0, q > 0.5);

    let Pu = (waterPoint(waterTex, base, count, sp.x, u + du*su, q, tm) - P) * su;
    let Pq = (waterPoint(waterTex, base, count, sp.x, u, q + dq*sq, tm) - P) * sq;

    var Nn = cross(Pq, Pu);
    let nl = length(Nn);
    Nn = select(vec3f(0.0, 1.0, 0.0), Nn / max(nl, 1e-8), nl > 1e-7);

    // Orient outward — resolved against the vector from the spine to the surface,
    // because the sign of a differenced cross product on a closed tube depends on
    // which way the transported frame happens to wind.
    let axis    = P - waterSpine(waterTex, base, count, u);
    let outward = select(Nn, -Nn, dot(Nn, axis) < 0.0);
    N = select(Nn, outward, sp.x < 0.5);        // tube only; sheet is fixed in the fragment

    radius = waterRow(waterTex, base,     count, u).w;
    foam   = waterRow(waterTex, base + 2, count, u).z;
}

vWorld    = P;
vNormal   = N;
vQ        = q;
vU        = u;
vRadius   = radius;
vFoam     = foam;
vMilk     = sp.y;
vAlpha    = select(0.0, sp.z, alive);
vViewDist = distance(P, cameraPos);
position  = viewProjection * vec4f(P, 1.0);
```

**Differencing offset `0.65` in lattice-cell units** (i.e. `0.65/(cols-1)` in `u`). The sign flip
at the midpoint is what keeps the pair inside the domain at both boundary columns.

**Normals are differenced, not analytic, on purpose.** The surface is a sweep with a per-sample
radius, a transported frame, a vertical squash and two octaves of relief on top; the analytic
normal for all of that is long and easy to get subtly wrong, and three extra evaluations
*cannot* disagree with the geometry because they **are** the geometry.

---

## 6. `water.fragment.wgsl` — shading

Includes: `snowNoise`, `snowShading`, `snowSpellLights`, `snowAtmosphere`, `snowShadowLookup`.

### 6.1 The four simultaneous requirements

1. **Transparent** — you see the field through it, *displaced*; the displacement is what says
   "lens" rather than "coloured surface".
2. **Coloured by what it absorbs**, not by an albedo. Water's colour is the *shortfall* of the
   light that made it through — red first, then green — so the tint follows the path length.
3. **Mirror-bright.** At a 13° sun a wet surface returns almost all of a grazing view. Fresnel
   does most of the work of making it look wet.
4. **Scattering inside.** A body of water thrown through the air is full of bubbles and entrained
   snow; that internal scatter keeps the shadowed side of an arc alive.

### 6.2 Early discard

```wgsl
if (input.vAlpha <= 0.003 || input.vRadius <= 0.0005) { discard; }
```

### 6.3 Normal setup and two-sided handling

```wgsl
let V  = normalize(cameraPos - world);
let L  = sunDir;                            // points TOWARD the sun
let Ng = normalize(input.vNormal);
var N  = select(-Ng, Ng, dot(Ng, V) >= 0.0);   // turn toward the eye
let geoN = N;                                  // the shadow lookup uses THIS, pre-ripple
```

Both faces of the body are visible (it is transparent, and the sheet profile is genuinely open),
so winding says nothing.

### 6.4 Ripple normals — three octaves, footprint-faded

Sliced along **two oblique world directions**, not the XZ plane, because the body is as often
vertical as horizontal and a planar lookup bands it into horizontal stripes on the vertical parts.

```wgsl
let ddxW = dpdx(world);
let ddyW = dpdy(world);
let footprint = max(length(vec2f(length(ddxW.xz), length(ddyW.xz))), 1e-4);
let fp = vec2f(
    dot(world, vec3f(0.88, 0.31, -0.36)),
    dot(world, vec3f(0.24, 0.79,  0.56))
);

let up = select(vec3f(0,1,0), vec3f(1,0,0), abs(N.y) > 0.99);
let T  = normalize(cross(up, N));
let B  = cross(N, T);

let rippleFade = 1.0 - smoothstep(0.03, 0.22, footprint);
if (rippleFade > 0.002) {
    let g1 = noised(fp *  8.5 + vec2f( t*0.7, -t*0.5));
    let g2 = noised(fp * 21.0 + vec2f(-t*1.6,  t*1.1));
    N = normalize(N + (T * (g1.y*0.085 + g2.y*0.055)
                     + B * (g1.z*0.085 + g2.z*0.055)) * rippleFade);
}
let fineFade = 1.0 - smoothstep(0.006, 0.045, footprint);
if (fineFade > 0.002) {
    let g3 = noised(fp * 62.0 + vec2f(t*3.1, t*2.2));
    N = normalize(N + (T * g3.y + B * g3.z) * 0.030 * fineFade);
}
```

**All of the fine surface detail lives here and it has to.** The geometry carries a fixed vertex
count, so anything finer than that in the mesh is aliasing, not detail. Here the sampling rate is
the pixel, so three octaves are affordable and the footprint fade switches each one off before it
can shimmer.

`noised(p)` returns `vec3(value, d/dx, d/dy)` — Perlin gradient noise with quintic fade,
value range roughly `[-1, 1]`.

### 6.5 Shadow

```wgsl
let noiseRot = ign(input.position.xy) * 6.28318530718;
let shadow   = sunShadow(world, geoN, input.vViewDist, noiseRot);
```

`ign(pix) = fract(52.9829189 * fract(dot(pix, vec2(0.06711056, 0.00583715))))` — interleaved
gradient noise, the stable per-pixel dither TAA tolerates.

### 6.6 Absorption path length

```wgsl
const WATER_ABSORB: vec3f = vec3f(3.40, 0.72, 0.34);     // per metre, exaggerated

let path = clamp(
    input.vRadius * (1.25 + 1.9 * (1.0 - NdotV)) * waterDepthTint,
    0.01, 3.0
);
let transmit = exp(-WATER_ABSORB * path);
```

Real clear water absorbs about 0.45/m in red and 0.05/m in blue, which over the 10–40 cm a spell
body is actually thick produces a few percent of tint — invisible. These coefficients put the
same tint at a tenth of the path length: glacial melt full of entrained snow, not a swimming pool.

**The constant term (1.25) matters as much as the grazing term (1.9).** Keying the path purely
off view angle puts *all* of the colour at the silhouette — which is also exactly where Fresnel
is strongest, so the reflection replaces the tint precisely where it exists and the body comes
out white. The floor proportional to the radius means a fat body is coloured all the way across.

### 6.7 REFRACTION WITHOUT A SCENE COPY

This is the headline technique. The obvious implementation samples the framebuffer behind the
surface — rendering the opaque pass twice, or copying a bound render target mid-frame. Neither is
necessary, because of what is actually behind the water: **sky, or snow, and nothing else.**

The sky LUT already stores both. The Nishita bake writes the **iteratively-solved snow bounce**
into every direction *below the horizon*, precisely so shadowed snow can be lit by the ground it
sits on. So one lookup along the refracted ray returns a physically-derived estimate of what is
behind the water for *any* direction, up or down, at the cost of one texture fetch.

```wgsl
// Three indices of refraction -> chromatic dispersion.
let rr = refract(-V, N, 1.0 / 1.3300);      // red
let rg = refract(-V, N, 1.0 / 1.3330);      // green
let rb = refract(-V, N, 1.0 / 1.3400);      // blue
// Total internal reflection returns a zero vector; fall back to the mirror direction,
// which is what actually happens physically.
let mirror = reflect(-V, N);
let dr = select(mirror, rr, dot(rr, rr) > 0.5);
let dg = select(mirror, rg, dot(rg, rg) > 0.5);
let db = select(mirror, rb, dot(rb, rb) > 0.5);

let behind = vec3f(
    textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(dr), 1.6).r,
    textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(dg), 1.6).g,
    textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(db), 1.6).b
);
var color = behind * transmit;
```

* **One channel is taken from each of the three fetches** — `.r` from the red-IOR ray, `.g` from
  green, `.b` from blue. The spread is small (real dispersion in water is about half a percent
  across the visible band) but on a surface this curved the ray fans far enough to put a visible
  fringe on the rim, which is exactly where the eye looks for it.
* **Mip level 1.6** for refraction: the body is rippled, so a mirror-sharp background through it
  would alias, and a little blur is what a centimetre of moving water does anyway.
* `dirToLatLong(d) = vec2(atan2(d.x, d.z)/(2π) + 0.5, acos(clamp(d.y,-1,1))/π)`.

What it cannot show is the specific dune or trail behind the water. The trade: exact in hue and
energy, never breaks, never has to be re-ordered against the transparent pass, and costs three
samples of a texture already bound.

### 6.8 Internal scatter

```wgsl
const INV_PI: f32 = 0.31830988618;

let inScatter   = backScatter(N, L, V, 0.55, 2.6, 1.0);
let scatterTint = mix(vec3f(0.40, 0.80, 1.0), vec3f(0.72, 0.94, 1.0), exp(-path * 1.6));
color += sun * INV_PI * scatterTint * inScatter
       * (0.55 + 1.3 * input.vMilk) * sssStrength
       * mix(0.30, 1.0, shadow);
```

`backScatter(N, L, V, distortion, power, thickness)`:
```
H  = normalize(L + N*distortion)
vh = pow(clamp(dot(V, -H), 0, 1), power)
return vh * thickness
```
`L` points *toward* the sun, which fixes the sign: the transmission vector is `L + N*distortion`
and the lobe is measured against its **negation** — the direction scattered light continues in
after passing through. Building it from `-L` inverts the whole term so it peaks with the sun
behind the camera, the exact opposite of translucency.

**The `1/PI` is not decoration.** A scattering lobe is a *distribution*; multiplying radiance by
one without the `1/π` in front overstates the peak by a factor of three — which on a term already
fed by a 17:13:6 sun put the body several times brighter than sunlit snow. It clipped to flat
white along its whole length and no tinting underneath could show through.

Tinted by what the water did *not* absorb on the way in and out, so the glow is teal at depth and
near-white at the edges, for free.

### 6.9 Ambient fill

```wgsl
color += shIrradiance(N, shR) * ambientIntensity * INV_PI
       * scatterTint * (0.35 + 0.5 * input.vMilk);
```

Without this the shadowed side of an arc has nothing in it but the refraction and goes dead.

### 6.10 Slush (milkiness)

```wgsl
if (input.vMilk > 0.002) {
    let slushAlbedo = vec3f(0.86, 0.90, 0.96);
    let d = wrapDiffuse(NdotL, 0.62);
    var slush  = slushAlbedo * INV_PI * sun * d * shadow;
    slush += slushAlbedo * INV_PI * shIrradiance(N, shR) * ambientIntensity;
    slush += snowSubsurface(N, L, V, sun, 0.45, sssStrength * 0.8, 1.2)
           * slushAlbedo * mix(0.35, 1.0, shadow);
    color = mix(color, slush, input.vMilk * 0.85);
}
```

`milkiness` is not a colour. It is an **opaque diffuse population inside the body**, so it fills
in *behind* the transparency rather than tinting it, and the two coexist the way real slush does.
Note the mix cap `* 0.85`: even at milk = 1 the refracted background survives at 15%.

`wrapDiffuse(NdotL, w) = max(0, (NdotL + w) / ((1+w)*(1+w)))`.

### 6.11 Foam

```wgsl
var foam = input.vFoam;
if (foam > 0.002) {
    let fn2 = noise2(fp * 22.0 + vec2f(t*1.7, -t*1.1)) * 0.5 + 0.5;
    let fn3 = noise2(fp * 61.0 - vec2f(t*3.3,  t*2.1)) * 0.5 + 0.5;
    foam = clamp(foam * (0.35 + 1.5 * fn2 * (0.5 + 0.7 * fn3)), 0.0, 1.0);
    let foamAlbedo = vec3f(0.93, 0.955, 0.99);
    var fc  = foamAlbedo * INV_PI * sun * wrapDiffuse(NdotL, 0.72) * shadow;
    fc += foamAlbedo * INV_PI * shIrradiance(N, shR) * ambientIntensity;
    fc += snowSubsurface(N, L, V, sun, 0.25, sssStrength, 1.4)
        * foamAlbedo * mix(0.4, 1.0, shadow);
    color = mix(color, fc, foam);
}
```

Two noise octaves (22× and 61× the oblique world slice), counter-drifting, break the foam into a
froth rather than a painted band. `foam` is *modulated in place* — the shaded value feeds the
Fresnel gate, the GGX roughness and the alpha below.

### 6.12 Fresnel reflection — capped at 0.72

```wgsl
let F = min(fresnelSchlick(NdotV, vec3f(0.02)), vec3f(0.72));
let skyRefl = textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(mirror), 0.7).rgb;
color = mix(color, skyRefl, F * (1.0 - foam * 0.7) * (1.0 - input.vMilk * 0.88));
```

* Applied **after** the body terms because it sits *on* the surface: what it returns never went
  through the water and is therefore never tinted by it.
* **Capped at 0.72, not run to the full Schlick 1.0 at grazing.** A flat sea does go to a perfect
  mirror at the horizon, but that limit assumes a surface you cannot see the far side of. This
  body is a decimetre through and lit from inside, so letting the reflection reach unity deletes
  the volume exactly at the silhouette — the one place the eye reads the material from.
* **Milkiness must take the surface out as well as filling the body in.** A vortex at milk 0.88
  was still returning a third of the sky at grazing on a 0.27 roughness lobe, and came out looking
  like moulded plastic: opaque (right) and polished (wrong). A mass of ice crystals in air has no
  specular surface at all. Hence `(1.0 - milk * 0.88)`.
* Reflection mip **0.7** (sharper than the refraction's 1.6).

### 6.13 Sun glint + micro-sparkle

```wgsl
if (NdotL > 0.0) {
    let H     = normalize(V + L);
    let rough = mix(0.055, 0.68, max(foam * 0.55, input.vMilk));
    let D     = distributionGGX(clamp(dot(N, H), 0.0, 1.0), rough);
    let Vis   = visSmithGGXCorrelated(NdotV, NdotL, rough);
    let Fs    = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), vec3f(0.02));
    color += sun * D * Vis * Fs * NdotL * shadow;
}

if (glintIntensity > 0.001) {
    let g = snowGlints(fp, N, V, L, footprint,
                       glintIntensity * (0.6 + 0.8 * max(foam, input.vMilk)),
                       glintGrazing);
    color += sun * g * shadow * 0.7;
}
```

Roughness runs 0.055 (clear water, tight highlight that runs along the top of an arc and sells its
curvature) to 0.68 (foam / slush).

`snowGlints` is the snow's own glint field at a much finer cell, gated the same way, so the
sparkle on the water and on the field are the same effect. Its parameters (from `lib/shading.wgsl`):
two world-space octaves at cell **0.052 m** (sharpness 780) and **0.185 m** (sharpness 1500,
weight 1.35, offset `+(53.1, 17.9)`), each faded by `smoothstep(cell*0.55, cell*2.2, footprint)`;
graze gate `pow(1 - NdotV, mix(1.5, 5.0, grazeGate))`; light gate
`smoothstep(0.02, 0.35, NdotL) * (1 - smoothstep(0.55, 0.95, NdotL)*0.55)`; only cells with
`hash22(id + (19.73, 7.31)).x <= 0.62` hold a facet; disc radius `cell*0.17`; facet tilt
`0.10 + r2.y*0.26`.

### 6.14 Spell light on the water itself

```wgsl
if (spellLightCount > 0.5) {
    color += spellLightingSurface(
        world, N, V,
        mix(vec3f(0.35, 0.62, 0.78), vec3f(0.9), input.vMilk),   // albedo
        vec3f(0.02),      // f0
        0.12,             // roughness
        0.55,             // wrap
        spellLightPos, spellLightCol, spellLightCount
    );
}
```

This is why a Bloom's column glows from inside instead of being a dark shape against a lit crater.

### 6.15 Opacity — deliberately HIGH

```wgsl
let taper      = clamp(input.vRadius / 0.055, 0.0, 1.0);
let clearAlpha = taper * mix(0.74, 0.97, 1.0 - NdotV);
let alpha      = mix(clearAlpha, taper, max(foam, input.vMilk * 0.9)) * input.vAlpha;
if (alpha < 0.004) { discard; }
```

**Nearly opaque, which is the opposite of the obvious answer, and is the single change that made
this read as water rather than as frosted glass.** Running the alpha off Fresnel — transparent
face-on, mirror at grazing, which is what clear water does — comes out pale and washed, because
the background is counted **twice**: once through the refracted sky lookup (the physically-placed,
dispersed, absorbed version) and again through the blend (the undistorted version at full
brightness). Over a snow field the second one is white and it wins. A high alpha deletes the
duplicate and leaves the refraction as the only path the background takes through the body.

What is left for the alpha to do is **the ends**. The radius tapers to nothing there, so keying
opacity to the radius (`/0.055` m) closes the tube on a soft point rather than on a ring of
visible section. That is also why **nothing fades in `u`**: `u` means "along the spine" and cannot
tell a ribbon's trailing wisp from the symmetric horn of a crescent wave.

### 6.16 Aerial perspective (last)

```wgsl
color = applyAerial(color, cameraPos, world, -V, L, skyLUT, skyLUTSampler, sun,
                    fogDensity, fogHeightFalloff, fogStart, aerialStrength);
fragmentOutputs.color = vec4f(color, alpha);
```

`applyAerial` computes `t = aerialTransmittance(...)`, `ext = clamp(1 - pow(t, strength), 0, 1)`,
and returns `mix(color, aerialInscatterSky(...), ext)`.

---

## 7. External write interfaces

Both are outside the spell subsystem but every spell calls them, so the contracts are here.

### 7.1 `deform.brush(x, z, radius, depth, berm, compression, ice, yaw, elongation, edge)`

Queues one additive brush into the terrain state buffer for this frame.

| Param | Units | Meaning |
|---|---|---|
| `x`, `z` | world metres, **absolute** | the shader wraps into the toroidal window itself |
| `radius` | m | across the **short** axis |
| `depth` | m | depression at the centre. **May be negative** — that *adds* snow |
| `berm` | m | displaced mass thrown to the rim |
| `compression` | 0..1 | added to the compression channel |
| `ice` | 0..1 | taken as a **max**, not added |
| `yaw` | rad | orients the long axis |
| `elongation` | ×radius | long-axis multiple; 1 = round |
| `edge` | 0..1 | rim roughness; 0 = clean bevel |

Rejected if `radius <= 0`, if the queue is full (`MAX_BRUSHES = 96`), or if the brush centre is
further than `size*0.5 + radius*2` from the window centre (window is 80 m at 2048² = 3.9 cm texels).

Brush data texture rows (3 rows × 96 columns, RGBA32F):
`(x, z, radius, elongation)` / `(cos yaw, sin yaw, depth, berm)` /
`(compression, ice, edgeRoughness, seed)` where `seed = (x*0.37 + z*0.71) % 100`.

### 7.2 `spray.emit(x, y, z, vx, vy, vz, size, life, kind, drag)`

| Param | Units | Meaning |
|---|---|---|
| `x,y,z` | m | world spawn |
| `vx,vy,vz` | m/s | initial velocity |
| `size` | m | billboard size |
| `life` | s | |
| `kind` | 0 or 1 | 0 = soft powder/flake, 1 = hard-edged ballistic clod/droplet |
| `drag` | 1/s | if undefined, defaults to `kind > 0.5 ? 1.1 : 5.2` |

Integration per frame (`h = min(dt, 1/30)`): horizontal velocity damps toward the wind at
`min(1, drag*h)`; `vy += (-9.81 - drag*(vy + TERMINAL)) * h`. Low drag ⇒ ballistic;
high drag ⇒ hangs and settles. Emission is dropped silently when the pool is full.

---

## 8. Spell 1 — SWEEP (`spells/sweep.js`)

> A crescent of slush rises out of the ground ahead of the player and runs outward, ploughing a
> channel and throwing berms to either side.

It is the **wake's cross-section on a different spine**, reached through the water material's
SHEET profile. A carve's wall of snow and a bent wave of slush are the same object — mass thrown
out of the ground and held up by its own momentum. What differs is what the spine is: the wake's
is a record of where the board went, and this one is an arc that grows outward from where the
spell was cast.

### 8.1 Constants

| Identifier | Value | Units | Note |
|---|---|---|---|
| `COLS` | 48 | samples | spine samples across the crescent |
| `CURVE` | 5.5 | m | **fixed** curvature radius of the crescent |
| `ARC0` | 0.52 | rad | half-angle at cast |
| `ARC1` | 0.96 | rad | half-angle at full spread |
| `LIFE` | 2.4 | s | cast → fully collapsed |
| `PEAK` | 2.15 | m | peak crest height at the arc centre |

**`CURVE` is fixed and this is the whole shape of the spell.** Using the distance travelled as
the radius makes the wave an arc of a circle centred on the caster, and ten metres out the
crescent is twenty metres wide — a ridge in the terrain rather than something thrown. A wave front
has a curvature of its own that has nothing to do with how far it has run, so the arc **keeps its
shape and translates**; only its *span* opens up as the ends spread.

`PEAK = 2.15 m` is taller than the character, on the same reasoning as the surf wake's 2.4 m: at
the distance this demo frames from, a crest the height of the relief the terrain already has does
not read as thrown mass, it reads as a dune.

### 8.2 Trigger

```
if (strand < 0) strand = water.acquire();  if (strand < 0) return
fl = hypot(ax, az) || 1
dx = ax/fl;  dz = az/fl
ox = controller.position.x + dx * 1.1        // born 1.1 m ahead of the feet
oz = controller.position.z + dz * 1.1        //   so the player is never inside it
t = 0
reach = 1.4                                  // initial metres travelled
_brushOwed = 0;  _sprayOwed = 0
active = true
```

A recast **restarts** rather than stacking: two crescents from the same point are one crescent
with a seam in it. Camera trauma `0.12` is added by `SpellSystem.cast`.

### 8.3 Per-frame envelopes

```
t += dt
life01 = t / LIFE                            // LIFE = 2.4
if (life01 >= 1) { _end(); return }

speed     = 11.5 * exp(-t * 1.15) + 1.2      // m/s: 12.7 at cast -> 1.2 asymptote
travelled = speed * dt
reach    += travelled

rise = smooth01(t / 0.26)                    // up in 0.26 s
fall = 1 - clamp01((life01 - 0.55) / 0.45)   // starts falling at t = 1.32 s
env  = rise * fall * fall                    // QUADRATIC fall, exactly to zero

spread = clamp01((reach - 1.4) / 14)         // 0 at cast, 1 at 15.4 m of reach
arc    = ARC0 + (ARC1 - ARC0) * spread       // 0.52 -> 0.96 rad
height = PEAK * env / (1 + spread * 0.45)    // thins as it spreads
```

*Speed decays because the wave is launched, not driven.* Ten metres a second down to a walking
pace is what makes it read as thrown rather than pushed. The fall is quadratic **to exactly zero**
so the last frame of the wave is flat rather than a step.

### 8.4 Spine generation (48 columns)

```
kx = ox + dx * (reach - CURVE)               // circle centre, one CURVE behind the leading point
kz = oz + dz * (reach - CURVE)
wx =  dz;   wz = -dx                         // the crest's own right

for c in 0..47:
    u  = c / 47
    th = (u - 0.5) * 2 * arc
    cs = cos(th);  sn = sin(th)
    rx = dx*cs + wx*sn                       // outward radial at this angle: the direction the
    rz = dz*cs + wz*sn                       //   section faces AND the direction that horn runs
    x  = kx + rx * CURVE
    z  = kz + rz * CURVE
    y  = terrain.heightAt(x, z) - 0.13       // SUNK, so the wall base meets the trench floor
                                             //   it is cutting, not the undisturbed surface
    amp  = height * bell(u)                  // horns taper to nothing
    curl = 0.48 + 0.47 * bell(u) * (0.45 + 0.55 * rise)
    foam = 0.30 + 0.45 * bell(u)

    water.column(strand, c, x, y, z, amp,
                 rx, 0, rz,                  // right vector is the outward radial, FLAT
                 curl,                       // -> wakeSection's curl parameter
                 reach + u * 2.0,            // dist
                 life01,                     // age
                 foam, 1.0)                  // flatten = 1

water.setParams(strand, PROFILE_SHEET, 0.48, clamp01(env * 1.4), 48)
```

* **The bell is on `u`, not on the angle**, so the two ends close symmetrically however wide the
  arc has opened, and the sheet degenerates onto its own spine there instead of ending on a cut
  edge.
* **Curl `0.48 .. 0.95`** — pushed most of the way to the section integral's plunging limit. At
  the low end the sheet is a bank, and a bank lying on a dune field is indistinguishable from the
  dune field. It has to hook over its own face to read as a wave at all. The curl also grows with
  `rise`, so the crest hooks harder once it is up.
* **Milkiness 0.48.** Below ~0.4 it stops reading as slush and starts reading as a glass
  sculpture; above ~0.6 the water disappears entirely and it is just a moving snow berm.

### 8.5 Light — one slot

```
px, py, pz  = the column written at index (COLS >> 1) = 24    // arc centre
lights.add(px, py + height * 0.55, pz,
           radius    = 9.5,
           rgb       = (0.42, 0.74, 1.0),
           intensity = 13.0 * env)
```

Rides the middle of the crest, **low**, so it grazes the channel it is cutting rather than
lighting it from above.

### 8.6 `_plough` — the channel and its berms

Written **per metre travelled**, not per second, so the trench has the same depth at any speed or
frame rate: a patch of ground sits under the brush for `2*radius/travelled` frames, and the depth
it ends at is therefore independent of both.

```
if (env < 0.05) return
_brushOwed += travelled
if (_brushOwed < 0.25) return                // one rank of brushes every 25 cm of advance
k = min(_brushOwed, 0.7)                     // clamp, so a frame spike cannot gouge
_brushOwed = 0

spread = clamp01((reach - 1.4) / 14)
arc    = ARC0 + (ARC1 - ARC0) * spread
N      = 13

kx = ox + dx * (reach - 0.5 - CURVE)         // 0.5 m BEHIND the crest: the channel is what
kz = oz + dz * (reach - 0.5 - CURVE)         //   the wave has already passed over
wx = dz;  wz = -dx

for i in 0..12:
    u = i / 12
    w = bell(u);  if (w < 0.06) continue
    th = (u - 0.5) * 2 * arc
    rx = dx*cos(th) + wx*sin(th)
    rz = dz*cos(th) + wz*sin(th)
    x = kx + rx*CURVE;   z = kz + rz*CURVE
    yaw = atan2(rz, -rx)                     // long axis runs ALONG the arc -> continuous
                                             //   trench, not a row of round pits
    deform.brush(x, z,
        radius      = 0.34,
        depth       = 0.95 * k * env * w,    // channel
        berm        = 0.62 * k * env * w,    // berms at the rim
        compression = 0.55 * k * env * w,    // slush packs what it runs over
        ice         = 0.16 * k * env * w,    // and refreezes a little of it
        yaw, elongation = 2.2, edge = 0.9)
```

25 cm spacing: denser just re-cuts the same trench; sparser leaves it scalloped.

### 8.7 `_spray` — thrown off the crest

```
if (!spray || env < 0.08) return
perMetre   = 120 * sprayScale
_sprayOwed += travelled
count = floor(_sprayOwed * perMetre)
if (count <= 0) return
_sprayOwed -= count / perMetre
count = min(count, 150)

spread = clamp01((reach - 1.4)/14);  arc = ARC0 + (ARC1-ARC0)*spread
kx = ox + dx*(reach - CURVE);  kz = oz + dz*(reach - CURVE)
wx = dz;  wz = -dx

for each of `count`:
    u = random()
    w = bell(u);  if (w < 0.12) continue
    th = (u - 0.5) * 2 * arc
    rx = dx*cos(th) + wx*sin(th);   rz = dz*cos(th) + wz*sin(th)
    amp = height * w
    d   = CURVE + (random() - 0.2) * 0.6     // slight bias OUTBOARD of the crest line
    x = kx + rx*d;   z = kz + rz*d
    y = terrain.heightAt(x, z) + amp * (0.55 + 0.6*random())
    out  = 1.4 + random()*3.2
    clod = random() < 0.20 ? 1 : 0
    spray.emit(x, y, z,
        vx   = rx*out + (random()-0.5)*1.4,
        vy   = 1.5 + random()*3.2 + amp*1.6,      // taller crest throws higher
        vz   = rz*out + (random()-0.5)*1.4,
        size = clod ? 0.022 + random()*0.024 : 0.050 + random()*0.075,
        life = clod ? 0.6  + random()*0.5   : 0.55 + random()*0.7,
        kind = clod,
        drag = clod ? 0.8  : 1.6 + random()*1.4)
```

Thrown forward and up, off the *front* of the crest.

### 8.8 End

`_end()` / `cancel()`: `active = false; water.release(strand); strand = -1`.

---

## 9. Spell 2 — RIBBON (`spells/ribbon.js`)

> A held, continuous stream of water tracking the hand and the camera aim, describing arcs and
> figure-eights in the air, and scoring thin curved lines in the snow it passes over.

**The one decision that gives this spell its character:** the ribbon is a *record of where its
tip has been*, not a shape recomputed each frame from the current aim. That is what gives it
momentum. Swing the camera and the water does not swing with it — the tip goes, and the body
follows a fraction of a second later, trailing through the arc the tip drew. It is also why
letting go does not despawn anything: the tip stops being driven, the tail keeps retiring, and the
ribbon eats itself from behind over about three quarters of a second.

### 9.1 Constants

| Identifier | Value | Units | Note |
|---|---|---|---|
| `SAMPLES` | 46 | — | ring-buffer capacity of committed tip positions |
| `STEP` | 0.20 | m | tip travel between committed samples |
| `TAIL_LIFE` | 1.25 | s | a sample's survival once the body has been thrown |
| `THROW_SPEED` | 21 | m/s | speed cap for the thrown head |
| `THROW_STEER` | 5.5 | 1/s | rate the head turns onto the aim after release |
| `RADIUS` | 0.205 | m | tube radius at the fat part of the body |
| `SECTION_ASPECT` | 1.55 | — | how much wider the section is than it is thick |

`THROW_SPEED` was tuned **down** from 30 for a reason entirely about the camera and not the
physics: the throw goes *away from the viewer*, so a body flying flat out foreshortens to a dot
within half a second — a nine-metre ribbon seen end-on is nine metres of nothing. 21 m/s is still
plainly fast and stays broadside long enough to be watched.

`THROW_STEER = 5.5` is deliberately unhurried. Snapping the velocity onto the aim makes the body
a straight line immediately, and a straight line pointing at the horizon is the least legible
thing this spell could do. At 5.5 the head takes about a fifth of a second to come round, so it
leaves on a curve and the tail carries the swing it was in on its way out.

`SECTION_ASPECT`: a body of bent water is not a hose. It is a *ribbon* — flattened, twisting as it
goes, catching the light on the broad face and vanishing to an edge when it turns side-on. A
circular section presents the same silhouette from every direction, which is what makes it read
as a cylinder. The ellipse rolls with the section twist, so the broad face turns over as it
travels down the body.

### 9.2 State

```
_x, _y, _z : Float32Array(46)   ring buffer of tip positions, newest at _head
_spd       : Float32Array(46)   |velocity| at the moment each sample was committed
_head, _count
tipX/Y/Z, _vx/_vy/_vz           the live tip and its velocity
_phase                          Lissajous phase
blend                           eased 0..1: how much ribbon there is. Never a switch.
held, thrown, _splashed, _throwT, _tx/_ty/_tz (throw aim)
```

`_spd` is the **one source of thickness variation that is neither periodic nor random.** A stream
of water conserves mass: where it was moving fast it is stretched thin, where it slowed at the end
of a swing it bunches. Recording speed at commit time and reading it back as a radius means the
ribbon is thick and thin in the places the *motion* put it, so no two passes through the same
figure-eight look the same and none of it repeats.

### 9.3 Lifecycle

```
trigger()   // key down
    if (strand < 0) strand = water.acquire()
    held = true; active = true
    if (!_seeded) _seed()

_seed()
    tip = handPosition(1)          // right hand
    _v = 0;  _head = 0;  _count = 0;  _phase = 0;  _seeded = true

release()   // key up
    if (!held) return
    held = false;  thrown = true;  _splashed = false;  _throwT = 0
    (_tx,_ty,_tz) = normalize(rig.forward + (0, 0.18, 0))   // slightly ABOVE the aim:
                                                            //  a thrown body has to arc,
                                                            //  dead flat means it only falls
    _burst()
```

### 9.4 Blend envelope

```
want = held  ? 1
     : thrown ? clamp01(1 - (_throwT - 1.5) / 1.0)     // full until 1.5 s, gone at 2.5 s
     : 0
blend = expDamp(blend, want, held ? 5.5 : 3.4, dt)
```

A thrown body does not thin out while it is still flying — it is all still there, travelling. It
only gives out once it has spent itself.

Termination: `if (!held && (_count < 3 || blend < 0.02)) _end()`.

### 9.5 `_driveTip` — held

```
h = min(dt, 1/60)
(hx,hy,hz) = handPosition(1)

_phase += dt * 2.55

// Lissajous 2:1 (the classic figure-eight) in the CAMERA's right/up plane,
// so the pattern is always broadside to the viewer however the player is standing.
// Two extra harmonics, both incommensurate with the fundamental and with each other,
// make the pattern PRECESS: recognisably a figure-eight, never twice the same one.
a = sin(_phase)         * 1.70 + sin(_phase * 0.41 + 1.7) * 0.44
b = sin(_phase*2 + 0.4) * 0.92 + sin(_phase * 0.73 + 0.2) * 0.26

reach = 2.5
tx = hx + f.x*reach + r.x*a + u.x*b
ty = hy + f.y*reach + r.y*a + u.y*b + 0.34      // pattern sits HIGH enough that the bottom
tz = hz + f.z*reach + r.z*a + u.z*b             //   lobe only OCCASIONALLY reaches the snow

// Critically-damped-ish spring. Stiff and close to critical.
k = 210                                          // spring constant
c = 2*sqrt(k) * 0.92                             // ≈ 26.67, damping ratio 0.92
_v  += (k*(target - tip) - c*_v) * h
tip += _v * h

// Never bore into the ground; skim it instead — which is where the scoring comes from.
g = terrain.heightAt(tipX, tipZ) + 0.10
if (tipY < g) { tipY = g;  if (_vy < 0) _vy *= -0.25 }

_commit()
```

*Why a spring at all:* at these rates the tip overshoots a fast camera swing and comes back —
exactly the behaviour a mass on the end of an arc has, and exactly what a direct assignment would
throw away.

*Why stiff (k = 210, ζ = 0.92):* slacker and the tip lags its target far enough to spend each
cycle catching up in a straight line and then turning hard at the ends, which **squares off the
loops**. Momentum should round the path, not corner it: track the smooth Lissajous closely and let
the spine's own length carry the lag.

*Why harmonics:* a pure 2:1 Lissajous closes on itself every cycle, so the tip retraces the
identical path forever and the ribbon lies on top of its own previous pass, which reads as a flat
repeating sign.

*Why the pattern sits high (+0.34 and reach 2.5):* scoring on every pass turns a trace into a
ploughed furrow, and a ribbon permanently in contact with the surface stops reading as something
held in the air.

### 9.6 Commit

```
_commit():
    if (_count == 0) { _push(tip); return }
    d = tip - buffer[_head]
    if (dot(d,d) >= STEP*STEP) _push(tip)          // STEP = 0.20 m

_push(x,y,z):
    _head = (_head + 1) % 46
    if (_count < 46) _count++
    buffer[_head] = (x,y,z)
    _spd[_head]   = |_v|
```

### 9.7 `_retire` — after release

The head is integrated **exactly as it was while held** — same point, same velocity, so the moment
of release is continuous in both position and velocity and there is nothing to ease. What changes
is the *force* on it.

```
if (thrown && _count > 0):
    _throwT += dt
    h = min(dt, 1/60)

    // ---- steer onto the aim (direction turns, magnitude preserved) ----
    k  = 1 - exp(-THROW_STEER * h)         // frame-rate independent, THROW_STEER = 5.5
    sp = |_v|
    _v += (aim * sp - _v) * k

    // ---- accelerate: thrust for ~1/3 s, then quadratic drag takes over and it coasts ----
    thrust = 62 * exp(-_throwT * 3.0)      // m/s², 62 at release, 1/e at 0.333 s
    _v += aim * thrust * h
    _vy -= 9.81 * h

    s2 = |_v|
    if (s2 > 0.001):
        drag = min(1, (0.55 + s2*s2*0.0016) * h)   // linear + quadratic
        _v -= _v * drag
    if (s2 > THROW_SPEED): _v *= THROW_SPEED / s2  // hard cap at 21 m/s

    tip += _v * h

    // ---- impact ----
    g = terrain.heightAt(tipX, tipZ) + 0.05
    if (!_splashed && tipY < g) { tipY = g; _splash() }

    if (_splashed) _v = 0                  // head PINNED
    else _commit()                         // same commit path as the held ribbon

// ---- tail drain ----
_retireOwed += dt
rate = _splashed ? 7.0 : 1 + _throwT * 0.9
per  = TAIL_LIFE / SAMPLES / rate          // 1.25/46/rate seconds per sample
while (_retireOwed >= per && _count > 0) { _retireOwed -= per; _count-- }
```

**The velocity turns toward the aim rather than being replaced by it**, so the head *curves* out
of whatever part of the figure-eight it was in. The bend it had when you let go is still in the
tail on its way out, because the tail is literally the path the head took. That is the difference
between throwing the ribbon and the ribbon being thrown: translating the body rigidly moves a
shape; steering the head and letting the body follow means the water *arcs onto* the target.

**Accelerating rather than starting at speed** is what makes it read as being *sent* — the eye
catches the head building pace and follows it out.

**The drain rate climbs with time so the spell always terminates:** a head that coasted forever
would keep feeding the spine forever. Base rate `1 + _throwT*0.9`; on splash it jumps to `7.0`,
which drains the whole body into the impact point in roughly a third of a second. While the head
is still flying and committing samples the drain only holds the body to a fixed length; once the
head slows, the drain outruns it and eats the ribbon.

**Impact does not slither.** The first version clamped the head to the surface and let it carry
on, which made a released ribbon slide across the snow like a snake. It bursts instead: the head
stops dead where it hit, and the rest of the body pours into that point.

### 9.8 `_splash`

Three things at once, and they are all the same event.

```
_splashed = true
sp    = |_v| || 1
ix    = _vx/sp;   iz = _vz/sp
steep = min(1, |_vy| / sp)

// --- droplet fan: deliberately WIDE and LOW. A vertical burst reads as an explosion;
//     water hitting a surface at a shallow angle mostly goes sideways, and the ring of it
//     skating outward across the snow is the thing that says "liquid".
total = floor((280 + 190*(1 - steep)) * sprayScale)
for each:
    a  = random()*2π;  ca = cos(a);  sa = sin(a)
    out = (1.8 + random()*5.5) * (0.45 + 0.85*(1 - steep))   // biased downrange:
    vx  = ca*out + ix*sp*0.32                                //  the water keeps most of
    vz  = sa*out + iz*sp*0.32                                //  its momentum
    vy  = (1.2 + random()*4.6) * (0.4 + 0.8*steep)           // LOW
    drop = random() < 0.55 ? 1 : 0
    spray.emit(x + ca*0.12, y + 0.04 + random()*0.12, z + sa*0.12, vx, vy, vz,
               size = drop ? 0.020 + random()*0.034 : 0.055 + random()*0.095,
               life = 0.6 + random()*1.1,
               kind = drop,
               drag = drop ? 0.6 : 2.2)

// --- the mark. Shallower than a Bloom crater and much WETTER: this is water landing,
//     so it packs and glazes far more than it displaces.
deform.brush(x, z, radius 0.62,
             depth 0.16, berm 0.13, compression 1.0, ice 0.85,
             yaw = atan2(iz, ix), elongation 1.35, edge 1.0)
for i in 0..2:
    a = random()*2π;  d = 0.55 + random()*0.65
    deform.brush(x + cos(a)*d, z + sin(a)*d,
                 radius 0.30 + random()*0.22,
                 depth 0.05, berm 0.07, compression 0.6, ice 0.5,
                 yaw a, elongation 1.3, edge 1.0)

rig.addTrauma(0.09)
```

### 9.9 `_burst` — droplets shed at the moment of release

```
if (!spray || _count < 3) return
total = floor(70 * sprayScale)
for each:
    j = 1 + floor(random() * (_count - 2))
    i = (_head - j + 92) % 46
    spray.emit(
        pos[i] + (random()-0.5)*0.3 on each axis,
        aim.x*(4 + random()*9) + (random()-0.5)*2.4,
        aim.y*(4 + random()*9) + 0.8 + random()*2.0,
        aim.z*(4 + random()*9) + (random()-0.5)*2.4,
        size 0.020 + random()*0.040,
        life 0.6 + random()*0.9,
        kind 1, drag 0.7)
```

A shear of droplets off the **whole body**, not off the tip.

### 9.10 `_writeStrand` — resolving the spine into the strand table

**Column 0 is the LIVE TIP, not the newest committed sample.** Samples are committed every 20 cm
of head travel, so a spine drawn only from committed samples has a head that advances in 20 cm
jumps — three or four frames of the tip standing still followed by one frame of it teleporting
forward. At a walking swing that is a visible stutter at the leading edge, which is the part of
the ribbon the eye is locked onto. Writing the live tip as column 0 and the committed samples
behind it gives a head that moves every frame and a body that is still a record of where it has
been. `u` therefore means "distance behind the tip".

```
n = min(_count + 1, STRAND_COLS)             // STRAND_COLS = 64
if (n < 3) { water.setParams(s, PROFILE_TUBE, 0.12, 0, 0); return }

// --- seed the frame at the tip ---
p  = tip
t0 = tip - buffer[_head];  tl = |t0|
if (tl < 1e-5):                              // right after a commit the tip sits ON the sample
    i1 = (_head - 1 + 46) % 46
    t0 = tip - buffer[i1];  tl = |t0| || 1
t0 /= tl
// any perpendicular will do; the transport takes it from there and the section is round
r = (-t0.z, 0, t0.x);  rl = |r|
if (rl < 1e-4) { r = (1,0,0); rl = 1 }
r /= rl

dist  = 0
twist = ctx.time * 2.4

for j in 0..n-1:
    i = (_head - (j - 1) + 92) % 46          // j=0 is the live tip; j>=1 walks backwards
    P = (j == 0) ? tip : buffer[i]

    if (j > 0):
        dd = p - P;  dl = |dd|
        if (dl > 1e-5):                      // degenerate segment is NORMAL here, must not NaN
            dist += dl
            t1 = -dd / dl
            transport(r, r, t0, t1)
            t0 = t1

    u = j / (n - 1)

    // radius profile: a pointed head, a shoulder just behind it, a continuous taper to
    // nothing. Both ends must close on a point or the tube shows its open section as a
    // disc of backface. NO PLATEAU — a constant radius over any part of the body is the
    // definition of a cylinder; a stream tapers everywhere.
    profile = smooth01(u / 0.10) * pow(1 - u, 1.05)

    // thickness from the speed the tip had when THIS sample was laid:
    // slow means bunched, fast means stretched thin. Conservation of mass, near enough.
    stretch = clampRange(1.35 - _spd[i] * 0.055, 0.55, 1.35)
    rad     = RADIUS * profile * stretch * blend            // RADIUS = 0.205

    // section aspect: flattened where it is skimming the snow, ON TOP of the ribbon's ellipse
    clear  = P.y - terrain.heightAt(P.x, P.z)
    ground = 1 - clamp01((clear - 0.06) / 0.35)             // 1 at 6 cm, 0 at 41 cm
    flat   = SECTION_ASPECT * (1 - 0.72 * ground)           // 1.55 -> 0.434

    // foam: at the head (tearing through air), on the ground (dragging),
    //       and wherever the body is stretched thin (that is where a stream tears)
    foam = clamp01((1 - smooth01(u / 0.16)) * 0.55
                 + ground * 0.5
                 + (1 - stretch) * 0.45)

    water.column(s, j, P.x, P.y, P.z, rad,
                 r.x, r.y, r.z,
                 twist + dist * 1.35,          // the section ROLLS as it goes
                 dist, u, foam, flat)
    p = P

water.setParams(s, PROFILE_TUBE, 0.14, clamp01(blend * 1.3), n)
```

**Taper exponent 1.05 (near-linear) is deliberate.** Above about 1.2 the tail is gone by two
thirds of the way back and the arc reads short, so the body carries almost the whole nine metres.

**The section roll `twist + dist*1.35`** turns the broad face of the ellipse over along the body,
which is what makes it read as a ribbon of water rather than an extruded shape — and it is what a
stream of water under lateral acceleration actually does.

**Milkiness 0.14** — nearly clear water.

### 9.11 `_score` — thin curved lines in the snow

```
n = min(_count, 64)
if (n < 2 || blend < 0.15) return
_scoreOwed += dt
if (_scoreOwed < 1/60) return
k = min(_scoreOwed, 0.05);  _scoreOwed = 0

span = min(n - 1, 10)                        // head end ONLY — the tail has already
for j = 0; j <= span; j += 2:                //   scored what it was going to score.
    i = (_head - j + 92) % 46                //   Re-cutting turns a light trace into a gouge.
    clear = y[i] - terrain.heightAt(x[i], z[i])
    if (clear > 0.34) continue
    w = 1 - clamp01(clear / 0.34)
    deform.brush(x[i], z[i],
        radius      = 0.13,                  // THIN
        depth       = 1.15 * k * w * blend,  // shallow
        berm        = 0.55 * k * w * blend,  // a small lip of pushed snow
        compression = 2.6  * k * w * blend,  // packed hard by running water
        ice         = 1.9  * k * w * blend,  // and glazed
        yaw = 0, elongation = 1, edge = 0.65)
```

A **score, not a trench**, so the trace of a figure-eight is still legible on the ground a minute
later. Heavy on compression and ice — water on snow at this temperature does one thing.

### 9.12 `_shed` — droplets off the body

```
if (!spray || _count < 4 || blend < 0.2) return
rate = 130 * sprayScale * blend
_sprayOwed += dt * rate
count = floor(_sprayOwed);  if (count <= 0) return
_sprayOwed -= count;  count = min(count, 30)

for each:
    j  = 1 + floor(random()*(_count - 2))
    i  = (_head - j + 92) % 46
    ip = (i + 1) % 46
    v  = (buffer[i] - buffer[ip]) * 12       // local body velocity from the spine's own spacing
    spray.emit(buffer[i] + (random()-0.5)*0.2 on each axis,
               v.x*0.5 + (random()-0.5)*1.6,
               v.y*0.5 + 0.4 + random()*1.2,
               v.z*0.5 + (random()-0.5)*1.6,
               size 0.022 + random()*0.034,
               life 0.55 + random()*0.75,
               kind 1,                       // droplets, not powder: hard-edged and ballistic
               drag 0.55)
```

Off the *body*, not off the tip: a stream under this much lateral acceleration loses water all
the way along its outside, and emitting only at the head puts a comet trail behind a shape that is
not a comet.

### 9.13 NO LIGHT — and that is a decision

Ribbon is the only spell of the five that declares **no** spell light. The other four are all
*events* — a wave breaking, a charge detonating, ice crystallising, a column of snow torn off the
ground — and light coming out of them reads as the energy doing the work. Bent water is just water
being moved; a blue glow under it says the water is luminous, which nothing about it suggests. The
cost is the through-scatter demonstration on this spell; the gain is that the ribbon is lit by the
same sun as everything else.

### 9.14 End vs cancel

`_end()` resets `active / _seeded / thrown / _splashed / _throwT / blend` and releases the strand.
`cancel()` sets `held = false` **first**, then `_end()` — cancelling is the settings toggle or a
lost pointer lock, and neither of those is the player throwing anything.

---

## 10. Spell 3 — BLOOM (`spells/bloom.js`)

> A targeted eruption: a crater with a raised rim, a waisted column that rises and withdraws down
> its own axis, and seconds of fallout curtain lit from below.

Three things run on **different clocks** and that is the whole design:

| Element | Clock |
|---|---|
| the column | fast — up in a third of a second, held for a beat, then it *collapses back down its own axis* rather than fading: the mass goes back where it came from |
| the crater | instant, and permanent. One brush, at the moment of the burst |
| the fallout | slow. Seconds of it, and it is what the player is actually looking at for most of the spell. A burst with no fallout is a flash; a burst with fallout is weather |

### 10.1 Constants

| Identifier | Value | Units |
|---|---|---|
| `COLS` | 34 | samples |
| `HEIGHT` | 5.6 | m — full column height at peak |
| `GIRTH` | 0.66 | m — column radius at its widest |
| `LIFE` | 1.75 | s — cast → column gone |
| `FALLOUT` | 3.4 | s — fallout window after that |

Total spell duration `LIFE + FALLOUT = 5.15 s`.

`GIRTH` matters because the water material's absorption is keyed to the radius: **a thin column is
also a colourless one.**

### 10.2 Trigger

```
if (strand < 0) strand = water.acquire()
(x, y, z) = ground target from aimPoint(maxDist 22, fallback 13)
t = 0;  _burst = false;  _curtainOwed = 0
a = random() * 2π
_leanX = cos(a) * 0.16                       // a different lean each cast, so two Blooms
_leanZ = sin(a) * 0.16                       //   in the same place are not the same object twice
active = true
```

**The column leans.** A perfectly vertical cylinder of water reads as a rendered primitive no
matter what is on it; two degrees of drift with a little sway takes that away completely.

### 10.3 Update

```
t += dt
if (t >= LIFE + FALLOUT) { _end(); return }

if (!_burst && t >= 0.10) {                  // fires ONCE, on the frame the column reaches
    _burst = true                            //   the surface. Everything at that instant —
    _crater()                                //   crater, ring of thrown snow, light spike —
    _throw()                                 //   happens here, not at trigger, so they are
}                                            //   all the same event.
_column()
_curtain(dt)
```

### 10.4 `_column`

```
rise = smooth01((t - 0.10) / 0.34)           // up between 0.10 s and 0.44 s
drop = 1 - smooth01((t - 0.95) / 0.80)       // collapses between 0.95 s and 1.75 s
env  = rise * drop
if (env <= 0.002) { setParams(s, PROFILE_TUBE, 0.5, 0, 0); return }

top  = HEIGHT * env                          // the COLLAPSE runs the HEIGHT back down,
                                             //   not the alpha: the column WITHDRAWS
                                             //   into the crater
sway = sin(t * 3.1) * 0.12

for c in 0..33:
    u = c / 33
    h = 1 - u                                // column 0 is the HEAD, so u runs DOWNWARD,
                                             //   matching every other strand
    y = origin.y + top * h
    lean = h * h                             // quadratic: the top leans, the foot does not
    x = origin.x + (_leanX + sway)        * lean * top * 0.5
    z = origin.z + (_leanZ - sway * 0.6)  * lean * top * 0.5

    if (c > 0):  t1 = normalize(P - Pprev);  transport(r, r, t0, t1);  t0 = t1
    else:        r = (1,0,0);  t0 = (0,-1,0)          // seed frame points DOWN the column

    // flared head, waisted middle, broad foot
    shape = 0.42 + 0.58 * bell(clamp01(h * 1.15))     // waist
          + 0.55 * smooth01((h - 0.72) / 0.28)        // flare at the head
          + 0.75 * (1 - smooth01(h / 0.22))           // broad foot
    rad   = GIRTH * shape * env * (0.9 + 0.2 * sin(u*9 + t*6))

    // the head is where it is coming apart; the foot is where it grinds the crater rim
    foam  = clamp01(0.30 + 0.55 * smooth01((h - 0.55)/0.45)
                        + 0.4  * (1 - smooth01(h / 0.18)))

    water.column(s, c, x, y, z, rad, r.x, r.y, r.z,
                 twist   = t * 1.5 + u * 4,
                 dist    = u * top,
                 age     = u,
                 foam, flatten = 1)

water.setParams(s, PROFILE_TUBE, 0.42, clamp01(env * 1.5), 34)
```

Radius runs **wide at the base, waists in the middle and flares at the head**, which is what a
real ejection does: the mass at the top has had the longest to spread and the least to hold it
together. The `(0.9 + 0.2*sin(u*9 + t*6))` term adds a travelling bulge along the column.

### 10.5 Lights — TWO slots

```
lights.add(x, y + 0.35, z,                    radius 11.0, rgb (0.44, 0.78, 1.0), 22.0 * env)
lights.add(x + _leanX*top*0.5,
           y + top*0.92,
           z + _leanZ*top*0.5,                radius  7.5, rgb (0.55, 0.82, 1.0),  9.0 * env)
```

**The crater light is what actually lights the rim and the fallout around the base, and it is the
reason the effect reads as a hole full of light rather than a bright column standing on dark
ground.** The head light rides the top of the column at 92% of its height.

### 10.6 `_crater` — one deep brush plus a broken outer ring

```
deform.brush(x, z,
    radius      = 1.15,
    depth       = 0.52,      // depression
    berm        = 0.40,      // rim — the mass has to go somewhere and this is where
    compression = 0.72,      // packed by the blast
    ice         = 0.30,      // and partly glazed
    yaw         = random()*π,
    elongation  = 1.15,      // very slightly oval, so it is not a stamped circle
    edge        = 1.0)

for i in 0..3:                                // FOUR smaller brushes, not one wide one:
    a = (i/4)*2π + random()*1.2               //   a crater with a perfectly even rim is
    d = 1.5 + random()*0.7                    //   the tell that gives a single radial
    deform.brush(x + cos(a)*d, z + sin(a)*d,  //   brush away
        radius      = 0.5 + random()*0.35,
        depth       = 0,
        berm        = 0.20 + random()*0.14,
        compression = 0.15,
        ice         = 0,
        yaw a, elongation 1.4, edge 1.0)

rig.addTrauma(0.28)
```

### 10.7 `_throw` — the instant of the burst

```
n = floor(430 * sprayScale)
for each:
    a    = random()*2π
    r    = 0.35 + sqrt(random())*1.25         // biased toward the RIM: that is where mass leaves
    up   = 5.5 + random()*8.5
    out  = 1.6 + random()*5.0
    clod = random() < 0.26 ? 1 : 0
    spray.emit(x + cos(a)*r,  y + 0.10 + random()*0.5,  z + sin(a)*r,
               cos(a)*out,  up * (clod ? 0.7 : 1.0),  sin(a)*out,
               size = clod ? 0.028 + random()*0.038 : 0.075 + random()*0.115,
               life = clod ? 1.1  + random()*0.8   : 1.4  + random()*1.5,
               kind = clod,
               drag = clod ? 0.65 : 1.1 + random()*0.8)   // BALLISTIC, or it never
                                                          //   leaves the crater
```

### 10.8 `_curtain` — the fallout

```
k = smooth01((t - 0.25)/0.5) * (1 - smooth01((t - 0.9)/(FALLOUT*0.9)))
                                              // ramps in 0.25..0.75 s, decays 0.9..3.96 s
                                              // FALLOUT*0.9 = 3.06
if (k <= 0.01) return
rate = 360 * sprayScale * k
_curtainOwed += dt * rate
count = floor(_curtainOwed);  if (count <= 0) return
_curtainOwed -= count;  count = min(count, 60)

for each:
    a = random()*2π
    r = sqrt(random()) * 3.6                  // uniform over a 3.6 m disc
    spray.emit(x + cos(a)*r,
               y + 2.2 + random()*4.2,        // EMITTED ABOVE THE EYE LINE
               z + sin(a)*r,
               (random()-0.5)*0.9,
               0.2 + random()*1.1,
               (random()-0.5)*0.9,
               size 0.028 + random()*0.055,
               life 1.6 + random()*1.9,
               kind 0,                        // fine powder
               drag 4.6)                      // HIGH drag: meant to hang and settle, not fly
```

Fine, slow, high drag, and emitted **above the player's eye line over a wide disc**, so it drifts
down *through the frame* rather than sitting in a cone over the crater. This is the part of the
spell that lasts, and it is where the glinting has the best chance of being seen, since every
grain of it is lit **by the crater light from below**.

---

## 11. Spell 4 — CRYSTALLISE

> Water snaps to ice. A formation grows out of the drift at the aim point, and the patch it grew
> from stays glazed long after the prisms have gone.

**Two mechanisms, and the split matters:**

| | |
|---|---|
| **the formation** | geometry, in `crystals.js`. Grows over ~1.5 s, stands for ~34–42 s, sublimates back into the drift over 6 s. This is the thing the player looks at. |
| **the glaze** | the ice channel of the terrain state buffer, which decays on a fifteen-minute constant. This is what satisfies "permanently altering the surface": the snow shader answers it with a roughness of 0.07 and a genuinely reflective surface, so a Crystallise patch stays visible from across the field as a slick of ice. |

Crystallise is the **only** spell that does not touch the water body. It uses a second mesh, a
second material, its own depth-cascade materials and the only prepass caster that writes a
non-zero specular mask.

### 11.1 `spells/crystallize.js` — the caster

| Identifier | Value | Units |
|---|---|---|
| `PLANT_TIME` | 0.85 | s — whole cast takes this long to finish planting |
| `COUNT` | 34 | crystals in one formation |
| `STAND` | 34 | s the formation stands at full size before sublimating |

#### Trigger — the glaze goes down FIRST

```
(x, y, z) = aimPoint(maxDist 22, fallback 13)
t = 0;  _planted = 0
_seed = random() * 1000
active = true

// The glaze goes down IMMEDIATELY, under where the formation will be, so the ground has
// already changed material by the time the first prism is tall enough to see. Doing it as
// the crystals land instead leaves a beat where ice is standing on ordinary snow.
deform.brush(x, z, radius 1.55,
             depth 0.10, berm 0.16, compression 0.85, ice 1.0,
             yaw random()*π, elongation 1.2, edge 0.85)
for i in 0..2:
    a = random()*2π;  d = 1.1 + random()*1.3
    deform.brush(x + cos(a)*d, z + sin(a)*d,
                 radius 0.55 + random()*0.5,
                 depth 0.04, berm 0.10, compression 0.5, ice 0.75,
                 yaw a, elongation 1.5, edge 1.0)
```

Note `ice = 1.0` on the central brush — the ice channel is taken as a **max**, so this is a
saturating write.

#### Update

```
t += dt

// ---- planting: spread over most of a second so the formation grows OUTWARD from the
//      centre instead of appearing on one frame ----
want = min(COUNT, ceil((t / PLANT_TIME) * COUNT))
while (_planted < want) { _plantOne(_planted); _planted++ }

// ---- light ----
form  = 1 - smooth01((t - PLANT_TIME) / 0.9)      // bright while forming, gone by t = 1.75 s
ember = 0.10 + 0.06 * sin(t * 1.7)                // slow breathing
k     = 0.35 + 12.0 * form
lights.add(x, y + 0.55, z, radius 7.5, rgb (0.52, 0.80, 1.0), intensity k * (1 + ember))

// ---- frost spray ----
if (t < PLANT_TIME + 0.4) _frost(dt)              // i.e. t < 1.25 s

// The SPELL is done once the last prism is in; the CRYSTALS age on their own clock.
if (t > PLANT_TIME + 1.6) active = false          // i.e. t > 2.45 s
```

Ice does not emit. The low ember is justified physically: the snow around a cluster of refracting
prisms under a low sun genuinely does pick up caustic light, and a small amount of it here is what
stops the formation looking like it was pasted on.

#### `_plantOne(i)` — the golden-angle spiral

```
n01 = i / (COUNT - 1)                             // 0 .. 1 across the formation
ang = i * 2.39996323 + _seed                      // GOLDEN ANGLE, radians
r   = 0.18 + sqrt(n01) * 2.05                     // sqrt -> uniform areal density

x = centre.x + cos(ang)*r + (random()-0.5)*0.16
z = centre.z + sin(ang)*r + (random()-0.5)*0.16
y = terrain.heightAt(x, z) - 0.06                 // base SUNK 6 cm into the drift

// Tall in the middle, low at the edges, with enough scatter that the envelope is not a
// readable cone. The centre crystals are chest height on the character, deliberately —
// a knee-height cluster is something the player walks past.
scale  = (1 - n01 * 0.58) * (0.6 + random()*0.8)
height = 1.75 * scale                             // m
radius = 0.15 * scale * (0.7 + random()*0.7)      // m

// Leaning OUTWARD, more so further out — the way a real cluster grows toward the space
// it has.
tilt = 0.10 + n01 * 0.42 * (0.6 + random()*0.8)
ax   = cos(ang)*tilt + (random()-0.5)*0.12
az   = sin(ang)*tilt + (random()-0.5)*0.12

crystals.plant(x, y, z,
               axis = (ax, 1, az),                // ay is ALWAYS 1; tilt is in ax/az
               height, radius,
               growSeconds = 0.45 + random()*0.55,
               life        = STAND + random()*8)  // 34 .. 42 s

// A little snow pushed aside where each one broke the surface — every OTHER crystal only.
if ((i & 1) === 0):
    deform.brush(x, z, radius * 3.2,
                 depth 0.05, berm 0.09, compression 0.4, ice 0.9,
                 yaw ang, elongation 1.2, edge 1.0)
```

**The golden angle (2.39996323 rad ≈ 137.508°) is doing real work.** It is the one rotation that
never repeats a radial line, so no two crystals in a formation line up with each other however
many there are. Any rational fraction of a turn gives visible spokes.

A random scatter reads as scattered; a spiral with the crystals getting shorter as they go out
reads as something that **grew from a centre**, which is what it is.

#### `_frost` — frost thrown off as the ice breaks the surface

```
count = floor(60 * sprayScale * dt)
for each:
    a = random()*2π;  r = random()*1.8
    spray.emit(x + cos(a)*r,  y + 0.05 + random()*0.5,  z + sin(a)*r,
               cos(a)*(0.6 + random()*1.4),
               0.9 + random()*2.4,
               sin(a)*(0.6 + random()*1.4),
               size 0.012 + random()*0.020,
               life 0.7 + random()*0.9,
               kind random() < 0.4 ? 1 : 0,
               drag 2.4)
```

`cancel()` simply sets `active = false` — planted crystals are **not** retired, they age out.

### 11.2 `spells/crystals.js` — the pooled ice field

| Identifier | Value | Note |
|---|---|---|
| `CRYSTAL_MAX` | 96 | pool size — two full formations' worth |
| `VERTS` | 13 | vertices per crystal: two rings of six plus an apex |
| `RING` | 6 | hexagon |
| `CRYSTAL_CASCADES` | 2 | how many shadow cascades a 40 cm prism is worth drawing into |
| sublimation time | 6.0 s | fixed, after `life` expires |

#### Data texture

```
format   RGBA32F, NEAREST, CLAMP/CLAMP
width    CRYSTAL_MAX = 96          (one column per crystal)
height   3
backing  Float32Array(96 * 3 * 4) = 1152 floats
```

| Row | `.r` | `.g` | `.b` | `.a` |
|---|---|---|---|---|
| 0 | base X | base Y | base Z | **height** (m at full growth) |
| 1 | axisX | axisY | axisZ | **base radius** (m at full growth) |
| 2 | **growth** 0..1 | **seed** | tint (unused, 0) | spare (0) |

Row addressing in JS: `w = CRYSTAL_MAX * 4 = 384`; crystal `i` row `n` starts at `n*w + i*4`.

#### CPU-side lifetime arrays (deliberately NOT in the texture — no shader reads them, and
packing them there would mean re-uploading merely to age)

```
age[96], life[96], grow[96] : Float32Array
alive[96]                   : Uint8Array
_next                       : round-robin allocation cursor
```

#### `plant(x, y, z, ax, ay, az, height, radius, growSeconds, life)`

```
i = _next
for n in 0..95:
    if (!alive[i]) break
    i = (i + 1) % 96
    if (n === 95) return          // pool full: DROP the new crystal. Hunting for the oldest
                                  //   formation costs more than it is worth; losing one prism
                                  //   out of a cluster of 40 is invisible.
_next = (i + 1) % 96

texRow0[i] = (x, y, z, height)
texRow1[i] = (ax, ay, az, radius)
texRow2[i] = ( 0, seed, 0, 0 )
    where seed = (i * 0.618034 + x * 0.137 + z * 0.311) % 1

age[i] = 0;  life[i] = life;  grow[i] = max(growSeconds, 0.05);  alive[i] = 1
_dirty = true
```

The `0.618034` is the golden-ratio conjugate — it decorrelates the per-crystal hexagon wobble
between adjacent pool slots.

#### `update(dt, cameraPos)` — ageing

```
growRow = w * 2
live = 0
for i in 0..95:
    if (!alive[i]) continue
    age[i] += dt
    a = age[i];  life_ = life[i]

    if (a < grow[i])       g = a / grow[i]
    else if (a < life_)    g = 1
    else:
        tt = (a - life_) / 6.0                  // SUBLIMATION over 6 s
        if (tt >= 1) { alive[i] = 0; tex[growRow + i*4] = 0; _dirty = true; continue }
        g = 1 - tt                              // the prism RETREATS rather than fading,
                                                //   so it goes back into the drift it came
                                                //   out of. Nothing pops.
    tex[growRow + i*4] = g
    live++

liveCount = live
mesh.isVisible = live > 0 && S.showSpells !== false
if (mesh.isVisible || _dirty) { dataTex.update(tex); _dirty = false }
if (mesh.isVisible) _pushUniforms()
```

Triangle accounting: `liveCount * (RING * 3)` = `liveCount * 18`.

#### Static mesh (baked once)

```
positions = Float32Array(96 * 13 * 3)          // position = (crystalIndex, vertexIndex, 0)
indices   = Uint32Array(96 * 6 * 3 * 3)        // 5184 indices = 1728 triangles

for i in 0..95:
    for v in 0..12:  position = (i, v, 0)
    b = i * 13
    for k in 0..5:
        k2   = (k + 1) % 6
        b0   = b + k;        b1   = b + k2
        s0   = b + 6 + k;    s1   = b + 6 + k2
        apex = b + 12
        emit (b0, s0, s1), (b0, s1, b1)        // side quad -> 2 triangles
        emit (s0, apex, s1)                    // tip       -> 1 triangle
```

18 triangles per crystal. **A crystal that is not alive has zero growth ⇒ zero height ⇒ every one
of its triangles collapses onto its base point.** Same switch-off mechanism as the water strands.

#### Material state

```
vertex/fragment   "crystal"
attributes        ["position"]
samplers          crystalTex, skyLUT, cascade0..2
backFaceCulling   false      // a prism is a closed solid, but a dead crystal's triangles are
                             //   degenerate and a growing one is very thin — culling buys
                             //   nothing and costs a black inside face where winding flips
alphaMode         ALPHA_COMBINE
needAlphaBlending () => true
disableDepthWrite false
forceDepthWrite   true       // <-- BLENDED **AND** DEPTH-WRITING
renderingGroupId  1          // OPAQUE group, with the terrain
shadowSoftness    1.3
shadowBias        0.012
```

**Blended AND depth-writing is the whole trick.** The usual pair of options is opaque (correct
depth, no transparency) or alpha-blended with depth write off (transparency, no depth). Neither is
right for a cluster of forty overlapping prisms: the first gives blue spikes, the second gives a
grey smear where every prism blends over every other one in index order.

Writing depth while blending gives the third thing: the first surface at a pixel blends over
whatever the terrain and the character already put there — **so you genuinely see the snow through
the ice** — and every surface *behind* it is depth-rejected, **so no crystal is ever blended over
another one**. The result is order-dependent in principle and completely stable in practice,
because the only thing the order decides is which face of a solid you see, and any of them is a
correct answer.

#### Three pipelines, all sharing `crystalPoint`

1. **Beauty** — `crystal.vertex` + `crystal.fragment`.
2. **Shadow depth** — `crystalDepth.vertex` + `terrainDepth.fragment`, registered for
   `CRYSTAL_CASCADES = 2` cascades, `defines: ["CRYSTAL_CASCADE " + cascade]`, uniform
   `lightViewProjection`. Runs the identical `crystalPoint`, **including the growth curve**, so
   the shadow grows with the crystal rather than snapping to full size on the frame it is planted.
3. **Depth prepass** — `crystalPrepass.vertex` + `prepass.fragment`, uniform `viewProjection`,
   writes `vViewZ = clip.w` and `vMask = 1.0`.

**The crystals are the ONLY caster that writes a non-zero specular mask, and that is the only
reason the mask channel exists:** ice is the sole mirror in a field of matte snow, so the SSR pass
can early-out on the mask and cost nothing on every frame where nobody has cast Crystallise.

The water body is deliberately **not** registered with the prepass: it is translucent and
refractive, so a depth for it would tell every screen-space consumer that the snow behind it is not
there — exactly wrong for a medium you can see through.

#### Warm-up

```
plant(x, y + 0.02, z, axis (0.1, 1, 0.05), height 0.6, radius 0.09, grow 0.2, life 999)
update(0.21, camPos)              // advance past the grow window so a real prism exists
mesh.isVisible = true
_pushUniforms()
await whenReady(material) ; await whenReady(each depth material) ; await whenReady(prepass)
```

Left standing through the warm-up frames. Hiding the mesh here moved a measured **156 ms** hitch
onto the first cast. `finishWarmUp()` clears `alive[]`, zeroes the texture, uploads, and hides.

### 11.3 `shaders/lib/crystal.wgsl` — the prism

```wgsl
const CRYSTAL_RING:  i32 = 6;
const CRYSTAL_VERTS: i32 = 13;

fn crystalLocal(v: i32, height: f32, radius: f32, seed: f32) -> vec3f {
    if (v >= CRYSTAL_VERTS - 1) {
        // Apex, nudged off the axis so the point is not perfectly centred.
        let j = hash22(vec2f(seed, 7.31)) - 0.5;
        return vec3f(j.x * radius * 0.5, height, j.y * radius * 0.5);
    }

    let ring = v / CRYSTAL_RING;                          // 0 = base, 1 = shoulder
    let k    = v - ring * CRYSTAL_RING;
    let ang  = f32(k) * 1.04719755 + seed * 6.2831853;    // 60 degrees apart, +seed roll
    let wob  = 0.72 + 0.56 * hash21(vec2f(f32(k) + seed * 31.0, seed * 17.0));

    let r = select(radius * wob, radius * wob * 0.68, ring == 1);
    let y = select(0.0,          height * 0.58,       ring == 1);
    return vec3f(cos(ang) * r, y, sin(ang) * r);
}
```

One crystal is a **six-sided tapered prism with a point on it**: a base ring in the snow, a
shoulder ring at 58% height and 68% radius where the taper starts, and an apex. That is
deliberately the whole model — the read comes from the *cluster*, from the light through it, and
from the fact that it grows. A more elaborate single crystal costs vertices and buys nothing at
this range.

**The per-crystal `seed` breaks the hexagon.** Each of the six radial directions gets its own
length multiplier `wob ∈ [0.72, 1.28]`, so no two crystals in a cluster share a silhouette and
none of them is a regular hexagon — which reads as manufactured immediately.

```wgsl
fn crystalPoint(tex: texture_2d<f32>, i: i32, v: i32) -> vec3f {
    let a = textureLoad(tex, vec2i(i, 0), 0);   // (pos, height)
    let b = textureLoad(tex, vec2i(i, 1), 0);   // (axis, radius)
    let c = textureLoad(tex, vec2i(i, 2), 0);   // (growth, seed, -, -)

    let g  = clamp(c.x, 0.0, 1.0);
    // HEIGHT LEADS, GIRTH FOLLOWS.
    let gh = g * g * (3.0 - 2.0 * g);           // smoothstep
    let gr = smoothstep(0.25, 1.0, g);          // starts 25% into growth
    let height = a.w * gh;
    let radius = b.w * (0.22 + 0.78 * gr);      // never below 22% of full radius

    let local = crystalLocal(v, height, radius, c.y);

    // Frame from the growth axis. Any stable perpendicular will do; the shape is already
    // randomised about the axis by `seed`.
    let axis = normalize(select(b.xyz, vec3f(0.0, 1.0, 0.0), dot(b.xyz, b.xyz) < 1e-6));
    let ref2 = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(axis.y) < 0.9);
    let ex   = normalize(cross(ref2, axis));
    let ez   = cross(axis, ex);

    return a.xyz + ex * local.x + axis * local.y + ez * local.z;
}
```

**`growth` is not a uniform scale.** A crystal shoots up first and thickens after, the way real
freezing does along the fastest-growing axis, so height and radius run on **two different curves
off the one parameter**. A crystal that scales uniformly reads as a model being lerped in; one
that spears up and then thickens reads as ice forming.

### 11.4 `crystal.vertex.wgsl`

```wgsl
let i = i32(position.x);        // crystal index
let v = i32(position.y);        // vertex index 0..12

let a = textureLoad(crystalTex, vec2i(i, 0), 0);
let c = textureLoad(crystalTex, vec2i(i, 2), 0);
let P = crystalPoint(crystalTex, i, v);

vWorld    = P;
vBase     = a.xyz;
vHeight01 = clamp((P.y - a.y) / max(a.w, 1e-3), 0.0, 1.0);   // fraction UP the crystal
vSeed     = c.y;
vGrowth   = c.x;
vViewDist = distance(P, cameraPos);
position  = viewProjection * vec4f(P, 1.0);
```

**No normal is emitted.** The fragment shader takes it from the derivatives of the world position,
which gives exact flat facets for free — and a facet is what an ice crystal is. Interpolated vertex
normals would round the edges off and turn a crystal into a lumpy cone, which is the one thing it
must not look like.

`vHeight01` is measured against the **full** height `a.w`, not the grown height, so a half-grown
crystal's tip reports ~0.5 and stays frosted longer. That is intentional: the base is buried in the
drift and milky, the tip is clear and lit through.

### 11.5 `crystal.fragment.wgsl`

What sells this spell is not the geometry. It is that a facet of clear ice does **three different
things depending on where you stand relative to it**, all at once and all sharply divided by the
facet edges:

| | |
|---|---|
| near grazing | almost a mirror. Fresnel at 0.021 base reflectance still returns nearly everything at 80°, and against this scene's low warm sun that is a hard bright edge. |
| head on | you see through it, bent, and tinted by the path — which on a 30 cm crystal is a real blue, because ice absorbs red about fifteen times faster than blue. |
| backlit | it glows. Ice scatters internally at every inclusion and bubble, and a crystal with the sun behind it lights up along its whole length rather than going to silhouette. |

#### Flat facet normal from derivatives

```wgsl
let dx = dpdx(world);
let dy = dpdy(world);
var N = normalize(cross(dx, dy));
if (dot(N, V) < 0.0) { N = -N; }
let geoN = N;
```

**That hard edge is what makes the material read:** adjacent facets of one prism return wildly
different amounts of sky, and that facet-to-facet jump *is* the look of ice.

#### Frost — confined to the bottom fifth

```wgsl
let grain = noise2(world.xz * 34.0 + input.vSeed * 19.0) * 0.5 + 0.5;
let frost = clamp(
    (1.0 - smoothstep(0.01, 0.22, input.vHeight01)) * (0.45 + 0.6 * grain),
    0.0, 1.0
);
```

Where the crystal comes out of the drift it is not clear — it is packed with the snow it grew
through. **That gradient is what attaches it to the ground**; without it a crystal looks placed on
the surface rather than grown out of it, which is the single failure this effect cannot afford.
Confined to `vHeight01 ∈ [0.01, 0.22]`: any more and it is a white prism with a clear tip rather
than an ice prism standing in snow.

#### Absorption

```wgsl
const ICE_ABSORB: vec3f = vec3f(2.35, 0.60, 0.24);      // per metre

let path = clamp(
    (0.16 + 0.42 * (1.0 - input.vHeight01)) * (0.7 + 2.0 * (1.0 - NdotV)),
    0.02, 1.4
);
let transmit = exp(-ICE_ABSORB * path);
```

Real ice is roughly `(1.5, 0.35, 0.10)`; this is a little stronger so a hand-sized crystal shows
the colour a glacier-sized one really would — but not so strong that the whole formation saturates
to one flat blue, **which is what 4.2 in red did**.

The path is long across a facet seen edge-on, short through one seen face-on, and longer near the
thick base than at the tip. The constant term `0.16` carries the colour through the middle of the
prism; a path that only opens up at grazing puts all the blue on the silhouette where Fresnel then
replaces it with sky.

#### Refraction — same construction as the water, tighter IORs and a sharper mip

```wgsl
let mirror = reflect(-V, N);
let rr = refract(-V, N, 1.0 / 1.3050);
let rg = refract(-V, N, 1.0 / 1.3090);
let rb = refract(-V, N, 1.0 / 1.3170);
let dr = select(mirror, rr, dot(rr, rr) > 0.5);
let dg = select(mirror, rg, dot(rg, rg) > 0.5);
let db = select(mirror, rb, dot(rb, rb) > 0.5);

let behind = vec3f(
    textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(dr), 0.9).r,
    textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(dg), 0.9).g,
    textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(db), 0.9).b
);
var color = behind * transmit;
```

Ice IORs `1.3050 / 1.3090 / 1.3170` (water was `1.3300 / 1.3330 / 1.3400`). Refraction mip **0.9**
(water used 1.6) — ice facets are flat, so the background through them stays sharper.

#### Internal transport

```wgsl
let through  = backScatter(N, L, V, 0.42, 2.2, 1.0);
let deepTint = mix(vec3f(0.42, 0.74, 1.0), vec3f(0.86, 0.95, 1.0), exp(-path * 2.5));
color += sun * INV_PI * deepTint * through * sssStrength * 1.6 * mix(0.25, 1.0, shadow);

// Sky through the body — what keeps a crystal standing in shadow alive rather than black.
color += shIrradiance(N, shR) * ambientIntensity * INV_PI * deepTint * 0.9;
```

#### Frosted skin

```wgsl
if (frost > 0.002) {
    let fa = vec3f(0.88, 0.915, 0.965);
    var fc  = fa * INV_PI * sun * wrapDiffuse(NdotL, 0.62) * shadow;
    fc += fa * INV_PI * shIrradiance(N, shR) * ambientIntensity;
    fc += snowSubsurface(N, L, V, sun, 0.4, sssStrength, 1.3) * fa * mix(0.4, 1.0, shadow);
    color = mix(color, fc, frost * 0.9);
}
```

#### Surface

```wgsl
let rough   = mix(0.045, 0.42, frost);
let F       = fresnelSchlick(NdotV, vec3f(0.021));
let skyRefl = textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(mirror), rough * 6.0).rgb;
color = mix(color, skyRefl, F * (1.0 - frost * 0.75));

if (NdotL > 0.0) {
    let H   = normalize(V + L);
    let D   = distributionGGX(clamp(dot(N, H), 0.0, 1.0), rough);
    let Vis = visSmithGGXCorrelated(NdotV, NdotL, rough);
    let Fs  = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), vec3f(0.021));
    color += sun * D * Vis * Fs * NdotL * shadow;
}
```

Note: **Fresnel is NOT capped here** (the water caps at 0.72). Ice is allowed to go to a full
mirror at grazing. Reflection mip is driven by roughness, `rough * 6.0`.

#### Glints and spell light

```wgsl
if (glintIntensity > 0.001) {
    let g = snowGlints(world.xz, N, V, L,
                       max(length(dx.xz) + length(dy.xz), 1e-4),
                       glintIntensity * (0.4 + 1.2 * frost), glintGrazing);
    color += sun * g * shadow * 0.6;
}

if (spellLightCount > 0.5) {
    color += spellLightingSurface(
        world, N, V,
        mix(vec3f(0.3, 0.6, 0.85), vec3f(0.88), frost),
        vec3f(0.021), rough, 0.5,
        spellLightPos, spellLightCol, spellLightCount);
}
```

Glints use `world.xz` directly (the water used the oblique slice `fp`), and a different footprint
estimator: `length(dx.xz) + length(dy.xz)` rather than the water's `length(vec2(...))`.

#### Aerial, then opacity

```wgsl
color = applyAerial(color, cameraPos, world, -V, L, skyLUT, skyLUTSampler, sun,
                    fogDensity, fogHeightFalloff, fogStart, aerialStrength);

let alpha = clamp(
    0.46                                    // floor: a crystal never disappears against the field
  + 0.34 * (1.0 - exp(-path * 2.2))         // path   — a thin tip is nearly clear
  + 0.26 * (1.0 - NdotV)                    // grazing — a facet seen edge-on is opaque
  + frost * 0.55,                           // frost   — packed with snow, not transparent at all
    0.0, 1.0
);
fragmentOutputs.color = vec4f(color, alpha);
```

**Aerial perspective is applied BEFORE the alpha here**, and the alpha never reaches 0 — floor 0.46.

---

## 12. Spell 5 — VORTEX (`spells/vortex.js`)

> Three helices of lifted snow winding around the player, with the airborne mass emitted along
> those same helices at their own tangential velocity. **The only system that writes a NEGATIVE
> depression.**

The stripping is the point, and it is the one thing no other spell does: this is the only effect
that takes the terrain state buffer *back*. A brush with a negative depression is a perfectly
ordinary brush as far as the simulation is concerned — the accumulation is additive and the clamp
floors it at zero — so "remove snow from a ring" and "put it back" are the same code path as
everything else, with a sign on it.

The airborne mass is two systems working from **one description**:

| | |
|---|---|
| **three helices** | swept tubes of dense slush, wound around the player and rotating. These give the column a readable *shape*; a vortex made only of particles is a cloud, and a cloud does not spiral. |
| **the grains** | emitted continuously *along those same helices*, with the helix's own tangential velocity, and short-lived enough that they never get far from the path that launched them. Nothing in the particle system knows this is a vortex — the swirl is entirely in where and how the grains are born. |

### 12.1 Constants

| Identifier | Value | Units | Note |
|---|---|---|---|
| `HELICES` | 3 | — | three reads as a spiral; two reads as a double helix |
| `COLS` | 64 | samples | the tightest curve anything here draws |
| `RAMP` | 0.55 | s | |
| `HOLD` | 3.0 | s | full-strength spin |
| `FADE` | 1.1 | s | |
| `TOP` | 4.8 | m | height of the column |
| `TURNS` | 1.35 | turns | each helix makes this many from ground to top |

Total duration `RAMP + HOLD + FADE = 4.65 s`. Hold ends at `t = 3.55 s`.

**Vortex claims THREE strands** out of the pool of eight.

### 12.2 Trigger and update

```
trigger():
    for i in 0..2: if (strands[i] < 0) strands[i] = water.acquire()
    t = 0;  ring = 0.9;  _stripOwed = 0;  _grainOwed = 0;  active = true
    // rig.addTrauma(0.10) is added by SpellSystem.cast

update(dt):
    t += dt
    if (t >= RAMP + HOLD + FADE) { _end(); return }

    // The column FOLLOWS THE PLAYER. It is *their* vortex — walking out of it would be
    // the single most effect-like thing it could do.
    x = controller.position.x
    z = controller.position.z

    env = smooth01(t / RAMP) * (1 - smooth01((t - RAMP - HOLD) / FADE))

    // Spins up and KEEPS SPINNING: the rotation does not ease out with the envelope,
    // so the last frame is a fading column that is still turning rather than one that
    // is winding down.
    spin += dt * (5.2 + 2.4 * env)             // rad/s

    _helices(env);  _strip(dt, env);  _grains(dt, env)

    lights.add(x, terrain.heightAt(x, z) + 1.3, z,
               radius 9.0, rgb (0.46, 0.74, 1.0), intensity 9.0 * env)
```

### 12.3 `_helices(env)` — three strands, 64 columns each

```
groundY = terrain.heightAt(x, z)

for hIdx in 0..2:
    s = strands[hIdx];  if (s < 0) continue
    phase = (hIdx / 3) * 2π                    // 0, 2π/3, 4π/3
    dist = 0;  r = (1,0,0);  t0 = (1,0,0)

    for c in 0..63:
        u = c / 63
        h = 1 - u                              // column 0 is the TOP of the helix — the
                                               //   leading edge of the lift — so u runs DOWN
        ang = phase + spin + h * TURNS * 2π

        // Wide at the bottom where it is picking snow up, narrower and faster at the top.
        // NOT a cone: the waist is what makes it read as a vortex rather than a party hat.
        rad_h = (2.55 - 1.15 * h) * (0.78 + 0.34 * bell(clamp01(h * 1.2)))

        X = x + cos(ang) * rad_h
        Z = z + sin(ang) * rad_h
        Y = groundY + TOP * h * env + 0.05

        if (c > 0):
            t1 = normalize(P - Pprev);  dist += |P - Pprev|
            transport(r, r, t0, t1);  t0 = t1
        else:
            r = (0, 1, 0)                      // seed frame is world UP

        // Both ends taper to nothing: the top because the snow is dispersing, the bottom
        // because it is still on the ground. THIN — the helices are here to give the column
        // a readable SHAPE, not to be the column: the mass is the grains, and a fat ribbon
        // turns the spell into three solid loops with some snow near it.
        // Monotonic in u, ONE slow modulation and nothing else.
        taper = bell(u * 0.92 + 0.04)
        rad   = 0.125 * taper * env * (0.78 + 0.34 * sin(u * 3.4 + ctx.time * 2.2 + hIdx))

        water.column(s, c, X, Y, Z, rad,
                     r.x, r.y, r.z,
                     twist = ctx.time * 0.7 + hIdx * 2.1,      // NO distance term
                     dist,
                     age  = u,
                     foam = 0.22 + 0.3 * (1 - h),
                     flatten = 1)

    water.setParams(s, PROFILE_TUBE, milkiness 0.88, clamp01(env * 1.3), 64)
```

**Two anti-vertebrae rules are encoded here and both are load-bearing:**

1. **The radius modulation is monotonic in `u` with exactly one slow term.** Several terms keyed
   to world distance reach the sample Nyquist and pinch the tube shut wherever their zeros line
   up, which reads as vertebrae. Anything finer than the samples can carry has to live in the
   relief field, which is band-limited on purpose.

2. **The section roll carries NO distance term.** A roll that advances along the spine spirals
   everything keyed to the section angle — *including the relief field* — so the surface comes out
   cut with a screw thread, which on a thin tube reads as vertebrae. The Ribbon wants that spiral
   because it has an elliptical section and the twist is the point; a round section gains nothing
   from it but the artefact.

**Milkiness 0.88** — almost entirely opaque: this is lifted snow, not water. The small amount of
transparency left is what lets the far side of the column show through the near side, which is most
of what makes it read as a rotating volume. (Recall §6.12: milk 0.88 also removes 88% of the
specular surface, or it comes out looking like moulded plastic.)

### 12.4 `_strip(dt, env)` — the negative-depression writer

The ring grows outward while the spell holds and retreats while it fades, so the snow **comes back
from the outside in** — which is what settling snow does, since the outermost material was lifted
the least far.

```
holding = t < RAMP + HOLD                       // t < 3.55 s
ring = holding ? min(3.1, ring + dt * 0.85)
                : max(0.9, ring - dt * 2.2)

_stripOwed += dt
if (_stripOwed < 1/45) return                   // 45 Hz throttle
k = min(_stripOwed, 0.05);  _stripOwed = 0

N = 9
give = holding ? -1 : 1

for i in 0..8:
    // Rotating WITH the column, so the ring is scoured rather than stamped:
    // a fixed set of angles leaves nine radial scars.
    a = (i/9) * 2π + spin * 0.6
    r = ring * (0.82 + random() * 0.3)
    deform.brush(x + cos(a)*r, z + sin(a)*r,
        radius      = 0.55,
        depth       = holding ?  0.95 * k * env  :  -1.7 * k,
        berm        = holding ?  0.05 * k * env  :   0.85 * k,
        compression = holding ?  0.30 * k * env  :  -0.6 * k,
        ice         = 0,
        yaw         = a + π/2,
        elongation  = 1.9,
        edge        = 1.0)
```

**Holding:** take snow away — depression up, essentially no berm, *because the mass is in the air
rather than piled at the rim*.

**Fading:** put it back — **depression −1.7 k** (negative, so the terrain sim's additive
accumulation *fills*), plus a real berm 0.85 k, *because what lands is broken snow sitting proud of
what it fell on*, plus **negative compression −0.6 k** because fresh fallen snow is loose.

Note that during fade the writes are **not scaled by `env`** — the giving-back happens at full
strength even as the visual fades out, which is what makes the ground end up refilled.

### 12.5 `_grains(dt, env)` — airborne mass on the same helices

```
if (!spray || env < 0.05) return
rate = 2600 * sprayScale * env                 // the highest emission rate in the demo
_grainOwed += dt * rate
count = floor(_grainOwed);  if (count <= 0) return
_grainOwed -= count;  count = min(count, 260)

groundY = terrain.heightAt(x, z)

for each:
    h    = random() * random()                 // WEIGHTED TOWARD THE BOTTOM, where the snow
                                               //   is being picked up
    hIdx = floor(random() * 3)
    phase = (hIdx / 3) * 2π
    ang   = phase + spin + h * TURNS * 2π + (random() - 0.5) * 0.9
    r     = (2.55 - 1.15*h) * (0.78 + 0.34*bell(clamp01(h*1.2))) * (0.85 + random()*0.35)

    cs = cos(ang);  sn = sin(ang)
    // TANGENTIAL: perpendicular to the radius, in the direction of spin.
    speed = 7.5 - 2.6 * h
    vx = -sn * speed
    vz =  cs * speed

    spray.emit(
        x + cs * r,
        groundY + TOP * h * env + 0.06 + random() * 0.2,
        z + sn * r,
        vx + cs * (random() - 0.6) * 1.2,      // slight inward bias (note the -0.6, not -0.5)
        1.4 + random() * 3.4 + (1 - h) * 2.5,  // grains born low get thrown highest
        vz + sn * (random() - 0.6) * 1.2,
        size 0.028 + random() * 0.062,
        life 0.30 + random() * 0.26,           // SHORT
        kind 0,
        drag 0.9)                              // LOW drag: it holds the launch velocity for
                                               //   its whole life, which keeps it on the spiral
```

The radius formula is **character-for-character the same expression the helix mesh uses**, times a
random jitter `(0.85 + random()*0.35)`. That is what makes the grains and the geometry agree: the
grains leave the curve the mesh is actually drawing, the same trick the surf plume uses to leave
the crest.

Life 0.30–0.56 s is short enough that a straight-line integration never visibly departs from the
curve it was launched along.

### 12.6 End

`_end()` / `cancel()`: `active = false`; release all three strands, set each to −1.

---

## 13. The four-slot pooled dynamic light layout

### 13.1 CPU side — `spells/spellLights.js`

```
MAX_SPELL_LIGHTS = 4
SPELL_LIGHT_UNIFORMS = ["spellLightPos", "spellLightCol", "spellLightCount"]

pos : Float32Array(4 * 4)     // (x, y, z, radius m) per slot
col : Float32Array(4 * 4)     // (r, g, b, intensity) per slot
count : number
scale : number                // S.spellLight, the overlay multiplier
```

```
begin():                       // once, BEFORE the spells update
    count = 0

add(x, y, z, radius, r, g, b, intensity):
    if (count >= 4) return                       // dropped SILENTLY
    if (intensity <= 0 || radius <= 0) return
    i = count++
    pos[i*4 .. i*4+3] = (x, y, z, radius)
    col[i*4 .. i*4+3] = (r, g, b, intensity * scale)

apply(material):                                 // AFTER the last declaration
    material.setArray4("spellLightPos", pos)     // WHOLE array, always
    material.setArray4("spellLightCol", col)
    material.setFloat ("spellLightCount", count)
```

Nothing is retained between frames, so **a spell that stops updating stops lighting with no
teardown.**

Dropping the fifth light in a frame is the right failure: it is by definition the least important
one on screen, and the alternative — growing the array — means a shader loop the whole snow field
pays for.

**The whole array goes up whether or not every slot is live.** A partial upload would leave the
tail holding a stale radius, and the shader's own gate is the *count*, not the contents.

### 13.2 Who declares what

| Spell | Slots | Position | Radius | Colour (linear, unnormalised) | Intensity |
|---|---|---|---|---|---|
| Sweep | 1 | arc centre, `y + height*0.55` | 9.5 | (0.42, 0.74, 1.00) | 13.0 · env |
| Ribbon | **0** | — | — | — | — |
| Bloom (crater) | 1 | target, `y + 0.35` | 11.0 | (0.44, 0.78, 1.00) | 22.0 · env |
| Bloom (head) | 1 | `lean·top·0.5`, `y + top*0.92` | 7.5 | (0.55, 0.82, 1.00) | 9.0 · env |
| Crystallise | 1 | target, `y + 0.55` | 7.5 | (0.52, 0.80, 1.00) | (0.35 + 12.0·form)·(1+ember) |
| Vortex | 1 | player, ground + 1.3 | 9.0 | (0.46, 0.74, 1.00) | 9.0 · env |

Every colour is a cold blue-cyan with blue pinned at 1.0. Peak intensity across all five is
Bloom's crater light at **22.0**.

Worst case simultaneous: Bloom (2) + Vortex (1) + Sweep (1) = exactly 4. A fifth is dropped.

### 13.3 Consumers — six materials, one include

Registered in `main.js`:

```
spells.addConsumers(terrain.material, figure.bodyMat, figure.clothMat,
                    wake.material, spray.material);
// plus the two the SpellSystem owns: water.material and crystals.material
```

They are **pushed rather than pulled** because the pool is only complete once every spell has
declared, which is later in the frame than any of these systems runs. Registering them in one
place keeps "who is lit by a spell" a single list in one file instead of a `lights.apply()` call
scattered across five unrelated `_pushUniforms`.

### 13.4 `shaders/lib/spellLights.wgsl`

**Contract** — a material including this must declare:

```wgsl
uniform spellLightPos:   array<vec4f, 4>    // xyz world, w radius in metres
uniform spellLightCol:   array<vec4f, 4>    // rgb colour, w intensity
uniform spellLightCount: f32
```

and must include `<snowShading>` first, for `wrapDiffuse` and `snowSubsurface`.

#### Windowed inverse square

```wgsl
const SPELL_LIGHT_MAX: i32 = 4;

fn spellAttenuation(dist2: f32, radius: f32) -> f32 {
    let t2 = dist2 / max(radius * radius, 1e-4);
    if (t2 >= 1.0) { return 0.0; }
    let win = 1.0 - t2 * t2;
    return win * win / (dist2 + 0.25);
}
```

* **Pure 1/d² never reaches zero**, so a light with any reach at all keeps writing a faint wash
  across the entire clipmap — which reads as *the fog density changing whenever a spell is cast*.
  The window `(1 - t²)²` forces it to exactly zero at `radius`, and the fourth power keeps the
  falloff physical everywhere except the last fifth of the way out.
* **The `+ 0.25` in the denominator is a soft core.** Without it the term runs away at the light's
  own position, and every spell that puts its emitter on the snow — which is most of them — burns a
  clipped white disc into the ground.

#### `spellLighting` — the SNOW response (the headline)

```wgsl
fn spellLighting(world, N, V, albedo, thickness, sssStrength, sssRadius,
                 lightPos, lightCol, count) -> vec3f {
    var acc = vec3f(0.0);
    let n = i32(count);
    for (var i = 0; i < SPELL_LIGHT_MAX; i++) {
        if (i >= n) { break; }
        let p = lightPos[i];
        let d = p.xyz - world;
        let dist2 = dot(d, d);
        let att = spellAttenuation(dist2, p.w);
        if (att <= 0.0) { continue; }

        let L = d * inverseSqrt(max(dist2, 1e-8));
        let radiance = lightCol[i].rgb * lightCol[i].w * att;

        acc += albedo * (1.0 / PI) * wrapDiffuse(dot(N, L), 0.66) * radiance;
        acc += snowSubsurface(N, L, V, radiance, thickness, sssStrength, sssRadius) * albedo;
    }
    return acc;
}
```

> **Every light here runs the identical `snowSubsurface` the sun runs.** That is the whole point.
> Stand a glowing ribbon of water on a berm and the near face goes bright while the **far side of
> the crest glows through**, because the light entered the snow and came back out. Dropping that
> term and keeping only the diffuse is the difference between a spell that *lights the snow* and a
> spell that has a *decal of light* under it.

`thickness` and `sssRadius` are the same numbers the sun's term uses, so a compressed trench
answers a spell exactly as it answers the sun — tighter, darker, less scattering — without any of
that being restated here.

Wrap constant for snow: **0.66**.

`snowSubsurface(N, L, V, lightColor, thickness, strength, radius)` in full:

```wgsl
let shallowTint = vec3f(0.94, 0.965, 1.0);
let deepTint    = vec3f(0.55, 0.72,  1.0);
let tint = mix(shallowTint, deepTint, clamp(thickness * radius, 0.0, 1.0));
let back = backScatter(N, L, V,
                       0.28 * radius,             // distortion
                       mix(3.0, 9.0, thickness),  // power  — DEEP snow = TIGHTER lobe
                       mix(1.0, 0.30, thickness));// amplitude — DEEP snow = DIMMER
return lightColor * tint * back * strength;
```

Both lobe width and amplitude run the *opposite* way to first glance: a **thin** edge transmits
brightly over a wide range of angles because the path through it is short from almost anywhere.
Deep snow transmits little and only close to straight-through. Having deep snow carry the broader
lobe lights the whole open field evenly and reads as haze rather than translucency.

#### `spellLightingSurface` — non-snow (fabric, fur, water, ice)

```wgsl
acc += albedo * (1.0 / PI) * wrapDiffuse(dot(N, L), wrap) * radiance;
if (NdotL > 0.0) {
    let H = normalize(V + L);
    let D   = distributionGGX(clamp(dot(N, H), 0.0, 1.0), roughness);
    let Vis = visSmithGGXCorrelated(NdotV, NdotL, roughness);
    let F   = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), f0);
    acc += radiance * D * Vis * F * NdotL;
}
```

Diffuse plus a GGX lobe, with a **caller-sized wrap**: wool wraps a long way, wet ice barely at
all. **No transmission**, because the materials that want it (the robe's thin under-layer, the
water body itself) already have their own and would double-count.

#### `spellLightingParticle` — airborne snow

```wgsl
acc += albedo * (1.0 / PI) * wrapDiffuse(dot(N, L), 0.8) * lightCol[i].rgb * lightCol[i].w * att;
```

A billboarded grain has no thickness worth modelling, so this is a single wide-wrap (0.8) term.
Cheap, because the spray is the one system that can have three thousand alpha-blended instances in
flight. This is why a Bloom's fallout curtain reads as *lit from within* rather than as grey powder
over a glow.

#### Call-site parameters, all six consumers

| Material | Function | albedo | thickness / f0 | strength / roughness | radius / wrap |
|---|---|---|---|---|---|
| `snow.fragment` | `spellLighting` | surface albedo | `thickness` | `sssStrength*(1-rockExposed)` | `sssRadius` |
| `wake.fragment` | `spellLighting` | surface albedo | `thickness` | `sssStrength*0.45` | `1.5` |
| `spray.fragment` | `spellLightingParticle` | grain albedo | — | — | wrap 0.8 (fixed) |
| `char.fragment` | `spellLightingSurface` (×`ao`) | cloth albedo | `vec3(0.035)` | `roughness` | wrap `0.35` |
| `water.fragment` | `spellLightingSurface` | `mix((0.35,0.62,0.78), 0.9, milk)` | `vec3(0.02)` | `0.12` | wrap `0.55` |
| `crystal.fragment` | `spellLightingSurface` | `mix((0.3,0.6,0.85), 0.88, frost)` | `vec3(0.021)` | `rough` | wrap `0.5` |

Every one is gated by `if (spellLightCount > 0.5)`, so the loop is skipped outright on the
overwhelming majority of frames where nothing is cast.

---

## 14. Settings the subsystem reads

| Key | Default | Range | Effect |
|---|---|---|---|
| `showSpells` | `true` | bool | false ⇒ `_cancelAll()`, both meshes hidden |
| `spellLight` | 1.0 | 0 – 3 | multiplies every declared light intensity |
| `spellSpray` | 1.0 | 0 – 2.5 | multiplies every spell emission rate |
| `waterDepthTint` | 1.0 | 0 – 3 | scales the water absorption path length |
| `ambientIntensity` | 1.0 | 0 – 3 | shared |
| `sssStrength` | 1.0 | 0 – 3 | shared |
| `glintIntensity` | 0.55 | 0 – 2 | shared |
| `glintGrazing` | 0.72 | 0 – 1 | how hard the grazing-angle gate bites |

---

## 15. WEBGL2 / THREE.JS r172 PORTING NOTES

### 15.1 Language-level substitutions

| WGSL | GLSL 3.00 es | Notes |
|---|---|---|
| `textureLoad(tex, vec2i(c, r), 0)` | `texelFetch(tex, ivec2(c, r), 0)` | identical semantics; no sampler needed |
| `textureSampleLevel(tex, samp, uv, lod)` | `textureLod(tex, uv, lod)` | one combined `sampler2D` |
| `select(f, t, cond)` | `(cond ? t : f)` or `mix(f, t, float(cond))` | **argument order is reversed** — WGSL is (falseVal, trueVal, cond) |
| `dpdx` / `dpdy` | `dFdx` / `dFdy` | core in GLSL ES 3.00 |
| `inverseSqrt` | `inversesqrt` | lowercase `s` |
| `vec2f/vec3f/vec4f` | `vec2/vec3/vec4` | |
| `vec2i` | `ivec2` | |
| `i32` / `f32` | `int` / `float` | |
| `let x = …` | `const`-like: just declare the type | GLSL has no `let`; use `float x = …` |
| `var x = …` | mutable local | |
| `array<vec4f, 8>` uniform | `uniform vec4 strandParams[8];` | |
| `array<mat4x4f, 3>` uniform | `uniform mat4 cascadeMatrices[3];` | see §15.5 for column order |
| `input.position.xy` (fragment) | `gl_FragCoord.xy` | |
| `varying x: T` | `out T x;` (VS) / `in T x;` (FS) | |
| `fragmentOutputs.color` | a declared `out vec4` | e.g. `layout(location=0) out vec4 fragColor;` |
| `discard;` | `discard;` | same |
| `fract` | `fract` | **same semantics** (`x - floor(x)`) — no change needed for the hashes |
| `refract(I, N, eta)` | `refract(I, N, eta)` | **same**, returns `vec3(0.0)` on TIR in both |
| `reflect(I, N)` | `reflect(I, N)` | same |
| `smoothstep(e0, e1, x)` | same | |
| `pow`, `atan2` | `pow`, `atan(y, x)` | WGSL `atan2(y,x)` → GLSL `atan(y,x)` |
| `%` on floats (JS side only) | — | JS `%` is `fmod` semantics; `seed = v % 1` on a positive `v` is fine |

`select()` is **not short-circuiting** in WGSL and `?:` **is** in GLSL. Every `select()` in this
subsystem has side-effect-free operands, so a ternary is a safe swap — but do not "optimise" a
`select` whose expensive branch you then skip; keep the evaluation semantics identical where the
divide-by-zero guards depend on it (e.g. `Nn / max(nl, 1e-8)` is guarded by the `max`, not by the
`select`, and must stay that way).

### 15.2 No compute shaders needed

**This subsystem uses no storage textures, no compute passes and no ping-pong.** Everything is
already vertex + fragment. The only ping-pong in the wider demo is the deformation field, which
this subsystem only *writes into* via the CPU-side `brush()` queue — the brush queue is a plain
`Float32Array` uploaded to a small data texture, so it ports unchanged.

If you are porting the deformation field too: two RGBA16F framebuffers, ping-ponged, one
full-screen triangle pass per frame; `EXT_color_buffer_float` (or `EXT_color_buffer_half_float`) is
required to *render* to them. That is out of scope here.

### 15.3 Data textures — formats and precision

Both data textures are **RGBA32F with NEAREST filtering**:

```js
const tex = new THREE.DataTexture(
    float32Array, width, height,
    THREE.RGBAFormat, THREE.FloatType
);
tex.internalFormat = 'RGBA32F';
tex.minFilter = THREE.NearestFilter;
tex.magFilter = THREE.NearestFilter;
tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
tex.generateMipmaps = false;
tex.needsUpdate = true;                    // set every frame after writing the array
```

* **Sampling** RGBA32F is core in WebGL2 as long as you never filter it. `OES_texture_float_linear`
  would be needed only for LINEAR filtering — we use NEAREST and `texelFetch`, so **no extension is
  required**.
* `EXT_color_buffer_float` is **not** needed for these two textures; they are uploads, never render
  targets.
* **`precision highp float;` is mandatory** in both stages. The strand table stores absolute world
  positions in metres, which can be thousands of metres from the origin. At mediump (fp16) a
  position of 2000 m quantises to ~1 m and the entire effect collapses. Three.js defaults to highp
  on desktop, but declare it explicitly in a `RawShaderMaterial`, and also declare
  `precision highp sampler2D;`.

Sizes to allocate:

| Texture | W × H | Bytes |
|---|---|---|
| water strand table | 64 × 24 | 24,576 |
| crystal table | 96 × 3 | 4,608 |

### 15.4 Attribute buffers and frustum culling

Both meshes carry `position` as **indices, not coordinates**:

* water: `(column, ring, strand)`, 33,792 vertices
* crystals: `(crystalIndex, vertexIndex, 0)`, 1,248 vertices

Consequences in Three.js:

```js
geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geom.setIndex(new THREE.BufferAttribute(idx, 1));   // Uint32Array — core in WebGL2
mesh.frustumCulled = false;                          // MANDATORY: the bounding box computed
                                                     //   from index values is meaningless
geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
mesh.matrixAutoUpdate = false;                       // both meshes are identity-transformed
```

Do **not** call `computeBoundingSphere()` — Three will happily compute a sphere around
`(0..175, 0..23, 0..7)` and cull the mesh whenever the camera is not near the world origin.

If you use `THREE.ShaderMaterial` (not Raw), Three injects its own `position` handling and a
`modelViewMatrix`/`projectionMatrix` pair. Either accept that and compute
`gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0)` (skipping `modelMatrix`, which is
identity), or use `RawShaderMaterial` with `glslVersion: THREE.GLSL3` and supply
`viewProjection` yourself. **`RawShaderMaterial` + GLSL3 is the closer match** and avoids Three's
`#include` chunk injection colliding with the hand-written code.

### 15.5 Matrix conventions

* WGSL `mat4x4f` and GLSL `mat4` are **both column-major**, and both are indexed `m[col][row]`.
  A `Float32Array` of 16 floats in the same order works for both — **no transpose**.
* Babylon's JS-side `Matrix` stores **row-major** and its `toArray()` therefore already produces
  what the shader wants once the engine's own convention is accounted for. Three.js `Matrix4.elements`
  is **column-major** and can be uploaded directly. Verify with a known projection before trusting
  either, since this is the single most common silent failure when porting.
* Three.js uniform arrays of matrices: `{ value: [m0, m1, m2] }` where each is a `THREE.Matrix4`.
* Three.js uniform arrays of vec4: `{ value: [v0, ..., v7] }` of `THREE.Vector4`, **or** a flat
  `Float32Array(32)` — Three r172 accepts both for `vec4[]`. The flat array is faster (no per-frame
  object churn) and matches the reference's `setArray4`.

### 15.6 THE Y-FLIP — the one thing that will silently break the shadows

Babylon flips clip-space Y when rendering into a *render target* (WebGPU's texture origin is
top-left, the framebuffer convention is bottom-left, so the engine negates Y in the vertex stage).
The shadow maps are therefore **already stored flipped**, and `snowShadowLookup` compensates:

```wgsl
let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 + ndc.y * 0.5);      // NOTE THE PLUS
```

**WebGL has no such flip.** In a Three.js port rendering the cascades into an ordinary
`WebGLRenderTarget`, the correct expression is the textbook one:

```glsl
vec2 uv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);      // MINUS
```

Getting this wrong mirrors every shadow lookup about the middle row of the map. The symptom is not
"no shadows" — it is shadows that *slide around with camera angle, zoom and player position*, with
zero error exactly at `v = 0.5` and error growing linearly either side (measured at up to 30 m in
the reference's own debugging).

The same flip affects `dFdy` sign (§15.7).

### 15.7 Derivative sign — the crystal facet normal

```wgsl
var N = normalize(cross(dpdx(world), dpdy(world)));
if (dot(N, V) < 0.0) { N = -N; }
```

WebGPU's framebuffer Y runs downward; WebGL's runs upward. `dFdy` therefore has the **opposite
sign**, so `cross(dFdx, dFdy)` comes out negated in a WebGL port.

**This is self-correcting here** because of the `if (dot(N, V) < 0.0) N = -N;` line immediately
after — the normal is forced toward the eye regardless. Port it verbatim and it is fine. But if you
"clean up" that flip on the grounds that the winding should already be correct, the ice will shade
inside-out.

The water's use of `dpdx/dpdy` is only for `length()`-based footprint estimation, which is
sign-independent.

### 15.8 Blending and draw order

| | Reference (Babylon) | Three.js r172 |
|---|---|---|
| crystals | `renderingGroupId = 1`, `alphaMode = ALPHA_COMBINE`, `forceDepthWrite = true` | `transparent = true`, `depthWrite = true`, `depthTest = true`, `blending = NormalBlending`, `renderOrder = 1` |
| water | `renderingGroupId = 2`, `alphaIndex = 0`, `disableDepthWrite = true` | `transparent = true`, `depthWrite = false`, `renderOrder = 2` |
| spray | `renderingGroupId = 2` (after water) | `renderOrder = 3` |
| both | `backFaceCulling = false` | `side = THREE.DoubleSide` |

Three.js sorts transparent objects back-to-front by default. Both of these are **single meshes**,
so intra-mesh order is index-buffer order — which is exactly what the reference relies on for the
"blended and depth-writing" trick. Set `renderer.sortObjects = true` (default) and rely on
`renderOrder` to pin the three groups; do **not** attempt per-crystal sorting.

`NormalBlending` in Three is `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` for colour, which matches
`ALPHA_COMBINE`. Also set `premultipliedAlpha = false`.

### 15.9 Uniform bookkeeping

WGSL declares `uniform x: T;` and Babylon packs them into one UBO automatically. In GLSL 3.00 es
you may use loose uniforms (simplest, and Three's default) or a `std140` UBO. Loose uniforms are
fine at this count. Watch the array limits: `spellLightPos[4] + spellLightCol[4] + shR[9] +
cascadeMatrices[3] + cascadeParams[3] + strandParams[8]` = 28 vec4s + 3 mat4s = 40 vec4 slots,
comfortably inside the WebGL2 minimum of 256 vertex / 224 fragment uniform vectors.

### 15.10 Things with no WebGL2 equivalent — and why they do not matter here

| WebGPU/Babylon feature | Status |
|---|---|
| timestamp queries (`GPUQuerySet`) | **unavailable in WebGL2.** The perf overlay's GPU timings must fall back to `EXT_disjoint_timer_query_webgl2` (widely unsupported) or CPU-side `performance.now()` around `gl.finish()`. Nothing in the spell subsystem's *appearance* depends on it. |
| storage textures / compute | not used by this subsystem |
| explicit pipeline pre-creation (`isReady()` + a real draw) | **still required, differently.** In WebGL the equivalent hitch is *shader link + first-draw validation*. Reproduce the warm-up by calling `renderer.compile(scene, camera)` **and** rendering 2–3 real frames with both meshes visible and non-degenerate geometry standing (the §3.9 / §11.2 warm-up strands and crystal), then tearing them down. `renderer.compile()` alone does not exercise the blend/depth state combination. |
| `mat.needAlphaBlending = () => true` | Three: `transparent = true` |
| `RawTexture.update(array)` | Three: mutate the array in place, then `texture.needsUpdate = true` |
| Babylon `alphaIndex` | Three: `renderOrder` |
| `mesh.alwaysSelectAsActiveMesh` | Three: `frustumCulled = false` |
| `mesh.doNotSyncBoundingInfo` | Three: never call `computeBoundingSphere()` |

### 15.11 Numeric-behaviour gotchas

* **`transport()` runs on the CPU** in JS — port it verbatim; no shader change.
* **`i32(floor(f))` vs GLSL `int(floor(f))`**: both truncate toward zero on the already-floored
  value, so they agree. But `int(f)` *without* the `floor` truncates toward zero and would be wrong
  for negative `f`. `u` is clamped to `[0,1]` first so `f >= 0` always — keep the clamp.
* **`max(count, 2.0)`** guards every spline evaluator against a count of 0 or 1. Keep it: with
  `count = 0`, `n - 1 = -1` and the index arithmetic goes negative, and `texelFetch` with a
  negative coordinate is **undefined** in GLSL ES 3.00 (it is a clamp in WGSL). This is a real
  divergence — WebGL will read garbage where WebGPU read the edge texel. The `alive` gate
  (`sp.w >= 2.0`) already prevents it, so keep **both** guards.
* **Integer texel coordinates must be clamped explicitly**: `max(i1 - 1, 0)` and
  `min(i1 + 2, last)` are already in the reference. Do not remove them on the assumption that the
  sampler clamps — `texelFetch` does not.
* **`% 1` on the crystal seed** (`(i*0.618034 + x*0.137 + z*0.311) % 1`) is JS `fmod`, which
  returns a **negative** result for negative input. World `x`/`z` are signed, so the seed can be
  negative. The shader only feeds it into `hash21`/`hash22` (which `fract` internally) and into
  `seed * 6.2831853` as a rotation, so a negative seed is harmless — but if you "fix" it with
  `Math.abs`, formations will look different from the reference.
* **Loop bounds**: `for (var i = 0; i < SPELL_LIGHT_MAX; i++) { if (i >= n) break; }` uses a
  *constant* bound with a dynamic break. GLSL ES 3.00 allows dynamic loops, but the constant-bound
  form is more portable and unrolls; keep it exactly.
* **`WAKE_STEPS = 20` loop in `wakeSection`** runs per vertex, four times per vertex (position +
  3 differences), on every SHEET-profile vertex. That is 80 iterations × 4224 vertices for a live
  Sweep strand. It is fine on desktop; if the port is mobile-targeted this is the first thing to
  precompute into a small 1D LUT keyed on `(q, curl)`.

### 15.12 Suggested port order

1. Lattice + data texture + `waterPoint` with a hard-coded straight spine. Verify a tube appears.
2. Add `waterSpineTangent` and transport. Verify no scalloping at knots (§16, criterion 3).
3. Port `water.fragment` **without** refraction — flat colour + Fresnel. Verify silhouettes.
4. Add the sky-LUT refraction. This is the point at which it starts looking like water.
5. Port Sweep (simplest lifecycle, exercises the SHEET path and `wakeSection`).
6. Port Bloom (exercises TUBE + two lights + the deform crater).
7. Port Vortex (exercises 3 simultaneous strands + negative depression).
8. Port Ribbon last (most state, most tuning).
9. Crystals are independent — port any time after step 3.

---

## 16. VISUAL ACCEPTANCE CRITERIA

A harsh critic should be able to check every one of these from a screenshot or a short capture.

1. **The tube is not a polygon and not a stack of discs.** Freeze a held Ribbon at 2 m and look
   along the body. There must be no readable facet count in the silhouette (24 ring vertices, not
   12) and — critically — **no horizontal banding at the spine-sample pitch**. If you can count
   rings running around the tube, the row interpolation has been done with smoothstep or linear
   instead of Catmull-Rom, or the tangent is a finite difference instead of the analytic spline
   derivative.

2. **Vortex helices have no vertebrae.** The three helices are thin tubes wound on a tight curve.
   Along each helix the radius must vary *slowly and monotonically* — no periodic pinch, no
   screw-thread groove spiralling around the tube, no bead-string. Any repeating pinch at the
   sample pitch means the radius modulation or the section roll has picked up a distance term.

3. **The refraction is displaced, and coloured, and dispersive.** Look through the belly of a Bloom
   column at the snow behind it. The background seen through the water must be (a) visibly *bent*
   relative to the background beside the water, (b) shifted toward teal in proportion to how thick
   the water is at that point — a thin trailing wisp of Ribbon nearly clear, the belly of the
   column deep teal — and (c) carrying a faint **colour fringe at the rim** where the three IORs
   fan apart. A body that is uniformly tinted from edge to edge has lost the path-length term; one
   with no fringe has lost the dispersion.

4. **The water is nearly opaque, and it still reads as transparent.** This is the counter-intuitive
   one. The blend alpha is 0.74–0.97, so the *undistorted* background must NOT show through — all
   the see-through-ness comes from the refracted lookup. If the body looks pale, washed out and
   frosted-glass-like over the snow, the alpha has been run off Fresnel and the background is being
   counted twice.

5. **Ends close on a point, not on a ring.** Both ends of every strand — the Ribbon's tail, both
   horns of a Sweep crescent, the top of a Bloom column, both ends of a Vortex helix — must fade
   out on a soft taper with no visible disc of open section and no hard-edged cap.

6. **Lee-side glow: a spell lights the snow THROUGH a berm crest, not just on the near face.**
   Cast Sweep so its crest light sits on one side of an existing berm or trail berm. The **far**
   side of that crest must glow — dimmer, and blue-shifted toward `(0.55, 0.72, 1.0)` — rather than
   the berm having a hard terminator with black behind it. If the far side is dark, `snowSubsurface`
   is missing from `spellLighting` and only the wrapped diffuse survived.

7. **The Bloom crater is a hole full of light, not a bright column on dark ground.** Immediately
   after the burst, the crater rim and the near ground must be lit strongly *from inside the
   crater*, and the fallout curtain drifting down through the frame must be **lit from below** —
   each grain brighter on its underside. If the fallout is grey powder over a glow, the particle
   material is not reading the light pool.

8. **The Bloom column withdraws down its own axis; it does not fade.** Watch the collapse
   (t ≈ 0.95 – 1.75 s). The top of the column must *descend* into the crater at full opacity. If
   the column stays at full height and fades to nothing, `drop` has been applied to alpha instead
   of to `top`.

9. **Ice facets are exactly flat with exactly hard edges.** Zoom on one crystal. Adjacent facets
   must return visibly *different* amounts of sky with a razor-sharp boundary between them — no
   gradient across a facet, no rounding at the edges. A crystal that looks like a lumpy cone means
   the normal is interpolated from vertices instead of taken from `dFdx/dFdy` of world position.

10. **You see the snow through the ice, but never one prism through another.** In a 34-prism
    formation, the snow behind the cluster must be visible through the front faces, while **no
    prism is ever visible through another prism** — no grey smear of stacked blends, no blue spikes
    of fully-opaque geometry. If prisms show through each other, depth writing is off; if you
    cannot see the snow at all, the material has been made opaque.

11. **No two crystals in a formation line up on a radial line, and none is a regular hexagon.**
    Look down at a formation from above. The golden-angle spiral must produce no visible spokes and
    no concentric rings. Each prism's hexagonal cross-section must be visibly irregular (per-facet
    radius `0.72–1.28 ×`). Visible spokes ⇒ the angle increment is a rational fraction of a turn.

12. **A crystal grows by spearing up first and thickening after.** Capture the first 0.5 s of a
    cast. Prisms must appear as thin spikes reaching most of their final height while still narrow,
    then fill out. Uniform scaling reads as a model being lerped in and is a fail.

13. **The Sweep crest overhangs its own face.** Look at the crescent side-on at peak. The lip must
    hang *back* over the face below it — a genuine breaking-wave overhang, not a rounded ridge or a
    bank. If the crest is convex all the way over, the curl is not reaching the section integral's
    plunging range (0.48–0.95).

14. **The Sweep leaves a continuous trench with berms, and the trench matches where the crest was
    drawn.** After the wave passes, the ground must show a continuous channel — not a row of round
    pits — with raised material along both rims, and the channel must lie exactly under the path the
    mesh crest travelled, not offset from it.

15. **A released Ribbon arcs onto the target and bursts; it does not slither.** On release, the
    head must visibly *curve* out of whatever part of the figure-eight it was in over ~0.2 s, then
    straighten and accelerate, with the pre-release bend still travelling outward along the tail.
    On contact with the snow the head must **stop dead** and the body pour into the impact point;
    a head that slides across the surface is a fail.

16. **The held Ribbon's figure-eight never repeats and only occasionally touches down.** Watch 10 s
    of a held cast. Successive loops must precess — never retracing the same path — and the bottom
    lobe must reach the snow only intermittently, leaving thin curved *scores* (not a ploughed
    furrow) that are still legible a minute later.

17. **Vortex visibly strips the ground and gives it back.** During the hold, a growing ring of
    scoured, deepening snow must appear around the player out to ~3.1 m, with essentially no berm.
    During the fade, that depression must **refill from the outside in**, ending with loose berm
    material sitting proud of the surrounding surface. If the ground stays stripped, the negative
    depression on the fade branch is missing.

18. **Vortex grains swirl without the particle system knowing what a vortex is.** The airborne snow
    must visibly follow the same three spiral paths the helix meshes describe, densest near the
    ground, with grains moving *tangentially* (around the axis) rather than radially outward.

19. **The vortex column is opaque but not shiny.** At milkiness 0.88 the helices must read as
    lifted snow — you can just see the far side of the column through the near side — and must
    carry **no polished specular highlight**. A plastic-looking sheen means the milk term has not
    been applied to the Fresnel/reflection mix.

20. **Every dynamic light reaches exactly zero at its radius.** Cast Bloom and pan the camera. There
    must be **no faint global wash** over the whole snow field — the light must terminate cleanly
    inside its 11 m radius. A field-wide brightening that appears and disappears with a cast means
    the windowed falloff has been replaced with pure inverse-square.

21. **No white disc at a light's own position.** Every spell that plants an emitter on or near the
    snow must not burn a clipped white circle into the ground beneath it. That is the `+ 0.25` soft
    core in `spellAttenuation`.

22. **Drawing eight strands costs the same as drawing one.** Instrument the draw call count: it must
    be **exactly one** for the water body and **exactly one** for the crystals, regardless of how
    many spells are up — including zero. A per-spell mesh, or a draw count that tracks the spell
    count, is a structural fail even if it looks identical.

---

## 17. APPENDIX — complete numeric constant table

Grouped by owner. `[S]` marks a live settings slider (default given).

### 17.1 Dispatch / system

| Const | Value | Unit |
|---|---|---|
| cast trauma (Sweep) | 0.12 | — |
| cast trauma (Vortex) | 0.10 | — |
| aim ray max distance | 22 | m |
| aim ray fallback distance | 13 | m |
| castBlend ease-in rate | 7.0 | 1/s |
| castBlend ease-out rate | 3.2 | 1/s |
| cast hold window | 0.55 | s |
| hand fallback lateral offset | ±0.28 | m |
| hand fallback forward offset | 0.35 | m |
| hand fallback height | 1.25 | m |
| groundRay coarse step | 0.6 | m |
| groundRay bisection steps | 8 | — |
| groundRay buried epsilon | 0.001 | m |

### 17.2 WaterBody / lattice

| Const | Value |
|---|---|
| `STRAND_MAX` | 8 |
| `STRAND_COLS` | 64 |
| `LATTICE_COLS` | 176 |
| `RING` | 24 |
| `PROFILE_TUBE` / `PROFILE_SHEET` | 0 / 1 |
| vertices per strand | 4,224 |
| total vertices | 33,792 |
| total triangles | 64,400 |
| data texture | 64 × 24 RGBA32F |
| live-strand alpha threshold | 0.003 |
| live-strand min columns | 2 |
| shadowSoftness (water) | 1.4 |
| shadowBias (water) | 0.03 |
| warm-up columns | 24 |
| warm-up tube radius scale | 0.22 |
| warm-up sheet radius scale | 0.5 |
| warm-up tube milk / sheet milk | 0.2 / 0.6 |
| warm-up sheet twist | 0.6 |

### 17.3 `lib/water.wgsl`

| Const | Value |
|---|---|
| Catmull-Rom basis coefficient | 0.5 |
| tangent degeneracy epsilon | 1e-7 |
| `flatten` floor | 0.02 |
| right-vector re-orth epsilon | 1e-5 / 1e-8 |
| fallback right nudge | 1e-5 |
| 2π | 6.28318530718 |
| relief coarse circle radius | 0.85 |
| relief coarse weight | 0.60 |
| relief coarse u-frequency | 4.0 |
| relief coarse u-drift | −1.6 |
| relief coarse second coord | u·2.3 |
| relief fine circle radius | 1.50 |
| relief fine weight | 0.40 |
| relief fine u-frequency | 7.5 |
| relief fine offset | 11.3 |
| relief fine second coord | −u·5.1 − t·3.1 |
| open relief v-frequencies | 2.60 / 4.40 |
| tube relief amplitude | 0.22 (× radius) |
| sheet relief amplitude | 0.13 |
| sheet relief v-scale | q·3.0 |
| sheet relief fade | smoothstep(0.1, 0.7, q) |
| sheet relief Y weight | 0.5 |

### 17.4 `wakeSection` (borrowed)

| Const | Value |
|---|---|
| `WAKE_STEPS` | 20 |
| `WAKE_NORM` | 3.35 |
| `WAKE_LATERAL` | 0.70 |
| `th0` | −0.24 rad |
| `th1` base | 1.65 rad |
| `th1` curl coefficient | 3.30 |
| arc-length exponent | 1.65 |
| thinning coefficient | 0.40 |
| max sweep at curl = 1 | 284° |

### 17.5 `water.vertex.wgsl`

| Const | Value |
|---|---|
| alive alpha threshold | 0.001 |
| alive column threshold | 2.0 |
| difference offset (cells) | 0.65 |
| normal degeneracy epsilon | 1e-7 / 1e-8 |

### 17.6 `water.fragment.wgsl`

| Const | Value |
|---|---|
| `WATER_ABSORB` | (3.40, 0.72, 0.34) /m |
| early discard alpha / radius | 0.003 / 0.0005 |
| oblique slice A | (0.88, 0.31, −0.36) |
| oblique slice B | (0.24, 0.79, 0.56) |
| footprint floor | 1e-4 |
| ripple fade range | smoothstep(0.03, 0.22) |
| ripple octave 1 freq / drift | 8.5 / (0.7, −0.5) |
| ripple octave 2 freq / drift | 21.0 / (−1.6, 1.1) |
| ripple amplitudes | 0.085 / 0.055 |
| fine fade range | smoothstep(0.006, 0.045) |
| fine octave freq / drift | 62.0 / (3.1, 2.2) |
| fine amplitude | 0.030 |
| N.y flat-tangent threshold | 0.99 |
| path constant term | 1.25 |
| path grazing term | 1.9 |
| path clamp | 0.01 … 3.0 |
| IOR red / green / blue | 1.3300 / 1.3330 / 1.3400 |
| TIR test threshold | dot > 0.5 |
| refraction mip | 1.6 |
| reflection mip | 0.7 |
| backScatter distortion / power / thickness | 0.55 / 2.6 / 1.0 |
| scatterTint deep / shallow | (0.40,0.80,1.0) / (0.72,0.94,1.0) |
| scatterTint falloff | exp(−path·1.6) |
| scatter milk term | 0.55 + 1.3·milk |
| scatter shadow floor | 0.30 |
| ambient milk term | 0.35 + 0.5·milk |
| slush albedo | (0.86, 0.90, 0.96) |
| slush wrap | 0.62 |
| slush SSS thickness / strength / radius | 0.45 / ×0.8 / 1.2 |
| slush shadow floor | 0.35 |
| slush mix cap | 0.85 |
| foam noise freqs | 22.0 / 61.0 |
| foam noise drifts | (1.7, −1.1) / −(3.3, 2.1) |
| foam modulation | 0.35 + 1.5·fn2·(0.5 + 0.7·fn3) |
| foam albedo | (0.93, 0.955, 0.99) |
| foam wrap | 0.72 |
| foam SSS thickness / radius | 0.25 / 1.4 |
| foam shadow floor | 0.4 |
| water F0 | 0.02 |
| **Fresnel cap** | **0.72** |
| Fresnel foam suppression | 1 − foam·0.7 |
| Fresnel milk suppression | 1 − milk·0.88 |
| GGX roughness range | 0.055 … 0.68 |
| GGX roughness foam weight | ×0.55 |
| glint intensity scale | 0.6 + 0.8·max(foam, milk) |
| glint output scale | ×0.7 |
| spell-light albedo clear / milky | (0.35,0.62,0.78) / (0.9) |
| spell-light f0 / roughness / wrap | 0.02 / 0.12 / 0.55 |
| alpha taper divisor | 0.055 m |
| clearAlpha range | 0.74 … 0.97 |
| alpha milk weight | ×0.9 |
| alpha discard threshold | 0.004 |
| INV_PI | 0.31830988618 |

### 17.7 Sweep

| Const | Value | Unit |
|---|---|---|
| `COLS` | 48 | |
| `CURVE` | 5.5 | m |
| `ARC0` / `ARC1` | 0.52 / 0.96 | rad |
| `LIFE` | 2.4 | s |
| `PEAK` | 2.15 | m |
| birth offset ahead of feet | 1.1 | m |
| initial reach | 1.4 | m |
| speed amplitude | 11.5 | m/s |
| speed decay | 1.15 | 1/s |
| speed floor | 1.2 | m/s |
| rise time | 0.26 | s |
| fall start (life01) | 0.55 | |
| fall span (life01) | 0.45 | |
| spread span | 14 | m |
| height spread divisor | 1 + spread·0.45 | |
| spine sink | −0.13 | m |
| curl base / bell weight | 0.48 / 0.47 | |
| curl rise mix | 0.45 + 0.55·rise | |
| foam base / bell weight | 0.30 / 0.45 | |
| dist along | reach + u·2.0 | m |
| milkiness | 0.48 | |
| alpha | clamp01(env·1.4) | |
| light Y offset | height·0.55 | |
| light radius | 9.5 | m |
| light colour | (0.42, 0.74, 1.0) | |
| light intensity | 13.0·env | |
| plough env gate | 0.05 | |
| plough spacing | 0.25 | m |
| plough owed clamp | 0.7 | m |
| plough ranks `N` | 13 | |
| plough weight gate | 0.06 | |
| plough lag behind crest | 0.5 | m |
| plough brush radius | 0.34 | m |
| plough depth / berm / compression / ice | 0.95 / 0.62 / 0.55 / 0.16 | ×k·env·w |
| plough elongation / edge | 2.2 / 0.9 | |
| spray env gate | 0.08 | |
| spray per metre | 120 | ×sprayScale |
| spray count cap | 150 | |
| spray weight gate | 0.12 | |
| spray radial offset | CURVE + (rand−0.2)·0.6 | m |
| spray height factor | 0.55 + 0.6·rand | |
| spray outward | 1.4 + rand·3.2 | m/s |
| spray up | 1.5 + rand·3.2 + amp·1.6 | m/s |
| spray lateral jitter | ±0.7 | m/s |
| clod probability | 0.20 | |
| clod size / powder size | 0.022+0.024r / 0.050+0.075r | m |
| clod life / powder life | 0.6+0.5r / 0.55+0.7r | s |
| clod drag / powder drag | 0.8 / 1.6+1.4r | |

### 17.8 Ribbon

| Const | Value | Unit |
|---|---|---|
| `SAMPLES` | 46 | |
| `STEP` | 0.20 | m |
| `TAIL_LIFE` | 1.25 | s |
| `THROW_SPEED` | 21 | m/s |
| `THROW_STEER` | 5.5 | 1/s |
| `RADIUS` | 0.205 | m |
| `SECTION_ASPECT` | 1.55 | |
| blend ease-in / ease-out | 5.5 / 3.4 | 1/s |
| thrown decay start / span | 1.5 / 1.0 | s |
| termination count / blend | 3 / 0.02 | |
| integration substep cap | 1/60 | s |
| phase rate | 2.55 | rad/s |
| Lissajous a: amp1 / harm freq / phase / amp2 | 1.70 / 0.41 / 1.7 / 0.44 | |
| Lissajous b: amp1 / phase / harm freq / harm phase / amp2 | 0.92 / 0.4 / 0.73 / 0.2 / 0.26 | |
| reach along aim | 2.5 | m |
| vertical bias | +0.34 | m |
| spring k | 210 | |
| damping ratio | 0.92 | |
| ground skim clearance | 0.10 | m |
| ground bounce restitution | −0.25 | |
| release aim Y bias | +0.18 | |
| thrust amplitude / decay | 62 / 3.0 | m/s², 1/s |
| gravity | 9.81 | m/s² |
| drag linear / quadratic | 0.55 / 0.0016 | |
| impact clearance | 0.05 | m |
| tail drain rate (flying) | 1 + throwT·0.9 | |
| tail drain rate (splashed) | 7.0 | |
| radius head ramp | smooth01(u/0.10) | |
| radius taper exponent | 1.05 | |
| stretch base / speed coeff | 1.35 / 0.055 | |
| stretch clamp | 0.55 … 1.35 | |
| ground flatten range | 0.06 … 0.41 | m |
| flatten reduction | 0.72 | |
| foam head span | 0.16 | u |
| foam weights: head / ground / stretch | 0.55 / 0.5 / 0.45 | |
| twist base rate | 2.4 | rad/s |
| twist distance rate | 1.35 | rad/m |
| milkiness (live / degenerate) | 0.14 / 0.12 | |
| alpha | clamp01(blend·1.3) | |
| score blend gate | 0.15 | |
| score throttle / owed clamp | 1/60 / 0.05 | s |
| score span / stride | 10 / 2 | samples |
| score clearance | 0.34 | m |
| score brush radius | 0.13 | m |
| score depth / berm / compression / ice | 1.15 / 0.55 / 2.6 / 1.9 | ×k·w·blend |
| score elongation / edge | 1 / 0.65 | |
| shed blend gate | 0.2 | |
| shed rate | 130 | ×sprayScale·blend |
| shed cap | 30 | |
| shed velocity scale | ×12 then ×0.5 | |
| shed size / life / drag | 0.022+0.034r / 0.55+0.75r / 0.55 | |
| burst count | 70 | ×sprayScale |
| burst speed | 4 + 9r | m/s |
| burst jitter | ±1.2 / ±1.2 | m/s |
| burst size / life / drag | 0.020+0.040r / 0.6+0.9r / 0.7 | |
| splash count base / steep bonus | 280 / 190 | |
| splash outward | (1.8+5.5r)·(0.45+0.85(1−steep)) | m/s |
| splash downrange carry | 0.32 | |
| splash up | (1.2+4.6r)·(0.4+0.8·steep) | m/s |
| droplet probability | 0.55 | |
| droplet size / clod size | 0.020+0.034r / 0.055+0.095r | m |
| splash life | 0.6+1.1r | s |
| droplet drag / clod drag | 0.6 / 2.2 | |
| splash brush radius | 0.62 | m |
| splash depth/berm/compression/ice | 0.16 / 0.13 / 1.0 / 0.85 | |
| splash elongation / edge | 1.35 / 1.0 | |
| satellite count | 3 | |
| satellite distance / radius | 0.55+0.65r / 0.30+0.22r | m |
| satellite depth/berm/comp/ice | 0.05 / 0.07 / 0.6 / 0.5 | |
| satellite elongation / edge | 1.3 / 1.0 | |
| splash trauma | 0.09 | |

### 17.9 Bloom

| Const | Value | Unit |
|---|---|---|
| `COLS` | 34 | |
| `HEIGHT` | 5.6 | m |
| `GIRTH` | 0.66 | m |
| `LIFE` | 1.75 | s |
| `FALLOUT` | 3.4 | s |
| lean magnitude | 0.16 | |
| burst trigger time | 0.10 | s |
| rise start / span | 0.10 / 0.34 | s |
| drop start / span | 0.95 / 0.80 | s |
| env cutoff | 0.002 | |
| sway amplitude / frequency | 0.12 / 3.1 | rad/s |
| sway Z coefficient | −0.6 | |
| lean scale | h²·top·0.5 | |
| shape waist base / weight / h-scale | 0.42 / 0.58 / 1.15 | |
| shape flare weight / start / span | 0.55 / 0.72 / 0.28 | |
| shape foot weight / span | 0.75 / 0.22 | |
| radius modulation | 0.9 + 0.2·sin(u·9 + t·6) | |
| foam base | 0.30 | |
| foam head weight / start / span | 0.55 / 0.55 / 0.45 | |
| foam foot weight / span | 0.4 / 0.18 | |
| twist | t·1.5 + u·4 | |
| milkiness (live / dead) | 0.42 / 0.5 | |
| alpha | clamp01(env·1.5) | |
| crater light Y / radius / colour / intensity | +0.35 / 11.0 / (0.44,0.78,1.0) / 22.0·env | |
| head light Y / radius / colour / intensity | top·0.92 / 7.5 / (0.55,0.82,1.0) / 9.0·env | |
| crater brush radius | 1.15 | m |
| crater depth / berm / compression / ice | 0.52 / 0.40 / 0.72 / 0.30 | |
| crater elongation / edge | 1.15 / 1.0 | |
| ring brush count | 4 | |
| ring angle jitter | +rand·1.2 | rad |
| ring distance | 1.5 + rand·0.7 | m |
| ring radius | 0.5 + rand·0.35 | m |
| ring berm / compression | 0.20+0.14r / 0.15 | |
| ring elongation / edge | 1.4 / 1.0 | |
| crater trauma | 0.28 | |
| throw count | 430 | ×sprayScale |
| throw radius | 0.35 + √r·1.25 | m |
| throw up / out | 5.5+8.5r / 1.6+5.0r | m/s |
| throw clod probability | 0.26 | |
| throw clod up factor | 0.7 | |
| throw sizes | 0.028+0.038r / 0.075+0.115r | m |
| throw lives | 1.1+0.8r / 1.4+1.5r | s |
| throw drags | 0.65 / 1.1+0.8r | |
| curtain ramp start / span | 0.25 / 0.5 | s |
| curtain decay start / span | 0.9 / 3.06 | s |
| curtain k cutoff | 0.01 | |
| curtain rate | 360 | ×sprayScale·k |
| curtain cap | 60 | |
| curtain disc radius | 3.6 | m |
| curtain spawn height | 2.2 + 4.2r | m |
| curtain lateral velocity | ±0.45 | m/s |
| curtain rise velocity | 0.2 + 1.1r | m/s |
| curtain size / life | 0.028+0.055r / 1.6+1.9r | |
| curtain drag | 4.6 | |

### 17.10 Crystallise + CrystalField

| Const | Value | Unit |
|---|---|---|
| `PLANT_TIME` | 0.85 | s |
| `COUNT` | 34 | |
| `STAND` | 34 | s |
| life jitter | +rand·8 | s |
| spell inactive time | PLANT_TIME + 1.6 = 2.45 | s |
| **golden angle** | **2.39996323** | rad |
| spiral base radius | 0.18 | m |
| spiral radial span | 2.05 | m |
| position jitter | ±0.08 | m |
| base sink | −0.06 | m |
| scale falloff | 1 − n01·0.58 | |
| scale jitter | 0.6 + rand·0.8 | |
| height at scale 1 | 1.75 | m |
| radius at scale 1 | 0.15 | m |
| radius jitter | 0.7 + rand·0.7 | |
| tilt base / span | 0.10 / 0.42 | |
| tilt jitter | 0.6 + rand·0.8 | |
| axis jitter | ±0.06 | |
| growSeconds | 0.45 + rand·0.55 | s |
| light Y / radius / colour | +0.55 / 7.5 / (0.52, 0.80, 1.0) | |
| light form span | 0.9 | s |
| light ember base / amplitude / rate | 0.10 / 0.06 / 1.7 | rad/s |
| light base / form gain | 0.35 / 12.0 | |
| frost window | PLANT_TIME + 0.4 = 1.25 | s |
| frost rate | 60 | ×sprayScale |
| frost disc radius | 1.8 | m |
| frost height | 0.05 + 0.5r | m |
| frost radial speed | 0.6 + 1.4r | m/s |
| frost up | 0.9 + 2.4r | m/s |
| frost size / life | 0.012+0.020r / 0.7+0.9r | |
| frost hard-kind probability | 0.4 | |
| frost drag | 2.4 | |
| glaze brush radius | 1.55 | m |
| glaze depth/berm/compression/ice | 0.10 / 0.16 / 0.85 / 1.0 | |
| glaze elongation / edge | 1.2 / 0.85 | |
| glaze satellite count | 3 | |
| glaze satellite distance / radius | 1.1+1.3r / 0.55+0.5r | m |
| glaze satellite depth/berm/comp/ice | 0.04 / 0.10 / 0.5 / 0.75 | |
| glaze satellite elongation / edge | 1.5 / 1.0 | |
| per-prism brush stride | every 2nd (`i & 1`) | |
| per-prism brush radius | radius·3.2 | m |
| per-prism depth/berm/comp/ice | 0.05 / 0.09 / 0.4 / 0.9 | |
| per-prism elongation / edge | 1.2 / 1.0 | |
| `CRYSTAL_MAX` | 96 | |
| `VERTS` / `RING` | 13 / 6 | |
| `CRYSTAL_CASCADES` | 2 | |
| triangles per crystal | 18 | |
| total triangles | 1,728 | |
| sublimation time | 6.0 | s |
| grow floor | 0.05 | s |
| seed formula | (i·0.618034 + x·0.137 + z·0.311) % 1 | |
| shadowSoftness / shadowBias (ice) | 1.3 / 0.012 | |
| warm-up height / radius / grow / life | 0.6 / 0.09 / 0.2 / 999 | |
| warm-up advance | 0.21 | s |

### 17.11 `lib/crystal.wgsl` + `crystal.fragment.wgsl`

| Const | Value |
|---|---|
| hexagon angular step | 1.04719755 rad (60°) |
| seed rotation scale | 6.2831853 |
| facet wobble base / span | 0.72 / 0.56 |
| wobble hash coords | (k + seed·31.0, seed·17.0) |
| apex hash coord | (seed, 7.31) |
| apex offset scale | radius·0.5 |
| shoulder radius factor | 0.68 |
| shoulder height factor | 0.58 |
| growth height curve | g²(3−2g) |
| growth radius curve | smoothstep(0.25, 1.0, g) |
| radius floor / span | 0.22 / 0.78 |
| axis degeneracy epsilon | 1e-6 |
| axis.y reference threshold | 0.9 |
| `ICE_ABSORB` | (2.35, 0.60, 0.24) /m |
| frost grain frequency | 34.0 |
| frost seed scale | 19.0 |
| frost height range | smoothstep(0.01, 0.22) |
| frost grain mix | 0.45 + 0.6·grain |
| path base / height term | 0.16 / 0.42 |
| path grazing base / gain | 0.7 / 2.0 |
| path clamp | 0.02 … 1.4 |
| IOR red / green / blue | 1.3050 / 1.3090 / 1.3170 |
| refraction mip | 0.9 |
| backScatter distortion / power | 0.42 / 2.2 |
| deepTint deep / shallow | (0.42,0.74,1.0) / (0.86,0.95,1.0) |
| deepTint falloff | exp(−path·2.5) |
| transport gain | 1.6 |
| transport shadow floor | 0.25 |
| ambient tint weight | 0.9 |
| frost albedo | (0.88, 0.915, 0.965) |
| frost wrap | 0.62 |
| frost SSS thickness / radius | 0.4 / 1.3 |
| frost shadow floor | 0.4 |
| frost mix cap | 0.9 |
| roughness clear / frosted | 0.045 / 0.42 |
| ice F0 | 0.021 |
| reflection mip factor | rough·6.0 |
| Fresnel frost suppression | 1 − frost·0.75 |
| glint intensity scale | 0.4 + 1.2·frost |
| glint output scale | ×0.6 |
| spell-light albedo clear / frosted | (0.3,0.6,0.85) / (0.88) |
| spell-light wrap | 0.5 |
| alpha floor | 0.46 |
| alpha path weight / falloff | 0.34 / exp(−path·2.2) |
| alpha grazing weight | 0.26 |
| alpha frost weight | 0.55 |

### 17.12 Vortex

| Const | Value | Unit |
|---|---|---|
| `HELICES` | 3 | |
| `COLS` | 64 | |
| `RAMP` / `HOLD` / `FADE` | 0.55 / 3.0 / 1.1 | s |
| total duration | 4.65 | s |
| `TOP` | 4.8 | m |
| `TURNS` | 1.35 | turns |
| spin base / env gain | 5.2 / 2.4 | rad/s |
| helix radius base / height term | 2.55 / −1.15 | m |
| helix waist base / bell weight / h-scale | 0.78 / 0.34 / 1.2 | |
| helix ground clearance | +0.05 | m |
| taper argument | u·0.92 + 0.04 | |
| tube radius | 0.125 | m |
| radius modulation base / amplitude | 0.78 / 0.34 | |
| radius modulation frequency / time rate | 3.4 / 2.2 | |
| twist time rate / helix offset | 0.7 / 2.1 | |
| foam base / height term | 0.22 / 0.3 | |
| milkiness | 0.88 | |
| alpha | clamp01(env·1.3) | |
| light Y / radius / colour / intensity | ground+1.3 / 9.0 / (0.46,0.74,1.0) / 9.0·env | |
| ring initial / max / min | 0.9 / 3.1 / 0.9 | m |
| ring grow / retreat rate | 0.85 / 2.2 | m/s |
| strip throttle | 1/45 | s |
| strip owed clamp | 0.05 | s |
| strip brush count `N` | 9 | |
| strip angle spin factor | 0.6 | |
| strip radius jitter | 0.82 + rand·0.3 | |
| strip brush radius | 0.55 | m |
| strip depth (hold / fade) | +0.95·k·env / **−1.7·k** | |
| strip berm (hold / fade) | 0.05·k·env / 0.85·k | |
| strip compression (hold / fade) | 0.30·k·env / **−0.6·k** | |
| strip elongation / edge | 1.9 / 1.0 | |
| strip yaw | a + π/2 | rad |
| grain env gate | 0.05 | |
| grain rate | 2600 | ×sprayScale·env |
| grain cap | 260 | |
| grain height distribution | rand·rand | |
| grain angle jitter | ±0.45 | rad |
| grain radius jitter | 0.85 + rand·0.35 | |
| grain tangential speed base / height term | 7.5 / −2.6 | m/s |
| grain radial jitter | (rand−0.6)·1.2 | m/s |
| grain up base / jitter / height bonus | 1.4 / 3.4r / (1−h)·2.5 | m/s |
| grain spawn clearance | 0.06 + 0.2r | m |
| grain size | 0.028 + 0.062r | m |
| grain life | 0.30 + 0.26r | s |
| grain drag | 0.9 | |

### 17.13 Spell lights

| Const | Value |
|---|---|
| `MAX_SPELL_LIGHTS` / `SPELL_LIGHT_MAX` | 4 |
| attenuation radius epsilon | 1e-4 |
| attenuation soft core | 0.25 |
| window exponent | (1 − t²)² |
| snow wrap | 0.66 |
| particle wrap | 0.8 |
| distance epsilon | 1e-8 |
| shader gate | count > 0.5 |
| wake SSS strength / radius | ×0.45 / 1.5 |
| character f0 / wrap | 0.035 / 0.35 |

### 17.14 Shared shading library (referenced by both materials)

| Const | Value |
|---|---|
| `PI` | 3.14159265359 |
| `INV_PI` | 0.31830988618 |
| 2π | 6.28318530718 |
| `snowSubsurface` shallow tint | (0.94, 0.965, 1.0) |
| `snowSubsurface` deep tint | (0.55, 0.72, 1.0) |
| `snowSubsurface` distortion factor | 0.28 · radius |
| `snowSubsurface` power range | 3.0 … 9.0 |
| `snowSubsurface` amplitude range | 1.0 … 0.30 |
| glint cell A / sharpness | 0.052 m / 780 |
| glint cell B / sharpness / weight | 0.185 m / 1500 / 1.35 |
| glint cell B offset | (53.1, 17.9) |
| glint fade range | cell·0.55 … cell·2.2 |
| glint facet probability | ≤ 0.62 |
| glint disc radius | cell·0.17 |
| glint jitter | (r − 0.5)·0.72 |
| glint tilt base / span | 0.10 / 0.26 |
| glint hash offset | (19.73, 7.31) |
| glint graze exponent range | 1.5 … 5.0 |
| glint light gate | smoothstep(0.02,0.35) · (1 − smoothstep(0.55,0.95)·0.55) |
| glint N.y threshold | 0.95 |
| `ign` constants | 52.9829189, (0.06711056, 0.00583715) |
| noise quintic fade | f³(f(6f−15)+10) |
| hash 3-vector multipliers | (0.1031, 0.1030, 0.0973) |
| hash additive | 33.33 |
| cascade blend start | 0.88 × split |
| cascade far fade | smoothstep(0.85·sp.z, sp.z) |

---

## 18. Known documentation drift in the reference

Recorded so a porter does not "fix" the code to match a stale comment:

1. `water.fragment.wgsl:142` says *"the mesh is 64 columns by 12 rings"*. The actual lattice is
   **176 columns × 24 rings** (`LATTICE_COLS = 176`, `RING = 24`); 64 is `STRAND_COLS`, the *sample*
   count, and 12 is a superseded ring count. **Trust the JS constants.**
2. `lib/water.wgsl:145` header comment says *"three octaves of relief"* in the vertex-shader note
   while `waterRelief` has **two**. The three octaves are in the *fragment* ripple normal. The
   vertex shader's own header (`water.vertex.wgsl:10`) correctly says "three octaves" of the
   *fragment* detail; the geometry carries two.
3. `README.md` says Bloom has *"four seconds of fallout curtain"*; `FALLOUT = 3.4 s` and the
   emission envelope decays over `FALLOUT * 0.9 = 3.06 s` starting at `t = 0.9 s`, so the last
   grains are emitted at `t ≈ 3.96 s` and live up to 3.5 s beyond that. Four seconds is the
   *observed* duration, not a constant.
4. `crystals.js` header says the prisms *"sublimate over about forty seconds"* — that is the
   **stand** time (`STAND = 34 s` plus up to 8 s jitter). The sublimation itself is **6.0 s**.
5. `spells/ribbon.js` allocates `_right = Float32Array(SAMPLES * 3)` in the constructor but never
   reads or writes it; the live transport uses module-scope scratch `_rgt`. Dead state — do not
   port it.
