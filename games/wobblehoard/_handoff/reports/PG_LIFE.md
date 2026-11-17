# PG_LIFE running report (src/life: traits, needs, looks, REACT, brains, social, attention, voice plan, wishes)

Brief: `_handoff/briefs/PG_LIFE.md` (revision 4). Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_life/`.
Engineer 1 started 2026-11-16 ~09:30 UTC (no earlier PG_LIFE report or `src/life` existed). Baseline: `npx tsc --noEmit -p tsconfig.json` clean (1.2 s)
at HEAD 1965cd2c2 (+ PG_DATA's uncommitted edits). PF-00 has not reported (no `_handoff/reports/PG_PF00.md`): F = 4 and PLAYGROUND_BUILD 14.2's
weights, the caps computed by the formula in `attention.ts`.

## Status table (update after every step)
| Step | What | State |
|---|---|---|
| 0 | read brief, specs (LIFE all, PLACES 1-4.2, QUESTS 4/5/8/9/12/13, PB 2/4/11.2/14.2/14.3/18), contracts seam, data tables | DONE |
| 1 | `src/life/world.ts` (struct of arrays, place copy, intent/event helpers) | WRITTEN, tsc clean (10:05) |
| 2 | `traits.ts`, `looks.ts` (needs, looks, REACT by REACT_TRIGGERS, PIECES highs, the cut's PIECES) | WRITTEN, tsc clean |
| 3 | `attention.ts` (caps of 10.1, priority, P1 wait, touch duck, wish slot + dots, unitCap / moverCap by formula, motionGate) | WRITTEN, tsc clean |
| 4 | `voice.ts` (motif, answer, chat, sing on the sim-time grid, duet, lifePhrase, lifeMotif, PHRASE_BUBBLE) | WRITTEN, tsc clean |
| 5 | `act.ts` (intents + gate start), `brain.ts` (B01..B20, scripts, targets, HELD, pieces P01..P04) | WRITTEN, tsc clean, NOT yet run |
| 6 | `social.ts` (S01..S13, S15, S17, S18 turn by turn, soft boop, ride allowance) | WRITTEN, tsc clean, NOT yet run |
| 7 | `wish.ts` (scheduler, FIRST_WISH wisher, grants, lifeWishOf) | WRITTEN, tsc clean, NOT yet run |
| 8 | `step.ts` (the API) | WRITTEN, tsc clean, NOT yet run |
| 9 | probes: `probe_life_imports.ts` DONE (all rows ok, 1.5 s); `probe_life.ts` 81 rows, **76 ok, 5 FAIL** (2.6 s default run) | see the state below (12:25) |

### Step notes (engineer 1)
- **Trait spreads** (`node _harness/probe_life.ts`, row T): bouncy 0.17/0.52/0.89, curious 0.26/0.53/0.90, cuddly 0.10/0.39/0.84, chatty 0.38/0.65/0.82,
  dozy 0.07/0.37/0.82 (min / median / max over the 50 templates, `speciesBaseGenome(id, 7)`, untwisted) = LIFE 2's table exactly; LIFE 2's
  "median" of 50 is the upper one (index 25: bouncy has a gap 0.416 -> 0.516 between indices 24 and 25).
- **Gate caps by the formula** (`attention.ts unitCapOf / moverCapOf`, F = 4): 1.060 / 1.494 / 2.644, movers 1 / 1 / 2; F = 3 and 2 rows of
  LIFE 10.3 reproduced (1.30/2.07/3.60, 2.07/3.22/5.52).
- **LF-16 fixes:** (1) a character's first think is its first boundary after the PREVIOUS call (a character added before the first call
  starts at the grid's start), so the frame rate never shifts it; (2) no per-call intent cap per character (the host's queue of 4 is for
  delayed intents; a per-call cap dropped intents differently at 30 and 60 fps). Thinks run in global boundary order.
- **Float32 keys:** an identical pose / squash / expression was re-sent every think because a double never equals its float32 copy; compared
  with Math.fround now (EXPRESS intents in a 5-minute cabin visit 2775 -> 54).

Other lanes: `_harness/probe_quests.ts(404,8)` (PG_QUESTS) shows a tsc error at 09:52 (`set` on QuestState): not my file.


## STATE AT ENGINEER 1's STOP (2026-11-16 ~12:25 UTC; time box reached). `npx tsc --noEmit -p tsconfig.json` CLEAN.
Commands: `node _harness/probe_life_imports.ts` (exit 0, 1.5 s), `node _harness/probe_life.ts` (exit 1: 76 ok, 5 FAIL, 2.6 s; `--heavy` runs LF-01
over 600 s and LF-14 over 30 min). Both are picked up by `run_probes.ts` (default runs stay a few seconds). Nothing of mine is running.

### What is built (src/life, 10 modules, all new)
`world.ts` struct of arrays (capacity 16), place copy (`lifeSetPlace` copies bounds, things, use / peek / push / rider / gap-waypoint spots, zones
with falloff, patches; Home's spots x bodyScale), geometry, per-character rng in a Uint32Array (LIFE 11's formula), intent / event push;
`traits.ts` (LIFE 2 exactly); `attention.ts` (10.1 caps x 4 columns, priority, drop-not-queue, P1 waits 2 s, touch duck never for a lock alone,
the wish slot + still dots (style 3 = WISH_DOT, for PG_RENDER / PG_SHELL), one group bubble, unitCap / moverCap BY THE FORMULA (F = 4,
PF-00 pending), motionGate, motionGateWake, attentionSound / attentionParticles for the host's auto events, CHAR_CAP); `voice.ts` (species
motif from MOTIF_SALT, answer = mirrored contour a third or fourth up, chat, joy, loved, sleepy, wish, granted, sing on the sim-time eighth
grid and rest tones, huff, comfort, peep, thing, pair duet from DUET_SALT, lifePhrase, lifeMotif, PHRASE_BUBBLE for sound off);
`act.ts` (the intents: SCOOT via scootTo only, HOP with its anticipation squash in `d`, SQUASH / POSE never re-sent identical, GAZE (NaN x =
the camera), EXPRESS, EMOTE with class / group / dots / badge, SETTLE, CANCEL; the gate start per character; travel with the gait overlay;
`motionAllowed` = quiet (cut group exempt 1 s after the swipe) and autonomy off (player-asked use and rides exempt)); `looks.ts` (needs,
looks with "falls only while its cause is absent", REACT_TRIGGERS loop, once-per-visit keyed by (kind, thing), event cooldowns, PIECES at
each new high, the cut-in-a-zone PIECES, lifeAddLook's REACT every time with its source); `brain.ts` (B01..B20 utility choice with seeded noise
and the +0.15 keep, FIRST_PLAY / PLAY_WITH forced uses, Home segment targets, free targets, HELD in the same step, afterglow + grace, pieces
P01 follow, P02 huddle, P03 hop together (P04 join-in only via P03), USE NAP on the basket / rug, B19 hold on, the toast hop-back);
`social.ts` (S01 greet incl. walk-up, S02, S03 soft / physics boop by the gate, S04, S05 copy (parade NOT built), S06, S07 row gathering,
S08 piles via B06, S09, S10, S11 with the ride allowance, S12, S13, S15, S17, S18; one mover at a time); `wish.ts` (scheduler with all caps,
FIRST_WISH wisher rule incl. the 5:00 rest, grants, lifeWishOf); `step.ts` (the API of LIFE 12 + lifeAttention, lifeDebug).

### Acceptance rows (probe_life.ts / probe_life_imports.ts)
OK: T (trait spreads = LIFE 2), LF-01 (3 seeds, 90 s default / 600 s heavy), LF-03 (**7.9 to 8.3 us median a tick at 16 characters**, p99
~30 us, bar 100 us), LF-04 (CANCEL + 0 motion same tick, none for 1.5 s after release, a lock silences nobody), LF-05, LF-06 (wide and tall cabin
targets, Home segments within 0.07 m incl. the ball's roll, no wander for one squishy on a portrait phone), LF-07 (16-character storm, all four
columns), LF-08, LF-10 (caps by formula incl. F = 3 / 2 rows; low/med all-asleep starts; S11 pusher on low and med via the ride allowance; S10
teeter low and med; soft boop low/med, physics boop high; movers never over; every wake within unitCap + allowance), LF-11, LF-12, LF-14,
LF-16 (30 vs 60 fps identical), LF-17, LF-19 (FIRST_PLAY once; FIRST_WISH: no Dollop, named wisher, held wisher -> fan, all quiet -> rests at
the backstop, once; PLAY_WITH; POSE; CHEER; SQUIRTED), LF-20 (Window Chill 0.015/s and no fall there, FROST once, elsewhere fall 0.02/s, quiet
keeps, shelf and trip reset, lifeAddLook SNOWCAP every time with its source, 0 B), LF-21 (WARM with the Fireplace, SHIVER, TOAST + hop-back,
RISE / OOZE where the family fits), LF-22 (cut in the warmth: one PIECES WARM n = 6), LF-23, LF-24, LF-25, LF-26, FN-01 LIFE part (wide and tall:
ball USE at +1.2 / +0.8 s, ball moved 1.86 m in the kinematic host, first bubble +0.1 / +3.0 s; newcomer hello bubble +2.5 s).

FAIL (not done):
1. **LF-02: lifeStep allocates about 35 B a tick** (16 characters; 175 to 250 KB per 1000 ticks after a JIT warm-up on a separate world). Cause
   (heap sampling, scratch `pg_life/hp.ts`): doubles passed to and returned from calls V8 does not inline are boxed: `tb` (the think time) is a
   parameter of almost every brain / social / act function, `noise()` returns a double, `dist2`, `inBounds`, `inKeepOut`, `inArea`,
   `zoneStrengthAt` take double coordinates. Fix plan (mechanical): pass time as an integer quantum (tq = tick x 160 + slot x 10, units of
   1/1600 s, a Smi) or read it from a world field; inline the noise as `rnd(w, i) * NZ - 0.05`; pass coordinates through `w.f`. lifeLooks and
   lifeAddLook already allocate 0 B.
2. **LF-09** (balance): the 5-minute cabin visit (4 wholes, med, no input) gives 4 to 6 of 6 pairs greeted and 1 to 5 uses a squishy depending
   on small changes (chaotic): every behaviour fires somewhere in the probe, but the "every pair greets, each 2 to 3 uses" outcome is not
   stable yet. Levers already in: greets come first in a visit's first 60 s (1.15 / walk-up 1.1), still behaviours give way to moments, B03
   wanders toward an ungreeted member half the time, B04 -0.12 per use this visit, the dozy nap trigger needs rest > 0.45. Open: what LF-09
   counts as a "thing use" (my reading so far: every USE event; LISTEN at each kettle whistle and NAP in the basket inflate it).
3. **LF-13** (two rows): the staged "another squishy took the ball it was chasing" in the probe does not reach B16 yet (the trigger code is in:
   `takenBy` + `huffScene` with the 60 s session rule and 5 min cooldown, `startHuff` <= 3 s, a touch turns it into a giggle; the static
   HUFF_TRIGGERS table and the first-60-s row pass). Debug the staged scenario (scratch `pg_life/dbg5.ts`).

### Not built / pending (S1 and S2 items in my lane)
S05's parade (copy only); P04 join-in as its own move; the friend wish (lifeSetJournal carries no friendship level or F3 for shelved species:
**request to PG_QUESTS / the designer**: an additive input such as `lifeSetFriends(w, speciesIdx, friendMask)`); B13's "most curious walks over
to look" after a cut; the 3-tosses dizzy only as 5 s of grace; LF-18 (S2 water exit) not built (B06 never starts in water); GLIDE, DRIFT,
GAZE_SKY, PRINT REACT producers (S2 / S3); the S2 raised hops (`GAITS.vyS2` switch). LF-15 is the reducer's (PG_QUESTS); LIFE gates chat /
duet / twirl by lifeSetPair levels.

### Sizes (14.3's one-file rolldown build, scratch `pg_life/bytes.mjs`)
world 10 622, traits 1 138, attention 6 163, voice 4 541, act 6 208, looks 8 766, social 17 559, wish 6 943, brain 29 638, step 9 823:
**src/life = 101 401 B minified (39 494 B gzip)**, 2.25x the 45 KB estimate. With PG_DATA's 36 KB of life-chunk data that is 137 KB before the
reducer, journal, hosts and the play-time UI: **the 150 KB life chunk will not hold it**. For the orchestrator (D-92 overflow rule): the long
struct-field names survive minification (`w.thingUseX` etc.); a field-name mangling pass or shorter names is the first lever.

### For other lanes (contract-free conventions LIFE uses; all documented in `src/life/act.ts` and `step.ts` headers)
- PG_SHELL: snapshot rows are indexed by character SLOT; lifeStep runs the attention filter itself (do not filter again; use
  `lifeAttention(w)` for the gate, over-budget rule and auto sounds); do not lifeRemove / lifeAdd for a ceremony; a cut = lifeRemove(whole) +
  lifeAdd(pieces, group = the whole's old slot); USE by PLAYER has b = 254; FIRST_WISH resting at the backstop is WISH SHOWN with b = 254,
  n2 = 0; HOP's `d` is the anticipation squash the host applies 0.12 s before the impulse; GAZE a = NaN means the camera; EMOTE `a` bit 0 =
  sparkle badge, `e` = class; VOICE a = phrase handle for lifePhrase, b = register, c = group count, d = syllables, e = length; EMOTE style 3 =
  a wish's still dot (the budget sets it); icon 0 clears.
- PG_RENDER: style 3 (wish dot) needs a draw (14 px still dot) or the shell maps it.
- The kettle steam radius: LOOK_ADD uses PLACES' 1.2 m (PG_DATA's note); LIFE takes whatever the host adds.


## Round 2 (engineer 2, started 2026-11-16 11:31 UTC, from HEAD 8dc806641)
Scope (orchestrator): (1) the five failing probe_life rows honestly (LF-02, LF-09 x2, LF-13 x2); (2) the friend wish's input
(`lifeSetFriends`) and the friend wish; (3) S05 parade, P04 join-in, the curious one walking over after a cut, LF-18 water exit, the S2
raised-hop switch, probe rows for the FLOAT / WADE / SPLASH / SHIVER / FROST producers; (4) size LAST: src/life <= 75 KB minified (round 1's
measure: `pg_life/bytes.mjs`, each module bundled alone with rolldown, every import external, minified), every probe row still passing.
Constraint: no edits under src/physics, src/shell, src/ui, src/input or vite.config.ts (owner's unmerged code); requests go here.
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_life2/`.
Start state re-measured at 11:31: tsc clean (1.5 s); `node _harness/probe_life.ts` 76 ok / 5 FAIL (2.9 s): LF-02 (max 245 952 B per 1000
ticks), LF-09 (4 of 6 pairs greet; uses 3/3/3/5), LF-13 (the staged take gives no huff; so the touch row fails too).

| R2 step | What | State |
|---|---|---|
| 0 | read brief, report, SESSION3, LIFE.md all, QUESTS 4/8, PB 18 rows, all src/life + probe; other lanes' requests | DONE 11:31 |

Engineer 2 was cut off after a partial LF-02 refactor (committed at def44f133: brain / social / act / looks / wish / step read the think
time from `w.f[F.NOW]` instead of a `tb` parameter; `UNIT_CAP` table in attention.ts). Nothing else of the scope was done.

### Round 2, engineer 3 (started 2026-11-16 ~14:10 UTC, from HEAD def44f133)
Re-measured at the start: tsc clean (1.6 s); `node _harness/probe_life.ts` 76 ok / 5 FAIL (2.4 s): LF-02 (now max 188 952 B per 1000 ticks,
down from 245 952), LF-09 x2 (4 of 6 pairs; uses 3/3/3/5), LF-13 x2. Scratch: `.../scratchpad/pg_life3/`. Same constraint (no edits under
src/physics, src/shell, src/ui, src/input, vite.config.ts).

| R2/e3 step | What | State |
|---|---|---|
| 0 | read brief, report, specs (LIFE 3-6, 9-12; QUESTS 8), all src/life + probe, other lanes' requests | DONE 14:15 |
| 1 | LF-02 zero allocation: every double off the call boundaries; diagnosis of the residual | DONE as far as code can go; LF-02 still FAIL (see below) 15:40 |

#### Step 1, LF-02 (engineer 3)
What was done (all in src/life; tsc clean; every other probe row unchanged):
- Geometry takes no double arguments: a query point in `w.f[F.PX]`, `w.f[F.PZ]` for `inBounds(w, shrinkMm)`, `inKeepOut(w, s, k, growMm)`,
  `inAreaAt(w, patch, k)`, `zoneStrengthAt(w, k)`, `clearOfThings`; distances come back as integers (`d2c` / `d2t` / `d2p` in cm², `dmm` in
  mm); `inArea`, `dist2`, social's `dist` and `inBoundsAt`, `distChars`, `strongestZone` are gone.
- `setBeh(w, i, b, scoreMilli, durMs)`, `startUse/Bask/Nap(..., scoreMilli)`, `baskScore` returns milli, `touching(..., slackMm)`,
  `freeTarget(..., maxRMm)`; voice.ts plans phrases with `syl(w, h, k, syl, deg, len10, gapMs)` on a running `w.f[F.T]` (same timings),
  `toNextBarMs(w)`, `m32n(st, n)` (the species motifs are bit-identical: floor(x n) as before); attention's `onScreen4` counts quarters;
  `MOVER_CAP` / `UNIT_CAP` tables with `tierOf(s)`; `clamp01` calls inlined as Math.min / Math.max.
- **Two V8 boxing sources found by bisection** (heap sampling with `--no-turbo-inlining`, scratch `pg_life3/hp.ts`, `hp2.mjs`): (1) a phi of a
  computed double and an imported constant (`last > -1e8 ? Math.min(0.5, tb - last) : THINK_S` in `think`: TurboFan keeps the phi tagged and
  boxes the computed side every think; about 40 KB per 1000 ticks alone); (2) the world's scalar doubles in object fields: the world literal
  has about 240 properties, all out of object, and `lastT` showed as a Smi in `%DebugPrint`, i.e. a tagged field: every store of a double
  allocated. The world's scalar doubles now live in `w.f` (`F.LAST_T`, `T0`, `UNITS`, `MUSIC_ON`, `NEW_WISH`, `SONG`); attention's token
  buckets in `a.g` (Float64Array); `a.unitCap` / `a.allowance` stay public fields but are written only when they change.
- Numbers (`node _harness/probe_life.ts`, the LF-02 row: 1000-tick windows after the probe's 3-pass replay warm-up): start of round 2
  161 024 to 188 952 B; now **58 368 to 127 128 B**. The same windows measured after the whole probe has run (scratch `pg_life3/alloc.ts`):
  101 to 132 KB before, **29 to 74 KB** now.

**Why LF-02 still fails, plainly:** what remains is not LIFE allocating objects; it is V8 boxing doubles in functions that are still in the
baseline tier. Evidence: (a) in an isolated process (`node _harness/probe_life.ts --lf02 --passes=N`, the same replay design, new in this
round), the residual falls as the warm-up lengthens: 30 passes 11 to 26 KB per window, **100 passes 0.2 to 8.3 KB** (default V8 flags);
with V8's TurboFan tier-up lowered (`--invocation-count-for-turbofan=50`) 100 passes give **32, 1264, 48, 0, 208, 144 B**; (b) `--trace-opt`
at the start of the measured windows lists the functions not yet optimized: the rare ones (startBask, startNap, startZone, startLove,
runBask, rideThink, freeTarget, leanTo, besides, sway, comeBackTarget, wishThink, ...), and the heap profile's remaining sites are exactly
those (for example `startBask < Math.sin`: the builtin returns a HeapNumber when called from baseline code); (c) node 22 ships TurboFan
without Maglev and tiers up after about 3000 calls; a branch taken a few times a minute never gets there in a probe-length warm-up
(Chrome tiers up with Maglev at about 400 calls, so the browser's steady state is closer to the isolated long-warm-up number).
So the 0 B bar over 6000 ticks after a short warm-up cannot pass in node 22 for any code with float math in rare branches, whatever LIFE
does. **For the orchestrator:** either re-specify LF-02 as "no allocation once the code on the measured path is optimized" (measured in a
process of its own after a long replay warm-up: today 0 to 1.3 KB per 1000 ticks with eager tier-up, 0.2 to 8 KB without), or accept the
residual (at 60 fps the default-tier worst case is about 7 KB/s of short-lived HeapNumbers, a scavenge every few seconds at most). I did
not change the bar or the measurement of the checked row. `--heavy` now prints the isolated 30- and 100-pass numbers as info rows.
| 2 | LF-13 huff rows | DONE 16:05: 3 rows ok (and a new row for the second trigger) |

#### Step 2, LF-13 (engineer 3)
Cause (scratch repro `pg_life3/dbg_spot.ts`, engineer 1's `pg_life/dbg5.ts`): `huffScene` set `huffDue` inside runUse, and in the same think
`choose` consumed it at its 0.5 against everything else (a notice of the rolling ball at 0.9 always won), so the huff was lost; a separate
"the huff shows now" bypass in `behave` contradicted LIFE 4's utility choice. Fix: the scene event keeps B16 a candidate at its 0.5 for 3 s
(`huffDue` counts 30 thinks down), so the huff shows once what it was doing ends (in the probe: the notice, then the huff at +1.6 s); the
bypass is gone; `huffT` (the comfort trigger, S09) is set when the huff really starts. A touch ends it with a happy squint at once and the
giggle bubble and voice at the release (B08's afterglow takes the giggle 100% after a huff: a held squishy shows no bubble, L2). **The
second trigger is now built:** a napper walking to a ring (the Snug Basket) that another squishy takes first gives up that nap (cooldown 5 s)
and the huff is a candidate (`ringTaker`). Probe rows (all ok): the static table; none in the first 60 s; one huff after 60 s, B16 measured
per think lasts 3.00 s (bar 3 s + one think); a touch ends it (B16 ended, squint, giggle bubble +1.50 s after the touch, through the 2.5 s
per-character bubble gap); NEW: the taken Snug Basket gives a huff (+0.1 s). The rows stage the scene with other candidates scoring 0.5 or
more on cooldown, the same way the boop rows do: the huff's 0.5 is LIFE 4's and loses to a notice, a bask or a zone reaction.
| 3 | LF-09 balance: the definition, then the tuning | DONE 16:55: both rows ok (seed 51); 4 more seeds as info |

#### Step 3, LF-09 (engineer 3)
**What counts as a "thing use" (written before tuning; my reading of LIFE.md, put in the probe's comment):** one completed by-itself use of
a thing in LIFE 5.3's sense: a USE event in LIFE's output with `a` = the squishy and `b` != PLAYER (254) whose verb is a mechanism use. In the
cabin that is a boop of the Yarn Ball (B04, or the squishy's own turn in an S12 pass game: USE ROLL; QUESTS 4's USE is "a use completes", so
each boop counts) and a nap settled on a nap thing (the Snug Basket ring or the Snooze Rug patch: USE NAP, LIFE 5.3's ring and rug rows; a
nap beside a sleeping friend off the rug is not a thing use). **Not counted:** B18's USE LISTEN (answering the kettle's whistle): LIFE 5.3's
switch row says a squishy never uses a switch, "it watches, and answers a tune", and B18 is "answer a thing"; moments around a thing (S06
singing by the kettle) and zone reactions (a bask in the hearth's warmth, B05) are not uses either. Round 1's probe counted every USE event,
LISTEN included (that inflated it: 3 LISTENs for one squishy).
What the diagnosis found (scratch `pg_life3/lf09.ts` seeds 51..58 with timelines, `lf09b.ts` time shares and an instrumented endBeh):
1. **Greets lost:** S01's once-per-visit bit was set when a greet *started*; a walk-up greet that found no mover token (med: moverCap 1)
   ended at once and the pair counted as greeted with no SOCIAL GREET. Now an aborted once-per-visit moment (greet, mirror, duet, twirl)
   gives its bit back, and a walk-up waits up to 6 s for the token. And (my reading of S01) an ungreeted pair of wholes starts no other pair
   moment (round 1's probe run had BOOP, SING, PILE, COPY between 0 and 2 and never their greet). 6 of 6 pairs in all 8 seeds, by about 45 s.
2. **A use restarted itself:** `startUse` capped the running score at 1.0 while a favourite ball scores up to 1.2, so `choose` restarted
   the same use every few thinks (behT0 reset; one squishy sat 86 s in B04 phase 0). The running behaviour is now never restarted by its own
   fresh score, and the cap is gone.
3. **B02 noise:** every small gait hop of a hopping neighbour counted as "a land within 1.5 m" (0.9), and the ball a squishy was walking to
   counted as "a thing moving": 54 of the B04 interruptions in 8 runs. A noticeable landing is now one that is not LIFE's own hop (no hop by
   that body in the 0.6 s before), and the thing a squishy is using is not news to it (my reading of B02).
4. **The probe host lost the ball:** the kinematic host let the yarn ball roll out of the cabin (z 3.1 to 4.1 against hz 2.4) after its first
   boop, so no later B04 could find a use point. The host now keeps the ball inside the layout's bounds with the rim bounce 0.35 (PLACES P5,
   P7; PH-05: the ball never leaves through a wall). This is a fixture fix, not a LIFE change.
5. **Pacing (tuning, my reading):** the dozy nap trigger needs rest > 0.6 (round 1: 0.45; a dozy squishy that wakes on the basket napped 3
   times in 5 min); `USES_FULL = 2` (world.ts): after 2 by-itself thing uses this visit a squishy starts no more by its play or its dozy
   trait and no S12 pass (a nap from real tiredness, rest > 0.75, a player-asked use and FIRST_PLAY still come); with play over 0.8 (LIFE 3's
   "at 0.8: a thing use") B04 reaches its ball from anywhere in the place, not only within 3 m.
Result (`node _harness/probe_life.ts`): **LF-09 ok, ok**: 6 of 6 pairs, 4 nappers, thing uses 2 / 3 / 2 / 2 (seed 51). Other seeds (info row and
scratch): 52: 3/2/2/3, 54: 2/2/2/3, 55: 3/2/3/3, 56: 3/3/2/2, 57: 2/3/2/2, 58: 2/3/3/3 all in; **53: 2/2/0/2 out** (Capnap napped twice beside
friends off the rug and its two B04s ran past the 5 minutes). So 7 of 8 seeds hold; the balance stays chaotic and the row checks seed 51.
Side fix: S07 at Home no longer sends a SCOOT to where the body already is (the row leans in place: LF-06's Home segment rule).
Probe after step 3: 81 ok, 1 FAIL (LF-02); probe_life_imports all ok.
| 4 | the friend wish and its input `lifeSetFriends` | DONE 17:20: 4 new FW rows ok |

#### Step 4, the friend wish (engineer 3)
**New additive input (a LIFE value in `src/life/step.ts`, not a contract member):**
`lifeSetFriends(w: LifeWorld, speciesIdx: number, friendMask: Uint32Array): void` — for species `speciesIdx` (catalog idx, 0..63), the
species it may wish to see, a 2-word bit mask by catalog idx: **every species at Friends or closer with it, plus its authored best friend
only once its F3 is found** (so a wish never gives the riddle away, QUESTS 8). Call it on a journal change (a FRIEND level reached, F3 found,
a load or backfill), never per frame; it allocates nothing. LIFE adds the other two conditions itself: the friend is owned (`lifeSetJournal`'s
`owned`) and not out now.
- **For PG_SHELL (the LIFE host):** after `lifeSetJournal`, call `lifeSetFriends` for each owned species whose mask changed (or all 50 at load).
  A friend wish's `lifeWishOf` is `[WISH_KIND.FRIEND (4), the friend's species idx]` (the card: "Crimpo wants to see Thumbly."; the bubble is
  the snug glyph, the friend's tier gem is the render's). **A SOCIAL GREET with `thing = -2` is the friend wish's grant greet: write it to
  the ring with `v = -1`** (no friendship points; the reducer already reads `v < 0` that way, quests.ts 533) and thing -1.
- **For PG_QUESTS:** the producer side of the friend wish is built: WISH SHOWN (kind FRIEND), then WISH GRANTED when the wisher greets or
  nuzzles a squishy of that species (LIFE's `wishFromEvents`). The grant is by SELF from LIFE's point of view; QUESTS 8 says a friend wish's
  grant is by PLAYER (the player brought the friend out): the host should tag a GRANTED of kind FRIEND as by PLAYER. When the pair has not
  greeted this visit (the usual case: a squishy brought out starts with fresh pair rows), the grant comes with the pair's normal greet
  (1 point, as for any friend brought out); only when the pair greeted already this visit does an extra greet happen for the grant
  (S01's once-per-visit limit ignored, thing = -2, no points). That is my reading of "the grant's greet ignores S01's once-per-visit limit
  and gives no friendship points".
- The wisher walks over to greet the friend from anywhere in the place (score 1.2, above the greet-first rule).
**Found on the way, fixed:** the natural wish scheduler ran only at the end of `choose` *after a new behaviour had started and left the
squishy idle* (an early return skipped it on a plain idle think), so natural wishes and re-glances almost never ran. `wishThink` now runs on
every idle think outside a moment. LF-14 and LF-25 still pass (8 wishes in 20 min, gaps 120 s overall, 240 s a squishy, 2 re-glances).
Probe rows (all ok): FW shown (Crimpo wishes to see Dollop at +180 s, lifeWishOf [4, 0], its snug think bubble); none for a species not
owned, one out, or one not in the mask; brought out: greeted +6.9 s and granted at that greet; the grant greet once more with thing -2 when
the pair greeted already. Probe: 85 ok, 1 FAIL (LF-02).
| 5 | LF-18 water exit; probe rows for the S2 FLOAT, WADE, SPLASH, SHIVER, FROST producers | DONE 17:45: 2 LF-18 rows + 4 LF-21 rows ok |
| 6 | the S2 raised-hop switch `lifeSetHops` | DONE 17:55: 1 row ok |

#### Step 5, LF-18 and the S2 REACT rows (engineer 3)
- **LF-18 built** (brain.ts `behave` + `dryTarget`): after 30 s in water (`BRAIN.waterMaxS`, by itself or set there by the player; the timer is
  `inWaterT`, set while the centre is in a water zone or the IN_WATER flag is on) a squishy that may move heads out by SCOOT (travelTo, never
  moveTo; a floater too) to the nearest dry spot: 16 directions x 0.5 to 3.5 m, the first point out of every water zone by R + 0.1 m, inside the
  bounds shrunk by R + 0.2 m and clear of the keep-outs (deterministic, no draw); it runs as B11's travel (BEH.COMEBACK) and retries each think
  until it has a mover token. B06 starts nowhere in water (round 1). HELD, RIDE (a raft) and a moment come first.
- The probe host now marks IN_WATER for a body in a water zone and lets a body float (not GROUNDED) with `add(..., { float: true })`.
- Rows (PG_DATA's Ripple Shore and Frostbell Ridge, wide, from LIFE's real output): LF-18 wader and floater in the Rock Pool, tired and not
  playful, bask / use / wander on cooldown for 30 s (the whole-place Sun would otherwise walk it out first, which also satisfies LF-18): exit
  SCOOT to a dry spot at 30.0 s, out of the water at 35.0 s, 0 wet nap ticks. LF-21: WADE (grounded, surface 0.28) and FLOAT (not grounded)
  once per visit with thing = the Rock Pool (12; a squishy that comes out inside a zone enters it at once, 3.1, so both fire at 0.0 s);
  SPLASH: four landings in the Surf Edge (three 1 s apart, one 5 s later) give 2 events 8 s apart with thing -1 (the Surf Edge has no owning
  thing, so it differs from the Rock Pool: LF-21's "the Rock Pool and the Surf Edge give different things"); Frostbell's whole-place Mountain
  Cold 0.6: SHIVER only for the jelly gel (Dollop), thing -1, and FROST at 16.6 s for both (0.5 / 0.03), thing -1.
- **Open question for PG_DATA / the designer (not changed):** Frostbell's Steam Pool lies inside the whole-place Mountain Cold, and LIFE 3.1
  says frost falls only while its rising cause is absent; LIFE integrates frost up whenever any cold zone covers the centre, so in the Steam
  Pool (warm 1.0) frost does not fall today. If the pool is meant to thaw (a remedy), either the Steam Pool's warmth should mask the cold
  zone at its centre or LIFE 3.1 should say warmth wins; I did not guess.

#### Step 6, the S2 raised hops (engineer 3)
`lifeSetHops(w, raisedFamilies)` (step.ts; a bit per MATERIAL_FAMILY_IDS index): a whole of a raised family hops at its `GAITS.vyS2` (no S1
cap); every other family stays at min(vyS1, 0.84); pieces keep the S1 cap in every slice (LIFE 5.2: apex 3.5 cm); Calm x 0.6 as before. **For
PG_SHELL:** call it once with the slice (0 in S1; in S2 the mask of families PH-01 passed with `auto` landings), never per frame. Row ok:
Dollop (jelly gel) max vy 1.20 raised, Boingle (firm silicone, not in the mask) 0.84, a Dollop piece 0.64, mask 0 back to 0.80, Calm 0.72.
| 7 | S05 parade, P04 join in, the curious one walks over after a cut | DONE 18:40: 3 new rows ok; probe 95 ok / 1 FAIL (LF-02), 4.0 s |

#### Step 7 (engineer 3)
- **S05 parade** (social.ts, moment id `MOM.PARADE` = 19 inside LIFE; its SOCIAL sub is PARADE): a curious one (curious > 0.5) within 2 m
  sees a leader hop; when the leader's bouncy is 0.6 or more and another idle, free whole stands within 2.5 m of it, the moment is a parade
  (score copy + 0.1; in a place only: at Home targets must stay on the framed segments). Members: the leader first (the star bubble), then
  the curious one and up to two more. Turn by turn, one mover at a time: the leader glides about 1.2 m on (12 headings 30 degrees apart from
  the line's heading turned 60 degrees a leg, 1.2 then 0.8 m, inside the shrunk bounds, clear of the keep-outs and of every body), then each
  in turn glides up behind the one in front (0.7 m between centres, never overlapping: at least the two radii + 0.1), a chirp at each turn;
  two legs (my reading of "the loop is done"), at most 45 s. A parade that found no room for its first leg ends without an event. SOCIAL
  PARADE: a = the leader, b = the second, n2 = the members (the reducer gives +1 per neighbour pair).
- **P04 join in** (brain.ts `joinCandidate`): a face piece within 2 m of a whole that booped a ball in the last 4 s (LIFE 9's window), and
  within 3 m of the ball, copies the use (0.9): its group follows (P01) and hops together (P03); the PIECES record carries n at a new high.
  **Fixed on the way:** a piece's USE went out as PIECES with sub = the bare verb (ROLL = 1, the same number as REACT FLOAT); it is now
  `PIECES_USE + verb` (64 + verb, data/quests.ts), as the reducer reads it. And a piece group joining a whole's use is no longer "taken from"
  (the huff's take test is for wholes only; pieces never huff).
- **The most curious walks over after a cut** (LIFE 9): at a CUT touch the most curious other whole gets `lookAt` (the cut whole's slot = its
  pieces' group key) for 20 s; once it may move (the Cut tool's quiet holds wholes) it walks (B13 WATCH, phase 1, score 1.0) to a spot
  beside the face piece (0.9 m, or the two radii + 0.3) inside the shrunk bounds and clear of the keep-outs, then watches it 3 s with a wow
  bubble. Not at Home (the segment rule: it watches from its slot). A walking-over squishy is not free for other moments.
- Rows (all ok): S05 PARADE n 3, leader slot 0, 4 glides, 0 frames over moverCap, 0 double moments; P04 PIECES (sub 65 = PIECES_USE + ROLL)
  n 1 at +7.3 s on the Yarn Ball; LIFE 9: Dollop from 4.47 m to 0.84 m of the face piece within 20 s of the quiet lifting, gazing at it.
| 8 | size (last): cheap and safe reductions | DONE 19:30: 108 312 -> **97 864 B** minified; the 75 KB target is NOT reached |
| 9 | QU-16 answer for PG_QUESTS; autonomy-off naps | DONE 19:40 |

#### Step 8, size (engineer 3; measured as round 1: `pg_life3/bytes.mjs` = round 1's `pg_life/bytes.mjs`, each module bundled alone by rolldown, every import external, minified)
Before the size work, with this round's features: **108 312 B** (round 1 ended at 101 401). After: **97 864 B min, 39 820 B gzip** (world 9 402,
traits 1 138, attention 6 660, voice 4 256, act 6 092, looks 8 023, social 17 484, wish 6 858, brain 29 255, step 8 696).
- **LifeWorld's field names shortened** (227 fields, 2 343 references, renamed with the TypeScript 6 language service's findRenameLocations,
  scratch `pg_life3/tools/rename.cjs`, the map in `pg_life3/tools/LifeWorld.map.json`; precise: every reference in the program, the probe
  included): 108 312 -> 98 925. Kept: `species` (PG_AUDIO's `_harness/audioview/life_checks.mjs` writes `w.species`), `f`, `att`, `movers`,
  `def`, `home`, `seed`, `visit`, `layout`, `placeIdx`, `bodyScale`, `night`, `maxChars` and every name of 3 letters or fewer. **LifeWorld is
  internal: hosts use the functions** (`lifeAttention`, `lifeDebug`, `lifeWishOf`, ...). The probe was updated by the same rename; every row
  gave the same numbers before and after (identical decisions).
- Dead code: 8 never-used fields (hopsLeft, tossN, rideSeen, noticeSrc, zoneIn, mX, mZ, leaderIdleT), 12 unused time reads, looks.ts' dead
  FAM_MOCHI / FAM_SLIME branch. Repeated patterns as tiny integer-only helpers: `say` (27 calls), `voice` (23), `qT` (15), `noLean` (16),
  `freeSpot` (6). Together 98 925 -> 97 681 (the autonomy-off nap of step 9 added 183).
- **Why not 75 KB, plainly:** what is left is code, not names: property names are now about 12 KB of the 98 KB, the import / export lists of
  the per-module measure 8.5 KB (5.5 imports, 3.0 exports; they vanish in a real bundle), `/* @__PURE__ */` annotations 0.8 KB. Reaching 75 KB
  needs about 23 KB less logic: a table-driven behaviour runner instead of brain.ts' per-behaviour functions, the moment state machines of
  social.ts folded into a few shared turn-by-turn steps, enum objects (BEH, EMOTE, STYLE, PHRASE, LIFE_FLAG) destructured to locals. Those
  are rewrites of tested behaviour, not cheap and safe, and I did not start them at the end of a run. The D-92 overflow rule decides.

#### Step 9 (engineer 3)
- **PG_QUESTS asked to confirm QU-16's "needs autonomy" set against LF-24.** LIFE today: BOOP, NUZZLE, COPY, PARADE, SNUGGLE, PASS, PEEK and
  COMFORT start only when the squishy may move (`canMove`), so none happens with autonomy off: **confirmed**. GREET within 1.6 m (a lean),
  CHAT, SING, MIRROR (a sway), DUET, TWIRL (a turn each, then a sway), TEETER and PUSH (rides the player set) still happen. **PILE:** round 1
  started no nap at all with autonomy off (B06 sat inside the may-move branch), so no PILE; now (LIFE 5.6: sleeping moves nothing) a squishy
  with autonomy off naps where it is on the same triggers, so piles still form when two nappers touch: QU-16's set is right for PILE too.
  The autonomy-off branch is evaluated only when the squishy may not move, so an autonomy-on think draws its noise in the same order as
  before (LF-09's seed 51 depends on it). LF-24 rows still ok (0 motion intents with autonomy off).

## STATE AT ENGINEER 3's STOP (2026-11-16 ~19:45 UTC). `npx tsc --noEmit -p tsconfig.json` CLEAN.
Commands: `node _harness/probe_life.ts` (exit 1: **95 ok, 1 FAIL (LF-02)**, 3.8 s), `node _harness/probe_life_imports.ts` (all LF-12 rows ok),
`node _harness/probe_chatter.ts` (PG_AUDIO's, imports voice.ts: 31/31 ok). `--heavy` adds LF-01 over 600 s, LF-14 over 30 min and the isolated
LF-02 measurements. Nothing of mine is running.
The five rows of the scope: LF-09 x2 ok, LF-13 x2 ok (+1 new row), **LF-02 still FAIL** (58 to 105 KB per 1000 ticks in the probe; down from
161 to 189 KB; the remainder is V8 baseline-tier boxing in rarely run functions, step 1). New rows this round (all ok): 4 FW (friend wish),
2 LF-18, 4 LF-21 (FLOAT, WADE, SPLASH, SHIVER + FROST), LIFE 5.2 raised hops, S05 parade, P04 join in, LIFE 9 walk over.

### New API (all LIFE values in src/life/step.ts, additive; no contract change)
- `lifeSetFriends(w, speciesIdx, friendMask: Uint32Array)` (step 4); `lifeSetHops(w, raisedFamilies)` (step 6).
- Event conventions added: SOCIAL GREET `thing = -2` = the friend wish's grant greet (write `v = -1`, thing -1 to the ring); a piece group's
  USE as PIECES now has `sub = PIECES_USE + verb` (64 + verb) as data/quests.ts defines (it was the bare verb).

### Requests to other lanes
- **PG_SHELL (LIFE host):** call `lifeSetFriends` after `lifeSetJournal` for each owned species whose mask changed (all at load): the mask is
  every species at Friends or closer with it plus its best friend once its F3 is found; write SOCIAL GREET with thing -2 as `v = -1`; tag a
  WISH GRANTED of kind FRIEND as by PLAYER (QUESTS 8); call `lifeSetHops(w, 0)` in S1 and `lifeSetHops(w, maskOfFamiliesPH01Passed)` in S2;
  LifeWorld's fields were renamed (internal): read nothing from `w` but through the functions. The CUT touch kind on the whole before the
  shell removes it is what starts the curious one's walk-over (LIFE 9). No request touches src/shell code in this repo.
- **PG_PHYS:** none new. (LF-18 relies on `scootTo` gliding a floating body, PH-15, as specified; the probe host only models it.)
- **PG_DATA / the designer:** the Steam Pool (Frostbell) lies inside the whole-place Mountain Cold, and frost "falls only while its rising
  cause is absent" (LIFE 3.1), so frost does not fall in the Steam Pool today: decide whether its warmth masks the cold (step 5).
- **PG_QUESTS:** the friend wish's producer side is built (step 4); QU-16 confirmed (step 9).
- **PG_AUDIO:** (1) the syllable budget still charges every syllable at a phrase's start (`voiceOk`), so three singers x 4 notes exceed the
  burst: not changed this round (out of my scope's time); (2) LOVED's degree 4 is now commented as "4 pentatonic steps up (a sixth): the
  contract's range caps it".

### Not done (plainly)
- **LF-02** still fails its bar (step 1 for the numbers and the proposal to re-specify it as the optimized steady state).
- **Size:** 97.9 KB, not 75 KB (step 8).
- LF-09 holds for the probe's seed 51 and, at the stop, 5 of 7 other seeds (52, 55, 56, 57, 58 in; 53: 2/2/0/2 and 54: 2/1/2/3 out; the
  info row prints 52 to 55 on every run). The balance stays chaotic: small changes move single squishies across the 2..3 band.
- Not built from the S1/S2 list: SOAK by water (S2 rain/water look rows not probed), GLIDE (ice, S2: no producer), the squirt game's LIFE
  part beyond SQUIRTED, the snow cap from standing on snow, B19 gusts in a real place (S3), S05 copying a thing use by a whole (P04 copies a
  use; a whole's S05 copies hops), the 3-tosses "dizzy" beyond 5 s of grace, B17 comfort's "a greet from the other ends a huff".

## Round 4 (engineer 4, started 2026-11-17 06:20 UTC, from HEAD 7e64f2018 + other lanes' uncommitted edits)
Scope (orchestrator): (1) the three FAIL rows of `probe_pg_lifequests.ts` that are LIFE's: C8's song of three (QU-13 med, QU-08) and QC's
FLOAT; (2) round 2's not-built list: SOAK by water, GLIDE, DRIFT, GAZE_SKY and PRINT producers, the snow cap, B19 in real places, probe
rows for LIFT, RATTLE, GLOW, SHOWER, FIZZ; (3) PF-00's unit weights in attention.ts (F stays 4); (4) LF-02 measured once in a real browser
tab (port 5369). Lane: src/life and my probes (`probe_life.ts`, `probe_life_imports.ts`). Scratch: `.../scratchpad/pg_life4/`.
Baseline at 06:23: tsc clean (2.9 s); `node _harness/probe_life.ts` 95 ok / 1 FAIL (LF-02: max 104 928 B per 1000 ticks), 3.8 s;
`probe_life_imports` all ok; `probe_chatter` 42/42; `probe_pg_lifequests` 10 ok / 3 FAIL (QU-13 med C8, QU-08 C8, QC: rainleaf REACT 1
splashspots, lanternroof REACT 1 moondish).

| R4 step | What | State |
|---|---|---|
| 0 | read report, SESSION3, brief (+ D-95 revised in PLAYGROUND_BUILD 1361: LIFE never switches AUTO; nothing else for LIFE), LIFE 4.2 / 6.1 / 5.3, PLACES 2 / 2.5 / 4.2, QUESTS C8, the probe | DONE 06:24 |
| 1 | C8's song of three: S06 rebuilt around the tune; `lifeThingTap` (the fire puff, a chime row); walk-up greets without a token wait; LF-09 balance | DONE about 06:47 (LIFE side); the probe_pg_lifequests C8 rows still FAIL (below, plainly) |

#### Step 1, C8 (engineer 4)
**Why no song of three came (scratch `pg_life4/fin*.ts`, `sg*.ts`, `fire*.ts`, each a copy of the probe's kinematic host):**
(a) S06 gathered its singers within 2.5 m of the *first singer*, not of the tune, and only from B01-like idle states, so a squishy that had just
started B18 (answering the whistle) could neither start nor join the song; (b) a walk-up greet with no mover token waited reserved up to 6 s
(round 2), and with moverCap 1 two such waits kept their partners in moments for 20 to 30 s: in the probe's finale the three set by the kettle
at 30 s were all inside greets at its 40 s whistle; (c) LIFE could not hear the fire puff at all (no seam: the shell's tap toggles the fire
zone and draws a puff; the snapshot's thingState never changes for a block), though LIFE 6.1 names "the fire puff" as a tune and PLACES 4.2's
finale is "the fire swells and everyone sings"; (d) the probe's SG diagnostic window ends 12 s after the carry, 7 s after the whistle, before
any song can end (a song ends at its next bar line + 2 bars, 7.3 to 10.9 s after it starts): its "0 SING" is partly its window.
**Built (src/life):**
- `lifeThingTap(w, thing)` (step.ts, additive LIFE value, no contract change): the player tapped or switched place-global thing `thing` now.
  Every squishy within 1.5 m notices it at once (LIFE 5.3's switch row; B02's switch-tap path existed but nothing fed it for a block); a
  fire switch's puff (`p.puffS`, 5 s) or a tapped chime row (one bar) is an S06 tune at that thing. **For PG_SHELL:** call it from
  `tapThing` (and the keyboard's "Tap it yourself") after the tap's effect; for the Fireplace only when the fire comes on or grows.
- S06: the singers are everyone who may sing within 2.5 m of the playing tune (Home: as before, 4.5 m of the first); "may sing" (my reading
  of S06's "idle", which S07 spells "idle (not napping)") = not napping, not using a thing (a B04 still waiting for its token may), not walking
  on purpose, not in a moment, not held, not riding: idle, looking, noticing, answering (B18), afterglow (B08), zone reaction (B15), love
  (B10), arrive, cheer, or basking in its warm pose (it sits up to sing). A latecomer near the tune that becomes free before the song's first
  bar line joins it. A noticing squishy whose notice is of the tune's own thing may start the song at once. A snuggle does not take a
  squishy that would rather sing. The song's score at a tune is 0.95 (round 2: 0.8; it lost the fire's song to a dozy nap or a favourite
  ball about one time in four); the two chatty friends' song stays 0.45 and now names no thing (-1; it named the kettle).
- S01: a walk-up greet is a candidate only while a mover token is free (the brief's "joint moments reserve their tokens and units together
  or do not start"); no reserved wait.
- LF-09 levers found on the way (the greet change alone dropped the probe's seed 51 to 3/2/0/3): B04's walk to the ball has its own deadline
  (3 s + 1.5 x the walk at the glide speed; round 2's 12 s from the start cut every walk of a slow family from across the room, with the token
  spent: capnap made 8 B04 starts and 0 uses in seed 51); a B03 wander does not take the mover token while another squishy waits for it in
  B04's first phase (`w.tw`; with moverCap 1 wanders held the token 35 to 73 s of a 5-minute visit while uses waited 78 to 168 s).
**Numbers (scratch, 20 or 24 seeds each, the probe's host):**
| scenario | HEAD 7e64f2018 | now |
|---|---|---|
| LF-09 over seeds 51..74 (every pair greets, each 2..3 uses) | 14 / 24 in; uses hist 0:2 1:10 2:52 3:31 4:1 | **19 / 24** in; 1:4 2:54 3:36 4:2 (seed 51: 3/2/3/2) |
| SG staging (four set by the kettle 5 s before, high, 20 s windows; 45 whistles) | 21 songs: 18 of 2, 3 of 3 | 20 songs: 7 of 2, **9 of 3, 4 of 4** |
| fire puff, three set by the Fireplace 3 s before the tap (lifeThingTap), 20 seeds | (no seam) | song of 3+: **med 16/20, low 17/20, high 12/20**; 1 s before: med 20/20 |
| the probe's own finale staging (three by the kettle at 30 s, 330 s, 5 out; no fire seam), 20 seeds | med 1/20, low 1/20 | **med 0/20, low 15/20, high 0/20** |
New probe rows (probe_life.ts, all ok): S06 at the kettle's whistle (one SING n2 3, thing the kettle); the fire puff by lifeThingTap (both
within 1.5 m gaze at the Fireplace within 0.15 s; SING n2 3, thing the Fireplace, +10.5 s); no tap and no kettle, no song; a latecomer held
when the fire puffed joins at +2.0 s, before the bar line at +3.1 s (n2 3). `node _harness/probe_life.ts`: **99 ok, 1 FAIL (LF-02)**;
probe_life_imports all ok; probe_chatter 42/42; tsc clean.
**probe_pg_lifequests, plainly:** QU-13 med and QU-08 still FAIL on C8, and **QU-13 low and QU-03 now FAIL too** (they passed at HEAD on a
lucky seed: the session's low finale is seed 150, one of the 5 of 20 that miss; HEAD made a song of three in 1 of 20 low finales, this code in 15
of 20). On med the probe's staging cannot give a song of three under LIFE's rules: the kettle sits in the Window Chill corner, so after the
first whistle (40 s, while the three set there at 30 s are in the moments their afterglow giggle starts: a nuzzle and a snuggle) nobody is
near it (the whole med session, about 36 minutes at the cabin with a whistle every 67 s, gives one SING, of 2). The designed finale tune is the fire puff, which the
probe writes only as a ring record and never tells LIFE. **For PG_QUESTS:** in `session()` step 5 call `lifeThingTap(sim.w,
THING_IDS.indexOf('hearth'))` where the probe writes the player's fireplace USE (the shell's host will do the same once PG_SHELL wires it),
and carry the three to the Fireplace (not the kettle) before the tap, as a player following "Tap the fireplace. Then three sing" would;
lengthen SG's window to 20 s. I did not edit their probe. **Not done:** a song's voices: the attention budget charges a phrase's syllables
at its emission (all 6 bar phrases at once) and reserves its voice slot through its delay, so of three singers only one is voiced (the kettle
row logs 1 voice intent for the song; LIFE 8.4 wants 3 on desktop, 2 on a phone). 3 singers x 4 notes a bar is 3.3 syllables a second, inside
the desktop rate of 4 but not the burst of 6 charged at once: a budget that charges syllables at their start times is the fix (attention.ts,
LF-07's storm rows must still hold); for PG_AUDIO / the designer to confirm before I change it.
| 2 | FLOAT honest (QC): shallow water, the float table, the body's own 1 s | DONE about 06:51: QC ok (1020 LIFE events at the 8 S2 / S3 places, all inside PLACE_CAPS) |

#### Step 2, FLOAT (engineer 4)
Cause (PG_QUESTS round 3 had it right): FLOAT held for "in a water zone and not GROUNDED" and its 1 s was timed from the zone entry, so a
squishy that stood a second in a splash spot and then hopped was "floating" on the hop's frames (Rainleaf's Splash Spots, Lanternroof's Moon
Dish: surfaces 0.06 to 0.08 m). Fix (looks.ts): FLOAT needs water that is not shallow (surface 0.12 m or more: PLACES 2's water row, the line
WADE and journal.ts PLACE_CAPS use), the body not grounded and not on a prop, and **the float table** (PLACES 2.5, LIFE 4.2's "it floats by
the float table": the submerged share of its sphere at that surface, h^2 (3R - h) / (4R^3), more than its density, a foam's lerping to its
soaked density by its soak look); FLOAT's and WADE's 1 s now time the body's own state without a break (`w.fT`, `w.wdT`). The host's
IN_WATER flag with no zone geometry still counts (fixtures). **Re-specified fixture (written reason):** round 2's FLOAT row floated Dollop (a
jelly gel, density 1.02, which sits in 0.28 m of water) by a host flag; the floater is now Cushlet (marshmallow 0.11); same checks and bars
(FLOAT at 1.0 s, thing the Rock Pool; LF-18's floater exit at 30.0 s, out at 35.9 s). New row: no FLOAT from a hop in a shallow splash, a hop
in the Rock Pool, a sitter the host marks not grounded, or a floater on a prop (0 / 0 / 0 / 0; the Surf Edge gives SPLASH, 2). Numbers:
`probe_life` 100 ok, 1 FAIL (LF-02); `probe_pg_lifequests` QC ok (coverage info: ripple 3/7, fizzwell 3/8, others as before: the host's
sitters marked to float no longer FLOAT).
| 3 | the S2 / S3 producers: SOAK by water, GLIDE (+ the ice glide use), DRIFT, GAZE_SKY (+ the comet), PRINT, the snow cap, B19 by a gust clock; rows for LIFT, RATTLE, GLOW, SHOWER, FIZZ, DRY, LOVE | DONE 07:02: 15 new rows, all ok; probe_life **114 ok, 1 FAIL (LF-02)**; QC still ok (814 events) |

#### Step 3, the producers (engineer 4)
All in src/life; every row is LIFE's real output on PG_DATA's place, wide layout, on probe_life's kinematic host (which now coasts a GLIDE
nudge at e^-0.5t, drifts a floater round a disc's flow, and can report a switchable zone off).
- **SOAK by water** (the code was there; row): a marshmallow in the Rock Pool soaks to 0.5 at 8.3 s, thing the Rock Pool; in Rainleaf's rain,
  thing -1.
- **GLIDE**: looks.ts measures a glide on an ice patch (a patch with `ice`: its grip is the family's ice grip, under 0.5 for every family
  but sticky stretch and slime goo) from the snapshot's speed x dt while LIFE is not driving it (a scoot), and fires GLIDE at 0.5 m (event, 10
  s), thing the patch's (the Ice Pond). The producer: B04 now also uses an ice patch thing (Frostbell's Ice Pond; QUESTS I3) for a family
  that glides: walk to the patch's edge (R + 0.1 inside it), then the glide of LIFE 5.1, one nudge of 0.6..1.0 m/s toward its middle (new
  `emitGlide`, act.ts: a SETTLE first so the walk's scoot driver lets go, the mover token kept for the coast), USE with the thing's verb
  (STEP). Row: a firm silicone glides (nudges 0.85 m/s), GLIDE thing the Ice Pond, 10 s apart, USE STEP; a slime goo never glides.
  **For PG_PHYS / the designer:** with LIFE 5.1's 0.6..1.0 m/s nudge and PLACES 2.4's ice grip (firm silicone 2.25 x 0.08 = 0.18), a
  Coulomb slide stops in v^2 / (2 mu g) = 0.1 to 0.28 m, under GLIDE's 0.5 m; whether a soft body's slide goes further is PH-08's to say.
  If it does not, I3 can never complete from LIFE's own glides (a toss on the ice still can).
- **DRIFT**: floating (FLOAT's condition) inside a current (a water zone's own flow, or a current zone the host reports on: Fizzwell's tap
  swirl) and not driven by LIFE, carried 0.3 m, once a visit, thing the zone's. Row: 4.4 s in the Rock Pool (0.08 m/s), a wader none.
- **PRINT**: its first print on a marking ground (PlaceDef.ground.mark) or patch (PatchDef.mark), moving or landing on it, grounded and not
  in water; a patch without marks (the Ice Pond) covers the ground's. Thing the patch's owner, else -1; once a visit. Row: Ripple's sand
  once, the cabin's floor none.
- **GAZE_SKY**: at night, idle (B01) within 1.5 m (+ R) of a sky thing (ThingDef p.sky: the Moon Dish) for 3 s, once a visit, thing the dish;
  **the comet**: `lifeThingTap` on a 'comet' switch (the Star Scope) gives every character on screen GAZE_SKY at once, every time, thing the
  scope. Row: 10.2 s (it arrived, greeted and noticed first), the one 3 m away none, two comets 4 events.
- **The snow cap**: on snowy ground (PlaceDef weather 'snow': Frostbell) the snow look rises 0.03 a s while still and grounded (not in water,
  not in warmth) to its 0.3 cap (LIFE 3.1); it never crosses 0.5 by itself; the pine's puff and a snowball (lifeAddLook) do. Row: 0.031 a s,
  0.30 cap, no SNOWCAP by itself, a snowball's +0.3 gives SNOWCAP with the snowball, falling 0.2 a s while moving.
- **B19 in real places**: no lane had a gust schedule (physics has no gust force, the shell sets the wind bit whenever a body is in the wind
  zone, audio runs its own WeatherClock), so round 2's B19 held on every 2.5 s, all the time, in the Night Breeze. LIFE now keeps a gust clock
  on sim time for every wind zone with `gust` data (world.ts `gustStep`: everyS apart, forS long, from a hash of seed, visit, zone and time;
  deterministic, no allocation) and B19 starts once per gust while grounded in the zone, lasting the gust (a wind zone without gust data
  keeps round 2's wind-bit rule). **New `lifeGustOn(w, zoneIdx)`** (step.ts): **for PG_SHELL**, drive the wind's force on airborne bodies
  (PG_PHYS) and the gust sound (PG_AUDIO's `weather`) from it, so the lean matches what the player sees and hears. Chunks hold on too (W F C);
  an event kind's PIECES now counts the group's pieces that did it in the last 3 s (round 2 counted only the visit list: an event kind's
  PIECES always said n = 1). Rows: 7 gusts in 60 s, HOLD_ON x7, holding on 96% of gust time; three pieces in the breeze: PIECES HOLD_ON n 3
  (QUESTS L6).
- **SHOWER fixed**: round 2 fired it for any wet zone, Rainleaf's whole-place rain included; now only the zone of a 'shower' switch thing (the
  Drip Leaf) while the host's wet bit is on there (the rain's on-phase or the leaf tapped), thing the leaf. **FIZZ**: the Bubble Patch by its
  THING_IDS index (round 2 typed 36). **A REACT's thing** is now the trigger zone's own owner when it has one, else the snapshot's zoneThing
  (FIZZ inside Fizzwell's bath: both zones strength 1 and the snapshot named the bath; QUESTS T4 counts thing bubblepatch).
- Rows for LIFT (Cloudloft's updraft: airborne 0.3 s, 5 s apart, thing the updraft), RATTLE (a bead squeeze 0.7 m from the switched-on
  magnet, thing the magnet; a jelly gel none; the magnet off none), GLOW (the Glow Pool, 1 s after it is set in), SHOWER (the leaf, 20 s
  apart; in the rain elsewhere none; the leaf dry none), FIZZ (1 s after it is set in, thing the patch), DRY (in the Fireside Warmth after a
  soak, thing the Fireplace), LOVE (Dollop at the cabin, once).
**Not built (plainly):** a cut on the ice giving PIECES GLIDE (QUESTS I6: the pieces would have to slide 0.5 m on their own; no rule for it);
GAZE_SKY's pose and moon bubble (the event only); the S2 squirt game's LIFE part beyond SQUIRTED; S05 copying a whole's thing use;
pads, chimes, pools and turntables as B04 uses (S2 / S3).
| 4 | PF-00's unit weights in attention.ts (F stays 4) | DONE 07:03: LF-10 rows ok (re-specified, reason below) |

#### Step 4, PF-00 (engineer 4)
From PG_PHYS.md section 5 (a loaded machine; its own recommendation): **F = 3.71 measured, kept at 4** (same mover caps); `UNIT.piece` 0.22 ->
**0.26**; pair 0.25 (same); sleeper 0.03 kept (the measured 0.0002 would lower D-85's floor, which follows it); `PROPS_MS` 0.20 -> **0.33 ms**;
`C_WHOLE_MS` 0.87 kept (PF-00 read 1.11 on the loaded machine and asks for a quiet re-run first). social.ts' sleeping-body wake costs now
derive from `WAKE` (round 2 typed 970 / 190 milli; a piece is now 230). Caps by the formula: **unitCap 1.060 / 1.345 / 2.494** (low / med / high;
was 1.06 / 1.49 / 2.64), **moverCap 1 / 1 / 2 (unchanged)**; F = 3: 1.15 / 1.92 / 3.45, movers 1 / 1 / 3; F = 2: 1.92 / 3.07 / 5.37.
**Re-specified rows (written reason, in the probe):** LF-10's two cap rows typed LIFE 10.3's table, which was computed with the provisional
props 0.20 and says "PF-00 re-measures the weights"; they now check the same formula against PF-00's numbers typed in the probe, exactly as
tight (0.001), and print round 2's table as info. Every other LF-10 row is unchanged and ok (all-asleep starts on low and med, one awake + two
asleep at the cap, S11 and S10 on low and med, soft boop low and med, physics boop high, 0 movers over, 0 wakes over). LF-09 over 24 seeds:
19 / 24 (the same: with 4 wholes on med a second awake whole is 2.06 against 1.345 or 1.49 alike). probe_life 114 ok, 1 FAIL (LF-02).
**For PG_SHELL:** later-life.ts computes `LifeSnapshot.units` with its own literal 0.22 for an awake piece; use `UNIT.piece` (exported by
src/life/step.ts) so the shell's units and LIFE's wake deltas agree (contracts.ts' comment on `units` also still says 0.22).
| 5 | LF-02 measured in a real browser tab (port 5369, one heavy job; the bar and the node row unchanged) | DONE 07:06: numbers below |

#### Step 5, LF-02 in Chromium (engineer 4)
New harness (mine): `_harness/probe_life_browser.mjs` (vite on 5369 through pw.mjs, headless Chromium 153, nothing left running) loads
`_harness/lifeview/lf02.html` + `lf02_work.ts`, which replay **the very same crowd** as probe_life's LF-02 row (16 characters in the cabin, high
tier; the kinematic host moved unchanged into `_harness/life_host.ts`, which probe_life now imports: every row gives the same numbers). Each
1000-tick window is read through CDP (`HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage` before and after; performance.memory is
bucketed in headless Chromium, so the first try read 0 everywhere and was void); an empty call's own growth (10.7 to 16.7 KB, CDP's) is the
baseline, its smallest subtracted. Command: `node _harness/probe_life_browser.mjs --port 5369 --passes 3,30` (about 1 min), `--sample` adds
an allocation-sampling profile (64 B interval) of 2000 more ticks.
| warm-up before the measured world | Chromium (V8 with Maglev), B per 1000 ticks | node 22 (probe_life / round 2's isolated runs) |
|---|---|---|
| 3 replay passes (probe_life's default) | 28 712, 88 316, 53 580, 16 312, 23 424, 34 676 | 68 496 to 123 160 (this round's last run) |
| 30 replay passes | 5 072, 22 116, 728, 6 696, 3 816, 16 472; a second run 7 432, 22 116, 740, 6 696, 3 824, 16 408 | 11 000 to 26 000 (round 2) |
lifeStep costs 4.1 to 5.7 us a tick in the tab (16 characters, unthrottled; node about 8 us). The sampled allocation sites of 2000 more ticks
after the 30 passes: **504 B in LIFE's code** (one site in wishFromEvents, wish.ts) and the rest V8's own (IDLE_EXTERNAL 1 600 B, the bytecode
compiler 408 B, the V8 API 256 B). Reading: the residual is the JIT tiering up the rare paths (the windows fall from 16..88 KB to 0.7..22 KB
with the warm-up, and what is left is mostly V8 compiling and feeding back, not LIFE's objects); Chromium's Maglev gets there sooner than
node's TurboFan-only tier-up. **LF-02 still FAILS its 0 B bar** in node and would in the tab (the 30-pass windows are 0.7 to 22 KB, the
baseline noise about 6 KB). The bar and the node measurement are unchanged; round 3's proposal (re-specify LF-02 as "no allocation once the
measured path is optimized", or accept the residual) stays for the orchestrator.
| 6 | regression probes, sizes, this stop state | DONE 07:10 |

#### Step 6, regressions and sizes (engineer 4)
Run at the stop, each once, with the other lanes' uncommitted edits in the tree: `npx tsc --noEmit -p tsconfig.json` **clean**; probe_app
**187/187**; shellview/node_checks **162/162** (PG_SHELL's tree now has 162 rows; HEAD's brief said 156); probe_gestures **160/160**; probe_merge
**22/22**; probe_trophies **31/31**; probe_collection **73/74** (C08 previewTouch allocation: the known open row, fails on HEAD too); probe_economy
all pass; probe_catalog all pass; probe_chatter **42/42**; renderview/pg_node_checks **40 ok, 0 FAIL**; probe_quests all run checks pass (3 NOT
RUN, others' code); probe_journal all pass; probe_pg_data 2 FAIL (DT-01 Home's camera, DT-11 a salt in PG_QUESTS' code): **the same 2 with
HEAD's src/life restored** (checked by swapping my 7 files out and back), not LIFE's. audioview/life_checks.mjs (PG_AUDIO's, a browser job on
5367) not run (not my port). probe_life **114 ok, 1 FAIL (LF-02)**; probe_life_imports all LF-12 rows ok; probe_pg_lifequests **9 ok, 4 FAIL**
(QU-13 med, QU-08, QU-13 low, QU-03: all C8; QC now ok; the gate counters on low and med 0 / 0 / 0).
**Sizes** (round 3's measure, `pg_life3/bytes.mjs`: each module bundled alone, minified): world 10 424, traits 1 138, attention 6 661, voice
4 256, act 6 282, looks 10 316, social 18 987, wish 6 858, brain 31 091, step 9 499: **src/life 105 512 B min, 42 532 B gzip** (round 3 stop:
97 864 / 39 820; +7.6 KB for this round's producers, the song, the gust clock and lifeThingTap / lifeGustOn).

## STATE AT ENGINEER 4's STOP (2026-11-17 ~07:10 UTC). tsc CLEAN. Nothing of mine is running (port 5369 free).
Files (all mine): src/life/{act,attention,brain,looks,social,step,world}.ts; _harness/probe_life.ts; NEW _harness/life_host.ts (the kinematic
host, moved out of probe_life.ts unchanged), _harness/lifeview/{lf02.html,lf02_work.ts}, _harness/probe_life_browser.mjs; this report.
**New LIFE API (additive values in src/life/step.ts, no contract change):** `lifeThingTap(w, thing)` (the player tapped or switched a thing:
the switch-tap notice, the fire puff and a chime row as S06 tunes, the Star Scope's comet as GAZE_SKY for everyone on screen);
`lifeGustOn(w, zoneIdx)` (LIFE's gust clock per wind zone with gust data). Exported weights changed: `UNIT.piece` 0.26, `PROPS_MS` 0.33.
### Requests to other lanes
- **PG_SHELL:** (1) call `lifeThingTap(w, thingGlobal[th])` in `tapThing` after a tap's effect (every switch, chime and the Star Scope; for the
  Fireplace only when the fire comes on or grows) and for the keyboard's "Tap it yourself": without it the cabin's finale song (C8) and the
  switch-tap notice cannot happen in the game; (2) drive the wind's gust (audio weather, PG_PHYS's force on airborne bodies) from
  `lifeGustOn(w, k)` so the hold-on matches; (3) compute `LifeSnapshot.units` with `UNIT.piece` (0.26), not the literal 0.22.
- **PG_QUESTS:** probe_pg_lifequests' finale (session step 5) should relay the player's fireplace tap to LIFE (`lifeThingTap(sim.w,
  THING_IDS.indexOf('hearth'))`) as the shell will, and carry the three to the Fireplace rather than the kettle; SG's window (12 s) ends before
  a whistle's song can end (20 s needed). With the fire relayed, three set by the Fireplace 3 s before the tap sang together in 16 / 17 / 12
  of 20 runs (med / low / high) on this host, 20 / 20 with 1 s. I did not edit their probe.
- **PG_AUDIO / the designer:** a song of three is voiced by one singer today: the syllable budget (burst 6 desktop, 4 phone) is charged per
  phrase at its emission, and three singers' bar phrases (4 notes each) start on the same bar line, 12 syllables at one instant; LIFE 8.4 wants
  3 voiced on desktop. Per-syllable charging (the phrase's note times) or counting a song's harmony as one group voice would fit; LIFE 10.1's
  numbers decide.
- **PG_PHYS / the designer:** GLIDE's 0.5 m vs LIFE 5.1's 0.6..1.0 m/s nudge on ice grip 0.18 (firm silicone) gives a Coulomb slide of 0.1 to
  0.28 m; PH-08 should say how far a soft body really slides, or I3 (two families glide on the Ice Pond) depends on tosses.
- **PG_DATA / the designer (from round 2, still open):** the Steam Pool inside Frostbell's whole-place cold (frost does not fall there).
### Not done (plainly)
- **C8 in probe_pg_lifequests** (QU-13 med, QU-08; and now QU-13 low and QU-03, which passed at HEAD on a lucky seed): the probe never tells
  LIFE about the fireplace tap and stages the song at the kettle, where LIFE's rules make three free singers rare (step 1 for the numbers).
- **LF-02** still FAILS its 0 B bar (node 68 to 123 KB per 1000 ticks after the 3-pass warm-up; Chromium 16 to 88 KB, 0.7 to 22 KB after 30
  passes, almost all V8's own tiering: step 5).
- A song's voices (one voiced, above); PIECES GLIDE at a cut on the ice (I6); GAZE_SKY's pose and bubble; S2 / S3 B04 uses of pads, chimes,
  pools, turntables; the squirt game beyond SQUIRTED; S05 copying a whole's thing use; size 105.5 KB (the 75 KB target of round 2 not met).
