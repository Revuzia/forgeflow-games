# CHROMA HIDE — Asset Credits

CHROMA HIDE ships **69 GLB models (2.18 MB)** and **no audio, image or font files at all**.
Everything you hear and every surface you see is generated at runtime.

## Audio — none shipped

There are no sound files in this game. The entire soundtrack is synthesised in
`runtime/audio.js` with the Web Audio API: oscillator and filtered-noise voices for
footsteps, gunshots, the taunt whistle, the paint kit, cling, jump, UI, phase stings,
the proximity heartbeat, and the per-map room tone. Positional cues route through
`PannerNode`s driven by a listener that follows the camera.

© ForgeFlow Labs. Zero download cost, nothing to attribute.

## Textures — none shipped

Every wall, floor and prop surface is drawn procedurally to a canvas at load time by
`runtime/textures.js` — brick, wood, checker, damask, ceiling, concrete, carpet, plaster,
tile, breeze block, wallpaper and timber panelling, each with a `grime()` wear layer for
stains, drips, hairline cracks and floor scuffs.

The player body is a procedural mesh built in `runtime/body.js`, painted by the player
onto a runtime `CanvasTexture`.

© ForgeFlow Labs.

## 3D Models — 69 GLB, all CC0

Sourced from the local asset library at `pipeline/assets/_downloaded/cc0-city/`, whose
`SOURCES.json` records `"license": "CC0"` for every entry.

- **Kenney** — CC0 1.0 Universal (public domain). Licence texts ship with the packs at
  `pipeline/assets/_downloaded/cc0-city/LICENSE-kenney-*.txt`.
  - *Furniture Kit 2.0* — the office, lounge, break-room and retail furniture
    (bookcases, cabinets, tables, chairs, sofas, lamps, kitchen units, laptop, keyboard,
    plants, radio, benches, bar stools).
  - *City Kit (Commercial)* — parasols and shopfront dressing (`assets/models/commercial/`).
  - *City Kit (Roads)* — street lighting, construction barriers, cones, bridge pillars
    (`assets/models/roads/`).
  - *City Kit (Suburban)* — trees, planters, suburban fencing (`assets/models/suburb/`).
  - *Car Kit* — sedan, van, truck, delivery lorry, SUV, taxi (`assets/models/car/`).
- **Quaternius** — CC0. The eight `*-quaternius.glb` props: AC unit, large barrier,
  traffic barrier, crate, dumpster, hydrant, market stalls, shipping container.

CC0 imposes no attribution requirement; this list is recorded because knowing an asset's
provenance matters more than the licence minimum.

## Not used

No Poly Pizza model is shipped. Parts of that library are CC-BY 3.0 rather than CC0 and
would require a per-model attribution string; if any is added later, generate its row
from the `attr` field in that library's `_manifest.json` **before** publishing.

---

*`selftest.mjs` asserts both directions: every model a map references exists on disk, and
every shipped model is referenced by a room palette (69/69 each way). 97 models that no
palette named — 1.66 MB, 43% of the old payload — were deleted rather than shipped as
dead weight. Of the 69, 60 are placed by the current map seed; the remaining 9 are palette
variants the scatter may pick on other seeds, and models are fetched per placed prop, so
an unplaced entry costs no download.*
