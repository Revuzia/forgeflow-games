# SNOWFLOW — Terrain Heightfield + Geometry Clipmap

**Implementation spec for a Three.js r172 / WebGL2 / GLSL 3.00 es port.**

Source of truth: the WebGPU + Babylon.js + WGSL reference demo. This document transcribes
every constant, formula and control-flow decision in the terrain subsystem so it can be
re-implemented without access to the reference.

Reference files this document covers, read in full:

| File | Role |
|---|---|
| `src/terrain/heightfield.js` | bake orchestration, GPU→CPU mirror, `heightAt`, `normalAt`, play-area clamp |
| `src/terrain/clipmapMesh.js` | the one static mesh: vertex + index generation |
| `src/terrain/terrain.js` | material construction, per-frame uniform upload, pass registration |
| `src/shaders/lib/terrain.wgsl` | `windMat`, `terrainMacro`, `terrainMacroD`, `rockField`, `windLocal`, `terrainFine`, `terrainFineFiltered` |
| `src/shaders/lib/clipmap.wgsl` | `sampleHeightBicubic`, `worldToHeightUV`, `placeClipmapVertex` (CDLOD) |
| `src/shaders/lib/noise.wgsl` | hashes, `noised`, `fbmd`, `fbmDamped`, `ridgedd`, shaping helpers |
| `src/shaders/lib/ridge.wgsl` | far-field raymarched range (separate subsystem; documented here for completeness because it is on the read list) |
| `src/shaders/heightBake.fragment.wgsl` | the 4096² macro bake |
| `src/shaders/snow.vertex.wgsl` | beauty-pass vertex program |
| `src/shaders/terrainPrepass.vertex.wgsl` | depth-prepass vertex program |
| `src/shaders/terrainDepth.vertex.wgsl` / `.fragment.wgsl` | shadow-cascade vertex + fragment programs |

Supporting files read for exactness (not on the assignment list but load-bearing here):
`src/shaders/auxBake.fragment.wgsl` (the aux derivative bake — its output is consumed by the
terrain vertex programs), `src/shaders/lib/deform.wgsl` (`deformHeight` / `deformFalloff` /
`deformUV`, called from all three terrain vertex programs), `src/core/settings.js` (default
values of every tunable the terrain reads), `src/core/gpuUtil.js` (`bakeOnce`), `src/main.js`
(load and frame ordering), `src/terrain/deformation.js` (window size/resolution constants that
the terrain uniforms carry).

---

## 0. One-paragraph summary

The terrain is a single static mesh of 332,936 triangles drawn in one call. Its vertex buffer
holds no positions — only `(gridIndex.x, ringLevel, gridIndex.y)`. Eight nested square rings
(level 0 solid, levels 1–7 annuli, spacing doubling per level, 0.085 m to 10.88 m, total
half-extent 870.4 m) are placed in world space *in the vertex shader* from a `lodCenter`
uniform, each ring snapping its own origin to twice its own spacing, with CDLOD morphing onto
the next-coarser lattice across the outer band of each ring. Height comes from a 4096² RG32F
texture baked once at load from layered anisotropic gradient noise with analytic derivatives —
broad transverse dune ridges, a long low swell, wind-sheared medium drifts with lee-face
asymmetry, and sparse rock outcrops — sampled bicubically (cubic B-spline via four bilinear
taps). Sastrugi/ripple/grain detail is evaluated analytically per vertex on the fine rings only
and per fragment everywhere, footprint-filtered. A second 2048² RGBA16F "aux" bake
differentiates the *baked* height (not the analytic function) to produce slope, rock mask and
exposure. The height texture is mirrored back to the CPU at half resolution (2048², 1 m
spacing) so character grounding samples exactly the drawn surface.

---

## 1. Coordinate and unit conventions

- **World units are metres.** Height is world **+Y**. The heightfield is a function of world
  **(x, z)**; everywhere in the WGSL a `vec2f p` for terrain means **world (x, z)**.
- Babylon.js runs **left-handed** by default and the demo never sets
  `scene.useRightHandedSystem`, so the reference is LH with clockwise front faces. See
  §12.1 for the winding consequence in Three.js.
- **Wind bearing** `windAngle` is `S.windDirection * PI / 180`, radians. Default
  `S.windDirection = 42` degrees. Held 70–80° away from `S.sunAzimuth` (default 118°) by art
  direction: sastrugi ridges run *along* the wind, so when wind and sun align the sun rakes
  down every ridge, lights both flanks identically, and the fine structure reads as flat.
- **Gradients** are `dH/dx`, `dH/dz` in metres per metre. Surface normal is always reconstructed
  as (from `lib/shading.wgsl`):

  ```wgsl
  fn normalFromGradient(d: vec2f) -> vec3f {
      return normalize(vec3f(-d.x, 1.0, -d.y));
  }
  ```

- **Angles for `windMat`** rotate the *sample domain*, not the world.

---

## 2. World / field constants (`heightfield.js`, `clipmapMesh.js`, `terrain.js`)

```js
export const WORLD_SIZE = 2048;   // metres across the whole baked field
export const HEIGHT_RES = 4096;   // height texture is 4096²  → 0.5 m per texel
export const AUX_RES    = 2048;   // aux texture is 2048²     → 1.0 m per texel
export const PLAY_RADIUS = 620;   // metres; player is clamped inside this disc
```

Derived on the instance:

```js
this.origin     = new Vector2(-WORLD_SIZE / 2, -WORLD_SIZE / 2);  // (-1024, -1024)
this.size       = WORLD_SIZE;                                     // 2048
this.texelWorld = WORLD_SIZE / HEIGHT_RES;                        // 0.5 m
```

Clipmap:

```js
export const GRID_N       = 160;    // quads per side, per ring. Must be divisible by 4.
export const LEVELS       = 8;      // number of rings
export const BASE_SPACING = 0.085;  // metres, innermost ring vertex spacing
const HOLE_SHRINK         = 3;      // cells each hole is shrunk by, to guarantee overlap
const HALF                = GRID_N / 2;   // 80
```

Exported extents:

```js
export const INNER_EXTENT = HALF * BASE_SPACING;                       // 6.8 m
export const OUTER_EXTENT = HALF * BASE_SPACING * Math.pow(2, LEVELS-1); // 870.4 m
export const GRID_HALF_N  = HALF;                                      // 80
```

Detail (snow-grain) texture, owned by `Terrain`:

```js
const DETAIL_RES = 1024;                       // 1024², RGBA8, mipmapped, trilinear, WRAP
this.detailTex.setFloat("resolution", DETAIL_RES);
this.detailTex.setFloat("grainScale", 0.013);  // tilts a grain dome flank to ~30°
```

Deformation window constants that the terrain uniforms carry (owned by `deformation.js`):
`COVERAGE = 80` m, resolution `2048`, so texel = `80/2048 = 0.0390625` m (3.9 cm). Window is
centred on the *player* and snapped to texel boundaries. Two RGBA16F targets, ping-ponged.

### 2.1 Per-ring spacings and extents (derived — a port must reproduce these exactly)

`spacing(L) = BASE_SPACING * 2^L`; `extent(L) = 80 * spacing(L)`;
`holeHalfExtent(L) = 37 * spacing(L)` (levels ≥ 1).

| Level `L` | spacing (m) | ring half-extent (m) | hole half-extent (m) | overlap with ring L−1 (m) |
|---|---|---|---|---|
| 0 | 0.085 | 6.8 | — (solid) | — |
| 1 | 0.170 | 13.6 | 6.29 | 0.51 |
| 2 | 0.340 | 27.2 | 12.58 | 1.02 |
| 3 | 0.680 | 54.4 | 25.16 | 2.04 |
| 4 | 1.360 | 108.8 | 50.32 | 4.08 |
| 5 | 2.720 | 217.6 | 100.64 | 8.16 |
| 6 | 5.440 | 435.2 | 201.28 | 16.32 |
| 7 | 10.880 | 870.4 | 402.56 | 32.64 |

The overlap is always exactly `3 * spacing(L) = 6 * spacing(L-1)` — three coarse cells,
six fine cells. This is `HOLE_SHRINK` doing its only job.

### 2.2 Derived geometry counts

```
side          = GRID_N + 1                       = 161
vertsPerLevel = side * side                      = 25,921
total verts   = vertsPerLevel * LEVELS           = 207,368
level-0 quads = GRID_N * GRID_N                  = 25,600
holeHalf      = HALF / 2 - HOLE_SHRINK           = 37
holeQuads     = (holeHalf*2) * (holeHalf*2)      = 74 * 74 = 5,476
per-annulus   = 25,600 - 5,476                   = 20,124
total quads   = 25,600 + 7 * 20,124              = 166,468
total tris    = 166,468 * 2                      = 332,936     ("333k")
total indices = 166,468 * 6                      = 998,808     (Uint32)
```

Vertex buffer is `Float32Array(207368 * 3)` = 2.49 MB. Index buffer is
`Uint32Array(998808)` = 4.00 MB. Both allocated once, uploaded once, never touched again.

---

## 3. Clipmap mesh construction (CPU, once at load)

`buildClipmapMesh(scene)` in `clipmapMesh.js`. This is the *only* CPU geometry work in the
whole terrain system.

### 3.1 Vertex generation

Every level emits the **full** `161 × 161` lattice, including the interior vertices that no
annulus references. The annulus is expressed *purely* through which quads receive indices.
(Rationale from the source: unreferenced interior vertices cost 12 bytes each and are never
shaded — cheaper than special-casing the emission.)

The attribute called `position` is **not a position**. Its three components are:

| component | meaning | range |
|---|---|---|
| `.x` | `gridI` — integer grid index along X within the ring | `[-80, +80]` |
| `.y` | `ringLevel` — the ring index, as a float | `0 … 7` |
| `.z` | `gridJ` — integer grid index along Z within the ring | `[-80, +80]` |

```js
for (let level = 0; level < LEVELS; level++) {
    const vBase = level * vertsPerLevel;
    for (let j = 0; j <= GRID_N; j++) {
        const gj = j - HALF;
        for (let i = 0; i <= GRID_N; i++) {
            positions[vi++] = i - HALF;   // gridI
            positions[vi++] = level;      // ringLevel
            positions[vi++] = gj;         // gridJ
        }
    }
    ...
}
```

### 3.2 Index generation — the hole and the alternating diagonal

```js
for (let j = 0; j < GRID_N; j++) {
    const gj = j - HALF;
    for (let i = 0; i < GRID_N; i++) {
        const gi = i - HALF;

        if (level > 0) {
            // Skip quads entirely inside the hole.
            const maxAbs = Math.max(
                Math.abs(gi), Math.abs(gi + 1),
                Math.abs(gj), Math.abs(gj + 1)
            );
            if (maxAbs <= holeHalf) continue;      // holeHalf = 37
        }

        const a = vBase + j * side + i;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;

        if (((i + j) & 1) === 0) {
            indices[ii++] = a; indices[ii++] = b; indices[ii++] = c;
            indices[ii++] = b; indices[ii++] = d; indices[ii++] = c;
        } else {
            indices[ii++] = a; indices[ii++] = d; indices[ii++] = c;
            indices[ii++] = a; indices[ii++] = b; indices[ii++] = d;
        }
    }
}
```

Two decisions here are visual, not structural:

1. **Alternating diagonal** — the quad diagonal flips on `(i + j) & 1`. A uniform diagonal
   leaves a faint corduroy of shading seams all running the same way across the whole field.
   This must be reproduced; it is visible on lit dune flanks.
2. **Winding** — the given order is front-facing for an upward heightfield viewed from above
   under Babylon's left-handed / clockwise-front convention. See §12.1.

### 3.3 Mesh flags

```js
mesh.alwaysSelectAsActiveMesh = true;   // never frustum-cull: real extent is decided in the VS
mesh.isPickable = false;
mesh.freezeWorldMatrix();               // identity, forever
mesh.doNotSyncBoundingInfo = true;
mesh.metadata = { triangles: ii / 3, vertices: vertsPerLevel * LEVELS };
```

`mesh.renderingGroupId = 1` (set in `main.js`); the sky is group 0.

---

## 4. Clipmap vertex placement + CDLOD morph (`lib/clipmap.wgsl`)

This is the single most load-bearing routine in the subsystem. It is included **verbatim** by
three vertex programs (beauty, prepass, shadow depth) so all three produce bit-identical
positions. Duplicating it as three copies is explicitly called out in the source as the thing
that would cause the terrain to shadow-acne against itself.

```wgsl
struct ClipmapVertex {
    worldXZ: vec2f,
    spacing: f32,   // this vertex's effective sample spacing, post-morph
    morph: f32,
};

fn placeClipmapVertex(
    grid: vec2f,
    level: f32,
    camXZ: vec2f,
    baseSpacing: f32,
    gridHalfN: f32
) -> ClipmapVertex {
    let spacing = baseSpacing * exp2(level);

    // Snap the ring origin to TWICE this level's spacing. Twice, not once, so that the
    // parity of the lattice is stable — snapping to 1x would let the morph targets flip
    // between frames and the surface would shimmer.
    let snap = spacing * 2.0;
    let origin = floor(camXZ / snap) * snap;

    var local = grid * spacing;

    // ---- morph toward the coarser lattice ----
    // Chebyshev distance, because the rings are square. Normalised so 1.0 is the outer edge.
    let extent = gridHalfN * spacing;
    let cheb = max(abs(local.x), abs(local.y)) / extent;

    // Completes at 0.86, comfortably before the overlap band where this ring and the next
    // coarser one both draw.
    let morph = clamp((cheb - 0.70) / 0.16, 0.0, 1.0);

    // The coarse lattice is every second vertex of this one.
    let coarseGrid = floor(grid * 0.5) * 2.0;
    let coarseLocal = coarseGrid * spacing;
    local = mix(local, coarseLocal, morph);

    var out: ClipmapVertex;
    out.worldXZ = origin + local;
    out.spacing = spacing * (1.0 + morph);
    out.morph = morph;
    return out;
}
```

### 4.1 Numbers and their meaning

| symbol | value | meaning |
|---|---|---|
| snap multiplier | `2.0` | ring origin snaps to `2 × spacing` — parity-stable lattice |
| morph start | `0.70` | normalised Chebyshev distance where morphing begins |
| morph width | `0.16` | so morph completes at `0.86` |
| coarse-lattice stride | `floor(grid * 0.5) * 2.0` | drop to every second vertex |
| effective spacing | `spacing * (1.0 + morph)` | ranges `spacing … 2*spacing` |

In grid units (`gridHalfN = 80`): morphing starts at `|g| = 56` and completes at `|g| = 68.8`.
The overlap band with the enclosing ring starts at `|g| = 74`. **68.8 < 74** — the morph is
fully complete before the two rings coexist, which is what makes the overlap invisible and
prevents T-junctions.

### 4.2 Why `lodCenter` is the *character*, not the camera

Verbatim from `snow.vertex.wgsl`, because getting this wrong is an immediately visible bug:

> Ring 0 is 6.8 m of half-extent and the spring arm sits 3–11 m behind the character, so
> centring on the camera put the snow directly under the player right on the ring 0 / ring 1
> boundary: swinging the camera round re-sampled it between 0.085 m and 0.17 m spacing and the
> trail visibly changed shape. Centring on the character makes vertex placement a function of
> world position and player position only, so no camera motion can alter the geometry.

`terrain.js` sets `_lod.set(focus.x, focus.z)` where `focus` is `character.position`. All four
materials (beauty, prepass, 3 × depth) receive the *same* `lodCenter`. The camera position is
passed separately as `cameraPos` and is used only for `vViewDist`.

Consequence, stated in the source and accepted: the ground under a fully zoomed-out camera is
one ring coarser than it would otherwise be.

### 4.3 `worldToHeightUV`

```wgsl
fn worldToHeightUV(p: vec2f, origin: vec2f, size: f32) -> vec2f {
    return (p - origin) / size;
}
```

With `origin = (-1024, -1024)` and `size = 2048`, world (0,0) maps to UV (0.5, 0.5). The
texture is `CLAMP_ADDRESSMODE` in both axes.

---

## 5. Bicubic B-spline height fetch (`sampleHeightBicubic`)

Cubic **B-spline** (approximating, not interpolating) via the classic four-bilinear-tap trick.
Rationale from the source: bilinear alone leaves diamond-shaped creases across every texel of a
smooth dune, which reads as visible faceting; B-spline additionally low-passes the bake, which
on a landform is a bonus.

```wgsl
fn sampleHeightBicubic(tex: texture_2d<f32>, samp: sampler, uv: vec2f, res: f32) -> f32 {
    let coord = uv * res - 0.5;
    let base = floor(coord);
    let f = coord - base;

    let f2 = f * f;
    let f3 = f2 * f;
    let w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
    let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    let w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
    let w3 = f3 / 6.0;

    let s0 = w0 + w1;
    let s1 = w2 + w3;
    let o0 = (base + 0.5 - 1.0 + w1 / s0) / res;
    let o1 = (base + 0.5 + 1.0 + w3 / s1) / res;

    let t00 = textureSampleLevel(tex, samp, vec2f(o0.x, o0.y), 0.0).r;
    let t10 = textureSampleLevel(tex, samp, vec2f(o1.x, o0.y), 0.0).r;
    let t01 = textureSampleLevel(tex, samp, vec2f(o0.x, o1.y), 0.0).r;
    let t11 = textureSampleLevel(tex, samp, vec2f(o1.x, o1.y), 0.0).r;

    return mix(mix(t00, t10, s1.x), mix(t01, t11, s1.x), s1.y);
}
```

Note `w0..w3` are **vec2** (evaluated per axis simultaneously); `s0`, `s1`, `o0`, `o1` are
vec2. Only the **`.r`** channel is read (height). `res` is passed as `4096.0` from a uniform
literal in `terrain.js` (`m.setFloat("heightRes", 4096)`).

**The CPU mirror in `heightAt()` must use the identical B-spline weights** — it does, see §9.

---

## 6. The noise library (`lib/noise.wgsl`) — every constant

Registered into Babylon's WGSL include store as `<snowNoise>` so the offline bake and the
runtime material evaluate byte-identical functions. **Any divergence between the bake's noise
and the runtime's noise produces the character floating/sinking, and shading that disagrees
with the silhouette.**

```wgsl
const PI: f32 = 3.14159265359;
```

### 6.1 Hashes

```wgsl
fn hash11(n: f32) -> f32 {
    var p = fract(n * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

fn hash21(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2f) -> vec2f {
    var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

fn hash33(p: vec3f) -> vec3f {
    var p3 = fract(p * vec3f(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}
```

Constants: `0.1031`, `0.1030`, `0.0973`, `33.33`. Note the swizzles differ between `hash22`
(`p3.yzx`, then `(p3.xx + p3.yz) * p3.zy`) and `hash33` (`p3.yxz`, then
`(p3.xxy + p3.yxx) * p3.zyx`) — transcribe exactly, they are not interchangeable.

```wgsl
fn grad2(i: vec2f) -> vec2f {
    let a = hash21(i) * 6.28318530718;
    return vec2f(cos(a), sin(a));
}
```

Unit-length gradient at angle `hash21(i) * 2π`. Constant: `6.28318530718`.

### 6.2 `noised` — gradient noise with exact analytic derivative

Inigo Quilez formulation. Returns `vec3f(value, d/dx, d/dy)`. Value range ≈ `[-1, 1]`.

```wgsl
fn noised(p: vec2f) -> vec3f {
    let i = floor(p);
    let f = p - i;

    // Quintic fade: C2 continuous, so derivatives are smooth too.
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

    let ga = grad2(i + vec2f(0.0, 0.0));
    let gb = grad2(i + vec2f(1.0, 0.0));
    let gc = grad2(i + vec2f(0.0, 1.0));
    let gd = grad2(i + vec2f(1.0, 1.0));

    let va = dot(ga, f - vec2f(0.0, 0.0));
    let vb = dot(gb, f - vec2f(1.0, 0.0));
    let vc = dot(gc, f - vec2f(0.0, 1.0));
    let vd = dot(gd, f - vec2f(1.0, 1.0));

    let k0 = va;
    let k1 = vb - va;
    let k2 = vc - va;
    let k3 = va - vb - vc + vd;

    let value = k0 + k1 * u.x + k2 * u.y + k3 * u.x * u.y;

    let deriv = ga
        + u.x * (gb - ga)
        + u.y * (gc - ga)
        + u.x * u.y * (ga - gb - gc + gd)
        + du * (vec2f(u.y, u.x) * k3 + vec2f(k1, k2));

    return vec3f(value, deriv);
}

fn noise2(p: vec2f) -> f32 { return noised(p).x; }
```

Note `f = p - i` (**not** `fract(p)`) — identical for finite inputs but matters for the
derivative formulation's exactness; port it as written.

Quintic fade constants: `6.0, -15.0, 10.0`; derivative constant `30.0` with inner `(f - 2.0) + 1.0`.

`noise3` (3D value noise) exists in the library but is **not used by the surface** — it is for
volumetrics and particle jitter. Included for completeness:

```wgsl
fn noise3(p: vec3f) -> f32 {
    let i = floor(p); let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    // eight corners: dot(hash33(i + corner), vec3f(1.0)) / 3.0
    // trilinear mix, then * 2.0 - 1.0
}
```

### 6.3 `rot2`

```wgsl
fn rot2(a: f32) -> mat2x2f {
    let c = cos(a);
    let s = sin(a);
    return mat2x2f(c, -s, s, c);
}
```

WGSL `mat2x2f(a, b, c, d)` is **column-major**: column0 = `(c, -s)`, column1 = `(s, c)`. So
`m * v = (c*v.x + s*v.y, -s*v.x + c*v.y)`. GLSL `mat2(c, -s, s, c)` has identical semantics —
this one ports character-for-character (see §12.3).

### 6.4 `fbmd` — plain fBm with chain-ruled derivatives

```wgsl
fn fbmd(p0: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> vec3f {
    var p = p0;
    var amp = 0.5;
    var freq = 1.0;
    var sum = 0.0;
    var deriv = vec2f(0.0);

    // Per-octave rotation kills the axis-aligned grid signature of raw Perlin.
    let m = rot2(0.517);
    var xform = mat2x2f(1.0, 0.0, 0.0, 1.0);

    for (var i = 0; i < octaves; i++) {
        let n = noised(p * freq);
        sum += amp * n.x;
        // d/dp0 = amp * freq * (dn/dp * accumulated rotation)
        deriv += amp * freq * (n.yz * xform);
        amp *= gain;
        freq *= lacunarity;
        p = m * p;
        xform = m * xform;
    }
    return vec3f(sum, deriv);
}
```

Constants: initial `amp = 0.5`, initial `freq = 1.0`, per-octave rotation **0.517 rad**.

Note `n.yz * xform` — a **row-vector × matrix** product (the chain rule for a rotated domain).
Semantics are the same in GLSL; see §12.3.

### 6.5 `fbmDamped` — derivative-damped fBm

> The single biggest reason the dunes read as wind-packed drifts rather than as a generic noise
> field. Each octave is attenuated by the slope accumulated so far, so detail collects in flat
> areas and thins out on steep faces.

```wgsl
fn fbmDamped(p0: vec2f, octaves: i32, lacunarity: f32, gain: f32, damp: f32) -> vec3f {
    var p = p0;
    var amp = 0.5;
    var freq = 1.0;
    var sum = 0.0;
    var deriv = vec2f(0.0);

    let m = rot2(0.517);
    var xform = mat2x2f(1.0, 0.0, 0.0, 1.0);

    for (var i = 0; i < octaves; i++) {
        let n = noised(p * freq);
        let w = 1.0 / (1.0 + damp * dot(deriv, deriv));
        sum += amp * w * n.x;
        deriv += amp * w * freq * (n.yz * xform);
        amp *= gain;
        freq *= lacunarity;
        p = m * p;
        xform = m * xform;
    }
    return vec3f(sum, deriv);
}
```

The damping weight `w = 1 / (1 + damp * |deriv|²)` uses the derivative **accumulated so far**
(before this octave is added) — order matters. Rotation is **0.517 rad**, same as `fbmd`.

### 6.6 `ridgedd` — ridged noise with derivatives

> Sharp crests, smooth valleys. Sastrugi. Built as `1 - |n|`, whose derivative is `-sign(n)*dn`.

```wgsl
fn ridgedd(p0: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> vec3f {
    var p = p0;
    var amp = 0.5;
    var freq = 1.0;
    var sum = 0.0;
    var deriv = vec2f(0.0);
    var prev = 1.0;

    let m = rot2(0.717);                      // NOTE: 0.717, not 0.517
    var xform = mat2x2f(1.0, 0.0, 0.0, 1.0);

    for (var i = 0; i < octaves; i++) {
        let n = noised(p * freq);
        let s = sign(n.x);
        let r = 1.0 - abs(n.x);
        // Squaring sharpens the crest; `prev` couples octaves so ridges align.
        let r2 = r * r;
        let dr2 = -2.0 * r * s;

        sum += amp * r2 * prev;
        deriv += amp * prev * freq * (dr2 * n.yz * xform);
        prev = mix(1.0, r2, 0.65);

        amp *= gain;
        freq *= lacunarity;
        p = m * p;
        xform = m * xform;
    }
    return vec3f(sum, deriv);
}
```

Constants: initial `amp = 0.5`, initial `freq = 1.0`, initial `prev = 1.0`, rotation
**0.717 rad**, octave coupling `mix(1.0, r2, 0.65)`, crest-squaring derivative factor `-2.0`.

**The `prev` term is not folded into the derivative** (it is treated as constant per octave
within `deriv`, multiplied in as `amp * prev * freq * ...`). Reproduce this literally; it is
what the reference's normals actually are.

Output range: `sum` accumulates non-negative terms; mean is roughly `0.35`, which is why
`terrainFine` subtracts `0.35` before applying amplitude (§8.1).

### 6.7 Shaping helpers

```wgsl
fn sabs(x: f32, k: f32) -> f32 { return sqrt(x * x + k * k) - k; }   // smooth |x|

fn smoothMin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}
fn smoothMax(a: f32, b: f32, k: f32) -> f32 { return -smoothMin(-a, -b, k); }

fn remap(v: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
    return c + (d - c) * clamp((v - a) / (b - a), 0.0, 1.0);
}

/// Interleaved gradient noise — the stable per-pixel dither TAA tolerates.
fn ign(pix: vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(pix, vec2f(0.06711056, 0.00583715))));
}
```

`ign` constants: `52.9829189`, `0.06711056`, `0.00583715`.

---

## 7. The wind-anisotropy construction (`windMat`) — the core of the look

```wgsl
/// Build the combined rotate-and-anisotropically-scale matrix for a noise layer.
/// `sx` stretches along the wind, `sy` across it; `scale` is the wavelength.
/// A layer's derivative maps back to world space with `dHdq * M`.
fn windMat(angle: f32, sx: f32, sy: f32, scale: f32) -> mat2x2f {
    let c = cos(angle);
    let s = sin(angle);
    let r = mat2x2f(c, -s, s, c);
    let d = mat2x2f(sx / scale, 0.0, 0.0, sy / scale);
    return d * r;
}
```

**Read this carefully:**

- `r` is the rotation by `angle` (the wind bearing, possibly veered).
- `d` is a **diagonal** matrix with `sx/scale` on X and `sy/scale` on Y.
- The returned matrix is `d * r` — i.e. applied to `p`, it **rotates first, then scales
  anisotropically**: `M * p = d * (r * p)`.
- `scale` is a **wavelength divisor in metres**: dividing by `scale` means the noise's unit
  lattice cell spans `scale` metres in the un-stretched axis.
- `sx > 1` **compresses** the domain along the rotated-X axis, which means the resulting
  features are **shorter** along that axis and therefore their **ridge lines run across it**.

The design rule stated in the source, and the whole reason the field reads as carved:

> Broad forms run **transverse** to the wind (dune ridges) — achieved with `sx > 1`, `sy = 1`.
> Fine forms run **parallel** to it (sastrugi streaks) — achieved with `sx = 1`, `sy > 1`.

**Derivative mapping.** With `q = M * p`, `dH/dp = Mᵀ · (dH/dq)`, which in row-vector form is
written throughout the code as `(dHdq) * M`. Every layer in `terrainFine` does
`d += (layer.yz * m) * amplitude`. This is exact, not an approximation — except for the two
documented exceptions in §8.0.

### 7.1 Complete table of every `windMat` invocation

| Call site | `angle` | `sx` | `sy` | `scale` (m) | Effect |
|---|---|---|---|---|---|
| `terrainMacro` broad dunes (`m1`) | `w` | `2.1` | `1.0` | `58.0` | ridges transverse to wind |
| `terrainMacro` long swell (`m0`) | `w` | `1.35` | `1.0` | `210.0` | gentle long roll |
| `terrainMacro` medium drifts (`m2`) | `w` | `1.55` | `1.0` | `13.5` | drift lobes |
| `rockField` roughness (`mr`) | `w` | `1.0` | `1.0` | `5.5` | isotropic rock break-up |
| `terrainFine` sastrugi (`m3`) | `w + wl.x` | `1.0` | `wl.y` (`2.3…4.7`) | `2.3` | streaks **along** wind |
| `terrainFine` ripples (`m4`) | `w + wl.x * 0.5` | `2.9` | `1.0` | `0.42` | transverse corrugation |
| `terrainFine` grain (`m5`) | `w` | `1.0` | `1.0` | `0.115` | isotropic sub-decimetre |

---

## 8. The heightfield: `terrainMacro`, `rockField`, `terrainFine`

### 8.0 The two documented derivative approximations

1. **`terrainFine` ignores the chain-rule term from the veer varying with position.** Stated
   rationale: the veer field's wavelength is ~50× the sastrugi's, so that term is a couple of
   percent of a normal — well under what the detail maps perturb it by anyway.
2. **`ridgedd`'s `prev` coupling is not differentiated** (§6.6).

Reproduce both approximations. Doing the "correct" thing changes the normals.

### 8.1 `terrainMacro` — broad dunes + long swell + medium drifts

```wgsl
/// Broad + medium landform. Returns metres.
/// `w` is the wind bearing in radians, `amp` a global height multiplier.
fn terrainMacro(p: vec2f, w: f32, amp: f32) -> f32 {
    // --- broad dunes ---
    // Compressed along the wind, so ridge lines run across it. Derivative damping
    // keeps crests smooth and lets detail pool in the troughs.
    let m1 = windMat(w, 2.1, 1.0, 58.0);
    let broad = fbmDamped(m1 * p, 5, 2.03, 0.5, 0.9);
    var h = broad.x * 15.5;

    // A second, much larger and gentler swell so the field never reads as one repeating
    // dune wavelength. This is what gives the horizon its long roll.
    let m0 = windMat(w, 1.35, 1.0, 210.0);
    let swell = fbmDamped(m0 * p, 3, 2.11, 0.55, 0.3);
    h += swell.x * 26.0;

    // --- medium drifts and wind lobes ---
    // The domain is sheared along the wind by the broad height, which steepens lee faces
    // and flattens windward ones — dune asymmetry, near enough.
    let m2 = windMat(w, 1.55, 1.0, 13.5);
    var q2 = m2 * p;
    q2.x += broad.x * 2.4;
    let med = fbmDamped(q2, 4, 2.07, 0.48, 1.7);

    // Drifts pile up where the broad form is concave (troughs and lee pockets) and get
    // scoured off exposed crests.
    let shelter = clamp(0.5 - broad.x * 0.75, 0.15, 1.0);
    h += med.x * 2.9 * shelter;

    return h * amp;
}
```

Layer-by-layer:

| Layer | Domain matrix | fBm params (`octaves, lacunarity, gain, damp`) | Amplitude | Notes |
|---|---|---|---|---|
| Broad dunes | `windMat(w, 2.1, 1.0, 58.0)` | `5, 2.03, 0.5, 0.9` | `× 15.5` m | ridge lines transverse to wind |
| Long swell | `windMat(w, 1.35, 1.0, 210.0)` | `3, 2.11, 0.55, 0.3` | `× 26.0` m | the horizon's long roll |
| Medium drifts | `windMat(w, 1.55, 1.0, 13.5)`, then `q2.x += broad.x * 2.4` | `4, 2.07, 0.48, 1.7` | `× 2.9 × shelter` m | **lee-face asymmetry** |

**The lee-face asymmetry mechanism, precisely.** After transforming `p` into the medium-drift
domain, the **X component only** (the wind-aligned axis, because `m2` rotated by `w` first) is
displaced by `broad.x * 2.4`. `broad.x` is the *broad dune fBm value*, not the height in
metres — it is the raw fBm output, roughly in `[-1, 1]`. So the medium drift field is *sheared
along the wind by an amount proportional to the local broad-dune elevation*: on the crest of a
dune the drift pattern is pushed downwind by up to ±2.4 domain-units, and in the trough it is
pushed the other way. The visual result is that the downwind (lee) face is steepened and the
upwind (windward) face flattened. **Shear constant: `2.4`.**

**The shelter mechanism.** `shelter = clamp(0.5 - broad.x * 0.75, 0.15, 1.0)`. Where the broad
form is high (`broad.x` positive, a crest) shelter drops toward the floor of `0.15`; where it
is low (trough, lee pocket) shelter rises toward `1.0`. Drifts therefore *pile up in troughs
and are scoured off crests*. Constants: bias `0.5`, slope `0.75`, clamp `[0.15, 1.0]`.

**Total relief.** With `amp = S.macroHeightScale = 1.0` the theoretical envelope is roughly
`±(15.5·0.5·Σ + 26.0·0.5·Σ + 2.9)` before damping; the *measured* relief is read back and
stored as `minHeight`/`maxHeight` at load — the source explicitly refuses to assume a bound
because the shadow cascades size their light volume from it.

### 8.2 `terrainMacroD` — analytic macro derivative (bake-side only)

```wgsl
fn terrainMacroD(p: vec2f, w: f32, amp: f32) -> vec2f {
    let e = 0.35;
    let hx = terrainMacro(p + vec2f(e, 0.0), w, amp) - terrainMacro(p - vec2f(e, 0.0), w, amp);
    let hz = terrainMacro(p + vec2f(0.0, e), w, amp) - terrainMacro(p - vec2f(0.0, e), w, amp);
    return vec2f(hx, hz) / (2.0 * e);
}
```

Central difference, `e = 0.35` m. **Not used at runtime** — the source note says it is "kept
here so the two can be diffed". The runtime gradient comes from the aux bake (§10), which
differentiates the *baked texture*, guaranteeing normals describe exactly the surface the
vertices displace to.

### 8.3 `rockField` — sparse exposed outcrops

```wgsl
/// Sparse exposed rock. Jittered grid, one outcrop per cell, most of them culled so the
/// field stays "just snow and the player".
/// Returns vec2f(height contribution, rock mask 0..1).
fn rockField(p: vec2f, w: f32) -> vec2f {
    let cell = 165.0;
    let gi = floor(p / cell);

    var hSum = 0.0;
    var mask = 0.0;

    // 3x3 neighbourhood so blobs straddle cell borders cleanly.
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let id = gi + vec2f(f32(dx), f32(dy));
            let r  = hash22(id);
            let r2 = hash22(id + 71.3);

            // Cull most cells: outcrops are meant to be sparse.
            if (r2.x > 0.34) { continue; }

            let centre = (id + 0.15 + r * 0.7) * cell;
            let radius = 7.0 + r2.y * 11.0;
            let d = length(p - centre);
            if (d > radius * 1.6) { continue; }

            // Smooth dome, then broken up by ridged noise so it reads as rock rather than
            // as a lump. The noise rides the dome so it never detaches from the silhouette.
            let t = clamp(1.0 - d / radius, 0.0, 1.0);
            let dome = t * t * (3.0 - 2.0 * t);
            let mr = windMat(w, 1.0, 1.0, 5.5);
            let rough = ridgedd(mr * (p - centre), 3, 2.17, 0.55).x;
            let hgt = (3.5 + r2.y * 6.0);

            hSum += dome * hgt * (0.62 + 0.55 * rough);
            mask = max(mask, dome * dome);
        }
    }
    return vec2f(hSum, mask);
}
```

| Parameter | Value | Meaning |
|---|---|---|
| `cell` | `165.0` m | grid pitch of outcrop candidates |
| neighbourhood | `3 × 3` | so blobs straddle cell borders |
| second hash offset | `+71.3` | decorrelates `r2` from `r` |
| cull threshold | `r2.x > 0.34` → skip | ~66% of cells culled |
| centre jitter | `(id + 0.15 + r * 0.7) * cell` | offset `0.15`, jitter span `0.7` cell |
| radius | `7.0 + r2.y * 11.0` m | 7–18 m |
| influence cutoff | `d > radius * 1.6` → skip | early-out |
| falloff | `t = clamp(1 - d/radius, 0, 1)`; `dome = t²(3-2t)` | smoothstep dome |
| roughness domain | `windMat(w, 1.0, 1.0, 5.5)` about `(p - centre)` | isotropic, 5.5 m wavelength |
| roughness noise | `ridgedd(·, 3, 2.17, 0.55).x` | 3 octaves, lac 2.17, gain 0.55 |
| height | `3.5 + r2.y * 6.0` m | 3.5–9.5 m |
| roughness blend | `0.62 + 0.55 * rough` | the noise rides the dome, never detaches |
| mask | `max(mask, dome * dome)` | squared dome → tighter than the height footprint |

The mask goes to the **G channel** of the height bake and is forwarded to the **B channel** of
the aux bake; the snow material uses it to resolve where snow re-accumulates on flatter rock
faces.

### 8.4 `windLocal` — the local veer and anisotropy field

This function is why the field does not read as corduroy. Verbatim rationale:

> One global bearing gives every ridge in the field the same direction and the same aspect
> ratio, and the result reads as corduroy — a woven texture laid over the landform rather than
> snow carved by weather. Real sastrugi does not do that: the wind veers as it crosses a dune,
> so the field breaks into patches that run at slightly different angles and are streakier in
> some places than others.

```wgsl
fn windLocal(p: vec2f) -> vec2f {
    let veer    = noise2(p * 0.0083 + vec2f(31.7, 12.3)) * 0.42;
    let stretch = 2.3 + 2.4 * (noise2(p * 0.0126 + vec2f(7.1, 41.9)) * 0.5 + 0.5);
    return vec2f(veer, stretch);
}
```

| Field | Frequency | Wavelength | Offset | Output range |
|---|---|---|---|---|
| `veer` (`.x`) | `0.0083` | **≈120.5 m** | `(31.7, 12.3)` | `±0.42` rad = ±24.1° |
| `stretch` (`.y`) | `0.0126` | **≈79.4 m** | `(7.1, 41.9)` | `2.3 … 4.7` |

`stretch` remaps `noise2` from `[-1,1]` to `[0,1]` via `*0.5 + 0.5` and then to `[2.3, 4.7]`.
It becomes the `sy` argument of the sastrugi `windMat`, i.e. the **across-wind compression**
that makes ridges streak along the wind, and it varies spatially at an ~80 m scale.

Both `terrainFine` and `terrainFineFiltered` call `windLocal(p)` — they **must** produce the
same surface, since one is the vertex displacement and the other the fragment normal.

### 8.5 `terrainFine` — sastrugi + ripples + grain (vertex-stage, unfiltered)

Returns `vec3f(height in metres, dH/dx, dH/dz)`.
`exposure` (0..1) comes from the baked curvature channel: wind scours crests into hard
sastrugi and leaves hollows smooth, so the two fine layers are cross-faded by it.

```wgsl
fn terrainFine(p: vec2f, w: f32, exposure: f32, amp: f32) -> vec3f {
    var h = 0.0;
    var d = vec2f(0.0);

    let wl = windLocal(p);

    // --- sastrugi ---
    // Compressed *across* the wind, so the ridges streak along it. Ridged noise gives the
    // hard scalloped crest and soft trough that sastrugi actually has.
    let m3 = windMat(w + wl.x, 1.0, wl.y, 2.3);
    let sas = ridgedd(m3 * p, 3, 2.11, 0.52);
    let scour = 0.45 + 0.55 * smoothstep(-0.25, 0.35, noise2(p * 0.021));
    let sasAmp = 0.125 * amp * mix(0.45, 1.0, exposure) * scour;
    h += (sas.x - 0.35) * sasAmp;
    d += (sas.yz * m3) * sasAmp;

    // --- wind ripples ---
    // Fine transverse corrugation, strongest in the sheltered flats where sastrugi is weak.
    // Veered by HALF of what the sastrugi is: ripples form in the boundary layer and follow
    // the local flow more closely than the metre-scale forms do, but giving them the same
    // veer makes the two layers move together and the field goes back to reading as one
    // woven sheet.
    let m4 = windMat(w + wl.x * 0.5, 2.9, 1.0, 0.42);
    let rip = noised(m4 * p);
    let ripAmp = 0.024 * amp * mix(1.0, 0.45, exposure);
    h += rip.x * ripAmp;
    d += (rip.yz * m4) * ripAmp;

    // --- grain ---
    // Sub-centimetre. Too small to displace geometry usefully, but it keeps the normal
    // field alive right under the camera.
    let m5 = windMat(w, 1.0, 1.0, 0.115);
    let gr = noised(m5 * p);
    let grAmp = 0.0075 * amp;
    h += gr.x * grAmp;
    d += (gr.yz * m5) * grAmp;

    return vec3f(h, d);
}
```

| Layer | Domain | Noise | Amplitude expression | Peak amplitude at `amp=1` |
|---|---|---|---|---|
| Sastrugi | `windMat(w + veer, 1.0, stretch, 2.3)` | `ridgedd(·, 3, 2.11, 0.52)` | `0.125 · amp · mix(0.45,1.0,exposure) · scour` | ≈ **0.125 m** ⇒ 10–30 cm proud |
| Ripples | `windMat(w + veer*0.5, 2.9, 1.0, 0.42)` | `noised(·)` | `0.024 · amp · mix(1.0,0.45,exposure)` | **0.024 m** |
| Grain | `windMat(w, 1.0, 1.0, 0.115)` | `noised(·)` | `0.0075 · amp` | **0.0075 m** |

**`scour`** — `0.45 + 0.55 * smoothstep(-0.25, 0.35, noise2(p * 0.021))`. Frequency `0.021`
⇒ wavelength ≈ **47.6 m**. Range `[0.45, 1.0]`. This is the second de-corduroying device:
scoured patches and smooth patches at a ~48 m scale.

**`sas.x - 0.35`** — the DC removal. `ridgedd` output is strictly non-negative with a mean near
0.35; subtracting it centres the sastrugi layer so it does not simply lift the whole field.

**Exposure cross-fade, exactly:**
- Sastrugi scales with `mix(0.45, 1.0, exposure)` → **stronger on scoured crests**.
- Ripples scale with `mix(1.0, 0.45, exposure)` → **stronger in sheltered hollows**.
This is an inverse cross-fade, not a shared multiplier.

### 8.6 `terrainFineFiltered` — the fragment-stage twin

Same three layers, same constants, but each fades out once its wavelength drops near the size
of a pixel. Verbatim rationale, which a port must not "optimise" away:

> Without this the sastrugi turns into a crawling moiré carpet across the mid-distance the
> moment the camera moves — and unlike geometry aliasing, TAA cannot rescue normal-map
> aliasing, because the signal is already wrong before it is sampled. Fading is not a quality
> compromise here; it *is* the filter.

`fp` is the **world-space size of one pixel**, taken from `fwidth()`-style derivatives on world
position. In `snow.fragment.wgsl` the caller computes:

```wgsl
let ddxW = dpdx(world);
let ddyW = dpdy(world);
let footprint = max(length(vec2f(length(ddxW.xz), length(ddyW.xz))), 1e-4);
```

and passes `footprint` as `fp`.

```wgsl
fn terrainFineFiltered(p: vec2f, w: f32, exposure: f32, amp: f32, fp: f32) -> vec3f {
    var h = 0.0;
    var d = vec2f(0.0);
    let wl = windLocal(p);

    let fadeS = 1.0 - smoothstep(0.35, 1.6, fp);      // sastrugi, wavelength ~2.3 m
    if (fadeS > 0.001) {
        let m3 = windMat(w + wl.x, 1.0, wl.y, 2.3);
        let sas = ridgedd(m3 * p, 3, 2.11, 0.52);
        let scour = 0.45 + 0.55 * smoothstep(-0.25, 0.35, noise2(p * 0.021));
        let a = 0.125 * amp * mix(0.45, 1.0, exposure) * scour * fadeS;
        h += (sas.x - 0.35) * a;
        d += (sas.yz * m3) * a;
    }

    let fadeR = 1.0 - smoothstep(0.06, 0.3, fp);      // ripples, wavelength ~0.42 m
    if (fadeR > 0.001) {
        let m4 = windMat(w + wl.x * 0.5, 2.9, 1.0, 0.42);
        let rip = noised(m4 * p);
        let a = 0.024 * amp * mix(1.0, 0.45, exposure) * fadeR;
        h += rip.x * a;
        d += (rip.yz * m4) * a;
    }

    let fadeG = 1.0 - smoothstep(0.016, 0.08, fp);    // grain, wavelength ~0.115 m
    if (fadeG > 0.001) {
        let m5 = windMat(w, 1.0, 1.0, 0.115);
        let gr = noised(m5 * p);
        let a = 0.0075 * amp * fadeG;
        h += gr.x * a;
        d += (gr.yz * m5) * a;
    }

    return vec3f(h, d);
}
```

| Layer | Wavelength | Fade `smoothstep(a, b, fp)` | Fully on below | Fully off above |
|---|---|---|---|---|
| Sastrugi | ~2.3 m | `0.35 → 1.6` | 0.35 m/px | 1.6 m/px |
| Ripples | ~0.42 m | `0.06 → 0.3` | 0.06 m/px | 0.3 m/px |
| Grain | ~0.115 m | `0.016 → 0.08` | 0.016 m/px | 0.08 m/px |

Early-out threshold on every layer: `> 0.001`.

**The consumer.** In `snow.fragment.wgsl`:

```wgsl
let aux = textureSampleLevel(auxTex, auxTexSampler, input.vHeightUV, 0.0);
var grad = aux.xy;
let rockMask = aux.z;
let exposure = aux.w;

let fine = terrainFineFiltered(world.xz, uniforms.windAngle, exposure, uniforms.sastrugiAmp, footprint);
grad += fine.yz;
// … deformation gradient added here …
var N = normalFromGradient(grad);
```

Only `.yz` (the gradient) is consumed in the fragment stage; `.x` (the height) is discarded
there because the geometry already carries it.

---

## 9. The 4096² bake and the CPU mirror

### 9.1 `heightBake.fragment.wgsl` — the macro bake

```wgsl
#include<snowNoise>
#include<snowTerrain>

varying vUV: vec2f;

uniform worldOrigin: vec2f;
uniform worldSize: f32;
uniform windAngle: f32;
uniform heightAmp: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let p = uniforms.worldOrigin + input.vUV * uniforms.worldSize;

    var h = terrainMacro(p, uniforms.windAngle, uniforms.heightAmp);

    // Rock displaces snow upward; snow then re-accumulates on the flatter faces,
    // which the snow material resolves from the mask in the aux bake.
    let rock = rockField(p, uniforms.windAngle);
    h += rock.x;

    fragmentOutputs.color = vec4f(h, rock.y, 0.0, 1.0);
}
```

**Output channel layout — `heightTex`, 4096², `RG32F`:**

| Channel | Contents | Units |
|---|---|---|
| `.r` | macro height (dunes + swell + drifts + rock height) | metres |
| `.g` | rock mask | 0 = snow, 1 = bare rock |
| `.b`, `.a` | **not allocated** — the texture is two-channel | — |

The source comment justifies the two-channel format explicitly:

> Two channels, not four: the bake writes height in R and the rock mask in G, and nothing
> reads B or A. At 4096² the two unused channels would be 134 MB of VRAM holding zeroes.

(The JSDoc header at the top of `heightfield.js` says "heightTex R32F"; the constructor
actually requests `TEXTURETYPE_FLOAT` + `TEXTUREFORMAT_RG`, i.e. **RG32F**, and the fragment
shader writes two meaningful channels. The README also says RG32F. Treat RG32F as canonical
and the header comment as stale.)

Texture creation, verbatim:

```js
this.heightTex = new ProceduralTexture("heightTex",
    { width: HEIGHT_RES, height: HEIGHT_RES }, "heightBake", scene, {
        generateMipMaps: false,
        type: Constants.TEXTURETYPE_FLOAT,
        format: Constants.TEXTUREFORMAT_RG,
        samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
        shaderLanguage: ShaderLanguage.WGSL,
        skipSceneRegistration: true,
    });
this.heightTex.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
this.heightTex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
this.heightTex.refreshRate = 0;          // bake once, never again
```

**Bilinear filtering on a float texture is mandatory** — `sampleHeightBicubic` depends on it.
See §12.5.

### 9.2 Bake orchestration and ordering

```js
async bake() {
    const windAngle = (S.windDirection * Math.PI) / 180;

    this.heightTex.setVector2("worldOrigin", this.origin);   // (-1024, -1024)
    this.heightTex.setFloat("worldSize", this.size);         // 2048
    this.heightTex.setFloat("windAngle", windAngle);
    this.heightTex.setFloat("heightAmp", S.macroHeightScale); // default 1.0
    await bakeOnce(this.heightTex, "heightBake");

    // The aux bake differentiates the height bake, so it has to run after.
    this.auxTex.setTexture("heightTex", this.heightTex);
    this.auxTex.setFloat("texelWorld", this.texelWorld);      // 0.5
    this.auxTex.setFloat("invHeightRes", 1 / HEIGHT_RES);     // 1/4096
    await bakeOnce(this.auxTex, "auxBake");

    await this._readback();
}
```

Strict ordering: **height bake → aux bake → CPU readback**. `bakeOnce` waits for shader
compilation (`isReady()` polling with a 25 s timeout) and then renders exactly one frame.

Called from `Terrain.build()`, which first bakes the detail texture, then the heightfield, then
publishes the vertical bounds to the shadow system:

```js
this.shadows.setHeightBounds(
    this.heightfield.minHeight - 4,     // metres of margin below
    this.heightfield.maxHeight + 6      // metres of margin above (berms, standing figures)
);
```

### 9.3 The CPU mirror — `_readback()`

The whole reason the field is baked at all. Verbatim:

> Character grounding, footfall placement and spell impact points all need heights, and
> re-implementing the noise in JavaScript would mean f32 GPU maths against f64 JS maths — the
> two would disagree by centimetres and the character would visibly float or sink. Reading back
> the exact bake makes disagreement structurally impossible.

```js
async _readback() {
    const raw = await this.heightTex.readPixels(0, 0);
    if (!raw) { console.warn("[heightfield] readback failed; grounding will be flat"); return; }
    const src = /** @type {Float32Array} */ (raw);

    // Derived rather than assumed. `readPixels` may hand back the texture's own channel
    // count or a widened RGBA copy depending on the backend, and getting this wrong does
    // not throw — it silently shears the grounding field.
    const stride = Math.max(1, Math.round(src.length / (HEIGHT_RES * HEIGHT_RES)));

    // Keep only R, at half resolution: 1 m spacing is ample for grounding and avoids
    // holding 67 MB resident forever.
    //
    // Averaged as a 2x2 box rather than point-sampled. Point-sampling texel 2x puts the
    // sample at world (x + 0.25) while `heightAt` reconstructs as though it sat at
    // (x + 0.5), and a quarter-texel shift on a steep dune face sinks the character into
    // the surface. The box filter lands the sample exactly on the centre `heightAt` assumes.
    const res = HEIGHT_RES / 2;                     // 2048
    const dst = new Float32Array(res * res);        // 4,194,304 floats = 16.8 MB
    for (let y = 0; y < res; y++) {
        const r0 = y * 2 * HEIGHT_RES;
        const r1 = (y * 2 + 1) * HEIGHT_RES;
        for (let x = 0; x < res; x++) {
            const c0 = x * 2;
            const c1 = c0 + 1;
            dst[y * res + x] =
                (src[(r0 + c0) * stride] + src[(r0 + c1) * stride] +
                 src[(r1 + c0) * stride] + src[(r1 + c1) * stride]) * 0.25;
        }
    }

    this.heightCPU = dst;
    this.cpuRes    = res;                 // 2048
    this.cpuTexel  = this.size / res;     // 1.0 m

    // Actual relief. Measured rather than assumed, because the bake's amplitude is a
    // tunable and a bound that is quietly wrong clips geometry out of the depth map.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < dst.length; i++) {
        const v = dst[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    this.minHeight = lo;
    this.maxHeight = hi;
}
```

Three things a port must not skip:

1. **`stride` is derived, never assumed.** The readback may come back as RG or as a widened
   RGBA copy. Guessing wrong does not throw — it shears the grounding field.
2. **2×2 box average, not point sample.** The half-resolution mirror's sample must land on the
   centre `heightAt` reconstructs from. Point-sampling shifts by a quarter texel and sinks the
   character into steep dune faces.
3. **`minHeight`/`maxHeight` are measured**, not derived from the amplitude constants.

### 9.4 `heightAt(x, z)` — the CPU B-spline, matching the vertex shader

```js
heightAt(x, z) {
    const h = this.heightCPU;
    if (!h) return 0;
    const res = this.cpuRes;                                  // 2048

    const fx = ((x - this.origin.x) / this.size) * res - 0.5;
    const fz = ((z - this.origin.y) / this.size) * res - 0.5;

    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix,        tz = fz - iz;

    const wx = _w, wz = _w2;              // module-level Float32Array(4) scratch — no alloc
    bsplineWeights(tx, wx);
    bsplineWeights(tz, wz);

    let sum = 0;
    for (let j = 0; j < 4; j++) {
        const zz = clampi(iz - 1 + j, 0, res - 1);
        const row = zz * res;
        let rowSum = 0;
        for (let i = 0; i < 4; i++) {
            const xx = clampi(ix - 1 + i, 0, res - 1);
            rowSum += h[row + xx] * wx[i];
        }
        sum += rowSum * wz[j];
    }
    return sum;
}

function bsplineWeights(t, out) {
    const t2 = t * t, t3 = t2 * t;
    out[0] = (1 - 3*t + 3*t2 -   t3) / 6;
    out[1] = (4       - 6*t2 + 3*t3) / 6;
    out[2] = (1 + 3*t + 3*t2 - 3*t3) / 6;
    out[3] =                    t3   / 6;
}

function clampi(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
```

These are the **same** four cubic B-spline weights `sampleHeightBicubic` uses, just applied as
a 4×4 gather instead of four bilinear taps. Border handling is index clamping, matching
`TEXTURE_CLAMP_ADDRESSMODE`.

Note the resolution difference is deliberate and does not break agreement: the GPU reconstructs
from 4096² and the CPU from a 2×2-box-averaged 2048², which is the same signal band-limited
one octave lower. The 2×2 box is exactly what makes the two agree at the centres.

### 9.5 `normalAt(x, z, out)`

```js
normalAt(x, z, out) {
    const e = this.cpuTexel || 1;                                    // 1.0 m
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    out.set(-hx / (2 * e), 1, -hz / (2 * e));
    out.normalize();
    return out;
}
```

Four `heightAt` calls (64 taps) per normal. Central difference at one CPU texel = 1 m.

### 9.6 `clampToPlayArea(v)`

```js
clampToPlayArea(v) {
    const r = PLAY_RADIUS;                 // 620 m
    const d = Math.hypot(v.x, v.z);
    if (d > r) { const k = r / d; v.x *= k; v.z *= k; }
}
```

Called every frame on `character.position` in `main.js`, immediately after
`character.update()`. Keeps the player inside a 620 m disc, leaving margin inside the 870.4 m
clipmap and inside the 1024 m half-field.

### 9.7 Consumers of `heightAt`

Enumerated so a port knows the CPU mirror is not optional: camera spring-arm ground clearance
(`rig.groundAt`), character controller ground height, foot planting (`figure.js` — three call
sites, offset by `sink * 0.7` and `sink`), cloth hem contact (`+0.012` m), snow-surf wake spine
sampling, spray particle ground collision, and four of the five spells (`bending.js` binary
search for a ground crossing, `ribbon.js` skim tests, `crystallize.js` prism base at
`heightAt(x,z) - 0.06`).

---

## 10. The aux bake (`auxBake.fragment.wgsl`) — 2048² RGBA16F

Not on the assignment's file list but structurally part of this subsystem: its `.a` channel is
sampled by **all three terrain vertex programs**, and its `.xy` is the runtime macro gradient.

```wgsl
varying vUV: vec2f;

var heightTex: texture_2d<f32>;
var heightTexSampler: sampler;

uniform texelWorld: f32;   // world metres per height texel  (0.5)
uniform invHeightRes: f32; // 1 / 4096

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = input.vUV;
    let t = uniforms.invHeightRes;
    let d = uniforms.texelWorld;

    let hL = textureSample(heightTex, heightTexSampler, uv - vec2f(t, 0.0));
    let hR = textureSample(heightTex, heightTexSampler, uv + vec2f(t, 0.0));
    let hD = textureSample(heightTex, heightTexSampler, uv - vec2f(0.0, t));
    let hU = textureSample(heightTex, heightTexSampler, uv + vec2f(0.0, t));
    let hC = textureSample(heightTex, heightTexSampler, uv);

    // Central difference — second-order accurate, and symmetric so flat ground produces
    // exactly zero slope instead of a bias.
    let dHdx = (hR.x - hL.x) / (2.0 * d);
    let dHdz = (hU.x - hD.x) / (2.0 * d);

    // --- exposure ---
    // Wide-stencil Laplacian: positive on convex crests (which the wind scours and packs
    // into sastrugi), negative in concave hollows (where loose drift collects). Sampling
    // wide deliberately ignores the fine corrugation and answers only "is this a crest or
    // a pocket".
    let w  = t * 6.0;
    let wd = d * 6.0;
    let lL = textureSample(heightTex, heightTexSampler, uv - vec2f(w, 0.0)).x;
    let lR = textureSample(heightTex, heightTexSampler, uv + vec2f(w, 0.0)).x;
    let lD = textureSample(heightTex, heightTexSampler, uv - vec2f(0.0, w)).x;
    let lU = textureSample(heightTex, heightTexSampler, uv + vec2f(0.0, w)).x;
    let lap = (lL + lR + lD + lU - 4.0 * hC.x) / (wd * wd);

    // -lap so crests come out positive. The scale is set against the actual curvature of
    // the dune field: 15 m of relief at a ~58 m wavelength gives a second derivative around
    // 0.18 m^-1, so this has to be near 1/0.18 to produce a usable gradient. Anything larger
    // saturates to a hard 0/1 mask and the sastrugi cross-fade stops being a cross-fade.
    let exposure = clamp(0.5 - lap * 2.2, 0.0, 1.0);

    fragmentOutputs.color = vec4f(dHdx, dHdz, hC.y, exposure);
}
```

**Output channel layout — `auxTex`, 2048², `RGBA16F`, bilinear, clamp, no mips:**

| Channel | Contents | Range / units |
|---|---|---|
| `.r` | `dH/dx` | metres per metre |
| `.g` | `dH/dz` | metres per metre |
| `.b` | rock mask (forwarded from `heightTex.g`) | 0 = snow, 1 = bare rock |
| `.a` | **exposure** — 1 on scoured crests, 0 in sheltered hollows | 0…1 |

Constants: gradient stencil `±1` height texel (`t = 1/4096`, world `d = 0.5` m); Laplacian
stencil `×6` texels (`w = 6/4096` UV, `wd = 3.0` m); exposure `clamp(0.5 - lap * 2.2, 0, 1)`.

**Why differentiate the bake and not the analytic function:**

> Differentiating the bake (instead of re-evaluating `terrainMacroD`) guarantees the normals
> describe the exact surface the vertex shader displaces to. If the two were derived
> independently, lighting would disagree with silhouette and smooth dunes would show phantom
> shading seams.

**Resolution note.** The aux bake is 2048² sampling a 4096² source bilinearly. Aux texel centre
`(i+0.5)/2048 = (2i+1)/4096` sits exactly between height texel centres `2i` and `2i+1`, so each
bilinear fetch returns the **average of a 2×2 height block** — the same box filter the CPU
mirror applies. That consistency is not accidental and should be preserved.

---

## 11. The three vertex programs

All three include, in this order: `<snowNoise>`, `<snowTerrain>`, `<snowDeform>`,
`<snowClipmap>`. All three take the `position` attribute as `(gridI, ringLevel, gridJ)`. All
three run the identical placement + displacement.

### 11.1 Beauty pass — `snow.vertex.wgsl`

```wgsl
attribute position: vec3f;   // (gridI, ringLevel, gridJ)

uniform viewProjection: mat4x4f;
uniform cameraPos: vec3f;
uniform lodCenter: vec2f;      // the CHARACTER, not the camera
uniform baseSpacing: f32;
uniform gridHalfN: f32;
uniform worldOrigin: vec2f;
uniform worldSize: f32;
uniform heightRes: f32;
uniform windAngle: f32;
uniform macroAmp: f32;
uniform sastrugiAmp: f32;
uniform deformCenter: vec2f;
uniform deformSize: f32;
uniform deformDepthScale: f32;

var heightTex / heightTexSampler;
var auxTex    / auxTexSampler;
var deformTex / deformTexSampler;

varying vWorld: vec3f;
varying vHeightUV: vec2f;
varying vViewDist: f32;
varying vSpacing: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let grid  = vec2f(vertexInputs.position.x, vertexInputs.position.z);
    let level = vertexInputs.position.y;

    let cv = placeClipmapVertex(grid, level, uniforms.lodCenter,
                                uniforms.baseSpacing, uniforms.gridHalfN);

    let worldXZ = cv.worldXZ;
    let hUV = worldToHeightUV(worldXZ, uniforms.worldOrigin, uniforms.worldSize);

    // --- macro height ---
    var h = sampleHeightBicubic(heightTex, heightTexSampler, hUV, uniforms.heightRes);

    // --- fine height ---
    let exposure = textureSampleLevel(auxTex, auxTexSampler, hUV, 0.0).a;
    if (cv.spacing < 0.42) {
        let fade = 1.0 - smoothstep(0.16, 0.42, cv.spacing);
        h += terrainFine(worldXZ, uniforms.windAngle, exposure, uniforms.sastrugiAmp).x * fade;
    }

    // --- deformation ---
    if (cv.spacing < 1.0) {
        let dfade = 1.0 - smoothstep(0.5, 1.0, cv.spacing);
        h += deformHeight(deformTex, deformTexSampler, worldXZ,
                          uniforms.deformCenter, uniforms.deformSize,
                          uniforms.deformDepthScale, cv.spacing) * dfade;
    }

    let world = vec3f(worldXZ.x, h, worldXZ.y);

    vertexOutputs.vWorld    = world;
    vertexOutputs.vHeightUV = hUV;
    vertexOutputs.vViewDist = distance(world, uniforms.cameraPos);
    vertexOutputs.vSpacing  = cv.spacing;

    vertexOutputs.position = uniforms.viewProjection * vec4f(world, 1.0);
}
```

**Note `macroAmp` is declared but not used in the vertex program** — the macro amplitude was
already applied at bake time (`heightAmp`). It is declared because the material's uniform list
declares it and the fragment stage may reference it.

**The two gates, and why their numbers are what they are.**

| Gate | Condition | Fade | Rationale (verbatim from source) |
|---|---|---|---|
| Fine displacement | `cv.spacing < 0.42` | `1 - smoothstep(0.16, 0.42, spacing)` | "Past roughly 40 cm spacing the sastrugi is smaller than a triangle, and displacing it there would just alias — the fragment shader keeps carrying it in the normal, which is where it still reads." |
| Deformation | `cv.spacing < 1.0` | `1 - smoothstep(0.5, 1.0, spacing)` | "A trail is the opposite shape of problem — half a metre wide but up to half a metre deep — so it is worth displacing well past the point where the lattice resolves its walls, provided it is band-limited on the way in." |

Because `cv.spacing = spacing(L) * (1 + morph)` ∈ `[spacing(L), 2·spacing(L)]`:

| Level | `cv.spacing` range | fine fade range | deform fade range |
|---|---|---|---|
| 0 | 0.085 – 0.17 | 1.000 → 0.996 | 1.0 |
| 1 | 0.17 – 0.34 | 0.996 → 0.443 | 1.0 |
| 2 | 0.34 – 0.68 | 0.443 → 0 (cuts at 0.42) | 1.0 → 0 (cuts at 1.0, reached at morph≈0.47) |
| 3 | 0.68 – 1.36 | 0 | 0.352 → 0 |
| 4–7 | ≥ 1.36 | 0 | 0 |

**Ring 0 and ring 1 carry the sastrugi as real geometry; the deformation reaches out into
ring 3.** These exact gates are mirrored in the prepass and in all three shadow cascades.

### 11.2 `deformHeight` — the band-limited displacement read (`lib/deform.wgsl`)

Called identically from all three vertex programs. Included because the gate arguments above
are meaningless without it.

```wgsl
fn deformUV(worldXZ: vec2f, size: f32) -> vec2f {
    return fract(worldXZ / size);          // toroidal addressing; sampler must be WRAP
}

fn deformFalloff(worldXZ: vec2f, centre: vec2f, size: f32) -> f32 {
    let d = abs(worldXZ - centre) / (size * 0.5);
    return 1.0 - smoothstep(0.80, 0.96, max(d.x, d.y));
}

fn deformHeight(tex, samp, worldXZ: vec2f, centre: vec2f, size: f32,
                scale: f32, spacing: f32) -> f32 {
    let w = deformFalloff(worldXZ, centre, size);
    if (w <= 0.0) { return 0.0; }

    let base = deformUV(worldXZ, size);
    let r = spacing / size;                // tap offset, in UV — one lattice spacing

    var acc = 0.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            // Binomial [1,2,1] x [1,2,1] / 16.
            let wt = f32((2 - abs(i)) * (2 - abs(j))) * (1.0 / 16.0);
            let uv = base + vec2f(f32(i), f32(j)) * r;
            let s = textureSampleLevel(tex, samp, uv, 0.0);
            acc += (s.g - s.r) * wt;       // displaced mass minus depression depth
        }
    }
    return acc * scale * w;
}
```

Constants: falloff `smoothstep(0.80, 0.96, ·)` on normalised Chebyshev distance from the window
centre; separable 3×3 binomial `[1,2,1]⊗[1,2,1]/16` with taps **one `spacing` apart** — putting
the filter's first zero exactly at the lattice Nyquist (wavelength `2 × spacing`). A broad
trench at `8 × spacing` still passes at 85%. Because `spacing` is continuous through the CDLOD
morph, so is the filter: two rings meeting at a shared vertex compute the same width and the
same height, and the mesh stays crack-free.

Deformation buffer channels (RGBA16F, written by a separate subsystem): `.r` depression depth,
`.g` displaced mass (berm), `.b` compression, `.a` ice.

### 11.3 Depth prepass — `terrainPrepass.vertex.wgsl`

Identical placement, identical fine gate, identical deform gate. Differences:

- No `macroAmp`, no `cameraPos`-derived varyings other than what it needs.
- Varyings are `vViewZ: f32` and `vMask: f32`.
- `vViewZ = clip.w` — **linear view depth carried as a varying**, not reconstructed from the
  depth buffer.
- `vMask` is the **ice** channel read raw:

```wgsl
// The ice channel, read straight rather than through `deformHeight`'s binomial: this feeds
// a reflection gate, not a displacement, so smoothing it to the vertex lattice would only
// soften the edge of a glaze that the fragment stage draws hard.
var mask = 0.0;
let dWeight = deformFalloff(worldXZ, uniforms.deformCenter, uniforms.deformSize);
if (dWeight > 0.001) {
    let s = textureSampleLevel(deformTex, deformTexSampler,
                               deformUV(worldXZ, uniforms.deformSize), 0.0);
    mask = clamp(s.a, 0.0, 1.0) * dWeight;
}

let clip = uniforms.viewProjection * vec4f(worldXZ.x, h, worldXZ.y, 1.0);
vertexOutputs.vViewZ = clip.w;
vertexOutputs.vMask = mask;
vertexOutputs.position = clip;
```

Material: `backFaceCulling = false`. Registered with the depth pass (a custom render target
created *before* anything that draws, so scene registration order is the whole of the
scheduling). It takes `viewProjection`, which Babylon binds from the active camera — and which
by then carries this frame's **TAA jitter**, so the prepass and the beauty pass agree to the
subpixel.

Consequence stated in the source: if this pass placed a vertex anywhere else, every
screen-space effect downstream would integrate against a surface that is not on screen, and the
symptom is an ambient-occlusion halo that follows the camera.

### 11.4 Shadow cascades — `terrainDepth.vertex.wgsl` / `.fragment.wgsl`

Identical placement. **Critically**, this uses `lodCenter` (the character) and `cameraPos` from
the *camera*, **not** the light:

> the geometry rendered into the shadow map must be the identical mesh the beauty pass draws,
> or the depths will not correspond and the terrain will acne against its own silhouette. Only
> the view-projection differs.

Uniform difference: `lightViewProjection: mat4x4f` instead of `viewProjection`. No `vMask`, no
varyings at all except the built-in position.

```wgsl
vertexOutputs.position = uniforms.lightViewProjection * vec4f(worldXZ.x, h, worldXZ.y, 1.0);
```

Fragment stage writes **NDC z as a colour**:

```wgsl
// Writes NDC depth into the cascade atlas as R32F.
//
// Stored as a plain colour rather than sampled from a depth texture so PCSS can do its
// blocker search with ordinary filtered fetches — a comparison sampler would only ever hand
// back a pre-thresholded result, which is the one thing the blocker search cannot use.
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    fragmentOutputs.color = vec4f(input.position.z, 0.0, 0.0, 1.0);
}
```

`CASCADE_COUNT = 3`. One `ShaderMaterial` **per cascade**, distinguished by
`defines: ["SNOW_CASCADE " + cascade]` — which forces a distinct compiled `Effect` per cascade
so each can carry its own light matrix without mid-frame uniform-buffer swapping.
`backFaceCulling = false` on all three.

---

## 12. Per-frame uniform upload (`Terrain.update`)

Per frame this uploads a handful of uniforms and nothing else. No geometry is rebuilt, no buffer
is re-uploaded, nothing is allocated.

Order of operations inside `update(cameraPos, focus, dt)`:

1. `windAngle = S.windDirection * PI / 180`.
2. **`deformTex = this.deform.update(dt, focus)`** — simulate first, then bind. Rationale:
   "the material must sample the target that was written this frame, not the one from last
   frame, or every mark lands a frame late and fast movement leaves a visible stagger."
3. If the returned target differs from the bound one, `setDeformTexture(tex)` re-points **all
   four** material families (beauty, prepass, 3 × depth) at once.
4. `_lod.set(focus.x, focus.z)` — no extra snapping here; `placeClipmapVertex` snaps per ring.
5. Push uniforms to the beauty material, then to the prepass material, then to each depth
   material.

### 12.1 Beauty-material uniforms relevant to this subsystem

| Uniform | Value |
|---|---|
| `cameraPos` | `Vector3` camera world position |
| `lodCenter` | `(focus.x, focus.z)` = character XZ |
| `baseSpacing` | `BASE_SPACING` = `0.085` |
| `gridHalfN` | `GRID_HALF_N` = `80` |
| `worldOrigin` | `(-1024, -1024)` |
| `worldSize` | `2048` |
| `heightRes` | `4096` (literal) |
| `windAngle` | radians |
| `macroAmp` | `S.macroHeightScale` (default `1.0`) |
| `sastrugiAmp` | `S.sastrugiStrength` (default `1.0`) |
| `deformCenter` | deform window centre, texel-snapped |
| `deformSize` | `80` |
| `deformTexel` | `80/2048 = 0.0390625` |
| `deformDepthScale` | `S.deformDepth` (default `1.0`) |
| `shadowTexel` | `1 / 2048` |
| `shadowSoftness` | `1.8` (literal) |
| `shadowBias` | `0.022` metres (literal) — "Snow has no thin geometry to peter-pan, so this can stay small and keep contact shadows attached." |
| `detailStrength` | `S.detailNormalStrength` |
| `debugMode` | index from `DEBUG_MODES` |
| `screenSize` | render width/height |

`DEBUG_MODES = { beauty:0, deform:1, normals:2, depth:3, cascades:4, footprint:5, fineNormals:6, shadow:7, ndotl:8, shadowMap:9, albedo:10 }`.

The prepass and depth materials receive the **identical** `lodCenter`, `baseSpacing`,
`gridHalfN`, `worldOrigin`, `worldSize`, `heightRes`, `windAngle`, `sastrugiAmp`,
`deformCenter`, `deformSize`, `deformDepthScale`. Any divergence is a rendering bug by
construction.

### 12.2 Load-time ordering (`main.js`)

```
sky.solve()
  → new ShadowSystem
  → new DepthPass                        (registration order == render order)
  → new Terrain (builds clipmap mesh, materials, registers shadow casters)
  → terrain.mesh.renderingGroupId = 1
  → await terrain.build()                (detail bake → height bake → aux bake → readback
                                          → shadows.setHeightBounds)
  → depthPass.registerCaster(terrain.mesh, terrain.makePrepassMaterial())
  → character placed at y = terrain.heightAt(0, 0)
  … 
  → await terrain.warmUp()               (deform.warmUp FIRST — "reading uninitialised VRAM
                                          as a height can put NaN into a vertex position",
                                          then snow material, prepass material, each depth
                                          material, all isReady()-gated with real geometry)
  → terrain.update(camera, character, 0)
```

Per frame: `character.update` → `clampToPlayArea` → `figure.update` → `contact.update` →
`rig.update` → `post.update` (TAA jitter) → `sky` → `shadows.update` → `spells.update` →
**`terrain.update`** → `figure.sync` → `wake.update` → `spray.update` → `scene.render()`.

---

## 13. WebGL2 / Three.js r172 PORTING NOTES

### 13.1 Winding and handedness

Babylon default is **left-handed with clockwise front faces**; the demo never sets
`scene.useRightHandedSystem`. Three.js is **right-handed with counter-clockwise front faces**.

The index emission

```
even quad: (a,b,c) (b,d,c)
odd  quad: (a,d,c) (a,b,d)
```

is front-facing-from-above under Babylon's convention. In Three.js, either

- **swap the last two indices of every triangle** (`a,b,c` → `a,c,b`, etc.), keeping
  `material.side = FrontSide` and `backFaceCulling = true`; **or**
- keep the order and use `side: THREE.BackSide`.

Prefer the first: the shadow and prepass materials in the reference run with
`backFaceCulling = false`, so only the beauty material's culling is actually load-bearing, and
an explicit correct winding is less surprising. Nothing else depends on the winding — the
normal comes entirely from the gradient, never from geometry.

**Do not mirror any axis.** `windAngle`, the wind-anisotropy matrices and the dune orientation
are all expressed in the same world XZ frame; flipping Z would reverse the lee-face asymmetry
relative to the sun.

### 13.2 No compute shaders — the bakes are already fragment passes

Every bake in this subsystem is already a full-screen fragment pass writing a render target
(`ProceduralTexture` in Babylon). Port each to a Three.js `WebGLRenderTarget` + a full-screen
triangle rendered with an `OrthographicCamera` (or `THREE.WebGLRenderer.setRenderTarget` +
a `Mesh(PlaneGeometry, ShaderMaterial)`), rendered **exactly once**:

| Reference | Three.js equivalent |
|---|---|
| `ProceduralTexture("heightBake", 4096²)` | `WebGLRenderTarget(4096, 4096, { format: RGFormat, type: FloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, wrapS/T: ClampToEdgeWrapping })` |
| `ProceduralTexture("auxBake", 2048²)` | `WebGLRenderTarget(2048, 2048, { format: RGBAFormat, type: HalfFloatType, LinearFilter, no mips, ClampToEdgeWrapping })` |
| `ProceduralTexture("detailBake", 1024²)` | `WebGLRenderTarget(1024, 1024, { format: RGBAFormat, type: UnsignedByteType, LinearMipmapLinearFilter, generateMipmaps: true, RepeatWrapping })` |
| `refreshRate = 0` | just render once and never again |
| `bakeOnce()` / `whenReady()` | in WebGL2, program link is synchronous unless `KHR_parallel_shader_compile` is used; a single `renderer.compile(scene, camera)` before the first frame is the equivalent warm-up |

`varying vUV: vec2f` in the bake fragment shaders is the full-screen `[0,1]²` UV. In Three.js
supply it from the full-screen quad's `uv` attribute.

### 13.3 Required extensions and float-format substitutions

| Need | WebGL2 status | Action |
|---|---|---|
| **Render to RG32F / RGBA32F** | requires `EXT_color_buffer_float` | Must be enabled. Universally available on desktop; check and fail loudly. |
| **Render to RGBA16F** | requires `EXT_color_buffer_float` as well | Same. |
| **Linear filtering of 32-bit float textures** | **NOT core.** Requires `OES_texture_float_linear` | **This is the critical one.** `sampleHeightBicubic` does four *bilinear* taps at non-texel-centre offsets. Without this extension, `LinearFilter` on a FloatType texture silently degrades to nearest on some drivers and the dunes become a stair-stepped mosaic. |
| **Linear filtering of half-float textures** | **core in WebGL2** | The aux texture is safe. |
| Vertex texture fetch | core in WebGL2 (`MAX_VERTEX_TEXTURE_IMAGE_UNITS ≥ 16`) | The terrain vertex programs sample 3 textures — fine. |
| 32-bit indices | core in WebGL2 | 998,808 indices need `Uint32Array` + `gl.UNSIGNED_INT`. |

**Fallback plan if `OES_texture_float_linear` is missing** (in preference order):

1. **Emulate the bilinear taps.** Replace each `textureLod(heightTex, o, 0.0).r` in
   `sampleHeightBicubic` with a manual 2×2 `texelFetch` + `mix`. Costs 16 fetches instead of
   4 samples per vertex; still cheap at 207k vertices. This is exact and is the recommended
   fallback.
2. **RG16F instead of RG32F.** Half-float linear filtering is core. But at heights around 40 m
   a half-float has ~0.03 m quantisation, which is visible as terracing on shallow dune flanks
   *and* would desynchronise the CPU mirror against the drawn surface (§13.6). Only acceptable
   if the height range is remapped to roughly `[-1, 1]` before storage and scaled back after —
   at which point precision is ~0.0005 m and acceptable. If you do this, the CPU mirror must
   apply the same remap.
3. **RGBA8 fixed-point encode.** 24-bit fixed point across three channels gives 2048 m / 2²⁴ ≈
   0.12 mm; but hardware bilinear on a packed encoding is meaningless, so this forces option 1's
   manual filtering anyway. Not recommended.

### 13.4 WGSL → GLSL 3.00 es translation table

| WGSL | GLSL ES 3.00 | Note |
|---|---|---|
| `textureSampleLevel(t, s, uv, 0.0)` | `textureLod(sampler2D, uv, 0.0)` | WebGL2 combines texture+sampler; declare `uniform sampler2D heightTex;` |
| `textureSample(t, s, uv)` (fragment only) | `texture(sampler2D, uv)` | |
| `textureLoad(t, ivec, level)` | `texelFetch(sampler2D, ivec2, level)` | needed if emulating bilinear |
| `vec2f` / `vec3f` / `vec4f` | `vec2` / `vec3` / `vec4` | |
| `mat2x2f` | `mat2` | **column-major in both** — `mat2x2f(a,b,c,d)` == `mat2(a,b,c,d)` |
| `m * v` (matrix × column vector) | `m * v` | identical |
| `v * m` (row vector × matrix) | `v * m` | **identical semantics** — `result_j = dot(v, column_j(m))`. So `(sas.yz * m3)` ports verbatim. |
| `select(f, t, cond)` | `cond ? t : f` or `mix(f, t, float(cond))` | argument order is **reversed** vs `mix` |
| `f32(x)` / `i32(x)` | `float(x)` / `int(x)` | |
| `let` / `var` | `const`-less locals; `var` → plain declaration | GLSL `const` requires compile-time constant |
| `fract(x)` | `fract(x)` | **same definition** `x - floor(x)`, same on negatives |
| `sign(0.0)` | `sign(0.0)` | both return `0.0` |
| `exp2(x)` | `exp2(x)` | |
| `clamp`, `mix`, `smoothstep`, `floor`, `abs`, `length`, `dot`, `normalize` | identical | |
| `for (var i = 0; i < n; i++)` with runtime `n` | allowed in GLSL ES 3.00 | dynamic loop bounds are legal; `continue` inside nested loops is legal |
| `@vertex` / `@fragment` entry | `void main()` | |
| `vertexOutputs.position` | `gl_Position` | |
| `varying vFoo: vec3f` | `out vec3 vFoo;` (VS) / `in vec3 vFoo;` (FS) | |
| `fragmentOutputs.color` | `layout(location=0) out vec4 fragColor;` | |
| `input.position.z` in a fragment shader | `gl_FragCoord.z` | **NDC z in `[0,1]` in WebGPU vs `[0,1]` for `gl_FragCoord.z` in GL — see §13.5** |
| `#include<snowNoise>` | manual string concatenation, or Three.js `ShaderChunk` registration | |
| `const D_NEAR: f32 = 5500.0` inside a function | `const float D_NEAR = 5500.0;` | |
| `dpdx` / `dpdy` | `dFdx` / `dFdy` (core in GLSL ES 3.00) | |

**Precision.** GLSL ES 3.00 fragment shaders have **no default float precision** — you must
declare `precision highp float;` and `precision highp int;`. Every hash in §6.1 multiplies by
`0.1031` and takes `fract` of large products; at `mediump` the noise degenerates into visible
banding and repeating tiles. Also declare `precision highp sampler2D;` for the float textures.

### 13.5 Depth conventions

- WebGPU clip space is `z ∈ [0, 1]`; OpenGL/WebGL clip space is `z ∈ [-1, 1]`, and
  `gl_FragCoord.z` maps that to `[0, 1]`. The shadow fragment writes `input.position.z`, which
  in WGSL is the **already-`[0,1]` normalised** fragment depth. In GLSL, `gl_FragCoord.z` is
  also `[0,1]` after the default depth range, so `fragColor = vec4(gl_FragCoord.z, 0, 0, 1)` is
  the correct translation — but only if the **shadow lookup on the read side uses the same
  convention**. If your Three.js light-space projection produces `[-1,1]` NDC and the lookup
  reconstructs `z` as `clip.z / clip.w`, you must apply `* 0.5 + 0.5` on the read side to match
  the stored `gl_FragCoord.z`. Pick one convention and assert it in both places.
- `vViewZ = clip.w` in the prepass is convention-independent (it is view-space distance along
  the camera axis), so that ports unchanged.

### 13.6 Readback

- `heightTex.readPixels()` becomes `renderer.readRenderTargetPixels(target, 0, 0, 4096, 4096,
  buffer)` or the async `readRenderTargetPixelsAsync` (preferred — the sync version stalls the
  pipeline for ~67 MB).
- **Reading back an RG32F target is not universally supported.** `gl.readPixels` on a float
  colour attachment supports `gl.RGBA` + `gl.FLOAT` as the implementation-independent path.
  Allocate a `Float32Array(4096 * 4096 * 4)` = **268 MB transient** and take `.r` with
  stride 4, or read back in horizontal strips (e.g. 8 strips of 512 rows, 33.5 MB each) to
  avoid the peak allocation.
- **Keep the reference's `stride` derivation.** It is a correctness guard, not a portability
  hack: `stride = max(1, round(src.length / (HEIGHT_RES * HEIGHT_RES)))`. Getting it wrong
  shears the grounding field silently.
- **Keep the 2×2 box average and the half-resolution mirror.** Both are load-bearing (§9.3).

### 13.7 Geometry and culling in Three.js

```
geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setIndex(new THREE.BufferAttribute(indices, 1));   // Uint32Array
```

- `mesh.frustumCulled = false` — the attribute is not a position, so the auto-computed bounding
  sphere is meaningless and would cull the terrain from most angles.
- Override `geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)` and
  `geometry.boundingBox` similarly, so any code that touches them does not recompute.
- `mesh.matrixAutoUpdate = false`, matrix left as identity.
- `mesh.renderOrder` — the sky must draw first; use `renderOrder` or a separate scene pass to
  reproduce `renderingGroupId 0 / 1`.
- Three.js will inject its own `position` attribute semantics into built-in shader chunks — use
  a `RawShaderMaterial` (or `ShaderMaterial` with `glslVersion: THREE.GLSL3` and no
  `#include <common>`) so nothing tries to interpret `position` as a real position.

### 13.8 Uniform and material topology

- Babylon compiles a **distinct `Effect` per shadow cascade** via
  `defines: ["SNOW_CASCADE " + c]`. In Three.js the equivalent is three separate
  `RawShaderMaterial` instances (each with its own `lightViewProjection` uniform) — or one
  material re-bound three times, which reintroduces exactly the mid-frame uniform swapping the
  reference was avoiding. Use three materials.
- `bindMatrixArray` is a Babylon-specific zero-allocation trick for `setMatrices`. In Three.js,
  a `uniform mat4 cascadeMatrices[3]` backed by a persistent `Float32Array(48)` and
  `uniform.value = thatArray` achieves the same: no per-frame garbage.
- Babylon's `ShaderMaterial` uniform list is declarative. Three.js requires an explicit
  `uniforms: { name: { value } }` object; keep the same names so the shader source ports
  unchanged.

### 13.9 Timing and misc

- **WebGPU timestamp queries are unavailable in WebGL2.** `EXT_disjoint_timer_query_webgl2` is
  the nearest equivalent and is frequently unavailable/disabled for privacy. Drop the GPU row
  from any overlay, or fall back to CPU wall-clock only — do not fabricate a GPU number.
- `skipSceneRegistration: true` on the procedural textures has no Three.js analogue; just don't
  add the bake quads to the main scene.
- Babylon `TEXTURE_CLAMP_ADDRESSMODE` → `THREE.ClampToEdgeWrapping`; `TEXTURE_WRAP_ADDRESSMODE`
  → `THREE.RepeatWrapping`. The deformation texture **must** be `RepeatWrapping` — `deformUV`
  returns `fract(worldXZ / size)` and the binomial taps read across the wrap.
- WGSL `fract` and GLSL `fract` agree, so toroidal deformation addressing ports unchanged.

### 13.10 Things that will look right but be wrong if you shortcut them

| Shortcut | Symptom |
|---|---|
| Recomputing the noise in JS for grounding instead of mirroring the bake | character floats or sinks by centimetres, worse on steep faces |
| Point-sampling the half-res CPU mirror instead of 2×2 box | character sinks into steep dune faces by a quarter texel of slope |
| Snapping ring origins to `1 × spacing` instead of `2 ×` | surface shimmers as morph targets flip between frames |
| Centring the clipmap on the camera instead of the character | carved trails change shape when you orbit |
| Differentiating `terrainMacro` analytically at runtime instead of the aux bake | phantom shading seams on smooth dunes; lighting disagrees with silhouette |
| Using one diagonal per quad | faint uniform corduroy of shading seams across the field |
| Dropping the fine-layer footprint fades | crawling moiré carpet in the mid-distance; TAA cannot rescue it |
| Different deform gate/fade/filter width between beauty and shadow passes | every berm acnes against itself |
| Giving ripples the same veer as sastrugi | the field goes back to reading as one woven sheet |
| A single global wind bearing with no `windLocal` | corduroy: a woven texture laid over the landform rather than snow carved by weather |

---

## 14. VISUAL ACCEPTANCE CRITERIA

A harsh critic should be able to check every one of these from screenshots. Numbers are the
values a correct port must produce at default settings (`macroHeightScale = 1`,
`sastrugiStrength = 1`, `windDirection = 42°`, `sunAzimuth = 118°`, `sunElevation = 13°`).

1. **Dune ridge lines run consistently transverse to the wind bearing, and the sastrugi streaks
   run along it — the two are roughly perpendicular in every screenshot.** With the default
   `windDirection = 42°`, the broad ridge crests should read as a family of roughly parallel
   lines at right angles to a 42° bearing, while the sub-metre corrugation on top of them runs
   *with* the 42° bearing. If both families run the same way, `windMat`'s `sx`/`sy` have been
   swapped on one of the layers.

2. **Dune cross-sections are visibly asymmetric: the downwind (lee) flank is steeper than the
   windward one.** Look along a ridge line at a grazing angle — the lit windward face should
   be a long shallow ramp and the shadowed lee face a shorter, steeper drop. This comes from
   the `q2.x += broad.x * 2.4` shear; if the dunes are symmetric sine-like humps the shear is
   missing.

3. **Detail pools in the troughs and thins out on the crests.** The metre-scale drift texture
   should be visibly denser in the hollows between dunes and visibly scoured off the tops
   (`shelter` clamps between 0.15 and 1.0, so crests retain 15% not 0%). A field with uniform
   detail density everywhere means `fbmDamped`'s damping term or `shelter` was dropped.

4. **Crest lines are smooth and unbroken over tens of metres; troughs are busy.** Derivative-
   damped fBm produces smooth crests specifically. If crests are lumpy or beaded, `fbmDamped`
   was replaced by plain `fbmd`.

5. **There is no visible ring boundary, seam, crack, or LOD pop anywhere in the frame — while
   the camera orbits and while the player walks.** Specifically: no line of sky visible through
   the terrain, no step in the surface at 6.8 m, 13.6 m, 27.2 m, 54.4 m, 108.8 m, 217.6 m or
   435.2 m from the character, and no visible flicker as the player crosses a snap boundary.

6. **Sastrugi exists as real geometry within about 13 m of the character and as normal-only
   shading beyond it — and the transition is invisible.** Walk a slope and watch the silhouette
   against the sky: within ring 0/1 the horizon line should be visibly nibbled by 10–30 cm
   ridges; further out the same texture continues as shading only. Any visible band where the
   texture changes character means the `smoothstep(0.16, 0.42, spacing)` fade is wrong.

7. **Sastrugi does not shimmer, crawl or moiré in the mid-distance under camera motion.** Pan
   the camera slowly across a flat plain at ~30–80 m. The fine texture must fade smoothly to
   nothing rather than boiling. Any crawling carpet means `terrainFineFiltered`'s footprint
   fades (`0.35→1.6`, `0.06→0.3`, `0.016→0.08` m/px) are missing or the wrong `fp` is passed.

8. **The sastrugi field is patchy, not uniform: some areas run streakier and at a slightly
   different angle than their neighbours, over patches of roughly 50–120 m.** This is
   `windLocal` (±24° veer at ~120 m, stretch 2.3–4.7 at ~80 m) and `scour` (~48 m). If the
   whole field is one uniform corduroy at one angle, `windLocal` was dropped.

9. **Ripples are strongest in the sheltered flats and weakest on the scoured crests — the exact
   inverse of where sastrugi is strongest.** On a crest the surface should read as hard,
   ridged, streaky; in the adjacent hollow it should read as a finer, softer transverse
   corrugation. If both intensify together, the exposure cross-fade
   (`mix(0.45,1.0,exposure)` vs `mix(1.0,0.45,exposure)`) is applied with the same polarity to
   both layers.

10. **The horizon has a long, slow roll on top of the dune wavelength — the field never reads as
    one repeating dune period.** Standing on a high point, the far terrain should show at least
    two distinct scales: ~58 m dune ridges riding on a ~210 m swell of up to ±13 m relief.

11. **Sparse rock outcrops appear — a handful across the visible field, 7–18 m across and
    3.5–9.5 m tall, broken and ridged rather than smooth lumps — and snow visibly re-accumulates
    on their flatter faces.** They should be sparse (~1/3 of a 165 m grid populated) and should
    never form a repeating row.

12. **The character's feet sit exactly on the drawn snow surface at all times, on flat ground
    and on the steepest dune face, with the camera at every zoom level.** No floating, no
    sinking, no change when the camera orbits. This is the single check that validates the whole
    bake-and-mirror architecture; a re-implemented-in-JS heightfield fails it by centimetres on
    slopes.

13. **A carved trail self-shadows and its berms break the silhouette against the sky, with no
    acne on the berm crests.** The trail must be visible as real relief (a trench with a far
    wall you can see) out to at least ~50 m from the character, degrading smoothly to a tonal
    line rather than switching off.

14. **No corduroy of same-direction shading seams following the triangle diagonals.** Look at a
    smoothly lit dune flank at a shallow sun angle: if you can read a regular diagonal weave in
    the shading, either the alternating-diagonal index emission or the bicubic B-spline height
    fetch was replaced by a uniform diagonal / plain bilinear.

15. **Dune surfaces show no diamond-shaped faceting at the 0.5 m height-texel scale.** This is
    the specific artefact bilinear-only height sampling produces; it appears as a lattice of
    diamond creases across otherwise smooth slopes.

---

## 15. Complete numeric constant index

Every distinct numeric constant captured in this document, with its binding identifier, unit and
source file.

### 15.1 World / field / resolution (CPU)

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 1 | `WORLD_SIZE` | 2048 | m | heightfield.js |
| 2 | `HEIGHT_RES` | 4096 | texels | heightfield.js |
| 3 | `AUX_RES` | 2048 | texels | heightfield.js |
| 4 | `PLAY_RADIUS` | 620 | m | heightfield.js |
| 5 | `texelWorld` (derived) | 0.5 | m/texel | heightfield.js |
| 6 | `origin` | (−1024, −1024) | m | heightfield.js |
| 7 | CPU mirror `res` | 2048 | samples | heightfield.js |
| 8 | `cpuTexel` (derived) | 1.0 | m | heightfield.js |
| 9 | 2×2 box weight | 0.25 | — | heightfield.js |
| 10 | B-spline divisor | 6 | — | heightfield.js / clipmap.wgsl |
| 11 | B-spline `w1` numerator base | 4 | — | heightfield.js / clipmap.wgsl |
| 12 | B-spline linear coefficient | 3 | — | heightfield.js / clipmap.wgsl |
| 13 | B-spline quadratic coefficient | 6 | — | heightfield.js / clipmap.wgsl |
| 14 | `heightAt` sample offset | −0.5 | texels | heightfield.js |

### 15.2 Clipmap mesh (CPU)

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 15 | `GRID_N` | 160 | quads/side | clipmapMesh.js |
| 16 | `LEVELS` | 8 | rings | clipmapMesh.js |
| 17 | `BASE_SPACING` | 0.085 | m | clipmapMesh.js |
| 18 | `HOLE_SHRINK` | 3 | cells | clipmapMesh.js |
| 19 | `HALF` (derived) | 80 | cells | clipmapMesh.js |
| 20 | `side` (derived) | 161 | verts/side | clipmapMesh.js |
| 21 | `holeHalf` (derived) | 37 | cells | clipmapMesh.js |
| 22 | `vertsPerLevel` (derived) | 25,921 | verts | clipmapMesh.js |
| 23 | total vertices (derived) | 207,368 | verts | clipmapMesh.js |
| 24 | `holeQuads` (derived) | 5,476 | quads | clipmapMesh.js |
| 25 | total quads (derived) | 166,468 | quads | clipmapMesh.js |
| 26 | total triangles (derived) | 332,936 | tris | clipmapMesh.js |
| 27 | `INNER_EXTENT` (derived) | 6.8 | m | clipmapMesh.js |
| 28 | `OUTER_EXTENT` (derived) | 870.4 | m | clipmapMesh.js |
| 29 | diagonal alternation mask | `(i+j) & 1` | — | clipmapMesh.js |

### 15.3 CDLOD / clipmap vertex (`lib/clipmap.wgsl`)

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 30 | origin snap multiplier | 2.0 | × spacing | clipmap.wgsl |
| 31 | morph start | 0.70 | normalised Chebyshev | clipmap.wgsl |
| 32 | morph width | 0.16 | normalised Chebyshev | clipmap.wgsl |
| 33 | morph completion (derived) | 0.86 | normalised Chebyshev | clipmap.wgsl |
| 34 | coarse-lattice stride | 0.5 / 2.0 | — | clipmap.wgsl |
| 35 | effective spacing multiplier | `1.0 + morph` | — | clipmap.wgsl |
| 36 | bicubic tap offsets | ±1.0, +0.5 | texels | clipmap.wgsl |

### 15.4 Noise library (`lib/noise.wgsl`)

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 37 | `PI` | 3.14159265359 | — | noise.wgsl |
| 38 | hash multiplier X | 0.1031 | — | noise.wgsl |
| 39 | hash multiplier Y | 0.1030 | — | noise.wgsl |
| 40 | hash multiplier Z | 0.0973 | — | noise.wgsl |
| 41 | hash additive | 33.33 | — | noise.wgsl |
| 42 | `grad2` angle scale | 6.28318530718 | rad | noise.wgsl |
| 43 | quintic fade coefficient a | 6.0 | — | noise.wgsl |
| 44 | quintic fade coefficient b | −15.0 | — | noise.wgsl |
| 45 | quintic fade coefficient c | 10.0 | — | noise.wgsl |
| 46 | quintic derivative scale | 30.0 | — | noise.wgsl |
| 47 | quintic derivative inner | −2.0, +1.0 | — | noise.wgsl |
| 48 | `noise3` cubic fade | 3.0, −2.0 | — | noise.wgsl |
| 49 | `noise3` corner divisor | 3.0 | — | noise.wgsl |
| 50 | `noise3` range remap | ×2.0 − 1.0 | — | noise.wgsl |
| 51 | fBm initial amplitude | 0.5 | — | noise.wgsl |
| 52 | fBm initial frequency | 1.0 | — | noise.wgsl |
| 53 | fBm per-octave rotation | 0.517 | rad | noise.wgsl |
| 54 | `ridgedd` per-octave rotation | 0.717 | rad | noise.wgsl |
| 55 | `ridgedd` initial `prev` | 1.0 | — | noise.wgsl |
| 56 | `ridgedd` octave coupling | 0.65 | mix factor | noise.wgsl |
| 57 | `ridgedd` crest derivative factor | −2.0 | — | noise.wgsl |
| 58 | `ign` outer multiplier | 52.9829189 | — | noise.wgsl |
| 59 | `ign` dot X | 0.06711056 | — | noise.wgsl |
| 60 | `ign` dot Y | 0.00583715 | — | noise.wgsl |

### 15.5 `terrainMacro` (`lib/terrain.wgsl`)

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 61 | broad `sx` | 2.1 | — | terrain.wgsl |
| 62 | broad `sy` | 1.0 | — | terrain.wgsl |
| 63 | broad wavelength `scale` | 58.0 | m | terrain.wgsl |
| 64 | broad octaves | 5 | — | terrain.wgsl |
| 65 | broad lacunarity | 2.03 | — | terrain.wgsl |
| 66 | broad gain | 0.5 | — | terrain.wgsl |
| 67 | broad damp | 0.9 | — | terrain.wgsl |
| 68 | broad amplitude | 15.5 | m | terrain.wgsl |
| 69 | swell `sx` | 1.35 | — | terrain.wgsl |
| 70 | swell `sy` | 1.0 | — | terrain.wgsl |
| 71 | swell wavelength `scale` | 210.0 | m | terrain.wgsl |
| 72 | swell octaves | 3 | — | terrain.wgsl |
| 73 | swell lacunarity | 2.11 | — | terrain.wgsl |
| 74 | swell gain | 0.55 | — | terrain.wgsl |
| 75 | swell damp | 0.3 | — | terrain.wgsl |
| 76 | swell amplitude | 26.0 | m | terrain.wgsl |
| 77 | medium `sx` | 1.55 | — | terrain.wgsl |
| 78 | medium `sy` | 1.0 | — | terrain.wgsl |
| 79 | medium wavelength `scale` | 13.5 | m | terrain.wgsl |
| 80 | **lee-shear coefficient** | 2.4 | domain units | terrain.wgsl |
| 81 | medium octaves | 4 | — | terrain.wgsl |
| 82 | medium lacunarity | 2.07 | — | terrain.wgsl |
| 83 | medium gain | 0.48 | — | terrain.wgsl |
| 84 | medium damp | 1.7 | — | terrain.wgsl |
| 85 | shelter bias | 0.5 | — | terrain.wgsl |
| 86 | shelter slope | 0.75 | — | terrain.wgsl |
| 87 | shelter clamp low | 0.15 | — | terrain.wgsl |
| 88 | shelter clamp high | 1.0 | — | terrain.wgsl |
| 89 | medium amplitude | 2.9 | m | terrain.wgsl |
| 90 | `terrainMacroD` epsilon | 0.35 | m | terrain.wgsl |

### 15.6 `rockField` (`lib/terrain.wgsl`)

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 91 | `cell` | 165.0 | m | terrain.wgsl |
| 92 | neighbourhood radius | 1 (→3×3) | cells | terrain.wgsl |
| 93 | second-hash offset | 71.3 | — | terrain.wgsl |
| 94 | cull threshold | 0.34 | — | terrain.wgsl |
| 95 | centre base offset | 0.15 | cells | terrain.wgsl |
| 96 | centre jitter span | 0.7 | cells | terrain.wgsl |
| 97 | radius base | 7.0 | m | terrain.wgsl |
| 98 | radius span | 11.0 | m | terrain.wgsl |
| 99 | influence cutoff factor | 1.6 | × radius | terrain.wgsl |
| 100 | dome smoothstep coefficients | 3.0, −2.0 | — | terrain.wgsl |
| 101 | roughness wavelength | 5.5 | m | terrain.wgsl |
| 102 | roughness octaves | 3 | — | terrain.wgsl |
| 103 | roughness lacunarity | 2.17 | — | terrain.wgsl |
| 104 | roughness gain | 0.55 | — | terrain.wgsl |
| 105 | height base | 3.5 | m | terrain.wgsl |
| 106 | height span | 6.0 | m | terrain.wgsl |
| 107 | roughness blend base | 0.62 | — | terrain.wgsl |
| 108 | roughness blend span | 0.55 | — | terrain.wgsl |

### 15.7 `windLocal` / `terrainFine` / `terrainFineFiltered` (`lib/terrain.wgsl`)

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 109 | veer noise frequency | 0.0083 | 1/m (λ≈120.5 m) | terrain.wgsl |
| 110 | veer noise offset | (31.7, 12.3) | — | terrain.wgsl |
| 111 | veer amplitude | 0.42 | rad (±24.1°) | terrain.wgsl |
| 112 | stretch noise frequency | 0.0126 | 1/m (λ≈79.4 m) | terrain.wgsl |
| 113 | stretch noise offset | (7.1, 41.9) | — | terrain.wgsl |
| 114 | stretch base | 2.3 | — | terrain.wgsl |
| 115 | stretch span | 2.4 | — | terrain.wgsl |
| 116 | sastrugi wavelength | 2.3 | m | terrain.wgsl |
| 117 | sastrugi octaves | 3 | — | terrain.wgsl |
| 118 | sastrugi lacunarity | 2.11 | — | terrain.wgsl |
| 119 | sastrugi gain | 0.52 | — | terrain.wgsl |
| 120 | `scour` base | 0.45 | — | terrain.wgsl |
| 121 | `scour` span | 0.55 | — | terrain.wgsl |
| 122 | `scour` smoothstep low | −0.25 | — | terrain.wgsl |
| 123 | `scour` smoothstep high | 0.35 | — | terrain.wgsl |
| 124 | `scour` noise frequency | 0.021 | 1/m (λ≈47.6 m) | terrain.wgsl |
| 125 | sastrugi amplitude | 0.125 | m | terrain.wgsl |
| 126 | sastrugi exposure mix low | 0.45 | — | terrain.wgsl |
| 127 | sastrugi exposure mix high | 1.0 | — | terrain.wgsl |
| 128 | sastrugi DC removal | 0.35 | — | terrain.wgsl |
| 129 | ripple veer factor | 0.5 | × veer | terrain.wgsl |
| 130 | ripple `sx` | 2.9 | — | terrain.wgsl |
| 131 | ripple `sy` | 1.0 | — | terrain.wgsl |
| 132 | ripple wavelength | 0.42 | m | terrain.wgsl |
| 133 | ripple amplitude | 0.024 | m | terrain.wgsl |
| 134 | ripple exposure mix low | 1.0 | — | terrain.wgsl |
| 135 | ripple exposure mix high | 0.45 | — | terrain.wgsl |
| 136 | grain wavelength | 0.115 | m | terrain.wgsl |
| 137 | grain amplitude | 0.0075 | m | terrain.wgsl |
| 138 | sastrugi fade low | 0.35 | m/px | terrain.wgsl |
| 139 | sastrugi fade high | 1.6 | m/px | terrain.wgsl |
| 140 | ripple fade low | 0.06 | m/px | terrain.wgsl |
| 141 | ripple fade high | 0.3 | m/px | terrain.wgsl |
| 142 | grain fade low | 0.016 | m/px | terrain.wgsl |
| 143 | grain fade high | 0.08 | m/px | terrain.wgsl |
| 144 | layer early-out threshold | 0.001 | — | terrain.wgsl |
| 145 | footprint floor | 1e-4 | m | snow.fragment.wgsl |

### 15.8 Aux bake (`auxBake.fragment.wgsl`)

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 146 | gradient stencil offset | ±1 texel (`invHeightRes`) | UV | auxBake |
| 147 | gradient world divisor | `2.0 * texelWorld` = 1.0 | m | auxBake |
| 148 | Laplacian stencil multiplier | 6.0 | texels | auxBake |
| 149 | Laplacian world width | 3.0 (`d * 6`) | m | auxBake |
| 150 | Laplacian centre weight | −4.0 | — | auxBake |
| 151 | exposure bias | 0.5 | — | auxBake |
| 152 | exposure Laplacian scale | 2.2 | m | auxBake |

### 15.9 Vertex-program gates and per-frame uniforms

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 153 | fine displacement gate | 0.42 | m spacing | snow/prepass/depth VS |
| 154 | fine fade low | 0.16 | m spacing | snow/prepass/depth VS |
| 155 | fine fade high | 0.42 | m spacing | snow/prepass/depth VS |
| 156 | deform displacement gate | 1.0 | m spacing | snow/prepass/depth VS |
| 157 | deform fade low | 0.5 | m spacing | snow/prepass/depth VS |
| 158 | deform fade high | 1.0 | m spacing | snow/prepass/depth VS |
| 159 | prepass mask early-out | 0.001 | — | terrainPrepass VS |
| 160 | `heightRes` uniform literal | 4096 | texels | terrain.js |
| 161 | `shadowSoftness` | 1.8 | — | terrain.js |
| 162 | `shadowBias` | 0.022 | m | terrain.js |
| 163 | height-bounds margin below | −4 | m | terrain.js |
| 164 | height-bounds margin above | +6 | m | terrain.js |
| 165 | `DETAIL_RES` | 1024 | texels | terrain.js |
| 166 | `grainScale` | 0.013 | — | terrain.js |
| 167 | `CASCADE_COUNT` | 3 | cascades | shadows.js |
| 168 | shadow `texelSize` | 1/2048 | UV | shadows.js |
| 169 | debug-mode indices | 0…10 | — | terrain.js |

### 15.10 Deformation constants the terrain carries

| # | Identifier | Value | Unit | File |
|---|---|---|---|---|
| 170 | `COVERAGE` (deform window) | 80 | m | deformation.js |
| 171 | deform resolution | 2048 | texels | settings.js |
| 172 | deform texel (derived) | 0.0390625 | m | deformation.js |
| 173 | `deformFalloff` smoothstep low | 0.80 | normalised Chebyshev | deform.wgsl |
| 174 | `deformFalloff` smoothstep high | 0.96 | normalised Chebyshev | deform.wgsl |
| 175 | binomial kernel divisor | 16 | — | deform.wgsl |
| 176 | binomial kernel weights | [1,2,1]⊗[1,2,1] | — | deform.wgsl |

### 15.11 Settings defaults the terrain reads (`core/settings.js`)

| # | Identifier | Value | Unit |
|---|---|---|---|
| 177 | `S.windDirection` | 42 | degrees |
| 178 | `S.macroHeightScale` | 1.0 | multiplier |
| 179 | `S.sastrugiStrength` | 1.0 | multiplier |
| 180 | `S.deformDepth` | 1.0 | multiplier |
| 181 | `S.detailNormalStrength` | 1.0 | multiplier |
| 182 | `S.sunAzimuth` | 118 | degrees |
| 183 | `S.sunElevation` | 13.0 | degrees |
| 184 | `S.windStrength` | 1.0 | multiplier |
| 185 | `macroHeightScale` slider range | 0 … 2, step 0.01 | — |
| 186 | `sastrugiStrength` slider range | 0 … 2, step 0.01 | — |
| 187 | `windDirection` slider range | 0 … 360, step 1 | degrees |

### 15.12 Far-field range (`lib/ridge.wgsl`) — separate subsystem, on the read list

Included for completeness. The range sits from 9 km to 45 km, well beyond the 870 m clipmap, so
nothing here can ever intersect the terrain.

| # | Identifier | Value | Unit |
|---|---|---|---|
| 188 | `ridgeCeiling` factor | 1.05 | × amp |
| 189 | kilometre scale `q` | 0.001 | 1/m |
| 190 | bowl exclusion radius | 7000.0 | m |
| 191 | bowl ramp width | 6000.0 | m |
| 192 | massif frequency | 0.10 | ×q |
| 193 | massif offset | (11.3, 4.7) | — |
| 194 | massif octaves / lac / gain | 2, 2.13, 0.52 | — |
| 195 | envelope bias | +0.34 | — |
| 196 | envelope divisor | 0.70 | — |
| 197 | envelope derivative divisor | 0.62 | — |
| 198 | warp frequency | 0.26 | ×q |
| 199 | warp offsets | (2.7, 8.1), (19.4, 3.6) | — |
| 200 | warp amplitude | 1.35 | — |
| 201 | peaks primary frequency | 0.30 | ×q |
| 202 | peaks primary octaves / lac / gain | 4, 2.09, 0.50 | — |
| 203 | peaks secondary frequency | 1.05 | ×q |
| 204 | peaks secondary offset | (31.0, 17.0) | — |
| 205 | peaks secondary octaves / lac / gain | 3, 2.11, 0.50 | — |
| 206 | primary/secondary mix | 0.78 / 0.22 | — |
| 207 | crest sharpen cubic weight | 0.55 | — |
| 208 | crest sharpen linear weight | 0.45 | — |
| 209 | envelope floor | 0.06 | — |
| 210 | envelope span | 0.94 | — |
| 211 | Earth-curvature divisor | 12,742,000 | m |
| 212 | `D_NEAR` | 5500.0 | m |
| 213 | `D_FAR` | 45000.0 | m |
| 214 | march `STEPS` | 18 | — |
| 215 | crossing epsilon | 1e-5 | — |
| 216 | horizontal-length epsilon | 1e-4 | — |
| 217 | shadow march start | 420.0 | m |
| 218 | shadow march growth | 2.6 | × |
| 219 | shadow march steps | 4 | — |
| 220 | shadow horizontal epsilon | 1e-3 | — |
| 221 | `S.mountainHeight` | 2150 | m |

---

**Total distinct numeric constants captured: 221.**
(Rows 1–187 are the terrain heightfield + clipmap subsystem proper — 187 constants; rows
188–221 are the far-field ridge library, included because `lib/ridge.wgsl` was on the read
list.)
