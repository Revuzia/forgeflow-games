# credits_fx.md - lane fx (parity waves P2+P3), art and licences

Every file below is ORIGINAL procedural art made for Last Circle by the lane's own generators (numpy + PIL, fixed seeds,
deterministic), dedicated CC0. No third-party pixels, no downloads, no paid assets ($0). No audio, Mixamo or Meshy assets
were touched by this lane.

| file | what | made by | licence | cost |
|---|---|---|---|---|
| `assets/fx/fx_sheet.png` (512 x 512 RGBA) | the P1-E sheet with the fireball flipbook (cells 0-7) re-made: mottled, soft-edged, saturated young frames (the P1-E check item: they read as pale cream discs). Desktop only since the fix round. | `F:/lc_p23/fx/make_fx_sheet_v8.py` (P1-E's generator + the P23/fx frame rework) | CC0 (our own work) | $0 |
| `assets/fx/fx_sheet_p1e.png` (512 x 512 RGBA) | the P1-E sheet exactly as P1-E shipped it (`git show 9aa2b746:games/last-circle/assets/fx/fx_sheet.png`, byte-identical). Loaded on TOUCH devices only (integrator D9: phones keep the P1-E look). | P1-E's generator (`make_fx_sheet.py`) | CC0 (our own work) | $0 |
| `assets/fx/fx_smoke_body.png` (256 x 256 RGBA) | the smoke-grenade cloud's BODY sprite (fix round, C-SMOKE D1): a = the billowing outline (solid inside 0.90 of the disc, lumps to 1.0), rgb = the billows' sky-lit relief. Ray-marched offline from 3D Gaussian billows + 3D value noise. | `F:/lc_p23/fx/make_smoke_body.py` (suggest `_tools/p23_fx_smoke_body.py`) | CC0 (our own work) | $0 |

Procedural in code (no file): the smoke cloud's chord-opacity body and outline puffs (fx.js SMOKE_VS / SMOKE_FS), the decal /
scorch mask (makeDecalTexture: charred grey-brown + per-slot tint on desktop, the P1-E mask on touch).
