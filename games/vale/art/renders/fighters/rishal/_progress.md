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
