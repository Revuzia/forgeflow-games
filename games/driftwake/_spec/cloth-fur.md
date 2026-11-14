# SNOWFLOW — Verlet Garment Cloth + Shell Fur

**Implementation spec for a Three.js r172 / WebGL2 / GLSL 3.00 es port.**

Extracted from the WebGPU + Babylon.js + WGSL reference. Every number below is transcribed
verbatim from the reference source. Nothing here is inferred, rounded, or remembered.

---

## 0. Scope, source files, and what this subsystem is

### 0.1 Primary sources (read in full)

| File | Role |
|---|---|
| `src/character/cloth.js` | Panel definitions (rest shapes), the Verlet solver, constraints, capsule collision, ground contact. **CPU / JavaScript. Not a shader.** |
| `src/shaders/cloth.vertex.wgsl` | Beauty-pass vertex program for the garments. Reconstructs the render surface from the sim grid. |
| `src/shaders/fur.vertex.wgsl` | Shell-fur vertex program: single-bone skin + squared droop. |
| `src/shaders/fur.fragment.wgsl` | Shell-fur fragment program: hashed strand field alpha test + fibre shading. |

### 0.2 Supporting sources (read to make the above reproducible)

| File | What was taken from it |
|---|---|
| `src/shaders/lib/charSkin.wgsl` | `sampleCloth`, `clothNode`, `crBasis`, `crDeriv`, `skinPoint1`, `skinDir1`. **This is where the Catmull-Rom lives.** |
| `src/character/build.js` | `buildClothMesh` (the render lattice), `buildFur` / `emitFurBand` (the partial torus), `hoodRimPoint`, `HEAD_C`, `FACE_DIR`, material slot ids. |
| `src/character/character.js` | The 48×64 transform texture, panel row allocation, `panelParams`, `furDroop`, `furDensity`, `furColor`, settle-on-first-frame, per-frame order. |
| `src/character/figure.js` | Bone indices, `BONE_COUNT`, `skin[]` / `joint[]` array layouts, the bind table. |
| `src/shaders/lib/noise.wgsl` | `hash21`, `hash22`, `ign`. |
| `src/shaders/lib/shading.wgsl` | `wrapDiffuse`, `backScatter`, `distributionGGX`, `shIrradiance`. |
| `src/shaders/clothDepth.vertex.wgsl`, `clothPrepass.vertex.wgsl` | Shadow / prepass variants (same reconstruction). |
| `src/terrain/heightfield.js` | `heightAt` — the bicubic B-spline lookup the hem uses. |
| `src/core/settings.js` | `windDirection = 42`, `windStrength = 1.0`, `ambientIntensity = 1.0`. |

### 0.3 One-paragraph summary of the subsystem

Four closed tubes of particles (robe, mantle, two sleeves) are integrated on the **CPU** with
position-Verlet. Each particle knows one bone and one bind-pose position; its kinematic target is
that bind position pushed through the bone's skinning matrix, and a per-particle **rate** (in 1/s)
decides how hard it is pulled toward that target. Distance, bending and shape-memory constraints
are relaxed six times per substep, then the particles are pushed out of nine body capsules and the
robe's bottom two rows are clamped above the snow. The solved node positions are written into rows
4+ of a single 48×64 RGBA32F texture (rows 0–3 are bone matrices), one upload per frame. The render
mesh carries **no positions** — its `position` attribute is `(u, v, panelIndex)` — and the vertex
shader reconstructs a smooth surface with a bicubic Catmull-Rom over 16 texel fetches. Shell fur
at the hood rim and the two cuffs is a partial torus emitted 22 (hood) / 18 (cuff) times with the
shell offset baked into the vertex position; the fragment shader alpha-tests a hashed strand field
whose survival threshold and radius both fall off up the shell stack.

### 0.4 Deliberately out of scope

The garments' **fragment** shading (`char.fragment.wgsl` — the fabric weave, sheen, anisotropy,
transmission, and the material palette lookup) is a separate subsystem. This document specifies the
varying contract the cloth vertex shader must emit into it (§8.1) and stops there. Bone posing,
IK, and gait (`figure.js`) are likewise another subsystem; this document specifies only what cloth
and fur *read* out of it (§5.1, §5.2).

---

## 1. The `ClothPanel` data model

### 1.1 Fields set from the spec object

```
name        string
cols        int    nodes around the tube (u, wraps)
rows        int    nodes down the tube  (v, clamps)
matId       int    index into the material palette
renderCols  int    quads around the render surface
renderRows  int    quads down the render surface
weaveU      float  METRES of surface around the tube (uv.x at u=1)
weaveV      float  METRES of surface down the tube   (uv.y at v=1)
aoTop       float  baked occlusion at v=0
aoBottom    float  baked occlusion at v=1
collide     int    bitmask of capsule groups this panel tests
groundRows  int    number of BOTTOM rows that test the snow surface (default 0)
nodeRow     int    assigned at construction: first texture row for this panel's grid
```

### 1.2 Collision group bits (verbatim)

```js
const C_TORSO = 1;
const C_LEGS  = 2;
const C_ARM_L = 4;
const C_ARM_R = 8;
```

### 1.3 Per-panel typed arrays (all sized at construction, **never reallocated**)

With `n = cols * rows`:

| Array | Type | Length | Meaning |
|---|---|---|---|
| `bindPos` | Float32Array | `n*3` | authored rest position, bind-pose world space |
| `pos` | Float32Array | `n*3` | current world position |
| `prev` | Float32Array | `n*3` | previous world position (the Verlet velocity carrier) |
| `target` | Float32Array | `n*3` | this substep's skinned kinematic target |
| `bone` | Int32Array | `n` | one bone index per particle |
| `pinRate` | Float32Array | `n` | pull rate toward `target`, 1/second. `Infinity` = welded |
| `restU` | Float32Array | `n` | rest length of the ring link `(i,j) → ((i+1)%cols, j)` |
| `restV` | Float32Array | `n` | rest length of the column link `(i,j) → (i, j+1)` |
| `restB` | Float32Array | `n` | rest length of the bending link `(i,j) → (i, j+2)` |

Particle index convention throughout: `k = j * cols + i`, with `i` the column (around) and `j` the
row (down). Float triples are at `k*3`.

### 1.4 `pinRate` semantics — the load-bearing design decision

The reference documents the intended bands verbatim:

```
Infinity   the waistband, the collar, the shoulder of a sleeve. Welded.
10-60      follows the body closely, with a frame or two of give.
1-5        follows loosely — this is where a garment starts to read as cloth.
0.2-0.5    shape memory only. Stops a free hem from slowly collapsing into
           a rope without meaningfully resisting motion.
```

This is a **rate in 1/s**, converted to a per-iteration blend by `1 - exp(-rate*h)` (§4.4). It must
NOT be ported as a fixed per-frame lerp factor. The reference's own note: *"a '0.05 blend' applied
165 times a second is a 12 ms time constant, which is a weld."*

The `0.2–0.5` band is the **shape-memory constraint**. There is no separate shape-memory solver —
shape memory *is* a very low `pinRate` toward the skinned rest shape, which is why the pleats
authored into `bindPos` are recovered rather than damped out.

### 1.5 `finalise()` — rest lengths are measured from the bind pose

```js
finalise() {
    const { cols, rows, bindPos } = this;
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const a  = (j * cols + i) * 3;
            const bu = (j * cols + ((i + 1) % cols)) * 3;
            this.restU[j * cols + i] = dist3(bindPos, a, bindPos, bu);
            if (j + 1 < rows) {
                const bv = ((j + 1) * cols + i) * 3;
                this.restV[j * cols + i] = dist3(bindPos, a, bindPos, bv);
            }
            if (j + 2 < rows) {
                const bb = ((j + 2) * cols + i) * 3;
                this.restB[j * cols + i] = dist3(bindPos, a, bindPos, bb);
            }
        }
    }
    this.pos.set(bindPos);
    this.prev.set(bindPos);
}
```

`dist3` is plain Euclidean distance (`Math.hypot`).

**This is the mechanism by which folds live in the rest shape and not in a normal map.** The
`restU` ring lengths around a pleated tube are *unequal* — long across a fold crest, short in a
valley. The distance constraint therefore actively preserves the fold. A normal-map approach would
slide the fold across the surface as the garment moves; here the fold is a property of the
particle grid and travels with it.

The last two lines mean the simulation starts *exactly* on the authored shape with zero velocity.

---

## 2. The four panels — rest-shape generators, verbatim

Panel order returned by `makePanels()` is fixed and is the panel index used everywhere:

```js
export function makePanels() {
    return [makeRobe(), makeMantle(), makeSleeve(0), makeSleeve(1)];
}
```

| index | panel | cols × rows | particles | render quads | render verts |
|---|---|---|---|---|---|
| 0 | robe | 36 × 12 | 432 | 72 × 32 | 73 × 33 = 2409 |
| 1 | mantle | 28 × 7 | 196 | 64 × 22 | 65 × 23 = 1495 |
| 2 | sleeve0 (left, s = −1) | 10 × 8 | 80 | 26 × 20 | 27 × 21 = 567 |
| 3 | sleeve1 (right, s = +1) | 10 × 8 | 80 | 26 × 20 | 27 × 21 = 567 |

Totals: **788 simulated particles**, **5038 render vertices**, **9504 render triangles**.

Bone indices referenced (from `figure.js`):

```
B_ROOT=0  B_SPINE=1  B_CHEST=2  B_NECK=3   B_HEAD=4   B_HOOD=5
B_UPPER_L=6  B_FORE_L=7  B_HAND_L=8
B_UPPER_R=9  B_FORE_R=10 B_HAND_R=11
B_THIGH_L=12 B_SHIN_L=13 B_FOOT_L=14
B_THIGH_R=15 B_SHIN_R=16 B_FOOT_R=17
BONE_COUNT = 18
```

Material slot ids (`build.js`): `M_ROBE=0  M_MANTLE=1  M_TUNIC=2  M_LEATHER=3  M_SKIN=4
M_TRIM=5  M_FUR=6`.

---

### 2.1 Panel 0 — the robe

**Spec block, verbatim:**

```js
name: "robe", cols: 36, rows: 12, matId: M_ROBE,      // matId 0
renderCols: 72, renderRows: 32,
weaveU: 1.75, weaveV: 1.05,     // metres of surface
aoTop: 0.55, aoBottom: 0.42,
collide: C_TORSO | C_LEGS,      // = 3
groundRows: 2,
```

**Pin-rate table, one entry per row `j` (12 entries):**

```js
const RATE = [Infinity, 30, 10, 4, 1.6, 0.9, 0.55, 0.4, 0.35, 0.3, 0.3, 0.3];
```

Row 0 is welded to the waistband. Rows 9–11 are the shape-memory band (0.3 /s → 3.3 s time
constant).

**Bind-pose generator, per `(i, j)`:**

```
v  = j / (rows - 1)              // rows-1 = 11
a  = (i / cols) * 2*PI           // cols = 36
sa = sin(a); ca = cos(a)         // ca = +1 at the FRONT (+Z), -1 at the BACK

f  = pow(v, 1.25)                // flare accelerates downward

// Three incommensurate frequencies, so no two folds are alike:
fold  = 0.118 * sin(a*7  + 0.6)
      + 0.055 * sin(a*12 + 2.1)
      + 0.026 * sin(a*19 + 4.4)
pleat = 1 + f * fold             // pleat == 1 exactly at v=0, deepest at v=1

hemY = 0.300 + 0.200*ca - 0.048*sin(a*7 + 0.6)
y    = 0.990 + (hemY - 0.990) * v

rx = (0.158 + (0.345 - 0.158) * f) * pleat
rz = (0.128 + (0.318 - 0.128) * f * (1 - 0.12*ca)) * pleat

bindPos = ( rx * sa,
            y,
            rz * ca - 0.010 * v )
bone    = B_ROOT   // 0, for every particle
pinRate = RATE[j]
```

**Derived shape facts (compute these to check a port):**

- Waistband (`v = 0`): `y = 0.990 m`, `rx = 0.158`, `rz = 0.128`, `pleat = 1` — a clean ellipse,
  no folds. Sits just outside the belt (`build.js` belt rings are 0.152–0.160 × 0.123–0.130 at
  y 0.955–1.035).
- Hem at the front (`a = 0`, `ca = +1`): `hemY = 0.500 − 0.048·sin(0.6) = 0.4729 m` — mid-shin,
  boots visible.
- Hem at the back (`a = π`, `ca = −1`): `sin(7π + 0.6) = −sin(0.6)`, so
  `hemY = 0.100 + 0.02711 = 0.1271 m` — nearly on the ground. **A 34.6 cm front-to-back
  difference. This is the train.**
- Hem radius, front: `rz = 0.318 × (1 − 0.12) = 0.2798`. Hem radius, back:
  `rz = 0.318 × 1.12 = 0.3562`. The back flares **27% further** than the front.
- The `− 0.010 * v` term pushes the whole hem 1 cm toward −Z (backward).
- The hem-scallop term `−0.048·sin(a·7 + 0.6)` is deliberately **in phase** with the dominant fold
  term `+0.118·sin(a·7 + 0.6)`: where the pleat bulges out, the hem hangs lowest. The reference's
  note: *"in phase with the pleat it produced a row of hard spikes instead"* — meaning the sign
  shown here (negative on `hemY`, i.e. lower) is the correct one.
- Fold amplitude scales with `f = v^1.25`, so it is **exactly zero at the waistband** and maximal
  at the hem.
- Dominant fold harmonic is 7 cycles per revolution at amplitude 0.118, with secondaries at 12
  (0.055) and 19 (0.026). 36 columns = ~5.1 samples per primary fold. The source comment describes
  this as "nine pleats … four samples each"; the transcribed frequencies are what to implement.

---

### 2.2 Panel 1 — the mantle (short over-cape)

**Spec block, verbatim:**

```js
name: "mantle", cols: 28, rows: 7, matId: M_MANTLE,   // matId 1
renderCols: 64, renderRows: 22,
weaveU: 1.35, weaveV: 0.72,
aoTop: 0.85, aoBottom: 0.6,
collide: C_TORSO | C_ARM_L | C_ARM_R,   // = 13
// groundRows omitted -> 0
```

**Pin rates (7 entries):**

```js
const RATE = [Infinity, 40, 12, 4, 1.5, 0.8, 0.45];
```

**Control tables, verbatim:**

```js
// [t, rx, rz]
const RAD = [
    [0.00, 0.176, 0.148],
    [0.20, 0.222, 0.176],
    [0.55, 0.235, 0.196],
    [1.00, 0.246, 0.214],
];
// [t, y, unused]
const YT = [
    [0.00, 1.442, 0],
    [0.20, 1.352, 0],
    [0.55, 1.220, 0],
    [1.00, 0.000, 0], // OVERWRITTEN PER COLUMN, see below
];
```

**The `curve()` piecewise-linear lookup, verbatim:**

```js
function curve(table, t) {
    let i = 0;
    while (i < table.length - 2 && t > table[i + 1][0]) i++;
    const A = table[i], Bb = table[i + 1];
    const s = Bb[0] > A[0] ? (t - A[0]) / (Bb[0] - A[0]) : 0;
    const k = Math.min(1, Math.max(0, s));
    return [A[1] + (Bb[1] - A[1]) * k, A[2] + (Bb[2] - A[2]) * k];
}
```

**Generator, per `(i, j)`:**

```
v          = j / (rows - 1)          // rows-1 = 6
[rx, rz]   = curve(RAD, v)           // hoisted OUT of the column loop
a          = (i / cols) * 2*PI       // cols = 28
sa = sin(a); ca = cos(a)

YT[3][1]   = 1.045 + 0.115*ca + 0.035*sin(a*7 + 1.4)   // <-- mutated per column
y          = curve(YT, v)[0]

pleat      = 1 + v * ( 0.062*sin(a*7  + 1.4)
                     + 0.026*sin(a*11 + 3.0) )

bindPos = ( rx * sa * pleat,
            y,
            rz * ca * pleat - 0.012 )
bone    = B_CHEST    // 2, for every particle
pinRate = RATE[j]
```

**Ordering hazard for the port:** `YT[3][1]` is written inside the column loop and read by the
very next `curve(YT, v)` call. The mantle's bottom-edge height is therefore a function of the
column, while `RAD` is not. A port that hoists `curve(YT, v)` out of the column loop produces a
mantle with a flat circular hem and loses the scallop.

**Derived per-row radii (independent of column):**

| j | v | rx | rz | y (rows 0–3 only; rows 4–6 depend on column) |
|---|---|---|---|---|
| 0 | 0.0000 | 0.17600 | 0.14800 | 1.44200 |
| 1 | 0.16667 | 0.21433 | 0.17133 | 1.36700 |
| 2 | 0.33333 | 0.22695 | 0.18362 | 1.30171 |
| 3 | 0.50000 | 0.23314 | 0.19314 | 1.24066 |
| 4 | 0.66667 | 0.23785 | 0.20067 | `1.220 + (YT31 − 1.220)·0.25926` |
| 5 | 0.83333 | 0.24193 | 0.20733 | `1.220 + (YT31 − 1.220)·0.62963` |
| 6 | 1.00000 | 0.24600 | 0.21400 | `YT31` |

with `YT31 = 1.045 + 0.115·cos(a) + 0.035·sin(7a + 1.4)`.

Mantle bottom edge, evaluated:
- Front (`a = 0`): `cos a = +1`, `sin(7·0 + 1.4) = 0.98545` → `1.045 + 0.115 + 0.03449 =`
  **1.19449 m**.
- Back (`a = π`): `cos a = −1`, `sin(7π + 1.4) = sin(π + 1.4) = −0.98545` →
  `1.045 − 0.115 − 0.03449 =` **0.89551 m**.

Front-to-back drop **0.2990 m**. The front stops around the sternum; the back reaches the small of
the back. The `0.035·sin(7a + 1.4)` term makes that edge scallop with the folds rather than cut a
clean arc.

The collar (row 0) is welded (`Infinity`) at 0.176 × 0.148 — deliberately **inside** the shoulders.
The reference note: starting it wider makes the mantle read as *"a flat plate bolted to the chest."*

---

### 2.3 Panels 2 and 3 — the sleeves

`makeSleeve(side)` with `side ∈ {0, 1}`; `s = (side === 0) ? -1 : +1`.

**Spec block, verbatim:**

```js
name: "sleeve" + side, cols: 10, rows: 8, matId: M_ROBE,   // matId 0
renderCols: 26, renderRows: 20,
weaveU: 0.46, weaveV: 0.66,
aoTop: 0.6, aoBottom: 0.5,
collide: side === 0 ? C_ARM_L : C_ARM_R,    // 4 or 8
// groundRows omitted -> 0
```

**Arm skeleton anchors (bind-pose world space), verbatim:**

```js
const UP = [s * 0.185, 1.400, 0.000];   // shoulder
const EL = [s * 0.230, 1.123, 0.000];   // elbow
const WR = [s * 0.243, 0.866, 0.016];   // wrist

// Direction beyond the wrist, continuing the forearm:
let dx = WR[0]-EL[0], dy = WR[1]-EL[1], dz = WR[2]-EL[2];
const dl = Math.hypot(dx, dy, dz);
dx /= dl; dy /= dl; dz /= dl;
```

(For `s = +1`: `d ≈ (0.05038, −0.99593, 0.06199)`, `dl ≈ 0.25806`.)

**Row table `[segment, t, radius]` — 8 rows, verbatim:**

```js
const ROWS = [
    [0, 0.00, 0.084], [0, 0.45, 0.076], [0, 1.00, 0.072],
    [1, 0.40, 0.068], [1, 0.75, 0.064], [1, 1.00, 0.061],
    [2, 0.045, 0.072], [2, 0.125, 0.098],
];
```

- Segment 0 = upper arm: `c = UP + (EL − UP)·t` (t is normalised along the segment)
- Segment 1 = forearm: `c = EL + (WR − EL)·t`
- Segment 2 = **past the wrist**: `c = WR + d·t` — here `t` is an **absolute distance in metres**,
  not a normalised parameter. Row 6 is 4.5 cm past the wrist; row 7 is 12.5 cm past it.

Row 6→7 is where the radius jumps 0.072 → **0.098** (a 36% flare) — that is the drape of the cuff.
Note: the sleeve is skipped over the elbow region (segment 1 starts at t = 0.40, not 0.00) so
there is a deliberate gap in ring density right at the joint.

**Bone tables, verbatim:**

```js
const BONE   = [B_UPPER_L, B_UPPER_L, B_UPPER_L,
                B_FORE_L, B_FORE_L, B_FORE_L, B_FORE_L, B_HAND_L];   // 6,6,6,7,7,7,7,8
const BONE_R = [B_UPPER_R, B_UPPER_R, B_UPPER_R,
                B_FORE_R, B_FORE_R, B_FORE_R, B_FORE_R, B_HAND_R];   // 9,9,9,10,10,10,10,11
```

**Pin rates (8 entries), verbatim:**

```js
const RATE = [Infinity, 50, 26, 40, 18, 9, 5, 1.2];
```

**This table is deliberately non-monotonic.** Row 3 (40) is pinned *harder* than row 2 (26): the
sleeve is re-anchored at the top of the forearm so it cannot slide off the elbow. The reference's
note: *"A fully free sleeve looks wonderful for about four seconds and then slides off the elbow."*
Only rows 6 (5 /s) and 7 (1.2 /s) are genuinely loose.

**Ring generator, per `(i, j)`:**

```
a = (i / cols) * 2*PI          // cols = 10
bindPos = ( cx + sin(a) * r,
            cy,
            cz + cos(a) * r )
bone    = (side === 0 ? BONE : BONE_R)[j]
pinRate = RATE[j]
```

The ring lies flat in the **XZ plane** (constant `y` per ring) because the arm is near-vertical in
the bind pose. There is no parallel-transport frame here — it is a literal horizontal ring.

---

## 3. What the solver reads from the skeleton

### 3.1 `fig.skin` — Float32Array(18 × 16), column-major mat4 per bone

Bone `b`'s matrix (`world * inverseBind`) occupies `skin[b*16 .. b*16+15]`. Storage is
**column-major**: element (row `r`, column `c`) is at index `c*4 + r`. So `skin[b*16+0..3]` is
column 0 (basis X), `+4..7` column 1 (basis Y), `+8..11` column 2 (basis Z), `+12..15` the
translation column.

The transform is applied as (verbatim from `_step`):

```js
target[o]     = skin[b]*x     + skin[b+4]*y + skin[b+8]*z  + skin[b+12];
target[o + 1] = skin[b+1]*x   + skin[b+5]*y + skin[b+9]*z  + skin[b+13];
target[o + 2] = skin[b+2]*x   + skin[b+6]*y + skin[b+10]*z + skin[b+14];
```

### 3.2 `fig.joint` — Float32Array(18 × 3), world joint positions

`joint[b*3 .. b*3+2]` is the translation column of bone `b`'s **world** matrix (not the skinning
matrix): `joint[b*3+k] = world[b*16 + 12 + k]`. The capsule table (§4.6) uses these directly.

### 3.3 `ch` — the character controller

Only two vectors are read: `ch.velocity` (Vector3, m/s) and — for the fur only — `ch.acceleration`
(Vector3, m/s²).

### 3.4 `terrain.heightAt(x, z)` — the hem's ground probe

Bicubic **B-spline** reconstruction of the 4096² CPU mirror of the baked heightfield, matching the
terrain vertex shader's own reconstruction. Signature: `(x, z) → y` in metres.

**Verified critical caveat:** `Terrain.heightAt` delegates to `Heightfield.heightAt`, which reads
`this.heightCPU` — the baked macro heightfield. It does **not** include the persistent deformation
buffer (trails, berms, spell craters). The hem therefore rides the *undeformed* macro snow surface
and does not descend into a trench the player has just carved.

---

## 4. The Verlet solver

### 4.1 Global constants

```js
const ITERATIONS = 6;   // "Six is where the robe stops looking rubbery."
```

### 4.2 `update(dt, fig, ch)` — timestep and substeps, verbatim

```js
let h = Math.min(dt, 1 / 30);
let steps = 1;
if (h > 1 / 55) { steps = 2; h *= 0.5; }
this._t += dt;
```

Behaviour table:

| frame `dt` | `h` | `steps` | total simulated time |
|---|---|---|---|
| ≤ 1/55 s (0.018182) | `dt` | 1 | `dt` |
| 1/55 < dt < 1/30 | `dt/2` | 2 | `dt` |
| ≥ 1/30 s (0.033333) | 1/60 s | 2 | 1/30 s (**clamped**) |

The accumulator `_t` advances by the **full `dt`**, once per `update()`, before the substep loop —
it is not advanced per substep. Wind and turbulence therefore both sample the same `_t` in both
substeps of a frame.

### 4.3 Apparent wind — computed once per `update()`, shared by all substeps and all panels

```js
const a = (S.windDirection * Math.PI) / 180;      // default windDirection = 42 degrees
const ws = 3.2 * S.windStrength;                  // default windStrength = 1.0
const gust = 1 + 0.35 * Math.sin(this._t * 0.7)
               + 0.18 * Math.sin(this._t * 2.3 + 1.1);
this._wind[0] = Math.sin(a) * ws * gust - ch.velocity.x;
this._wind[1] = 0.35 * Math.sin(this._t * 1.9);
this._wind[2] = Math.cos(a) * ws * gust - ch.velocity.z;
```

- Field wind speed at default settings: **3.2 m/s**, gusting between 0.47× and 1.53× (range
  1.50 – 4.90 m/s) at two incommensurate rates (0.7 rad/s ≈ 0.111 Hz, 2.3 rad/s ≈ 0.366 Hz).
- Bearing convention: `a = 0` blows toward **+Z**; the X component is `sin(a)`, the Z component
  `cos(a)`.
- The vertical component is pure oscillation, **±0.35 m/s at 1.9 rad/s (0.302 Hz)**, with no gust
  factor and no character-velocity subtraction.
- Subtracting `ch.velocity.xz` is what makes it *apparent* wind: this single line is why the robe
  lays out flat behind a snow-surf run with no special case.

### 4.4 `_step(panel, h, fig)` — order of operations

```
1. Kinematic targets   (all n particles, from fig.skin)
2. Integrate           (skipping welded particles)
3. for it in 0..5:
       _anchors(panel, h)
       _distance(panel, it)
4. _collide(panel, fig)    <-- ONCE, after all six iterations
```

Note that collision is **not** interleaved into the constraint loop. It runs once per substep,
last. The substepping at low frame rate exists precisely because of this: *"a long step lets the
hem overshoot through the legs before the collision pass sees it."*

### 4.5 The integrator, verbatim

```js
const wx = this._wind[0], wy = this._wind[1], wz = this._wind[2];
const wmag = Math.hypot(wx, wy, wz);
const drag = 0.085 * wmag;
const damp = Math.pow(0.90, h * 60);
const h2 = h * h;

for (let k = 0; k < n; k++) {
    if (!isFinite(p.pinRate[k])) continue;        // welded; skip the integrator
    const o = k * 3;
    // Turbulence, hashed off the particle index so it does not pulse in unison.
    const ph = k * 1.7 + this._t * 4.5;
    const tx = Math.sin(ph) * 0.9;
    const ty = Math.sin(ph * 1.31 + 2.1) * 0.7;
    const tz = Math.cos(ph * 0.87 + 0.4) * 0.9;

    const ax = wx * drag + tx * drag * 0.25;
    const ay = wy * drag - 9.81 + ty * drag * 0.25;
    const az = wz * drag + tz * drag * 0.25;

    const vx = (pos[o]     - prev[o])     * damp;
    const vy = (pos[o + 1] - prev[o + 1]) * damp;
    const vz = (pos[o + 2] - prev[o + 2]) * damp;

    prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
    pos[o]     += vx + ax * h2;
    pos[o + 1] += vy + ay * h2;
    pos[o + 2] += vz + az * h2;
}
```

Constants and exact semantics a port must not "improve":

| Symbol | Value | Units | Note |
|---|---|---|---|
| drag coefficient | `0.085` | 1/m | `drag = 0.085·‖w‖`; acceleration is `w·drag`, i.e. **quadratic in wind speed** |
| gravity | `−9.81` | m/s² | applied on Y only |
| damping base | `0.90` | — | per 1/60 s |
| damping exponent | `h * 60` | — | `damp = 0.90^(60h)` — at h=1/60 → 0.90, at h=1/120 → 0.94868 |
| turbulence phase slope (index) | `1.7` | rad/particle | decorrelates neighbouring particles |
| turbulence phase slope (time) | `4.5` | rad/s | ≈ 0.716 Hz |
| turbulence X amplitude | `0.9` | — | `sin(ph)` |
| turbulence Y amplitude / freq / phase | `0.7`, `×1.31`, `+2.1` | — | |
| turbulence Z amplitude / freq / phase | `0.9`, `×0.87`, `+0.4` | — | uses `cos`, not `sin` |
| turbulence scale into acceleration | `0.25` | — | multiplied by `drag`, so turbulence also scales quadratically with wind |

**Two behaviours that are easy to get wrong:**

1. **The drag is not a relative-velocity drag.** It is `windVector × (0.085 × |windVector|)` — an
   acceleration along the wind direction whose magnitude is `0.085·‖w‖²`. The cloth's own velocity
   never enters. At ‖w‖ = 19 m/s this is 30.7 m/s² ≈ **3.1 g** on every free particle.
2. **This is plain, non-time-corrected Verlet.** `v` is a raw *displacement* carried from the
   previous step, not a velocity divided by the previous `h`. Changing `h` mid-run therefore
   changes the effective velocity. Do not "fix" this with time-corrected Verlet — the visible
   damping character will change.

Welded particles (`pinRate === Infinity`) are skipped entirely and their `prev` is never written,
so they carry no Verlet history at all.

### 4.6 `_anchors(p, h)` — the pin / shape-memory pull, verbatim

```js
for (let k = 0; k < n; k++) {
    const rate = p.pinRate[k];
    const o = k * 3;
    if (!isFinite(rate)) {
        pos[o] = target[o];
        pos[o + 1] = target[o + 1];
        pos[o + 2] = target[o + 2];
        continue;
    }
    if (rate <= 0) continue;
    // Divided by the iteration count so the total pull over one frame is
    // the rate the table asks for, not six times it.
    const w = (1 - Math.exp(-rate * h)) / ITERATIONS;
    pos[o]     += (target[o]     - pos[o])     * w;
    pos[o + 1] += (target[o + 1] - pos[o + 1]) * w;
    pos[o + 2] += (target[o + 2] - pos[o + 2]) * w;
}
```

The `/ ITERATIONS` divisor is essential: `_anchors` runs inside the six-iteration loop. Worked
values at `h = 1/60` (single substep, 60 fps):

| `pinRate` | `1 − e^(−rate·h)` | `w = ÷6` | effective pull over one frame |
|---|---|---|---|
| 50 | 0.56540 | 0.09423 | 44.5% |
| 40 | 0.48658 | 0.08110 | 39.7% |
| 30 | 0.39347 | 0.06558 | 33.2% |
| 12 | 0.18127 | 0.03021 | 16.9% |
| 4 | 0.06449 | 0.01075 | 6.28% |
| 1.2 | 0.01980 | 0.00330 | 1.96% |
| 0.3 | 0.00499 | 0.00083 | 0.499% |

### 4.7 `_distance(p, iteration)` — Gauss-Seidel distance + bending, verbatim

```js
const { cols, rows, pos, restU, restV, restB, pinRate } = p;
// Bending is solved softly and only on the later iterations. Solved hard
// it fights the distance constraints and the garment goes stiff.
const bendK = iteration >= ITERATIONS - 3 ? 0.22 : 0;

for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        // around the ring
        solveLink(pos, k, j * cols + ((i + 1) % cols), restU[k], pinRate, 1);
        // down the panel
        if (j + 1 < rows) {
            solveLink(pos, k, (j + 1) * cols + i, restV[k], pinRate, 1);
        }
        // bending, two rows apart
        if (bendK > 0 && j + 2 < rows) {
            solveLink(pos, k, (j + 2) * cols + i, restB[k], pinRate, bendK);
        }
    }
}
```

- **Bending stiffness `0.22`, active only on iterations 3, 4, 5** (`ITERATIONS - 3 == 3`).
  Iterations 0–2 solve distance only.
- Distance stiffness is **1.0** for both the ring and the column link.
- Traversal order is row-major (`j` outer, `i` inner) and Gauss-Seidel (in-place). **Reproduce
  this order** — a different sweep order gives a measurably different drape at only 6 iterations.
- The ring link wraps (`(i+1)%cols`), so every panel is a closed tube.

Constraint counts per iteration:

| panel | ring (U) | column (V) | bending (B, its 3–5 only) |
|---|---|---|---|
| robe | 432 | 396 | 360 |
| mantle | 196 | 168 | 140 |
| sleeve ×2 | 80 each | 70 each | 60 each |
| **total** | **788** | **704** | **620** |

### 4.8 `solveLink` — binary mass weighting, verbatim

```js
function solveLink(pos, ka, kb, rest, pinRate, stiffness) {
    const a = ka * 3, b = kb * 3;
    const dx = pos[b] - pos[a];
    const dy = pos[b + 1] - pos[a + 1];
    const dz = pos[b + 2] - pos[a + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-7) return;
    const diff = ((d - rest) / d) * stiffness;

    const fa = isFinite(pinRate[ka]);
    const fb = isFinite(pinRate[kb]);
    if (fa && fb) {
        const h = diff * 0.5;
        pos[a] += dx * h; pos[a + 1] += dy * h; pos[a + 2] += dz * h;
        pos[b] -= dx * h; pos[b + 1] -= dy * h; pos[b + 2] -= dz * h;
    } else if (fa) {
        pos[a] += dx * diff; pos[a + 1] += dy * diff; pos[a + 2] += dz * diff;
    } else if (fb) {
        pos[b] -= dx * diff; pos[b + 1] -= dy * diff; pos[b + 2] -= dz * diff;
    }
}
```

Mass weighting is **binary**: `isFinite(pinRate)` means movable (unit mass), `Infinity` means
infinite mass and the particle takes none of the correction. There are no inverse masses. Effect:
a hem cannot drag the waistband off the hips, and a free particle linked to a welded one takes the
**full** correction (`diff`, not `diff·0.5`).

Degenerate guard: `d < 1e-7` → skip.

### 4.9 `_collide(p, fig)` — nine body capsules

**The capsule table, verbatim. `[boneA, boneB, radius(m), groupMask]`:**

```js
const CAPSULES = [
    [B_ROOT,    B_NECK,   0.175, C_TORSO],   // [ 0,  3, 0.175, 1]
    [B_THIGH_L, B_SHIN_L, 0.125, C_LEGS ],   // [12, 13, 0.125, 2]
    [B_SHIN_L,  B_FOOT_L, 0.098, C_LEGS ],   // [13, 14, 0.098, 2]
    [B_THIGH_R, B_SHIN_R, 0.125, C_LEGS ],   // [15, 16, 0.125, 2]
    [B_SHIN_R,  B_FOOT_R, 0.098, C_LEGS ],   // [16, 17, 0.098, 2]
    [B_UPPER_L, B_FORE_L, 0.078, C_ARM_L],   // [ 6,  7, 0.078, 4]
    [B_FORE_L,  B_HAND_L, 0.068, C_ARM_L],   // [ 7,  8, 0.068, 4]
    [B_UPPER_R, B_FORE_R, 0.078, C_ARM_R],   // [ 9, 10, 0.078, 8]
    [B_FORE_R,  B_HAND_R, 0.068, C_ARM_R],   // [10, 11, 0.068, 8]
];
```

Endpoints are **world joint positions rebuilt from `fig.joint` every frame** — the capsules follow
the animated pose, they are not static.

Which panel tests which capsules:

| panel | mask | capsules tested | point-capsule tests / substep |
|---|---|---|---|
| robe | 3 (torso+legs) | 0,1,2,3,4 | 5 × 432 = 2160 |
| mantle | 13 (torso+both arms) | 0,5,6,7,8 | 5 × 196 = 980 |
| sleeve0 | 4 (arm L) | 5,6 | 2 × 80 = 160 |
| sleeve1 | 8 (arm R) | 7,8 | 2 × 80 = 160 |
| | | | **3460** |

**Per-particle resolution, verbatim:**

```js
const ex = bx - ax, ey = by - ay, ez = bz - az;
const elen2 = ex*ex + ey*ey + ez*ez || 1e-6;
const r = cap[2];

for (let k = 0; k < n; k++) {
    if (!isFinite(p.pinRate[k])) continue;       // welded particles are immovable
    const o = k * 3;
    let t = ((pos[o]-ax)*ex + (pos[o+1]-ay)*ey + (pos[o+2]-az)*ez) / elen2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex*t, cy = ay + ey*t, cz = az + ez*t;
    let dx = pos[o]-cx, dy = pos[o+1]-cy, dz = pos[o+2]-cz;
    const d = Math.hypot(dx, dy, dz);
    if (d >= r || d < 1e-6) continue;
    const push = (r - d) / d;
    pos[o]     += dx * push;
    pos[o + 1] += dy * push;
    pos[o + 2] += dz * push;
}
```

`push = (r − d)/d` places the particle **exactly on** the capsule surface (not inside, not
overshooting). `prev` is **not** updated, so the Verlet velocity absorbs the correction — this is
the implicit friction/impulse and it is why cloth "sticks" briefly to a limb it was pushed off.
Degenerate guards: zero-length capsule → `elen2 = 1e-6`; particle exactly on the axis → skipped.

### 4.10 The hem riding the snow, verbatim

```js
if (p.groundRows > 0) {
    const start = (p.rows - p.groundRows) * p.cols;
    for (let k = start; k < n; k++) {
        const o = k * 3;
        const g = this.terrain.heightAt(pos[o], pos[o + 2]) + 0.012;
        if (pos[o + 1] < g) pos[o + 1] = g;
    }
}
```

- Only the **robe** has `groundRows = 2`. Mantle and sleeves never test the ground.
- `start = (12 − 2) × 36 = 360`, so particles 360–431 (rows 10 and 11) are tested — **72 height
  lookups per substep**, ≤ 144 per frame.
- Clearance above the snow: **0.012 m (1.2 cm)**.
- It is a one-sided Y clamp only: no horizontal friction, no `prev` update, no normal-aligned
  push. Cloth slides freely along the surface once clamped.
- Welded particles are not exempt here (unlike the capsule loop) — but rows 10–11 of the robe have
  `pinRate` 0.3, so none are welded.

---

## 5. Panel → GPU: the shared transform texture

Everything below is from `character.js`.

### 5.1 Texture geometry

```js
const TEX_W = 48;        // width covers the widest of (BONE_COUNT=18) or (max panel cols=36)
const TEX_H = 64;
const CLOTH_ROW0 = 4;    // rows 0-3 are the bone matrices
```

Format: **RGBA32F** (`Constants.TEXTURETYPE_FLOAT`), **NEAREST** filtering, **CLAMP** on both U and
V, no mipmaps, not inverted. Total 48 × 64 × 4 channels × 4 bytes = **49 152 bytes (48 KB) per
upload, once per frame**.

### 5.2 Row layout

**Rows 0–3 — bone matrices.** Texel `(b, c)` = column `c` of bone `b`'s `world * inverseBind`
matrix, as RGBA. Written verbatim as:

```js
for (let b = 0; b < BONE_COUNT; b++) {           // 18 bones -> columns 0..17
    const s = b * 16;
    for (let c = 0; c < 4; c++) {                // 4 matrix columns -> rows 0..3
        const o = (c * TEX_W + b) * 4;
        d[o]     = skin[s + c*4];
        d[o + 1] = skin[s + c*4 + 1];
        d[o + 2] = skin[s + c*4 + 2];
        d[o + 3] = skin[s + c*4 + 3];
    }
}
```

Columns 18–47 of rows 0–3 are unused (left zero).

**Rows 4+ — cloth nodes.** One rectangle per panel, `cols` wide by `rows` tall, allocated in panel
order at construction:

```js
let row = CLOTH_ROW0;
for (let i = 0; i < this.panels.length; i++) {
    const p = this.panels[i];
    if (p.cols > TEX_W) throw new Error("panel wider than the transform texture");
    p.nodeRow = row;
    this._panelParams[i*4]     = row;
    this._panelParams[i*4 + 1] = p.cols;
    this._panelParams[i*4 + 2] = p.rows;
    row += p.rows;
}
if (row > TEX_H) throw new Error("transform texture too short for the panels");
```

Resulting allocation (**must match exactly** — `panelParams` and the shader agree by construction):

| panel index | panel | `nodeRow` | texture rows occupied | cols used |
|---|---|---|---|---|
| 0 | robe | 4 | 4 – 15 | 0 – 35 |
| 1 | mantle | 16 | 16 – 22 | 0 – 27 |
| 2 | sleeve0 (L) | 23 | 23 – 30 | 0 – 9 |
| 3 | sleeve1 (R) | 31 | 31 – 38 | 0 – 9 |
| — | first free row | 39 | (39–63 unused) | |

Node write, verbatim:

```js
for (let j = 0; j < p.rows; j++) {
    const rowO = ((p.nodeRow + j) * TEX_W) * 4;
    for (let i = 0; i < p.cols; i++) {
        const s = (j * p.cols + i) * 3;
        const o = rowO + i * 4;
        d[o] = pos[s]; d[o+1] = pos[s+1]; d[o+2] = pos[s+2]; d[o+3] = 1;
    }
}
```

Channel meaning of a node texel: `.rgb = world position (metres)`, `.a = 1.0` (constant, unused by
the shader).

### 5.3 `panelParams` uniform

`array<vec4f, 6>` (6 slots, 4 used, 2 spare). Per panel:

```
.x = nodeRow  (first texture row)
.y = cols
.z = rows
.w = 0        (unused)
```

Uploaded to `clothMat`, both `clothDepth` cascade materials, and `clothPrepass`.

### 5.4 Settle-on-first-frame

`Character.update()` runs `_settleCloth()` exactly once, on the first frame, **after**
`figure.update()` and **before** `solver.update()`:

```js
p.pos[o..o+2] = skinMatrix(p.bone[k]) * p.bindPos[o..o+2];   // for every particle
p.prev.set(p.pos);
```

Without it, the panels start at the world origin (where they are authored) and take about a second
of visible flapping to fall onto the player's actual spawn point.

---

## 6. The cloth render mesh (`buildClothMesh`)

**The mesh carries no positions.** It is a pure parameter lattice, built once at load.

```js
for (let pi = 0; pi < panels.length; pi++) {
    const p  = panels[pi];
    const cu = p.renderCols;
    const cv = p.renderRows;
    const base = pos.length / 3;

    for (let j = 0; j <= cv; j++) {
        const v = j / cv;
        for (let i = 0; i <= cu; i++) {
            const u = i / cu;
            pos.push(u, v, pi);                    // attribute "position"
            uv.push(u * p.weaveU, v * p.weaveV);   // attribute "uv", METRES of surface
            aux.push(p.matId, p.aoTop + (p.aoBottom - p.aoTop) * v);   // attribute "aux"
        }
    }

    const stride = cu + 1;
    for (let j = 0; j < cv; j++) {
        for (let i = 0; i < cu; i++) {
            const a = base + j * stride + i;
            const b = a + 1;
            const c = a + stride;
            const d = c + 1;
            idx.push(a, b, d, a, d, c);
        }
    }
}
```

### 6.1 Attribute layout

| attribute | components | contents |
|---|---|---|
| `position` | 3 | `(u, v, panelIndex)` — u ∈ [0,1] around, v ∈ [0,1] down, panelIndex ∈ {0,1,2,3} |
| `uv` | 2 | `(u·weaveU, v·weaveV)` — **metres of surface**, not normalised |
| `aux` | 2 | `(matId, ao)` where `ao = aoTop + (aoBottom − aoTop)·v` |

Index buffer is `Uint32Array`. Winding per quad: `(a, b, d, a, d, c)`.

### 6.2 Baked occlusion ramps

| panel | ao at v=0 | ao at v=1 |
|---|---|---|
| robe | 0.55 | 0.42 |
| mantle | 0.85 | 0.60 |
| sleeves | 0.60 | 0.50 |

Garments darken toward the hem, *"where they sit in their own folds and close to the ground."*

### 6.3 The seam

Both `i = 0` (u = 0) and `i = renderCols` (u = 1) are emitted. Their reconstructed positions and
normals are **identical** (the u-wrap in `clothNode` makes `u = 1` evaluate to exactly the same
16 taps as `u = 0`), so the tube is watertight and smooth-shaded across the seam. Only the `uv`
differs (0 vs `weaveU`), which is what makes the fabric weave run once around the tube per
`weaveU` metres. `weaveU` is not an integer number of weave periods, so a hairline weave
discontinuity at the seam is expected and correct.

### 6.4 Mesh flags

`alwaysSelectAsActiveMesh = true`, `isPickable = false`, `freezeWorldMatrix()`,
`doNotSyncBoundingInfo = true`, `renderingGroupId = 1`, `material.backFaceCulling = false`.

The world matrix is the identity forever and the bounding box is meaningless — everything is
placed in the vertex shader.

---

## 7. Catmull-Rom reconstruction — the 36×12 → 72×32 surface

All of §7 is from `src/shaders/lib/charSkin.wgsl`. This is the single most important piece of the
port: it is what lets a 432-particle solve render without a visible facet.

### 7.1 Node fetch, verbatim

```wgsl
/// One simulated node. `u` wraps — every garment is a closed tube — and `v`
/// clamps, because the top and bottom edges are real boundaries.
fn clothNode(tex: texture_2d<f32>, rowBase: i32, cols: i32, rows: i32, i: i32, j: i32) -> vec3f {
    let ii = (i % cols + cols) % cols;
    let jj = clamp(j, 0, rows - 1);
    return textureLoad(tex, vec2i(ii, rowBase + jj), 0).xyz;
}
```

**Boundary conventions are asymmetric and both matter:**
- `i` (around the tube) **wraps** with the double-modulo idiom (correct for negative `i`).
- `j` (down the tube) **clamps** to `[0, rows-1]`. The top and bottom edges are duplicated, which
  makes the Catmull-Rom degenerate to a natural end condition there.

### 7.2 The Catmull-Rom basis and its derivative, verbatim

```wgsl
fn crBasis(t: f32) -> vec4f {
    let t2 = t * t;
    let t3 = t2 * t;
    return vec4f(
        0.5 * (-t3 + 2.0 * t2 - t),
        0.5 * (3.0 * t3 - 5.0 * t2 + 2.0),
        0.5 * (-3.0 * t3 + 4.0 * t2 + t),
        0.5 * (t3 - t2)
    );
}

fn crDeriv(t: f32) -> vec4f {
    let t2 = t * t;
    return vec4f(
        0.5 * (-3.0 * t2 + 4.0 * t - 1.0),
        0.5 * (9.0 * t2 - 10.0 * t),
        0.5 * (-9.0 * t2 + 8.0 * t + 1.0),
        0.5 * (3.0 * t2 - 2.0 * t)
    );
}
```

This is the **uniform Catmull-Rom with tension τ = 0.5** (the standard "centripetal-free" form).
Coefficient matrix, for verification:

```
        [ -1   3  -3   1 ]
0.5  ×  [  2  -5   4  -1 ]     applied to [t³ t² t 1]ᵀ over control points [P₋₁ P₀ P₁ P₂]
        [ -1   0   1   0 ]
        [  0   2   0   0 ]
```

Sanity checks a port must satisfy:
- `crBasis(0) = (0, 1, 0, 0)` → the curve interpolates `P₀` exactly.
- `crBasis(1) = (0, 0, 1, 0)` → interpolates `P₁` exactly.
- `crDeriv(0) = (−0.5, 0, 0.5, 0)` → tangent at `P₀` is `(P₁ − P₋₁)/2`.
- `crDeriv(1) = (0, −0.5, 0, 0.5)` → tangent at `P₁` is `(P₂ − P₀)/2`.
- Each basis row sums to 1; each derivative row sums to 0.

### 7.3 `sampleCloth` — the full reconstruction, verbatim

```wgsl
struct ClothSample {
    pos: vec3f,
    nrm: vec3f,
    tanU: vec3f,
};

fn sampleCloth(
    tex: texture_2d<f32>,
    rowBase: i32, cols: i32, rows: i32,
    u: f32, v: f32
) -> ClothSample {
    let gu = u * f32(cols);
    let gv = v * f32(rows - 1);
    let fu = floor(gu);
    let fv = floor(gv);
    let i0 = i32(fu) - 1;
    let j0 = i32(fv) - 1;

    let wu = crBasis(gu - fu);
    let du = crDeriv(gu - fu);
    let wv = crBasis(gv - fv);
    let dv = crDeriv(gv - fv);

    var p  = vec3f(0.0);
    var pu = vec3f(0.0);
    var pv = vec3f(0.0);

    for (var j = 0; j < 4; j++) {
        var rowP = vec3f(0.0);
        var rowD = vec3f(0.0);
        for (var i = 0; i < 4; i++) {
            let q = clothNode(tex, rowBase, cols, rows, i0 + i, j0 + j);
            rowP += q * wu[i];
            rowD += q * du[i];
        }
        p  += rowP * wv[j];
        pu += rowD * wv[j];
        pv += rowP * dv[j];
    }

    var out: ClothSample;
    out.pos = p;
    // Ordered so the result points away from the body: u runs anticlockwise
    // around the tube and v runs down it.
    out.nrm = normalize(cross(pv, pu));
    out.tanU = normalize(pu);
    return out;
}
```

### 7.4 Parameter mapping — the asymmetry is deliberate

```
gu = u * cols          // NOT cols-1. u wraps, so u=1 must land on node 0 again.
gv = v * (rows - 1)    // v clamps, so v=1 must land exactly on the last node row.
```

| panel | `gu` range | `gv` range |
|---|---|---|
| robe | 0 → 36 | 0 → 11 |
| mantle | 0 → 28 | 0 → 6 |
| sleeves | 0 → 10 | 0 → 7 |

Worked boundary cases (verify these in a port):

- `u = 0`: `gu = 0`, `fu = 0`, `i0 = −1` → taps `i = −1, 0, 1, 2` → wrapped to
  `cols−1, 0, 1, 2`. Weights `(0,1,0,0)` → **p = node[0] exactly**.
- `u = 1`: `gu = cols`, `fu = cols`, `i0 = cols−1` → taps `cols−1, cols, cols+1, cols+2` →
  wrapped to `cols−1, 0, 1, 2`. Weights `(0,1,0,0)` → **p = node[0] exactly**. Identical to
  `u = 0`. Seam is closed by construction.
- `v = 0`: `gv = 0`, `j0 = −1` → taps clamped to `0, 0, 1, 2`. Weights `(0,1,0,0)` →
  **p = node row 0**. `dv(0) = (−0.5,0,0.5,0)` → `pv = 0.5·(row1 − row0)`, non-degenerate.
- `v = 1`: `gv = rows−1`, `j0 = rows−2` → taps `rows−2, rows−1, rows−1, rows−1`. Weights
  `(0,1,0,0)` → **p = node row rows−1**. `pv = 0.5·(row[rows−1] − row[rows−2])`, non-degenerate.

**16 texel fetches per vertex.** At 5038 render vertices that is 80 608 `texelFetch` calls per
beauty pass, plus the same again per shadow cascade and prepass.

### 7.5 The normal — why the missing chain-rule factor is correct

`pu` and `pv` are derivatives with respect to the **local cell parameter**, not with respect to
`u` and `v`. The true partials would be `∂P/∂u = pu·cols` and `∂P/∂v = pv·(rows−1)`. The reference
omits both scale factors.

This is harmless and must be reproduced verbatim: `cross(k₁·pv, k₂·pu) = k₁k₂·cross(pv, pu)` with
both `k` positive, so the *direction* is exactly right and `normalize()` removes the magnitude. A
port that "fixes" this by scaling the derivatives will get an identical result and waste two
multiplies; a port that scales only one of them will get a **wrong normal**.

Cross-product order is `cross(pv, pu)` — note the operands are reversed relative to the usual
`cross(∂/∂u, ∂/∂v)`. With `u` running anticlockwise around the tube and `v` running downward, this
is the outward normal.

**The normal is exactly consistent with the surface being drawn.** There are no finite differences
and no second sampling pass — the tangents fall out of the same 16 taps as the position. Do not
substitute `dFdx/dFdy` screen-space normals here.

### 7.6 Why the grid is 36 columns and not 20

Direct quote from the source, because it is the design rationale for the whole reconstruction:

> Thirty-six columns is set by the fold count, not by smoothness: nine pleats need four samples
> each to survive the grid at all, and the Catmull-Rom reconstruction turns four samples per fold
> into a clean wave. Twenty columns aliased them into a wobble.

---

## 8. Cloth passes

### 8.1 Beauty pass — `cloth.vertex.wgsl`, verbatim

```wgsl
#include<snowCharSkin>

attribute position: vec3f;   // (u, v, panel index)
attribute uv: vec2f;         // weave coordinates
attribute aux: vec2f;        // (material id, baked occlusion)

uniform viewProjection: mat4x4f;
uniform cameraPos: vec3f;
/// Per panel: (first row in the transform texture, cols, rows, unused).
uniform panelParams: array<vec4f, 6>;

var charTex: texture_2d<f32>;
var charTexSampler: sampler;

varying vWorld: vec3f;
varying vNormal: vec3f;
varying vUV: vec2f;
varying vAux: vec2f;
varying vViewDist: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let pp = uniforms.panelParams[i32(vertexInputs.position.z)];
    let s = sampleCloth(
        charTex, i32(pp.x), i32(pp.y), i32(pp.z),
        vertexInputs.position.x, vertexInputs.position.y
    );

    vertexOutputs.vWorld = s.pos;
    vertexOutputs.vNormal = s.nrm;
    vertexOutputs.vUV = vertexInputs.uv;
    vertexOutputs.vAux = vertexInputs.aux;
    vertexOutputs.vViewDist = distance(s.pos, uniforms.cameraPos);
    vertexOutputs.position = uniforms.viewProjection * vec4f(s.pos, 1.0);
}
```

`s.tanU` is computed by `sampleCloth` but **not** used by this shader — the fabric fragment shader
derives anisotropy from screen-space derivatives instead. A port may leave it in (it costs one
`normalize`) or strip it.

**Varying contract** — identical to `char.vertex.wgsl` (the body), so both share one fragment
shader:

| varying | type | contents |
|---|---|---|
| `vWorld` | vec3 | world position, metres |
| `vNormal` | vec3 | reconstructed surface normal, unit, outward |
| `vUV` | vec2 | metres of surface (weave coordinates) |
| `vAux` | vec2 | `(materialId, bakedAO)` |
| `vViewDist` | f32 | `distance(world, cameraPos)` |

The fragment shader is instructed to flip the normal toward the viewer (`if dot(N,V) < 0 → N = -N`),
because `backFaceCulling = false` and every garment is an open sheet.

### 8.2 Shadow pass — `clothDepth.vertex.wgsl`, verbatim

```wgsl
#include<snowCharSkin>
attribute position: vec3f;   // (u, v, panel index)
uniform lightViewProjection: mat4x4f;
uniform panelParams: array<vec4f, 6>;
var charTex: texture_2d<f32>;
var charTexSampler: sampler;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let pp = uniforms.panelParams[i32(vertexInputs.position.z)];
    let s = sampleCloth(charTex, i32(pp.x), i32(pp.y), i32(pp.z),
                        vertexInputs.position.x, vertexInputs.position.y);
    vertexOutputs.position = uniforms.lightViewProjection * vec4f(s.pos, 1.0);
}
```

**Same include, same reconstruction, by construction.** The source note: *"A robe that casts the
shape of its bind pose while drawing the shape of its simulation is worse than no shadow at all."*

The garment casts into **`CHAR_CASCADES = 2`** cascades (the two nearest of three). A distinct
material/effect is compiled per cascade via `defines: ["CHAR_CASCADE " + cascade]`, so each holds
its own `lightViewProjection` with no mid-frame uniform juggling. Fragment shader is
`terrainDepth`.

### 8.3 Depth prepass — `clothPrepass.vertex.wgsl`, verbatim

```wgsl
varying vViewZ: f32;
varying vMask: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let pp = uniforms.panelParams[i32(vertexInputs.position.z)];
    let s = sampleCloth(charTex, i32(pp.x), i32(pp.y), i32(pp.z),
                        vertexInputs.position.x, vertexInputs.position.y);
    let clip = uniforms.viewProjection * vec4f(s.pos, 1.0);
    vertexOutputs.vViewZ = clip.w;
    vertexOutputs.vMask = 0.0;
    vertexOutputs.position = clip;
}
```

`vViewZ = clip.w` is **linear view depth** carried as a varying (not `gl_FragCoord.z`).
`vMask = 0.0` — the garments contribute no specular/SSR mask.

### 8.4 Per-frame uniforms shared by body, cloth and fur

```js
shadowSoftness = 1.4
shadowBias     = 0.012       // tighter than the terrain's; a larger bias detaches
                             // the contact shadow between the boots and the snow
weaveDensity   = 210         // threads per metre (body + cloth only, not fur)
```

---

## 9. Shell fur — geometry (`build.js`)

### 9.1 Shell counts

```js
/** Shells per fur band. Below about 18 the layering is visible as banding. */
const HOOD_SHELLS = 22;
const CUFF_SHELLS = 18;
```

### 9.2 Cross-section constants

```js
/** Cross-section steps across a fur band, and the arc they cover. */
const FUR_ARC_STEPS = 4;
const FUR_ARC = 2.1;   // radians, centred on the outward direction (= 120.32 degrees)
```

`FUR_ARC_STEPS + 1 = 5` vertices per cross-section; `phi ∈ {−1.05, −0.525, 0, +0.525, +1.05} rad`.

### 9.3 Band A — the hood rim

**Head constants:**

```js
const HEAD_C = [0, 1.655, 0.005];
const FACE_DIR = normalize([0, -0.28, 0.96]);   // = (0, -0.28, 0.96) exactly; 0.28²+0.96² = 1
const HOOD_COLS = 34;   // the cowl mesh; the fur band uses its own count
const HOOD_ROWS = 9;
```

**`hoodRimPoint(s)` — reused verbatim by both the cowl and the fur, so they cannot drift apart:**

```js
export function hoodRimPoint(s, out) {
    const a = s * Math.PI * 2;
    const ux = 1, uy = 0, uz = 0;                      // U spans the rim horizontally
    const wx = FACE_DIR[1]*uz - FACE_DIR[2]*uy;        // W = FACE_DIR × U
    const wy = FACE_DIR[2]*ux - FACE_DIR[0]*uz;
    const wz = FACE_DIR[0]*uy - FACE_DIR[1]*ux;
    const cx = HEAD_C[0] + FACE_DIR[0] * 0.105;
    const cy = HEAD_C[1] + FACE_DIR[1] * 0.105;
    const cz = HEAD_C[2] + FACE_DIR[2] * 0.105;
    out[0] = cx + ux * 0.152 * Math.sin(a) + wx * 0.163 * Math.cos(a);
    out[1] = cy + uy * 0.152 * Math.sin(a) + wy * 0.163 * Math.cos(a);
    out[2] = cz + uz * 0.152 * Math.sin(a) + wz * 0.163 * Math.cos(a);
    return out;
}
```

Evaluated: `W = (0, 0.96, 0.28)`, rim centre `C = (0, 1.6256, 0.1058)`, so

```
rim(a) = ( 0.152·sin a,
           1.6256 + 0.15648·cos a,
           0.1058 + 0.045640·cos a )
```

An ellipse with semi-axes 0.152 m (horizontal) and 0.163 m (in the tilted face plane).
Perimeter ≈ **0.990 m** (Ramanujan); as the 26-gon actually built, ≈ **0.985 m**.
`s = 0` is the crown; `s = 0.5` is under the chin. (The README's *"the rim is about a metre round"*
refers to this.)

**Band construction, verbatim:**

```js
const cols = 26;
for (let c = 0; c < cols; c++) {
    hoodRimPoint(c / cols, p);
    bases[c*3 .. +2] = p;
    let dx = p[0]-HEAD_C[0], dy = p[1]-HEAD_C[1], dz = p[2]-HEAD_C[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx = dx/dl + FACE_DIR[0] * 0.45;
    dy = dy/dl + FACE_DIR[1] * 0.45;
    dz = dz/dl + FACE_DIR[2] * 0.45;
    const l2 = Math.hypot(dx, dy, dz) || 1;
    outs[c*3 .. +2] = [dx/l2, dy/l2, dz/l2];
}
emitFurBand(B, cols, bases, outs, 0.024, 0.048, HOOD_SHELLS, B_HOOD, 0.62);
```

Outward direction = **the rim's own bisector**: the unit vector away from the skull centre, plus
`0.45 × FACE_DIR`, renormalised — so the trim tilts forward and frames the face opening.

Band parameters: **core radius `r0 = 0.024 m`, strand length `len = 0.048 m`, 22 shells, bone
`B_HOOD` (5), baked AO `0.62`.** Fur tips therefore sit `0.024 + 0.048 = 0.072 m` off the rim
curve; the strand itself is 4.8 cm long.

### 9.4 Band B and C — the cuffs

```js
for (let a = 0; a < 2; a++) {
    const s = a === 0 ? -1 : 1;
    const bone = a === 0 ? B_FORE_L : B_FORE_R;   // 7 or 10
    const n = 12;
    for (let c = 0; c < n; c++) {
        const ang = (c / n) * Math.PI * 2;
        const rx = Math.sin(ang), rz = Math.cos(ang);
        cb[c*3]     = s * 0.240 + rx * 0.066;
        cb[c*3 + 1] = 0.900;
        cb[c*3 + 2] = 0.012 + rz * 0.064;
        co[c*3] = rx; co[c*3+1] = 0; co[c*3+2] = rz;   // outward is purely radial
    }
    emitFurBand(B, n, cb, co, 0.015, 0.032, CUFF_SHELLS, bone, 0.52);
}
```

Cuff ring: an ellipse of semi-axes 0.066 × 0.064 m centred at `(±0.240, 0.900, 0.012)`, sampled at
12 points. Perimeter ≈ 0.4084 m ideal, ≈ 0.404 m as the 12-gon actually built.
Band parameters: **`r0 = 0.015 m`, `len = 0.032 m`, 18 shells, bone `B_FORE_L/R`, AO `0.52`.**

The cuff sits at y = 0.900, i.e. 3.4 cm **above** the wrist joint (0.866) — deliberately on the
sleeve's tightly-pinned rows 5–6 (`pinRate` 9 and 5), not on the loose row 7, *"where the garment
is pinned hard enough that a bone-bound band cannot visibly separate from it."*

### 9.5 `emitFurBand` — the partial torus, verbatim

```js
function emitFurBand(B, cols, bases, outs, r0, len, shells, bone, ao) {
    const dir = new Float32Array((cols * (FUR_ARC_STEPS + 1)) * 3);

    // Precompute the cross-section directions once: each is the outward vector
    // rotated about the ring's own tangent.
    for (let c = 0; c < cols; c++) {
        const cn = (c + 1) % cols;
        const cp = (c - 1 + cols) % cols;
        let tx = bases[cn*3]   - bases[cp*3];
        let ty = bases[cn*3+1] - bases[cp*3+1];
        let tz = bases[cn*3+2] - bases[cp*3+2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;

        const ox = outs[c*3], oy = outs[c*3+1], oz = outs[c*3+2];
        // Third axis of the cross-section plane.
        const ax = ty*oz - tz*oy;
        const ay = tz*ox - tx*oz;
        const az = tx*oy - ty*ox;

        for (let k = 0; k <= FUR_ARC_STEPS; k++) {
            const phi = (k / FUR_ARC_STEPS - 0.5) * FUR_ARC;
            const cs = Math.cos(phi), sn = Math.sin(phi);
            const o = (c * (FUR_ARC_STEPS + 1) + k) * 3;
            dir[o]     = ox * cs + ax * sn;
            dir[o + 1] = oy * cs + ay * sn;
            dir[o + 2] = oz * cs + az * sn;
        }
    }

    // Arc length around the ring, so the strand field has a uniform pitch in
    // metres regardless of how big the band is.
    const arc = new Float32Array(cols + 1);
    for (let c = 1; c <= cols; c++) {
        const a = ((c - 1) % cols) * 3;
        const b = (c % cols) * 3;
        arc[c] = arc[c-1] + Math.hypot(bases[b]-bases[a],
                                       bases[b+1]-bases[a+1],
                                       bases[b+2]-bases[a+2]);
    }

    const stride = FUR_ARC_STEPS + 1;                 // 5
    for (let s = 0; s < shells; s++) {
        const t = s / (shells - 1);                   // 0 .. 1 inclusive
        const rowBase = B.pos.length / 3;

        for (let c = 0; c <= cols; c++) {             // INCLUSIVE -> seam column duplicated
            const ci = c % cols;
            for (let k = 0; k <= FUR_ARC_STEPS; k++) {
                const o = (ci * stride + k) * 3;
                const dx = dir[o], dy = dir[o+1], dz = dir[o+2];
                const rad = r0 + len * t;
                const across = (k / FUR_ARC_STEPS - 0.5) * FUR_ARC * r0;
                const vi = B.vert(
                    bases[ci*3]     + dx * rad,
                    bases[ci*3 + 1] + dy * rad,
                    bases[ci*3 + 2] + dz * rad,
                    arc[c], across,          // uv, METRES of surface
                    t, ao,                   // aux = (shell parameter, baked occlusion)
                    bone, 1, 0, 0            // boneIdx.x = bone, boneWt.x = 1
                );
                B.normal(vi, dx, dy, dz);    // explicit normal = shell direction
            }
        }

        // Shells are independent sheets: each is stitched only to itself, never
        // to its neighbours. That is the whole idea — the gaps between them are
        // where you see through to the shell behind.
        for (let c = 0; c < cols; c++) {
            for (let k = 0; k < FUR_ARC_STEPS; k++) {
                const a = rowBase + c * stride + k;
                B.quad(a, a + 1, a + stride + 1, a + stride);
            }
        }
    }
}
```

`B.quad(a,b,c,d)` pushes `(a,b,c, a,c,d)`.

### 9.6 The five exact behaviours of `emitFurBand`

1. **The shell offset is baked into the position at build time.** `rad = r0 + len·t` — there is no
   per-shell offset in the vertex shader. The shader only adds droop.
2. **`across` uses `r0`, not `rad`.** The V texture coordinate of a given `(c, k)` is therefore
   **identical on every shell**, as is `arc[c]` for U. This is what makes a strand a coherent
   vertical column through the shell stack rather than a smear. Getting this wrong (using `rad`)
   makes strands splay outward and the whole fur reads as a fuzzy halo with no individual fibres.
3. **`A = cross(t, o)` is NOT renormalised.** If the ring tangent and the outward direction are not
   exactly perpendicular, `|A| < 1` and the cross-section arc is slightly squashed. Reproduce
   verbatim; do not normalise `A`.
4. **The seam column is duplicated** (`c` runs `0..cols` inclusive, `ci = c % cols`). Position and
   normal repeat exactly; only `arc[c]` differs (0 vs full perimeter), which closes the strand field
   without a seam artefact only if the perimeter is not an integer number of cells — a hairline
   strand-field discontinuity at the seam is expected.
5. **Shells are not stitched to each other.** Each shell is a separate open sheet. The gaps between
   them are the whole point.

### 9.7 Fur mesh geometry counts

| band | shells | cols | verts/shell | verts | quads | triangles |
|---|---|---|---|---|---|---|
| hood rim | 22 | 26 | 27 × 5 = 135 | 2970 | 22×26×4 = 2288 | 4576 |
| cuff L | 18 | 12 | 13 × 5 = 65 | 1170 | 18×12×4 = 864 | 1728 |
| cuff R | 18 | 12 | 65 | 1170 | 864 | 1728 |
| **total** | | | | **5310** | **4016** | **8032** |

### 9.8 Fur attribute layout

| attribute | components | contents |
|---|---|---|
| `position` | 3 | bind-pose world position, **shell offset already included** |
| `normal` | 3 | shell direction (`dir`), explicit — `computeNormals` is skipped (`explicitNormals = true`) |
| `uv` | 2 | `(arcAroundRing, acrossBand)` — **both in metres of surface** |
| `aux` | 2 | `(shellParameter t ∈ [0,1], bakedOcclusion)` |
| `boneIdx` | 4 | `(bone, 0, 0, 0)` — only `.x` is read |
| `boneWt` | 4 | `(1, 0, 0, 0)` — only `.x` is meaningful; the fur shader ignores weights entirely |

UV ranges:

| band | U range (m) | V range (m) | cells at 250/m |
|---|---|---|---|
| hood | 0 → ≈0.985 | −0.02520 → +0.02520 (`±FUR_ARC·r0/2`) | ≈246 U × 12.6 V |
| cuff | 0 → ≈0.404 | −0.01575 → +0.01575 | ≈101 U × 7.9 V |

### 9.9 Fur render state

`backFaceCulling = false`, `renderingGroupId = 1`, opaque (the fragment always writes `alpha = 1`
and rejects with `discard`), depth write on, no blending.

**The fur is deliberately excluded from both the shadow cascades and the depth prepass.** Source
note: *"an alpha-tested 22-shell depth pass is not cheap, and what it would contribute is a
slightly fuzzier edge on a shadow already an order of magnitude softer than that."* Reproduce this
exclusion — including it changes the hood's contact shadow.

---

## 10. Shell fur — vertex shader (`fur.vertex.wgsl`)

Verbatim, complete:

```wgsl
// Shell fur.
//
// The shell offset is already baked into the vertex position at build time, so
// all this adds is droop: gravity, wind and the character's own acceleration,
// applied in world space and scaled by the square of the shell parameter. The
// square is what curves a strand instead of shearing it — the tip moves four
// times as far as the midpoint.

#include<snowCharSkin>

attribute position: vec3f;   // bind-pose world position, shell offset included
attribute normal: vec3f;     // shell direction, unit
attribute uv: vec2f;         // strand field coordinates, in metres of surface
attribute aux: vec2f;        // (shell parameter 0..1, baked occlusion)
attribute boneIdx: vec4f;
attribute boneWt: vec4f;

uniform viewProjection: mat4x4f;
uniform cameraPos: vec3f;
/// World-space displacement applied to a strand tip.
uniform furDroop: vec3f;

var charTex: texture_2d<f32>;
var charTexSampler: sampler;

varying vWorld: vec3f;
varying vNormal: vec3f;
varying vUV: vec2f;
varying vAux: vec2f;
varying vViewDist: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let b = i32(vertexInputs.boneIdx.x);
    var world = skinPoint1(charTex, b, vertexInputs.position);
    let n = normalize(skinDir1(charTex, b, vertexInputs.normal));

    let t = vertexInputs.aux.x;
    world += uniforms.furDroop * (t * t);

    vertexOutputs.vWorld = world;
    vertexOutputs.vNormal = n;
    vertexOutputs.vUV = vertexInputs.uv;
    vertexOutputs.vAux = vertexInputs.aux;
    vertexOutputs.vViewDist = distance(world, uniforms.cameraPos);
    vertexOutputs.position = uniforms.viewProjection * vec4f(world, 1.0);
}
```

### 10.1 Single-bone skinning (from `charSkin.wgsl`)

```wgsl
fn skinPoint1(tex: texture_2d<f32>, b: i32, p: vec3f) -> vec3f {
    let c0 = textureLoad(tex, vec2i(b, 0), 0);
    let c1 = textureLoad(tex, vec2i(b, 1), 0);
    let c2 = textureLoad(tex, vec2i(b, 2), 0);
    let c3 = textureLoad(tex, vec2i(b, 3), 0);
    return c0.xyz * p.x + c1.xyz * p.y + c2.xyz * p.z + c3.xyz;
}

fn skinDir1(tex: texture_2d<f32>, b: i32, d: vec3f) -> vec3f {
    let c0 = textureLoad(tex, vec2i(b, 0), 0);
    let c1 = textureLoad(tex, vec2i(b, 1), 0);
    let c2 = textureLoad(tex, vec2i(b, 2), 0);
    return c0.xyz * d.x + c1.xyz * d.y + c2.xyz * d.z;
}
```

Texel `(b, c)` is column `c` — the same layout §5.2 writes. `boneWt` is bound as an attribute but
never read by the fur shader (every fur vertex has weight 1 on one bone).

### 10.2 `furDroop` — computed once per frame on the CPU (`character.js`)

```js
const a  = (S.windDirection * Math.PI) / 180;
const ws = 0.6 * S.windStrength;
_droop.set(
    Math.sin(a) * ws * 0.006 - ch.velocity.x * 0.0016 - ch.acceleration.x * 0.00018,
    -0.018,
    Math.cos(a) * ws * 0.006 - ch.velocity.z * 0.0016 - ch.acceleration.z * 0.00018
);
```

Units: **metres of tip travel** (the displacement applied at `t = 1`).

| term | coefficient | value at defaults | note |
|---|---|---|---|
| wind speed scale | `0.6 × windStrength` | 0.6 | note: **not** the cloth's 3.2 |
| wind → droop | `× 0.006` | 3.6 mm at full strength | horizontal, along the wind bearing |
| velocity → droop | `× −0.0016` per m/s | 30.4 mm at 19 m/s | **opposite** to travel |
| acceleration → droop | `× −0.00018` per m/s² | | thrown the other way |
| gravity | constant `−0.018` on Y | 18 mm down | not scaled by anything |

At a full-speed carve the velocity term (30 mm) exceeds the strand length itself (48 mm hood /
32 mm cuff), so the fur visibly sweeps back by most of its own length.

### 10.3 The `t*t` law

`world += furDroop * (t*t)`. Squared, not linear: at `t = 0.5` the displacement is `0.25 × droop`,
at `t = 1` it is `1.0 × droop`. **The tip moves four times as far as the midpoint** — that is what
curves a strand into an arc instead of shearing the whole band into a parallelogram.

Note the droop is applied **after** skinning, in world space. It is not rotated by the bone.

---

## 11. Shell fur — fragment shader (`fur.fragment.wgsl`)

### 11.1 Uniforms and their live values

| uniform | type | value set by `character.js` | note |
|---|---|---|---|
| `furDensity` | f32 | **250** | strand cells per metre of surface → **4.0 mm pitch** |
| `furColor` | vec3 | **(0.74, 0.755, 0.795)** | slightly blue-shifted white |
| `cameraPos`, `sunDir`, `sunRadiance`, `shR[9]` | | from sky | |
| `cascadeMatrices[3]`, `cascadeSplits`, `cascadeParams[3]` | | from shadow system | |
| `shadowTexel` | f32 | from shadow system | |
| `shadowSoftness` | f32 | **1.4** | |
| `shadowBias` | f32 | **0.012** | |
| `fogDensity`, `fogHeightFalloff`, `fogStart`, `aerialStrength` | f32 | from settings | |
| `ambientIntensity` | f32 | **1.0** default | |

**Documented discrepancy (verified, report it, do not silently pick one):** the WGSL comment reads
`/// Strand cells per metre of surface. 260 is a 3.8 mm pitch.` but `character.js` sets
`m.setFloat("furDensity", 250)` → a **4.0 mm** pitch. **250 is what runs.** Port 250.

Also note `PALETTE[6] = [0.700, 0.720, 0.760, 0.85]` is labelled *"fur (unused by the fabric
shader)"* — the fur material does **not** read the palette; it reads the standalone
`_furCol = Color3(0.74, 0.755, 0.795)`. Do not wire the palette slot to the fur.

### 11.2 The strand field — verbatim

```wgsl
let t = input.vAux.x;

// ---------------------------------------------------------- strand field
let g = input.vUV * uniforms.furDensity;
let cell = floor(g);
let h = hash21(cell);
let jitter = hash22(cell + vec2f(11.3, 5.7)) - 0.5;

// How far up this strand reaches. Cut early and often: a shell stack where
// most strands survive to the top is a solid shell with holes in it.
let strandLen = 0.30 + 0.70 * h;
if (t > strandLen) { discard; }

// Distance to the strand's own axis, in cell units.
let d = length(fract(g) - 0.5 - jitter * 0.55);
// Taper: full width at the root, a point at the tip.
let taper = 1.0 - (t / strandLen);
let radius = 0.46 * (0.55 + 0.45 * hash21(cell + vec2f(3.1, 9.4))) * sqrt(max(taper, 0.0));
if (d > radius) { discard; }
```

**The two hashed quantities per cell:**

| quantity | formula | range | meaning |
|---|---|---|---|
| `strandLen` | `0.30 + 0.70·hash21(cell)` | **[0.30, 1.00]** | how far up the shell stack this strand survives |
| radius scale | `0.55 + 0.45·hash21(cell + (3.1, 9.4))` | **[0.55, 1.00]** | this strand's cross-section relative to the max |
| `jitter` | `hash22(cell + (11.3, 5.7)) − 0.5` | **[−0.5, +0.5]²** | axis offset within the cell |

Derived:

- Axis offset in cell units: `jitter · 0.55` → **±0.275 cells** = ±1.1 mm at 250 cells/m.
- Root radius: `0.46 × [0.55, 1.00] × 1` = **[0.253, 0.460] cells** = **1.01 – 1.84 mm**
  (diameter 2.0 – 3.7 mm) at 250 cells/m.
- Radius falls as `sqrt(taper)` — a **paraboloid** profile, so the strand is fat almost all the
  way up and only sharpens near the tip. Do not substitute a linear taper; the silhouette changes
  from pointed to conical.
- `taper` at `t = strandLen` is exactly 0 → radius 0 → the strand ends in a point, not a cut.
- The `hash21`/`hash22` decorrelation offsets `(11.3, 5.7)` and `(3.1, 9.4)` are non-integer on
  purpose — an integer offset would alias against the `floor(g)` lattice.

**The hash functions (from `noise.wgsl`), verbatim — these must be bit-for-bit portable:**

```wgsl
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

fn ign(pix: vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(pix, vec2f(0.06711056, 0.00583715))));
}
```

Constants: `0.1031`, `0.1030`, `0.0973`, `33.33`, `52.9829189`, `0.06711056`, `0.00583715`.
These are the standard Dave Hoskins hashes. **Precision matters** — see §13.9.

### 11.3 Shading — verbatim

```wgsl
// ------------------------------------------------------------- shading
let world = input.vWorld;
let V = normalize(uniforms.cameraPos - world);
let L = uniforms.sunDir;
var N = normalize(input.vNormal);
if (dot(N, V) < 0.0) { N = -N; }

let noiseRot = ign(input.position.xy) * 6.28318530718;
var shadow = sunShadow(world, N, input.vViewDist, noiseRot);

// Self-occlusion down the stack. Roots see almost no sky, tips see all of
// it — this gradient is what gives shell fur its depth, and without it the
// trim reads as a flat white band.
let depth = t / max(strandLen, 1e-3);
let selfAO = 0.16 + 0.84 * depth * depth;

const INV_PI: f32 = 0.31830988618;
let sun = uniforms.sunRadiance;
let NdotL = dot(N, L);

// Fibres wrap light almost all the way round.
let diff = wrapDiffuse(NdotL, 0.65);
var color = uniforms.furColor * INV_PI * sun * diff * shadow * selfAO;

// Transmission — the term that makes a fur rim light up against a low sun.
let back = backScatter(N, L, V, 0.5, 3.0, 1.0);
color += sun * uniforms.furColor * back * 0.85 * mix(0.4, 1.0, shadow) * selfAO;

// A dim, wide specular. Fur is not glossy, but a completely matte white
// reads as paper.
if (NdotL > 0.0) {
    let H = normalize(V + L);
    let ds = distributionGGX(clamp(dot(N, H), 0.0, 1.0), 0.75);
    color += sun * ds * 0.05 * NdotL * shadow * selfAO;
}

let irradiance = shIrradiance(N, uniforms.shR) * uniforms.ambientIntensity;
color += uniforms.furColor * INV_PI * irradiance * selfAO * input.vAux.y * 1.4;

color = applyAerial(
    color, uniforms.cameraPos, world, -V, L,
    skyLUT, skyLUTSampler, sun,
    uniforms.fogDensity, uniforms.fogHeightFalloff, uniforms.fogStart,
    uniforms.aerialStrength
);

fragmentOutputs.color = vec4f(color, 1.0);
```

### 11.4 The shading model, term by term

**It is deliberately not a surface BRDF.** Source note: *"A strand is a fibre: it scatters forward
strongly, wraps light most of the way round, and its roots are buried in shadow."*

| # | term | formula | constants |
|---|---|---|---|
| 0 | two-sided normal | `if dot(N,V) < 0 → N = -N` | — |
| 1 | shadow rotation | `noiseRot = ign(gl_FragCoord.xy) × 6.28318530718` | 2π |
| 2 | self-occlusion | `selfAO = 0.16 + 0.84·depth²`, `depth = t / max(strandLen, 1e-3)` | 0.16, 0.84, 1e-3 |
| 3 | wrapped diffuse | `wrapDiffuse(NdotL, w) = max(0, (NdotL + w)/(1+w)²)` with **w = 0.65** → denominator **2.7225** | 0.65 |
| 4 | diffuse composite | `furColor · (1/π) · sun · diff · shadow · selfAO` | INV_PI = 0.31830988618 |
| 5 | back-scatter | `H = normalize(L + N·0.5); vh = pow(clamp(dot(V,−H),0,1), 3.0); back = vh·1.0` | distortion **0.5**, power **3.0**, thickness **1.0** |
| 6 | transmission composite | `+ sun · furColor · back · 0.85 · mix(0.4, 1.0, shadow) · selfAO` | 0.85, 0.4, 1.0 |
| 7 | specular gate | `if NdotL > 0` only | — |
| 8 | specular | `ds = GGX(clamp(dot(N,H),0,1), roughness 0.75)`, `+ sun · ds · 0.05 · NdotL · shadow · selfAO` | roughness **0.75** (α = 0.5625, α² = 0.31640625), weight **0.05** |
| 9 | ambient | `+ furColor · (1/π) · shIrradiance(N, shR) · ambientIntensity · selfAO · vAux.y · 1.4` | boost **1.4** |
| 10 | aerial | `applyAerial(...)` with `viewDir = -V` | — |

Supporting functions, verbatim from `shading.wgsl`:

```wgsl
fn wrapDiffuse(NdotL: f32, w: f32) -> f32 {
    let denom = (1.0 + w) * (1.0 + w);
    return max(0.0, (NdotL + w) / denom);
}

fn backScatter(N: vec3f, L: vec3f, V: vec3f, distortion: f32, power: f32, thickness: f32) -> f32 {
    let H = normalize(L + N * distortion);
    let vh = pow(clamp(dot(V, -H), 0.0, 1.0), power);
    return vh * thickness;
}

fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(1e-7, PI * d * d);
}

fn shIrradiance(n: vec3f, sh: array<vec4f, 9>) -> vec3f {
    let c1 = 0.429043; let c2 = 0.511664; let c3 = 0.743125;
    let c4 = 0.886227; let c5 = 0.247708;
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

**The three fibre behaviours the constants encode:**

1. **`w = 0.65` wrap** — light reaches ~33° past the terminator; there is no hard shadow line on a
   fur band.
2. **Transmission at 0.85 weight with `mix(0.4, 1.0, shadow)`** — the back-scatter survives at 40%
   even in full shadow. This is what makes a fur rim light up against a low sun.
3. **`selfAO` quadratic in depth** — roots at **0.16** (16% of full light), tips at **1.00**. The
   ambient term is *additionally* multiplied by the baked `vAux.y` (0.62 hood / 0.52 cuff) and a
   **1.4** boost → effective ambient multiplier 0.868 (hood) / 0.728 (cuff).

---

## 12. Frame order and pass dependencies

```
Character.update(dt):
    1. figure.update(dt, controller)          // poses the skeleton: skin[] and joint[]
    2. if (first frame) _settleCloth()        // pos = skinned bindPos; prev = pos
    3. solver.update(dt, figure, controller)  // the whole Verlet solve (CPU)
    4. _uploadTransforms()                    // one 48 KB RGBA32F write

Character.sync(cameraPos):                    // LATER in the frame, after the camera has moved
                                              // and the shadow cascades have been refitted
    5. _pushUniforms()                        // furDroop, cascades, sun, fog, palette
```

**Why `update` and `sync` are split** (source note, and it is a real visual bug if merged): the
garments must be solved before the snow-contact system reads the feet, but the uniforms cannot be
written until the camera has moved and the cascades have been refitted. Doing both at one point in
the frame leaves one of them a frame stale, and *"a shadow that lags the figure by a frame during
a fast carve"* is the visible symptom.

**Pass order using the cloth data:**

```
charTex upload
  ├─ shadow cascade 0  (clothDepth.vertex, CHAR_CASCADE 0)   -- garments only, not fur
  ├─ shadow cascade 1  (clothDepth.vertex, CHAR_CASCADE 1)
  ├─ depth prepass     (clothPrepass.vertex + prepass.fragment) -- garments only, not fur
  └─ beauty pass, renderingGroupId 1
        ├─ charBody   (char.vertex   + char.fragment)
        ├─ charCloth  (cloth.vertex  + char.fragment)   -- same fragment shader as the body
        └─ charFur    (fur.vertex    + fur.fragment)
```

`CHAR_CASCADES = 2` — the figure casts into the two nearest cascades of three.

Every pipeline is `isReady()`-gated and exercised behind the loading screen (`warmUp()`), so no
shader compiles mid-frame.

Performance envelope from the README, for reference: the **entire** character (skeleton, cloth,
fur, spray) costs **< 0.02 ms GPU** at 2560×1440 on an RTX 5070 Ti.

---

## 13. WebGL2 / Three.js r172 porting notes

### 13.1 There is no compute shader to port

The Verlet solve is 100% CPU JavaScript (`cloth.js`). Nothing about it needs WebGPU. Port it
verbatim as a JS/TS module using `Float32Array`/`Int32Array` and it will produce identical results.
Do **not** be tempted to move it to a ping-ponged fragment pass — the reference's cost is already
negligible and the Gauss-Seidel ordering (§4.7) is not reproducible in a parallel pass.

### 13.2 The transform texture

| WebGPU / Babylon | WebGL2 / Three.js r172 |
|---|---|
| `RawTexture.CreateRGBATexture(data, 48, 64, scene, false, false, NEAREST, TEXTURETYPE_FLOAT)` | `new THREE.DataTexture(data, 48, 64, THREE.RGBAFormat, THREE.FloatType)` |
| `TEXTURE_NEAREST_SAMPLINGMODE` | `tex.minFilter = tex.magFilter = THREE.NearestFilter` |
| `TEXTURE_CLAMP_ADDRESSMODE` | `tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping` |
| `charTex.update(d)` per frame | `tex.needsUpdate = true` per frame (48 KB re-upload) |

- Three.js resolves `RGBAFormat + FloatType` to internal format `RGBA32F`. Sampling a 32-bit float
  texture is **core WebGL2** — no extension is needed. `OES_texture_float_linear` would only be
  needed for LINEAR filtering, and we use NEAREST.
- `EXT_color_buffer_float` is **not** needed here (we never render *into* this texture).
- Set `tex.generateMipmaps = false`, `tex.flipY = false`, `tex.unpackAlignment = 4`.
- **Do not downgrade to RGBA16F.** Node positions are world-space metres over an ~870 m field;
  half-float quantises to ~0.06 m steps at magnitude 100 and the garment will visibly jitter and
  facet.

### 13.3 `textureLoad` → `texelFetch`

```wgsl
textureLoad(tex, vec2i(x, y), 0).xyz
```
becomes
```glsl
texelFetch(charTex, ivec2(x, y), 0).xyz
```

`texelFetch` is available in **both** vertex and fragment stages in GLSL ES 3.00. WebGL2 guarantees
`MAX_VERTEX_TEXTURE_IMAGE_UNITS >= 16`, so the vertex-stage fetches in `sampleCloth` (16 per
vertex) and `skinPoint1`/`skinDir1` (4 and 3) are safe.

In WGSL the texture and sampler are separate objects and `charTexSampler` is declared but never
used by `textureLoad`. In GLSL there is one combined `uniform sampler2D charTex;` — drop the
sampler declaration.

### 13.4 Uniform arrays

| WGSL | GLSL ES 3.00 |
|---|---|
| `uniform panelParams: array<vec4f, 6>` | `uniform vec4 panelParams[6];` |
| `uniform shR: array<vec4f, 9>` | `uniform vec4 shR[9];` |
| `uniform cascadeMatrices: array<mat4x4f, 3>` | `uniform mat4 cascadeMatrices[3];` |
| `uniform cascadeParams: array<vec4f, 3>` | `uniform vec4 cascadeParams[3];` |

Dynamic indexing (`panelParams[i32(position.z)]`) of a uniform array is legal in GLSL ES 3.00 in
both stages. In Three.js, pass these as `{ value: [new THREE.Vector4(...), ...] }` (array of
Vector4 / Matrix4) — Three flattens them for you.

`shIrradiance` takes the array as a parameter in WGSL. GLSL ES 3.00 supports array parameters
(`in vec4 sh[9]`); if your toolchain objects, read the global uniform directly inside the function.

### 13.5 Vector component indexing in loops

`wu[i]`, `du[i]`, `wv[j]`, `dv[j]` index a `vec4` with a **loop variable**. GLSL ES 3.00 allows
dynamic indexing of vectors, but some drivers are slow or buggy about it. Two safe options:

1. Store the basis in a `float w[4]` array instead of a `vec4`.
2. Fully unroll the 4×4 loop (16 explicit `texelFetch` calls). This is the recommended form —
   the loop bound is a compile-time constant 4 and unrolling is free.

### 13.6 Integer modulo semantics

```wgsl
let ii = (i % cols + cols) % cols;
```
WGSL `%` on signed integers truncates toward zero, exactly like GLSL ES 3.00 `%`. The double-modulo
idiom ports **character for character**. Do not replace it with a single `mod()` (which is float in
GLSL and has different sign behaviour).

Likewise `clamp(j, 0, rows - 1)` on integers → GLSL `clamp(j, 0, rows - 1)` with all-`int`
arguments. GLSL ES 3.00 has integer `clamp`. If your compiler complains, use
`min(max(j, 0), rows-1)`.

### 13.7 `fract` semantics

WGSL `fract(x)` and GLSL `fract(x)` are both defined as `x - floor(x)`. They agree for negative
inputs (both return a value in `[0,1)`). `fract(g)` in the strand field and `fract` inside the
Hoskins hashes port unchanged.

### 13.8 Matrix column order

WGSL `mat4x4f` and GLSL `mat4` are both column-major, and `m[c]` gives a **column** in both. This
subsystem never multiplies matrices in a shader — it reads matrix *columns* out of texels — so
nothing changes. What must be preserved is the **CPU-side** layout:

```
skin[bone*16 + column*4 + row]      // column-major
texel (bone, column) = that column
```

If your port's math library is row-major (some are), transpose on write into the data texture, not
in the shader.

### 13.9 Precision

**Declare `precision highp float;` and `precision highp int;` in every fragment shader here.** GLSL
ES 3.00 defaults the fragment stage to `mediump float`, which is fatal for:

- `hash21`/`hash22`: `fract(52.98... * fract(...))` and `p3 += dot(p3, p3.yzx + 33.33)` depend on
  the low bits of a float. At mediump the strand field degenerates into large blotches.
- `ign(gl_FragCoord.xy)`: same.
- `uv * furDensity` at hood scale reaches ~247 — fine at mediump, but `floor()` of it feeding a
  hash is not.

The vertex stage defaults to `highp` in ES 3.00, so `sampleCloth` is safe by default, but declare
it anyway.

### 13.10 `discard` and render state

`discard;` is identical in both languages. The fur material must be configured as an **opaque,
depth-writing, alpha-tested** pass:

```
material.transparent  = false
material.depthWrite   = true
material.depthTest    = true
material.blending     = THREE.NoBlending
material.side         = THREE.DoubleSide      // Babylon backFaceCulling = false
```

Same `side` for the cloth material. Because the fur discards rather than blends, **draw order
between shells does not matter** — a critical simplification: do not sort shells.

### 13.11 `gl_FragCoord`

WGSL `input.position.xy` in a fragment entry point is the framebuffer position builtin →
GLSL `gl_FragCoord.xy`. Same origin convention in practice for this use (a hash input), but note
WebGPU's Y origin is top-left and WebGL's is bottom-left — the *noise rotation* will differ by a
vertical flip. Visually irrelevant (it is a per-pixel dither), but if you want bit-identical
output, use `vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y)`.

### 13.12 Attributes and Three.js reserved names

`position` here is `(u, v, panelIndex)` and is **not a position**. Three.js will still call it
`position` and will still try to compute a bounding sphere from it. Therefore:

```
mesh.frustumCulled = false                    // == alwaysSelectAsActiveMesh + doNotSyncBoundingInfo
mesh.matrixAutoUpdate = false                 // == freezeWorldMatrix
geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
mesh.raycast = () => {}                       // == isPickable = false
```

Custom attribute names `aux`, `boneIdx`, `boneWt` are safe (not reserved). **Do not** name them
`skinIndex`/`skinWeight` — Three would attach its own skinning path.

Use `THREE.RawShaderMaterial` with `glslVersion: THREE.GLSL3` and declare `in`/`out`/`uniform`
yourself, so Three does not inject its own `modelViewMatrix`/`projectionMatrix` chunks. The
reference passes a **single combined `viewProjection` mat4**; compute it on the CPU as
`projectionMatrix * matrixWorldInverse` and upload it, rather than letting Three split it.

### 13.13 The Uint32 index buffer

`new Uint32Array(idx)` → `THREE.BufferGeometry.setIndex(new THREE.BufferAttribute(u32, 1))`.
WebGL2 supports `UNSIGNED_INT` indices in core (no `OES_element_index_uint` needed). Counts here
are small (9504 cloth tris, 8032 fur tris), so `Uint16Array` would also fit — but keep 32-bit to
match.

### 13.14 Multiple render targets / per-cascade effects

Babylon's `defines: ["CHAR_CASCADE " + cascade]` forces a distinct compiled Effect per cascade so
each can hold its own `lightViewProjection`. In Three.js, either clone the material per cascade
(recommended, matches the reference exactly) or set the uniform between draws (works, but breaks
the "no mid-frame uniform juggling" property the reference is buying).

### 13.15 Things WebGL2 simply does not have

| WebGPU / Babylon feature used | WebGL2 status |
|---|---|
| Timestamp queries (perf overlay) | Unavailable in core. `EXT_disjoint_timer_query_webgl2` if present, else CPU-side `performance.now()` around `gl.finish()`. |
| Storage textures | Not used by this subsystem. |
| Compute shaders | Not used by this subsystem. |
| Separate texture/sampler objects | Combined `sampler2D`. Cosmetic. |
| `array<vec4f, N>` in a struct with explicit layout | Use plain uniform arrays; no std140 layout hazards at these sizes. |

### 13.16 Port checklist (order of implementation)

1. `ClothPanel` + the four generators (§2). Render `bindPos` as points; verify the pleat count,
   the front/back hem heights (0.4729 / 0.1271), and the mantle collar radius.
2. `finalise()` rest lengths (§1.5).
3. The 48×64 RGBA32F data texture and row allocation (§5). Verify `nodeRow` = 4 / 16 / 23 / 31.
4. `sampleCloth` in the vertex shader (§7). Verify the four boundary cases in §7.4 by reading back
   a single vertex. **Static test first** — feed the texture the bind positions and check the
   surface matches the point cloud.
5. The solver (§4). Test with gravity only, then wind, then capsules, then ground.
6. `emitFurBand` (§9.5) and the fur vertex shader (§10).
7. The strand field (§11.2) with flat white shading — verify individual strands and pointed tips
   before adding the fibre lighting.
8. Fibre shading (§11.3).

---

## 14. Visual acceptance criteria

A harsh critic should be able to decide from screenshots. Each of these is checkable.

1. **The pleats are geometry, and they vanish at the waist.** Freeze-frame the robe from the side.
   There must be a set of unequal vertical creases — roughly 7 primary crests with finer secondary
   ripple, no two the same width or depth, no repeating pattern around the tube — that are **deep
   at the hem and completely absent at the waistband**. A pleat pattern of uniform depth top to
   bottom means `f = pow(v, 1.25)` was not applied to `fold`. A pleat pattern that *slides across
   the fabric* as the figure turns means it was implemented as a normal map instead of in
   `bindPos`.

2. **The hem is cut high at the front and drags at the back.** The front hem must clear the top of
   the boots (≈ 0.47 m above the foot plane) with the boots plainly visible; the back hem must be
   within ~13 cm of the snow and read as a train. If the boots are hidden all the way round, the
   `0.200·cos(a)` term is missing — and with the boots hidden the entire foot-planting solve is
   invisible, which is the point of the asymmetry.

3. **The hem edge scallops in phase with the pleats and has no spikes.** The bottom edge must dip
   at each fold crest and rise in each valley, tracing a smooth wave — not a clean ellipse, and not
   a row of hard points. A spiky hem means the sign of the `−0.048·sin(7a + 0.6)` term is flipped.

4. **The hem rests on the snow, never through it — and never *in* the player's own trail.** Stand
   the character on a slope: the back of the robe must lie along the surface with a visible ~1 cm
   gap, following the terrain's macro shape. Then carve a trench and stand in it: the hem must
   ride the *undeformed* surface and must **not** sink into the trench. (This is correct behaviour,
   not a bug — `heightAt` reads the baked heightfield, not the deformation buffer.)

5. **No visible faceting anywhere on the garments, at any distance.** The robe silhouette at the
   hem must be a smooth curve. Zoom the camera to a metre: there must be **no** 36-sided polygon
   outline and no Gouraud banding across the folds. Conversely, if you can see a *seam line* where
   the tube closes (a hairline crease in the shading), the u-wrap in `clothNode` is wrong.

6. **The sleeve cuff swings and the shoulder does not.** Swing the arms. The top three sleeve rows
   must show zero separation from the arm; the last row (12.5 cm past the wrist) must visibly lag
   and swing with a ~0.8 s time constant. If the whole sleeve swings, the `RATE` table's
   non-monotonic elbow re-pin (row 3 = 40) is missing and the sleeve will eventually slide off the
   elbow.

7. **Nothing pokes through.** Run, turn hard, and sprint. Legs must never emerge through the robe;
   forearms must never emerge through the sleeve; the mantle must never clip into the upper arms.
   At low frame rates (force 30 fps) this must still hold — that is what the two-substep path
   exists for.

8. **The robe lays out behind a snow-surf run.** Hold right mouse and carve at full speed: the robe
   must stream out **near-horizontal** behind the figure, not merely sway. At a walk it must sway
   gently and, standing still, it must never be completely dead — a slow 0.11 Hz gust plus a faster
   0.37 Hz beat must keep it alive.

9. **The garment's cast shadow has the pleats in it.** Look at the robe's shadow on the snow with
   the sun low. The shadow silhouette must be **scalloped**, matching the simulated fold pattern
   frame-for-frame — not a smooth cone and not lagging the body. If the shadow is a smooth cone,
   the shadow pass is not using the same `sampleCloth` reconstruction.

10. **The fur reads as individual strands, and the tips are pointed.** Zoom to within a metre of
    the hood rim. You must resolve **individual fibres at roughly 4 mm pitch**, of clearly unequal
    length — some ending barely off the band, some reaching the full 4.8 cm — each narrowing to a
    **point**, not a flat cut. A band that reads as a fuzzy sausage means `across` was computed
    from `rad` instead of `r0`; a band with flat-topped strands means the `sqrt(taper)` radius law
    was replaced with a constant or a linear ramp.

11. **You cannot count the shells.** No concentric onion rings, no banding, no visible layer
    boundaries in the fur at any distance. 22 shells at the hood and 18 at the cuff is the floor;
    fewer will band.

12. **Fur roots are dark, fur tips glow.** There must be an unmistakable brightness gradient from
    the base of the band (≈16% of full light) to the strand tips (100%), *within a single band*.
    And with the sun low and behind the figure, the hood rim must **light up as a halo** —
    brighter than the lit side of the same band, unmistakably translucent fibre, not a white
    plastic rim. If the fur reads as a uniformly bright white band the `selfAO` gradient is
    missing; if the halo is absent the `backScatter` term is missing or the `mix(0.4, 1.0, shadow)`
    was replaced with a plain shadow multiply.

13. **The fur droops and sweeps.** At rest the strand tips must hang ~18 mm below where the shell
    geometry alone would put them, and the droop must be a **curve** — the midpoint displaced a
    quarter as far as the tip, never a uniform shear of the whole band. At a full-speed carve the
    hood fur must sweep backward by roughly its own length (~3 cm against a 4.8 cm strand).

14. **The fur casts no separate shadow.** There must be no fuzzy shadow band on the snow beside the
    hood's own shadow. If one appears, the fur was wrongly registered as a shadow caster.

15. **The mantle top edge stays on the chest.** The collar must never separate from the torso or
    flap open at the neck, and the mantle's bottom edge must stop **above the fur cuffs** so both
    the sleeve and its cuff trim remain visible below it. A mantle that reaches the forearms
    swallows the silhouette into one dark mass, which is the failure the 1.045/0.115 hem table is
    tuned against.

---

## 15. Numeric constant index

Every constant in this document, grouped. Count per group in brackets.

**Panel specs [30]** — robe: 36, 12, 72, 32, 1.75, 1.05, 0.55, 0.42, 2, matId 0. mantle: 28, 7, 64,
22, 1.35, 0.72, 0.85, 0.6, matId 1. sleeve: 10, 8, 26, 20, 0.46, 0.66, 0.6, 0.5, matId 0. Collision
bits: 1, 2, 4, 8.

**Robe rest shape [20]** — 1.25 (flare exponent); fold: 0.118, 7, 0.6, 0.055, 12, 2.1, 0.026, 19,
4.4; hem: 0.300, 0.200, 0.048; y0 0.990; radii 0.158, 0.345, 0.128, 0.318, 0.12; z-offset 0.010.

**Robe pin rates [10 distinct]** — Infinity, 30, 10, 4, 1.6, 0.9, 0.55, 0.4, 0.35, 0.3.

**Mantle rest shape [24]** — RAD 0.00/0.176/0.148, 0.20/0.222/0.176, 0.55/0.235/0.196,
1.00/0.246/0.214; YT 1.442, 1.352, 1.220; hem 1.045, 0.115, 0.035, 1.4; pleat 0.062, 7, 1.4, 0.026,
11, 3.0; z-offset 0.012.

**Mantle pin rates [7]** — Infinity, 40, 12, 4, 1.5, 0.8, 0.45.

**Sleeve rest shape [22]** — UP 0.185/1.400/0.000; EL 0.230/1.123/0.000; WR 0.243/0.866/0.016;
ROWS 0.00, 0.084, 0.45, 0.076, 1.00, 0.072, 0.40, 0.068, 0.75, 0.064, 0.061, 0.045, 0.125, 0.098.

**Sleeve pin rates [8]** — Infinity, 50, 26, 40, 18, 9, 5, 1.2.

**Solver timing and wind [12]** — ITERATIONS 6, 1/30, 1/55, 3.2, gust 0.35/0.7/0.18/2.3/1.1,
vertical 0.35/1.9.

**Integrator [15]** — drag 0.085, gravity 9.81, damp base 0.90, damp exponent scale 60, turbulence
1.7, 4.5, 0.9, 1.31, 2.1, 0.7, 0.87, 0.4, 0.9, scale 0.25, epsilon guards 1e-7.

**Constraints [4]** — bending stiffness 0.22, bending activation `ITERATIONS-3` = 3, distance
stiffness 1, halving factor 0.5.

**Capsules [5 distinct radii + 9 rows]** — 0.175, 0.125, 0.098, 0.078, 0.068; guard 1e-6.

**Ground contact [2]** — groundRows 2, clearance 0.012.

**Transform texture [7]** — TEX_W 48, TEX_H 64, CLOTH_ROW0 4, BONE_COUNT 18, panelParams slots 6,
matrix stride 16, node alpha 1.

**Panel row allocation [4]** — nodeRow 4, 16, 23, 31.

**Catmull-Rom [12]** — basis coefficients 0.5, −1, 2, −1, 3, −5, 2, −3, 4, 1, 1, −1 (matrix rows
above); derivative coefficients −3, 4, −1, 9, −10, −9, 8, 1, 3, −2; tap count 4×4 = 16.

**Fur geometry [26]** — HOOD_SHELLS 22, CUFF_SHELLS 18, FUR_ARC_STEPS 4, FUR_ARC 2.1, hood cols 26,
cuff n 12, hood r0 0.024, hood len 0.048, hood ao 0.62, cuff r0 0.015, cuff len 0.032, cuff ao 0.52,
cuff centre 0.240 / 0.900 / 0.012, cuff radii 0.066 / 0.064, hood bisector blend 0.45, rim offset
0.105, rim semi-axes 0.152 / 0.163, HEAD_C 0 / 1.655 / 0.005, FACE_DIR 0.28 / 0.96, HOOD_COLS 34,
HOOD_ROWS 9.

**Fur droop [5]** — wind scale 0.6, wind→droop 0.006, velocity→droop 0.0016, acceleration→droop
0.00018, gravity 0.018.

**Fur strand field [11]** — furDensity 250 (comment says 260), strandLen base 0.30 / range 0.70,
jitter offsets 11.3 / 5.7, jitter scale 0.55, radius scale 0.46, radius base 0.55 / range 0.45,
radius hash offsets 3.1 / 9.4.

**Fur shading [16]** — selfAO 0.16 / 0.84, epsilon 1e-3, INV_PI 0.31830988618, wrap 0.65,
backscatter 0.5 / 3.0 / 1.0, transmission weight 0.85, shadow mix 0.4 / 1.0, GGX roughness 0.75,
specular weight 0.05, ambient boost 1.4, 2π 6.28318530718, GGX guard 1e-7.

**Hash functions [7]** — 0.1031, 0.1030, 0.0973, 33.33, 52.9829189, 0.06711056, 0.00583715.

**SH irradiance [5]** — 0.429043, 0.511664, 0.743125, 0.886227, 0.247708.

**Shared character uniforms [6]** — shadowSoftness 1.4, shadowBias 0.012, weaveDensity 210,
furColor 0.74 / 0.755 / 0.795.

**Baked occlusion ramps [6]** — 0.55 / 0.42 (robe), 0.85 / 0.60 (mantle), 0.60 / 0.50 (sleeves).

**Settings defaults [3]** — windDirection 42, windStrength 1.0, ambientIntensity 1.0.

**Bone indices [18]** — 0 through 17 as named in §2.

**Derived counts recorded [14]** — 432, 196, 80, 788 particles; 2409, 1495, 567, 5038 cloth verts;
9504 cloth tris; 2970, 1170, 5310 fur verts; 8032 fur tris.

### Total: **299 distinct numeric constants captured.**
