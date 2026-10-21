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

## 2026-10-20 15:02 CDT — FIX PASS started (24 review items)
- Committed state (d46af9ef) read; the reviewers' items: blade/guard likeness, painted arms, tiled lames, cape
  ghosts, tan patch, gems + accent spread, splash, visor, helm back, skins, wedge, gold trim; in game: ult leap,
  cast follow-through, Shard Kick, dark blade, run carry, death, recall, victory, coat slab, ult VFX.
- ervet.py reworked: blade 13.4 cm wide rolled 30 deg toward the camera + procedural dawnglass paint (core,
  fuller, pale bevels), dawnglass roughness 0.40 (extra_materials); broad recurved chalk crossguard (Extrude)
  with lozenge inlays; gems removed (crest diamonds, clasps, back + buckle diamonds); visor = a prism pane in an
  ink-painted slot; lames = 5 rows of separate plates (slot cuts) painted per plate; pauldron tops smaller,
  sloped, carved groove, procedural stone; chalk rerebraces + elbow cops, blued vambraces, wrapped forearms,
  gloves, new boots (sole, heel, toe, cuff); coat narrower (hem 0.71 m vs mantle 0.85 m), fully procedural
  cloth (no slit/arm/background ghosts) + 'coatmix' binding (front flaps on hips/thighs); ochre trims -> warm
  stone; helm back/sides chalk, scarf cream at its painted value, crest back lifted.
- Motion: cast_a2 = planted blade + straight left front kick at f10; run two-handed, blade trailing out to the
  right; death drops the sword (prop.R location keys via a write_action wrapper), kneels, topples left;
  recall 90 f with a bow/look beat; victory ends planted at a long diagonal, left hand on the hip; dash =
  leaping arc (hips +0.34 m) ending in the downward swing (plays over Whole Again's dash in game).
- Fit IoU front 0.833 / back 0.83 (was 0.82 / 0.82). Next: base build.

## 2026-10-20 15:44 CDT — fix builds 1-3
- Build 1: 20.3k tris, 1463 KiB (over): decimated oblique voxel blades kept 680/1240 tris and shattered into UV
  islands; slot-cut lames fragmented (2.6k split verts per side). Fixes: parametric clean blade lows (10-point
  section, sharp bevels, 200 tris, the stub's jagged break) and parametric lames (5 grid bands per side, plates
  ridged + scalloped, a lip) -> build 3: 17,168 tris, 1095 KiB, load test OK, facing +Z, accent 1.87 % (97.8 %
  top half; hilt 1.94, great 1.80), run foot error 0 %.
- Matte overrides (leather 0.84, ironstone 0.88, chalk/stone 0.80) + render-only specular 0.2 + sun 1.45: the
  splash boots/greaves no longer turn pale. In game (art2_ervet_*): blade, mantle, coat read; ult = cast_ult
  coil then the leaping dash clip (blade overhead -> swung down at the landing); the landing VFX whiteout is VFX.
- Now: build 4 (helm slot ink limited to the slot, deeper lames), then skins.

## 2026-10-20 16:32 CDT — builds 4-6, skins pass 1, final builds running
- Build 5: blades get rounded custom shading normals (a pale band catches the light at any facing); stone
  darker; cape chain stiffer (limit -10..22, inertia 0.10) so strikes no longer fling the back panel as a board.
- Build 6: a wrist roll after the aim (anim._solve_aim wrapper) turns the blade's flat toward the sky (80 %, up
  to 70 deg): in game the blade now reads as a wide bar with its guard from the high camera (was a dark
  edge-on stick). Gates: 17,168 tris, 1094 KiB, load OK, accent 1.87 %.
- Skins pass 1 (stillwater 915 KiB / 17,168 tris / accent 1.68 %, lamplit 957 KiB / 17,528 tris / 1.68 %; both
  load OK): Stillwater reads slate wet-stone with sea-glass blade and sea-grey scarf; Lamplit walnut all round
  (back cape included), smoked-resin blade, lamp cage at the pommel end.
- Final: victory keeps its authored blade roll (the splash blade went edge-on with the roll), glass paler;
  base build 7 + skins build 4 running.

## 2026-10-20 19:33 CDT — FIX PASS 2 started (22 review items)
- State: fix pass 1 committed (55c27509); outputs from 16:39-16:43 (base 17,168 tris / 1094 KiB, skins pass).
- Plan: visor = slim tapered star slit + thin cheek lines (geometry, smooth ink), white shard/ball, back collar +
  large back plate, smaller scarf with knot + fold values, desaturated lames, arms, upswept pauldron caps,
  boots darker, ochre trim, lamp cage visible; motion: prone death (cape drapes), leap/lunge dash, split
  cape tails with run flutter + taper, relaxed idle (left hand free), victory both hands on the pommel,
  great blade longer, idle amplitude.

## 2026-10-20 19:57 CDT — fix pass 2: model + motion rewritten, build 1 running
- Face: helm_sculpt (domed kite face plate, beak), the glass = visor_low (parametric: a slim tapered slit with a
  four-point star + two thin cheek lines, set in constant-depth grooves (Groove prim) of the curved face); the
  helm painted fully procedurally (no projected slit/star ghost), anti-aliased ink borders from the outline
  distance; helm uv_weight 2.2. Crest glass split into its own accent part.
- Scarf: two wraps below the chin (no hood/cowl), swag, knot on her left collarbone, two ends over the left
  breastplate (lames now start at 12 deg so nothing pokes through); fold-value paint (curvature, undersides).
- Caps: BentPlate stone shells drooping down the back into the concept's collar, upswept points, ochre bead,
  carved ring, a stone clasp on her right shoulder. Lames: jittered seams, flare 0.42, rows sloping outward and
  down the back, softer seams, desaturated slate (#4A5A66). Back plate: large BentPlate, chevron at 1.215 m.
- Arms: chalk shells (rerebrace with a fan couter, vambrace swept over the elbow), dark wraps between.
- Coat: rx 0.30 -> 0.27 (tapers), back slit from 1.04 m, two tails on chains cape_L/cape_R (custom weights),
  outer back corners cut up; trims ochre #8C7A5C, clean hem band. Boots darker, no pale cuff.
- Motion: idle = concept stance (right hand at the hip, left arm free), bigger breathing + glance; dash = leaping
  lunge (rise, apex, fall, landing held 25 %); cast_ult grounded until the f14 push-off; death ends prone (coat
  over the legs, sword lands to her right); victory hold both hands on top of the planted blade; run tails
  driven per leg + a "_cape" wind key; Shatter lands out to her right; great blade 1.85 m.
- New helper: proto/ervet_preview.py (Workbench geometry preview, ~1 min).

## 2026-10-20 20:25 CDT — builds 1-3 of fix pass 2, build 4 running
- Build 1: 20,052 tris, 1369 KiB (over): hollow arm-plate shells kept 2x their triangles and split into islands
  (1.8 verts per tri). Arm plates made solid half-shells, lames 2 samples per plate, part budgets trimmed.
- Build 2: 1203 KiB (over). Build 3: 1165 KiB but the bind pose failed (the 1.85 m great blade reached 4 cm
  below the ground): great blade 1.76 m; the face glass was flat-shaded (1,248 accent verts): smooth now.
- Looks: face reads as the concept (slit + star + cheek lines, chalk mask, no ghost paint); back = collar +
  large back plate + split tails; scarf below the chin with a knot; death ends prone with the coat over the
  legs; dash = leaping lunge; run tails flutter (tail drive keyed per leg in the run, gravity 0.55).
- Splash: the forward right arm lifted the right lames and showed their dark inside: lames follow the upper
  arm only in their lower rows (dblend 0.16..0.60); victory hold = blade planted ahead, both hands stacked on
  the grip under the pommel; splash yaw back to 24 (the brief's 22), cooler rim 0.35. Tails limit 30 deg.

## 2026-10-20 20:50 CDT — build 5 green, skins pass, final base + skins build running
- Build 5: 16,340 tris, 1147 KiB, load test OK, facing +Z, accent 1.69 % (97 % top half; hilt 1.79, great 1.58).
  Caps now crescents (thinning to a swept-up point), lames follow the upper arm again in their lower rows
  (dblend 0.12..0.48: an elbow pierced them in the hold), victory elbows down, arm plates inked rims.
- Skins pass: stillwater 943 KiB / 16,340 tris, lamplit 998 KiB / 16,700 tris, both load OK, accent 1.68 %.
  Lamplit's cage was lost against the chest in the splash: darker walnut cage, bigger amber bead (skin palette
  wood/lampresin), cage 6.8 cm.
- Picks (three.js, art/.cache/fighters/_ervet_qa/ervet_base.glb): cast_ult stays grounded through f14 (push-off),
  dash = rise/apex/fall/landing, death ends prone with the coat on her back (no sail, feet on the ground),
  Shatter now lands out to her right (the blade reads from behind). In game (art2_ervet_*): blade trails in run.
- Final: lames #4F5A60 (hero renders still ~44 % sat in the cool sky light, game material 13 %).

## 2026-10-20 21:22 CDT — fix pass 2 done (not committed)
- Base (build 8): 16,340 tris, 1146 KiB (1,173,848 B), three load test OK, facing +Z, accent 1.69 % (97.2 % top
  half; hilt 1.79, great 1.58), 14 clips, run foot error 0 %. Skins: stillwater 943 KiB / 16,340 tris / 1.69 %,
  lamplit 986 KiB / 16,720 tris / 1.68 % (cage now hangs off the pommel's side: reads in the deluxe splash);
  all load OK, facing +Z.
- Run trail back to ~45 deg back-and-right (a pure side trail hid the blade whenever her right side faced away).
- Content: art.json identical to the content art block (no edit needed); build_content --check
  --allow-missing-assets OK; strict check lists nothing for ervet. In game: art2_ervet_{game,close,close2}.png.
- Open: one dash clip serves Quick Jab and Whole Again (present.anim is a ClipRole; a separate jab clip needs a
  kit/contract change outside this lane); victory has no break-and-reform (no in-clip form swap); hero renders
  still lift the lames to ~44 % saturation in the cool sky light (albedo 18 %, game 13 %).

## 2026-10-20 21:51 CDT — FIX PASS 3 started (20 review items)
- State: fix pass 2 outputs (21:18-21:21, base 16,340 tris / 1146 KiB). Items: helm egg (no paint, bald back),
  crest reads as one ear off-front, mannequin arms, mitten hands, guard/blade likeness, coat left board, boots/shins,
  dark hero lames, visor cross + accent spread, skins too similar, clasp sticker; in game: no jab (dash clip),
  attack1 coat slab, idle vs clip start/end snap, run blade hidden behind mantle, one-handed attack2/Heavy Arc,
  ult leap low, recall snap, victory reform; renderer/bot items (19, 20) are outside this lane.

## 2026-10-20 22:20 CDT — fix pass 3: model, paint and motion rewritten, build 1 running
- Helm: the concept's face projected again (its glow painted out of the plate: _clean_face_plate), sides/top
  procedural chalk in the concept's brushwork (_detail: the breastplate's high-pass, triplanar); the back is
  a flat-topped stone column under the crest; crest 9 cm deep over the column; crest glass strip removed;
  star arms shortened (tips at 3.5 cm).
- Hands: real fists (four curled fingers round the grip line, knuckles, thumb, cuff); prop.R moved into the
  right fist's curl, prop.L = its mirror (the two-handed holds lay the left fist on the grip below).
- Arms: two overlapping rerebrace lames with rims, a disc couter with a boss, a keeled vambrace; painted
  with ink outlines, bevels, carved lines. Guard heavier (6 cm arms, langet, boss, tight centre setting, no
  ink), blade 15 cm, clean glass paint (no speckle/bump). Coat folds deeper + ragged hem; shins thicker,
  calves, chunkier boots (toe box, sole, cuff, strap); clasp a carved boss; lames lighter; skins: plates,
  caps, helm, scarf, gloves per skin (stillwater green wet-stone, lamplit warm walnut).
- Motion: guard == idle (anim.guard wrapper) so every clip starts/ends on the idle; dash = leaping thrust
  (blade overhead at the apex, point-first thrust, landing lunge); Heavy Arc lunge 0.46 m; attack2 a
  two-handed return slash with a step; run trail near level + wider; cape tails on the hips; recall 270 f
  with a kneel-down intro (rise hidden past 8.5 s, loop closed).
