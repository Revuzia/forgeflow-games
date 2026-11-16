# PG_LIFE lane brief: a small, pure, deterministic brain for every squishy and piece

Read first, in this order: `_handoff/STATUS.md`, `_handoff/briefs/COMMON.md`, `_handoff/briefs/SESSION3.md` (it wins where they differ), then this
brief. Paths are relative to `games/wobblehoard`.

**Revision 3 (2026-11-15, after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84 and 23).** What changed for you: the motion gate's caps
come from a formula over measured costs (D-61), and every joint moment moves one character at a time; you travel with SCOOT = `scootTo`, never
`moveTo` (D-63); you decide on sim time only, music included (D-66); FIRST_WISH has a wisher even with no Dollop (D-70); every REACT kind has a
typed trigger and a thing (D-72) and PIECES carry the group's count (D-73); a RIDE state (B20, D-74); S07 and S13 are behaviours (D-75); ring
piles count with one napper inside (D-76); thing wishes respect a thing-kind mask; one wish bubble on screen and one piece group everywhere;
"the player is touching" never means a lock alone, and B08 is budgeted (D-84); autonomy off still moves a player-asked squishy (D-79); your
code ships in the **life chunk**, after the first frame of play (D-69).

## You own
- `src/life/**` (new). Suggested modules: `traits.ts`, `world.ts` (the struct of arrays), `brain.ts` (behaviours), `social.ts` (joint moments),
  `looks.ts`, `react.ts` (the REACT triggers), `wish.ts` (the wish scheduler), `voice.ts` (phrase planning), `attention.ts` (caps, priority, the
  motion gate), `step.ts` (the API)
- `_harness/probe_life.ts`, `_harness/probe_life_imports.ts` (new)
- Running report: **`_handoff/reports/PG_LIFE.md`**. Port 5369, only if you ever need a browser look (you should not). Scratch:
  `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_life/`

## You must not touch
`src/data/**` (PG_DATA writes the tables you read, `REACT_TRIGGERS` and `THING_KINDS` among them: ask there), `src/shell/**` (the LIFE host is
PG_SHELL's), `src/physics`, `src/render`, `src/audio`, `src/collection`, `src/core`, `_harness/mocks.ts`. Contract changes: additive and
optional in the PLAYGROUND block only, reported; LIFE's own functions are values in `src/life`, not contract members. No git write command.

## When you may start
Now (step 0), in node, against scripted snapshots: nothing of yours needs the shell. PG_DATA lands `src/data/life.ts`'s id tables first; until
they are in, code against the field names of PLAYGROUND_BUILD 6 and LIFE.md with a fixture inside your probe, and never create `src/data/life.ts`.
**The motion gate's caps wait for PF-00** (the phone factor and the unit weights, T13, step 0): until it reports, use F = 4 and the weights of
PLAYGROUND_BUILD 14.2, and compute the caps from the formula, never type them.

## Read (completely)
**`_spec/LIFE.md` (all of it: your spec)**, including both revisions (revision 3: L2, L4, 3 and 3.1 looks, B03, B05, B06, B08, B09, B15 to B17
and the new B20, 4.1 scripts, **4.2 `REACT_TRIGGERS`**, 5.1, 5.3, 5.5 to 5.7, 6.1 with its Who column, 7, 8.3, 8.4, 9, 10.1 to 10.4, 12);
`_spec/PLACES.md` 1 (P3 nothing climbs, P11 the channels), 2 (mechanisms, zones, family numbers, the float table), 3 (default reactions and the
channel rule), 4.1 and 4.2 (Home and the cabin, your S0 and S1 things); `_spec/QUESTS.md` 4 (the events you produce), 5 (by SELF and autonomy
off), 8 (wishes and their caps), 9 (facts), 12 (the dark-pattern audit), 13 (the first ten minutes); `_spec/PLAYGROUND_BUILD.md` 2 (D-07, D-10,
D-13, D-17, D-18, D-19 to D-27, D-39, D-56, D-57, D-59, **D-61, D-63, D-66, D-70, D-72 to D-76, D-79, D-84**), 4 (one frame), 11.2 (what the host
does with your output), 14.2 (your 0.4 ms and the awake-budget formula), 14.3 (the life chunk), 18 (the LIFE rows); the LIFE seam types in
`src/contracts.ts` (`LifeSnapshot`, `LifeIntents`, `LifeEvents`; revision 3 adds `zoneThing`, `patchThing`, `thingId`, the RIDE flag, `bumps` from
`other`, `LifeIntents.e`); `src/data/materials.ts` `feelOf` (439) and `src/core/genome.ts` `pitchRatio` (140-144), `speciesBaseGenome`;
`src/core/rng.ts` (`mulberry32`, `hashString`).

## Purity (LF-12, checked by `probe_life_imports.ts`)
Imports only `./`, `../core/`, `../data/` and `../contracts.ts` (types). No DOM, no three, no physics, render, audio or shell import. No `Date.now`,
`performance.now`, `Math.random`, `setTimeout`, `requestAnimationFrame`: sim time comes in the snapshot (`t`). **No music clock either**: bar
lines come from `t` on the 66 BPM grid (`beatPhase` = (t x 66 / 60) mod 1, a bar 3.636 s) and the field from the place's music style (LF-26).
One rng stream per character (LIFE 11), each kept in a `Uint32Array`. Zero allocation per tick after `createLifeWorld` (struct of arrays,
capacity 16).

## Build: S0 "Life at Home" (the exit check is FN-01)
1. Traits (LIFE 2) as a pure function of the genome; your probe prints the spreads over the 50 templates against LIFE 2's table.
2. Needs (LIFE 3), reset each time a squishy comes out (a ceremony is not coming out: needs and looks are kept through it); the mood for the face;
   **looks** (3.1) with `LOOK_RATES`; a look falls at its "elsewhere" rate only while its rising cause is absent (LF-20).
3. **REACT events by `REACT_TRIGGERS`** (LIFE 4.2): each kind's condition, once per visit or per event, and its `thing` (the zone's or patch's
   owner from `zoneThing` / `patchThing`, or the source thing of the `lifeAddLook` that caused it, which always emits). They fire whatever behaviour
   wins; B15 is only the pose and the bubble (LF-21).
4. Behaviours B01 to B20 (LIFE 4) as utility choice with the seeded noise and the current-behaviour bonus; cooldowns; "Moves?" behaviours ask the
   motion gate. Home's uses only in S0: the Felt Ball, the Music Box tune (sing and sway), the Snooze Rug nap, the Warm Lamp bask. Home's LIFE
   bounds are the visible table shrunk by R + 0.2 m, which the host passes as the place bounds (5.7).
5. **The six scripts** (LIFE 4.1, `lifeScript`): FIRST_PLAY makes FN-01 hold by design (play to at least 0.6, the ball as the next B04);
   **FIRST_WISH with its wisher** (the slot the shell sends: Dollop if out, else a Hearthlog fan out, else the party member out longest), which
   ignores the 120 s and 180 s gaps, **with no natural wish before it**, and the 5:00 rest-in-the-Journal case; PLAY_WITH; POSE; CHEER; SQUIRTED.
   Each at most once where the table says so (LF-19, with no Dollop owned, Dollop on the shelf, and a touch wish due before 2:30).
6. The primitives as intents (5.1): **SCOOT (`scootTo`, the travel driver; the contact approach's last centimetres at 0.04 m/s so a sleeping
   partner stays asleep)** with the gait overlay, HOP (anticipation squash 0.12 s first; S1 cap vy 0.84; at most one per 0.8 s), GLIDE, SQUASH
   poses (an identical pose is never re-sent as a change), POSE (render lean and sway; the phase from sim time in `LifeIntents.e`), gaits from
   `GAITS` (5.2); memory families get no squash, pose or hop while `MEMORY_BUSY` (5.4); HELD (a finger, a grab or a carry on it, or a lock on it:
   HELD for its own brain only) and the 1.5 s afterglow plus 1.5 s grace (5.5); quiet (5.6, with **autonomy off: no motion except a player-asked
   use and a ride the player set up**, LF-24); never a target outside the bounds shrunk by R + 0.2 m or inside a keep-out (5.7, LF-06).
7. Social S01 to S09, S12, S13 and S15 (LIFE 6.1): joint moments reserve their tokens and units together or do not start; no character in two at
   once; **every joint moment moves one character at a time** (the partner waits still and may sleep: LF-10). **S07 gathers 3 or more idle
   squishies into a row** (one mover at a time) and **S13 uses the two peek spots** of its thing (`ThingDef.peek`) (D-75). B09's hello is an S01
   greet with the nearest party member (H5). Points are the reducer's job: you emit SOCIAL events with `a`, `b`, `n2`. `bumps` come from
   `SoftEvent.other`.
8. Squishmoji as EMOTE intents with icon, style, priority (LIFE 10.2), group key and count dots (7.2); B08's afterglow emote and voice as P1
   requests through the budget; wishes as think bubbles under QUESTS 8's caps (`wish.ts`, inputs from `lifeSetJournal` only, never a clock:
   **one wish bubble on screen** (the wish slot of 10.1; any other open wish as its still dot), **a thing wish only for a kind in the
   `thingKinds` mask** and a favourite only once its place is open (LF-25), a friend wish only for Friends or closer, or the best friend once F3
   is found); **voice planning** (8: the species motif from `MOTIF_SALT`, call and answer with the mirrored contour, chat (with sound off, one
   "hello" bubble on its first speaker), joy, sleepy, wish, granted, sing on the style's field rest tones on the eighth grid of sim time, huff,
   comfort, peep, answering a thing; the pair duet from `DUET_SALT`), handed to the host through `lifePhrase` (D-59), and `lifeMotif` for the
   Journal's song.
9. Pieces P01 to P04 under the one brain of their squishy (9); one bubble and one group voice per group; piece events within 0.5 s merge (LF-08);
   **PIECES carry n = the group's count at each new high this visit** (pieces inside the zone, or that used the thing within 4 s), and a cut inside
   a zone emits that zone's REACT as PIECES at once (LF-22); the cut group leaves the non-Hand-tool quiet 1 s after the swipe (the quiet lift);
   **one piece group on screen everywhere** (10.1); the cut and whole-again rules (cutting is play: one shared wow, no comfort, no "whole again"
   wish).
10. `attention.ts` (10.1 caps for phone, phone Calm, desktop, desktop Calm, with the wish slot; 10.2 priority, drop not queue, the touch duck
    while the player is touching: a finger, a grab or a carry, **never a lock alone**), **`motionGate` (10.3)**: unitCap = (B / F - 0.20) / 0.87,
    at least 1.0, moverCap = max(1, floor(unitCap)); at F = 4: 1.0 / 1.49 / 2.64 units and 1 / 1 / 2 movers for low / med / high; unit weights
    a whole 1.0, a piece 0.22, a touching pair 0.25 (from `contacts`), a sleeper 0.03 (PF-00 replaces them); a start that wakes a body must keep
    units at or under unitCap, one that wakes nobody needs only a mover token (LF-10); the character caps as data for the shell (10.4).
11. The step API exactly as LIFE 12 writes it: `createLifeWorld`, `lifeSetPlace`, `lifeAdd`, `lifeRemove`, `lifeStep`, `lifeScript`,
    **`lifeSetJournal(w, owned, openPlaces, favKnown, thingKinds)`**, `lifeSetPair`, `lifeLooks`, **`lifeAddLook(w, slot, look, amount, thing)`**,
    `lifeWishOf`, `lifePhrase`, `lifeMotif`, `createAttention`, `attentionFilter`, `motionGate`. Think on 0.1 s sim-time boundaries staggered by
    slot (LF-16).

## Build: S1 "Hearthlog Cabin"
The cabin's uses (PLACES 4.2 and LIFE 5.3): bask by the fireplace with each family's warm pose (setSquash targets of PLACES 2.4, memory families
only when converged); **marshmallows toast golden, then hop back from the heat** once toast passes 0.6 (B05; the signature verb); the firm and pop
dome families bask with slow, deep breaths (a render pose); the kettle answer when it whistles (B18, Use LISTEN); the yarn ball chase and pass
(S12); the basket nap (S08: one curls up inside and friends nap against it; a pile counts when any napper's centre is inside; B06 first walks to
a waypoint 0.6 m outside the gap's mouth; one zzz, the pile sleeps as one island); the ride wish (a star beside the rocker and the swing, LIFE
5.3); **RIDE (B20)**: a squishy the player set on a ride stays 20 s, to the end of its moment or until a touch, and a lone rider shows the star
bubble "Ride with me!" at P1 (LF-23); teeter (S10: small hops in turn once the player set two on the rocker); push the swing (S11; "a friend" is
any other squishy within 2.5 m); sing together with the fire puff (S06); comfort (S09, B17); snuggle (S07); copy and parade (S05); peekaboo (S13);
duet (S17) and twirl (S18) for Friends and Close friends. Wishes of every kind the mask allows. The cabin's Window Chill (cold 0.3) gives SHIVER
and FROST for the cold families (a look falls only while its cause is absent, so 0.3 still frosts).

## Build: S2 and S3
S2: water (float or wade from `submerged`; **the 30 s water exit and no nap in water, LF-18**), splash jumps, soak and the squirt game's reactions
(SQUIRTED), ice glides (GLIDE on a slick patch), the snow cap, the pine's snow puff (+0.5) and the snowball (+0.3), both through `lifeAddLook`
from the host with their source thing, the raised hops per family once PH-01 passes (vyS2 in `GAITS`; you switch by a slice flag, never per
frame). S3: echo talk (S16), hold on in a gust (B19), the bead squeezes' scoot toward the magnet, turntable rides, the updraft's LIFT reactions,
the Tick Clock sway, the lanterns. Weather strikes are sounds only: never a USE.

## Acceptance ids you must make pass
**LF-01 to LF-26** (node, `probe_life.ts` and `probe_life_imports.ts`); your part of FN-01 (a scripted node scenario: after a 6 s pause and
FIRST_PLAY, Dollop's ball use starts within 10 s and the ball would be booped; the newcomer's hello within 5 s; the first labelled bubble within
10 s of the first 6 s release); CS-04 (LF-13: the huff's trigger table is squishy-to-squishy only, at most 3 s, never in a session's first 60 s);
CS-14 (LF-01 with SH-01). `run_probes.ts` runs your probes automatically: keep the default run to a few seconds, heavy scenarios behind a flag.

## Budgets
At most 0.1 ms median per tick at 16 characters on this container (LF-03); 0 B allocated over 6000 ticks (LF-02); LIFE, attention and the quest
host together at most 0.4 ms of the 16.7 ms frame (PLAYGROUND_BUILD 14.2); the caps of LIFE 10.1 in every rolling second (LF-07). **Size:** all of
`src/life` ships in the life chunk (at most 110 KB with the reducer, the journal, the hosts, `props.ts` and the data; LIFE about 45 KB by 14.3's
estimate); after every step report the minified bytes of each new or grown module (14.3's one-file rolldown build). **The unit caps follow
PF-00**: when it reports F and the weights, you recompute the caps by the formula in `attention.ts` and quote the measurement in your report;
PF-01 to PF-03 (SHELL, 4x CPU throttle) then confirm them.

## Never
An intent that presses, grabs or locks (LF-05: autonomy never pays); a huff from the player's act, absence or time; a "sad", "lonely", "grumpy",
"hurt", "misses you", "come back" or "hurry" anywhere; a camera intent; a haptic; a heart icon (snug is affection, LIFE 7.1); a reading of the
AudioContext clock (D-66); `moveTo`.
