# SNOWFLOW — Snow Surface Shading: Implementation Spec

**Target port:** Three.js r172 / WebGL2 / hand-written GLSL 3.00 es
**Reference:** WebGPU + Babylon.js + WGSL (`snowflow_demo`)
**Subsystem:** the snow material — multi-scale normal composition, wrapped diffuse,
back-scatter subsurface with depth-dependent blue tint, GGX specular, SH ambient with
solved snow bounce, procedural view-dependent glints, and the compression / wetness /
ice surface-state channels.

Reference files transcribed here in full:
`src/shaders/snow.fragment.wgsl`, `src/shaders/lib/shading.wgsl`,
`src/shaders/detailBake.fragment.wgsl`, `src/shaders/auxBake.fragment.wgsl`,
`src/shaders/prepass.fragment.wgsl`, `src/terrain/terrain.js`.
Supporting files read for constants and contracts: `lib/noise.wgsl`, `lib/terrain.wgsl`,
`lib/deform.wgsl`, `lib/clipmap.wgsl`, `lib/shadowLookup.wgsl`, `lib/spellLights.wgsl`,
`lib/atmosphere.wgsl`, `snow.vertex.wgsl`, `terrainPrepass.vertex.wgsl`,
`terrain/heightfield.js`, `terrain/deformation.js`, `terrain/clipmapMesh.js`,
`render/shadows.js`, `render/sky.js`, `render/depthPass.js`, `core/settings.js`.

---

## 0. One-paragraph summary of what this material is

Snow is treated as a densely-packed scatterer with a mean free path of a few millimetres,
not as a white dielectric. Four independent *heightfield gradients* (baked macro landform,
analytic sastrugi/ripples/grain, carved deformation) are summed **as slopes** and only then
converted to a normal; a tiled tangent-space grain map is folded in last at three world
scales with reoriented normal mapping, triplanar-projected on steep faces. Lighting is
wrapped diffuse plus a back-scatter transmission lobe whose tint runs from near-white to a
strongly blue `(0.55, 0.72, 1.0)` with depth, GGX specular, SH sky irradiance plus a
solved snow-to-snow bounce, sky specular at a roughness-selected mip, and additive
procedural glints gated hard on grazing view angle. Ambient occlusion is applied **last**,
to the *finished radiance* (not just the ambient), and carries the same blue tint with it.

---

## 1. Pass topology and what is baked vs per-frame

### 1.1 Baked once at load (never re-run unless the sun moves)

| Pass | Output | Res | Format | Sampling | Wrap |
|---|---|---|---|---|---|
| `heightBake` | height (R), rock mask (G) | 4096² | R32F **two-channel** (`TEXTUREFORMAT_RG`, `TEXTURETYPE_FLOAT`) | bilinear, **no mips** | clamp |
| `auxBake` | dH/dx (R), dH/dz (G), rockMask (B), exposure (A) | 2048² | RGBA16F (`TEXTURETYPE_HALF_FLOAT`) | bilinear, **no mips** | clamp |
| `detailBake` | normal.x (R), normal.y (G), cavity (B), height (A) | 1024² | RGBA8 (`TEXTURETYPE_UNSIGNED_BYTE`) | **trilinear, mips ON** | **repeat** |
| `skyBake` → `skyLUT` | equirect sky radiance | 512×256 | RGBA16F | trilinear, mips ON | wrap U / clamp V |
| `skyBake` → `skySH` | low-res copy for CPU SH projection | 64×32 | RGBA32F | bilinear, no mips | — |

World field is **2048 m across** (`WORLD_SIZE = 2048`), origin `(-1024, -1024)`, so
height texel = **0.5 m**, aux texel = **1.0 m**, and the height UV convention is
`uv = (worldXZ - origin) / worldSize`.

The sky solve is an **iteration of 3** (`for i in 0..3`: bake → projectSH →
`_updateGroundBounce()`), followed by one final `bake()` + `projectSH()`. Snow albedo used
for the bounce solve is `SNOW_ALBEDO = [0.83, 0.86, 0.91]` and re-emission is Lambertian
`L = albedo * E / PI`.

### 1.2 Per frame, in order

1. **Shadow cascades** (3× 2048² R32F colour targets, cleared to 1.0) — terrain drawn with
   the identical clipmap + deformation vertex program.
2. **Deformation sim** — one full-screen pass, ping-ponged between two RGBA16F 2048²
   targets. `terrain.update()` runs `deform.update()` **before** binding, so the material
   samples the target written *this* frame.
3. **Depth prepass** — full-res RGBA16F, **nearest** sampling, cleared to
   `(DEPTH_FAR=9000, 0, 0, 1)`.
4. **Beauty pass** — the snow material described by the rest of this document.
5. Post chain.

### 1.3 The prepass fragment shader (complete, verbatim)

```wgsl
varying vViewZ: f32;
/// 0 matte snow, 1 mirror ice. Only the reflection pass reads it.
varying vMask: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    fragmentOutputs.color = vec4f(input.vViewZ, input.vMask, 0.0, 1.0);
}
```

`vViewZ` is **clip-space w**, carried as a varying rather than reconstructed
(`vertexOutputs.vViewZ = clip.w;`). `vMask` is the raw ice channel, read *without* the
`deformHeight` binomial filter — deliberately, because it gates a reflection, not a
displacement:

```wgsl
let dWeight = deformFalloff(worldXZ, uniforms.deformCenter, uniforms.deformSize);
if (dWeight > 0.001) {
    let s = textureSampleLevel(
        deformTex, deformTexSampler, deformUV(worldXZ, uniforms.deformSize), 0.0
    );
    mask = clamp(s.a, 0.0, 1.0) * dWeight;
}
```

Channel meaning of the prepass RT: `r` = linear view depth in metres, `g` = specular mask
(0 matte snow → 1 mirror ice), `b`/`a` spare.

---

## 2. Data layouts (channel meanings — memorise these)

### 2.1 `heightTex` (R32F ×2, 4096², clamp, no mips)
- `.r` — macro terrain height in **metres**
- `.g` — rock mask, 0 = snow, 1 = bare rock

### 2.2 `auxTex` (RGBA16F, 2048², clamp, no mips)
- `.r` — `dH/dx`, metres per metre
- `.g` — `dH/dz`, metres per metre
- `.b` — rock mask (copied from `heightTex.g`)
- `.a` — **exposure**: 1 on scoured convex crests, 0 in sheltered concave hollows

### 2.3 `detailTex` (RGBA8, 1024², **repeat**, trilinear + mips)
- `.r`, `.g` — tangent-space normal XY, encoded `x*0.5 + 0.5`
- `.b` — cavity / crevice occlusion (1 = open, < 1 = in a crevice)
- `.a` — height (baked for contact-detail parallax; **not read by the snow material**)

### 2.4 `deformTex` (RGBA16F, 2048² over 80 m, **repeat/toroidal**, bilinear, no mips)
- `.r` — depression depth, metres, positive = pushed down
- `.g` — displaced mass ("berm"), metres, positive = piled up
- `.b` — compression, 0..1
- `.a` — ice, 0..1

Texel size = `80 / 2048` = **0.0390625 m** (3.9 cm). Addressing is toroidal:
`uv = fract(worldXZ / size)`.

### 2.5 `skyLUT` (RGBA16F, 512×256, wrap U / clamp V, trilinear + mips)
Equirectangular. Lookup direction → UV:

```wgsl
fn dirToLatLong(d: vec3f) -> vec2f {
    let u = atan2(d.x, d.z) / (2.0 * PI) + 0.5;
    let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2f(u, v);
}
```

### 2.6 Shadow cascades (R32F, 2048² each, clamp, bilinear, cleared to 1.0)
Store NDC z directly. `cascadeParams[i] = (depthRange metres, orthoWidth metres, 0, 0)`.
`cascadeSplits = (26, 95, 330, 330)` metres.

### 2.7 SH uniform
`shR: array<vec4f, 9>` — 9 coefficients, RGB in `.rgb`, `.a` unused. Uploaded as 36 floats.

### 2.8 Varyings from the snow vertex shader
```wgsl
varying vWorld: vec3f;     // displaced world position
varying vHeightUV: vec2f;  // (worldXZ - origin) / worldSize
varying vViewDist: f32;    // distance(world, cameraPos)
varying vSpacing: f32;     // post-morph clipmap sample spacing, metres
```

---

## 3. The bake shaders

### 3.1 `detailBake.fragment.wgsl` — the tiled snow grain map

Uniforms: `resolution = 1024`, `grainScale = 0.013` (set in `terrain.js`; the comment says
this "tilts a grain dome's flank to roughly 30 degrees — higher reads as gravel, lower
stops registering at all").

**Tileable hash.** Cell indices wrap at `period`, which is what makes the field seamless:

```wgsl
fn hashTile(id: vec2f, period: f32) -> vec2f {
    let w = id - floor(id / period) * period;
    return hash22(w);
}
```

**Packed-grain height field.** Spheres, not noise bumps — and the crevices matter as much
as the grains. Verbatim:

```wgsl
fn grainHeight(p: vec2f, cells: f32, period: f32) -> vec2f {
    let gp = p * cells;
    let gi = floor(gp);

    var h = 0.0;
    var cav = 1.0;

    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let id = gi + vec2f(f32(dx), f32(dy));
            let r = hashTile(id, period);
            let r2 = hashTile(id + vec2f(37.0, 91.0), period);

            let centre = id + 0.25 + r * 0.5;
            let radius = 0.30 + r2.x * 0.26;
            let d = length(gp - centre) / radius;

            if (d < 1.0) {
                // Spherical cap profile — gives a real rounded highlight rather
                // than the soft blob a smoothstep would.
                let dome = sqrt(max(0.0, 1.0 - d * d)) * (0.55 + r2.y * 0.45);
                h = max(h, dome);
                cav = min(cav, 1.0 - (1.0 - d) * 0.5);
            }
        }
    }
    return vec2f(h, cav);
}
```

- centre jitter: `id + 0.25 + r*0.5` → centre lies in `[id+0.25, id+0.75]`
- radius: `0.30 + r2.x*0.26` → `[0.30, 0.56]` cells
- dome amplitude: `0.55 + r2.y*0.45` → `[0.55, 1.00]`
- cavity: `min(cav, 1 - (1-d)*0.5)` → floor of **0.5** at a grain centre
- 3×3 neighbourhood, `h` combined by `max` (union of domes), `cav` by `min`

**Three grain sizes stacked, each tiling on its own period:**

```wgsl
fn detailHeight(uv: vec2f) -> vec2f {
    let a = grainHeight(uv, 26.0, 26.0);
    let b = grainHeight(uv + vec2f(0.37, 0.11), 61.0, 61.0);
    let c = grainHeight(uv + vec2f(0.71, 0.53), 137.0, 137.0);

    let h   = a.x * 1.0  + b.x * 0.42 + c.x * 0.17;
    let cav = a.y * 0.55 + b.y * 0.30 + c.y * 0.15;
    return vec2f(h, cav);
}
```

Note the cavity weights sum to exactly 1.0 (0.55 + 0.30 + 0.15).

**Fragment body — normal derivation.** The division by the sample spacing is the part that
is easy to get wrong (comment in source: without it the "slope" is a per-texel *difference*
which at 1024 px comes out around 25, and every normal ends up lying almost flat in the
tangent plane):

```wgsl
let e = 1.0 / uniforms.resolution;         // 1/1024
let c  = detailHeight(uv);
let hL = detailHeight(uv - vec2f(e, 0.0)).x;
let hR = detailHeight(uv + vec2f(e, 0.0)).x;
let hD = detailHeight(uv - vec2f(0.0, e)).x;
let hU = detailHeight(uv + vec2f(0.0, e)).x;

let dx = (hR - hL) / (2.0 * e);
let dz = (hU - hD) / (2.0 * e);
let n = normalize(vec3f(-dx * uniforms.grainScale, -dz * uniforms.grainScale, 1.0));

fragmentOutputs.color = vec4f(n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, c.y, c.x);
```

Cost note for the port: this evaluates `detailHeight` **5×** per texel, each of which is
3 `grainHeight` calls of 9 cells → 135 cell evaluations per texel × 1024² texels. Bake it
once at load, behind a loading screen. It is a fragment pass writing to an RGBA8 target;
nothing about it requires compute.

### 3.2 `auxBake.fragment.wgsl` — macro slope, rock mask, exposure

The critical design point: it **differentiates the baked height texture**, not the analytic
function, so the normals describe the exact surface the vertex shader displaces to.

Uniforms: `texelWorld = 2048/4096 = 0.5` (world metres per height texel),
`invHeightRes = 1/4096`.

Complete body:

```wgsl
let uv = input.vUV;
let t = uniforms.invHeightRes;   // 1/4096
let d = uniforms.texelWorld;     // 0.5 m

let hL = textureSample(heightTex, heightTexSampler, uv - vec2f(t, 0.0));
let hR = textureSample(heightTex, heightTexSampler, uv + vec2f(t, 0.0));
let hD = textureSample(heightTex, heightTexSampler, uv - vec2f(0.0, t));
let hU = textureSample(heightTex, heightTexSampler, uv + vec2f(0.0, t));
let hC = textureSample(heightTex, heightTexSampler, uv);

let dHdx = (hR.x - hL.x) / (2.0 * d);
let dHdz = (hU.x - hD.x) / (2.0 * d);

// --- exposure ---
let w  = t * 6.0;     // 6/4096 in UV
let wd = d * 6.0;     // 3.0 m
let lL = textureSample(heightTex, heightTexSampler, uv - vec2f(w, 0.0)).x;
let lR = textureSample(heightTex, heightTexSampler, uv + vec2f(w, 0.0)).x;
let lD = textureSample(heightTex, heightTexSampler, uv - vec2f(0.0, w)).x;
let lU = textureSample(heightTex, heightTexSampler, uv + vec2f(0.0, w)).x;
let lap = (lL + lR + lD + lU - 4.0 * hC.x) / (wd * wd);

let exposure = clamp(0.5 - lap * 2.2, 0.0, 1.0);

fragmentOutputs.color = vec4f(dHdx, dHdz, hC.y, exposure);
```

The `2.2` is set against the actual curvature of the dune field: 15 m of relief at a ~58 m
wavelength gives a second derivative around 0.18 m⁻¹, so the scale has to be near 1/0.18 to
produce a *usable gradient*. Larger saturates the mask to hard 0/1 and the sastrugi
cross-fade it drives stops being a cross-fade at all.

**Note the aux pass runs at 2048² while stepping by one 4096-texel** — i.e. the derivative
stencil is half an aux texel wide. Preserve that; do not "fix" it to a full aux texel.

---

## 4. The snow fragment shader — full control flow

Order is load-bearing. Everything below is per-fragment unless stated.

```
 1.  V, L, world, viewDist
 2.  ddxW / ddyW, footprint, footprintMin      (taken in UNIFORM control flow)
 3.  aux fetch → grad (macro slope), rockMask, exposure
 4.  + analytic fine gradient (sastrugi/ripples/grain, footprint-filtered)
 5.  + deformation gradient (central difference, widening baseline)
 6.  N = normalFromGradient(grad);  geoN = N   ← geoN frozen here, before detail
 7.  steep = smoothstep(0.55, 0.9, 1.0 - N.y)
 8.  three tiled detail normal scales, RNM-accumulated, lifted onto N
 9.  cavity fetch
10.  material state: albedo / roughness / f0 / thickness
       ← compression → ice → rock → berm(loose), in that order
11.  ao (analytic only)
12.  NdotL, NdotV, per-pixel IGN rotation, shadow
13.  wrapped diffuse
14.  subsurface (partly un-shadowed)
15.  GGX direct specular (gated NdotL > 0)
16.  SH ambient + snow bounce + sky specular
17.  spell lights (gated on count)
18.  glints (additive radiance, gated on intensity and rockExposed < 0.5)
19.  color *= ao * caveTint            ← LAST, on the finished radiance
20.  aerial perspective
21.  debug overrides
```

### 4.1 Footprint: two different numbers, both needed

```wgsl
let ddxW = dpdx(world);
let ddyW = dpdy(world);
let footprint = max(length(vec2f(length(ddxW.xz), length(ddyW.xz))), 1e-4);
let footprintMin = max(min(length(ddxW.xz), length(ddyW.xz)), 1e-4);
```

- `footprint` — the **average/diagonal** axis. Drives every *natural* detail fade (fine
  layers, three detail scales, glint octaves, cavity AO).
- `footprintMin` — the **narrow** axis of the anisotropic pixel footprint. Drives the
  *carved snow* filtering only.

The reason, verbatim from the source comment, is essential to reproduce the behaviour:

> At grazing incidence a pixel's world footprint is a long thin sliver: one axis blows up
> while the other stays small. `footprint` above averages the two, so simply tilting the
> camera down towards the horizon inflates it by an order of magnitude — and anything keyed
> off it fades out, even though the surface is no further away and is still perfectly
> resolvable across the sliver's short axis. For the natural detail layers that trade is
> fine and deliberate. For carved snow it is not: it means the trail changes shape when you
> move the camera and not the player, which reads as a bug because it is one.

Both are taken **once, in uniform control flow**, and threaded down into functions that sit
behind footprint tests (WGSL, like GLSL, forbids implicit-derivative sampling under
non-uniform control flow).

### 4.2 Slope accumulation (macro + fine + deform), *before* any normal

```wgsl
let aux = textureSampleLevel(auxTex, auxTexSampler, input.vHeightUV, 0.0);
var grad = aux.xy;
let rockMask = aux.z;
let exposure = aux.w;

let fine = terrainFineFiltered(
    world.xz, uniforms.windAngle, exposure, uniforms.sastrugiAmp, footprint
);
grad += fine.yz;
```

`terrainFineFiltered` returns `vec3f(height, dH/dx, dH/dz)`. Only `.yz` is used here (the
height is applied in the vertex shader). Its full content, needed for the port:

| Layer | Wavelength | Wind matrix `windMat(angle, sx, sy, scale)` | Amplitude | Footprint fade `1 - smoothstep(a,b,fp)` |
|---|---|---|---|---|
| sastrugi | 2.3 m | `windMat(w + wl.x, 1.0, wl.y, 2.3)`, `ridgedd(·, 3, 2.11, 0.52)` | `0.125 * amp * mix(0.45,1.0,exposure) * scour`, height offset `(sas.x - 0.35)` | `0.35 → 1.6` |
| ripples | 0.42 m | `windMat(w + wl.x*0.5, 2.9, 1.0, 0.42)`, `noised()` | `0.024 * amp * mix(1.0,0.45,exposure)` | `0.06 → 0.3` |
| grain | 0.115 m | `windMat(w, 1.0, 1.0, 0.115)`, `noised()` | `0.0075 * amp` | `0.016 → 0.08` |

with

```wgsl
let scour = 0.45 + 0.55 * smoothstep(-0.25, 0.35, noise2(p * 0.021));

fn windLocal(p: vec2f) -> vec2f {
    let veer    = noise2(p * 0.0083 + vec2f(31.7, 12.3)) * 0.42;
    let stretch = 2.3 + 2.4 * (noise2(p * 0.0126 + vec2f(7.1, 41.9)) * 0.5 + 0.5);
    return vec2f(veer, stretch);   // .x = veer radians, .y = across-wind stretch
}

fn windMat(angle: f32, sx: f32, sy: f32, scale: f32) -> mat2x2f {
    let c = cos(angle);  let s = sin(angle);
    let r = mat2x2f(c, -s, s, c);
    let d = mat2x2f(sx / scale, 0.0, 0.0, sy / scale);
    return d * r;                  // note: scale-then-rotate composition order
}
```

A layer's derivative maps back to world space by **right-multiplying by the matrix**:
`d += (layer.yz * M) * amplitude`. In GLSL that is `d += (M_transposed * layer.yz) * amp`
or equivalently `d += vec2(dot(layer.yz, M[0]), dot(layer.yz, M[1]))` — see §11.4.

Ripples are veered by **half** what the sastrugi is (`wl.x * 0.5`): "ripples form in the
boundary layer and follow the local flow more closely… giving them the same veer makes the
two layers move together and the field goes back to reading as one woven sheet."

### 4.3 Deformation gradient — the widening baseline

```wgsl
var compression = 0.0;
var iceAmount   = 0.0;
var deformDepth = 0.0;
var deformBerm  = 0.0;

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

Key points a port must not simplify away:

- The differenced quantity is `(berm - depression)` = `.g - .r`, i.e. **net surface height**.
- The central-difference **step widens with the pixel**, `max(texel*2, footprintMin*1.4)`,
  rather than being fixed at 2 texels behind a distance fade. "The difference stays bounded
  while the divisor grows, so the gradient rolls off smoothly with distance instead of
  being switched off, and the trail survives as a tonal line long after it has stopped
  being a shape."
- The four neighbours are already fetched, so they are re-used to blend the *state
  channels* once the pixel is wider than a texel (`wide`, capped at **0.8** weight,
  neighbour mean = `(c + 4 neighbours) * 0.2`). This "stops a distant trail breaking into
  a dotted line".
- All four state channels are multiplied by `dWeight`.

Falloff and UV:

```wgsl
fn deformUV(worldXZ: vec2f, size: f32) -> vec2f {
    return fract(worldXZ / size);
}

fn deformFalloff(worldXZ: vec2f, centre: vec2f, size: f32) -> f32 {
    let d = abs(worldXZ - centre) / (size * 0.5);
    return 1.0 - smoothstep(0.80, 0.96, max(d.x, d.y));
}
```

The fade (0.80 → 0.96 of the half-window) **completes before the toroidal seam**, so
wrapped-around content is never visible at any weight.

### 4.4 Normal from gradient, and freezing `geoN`

```wgsl
fn normalFromGradient(d: vec2f) -> vec3f {
    return normalize(vec3f(-d.x, 1.0, -d.y));
}

var N = normalFromGradient(grad);
let geoN = N;
```

`geoN` is the surface the **depth pass rendered**: macro landform + analytic fine layer +
carved snow, and *nothing finer*. It is the only normal fed to the shadow lookup. Biasing
the shadow lookup against the detail-perturbed normal "would describe a surface orders of
magnitude higher in frequency than the one in the depth map — the offset would point off in
a different direction on every pixel and reintroduce the noise it exists to remove."

---

## 5. Multi-scale detail normals (the tiled grain layers)

```wgsl
let steep = smoothstep(0.55, 0.9, 1.0 - N.y);
if (uniforms.detailStrength > 0.001) {
    var acc = vec3f(0.0, 0.0, 1.0);

    let f0 = 1.0 - smoothstep(0.004, 0.02, footprint);
    if (f0 > 0.001) {
        let d = detailNormal(world, N, 7.5, steep, ddxW, ddyW);
        acc = blendNormalRNM(acc, mix(vec3f(0.0, 0.0, 1.0), d, f0));
    }
    let f1 = 1.0 - smoothstep(0.02, 0.12, footprint);
    if (f1 > 0.001) {
        let d = detailNormal(world, N, 1.7, steep, ddxW, ddyW);
        acc = blendNormalRNM(acc, mix(vec3f(0.0, 0.0, 1.0), d, f1 * 0.85));
    }
    let f2 = 1.0 - smoothstep(0.1, 0.7, footprint);
    if (f2 > 0.001) {
        let d = detailNormal(world, N, 0.31, steep, ddxW, ddyW);
        acc = blendNormalRNM(acc, mix(vec3f(0.0, 0.0, 1.0), d, f2 * 0.6));
    }

    // Lift the tangent-space result onto the geometric normal.
    let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(N.y) > 0.99);
    let T = normalize(cross(up, N));
    let B = cross(N, T);
    let s = uniforms.detailStrength * mix(1.0, 0.45, compression);
    N = normalize(N + (T * acc.x + B * acc.y) * s);
}
```

### 5.1 Scale table

| Layer | UV scale (× world metres) | Tile period in world | Footprint fade | Max weight |
|---|---|---|---|---|
| finest | **7.5** | 1/7.5 ≈ **13.3 cm** per tile | `1 - smoothstep(0.004, 0.02, footprint)` (4 mm → 2 cm) | **1.00** |
| middle | **1.7** | 1/1.7 ≈ **58.8 cm** per tile | `1 - smoothstep(0.02, 0.12, footprint)` (2 cm → 12 cm) | **0.85** |
| coarse | **0.31** | 1/0.31 ≈ **3.23 m** per tile | `1 - smoothstep(0.1, 0.7, footprint)` (10 cm → 70 cm) | **0.60** |

The fades **cross-fade** (each layer's out-edge overlaps the next layer's in-edge), so no
scale ever pops in. Each layer is faded by `mix(flat, d, weight)` *before* the RNM blend,
not after — fading the blended result would tilt the accumulated normal instead of
attenuating the contribution.

### 5.2 Reoriented normal mapping and the tangent lift

```wgsl
fn blendNormalRNM(base: vec3f, detail: vec3f) -> vec3f {
    let t = base + vec3f(0.0, 0.0, 1.0);
    let u = detail * vec3f(-1.0, -1.0, 1.0);
    return normalize(t * dot(t, u) - u * t.z);
}
```

Accumulator starts flat `(0,0,1)`; each layer is blended into it as `acc = RNM(acc, layer)`.
The final `acc` is a tangent-space normal, lifted onto the world normal via an arbitrary but
stable frame: `up = (0,1,0)` unless `|N.y| > 0.99` in which case `(1,0,0)`;
`T = normalize(cross(up, N))`, `B = cross(N, T)`.

**Detail strength is halved on compressed snow**: `s = detailStrength * mix(1.0, 0.45, compression)`.

### 5.3 Triplanar on steep faces

```wgsl
fn detailNormal(
    world: vec3f, N: vec3f, scale: f32, blendSteep: f32,
    ddxW: vec3f, ddyW: vec3f
) -> vec3f {
    var n = unpackN(textureSampleGrad(
        detailTex, detailTexSampler, world.xz * scale,
        ddxW.xz * scale, ddyW.xz * scale
    ).xy);

    if (blendSteep > 0.01) {
        let a = unpackN(textureSampleGrad(
            detailTex, detailTexSampler, world.xy * scale,
            ddxW.xy * scale, ddyW.xy * scale
        ).xy);
        let b = unpackN(textureSampleGrad(
            detailTex, detailTexSampler, world.zy * scale,
            ddxW.zy * scale, ddyW.zy * scale
        ).xy);
        let w = abs(N);
        let sum = w.x + w.y + w.z;
        n = normalize(mix(n, (a * w.z + b * w.x + n * w.y) / sum, blendSteep));
    }
    return n;
}

fn unpackN(rg: vec2f) -> vec3f {
    let xy = rg * 2.0 - 1.0;
    return vec3f(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}
```

- The **XZ** (top-down) projection is always taken. The XY and ZY projections are taken
  only when `blendSteep > 0.01`.
- Triplanar weights are raw `abs(N)` normalised by their sum — **no power sharpening**.
- Note the axis pairing: `world.xy` plane gets weight `w.z`, `world.zy` gets `w.x`,
  `world.xz` gets `w.y`. That is correct (the weight is the axis the plane faces).
- `blendSteep = steep = smoothstep(0.55, 0.9, 1.0 - N.y)`, i.e. triplanar begins where the
  surface is tilted ~63° from horizontal and is fully triplanar at ~84°.
- **Gradients are passed in, not taken inside**, because every call site is behind a
  footprint branch. Explicit gradients keep full mip filtering, "which this absolutely
  needs, since the whole point of the fade-in is anti-aliasing."

### 5.4 Cavity fetch

```wgsl
let cavity = textureSampleGrad(
    detailTex, detailTexSampler, world.xz * 1.7,
    ddxW.xz * 1.7, ddyW.xz * 1.7
).z;
```

Same world scale as the **middle** detail layer (1.7), channel **B**, unconditionally
sampled (uniform control flow).

---

## 6. Material state: albedo, roughness, F0, thickness

The base:

```wgsl
var albedo = vec3f(0.855, 0.885, 0.945);
var roughness = 0.62;
var f0 = vec3f(0.028);
var thickness = 1.0; // 1 = deep drift, 0 = thin crust
```

> Snow albedo sits in a narrow, high, slightly blue band. It is never 1.0: pushing albedo
> to white is what produces the blown-out clipped highlights that read as "untextured white
> blob" rather than as snow.

Base albedo B/R ratio = 0.945 / 0.855 = **1.105**. Remember that number; the loose-snow
constant below is deliberately tuned against it.

### 6.1 Compression (deformTex `.b`)

```wgsl
albedo    = mix(albedo, vec3f(0.62, 0.665, 0.755), compression * 0.85);
roughness = mix(roughness, 0.34, compression);
thickness = mix(thickness, 0.35, compression);
```

Denser, darker, tighter specular, scatters less. Note the albedo mix is scaled by **0.85**
(so full compression only reaches 85% of the way to the packed colour) while roughness and
thickness use the raw compression.

Compression also: halves detail normal strength (`mix(1.0, 0.45, compression)`, §5.2) and
collapses the diffuse wrap (§7.1).

### 6.2 Ice (deformTex `.a`)

```wgsl
albedo    = mix(albedo, vec3f(0.42, 0.56, 0.70), iceAmount * 0.8);
roughness = mix(roughness, 0.07, iceAmount);
f0        = mix(f0, vec3f(0.045), iceAmount);
thickness = mix(thickness, 0.15, iceAmount);
```

Ice additionally boosts the ambient sky specular by `mix(1.0, 2.6, iceAmount)` (§7.4) and
*reduces* glints by `(1.0 - iceAmount * 0.6)` (§8).

### 6.3 Exposed rock (auxTex `.b`, slope-gated)

```wgsl
let rockExposed = rockMask * smoothstep(0.32, 0.66, 1.0 - N.y);
if (rockExposed > 0.001) {
    let rn = noise2(world.xz * 2.3) * 0.5 + 0.5;
    let rockCol = mix(vec3f(0.055, 0.058, 0.068), vec3f(0.115, 0.112, 0.118), rn);
    albedo    = mix(albedo, rockCol, rockExposed);
    roughness = mix(roughness, 0.85, rockExposed);
    thickness = mix(thickness, 0.0, rockExposed);
}
```

"Snow keeps its grip on the flatter faces, so the mask is gated by slope rather than
applied flat." Rock is *very* dark (luminance ≈ 0.058–0.113) and near-neutral. `rockExposed`
also gates: subsurface strength (`sssStrength * (1 - rockExposed)`, §7.2), the wrap amount
(§7.1) and glints entirely (`rockExposed < 0.5`, §8).

**`rockExposed` is computed with the post-detail `N`**, unlike `steep` which uses the
pre-detail `N`. Preserve that ordering.

### 6.4 Freshly displaced mass — the "loose berm" state (deformTex `.g`)

This block is the single most-commented piece of colour tuning in the file and it must be
transcribed exactly, including the reasoning, because getting it wrong is what makes carved
snow read as bare ground:

```wgsl
if (deformBerm > 0.002) {
    let loose = clamp(deformBerm * 5.0, 0.0, 1.0);
    albedo    = mix(albedo, vec3f(0.895, 0.920, 0.965), loose * 0.55);
    roughness = mix(roughness, 0.78, loose * 0.7);
    thickness = mix(thickness, 1.0, loose * 0.6);
    // Broken snow has crystal faces pointing everywhere, which is where the
    // chunky granular read at a trail edge actually comes from.
    let chunk = noise2(world.xz * 34.0) * 0.5 + 0.5;
    albedo *= 1.0 - loose * 0.10 * chunk;
}
```

The two design rules stated in the source, in full:

> Both numbers here must not make carved snow *less blue*, which is the one axis this
> material cannot afford to lose. Drain the cool cast out of a heavily worked patch and it
> reads as bare ground even while its luminance goes up — a warm-grey patch surrounded by
> blue-white snow is not snow.
>
> 1. The loose colour was a *whiter* white — B/R 1.078 against snow's 1.105 — so
>    brightening toward it desaturated. It is now brighter than snow in every channel and
>    very slightly bluer, which is also the truer answer: freshly broken snow has more
>    surface per unit volume and scatters more, and snow's scattering is what its blue
>    comes from.
> 2. Roughness at 0.78 cut the ambient sky specular, through both the roughness-dependent
>    Fresnel and a blurrier mip. That term is one of the bluest things in the frame, and a
>    berm loses it exactly where the eye is comparing it against snow that still has it.
>    Loose snow is still rougher than packed — it should be — just not by enough to strip
>    the sky out of it.

**Discrepancy in the reference, reported as found.** The comment states the *rejected* loose
colour had a B/R ratio of 1.078 against snow's 1.105. The shipped constant is
`vec3f(0.895, 0.920, 0.965)`, whose B/R is 0.965/0.895 = **1.0782** — numerically the same
ratio the comment says was replaced. Base snow's ratio is 0.945/0.855 = **1.1053**. So by
the ratio test the shipped loose colour is *less* blue than base snow, while the comment
claims the shipped value is "very slightly bluer".

What is unambiguously true of the shipped constant, and is what the visual read depends on:
it is **brighter than base snow in all three channels** (+0.040 R, +0.035 G, +0.020 B), and
the mix only reaches 55% of the way there, so a full berm lands at approximately
`(0.877, 0.904, 0.956)` before the `chunk` darkening.

**Port the literal vector `(0.895, 0.920, 0.965)`.** Do not attempt to re-derive it from the
ratio prose, and do not "correct" it to raise B/R — the reference image was tuned with this
number. The binding constraint is the observable criterion in §13.4: a berm must read
brighter than surrounding snow and must not read warmer or greyer than it. If your port's
tonemapper makes the berm read warm, the fix is the sky-specular term (roughness 0.78 must
still admit a visible blue sheen), not this albedo.

Berm state summary: `loose` saturates at `deformBerm = 0.2 m`. Albedo mix reaches 55% of
the way to loose-white, roughness reaches 70% of the way to 0.78, thickness reaches 60% of
the way back to 1.0 (so a berm re-gains subsurface even if it sits inside a compressed
trench). The `chunk` term darkens by at most **10%**, at a 34 m⁻¹ noise scale (≈ 3 cm
features).

### 6.5 Analytic ambient occlusion

```wgsl
var ao = mix(1.0, cavity, 0.35 * (1.0 - smoothstep(0.02, 0.25, footprint)))
       * (1.0 - clamp(deformDepth * 1.9, 0.0, 1.0) * 0.38);
```

- Cavity contributes at most **35%**, and only when the pixel footprint is under 2 cm,
  fading out entirely by 25 cm.
- Carved depression darkens by up to **38%**, saturating at `deformDepth ≈ 0.526 m`.

Deliberately **analytic only — no SSAO**. The reasoning, verbatim:

> A snow field is the worst possible content for a screen-space occlusion pass: an open,
> smooth, high-albedo surface viewed at grazing angles, so the estimator has almost no real
> occluders to find and what it returns is dominated by its own view-dependent bias — a
> broad, soft darkening keyed to distance from the camera, which slides across the ground
> when the camera moves and nothing else does.

---

## 7. Lighting

```wgsl
let NdotL = dot(N, L);                          // NOT clamped
let NdotV = clamp(dot(N, V), 1e-4, 1.0);
let pix = input.position.xy;                    // fragment coords
let noiseRot = ign(pix) * 6.28318530718;

var shadow = 1.0;
if (NdotL > -0.35) { shadow = sunShadow(world, geoN, viewDist, noiseRot); }

let sunRadiance = uniforms.sunRadiance;
const INV_PI: f32 = 0.31830988618;
```

The shadow lookup is **skipped entirely** below `NdotL = -0.35` (well past the geometric
terminator, because the wrapped diffuse still delivers light there).

Interleaved gradient noise, for the shadow filter rotation — "exactly the noise TAA is
built to resolve":

```wgsl
fn ign(pix: vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(pix, vec2f(0.06711056, 0.00583715))));
}
```

### 7.1 Wrapped diffuse

```wgsl
fn wrapDiffuse(NdotL: f32, w: f32) -> f32 {
    let denom = (1.0 + w) * (1.0 + w);
    return max(0.0, (NdotL + w) / denom);
}

let wrapAmount = mix(0.62, 0.15, max(compression, rockExposed));
let diff = wrapDiffuse(NdotL, wrapAmount);
var direct = albedo * INV_PI * sunRadiance * diff * shadow;
```

- Fresh snow: **w = 0.62**. The terminator is pushed to `NdotL = -0.62`, i.e. ~128° from
  the light.
- Compressed snow or exposed rock: **w = 0.15**, via `max()` of the two masks (a compressed
  *and* rocky pixel is not double-counted).
- The `(1+w)²` denominator is normalisation, so a wrap does not brighten the surface
  overall; it redistributes.

> Snow's mean free path is millimetres, so light wraps well past the geometric terminator.
> This is why snow shadow edges are soft even where the shadow map is pin sharp.

### 7.2 THE SUBSURFACE TERM — the signature look

This is the single most important block in the entire subsystem. Transcribed verbatim from
`lib/shading.wgsl`:

```wgsl
/// Back-scatter transmission — light that entered the surface, scattered, and
/// left toward the eye. Peaks looking into the light through a thin edge, which
/// is what lights up drift lips and the far walls of footprints.
///
/// `L` points from the surface *toward* the sun, which fixes the sign of the
/// transmission vector: it is `L + N*distortion`, and the lobe is measured
/// against its negation — the direction the scattered light continues in after
/// passing through. Building it from `-L` instead inverts the whole term, so it
/// peaks with the sun behind the camera and switches off looking into it, which
/// is the exact opposite of what translucency does. That reads as snow going
/// flat and dead in the one direction where it should be at its most alive.
fn backScatter(N: vec3f, L: vec3f, V: vec3f, distortion: f32, power: f32, thickness: f32) -> f32 {
    let H = normalize(L + N * distortion);
    let vh = pow(clamp(dot(V, -H), 0.0, 1.0), power);
    return vh * thickness;
}

/// Combined snow subsurface response for one light.
/// Returns the RGB radiance contribution to add to the diffuse lobe.
fn snowSubsurface(
    N: vec3f,
    L: vec3f,
    V: vec3f,
    lightColor: vec3f,
    thickness: f32,   // 0 = thin edge, 1 = deep drift
    strength: f32,
    radius: f32
) -> vec3f {
    // Deeper snow scatters longer and comes back bluer, because red is absorbed
    // first over any appreciable path length. This is the entire reason snow
    // shadows are blue rather than merely dark.
    let shallowTint = vec3f(0.94, 0.965, 1.0);
    let deepTint = vec3f(0.55, 0.72, 1.0);
    let tint = mix(shallowTint, deepTint, clamp(thickness * radius, 0.0, 1.0));

    let back = backScatter(
        N, L, V, 0.28 * radius,
        mix(3.0, 9.0, thickness),
        mix(1.0, 0.30, thickness)
    );

    return lightColor * tint * back * strength;
}
```

#### The tint curve — exact

| Symbol | Value | Meaning |
|---|---|---|
| `shallowTint` | **(0.94, 0.965, 1.0)** | thin edge — nearly white, faintly cool |
| `deepTint` | **(0.55, 0.72, 1.0)** | deep drift — strongly blue; R is cut to 55%, G to 72%, B untouched |
| tint parameter | `clamp(thickness * radius, 0, 1)` | `radius` = `sssRadius` uniform, default **1.0** |

So at default settings the tint parameter **is** `thickness`. The material's `thickness`
ladder therefore *is* the blue ladder:

| Surface state | thickness | resulting tint (R,G,B) |
|---|---|---|
| fresh deep snow | 1.00 | (0.550, 0.720, 1.000) — full blue |
| loose berm (from base) | 1.00 | (0.550, 0.720, 1.000) |
| compressed snow (full) | 0.35 | (0.803, 0.879, 1.000) |
| ice (full) | 0.15 | (0.882, 0.928, 1.000) |
| exposed rock (full) | 0.00 | (0.940, 0.965, 1.000) — *and* strength is zeroed anyway |

#### The two inverted parameters — do not "fix" these

The lobe width and amplitude both key off thickness and **both run the opposite way to how
they read at first glance**. Verbatim:

> a *thin* edge — a drift lip, a berm crest, the far wall of a footprint — transmits
> brightly and over a wide range of angles, because the path through it is short from
> almost anywhere. Deep snow transmits little, and only close to straight-through, because
> anything else is a longer path than the light survives. Having deep snow carry the
> broader lobe lights the whole open field evenly and reads as haze rather than as
> translucency.

| Parameter | Thin (thickness = 0) | Deep (thickness = 1) |
|---|---|---|
| `power` (lobe **sharpness**) | `mix(3.0, 9.0, thickness)` → **3.0** (wide) | **9.0** (tight) |
| `thickness` arg (lobe **amplitude**) | `mix(1.0, 0.30, thickness)` → **1.0** (bright) | **0.30** (dim) |
| `distortion` | `0.28 * radius` — **0.28** at default, independent of thickness | same |

So a deep drift gets the **blue** tint but a *tight, dim* lobe; a thin edge gets a
**near-white** tint but a *wide, bright* lobe. The blue you see in a trench is therefore
mostly from the `caveTint` (§9) and the SH ambient (§7.4), while the *glow through a berm
crest* is the wide near-white lobe. Both must be present.

#### Application in the snow material

```wgsl
let sss = snowSubsurface(
    N, L, V, sunRadiance, thickness,
    uniforms.sssStrength * (1.0 - rockExposed), uniforms.sssRadius
);
// Only partly shadowed: scattered light arrives through the snow, so a
// shadowed drift lip still glows. Killing this with the shadow term is what
// makes shadowed snow go flat and grey.
direct += sss * albedo * mix(0.42, 1.0, shadow);
```

**The subsurface term keeps 42% of its value in full shadow.** This is not optional — it is
called out in the source as the thing that stops shadowed snow going "flat and grey". Note
also that the SSS result is multiplied by `albedo` (so it inherits compression/ice/rock/berm
colour) *in addition to* the tint.

The file header states plainly: *"The subsurface term below is doing most of the work of
making this read as snow at all. If you disable exactly one thing in this file to see what
it was worth, disable that."*

### 7.3 Direct specular — GGX

```wgsl
if (NdotL > 0.0) {
    let H = normalize(V + L);
    let NdotH = clamp(dot(N, H), 0.0, 1.0);
    let VdotH = clamp(dot(V, H), 0.0, 1.0);
    let D = distributionGGX(NdotH, roughness);
    let Vis = visSmithGGXCorrelated(NdotV, NdotL, roughness);
    let F = fresnelSchlick(VdotH, f0);
    direct += sunRadiance * D * Vis * F * NdotL * shadow;
}
```

```wgsl
fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(1e-7, PI * d * d);
}

fn visSmithGGXCorrelated(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
    let gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
    return 0.5 / max(1e-7, gv + gl);
}

fn fresnelSchlick(u: f32, f0: vec3f) -> vec3f {
    let f = pow(1.0 - u, 5.0);
    return f0 + (vec3f(1.0) - f0) * f;
}
```

Note the **α = roughness²** convention (perceptual roughness), and `a2 = a*a = roughness⁴`
inside `D`. The visibility term is the height-correlated Smith formulation and already
includes the `1/(4 NdotL NdotV)` factor, so the specular is `D * Vis * F * NdotL` with **no
further division by 4**.

`PI = 3.14159265359` (from `lib/noise.wgsl`).

### 7.4 Ambient: SH irradiance + solved snow bounce + sky specular

```wgsl
var irradiance = shIrradiance(N, uniforms.shR) * uniforms.ambientIntensity;

// Snow bounces onto itself: a huge, bright, near-white surround. Without a
// bounce term the troughs go far too dark for a material with 0.85 albedo.
let bounceUp = clamp(-N.y * 0.5 + 0.5, 0.0, 1.0);
irradiance += shIrradiance(vec3f(0.0, 1.0, 0.0), uniforms.shR)
            * uniforms.ambientIntensity * 0.28 * bounceUp * albedo;

var ambient = albedo * INV_PI * irradiance;

// Ambient specular from the sky, at a roughness-selected mip.
let R = reflect(-V, N);
let mip = sqrt(roughness) * 6.0;
let skyRefl = textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(R), mip).rgb;
let Fr = fresnelSchlickRough(NdotV, f0, roughness);
ambient += skyRefl * Fr * uniforms.ambientIntensity * mix(1.0, 2.6, iceAmount);

var color = direct + ambient;
```

**SH irradiance (Ramamoorthi & Hanrahan), verbatim:**

```wgsl
fn shIrradiance(n: vec3f, sh: array<vec4f, 9>) -> vec3f {
    let c1 = 0.429043;
    let c2 = 0.511664;
    let c3 = 0.743125;
    let c4 = 0.886227;
    let c5 = 0.247708;

    return
        sh[0].rgb * c4
        + sh[1].rgb * 2.0 * c2 * n.y
        + sh[2].rgb * 2.0 * c2 * n.z
        + sh[3].rgb * 2.0 * c2 * n.x
        + sh[4].rgb * 2.0 * c1 * n.x * n.y
        + sh[5].rgb * 2.0 * c1 * n.y * n.z
        + sh[6].rgb * (c3 * n.z * n.z - c5)
        + sh[7].rgb * 2.0 * c1 * n.x * n.z
        + sh[8].rgb * c1 * (n.x * n.x - n.y * n.y);
}
```

Coefficient ordering — **this must match the CPU projection exactly** (from `sky.js`):

| index | real SH basis used on CPU |
|---|---|
| 0 | `0.282095` |
| 1 | `0.488603 * dy` |
| 2 | `0.488603 * dz` |
| 3 | `0.488603 * dx` |
| 4 | `1.092548 * dx * dy` |
| 5 | `1.092548 * dy * dz` |
| 6 | `0.315392 * (3*dz*dz - 1)` |
| 7 | `1.092548 * dx * dz` |
| 8 | `0.546274 * (dx*dx - dy*dy)` |

Note the unusual axis assignment: **index 6 (the "z²" band) uses `dz`, not `dy`**, and the
shader's `shIrradiance` matches (`c3 * n.z * n.z - c5`). This is a self-consistent
Y-up-with-Z-as-the-SH-"z" convention. Port it as-is; swapping to a textbook ordering will
tilt the whole ambient gradient.

CPU projection: equirect 64×32, `dOmega = (2π/64) * (π/32)`, per-texel weight
`w = sin(theta) * dOmega`, `theta = (y+0.5)/32 * π`, `phi = ((x+0.5)/64 - 0.5) * 2π`,
`dx = sinθ·sinφ`, `dy = cosθ`, `dz = sinθ·cosφ`.

**The snow bounce term:**
- `bounceUp = clamp(-N.y * 0.5 + 0.5, 0, 1)` → 0 for an up-facing normal, 0.5 for a
  vertical face, 1 for a down-facing normal. i.e. *the more a surface faces down, the more
  bounce it receives.*
- Weight **0.28**, multiplied by the **up-normal SH irradiance** (a constant per frame) and
  by `albedo` (the bounce is tinted by the receiving surface's own colour — a
  crude-but-effective colour-bleed).

**Sky specular mip selection:** `mip = sqrt(roughness) * 6.0`. On a 512×256 LUT with mips,
mip 6 is 8×4. Fresh snow (r=0.62) → mip 4.72; ice (r=0.07) → mip 1.59; loose berm (r up to
0.78) → mip 5.30.

```wgsl
fn fresnelSchlickRough(u: f32, f0: vec3f, roughness: f32) -> vec3f {
    let f = pow(1.0 - u, 5.0);
    return f0 + (max(vec3f(1.0 - roughness), f0) - f0) * f;
}
```

Ice multiplies this term by **2.6** — an art multiplier that makes refrozen ice genuinely
reflective without changing its F0 much (0.028 → 0.045).

### 7.5 Spell lights (same subsurface, fed by a local light)

```wgsl
if (uniforms.spellLightCount > 0.5) {
    color += spellLighting(
        world, N, V, albedo, thickness,
        uniforms.sssStrength * (1.0 - rockExposed), uniforms.sssRadius,
        uniforms.spellLightPos, uniforms.spellLightCol, uniforms.spellLightCount
    );
}
```

Uniform layout: `spellLightPos[i] = (x, y, z, radius_m)`,
`spellLightCol[i] = (r, g, b, intensity)`, `spellLightCount: f32`. Pool size **4**.

```wgsl
fn spellAttenuation(dist2: f32, radius: f32) -> f32 {
    let t2 = dist2 / max(radius * radius, 1e-4);
    if (t2 >= 1.0) { return 0.0; }
    let win = 1.0 - t2 * t2;
    return win * win / (dist2 + 0.25);
}
```

Windowed inverse square: `(1 - (d/r)⁴)² / (d² + 0.25)`. The **0.25 soft core** prevents the
term running away at the emitter's own position — "every spell that puts its emitter on the
snow… burns a clipped white disc into the ground" without it.

Per light, for snow:

```wgsl
acc += albedo * (1.0 / PI) * wrapDiffuse(dot(N, L), 0.66) * radiance;
acc += snowSubsurface(N, L, V, radiance, thickness, sssStrength, sssRadius) * albedo;
```

Wrap for spell lights on snow is **0.66** (a fixed constant, *not* the sun's
compression-modulated 0.62/0.15). The subsurface call is byte-identical to the sun's —
which is the whole point: "a ribbon of lit water lying across a berm glows *through* the
crest instead of merely putting a bright patch on the near face."

---

## 8. Glints — procedural, view-dependent, grazing-gated

Applied **last among the lighting terms, and additively as radiance**, "because a glint is
a specular highlight from a crystal facet that the shading normal does not represent."

```wgsl
if (uniforms.glintIntensity > 0.001 && rockExposed < 0.5) {
    let g = snowGlints(
        world.xz, N, V, L, footprint,
        uniforms.glintIntensity, uniforms.glintGrazing
    );
    color += sunRadiance * g * shadow * (1.0 - iceAmount * 0.6) * 0.55;
}
```

Post-scale **0.55**; ice suppresses by up to **60%**; fully shadowed pixels get none.

### 8.1 One glint octave

```wgsl
fn glintOctave(
    p: vec2f, cell: f32,
    N: vec3f, H: vec3f, T: vec3f, B: vec3f,
    sharpness: f32
) -> f32 {
    let id = floor(p / cell);
    let r  = hash22(id);
    let r2 = hash22(id + vec2f(19.73, 7.31));

    // Only a fraction of cells hold a crystal facet oriented to catch anything.
    if (r2.x > 0.62) { return 0.0; }

    let centre = (id + 0.5 + (r - 0.5) * 0.72) * cell;
    let d = length(p - centre) / (cell * 0.17);
    let disc = clamp(1.0 - d * d, 0.0, 1.0);
    if (disc <= 0.0) { return 0.0; }

    // Tilt the facet off the surface normal by a random amount in the tangent
    // plane. Small tilts, or every facet fires at once and it reads as glitter.
    let ang = r.y * 6.28318530718;
    let tilt = 0.10 + r2.y * 0.26;
    let facet = normalize(N + (T * cos(ang) + B * sin(ang)) * tilt);

    let nh = clamp(dot(facet, H), 0.0, 1.0);
    return disc * pow(nh, sharpness);
}
```

- **62% of cells are culled** (`r2.x > 0.62` returns 0 — so ~62% of cells *survive*; the
  test rejects the upper 38%). Read literally: a cell is skipped when `r2.x > 0.62`, so
  **~62% of cells hold a facet**.
- Facet centre is jittered within ±0.36 cell (`(r - 0.5) * 0.72`).
- Disc falloff radius = **0.17 cell**, profile `1 - d²` (round, not square).
- Facet tilt off the surface normal: **0.10 to 0.36** (radians-ish, as a tangent-plane
  offset before normalisation → ~5.7° to ~19.8°).
- Because both the position and the orientation hash purely off the **world-space cell
  index**, a glint is nailed to the ground: it does not crawl when the camera moves, which
  is what lets TAA keep it.

### 8.2 The full response and the grazing gate

```wgsl
fn snowGlints(
    worldXZ: vec2f, N: vec3f, V: vec3f, L: vec3f,
    pixelFootprint: f32, intensity: f32, grazeGate: f32
) -> f32 {
    if (intensity <= 0.0) { return 0.0; }

    let H = normalize(V + L);

    let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(N.y) > 0.95);
    let T = normalize(cross(up, N));
    let B = cross(N, T);

    // Grazing gate: 1 looking along the surface, 0 looking straight down.
    let NdotV = clamp(dot(N, V), 0.0, 1.0);
    let graze = pow(1.0 - NdotV, mix(1.5, 5.0, grazeGate));

    // Sun must be low relative to the surface too, or a facet has nothing to
    // bounce toward the eye.
    let NdotL = clamp(dot(N, L), 0.0, 1.0);
    let lightGate = smoothstep(0.02, 0.35, NdotL) * (1.0 - smoothstep(0.55, 0.95, NdotL) * 0.55);

    let gate = graze * lightGate;
    if (gate <= 0.001) { return 0.0; }

    var sum = 0.0;

    let cellA = 0.052;
    let fadeA = smoothstep(cellA * 0.55, cellA * 2.2, pixelFootprint);
    if (fadeA < 1.0) {
        sum += glintOctave(worldXZ, cellA, N, H, T, B, 780.0) * (1.0 - fadeA);
    }

    let cellB = 0.185;
    let fadeB = smoothstep(cellB * 0.55, cellB * 2.2, pixelFootprint);
    if (fadeB < 1.0) {
        sum += glintOctave(worldXZ + vec2f(53.1, 17.9), cellB, N, H, T, B, 1500.0) * (1.0 - fadeB) * 1.35;
    }

    return sum * gate * intensity;
}
```

| Octave | cell size | specular sharpness | world offset | weight | fade band (footprint) |
|---|---|---|---|---|---|
| A | **0.052 m** (5.2 cm) | **780** | (0, 0) | 1.00 | 0.0286 m → 0.1144 m |
| B | **0.185 m** (18.5 cm) | **1500** | (53.1, 17.9) | **1.35** | 0.1018 m → 0.407 m |

**Gate anatomy:**
- `graze = pow(1 - NdotV, mix(1.5, 5.0, glintGrazing))`. Default `glintGrazing = 0.72` →
  exponent = 1.5 + 0.72·3.5 = **4.02**. So looking straight down (`NdotV = 1`) gives 0;
  a 60° view (`NdotV = 0.5`) gives 0.5^4.02 ≈ 0.062; an 84° grazing view
  (`NdotV = 0.1`) gives 0.9^4.02 ≈ 0.66.
- `lightGate` ramps in over `NdotL ∈ [0.02, 0.35]` and then *rolls back off* by up to 55%
  as `NdotL` goes from 0.55 to 0.95 — so the brightest glints are on surfaces at a
  moderate angle to the sun, not on ones facing it squarely.
- Early-out at `gate <= 0.001`.

> Gated hard on grazing view angle: snow sparkles when you look *across* it into the sun,
> and stays matte when you look down at it. Losing that gate is what turns this effect into
> glitter.

Hash used by glints (`lib/noise.wgsl`):

```wgsl
fn hash22(p: vec2f) -> vec2f {
    var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}
```

---

## 9. Occlusion, applied last and to everything — the cave tint

```wgsl
let caveTint = mix(vec3f(1.0), vec3f(0.55, 0.72, 1.0), (1.0 - ao) * 0.95);
color *= ao * caveTint;
```

Two rules, both about **hue rather than brightness**, quoted in full because they are the
reason the frame is not brown:

> 1. It scales the *finished radiance*, not the ambient. The textbook says occlusion darkens
>    ambient and leaves direct light alone, and in this scene that is actively wrong: the
>    ambient is where all the blue lives — the sky is strongly blue-shifted by construction
>    — and the sun is a 13-degree beam at roughly 17:13:6. Attenuating one and not the other
>    does not darken a surface, it re-weights a cool source against a warm one. A trench
>    floor at 40% ambient and 100% sun is not a dark trench, it is a *brown* trench, and it
>    lands there because AgX stops rolling saturation off half a stop below its shoulder.
>
> 2. Wherever it does darken, it goes blue in proportion. Light reaching into a hollow in
>    snow has scattered through snow to get there, and snow absorbs red over any appreciable
>    path — which is why a real snow cave is blue and not grey. The tint is the same
>    `deepTint` the subsurface term uses, and tying it to the darkening rather than to
>    `deformDepth` means the two can never drift apart.

**`caveTint` reuses the exact `deepTint` vector `(0.55, 0.72, 1.0)`.** In a port, bind it to
a single shared constant so the two cannot diverge. The tint parameter is
`(1 - ao) * 0.95`, so even at `ao = 0` the tint reaches only 95% of the way to deep blue.

Worked example at the maximum darkening the material can produce
(`cavity = 0.5`, tiny footprint, `deformDepth ≥ 0.526`):
`ao = mix(1, 0.5, 0.35) * (1 - 0.38) = 0.825 * 0.62 = 0.5115`;
`caveTint = mix(1, (0.55,0.72,1.0), 0.4641) = (0.7911, 0.8701, 1.0)`;
final multiplier = `(0.4046, 0.4451, 0.5115)` — i.e. a trench floor is darkened to ~40% in
red but ~51% in blue. **That ~26% red-vs-blue split is the visible signature.**

---

## 10. Aerial perspective, then debug

```wgsl
color = applyAerial(
    color, uniforms.cameraPos, world, -V, L,
    skyLUT, skyLUTSampler, sunRadiance,
    uniforms.fogDensity, uniforms.fogHeightFalloff, uniforms.fogStart,
    uniforms.aerialStrength
);
```

Note `-V` is passed as `viewDir` (pointing *away* from the camera). Summary of
`applyAerial` (full detail belongs to the atmosphere spec, reproduced here only so the snow
pass can be closed out):

```wgsl
let t = aerialTransmittance(camPos, worldPos, density, heightFalloff, fogStart);
let ext = clamp(1.0 - pow(t, strength), 0.0, 1.0);
let inscatter = aerialInscatterSky(skyTex, skySamp, viewDir, sunDir, sunColor, ext);
return mix(color, inscatter, ext);
```

with `aerialInscatterSky` = `mix(near, exact, smoothstep(0.55, 0.995, ext))`,
`near = aerialNearSky(...) + sunColor * phaseMie(mu, 0.62) * 5.5 * 0.16`,
`aerialNearSky` sampling the LUT along `normalize(viewDir + vec3(0, 0.42, 0))` at **mip 3**,
and `exact` sampling at **mip 0** with no tilt. Extinction is a closed-form height-falloff
integral with `fogStart` subtracted from the path length.

Fragment output: `fragmentOutputs.color = vec4f(color, 1.0);` — the beauty target is HDR
linear; tonemapping happens in post.

### 10.1 Debug modes (`debugMode` uniform, mapped in `terrain.js`)

```js
const DEBUG_MODES = {
    beauty: 0, deform: 1, normals: 2, depth: 3, cascades: 4,
    footprint: 5, fineNormals: 6, shadow: 7, ndotl: 8, shadowMap: 9,
    albedo: 10,
};
```

| Mode | Output |
|---|---|
| 1 deform | `vec3(deformDepth*2.5, deformBerm*5.0, compression*0.6)` |
| 2 normals | `N * 0.5 + 0.5` |
| 3 depth | `vec3(viewDist / 400.0)` |
| 4 cascades | `color*0.6 + step-mask*0.25` (the `else` branch) |
| 5 footprint | log2 ramp: R `clamp((lf+3.3)/3.3)`, G `clamp(1-abs(lf+4.6)/2)`, B `clamp(-(lf+5.0)/2)` — green ≈ 1 cm, yellow ≈ 10 cm, red ≈ 1 m |
| 6 fineNormals | `normalFromGradient(fine.yz) * 0.5 + 0.5` |
| 7 shadow | `vec3(shadow)`, or `vec3(0.35, 0.06, 0.06)` where `NdotL <= 0` |
| 8 ndotl | `vec3(max(NdotL, 0))` |
| 9 shadowMap | depth-map agreement in metres: blue `(0, 0.15, 0.6)` outside all cascades; else `vec3(agree*0.45)` + red/green `mag` where `agree = 1 - smoothstep(0, 0.5, |dz|)`, `mag = clamp(|dz|/12, 0, 1)` |
| 10 albedo | `albedo` raw |

Port these. Mode 5 (footprint) and mode 10 (albedo) in particular are how you will
diagnose a mismatched port: "every detail fade in this shader is keyed off this value, so
being able to see it directly turns 'why is there no detail here' from a guess into a
reading", and albedo "is the only way to see which of [compression, ice, displaced mass,
rock] is talking."

---

## 11. Shadows (the part the snow material owns)

Included here because the material declares the uniforms and the acceptance criteria depend
on the penumbra behaviour. Full spec belongs to the shadow document.

### 11.1 Uniforms the material must declare

```wgsl
uniform cascadeMatrices: array<mat4x4f, 3>;
uniform cascadeSplits: vec4f;          // (26, 95, 330, 330)
uniform cascadeParams: array<vec4f, 3>; // (depthRange m, orthoWidth m, 0, 0)
uniform shadowTexel: f32;               // 1/2048
uniform shadowSoftness: f32;            // 1.8   (set in terrain.js)
uniform shadowBias: f32;                // 0.022 metres (set in terrain.js)
```

### 11.2 PCSS in world units

```wgsl
let bias = biasWorld / depthRange;
let maxPenumbraUV = min(24.0 * texelSize, 1.8 / orthoWidth);
// 8-tap rotated Poisson blocker search, comparing against the receiver PLANE:
//   cmp = receiverDepth + dot(off, planeNdcPerUV) - bias
// if none found → return 1.0
let blockerDist = (blockerDepthSum / blockerCount) * depthRange;
let penumbraWorld = blockerDist * 0.0093 * softness;
let filterR = clamp(penumbraWorld / orthoWidth, texelSize, maxPenumbraUV);
// 12-tap rotated Poisson filter, same plane-corrected comparison, lit / 12.0
```

`0.0093` is the sun's angular diameter (~0.53°) as a tangent. `softness = 1.8` opens it up
"because pure geometric penumbra is tighter than snow actually looks once sky light fills
the shadow." Search radius cap: **24 texels or 1.8 m, whichever is smaller**.

Poisson disc (12 taps, precomputed):

```wgsl
const POISSON: array<vec2f, 12> = array<vec2f, 12>(
    vec2f(-0.326, -0.406), vec2f(-0.840, -0.074), vec2f(-0.696,  0.457),
    vec2f(-0.203,  0.621), vec2f( 0.962, -0.195), vec2f( 0.473, -0.480),
    vec2f( 0.519,  0.767), vec2f( 0.185, -0.893), vec2f( 0.507,  0.064),
    vec2f( 0.896,  0.412), vec2f(-0.322, -0.933), vec2f(-0.792, -0.598)
);
```

The blocker search uses taps **0..7**; the filter uses all **12**.

### 11.3 Receiver-plane gradient and normal offset

```wgsl
let lf = -uniforms.sunDir;
let lr = normalize(cross(vec3f(0.0, 1.0, 0.0), lf));
let lu = cross(lf, lr);
let nl = vec3f(dot(geoN, lr), dot(geoN, lu), dot(geoN, lf));
let nz = select(min(nl.z, -1e-3), max(nl.z, 1e-3), nl.z >= 0.0);
let grad = clamp(vec2f(-nl.x / nz, -nl.y / nz), vec2f(-6.0), vec2f(6.0));
let planeNdcPerUV = vec2f(grad.x, grad.y) * orthoWidth / depthRange;

let sinL = sqrt(clamp(1.0 - nl.z * nl.z, 0.0, 1.0));
let biased = world + geoN * (texelWorld * 1.5 * max(sinL, 0.2));
```

Slope clamp **±6** (≈ 80°). Normal offset = **1.5 cascade texels**, scaled by
`max(sinL, 0.2)`.

**UV derivation, with the sign that surprises people:**

```wgsl
let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 + ndc.y * 0.5);
```

Y is **`+`**, not the usual `0.5 - ndc.y*0.5`, because the map was rendered into a render
target and Babylon negates clip-space Y for those. **A Three.js/WebGL2 port must re-derive
this sign for its own render-target convention** — see §12.9.

### 11.4 Cascade selection and cross-fade

`sunShadow` returns 1.0 beyond `splits.z`. Within cascade *i*, if
`viewDist > splits[i] * 0.88` it also samples cascade *i+1* and cross-fades over that last
12%. Cascade 2 fades to fully-lit over `smoothstep(splits.z * 0.85, splits.z, viewDist)`.

---

## 12. WEBGL2 PORTING NOTES

### 12.1 No compute shaders → everything is already a fragment pass
Nothing in this subsystem uses compute. `detailBake`, `auxBake` and `deformSim` are all
full-screen fragment passes over `ProceduralTexture` targets. In Three.js: a
`THREE.WebGLRenderTarget` + an orthographic full-screen quad, or `WebGLRenderTarget` +
`renderer.setRenderTarget(rt); renderer.render(quadScene, quadCam);`. `refreshRate = 0`
(Babylon's "bake once") maps to: render once during load, then never again.

### 12.2 Float render targets — required extensions
| Reference format | WebGL2 target | Extension needed |
|---|---|---|
| `heightTex` R32F ×2 (`RG` + `FLOAT`) | `RG32F` (`type: FloatType`, `format: RGFormat`) | **`EXT_color_buffer_float`** to render to it; `OES_texture_float_linear` for bilinear filtering |
| `auxTex` RGBA16F | `RGBA16F` (`HalfFloatType`) | **`EXT_color_buffer_float`**; half-float linear filtering is core in WebGL2 |
| `deformTex` RGBA16F ×2 | `RGBA16F` | as above |
| `skyLUT` RGBA16F + mips | `RGBA16F`, `generateMipmaps: true` | as above; **mip generation on a float RT is unreliable on some drivers** — if `generateMipmaps` fails, bake the mip chain yourself with successive downsample passes |
| cascades R32F | `R32F` (`RedFormat` + `FloatType`) | **`EXT_color_buffer_float`** + `OES_texture_float_linear` (PCSS reads them with bilinear) |
| prepass RGBA16F | `RGBA16F`, **`NearestFilter`** | `EXT_color_buffer_float` |
| `detailTex` RGBA8 + mips | `RGBA8`, `generateMipmaps: true`, `RepeatWrapping`, `LinearMipmapLinearFilter` | none |

If `EXT_color_buffer_float` is unavailable, the honest fallbacks are: cascades → `RGBA8`
with depth packed into 4 bytes (**but PCSS's blocker search then needs manual unpacking per
tap and cannot use bilinear** — expect visible banding in the penumbra); `deformTex` →
`RGBA8` with a fixed-point encoding over ±1 m (the 400 s decay in `deformSim` will not
survive 8-bit; see §12.6). Neither is recommended; gate the demo on the extension.

### 12.3 `textureLoad` / `textureSampleLevel` / `textureSampleGrad`
| WGSL | GLSL 3.00 es |
|---|---|
| `textureSampleLevel(t, s, uv, 0.0)` | `textureLod(t, uv, 0.0)` |
| `textureSample(t, s, uv)` | `texture(t, uv)` |
| `textureSampleGrad(t, s, uv, ddx, ddy)` | `textureGrad(t, uv, ddx, ddy)` — **core in GLSL ES 3.00 fragment shaders**, no extension |
| `textureLoad(t, ivec, 0)` | `texelFetch(t, ivec, 0)` |
| separate `texture_2d<f32>` + `sampler` | one combined `sampler2D` |

`textureGrad` is the one that matters: the three detail layers and the cavity fetch all use
explicit gradients specifically so they can sit behind non-uniform branches while keeping
full trilinear/aniso filtering. **Do not replace them with `texture()` inside the `if`
blocks** — that is undefined behaviour in a non-uniform branch and will produce mip
popping along the fade boundaries.

### 12.4 `dpdx`/`dpdy` → `dFdx`/`dFdy`
Core in GLSL ES 3.00. `fwidth` also core. Take them **before** any branch, exactly as the
reference does. The reference calls them on a `vec3` world position; GLSL supports that.

### 12.5 Matrix column order — WGSL `mat2x2f` vs GLSL `mat2`
Both WGSL and GLSL are **column-major** with column-vector convention, and both construct
from columns. `mat2x2f(a, b, c, d)` in WGSL is column0 = `(a,b)`, column1 = `(c,d)` — the
same as GLSL `mat2(a, b, c, d)`. So `windMat` and `rot2` transcribe verbatim.

**The trap is `v * M` (vector-times-matrix).** WGSL and GLSL both define `v * M` as the
row-vector product `Mᵀ · v`. Both languages agree, so `d += (n.yz * xform)` transcribes
literally as `d += (n.yz * xform)` in GLSL too. Verify this with a unit test on a
non-symmetric matrix before trusting it, because getting it backwards transposes the wind
anisotropy and the dunes will run *along* the wind instead of across it.

Same applies to the derivative chain-rule lines in `fbmd`, `fbmDamped`, `ridgedd` and to
`d += (sas.yz * m3) * a` in `terrainFineFiltered`.

### 12.6 `fract` semantics
WGSL `fract(x)` = `x - floor(x)` — identical to GLSL `fract`. **Both return non-negative
results for negative inputs**, which is exactly what the toroidal `deformUV` relies on
(`fract(worldXZ / size)` for negative world coordinates). No change needed. Do **not**
substitute `mod(x, 1.0)` — it is the same in GLSL, but `x - trunc(x)` (the C/JS `%`
behaviour) is **not** and would mirror the deformation buffer across the origin.

`hash22`/`hash21`/`hash11` rely on `fract` of large products; f32 precision differs slightly
between backends, so expect the *positions* of individual snow grains and glints to differ
from the reference. That is acceptable; their *statistics* must not.

**`highp float` is mandatory** in every fragment shader in this subsystem
(`precision highp float;`). The hashes, the 4096-texel height UVs, and the shadow NDC
comparisons all break at mediump.

### 12.7 `select()` → ternary / `mix`
`select(a, b, cond)` returns `b` when `cond` is true (note the argument order is the
*reverse* of GLSL `mix(a, b, t)`'s intuition but matches it positionally). Port as:

```glsl
// select(vec3(0,1,0), vec3(1,0,0), abs(N.y) > 0.99)
vec3 up = (abs(N.y) > 0.99) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);

// select(1.0, 0.0, d < cmp)   inside the PCSS filter loop
lit += (d < cmp) ? 0.0 : 1.0;
```

### 12.8 Arrays in uniforms
`uniform shR: array<vec4f, 9>` → `uniform vec4 shR[9];` (or a `vec3` array, but keep
`vec4` for std140 alignment sanity). `cascadeMatrices: array<mat4x4f, 3>` → `uniform mat4
cascadeMatrices[3];`. `cascadeParams`/`spellLightPos`/`spellLightCol` → `vec4[N]`.

In WGSL these live in a uniform buffer; in WebGL2 you may use a UBO (`std140`) or plain
uniforms. Plain uniforms are simpler and this material has fewer than 100 of them. If you
use a UBO, remember `std140` pads `vec3` to 16 bytes — the reference already uses `vec4`
everywhere it matters, which is why.

**`POISSON` as a `const array` inside the shader:** GLSL ES 3.00 supports
`const vec2 POISSON[12] = vec2[12](...)` at global scope. Indexing it with a loop counter
is fine (the loop bounds are constant).

### 12.9 Render-target Y flip — RE-DERIVE, DO NOT COPY
The `+ndc.y*0.5` in the shadow UV is a *Babylon-specific* compensation: Babylon negates
clip-space Y when rendering into a render target under WebGPU (WebGPU's texture origin is
top-left; the framebuffer convention is bottom-left), so the cascade is stored
already-flipped.

**Three.js/WebGL2 does not do this.** WebGL's framebuffer origin is bottom-left and matches
NDC, so the standard mapping applies:

```glsl
vec2 uv = ndc.xy * 0.5 + 0.5;   // both components, standard
```

Verify empirically the way the reference author did: readback cascade 0, pick five known
world points, and confirm `stored_depth - receiver_ndc_z` scaled to metres agrees within
< 0.5 m. If the error passes through zero at `v = 0.5` and grows linearly either side, the
Y sign is wrong. Debug mode 9 (`shadowMap`) exists precisely to show this without a
readback — port it early.

### 12.10 No timestamp queries
WebGPU timestamp queries are unavailable in WebGL2. Use `EXT_disjoint_timer_query_webgl2`
if present (it is not on most platforms today), otherwise fall back to CPU wall-clock frame
time. This affects only the perf overlay, not the image.

### 12.11 Babylon-specific constructs → Three.js
| Babylon | Three.js |
|---|---|
| `ShaderMaterial` with `{vertex, fragment}` names + shader store | `THREE.RawShaderMaterial` (or `ShaderMaterial` with `glslVersion: THREE.GLSL3`) with inline strings |
| `#include<snowNoise>` etc. (Babylon's WGSL include store) | `THREE.ShaderChunk['snow_noise'] = ...` + `#include <snow_noise>`, or plain JS string concatenation. **String concat is simpler and avoids Three's chunk-name collisions.** |
| `ProceduralTexture` + `refreshRate = 0` | render-once to a `WebGLRenderTarget` |
| `mat.setTexture/setFloat/setVector2/setArray4` | `material.uniforms.X.value = ...` |
| `defines: ["SNOW_CASCADE 0"]` (forces a distinct Effect per cascade) | three separate materials, or one material + a `mat4 lightViewProjection` uniform reset per cascade draw. Three has no mid-frame UBO aliasing problem, so **one material with a per-cascade uniform write is fine** |
| `scene.customRenderTargets` (render order = registration order) | explicit `renderer.setRenderTarget()` calls in `main()`, in the order listed in §1.2 |
| `Constants.TEXTURE_WRAP_ADDRESSMODE` | `THREE.RepeatWrapping` |
| `Constants.TEXTURE_CLAMP_ADDRESSMODE` | `THREE.ClampToEdgeWrapping` |
| `backFaceCulling = true` | `side: THREE.FrontSide` — **but note Babylon is left-handed and treats clockwise as front-facing**; the clipmap index winding in `clipmapMesh.js` alternates the diagonal per quad and was chosen for that convention. In Three.js (right-handed, CCW front) either flip the winding or set `side: THREE.BackSide`. Get this wrong and the terrain is invisible or inside-out. |
| `readPixels()` on a `ProceduralTexture` | `renderer.readRenderTargetPixels()` — **synchronous and stalling**; do it only during load, exactly as the reference does |

### 12.12 `input.position.xy` (fragment builtin)
Babylon WGSL exposes the fragment position as `input.position`. GLSL ES 3.00 has
`gl_FragCoord`. Port `ign(input.position.xy)` → `ign(gl_FragCoord.xy)`. Same origin
convention concern as §12.9, but IGN is a hash — a Y flip only changes *which* pixels get
which rotation, which is invisible.

### 12.13 Loop and branch restrictions
GLSL ES 3.00 requires loops to have compile-time-determinable bounds for older drivers,
though WebGL2 is generally lenient. All loops here are fixed-count (`8`, `12`, `3×3`, `4`),
so no problem. The `for (var i = 0; i < SPELL_LIGHT_MAX; i++) { if (i >= n) break; }`
pattern ports directly.

### 12.14 Precision substitutions worth knowing
- `deformTex` at RGBA16F resolves "well under a tenth of a millimetre" over a ±1 m range.
  The reference *banks* relaxation time on the CPU (`RELAX_STEP = 0.4 s`) precisely because
  a 400-second decay asks for a per-frame change smaller than the half-float ULP
  (4.9e-4 relative). **Reproduce the banking**, or trails will heal in ten seconds instead
  of surviving a minute.
- prepass at RGBA16F: relative error 2⁻¹¹ = 0.05% of distance. Fine.
- `heightTex` must be **full float** — the height range is tens of metres and the bicubic
  reconstruction is differenced at 0.5 m; half-float would quantise dune faces visibly.

### 12.15 What the port may legitimately drop
Nothing in the shading path. If you must cut for performance, cut in this order (least
visible first): glint octave B, the coarse (0.31) detail scale, triplanar on steep faces.
**Do not cut** the subsurface term, the cave tint, the snow bounce, or the wrapped diffuse
— each of those is individually load-bearing for the material reading as snow.

---

## 13. VISUAL ACCEPTANCE CRITERIA

A harsh critic should be able to check every one of these from screenshots. Numbers refer
to default settings (sun elevation **13°**, azimuth **118°**, wind **42°**,
`glintIntensity 0.55`, `glintGrazing 0.72`, `sssStrength 1.0`, `sssRadius 1.0`,
`ambientIntensity 1.0`, `exposure 0.105`, AgX).

1. **Shadowed snow is blue, never grey and never black.** Sample any pixel in the cast
   shadow of a dune crest and any pixel in full sun on the same slope: the shadowed pixel's
   B/R ratio must be **substantially higher** than the sunlit pixel's. If shadowed snow
   reads neutral grey or warm, the SH ambient, the `mix(0.42, 1.0, shadow)` subsurface
   floor, or the cave tint is missing.

2. **A drift lip or berm crest with the sun behind it glows through.** Position the camera
   looking *into* the sun across a berm thrown by a carve: the thin crest must be visibly
   brighter than the thick snow either side of it, and that brightness must *increase* as
   the view direction approaches the sun. If it peaks with the sun **behind** the camera
   instead, `backScatter` was built from `-L` and the whole term is inverted.

3. **A trench floor is darker in red than in blue.** Screenshot a deep footprint or surf
   groove. The occluded floor must be roughly **40% of surrounding red but ~51% of
   surrounding blue** (see the worked example in §9). A trench that reads brown or
   warm-grey means occlusion was applied to the ambient only, textbook-style.

4. **Freshly thrown berms are brighter *and* at least as blue as the snow around them.**
   Never warmer, never greyer. Put the debug albedo view (mode 10) side by side with beauty:
   in albedo the berm must be lighter than base snow in **all three channels**. In beauty it
   must also still carry a visible blue sky-specular sheen — a berm that has lost its
   sky reflection has too high a roughness.

5. **The trail survives as a tonal line far past the distance at which it stops being a
   shape.** Walk 30–60 m from a fresh trail. The groove must still be legible as a
   continuous darker line — not switched off, and not broken into a dotted line. Then
   *orbit the camera without moving the player*: the trail's apparent width and contrast
   must **not** change. Any change means the deformation gradient is keyed off `footprint`
   instead of `footprintMin`.

6. **Glints appear only at grazing view angles, and they are nailed to the ground.** Look
   straight down at snow in full sun: essentially no sparkle. Tilt to a grazing view across
   the field toward the sun: discrete, round, individually resolvable sparkles appear. Then
   strafe the camera *sideways* while keeping the same patch in frame: individual sparkles
   must stay attached to the same points on the ground (they may extinguish as the half
   vector rotates, but they must not *travel*). Sparkles that slide with the camera mean the
   glint hash is keyed off screen or view space.

7. **Sastrugi ridges run in patches at slightly different angles, not as uniform corduroy.**
   From a low camera, the metre-scale wind ridges must break into regions with visibly
   different streak direction and different streakiness — the `windLocal` veer/stretch
   fields at ~120 m and ~80 m. A uniform woven-fabric look across the whole field means
   `windLocal` was dropped or its noise scales are wrong.

8. **Grain detail fades out smoothly with distance and never pops.** Sweep the camera from
   0.5 m to 50 m above the same patch while watching debug mode 5 (footprint). Detail must
   cross-fade continuously; no scale may appear or vanish in a single frame, and no
   shimmering moiré carpet may appear in the mid-distance when the camera moves.

9. **Shadow penumbra visibly widens with distance from the contact point.** Find a dune
   whose shadow runs a long way across the field at the 13° sun: the shadow must be crisp
   where the casting crest meets the ground and progressively softer further out. A shadow
   that is uniformly pin-sharp along its whole length means the PCSS penumbra estimate is
   being computed in NDC rather than converted to metres, and is rounding to zero.

10. **Compressed trail floors are darker, tighter-specular, and *less* translucent than the
    berms beside them — but still blue.** In one screenshot of a walked trail the three
    states must be distinguishable: packed floor (darker, sharper highlight, smoother
    normals), loose berm (brightest, roughest, granular), undisturbed snow (between them).
    If floor and berm shade identically, the deformation `.b`/`.g` channels are not
    reaching the material.

11. **Refrozen ice is genuinely mirror-like and the specular is the *bluest* thing on it.**
    Cast Crystallise (or write ice into the deform buffer directly): the glazed patch must
    show a sharp sky reflection at ~2.6× the snow's ambient specular, near-zero glints, and
    a markedly darker, bluer base colour `(0.42, 0.56, 0.70)`.

12. **Sunlit snow must not clip to flat white.** Zoom in on a fully-lit dune flank at
    default exposure. Slope variation must remain readable across the whole lit face — no
    large regions resolving to identical maximum white. If it clips, either the albedo was
    pushed to 1.0 or exposure is above 0.105 and has entered the AgX shoulder.

---

## Appendix A — Numeric constant index

Every distinct numeric constant captured in this document, numbered for verification.
Vector constants count as one entry (their scalar components are given).

### A.1 Bake / texture geometry
1. `DETAIL_RES = 1024` — detail map resolution, px
2. `grainScale = 0.013` — detail normal slope multiplier
3. `WORLD_SIZE = 2048` — field extent, m
4. `HEIGHT_RES = 4096` — height texture resolution, px
5. `AUX_RES = 2048` — aux texture resolution, px
6. `texelWorld = 0.5` — height texel size, m
7. `invHeightRes = 1/4096` — aux bake derivative UV step
8. `PLAY_RADIUS = 620` — playable half-extent, m
9. `LUT_W = 512`, `LUT_H = 256` — sky LUT dims, px
10. `SH_W = 64`, `SH_H = 32` — SH projection LUT dims, px
11. shadow `RESOLUTION = 2048` — cascade map size, px
12. `texelSize = 1/2048` — one shadow texel in UV
13. `DEPTH_FAR = 9000` — prepass clear depth, m
14. deform `COVERAGE = 80` — window coverage, m
15. `deformResolution = 2048` — deform target size, px
16. deform `texel = 0.0390625` — 80/2048, m
17. `MAX_BRUSHES = 96`, `BRUSH_ROWS = 3` — brush data texture dims
18. `RELAX_STEP = 0.4` — relaxation banking step, s
19. `BASE_SPACING = 0.085` — innermost clipmap vertex spacing, m
20. `GRID_N = 160` — quads per side per ring
21. `LEVELS = 8` — clipmap ring count
22. `GRID_HALF_N = 80`
23. `HOLE_SHRINK = 3` — cells of ring overlap
24. `OUTER_EXTENT = 80 × 0.085 × 2⁷ = 870.4` — clipmap half-extent, m

### A.2 detailBake
25. grain layer A cells = period = `26.0`
26. grain layer B cells = period = `61.0`
27. grain layer C cells = period = `137.0`
28. layer B UV offset `(0.37, 0.11)`
29. layer C UV offset `(0.71, 0.53)`
30. height weights `1.0 / 0.42 / 0.17`
31. cavity weights `0.55 / 0.30 / 0.15`
32. grain centre jitter base `0.25`, span `0.5`
33. grain radius base `0.30`, span `0.26`
34. dome amplitude base `0.55`, span `0.45`
35. cavity depth factor `0.5`
36. hashTile secondary offset `(37.0, 91.0)`
37. neighbourhood radius `1` (3×3)
38. normal encode bias/scale `0.5`

### A.3 auxBake
39. wide-stencil multiplier `6.0` (→ 3.0 m)
40. exposure base `0.5`
41. exposure Laplacian scale `2.2`
42. central-difference divisor `2.0`

### A.4 Snow fragment — footprint & deformation
43. footprint epsilon `1e-4`
44. deform step floor `deformTexel * 2.0`
45. deform step footprint factor `1.4`
46. `dWeight` threshold `0.001`
47. wide-blend divisor `deformTexel * 4.0`
48. wide-blend cap `0.8`
49. neighbour-mean weight `0.2` (5 taps)
50. deform falloff smoothstep `0.80 → 0.96`

### A.5 Detail normals
51. `steep` smoothstep `0.55 → 0.9`
52. detail scale 0 `= 7.5` m⁻¹
53. fade 0 band `0.004 → 0.02` m
54. detail scale 1 `= 1.7` m⁻¹
55. fade 1 band `0.02 → 0.12` m
56. layer 1 weight `0.85`
57. detail scale 2 `= 0.31` m⁻¹
58. fade 2 band `0.1 → 0.7` m
59. layer 2 weight `0.6`
60. tangent-frame switch `|N.y| > 0.99`
61. detail strength compression mix `1.0 → 0.45`
62. `blendSteep` triplanar threshold `0.01`
63. layer-active threshold `0.001`
64. cavity sample scale `1.7` m⁻¹
65. `detailStrength` gate `0.001`

### A.6 Material state
66. base albedo `(0.855, 0.885, 0.945)`
67. base roughness `0.62`
68. base F0 `0.028`
69. base thickness `1.0`
70. compressed albedo `(0.62, 0.665, 0.755)`
71. compressed albedo mix scale `0.85`
72. compressed roughness `0.34`
73. compressed thickness `0.35`
74. ice albedo `(0.42, 0.56, 0.70)`
75. ice albedo mix scale `0.8`
76. ice roughness `0.07`
77. ice F0 `0.045`
78. ice thickness `0.15`
79. rock slope gate smoothstep `0.32 → 0.66`
80. rock noise scale `2.3` m⁻¹
81. rock colour dark `(0.055, 0.058, 0.068)`
82. rock colour light `(0.115, 0.112, 0.118)`
83. rock roughness `0.85`
84. rock thickness `0.0`
85. rock active threshold `0.001`
86. berm threshold `0.002` m
87. `loose = clamp(deformBerm * 5.0)`
88. loose albedo `(0.895, 0.920, 0.965)`
89. loose albedo mix scale `0.55`
90. loose roughness `0.78`
91. loose roughness mix scale `0.7`
92. loose thickness mix scale `0.6`
93. chunk noise scale `34.0` m⁻¹
94. chunk darkening `0.10`

### A.7 Ambient occlusion & cave tint
95. cavity AO weight `0.35`
96. cavity AO footprint fade `0.02 → 0.25` m
97. deform-depth AO scale `1.9`
98. deform-depth AO strength `0.38`
99. cave tint parameter scale `0.95`
100. cave tint colour `(0.55, 0.72, 1.0)` (== `deepTint`)

### A.8 Lighting
101. `INV_PI = 0.31830988618`
102. `PI = 3.14159265359`
103. `NdotV` clamp `1e-4`
104. IGN → radians `6.28318530718`
105. IGN constants `52.9829189`, `(0.06711056, 0.00583715)`
106. shadow-skip gate `NdotL > -0.35`
107. wrap amount snow `0.62`
108. wrap amount compressed/rock `0.15`
109. SSS shadow floor `0.42`
110. GGX/Vis epsilon `1e-7`
111. Fresnel Schlick power `5.0`
112. bounce `bounceUp = -N.y * 0.5 + 0.5`
113. bounce weight `0.28`
114. sky specular mip `sqrt(roughness) * 6.0`
115. ice ambient-specular boost `2.6`
116. SH `c1 = 0.429043`
117. SH `c2 = 0.511664`
118. SH `c3 = 0.743125`
119. SH `c4 = 0.886227`
120. SH `c5 = 0.247708`
121. SH CPU basis `0.282095`
122. SH CPU basis `0.488603`
123. SH CPU basis `1.092548`
124. SH CPU basis `0.315392`
125. SH CPU basis `0.546274`
126. Rec.709 luma `(0.2126, 0.7152, 0.0722)`

### A.9 Subsurface (the signature term)
127. `shallowTint = (0.94, 0.965, 1.0)`
128. `deepTint = (0.55, 0.72, 1.0)`
129. tint parameter `clamp(thickness * radius, 0, 1)`
130. back-scatter distortion `0.28 * radius`
131. lobe power thin→deep `3.0 → 9.0`
132. lobe amplitude thin→deep `1.0 → 0.30`

### A.10 Glints
133. cell-cull threshold `r2.x > 0.62`
134. facet hash offset `(19.73, 7.31)`
135. facet centre jitter `0.5` base, `0.72` span
136. disc radius `cell * 0.17`
137. facet tilt base `0.10`, span `0.26`
138. tangent-frame switch `|N.y| > 0.95`
139. graze exponent range `1.5 → 5.0`
140. light gate ramp-in `smoothstep(0.02, 0.35, NdotL)`
141. light gate roll-off `smoothstep(0.55, 0.95, NdotL) * 0.55`
142. gate early-out `0.001`
143. `cellA = 0.052` m
144. sharpness A `780.0`
145. `cellB = 0.185` m
146. octave B world offset `(53.1, 17.9)`
147. sharpness B `1500.0`
148. octave B weight `1.35`
149. octave fade band `cell * 0.55 → cell * 2.2`
150. glint intensity gate `0.001`
151. glint rock gate `rockExposed < 0.5`
152. glint post-scale `0.55`
153. glint ice suppression `0.6`

### A.11 Shadows (material-side)
154. `POISSON[12]` disc (24 scalars, listed verbatim in §11.2)
155. blocker search taps `8`
156. filter taps `12`
157. max penumbra `24.0 * texelSize`
158. max penumbra world cap `1.8` m
159. sun angular tangent `0.0093`
160. `shadowSoftness = 1.8`
161. `shadowBias = 0.022` m
162. cascade splits `26 / 95 / 330` m
163. cascade cross-fade start `0.88`
164. last-cascade fade start `0.85`
165. receiver-plane slope clamp `±6.0`
166. `nz` epsilon `1e-3`
167. normal offset `1.5` texels
168. `max(sinL, 0.2)`
169. shadow-delta debug scale `12.0` m, agreement band `0.5` m

### A.12 Spell lights
170. `SPELL_LIGHT_MAX = 4`
171. attenuation soft core `0.25`
172. attenuation window `1 - t²`, squared
173. snow wrap for spell lights `0.66`
174. surface wrap (caller-supplied), particle wrap `0.8`
175. count gate `> 0.5`

### A.13 Analytic fine layer (feeds the shading gradient)
176. sastrugi wavelength `2.3` m
177. sastrugi ridged octaves `3`, lacunarity `2.11`, gain `0.52`
178. sastrugi amplitude `0.125`
179. sastrugi exposure mix `0.45 → 1.0`
180. sastrugi height offset `-0.35`
181. scour base `0.45`, span `0.55`
182. scour noise scale `0.021` m⁻¹, smoothstep `-0.25 → 0.35`
183. sastrugi footprint fade `0.35 → 1.6` m
184. ripple wavelength `0.42` m, anisotropy `2.9`
185. ripple amplitude `0.024`
186. ripple exposure mix `1.0 → 0.45`
187. ripple veer factor `0.5`
188. ripple footprint fade `0.06 → 0.3` m
189. grain wavelength `0.115` m
190. grain amplitude `0.0075`
191. grain footprint fade `0.016 → 0.08` m
192. `windLocal` veer noise scale `0.0083`, offset `(31.7, 12.3)`, amplitude `0.42`
193. `windLocal` stretch noise scale `0.0126`, offset `(7.1, 41.9)`, base `2.3`, span `2.4`
194. fbm per-octave rotation `0.517` rad
195. ridged per-octave rotation `0.717` rad
196. ridged octave coupling `mix(1.0, r2, 0.65)`
197. fbm start amplitude `0.5`
198. quintic fade `6/-15/10`, derivative `30 f²(f-2)+1`

### A.14 Macro terrain (context for the baked gradient)
199. broad dune wind matrix `(2.1, 1.0)`, wavelength `58.0` m
200. broad fbmDamped `5` octaves, lacunarity `2.03`, gain `0.5`, damp `0.9`
201. broad amplitude `15.5` m
202. swell wind matrix `(1.35, 1.0)`, wavelength `210.0` m
203. swell fbmDamped `3`, `2.11`, `0.55`, damp `0.3`
204. swell amplitude `26.0` m
205. medium drift matrix `(1.55, 1.0)`, wavelength `13.5` m
206. medium domain shear `broad.x * 2.4`
207. medium fbmDamped `4`, `2.07`, `0.48`, damp `1.7`
208. shelter `clamp(0.5 - broad.x * 0.75, 0.15, 1.0)`
209. medium amplitude `2.9` m
210. macro derivative epsilon `0.35` m
211. rock cell `165.0` m, cull `r2.x > 0.34`
212. rock centre jitter `0.15 + r * 0.7`, radius `7.0 + r2.y * 11.0`, cutoff `1.6×`
213. rock ridged matrix wavelength `5.5`, `3` octaves, `2.17`, `0.55`
214. rock height `3.5 + r2.y * 6.0`, roughness mix `0.62 + 0.55 * rough`

### A.15 Clipmap / vertex-side gates (must be mirrored in depth + prepass)
215. ring snap `spacing * 2.0`
216. CDLOD morph band `(cheb - 0.70) / 0.16`
217. fine-layer displacement gate `spacing < 0.42`, fade `0.16 → 0.42`
218. deformation displacement gate `spacing < 1.0`, fade `0.5 → 1.0`
219. deform binomial kernel `[1,2,1]²/16`
220. bicubic B-spline weights `1/6` family
221. `maxDepth = 0.55 * deformDepth` m
222. `maxBerm = 0.34 * deformBerm` m
223. deform diffusion `kDep = min(0.22, 0.004*k)`, `kBerm = min(0.22, 0.012*k)`

### A.16 Settings defaults (`core/settings.js`)
224. `sunAzimuth = 118`°
225. `sunElevation = 13.0`°
226. `sunIntensity = 4.2`
227. `sunTempWarm = 1.0`
228. `ambientIntensity = 1.0`
229. `ambientBlue = 1.0`
230. `windDirection = 42`°
231. `fogDensity = 0.0072`
232. `fogHeightFalloff = 0.045`
233. `fogStart = 24` m
234. `aerialStrength = 1.0`
235. `glintIntensity = 0.55`
236. `glintGrazing = 0.72`
237. `sssStrength = 1.0`
238. `sssRadius = 1.0`
239. `detailNormalStrength = 1.0`
240. `macroHeightScale = 1.0`
241. `sastrugiStrength = 1.0`
242. `deformDepth = 1.0`, `deformBerm = 1.0`, `refillRate = 1.0`
243. `exposure = 0.105`
244. `contrast = 1.14`
245. `bloomStrength = 0.22`, `grainStrength = 0.022`, `sharpenStrength = 0.55`
246. `mountainHeight = 2150` m, `shaftStrength = 0.30`

### A.17 Sun / sky radiometry (the material's `sunRadiance` and `shR` inputs)
247. `SUN_SCALE_BASE = 5.5`
248. Rayleigh vertical optical depth `tauR = [0.0464, 0.108, 0.265]`
249. Mie vertical optical depth `tauM = 0.0252`
250. Kasten-Young `0.50572`, `96.07995`, exponent `-1.6364`
251. air-mass cap `40`
252. `SNOW_ALBEDO = [0.83, 0.86, 0.91]` (bounce solve)
253. bounce solve iterations `3` (+ 1 final bake)
254. `BETA_R = (5.8e-6, 13.5e-6, 33.1e-6)` per m
255. `BETA_M = 21e-6` per m
256. `MIE_G = 0.76`
257. `MS_BOOST = 1.5`
258. `SHADOW_FILL = 0.5`
259. `EARTH_R = 6360000`, `ATMOS_R = 6420000` m
260. `H_RAYLEIGH = 8000`, `H_MIE = 1200` m
261. sky march `STEPS = 32`, `LIGHT_STEPS = 8`, `DIST_POWER = 2.5`
262. ground handover smoothstep `-0.030 → -0.005`
263. horizon desaturation `smoothstep(0.0, 0.26, |y|)`, weight `0.82`
264. pale luminance weights `(0.30, 0.42, 0.28)`, tint `(0.97, 1.0, 1.06)`
265. Mie extinction multiplier `1.1`, MS Mie weight `0.4`

### A.18 Aerial perspective (applied to the snow's output)
266. near-sky tilt `(0, 0.42, 0)`, mip `3.0`
267. exact-sky mip `0.0`
268. forward-lobe Mie `g = 0.62`, gain `5.5`, weight `0.16`
269. near→exact crossfade `smoothstep(0.55, 0.995, ext)`
270. flat-ray epsilon `0.01` m

### A.19 Debug view scales
271. deform view scales `2.5 / 5.0 / 0.6`
272. depth view divisor `400.0` m
273. footprint ramp offsets `3.3 / 4.6 / 5.0`, divisors `3.3 / 2.0 / 2.0`
274. back-lit marker colour `(0.35, 0.06, 0.06)`
275. cascade view mix `0.6 / 0.25`
276. shadow-map view outside colour `(0.0, 0.15, 0.6)`, agreement gain `0.45`

**Total distinct numeric constants captured: 276 entries** (several entries hold 2–4
related scalars — e.g. a `vec3` colour or a smoothstep band — so the raw scalar count is
approximately 430).
