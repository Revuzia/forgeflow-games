# FIX5_DATA: round 5, the data lane (src/data, src/life, src/physics/props.ts, src/audio and their probes; ports 5367 to 5369)

Brief: the orchestrator's round-5 task (SESSION3.md rules) against `_handoff/reports/VERDICT_PG.md` (B5, B9, D1: DT-01, DT-11, FM, LF-02; B8's cabin
tall layout). Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/fix5_data/`. No earlier FIX5_DATA
report existed: this is the first round-5 data engineer. Started 2026-11-17 17:25 UTC at HEAD f271a93b1 (working tree clean).

## Status (updated after every finished item)
| Item | What | State |
|---|---|---|
| 0 | baseline | DONE 17:35 |
| B5 | Felt Ball beside the squishy on a phone; FN-01 roll >= 0.2 m; DT-01's camera model re-proved | pending |
| B9 | swing and rocker die down in about 2 to 3 swings (empty and ridden); AUTO 10 / 5 deg kept; D-95 rows with peaks | DONE 19:20 for the swing (empty 2.5 swings, ridden 1.5 to 2.5, riders stay on; AUTO 10.0 / 5.0 and the hand unchanged); the rocker: measured, no change (below) |
| DT-11 | salt 0x2c1b3c6d in src/audio/music.ts | DONE 17:40: a legitimate distinct stream, added to the row's list (below) |
| FM | friendMaskOf zero allocation | DONE 17:55: 0 B in every V8 tier; a new row (TurboFan off) fails on HEAD (814 976 B), passes now |
| LF-02 | lifeStep zero allocation (one more attempt) | pending |
| B8c | cabin tall: rocker out from under the hint pill, kettle inside the left edge | pending |

## 0. Baseline (HEAD f271a93b1, tree clean)
- `npx tsc --noEmit -p tsconfig.json` clean (2.3 s).
- `node _harness/probe_pg_data.ts`: exit 1 on DT-01 Home ("stage.ts camera changed (fov 35, pitch 0.27, TARGET_Y 0.42, slots 5/5, missing:
  v.proxy.restRadius * 1.25, v.restHalfW * 1.12)") and DT-11 ("new salt(s) in src: 0x2c1b3c6d"); every other row ok (Hearthlog, Ripple, Frostbell,
  Rainleaf, Fizzwell, Cogwhistle, Lanternroof 0 / 0; Echo Hollow 10 / 20 and Cloudloft 0 / 48 PENDING).
- `node _harness/probe_playground.ts --only=d95` 5/5 (16.4 s): empty pushed 22.9 19.8 17.0 14.7 12.6 10.9 deg half swings; ridden (jellygel, 1.6 m/s
  push) 3.97 deg at most, no half swing over 0.2 deg across the bottom; AUTO swing 10.0, rocker 5.0.
- `node _harness/probe_pg_lifequests.ts` 13/13 here (9.6 s; the FM allocation row passed idle: 0 B), probe_chatter 42/42, probe_journal all pass,
  probe_quests all run checks pass (3 NOT RUN), `node _harness/probe_life.ts` 117 ok / 1 FAIL (LF-02: 88 752, 157 976, 122 888, 72 136, 103 488,
  81 152 B per 1000-tick window).

## DT-11: the salt 0x2c1b3c6d (DONE 17:40)
- Where: `src/audio/music.ts` 826, added in 2a5898f0d (PG_AUDIO round 2): a sparse music style (`st.thin`) leaves some mallet notes out at play time,
  decided by `Math.imul(e.seed ^ 0x2c1b3c6d, 0x297a2d39)` of the note's own seed.
- Why it is a legitimate distinct stream (kept, not replaced by a listed salt): the mallet draws its timbre from `makeRng(e.seed)` = `mulberry32(e.seed)`
  (music.ts 568). A thin decision taken from that same stream (or from a salt another stream already XORs into note seeds) would keep exactly the notes
  whose first timbre draw is high, a biased sound; hashing `seed ^ salt` keeps the two independent and touches neither the composer's stream (`this.r`)
  nor LIFE's `SALTS`. It differs from the 6 SALTS, the 16 listed and the 2 base seeds (the row's own collision check now covers it).
- Change (probe only): `_harness/probe_pg_data.ts` DT-11's `KNOWN` list + 0x2c1b3c6d with this reason in a comment; the row text counts the list
  (`the 17 in src`). Before: `FAIL DT-11 ... new salt(s) in src: 0x2c1b3c6d`; after: `ok DT-11 the 6 SALTS differ from each other, the 17 in src and
  the 2 base seeds; src re-grepped (18 XOR / mulberry32 constants)`. tsc clean.

## FM: friendMaskOf allocates nothing in any V8 tier (DONE 17:55)
- Cause, measured (scratch `fix5_data/fm_rep.ts`, the probe's FM block repeated): idle, the existing row gives 0 B in 20/20 repetitions; with TurboFan's
  compile delayed (`--concurrent-recompilation-delay=300`, what a loaded machine does) or off (`--no-opt`), **every** 10 000-call window is 320 000 B
  (32 B a call). Unoptimized V8 boxes every non-integer Float32Array read into a HeapNumber (the best pair Dollop-Crimpo sits at 4.5 points: 1.5 x a
  nuzzle) and every 32-bit mask word of 2^30 or more (`out[w] |= 1 << 30`, `out[0] >>>= 0`). The verifier's 32 B is that code running for part of a
  window before the optimized code arrived.
- Fix (`src/core/quests.ts` friendMaskOf only; the reducer's state and the API unchanged): the points are compared through the two 16-bit halves of
  their float32 bits (non-negative floats order as their bit patterns; a zero / negative row is never friends), the 64-bit mask is built in four 16-bit
  halves of a module scratch (`FM16`) and copied out with `out.set(FM32)` (a typed-array copy: no JS number), endianness read once at load. Every value
  a JS register holds is a Smi. The 16-bit view of a state's points is made once per `QuestState` array.
- New row (`_harness/probe_pg_lifequests.ts`, next to the old FM row; nothing loosened): "FM friendMaskOf allocates 0 B over 10 000 calls with V8's
  optimizing tier off" = a child `node --no-opt` (process.execPath, portable) over all 64 species against rows at 13 / 4.5 / 12.5 / 40.25 / 11.99
  points with mask bits 30, 31 and 47 (high word), and the six masks checked. **HEAD's quests.ts: FAIL 814 976 B** (run from a `git archive` copy of
  HEAD with the new probe); **now: ok 0 B, masks right.** `node _harness/probe_pg_lifequests.ts` **14/14** (was 13). tsc clean.

## B9: a pushed swing, empty or ridden, dies down in about 2 to 3 swings (DONE 19:20)
**Measured first** (scratch `fix5_data/sw/swing.ts`: the cabin's wide layout, a hand grabs the seat, turns it to 28 deg along its travel, holds 1.5 s, lets
go, AUTO off; half-swing peaks about the seat's rest, the verifier's measure):
- HEAD, empty: 27.4 23.7 20.4 17.5 15.1 13.0 11.2 9.7 8.4 7.2 6.2 5.4 4.1 deg: under 5 deg at the 13th half swing (6 swings; the verifier's 5 to 6).
- HEAD, ridden: jellygel 27.3 12.7 3.8 (1 swing), slimegoo 27.2 14.5 6.6 0.7, marshmallow 27.2 14.8 5.7 1.7, waterfill 27.3 11.0 6.2 4.6 (1 to 1.5
  swings); firm silicone fell off the seat. A ridden swing died 2 to 4 times faster than an empty one, at ANY seat damping: at 0 /s the empty seat
  never stops (27.5 deg every half swing) and the ridden one still dies in 1.5 swings. Cause (read in `softbody.ts` 4424-4446): a soft body's `drag`
  (params.ts 121, `lerp(2.0, 1.0, bounce)` /s, the damper of a body bobbing on its glued foot) acts on its WHOLE velocity, so on a swing it brakes the
  rider in world space and the rider brakes the seat through the contact. Data damping alone cannot make the ridden swing last 2 to 3 swings.
- The rocker (seesaw, PLACES M2: no gravity torque of its own) pushed 7 deg and let go: empty it stays where it is put; one rider tips it to its limit
  and it stays; two riders (jellygel + gummy, 2 marshmallows) go to their balance at once (one half swing of 4.8 / 7.9 deg, then rest) at damping
  0.9, 0.6 and 0.3 alike. There are no swings to count: a seesaw has no restoring torque, so its damping cannot make it rock 2 to 3 times.
  **Not changed** (Rocker Board damping stays 0.9); making it rock after a push needs a restoring torque (a curved rocking base), a design call.

**What changed:**
- `src/data/place_hearthlog.ts`: the Pillow Swing's damping 0.25 -> **0.6** /s. `src/data/places.ts` `MECH_RANGES[swing].damping` [0.15, 0.4] ->
  **[0.15, 0.7]**, re-specified with the reason in the file (the owner's D-95 revision; at 0.25 the empty seat took 5 to 6 swings, VERDICT_PG B9).
  DT-01 / DT-12 still ok. (The two other swings, Lanternroof's hammock and Cloudloft's kite swing, are S2/S3 places not shipped: left as they are.)
- `src/physics/props.ts` (pendulum seats only: mgl > 0 and not a chime; AUTO, the hand and a held rider untouched):
  1. a pendulum seat's damping acts on its OWN inertia (`w *= exp(-c h I_seat / I)`): the empty seat is unchanged, a rider dilutes it (the rider brings
     its own drag);
  2. `RIDER_DRAG_BACK` 1.0 /s: while the seat swings FREE with riders (AUTO off and its share 0, no hand, no held rider, riders' inertia > 0) it gives back
     the drag of the least-damped body (bounce 1: 1.0 /s) for the riders' share of the inertia, so each rider keeps a net drag of 0 to 1 /s of its own:
     never a gain;
  3. the riders hold on (S[34], the same hold AUTO and the hand use) with a share that fades with the swing: (recent top angular speed - 0.25) / 0.15
     rad/s, clamped 0..1, the top speed held with a 1.5 s decay (full hold from about 8 deg of arc, none under about 5). Why faded: the hold acts on the
     rider alone, so a hold kept on in a dying swing fed energy back in (a jelly rider plateaued at 5.5 deg for 7 s; another seat rocked on at 0.13 rad/s
     9 s after AUTO went off). Settings scored over 8 families, 24 s each (`fix5_data/sw/score.sh`): W0 / WR 0.15 / 0.25 one plateau (jellygel 13 half
     swings), 0.25 / 0.25 popdome off its seat, **0.25 / 0.15 every family on, first under 5 deg at the 4th or 5th, no plateau**; drag-back 1.1 brought
     the plateau back (AUTO off: 0.193 rad/s at 9 s), 0.8 left riders at 1.5 swings.
- A rider sitting on the free swing for 60 s with no push: at most 0.07 deg after landing, 0.01 deg in the last 10 s, for all 12 families x 3 genomes
  (`fix5_data/sw/still.ts`): the drag-back does not pump a seat at rest.

**After** (the same scratch measure, peaks about the rest): empty 27.4 19.2 13.3 9.4 6.5 4.6 (under 5 deg at the 6th: 2.5 swings); jellygel 26.6
18.4 10.8 9.3 5.8 ... ; firm silicone 26.8 16.9 11.6 6.3 3.9 (2 swings); slimegoo 27.2 18.3 12.7 8.0 4.3; marshmallow 27.2 19.1 12.5 8.2 4.2; putty
25.6 20.7 9.9 10.0 3.1; waterfill 26.9 18.5 11.4 7.9 4.2: 2 to 2.5 swings, every rider on its seat (HEAD: 1 swing, two riders off).

**probe_playground D-95 rows** (`_harness/probe_playground.ts`; `--only=d95` **6/6**, 26 s; the quick set **55/55**, 35 s, was 54/54):
- NEW row "D-95 default (AUTO off; the owner's revision: a pushed swing, EMPTY OR RIDDEN, dies down in about 2 to 3 swings)": a hand pushes the seat to
  28 deg and lets go; half swings between turning points (half the angle swept: a rider sitting off the middle does not bias them); pass = the first
  half swing under 5 deg is the 4th to the 7th (3 to 6 over 5 deg = 1.5 to 3 swings: "about" admits the half swing below 2, a firm-silicone rider's 4th
  measures 4.9 deg), no growth over 0.5 deg until then and none back over 5 deg after, the rider on 90% of samples, AUTO share 0. Measured now: empty
  23.3 16.2 11.3 7.9 5.6 3.9 (6th); jellygel 22.3 14.7 9.0 6.8 5.0 1.7 (5th); firm silicone 21.1 14.5 9.9 4.9 (4th); slimegoo 22.8 15.2 10.1 6.0 3.1
  (5th); marshmallow 23.1 15.7 10.3 6.0 3.2 (5th); gummy 22.2 14.6 9.0 6.4 4.9 (5th); putty 23.1 14.8 9.3 6.0 2.4 (5th); waterfill 22.7 14.7 9.6 6.3
  2.9 (5th); every rider on 84/84. **HEAD (the same probe on a `git archive` of HEAD): FAIL**: empty 25.6 22.0 18.9 16.3 14.1 12.1 10.5 9.0 7.8 6.7
  5.8 (none under 5 in 11), jellygel 19.3 6.9 2.2 (3rd), slimegoo, marshmallow, gummy, waterfill the 3rd, firm silicone on 11/84, gummy on 16/84.
- RE-SPECIFIED (reason in the probe): the old default row read "the owner's dies after 2 to 3 swings" as "a rider, a 1.6 m/s poke: at most 3 HALF
  swings over 0.2 deg". It stays as the no-motor row with its checks unchanged, retitled "D-95 default, no motor (AUTO never touched): ... one 1.6
  m/s poke (about 4 deg, under the 5 deg line from the start)": rider up to 4.47 deg, 0.031 rad/s after 3 s (under a quarter of 0.394), half swings
  4.5 1.6; empty 20.8 14.5 10.2 7.1 5.0 3.5, 0 growths; share 0. PASS.
- RE-SPECIFIED: the by-hand row's AUTO-off "dies down" was "the 5th half-swing peak under a quarter of the first" (met by the old one-swing rider
  drain, not by the owner's 2 to 3 swings); now "the half swings between turning points under 5 deg by the 7th" (as the new row): released from 19.7
  deg: 15.3 10.0 7.9 5.2, under 5 at the 5th. The AUTO-on, hand and rider-grab checks are unchanged (held 19.7 / 27.1 deg, AUTO share 0.00, back to
  10.0 10.0 10.0).
- AUTO on the swing: the test now lets the seat come to rest before AUTO is switched on (|w| < 0.02 rad/s for 0.5 s, at most 12 s): the row says
  "eased in from rest", and a rider's landing now swings the seat for 2 to 3 swings instead of one (in the quick set the 6 s rider window then held
  only 2 steady half swings: 54/55 before this fixture change). Unchanged checks: AUTO 4.1 10.0 10.0 ... empty, 1.8 7.2 10.0 10.0 ... with a rider,
  every family on 84/84; AUTO off with a rider: the seat's speed at 9..10 s 0.001 to 0.014 rad/s against 0.29 to 0.56 in the first second (jellygel
  10.5 6.6 6.5 3.8 0.3; gummy 10.5 3.5 1.6 0.4); empty off 2.4 8.0 5.6 3.9 2.7 (only decays). **AUTO's arc: swing 10.0 deg, rocker 5.0 deg (0, 1 and
  2 riders) exactly as before; the hand: seat held within 0.6 deg of the hand, the rocker board at -6.86 deg (the hand's -6.86).**
