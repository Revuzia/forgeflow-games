export const meta = {
  name: 'vale-closing-parity-review',
  description: 'Closing VALE vs League-of-Legends parity review (gauge only) after the fix waves and integration: 8 dimensions + a per-fighter art review of all 16, adversarial verify of every blocker/major, scorecard and par verdict, completeness critic',
  phases: [
    { title: 'Review', detail: 'one demanding reviewer per dimension, measured fresh with the repo harnesses' },
    { title: 'Verify', detail: 'an adversarial verifier per dimension tries to refute every blocker/major and re-measures' },
    { title: 'Characters', detail: 'one art reviewer + adversarial verifier per fighter (16)' },
    { title: 'Synthesis', detail: 'scorecard, par verdict per dimension, r12 gap status, fix list; commit' },
    { title: 'Critic', detail: 'completeness critic: what was not measured, which claims are unverified' },
  ],
}

const REPO = '/Users/sitskovich/Developer/forgeflow-games/games/vale'
const ENV = 'export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH; export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'

const RULES = `PROJECT: VALE, an original 3D lane-brawler (MOBA) in ${REPO} (branch claude/youthful-ramanujan-gdud5w). The owner's bar: League-of-Legends-level quality, 100% original. LoL is ONLY A GAUGE of quality and polish: never propose copying a LoL champion, ability, item, effect, icon, UI layout detail or name; suggested fixes must be VALE's own (see _design/STYLE_BIBLE.md, _design/WORLD.md). The gauge is _design/research/r12_lol_parity_benchmark.md (measured LoL numbers, sources, and the gap list B1-B5 / M1-M14 / m1-m5 that later waves claim to have fixed) plus r04 (HUD/camera), r05 (client flow), r06 (art direction), r07 (audio), r09 (bots). You may use WebSearch for a specific LoL fact, but never download video and never save any LoL image into the repo.
SENSITIVITY (blocker class anywhere in the game): no tall, pointed or conical hoods; no masks/faces that read as horror, hockey mask or blank mannequin; Wicks (lane minions) have no face (no eye-like light pairs, no mouth).
STATE: this is the CLOSING review. Since the final review (_design/reviews/final_parity_review.md, scores in final_parity_open.json, per-dimension evidence in _design/reviews/final/<dim>.json) six fix waves and two integration runs landed; their verdicts are _design/reviews/fixwaves/<wave>_verify<n>.json and integ*_<lane>_verify<n>.json, the whole-build gate is integ_gate_verify.json, and final_parity_open.json now carries a status per item. All 16 fighters are final Art 2.0 models (including Ilsheta). Owner rulings (binding): _design/reviews/fixwaves/owner_rulings.md. Do not trust any of these reports: measure the current build yourself. Do not re-report a problem the verdicts show fixed unless you reproduce it now.
PAR BAR: a dimension is ON PAR when a player who knows League of Legends would accept it as the same tier: verified score >= 8/10 AND no confirmed blocker or major open.
MACHINE LIMITS (10-core / 16 GB Mac shared with other agents): Blender, harness Chrome (_harness/pw.mjs) and three_snapshot queue for 3 machine-wide heavy slots; a "[heavy] ... waiting" line is normal — wait, never kill or bypass it. Run ONE harness/Blender at a time from your agent, long runs with a generous Bash timeout (up to 600000 ms) or in the background with a log. Use the repo harnesses on the real Chrome GPU (never write your own swiftshader renderer). Never stop the dev server on :5190 (start it only if down: \`cd ${REPO} && npm run dev -- --port 5190 > /tmp/vale_dev.log 2>&1 &\`); a GUI Blender the owner opened may be running — leave it.
FILES: do NOT edit source, content, art or docs. Put your shots in _harness/_shots/closing_<dimension or fighter>_* and measurements in _harness/_reports/closing_<dimension or fighter>_* (both git-ignored), scratch in your scratchpad. Env for node: \`${ENV}; cd ${REPO}\`.
NO HANGS: never run a command that can block forever (tail -f, watch, a pipe or heredoc waiting on stdin, an interactive prompt, a foreground server). Long runs go in the background with a log and a bounded poll loop. Kill any helper process you started before you finish. Tracked files under _harness/_reports (value_probe.json, perf_1080.json, ambient.json, shot_lane.json) must be restored with \`git checkout -- <that file>\` after a run that rewrites them; use your own --tag/--out where the harness allows.
SECRETS: never print any key or token. NO DEPLOY of any kind.
EVIDENCE: every finding cites a reproducible artifact (shot path, report path, command, file:line) and states what LoL does (the gauge) versus what VALE does now. Prefer measurement to opinion.`

const DIMS = {
  env: { title: 'Maps & environment', lens: `The three maps RIFT, BRIDGE, FRAY at the gameplay camera: painted terrain and lanes, landmarks, structures (M9: scale, damage states, collapse, occlusion), foliage and brush (M11), ambient life (M14), lighting/sky/fog of war, value hierarchy (B5: the ground leaves the top of the value range to fighters, effects, UI), team-side readability, base identity. Tools: \`node _harness/shot_map.mjs <map> --q high\`, shot_lane.mjs, value_probe.mjs, shot_structures.mjs, shot_ambient.mjs, shot_foliage.mjs (read each file's header for usage). Gauge: LoL Summoner's Rift's painterly readability at gameplay zoom (r12 §2 rows for environment).` },
  combat: { title: 'Combat feel & VFX', lens: `What a fight looks and feels like: basic attacks (M5: weight, speed, impact), casts with anticipation (M3), telegraphs/aim indicators (B2) and ground warnings (M1: lead time, visibility to enemies), crowd-control visuals and names (M2), hit reactions (M6), per-fighter effect identity (M12), ultimate impact envelope (M13), camera shake (m4), distortion/secondary shapes (m5), death and recall. Tools: \`node _harness/shot_fight.mjs\`, vfx_gallery.mjs (per fighter prefix), ab_frames.mjs, shot_fighter.mjs (read headers). Watch at least 4 different fighters' full kits in a live match. Gauge: LoL's attack/cast timing and VFX clarity numbers in r12.` },
  hud: { title: 'HUD & in-match readability', lens: `The in-match HUD and overlays: ability bar with cooldowns/charges/costs and refused presses (M4), item slots and ITEM ICON art, the in-match shop, minimap (m3: portraits, pings, fog), scoreboard/tab, overhead HP/resource bars and names (M7), unit outlines (M10), Dial Bar states (m1), death/level-up/kill banners (m2), hover (B1), status/buff display, timers, tooltips with keyword and scaling highlighting, self trail. The owner explicitly asked for a much better minimap, images for items and the toolbar — judge those hard. Tools: \`node _harness/hud_renders.mjs\`, overlay_regress.mjs, shot_fight.mjs, e2e.mjs --headed for live captures (read headers). Gauge: r04 + r12 HUD rows.` },
  client: { title: 'Menus & client flow', lens: `Every client screen outside the match: Home, Play / Mode Dial, queues, ready check, draft / Lot / pick, loading, post-game with grants, store, collection/equip, profile, settings, practice. Judge painted art, motion and transitions, copy quality (rich, consistent, typo-free), information hierarchy, friction (clicks to a match), empty/error states, responsiveness at 1280x720 and 1920x1080. The owner asked for "painted art, motion and rich copy" in menus. Tools: \`node _harness/e2e.mjs all\` (read its header; it drives the whole journey) and your own pw.mjs captures of each screen. Gauge: r05 + the LoL client's flow (screens, clicks, polish).` },
  perf: { title: 'Performance & stability', lens: `The r12 B4 gate and stability: \`node _harness/perf_1080.mjs --prod --wait-idle 30\` (the gate is the --prod run; dev mode is known to fail on a stale Vite transform — not a finding), \`npm run typecheck\`, \`npm run content:check -- --allow-missing-assets\` (strict content:check, without the flag, must also pass now), \`node _harness/run_probes.ts\`, \`node _harness/e2e.mjs all\`, console errors/warnings during a full match, JS heap and GPU memory growth over a long match (>= 15 game minutes at speed; take heap samples), load time to first interactive and match load time, total download size of the production build and its biggest assets. Gauge: LoL's 60 fps target on mid hardware, r12 B4 numbers.` },
  audio: { title: 'Audio', lens: `Audio coverage and quality: every ability/basic attack/hit/death/level-up/structure/objective/UI event has a cue (check content audio.events against kits), mix balance (combat vs music vs UI), spatial attenuation, music beds and combat layers, stings, Safari .m4a fallback, no clipping or harshness. Tools: \`node _harness/audio_probe.mjs\` (read header), audio/build.py outputs, listen-level analysis of the rendered files (loudness, peaks with python/numpy from the venv ~/Developer/forgeflow-games/.venv/bin/python3). Gauge: r07 + LoL's audio clarity (distinct per-champion cast sounds, readable threat cues).` },
  gameplay: { title: 'Gameplay, bots & pacing', lens: `Does a match play like a good lane-brawler: \`node _harness/pacing.ts --seeds 10\` (match length, kills, objectives, comebacks per mode vs the gauge), bot behaviour (laning, last hits, retreats, teamfights, objective play; watch one bot match with shot_fight/e2e), kit distinctness and cooldown/number sanity across the 16 fighters (content/fighters/*.json, items, spells), mode rules RIFT/BRIDGE/FRAY, practice mode, draft rules. Mostly sim-side: no Chrome needed except to watch. Gauge: r02, r03, r09 and LoL's match pacing numbers.` },
  originality: { title: 'Originality, legal & sensitivity audit', lens: `An audit, not a quality review: (1) every player-facing name (fighters, abilities, items, spells, boons, units, maps, modes, currencies, ranks, strings in content/strings*) against _design/research/protected_names.json and _design/NAMES_NOT_USED.md; (2) each fighter kit and item effect against LoL's well-known champions/items for copying (a gauge relationship is fine; a recognisable copy is a blocker); (3) icons, key art, splashes and concept sheets in the repo for anything copied or derivative, and for the sensitivity rules (look at the images: art/out, public/, _design/concept); (4) UI layouts that clone a LoL screen pixel-for-pixel; (5) committed secrets (grep for API keys/tokens: pipeline/meshy_chars.py is a known hard-coded key — report it as still present if so). Tools: grep, python, Read on images. No Chrome needed.` },
}

const SCHEMA_REVIEW = { type: 'object', properties: {
  score: { type: 'number', description: '1-10: 10 = indistinguishable in quality from LoL for this dimension' },
  summary: { type: 'string' },
  gapStatus: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['closed', 'partly', 'open', 'regressed', 'not_measured'] }, evidence: { type: 'string' } }, required: ['id', 'status', 'evidence'] } },
  findings: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, title: { type: 'string' }, what: { type: 'string' },
    evidence: { type: 'string' }, gauge: { type: 'string', description: 'what LoL achieves here (as a quality bar, never a design to copy)' },
    fix: { type: 'string', description: 'an original VALE fix' }, files: { type: 'string' }, size: { type: 'string', enum: ['S', 'M', 'L', 'XL'] } },
    required: ['id', 'severity', 'title', 'what', 'evidence', 'gauge', 'fix', 'size'] } },
  notMeasured: { type: 'array', items: { type: 'string' } },
}, required: ['score', 'summary', 'gapStatus', 'findings'] }

const SCHEMA_VERIFY = { type: 'object', properties: {
  score: { type: 'number' }, summary: { type: 'string' },
  gapStatus: SCHEMA_REVIEW.properties.gapStatus,
  findings: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, verdict: { type: 'string', enum: ['confirmed', 'downgraded', 'refuted'] }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
    title: { type: 'string' }, what: { type: 'string' }, evidence: { type: 'string' }, gauge: { type: 'string' }, fix: { type: 'string' }, files: { type: 'string' },
    size: { type: 'string', enum: ['S', 'M', 'L', 'XL'] }, verifierNote: { type: 'string' } },
    required: ['id', 'verdict', 'severity', 'title', 'what', 'evidence', 'fix', 'size', 'verifierNote'] } },
  missed: { type: 'array', items: { type: 'string' }, description: 'blocker-class problems the reviewer missed, if you saw any' },
}, required: ['score', 'summary', 'gapStatus', 'findings'] }

const reviewPrompt = (k) => `${RULES}

You are the demanding FINAL PARITY REVIEWER for the dimension **${DIMS[k].title}**. The question: would a player who knows League of Legends accept VALE as a same-tier product in this dimension? Measure the CURRENT build yourself (do not trust earlier reports; they may be stale). The final review scored this dimension before the fixes (see _design/reviews/final/<dim>.json and the scores in final_parity_open.json): say explicitly what improved, what did not, and what regressed.
LENS: ${DIMS[k].lens}
For each r12 gap ID in your lens, set its status with fresh evidence. Then list findings: blocker = a LoL player would bounce / broken / sensitivity; major = clearly below the bar, must fix before calling it on par; minor = polish. Merge related problems; at most 10 blockers+majors, up to 10 minors, most important first. Each finding: evidence (artifact path + command), the LoL gauge, an ORIGINAL fix, likely files, size. Score 1-10. List what you could not measure in notMeasured.`

const verifyPrompt = (k, rv) => `${RULES}

You are the ADVERSARIAL VERIFIER for the final parity review of **${DIMS[k].title}**. A reviewer produced the findings below. Your job is to try to REFUTE each blocker and major: reproduce it yourself on the current build (re-run the command or capture again; look at the artifact), check whether the claim is real, whether the severity is right, and whether the gauge statement about LoL is accurate. Verdict per finding: confirmed (reproduced, severity right), downgraded (real but less severe: give the new severity), refuted (not reproducible, stale, measurement error, or a design choice the docs justify). Minors: keep them (verdict confirmed) unless clearly wrong. Correct the gapStatus list where your evidence disagrees. If you notice a blocker-class problem the reviewer missed, add it under missed. Default to refuting a blocker/major you cannot reproduce.
Then WRITE your verified result as JSON (the same object you return) to \`${REPO}/_design/reviews/closing/${k}.json\` (create the folder if needed; do not commit).
LENS for reference: ${DIMS[k].lens}

REVIEWER RESULT (score ${rv.score}): ${rv.summary}
Gap status: ${JSON.stringify(rv.gapStatus)}
Findings:
${rv.findings.map((f, i) => `${i + 1}. [${f.id} / ${f.severity} / ${f.size}] ${f.title} — ${f.what}\n   evidence: ${f.evidence}\n   gauge: ${f.gauge}\n   fix: ${f.fix}\n   files: ${f.files || ''}`).join('\n')}
Not measured by the reviewer: ${(rv.notMeasured || []).join('; ') || 'none listed'}`

async function dimension(k) {
  const rv = await agent(reviewPrompt(k), { label: `review:${k}`, phase: 'Review', schema: SCHEMA_REVIEW, agentType: 'general-purpose' })
  if (!rv) return { k, error: 'review failed' }
  const vf = await agent(verifyPrompt(k, rv), { label: `verify:${k}`, phase: 'Verify', schema: SCHEMA_VERIFY, agentType: 'general-purpose' })
  return { k, title: DIMS[k].title, review: rv, verified: vf }
}

const ROSTER = (args && args.fighters) || ['ardit', 'burdam', 'dunsom', 'ervet', 'hesmi', 'ilsheta', 'kemdo', 'lisvel', 'marund', 'nurrow', 'odrum', 'rishal', 'sukri', 'tunlan', 'ulkro', 'vashil']

const SCHEMA_FIGHTER = { type: 'object', properties: {
  fighter: { type: 'string' }, score: { type: 'number', description: '1-10 vs a recent LoL champion model + kit presentation at the same camera' },
  summary: { type: 'string' },
  findings: SCHEMA_REVIEW.properties.findings,
  openLeftovers: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, status: { type: 'string', enum: ['fixed', 'still_open', 'worse'] }, evidence: { type: 'string' } }, required: ['item', 'status', 'evidence'] } },
}, required: ['fighter', 'score', 'summary', 'findings', 'openLeftovers'] }

const fighterPrompt = (f) => `${RULES}

You are the demanding CHARACTER ART REVIEWER for the fighter **${f}**. The gauge: a recent League of Legends champion's model, animation and splash presentation at the same gameplay camera (quality bar only, never a design to copy). Judge the CURRENT build:
- At the gameplay camera, in a real match frame: silhouette readability, value and signature hue identity against the map and the other 15 fighters, team-colour read, material quality (stone, cloth, metal, glass read as such), the outline. Capture one fresh frame (three_snapshot / _harness/render_bench via the heavy queue) only if the newest renders in art/renders/fighters/${f}/ predate the last change to art/out/fighters/${f}/ (git log).
- Animation: idle, run, the attacks, every cast, the ultimate, death (three_clips_*.png, the clip names in the GLB): weight, anticipation, follow-through, no clipping or foot sliding visible at the camera.
- Face and sensitivity (blocker class): no tall/pointed/conical hood, no horror/hockey/plague-doctor/blank-mannequin face.
- Portrait, splash, face chip (art/out/fighters/${f}/portrait.png, splash.png, icon.png) and every skin's portrait and splash: framing, painting quality, legibility at use size.
- The brief (_design/fighters/${f}.md) and owner_rulings.md: does the model deliver what the brief promises?
- Leftovers: art/renders/fighters/${f}/_open.json: mark each item fixed / still_open / worse with evidence.
Findings: blocker = a LoL player would bounce / sensitivity; major = clearly below a LoL champion; minor = polish. At most 6 blockers+majors and 6 minors. Each: evidence path, the gauge, an ORIGINAL fix, files, size. Score 1-10.`

const fighterVerifyPrompt = (f, rv) => `${RULES}

You are the ADVERSARIAL VERIFIER of the character art review of **${f}**. Try to REFUTE each blocker and major: look at the cited artifacts yourself, re-capture if needed, check the severity and the gauge claim. Verdict per finding: confirmed / downgraded (new severity) / refuted. Keep minors unless clearly wrong. Re-score 1-10. Also check the reviewer's leftover statuses. Look for any sensitivity problem the reviewer missed (blocker class).
Then WRITE your verified result as JSON (the same object you return, plus "fighter") to \`${REPO}/_design/reviews/closing/fighters/${f}.json\` (create the folder; do not commit).
REVIEW (score ${rv.score}): ${rv.summary}
Findings: ${JSON.stringify(rv.findings).slice(0, 9000)}
Leftovers: ${JSON.stringify(rv.openLeftovers).slice(0, 3000)}`

async function fighter(f) {
  const rv = await agent(fighterPrompt(f), { label: `art:${f}`, phase: 'Characters', schema: SCHEMA_FIGHTER, agentType: 'general-purpose' })
  if (!rv) return { f, error: 'review failed' }
  const hasMajor = (rv.findings || []).some((x) => x.severity !== 'minor')
  const vf = await agent(fighterVerifyPrompt(f, rv), { label: `art-verify:${f}`, phase: 'Characters', schema: SCHEMA_VERIFY, agentType: 'general-purpose' })
  return { f, review: rv, verified: vf, hadMajor: hasMajor }
}

// lanes: three that drive the harness Chrome one heavy agent at a time, one sim/text lane, and the character lane (ART_PAR fighters at a time)
const LANES = args && args.lanes ? args.lanes : [['combat', 'hud'], ['env', 'perf'], ['client', 'audio'], ['originality', 'gameplay']]
const ART_PAR = (args && args.artPar) || 2
let nextF = 0
const fighterOut = []
const lanesDone = parallel([
  ...LANES.map((lane) => async () => {
    const out = []
    for (const k of lane) { out.push(await dimension(k).catch((e) => ({ k, error: String(e).slice(0, 300) }))); log(`${k} done`) }
    return out
  }),
  ...Array.from({ length: ART_PAR }, () => async () => {
    while (nextF < ROSTER.length) {
      const f = ROSTER[nextF++]
      const r = await fighter(f).catch((e) => ({ f, error: String(e).slice(0, 300) }))
      fighterOut.push(r); log(`art ${f} done (${fighterOut.length}/${ROSTER.length})`)
    }
    return []
  }),
])
const results = (await lanesDone).filter(Boolean).flat()

phase('Synthesis')
const compact = results.map((r) => {
  const v = r.verified, src = v || r.review
  if (!src) return { k: r.k, error: r.error || 'no result' }
  return { k: r.k, title: r.title, reviewScore: r.review && r.review.score, verifiedScore: v ? v.score : null, summary: src.summary, gapStatus: src.gapStatus,
    findings: (v ? v.findings.filter((f) => f.verdict !== 'refuted') : r.review.findings), refuted: v ? v.findings.filter((f) => f.verdict === 'refuted').map((f) => `${f.id} ${f.title}: ${f.verifierNote}`) : [],
    missed: v ? v.missed || [] : [], notMeasured: r.review ? r.review.notMeasured || [] : [] }
})
const arts = fighterOut.map((r) => {
  const v = r.verified, src = v || r.review
  if (!src) return { f: r.f, error: r.error || 'no result' }
  return { f: r.f, reviewScore: r.review && r.review.score, verifiedScore: v ? v.score : null, summary: src.summary,
    findings: (v ? v.findings.filter((x) => x.verdict !== 'refuted') : r.review.findings).map((x) => ({ id: x.id, severity: x.severity, title: x.title, what: (x.what || '').slice(0, 400), evidence: (x.evidence || '').slice(0, 300), fix: (x.fix || '').slice(0, 300), files: x.files, size: x.size })),
    leftovers: r.review && r.review.openLeftovers, missed: v ? v.missed || [] : [] }
})
const synth = await agent(`${RULES}

You are the SYNTHESIS lead for VALE's CLOSING League-of-Legends parity review (gauge only), after the fix waves and integration. Below: the verified results of 8 dimension reviews and 16 per-fighter art reviews (refuted findings removed; a null verifiedScore means the verifier failed, so treat those findings as unverified). The previous scores are in _design/reviews/final_parity_open.json (scores).
Write two files and commit them:
1. \`${REPO}/_design/reviews/closing_parity_review.md\` for the owner, plain language: (a) the verdict paragraph: is VALE on par with LoL today? Apply the PAR BAR per dimension (verified score >= 8 and no confirmed blocker/major) and per fighter; say plainly which are on par and which are not, and what stands between each and par; (b) a scorecard table: dimension, previous score, closing verified score, ON PAR yes/no, one-line state; then a fighter table: fighter, verified score, ON PAR yes/no, the main open issue; (c) the r12 gap table (B1-B5, M1-M14, m1-m5) with current status and one line of evidence; (d) if anything is not on par: a fix plan of 3-6 FIX WAVES that can run in parallel without touching the same files (each: goal, findings by id, files, size, how to measure done), then minors as a polish list; (e) what was not measured.
2. \`${REPO}/_design/reviews/closing_parity_open.json\`: {"verdict": "on_par" | "not_on_par", "scores": {dim: score}, "fighters": {id: score}, "par": {dim_or_fighter: true|false}, "waves": [{"id","goal","files":[...],"done":[...],"findings":[{"dim","id","severity","title","what","evidence","fix","size"}]}], "polish": [...]}.
Then \`cd ${REPO} && git add _design/reviews/closing_parity_review.md _design/reviews/closing_parity_open.json _design/reviews/closing && git commit -m "vale review: closing LoL-parity review (gauge only) — scorecard, per-fighter art, par verdict, fix plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- _design/reviews/closing_parity_review.md _design/reviews/closing_parity_open.json _design/reviews/closing && git push origin claude/youthful-ramanujan-gdud5w\` (on index.lock wait and retry; never force). Return the commit hash and the verdict paragraph.

DIMENSIONS:
${JSON.stringify(compact).slice(0, 150000)}

FIGHTERS:
${JSON.stringify(arts).slice(0, 80000)}`, { label: 'synthesis', phase: 'Synthesis', agentType: 'general-purpose' })

phase('Critic')
const critic = await agent(`${RULES}

You are the COMPLETENESS CRITIC of VALE's closing parity review. Read _design/reviews/closing_parity_review.md, closing_parity_open.json and the per-dimension / per-fighter JSON under _design/reviews/closing/. Ask: which dimension or fighter was not actually measured (verifier failed, notMeasured items, claims resting on stale reports)? Which "on par" verdict rests on an unverified claim? Which r12 gap has no fresh evidence? Is anything the owner cares about (League-level polish of graphics, attacks, special moves, cooldowns, camera, menus, sound, bots; originality; sensitivity) missing from the review entirely? Spot-check 3 of the strongest "on par" claims yourself with a fresh measurement. Write your result to \`${REPO}/_design/reviews/closing/critic.json\` ({"gaps":[{"what","why","howToMeasure"}],"spotChecks":[{"claim","result","evidence"}],"verdictHolds": true|false}) and commit+push that one file. Return the same JSON.`, { label: 'critic', phase: 'Critic', agentType: 'general-purpose' })

return { synthesis: String(synth).slice(0, 3000), critic: String(critic).slice(0, 3000),
  scores: compact.map((c) => ({ k: c.k, review: c.reviewScore, verified: c.verifiedScore, blockersMajors: (c.findings || []).filter((f) => f.severity !== 'minor').length, error: c.error })),
  fighters: arts.map((a) => ({ f: a.f, review: a.reviewScore, verified: a.verifiedScore, blockersMajors: (a.findings || []).filter((x) => x.severity !== 'minor').length, error: a.error })) }
