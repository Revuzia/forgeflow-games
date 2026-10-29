# VALE — handoff and resume guide (2026-10-29)

Read this first when you resume VALE in any session. Branch: `claude/youthful-ramanujan-gdud5w`.
Spine: `_spec/CONTRACT.md` (layout §1, lane ownership §14). Look and feel: `_design/STYLE_BIBLE.md` (law).
World and names: `_design/WORLD.md`. Asset paths and ids: `_design/VOCAB.md`. What VALE is and why:
`_design/DESIGN_NOTE.md`. Names VALE chose not to use: `_design/NAMES_NOT_USED.md`.

## What VALE is

VALE is an original 3D lane-brawler for Forgeflow Games, set on a great carved sundial whose needle fell.
Aubade (west, chalk and dawnglass) and Serenade (east, ironstone and lampresin) fight over the stopped hours.
There are 16 fighters in six classes and three modes. RIFT is 5v5 on three roads, about 25 minutes. BRIDGE
is 5v5 on one road over a gorge, with fighters dealt by lot. FRAY is a ten-fighter free-for-all of about
10 minutes. Bots fill every empty seat, and there are practice and custom games and an online server.

The stack is a Three.js WebGL2 client with Preact signals for the UI, a zod content catalog that ships
apart from the client, and a deterministic 30 Hz sim. 3D art is procedural Blender (Art 2.0), audio is
synthesized with numpy, and the painted 2D is generated from VALE's own prompts.

The catalog holds 16 fighters, 48 skins, 57 items, 8 Hour spells, 9 boons, 24 unit types, 3 maps,
3 modes, 8 queues and 1,536 UI strings. `npm run content:check` passes strict with 0 warnings
(2026-10-29).

## Rules every session follows

- **Originality.** League of Legends is only a gauge of quality and polish. Never copy a LoL champion,
  ability, item, effect, icon, UI layout, rule, number or name. Every fix is VALE's own
  (`STYLE_BIBLE.md`, `WORLD.md`). Check new names with `node tools/names_check.ts "Name"` (`--prose` for
  copy). Never save a LoL image into the repo, and never download video.
- **Sensitivity (blocker class).**
  - No tall, pointed or conical hoods.
  - No mask or face that reads as horror, a hockey mask, a plague-doctor beak or a blank mannequin.
  - Wicks have no face: no eye-like light pair and no mouth.
- **Owner rulings** (`_design/reviews/fixwaves/owner_rulings.md`) are binding. The owner delegated these
  calls: decide by industry standard and record the call there. Nothing is pending owner input.
- **No deploy.** No Cloudflare, no upload and no publishing of any kind until the owner gives the release
  go-ahead. Work goes to git only. `npm run package` may assemble `deploy/` locally, but nothing ships.
- **Secrets.** Never print, echo or log a key or token. Images go through `tools/imagegen/run_xai.py`,
  which reads its key itself. `npm run secrets` (`tools/secret_scan.ts`, binary files included) runs
  inside `npm run check`.
- **Code.**
  - Erasable TypeScript only: no enum, namespace, parameter properties or decorators.
  - The sim is deterministic: no `Math.random`, `Date` or wall clock in `src/sim`; use the sim's RNG.
  - Sim and presentation stay separate.
  - No content ids hard-coded in `src/` (`probe_content_ids`).
  - Cosmetics never change stats (`probe_sim_skin_neutral`).
- **Machine (10-core / 16 GB Mac, shared by parallel agents).**
  - Blender, harness Chrome (`_harness/pw.mjs`) and three_snapshot share 3 machine-wide heavy slots
    (`/tmp/vale_heavy`). "[heavy] ... waiting" is normal: wait, and never kill or bypass the queue.
  - Run ad-hoc heavy commands through `python3 art/blender/common/heavy.py run -- <cmd>`.
  - Run at most 3 node sim processes at once.
  - Long runs go in the background with a log and a bounded poll.
  - Reap orphans after a kill: `tools/reap_orphans.sh`.
- **Git.**
  - In a multi-lane run, commit only your own paths and push.
  - Never force-push, stash, restore or reset other lanes' files.
  - `tools/wip_sync.sh` makes a "vale wip sync" safety commit every 20 minutes in long sessions.

## Where it stands (2026-10-29, after integration run 2)

The final LoL-parity review (2026-10-28, gauge only) scored combat 6, HUD 7, environment 6.5, performance 6.5,
client 5.5, audio 4, originality 5 and gameplay 4. It found 8 blockers, 33 majors and 51 polish items:
`_design/reviews/final_parity_review.md` and `final_parity_open.json`. Six fix waves and two integration
runs followed.

**The status record is `_design/reviews/final_parity_open.json`.** Every finding and polish item carries
`status`, `status_evidence`, `status_history` and, while open, `open_in`. Each wave carries `done_status`.
`verifier_open` lists leftovers that are not findings, and `observations` holds open notes. The status is
as of the run-2 integration gate (`meta.status_as_of`; every integ2 verdict applied):
- all 8 blockers and all 33 majors are done;
- 41 polish items are done and 9 are done but unverified;
- 1 is partly done: combat F4, Hesmi's ult first beat (core x2.26 against 2.3).

| Wave | Verdict | Notes |
|---|---|---|
| W1 engine (render, VFX, perf, build hygiene) | pass, round 2 | Cones fill correctly, recall VFX holds, one ult beat per cast, dynres and leak gates hold, and the key is out of git. |
| W2 client front door and HUD | pass, round 2 | Sensitive art repainted, nav after a dodge, 720p sweep clean, icon families, and the ledger re-renders only on change. |
| W3 audio | pass, round 2; kit-hit regressions closed in run 2 | Team-private pings, kit identity gates (>= 8 dB), enemy T3 wind-up swell, ambience bus. The three kit-hit regressions and the dash spread pass on re-measure (`fixwaves/integ2_audio_verify1.json` audio-r1-confirm: phys contact floor 0.088, soft top 0.240, nearest dash pair 8.46 dB). |
| W4 gameplay, bots and systems | round 2 failed done:5 only; closed in integration run 1 | Bot laning gates, Dawn Seal, the BRIDGE pacing and the systems re-key (owner ruling 4, `probe_sim_rekey` 10 % gate). |
| W5a world art | pass, round 2 | Thickets clear of structures, Art 2.0 landmarks, dressed off-map skirts at about 13k tris, and Longshade without tears. |
| W5b character art | round 2 failed on W2 CSS handoffs; closed in integration run 1 | Face chips (min pair 59.5 at 26 px), dusk plates, Odrum amber mask, Rishal accent, Burdam pauldron. |

Integration run 1 (`fixwaves/integration_plan.json`, verdicts `fixwaves/integ_<lane>_verify<n>.json`) left the
fighter LOD port, the minimap padding and the audio re-confirmation to run 2.

Integration run 2 (`fixwaves/integration_plan_run2.json`, verdicts `fixwaves/integ2_<lane>_verify<n>.json`):

| Lane | Verdict |
|---|---|
| audio | Pass. audio-r1-confirm holds; the Ringshade-muffled blow now sounds in real matches (the sim's `shaded`). |
| chars | Pass. Ervet's Whole Again form at the blade's own size; the match LOD1 checked on all 16 fighters. |
| client | Round 1 failed on one regression (BRIDGE practice never loaded); fixed by systems d0ddcb7e, and the gate's e2e practice passes. |
| engine | Pass, round 2. engine-lod: the match draws the fighters' face-locked LOD1; the crowd's team accents draw whole. |
| lead | Pass. The status record and this file; the ranked-ban docs follow content (1 ban a team at 16 fighters). |
| systems | Pass. The 18 new items point at their own paintings; bots buy 31/31 finished items. |
| world | Pass. Both minimaps carry a margin so the plaza discs fit. |

The integration gate (commits `vale integ gate: ...`, reports `_harness/_reports/integ_lead_*`) ran the whole
build on the integrated tree: typecheck 0, strict `content:check` 0 warnings, `npm run probe` 48/48, build,
e2e flow / practice / store, the 720 sweep, `perf_1080 --prod` (all presets), `value_probe`, `icon_probe`,
`audio/build.py --gates`, the node audio probes and the bot-soak quick gate: all pass except combat F4's Hesmi
beat. It also closed the handoffs nobody took: the profile emblem survives a reload, the BRIDGE minimap's edge
seam, Ervet's ult blade ghost at the blade's own size, the match LOD's UV weight (Burdam's pauldron roundel),
the muffled ability hit, the RIFT Low flash (2.05x) and Tunlan's ult beat, and three world moments that had no
look: the Noon Toll's light, the Dawn Seal's shatter at 7:00 and the Gorge Wind's gust.

Performance: `perf_1080 --prod` holds 60 fps at High and Low (p95 16.8 ms, 0 dropped) and the whole-match peak
is 479k triangles, 40 programs and 273 draws against the 500k / 40 / 450 budget
(`_harness/_reports/integ_lead_perf_1080.json`).

## Open items (as of the run-2 gate; see `open_in` in the status record)

- combat F4: Hesmi's Felled Shard first-beat core x2.26 (ground x2.08) against 2.3. Kemdo, Rishal and Tunlan
  pass, box white <= 0.35 on all four, and the RIFT Low flash is 2.05x. A lit floor and a delayed ink ring did
  not move it; the great shadow zone under the strike is the likely limiter (next engine VFX pass).
- Optional world looks not yet built: the dawnglass glaze on sealed RIFT Outer Needles while shielded and the
  structures' crack overlay while the Gorge Wind blows (`src/render/structures.ts`; the seal's shatter at 7:00,
  the gust on each wind step and the Noon Toll's light are in), the Lampblack soot ring (needs an
  aura-occupancy flag in EntityView), and a line joining the two enemies in Vashil's chord.

**Observation, not in any plan.** The first team to take Longshade wins almost every RIFT bot game (50/50 on
seeds 1-20 and 21-40 at HEAD). Systems measured it in run 2 (8ce5fc59) and kept the numbers under ruling 4:
any Wick empowerment saturates the conversion, and tier separation does not depend on it. The open lever is
the defenders' answer to an empowered wave (bots), recorded in `_design/sections/modes_economy.md` §9.

**Done but unverified** (code cites the finding; spot-check in a re-review): HUD-5, HUD-7, HUD-9,
HUD-11 and client F10, F13, F14, F16, F17.

## Running it

```sh
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH
export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd games/vale && npm install
npm run content                         # content/ -> dist-catalog/ (the dev server serves it); after any content change
npm run dev -- --port 5190              # http://localhost:5190 (?dev=1 debug tools); harnesses expect :5190
npm run check                           # secrets + typecheck + content:check + every _harness/probe_*.ts (48)
npm run build                           # client -> dist/ (no content; ships apart from the catalog)
npm run server                          # online server, ws :8787 (deterministic lockstep)
```

Harnesses run in real Chrome on the GPU through `_harness/pw.mjs`, which takes a heavy slot. Reports go to
`_harness/_reports/` and shots to `_harness/_shots/`; both are git-ignored.

| What | Command |
|---|---|
| Full journey (RIFT, BRIDGE, FRAY, store) | `node _harness/e2e.mjs all` |
| 1080p frame times + match peak | `node _harness/perf_1080.mjs --prod` (perf gates use --prod) |
| 720p clipping sweep | `npm run sweep:720` |
| Value / readability bands per map | `node _harness/value_probe.mjs` |
| Bot soak (laning, jungle, difficulty, BRIDGE, FRAY gates) | `node _harness/probe_sim_bot_soak.ts --full --jobs 3` (quick mode runs in `npm run probe`) |
| All-bot pacing | `node _harness/pacing.ts --seeds 10` |
| Swing VFX follows the played clip | `node _harness/probe_swing_clip.mjs --fighter hesmi` |
| Kit hues in play | `node _harness/probe_kit_hue.mjs --live` |
| Icons at HUD size | `node _harness/icon_probe.mjs` |

Notes for re-reviewers:
- The final review's attack-pose tool, `_harness/_reports/final_combat_tools/pose.mjs` (git-ignored), now
  tracks the striking socket of the played clip. It reads that socket from the swing VFX's clip-filtered
  layers. Hesmi's attack2, which her crits also play, strikes with the LEFT fist: weapon_l -> prop.L.
  Pass `--fighters hesmi --frames 100 --no-recall` to catch both swings.
- The engine harness `probe_swing_clip.mjs` gates the same split.

Art and audio:
- Blender 5.2 headless:
  `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 --python <script>`,
  queued through `art/blender/common/heavy.py`.
- `python3 art/build.py fighter <id>` builds a fighter (`--no-skins`, `--clip-sheet`). Gates: three.js load
  test, <= 1.2 MB, accent 2-6 %, 10-25k tris (CONTRACT §12).
- The Python venv is `~/Developer/forgeflow-games/.venv/bin/python3`.
- Audio builds with `python3 audio/build.py --gates` and `audio/build_music.py`, into `audio/out/`.
- Painted 2D: `tools/imagegen/README.md`. Generate only with `run_xai.py`, and check every image by eye
  for sensitivity before it ships.

## Art 2.0 method (how every fighter is built)

1. Concept sheet (front and back, painted) to projection plates:
   `python3 art/tools/concept_plates.py <id> --height <m>` -> `art/.cache/concept/` (not committed).
2. Fit the forms on a 10 cm grid in `art/blender/fighters/<id>.py`. Use numpy SDF parts
   (`common/hifi/sdf.py`), one Part per binding, a rig fitted to the anatomy and `PROJECTION = {...}`.
   Check the fit with the silhouette overlay.
3. Build with `python3 art/build.py fighter <id>`, then copy `art/out/fighters/<id>/art.json` into the
   content `art`.
4. Skins need their own painted concept and the same projection. Skins change material and palette, never
   silhouette or accent placement (owner rulings 2 and 3).
5. Splashes and portraits are painted dusk plates over VALE's own backdrops
   (`art/blender/common/plates.py`, `art/blender/fighters/plates.json`).

## History

Earlier session logs (10-13 / 10-14: Art 2.0 proof on Marund, the VFX v2 runtime, the adversarial
review, BRIDGE pacing) live in git: `git show 09156280:games/vale/HANDOFF.md`. The wave plans and verdicts
are in `_design/reviews/fixwaves/`.
