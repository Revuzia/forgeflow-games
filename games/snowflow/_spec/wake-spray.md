# SNOWFLOW — Snow-surf swept-mesh wake + spray particles
## Implementation spec for a Three.js r172 / WebGL2 / GLSL 3.00 es port

**Reference source (read-only):** `snowflow_demo/src/` — WebGPU + Babylon.js + WGSL.
**Files transcribed in full for this document:**

| Reference file | Role |
|---|---|
| `src/vfx/surfWake.js` | CPU spine ring, per-column resolve, data-texture upload, plume emission |
| `src/vfx/particles.js` | Pooled CPU particle simulation + billboard mesh + data texture |
| `src/shaders/lib/wake.wgsl` | `wakeSection`, `wakeScalars`, `wakeSpine`, `wakePoint`, `wakeEroded` — the surface definition |
| `src/shaders/wake.vertex.wgsl` | Vertex placement + differenced normals |
| `src/shaders/wake.fragment.wgsl` | Wake shading |
| `src/shaders/spray.vertex.wgsl` | Billboard expansion |
| `src/shaders/spray.fragment.wgsl` | Spray shading |

**Supporting files read for exactness (formulas quoted where the wake/spray depend on them):**
`src/shaders/wakeDepth.vertex.wgsl`, `src/shaders/wakeDepth.fragment.wgsl`,
`src/shaders/wakePrepass.vertex.wgsl`, `src/shaders/wakePrepass.fragment.wgsl`,
`src/shaders/lib/noise.wgsl`, `src/shaders/lib/shading.wgsl`, `src/shaders/lib/shadowLookup.wgsl`,
`src/shaders/lib/atmosphere.wgsl`, `src/shaders/lib/spellLights.wgsl`,
`src/character/controller.js`, `src/character/snowContact.js`, `src/core/camera.js`,
`src/core/settings.js`, `src/shaders/post/tonemap.fragment.wgsl`, `src/main.js`,
`src/render/shadows.js`, `src/render/depthPass.js`, `src/shaders/registry.js`.

---

# 0. What this subsystem is, in one paragraph

The wake is **a swept mesh, not a particle effect**. A ring buffer records the path the board has
taken, resampled every 30 cm of travel; each sample carries position, a right-vector, a per-side
amplitude, a per-side curl and an age. That ring is written into a **96 × 3 RGBA32F data texture**
and the mesh itself is a **static lattice whose only vertex attribute is `(column, row, side)`** —
every vertex position is computed in the vertex shader from the data texture, so a 17-metre wake
and a 2-metre wake cost the same vertex buffer and the same 4.6 KB upload. The cross-section is a
**breaking wave integrated from a turning tangent**: the tangent angle sweeps from just below
horizontal at the base to up to **284°** at the tip, so a single `curl` parameter runs continuously
from a low heaped bank to a lip that hangs back across its own face. Amplitude and curl are
resolved **per side on the CPU** from the signed carve, so the outside of a turn takes nearly all
the snow. Amplitude peaks at **2.4 m** on a full-speed hard carve and decays quadratically to zero
**0.88 s** after the sample was laid, which makes wake length `LIFE × speed` with no second
constant. Normals are **finite-differenced out of the same `wakePoint`** the geometry uses.
Two spray populations (a dense slow crest curtain and ballistic flung grains) plus a third slow
"still smoking" drift stream are emitted at **fractional** positions along that same spine, into
one pooled 5120-particle CPU-simulated billboard system. Screen-space radial speed streaks and
trauma-based camera shake complete the read.

---

# 1. System topology and per-frame ordering

## 1.1 Frame order (`src/main.js`, render loop)

```
character.update(dt, rig)          // controller: velocity, facing, surf, carve, speed, streak01
rig.update(dt, pos, vel, lean, speed01)   // camera spring arm + trauma shake
post.update(dt, character.streak01, rig.distance)   // publishes speedStreak to the tonemap pass
sky.update(); sky.render(rig, time)
shadows.update(rig.camera, sky.sunDir)    // 3 cascades refit
spells.update(dt, camPos)
terrain.update(camPos, charPos, dt)        // deformation sim pass (groove + berms already staged)
figure.sync(camPos)
wake.update(dt, camPos)            // <-- spine advance, resolve, data-tex upload, plume emission
spray.update(dt, camPos)           // <-- particle integrate + data-tex upload   (MUST be after wake)
scene.render()
post.endFrame()
```

`wake.update` **must** run before `spray.update`: the wake decides where its own lip is and emits
grains into the pool, and those grains must be in the pool before the pool is uploaded. Emitting
after the upload costs one frame of latency and desynchronises plume from crest during a turn.

## 1.2 Passes the wake mesh participates in

| Pass | Vertex program | Fragment program | Notes |
|---|---|---|---|
| Shadow cascades 0 and 1 only (`WAKE_CASCADES = 2`) | `wakeDepth.vertex` | `wakeDepth.fragment` | Same `wakePoint`, same `wakeEroded` discard. Writes `gl_FragCoord.z`. |
| Camera-space depth prepass | `wakePrepass.vertex` | `wakePrepass.fragment` | Writes `clip.w` (linear view depth) into `.r`. Same erosion discard. |
| Beauty (opaque, `renderingGroupId = 1`) | `wake.vertex` | `wake.fragment` | Double-sided, opaque, depth-write on. |

The wake **casts** shadows and **receives** the sun cascade lookup for its direct/spec/SSS terms,
but it is deliberately given **no ambient occlusion from any external source** — see §6.6.

The spray mesh is in `renderingGroupId = 2` (after opaque), alpha-blended, `depthWrite = false`,
double-sided, and does not cast shadows or appear in the prepass.

`scene.setRenderingAutoClearDepthStencil(1, false)` and `(2, false)` — groups 1 and 2 share the
depth buffer written by group 0/1.

## 1.3 What is baked once vs per frame

| Item | When | Size |
|---|---|---|
| Wake lattice vertex buffer (`position` = column,row,side) | Once at construction | 4608 verts × 3 floats = 55.3 KB |
| Wake index buffer (Uint32) | Once at construction | 25908 indices = 103.6 KB |
| Wake spine data texture 96×3 RGBA32F | Rewritten every frame the wake is visible | 4608 B (4.5 KiB) |
| Spray quad vertex buffer (`position` = index,cornerX,cornerY) | Once at construction | 20480 verts × 3 floats = 245.8 KB |
| Spray index buffer (Uint32) | Once at construction | 30720 indices = 122.9 KB |
| Spray particle data texture 5120×2 RGBA32F | Rewritten every frame | 163840 B (160 KiB) |

**Nothing in this subsystem allocates in the render loop.** All CPU arrays are typed arrays sized
at construction; dead particles are recycled through a free-scan ring rather than compacted.

---

# 2. CPU side — the spine (`src/vfx/surfWake.js`)

## 2.1 Module constants (verbatim)

```js
const SPINE_MAX = 96;      // spine capacity; 95 gaps x 0.30 m = 28.5 m of path
const SPINE_STEP = 0.30;   // metres of travel between committed samples
const LIFE = 0.88;         // seconds a thrown wall stays up  -> length = LIFE * speed
const BOW_LEAD = 0.55;     // metres the bow sits ahead of the player
const MAX_HEIGHT = 2.4;    // peak wall amplitude, metres, at a full-speed hard carve
const COLS = 128;          // lattice columns along the spine
const ROWS = 18;           // lattice rows across the wave section
const WAKE_CASCADES = 2;   // how many shadow cascades the wake casts into
```

Derived: at the controller's `SURF_MAX = 19.5 m/s`, wake length ≈ `0.88 × 19.5 = 17.16 m`
(+ `BOW_LEAD` in the reported `dist`, so the tail column's `dist` ≈ 17.7 m). At a jog (5.4 m/s)
the wake is ≈ 4.75 m. Spine capacity 28.5 m is comfortably past that.

The mesh has **128 columns for at most 96 spine samples**, so the lattice always *over*-samples the
spine — never the reverse. `u` is the lattice parameter; the spine index is `u × (n − 1)`.

## 2.2 Ring-buffer state (all `Float32Array(SPINE_MAX)` unless noted)

| Array | Meaning | Units |
|---|---|---|
| `_x`, `_y`, `_z` | sample world position (bow point, ground height) | m |
| `_rx`, `_rz` | the character's **right** vector at lay time: `(cos(facing), −sin(facing))` | unit |
| `_travel` | odometer reading when laid | m |
| `_laid` | clock reading when laid | s |
| `_strength` | wave strength captured at lay time | 0..1 |
| `_carve` | signed carve captured at lay time (positive = turning right) | −1..1 (unclamped input) |
| `_ampL`, `_ampR` | resolved per-side amplitude (written by `_resolve`, read by `_plume`) | m |
| `_dist` | resolved distance behind bow (written by `_resolve`) | m |
| `_col` (`Int32Array`) | ring index of each *column*, newest first | — |

Scalars: `_head` (index of the newest, live sample), `_count`, `_odo` (odometer, m),
`_clock` (s), `_active`, `_plumeOwed` (m), `_driftOwed` (m).

**Forward vector convention.** `facing` is a yaw where forward = `(sin f, 0, cos f)` and right =
`(cos f, 0, −sin f)`. Stored `(rx, rz) = (cos f, −sin f)`; forward is recovered anywhere it is
needed as `(−rz, 0, rx)`. Both the shader (`fwd = vec3f(-rgt2.y, 0, rgt2.x)`) and the CPU plume
(`fx = -rz; fz = rx`) rebuild forward this way. **Do not store forward separately** — one basis,
one convention.

## 2.3 `update(dt, cameraPos)` — control flow, in order

```js
this._camPos.copyFrom(cameraPos);
this._clock += dt;

const moved = hypot(ch.velocity.x, ch.velocity.z) * dt;
this._odo += moved;

// Below a walking pace nothing is being displaced.
const active = ch.surf > 0.06 && ch.speed > 1.6;

if (active) {
    if (!this._active) this._maybeRestart();
    this._writeHead();
    this._active = true;
} else {
    this._active = false;
}

this._retire();
const maxAmp = this._resolve();

this.mesh.isVisible = this._enabled && this._count >= 2 && maxAmp > 0.01;
if (this.mesh.isVisible) { this.dataTex.update(this._texData); this._pushUniforms(); }

if (this.spray) this._plume(dt);
```

Note the ordering consequences: `_retire()` runs **before** `_resolve()`, so a column that has
just passed `LIFE` is dropped, not drawn at zero. The plume runs even when the mesh is invisible
(the gate inside `_plume` is separate and stricter).

## 2.4 `_maybeRestart()` — a new run starts a new spine

```js
if (this._count === 0) return;
const age = this._clock - this._laid[this._head];
if (age > 0.25) this._count = 0;
```

**Why:** reconnecting the spine would sweep a wall of snow across whatever ground lies between
where the player stopped and where they started again — if they turned around, a wave running
backwards through the field. 0.25 s is the hysteresis.

## 2.5 `_writeHead()` — the live bow sample, committed on travel

```js
const fx = Math.sin(ch.facing), fz = Math.cos(ch.facing);
const bx = ch.position.x + fx * BOW_LEAD;
const bz = ch.position.z + fz * BOW_LEAD;

_x[i] = bx;
_y[i] = terrain.heightAt(bx, bz);      // the *undeformed-plus-deformed* sampled surface height
_z[i] = bz;
_rx[i] = Math.cos(ch.facing);
_rz[i] = -Math.sin(ch.facing);
_travel[i] = this._odo;
_laid[i]   = this._clock;
_strength[i] = ch.surf * clamp01((ch.speed - 2.2) / 9.0);   // full strength at >= 11.2 m/s
_carve[i]    = ch.carve;

if (this._count === 0) { this._count = 1; return; }

// Commit once the bow has travelled a full step from the previous fixed sample.
const p = (i - 1 + SPINE_MAX) % SPINE_MAX;
const dx = _x[i] - _x[p], dz = _z[i] - _z[p];
if (this._count === 1 || dx*dx + dz*dz >= SPINE_STEP * SPINE_STEP) {
    this._head = (i + 1) % SPINE_MAX;
    if (this._count < SPINE_MAX) this._count++;
    // Seed the new live sample from the one it follows, so a frame in which the
    // head has not been written yet is still a valid spine.
    const n = this._head;
    _x[n]=_x[i]; _y[n]=_y[i]; _z[n]=_z[i];
    _rx[n]=_rx[i]; _rz[n]=_rz[i];
    _travel[n]=_travel[i]; _laid[n]=_laid[i];
    _strength[n]=_strength[i]; _carve[n]=_carve[i];
}
```

**Semantics that must be reproduced exactly:** the head sample is *rewritten every frame* while
surfing (so the bow tracks the player continuously), and it *freezes* the moment the bow has moved
`SPINE_STEP` from the previous fixed sample. The spine is therefore **a record of the path**, not a
resampling of a smoothed path. The seeding of the new head from the old one is what keeps a
mid-frame spine valid.

## 2.6 `_retire()`

```js
while (this._count > 0) {
    const tail = (this._head - this._count + 1 + SPINE_MAX) % SPINE_MAX;
    if (this._clock - this._laid[tail] <= LIFE) break;
    this._count--;
}
```

## 2.7 `_resolve()` — the per-column amplitude/curl solve and the texture write

This is the heart of the CPU side. It runs newest-first: column `j = 0` is the bow.

```js
const heightScale = MAX_HEIGHT * S.wakeHeight;   // 2.4 * slider (default 1.0)
let maxAmp = 0;

for (let j = 0; j < n; j++) {
    const i = (this._head - j + SPINE_MAX) % SPINE_MAX;
    this._col[j] = i;

    const dist = this._odo - this._travel[i] + BOW_LEAD;          // metres behind the bow
    const a01  = clamp01((this._clock - this._laid[i]) / LIFE);   // 0 = just laid, 1 = dead

    // Rise: small at the bow, full by ~1.6 m behind it.
    // Fall: quadratic to exactly zero at end of life, so the tail column
    //       degenerates onto its own spine rather than ending in a cut edge.
    const shape = 0.34 + 0.66 * smoothstep01((dist - 0.3) / 1.3);   // == smoothstep(0.3, 1.6, dist)
    const env   = (1 - a01) * (1 - a01);
    const base  = heightScale * this._strength[i] * shape * env;

    // Outside of the turn takes the snow. `carve` is positive turning RIGHT,
    // and the outside of a right turn is the LEFT-hand side.
    const c = this._carve[i];
    const biasL = c < -1 ? -1 : c > 1 ? 1 : c;      // clamp(c, -1, 1)
    const biasR = -biasL;

    const ampL = base * clampRange(0.45 + 0.55 * biasL, 0.05, 1.0);
    const ampR = base * clampRange(0.45 + 0.55 * biasR, 0.05, 1.0);
    const curlL = clampRange(0.42 + 0.58 * biasL, 0.26, 1.0);
    const curlR = clampRange(0.42 + 0.58 * biasR, 0.26, 1.0);

    if (ampL > maxAmp) maxAmp = ampL;
    if (ampR > maxAmp) maxAmp = ampR;
    this._ampL[j] = ampL; this._ampR[j] = ampR; this._dist[j] = dist;

    const o0 = j * 4;
    const o1 = (SPINE_MAX + j) * 4;
    const o2 = (SPINE_MAX * 2 + j) * 4;
    d[o0]=_x[i]; d[o0+1]=_y[i]; d[o0+2]=_z[i]; d[o0+3]=dist;
    d[o1]=_rx[i]; d[o1+1]=_rz[i]; d[o1+2]=ampL; d[o1+3]=ampR;
    d[o2]=curlL; d[o2+1]=curlR; d[o2+2]=a01; d[o2+3]=0;
}
return maxAmp;
```

### Resolved side behaviour (compute this table in your port as a unit test)

| `carve` | `biasL` | `ampL / base` | `curlL` | `ampR / base` | `curlR` |
|---|---|---|---|---|---|
| `0.0` (straight) | 0.00 | 0.450 | 0.420 | 0.450 | 0.420 |
| `+0.5` (right turn) | +0.50 | 0.725 | 0.710 | 0.175 | 0.260 (clamped) |
| `+1.0` (hard right) | +1.00 | 1.000 | 1.000 | 0.050 (clamped) | 0.260 (clamped) |
| `−1.0` (hard left) | −1.00 | 0.050 (clamped) | 0.260 (clamped) | 1.000 | 1.000 |

So a full carve puts **100 % of the amplitude outboard and 5 % inboard — a 20:1 split** — with the
outboard wall fully plunging (curl 1.0) and the inboard one at the minimum bank (curl 0.26).

## 2.8 The spine data texture — layout (authoritative)

`RawTexture.CreateRGBATexture(data, 96, 3, scene, noMipmap=false, invertY=false, NEAREST, FLOAT)`
with `wrapU = wrapV = CLAMP`. Dimensions **96 wide × 3 tall**, RGBA32F, one **column per sample**,
**column 0 = the bow**.

| Row | `.r` | `.g` | `.b` | `.a` |
|---|---|---|---|---|
| 0 | world **x** | world **y** (ground height at the sample) | world **z** | **distance behind the bow**, metres |
| 1 | right **x** (`cos facing`) | right **z** (`−sin facing`) | **amplitude left**, metres | **amplitude right**, metres |
| 2 | **curl left** (0.26..1.0) | **curl right** | **age** 0..1 | unused (written 0) |

Backing array is `Float32Array(SPINE_MAX * 3 * 4)` laid out **row-major by texture row**:
row 0 occupies floats `[0 .. 96*4)`, row 1 `[96*4 .. 192*4)`, row 2 `[192*4 .. 288*4)`.
Columns `j >= _count` hold stale data and are never addressed, because every fetch clamps
`u` into `[0, n−1]`.

## 2.9 Uniforms pushed per frame (`_pushUniforms`)

Beauty material: `cameraPos`, `wakeCount` (= `_count`), `wakeTime` (= `_clock`), `wakeDebug`,
`sunDir`, `sunRadiance`, `shR[9]`, `cascadeMatrices[3]`, `cascadeSplits` (vec4),
`cascadeParams[3]` (vec4: depthRange m, orthoWidth m, –, –), `shadowTexel` (= 1/2048),
**`shadowSoftness = 1.5`**, **`shadowBias = 0.018`**, `fogDensity`, `fogHeightFalloff`,
`fogStart`, `aerialStrength`, `ambientIntensity`, `sssStrength`, `glintIntensity`, `glintGrazing`,
plus the 4-light spell pool. Constants set once: `wakeCols = 128`, `wakeRows = 18`.

Depth and prepass materials get only `wakeCount` and `wakeTime` per frame (plus their own
`lightViewProjection` / `viewProjection`), and `wakeCols` / `wakeRows` once.

## 2.10 The static lattice (`buildLattice`)

```js
const perSide = COLS * ROWS;                                   // 128 * 18 = 2304
const pos = new Float32Array(perSide * 2 * 3);                 // 4608 vertices
const idx = new Uint32Array((COLS - 1) * (ROWS - 1) * 2 * 6);  // 25908 indices -> 8636 triangles

for (let s = 0; s < 2; s++) {
    const side = s === 0 ? -1 : 1;
    const base = s * perSide;
    for (let c = 0; c < COLS; c++)
        for (let r = 0; r < ROWS; r++) { pos[vi++] = c; pos[vi++] = r; pos[vi++] = side; }
    for (let c = 0; c < COLS - 1; c++)
        for (let r = 0; r < ROWS - 1; r++) {
            const a = base + c * ROWS + r;
            const b = a + ROWS;
            idx[ii++]=a; idx[ii++]=b;   idx[ii++]=b+1;
            idx[ii++]=a; idx[ii++]=b+1; idx[ii++]=a+1;
        }
}
```

Vertex order is **row-major within a column** (`c * ROWS + r`). `side` is `−1` for the first
2304 vertices and `+1` for the second. `mesh.alwaysSelectAsActiveMesh = true`,
`isPickable = false`, `freezeWorldMatrix()`, `doNotSyncBoundingInfo = true` — i.e. **no frustum
culling and no bounding-volume maintenance** (the CPU has no idea where the mesh is).
`backFaceCulling = false` on every wake material: it is an open curled sheet and both faces are
routinely visible in the same frame through the holes torn in the lip.

## 2.11 Warm-up synthetic spine

Before the loading screen lifts, a straight 24-sample spine is laid under the player so the
pipelines compile with real triangles through them:

```js
const n = 24; this._count = n;
for (let j = 0; j < n; j++) {
    const dist = j * SPINE_STEP + BOW_LEAD;
    const x = ch.position.x, z = ch.position.z - dist;
    const a01 = j / n;
    const amp = 0.8 * (1 - a01) * (1 - a01);
    row0 = (x, terrain.heightAt(x,z), z, dist);
    row1 = (1, 0, amp, amp);
    row2 = (0.7, 0.7, a01, 0);
}
```

---

# 3. The surface definition — `src/shaders/lib/wake.wgsl`

This include is shared **verbatim** by the beauty vertex shader, the shadow-depth vertex shader and
the camera-depth-prepass vertex shader, and the erosion function by all three fragment stages.
Three copies of a surface definition eventually disagree, and the symptom — a shadow that is not
quite the shape of the thing casting it — is both subtle and impossible to attribute. **Port it as
one GLSL include string too.**

## 3.1 Cross-section constants

```wgsl
const WAKE_STEPS: i32 = 20;    // midpoint-rule steps in the cross-section integral
const WAKE_NORM: f32 = 3.35;   // normalises the integral so the crest lands near 1.0
const WAKE_LATERAL: f32 = 0.70;// the section is SQUASHED ACROSS, not scaled uniformly
```

`WAKE_NORM` is what lets `amplitude` be one number in metres rather than a per-curl table. It is
deliberately **not exact across the curl range**: a mild bank comes out a little taller and much
wider than a plunging one, which is what a mild bank does.

`WAKE_LATERAL` exists because, left to its own proportions, the curve is wider than it is tall —
at 2.4 m of amplitude that is a three-metre-wide ramp, legible as terrain rather than as something
thrown. Steepening it is the difference between a bank and a wave.

## 3.2 `wakeSection` — the breaking-wave cross-section (VERBATIM, then annotated)

```wgsl
fn wakeSection(q: f32, curl: f32) -> vec2f {
    let th0 = -0.24;                     // base flares outward and slightly down
    let th1 = 1.65 + curl * 3.30;        // 95 deg (heap) .. 284 deg (plunging)
    var p = vec2f(0.0, 0.0);
    let dt = q / f32(WAKE_STEPS);
    for (var i = 0; i < WAKE_STEPS; i++) {
        let t = (f32(i) + 0.5) * dt;
        let th = th0 + (th1 - th0) * pow(t, 1.65);
        // The section thins as it climbs, so the lip is fine and the base broad.
        p += vec2f(cos(th), sin(th)) * (1.0 - 0.40 * t) * dt;
    }
    return vec2f(p.x * WAKE_LATERAL, p.y) * WAKE_NORM;
}
```

**This is the single most important function in the subsystem. Transcribe it literally.**

Annotation, term by term:

* The curve is defined by its **tangent angle**, not by its position. `θ(t)` sweeps from
  `θ₀ = −0.24 rad = −13.75°` (just below horizontal — the base flares outward and slightly *down*
  into the trench) to `θ₁ = 1.65 + 3.30·curl` radians.
  * `curl = 0`   → `θ₁ = 1.65 rad = 94.5°` — barely past vertical: a heaped bank.
  * `curl = 0.26` (the clamp floor, the inside of a hard turn) → `θ₁ = 2.508 rad = 143.7°`.
  * `curl = 0.42` (straight running) → `θ₁ = 3.036 rad = 173.9°`.
  * `curl = 1`   → `θ₁ = 4.95 rad = **283.6°**` — the tangent has passed 270°, so the tip is
    heading back *inboard and downward*: the lip hangs back over the face it came off.
  * **Stopping short of ~270° leaves the tip still outboard of the crest, which reads as a rounded
    ridge, not as a breaking wave.**
* The **1.65 exponent** on `t` puts most of the arc length into the face and compresses the hook
  into the last fifth of `q`. A linear sweep integrates to a circle, which reads as a rolled tube
  of snow rather than as something thrown.
* `(1.0 − 0.40·t)` is a **thinning taper on the arc-length element**: the section thins as it
  climbs, so the lip is fine and the base broad. Note it multiplies the step *length*, not the
  angle.
* Integration is the **midpoint rule** with 20 steps over `[0, q]` — i.e. the sample parameter is
  `t = (i + 0.5)·(q/20)`, and `dt = q/20`. Evaluating at `t = i·dt` instead visibly changes the
  base flare.
* The integral is evaluated **from 0 to q**, freshly, at every vertex — it is not a prefix sum over
  a fixed 20-step table. `q` is the row parameter, so a vertex at `q = 0.5` runs 20 steps over
  `[0, 0.5]` with `dt = 0.025`.
* Return is `(lateral, up)` in **unit-amplitude space**; both components are taken to metres by
  multiplying by the side's resolved amplitude in `wakePoint`.

### Reference values (computed from the code above this session — use as porting unit tests)

`wakeSection(q, curl)` returns `(lat, up)`:

| curl | θ₁ (deg) | q=0.25 | q=0.50 | q=0.75 | q=1.00 (tip) | max lat (at q) | max up (at q) |
|---|---|---|---|---|---|---|---|
| 0.26 | 143.7 | (0.5498, −0.1085) | (1.0175, 0.1050) | (1.2395, 0.6266) | (1.1016, 1.1091) | 1.2400 @ 0.80 | 1.1091 @ 1.00 |
| 0.42 | 173.9 | (0.5504, −0.0929) | (0.9969, 0.1880) | (1.1231, 0.7636) | (0.8638, 1.1164) | 1.1327 @ 0.70 | 1.1164 @ 1.00 |
| 0.50 | 189.1 | (0.5505, −0.0851) | (0.9846, 0.2280) | (1.0605, 0.8170) | (0.7585, 1.0816) | 1.0861 @ 0.65 | 1.0828 @ 0.95 |
| 0.70 | 226.9 | (0.5505, −0.0655) | (0.9480, 0.3223) | (0.8983, 0.9053) | (0.5547, 0.9164) | 0.9919 @ 0.60 | 1.0100 @ 0.90 |
| 1.00 | 283.6 | (0.5495, −0.0364) | (0.8798, 0.4463) | (0.6639, 0.9214) | (0.4303, 0.5992) | 0.8815 @ 0.55 | 0.9214 @ 0.75 |

Key structural facts a correct port reproduces:

* **`up` is negative for the first ~third of `q`** at every curl — the base dips *below* the spine
  before it climbs. That, plus the `−0.10 m` sink in `wakePoint`, is what buries the foot of the
  wall in the trench.
* At `curl = 1` the **tip sits at 49 % of the section's maximum lateral extent and 65 % of its
  maximum height** — the tip is well inboard of the widest point *and* below the highest point,
  i.e. genuinely overhanging.
* At `curl = 0.26` the tip is at 89 % of max lateral and 100 % of max height — a rounded heaped
  bank with no overhang at all.
* Peak world height above the spine ≈ `amp × max(up) − 0.10 m`. At full amplitude 2.4 m that is
  **2.56 m** at curl 0.26 and **2.11 m** at curl 1.0.

## 3.3 `wakeScalars` — per-side scalars at spine parameter `u` (VERBATIM)

```wgsl
fn wakeScalars(tex: texture_2d<f32>, count: f32, u: f32, side: f32) -> vec4f {
    let n = max(count, 2.0);
    let f = clamp(u, 0.0, 1.0) * (n - 1.0);
    let i1 = i32(floor(f));
    let i2 = min(i1 + 1, i32(n) - 1);
    let s = smoothstep(0.0, 1.0, f - f32(i1));

    let b1 = textureLoad(tex, vec2i(i1, 1), 0);
    let b2 = textureLoad(tex, vec2i(i2, 1), 0);
    let c1 = textureLoad(tex, vec2i(i1, 2), 0);
    let c2 = textureLoad(tex, vec2i(i2, 2), 0);
    let d1 = textureLoad(tex, vec2i(i1, 0), 0).w;
    let d2 = textureLoad(tex, vec2i(i2, 0), 0).w;

    let left = side < 0.0;
    let amp  = select(mix(b1.w, b2.w, s), mix(b1.z, b2.z, s), left);
    let curl = select(mix(c1.y, c2.y, s), mix(c1.x, c2.x, s), left);
    return vec4f(amp, curl, mix(d1, d2, s), mix(c1.z, c2.z, s));
}
```

Returns **`(amplitude m, curl, distance-behind-bow m, age 0..1)`**.

**The `smoothstep` on the interpolation weight is load-bearing.** The samples are 0.3 m apart and
the amplitude envelope changes by a couple of percent between them; a linear blend makes the field
C0, which is invisible in the silhouette but plainly visible as a band every 0.3 m once a normal is
finite-differenced out of it. Smoothstep costs one multiply and makes it C1.

`select(falseVal, trueVal, cond)` in WGSL — **note the argument order reverses in GLSL's ternary.**

## 3.4 `wakeSpine` — Catmull-Rom spine position (VERBATIM)

```wgsl
fn wakeSpine(tex: texture_2d<f32>, count: f32, u: f32) -> vec3f {
    let n = max(count, 2.0);
    let f = clamp(u, 0.0, 1.0) * (n - 1.0);
    let i1 = i32(floor(f));
    let fr = f - f32(i1);
    let last = i32(n) - 1;

    let p0 = textureLoad(tex, vec2i(max(i1 - 1, 0), 0), 0).xyz;
    let p1 = textureLoad(tex, vec2i(i1, 0), 0).xyz;
    let p2 = textureLoad(tex, vec2i(min(i1 + 1, last), 0), 0).xyz;
    let p3 = textureLoad(tex, vec2i(min(i1 + 2, last), 0), 0).xyz;

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

Uniform Catmull-Rom, tension 0.5, endpoints clamped. **Why not linear:** geometrically linear
would be fine (at 19.5 m/s and the controller's turn rate the sagitta over one 0.3 m segment is
1.4 mm) — but the surface normal is differenced out of this, and a piecewise-linear spine gives a
piecewise-*constant* tangent, which bands the crest highlight at exactly the sample pitch.

## 3.5 `wakePoint` — the surface (VERBATIM, then annotated line by line)

```wgsl
/// The wake surface. `u` runs 0 (bow) to 1 (tail), `q` runs 0 (base, against the
/// trench) to 1 (tip of the lip), `side` is -1 or +1.
fn wakePoint(tex: texture_2d<f32>, count: f32, u: f32, q: f32, side: f32, t: f32) -> vec3f {
    let sc = wakeScalars(tex, count, u, side);
    let pos = wakeSpine(tex, count, u);

    let i1 = i32(clamp(u, 0.0, 1.0) * (max(count, 2.0) - 1.0));
    let rgt2 = normalize(textureLoad(tex, vec2i(i1, 1), 0).xy);
    let rgt = vec3f(rgt2.x, 0.0, rgt2.y);
    let fwd = vec3f(-rgt2.y, 0.0, rgt2.x);

    let sec = wakeSection(q, sc.y);

    let l0 = 0.24 + 0.44 * smoothstep(0.3, 2.6, sc.z);

    let thq = -0.24 + (1.89 + sc.y * 3.30) * pow(q, 1.65);
    let secN = vec2f(-sin(thq), cos(thq));
    let lump = (noise2(vec2f(sc.z * 1.13 + q * 0.9 + side * 17.3, q * 1.7 + 5.1 + t * 0.30)) * 0.55
              + noise2(vec2f(sc.z * 3.31 - q * 1.7 + side * 31.7 - t * 0.45, q * 4.3 + 2.7)) * 0.30
              + noise2(vec2f(sc.z * 8.7 + side * 5.3, q * 9.1 + t * 0.9)) * 0.15)
             * 0.085 * smoothstep(0.12, 0.72, q);

    let lat = l0 + (sec.x + secN.x * WAKE_LATERAL * lump) * sc.x;

    let along = -q * q * 0.34 * sc.x;

    return pos
        + rgt * (side * lat)
        + vec3f(0.0, (sec.y + secN.y * lump) * sc.x - 0.10, 0.0)
        + fwd * along;
}
```

### Annotation

**`i1` for the basis is a truncation, not a floor-plus-fraction.** The right/forward basis is
fetched from a **single column** — `i32(u·(n−1))`, which truncates — so the frame is **piecewise
constant per spine segment** while position (Catmull-Rom) and scalars (smoothstep-lerped) are both
interpolated. This asymmetry is deliberate and must be reproduced; interpolating and renormalising
the basis changes the wake's twist through a turn.

**`l0` — the lateral base offset.**
`l0 = 0.24 + 0.44 · smoothstep(0.3, 2.6, dist)` metres, so the two walls start **0.24 m** either
side of the spine at the bow and spread to **0.68 m** by 2.6 m behind it. Two reasons, both
load-bearing: (1) converging at the bow is what makes the pair read as a bow wave *splitting
around the board* rather than as two unrelated banks; (2) the base has to clear the berm the
deformation groove brush throws at 0.45–0.6 m, or the wall grows out of the inside of its own
trench and its first third is buried.

**`thq` and `secN` — the lump is displaced along the section's own normal.**
Read `thq` carefully: `wakeSection` computes `th = θ₀ + (θ₁ − θ₀)·t^1.65` with
`θ₁ − θ₀ = (1.65 + 3.30·curl) − (−0.24) = 1.89 + 3.30·curl`. So

```
thq == the section's tangent angle evaluated at t = q
secN = (−sin thq, cos thq) == the left-hand unit normal of that tangent
```

The **1.89** is therefore not a magic number: it is `1.65 + 0.24`. A port that copies 1.65 here
gets a normal that is wrong by up to 13.75° of rotation and the lumps shear along the face.

**The lump field.** Three octaves of gradient noise at incommensurate frequencies, all of which
vary **both up the face (`q`) and along the spine (`dist`)**:

| Octave | x argument | y argument | weight |
|---|---|---|---|
| 1 | `dist·1.13 + q·0.9 + side·17.3` | `q·1.7 + 5.1 + t·0.30` | 0.55 |
| 2 | `dist·3.31 − q·1.7 + side·31.7 − t·0.45` | `q·4.3 + 2.7` | 0.30 |
| 3 | `dist·8.7 + side·5.3` | `q·9.1 + t·0.9` | 0.15 |

then `× 0.085 × smoothstep(0.12, 0.72, q)`.

* `side·17.3`, `side·31.7`, `side·5.3` **decorrelate the two walls** (side is ±1, so the two walls
  sample 34.6 / 63.4 / 10.6 units apart in the noise field).
* Octaves 1 and 3 drift **forward** in time (`+t·0.30`, `+t·0.9`), octave 2 drifts **backward**
  (`−t·0.45`) — a static lump field on a moving wall is the surface equivalent of a painted-on
  texture.
* `smoothstep(0.12, 0.72, q)` weights the field **toward the crest**: the base is held in place by
  the ground, the top is free to gather.
* Amplitude `0.085` is in **unit-section space** — like `sec`, it is taken to metres by the same
  `sc.x` amplitude, so a 2.4 m wall gets up to ~0.2 m of lump and a 0.2 m one gets 1.7 cm.
* Because the lump is applied **here**, in the surface function, the differenced vertex normal
  picks it up for free — and so does the shadow the wake casts. Applying it in the fragment shader
  instead loses both.
* Single-octave keyed only on distance puts one bump per noise cell in a dead straight line,
  0.37 m apart at the same height all the way down the wake: the wall comes out looking like a
  caterpillar. **Three octaves, or the artefact returns.**

**Asymmetric lump application.** Lateral gets `secN.x · WAKE_LATERAL · lump`; vertical gets
`secN.y · lump` with **no** `WAKE_LATERAL`. This is consistent with `sec` itself (whose `.x` was
already multiplied by `WAKE_LATERAL` inside `wakeSection` and whose `.y` was not) — the whole
section, lumps included, is squashed laterally by 0.70.

**`along` — backward shear, not offset.**
`along = −q²·0.34·amp`, applied along `fwd`. Thrown snow lags the thing that threw it, so the lip
trails backward along the spine by up to **0.34 × amplitude metres** (0.82 m on a 2.4 m wall).
Quadratic in `q`, so the base does not move and the shear grows toward the lip. A **shear** rather
than an offset: the surface stays connected.

**`−0.10` — the sink.** A flat 10 cm downward offset applied to the whole section, because the base
has to meet a trench floor and a berm crest that the spine's recorded ground height knows nothing
about.

**Order of composition** (matters for reproducing exact values):
`pos` (Catmull-Rom spine) `+ rgt·(side·lat)` `+ (0, sectionUp·amp − 0.10, 0)` `+ fwd·along`.
Vertical is **world-vertical**, not section-vertical: the section's "up" is always world +Y,
never tilted by the terrain normal.

## 3.6 `wakeEroded` — the breakup mask (VERBATIM)

```wgsl
fn wakeEroded(alongDist: f32, q: f32, age01: f32, t: f32) -> bool {
    let brk = smoothstep(0.84, 1.06, q) * mix(0.34, 0.70, age01)
            + smoothstep(0.68, 1.0, age01) * 0.95;
    if (brk <= 0.001) { return false; }
    let p = vec2f(alongDist, q);
    let a = noise2(vec2f(
        p.x * 6.9 + p.y * 3.1 + t * 0.9,
        p.y * 13.0 - p.x * 2.2 - t * 0.6
    )) * 0.72 + 0.5;
    let b = noise2(vec2f(
        p.x * 19.0 - p.y * 9.0 + 31.7 - t * 3.1,
        p.y * 31.0 + p.x * 7.0 + t * 2.3
    )) * 0.72 + 0.5;
    return (a * 0.58 + b * 0.42) < brk;
}
```

Called **identically** from the beauty fragment shader, the shadow-depth fragment shader and the
depth-prepass fragment shader. If the depth passes skip it, the wake casts the shadow of a solid
wall it is not drawing, which on a crest that is half powder is the difference between a shadow and
a stripe.

Design constraints encoded in the numbers:

* **Two jobs only.** (1) Soften the very top edge — `smoothstep(0.84, 1.06, q)` is a narrow band,
  the top ~16 % of the section, and lightly (threshold 0.34 fresh → 0.70 old). (2) Dissolve the
  whole wall at the end of life — `smoothstep(0.68, 1.0, age01) × 0.95` takes the entire surface to
  powder over the last third of its life. **It is deliberately not a third job:** tearing the top
  *half* into chunks reads as a breaking wave in a still frame and as a mesh with holes in it in
  motion. Breakup is the plume's job.
* **13 cells across the section, not 4.5.** `p.y × 13.0` and `p.y × 31.0`. Any coarser in `q` and
  the noise is effectively one-dimensional, so the holes come out as a row of vertical slots — a
  comb, not a breakup.
* **`× 0.72 + 0.5` rather than `× 0.5 + 0.5`.** Gradient noise only reaches about ±0.7, so a
  threshold that never sees the ends of the range erodes evenly instead of tearing.
* **Both octaves are sheared off the axes** (`+p.y·3.1`, `−p.x·2.2`, `−p.y·9.0`, `+p.x·7.0`).
  Gradient noise has its cell walls aligned to its input; sampling on `(distance, section)`
  directly tears the crest into axis-aligned rectangles, legible as a grid the moment the wave is
  more than a few metres long.
* **Both octaves drift with time, in opposite directions.** Coarse: `+t·0.9` / `−t·0.6`. Fine:
  `−t·3.1` / `+t·2.3`. Counter-drifting makes their sum **boil rather than scroll** — holes open,
  close and migrate, so the lip is continuously coming apart. Roughly **three cell crossings per
  second on the fine octave, one on the coarse**: fast enough to read as disintegration, slow
  enough not to strobe. A crest torn by a pure function of position is a crest full of chunks that
  are permanently about to fall off and never do, and it reads as a still image pasted onto a
  moving object.
* Weights `0.58 / 0.42` on coarse / fine.

---

# 4. Wake vertex shader — `src/shaders/wake.vertex.wgsl` (VERBATIM body)

```wgsl
attribute position: vec3f;   // (column, row, side)

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let side = vertexInputs.position.z;
    let u = vertexInputs.position.x / max(uniforms.wakeCols - 1.0, 1.0);
    let q = vertexInputs.position.y / max(uniforms.wakeRows - 1.0, 1.0);

    let tm = uniforms.wakeTime;
    let P = wakePoint(wakeTex, uniforms.wakeCount, u, q, side, tm);

    // Central-ish differences. The offset flips sign near either edge of the
    // patch so the pair never straddles a clamp.
    let du = 0.65 / max(uniforms.wakeCols - 1.0, 1.0);
    let dq = 0.65 / max(uniforms.wakeRows - 1.0, 1.0);
    let su = select(1.0, -1.0, u > 0.5);
    let sq = select(1.0, -1.0, q > 0.5);

    let Pu = (wakePoint(wakeTex, uniforms.wakeCount, u + du * su, q, side, tm) - P) * su;
    let Pq = (wakePoint(wakeTex, uniforms.wakeCount, u, q + dq * sq, side, tm) - P) * sq;

    var N = cross(Pq, Pu) * side;
    let nl = length(N);
    N = select(vec3f(0.0, 1.0, 0.0), N / max(nl, 1e-8), nl > 1e-7);

    let sc = wakeScalars(wakeTex, uniforms.wakeCount, u, side);

    vertexOutputs.vWorld = P;
    vertexOutputs.vNormal = N;
    vertexOutputs.vQ = q;
    vertexOutputs.vAlong = sc.z;
    vertexOutputs.vAge = sc.w;
    vertexOutputs.vAmp = sc.x;
    vertexOutputs.vCurl = sc.y;
    vertexOutputs.vViewDist = distance(P, uniforms.cameraPos);
    vertexOutputs.position = uniforms.viewProjection * vec4f(P, 1.0);
}
```

Points a port must get right:

1. **`u` and `q` are lattice-normalised**, `u = column/127`, `q = row/17`.
2. **Normals are finite-differenced from `wakePoint`, not analytic.** The surface is a sweep with a
   per-sample amplitude envelope, a backward shear and a lump field on top; the analytic normal for
   all of that is long and easy to get subtly wrong. Three `wakePoint` evaluations cost less than
   the vertex shader spends on the spine fetch, and **they cannot disagree with the geometry
   because they are the geometry.**
3. **Difference step is 0.65 lattice cells** in both directions (`0.65/127` in `u`, `0.65/17` in
   `q`). Not 1.0, not 0.5.
4. **The offset flips sign past the midpoint** (`su`, `sq` become −1 when `u > 0.5` / `q > 0.5`),
   and the difference is multiplied by that sign to restore orientation. Without this, the pair
   straddles a clamp at the patch boundary, silently returning a zero-length tangent and a NaN
   normal on the boundary column.
5. **`cross(Pq, Pu) * side` — the `* side` is not cosmetic.** The two walls are mirror images, and
   mirroring a parametric surface reverses the handedness of its tangent pair; without the factor,
   `cross(Pq, Pu)` points to the concave side of the right wall and to the *convex* side of the
   left one. Because the fragment shader turns the normal toward the eye before shading, the lit
   result looks fine either way and the error hides in the BRDF — until the one term that asks
   which side of the sheet it is on: the barrel occlusion lands on the open outer face of the left
   wall and leaves the inside of the curl unshaded. **The invariant this establishes: `vNormal`
   points to the CONCAVE side of the sheet on both walls.**
6. **Degenerate guard.** Where the amplitude envelope has collapsed the strip onto its own spine
   (the tail column; the frames just after the player lets go) the cross product vanishes;
   fall back to world up. Thresholds `1e-7` (test) / `1e-8` (divide guard).
7. `vViewDist` is world distance to the camera, used for the cascade selection.

The **depth** and **prepass** vertex shaders are the same placement with the varyings reduced to
`vQ`, `vAlong`, `vAge`, `vTime` (+ `vViewZ = clip.w` for the prepass). `vTime` is *carried through
as a varying rather than re-read as a uniform in the fragment stage*, so the two halves of a pass
cannot end up eroding at different moments.

---

# 5. Wake fragment shader — `src/shaders/wake.fragment.wgsl`

## 5.1 Order of operations

```
1  erosion discard                    wakeEroded(vAlong, vQ, vAge, wakeTime)
2  view vector, two-sided normal flip, `inside` flag
3  pixel footprint from dpdx/dpdy of world position
4  two octaves of oblique-projection grain perturbing N
5  material constants (albedo / roughness / f0 / thickness)
6  shadow lookup (3 cascades, PCSS)
7  barrel occlusion factor + occ
8  direct wrapped diffuse
9  subsurface transmission (shadow-coupled)
10 GGX specular
11 SH ambient + snow-bounce hemisphere term
12 sky reflection (roughness-mip latlong lookup)
13 spell lights (4-slot pool)
14 occlusion applied LAST, to the finished radiance, with a blue cave tint
15 glints
16 aerial perspective
17 debug switch
```

## 5.2 Two-sided normal and the `inside` flag

```wgsl
let Ng = normalize(input.vNormal);
let facing = select(-1.0, 1.0, dot(Ng, V) >= 0.0);
var N = Ng * facing;
let geoN = N;
let inside = facing > 0.0;
```

The wake is an open sheet with a curl in it, so both faces are visible and winding says nothing
useful. Turning the normal toward the eye is right for a sheet of powder a few centimetres thick —
light gets through it either way, and the alternative is a black inside face on the barrel.

Because `Ng` points to the **concave** side by construction (§4 point 5), `inside == true` is
exactly "the eye is inside the curl". That is the one thing the shading needs to know that the
normal alone cannot say.

`geoN` (the flipped-but-un-grained normal) is what goes into the shadow lookup, matching what the
depth pass rendered.

## 5.3 Broken-snow grain

```wgsl
let ddxW = dpdx(world);
let ddyW = dpdy(world);
let footprint = max(length(vec2f(length(ddxW.xz), length(ddyW.xz))), 1e-4);

let gp = vec2f(
    dot(world, vec3f(0.91, 0.23, -0.35)),
    dot(world, vec3f(0.28, 0.84, 0.46))
);

let up = select(vec3f(0.0,1.0,0.0), vec3f(1.0,0.0,0.0), abs(N.y) > 0.99);
let T = normalize(cross(up, N));
let B = cross(N, T);

let fineFade = 1.0 - smoothstep(0.012, 0.09, footprint);
if (fineFade > 0.002) {
    let g = noised(gp * 26.0);
    N = normalize(N + (T * g.y + B * g.z) * 0.15 * fineFade);
}
let coarseFade = 1.0 - smoothstep(0.09, 0.55, footprint);
if (coarseFade > 0.002) {
    let g = noised(gp * 5.5);
    N = normalize(N + (T * g.y + B * g.z) * 0.10 * coarseFade);
}
```

* **Two oblique projections of the world position, not the XZ plane.** The wave face is close to
  vertical over most of its height, so a planar XZ lookup barely moves across it and the grain
  comes out as horizontal banding — the one pattern that reads as a rendering error rather than as
  snow. Slicing 2D noise along two non-axis-aligned directions gives a field that varies at the
  same rate whichever way the surface faces, for two dot products.
* **Two scales**, each faded out by pixel footprint (mirroring the three the snow field uses).
  One scale alone gives the wall a single characteristic grain size, which is exactly how it reads
  as a different substance from the field it was thrown out of.
* `noised()` returns `(value, d/dx, d/dy)`; only the derivatives (`.y`, `.z`) are used, applied in
  the tangent frame.

## 5.4 Material constants

```wgsl
let albedo    = vec3f(0.895, 0.920, 0.965);   // freshly displaced snow: brighter than the pack
let roughness = 0.80;                         // and rougher
let f0        = vec3f(0.026);
let thickness = mix(0.92, 0.32, smoothstep(0.15, 0.95, q));
```

**The thickness gradient is the whole read.** Thick and opaque at the base where the wall meets the
trench; thin and glowing at the lip. That single gradient is most of what separates this from a
white ribbon.

**The lip end must not go to zero.** A wall of thrown powder is 10–30 cm through, not tissue. At
`thickness = 0.04` the transmission lobe runs at near-full amplitude with a nearly white tint, and
since it is multiplied by a 13° sun whose beam is roughly 17:13:6, the result comes out several
times brighter than the direct diffuse and unmistakably **warm** — which on white snow reads as
dirt. The outer face of the wall came out brown. **0.32 is a floor, not a taste.**

## 5.5 Lighting terms

```wgsl
const INV_PI: f32 = 0.31830988618;
let NdotL = dot(N, L);
let NdotV = clamp(dot(N, V), 1e-4, 1.0);
let noiseRot = ign(input.position.xy) * 6.28318530718;
let shadow = sunShadow(world, geoN, input.vViewDist, noiseRot);

let diff = wrapDiffuse(NdotL, 0.66);
let directTerm = albedo * INV_PI * sun * diff * shadow;

let sss = snowSubsurface(N, L, V, sun, thickness, uniforms.sssStrength * 0.45, 1.5);
let sssTerm = sss * albedo * mix(0.18, 1.0, shadow);

// GGX, only when NdotL > 0
specTerm = sun * D * Vis * F * NdotL * shadow;

var irradiance = shIrradiance(N, shR) * ambientIntensity;
irradiance += shIrradiance(vec3f(0,1,0), shR) * ambientIntensity * 0.30
            * clamp(-N.y * 0.5 + 0.5, 0.0, 1.0) * albedo;
let ambientTerm = albedo * INV_PI * irradiance;

let R = reflect(-V, N);
let skyRefl = textureSampleLevel(skyLUT, samp, dirToLatLong(R), sqrt(roughness) * 6.0).rgb;
let skyTerm = skyRefl * fresnelSchlickRough(NdotV, f0, roughness) * ambientIntensity;
```

* **Wrap 0.66** on the diffuse — snow's terminator runs most of the way around the back of a drift.
* **SSS strength multiplier 0.45 and radius 1.5.** Strength well under the terrain's, and a
  *wider* scattering radius so the tint reaches the blue end at a lower thickness. Together those
  keep the backlit glow reading as light coming *through snow* rather than as the sun reflecting
  off something tan.
* **`mix(0.18, 1.0, shadow)` — the transmission is coupled much harder to the shadow term than the
  snow field's is.** On the ground a shadowed drift is still fed by light scattering in from lit
  snow a few centimetres away; a wall of powder standing in its own shadow with air on both sides
  has no such neighbour. Leaving it at half strength was most of why the shadowed side stayed white.
* **Snow bounce**: a second SH evaluation straight up, at 30 % of ambient, gated by
  `clamp(−N.y·0.5 + 0.5, 0, 1)` (i.e. full for downward-facing normals) and tinted by albedo — the
  bounce off the enormous white surface underneath the wall.
* **Sky reflection mip = `sqrt(0.80) × 6.0 = 5.366`** into the equirectangular sky LUT.

## 5.6 Occlusion — the part most likely to be got wrong

```wgsl
let barrel = select(0.0, smoothstep(0.05, 0.75, q) * (0.45 + 0.55 * input.vCurl), inside);
let occ = mix(1.0, 0.30, barrel);
...
let caveTint = mix(vec3f(1.0), vec3f(0.55, 0.72, 1.0), (1.0 - occ) * 0.95);
color *= occ * caveTint;      // applied LAST, after every lighting term including spell lights
```

Three rules, all learned the hard way and all about **hue rather than brightness**:

1. **Analytic, because the shadow map cannot supply it.** The wake is a zero-thickness sheet, so a
   point on it sits at exactly the depth its own caster wrote and can never self-occlude; and under
   a 13° sun the lip's cast shadow lands metres away rather than on the face beneath it. **Every
   bit of the "inside the curl is dark" read has to come from here**, and its absence is what made
   the first version look like a white cut-out pasted over the snow.
2. **Only the inside of the curl, and nothing else.** Every open face renders at *exactly* the
   brightness of the snow it was thrown out of. The reason is the tonemapper, not the lighting:
   AgX desaturates hard as it approaches its shoulder, which is what makes sunlit snow read white
   despite a beam that is roughly 17:13:6. **Half a stop below that, the curve stops rolling the
   saturation off and the same warm beam on the same white albedo comes back as tan.** A broad,
   gentle AO-shaped darkening of the wall does not read as "slightly shaded snow" — it reads as
   **brown snow next to white snow**. Two earlier passes of this shader made exactly that mistake.
3. **It scales the finished radiance, not the ambient**, and **wherever it darkens it goes blue in
   proportion.** The textbook AO scales ambient and leaves direct light alone, but here the ambient
   is where all the blue lives and the sun is a warm 13° beam — attenuating one and not the other
   does not darken a surface, it re-weights a warm source against a cool one. Tying the tint to
   `(1 − occ)` rather than to `barrel` directly means the two can never drift apart.

Numbers: floor **0.30** (a 70 % darkening at full barrel), tint **(0.55, 0.72, 1.0)** — the same
`deepTint` `snowSubsurface` uses — at **95 %** of the darkening.

## 5.7 Glints and aerial

```wgsl
if (glintIntensity > 0.001) {
    let g = snowGlints(world.xz, N, V, L, footprint, glintIntensity, glintGrazing);
    color += sun * g * shadow * 0.5;     // half the field's weight
}
color = applyAerial(color, cameraPos, world, -V, L, skyLUT, samp, sun,
                    fogDensity, fogHeightFalloff, fogStart, aerialStrength);
```

## 5.8 Debug modes (`wakeDebug` uniform, `SNOWFLOW.wake.debug`)

| Value | Output |
|---|---|
| 1 | `directTerm` |
| 2 | `sssTerm` |
| 3 | `ambientTerm` |
| 4 | `skyTerm` |
| 5 | `specTerm` |
| 6 | `vec3(occ * 12.0)` |
| 7 | `vec3(shadow * 12.0)` |
| 8 | `vec3(max(NdotL,0) * 12.0)` |
| 9 | `vec3(max(NdotL,0))` — unscaled, to line up with the snow material's own `ndotl` view |
| ≥10 | red = inside the curl, green = open outer face (`vec3(9,0,0)` / `vec3(0,9,0)`) |

Each mode returns one term in the **same radiance units** the beauty pass works in, so the
tonemapper shows it at the exposure it actually contributes at. Mode 10 is the view that says
whether the two mirrored walls agree — **build it; it is how the `* side` bug above was found.**

---

# 6. The spray particle system — `src/vfx/particles.js`

## 6.1 Pool

```js
const CAPACITY = 5120;   // hard cap; an emission is DROPPED when exhausted, never queued
const TERMINAL = 1.9;    // terminal fall speed of a snow grain, m/s — drag is tuned to land here
```

**Why 5120.** The surf plume is the heaviest consumer by an order of magnitude and needs sheer
count more than anything else: at 1200 live grains the plume renders as a field of separated soft
discs — legible as bokeh, not as snow — and the only thing that turns that into a continuous mass
is enough of them to overlap. 88 + 7 per metre at 19.5 m/s across two populations lands near 3500
live, and the footfall kick and the spells still have to fit alongside. The cost of the headroom is
one pass over the array per frame (5120 iterations of a dozen flops) plus 160 KB of data texture.

Per-particle SoA arrays (all `Float32Array`): `pos[3n]`, `vel[3n]`, `age[n]`, `life[n]`, `size[n]`,
`seed[n]`, `kind[n]` (0 = powder puff, 1 = heavy clod — **appearance only**), `drag[n]` (linear
drag coefficient, 1/s). Plus `_next` (free-scan cursor) and `liveCount`.

**`drag` is separate from `kind` on purpose.** A plume has to *look* like powder — soft-edged,
translucent, puffy — and *fly* like a stone, because it is a mass of snow launched off a wave at
eight metres a second rather than a grain drifting down. With drag welded to appearance, asking for
the look costs 5.2/s of drag, which stops the grain dead in 120 ms and inside the wave that threw
it.

## 6.2 `emit(x, y, z, vx, vy, vz, size, life, kind, drag)`

```js
// Bounded free-slot scan; after CAPACITY tries the emission is simply dropped.
let i = this._next;
for (let n = 0; n < CAPACITY; n++) {
    if (this.age[i] >= this.life[i]) break;
    i = (i + 1) % CAPACITY;
    if (n === CAPACITY - 1) return;
}
this._next = (i + 1) % CAPACITY;
...
this.drag[i] = drag === undefined ? (kind > 0.5 ? 1.1 : 5.2) : drag;
this.seed[i] = (i * 0.618033 + x * 0.137 + z * 0.311) % 1;
```

`size` is a **radius in metres**. `life` is seconds. Default drag: **1.1/s for clods, 5.2/s for
powder**; every wake emission overrides it explicitly.

## 6.3 `update(dt, cameraPos)` — per-particle integration (exact)

```js
const h  = Math.min(dt, 1 / 30);
const wa = (S.windDirection * Math.PI) / 180;
const wx = Math.sin(wa) * 2.4 * S.windStrength;
const wz = Math.cos(wa) * 2.4 * S.windStrength;

for (let i = 0; i < CAPACITY; i++) {
    if (age[i] >= life[i]) {  d[to+3] = 0; d[t1+3] = 0;  continue; }   // dead slots MUST be written

    age[i] += h;
    const a01 = age[i] / life[i];

    const k = drag[i];
    const vy = vel[o+1];
    vel[o]   += (wx - vel[o])   * Math.min(1, k * h);     // horizontal: drag toward WIND
    vel[o+2] += (wz - vel[o+2]) * Math.min(1, k * h);
    vel[o+1]  = vy + (-9.81 - k * (vy + TERMINAL)) * h;   // vertical: gravity + drag toward TERMINAL

    pos[o]   += vel[o]   * h;
    pos[o+1] += vel[o+1] * h;
    pos[o+2] += vel[o+2] * h;

    const g = terrain.heightAt(pos[o], pos[o+2]);
    if (pos[o+1] < g) {                       // settle, do not bounce — snow landing on snow
        pos[o+1] = g;
        vel[o] *= 0.2; vel[o+1] = 0; vel[o+2] *= 0.2;
        age[i] += h * 2.5;                    // kill it faster once it is down
    }

    const grow  = kind[i] > 0.5 ? 1.0 : 1.0 + a01 * 1.3;      // puffs expand, clods do not
    const alpha = Math.min(1, a01 * 8) * (1 - a01) * (1 - a01); // fade in fast, out slowly

    d[to]   = pos[o];  d[to+1] = pos[o+1];  d[to+2] = pos[o+2];  d[to+3] = size[i] * grow;
    d[t1]   = a01;     d[t1+1] = seed[i];   d[t1+2] = kind[i];   d[t1+3] = alpha;
    live++;
}
```

The **wind drag term uses `min(1, k·h)` as an explicit-Euler-safe lerp**, while the vertical uses a
plain forward-Euler step — reproduce both exactly or the drag response changes at high `k`.

Note the horizontal equilibrium is the **wind vector**, magnitude `2.4 × windStrength` m/s at
bearing `windDirection`, and the vertical equilibrium is `−TERMINAL = −1.9 m/s`.

**Dead slots still have to be written** (`size = 0`, `alpha = 0`), or the last frame's corpse keeps
rendering. Zero size collapses all four corners of the quad onto one point, and the rasteriser then
produces no fragments at all — cheaper than any branch.

## 6.4 Particle data texture

`RawTexture.CreateRGBATexture(data, 5120, 2, scene, false, false, NEAREST, FLOAT)`, CLAMP both axes.

| Row | `.r` | `.g` | `.b` | `.a` |
|---|---|---|---|---|
| 0 | world x | world y | world z | **size** (radius m, already × grow) |
| 1 | **age01** | **seed** | **kind** | **alpha** |

Backing array `Float32Array(CAPACITY * 2 * 4)`; row 0 occupies `[0 .. 5120*4)`, row 1
`[5120*4 .. 10240*4)`.

## 6.5 Billboard mesh (`buildQuadMesh`)

`position` = `(particleIndex, cornerX, cornerY)`, corners in order
`(-1,-1), (1,-1), (1,1), (-1,1)`, indices `(b, b+1, b+2), (b, b+2, b+3)`.
5120 quads → 20480 vertices, 30720 indices, 10240 triangles.
`frustumCulled` off, `isPickable` false, world matrix frozen.

## 6.6 Spray material state

`backFaceCulling = false`, `disableDepthWrite = true`, `alphaMode = ALPHA_COMBINE`
(`src·srcAlpha + dst·(1−srcAlpha)`, **non-premultiplied**), `needAlphaBlending() => true`,
`renderingGroupId = 2`. Per-frame uniforms include the billboard basis taken **straight off the
view matrix**: `camRight = (v.m[0], v.m[4], v.m[8])`, `camUp = (v.m[1], v.m[5], v.m[9])` — i.e.
the first two **rows** of the view matrix = the camera's right and up in world space.
`shadowSoftness = 1.6`, `shadowBias = 0.05` (looser than the wake's, because a billboard has no
real geometry to attach a shadow to).

## 6.7 `spray.vertex.wgsl` (VERBATIM)

```wgsl
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let i = i32(vertexInputs.position.x);
    let corner = vertexInputs.position.yz;

    let a = textureLoad(sprayTex, vec2i(i, 0), 0);
    let b = textureLoad(sprayTex, vec2i(i, 1), 0);

    let radius = a.w;

    // Spin, hashed off the seed, so a burst is not four hundred identical discs.
    // Rotating the *corner* rather than the texture keeps the billboard square-free.
    let ang = b.y * 6.28318530718 + b.x * (b.y - 0.5) * 3.0;
    let cs = cos(ang);
    let sn = sin(ang);
    let rc = vec2f(corner.x * cs - corner.y * sn, corner.x * sn + corner.y * cs);

    let world = a.xyz + (uniforms.camRight * rc.x + uniforms.camUp * rc.y) * radius;

    vertexOutputs.vWorld = world;
    vertexOutputs.vCorner = corner;      // NOTE: the UNROTATED corner is what the fragment shades
    vertexOutputs.vState = b;
    vertexOutputs.vViewDist = distance(world, uniforms.cameraPos);
    vertexOutputs.position = uniforms.viewProjection * vec4f(world, 1.0);
}
```

`b = (age01, seed, kind, alpha)`, so the spin angle is
**`seed·2π + age01·(seed − 0.5)·3.0`** — a per-grain static phase plus a per-grain signed spin rate
of up to ±1.5 rad over the particle's whole life.

**`vCorner` is the un-rotated corner.** The fragment shader's disc test, edge falloff and spherical
normal are all built in the *billboard's own* unrotated frame; only the vertex positions are
rotated. This is what keeps the billboard square-free while the shading stays axis-consistent.

## 6.8 `spray.fragment.wgsl` (VERBATIM body, annotated)

```wgsl
let r2 = dot(input.vCorner, input.vCorner);
if (r2 > 1.0) { discard; }

let state = input.vState;
let kind = state.z;

// Break the disc's edge — a perfectly circular puff is the tell that gives billboards away.
let ang = atan2(input.vCorner.y, input.vCorner.x);
let wob = 1.0 + 0.34 * noise2(vec2f(cos(ang), sin(ang)) * 2.4 + state.y * 37.0);
let r = sqrt(r2) / wob;
if (r > 1.0) { discard; }

// Soft-edged for powder, harder for a clod of thrown snow.
let edge = mix(
    pow(clamp(1.0 - r * r, 0.0, 1.0), 1.6),
    smoothstep(1.0, 0.65, r),
    kind
);
var alpha = state.w * edge * mix(0.36, 0.55, kind);
if (alpha < 0.004) { discard; }

// Spherical normal from the billboard's own coordinates.
let nz = sqrt(max(0.0, 1.0 - r2));
let N = normalize(camRight * input.vCorner.x + camUp * input.vCorner.y + V * nz);

let shadow = sunShadow(world, N, input.vViewDist, ign(input.position.xy) * 6.28318530718);

let albedo = vec3f(0.92, 0.94, 0.98);
let diff = wrapDiffuse(dot(N, L), 0.75);
var color = albedo * INV_PI * sun * diff * shadow;

// Forward scatter through the puff. `mu` is 1 looking straight into the sun.
let mu = dot(-V, L);
let fwd = phaseMie(mu, 0.55) * 0.85;
color += sun * albedo * fwd * mix(0.25, 1.0, shadow) * (1.0 - kind * 0.5);

color += albedo * INV_PI * shIrradiance(N, shR) * ambientIntensity;
// + spellLightingParticle(...)
color = applyAerial(...);
fragmentOutputs.color = vec4f(color, alpha);
```

Why each number:

* **Wobble 0.34 at frequency 2.4** sampled on the unit circle `(cos ang, sin ang)` offset by
  `seed·37.0` — one noise fetch, and it destroys the perfect-circle tell.
* **`edge` exponent 1.6** for powder (soft, gaussian-ish), **`smoothstep(1.0, 0.65, r)`** for clods
  (hard rim). The `mix` by `kind` is a straight 0/1 selector in practice.
* **Alpha scale 0.36 (powder) / 0.55 (clod).** Powder is close to transparent on its own; density
  has to come from many grains overlapping, or a single one turns into a decal. **0.26 was low
  enough that even fifteen hundred live grains read as haze rather than as spray** — this number
  was raised deliberately.
* **The billboard is shaded as a sphere.** `nz = sqrt(1 − r²)` reconstructs a hemisphere normal in
  the camera basis, so a puff has a lit side and a dark side instead of being a flat disc.
* **Forward scatter is the entire difference between "spray catching the light" and "grey smoke".**
  Looking toward the sun through a puff it is *brighter* than the snow behind it and warm; looking
  down-sun it is a dim blue-grey. That swing is well over a stop.
  **The 0.85 coefficient is small and has to be**: a phase function is normalised over the sphere,
  so using it as a direct multiplier on radiance — without the optical depth and scattering albedo
  that belong in front of it — overstates the peak by more than an order of magnitude. At 4.2 a
  footfall puff comes out four times brighter than sunlit snow and clips to flat white.
* **`mix(0.25, 1.0, shadow)`** — spray thrown inside the figure's own shadow must go dark, or every
  footfall looks self-illuminated.
* **`(1.0 − kind·0.5)`** — clods scatter forward half as much as powder.
* Mie asymmetry **g = 0.55** here (the atmosphere uses 0.62 for its own aerial lobe).

---

# 7. Plume emission — `SurfWake._plume(dt)`

This is where the two spray populations are born, at **fractional** positions along the same spine
the mesh is drawing.

## 7.1 Gate and rate accounting

```js
const n = this._count;
if (n < 3 || ch.surf < 0.15 || ch.speed < 3.0) { this._plumeOwed = 0; return; }

const travelled = ch.speed * dt;
this._plumeOwed += travelled;
this._driftOwed += travelled;
```

**Rate is per metre travelled, not per second**, so the plume does not thin out at a higher frame
rate. Note `_plumeOwed` is reset to 0 on the gate but `_driftOwed` is not.

```js
const perMetre = 88 * S.wakeSpray;          // 88 grains per metre of travel
let count = (this._plumeOwed * perMetre) | 0;
if (count > 0) {
    this._plumeOwed -= count / perMetre;    // keep the fractional remainder
    if (count > 150) count = 150;           // hard per-frame cap
    ...
}
```

## 7.2 Fractional spine sampling — the part that matters most

```js
const span = Math.min(n - 1, 15);           // sample the live first ~4.5 m of the wave
for (let k = 0; k < count; k++) {
    const jf = Math.random() * span;        // FRACTIONAL column
    const j  = jf | 0;
    const j2 = j + 1 < n ? j + 1 : j;
    const t  = jf - j;
    ...
}
```

**Why fractional.** Picking a whole column puts every grain on one of fifteen points 30 cm apart,
and the plume comes out as fifteen clumps of dots in a row. Interpolating along the spine spreads
the same count over a continuous line. **This matters more than any of the sizing constants.**

**Why from column zero.** The plume must be attached to the board — starting a metre back leaves a
bare gap exactly where the eye is looking. `span = 15` columns ≈ the first 4.5 m of wake, which is
where a breaking crest is actually shedding.

Everything is then linearly interpolated at `t`: `ampL`, `ampR`, `rx`, `rz` (via the ring indices
`_col[j]`, `_col[j2]`), `x`, `y`, `z`, `dist`. Note `rx`/`rz` are interpolated and **not
renormalised** — over 0.3 m of a turn the error is negligible and the reference does not correct it.

## 7.3 Side selection and the emission point

```js
const total = aL + aR;
if (total < 0.12) continue;                       // no wave here worth shedding from

const side = Math.random() * total < aL ? -1 : 1; // pick a side WEIGHTED BY AMPLITUDE
const amp  = side < 0 ? aL : aR;
if (amp < 0.10) continue;

const fx = -rz, fz = rx;                          // forward, from the same basis the shader builds

// Just outboard of the crest's lateral maximum, at its height.
// Mirrors wakePoint's base offset, so the plume leaves the lip the MESH IS DRAWING.
const l0  = 0.24 + 0.44 * smoothstep01((dist - 0.3) / 2.3);   // == smoothstep(0.3, 2.6, dist)
const lat = l0 + (0.35 + Math.random() * 0.55) * amp;
const px  = sx + rx * side * lat;
const pz  = sz + rz * side * lat;
const py  = sy + (0.30 + 0.82 * Math.sqrt(Math.random())) * amp;
```

* **Side is drawn with probability proportional to that side's amplitude.** On a hard carve
  (20:1 amplitude split) roughly 95 % of grains come off the outside wall. This is what makes the
  spray arc *out of* the turn.
* **`lat` straddles the section's lateral maximum.** The section's lateral maximum sits at about
  0.65 of the amplitude once the squash is applied, and the lip hooks back inside that — so the
  band `0.35 .. 0.90` of amplitude, offset by the same `l0` the mesh uses, means the shed grains
  leave from a **band straddling the crest** rather than from a single line.
* **`py` uses `sqrt(random())`, which biases the draw upward.** Most grains leave from the crest —
  which is where the wall is actually coming apart — while enough sheet down the face to avoid a
  horizontal rope of dots. Range: `0.30·amp` to `1.12·amp` above the spine.

## 7.4 Population 1 — the **curtain** (72 % of grains)

```js
if (Math.random() < 0.72) {
    sp.emit(
        px, py, pz,
        rx * side * (0.4 + Math.random() * 1.1) + ch.velocity.x * 0.16,   // vx: outboard + 16% of board velocity
        0.9 + Math.random() * 1.8,                                        // vy: 0.9 .. 2.7 m/s
        rz * side * (0.4 + Math.random() * 1.1) + ch.velocity.z * 0.16,   // vz
        0.055 + Math.random() * 0.085,                                    // radius 5.5 .. 14 cm
        0.34 + Math.random() * 0.40,                                      // life 0.34 .. 0.74 s
        0,                                                                // kind = powder
        4.5                                                               // drag 4.5 /s — HIGH
    );
    continue;
}
```

**A dense, slow, short-lived sheet hugging the crest.** This is the mass of it, and it is what makes
the wave look like it is *disintegrating* rather than sliding. Sizing is set by this population:
at ten metres a six-centimetre puff is six pixels, and a thousand six-pixel dots at low opacity
spread over twenty metres of trail is a faint haze rather than a plume. A puff of blown snow is a
cloud rather than a crystal, and at this framing it has to be **20–40 cm across** (diameter — the
emitted value is a radius, and `grow` takes it up to 2.3× over its life) to be a shape at all.
It dies before it can drift far enough for the size to look wrong.

## 7.5 Population 2 — the **throw** (28 % of grains)

```js
const out  = 1.2 + Math.random() * 2.6;    // outboard speed 1.2 .. 3.8 m/s
const back = 0.4 + Math.random() * 2.2;    // backward speed  0.4 .. 2.6 m/s
const clod = Math.random() < 0.18 ? 1 : 0;

sp.emit(
    px, py, pz,
    rx * side * out - fx * back + ch.velocity.x * 0.30,
    1.6 + Math.random() * 3.4 + amp * 1.5,        // vy: 1.6 .. 5.0 + up to 3.6 from amplitude
    rz * side * out - fz * back + ch.velocity.z * 0.30,
    clod ? 0.020 + Math.random() * 0.022 : 0.045 + Math.random() * 0.055,   // radius
    clod ? 0.7 + Math.random() * 0.5      : 0.9 + Math.random() * 1.3,      // life
    clod,
    clod ? 0.7 : 1.0 + Math.random() * 0.8                                   // drag — BALLISTIC
);
```

**Ballistic grains flung clear**, which give the plume its reach and its silhouette against the sky.
The low drag (0.7–1.8/s versus the curtain's 4.5/s) is the whole point: **this is a mass of snow
leaving a wave, and it has to actually clear the wave.** Note it also inherits nearly twice the
board velocity the curtain does (0.30 vs 0.16) and is thrown **backward** along the spine as well
as outboard.

## 7.6 Population 3 — the low **drift** stream

```js
const driftPerMetre = 7 * S.wakeSpray;
let drift = (this._driftOwed * driftPerMetre) | 0;
if (drift > 0) {
    this._driftOwed -= drift / driftPerMetre;
    if (drift > 14) drift = 14;
    const dspan = Math.min(n - 3, 22);
    for (let k = 0; k < drift; k++) {
        const jf = 2 + Math.random() * dspan;     // starts 2 columns back, spans up to 22
        const j = jf | 0, j2 = (j + 1 < n) ? j + 1 : j, t = jf - j;
        const lat = (Math.random() - 0.5) * 1.6;  // +/- 0.8 m either side of the spine
        sp.emit(
            X(t) + rx * lat,
            Y(t) + 0.08 + Math.random() * 0.35,
            Z(t) + rz * lat,
            (Math.random() - 0.5) * 1.1,
            0.25 + Math.random() * 0.9,
            (Math.random() - 0.5) * 1.1,
            0.026 + Math.random() * 0.036,        // radius 2.6 .. 6.2 cm
            1.5 + Math.random() * 1.6,            // life 1.5 .. 3.1 s — the longest-lived
            0,
            4.5                                   // high drag: hang over the trench, do not fly
        );
    }
}
```

**A separate, slower stream of fine powder hanging low over the trench.** The lip spray is all
ballistic and gone in a second; this is the part that leaves the trail **looking like it is still
smoking**. Note it is emitted *along the whole visible wake*, at ground level (+8 to +43 cm), with
no side weighting at all, and it lives 2–4× as long as anything else.

## 7.7 Emission budget summary

| Population | Share | Rate | Radius (m) | Life (s) | Drag (1/s) | `kind` |
|---|---|---|---|---|---|---|
| Curtain | 72 % of 88/m | ~63/m | 0.055–0.140 | 0.34–0.74 | 4.5 | 0 |
| Throw (powder) | 28 % × 82 % of 88/m | ~20/m | 0.045–0.100 | 0.9–2.2 | 1.0–1.8 | 0 |
| Throw (clod) | 28 % × 18 % of 88/m | ~4.4/m | 0.020–0.042 | 0.7–1.2 | 0.7 | 1 |
| Drift | separate stream | 7/m | 0.026–0.062 | 1.5–3.1 | 4.5 | 0 |

At 19.5 m/s that is ~1850 grains/s from the plume plus ~137/s from the drift; against the pool's
5120 slots and lifetimes averaging ~0.7 s / ~2.3 s, steady-state live count lands near 3500.

---

# 8. Screen-space speed streaks

## 8.1 The driving scalar

`src/character/controller.js`:
```js
this.streak01 = this.surf * Scalar.Clamp((this.speed - 7) / 11, 0, 1);
```
Zero below 7 m/s, saturating at 18 m/s, and multiplied by the surf blend — **deadbanded well above
walking pace, because streaks at a jog make the demo feel cheap.**

`src/post/postChain.js`: the tonemap pass receives
`S.windStreaks ? this.speedStreak * S.streakStrength : 0`.

## 8.2 In the tonemap fragment shader (VERBATIM, both blocks)

Both effects are confined to the **periphery**, because that is where speed is actually read —
the centre of the frame is what the player is looking at and blurring it just makes the demo feel
broken. Both are applied **before the tonemapper**, so its shoulder rolls the strands off instead
of letting them clip, and both cost nothing when the player is not moving.

**(a) Radial smear — applied to scene radiance, before exposure:**

```wgsl
let dFocus = input.vUV - vec2f(0.5, 0.5);
let radius = length(dFocus) * 2.0;
let streak = uniforms.speedStreak * smoothstep(0.34, 1.05, radius);
if (streak > 0.002) {
    var acc = c;
    for (var i = 1; i <= 6; i++) {
        let t = f32(i) / 6.0 * streak * 0.026;
        // textureSampleLevel, not textureSample: this loop sits under a
        // non-uniform branch, where implicit derivatives are undefined.
        acc += textureSampleLevel(textureSampler, textureSamplerSampler,
                                  input.vUV - dFocus * t, 0.0).rgb;
    }
    c = mix(c, acc / 7.0, 0.88);
}
```

Six taps drawn **toward** the focus, maximum displacement `0.026` of `dFocus` at full streak,
blended 88 %. This is the one that does the work — it is the only thing in the chain that makes the
*scene* look fast rather than decorating it.

**(b) Spindrift strands — added in exposed linear, after exposure and bloom:**

```wgsl
fn streakStrands(d: vec2f, r: f32, t: f32) -> f32 {
    let ang = atan2(d.y, d.x);
    let a = ang * 96.0;
    let cell = floor(a);
    let rnd = fract(sin(cell * 12.9898 + 4.1) * 43758.5453);
    // Only a fraction of the angular cells carry a strand.
    if (rnd > 0.34) { return 0.0; }

    let across = abs(fract(a) - 0.5) * 2.0;
    let phase = fract(r * (11.0 + rnd * 24.0) - t * (7.0 + rnd * 22.0));
    let seg = smoothstep(0.55, 0.86, phase) * (1.0 - smoothstep(0.86, 1.0, phase));
    return pow(1.0 - across, 20.0) * seg;
}
...
if (streak > 0.002) {
    let s = streakStrands(dFocus, radius, uniforms.time);
    c += vec3f(0.88, 0.94, 1.06) * s * streak * 0.16;
}
```

* **96 angular cells**, of which only those with `rnd <= 0.34` carry a strand — a strand in every
  cell reads as a zoom-blur artefact rather than as blowing snow.
* **The radial frequency (11 + rnd·24 cycles across the frame) is the number that decides whether
  this reads as blowing snow or as scratches on the lens.** At one cycle a strand is a straight
  line from the centre to the corner; at fourteen it is a two-centimetre dash — which is what a
  grain of spindrift crossing the frame in a fifteenth of a second actually looks like.
* Scroll rate `7 + rnd·22` per second, **negative in `phase`** so strands stream outward.
* `pow(1 − across, 20)` makes each strand a needle across its cell.
* Colour `(0.88, 0.94, 1.06)` — very slightly blue — at `0.16 × streak`.

---

# 9. Camera shake

## 9.1 Trauma injection (`controller._surfStep`)

```js
const load = Math.abs(steer) * (this.speed / SURF_MAX);
if (load > 0.25) rig.addTrauma((load - 0.25) * 1.35 * h);
```

**Only from the one thing that earns it: an edge loaded up at speed.** Added as a *rate* rather
than as an impulse, so it reaches equilibrium against the rig's own decay — a hard carve at top
speed settles around **0.4 trauma**, which is a couple of centimetres of rig movement.
**Anything you can consciously see here is too much.**

Equilibrium check: `addTrauma` rate at `load = 1` is `(1 − 0.25)·1.35 = 1.0125 /s`; decay is
`1.15 /s`; the fixed point is `trauma ≈ 0.88` at full load — but `steer` is clamped to ±1 and
rarely saturates, and at a realistic `load ≈ 0.55` the rate is `0.405 /s` giving a settled trauma
of ≈ 0.35–0.4.

## 9.2 Application (`CameraRig.update`)

```js
this.trauma = Math.min(1, this.trauma + amount);      // addTrauma
this.trauma = Math.max(0, this.trauma - dt * 1.15);   // decay, per frame
const shake  = this.trauma * this.trauma;             // shake = trauma^2 (Eiserloh)

if (shake > 0.0001) {
    const t = this.shakeTime * 26;
    _desired.x += (noise1(t)         * 2 - 1) * shake * 0.16;
    _desired.y += (noise1(t + 31.7)  * 2 - 1) * shake * 0.16;
    _desired.z += (noise1(t + 71.3)  * 2 - 1) * shake * 0.10;
}
cam.rotation.set(
    pitch + (noise1(shakeTime * 31 + 11) * 2 - 1) * shake * 0.02,
    yaw   + (noise1(shakeTime * 29 + 53) * 2 - 1) * shake * 0.02,
    roll  + (noise1(shakeTime * 23 + 97) * 2 - 1) * shake * 0.05
);
```

`shake = trauma²` so it falls off perceptually rather than linearly. Positional amplitude
0.16 m (x, y) / 0.10 m (z) **at shake = 1**, i.e. ≈ 2.6 cm at the settled trauma of 0.4.
Rotational 0.02 rad pitch/yaw, 0.05 rad roll.

```js
function noise1(x) {                      // cheap smooth 1D value noise, deterministic
    const i = Math.floor(x), f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash1(i) * (1 - u) + hash1(i + 1) * u;
}
function hash1(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
```

Three different noise rates (26 for position, 31/29/23 for rotation) with three different phase
offsets keep the axes uncorrelated.

---

# 10. Shared library functions the wake and spray depend on (exact formulas)

Port these once, as a shared GLSL include, exactly as written.

## 10.1 Gradient noise (`lib/noise.wgsl`)

```wgsl
fn hash21(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
fn grad2(i: vec2f) -> vec2f { let a = hash21(i) * 6.28318530718; return vec2f(cos(a), sin(a)); }

/// Perlin-style gradient noise. Returns vec3f(value, d/dx, d/dy). Range ~[-1, 1].
fn noised(p: vec2f) -> vec3f {
    let i = floor(p);  let f = p - i;
    let u  = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);     // quintic fade
    let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    let ga = grad2(i + vec2f(0,0)); let gb = grad2(i + vec2f(1,0));
    let gc = grad2(i + vec2f(0,1)); let gd = grad2(i + vec2f(1,1));
    let va = dot(ga, f - vec2f(0,0)); let vb = dot(gb, f - vec2f(1,0));
    let vc = dot(gc, f - vec2f(0,1)); let vd = dot(gd, f - vec2f(1,1));
    let k0 = va; let k1 = vb - va; let k2 = vc - va; let k3 = va - vb - vc + vd;
    let value = k0 + k1*u.x + k2*u.y + k3*u.x*u.y;
    let deriv = ga + u.x*(gb-ga) + u.y*(gc-ga) + u.x*u.y*(ga-gb-gc+gd)
              + du * (vec2f(u.y, u.x) * k3 + vec2f(k1, k2));
    return vec3f(value, deriv);
}
fn noise2(p: vec2f) -> f32 { return noised(p).x; }

/// Interleaved gradient noise — the stable per-pixel dither TAA tolerates.
fn ign(pix: vec2f) -> f32 { return fract(52.9829189 * fract(dot(pix, vec2f(0.06711056, 0.00583715)))); }
```

The value range of `noised(...).x` is **about ±0.7, not ±1** — this is why `wakeEroded` scales by
0.72 rather than 0.5.

## 10.2 Shading (`lib/shading.wgsl`)

```wgsl
fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
    let a = roughness * roughness; let a2 = a * a;
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(1e-7, PI * d * d);
}
fn visSmithGGXCorrelated(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
    let a = roughness * roughness; let a2 = a * a;
    let gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
    let gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
    return 0.5 / max(1e-7, gv + gl);
}
fn fresnelSchlick(u: f32, f0: vec3f) -> vec3f { let f = pow(1.0-u, 5.0); return f0 + (vec3f(1.0)-f0)*f; }
fn fresnelSchlickRough(u: f32, f0: vec3f, roughness: f32) -> vec3f {
    let f = pow(1.0-u, 5.0);
    return f0 + (max(vec3f(1.0 - roughness), f0) - f0) * f;
}

/// Wrapped diffuse. w = 0 is Lambert; snow wants 0.5-0.7.
fn wrapDiffuse(NdotL: f32, w: f32) -> f32 {
    let denom = (1.0 + w) * (1.0 + w);
    return max(0.0, (NdotL + w) / denom);
}

fn backScatter(N: vec3f, L: vec3f, V: vec3f, distortion: f32, power: f32, thickness: f32) -> f32 {
    let H = normalize(L + N * distortion);
    let vh = pow(clamp(dot(V, -H), 0.0, 1.0), power);
    return vh * thickness;
}

fn snowSubsurface(N: vec3f, L: vec3f, V: vec3f, lightColor: vec3f,
                  thickness: f32, strength: f32, radius: f32) -> vec3f {
    let shallowTint = vec3f(0.94, 0.965, 1.0);
    let deepTint    = vec3f(0.55, 0.72, 1.0);
    let tint = mix(shallowTint, deepTint, clamp(thickness * radius, 0.0, 1.0));
    let back = backScatter(N, L, V, 0.28 * radius,
                           mix(3.0, 9.0, thickness),      // lobe POWER: thin = wide
                           mix(1.0, 0.30, thickness));    // lobe AMPLITUDE: thin = bright
    return lightColor * tint * back * strength;
}

fn shIrradiance(n: vec3f, sh: array<vec4f, 9>) -> vec3f {
    let c1=0.429043; let c2=0.511664; let c3=0.743125; let c4=0.886227; let c5=0.247708;
    return sh[0].rgb*c4
         + sh[1].rgb*2.0*c2*n.y + sh[2].rgb*2.0*c2*n.z + sh[3].rgb*2.0*c2*n.x
         + sh[4].rgb*2.0*c1*n.x*n.y + sh[5].rgb*2.0*c1*n.y*n.z
         + sh[6].rgb*(c3*n.z*n.z - c5)
         + sh[7].rgb*2.0*c1*n.x*n.z + sh[8].rgb*c1*(n.x*n.x - n.y*n.y);
}
```

**`L` points from the surface TOWARD the sun.** `backScatter` measures the lobe against
`−(L + N·distortion)` — the direction the scattered light continues in after passing through.
Building it from `−L` inverts the whole term, so it peaks with the sun *behind* the camera and
switches off looking into it, which is exactly backwards.

`snowSubsurface` lobe parameters run **opposite** to intuition: a *thin* edge transmits brightly
and over a wide range of angles (`power` 3.0, amplitude 1.0), deep snow transmits little and only
close to straight-through (`power` 9.0, amplitude 0.30).

**Glints** (`snowGlints`, called by the wake fragment): two world-space octaves, cell sizes
**0.052 m** (sharpness 780) and **0.185 m** (sharpness 1500, weight ×1.35, offset by (53.1, 17.9)),
each faded out via `smoothstep(cell·0.55, cell·2.2, pixelFootprint)`. Facet acceptance `r2.x <= 0.62`,
facet jitter `(r − 0.5)·0.72` of a cell, disc radius `cell·0.17`, tilt `0.10 + r2.y·0.26`.
Grazing gate `pow(1 − NdotV, mix(1.5, 5.0, grazeGate))`, light gate
`smoothstep(0.02, 0.35, NdotL) · (1 − smoothstep(0.55, 0.95, NdotL)·0.55)`.

## 10.3 PCSS shadow lookup (`lib/shadowLookup.wgsl`)

3 cascades, splits **[26, 95, 330] m**, resolution **2048²**, `shadowTexel = 1/2048`,
cross-fade over the last 12 % of each slice (`blendStart = split·0.88`), last cascade fades to lit
over `smoothstep(split.z·0.85, split.z, viewDist)`.

Per cascade: reconstruct the light basis (`lf = −sunDir`, `lr = normalize(cross(up, lf))`,
`lu = cross(lf, lr)`), build the receiver-plane gradient
`grad = clamp((−nl.x/nz, −nl.y/nz), ±6)`, `planeNdcPerUV = grad · orthoWidth / depthRange`,
normal-offset the receiver by `geoN · (orthoWidth·shadowTexel · 1.5 · max(sinL, 0.2))`, project,
then run `pcssShadow`: **8-tap blocker search** at radius
`maxPenumbraUV = min(24·texelSize, 1.8/orthoWidth)`, penumbra estimate
`blockerDist · 0.0093 · softness` (the sun subtends ≈ half a degree), **12-tap Poisson filter**
rotated by `ign(gl_FragCoord.xy)·2π`. Poisson disc (12 taps, verbatim):

```
(-0.326,-0.406) (-0.840,-0.074) (-0.696, 0.457) (-0.203, 0.621)
( 0.962,-0.195) ( 0.473,-0.480) ( 0.519, 0.767) ( 0.185,-0.893)
( 0.507, 0.064) ( 0.896, 0.412) (-0.322,-0.933) (-0.792,-0.598)
```

The wake passes `softness = 1.5`, `biasWorld = 0.018 m`; the spray passes `1.6` and `0.05 m`.

## 10.4 Aerial perspective (`lib/atmosphere.wgsl`)

```wgsl
fn phaseMie(mu: f32, g: f32) -> f32 {
    let g2 = g * g;
    let n = (1.0 - g2) * (1.0 + mu * mu);
    let d = (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5);
    return (3.0 / (8.0 * PI)) * n / d;
}
fn dirToLatLong(d: vec3f) -> vec2f {
    let u = atan2(d.x, d.z) / (2.0 * PI) + 0.5;
    let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2f(u, v);
}
fn applyAerial(color, camPos, worldPos, viewDir, sunDir, skyTex, skySamp, sunColor,
               density, heightFalloff, fogStart, strength) -> vec3f {
    let t   = aerialTransmittance(camPos, worldPos, density, heightFalloff, fogStart);
    let ext = clamp(1.0 - pow(t, strength), 0.0, 1.0);
    let inscatter = aerialInscatterSky(skyTex, skySamp, viewDir, sunDir, sunColor, ext);
    return mix(color, inscatter, ext);
}
```

`aerialTransmittance` integrates `exp(−k·y)` analytically along the segment with
`dist = max(0, |worldPos − camPos| − fogStart)`, and returns `exp(−density·integral)`.
`aerialInscatterSky` crossfades a **near-field** colour (sky LUT sampled at
`normalize(viewDir + (0, 0.42, 0))`, **mip 3**, plus `sunColor · phaseMie(mu, 0.62) · 5.5 · 0.16`)
onto the **exact** sky sample (mip 0, no tilt) by `smoothstep(0.55, 0.995, ext)`.

Both wake and spray call `applyAerial` with `viewDir = −V` (i.e. camera→surface).
Scene defaults: `fogDensity = 0.0072`, `fogHeightFalloff = 0.045`, `fogStart = 24 m`,
`aerialStrength = 1.0`.

## 10.5 Spell light pool (`lib/spellLights.wgsl`)

4 slots. `spellLightPos[i] = (xyz world, w = radius m)`, `spellLightCol[i] = (rgb, w = intensity)`.

```wgsl
fn spellAttenuation(dist2: f32, radius: f32) -> f32 {
    let t2 = dist2 / max(radius * radius, 1e-4);
    if (t2 >= 1.0) { return 0.0; }
    let win = 1.0 - t2 * t2;
    return win * win / (dist2 + 0.25);      // 0.25 = soft core
}
```

Wake uses `spellLighting(...)` — wrapped diffuse at **wrap 0.66** plus the identical
`snowSubsurface` the sun runs, with the wake's own `sssStrength·0.45` and radius `1.5`.
Spray uses `spellLightingParticle(...)` — a single wide-wrap term at **wrap 0.8**, no transmission.

---

# 11. WebGL2 / Three.js r172 porting notes

## 11.1 Language mapping (WGSL → GLSL ES 3.00)

| WGSL | GLSL ES 3.00 | Trap |
|---|---|---|
| `textureLoad(t, vec2i(x,y), 0)` | `texelFetch(t, ivec2(x,y), 0)` | LOD must be an integer literal/uniform; texture must be NEAREST, no mips. |
| `textureSampleLevel(t, s, uv, lod)` | `textureLod(t, uv, lod)` | Required inside non-uniform branches (implicit derivatives are UB) — this applies to the wake's sky-reflection lookup, the shadow taps and the streak smear loop. |
| `select(f, t, cond)` | `cond ? t : f` | **Argument order is reversed.** `select` returns the *first* argument when the condition is false. Used in `wakeScalars`, the vertex normal fallback, `wakePoint`'s basis, the fragment's `facing`, `up` and `barrel`. |
| `dpdx` / `dpdy` | `dFdx` / `dFdy` | Same semantics; `dFdx(vec3)` is legal. |
| `atan2(y, x)` | `atan(y, x)` | — |
| `inverseSqrt` | `inversesqrt` | Lowercase s. |
| `fract` | `fract` | Identical (`x − floor(x)`). (HLSL's `frac` differs for negatives; GLSL does not.) |
| `vec2f/vec3f/vec4f`, `vec2i`, `f32`, `i32` | `vec2/vec3/vec4`, `ivec2`, `float`, `int` | — |
| `array<vec4f, 9>` | `uniform vec4 shR[9];` | — |
| `array<mat4x4f, 3>` | `uniform mat4 cascadeMatrices[3];` | — |
| `const POISSON: array<vec2f,12> = array<vec2f,12>(...)` | `const vec2 POISSON[12] = vec2[12](...);` | — |
| `mat3x3f(a,b,c, d,e,f, g,h,i)` | `mat3(a,b,c, d,e,f, g,h,i)` | **Both are column-major and both take columns in order** — no transpose needed *if* you copy the literal argument list. Do not "fix" the AgX matrices by transposing them. |
| `input.position.xy` (fragment builtin) | `gl_FragCoord.xy` | Used for `ign()` rotation of the Poisson disc. |
| `input.position.z` (fragment builtin) | `gl_FragCoord.z` | Both are window-space 0..1 — the shadow-map fragment shader ports unchanged. |
| `discard;` | `discard;` | — |
| `var` (function local) / `let` | mutable local / `const`-ish local | — |
| `@vertex` / `@fragment` entry `main` | `void main()` | — |
| `varying x: T` (Babylon WGSL) | `out T vX;` in VS, `in T vX;` in FS | Perspective-correct interpolation is the default in both. |

## 11.2 Clip space and render-target conventions

* **NDC z:** WebGPU is `[0, 1]`, WebGL is `[−1, 1]`. Anywhere the reference uses `clip.z / clip.w`
  as a depth to compare against a shadow map (`sampleCascadeTex`'s `ndc.z`), **remap:
  `depth01 = ndc.z * 0.5 + 0.5`**, and build the cascade projection matrices with a `[−1,1]` depth
  range (Three.js `OrthographicCamera` already does).
* **Render-target Y flip:** Babylon negates clip-space Y when rendering into a render target
  (WebGPU's texture origin is top-left, the framebuffer convention is bottom-left). That is why the
  reference's shadow UV is `vec2(ndc.x*0.5+0.5, 0.5 + ndc.y*0.5)` with a `+`. **In WebGL2 there is
  no such flip** — render into the target with no Y negation and use the plain
  `uv = ndc.xy * 0.5 + 0.5`. Do not port Babylon's flip *and* its compensation.
* **Prepass output** (`clip.w` = linear view depth) is identical in both APIs.

## 11.3 Textures

| Reference | WebGL2 / Three.js | Notes |
|---|---|---|
| `RawTexture.CreateRGBATexture(f32Array, 96, 3, …, NEAREST, FLOAT)` | `new THREE.DataTexture(arr, 96, 3, THREE.RGBAFormat, THREE.FloatType)` with `magFilter = minFilter = THREE.NearestFilter`, `wrapS = wrapT = ClampToEdgeWrapping`, `generateMipmaps = false`, `needsUpdate = true` each frame | **RGBA32F sampling is core WebGL2** (`EXT_color_buffer_float` is only needed to *render into* float targets, which this subsystem never does). `OES_texture_float_linear` is not needed because filtering is NEAREST. |
| Same, `5120 × 2` for spray | Same | 160 KB re-uploaded per frame; acceptable. If profiling demands it, use `texture.updateRanges` / a manual `gl.texSubImage2D` for `[0, liveHigh]` columns only. |
| Sky LUT sampled with `textureSampleLevel(..., mip)` | must have mips (`generateMipmaps = true`, `LinearMipmapLinearFilter`) | The wake reads mip `sqrt(0.8)·6 = 5.366`; aerial reads mip 3 and mip 0. |
| Shadow cascades: 3 × 2048² R32F | `THREE.WebGLRenderTarget(2048, 2048, { type: FloatType, format: RedFormat })` — **requires `EXT_color_buffer_float`** | This is the one place the extension is mandatory. Fall back to `HalfFloatType` (`EXT_color_buffer_half_float`) only if you also widen `shadowBias`: fp16 has ~1e-3 relative precision, which over a 330 m cascade is ~0.3 m of depth quantisation and will peter-pan the wake's shadow. |

**Do not use RGBA16F for either data texture's row 0.** Both hold absolute world coordinates that
reach ~870 m on this map; fp16 relative precision at 1000 is ~0.5 m, i.e. the whole wake would
quantise into half-metre steps. Rows 1–2 of the spine (right vector, amplitudes, curls, age) and
row 1 of the spray (age/seed/kind/alpha) would be safe in fp16 if you ever need to split them,
but keeping one RGBA32F texture is simpler and the bandwidth is trivial.

**Vertex texture fetch** is guaranteed in WebGL2 (`MAX_VERTEX_TEXTURE_IMAGE_UNITS >= 16`), so the
whole "place every vertex from a data texture" design ports directly. Budget: `wakePoint` performs
4 spine `texelFetch` + 6 scalar `texelFetch` + 1 basis `texelFetch` = 11, and the vertex shader
calls it three times plus one extra `wakeScalars` → **~39 `texelFetch` per vertex × 4608 vertices**.
That is fine on any WebGL2-capable GPU but is the wake's dominant vertex cost; do not add a fourth
`wakePoint` evaluation for a "more central" difference.

## 11.4 No compute shaders needed

Nothing in this subsystem is a compute pass or a storage texture in the reference either — the
particle simulation and the spine resolve are both **CPU** (deliberately: a footfall is eighteen
grains and the dispatch overhead of a compute pass plus indirect draw exceeds the whole simulation
cost). **Port the simulation as plain JavaScript over typed arrays.** The only GPU work is vertex
expansion, which is already a vertex shader.

If a future port wants GPU simulation, note it would then need ping-ponged float framebuffers and
`EXT_color_buffer_float`; that is a different design and would lose the exact CPU/GPU agreement the
plume relies on (the CPU emits from `_ampL/_ampR`, which the shader also reads).

## 11.5 Three.js material / mesh configuration

| Reference | Three.js |
|---|---|
| `ShaderMaterial(..., shaderLanguage: WGSL)` | `THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms })` — RawShaderMaterial so Three injects nothing. |
| `mat.backFaceCulling = false` | `side: THREE.DoubleSide` |
| Wake: opaque, depth write on | `transparent: false, depthWrite: true, depthTest: true` |
| Spray: `needAlphaBlending`, `disableDepthWrite`, `ALPHA_COMBINE` | `transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending, premultipliedAlpha: false` |
| `renderingGroupId = 1` / `= 2` | `mesh.renderOrder = 1` / `2` (and rely on `transparent` to sort spray after opaques) |
| `alwaysSelectAsActiveMesh`, `doNotSyncBoundingInfo`, `freezeWorldMatrix()` | `mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix()` |
| `Uint32Array` indices | `geometry.setIndex(new THREE.Uint32BufferAttribute(idx, 1))` — `OES_element_index_uint` is core in WebGL2 |
| attribute named `position` carrying `(column,row,side)` | **Rename it** (e.g. `aLattice`) — Three computes bounding spheres and raycasts from `position`, and this attribute is not a position. With `frustumCulled = false` it is harmless but confusing; renaming costs nothing. |
| `shadows.registerCaster(mesh, makeMat, 2)` | Render the wake manually into cascades 0 and 1 with an override material per cascade (one material per cascade so each holds its own `lightViewProjection` without mid-frame uniform juggling). |
| `depth.registerCaster(mesh, mat)` | Add the wake to the prepass render list with its own override material. |

## 11.6 Precision and numerical notes

* Declare `precision highp float;` **and** `precision highp int;` — the spine indices and the
  particle index are ints derived from float attributes, and `mediump int` (16-bit) would break the
  spray's 5120-entry index.
* `pow(t, 1.65)` in `wakeSection`/`wakePoint` is evaluated at `t = 0` on the base row.
  GLSL `pow(0.0, 1.65)` is `0.0` on all conformant implementations, but if you see NaNs on a
  specific driver, guard with `pow(max(t, 1e-8), 1.65)` — it changes nothing visible.
* The vertex shader's `1e-7` / `1e-8` normal guards are load-bearing in fp32; keep them.
* `noise2` is called **3× per vertex per `wakePoint`** (so 9× per vertex) plus **2× per fragment**
  in `wakeEroded`. `hash21` uses `fract` of large products — fp32 is required; a `mediump` fallback
  produces visible hash banding.
* Timestamp queries (`getGPUFrameTimeCounter`) are unavailable in WebGL2 except via
  `EXT_disjoint_timer_query_webgl2` (widely unimplemented in browsers today). Use CPU-side
  `performance.now()` around `renderer.render()` and accept that it measures submission, not GPU
  time — and do not build the perf overlay's "GPU frame" number on it without saying so.

## 11.7 Cheap-out points, ranked by visual cost (if you must)

1. `WAKE_STEPS` 20 → 12: barely visible; the midpoint rule on a curve this smooth converges fast.
   **Do not go below 8** — the base flare and the hook both distort.
2. `ROWS` 18 → 14: the section is smooth; the lip edge gets slightly faceted.
3. Drop the third lump octave (weight 0.15): mild loss of fine gathered mass.
4. `CAPACITY` 5120 → 3072: the plume stops reading as a continuous mass at high speed. **This is
   the most expensive cut of the four** — see the note in §6.1.
5. Do **not** cut the number of `wakePoint` evaluations in the vertex shader from 3 to 1 with an
   analytic normal. That is the exact failure mode the reference's design note warns about.

---

# 12. Visual acceptance criteria

A harsh critic should be able to check each of these from a screenshot or a short capture. These
are the deliverable; the constants exist to produce them.

1. **The two walls are wildly asymmetric on a carve.** In a hard turn one wall stands roughly
   2.0–2.6 m — taller than the character — and the other is a barely-present ridge no more than
   ~5 % of it (≤ 13 cm). Running straight, the two walls are equal at 45 % of full height. If both
   walls are similar in a turn, the carve→amplitude resolve is wrong or is being re-derived in the
   shader.
2. **The big wall genuinely overhangs.** Its top edge is *inboard* of the wall's widest point and
   *below* its highest point, so the silhouette hooks back across its own face and there is a
   visible concave cavity under the lip. From behind and slightly above you can see the *underside*
   of the lip. A wall whose top is its outermost point is a rounded ridge — the tangent sweep
   stopped short of 270°.
3. **The inside of the curl is a blue cave, never grey and never tan.** It darkens to ~30 % and
   shifts toward (0.55, 0.72, 1.0) in proportion to that darkening. Crucially, the **outer** face
   of the same wall is at *exactly* the brightness of the surrounding sunlit snow field — there is
   no soft AO gradient across it. If the open face is even half a stop down, it will read brown
   under the AgX shoulder; that is the failure this design exists to prevent.
4. **The lip glows from the inside when backlit.** With the low sun behind the wave the top of the
   wall is brighter than its base and reads as light coming *through* snow — a continuous gradient
   from opaque base to translucent lip, with no band or step. It must not be *warm/tan* at the lip:
   if the lip goes brown, the thickness floor was taken below ~0.3.
5. **The crest breaks up only at the very top, and it boils.** Holes appear in roughly the top
   sixth of the section, and in motion they **open, close and migrate in place** at a few per
   second rather than scrolling rigidly with the wave. The bottom five-sixths is an unbroken sheet.
   Holes across the top *half*, or a hole pattern that translates with the wall, are both wrong.
6. **The wake ends by dissolving, not by shrinking or popping.** Over the last third of a column's
   life the whole wall goes to powder; the very last column degenerates onto its own spine as a
   line on the ground, never a cut edge. Total wake length tracks speed linearly: ≈ 17 m flat out,
   ≈ 5 m at a jog. Time it: the tail is 0.88 s behind the bow at any speed.
7. **The pair reads as a bow wave splitting around the board.** The two walls converge to ~0.24 m
   either side of the spine just ahead of the boots and spread to ~0.68 m by 2.6 m behind. The base
   of each wall sits *outside* the berm the groove brush throws, not inside its own trench.
8. **No 30 cm banding anywhere.** The specular crest highlight and the shading along the wake are
   continuous. A repeating band or facet every 30 cm means linear spine interpolation and/or linear
   scalar interpolation instead of Catmull-Rom + smoothstep.
9. **Spray leaves the crest, not the feet, and forms a continuous line.** Grains originate from a
   band straddling the wall's lateral maximum, at crest height, along the first ~4.5 m of wake.
   Fifteen visible clumps of dots 30 cm apart means whole-column sampling instead of fractional.
   During a turn the plume comes off the **outside** of the carve and stays registered with the
   wall as the player turns — no lag, no drift to the wrong side.
10. **Two spray populations are separately identifiable.** A dense, slow, soft curtain of 10–30 cm
    puffs that hugs the crest and dies within ~0.7 s, plus sparser grains that clearly **clear the
    wall** and arc against the sky for 1–2 s before falling. Plus a third, low, long-lived haze
    hanging over the trench behind the player so the trail looks like it is still smoking. If
    everything stops dead inside the wave, drag was welded to appearance instead of being a
    separate parameter.
11. **Spray is directionally lit, not fogged.** Looking toward the sun through the plume it is
    *brighter than the snow behind it* and slightly warm; looking down-sun it is dim blue-grey.
    Individual puffs have a lit side and a dark side (they are shaded as spheres, not flat discs)
    and none of them is a perfect circle. Grains inside the character's own shadow are visibly dark.
12. **Speed cues are peripheral and subtle.** The radial smear and the spindrift strands appear
    only outside ~34 % of the half-diagonal and only above ~7 m/s while surfing; the centre of the
    frame stays sharp. Strands are short outward-streaming dashes, not full-length radial lines
    from the centre. Camera shake is present only while an edge is loaded at speed and amounts to
    ~2–3 cm of rig movement — if you can consciously see the shake, the trauma rate is too high.

---

# 13. Known discrepancies in the reference (do not propagate)

1. **`src/core/settings.js` line 62** documents `wakeHeight` as "Height of the breaking wall thrown
   by a carve, as a multiple of **1.45 m**". The code is authoritative and uses
   `MAX_HEIGHT = 2.4` (`surfWake.js` line 68), whose own comment explains the deliberate departure
   from the physically plausible 1.45 m. **Port 2.4.**
2. **`surfWake.js` lines 415–418** contain a duplicated two-line comment
   ("A wall that is barely there does not curl; …"). Harmless.
3. `wake.wgsl`'s doc comment says the tip at `curl = 1` sits at "47 % of the crest's lateral
   offset"; recomputing the integral gives **48.8 %** of the section's maximum lateral extent
   (and 65.0 % of maximum height, which matches). Trust the integral, not the comment.
4. The `SurfWake` constructor imports `Vector3 _fwd` at module scope and never uses it. Ignore.

---

# 14. Master constant index

Every numeric constant this document captures, with the identifier it is bound to, its value, its
units and where it lives. **268 named constants in total** — 214 numbered entries in sections A–F
(the wake proper and the particle pool) plus 54 further entries in section G (spray shading,
speed streaks, camera shake, and the driving/shared constants the two subsystems read).

### A. Spine / wake CPU (`src/vfx/surfWake.js`)

| # | Identifier | Value | Units |
|---|---|---|---|
| 1 | `SPINE_MAX` | 96 | samples |
| 2 | `SPINE_STEP` | 0.30 | m of travel |
| 3 | `LIFE` | 0.88 | s |
| 4 | `BOW_LEAD` | 0.55 | m |
| 5 | `MAX_HEIGHT` | 2.4 | m |
| 6 | `COLS` | 128 | lattice columns |
| 7 | `ROWS` | 18 | lattice rows |
| 8 | `WAKE_CASCADES` | 2 | cascades |
| 9 | data texture height | 3 | rows |
| 10 | activation surf threshold | 0.06 | 0..1 |
| 11 | activation speed threshold | 1.6 | m/s |
| 12 | restart age threshold | 0.25 | s |
| 13 | strength speed offset | 2.2 | m/s |
| 14 | strength speed span | 9.0 | m/s |
| 15 | `shape` base | 0.34 | — |
| 16 | `shape` gain | 0.66 | — |
| 17 | `shape` smoothstep start | 0.3 | m behind bow |
| 18 | `shape` smoothstep span | 1.3 | m |
| 19 | amp bias base | 0.45 | — |
| 20 | amp bias gain | 0.55 | — |
| 21 | amp clamp lo | 0.05 | — |
| 22 | amp clamp hi | 1.0 | — |
| 23 | curl base | 0.42 | — |
| 24 | curl gain | 0.58 | — |
| 25 | curl clamp lo | 0.26 | — |
| 26 | curl clamp hi | 1.0 | — |
| 27 | carve clamp | ±1 | — |
| 28 | visibility `maxAmp` threshold | 0.01 | m |
| 29 | visibility min count | 2 | samples |
| 30 | wake `shadowSoftness` | 1.5 | × |
| 31 | wake `shadowBias` | 0.018 | m |
| 32 | synthetic spine length | 24 | samples |
| 33 | synthetic amplitude | 0.8 | m |
| 34 | synthetic curl | 0.7 | — |
| 35 | lattice vertices | 4608 | — |
| 36 | lattice indices | 25908 | — |
| 37 | lattice triangles | 8636 | — |

### B. Plume emission (`SurfWake._plume`)

| # | Identifier | Value | Units |
|---|---|---|---|
| 38 | gate min spine count | 3 | samples |
| 39 | gate min surf | 0.15 | 0..1 |
| 40 | gate min speed | 3.0 | m/s |
| 41 | `perMetre` | 88 | grains/m |
| 42 | per-frame count cap | 150 | grains |
| 43 | `span` cap | 15 | columns |
| 44 | total-amplitude skip | 0.12 | m |
| 45 | per-side amplitude skip | 0.10 | m |
| 46 | `l0` base | 0.24 | m |
| 47 | `l0` gain | 0.44 | m |
| 48 | `l0` smoothstep start | 0.3 | m |
| 49 | `l0` smoothstep span | 2.3 | m |
| 50 | lateral band base | 0.35 | × amp |
| 51 | lateral band span | 0.55 | × amp |
| 52 | height base | 0.30 | × amp |
| 53 | height span (sqrt-biased) | 0.82 | × amp |
| 54 | curtain probability | 0.72 | — |
| 55 | curtain lateral speed base | 0.4 | m/s |
| 56 | curtain lateral speed span | 1.1 | m/s |
| 57 | curtain velocity inheritance | 0.16 | × board vel |
| 58 | curtain vy base | 0.9 | m/s |
| 59 | curtain vy span | 1.8 | m/s |
| 60 | curtain radius base | 0.055 | m |
| 61 | curtain radius span | 0.085 | m |
| 62 | curtain life base | 0.34 | s |
| 63 | curtain life span | 0.40 | s |
| 64 | curtain drag | 4.5 | 1/s |
| 65 | throw outboard base | 1.2 | m/s |
| 66 | throw outboard span | 2.6 | m/s |
| 67 | throw backward base | 0.4 | m/s |
| 68 | throw backward span | 2.2 | m/s |
| 69 | clod probability | 0.18 | — |
| 70 | throw velocity inheritance | 0.30 | × board vel |
| 71 | throw vy base | 1.6 | m/s |
| 72 | throw vy span | 3.4 | m/s |
| 73 | throw vy amplitude coupling | 1.5 | m/s per m |
| 74 | clod radius base | 0.020 | m |
| 75 | clod radius span | 0.022 | m |
| 76 | throw-powder radius base | 0.045 | m |
| 77 | throw-powder radius span | 0.055 | m |
| 78 | clod life base | 0.7 | s |
| 79 | clod life span | 0.5 | s |
| 80 | throw-powder life base | 0.9 | s |
| 81 | throw-powder life span | 1.3 | s |
| 82 | clod drag | 0.7 | 1/s |
| 83 | throw-powder drag base | 1.0 | 1/s |
| 84 | throw-powder drag span | 0.8 | 1/s |
| 85 | `driftPerMetre` | 7 | grains/m |
| 86 | drift per-frame cap | 14 | grains |
| 87 | drift span cap | 22 | columns |
| 88 | drift start offset | 2 | columns |
| 89 | drift lateral span | 1.6 (±0.8) | m |
| 90 | drift height base | 0.08 | m |
| 91 | drift height span | 0.35 | m |
| 92 | drift horizontal speed span | 1.1 (±0.55) | m/s |
| 93 | drift vy base | 0.25 | m/s |
| 94 | drift vy span | 0.9 | m/s |
| 95 | drift radius base | 0.026 | m |
| 96 | drift radius span | 0.036 | m |
| 97 | drift life base | 1.5 | s |
| 98 | drift life span | 1.6 | s |
| 99 | drift drag | 4.5 | 1/s |

### C. Surface definition (`src/shaders/lib/wake.wgsl`)

| # | Identifier | Value | Units |
|---|---|---|---|
| 100 | `WAKE_STEPS` | 20 | integration steps |
| 101 | `WAKE_NORM` | 3.35 | — |
| 102 | `WAKE_LATERAL` | 0.70 | — |
| 103 | `th0` | −0.24 | rad (−13.75°) |
| 104 | `th1` base | 1.65 | rad (94.5°) |
| 105 | `th1` curl gain | 3.30 | rad |
| 106 | tangent-sweep exponent | 1.65 | — |
| 107 | arc thinning coefficient | 0.40 | — |
| 108 | `thq` sweep base (= 1.65+0.24) | 1.89 | rad |
| 109 | lump oct1 dist frequency | 1.13 | 1/m |
| 110 | lump oct1 q frequency (x) | 0.9 | — |
| 111 | lump oct1 side offset | 17.3 | — |
| 112 | lump oct1 q frequency (y) | 1.7 | — |
| 113 | lump oct1 y offset | 5.1 | — |
| 114 | lump oct1 time rate | 0.30 | 1/s |
| 115 | lump oct1 weight | 0.55 | — |
| 116 | lump oct2 dist frequency | 3.31 | 1/m |
| 117 | lump oct2 q frequency (x) | 1.7 | — |
| 118 | lump oct2 side offset | 31.7 | — |
| 119 | lump oct2 time rate | −0.45 | 1/s |
| 120 | lump oct2 q frequency (y) | 4.3 | — |
| 121 | lump oct2 y offset | 2.7 | — |
| 122 | lump oct2 weight | 0.30 | — |
| 123 | lump oct3 dist frequency | 8.7 | 1/m |
| 124 | lump oct3 side offset | 5.3 | — |
| 125 | lump oct3 q frequency | 9.1 | — |
| 126 | lump oct3 time rate | 0.9 | 1/s |
| 127 | lump oct3 weight | 0.15 | — |
| 128 | lump amplitude | 0.085 | unit-section |
| 129 | lump q-gate smoothstep lo | 0.12 | q |
| 130 | lump q-gate smoothstep hi | 0.72 | q |
| 131 | GPU `l0` base | 0.24 | m |
| 132 | GPU `l0` gain | 0.44 | m |
| 133 | GPU `l0` smoothstep lo | 0.3 | m |
| 134 | GPU `l0` smoothstep hi | 2.6 | m |
| 135 | backward shear coefficient | 0.34 | × amp |
| 136 | base sink | −0.10 | m |
| 137 | erosion q smoothstep lo | 0.84 | q |
| 138 | erosion q smoothstep hi | 1.06 | q |
| 139 | erosion age mix lo | 0.34 | threshold |
| 140 | erosion age mix hi | 0.70 | threshold |
| 141 | erosion age smoothstep lo | 0.68 | age01 |
| 142 | erosion age smoothstep hi | 1.0 | age01 |
| 143 | erosion age weight | 0.95 | — |
| 144 | erosion early-out epsilon | 0.001 | — |
| 145 | erosion A: dist freq (x) | 6.9 | 1/m |
| 146 | erosion A: q freq (x) | 3.1 | — |
| 147 | erosion A: time rate (x) | 0.9 | 1/s |
| 148 | erosion A: q freq (y) | 13.0 | — |
| 149 | erosion A: dist freq (y) | −2.2 | 1/m |
| 150 | erosion A: time rate (y) | −0.6 | 1/s |
| 151 | erosion B: dist freq (x) | 19.0 | 1/m |
| 152 | erosion B: q freq (x) | −9.0 | — |
| 153 | erosion B: offset | 31.7 | — |
| 154 | erosion B: time rate (x) | −3.1 | 1/s |
| 155 | erosion B: q freq (y) | 31.0 | — |
| 156 | erosion B: dist freq (y) | 7.0 | 1/m |
| 157 | erosion B: time rate (y) | 2.3 | 1/s |
| 158 | erosion noise scale | 0.72 | — |
| 159 | erosion noise bias | 0.5 | — |
| 160 | erosion coarse weight | 0.58 | — |
| 161 | erosion fine weight | 0.42 | — |

### D. Wake vertex shader

| # | Identifier | Value | Units |
|---|---|---|---|
| 162 | difference step (u and q) | 0.65 | lattice cells |
| 163 | normal-length test epsilon | 1e-7 | — |
| 164 | normal divide guard | 1e-8 | — |
| 165 | sign-flip midpoint | 0.5 | u / q |

### E. Wake fragment shader

| # | Identifier | Value | Units |
|---|---|---|---|
| 166 | `albedo` | (0.895, 0.920, 0.965) | linear RGB |
| 167 | `roughness` | 0.80 | — |
| 168 | `f0` | 0.026 | — |
| 169 | `thickness` at base | 0.92 | — |
| 170 | `thickness` at lip | 0.32 | — |
| 171 | thickness smoothstep lo | 0.15 | q |
| 172 | thickness smoothstep hi | 0.95 | q |
| 173 | grain projection A | (0.91, 0.23, −0.35) | — |
| 174 | grain projection B | (0.28, 0.84, 0.46) | — |
| 175 | fine grain frequency | 26.0 | 1/m |
| 176 | fine grain strength | 0.15 | — |
| 177 | fine fade smoothstep lo/hi | 0.012 / 0.09 | m footprint |
| 178 | coarse grain frequency | 5.5 | 1/m |
| 179 | coarse grain strength | 0.10 | — |
| 180 | coarse fade smoothstep lo/hi | 0.09 / 0.55 | m footprint |
| 181 | fade skip epsilon | 0.002 | — |
| 182 | footprint floor | 1e-4 | m |
| 183 | tangent-frame `N.y` switch | 0.99 | — |
| 184 | barrel smoothstep lo/hi | 0.05 / 0.75 | q |
| 185 | barrel curl base | 0.45 | — |
| 186 | barrel curl gain | 0.55 | — |
| 187 | occlusion floor | 0.30 | — |
| 188 | cave tint | (0.55, 0.72, 1.0) | linear RGB |
| 189 | cave tint amount | 0.95 | — |
| 190 | diffuse wrap | 0.66 | — |
| 191 | SSS strength multiplier | 0.45 | × `sssStrength` |
| 192 | SSS radius | 1.5 | — |
| 193 | SSS shadow coupling | 0.18 → 1.0 | — |
| 194 | snow-bounce ambient factor | 0.30 | — |
| 195 | sky-reflection mip | `sqrt(0.80)·6.0` = 5.366 | mip level |
| 196 | glint contribution | 0.5 | × |
| 197 | `INV_PI` | 0.31830988618 | — |
| 198 | 2π literal | 6.28318530718 | — |
| 199 | debug mode count | 10 | modes |

### F. Spray system

| # | Identifier | Value | Units |
|---|---|---|---|
| 200 | `CAPACITY` | 5120 | particles |
| 201 | `TERMINAL` | 1.9 | m/s |
| 202 | integration `dt` clamp | 1/30 | s |
| 203 | wind speed scale | 2.4 | m/s |
| 204 | gravity | −9.81 | m/s² |
| 205 | ground-contact horizontal damp | 0.2 | × |
| 206 | ground-contact age multiplier | 2.5 | × h |
| 207 | puff growth over life | 1.3 | × |
| 208 | alpha fade-in rate | 8 | × age01 |
| 209 | default drag (clod / powder) | 1.1 / 5.2 | 1/s |
| 210 | seed hash coefficients | 0.618033 / 0.137 / 0.311 | — |
| 211 | spray `shadowSoftness` / `shadowBias` | 1.6 / 0.05 | × / m |
| 212 | billboard spin rate coefficient | 3.0 | rad per age01 |
| 213 | edge wobble amplitude | 0.34 | — |
| 214 | edge wobble frequency / seed scale | 2.4 / 37.0 | — |

### G. Spray shading, speed streaks, camera shake, and shared/driving constants

*(Entries 215–268. Unnumbered because several rows bundle a tightly-coupled tuple; the row count
is 54.)*

| Identifier | Value | Units |
|---|---|---|
| powder edge exponent | 1.6 | — |
| clod edge smoothstep | 1.0 → 0.65 | r |
| alpha scale (powder / clod) | 0.36 / 0.55 | — |
| alpha discard threshold | 0.004 | — |
| spray albedo | (0.92, 0.94, 0.98) | linear RGB |
| spray diffuse wrap | 0.75 | — |
| forward-scatter Mie `g` | 0.55 | — |
| forward-scatter coefficient | 0.85 | — |
| forward-scatter shadow mix | 0.25 → 1.0 | — |
| forward-scatter clod attenuation | 0.5 | — |
| spell-light particle wrap | 0.8 | — |
| `streak01` speed offset / span | 7 / 11 | m/s |
| streak radius smoothstep | 0.34 → 1.05 | normalised radius |
| streak activation threshold | 0.002 | — |
| streak smear taps | 6 | — |
| streak smear max displacement | 0.026 | × dFocus |
| streak smear blend | 0.88 | — |
| strand angular cells | 96.0 | cells / 2π |
| strand hash constants | 12.9898, 4.1, 43758.5453 | — |
| strand density gate | 0.34 | — |
| strand radial frequency | 11.0 + rnd·24.0 | cycles |
| strand scroll rate | 7.0 + rnd·22.0 | 1/s |
| strand segment smoothstep | 0.55 / 0.86 / 1.0 | phase |
| strand across exponent | 20 | — |
| strand colour | (0.88, 0.94, 1.06) | linear RGB |
| strand intensity | 0.16 | × streak |
| trauma load gate | 0.25 | — |
| trauma injection rate | 1.35 | 1/s |
| trauma decay | 1.15 | 1/s |
| shake positional amplitude x,y / z | 0.16 / 0.10 | m at shake=1 |
| shake noise rate (position) | 26 | 1/s |
| shake noise offsets (position) | 31.7 / 71.3 | — |
| shake rotational amplitude pitch,yaw / roll | 0.02 / 0.05 | rad at shake=1 |
| shake noise rates (rotation) | 31 / 29 / 23 | 1/s |
| shake noise offsets (rotation) | 11 / 53 / 97 | — |
| `hash1` constants | 127.1 / 43758.5453 | — |
| `SURF_MAX` (drives everything) | 19.5 | m/s |
| `SURF_TURN` | 2.35 | rad/s |
| carve exponential damp rate | 9 | 1/s |
| lean exponential damp rate | 6.5 | 1/s |
| lean lateral-accel scale | 26 | m/s² |
| lean surf blend | 0.35 + 0.65·surf | — |
| surf blend ease in / out | 2.6 / 3.4 | 1/s |
| cascade splits | 26 / 95 / 330 | m |
| shadow map resolution | 2048 | px |
| cascade cross-fade start | 0.88 | × split |
| PCSS blocker taps / filter taps | 8 / 12 | — |
| PCSS max penumbra | min(24·texel, 1.8/orthoWidth) | UV |
| PCSS sun angular factor | 0.0093 | penumbra per m |
| glint cell A / B | 0.052 / 0.185 | m |
| glint sharpness A / B | 780 / 1500 | — |
| aerial defaults (density / falloff / start / strength) | 0.0072 / 0.045 / 24 / 1.0 | — |
| `noised` value range | ≈ ±0.7 | — |
| `ign` constants | 52.9829189, 0.06711056, 0.00583715 | — |

---

*End of spec.*
