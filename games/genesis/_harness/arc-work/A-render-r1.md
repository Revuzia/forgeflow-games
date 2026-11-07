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
