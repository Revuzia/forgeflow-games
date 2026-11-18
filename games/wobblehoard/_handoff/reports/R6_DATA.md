# R6_DATA: round 6, the data lane (src/data, src/core/quests.ts, src/collection/journal*.ts, src/audio, src/life and their probes; ports 5367, 5369)

Brief: the orchestrator's round-6 task (SESSION3.md machine rules; owner decisions D-95 revised and D-96 at the end of `_spec/PLAYGROUND_BUILD.md`).
No earlier R6_DATA report existed: this is the first round-6 data engineer. Started 2026-11-18 at HEAD 4225da645 (live = 23c684a60).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r6_data/`.

## Status (updated after every finished item)
| Item | What | State |
|---|---|---|
| 0 | baseline | DONE |
| 1 | D-96: drop Fizzwell Tub, Cogwhistle Bench, Echo Hollow | DONE (data, reducer, save, text, sound, probes; node rows below) |
| 2 | Ripple / Frostbell (and Rainleaf, Lanternroof, Cloudloft) TALL layouts in the phone frame, clear of the HUD; DT-01 0 problems both layouts | not started |
| 3 | Ripple R7 SQUIRT: event + rule, seam for PG_SHELL / PG_RENDER | not started |
| 4 | Frostbell I3 GLIDE and the ice: what LIFE and the quest need from physics | not started |
| 5 | Lanternroof and Cloudloft: quests, wishes, facts, LIFE producers complete with probe rows | not started |

## 0. Baseline (HEAD 4225da645)
- `npx tsc --noEmit -p tsconfig.json` clean (2.0 s).
- `node _harness/probe_pg_data.ts`: 2 FAIL (both known, FIX5_DATA): "DT-01 Home B5, one squishy out on a phone" (needs RENDER) and "DT-01 Hearthlog Cabin tall in the
  shipped place camera" (the tall Rocker Board under the hint pill, 669 px against 618). The shipped-camera rows exist only for Hearthlog today.
- Node probes at HEAD (one at a time, `scratchpad/r6_data/probes.sh base`): probe_journal all (28 ok), probe_quests all run pass (45 ok, 3 NOT RUN), probe_life
  117 ok / 1 FAIL (LF-02, known), probe_chatter 42/42, probe_pg_lifequests 14/14, probe_genome 25 ok, probe_life_imports 5 ok, renderview/pg_node_checks 40 ok.
- Note: `src/physics/props.ts` (PG_PHYS, working in parallel) does not typecheck at times today (`weatherHit`, `surfStep`, `guardStep`): not my file; every tsc
  run below is clean for every file of mine and every probe file I touched.

## 1. D-96: the three dropped places (DONE)
**Indices: kept stable, the three marked removed** (renumbering is not safe: a place idx is a bit in the saved `pl`, `sg` and `pv`, a quest idx is a bit in
`qd` and the key of every `qp` row, a keepsake is a bit in `ks`, a thing idx is a RIDE wish's target, and the shell, render and UI look places up by idx).
`PLACE_IDS`, `THING_IDS`, the quest idx 50..69 / 80..89 and the keepsake bits stay as append-only TOMBSTONES (DT-14 lock unchanged except the keepsakes line,
below). New in `src/data/places.ts`: `DROPPED_PLACES`, `DROPPED_PLACE_MASK` (bits 5, 6, 8), `KEPT_PLACE_IDS` (the seven), `placeDropped()`, `thingDropped()`,
`placeInfo(idx)`.

What changed, by rule id:
| Rule / table | Before | After (D-96) |
|---|---|---|
| place modules | `src/data/place_{fizzwell,cogwhistle,echohollow}.ts`, `src/audio/places/{fizzwell,cogwhistle,echohollow}.ts` | **deleted** (copies in scratch `r6_data/removed/`); `loadPlaceDef` rejects a dropped id |
| PLACE_INFO | 10 rows | **7 rows** (no name, coined word or sky of a dropped place ships); consumers look up by idx (`journal.ts` now builds `PLACE_SHIPPED` / `PLACE_OPENS_AT` by idx) |
| QUESTS 7 opening order | Lanternroof 54, Cloudloft 72 (Fizzwell 36, Cogwhistle 45, Echo Hollow 63) | **Lanternroof 36, Cloudloft 45** (the dropped Fizzwell / Cogwhistle slots: the same 8 to 9 stamp gaps; PLACE_INFO, each PlaceDef, CHAPTERS) |
| QUESTS 6.5, 6.6, 6.8 (T1..T10, W1..W10, E1..E10) | 30 rules | **30 tombstones** (`dropped: true`, no clauses, `''` text): never shown in any build (all-shipped included), never done (`markDone` refuses), never counted |
| CHAPTERS 5, 6, 8 | open at 36 / 45 / 63 | `dropped: true`: `chapterOpen` false, `finalesDone` skips them; `giftPlace` added (the place a gift's three love: 2, 3, 4, **7**) |
| QUESTS 10 keepsakes | 20 | **17**: bits 5 Bubble Ring, 6 Little Brass Cog, 8 Glow Crystal RETIRED (each was only its dropped finale's; QUESTS 10 gives no other home); `KEEPSAKE_MASK`; KEEPSAKE_TEXT has holes at 5, 6, 8 (forEach skips them) |
| Pocket Map (bit 18, ALL_PLACES) | n 10 | **n 7** (visits of a dropped place never count) |
| Songbook (bit 14, SONG_PLACES) | 5 of 10 | **5 of 7** (unchanged n; a dropped place's song bit never counts) |
| QUESTS 11 gift list 4 (Rainleaf's finale) | Plumpet, Glugbean, Tadpolo "love the next place", Fizzwell | the same three, now **Lanternroof** fans (the next place), so QUESTS 6.4's words stand |
| PLACES 5 favourites | 17 species loved a dropped place | **re-homed** (below); Hearthlog's six unchanged (live cabin as it was) |
| LIFE 4.2 REACT_TRIGGERS | RATTLE, GLOW, FIZZ rows | **removed** (only the dropped places made them; ids stay); their LIFE producers (`looks.ts` NEAR_MAGNET, GLOW_WATER, FIZZ_ZONE, BUBBLE_PATCH) removed |
| journal.ts PLACE_CAPS | rows 5, 6, 8 | **0 / 0 / 0** (QU-14 re-derives them so) |
| THING_KINDS | fizzwell 4, cogwhistle 11, echohollow 6 | **0** |
| journal_text | T/W/E titles and hints, 3 chapter names, 13 thing names, 12 zone names, 3 keepsakes | **gone** (tombstones `''`); THING_TEXT is `Partial` (consumers already read it as a record with `?.`) |
| audio | recipes + aliases bath / bench / hollow, music styles bath / bench / hollow | **gone** (ambience.ts RECIPES / AMB_ALIAS, music.ts STYLES); the creature echo option stays (a contract voice option, no place asks for it) |
| LIFE wishes | `lifeSetJournal` open places as given | masked with `~DROPPED_PLACE_MASK` (a dropped place is never a wish's place) |

Favourites re-homed (life.ts SPECIES_LIFE; a kept thing of the same kind of use; DT-03 ok: 4+ fans and a Common per place, every family in 2+ places):
Plumpet -> Lanternroof hammock (was the sponge raft), Glugbean -> Lanternroof moondish (bath water), Tadpolo -> Lanternroof vanedisc (swirl ride), Gloopsy ->
Ripple rockpool (soap slide), Rattlebead -> Rainleaf seedpod (bubble patch), Glimglop -> Rainleaf dripleaf (tap), Cushlet -> Cloudloft puffpads (spring plate),
Kneadle -> Ripple sandmound (spinning cog), Burrbin -> Rainleaf mossbouncer (magnet), Thudge -> Frostbell snowdriftnest (tick clock), Flipdome -> Cloudloft
kiteswing (little bell), Dimpla -> Cloudloft cloudball (echo stone), Spirelo -> Frostbell iciclebells (crystals), Cindergoo -> Frostbell steampool (glow pool),
Ambrosel -> Frostbell glideramp (stone slide), Fossilo -> Ripple driftlog (hum rock), Prismelo -> Cloudloft cloudnest (moss bed). Fans now: Hearthlog 6, Ripple 8,
Frostbell 9, Rainleaf 9, Lanternroof 9, Cloudloft 9.

**Old saves** (`core/quests.ts forgetDropped`, called by `journal.ts` sanitize before the recount): a save holding a dropped place's done quests (their stamps
leave the saved count), quest progress, keepsake bits, place / song-place / visit entries, a resting wish for it or a ride on its thing, a gift row of its chapter
or it as the current place loads WITHOUT ERROR and without those entries; facts, friendship and warmth (species and item facts) stay.

Other fixes found on the way: the Keepsakes tab filled a finale keepsake's "From {place}." with `placeName(bit + 1)`, the NEXT place (the live Ember Pinecone
says "From Ripple Shore."): the six finale lines now name their own place outright (they show only once found, so the place has shipped). Request to the screens below.

Probe rows (re-specified rows carry "re-specified in round 6 for D-96" and the reason in the code):
| probe | before | after | what |
|---|---|---|---|
| probe_pg_data | 32 ok, 2 FAIL (known) | DT-02..DT-17 all ok | NEW **DT-17** (nothing of a dropped place ships: no module, PLACE_INFO row, rule, favourite, gift, keepsake, text, recipe, style or string literal; tombstones only; Pocket Map 7); re-specified DT-03 (gift = next KEPT place, no favourite in a dropped place), DT-07 (11 modules), DT-08 (tombstone text, text rows per shipped keepsake bit / kept thing), DT-09 (skip tombstones), DT-10 (Bath Water / Glow Pool cells not shipped), DT-13 (7 places), DT-14 (keepsakes by bit with `-` at 5, 6, 8), DT-15 (20 triggers; RATTLE / GLOW / FIZZ have none and nothing uses them), DT-16 (dropped THING_KINDS 0) |
| probe_quests | 45 ok, 3 NOT RUN | **46 ok**, 3 NOT RUN | NEW QU-14 row (the 30 tombstones shown in no build, never done, chapters never open, keepsake bits never set); re-specified QU-02 (80 kept quests), QU-05 (no dropped finale), QU-06 (12 / 20 / 28 / 36 / 45), QU-09 / QU-16 (thresholds by idx, 5), QU-11 (Lanternroof stays shut in S2; the stream's numbers identical to HEAD) |
| probe_journal | 28 ok | **29 ok** | NEW **CO-13** (an old save naming the dropped places loads cleanly; mutation: with `forgetDropped` off it FAILS on 10 counts) |
| probe_life | 117 ok / 1 (LF-02) | **117 ok / 1 (LF-02)** | LF-21 RATTLE / GLOW / FIZZ rows re-specified: no trigger, and a bead squeeze and a gel 3 s in every zone of the seven places make none |
| probe_chatter | 42/42 | **42/42** | re-specified: 7 places, 6 aliases, 7 styles, at least 9 tuned notes (was 15: the crystals and the little bell went) |
| probe_pg_lifequests | 14/14 | **14/14** | the QC sweep over the 5 S2 / S3 places (was 8) |
| audioview/life_checks.mjs (browser, not run yet) | | | BEDS / STYLES2 the five kept places; the tick's grid check on the Lanternroof bed (was Cogwhistle's) |
