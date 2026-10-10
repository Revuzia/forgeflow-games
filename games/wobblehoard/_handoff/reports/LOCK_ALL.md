# LOCK_ALL: running report (lane ALL, leg "Verify: lock-fix"). No git write command is run.

Findings in: LOCK_VERIFY_phys.md (A..F), LOCK_VERIFY_shell.md (MAJOR-1 = A, MAJOR-2 float, MINOR 3..5). Order: MAJORs (A, MAJOR-2, B, C), then cheap MINORs. tsc clean after each step.
Machine: 100 % CPU from other lanes all session (probe_softbody --quick, k08, grid2 running); every number below is from a loaded PC.
Tools: the verifier's `Temp/vp/mine/lv.ts` run against the WORKING TREE (`--root=<G>`; it holds the uncommitted CUT3 edits, which the verifiers did not check), scratch `scratchpad/all/`.

## Baseline (working tree, before any edit)
- `lv.ts --only=over --species=granulo,dollop,twangle`: lock success by target x1.0/1.08/1.14: 9/9 each; x1.2, x1.5, x3.5: 0/9 each (pull level 0.05..0.09 while carried); second lobe with one lock held at 3.5x: locked 3/3, never carried. Same as the verifier (68 s).

## Steps
### A / MAJOR-1 (a drag past the pick-up line lifts the body and Shift cannot lock): code done, probes in progress
`src/physics/softbody.ts` (grab / carry / lock regions only): (1) `LIFT_OVER` 1.15 -> 1.3 (not higher: probe_gestures' "asked 1.8 x" drag is a raw target of only 1.43 (cushlet) .. 1.65 (twangle) x maxPull in the world, measured with a print in a temp copy of section 11; at a 1.5 line dollop and cushlet no longer lifted, "plain drag still picks the body up" went 2/4: that check is NOT loosened); (2) `LIFT_DWELL` 0.3 s: the target must stay past the line 0.3 s (`Grab.overT`) before the body lifts; (3) `lockGrab` on a CARRIED body now puts the lift back: `startCarry` keeps the pre-lift pose (X, V, glued feet, centre; arrays made on a body's first lift), `putDownForLock` restores it and holds the eased target at the full pull, then the normal lock runs. Only for a lone hand on the carrier slot and only when the held pull would be >= 0.95; otherwise nothing changes (false).
Measured (`lv.ts --only=over`, granulo/dollop/twangle, ramps 0.2/0.5/1.5 s, working tree): lock success by target x1.0..x1.14 9/9 (as before), x1.2 9/9, x1.5 9/9, x3.5 9/9 (was 0/9 for the last three); second lobe with one lock held at 3.5x: 3/3, never carried. At 3.5x the body IS lifted at 0.43 s (dwell) and the Shift tap puts it back (7 species x 2 delays, own `a1.ts`): lock true 14/14, after the lock fold 69..110, volume 0.99..1.06, lowest particle 0 mm, no hop, release pays one snap 1.00 with heldFor 4.5 / 5.1 s, ends volume 1.00 stretch 0.
Existing checks, unchanged: probe_cut B3 (pick up and toss) PASS and B3b (two fingers never lift, lone pull lifts) PASS (0 of 24 lifted, 0 failures to lift; row-only copy, 251 s); probe_gestures section 11 plain drag lifts 4/4 at line 1.3 (temp copy, see above).
Not a physics-only fix for the shell: nothing else changed, the driver already calls `lockGrab` on every active slot.
