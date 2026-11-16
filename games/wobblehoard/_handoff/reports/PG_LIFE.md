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
