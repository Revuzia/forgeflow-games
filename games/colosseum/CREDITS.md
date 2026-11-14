# Colosseum: Sands of Glory — Credits & Licences

## Architecture, crowd, sky, VFX
100% procedural, generated at runtime from the real dimensions of the Flavian
Amphitheatre (`runtime/data/arena_spec.js`). No third-party geometry.

## Animated animals — Sketchfab, CC-BY 4.0
**Attribution is required by licence**, and the licence is only satisfied by
attribution the player can actually reach. The two models that SHIP in the
build — Tiger and Panther — are therefore named, with their authors, directly
on the in-game Credits screen (`runtime/ui/menu.js`); pointing at this file was
not enough, because this file is not part of the deployed payload.

The remaining rows are evaluation history, kept so the audit trail survives:
Lion and Leopard were rejected (the "leopard" is an anthropomorphic beast-man,
and the lion ships 8 primitives with no attack or run clip), Cheetah has an
animated bounding box that collapses to zero, and the Elephant was never
staged. None of the four are in `assets/`.

| Model | Author | Source |
|---|---|---|
| Lion | Paleo Modelist ([victory_](https://sketchfab.com/victory_)) | [sketchfab.com/3d-models/lion-c1c05eb659b94906b29c4637515f8467](https://sketchfab.com/3d-models/lion-c1c05eb659b94906b29c4637515f8467) |
| Leopard Animated | [anpapa3](https://sketchfab.com/anpapa3) | [sketchfab.com/3d-models/leopard-animated-63697b76b3c944ffae5b6fbdd003fc68](https://sketchfab.com/3d-models/leopard-animated-63697b76b3c944ffae5b6fbdd003fc68) |
| Tiger | Blender Artist ([moizmuhammad373](https://sketchfab.com/moizmuhammad373)) | [sketchfab.com/3d-models/tiger-67bbedd727a047869ef7c7b608445484](https://sketchfab.com/3d-models/tiger-67bbedd727a047869ef7c7b608445484) |
| Cheetah | [planeta-elefante](https://sketchfab.com/planeta-elefante) | [sketchfab.com/3d-models/cheetah-8d3ba32a2ff34acc9b5c590bc06cb561](https://sketchfab.com/3d-models/cheetah-8d3ba32a2ff34acc9b5c590bc06cb561) |
| Panther - blue - animated | [nolanfa](https://sketchfab.com/nolanfa) | [sketchfab.com/3d-models/panther-blue-animated-59a67c581a11429581036740b44f6e02](https://sketchfab.com/3d-models/panther-blue-animated-59a67c581a11429581036740b44f6e02) |
| Elephant animated | [theogilat](https://sketchfab.com/theogilat) | [sketchfab.com/3d-models/elephant-animated-with-transition-animation-466a15d0875b4b60bca2661c155711d5](https://sketchfab.com/3d-models/elephant-animated-with-transition-animation-466a15d0875b4b60bca2661c155711d5) |

All of the above are licensed **CC Attribution 4.0**
(<http://creativecommons.org/licenses/by/4.0/>).
Full upstream manifest: `F:\AssetLibrary\luminascape_pending\animated_replacements\CREDITS.txt`.

## Characters
Meshy auto-rigged humanoids from the ForgeFlow shared character set
(generated in-house; see `reference_meshy_char_rig_calibration`).

## Surfaces / PBR materials
The `.webp` material sets under `assets/tex` are generated in-house by
`pipeline/art/gen_pbr_materials.py`: an xAI base image per material, with the
normal, roughness and AO maps derived locally with numpy/scipy. No third-party
texture is shipped, so nothing here carries an attribution obligation — this
entry exists so the absence is recorded rather than merely assumed.

## Audio
- **Music** — the owner's own Suno generations (`F:\Music`). Tracks are selected
  from albums verified unclaimed by any other ForgeFlow title, per the
  no-duplicate-music rule.
- **Cornu, buccina and crowd** — synthesised at runtime in WebAudio. No library
  on disk contains Roman brass or arena crowd material (verified by regex over
  6,481 audio filenames), so these are built, not sourced.
- **Impacts / UI** — Kenney CC0 one-shots (`impact-sounds`, `interface-sounds`,
  `rpg-audio`; 282 files).

## Engine
[three.js](https://threejs.org/) r172 — MIT.
