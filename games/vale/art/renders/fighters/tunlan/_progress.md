# Tunlan Art 2.0 progress (agent log; newest last)

- 2026-10-28 start: no earlier progress. Read HANDOFF Art 2.0 method + rollout prep, brief _design/fighters/tunlan.md,
  concept _design/concept/tunlan.webp, content kit, marund.py, dunsom.py/hesmi.py structure, common/pipeline.py, anim.py, rig.py.
- Concept read: hat ~1.29 m across (concept wins over the brief's 1.0), crown 2.05 m; pale cracked theatre mask (smile,
  beak nose, almond slits) on a walnut head-box; dusty-rose felt robe, cream under-robe + crossed collar, brown sash
  (knot + hanging tail), cream turned cuffs, leather-wrapped forearms, big carved-wood jointed hands (~0.33 m long),
  dark leggings, brown boots. Lantern hangs from the brim at her RIGHT (-X) in both views.
- Decision: lantern moved to her front-right diagonal (brief's facing cue) and painted procedurally; glass = accent.
- Plates: proto/tunlan_plates.py (own cut: row-border distance + fill holes; hat top kept, gaps between legs/arms are
  backdrop). Mask checked: art/renders/fighters/tunlan/_fit/plates_mask.png OK. front cx 571 (hat axis), ground 1454, top 110.
- 2026-10-28 sculpt: art/blender/fighters/tunlan.py (SDF parts, hat + rim as clean lathe lows, jointed carved hands:
  palm + 2 finger-pair groups x 3 segments + thumb x 2, rigid on x_fa*/x_fb*/x_ft* bones). Fit: proto/tunlan_fit.py,
  IoU front 0.85 / back 0.85 (_fit/fit_front.png). Rig: shoulders x0.14 @1.38, arm 0.62, hands 0.45 hang as painted.
- Accent plan (pipeline gate 1.5-6 %, the hat hides everything from above): lantern glass (6 panes) + a lamp vent in
  the brim above the hook + a 2.5 cm lamp-glass ring round the crown (all `accent`). Build 1 (default paint/clips):
  26.9k tris, 1229 KiB (over), accent 0.24 % (the ring/vent were under the clean lathe low: now proud of it).
- Clips written (clip_overrides): idle (puppeteer hands), run, attack1 (two-finger flick), attack2 (palm push),
  cast_a1 hound hands, cast_a2 spread palm -> grip, cast_a3 brim flick + lamp swing, cast_ult beast arms -> pounce,
  death (kneel + fold), recall (cupped lantern), idle_lobby (bird/rabbit/hound/beast/hat tip), victory, stunned,
  dash, channel, taunt. Hand frames via an Orient IK key (anim.resolve wrapper); corrected foot roll (Vashil's).
- Paint wrapper written (projection + back match + side fill; hat/rim/lantern/hands/legs procedural; value ramp).
- Build 4 (fast): 21.7k tris, 1146 KiB, accent 1.9 %, three load test OK (run planted feet OK after the foot-roll fix).
  Fixed since build 2: hat leveling (x_hat takes back 60 % of the head's tilt; poses may set hat_level / hat_floor),
  chunkier touching fingers, warm cream hat (#CDB89F), robe lift, shorter legs + stronger skirt leg weights (no
  poke-through), death = kneel + fold with the hat resting on its brim (floor clamp), pounce/death wrists absolute.
- Skins written (SKINS, HAT_SCHEMES, selective rose-felt recolour, SKIN_FLAT puppet rods); not built yet.
- Compare renders: proto/tunlan_compare.py (Blender) + tunlan_fit.py --compare -> _fit/compare.png.
- Build 9 (full quality, base): 21658 tris, 1136 KiB, accent 1.9 % (three QA), load test OK, clip sheet reviewed
  (hound thrust level, palm -> grip, recall cups the lantern, victory cupped hands, death kneel/fold).
  lineup_qa (tunlan vs dunsom/vashil/nurrow): IoU64 max 0.565 / 0.555 / 0.494; bands top 66.6 (low: hat lightened
  after), mid 60.9, bottom 33.8. Splash (victory) and portrait (idle_lobby t0, facing front) checked.
- Skins build started (--skins-only).
- Skins build 1: noon_fair 22.3k tris 932 KiB accent 1.97 %, lamplit 21.7k tris 898 KiB (its three QA hung in headless
  Chrome: my own child killed after 25 min idle). Both robes came out a pale wash (per-channel gain off a wrong base
  median): recolour now anchors the felt's painted median on the skin hex and keeps the painted values.
- Added "weapon": "prop.R" to SOCKETS (the content's standard set). Final build (base + skins, --clip-sheet) started.
- 2026-10-28 FINAL. Base (full quality, --clip-sheet): 21,658 tris, 1136 KiB, accent 1.9 % (three QA, 91.7 % top half),
  facing +Z, load test OK (all clips, run planted feet). Skins: tunlan_noon_fair 22,338 tris 919 KiB accent 1.97 %;
  tunlan_lamplit 21,658 tris 893 KiB accent 1.97 %; both load-test OK. Skin felt recolour anchored on the brief's
  base felt (#7C6C66) value; skin hats procedural (Noon Fair lilac rings/dots/crown + plum rim; Lamplit walnut ribs,
  rim and crown ring round lit lampresin panels).
- lineup_qa (art/renders/fighters/tunlan/lineup/tunlan_final.*): IoU64 vs dunsom 0.565, vashil 0.555, nurrow 0.494;
  value bands base 70.9/64.0/33.8, noon_fair 71.3/65.2/35.0, lamplit 69.1/62.1/34.1 (lamplit top ~1 under 70).
- Content: art.json copied into content/fighters/tunlan.json (height 2.05, runRefSpeed 3.35, + lamp / gesture
  sockets); content/skins/tunlan.json unchanged (paths match). build_content --check OK, nothing missing for tunlan;
  probe_kits_A 525/0, probe_kits_B 733/0. In game: _harness/_shots/art2_tunlan_{game,close,close2}.png.
- Open: accent reads near-white in game for the local player (as on peers); the front-right lantern crosses the mask
  from right three-quarter views; the hat does not fall off in death (rests tilted on its brim over her).
