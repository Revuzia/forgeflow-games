# SNOWFLOW — Sky Subsystem Implementation Spec

**Subsystem:** Nishita atmosphere · equirectangular sky LUT · SH irradiance / mip specular IBL ·
iteratively-solved snow bounce · far-range heightfield raymarched on the skybox.

**Reference source (read-only):**
- `src/render/sky.js` — CPU orchestration, LUT allocation, air-mass sun colour, the iterative solve, the SH projection.
- `src/shaders/skyBake.fragment.wgsl` — the bake pass (5 lines of logic).
- `src/shaders/lib/atmosphere.wgsl` — `nishitaSky`, lat-long mapping, runtime aerial perspective.
- `src/shaders/sky.vertex.wgsl` — skybox vertex.
- `src/shaders/sky.fragment.wgsl` — skybox fragment: LUT lookup, far range, solar disc, aureole, cirrus.
- Load-bearing dependencies read in full and transcribed here where used:
  `src/shaders/lib/ridge.wgsl` (`ridgeField` / `ridgeMarch` / `ridgeShadow`),
  `src/shaders/lib/shading.wgsl` (`wrapDiffuse`, `snowSubsurface`, `shIrradiance`),
  `src/shaders/lib/noise.wgsl` (`noised`, `fbmd`, `ridgedd`, `rot2`),
  `src/core/settings.js` (defaults), `src/core/camera.js` (near/far/fov), `src/main.js` (ordering).

**Target:** Three.js r172 / WebGL2 / hand-written GLSL 3.00 es.

**Rule for the porter:** every number below is verbatim from the reference. Where a value looks
wrong (there are two such places, both flagged **QUIRK**), reproduce it anyway — the look was tuned
around it.

---

## 0. Ten-second summary of the dataflow

```
                     sunAzimuth / sunElevation / sunIntensity / sunTempWarm  (CPU settings)
                                              |
                              [CPU] sunDir, airMass (Kasten-Young), sunRadiance, sunColor
                                              |
        +-------------------------------------+--------------------------------------+
        |                                                                            |
   groundBounce = 0                                                            (direct sun,
        |                                                                       consumed by
   +----v-------------------------------------------------------------+         every material)
   |  REPEAT 3 TIMES:                                                  |
   |    1. bake()      -> render nishitaSky into  skyLUT (512x256 RGBA16F, mips)  |
   |                   -> render nishitaSky into  shLUT  (64x32  RGBA32F, no mips)|
   |    2. projectSH() -> read back shLUT on CPU, project to 9 SH coeffs (36 f32) |
   |    3. _updateGroundBounce() -> E_up = sun*cos + SH_irradiance(up);           |
   |                                groundBounce = SNOW_ALBEDO * E_up / PI        |
   +-------------------------------------------------------------------+
        |
   final bake()  +  final projectSH()      <-- so LUT and SH agree
        |
        +--> skyLUT   -> skybox fragment (mip 0 lookup)
        |             -> ambient specular for every material (mip = sqrt(rough)*6)
        |             -> aerial-perspective inscatter for every material
        |             -> refraction "what is behind the water/ice" (below-horizon rows = snow bounce)
        +--> sh[36]   -> shIrradiance() ambient for snow, character, far range
```

Baked **once at load**, and again **only when the sun direction changes** (see §2.6 QUIRK-2).
Never per frame. Cost is irrelevant at bake time; it is not in the frame budget.

---

## 1. Conventions

### 1.1 World / angle conventions (reference)

| Thing | Convention in the reference |
|---|---|
| Handedness | Babylon default **left-handed** (`useRightHandedSystem` is never set). |
| Up axis | `+Y`. All heights, `dir.y`, `N.y` are metres / unit-Y. |
| Units | **Metres** everywhere unless stated. Angles in the settings are **degrees**; in the shaders **radians**. |
| Sun direction | Unit vector pointing **toward** the sun. |
| Camera | `minZ = 0.12`, `maxZ = 4200`, `fov = 1.02 rad` (≈ 58.44° **vertical**), inertia 0. |
| Clear colour | `(0.02, 0.03, 0.05, 1)` — never seen, the skybox covers the frame. |
| Scene lights | **None.** `scene.ambientColor = (0,0,0)`. Every material computes its own lighting. |

Sun vector from the two sliders (`sky.js:154-158`):

```js
const az = (S.sunAzimuth * Math.PI) / 180;
const el = (S.sunElevation * Math.PI) / 180;
const ce = Math.cos(el);
_dir.set(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce);
```

So azimuth 0° = `+Z`, 90° = `+X` (a compass bearing in a left-handed frame).

### 1.2 Equirectangular mapping (`atmosphere.wgsl:266-277`)

```wgsl
fn dirToLatLong(d: vec3f) -> vec2f {
    let u = atan2(d.x, d.z) / (2.0 * PI) + 0.5;
    let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2f(u, v);
}

fn latLongToDir(uv: vec2f) -> vec3f {
    let phi = (uv.x - 0.5) * 2.0 * PI;
    let theta = uv.y * PI;
    let st = sin(theta);
    return vec3f(st * sin(phi), cos(theta), st * cos(phi));
}
```

**Row convention — this is load-bearing.**
- `v = 0` ⇒ `theta = 0` ⇒ `dir = (0, +1, 0)` = **zenith**.
- `v = 1` ⇒ **nadir**.
- `v = 0.5` ⇒ mathematical horizon.
- `u` wraps: `wrapU = REPEAT`, `wrapV = CLAMP`. Azimuth 0 (`+Z`) sits at `u = 0.5`, i.e. the
  **centre column**; the wrap seam is at `u = 0/1`, which is azimuth 180° (`−Z`).

The CPU SH projection (§2.5) uses the identical mapping, so it must agree with whatever row order
the readback delivers (see PORT-6).

### 1.3 Settings defaults (`src/core/settings.js`)

These are the values the tuning was done at. Reproduce them as defaults.

| Key | Default | Slider range | Notes |
|---|---|---|---|
| `sunAzimuth` | `118` deg | 0–360 | |
| `sunElevation` | `13.0` deg | 0.5–45 | The whole look is tuned here. |
| `sunIntensity` | `4.2` | 0–10 | multiplied by `SUN_SCALE_BASE` |
| `sunTempWarm` | `1.0` | 0–1 | 0 = neutral white, 1 = full warm low-sun tint |
| `ambientIntensity` | `1.0` | 0–3 | multiplies **all** SH ambient |
| `ambientBlue` | `1.0` | 0–2 | declared but **not read by the sky** |
| `fogDensity` | `0.0072` /m | 0–0.03 | |
| `fogHeightFalloff` | `0.045` /m | 0–0.3 | ⇒ **22.22 m haze scale height** |
| `fogStart` | `24` m | — | not exposed as a slider |
| `aerialStrength` | `1.0` | 0–2 | exponent on transmittance |
| `windDirection` | `42` deg | 0–360 | cirrus streak bearing; held 70–80° off `sunAzimuth` |
| `showMountains` | `true` | bool | |
| `mountainHeight` | `2150` m | 0–2500 | fed to the shader as `ridgeAmp` |
| `shaftStrength` | `0.30` | 0–2 | light shafts, not this subsystem |
| `exposure` | `0.105` | — | post; quoted only because acceptance criteria are post-tonemap |
| `tonemap` | `"agx"` | agx/aces/none | |

---

## 2. CPU side — `class Sky` (`src/render/sky.js`)

### 2.1 Resources

```js
const LUT_W = 512;
const LUT_H = 256;
const SH_W  = 64;   // low-res copy, read back on the CPU for the SH projection
const SH_H  = 32;
const SUN_SCALE_BASE = 5.5;
```

**`this.lut` — "skyLUT"**

| Property | Value |
|---|---|
| Size | `512 × 256` |
| Format / type | `RGBA`, `TEXTURETYPE_HALF_FLOAT` ⇒ **RGBA16F** |
| Mipmaps | **yes** (`generateMipMaps: true`) |
| Filtering | `TEXTURE_TRILINEAR_SAMPLINGMODE` (linear/linear + mip linear) |
| Wrap | `wrapU = WRAP` (repeat), `wrapV = CLAMP` |
| Refresh | `refreshRate = 0` — manual, driven by `bake()` |
| Shader | `skyBake` fragment, WGSL |
| Mip chain | 512×256, 256×128, 128×64, **64×32 (mip 3)**, 32×16, 16×8, **8×4 (mip 6)**, 4×2, 2×1, 1×1 |

**`this.shLut` — "skySH"**

| Property | Value |
|---|---|
| Size | `64 × 32` = **2048 texels** |
| Format / type | `RGBA`, `TEXTURETYPE_FLOAT` ⇒ **RGBA32F** |
| Mipmaps | **no** |
| Filtering | bilinear (irrelevant — it is only ever `readPixels`'d) |
| Refresh | manual |
| Shader | **the same `skyBake` fragment** as the big LUT |

The two LUTs are byte-identical content at two resolutions. The 32-bit one exists purely so the
CPU readback has float precision for the SH fit.

**Skybox mesh**

```js
this.mesh = CreateBox("sky", { size: 2 }, scene);   // positions are ±1
this.mesh.infiniteDistance = false;                 // positioned manually in the shader
this.mesh.alwaysSelectAsActiveMesh = true;
this.mesh.isPickable = false;
this.mesh.renderingGroupId = 0;                     // drawn FIRST, before terrain (group 1)
mat.backFaceCulling = false;                        // -> THREE.DoubleSide
mat.disableDepthWrite = true;                       // -> depthWrite: false
```

Material attribute list: `position` only. Uniforms, **in the declared order**:
`viewProjection, cameraPosition, skyScale, sunDir, sunColor, sunIntensity, time, windDir,
cloudAmount, sunRadiance, shR, ambientIntensity, ridgeAmp, fogDensity, fogHeightFalloff,
fogStart, aerialStrength`. Samplers: `skyLUT`.

### 2.2 Published CPU state

| Field | Type | Meaning |
|---|---|---|
| `sunDir` | Vector3, init `(0, 0.2, 1)` | unit, **toward** the sun |
| `sunColor` | Color3, init `(1, 0.85, 0.66)` | max-channel-normalised hue of the beam |
| `sunRadiance` | Color3, init `(1,1,1)` | **direct solar irradiance at the ground, in the same units the LUT stores radiance in** |
| `sunScale` | float | `S.sunIntensity * 5.5` |
| `groundBounce` | Color3, init `(0,0,0)` | radiance leaving the snow field |
| `sh` | `Float32Array(36)` | 9 SH coefficients laid out as **vec4** (`sh[c*4+0..2]` = RGB, `sh[c*4+3]` unused/0) |

`sunRadiance` and the LUT being on **one** radiometric scale is the entire warm-light/cool-shadow
look. Do not introduce a separate "sun intensity" multiplier downstream.

### 2.3 `syncFromSettings()` — the sun's own colour

Kasten–Young air mass (stays finite at the horizon, unlike `1/cos`):

```js
const zenithDeg = (Math.acos(clamp(this.sunDir.y, -1, 1)) * 180) / Math.PI;
const denom =
    Math.cos((zenithDeg * Math.PI) / 180) +
    0.50572 * Math.pow(Math.max(1e-3, 96.07995 - zenithDeg), -1.6364);
const airMass = Math.min(denom > 0 ? 1 / denom : 40, 40);

const warm  = S.sunTempWarm;
const tauR  = [0.0464, 0.108, 0.265];   // vertical optical depth: beta * scale height
const tauM  = 0.0252;
const r = Math.exp(-(tauR[0] * warm + tauM) * airMass);
const g = Math.exp(-(tauR[1] * warm + tauM) * airMass);
const b = Math.exp(-(tauR[2] * warm + tauM) * airMass);

this.sunRadiance.set(r * this.sunScale, g * this.sunScale, b * this.sunScale);
const m = Math.max(r, Math.max(g, b)) || 1;
this.sunColor.set(r / m, g / m, b / m);
```

Notes:
- `tauR` is **Rayleigh vertical optical depth**, i.e. `BETA_R × H_RAYLEIGH` — check:
  `5.8e-6 × 8000 = 0.0464` ✓, `13.5e-6 × 8000 = 0.108` ✓, `33.1e-6 × 8000 = 0.2648 ≈ 0.265` ✓.
  `tauM = 21e-6 × 1200 = 0.0252` ✓. So the CPU beam attenuation is exactly consistent with the
  shader's scattering coefficients.
- `sunTempWarm` scales **only** the Rayleigh part, so 0 gives a neutral beam that still loses
  energy to Mie.
- Dirtiness is set **only** if `sunDir` moved by more than `1e-6` in any component.

### 2.4 `solve()` — the iteratively-solved snow bounce

```js
async solve() {
    this.syncFromSettings();
    await whenReady(this.lut, "skyLUT");     // 25 s timeout -> "almost always a WGSL compile error"
    await whenReady(this.shLut, "skySH");
    this._dirty = false;

    this.groundBounce.set(0, 0, 0);
    for (let i = 0; i < 3; i++) {
        this.bake();
        await this.projectSH();
        this._updateGroundBounce();
    }
    // Final bake so the LUT reflects the converged bounce, then one last
    // projection so the SH the shader uses matches the LUT it samples.
    this.bake();
    await this.projectSH();
}
```

**Iteration count: exactly 3, plus a 4th bake and a 4th SH projection.**
So the LUT is rendered **4 times** and the SH projected **4 times** per solve. The loop converges
in three passes because each round trip is multiplied by the ~0.87 mean albedo.

Bake uniform upload (both LUTs, same values):

```js
bake() {
    for (const t of [this.lut, this.shLut]) {
        t.setVector3("sunDir",       this.sunDir);
        t.setFloat  ("sunIntensity", this.sunScale);   // NOTE: the *scale*, not S.sunIntensity
        t.setColor3 ("groundBounce", this.groundBounce);
        t.render();
    }
}
```

**Ground bounce** (`_updateGroundBounce`):

```js
const up = this._irradianceUp();          // SH irradiance for n = (0,1,0)
const c  = Math.max(0, this.sunDir.y);    // cosine on horizontal ground
const er = this.sunRadiance.r * c + up[0];
const eg = this.sunRadiance.g * c + up[1];
const eb = this.sunRadiance.b * c + up[2];

const k = 1 / Math.PI;                    // Lambertian re-emission L = albedo * E / PI
this.groundBounce.set(
    SNOW_ALBEDO[0] * er * k,
    SNOW_ALBEDO[1] * eg * k,
    SNOW_ALBEDO[2] * eb * k
);
```

```js
/** Fresh snow reflects most of what hits it, slightly more at the blue end. */
const SNOW_ALBEDO = [0.83, 0.86, 0.91];
```

The bounce albedo is **blue-weighted** — 0.83 / 0.86 / 0.91. This is why the light coming back up
off the field is slightly cooler than the light going down onto it, and it compounds over the three
iterations.

`_irradianceUp()` is exactly `shIrradiance((0,1,0))` unrolled — only the bands that survive:

```js
out[k] = sh[0*4 + k] * 0.886227
       + sh[1*4 + k] * 2 * 0.511664
       + sh[6*4 + k] * -0.247708
       + sh[8*4 + k] * -0.429043;
```

(Verify against §6.3: `c4=0.886227`, `2·c2=1.023328`, `−c5=−0.247708`, `−c1=−0.429043`. ✓)

### 2.5 `projectSH()` — CPU SH projection

Done on the CPU rather than the GPU because it is a one-off reduction over **2048 texels** and the
coefficients have to reach a uniform buffer anyway.

```js
const data = await this.shLut.readPixels(0, 0);   // Float32Array, RGBA, 64*32*4
const px = data;
sh.fill(0);

// Each texel subtends dω = sinθ · (2π/W) · (π/H).
const dOmega = ((2 * Math.PI) / SH_W) * (Math.PI / SH_H);   // = 0.00963829 sr

for (let y = 0; y < SH_H; y++) {
    const theta = ((y + 0.5) / SH_H) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    const w  = st * dOmega;

    for (let x = 0; x < SH_W; x++) {
        const phi = ((x + 0.5) / SH_W - 0.5) * 2 * Math.PI;
        const dx = st * Math.sin(phi);
        const dy = ct;
        const dz = st * Math.cos(phi);

        // Real SH basis, bands 0..2.
        Y[0] = 0.282095;
        Y[1] = 0.488603 * dy;
        Y[2] = 0.488603 * dz;
        Y[3] = 0.488603 * dx;
        Y[4] = 1.092548 * dx * dy;
        Y[5] = 1.092548 * dy * dz;
        Y[6] = 0.315392 * (3 * dz * dz - 1);
        Y[7] = 1.092548 * dx * dz;
        Y[8] = 0.546274 * (dx * dx - dy * dy);

        const i = (y * SH_W + x) * 4;
        const r = px[i]     * w;
        const g = px[i + 1] * w;
        const b = px[i + 2] * w;

        for (let c = 0; c < 9; c++) {
            sh[c * 4]     += r * Y[c];
            sh[c * 4 + 1] += g * Y[c];
            sh[c * 4 + 2] += b * Y[c];
        }
    }
}
```

**Direction reconstruction is identical to `latLongToDir`** with `uv = ((x+0.5)/W, (y+0.5)/H)`:
`dx = sinθ·sinφ`, `dy = cosθ`, `dz = sinθ·cosφ`. Row `y = 0` is the **zenith** row.

**Basis-axis note (do not "fix" this).** The band-2 quadratics use `dz` as the polar axis
(`Y[6] = 0.315392(3z²−1)`, `Y[8] = 0.546274(x²−y²)`) while the world's up axis is `y`. That is the
textbook Ramamoorthi–Hanrahan listing verbatim, and the evaluation in `shIrradiance` uses the
matching convention, so projection and reconstruction are self-consistent. Changing one without the
other rotates the ambient by 90°.

**No solar disc in the LUT.** `skyBake.fragment.wgsl` writes only `nishitaSky(...)`. The disc and
aureole are added *afterwards*, in the sky material only:

```wgsl
// The solar disc itself. Kept out of nishitaSky so the IBL projection can
// use the same LUT without a 100,000x spike blowing out the SH fit.
```

Consequence: **SH irradiance and mip specular contain sky + ground bounce only, never the sun.**
Direct sun is applied separately by every material from `sunRadiance`.

### 2.6 `update()` — per-frame gate

```js
update() {
    this.syncFromSettings();
    if (!this._dirty) return false;
    if (!this.lut.isReady() || !this.shLut.isReady()) return false;
    this._dirty = false;
    this.solve();      // NOT awaited — settles over the next few frames
    return true;
}
```

> **QUIRK-1 (reproduce or fix deliberately).** `_dirty` is set **only** when `sunDir` changes.
> Moving the `sunIntensity` or `sunTempWarm` sliders updates `sunRadiance` / `sunColor` / `sunScale`
> immediately but does **not** rebake the LUT, so the sky keeps the old scale until the sun
> direction next moves. No `onChange` listener anywhere marks the sky dirty
> (verified: `grep -rn "_dirty\|onChange" src/ui/*.js src/render/sky.js src/main.js` — the only
> `onChange` registrations are `resolutionScale`, `showTerrain`, `showCharacter`, `showWake`).

### 2.7 `render(rig, time)` — per-frame uniform publication

```js
const a = (S.windDirection * Math.PI) / 180;
_wind.set(Math.sin(a), Math.cos(a));

m.setVector3("cameraPosition", rig.camera.position);
m.setFloat  ("skyScale",       rig.camera.maxZ * 0.5);   // 4200 * 0.5 = 2100 m
m.setVector3("sunDir",         this.sunDir);
m.setColor3 ("sunColor",       this.sunColor);
m.setFloat  ("sunIntensity",   this.sunScale);           // 23.1 at defaults
m.setFloat  ("time",           time);
m.setVector2("windDir",        _wind);
m.setFloat  ("cloudAmount",    0.55);                    // HARD-CODED, not a setting

m.setColor3 ("sunRadiance",    this.sunRadiance);
m.setArray4 ("shR",            this.sh);                 // 36 floats -> array<vec4f,9>
m.setFloat  ("ambientIntensity", S.ambientIntensity);
m.setFloat  ("ridgeAmp",       S.showMountains ? S.mountainHeight : 0);

m.setFloat  ("fogDensity",       S.fogDensity);
m.setFloat  ("fogHeightFalloff", S.fogHeightFalloff);
m.setFloat  ("fogStart",         S.fogStart);
m.setFloat  ("aerialStrength",   S.aerialStrength);
```

Frame order in `main.js` (must be preserved):
`post.update()` → **`sky.update()`** → **`sky.render()`** → `shadows.update()` → `spells.update()`
→ `terrain.update()` → `figure.sync()` → `wake.update()` → `spray.update()` → `scene.render()`.

At load: `sky = new Sky(scene)` → `sky.mesh.renderingGroupId = 0` → **`await sky.solve()`** before
anything else is constructed, because the terrain, character, wake, spray, water and crystal
materials all take `sky.lut` and `sky.sh` as inputs.

---

## 3. The bake pass — `skyBake.fragment.wgsl` (verbatim, whole file)

```wgsl
// Bakes the atmospheric scattering integral into an equirectangular LUT.
// Re-run only when the sun moves, never per frame.

#include<snowNoise>
#include<snowAtmosphere>

varying vUV: vec2f;

uniform sunDir: vec3f;
uniform sunIntensity: f32;
uniform groundBounce: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let dir = latLongToDir(input.vUV);
    var col = nishitaSky(dir, uniforms.sunDir, uniforms.sunIntensity, uniforms.groundBounce);

    // The solar disc itself. Kept out of nishitaSky so the IBL projection can
    // use the same LUT without a 100,000x spike blowing out the SH fit.
    fragmentOutputs.color = vec4f(col, 1.0);
}
```

That is the entire pass. `vUV` is the Babylon procedural-texture full-screen quad's 0..1 UV.
`.a` is written as `1.0` and is never read.

---

## 4. `nishitaSky` — the single-scattering integral

### 4.1 Constants (`atmosphere.wgsl:19-32`)

```wgsl
const EARTH_R: f32 = 6360000.0;     // m
const ATMOS_R: f32 = 6420000.0;     // m  (60 km shell)
const H_RAYLEIGH: f32 = 8000.0;     // m  scale height
const H_MIE: f32 = 1200.0;          // m  scale height

// Sea-level scattering coefficients, per metre.
const BETA_R: vec3f = vec3f(5.8e-6, 13.5e-6, 33.1e-6);
const BETA_M: vec3f = vec3f(21e-6, 21e-6, 21e-6);
const MIE_G: f32 = 0.76;

/// Strength of the isotropic multiple-scattering approximation, relative to
/// single-scattered Rayleigh. Tuned so the diffuse sky irradiance lands near
/// 15% of direct-normal solar, which is where a real clear sky sits.
const MS_BOOST: f32 = 1.5;
```

Per-invocation constants:

```wgsl
const STEPS: i32 = 32;
const LIGHT_STEPS: i32 = 8;
const DIST_POWER: f32 = 2.5;
const SHADOW_FILL: f32 = 0.5;
```

Observer altitude: **800 m** — `let origin = vec3f(0.0, EARTH_R + 800.0, 0.0);`
"Stand just above the surface so the horizon resolves cleanly."
Derived: geometric horizon dip = `acos(R/(R+h)) = 0.9086°`, i.e. **`dir.y = −0.015857`**.

### 4.2 Helpers

```wgsl
/// Distance to the far intersection of a ray with a sphere centred on the
/// origin. Returns -1 when the ray misses.
fn raySphereFar(origin: vec3f, dir: vec3f, radius: f32) -> f32 {
    let b = dot(origin, dir);
    let c = dot(origin, origin) - radius * radius;
    let d = b * b - c;
    if (d < 0.0) { return -1.0; }
    return -b + sqrt(d);
}

fn phaseRayleigh(mu: f32) -> f32 {
    return (3.0 / (16.0 * PI)) * (1.0 + mu * mu);
}

fn phaseMie(mu: f32, g: f32) -> f32 {
    let g2 = g * g;
    let n = (1.0 - g2) * (1.0 + mu * mu);
    let d = (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5);
    return (3.0 / (8.0 * PI)) * n / d;
}
```

`raySphereFar` assumes a **unit-length** `dir` (no `a` term). Both callers pass normalised vectors.

Derived phase values (useful as unit tests):
`phaseRayleigh(1) = 0.238732`, `phaseRayleigh(0) = 0.119366`;
`phaseMie(1, 0.76) = 2.8299`, `phaseMie(−1, 0.76) = 0.007176`;
`phaseMie(1, 0.62) = 1.1233`, `phaseMie(−1, 0.62) = 0.014497` (ratio **77×**).

### 4.3 Ray setup and clipping

```wgsl
let atmosDist = raySphereFar(origin, rayDir, ATMOS_R);
if (atmosDist < 0.0) { return vec3f(0.0); }

// Rays heading into the planet are clipped at the surface, which is what
// produces the dark, dense band right below the horizon.
let groundDist = raySphereFar(origin, rayDir, EARTH_R);
let bIn = dot(origin, rayDir);
let cIn = dot(origin, origin) - EARTH_R * EARTH_R;
let discr = bIn * bIn - cIn;
var march = atmosDist;
if (discr > 0.0) {
    let near = -bIn - sqrt(discr);
    if (near > 0.0) { march = near; }
}
```

`discr > 0 && groundDist > 0` is the exact test for "this ray hits the planet ahead of the
observer", used again for the ground-bounce handover. (From outside the sphere, `c > 0`, so an
upward ray has both roots negative and `groundDist < 0`.)

### 4.4 The power-law view march — **the single most important line in the integral**

```wgsl
var tPrev = 0.0;
for (var i = 0; i < STEPS; i++) {
    let tNext = march * pow(f32(i + 1) / f32(STEPS), DIST_POWER);
    let stepLen = tNext - tPrev;
    let p = origin + rayDir * (tPrev + stepLen * 0.5);   // midpoint
    tPrev = tNext;
    let h = length(p) - EARTH_R;

    let dR = exp(-h / H_RAYLEIGH) * stepLen;
    let dM = exp(-h / H_MIE) * stepLen;
    odR += dR;
    odM += dM;
    ...
}
```

Rationale, transcribed because it is the design:

> Density falls off exponentially with height, so almost all of the scattering along any ray
> happens in the first few kilometres. A uniform march does not know that, and near the horizon it
> fails outright: a ray at zero elevation travels roughly 450 km before it leaves the atmosphere, so
> sixteen even steps put the *first* sample 14 km out and 15 km up — past essentially all of the air
> that matters. […] Measured off a readback of the LUT along the anti-sun azimuth: **1.86 at +3.5
> degrees, 0.84 at 0, 1.29 at −0.5.** […] `t^2.5` puts the first of thirty-two samples 60 m out on
> that same grazing ray and still reaches the top of the atmosphere. Steps are integrated over their
> true width rather than a constant, so the quadrature stays correct.

Three properties the port must preserve:
1. Sample **positions** are `t_i = march · ((i+1)/32)^2.5`, but the sample **point** is the segment
   **midpoint** `t_{i-1} + (t_i − t_{i-1})/2`.
2. `stepLen` is the **true width** of the segment, and both the optical-depth accumulation and the
   scattering weight use it. Using a constant `march/32` is wrong.
3. `odR`/`odM` accumulate *before* the light march, so the sample's own segment is included in the
   view-path extinction — a half-step bias that is part of the tuned result.

### 4.5 The light march (toward the sun)

```wgsl
let lightDist = raySphereFar(p, sunDir, ATMOS_R);
let lStep = lightDist / f32(LIGHT_STEPS);
var lR = 0.0;
var lM = 0.0;
var occluded = false;

for (var j = 0; j < LIGHT_STEPS; j++) {
    let lp = p + sunDir * (lStep * (f32(j) + 0.5));
    let lh = length(lp) - EARTH_R;
    if (lh < 0.0) { occluded = true; break; }
    lR += exp(-lh / H_RAYLEIGH) * lStep;
    lM += exp(-lh / H_MIE) * lStep;
}
```

**8 uniform steps**, midpoint-sampled (`j + 0.5`). No power law here. A sample whose sun ray dips
below the surface is flagged `occluded` and **breaks immediately** (partial `lR`/`lM` discarded).

### 4.6 Accumulation, including the shadowed samples

```wgsl
if (occluded) {
    // Not thrown away. This sample sits in the planet's own shadow, so
    // it receives no direct sun — but it is still inside a lit
    // atmosphere, and multiply-scattered light reaches it. Attenuate
    // along the *view* path only and keep it for the isotropic pass.
    let attenV = exp(-(BETA_R * odR + BETA_M * 1.1 * odM));
    shadR += attenV * dR;
    shadM += attenV * dM;
    continue;
}

let tau = BETA_R * (odR + lR) + BETA_M * 1.1 * (odM + lM);
let atten = exp(-tau);
sumR += atten * dR;
sumM += atten * dM;
```

Note the **`1.1` Mie extinction factor** — Mie *extinction* is 1.1 × Mie *scattering*, a stand-in
for absorption in the aerosol. It appears in both the shadowed and lit branches, and **only** in
optical depth, never in the scattering weight.

Four accumulators, all `vec3f`: `sumR`, `sumM` (lit) and `shadR`, `shadM` (planet-shadowed).

### 4.7 Single scattering

```wgsl
var col = sunIntensity * (sumR * BETA_R * pr + sumM * BETA_M * pm);
```

with `pr = phaseRayleigh(mu)`, `pm = phaseMie(mu, MIE_G)`, `mu = dot(rayDir, sunDir)` — computed
**once per pixel**, outside the loop.

### 4.8 The multiple-scattering approximation

```wgsl
const SHADOW_FILL: f32 = 0.5;
let msPhase = 1.0 / (4.0 * PI);
col += sunIntensity * (
          (sumR + shadR * SHADOW_FILL) * BETA_R * MS_BOOST
        + (sumM + shadM * SHADOW_FILL) * BETA_M * 0.4
      ) * msPhase;
```

- **Isotropic** (`1/4π`), reusing the same optical depths — no second integration.
- Rayleigh gets `MS_BOOST = 1.5`; Mie gets `0.4`.
- Planet-shadowed samples enter **here and nowhere else**, at **half weight** (`SHADOW_FILL = 0.5`),
  because "it is scattered light arriving indirectly, not a second sun."

Design notes, transcribed:

> Single scattering alone underestimates a clear sky by roughly a factor of three, and it
> underestimates blue the most […] Left uncorrected the sky is too dim to fill shadows, the warm
> ground bounce wins the ambient, and snow shadows come out beige instead of blue — which is the
> opposite of the whole look.

> The shadowed samples enter *here* and nowhere else, and leaving them out entirely is what drew a
> dark band across the sky a degree or two above the horizon on the anti-sun side. At a 13-degree
> sun most of a grazing path in that direction lies in the planet's own shadow […] Real skies do
> darken there (it is the base of the Earth's shadow) but they darken *smoothly*.

### 4.9 The snow-bounce handover below the horizon

```wgsl
if (discr > 0.0 && groundDist > 0.0) {
    // Ascending edges: smoothstep is undefined when edge0 > edge1.
    let downT = 1.0 - smoothstep(-0.030, -0.005, rayDir.y);
    col = mix(col, groundBounce, downT);
}
```

- `rayDir.y ≥ −0.005` (−0.287°) ⇒ pure atmosphere.
- `rayDir.y ≤ −0.030` (−1.719°) ⇒ pure `groundBounce`.
- The geometric horizon (§4.1) is at `−0.909°`, roughly centred in that band.
- **Band width ≈ 1.43°.** The comment insists on this being *fast*: run it wider and the band holds
  mostly the clipped march, which is dark for an artefactual reason (a ray angled into the planet is
  cut short and accumulates almost no single scattering).

Why this matters far beyond the skybox:

> Snow reflects ~85% of what lands on it, so in a snow field the ground is one of the brightest
> sources in the scene, and it is what fills shadows with bright blue-white light instead of leaving
> them black. Omitting it — as a naive sky model does — is precisely why untuned snow renders come
> out with dead, crushed shadows.

The below-horizon rows are also what `crystal.fragment.wgsl` and `water.fragment.wgsl` sample along
a refracted ray: "one lookup along the refracted ray is a physically-derived estimate of what is
behind the water in any direction" — **no scene copy, no second opaque pass**.

### 4.10 Grazing desaturation — the optically thick horizon

```wgsl
let grazing = 1.0 - smoothstep(0.0, 0.26, abs(rayDir.y));
let pale = dot(col, vec3f(0.30, 0.42, 0.28));
col = mix(col, vec3f(pale) * vec3f(0.97, 1.0, 1.06), grazing * 0.82);
```

- Applied **symmetrically** about the horizon (`abs(rayDir.y)`), so it also whitens the top of the
  ground-bounce band.
- Full strength at `|dir.y| = 0`, off at `|dir.y| = 0.26` (**15.07°**).
- Max blend is **0.82**, not 1.0.
- The luminance weights `(0.30, 0.42, 0.28)` are **not** Rec.709 — they are hand-tuned and sum to
  1.00. The result is then tinted `(0.97, 1.0, 1.06)`, i.e. **slightly cool**.
- Widened/strengthened from an earlier `0.20 / 0.62` once the aerial perspective started converging
  distant surfaces onto this band.
- The sun's warmth is untouched: disc, aureole and forward lobe are all added **after** this LUT.

Purpose, verbatim: single scattering treats a hundred-kilometre horizontal path as a coloured filter
and produces "a saturated olive band"; a path that thick "is not a filter, it is fog", so the last
dozen degrees are pulled toward their own luminance.

### 4.11 Full control flow, in order

1. `origin = (0, EARTH_R + 800, 0)`.
2. `atmosDist`; early-out to black if the ray misses the atmosphere shell.
3. Ground intersection test → clip `march` to the near root when the ray hits the planet.
4. `mu`, `pr`, `pm` — once.
5. 32-step power-law view march (§4.4); per sample: densities → `odR/odM` → 8-step light march →
   lit or shadowed accumulation.
6. Single scattering (§4.7).
7. Multiple scattering, isotropic, with half-weight shadowed samples (§4.8).
8. Ground-bounce handover below the horizon (§4.9).
9. Grazing desaturation (§4.10).
10. Return. (Solar disc is **not** added here.)

---

## 5. Skybox draw

### 5.1 Vertex — `sky.vertex.wgsl` (verbatim, whole file)

```wgsl
// Skybox. Drawn as a unit cube pinned to the camera, depth-clamped to the far
// plane so it fills exactly whatever the terrain does not.

attribute position: vec3f;

uniform viewProjection: mat4x4f;
uniform cameraPosition: vec3f;
uniform skyScale: f32;

varying vDir: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let world = vertexInputs.position * uniforms.skyScale + uniforms.cameraPosition;
    vertexOutputs.vDir = vertexInputs.position;

    var clip = uniforms.viewProjection * vec4f(world, 1.0);
    // Force to the far plane (reversed-Z would flip this; Babylon is not).
    clip.z = clip.w * 0.999999;
    vertexOutputs.position = clip;
}
```

- Box `size: 2` ⇒ positions are exactly `±1`, so `vDir` is a raw cube direction (**not**
  normalised — the fragment normalises it). At `skyScale = 2100` the cube half-extent is 2100 m,
  well inside `maxZ = 4200`, and the depth clamp is what actually parks it at the far plane.
- `renderingGroupId = 0` ⇒ drawn before the terrain (group 1); `depthWrite = false`; double-sided.

### 5.2 Fragment — base lookup

```wgsl
let dir = normalize(input.vDir);
let uv = dirToLatLong(dir);
var col = textureSampleLevel(skyLUT, skyLUTSampler, uv, 0.0).rgb;
```

**Mip 0, no tilt.** `aerialInscatterSky`'s `exact` term must match this call **exactly** or "fully
hazed" and "sky" are two different colours (§7.2).

### 5.3 Far range — the gate

```wgsl
if (uniforms.ridgeAmp > 1.0 && dir.y < 0.230 && dir.y > -0.050) {
    let hit = ridgeMarch(uniforms.cameraPosition, dir, uniforms.ridgeAmp);
    if (hit.hit) {
        col = shadeRidge(hit, dir);
    }
}
```

- `dir.y < 0.230` ⇒ **+13.29°** — an upper bound only to skip the call; the march's own ceiling test
  rejects above the band anyway.
- `dir.y > -0.050` ⇒ **−2.87°** — deliberately **below** the horizon:

  > Fading the range out at a fixed elevation angle drew a dead straight horizontal line under the
  > whole massif — a ruler across the frame […] the clipmap is drawn *after* the sky and covers
  > everything below its own silhouette, so letting the range paint down past the horizon lets the
  > near dunes occlude it exactly where they actually stand. A ray at −0.05 from eye height meets the
  > ground inside eighty metres.

### 5.4 Solar disc + aureole

```wgsl
let mu = dot(dir, uniforms.sunDir);
let discCos = cos(0.0046);
if (mu > discCos) {
    let r = sqrt(max(0.0, 1.0 - mu * mu)) / 0.0046;
    let limb = pow(max(0.0, 1.0 - r * r * 0.72), 0.42);
    col += uniforms.sunColor * uniforms.sunIntensity * 42.0 * limb;
}
let aureole = pow(max(0.0, mu), 1400.0) * 5.5 + pow(max(0.0, mu), 64.0) * 0.28;
col += uniforms.sunColor * uniforms.sunIntensity * aureole * 0.5;
```

- Angular **radius** `0.0046 rad = 0.2636°` ⇒ **diameter 0.527°** ("~0.53 degrees across").
- `r` is the normalised radius within the disc (0 at centre, 1 at limb).
- Limb darkening: `(1 − 0.72 r²)^0.42`. At the limb (`r=1`) this is `0.28^0.42 = 0.5866`, so the
  edge is ~59% of centre — a **visible, soft-edged** disc, not a flat white dot.
- Disc gain **42.0**; at defaults the disc centre adds `sunColor × 23.1 × 42 = (970, 741, 374)`.
- Aureole is two lobes multiplied by `sunIntensity × 0.5`:
  - `mu^1400 × 5.5` — half-max at **1.80°** from the sun.
  - `mu^64 × 0.28` — half-max at **8.42°**.
- Uses `sunColor` (normalised hue), **not** `sunRadiance`.
- The aureole is added over the **whole hemisphere** the sun is in (no gate), including where the
  range was just drawn — so a massif in front of the sun still picks up glow.

### 5.5 Cirrus

```wgsl
if (uniforms.cloudAmount > 0.001 && dir.y > 0.0) {
    // Project onto a high plane so bands converge at the horizon.
    let planeY = 1.0 / max(0.06, dir.y);
    var cp = dir.xz * planeY * 0.5 + uniforms.windDir * uniforms.time * 0.004;

    // Stretch across the wind so the streaks run with it.
    let a = atan2(uniforms.windDir.x, uniforms.windDir.y);
    cp = rot2(a) * cp;
    cp.x *= 0.28;

    let n = fbmd(cp, 4, 2.13, 0.52).x;
    var cloud = smoothstep(0.06, 0.34, n);
    // Fade out at the horizon and at the zenith.
    cloud *= smoothstep(0.0, 0.22, dir.y) * (1.0 - smoothstep(0.55, 1.0, dir.y) * 0.45);
    cloud *= uniforms.cloudAmount;

    // Lit from below-ish by a low sun, so the underside catches warmth.
    let sunLit = pow(max(0.0, mu * 0.5 + 0.5), 3.0);
    let cloudCol = mix(vec3f(0.52, 0.60, 0.74), uniforms.sunColor * 1.35, sunLit * 0.75);
    col = mix(col, cloudCol * (0.55 + uniforms.sunIntensity * 0.06), cloud * 0.62);
}
```

- `cloudAmount` is hard-coded to **0.55** by `sky.render()`.
- `windDir = (sin(windDirection), cos(windDirection))`; default 42° ⇒ `(0.66913, 0.74314)`.
- Only 4 fBm octaves, lacunarity **2.13**, gain **0.52**.
- Max blend is `0.62 × cloudAmount × …` — restrained by design:
  "clouds here exist to stop the upper sky from being a flat wash, not to become subject matter."
- Drawn **after** the disc/aureole, so a cloud can dim the sun; drawn **after** the range, so a
  cloud can drift in front of a peak.

---

## 6. Shared shading functions the sky depends on

### 6.1 `wrapDiffuse` (`shading.wgsl:51-54`)

```wgsl
fn wrapDiffuse(NdotL: f32, w: f32) -> f32 {
    let denom = (1.0 + w) * (1.0 + w);
    return max(0.0, (NdotL + w) / denom);
}
```

### 6.2 `snowSubsurface` (`shading.wgsl:67-106`)

```wgsl
fn backScatter(N: vec3f, L: vec3f, V: vec3f, distortion: f32, power: f32, thickness: f32) -> f32 {
    let H = normalize(L + N * distortion);
    let vh = pow(clamp(dot(V, -H), 0.0, 1.0), power);
    return vh * thickness;
}

fn snowSubsurface(N, L, V, lightColor: vec3f, thickness: f32, strength: f32, radius: f32) -> vec3f {
    let shallowTint = vec3f(0.94, 0.965, 1.0);
    let deepTint    = vec3f(0.55, 0.72, 1.0);
    let tint = mix(shallowTint, deepTint, clamp(thickness * radius, 0.0, 1.0));

    let back = backScatter(
        N, L, V, 0.28 * radius,
        mix(3.0, 9.0, thickness),      // lobe power: THIN = broad (3), DEEP = tight (9)
        mix(1.0, 0.30, thickness)      // amplitude:  THIN = bright (1), DEEP = dim (0.30)
    );

    return lightColor * tint * back * strength;
}
```

**Sign is critical.** `L` points from the surface *toward* the sun; the lobe is measured against
`-H`. Building `H` from `-L` inverts the whole term — it would then peak with the sun behind the
camera, which is exactly backwards.

### 6.3 `shIrradiance` (`shading.wgsl:323-340`)

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

This is a **radiance-scaled irradiance**: callers multiply by `albedo * INV_PI`, so the `1/π`
Lambert factor is applied at the call site, not here.

### 6.4 Noise functions consumed (`noise.wgsl`)

```wgsl
const PI: f32 = 3.14159265359;

fn hash21(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn grad2(i: vec2f) -> vec2f {
    let a = hash21(i) * 6.28318530718;
    return vec2f(cos(a), sin(a));
}

fn rot2(a: f32) -> mat2x2f {
    let c = cos(a);
    let s = sin(a);
    return mat2x2f(c, -s, s, c);   // column-major: col0=(c,-s), col1=(s,c)
}
```

`noised(p)` — IQ analytic-derivative gradient noise, quintic fade:
`u = f³(f(6f−15)+10)`, `du = 30f²(f(f−2)+1)`; corner gradients from `grad2(i + {00,10,01,11})`;
returns `vec3f(value, d/dx, d/dy)`, value range roughly `[-1, 1]`.

`fbmd(p, octaves, lacunarity, gain)` — start amplitude **0.5**, start frequency **1.0**, per-octave
domain rotation **`rot2(0.517)`**, derivatives chain-ruled through the accumulated rotation
(`deriv += amp * freq * (n.yz * xform)`).

`ridgedd(p, octaves, lacunarity, gain)` — start amplitude **0.5**, per-octave rotation
**`rot2(0.717)`**, octave term `r = 1 − |n|`, `r2 = r²`, `dr2 = −2·r·sign(n)`, coupled across
octaves by `prev = mix(1.0, r2, 0.65)`.

---

## 7. Runtime aerial perspective (`atmosphere.wgsl:284-404`)

Not part of the bake, but the far range and the snow field **must** use the identical functions or
they will not meet at one colour.

### 7.1 `aerialTransmittance`

```wgsl
fn aerialTransmittance(camPos, worldPos, density, heightFalloff, fogStart) -> f32 {
    let d = worldPos - camPos;
    let dist = max(0.0, length(d) - fogStart);
    if (dist <= 0.0) { return 1.0; }

    let dy = d.y;
    var integral: f32;
    if (abs(dy) < 0.01) {
        integral = exp(-heightFalloff * camPos.y) * dist;
    } else {
        // ∫ exp(-k*y(t)) dt along the ray, closed form.
        let k = heightFalloff;
        integral = (exp(-k * camPos.y) - exp(-k * worldPos.y)) / (k * dy) * length(d);
        integral = integral * (dist / max(1e-4, length(d)));
    }

    return exp(-density * max(0.0, integral));
}
```

At defaults: `heightFalloff = 0.045` ⇒ **22.22 m scale height**; `density = 0.0072`;
`fogStart = 24 m`. Quoted consequences from `sky.fragment.wgsl`:

> a summit at two kilometres sits almost entirely clear of it while its own feet are buried. On the
> current settings a 2 km peak keeps about two thirds of its contrast at 9 km and a fifth at 35 km,
> and anything below ~300 m is gone by 8 km — peaks emerging from a sea of haze, on the same curve
> the dunes 600 m away are already on.

### 7.2 `aerialNearSky` and `aerialInscatterSky`

```wgsl
fn aerialNearSky(tex, samp, viewDir: vec3f) -> vec3f {
    let d = normalize(viewDir + vec3f(0.0, 0.42, 0.0));
    return textureSampleLevel(tex, samp, dirToLatLong(d), 3.0).rgb;
}

fn aerialInscatterSky(tex, samp, viewDir, sunDir, sunColor, ext: f32) -> vec3f {
    // Mip 0 and no tilt: this has to match `sky.fragment.wgsl`'s own lookup
    // exactly, or "fully hazed" and "sky" are two different colours again.
    let exact = textureSampleLevel(tex, samp, dirToLatLong(normalize(viewDir)), 0.0).rgb;

    let mu = dot(viewDir, sunDir);
    let fwd = phaseMie(mu, 0.62) * 5.5;
    let near = aerialNearSky(tex, samp, viewDir) + sunColor * fwd * 0.16;

    // Ramps across roughly 100 m to 700 m on the current fog settings.
    return mix(near, exact, smoothstep(0.55, 0.995, ext));
}

fn applyAerial(color, camPos, worldPos, viewDir, sunDir, skyTex, skySamp, sunColor,
               density, heightFalloff, fogStart, strength) -> vec3f {
    let t = aerialTransmittance(camPos, worldPos, density, heightFalloff, fogStart);
    let ext = clamp(1.0 - pow(t, strength), 0.0, 1.0);
    let inscatter = aerialInscatterSky(skyTex, skySamp, viewDir, sunDir, sunColor, ext);
    return mix(color, inscatter, ext);
}
```

Three things that are easy to get wrong and all documented as past bugs:

1. **Near-field lookup is tilted up by `+0.42` in Y and read at mip 3.** "What actually fills a
   short path is the whole sky hemisphere, and that is dominated by the bright cool dome overhead
   rather than by the band at eye level." Using the horizon band for a 300 m path "paints the middle
   distance with a sunset it is three orders of magnitude too short to have earned."
2. **The far-field lookup is the *exact* sky pixel, mip 0, untilted.** "At full extinction a hazed
   surface and the sky pixel beside it are then the same number, and there is nothing left to draw
   an edge."
3. **The forward lobe is inside the crossfade, not added on top.** Crossfading only the two lookups
   and leaving the lobe at full strength "turned the shelf into a wall: a saturated bank of haze,
   hard-topped, brighter and warmer than the sky above it."

> **QUIRK-2 (reproduce).** The parameter is named `sunColor`, but **every** call site passes
> `sunRadiance` (verified in `sky.fragment.wgsl:127`, `snow.fragment.wgsl:517`,
> `char.fragment.wgsl:322`, `fur.fragment.wgsl:126`, `spray.fragment.wgsl:143`,
> `wake.fragment.wgsl:275`, `water.fragment.wgsl:352`). At defaults that is `(16.90, 12.91, 6.51)`,
> not the normalised `(1.0, 0.764, 0.385)` — a factor of ~23. Passing the normalised colour instead
> would make sun-facing haze ~23× dimmer.

Derived magnitudes at defaults: forward-lobe term = `sunRadiance × phaseMie(mu, 0.62) × 5.5 × 0.16`
⇒ **`(16.7, 12.8, 6.4)` looking straight at the sun**, **`(0.216, 0.165, 0.083)` looking away**.

---

## 8. The far range — heightfield raymarched on the skybox

Design constraint, transcribed:

> A silhouette cut out of the sky reads as a sticker. A band of noise shaded by its own azimuth
> gradient reads as corrugated cardboard, because a ridge's *form* comes from slopes facing toward
> and away from the sun, and a one-dimensional profile has no such thing.

Range extent: **5.5 km to ~40 km** (the schedule is anchored on 45 km but never reaches it — §8.4),
well beyond the 870 m clipmap, so it can never intersect the terrain. The player is confined to a
**620 m** play radius.

### 8.1 `ridgeCeiling` and `ridgeDrop`

```wgsl
fn ridgeCeiling(amp: f32) -> f32 { return amp * 1.05; }

/// Earth curvature drop at a horizontal distance, metres.
fn ridgeDrop(d: f32) -> f32 { return d * d / 12742000.0; }
```

At `amp = 2150` the ceiling is **2257.5 m**. `ridgeDrop` = 50 m at 25 km, 2.4 m at 5.5 km,
126 m at 40 km. It "sinks the farthest massifs' feet below the horizon and lets the near ones stand
in front of them."

### 8.2 `ridgeField` — height + analytic gradient (verbatim, annotated)

Returns `vec3f(height_metres, dH/dx, dH/dz)`.

```wgsl
fn ridgeField(p: vec2f, amp: f32) -> vec3f {
    // Kilometres. The whole range is authored at this scale.
    let q = p * 0.001;
    let kq = 0.001;                       // d(km)/d(m), for chain rule
```

**(a) The bowl** — an empty disc around the origin. *"This is not decoration, it is what makes the
march correct."* Without it a massif can start closer than the near plane, the ray begins inside the
rock, every such ray clamps to the same distance, and the near faces draw as flat-topped vertical
slabs — "buildings on the horizon."

```wgsl
    let rad = length(p);
    let bt = clamp((rad - 7000.0) / 6000.0, 0.0, 1.0);
    let bowl = bt * bt * (3.0 - 2.0 * bt);
    if (bowl <= 0.0) { return vec3f(0.0); }
    let dbowl = select(
        vec2f(0.0),
        (p / max(rad, 1.0)) * (6.0 * bt * (1.0 - bt) / 6000.0),
        bt > 0.0 && bt < 1.0
    );
```
Zero inside **7 km**, full at **13 km**, smoothstepped over **6 km**.

**(b) Where there is a range at all** — a slow massif field, so the horizon gets massifs, gaps and
long low saddles instead of an unbroken row of triangles.

```wgsl
    let massif = fbmd(q * 0.10 + vec2f(11.3, 4.7), 2, 2.13, 0.52);
    let mk = 0.10 * kq;                                     // = 1e-4
    let t = clamp((massif.x + 0.34) / 0.70, 0.0, 1.0);
    let env = t * t * (3.0 - 2.0 * t);
    // d(smoothstep)/dx = 6t(1-t)/width, chained through the massif's own slope.
    let denv = select(
        vec2f(0.0),
        massif.yz * mk * (6.0 * t * (1.0 - t) / 0.62),
        t > 0.0 && t < 1.0
    );
```
> **QUIRK-3 (reproduce).** The envelope width is **0.70** in the value but **0.62** in the
> derivative. The gradient is therefore ~13% too steep wherever the envelope is ramping. It only
> perturbs shading normals on massif flanks at 10–45 km. Copy both numbers as written.

**(c) Domain warp** — *"the single largest difference between 'ridged noise' and 'mountains'."*

```wgsl
    let w1 = noised(q * 0.26 + vec2f(2.7, 8.1));
    let w2 = noised(q * 0.26 + vec2f(19.4, 3.6));
    let qw = q + vec2f(w1.x, w2.x) * 1.35;    // 1.35 km of displacement
```
The warp's Jacobian is **deliberately ignored** downstream: "On a matte 10–45 km away that is not
resolvable, and carrying the chain rule through two extra fields would cost more than the shading
error is worth."

**(d) The peaks** — two incommensurate ridged stacks.

```wgsl
    let r = ridgedd(qw * 0.30, 4, 2.09, 0.50);      // FOUR octaves, not three
    let rk = 0.30 * kq;
    let s = ridgedd(qw * 1.05 + vec2f(31.0, 17.0), 3, 2.11, 0.50);
    let sk = 1.05 * kq;

    let raw  = r.x * 0.78 + s.x * 0.22;
    let draw = r.yz * (0.78 * rk) + s.yz * (0.22 * sk);
```
"At three the lowest octave dominates and the range reads as smooth meringue mounds: no crest line
anywhere, and a mountain without a crest line has no scale."

**(e) Crest sharpening** — cubic bias, chain-ruled.

```wgsl
    let peaks  = raw * raw * raw * 0.55 + raw * 0.45;
    let dpeaks = draw * (3.0 * raw * raw * 0.55 + 0.45);
```
Ridged noise squares its ridge term, which rounds the top (right for sastrugi, wrong for mountains);
this biases the other way.

**(f) Foothill floor + composition.**

```wgsl
    let e  = 0.06 + 0.94 * env;                 // 6% floor in the gaps
    let h  = peaks * e;
    let dh = dpeaks * e + peaks * denv * 0.94;
    return vec3f(
        h * bowl * amp,
        (dh * bowl + h * dbowl) * amp
    );
}
```
> The floor is **0.06** and "small is the operative word. At 0.22 this was a continuous
> four-hundred metre barrier at the near edge of the range […] a flat-topped vertical wall wrapped
> right around the field."

**Analytic normal** (both hit sites):
```wgsl
out.normal = normalize(vec3f(-f.y, 1.0, -f.z));   // f = ridgeField(...) = (h, dH/dx, dH/dz)
```
No finite differences anywhere. This is what lets faces light and shade correctly against a 13°
sun.

### 8.3 `RidgeHit`

```wgsl
struct RidgeHit {
    hit: bool,
    dist: f32,     // horizontal metres to the hit
    height: f32,   // world Y of the surface there
    normal: vec3f,
    pos: vec2f,    // world XZ of the hit
};
```
`dist` is **horizontal**, not along-ray. `height` already has `ridgeDrop` subtracted.

### 8.4 `ridgeMarch` — the step schedule

```wgsl
let hl = length(dir.xz);
if (hl < 1e-4) { return out; }              // straight up/down: no hit

let step  = dir.xz / hl;                    // unit horizontal advance
let slope = dir.y / hl;                     // metres of rise per metre of ground

const D_NEAR: f32 = 5500.0;
const D_FAR:  f32 = 45000.0;
const STEPS:  i32 = 18;

let ceiling = ridgeCeiling(amp);
if (camPos.y + slope * D_NEAR > ceiling && slope >= 0.0) { return out; }   // early-out

let growth = pow(D_FAR / D_NEAR, 1.0 / f32(STEPS));   // = 1.1238637  (~12.39% per step)
```

**Priming from a real sample** — not a constant:

```wgsl
var prevD = D_NEAR;
var prevGap = camPos.y + slope * D_NEAR
            - (ridgeField(camPos.xz + step * D_NEAR, amp).x - ridgeDrop(D_NEAR));

if (prevGap < 0.0) {
    // Started inside the near face. That is a legitimate hit, at D_NEAR.
    out.dist = D_NEAR;
    out.pos = camPos.xz + step * D_NEAR;
    let f = ridgeField(out.pos, amp);
    out.height = f.x - ridgeDrop(D_NEAR);
    out.normal = normalize(vec3f(-f.y, 1.0, -f.z));
    out.hit = true;
    return out;
}
```
> With `prevGap` initialised to a made-up 1.0, "It showed up as vertical striping down the whole
> range, which looks like a shading bug and is arithmetic."

**The loop** — 17 iterations (`i = 1 … 17`), geometric spacing:

```wgsl
var d = D_NEAR * growth;

for (var i = 1; i < STEPS; i++) {
    let p = camPos.xz + step * d;
    let h = ridgeField(p, amp).x - ridgeDrop(d);
    let rayY = camPos.y + slope * d;
    let gap = rayY - h;

    if (gap < 0.0) {
        // Interpolate the crossing rather than accepting the step.
        var t = 0.5;
        if (prevGap - gap > 1e-5) { t = prevGap / (prevGap - gap); }
        out.dist = mix(prevD, d, clamp(t, 0.0, 1.0));
        out.pos = camPos.xz + step * out.dist;

        let f = ridgeField(out.pos, amp);
        out.height = f.x - ridgeDrop(out.dist);
        out.normal = normalize(vec3f(-f.y, 1.0, -f.z));
        out.hit = true;
        return out;
    }

    // Climbed clear of the tallest possible peak: nothing ahead can be hit.
    if (rayY > ceiling && slope > 0.0) { return out; }

    prevGap = gap;
    prevD = d;
    d *= growth;
}
```

**Exact sample schedule** (18 evaluations of `ridgeField` on a hit-free ray): the prime at 5500 m,
then `5500 × 1.1238637^k` for `k = 1…17`:

```
5500, 6181, 6947, 7807, 8775, 9861, 11083, 12456, 13999, 15733,
17682, 19872, 22334, 25102, 28213, 31709, 35638, 40044   (metres)
```
**Note `D_FAR = 45000` is the growth anchor, not the reach.** The furthest sample is ≈ **40.0 km**.

**Ridge-occludes-ridge falls out for free**: the march returns the *first* crossing, so a nearer
massif hides everything behind it, and the crossing interpolation removes the terracing that taking
the far end of a hundreds-of-metres step would produce.

**Cost**: the whole effect is confined to `dir.y ∈ (−0.050, 0.230)` and early-outs above the
ceiling, so it touches "a few per cent of the frame" (~1.2 ms of a 3.22 ms frame at 2560×1440 on an
RTX 5070 Ti).

### 8.5 `ridgeShadow` — the second, short march toward the sun

```wgsl
fn ridgeShadow(pos: vec2f, height: f32, sunDir: vec3f, amp: f32) -> f32 {
    let hl = length(sunDir.xz);
    if (hl < 1e-3 || sunDir.y <= 0.0) { return 1.0; }

    let step = sunDir.xz / hl;
    let slope = sunDir.y / hl;

    var d = 420.0;
    for (var i = 0; i < 4; i++) {
        let h = ridgeField(pos + step * d, amp).x;
        if (h > height + slope * d) { return 0.0; }
        d *= 2.6;
    }
    return 1.0;
}
```

- **4 steps**, first at **420 m**, growth **2.6×** ⇒ samples at **420, 1092, 2839.2, 7381.9 m**
  horizontally. Total reach ≈ 7.38 km.
- **Binary result — 0.0 or 1.0.** "A soft edge would cost four times the samples to describe a
  penumbra that, at twenty kilometres, is a fraction of a pixel — and what this term is actually for
  is the large-scale read of which flank of a massif is in the shade of the one in front of it."
- **`ridgeDrop` is NOT applied here** (unlike `ridgeMarch`). Over 7.4 km the drop is 4.3 m, which is
  negligible against 2 km peaks — but reproduce the omission for bit-comparability.
- The comparison is against the *unshifted* `height` passed in, which **is** drop-corrected. Copy as
  written.

### 8.6 `shadeRidge` — the far range's material (verbatim, whole function)

```wgsl
fn shadeRidge(hit: RidgeHit, dir: vec3f) -> vec3f {
    let N = hit.normal;
    let L = uniforms.sunDir;

    let steep = 1.0 - N.y;
    let snowMask = clamp(1.0 - smoothstep(0.46, 0.80, steep), 0.0, 1.0);

    let rock = vec3f(0.052, 0.055, 0.066);
    let snow = vec3f(0.855, 0.885, 0.945);
    let albedo = mix(rock, snow, snowMask);

    let shadow = ridgeShadow(hit.pos, hit.height, L, uniforms.ridgeAmp);

    const INV_PI: f32 = 0.31830988618;
    let diff = wrapDiffuse(dot(N, L), mix(0.15, 0.62, snowMask));
    var col = albedo * INV_PI * uniforms.sunRadiance * diff * shadow;

    let V = -dir;
    col += snowSubsurface(N, L, V, uniforms.sunRadiance, 0.45, snowMask, 1.0)
         * albedo * mix(0.5, 1.0, shadow);

    col += albedo * INV_PI * shIrradiance(N, uniforms.shR) * uniforms.ambientIntensity;

    col += albedo * INV_PI * shIrradiance(vec3f(0.0, 1.0, 0.0), uniforms.shR)
         * uniforms.ambientIntensity * 0.30 * clamp(-N.y * 0.5 + 0.5, 0.0, 1.0)
         * snowMask;

    let hitPos = vec3f(hit.pos.x, hit.height, hit.pos.y);
    let t = aerialTransmittance(
        uniforms.cameraPosition, hitPos,
        uniforms.fogDensity, uniforms.fogHeightFalloff, uniforms.fogStart
    );
    let ext = clamp(1.0 - pow(t, uniforms.aerialStrength), 0.0, 1.0);

    let inscatter = aerialInscatterSky(
        skyLUT, skyLUTSampler, dir, L, uniforms.sunRadiance, ext
    );

    return mix(col, inscatter, ext);
}
```

Term by term:

| Term | Numbers | Why |
|---|---|---|
| Snow / rock split | `snowMask = 1 − smoothstep(0.46, 0.80, 1 − N.y)` | Snow everywhere but the steepest faces. **No altitude snow line.** "This is a polar range, not an alpine one […] the first version's 120–460 m ramp put rock across the whole visible band and turned the horizon into a dark smear. Rock is here for the *break* it gives a white massif." Full snow below `N.y ≥ 0.54`, full rock above `N.y ≤ 0.20` slope-wise. |
| Rock albedo | `(0.052, 0.055, 0.066)` | Very dark, faintly blue. |
| Snow albedo | `(0.855, 0.885, 0.945)` | Near-white, **never 1.0**, blue-weighted — matches `SNOW_ALBEDO` on the CPU. |
| Cast shadow | `ridgeShadow(...)` → 0 or 1 | §8.5. |
| Direct diffuse | `wrapDiffuse(N·L, mix(0.15, 0.62, snowMask))` | wrap **0.62 on snow**, 0.15 on rock. Same wrap the field uses. |
| Subsurface | `snowSubsurface(N, L, V, sunRadiance, thickness=0.45, strength=snowMask, radius=1.0) * albedo * mix(0.5, 1.0, shadow)` | The term the first version omitted. "A mountain of snow with the sun behind it *glows* — it does not go to a dark silhouette. Without this the range came out as dark warm shapes against bright warm haze, which is the one combination that reads as dirt." Note it survives at **50%** even in full cast shadow. |
| Sky fill | `albedo * INV_PI * shIrradiance(N, shR) * ambientIntensity` | "at this distance it is most of what is left after extinction, and it is the reason distant snow reads blue rather than grey." |
| Self-bounce | `albedo * INV_PI * shIrradiance((0,1,0), shR) * ambientIntensity * 0.30 * clamp(−N.y*0.5+0.5, 0, 1) * snowMask` | "A white massif is lit from every direction by the rest of the massif, and leaving it out is what makes shaded faces read as too dark by a stop." Weight **0.30**, only on snow, weighted toward down-facing normals. (The snow field uses **0.28** for the same term — see §9.) |
| Haze | `aerialTransmittance` + `aerialInscatterSky`, **the scene's own fog constants** | §8.7 |

Note `V = -dir` — the view vector points **from the surface toward the camera**, so
`snowSubsurface` gets the same convention the ground does.

### 8.7 Haze matching — the reason the range sits *in* the landscape

`shadeRidge` does **not** call `applyAerial`; it inlines the same two steps so it can pass `dir`
(the skybox ray direction) as the view direction. The result is arithmetically identical to
`applyAerial(col, camPos, hitPos, dir, L, …)`.

The critical property, verbatim:

> Deliberately *not* a second, physically-real atmosphere integrated over the true kilometres. That
> gives the frame two different atmospheres and the seam lands exactly where the eye is looking: the
> scene's haze is roughly a hundred times thicker than real air, so an 800 m dune is hazed as though
> it were eighty kilometres away while a 20 km massif gets a genuine 20 km of it — and the range
> comes out sharper and more contrasty than the ground in front of it, which reads as a matte
> painting hung behind the set.

and

> The clipmap's far edge and the range's feet are adjacent pixels in the frame, and if they resolve
> to two different "fully hazed" colours there is a visible line between them whatever else is
> right. At full extinction it is the plain sky lookup, which is what this shader draws where the
> march missed — so a fully hazed massif and the sky beside it are **literally the same value**.

So the invariant is: **`shadeRidge` at `ext → 1`  ==  `textureSampleLevel(skyLUT, uv, 0.0)`  ==
`applyAerial` on the snow at `ext → 1`.** Three code paths, one number. Any port that breaks this
draws a hard silhouette at the clipmap's far radius.

---

## 9. Downstream consumers of the sky outputs (needed for consistency)

| Consumer | Reads | Numbers |
|---|---|---|
| Snow field ambient | `shIrradiance(N, shR) * ambientIntensity` | plus self-bounce `shIrradiance((0,1,0)) * ambientIntensity * 0.28 * clamp(−N.y*0.5+0.5,0,1) * albedo` |
| Snow ambient specular | `textureSampleLevel(skyLUT, dirToLatLong(reflect(−V,N)), sqrt(roughness) * 6.0)` | × `fresnelSchlickRough(NdotV, f0, roughness)` × `ambientIntensity` × `mix(1.0, 2.6, iceAmount)` |
| Character | same `sqrt(roughness) * 6.0` mip | + sheen rim `pow(1−NdotV, 4.0) * 0.55` |
| Surf wake | `sqrt(roughness) * 6.0` | |
| Water refraction | `dirToLatLong(refracted)` at **mip 1.6**, per-channel | "a little blur is what a centimetre of moving water does" |
| Crystal refraction | **mip 0.9**, per-channel, IORs **1.3050 / 1.3090 / 1.3170** | chromatic dispersion; the **below-horizon rows are the snow bounce**, which is the whole reason no scene copy is needed |
| Crystal reflection | `rough * 6.0` | |
| Aerial perspective | mip 0 (exact) + mip 3 (tilted near-sky) | §7.2 |

**Max useful mip is 6** (`sqrt(1) * 6`), which on a 512×256 chain is **8×4** — so the LUT needs at
least 7 mip levels. Generate the full chain.

---

## 10. WebGL2 / Three.js r172 porting notes

### PORT-1 — Compute shaders / storage textures
None used. Everything is already a full-screen fragment pass into a render target. Babylon's
`ProceduralTexture` ≡ `THREE.WebGLRenderTarget` + a full-screen triangle/quad rendered with an
`OrthographicCamera` (or a `FullScreenQuad` helper) driving `vUV = uv`.

### PORT-2 — Float render targets
- `RGBA16F` (`skyLUT`) and `RGBA32F` (`shLUT`) are **not colour-renderable in WebGL2 core**. Enable
  **`EXT_color_buffer_float`** (`renderer.getContext().getExtension('EXT_color_buffer_float')`)
  before creating either target, and fail loudly if it is absent.
- `RGBA16F` **is** texture-filterable in core WebGL2 — trilinear on `skyLUT` works with no further
  extension.
- `RGBA32F` filtering requires **`OES_texture_float_linear`**. `shLUT` is never filtered (CPU
  readback only) — set `minFilter = magFilter = THREE.NearestFilter` and sidestep the extension.
- Three.js: `new THREE.WebGLRenderTarget(512, 256, { type: THREE.HalfFloatType, format: THREE.RGBAFormat,
  generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false })`.
- Three regenerates mips on `setRenderTarget(null)` when `texture.generateMipmaps === true` and the
  min filter is a mipmap filter. Verify the chain is actually populated (sample mip 6 and check it is
  not black) — a silent failure here shows up as a black horizon in the aerial perspective.

### PORT-3 — `textureSampleLevel` → `textureLod`
WGSL `textureSampleLevel(tex, samp, uv, lod)` ⇒ GLSL ES 3.00 `textureLod(sampler2D tex, vec2 uv,
float lod)`. Available in fragment shaders in GLSL ES 3.00 — **explicit LOD is required** here, never
plain `texture()`, because `dirToLatLong` has a derivative discontinuity at the `u` wrap seam that
would select mip 0 on one side and the 1×1 mip on the other, drawing a bright vertical line at
azimuth 180°.

### PORT-4 — `textureLoad` / `texelFetch`
Not used by this subsystem (no integer texel fetches in the sky path). If the port replaces the
`readPixels`-based SH projection with a GPU reduction, `texelFetch(tex, ivec2(x,y), 0)` is the
equivalent.

### PORT-5 — Clip-space Z and the far-plane clamp
`clip.z = clip.w * 0.999999` **ports verbatim**, but for a different reason:
- WebGPU NDC z ∈ `[0, 1]`, far = 1.
- WebGL/OpenGL NDC z ∈ `[-1, 1]`, far = +1.
Either way `z/w = 0.999999` lands just inside the far plane. Pair it with
`material.depthWrite = false`, `material.depthTest = true` (default `LessEqual` in both APIs), and
`side: THREE.DoubleSide` (Babylon's `backFaceCulling = false`). Render the skybox first
(`mesh.renderOrder = -1` or a separate first pass) — the reference relies on `renderingGroupId = 0`
vs the terrain's `1`.

### PORT-6 — `readPixels` row order (the one that will silently invert the sky)
`gl.readPixels` returns rows **bottom-to-top in framebuffer space**, whereas the bake wrote
`v = 0` (zenith) at the texture's first row. Three's `renderer.readRenderTargetPixels(rt, 0, 0, w, h,
buf)` is a thin wrapper over `gl.readPixels` and does **not** flip.

**Do not guess.** Bake a debug pattern (e.g. write `vec3(vUV.y)` instead of the sky), read it back,
and check whether `px[0]` is ≈0 or ≈1. Then either index the loop as
`theta = ((y + 0.5) / SH_H) * PI` (row 0 = zenith, matches the reference) or
`theta = (1.0 - (y + 0.5) / SH_H) * PI` (row 0 = nadir).
**Symptom of getting it wrong:** the SH ambient is warm from below and cool from above; snow
shadows go beige; `_irradianceUp` returns the ground-bounce colour instead of the sky colour and the
three-iteration solve amplifies the error each round.

Use `renderer.readRenderTargetPixelsAsync()` (r152+) to keep the solve non-blocking, matching the
reference's `await`ed readback that "settles over the next few frames rather than instantly."

### PORT-7 — `select()` argument order
WGSL `select(falseValue, trueValue, cond)` — **note the order**. GLSL: `cond ? trueValue : falseValue`
or `mix(falseValue, trueValue, float(cond))`. Two uses in `ridgeField` (`dbowl`, `denv`); getting
the order backwards zeroes the gradients exactly where the field is ramping.

### PORT-8 — Matrix construction and vector×matrix
`mat2x2f(c, -s, s, c)` in WGSL and `mat2(c, -s, s, c)` in GLSL are **identical** — both
column-major, col0 = `(c, -s)`, col1 = `(s, c)`. `v * M` (row-vector × matrix) exists in both with
the same meaning, so `n.yz * xform` in `fbmd` / `ridgedd` ports unchanged. `M * v` likewise.

### PORT-9 — Built-in name differences
| WGSL | GLSL ES 3.00 |
|---|---|
| `atan2(y, x)` | `atan(y, x)` |
| `fract(x)` | `fract(x)` — same `x − floor(x)` semantics, same for negatives |
| `mix(a, b, t)` | `mix(a, b, t)` — same |
| `smoothstep(e0, e1, x)` | `smoothstep(e0, e1, x)` — same; undefined for `e0 > e1` in both. The `-0.030 / -0.005` and `0.0 / 0.26` edges are already ascending. |
| `pow(x, y)` | same; both undefined for `x < 0`. The reference always guards with `max(0.0, …)` — keep those guards. |
| `vec3f(a)` splat | `vec3(a)` |
| `let` / `var` | `const`-ish / mutable local |
| `f32(i)` | `float(i)` |
| `array<vec4f, 9>` uniform | `uniform vec4 shR[9];` (std140-safe: a `vec4` array has no padding surprises) |
| `const POISSON: array<vec2f,12>` | `const vec2 POISSON[12] = vec2[12](...)` (not needed by the sky) |
| `sign(x)` | same |

### PORT-10 — Uniform plumbing in Three.js
- `shR` → `{ value: Array(9).fill().map(() => new THREE.Vector4()) }`, refilled from the 36-float
  array each solve. (Three will upload a `vec4[9]` correctly; a `Float32Array(36)` bound to a
  `vec4[9]` uniform also works via `uniform4fv`.)
- `viewProjection` → `projectionMatrix * viewMatrix`. If using a `RawShaderMaterial`, supply it
  yourself; with `ShaderMaterial`, `projectionMatrix * modelViewMatrix * vec4(position,1)` gives the
  same clip position **only if** the skybox mesh's model matrix is identity — the reference builds
  world position in the shader (`position * skyScale + cameraPosition`), so keep the mesh at the
  origin with identity transform and do the same.
- `cameraPosition` is a Three.js built-in uniform in `ShaderMaterial` — do not redeclare it.
- `time` must be the **same** clock the terrain/wind use, or the cirrus desynchronises from the
  ground wind.

### PORT-11 — Handedness
Babylon here is **left-handed**; Three.js is **right-handed**. Every formula in this document is
expressed in raw world XYZ and is handedness-agnostic *internally* — `sunDir`, `ridgeField(p.xz)`,
`dirToLatLong`, `windDir` and the terrain all share one convention. The cheapest correct port keeps
every formula byte-identical and accepts that the world is a **mirror image** in Z relative to the
reference screenshots (azimuth 118° then points the other way in screen terms). If matching
reference screenshots exactly matters, negate Z when converting content-space to Three world space —
**consistently, across sky, terrain, wind and character**, or the wind/sun 70–80° separation (which
the sastrugi look depends on) inverts.

### PORT-12 — No timestamp queries
WebGPU timestamp queries are unavailable. Use `EXT_disjoint_timer_query_webgl2` where present, else
CPU-side `performance.now()` around `renderer.render`, and label the numbers as CPU-side.

### PORT-13 — Async shader readiness
Babylon's `whenReady`/`isReady()` pattern (25 s timeout, "almost always a WGSL compile error") maps
to Three's `renderer.compileAsync(scene, camera)` / `WebGLProgram` link checking. The solve must not
run before both LUT programs link, and **nothing else in the scene may be constructed before
`solve()` resolves** — the terrain, character, wake, spray, water and crystal materials all take
`sky.lut` and `sky.sh` as construction inputs.

### PORT-14 — Precision
- Declare `precision highp float;` **and** `precision highp int;` in every fragment shader here.
  `nishitaSky` works with values around `6.36e6` metres and `5.8e-6` per metre — a `mediump` path
  (some mobile GL ES 3.0 drivers) will produce banding at the horizon and NaNs in `raySphereFar`.
- `b*b - c` in `raySphereFar` with `b ≈ 6.36e6` is `4e13`, comfortably inside f32 range but only
  ~7 significant digits; the reference lives with this. Do not "improve" it to a stabilised
  quadratic — the horizon position would shift.
- `RGBA16F` for the main LUT means values above 65504 clamp to infinity. The disc (peak ≈ 1037) is
  **not** in the LUT, so the LUT's dynamic range stays modest; keep it that way.

### PORT-15 — Equirect seam and pole handling
`wrapU = REPEAT` / `wrapV = CLAMP_TO_EDGE` is not optional. With `wrapV = REPEAT` the zenith row
bleeds into the nadir row through mip filtering and the top of the sky picks up ground bounce. With
`wrapU = CLAMP` a seam appears at azimuth 180°.

---

## 11. Per-frame vs baked — the ledger

| Work | When | Where |
|---|---|---|
| `nishitaSky` 32×8 integral, 512×256 + 64×32 | **4× per solve**; solve on load and on sun-direction change only | fragment pass into RT |
| Mip chain generation | with each bake | driver |
| CPU SH projection over 2048 texels | **4× per solve** | JS |
| Ground-bounce solve (3 rounds) | per solve | JS |
| Kasten–Young sun colour | **every frame** (`syncFromSettings` in `update`) | JS, ~20 flops |
| Skybox LUT lookup | per fragment | mip 0 |
| Far-range march (18 field evals + up to 4 shadow evals) | per fragment, only inside the `dir.y ∈ (−0.050, 0.230)` band and only where the ceiling test fails | fragment |
| Solar disc / aureole / cirrus | per fragment | fragment |
| Aerial perspective | per fragment in **seven** materials | fragment |

---

## 12. Deliberate artefacts and past bugs — do not "fix" these

1. **Power-law march** (`t^2.5`). Replacing it with a uniform march reintroduces a **one-stop dark
   notch, 1–2° wide, wrapped around the whole horizon** (measured: 1.86 at +3.5°, 0.84 at 0°, 1.29
   at −0.5°).
2. **Shadowed samples at half weight in the MS pass only.** Dropping them draws a dark/brown stripe
   1–2° above the horizon on the **anti-sun** side.
3. **Grazing desaturation at 0.26 / 0.82.** Removing it puts a saturated olive band between the blue
   dome and the warm sun; the whole far field then inherits a yellow cast through the aerial
   perspective. The previous, insufficient values were `0.20 / 0.62`.
4. **Ground-bounce handover only 1.43° wide.** Wider exposes the artefactually dark clipped march.
5. **The 7 km bowl.** Removing it draws near massif faces as flat-topped vertical slabs at the near
   plane ("buildings on the horizon").
6. **Foothill floor 0.06, not 0.22.** 0.22 built a continuous ~400 m vertical wall around the field.
7. **4 octaves in the coarse ridged stack, not 3.** 3 gives "smooth meringue mounds."
8. **`prevGap` primed from a real sample.** A constant 1.0 causes vertical striping down the range.
9. **The lower ridge bound reaches below the horizon (−0.050).** A fixed elevation cutoff draws a
   ruler-straight line under the massif.
10. **No altitude snow line on the range.** A 120–460 m ramp turned the horizon into a dark smear.
11. **The forward lobe lives *inside* the inscatter crossfade.** Outside it, the haze band becomes a
    hard-topped saturated wall.
12. **QUIRK-1** (sunIntensity does not dirty the LUT), **QUIRK-2** (`sunColor` parameter receives
    `sunRadiance`), **QUIRK-3** (envelope width 0.70 vs derivative width 0.62).

---

## 13. VISUAL ACCEPTANCE CRITERIA

A harsh critic should be able to check every one of these from screenshots, at the default settings
(`sunElevation 13°`, `sunAzimuth 118°`, `sunIntensity 4.2`, `mountainHeight 2150`, AgX, exposure
0.105).

1. **The horizon is pale and very slightly cool on the anti-sun side — never olive, never tan.**
   Look 180° from the sun at eye level: the last ~15° of sky above the horizon must desaturate
   toward its own luminance with a faint blue-magenta cast (`×(0.97, 1.0, 1.06)`), not toward green
   or yellow. Any saturated band between the blue dome and the horizon is a failed grazing pass.

2. **No dark notch or stripe anywhere within 3° of the horizon, in any azimuth.**
   Sweep the camera a full 360° at eye level. The luminance must vary **monotonically and smoothly**
   through the horizon; a 1–2° wide band that is a stop darker than the sky both above and below it
   means the march is uniform instead of `t^2.5`, or the shadowed samples were dropped.

3. **Below the horizon the sky is bright, pale and only slightly warm — not black, not a hard
   line.** Point the camera down past the terrain silhouette (or inspect the LUT directly): rows
   below `v ≈ 0.505` must resolve to the solved snow bounce, and the transition from atmosphere to
   bounce must complete inside **~1.5° of arc**. A visible hard edge, or a dark stripe exactly where
   ground meets sky, is a failed handover.

4. **Snow shadows are blue, not grey and not beige.**
   In an unlit trench or on the lee side of a dune, the shadowed snow must read distinctly cooler
   than the lit snow, and the hue must be blue-white rather than neutral. If shadows come out beige,
   the multiple-scattering pass (`MS_BOOST 1.5`) is missing or the SH projection is row-flipped, and
   the warm ground bounce has won the ambient.

5. **The direct beam is visibly warm at a ratio of roughly 17 : 13 : 6.5.**
   Sample a fully-lit, flat, unshadowed patch of snow before tonemapping: R:G:B must be near
   `16.90 : 12.91 : 6.51`. Equivalently, `sunColor` must be near `(1.000, 0.764, 0.385)` — a strong
   amber, not a pale cream.

6. **Dragging the elevation slider from 13° to 35° visibly and simultaneously changes four things:**
   the horizon loses its warmth, the zenith gradient steepens, the ambient turns bluer, and the
   direct sun turns whiter. If any one of them stays put, the LUT is not rebaking (QUIRK-1) or the
   ambient is a constant rather than the SH fit.

7. **The solar disc has a soft, limb-darkened edge and two distinct glow scales around it.**
   A ~0.53°-wide disc whose rim is roughly 59% as bright as its centre, sitting inside a tight
   aureole ≈1.8° across and a broad one ≈8.4° across. A hard-edged white dot, or a single Gaussian
   glow, is wrong.

8. **The far range shows ridges occluding other ridges, with visible depth — not one silhouette.**
   At least two or three distinguishable depth layers should be readable across the horizon:
   nearer massifs sharper and darker, further ones paler and lower-contrast, with saddles and gaps
   between separate massifs rather than a continuous serrated band.

9. **Individual massifs carry their own cast shadows on their lee flanks.**
   With a 13° sun, whole flanks of mountains that stand behind another massif must go into shade
   as a **hard-edged, large-scale** region (the shadow march is binary), while the sunlit flanks
   stay bright. Soft, gradient-only shading with no discrete shadowed flanks means `ridgeShadow` is
   missing.

10. **Back-lit peaks glow rather than silhouette.**
    Frame the range with the sun behind it. The peaks must read as luminous, translucent white snow
    against the haze, not as dark shapes. Dark warm shapes against bright warm haze — the "reads as
    dirt" failure — means `snowSubsurface` was left out of `shadeRidge`.

11. **The range's feet dissolve into the haze at exactly the same colour the clipmap's far edge
    dissolves into — no line, no shelf, no bank.**
    Look along the horizon where the near terrain's silhouette meets the range. There must be **no**
    detectable boundary: no hard-topped haze bank, no colour step, no visible circle at the clipmap
    radius. Zoom in on that junction; adjacent pixels of fully-hazed mountain, fully-hazed dune and
    open sky must be indistinguishable.

12. **Distant snow reads blue; distant rock is a sparse dark accent, not ground cover.**
    Rock (`0.052, 0.055, 0.066`) must appear only on the steepest faces as a break in a
    predominantly white massif. If the range reads as a dark smear, the snow mask thresholds
    (`0.46 / 0.80` on `1 − N.y`) are wrong.

13. **Haze looks toward-sun warm and away-from-sun cool, at the same distance.**
    Two dunes at equal range, one up-sun and one down-sun, must show a clear warm/cool split in
    their haze. A uniformly warm or uniformly grey field means the forward Mie lobe (`g = 0.62`,
    `× 5.5 × 0.16`, fed `sunRadiance`) is missing or was fed the normalised `sunColor`.

14. **Cirrus is present but subordinate.**
    Thin wind-aligned streaks converging toward the horizon, running along the 42° wind bearing,
    fading out below `dir.y ≈ 0.22` and thinning again near the zenith, at a maximum blend of ~34%
    (`0.62 × 0.55`). If clouds are the first thing you notice in the sky, `cloudAmount` or the blend
    is too high.

15. **No seam at azimuth 180°, and no bright/dark cap at the zenith or nadir.**
    Rotate a full circle: no vertical line, no mip-selection flicker at the wrap. Look straight up
    and straight down: no pinch, no discoloured pole disc. Failures here are `wrapU`/`wrapV` or a
    non-explicit-LOD sample.

---

## Appendix A — Complete numeric constant table

Every distinct numeric constant captured in this spec, with its binding and units. Sequentially
numbered so the count is verifiable.

### A.1 CPU — `src/render/sky.js`

| # | Identifier | Value | Units / meaning |
|---|---|---|---|
| 1 | `LUT_W` | 512 | texels, equirect azimuth |
| 2 | `LUT_H` | 256 | texels, equirect polar |
| 3 | `SH_W` | 64 | texels |
| 4 | `SH_H` | 32 | texels |
| 5 | `SUN_SCALE_BASE` | 5.5 | dimensionless |
| 6 | `sunDir` init Y | 0.2 | pre-solve placeholder |
| 7 | `sunColor` init G | 0.85 | |
| 8 | `sunColor` init B | 0.66 | |
| 9 | `sh` length | 36 | floats = 9 × vec4 |
| 10 | skybox `size` | 2 | ⇒ positions ±1 |
| 11 | `skyScale` factor | 0.5 | × `camera.maxZ` |
| 12 | `cloudAmount` | 0.55 | hard-coded in `render()` |
| 13 | dirty epsilon | 1e-6 | per component of `sunDir` |
| 14 | Kasten–Young A | 0.50572 | |
| 15 | Kasten–Young offset | 96.07995 | degrees |
| 16 | Kasten–Young exponent | −1.6364 | |
| 17 | KY argument floor | 1e-3 | degrees |
| 18 | air-mass cap | 40 | |
| 19 | `tauR[0]` | 0.0464 | vertical Rayleigh optical depth, R |
| 20 | `tauR[1]` | 0.108 | G |
| 21 | `tauR[2]` | 0.265 | B |
| 22 | `tauM` | 0.0252 | vertical Mie optical depth |
| 23 | solve iterations | 3 | + 1 final bake + 1 final projection |
| 24 | `SNOW_ALBEDO[0]` | 0.83 | R |
| 25 | `SNOW_ALBEDO[1]` | 0.86 | G |
| 26 | `SNOW_ALBEDO[2]` | 0.91 | B |
| 27 | Lambert `k` | 1/π | |
| 28 | irradianceUp band0 | 0.886227 | |
| 29 | irradianceUp band1 | 2 × 0.511664 | |
| 30 | irradianceUp band2 m0 | −0.247708 | |
| 31 | irradianceUp band2 m2 | −0.429043 | |
| 32 | SH `Y[0]` | 0.282095 | |
| 33 | SH `Y[1..3]` | 0.488603 | |
| 34 | SH `Y[4],Y[5],Y[7]` | 1.092548 | |
| 35 | SH `Y[6]` | 0.315392 × (3z²−1) | |
| 36 | SH `Y[8]` | 0.546274 × (x²−y²) | |
| 37 | `dOmega` | (2π/64)(π/32) = 0.00963829 | steradian |
| 38 | `whenReady` timeout | 25000 | ms |

### A.2 Settings + camera defaults

| # | Identifier | Value | Units |
|---|---|---|---|
| 39 | `sunAzimuth` | 118 | degrees |
| 40 | `sunElevation` | 13.0 | degrees |
| 41 | `sunIntensity` | 4.2 | |
| 42 | `sunTempWarm` | 1.0 | 0–1 |
| 43 | `ambientIntensity` | 1.0 | |
| 44 | `fogDensity` | 0.0072 | per metre |
| 45 | `fogHeightFalloff` | 0.045 | per metre |
| 46 | `fogStart` | 24 | metres |
| 47 | `aerialStrength` | 1.0 | exponent |
| 48 | `windDirection` | 42 | degrees |
| 49 | `mountainHeight` (`ridgeAmp`) | 2150 | metres |
| 50 | `shaftStrength` | 0.30 | |
| 51 | `exposure` | 0.105 | |
| 52 | `contrast` | 1.14 | |
| 53 | camera `minZ` | 0.12 | metres |
| 54 | camera `maxZ` | 4200 | metres |
| 55 | camera `fov` | 1.02 | radians (58.44° vertical) |
| 56 | elevation slider range | 0.5 – 45 | degrees |
| 57 | mountainHeight slider range | 0 – 2500 | metres |

### A.3 `atmosphere.wgsl` — `nishitaSky`

| # | Identifier | Value | Units |
|---|---|---|---|
| 58 | `EARTH_R` | 6360000.0 | metres |
| 59 | `ATMOS_R` | 6420000.0 | metres |
| 60 | `H_RAYLEIGH` | 8000.0 | metres |
| 61 | `H_MIE` | 1200.0 | metres |
| 62 | `BETA_R.r` | 5.8e-6 | per metre |
| 63 | `BETA_R.g` | 13.5e-6 | per metre |
| 64 | `BETA_R.b` | 33.1e-6 | per metre |
| 65 | `BETA_M` | 21e-6 | per metre, all channels |
| 66 | `MIE_G` | 0.76 | |
| 67 | `MS_BOOST` | 1.5 | |
| 68 | observer altitude | 800.0 | metres above `EARTH_R` |
| 69 | `STEPS` | 32 | view samples |
| 70 | `LIGHT_STEPS` | 8 | sun samples per view sample |
| 71 | `DIST_POWER` | 2.5 | exponent on normalised t |
| 72 | Mie extinction factor | 1.1 | × `BETA_M`, optical depth only |
| 73 | `SHADOW_FILL` | 0.5 | half weight for planet-shadowed samples |
| 74 | `msPhase` | 1/(4π) | isotropic |
| 75 | MS Mie weight | 0.4 | |
| 76 | Rayleigh phase factor | 3/(16π) | |
| 77 | Mie phase factor | 3/(8π) | |
| 78 | handover edge0 | −0.030 | `rayDir.y` (−1.719°) |
| 79 | handover edge1 | −0.005 | `rayDir.y` (−0.287°) |
| 80 | grazing edge0 | 0.0 | `abs(rayDir.y)` |
| 81 | grazing edge1 | 0.26 | `abs(rayDir.y)` (15.07°) |
| 82 | pale weights | (0.30, 0.42, 0.28) | non-Rec.709 luminance |
| 83 | pale tint | (0.97, 1.0, 1.06) | slightly cool |
| 84 | grazing blend max | 0.82 | |
| 85 | miss return | 0.0 | black when the atmosphere is missed |

### A.4 `atmosphere.wgsl` — runtime aerial perspective

| # | Identifier | Value | Units |
|---|---|---|---|
| 86 | near-sky tilt | +0.42 | added to `viewDir.y` before normalise |
| 87 | near-sky mip | 3.0 | (64×32) |
| 88 | exact-sky mip | 0.0 | must match the skybox lookup |
| 89 | forward-lobe Mie g | 0.62 | |
| 90 | forward-lobe gain | 5.5 | |
| 91 | forward-lobe mix | 0.16 | × `sunRadiance` |
| 92 | inscatter ramp edge0 | 0.55 | on `ext` (~100 m) |
| 93 | inscatter ramp edge1 | 0.995 | on `ext` (~700 m) |
| 94 | flat-ray `|dy|` epsilon | 0.01 | metres |
| 95 | `length(d)` floor | 1e-4 | metres |

### A.5 `sky.vertex.wgsl`

| # | Identifier | Value | Units |
|---|---|---|---|
| 96 | far-plane clamp | `clip.w × 0.999999` | |

### A.6 `sky.fragment.wgsl` — `shadeRidge`

| # | Identifier | Value | Units |
|---|---|---|---|
| 97 | snowMask smoothstep edge0 | 0.46 | on `1 − N.y` |
| 98 | snowMask smoothstep edge1 | 0.80 | on `1 − N.y` |
| 99 | rock albedo | (0.052, 0.055, 0.066) | linear |
| 100 | snow albedo | (0.855, 0.885, 0.945) | linear |
| 101 | `INV_PI` | 0.31830988618 | |
| 102 | wrap on rock | 0.15 | |
| 103 | wrap on snow | 0.62 | |
| 104 | sss thickness | 0.45 | |
| 105 | sss radius | 1.0 | |
| 106 | sss survival in shadow | mix(0.5, 1.0, shadow) | |
| 107 | self-bounce weight | 0.30 | |
| 108 | self-bounce normal term | `clamp(−N.y×0.5 + 0.5, 0, 1)` | |

### A.7 `sky.fragment.wgsl` — main

| # | Identifier | Value | Units |
|---|---|---|---|
| 109 | ridge amp gate | > 1.0 | metres |
| 110 | ridge band upper | `dir.y < 0.230` | (+13.29°) |
| 111 | ridge band lower | `dir.y > −0.050` | (−2.87°) |
| 112 | solar disc angular radius | 0.0046 | radians (0.2636°) |
| 113 | limb r² factor | 0.72 | |
| 114 | limb exponent | 0.42 | |
| 115 | disc gain | 42.0 | × `sunColor × sunIntensity` |
| 116 | aureole exponent A | 1400.0 | half-max 1.80° |
| 117 | aureole gain A | 5.5 | |
| 118 | aureole exponent B | 64.0 | half-max 8.42° |
| 119 | aureole gain B | 0.28 | |
| 120 | aureole overall scale | 0.5 | |
| 121 | cloud gate | > 0.001 | on `cloudAmount` |
| 122 | cloud plane `dir.y` floor | 0.06 | |
| 123 | cloud plane scale | 0.5 | |
| 124 | cloud scroll rate | 0.004 | per second × windDir |
| 125 | cloud cross-wind squash | 0.28 | on `cp.x` |
| 126 | cloud fbmd octaves | 4 | |
| 127 | cloud fbmd lacunarity | 2.13 | |
| 128 | cloud fbmd gain | 0.52 | |
| 129 | cloud threshold | smoothstep(0.06, 0.34, n) | |
| 130 | cloud horizon fade | smoothstep(0.0, 0.22, dir.y) | |
| 131 | cloud zenith fade | smoothstep(0.55, 1.0, dir.y) × 0.45 | |
| 132 | cloud sunLit exponent | 3.0 | on `mu×0.5+0.5` |
| 133 | cloud base colour | (0.52, 0.60, 0.74) | linear |
| 134 | cloud sun tint gain | 1.35 | × `sunColor` |
| 135 | cloud sunLit mix | 0.75 | |
| 136 | cloud brightness base | 0.55 | |
| 137 | cloud brightness per intensity | 0.06 | × `sunIntensity` |
| 138 | cloud blend max | 0.62 | |

### A.8 `ridge.wgsl` — `ridgeField`

| # | Identifier | Value | Units |
|---|---|---|---|
| 139 | `ridgeCeiling` factor | 1.05 | × amp |
| 140 | metres→km scale | 0.001 | |
| 141 | bowl inner radius | 7000.0 | metres |
| 142 | bowl ramp width | 6000.0 | metres (full at 13 km) |
| 143 | massif frequency | 0.10 | per km |
| 144 | massif offset | (11.3, 4.7) | km |
| 145 | massif octaves | 2 | |
| 146 | massif lacunarity | 2.13 | |
| 147 | massif gain | 0.52 | |
| 148 | envelope bias | +0.34 | |
| 149 | envelope width (value) | 0.70 | |
| 150 | envelope width (derivative) | 0.62 | **QUIRK-3** |
| 151 | warp frequency | 0.26 | per km |
| 152 | warp offset A | (2.7, 8.1) | |
| 153 | warp offset B | (19.4, 3.6) | |
| 154 | warp amplitude | 1.35 | km |
| 155 | coarse ridged frequency | 0.30 | |
| 156 | coarse ridged octaves | 4 | |
| 157 | coarse ridged lacunarity | 2.09 | |
| 158 | coarse ridged gain | 0.50 | |
| 159 | fine ridged frequency | 1.05 | |
| 160 | fine ridged offset | (31.0, 17.0) | |
| 161 | fine ridged octaves | 3 | |
| 162 | fine ridged lacunarity | 2.11 | |
| 163 | fine ridged gain | 0.50 | |
| 164 | coarse weight | 0.78 | |
| 165 | fine weight | 0.22 | |
| 166 | crest cubic weight | 0.55 | |
| 167 | crest linear weight | 0.45 | |
| 168 | foothill floor | 0.06 | |
| 169 | envelope span | 0.94 | |
| 170 | curvature divisor | 12742000.0 | metres (Earth diameter) |

### A.9 `ridge.wgsl` — `ridgeMarch` / `ridgeShadow`

| # | Identifier | Value | Units |
|---|---|---|---|
| 171 | `D_NEAR` | 5500.0 | metres |
| 172 | `D_FAR` | 45000.0 | metres (schedule anchor only) |
| 173 | `STEPS` | 18 | |
| 174 | `growth` | 1.1238637 | `(45000/5500)^(1/18)` |
| 175 | horizontal-length epsilon | 1e-4 | |
| 176 | crossing denominator epsilon | 1e-5 | |
| 177 | crossing fallback `t` | 0.5 | |
| 178 | shadow first step | 420.0 | metres |
| 179 | shadow step count | 4 | |
| 180 | shadow step growth | 2.6 | |
| 181 | shadow `hl` epsilon | 1e-3 | |
| 182 | shadow result | 0.0 or 1.0 | binary |

### A.10 `noise.wgsl` (subset consumed)

| # | Identifier | Value |
|---|---|---|
| 183 | `PI` | 3.14159265359 |
| 184 | hash21 multiplier | 0.1031 |
| 185 | hash22 multipliers | (0.1031, 0.1030, 0.0973) |
| 186 | hash additive | 33.33 |
| 187 | TAU | 6.28318530718 |
| 188 | quintic fade | `f³(f(6f−15)+10)` |
| 189 | quintic derivative | `30f²(f(f−2)+1)` |
| 190 | fBm start amplitude | 0.5 |
| 191 | fBm start frequency | 1.0 |
| 192 | `fbmd` per-octave rotation | 0.517 rad |
| 193 | `ridgedd` per-octave rotation | 0.717 rad |
| 194 | `ridgedd` octave coupling | `mix(1.0, r², 0.65)` |

### A.11 `shading.wgsl` (subset consumed)

| # | Identifier | Value |
|---|---|---|
| 195 | `wrapDiffuse` denominator | `(1+w)²` |
| 196 | `backScatter` half-vector | `normalize(L + N·distortion)`, lobe on `dot(V, −H)` |
| 197 | `shallowTint` | (0.94, 0.965, 1.0) |
| 198 | `deepTint` | (0.55, 0.72, 1.0) |
| 199 | sss distortion | 0.28 × radius |
| 200 | sss power, thin | 3.0 |
| 201 | sss power, deep | 9.0 |
| 202 | sss amplitude, thin | 1.0 |
| 203 | sss amplitude, deep | 0.30 |
| 204 | `shIrradiance` c1 | 0.429043 |
| 205 | `shIrradiance` c2 | 0.511664 |
| 206 | `shIrradiance` c3 | 0.743125 |
| 207 | `shIrradiance` c4 | 0.886227 |
| 208 | `shIrradiance` c5 | 0.247708 |

### A.12 Downstream LUT consumers

| # | Identifier | Value |
|---|---|---|
| 209 | specular mip selector | `sqrt(roughness) × 6.0` |
| 210 | snow self-bounce weight | 0.28 |
| 211 | ice ambient-specular boost | `mix(1.0, 2.6, iceAmount)` |
| 212 | water refraction mip | 1.6 |
| 213 | crystal refraction mip | 0.9 |
| 214 | crystal reflection mip | `rough × 6.0` |
| 215 | crystal IOR, R | 1.3050 |
| 216 | crystal IOR, G | 1.3090 |
| 217 | crystal IOR, B | 1.3170 |
| 218 | character sheen rim exponent | 4.0, weight 0.55 |

### A.13 Derived verification targets at default settings

| # | Quantity | Value |
|---|---|---|
| 219 | `sunDir` | (0.86032, 0.22495, −0.45744) |
| 220 | zenith angle | 77.000° |
| 221 | Kasten–Young air mass | 4.3668 |
| 222 | beam transmittance | (0.73150, 0.55895, 0.28158) |
| 223 | `sunScale` | 23.10 |
| 224 | `sunRadiance` | (16.898, 12.912, 6.505) |
| 225 | `sunColor` | (1.0000, 0.76410, 0.38493) |
| 226 | `skyScale` | 2100 metres |
| 227 | `ridgeCeiling` | 2257.5 metres |
| 228 | haze scale height | 22.22 metres |
| 229 | observer horizon dip | −0.9086° ⇒ `dir.y = −0.015857` |
| 230 | far-march reach | ≈ 40.04 km (18 samples) |
| 231 | ridge shadow sample distances | 420, 1092, 2839.2, 7381.9 m |
| 232 | LUT angular resolution | 0.7031° per texel, both axes |
| 233 | SH LUT angular resolution | 5.625° per texel; 2048 texels |
| 234 | solar disc diameter | 0.5271° |
| 235 | aureole half-angles | 1.80° (n=1400) and 8.42° (n=64) |
| 236 | limb brightness at rim | 0.5866 × centre |
| 237 | `phaseMie(1, 0.76)` | 2.8299 |
| 238 | `phaseMie(1, 0.62) / phaseMie(−1, 0.62)` | 77.5× |
| 239 | forward-lobe add, toward sun | (16.7, 12.8, 6.4) |
| 240 | forward-lobe add, away from sun | (0.216, 0.165, 0.083) |
| 241 | disc centre add | (970, 741, 374) |

**Total distinct numeric constants captured: 241.**
