# R6_DATA: round 6, the data lane (src/data, src/core/quests.ts, src/collection/journal*.ts, src/audio, src/life and their probes; ports 5367, 5369)

Brief: the orchestrator's round-6 task (SESSION3.md machine rules; owner decisions D-95 revised and D-96 at the end of `_spec/PLAYGROUND_BUILD.md`).
No earlier R6_DATA report existed: this is the first round-6 data engineer. Started 2026-11-18 at HEAD 4225da645 (live = 23c684a60).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r6_data/`.

## Status (updated after every finished item)
| Item | What | State |
|---|---|---|
| 0 | baseline | DONE |
| 1 | D-96: drop Fizzwell Tub, Cogwhistle Bench, Echo Hollow | DONE (data, reducer, save, text, sound, probes; node rows below) |
| 2 | Ripple / Frostbell (and Rainleaf, Lanternroof, Cloudloft) TALL layouts in the phone frame, clear of the HUD; DT-01 0 problems both layouts | MOSTLY DONE: Ripple, Frostbell, Rainleaf, Lanternroof 0 problems in all four rows (frame + shipped camera, wide + tall); Cloudloft wide 0 / 0, tall camera 0, **tall layout 3 problems (spawn spots only): NOT DONE** |
| 3 | Ripple R7 SQUIRT: event + rule, seam for PG_SHELL / PG_RENDER | DONE (LIFE rule + event, probe_life 3 rows, pg_lifequests R7 by ordinary play; seam below) |
| 4 | Frostbell I3 GLIDE and the ice: what LIFE and the quest need from physics | DONE (below; PG_PHYS built the ice this round; one LIFE reach rule found and met in the tall layout) |
| 5 | Lanternroof and Cloudloft: quests, wishes, facts, LIFE producers complete with probe rows | DONE (QL row; LF-27 tall producers) |

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
| audioview/life_checks.mjs (browser, port 5367) | | **80/80** | BEDS / STYLES2 the five kept places; the tick's grid check on the Lanternroof bed (was Cogwhistle's) |

## 3. Ripple R7 SQUIRT (DONE)
**The rule** (LIFE 6.1 S14, `src/data/life.ts SQUIRT`, `src/life/brain.ts squirtCheck`, run from `touchPass` on the player's squeeze release):
a squishy SQUIRTS when the player squeezes it (TOUCH.SQUEEZE or SQUEEZE_1S, never a tap: QUESTS Q3) and
- it is whole (not a piece: `w.ki[i] === 0`),
- it is soaked: its soak look >= `SQUIRT.soakMin` **0.5** (the same 0.5 the SOAK reaction record fires at; LIFE's water soaks a marshmallow foam
  0.06 / s, so about 8 s in the Rock Pool, measured 8.5 s in the row below),
- the squeeze was held >= `SQUIRT.holdS` **0.4 s** (a squeeze, not a brush).
Then, in the same step: the foam loses `LOOK_ADD.squirtFoam` soak (it squeezed its water out; a second squeeze right after is dry and squirts
nothing); **`LIFE_EV.SQUIRT`** is emitted (always, with or without a target); the nearest OTHER awake squishy whose body gap is <= `SQUIRT.reach`
**1.2 m** (the social table's S14 r) is the target: its wet look +`LOOK_ADD.squirtTarget`, its wow then giggle (SCRIPT.SQUIRTED, deferred),
and a **SOCIAL SQUIRT** event (sub `SOCIAL_KIND.SQUIRT`, a the squirter, b the target, n2 2) which is what the quest counts.
**The quest**: R7 "A squirt for a friend" is SOCIAL{SQUIRT, place ripple} x1 (unchanged); the host's ring writer (`src/shell/later-life.ts`
pumpEvents) already maps LIFE_EV.SOCIAL to EV.SOCIAL at the current place, BY.SELF; nothing new is needed there for the quest.
Reachable by ordinary play: set a marshmallow in the Rock Pool, wait for it to soak, squeeze it beside a friend.

**Seam for PG_SHELL** (requests, nothing of theirs changed): `LIFE_EV.SQUIRT = 8` (append-only; NOT a ring record: the ring writer's
`default: break` already ignores it, verified by reading pumpEvents). Fields: `a` = the squirting slot, `b` = the target slot or 255 (a squirt
at nobody), `sub` = the drop count to draw (**12**, or **4** with Calm or reduced motion), `n2` 0, `thing` -1. Arc length `SQUIRT.arcS` 0.4 s.
Ask: on LIFE_EV.SQUIRT play a short squirt sound at the squirter (place-sound bus; the splash family, quieter) and hand the arc to the render
(from the foam's top toward the target's body, or forward along its facing when b = 255).
**Seam for PG_RENDER**: draw `sub` drops along a ballistic arc of `SQUIRT.arcS` 0.4 s from the squirter's top to the target (or 1.2 m ahead);
the target's wet look is LIFE's (the look channel already drawn), so the render draws only the drops. Calm / reduced motion: the 4-drop
count is already in `sub`; no splash rings.

Probe rows:
| probe | row | result |
|---|---|---|
| probe_life | S14 squirt: a Wisplet soaked 0.6, a 0.6 s squeeze, a friend 0.3 m away: one SQUIRT (a 0, b 1, 12 drops), one SOCIAL SQUIRT, target wet +0.29, its wow, foam soak down to 0.14 | ok |
| probe_life | S14 no squirt: a tap, a dry foam, a piece; a squirt at nobody (b 255, no SOCIAL); Calm 4 drops; a second squeeze right after: none | ok (3 rows) |
| probe_pg_lifequests | NEW R7 (ordinary play, the real lifeStep at Ripple Shore, an S2 build): the Wisplet soaks in the Rock Pool (0.5 at 8.5 s, one SOAK record), the 0.6 s squeeze squirts at Dollop, R7 shown and DONE | ok (15/15) |
probe_life is 120 ok / 1 FAIL (LF-02, known, unchanged).

## 2. The tall (phone) layouts in the shipped camera (MOSTLY DONE)
**What the camera does** (measured with the probe's model of the shipped camera, render/placeview.ts fitPlace + placeBand, the phone's 618 px hint
pill): the fit is WIDTH-bound on a phone, so many vertical aims score alike and the line on the floor that lands at 618 px jumps between about
z 2.3 and z 3.8 when the framed front moves by a few cm. A layout that passes at one framed depth can fail at the next. So every layout below was
checked at the shipped fit AND with the framed front moved -0.1, -0.05, +0.05, +0.1, +0.15, +0.2 m (all 0 problems), with every floor (pools
and patches included) at most 2.7 m deep and the framed front at most 2.95 m. Request to PG_RENDER below (a tie-break in fitPlace).

**Tall bounds 1.4 x 3.0 m for the five S2 / S3 places** (P7 says 1.25 x 3.0: DEVIATION, with the reason): at hx 1.25 the worst fit puts the pill
line at z 2.32 (no front band left); at 1.4 at z 2.77. A 1 m squishy is then about 133 px tall at the front instead of 147. Home and Hearthlog
are untouched (live).

New DT-01 rules (stricter, round 6; none loosened): peek spots left and right of the thing's footprint within its depth; the tall layout's pool /
patch areas inside the tall frame; standing bars count in the front-band height rule; no fixed collider in a pool's water (floaters, balls,
pools, swings and a ramp's foot in water excepted); the shipped-camera row for every strict place, its pools, patches and zone things counted
by their own areas; the Puff Pads' parts at physics' tall spots (p.tx<i>, p.tz<i>, R6_PHYS) when given.

| place | wide (frame / camera) | tall (frame / camera) | what moved (rule ids: PLACES 4.x positions, P7) |
|---|---|---|---|
| Ripple Shore | 0 / 0 | 0 / 0 | tall re-laid (pool r 0.835 here); SHARED sizes: Driftwood Log 2.0 -> 1.45 m, Shell Chimes hang 0.5 -> 0.4 (both inside M2 / M10's ranges). The Sand Mound r 0.9 -> 0.78 was tried and REVERTED: it broke PG_PHYS's new surf row (the mini marshmallow on its slope) |
| Frostbell Ridge | 0 / 0 | 0 / 0 | tall re-laid: Ice Pond r 0.75 at (0.65, -1.95) (its middle inside the bodies' bounds: item 4), Glide Ramp (1.05, -2.35) foot on the ice, Steam Pool r 0.7, nest front edge 2.66 m |
| Rainleaf Garden | 0 / 0 | 0 / 0 | WIDE: Splash Spot 1 (1.6, 1.4) r 0.6, Splash Spot 2 moved to the back middle (0.55, -1.75) (it stood in front of the pad, under the party row), Stepping Stones 0.1 m back. TALL re-laid: two spots front, one back with the stones across it; every spot r 0.6 (PLACES 4.5's lower end) |
| Lanternroof | 0 / 0 | 0 / 0 | WIDE: Moon Dish (1.1, 1.45) (was under the party row). TALL: Chimney Corner (1.42, -0.9) (was cut by the right edge), Star Scope 0.4 m in from the front |
| Cloudloft | 0 / 0 | **3** / 0 | TALL laid for the first time (was a first draft with 44 problems): pads across the back (tall part spots p.tx1/tz1, p.tx2/tz2), Updraft back with the first pad in it, Kite Swing right strip, Sunbow Arch left strip, Cloud Nest front. **Left: 3 spawn spots too near a thing** (DT-01 asks 5 spots, 1.0 m apart, 0.9 m clear; the 2.1 m nest in front and the swing, arch and pads behind leave room for 2). Not solved by hand or by a search (three seeds). Needs an owner's call: a smaller tall Cloud Nest (ring R 0.85..0.87 with a wider gap, inside M5's ranges) or the Kite Swing out of the tall layout's back, or a shorter tall swing |

## 4. Frostbell I3 GLIDE and the ice (DONE: what LIFE and the quest need from physics)
I3 "Zoom on the ice" is REACT{GLIDE, thing icepond} x2 distinct family; I6 is PIECES{GLIDE, place frostbell, minN 3}.
LIFE's side (unchanged code, read and measured): the GLIDE behaviour (brain.ts, B04 USE of the Ice Pond) walks a squishy to a use point on
the ice (`iceUsePoint`: the pond's middle side, inside the bodies' bounds) and gives it one nudge across, 0.6..1.0 m/s (INTENT.GLIDE); the REACT
(looks.ts reactMotion) counts the distance the body REALLY travels while its centre is on an ice patch, grounded, not walking, faster than
0.05 m/s, for a family whose ice grip is under 0.5 (10 of 12 families: not sticky stretch 0.7, not slime 0.8); at 0.5 m it fires (10 s apart).
**What physics must give** (PG_PHYS built it this round, R6_PHYS 1): (1) the Ice Pond patch's grip read per body as the family's ice grip x
`ICE_MU` 0.3 (absolute) and its drag x 0.25, eased in 0.1 s, in BOTH layouts from the layout's own patch spot and radius; (2) with that, a
nudge of 0.8 m/s carries firm silicone 0.69 m, pop dome 0.68, gummy 0.66, jelly 0.61, water fill 0.60, bead squeeze 0.50 (their numbers):
six families reach LIFE's 0.5 m, so two kinds can glide (I3 is reachable); slower foams and putty glide less than 0.5 at 0.8 m/s and more
at 1.0 (about v squared); (3) the body stops dead off the ice (their 0.005 m), so the glide must happen ON the ice: the tall Ice Pond is
1.5 m across with its use point inside the bounds; (4) I6: pieces glide like their family (the pieces count needs nothing new).
**Found and fixed on the data side**: in my first tall Frostbell layout the pond's middle stood at x 1.1, outside the bodies' bounds shrunk
by a body, so `iceUsePoint` failed and no squishy ever went to glide (measured: 0 glide intents in 40 s). The pond now stands at x 0.65:
2 glides in 40 s from four starting spots (LIFE host). Row LF-27 below checks it.
Not done: a glide row on the REAL physics world (PG_PHYS's PH-08 / glide rows are theirs; the LIFE host coasts a glide kinematically).

## 5. Lanternroof and Cloudloft complete (DONE)
| What | Lanternroof (L1..L10) | Cloudloft (U1..U10) |
|---|---|---|
| quests | 10 clauses, every one with a producer in the data (QL row) | 10 clauses, every one with a producer (QL) |
| LIFE REACT producers | GAZE_SKY (L2: idle by the Moon Dish at night 3 s), HOLD_ON (L5, L6 pieces: the Night Breeze's gusts) | LIFT (U3: airborne in the Updraft 0.3 s) |
| SOCIAL | SING minN 3 (L8), PUSH hammock (L9: a swing) | PUSH kiteswing (a swing), COPY puffpads (pads), PASS cloudball (a ball), PARADE sunbowarch (S05 COPY with 3, an arch), PILE cloudnest (a ring) |
| USE | lanternline RING x3 distinct part (5 lanterns), vanedisc SPIN, starscope SWITCH by PLAYER | puffpads BOUNCE x3; PIECES BOUNCE (PIECES_USE + BOUNCE: the pads' verb) |
| facts (F1) | 9 fans | 9 fans |
| wishes | THING wish kinds 18 (bell, flame); never masked (DROPPED_PLACE_MASK is 5, 6, 8) | THING wish kinds 1 (ball) |
| shipped-on-host coverage (QC info, wide, kinematic host) | 2 of 6 LIFE clauses on this host (not: L3 L4 L8 L9: lantern strikes, the vane's spin and the hammock need contacts and torque; SING of three needs time) | 4 of 7 (not: U2 U4 U8: the pads' kick, the swing, a parade of three) |

Probe rows: probe_pg_lifequests NEW **QL** (every clause of L1..L10, U1..U10 has its producer in the data: REACT trigger + caps, SOCIAL row +
caps + the thing's mechanism, USE thing + verb + parts, PIECES, F1 fans, VISIT opening; THING_KINDS > 0; not masked) ok. It caught one wrong
assumption of mine (PARADE has no SOCIAL row: it is S05 COPY with three, LIFE 6.1), fixed in the row with the reason. probe_life NEW **LF-27**
(the place REACTs on the re-laid TALL layouts: DRIFT in Ripple's Rock Pool 4.4 s, GLIDE on Frostbell's Ice Pond 7.0 s and 28.1 s, GAZE_SKY by
the Moon Dish 10.2 s, HOLD_ON x4 in the Night Breeze, LIFT x2 in the Updraft) ok. The LIFE host (`_harness/life_host.ts`) now drifts a floater
by the zone of the layout in use (it used the wide zone's centre on the tall layout too).

## Requests to other lanes
- **PG_RENDER**: (1) `render/placeview.ts fitPlace`: when width-bound on a phone the vertical aims tie and the pill line jumps 2.3..3.8 m with
  a few cm of framed depth; a tie-break toward the lowest aim (most floor in front) would make every layout's floor rule stable (my layouts
  are checked robust to it either way). (2) draw a pool / puddle from the layout's ZONE (spot and radius): the tall Splash Spots, Rock Pool,
  Steam Pool and Ice Pond differ from the thing's shared size. (3) the Puff Pads: three parts at p.x1/z1, p.x2/z2 (wide) and p.tx1/tz1,
  p.tx2/tz2 (tall), as physics builds them. (4) SQUIRT: item 3's seam (drops along an arc). (5) Home kit shelf: 17 keepsakes now (was 20).
- **PG_SHELL**: (1) LIFE_EV.SQUIRT sound + hand-off to the render (item 3). (2) gift card: use `CHAPTERS[c].giftPlace` for "loves the next
  place". (3) Keepsakes pane: the finale lines now name their own place (the old `placeName(bit + 1)` named the next one).
- **PG_PHYS**: (1) the Ripple shared sizes (Driftwood Log 1.45 m, Shell Chimes hang 0.4) change your builds; your 73 rows pass with them. (2)
  the Puff Pads' tall spots are now given (p.tx1/tz1 = 0.2, -3.2; p.tx2/tz2 = -1, -3.15). (3) your surf row (a mini marshmallow on the Sand
  Mound's slope must drift 0.03 m shoreward; it drifts 0.031 at HEAD) is on a knife edge: a 0.12 m smaller mound sends it seaward.
- **Orchestrator / owner**: Cloudloft's tall spawn spots (item 2 table): pick one of the three options.

## Final numbers (end of round 6, one probe at a time, `scratchpad/r6_data/probes.sh`)
`npx tsc --noEmit -p tsconfig.json`: **0 errors** (the whole tree, PG_PHYS's props.ts included at the end).
| probe | HEAD 4225da645 | now | note |
|---|---|---|---|
| probe_app | 187/187 | **187/187** | |
| shellview/node_checks | 171/171 | **171/171** (103 s) | reads Ripple / Frostbell / Rainleaf |
| probe_gestures | 160/160 | **160/160** | |
| probe_trophies | 31/31 | **31/31** | |
| probe_merge | 22/22 | **22/22** | |
| probe_playground (quick set) | 55/55 (now 73 rows with PG_PHYS's) | **73/73** | after the Sand Mound revert (72/73 with r 0.78: the surf row) |
| probe_pg_lifequests | 14/14 | **16/16** | + R7, + QL |
| probe_life | 117 ok / 1 (LF-02) | **121 ok / 1 (LF-02, known)** | + 3 S14 squirt rows, + LF-27 |
| probe_chatter | 42/42 | **42/42** | |
| renderview/pg_node_checks | 40 ok | **40 ok, 0 FAIL** | |
| probe_journal | 28 ok | **29 ok** | + CO-13 |
| probe_quests | 45 ok, 3 NOT RUN | **46 ok**, 3 NOT RUN | + QU-14 tombstone row |
| probe_pg_data | 32 ok, 2 FAIL (known) | **40 ok, 3 FAIL** | the 2 known (Home B5 needs RENDER; Hearthlog tall rocker under the pill, live cabin not changed) + Cloudloft tall (3 spawn problems: newly strict this round) |
| probe_genome / probe_life_imports | 25 / 5 | **25 / 5** | |
| audioview/life_checks.mjs (browser, 5367) | | **80/80** | the one heavy job; vite and the browser it started exit with it |

Not done: Cloudloft's tall spawn spots (owner's call, item 2); a glide row on the real physics world (PG_PHYS's); the QC sweep on the tall
layouts (it runs wide; LF-27 covers the place REACTs on tall); the Hearthlog tall rocker (live cabin, unchanged by this lane).
