# brightwick (super Wick) faction build: progress

Owner of this file: the brightwick builder. Module `art/blender/units/wick_brightwick.py`, protos
`art/blender/proto/wick_brightwick_*.py`, outputs `art/out/units/brightwick_{aubade,serenade}.glb`,
renders `art/renders/units/*brightwick*`.

## Milestones
- 2026-10-20 10:11 start: read brief §3.4, concepts, wick_common, HANDOFF Art 2.0, marund/ervet/burdam patterns.
- 2026-10-20 10:20 concepts measured on a 10 cm grid (Aubade 709 px/m, Serenade 744 px/m). Default plate cut loses
  Aubade's chalk pieces (pale on pale): a low-threshold background-difference mask recovers pauldrons, crown,
  staff and lantern. Plan: A-pose rest rig + a PAINT POSE (armature posed to the concept's staff hold, plus a
  small yaw for Aubade's slightly turned front view) for the projection only; staff on prop.R re-headed along
  the staff (ervet precedent); bespoke idle/run/attack1/death.
- 2026-10-20 10:30 plates: `proto/wick_brightwick_plates.py` -> `art/.cache/concept/wicks/brightwick_<f>_bw_*` (new mask,
  painted glow erased where accent geometry sits, Aubade hem darkened, Serenade warm saturation soft-clipped to 37 %).
  Review: `_brightwick_<f>_plates.jpg`.
- 2026-10-20 10:40 first sculpt of both factions in `wick_brightwick.py` + fit proto `proto/wick_brightwick_fit.py`
  (game mesh, skinned, posed in the paint pose, over the plates). Aubade IoU front 0.83 / back 0.83 on the first try.
  Fixes: Aubade staff head bends 30 deg up above the left fist (the concept's lantern stands upright on a diagonal
  staff), front yaw 9 -> 12 deg, crown ring +1 cm.
- 2026-10-20 11:04 first full builds (both factions): load test OK, facing +Z, attack1 lever-slam / death kneel-and-topple
  read in the clip sheet. Over budget (6.9k / 7.4k tris, 574 / 608 KiB); accent Aubade 6.0 %, Serenade 2.5 % (too low);
  the hood light read as a flat disc in the opening; Serenade greyer than the palette.
- 2026-10-20 11:06 per-part tri budget table (TRIS, ~3.8k), hood light smaller + deeper, wider seam/stripes, bigger
  crown lamps; Serenade: crown windows 5 -> 6.2 cm, lantern ball 0.20 -> 0.22 m with a thinner cage, taller sash,
  accent boss windows on the pauldrons, warm soft-clip 0.37 -> 0.40; Aubade hood rounder (helmet-round, top 1.73);
  recall/idle_lobby short loops (a minion never plays them; ~60 KB saved).
- 2026-10-20 11:30 build 2: Aubade 4.5k tris / 491 KiB / accent 8.8 %; the pipeline's symmetric collapse stalled on
  thin slabs (tabard 526 tris for a 70 budget) and the decimated SDF strips went ragged (wedge-shaped seam/stripe);
  Serenade's thin mantle/cloak shells TORE at their budgets. Fixes: lows made in the module (symmetric collapse,
  plain collapse when it stalls), seam + back stripe as clean ribbon meshes laid on the real SDF surface, Serenade
  windows as flat 8-gon caps on a hole-free band, SOLID cloak/mantle bells (half the triangles of a shell) with
  the front opening as a recess down to a robe floor (robe part dropped), tabard/strips skinned by weight transfer
  from the cloak.
- 2026-10-20 11:41 build 3: 3.83k / 3.80k tris, 469 / 484 KiB, load test OK, clean meshes. Accent fell to 4.4 % /
  3.8 % with the honest ribbons; Aubade's recess walls read as a block (10 cm deep). Build 4: recess 4 cm, wider
  seam/stripes, bigger lamps/windows/boss windows, Serenade lit inner lip of the hood (the concept's glowing arch).
