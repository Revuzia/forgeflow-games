# B-render ledger (render engineer, stage B §3 defiance + the lead's carry-overs from A r1)

## Brief (lead 2026-11-09 ~15:2xZ)
1. Heart poses readable at play distance (40-80 m, 888x500) - stronger lookUp (head back, both hands up), clear fist,
   cheer, prayer; every preset, never lowering quality.
2. The bleached exposure after a bolt at dusk (r1o-heart-dusk-close) if it is a render/exposure issue.
3. The 400 m flood warning view at ULTRA.
4. Stage B: hurl arcs (render/signs/defiance.ts, from MoverBlock.heart == 5), curse crowd at dusk, burning shrine
   (existing fire), the idol (buildinggen idol()), broken-covenant ring (signs.ts 'broken', stage C/D sim).
   Live D3 shot (defiance.set + god storm >= 4 hurl agents + arcs). Gate green.

## Stint 1 (2026-11-09 15:2xZ-)
- POSES (bodymat.ts): 40 lookUp = recoil (lean back, knees bent, crouchDrop 0.75), head -0.95, BOTH arms raised wide
  before the face (-2.05, z +-0.75, forearms -0.75), tremble; 44 (walking) same arms + head -0.85; 41/45 fist = arm
  straight up (-3.0, forearm -0.08..-0.43 shake); 5 pray = kneeling with both arms lifted high (-2.0..-2.6, z +-0.45)
  and a slow bow; 21 cheer jump 0.06 -> 0.14. render-hearts 4/4.
- Specs: b-render-poses.json (b0-pose-*: lookdev stub signs mixed at 40/70 m, each alone at 60 m, mixed 60 m at
  low/high/ultra), b-render-d3.json (b1-*: babel live hurl 50/22 m, +2.5 s bleach check, curse at dusk, idol 14/40 m),
  r1-render-flood10.json (r1p: ultra 400 m warning). Chain: poses (b-chain1), then d3 + flood10 (b-chain2).
- Bleach (r1o): bolts live on the render clock; a held shot freezes the stroke's ground-light decal (up to ~4.5x) and
  the flash in the frame. b1-hurl-after checks the same view 2.5 s later.
- LOOKED AT b0-pose-mix-40 (lookdev, mixed stub signs, 40 m): raised FISTS read clearly on walkers (arm straight up);
  fear/cheer/pray hard to tell at 40 m from the high camera (tilt 66: raised arms foreshortened). b0-pose-mix-70: people
  ~8 px dots on the path; no pose reads individually.
- bodygen.ts bipedLow: far LOD arms 1.5x thick, mid LOD 1.25x (silhouette LODs keep a raised arm >= 1-2 px at 40-80 m).
  clothing + render-hearts + render-arc-defiance 11/11.
- Container restarted ~19:2xZ (chains died). b-chain3: d3 (live hurl/curse/idol + bleach check), poses2 (b0b-*: each
  sign alone at 60 m tilt 58, mixed at low/ultra), flood10 (ultra).
- 19:5xZ LOOKED AT b1-hurl-50/after (live babel, defiance 0.8 + painted storm, 48 h of 20-min steps): NO hurl (0 signs) - the sim chose curse (day 3, dusk toast) and IDOL (day 4, sim-raised, toast 'carved a god of its own'); 21 h night frame, no bolt -> no bleach. Retake with up to 9 days hourly + storm repaint. Container restarted 20:1xZ. 20:2xZ b-chain5: b-render-live.json (b3-*: hurl, idol, curse), poses2, flood10.
- 2026-11-10 00:5xZ restart again (nothing of b-chain5/b-check1 finished). b-chain6 (live, poses2, flood10) + GATE b-check2.
- 01:1xZ b3-hurl-50 (9 days hourly under a god storm, Shenyaar id 1, def 0.8): still 0 hurl. Probe B-render-hurlprobe.ts: stormNear true, bold 25, fear ~0.25; the seeded daily hurl roll (defyRoll) for town 1 first passes on day 12. Town 3 (Yik) at def 1 hurls at hour 0 (node). Live spec now uses town 3 / def 1; b-chain7 restarted (live, poses2, flood10). Gate b-check2 running.
- GATE b-check2 (01:27Z, slot.sh npm run check, poses + bodygen arms in): 881/881 GREEN.
- LOOKED AT b3-hurl-50 / b3-hurl-25 (live, Yik def 1, god storm): 8 hurl signs, 8 hurlers drawn, 9 -> 17 arcs in
  flight (stats), BUT the act fires at ~01:00 game time: night + rain, the throwers hidden behind houses - not judgeable.
  b4 (b-render-hurlday.json): same recipe, camera hour 14 at 40 m / 20 m, plus the idol 14/40 m.
- 05:2xZ another restart; b-chain9: hurlday, poses2, flood10.
