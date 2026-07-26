# Colosseum: Sands of Glory — Changelog

## 2026-07-25 — foundation: the building stands

**The Colosseum** (`runtime/view/colosseum.js`, `runtime/data/arena_spec.js`)
- Historically-scaled Flavian Amphitheatre generated procedurally: 87 x 55 m
  elliptical harena, 4-tier cavea of 54 stepped rows, 3 arcaded storeys of 80
  bays (Tuscan -> Ionic -> Corinthian), solid attic with pilasters and bronze
  clipei, velarium masts and sail, vaulted substructure, ground plane.
  Measured outer ellipse 191 x 159 m against the real 189 x 156.
- Draw-call discipline: the whole cavea is ONE merged BufferGeometry; the 240
  arches, 240 columns, 160 statues, 40 masts, pilasters and shields are each a
  single InstancedMesh. Building total: 17 draw calls.

**Crowd** (`runtime/view/crowd.js`)
- 17,974 seated spectators in 2 draw calls (near/far LOD split). All animation
  is vertex-shader driven from uniforms — idle bob, excitement bounce, a
  travelling Mexican wave and lean-toward-the-action — so a crowd reaction
  costs zero per-instance CPU.

**Sky / lighting** (`runtime/view/sky.js`)
- Procedural sky dome with sun disc and haze, 4 times of day, tight 62 m sun
  shadow frustum over the sand, and a PMREM environment bake (without which
  every metal in the scene renders black).

**Harness** (`tools/`)
- `probe_arena.mjs` — headless build + draw-call/triangle/dimension assertions.
- `ingest_assets.mjs` — GLB inventory and a hard gate: nothing ships with more
  than 1 primitive, because a glTF primitive is a draw call.
- `shotserver.py` — static server + screenshot sink, so WebGL frames can be
  rendered offscreen, read back and inspected even when the pane is not
  compositing.

### Fixed
- Arcade modules subtracted two piers from a one-pier module, leaving 1.8 m
  slots instead of 4.2 m arches; module width is now derived from the true
  ellipse perimeter so the 80 bays tile edge to edge.
- Renderer booted at 0x0 in a container that had not laid out, silently
  rendering nothing forever. Now falls back to the window and re-applies on a
  ResizeObserver.
- Arcades were see-through end to end; added the vaulted substructure ring.
- `crowd.stats()` exposes `instances` (the real seated count, ~18k) rather than
  leaving acceptance checks to compare against the 24k config ceiling.

### Measured
20 draw calls, 605,696 triangles, 0.75 ms/frame at 1280x720, GPU-inclusive via
`gl.finish()` on an RTX A2000 Laptop, WebGL2.
