# ARC — state of the tree (rewritten 2026-11-15 from the code, not from old ledgers)

Method: file existence and line counts, grep for the §6 contract names, and focused test runs on 2026-11-15
(`node --test tests/arc-*.test.ts tests/scripture_lint.test.ts tests/flood-warning.test.ts tests/ui-arc-*.test.ts
tests/render-arc-*.test.ts tests/audio-arc.test.ts`: 134 tests, 134 pass). The full gate result is at the bottom.

Reading the columns:
- **Built**: the code exists in `src/` (named files) and a test file exercises it.
- **Verified today**: a test I ran today passes. That proves the unit behaviour, nothing more.
- **Unverified**: the spec's measured acceptance (multi-seed probe numbers, looked-at shots, perf) has no run in this
  session. Older ledgers claim some of it (`A-sim*.md`, `A-ui*.md`, `A-render*.md`); those claims were not re-run and are
  not repeated here as fact. The probe scripts that made them are in `_harness/probes/arc.ts`, `arc-book.ts` and
  `_harness/arc-work/`.

| ARC section | Built (where) | Verified today | Unverified |
|---|---|---|---|
| §1 Visible moods | `src/sim/god/arc.ts` (hearts, dusk, pride), `src/ui/hearts.ts`, render poses `src/render/life/crowds.ts` + `bodymat.ts`; SFX cues `crowd.jeer`, `crowd.hymn` | `arc-hearts`, `ui-arc-hearts`, `render-hearts`, `render-arc-live` pass | M1-M3 multi-seed numbers (view on 100 % of towns, noise, harsh and kind runs); M4 fearful-village shot at 888x500 and the HUD glyph legibility; M5 Hearts-layer colour distance (ΔE) |
| §2 Pride and the Tower | `src/sim/god/tower.ts` (pride gate, labour, omens, five commands), `src/ui/decision.ts`, `src/render/life/tower.ts`; `babel` scenario ("One speech", `src/data/scenarios.json`) | `arc-tower`, `arc-tower-r1`, `arc-babel`, `ui-arc-towercard`, `ui-arc-decision`, `render-arc-tower` pass | T2 pacing over 8 seeds x 60 y (the attended-pacing target was dropped by owner ruling; unattended target never re-measured today); T3-T9 numbers and the 25/50/75/100 % shots; Decision card timing in a real session; the "One speech" picker card (`ui-newworld-babel.test.ts` is new, owned by the ui agent) |
| §3 Open defiance | `src/sim/god/defiance.ts`, `src/render/signs/defiance.ts` (hurl arcs), idol building, answer classification (`defiance.answer`) | `arc-defiance`, `ui-arc-defiance`, `render-arc-defiance` pass | D1-D5 multi-seed numbers; D3 storm shot; the 25-year paired-seed memory test (D5) |
| §4 Covenant | `src/sim/god/covenant.ts` (offers, vow, scheduled rainbow weather, keep and break, refusal), `src/render/fx/rainbow.ts`, UI confirm dialog | `arc-covenant`, `ui-arc-covenant` pass | C1-C4 thresholds on real flood runs; the rainbow at sun elevation 5-40 degrees on 100 % of towns; the owner question on flood content against "No Great Flood" (`scripture.json` epithet) is open |
| §5 The Book of Ages | `src/sim/god/story.ts` (ages, `query('story')`), `src/sim/god/legends.ts`, `src/ui/book.ts`, `src/data/scripture.json` | `arc-ages`, `arc-legends`, `ui-arc-book`, `scripture_lint` pass | B1-B4 on the scripted 60-year run; story under 20 ms at 1 500 agents; HUD age line and title card as shots; export MD content |
| §6 Contracts | state (`god/state.ts`), views (`sim/types.ts`), events, commands, queries, free text (`freeform-signs.ts`), test surface `window.__GENESIS__.arc` (`testsurface.ts`) all present | `arc-freeform`, `ui-arc-stub`, `audio-arc` (every §6.3 event mapped), and from today `audio-events` (every sim event mapped or listed silent) | an exhaustive contract-name grep was not repeated for every §6.1 field |
| §7 Save migration | `src/sim/core/migrate15.ts` `arc` HeaderStep: a no-op step with a documented default-on-load scheme (new state defaults in `emptyRel()`), version stays 1.5; story adds one `making` age to an old world | `living-migration` (fixtures `save-1.4-*`, `save-1.5a-kin`) passes; the arc state defaults are exercised in `arc-ages` | there is no frozen fixture of a save that already holds arc state (towers, covenants, ages) loaded by a later build; no test file named `arc-save` exists |
| §8.0 test list | present: `arc-hearts`, `arc-tower`, `arc-defiance`, `arc-covenant`, `arc-ages`, `arc-freeform`, `arc-legends`, `scripture_lint`, `ui-arc*`, `render-arc*`, `audio-arc` | all pass | the spec names `arc-pride`, `arc-story`, `arc-save`, `arc-determinism` as separate files; none exists (pride is covered inside `arc-hearts` and `arc-tower`, story inside `arc-ages`; a determinism test with the arc scenario is not present as a named file, `determinism.test.ts` predates the arc) |
| §9 Lanes and files | all §9.1 files exist: `arc.ts`, `tower.ts`, `story.ts`, `legends.ts`, `covenant.ts`, `defiance.ts`, `scripture.json`, `decision.ts`, `render/life/tower.ts`, `render/signs/defiance.ts`, `_harness/probes/arc.ts` | n/a | n/a |
| §10 River's warning before a flood | `src/sim/god/precursors.ts`, `disasters.ts` (warning hours, evacuation), `src/sim/people/shelter.ts`, toasts, `eventmap` `warning`/`evacuate`, silt in render | `flood-warning`, `ui-flood-warning`, `ui-flood-headline`, `render-silt` pass | the 8 seeds x 25 y measurement (>= 80 % evacuated, deaths vs baseline, other disasters unmoved) has no record that I re-ran; the river shot was looked at by the render lane per its own ledger, not re-looked today |
| §8.6 gates | n/a | `npm run check` and `npm run build` on today's tree: see "Gate" below | old-save-with-arc-state load, CDN smoke (`_harness/cdn.mjs`), perf on the Mac (see `MAC-TEST-PROTOCOL.md`), Safari ogg decoding |
| §8.7 owner rules | no creature, no scripted Great Flood, approved music files untouched in this stint (only SFX cues added) | audio and creature tests pass | the owner question on flood wording in `scripture.json` |

## Audio coverage (changed 2026-11-15)
Every event the sim emits now has a cue or an entry in `SILENT_EVENTS` (`src/audio/eventmap.ts`, with a reason); the
new test `tests/audio-events.test.ts` scans `src/sim/**` and fails on any unmapped event. New cues this stint:
`tower.lost`, `secession`; `collapsed` plays a small `landslide`.

## Known facts that old STATE.md got wrong
- It said §1-§5 were absent and §9.1 files missing; all of them exist now.
- It listed "no `arc` HeaderStep"; there is one (a documented no-op, see §7).

## Gate
See the end of this file (filled after the full run).
