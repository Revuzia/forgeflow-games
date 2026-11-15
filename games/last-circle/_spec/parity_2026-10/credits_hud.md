# Last Circle parity P2+P3 - lane hud asset credits

Every asset lane hud added or changed. No paid or third-party asset was used.

| File | Source | Licence |
|---|---|---|
| `assets/hud/wpn_frag.png` | Original: rasterised from hud.js's own `IC.frag` SVG icon (flat white, 160x60) by `F:/lc_p23/hud/fix/make_throw_icons.py` | Original art of this project (no third-party licence) |
| `assets/hud/wpn_smoke.png` | Original: rasterised from hud.js's own `IC.smoke` SVG icon (flat white, 160x60), same tool | Original art of this project (no third-party licence) |
| `assets/hud/wpn_dmr.png`, `wpn_lmg.png`, `wpn_burst.png` | Shipped by lane sim (commit 5e4b949c), rendered by `_tools/art_b_wpn.py` from the CC0 models in `assets/props/wpn_cc0/` | CC0 (see the sim lane's credits for the model URLs) |

All other HUD art (vitals icons, map marks, runtime silhouettes) is drawn in code (SVG / canvas) in `runtime/3d/royale/hud.js`.
