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
- 2026-11-07 sim (A-sim stint 3), §1.2 dusk flags: vespers attendance tops out near 0.25-0.45 even in a faithful town
  (verifier M3: ema max 0.24-0.32), so the absolute 0.25/0.45 band never armed. Now: the town's own peak
  (`since.duskPk`, half-life 2 y toward the ema, frozen while low) arms the flag once it reaches `ARC.duskArm` 0.18;
  high = min(0.45, 0.85 x peak), low = min(0.25, 0.6 x peak). And hearts keep people home: of those the evening draws,
  `ARC.duskKeep` lets go devoted/quiet 1, restless 0.6, fearful 0.3, defiant 0 (relationship.ts vespers; the rest are
  recorded in the new optional `vespers.away`). `dusk.low` is also set when the kept-home ema (`since.duskAw`) is
  >= `ARC.duskAway` 0.1 and above the dusk ema (the shrine empties because of their hearts); cleared at ema >= high
  with kept-home < half the ema. The old absolute case (0.45 -> 0.25) still sets it.
- 2026-11-07 sim (A-sim stint 3), §6.8 `babel`: a scenario PeopleEntry gains `cluster: { towns, km }`, `pride`,
  `prideYears`, `towerArm` (scenarios.ts clusterPeople); `count` is per town in a cluster. Player-facing name "One speech".
- 2026-11-07 UI (A-ui stint 3), §2.5 Decision card placement: at most **186 px** tall (was 170; the four answers need
  their words on two lines at 888x500, measured in arc-babel-card2: scrollHeight 184). The pill sits top-centre where
  the card was (nothing fits left of the far-left time panel). New: when the bottom-left news column would meet the
  card, the card steps right of it (below the worship panel) if it fits, else the news column yields its top.
  No §6 data contract changed. Test surface (§6.7 neighbour): `G.hold('ui')` added for UI-layout shots.
