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
