# Bastion Realms: Stronghold — Asset Credits

**Everything in this game was generated specifically for it. Nothing is loaded from
the F:\ libraries or reused from any previous ForgeFlow game.**

## 3D Models
- All towers, enemy constructs, bosses, Bastions, props and surroundings are original
  **procedural Three.js builds** defined in `runtime/view/models.js` and `runtime/view/world3d.js`.
  No model files exist in this game. © ForgeFlow Labs.

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
