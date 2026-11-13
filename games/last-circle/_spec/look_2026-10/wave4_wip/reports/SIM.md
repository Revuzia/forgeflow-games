# Lane SIM (Wave 4) - Last Circle bot-match pacing (D8 step 1)

STATUS: started (first attempt; no prior REPORT.md existed).
Files owned: runtime/sim/royale.js, runtime/sim/royale.selftest.cjs, runtime/3d/royale/bots.js, runtime/3d/royale/weapons.js
Targets (D8): median match end >= 600 s; <= 12 of 49 bots dead in first 60 s; final circles (>=5) reached in most matches.
Keep: selftest storm rules (update deliberately + reason), wall never faster than a player, same-seed replay identity,
skill-banded tier mix, HEAD_CHANCE cap 0.25, no unseeded Math.random in touched files.

## Baseline (from lc_look/next-steps/probe_match.log, 2026-10-04, working copy before this lane)
6 distinct runs (1 isla_viva, 7 isla_viva, 11 ashgrid, 12 ashgrid, 13 deepwood, 23 deepwood) + seed-1 replay:
- match end (s): 332.9 / 263.7 / 314.4 / 319.9 / 333.7 / 380.3  -> median 326.6 (target >= 600)
- deaths before 60 s (of 49): 21 / 19 / 16 / 9 / 16 / 13 (target <= 12)
- every match over during storm circle 2 of 8

## Log
- 2026-10-05 (setup): driver C:/.../SIM/sweep.py runs the real probe_match.js under in-page table overrides (K = W.SIM mutated
  before each startMatch, restored after). Baseline reproduced on the working copy: ends 333/264/314/320/334/380, median 326.4;
  deaths<60s 21/19/16/9/16/13 (median 16, max 21); storm kills 0 in all 6 matches (every one of the 49 deaths is bot-vs-bot).
- soft1 (tier1-3 aimErr 9/6/4.2 deg, reaction 900/700/520 ms): median end 367 (+12%), d60 median 17.5. NOT enough alone (cheap fix
  does not reach 600 s / <=12). Tier 3 is 21 of 49 bots and tier 4-5 (20 bots, 50% of kills) are untouched by this fix.
- soft2 (aimErr 12/8/5.5 deg, reaction 1100/850/650 ms): median end 365 (+12%), d60 median 13 max 19. Still ~300 s short.
- storm125 (all storm waits+shrinks x1.25): median end 417 (+28%), d60 median 17. The storm timeline matters more than aim, but alone it
  is also not enough; and it pushes total storm time past the selftest's 960 s bound (1025 s).
- Implementation approach chosen (cheap fix is insufficient): a data table K.BOT_PACE in royale.js (noticeM per tier, landGrace, fatigueS,
  fleeEhp, pushPct, dropPtsPerBot/dropHotP, lootEarly) read by bots.js with feature detection (a sim without it = legacy behaviour).
  Placeholder legacy-equivalent values while sweeping (marked PACING-SWEEP-PLACEHOLDER in royale.js).
- storm125 (storm waits+shrinks x1.25): median end 417 (+28%), d60 median 17 (storm timeline reaches bots earlier than expected: ROTATE
  scores read the storm clock from second 0, so a longer clock delays the convergence).
- killdiag (4 matches): bots touch down at t = 21-29.5 s (median 25); every first-60-s death is 0.6-36 s after landing, 5-60 m from the
  killer (landing-zone brawls); killers are tier 4-5 in 17/21, 12/19, 16/16 (seed 1, 7, 13), weapon mostly AR. Landing proximity, not
  aim of tiers 1-3, is the first-minute driver.
- single-knob sweeps (6 runs each, medians of end / d60): notice1 [70..170 m by tier] 385 / 15.5; notice2 [55..150] 312 / 17.5;
  landGrace 40 s / 25 m 375 / 14.5 (d60 max 24). No single table-only knob gets near 600 s.
- Mechanism found in think()/onEnter(ROTATE): any bot outside the NEXT ring scores ROTATE 40-95 from second 0 and aims at a random
  point in the inner 25-75 % of that ring, so the whole lobby converges on the centre in the first two minutes. Added knobs
  rotateEdge (aim just inside the ring on the bot's own bearing) and rotateLeadS (delay the leisurely 40-score rotation), plus
  dropSepM (min separation between assigned landing spots).
- BUG caught by my own check (mine, not the game's): the first run of sweep C reproduced the baseline EXACTLY (alive@60/120/180/240 =
  29/18/12/4) for a config that should differ - bots.js had copied BOT_PACE once at init() (page boot), so an edited table was never
  seen. Fix: loadPace() re-reads the table at every match start (setLobbySkill) as well. Sweep C (and everything after) was re-run.
  (Sweep B, which ran with the by-reference read, is unaffected: its numbers differed from baseline as expected.)
- combo1 (VALID run; dropSepM 100 + rotateEdge 0.8 + rotateLeadS 0 + noticeM [70,90,110,140,170]): ends 395/298/392/470/398/369, median 393.8;
  deaths<60s 13/16/5/5/8/5 (median 6.5, max 16 - isla_viva seeds 1 and 7 still 13-16). First-minute brawls fixed on 4 of 6; the mid-game
  (alive@120 s = 17-26) still collapses: kills 0.3/s between 60 and 120 s, before the storm has shrunk at all. Next levers added to the
  table: chaseM (un-provoked bots do not walk past their tier's reach to close on a stranger) and pushM (gunfire answered only inside
  this range).
- sweep D (6 runs each; median end / d60 median,max): chaseM [45,55,65,80,100] alone 470 / 14.5,20 (the single strongest lever: fights are at
  the 30-45 m a bot closes to, so un-provoked bots stop closing); combo2 (sepM 100 + rotateEdge 0.8 + rotateLeadS 0 + noticeM [70..170] +
  chaseM + pushM 120 + pushPct 50) 477 / 6,17 (ends 447-570); combo3 (= combo2 + soft tiers 1-3) 444 / 5,16; combo4 (tighter caps) 430 / 6,13.
  Knobs saturate at ~430-480 s: alive@300 s is 8-16 but then 12 -> 2 in ~120 s. Cause: `endgame` (<= 10 alive) switches on HUNT,
  ENGAGE +20, camping off, PUSH off - at the new pace that is circle 2 (t ~ 330 s), and the hunt ends the match ~100 s later.
  Added knob endgamePhase (endgame counts only once the storm has reached that circle).
- sweep E (combo2 + endgamePhase): eg4 (endgame counts from circle 4) 571 median (514-590); eg5 612 (514-655; circle>=5 in 3/6);
  eg5 + storm x1.12 (waits+shrinks, total 918 s) 692 (651-731; circle>=5 in 5/6), d60 median 5.5, stuck <= 1.7 %. The match end is now set by the
  storm clock (the hunt starts when the ring reaches circle 5), not by how fast 49 bots can reach each other.
- dropdiag (nearest other landing, m): sep 100 worked on ashgrid (min 101) and deepwood (min 100) but NOT on isla_viva (13 bots < 50 m): the
  random-ground fallback (10 tries) cannot find a free point once ~35 landings fill the small island, so it dropped the rule. Fixed:
  fall back to the untaken gun spot FARTHEST from every placed landing (best candidate, no rng), then best-of-24 random ground. After:
  isla_viva min 64-66 m / median 78-90 m, 0 bots < 50 m; deepwood min 100.
- sweep F (old chase code, in-page overrides, with the farthest-spot fallback): F = sep100 + edge0.8 + rotLead0 + notice[70..170] +
  chase[45..100] + pushM120/50% + endgamePhase5 + storm x1.12: ends 701/612/701/689/684/651, MEDIAN 686.3, d60 8/12/6/5/5/2 (max 12),
  circle at end 5/4/5/5/5/4 (5 of 6 reach circle 5). F_sep70: median 670 but d60 on isla_viva 13 and 15 -> sep 100 is needed.
  (Ablations of edge/rot/notice/push were NOT finished: the box (CPU 94 %, 84 Chrome procs) made each config ~10 min; killed after F_sep70.)
- SHIPPED (code, not in-page): royale.js BOT_PACE = {noticeM [70,90,110,140,170], chaseM [45,55,65,80,100], pushM 120, pushPct 50, dropSepM 100,
  rotateEdge 0.8, rotateLeadS 0, endgamePhase 5}; STORM_PHASES.standard x1.12 (ints; ends 269/437/566/673/757/825/875/920 s); BOT_TIERS untouched.
  bots.js: dead knobs (landGrace, fatigue, flee, drop caps, lootEarly) removed; out-of-reach un-provoked target is dropped for 6 s (a shotgun
  must not stand and watch a man 60 m away); quick mode keeps legacy pacing (loadPace(W)). Selftest 178/178 (was 163; +15 pacing rows).
  New gate: _harness/new/sim_pacing.py. NEXT: run it on the shipped defaults (10 runs incl. seed-1 replay), then probe_match, botcheck, boot gate.
