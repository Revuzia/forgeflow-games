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
- **A synthesised audio subsystem** — wind bed, boot crunch, landing thump, surf hiss and a
  voice per spell (`src/audio/`). No audio files.
- **A synthesised music bed** — `runtime/music.js`, a standing Web Audio graph. No audio files.
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

Nothing else. There is no build step and no bundler.

## Assets

**There are none.** As in the original, every texture, environment map and piece of geometry
in the running game is generated at load time on the GPU:

- the sky is an atmosphere integral, not a captured HDRI
- the terrain and the snow grain are noise, evaluated with analytic derivatives
- the character is lofted at load from a table of bone offsets — no rig file, no animation
  clips, no authored mesh
- the fabric weave and the fur strands are evaluated in the fragment shader
- both the sound effects and the menu music are synthesised through Web Audio at runtime

No image files, no glTF, no audio files, no fonts beyond the system stack.
