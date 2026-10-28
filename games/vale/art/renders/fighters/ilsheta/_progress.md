# Ilsheta Art 2.0 progress

- 2026-10-28 start: no earlier progress. Read HANDOFF Art 2.0 method/rollout prep, marund.py, brief _design/fighters/ilsheta.md, content json, skins json.
  Plates: art/.cache/concept/ilsheta_* exist from 10-14 shared cut (cloak holes known). Plan: write art/blender/proto/ilsheta_plates.py (Sukri-style flood-fill cut) so the whole pale cloak is figure.
- 2026-10-28 plates DONE: art/blender/proto/ilsheta_plates.py (flood-fill cut, staff band in-painted across the body, hook/lamp removed, holes above shoulders filled). Frame: front cx 551.75 ground 1430 top 103 (chimney top = 1.72 m), back cx 1476.75 ground 1424 top 104. Debug: _fit/plates_mask.png.
  Decisions: staff+lamp modelled in the RIGHT hand (brief), painted procedurally (not projected); chimney = opaque dawnglass solid painted by projection (the concept paints the clear glass); hood crown ROUNDED (sensitivity: no pale pointed hood), chimney exits through a collar.
- 2026-10-28 measured on the 10 cm grid (front/back extents table): chimney r ~0.074 (1.50-1.65), lip 0.084 at 1.72, flare ~0.12 at the face; mask oval x +-0.087, z 1.215-1.447; hood +-0.20 at 1.17 -> +-0.11 at 1.42; scarf 1.05-1.20 +-0.21; bell rx 0.205 (1.05) -> 0.31 (0.70) -> 0.46 (0.40), hem ~0.345; sleeves cuff at the wrist (+-0.38, 0.80); dress hem 0.43; boots 0-0.28 at x +-0.088.
  Rig: crown 1.47 (head in the hood), shoulders +-0.17 at 1.088, hips 0.62, arm 0.39, a-pose 53.
  Plan: module ilsheta.py = SDF parts (custom loft prims for hood + mantle shell), staff (1.20 m, diagonal carry, butt low outside the right foot) + lamp on x_lamp hung plumb by a resolve wrapper, Orient hand frames (left hand open), custom weights, paint wrapper (procedural staff/lamp/gloves, lining darkening, vis without props), AO shift of props, skin recolour wrapper (mantle z-graded cloth2->cloth->cloth3 gains).
- 2026-10-28 module written: art/blender/fighters/ilsheta.py (sculpts, weights, paint/AO/recolour/portrait wrappers, resolve wrapper with Orient + plumb lamp, all clips bespoke incl. crit/dash/stunned/channel/taunt). Fit tool: art/blender/proto/ilsheta_fit.py (--poses staff/lamp clearance; --table). Fit IoU front 0.85 / back 0.86. Rig: arm 0.36, shoulders +-0.16 at 1.04.
- build 1 (base, --fast, clip sheet) starting.
- 2026-10-28 build 1 (fast base): 22220 tris, 1189 KiB (over), accent 0.62 %, run no planted frames (stock foot-roll sign), brown smudges on the mantle under the arms (occluded texels filled from the concept's painted under-arm shadow). Clips otherwise read.
  Fixes batched for build 2: lamp hung at her RIGHT SIDE (concept place; accent visible from the back facings) + core 14x19 cm (estimate 1.52 %, the fit tool's estimator matched build 1 exactly: --accent --lamp-at); tris -> ~18.7k; occluded mantle/sleeve/scarf texels take the band median of visible paint (_band_fill); corrected _solve_foot; scarf lower roll covers the painted shadow; attacks re-authored from the side guard.
- 2026-10-28 build 2 (fast base): 18692 tris, 1100 KiB, load test OK (run planted), accent 1.41 % (< 1.5). Brown smudges mostly gone. Three render: the pale linen reads bone-white/blue under the game's cool light.
  Clip-check tool added: art/blender/proto/ilsheta_clipcheck.py (re-poses the cached .blend, Workbench sheets in _clips/, staff/lamp~body penetration counts; ~5 s). Clips tuned with it (attack tilts, cast_a1 height, cast_a2/ult staff off the chest, lamp off the chest in cup/recall/stunned/channel/lobby).
  Batched for build 3 (FULL base): core r 0.074, thinner ribs, narrower cap (accent); warm chroma push on the linen (WARM x1.6).
- 2026-10-28 build 3 (FULL base): 18692 tris, 1093 KiB, accent 1.63 %, load test OK. Remaining: a muddy brown diagonal (the staff band's across-blend) on the left panel/sleeve and blue padding from the lamp glow; the face hidden by the lamp in the splash; the chimney read as a pale ceramic tube; the warm push saturated the brown shadows.
  Fixes for build 4: plates MIRROR the prop-covered paint from the clean side (ilsheta_plates.py mirror_props; the front is now staff-free, the sleeve top behind the lamp restored); chimney glass paint (_paint_chimney: catch-light streaks, cool sides, dark hollow top); warm push only on lit linen; victory lamp at chest height.
- 2026-10-28 build 4 (FULL base): clean mantle (mirror plates), 1094 KiB, accent 1.63 %. lineup_qa (vs sukri, dunsom, marund): height 102 px, IoU64 max 0.69 / 0.42 / 0.35 (<= 0.80 OK), value bands top 61.4 (guide 70-85: MAJOR miss), mid 46.9, bottom 34.6; accent per facing 1.37/1.55/0.99/1.64.
  Fix for build 5: soft-knee value lift on the head's pale parts (LIFT), lighter chimney well.
- 2026-10-28 build 5 (FULL base): top band 67.1 (mid 48.1, bottom 34.6), 1092 KiB, accent 1.63 %. Clip check of all 17 clips: distinct a1 (forward thrust, lamp at arm's end) / a2 (one arm raised, lamp high) / a3 (arms wide) / ult (overhead, on toes, arms wide); no staff/lamp through the body.
- build 6: LIFT raised a notch; base + both skins (full).
- 2026-10-28 build 6 (FULL base + skins): base OK 1090 KiB; skins 926 / 956 KiB, 19.1k / 19.5k tris, but their QA (bind pose: skins carry no clips) showed the staff jutting out like a broom and the lamp inside the bell (accent 0.09 / 0.07 %).
  Fix for build 7: rig_extras turns hand.R's REST frame to an upright fist (thumb up, knuckles forward) and moves prop.R to the grip along the shaft; the bind pose now holds the staff upright at her side with the lamp beside her (clears the sleeve by 3.8 cm). Clips unchanged (Orient is rest-independent).
- 2026-10-28 build 7 (FULL base + skins): base 18692 tris / 1066 KiB / accent 1.61 %; stillwater 19112 / 911 KiB / 1.50 %; first_bell 19450 / 935 KiB / 1.48 % (bind pose). lineup_qa: base top 68.3 mid 48.5 bottom 34.6; stillwater 65.4 / 44.7 / 28.6; first_bell 68.3 / 49.4 / 36.7; IoU64 vs sukri 0.69-0.70, dunsom 0.42, marund 0.35. Skin bind pose now upright staff + lamp.
- build 8 (last allowed, base + skins): face-plate paint contrast x1.45; Stillwater cloth2 -> #C4CFD3 (top band; the brief allows stepping by band); reed plates flatter (a ruff, not prongs).
- 2026-10-28 build 8 (FINAL, base + skins) DONE. Gates: three load test OK (base + both skins); base 18692 tris / 1071 KiB / accent 1.61 % (three QA), facing +Z; stillwater 19110 tris / 916 KiB; first_bell 19450 tris / 943 KiB (skin QA accents 1.49 / 1.48 % are the bind pose; in game the skins play the base clips). All 12 required clips + crit/channel/dash/stunned/taunt; impacts at 40 %, run planted (3.35 m/s).
  lineup_qa: base top 68.4 / mid 48.5 / bottom 34.6; stillwater 66.0 / 46.0 / 28.6; first_bell 68.3 / 49.4 / 36.7; IoU64 vs sukri 0.69, dunsom 0.42, marund 0.35.
  Content: art.json copied into content/fighters/ilsheta.json (runRefSpeed 3.35, height 1.72, clips, sockets incl. weapon_tip x_lamp / visor_top x_chimney_top); build_content --check OK, nothing missing; probe_kits_A 525/0, probe_kits_B 733/0; in-game shot _harness/_shots/art2_ilsheta_{game,close,close2}.png.
  Open (minor): top value band under 70 (base 1.6, first_bell 1.7 L*; stillwater 4.0 L*); first_bell bottom 36.7 (1.7 over); the lamp hangs at her right side (concept place) rather than the brief's chest place (the chest place hid the accent from the back facings: 0.62 %); no mantle sway bones (the brief's x_mantle_l/r); death ends kneeling, folded over (not lying).

## FIX PASS 1 (review: 6 majors, 5 minors)
- 2026-10-28 12:10 start. Plan, batched into one build (edits in ilsheta.py unless noted):
  1 chimney: ONE glass body chin->rim (chim_d: elliptic loft, beak pushed forward at the cheek, CHIM_C y -0.046), the
    face is the concept's mask projected onto the glass front (_face_zone; carving contrast x1.45, cool cast, glint);
    the mask part and the collar ring removed; hood opening widened (0.124 x 0.156) so the flare sits in front of the
    hood; procedural dawnglass paint elsewhere (_paint_chimney: cool see-through, darker edge-on sides, 4 streaks,
    bright lip, dark well). LIFT on the chimney dropped.
  2 lamp: guard re-authored so the lamp hangs IN FRONT OF HER RIGHT CHEST, pivot 1.43 / flame 1.21 (was ~1.0 at the
    hip); the lamp rebuilt: 21.6 cm open cage of 4 thin ribs, a 13 x 19 cm TEARDROP flame on a chalk burner (4 cm of
    clear cage round it), a glass font bowl under it; fit-tool accent estimate 1.68 % (8 facings, staff excluded).
  3 paint ghosts: _band_fill treats edge-on texels (|n.y| < 0.4) as hidden (band median fill, front/back blended), and
    clamps visible ghosts (texels >26 L* under their band, or warm browns under L* 62) to the band colour.
  4 casts: key_poses() (new): a1 = one long arm (staff thrust out level, lamp 0.65 m out), a2 = one raised arm (lamp
    hung high before her, left palm up), a3 = arms wide palms out + mantle flare 30-34 deg, ult = both hands overhead
    on toes (pitch -24, hips +5 cm) then a Y with the lamp high + flare. x_mantle_l/r sway bones added (rig_extras,
    weights: front panels within ~60 deg of the opening below the chest), the resolve wrapper adds the knees' swing.
    Left hand sculpted open (flatter fingers) for the pushes / palm-up.
  5 skins: _recolour re-paints the mantle + sleeves on the skin's own height gradient (SKIN_GRADE: Stillwater wet stone
    from 0.91 m down, First Bell dark #3A3633 base from 0.49 m down); 8 broad reed leaves round the chimney's foot;
    a bigger glass bell above the flame; hour-marks 7.5 cm x 8.5 mm; each skin its own splash pose (lobby / ult).
  6 splash: backdrop graded to an Aubade dusk (_backdrop wrapper, aubade_dusk 0.5), rim_warm 0.25, sun 2.5; icon /
    portrait boxes extended down to keep the lamp under the visor.
  8 bell sleeves wider (cuff 0.19 m), angular open-loop hook (HOOK), back drape folds (mantle_amp); staff 0.86 m.
  9 lobby: four tending beats with bigger sway; attack1 = left-hand flick, attack2 = staff tap with the left arm back;
    death lays the staff down so the lamp rests on the ground, ends bowed forward.
  Fit tool: ilsheta_fit.py --poses now checks every key pose (pivot, flame z, reach, clearances).
- build FP1-1 (fast base, clip sheet) starting.
- 2026-10-28 12:35 build FP1-1 (fast base): 18304 tris, 1092 KiB, load OK, accent 1.57 % (three QA, top half 72 %).
  Read: chimney now cool glass with the face inside the flare (portrait / icon / three close), lamp = blue teardrop
  flame in a clear cage, no brown side smear (lobby / victory frames), splash on the dusk backdrop. Clip check
  (ilsheta_clipcheck.py, now also prints the lowest part): a1 long arm OK from the side, a3 arms wide + flare, ult
  overhead on toes + flare; mantle panels follow the knees in run (forward, verified side view).
  Tuned without a rebuild (clip check on the FP1-1 cache): torso yaw of a1 (left flick) and cast_a1 (right thrust)
  was reversed -> flipped; cast_a1 aimed front-right, cast_a2's lamp out to her right (not over the face); guard lamp
  raised to pivot 1.48 / flame 1.26 and drawn in (fit-tool top-half share 0.82-1.0 at the front facings, was 0.23);
  death ends in a kneeling bow over the set-down lamp. Glass paint: darker cool body + edges, stronger streaks, bright
  edge lines down the flare's sides, a shoulder glint and a chin rim (so the bulb round the face reads as glass).
  Splash yaw 34 (the held-out lamp clear of the face).
- build FP1-2 (FULL base + skins) starting.
- 2026-10-28 12:47 build FP1-2 (FULL base + skins): base 18304 tris / 1067 KiB / load OK / accent 1.55 % (top half 79 %);
  stillwater 19028 / 923 KiB; first_bell 19124 / 918 KiB (bind-pose QA accents 1.50 / 1.32 %). Skins now read as
  skins (wet-stone mantle + sea-glass font + reed ruff; pale dial-stone over a dark hem with white hour-marks), each
  splash its own pose. lineup_qa (vs sukri / dunsom / marund IoU64 0.70 / 0.45 / 0.37): base top 65.1 (lower than
  before: darker glass + the lamp and glove now in the top quarter), bottom 37.3 (the ghost clamp lifted the dark hem),
  accent top-half 0.51 at facing 0 (was 0.0); stillwater top 57; first_bell mid 68 at the back, accent top-half 0.17
  (the glass bell over the flame). A small grey triangle on the chimney's back (one bad texel triangle).
  Batched for FP1-3 (last full build): guard lamp up 3.5 cm and in 2.5 cm (pivot 1.515; fit estimate 1.0 / 0.78 top
  half at the front facings), glass body brighter (side bands narrower), the dark hood seen through the glass given a
  sheen, LIFT hood 15 / scarf 13, the hem exempt from the dark-ghost clamp, chimney 1900 tris (re-decimate the bad
  triangle); Stillwater pale down to 0.93 m, wet stone from 0.79 m; First Bell cloth2 to 0.93 / warm grey from 0.80;
  the under-dress re-painted flat in the skin's cloth (First Bell's had turned tan); First Bell's bell slimmer, hung
  front-left of the flame; victory lamp lower + splash yaw 40 (the held lamp clear of the face).
- build FP1-3 (FULL base + skins) starting.
- 2026-10-28 12:56 build FP1-3 (FULL): base 18202 tris / 1063 KiB / load OK / accent 1.51 % (top half 89 %); stillwater
  18926 / 922 KiB; first_bell 19022 / 980 KiB. lineup_qa: base top 67.1 / mid 46.5 / bottom 37.3, accent top-half
  0.89 at facing 0 (1.0 elsewhere), IoU64 0.70 / 0.45 / 0.37; stillwater top 59.3 (REGRESSION vs 66.0: its sleeves
  were re-painted wet stone and ride up into the top quarter in idle); first_bell top 66.9 / mid 49.5-65.5.
  Splash: the held lamp clear of the face. The grey chimney triangle survived the re-decimation (tiny, back side).
  Batched for FP1-4 (the last full build, for the Stillwater regression + the base feet band): sleeves out of the skin
  re-paint (pale cloth2), LIFT sleeves 5, the base hem's slate deepened below 0.52 m (x0.78), Stillwater cloth3 from 0.47.
- build FP1-4 (FULL base + skins) starting.
- 2026-10-28 13:12 build FP1-4 (FULL base + skins) DONE: base 18202 tris / 1062 KiB / load OK / accent 1.51 % (three
  QA, top half 89 %), faces +Z, 17 clips; stillwater 18926 / 920 KiB, first_bell 19022 / 976 KiB (load OK; bind-pose
  QA accents 1.50 / 1.41 %). lineup_qa (facing 0): base top 67.0 / mid 46.9 / bottom 36.1, accent 1.67 % with top-half
  0.89 (1.0 at 90/180/270; was 0.0 / 0.06), IoU64 vs sukri / dunsom / marund 0.70 / 0.45 / 0.37; first_bell
  66.9 / 48.0 / 33.3; stillwater top 59.2 (the 8 broad reed leaves, L* 61, sit in the top quarter: 66.0 before).
  Content: art.json == the content art block (unchanged); build_content --check OK (nothing missing); probe_kits_A
  525/0, probe_kits_B 733/0. In-game shots art2_ilsheta_{game,close,close2} (t 25: close2 behind the lane wall again).
  Full-build budget used (FP1-2/3/4). Stillwater-only fix (skins-only, one skin): six reed leaves (the brief's count),
  pale straw tips painted.
- 2026-10-28 13:30 Stillwater-only rebuild DONE: 18902 tris / 917 KiB / load OK / three QA re-run by hand (the build's
  Chromium did not start): accent 1.50 % (bind pose). lineup_qa final (facing 0): base 67.0 / 46.9 / 36.1, stillwater
  63.7 / 43.5 / 33.0, first_bell 66.9 / 48.0 / 33.3; accent top-half 0.89 / 0.89 / 0.87 at facing 0, 1.0 elsewhere;
  IoU64 max 0.71 (sukri). build_content --check OK. In-game reshoot at t 40: _harness/_shots/art2_ilsheta_t40_*
  (open ground, feet and hem in view). FIX PASS 1 DONE.
  Per review item:
  1 chimney = one glass body holding the painted face (flare 0.24 m, beak forward), cool dawnglass paint with streaks,
    edge lines, chin rim; collar ring + separate mask removed.  2 lamp at her right chest (flame 1.29 m), teardrop
    flame in a clear cage + glass font; base accent 1.51 % (three QA).  3 side/hem smear and scarf ink blot gone
    (_band_fill edge-on fill + ghost clamp).  4 a1 long arm / a2 raised arm, lamp out at her right / a3 arms wide +
    mantle flare / ult overhead on toes + flare; x_mantle_l/r bones + knee follow.  5 skins re-painted on their own
    gradients (wet stone; dark hem + hour-marks), sea-glass font, reed ruff, bell, own splash poses.  6 dusk backdrop,
    warm rim down, icon/portrait keep the lamp under the visor.  8 bell sleeves, angular hook, back drape folds.
    9 lobby beats, attack1 flick vs attack2 tap, death sets the lamp down.  10 reshoot in open ground.
  Open (minor): top band under 70 (base 67.0, stillwater 63.7, first_bell 66.9; roster-wide caveat), base bottom 36.1
  (1.1 over), accent top-half 0.87-0.89 at facing 0 (guide 0.9), the back facing's accent ~0.8-1.1 % (the lamp is in
  front of her chest, the brief's place); a tiny grey texel triangle on the chimney's back (survived re-decimation);
  ally/enemy-tinted in-game view not possible with the bench (Ilsheta can only be seat 0 = self).

## FIX PASS 2 (review: 4 majors, 8 minors)
- 2026-10-28 13:45 start. Plan (one batched build; ilsheta.py unless noted):
  1 chimney: the painted-opaque glass could not read clear (3 passes). The tube is now REAL see-through glass: a
    low-only part `glass` (bmesh surface of revolution on the chimney's sections, open at both ends, culled inside
    the hood) in a kept material `gem_chimglass` (factor-only Principled, alpha 0.34, double-sided; glTF BLEND; the
    renderer already draws see-through parts without ink). The face stays OPAQUE: a 9 mm shell `chimney` set just
    inside the glass's front (the concept's face projected on it), plus an opaque bright rolled lip and chin rim; the
    rim pinches forward into a small spout (the facing cue from above). Hood tunnel interior painted dark lining
    (now seen through the glass), the crown inside the tube shaded. AO bake ignores the glass; Cycles renders swap the
    glass to a thin-glass shader (transparent + Fresnel gloss) for splash / portrait / turntable.
  2 accent: flame 14 x 19.4 cm (r 0.070, tip higher), guard lamp ~3 cm higher (top-half share at facing 0).
  3 cast_ult re-authored: both hands overhead on the staff (lamp hung out at her upper right, above the head), the
    bloom a Y (staff high + left arm wide); cast_a2: the LEFT arm raised high palm-up, the staff held out front-right
    (lamp beside the face, never before it).
  4 skins: the recolour's shade reference was the band median incl. the dark lining (outer cloth x1.35 lighter):
    now the band's 75th percentile; Stillwater wet stone from 0.88 m with a salt tide line; First Bell same fix.
  minors: base hem deeper (bottom band), hood / scarf despeckle, sleeve band-fill smoothed (First Bell stripes),
    attack2 a downward staff tap, death keeps the lamp upright + head less bowed, portrait lamp below the visor.
