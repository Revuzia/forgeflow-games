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

The internal identifier `globalThis.SNOWFLOW`, the directory name `games/snowflow` and the
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
- **An audio subsystem** — a synthesised wind bed, surf hiss, boot crunch, landing thump and
  a voice per spell (`src/audio/voices.js`), plus **recorded** footsteps and landings played
  from nine vendored `.ogg` files (`src/audio/samples.js`). See **Assets** below.
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
— nine CC0 sound effects from Kenney — is covered under **Assets** below.

## Assets

**Ten audio files, and nothing else.** This section previously read "There are none", and
said that both the sound effects and the music were synthesised at runtime. That stopped
being true on 2026-08-03, when the no-asset-files constraint was lifted on purpose: a
microphone simply *has* a boot breaking snow crust, and a filtered-noise burst only
approximates one. Everything you can **see** is still generated on the GPU at load.

### Nothing visual is an asset file

As in the original:

- the sky is an atmosphere integral, not a captured HDRI
- the terrain and the snow grain are noise, evaluated with analytic derivatives
- the character is lofted at load from a table of bone offsets — no rig file, no animation
  clips, no authored mesh
- the fabric weave and the fur strands are evaluated in the fragment shader

No image files, no glTF, no fonts beyond the system stack.

### Audio files that do ship

Ten files under `assets/audio/`, **519,089 bytes (507 KiB)** in total.

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

`src/audio/samples.js` plays these, and only these. Every other sound in the game — the wind
bed, the surf hiss, the crunch and thump used when a sample has not loaded, and the voice per
spell — is still synthesised through Web Audio with no file behind it (`src/audio/voices.js`,
`src/audio/graph.js`).

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
