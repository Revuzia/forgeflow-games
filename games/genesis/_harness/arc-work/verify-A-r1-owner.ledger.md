# verify-A-r1-owner ledger (stage A round 1, owner play; READ-ONLY src/tests; port 5351)
Specs (tracked): _harness/arc-work/specs/verify-owner-tower.json, verify-owner-flood.json, verify-owner-tower-near.json;
chain helper _harness/arc-work/verify-owner-chain.sh. Logs: _harness/scratch/arc/verify-A-r1-owner/. Shots: _shots/vo-*.png.
Note: unheld G.frames at surface on SwiftShader ~30 s/frame -> keep frames held (r1 of the tower spec was killed for that).

## Findings so far (evidence = shots looked at + code)
1. Decision card warn option never disabled: decision.ts towerChoice `disabled: can.has(id) ? undefined : why` but sim
   canAnswer() always lists 'warn' while warnBlocked is set -> no-prophet / prophet-already-speaking / refused-within-a-year
   all show an enabled button (vo-confuse-card r1: no prophet, warn "they may listen." enabled; vo-warn-day6: after the
   refusal it reads "Eigur will go. They may listen." enabled).
2. tower.refused told once per refusing town with identical text naming only the host: 4 identical lines (vo-warn-day6 chronicle).
3. "Look at it" frames the tower at screen centre, which the 380x186 card covers at 888x500 (app.ts lookAt dist 260; vo-confuse-look r1).
4. Card title truncated "A tower rises at Ashuk by the L..." at 888x500 AND 1600x900 (vo-confuse-card, vo-let-insp).
5. Merged warning toast repeats the evacuate sentence twice with x2 (vo-confuse-later).
6. Live tower site keeps its vegetation: palms on the roof of the rising tower and inside the struck mound
   (vo-near-rising.png, vo-near-struck.png; tower.ts sim never clears trees, buildings.ts:456 skips great-tower).
   Live 'stone' tower reads as a flat blue-grey box (stub shots were mudbrick); struck mound reads as a stone ring, no scorch.
7. §10 live: the god flood at default wrath warns (params warning/rise/silt, toast, omen) but at the town-framing
   distance (600 m) the view is a white rain wall (vo-flood-god.png); the render lane's lookdev pair shows the silt river as
   opaque tan that reads as a dry bed (arc-river-warning.png). Natural floods: warning -> evacuate -> flood -> flood.home
   told in order (vo-flood-* chronicle). My detection of pv.disasters while held missed the warning window (harness issue).
8. Let: finished at 80 m, 7 tiers, small night fire visible at 420 m (vo-near-finished-night.png) - OK.
