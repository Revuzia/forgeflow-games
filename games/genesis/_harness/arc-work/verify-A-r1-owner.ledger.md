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
