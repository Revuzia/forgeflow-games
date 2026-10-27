# Rishal Art 2.0 progress

- 2026-10-21 00:20 CDT: started from scratch (no earlier entries). Read HANDOFF Art 2.0 method, marund.py, hesmi.py,
  the brief and the concept. Concept notes: head turned ~35 deg to his right in both views, staggered stance (left
  foot forward, right foot turned out), pale front boots almost the backdrop colour, left elbow out. Plan: own plates
  script (backdrop islands out, boots traced), symmetric rest sculpt, concept-pose paint warp through the armature.
- 2026-10-21 01:40 CDT: plates (proto/rishal_plates.py: backdrop islands out with a vignette-aware estimate, the pale front
  boots traced, frame set by hand: crest tip 1.88 m), fit tool (proto/rishal_fit.py, per-view rigid head pose), rishal.py
  v1: SDF parts (helm, carved face, V visor + beak keel, crest arc stone + glass panes = accent, visor ridge = accent,
  two swept glass fins, cowl, chest plate, straps, medallion, belt/buckle, split coat skirt + apron, sleeves, bracers,
  sculpted fists round the grips, round right pauldron, left pauldron with 4 blade lames + 30 cm spike, baggy trousers,
  knee plates, greaves, calf wraps, boots, two reverse-grip glass knives), custom binds (auto_only, skirt halves on
  their thighs), concept-pose projection paint (armature pose per view + rigid head turn; proto/rishal_look.py checks
  the posed silhouette over the painting), procedural knives / boots / hidden face, glass-aware head fills, value
  ramp + luminance knee. Thin parts voxel-remeshed before decimation (smooth shaded: the flat remesh split every
  vertex). Bespoke clips for all 17 (idle, run, attack1/2, crit, cast_a1/a2/a3/ult, dash, stunned, recall, channel,
  death, idle_lobby, victory, taunt). proto/rishal_poses.py renders per-clip pose sheets.
- 2026-10-21 03:10 CDT: fast build 9: 18447 tris, 1147 KiB, accent 1.83 %, load test OK. Full base build started.
- 2026-10-21 05:05 CDT: DONE (first full pass). Base: 18447 tris, 1130 KiB, accent 1.83 % (100 % top half), facing +Z,
  three load test OK, 17 clips (+crit, taunt, channel, dash, stunned), art.height 1.89 (crest arc top), runRefSpeed
  3.55; content art block == art.json; --check --allow-missing-assets OK; strict --check lists nothing for rishal;
  probe_kits_A 525/0, probe_kits_B 733/0. Skins: rishal_chalkline 18447 tris 979 KiB accent 1.65 % (ink roles moved
  absolutely, chalk sketches = runners / speed lines / suns, 0.6 % of the atlas), rishal_lamplit 18863 tris 1012 KiB
  accent 1.60 % (smoked lampresin glass, walnut, warm linen, lamp cage on the visor brow). Atlas L*: base p99 77,
  chalkline 74, lamplit 75; area above L* 86 <= 0.12 %. In-game art2_rishal_*: the crest arc + accent and the left
  spike read under the bar. Hero renders: matte specular + lower fill (_install_render).
  Open: cast_a1 / cast_a3 never show in game (castTime 0: the sim's dash state starts at once and plays the kit's
  `dash` anim, so `dash` covers Glass Dash, Feint and Long Glint's rush; Feint therefore sprints in its travel
  direction rather than arcing back) - a kit `present.anim` change is the content lane's call; the face under the
  visor is smooth (few carved lines) at close range; skins are re-colours of the base painting (no painted skin
  concepts).
- 2026-10-21 02:30 CDT: FIX PASS 1 started (review: 5 major, 5 minor). Found: the calf "rods" were the greave keel
  (RoundBox frame put its 26 cm long axis on Z = forward: a rod through each shin), not the wraps; the wraps were a
  6 mm torus decimated into chords. Keel re-oriented along the shin; wraps rebuilt as flat bands made directly as the
  game mesh (RingBands, no decimation). Head rebuilt: the visor is now a lavender-blue glass blade across the eyes
  (shell clipped by a side profile + front V into the beak; no keel, the dome shows above it, the carved face below),
  painted procedurally (visor_paint: depth ramp, streak, ink almond eyes behind the glass, pale cyan rim on the cut
  edges), its own rougher copy of the dawnglass material; helm and face painted procedurally (no projected neck on
  the helm's back); the accent ridge refitted along the visor's top edge; the crest root ends at the ridge.
  Preview tool: proto/rishal_head.py (SDF head, per-vertex head paint, 6 views in 10 s).
- 2026-10-21 02:50 CDT: fix pass 1 continued. Fins painted as glass too (fin_paint: blue root to tip, dark spine, pale
  cut edges; the painting's pale fins vanished on the splash sky). Visor roughness +0.26 on its own material copy.
  Projection mud: HARMONIZE squeezes log-luminance and pulls the hue to the part median on the trousers (all) and the
  coat's back (skirt halves, back-facing texels). Motion: Feint rebuilt (3-frame head fake into a false lunge, a
  push-off, apex at f8 arced back with the left knee tucked and the arms swept down-back with the knives up as wings,
  bent-knee landing f14); run lean ~17 deg on the chest axis with sprinter's arms (elbows in, poles back, knives
  trailing) and a lower swing (contact frames untouched: the three run check needs the generator's contact roll);
  death buckles at the knees before the spin (feet IK-planted through the spin); ult burst blades level (tips >= 0.31 m
  above the floor). Victory hold's head turned a quarter away (crest + fins in profile from the splash camera).
  Hero renders: samples x2, nlmeans x1.4 (render wrapper), splash x 0.64 fill 0.80, portrait yaw 18, icon yaw 14.
  Skins: Chalkline identity on the big pieces (`parts`: apron/sleeves/chest ink-grey, pauldrons cool mid ink-grey,
  scarf #C9C9C1) + a much denser chalk sketch set; Lamplit cowl #C4B6A0 (was blowing out), cage moved onto the crest
  edge. Gates on build 4: three load OK, 18985 tris, 1102 KiB, accent 1.71 %, facing +Z, run foot error 1.6 %.
- 2026-10-27 08:55 CDT: resumed. Fix pass 1 was built and shipped in 3e2a6f8d (base 18985 tris / 1102 KiB / accent
  1.71 %; skins rebuilt 03:03; content art block == art.json). The kit's dashes play `dash` (present.anim of the dash
  effects); a5f66bf4's instant-cast clip is cancelled by the dash state, so cast_a1 / cast_a3 still hand off to dash.
  Own review of the fix-pass-1 renders (look.png front / back / three-quarter vs the concept): FIX PASS 2 list -
  (1) visor reads as an alien face (two almond eyes on a blue oval): eyes out, the concept's thick pale-blue rim with
  a dark outline, the temple ring inset on the sides only, a lighter upper sheen; (2) helm back a blank white egg:
  the concept's warm carved nape plates with grooves; (3) trousers neutral grey #353637 (concept slate-teal #3A4348 /
  #687D86): harmonize onto the concept's hue, more value range; (4) coat back near black; (5) forearm bracers and
  sleeves striped brown / blue projection mud: procedural stone guards + leather wraps, sleeves harmonized;
  (6) a pale yellow patch on the right hip / belt; (7) greave streaks.
- 2026-10-27 09:55 CDT: FIX PASS 2 done. Head: visor_paint without eyes (lavender glass a step toward the painting,
  broad sheen + thin streak, the thick pale-blue frame with a dark outline and a fine inner line, temple rings on the
  side faces only); helm back = four stacked warm-taupe nape lames with inked seams and lit lips (painted: grooves cut
  at the 6 mm voxel came out jagged; two wide arcs read as a face, a centre seam as a crosshair); fins get a blunt
  1.7 mm edge (Blade `edge`: the diamond section saw-toothed after the remesh). Body: the projection treats texels
  outside the plates' figure mask (eroded 3 px) and the painting's warm rim light as hidden (the backdrop inpaint in
  the left arm / body gap had painted a beige patch on the belt); HARMONIZE takes a target colour (trousers onto the
  painting's slate-teal #4F5F69, sleeves pale blue-grey #8C9CA9, the lames' back #8E9AA3); the forearm guards are
  curved stone shells round the outer forearm (were 2 cm flat boards: white planks in every hero render), painted
  procedurally (bracer_paint: three bold concentric carved grooves, lit lips, dark outline; the forearm under them
  pale sleeve with two leather straps wound in an X and a wrist band). Splash: the low guard from the front
  three-quarter (idle t 0, yaw 32: the victory hold showed his back, no visor, no knives). Skins: the recolour caps
  luminance at L* 85 (Lamplit's linen gain lifted the sleeves past 86) and re-colours the bracer zones by their own
  roles (guard stone, straps leather, cloth with the sleeves); Lamplit sleeves #ABA08F.
  Gates: base 18989 tris, 1120 KiB, accent 1.70 % (100 % top half), facing +Z, three load OK, 17 clips, run foot error
  1.6 %; chalkline 18989 tris 978 KiB accent 1.59 %; lamplit 19402 tris 990 KiB accent 1.56 %. Atlas L* p99: base 78
  (0 % > 86), chalkline 79 (0.03 % > 86: the exempt chalk lines), lamplit 79 (0.02 %). art.height 1.9 copied into the
  content art block (== art.json); --check --allow-missing-assets OK, strict --check lists nothing for rishal;
  probe_kits_A 525/0, probe_kits_B 733/0. In game (art2_rishal_*): the crest arc + accent, fins and knives read under
  the bar. Proto: rishal_look.py --repaint now prints per-part paint stats and writes _fit/atlas.png.
  Open: cast_a1 / cast_a3 still hand off to `dash` at once in game (the dash effects' present.anim; a5f66bf4's instant
  clip is cancelled by the dash state) - content lane; the brief's ink almond eyes behind the glass are gone (they
  read as an alien face); the left guard's pointed flare past the elbow (painting) is a plain cut end.
- 2026-10-27 10:05 CDT: FIX PASS 3 started (independent review: 3 major, 9 minor). Plan: rebuild the head to the
  concept (sickle visor, slim mask, carved back), drop the strap geometry, give each dash ability its own clip in
  game, then the minors (fins, ears, mud, guards, lames, attack1, Chalkline, lean, splash).
- 2026-10-27 10:57 CDT: FIX PASS 3 built (base build 3, skins build 1; final base + skins rebuild running).
  Head: SKULL a narrow carved skull (14.8 cm wide, no cheek guards; a raised keel down the back, a seam each side
  of it, the carved ring seam); NAPE three warm-taupe lames hugging the skull's lower back, each an offset shell a
  step further out (lobster tail); the face a slim long stone mask with painted carved lines (no slit mouth);
  the VISOR a sickle: the lens between two ellipsoids offset +-4 cm (a keel down the front = the beak, the facing
  cue from above) clipped by VISOR_PROF (side: a horn over each temple, the band's back edge) and VISOR_FRONT
  (front: the top edge dipping over the brow, the band across the eyes, a narrow beak hanging to a point 6 cm
  below the chin); paint: blue-grey glass with a lavender cast toward the brow, a light line down the keel, the
  pale cyan rim with a dark outline, a ring at each temple; ridge (accent) re-fitted along the new top edge and
  thicker; crest a lower, deeper crescent (painted stone, crest_paint); fins = BladeMesh (analytic game mesh, no
  voxel remesh: clean edges), pale glass like the knives, tapering blades rooted high beside the crest so crest +
  fins read as one swept comb from the game camera (no second spike = no rabbit ears). Preview: proto/rishal_head.py
  now also renders the front-facing game camera (gamef).
  Straps: the tube straps removed (they never lay on the painted straps: the ghost X on the back, the pale strap
  across the chest, the loose strap end); the painting's straps carry them.
  Dashes (content, outside the art block - the only way to give the four abilities four gestures in game; flagged
  in the report): Glass Dash's dash effect present.anim dash -> cast_a1, Feint's dash -> cast_a3 (the renderer
  plays a non-`dash` role in the dash state at its own pace from frame 0; the unit faces where it springs), Long
  Glint keeps `dash`, now authored as the ult's rush straight on from cast_ult's burst (the spear held, rear leg
  trailing, front foot skimming, then a skid up). cast_a1: 2-frame crouch, airborne sprint strides (feet 22-30 cm
  off the floor, the old sprint was a planted crouch); cast_a3: head fake, push-off, an arched bound with the knives
  as wings (apex f5), touchdown at f8 (the impact) inside the ~0.29 s spring, guard by f20.
  Minors: trousers / coat back harmonized harder, greaves onto the painting's slate, knee plates painted ironstone;
  sleeves a step darker (#8393A0); forearm guards hug the wraps (4 mm off, were 2 cm), darker honed stone, a pointed
  flare past the elbow (bracer_tip chevron, the carving follows it), two grooves; the left pauldron cap and lames
  painted stone (lames_paint: lit upper faces, a carved groove along each blade, lit bevel, dark outline; no
  projection ghosts), the cap's chips halved; attack1 an ice-pick stab (fist cocked by the ear, driven forward at
  chest height, the blade leading forward-down); the guard leans ~20 degrees on the chest axis with the hips back;
  splash = Glint Cut's second cut (cast_a2 t 0.64, yaw 30), portrait yaw 36, icon yaw 30. Chalkline: the helm
  (#959BA3) and nape (#5F6670) ink-grey, the dawnglass frosted to a chalky smoke-grey #A9AEB5 (the blue visor kept
  the portrait the base's), the runners redrawn as children's doodles (big round head, eye, hair tuft, uneven bent
  limbs; never the arms-up V that reads as a rune) and every stroke drawn wobbly twice (_sketchy); Lamplit's cage
  moved before the crest edge (it hid crest glass: accent 1.49 %).
  Gates (base build 3): three load OK, 19574 tris, 1138 KiB, accent 1.72 % (100 % top half), facing +Z, impacts at
  0.4; chalkline (skins build 1) 999 KiB accent 1.58 %, lamplit 1007 KiB accent 1.49 % (-> cage moved, ridge +10 %).
- 2026-10-27 11:28 CDT: FIX PASS 3 DONE. Base (build 4): 19575 tris, 1138 KiB, accent 1.76 % (100 % top half),
  facing +Z, three load OK, 17 clips, impacts at 0.4, art.height 1.88 (copied: content art block == art.json).
  Skins: chalkline 19575 tris 999 KiB accent 1.71 % (visor and fins frosted smoke-grey by part: the dawnglass role
  gain alone left the painted visor blue), lamplit 19988 tris 1010 KiB accent 1.62 %. Atlas L* p99: base 78 (0 %
  > 86), chalkline 81 (0.06 % > 86: the exempt chalk lines), lamplit 79 (0.02 %). --check --allow-missing-assets
  OK, strict --check lists nothing for rishal; probe_kits_A 525/0, probe_kits_B 733/0. In game (art2_rishal_*):
  the visor reads as blue glass with the beak, crest + fins as one swept comb under the HP bar, the left spike.
  In-game dash probe (render bench, real cast orders): Glass Dash plays cast_a1 0 -> 0.30 s across its dash,
  Feint cast_a3 0 -> 0.27 s, then run/idle; Long Glint keeps `dash` (the rush). _fit/look.png and look_head.png
  re-rendered from the final cache.
  Open: the visor is painted glass (opaque; the concept's face shows through it); in the three QA room light the
  glossy visor still washes pale (in game it reads blue); the left pauldron's cap reads as a smooth pale ball in
  the Blender look; Feint is a bound away (the sim turns the unit to where it springs, so the brief's backward arc
  is played as an arched leap with the knives as wings); after a dash the clip cross-fades straight to idle/run
  (no follow-through: the renderer only holds cast-state clips).
- 2026-10-27 11:59 CDT: FIX PASS 4 started (independent review: 3 major, 9 minor). Lineup rerun reproduces it
  (accent 0.29 / 1.46 / 0.28 / 1.58 % by facing, mid band L* 38.8 / 29.4 / 26.4 / 30.3). Found: the plates' own
  values are low (the painting's back tunic #404448-#5D626E, skirt #4B4D4F: its shading is in them), the torso's
  texels mostly hidden fills (median L* 30). Changes so far: crest glass out to the outer edge and over the top
  (accent from above), fins upright and parallel beside the crest, the lens narrower (hugs the temples), the beak
  shortened to the upper lip, the glass below the eyes painted see-through over the mask, the nape one smooth
  shell with painted arcs, the pauldron lames as clean BladeMesh blades; HARMONIZE per side onto the concept's
  material colours with the straps protected, TOP_FIX for the grazing-angle streaks, procedural greaves / knees /
  wraps / boots; stunned, victory hold, lobby, blades above the floor; a splash-only hero lunge (splash_hero).
- 2026-10-27 12:30 CDT: FIX PASS 4 base built (build 4: 19175 tris, 1072 KiB, three load OK, 17 clips, impacts 0.4,
  art.height 1.88 = content). lineup_qa (game camera, 4 facings) accent 2.93 / 3.84 / 1.62 / 4.48 % (was 0.29 /
  1.46 / 0.28 / 1.58; Marund's lowest 1.35), mid band L* 44.1 / 40.6 / 42.0 / 39.1 (was 38.8 / 29.4 / 26.4 / 30.3;
  Marund 43 / 39 / 38 / 38), top 66 / 68 / 58 / 64, feet 28 / 29 / 24 / 26; IoU64 vs Kemdo 0.58, Burdam 0.38,
  Nurrow 0.49. Found on the way: the narrower lens dropped the ridge's end points off the lens (lens_y NaN -> a
  zero-tri visor_ridge in build 3): RIDGE_PTS now span the band's real top edge (|x| <= 0.05). Knife-tip check (a
  GLB pass over every clip): cast_ult / dash tips >= 0.43 m (blades level), victory's chalk-line tip 0.05 m (was
  -0.10: through the floor). AO_INTO_BASE 0.25 -> 0.15 (the skirt's occlusion read as dark blotches on the thighs);
  VALUE_RAMP mid stops 0.86 / 0.96 -> 0.90 / 0.98. In game (render bench, t 40 / 70): the body reads mid blue-grey,
  the crest + fins one swept comb (the local player's accent is Noonwhite by design: allies azure, enemies marigold).
- 2026-10-27 12:35 CDT: FIX PASS 4 DONE. Skins rebuilt: chalkline 19175 tris 928 KiB accent 4.04 %, lamplit 19588
  tris 936 KiB accent 3.86 % (three load OK). Atlas L*: base p99 79 (0 % > 86), chalkline p99 82 (0.07 % > 86: the
  exempt chalk lines, now 9 mm wide), lamplit p99 81 (0.01 %). Chalkline now reads apart from the lighter base
  (ink-grey coat and legs, chalk-white scarf, grey visor and helm). Base hero renders re-rendered from the build-4
  cache with rishal_hero.py at scale 1 (icon_yaw 30 -> 8: the visor and crest face the icon camera; portrait yaw 36;
  splash = the splash_hero lunge, yaw 52, fill 0.86, x 0.66). Content art block == art.json; build_content --check
  --allow-missing-assets OK, strict --check lists nothing for rishal; probe_kits_A 525/0, probe_kits_B 733/0.
  In-game art2_rishal_* re-shot at t 40 (the t 25 default stood him behind a tower): visible under the bar, the
  crest + fins one comb, the knives in the hands. RISHAL_PAINT_DEBUG=1 with rishal_look.py --repaint prints each
  part's projected colour per side and its hidden share.
  Open: the local player's own accent is Noonwhite by the renderer's design, so in self-view the crest glass reads
  white (allies azure, enemies marigold); the top band is L* 58-68 at the game camera (bible 70-85: the helm, crest
  and cowl are capped by the value knee); the trousers keep some faceting (1200 tris for both legs); in the three
  QA room light the visor band still reads pale lavender (in game and the hero renders it reads blue glass);
  cast_a1 / cast_a3 / Long Glint's rush follow-through after a dash is still a cross-fade (renderer).
- 2026-10-27 13:40 CDT: FIX PASS 4 re-verified (the step was re-run; no new review). rishal.py had a 12:28 edit after
  the 12:24 base build (the hero-render SPLASH settings), so base and skins were rebuilt from the current source:
  base 19175 tris, 1072 KiB (byte-identical size to build 4), accent 4.02 % (100 % top half), facing +Z, three load
  OK, 17 clips, impacts 0.4, run foot error 1.6 %, art.height 1.88 (content art block == art.json); chalkline 19175
  tris 928 KiB accent 4.04 %, lamplit 19588 tris 936 KiB accent 3.86 % (three load OK). lineup_qa (_fit/lineup_b5,
  with Marund, Kemdo, Nurrow): Rishal accent 2.93 / 3.84 / 1.62 / 4.48 % by facing (Marund's lowest 1.35), mid band
  L* 44.1 / 40.6 / 42.0 / 39.1, IoU64 vs Kemdo 0.58, Nurrow 0.49, Marund 0.24. build_content --check
  --allow-missing-assets OK, strict --check lists nothing for rishal; probe_kits_A 525/0, probe_kits_B 733/0.
  In game (art2_rishal_*, --t 40; the dev server on :5190 was down and was restarted): visible under the bar beside
  the minion line, the crest + fins one comb, knives in hand.
- 2026-10-27 14:08 CDT: FIX PASS 5 started (independent review: 4 major, 7 minor; evidence = the 13:35 fix pass 4
  build). Machine load ~90 (other fighters building), so builds are slow. Changes so far: HEAD rebuilt to the concept:
  the visor's beak hangs to a point 2 cm under the chin again with the slim white mask behind it, painted
  see-through (visor_paint samples face_paint / helm_paint 4.5 cm behind the glass under an ice-blue cast, deeper
  across the eye band; no lavender); the mask flat-fronted and recessed (no forward chin: the snout), white chalk with
  the concept's carved lines (2D on the front, ink cut + lit lip), no warm flesh tones; the helm carved: a raised brow
  band above the visor's top edge, a stone ring boss at each temple where the horns pivot (was a painted dot), the back
  of the skull in warm carved plates (the concept's back view) down to the nape; the neck painted as the concept's
  carved warm column (was projected brown smudge). CREST: the concept's pale chalk frame (broad outer band, inner
  band, three ribs) round recessed dawnglass panes (crest_glass is dawnglass again, painted ice glass); the accent is
  the brief's ridge fin along the visor's whole top edge (horn to horn, _visor_top_edge) plus a narrow seam where the
  crest roots on the dome. SURFACES: a painterly helper (painted / strokes: warm key + cool shadows, a chalky top
  light, directional brush strokes, mottled hue) on every procedural part; the trousers, coat skirt (pale front,
  mid-grey back, darker lining inside, hem trim), hood, sleeves, neck and right cap are now painted instead of
  projected (the coat-back hand ghost, hem smear, belt streaks, blotchy thighs and the skirt's ghosted thighs came
  from the projection); lames carved like feathers (spine groove, barbs, bevel, outline), caps with carved rings,
  greaves / knees / boots with strokes and worn chips; the calf straps lie flat round the back of the calf only (ends
  under the greave; were rings standing off it), dark leather; the knee plate lower (it reached 13 cm above the joint
  and swung over the thigh in a lunge); softer cowl folds. MOTION: the guard is the concept's low outward knife hold
  (fists wide of the hips, the reversed blades flaring out-down-back: an inverted V of glass); attack1 / attack2
  squared to the target at the impact (chest ~18 deg, head on the target, the left slash crosses the line in front
  and only the follow-through goes wide); cast_a1's blades point down-back with the arms straight (tips near the
  ground); death ends with one arm folded over the body and one flung up bent (no T); the splash's raised knife
  replaced by a trailing reverse grip. Chalkline's coat / apron / sleeves / chest a step lighter, its scarf #A7AEB3.
  Portrait box 15 cm tighter (render wrapper).
- 2026-10-27 14:55 CDT: FIX PASS 5 builds 1-2 checked. Build 1: accent 0.89 % (three QA) with only the ridge and a thin
  seam -> the accent is now the ridge fin along the visor's whole top edge (thicker), a seam along the crest's foot
  either side, a thin glowing inlay along the crest's crown edge and a line down the back keel (all seen from above;
  never on the crest's panes, which are pale dawnglass in the stone frame; a trial rim along the visor's lower edge
  was dropped: the outlined beak read as the review's down-arrow). proto/rishal_accent.py estimates the share from
  the SDF in a minute (8 facings at 52 deg; the build's three QA reads ~0.6 x the estimate: the idle's wide knives).
  Build 2: three load OK, 19893 tris, 1123 KiB, accent 1.67 %, facing +Z; lineup (rishal_fp5_b2) top band 72 / 69 /
  58 / 67, mid 47 / 38 / 36 / 36 -> the coat painted with less baked key (k 0.5) and a lighter back #8A959D, lighter
  sleeves, the helm's back plates lighter, AO_INTO_BASE 0.10 (the skirt's occlusion), trousers' fold streaks
  narrower and weaker (the first try's 3 cm patches read as blotches), the hood smaller, the cowl front #8DA6B8 (it
  went near white in the hero light); the visor's see-through glass deeper (k 0.56: it went pale grey in the QA
  light); cast_a1's blades straight down-back (tips 0.46-0.49 m, were 0.67-0.85); attack2's impact tip 22 deg left of
  the line (was 55-60), attack1's 13 deg, chest yaw ~20 at both; death's arms lowered (no T). Pauldron lames a third
  thicker with blunt edges and three hooked teeth on the spike's lower edge (the concept's notched spike). Build 3
  (base) and the skins running in parallel.
- 2026-10-27 15:46 CDT: FIX PASS 5 DONE. Base (build 4): three load OK, 19810 tris, 1114 KiB, accent 2.18 % (100 %
  top half; was 4.02 with the glass mohawk), facing +Z, 17 clips, impacts 0.4, run foot error 1.6 %, art.height 1.88
  (art.json unchanged: content art block == art.json). Skins: chalkline 19810 tris 974 KiB accent 2.27 %, lamplit
  20223 tris 983 KiB accent 2.16 % (three load OK). Atlas L*: base p99 79 (0 % > 86), chalkline p99 79 (0.06 %: the
  exempt chalk lines), lamplit p99 81 (0.01 %). lineup (_fit/lineup_fp5.json, game camera, idle f0, facings 0 / 90 /
  180 / 270): top 71 / 69 / 60 / 67 (was 66 / 68 / 58 / 64), mid 48 / 40 / 41 / 38, feet 30 / 28 / 22 / 26, accent
  1.66 / 0.84 / 0.44 / 1.11 % (thin trims are sub-pixel at 125 px: the three QA average is the gate), IoU64 vs
  Marund 0.25, Kemdo 0.56, Nurrow 0.46, Burdam 0.37; skins (_fit/lineup_fp5_skins.json): Chalkline mid 43 / 37 / 39 /
  36 (was 40 / 34 / 33 / 31; its coat now the brief's own tabard #7B8390, apron #747C88), feet 28 / 21 / 17 / 21 (the
  brief's leggings #2E3238), Lamplit mid 48 / 42 / 43 / 38. FK (rishal.glb): idle knife tips (+-0.60, 0.59, ~0) wide
  of the hips (were stubs at the hip); attack1 impact chest yaw +19, tip (0.21, 0.74, 0.91) on the line; attack2
  chest +21, tip (0.36, 0.77, 0.89) (was 0.82, 0.85, 0.50); cast_a1 tips 0.46-0.49 m (were 0.67-0.85); death ends
  with one arm folded over him and one out bent (no T). Hero renders: SPLASH sun 1.9, HERO_FILL 0.5, the portrait's
  box 15 cm tighter (render wrapper), icon_yaw 28 (re-rendered from the build-4 cache with rishal_hero.py --only icon
  --scale 1: from the front the crest stood edge-on over the visor, the down-arrow). build_content --check
  --allow-missing-assets OK, strict --check lists nothing for rishal; probe_kits_A 525/0, probe_kits_B 733/0. In game
  (art2_rishal_*, --t 65: at t 40 he stood in the minion line): a clear view under the bar, the pale crest frame and
  the fins, the knives at the hips. _fit/look.png and look_head.png re-rendered from the final cache.
  Open: the hero renders still read pale overall (his palette is chalk / linen / ice glass and the hero sky light
  lifts the slate trousers toward grey-white; the painterly finish shows best in the portrait and three QA); the visor
  is painted see-through (the shared pipeline bakes one opaque atlas, no glass transparency); the back facing's top
  band stays ~60 (the warm carved plates of the helm's back are the concept's); the side facings' mid band 38-41
  (the dark slate trousers sit in the middle half); cast_a1's tips stop at knee height (a 0.40 m blade from a fist
  ~0.85 m up cannot reach the floor without a deeper crouch than the dash allows).
