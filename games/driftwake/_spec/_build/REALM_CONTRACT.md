# REALM_CONTRACT — the realm parameter table, the switch seam, and the weather system

Task D2. Written 2026-08-07 against the tree at
`C:\Users\TestRun\Claude Claw\forgeflow-games\games\driftwake`.

Every Cold value below is quoted with the `file:line` it lives at **today**. Sand and Ash
values are proposals: they are what a builder types in. There is no `TBD` in this document.
Where a number could not be read from the tree it is marked **[derived]** with the
arithmetic shown, and where something is a design call rather than a measurement it is
marked **[call]**.

---

## 0. What a realm is, and what it is not

A realm is **a re-bake of the same world**, not a new world.

- `WORLD_SIZE = 2048` m and `HEIGHT_RES = 4096` (`src/terrain/heightfield.js:42,44`)
- `PLAY_RADIUS = 620` m (`src/terrain/heightfield.js:49`)
- `COVERAGE = 80` m deformation window at `S.deformResolution` (`src/terrain/deformation.js:90`)
- clipmap `BASE_SPACING` / `GRID_HALF_N` / `INNER_EXTENT` / `OUTER_EXTENT`
  (`src/terrain/clipmapMesh.js`, imported at `src/terrain/terrain.js:64-66`)

**None of those change per realm.** Keeping them fixed is what lets the clipmap geometry,
the deformation toroid, the minimap, the shadow cascade splits and the character grounding
survive a realm swap untouched. What changes is the *content* of the three bakes (height,
aux, grain), the sky LUT, and roughly forty uniforms.

The game ships COLD ONLY today: `grep -rn realm src/` returns only combatData level bands,
`encounters.js:170` (`this.realm = "cold"`), and `progression.js:171,404`
(`this.realmsUnlocked = ["cold"]`). **No realm module exists. No weather system exists.**
`src/vfx/particles.js` is the surf-wake `SprayField` and nothing else.

---

## 1. THE REALM PARAMETER TABLE

### 1a. Sky / atmosphere

The whole sky is one baked LUT (`src/render/sky.js:171-180`, 512×256 RGBA16F) solved from
a Nishita integral (`src/shaders/skyBake.glsl.js:77-255`). Two classes of parameter:
**settings** (`S.*`, re-read every frame by `Sky.update()` at `src/render/sky.js:411-416`)
and **bake constants** (today hard-coded in `skyBake.glsl.js`; must become bake-pass
uniforms — see §6, Builder B).

| Parameter | Cold — value @ file:line | Sand | Ash | Why |
|---|---|---|---|---|
| `S.sunAzimuth` | `118` deg — `src/core/settings.js:48` | `206` | `74` | see the wind constraint in 1d — this is not free |
| `S.sunElevation` | `13.0` deg — `settings.js:52` | `22.0` | `9.5` | Sand needs a higher sun or dune slip-faces read as one flat ochre sheet; Ash sits lower so the smoke column is lit edge-on |
| `S.sunIntensity` | `4.2` — `settings.js:53` | `5.4` | `5.6` | ×`SUN_SCALE_BASE` 5.5 (`sky.js:76`). Ash's beam is eaten by Mie (below), so the pre-extinction number goes up |
| `S.sunTempWarm` | `1.0` — `settings.js:54` | `0.72` | `1.0` | Only scales the Rayleigh half of the beam attenuation (`sky.js:394-396`); 0.72 keeps Sand's higher sun from going orange |
| `S.ambientIntensity` | `1.0` — `settings.js:55` | `1.15` | `0.80` | Sand's bright ground bounces hard; Ash's near-black ground bounces almost nothing |
| `S.ambientBlue` | `1.0` — `settings.js:56` | `1.0` | `1.0` | Declared but **not read by the sky** (`_spec/sky.md:121`). Left alone |
| `S.showMountains` | `true` — `settings.js:70` | `true` | `false` | Ash's far range is buried in smoke at `fogDensity` 0.0155 anyway; switching it off buys back the 8.27 ms the far-range raymarch costs (`settings.js:305`) |
| `S.mountainHeight` | `2150` m — `settings.js:72` | `1750` | `0` | Sand: eroded plateau range, lower and flatter |
| `S.shaftStrength` | `0.30` — `settings.js:74` | `0.22` | `0.55` | Ash is the realm where god rays through smoke *are* the look |
| `uCloudAmount` | `0.55` **hard-coded** — `sky.js:263` | `0.12` | `0.85` | Must become realm data. Sand has almost no cirrus (dust does that job); Ash has a soot ceiling |
| cirrus base colour | `vec3(0.52, 0.60, 0.74)` — `src/shaders/sky.glsl.js:660` | `(0.72, 0.63, 0.50)` | `(0.20, 0.18, 0.17)` | the cool blue-grey underside is a Cold fact |
| `BETA_M` (Mie scatter, /m) | `vec3(21e-6)` — `skyBake.glsl.js:52` | `vec3(78e-6, 74e-6, 66e-6)` | `vec3(150e-6, 132e-6, 118e-6)` | Dust and soot are Mie, not Rayleigh. This single change is what stops Sand and Ash reading as "Cold with a colour grade" |
| `MIE_G` | `0.76` — `skyBake.glsl.js:54` | `0.84` | `0.88` | Bigger particles scatter harder forward → a huge sun-side aureole, which is the sandstorm/ash-plume read |
| `BETA_R` (Rayleigh) | `vec3(5.8e-6, 13.5e-6, 33.1e-6)` — `skyBake.glsl.js:51` | same | `vec3(4.6e-6, 10.8e-6, 26.5e-6)` | Ash: −20% so the blue dome cannot survive above the soot |
| `H_MIE` (aerosol scale height) | `1200` m — `skyBake.glsl.js:46` | `900` | `2600` | **The inversion that matters:** dust settles (shallower), smoke is buoyant (deeper) |
| `MS_BOOST` | `1.5` — `skyBake.glsl.js:58` | `1.5` | `1.15` | Multiple scattering is what fills Cold's shadows blue (`skyBake.glsl.js:189-205`). Ash wants dark shadows |
| grazing-band tint | `vec3(0.97, 1.0, 1.06)` — `skyBake.glsl.js:252` | `(1.06, 1.00, 0.90)` | `(1.02, 0.96, 0.92)` | The last 15° of the sky is pulled to its own luminance × this tint. Cold's is cool. Sand's is warm, Ash's is a desaturated warm-grey |
| ground albedo (bounce solve) | `SNOW_ALBEDO = [0.83, 0.86, 0.91]` — `sky.js:79` | `[0.55, 0.45, 0.31]` | `[0.075, 0.070, 0.068]` | Feeds `_updateGroundBounce()` (`sky.js:498-502`) → the nadir rows of the LUT → `skyIrradiance` everywhere. **Cold's blue-weighted bounce is the single largest source of blue in the frame; changing this is mandatory, not cosmetic** |
| far-range snow albedo | `vec3(0.855, 0.885, 0.945)` — `sky.glsl.js:541` | `(0.60, 0.50, 0.36)` | n/a (`showMountains:false`) | |
| far-range rock albedo | `vec3(0.052, 0.055, 0.066)` — `sky.glsl.js:540` | `(0.19, 0.155, 0.115)` | n/a | |
| far-range snow-line gate | `smoothstep(0.46, 0.80, steep)` — `sky.glsl.js:538` | `smoothstep(0.30, 0.62, steep)` | n/a | Sand sheds off steeper faces than snow does |

**Sanity check on `SNOW_ALBEDO`.** `_updateGroundBounce()` computes
`L = albedo * E / PI` (`sky.js:497-502`) and the solve iterates it three times
(`sky.js:448-452`), so the bounce compounds by roughly `albedo³`. Cold's mean 0.867 →
0.652. Ash's mean 0.071 → 0.00036. **[derived]** That is a factor of ~1800 in how much the
ground lights the sky, and it is the mechanism that makes an ash plain feel like a pit
rather than a bright field. Do not "fix" the darkness by raising `ambientIntensity` back —
raise `exposure` (1f) instead.

### 1b. Ground albedo, grain and micro-relief — *how the snow stops being snow*

This is the section that decides whether Sand and Ash read as recoloured snow. Four
mechanisms carry the "snow" read and each has to be broken individually.

#### The four blue literals

`vec3(0.55, 0.72, 1.0)` — the `deepTint` of the subsurface term — is written out **four
times** in the tree:

```
src/shaders/lib/shading.glsl.js:213    vec3 deepTint    = vec3(0.55, 0.72, 1.0);   // snowSubsurface
src/shaders/sky.glsl.js:265           vec3 deepTint    = vec3(0.55, 0.72, 1.0);   // snSnowSubsurface (far range)
src/shaders/snow.glsl.js:541          vec3 caveTint = mix(vec3(1.0), vec3(0.55, 0.72, 1.0), (1.0 - ao) * 0.95);
src/shaders/wake.glsl.js:346          vec3 caveTint = mix(vec3(1.0), vec3(0.55, 0.72, 1.0), (1.0 - occ) * 0.95);
```

`shading.glsl.js:212` and `sky.glsl.js:264` additionally hold
`shallowTint = vec3(0.94, 0.965, 1.0)`.

All six sites must resolve to **two uniforms**, `uSssShallow` and `uSssDeep`, declared once
in the new `lib/realm` chunk (§6). Leaving even one of them a literal puts a blue hollow in
an ash crater and it will read as a bug.

`shading.glsl.js:210-211` states the ladder this drives: *"At the default radius of 1.0 the
tint parameter IS thickness […] fresh snow 1.0 → (0.550, 0.720, 1.0), compressed 0.35 →
(0.803, 0.879, 1.0), ice 0.15 → (0.882, 0.928, 1.0)."* So the tint pair alone re-colours
the whole depth ladder in one write.

| Parameter | Cold @ file:line | Sand | Ash | Note |
|---|---|---|---|---|
| base albedo | `vec3(0.855, 0.885, 0.945)` — `src/shaders/snow.glsl.js:342` | `(0.620, 0.505, 0.345)` | `(0.082, 0.076, 0.074)` | B/R ratio: Cold **1.105** (`_spec/snow-shading.md:630`), Sand **0.556**, Ash **0.902**. The ratio inversion is the point |
| base roughness | `0.62` — `snow.glsl.js:343` | `0.86` | `0.93` | |
| base f0 | `vec3(0.028)` — `snow.glsl.js:344` | `vec3(0.035)` | `vec3(0.040)` | quartz > ice; slag glass > quartz |
| base thickness | `1.0` — `snow.glsl.js:345` | `0.45` | `0.12` | drives the SSS lobe width/amplitude (`shading.glsl.js:225-231`). Sand transmits a little at a dune lip; ash transmits nothing |
| `uSssShallow` | `(0.94, 0.965, 1.0)` — `shading.glsl.js:212` | `(1.0, 0.96, 0.86)` | `(1.0, 0.72, 0.46)` | Ash's "transmission" is a cinder glow, not translucency |
| `uSssDeep` | `(0.55, 0.72, 1.0)` — `shading.glsl.js:213` | `(0.92, 0.66, 0.38)` | `(0.55, 0.19, 0.08)` | |
| `S.sssStrength` | `1.0` — `settings.js:79` | `0.18` | `0.10` | **The single biggest "not snow" lever.** `shading.glsl.js:22-25` calls this term *"doing most of the work of making this read as snow at all"* |
| `S.sssRadius` | `1.0` — `settings.js:80` | `0.55` | `0.30` | |
| `uCaveTint` | `(0.55, 0.72, 1.0)` — `snow.glsl.js:541`, `wake.glsl.js:346` | `(0.82, 0.62, 0.42)` | `(0.34, 0.24, 0.20)` | Cold's hollows go blue because *"a real snow cave is blue and not grey"* (`snow.glsl.js:538-539`). A sand hollow goes warm-brown; an ash hollow goes nearly black |
| wrap amount (direct diffuse) | `mix(0.62, 0.15, max(compression, rockExposed))` — `snow.glsl.js:434` | `mix(0.24, 0.10, …)` | `mix(0.12, 0.06, …)` | Snow's mean free path is millimetres so light wraps past the terminator (`shading.glsl.js:173-176`). Sand and ash have hard terminators |
| bounce-up coefficient | `0.28` — `snow.glsl.js:473` | `0.16` | `0.05` | |
| compressed colour | `vec3(0.62, 0.665, 0.755)` @ mix `×0.85` — `snow.glsl.js:348` | `(0.44, 0.355, 0.235)` | `(0.048, 0.044, 0.043)` | packed sand darkens and warms; packed ash goes to soot |
| compressed roughness / thickness | `0.34` / `0.35` — `snow.glsl.js:349-350` | `0.52` / `0.20` | `0.66` / `0.05` | |
| "ice" channel colour | `vec3(0.42, 0.56, 0.70)` @ `×0.8` — `snow.glsl.js:353` | `(0.74, 0.62, 0.40)` | `(0.16, 0.075, 0.055)` | Channel **repurposed, not removed**: Sand = fulgurite/glassed sand, Ash = cooled slag. Both stay reflective, which is what `postChain` needs — SSR is gated on `deform.iceEverBrushed` (`src/terrain/deformation.js:148`) |
| "ice" roughness / f0 / thickness | `0.07` / `0.045` / `0.15` — `snow.glsl.js:354-356` | `0.11` / `0.050` / `0.10` | `0.14` / `0.055` / `0.04` | |
| loose (berm) colour | `vec3(0.895, 0.920, 0.965)` @ `×0.55` — `snow.glsl.js:391` | `(0.700, 0.585, 0.415)` | `(0.135, 0.125, 0.120)` | Invariant from `_spec/snow-shading.md:735`: *"a berm must read brighter than surrounding snow and must not read warmer or greyer than it."* The Sand/Ash equivalent: **brighter than the surround and no cooler than it** |
| loose roughness | `0.78` — `snow.glsl.js:392` | `0.90` | `0.95` | |
| rock colour A→B | `(0.055,0.058,0.068)` → `(0.115,0.112,0.118)` — `snow.glsl.js:363` | `(0.30,0.24,0.17)` → `(0.42,0.34,0.24)` | `(0.030,0.028,0.028)` → `(0.075,0.062,0.056)` | |
| rock exposure gate | `smoothstep(0.32, 0.66, 1.0 - N.y)` — `snow.glsl.js:360` | `smoothstep(0.22, 0.52, …)` | `smoothstep(0.10, 0.34, …)` | Sand slides off shallower faces than snow; ash sticks to almost nothing, so an ash realm is *mostly* bare |
| wake albedo | `vec3(0.895, 0.920, 0.965)` — `src/shaders/wake.glsl.js:221` | `(0.700, 0.585, 0.415)` | `(0.135, 0.125, 0.120)` | tracks the loose colour by construction |
| wake roughness | `0.80` — `wake.glsl.js:222` | `0.90` | `0.95` | |

#### Grain map (`detailBake.glsl.js`) — 1024² RGBA8, three tiling scales

Cold's grain is *"a jam of rounded crystals with deep, dark crevices between them —
spheres, not noise bumps"* (`src/shaders/detailBake.glsl.js:44-46`), built from a spherical
cap profile `sqrt(1 - d²)` (`detailBake.glsl.js:67`) at three cell counts
`26 / 61 / 137` with weights `1.0 / 0.42 / 0.17` (`detailBake.glsl.js:79-83`).

| Parameter | Cold @ file:line | Sand | Ash |
|---|---|---|---|
| cell counts | `26, 61, 137` — `detailBake.glsl.js:79-81` | `44, 103, 221` | `19, 47, 109` |
| height weights | `1.0, 0.42, 0.17` — `:83` | `1.0, 0.55, 0.30` | `1.0, 0.34, 0.11` |
| cavity weights | `0.55, 0.30, 0.15` — `:84` | `0.42, 0.34, 0.24` | `0.70, 0.20, 0.10` |
| grain radius | `0.30 + r2.x * 0.26` — `:66` | `0.22 + r2.x * 0.18` | `0.34 + r2.x * 0.40` |
| dome profile | `sqrt(1 - d*d)` (spherical cap) — `:67` | `pow(1 - d*d, 0.72)` — flatter, sub-angular quartz | `1 - d*d*d` — broad, soft, no rim highlight (ash is a fluff, not a jam) |
| cavity depth | `1 - (1-d)*0.5` — `:69` | `1 - (1-d)*0.34` | `1 - (1-d)*0.78` |
| `GRAIN_SCALE` | `0.013` — `src/terrain/terrain.js:78` | `0.021` | `0.009` |
| detail sample scales (m⁻¹) | `7.5 / 1.7 / 0.31` — `snow.glsl.js:310,315,320` | `11.0 / 2.4 / 0.44` | `6.0 / 1.35 / 0.25` |

Sand's grains are **smaller, flatter, harder-edged** (quartz sand is sub-angular and packs
tighter than snow). Ash's are **larger, softer, deeper-cavitied** (volcanic ash is a
low-density fluff full of voids — the cavity channel doing 70% of the work is what makes it
read as absorbent rather than granular).

#### Micro-relief — *sastrugi → dune ripples → ash crust cracks*

Lives in `src/shaders/lib/terrain.glsl.js`, in **two twins that must stay identical**:
`terrainFine()` (vertex, `:264-313`) and `terrainFineFiltered()` (fragment, `:328-373`).
The file's own note at `:243-245`: *"the filtered twin further down […] must produce the
same surface — one is the vertex displacement and the other is the fragment normal."*
Branch both or the silhouette and the shading describe different ground.

**Cold (as shipped).** `windMat(w + wl.x, 1.0, wl.y, 2.3)` with `wl.y ∈ [2.3, 4.7]`
(`terrain.glsl.js:279, 253`) — `sx = 1.0` **along** the wind, `sy = wl.y` **across** it, so
the ridges streak *along* the wind. `ridgedd(m3*p, 3, 2.11, 0.52)` gives the hard scalloped
crest and soft trough (`:280`). Amplitude `0.125 * amp * mix(0.45, 1.0, exposure) * scour`
(`:282`).

| Layer | Cold @ file:line | Sand — **dune ripples** | Ash — **crust cracks** |
|---|---|---|---|
| primary noise | `ridgedd(m3*p, 3, 2.11, 0.52)` — `:280` | `noised(m3*p)` — smooth, rounded crest **and** rounded trough | `ridgedd(m3*p, 4, 2.07, 0.55)` then **inverted and sharpened** (below) |
| `windMat` | `(w + wl.x, 1.0, wl.y, 2.3)` — `:279` | `(w + wl.x, wl.y, 1.0, 0.9)` — **sx/sy SWAPPED** | `(w, 1.35, 1.0, 1.6)` — near-isotropic |
| amplitude | `0.125` — `:282` | `0.055` | `0.045` |
| exposure fade | `mix(0.45, 1.0, exposure)` — `:282` | `mix(0.30, 1.0, exposure)` | `mix(0.85, 1.0, exposure)` — cracks do not care about wind shelter |
| `scour` field freq | `noise2(p * 0.021)` — `:281` | `p * 0.021` | `p * 0.014` (~71 m plates) |
| fragment fade | `1 - smoothstep(0.35, 1.6, fp)` — `:339` | `1 - smoothstep(0.14, 0.62, fp)` | `1 - smoothstep(0.24, 1.10, fp)` |
| ripple layer `windMat` | `(w + wl.x*0.5, 2.9, 1.0, 0.42)` — `:295` | `(w + wl.x*0.5, 1.0, 2.9, 0.17)` — swapped, finer | `(w, 1.0, 1.0, 0.30)` |
| ripple amplitude | `0.024` — `:297` | `0.011` | `0.014` |
| grain layer | `(w, 1.0, 1.0, 0.115)` @ `0.0075` — `:304,306` | `(w, 1.0, 1.0, 0.070)` @ `0.0042` | `(w, 1.0, 1.0, 0.145)` @ `0.0090` |

**Sand — why the swap.** `terrain.glsl.js:19-23` states the Cold invariant: *"Broad forms
run transverse to the wind (dune ridges), fine forms run parallel to it (sastrugi
streaks). If both families run the same way in a screenshot, a `windMat`'s sx/sy have been
swapped (terrain.md §14 criterion 1)."* Real aeolian ripples run **transverse** — crests
perpendicular to the flow — which is the exact opposite of sastrugi. So Sand deliberately
inverts criterion 1, and **Sand's acceptance criterion is the negation of Cold's**: in a
Sand screenshot the broad dune ridges and the fine ripples must run the *same* way. Write
that down in the Sand shot notes or the first reviewer will file it as the bug it is not.

The fade thresholds are the Cold ratios rescaled to the new wavelength, so filtering
behaves identically: `0.35/2.3 = 0.152` and `1.6/2.3 = 0.696`; `0.9 × 0.152 = 0.137 ≈ 0.14`
and `0.9 × 0.696 = 0.626 ≈ 0.62`. **[derived]**

**Ash — the crack formula.** Cracks are *channels down*, not ridges up, and a mud/ash
polygon network has no wind direction — the near-isotropic `windMat` is what kills the
corduroy read on its own. Concretely, in place of `terrain.glsl.js:280-284`:

```glsl
mat2 m3 = windMat(w, 1.35, 1.0, 1.6);
vec3 cr  = ridgedd(m3 * p, 4, 2.07, 0.55);
float c  = clamp(cr.x, 0.0, 1.0);
float crk = pow(c, 2.6);                       // narrow the crest into a channel wall
float a  = 0.045 * amp * mix(0.85, 1.0, exposure) * scour;
h -= crk * a;                                  // DOWN, not up
d -= (2.6 * pow(c, 1.6) * (cr.yz * m3)) * a;   // chain rule through pow()
```

The `pow(c, 2.6)` is what turns a rounded ridged crest into a narrow crack wall, and the
subtraction is what makes it a fissure. `pow(c, 1.6)` in the derivative is `d/dc c^2.6`
divided by 2.6 — written out so the two can be diffed.

#### Sparkle — *snow glints → mica glint → dull ember specks*

`snowGlints()` (`src/shaders/lib/shading.glsl.js:293-337`), called from
`snow.glsl.js:514-519`. Two world-space octaves at cell `0.052` (sharpness 780) and `0.185`
(sharpness 1500), gated on grazing view angle `pow(1 - NdotV, mix(1.5, 5.0, grazeGate))`
(`shading.glsl.js:309`) and on `NdotL` (`:315-316`), then added as
`sunRadiance * g * shadow * (1 - iceAmount*0.6) * 0.55` (`snow.glsl.js:518`).

| Parameter | Cold @ file:line | Sand — mica | Ash — embers |
|---|---|---|---|
| `cellA` / sharpness | `0.052` / `780.0` — `shading.glsl.js:323,326` | `0.100` / `260.0` | `0.220` / `90.0` |
| `cellB` / sharpness | `0.185` / `1500.0` — `:329,332` | `0.340` / `520.0` | `0.480` / `140.0` |
| facet survival cull | `r2.x > 0.62` reject — `:265` | `r2.x > 0.86` (rarer) | `r2.x > 0.93` (rarest) |
| facet tilt | `0.10 + r2.y * 0.26` — `:277` | `0.06 + r2.y * 0.15` (flat cleavage planes) | `0.30 + r2.y * 0.50` (no facet at all — it is a blob) |
| `S.glintIntensity` | `0.55` — `settings.js:77` | `0.30` | `0.18` |
| `S.glintGrazing` | `0.72` — `settings.js:78` | `0.25` | `0.0` |
| grazing exponent **[derived]** | `mix(1.5,5.0,0.72) = 4.02` | `= 2.375` | `= 1.5` |
| light source | `sunRadiance * g * shadow` — `snow.glsl.js:518` | `sunRadiance * uGlintTint * g * shadow` | **`uGlintTint * uGlintEmissive * g`** — no `sunRadiance`, no `shadow` |
| `uGlintTint` | `(1.0, 1.0, 1.0)` (implicit) | `(1.00, 0.94, 0.74)` pale gold | `(1.00, 0.42, 0.11)` cinder |
| `uGlintEmissive` | `0.0` | `0.0` | `3.4` |
| `NdotL` gate | `smoothstep(0.02,0.35,NdotL) * (1 - smoothstep(0.55,0.95,NdotL)*0.55)` — `:315-316` | unchanged | **bypassed** (`uGlintEmissive > 0` → gate = 1.0) |

The mechanism, stated plainly: **Cold's sparkle is specular, Sand's is specular-but-wider,
Ash's is emissive.** Dropping `sunRadiance` and `shadow` from the Ash branch is the whole
trick — an ember in the shade still glows, and that is what stops it reading as glitter on
black sand. `snow.glsl.js:511-513` already argues the term is *"added as radiance rather
than modulated into the BRDF"*, so an emissive variant needs no structural change, only a
different multiplier.

### 1c. Fog

One `vec4` shared by every material that includes `lib/atmosphere`
(`src/shaders/lib/atmosphere.glsl.js:110`), written every frame by
`Sky.update()` (`src/render/sky.js:414-416`).

| Parameter | Cold @ file:line | Sand | Ash | Why |
|---|---|---|---|---|
| `S.fogDensity` (/m) | `0.0072` — `settings.js:59` | `0.0115` | `0.0155` | |
| `S.fogHeightFalloff` (/m) | `0.045` — `settings.js:60` | `0.070` | `0.026` | **The inversion:** dust settles (steeper), smoke rises (shallower) |
| haze scale height **[derived]** | `1/0.045 = 22.2` m — stated at `atmosphere.glsl.js:214` | `14.3` m | `38.5` m | Sand's haze sits below the dune crests; Ash's fills the whole column |
| `S.fogStart` (m) | `24` — `settings.js:61` | `18` | `12` | |
| `S.aerialStrength` | `1.0` — `settings.js:62` | `1.15` | `1.30` | exponent on transmittance (`atmosphere.glsl.js:289`) |
| near-sky tilt | `+0.42` y, mip `3.0` — `atmosphere.glsl.js:246-247` | `+0.30`, mip `3.0` | `+0.12`, mip `4.0` | What fills a *short* path. In smoke the answer is the horizon band, not the dome |
| forward lobe | `phaseMie(mu, 0.62) * 5.5`, `*0.16` — `atmosphere.glsl.js:274-275` | `phaseMie(mu, 0.80) * 7.5`, `*0.22` | `phaseMie(mu, 0.86) * 9.0`, `*0.26` | the sun-side glare that sells a dust/ash column |

**Weather scales these, it does not replace them.** See §3, "Fog coupling".

### 1d. Wind

| Parameter | Cold @ file:line | Sand | Ash |
|---|---|---|---|
| `S.windDirection` (deg) | `42` — `settings.js:67` | `130` | `150` |
| `S.windStrength` | `1.0` — `settings.js:68` | `1.45` | `0.75` |
| spray wind vector | `sin(wa)*2.4*windStrength, cos(wa)*2.4*…` — `src/vfx/particles.js:363-364` | unchanged formula | unchanged formula |
| cloth wind | `3.2 * S.windStrength` — `src/character/cloth.js:505` | unchanged | unchanged |
| fur wind | `0.6 * S.windStrength` — `src/character/character.js:505` | unchanged | unchanged |
| `S.sastrugiStrength` | `1.0` — `settings.js:83` | `1.35` | `0.70` |
| `S.macroHeightScale` | `1.0` — `settings.js:82` | `1.25` | `0.65` |

**HARD CONSTRAINT — do not pick these two independently.** `settings.js:64-66`:

> Degrees. Drives sastrugi shear and dune orientation. Held 70-80 degrees away from
> `sunAzimuth`: sastrugi ridges run along the wind, so when the two align the sun rakes down
> every ridge, lights both flanks identically and the fine structure reads as flat ground.

Check each realm **[derived]**: Cold `|118 − 42| = 76` ✓ · Sand `|206 − 130| = 76` ✓ ·
Ash `|74 − 150| = 76` ✓. All three pairs hold 76°. Any future edit to `sunAzimuth` must move
`windDirection` with it.

The bearing conversion is `bearingRad()` (`src/core/bearing.js`), applied identically by the
heightfield bake (`heightfield.js:157`), the clipmap uniform (`terrain.js:245,446`), the
deformation sim (`deformation.js:386`), the cirrus (`sky.js:663`) and the spray drift
(`particles.js:362`). **Weather must use the same call** or the storm blows across the
sastrugi instead of along it.

### 1e. Weather

Full design in §3. The per-realm dial block:

| Parameter | Cold — **blizzard / snowfall** | Sand — **sandstorm / dust devils** | Ash — **ember-fall / smoke drift** |
|---|---|---|---|
| `mode` | `0` | `1` | `2` |
| `fallSpeed` (m/s, +down) | `1.6` | `0.35` | `0.90` falling / `-0.45` rising (index-hashed 60/40) |
| `windGain` (× spray's 2.4·`windStrength`) | `1.00` | `2.60` | `0.55` |
| `gustAmp` | `0.45` | `0.70` | `0.30` |
| spawn box (m) | `(140, 46, 140)` | `(150, 40, 150)` | `(120, 60, 120)` |
| radius fine / coarse / glow (m) | `0.012 / 0.028 / —` | `0.008 / 0.020 / —` | `0.014 / 0.032 / 0.020` |
| alpha fine / coarse / glow | `0.30 / 0.42 / —` | `0.26 / 0.38 / —` | `0.22 / 0.34 / 0.85` |
| tint | `(0.94, 0.96, 1.00)` | `(0.74, 0.63, 0.44)` | `(0.30, 0.28, 0.27)` |
| glow tint / emissive | — | — | `(1.00, 0.40, 0.10)` × `2.8` |
| stretch clamp | `6.0` | `6.0` | `3.5` |
| fog boost (× `S.fogDensity`) | `1.90` | `2.40` | `1.35` |
| devils | `0` | `3` | `0` |

### 1f. VFX / hazard tint

| Parameter | Cold @ file:line | Sand | Ash |
|---|---|---|---|
| spray albedo | `vec3(0.92, 0.94, 0.98)` — `src/shaders/spray.glsl.js:192` | `(0.72, 0.62, 0.46)` | `(0.28, 0.26, 0.25)` |
| spray wrap | `wrapDiffuse(dot(N,L), 0.75)` — `spray.glsl.js:193` | `0.55` | `0.35` |
| spray forward lobe | `phaseMie(mu, 0.55) * 0.85` — `spray.glsl.js:206` | `phaseMie(mu, 0.68) * 1.10` | `phaseMie(mu, 0.45) * 0.30` |
| spray edge alpha | `mix(0.36, 0.55, kind)` — `spray.glsl.js:172` | `mix(0.30, 0.50, kind)` | `mix(0.24, 0.42, kind)` |
| speed-streak tint | `vec3(0.88, 0.94, 1.06)` @ `0.16` — `src/shaders/post/tonemap.glsl.js:158` | `(1.04, 0.94, 0.78)` @ `0.20` | `(1.06, 0.72, 0.46)` @ `0.14` |
| `S.exposure` | `0.105` — `settings.js:126` | `0.170` | `0.300` |
| `S.contrast` | `1.14` — `settings.js:127` | `1.10` | `1.22` |
| `S.bloomStrength` | `0.22` — `settings.js:129` | `0.18` | `0.34` |

**Exposure arithmetic [derived].** `settings.js:124-126` states Cold's exposure was picked
because *"sunlit snow here sits around 12 in linear, and at this exposure it lands near AgX
normalised 0.79, where the curve's slope is 0.09 per stop."* Mean albedo: Cold 0.895,
Sand 0.490 (1.83× darker), Ash 0.077 (11.6× darker). Naïvely Sand → `0.105 × 1.83 = 0.192`
and Ash → `0.105 × 11.6 = 1.22`. Sand's is close to the proposed 0.170 (the rest comes back
from the brighter sky). Ash's is **outside the slider's 0.6 maximum** (`settings.js:245`)
and pushing there would flatten the sun into AgX's toe. So Ash takes **0.300** and makes up
the difference through the emissive ember specks (1b), `bloomStrength` 0.34 and
`shaftStrength` 0.55. **[call]** — the ash realm is lit by what glows in it, not by the sun.

Spell FX colours are the D1/D3 spell contract's, not this document's. This table owns only
the *ambient* VFX — the spray pool, the streaks and the post chain — which every realm's
spells share.

### 1g. Level band, enemy roster, spell set

| | Cold | Sand | Ash |
|---|---|---|---|
| level band | `[1, 10]` — `src/combat/combatData.js:645` | `[8, 20]` — same line | `[18, 30]` — same line |
| alive cap | `6` — `src/combat/encounters.js:95` | `8` — same line | `8` — same line |
| pack tables | 6 rows — `encounters.js:132-146` | **0 rows — must be authored** | **0 rows — must be authored** |
| mesh budget | 10 bodies, 2.961 MiB — `assets/enemies/manifest.json` | 10 bodies, 2.731 MiB | 10 bodies, 2.748 MiB |
| miniboss | `shrinebreaker` hp 760 — `combatData.js:544-546` (**disputed, see §5**) | `gatekeeperOfBrass` hp 1500 — `combatData.js:563-565` | `furnaceGuardian` hp 2200 — `combatData.js:579-581` |
| realm boss | `moraineElder` hp 2000 fixedLevel 10 — `combatData.js:554-556` (**disputed, see §5**) | `duneWarden` hp 2400 fixedLevel 20 — `combatData.js:571-573` | `volcanicPlateKnight` hp 3000 fixedLevel 30 — `combatData.js:588-590` |

**Roster slugs** (`assets/enemies/manifest.json`, read this run):

- **cold** — `01_cold_rime_imp`, `02_cold_glacier_brute`, `03_cold_frost_stalker`,
  `31_v2_cold_rime_imp`, `32_v2_cold_glacier_brute`, `34_v2_cold_ice_cultist`,
  `39_v2_cold_blizzard_assassin`, `61_v3_cold_frost_golem`, `65_v3_cold_rime_skier_raider`,
  `68_v3_cold_hail_plate_guard`
- **sand** — `11_sand_dune_imp`, `12_sand_dune_brute`, `13_sand_dust_stalker`,
  `16_sand_dust_mage`, `43_v2_sand_dust_stalker`, `48_v2_sand_dune_sentinel`,
  `50_v2_sand_dune_warden`, `73_v3_sand_mummy`, `75_v3_sand_bleached_bone_knight`,
  `77_v3_sand_windscour_bandit`
- **ash** — `21_ash_cinder_imp`, `22_ash_slag_brute`, `25_ash_scorch_raider`,
  `26_ash_smoke_mage`, `28_ash_cinder_sentinel`, `29_ash_soot_assassin`,
  `53_v2_ash_soot_stalker`, `60_v2_ash_scorch_warden`, `86_v3_ash_volcanic_plate_knight`,
  `88_v3_ash_furnace_guardian`

#### Spell set — the six slots, per realm

Binds after owner directive 1 ("attack LMB must be switched to 1 and push all others").
**Engine ids are stable and never renumbered** — `spellSystem.js:157` builds
`[sweep, ribbon, bloom, crystallize, vortex]` = ids 1..5.

| Bind | Engine id | Mechanic (constant across realms) | Cold | Sand | Ash |
|---|---|---|---|---|---|
| LMB | **new** | fast single-target bolt, no cooldown | **Frost Bolt** — sharp ice shard | **Glass Shard** — fused-silica splinter | **Cinder Bolt** — a spitting coal |
| 1 | 2 (`ribbon`) | held stream, mana-drained channel | **Rime Ribbon** (water) | **Sand Lash** (grit rope) | **Magma Cord** (molten thread) |
| 2 | 1 (`sweep`) | ploughing crescent, knockback 4 m | **Frost Wave** | **Dune Break** | **Ashfront** |
| 3 | 3 (`bloom`) | targeted eruption, 40% slow 1.5 s | **Mini-Vortex** | **Sinkhole** | **Vent Burst** |
| 4 | 4 (`crystallize`) | expanding disc, stance-break, hazard field | **Crystal Spikes** | **Glass Spires** | **Slag Teeth** |
| 5 | 5 (`vortex`) | ring that lifts and flings | **Great Vortex** | **Sand Cyclone** | **Firestorm** |

Gates carry across unchanged: `STRIKE_DELAY {1:.71, 3:.66, 4:.95, 5:.98}`,
`MANA_COST {1:15, 3:25, 4:30, 5:45}`, `COOLDOWN {1:4, 3:6, 4:10, 5:14}`
(`src/spells/spellSystem.js:75, 84, 90`). `combatData.SPELLS` is keyed by owner bind and
each row carries `engineKey` (`combatData.js:11-15, 53-119`), so the rebind is a re-key of
that object plus `src/core/input.js` `SPELL_KEYS` and `src/ui/spellbar.js` — **not** a
renumber of the engine.

**Scope note.** The 18 identities above are the *names and fictions* this contract needs so
the realm table has a `spell set` row. The per-realm FX parameters, damage rows and augment
ladder belong to the D1/D3 spell contract, which does not exist in `_spec/_build/` yet
(`ls` this run: `MESH_ENEMY_CONTRACT.md`, `enemy_clip_map.json`, `enemy_mesh_audit.json`,
`roster_reconciled.json`). Where the two documents disagree, the spell contract wins on
spells and this one wins on realms.

---

## 2. THE SWITCH SEAM

### 2.1 Three cost classes

**Class A — free (a uniform write, already re-read every frame).** Nothing to schedule.

| What | Re-read at |
|---|---|
| `sssStrength`, `sssRadius`, `glintIntensity`, `glintGrazing` | `src/terrain/terrain.js:449-453` |
| `detailNormalStrength`, `debugView` | `terrain.js:455-456` |
| `windAngle`, `sastrugiAmp` | `terrain.js:446-447` |
| `uFog` (all four) and `uAmbientIntensity` | `src/render/sky.js:413-416` |
| `uRidgeAmp` ← `S.showMountains ? S.mountainHeight : 0` | `sky.js:679` |
| `uWindDir` | `sky.js:663-664` |
| the whole new `lib/realm` uniform block | written once per swap; shared by reference |

**Class B — a debounced GPU re-bake (the sky LUT).**

`Sky.solve()` (`sky.js:441-466`) runs `bake()` + `projectSH()` three times, then once more
— **8 fullscreen bakes and 4 async readbacks**. Each `bake()` renders the same shader into
*both* LUTs (`sky.js:479-480`): 512×256 = 131,072 px plus 64×32 = 2,048 px, every pixel
running 32 view steps × up to 8 light steps (`skyBake.glsl.js:98-99`). Each `projectSH()`
is a `readRenderTargetPixelsAsync` of 64×32×4 floats (`sky.js:566-568`) followed by a
2,048-texel × 9-coefficient CPU reduction (`sky.js:580-623`).

Scheduling, from the code: `_markDirty()` sets `_rebakeAt = now + REBAKE_DEBOUNCE_MS`
(`sky.js:326-329`) with `REBAKE_DEBOUNCE_MS = 150` (`sky.js:90`), and `update()` returns
early until that time passes (`sky.js:419`) and then calls `solve()` **without awaiting it**
(`sky.js:423-425`) — the header at `sky.js:83-89` explains why: four bakes plus four
readbacks per drag-frame *"is fine on the RTX the reference was profiled on and is not fine
on the Iris Xe the harness runs."*

**For a realm swap, do not use the debounce path.** Call `await sky.solve()` directly from
inside the loading phase, so the first frame of the new realm is already lit by the new LUT.

**Class C — a synchronous stall. Must be behind a loading screen.**

1. **Grain map.** `this._detailPass.render(this.detailRT)` (`terrain.js:387`) — one
   1024² = 1,048,576-pixel pass. Per pixel: `detailHeight()` is called 5× (`detailBake.glsl.js:92-96`),
   each calling `grainHeight()` 3× (`:79-81`), each a 3×3 neighbour loop (`:54-55`) →
   **135 cell evaluations per pixel [derived]**, plus RGBA8 mip-chain regeneration
   (`terrain.js:206-216`).
2. **Heightfield.** `heightfield.bake()` (`terrain.js:393`, again at `:430`) →
   `heightBake` into 4096² RG32F (`heightfield.js:161`) → `auxBake` into 2048² RGBA16F
   (`:163`) → `_readback()` (`:165`). The readback is a **synchronous** `gl.readPixels` in
   8 strips of `STRIP_ROWS = 512` (`heightfield.js:61, 225-227`) at RGBA/FLOAT — the file's
   own note at `:56-59` puts the full read at **268 MB** of transfer — followed by a
   4,194,304-iteration JS box filter (`:230-242`) and a 4,194,304-element min/max scan
   (`:256-260`). `terrain.js:389-391` states these *"together take a few hundred
   milliseconds."* That sentence is the code's, not a measurement I took this run.
3. **Deformation clear.** `deform.warmUp()` → `_zero()` (`deformation.js:490-511, 521-524`)
   — two `_step()` passes at `S.deformResolution²`. The sim itself is quoted at **4.15 ms at
   2048²** (`settings.js:307`) and **7% of the frame** (`deformation.js:409`), so two passes
   is ~8 ms. Cheap next to the heightfield, but mandatory: the carved trench of the old
   realm must not survive into the new one.

`Terrain` already defers its own re-bake to the top of the next `update()` rather than
running it from a settings callback (`terrain.js:367-371, 427-432`), *"so it can never land
in the middle of a render"* (`terrain.js:43-44`). Keep that discipline: the realm module
sets the flag and the loading loop pumps a frame.

**Ordering note that is easy to get wrong:** `_applyHeightBounds()` (`terrain.js:398-405`)
pushes the *measured* relief to the shadow cascade fitter. Because `S.macroHeightScale`
differs per realm (1.0 / 1.25 / 0.65), the cascade volume changes — and it is handled for
free, because `_rebake` already calls `_applyHeightBounds()` right after `bake()`
(`terrain.js:430-431`). Nothing extra to write.

### 2.2 Recommended module API

```js
// src/realm/realm.js
export class Realm {
    /** The last realm played, peeked from the save without constructing
     *  Progression. Reads the same key Progression writes:
     *  `SAVE_KEY = "driftwake_save"` (src/progression/progression.js:49). */
    static bootName() { /* → "cold" | "sand" | "ash", default "cold" */ }

    constructor(name);              // writes S.* immediately; no listeners exist yet
    get name();                     // "cold" | "sand" | "ash"

    /** The lib/realm uniform block — ~18 {value} objects, shared BY REFERENCE
     *  with the snow, wake, spray, sky and crystal materials, exactly as
     *  sky.uniforms and deform.uniforms are (sky.js:199-207,
     *  deformation.js:173-179). One write per swap reaches every program. */
    get uniforms();

    /** Multiplicative boosts Sky.update() folds into uFog each frame, so the
     *  overlay's fog sliders keep working and weather layers on top of them. */
    fogBoost;                       // { density: 1, falloff: 1 }

    attach(deps);                   // { sky, terrain, deform, weather, spray, wake,
                                    //   spells, encounters, progression, shell }
    /** THE SWITCH. Async and stalling by design — call it behind loading.phase(). */
    async swap(name);
    update(dt);                     // gust clock only; allocation-free
}
```

`swap()` in order:

1. `loading.phase("crossing into " + name, 0.05)`
2. write `S.*` (§1a, 1c, 1d, 1f) and the `uniforms` block (§1b, 1e)
3. `sky.setRealm(name)` (bake constants) then **`await sky.solve()`** — not `_markDirty()`
4. `terrain.setRealm(name)` → re-bake grain map, then `heightfield.bake()`,
   then `_applyHeightBounds()`
5. `await deform.warmUp()` — clears the carved state
6. `weather.setRealm(name)`; `spray.clear()` (`particles.js:454-464`); `wake.warmUpClear()`
   (`surfWake.js:884-888`)
7. `encounters.realm = name` (`encounters.js:170` is a plain field, never written today)
8. `enemies.setRealm(name)` — swap the 10-body GLB set
9. `shell.setAccent(REALMS[name].accent)` — the shell accent is Cold-frost hard-coded at
   `main.js:875-876`
10. `loading.done()`

### 2.3 The exact `main.js` integration diff

Apply as text. Context lines are verbatim from `src/main.js` as read this run.

```diff
@@ src/main.js:96 @@
 import { DeformationField } from "./terrain/deformation.js";
 import { Terrain } from "./terrain/terrain.js";
+import { Realm } from "./realm/realm.js";
 import { CharacterController } from "./character/controller.js";
 import { Character } from "./character/character.js";
@@ src/main.js:102 @@
 import { SprayField } from "./vfx/particles.js";
 import { SurfWake } from "./vfx/surfWake.js";
+import { WeatherField } from "./vfx/weather.js";
 import { SpellSystem } from "./spells/spellSystem.js";
@@ src/main.js:347 @@
     // ------------------------------------------------------------------- sky
     // First, and awaited: the terrain, character, wake, spray, water and crystal
     // materials all take the sky LUT and the SH coefficients as CONSTRUCTION
     // inputs, so nothing else may be built until the solve resolves.
     await loading.phase("integrating atmosphere", 0.20);
+    // BEFORE the Sky, deliberately. `Realm`'s constructor writes plain S keys and
+    // nothing is subscribed yet — which is the point: the boot LUT is baked in
+    // the realm's own atmosphere rather than in Cold's and then re-solved.
+    // `bootName()` peeks the save (progression.js SAVE_KEY) without constructing
+    // Progression, which is not built until line ~496.
+    const realm = new Realm(Realm.bootName());
     const sky = new Sky(renderer, scene);
+    realm.attach({ sky });
     await sky.solve();
@@ src/main.js:369 @@
     // -------------------------------------------------------------- terrain
     await loading.phase("baking heightfield", 0.34);
-    const terrain = new Terrain(renderer, { sky, shadows, depthPass, deform });
+    const terrain = new Terrain(renderer, { sky, shadows, depthPass, deform, realm });
     await terrain.build();
     scene.add(terrain.mesh);
@@ src/main.js:400 @@
     // The breaking wave, its bow crest and the plume it sheds.
     const wake = new SurfWake(scene, sky, shadows, character, spray, terrain);
     wake.registerPrepass(depthPass);
+
+    // Weather. Its own pool — it does NOT emit into `spray` (see REALM_CONTRACT
+    // §3.1). Transparent, renderOrder 3, NOT a shadow caster and NOT a prepass
+    // caster: +1 draw call total.
+    const weather = new WeatherField(scene, sky, shadows, realm, {
+        globals: spray.globals,
+    });
@@ src/main.js:496 @@
     const progression = new Progression(character, registry, null);
+    // Now that Progression exists, hand it to the realm: `swap()` gates on
+    // `realmsUnlocked` and the boss-kill flags, and Progression's own save
+    // becomes the authority over `Realm.bootName()`'s peek.
+    realm.attach({
+        terrain, deform, weather, spray, wake, spells, encounters, progression,
+    });
@@ src/main.js:682 @@
         // Before the spray: the grains the wake sheds have to be in the pool
         // before the pool is uploaded.
         wake.update(dt, rig.camera);
         spray.update(dt, rig.camera);
+        // After the spray, because it composites over the plume (renderOrder 3 vs
+        // 2) and because it reads the same jittered projection `post.update()`
+        // wrote. Derives its own camera velocity from `camera.position`, so no
+        // extra plumbing and no allocation. ~6 uniform writes; no per-particle
+        // loop and no data-texture upload — see REALM_CONTRACT §3.1.
+        weather.update(dt, rig.camera);
+        realm.update(dt);   // gust clock only
         const tVfx = performance.now();
@@ src/main.js:1017 @@
         // The deformation field, alongside the other subsystems it sits between.
         deform,
+        // The realm parameter block and the weather field, exposed the way
+        // `deform` and `crosshair` are — so a probe can read realm state and
+        // force a swap without reaching into a module.
+        realm, weather,
```

**Two things this diff does NOT do**, deliberately:

- It does not register `weather.mesh` with `shadows` or `depthPass`. `SprayField` registers
  with neither (its constructor, `particles.js:149-269`, calls neither
  `shadows.registerCaster` nor `depthPass.registerCaster`), and weather follows it. `SurfWake`
  does both (`surfWake.js:331, 389`) because it is opaque geometry.
- It does not touch `warmUp()`'s extra-mesh list at `main.js:537-540`. **It should** — add
  `weather.mesh` there and call `weather.warmUpSeed()` before it, or the weather pipeline
  specialises on its first real frame and costs a visible hitch on the D3D11/ANGLE backend
  the harness runs (`main.js:514-517`). Flagged rather than written into the diff because it
  is one more hunk in a block a builder may have already edited for enemies.

---

## 3. WEATHER

### 3.1 Extend `SprayField`, or build a new system?

**Build a new system.** The numbers, all read from `src/vfx/particles.js` this run:

| Fact | Line |
|---|---|
| `CAPACITY = 5120` — *"a hard cap, not a target"* | `particles.js:98, 36-38` |
| The surf plume alone targets **~3500 live** at 19.5 m/s: *"88 + 7 a metre at 19.5 m/s across two populations lands near 3500 live, and the footfall kick and the spells still have to fit alongside"* | `particles.js:92-96` |
| Emission at a full pool is **silently DROPPED, never queued** | `particles.js:41-42`; the bounded scan returns at `:291` |
| `update()` loops over **all** `CAPACITY` slots every frame regardless of liveness | `particles.js:372` |
| The data texture is `CAPACITY × 2` RGBA32F = **160 KiB**, re-uploaded unconditionally every frame (`dataTex.needsUpdate = true`) | `particles.js:97, 173-175, 430` |
| Every live grain calls `terrain.heightAt()` once per frame | `particles.js:406` |
| `heightAt()` is a **16-tap bicubic B-spline** | `src/terrain/heightfield.js:289-298` |
| A grain that lands is killed faster and **consumes its slot until it dies** | `particles.js:407-411` |

Adding 3072 weather particles to that pool:

- **Overflows it exactly when it matters.** 3500 + 3072 = 6572 against a cap of 5120 →
  1452 emissions dropped per frame **[derived]**, and the pool is FIFO-scanned from
  `_next`, so what gets dropped is whatever emits last in the frame. The plume emits from
  `wake.update()` (`main.js:683`) *before* any weather would — so the plume thins at full
  speed while the weather stays fat. That is precisely backwards.
- **Triples the per-frame bus traffic.** 8192 × 2 × 16 B = **256 KiB/frame** uploaded
  **[derived]**, against 160 KiB today.
- **Adds ~49,000 bicubic taps per frame** on the CPU (3072 × 16) **[derived]** for a
  grounding test weather does not want: a flake that reaches the ground must respawn at the
  top of the box, not settle and hold a slot.
- **The lifecycle is wrong.** Spray is `age/life` with a one-shot fade (`particles.js:388,
  416`). Weather is *stationary in distribution* — it never dies, it wraps.

**The new system is also strictly cheaper than the old one**, because it needs no CPU
simulation at all: placement is analytic in the vertex shader from a per-index hash plus a
wrapped drift vector. Per frame it costs **six uniform writes and zero bytes uploaded**,
against spray's 5120-iteration loop and 160 KiB.

### 3.2 `WeatherField` — the design

**Geometry.** A static indexed quad lattice, built exactly as `buildQuadMesh()` does
(`particles.js:486-509`): `position` is `(index, cornerX, cornerY)` and carries no geometry.
Allocated once at `WEATHER_MAX = 4096`; the preset moves
`geometry.setDrawRange(0, count * 6)` rather than reallocating. `Uint32` indices
(`particles.js:506`).

**Placement — one draw, no CPU state.** In the vertex shader:

```glsl
// Per-index deterministic base point in the unit box. NEVER Math.random —
// ARCHITECTURE.md §6, same rule particles.js:304-305 and surfWake.js:130-136 follow.
vec3 h = hash31(float(i));                  // in [0,1)^3
vec3 base = (h - 0.5) * uBox;

// Toroidal wrap around a box centred on the camera. Same idea lib/deform
// addresses the terrain state with (deformation.js:16-19).
vec3 rel = base + uDrift;                   // uDrift is PRE-WRAPPED on the CPU
rel = mod(rel - uCamPos + uBox * 0.5, uBox) - uBox * 0.5;
vec3 world = uCamPos + rel;
```

`uDrift` is a single retained `Vector3` on the CPU:
`_drift.addScaledVector(_vel, dt)` then `_drift.x %= BOX.x` (and y, z). Wrapping it on the
CPU keeps the shader's `mod()` argument small — an unwrapped `uTime * drift` reaches
4,800 m after ten minutes at 8 m/s **[derived]**, where fp32's ULP is still ~0.5 mm so it
would in fact survive, but the wrap costs three modulos a frame and removes the question.

**Wind coupling.** Read exactly as spray does (`particles.js:362-364`):

```glsl
// CPU side, in WeatherField.update():
const wa = bearingRad(S.windDirection);            // core/bearing.js — same call as
const g  = 2.4 * S.windStrength * P.windGain * gust;  // particles.js:362, sky.js:663,
_vel.set(Math.sin(wa) * g, -P.fallSpeed, Math.cos(wa) * g);  // terrain.js:446, deformation.js:386
```

Using `bearingRad()` and the same `2.4 × windStrength` base is what keeps the storm, the
plume, the cloth, the fur, the sastrugi and the cirrus in one register — the argument
`particles.js:64-70` makes for the spray.

**Gusts must not write `S.windStrength`** (it is a user slider). The gust scalar lives on
the weather module:

```js
gust = 1 + P.gustAmp * (0.68 * n1(t * 0.11) + 0.32 * n1(t * 0.37));
```

Published as `weather.gust` so `src/audio/audio.js:434` can pass
`S.windStrength * weather.gust` into the wind bed (`voices.js:234` takes `strength` 0..2) —
**recommended, not required**; it is a one-line change and it is what makes a storm audible.

**Billboards — velocity-stretched, because weather must read at 19.5 m/s.**
`surfWake.js:95` fixes the controller's top speed at 19.5 m/s. At that speed a flake's
*relative* velocity is dominated by the camera's own motion, and a round camera-facing
billboard degenerates into a static dot field — the classic "why does the snow not move"
failure. So the quad is stretched along the screen-space projection of
`vRel = particleVel − cameraVel`:

```glsl
vec3 vRel   = uPartVel - uCamVel;                  // uCamVel differenced from camera.position
vec2 sDir   = normalize(projectDir(vRel));         // in clip-space XY
float k     = clamp(1.0 + 0.9 * length(vRel) / 8.0, 1.0, uStretchClamp);
vec2 rc     = corner.x * perp(sDir) + corner.y * sDir * k;
vec3 world  = a.xyz + (camRight * rc.x + camUp * rc.y) * radius;
```

At 19.5 m/s: `k = 1 + 0.9 × 20/8 = 3.25` **[derived]**, so a 0.012 m Cold flake draws as a
0.012 × 0.039 m streak. Standing still, `k → 1` and it is a round flake. That single term is
the difference between weather and confetti.

**Kinds.** Two hash bits off the index select fine / coarse / glow, with the per-realm
radii, alphas and tints from §1e. Ash additionally uses one bit to split falling embers
(+0.90 m/s) from rising smoke (−0.45 m/s) — **two behaviours, one draw**.

**One draw call, one blend mode.** `premultipliedAlpha: true` with
`THREE.NormalBlending` (src `ONE`, dst `ONE_MINUS_SRC_ALPHA`). A translucent flake emits
`rgb * a` with a real `a`; an ash ember emits a bright `rgb` with `a ≈ 0.10`, which behaves
additively without a second pass. **Any design that needs a separate additive draw is
rejected** — see the §4 cap.

**Material flags** (mirroring `particles.js:231-245`, with two deliberate differences):

| Flag | Value | Why |
|---|---|---|
| `transparent` | `true` | |
| `depthTest` | **`true`** | This is what culls flakes that wrap below the terrain, **for free** — the opaque pass already wrote depth. It is why weather never calls `terrain.heightAt()` |
| `depthWrite` | `false` | must not occlude the plume behind it |
| `side` | `DoubleSide` | |
| `premultipliedAlpha` | **`true`** | spray uses `false` (`particles.js:244`); weather needs premultiplied to get one blend mode for both flakes and embers |
| `renderOrder` | **`3`** | spray is 2 (`particles.js:260`), wake and terrain are 1, sky is 1000 |
| `frustumCulled` | `false` | every quad is placed in the vertex shader (`particles.js:255`) |

**Fog / visibility coupling — the part that actually sells the storm.**
`uFog` reaches every material through `lib/atmosphere`'s `aerial()`
(`atmosphere.glsl.js:303-309`), and `Sky.update()` rebuilds it from `S` every frame
(`sky.js:414-416`). Change that one line to fold in a multiplier the realm owns:

```js
// src/render/sky.js:414-416, after the change:
this.uniforms.uFog.value.set(
    S.fogDensity * this.fogBoost.density,
    S.fogHeightFalloff * this.fogBoost.falloff,
    S.fogStart, S.aerialStrength
);
```

`fogBoost` defaults to `{density: 1, falloff: 1}`, so **the change is a no-op until a realm
sets it** and the overlay sliders keep working as overrides. A blizzard at ×1.9 takes
`fogDensity` from 0.0072 to 0.0137 **[derived]**, which halves visible range across the
whole frame at once. **That flattening does more to sell a storm than the particles do** —
3072 flakes over a 140 m box is one flake per 285 m³, which is a light flurry; the *fog* is
the blizzard.

**Dust devils (Sand only), at zero extra draw calls.** Reserve the **last 512 indices** of
the lattice. For `i >= uCount - uDevilCount * 128`, place helically around
`uDevil[k] = (centre.xz, radius, height, spin, strength)` instead of in the box:

```glsl
float u = fract(hash11(float(i)) + uDevilT * spin);
float y = h.y * height;
float r = radius * (0.35 + 0.65 * y / height);      // cone, wider at the top
world = vec3(centre.x + cos(u * TAU) * r, groundY + y, centre.y + sin(u * TAU) * r);
```

Three devils drift on their own slow noise and are recycled when they leave 90 m.
`uDevilCount = 0` in Cold and Ash, which returns those indices to the sheet. **[call]** —
if D3 runs short of time, ship the sandstorm sheet with `uDevilCount = 0` and the devils
land later with no structural change.

### 3.3 How weather must not fight the surf-wake pool

Five rules, each with the line it protects:

1. **Weather never calls `spray.emit()`.** Zero shared slots, so the plume's 3500-live
   budget (`particles.js:93-95`) is untouched and no emission is ever dropped
   (`particles.js:41-42`).
2. **`renderOrder = 3` against spray's `2`** (`particles.js:260`). Both are in Three's
   transparent list, sorted by `renderOrder` then depth, so the weather sheet composites
   *over* the plume — correct, because the plume is inside the storm.
3. **Not a prepass caster.** The wake registers (`surfWake.js:389`) because it is a
   two-metre opaque wall; weather is translucent, and putting it in the prepass would make
   TAA reproject the ground behind every flake.
4. **Not a shadow caster.** 3072 quads into two cascades would be +2 draws and a large fill
   cost for a shadow nobody can resolve.
5. **Never calls `terrain.heightAt()`.** Rule 2 of the material flags table (`depthTest:
   true`) makes the opaque depth buffer do the occlusion, so the 16-tap bicubic
   (`heightfield.js:289-298`) stays out of the frame entirely.

### 3.4 Constants

```js
// src/vfx/weather.js
const WEATHER_MAX   = 4096;   // geometry allocated once; setDrawRange moves the count
const STRETCH_BASE  = 0.9;    // velocity-stretch gain
const STRETCH_VREF  = 8.0;    // m/s at which the stretch reaches 1 + STRETCH_BASE
const NEAR_FADE     = [2.5, 6.0];   // m — a flake at 1 m is a full-screen blur
const FAR_FADE_FRAC = 0.85;   // fraction of the box half-extent where alpha reaches 0
const MAX_SCREEN_H  = 0.06;   // clamp of the projected half-height, in viewport heights
const DEVIL_MAX     = 3;
const DEVIL_INDICES = 128;    // reserved lattice indices per devil
const GUST_F1       = 0.11;   // Hz
const GUST_F2       = 0.37;
```

`MAX_SCREEN_H` is the fill safety valve: without it a single particle that wraps in one
metre from the near plane rasterises the whole screen and the frame falls off a cliff.

---

## 4. PERF BUDGET

**Baseline to protect: 22 draw calls / 1,799,120 triangles.** (Given as verified context for
this task; I did not re-measure it this run.)

Reference points already in the tree, for scale:

- spray: `CAPACITY * 2 = 10,240` triangles, 1 draw (`particles.js:263, 507`)
- wake: `8,636` triangles, 1 draw + 2 cascades + 1 prepass (`surfWake.js:909, 331, 389`)
- so the clipmap carries essentially all of the 1.8 M

### 4.1 Per preset

New `S` key `weatherParticles`. Because `PRESET_KEYS` is the union of every key any preset
touches (`settings.js:345-350`) and `PRESET_BASELINE` captures the boot value
(`settings.js:358-363`), adding it to `balanced` and `performance` automatically makes it
behave **totally** — stepping down to `performance` and back to `ultra` lands on 3072 again.
It needs no accessor routing (unlike `resolutionScale` / `deformResolution` /
`preset`, `settings.js:478`) because it changes a draw range, not an allocation.

| Preset | `weatherParticles` | Triangles added | % of 1,799,120 | Draws added | Overdraw budget |
|---|---|---|---|---|---|
| `ultra` | 3072 | 6,144 | **+0.34 %** | **+1** | ≤ 0.50 screens |
| `high` | 3072 | 6,144 | +0.34 % | +1 | ≤ 0.50 screens |
| `balanced` | 1536 | 3,072 | +0.17 % | +1 | ≤ 0.28 screens |
| `performance` | 512 | 1,024 | +0.06 % | +1 | ≤ 0.12 screens |

All percentages **[derived]** as `2 × count / 1,799,120`.

### 4.2 The hard cap

> **Weather may add at most +1 draw call, +8,192 triangles (4,096 particles, +0.46 % of the
> baseline), and +0.50 screens of overdraw at `ultra`. CPU cost per frame: at most 8 uniform
> writes and 0 bytes uploaded.**

Any design that breaches any of the four is rejected. Specifically:

- a second additive pass → breaches the draw cap (this is why `premultipliedAlpha: true`)
- a shadow-caster registration → +2 draws, breaches the draw cap
- a prepass registration → +1 draw, breaches the draw cap
- a per-particle CPU loop or a data-texture upload → breaches the CPU line, and is
  unnecessary given the analytic placement in §3.2

**Overdraw arithmetic [derived].** At 1280×720 = 921,600 px, a 3072-particle field with a
mean stretched screen footprint of 6 × 18 px = 108 px covers 331,776 fragments = **0.36
screens**, inside the 0.50 budget with headroom for the near-field. `MAX_SCREEN_H = 0.06`
caps a single quad at 0.06 × 720 = 43 px of half-height, so no one particle can blow the
budget on its own.

### 4.3 Degradation on `performance`

The `performance` preset already sets `resolutionScale: 0.5` (`settings.js:326`), so the
*same* particle costs a quarter of the fragments. Combined with 512 particles instead of
3072, weather's fill cost on `performance` is **1/36th** of `ultra`'s **[derived]**
(6× fewer particles × 4× fewer pixels each). On top of that:

1. **The ember glow layer is dropped.** Ash falls back to the coarse fleck alone
   (`uGlintEmissive` still fires on the ground, which is cheaper — it is already in the snow
   fragment's glint block).
2. **`uStretchClamp` drops from 6.0 to 3.0.** Shorter streaks are directly less fill, and at
   half resolution the long tail is not resolvable anyway.
3. **The fog boost is halved** (blizzard ×1.9 → ×1.45). `performance` sets
   `showMountains: false` (`settings.js:328`), so there is no far field for the haze to
   act on — heavy fog there just flattens the frame for nothing. This is the same reasoning
   `settings.js:304-306` uses to justify killing the mountains first: **8.27 ms, 93 % of the
   sky draw**, by far the largest single toggle in the build.
4. **Dust devils off** (`uDevilCount = 0`), returning the reserved indices to the sheet.

For scale, the thing weather must never approach: the deformation sim is **4.15 ms at
2048²** (`settings.js:307`) and does not get cheaper when the output resolution drops. If
weather ever measures above ~0.6 ms on the Iris Xe verification machine, cut the count
before cutting anything else.

---

## 5. REALM PROGRESSION — cold → sand → ash

### 5.1 What exists

- `progression.realmsUnlocked = ["cold"]` at construction (`progression.js:171`) and at
  `newGame()` (`:404`); persisted into the save blob (`:435`) and restored with a
  `["cold"]` fallback (`:478-479`). **Nothing anywhere writes a second entry.** The array is
  a read-only artefact today.
- `SCALING.bands = { cold: [1,10], sand: [8,20], ash: [18,30] }` (`combatData.js:645`).
- Realm bosses are **fixed at the band maximum** (`combatData.js:650`), and
  `enemyLevelFor()` returns `max` immediately for `kind === "boss"` (`combatData.js:754`).
  The three `realmBoss` rows carry `fixedLevel` 10 / 20 / 30 (`combatData.js:556, 573, 590`).
- First-kill grants exist: `XP.objectivePct.realmBossFirstKill = 35`
  (`combatData.js:635`), gated on the `bossesKilled` flags already in the save schema
  (`progression.js:40`).
- `encounters.realm = "cold"` is a plain field (`encounters.js:170`), read by
  `enemyLevelFor()` (`:317, 399`), the alive cap (`:371`) and the pack filter (`:423, 432`).

### 5.2 The gate

```
kill the COLD realmBoss  (fixedLevel 10) → push "sand" onto realmsUnlocked
kill the SAND realmBoss  (fixedLevel 20) → push "ash"  onto realmsUnlocked
```

Written in `Progression`, on the same `bossesKilled` edge that already pays the 35 %
first-kill grant, so there is exactly one place a realm can unlock.

**The band overlap is deliberate and it reconciles cleanly.** A player leaves Cold at
level 10 (its boss is fixed there). Sand's band is `[8, 20]`, so on arrival
`enemyLevelFor("sand", 10)` clamps into the band and applies the −1/0/+1 spawn variance
(`combatData.js:646-647, 765-767`) → spawns at **L9–11**. The player is at the *bottom* of a
twelve-level band and grinds to 20, where the Sand boss waits. Same shape for Ash: arrive
at 20 into `[18, 30]`. Nothing needs re-tuning.

### 5.3 THE RECONCILIATION FINDING — Cold's realm boss

**`combatData.js` and `_spec/_build/roster_reconciled.json` disagree about Cold's realm
boss, and the roster is right.**

What `combatData.js` says:

```js
{ key: "moraineElder", name: "Moraine Colossus, 'The Moraine Elder'",
    realm: "cold", kind: "realmBoss", baseKey: "moraineColossus",
    hp: 2000, stance: 240, arenaM: 34, fixedLevel: 10, ...        // combatData.js:554-556
{ key: "shrinebreaker", name: "Pack-Ice Golem, 'The Shrinebreaker'",
    realm: "cold", kind: "miniboss", baseKey: "packIceGolem",
    hp: 760, ...                                                  // combatData.js:544-546
```

What the reconciliation says:

```json
"aName": "Shrinebreaker", "aRole": "Cold realm boss", "aBase": "#61 Frost Golem",
"aArenaHp": 2000, "aNote": "Core-gated; masonry lob; opens Sand",
"bKey": "shrinebreaker", "bKind": "miniboss", "bHp": 760, "bBaseKey": "packIceGolem",
"agree": false                                     // roster_reconciled.json:4512-4523
```

and, on Moraine specifically:

```json
"note": "Design park only — Sand gate is #61 Frost Golem / Shrinebreaker"
                                                    // roster_reconciled.json:4468
```

**The decisive fact is the asset manifest.** `assets/enemies/manifest.json` lists
`61_v3_cold_frost_golem` among the ten Cold bodies. It lists **no `moraineColossus` mesh**.
So as the tree stands, `combatData`'s cold realm boss is *unrenderable* — the realm gate
would fire on a body the player can never see. `roster_reconciled.json:4246` says as much
about the fallback: Moraine would have to be *"reuse Glacier Brute v2 at sizeScale ~1.9"*,
i.e. a palette-swapped stand-in for the capstone of the first realm.

**Therefore:** the cold→sand gate keys on the `BOSSES` row matching
`realm === "cold" && kind === "realmBoss"`, and **that row must first be corrected** to
`key: "shrinebreaker"`, base `#61 Frost Golem`, arena HP 2000, `fixedLevel: 10` — with the
existing `shrinebreaker` miniboss row re-keyed or promoted so the two do not collide on one
key. Correcting `combatData.js` is a data change outside D2's write scope; it is named here
so the gate is not built on the wrong row.

**Second finding, out of scope, reported rather than fixed.** The reconciliation itself
flags the corrected boss as over-budget:

```json
"name": "Shrinebreaker", "role": "Cold realm boss", "base": "#61 Frost Golem",
"arenaHp": 2000, "ttkAtL10_s": 74.9, "bolts": 167,
"verdict": "OUTLIER - over 60 s at the L10 anchor"   // roster_reconciled.json:4960-4967
```

74.9 s against a 60 s guard. Every other boss in the same table passes (Icewall 44.9 s,
Gatekeeper 56.2 s). Either the arena HP comes down to ≈1600 **[derived: 2000 × 60/74.9 =
1602]** or the player's L10 kit needs the Bolt augment (`AUGMENTS.LMB = 9`,
`combatData.js:126`) folded into the anchor. **Recommendation: drop arena HP to 1600.** It
is one number, it is the only lever that does not disturb the augment ladder, and it lands
the first realm's capstone inside the same guard as every other boss.

### 5.4 The other blocker: no pack tables outside Cold

`PACKS` holds six rows and **all six are `realm: "cold"`** (`encounters.js:132-146`:
Imp Warren, The Hunt, Ritual Circle, Glacier Line, Scout Screen, Elite Hunt). The filter at
`encounters.js:423` and `:432` is `PACKS[i].realm === this.realm`, so setting
`encounters.realm = "sand"` today produces **zero spawns** — a silent, empty realm rather
than an error. `ALIVE_CAP` already carries `sand: 8, ash: 8` (`encounters.js:95`), so the
caps exist and only the tables are missing. Authoring six Sand rows and six Ash rows is a
hard prerequisite for the switch, and it belongs to the realm-data builder (§6, Builder A).

---

## 6. CREATE vs MODIFY — the parallel split

**The cut line.** Every realm *look* value reaches the shaders through **one uniform block**:
`lib/realm`, declared by Builder B and written by Builder A's `realm.js`. Neither builder
edits the other's files. The interface between them is **the uniform names**, listed below,
and nothing else.

### The `lib/realm` uniform block — the interface contract

```glsl
uniform vec3  uGroundAlbedo;     // §1b base albedo
uniform vec3  uCompressCol;      // §1b compressed colour
uniform vec3  uIceCol;           // §1b "ice" channel colour (glass / slag)
uniform vec3  uLooseCol;         // §1b berm colour
uniform vec3  uRockColA;         // §1b rock A
uniform vec3  uRockColB;         // §1b rock B
uniform vec3  uSssShallow;       // §1b — replaces shading.glsl.js:212, sky.glsl.js:264
uniform vec3  uSssDeep;          // §1b — replaces shading.glsl.js:213, sky.glsl.js:265
uniform vec3  uCaveTint;         // §1b — replaces snow.glsl.js:541, wake.glsl.js:346
uniform vec3  uGlintTint;        // §1b
uniform vec3  uSprayAlbedo;      // §1f
uniform vec4  uSurfaceParams;    // x roughness, y f0, z thickness, w wrapAmount   §1b
uniform vec4  uCompressParams;   // x roughness, y thickness, z iceRough, w iceThick
uniform vec4  uRockParams;       // x gateLo, y gateHi, z looseRough, w bounceCoef
uniform vec2  uGlintCells;       // cellA, cellB                                    §1b
uniform vec2  uGlintSharp;       // sharpnessA, sharpnessB
uniform float uGlintEmissive;    // 0 = specular (Cold/Sand), >0 = emissive (Ash)
uniform float uFineMode;         // 0 sastrugi · 1 dune ripples · 2 crust cracks    §1b
```

18 names. Both builders code against this list from hour zero; neither has to wait.

### Builder A — "realm data + weather"

**CREATE**

| File | Contents |
|---|---|
| `src/realm/realmData.js` | The §1 table as plain data: `REALMS = { cold, sand, ash }`. No imports beyond nothing. Diffable without logic |
| `src/realm/realm.js` | The `Realm` class of §2.2 — `bootName()`, `uniforms`, `fogBoost`, `attach()`, `swap()`, `update()` |
| `src/vfx/weather.js` | `WeatherField` — §3.2, §3.4 |
| `src/shaders/weather.glsl.js` | `WEATHER_VERTEX` + `weatherFragment(opts)`; includes `lib/common`, `lib/noise`, `lib/atmosphere`, `lib/shadowLookup`, `lib/realm` |

**MODIFY**

| File | Change |
|---|---|
| `src/main.js` | the §2.3 diff, plus the warm-up note under it |
| `src/core/settings.js` | new keys `weather` (bool), `weatherParticles` (int); add `weatherParticles` to the `balanced` and `performance` rows (`:287-329`) |
| `src/combat/encounters.js` | six Sand and six Ash `PACKS` rows (§5.4); make `this.realm` (`:170`) settable through a method so a swap can clear in-flight packs |
| `src/progression/progression.js` | the `realmsUnlocked` writer on the `bossesKilled` realm-boss edge (§5.2); include the current realm in the save blob (`:435`) and restore it (`:478`) |
| `src/combat/combatData.js` | **flagged, needs owner OK** — the Cold `realmBoss` row correction of §5.3 |
| `src/audio/audio.js:434` | optional: `S.windStrength * weather.gust` into the wind bed |

### Builder B — "terrain / sky variant"

**CREATE**

| File | Contents |
|---|---|
| `src/shaders/lib/realm.glsl.js` | the 18-uniform block above, and nothing else |

**MODIFY**

| File | Lines | Change |
|---|---|---|
| `src/shaders/registry.js` | — | register `lib/realm` |
| `src/shaders/lib/terrain.glsl.js` | `124-159`, `184-223`, `264-313`, `328-373` | `terrainMacro` / `rockField` per-realm constants; `uFineMode` branch in **both** fine twins (§1b) |
| `src/shaders/lib/shading.glsl.js` | `212-213` | `shallowTint` / `deepTint` → `uSssShallow` / `uSssDeep` |
| `src/shaders/lib/shading.glsl.js` | `293-337` | `snowGlints`: `uGlintCells`, `uGlintSharp`, the facet cull at `:265`, the tilt at `:277` |
| `src/shaders/snow.glsl.js` | `342-345`, `348-356`, `360-367`, `389-398`, `434`, `473`, `514-519`, `541` | every literal in §1b |
| `src/shaders/wake.glsl.js` | `221-222`, `346` | albedo, roughness, `caveTint` |
| `src/shaders/sky.glsl.js` | `264-265`, `538`, `540-542`, `660` | far-range subsurface tints, snow-line gate, albedos, cirrus colour |
| `src/shaders/skyBake.glsl.js` | `46`, `51-54`, `58`, `252` | `H_MIE`, `BETA_R`, `BETA_M`, `MIE_G`, `MS_BOOST`, grazing tint → bake-pass uniforms |
| `src/shaders/detailBake.glsl.js` | `66-69`, `79-84` | grain radius, dome profile, cavity depth, cell counts, weights |
| `src/shaders/spray.glsl.js` | `172`, `192-193`, `206` | `uSprayAlbedo`, wrap, forward lobe, edge alpha |
| `src/shaders/post/tonemap.glsl.js` | `158` | speed-streak tint |
| `src/render/sky.js` | `79`, `211-216`, `263`, `414-416` | `SNOW_ALBEDO` → per-realm; new bake uniforms; `uCloudAmount` from realm; `fogBoost` fold-in |
| `src/terrain/terrain.js` | `78`, `206-220`, `367-371`, `386-395` | `GRAIN_SCALE` per realm; `setRealm()`; the re-bake flag extended to a realm edge |
| `src/terrain/heightfield.js` | `114-119`, `149-166` | thread the realm into the two bake passes |

### Collision audit

| File | A | B |
|---|---|---|
| `src/main.js` | ✔ | — |
| `src/core/settings.js` | ✔ | — |
| `src/realm/*`, `src/vfx/weather.js`, `src/shaders/weather.glsl.js` | ✔ | — |
| `src/combat/*`, `src/progression/*`, `src/audio/*` | ✔ | — |
| `src/shaders/**` (except `weather.glsl.js`) | — | ✔ |
| `src/render/sky.js`, `src/terrain/*` | — | ✔ |

**No file is touched by both.** The only coupling is the 18 uniform names, and both builders
have them in this document before either starts.

### Order of landing

1. Builder B lands `lib/realm.glsl.js` **first**, with Cold's current literals as the
   default uniform values. Every shader then compiles and the frame is byte-identical to
   today — a safe, verifiable no-op commit.
2. Builder A lands `realmData.js` + `realm.js` writing only Cold. Still a no-op.
3. Both then land their Sand and Ash halves independently. The first realm swap becomes
   testable the moment both are in; neither is blocked before that.

---

## 7. Out-of-scope findings (named, not fixed)

1. **`PACKS` has no Sand or Ash rows** (`encounters.js:132-146`). Setting
   `encounters.realm = "sand"` produces a silently empty realm. Blocks the switch.
   → Author six rows per realm (§5.4).
2. **`realmsUnlocked` has no writer** (`progression.js:171, 404, 435, 478`). Nothing can ever
   unlock a realm today. → §5.2.
3. **Cold's realm boss is unrenderable as specified** — `moraineElder` / `moraineColossus`
   has no mesh in `assets/enemies/manifest.json`. → §5.3.
4. **Shrinebreaker at arena HP 2000 is a 74.9 s TTK against a 60 s guard**
   (`roster_reconciled.json:4960-4967`). → recommend 1600.
5. **`uCloudAmount` is hard-coded `0.55`** at `sky.js:263` with the comment *"Hard-coded in
   the reference's render(), not a setting"*. It must become realm data before Ash's soot
   ceiling is possible.
6. **`S.ambientBlue` is declared but never read by the sky** (`settings.js:56`;
   `_spec/sky.md:121` confirms). It is a dead slider today. Either wire it into
   `skyIrradiance`'s output or delete it — a lever that lies is exactly what
   `settings.js:10-21` was written to prevent.
7. **The shell accent is Cold-frost hard-coded** at `main.js:875-876`
   (`hi:#cdefff`, `lo:#6cc3ea`, `edge:#a8dcf5`), and the same palette is duplicated at
   `src/ui/hud.js:50` and `src/progression/xphud.js:83`. Three sites; they should read one
   realm accent.
8. **`weather.mesh` is missing from the warm-up list** in the §2.3 diff on purpose — see the
   note under it. Add it to `main.js:537-540` or accept a first-frame hitch on ANGLE/D3D11.
