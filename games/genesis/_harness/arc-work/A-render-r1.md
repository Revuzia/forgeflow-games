# A-render-r1 ledger (render engineer, stage A r1: owner findings #9 tower close-up, #10 silted river)

## Stint 1 (2026-11-07 18:5xZ-) — fresh context, load ~14
Brief items: #9 src/render/life/tower.ts (trees on the live tower, cold blue-grey flat stone, henge-like struck mound);
#10 src/render/planet/silt.ts (silted river matte tan with no water look; town view of the live god flood a white wall).

### #9 tower — CODE DONE, tests green; LIVE SHOT PENDING
- Site clearing (render mask from PlanetSnap.towers, like building plots): `towerClearR(goal) = 2.0 * baseHalf + 6`
  and `towerClearings(pv.towers)` in tower.ts (sig changes only when a tower is added/moved, not as it rises/falls).
  vegetation.ts syncClearings adds the towers' clearings (trees + shrubs); groundcover.ts `inTowerSite` skips points
  and drops cached cells touched when the tower set changes.
- Colour: BASE.stone ashlar [0.4,0.37,0.33] -> warm limestone [0.56,0.47,0.35]; STYLE_TINT cool entries (2: blue
  [0.94,0.97,1.04], 6 grey-blue) -> warm/neutral. Coursed faces: frustum() lays ~1.6 m courses with hashed shade (every
  5th a darker bond course); KitBuilder.scaleUv (new, meshkit.ts) scales the tiers' masonry uv 1/2.2 so the surface's
  blocks/bricks read at 150-400 m.
- Struck mound: (bug) jitterRadial's dr returns METRES; the old call returned ~1 => a perfectly round ring (henge).
  Now lobed outline (+-10-12 % of R, 3 frequencies), a charred outer skirt (soot 0.82) + the heap (soot 0.55), 44 thrown
  blocks/slabs as tilted beams (10-50 deg), lower standing tiers sooted 0.18 (n-2: 0.4, top 0.7).
- Tests: tests/render-arc-tower.test.ts +3 (site cleared; warm stone at all 8 styles + >= 20 course shades; ragged
  scorched mound). Focused: render-arc-tower + render-silt + render-arc-live 18/18. tsc clean.

### #10 silt — CODE DONE, tests green; LIVE SHOT PENDING
- ocean.ts: the silt no longer recolours the FINAL colour (that killed glints/sky => matte tan). Now the body `under`
  -> mud brown at 0.72*silt with streaks drawn along vFlow; the Fresnel sky warmed/dimmed a little (0.4/0.15); glints,
  ripples, foam unchanged on top. The wet bank band (terrainmat wLo by siltG, scaled by rise via siltTarget) kept.
- Cloud over the town: silt.ts `siltLensClear(camBody, alt, zones, k)` -> {r ~ 1.15*alt (250..1700 m), k}; renderer.ts
  passes `lensClear` to clouds.render; clouds.ts `uniform vec2 uLensClear` thins cloud density (and the in-cloud fog)
  within r of the lens by 0.9*k, only when the camera is over an active silt zone and below ~2.5 km. Upstream deck and
  rain stay. Same at every preset (no quality knob touched).
- Tests: tests/render-silt.test.ts +2 (water look kept; lens clearing gating).

### Shots (live, not lookdev) — chain launched 18:58Z
- `_harness/arc-work/render-chain.sh 0 r1-render-tower.json r1-render-flood.json` pid 19004 (kill -0 to check), log
  _harness/scratch/arc/render/r1-chain.log, per-spec logs shots-r1-render-*.log; port 5312, fresh vite.
- Specs (tracked): _harness/arc-work/specs/r1-render-tower.json (r1-tower-rising/struck/finished-night/finished-day,
  babel seed 1, 160 m / 420 m), r1-render-flood.json (r1-flood-before/warning/water/home/god, sandbox seed 1, 600 m).
- Outputs: _shots/r1-*.png. Compare with _shots/vo-near-*.png and vo-flood-god.png.

## NEXT
1. When the chain ends: LOOK at _shots/r1-tower-*.png (no trees on/through the tower or mound; warm coursed brick/
   stone; mound reads as scorched rubble) and r1-flood-warning/god (river visible from 600 m, brown but water).
2. Perf before/after (medium): towers add ~0 measured before; the courses add tris (~4x tier faces) and the cloud
   clearing is one extra mul per sample; measure via a perf spec if time (render-arc3.json perf2 pattern).
3. Gate: npm run check through slot.sh once after the shots are judged (fix-ups included).

### 19:1xZ LOOKED AT r1-tower-rising / r1-tower-struck (first live pass)
- rising: NO trees on the roof, faces or footprint any more (vs vo-near-rising: palm on the roof, palms on the faces):
  clearing MET. Terrace top now warm (210,192,174); the shaded front face still reads blue-grey (71,75,83): colours are
  LINEAR albedo, so [0.56,0.47,0.35] displays as pale limestone and shade under blue sky greys it.
- struck (height 0: both tiers fell): no trees inside; the heap was a RING round an empty floor (lathe stopped at
  b0*0.98) and its soot mix 0.55 is mid grey-brown in linear -> pale lavender-grey top (169,153,142).
- FIX: stone -> [0.55,0.40,0.25] (sandstone, more saturated); heap closed by an unjittered crown lathe; soot skirt
  0.94 / heap 0.8 / crown 0.86 / blocks 0.35-0.95. Test: crown over the centre. render-arc-tower 11/11.
- Re-shoot queued: r1-render-tower2.json (r1b-tower-rising/struck), chain3 pid 21987 (waits for chain2 pid 19494
  = perf spec, which waits for chain 19004 = tower + flood).

### 19:3xZ-19:4xZ LOOKED AT r1-tower-finished-day, r1-flood-* (first live pass)
- finished-day (420 m): tower face toward camera in shade, still blue-grey (80,87,100) — BUT this shot ran on the
  vite started for the tower spec (GENESIS_FROZEN: modules cached at first load) so it may predate the colour fix.
  Root cause anyway: shaded walls got sky irradiance only. FIX (buildingmat.ts FRAG_AMBIENT, all buildings): the sunlit
  ground's warm bounce, rho (0.17,0.13,0.085) * 0.7 * E_sun*muS*cloudshadow, lower hemisphere only. Test added.
- r1-flood-warning/water/god: the lake by the town shows NO brown, even in the flood itself (target 1); god shot is
  still a white wall. Hypothesis: silt k eases on REAL time (2.5 s) and shots hold frames => k ~ 0 live; the lens
  clearing is gated on k so it never acts either. FIX silt.ts lateStart: a zone first seen mid-warning starts at
  target*min(1, rise*4) (flood: progress*10); a warning seen from its start still eases in. Test updated.
- DIAG hook: renderer.ts sets globalThis.__GENESIS_R__ (read-only probe access to uniforms).
- Re-shoot with diagnostics queued: _harness/arc-work/specs/r1-render-flood2.json (r1c-flood-before/warning/home/god;
  returns siltK, zones, lens, camFog, shell, alt), chain4 pid 24191 (after chain3 21987 after chain2 19494 = perf).

### PERF (r1-render-perf.json, lookdev 420 m, 12 frames, load ~5, software GL 48 s/frame)
- medium, CPU work/frame: no tower 29.1 ms (p95 58.7) -> r1 coursed rising tower 22.8 (p95 46.2) -> struck heap 19.9;
  shadows 5.08/4.13/3.40, scene 6.47/3.89/3.04, actors 2.47/1.75/1.33: the tower and site clearing cost nothing
  measurable (noise > effect; numbers fall over the run). No preset touched.
- low/high KILLED at 20:11Z (27 min per shot at 48 s/frame) to free the slot for the visual re-shoots; re-run
  r1-render-perf.json --only=r1-perf-low,r1-perf-high at the end if the slot allows.

### 20:1xZ LOOKED AT r1b-tower-rising / r1b-tower-struck (fresh vite: sandstone + bounce + closed heap)
- rising: shaded face now WARM (89,76,71) (was 57,71,96 owner shot / 71,75,83 first pass), terrace (211,185,161)
  sandstone; no trees on/through it. Courses not resolvable at 160 m/888 px on the shaded face (the buttress rhythm
  is). Clearing + colour: MET.
- struck (all tiers fell): no trees; closed heap now, but a smooth pale barrow (crown lathe smooth, sunlit) — not yet
  "a fallen tower". FIX: when no tier stands, a broken stump of the first tier's walls (12 blocks per side, 2-8 m,
  gaps, sooted) + 60 tilted blocks strewn over the crown; ring blocks 44 -> 70. 12/12 tests.
- Re-shoot r1-render-tower3.json (r1d-tower-rising/struck), chain5 pid 26134 (after chain4 24191 = flood2).

### 20:3xZ r1c-flood-warning DIAG + LOOKED AT
- diag: siltK 0.632 (lateStart works), zone centre ~520 m from the town, w 608; camera alt 382 INSIDE the cloud shell
  (180-420 m on this 3 km sandbox world) -> camFog 1 = the white veil; lens [0,0]: the gate measured the camera's
  ground point (~980 m off the zone) against w*0.8..w*1.5 -> 0. FIX: reach = w + 1.5*alt (+ w*0.7+300 fade). Test.
- Lake under the veil (122,130,140): no brown visible: mud took the dark deep body's own luminance. FIX: mud luminance
  floor 0.32 * sky luminance (silt water is bright). 
- Re-shoot r1-render-flood3.json (r1e-*), chain6 pid after chain5 26134.

### 20:5xZ r1c-flood-god DIAG + LOOKED AT (old gate code still had lens on here)
- god flood, warned: siltK 0.46/0.46 (two zones), lens [440 m, 0.684], camera alt 382 inside the 180-420 m deck: still a
  white wall. The clearing reached only 1.15*alt (the town is ~600 m slant) at 62 % strength. FIX: reach 2.2*alt
  (250..2000), k = min(1, siltK*3)*near, thinning 0.95 (march + in-cloud fog). Test updated. flood3 (queued, fresh vite
  after tower3) carries it.
- GATE r1-check1 (20:3xZ, slot): render-wildplants failed (groundcover inTowerSite on the PROTOTYPE in a test: towerAt
  undefined) -> guarded; the file passes 3/3. Full check result: _harness/scratch/arc/render/r1-check1.log ("exit N").

### 21:0xZ gate + r1d LOOKED AT
- GATE r1-check1: 823 tests, 822 pass, 1 fail (render-wildplants, the prototype guard, FIXED after: focused 3/3).
  Full gate NOT re-run this stint (one full check per stint): next stint runs it first.
- r1d-tower-struck: the heap now reads as RUBBLE — dark scorched mound, 60 tilted blocks strewn over the crown, 70
  round it, lobed outline, no trees. Stump walls barely above the crown -> raised to H*0.9 + 1.2..11 m (tests 12/12).
  Re-shoot r1-render-tower4.json (r1f-*), chain7 pid 29787 (after chain6 26662 = flood3).

## NEXT (stint 2)
1. kill -0 26662 (flood3) / 29787 (tower4); if dead and shots missing, relaunch: setsid nohup
   _harness/arc-work/render-chain.sh 0 r1-render-flood3.json r1-render-tower4.json > _harness/scratch/arc/render/r1-chain8.log 2>&1 &
2. LOOK at _shots/r1e-flood-warning.png and r1e-flood-god.png: river/lake visible from the 600 m town view through
   the thinned deck (diag "lens" should be ~[840, 1]); water brown but with sheen/streaks. If still a wall: print
   diag; consider also thinning weatherfx rain haze / uOvercast under the lens (render/fx/weatherfx.ts).
3. LOOK at _shots/r1f-tower-struck.png (stump visible) — then #9 DONE.
4. Run the gate once (slot.sh npm run check) — expect 823/823.
5. Optional perf low/high: r1-render-perf.json --only=r1-perf-low,r1-perf-high (27 min/shot at current speed).

## Stint 2 (2026-11-07 21:16Z-) — fresh context
- Chains 26662/29787 had finished. LOOKED AT:
  - r1f-tower-struck: dark scorched lobed heap, broken stump blocks standing, ~130 tilted blocks strewn, NO trees in
    it -> reads as a fallen tower, not a henge. r1f-tower-rising: no trees on/through, warm sandstone terrace, ramp
    side, coursed tiers. #9 VISUALLY MET (clearing, colour, mound). 
  - r1e-flood-warning / r1e-flood-god: STILL a white wall although diag lens=[841,1] (the gate works now).
    Cause: dense-deck extinction is uCloudScale.z = 0.16/m (x1.6 storm): 5 % of it over ~300 m of deck under the
    380 m eye = OD ~4. FIX clouds.ts: lens clears outright (dens *= 1 - k*(...), in-cloud fog *(1-k)). test
    render-silt updated (6/6).
- Re-shoot r1-render-flood4.json (r1g-flood-*), chain9 pid 31406 (shots pid 31409), log
  _harness/scratch/arc/render/shots-r1-render-flood4.log.
- GATE r1-check2 launched 21:18Z (slot.sh npm run check, pid 31579) -> _harness/scratch/arc/render/r1-check2.log.
- tower5 (r1h-tower-finished-night/day/near) chained after 31406: pid 31838
- 21:3xZ LOOKED AT r1g-flood-warning: still a blue-grey veil (deck cleared; lens [841,1]). Cause #2: weatherfx screen
  fog: fog = d.fog * w with the god's painted rain at intensity 3 (snow 0.2*3=0.6, gust x2) -> OD ~3 over the town
  view. FIX: fog capped at d.fog*min(1,w); FxCtx.lensClear (godfx from siltLensClear) and wantFog *= 1-0.85*k.
  tests render-silt 6/6 (source asserts), render-rain 2/2, tsc clean.
- chain10 (31838) killed before it started; chain11 pid 1215: flood5 (r1i-flood-*) then tower5 (r1h-tower-*), after 31406.
  NOTE r1-check2 (gate) started BEFORE the weatherfx edit: next gate must re-run (or trust focused tests + tsc).
- GATE r1-check2: 823/823 pass, typecheck + detban clean (ran on the clouds fix; weatherfx/godfx edit came during it: focused tests + tsc clean). r1g-flood-god LOOKED AT: same blue-grey veil as warning (pre-weatherfx-fix vite).
- 21:5xZ LOOKED AT r1i-flood-warning (weatherfx fix live): the TOWN, its lake, the hills and the rain now READ from the
  600 m view (was a white wall). But the water is still blue: silt zone centre ~520 m from the town, w 608 -> the
  shaders' full-brown core (0.55 w = 334 m) misses the town's lake. FIX silt.ts: r = max(600, radius*2.4) (912 for a
  380 m flood). Test added (render-silt 6/6).
- flood6 (r1j-flood-*, + r1j-flood-warning-near at 400 m, no UI) chain12 pid 2665 after chain11 1215 (flood5 -> tower5).
- 22:0xZ LOOKED AT r1i-flood-god: town, lake, a prayer ring and the rain read from 600 m (was a white wall); the town's lake pale olive-tan (old 1.6x zone), far lake blue. #10 visibility MET; colour pending flood6.
- 22:1xZ LOOKED AT r1h-tower-finished-near (200 m, day): warm sandstone 7-tier ziggurat, buttressed coursed faces,
  ramp, fire on top, bare cleared site, no trees (was cold grey-blue). r1h-tower-finished-day (420 m): a hill fills
  the left of the frame (camera framing), the tower warm sandstone stepped. => #9 DONE (clearing, warm coursed stone,
  scorched ragged rubble mound with stump: r1f-tower-struck).

## Stint 3 (2026-11-08 18:16Z-) — fresh context (container had restarted ~18:14Z; node_modules present)
- LOOKED AT r1j-flood-warning (600 m) / r1j-flood-warning-near (400 m), the 2.4x zone live: town, risen lake (wider
  than r1j-flood-before) and rain READ; but the town's lake is pale grey-green (157,158,149), NOT brown (before: dark blue).
  FIX: ocean.ts mud tint (1.45,0.98,0.5)@0.72 -> ochre (1.75,0.88,0.32)@0.85, sky skin warmer and 30 % less;
  silt.ts warning target 0.45+0.55*rise -> 0.7+0.3*rise. render-silt 6/6.
- New specs: r1-render-flood7.json (r1k-flood-*: 600 m + 400 m at low/medium/high/ultra via G.quality on one page),
  r1-render-hearts.json (r1k-heart-dusk-near/mid: ui-m4b harsh recipe until fearful, dusk 18.2 h, bolt, 24 m / 70 m),
  r1-render-perf2.json (medium: lookdev 420/60 m + sandbox play 120/600 m), run on now AND on the pre-arc tree d2512fbc
  (git archive into _harness/scratch/arc/render/base, node_modules symlinked).
- chain13 pid 3861: perf2-now, perf2-base, flood7, hearts (logs _harness/scratch/arc/render/shots-r1-perf2-*.log etc.)
- PERF now (medium, load ~10, CPU work ms mean/p95): lookdev far 29.9/45.7, near 41.1/68.9; play near 27.3/57.6, far
  16.95/52.4 (log shots-r1-perf2-now-load10.log). Container restarted ~23:11Z, chain13 died before perf-base.
- 23:13Z chain14 (_harness/scratch/arc/render/chain14.sh): flood7, hearts, perf2-now, perf2-base (sequential, 5312).
- Tower shots re-looked (r1f-struck/rising, r1h-finished-near): warm sandstone faces (87,75,70)/(99,84,76), no trees,
  scorched lobed rubble heap with warm blocks (132,113,104) and stump: #9 confirmed DONE.
- 23:3xZ LOOKED AT r1k-flood-warning(-near) (ochre 85 %): the town lake now warm khaki (166,156,138) (was grey-green
  157,158,149), river risen, rain + town read; still too pale/desaturated under the rain veil to say "brown".
  FIX ocean.ts: mud (2.0,0.8,0.2) @ 0.9, floor 0.26*sky. render-silt 6/6. flood7 killed; chain15 = chain14.sh with
  r1-render-flood8.json (r1l-*), then hearts, perf2-now, perf2-base.
- r1l (2.0,0.8,0.2 @0.26 floor): during the FLOOD itself (k~1, rain eased) an opaque orange-sand look -> too far.
  FIX: mud (1.9,0.84,0.3) floor 0.17*sky, streaks 0.66+0.34, sky mirror back to 0.45 mix / -12 % (water read).
- LOOKED AT r1m-flood-warning (600 m, UI, warning rise 0.33, siltK 0.8) and r1m-flood-warning-near at low/medium/high
  (G.quality on one page): the town's lake is risen and warm khaki-brown (158,148,134) with a soft sheen vs dark blue
  before; rain streaks and the town read; low/medium/high look the same (no knot). Ultra not shot (container restarted
  04:4xZ mid-chain). Under the rain veil the brown is muted but clearly browner than before. #10 §10 MET (judgement).
- 04:4xZ chain17 = chain14.sh: hearts, perf2-now, perf2-base.
- r1k-heart-dusk-near LOOKED AT: dusk 19 h after a bolt: the town fearful (1.0) but everyone indoors (41 none, 7 pray, 2 fear; 0 on screen): no pose visible. hearts2 spec (r1n-*: bolt at 16.5 h, step 15 min until >= 5 outdoor fear/fist) queued after chain14 pid 774 (chain18).
- PERF now #2 (05:xxZ, load 6-12): lookdev far 41.6/104.5, near 38.8/78.6; play near 22.7/48.5, far 19.5/29.5 (CPU work ms mean/p95). Base (d2512fbc) running next.
- PERF base lookdev (d2512fbc): far 34.0/86.8, near 34.5/61.9. Container restarted again ~14:19Z before base play. 14:2xZ chain19 (hearts2, base play perf) + GATE r1-check3 (slot, log r1-check3.log).
- LOOKED AT r1n-heart-dusk-near (16.75 h, 15 min after a bolt; signs 25 fear/11 pray of 49, 36 outdoors): many people out under the bolts, but the camera framed ~60 m: figures 40 px, the lookUp pose not readable. hearts3 (r1o-heart-dusk-close, 9 m) queued after chain19 (chain20).
- GATE r1-check3 (14:21-14:59Z, load ~12): detban + typecheck clean, 861 tests 860 pass, 1 fail = ui-thumblate #832 (timing under load, ui lane; re-run focused 8/8 pass).
