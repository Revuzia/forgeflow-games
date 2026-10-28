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
