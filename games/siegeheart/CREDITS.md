# Siegeheart — Asset Credits

**No asset in this game is reused from any previous ForgeFlow game.** Textures and audio
are generated specifically for it; enemy creatures use library models that were verified
unused by every prior title.

## 3D Models
- All towers, Bastions, the Prime Prism boss, props and surroundings are original
  **procedural Three.js builds** defined in `runtime/view/models.js` and `runtime/view/world3d.js`.
  © ForgeFlow Labs.
- **31 enemy creatures** (`assets/models/enemies/`) are animated GLB/GLTF models from the
  local asset library, each verified unused by any other ForgeFlow game (`tools/copy_enemies.py`
  holds the exact pick list):
  - **Quaternius packs** (Ultimate Monsters, Cute Monsters, Animated Mech) — CC0.
  - **Poly Pizza models** (Bull, Horse, Giant, Rat, Zombie, Skeleton, Shark, Bee Enemy,
    Enemy Small/Large, Robot Enemy ×4) — CC0 1.0.
  - **"Animated Wizard" by Quaternius — CC-BY 3.0** — via Poly Pizza
    (https://poly.pizza/m/kttbFvCl2C). Used as the Sky Herald.

## Textures
- Five seamless ground tiles + key art generated via **xAI `grok-imagine-image`**
  (original commissioned generations, post-processed to seamless tiles in `tools/gen_textures.py`).
- All other textures (road overlays, UI icons, particle sprites, hp bars) are runtime canvas drawings.

## Audio
- **Music**: an original procedural WebAudio sequencer (`runtime/core/audio.js`) composes a distinct
  theme per world (menu, colosseum, gothic, sky, crystal, dwarven, victory, defeat) — key, tempo,
  progression and instrumentation per track. © ForgeFlow Labs.
  (`tools/gen_music.py` exists for Stable Audio generation if a STABILITY_API_KEY is ever added —
  no key was present at build time, so the runtime engine is the shipped soundtrack.)
- **SFX**: 100% synthesized in WebAudio at runtime — no sound files.

## Fonts
- System serif stack (Georgia) — no webfont downloads.
