# BLACKRIDGE — AAA Visual Target & Critic Scorecard

Status: DESIGN CONTRACT v1 (2026-08-19). This document is the visual bar every build
iteration is graded against. The scorecard at the bottom is binding: the harsh critics
grade against its anchors, and the ship bar is not negotiable.

Doctrine compliance: everything here obeys GAME_DOCTRINE.md — §3 rendering/perf
(fixed light pools, DPR ≤ 1.5, shadow 1024, compileAsync pre-warm, p99 verdicts),
§5 verification, §6 shell contract, §7 no primitive hero assets. Where this document
and the doctrine conflict, the doctrine wins.

---

## 0. What we are actually chasing (grounded in real analyses)

What makes MW2019 (IW 8.0 engine) look the way it does, per sources read this session:

- **Photogrammetry-derived materials** — surfaces have measured micro-variance, never
  flat authored values. Digital Foundry's engine reveal: texture detail "defined to
  the smallest cracks and bumps," lighting playing over duct tape on a helmet.
  ([DF engine reveal, via ResetEra](https://www.resetera.com/threads/digital-foundry-call-of-duty-modern-warfare-2019-the-new-cod-engine-revealed-analysed.120267/),
  [summary](https://dailytech.page/2019/05/30/jump-to-generation-digital-foundry-about-the-picture-call-of-duty-modern-warfare/))
- **Every light is volumetric** — DF: developers dial atmosphere density from dust
  motes to humidity to ground fog; god rays are "actual results of accurately
  rendering volumetric lights beaming through geometry." Light has a MEDIUM to
  travel through; that is half the cinematic look.
- **A heavily precomputed GI pipeline** — Infinity Ward presented their improved
  precomputed lighting pipeline at SIGGRAPH 2020 ([Advances in Real-Time Rendering](https://advances.realtimerendering.com/s2020/index.html)).
  The frame is dominated by BAKED bounce light + a small number of carefully placed
  realtime lights, not by dozens of dynamic lights. This maps 1:1 onto our fixed-
  light-pool doctrine.
- **Perf headroom spent where the eye looks** — Drobot's software variable-rate
  shading (same SIGGRAPH course): they *reduce* shading rate where the eye can't
  tell. Translation for us: budget discipline IS part of the look; a hitching
  pretty frame reads amateur.
- **Weapon animation as the emotional core** — Infinity Ward's animation team on
  making the player "feel like a Tier 1 Operator"; reloads, ADS, weapon handling
  each hand-tuned ([Activision blog](https://blog.activision.com/call-of-duty/2019-07/Modern-Warfare-Initial-Intel-Detailing-Advancements-in-Animation-and-Authenticity)).
  30% of every frame is the viewmodel; it is the single highest-leverage asset.
- **A restrained filmic post stack** — the CoD lineage look (per Angelo Pesce's
  [retrospective on CoD rendering](http://c0de517e.blogspot.com/2016/08/a-retrospective-on-call-of-duty.html)
  and the [NVIDIA MW2019 settings guide](https://www.nvidia.com/en-us/geforce/guides/gfecnt/call-of-duty-modern-warfare-pc-graphics-and-performance-guide1/))
  is filmic tonemapping, subtle grain, tight bloom — never the over-bloomed,
  over-vignetted "cinematic mode" of hobby projects.

What we deliberately do NOT chase (adoption_plan.json skip list, measured): the full
AAA post chain (MRT prepass, GTAO, TAA, motion blur, Karis bloom) ran 28–30 fps p50
on Apple silicon in Claude-of-Duty AFTER optimization. Dead on arrival for our 60 fps
p99 target at DPR 1.5. We get the look from lighting, materials, atmosphere, and the
viewmodel — not from pass count.

### 0.1 The scene choice is a rendering decision

**Prescription: rain-soaked industrial compound at blue hour (late dusk), overcast,
strong practicals.** Working name for the setting: a Black Sea port facility.

Why this exact setting (each reason is a WebGL cheat):
1. **Blue hour hides LOD.** Low ambient means distant simplification vanishes into
   atmosphere. Bright noon sun is the hardest lighting to fake; MW2019's most
   praised sequences are night/dusk raids for the same reason.
2. **Wet surfaces are the cheapest AAA sell in WebGL.** Rain → roughness drops →
   practicals and sky stretch into long specular streaks on asphalt. An env-map +
   low-roughness ground gives 80% of "screen-space reflections" for 0% of the cost.
3. **Practicals justify the fixed light pool.** Sodium floodlights, interior
   fluorescents, vehicle headlights — each an emissive mesh + a pooled point light
   + a volumetric cone card. A handful of motivated pools reads as "lit by an
   artist"; uniform brightness reads as "lit by an ambient constant."
4. **Rain animates the whole frame.** Streaking drops, drip lines, puddle ripples,
   fog drift — constant micro-motion is a big part of why AAA frames feel alive
   and static hobby frames feel dead.

If the level designer overrides the setting, the replacement MUST state its
equivalent cheats before build starts (this section gets amended, not ignored).

---

## 1. Lighting

**The rule: ONE coherent key, motivated fills, darkness allowed to be dark.**

- **Key light**: one THREE.DirectionalLight — the last cold skylight of dusk, low
  angle (12–18° elevation), desaturated steel-blue (#a8c4e0 region), intensity set
  so exposed metal reads clearly but shadowed areas fall to near-silhouette.
  This is the ONLY shadow-casting light (shadow map 1024, doctrine cap). Tight
  shadow frustum around the play space; camera-following if the map exceeds it.
- **Ambient**: HemisphereLight only — sky term cold blue-grey, ground term dark
  asphalt brown. NO THREE.AmbientLight. Ambient ceiling low enough that unlit
  interiors are actually dark. **Amateur tell #1 is ambient-only lighting**: if
  you can delete the key light and the frame barely changes, the frame fails.
- **Key:ambient ratio ≥ 4:1** measured on a white card facing the key vs facing
  away. Verify with a probe, not by eye (render a calibration sphere at boot in
  dev mode, read pixels via the /__shot/ capture path).
- **Fixed light pool** (doctrine §3 — light COUNT is a shader-permutation key,
  +33–36 recompiles at 640–900 ms measured when it changes). Allocate at boot,
  `visible:true, intensity 0`, never add/remove:
  - 1 directional (key, shadows)
  - 1 hemisphere
  - 8 point lights: ~4 parked on hero practicals (flood towers, interior), ~4
    rotating duty pool for muzzle flashes / explosions / flashlight bounce.
  - 1 spot (player flashlight / mounted light, if the mission uses one).
  All materials compile against this exact pool during the compileAsync pre-warm.
- **Baked vs realtime split** (no build step, so "baked" = computed at generation
  time by the map generator, or at load):
  - **Vertex AO** baked by the map generator into vertex colors (or a per-mesh AO
    attribute) for all static architecture — corner darkening is the #1 thing that
    grounds geometry. Cheap raycast bake at generation time, stored in the emitted
    geometry. An SSAO pass is NOT the plan (skip list).
  - **Blob/contact shadows** under every prop and vehicle: a soft radial-gradient
    canvas texture on a ground-hugging quad. **Amateur tell #2 is floating props**
    — an object with no contact darkening reads as pasted-in at any distance.
  - **Practical glow pools**: each practical gets (a) emissive mesh, (b) a baked
    ground gradient decal simulating its pooled light on wet asphalt, (c) only the
    hero ones get a real pooled PointLight. Distant practicals are emissive + decal
    only — the eye cannot tell.
- **Physically plausible intensity discipline**: with AgX/ACES active, author
  emissives ABOVE 1.0 (2–6) so they bloom and roll off filmically; never fake
  brightness by whitening albedo. Practicals get warm sodium (#ffb46b) or cool
  fluorescent (#dfe9ff) — the warm/cool contrast against the blue-hour key is the
  color script of the whole level.
- **Interiors**: every window/door visible from outside either glows (practical
  inside) or is genuinely dark with a visible interior shell — **amateur tell #3
  is the dead black window texture**. A 1-room interior box + one practical behind
  a window costs almost nothing and reads as a living building.

## 2. Post stack

CoD ships: filmic tonemap, TAA, motion blur, per-object MB, GTAO, bloom, grain,
subtle CA, graded LUT. We ship the subset that holds 60 fps p99 at DPR 1.5:

**Pipeline: scene render → half-res selective bloom → ONE composite pass.**
(The kernel already carries AgX/ACES + UnrealBloom — verified markers in
render_quality_gate.py per adoption_plan.json. Build on that; do not fork it.)

- **Tonemapping: AgX** (`THREE.AgXToneMapping`, in r172), exposure tuned 1.0–1.3.
  AgX over ACESFilmic because AgX desaturates highlights more gracefully (no ACES
  orange-fire skew) and its muted rolloff IS the modern-military palette. Renderer
  outputColorSpace sRGB. **Amateur tell #4: NoToneMapping with clamped whites** —
  any full-white pixel cluster that isn't a light source fails the frame.
- **Bloom: UnrealBloomPass at half resolution, threshold ≈ 1.0, strength 0.25–0.4,
  radius 0.5–0.7.** Bloom exists so EMISSIVES glow — muzzle flashes, practicals,
  tracers. If white walls bloom, the threshold is wrong. CoD's bloom is nearly
  subliminal; over-bloom is the single most common hobby tell.
- **One composite ShaderPass** doing all of the following in a single fragment
  shader (each as its own pass would eat the frame budget):
  - **Vignette**: subtle, 0.25–0.35 strength, wide smooth falloff. Should be felt,
    not seen. Slightly deepens during ADS and damage.
  - **Film grain**: animated per-frame, luminance-weighted (stronger in shadows),
    amplitude 0.02–0.035. Kills WebGL's "too clean" gradient banding — this is
    disproportionately important for the AAA read.
  - **Chromatic aberration**: radial, ZERO at center, ≤ 1.5 px at extreme corners.
    Briefly amplified (×3, 150 ms) on explosions/heavy damage. If visible while
    standing still looking at the frame center, it is too strong.
  - **Color grade**: lift/gamma/gain + saturation in-shader (a 3D LUT texture is
    allowed but not required). Grade target: lifted cool shadows (slightly blue,
    floor never pure black), neutral mids, desaturated highlights, global
    saturation ~0.9, warm practicals allowed to punch through. The frame should
    feel COLD with warm islands.
  - **Sharpen**: contrast-adaptive, ~0.2 amount, compensates DPR ≤ 1.5 softness on
    high-DPI screens. Never over the halo threshold.
- **Explicitly NOT shipped** (skip list, measured to break our budget): GTAO/SSAO,
  TAA, motion blur, DOF, SSR, lens flares beyond a subtle streak sprite on the
  brightest practicals. Real AA: the DPR supersample IS the AA; add FXAA in the
  composite only if jaggies survive at DPR 1.5.

## 3. Materials

**The #1 amateur tell in all of realtime rendering is uniform roughness.** A single
scalar roughness on a large surface reads as plastic at every lighting angle. Every
surface in BLACKRIDGE that is larger than a rifle magazine MUST have a roughness
MAP with visible variance. This is the cheapest possible AAA win: wet asphalt with
dry patches, blotchy mud, finger-polished metal edges — variance is the photograph.

- **PBR discipline** (MeshStandardMaterial everywhere; no MeshPhong, no Lambert):
  - Albedo: mid-value, never pure black/white (charcoal ≥ #1a1a1a, snow ≤ #e8e8e8).
    No lighting painted into albedo (no baked highlights — that's what the actual
    lights are for).
  - Metalness: binary discipline — 0 or 1, blended only at painted-metal chip
    edges. Painted metal is metalness 0 (dielectric paint) with metal showing only
    through wear.
  - Roughness maps for everything: asphalt 0.55–0.95 range within ONE surface
    (puddle centers approach 0.05 in the rain treatment, §4); painted steel
    0.4–0.7 with rust blooms to 0.9; concrete 0.7–0.95 with smooth trowel marks.
- **Texture sources, in priority order** (no build step — everything loads as
  files or generates at boot):
  1. **On-disk assets first**: check the F:\ asset store (per memory:
     reference_assets_on_F_drive) and existing FFG shared assets for license-clean
     PBR sets (asphalt, concrete, corrugated steel, rusted metal). Verify actual
     availability at build time — do not assume.
  2. **Canvas-procedural generation at load** for whatever is missing: layered
     value noise + Voronoi grunge + directional streaks composited on an offscreen
     canvas into albedo/roughness/normal triplets. This is a solved technique and
     it beats a repeating downloaded texture — every generated surface is unique.
     Generate ONCE at boot, cache, and pre-warm (texture upload stalls are hitch
     attribution class 2, doctrine §3).
  3. Normal maps from height via Sobel on the same canvas — every material gets
     micro-normal detail; flat normals read as CG instantly.
- **Anti-tiling is mandatory**: **amateur tell #5 is the visible texture repeat.**
  Every tiled surface uses at least one of: (a) a second grunge layer at a
  non-integer UV scale multiplied in-shader, (b) macro-variation via vertex color
  tint from the generator, (c) decal breakup. Doctrine §3: UVs emitted in
  metres/TILE at build time — real-world texel density, consistent everywhere
  (~1.5–2.5 m per tile for architecture).
- **Trim sheets** for architecture: one 2048 atlas of window frames / door frames
  / vent grilles / panel seams / warning stripes, UV-mapped by the generator.
  This is how AAA gets dense believable detail with few materials — and it keeps
  our program count flat (one material, many meshes → mergeable, instanceable).
- **Decals — the grime pass is not optional.** A ring-buffered decal system
  (InstancedMesh quads, normal-offset, depth-tested) plus GENERATOR-PLACED static
  decals: rust streaks under every bolt line, drip stains under every window sill,
  oil blotches on the lot, edge wear on every corner at hand height, puddle-edge
  tide marks. Rule of thumb from the photogrammetry look: no 4 m² of surface
  without at least one unique breakup element. A clean surface is a lie about the
  world; grime is the history that makes it read as real.
- **Characters**: Meshy auto-rigged soldiers per doctrine §1 (materials repaired
  at load: metalness 0, roughness ~0.78, emissive black; clips stripped of scale
  and arm-position tracks; never the bind pose). **Weapons are hero assets** —
  doctrine §7 bans primitive hero assets: source weapon GLBs from Meshy
  hard-surface generation or license-clean staged models, then ADD roughness
  variance + edge-wear treatment at load. The viewmodel weapon is the closest,
  most-stared-at surface in the game; it gets the densest material treatment in
  the project (§5).

## 4. Atmosphere

DF's one-line summary of MW2019's look — "every light is volumetric" — is the gap
between a rendered scene and a photographed one. We fake the medium three ways:

- **Height fog** (in-shader, driftwake pattern — exp² density with height
  falloff; driftwake ships fogDensity 0.0072 / heightFalloff 0.045 as a proven
  starting point): dense at ground level, thinning with altitude, tinted the
  sky's blue-grey and slightly brightened toward the key-light azimuth (cheap
  in-scatter). Distant structures LOSE CONTRAST AND SATURATE TOWARD SKY — aerial
  perspective is what makes 400 m read as 400 m. **Amateur tell #6: full-contrast
  full-saturation distant geometry** (the frame reads as a diorama).
- **Volumetric approximation — cone cards, not raymarching**: every hero practical
  gets a camera-facing (or axis-billboarded) soft cone mesh — additive, fresnel-
  faded at edges, depth-fade at intersections, animated density flicker ±5%. Flood
  towers get god-ray shafts through the rain the same way. This is the standard
  browser-budget volumetric fake and at blue hour it is nearly indistinguishable
  from raymarching. 10–20 cone cards, one shared material.
- **Rain, layered** (each layer cheap, the SUM is the weather):
  1. Rain streaks: 2–3 nested cylinders/boxes around the camera with scrolling
     streak textures at parallax speeds + a GPU particle layer for near-camera
     drops. Streaks lit slightly by the nearest practical color.
  2. **Wet-surface response — the payoff layer**: global "wetness" input on ground
     and up-facing materials → roughness × 0.35, albedo × 0.8 (darkening), and
     puddle masks (generator-placed in depressions, roughness ≈ 0.05, envMap
     visible) that mirror practicals as long specular streaks. THIS is the
     screenshot moment; if wetness reads only as "darker," it has failed —
     the test is visible elongated reflections of lights on the ground.
  3. Puddle ripples: animated normal perturbation (two scrolling ripple normal
     maps, or a cheap procedural ring shader) on puddle masks only.
  4. Drip lines from every roof edge and gutter (thin particle emitters, ~10
     total), splash sprites on impact.
  5. Distant rain = fog boost + faint diagonal streak layer over the skybox.
- **Dust motes / drifting particulate**: one ~200-particle field of slow near-
  camera drift, visible only against practicals and dark backdrops — sells the
  air as a medium for near-zero cost.
- **Sky**: gradient-LUT dome (driftwake's sky.js pattern) — blue-hour ramp with a
  bruised warm band at the horizon toward the dead sun azimuth, plus 2–3 layers
  of slow scrolling broken cloud (canvas-generated, parallax speeds), plus a
  faint city-glow dome over the port. **Amateur tell #7 is the dead sky**: a
  static gradient or star-field with no cloud structure and no horizon event.
  The sky must survive being magnified: fragment-shader/LUT sky, never a low-res
  equirect texture (magnification-proof sky is on the adoption shelf for exactly
  this reason).

## 5. First-person weapon rendering

The viewmodel is ~30% of every pixel the player ever sees. It gets more polish
budget than any other asset. Last-circle's benchmark audit (BENCHMARK_DIMENSIONS
.json, game-feel-juice) documents the exact failure to avoid: a static weapon
clone parented to a bone with zero response to firing.

- **Separate viewmodel FOV, SAME scene** (hard requirement): world camera FOV
  90–105° (player setting), viewmodel camera FOV ~54°. Implementation: THREE
  layers — render world with main camera, `clearDepth()`, render the viewmodel
  layer with the viewmodel camera. The viewmodel NEVER clips into walls (depth
  cleared) and never distorts at high world FOV.
  **WARNING (adoption_plan skip list, measured in Claude-of-Duty): a separate
  viewmodel SCENE is a known trap — ~20× irradiance mismatch that they patched by
  cheating albedo to one-third.** Same scene graph, same fixed light pool, two
  cameras, layer masks. The viewmodel must inherit muzzle-flash light, practical
  pools, and the key light identically to the world or it reads pasted-on.
- **Arms**: v1 minimum = weapon + two gloved hands/forearms (Meshy or authored),
  posed per weapon grip. Full sleeved arms with authored reload clips (Blender
  headless pipeline, doctrine §1 — purge stray actions before export) are the
  9→10 step. A floating weapon with NO hands caps the FP-weapon score at 6:
  **amateur tell #8**.
- **Procedural motion layers** (composed, in order, all spring-damped — never raw
  sines alone):
  1. **Idle breathe**: ±1–2 mm dual-sine drift, barely visible.
  2. **Sway**: mouse-look lag — viewmodel rotation trails camera yaw/pitch by
     2–4° through a critically-damped spring. THE single biggest weight cue.
  3. **Bob**: dual-sine (vertical 2× horizontal frequency) scaled by ground
     speed, Lissajous figure-8, damped to ~20% during ADS.
  4. **ADS transition**: hip pose ↔ precisely aligned sight pose, 0.20–0.28 s,
     smoothstep ease, world FOV −15° to −20°, viewmodel FOV tightens, sway gain
     ×0.3, bob ×0.2, vignette +0.05. The sight must land EXACTLY centered —
     verify with a pixel probe, not by eye (the 2-px-off red-dot is an instant
     amateur read). Sprint→ADS routes through a 80–120 ms lower-then-raise.
  5. **Sprint pose**: weapon canted 15–25° and pulled low, bob amplitude ×2.5,
     world FOV +5–8°.
  6. **Fire response**: per-shot viewmodel kick (translation back 8–15 mm +
     rotation up 1–3°, spring return), camera pitch kick with 70% recovery (a
     climbing pattern the player fights — last-circle's fully-self-recentering
     recoil is the documented anti-pattern), tiny camera roll noise.
  7. **Landing dip**: viewmodel + camera Y dip scaled by fall speed, 150–250 ms
     spring recovery. Wall-proximity pull-in pose optional v1.
- **Muzzle flash — LIGHTS THE SCENE**: 2-frame additive sprite cluster (star +
  side flare, randomized rotation/scale, 40–60 ms — longer looks like a torch) +
  one pooled PointLight (from the fixed pool, §1) pulsed warm-white to intensity
  for 50 ms, range 8–12 m — walls, rain streaks, and the character's own hands
  flash with each shot. In blue-hour rain this is a devastating (and cheap) AAA
  read. **Amateur tell #9: sprite-only muzzle flash that illuminates nothing.**
- **Shell ejection**: instanced brass, correct ejection-port position per weapon,
  arcing right-back with tumble, bounce sound + persistence 10–20 s (permanence —
  Vlambeer). Ring-buffer pool.
- **Tracers**: cosmetic bolt speed-capped ~200 m/s so hitscan is visible
  (last-circle's proven trick — the damage ray already resolved), elongated
  additive quad, warm core / cool falloff, NOT every round: every 3rd from the
  player, every round from AI at night (readability).
- **Impact response by surface**: decal ring buffer (64–128 normal-offset quads,
  ~20 s fade) + surface-typed particle burst (concrete chips + dust puff / metal
  sparks with gravity + brief glow / mud splat / water splash in puddles) +
  surface-typed audio. Sparks at night in rain: bright, short, gorgeous, cheap.

## 6. HUD / UI

Modern CoD HUD philosophy: information-dense but visually silent — thin weights,
high transparency, zero ornament. **Mil-sim clean, NOT sci-fi neon: amateur tell
#10 is glowing cyan borders and hexagon overlays.**

- **Typography**: one condensed grotesque family for HUD numerals/labels
  (Barlow Condensed / Rajdhani class — must be a bundled font file or system
  fallback stack; no external font fetch at runtime on the game path), Inter/
  system-ui for menus. 2–3 weights max. Tracking +2–6% on all-caps labels. No
  glow, no bevel, no gradient fills. Text drop shadow: 1 px soft black at 60% for
  legibility over the bright sky, nothing more.
- **Palette**: off-white #e8e8e4 at 85–92% opacity for primary info; ONE accent
  (desaturated amber #d9a441 — matches the practical color script) for highlights
  and pickups; red #ff4d4d RESERVED for damage/kill/critical. Nothing else.
- **Compass strip** top-center: bearing tape (N/NE/E ticks + degree numerals every
  15°), objective pips clamped to the tape edges with distance-in-meters, enemy
  ping wedges. ~55% opacity, thin hairline frame or none.
- **Ammo block** bottom-right: large current-mag numeral (700 weight), thin
  "/ reserve" at 40% size, weapon name in small caps above, fire-mode glyph.
  Mag count pulses amber ≤ 25%, red ≤ 10%. LOW AMMO text only under 25%.
- **Health**: no permanent bar (CoD convention) — screen-edge red vignette scaled
  by damage taken (NOT binary — last-circle's flat 0.4-alpha-for-0.7 s tint is
  the documented anti-pattern), desaturation ramp below 35% HP, faint pulse +
  heartbeat at critical. Regen clears with a subtle inward wipe.
- **Crosshair states**: 4 hairline ticks + optional center dot; gap breathes off
  the ACTUAL next-shot spread (last-circle pattern — the crosshair never lies);
  expands with fire/sprint, fades OUT entirely during ADS; ticks blank while
  pointing at a friendly.
- **Hitmarkers**: thin white ✕ 100–140 ms; headshot slightly larger; KILL = red ✕
  ~280 ms overriding the latch (last-circle's audit names the missing red kill-X
  as a gap — we ship it day one). Distinct audio tick, higher pitch on headshot.
- **Damage direction**: red arc segments on a screen-centered ring pointing at
  the attacker, 1.6 s fade; gunfire-direction chevrons fainter. (Last-circle's
  threat-ring implementation is the reference — it is already Apex-tier.)
- **Menus** (FFG shell contract §6 intact: __PAUSE__, ESC overlay, screenBefore,
  hotkey gating): full-bleed blurred/darkened mission still, left-rail vertical
  nav in caps with amber active tick, settings as clean rows with hairline
  dividers. Version marker bottom-corner 40% opacity. No panel borders, no corner
  brackets, no scan-lines.
- **Kill/objective feed** minimal: weapon-glyph kill line top-right 4 s;
  objective updates as brief center-lower text with a single amber underline
  sweep, never a blocking banner.

## 7. Animation & motion feel

What sells AAA in motion is DISCIPLINE — every movement damped, nothing instant,
nothing infinite (calibration baseline: last-circle's audit, where firing moved
nothing on screen and shake was per-frame white noise).

- **Camera shake = trauma system**: shake energy accrues from events (own shots
  tiny, nearby explosion large), amplitude = trauma², decay fast; offsets sampled
  from smooth noise (summed incommensurate sines) on game time — NEVER
  Math.random() per frame (reads as buzz and changes character with framerate,
  measured anti-pattern) — and include a ROLL component (rotation.z sells impact;
  translation alone reads as jitter). Distance-attenuated for world events.
- **FOV kinetics**: sprint +5–8° (0.25 s ease-out), ADS −15–20°, landing −2°
  dip-and-recover, explosion-within-8 m +3° punch 120 ms. FOV motion is the
  cheapest speed/impact seller in first person.
- **Hit reactions, both directions**:
  - Taking damage: camera roll-flinch toward the shot (1.5–3°, 150 ms), red arc,
    viewmodel jolt. Being shot must FEEL like being hit, not like a number change.
  - Dealing damage: enemies flinch per hit region (upper-body twitch / leg
    stumble) via a 70 ms additive material color-multiply flash (NOT emissive —
    Meshy albedo/emissive repair, doctrine §1) + hitmarker + surface blood-puff.
    Deaths: ragdoll-lite (3–4-bone procedural slump + fall) or directional death
    clips; bodies persist ≥ 20 s (permanence), never vanish mid-view.
- **Hitstop**: single-player, so free — 45–60 ms dt-scale on kills, 25–35 on
  headshots (keep rendering; scale sim dt only).
- **Locomotion camera**: head-bob subtle and speed-scaled (respect a reduce-motion
  setting), landing dip scaled by fall speed, slide/mantle camera tilts if those
  verbs ship. NO uncommanded camera motion ever exceeding ~3° — CoD's cameras are
  strikingly conservative; restraint IS the AAA read.
- **AI soldiers**: full-body Meshy clips (idle/patrol/aim/fire/flinch/death min),
  aim-pose blending toward the player, muzzle flashes + tracers identical to the
  player's (one FX system, two consumers), doctrine §2 fairness constants
  (300–800 ms reaction, aim jitter, ≤ 2 attack tokens, muzzle-block raycast).
  Frozen-pose or sliding-feet bots void the motion score (anchor D10).

---

# THE CRITIC SCORECARD (binding contract)

Grading protocol: critics grade SCREENSHOTS + SHORT CAPTURES from the live build
(the /__shot/ capture path + scripted play per doctrine §5) — never the code, never
descriptions, never the developer's claims. Standard battery per iteration (pin
these exact states so scores are comparable across iterations):
S1 hip-fire mid-firefight w/ muzzle flash · S2 ADS on an AI at range · S3 quiet
establishing wide of the compound · S4 close-up of ground/wall material in
practical light · S5 sky/horizon from an elevated position · S6 pause menu +
in-mission HUD · C1 6-second capture: sprint → stop → fire burst → reload.

Each dimension 0–10. Written anchors below at 5 / 8 / 10; interpolate for the
rest. A named amateur tell that is VISIBLE in the battery hard-caps its dimension
at the score listed with it, regardless of everything else done right.

**SHIP BAR: every dimension ≥ 8 AND mean ≥ 8.5 AND blind verdict at least
"borderline" from EVERY critic. Miss any one → iterate. No exceptions, no
averaging-away a weak dimension.**

### D1 — Lighting coherence
- **5**: A key light exists and casts shadows; but ambient does most of the work,
  interiors are as bright as exteriors, practicals are emissive textures that
  light nothing.
- **8**: One unmistakable key direction; ≥ 4:1 key:ambient; darkness is allowed
  to exist; hero practicals visibly pool warm light on wet ground; every prop
  contact-shadowed.
- **10**: The frame reads as photographed at a real hour of day. Light has an
  arguable color temperature everywhere; every bright pixel traces to a source;
  warm/cool color script deliberate and consistent. A lighting artist would ask
  who lit it.
- Hard caps: ambient-only look (delete-the-key-and-nothing-changes) → **max 3**.
  Any floating prop in the battery → **max 6**.

### D2 — Filmic response (tonemap + post)
- **5**: Some tonemapping, but highlights clip or skew; bloom smears everything
  bright; vignette/CA obvious as filters sitting ON the image.
- **8**: AgX rolloff everywhere; bloom only on emissives; grain/vignette/CA
  present but subliminal; shadows lifted cool, never crushed to pure black; a
  consistent grade visibly unifies the whole frame.
- **10**: Screenshot passes as a captured console frame in a lineup; the grade
  has an identity (cold, wet, sodium-warm islands) a colorist would sign; nothing
  clips, nothing crushes, no post effect is separately noticeable.
- Hard caps: clamped whites on non-lights → **max 4**. Bloom on diffuse white
  surfaces → **max 6**.

### D3 — Material truth (PBR discipline)
- **5**: PBR materials with plausible single values; but every surface has ONE
  roughness scalar — plastic-uniform response everywhere; normals flat or
  missing on hero surfaces.
- **8**: Every large surface shows roughness VARIANCE under a moving light
  (blotches, streaks, wear); micro-normals everywhere; metal/dielectric split
  correct; grime decals break every large plane; S4 close-up survives scrutiny.
- **10**: Surfaces read as having a specific history — rust that ran, oil that
  soaked, edges hand-polished. S4 could pass as a photogrammetry scan. Roughness
  response IS the frame's texture, not the albedo.
- Hard caps: uniform roughness across any hero surface in the battery → **max
  5** (this is THE amateur tell — enforce it viciously). Visible texture repeat
  at play distance → **max 6**.

### D4 — Atmosphere & depth
- **5**: Linear THREE.Fog exists; distance fades uniformly; no light shafts; the
  air is empty; distant geometry keeps full contrast (diorama read).
- **8**: Height fog with falloff; distant structures desaturate toward sky
  (aerial perspective states the map's scale); cone-card volumetrics on hero
  practicals; rain layers + wet response present; dust motes against practicals.
- **10**: The air itself is a subject of the frame — shafts drift, rain streaks
  catch practical color, S3 wide reads like weather actually happening in a real
  place. Deleting the atmosphere layer would delete the mood.
- Hard caps: full-contrast distant geometry → **max 5**. Wetness that only
  darkens with NO elongated practical reflections on ground → **max 6** (the
  puddle-streak is the contracted payoff of the rain setting).

### D5 — First-person weapon presentation
- **5**: A real (non-primitive) weapon model at a plausible screen position; but
  static under fire, no hands, sight misaligned in ADS, world-FOV distortion at
  the edges.
- **8**: Separate viewmodel FOV; hands on the weapon; spring-damped sway/bob/ADS
  with exact sight alignment; per-shot kick visible; muzzle flash lights the
  hands and nearby wall; shells eject; the weapon material is the best in the
  game.
- **10**: Indistinguishable in a still from a console FPS viewmodel — and in C1,
  the sprint→fire→reload sequence is fluid, weighted, and interruption-clean.
  Authored reload motion. You can FEEL the mass of the gun from the capture.
- Hard caps: floating weapon, no hands → **max 6**. Primitive/boxy weapon →
  **max 2** (doctrine §7 violation — also fails the build outright). Static
  viewmodel while firing in C1 → **max 5**.

### D6 — Combat VFX
- **5**: Muzzle sprite + some impact particles; no scene lighting from shots; no
  decals; no shells; tracers invisible or absent; the world is bit-identical
  after a firefight.
- **8**: Muzzle flash pulses a real pooled light; tracers visible with warm
  core; surface-typed impacts (sparks/chips/splash) + decals that persist ~20 s;
  shells on the ground; explosion = flash sprite + ring + smoke + debris, not
  confetti cubes.
- **10**: A firefight is a lighting event — flashes strobe the rain, sparks
  bounce with gravity and glow, smoke hangs and drifts, and the aftermath
  (decals, brass, scorch, bodies) tells the story of the fight 30 seconds later.
- Hard caps: muzzle flash that illuminates nothing → **max 6**. Zero permanence
  (no decals/shells/bodies after the fight) → **max 5**.

### D7 — Environment density & set dressing
- **5**: Recognizable buildings and roads; but repeated prop instances in
  identical orientations, bare walls, empty lots, no verticality, obvious
  modular seams.
- **8**: Every area has a REASON (loading dock, generator shed, checkpoint);
  props clustered the way work actually leaves them; trim-sheet detail on all
  architecture; cables/pipes/vents break silhouettes; generator-placed grime
  under every fixture; nothing floats.
- **10**: S3 reads as a functioning real place photographed at a bad hour —
  believable sightline design, layered silhouettes at three depths, every window
  either lit or honestly dark, set dressing that implies the last shift of
  workers just left.
- Hard caps: any prop floating or interpenetrating in the battery → **max 6**.
  Copy-paste prop rows in identical rotation → **max 6**.

### D8 — Sky & horizon
- **5**: A gradient or static texture; readable but inert; horizon is a hard
  line; magnification shows banding or texels.
- **8**: LUT/shader sky with blue-hour ramp + horizon event (warm bruise at the
  dead-sun azimuth, city glow); ≥ 2 cloud layers moving at parallax speeds; rain
  haze merges horizon into fog; survives being stared at through a scope.
- **10**: The sky is a character — cloud structure with lit and shadowed sides
  consistent with the key light, drift you notice only when you stop, and it
  ties the entire palette of the frame together. A matte painter would nod.
- Hard caps: dead-static sky over a 6 s capture → **max 6**. Visible
  banding/texels at ADS magnification → **max 5**.

### D9 — HUD/UI craft
- **5**: Functional compass/ammo/health; but mixed fonts, neon accents, opaque
  boxes, elements that shout over the scene.
- **8**: One typeface family, thin weights, 85–92% off-white + single amber
  accent + reserved red; compass tape + ammo block + damage arcs all present and
  silent until relevant; crosshair states honest to spread; menus are blurred-
  scene + left rail, zero ornament.
- **10**: Frame-worthy UI — the HUD could ship in a modern console shooter
  unchanged; every state transition eased; information hierarchy so clean the
  eye never hunts; menu stills look like marketing shots.
- Hard caps: any neon/sci-fi glow element → **max 6**. Sight misalignment or a
  lying crosshair (spread mismatch) → **max 6**.

### D10 — Motion feel (camera + animation discipline)
- **5**: Movement works, ADS works; but firing moves nothing on screen, shake is
  white-noise jitter, FOV is static, landings are instant, enemies play one
  looped animation and die by disappearing.
- **8**: Trauma-based smooth-noise shake with roll; FOV kinetics (sprint/ADS/
  landing); per-shot camera kick with partial recovery the player fights; hit
  flinches both directions; hitstop on kills; AI with full locomotion/aim/death
  clips, feet planted; C1 capture feels weighted end to end.
- **10**: C1 is indistinguishable in feel-read from a console FPS capture —
  every camera motion damped and purposeful, every impact answered in ≤ 100 ms
  on at least three channels (view, VFX, audio), death animations directional,
  nothing pops, nothing slides.
- Hard caps: zero physical response to firing your own weapon in C1 → **max 5**
  (the last-circle lesson, verbatim). Per-frame-random camera shake → **max 7**.
  Sliding/skating AI feet → **max 6**.

### The blind verdict (asked of every critic, every iteration, unprimed)

> "Shown this frame cold — no context, no slug, no expectations — would you
> believe it is from a AAA console title? **yes / borderline / no**"

Asked per-screenshot for S1–S5, and once overall. The SHIP requirement is at
least "borderline" overall from every critic. A single confident "no" from any
critic blocks ship regardless of dimension scores — the tell they saw gets named,
added to this document's amateur-tell list if new, and fixed at the generator
level (doctrine: fix the generator, not the artifact).

### Scoring output format (per critic, per iteration — machine-parseable)

```json
{
  "iteration": 0,
  "critic": "<id>",
  "scores": {"D1":0,"D2":0,"D3":0,"D4":0,"D5":0,"D6":0,"D7":0,"D8":0,"D9":0,"D10":0},
  "hard_caps_triggered": ["<tell> -> D3 capped 5"],
  "blind_verdict": {"S1":"no","S2":"no","S3":"no","S4":"no","S5":"no","overall":"no"},
  "worst_single_tell": "<one sentence naming the most damning artifact>",
  "fix_first": "<the single change that buys the most score>"
}
```

Mean = arithmetic mean of D1–D10 AFTER hard caps. The perf gate (60 fps p99 at
DPR 1.5, doctrine §3/p99 verdicts) is a separate, non-scored PASS/FAIL gate that
must also pass — a beautiful frame at p99 12 fps does not ship, and a critic
never trades visual score against performance (that trade is the engineers' job,
made under both gates).

---

## Sources used this session

- [Digital Foundry — CoD MW2019 engine reveal & analysis (ResetEra thread)](https://www.resetera.com/threads/digital-foundry-call-of-duty-modern-warfare-2019-the-new-cod-engine-revealed-analysed.120267/) — photogrammetry materials, all-lights-volumetric, dust motes/humidity/ground fog, god rays, tessellation, 8M-triangle scenes; also [summary](https://dailytech.page/2019/05/30/jump-to-generation-digital-foundry-about-the-picture-call-of-duty-modern-warfare/)
- [SIGGRAPH 2020 — Advances in Real-Time Rendering](https://advances.realtimerendering.com/s2020/index.html) — Infinity Ward precomputed lighting pipeline talk; Drobot software VRS
- [Activision blog — MW2019 animation & authenticity (Mark Grigsby)](https://blog.activision.com/call-of-duty/2019-07/Modern-Warfare-Initial-Intel-Detailing-Advancements-in-Animation-and-Authenticity) — weapon-feel philosophy
- [NVIDIA — MW2019 PC graphics & performance guide](https://www.nvidia.com/en-us/geforce/guides/gfecnt/call-of-duty-modern-warfare-pc-graphics-and-performance-guide1/) — shipped post/settings inventory
- [c0de517e (Angelo Pesce) — A retrospective on Call of Duty rendering](http://c0de517e.blogspot.com/2016/08/a-retrospective-on-call-of-duty.html) — CoD-lineage filmic look, baked+realtime philosophy

On-disk evidence read this session: GAME_DOCTRINE.md (all §§), reference_review_
2026-07/adoption_plan.json (Claude-of-Duty perf forensics: 25/47 wasted programs
without RT-bound compile, +33–36 recompiles on light-count change, p99 4–9 fps vs
94 avg, dual-scene viewmodel 20× irradiance trap, full-post-chain 28–30 fps
verdict), last-circle BENCHMARK_DIMENSIONS.json (game-feel-juice audit: the
documented static-viewmodel / white-noise-shake / no-permanence / binary-hurt-tint
anti-patterns and the proven tracer-speed-cap, barrel-position flash, honest-
crosshair, threat-ring patterns), driftwake src (importmap → vendored three
r172 as bare "three"; in-shader tonemap/fog uber-pass; fogDensity 0.0072 /
heightFalloff 0.045 baseline; sky LUT pattern).
