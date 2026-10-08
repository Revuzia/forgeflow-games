# STATUS LEDGER: read this first, then COMMON.md and RESUME.md. Do not redo anything marked DONE.

Last updated 2026-10-07 17:20 CDT, branch `claude/exciting-faraday-2dakqx`, local commits only (NOTHING is pushed to GitHub).
**CDN: DEPLOYED 2026-10-07 ~17:10 CDT with the owner's yes (files only, `--no-portal`, publish status untouched): commit 2683d349 built clean (vite, 1139 of 1229 KB), boot-checked (desktop + phone, strict CSP, 0 errors), thumbnail = a 1280x720 title-card capture (no paid cover), 9 of 9 files uploaded and verified byte-identical live; https://forgeflow-games-cdn.isimcha85.workers.dev/squish-keeper/index.html . It does NOT contain: SHELL-4 fixes, the UI overhaul, lock / multi-pull, the ground fix, anything after 2683d349. The portal pages (prerender) were not rebuilt. The next deploy needs the owner's yes again.**

## DONE: do not redo (evidence in the named report or commit)
| Item | Commit | Verification | Where the evidence is |
|---|---|---|---|
| Windows tooling (portable `startVite`, Playwright copy, snapshot and tree-hash helpers), session briefs | cd3213a8 | n/a | RESUME.md, VERIFY.md |
| Two fingers on the body never pick it up (only a lone hand does) | 19f62137 | engineer only (probe_cut B3b, fails on old code); **independent physics check still pending (Stage 3)** | `probe_cut.ts` B3b |
| Taps pay nothing; squeeze 0.6/s and stretch 0.65/s pay; medley = squeeze + stretched pull (level >= 0.35) | 2f9cc8fc, c8d6255a | taps: independent PASS (`VERIFY_ECON_NOTAP.md`); the medley change: checked by the orchestrator only (probe rows, sim re-run) | `ECON_NOTAP.md`, DESIGN 5.4 |
| Daily tasks no longer count taps ("Ten quick squeezes", "Stretch three of them as far as they will go") | a51bab3b | orchestrator only | `probe_collection.ts` P06 |
| Shift + drag pulls both sides (mouse / pen) | 4455ff29 | independent PASS, 5 minors (`VERIFY_INPUT_SHIFT.md`) | `INPUT_SHIFT.md` |
| Left mouse click on empty space no longer turns the view (right / middle only; finger and pen unchanged; Snap tool too) | aecf1061 | node 128/128 + 183/183, real browser 37/37; no independent check | commit message |
| Render parts A, B, C, O1, O2, full harness, fix round 1 (4-body mat MAJOR fixed) | 58fb66ec, 962cc5b0 | **independently VERIFIED, both lenses PASS** (A: `VERIFY_RENDER_A_R1.md`, full harness 293 ok / 0 FAIL / 1 KNOWN physics, 0 console problems; B: `VERIFY_RENDER_B_R1.md`), covering commit 962cc5b0; the minors are listed under KNOWN OPEN | `RENDER_R.md`, `RENDER_FIX1.md`, `VERIFY_RENDER_A_R1.md` |
| Specs: LOCK and MULTI-PULL, UI | 2892e3ce, 3bc066bc | n/a | `_spec/LOCK.md`, `_spec/UI.md` |

## IN PROGRESS (continue from the running report, never from scratch)
- **SHELL-4** (workflow `wf_61703f7a-6e1`, a CONTINUATION after a usage-limit cutoff; WIP commit d6905808): running report `SHELL_4.md` (its status table says what is done). MEASURED, do not redo: the baseline (tsc clean; node_checks 114/114; probe_app 183/183; probe_gestures 128/128; probe_cut 17/17), the as-found run of the four SHELL-4 browser sections (38/39, the one failure was a test fault, fixed), the as-found Reconnect-all bridge (0.02 s) and slime-strand gap (0.005 to 0.03 m), the physics neck swell reproduced in the real shell (thudge x1.84, boingle x1.94: PHYS owns it). WRITTEN, NOT YET RUN: portable prod-build, held-press capsule-loop row, the xp section, held bridge gap + 0.16 m parting gap (cut.ts), lift haptic + real-engine spies (feel-routes), hint pill clear of the capsule, phone-names, two-touch, bendWithPress node check 7f. Left: run those, the whole browser harness in batches, X01 to X10 mapping, screenshots, final run + bundle, then two independent verifiers (A cut tool, ports 5372/5373; B tray/Snap/UX, 5374/5375). Not its job: Shift pull, left-click rule, taps-pay-nothing (done above), restyling (UI stage), physics, render, audio.

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
- RENDER minors left after both verifiers PASSED (none MAJOR): slime parting strand still a short thick bracket (cause was the shell gap, now in SHELL-4); a Calm overlapped-ceremony chain at 4 (not reachable through the shell); whole-again luminance tick mixed (skeinara slightly larger, kneadle better); cut-swap luminance step above 0.04 for 4 families (IMPROVED from 5); med / low colour drift for 8 of 50 species; phone 4 to 5 body mat is small; Legendary capsule overlap worse on the 390x844 phone (0.175 to 0.261) though better on every other size; a body brought out onto an occupied mat slot pops out after 0.3 s; CUT X08 frame-budget ratio x1.32 to x1.45 against the 1.5 bar (noisy, little headroom); the hint pill over the capsule foot (shell, in SHELL-4).
- Process: `probe_collection` C08 allocation row fails on this PC on the old tree too; `snap.mjs` drops node_modules/*/dist (use a junction); usage limit cuts agents off about every 2 hours of three agents: always keep a running report.
