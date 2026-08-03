# SNOWFLOW (Three.js port) — credits and licences

## Upstream work

This is a **port**, not an original design. It reimplements the rendering techniques and art
direction of:

> **SNOWFLOW** — a real-time snow rendering tech demo
> https://github.com/Noniv/snowflow_demo · https://snowflow-lilac.vercel.app/
> Copyright (c) 2026 **Maksymilian Dendura**. Released under the **MIT Licence**.

The original targets **WebGPU** with **Babylon.js** and hand-written **WGSL**. This port
targets **WebGL2** with **Three.js** and hand-written **GLSL ES 3.00**. The techniques, the
constants, the art direction and the structure of the demo are the upstream authors' work;
the WebGL2 reimplementation is this repository's.

The MIT licence permits this derivative work and requires the copyright notice and permission
notice be preserved. The upstream `LICENSE` text is reproduced in `LICENSE.upstream`.

## Third-party runtime dependencies

| | |
|---|---|
| **three.js** r172 — https://threejs.org | MIT · vendored at `assets/vendor/three/` |

Nothing else. There is no build step and no bundler.

## Assets

**There are none.** As in the original, every texture, environment map and piece of geometry
in the running demo is generated at load time on the GPU:

- the sky is an atmosphere integral, not a captured HDRI
- the terrain and the snow grain are noise, evaluated with analytic derivatives
- the character is lofted at load from a table of bone offsets — no rig file, no animation
  clips, no authored mesh
- the fabric weave and the fur strands are evaluated in the fragment shader

No image files, no glTF, no audio files, no fonts beyond the system stack.
