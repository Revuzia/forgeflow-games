# assets/sfx — combat/spell SFX one-shots

Ten files, 82,565 bytes total. All are from **Kenney "Impact Sounds" (1.0)** —
created and distributed by Kenney (https://kenney.nl), released under
**Creative Commons Zero (CC0)**, http://creativecommons.org/publicdomain/zero/1.0/.
The pack's License.txt states the assets may be used in personal and commercial
projects and that crediting Kenney is not mandatory. Credited anyway.

Copied unmodified from the local asset mirror
`F:/games/forgeflow-games-assets/impact-sounds/Audio/`. Chosen to NOT collide
with the recordings already vendored under `assets/audio/` (per CREDITS.md
those are `impactSoft_medium_000/002` and `impactSoft_heavy_000/003`).

| shipped as | Kenney source | used for |
| --- | --- | --- |
| `hit_bolt_0.ogg`, `hit_bolt_1.ogg` | `impactPunch_medium_000/001.ogg` | bolt impact |
| `hit_wave_0.ogg`, `hit_wave_1.ogg` | `impactSoft_heavy_001/004.ogg` | frost-wave hit on a body |
| `hurt_0.ogg` | `impactPunch_heavy_000.ogg` | player hurt thud |
| `detonate_0.ogg` | `impactPunch_heavy_001.ogg` | Sand Explosion spike detonation |
| `death_0.ogg`, `death_1.ogg` | `impactGlass_heavy_000/001.ogg` | enemy death shatter |
| `arc_0.ogg`, `arc_1.ogg` | `impactGlass_light_000/001.ogg` | frost-arc cast crackle |

Everything else the SFX layer plays (bolt throw, enemy windup cue, the vortex
loop, and every fallback while these decode) is synthesized in
`src/audio/sfx.js` with WebAudio — no license applies.
