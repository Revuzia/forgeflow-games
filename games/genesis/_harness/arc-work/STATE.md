# ARC — state of the live tree (assessor, 2026-11-07, after the ~00:40Z container restart)

Method: `git log --since="2026-11-06 15:00" --stat -- src tests _spec` (last src commit 91877281 00:10Z; ARC.md 22d011d3
00:30Z), `git status` (clean for src/tests/_spec: nothing uncommitted was lost from src/tests; only git-ignored
_harness/scratch/** is gone), grep for every §6 contract name, existence checks of every §9.1 file, focused tests and
typecheck. Read-only for src/** and tests/**.

## Headline
- **§10 (river's warning before a flood): landed in sim, ui, render; tests green. Its measured acceptance (8 seeds x 25
  y, >= 80 % evacuated, deaths vs baseline) and the looked-at screenshot have NO surviving record** (scratch erased; no
  `_harness/probes/arc.ts`, no flood shot spec in `_harness/specs/`). Must be re-run.
- **§1-§5: essentially absent.** No sim state, views, commands, events, queries, files or tests of §6 exist. The only
  arc-proper work in the tree is render's heart poses (§1.3/§6.9) built ahead on a stub field the sim never fills.
- Typecheck: `npx tsc --noEmit -p .` (tsc 7.0.2) exit 0, no diagnostics.
- Focused tests: `node --test tests/flood-warning.test.ts tests/render-hearts.test.ts tests/render-silt.test.ts
  tests/ui-flood-warning.test.ts tests/ui-flood-headline.test.ts` -> 21 tests, 21 pass, 0 fail (9.1 s).
- Full `npm run check` not run by the assessor (not required; nobody had a slot in use at 00:5xZ).

## §9.1 files
| file | state |
|---|---|
| src/sim/god/arc.ts, tower.ts, story.ts, legends.ts | ABSENT |
| src/data/scripture.json | ABSENT |
| _harness/probes/arc.ts (and _harness/probes/ dir) | ABSENT |
| src/ui/decision.ts | ABSENT |
| src/render/life/tower.ts, src/render/signs/defiance.ts | ABSENT |
| core/migrate15.ts | exists at src/sim/core/migrate15.ts (spec path is shorthand); has NO `arc` HeaderStep (grep "arc": no hit) |
| tests arc-hearts/pride/tower/defiance/covenant/ages/story/save/freeform/determinism/legends, scripture_lint, ui-arc*, render-arc* | ALL ABSENT |
| tests present for the arc | flood-warning, render-hearts, render-silt, ui-flood-warning, ui-flood-headline |

## §6 contract grep (src/**)
- §6.1 state (`HeartKind`, `DefyKind`, `Vow`, `Memory`, `pride`, `prideWhy`, `defiance`, `defied`, `answer`, `hearts`,
  `memory`, `memEvents`, `dusk`, `told`, `lastHarm`, `harmLoad`, `idol`, `legends`, `towers`, `covenants`, `offers`,
  `ages`, `annals`, `godActs`, `arcEvents`, `TowerState`, `CovenantOffer`, `Covenant`, `AgeRecord`, `ArcEvent`,
  `Legend`): **none** in src/sim/god/state.ts. `ActCtx.ruined`: absent (regard.ts). `TASK.defy = 59`: absent.
  `GATHER_KIND covenant`: absent. Buildings `great-tower`, `idol`: absent from buildings.json.
- §6.2 views: `AnimState` 40-43, `HeartSign`, `MoverBlock.heart`, `SettlementView.heart/defiant/covenant`, `TowerView`,
  `PlanetSnap.towers/covenant/covenantOffer/age/epithet`: **none** in src/sim/types.ts. (Render mirrors the ids locally,
  see §1.)
- §6.3 events (`heart`, `heart.proud`, `tower.*`, `defy*`, `covenant.*`, `chronicle.age`, `legend.retold`): none emitted,
  none in src/audio/eventmap.ts.
- §6.4 commands (`tower.confuse/strike/warn/let/begin`, `defiance.answer/set`, `covenant.make/decline/offer`,
  `pride.set`, `arc.age`, `covenant` param on WRATHFUL, `CommandResult.refusal`): none.
- §6.5 free text (freeform-signs.ts intentSigns): none of the arc phrases.
- §6.6 queries (`hearts`, `towers`, `defiance`, `covenants`, `ages`, `story`; agent `heart`): none.
- §6.7 test surface `window.__GENESIS__.arc` (hearts/towers/story/stub): absent from src/testsurface.ts.
- §6.8 `babel` scenario: absent from src/data/scenarios.json.
- §6.9 render: poses 40-43 present in render (crowds.ts:118-138, bodymat.ts:50); tower.ts, defiance.ts, `great-tower`
  skip: absent.

## Per section
### §1 Visible moods — PARTIAL (render only; sim and UI absent)
- Landed (render, ahead on stubs): `HEART_ANIM = { lookUp: 40, fist: 41, hurl: 42, curse: 43 }` and `heartAnim()`
  (src/render/life/crowds.ts:118-138; stone/spear held for hurl crowds.ts:228-229); crowds reads an optional
  `(A as { heart?: Uint8Array }).heart` (crowds.ts:368-369); joint poses in src/render/life/bodymat.ts:50+.
  tests/render-hearts.test.ts (4 tests, pass).
- Missing: sim `heartsDaily`, per-person heart, settlement heart, `relSnapPlanet` per-agent `HeartSign`, `MoverBlock.heart`
  (so the poses never show in the game), dusk; §1.4 UI (HUD chip glyphs, Hearts layer, inspector); §1.5 chronicle lines;
  §1.6 SFX cues; `arc-hearts` test; testsurface stub.
### §2 Pride and the Tower — ABSENT
No pride, `towerYearly`, tower record/labour/omens, four answers, Decision card (ui/decision.ts), tower render, chronicle,
commands, `babel`.
### §3 Open defiance — ABSENT
No defiance, `TASK.defy`, acts, idol, answer classification, `defiance.answer`, memory, hurl arcs.
### §4 Covenant — ABSENT
No `ruined` in ActCtx/harm.ts, great-destruction thresholds, offers, vows, rainbow, keep/break, refusal, confirm dialog.
### §5 Book of Ages — ABSENT
No annals/godActs/arcEvents, ages, `query('story')`, epithets for the player god (only rival-god epithets exist,
rivals.ts:32-41), Book UI, legends.
### §7 Save migration — ABSENT (no `arc` HeaderStep in src/sim/core/migrate15.ts; no new state to migrate yet).

### §10 River's warning before a flood — LANDED (code + tests); measurements/shot UNRECORDED
- 10.1 natural floods: warning 6-12 h hashed on id `naturalFloodWarning` (src/sim/god/precursors.ts:60), set as `d.st.Wn`
  (src/sim/god/disasters.ts:176-177); `warningStart` emits `warning {kind:'flood', id}` and evacuates
  (precursors.ts:86-89); evacuation record `kind` (precursors.ts:118, state.ts:276); `params.warning`
  (disasters.ts:388), `params.rise`/`silt` (precursors.ts:157-159); upstream pinned rain in `st.wU`
  (precursors.ts:161,186-189); `FLOOD_RISE = 0.4` channel rise (precursors.ts:162-169); wet shelter path to highest
  dry ground (src/sim/people/shelter.ts:119-122,160); fishers row in (shelter.ts:200); chronicle `warning.flood`,
  `flood.home`, `evacuate` (src/data/events.json:209,213,214; told at precursors.ts:120,259); 'Flood on X.' waits for
  the water `st.Ch` (disasters.ts:193-195,264); mission evacuation r2 #5 (`missionEvacuation` precursors.ts:228,
  `godHooks.missionEvacuate` relationship.ts:105,261-271, people/hooks.ts, people/decide.ts).
- 10.2 god floods: `warningTicks` flood case (precursors.ts:35); `WARNED` deliberately lacks flood (precursors.ts:83);
  `water.flood` cast flood with `st.Cf`, `CAST_FLOOD_AFTER = 360` (disasters.ts:100-106,162; commands.ts:35-36,362-366);
  `warning` param on water.flood (relationship.ts:84); foretold in regard.ts:261-262; `riverFlood` on non-wet worlds,
  `RIVER_FLOOD_DAY = 0.25` (disasters.ts:1136-1156).
- UI: warning toast is the headline, flood words (src/ui/toasts.ts:47,269,514-526,643-646); audio event map `warning`
  (src/audio/eventmap.ts:267-269); flood-warning SFX (src/audio/sfx.ts:836).
- Render: silt zones `uSilt[4]` (src/render/planet/silt.ts; ocean.ts:200,454-463,596-602; terrainmat.ts:77,1162-1172;
  planetview.ts:20,90-115); render/fx/disasters.ts touched.
- 10.3 acceptance: (a) tests/flood-warning.test.ts 9/9 pass (incl. Wn in [360,720], kind flood, evacuation, no harm before
  water, warning 0 none) — MET. (b) 8 seeds x 25 y deaths vs baseline, >= 80 % evacuated, other disasters unmoved —
  **NO RECORD** (probe and results lived in erased scratch). (c) screenshot looked at — **NO RECORD** (no spec in
  _harness/specs/, shots erased); render-silt tests (4) pass as a proxy only.

## §8 acceptance lines
| line | verdict |
|---|---|
| 8.0 tests | absent: none of the arc-* tests, scripture_lint, audio extension, ui-arc*, render-arc*. Only §10 tests + render-hearts exist |
| M1 heart view on all towns | absent (no SettlementView.heart) |
| M2 noise / heart.nobow | absent |
| M3 harsh/kind runs | absent |
| M4 shot fearful village poses | partial: poses exist in render (crowds.ts:118-138) but sim never sets MoverBlock.heart; no HUD glyph; no shot |
| M5 Hearts layer ΔE | absent (no layer) |
| T1-T10 | absent (no pride, tower, commands, Decision card) |
| D1-D5 | absent |
| C1-C4 | absent |
| B1-B4 | absent |
| 8.6 gates | partial: tsc clean; focused tests green; full check/build/cdn/determinism/perf/old-save-with-arc-state not verified this stint; no arc state to migrate |
| 8.7 owner rules | not violated by what exists: approved music untouched in the commits (sfx.ts gained a new cue only); no quality.ts change in the window; no Great Flood built; no creature work |

## Next (for the orchestrator)
1. §10: recreate the 8-seed x 25-year flood measurement probe in _harness/arc-work/ (tracked) and the river-warning shot
   spec, run both through slot.sh, record numbers and the looked-at verdict here.
2. Stage A proper, sim first: §6.1/§6.2 state and views (types.ts, state.ts, migrate15 `arc` HeaderStep), then hearts,
   dusk, pride, tower; UI and render can build on `__GENESIS__.arc.stub` once the UI lane adds it.

- render lane (A-render stint 3, 07:4xZ): §10.3(c) screenshot LOOKED AT and MET (river higher + browner during the warning; _shots/arc-river-before.png vs arc-river-warning.png; terrainmat shallows silt fix). Gate 798/798 green at 06:2xZ.

- UI lane (A-ui stint 4, 09:2xZ): M4 LIVE (no stub) via _harness/arc-work/specs/ui-m4b.json: harsh recipe -> fearful in 7
  days; 120 m frame _shots/arc-m4b-120.png has 17 fear-signed people on screen (>= 5); HUD chip glyph live at region
  (arc-m4-region.png); Hearts layer on the real heart LOOKED (arc-m4b-layer.png). UI side of §1/§2/§10 complete; pose
  legibility at 888x500 is the render lane's verdict.
