export const meta = {
  name: 'snowflow-finish',
  description: 'Close the five defects that survived four blind critic rounds, then verify with a fresh blind round on the affected shots plus regression controls',
  phases: [
    { title: 'Repair', detail: 'three owners, each with precisely located defects' },
    { title: 'Verify', detail: 'reshoot, blind-pair, and re-judge affected shots + controls' },
    { title: 'Score', detail: 'reveal and report' },
  ],
}

const GAME = String.raw`C:\Users\TestRun\Claude Claw\forgeflow-games\games\snowflow`
const REF = String.raw`C:\Users\TestRun\AppData\Local\Temp\claude\C--Users-TestRun-Claude-Claw\7a2e6b97-6e7f-44b3-82c7-2af10752e605\scratchpad\snowflow_demo`
const HARNESS = `${GAME}\\_harness`
const URL = 'http://localhost:8799/games/snowflow/index.html'

// Affected shots, plus 01/13 as regression controls: those two are currently at
// parity, so if a repair breaks the shared snow or post path it shows up there.
const SHOTS = ['05-trail-berms', '09-spell-bloom', '10-spell-crystallize',
               '11-spell-vortex', '01-hero', '13-char-closeup']

const COMMON = `
PROJECT: the Three.js/WebGL2 port of the SNOWFLOW WebGPU demo, at ${GAME}.
Contract: ${GAME}\\ARCHITECTURE.md   Specs: ${GAME}\\_spec\\   Reference source: ${REF}\\src

STATE: after four rounds of blind critic comparison the port is at OBJECTIVE PARITY with the
reference on all 14 shots — mean |delta| across the battery is luma 0.0020, detail_energy
0.00060, shadow_blue_bias 0.0030. Terrain, snow, sky, shadows and deformation are done. The
port now WINS two shots outright (06-surf-wake, 08-spell-ribbon).

Only a handful of localised defects remain. You are closing yours. This is precision work on
a finished system, NOT a redesign.

RULES
 · Fix the generator, not the artifact. Read your spec and the reference source; most of what
   is left is a wrong constant, a missing decode, or a missing term.
 · Do NOT regress what works. The snow, sky, shadow and post paths are at measured parity —
   if your fix touches shared code, say so explicitly in your report.
 · Never invent a constant. It comes from ${GAME}\\_spec\\ or the reference source.
 · Nothing allocates in the render loop.
 · Verify by LOOKING. Reshoot your shot and open the PNG:
     cd "${HARNESS}" && python shoot.py --url "${URL}" --out "${GAME}\\_shots\\port" --shots <shot>
   Compare against ${GAME}\\_shots\\ref\\<shot>.png. Report before/after honestly; if it is
   still wrong, say it is still wrong.
 · Sanity-check first: cd "${HARNESS}" && python modulecheck.py
`

phase('Repair')
const repairs = await parallel([
  () => agent(`${COMMON}
YOU OWN character-cloth: src/character/{build,figure,character,controller,cloth}.js,
src/shaders/{char,cloth,fur}.glsl.js, src/shaders/lib/charSkin.glsl.js

DEFECT 1 — BLOCKER. In 05-trail-berms there is a detached, unlit, near-black geometry
fragment at the hero's feet: roughly x 554-559, y 492-498, reading RGB 10/3/0 against snow at
129/129/123. It is a SEPARATE connected component from the character silhouette — a stray
triangle or a degenerate/unskinned vertex, not a shadow. Find what emits it. Prime suspects:
a boot or hem ring whose vertices fall outside the bone-weight table and collapse to the
origin-adjacent bind position; a lofted cap left unwelded; or a cloth node that escaped its
constraint and is being rendered anyway. Track it down in the geometry build rather than
hiding it with an alpha test.

DEFECT 2. In 11-spell-vortex the cloak albedo is wrong: the port reads 0.397/0.395/0.367
where the reference reads 0.127/0.143/0.186. Two things are wrong at once — the value is
lifted about 3x, and the hue is flipped from the reference's cool blue-leaning navy to a
neutral-warm grey.

Strong lead: this is almost certainly a MISSING sRGB->LINEAR DECODE on a hard-coded albedo
constant. Note that linearising 0.397 gives ~0.13, which is the reference's red channel
almost exactly. Per ARCHITECTURE.md §6 everything is linear until the tonemap, so an albedo
authored as an sRGB-looking triple must be decoded once at the source. Check every hard-coded
colour on the character materials, decode the ones that were authored in sRGB, and confirm
the reference's own value and colour space in ${REF}\\src\\character\\ before you change it —
if the reference stores it already-linear, match that instead. Report which it was.

Check whether the same undecoded-constant mistake appears on the other character materials
(body, cloth, fur) even where no critic flagged it.`,
    { label: 'fix:character-cloth', phase: 'Repair', effort: 'high' }),

  () => agent(`${COMMON}
YOU OWN spells: src/spells/*.js, src/shaders/{water,crystal}.glsl.js,
src/shaders/lib/{water,crystal,spellLights}.glsl.js

DEFECT 1. In 09-spell-bloom the crystal renders as a CONSTANT-ALPHA MILKY SLAB — flat opacity
across the whole form, no facet shading, no thickness variation, and no contact occlusion
where it meets the snow. The reference reads as ice: hard flat facets with distinct
lit/lee faces, alpha varying with path length through the body, and a visible darkening
where the form sits into the surface.

Per _spec/spells.md the facet normals must come from SCREEN-SPACE DERIVATIVES of world
position (dFdx/dFdy), which is what makes every facet exactly flat and every edge exactly
hard — if the shader is smooth-shading interpolated normals you get precisely this milky
look. Absorption over path length gives the thickness tint. Verify the prisms are
alpha-blended AND depth-writing, in that specific combination, so snow shows through the ice
but never one prism through another.

DEFECT 2. In 10-spell-crystallize the blades are too thin to hold a lit/lee facet break —
each shard reads as a single flat sliver rather than a prism with distinguishable faces.
Check the hex prism radius and the golden-angle spiral placement against the spec's numbers.
Do not simply scale them up by eye: find the constant that is wrong.`,
    { label: 'fix:spells', phase: 'Repair', effort: 'high' }),

  () => agent(`${COMMON}
YOU OWN post-core: src/core/camera.js, src/post/postChain.js, src/ui/overlay.js,
src/shaders/post/*.glsl.js, src/shaders/lib/postCommon.glsl.js

DEFECT. In 09-spell-bloom a broad VEILING GLOW washes across the frame and flattens
mid-ground micro-contrast. The reference's bloom is tight and selective — per its own design
note, thresholded so that only the sun disc, the glints and lit spray reach it. A wide, low
haze over the whole image means the threshold is admitting far too much of the frame, or the
bloom is being composited at too high a weight, or the blur pyramid is spreading energy much
further than three levels should.

Note a documented subtlety before you change anything: _spec/post-core.md §6.6 records that
the reference's bright pass is described in its own comments as thresholding in "exposed
units", but the code actually binds the raw pre-exposure resolved scene, and S.exposure
appears in exactly one shader. The spec marks the CODE as normative. So match what the
reference's code does, not what its comment claims — and say in your report which you matched.

Verify the fix does not dim the sun disc or the glints, which are supposed to bloom. The
regression control is 01-hero: its bloom is currently at parity and must stay there.`,
    { label: 'fix:post-core', phase: 'Repair', effort: 'high' }),
])

phase('Verify')
const capture = await agent(
  `Reshoot and blind-pair the SNOWFLOW port for a verification round.

1. cd "${HARNESS}" && python modulecheck.py     (must be broken=0 chunk-errors=0)
2. cd "${HARNESS}" && python bootcheck.py       (must print RESULT: OK)
3. Reshoot exactly these shots — four repaired plus two regression controls:
     python shoot.py --url "${URL}" --out "${GAME}\\_shots\\port" --shots ${SHOTS.join(',')}
4. python compare.py --seed 5

Report: any shot that failed to capture, every console error verbatim, and confirm the six
blind pairs exist. Do NOT read or report key.json.`,
  { label: 'capture:verify', phase: 'Verify' }
)

const VERDICT = {
  type: 'object', additionalProperties: false,
  required: ['shot', 'better', 'confidence', 'why'],
  properties: {
    shot: { type: 'string' },
    better: { type: 'string', enum: ['A', 'B', 'TIE'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    why: { type: 'string' },
    remainingDefects: { type: 'array', items: { type: 'string' } },
  },
}

const verdicts = (await parallel(SHOTS.map(s => () => agent(
  `You are a PRINCIPAL RENDERING ARTIST doing a blind side-by-side. You are famously hard to
please and your reputation rests on never calling something AAA when it is merely competent.

In ${GAME}\\_shots\\blind\\${s} there are two renders of the same scene from two different
engines: A.png and B.png (full 1280x720 frames), A_crop.png and B_crop.png (the same region
of each, magnified 3x), and stats.json (mean/std luma, clipped/crushed percentages,
detail_energy = mean |gradient|, shadow_blue_bias = B-R in the darkest quartile).

READ ALL FIVE FILES. The crops are where a port usually falls apart.

THIS IS BLIND AND MUST STAY BLIND. One is a mature WebGPU tech demo, the other an in-progress
Three.js port. You are NOT told which. Do NOT read key.json, do NOT read anything outside
that directory, do NOT read any source code. If you catch yourself reasoning "the port
probably..." then stop — that is contamination.

SHOT: ${s}

Judge: tonemap and highlight rolloff; snow micro-structure and whether it survives into the
distance; shadow penumbra behaviour and contact hardness; whether there is real subsurface
transport or only N-dot-L; sky gradient and aerial perspective; geometry, seams, aliasing and
shimmer; the figure's cloth, hem contact and fur; and above all anything present in one frame
and simply MISSING from the other.

Return:
  better      "A", "B" or "TIE". TIE only if you genuinely cannot pick, never as a hedge.
  confidence  how sure you are that you can TELL THEM APART AT ALL. 1.0 = one is obviously
              amateur beside the other. 0.0 = you honestly cannot distinguish them. Be
              calibrated; a dishonest low number defeats the entire exercise.
  why         2-4 concrete sentences naming what you saw and where.
  remainingDefects  every specific way the worse frame falls short, with image coordinates.
              Describe it as a property of "the worse frame" — never guess which engine it is.
              Empty array if they are genuinely equivalent.`,
  { label: `critic:${s}`, phase: 'Verify', schema: VERDICT, effort: 'high' }
)))).filter(Boolean)

phase('Score')
const scored = await agent(
  `Reveal the blind key and score this verification round.

Verdicts (judged blind; A/B are per-shot randomised):
\`\`\`json
${JSON.stringify(verdicts, null, 2)}
\`\`\`

1. Write them reshaped as { "<shot>": {"better":..., "confidence":..., "why":...} } to
   ${GAME}\\_shots\\blind\\verdicts_r5.json
2. cd "${HARNESS}" && python compare.py --reveal --verdicts "${GAME}\\_shots\\blind\\verdicts_r5.json"
3. Read ${GAME}\\_shots\\blind\\key.json to resolve which side was the port per shot.
4. Recompute the objective deltas so the report carries numbers, not just opinion:
   compare each port frame in ${GAME}\\_shots\\port against its row in
   ${GAME}\\_shots\\ref\\baseline_stats.json for mean_luma, detail_energy and
   shadow_blue_bias.

CRITICAL — 01-hero and 13-char-closeup are REGRESSION CONTROLS. They were at parity before
these repairs. If either got worse, that is the single most important finding in this round
and must lead your report.

Append one line to ${GAME}\\_shots\\SCOREBOARD.md in the established format.

Report: per shot, whether the PORT won / tied / lost and at what confidence; whether each of
the five targeted defects is actually closed (judged from the critics' remainingDefects, not
from the repair agents' claims); any regression on the controls; and the objective deltas.`,
  { label: 'score:verify', phase: 'Score', effort: 'high' }
)

return { repairs, capture, verdicts, scored }
