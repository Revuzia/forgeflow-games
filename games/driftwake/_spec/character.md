# SNOWFLOW — Procedural Character Subsystem

**Implementation spec for a Three.js r172 / WebGL2 / GLSL 3.00 es port.**

Extracted verbatim from the WebGPU + Babylon.js + WGSL reference at
`snowflow_demo/src/character/*` and `snowflow_demo/src/shaders/{char,cloth,fur}*`.

Every number in this document was read out of the reference this session. Values marked
**(derived)** were computed here from reference values and are labelled as such — everything
else is a literal from the source.

---

## 0. Scope and file map

| Reference file | What it owns |
|---|---|
| `src/character/figure.js` | 18-bone skeleton, bind pose table, locomotion solver, two-bone IK, foot planting, arm/spine/head posing |
| `src/character/build.js` | All procedural geometry: body loft, cowl Bezier shell, shell fur bands, cloth render mesh |
| `src/character/character.js` | Meshes, materials, the transform data texture, per-frame upload, uniform push, palette |
| `src/character/controller.js` | Motion state: walk/surf integrator, facing, lean/carve, **distance-driven gait phase** |
| `src/character/cloth.js` | Verlet garment sim (specified elsewhere) — here only for the panel dimensions that define data-texture rows 4+ |
| `src/character/snowContact.js` | Consumes `figure.touchdown[]`/`figure.plant[]` to stamp footprints |
| `src/shaders/lib/charSkin.wgsl` | Shared vertex-side transform library: LBS from the data texture + Catmull-Rom cloth reconstruction |
| `src/shaders/char.vertex.wgsl` | Body beauty vertex program |
| `src/shaders/cloth.vertex.wgsl` | Garment beauty vertex program |
| `src/shaders/char.fragment.wgsl` | **The fabric material** — shared by body and garments |
| `src/shaders/{charDepth,clothDepth}.vertex.wgsl` | Shadow-cascade vertex programs |
| `src/shaders/{charPrepass,clothPrepass}.vertex.wgsl` | Depth-prepass vertex programs |
| `src/shaders/fur.{vertex,fragment}.wgsl` | Shell fur |

There is **no rig file, no animation clip, no authored mesh, and no texture** in this
subsystem. Everything is a table of numbers plus code.

---

## 1. Conventions, units, coordinate frame

* **Handedness / axes.** Babylon default: left-handed, **+X right, +Y up, +Z forward**. All
  geometry is authored in **bind-pose world space**, in **metres**.
* **Yaw convention.** `facing` is a yaw in radians such that
  `forward = (sin(facing), 0, cos(facing))` and `right = (cos(facing), 0, -sin(facing))`.
  Both are used verbatim throughout `figure.js` and `controller.js`.
* **Bone convention.** A bone's **local +Y runs from its own joint toward its child**. A
  hanging arm therefore has local +Y pointing at the floor. The foot bones are the exception
  and are documented in the bind table (their +Y points forward, toward the toes).
* **Matrix layout.** Flat `Float32Array`, 16 elements per matrix, **column-major**, identical
  to Babylon and to GLSL/WGSL: elements `0..2` = X axis, `4..6` = Y axis, `8..10` = Z axis,
  `12..14` = translation, `3/7/11 = 0`, `15 = 1`. `M * vec4(p,1)` is local→world.
* **Skinning matrix.** `skin[b] = world[b] * invBind[b]`. Geometry is authored in bind-pose
  world space, so `skin` maps a bind-pose world vertex to its posed world position directly —
  there is no model matrix. All three character meshes have a **frozen identity world matrix**
  and a meaningless bounding box (`alwaysSelectAsActiveMesh = true`,
  `doNotSyncBoundingInfo = true`, `freezeWorldMatrix()`, `isPickable = false`).
* **UVs are in metres of surface**, never normalised. This is load-bearing: the weave density
  and the yarn-slub scale are physical sizes, and normalised UVs would give every body part a
  different thread pitch.
* **Timestep clamp.** Both `Figure.update` and `CharacterController.update` begin with
  `h = Math.min(dt, 1/30)`.
* **Allocation.** Zero per frame anywhere in this subsystem. Every buffer is sized at
  construction; all scratch is module-scope typed arrays.

### 1.1 Two helper functions used everywhere

```js
/** Framerate-independent exponential approach. figure.js damp() and camera.js expDamp() are identical. */
function damp(cur, target, rate, dt) { return target + (cur - target) * Math.exp(-rate * dt); }

/** Shortest signed delta from a to b, wrapped to [-PI, PI]. */
function angleDelta(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI*2; while (d < -Math.PI) d += Math.PI*2; return d; }

/** Framerate-independent easing across the shortest arc. */
function angleDamp(cur, target, rate, dt) { return cur + angleDelta(cur, target) * (1 - Math.exp(-rate * dt)); }
```

`clamp(v, lo, hi)` is the ordinary three-argument clamp.

---

## 2. The 18-bone skeleton

### 2.1 Bone indices (exported constants)

| Const | Value | Const | Value | Const | Value |
|---|---|---|---|---|---|
| `B_ROOT` | 0 | `B_UPPER_L` | 6 | `B_THIGH_L` | 12 |
| `B_SPINE` | 1 | `B_FORE_L` | 7 | `B_SHIN_L` | 13 |
| `B_CHEST` | 2 | `B_HAND_L` | 8 | `B_FOOT_L` | 14 |
| `B_NECK` | 3 | `B_UPPER_R` | 9 | `B_THIGH_R` | 15 |
| `B_HEAD` | 4 | `B_FORE_R` | 10 | `B_SHIN_R` | 16 |
| `B_HOOD` | 5 | `B_HAND_R` | 11 | `B_FOOT_R` | 17 |

`BONE_COUNT = 18`.

### 2.2 The bind-pose TABLE — verbatim

`BIND` is a `Float32Array` of **18 × 9 = 162 floats**. Nine floats per bone, in this order:

```
[ jointX, jointY, jointZ,   dirX, dirY, dirZ,   refX, refY, refZ ]
     joint position           bone direction        front reference
   (bind-pose world, m)      (becomes local +Y)   (re-orthogonalised)
```

**There is no parent index and no parent-relative offset in this table.** Every joint is an
absolute world position. The hierarchy exists only implicitly, in the order and the arithmetic
of `Figure.update()`. This matters for the port: do **not** build a `THREE.Skeleton` /
`Bone.add(child)` graph — build 18 independent world matrices per frame.

| # | Bone | jointX | jointY | jointZ | dirX | dirY | dirZ | refX | refY | refZ |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | ROOT | 0 | 0.95 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 1 | SPINE | 0 | 1.06 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 2 | CHEST | 0 | 1.26 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 3 | NECK | 0 | 1.46 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 4 | HEAD | 0 | 1.55 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 5 | HOOD | 0 | 1.55 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 6 | UPPER_L | −0.185 | 1.400 | 0.000 | −0.16 | −0.987 | 0 | 0 | 0 | 1 |
| 7 | FORE_L | −0.230 | 1.123 | 0.000 | −0.05 | −0.997 | 0.06 | 0 | 0 | 1 |
| 8 | HAND_L | −0.243 | 0.866 | 0.016 | −0.02 | −0.992 | 0.12 | 0 | 0 | 1 |
| 9 | UPPER_R | 0.185 | 1.400 | 0.000 | 0.16 | −0.987 | 0 | 0 | 0 | 1 |
| 10 | FORE_R | 0.230 | 1.123 | 0.000 | 0.05 | −0.997 | 0.06 | 0 | 0 | 1 |
| 11 | HAND_R | 0.243 | 0.866 | 0.016 | 0.02 | −0.992 | 0.12 | 0 | 0 | 1 |
| 12 | THIGH_L | −0.100 | 0.900 | 0 | 0 | −1 | 0 | 0 | 0 | 1 |
| 13 | SHIN_L | −0.100 | 0.460 | 0 | 0 | −1 | 0 | 0 | 0 | 1 |
| 14 | FOOT_L | −0.100 | 0.090 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |
| 15 | THIGH_R | 0.100 | 0.900 | 0 | 0 | −1 | 0 | 0 | 0 | 1 |
| 16 | SHIN_R | 0.100 | 0.460 | 0 | 0 | −1 | 0 | 0 | 0 | 1 |
| 17 | FOOT_R | 0.100 | 0.090 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |

Notes on the table:

* HOOD is **co-located with HEAD** (identical 9 floats). It is a separate bone purely so it can
  carry its own lagged rotation.
* The foot bones use `dir = (0,0,1)` (local +Y points at the toes) and `ref = (0,1,0)` (world up
  as the front reference), unlike every other bone.
* Direction vectors are *approximately* unit (`(−0.16,−0.987,0)` has length 0.99988);
  `setFrameFromDir` normalises, so exact unit length is not required.
* The figure is **1.79 m tall with the pelvis at 0.95 m** — deliberately long in the leg and
  narrow in the shoulder, because the silhouette is read at ~15 m through a robe.

### 2.3 Declared segment lengths

```js
const THIGH_LEN = 0.44;   // metres  (0.900 → 0.460)
const SHIN_LEN  = 0.37;   //         (0.460 → 0.090)
const UPPER_LEN = 0.28;   //         |UPPER→FORE| = 0.2806 (derived)
const FORE_LEN  = 0.26;   //         |FORE→HAND|  = 0.2578 (derived)
const HIP_HEIGHT = 0.95;  // pelvis height above the feet in the bind pose
```

Total leg reach `THIGH_LEN + SHIN_LEN = 0.81 m`; total arm reach `UPPER_LEN + FORE_LEN = 0.54 m`
**(derived)**. Both are used by the IK reach clamp. The arm targets in `_poseArms` are all kept
"comfortably inside the arm's 0.54 m reach" — putting a target at full extension locks the elbow
and the figure walks around with two straight poles for arms.

### 2.4 Implicit hierarchy — (derived) from the poser

This table is not in the source; it is the parent/offset structure the poser actually produces,
reconstructed here because it is what a port needs. Verified against the bind table: at rest
(pitch = roll = 0, feet on flat ground) the poser reproduces the bind positions exactly.

| Bone | Implicit parent | How its origin is produced each frame | Bind offset check |
|---|---|---|---|
| ROOT | — | `(pos.x, groundY − sink + hipY + bob, pos.z)` | pelvis at 0.95 |
| SPINE | ROOT | `root + up * 0.11` | 1.06 − 0.95 = 0.11 ✓ |
| CHEST | **ROOT** (not SPINE) | `root + up * 0.31` | 1.26 − 0.95 = 0.31 ✓ |
| NECK | CHEST | `chest + chestUp * 0.20` | 1.46 − 1.26 = 0.20 ✓ |
| HEAD | NECK | `neck + chestUp * 0.09` | 1.55 − 1.46 = 0.09 ✓ |
| HOOD | HEAD | same position as HEAD, own damped basis | identical row ✓ |
| UPPER_L/R | CHEST | `chest + chestRight*(±0.185) + chestUp*0.14` | 1.26 + 0.14 = 1.40 ✓, x = ±0.185 ✓ |
| FORE_L/R | UPPER | elbow from two-bone IK | bind (±0.230, 1.123, 0) |
| HAND_L/R | FORE | the IK end target | bind (±0.243, 0.866, 0.016) |
| THIGH_L/R | ROOT | `root + right*(±0.10) − up*0.05` | 0.95 − 0.05 = 0.90 ✓, x = ±0.10 ✓ |
| SHIN_L/R | THIGH | knee from two-bone IK | bind (±0.100, 0.460, 0) |
| FOOT_L/R | SHIN | `footPos + (0, 0.09, 0)` (ankle above sole) | bind y = 0.090 ✓ |

### 2.5 Frame construction — `setFrameFromDir`

Every bone matrix in the rig (bind **and** posed) is built by the same function, which is why
`world * invBind` is exactly the identity at rest.

```js
setFrameFromDir(out, o, px,py,pz, dx,dy,dz, rx,ry,rz):
    Y = normalize(d)                       // bone axis becomes local +Y
    X = Y × ref                            // re-orthogonalised here
    if (|X| < 1e-5) X = Y × (1,0,0)        // fallback when ref is parallel to the bone
    X = normalize(X)
    Z = X × Y                              // completes the basis (left-handed)
    write columns:  [X | Y | Z | (px,py,pz)]   with w-row (0,0,0,1)
```

```js
invertRigid: transpose the 3×3, translation = −(Rᵀ · t)   // rigid only; nothing in the rig scales
mul(out, a, b): out = a * b                                // column-major, standard
```

Construction order at load: for each bone, `setFrameFromDir(bind)` then `invertRigid(invBind)`.
Per frame, after all 18 world matrices are written:

```js
for (b = 0..17) {
    skin[b] = world[b] * invBind[b];
    joint[b*3 .. +2] = world[b][12..14];    // world joint position; cloth collision reads this
}
```

### 2.6 `composeBasis(yaw, pitch, roll)` — the body attitude basis

Writes X, Y, Z into a module-scope 9-float scratch `_axes` (`_axes[0..2]=X`, `[3..5]=Y`,
`[6..8]=Z`). Yaw first, then **pitch about the basis's own right axis**, then **roll about its
own forward axis**. Positive pitch leans forward; positive roll tips the head to the character's
right (the sign `controller.lean` already uses).

```js
cy = cos(yaw), sy = sin(yaw)
X = ( cy, 0, -sy );  Y = ( 0, 1, 0 );  Z = ( sy, 0, cy )

if (pitch != 0):  c = cos(pitch), s = sin(pitch)
    Y' = Y*c + Z*s
    Z' = Z*c − Y*s

if (roll != 0):   c = cos(roll), s = sin(roll)
    X' = X*c − Y*s
    Y' = Y*c + X*s
```

---

## 3. Geometry lofting at load

All of `build.js` runs **once, at load**, allocates freely, and never runs again. Output: three
meshes, because three different vertex programs drive them.

| Mesh | Name | Attributes | Driven by |
|---|---|---|---|
| body | `charBody` | `position, normal, uv, aux(2), boneIdx(4), boneWt(4)` | linear blend skinning, 2 influences |
| cloth | `charCloth` | `position(=u,v,panelIdx), uv, aux(2)` | Catmull-Rom over simulated nodes |
| fur | `charFur` | `position, normal, uv, aux(2), boneIdx(4), boneWt(4)` | one bone, plus a droop offset |

### 3.1 Material slots

```js
export const M_ROBE    = 0;  // deep indigo wool
export const M_MANTLE  = 1;  // lighter blue-grey over-mantle
export const M_TUNIC   = 2;  // pale cream under-layer
export const M_LEATHER = 3;  // belt and boots
export const M_SKIN    = 4;  // face, deep in shade
export const M_TRIM    = 5;  // pale blue banding
export const M_FUR     = 6;  // hood and cuff trim
```

Slot id travels to the fragment shader in `aux.x`; baked occlusion in `aux.y`.

### 3.2 The Builder

```js
vert(x,y,z, u,v, matId, ao, b0,w0, b1,w1) -> vertexIndex
    pos.push(x,y,z);  nrm.push(0,0,0);  uv.push(u,v);
    aux.push(matId, ao);
    bi.push(b0, b1||0, 0, 0);          // 4 bone indices, only 2 ever used
    bw.push(w0, w1||0, 0, 0);          // 4 weights,      only 2 ever used
quad(a,b,c,d) -> tri(a,b,c), tri(a,c,d)   // both diagonals used across the mesh; no alternation
```

**Normals are never derived analytically.** Everything is built as positions + indices and then
run through one **area-weighted smooth-normal pass** (`computeNormals`): accumulate the
*un-normalised* cross product of each triangle's two edge vectors into all three of its vertices
(its length is twice the triangle area, which is exactly the desired weight), then normalise
each vertex once at the end (`length || 1`). Closed rings **share their seam vertex** rather than
duplicating it, so the seam is smooth too. Only the fur supplies explicit normals
(`B.explicitNormals = true`).

### 3.3 `SEG = 14` — segments around every limb

One constant governs every lofted tube. "14 is smooth at the distances this is seen from."

### 3.4 `loft(B, rings, matId, ref, capStart, capEnd)`

Ring format: `[cx, cy, cz, rx, rz, ao, b0, w0, b1, w1]`.

```
for each ring r in 0..n-1:
    prev = rings[max(0, r-1)];  next = rings[min(n-1, r+1)]
    axis  = normalize(next.centre − prev.centre)        // central difference: a bend in the
                                                        // bind pose still gets circular sections
    U = normalize(axis × ref)                           // first section axis
    W = axis × U                                        // second section axis (already unit)

    if r > 0: vAcc += |cur.centre − prev.centre|         // V is metres travelled along the loft
    circ = PI * (rx + rz)                                // U spans this many metres around

    for s in 0..SEG-1:
        a = (s / SEG) * 2*PI
        p = centre + U * rx * sin(a) + W * rz * cos(a)
        uv = ( (s/SEG) * circ ,  vAcc )                  // METRES, both axes
        emit vert(p, uv, matId, ring.ao, ring.b0, ring.w0, ring.b1, ring.w1)

    stitch previous row to this row:
        for s in 0..SEG-1:  quad(prev[s], prev[(s+1)%SEG], row[(s+1)%SEG], row[s])
```

`capRing(ring, neighbour, row, matId, isStart)`: fan to a single centre vertex placed on the
ring's own axis at `ext = max(rx, rz) * 0.7` beyond the ring, uv `(0.5, 0.5)`, same ao/bones as
the ring. Winding is reversed between the start cap (`tri(c, row[s2], row[s])`) and the end cap
(`tri(c, row[s], row[s2])`).

### 3.5 `spineBones(y)` — bone blend along the spine, by bind-pose height

```js
if (y < 1.06)  { t = clamp((y - 0.88) / 0.18, 0, 1);  return [B_ROOT,  1 - t*0.5,  B_SPINE, t*0.5 ]; }
if (y < 1.26)  { t = (y - 1.06) / 0.20;               return [B_SPINE, 1 - t,      B_CHEST, t     ]; }
                 t = min(1, (y - 1.26) / 0.20);       return [B_CHEST, 1 - t*0.35, B_NECK,  t*0.35];
```

### 3.6 `limbRings(x0,y0,z0, x1,y1,z1, r0,r1, steps, boneA, boneB, ao, from, to)`

`steps + 1` rings interpolated linearly in position and radius (`rx = rz = r`), with the bone
weight ramping `boneA → boneB` across the normalised sub-range `[from, to]`:

```js
for i in 0..steps:
    t = i / steps
    w = clamp((t - from) / (to - from), 0, 1)
    ring(lerp(p0,p1,t), r = r0 + (r1-r0)*t, ao, [boneA, 1-w, boneB, w])
```

### 3.7 Body part tables — verbatim

#### Torso — `loft(torso, M_TRIM, ref=(0,0,1), capStart=true, capEnd=false)`

8 rings, `ao = 0.72` on every ring, bones from `spineBones(y)`, centre `(0, y, 0)`:

| # | y | rx | rz |
|---|---|---|---|
| 0 | 0.88 | 0.150 | 0.120 |
| 1 | 0.98 | 0.142 | 0.113 |
| 2 | 1.06 | 0.134 | 0.106 |
| 3 | 1.14 | 0.140 | 0.109 |
| 4 | 1.22 | 0.156 | 0.118 |
| 5 | 1.30 | 0.172 | 0.126 |
| 6 | 1.38 | 0.176 | 0.126 |
| 7 | 1.44 | 0.160 | 0.116 |

#### Belt — `loft(belt, M_LEATHER, (0,0,1), false, false)`

| # | y | rx | rz | ao | bones |
|---|---|---|---|---|---|
| 0 | 0.955 | 0.153 | 0.124 | 0.62 | `spineBones(0.955)` |
| 1 | 0.995 | 0.160 | 0.130 | 0.70 | `spineBones(0.995)` |
| 2 | 1.035 | 0.152 | 0.123 | 0.62 | `spineBones(1.035)` |

#### Neck — `loft(neck, M_SKIN, (0,0,1), false, false)`

| # | y | z | rx | rz | ao | bones |
|---|---|---|---|---|---|---|
| 0 | 1.42 | −0.005 | 0.062 | 0.058 | 0.35 | `[NECK 1, HEAD 0]` |
| 1 | 1.50 | 0.000 | 0.058 | 0.055 | 0.30 | `[NECK 0.5, HEAD 0.5]` |
| 2 | 1.56 | 0.002 | 0.062 | 0.060 | 0.28 | `[HEAD 1]` |

#### Skull — `loft(head, M_SKIN, (0,0,1), capStart=true, capEnd=true)`

Deliberately featureless (the face stays in shadow under the cowl). 9 rings, `i = 0..8`:

```js
HEAD_C = [0, 1.655, 0.005];
a = (i / 8) * PI;
y  = HEAD_C[1] − cos(a) * 0.105;
r  = sin(a);
ring(cx = 0, cy = y, cz = HEAD_C[2] + r * 0.006,
     rx = 0.089 * r + 0.004,
     rz = 0.096 * r + 0.004,
     ao = 0.22, bones = [B_HEAD, 1, 0, 0]);
```

The heavy baked occlusion (0.22) makes the cavity read dark even when the sun swings round to
face it.

#### Scarf — `loft(scarf, M_TRIM, (0,0,1), false, false)`

Across the lower face. "It is what stops the shadowed skull reading as an empty hood."

| # | y | z | rx | rz | ao | bones |
|---|---|---|---|---|---|---|
| 0 | 1.560 | 0.010 | 0.086 | 0.092 | 0.30 | `[HEAD 1]` |
| 1 | 1.600 | 0.012 | 0.094 | 0.100 | 0.34 | `[HEAD 1]` |
| 2 | 1.638 | 0.008 | 0.092 | 0.098 | 0.30 | `[HEAD 1]` |

#### Arms — per side, `s = −1` (left) / `+1` (right)

```js
upper = limbRings(s*0.185, 1.400, 0,   s*0.230, 1.123, 0,
                  r0=0.064, r1=0.050, steps=4, boneA=UPPER, boneB=FORE, ao=0.55, from=0.72, to=1.0);
loft(upper, M_ROBE, (0,0,1), capStart=true, capEnd=false);

fore  = limbRings(s*0.230, 1.123, 0,   s*0.243, 0.866, 0.016,
                  r0=0.050, r1=0.042, steps=4, boneA=FORE, boneB=HAND, ao=0.62, from=0.75, to=1.0);
loft(fore, M_ROBE, (0,0,1), false, false);
```

Hand — a **mitt**, no fingers ("fingers at this distance are three pixels of noise"),
`loft(hand, M_LEATHER, (0,0,1), capStart=false, capEnd=true)`, all `[HAND, 1]`:

| # | x | y | z | rx | rz | ao |
|---|---|---|---|---|---|---|
| 0 | s·0.243 | 0.866 | 0.016 | 0.044 | 0.038 | 0.55 |
| 1 | s·0.245 | 0.820 | 0.024 | 0.050 | 0.040 | 0.55 |
| 2 | s·0.247 | 0.780 | 0.032 | 0.046 | 0.036 | 0.52 |
| 3 | s·0.248 | 0.752 | 0.038 | 0.030 | 0.026 | 0.50 |

#### Legs and boots — per side, `s = ∓1`

```js
thigh = limbRings(s*0.100, 0.905, 0,   s*0.100, 0.460, 0,
                  r0=0.114, r1=0.086, steps=5, boneA=THIGH, boneB=SHIN, ao=0.5, from=0.74, to=1.0);
loft(thigh, M_ROBE, (0,0,1), capStart=true, capEnd=false);
```

Trousers (`loft(shin, M_ROBE, (0,0,1), false, false)`) — narrow to the ankle then flare into the
boot shaft; x is `s·0.100` on every ring:

| # | y | z | rx | rz | ao | bones |
|---|---|---|---|---|---|---|
| 0 | 0.460 | 0 | 0.086 | 0.086 | 0.55 | `[SHIN 1]` |
| 1 | 0.360 | 0.004 | 0.076 | 0.076 | 0.55 | `[SHIN 1]` |
| 2 | 0.270 | 0.006 | 0.070 | 0.070 | 0.52 | `[SHIN 1]` |
| 3 | 0.200 | 0.006 | 0.075 | 0.076 | 0.48 | `[SHIN 0.6, FOOT 0.4]` |
| 4 | 0.140 | 0.004 | 0.080 | 0.082 | 0.44 | `[SHIN 0.25, FOOT 0.75]` |
| 5 | 0.100 | 0.000 | 0.074 | 0.078 | 0.42 | `[FOOT 1]` |

Boot — **`ref = (0,1,0)`, not `(0,0,1)`** (the only loft in the file that changes it), so the
tube runs along the foot's own forward axis and swings with the ankle roll. All `[FOOT, 1]`,
x = `s·0.100`, `loft(boot, M_LEATHER, (0,1,0), capStart=true, capEnd=true)`:

| # | y | z | rx | rz | ao |
|---|---|---|---|---|---|
| 0 | 0.055 | −0.088 | 0.046 | 0.052 | 0.35 |
| 1 | 0.058 | −0.050 | 0.056 | 0.066 | 0.38 |
| 2 | 0.054 | 0.010 | 0.058 | 0.060 | 0.42 |
| 3 | 0.048 | 0.078 | 0.056 | 0.050 | 0.45 |
| 4 | 0.043 | 0.142 | 0.050 | 0.043 | 0.48 |
| 5 | 0.040 | 0.190 | 0.033 | 0.031 | 0.48 |

Boot footprint **(derived)**: 0.278 m from heel ring to toe ring, ~0.116 m wide at the widest.

### 3.8 The cowl — swept quadratic Bezier shell

```js
const HOOD_COLS = 34;
const HOOD_ROWS = 9;                       // 10 rows of vertices, r = 0..9
const HEAD_C    = [0, 1.655, 0.005];
const FACE_DIR  = normalize([0, -0.28, 0.96]);   // exactly unit already (0.28² + 0.96² = 1)
```

**Rim curve** (also reused verbatim by the fur trim, so the two can never drift apart).
`s = 0` is the crown, `s = 0.5` is under the chin:

```js
hoodRimPoint(s):
    a = s * 2*PI
    U = (1, 0, 0)
    W = FACE_DIR × U          = (0, 0.96, 0.28)          // derived, unit
    C = HEAD_C + FACE_DIR * 0.105                        // = (0, 1.6256, 0.1058) derived
    return C + U * 0.152 * sin(a) + W * 0.163 * cos(a)
```

**Base curve** — where the hood meets the shoulders:

```js
hoodBasePoint(s):
    a = s * 2*PI
    return ( 0.212 * sin(a),  1.352,  -0.012 - 0.182 * cos(a) )
```

**Control point** — *stated, not derived from the chord*. The chord at the crown runs straight
through the skull, so its midpoint is inside the head and "away from the head centre" points down
into the shoulders. The control direction sweeps from up-and-back over the crown, through
sideways at the temples, to down-and-forward under the chin — the same sweep the rim parameter
already makes, so it comes straight off `s`:

```js
a = s * 2*PI;  sa = sin(a);  ca = cos(a)
n   = normalize( sa * 1.0,  ca * 0.84,  ca * -0.54 )
rad = 0.205 + 0.062 * ca                   // widest over the crown, tightest at the throat
M   = HEAD_C + n * rad
```

**Surface**, per `(c, r)` with `s = c / HOOD_COLS`, `t = r / HOOD_ROWS`:

```glsl
it = 1 - t;
P  = it*it * rim  +  2*it*t * M  +  t*t * base;        // quadratic Bezier
ao = 0.34 + 0.55 * min(1, t * 2.2);                    // inside of a cowl sees almost no sky
uv = ( s * 1.02, t * 0.45 );                           // metres: rim ~1 m round, sweep ~45 cm
emit vert(P, uv, M_ROBE, ao, B_HOOD, 1);
```

Stitched with the same closed-ring `quad()` as the lofts (`c2 = (c+1) % HOOD_COLS`), so column 0
is shared, not duplicated.

### 3.9 Shell fur

```js
const HOOD_SHELLS   = 22;    // below ~18 the layering is visible as banding
const CUFF_SHELLS   = 18;
const FUR_ARC_STEPS = 4;     // cross-section steps across a band
const FUR_ARC       = 2.1;   // radians of arc, centred on the outward direction
```

A trim band is a **partial torus** around the edge it decorates, emitted once per shell with each
copy pushed further along its own direction. The fragment shader alpha-tests a hashed strand
field whose threshold rises with the shell parameter, so strands taper and end at different
lengths. Fur is bone-bound (hood rim → `B_HOOD`, cuffs → `B_FORE_L/R`), never cloth-bound.

**Hood rim band** — `cols = 26`:

```js
for c in 0..25:
    base[c] = hoodRimPoint(c / 26)
    d = normalize(base[c] − HEAD_C)
    out[c] = normalize( d + FACE_DIR * 0.45 )       // away from the skull, tilted along the face
emitFurBand(cols=26, base, out, r0=0.024, len=0.048, shells=22, bone=B_HOOD, ao=0.62)
```

**Cuff bands** — one per arm, `n = 12`, ring in the XZ plane about the near-vertical forearm:

```js
for c in 0..11:
    ang = (c / 12) * 2*PI;  rx = sin(ang);  rz = cos(ang)
    base[c] = ( s*0.240 + rx*0.066,  0.900,  0.012 + rz*0.064 )
    out[c]  = ( rx, 0, rz )
emitFurBand(cols=12, base, out, r0=0.015, len=0.032, shells=18, bone=B_FORE_L|R, ao=0.52)
```

**`emitFurBand`:**

```js
// 1. cross-section directions, precomputed once per ring position
for c in 0..cols-1:
    T = normalize(base[(c+1)%cols] − base[(c-1+cols)%cols])     // ring tangent
    O = out[c]
    A = T × O                                                    // third axis of the section plane
    for k in 0..FUR_ARC_STEPS:
        phi = (k/FUR_ARC_STEPS - 0.5) * FUR_ARC
        dir[c][k] = O*cos(phi) + A*sin(phi)

// 2. cumulative arc length around the ring, metres — so the strand field has a uniform
//    pitch regardless of band size. arc[0] = 0, arc[cols] = full circumference.
arc[c] = arc[c-1] + |base[c % cols] − base[(c-1) % cols]|

// 3. shells
for s in 0..shells-1:
    t = s / (shells - 1)
    for c in 0..cols:                       // INCLUSIVE — the seam column is duplicated so the
        ci = c % cols                        // strand field does not wrap-seam
        for k in 0..FUR_ARC_STEPS:
            rad    = r0 + len * t
            across = (k/FUR_ARC_STEPS - 0.5) * FUR_ARC * r0      // v in metres of core arc
            v = vert( base[ci] + dir[ci][k] * rad,
                      uv  = ( arc[c], across ),
                      aux = ( t, ao ),                            // (shellT, ao) on the fur
                      bone, weight 1 )
            normal(v) = dir[ci][k]                                // explicit, not smoothed
    // stitch each shell ONLY to itself — never to its neighbours. The gaps between shells are
    // where you see through to the shell behind; that is the whole idea.
    quad(a, a+1, a+stride+1, a+stride)  with stride = FUR_ARC_STEPS + 1
```

### 3.10 Cloth render mesh

Carries **no positions of its own**: `position = (u, v, panelIndex)`.

```js
for each panel pi:
    for j in 0..renderRows:  v = j / renderRows
        for i in 0..renderCols:  u = i / renderCols
            pos.push(u, v, pi)
            uv.push (u * weaveU, v * weaveV)                      // metres
            aux.push(matId,  aoTop + (aoBottom - aoTop) * v)      // garments darken toward the hem
    stride = renderCols + 1
    idx.push(a, b, d,  a, d, c)   with a = base + j*stride + i, b = a+1, c = a+stride, d = c+1
```

### 3.11 Cloth panel table (dimensions only — the solver is specified elsewhere)

| Panel | `cols` × `rows` (sim) | `renderCols` × `renderRows` | `matId` | `weaveU` | `weaveV` | `aoTop` | `aoBottom` | bone | `groundRows` |
|---|---|---|---|---|---|---|---|---|---|
| robe | 36 × 12 | 72 × 32 | `M_ROBE` | 1.75 | 1.05 | 0.55 | 0.42 | `B_ROOT` | 2 |
| mantle | 28 × 7 | 64 × 22 | `M_MANTLE` | 1.35 | 0.72 | 0.85 | 0.6 | `B_CHEST` | 0 |
| sleeve0 (L) | 10 × 8 | 26 × 20 | `M_ROBE` | 0.46 | 0.66 | 0.6 | 0.5 | per-row | 0 |
| sleeve1 (R) | 10 × 8 | 26 × 20 | `M_ROBE` | 0.46 | 0.66 | 0.6 | 0.5 | per-row | 0 |

Panel order in the array is fixed: `[robe, mantle, sleeve0, sleeve1]`. Sim node counts
**(derived)**: 432 + 196 + 80 + 80 = **788 nodes**.

### 3.12 Geometry budget — (derived)

| Part | Vertices | Triangles |
|---|---|---|
| torso | 113 | 210 |
| belt | 42 | 56 |
| neck | 42 | 56 |
| skull | 128 | 252 |
| scarf | 42 | 56 |
| cowl | 340 | 612 |
| arms (×2) | 396 | 672 |
| legs + boots (×2) | 510 | 924 |
| **body total** | **1 613** | **2 838** |
| fur — hood rim (22 shells) | 2 970 | 4 576 |
| fur — cuffs (2 × 18 shells) | 2 340 | 3 456 |
| **fur total** | **5 310** | **8 032** |
| cloth — robe | 2 409 | 4 608 |
| cloth — mantle | 1 495 | 2 816 |
| cloth — sleeves (×2) | 1 134 | 2 080 |
| **cloth total** | **5 038** | **9 504** |
| **character total** | **11 961** | **20 374** |

Reference performance for the whole character (skeleton, cloth, fur, spray) is **< 0.02 ms GPU**
at 2560×1440 on an RTX 5070 Ti.

---

## 4. Material palette

Uploaded as two `vec4[8]` arrays (`matAlbedo`, `matParams`), so every value is live-tunable and
nothing is baked into the shader.

**`PALETTE` — rgb = albedo, a = base roughness:**

| Slot | r | g | b | roughness | Meaning |
|---|---|---|---|---|---|
| 0 | 0.030 | 0.048 | 0.125 | 0.80 | robe, deep indigo |
| 1 | 0.075 | 0.105 | 0.185 | 0.74 | mantle, blue-grey |
| 2 | 0.230 | 0.225 | 0.205 | 0.82 | collar lining, warm pale |
| 3 | 0.048 | 0.033 | 0.024 | 0.60 | leather |
| 4 | 0.135 | 0.095 | 0.072 | 0.85 | skin, deep in shade |
| 5 | 0.120 | 0.195 | 0.310 | 0.70 | trim / scarf, pale blue |
| 6 | 0.700 | 0.720 | 0.760 | 0.85 | fur (unused by the fabric shader) |
| 7 | 0.100 | 0.100 | 0.100 | 0.80 | spare |

**`PARAMS` — (sheen, anisotropy, transmission, weaveDepth):**

| Slot | sheen | aniso | transmit | weaveDepth |
|---|---|---|---|---|
| 0 | 0.22 | 0.55 | 0.05 | 1.00 |
| 1 | 0.28 | 0.45 | 0.07 | 0.90 |
| 2 | 0.35 | 0.30 | 0.22 | 1.10 |
| 3 | 0.06 | 0.20 | 0.01 | 0.35 |
| 4 | 0.05 | 0.00 | 0.08 | 0.00 |
| 5 | 0.25 | 0.60 | 0.12 | 1.00 |
| 6 | 1.00 | 0.00 | 0.90 | 0.00 |
| 7 | 0.20 | 0.00 | 0.00 | 0.50 |

Two properties of these numbers are deliberate and were **measured off the render, not picked as
colours**, and a port that "corrects" them will look wrong:

* **They are very saturated.** At a 13° sun elevation the direct beam is roughly **17:13:6**, so
  a merely blue-ish albedo comes back out of the multiply as warm grey. The blue has to be about
  **4×** the red in the albedo just to survive to 2:1 in the lit areas.
* **They are very dark.** AgX compresses hard: an eighth of the snow's albedo is only about three
  stops down and lands near mid grey on screen. Anything lighter stops reading as a silhouette
  against the field.
* **Transmission is the number to be careful with.** Sunlight through a *blue* robe multiplied by
  a *warm* sun comes back grey, so a generous transmission term desaturates the garment to the
  point where the albedo stops mattering. Only the thin under-layer (slot 2) gets a real value.

Fur colour is a separate uniform: `furColor = (0.74, 0.755, 0.795)`.

---

## 5. THE LOCOMOTION SOLVER

This is the centrepiece. The design contract, stated in the source:

> Feet plant. A distance-driven stance/swing machine writes a foot's world position **exactly
> once, on touchdown**, and holds it absolutely fixed while two-bone IK reaches for it — a planted
> foot cannot slide because **nothing in the code is able to move it**. Gait phase advances with
> ground travelled, so stride length and ground speed are the same number by construction.

### 5.1 Controller constants

```js
const WALK_SPEED  = 2.5;    // m/s
const RUN_SPEED   = 5.4;    // m/s  (sprint)
const WALK_ACCEL  = 26;     // m/s²
const WALK_DECEL  = 30;     // m/s²

const SURF_MAX    = 19.5;   // m/s terminal
const SURF_THRUST = 11.0;   // m/s²
const SURF_DRAG   = 0.42;
const SURF_TURN   = 2.35;   // rad/s at full steer
const SURF_GRIP   = 7.5;    // 1/s lateral velocity kill rate

const STRIDE_BASE = 1.55;   // metres of travel per full stride cycle at top walking speed
```

### 5.2 Controller state (read by the figure, the cloth, the contact system and the wake)

`position, velocity, prevVelocity, acceleration` (Vector3); `facing` (yaw, rad, **never wrapped**);
`speed`, `speed01` (= `clamp(speed / SURF_MAX, 0, 1)`); `surf` (0..1 eased); `surfActive`;
`cast` (0..1) + `castAimX/Y/Z`; `lean` (−1..1, right positive); `carve`; `streak01`;
`gaitPhase`; `stepping`; `footfall` (one frame); `footIndex`; `footPos`; `footImpact`;
`groundY`; `groundNormal`.

### 5.3 Controller `update(dt, rig)` — exact order

```js
h = min(dt, 1/30)
prevVelocity = velocity
surfActive   = input.surf
surf = expDamp(surf, surfActive ? 1 : 0, surfActive ? 2.6 : 3.4, h)   // asymmetric ease

rig.getFlatForward(_fwd);  rig.getFlatRight(_right)

if (surf > 0.5) surfStep(h, rig)  else  walkStep(h)

position.x += velocity.x * h
position.z += velocity.z * h
groundY   = terrain.heightAt(position.x, position.z)
groundNormal = terrain.normalAt(position.x, position.z)
position.y = expDamp(position.y, groundY, 26, h)      // soft snap: micro-ripples don't jitter the rig

speed   = hypot(velocity.x, velocity.z)
speed01 = clamp(speed / SURF_MAX, 0, 1)
acceleration.x = (velocity.x - prevVelocity.x) / h
acceleration.z = (velocity.z - prevVelocity.z) / h

// lateral acceleration → lean
rx = cos(facing); rz = -sin(facing)
latAcc   = acceleration.x*rx + acceleration.z*rz
leanWant = clamp(latAcc / 26, -1, 1) * (0.35 + 0.65 * surf)
lean  = expDamp(lean,  leanWant, 6.5, h)
carve = expDamp(carve, leanWant, 9.0, h)

streak01 = surf * clamp((speed - 7) / 11, 0, 1)

gait(h)
```

**`walkStep(h)`**

```js
maxSpeed = input.sprint ? RUN_SPEED : WALK_SPEED
wish = flatForward * input.moveZ + flatRight * input.moveX
if (|wish| > 0.001):
    wish = normalize(wish) * maxSpeed
    a = WALK_ACCEL * h
    velocity.xz += clamp(wish.xz - velocity.xz, -a, a)          // component-wise
    facing = angleDamp(facing, atan2(wish.x, wish.z), 11, h)
else:
    d = WALK_DECEL * h;  s = |velocity.xz|
    if (s > 0.0001) velocity.xz *= max(0, s - d) / s
```

**`surfStep(h, rig)`**

```js
steer = clamp(input.moveX * 0.85 + angleDelta(facing, rig.yaw) * 1.25, -1, 1)
facing += steer * SURF_TURN * h

load = |steer| * (speed / SURF_MAX)
if (load > 0.25) rig.addTrauma((load - 0.25) * 1.35 * h)   // camera shake as a RATE, equilibrium ≈0.4

fx = sin(facing); fz = cos(facing)
n = terrain.normalAt(position.x, position.z)
slopeAssist = -(n.x*fx + n.z*fz) * 26
thrust = SURF_THRUST + slopeAssist
if (input.moveZ < 0) thrust -= 14                       // pull back to scrub speed
velocity.xz += (fx, fz) * thrust * h

rx = cos(facing); rz = -sin(facing)
lat  = velocity.x*rx + velocity.z*rz
grip = min(1, SURF_GRIP * h)
velocity.xz -= (rx, rz) * lat * grip                    // residual is what reads as a drift

s = |velocity.xz|
if (s > 0.0001):
    drag = SURF_DRAG * s * s * 0.02 + 0.9               // quadratic → natural terminal speed
    velocity.xz *= max(0, s - drag * h) / s
if (s > SURF_MAX) velocity.xz *= SURF_MAX / s
```

### 5.4 The distance-driven gait — `_gait(h)`

```js
footfall = false

// Feet stay on the board while surfing AND for the run-out afterwards. The surf blend eases to
// zero in ~1/5 s but momentum takes ~2/3 s to bleed off, during which the character is doing
// 19 m/s: a distance-driven gait answered that with a 12 Hz cadence and the legs blurred.
stepping = (surf <= 0.5) && (speed <= RUN_SPEED * 1.2)      // 6.48 m/s ceiling
if (!stepping) { gaitPhase = 0; return; }

dist   = speed * h
stride = STRIDE_BASE * (0.72 + 0.28 * min(1, speed / RUN_SPEED))
prev   = gaitPhase
gaitPhase = (gaitPhase + dist / stride) % 1                 // ← THE WHOLE POINT

if (speed < 0.15) return

// Two plants per cycle, at phase 0.0 and 0.5.
crossed = (prev < 0.5 && gaitPhase >= 0.5) || (gaitPhase < prev)
if (!crossed) return

footfall   = true
footIndex  = gaitPhase < 0.5 ? 0 : 1
footImpact = clamp(0.35 + speed / RUN_SPEED, 0, 1.3)
side = footIndex === 0 ? -0.17 : 0.17
footPos = ( position.x + cos(facing)*side, position.y, position.z - sin(facing)*side )
```

Stride length **(derived)**: 1.55 m at sprint, `1.55 × (0.72 + 0.28×0.463) = 1.317 m` at walk
speed 2.5 m/s. Cadence is `speed / stride` cycles per second, i.e. **two footfalls every
`stride` metres of ground, at any speed and any frame rate**.

### 5.5 `Figure._updateFeet(h, ch)` — the stance/swing machine

State arrays (all pre-allocated, 2 feet):

```js
plant      = Float32Array(6)          // WHERE EACH FOOT IS PLANTED, world. Frozen for the whole stance.
footPos    = Float32Array(6)          // live foot position (equals plant during stance)
footNormal = Float32Array([0,1,0, 0,1,0])
footWeight = Float32Array([1, 1])     // 1 while carrying weight, 0 mid-swing, eased
_wasStance = [true, true]
touchdown  = [false, false]           // set for exactly one frame on touchdown
```

```js
surf = ch.surf;  speed = ch.speed;  run = min(1, speed / 5.4)

// Duty factor: a walk keeps both feet down for a moment, a run has a flight phase.
// Interpolating makes walk→run read as a GAIT change, not a speed change.
duty = 0.66 - 0.20 * run                       // 0.66 standing/walking → 0.46 at full run

fwd = (sin(facing), cos(facing));   rgt = (cos(facing), -sin(facing))

half   = 0.34 + 0.42 * run                     // half a stride ahead = the step length
moving = speed > 0.2 && ch.stepping            // the CONTROLLER owns this decision

for f in 0..1:
    side = f === 0 ? -0.105 : 0.105
    ph   = (ch.gaitPhase + (f === 0 ? 0 : 0.5)) % 1        // left leads; right half a cycle behind
    stance = !moving || ph < duty

    // where this foot WOULD land if it touched down right now
    nx = ch.position.x + fwd.x*half + rgt.x*side
    nz = ch.position.z + fwd.z*half + rgt.z*side

    if (stance):
        if (!_wasStance[f]):
            // TOUCHDOWN. The only lines in the file that write a plant position.
            plant[f*3    ] = nx
            plant[f*3 + 1] = terrain.heightAt(nx, nz) - sink * 0.7
            plant[f*3 + 2] = nz
            touchdown[f] = true
        else:
            touchdown[f] = false

        if (!moving):
            // STANDING ONLY: ease the feet back under the hips rather than leaving them
            // wherever the last stride dropped them.
            sx = ch.position.x + rgt.x*side + fwd.x*0.02
            sz = ch.position.z + rgt.z*side + fwd.z*0.02
            plant[f*3    ] = damp(plant[f*3    ], sx, 7, h)
            plant[f*3 + 2] = damp(plant[f*3 + 2], sz, 7, h)
            plant[f*3 + 1] = damp(plant[f*3 + 1],
                                  terrain.heightAt(plant[f*3], plant[f*3+2]) - sink*0.7, 7, h)

        footPos[f*3 .. +2] = plant[f*3 .. +2]              // copy, never recompute
        footWeight[f] = damp(footWeight[f], 1, 22, h)

    else:
        touchdown[f] = false
        s = (ph - duty) / (1 - duty)                       // 0..1 across the swing
        e = s*s*(3 - 2*s)                                  // smoothstep ease
        ny = terrain.heightAt(nx, nz) - sink*0.7
        (px, py, pz) = plant[f*3 .. +2]                    // the plant it is LEAVING (unmodified)
        footPos[f*3    ] = px + (nx - px) * e
        footPos[f*3 + 2] = pz + (nz - pz) * e
        footPos[f*3 + 1] = py + (ny - py) * e + sin(PI * s) * (0.055 + 0.12 * run)   // arc lift
        footWeight[f] = damp(footWeight[f], 0, 22, h)

    _wasStance[f] = stance
```

**Why the foot cannot slide.** During stance the only write to `footPos` is a straight copy of
`plant`, and `plant` is written on exactly one frame (touchdown) — unless `moving` is false, in
which case a *standing* figure eases its feet under the hips. Body translation, camera motion and
frame-rate variation have no path to `plant`. `nx/nz` keeps updating during swing so the foot is
always aimed at where the body will actually be when it lands; at `s → 1` the swing endpoint and
the next frame's touchdown plant are the same expression, so the handover is continuous.

**Surf override** (blended, never snapped), applied after the loop when `surf > 0.001`:

```js
for f in 0..1:
    lateral = f === 0 ? -0.17 : 0.17      // wide, across the direction of travel
    along   = f === 0 ?  0.11 : -0.11     // staggered, leading foot a little ahead
    sx = position.x + fwd.x*along + rgt.x*lateral
    sz = position.z + fwd.z*along + rgt.z*lateral
    sy = terrain.heightAt(sx, sz) - sink       // NB: full sink here, not sink*0.7
    footPos[f*3 + k] += (s_k - footPos[f*3 + k]) * surf        // per-frame lerp by surf
    footWeight[f] = max(footWeight[f], surf)
```

(The surf blend is a per-frame lerp by `surf` rather than a rate — mildly frame-rate dependent by
construction; reproduce as written.)

### 5.6 Two-bone IK — `solveTwoBone`

Given root, target, pole, and the two segment lengths, writes the **middle joint's world
position** into `out`. Used identically for legs (THIGH_LEN/SHIN_LEN) and arms
(UPPER_LEN/FORE_LEN).

```js
d = target - root
dist = |d|
maxReach = (l1 + l2) * 0.995          // pulled INSIDE reach, not clamped AT it — a fully extended
                                       // leg reads as a stiff peg, and the last centimetre of
                                       // reach is where all the knee-lock artefacts live
if (dist < 1e-4) { d = (0, -1, 0); dist = 1e-4; }
if (dist > maxReach) dist = maxReach
d = normalize(d)                       // note: normalised by its ORIGINAL length, then dist is
                                       // used as the (possibly shortened) chord length

a = (l1*l1 - l2*l2 + dist*dist) / (2 * dist)    // cosine rule: projection of the mid joint
h = sqrt(max(0, l1*l1 - a*a))                    // perpendicular offset

// Pole, orthogonalised against the axis. This decides which way the knee/elbow bends and MUST be
// re-derived every frame, because the axis swings through it during a stride.
o = pole - d * dot(pole, d)
if (|o| < 1e-5) o = (0, 0, 1)
o = normalize(o)

out = root + d * a + o * h
```

Reach clamps **(derived)**: leg `0.81 × 0.995 = 0.80595 m`; arm `0.54 × 0.995 = 0.5373 m`.

### 5.7 `_poseLeg(f, root, rX..fZ)`

```js
side  = f === 0 ? -0.10 : 0.10
hip   = root + right*side - up*0.05                 // hip joint, carried by the PELVIS frame

ax = footPos[f*3]
ay = footPos[f*3 + 1] + 0.09                        // ankle sits above the sole
az = footPos[f*3 + 2]

// Knee pole tilts outward as well as forward: a knee bending in a perfectly sagittal plane looks
// mechanical — real legs track slightly wide of the hip.
outward = f === 0 ? -0.22 : 0.22
pole = forward + right * outward
solveTwoBone(hip, (ax,ay,az), pole, THIGH_LEN, SHIN_LEN) -> knee

setBone(THIGH, at hip,  dir = knee - hip,  ref = forward)
setBone(SHIN,  at knee, dir = ankle - knee, ref = forward)

// Foot roll: flat while loaded, toe-down through the swing.
w       = footWeight[f]
toeDown = (1 - w) * 0.55                            // radians
c = cos(toeDown); s = sin(toeDown)
dir = forward*c - up*s                              // rotate forward down about the body's right
setBone(FOOT, at ankle, dir, ref = up)
```

### 5.8 `_poseArms(h, ch, chest…)`

```js
run   = min(1, ch.speed / 5.4)
swing = sin(2*PI * ch.gaitPhase) * (0.20 + 0.42*run) * (1 - surf)
idle  = sin(_t * 0.9) * 0.02  +  sin(_t * 1.7 + 1.3) * 0.012      // never perfectly still

for a in 0..1:
    sgn = a === 0 ? -1 : 1
    shoulder = chest + chestRight*(sgn*0.185) + chestUp*0.14

    // ---- walk target: hand swings fore/aft below the hip -------------------
    sw = swing * -sgn                                              // counter-swing vs the legs
    t  = shoulder + forward*(sw*0.38) - up*0.43 + right*(sgn*0.11)
    t.y += idle * sgn

    // ---- cast target: blended, not switched; composes with the walk swing ---
    if (ch.cast > 0.001):
        aim  = (ch.castAimX, ch.castAimY, ch.castAimZ)
        lead = (a === 1) ? 1 : 0                    // the RIGHT hand leads (the ribbon emitter)
        outward = lead ? 0.30 : -0.16
        along   = lead ? 0.52 :  0.16
        lift    = lead ? 0.26 :  0.02
        cx = shoulder.x + rX*(sgn*0.30 + outward*sgn) + aim.x*along + uX*lift
        cy = shoulder.y + rY*(sgn*0.30)               + aim.y*along + uY*lift + lift*0.6
        cz = shoulder.z + rZ*(sgn*0.30 + outward*sgn) + aim.z*along + uZ*lift
        t += (c - t) * ch.cast
    // NB verbatim asymmetry: the Y line omits `outward*sgn` on the right-axis term and adds an
    // extra world-space `lift*0.6`. Reproduce exactly — it is what the pose was tuned against.

    // ---- surf target: out, forward and a little down ------------------------
    if (surf > 0.001):
        rise = 0.02 + ch.carve * sgn * 0.22         // trailing arm rises, leading arm drops
        s = shoulder + right*(sgn*0.33) + forward*0.24 + up*rise
        t += (s - t) * surf

    // Elbows point back and out.
    pole = ( -fX + rX*(sgn*0.55),  -fY + rY*(sgn*0.55) - 0.35,  -fZ + rZ*(sgn*0.55) )
    solveTwoBone(shoulder, t, pole, UPPER_LEN, FORE_LEN) -> elbow

    setBone(UPPER, at shoulder, dir = elbow - shoulder, ref = forward)
    setBone(FORE,  at elbow,    dir = t - elbow,        ref = forward)
    setBone(HAND,  at t,        dir = normalize(t - elbow), ref = forward)   // hand continues the forearm
```

`handPosition(which, out, od)` — world position of a hand for spell emitters — is
`xformPoint(world[HAND_L|R], (0, 0.09, 0))`, i.e. 9 cm down the hand bone's own axis.

### 5.9 `Figure.update(dt, ch)` — full order of operations

```js
h = min(dt, 1/30);  _t += h
surf  = ch.surf;  speed = ch.speed;  run = min(1, speed / 5.4)

1. _updateFeet(h, ch)                       // FIRST — stance/swing, plants, footPos, touchdown

2. body attitude
   fwdAcc    = ch.acceleration.x*sin(facing) + ch.acceleration.z*cos(facing)
   pitchWant = 0.10*run + 0.012*clamp(fwdAcc, -9, 22) + surf*(0.30 + 0.16*ch.speed01)
   pitch     = damp(pitch, pitchWant, 7, h)
   rollWant  = ch.lean * (0.16 + 0.34*surf)
   roll      = damp(roll, rollWant, 8, h)
   bobWant   = (1 - surf) * (-0.028 * run * (0.5 - 0.5*cos(4*PI*ch.gaitPhase)))   // twice per stride
   bob       = damp(bob, bobWant, 18, h)
   crouch    = 0.035*run + surf*(0.13 + 0.05*ch.speed01)
   hipY      = damp(hipY, HIP_HEIGHT - crouch, 9, h)
   sink      = damp(sink, 0.045 + surf*0.055, 4, h)     // how far the figure settles into the snow
                                                        // (CPU-side; matches what contact brushes write)

3. spine
   groundY = terrain.heightAt(ch.position.x, ch.position.z)
   rootY   = groundY - sink + hipY + bob
   composeBasis(facing, pitch, roll)  ->  r/u/f axes
   twist   = (1 - surf) * 0.13 * run * sin(2*PI * ch.gaitPhase)     // PELVIS counter-rotation
   composeBasis(facing + twist, pitch, roll)
   setBone(ROOT,  at (gx, rootY, gz),           dir = up',  ref = fwd')
   setBone(SPINE, at root + up*0.11,            dir = up,   ref = fwd)

   chestTwist = -twist * 1.5                                        // shoulders the OTHER way, 1.5×
   chestPitch = pitch + 0.05*run + surf*0.10
   composeBasis(facing + chestTwist, chestPitch, roll * 1.15)  -> cR/cU/cF
   setBone(CHEST, at root + up*0.31,            dir = cU, ref = cF)
   setBone(NECK,  at chest + cU*0.20,           dir = cU, ref = cF)

4. head — stabilised much closer to level than the chest it sits on
   headPitch = damp(headPitch, -chestPitch*0.62 + surf*0.10, 9, h)
   headYaw   = damp(headYaw,   ch.lean * -0.22,              6, h)
   composeBasis(facing + chestTwist + headYaw, chestPitch + headPitch, roll*0.5)
   setBone(HEAD, at neck + cU*0.09, ...)

5. hood — a LAGGED copy. Tracking the skull exactly reads as a helmet; a few frames of lag reads
   as fabric.
   hoodYaw   = damp(hoodYaw,   facing + chestTwist + headYaw,   11, h)
   hoodPitch = damp(hoodPitch, chestPitch + headPitch + 0.05,    9, h)
   composeBasis(hoodYaw, hoodPitch, roll*0.5)
   setBone(HOOD, at the SAME position as HEAD, ...)

6. _poseArms(...)
7. _poseLeg(0, ...);  _poseLeg(1, ...)
8. for b in 0..17: skin[b] = world[b] * invBind[b];  joint[b] = world[b].translation
```

### 5.10 Contract with the footprint system

`snowContact.js` reads `figure.touchdown[i]` and `figure.plant[i]` — **not** the controller's own
`footfall`/`footPos`. "The print has to be under the boot, and only the figure knows where the
boot actually planted, because it is the thing that decided." Footprint brush: radius
`BOOT_WIDTH = 0.10`, elongation `BOOT_ELONG = 1.7` (a 20 × 34 cm print), yawed to `ch.facing`,
depth `0.17 + 0.14*impact`, displaced mass `0.10 + 0.08*impact`, compression `0.9`, ice `0`, rim
roughness `1.0`, where `impact = min(1.3, 0.35 + speed/5.4)` recomputed at the splat so it cannot
be a frame stale.

---

## 6. The transform DATA TEXTURE

The spine of the whole system: **one small texture carries everything to the GPU, one upload per
frame, no allocation.**

```js
const TEX_W = 48;        // width covers the widest of {bone count 18, panel cols 36}
const TEX_H = 64;
const CLOTH_ROW0 = 4;    // first row available to cloth; 0-3 are the bone matrices
```

Format: `RawTexture.CreateRGBATexture(data, 48, 64, scene, /*mips*/false, /*invertY*/false,
TEXTURE_NEAREST_SAMPLINGMODE, TEXTURETYPE_FLOAT)` → **RGBA32F, nearest, no mips, CLAMP wrap on
both axes**. Staging array `Float32Array(48 * 64 * 4)` = 12 288 floats = **48 KiB per upload**.

### 6.1 Rows 0–3 — bone matrices

**Column = bone index, row = matrix column.** Texel `(b, c)` is column `c` of bone `b`'s
`world * inverseBind`:

```js
for (b = 0; b < BONE_COUNT; b++)
    for (c = 0; c < 4; c++) {
        o = (c * TEX_W + b) * 4;
        d[o+0] = skin[b*16 + c*4 + 0];
        d[o+1] = skin[b*16 + c*4 + 1];
        d[o+2] = skin[b*16 + c*4 + 2];
        d[o+3] = skin[b*16 + c*4 + 3];
    }
```

| Row | Contents | .r/.g/.b | .a |
|---|---|---|---|
| 0 | matrix column 0 (X axis) | X axis xyz | 0 |
| 1 | matrix column 1 (Y axis) | Y axis xyz | 0 |
| 2 | matrix column 2 (Z axis) | Z axis xyz | 0 |
| 3 | matrix column 3 (translation) | translation xyz | 1 |

Columns 18–47 of rows 0–3 are unused.

### 6.2 Rows 4+ — simulated cloth nodes

One rectangle per garment panel, assigned at construction in panel order, `row` running upward:

```js
let row = CLOTH_ROW0;
for each panel p:  p.nodeRow = row;  panelParams[i] = (row, p.cols, p.rows, 0);  row += p.rows;
if (p.cols > TEX_W)  throw "panel wider than the transform texture";
if (row   > TEX_H)   throw "transform texture too short for the panels";
```

Resulting layout **(derived from the panel table)**:

| Panel | `nodeRow` | rows occupied | cols used |
|---|---|---|---|
| robe | 4 | 4 … 15 | 0 … 35 |
| mantle | 16 | 16 … 22 | 0 … 27 |
| sleeve0 | 23 | 23 … 30 | 0 … 9 |
| sleeve1 | 31 | 31 … 38 | 0 … 9 |

Rows 39–63 unused. Per-node write:

```js
for (j = 0; j < p.rows; j++)
    for (i = 0; i < p.cols; i++) {
        s = (j * p.cols + i) * 3;
        o = ((p.nodeRow + j) * TEX_W + i) * 4;
        d[o+0] = pos[s]; d[o+1] = pos[s+1]; d[o+2] = pos[s+2]; d[o+3] = 1;
    }
charTex.update(d);      // ONE upload
```

`.rgb` = **absolute world position of the node, in metres**; `.a` = 1 (unused).

`panelParams` is uploaded as `array<vec4f, 6>` (6 slots declared, 4 used) to every program that
samples cloth: `(rowBase, cols, rows, unused)`.

### 6.3 `charSkin.wgsl` — the shared vertex-side library (verbatim)

```wgsl
/// Skin a point by one bone.
fn skinPoint1(tex: texture_2d<f32>, b: i32, p: vec3f) -> vec3f {
    let c0 = textureLoad(tex, vec2i(b, 0), 0);
    let c1 = textureLoad(tex, vec2i(b, 1), 0);
    let c2 = textureLoad(tex, vec2i(b, 2), 0);
    let c3 = textureLoad(tex, vec2i(b, 3), 0);
    return c0.xyz * p.x + c1.xyz * p.y + c2.xyz * p.z + c3.xyz;
}

/// Skin a direction by one bone (no translation).
fn skinDir1(tex: texture_2d<f32>, b: i32, d: vec3f) -> vec3f {
    let c0 = textureLoad(tex, vec2i(b, 0), 0);
    let c1 = textureLoad(tex, vec2i(b, 1), 0);
    let c2 = textureLoad(tex, vec2i(b, 2), 0);
    return c0.xyz * d.x + c1.xyz * d.y + c2.xyz * d.z;
}

/// Two-influence linear blend skinning. Two is enough for a figure whose only
/// hard joints are elbows and knees; the garments that need more are simulated.
fn skinPoint(tex: texture_2d<f32>, idx: vec4f, wt: vec4f, p: vec3f) -> vec3f {
    var r = skinPoint1(tex, i32(idx.x), p) * wt.x;
    if (wt.y > 0.0001) { r += skinPoint1(tex, i32(idx.y), p) * wt.y; }
    return r / max(1e-4, wt.x + wt.y);          // renormalised by weight sum
}

fn skinNormal(tex: texture_2d<f32>, idx: vec4f, wt: vec4f, n: vec3f) -> vec3f {
    var r = skinDir1(tex, i32(idx.x), n) * wt.x;
    if (wt.y > 0.0001) { r += skinDir1(tex, i32(idx.y), n) * wt.y; }
    return normalize(r);
}
```

**Cloth sampling.** `u` wraps (every garment is a closed tube), `v` clamps (top and bottom edges
are real boundaries):

```wgsl
fn clothNode(tex, rowBase: i32, cols: i32, rows: i32, i: i32, j: i32) -> vec3f {
    let ii = (i % cols + cols) % cols;          // true modulo, handles i = -1
    let jj = clamp(j, 0, rows - 1);
    return textureLoad(tex, vec2i(ii, rowBase + jj), 0).xyz;
}

fn crBasis(t: f32) -> vec4f {                    // Catmull-Rom
    let t2 = t*t;  let t3 = t2*t;
    return vec4f(0.5*(-t3 + 2.0*t2 - t),
                 0.5*(3.0*t3 - 5.0*t2 + 2.0),
                 0.5*(-3.0*t3 + 4.0*t2 + t),
                 0.5*(t3 - t2));
}
fn crDeriv(t: f32) -> vec4f {                    // its analytic derivative
    let t2 = t*t;
    return vec4f(0.5*(-3.0*t2 + 4.0*t - 1.0),
                 0.5*(9.0*t2 - 10.0*t),
                 0.5*(-9.0*t2 + 8.0*t + 1.0),
                 0.5*(3.0*t2 - 2.0*t));
}
```

```wgsl
fn sampleCloth(tex, rowBase: i32, cols: i32, rows: i32, u: f32, v: f32) -> ClothSample {
    let gu = u * f32(cols);            // NOTE: cols (wrapping)
    let gv = v * f32(rows - 1);        // NOTE: rows - 1 (clamping)
    let fu = floor(gu);   let fv = floor(gv);
    let i0 = i32(fu) - 1; let j0 = i32(fv) - 1;

    let wu = crBasis(gu - fu);  let du = crDeriv(gu - fu);
    let wv = crBasis(gv - fv);  let dv = crDeriv(gv - fv);

    var p = vec3f(0.0);  var pu = vec3f(0.0);  var pv = vec3f(0.0);
    for (var j = 0; j < 4; j++) {
        var rowP = vec3f(0.0);  var rowD = vec3f(0.0);
        for (var i = 0; i < 4; i++) {
            let q = clothNode(tex, rowBase, cols, rows, i0 + i, j0 + j);
            rowP += q * wu[i];
            rowD += q * du[i];
        }
        p  += rowP * wv[j];
        pu += rowD * wv[j];
        pv += rowP * dv[j];
    }
    out.pos  = p;
    out.nrm  = normalize(cross(pv, pu));   // ordered so it points AWAY from the body:
    out.tanU = normalize(pu);              // u runs anticlockwise around the tube, v down it
}
```

16 texel fetches per vertex; position **and** both tangents fall out of the same taps — no finite
differences, no second sampling pass, and normals exactly consistent with the surface drawn. This
decoupling is why a 36×12 solve renders as a 72×32 surface with no visible facets.

### 6.4 The five vertex programs

| Program | Attributes | Output |
|---|---|---|
| `char.vertex` | position, normal, uv, aux, boneIdx, boneWt | `vWorld = skinPoint(...)`, `vNormal = skinNormal(...)`, `vUV`, `vAux`, `vViewDist = distance(world, cameraPos)`, `position = viewProjection * vec4(world,1)` |
| `cloth.vertex` | position=(u,v,panel), uv, aux | `s = sampleCloth(charTex, pp.x, pp.y, pp.z, position.x, position.y)`; then the identical five varyings from `s.pos` / `s.nrm` |
| `charDepth.vertex` | position, boneIdx, boneWt | `lightViewProjection * vec4(skinPoint(...), 1)` |
| `clothDepth.vertex` | position | `lightViewProjection * vec4(sampleCloth(...).pos, 1)` |
| `charPrepass` / `clothPrepass` | as above | `clip = viewProjection * vec4(world,1)`; `vViewZ = clip.w` (linear view depth); `vMask = 0.0` (no specular mask on cloth) |
| `fur.vertex` | position, normal, uv, aux, boneIdx, boneWt | single-bone `skinPoint1`/`skinDir1`, then `world += furDroop * (t*t)` where `t = aux.x` |

Every one of them includes the *same* `charSkin` file, so the surface in the depth map, in the
prepass and in the beauty pass is the same surface by construction.

**Fur droop** (CPU, `character.js`, uniform `furDroop`, world-space metres of tip travel):

```js
a  = windDirection_deg * PI / 180
ws = 0.6 * windStrength
droop = ( sin(a)*ws*0.006 - velocity.x*0.0016 - acceleration.x*0.00018,
          -0.018,
          cos(a)*ws*0.006 - velocity.z*0.0016 - acceleration.z*0.00018 )
```

The `t²` scaling is what curves a strand instead of shearing it — the tip moves four times as far
as the midpoint.

---

## 7. The fabric material — `char.fragment.wgsl`

Shared by the skinned body **and** the simulated garments. A plain PBR dielectric is the wrong
model for cloth and looks it; three terms carry the difference: **sheen** (retroreflective fibre
lobe — why wool has a bright *rim* rather than a bright *highlight*), **anisotropy** (the weave has
a direction), and **transmission** (thin fabric over a lit edge glows — the same back-scatter term
the snow uses, at a different mean free path).

### 7.1 Uniforms

`cameraPos:vec3`, `sunDir:vec3`, `sunRadiance:vec3`, `shR:vec4[9]`,
`cascadeMatrices:mat4[3]`, `cascadeSplits:vec4`, `cascadeParams:vec4[3]`,
`shadowTexel:f32`, `shadowSoftness:f32`, `shadowBias:f32`,
`matAlbedo:vec4[8]`, `matParams:vec4[8]`,
`fogDensity`, `fogHeightFalloff`, `fogStart`, `aerialStrength`, `ambientIntensity`,
`sssStrength`, `weaveDensity:f32`, `screenSize:vec2`,
`spellLightPos:vec4[4]`, `spellLightCol:vec4[4]`, `spellLightCount:f32`.
Samplers: `charTex`, `skyLUT`, `cascade0..2`.

Per-frame values pushed by `character.js`: **`shadowSoftness = 1.4`**, **`shadowBias = 0.012`**
(tighter than the terrain's — a large bias detaches the contact shadow between the boots and the
snow, which is the shadow that tells you the character is standing *on* the ground rather than
*in* it), **`weaveDensity = 210`** threads per metre ("coarse hand-woven wool, present in a
close-up, gone by ten metres"), **`furDensity = 250`** strand cells per metre. Character casts
into **2 of the 3 cascades** (`CHAR_CASCADES = 2`); fur casts into none.

### 7.2 Helper BRDF functions (verbatim)

```wgsl
/// Charlie sheen distribution. `roughness` is FIBRE roughness and wants to be high —
/// 0.3 or below turns the rim into a hard line.
fn dCharlie(NdotH: f32, roughness: f32) -> f32 {
    let invR  = 1.0 / max(0.05, roughness);
    let cos2h = NdotH * NdotH;
    let sin2h = max(1.0 - cos2h, 1e-4);
    return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * PI);
}

/// Ashikhmin's visibility term.
fn vAshikhmin(NdotV: f32, NdotL: f32) -> f32 {
    return 1.0 / max(1e-4, 4.0 * (NdotL + NdotV - NdotL * NdotV));
}

/// Anisotropic GGX, Burley's parameterisation.
fn dGGXAniso(TdotH: f32, BdotH: f32, NdotH: f32, ax: f32, ay: f32) -> f32 {
    let a2 = ax * ay;
    let d  = vec3f(ay * TdotH, ax * BdotH, a2 * NdotH);
    let d2 = dot(d, d);
    if (d2 < 1e-9) { return 0.0; }
    let b2 = a2 / d2;
    return a2 * b2 * b2 / PI;
}

/// Karis' analytic split-sum environment BRDF. NOT an optimisation — a CORRECTION.
/// `fresnelSchlickRough` alone overestimates badly at grazing angles on a rough surface: the
/// roughness clamp makes reflectance run to (1 - roughness) there, which for wool is 0.2 of the
/// WHOLE SKY on every silhouette pixel — a navy robe rendering pale grey whenever the camera
/// looked across it.
fn envBRDFApprox(f0: vec3f, roughness: f32, NdotV: f32) -> vec3f {
    let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
    let c1 = vec4f( 1.0,  0.0425,  1.04, -0.04);
    let r  = vec4f(roughness) * c0 + c1;
    let a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
    return f0 * (-1.04 * a004 + r.z) + (1.04 * a004 + r.w);
}

/// Screen-space cotangent frame (Mikkelsen). Works identically for the skinned body and the
/// Catmull-Rom garments, neither of which carries an authored tangent.
fn cotangentFrame(N: vec3f, dp1: vec3f, dp2: vec3f, duv1: vec2f, duv2: vec2f) -> mat3x3f {
    let dp2perp = cross(dp2, N);
    let dp1perp = cross(N, dp1);
    let T  = dp2perp * duv1.x + dp1perp * duv2.x;
    let Bv = dp2perp * duv1.y + dp1perp * duv2.y;
    let invmax = inverseSqrt(max(max(dot(T,T), dot(Bv,Bv)), 1e-12));
    return mat3x3f(T * invmax, Bv * invmax, N);
}
```

### 7.3 The procedural weave (verbatim)

```wgsl
/// Procedural plain weave: a tangent-space normal in xy and a cavity in z.
/// Warp and weft alternate which one is on top, and the one on top gets the stronger ridge.
/// That alternation is the whole read — two crossed sine ridges without it look like a GRID,
/// not a TEXTILE.
fn weave(uv: vec2f) -> vec3f {
    let p    = uv * 6.28318530718;
    let warp = sin(p.x);
    let weft = sin(p.y);
    let over = smoothstep(-0.35, 0.35, warp * weft);
    let nx   = cos(p.x) * mix(0.30, 1.0, over);
    let ny   = cos(p.y) * mix(1.0, 0.30, over);
    // Cavity is deepest where neither thread is at its crown.
    let cav  = 0.55 + 0.45 * max(abs(warp), abs(weft));
    return vec3f(nx, ny, cav);
}
```

### 7.4 Fragment main — full control flow with every constant

```
world = vWorld;   V = normalize(cameraPos - world);   L = sunDir

// -- two-sided normal ------------------------------------------------------
N = normalize(vNormal)
if (dot(N, V) < 0) N = -N          // garments are open sheets and the hood is a shell; the camera
geoN = N                            // sees both sides of nearly everything. Turning the normal to
                                    // face the viewer beats trusting winding, which for
                                    // procedurally lofted geometry is one sign error from
                                    // inside-out. For a surface this thin it is also physically
                                    // the right answer.

// -- material slot ---------------------------------------------------------
slot       = clamp(i32(vAux.x + 0.5), 0, 7)
albedo     = matAlbedo[slot].rgb
roughness  = matAlbedo[slot].a
sheenAmt   = matParams[slot].x
aniso      = matParams[slot].y
transmit   = matParams[slot].z
weaveDepth = matParams[slot].w

// -- weave detail ----------------------------------------------------------
wuv  = vUV * weaveDensity                    // vUV is in METRES, so this is threads
dp1  = dpdx(world);  dp2 = dpdy(world)
duv1 = dpdx(wuv);    duv2 = dpdy(wuv)
TBN  = cotangentFrame(N, dp1, dp2, duv1, duv2)

uvFoot    = max(length(duv1), length(duv2))
weaveFade = 1.0 - smoothstep(0.10, 0.45, uvFoot)      // fade out once a thread is under a pixel,
cavity    = 1.0                                       // or it aliases into crawling moire
if (weaveDepth > 0.001 && weaveFade > 0.001) {
    w      = weave(wuv)
    N      = normalize(N + (TBN[0]*w.x + TBN[1]*w.y) * weaveDepth * weaveFade * 0.5)
    cavity = mix(1.0, w.z, weaveFade * 0.8)
}

// -- yarn slub: centimetre scale, an order of magnitude coarser than the weave, so unlike the
//    weave it SURVIVES to the distance the figure is actually seen at ------
slub      = noise2(vUV * vec2f(9.0, 26.0)) * 0.5 + 0.5      // deliberately anisotropic: 9 along U,
albedo   *= 0.90 + 0.20 * slub                              // 26 along V — yarn runs one way
roughness = clamp(roughness * (0.94 + 0.12 * slub), 0.05, 1.0)

ao = vAux.y * cavity          // baked at the vertex, times the weave cavity. No SSAO: it is a
                              // two-metre silhouette against forty metres of snow.

// -- lighting --------------------------------------------------------------
NdotL    = dot(N, L)
NdotV    = clamp(dot(N, V), 1e-4, 1.0)
noiseRot = ign(fragCoord.xy) * 6.28318530718

shadow = 1.0
if (NdotL > -0.4) shadow = sunShadow(world, geoN, vViewDist, noiseRot)   // world-space PCSS

sun = sunRadiance;   INV_PI = 0.31830988618

// diffuse — wrapped a little: fabric is not opaque at fibre scale, and the terminator on a
// sleeve is genuinely soft.
diff  = wrapDiffuse(NdotL, 0.18)
color = albedo * INV_PI * sun * diff * shadow

// transmission through thin cloth
if (transmit > 0.001) {
    back   = backScatter(N, L, V, distortion=0.4, power=4.0, thickness=1.0)
    color += sun * albedo * back * transmit * sssStrength * mix(0.35, 1.0, shadow)
}

// specular + sheen, only on the lit side
if (NdotL > 0.0) {
    H     = normalize(V + L)
    NdotH = clamp(dot(N, H), 0, 1);   VdotH = clamp(dot(V, H), 0, 1)

    ar = max(0.04, roughness * roughness)
    ax = ar * (1.0 + aniso)              // stretched along the warp
    ay = ar / (1.0 + aniso)
    D   = dGGXAniso(dot(TBN[0],H), dot(TBN[1],H), NdotH, ax, ay)
    Vis = visSmithGGXCorrelated(NdotV, max(NdotL, 1e-4), roughness)
    F   = fresnelSchlick(VdotH, vec3f(0.035))
    color += sun * D * Vis * F * NdotL * shadow

    // sheen — tinted toward the albedo but DESATURATED (fibre scatter is closer to white than
    // the bulk colour, which is why a navy robe rims pale blue).
    sheenTint = mix(vec3f(1.0), normalize(albedo + 1e-4), 0.35)
    ds        = dCharlie(NdotH, 0.42)
    graze     = 0.16 + 0.84 * pow(1.0 - NdotV, 2.0)
    sheenLobe = min(ds * vAshikhmin(NdotV, max(NdotL, 1e-4)) * NdotL, 0.25)   // clamped: Ashikhmin
                                                                              // runs away when both
                                                                              // cosines are small
    color += sun * sheenTint * sheenLobe * graze * sheenAmt * shadow
}
```

> **The two sheen corrections, learned from the render rather than the paper.** (1) The Ashikhmin
> visibility term runs away when both cosines are small, so the lobe is clamped to **0.25**.
> (2) Charlie is an *inverted* distribution — near its peak everywhere **except** close to the
> mirror direction — so applied flat it is not a rim, it is a **uniform veil over the entire
> garment**. At full strength it lifted a navy robe to the same value as the snow behind it and
> erased the silhouette completely. The `graze` gate (`0.16 + 0.84·(1−NdotV)²`) puts the energy
> back where fibre scatter actually shows: the edge.

```
// -- ambient ---------------------------------------------------------------
irradiance = shIrradiance(N, shR) * ambientIntensity

// SNOW BOUNCE. A figure standing on an 85%-albedo field is lit from below almost as much as from
// above; leaving this out is what makes characters composited into snow scenes look cut out.
up          = clamp(-N.y * 0.5 + 0.5, 0.0, 1.0)                  // 1 for downward-facing normals
irradiance += shIrradiance(vec3f(0,1,0), shR) * ambientIntensity * 0.40 * up

color += albedo * INV_PI * irradiance * ao

// ambient sheen: the sky wrapping around a fuzzy silhouette. Kept deliberately small — this term
// is albedo-INDEPENDENT, so any generosity erases the difference between a dark robe and a light one.
rim    = pow(1.0 - NdotV, 4.0)
skyAmb = shIrradiance(N, shR) * ambientIntensity * INV_PI
color += skyAmb * rim * sheenAmt * 0.55 * ao

// ambient specular from the sky at a roughness-selected mip
R       = reflect(-V, N)
mip     = sqrt(roughness) * 6.0
skyRefl = textureSampleLevel(skyLUT, dirToLatLong(R), mip).rgb
color  += skyRefl * envBRDFApprox(vec3f(0.035), roughness, NdotV) * ambientIntensity * ao

// -- spell lights ----------------------------------------------------------
// The caster stands INSIDE the thing they are casting, so this is the one material where the
// spell lights are almost always the DOMINANT source. Wrapped harder than the sun (0.35), because
// at half a metre the light is a broad source rather than a point.
if (spellLightCount > 0.5)
    color += spellLightingSurface(world, N, V, albedo, f0=vec3f(0.035), roughness,
                                  wrap=0.35, spellLightPos, spellLightCol, spellLightCount) * ao

// -- aerial perspective (identical code the snow runs) ----------------------
color = applyAerial(color, cameraPos, world, -V, L, skyLUT, sun,
                    fogDensity, fogHeightFalloff, fogStart, aerialStrength)

out = vec4f(color, 1.0)
```

### 7.5 Shared-library functions the fabric shader calls (verbatim, from `lib/`)

```wgsl
const PI: f32 = 3.14159265359;

fn wrapDiffuse(NdotL: f32, w: f32) -> f32 {
    let denom = (1.0 + w) * (1.0 + w);
    return max(0.0, (NdotL + w) / denom);
}

/// `L` points from the surface TOWARD the sun, which fixes the sign of the transmission vector.
/// Building it from -L inverts the whole term.
fn backScatter(N: vec3f, L: vec3f, V: vec3f, distortion: f32, power: f32, thickness: f32) -> f32 {
    let H  = normalize(L + N * distortion);
    let vh = pow(clamp(dot(V, -H), 0.0, 1.0), power);
    return vh * thickness;
}

fn visSmithGGXCorrelated(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;  let a2 = a * a;
    let gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
    let gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
    return 0.5 / max(1e-7, gv + gl);
}

fn fresnelSchlick(u: f32, f0: vec3f) -> vec3f {
    let f = pow(1.0 - u, 5.0);
    return f0 + (vec3f(1.0) - f0) * f;
}

fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {   // used by the fur only
    let a = roughness * roughness;  let a2 = a * a;
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(1e-7, PI * d * d);
}

/// Ramamoorthi & Hanrahan 9-coefficient SH irradiance.
fn shIrradiance(n: vec3f, sh: array<vec4f, 9>) -> vec3f {
    let c1 = 0.429043;  let c2 = 0.511664;  let c3 = 0.743125;
    let c4 = 0.886227;  let c5 = 0.247708;
    return sh[0].rgb * c4
         + sh[1].rgb * 2.0 * c2 * n.y
         + sh[2].rgb * 2.0 * c2 * n.z
         + sh[3].rgb * 2.0 * c2 * n.x
         + sh[4].rgb * 2.0 * c1 * n.x * n.y
         + sh[5].rgb * 2.0 * c1 * n.y * n.z
         + sh[6].rgb * (c3 * n.z * n.z - c5)
         + sh[7].rgb * 2.0 * c1 * n.x * n.z
         + sh[8].rgb * c1 * (n.x * n.x - n.y * n.y);
}

fn dirToLatLong(d: vec3f) -> vec2f {
    let u = atan2(d.x, d.z) / (2.0 * PI) + 0.5;
    let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2f(u, v);
}

/// Interleaved gradient noise, for per-pixel rotation of the shadow Poisson disc.
fn ign(pix: vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(pix, vec2f(0.06711056, 0.00583715))));
}

/// Perlin-style gradient noise with analytic derivatives; noise2() is its .x.
/// Quintic fade u = f³(f(6f − 15) + 10);  value range ≈ [-1, 1].
fn noise2(p: vec2f) -> f32 { return noised(p).x; }
```

`sunShadow(world, geoN, viewDist, noiseRot)` selects a cascade by `viewDist` against
`cascadeSplits` (returns 1.0 beyond `splits.z`) and runs the world-space PCSS in
`shading.wgsl::pcssShadow` — 8-tap blocker search then a 12-tap rotated Poisson filter, penumbra
`blockerDist * 0.0093 * softness`, search radius `min(24 * texelSize, 1.8 / orthoWidth)`. Specified
in full in the shadow subsystem spec; the character supplies only `shadowSoftness = 1.4` and
`shadowBias = 0.012`.

### 7.6 Fur fragment — the alpha-tested strand field (adjacent, for completeness)

```
t       = vAux.x                                     // shell parameter 0..1
g       = vUV * furDensity                           // furDensity = 250 cells/metre  (the shader
cell    = floor(g)                                   //  comment says "260 is a 3.8 mm pitch" —
h       = hash21(cell)                               //  the CODE pushes 250; code is canonical)
jitter  = hash22(cell + vec2f(11.3, 5.7)) - 0.5

strandLen = 0.30 + 0.70 * h
if (t > strandLen) discard                           // cut early and often

d      = length(fract(g) - 0.5 - jitter * 0.55)
taper  = 1.0 - (t / strandLen)
radius = 0.46 * (0.55 + 0.45 * hash21(cell + vec2f(3.1, 9.4))) * sqrt(max(taper, 0.0))
if (d > radius) discard

depth  = t / max(strandLen, 1e-3)
selfAO = 0.16 + 0.84 * depth * depth                 // roots see almost no sky, tips see all of it
diff   = wrapDiffuse(NdotL, 0.65)                    // fibres wrap light almost all the way round
color  = furColor * INV_PI * sun * diff * shadow * selfAO
color += sun * furColor * backScatter(N,L,V, 0.5, 3.0, 1.0) * 0.85 * mix(0.4, 1.0, shadow) * selfAO
if (NdotL > 0) color += sun * distributionGGX(NdotH, 0.75) * 0.05 * NdotL * shadow * selfAO
color += furColor * INV_PI * shIrradiance(N, shR)*ambientIntensity * selfAO * vAux.y * 1.4
color  = applyAerial(...)
```

---

## 8. Frame orchestration and pass dependencies

Order in `main.js`, exactly:

```
1. character.update(dt, rig)              // controller: motion, facing, gaitPhase
2. terrain.clampToPlayArea(position)
3. figure.update(dt)                      // Character.update:
       figure.update(dt, controller)      //   a) pose the 18 bones
       if (firstFrame) _settleCloth()     //   b) once: drop every garment onto its skinned target
       solver.update(dt, figure, ch)      //   c) simulate cloth against the JUST-POSED skeleton
       _uploadTransforms()                //   d) ONE texture upload (bones + nodes together)
4. contact.update(dt)                     // stamps footprints at figure.plant[] — AFTER the pose,
                                          // because the plant only exists once the figure solved
5. rig.update(...)   post.update(...)   sky.update/render()   shadows.update()
6. spells.update()   terrain.update()
7. figure.sync(cameraPos)                 // _pushUniforms(): AFTER the shadow refit, so the figure
                                          // carries THIS frame's cascade matrices, not last frame's
8. wake.update()   spray.update()   scene.render()
```

Two split points are deliberate and a port must preserve them:

* **Pose before cloth before upload.** "The garments render one frame behind the body they hang
  from" otherwise.
* **`update` and `sync` are separate.** The garments must be solved before the contact system reads
  the feet, but the uniforms cannot be written until the camera has moved and the cascades have
  been refitted. Doing both at one point leaves one of them a frame stale, and the visible symptom
  — a shadow lagging the figure by a frame during a fast carve — "reads as *cheap* without being
  identifiable".

**One-time cloth settle** (`_settleCloth`, first update only): every panel node is placed at
`skin[bone] * bindPos`, and `prev` is set equal to `pos` (zero velocity). The panels are authored
in bind space at the world origin; letting them fall from there to wherever the player spawned
takes a second of visible flapping.

**Warm-up.** Every material and every depth/prepass variant is `isReady()`-gated and exercised with
real geometry behind the loading screen, so the first cast of a spell does not compile a pipeline
mid-frame.

---

## 9. WEBGL2 / THREE.JS r172 PORTING NOTES

### 9.1 The transform texture

| WebGPU / Babylon | WebGL2 / Three.js r172 |
|---|---|
| `RawTexture.CreateRGBATexture(..., TEXTURETYPE_FLOAT)` | `new THREE.DataTexture(data, 48, 64, THREE.RGBAFormat, THREE.FloatType)` → internal format `RGBA32F` |
| `TEXTURE_NEAREST_SAMPLINGMODE` | `minFilter = magFilter = THREE.NearestFilter`, `generateMipmaps = false` |
| `TEXTURE_CLAMP_ADDRESSMODE` | `wrapS = wrapT = THREE.ClampToEdgeWrapping` |
| `textureLoad(tex, vec2i(x,y), 0)` | `texelFetch(charTex, ivec2(x,y), 0)` — core GLSL ES 3.00, **no extension needed**, works on RGBA32F even though it is not linearly filterable |
| `charTex.update(d)` each frame | `tex.needsUpdate = true` (full 48 KiB re-upload) — or, better, a manual `gl.texSubImage2D` over rows 0…38 only |

**Do NOT substitute RGBA16F.** Cloth node positions are *absolute world coordinates* in an ~870 m
world; half-float has ~11 bits of mantissa, so at 800 m the quantisation step is ≈0.5 m and the
garment explodes into blocks. If a 16-bit path is forced, store node positions **relative to the
character root** and add the root back in the vertex shader. Bone matrices have the same problem in
their translation column (row 3).

`EXT_color_buffer_float` is **not** needed for this texture — nothing renders into it. It *is*
needed for the depth prepass render target (`vViewZ` as linear view depth, RG16F/RGBA16F) and for
the shadow cascade maps if they are stored as colour rather than depth.

### 9.2 Shader language mapping

| WGSL | GLSL 3.00 es | Note |
|---|---|---|
| `texture_2d<f32>` + separate `sampler` | `uniform highp sampler2D` | combined sampler; drop the `*Sampler` uniforms |
| `textureSampleLevel(t, s, uv, lod)` | `textureLod(t, uv, lod)` | used for `skyLUT` and the cascades |
| `textureLoad(t, vec2i(x,y), 0)` | `texelFetch(t, ivec2(x,y), 0)` | |
| `vec2i` / `vec3f` / `i32` / `f32` | `ivec2` / `vec3` / `int` / `float` | |
| `mat3x3f(a,b,c)` | `mat3(a,b,c)` | both take **columns**; `TBN[0]` = T, `TBN[1]` = B, `TBN[2]` = N in both |
| `mat4x4f` uniform, column-major | `mat4`, column-major | identical memory layout; the flat `Float32Array` uploads unchanged (`gl.uniformMatrix4fv(..., false, data)` — **transpose = false**) |
| `array<vec4f, 8>` | `uniform vec4 matAlbedo[8];` | dynamic indexing of a **uniform** array is legal in GLSL ES 3.00 |
| `array<mat4x4f, 3>` | `uniform mat4 cascadeMatrices[3];` | |
| `dpdx` / `dpdy` | `dFdx` / `dFdy` | core in ES 3.00 |
| `select(f, t, cond)` | `cond ? t : f` | **argument order is reversed** — WGSL returns `f` when `cond` is false |
| `fract` | `fract` | identical (`x − floor(x)`) for both, including negatives |
| `input.position.xy` (fragment builtin) | `gl_FragCoord.xy` | **y is flipped**: WGSL's builtin origin is top-left, `gl_FragCoord` is bottom-left. Only consumer here is `ign()` for the shadow-disc rotation, so the pattern differs but is statistically identical. If you want bit-parity, use `vec2(gl_FragCoord.x, screenSize.y - gl_FragCoord.y)` |
| `discard` | `discard` | identical (fur only) |
| `inverseSqrt`, `exp2`, `mix`, `smoothstep`, `clamp`, `pow`, `atan2→atan(y,x)` | same names except `atan2` | |
| `let` / `var` | `const`-ish / mutable locals | GLSL has no `let`; just declare |
| `@vertex` / `@fragment` entry `main` | `void main()` | |
| `vertexOutputs.position` | `gl_Position` | |
| No compute shaders needed | — | this subsystem has **no** compute/storage-texture usage; the sim is CPU-side and the GPU work is pure vertex/fragment |
| WebGPU timestamp queries | `EXT_disjoint_timer_query_webgl2` if available, else CPU-only timing | |

The fixed 4×4 loop in `sampleCloth` should be **fully unrolled** in GLSL (16 `texelFetch` calls) —
ES 3.00 supports the loop, but unrolling avoids driver-dependent codegen and lets `wu[i]` be a
compile-time index (dynamic indexing of a local `vec4` is legal but slow on some drivers).

### 9.3 Three.js mesh / material setup

* Use `THREE.RawShaderMaterial` (or `ShaderMaterial` with `glslVersion: THREE.GLSL3`). If you use
  `ShaderMaterial`, **do not redeclare** `position`, `normal`, `uv` — Three injects them; **do**
  declare `aux` (vec2), `boneIdx` (vec4), `boneWt` (vec4).
* `geometry.setAttribute('aux', new THREE.BufferAttribute(auxF32, 2))`, likewise `boneIdx`/`boneWt`
  as **float** vec4 attributes (keep them float, exactly as the reference does — `int(boneIdx.x)`
  in the shader; integer attributes would need `setAttribute` with an `Int32BufferAttribute` and
  `flat` interpolation qualifiers you do not want).
* **Disable Three's own skinning entirely.** Do not use `SkinnedMesh`/`Skeleton`/`bindMatrix` — this
  is custom LBS from a texture. Use plain `THREE.Mesh`.
* `mesh.frustumCulled = false` (≡ `alwaysSelectAsActiveMesh`), `mesh.matrixAutoUpdate = false`,
  `mesh.matrix.identity()`. Set `geometry.boundingSphere = new THREE.Sphere(centre, 1e6)` so
  nothing tries to compute one — for the cloth mesh the `position` attribute is `(u,v,panelIdx)`
  and any computed bounds are meaningless.
* `backFaceCulling = false` → `side: THREE.DoubleSide` on all three character materials. Keep the
  `if (dot(N,V) < 0) N = -N;` flip **instead of** `gl_FrontFacing`; that is the reference behaviour
  and it is robust against the lofts' winding.
* `renderingGroupId = 1` → give the character meshes a `renderOrder` above the terrain, or just
  rely on the opaque sort; they are fully opaque (`alpha = 1.0`) except the fur, which is
  **alpha-tested via `discard`, not blended** — keep `transparent: false`, `depthWrite: true`.
* `computeVertexNormals()` in Three is *already* the reference's area-weighted accumulate-then-
  normalise algorithm, so it is a drop-in replacement for `computeNormals()` **provided** you build
  the geometry as indexed with shared seam vertices (which the loft does). Do not use it on the fur
  — the fur supplies explicit normals (the shell direction).

### 9.4 Multi-pass structure

* **Shadow cascades.** The character registers as a caster into **2 of 3** cascades. Babylon's
  cascade generator is unusable here because the terrain has no CPU geometry matching what is drawn,
  so every caster registers the vertex program it is actually rendered with — the port must do the
  same: one `RawShaderMaterial` per (mesh × cascade), each holding its own `lightViewProjection`,
  and swap `mesh.material` per cascade render (Three has no `Material.defines`-per-draw trick that
  avoids a recompile, so allocate the materials up front, exactly as the reference does with
  `defines: ["CHAR_CASCADE " + c]`). Fur casts **no** shadow (an alpha-tested 22-shell depth pass is
  not cheap, and it would add a fractionally fuzzier edge to a shadow already an order of magnitude
  softer).
* **Depth prepass.** Body and cloth only (fur excluded on the same grounds). Output `vViewZ = clip.w`
  and `vMask = 0.0`. Needs a float colour target → `EXT_color_buffer_float`.
* **Beauty pass.** One draw per mesh (body, cloth, fur). Total character draw calls: 3 beauty + 4
  shadow (2 meshes × 2 cascades) + 2 prepass = **9**.

### 9.5 CPU-side port

`figure.js`, `controller.js`, `build.js`, `mat4.js` port to JavaScript **verbatim** — they touch no
engine API except `Vector3` (trivially swapped for `THREE.Vector3`) and `Scalar.Clamp`. Keep the
flat `Float32Array` + explicit-offset matrix style: the `skin` array is uploaded to the GPU
unmodified, and wrapping each bone in a `THREE.Matrix4` would mean 54 objects plus a flatten copy
per bone per frame.

`Scalar.Clamp(v, lo, hi)` → `Math.min(Math.max(v, lo), hi)`.
`expDamp` and `damp` are the same function; define once.

---

## 10. VISUAL ACCEPTANCE CRITERIA

A harsh critic should be able to decide from screenshots / a short capture whether the port
reproduced this subsystem. Each of these is a *failure mode the reference specifically fixed*.

1. **A planted foot does not move, at all.** Step through consecutive frames while the character
   walks: the stance boot's contact point stays on the *same snow texel* — the same footprint rim,
   the same speck of drift detail — while the pelvis translates over it. Any sub-centimetre creep,
   any "moonwalk" of the sole against the surface, is a fail. The failure signature to look for is
   the boot drifting backward relative to its own footprint as the body advances.

2. **The footprint is stamped centred under the boot, not behind it.** The stamped print (20 cm
   across × 34 cm long, yawed to the facing) must be concentric with the sole on the frame it
   appears. A print offset along the direction of travel means the splat is being driven from the
   controller's `footPos` instead of the figure's `plant`.

3. **Stride length matches ground speed by measurement.** Walk in a straight line across fresh snow
   and measure the gap between consecutive prints of the *same* foot: ≈ **1.32 m** at walking speed
   (2.5 m/s) and ≈ **1.55 m** at a sprint (5.4 m/s). Prints per second must equal `speed / stride`
   at any frame rate. A port with a time-driven gait will show these numbers drifting with
   framerate or with speed.

4. **Walk and run are visibly different gaits, not the same gait sped up.** At walking pace there
   is a window each cycle where **both** boots are on the ground (duty 0.66); at a sprint there is a
   visible **flight phase** where neither is (duty 0.46). Swing-foot clearance also grows from
   ~5.5 cm to ~17.5 cm.

5. **Knees never lock and never bend backwards.** Through the whole stride — including the moment
   of maximum extension at heel strike — the knee holds a visible bend (reach is capped at 0.995 of
   0.81 m) and tracks slightly **outboard** of the hip-to-ankle line, never perfectly sagittal.
   Elbows likewise point back and outboard, and the arms are never two straight poles.

6. **The pelvis and the shoulders counter-rotate.** Viewed from above or from the front at a
   sprint, the pelvis yaws one way (±0.13 rad × run) while the chest yaws the other way at 1.5× the
   magnitude, and the head stays aimed down the direction of travel. A figure whose whole torso
   rotates as one block is a fail — this is most of what stops a procedural walk reading as a shop
   dummy.

7. **The head is stabilised and the hood lags it.** When the figure pitches forward (sprint, and
   especially entering a surf), the head pitches back against the chest by 0.62× and stays much
   closer to level. During a hard direction change the cowl visibly **trails** the skull by a few
   frames before catching up. A hood welded to the head reads as a helmet and is a fail.

8. **The cowl is a deep, peaked hood with a dark interior — not a sphere with a hole.** The
   silhouette must be widest over the crown and tight at the throat; the interior must be markedly
   darker than the exterior (baked AO ramps 0.34 → 0.89 from rim to shoulder) with the skull barely
   readable and a **pale blue scarf band** across the lower face. An evenly lit hood interior, or an
   empty black hole with no scarf, is a fail.

9. **Fur reads as strands, not as a sausage or as stripes.** At the hood rim and both cuffs the trim
   must show individual tapered strands ending at *different* lengths, with roots distinctly darker
   than tips (self-AO 0.16 → 1.0). Neither concentric banding (too few shells) nor a smooth opaque
   tube (alpha test not firing) is acceptable. Against a low sun the fur rim should visibly glow
   from transmission.

10. **The weave exists in close-up and is completely gone at distance.** Within ~1 m of the camera
    the fabric shows a plain weave at 210 threads/m in which warp and weft visibly **alternate over
    and under** — a regular crosshatch grid is the wrong look. By mid-distance it must fade to
    nothing with **no crawling moire** anywhere in between. Coarser centimetre-scale yarn slub must
    still be visible after the weave has faded.

11. **The robe rims pale blue at grazing angles and stays deep navy face-on.** Sheen must appear as
    a *rim* concentrated at the silhouette edge. If it appears as a uniform veil that lifts the
    whole garment toward the value of the snow behind it — erasing the silhouette — the `graze` gate
    or the 0.25 lobe clamp is missing. Conversely, a robe that renders **pale grey whenever the
    camera looks across it** means `envBRDFApprox` was replaced with plain `fresnelSchlickRough`.

12. **The figure is lit from below by the snow.** The undersides of the hem, the mantle's lower
    edge and the underside of an outstretched forearm must carry visible bounce light (40% of the
    zenith irradiance, gated on downward-facing normals). A character whose downward-facing surfaces
    go to black reads as cut-and-pasted into the scene and is a fail.

13. **Both sides of every garment shade correctly.** The inside of the cowl, the underside of the
    hem and any fold seen from behind must be lit, not black or inside-out. There must be no
    culled-away holes — all three character materials are double-sided and the normal is flipped
    toward the viewer per fragment.

14. **Contact shadow stays attached.** Where the boots meet the snow the shadow must touch the sole,
    with no visible gap (`shadowBias = 0.012`, deliberately tighter than the terrain's). A detached
    shadow makes the figure look like it is standing *in* the ground rather than on it.

---

## Appendix A — Constant inventory

Counted as **distinct numeric values bound to an identifier or occupying a table cell** in this
document (repeats of the same literal in different roles are counted once per role, as a port must
reproduce each independently).

| Group | Count |
|---|---:|
| Bone indices + `BONE_COUNT` | 19 |
| `BIND` table (18 × 9) | 162 |
| Declared segment lengths + `HIP_HEIGHT` | 5 |
| Material slot ids `M_*` | 7 |
| `PALETTE` (8 × 4) | 32 |
| `PARAMS` (8 × 4) | 32 |
| Loft machinery (`SEG`, cap ext, cap uv, spineBones thresholds/weights) | 13 |
| Torso rings (8 × 3 + ao) | 25 |
| Belt rings (3 × 4) | 12 |
| Neck rings + weights | 17 |
| Skull generator (`HEAD_C`, 8, 0.105, 0.006, 0.089, 0.096, 0.004×2, ao) | 11 |
| Scarf rings (3 × 5) | 15 |
| Cowl (`HOOD_COLS/ROWS`, `FACE_DIR`, rim, base, control, radius, ao, uv) | 22 |
| Arm lofts (upper 12, fore 12, hand 24) | 48 |
| Leg lofts (thigh 12, shin 40, boot 36) | 88 |
| Fur bands (shells, arc, cols, radii, lengths, offsets, ao) | 19 |
| Cloth panel layout table (4 panels × 10 fields) | 40 |
| Data texture (`TEX_W/H`, `CLOTH_ROW0`, `CHAR_CASCADES`, panelParams slots, derived rows) | 9 |
| Controller constants + integrator/lean/streak/gait literals | 34 |
| Figure poser (attitude, spine, head, hood, arms, legs, IK, feet) | 62 |
| Per-frame uniform values (softness, bias, weave/fur density, fur colour, droop) | 13 |
| Fabric fragment shader literals | 54 |
| Fur fragment shader literals | 21 |
| Shared library (`shading.wgsl` / `noise.wgsl` functions quoted) | 31 |
| Footprint/contact brush parameters read by this subsystem | 12 |
| Derived geometry budget (vertex/triangle counts, reach clamps, stride lengths) | 26 |
| **Total** | **829** |
