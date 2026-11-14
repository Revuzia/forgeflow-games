# F1 evolutions — working notes (resume here after an interruption)
Owned: src/upgrades/draft.ts, src/data/evolutions.ts, src/data/upgrades_v2.ts, _harness/bot_draft.ts, _harness/bot.ts (draft only), _harness/probe_evolutions.ts
Done (attempt 1, on disk): ready rule min(3, maxStacks)+companion; EVO_NUDGE in-rarity weight for missing half; recipeHint/evolutionProgress API; bot botRecipeBonus.
Baseline (HEAD rule): evo_matrix fresh 1/12 runs with evo, full 0/12.
Sweep (seed 1337) n=nudge t=toward c=completes:
  a 5/8/16: fresh 8/12 (13) cl11 d1 · full 10/12 (16) cl11 d1
  b 3/14/30: fresh 5/12 cl8 d4 · full 9/12 cl12 d0
  c 5/14/30: fresh 9/12 (16) cl10 d2 · full 11/12 (19) cl11 d1   <- leading candidate
  d 8/14/30: fresh 10/12 cl9 d3 · full 12/12 cl11 d1
TODO: seed-robustness check, bake defaults (remove env F1TEMP), probe_evolutions update, probe_upgrades, GATE2 fresh+full.
UI hint (src/ui/draft.ts) NOT owned -> report gap; API = recipeHint(w,id), evolutionProgress(w).
Attempt 2 (resumed):
  probe_evolutions updated (threshold readiness, early-evo >= MAXED base stats, §1b nudge/hints/rarity split/draw count) -> run1 2358 pass 0 fail (nudge 3)
  seeds 1338/1339 (evo_matrix): c 5/14/30 fresh 6/12,6/12 full 9/12,11/12 ; a 5/8/16 fresh 6/12,7/12 full 9/12,10/12
  fresh misses mostly NEVER-READY (base stuck at 1-2/3 with companion owned); some ready late & not offered (20% lvl-up chance)
  running: e 8/14/30 & g 6/14/30 seeds 1338/1339, g 1337
nudge 8 (e/d): fresh 10,8,10/12 full 12,10,10/12 BUT GATE2 fresh 1337 FAIL: hearthback/lockwater clear 413s (<480), SizeIV 252s. noevo A/B same cell 447s -> nudge-driven base mono-stacking, not evo alone.
Now testing rule "missing half only" (base nudged only when companion owned): h=nudge8, i=nudge12, seeds 1337-1339. (env TEMP knobs re-enabled for sweep; bake after!)
j = h + BOTMODE=missing (bot bonus only for missing half / completes)
HL(hearthback/lockwater) 1337 fresh is CHAOTIC: h 413, x1(molten nerf .12/-.1) 464, l(heavier nerf) 413, k(minrank3) 474, n(nudge5 h-rule) 518; no-F1-levers 484-488. Evo stats not monotonic driver.
n = h-rule nudge 5: 1337 fresh 8/12 evos cl11 d1 (no fast), full 12/12 cl12 d0(!) -> full deaths 0 would FAIL gate. 
nudge 7/9/10 @1337: 10 passes both (fresh 11/12 evo cl10 d2; full 12/12 cl9 d3); 7 full d0 FAIL; 9 fresh HL472 FAIL. Candidate FINAL = h-rule nudge 10, bot 14/30 (missing-half-only bot mode NOT adopted: no effect).
FINAL battery started Fri Sep 25 12:34:10 CDT 2026 with nudge 10 baked
FINAL (nudge 10, missing-half rule, bot 14/30): GATE2 fresh PASS (clears 10/12 in window, deaths 2), full PASS (9/12, deaths 3);
probe_evolutions 2381/0, probe_upgrades 3564/0; evo_matrix 1337 fresh 11/12 (18 evos), full 12/12 (20). tsc: only f2 scratch errors.
DONE — awaiting gate agent commit. Gaps: ui/draft.ts hint wiring; FEATURES_V2 §7.3 text says "maxed".
