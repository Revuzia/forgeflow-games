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
