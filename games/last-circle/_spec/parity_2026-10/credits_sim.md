# credits_sim - lane sim (parity P2+P3), for the integrator to merge into CREDITS.md

Lane sim's new third-party assets (the plan asks each lane for credits_<lane>.md beside PLAN.md). No other new asset was added in
the FIX ROUND (the LC-22 live-bone hit volumes, the fall curve and the loot weights are code only).

New model files (all CC0 1.0, $0, downloaded 2026-10-20 through the Poly Pizza API; not used by any other FFG game - grep of
forgeflow-games for the ids and "Pichuliru" found nothing). Each was baked by `F:/lc_p23/sim/tools/bake_gun.py` into a static,
game-oriented GLB (skin stripped at its rest pose, +Z barrel, metres, origin at the pistol grip, flat PBR factors kept, no textures).

| File | Source model | Author | Source URL | Licence |
|---|---|---|---|---|
| `assets/props/wpn_cc0/wpn_dmr.glb` (DMR) | "Sniper Rifle West" | Pichuliru | https://poly.pizza/m/kwJawENuvA (file https://static.poly.pizza/8911738d-1bc6-405d-9345-8c1f7d55bfd6.glb) | CC0 1.0 https://creativecommons.org/publicdomain/zero/1.0/ |
| `assets/props/wpn_cc0/wpn_burst.glb` (burst AR) | "Rifle Assault East" | Pichuliru | https://poly.pizza/m/xrJfQgAuDL (file https://static.poly.pizza/50533c95-ee1a-4906-84e8-06075367a503.glb) | CC0 1.0 |
| `assets/props/wpn_cc0/wpn_lmg.glb` (LMG, body) | "Rifle Battle East" | Pichuliru | https://poly.pizza/m/tJaWNYo064 (file https://static.poly.pizza/d069e816-a253-4237-9c02-12b3ab54167f.glb) | CC0 1.0 |
| `assets/props/wpn_cc0/wpn_lmg.glb` (LMG, folded bipod) | "Bipod" | Quaternius | https://poly.pizza/m/Ugy8tjR3Ju (file https://static.poly.pizza/ec8b842c-4dc4-4a81-9fb1-b18cd99c601e.glb) | CC0 1.0 |

HUD silhouettes (derived from the CC0 models above, same CC0 1.0 status; rendered 2026-10-21 by the game's own
`_tools/art_b_wpn.py` pipeline - a scratch copy `F:/lc_p23/sim/tools/art_b_wpn_p23.py` with IDS = dmr lmg burst, its own
--check validation passed: fill 1.00/1.02/1.00, white, edge-clear):
`assets/hud/wpn_dmr.png`, `assets/hud/wpn_lmg.png`, `assets/hud/wpn_burst.png` (160x60 RGBA). They exist so the
hud.js silhouette probe finds the full set (no 404s) with the 9-gun roster; lane hud may restyle/regenerate them.
