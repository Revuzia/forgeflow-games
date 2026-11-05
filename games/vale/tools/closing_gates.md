# VALE closing gates

The standing gate list for the integration pass and the parity review. Bars come from each harness's own header and from `_design/reviews/fixwaves/owner_rulings.md` (rulings 1-17, 10a). If this page and a ruling disagree, the ruling wins. Nobody relaxes a bar here: report the miss to the lead.

## How to run a pass

```
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH
export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd games/vale
```

1. **Rebuild the catalog first.** The client reads `dist-catalog/`, not `content/` or `art/out/`. After any content, GLB, card or store change, run `npm run content`, or the probes measure old art.
2. **Record the load.** Run `uptime` before and after every gate, and report the command, both loads, the number, the bar and the report path.
3. **Keep the machine idle for "load < 3" gates.** Run one at a time, with no parallel agents or background jobs.
   - A timing gate run at load >= 3 is `not_measured`, never a pass.
   - Use `--wait-idle <min>` where the harness offers it (only `perf_1080` does). For the others, check `uptime` yourself before starting.
   - If the load stays high for over 15 minutes because of something outside the workflow, record the `ps` output and mark the gate `not_measured`.
4. **Clean up.** Run `zsh tools/reap_orphans.sh` after harness runs, and add `--kill` only for your own leftovers.

The Load column means:

- **any**: pure node, or counts that do not depend on the machine.
- **< 3**: needs an idle machine. A run at load >= 3 is `not_measured`.
- **< 3 (timing half)**: the hard checks hold at any load, but the timing checks do not.
- **< 3 (clean)**: not a frame timing, but the lanes saw load-driven false failures, so only an idle run counts as closing evidence.

## Build and integrity

| Gate | Command | Bar | Load |
|---|---|---|---|
| Catalog | `npm run content` | exit 0, 0 warnings | any |
| Types | `npm run -s typecheck` | exit 0 | any |
| Assets | `npm run -s content:check` (no allow-missing flag) | exit 0, 0 warnings: every referenced asset exists | any |
| Sim and session probes | `npm run -s probe` | 0 failed, 0 skipped | any |
| Production build | `npm run -s build` | exit 0. Leave `dist/` in place for the next agent | any |
| Store | `node tools/gen_store.ts`, then `--check` | exit 0: standard dE >= 12, deluxe and legend dE >= 18. See note 1 | any |
| Secrets | `npm run -s secrets` | exit 0 | any |

## Client journeys

| Gate | Command | Bar | Load |
|---|---|---|---|
| Flow journeys | `node _harness/e2e.mjs flow` | all three journeys ok (dodge, ready check, server down) | < 3 (clean) |
| Full e2e (CW3c done:7) | `node _harness/e2e.mjs all` | one single sweep passes everything | < 3 (clean) |
| Overlays | `node _harness/overlay_regress.mjs` | prints `overlay_regress: PASS` | any |
| Icons | `node _harness/icon_probe.mjs` | p50 >= 60 and p95 >= 190 at 38 and 40 px; ground rules hold; 0 missing | any |

## Performance

| Gate | Command | Bar | Load |
|---|---|---|---|
| Production frame budget (r12 B4) | `node _harness/perf_1080.mjs --prod --match-seeds 7,11,23 --wait-idle 30` | see the list below | < 3 (timing half) |
| Ultra 60 (PERF-C1) | `node _harness/perf_1080.mjs --prod --no-build --q ultra --wait-idle 30` | Ultra 1080p at 60 fps. The default `--prod` run covers High and Low only, so Ultra needs this run | < 3 |
| Real-time match (b4-realtime) | `node _harness/perf_1080.mjs --prod --no-build --match-only --match-scale 1 --wait-idle 30` | >= 99 % of wall-seconds at 58+ frames, no second under 45 | < 3 |
| Dynamic resolution on Metal | `node _harness/probe_dynres_metal.ts` | prints PASS. The simulated GPU leaves the scale within 10 s, recovers to >= 58 fps, holds 1.0 at a steady 60 and on CPU-bound frames | any |

`perf_1080 --prod` bars:

- **Hard, at any load:**
  - High and Low: <= 500k triangles a frame, <= 450 draw calls, <= 40 programs.
  - The menu never moves the render scale.
  - The GPU-bound step leaves its base scale within 10 s.
  - Calibrate returns a preset, and never `high` at 9x the pixels.
  - Memory: the GPU process grows <= 5 % from menu_2 to the last menu, and tracked materials and geometries stay flat (<= +2).
  - Renderer + GPU <= 2500 MB at every Home.
  - 0 leftover skeleton bone textures at the last two Homes.
  - Match seeds: 0 programs first seen after the opening minute, on all three seeds.
- **Load < 3 only:**
  - Renderer CPU <= 6 ms mean on High and Low.
  - High: <= 1 % dropped frames, avg >= 59.4 fps, p95 <= 17.2 ms, p99 <= 25 ms.
  - Low: no dropped frames, p95 <= 17.2 ms.
  - Match dynres ends at High's own scale, 1.0.
  - GPU-bound tail: last 8 s average >= 58 fps.
  - Calibrate returns `high` at 1080p.

`--prod` builds its own bench into `_harness/_prod/dist`, so it does not touch `dist/`. `--no-build` reuses the last bench build.

## Combat and kits

| Gate | Command | Bar | Load |
|---|---|---|---|
| Kit hue | `node _harness/probe_kit_hue.mjs --live` | 64/64 slots at signature share >= 0.5, team light <= 0.35 on a3 and ult. Exit 1 = under a gate, exit 2 = a slot not measured. One clean sweep is needed | < 3 (clean) |
| Skin hue | `node _harness/probe_kit_hue.mjs --skins --live` | each skin's a1 and ult reach signature share >= 0.5 against the skin's signature | < 3 (clean) |
| Ult and hit polish | `node _harness/probe_combat_polish.mjs ult,hold --ults all` | see the list below | < 3 (clean) |

`probe_combat_polish` bars:

- **ult, all 16:**
  - First-beat core >= x2.0. Rulings 10 and 10a make x2.0 the working target while the clip-bound reading holds on all 16; otherwise x2.3.
  - The lift adds <= 0.10 white on the body.
  - `boxWhite` <= 0.35 on every beat frame.
  - The lift's centre sits nearer the victim or the shape's centroid than the caster.
- **hold:** `discMs` >= 167 ms. `sizeMs` is information only.

## Camera and input

| Gate | Command | Bar | Load |
|---|---|---|---|
| Camera geometry | `node _harness/probe_camera.ts` | median planted-foot speed <= 10 % of moveSpeed for every fighter. Heights warn at 105-130 px at 28.5 m, compact builds 85-105 px (ruling 11); `--gate-heights` makes them fail | any |
| Bar clearance | `node _harness/probe_bar_clearance.ts` | Kemdo lens, Dunsom lantern, Hesmi rack top, Vashil halo and Tunlan brim half-covered in <= 10 % of idle and of run cases, at the default distance and 28.5 m. Hesmi's rack top also <= 10 % over attack clips | any |
| Input latency | `node _harness/probe_input_latency.mjs --tag idle --only input`, twice in a row | marker p95 <= 2 frames, motion p95 <= 67 ms + 1 frame, 0 orders with no marker or no motion, 0 attacks sent or drawn as a move, 0 attacks with no attack marker | < 3 |
| Camera, live | `node _harness/probe_input_latency.mjs --only camera` | prints `input/camera PASS` | < 3 |
| Camera jump | `node _harness/probe_camjump.mjs` | 0 bodies dropped on the first frame after a jump | any |

## Crowd and world

| Gate | Command | Bar | Load |
|---|---|---|---|
| Crowd accents | `node _harness/probe_crowd_accent.mjs --tag <tag>` | shipped vs full accent pixels within 3 % per def, no empty crop, noise floor under 1 % of full | any |
| Environment value (r12 B5) | `node _harness/value_probe.mjs --tag <tag> --shots 0 --report <tag>_value.json` | no `FAIL` in the log. See the list below and note 2 | any |

`value_probe` bars, per map and tier:

- Environment-only frame p99 <= 160, and whole frame p99 <= 180 (ruling 14).
- Fighter blowout: under 2 % of fighter pixels above L* 90.
- Frame p50 55-75 (FRAY <= 90), frame p95 <= 130.
- Lane p50 85-100, walkable and lane spread <= 45.
- T4 flash >= x2.0 (see the `flash` report row). CW4's last run read BRIDGE low at x1.87.
- The remaining rows print their own bars and verdicts in the log.
- BRIDGE High's gate flame at L* 51.5 is accepted and closed (ruling 17).

## Audio

| Gate | Command | Bar | Load |
|---|---|---|---|
| A/V sync | `node _harness/probe_audio_runtime.mjs sync` | see the list below. PASS only when all 3 runs pass | < 3 |
| Match loudness | `node _harness/probe_audio_runtime.mjs match` | master -18 +/- 1.5 LUFS, announcer peak >= 3 dB over sfx p99, heal chimes <= 6 a minute, enemyDown fires. Run on several seats, because the last verifier's result varied by seat. See note 3 | < 3 (clean) |
| Dead music | `node _harness/probe_audio_runtime.mjs dead` | the probe's own gates. CW2's verifier found a window bug that makes this flaky | < 3 (clean) |
| Mix | `node _harness/probe_audio_mix.mjs` | RIFT floor lift (M2) >= 1 dB, and the rest of the probe's own gates | < 3 (clean) |

`probe_audio_runtime sync` bars:

- Every hit starts inside its event's call.
- From the pump: p95 <= one frame + outputLatency + the sfx-bus click's start-to-onset p50.
- The cue path adds <= 4 ms over a sound on the sfx bus (p50 and p95).
- The rAF-relative versions of those two gates arm only at pump-late p95 <= 3 ms. Otherwise they report `notMeasured`, so a closing run must arm them.

## Gameplay

| Gate | Command | Bar | Load |
|---|---|---|---|
| Bot soak | `node _harness/probe_sim_bot_soak.ts --lineup shuffle` (add `--jobs`; see the header for seeds and tiers) | every gate in the soak's table. See the list below | any |
| Pacing | `node _harness/pacing.ts` | exit 0 | any |

Soak bars include:

- Last-hit >= 42 % and in lane >= 65 % (ruling 15).
- Takedowns by 10:00 >= 6.
- Veteran passive-seat pressure >= 0.95 on summed windows; adept is reported, not gated (ruling 16).
- The novice-to-veteran ladder and the no-early-core gate are unchanged.
- Judge on at least two untuned seed windows. Soak numbers from before commit 9d505252 seated `rotate` even when labelled `shuffle`, so do not compare them with new ones.

## Notes

1. **`gen_store` and `lisvel_almanac`.** Plain `node tools/gen_store.ts` exits 1 and writes nothing while any paid skin is under its floor. `lisvel_almanac` reads dE 16.6 against 18, a known open art item, and is sold at the standard price via `--provisional`. `node tools/gen_store.ts --check --provisional` tells you whether `content/store.json` is otherwise current. Once the art passes, run `node tools/gen_store.ts && npm run content` to restore its 1,500 price and its Featured and New eligibility.
2. **`value_probe` always exits 0.** It has no failing exit code, so judge it with `grep FAIL` on its log, never by the exit code.
3. **Announcer margin with 0 lines.** `probe_audio_runtime.mjs` computes `linePeak - p99` even when `linePeak` is null, so the announcer gate can pass with 0 lines. Until that is fixed, check `announcer.lines > 0` in the report.
