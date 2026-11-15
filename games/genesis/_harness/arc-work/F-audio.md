# F-audio ledger (Lane F, sonnet task 5), 2026-11-15

Music untouched (no edit to musicplayer, score, assets, levels).

| task | change | proof |
|---|---|---|
| 5 | `src/audio/duck.ts` (new): `duckTarget(now, until)` and `newsReach(...)` lifted verbatim from `engine.ts` (duck 0.45 / 0.12 s glide, back to 1 / 1.2 s; news mul `max(0.3, attenuate(dist, hearingRef(reach*1.5, alt)))`, spread 0.15 / 0.45, off-planet 0.28 unplaced). `engine.ts` now calls them; numbers unchanged | `tests/audio-duck.test.ts` (3 tests): fake clock duck returns to exactly 1, hold only extends; news nearer louder, altitude widens, 0.3 floor, spread and off-planet cases |

## Proposals for the opus mix tasks (not done)
1. Priority ducking of ambience: in `engine.ts` the single `duckUntil` only affects the music bus (`kDuck`, ~l.581) and is set in `play` (~l.705-708) and the `:771` hold. Add a second knob on the ambience bus fed by `spec.pri` (>=7 duck ambience ~0.6 for 1.5 s, using `duckTarget`-style helper in `duck.ts` so it stays testable).
2. Designed silence: `ambience.ts` ~l.260-264 bird/insect spawn rates; multiply by a `quiet` factor that drops to ~0.1 on the `warning` cue (eventmap `warning`, pri 7) and for ~20 s after any pri>=8 news, easing back over ~10 s. Expose via an `Ambience.setQuiet(until)` called from the cue path next to `heardThunder()`.
3. Settlement one-shots by era and building type: `eventmap.ts` `built` already carries `variant: building`; key `sfx.ts` recipes on (variant, era from the view) and add herd-animal call recipes triggered from ambience near livestock settlements.
4. News severity above 100x: scale `size`/gain in `eventmap.ts` news specs by `view.speed` bands (a hold on lower-priority news at >100x, merging via `CueGate` keys); covenant family: new `covenant.*` recipes in `sfx.ts` (not in score), mapped from the covenant events in eventmap.
