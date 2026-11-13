# R4 — Driftwake runtime integration contract for a skinned-mesh enemy renderer

Scope: what a replacement for `src/combat/enemyVis.js` must satisfy to drop into the
place `EnemyVis` occupies today. Read-only investigation; no game file was modified.

All paths relative to `C:\Users\TestRun\Claude Claw\forgeflow-games\games\driftwake`.
Every claim below is cited `file:line` against a file read this session. Where a number
comes from a stored harness artifact rather than a measurement I made this session, it is
labelled **[stored artifact]** and the file is named.

Three.js revision in tree: `172` (`assets/vendor/three/build/three.core.js`,
`const REVISION = '172'`).

---

## 1. The public API the replacement MUST keep

`EnemyVis` is constructed once in `main.js` and late-bound into `Enemies` through
`attachVis`. `Enemies` is null-guarded on `this.vis` at every call site
(`enemies.js:229` `this.vis = null;`), so the visual layer is optional — but every
member below is actually called and must exist with the same signature and the same
side-effect contract.

### 1.1 Construction

```js
// enemyVis.js:254
constructor(scene, sky, shadows, lights, globals)
```
- `scene` — `THREE.Scene`; the ctor `scene.add()`s its own objects (`enemyVis.js:323`,
  `enemyVis.js:338`). Nothing outside adds them.
- `sky` — `render/sky.js` `Sky`; only `sky.uniforms` is consumed (`enemyVis.js:276`).
- `shadows` — `render/shadows.js` `ShadowSystem`; only
  `shadows.receiverUniforms(softness, bias)` is consumed (`enemyVis.js:277`).
- `lights` — `spells/spellLights.js` `SpellLights`; only `lights.uniforms`
  (`enemyVis.js:278`).
- `globals` — the `lib/common` shared block. `main.js:490` passes `spells.globals`,
  which is `{ uSunDir, uSunColor, uCameraPos, uTime, uViewProj, uResolution }`
  (`spells/spellSystem.js:114-121`). These are live boxes written by `spells.update`;
  the enemy renderer must NOT own its own copies of `uViewProj`/`uCameraPos`/`uTime`
  unless it also syncs them (see §4).

Call site, verbatim:
```js
// main.js:490-492
const enemyVis = new EnemyVis(scene, sky, shadows, spells.lights, spells.globals);
enemies.attachVis(enemyVis);
spells.addConsumers(enemyVis.material);
```

`spells.addConsumers(mat)` (`spellSystem.js:198-207`) calls `this.lights.bind(m)` and
"must happen before its program is first built". A replacement therefore must expose
**a material (or a list of materials) that can be handed to `addConsumers` before the
warm-up**. If the replacement uses one shared material this is a single call; if it uses
per-instance materials, all of them must be registered, or the spell-light uniform boxes
will be missing on the ones that were not (see §2.6 for the recommended shared-material
shape that makes this a single call).

### 1.2 `spawn(i, key, x, y, z)` — `enemyVis.js:354`

```js
spawn(i, key, x, y, z)   // i = pool slot 0..SLOT_MAX-1, key = archetype index
```
Semantics as implemented: sets `used[i]=1`, `key[i]=key`, zeroes `yaw/speed01/flash/
lunge/submerge/dissolve`, calls `_configure(i,key)` to build the silhouette, positions
and shows the group (`enemyVis.js:355-367`). **Synchronous, must not throw, must not
return a value the caller inspects** — `enemies.js:365` is `if (this.vis) this.vis.spawn(i, k, x, y, z);`
with no result check. `i` is the `Enemies` SoA index; `key` is `COLD_KEYS.indexOf(name)`
(`enemies.js:317`), i.e. an archetype index into `ARCH_IMP/SPRITE/STALKER/BRUTE`
(`enemies.js:145-148`), **not** a roster slug. A 30-unit roster must either widen this
key space or map slug→key upstream (that is R2/R3 territory, but the renderer's `spawn`
signature is the seam).

### 1.3 `free(i)` — `enemyVis.js:371`

```js
free(i)   // used[i]=0; groups[i].visible=false
```
Called from four places, all `if (this.vis)`-guarded:
- `enemies.js:374` — `clear()`, every live slot
- `enemies.js:444` — `despawn(id)`, the director's silent removal
- `enemies.js:458` — `_brain`, registry slot vanished under the body
- `enemies.js:473` — end of the 1.2 s death dissolve

`free` must be idempotent and safe on a slot that was never spawned.

### 1.4 `drive(i, x, y, z, yaw, speed01, flash, lunge, submerge, dissolve)` — `enemyVis.js:384`

Pure SoA writes; no Three object is touched (`enemyVis.js:385-391`). Called from:
- `enemies.js:1153` inside `_drive(i)` (`enemies.js:1150`), itself called at
  `enemies.js:544` (lifted branch) and `enemies.js:684` (end of every `_brain`).
  Arguments there: `speed01 = min(1, speedNow[i]/row.speed)`, `flash[i]`, `lunge[i]`,
  `submerge[i]`, and **`dissolve` hard-coded 0** (`enemies.js:1156`).
- `enemies.js:468-469` in the `ST_DYING` branch: `drive(i, x, y, z, yaw, 0, 0, 0, submerge[i], d)`
  where `d = min(1, stateT/DEATH_S)` and `DEATH_S = 1.2` (`enemies.js:96`).

Channel meanings (`enemyVis.js:376-383`):

| arg | range | written by | meaning |
|---|---|---|---|
| `yaw` | rad | `enemies._face`, `enemies.js:1085` `atan2(ux,-uz)` | port frame: forward = `(sin f, 0, -cos f)`; the renderer maps it to `rotation.y = -yaw` (`enemyVis.js:430-431`) |
| `speed01` | 0..1 | `enemies.js:1155` | locomotion blend — **this is the only locomotion signal a mixer state machine gets** |
| `flash` | 0..1 | `enemies.js:610-611`, ramp `dt / (row.telegraphMs/1000)` | THE readable telegraph; windup progress |
| `lunge` | 0..1 | `enemies.js:833` set to 1 on strike, decayed `-6*dt` at `enemies.js:528` | strike thrust |
| `submerge` | 0..1 | `enemies.js:798` `+dt/0.4`; decayed at `enemies.js:533` | stalker powder dive |
| `dissolve` | 0..1 | only the dying branch | death, 1.2 s |

The renderer owns the *interpretation*: today `flash` drives core glow in the fragment
shader (`enemyVis.js:193-195`), `lunge`/`submerge` drive group translation
(`enemyVis.js:425-429`), `dissolve` drives vertex shrink (`enemyVis.js:92-94`). A skinned
replacement must map the same five scalars onto clips/poses. Nothing in `enemies.js`
knows what a body looks like (`enemies.js:1-6`), so this table IS the animation contract.

### 1.5 `driveBolt(b, x, y, z, on)` — `enemyVis.js:399`

`b` in `0..BOLT_MAX-1` (`enemyVis.js:50`, `BOLT_MAX = 16`, matching `enemies.js:53`).
Called at `enemies.js:380` (clear, off), `enemies.js:992` (per live bolt per frame, on),
`enemies.js:999` (`_killBolt`, off). Today it positions a pooled shard mesh and spins it
(`enemyVis.js:400-406`). **A skinned-enemy renderer still owes the bolt pool** — this is
projectile VFX, unrelated to skinning, and the simplest correct move is to keep the
existing shard geometry + material for bolts and only replace the bodies.

### 1.6 `update(dt)` — `enemyVis.js:412`

Called once per frame at the END of `enemies.update` (`enemies.js:401`), i.e. after
`_updateBolts`, all 24 `_brain` calls, `_separate` and `_aggroOnDamage`
(`enemies.js:395-401`). Polled, not subscribed (`enemyVis.js:37-39`). Applies SoA state
to Three objects and refreshes `S`-driven shading uniforms (`enemyVis.js:433-434`).
**This is the only per-frame hook the enemy renderer gets**, and it is the slot where a
mixer update / skeleton update must happen. See §4 for why that placement is a problem
for shadow casting and what to do about it.

### 1.7 Members that exist but are DEAD today

`warmUpMeshes` (`enemyVis.js:443`), `warmUp(x,y,z)` (`enemyVis.js:448`),
`finishWarmUp()` (`enemyVis.js:456`), `dispose()` (`enemyVis.js:463`) are **never
called**. Absence claim: `Grep "enemyVis|EnemyVis"` over `**/*.{js,py,html,md}` in the
game directory returns exactly 9 hits — `main.js:116,490,491,492`,
`enemyVis.js:244`, `enemies.js:3,144,228,294` — and none of them is a `warmUp`,
`finishWarmUp`, `warmUpMeshes` or `dispose` call. Compare `main.js:537-540`, which
passes `spells.warmUpMeshes`, `figure.warmUpMeshes()`, `meshChar.warmUpMeshes()`,
`wake.mesh`, `spray.mesh` to `gfx.warmUp` — and no enemy mesh.

**Consequence, and the single most important perf finding in this document: the enemy
material's program has never been compiled or drawn behind the boot screen. The first
enemy spawn in a live session compiles its pipeline mid-frame.** `gfx.js:391-406` and
`shadows.js:606-616` both state why that is a multi-hundred-millisecond freeze on the
ANGLE/D3D11 backend. A skinned replacement MUST be wired into the warm-up (§5.6), and
this is a pre-existing defect the replacement gets to fix rather than inherit.

`enemyVis` is also not exposed on the `SNOWFLOW` global: `main.js:1014-1015` exports
`combat: { registry, spellHits, dummies, enemies, encounters, targeting, data }` — the
visual layer is reachable only as `SNOWFLOW.combat.enemies.vis`. A harness that needs to
probe the new renderer (draw counts per body, clip state) should get an explicit member.

### 1.8 Public data the replacement must keep

`enemies.js` reads nothing back off `vis`, but `EnemyVis`'s own `onBeforeRender`
callbacks read `this.flash[i]` and `this.dissolve[i]` off the SoA
(`enemyVis.js:216-224`). Those arrays are internal. The externally-visible surface is
exactly: ctor, `spawn`, `free`, `drive`, `driveBolt`, `update`, plus `material` for
`addConsumers`. Everything else is free to change.

---

## 2. How `meshChar.js` gets a Draco + skinned GLB onto the screen

This is the only skinned mesh in the project and is the template. Sequence, with line
numbers.

### 2.1 Load

```js
// meshChar.js:370-376
const draco = new DRACOLoader();
draco.setDecoderPath(DRACO_PATH);            // meshChar.js:103 "./assets/vendor/three/examples/jsm/libs/draco/gltf/"
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
const gltf = await loader.loadAsync(GLB_URL); // meshChar.js:102, "?v=" + CHAR_GLB_V
draco.dispose(); // the decoder worker is done; keep zero of it resident
```

Two gotchas the enemy loader inherits:

- **`draco.dispose()` at `meshChar.js:376` tears the decoder down.** A later
  `new DRACOLoader()` re-instantiates the wasm module (`draco_decoder.wasm`, 192,420 B;
  `draco_decoder.js` 512,465 B — `ls assets/vendor/three/examples/jsm/libs/draco/gltf/`).
  Enemies must either share one `DRACOLoader` with `meshChar` or accept the re-init.
  Recommendation: hoist one shared loader; the cheapest correct change is a tiny
  `src/character/gltf.js` that owns one `GLTFLoader`+`DRACOLoader` pair and is disposed
  after the last GLB resolves.
- **Cache-busting is mandatory.** `meshChar.js:96-102`: "the CDN serves this asset with
  max-age=86400, so an in-place swap leaves players on yesterday's file for up to a day".
  Every enemy GLB URL needs its own `?v=` token, bumped on rebuild.

Asset sizes for the boot budget: `assets/char/driftwake_char_web.glb` = **1,228,300 B**
(`ls -la assets/char/`). Enemy GLBs are 247–338 KB each (given), so ten of them ≈ 3 MB,
about 2.4× the rider.

### 2.2 Textures off the stock material, then discard it

```js
// meshChar.js:389-397
const std = mesh.material;                 // MeshStandardMaterial from GLTFLoader
const map = std.map;
const normalMap = std.normalMap;
const mrMap = std.metalnessMap || std.roughnessMap;
if (!map || !normalMap || !mrMap) throw new Error("... missing one of its three maps");
this._maps.push(map, normalMap, mrMap);
std.dispose(); // textures survive material disposal
```

The stock material is unusable because **this scene has no `THREE.Light` at all**
(`main.js:178-180` "No stock lights and no background"), so a `MeshStandardMaterial`
"evaluates Three's light uniforms — all zero here — and renders BLACK"
(`shaders/meshChar.glsl.js:12-18`).

**For enemies the three-map guard must be relaxed to one map.** The enemy GLBs ship a
single base-colour JPEG (given), so `normalMap` and `metalnessMap/roughnessMap` are
`null` and `meshChar.js:393` would throw. See §2.7 for the reduced shader.

### 2.3 Skinning plumbing — two uniforms, nothing else

```js
// meshChar.js:400-403
const skeleton = mesh.skeleton;
if (skeleton.boneTexture === null) skeleton.computeBoneTexture();
this._uBoneTex.value = skeleton.boneTexture;
this._uBindMatrix.value = mesh.bindMatrix;
```

Why only two: the SkinnedMesh stays in Three's default `attached` bind mode, so
`bindMatrixInverse` tracks the node's own inverse world matrix and the stock chain
`model * bindMatrixInverse * (Σ w·bone) * bindMatrix` collapses to
`(Σ w·bone) * bindMatrix` — the bone matrices are already world-space because the bones
live under the root group the owner moves (`shaders/lib/meshSkin.glsl.js:18-29`). No
`modelMatrix` uniform anywhere in the four programs.

**This collapse is what makes the shadow/prepass proxies correct.** Those proxies are
plain `THREE.Mesh`es built by `registerCaster` (`shadows.js:322`, `depthPass.js:201`);
the renderer only auto-binds skinning uniforms on `isSkinnedMesh` objects, and a proxy's
own `matrixWorld` is the identity (`meshSkin.glsl.js:26-29`, `shadows.js:326-328`).
Everything the depth stage needs arrives through `material.uniforms`.

Chunk consumed: `lib/meshSkin`, registered at `shaders/registry.js:130`. Public surface
(`meshSkin.glsl.js:39-41`):
```glsl
mat4 meshBoneMatrix(float i);
vec3 meshSkinPoint(vec3 p, vec4 idx, vec4 wt);   // -> world position, metres
vec3 meshSkinNormal(vec3 n, vec4 idx, vec4 wt);  // -> world normal, unit
```
The weight renormalisation at `meshSkin.glsl.js:81` (`/ max(1e-4, wt.x+wt.y+wt.z+wt.w)`)
exists because a quantised `WEIGHTS_0` accessor summing to 0.998 would shrink the figure
— Draco-compressed enemy weights have the same property, so **reuse `lib/meshSkin`
verbatim; do not write a second skinning chunk.**

`skeleton.update()` is called by the OWNER, every frame, after the root moves
(`meshChar.js:662`), with the reason spelled out at `meshChar.js:76-79`: "the renderer
only refreshes skeletons while traversing scenes that contain the SkinnedMesh itself, and
the frame's first consumers are the shadow cascades, whose proxy scenes do not."

### 2.4 Beauty material — uniform assembly order

```js
// meshChar.js:407-432
this.material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: shader(MESH_CHAR_VERTEX),
    fragmentShader: shader(meshCharFragment({ spellLights })),
    uniforms: Object.assign(
        {},
        this.globals,                      // uSunDir uSunColor uCameraPos uViewProj
        this.sky.uniforms,                 // uSkyLUT uSkySH uAmbientIntensity uFog  (sky.js:199-207)
        this.terrain.shadingUniforms,      // sssStrength sssRadius glintIntensity glintGrazing (terrain.js:250-255)
        this.shadows.receiverUniforms(SHADOW_SOFTNESS, SHADOW_BIAS),   // shadows.js:347-359
        { boneTexture, bindMatrix, baseColorMap, normalMap, metalRoughMap }
    ),
    side: THREE.DoubleSide,
    transparent: false, depthTest: true, depthWrite: true,
    blending: THREE.NoBlending,
});
```

Order matters only for collisions; there are none between those five groups. The rules:

- `globals` LAST-WINS is irrelevant, but `sssStrength` is declared by `lib/shading`
  (`shaders/lib/shading.glsl.js:106-109`), **not** by the fragment stage
  (`meshChar.glsl.js:152` says so explicitly). Something must supply it or the uniform is
  unbound. `meshChar` borrows `terrain.shadingUniforms`; `EnemyVis` builds its own
  four-key `_shading` object instead (`enemyVis.js:259-264`) and refreshes two of them
  per frame (`enemyVis.js:433-434`). Either is fine — pick one and refresh it.
- `shadows.receiverUniforms(softness, bias)` returns the WHOLE `lib/shadowLookup` block
  with the matrices, params and cascade textures **shared by reference** across every
  receiver (`shadows.js:70-74`), so `shadows.update()` reaches all of them with no
  per-material bookkeeping. Per-material values from `_spec/shadows.md §6.5` are quoted
  at `shadows.js:339-341`: character/cloth/fur 1.4 / 0.012, crystals 1.3 / 0.012.
  `meshChar` uses `1.4 / 0.012` (`meshChar.js:116-117`); `EnemyVis` uses `1.3 / 0.012`
  (`enemyVis.js:56-57`). **A skinned enemy is a character, so take 1.4 / 0.012.**
- Spell lights are NOT in the ctor for `meshChar`; they are installed afterwards by
  `spells.addConsumers(meshChar.material)` at `main.js:432`, with the comment "must
  precede the warm-up so the boxes are installed before the program first builds".
  `EnemyVis` does both — `lights.uniforms` in the ctor (`enemyVis.js:278`) AND
  `addConsumers` at `main.js:492`. `addConsumers` is a no-op for a material that already
  has the boxes (`spellLights.js:25-26`, `spellSystem.js:201-205`), so doing both is
  safe. Recommendation: do both, exactly as `EnemyVis` does — it means the material is
  correct even if the `addConsumers` line is ever dropped.

Object flags:
```js
// meshChar.js:436-439
mesh.name = "meshChar";
mesh.frustumCulled = false;  // bounds are bind-pose; the rig roams
mesh.raycast = () => {};
mesh.renderOrder = 1;        // above the terrain, like the figure
```
- `frustumCulled = false` because a SkinnedMesh's bounding volume is computed from the
  BIND pose and the rig leaves it. For 24 pooled enemies this is a real decision:
  leaving it false means 24 draws are always submitted for visible slots. **Recommended
  for enemies: keep `frustumCulled = false` on the SkinnedMesh (correctness), and do the
  culling yourself in `update()` by setting `mesh.visible = false` on slots outside a
  distance/frustum test** — the same lever `shadows.render` and `depthPass.render`
  already honour (`shadows.js:584`, `depthPass.js:258`), so one write hides the body in
  all three passes.
- `renderOrder = 1` is the terrain/crystal band. `EnemyVis` uses the same
  (`enemyVis.js:317`, `enemyVis.js:335`) and `dummies.js:274-276` documents the slot:
  "after the terrain, before the water and the spray". Keep 1.
- `DoubleSide` on `meshChar` is justified at `meshChar.js:427-429`: "Hood interior and
  sleeve openings show their backs; the fragment turns N toward the viewer". The
  fragment does `if (dot(N, V) < 0.0) N = -N;` (`meshChar.glsl.js:186-187`).
  **For enemies this reasoning does not automatically hold.** A Meshy watertight body has
  no thin shells, so `THREE.FrontSide` is the cheaper and equally correct choice and
  halves rasterised triangles on the beauty pass. Caveat: the caster materials must stay
  DoubleSide regardless — `shadows.js:279-282` and `depthPass.js:170-172` set it and say
  why ("a one-sided cloth panel or wake sheet would otherwise drop out of the map"), and
  `makeCasterMaterial` sets it for you.

### 2.5 Root transform and scale

`this.root` is a `THREE.Group` with `rotation.order = "YXZ"` (`meshChar.js:232-237`) so
carve-roll (z) and attack-pitch (x) compose in MODEL space before the yaw. `SCALE = 0.97`
is derived from a probed native height (`meshChar.js:105-113`). The root is positioned
from the controller each frame and `updateMatrixWorld(true)` is called before
`skeleton.update()` (`meshChar.js:648-662`).

For enemies the equivalent per-slot transform is the group `EnemyVis` already keeps
(`enemyVis.js:309`, positioned at `enemyVis.js:425-431`), plus `sizeScale` from the
roster (`_build_roster_html.py` ENEMIES, per the brief). Port-frame yaw mapping is
`quaternion.setFromAxisAngle(UP, -yaw)` (`enemyVis.js:430-431`) — note this differs from
`meshChar`'s `rotation.y = Math.PI - ch.facing` (`meshChar.js:653`), which is documented
as correct because "Model front is +Z; port forward at facing f is (sin f, 0, -cos f).
R_y(PI - f) maps +Z onto exactly that vector" (`meshChar.js:651-652`; the asset's +Z
front is also stated at `meshSkin.glsl.js:47`).

**INFERRED, NOT VERIFIED — check this first, visually, on the first enemy that renders.**
The shard placeholder is radially symmetric so `-yaw` never showed an error there. If the
enemy GLBs carry the same mixamorig +Z front as the rider (they are mixamorig-skeletoned
per the brief, but I did not open one this session), the enemy renderer must use
`Math.PI - yaw`, not `-yaw`, or every body faces backwards. This is the single
highest-risk one-line error in the port, and it is a one-frame visual check, not an
argument.

### 2.6 Shared material vs per-instance material

`EnemyVis` uses ONE `RawShaderMaterial` for all 280 objects and varies per-draw state
through a single `vec4` uniform written by a module-scope `onBeforeRender`
(`enemyVis.js:216-224`, design rationale `enemyVis.js:24-29`). `this` is the mesh, bound
state lives on the mesh (`_vis`, `_slot`, `_core`, `_seed` at `enemyVis.js:315-320`), so
there are zero closures and zero per-frame allocations.

**A skinned enemy cannot share a material across instances**, because `boneTexture` and
`bindMatrix` are per-skeleton uniforms and Three uploads uniforms per material, not per
draw. Two workable shapes:

1. **One material per resident archetype** (recommended). All instances of one slug share
   geometry, and if there is only ever ONE live instance of that slug at a time they can
   also share the material. With N instances of the same slug you need N materials — or:
2. **`onBeforeRender` swaps the two uniform values** before each draw, exactly the
   `_writeShardState` trick. `material.uniforms.boneTexture.value = this._boneTex;`
   inside `onBeforeRender` works, and Three's uniform cache re-uploads the sampler
   binding and the mat4. This keeps ONE material (hence ONE `addConsumers` call, ONE
   program, ONE `spells.addConsumers`) for arbitrarily many instances. It is the same
   mechanism the shard material already uses and it is the shape I recommend, with the
   caveat that a texture-unit rebind per draw is more expensive than a `vec4` and should
   be measured.

Either way, the **caster** materials are per-instance regardless (each needs its own
`boneTexture`/`bindMatrix`), which is fine: Three's program cache keys on source +
defines, so 24 identical-source caster materials share ONE compiled program.

### 2.7 The REDUCED enemy fragment variant — exactly what drops out

`meshCharFragment(opts)` (`shaders/meshChar.glsl.js:139-269`) is the full variant. With
only a base-colour JPEG available, the enemy variant must drop:

**Uniforms removed**
| dropped | declared at | why |
|---|---|---|
| `uniform sampler2D normalMap;` | `meshChar.glsl.js:150` | GLB has no normal map |
| `uniform sampler2D metalRoughMap;` | `meshChar.glsl.js:151` | GLB has no metallic-roughness map |

**Uniforms KEPT (all of them)** — `baseColorMap` (`:149`), and every uniform that arrives
through `globals` / `sky.uniforms` / `shadingUniforms` / `receiverUniforms` /
`spellLights`. `sssStrength` is still required because `backScatter` is still used
(§below) and `lib/shading` declares it (`shading.glsl.js:106`).

**Code removed**
- The whole normal-mapping block, `meshChar.glsl.js:196-202`: `dp1`/`dp2`/`duv1`/`duv2`
  derivatives, the `nm` tap, and `N = normalize(cotangentFrame(...) * nm)`.
- The `cotangentFrame` helper itself, `meshChar.glsl.js:169-176`, becomes dead — delete
  it. (It exists only because "no authored tangents survive the Draco round trip",
  `meshChar.glsl.js:167-168`.)
- The `mrTap` read and its two derived scalars, `meshChar.glsl.js:192-194`.

**Code changed**
- `float roughness = clamp(mrTap.x, 0.06, 1.0);` → a constant. Value: these are ice/
  bone/hide constructs, so `0.55` is a defensible single value; expose it as a
  `uniform vec2 uEnemyMR` (roughness, metallic) written per-draw from the roster row if
  per-archetype variation is wanted — that is one more `vec2` in the same
  `onBeforeRender` box and costs nothing.
- `float metallic = mrTap.y;` → `0.0` for organic bodies. `f0 = mix(vec3(0.04), albedo, metallic)`
  (`meshChar.glsl.js:229`) then collapses to `vec3(0.04)`, which the compiler folds.
- `vec3 N = normalize(vNormal); if (dot(N,V) < 0.0) N = -N; vec3 geoN = N;`
  (`meshChar.glsl.js:186-188`) stays as-is and `N` is now used for BOTH the geometric
  and the shading normal — the `geoN` local becomes redundant but keeping it costs
  nothing and keeps the diff readable against `meshChar.glsl.js`.

**Everything else stays, verbatim** — this is what makes an enemy sit in the same light
as the rider instead of looking pasted on: `sunShadow` (`:211`), `wrapDiffuse(NdotL,0.18)`
(`:219`), `backScatter(N,L,V,0.4,4.0,1.0) * 0.06 * sssStrength` (`:225-226`), the GGX
direct lobe (`:230-238`), `skyIrradiance(N)` + the 0.40 snow-bounce up-term (`:244-247`)
— the comment at `meshChar.glsl.js:242-243` ("a figure on an 85%-albedo field is lit from
below almost as much as from above — leaving it out is what makes composited characters
look cut out") applies with full force to enemies — `skySpecular(R, roughness) *
envBRDFApprox(...) * uAmbientIntensity` (`:251-253`), the optional spell-light term
(`:254-262`), and `color = aerial(color, world)` LAST before the write (`:264`).

**Varyings**: `BEAUTY_VARYINGS` (`meshChar.glsl.js:45-50`) is `vWorld, vNormal, vUV,
vViewDist` = 4 interpolant vectors against a measured `MAX_VARYING_VECTORS` of 30. The
reduced variant needs all four unchanged (`vUV` still feeds `baseColorMap`,
`vViewDist` still feeds `sunShadow`). Vertex stage `MESH_CHAR_VERTEX`
(`meshChar.glsl.js:60-82`) can be reused **byte for byte**.

**The two depth stages can also be reused byte for byte**: `MESH_CHAR_DEPTH_VERTEX`
(`meshChar.glsl.js:89-102`) and `MESH_CHAR_PREPASS_VERTEX` (`:109-125`) declare only
`position`, `skinIndex`, `skinWeight` plus one projection matrix — no maps, no UVs. The
prepass one emits `vMask = 0.0` (`:123`), which is right for enemies too (no
specular/SSR mask). **Net new shader code for enemies: one fragment stage. Three vertex
stages come for free.**

`transparent: false`, `blending: NoBlending`, `depthWrite: true` — copy `meshChar`
(`:430-432`), NOT `EnemyVis`, whose `transparent: true` + `NormalBlending`
(`enemyVis.js:284-288`) exists only because translucent ice shards must blend over snow.
An opaque skinned body in the transparent bucket sorts per-frame for nothing.

---

## 3. Shadows and the depth prepass

### 3.1 Current answer: enemies do NEITHER

Absence claim, with the search: `Grep "registerCaster|registerShadows|registerPrepass"`
over `src/` returns 34 hits. The registering subsystems are `figure` (`main.js:388`,
`character.js:368,373,447`), `wake` (`main.js:401`, `surfWake.js:331,389`), `spells`
(`main.js:417`, `crystals.js:135,171`), `meshChar` (`main.js:428-429`,
`meshChar.js:589,597`), `terrain` (`terrain.js:329,340`) and `dummies`
(`dummies.js:283`). **`enemyVis.js` appears nowhere in that list**, and
`main.js:490-492` — the only three lines that touch `enemyVis` — contain no registration
call.

So today: enemy shard bodies **receive** shadows (they hold the full
`receiverUniforms` block, `enemyVis.js:277`, and call `sunShadow` at
`enemyVis.js:141`) but **cast none**, and they are **absent from the depth prepass**, so
every screen-space consumer — TAA reprojection, DoF circle-of-confusion, light-shaft
occlusion, SSR — sees background depth where an enemy is
(`depthPass.js:3-8`, `depthPass.js:92` `DEPTH_FAR = 9000`). Under TAA that means enemy
pixels reproject against the terrain behind them: ghosting/smearing on every moving
enemy. This is a real existing visual defect that the replacement should close.

### 3.2 What a skinned mesh must do to join the cascades

Quoting the requirement (`shadows.js:36-48`): the material must be "a RawShaderMaterial
running THE SAME VERTEX PROGRAM the beauty pass runs, differing only in the projection
matrix and the fragment stage. It must declare `uniform mat4 lightViewProjection` and
have it in `material.uniforms` as a THREE.Matrix4". `registerCaster` hard-fails
otherwise (`shadows.js:310-317`). `makeCasterMaterial` wires all of that
(`shadows.js:268-287`).

The working pattern, verbatim from `meshChar`:
```js
// meshChar.js:596-613
registerShadows() {
    this.shadows.registerCaster(
        this.mesh,
        (c) => {
            const mat = this.shadows.makeCasterMaterial(MESH_CHAR_DEPTH_VERTEX, {
                boneTexture: this._uBoneTex,
                bindMatrix: this._uBindMatrix,
            }, { defines: { MESH_CHAR_CASCADE: c } });
            mat.name = "meshCharDepth" + c;
            this._depthMats.push(mat);
            return mat;
        },
        CHAR_CASCADES     // meshChar.js:120 = 2
    );
}
```
The factory form gives one material per cascade so each can carry its own `#define`,
"which forces a distinct compiled program per cascade" (`shadows.js:42-45`).

Mechanics that constrain the enemy design:
- `registerCaster` shares the beauty geometry, sets `proxy.frustumCulled = false` and
  `proxy.matrixAutoUpdate = false` (`shadows.js:322-328`), and adds the proxy to a
  per-cascade proxy `THREE.Scene` with `matrixWorldAutoUpdate = false`
  (`shadows.js:207-211`).
- **Visibility is the ONLY per-frame gate**: `shadows.render()` does
  `entry.proxy.visible = entry.mesh.visible;` (`shadows.js:584`) and
  `depthPass.render()` does the same (`depthPass.js:258`). Hide the beauty mesh and its
  shadow goes with it — "one flag, not two" (`shadows.js:583`).
- **There is no unregister.** `Grep` over `shadows.js` shows `registerCaster` at
  `:297` and no removal method; the same for `depthPass.js:195`. Therefore the enemy
  renderer must register a FIXED POOL of casters ONCE at load and gate them with
  `mesh.visible`. It cannot register per spawn.
- `cascades` count: default 3 (`shadows.js:298`), `SPLITS = [26, 95, 330]`
  (`shadows.js:104`). Existing choices, quoted at `shadows.js:56-58`: "Character 2,
  cloth 2, wake 2, crystals 2, terrain 3", with the argument that "cascade 2 covers
  330 m at 32 cm per texel, where the whole figure is two texels wide". Shell fur is
  deliberately not registered at all (`shadows.js:57-61`) and dummies are registered for
  shadows but deliberately NOT for the prepass, with the cost stated
  (`dummies.js:292-294`).

### 3.3 Prepass

```js
// meshChar.js:582-590
registerPrepass(depth) {
    const mat = depth.makeCasterMaterial(MESH_CHAR_PREPASS_VERTEX, {
        boneTexture: this._uBoneTex, bindMatrix: this._uBindMatrix,
    });
    mat.name = "meshCharPrepass";
    this._prepassMat = mat;
    depth.registerCaster(this.mesh, mat);
}
```
ONE material, no per-cascade multiplicity (`depthPass.js:29-31`). `viewProjection` is
shared by reference and recomputed per frame from the jittered camera
(`depthPass.js:144`, `depthPass.js:253-255`), which is why it "MUST be the same matrix
the beauty pass uses, TAA jitter included" (`depthPass.js:35-40`).

### 3.4 Recommendation for enemies

- **Prepass: YES, register all pool slots.** 1 draw per visible enemy; closes the TAA
  ghosting hole. Vertex stage is free (reuse `MESH_CHAR_PREPASS_VERTEX`).
- **Cascades: cascade 0 only (`cascades = 1`) for standard bodies; 2 for bosses**
  (`roster.boss` / `sizeScale > 1.5`). Cascade 0 covers to 26 m (`shadows.js:104`),
  which is inside the whole melee/telegraph band (`enemies.js` reaches are 1.2–4 m and
  perception 15–30 m, `enemies.js:174-208`). Cutting cascade 1 halves the enemy
  shadow-pass cost, and the deleted shadow is on a body at 26–95 m where
  `shadows.js:53-55`'s own texel-density argument is already biting. This is the one
  choice in this document I would A/B before committing.
- The receiver params for the beauty material: `1.4 / 0.012` (character band,
  `shadows.js:339-341`).

---

## 4. The per-frame slot, and every ordering constraint that touches it

### 4.1 Where the enemy renderer runs today

`main.js` `frame()`:
```
619  character.update(dt, rig)
624  figure.update(dt)
628  meshChar.update(dt)          <- mixer + pose layer + skeleton.update()
629  contact.update(dt)
633  rig.update(...)
639  post.update(...)             <- jitters the projection; FREEZES it for the frame
640  sky.update(); 641 sky.render(rig.camera, time)
645  shadows.update(rig.camera, sky.sunDir, post.projectionUnjittered)
649  spells.update(dt, rig.camera.position, rig.camera)   <- writes spells.globals
652  registry.update(dt)
653  spellHits.update(dt)
654  dummies.update(dt)
655  enemies.update(dt)           <- ends with vis.update(dt)   [enemies.js:401]
656  encounters.update(dt)
659  targeting.update(dt); 660 progression.update(dt)
671  deform.update(dt, character.position)
674  terrain.update(rig.camera, character.position, time)
679  figure.sync(rig.camera)
680  meshChar.sync(rig.camera)
683  wake.update(dt, rig.camera); 684 spray.update(dt, rig.camera)
687  drawFrame()   ->  573 shadows.render(); 574 depthPass.render(); 588 renderer.render(scene, camera); 592 post.render()
701  endFrameDraws()
```

So the enemy visual's per-frame slot is **inside `enemies.update`, at `main.js:655`** —
after `shadows.update` (good) and after `spells.update` (good), and before
`drawFrame()` (essential).

### 4.2 Constraints from `main.js`'s docblock (`main.js:19-62`) that touch this slot

1. **`post.update` (`main.js:639`) jitters the projection and is "the single place
   `updateProjectionMatrix()` is called in a frame — Three has no
   `freezeProjectionMatrix`, so the discipline is the freeze"** (`main.js:29-36`). The
   enemy renderer runs at 655, after the freeze, so anything it derives from the camera
   is on the same subpixel as the beauty pass. It must NOT call
   `updateProjectionMatrix()`.
2. **`spells.update` AFTER the shadow refit** (`main.js:38-42`, `main.js:645-649`): the
   shared `spells.globals` boxes are written at 649 with this frame's camera. The enemy
   renderer at 655 reads them already-correct — **which is exactly why it must be handed
   `spells.globals` and not own its own copies.** `EnemyVis` gets them by reference
   (`main.js:490`) and never syncs anything (there is no `enemyVis.sync`). A replacement
   that owns its own `uViewProj`/`uCameraPos` (as `meshChar` does, `meshChar.js:347-352`)
   MUST add a `sync(camera)` call in `main.js` next to `meshChar.sync` at
   `main.js:680`, after the shadow refit, "so the figure's uniforms carry this frame's
   cascade matrices rather than last frame's" (`main.js:677-678`). **Recommendation: keep
   the `spells.globals` by-reference wiring and add no sync call.** Fewer moving parts,
   and it is the existing contract.
3. **`skeleton.update()` must run before the cascades.** `meshChar.js:76-79` and
   `meshChar.js:660-662`: the shadow cascades are the frame's first consumers and their
   proxy scenes contain no SkinnedMesh, so the renderer will not refresh skeletons for
   them. `enemies.update(dt)` at 655 is well before `drawFrame()` at 687, so calling
   `mixer.update(dt)`, `group.updateMatrixWorld(true)` and `skeleton.update()` inside
   `vis.update(dt)` satisfies this. **Order inside `vis.update` is fixed and
   non-negotiable: (a) write group transforms from the SoA, (b) `mixer.update(dt)`,
   (c) `group.updateMatrixWorld(true)`, (d) `skeleton.update()`.** `meshChar` does
   exactly this at `meshChar.js:636-662`.
4. **`registry.update → enemies.update → spells.update` is COMBAT's stated order**
   (`enemies.js:40-44`) — but note `main.js` actually runs `spells.update` at 649
   BEFORE `enemies.update` at 655, and `enemies.js:40` says "registry.update(dt) →
   enemies.update(dt) → spells.update". That is a doc-vs-code divergence in an existing
   file. It is **out of scope for R4 and I am not touching it**, but flagging it: the
   comment at `enemies.js:41-44` explains the consequence ("kills from the player's
   spells ... are detected next frame by the `hp[slot] <= 0` check"), so the code order
   is the intended one and the comment's arrow is what is stale.
5. **`dt === 0` is a strict no-op for combat** (`enemies.js:46`, `enemies.js:391-392`
   `if (dt <= 0) return;`). This is `S.freezeTime`, which the FFG shell's pause and the
   title menu both use (`main.js:930-937`, `main.js:992`). **Consequence: `vis.update`
   is not called at all while paused, so the enemy renderer must be pixel-stable with no
   update — mixers frozen, no `Math.random()` on the frame path.** `EnemyVis` satisfies
   this because its motion is `sin(this._time * ...)` and `_time` only advances in
   `update` (`enemyVis.js:413`). A mixer-driven replacement satisfies it automatically:
   `mixer.update(0)` is never even called.
6. **Allocation: zero on the frame path** (`main.js:75-77`, `enemies.js:7-11`,
   `enemyVis.js:28-29`, `meshChar.js:80-83`). No closures created per frame, no
   `new`, no array literals, no string concatenation. `meshChar`'s deterministic idle
   scheduler exists specifically because "the render harnesses depend on repeatable
   frames" and therefore uses no `Math.random` (`meshChar.js:328-330`) — enemy clip
   selection should follow that rule for any variation picker.

### 4.3 Draw-order slot in the beauty pass

`renderOrder = 1` (`meshChar.js:439`, `enemyVis.js:317`, `dummies.js:274-276`):
after the terrain, before the water and the spray. Opaque + `NoBlending` means Three
sorts it into the opaque bucket, front-to-back, which is what you want.

---

## 5. PERF BUDGET

### 5.1 Where draw calls are measured

`installDrawCounter(renderer)` at `main.js:172` (before any render, as
`main.js:170-171` requires) sets `info.autoReset = false` and `info.reset()`
(`perf.js:143-149`) — because autoReset "zeroes the counters at the top of every
`renderer.render()`; this frame issues a dozen of those (deform, three cascades,
prepass, beauty, the whole post chain), so the overlay would end up reading only the
last pass" (`perf.js:109-114`).

`endFrameDraws()` at `main.js:701` latches:
```js
// perf.js:166-171
stats.drawCalls = info.render.calls;
stats.triangles = info.render.triangles;
info.reset();
```
Exposed as `SNOWFLOW.perfStats` (`main.js:1026`). Warm-up draws are discarded by the
explicit `endFrameDraws()` at `main.js:561`.

Per-pass GPU timing is `S.debugProfile` → `gpuBegin/gpuEnd` (`perf.js:381`,
`perf.js:408`), read back via `SNOWFLOW.perfProfile()` (`main.js:1045`).

### 5.2 Current baseline **[stored artifact — not measured this session]**

`_harness/audiocost.json`, ultra, 6 reps: `draws` 24, 24, 25, 24, … ; `tris` 1,732,340;
`median_ms` 87.1–92.7; `gpu_ms` 76.7–78.7.

`_shots/SCOREBOARD.md` round 8: "`bootcheck.py` OK (SNOWFLOW members=26, phase 'ready',
**24 draws / 1,732,340 tris**)"; preset rungs at 1280×720 — ultra 122.85 ms / 8.1 fps
(24 draws), high 119.90 ms (identical to ultra by construction), balanced 96.80 ms
(23 draws, 1088×612), performance 58.35 ms / 17.1 fps (19 draws, 640×360). Same file:
"60 FPS (16.67 ms) IS NOT REACHABLE on this GPU at any rung".

`_harness/abprobe.json`, BASE-idle per-pass GPU ms: beauty 49.61, shadow cascade 1
11.69, cascade 0 7.30, depth prepass 4.84, cascade 2 4.69, deform sim (2048²) 4.54,
post chain ≈ 6.7 total. **The frame is beauty-bound and fill-bound, not draw-call-bound.**

### 5.3 What the CURRENT placeholder costs when enemies are alive

`EnemyVis` builds `SLOT_MAX = 24` groups (`enemyVis.js:49`) of `SHARD_MAX + 1 = 11`
children each (`enemyVis.js:311`) plus 16 bolt meshes (`enemyVis.js:330-340`) = **280
`THREE.Mesh` objects resident in the scene**, all invisible at rest. Each child is its
own draw call (shared geometry + shared material, but separate meshes). Visible children
per archetype, from `_configure` (`enemyVis.js:483-561`): imp 6+1 = 7, sprite 8+1 = 9,
stalker 7+1 = 8, brute 10+1 = 11.

So the placeholder at 8 concurrent brutes = **88 beauty draws**; at the full 24-slot pool
= **264 beauty draws**, on a 24-draw baseline. A skinned renderer is **1 draw per body**
— i.e. the replacement is a large draw-call REDUCTION in the beauty pass, and the only
new draws it adds are the ones the placeholder never paid: prepass and cascades.

### 5.4 Concurrency ceiling

`ENEMY_MAX = 24` (`enemies.js:52`) is the pool. The DIRECTOR's real ceiling is lower:
`MAX_PACK = 8` (`encounters.js:115`) with the comment "Blip pool size. Registry MAX is 96
but **live enemies are capped at 8**" (`encounters.js:116-117`), and the §6.2 pack tables
run budgets 2–14 with unit lists sized to that (`encounters.js:132-146`). So: **8
typical, 24 hard**.

### 5.5 The hard budget

Bone counts are 34–46 joints per enemy (given). Enemy triangle counts are **not measured
this session** — the 247–338 KB Draco payloads do not translate to a tri count without
decoding. The budget below is therefore stated as caps, and **measuring the decoded tri
count per slug is a prerequisite of R3, not an assumption of R4.**

| item | budget | basis |
|---|---|---|
| Enemy draw calls, beauty | ≤ 1 per visible body; ≤ 24 total | one SkinnedMesh per slot |
| Enemy draw calls, prepass | ≤ 1 per visible body; ≤ 24 total | `depthPass.js:29-31`, one material |
| Enemy draw calls, cascades | 1 × cascade 0 per visible body (2 for bosses); ≤ 30 total | §3.4 |
| **Total added draws** | **≤ +72 at pool-full, ≤ +24 at the 8-body director ceiling** | sum of the three above |
| **Frame draw ceiling** | **96 draws** (24 baseline + 72) | must be asserted by `bootcheck.py`-style probe |
| Enemy triangles on screen | ≤ 250,000 (14% of the 1,732,340 baseline) | keeps the beauty pass's 49.6 ms from moving by more than ~7 ms at proportional cost |
| Concurrent `AnimationMixer`s updated per frame | ≤ 8 | `encounters.js:115-117` |
| Mixers allocated | 24 (pool), 16 of them idle and skipped by `if (!used[i]) continue` | mirrors `enemyVis.js:416` |
| Bone-texture uploads per frame | ≤ 8 × 16×16 RGBA32F = 8 × 4 KB = **32 KB/frame** | 46 bones × 4 texels = 184 → `computeBoneTexture` rounds to 16×16 |
| Per-frame allocation | **zero** | `main.js:75-77`, `enemyVis.js:28-29` |

### 5.6 Techniques already in this codebase that the enemy renderer MUST reuse

1. **Shared material + `onBeforeRender` uniform box.** `enemyVis.js:216-232` — module-
   scope callbacks, bound state on the mesh, zero closures, Three's uniform cache
   re-uploads only the changed floats. Use it for the per-draw
   `boneTexture`/`bindMatrix`/`(roughness, metallic)` swap (§2.6).
2. **SoA + polled update.** `enemyVis.js:37-39`, `enemies.js:238-283`. `drive()` writes
   typed arrays; `update()` applies them once. No subscriptions, no events.
3. **Pooling with a visibility gate.** `enemyVis.js:308-326` + `shadows.js:584` +
   `depthPass.js:258`. Register the pool once (there is no unregister, §3.2), gate with
   `mesh.visible`.
4. **Warm-up: compile AND draw.** `gfx.warmUp` (`gfx.js:414-452`) attaches detached
   meshes, `await renderer.compileAsync(scene, camera)`, then renders into a 16×16
   depth-attached target, then restores visibility exactly. `shadows.warmUp`
   (`shadows.js:618-623`) and `depthPass.warmUp` (`depthPass.js:288-291`) do the same
   for their scenes. The reason is quoted at `gfx.js:396-403`: ANGLE/D3D11 "defer the
   real specialisation until the first draw that actually binds the VAO". Wire the enemy
   meshes into `main.js:537-540`'s mesh list and add an `enemyVis.warmUp(x,y,z)` /
   `finishWarmUp()` pair around the warm frames at `main.js:551-558`, exactly as
   `spells.warmUp`/`spells.finishWarmUp` (`main.js:533`, `main.js:557`) do. **The
   existing `EnemyVis.warmUp`/`finishWarmUp`/`warmUpMeshes` were written for this and
   are simply not called (§1.7) — the replacement must be called.**
5. **`S`-driven shading refresh in `update`.** `enemyVis.js:433-434`, `terrain.js:449-453`.
6. **Manual weight ramps, not `fadeIn/fadeOut`.** `meshChar.js:44-47`: "every action is
   `.play()`ed once at load and stays scheduled at weight ≥ 0, which keeps the per-frame
   path allocation-free — `AnimationAction.fadeIn/fadeOut` build an interpolant per call,
   and a weight-0 action costs the mixer one early-out test." **This is the single most
   important CPU rule for 8 concurrent mixers.**
7. **`clampWhenFinished = true` on every `LoopOnce` action.** `meshChar.js:475-484`
   documents the failure: "an unclamped LoopOnce DISABLES itself at its last frame, and
   if that lands while the [sub]layer is still mid-fade the mixer's total weight dips and
   the body blends toward BIND POSE — the T-pose flashes the owner screenshotted".
   30 enemies × attack one-shots is 30 chances to reproduce that.

### 5.7 Mixer throttling / LOD

Tie the rungs to the cascade splits, which are the engine's own statement of where detail
stops mattering (`SPLITS = [26, 95, 330]`, `shadows.js:104`; "The fourth [cascade] would
cover 320 m and beyond, where the aerial perspective has already compressed contrast to
the point that no shadow in it is legible", `shadows.js:20-22`):

| camera distance | mixer | skeleton | casters |
|---|---|---|---|
| < 26 m (`SPLITS[0]`) | full rate, every frame | every frame | beauty + prepass + cascade 0 |
| 26–95 m (`SPLITS[1]`) | every 2nd frame, `mixer.update(dt*2)` | every 2nd frame | beauty + prepass, cascade 0 off |
| 95–330 m | frozen (no `mixer.update`) | frozen | beauty only |
| > 330 m, or outside the camera frustum | `mesh.visible = false` | frozen | nothing (all three passes gated by the one flag) |

Additional hard rule: **never update more than 8 mixers in one frame.** With a 24-slot
pool that means a round-robin cursor when more than 8 are live — a stride the SoA loop
already suits (`enemyVis.js:415-416`).

Alternate-frame mixer stepping is safe because combat already tolerates one frame of
latency by design (`enemies.js:42-44`: "one frame of latency is below the telegraph floor
by an order of magnitude") and because the telegraph the player reads is `flash`, which is
a shader/uniform channel, not a clip.

### 5.8 Per-realm lazy loading vs the boot screen

Boot today (`main.js`), with the loading-screen fractions:
```
137 0.05 creating context     175 0.10 building scene      351 0.20 integrating atmosphere
365 0.26 clearing snow state  370 0.34 baking heightfield  380 0.60 placing character
406 0.70 preparing spells     425 0.74 fitting the rider   <- await meshChar.load()  (1.23 MB GLB)
518 0.78 compiling pipelines  <- gfx.warmUp + shadows.warmUp + depthPass.warmUp
546 0.92 warming render targets <- 3 real frames
1057 loading.done()
```

Requirements, in order of importance:

1. **The first frame must never wait on 10 GLB fetches.** Ten Cold enemies at 247–338 KB
   ≈ 3 MB, i.e. 2.4× the rider's 1,228,300 B, on top of a boot that already awaits the
   sky solve, the heightfield bake and the rider.
2. **But a resident archetype MUST be warm before it can spawn**, or its first spawn
   compiles a program mid-fight (§1.7, `gfx.js:396-403`). These two pull in opposite
   directions, and the resolution is: **warm the PROGRAM at boot, load the ASSETS
   lazily.** The program is per-material, not per-GLB: one enemy beauty material +
   one prepass material + one cascade material, warmed against ONE resident archetype's
   geometry at boot, specialises the pipeline for every later archetype that shares the
   source and defines. Three's program cache keys on source + defines, so slug #2..#30
   arriving 20 s later hit the cached program.
3. **Sequence.** In `main.js`, between 0.74 and 0.78:
   - `await meshEnemies.loadFirst(realm)` — fetch exactly the archetypes the level-1
     gate can spawn. `encounters.js:132-146` says which: gate-1 packs are "Imp Warren"
     (budget 8) and "Scout Screen" (budget 2). That is 2–3 slugs, ≈ 0.9 MB.
   - register those slots' casters, `spells.addConsumers(meshEnemies.material)`, add the
     meshes to the `gfx.warmUp` list at `main.js:537-540`, run the existing
     `warmUp`/`finishWarmUp` pair around `main.js:551-558`.
   - After `loading.done()` (`main.js:1057`), kick a background queue for the rest of
     the Cold roster, then Sand, then Ash, one GLB at a time, throttled off
     `requestIdleCallback` or a frame-budget check. `loading.nextFrame()` already exists
     (`main.js:553`) as the yield primitive.
4. **`spawn` must never block or throw on a not-yet-resident slug.** `enemies.js:365`
   ignores the return value. Two acceptable behaviours, and the renderer must implement
   the first:
   - **`meshEnemies.ready(key) -> boolean`, consulted by the DIRECTOR before it queues a
     unit.** `Encounters._queue` (`encounters.js:491`) is the one place to gate. This is
     the clean fix: an un-loaded unit is simply not selected.
   - Fallback for the race that survives that gate: keep the shard body as the
     substitute for a slot whose GLB is not resident. The shard geometry + material are
     ~40 lines (`enemyVis.js:587-618`) and are needed for bolts anyway (§1.5), so this
     costs nothing extra and guarantees a body is always visible.
5. **Share one `DRACOLoader`** and do not `dispose()` it until the last background GLB
   resolves (§2.1, `meshChar.js:376`).
6. **`SkeletonUtils` is NOT vendored.** `ls assets/vendor/three/examples/jsm/utils/`
   returns exactly one file, `BufferGeometryUtils.js`. Multiple simultaneous instances of
   one slug therefore need either (a) `SkeletonUtils.js` vendored into that directory, or
   (b) N separate `loadAsync` calls of the same URL (the browser cache makes the second
   fetch free, but the Draco decode is paid again), or (c) a hand-written bone-hierarchy
   clone. **(a) is the right answer** and belongs in the CREATE list.

---

## 6. Files to CREATE vs MODIFY — disjoint sets for two parallel agents

### Agent A — the renderer (CREATE only, plus one vendored file)

| file | action | contents |
|---|---|---|
| `src/combat/meshEnemies.js` | **CREATE** | `MeshEnemies` class: the `EnemyVis` API of §1 verbatim, GLB pool, per-slot SkinnedMesh + Skeleton + AnimationMixer, clip state machine driven by the five `drive` scalars, caster/prepass registration, `warmUp`/`finishWarmUp`, `ready(key)`, `dispose` |
| `src/shaders/meshEnemy.glsl.js` | **CREATE** | ONE fragment stage: `meshEnemyFragment({ spellLights })`, the reduced variant of §2.7. Re-exports `MESH_CHAR_VERTEX` / `MESH_CHAR_DEPTH_VERTEX` / `MESH_CHAR_PREPASS_VERTEX` from `meshChar.glsl.js` unchanged, or imports them at the use site |
| `src/combat/enemyClips.js` | **CREATE** | the retargeted-clip library loader + the role→clip-name map (`ROLE_KIT` from the roster), and the `drive`-scalar → clip/weight mapping table |
| `assets/vendor/three/examples/jsm/utils/SkeletonUtils.js` | **CREATE (vendor)** | r172 `SkeletonUtils`, for `clone()` of a skinned hierarchy (§5.8.6) |
| `src/character/gltf.js` | **CREATE** | the one shared `GLTFLoader`+`DRACOLoader` pair, with a refcounted `dispose` (§2.1). *Owner note: this file is the ONLY boundary that touches `meshChar`'s concern; if it is contentious, skip it and let `MeshEnemies` build its own loader — the cost is one extra wasm init.* |

### Agent B — the wiring (MODIFY only)

| file | action | change |
|---|---|---|
| `src/main.js` | **MODIFY** | swap the `EnemyVis` import (`:116`) and construction (`:490`) for `MeshEnemies`; add `await meshEnemies.loadFirst(...)` + caster registration + `addConsumers` in the 0.74→0.78 window; add the enemy meshes to the `gfx.warmUp` list (`:537-540`); add `warmUp`/`finishWarmUp` around the warm frames (`:551-558`); expose the renderer on `SNOWFLOW.combat` (`:1014`) |
| `src/combat/encounters.js` | **MODIFY** | gate unit selection on `meshEnemies.ready(key)` in `_queue` (`:491`) |
| `src/combat/enemies.js` | **MODIFY** | only if the archetype key space widens past 4 (`COLD_KEYS`, `:151`; `KEY_ALIAS`, `:154-161`; `_rows`, `:232-236`). If R2/R3 keeps the 4-archetype key and maps slugs upstream, **this file needs no change at all** — which is the outcome to aim for |
| `src/combat/enemyVis.js` | **KEEP, DO NOT DELETE** | it stays as the bolt renderer and the not-yet-loaded fallback body (§1.5, §5.8.4). If bolts move into `meshEnemies.js`, reduce this file to `buildShardGeometry` + the shard material rather than deleting it |

**Files neither agent may touch** (read-only dependencies whose contracts this document
transcribes): `src/render/shadows.js`, `src/render/depthPass.js`, `src/core/gfx.js`,
`src/core/perf.js`, `src/core/settings.js`, `src/render/sky.js`,
`src/character/meshChar.js`, `src/shaders/meshChar.glsl.js`,
`src/shaders/lib/meshSkin.glsl.js`, `src/shaders/registry.js`.

`src/shaders/registry.js` in particular needs **no** change: `lib/meshSkin` is already
registered (`registry.js:130`) and the enemy programs add no new chunk.

---

## 7. Out-of-scope findings (report, do not fix)

1. **`EnemyVis` is never warmed up and never disposed** (§1.7). First enemy spawn in a
   live session compiles its pipeline mid-frame. Pre-existing; the replacement closes it.
2. **Enemies are absent from the depth prepass** (§3.1), so TAA reprojects enemy pixels
   against the terrain behind them. Pre-existing; the replacement closes it.
3. **`enemies.js:40`'s stated frame order ("registry → enemies → spells") is the reverse
   of what `main.js:649-655` actually runs.** The code order looks intentional
   (`enemies.js:41-44` explains the one-frame kill latency it produces), so the comment's
   arrow is what is stale. Doc fix, not a code fix.
4. **`PRESETS.high` is byte-identical to `ultra`** — `settings.js:286` writes
   `deformResolution: 2048, resolutionScale: 1.0, ssr: true, dof: true`, which are the
   boot defaults at `settings.js:35, 89, 116, 117`. Already known and deliberate
   (`settings.js:279-283` forbids re-tuning transcribed reference data), and already
   recorded in `_shots/SCOREBOARD.md` round 8. Named only so the enemy work is not
   measured against `high` expecting it to differ from `ultra`.
5. **60 fps is not reachable on the verification machine at any rung** (round 8:
   ultra 122.85 ms, performance 58.35 ms). Any "enemies cost N ms" claim must be a
   paired A/B against an A/A control on the same machine in the same session — round 8
   measured the A/A band at ±7 ms.
