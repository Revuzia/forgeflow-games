# ARC §6 contract changes (append-only; who, when, what, why)

- 2026-11-07 render (A-render stint 1): §6.2 TowerView — clarified, not changed in type: `height` is what stands, and on
  a `struck` tower `tiers` keeps the tier count before the fall (render/life/tower.ts heaps `tiers - ceil(height/12)`
  fallen tiers as the rubble mound; if the sim recomputes tiers from height the mound falls back to one tier's worth).
  Sim lane: when building tower.strike, lower `height` to the standing remains and leave `tiers` as it was.
- 2026-11-07 sim (A-sim stint 2), §2.3 `great-tower` building: `materials` are `["mudbrick","brick","stone"]` (the
  material id is `brick`; `bricks` is the recipe) and `work` is 1e7 (the content validator caps work at 1e7; tower.ts
  also resets the record's progress to 0 daily so the building path never finishes it).
- 2026-11-07 sim (A-sim stint 2), §2.3 one speech: each league town's whole `langLine` is set to the host's (same root
  only) every 2 years; replacing only the last element cannot reach distance <= 0.18 when the lines differ in length.
- 2026-11-07 sim (A-sim stint 2), §2.3 site: the rules are ranked preferences (toward the league centroid, slope < 0.08,
  then flattest; slope > 0.5 rejected); dry land and no building within 60 m stay hard rules (coarse n=20 test worlds had
  no cell meeting every rule).
- 2026-11-07 sim (A-sim stint 2), §2.4: after `let` on a rising tower, `canAnswer` is ['confuse','strike'] (the
  standing-tower rule applied as soon as the god has let it stand). Template vars gained host, league, prophet,
  reading, a, b, dead (content.ts TEMPLATE_VARS). `tower.omen` is three ids `tower.omen.starlings|halo|lightning`;
  `tower.struck` with dead is `tower.struck.dead`; "They swore they would build again" is its own line `tower.swore`;
  the silent finish is `tower.finished.silent`. The `tower.struck` event's `tiers` is the number of tiers that fell.
