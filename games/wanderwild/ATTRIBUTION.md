# Attribution — Wobblesworth's Neighborhood

This game is a single self-contained HTML file. **Three.js** (r160) is loaded at runtime from a CDN
(unpkg, via importmap). The 3D models and sound effects below are **bundled under `./assets`**. All are
used under permissive licenses (CC0 or CC-BY); CC-BY sources are credited here as required.

## 3D models (`./assets/models/*.glb`)
Low-poly cube/world assets — characters, houses, mill, barn, well, bridge, boat, trees, plants,
flowers, mushrooms, crystals, crops, props, clouds, coins:

- **Kenney** — Blocky Characters & various low-poly kits — **CC0** — https://kenney.nl
- **Kenney** — Graveyard Kit — **CC0** — https://kenney.nl (the spooky outskirts night mobs: `mob-skeleton`, `mob-ghost`, `mob-zombie`, `mob-pumpkin`)
- **Quaternius** — Ultimate/Stylized nature & prop packs — **CC0** — https://quaternius.com
- **KUBIKOS / cube village assets** — **CC0** — (cube cottages, mill, well, props)

All model packs above are CC0 (public domain dedication) unless a bundled per-pack `license.txt`
states CC-BY, in which case the author credit above satisfies attribution.

## Sound effects (`./assets/audio/*.ogg`)
`interact · jump · pickup · step · success · win` — short UI/foley one-shots.

- Source: **Kenney** audio packs (Interface / RPG / Impact) — **CC0** — https://kenney.nl

## Music
**No external music files.** The soundtrack is generated procedurally at runtime with the Web Audio
API (a triangle-wave I–V–vi–IV pad plus pentatonic twinkles through a low-pass filter), so it is
original to this game and ships no audio file.

## Textures
**No external texture files.** All surface textures (grass, dirt, wood planks, plaster, roof
shingles, bark, stone, sand) are generated procedurally to a `<canvas>` at runtime.

## Engine / libraries
- **Three.js** r160 — **MIT** — https://threejs.org (loaded from CDN; not bundled)

---
If you redistribute this build, keep this file alongside `index.html`. To fully self-host (no CDN),
vendor `three.module.js`, `GLTFLoader.js`, `SkeletonUtils.js`, and `RoomEnvironment.js` into
`./assets/vendor/` and point the importmap at those relative paths.
