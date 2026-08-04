export const meta = {
  name: 'snowflow-build',
  description: 'Build the Three.js/WebGL2 SNOWFLOW port in dependency waves: shared shader libraries first, then the materials that consume them, then the effects, then integration to a clean boot',
  phases: [
    { title: 'Wave A', detail: 'shared libraries: deformation, sky, shadows, post+camera' },
    { title: 'Wave B', detail: 'the big materials: terrain+snow, character+cloth' },
    { title: 'Wave C', detail: 'effects: surf wake + spray, the five spells' },
    { title: 'Integrate', detail: 'main.js, frame orchestration, boot' },
    { title: 'Boot', detail: 'iterate until the page loads clean and renders' },
  ],
}

const GAME = String.raw`C:\Users\TestRun\Claude Claw\forgeflow-games\games\driftwake`
const REF = String.raw`C:\Users\TestRun\AppData\Local\Temp\claude\C--Users-TestRun-Claude-Claw\7a2e6b97-6e7f-44b3-82c7-2af10752e605\scratchpad\snowflow_demo`
const HARNESS = `${GAME}\\_harness`
const URL = 'http://localhost:8799/games/driftwake/index.html'

const COMMON = `
PROJECT — a Three.js r172 / WebGL2 / hand-written GLSL ES 3.00 port of the SNOWFLOW WebGPU
tech demo, reproducing its visual output closely enough that a harsh critic comparing matched
screenshots blind cannot reliably tell which is which.

READ FIRST, IN FULL, BEFORE WRITING ANY CODE:
  1. ${GAME}\\ARCHITECTURE.md   — binding contract. Ownership, pass order, canonical chunk
                                  signatures (§3.1), measured GPU limits (§4.1, note the
                                  30-varying ceiling), definition of done (§7).
  2. your spec document(s) under ${GAME}\\_spec\\  — these transcribed every constant and
                                  formula out of the reference. They are your source of truth
                                  for numbers.
  3. the reference source itself at ${REF}\\src\\  — read the actual files for your subsystem.
                                  The spec is a guide; the source is the ground truth. Where
                                  they disagree, the source wins and you say so in your report.

THE REFERENCE FRAMES ARE ON DISK: ${GAME}\\_shots\\ref\\*.png — 14 shots of the real demo,
captured at known camera poses. LOOK AT THEM. They are what you are trying to match.

FOUNDATION (already built, do not edit): src/core/{settings,input,loading,perf,glsl,gfx}.js,
src/shaders/registry.js, index.html. Use them:
  - \`import { S, onChange } from "../core/settings.js"\` for every tunable. Never hardcode a
    value that has a settings key — the overlay's sliders must actually drive your system.
  - \`import { register } from "../core/glsl.js"\` and register your chunks; consume others'
    with \`#include "lib/name"\`.
  - \`gfx.js\` gives you makeRT / makePingPong / FullScreenPass / warmUp. Use them rather
    than re-rolling render-target boilerplate.
  - \`import * as THREE from "three"\` (the import map resolves it).

REGISTERING YOUR SHADER CHUNKS — src/shaders/registry.js is the ONE file you share with the
other builders running RIGHT NOW, in parallel with you. It already contains a commented-out
import line and a commented-out CHUNKS entry for every chunk in ARCHITECTURE.md §3, naming
its owner. To register yours:
  · uncomment ONLY your own two lines — one import, one CHUNKS entry
  · make each edit a minimal, unique single-line replacement. Never rewrite the import block
    or the CHUNKS object wholesale: another builder is editing the same file between your
    read and your write, and a block replacement silently deletes their registration.
  · if an edit fails because the text moved, re-read the file and redo just that one line.
Registering a name twice throws at boot, so a collision fails loudly rather than silently
resolving to whichever import happened to run last.

HARD RULES
  · Edit ONLY the files you own, plus your own two lines in registry.js. If you need
    something from another subsystem, code against the signature in ARCHITECTURE.md §3.1 and
    note the dependency in your report.
  · Never invent a constant. Every number traces to the spec or the reference source.
  · Nothing allocates in the render loop.
  · No console.log. Failures go through loading.fail().
  · Handedness: Three is right-handed Y-up, Babylon is left-handed. The specs transcribe
    reference formulas as written. Every time you port a direction, cross product or winding,
    state in a comment which convention the line is in. This is the single most likely source
    of a "close but subtly wrong" result — treat it as a first-class concern, not a footnote.
  · Match the reference's commenting register: a docblock per file explaining why, dense
    comments where a number or decision is non-obvious, silent where the code is plain.

REPORT (your final text): files written; every place you deviated from the spec and why;
every cross-subsystem dependency you are relying on; anything you could not implement and
what is missing as a result. Report with total fidelity — a rounded-up report corrupts every
decision built on it.
`

// ---------------------------------------------------------------------------
const JOBS = {
  deform: {
    label: 'deform',
    title: 'Deformation state buffer + snow contact',
    owns: `src/terrain/deformation.js, src/character/snowContact.js,
           src/shaders/deformSim.glsl.js, src/shaders/lib/deform.glsl.js`,
    spec: '_spec/deformation.md',
    ref: 'src/terrain/deformation.js, src/shaders/deformSim.fragment.wgsl, src/shaders/lib/deform.wgsl, src/character/snowContact.js',
    body: `Build the persistent, additive terrain state buffer.

Two RGBA16F ping-pong targets (\`S.deformResolution\`, default 2048) covering 80 m, driven by
ONE full-screen pass per frame that scrolls, relaxes and splats in a single dispatch. WebGL2
has no compute and no storage textures — this is a \`FullScreenPass\` from gfx.js writing into
the write target while sampling the read target, then swap. That is the whole port.

Addressing is TOROIDAL: a texel's UV is fract(worldXZ / size), so the window follows the
player without ever copying the buffer. Newly-exposed texels must be detected and zeroed by
the same pass — get this right or the player drags a smear of stale trail behind them.

Channels: depression depth, displaced mass, compression, ice. The second channel is what
makes a trail with raised berms instead of a flat footprint decal — do not drop it.

Refill: anisotropic diffusion (loose berms slump ~3x faster than a packed trench floor),
berm-into-depression slump, wind-driven infill from upwind, slow exponential decay tuned so
~71% of trail depth survives 60 s. Every rate constant is in the spec — transcribe, do not
re-tune.

\`lib/deform\` is consumed by the beauty pass AND all three shadow cascades AND the prepass,
through this one include, so trails self-shadow and berms break the silhouette. Its exported
signatures are fixed by ARCHITECTURE.md §3.1.

\`brush()\` is the single write API that feet, the surf wake and all five spells share. Feet
stamp through snowContact.js. Design it as a staging array the simulation pass consumes:
callers push brushes during the frame, the sim pass reads them. Document the signature
clearly at the top of deformation.js — four other subsystems will call it.

NOTE the vortex spell writes a NEGATIVE depression. Make sure the sign convention supports it.`,
  },

  sky: {
    label: 'sky',
    title: 'Nishita atmosphere, IBL, raymarched far range',
    owns: `src/render/sky.js, src/shaders/sky.glsl.js, src/shaders/skyBake.glsl.js,
           src/shaders/lib/atmosphere.glsl.js`,
    spec: '_spec/sky.md',
    ref: 'src/render/sky.js, src/shaders/sky.*.wgsl, src/shaders/skyBake.fragment.wgsl, src/shaders/lib/atmosphere.wgsl',
    body: `Build the atmosphere and everything that reads from it.

Bake at load: a Nishita single-scattering integration with the multiple-scattering
approximation and the ITERATIVELY SOLVED SNOW BOUNCE, into an equirectangular LUT, plus SH
irradiance coefficients and a mip-based specular chain. Analytic, not a captured HDRI —
the entire look hangs on a sun 10-15 degrees up, and \`S.sunElevation\` must correctly drag
the horizon warmth, the zenith gradient, the ambient tint and the direct sun colour together.
Re-bake on change (debounced) via onChange.

The solved snow bounce stored BELOW the horizon is load-bearing for two other systems: it is
what the water's refraction looks up instead of copying the scene, and it is what makes the
ambient read as snow-lit. Keep it.

Then the FAR RANGE: a heightfield raymarched on the skybox — no geometry, behind everything
by construction, analytic normals, ridges occluding ridges, and a second short march toward
the sun for its own cast shadows. It is lit by the snow field's own material logic and hazed
by the same single atmosphere, so the two meet at ONE colour rather than two. Gate on
\`S.showMountains\`, height on \`S.mountainHeight\`.

Look at ${GAME}\\_shots\\ref\\12-far-range.png and \\14-sky-sun.png — those are your targets.

\`lib/atmosphere\` signatures are fixed by ARCHITECTURE.md §3.1. Every other subsystem hazes
through your \`aerial()\` — it must be correct before anything else can look right.`,
  },

  shadows: {
    label: 'shadows',
    title: 'Three CSM cascades with world-space PCSS + depth prepass',
    owns: `src/render/shadows.js, src/render/depthPass.js,
           src/shaders/lib/shadowLookup.glsl.js, src/shaders/prepass.glsl.js`,
    spec: '_spec/shadows.md',
    ref: 'src/render/shadows.js, src/render/depthPass.js, src/shaders/lib/shadowLookup.wgsl, src/shaders/prepass.fragment.wgsl',
    body: `Build the cascade system and the camera-space depth prepass.

Three hand-rolled cascades with world-space PCSS: blocker search, penumbra estimate, rotated
Poisson filter. Texel-snapped in WORLD space and stabilised against a rotation-invariant
bounding sphere — without both, the shadows crawl as the camera turns and the whole thing
reads as amateur immediately.

Three's built-in shadow map CANNOT be used, for the same reason Babylon's cascade generator
could not: the terrain has no CPU geometry matching what is drawn. Every caster registers the
vertex program it is actually rendered with. Build \`shadows.registerCaster(mesh, material)\`
and \`depthPass.registerCaster(mesh, material)\` as the explicit registration API — six other
subsystems will call them. Document both signatures at the top of the file.

The prepass writes linear view depth carried as a varying, plus a specular/ice mask. The
whole post chain feeds off it: TAA reprojection, light shafts, DOF CoC and the SSR gate.
Get the depth linearisation and its encoding right and say in a comment exactly what is in
each channel — four post passes will read it.

\`shadowAt(worldPos, N)\` per ARCHITECTURE.md §3.1 is called by every lit surface in the
project. It must include the cascade blend band, or the seam will be visible in shot 03.

Your reference target is ${GAME}\\_shots\\ref\\03-shadow-penumbra.png. Study the penumbra:
it is sharp at the contact point and widens with distance. A uniform blur is a fail.`,
  },

  'post-core': {
    label: 'post-core',
    title: 'Post chain, camera rig, settings overlay',
    owns: `src/core/camera.js, src/post/postChain.js, src/ui/overlay.js,
           src/shaders/post/*.glsl.js, src/shaders/lib/postCommon.glsl.js`,
    spec: '_spec/post-core.md',
    ref: 'src/post/postChain.js, src/shaders/post/*.wgsl, src/shaders/lib/postCommon.wgsl, src/core/camera.js, src/ui/overlay.js',
    body: `Build the post-processing chain, the spring-arm camera and the overlay.

POST CHAIN — in the reference's exact order (the spec documents it; do not reorder):
  · TAA — Halton(2,3) jitter written straight into the projection matrix and FROZEN for the
    frame so the prepass and the beauty pass agree to the subpixel. Depth-based reprojection,
    variance clipping, five-tap Catmull-Rom history fetch. In Three you must apply the jitter
    by writing camera.projectionMatrix directly after updateProjectionMatrix(), and publish it
    before anything reads scene matrices.
  · Bloom — three levels, thresholded in EXPOSED units so only the sun disc, the glints and
    lit spray reach it. Karis average on the prefilter.
  · Volumetric light shafts — integrating sky visibility out of the prepass along the ray to
    the sun. They fade out entirely at a high sun.
  · DOF — deliberately slight, focal plane tracking the spring arm's own length, each tap
    weighted by its own circle of confusion.
  · SSR — ice only, gated on the prepass mask, so on a frame with no Crystallise cast the
    pass is a fetch and a branch.
  · AgX / ACES tonemap, contrast-adaptive sharpen, grain, vignette.

Transcribe both tonemap curves exactly. \`S.exposure\` is 0.105 and \`S.contrast\` 1.14 for a
measured reason documented in settings.js — sunlit snow lands near AgX normalised 0.79 where
the curve's slope is 0.09/stop. Get this wrong and every lit slope resolves to flat white.
The renderer must NOT have toneMapping set; your pass owns the curve and the sRGB encode.

CAMERA — port camera.js faithfully: critically-damped spring pivot (freq 7.5, damping 1.0),
FOV widening with speed, banking into carves, trauma-squared shake, and the 5-sample ground
clearance probe along the arm that rises fast (26) and relaxes slow (4.5). \`rig.yaw\` and
\`rig.pitch\` must be writable and ADDITIVE from input — the harness sets them directly.

OVERLAY — every SCHEMA key as a live widget, a frame-time graph with median/95th/1% low,
draw calls, triangles, per-system CPU breakdown, all system toggles, and the debug views
(normals, depth, cascades, deform, footprint, shadowMap, albedo). Toggled by F1 or backtick.
It must live under id \`#overlay\` so the comparison harness can hide it.`,
  },

  'terrain-snow': {
    label: 'terrain-snow',
    title: 'Clipmap terrain, heightfield, and the snow material',
    owns: `src/terrain/{heightfield,clipmapMesh,terrain}.js,
           src/shaders/{snow,heightBake,detailBake,auxBake}.glsl.js,
           src/shaders/lib/{noise,terrain,clipmap,shading}.glsl.js`,
    spec: '_spec/terrain.md AND _spec/snow-shading.md (both are yours — read both in full)',
    ref: 'src/terrain/*.js, src/shaders/snow.*.wgsl, src/shaders/{height,detail,aux}Bake.fragment.wgsl, src/shaders/lib/{noise,terrain,clipmap,shading}.wgsl',
    body: `This is the largest and most visually important job in the project. The snow IS the
demo. Budget your effort accordingly and do not rush the fragment shader.

GEOMETRY — a nested-ring geometry clipmap: 8 rings, 8.5 cm inner spacing, ~870 m radius,
333k triangles, ONE static mesh, ONE draw call. Vertices carry only (gridIndex, ringLevel);
world placement, CDLOD morphing and displacement all happen in the vertex shader. No CPU
rebuild, no per-frame upload. Use a non-indexed or indexed static BufferGeometry built once,
and set \`frustumCulled = false\` (it is always centred on the camera).

HEIGHTFIELD — layered gradient noise with ANALYTIC DERIVATIVES, anisotropic about a single
prevailing wind (\`S.windDirection\`, 42 degrees): broad transverse dune ridges, a long low
swell, medium drifts sheared along the wind for lee-face asymmetry, sparse rock outcrops.
Bake once into a 4096² RG32F texture (validated available) and mirror it back to a CPU
Float32Array so \`heightAt(x,z)\` samples EXACTLY the surface that is drawn — the character
must not float or sink. Re-bake on wind/dune-height change.

SNOW SHADING — the signature look, and where a port usually dies:
  · multi-scale normals: baked macro slope + analytic sastrugi + ripples + three tiled detail
    scales + triplanar on steep faces, blended exactly as the spec describes
  · wrapped diffuse; the BACK-SCATTER SUBSURFACE term with depth-dependent BLUE tint — this
    is the single most important term in the project. Transcribe it exactly.
  · GGX specular, SH ambient with the solved snow bounce (from lib/atmosphere)
  · procedural view-dependent glints gated on grazing angle
  · compression / wetness / ice as surface STATE CHANNELS the one material reads (from
    lib/deform), not as separate materials

Apply displacement from \`lib/deform\` in the vertex shader, and register the SAME vertex
program with shadows.registerCaster and depthPass.registerCaster so trails self-shadow.

MIND THE 30-VARYING CEILING (ARCHITECTURE.md §4.1). Pack into vec4s; recompute from world
position in the fragment shader rather than interpolating another float.

YOUR TARGETS: ${GAME}\\_shots\\ref\\01-hero.png (overall), \\02-snow-grazing.png (detail
normals + glints), \\04-backlit-sss.png (subsurface), \\13-char-closeup.png (grain at close
range). Open them. The fine wind-streak texture raking across every slope is sastrugi — if
your snow is a smooth white sheet, you are not done.`,
  },

  'character-cloth': {
    label: 'character-cloth',
    title: 'Procedural figure, locomotion, Verlet garments, shell fur',
    owns: `src/character/{build,figure,character,controller,cloth}.js,
           src/shaders/{char,cloth,fur}.glsl.js, src/shaders/lib/charSkin.glsl.js`,
    spec: '_spec/character.md AND _spec/cloth-fur.md (both are yours)',
    ref: 'src/character/*.js (except snowContact.js), src/shaders/{char,cloth,fur}.*.wgsl, src/shaders/lib/charSkin.wgsl',
    body: `Fully procedural — no rig file, no animation clips, no authored mesh.

SKELETON + GEOMETRY: an 18-bone skeleton whose bind pose is a table of numbers, geometry
lofted from that table at load (cowl, torso, arms, trousers, boots, belt). The spec has the
bone table verbatim — use it.

LOCOMOTION, solved not played back. This is the part that reads as expensive:
  · A distance-driven stance/swing machine writes a foot's world position exactly ONCE, on
    touchdown, and holds it absolutely fixed while two-bone IK reaches for it. Structure the
    code so a planted foot CANNOT slide — nothing in the code path is able to move it. That
    is the design, not a tuning target.
  · Gait phase advances with ground travelled, so stride length and ground speed are the same
    number by construction. Do not drive the gait off a timer.

CLOTH: Verlet on four panels with distance, bending and shape-memory constraints, nine body
collision capsules, and a hem that rides the snow surface (sample terrain.heightAt). Folds
live in the REST SHAPE, not in a normal map. The 36x12 solve renders as a 72x32 surface via
Catmull-Rom reconstruction in the vertex shader, so tessellation and simulation cost are
decoupled — implement the reconstruction, do not just render the sim grid.

FUR: shell fur at the hood rim and cuffs — a partial torus emitted 22 times, alpha-tested
against a hashed strand field evaluated in the fragment shader.

ONE data texture carries everything to the GPU: rows 0-3 bone matrices, rows 4+ simulated
cloth nodes. One upload per frame into a pre-allocated Float32Array, no allocation.

The controller owns \`position\`, \`velocity\`, \`surfActive\`, \`speed01\`, \`lean\`, \`streak01\`
and the walk/surf state machine — these are read by the camera, the wake and the harness, so
match the reference's field names exactly (see ARCHITECTURE.md §2).

Register cloth and body with shadows.registerCaster and depthPass.registerCaster using the
same vertex programs they are beauty-rendered with — the cloth is placed in its vertex
shader, so an automatic depth pass would shadow the wrong shape.

YOUR TARGET: ${GAME}\\_shots\\ref\\13-char-closeup.png. Study the hood fur, the cuff fur, the
way the robe folds and how the hem meets the snow.`,
  },

  wake: {
    label: 'wake',
    title: 'Snow-surf swept wake mesh + spray particles',
    owns: `src/vfx/{surfWake,particles}.js, src/shaders/{wake,spray}.glsl.js,
           src/shaders/lib/wake.glsl.js`,
    spec: '_spec/wake-spray.md',
    ref: 'src/vfx/*.js, src/shaders/wake.*.wgsl, src/shaders/spray.*.wgsl, src/shaders/lib/wake.wgsl',
    body: `The wake is a SWEPT MESH, not a particle effect. Building it as particles is an
automatic fail.

Its spine is the path the board has taken, resampled every 30 cm into a 96x3 data texture.
The mesh itself is a STATIC lattice of (column, row, side) and every vertex is placed in the
vertex shader — so a 19-metre wake and a 2-metre one cost the same buffer and the same 4.6 KB
upload.

The cross-section is a breaking wave integrated from a TURNING TANGENT: the tangent sweeps
from just below horizontal at the base to 284 degrees at the tip, so one \`curl\` parameter
runs continuously from a low heaped bank to a lip that hangs back across its own face.
Amplitude and curl resolve per side from the carve, so the outside of a turn takes nearly all
the snow. Peak wall 2.4 m at a full-speed carve; it collapses 0.88 s after being laid, which
makes wake length \`life * speed\` with no second constant.

Normals must be DIFFERENCED out of the same \`wakePoint\` the geometry uses, so they cannot
disagree with it. Do not author a separate normal formula.

Two spray populations come off the same spine: a dense slow curtain hugging the crest, and
ballistic grains flung clear — emitted at FRACTIONAL positions along it. Plus screen-space
speed streaks (\`S.windStreaks\`, \`S.streakStrength\`) and camera shake on a loaded edge
(rig.addTrauma).

particles.js is a POOLED system with a fixed capacity, shared by the wake, the footfall kick
and all five spells. Design the emit API for those callers and document it at the top of the
file — the spells builder will call it.

Write into the terrain state buffer through deformation's \`brush()\`, and register with both
shadows and depthPass using the same vertex program.

YOUR TARGET: ${GAME}\\_shots\\ref\\06-surf-wake.png.`,
  },

  spells: {
    label: 'spells',
    title: 'The five spells, shared water body, crystals, light pool',
    owns: `src/spells/*.js, src/shaders/{water,crystal}.glsl.js,
           src/shaders/lib/{water,crystal,spellLights}.glsl.js`,
    spec: '_spec/spells.md',
    ref: 'src/spells/*.js, src/shaders/water.*.wgsl, src/shaders/crystal.*.wgsl, src/shaders/lib/{water,crystal,spellLights}.wgsl',
    body: `ONE water material, ONE mesh, ONE draw, EIGHT strands. Four of the five spells move a
coherent body of water and are structurally the SAME object: a swept surface along a spine
with a radius, a parallel-transported frame and a foam channel — the same construction as the
surf wake. A strand that is not in use is switched off by zeroing its rows, so the draw count
does not depend on how many spells are up. Build waterBody.js as that shared object first;
the five spells are then mostly parameterisation and lifecycle.

  1. Sweep — a crescent of slush rises out of the ground and runs outward, ploughing a
     channel and throwing berms.
  2. Ribbon — a held stream tracking the hand and camera aim, drawing precessing
     figure-eights and scoring thin curved lines into any snow it skims. Released, the head
     steers onto the aim and accelerates, so the water arcs onto the target with the bend it
     had at release still travelling out along the tail.
  3. Bloom — a targeted eruption: a crater with a raised rim, a waisted column that rises and
     withdraws down its own axis, and four seconds of fallout curtain lit from below.
  4. Crystallise — hexagonal prisms grown along a golden-angle spiral, alpha-blended AND
     depth-writing, so you see the snow through the ice but never one prism through another.
     Facet normals come from screen-space derivatives (dFdx/dFdy of world position), so every
     facet is exactly flat and every edge exactly hard. Do not smooth-shade them.
  5. Vortex — three helices of lifted snow winding around the player, with the airborne mass
     emitted along those same helices at their own tangential velocity. The only system that
     writes a NEGATIVE depression.

REFRACTION needs no scene copy and no second opaque pass: the sky LUT already stores the
solved snow bounce below the horizon, so one \`skySample\` along the refracted ray is a
physically-derived estimate of what is behind the water in any direction. Three lookups at
three indices of refraction give the chromatic dispersion; absorption over path length gives
the tint (\`S.waterDepthTint\`).

FOUR pooled dynamic lights are declared per frame. \`lib/spellLights\` is included by every
lit surface in the project — snow, robe, cloth, fur, wake, spray, water, ice — and every one
of them runs the identical \`snowSubsurface\` the sun runs, so a spell lights the snow
THROUGH a berm crest rather than putting a bright patch on the near face. Your chunk must
expose \`spellLighting()\` per ARCHITECTURE.md §3.1 and must compile and return black when no
spell is active, because it is in every shader whether or not anything is cast.

Public API the harness and the integrator call: \`cast(n)\` for n=1..5, \`holdRibbon(bool)\`,
\`addConsumers(...materials)\`, \`registerPrepass(depthPass)\`, \`update(dt, cameraPos)\`.

YOUR TARGETS: ${GAME}\\_shots\\ref\\07-spell-sweep.png through \\11-spell-vortex.png.`,
  },
}

const job = (k, ph) => agent(
  `${COMMON}
================================================================================
YOU ARE THE **${JOBS[k].label.toUpperCase()}** BUILDER — ${JOBS[k].title}

YOU OWN (and may edit nothing else):
  ${JOBS[k].owns}

YOUR SPEC: ${GAME}\\${JOBS[k].spec}
REFERENCE FILES TO READ IN FULL: ${JOBS[k].ref.split(', ').map(f => `${REF}\\${f}`).join('\n  ')}

${JOBS[k].body}
================================================================================`,
  { label: `build:${JOBS[k].label}`, phase: ph, effort: 'high' }
)

phase('Wave A')
log('Wave A — shared libraries nobody else can compile without')
const waveA = await parallel([
  () => job('deform', 'Wave A'),
  () => job('sky', 'Wave A'),
  () => job('shadows', 'Wave A'),
  () => job('post-core', 'Wave A'),
])

// Genuine barrier: Wave B's materials #include the chunks Wave A just wrote, and
// read their headers to bind uniforms. Starting early would mean coding against
// signatures that do not exist yet.
phase('Wave B')
log('Wave B — the big materials, consuming Wave A libraries')
const waveB = await parallel([
  () => job('terrain-snow', 'Wave B'),
  () => job('character-cloth', 'Wave B'),
])

phase('Wave C')
log('Wave C — effects, consuming terrain + character + deformation')
const waveC = await parallel([
  () => job('wake', 'Wave C'),
  () => job('spells', 'Wave C'),
])

phase('Integrate')
const integrate = await agent(
  `${COMMON}
================================================================================
YOU ARE THE INTEGRATOR. Every subsystem has been written by a different agent against
ARCHITECTURE.md. Your job is to make it a running program.

YOU OWN: ${GAME}\\src\\main.js
You MAY additionally edit any other file ONLY to fix a genuine integration defect (a
signature mismatch, a wrong import path, a uniform name that does not match §3.1, a missing
export). Every such edit must be listed in your report with file:line and the reason. Do not
redesign anyone's subsystem, and do not "improve" working code.

READ FIRST: ${REF}\\src\\main.js in full. Its comments explain WHY the per-frame order is what
it is — the reasons are load-bearing and you must preserve them:
  · character.update -> figure.update -> contact.update, because footprints are stamped at the
    boot's actually-planted position, which only exists once the figure has been solved
  · post.update AFTER the rig has moved and BEFORE anything reads the view-projection, because
    it jitters the projection and both the prepass and the beauty pass must agree
  · spells.update AFTER the shadow refit (so water and ice carry this frame's cascade
    matrices) and BEFORE terrain.update (so spell brushes are staged before the sim pass runs)
  · figure.sync after the shadow refit, for the same cascade-matrix reason
  · wake before spray, because grains the wake sheds must be in the pool before it uploads

BUILD main.js:
  1. Boot: capability check via gfx.checkCaps — on failure show #nogpu and stop.
  2. Renderer: THREE.WebGLRenderer, antialias false (TAA handles edges), no toneMapping,
     LinearSRGBColorSpace, hardware scaling driven by S.resolutionScale via onChange.
  3. Construct every system in the load-time order of ARCHITECTURE.md §4, driving
     loading.phase() so the boot bar actually reflects progress.
  4. Warm-up behind the boot screen: every material compiled and drawn at least once with
     REAL geometry, so the first cast of a spell does not compile a pipeline mid-frame.
     Then a few real frames before lifting the boot screen.
  5. The render loop, in the exact order above, with perf marks per system.
  6. Publish globalThis.SNOWFLOW exactly as ARCHITECTURE.md §2 specifies. The comparison
     harness depends on every member — if one is missing or misnamed, every screenshot
     comparison silently breaks.

THEN MAKE IT BOOT. Iterate:
    cd "${HARNESS}" && python bootcheck.py
It prints shader compile failures, uncaught errors, how far the boot got, draw calls and
triangles, and saves a screenshot to ${GAME}\\_shots\\bootcheck.png. LOOK at that screenshot —
"no errors" is not the same as "renders something". Keep going until it prints RESULT: OK and
the screenshot shows snow, a sky and a figure.

If the server is not up: python "C:\\Users\\TestRun\\Claude Claw\\forgeflow-games\\serve_nocache.py" 8799

Report with total fidelity: the final bootcheck output verbatim, what you see in the
screenshot, every cross-owner edit you made and why, and every system that is still broken or
missing. Do NOT report success unless bootcheck says OK and you have looked at the image.
================================================================================`,
  { label: 'integrate:main', phase: 'Integrate', effort: 'high' }
)

// ---------------------------------------------------------- boot until green
phase('Boot')
const BOOT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['booting', 'renders', 'summary'],
  properties: {
    booting: { type: 'boolean' },      // bootcheck printed RESULT: OK
    renders: { type: 'boolean' },      // the screenshot actually shows the scene
    summary: { type: 'string' },
    remaining: { type: 'array', items: { type: 'string' } },
  },
}

let boot = null
for (let attempt = 1; attempt <= 4; attempt++) {
  boot = await agent(
    `${COMMON}
You are the BOOT DOCTOR for the SNOWFLOW port, attempt ${attempt} of 4.

Run:  cd "${HARNESS}" && python bootcheck.py

Then FIX whatever it reports, anywhere in ${GAME}\\src — at this stage you own the whole tree.
Work from the first failure to the last; a shader that fails to compile takes the rest of the
frame down with it, so fix compile errors before chasing anything visual.

Common WebGL2 port failures, in the order they usually bite:
  · GLSL ES 3.00 strictness: no implicit int->float, \`texture()\` not \`texture2D()\`,
    \`in\`/\`out\` not \`attribute\`/\`varying\`, explicit \`#version 300 es\` handling via
    RawShaderMaterial + glslVersion, integer literals where floats are wanted
  · exceeding MAX_VARYING_VECTORS (30) — link fails with no obvious message; pack into vec4s
  · sampling a render target that is currently bound as the draw target (feedback loop)
  · Three not auto-providing projectionMatrix/modelViewMatrix to RawShaderMaterial —
    you must declare and bind them yourself
  · a uniform declared in a chunk but never bound, which links but reads zero
  · handedness: an inverted cross product or winding turning the terrain inside out

After each fix re-run bootcheck.py and LOOK at ${GAME}\\_shots\\bootcheck.png. Report honestly:
if it still does not render, say so and say exactly what is failing. Never claim OK you have
not observed.`,
    { label: `boot:attempt${attempt}`, phase: 'Boot', effort: 'high', schema: BOOT_SCHEMA }
  )
  log(`boot attempt ${attempt}: booting=${boot && boot.booting} renders=${boot && boot.renders}`)
  if (boot && boot.booting && boot.renders) break
}

return { waveA, waveB, waveC, integrate, boot }
