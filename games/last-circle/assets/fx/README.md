# assets/fx - particle textures (lane ART-B, contract C-ART-FX)

White RGB at every pixel, alpha = the soft mask, so mip-mapping never darkens an edge. Use as additive
(`SrcAlpha, One`) or normal-alpha sprites and tint through the material / vertex / instance colour.
Source: Kenney "Light Masks" 1.0 (CC0), see CREDITS.md. Regenerate with `_tools/art_b_fx.py`.

| file | px | peak alpha | use |
|---|---|---|---|
| spark.png | 128x128 | 1.00 | soft 4-point star with a bright core: hit sparks, glints, muzzle star |
| puff.png | 256x256 | 0.75 | mottled round cloud: dust puffs, smoke; keep it translucent |
| glow.png | 128x128 | 1.00 | soft round glow: muzzle halo, flashes, loot glow |
| tracer.png | 256x32 | 1.00 | streak, ORIENTATION: u runs ALONG the streak (u=0 tail at alpha 0, peak at u~0.86 = bullet head, soft cut-off to 0 at u=1), v ACROSS (centre bright). Stretch the quad's X along the travel direction, billboard around that axis |

Glare bar: emissive / additive parts ~3-8x the luminance of what they sit on, halo <= 2-3x the source width. Start LOW.
