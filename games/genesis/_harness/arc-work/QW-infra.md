# QW-infra ledger (quick wins 1, 3, 4, 10, 12, 13, 14), 2026-11-15

| # | change | proof |
|---|---|---|
| 1 | `_harness/arc-work/STATE.md` rewritten as a built / verified / unverified table per ARC section | focused arc tests run today: 134 / 134 |
| 3 | cues `tower.lost`, `secession` (new SFX recipes in `src/audio/sfx.ts`); `collapsed` plays a quiet `landslide`; `SILENT_EVENTS` (with reasons) in `src/audio/eventmap.ts` for `aid`, `content.plant`, `fire.out`, `harvest`, `hunt`, `livestock.killed`, `material.first`, `ore.seeded`, `tame`, `warning.end`, `weather.end`; music untouched | `tests/audio-events.test.ts` (scans src/sim for event names; fails on any unmapped), `tests/audio-arc.test.ts` updated |
| 4 | `src/persist/guard.ts`: `navigator.storage.persist()` after the first successful save, banner "Saves are unavailable in this window ... Export your world" for no IndexedDB / quota under 150 MB / a save the browser refuses (not a full quota). Wired with one line in `src/app.ts` that decorates `ui.saves.store.put`; no `src/ui` file edited | `tests/persist-guard.test.ts` (5 tests, fake env and DOM) |
| 10 | `public/game_meta.json` (the file the build ships; there is no top-level one): `has_mobile_support:false`, difficulty easy to medium, "English only. Desktop only..." added to the description. Genre `strategy` is a site category slug | `tests/release-check.test.ts`, `tests/ui-meta.test.ts` still pass |
| 12 | `.github/workflows/genesis-check.yml` (npm ci, npm run check, npm run build; path-scoped); `npm run release-check` = `_harness/release-check.ts` | `tests/release-check.test.ts`; `node _harness/release-check.ts --no-build` ran against the old dist and failed only on "stale dist/game_meta.json" |
| 13 | `/__shot` plugin only when `GENESIS_SHOTS=1` (`vite.config.ts`); `shots.mjs` and `perf.mjs` set it; `_harness/README.md` written | `git check-ignore -v dist _shots` shows both ignored (repo `.gitignore` lines 114-115) |
| 14 | wind bed: the 0.03 floor was a constant hiss in dead calm; now a gate with hysteresis (open above drive 0.02, close below 0.008) in `SceneProbe` (`src/audio/scene.ts`) | `tests/audio-wind.test.ts`: before the change it failed with actual 0.03 at wind 0, 1-14 m; now 0, and breeze, gale and altitude still sound |

## Not done / handed over
- #10 trim of `controls_keyboard`: the string is generated from `src/ui/controlstext.ts` `metaKeyboard()` and
  `tests/ui-meta.test.ts` fails if it differs. Trimming needs the ui owner to shorten `metaKeyboard()`, then run
  `node _harness/gen-controls.ts`. I did not touch it.
- #12: there was no `.github` directory in the repo, so there were no conventions to follow.
- A hand-started `npx vite` no longer serves `/__shot`: set `GENESIS_SHOTS=1`.

## Gate
`bash _harness/slot.sh npm run check`: detban, typecheck, 972 / 972 tests pass (17 min under load). `npm run build` ok. `node _harness/release-check.ts --no-build` all clear.
