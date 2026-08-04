# DRIFTWAKE — credits and licences

## DRIFTWAKE is a derivative work. Read this first.

**DRIFTWAKE was called SNOWFLOW, and SNOWFLOW is not this repository's name to take.**
It is the name of the original tech demo this project is a port of. The rename exists so
that a ForgeFlow Games title is not shipped under someone else's project name — it does
**not** mean the work stopped being a derivative, and it makes stating the derivation more
important, not less.

> **SNOWFLOW** — a real-time snow rendering tech demo
> https://github.com/Noniv/snowflow_demo · https://snowflow-lilac.vercel.app/
> Copyright (c) 2026 **Maksymilian Dendura**. Released under the **MIT Licence**.

The rendering techniques, the physical constants, the art direction, the tuning and the
structure of the demo are Maksymilian Dendura's work. The MIT licence permits this
derivative and requires that the copyright notice and permission notice be preserved; the
upstream `LICENSE` text is reproduced verbatim in `LICENSE.upstream`.

The internal identifier `globalThis.SNOWFLOW`, the directory name `games/driftwake` and the
`_spec/` documents still carry the upstream name. That is deliberate: they are the contract
a shared comparison harness uses to drive **both** this build and the upstream reference
from one shot battery, and renaming them would break the ability to check this port against
the original.

## What is upstream's, and what is this repository's

| | |
|---|---|
| **Upstream (Maksymilian Dendura, MIT)** | The demo itself: terrain and snow shading model, deformation field, the breaking-wave surf wake, the five spells, the atmosphere integral, the character loft and gait, the art direction, and essentially every constant either build is tuned to. |
| **This repository** | The **WebGL2 / Three.js / GLSL ES 3.00 reimplementation** of all of the above (upstream targets **WebGPU** with **Babylon.js** and hand-written **WGSL**), plus the additions listed below. |

Additions made here, none of which exist upstream:

- **Jump** — `SPACE`, with an early-release rise cut, a landing crater brush and a landing
  spray burst.
- **An audio subsystem** — a wind bed, surf hiss, boot crunch, landing thump and a voice per
  spell (`src/audio/voices.js`), each with a fully synthesised fallback, fed at runtime by
  **twenty vendored recordings** (`src/audio/samples.js`): Kenney footsteps and impacts, and
  Sonniss GDC 2024 cuts for the spell one-shots (glass/ice fractures for Crystallise, water
  surge, eruption, rising whorl, jump whoosh) and the three loop beds the voices adopt into
  their filter chains (wind, board-on-snow slide, stream). See **Assets** below.
- **A music bed** — a recorded 60 s loop, `assets/audio/music/hollow-wave.mp3`, wired through
  the FFG shell. `runtime/music.js`, a standing Web Audio graph that synthesises a bed live,
  remains in the tree as the fallback if that file fails to load or decode.
- **The FFG game shell** — title menu, How-to-Play, Settings, Esc pause (`runtime/ffg_shell.js`,
  `game_controls.js`), shared with the other ForgeFlow Games titles.
- **A fourth quality preset, `performance`** — measured on the verification machine; upstream
  has three rungs and this one is new data rather than a re-tune of them.
- **A split settings/debug overlay** on F1 / F3.
- **A port-side fix to a defect shared with the reference**: freezing time divided a velocity
  delta by a zero-length step, and the resulting NaN propagated through the camera and stopped
  the frame rasterising. The same division and the same failure are present upstream
  (`src/character/controller.js`); this build guards it, which is what makes the pause menu
  hold a pixel-stable frame.
- **The comparison harness** (`_harness/`) and the specification documents in `_spec/`.

## Third-party runtime dependencies

| | |
|---|---|
| **three.js** r172 — https://threejs.org | MIT · vendored at `assets/vendor/three/` |

No other third-party **code**. There is no build step and no bundler. Third-party **content**
— nine CC0 sound effects from Kenney and eleven recordings cut from the Sonniss
#GameAudioGDC 2024 bundle — is covered under **Assets** below.

## Assets

**Twenty-one audio files, and nothing else.** This section previously read "There are none",
and said that both the sound effects and the music were synthesised at runtime. That stopped
being true on 2026-08-03, when the no-asset-files constraint was lifted on purpose: a
microphone simply *has* a boot breaking snow crust, and a filtered-noise burst only
approximates one. On 2026-08-04 the same judgement was extended to the rest of the mix —
the spells, the jump, and the three beds (wind, surf, ribbon stream) — with recordings cut
from the Sonniss GDC 2024 bundle. Everything you can **see** is still generated on the GPU
at load.

### Almost nothing visual is an asset file

As in the original:

- the sky is an atmosphere integral, not a captured HDRI
- the terrain and the snow grain are noise, evaluated with analytic derivatives
- the procedural figure is lofted at load from a table of bone offsets — no rig file, no
  animation clips, no authored mesh — and it still simulates every frame (footprints and
  step audio key off it)
- the fabric weave and the fur strands are evaluated in the fragment shader

**The one visual asset (added 2026-08-04):** `assets/char/driftwake_char_web.glb`
(834 KiB) — the rigged hero character that renders in the figure's place by default
(`S.meshCharacter` toggles back). Meshy-generated model and textures (owner's account),
41-bone Mixamo rig and clips, Draco-compressed with WebP maps. Its `GLTFLoader` /
`DRACOLoader` and the Draco decoder are vendored from the same Three r172 release under
`assets/vendor/three/`. It ships with a custom skinned `RawShaderMaterial` — the scene
has no Three lights, so it is relit by the port's own sun/sky/shadow/spell-light stack.

No other image files, no fonts beyond the system stack.

### Audio files that do ship

Twenty-one files under `assets/audio/`, **948,666 bytes (926 KiB)** in total: nine Kenney
sound effects (38,382 B), eleven Sonniss GDC 2024 cuts (429,577 B), one music track
(480,707 B).

#### Sound effects — Kenney, CC0

Nine files, **38,382 bytes**, from **Kenney "Impact Sounds" (1.0)** — created and distributed
by Kenney, <https://kenney.nl>, released under
[**CC0 1.0 Universal**](http://creativecommons.org/publicdomain/zero/1.0/) (public domain
dedication). The pack's own `License.txt` states it is "free to use in personal, educational
and commercial projects" and that crediting Kenney "is not mandatory". Credited anyway.

| shipped as | cut from |
|---|---|
| `footstep_snow_0.ogg` … `footstep_snow_4.ogg` | `footstep_snow_000.ogg` … `footstep_snow_004.ogg` |
| `impact_medium_0.ogg`, `impact_medium_1.ogg` | `impactSoft_medium_000.ogg`, `impactSoft_medium_002.ogg` |
| `impact_heavy_0.ogg`, `impact_heavy_1.ogg` | `impactSoft_heavy_000.ogg`, `impactSoft_heavy_003.ogg` |

That mapping is not a recollection — no conversion script was kept, so each shipped file was
matched back to its source by normalised cross-correlation (r = 0.989 to 0.9997 against the
named source, and clearly ahead of the runner-up in every case).

They are **not** shipped as supplied. Each was downmixed to mono, downsampled and trimmed to
the useful transient: the footsteps from 44.1 kHz stereo to 22.05 kHz mono, the impacts to
16 kHz mono. A footstep goes from 7,880 bytes to 4,477 — 43 % off, at a bandwidth nobody can
miss on a 0.2 s snow crunch.

#### Sound effects — Sonniss #GameAudioGDC 2024 bundle

Eleven files, **429,577 bytes**, cut from the **Sonniss #GameAudioGDC bundle (GDC 2024)** —
<https://sonniss.com/gameaudiogdc>. Licence (captured verbatim in the bundle's
`LICENSE.txt` from <https://sonniss.com/gdc-bundle-license/>): worldwide, non-exclusive,
**royalty-free**, unlimited commercial projects, **modification allowed, no attribution
required** — credited anyway, per source below. Redistributing the sounds *as sounds* is
prohibited; shipping them embedded in a game is explicitly permitted, which is what these
are. The licence also expressly prohibits AI training on the recordings; none was done and
none is licensed onward.

| shipped as | plays as | cut from (pack / recording) |
|---|---|---|
| `spell_crystal_crack_0.ogg` | Crystallise, first fracture | Sonic Bat — Videogame Foley Essentials Vol. II / `SBvfe2_Glass 114` |
| `spell_crystal_crack_1.ogg` | Crystallise, main break | Mechanical Wave — Glass / `GLASBrk_Glass Break Hit_04` |
| `spell_crystal_crack_2.ogg` | Crystallise, debris scatter | BluezoneCorp — Alien Tripod / `BC0292_alien_tripod_debris_glass_falling_003` |
| `spell_crystal_shimmer.ogg` | Crystallise, crackle under the growth | Mechanical Wave — Sound Effects Collection / `ICEMisc_Ice Sizzle_05` |
| `spell_sweep_surge.ogg` | Sweep | Rescopic Sound — Distinct Whooshes / `WHSH_Watery-Whoosh FIzzy Fast 03` |
| `spell_bloom_splash.ogg` | Bloom | BluezoneCorp — Designed Water / `BC0298_designed_water_impact_006` |
| `spell_vortex_whoosh.ogg` | Vortex | Rescopic Sound — Distinct Whooshes / `WHSH_Airy-Whoosh Wind Gust 11` |
| `jump_whoosh.ogg` | Ollie / jump | Rescopic Sound — Distinct Whooshes / `WHSH_Pure SciFi-Whoosh Fast 03` |
| `wind_loop.ogg` | wind bed (all three layers) | Systematic Sound — Rural Countryside 01 / `AMBRurl_Meadow Open Plane Windy Deep Rumble` |
| `surf_slide_loop.ogg` | surf hiss layer | Wavemotion — Ski Ride / `SPRTWntr-EXT_Skiing On Soft Snow 01` |
| `spell_ribbon_stream.ogg` | Ribbon (held cast) | Pole Position — Winter Forest Stream / `Stream - STRONG - Medium Speed - Flow - Gush` |

As with the Kenney set, nothing ships as supplied: every cut is mono, trimmed to the useful
segment, downsampled to what its content carries (22.05 kHz for the wind, 32 kHz for the
low-heavy whooshes and water, 44.1 kHz for the HF-critical glass and slide), peak-normalised
to −3.5 dBFS before Vorbis encoding (the encoder overshoots), and — for the three loops —
given a baked equal-power tail-over-head crossfade, with the wrap verified click-free on the
**decoded** ogg (wrap step ≤ the material's own 99th-percentile sample step).

`src/audio/samples.js` decodes these and plays the one-shots; the loop beds hand their
decoded buffer to `src/audio/voices.js`, which swaps it under its existing filter chains.
Every voice keeps its synthesised construction as the live fallback for a failed fetch or
decode (`src/audio/voices.js`, `src/audio/graph.js`), so the game is never silent while it
loads and never depends on an asset arriving.

#### Music — the owner's own work

`assets/audio/music/hollow-wave.mp3` — **480,707 bytes**, 60.000 s, 44.1 kHz stereo, 64 kbps.

Not a third-party asset and not under a third-party licence: it is **"Hollow Wave"**, from the
*Atrium Frost / Zenith Echo* release in the catalogue of this repository's owner (Forge Flow
Labs), generated by them with **Suno**. Rights in it follow the owner's own Suno subscription
terms; no external attribution is owed and none is claimed here on anyone else's behalf.

The shipped file is a 60 s loop cut from the 228.36 s original and re-encoded from
190 kbps / 48 kHz to 64 kbps — 5,448,726 bytes down to 480,707, a **91 % reduction**. Verified
as a cut of that track by cross-correlation (r = 0.998 for a 6 s slice against the original).

On the loop: it is a hard cut at both ends, not a fade — head and tail both sit at full
programme level (−10.6 and −10.3 dBFS over 100 ms). It does not click, because the step across
the wrap (0.051) is no larger than the material's own 99th-percentile sample-to-sample step
(0.053). It is not a *musically* matched loop, though: the two-second head and tail correlate
at −0.04, so the phrase restarts rather than continues. On an ambient bed at the level this
plays, that is a seam you have to be listening for. The decoded file peaks at **+0.45 dBFS** —
marginally over full scale, as re-encoded mp3s often are; harmless here, since Web Audio is
floating-point and the default MUSIC setting of 30 % puts it near −20 dBFS anyway.
