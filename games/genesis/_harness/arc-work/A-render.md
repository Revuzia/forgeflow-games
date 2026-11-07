# A-render ledger (render engineer, stage A) — trust this file

Owns src/render/**, tests/render*, tests/godgen*. Shots port 5312. Bulky output: _harness/scratch/arc/render/.

## Plan (priority order)
1. §1 hearts: verify MoverBlock.heart (sim landed) reaches crowds pose path (HeartSign -> AnimState 40-43); typed, not stub cast
2. §2.6 tower render: src/render/life/tower.ts from PlanetSnap.towers (stages rising/finished/struck/scattered/abandoned), BuildingBlock skips great-tower; tests/render-arc-tower
3. §2.6 confusion ring (signs decal, hue shifting, 8 km) on tower.confused + style tint ease
4. §10 river-warning shot looked at (silt/rise), numbers
5. §3.4 render/signs/defiance.ts hurl arcs (<=64, instanced, no new pass); idol post (buildinggen)
6. §4.5 covenant break ring (omen ring recoloured); rainbow = existing
7. frame times before/after (perf), gate green

## Stint log
### Stint 1 (2026-11-07)
- started
- DONE item 1 (code): crowds.ts now reads the typed MoverBlock.heart (sim's heartSigns fills it in relSnapPlanet) and
  HeartSign/AnimState from types.ts (no stub cast). render-hearts 4/4. Not yet seen in a live-sim shot (needs a fearful town).
- item 2 code: NEW src/render/life/tower.ts (towerLook/towerKey/towerShape/towerMesh/towerYaw: tiers 12 m x0.82,
  stair per tier facing the host, buttresses, coping; rising = partial top + timber scaffold + ladders + brick piles +
  dust emitter; finished = summit fire bowl + brazier emitter; struck = scorched top, rubble ring (lathe+blocks),
  1-day dust/smoke stack; scattered/abandoned = crumbled crown, weathering 0..3 by years since ended (vertex colour)).
  buildings.ts: skips look.id 'great-tower'; syncTowers(pv) from pv.towers (stamp; meshes cached per look, dropped from
  batches when replaced); drawn into bNear + bShadow (warmed programs, one mesh at every preset); emitters in
  rebuildOutputs; towerPosition(id). tests/render-arc-tower.test.ts 6/6. tsc clean.
  Interpretation noted in contract-changes.md: struck TowerView.tiers = tiers before the fall, height = what stands.
- item 3 code: signs.ts moments 'confuse' (tower.confused: 3 hue-shifting ripple rings to 8 km + a column; pos from the
  event or pv.towers by data.tower) and 'broken' (covenant.broken: cold violet ring per town, data.towns or
  pv.covenant.towns); godfx routes both events to signs. Style tint easing over 2 days: NOT done (houses swap variant).
- shots: _harness/arc-work/specs/render-tower.json (rising med/low, finished night high, struck, abandoned, far, confuse)
  launched 01:3xZ via slot -> _harness/scratch/arc/render/shots-tower.log, PNGs _shots/arc-tower-*.png
- item 5 code (stage B ahead): NEW src/render/signs/defiance.ts DefianceArcs (hurlers from crowds.hurlers, filled where
  the person is drawn in HEART_ANIM.hurl; one throw per pose swing 1/0.45 s, apex 15-25 m, drift 1-4 m/s, <= 64 in
  flight, <= 260 m from the camera) tossed into the existing FX Debris pool via new Debris.toss (meshfx.ts shader mode 2:
  lands 1.5 m under the hand, vanishes 1-1.6 s later; same program, no new pass). godfx.ts calls it after signs.
  Idol: catalog kind 'idol' (+ /idol/ id mapping, DEFAULT_BUILDINGS entry appended), buildinggen idol(): standing stone
  (stone/earth peoples) or carved wooden post (timber), ~3 m, painted bands CLOTH[style], face, offerings.
  tests/render-arc-defiance.test.ts 4/4. NOT LOOKED AT in a shot yet (needs heart==5 stub agents + idol building).
- Style ease (§2.6 "towns' building tint easing to their new style over 2 game days"): buildings.ts Rec.from/swapAt —
  a building whose skey changes ONLY in style keeps drawing its old variant until a hashed moment within 2 game days
  (sameButStyle exported, tested). tests/render-arc-tower 8/8 (incl. sameButStyle, confuseHue).
- RUNS (01:37Z): tower shots PID 13088 (log shots-tower.log); hearts poses queued as PID 14694 (waits 13088, log
  shots-hearts.log, spec render-hearts.json); chain PID 15127 (_harness/arc-work/render-chain.sh: waits 14694, then
  river-warning.json, render-perf.json -> shots-river-warning.log, shots-render-perf.log). All in
  _harness/scratch/arc/render/. PNGs in _shots/arc-*.png. After a restart: rerun render-chain.sh 0 <specs>.
- 01:5xZ focused: render-arc-tower 8, render-arc-defiance 4, render-hearts 4, render-silt 4, render 5 files (31),
  shipgen 4: all pass; tsc clean. Full gate NOT run this stint (someone's `npm run check` held slot 2 from 01:27Z on
  this tree; one-suite rule). Shots extremely slow (load ~14; the first tower shot >20 min, nothing captured yet).

## NEXT (stint 2)
1. Check runs: kill -0 13088 / 14694 / 15127. If gone and PNGs missing (_shots/arc-tower-*.png, arc-pose-*.png,
   arc-river-*.png) rerun: setsid nohup _harness/arc-work/render-chain.sh 0 render-tower.json render-hearts.json
   river-warning.json render-perf.json > _harness/scratch/arc/render/chain.log 2>&1 &
2. LOOK at every PNG (Read the file): tower rising (scaffold, partial tier, piles, stair facing the village), low preset
   same geometry, finished at night (summit fire), struck (scorched, rubble ring), abandoned (crumbled, weathered),
   far speck + shadow, confusion ring (hue rings at 9 km view). Poses: fear lookUp, fist/curse, hurl + pebbles in
   flight (report arcs stats), celebrate. River: warning vs before (§10.3c). Fix what looks wrong.
3. Perf: shots-render-perf.log prints perfmon before/after (tower) and hurlBefore/hurl; record numbers here.
4. Full gate once via slot.sh (slot.sh --status first): npm run check -> _harness/scratch/arc/render/check.log.
5. Remaining render items: tower picking for the UI's tower inspector card (Buildings.pick/positionOf for towers; UI
   lane needs a pick path — coordinate via contract-changes if a new pick kind 'tower' is wanted); idol not yet seen
   in a shot (needs the sim's `idol` building; catalog maps it); covenant Hearts-layer rim is the UI lane's
   (overlays.ts), the rainbow is the existing physical one; live-sim (not stub) look at heart poses once sim towns
   go fearful/defiant.

### Stint 2 (2026-11-07 04:2xZ-)
- Looked at: arc-tower-rising (medium, 420 m): stepped mudbrick ziggurat, stair on the face, reads as real; scaffold
  not legible at 420 m (fine). arc-pose-fear / arc-pose-fist: IDENTICAL, no poses visible — the stub put signs on
  everyone but the people in view walk, and heartAnim returned the walk for movers. Spec §1.4 says a sign applies to
  someone "idle, walking, socialising". FIX: crowds.ts HEART_WALK { lookUp: 44, fist: 45 } (render-only ids; a walker
  keeps the walk's legs/cadence with the sign in the upper body; carry/run/work keep theirs); bodymat.ts animFreq,
  livingRot pose (gaitLegs + head back / fist up), rootPose walk bob. tests/render-hearts 4/4 (updated).
- Looked at: arc-river-before / arc-river-warning (lookdev river, medium): water turns grey-brown in the warning
  (browner: YES) but the banks were pixel-identical (diff) — "higher": NO. Cause: terrainmat's shore wet band (which
  carries the silt mud) is zeroed where vegTotal > 0.45, i.e. on every grassy bank. FIX: terrainmat.ts `siltBank`
  (same reach as the silt wLo, noise-broken, NOT veg-gated): mud colour, flattened sward, wetter roughness. render-silt 4/4.
- Tower spec bug: each preset is a new page, so window.__tw/__p were undefined after the first shot (6 of 7 failed).
  FIX: render-tower.json / render-hearts.json shots re-run a guarded setup prelude. All 4 specs parse (AsyncFunction).
- Tower picking: DONE by the UI lane (app.ts pickTower, host.ts InspectRef 'tower'); nothing for render.
- tsc clean 04:3xZ.
- RUNS: perf (render-perf.json) running under the stint-1 chain PID 15154 (log shots-render-perf.log; node PID 6921,
  started 04:27Z, still in the measure script at 05:5xZ: ~430 software-GL frames). New chain
  PID 8117 (waits 15154): river-warning.json, render-tower.json, render-hearts.json -> shots-<spec>.log in
  _harness/scratch/arc/render/; chain2.log. Each shot takes 15-60 min at load ~16.
- Gate: queued `npm run check` behind the other agent's suite (PID 1280) via slot.sh: waiter PID 13506 (slot ticket
  #29) -> _harness/scratch/arc/render/check.log (last line "exit N"). It includes this stint's edits.

## NEXT (stint 3)
1. kill -0 6921 (perf node) / 15154 / 8117 (chain) / 13506 (gate). After a restart: rerun
   setsid nohup _harness/arc-work/render-chain.sh 0 render-perf.json river-warning.json render-tower.json render-hearts.json
   > _harness/scratch/arc/render/chain.log 2>&1 &  and the gate through slot.sh.
2. check.log: "exit 0" -> gate green (record). A failure in a render*/godgen* test is ours; others' failures: note owner.
3. shots-render-perf.log: script result {before, after, hurlBefore, hurl, arcs} -> record frame times here
   (tower+hurl crowd vs none, medium). If it never finishes, cut the spec to 30-frame measures.
4. LOOK: arc-river-warning.png vs arc-river-before.png — the bank must now show a dark mud band up the grass (siltBank);
   if it is everywhere on the land (uw proxy too wide) narrow the reach (wLo * 0.5 for siltBank). Record §10.3(c) verdict
   here AND tell STATE/sim ledger (§10.3c is the render lane's shot).
5. LOOK: arc-tower-* (7) and arc-pose-* (fear now shows WALKERS with heads back = HEART_WALK 44; fist = 45 / 41 / 43;
   hurl + pebbles + arcs stats).

### Stint 3 (2026-11-07 06:00Z-) — container restarted ~05:59Z (all stint-2 PIDs gone)
- stint-2 gate check.log was cut by the restart at test 518 (518 ok, 0 not ok).
- 06:00Z gate relaunched: bash -c 'slot.sh npm run check; echo exit $?' -> _harness/scratch/arc/render/check.log (pid file check.pid).
- 06:10Z chain relaunched (pid file chain.pid): river-warning, render-tower, render-hearts, render-perf (perf spec cut
  to 30-frame measures; 90 never finished at load 12+). Logs shots-<spec>.log.
- GATE GREEN 06:2xZ: npm run check (detban, tsc, suite) 798 ok / 0 not ok, "exit 0" (check.log). Includes all stint-1/2
  render edits (HEART_WALK, siltBank, tower, defiance, idol, style ease).
- NEW tests/render-arc-live.test.ts 1/1 (LIVE sim, not a stub): tower.begin -> PlanetSnap.towers -> rising look
  (scaffold, piles); the BuildingBlock carries the great-tower record (catalog id from the base pack) that buildings.ts
  skips; tower.strike -> struck look, scorched, rubble mound. (Created after the gate started: not in its 798.)
- arc-river-before.png (06:19Z, medium, 199 ms/frame software GL) LOOKED AT: green hills, river with pale sand banks.
- arc-river-warning.png (06:31Z) LOOKED AT vs before: water grey-brown (browner: YES). Banks STILL pixel-identical
  (diff: only water, ocean and wind-moved foreground trees change) -> the stint-2 siltBank shows nothing. §10.3(c) NOT MET yet.
- Probe _harness/arc-work/specs/probe-silt.json (reads the uniforms the compiled programs use, via scene.onAfterRender):
  terrain materials DO get uSilt [-2452,620,1614 r1440] k 0.74 (lookdev planet radius ~3 km). So siltG > 0 on the
  terrain; the bank colour terms must be producing nothing -> v2 of the probe dumps the compiled fragment source around
  siltBank (is it the code we think?).
- Probe v3 (arc-probe-siltdbg.png, terrain albedo -> R siltG, G -uw/12, B siltBank): siltG high over the view; siltBank
  high on a band AT the waterline (uw ~ 0), only a thin orange fringe up the dry bank (bank uw drops past -3 m within a
  few px). The pale margin seen in the real shots is the SHALLOW FLOOR (uw 0..1, floorC = uSandCol*0.5) seen through
  the water: the underwater block overwrote the silt there. FIX terrainmat.ts: floorC mixed to mud by siltG*0.9 (the
  risen brown river covers its pale shallows). render-silt 4/4 (assert added), tsc clean.
- NOTE: shots.mjs's vite runs GENESIS_FROZEN (no file watching): a run that REUSES a vite already up on the port serves
  stale src. River re-run therefore on port 5313 (fresh vite): shots-river-warning2.log.
- arc-tower-rising.png (06:51Z, fresh run) LOOKED AT: stepped pale mudbrick ziggurat with a stair, at 420 m; reads as
  built. Stub site sits at the river's edge (stub placement, not render). Other 6 tower shots still running (slot 1,
  shots-render-tower.log; ~19 min/shot at load 15). Then render-hearts, render-perf follow in the chain (chain.pid).
  CAUTION: the chain's tower/hearts/perf runs reuse the port-5312 vite started 06:32Z -> they serve terrainmat WITHOUT
  the shallows fix (irrelevant to towers/poses/perf numbers).

- §10.3(c) LOOKED AT 07:4xZ (fresh-vite re-run, port 5313): arc-river-warning.png vs arc-river-before.png, crop
  _harness/scratch/arc/render/cmp2.png. Before: blue river with a broad pale sand margin. Warning: the river runs an
  opaque silty khaki-brown and fills to the grass (the pale margin is gone under the brown film) -> HIGHER and BROWNER:
  MET. (A few small brown silt specks on the dry grass near the bank: acceptable, noise-broken siltBank.)

## NEXT (stint 4)
1. (§10.3c DONE stint 3.) Optional: shot at low/high presets of the same pair to confirm the shallows fix holds there.
2. Chain (pid file _harness/scratch/arc/render/chain.pid): LOOK at arc-tower-* (7) and arc-pose-* ; perf numbers from
   shots-render-perf.log -> record.
3. Gate: green at 06:2xZ (798/798). New since: tests/render-arc-live.test.ts (1/1), render-silt assert, terrainmat
   shallows fix: tsc clean, focused green. Run the gate once more at the end of stint 4 if code changes.

### Stint 3b (2026-11-07 13:15Z-) — fresh context; machine idle (load 0.8)
- Chain of stint 3 finished (all PIDs dead). LOOKED AT: arc-tower-finished-night (summit fire visible as a small glow on
  the top of a pale ziggurat at dusk: OK), arc-tower-struck (crop crop-tw.png: top tier darker/sooty, a pale smooth mound
  disc round the base — read as a plinth more than rubble), arc-tower-abandoned (crumbled crown: OK), arc-tower-far
  (orbit: a speck by the river, no beacon: OK), arc-tower-confuse: NOTHING (moments 0): signs moments run on REAL time
  (12 s) and software GL frames take ~30 s, so it expired before capture; the 9 km camera on the 3 km lookdev planet
  showed the whole globe. Poses (poses3.png): fear walkers show heads tipped back (faces up to an over-the-shoulder
  camera): legible; fist walkers: raised arm visible on a few, modest at 888x500; celebrate: walkers unchanged (cheer only
  when free, by spec). Hurl: hurlers 0 — stub signs=5 on WALKING people keep their walk (heartAnim: a throw is its own
  task, TASK.defy, sim stage B); nothing to fix in render until the sim's defy task exists.
- Perf (render-perf.json, medium, 30 frames): work.mean 26.7 ms/frame before (planets 13.6, shadows 3.3); the "after"
  was cut by shots.mjs's 400-char print. Interval 25 s/frame = software GL under load; meaningless as fps.
- FIX tower.ts struck mound: soot 0.35 -> 0.45, broken blocks 18 -> 36, size 1.6-4.4 m. render-arc-tower + live 9/9.
- NEW spec _harness/arc-work/specs/render-arc3.json: struck2, confuse2 (signs.hold 2.2, 5.2 km) + confuse2-near
  (hold 1.2, 1.4 km), perf2 low/medium/high (CPU work before/after/struck, 12 frames; full numbers as "[warning] PERF {...}"
  lines in the log). Launched 13:2xZ: chain pid file chain3.pid (19166) -> shots-render-arc3.log.
