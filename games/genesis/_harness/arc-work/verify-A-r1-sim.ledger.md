# verify-A-r1-sim ledger (verifier, sim, stage A round 1, 2026-11-07)
Probes (tracked): _harness/arc-work/verify-A-r1-sim.ts (world/harsh/kind), verify-A-r1-kind.ts (kind diag + dusk).
Logs: _harness/scratch/arc/verify-A-r1-sim/{live1-4,live5-8,cut,cut68,m3}.results, kind2.log.
- M1: 8/8 seeds x 25 y, 0 town-days without SettlementView.heart after day 2. PASS.
- M2: median kind changes per 6 days 0.00-0.09 per seed (max town 0.23). nobow <= 1 / 2 y by construction. PASS.
- M3 harsh (storm r350 + lightning, wrath 0.3, every 4 days x 3 y): fearful within 1 y 8/8 PASS; heart.nobow 0/8 FAIL
  (dusk ema max 0.24-0.32: never above duskHigh 0.45, so dusk.low can never arm). Even a town at faith 0.93/loyalty 0.74
  reaches dusk ema only 0.43 after 4 y (kind diag seed 3).
- M3 kind: answered prayers never happen (no open prayers in a fresh town); gifts+life.bless -> devoted by ~day 22-25 on 8/8.
- Unattended 25 y: proud flag set on 6/8 seeds (pride 0.62-0.74 by y 12-19); pride later collapses to ~0.1 on 4 seeds (pop < 40 cliff).
- §10 natural floods 8 seeds x 25 y: 64 floods, 9 reached a town in seeds 5-8 (evac 9/9 = 100 %, all members out at the water);
  deaths 0 warned vs 0 unwarned (cut baseline seeds 1-4, 6, 8: 0). Death comparison non-discriminating.
- §2.2-2.7 tower: ABSENT (no tower.ts). §6.5 hearts free text: ABSENT ("are they angry" -> not understood).

## Re-run on the current tree (2026-11-07 ~15:25Z; hearts + tower landed since the entries above)
Probes: verify-A-r1-sim.ts (+ runner verify-A-r1-sim-run.sh), NEW verify-A-r1-tower.ts (+ .sh): babel, rise to the first
tower.choice, answer confuse|strike|warn|let|silence|none(baseline). Logs: scratch/arc/verify-A-r1-sim/r2/*.log.
- M1 8/8 x 25 y: 0 town-days without heart after day 2. PASS. M2 median 0.00-0.09 changes / 6 days. PASS.
- M3 harsh: fearful <= 0.72 y 8/8, heart.nobow 8/8 (via the `shunned` rule; dusk ema max 0.09-0.18). PASS.
- M3 kind as specified (answered prayers + gifts; no prayer ever open in 2 y): devoted 0/8 (all 24 days quiet). FAIL as
  specified; the sim lane's PASS used life.bless (not in the spec's kind run) and lands at day 22-25 (the 2 y edge).
- §10 25 y x 8 seeds: 15 natural floods reached a town, 15/15 evacuated (outShare 1.0); flood deaths 0 live vs 0 cut:
  the "deaths fall vs baseline" line cannot discriminate. Other kinds: counts equal per seed (blight/infestation +-2 chaos).
- T6 confuse 7/8 so far: langDistance exactly 0.72 every pair (2 drifts x 2 x 0.18; at the threshold), line0 kept, langSeed
  changed, style changed in >= 2 towns, 2-4 daughters founded within 30 d, existing relations -0.25; 4-6 of 6 league pairs
  have NO relation record (never met), so nothing is lowered for them (first contact later starts at 0.02 instead of 0.20).
  First tower.choice at 0.92 y and h0 20.61 on EVERY seed (babel is seed-insensitive up to the choice).
- T6 confuse vs `none` baseline (same seed, same tick, no answer), deaths in the 30 days after: cold 33/52/10/41 on seeds
  1/4/5/8 after confuse vs 0 cold on all 8 baselines (totals 65 vs 25, 66 vs 30, 43 vs 21, 74 vs 41); war deaths over 5 y
  31/16/29 on seeds 2/5/6 after confuse vs 0 war on every baseline. -> T6 "0 deaths" FAIL (indirect: the scattering).
- T7 strike 8/8: dead 0-9 (<= 10), pride x0.5 ok, defiance +0.2 and tRebuild set on all; rebuild 0/8 in 5 y although
  pride is back >= 0.6 by y5 on 6/8: rebuildRoll hashFloat(tw.id, yearIdx, 0x70e4) has no world seed; tower id 1 passes
  only in years 18, 35, 37 -> a tower 1 struck in year ~1 can never be rebuilt on any world.
- T8 warn 8/8: refused by 32/32 towns (heed clamps to 0.05: pride 0.77, faith 0.12); heed roll hashFloat(tw.id, s.id,
  0x70e5) has no world seed: tower 1 rolls 0.920/0.810/0.814/0.877 for towns 1-4 on EVERY world (town 1 above the 0.9 cap
  -> can never heed). Reproduces (8/8). Re-warn blocked 1 y ok; strike after refusal provoked + 0 god deaths 8/8 ok.
- T9 let 8/8: finished 7/8 (seed 1 abandoned at 94 % of goal by hardship AFTER let; then strike/confuse refused "Nobody is
  building a tower"); grievance 0 before and after in babel (halving vacuous); polities 4->4 ok; late strike/confuse ok 7/7.
  Silence 8/8: finished 7/8 (seed 4 abandoned), answer none, godActs.silence 1. Faith 0.12 -> 0.3-0.9 in let AND silence.
- Confuse cold deaths located (confuse-cold.log, seeds 4 and 1, deathsAt): ALL in the new daughter towns (ids 5-8), 14-20
  days after they were founded by the scattering (seed 4: 52 cold, seed 1: 33). The scattered households freeze.
- T2 attended (probes/arc.ts attended, 8 seeds x 14 y): first tower on 1/8 (seed 7, y12.9; leaders' pride 0.54-0.64
  elsewhere) -> FAIL (needs >= 3/8; the sim lane's open owner/spec call, reproduced).
- T2 unattended seeds 1-4 re-run (t2a.log; seeds 5-8 killed to free a slot: I had wrongly queued them as short jobs):
  seed 1 tower y24.9, half 2.83 y, 3 omens, on-site 96 %, finished (matches the sim lane).
- Signs (verify-A-r1-signs.ts): sampled at LOCAL daylight a fearful town shows fear signs 1-4 on quiet days, 7-26 on act
  days; the world probe's signHist was night-biased (planet clock), so it is not evidence. No finding.
