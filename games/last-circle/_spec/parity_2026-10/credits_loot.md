# Last Circle parity P2+P3 - lane loot - asset credits

Owner rule: new assets are CC0 / free only ($0). Every file the loot lane added is listed here with its source URL and licence.

| file (game root) | source | licence | notes |
|---|---|---|---|
| assets/props/supply_crate.glb | Quaternius, "Fantasy Props MegaKit" (Standard / free version), model `Crate_Metal` - https://quaternius.com/packs/fantasypropsmegakit.html . Local copy of the pack (already on this machine, no new download): `F:/games/forgeflow-games-assets/3d-models/fantasy-props-mega/` (Exports/glTF/Crate_Metal.gltf + .bin, Textures/T_Trim_Furniture_*.png and T_Trim_Metal_*.png); the pack's License_Standard.txt reads "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication". | CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) | Re-baked in Blender 5.1 (headless): the six 2048 px trim maps (base colour, normal, ORM for the furniture and metal trims) scaled to 512 px and stored as JPEG q88 inside one GLB, vertex colours dropped (the Unreal mask channel; three.js would multiply it into the albedo); geometry unchanged (2738 tris, 2 materials). 295,492 bytes, sha256 61272a7862669d37e32371e4ec5af7a2c145b3d8e069724485a22b616efb2b72. Source Crate_Metal.gltf sha256 55fd4a7f499cededac939eade7a842353ed4764a49cd8e586d8bf733668d4456. Cost $0. Used by loot.js as the supply-drop crate (LC-28; replaces the crate merged from BoxGeometry primitives); its steel-frame material is tinted red at runtime. |

Credit line for CREDITS.md: "Supply crate: Crate_Metal from the Fantasy Props MegaKit by Quaternius (quaternius.com), CC0."
