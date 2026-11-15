# SEAM MAP: RENDER lane for PLAYGROUND (read-only analysis, 2026-11-15)

Scope read: every file in `src/render/` (stage, table, env, bodyview, bodyproxy, material, jelly, face, fx, particles, halo, decals, strands,
cutfx, capsule, ceremony, rarity, flash, screenfx, quality, shaderlib, oklch, core, geodesic, stageDev, stubBody), `_harness/browser_render.mjs`,
`_harness/renderview/view.ts` (structure only), `src/contracts.ts` StageLike (lines 287-417), `_spec/CONTRACT.md` 7, `_spec/DESIGN.md` 5.3 / 6.6,
the render reports (RENDER_R, RENDER_FIX1, VERIFY_RENDER_A_R1, VERIFY_RENDER_B_R1). Nothing was built or run (no browser, no vite build).

## Summary

- The set is ONE hard-wired look: `Table` (table.ts:186) = a procedural dusk sky dome with an analytic ground (one shader) + a felt cylinder
  (R 3.5); three lights made inline in `buildStage` (stage.ts:188-194); one baked PMREM studio env (env.ts:57-110, `EnvHub` 128 px,
  stage.ts:196). No shadow maps anywhere: shadows are per-body decal quads (decals.ts). None of it is exposed or swappable today.
- The light direction and colour are ALSO baked into every jelly as uniforms (`uKeyDir/uRimDir/uKeyCol/uRimCol`, material.ts:386-390) and
  into a white balance against the amber key (`KEY_TINT`, material.ts:329-338). A place light must update these, or bodies keep Home's light.
- A place is very doable as a lazily imported "place look" object the stage owns (sky uniforms, ground mesh, backdrop, weather, lights, env
  panels); `EnvHub.rebuild()` (env.ts:138) already re-bakes and re-points every registered material, which is exactly a place swap.
- Bodies: fine mesh 2562 / 5762 / 10242 verts (low / med / high), one MeshPhysicalMaterial with an `onBeforeCompile` patch and ~45 uniforms
  (material.ts:27-88). Place looks (frost, wet, sand, toast, snow) fit as 5 new float uniforms in the same program (one cache-key bump).
- Faces: two bead eyes on the surface, blink, look, widen, happy arc. Every body looks at the SAME pointer (stage.ts:766). A per-body look
  target and named expressions are a small, contained change in face.ts + one optional StageLike member.
- Nothing billboard-with-normal-alpha exists: all sprites are ADDITIVE light (particles.ts:125, halo.ts ADD_KEEP_ALPHA). Emote bubbles need one
  new instanced, alpha-blended billboard draw with an SDF icon shader (no texture, CSP-safe).
- Ceremonies do not reference the Table at all, but they assume a flat ground at y = 0, a clear pad at (0, 0), a DARK backdrop (the burst
  is an additive screen ramp capped at alpha 0.25), and they hide every visible body (ceremony.ts:411, 605).
- Numbers: one whole body ~13 draw calls and ~18.9k triangles at med; a piece ~10 calls and ~14.9k triangles (pieces keep the full fine mesh);
  3 bodies cost x1.35 one body (med). Whole build 1133-1137 KB in 8 files; per-chunk sizes are NOT in any report (not measured here).

## 1. How the scene is built, and what a place needs

**Today, in order of construction (stage.ts `buildStage`, line 177):**
- Renderer: antialias, no stencil, ACES filmic, exposure 1.0, sRGB out, clear colour `PALETTE.ink` (stage.ts:178-182). Camera: perspective
  fov 35, near 0.1, far 200 (185).
- Lights (188-194): SpotLight amber 240 cd, angle 0.62, penumbra 1, at `KEY_DIR x 5.6`, aimed at (0, 0.2, 0); DirectionalLight lagoon 2.0 at
  `RIM_DIR x 6`; HemisphereLight 0x7a5ac8 / 0x2a2150, 2.4. Local `const`s: nothing outside buildStage can reach them.
- Environment: `EnvHub(renderer, 128)` (196) bakes `createEnvironment` once: a dark room sphere + 6 emissive softbox panels (env.ts:57-70),
  `PMREMGenerator.fromScene(scene, 0.035, 0.1, 100, {size})` (env.ts:105). Materials opt in with `hub.apply(mat, intensity)` (env.ts:127)
  because `scene.environment` ignores per-material intensity in three 0.186 (env.ts:112-115). Jelly 1.25, eyes 2.2 / 2.0, felt 0.2.
- Set (table.ts): sky = `SphereGeometry(1, 48, 32)` x 90, BackSide, depthTest/Write off, renderOrder -100, follows the camera
  (table.ts:205-211, 227). Below the horizon its fragment shader intersects a ground plane at `GROUND_Y = -0.045` analytically and fogs by
  depression angle (table.ts:58-71): "ground" beyond the mat is not geometry. Felt = CylinderGeometry R 3.5, h 0.06, 128 segments, top at
  y 0 (213-220), MeshPhysical with a fibre / vignette / stitched-ring patch (FELT_COLOR 104-140), 4 noise octaves, 2 on low (`setLite`, 225).
  All sky colours are uniforms built in the constructor (198-204) but private: no setter.
- Shadows / light pools: no `shadowMap` (grep: none in src/render). Each body has two decal quads on the table: contact shadow (renderOrder
  -40, y 0.002) and coloured light pool (-39, y 0.003), sized from the body's footprint every frame (decals.ts:127-155).
- Camera framing (stage.ts:510-556): aim `TARGET_Y = 0.42` x framing scale; distance `fitDistance = camScale x max(3.0, 2.4 / aspect)`
  (260) x zoom (0.55..1.9, 827) x ceremony push; pitch default 0.27, clamped 0.06..1.38 (213, 821). With 2+ visible bodies
  `framingFor` (271-325) frames all of them and aims at their middle; one body is followed at 0.6 of its offset (533).
- `matLayout(n)` (643-649): n clamped 1..5, nested slots in body-scale units: wide row `[0,0],[1.3,0],[-1.3,0],[2.6,0],[-2.6,0]` (87),
  portrait chevron `[0,0],[0.9,-1.3],[-0.9,-1.3],[1.8,-2.6],[-1.8,-2.6]` (88), switch at aspect 0.9.
- Quality (quality.ts:19-23): high fineFreq 32 / DPR <= 2 / transmission x1; med 24 / 1.5 / transmission x0.5; low 16 / 1 / no transmission
  (alpha-blended jelly, WH_LOW shader path). Glitter caps 150 / 100 / 48, bubbles 40 / 32 / 20. Auto starts at med and drops one tier
  when a 1 s window averages > 24 ms (quality.ts:35, 67); it never climbs back.

**What a place needs, and where it plugs in:**
- *Procedural sky*: the sky shader is already parametric (9 colour uniforms + fog near / far, table.ts:26-29). Two levels: (a) cheap, give
  `Table` a `setSky(params)` that writes those uniforms (beach day: pale zenith, warm horizon; snow: cold white-blue; cabin: night with
  a window glow); (b) per place, a new SKY_FRAG (sun disc, clouds by noise, stars) on the same full-screen sphere. The "sky" harness
  section (browser_render.mjs:259) checks seams and band edges at 4 aspects x 3 pitches: every new sky must pass it.
- *Ground with its own material*: replace / hide the felt cylinder and set the analytic ground colours (`uBase`, `uWarm`) to match. A place
  ground is one mesh with the same `onBeforeCompile` pattern as the felt (sand ripples, snow sparkle, wood planks, all noise over world xz,
  band-limited like FELT_COLOR 112-124 so it never shimmers). Keep the top at y = 0 under the play area: decals (decals.ts:134, 145),
  dust / table ring (fx.ts:420-450), particle bounce (`py < 0.01`, particles.ts:189), capsule rest and ceremonies all assume it.
  Heightfields (dunes, slope) are possible only outside the play disc, or the decals must sample a ground height (see 6).
- *Backdrop silhouettes*: far, opaque, unlit-ish meshes (palms, pines, cabin wall and window, mountains) between the sky (-100) and the
  ground (-50). Cheapest: a few flat cards / extruded shapes with a gradient shader, fogged to the horizon colour like FELT_FOG (148-153).
  Note they are drawn TWICE on med / high (three renders the opaque list into the transmission target), so keep them low-poly.
- *Weather particles*: snowflakes, sea spray, dust motes, embers. A dedicated `Particles(cap)` instance works today (particles.ts:89, one
  instanced draw, zero allocation, deterministic), but it is ADDITIVE (125): fine for embers / sparkles, wrong for snow on a white sky
  (invisible). Snow wants a normal-blend twin of the same class (a `blending` constructor option). Caps per tier, x0.3 in calm, none in
  reduced motion per DESIGN 6.6.
- *Place lighting and env*: needs (1) the three lights as stage fields with a `setLights(key, rim, fill)` path, (2) the jelly uniforms
  `uKeyCol/uRimCol/uKeyDir/uRimDir` per view updated from the place (material.ts:386-390), (3) `KEY_TINT` white balance re-derived from the
  place key colour (material.ts:329), else a beach in white sun still "corrects" for amber, (4) `PANELS` as data passed to
  `createEnvironment` (env.ts:57) and `EnvHub.rebuild` used for the swap (env.ts:138-142). Bake cost at 128 px is a one-off at travel
  time; not measured. `rebuild` today does NOT dispose the old cube on purpose (context-loss case, env.ts:134-137): a place swap must dispose it.
- *Swappable at run time*: add `stage.setPlace?(look | null)` (optional, additive). The stage keeps Home as the default look so the shell
  and every harness keep working with no call. Swap under a short fade (the ScreenFx crossfade, screenfx.ts:79, is a snapshot fade: reuse
  it, it is not a flash).
- *Lazy loading with Vite*: the stage is already its own chunk, loaded by `import('../render/stage.ts')` in src/shell/boot.ts:96. A place
  module `src/render/places/beach.ts` reached only through `import('./places/beach.ts')` (from the stage's `loadPlace(id)` or from the
  shell passing the result to `setPlace`) becomes its own chunk; it must import three by the same bare `'three'` specifier so Rollup keeps
  three in the shared stage chunk. CSP `script-src 'self'` (index.html:13) allows same-origin chunk loads. The vite.config.ts G0 gate
  measures the WHOLE output folder against 1.2 MB (vite.config.ts G0 constant): it must become first-load vs total (DIRECTION D9) before
  any place chunk lands, or it fails the build for the wrong reason.

## 2. Props from shared definitions

- Nothing exists: no InstancedMesh, no prop class (grep). The pattern to copy is BodyView: one object owns its GPU things, the stage owns a list.
- Proposal: `PropKit` per place chunk = shared geometries + materials keyed by prop kind (built once per place, disposed on leaving).
  Static repeated props (shells, pebbles, pine cones, snowballs, logs) as one `InstancedMesh` per kind: 1 draw per kind (x2 on med / high
  for the transmission pass). Unique or moving props (ball, seesaw, swing, sled, springy cap, floating ring) as plain Meshes: 1-3 draws each.
- Materials: MeshStandardMaterial + `hub.apply(mat, ~0.3..0.8)` (env reflections, no extra lights); procedural detail by the same
  `onBeforeCompile` + NOISE_GLSL (shaderlib.ts) as the felt. One `customProgramCacheKey` per prop family, so N instances = 1 program.
- Shadows: reuse the decal contact shadow. `Decals` builds a ShaderMaterial per instance (decals.ts:97-119): fine for 4-6 moving props;
  for many static props bake a single shadow into the ground shader (static) or one instanced shadow-quad mesh (1 draw for all).
- Following physics: props are rigid, so the stage only needs position + quaternion per moving prop per frame. Contract seam: either
  `stage.setPropPose?(id, x, y, z, qx, qy, qz, qw)` called by the shell after `physics.step` (zero allocation, like `setBridge`), or a
  `PropLike { pose: Float32Array }` the stage reads in `update` (like BodyProxy reads `positions`). Ceremony offsets do not apply to props.
- Cost per prop (estimate, not measured): 1 draw + its triangles twice on med / high; a 500-triangle prop is ~3% of one jelly (18.9k).
  Budget props by draw calls: today 1 body = ~13 calls, so 20 props ~ 1.5 bodies of draw overhead.
- Bodies in front of props: jellies are sorted far-to-near among themselves at renderOrder 10.00-10.99 (stage.ts:771-775) because their
  meshes sit at the origin with world-space vertices. Opaque props must render BEFORE the jellies (renderOrder < 10) so the transmission
  pass refracts them; a transparent prop (ice, water surface) must join the jelly sort or it will paint over bodies.
- Water: a water surface is transparent and must be drawn after the jellies at the right depth; a body half under water needs a cheap
  "under the waterline" tint in the jelly (one uniform: water plane height) rather than a real refraction of the jelly.

## 3. How a body is drawn, and where place looks go

- BodyView (bodyview.ts:96-122) per body: JellyView fine mesh (jelly.ts:213; fine vertices mapped once to sim triangles by RestMapper,
  Phong-smoothed every frame, zero allocation), `JellyMaterials` (two lazily built variants sharing ONE uniform object, material.ts:504-508),
  Core (emissive blob + HaloQuad, core.ts:86-99), Face, Fx (bubbles, glitter, puffs: 3 instanced draws, fx.ts:1-6), Decals (2), RarityFx,
  TackStrands (built only when a body first strings, strands.ts:1-6).
- Shader stages (material.ts:485-498): COLOR_STAGE (patterns by `WH_PATTERN` 0-3 define, two-tone, merge mix, pressure blush / pale, tier tint,
  white balance, 161-193); GRAIN_STAGE (family micro-bump over the rest direction, 305-322); TRANSMISSION (thickness and attenuation by view
  angle and blush, 196-204); EMISSIVE_STAGE (rim, key wrap scatter, analytic core halo, aurora, thin film, touch glow, cut seam, tier tell,
  WH_LOW fake depth, 206-284). Material props per family: roughness, clearcoat, sheen from `resolveMaterial(family).look` (446-460).
- Core glow: `uCoreWorld`, `uCoreAmt = 0.3 x core.amount (x1.9 on low)` (bodyview.ts:193-194), plus the blob in the opaque list so the
  transmission pass blurs it.
- Rarity (rarity.ts header 1-10, DESIGN 5.3): uniforms (uAurora, uIri, uTwoTone, uTierCol / Amt / Tint) + billboard / instanced draws
  (aura HaloQuad, pillar renderOrder 24, dome 26, motes, constellation lines 29). `setTier` rebuilds the materials (bodyview.ts:142-151).
- Place looks as uniforms (proposal; one new program version, no new define, so no extra programs):
  `uFrost` (white crystalline fresnel crust + roughness up: EMISSIVE jFres term and a GRAIN term), `uWet` (darker, more saturated diffuse +
  sharper clearcoat: COLOR_STAGE multiply; `clearcoatRoughness` is a material scalar that can be lowered live without a recompile),
  `uSand` (speckle mask over `vRest`, like jSpeckleLayer 149-158, plus grain bump; lower half by world normal), `uToast` (brown-gold
  darkening on the side facing a heat point: new `uHeatPos` vec3, falloff by distance; plus warm scatter), `uSnow` (white cap on
  up-facing world normals `jN.y` with noise edge, EMISSIVE stage has `jN`, 209). Each 0..1, eased by the stage, with a per-body setter
  `stage.setBodyLook?(id, { frost, wet, sand, toast, snow })`. Bump the cache key `wh-jelly-v4` (500) to v5.
- Must hold: the low tier path (WH_LOW) recolours emissive light (264-280): every look needs a low-tier check; the gallery (50 species
  distinct, closest pair 13.14/255) and the med / low colour identity check (browser_render.mjs:1167; median 9.1, p90 15.8, max 20.6)
  must still pass with looks at 0. Opaque families (foam, marshmallow, putty, mochi, beads) are frosted at every tier (material.ts:286-296):
  looks must read on the skin, not through transmission.
- Pieces (chunk): same materials and uniforms, no face, no rarity group (bodyview.ts:120): looks apply to pieces for free.

## 4. Faces

- Placement (face.ts:101-167): eye radius `restRadius x (0.095 + 0.07 eyeSize)`; elevation 3..29 deg by eyeHeight, azimuth 9..26 deg by
  eyeSpacing (122-125); each eye's direction is mapped once to a sim triangle + 4 footprint samples; every frame the bead is fitted to that
  footprint (221-256), so it rides squash and dents. Styles dot / oval / sleepy (lid cut 0.18, droop 0.12) / wide (19-24).
- Animation (196-306): `wide` from compression 0.3..0.8; happy `squint` (arc torus replaces the dome) on release (rate < -0.5 after comp >
  0.07, held 0.5 s); seeded blinks every 2.2-5.8 s, 18% doubles; look = pointer projected to the eye frame (259-271), or idle wander
  (273-274) when the pointer is null. Expressions are inputs (comp, rate), not states.
- Today ALL faces look at the same `input.pointerNdc` (stage.ts:766). Chunks have no face (bodyview.ts:211). Merge parents can hide the
  face (`faceHidden`, 66-67). The face hides while folding (`foldAmount < 0.4`, 207).
- Per-body look target: add `lookAt: Vector3 | null` and `lookWeight` to Face; in update, when set, project the world point to NDC and feed
  the SAME code path (259-271) instead of the pointer; the pointer wins while the player touches this body (LIFE rule "touch overrides").
  Seam: `stage.setBodyGaze?(id, target: V3 | null)`.
- New expressions as eased channels inside Face (no new meshes): happy = squint arcs held (exists); sleepy = openY toward 0.25 + droop +
  slower blink; surprised = wide 1 + iris smaller (`uIris` uniform exists, face.ts:136) + one quick blink; shy = gaze down-and-away + extra
  blush (jelly `uBlushAmt` / a cheek-glow term near the eye footprint: material change); proud = half arcs + gaze up + tiny lift of the eye
  line. Seam: `stage.setBodyExpression?(id, expr, amount 0..1)`; `none` returns to the current physics-driven behaviour. Mat bodies all
  have faces; a cut squishy's face piece is the one non-chunk view, so the shell (or LIFE) targets that id; chunk pieces express through
  emotes and motion only (eyes-only rule).

## 5. Emote bubbles: what to reuse, how to draw icons, cost

- Reusable: the camera-facing billboard vertex math (halo.ts VERT, right / up from the view matrix); the instanced attribute layout and
  zero-allocation pool of `Particles` (particles.ts:89-200, swap-remove, `cap`, `dropped` counter); per-view `frameRoom` (bodyview.ts:52,
  199-204) to keep bubbles inside the frame's sides; the flash governor for any bright pop; `safe` insets (stage.ts:243) so bubbles avoid
  the HUD; body screen boxes from capsuleSpot (stage.ts:350-356) for stacking.
- Not reusable as is: every existing sprite is ADDITIVE light (would vanish on a bright beach and cannot draw a dark outline).
- New: `EmoteBubbles` = ONE InstancedBufferGeometry, normal alpha blend, renderOrder > 40, depthTest off (always readable), per instance
  (pos, size, icon id, alpha, pop scale). Icons as an SDF set in the fragment shader (circle, heart from two circles + a triangle, note,
  star / sparkle, question, zzz, sun, snowflake, flame, droplet, shell, leaf: each 5-20 lines of GLSL) chosen by icon id: no texture, no
  image, nothing for CSP. Alternative: a 512x512 `CanvasTexture` drawn once at boot with Path2D; also CSP-safe (no img-src involved), but
  costs a texture and a 2D pass; the SDF route is crisper at every DPR.
- Cost of 3 to 6 bubbles: 1 draw call, 12-24 vertices, small screen area (~40-60 CSS px each): negligible against one jelly (~13 calls,
  18.9k triangles). CPU: projecting 6 anchor points per frame. Keep zero allocation (pool like Particles).
- Rules to hold: a bubble pop is not a flash (no white burst; alpha ease 0.12-0.2 s); calm = no bounce, no wobble, fade only.

## 6. Footprints, trails and marks

- Today decals are per body, two quads, recomputed every frame, drawn in the opaque list with custom blending and polygon offset
  (decals.ts:96-120). There is no persistent mark.
- Marks (footprints in sand / snow, wet patches, slime trail): one `GroundMarks` ring buffer (e.g. 64 / 48 / 24 by tier) of instanced
  quads at y 0.001..0.003 on the ground, each with age, fade, angle, kind; 1 draw, normal alpha with the same keep-destination-alpha trick
  as the shadow (decals.ts:100-104). Stamped by the shell / LIFE on landing and hop events (`SoftEvent` land / bump) or by distance moved.
- Sand / snow dents can be faked in the ground shader (darker, flatter normal inside the mark) with no geometry.
- Constraint: the marks and all decals assume flat ground at y 0; a slope or dune under the play area needs a ground-height function
  shared with physics (DIRECTION D5 place data) and decals placed on it.

## 7. Ceremonies, Cut, Snap, and a place that is not Home

- Ceremonies (ceremony.ts) talk to the stage only through `CeremonyHost` (stage.ts:559-611): flash, screen, particles, cameraFx, capsule
  hand-off, framing. ceremony.ts does not import table.ts or PALETTE (grep), so it does not need Home in code. It DOES assume:
  the pad at (0, 0) on y 0 (merge slides parents toward it, 552-657; reveals slide other bodies off by -3.4 and hide them, 411);
  merge hides every visible body (605) and removes them at the end; the capsule drops onto y 0 beside the bodies (`capsuleSpot`,
  stage.ts:335-402, which knows bodies and HUD insets but NOT props); the burst light is an additive screen ramp (alpha <= 0.25,
  flash.ts:16) and pool / ring light on a DARK felt. On a bright beach the same ramp is a smaller luminance swing, but rings and pools on
  sand may read weak; on snow they may wash out. The flash probes measure mean linear luminance swing >= 0.04 (RENDER_R.md:85): re-run
  them per place.
- Options for the designers: (a) ceremonies always happen Home (travel back, simple, keeps every gate); (b) a "pad" spot per place, clear
  of props, ground at y 0, with the other party members stepped aside instead of hidden (needs a ceremony change: today "hide all").
- Cut: seam is in the jelly (`uSeam`, material.ts:256-260), strands and bridge in CutFx (body-relative). Place-independent except the
  framing stopgap (stage.ts:297-302) and that parting strands use the env map (lit by the place env after a swap).
- Snap: the shell renders one clean frame and reads the drawing buffer in the same task (src/shell/hudBinding.ts:282-296), with an
  optional 2D tint ("Backdrop") painted over it. A place is captured automatically; Snap's backdrop tints may need per-place values.
- Must hold in every place: flash gate (2 flashes / s, alpha 0.25, rings 500 ms apart, coral / cyan never alternating < 500 ms, calm none:
  flash.ts:1-20), calm (no camera moves, particles x0.3, rings as fades), skip crossfade, context loss restore (place env must rebuild in
  `onRestored`, stage.ts:615-625, and its geometries must be in `scene` so `dropStaleDisposeListeners` sees them).

## 8. Numbers, the flash gate, and the harness

- Draw calls / triangles (exact, VERIFY_RENDER_A_R1.md:222): 2 whole bodies 26 calls / 37,768 tris; 6 pieces 60 calls / 89,552 tris (med).
  So ~13 calls + ~18.9k tris per whole body, ~10 calls + ~14.9k tris per piece. Pieces use the full tier fine mesh (bodyview.ts:108),
  a piece of 1/8 volume still has 5762 fine verts on med.
- Relative frame cost (SwiftShader, loaded machine, only ratios mean anything): 3 bodies vs 1: low x1.41, med x1.35, high x1.30
  (VERIFY_RENDER_A_R1.md:200; bar 3.6). 6 pieces vs 2 whole: x1.32 / x1.41 / x1.45 / x1.37 in four samples (bar 1.5, least headroom 3%).
  No absolute ms per body on a real GPU exists in any report. CPU: every view re-evaluates its fine mesh every frame (jelly.ts update,
  relaxNormals) whether or not the body moved.
- Memory / garbage: 8.86 KB/frame from src/render (bar 16 KB), update() 0.076 KB/frame (VERIFY_RENDER_A_R1.md:200); programs 16-19,
  textures 3-4 across 20 mixed ceremonies (RENDER_R.md:98).
- Bundle: 8 files, 1133-1137 KB of the 1229 KB budget (RENDER_R.md:49, 119). Per-chunk sizes: not in any report; I did not build.
  The stage chunk holds three + src/render; `src/render/*.ts` is 420 KB of source.
- Flash gate: FlashGovernor (flash.ts) + probes: `_harness/verify_render/flash.mjs`, `gov_fuzz.mjs`, `adv.mjs` (chains: worst 1 s window
  2, RENDER_R.md:85), and harness sections `cer`, `chains`, `cut` (X09: worst window 0).
- Harness organisation (browser_render.mjs): one file, sections gated by `ON('name')` and `--only=a,b` (lines 43-49, 118-1338): main,
  phone, bundle, sky, lifecycle, r2, cer, chains, rarity, film, gallery, glow, strands, mat, capspot, cut, perf, fix1. Each section opens
  `_harness/renderview/index.html` (port 5364) and drives `window.__RV__` (view.ts:1783; 1820 lines of scenario helpers). To add a place:
  a `place=<id>` query in view.ts boot, `__RV__.setPlace(id)`, and new sections `place` (each place: seams, blank, console, colour identity
  of bodies vs Home), `props`, `emote`, `marks`, plus re-running `sky`, `cer`, `chains`, `perf`, `gallery` per place. Add place chunk
  names to the `bundle` section's grep list (browser_render.mjs:234-256).

## 9. Known open render items PLAYGROUND touches (STATUS.md KNOWN OPEN)

- Cut neck swell framing stopgap in `framingFor` (stage.ts:297-302): with wandering bodies in a place it will keep pulling the camera.
- CUT X08 frame budget x1.32..x1.45 vs 1.5: more pieces in a place will break it unless pieces get a lighter fine mesh.
- Phone 4 to 5 body mat is small; matLayout stops at 5 (stage.ts:644): a party plus pieces needs a place-defined layout and camera.
- A body brought onto an occupied mat slot pops out after 0.3 s (shell / physics placement, matters for place spawn points).
- Legendary capsule overlap on 390x844 (0.175..0.261); capsule spot ignores props (new).
- med / low colour drift for 8 of 50 species; cut-swap luminance step > 0.04 for 4 families; whole-again luminance tick mixed.
- Calm overlapped-ceremony chain at 4 (not reachable through the shell).

## Extension points

| What to add | Where | How hard | Risk |
|---|---|---|---|
| `PlaceLook` interface + `stage.setPlace?(look)` / `loadPlace?(id)` | contracts.ts (additive), stage.ts | M | swap leaks GPU objects; must survive context loss |
| Sky params setter (`setSky`) and per-place sky shaders | table.ts (uniforms 198-204), places/*.ts | S / M | new horizon bands; `sky` section must pass |
| Ground mesh per place (replace felt) | table.ts split into Home look + places/*.ts | M | ground must stay y 0 under play; shimmer at grazing angles |
| Lights as stage fields + jelly light uniforms per place + WB from key colour | stage.ts:188-194, material.ts:329-338, 386-390 | M | species colour identity shifts per place (gallery, B-m8) |
| Env panels as data, `EnvHub.setPanels` + dispose old cube | env.ts:57-110, 138 | S | bake hitch at travel; old cube leak |
| Backdrop silhouettes | places/*.ts, renderOrder -99..-51 | S | drawn twice on med/high (transmission pass) |
| Weather particles (additive embers, normal-blend snow) | particles.ts (blend option) or new weather.ts | S | flashing if dense; calm caps |
| Props: kit, InstancedMesh statics, pose seam for movers | new props.ts; contracts `setPropPose?` | M | sort vs jellies; transparent props; capsule spot ignores them |
| Prop contact shadows (instanced) | decals.ts pattern, new | S | flat-ground assumption |
| Place looks uFrost/uWet/uSand/uToast/uSnow + `setBodyLook?` | material.ts COLOR / GRAIN / EMISSIVE stages, bodyview.ts | M | low-tier path, opaque families, gallery checks |
| Per-body gaze `setBodyGaze?` | face.ts:259-275, stage.ts:766 | S | pointer vs brain priority |
| Expressions `setBodyExpression?` (happy, sleepy, surprised, shy, proud) | face.ts state + `uIris`, jelly blush | M | must not fight the squeeze-driven wide / squint |
| Emote bubbles (SDF icons, 1 draw) | new emotes.ts; contracts `showEmote?` | M | readability on bright skies; HUD overlap |
| Ground marks ring buffer | new marks.ts | S | flat ground only |
| Lighter fine mesh for chunks / background bodies, skip idle mesh updates | bodyview.ts:108, jelly.ts update | S / M | visible facets on big pieces; resting-detection |
| Place-aware layout + camera mode (spawn spots, free roam framing) | stage.ts matLayout / framingFor | M | camera hunting when LIFE moves bodies |
| Ceremony pad per place / step-aside instead of hide | ceremony.ts:411, 605; stage host | M | every ceremony gate re-run |
| Harness: `place`, `props`, `emote`, `marks` sections, per-place reruns | browser_render.mjs, renderview/view.ts | M | run time grows (full run already 52 min) |

## Constraints and numbers

- Zero allocation in hot paths; deterministic randomness (mulberry32, no Math.random in render); every new GPU object disposed in
  `dispose()` and reachable from `scene` for context-loss handling (stage.ts:150-169, 615-625).
- Contract: additive optional StageLike members only (contracts.ts:384-417 pattern); harness / dev members behind `import.meta.env.DEV`
  (stage.ts:862-892) and checked by the `bundle` section.
- CSP: `script-src 'self'; style-src 'self'; img-src 'self' data:` (index.html:13): procedural shaders and canvas textures are fine; no
  external images, no inline styles.
- Render order bands in use: sky -100, felt -50, shadow -40, pool -39, core blob -20, halos -19 / -18, jellies 10.00-10.99, strands 11,
  capsule 12, eyes 20, pillar 24, glitter 25, dome 26, puffs 28, lines 29, fx 30, particles 32 / 33. Free: props 0-9, bubbles 40+.
- Fine mesh verts: 2562 / 5762 / 10242 (geodesic.ts:1). Tier drop at 24 ms window average (quality.ts:35); the shell refuses bodies over 30 ms.
- Flash: <= 2 flashes / s, starts >= 1 s apart, alpha <= 0.25, rings >= 0.5 s apart, coral / cyan >= 0.5 s (flash.ts:15-20).
- Budget (D9): first load <= 1300 KB, whole build <= 2000 KB; the current gate is one 1.2 MB total (vite.config.ts) and must change first.
- Not checked by me: real GPU ms per body, bake time of the env at travel, per-chunk sizes, how three 0.186 batches the transmission pass
  with many opaque props, and anything in src/shell beyond the two cited call sites.

## Open questions for the designers

1. Do ceremonies (capsule reveal, merge) play in the current place, or does the game return Home for them? If in place, which spot is the pad
   and do other party members step aside (new) or vanish (today)?
2. Is the felt mat Home only, or does every place keep a small "mat" disc (a familiar play spot, keeps decals and capsule logic simple)?
3. Time of day and brightness per place: the look is built on a dark backdrop (additive glows, pools, rings). How bright may the beach be?
4. Camera in a place: fixed framing of the play area, or follow the party? Is orbit still free, and how far may the player zoom out?
5. Which place looks are physics (wet = less grip) and which are only looks, and how fast do they come and go (seconds or minutes)?
6. Are props allowed under or inside the play disc, or only around its edge (ground height and decal assumptions)?
7. Emote bubbles: size on a 390x844 phone, max on screen at once per tier, and do pieces get bubbles or only a shared group bubble?
8. Expressions: is "shy" allowed a cheek blush glow (a skin light, not a mouth)? Does "proud" move the eyes, or only the body?
9. Footprints: which places leave marks (sand, snow, flour on the cabin floor?), and how long do they last?
10. Should background bodies on low / med drop to the low fine mesh (2562 verts), and may pieces always use it?
