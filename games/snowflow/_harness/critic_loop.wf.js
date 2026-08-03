export const meta = {
  name: 'snowflow-critic-loop',
  description: 'Shoot the Three.js port, blind-compare every frame against the WebGPU reference with a harsh critic, and fan out fixes until the port is indistinguishable or better',
  phases: [
    { title: 'Capture', detail: 'shoot the port and build blind A/B pairs' },
    { title: 'Critique', detail: 'one blind critic per shot — which is better, and why' },
    { title: 'Score', detail: 'reveal the key and route defects to owning subsystems' },
    { title: 'Repair', detail: 'fan out fixers, one per subsystem with open defects' },
  ],
}

// ---------------------------------------------------------------- parameters
const GAME = String.raw`C:\Users\TestRun\Claude Claw\forgeflow-games\games\snowflow`
const HARNESS = `${GAME}\\_harness`
const URL = 'http://localhost:8799/games/snowflow/index.html'

const A = args || {}
const MAX_ROUNDS = A.rounds || 4
const SHOT_FILTER = A.shots || ''          // '' = the whole battery
const START_ROUND = A.startRound || 1

// The eight owners from ARCHITECTURE.md §1. The critic must classify every
// defect into exactly one of these, so routing needs no judgement later.
const OWNERS = {
  'terrain-snow': 'src/terrain/{heightfield,clipmapMesh,terrain}.js, src/shaders/snow.*, src/shaders/lib/{noise,terrain,clipmap,shading}.glsl.js, the detail/aux bakes',
  'sky': 'src/render/sky.js, src/shaders/sky.*, src/shaders/skyBake.*, src/shaders/lib/atmosphere.glsl.js, the raymarched far range',
  'shadows': 'src/render/shadows.js, src/render/depthPass.js, src/shaders/lib/shadowLookup.glsl.js, every *Depth / *Prepass variant',
  'deform': 'src/terrain/deformation.js, src/character/snowContact.js, src/shaders/deformSim.*, src/shaders/lib/deform.glsl.js',
  'character-cloth': 'src/character/{build,figure,character,controller,cloth}.js, src/shaders/{char,cloth,fur}.*, src/shaders/lib/charSkin.glsl.js',
  'wake': 'src/vfx/{surfWake,particles}.js, src/shaders/{wake,spray}.*, src/shaders/lib/wake.glsl.js',
  'spells': 'src/spells/*.js, src/shaders/{water,crystal}.*, src/shaders/lib/{water,crystal,spellLights}.glsl.js',
  'post-core': 'src/core/camera.js, src/post/postChain.js, src/ui/overlay.js, src/shaders/post/*, src/shaders/lib/postCommon.glsl.js',
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shot', 'better', 'confidence', 'why', 'defects'],
  properties: {
    shot: { type: 'string' },
    better: { type: 'string', enum: ['A', 'B', 'TIE'] },
    // How sure the critic is it can TELL THEM APART at all. 1.0 = obvious which
    // is the amateur one; 0.0 = genuinely could not distinguish them.
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    why: { type: 'string' },
    aaa: { type: 'boolean' },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['owner', 'severity', 'what', 'evidence', 'fix'],
        properties: {
          owner: { type: 'string', enum: Object.keys(OWNERS) },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          what: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const CRITIC_BRIEF = (shot, dir) => `
You are a PRINCIPAL RENDERING ARTIST doing a blind side-by-side. You are famously hard to
please. Your reputation rests on never calling something AAA when it is merely competent.

In ${dir} there are two renders of the same scene, from two different engines:
  A.png       B.png        the full 1280x720 frames
  A_crop.png  B_crop.png   the same region of each, magnified 3x for detail
  stats.json  objective per-frame statistics (mean/std luma, clipped/crushed
              percentages, detail_energy = mean |gradient| i.e. how much fine
              surface detail survives, shadow_blue_bias = B-R in the darkest quartile)

READ ALL FIVE FILES. Look at the crops carefully — that is where a port usually falls apart.

THIS IS BLIND AND MUST STAY BLIND. One of these is a mature WebGPU tech demo; the other is
an in-progress Three.js port. You are NOT told which. Do not try to find out:
  - do NOT read key.json, and do NOT read anything outside ${dir}
  - do NOT read the port's source code
  - judge ONLY what you can see in the two images plus stats.json
If you catch yourself reasoning "the port probably..." — stop, that is contamination.

SHOT: ${shot}
This shot exists to exercise specific systems. Judge those hardest, but judge everything.

WHAT TO COMPARE — be specific and physical, not vibes:
  · Tonemap and exposure: are highlights rolled off or clipped flat? are shadows
    lifted with real colour in them, or crushed to black? is there a filmic curve
    or a linear ramp?
  · Snow micro-structure: sastrugi, wind ripples, three scales of grain. Does the
    surface hold detail into the distance, or dissolve into a smooth plastic sheet?
    Cross-check detail_energy in stats.json against what you actually see.
  · Shadow quality: does the penumbra widen with distance from the contact point,
    or is it a uniform blur? Is the contact point sharp? Any banding, acne, peter-panning,
    or a visible cascade seam?
  · Subsurface: is there real light transport through snow — a blue-shifted core in
    shadowed lee faces, a warm bleed near crests — or is the shading just N·L?
  · Sky and aerial perspective: does the horizon warm correctly toward the sun? Does
    haze accumulate with distance so far ridges sit BEHIND near ones? Any banding?
  · Silhouettes and geometry: is the terrain LOD seam-free? Any popping, cracks,
    z-fighting, shimmer, or aliasing crawling on high-frequency detail?
  · The figure: cloth folds, hem contact with the snow, fur, weave. Does it read as
    simulated, or as a rigid mesh with a normal map?
  · Effects present in one frame and simply MISSING in the other. A missing system is
    the most severe defect there is — say so loudly.

THEN DECIDE:
  better      "A", "B", or "TIE". TIE only if you genuinely cannot pick — not as a hedge.
  confidence  how confident you are that you can TELL THEM APART at all.
              1.0 = one is obviously amateur next to the other.
              0.0 = you honestly cannot distinguish them.
              Be honest and calibrated. A dishonest 0.2 here defeats the whole exercise.
  aaa         true ONLY if BOTH frames would ship in a shipping AAA title. Hold this bar.
  why         2-4 sentences, concrete, naming what you actually saw and where.
  defects     Every way the WORSE frame falls short of the better one. For each, set
              \`owner\` to the subsystem responsible, \`evidence\` to where in the image
              you see it ("upper-left dune face, the ripples vanish past ~40 m"), and
              \`fix\` to what you would actually change. Describe the defect as a property
              of "the worse frame" — never guess which engine it is.
              If the two are genuinely equivalent, return an empty defects array.

Owner taxonomy (pick exactly one per defect):
${Object.entries(OWNERS).map(([k, v]) => `  ${k}: ${v}`).join('\n')}
`

// ------------------------------------------------------------------- the loop
const history = []

for (let round = START_ROUND; round < START_ROUND + MAX_ROUNDS; round++) {
  phase('Capture')
  const capture = await agent(
    `Capture this round's frames from the SNOWFLOW Three.js port and build the blind pairs.

1. Confirm the dev server is serving the game:
     curl -s -o /dev/null -w "%{http_code}" ${URL}
   If it is not 200, start it (background, from the repo root):
     python "C:\\Users\\TestRun\\Claude Claw\\forgeflow-games\\serve_nocache.py" 8799

2. Shoot the port:
     cd "${HARNESS}"
     python shoot.py --url "${URL}" --out "${GAME}\\_shots\\port"${SHOT_FILTER ? ` --shots ${SHOT_FILTER}` : ''}
   This takes several minutes — it reloads the page per shot. Let it finish.

3. Read "${GAME}\\_shots\\port\\console.log" and the manifest, and report EVERY page error
   or WebGL warning verbatim. These matter more than anything else: a shot that rendered
   a black frame because a shader failed to compile must be reported as such, not scored.

4. Build the blind pairs with this round's seed (${round}):
     python compare.py --seed ${round}

Report, with total fidelity:
  - how many shots captured vs how many were requested, and which FAILED and why
  - every console error / shader compile failure, quoted verbatim
  - the list of shot names that now have a blind pair in ${GAME}\\_shots\\blind\\
  - whether any port frame is obviously broken (all black, all white, missing geometry) —
    check by reading a couple of the port PNGs directly
Do NOT read or report key.json.`,
    { label: `capture:r${round}`, phase: 'Capture' }
  )

  // Ask an agent for the shot list rather than guessing it in the script: a shot
  // that failed to capture has no pair, and critiquing a missing pair wastes a run.
  const listing = await agent(
    `List the shot directories under ${GAME}\\_shots\\blind\\ that contain BOTH A.png and B.png
and a non-empty stats.json. Return them as JSON. Do not read key.json.`,
    {
      label: `list:r${round}`, phase: 'Capture',
      schema: {
        type: 'object', additionalProperties: false, required: ['shots'],
        properties: { shots: { type: 'array', items: { type: 'string' } } },
      },
    }
  )
  const shots = (listing && listing.shots) || []
  log(`round ${round}: ${shots.length} blind pairs to judge`)
  if (!shots.length) {
    log(`round ${round}: nothing to judge — the port produced no comparable frames`)
    history.push({ round, shots: 0, capture })
    break
  }

  phase('Critique')
  const verdicts = (await parallel(shots.map(s => () =>
    agent(CRITIC_BRIEF(s, `${GAME}\\_shots\\blind\\${s}`),
      { label: `critic:${s}`, phase: 'Critique', schema: VERDICT_SCHEMA, effort: 'high' })
  ))).filter(Boolean)

  phase('Score')
  const scored = await agent(
    `Reveal the blind key and score this round.

The critics returned these verdicts (each judged blind; "A"/"B" are per-shot randomised sides):
\`\`\`json
${JSON.stringify(verdicts, null, 2)}
\`\`\`

1. Write exactly that JSON, reshaped as { "<shot>": {"better": ..., "confidence": ..., "why": ...} },
   to ${GAME}\\_shots\\blind\\verdicts_r${round}.json
2. Run:  cd "${HARNESS}" && python compare.py --reveal --verdicts "${GAME}\\_shots\\blind\\verdicts_r${round}.json"
3. Read ${GAME}\\_shots\\blind\\key.json to resolve, per shot, whether "A" was the reference
   or the port.

Now produce the routing table. For each shot state whether THE PORT won, tied, or lost, and
carry across the defects the critic raised. Critically: a defect describes "the worse frame".
Resolve which engine that was. **Only defects that describe the PORT are actionable** — a
defect describing the reference means the port is already ahead there, and must be dropped
from the repair list (note it as a strength instead).

Also append a one-line summary of this round to ${GAME}\\_shots\\SCOREBOARD.md
(create it if absent) in the form:
  round N · port wins X/Y · ties Z · indistinguishable-or-better W/Y · top open defect: ...

Return the structured result.`,
    {
      label: `score:r${round}`, phase: 'Score', effort: 'high',
      schema: {
        type: 'object', additionalProperties: false,
        required: ['portWins', 'ties', 'refWins', 'total', 'converged', 'openDefects'],
        properties: {
          portWins: { type: 'number' }, ties: { type: 'number' },
          refWins: { type: 'number' }, total: { type: 'number' },
          // true only when no shot still shows a confidently-better reference
          converged: { type: 'boolean' },
          summary: { type: 'string' },
          openDefects: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['owner', 'severity', 'shot', 'what', 'fix'],
              properties: {
                owner: { type: 'string' }, severity: { type: 'string' },
                shot: { type: 'string' }, what: { type: 'string' },
                evidence: { type: 'string' }, fix: { type: 'string' },
              },
            },
          },
        },
      },
    }
  )

  history.push({ round, scored })
  log(`round ${round}: port ${scored.portWins}/${scored.total} · ties ${scored.ties} · ` +
      `ref ${scored.refWins} · ${scored.openDefects.length} open defects`)

  if (scored.converged && !scored.openDefects.some(d => d.severity !== 'minor')) {
    log(`round ${round}: CONVERGED — the port is indistinguishable or better on every shot`)
    break
  }

  // -------------------------------------------------------------- repair
  phase('Repair')
  const byOwner = {}
  for (const d of scored.openDefects) (byOwner[d.owner] ||= []).push(d)
  const owners = Object.keys(byOwner).filter(o => OWNERS[o])
  log(`round ${round}: repairing ${owners.length} subsystems — ${owners.join(', ')}`)

  await parallel(owners.map(owner => () => agent(
    `You own the **${owner}** subsystem of the SNOWFLOW Three.js port.
Files you own: ${OWNERS[owner]}
Root: ${GAME} · Contract: ${GAME}\\ARCHITECTURE.md · Your spec: ${GAME}\\_spec\\ (read the
document(s) covering ${owner} — they hold the reference's exact constants and formulas).

A blind critic compared the port against the WebGPU reference frame by frame and raised these
defects against YOUR subsystem:

\`\`\`json
${JSON.stringify(byOwner[owner], null, 2)}
\`\`\`

For each defect:
 1. Look at the evidence yourself. Open ${GAME}\\_shots\\port\\<shot>.png and
    ${GAME}\\_shots\\ref\\<shot>.png and compare the region the critic named. You are no
    longer blind — the ref/ directory IS the reference.
 2. Find the GENERATOR of the defect in your code. Re-read the relevant section of your spec
    and check the port against the reference's actual constants and formulas. Most defects at
    this stage are a wrong constant, a missing term, or a handedness/sign flip — not a missing
    feature. Fix the cause, not the symptom.
 3. If a defect is NOT real, or is not yours, say so explicitly with the file:line that
    disproves it. Do not make a change you cannot justify.

HARD RULES:
 - Edit ONLY files you own. Note anything you need from another subsystem in your report.
 - Never invent a constant. Values come from ${GAME}\\_spec\\. If the spec lacks it, read the
   reference source at ${String.raw`C:\Users\TestRun\AppData\Local\Temp\claude\C--Users-TestRun-Claude-Claw\7a2e6b97-6e7f-44b3-82c7-2af10752e605\scratchpad\snowflow_demo`}.
 - Do not regress what already works. Do not "simplify" a system to make a defect go away.
 - Nothing allocates in the render loop.
 - Verify your change: reshoot at least one affected shot and LOOK at the PNG.
     cd "${HARNESS}" && python shoot.py --url "${URL}" --out "${GAME}\\_shots\\port" --shots <shot>
   Report the before/after honestly. If it is still wrong, say it is still wrong.

Report: each defect, what you changed (file:line), what you verified by looking, and what
remains broken.`,
    { label: `fix:${owner}:r${round}`, phase: 'Repair', effort: 'high' }
  )))
}

return { history }
