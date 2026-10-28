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

## FIX PASS 1 (2026-10-28 08:17) — reviewer items 1-9; agent started, read _progress.md
- 08:32 diagnosis: (1) robe ghosts = plate pixels that are not felt (the concept's wood hands, the extruded
  backdrop streaks, cuffs) projected onto the skirt/sleeve sides; the back sheet's grey hands come through _match_back as
  lighter/darker felt. (2) lantern at front-right crosses the mask. (3) hands = 2 touching boxes per finger pair + peg
  thumb. (4) brim 1.27 m covers the gestures. (6) head-box albedo IS dark walnut (87,66,49): the pale/bluish read is
  the wood_dark roughness 0.5 catching the sky; the 'Z' = two board-joint capsules that only cut near the top (wedges).
  Plan: brim -> 1.10 m (rim r 0.55, crown kept), lantern back to the concept's side (x -0.40, y +0.03) as an open
  ironstone cage round a lampresin bead with a small accent core; crown ring dropped, front lens vent enlarged;
  4 separate tapered fingers + real thumb + tapered palm; puppeteer guard at the chest; impacts pushed past the brim;
  plate-pixel 'felt / cream-zone' classification for the cloth projection; matte walnut head + one crack.
- 08:47 code written (fix pass 1): hat 1.10 m (HAT_R 0.522, RIM_C (0.530, 1.8545), RIM_H z 0.040, EDGE_R 0.509;
  crown kept), crown_glow removed, front lens vent (VENT_CR 0.426, half 0.150 x 0.060, elliptical grommet), lantern
  at (-0.40, +0.03) as open cage + lantern_bead (lampresin, procedural amber) + lantern_core (accent, 4 x 3 cm),
  hands = FTaperBox palm + FINGERS (4 separate tapered) + thumb (u*0.96 - lat*0.22), head crack (one Tube) + wood_dark
  roughness 0.84 (MATTE via extra_materials), plate felt/cream classification in _proj_sides (+ _cream_zone),
  puppeteer guard (GUARD_W/F/P), impacts past the brim (attack1/2 wrist y -0.74, a1 snap y -0.86, a2 hand out at
  r ~0.7, a3 arm up through the front brim + lamp_world swing out), death = hat off (hatw_* keys -> x_hat_loc
  location keys via write_action wrapper; lantern laid out), recall cups the side lantern, dash/taunt animated,
  Lamplit hat scheme (walnut ribs/band/rim, lit panel cores), Noon Fair felt chroma x1.9 / value x0.92,
  portrait/icon boxes widened 0.20 m toward the lantern. Fit: IoU front 0.825 / back 0.820 (was 0.85: smaller hat).
  Accent estimate (fit tool) 1.32 % (old design 0.78 % -> three QA 1.9 %).
- 08:47 base build started (--no-skins --clip-sheet), log /tmp/tunlan_build_base.log
- 08:57 base build fp1-a: 22,863 tris, 1178 KiB (OVER 1172), three accent 1.68 % (top half 99.4 %), load OK
  otherwise. Albedo views (proto/tunlan_compare.py --albedo, new side_l/side_r views): skirt + sleeve sides clean (no
  hand ghosts, no backdrop streaks); guard hands read at the chest; death drops the hat beside her; dash/taunt move.
  Changes for fp1-b: fingers wider (0.033/0.034/0.032/0.029, 2 mm apart, taper 5 %/seg), tris cut (lathes 48 segs,
  fingers 180, palm 420, boots 1000, robe 1800/1950), wood roughness 0.68 (mask rims caught the sky), mask back rims
  walnut, attack1 ring pair folded into a fist (the 'sickle').
- 09:05 base fp1-b: 21,587 tris, 1147 KiB, three accent 1.68 % (top 99.4 %), load OK (run planted 0.6 %).
  lineup_qa (art/renders/lineup/tunlan_fp1_base.*): bands f0 70.9 / 59.8 / 34.7 OK; accent 1.85 / 1.45 / 0.89 / 1.49 %
  (back facing under 1.0) -> the lens became an arc LAMP SLOT along the front brim (ArcSlot / _slot2d: r 0.418 +-
  0.045, +-0.21 m of arc, round ends, ironstone grommet): fit-tool estimate min facing 1.25 (lens 0.88 -> lineup 0.89).
  IoU64 max vs dunsom 0.607, vashil 0.588, nurrow 0.51. Unit sheet (gameplay-high camera, three_snapshot --unit on a
  copy): attack2 / a1 thrust / a2 hands / a3 arm / ult all clear the brim; death drops the hat beside her.
  Head crack painted dark in _head_paint (HEAD_CRACK). Base rebuild fp1-c started.
- 09:11 base fp1-c: 21,223 tris, 1145 KiB, three accent 2.36 % (top half 100 %), load OK. Skins build started (log /tmp/tunlan_build_skins.log).
- 09:19 skins s1: noon_fair 21,903 tris 918 KiB accent 2.39 %, lamplit 21,223 / 890 KiB / 2.4 %, load OK.
  lineup_qa (art/renders/lineup/tunlan_fp1.*): accentOk TRUE for base + both skins (1.19-2.49 %, top half 1.0);
  base bands f0 70.9 / 58.9 / 34.6 OK; noon_fair bottom 35.2 (over by 0.2); lamplit top 58.7 (the 5 cm walnut brim
  band + wide ribs). IoU64 max dunsom 0.607 / vashil 0.591 / nurrow 0.509. In game (_harness/_shots/art2_tunlan_* and
  fp1_tunlan_t75_*): the lamp slot reads as a bright arc at the front brim, the guard hands show below the brim.
  content: art.json == content art block (unchanged); build_content --check OK (nothing missing for tunlan); kits A 525/0,
  B 733/0. s2: Lamplit panels brighter (#E4D0A6, cores #F0DCB4, the #A38C6B shade only at the ribs), ribs 1.2 cm,
  brim band 1.6 cm; felt Noon Fair chroma 1.7 / value 0.88, Lamplit 0.9 / 0.92 (a deeper walnut grey). Skins rebuild s2.
- 09:24 skins s2: noon_fair 917 KiB / lamplit 890 KiB, accent 2.4 %, load OK; lineup: noon_fair bands OK
  (70.4 / 60.0 / 34.8), lamplit top 68.8 (under 70). s3: Lamplit panels golden + brighter (#ECD5A6, cores #F7DEAD,
  crown #E0CCA2, shade only in the last 16 % to the ribs, ribs 1 cm), robe a deeper walnut grey (value 0.80).
- 09:29 skins s3: noon_fair 21,903 tris / 917 KiB / accent 2.39 %, lamplit 21,223 / 891 KiB / 2.4 %, load OK.
  lineup_qa FINAL (art/renders/fighters/tunlan/lineup/tunlan_final.*): valueGradientOk + accentOk TRUE for all three
  (base 70.9 / 58.9 / 34.6, noon_fair 70.4 / 60.0 / 34.8, lamplit 70.0 / 56.6 / 32.7; accent per facing 2.49 / 1.97 /
  1.19 / 2.13 %, top-half share 1.0); IoU64 max vs dunsom 0.607, vashil 0.591, nurrow 0.509.
## FIX PASS 1 DONE (09:29) — per item
 1 robe ghosts: _plate_classes + _cream_zone: felt parts take only the plate's felt (cream only in the under-robe /
   collar zone; eroded masks); the wood hands, cuffs, extruded backdrop and the back sheet's grey hands now count as
   hidden and refill from the nearest felt; skirt side fill widened. Albedo side views clean (no hand patches, no
   cream bands, no pale sleeve tops); skins inherit it.
 2 lantern: back at her right side as painted (x -0.40, y +0.03, a little further out so it clears the mask from the
   right 3/4 views); open ironstone cage round a smoked amber lampresin bead (procedural, glossy, not emissive) with a
   3 cm accent core showing at four points; no accent panes; crown ring removed.
 3 hands: tapered carved palm (FTaperBox) + four separate tapered fingers (2 mm apart, round joints, rounded tips,
   middle longest, little shortest) + a real two-segment thumb hanging alongside; puppeteer guard (hands before the
   chest, palm-down, fingers half-curled) for idle and every clip's rest; attack1's ring pair folded into a fist.
 4 gameplay read: hat 1.10 m across (rim r 0.55) + impacts past the brim (attack1/2 wrists 0.74 m ahead, hound snap
   0.86 m, Hand Shadow out at r ~0.7 with the left hand at the left brim, Lamp Flare arm stretched up through the
   front brim + the lamp swinging out from her side). Unit sheet: every cast gesture clears the disc.
 5 accent: front-brim LAMP SLOT (arc, ironstone grommet) + lantern core only; three QA 2.36 % (top half 100 %),
   lineup accentOk TRUE for base and both skins (min 1.19 % at the back facing).
 6 head: wood_dark roughness 0.84 (and wood 0.68) via extra_materials (the pale/bluish box was sky reflection); the two
   wedge 'joints' replaced by one thin crack, painted dark; the mask's back rims painted walnut.
 7 death: the hat slides off her left as she sinks, lands on its edge, rolls a little and settles beside her propped on
   the laid-out lantern (hatw_* pose keys -> x_hat location keys via a write_action wrapper; lamp_world); she folds.
 8 skins: Lamplit = golden lit-from-within panels with walnut ribs, crown ring, brim band and a walnut rim, a deeper
   walnut-grey robe; Noon Fair felt plum (authored hue 338 / sat 23 %, value x0.88). Both pass the value gradient.
 9 polish: dash = crouch -> glide -> streaming hands -> rise with finger flutter; taunt = ears flop + two hops + head
   cocks; portrait/icon boxes widened 0.20 m toward the lantern (lantern under the brim beside the mask), mask lift
   1.07. HP bar: game code anchors it at art height + 0.35 m; the smaller brim reduces the overlap (not removed).
 Gates: base 21,223 tris / 1145 KiB / load OK / facing +Z / 16 clips / run planted 0.6 %; skins 917 / 891 KiB.
 art.json == content art block (unchanged: height 2.05, runRefSpeed 3.35); build_content --check OK (nothing missing
 for tunlan or skins); probe_kits_A 525/0, B 733/0; in game _harness/_shots/art2_tunlan_* and fp1_tunlan_t75_*.
 Silhouette fit to the concept now IoU 0.826 front / 0.822 back (was 0.85: the smaller hat). Not committed.

## FIX PASS 2 (2026-10-28 09:41) — reviewer items 1-8; agent started, read _progress.md
