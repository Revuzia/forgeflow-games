# FIX5_DATA: round 5, the data lane (src/data, src/life, src/physics/props.ts, src/audio and their probes; ports 5367 to 5369)

Brief: the orchestrator's round-5 task (SESSION3.md rules) against `_handoff/reports/VERDICT_PG.md` (B5, B9, D1: DT-01, DT-11, FM, LF-02; B8's cabin
tall layout). Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/fix5_data/`. No earlier FIX5_DATA
report existed: this is the first round-5 data engineer. Started 2026-11-17 17:25 UTC at HEAD f271a93b1 (working tree clean).

**Continuation (second round-5 data engineer, started 2026-11-17 ~19:45 UTC):** the first engineer was cut off; its DT-11, FM and B9 work is
committed in HEAD **16f6ba6fc** (tree clean at the start). Re-checked at 16f6ba6fc: `node _harness/probe_pg_data.ts` still FAILS only DT-01 Home
("stage.ts camera changed ... missing: v.proxy.restRadius * 1.25, v.restHalfW * 1.12"), DT-11 ok. Remaining here: B5 (+ DT-01's camera model), LF-02,
B8c. My snapshot trees: scratch `fix5_data/b5/mk_tree.sh` (git archive HEAD + only this lane's working files), dev server port 5367.

## Status (updated after every finished item)
| Item | What | State |
|---|---|---|
| 0 | baseline | DONE 17:35 |
| B5 | Felt Ball beside the squishy on a phone; FN-01 roll >= 0.2 m; DT-01's camera model re-proved | DONE 21:40 for 2 to 5 out (both frames; browser-checked) and DT-01's model (Home row ok again); FN-01 roll 0.32 / 0.48 m phone, 0.37 m desktop (browser); **NOT POSSIBLE in data with ONE out on a phone** (a new row proves it and fails; needs RENDER) |
| B9 | swing and rocker die down in about 2 to 3 swings (empty and ridden); AUTO 10 / 5 deg kept; D-95 rows with peaks | DONE 19:20 for the swing (empty 2.5 swings, ridden 1.5 to 2.5, riders stay on; AUTO 10.0 / 5.0 and the hand unchanged); the rocker: measured, no change (below) |
| DT-11 | salt 0x2c1b3c6d in src/audio/music.ts | DONE 17:40: a legitimate distinct stream, added to the row's list (below) |
| FM | friendMaskOf zero allocation | DONE 17:55: 0 B in every V8 tier; a new row (TurboFan off) fails on HEAD (814 976 B), passes now |
| LF-02 | lifeStep zero allocation (one more attempt) | DONE 22:50 as a diagnosis: the residual is V8 tiering only (no LIFE object); browser numbers and the re-specification proposal below; **the bar and the row unchanged, LF-02 still FAILS** |
| B8c | cabin tall: rocker out from under the hint pill, kettle inside the left edge | PARTLY DONE 22:30 (LF-13 fixture fixed 23:20): the kettle (and the basket and yarn ball, also cut) inside the phone frame, the wide rocker above the desktop's party row; **the TALL rocker NOT moved** (no spot above the hint line keeps the layout's five spawn spots); new DT-01 rows show it (below) |

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

## B5: the Felt Ball and DT-01's Home camera model (round 5, continuation)
**The shipped camera, measured** (scratch `fix5_data/b5/measure.mjs`: my snapshot tree `b5/tree` = git archive HEAD, dev server on 5367, Wake on a
fresh profile, the real Hoard "Bring out", stage.info / camera / visibleTable / life().things / DOM boxes; logs `b5/m_head_{phone,desk}.json`, shots
`b5/shot_head_*.png`):
- the shell reports only the top and bottom rows (hudBinding `setSafeInsets({ top, bottom })`): **390 x 844: 56 / 130 px; 1280 x 800: 56 / 78 px**;
  SR2's band framing (framing.ts) is ON and shifts the picture by a lens: one Dollop on the phone **0.0955** NDC (40 px up), three out 0.090;
  desktop one 0.034, three out 0.153. **DT-01's old model had no lens at all** (and pinned a stage.ts line round 3 rewrote): the ball at (0, 0.9)
  was 25 px off where the model put it.
- one out on a phone: camScale 1.026 (= bodyScale), visible table **x +-0.533**, z -3.4 .. 1.85; the body fills 67..323 px of the 390 px width
  (matInfo r 128 px); the ball (0, 0.923) at 195, 515 px, **in front of the body's lower middle**. Three out: camScale 2.505, the ball again in front of
  the play squishy (`shot_head_phone_n3.png`). Desktop one out: the ball beside-behind the body; three out: half behind Dollop (`shot_head_desk_n3.png`).
- the first-play roll (FIRST_PLAY 6 s after a held squeeze, the same dev-hook stepping): phone **0.178 m** (the verdict saw 0.10), desktop 0.93 m
  (several boops).

**DT-01's Home model now = the shipped camera** (`_harness/probe_pg_data.ts`, probe only):
- re-pinned stage.ts (round 3's asWhole reach: `rr = asWhole ? ... , hw = ...`, `Math.max(rr * 1.25, hw * 1.12)`; unchanged for a whole body) and
  pinned SR2: framingFor's demand line, the rest column per slot body (`fs[0..4]`), the lens as a view offset, visibleTable's lens-moved rows,
  framing.ts's knobs (marginMin 3 / marginFrac 0.02, maxScale 3.2, minBand 0.35, sideFitFrom 6, enabled) and its measure / fit / goal lines, and
  hudBinding's top-and-bottom-only report. A change of any of them fails the row (as before).
- the camera per (frame, n, scale) is iterated to its fixed point: framingFor's want, the aim (restAim / the mat's middle), the band's demand
  and the lens goal; the projection, ground rays and the visible table carry the lens; the visible table is cross-checked against
  homeview.visibleTableAt called exactly as stage.visibleTable calls it (the lens-moved rows clamped at 0, as homeview does).
- **three rest shapes** (the band framing measures each body's rest column): ball (top 2R, centre R, half width R), squat dome (1.4R, 0.7R,
  1.1R), flat cake (1.0R, 0.5R, 1.25R); they bracket the measured lens (phone one Dollop 0.096 against 0.074 / 0.129 / 0.187; desktop three out
  0.153 against -0.028 / 0.075 / 0.138); every check holds for all three, the bodies drawn in the camera's own shape (an ellipse on screen).
- STAGE_INSETS = the measured reported rows (56 / 130, 56 / 78). HUD_INSETS (the in-view rectangle) **re-specified with the written reason in the
  probe**: the side insets were an assumption over the frame's whole height (16 / 60 px phone, 24 / 24 desktop); the shipped HUD has nothing at the
  sides between the bands but the Journal / account column at the top right (now its own box, 322.. x ..168 px on the phone, 1208.. x ..168 on the
  desktop), and the stage reports no side rows, so the ball's own bounds legally reach the frame's edges; sides now 8 px. Desktop bottom band
  150 -> **136** (the measured lowest HUD band with a party out starts at 670 px = 130, + 6 px); top bands (151, 120) and the phone's bottom (170)
  kept.
- **new B5 rules in the Home row** (the Felt Ball where it really stands: its spot pushed into its bounds, as props.ts's first step does): it covers
  no slot body on screen (never in front of a squishy, never over a squeeze area), hides behind none on a phone (desktop: at most half its width,
  because a desktop party of 4 or 5 is one row with 0.3 m gaps: behind a gap is the only place that covers nobody), its spot lies inside its bounds,
  and with one out the boop from the home slot through the ball has 0.25 m of free roll in its bounds (sliding along an edge).
- **new row "DT-01 Home B5, one squishy out on a phone (TALL n = 1)"**: the same rules with one out on a phone. It **FAILS**, and proves why: it
  searches 3597 spots (a 0.05 grid over x +-0.8, z -3.2..2.2) at every scale and shape and none passes. The one-body portrait view is the body plus
  about 66 px of floor each side, and the ball's bounds (the visible table's near row) hold its centre within +-0.31 m of the middle, so every spot
  is in front of the body or behind it. **This needs RENDER**: PLAYGROUND_BUILD 24.1 (a), Home's rest framing counts the ball's spot with one out on
  a portrait frame as framingFor counts a capsule (then this model gains the same framing and the row can pass). Not in my files.

**Re-laid Home spots** (`src/data/place_home.ts`, reason in its header; found with the probe's own model, scratch `b5/grid_appendix.ts`):
| thing | frame | HEAD | now | why |
|---|---|---|---|---|
| Felt Ball | TALL | (0, 0.9) | **(0.76, 1.06)** | in front of the play squishy at 2..5 out (44.5 px over it); now beside it to the front right, covering none; the window that passes is x 0.72..0.78, z 1.02..1.12 |
| Felt Ball | WIDE | (0.85, -0.75) | **(0.7, -0.65)** | its top behind a body at 2 and 4 out, 55% hidden, pushed 0.04 m by its bounds; now behind the gap between slots 0 and 1: covers none, at most 34% hidden |
| Music Box | TALL | (0.75, 1.55) | **(1.25, 0)** | 0.07 m from the ball's new spot (0.3 needed); beside slot 0 to the right from two out |
| Snooze Rug | WIDE | (0, -0.35) | **(0, -0.36)** (patch too) | its front edge 6..15 px under the bottom band at 2 out with small round bodies (the lens) |
| Bounce Pad | WIDE | (-0.75, -1.25), use (-0.65, -1.45) | **(-0.79, -1.25), use (-0.69, -1.45)** | its top behind a body at 4 out (it does not arrive at Home before S2) |
- With one out on a phone the TALL ball stands where its bounds push it, (0.31, 1.06) x scale: front right of the squishy, covering 17% of it and
  21.8 px into its squeeze area at the worst scale and shape (HEAD's (0, 0.9): 26.5% and 48.0 px). Better, not the ask (see the failing row).
- `node _harness/probe_pg_data.ts`: **DT-01 Home ok** (6 things x 2 frames x n 1..5 x 10 scales x 3 shapes); every other row as before; **the new
  one-out row FAILS** (exit 1, by design). Fails before / passes after: the same probe on HEAD's place_home.ts: DT-01 Home FAIL ("TALL feltball: B5
  in front of a body (n2 slot 0: 44.5 px over it) | WIDE feltball: B5 behind a body (55% of its width hidden) ... pushed 0.04 m").
- FN-01's roll, node (scratch `b5/fn01.ts`: node_checks section 13's rig, the REAL SoftBody, props, LIFE and host, a mock stage reporting the measured
  visible table; a held squeeze, then 16 s): phone one out HEAD 0.249 m, **now 0.404 m** (the ball starts at (0.313, 1.06), the boop sends it along
  the right edge); desktop **0.324 m** from (0.7, -0.65).
- Seen by another lane's row: `_harness/shellview/node_checks.ts` 1727 measures the poked ball as `poses[0] - 0.85` (HEAD's WIDE x): with x 0.7 it
  reads 0.348 m (still > 0.2: passes), but the 0.85 is stale (the shell lane's file; the true roll is 0.498 m).
- **props.ts (round 5, `ballPin`)**: in the browser (tree `b5/tree2`) the re-laid ball came out at x 0.299 with three out: the world is rebuilt at
  a party change while the stage still reports the one-out table, so its first step pushed the ball to that edge and nothing ever gave it its spot
  back (the 1 Hz bounds update only pushes inward). Now a ball that nothing but its bounds has moved (no body's push, no poke, no speed of its own)
  is re-placed at its spot pushed into each NEW bounds (setBallBounds); a ball anyone booped stays where it rolled. Zero allocation (1 Hz, a loop
  over the props). Row (probe_playground ball section, new): "B5 (round 5) Home's Felt Ball, phone: untouched, it is held at the one-out bounds'
  edge, then stands at its spot again when a party widens the bounds; once booped it stays where it rolled": **HEAD's props.ts FAIL** (three out
  (0.313, 1.088) against the spot (0.780, 1.088)), **now ok** (0.780, 1.088); the booped ball (0.128, 1.211) unmoved.
- **Browser, after** (tree `b5/tree3` = HEAD + this lane's files; `measure.mjs`, dev server 5367; shots `b5/shot_new2_phone_*.png`,
  `b5/shot_new_desk_*.png`): phone one out: the ball at (0.313, 1.087), 291.7 / 534 px, at Dollop's lower right (not over its face or middle;
  HEAD's was dead centre); **first-play roll 0.475 m** (an earlier run of tree2 0.316 m; HEAD 0.178 m, the verdict 0.10); phone three out: the ball
  at **(0.835, 1.164) = its spot x 1.098, beside the play squishy (Cushlet) to the front right, covering no body** (`shot_new2_phone_n3.png`;
  HEAD: in front of the play squishy); the Music Box (1.373, 0) right of it. Desktop one out: the ball beside-behind Dollop's right side, about a
  third hidden (`shot_new_desk_n1.png`); **first-play roll 0.365 m**. 0 page errors in each run.
- **What is NOT done**: with ONE squishy out on a phone the ball still covers the squishy's lower right (17% of it at the worst scale and shape in
  the model; the screenshot shows the corner) and cannot be beside it with the camera that ships: the new row fails and says so. The fix belongs to
  RENDER (PLAYGROUND_BUILD 24.1 (a)): with one squishy and the Felt Ball arrived on a portrait frame, framingFor's rest framing (and so
  visibleTable) counts the ball's TALL spot like a standing capsule (`withCap` at (0.76, 1.06) x bodyScale, r 0.22): by framingFor's capsule formula
  the camera would pull back about 1.2x and aim between them (my estimate from the formula, not modelled or measured), so the spot would be in view
  and beside; the row can pass once that framing ships and DT-01's model gains it.

## B8c: the cabin in the camera that ships (round 5)
**The camera, modelled and checked against the verdict's shot** (`b8/cab.ts`): the place camera is pure (`render/placeview.ts` fitPlace on
placeBand of the reported rows 56 / 130 px; the shell's play bounds with their front pushed to every thing's footprint + 0.1 m, later-life.ts
frontReach): tall fov 35, pitch 0.75, aim (0, 1.0, 1.8), distance 9.92. Projected HEAD's tall things: the Rocker Board 575..669 px (the verdict's
shot: its top 575..645 under the hint pill 618..653), the kettle -24..36 px (cut by the left edge, as shot), the Snug Basket 202..414 px and the
Yarn Ball 323..398 px (both cut by the right edge: the shot shows the basket's ring cut too).

**New DT-01 rows "<place> <layout> in the shipped place camera (B8, round 5)"** (`_harness/probe_pg_data.ts`, shipped strict places: today
Hearthlog): placeview's fitPlace and placeBand imported, the shell's setPlayBounds call and frontReach pinned by text (a change fails the row);
every collider's outline at the floor and at its top inside the frame's sides (8 px), its floor above the bottom HUD (PLACE_HUD, measured: phone
the hint pill's top 618 px, desktop the party row 670 - 6 = 664 px). The layout rows (P7 etc.) are unchanged and stay ok.
- HEAD's cabin: **tall 4 problems** (rocker floor to 669 px; yarn ball 326..394; basket 202..402; kettle -24..36), **wide 1** (rocker floor to 686).

**Re-laid** (`src/data/place_hearthlog.ts`, reason in its header; found with the probe's own checks, scratch `b5/grid_cabin.ts`): TALL kettle
(-1.98, -3.44) -> **(-0.1, -3.5)** (between the swing and the hearth, at the back wall), Snug Basket (1.05, -1.85) yaw 1.571 -> **(0.8, -1.85) yaw
2.356** (use spot with it; the gap now opens to the front left), Yarn Ball (1.25, 2.15) -> **(1.1, 2.1)**; WIDE Rocker Board (1.55, 2.05) ->
**(1.6, 1.8)**. Both layout rows still 0 problems; **wide camera row 0 problems; tall camera row 1 problem: the Rocker Board** (669 px against 618).
- **Why the tall Rocker Board is not moved (NOT done)**: the camera fits the bounds' front edge (z 3.0) to the reported bottom row (130 px), so the
  hint line (618 px) lies near z 2.0; everything in front of it is under the hint pill. With the board at z <= about 2.0 the layout's own rules fail
  (searched with the probe: the arrival pad r 1.2 at the centre, the basket and swing behind, five spawn spots >= 0.9 m from every thing and 1.0 m
  apart inside |x| <= 0.425): only TWO spawn spots fit (`b5/spawn_appendix.ts`: best set [[0.425, -0.475], [-0.425, 0.075]]). Two fixes, neither
  in my files: (a) the shell reports the hint pill / party row as part of the bottom rows while in a place (the camera then fits the front edge
  above them; one line in hudBinding's reportInsets), or (b) the design panel relaxes the tall cabin's spawn count or pad. The row stays failing.
- Side effects checked: node_checks' frontReach row (tall 3.3 m, wide <= 2.4 m) holds (tall unchanged; wide front 2.1 m).

## LF-02: one more honest attempt (round 5)
Scratch `fix5_data/lf02/` (`win.ts`: the probe's replay design standalone; `hp2.ts`: heap sampling; `trace*.txt`).
- **The probe's own windows** (`node _harness/probe_life.ts`, unchanged): 88 760, 157 968, 118 368, 74 112, 126 480, 122 992 B per 1000 ticks
  (a run with V8's `--trace-opt --trace-deopt`: **no deoptimization and one tier-up (inKeepOut) during the 6 measured windows**; 137 of the 217
  functions in src/life never reached TurboFan before them, among them the ones the windows run: setBeh, endBeh, the emit* helpers, travelTo,
  voice / say, startNap, startBask, runBask, freeTarget, leanTo, besides, startUse, pieceUse, settleNap).
- **Standalone, the same replay** (no other rows warming the JIT first): 3 passes 1.4 to 10 MB per window (cold code), 30 passes 16 to 33 KB,
  **30 passes with tier-up at 50 calls (`--invocation-count-for-turbofan=50`): 16, 4 256, 16, 3 200, 5 296, 1 040 B**, again with no tiering
  or deopt in the windows.
- **What the eager-tier residual is** (`hp2.ts`: the inspector connected before the warm-up, 16 B sampling over the 6 windows): every LIFE site is a
  rare behaviour start or step that runs a few times per 1000 ticks and is still interpreted: behave < choose < **startBask** 5.3 KB (with its
  Math.sin / Math.cos results), behave < updateMoment < **leanTo** 2.6 KB (Math.sqrt), choose < **startNap** 2.5 KB, pieceUse / startUse /
  besides / settleNap 0.3 to 0.6 KB each. In V8's interpreter and baseline tier every double a function computes or loads is a HeapNumber, so any
  float math in a branch taken a few times a minute allocates until it is optimized; node 22 has TurboFan only (about 3000 calls to tier up),
  Chromium's Maglev tiers sooner. No array, object, string or closure from LIFE was sampled. The FM fix (Smi-only integer math) does not carry
  over: LIFE's behaviour starts are geometry (angles, distances, targets) and stay float.
- **Browser** (this round, `node _harness/probe_life_browser.mjs --port 5369 --passes 3,30` on `b5/tree3`, Chromium 153 headless): **3 passes
  24 872, 73 564, 29 312, 15 220, 21 348, 30 100 B; 30 passes 964, 20 272, 740, 6 444, 3 816, 16 364 B per 1000 ticks** (an empty call's own
  growth about 10.7 KB subtracted); lifeStep 7.2 us a tick. (PG_LIFE round 4: 16 to 88 KB and 0.7 to 22 KB: the same.)
- **Re-specification proposal for the orchestrator (the bar is NOT changed here):** LF-02 as two rows: (1) "lifeStep allocates no object of its
  own": a heap-sampling row over the measured windows finds no LIFE allocation that is not a HeapNumber (no array, object, closure or string; today
  0); (2) "and no number boxing once optimized": the isolated child (`probe_life.ts --lf02`) after 30 replay passes with the tier-up threshold at
  50 calls, at most 8 KB per 1000 ticks (today 16 B to 5.3 KB; at 60 fps that is at most 5 KB/s of short-lived HeapNumbers). Or accept today's
  residual as V8's, with the browser number above as the shipped figure.

## Regression probes at the end (2026-11-17 ~23:30 UTC)
Run one at a time on `b5/tree4` = git archive HEAD 16f6ba6fc + only this lane's working files (`b5/probes.sh`, logs `b5/probes_mine/`), then the
two that changed re-run on the working tree:
| check | HEAD (brief / measured) | now |
|---|---|---|
| tsc | clean | **clean** (working tree and snapshot) |
| probe_pg_data | FAIL (DT-01 Home) | **32 ok, 2 FAIL, both new honest rows**: "DT-01 Home B5, one squishy out on a phone" (no spot can, needs RENDER) and "DT-01 Hearthlog Cabin tall in the shipped place camera" (the tall Rocker Board under the hint pill); DT-01 Home ok again; DT-11 ok |
| probe_playground (quick) | 55/55 | **56/56** (+1: B5 ball row, fails on HEAD's props.ts) |
| probe_pg_lifequests | 14/14 | **14/14** |
| probe_life | 117 ok / 1 FAIL (LF-02) | **117 ok / 1 FAIL (LF-02)** |
| probe_chatter / probe_journal / probe_quests | 42/42, all, all run (3 NOT RUN) | **42/42, 28 ok all, 45 ok (3 NOT RUN)** |
| probe_app / merge / trophies / gestures | 187 / 22 / 31 / 160 | **187 / 22 / 31 / 160** |
| renderview/pg_node_checks | 40 | **40 ok** |
| shellview/node_checks | HEAD measured 167/168 (the "Go play with... a ride" row fails at HEAD) | HEAD + my files **166/168**; HEAD + my files + the shell lane's current later-life.ts and node_checks.ts **170/170** |
- **probe_life LF-13 (two rows) broke with the cabin re-lay, now fixed in the fixture** (`_harness/probe_life.ts`, reason written there): the take
  scenario left the chaser's spot to 70 s of history, and any change of the cabin's layout reshuffled it (with the wide Rocker Board 0.25 m away,
  Dollop stood at (0.87, -0.23), walked off and never saw the take); the chaser now stands where HEAD's history left it (-1.47, 0.65), as the
  taker's spot was already set. Same checks; ok with HEAD's cabin and with the new one.
- **node_checks "B7; SH-22" (the shell lane's awake-budget row) is history-sensitive**: at HEAD it passes with 1 of 24 samples over; with ANY of
  my Home or cabin data changes alone it reads 4 of 24 and a 3 s run (HEAD's cabin + my Home: same; HEAD's Felt Ball spot or rug spot with the
  rest of mine: same; all HEAD data with my props.ts: 1 of 24). It is the shell's over-budget rule meeting a different LIFE history, not a data
  rule; with the shell lane's current later-life.ts it passes with my data (1 of 24) and node_checks is 170/170. For the orchestrator: commit the
  two lanes together, or the B7 row fails on my files alone.

## NOT done / known issues (honest list)
- **B5, one squishy out on a phone**: not possible with Home spots under the camera that ships (proved by the new failing row); the ball stands at
  the squishy's lower right (17% of it at the worst scale and shape in the model). Needs RENDER (PLAYGROUND_BUILD 24.1 (a)).
- **B8c, the cabin's TALL Rocker Board**: still under the phone's hint pill (669 px against 618); moving it breaks the layout's five spawn spots
  (only two fit). Needs the shell to report the hint pill / party row in a place's bottom rows, or a design decision on the tall cabin.
- **LF-02**: still FAILS its 0 B bar (V8 tiering; proposal above); the bar is unchanged.
- The desktop's WIDE Felt Ball is up to 34% hidden behind a body with 2 to 5 out (behind the gap between slots 0 and 1; a ball beside a body is
  impossible in a desktop party's single row); the rule allows half.
- DT-01's Home model uses round-ish rest shapes (three of them) and the in-view HUD bands; real species and a party's quick-switch row on a phone
  (660 px, left part) are approximated, not modelled per species.
- `_harness/shellview/node_checks.ts` 1727's `poses[0] - 0.85` is stale (HEAD's WIDE ball x; the shell lane's file): it still passes (0.348 m).
- Nothing of mine is running (no vite on 5367 / 5369, no browser, no probe).
