# STATUS LEDGER: read this first, then COMMON.md and RESUME.md. Do not redo anything marked DONE.

Last updated 2026-10-07 11:35 CDT, branch `claude/exciting-faraday-2dakqx`, local commits only (NOTHING is pushed; nothing is deployed; the CDN still serves an OLD build).

## DONE: do not redo (evidence in the named report or commit)
| Item | Commit | Verification | Where the evidence is |
|---|---|---|---|
| Windows tooling (portable `startVite`, Playwright copy, snapshot and tree-hash helpers), session briefs | cd3213a8 | n/a | RESUME.md, VERIFY.md |
| Two fingers on the body never pick it up (only a lone hand does) | 19f62137 | engineer only (probe_cut B3b, fails on old code); **independent physics check still pending (Stage 3)** | `probe_cut.ts` B3b |
| Taps pay nothing; squeeze 0.6/s and stretch 0.65/s pay; medley = squeeze + stretched pull (level >= 0.35) | 2f9cc8fc, c8d6255a | taps: independent PASS (`VERIFY_ECON_NOTAP.md`); the medley change: checked by the orchestrator only (probe rows, sim re-run) | `ECON_NOTAP.md`, DESIGN 5.4 |
| Daily tasks no longer count taps ("Ten quick squeezes", "Stretch three of them as far as they will go") | a51bab3b | orchestrator only | `probe_collection.ts` P06 |
| Shift + drag pulls both sides (mouse / pen) | 4455ff29 | independent PASS, 5 minors (`VERIFY_INPUT_SHIFT.md`) | `INPUT_SHIFT.md` |
| Left mouse click on empty space no longer turns the view (right / middle only; finger and pen unchanged; Snap tool too) | aecf1061 | node 128/128 + 183/183, real browser 37/37; no independent check | commit message |
| Render parts A, B, C, O1, O2, full harness, fix round 1 (4-body mat MAJOR fixed) | 58fb66ec, 962cc5b0 | lens B round 1 PASS with minors (`VERIFY_RENDER_B_R1.md`); lens A round 1: every earlier item re-checked (V1 to V22), final verdict being written | `RENDER_R.md`, `RENDER_FIX1.md`, `VERIFY_RENDER_A_R1.md` |
| Specs: LOCK and MULTI-PULL, UI | 2892e3ce, 3bc066bc | n/a | `_spec/LOCK.md`, `_spec/UI.md` |

## IN PROGRESS (continue from the running report, never from scratch)
- **Render verification, lens A round 1, final leg** (workflow `wf_b5f562e3-adf`): collect the last running harness job and write the FINAL section of `VERIFY_RENDER_A_R1.md`. Everything before it is measured: do not re-run V1 to V22.
- **SHELL-4** (workflow `wf_ea013a48-e3e`): running report `SHELL_4.md`; its status table says which of steps 1 to 9 are done. Baseline it started from (measured): tsc clean; node_checks 114/114; probe_app 183/183; probe_gestures 128/128; browser sections desktop-boot + mouse-gestures 37/37. Not its job: Shift pull, left-click rule, taps-pay-nothing (done above), restyling (UI stage), physics, render, audio.

## QUEUED, in this order (owner-approved order)
1. UI overhaul to the `_spec/UI.md` bar (owner: no font files; right after SHELL-4).
2. Independent physics re-verification of checkpoint 47 (+ the lift fix); scripts in `_handoff/verify_physics/` (paths need porting to Windows).
3. Physics round 3: the pull-into-the-ground fix, multi-pull and LOCK (`_spec/LOCK.md`, owner decisions), the cut neck swell (putty / slow-rise / firm silicone), with independent verification.
4. Refresh the preview artifact (the old link was not reachable from this account: publish a NEW private one) and give the tested commit for the CDN. **Never deploy without the owner's yes.**
5. ffgames (ForgeFlow Games portal): achievements, bridge, game_meta.json, thumbnail 1280x720, README, dry run. **Owner's yes before any deploy or any database write.**
6. Not started from the handoff: Stamp and Roll tools; the trade client against a mock host; Stage C (README, thumbnail, gates G3 G4 G6, a full playthrough, a final independent review, the doc re-quote pass: DESIGN 5.0 headline numbers, DESIGN line 243 section tag, NEXT_STEPS / TRADE quotes of the old 3.1 min and 205/131 days).

## KNOWN OPEN, owned by a later lane (do not "fix" in the wrong lane)
- PHYS: cut neck swell on putty / slow-rise / firm silicone (render has a stopgap in `stage.ts framingFor`: remove when fixed); pull-into-the-ground folds; a lone finger dragged down past the limit inverts some species; two-handed pulls crease; perf 1.8 to 2.3 ms/frame.
- ECON: the remaining cheap path (a 0.4 s press every 2.4 s = 23.5 SP/min); owner may want a longer minimum hold.
- RENDER minors left: slime parting strand (cause was the shell gap, in SHELL-4), a Calm overlapped-ceremony chain at 4, whole-again luminance tick mixed, med / low colour drift, phone 4 to 5 body mat is small, Legendary glow near the capsule on small frames, a body brought out onto an occupied mat slot pops out after 0.3 s.
- Process: `probe_collection` C08 allocation row fails on this PC on the old tree too; `snap.mjs` drops node_modules/*/dist (use a junction); usage limit cuts agents off about every 2 hours of three agents: always keep a running report.
