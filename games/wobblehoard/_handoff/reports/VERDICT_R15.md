# VERDICT_R15: independent check of Squish Keeper round 15 before a deploy (2026-11-24)

**VERDICT: (pending)**

Verifier: independent; writes no file in `src` or `_harness`, runs no git write command.
Tree checked: a copy (tar, excluding node_modules / dist / _shots / _renders / _live_snapshot / _handoff; node_modules symlinked) of the working tree at
2026-11-24 08:48:57 UTC, HEAD ff711b46d, `git status`: only `?? _harness/_dbg_su.ts` (an engineer's debug copy); `diff -rq src` copy vs tree at copy: empty.
Reference ("live"): `git archive 6c495e9c1`, built in scratch.
Known in flight (engineer, NOT checked here): Frostbell self-use flip-flop, a pinch starting on an AUTO chip, the phone rooms harness run.
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_verify_r15/` (`V/` below): `snap/` (copy), `live/`,
`scripts/`, `logs/`, `shots/`. Ports: 5384 dev of the copy, 5385 prod of the copy, 5386 live prod, 5387 live dev.

## How to continue if cut off
Never redo a check marked DONE. Scripts in `V/scripts/` (R14's copied and extended); a phase runner `V/scripts/run15.sh` skips anything already `rc=0` in
`V/logs/run.summary`. Restart servers with `bash V/scripts/servers.sh`.

## Checks
### (1) Build (DONE 08:50; `V/logs/tsc.log`, `build.log`, `build_live.log`, `V/scripts/fp.py`)
- `tsc --noEmit`: exit 0. `vite build` copy: exit 0; live 6c495e9c1: exit 0.
- Gates (copy vs live): [G0] 2572 vs 2532 KB of 3072; [G0b] first-play 466 vs 464 KB gzip of 600; **[T1] 2152.1 vs 2111.1 KB of the 2250 cap: pass, 97.9 KB headroom** (+41 KB vs live; R14 was 2144.3).
- First play (html + every non-`later-`, non-`life_` asset): **1524.2 KB raw / 467.3 gzip vs live 1519.8 / 465.7: +4.4 KB raw, +1.6 KB gzip.**

### (2-F1) probe_softbody hostile fuzz (DONE 08:54; `V/logs/HOSTILE_{1,2,3}.out`)
- `--families-hostile` three runs: **2/2, 2/2, 2/2** (74 / 76 / 96 s; 0 failures, slowest settle 3.20 s, worst elastic shape 1.66 % R of the 3 % bar; the engineer's report reads 0.27 % R: a different number, same pass). Full `probe_softbody` (09:11, 598 s): **115/116**; the one red is G1p "warmUp() covers a lone finger" (2976 B / 2976 B against 0 B), an allocation row; the live tree reads the same `{"late":[2976,2976]}` by its own `--late-press-child` (`V/logs/G1P_live.out`, `G1P_new.out`): = live. **F1: FIXED** (the hostile fuzz green 3 of 3; the previous verdict's red was 1 of 2).

### (2-F4) node_checks: **186/186 three times** (DONE 09:01; `V/logs/NC_{1,2,3}.out`, 141 / 138 / 131 s; live: 185/186). **F4: FIXED** in count. The rows re-specified in round 15, read one by one (DONE 09:20; `git diff 6c495e9c1 HEAD -- _harness/shellview/node_checks.ts`)
| row | what changed | still guards what it guarded? |
|---|---|---|
| cabin framing reaches its front things | numbers now read from the place data (Rocker Board z + 0.3; wide reach within the front-most thing + 1.2 m and the bounds) | **yes** (stronger: no copied numbers; the +1.2 m slack on the wide reach is loose but the old row only asked `<= 2.4`) |
| rig camera `lookAt` / `lookHome` (new helper) | the rig's fixed camera moves over the floor to the thing a row taps, same pitch and distance | yes for the thing-tap rows; it no longer proves the thing is in the GAME's own view (that is checked by real input here, (2-F2)) |
| D-95 AUTO chips | the Rocker Board chip is read with the camera looking at it, the swing's with the home look | **weaker**: both chips are no longer required on screen in ONE frame (the live row did); "one control each, off by default, on screen" still holds per chip |
| D-95 the hand on the seat | squishies on the seat or in its line are set 2.1 m aside first | yes for "a hand on an EMPTY seat"; the case "a squishy in front of the seat takes the press" is now outside every row (it is the game's rule, not a fault) |
| "Go play with... a ride" | a rider is taken off the seat first; a squishy over 2 m from the seat is placed in front of it first | yes for "the ask lifts it onto the seat and it rides"; **no longer covers a far ask** (the reason at the row: from 4.6 m the walk at 0.22 m/s took over 10 s). The walk part is covered by real input in (3) here |
| Shake Pine | waits for a quiet pine, clicks 1.05-1.15 m up the trunk with the camera looking at the pine; snow: +0.4 OR the coat already over 0.5 and full (>= 0.9) after | **slightly weaker**: with a coat already over 0.5 the row no longer proves the click's puff added snow (the puff drawn and the USE record are still asserted) |
| Lanternroof vane / scope / chimney, Cloudloft pad / Updraft / arch | spots read from the place data instead of copied live numbers; camera looks at the scope / chimney | **yes** (the same assertions; the Updraft row still uses `placeAt` 1.3 m up, not a carry set-down: F5 is checked by real input) |
| carry-up press | aimed at the play body's own projected disc | yes |
| piece limit with a party (D-103) | 6 -> 12 (party budget) | yes, the owner's D-103 |
| Home carry with the party (D-104 / D-105, R14) | carries back on the level plane | yes, the owner's D-104 / D-105; one-out Home keeps the published pull (probe_carry K2, probe_gestures C6) |
