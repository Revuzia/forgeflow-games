# Ervet Art 2.0 progress

## 2026-10-20 09:12 CDT — plates
- `art/blender/proto/ervet_plates.py --height 2.15` (wraps art/tools/concept_plates.py): crest top = 2.15 m
  (mantle 0.79 m across, head crown under the crest ~2.11 m). Front cx 617.5 ground 1432 top 157; back cx 1422
  ground 1420 top 156.
- Mask fixes: pale helmet + crest re-joined (head boxes, lower threshold), pale-blue blade tips re-joined, pale
  background between the legs under the hem and between the right arm and the coat (back) cut away.
- Plate edits: painted blue gems on the body erased (brief bans gems; visor slit + crossguard/pommel inlays become
  accent geometry). Blade-free body plates `ervet_{front,back}_body.png` (sword inpainted: mirrored body paint
  below row 960, across-the-blade fill above) for the body parts so no ghost blade lands on the coat/greaves.
- Review overlay: art/.cache/concept/ervet_check.png (magenta = cut away, cyan = sword band, yellow = erased gems).

## 2026-10-20 09:33 CDT — first full build
- `art/blender/fighters/ervet.py` written (SDF parts, rig fitted, prop.R along the blade, cape + tabard chains,
  three blade forms, projection by group with blade-free body plates, form-aware renders/QA wrappers).
- `art/blender/proto/ervet_fit.py` fit check (silhouettes over the concept): IoU front 0.82 / back 0.82.
- Build 1 (100 s): runs end to end, forms split (form_base/hilt/great) and QA per form works.
  Open: GLB 1222 KiB (> 1172), accent 0.16 % (visor recessed, inlays tiny), cape chain flies out in strikes,
  standard clips (ult = channel-raise, victory = raise) need the brief's bespoke gestures, pauldron tops streak.

## 2026-10-20 10:14 CDT — gates green on the base
- Accent: visor slit flush + wider, a glass strip in the crest's top edge, diamond inlays along both crest faces,
  pauldron clasp diamonds, back-plate diamond, buckle, crossguard/pommel inlays: 2.7 % at the game camera (95 %
  top half); hilt form 2.79 %, great form 2.59 %.
- GLB 1131 KiB (tris 18.2k; no `channel` clip: Ervet channels nothing), three load test OK, run slide 0 %.
- Pauldrons re-shaped (angular plates, domed) + top plate `proto/ervet_tops.py` (stone + ochre bead + carved bands).
- Coat sides painted from inside the silhouette (no edge streaks); cape chain stiff (limit -15..42 deg).
- Bespoke clips: cast_a1 sweep+lunge (20 f), cast_a2 plant+kick (25 f), cast_a3 slam (30 f), cast_ult coil/leap/
  land (35 f, airborne at f14), idle_lobby grounded blade + knuckle tap (120 f), victory strike-down + hold,
  recall kneel behind the grounded blade; run one-handed with the blade trailing.
- Content art block updated from art.json (height 2.15, runRefSpeed 3.45, clips, sockets blade_tip/crossguard).
- Tools: proto/ervet_poses.py (clip contact sheets from the cache, no rebuild), proto/ervet_fit.py.

## 2026-10-20 10:55 CDT — final base, skins rebuilding
- Base final: 18,183 tris, 1135 KiB, three load test OK, facing +Z, accent 2.64 % (hilt 2.73, great 2.54), 14 clips.
- Crest inlays now five glass diamonds per face; victory hold faces front; splash key softened (SPLASH sun 2.1).
- Skins (first pass): both pass (stillwater 955 KiB, lamplit 1033 KiB, accent ~2.45 %); per-channel gain turned the
  lamplit walnut olive -> hue-aware recolour wrapper (`_recolour`), skins rebuilding.
- In game (`_harness/_shots/art2_ervet_*.png`): blade in hand, cape stays on, crest + visor read from above.
- Content: art block re-copied; `build_content --check --allow-missing-assets` OK; strict check lists nothing for ervet.

## 2026-10-20 11:22 CDT — done (not committed)
- Skins final with the hue-family recolour: stillwater 950 KiB / 18,183 tris / accent 2.46 %, lamplit 1028 KiB /
  18,483 tris (lamp cage on the pommel) / accent 2.45 %; both three load test OK, facing +Z. Lamplit reads walnut.
- Content checks: --allow-missing-assets OK; strict check lists nothing for ervet or its skins.
- Open: splash chalk blows out under the splash key (helm reads white from the low hero camera); the body is a
  clean painted read in game but the coat's back is plain (the concept's back is plain too).
