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

## 2026-07-26 — hypogeum + ceremonial gates

**Hypogeum** (`runtime/view/hypogeum.js`)
- 8 working beast lifts on an inner ellipse. Each is a pit, a stone collar, a
  hinged pair of planked trap leaves, a counterweighted platform and a barred
  cage with a drop-away front door.
- One normalised 0..1 timeline per lift sequences the whole entrance — doors
  swing down, platform rises (starting before the doors finish, which reads as
  urgency), cage door drops — so the beat is readable in one place instead of
  a pile of independent tweens.
- Emits `doors` / `rising` / `released` / `closed` events for the audio and
  crowd systems to react on exactly the right frame.

**Gates** (`runtime/view/gates.js`)
- Porta Triumphalis and Porta Libitinaria as heavy inward-swinging double
  doors; north and south beast gates as grinding portcullises. 3.4 s to open,
  2.6 s to shut — deliberately slower than feels efficient, because the weight
  IS the drama.
- Each gate has an unlit passage void behind it, so an open gate reads as a
  black mouth rather than a hole showing sky through the far side.

**Cue routing** (`runtime/boot.js`)
- Gate and lift events drive the crowd: the Triumphalis grinding open hushes
  the mob to 0.12 excitement, and the reveal detonates it into a roar plus a
  travelling wave. Cage release does the same, harder.

### Fixed
- `__test.step()` advanced ONLY the crowd, so every automated check watched
  gates and lifts sit frozen at t=0 while reporting "opening". There is now one
  `stepSim(dt)` that both the rAF loop and the harness call — what a check
  exercises is exactly what a player gets. (This is also the multiplayer seam:
  a server tick calls the same function.)
- One open trap made the ENTIRE hypogeum visible — 8 lifts x 7 meshes = 56 draw
  calls for a single beast entrance. Visibility is now per-lift.
- Gate yaw was `atan2(-x,-z) + PI`, which pointed each gate's local -z (its
  passage void and surround depth) at the arena centre — the whole assembly
  stood out on the sand instead of piercing the wall. Dropped the `+ PI`.
- The gate surround was 8.2 m tall against a 4.0 m podium, punching through the
  first tier of seating. The opening and its header are now clamped inside the
  podium, letting the podium cornice serve as the lintel.

### Measured
32 draw calls idle, 39 peak with the Triumphalis open AND a beast lift raised,
0.67 ms/frame at 1400x800 GPU-inclusive. Sequence verified by driving real
frames: gate start 0.03 s, lift rising 0.78 s, cage released 3.05 s, gate fully
open 3.43 s, crowd excitement 0.8 on release.

## 2026-07-26 — actors on the sand

**Actor system** (`runtime/view/actors.js`)
- One interface over two rig families: Meshy humanoids (base.glb + armature-only
  clip GLBs retargeted by bone name) and Sketchfab quadrupeds (clips embedded).
- Animation state machine with cross-fades, one-shots, and foot-slide correction
  that scales loco clip timeScale by real ground velocity.
- Procedural Roman weapons — gladius, scutum, trident — each welded into ONE
  mesh with vertex colours. Built naively these are 5-9 primitives apiece; a
  sword and shield alone cost 15 draw calls before the merge.

### Species audit — the clip name is not the animal
`leopard.glb` and `jaguar.glb` ship clips called `LeopardAttack`/`LeopardIdle`
and are ANTHROPOMORPHIC BEAST-MEN, not cats. Rendering them is the only thing
that revealed it. `tools/ingest_assets.mjs anatomy` now classifies rigs by
bone naming (tail/paw/hind-leg vs arm/hand/shoulder) and bind-pose elongation,
though shared tokens like `Spine`/`Head` make it advisory, not conclusive —
a render is still the deciding test. Verified by eye:

| asset | verdict |
|---|---|
| tiger.glb | true quadruped, 1 draw call, Attack + Run — the arena beast |
| panther.glb | true quadruped, 1 draw call, but bright blue (needs retexture) |
| lion.glb | true quadruped and looks right, BUT 8 primitives and only 3 clips (no attack, no run) — cannot fight as shipped |
| leopard/jaguar | humanoid beast-men — unusable as arena cats |
| cheetah.glb | 18 clips but its animated bbox collapses to ~0 — measurement bug, unresolved |

lion.glb and leopard.glb were removed from `assets/` rather than shipped
failing; the draw-call gate flags the lion on sight.

### Fixed
- Quadrupeds were scaled by HEIGHT, turning a big cat into a house cat. Rigs are
  now normalised by body LENGTH when a length is given (tiger = 2.05 m nose to
  tail-base), and measured UNDER A CLIP rather than in bind pose, because
  several of these rigs bind in a pose unlike anything they animate to.
- Characters hovered above the sand with a detached shadow: the lowest BONE is
  the ankle, not the sole. Grounding now samples real skinned vertex positions
  via `SkinnedMesh.getVertexPosition`, which applies live skinning where
  `Box3.setFromObject` only transforms the bind-pose box. Soles now land within
  4 cm of y=0.
- The scutum was built as N independently rotated boxes, which splay apart at
  their edges and read as a venetian blind. It is now a continuous ring-segment
  sweep, so staves meet by construction.
- `mergeGeometries` silently returns null when inputs disagree on attributes
  (a hand-built geometry had no `uv`), surfacing three frames later as an
  opaque "cannot read morphAttributes of null". `paint()` now normalises every
  part to position/normal/uv/color and `weld()` throws with the actual
  mismatch.
- Shield orientation was hand-guessed in Euler angles and wrong twice. It is
  now SOLVED: build the desired world rotation (face along the fighter's
  forward, long axis up) and express it in the bone's frame.

### Known gap
The player model is the shared Meshy **knight** — white plate, gold cross, red
cape. It is a crusader standing in a Roman amphitheatre. No code fixes this;
it needs real gladiator archetypes.

## 2026-07-26 — the harena

**Sand** (`runtime/view/sand.js`)
- Procedural surface in the fragment shader: warm ochre base, fbm grain, broad
  damp/dry patchiness, and concentric rake furrows following the ellipse (the
  harena was raked between bouts, and the furrows give the eye scale on what
  is otherwise a featureless plane). No texture fetch, resolution-independent.
- **Persistent damage layer**: a single 1024x1024 render target holding blood
  (r), scuffs (g) and wetness (b), stamped by additive splat quads and sampled
  by the sand shader. 500 blood pools cost exactly what one costs. Decal meshes
  were rejected — a draw call each, and they z-fight on an undulating surface.
- `splat()`, `trail()` for a body dragged to the Porta Libitinaria, and
  `clear()` between matches.

### Fixed
- The sand disc was a `CircleGeometry` — a triangle fan with ONE interior
  vertex — so the per-vertex height ripple only ever moved the rim. Now a ring
  with 24 radial divisions. Still one draw call.
- Blood rendered as a glowing GOLD puddle, brighter than the sand it stained:
  roughness had been dropped to 0.45 over blood, so the sun's specular lobe
  blew out through ACES. Soaked sand is damp granular material, not standing
  liquid — roughness now stays above 0.78 and the colour is a deep matte oxide.

### Measured
35 draw calls with both actors and 69 accumulated splats, 1.10 ms/frame at
1400x850 GPU-inclusive.
