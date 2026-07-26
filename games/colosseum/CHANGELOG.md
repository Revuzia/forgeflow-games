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

## 2026-07-26 — combat core

**Data** (`runtime/data/weapons.js`)
- 6 weapon classes, 3 shields, 5 armour pieces, 6 classical armaturae, 4 hit
  zones. Every field in real units.
- The mobility-vs-protection trade-off is CONCRETE, not flavour: `weight` feeds
  `mobility()` which derives move speed, dodge distance, stamina pool, stamina
  regen and turn rate. A retiarius carries 4.5 kg and moves 4.13 m/s; a secutor
  carries 23.5 kg and moves 3.0 m/s with 40% worse stamina recovery.
- Armour is per-ZONE, which is what makes weak points real — a galea takes head
  damage to 0.22x and does nothing for the legs, which is exactly why beast
  fights are won and lost at shin height.

**Simulation** (`runtime/sim/combat.js`)
- Directional attacks with real windup/active/recover windows, directional
  blocking, parry on a 0.16 s window, guard break, shield integrity, dodge
  i-frames, hit-stop, stagger, wound accumulation, combo scaling, backstab and
  flank multipliers, and slow-motion on a kill.
- Touches no THREE, no DOM and no wall clock: it advances on fixed dt from an
  explicit command struct with all randomness from a seeded generator. Same
  seed, same fight — verified. That is the multiplayer seam.

**AI** (`runtime/sim/ai.js`)
- Utility scoring rather than a behaviour tree. Difficulty is NOT a stat
  multiplier — six skill bands scale reaction latency, decision noise and how
  reliably the AI punishes a recovery window. A tiro genuinely fights worse.
- Style personalities (pressure/spacer/flanker/aggressor/beast) and three beast
  profiles.

**Harness** (`tools/probe_combat.mjs`) — 22 checks, headless, ~1 s.

### Fixed (all four found BY the probe)
- Two "failures" were bugs in the TEST, not the sim: the defender was left
  facing away, so every blow landed as a rear backstab no shield could cover.
  Armour and shields had been working the whole time.
- AI bouts stalled 28/40 times. Circling used a pull threshold of `reach * 1.6`
  and two circling fighters settled at almost exactly that distance, then
  actively pushed each other apart. Now 0/40 stall, average 33 s.
- **The separation solver made beasts unkillable.** A flat 1.5x beast collision
  radius set the human-vs-beast floor at 1.375 m against a gladius reaching
  1.35 m. Measured: the murmillo spent 0 of 1362 ticks in range and dealt 0
  damage across a full bout. Radius is now a real per-fighter field, and
  `probe_combat` asserts the floor stays inside the shortest weapon's reach.
- The scutum alone decided the beast matchup: across a 16-cell sweep of tiger
  hp (110-170) x damage (26-38) the tiger never won more than 21%, because its
  single attack line was simply blocked until it was spent. Stats could not fix
  it. Charging animals now sometimes go over the rim entirely and cost 2.6x
  stamina to block. Tiger now wins 5/20 against a veteranus murmillo.

## 2026-07-26 — armoury, economy and VISIBLE equipment

**Visible equipment** (`runtime/view/equipment.js`)
- Bone-attached procedural Roman armour: galea (crested, brimmed, cheek pieces,
  neck guard), segmented manica, bronze ocreae with knee cops and straps,
  lorica squamata built from ~100 individual scales, studded balteus,
  subligaculum. Each welds to ONE mesh with vertex colours = one draw call.
- Chose bone attachment over modular body meshes deliberately: modular bodies
  need a whole wardrobe authored against one skeleton, and we have one rigged
  body. Rigid armour IS rigid, so it reads correctly parented to a bone and
  animates for free. Verified against the real 24-bone rig read out of base.glb.

**Economy + save** (`runtime/sim/inventory.js`)
- Gold, owned items, six equipment slots, purchase/equip flow, purse settlement
  with crowd-favour and flawless bonuses, six historically-grounded ranks
  (Tiro -> Gregarius -> Veteranus -> Primus Palus -> Champion -> Legend).
- Versioned localStorage save with forward migration, and it FAILS SOFT:
  unknown item ids are dropped rather than throwing, corrupt JSON restores a
  fresh career. A rebalance must never brick someone's ludus.
- Recognises when a loadout matches a classical armatura and names it.

**Armoury UI** (`runtime/ui/armoury.js`)
- Three-column DOM overlay over the live scene, so the PAPER DOLL is the actual
  fighter in the actual arena wearing exactly what was just bought.
- Never shows a bare stat — every shop entry shows the DELTA against what is
  currently worn, because that is the only question the player is asking.
- Carried-weight gauge running mobility -> protection.

### Verified end to end
6 wins -> purses 82/82/82/150/150/150 (the jump is the Gregarius rank-up) ->
846 gold -> bought galea + manica + ocreae -> equipped -> 6 armour pieces
visible on the body -> speed 4.33 -> 3.77 m/s, load 1.2 -> 10.5 kg.
`probe_inventory.mjs`: 45 checks green, covering the affordability gate, slot
rules, preview deltas that do not mutate state, rank progression, save
round-trip, v0 migration and hostile/corrupt saves.

### Note
One probe "failure" was again the test, not the code: it asserted 777 gold
after a 340-gold purchase. The save had round-tripped correctly.

## 2026-07-26 — historical roster + generated PBR materials

**Roster** (`runtime/data/roster.js`) — built from sourced scholarship, and it
corrects several things the popular picture gets wrong:
- 10 armaturae with their CANONICAL pairings. Pairings were engineered, not
  random: big shield against small shield, reach against armour.
- The retiarius does NOT normally fight the murmillo — the SECUTOR was invented
  as his counter, with a smooth helmet so the net cannot catch.
- Four types fought only their own kind (provocator, eques, essedarius,
  paegniarius).
- **Ethnic types were costumes, not ethnicities.** A captured Dacian was
  retrained into a standard Roman armatura, not left in native kit; Samnite and
  Gallus had died out before the Colosseum was built. So `ORIGINS` supplies
  name, colouring and crowd bias — never a fighting style.
- Noxii were not gladiators and did not fight them (midday executions);
  bestiarii and venatores trained at a separate school entirely.
- Surrender is AD DIGITUM — a raised finger to the summa rudis. "Thumbs down"
  is not established. Missio was the norm, ~1 in 10 bouts ended in death.
- 6 named champions from the record (Flamma's Lilybaeum tombstone, Priscus and
  Verus from Martial), 6 beasts, 10 match types, and a **25-match ladder**
  across 6 ranks including 2v2 gregatim, team munus, 1v2, the tertiarius
  surprise third fighter, sine missione survival, and the attested pons
  spectacle (a retiarius on a bridge against two secutores).

**Generated PBR materials** (`pipeline/art/gen_pbr_materials.py`)
- 18 seamless tileable material sets from xAI, each yielding FOUR maps —
  albedo, tangent-space normal, roughness, AO — derived locally with
  numpy/scipy. Closes the gap `texture_transcode.py` left: there was no path
  from a generated image to a full PBR material.
- Shared at `pipeline/assets/generated-materials/` so any ForgeFlow game can
  use them. Roman set plus general-purpose grass/dirt/snow/rock/water.
- Two tiling strategies: `offset` (wrap-shift + feathered seam heal) preserves
  structure for brick and flagstone; `mirror` only for fine isotropic grain,
  because a mirror-fold on structured stone is glaringly symmetric.
- Total cost 19 images, ~$0.38.

**Harena now textured** — real grain and relief tiled at ~7 m, with the photo
supplying only LUMINANCE as a detail multiplier so the procedural layer keeps
authority over colour, rake furrows and every blood stain.

### Fixed
- `sand_arena` generated as WOOD PLANKING: "raked into fine parallel furrows"
  made the parallel-line cue beat the material. Reworded to describe grains and
  to name the failure ("NOT wood, NOT planks").
- Texture detail was multiplied over the damage layer, washing every stain to a
  faint smudge. Grain is now applied BEFORE damage so blood lands last.
- `aoMap` defaults to the second UV set; the arena disc has only one, so it was
  silently doing nothing until pinned to channel 0.

### Note
`sand_bloodied` is permanently removed — xAI content-moderation rejects
blood-stained ground (and still bills the attempt). It was redundant anyway.

## 2026-07-26 — match director + input

**Match director** (`runtime/sim/match.js`)
- Runs one bout as a real munus rather than a skirmish:
  ENTRY (the Triumphalis grinds open) -> SALUTE (a beat to read your opponent,
  during which nothing can hurt anyone) -> FIGHT -> VERDICT (ad digitum) ->
  EXIT (the dead leave by the Porta Libitinaria). Those beats cost almost
  nothing because the gate and lift systems already existed.
- Spawns from a ladder entry: opponents, allies, beasts, named champions, the
  tertiarius surprise third fighter, and survival waves that scale with depth.
- Crowd favour moves on things the player controls — heavy hits, kills, parries
  — and is real money at settlement.
- Missio decided per the history: a well-fought bout is far likelier to earn a
  reprieve, and death stays the exception.

**Input** (`runtime/core/input.js`)
- Keyboard + mouse + gamepad, emitting the SAME command struct the AI Brain
  emits, so the sim cannot tell a human from a bot — which is also what lets a
  network client or a replay drive the player slot.
- Directional attacks read the movement vector at the moment of input
  (forward = thrust, sideways = the matching cut, neutral/back = high),
  the convention fighting games settled on. No extra buttons, discoverable in
  one bout.
- Rebindable, persisted, with a blur handler so a key can never stick.

### Verified — `probe_match.mjs`, 25 checks
All 25 ladder entries resolve with ZERO stalls. Ceremony order confirmed and no
damage lands before the salute ends. Team munus spawns 1 player + 3 opponents +
2 allies; 2v2 spawns 1 ally against 2. The tertiarius appears on a win.
Survival reaches wave 3 of 5. Across 30 bouts missio was granted 23 and refused
7 — close to the historical rate without being hard-coded. Same seed, same bout.

### Balance note (not a defect)
Champion bouts were won 6/6 by a veteranus-skill player brain. Their hpMult is
1.15-1.5 but that is evidently not enough to make a named fight feel like one.
Needs a tuning pass once the player is human rather than a bot.

## 2026-07-26 — Meshy Smart Topology pilot: PASS

Spent 20 credits (4547 -> 4527, ledgered) to answer the one question the docs
do not: **can Smart Topology output be auto-rigged?**

**Yes.** `model_type: smart-topology` + `ai_model: meshy-t2` + `should_texture:
true` at `target_polycount: 12000` produced a clean mesh that auto-rigged first
try, and the rig came back with walk and run clips bundled free.

| | result |
|---|---|
| image-to-3d (T2, textured) | 15 credits |
| auto-rig | 5 credits |
| remesh | **NOT NEEDED** — T2 caps at 15k faces, far under the 300k rig limit |
| mesh | 12,042 tris, **1 draw call, 1 material** — passes the asset gate |
| rig | 24 bones |

**The finding that matters most is free:** the T2 rig's bone names are
IDENTICAL to the existing ForgeFlow Meshy rig — Hips / Spine / Spine01 /
Spine02 / Left+RightShoulder / Arm / ForeArm / Hand / UpLeg / Leg / Foot /
ToeBase / neck / Head. So:
- the existing combat clips (slash1, slash2, parry, hit, death, finisher)
  address 24/24 bones on the new body. Verified by applying anim_slash1 and
  measuring the right hand move 0.781 units. The only unmatched tracks are the
  `Armature`/`char1` container nodes.
- `equipment.js` slot definitions bind unchanged — the galea, manica, ocreae
  and balteus attach to the new gladiator with no edits.

That means **no animation credits are needed per archetype**, and six
gladiators cost ~120 credits rather than the ~240 the meshy-6 path would have.

Source art from xAI (~$0.02) using the strict T-pose recipe: fingers together,
empty hands, NO cape (a known deterministic auto-rig failure), plain
background. The murmillo came out historically correct — bare torso, segmented
manica on the RIGHT arm, single greave on the LEFT shin, studded balteus over a
red subligaculum.

### Open issues
- The rigged GLB is **7.9 MB** — far too heavy for web. The texture is the
  bulk. Needs `gltf-transform optimize --texture-size 1024 --texture-compress
  webp --simplify false` (simplify OFF preserves skinning). gltf-transform is
  NOT currently installed.
- The manica and greave baked slightly olive rather than bronze.
- The FBX duplicates and the raw pre-rig mesh are gitignored, not shipped.

## 2026-07-26 — THE BOUT IS PLAYABLE

The combat sim, the AI, the match director and input were all proven headlessly
but drove nothing on screen. They do now.

**`runtime/view/bout.js`** — the sim -> view bridge, and the ONLY file allowed
to read the sim and write the scene. Keeping that one-directional is what stops
a visual effect from quietly changing gameplay.
- Every combat Fighter gets a pooled Actor, with visible kit built from the
  same loadout the fight uses — what you see is what is being simulated.
- Animation is driven by PHASE, not by events: a WINDUP plays an attack wind
  (alternating slash1/slash2 so a flurry does not look looped, time-scaled to
  the fighter's real windup+active window so the swing lands on the frame the
  sim says it lands), STAGGER plays the hit, death plays once and clamps.
- `CombatCamera` frames the player and the nearest threat, pulls back as they
  separate, drops low during a kill's slow-motion, and shakes on impact —
  everything damped, because a camera that snaps makes a fight unreadable.

**`runtime/view/vfx.js`** — blood, sparks and dust from ONE pooled
InstancedMesh: 1 draw call no matter how violent the bout. Simulated on the CPU
so droplets can hand off to the persistent damage layer — a GPU-only system
could not tell sand.js where blood landed.

**`runtime/ui/hud.js`** — vitals bottom-left, opponent and crowd mood top-centre,
banners centre. Stamina changes COLOUR below 18% because it gates attacking and
dodging and must never be ambiguous in peripheral vision.

Match cues now drive the building: the Triumphalis opens on entry, beasts come
up the hypogeum lift, the crowd waves on the fanfare, the Libitinaria opens for
the exit and corpses are dragged toward it leaving a trail in the sand.

### Verified live in-browser
Started `g1` "Scutum and Sica" against **Ambiorix, Gaul · Thraex** (generated
from the roster). Ceremony ran entry -> salute -> fight. Real exchanges: a 19.9
head hit, dodges, blood staining the sand, crowd favour climbing 0.60 -> 0.66 as
the player landed blows, player down to 34/105 HP and 21 stamina in a genuinely
hard fight. **38 draw calls, 0.70 ms/frame** with a live bout and 86 particles.
All four probes still green.

### Fixed
- VFX rendered as BLACK RECTANGLES. Two causes: `vertexColors: true` defines
  USE_COLOR, and three's fragment stage only applies vColor under USE_COLOR —
  but the vertex stage then multiplies by a `color` attribute the quad did not
  have, so every particle read zero. And the custom billboard patched
  gl_Position inside begin_vertex, which three's own project_vertex chunk
  overwrites. Now: a white color attribute, and CPU billboarding from the
  camera quaternion, which cannot silently break.
- Particles were hard squares; dust grew into pale slabs the size of a man.
  Added a procedurally generated radial alpha ramp (no texture shipped) and cut
  dust to a quarter of its size.

### Still placeholder
The bout still uses the shared Meshy KNIGHT body, not the pilot murmillo — the
pilot GLB is 7.9 MB and needs texture compression before it can ship.

## 2026-07-26 — the knights are gone

**`tools/gen_gladiators.py`** — the full roster pipeline, 20 credits a fighter:
xAI T-pose art -> Meshy smart-topology mesh -> auto-rig -> gltf-transform
compression -> shared combat clips copied in. Eight armaturae queued: murmillo,
secutor, retiarius, thraex, hoplomachus, dimachaerus, provocator, crupellarius.

Every body is generated WITHOUT a helmet, because the galea is an equipment
piece that attaches to the Head bone at runtime — one body serves helmeted and
bare, and the armoury can take it off.

**Compression: 7.9 MB -> 161 KB per fighter** (gltf-transform optimize,
texture-size 1024 + webp + draco, `--simplify false` because decimating a
skinned mesh destroys its weights). A complete character folder — rigged body,
walk, run and 7 shared combat clips — is ~620 KB.

### Fixed
- **Draco models did not load at all.** `gltf-transform --compress draco`
  produces GLBs that throw "No DRACOLoader instance provided" from a plain
  GLTFLoader. Caught on the FIRST character, before the other seven baked with
  the same flag. actors.js now configures a DRACOLoader once, for every
  consumer, from the same CDN and version as the three importmap.
- **Armour was sized for the knight's skeleton.** Equipment carried hardcoded
  metre dimensions, so the first newly-generated body wore a manica twice the
  length of his forearm. Pieces are now FITTED: length and radius come from the
  bone they ride.
- **`boneLength` measured in the wrong space.** `child.position.length()` is in
  the bone's LOCAL units, and these rigs are authored centimetre-scale then
  scaled down — a forearm reads 26.8 locally but 0.282 m in the world. Fitting
  to the local number made armour a hundred times too big. Now measured from
  world matrices. Verified anatomically: forearm 0.282 m, shin 0.422 m on a
  1.82 m fighter.
- **Shield orientation solved against the bind pose.** The Actor now LEAVES its
  rest clip running after measuring, so anything attached afterwards sees a
  settled idle rather than a T-pose — solving a scutum against T-posed arms
  slabbed it across the body.
- **Two fighters could share a name.** With 4-5 names per origin a 6-man team
  bout collided often, and "Marbod kills Marbod" destroys the fiction. Names are
  now unique per match, falling back through other origins and then a Roman
  cognomen. Verified: 0 collisions in 40 team bouts.

### Verified
Multi-enemy battles work: `p1` "Troupe Against Troupe" puts SIX fighters on the
sand (player + 2 allies vs 3 opponents) at **74 draw calls / 1.18 ms**, with
weapon reach genuinely differentiating them — hasta 2.35 m, gladius 1.35 m,
sica 1.18 m, dimachaerus 1.25 m. The shared combat clips drive the newly
generated bodies (slash1 moves the murmillo's hand 0.453 units). All four
probes green.
