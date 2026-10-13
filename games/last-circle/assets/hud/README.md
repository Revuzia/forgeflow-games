# assets/hud - weapon silhouettes (lane ART-B, contract C-ART-FX)

`wpn_<id>.png` for id in `pistol smg ar shotgun sniper glauncher`: 160x60 RGBA, flat WHITE silhouette on transparent,
side view, **muzzle to the RIGHT**, fitted to the box with a 4 px margin (aspect kept; every gun fills its own box, so
relative gun size is not preserved). Tint with CSS (`filter`, `mask-image`, or an `<img>` on a coloured chip).

Rendered from the game's own weapon models by `_tools/art_b_wpn.py` (original art, no third-party licence). Regenerate it
after any weapon-model change. Two HUD-only corrections are applied there: the SMG is mirrored (the in-game proto has its
muzzle at -Z) and the sniper's floating butt-stock is bridged.
