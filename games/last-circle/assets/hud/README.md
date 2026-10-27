# assets/hud - weapon silhouettes (lane ART-B, contract C-ART-FX)

`wpn_<id>.png` for id in `pistol smg ar shotgun sniper glauncher`: 160x60 RGBA, flat WHITE silhouette on transparent,
side view, **muzzle to the RIGHT**, fitted to the box with a 4 px margin (aspect kept; every gun fills its own box, so
relative gun size is not preserved). Tint with CSS (`filter`, `mask-image`, or an `<img>` on a coloured chip).

Rendered from the game's own weapon models by `_tools/art_b_wpn.py` (original art, no third-party licence). Regenerate it
after any weapon-model change. Two HUD-only corrections are applied there: the SMG is mirrored (the in-game proto has its
muzzle at -Z) and the sniper's floating butt-stock is bridged.

`wpn_dmr.png`, `wpn_lmg.png`, `wpn_burst.png` (LC-16 roster, lane sim): the same tool, from the CC0 models in
`assets/props/wpn_cc0/` (credits with those models).

`wpn_frag.png`, `wpn_smoke.png` (D8, lane hud fix round): flat white 160x60 silhouettes of the HUD's own frag / smoke icons
(hud.js `IC.frag` / `IC.smoke`, original art, no third-party licence), fitted with a 4 px margin; the kill feed and the death
card show the frag's. Generator: `F:/lc_p23/hud/fix/make_throw_icons.py` (rasterises the two SVGs from hud.js).
