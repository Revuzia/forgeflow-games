# CONFIRM: an independent check of the revision-3 fixes to the PLAYGROUND design (2026-11-15)

I wrote neither the design nor the fixes. For each of the 41 findings handed to me I read the current specs (`_spec/PLACES.md`, `LIFE.md`,
`QUESTS.md`, `PLAYGROUND_BUILD.md`), the eight `_handoff/briefs/PG_*.md` and the PLAYGROUND block of `src/contracts.ts` (lines 481-927). I asked
three things. Is the fault fixed at its root? Is the fix the same in every file? If part of the fix was turned down, is the written reason sound?
When in doubt I marked the finding **unresolved**. Paths are relative to `games/wobblehoard`. "PB" = `_spec/PLAYGROUND_BUILD.md`.

**Typecheck:** `npx tsc --noEmit -p tsconfig.json` exits 0 (about 1.5 s) on the current tree.

**Code I re-read to test the cited claims:** `src/shell/feedback.ts` 146-151 (a bump plays `audio.bump`, then `haptics.pop()` when I > 0.05);
`src/physics/softbody.ts` 1403-1410 (the bump memory slot is `bodyId & (MAX_OTHERS - 1)`, the event names no partner) and 1600-1620 (`matCorral`);
`src/collection/store.ts` 100-110 (a blend row keeps only its own direct parents), 548-558 (`write()` reads back and sets `'failing'`), 590-592
(`report()`, `flush()`); `src/collection/types.ts` 325 (`'ok' | 'failing' | 'off'`); `src/collection/index.ts` 121 (`changed()` only calls
`markDirty()`); `src/collection/ghost.ts` 221 (only a hearted item refuses a merge); `index.html` 13 (CSP `img-src 'self' data:`). Every one of these
matches what the specs now say.

**What I did not check:** nothing ran on a body, in a browser, in a build or as an audio render. I did not re-project the camera; where I use the
spec's own projection numbers (PB 9, PLACES 4.1) I say so. I did not lay out or check the S2 and S3 tall layouts, and I did not read every S2 and S3
reaction cell. I did not run the name gate, QU-09, QU-14 or any probe. My size figures in CT-M1 are estimates, not measurements. I took the findings
from the task text and did not re-read the three REVIEW files in full.

---

## 1. Verdicts at a glance

| Finding | Verdict |
|---|---|
| CT-B1 `auto` on body bumps | **Unresolved (one path left)**: a lock still counts as HELD for `auto` |
| CT-B2 physics budget | **Unresolved**: the new gate freezes LIFE on low and blocks S11 and S03 on low and med |
| CT-M1 first-load size | **Unresolved (partly)**: the first load is safe by structure, but the life chunk and total have thin, low estimates, and five shell UI modules have no chunk |
| CT-M2 gift grant | Resolved (the turned-down part has a sound reason) |
| CT-M3 `scootTo` | **Unresolved (one stale line)**: LIFE.md 236 still sends a floater by `moveTo` |
| CT-M4 prop to thing map | Resolved |
| CT-M5 body identity | Resolved |
| CT-M6 music clock | Resolved (the turned-down part has a sound reason) |
| CT-M7 Float rule | Resolved |
| CT-M8 Home spawn and bounds | **Unresolved**: by the spec's own numbers, Home's bounds can leave out the body's own slot |
| CT-M9 seesaw floor | **Unresolved (data)**: the Rocker Board passes; the Leaf Teeter fails the new rule |
| CT-M10 Snap preview | Resolved |
| GT-B1 Dollop and the first wish | Resolved (the turned-down part has a sound reason) |
| GT-B2 Home out of view | **Unresolved**: the rule is in, but 5 of Home's 6 spots have no numbers (the designer's own candidates failed) |
| GT-M1 57 px squishies | Resolved by part adoption with a sound reason (see the new problems the tall cabin brought) |
| GT-M2 PIECES count | Resolved |
| GT-M3 REACT triggers | Resolved |
| GT-M4 favourite things | Resolved (a small cross-reference slip, new problem N6) |
| GT-M5 dead wishes | Resolved |
| GT-M6 RIDE | Resolved in LIFE (C3's push is blocked by the gate, see CT-B2) |
| GT-M7 snuggle and peekaboo | Resolved (S2 and S3 positions deferred with a reason) |
| GT-M8 rings | Resolved |
| GT-M9 keyboard switches and bubbles | Resolved (I4's pine, see RC-B1) |
| GT-M10 Friends Everywhere in S1 | Resolved (the turned-down part has a sound reason) |
| GT-M11 quest-moment haptic | Resolved |
| GT-M12 autonomy off | Resolved |
| GT-M13 cells with no channel | Resolved for S1 (S2 and S3 cells not read one by one) |
| GT-M14 kettle loop | Resolved (the turned-down part has a sound reason) |
| GT-M15 Fizzwell pad | Resolved (its DT-01 run is deferred to S3 with a reason) |
| GT-M16 RING part | Resolved |
| RC-B1 keyboard K quests | **Unresolved (one quest)**: I4's Shake Pine has no keyboard route but is still tagged K |
| RC-B2 Dollop | Resolved |
| RC-M1 Tab trap | Resolved |
| RC-M2 quest-moment haptic | Resolved |
| RC-M3 lock versus touching | Resolved (T11 is queued for LOCK.md, as the fix asked) |
| RC-M4 "kind" | Resolved (the turned-down part has a sound reason) |
| RC-M5 titles versus rules | **Unresolved (small)**: DT-09 still has no VISIT exemption |
| RC-M6 REACT thing | Resolved |
| RC-M7 landscape | Resolved |
| RC-M8 tracker pill | Resolved |
| RC-M9 Q3 | Resolved |

That is 9 unresolved and 32 resolved. Section 4 also lists 8 new problems that the fixes brought in.

---

## 2. The unresolved findings, in detail

### CT-B2 (blocker): the motion gate's own arithmetic now freezes LIFE on low and blocks two moments on med
The method is right and the same everywhere: one bar in container ms (D-60, PB 138), unitCap = (B / F - 0.20) / 0.87 with a floor of 1.0 (D-61,
PB 139; PB 765-771; LIFE 10.3 539-549; PG_LIFE 91-94), turn-by-turn moments, and the over-budget sleep rule (PB 546-548, SH-22). PF-05 is now
PF-01's node twin (PB 776-777, 1055). But the gate as written does not let the quests through:
- **Low, 2 or more squishies out.** units = 1.0 per awake whole + 0.03 per sleeper (LIFE 551). A start that wakes a sleeping whole needs units +
  0.97 <= unitCap (LIFE 553-554), and low's unitCap is exactly 1.0 at F = 4 (LIFE 547). With n wholes all asleep, waking one gives 1.0 + 0.03 (n -
  1): 1.03 for n = 2 and 1.06 for n = 3, both over 1.0. A released body that is still awake is over the cap too (1.06), so the shell sleeps it (PB
  546-548). So on low, with two or three squishies out, LIFE can never move anyone again. PB's own PF-02 state "one awake and two asleep" is 1.06
  units (PB 775), which the gate forbids.
- **Low and med: S11 push the swing (QUESTS C3, an S1 main quest; also L9 and U4).** The rider sits on a hinge prop. A body on a moving prop never
  sleeps (the rest test needs a STATIC prop face: PB 421, contracts 581-583), so it costs 1.0 the whole time. The pusher must wake: 1.0 + 0.97 +
  sleepers is about 2.0 or more, against med's 1.49 and low's 1.0. C3 cannot start on low or med. Q4 (QUESTS 43) and QU-03 (PB 983) say every clause
  is reachable at low caps, and LIFE 10.3 (555-556) says "every moment and every quest works at moverCap 1". At F = 4 both claims are false.
- **Low and med: S03 boop.** "The units for both bodies fit (the target wakes)" (LIFE 301): booper 1.0 + target 1.0 + a touching pair 0.25 +
  sleepers is about 2.3, against 1.49 and 1.0. Boops happen only on high. No quest clause needs a boop, but LIFE's own claim fails.
- **Player-set rides are unbudgeted.** PB 777 says "setting two riders on a seesaw" is never refused. C5 then holds 2.0 or more units on low and
  med for the length of the ride (about 7.8 ms against low's 4.0 ms phone bar). No PF row measures it. This is honest, but it is not a bound.

**Fix:** let a whole that is asleep cost 0 in the start test, or make the floor "one awake whole plus every sleeper" (unitCap >= 1.0 + 0.03 x
(the wholes cap - 1)). Count a rider on a moving prop as 1.0 that a ride moment already holds, and let S11's pusher wake against unitCap + 1.0 for
the length of the moment, or drop C3, L9 and U4 from Q4's low-tier promise and say so. Add an LF-10 row: low with 3 wholes asleep, one start must
be granted. Add a PF row for two riders on the rocker on low and med.

### CT-M1 (major): the first load is safe by structure, but the life chunk, its data and the total have little room
**What is fixed.** D-69 (PB 147) moves LIFE, the reducer, the journal, the hosts, `props.ts` and the data into a life chunk that loads after the first
frame (PB 649-654, 730). The first-load lane caps add up to 60 KB (physics 18, render 16, audio 8, shell 12, collection 2, data 4: PB 791), and every
lane must report minified bytes after each step (PB 799-802; in every PG brief). PLACES 6 (742-760) no longer says 1.5 KB.

**What is still wrong:**
- **The life chunk is budgeted at 107 of 110 KB** (PB 793), and its data share of "about 16 KB" looks low. The review measured about 1.1 KB per 10
  quest rules, so the 110 rules alone are about 12 KB. `DEFAULT_REACTIONS` holds PLACES 3's 16 columns x 12 families = 192 cells (PB 310). Add
  `SPECIES_LIFE` (50 rows), `FAMILY_REACT`, `GAITS`, `BEHAVIOURS`, `REACT_TRIGGERS`, `HOME_TEXT`, the id tables and `place_home.ts` (3 to 6 KB by PB
  796's own per-place figure). My estimate is 22 to 30 KB, not 16. It is not a measurement.
- **The whole build is 1980 of 2000 KB** (PB 797), at D9's ceiling. No rule says what moves or is cut when the life chunk or the total goes over.
  PB 801 covers only a lane that is over its first-load cap.
- **Five shell UI modules belong to no named chunk:** `wishes.ts`, the moments queue, the party toolbar, the name-tag popover and the Snap
  shutter with its preview (PG_SHELL 27-28; PB 11.10). The shell's 12 KB first-load list (PG_SHELL 130-131; PB 791) does not name them. The life
  chunk's estimate (PB 793) does not hold them either. The T1 gate also "fails on any lazy chunk it cannot name" (PB 736, 844).

**Fix:** re-estimate the life chunk's data from the review's measured bytes. Assign each of those five UI modules to a named chunk with a byte
estimate. Write the overflow rule for the life chunk and the total (for example: what moves to the screens chunk, or which place ships
`shipped: false`).

### CT-M8 (major): Home's bounds can leave out the body's own slot
`spawn: 'matLayout'` (PLACES 246; PB 286) and DT-01's Home row on the real slot output (PB 864) are adopted. But the reviewer's bounds rule ("a
rounded rectangle that holds every slot plus R + 0.2") was replaced by "the visible table shrunk by R + 0.2 m, passed to `setBounds`" (PB 644-645;
PLACES 247-249; PG_SHELL 119). By the spec's own projection (PB 499-501), one body on 1280 x 800 shows table only up to z = 0.3 x scale, because
the bottom HUD covers the rest. Shrunk by 0.5 x scale + 0.2, the front bound is at about -0.4 m, behind the body's slot at z = 0. The corral
(softbody.ts 1600-1620, which PB 8.2 extends to place bounds) then glides the only squishy backward with no intent, which is the same fault the
finding named. On 390 x 844 the half-width is 0.5 to 0.76 x scale (PB 501; PLACES 250), so the shrunk half-width is 0 to about 0.06 m. Nothing
checks that every slot lies inside the bounds or that the bounds are not empty: RD-16 (PB 957) and SH-21 (PB 1040) check only things and LIFE
targets. The pages also disagree. LIFE 5.7 (281-283) says the bounds ARE the visible table and LIFE shrinks it for targets, while PB 11.13 shrinks
it before `setBounds`. That is a double shrink if both are built.

**Fix:** pass `setBounds` the union of the visible table and every slot in use (each slot's body plus 0.05 m), and shrink only for LIFE targets.
Say it once, in LIFE 5.7, PB 11.13 and PLACES 4.1. Add an SH-21 / RD-16 row: for n = 1 to 5, both frames and scales 0.8 to 1.25, every slot
centre lies inside the `setBounds` rectangle and the target area is not empty.

### GT-B2 (blocker): Home's things now have a rule but, for 5 of 6, no place to stand
LIFE stays in view (LIFE 5.7; B03 at LIFE 119), the camera never follows autonomy (PB 494-497; RD-14), and a thing arrives only once its footprint
is inside `visibleTable` (PB 641-647; contracts 663-667; SH-21; RD-16). But only the Felt Ball has spots (PLACES 260-262). The designer writes that
"my candidate spots for them, at the frame's side edges, failed either the slot gap or the one-body view, so I give the rules and not numbers"
(PLACES 263-265; PB 1157-1158). Nothing yet shows a spot exists that passes both DT-01's Home row (PB 864) and the in-view rule for the Music Box, the
Snooze Rug, the Warm Lamp and the Keepsake Shelf. There is no fallback if none does. S0's exit says "they sing to the Music Box and nap on the rug,
all in view" (PB 821). H10 and the Music Box song depend on those spots, and QUESTS 476 already concedes "the Music Box may wait for a wider view".
On top of that, CT-M8's bounds problem applies here.

**Fix:** before PG_DATA starts, lay one passing spot per thing for each party size at which it is due (or state the smallest party at which each
thing can arrive), and add a DT-01 Home row that a passing spot exists. If none fits at small parties, say which quest waits and show it in the
hint.

### CT-B1 (blocker): one path to an autonomous haptic remains
**What is fixed.** `auto` is now on body bumps too (contracts 500-507; PB 140 D-62, 446-448, 577-579; PG_SHELL 53-55, 189; PG_PHYS 69-70). Every
`auto` event goes to the attention wiring, never to `feedback.handle` (PB 213-214). A real-SoftBody boop row exists (PB 666-670; SH-06 at PB 1025;
EC-02 at PB 1013; PH-14 at PB 928).

**What is still wrong.** The exception counts a **lock** as HELD (contracts 502: "fingers, a grab, a carry or a lock"). Suppose a LIFE body bumps a
locked body nobody is touching, which LOCK.md 1 allows. That bump is not `auto`, so it reaches `feedback.handle` and plays `haptics.pop()`
(feedback.ts 150): autonomy buzzes the phone, against L7. D-84 (PB 162) already rules that a lock alone is not the player touching. LIFE L3 (LIFE
39) also still lists only "landing and prop bump".

**Fix:** for `auto`, count only fingers, a grab and a carry (a lock still makes the locked body HELD for its own brain). Add the case to PH-14.
Add "and body bump" to L3.

### CT-M3 (major): one stale line
`scootTo` is in the contract (560-566), PB 8.7 (434-443), D-10 and D-63 (PB 88, 141), LIFE 5.1 (192, 197), PG_PHYS step 2, PH-02 (PB 916) and the
arbiter (PB 544-545). But LIFE 5.3 (line 236) still says a floater heads out of the water "by `moveTo` on the surface". That breaks D-63 and
PG_LIFE's "Never ... `moveTo`" (PG_LIFE 136). **Fix:** change it to `scootTo`. Also say whether `scootTo` works on a floating body (the contract
says "the table carries the height").

### CT-M9 (major): the rule is in, but S2's Leaf Teeter breaks it
The floor rule is in M7 (PLACES 69), PB 8.4 (402-404) and DT-01 (PB 864). The cabin's Rocker Board passes: 1.1 sin 8 + 0.08 cos 8 = 0.232 m against
its 0.24 m pivot (PLACES 334). The **Leaf Teeter** (PLACES 451) does not: L 1.8, t 0.16, pivot 0.16 m, limit 10 degrees needs 0.9 sin 10 + 0.08
cos 10 = 0.235 m, so its low corner goes 0.075 m into the floor. That is the same fault. DT-01 runs on every PlaceDef, and DATA lands every place's
numbers in S0 (PB 821). The data lane may only move a thing up to 0.5 m (PLACES 236-238); it may not change a pivot. **Fix:** a 5 degree limit
(0.158 m) or a pivot of 0.24 m in PLACES 4.5.

### RC-B1 (blocker): one listed quest still has no keyboard route
"Tap it yourself" (PB 605-609; QUESTS 104-107, 583-585; PG_SHELL 159-161), Enter on a bubble with `tabindex="-1"` hit areas (PB 603-608; LIFE
402-403), QU-09 deriving K from a producer table (PB 989), and SH-14 walking C8 (PB 1033) are all in. But "Tap it yourself" covers only "every thing
with a switch (M14) and every ball". The **Shake Pine** (PLACES 418) is a bar with a hinge branch, not a switch and not a ball. No behaviour makes
a squishy bump its trunk at 0.3 m/s. So I4 (QUESTS 171), which the finding named, still has no keyboard path but is still tagged K. **Fix:** add
pokeable props (the pine, and every chime a player can tap) to "Tap it yourself", or mark I4 as not K.

### RC-M5 (major): DT-09 still has no VISIT exemption
Every title and hint fix is in: W7, L9, E5, W8, G6, X1, and I7, T9, E9 with "two times" (QUESTS 225, 244, 257, 226, 190, 287, 174, 210, 261). Q7
now lets a VISIT title name the place's feel (QUESTS 46). But DT-09 (PB 872; PG_DATA 122) is still "each title's verb matches its rule's event". The
fix asked for "Q7 and DT-09 exempt VISIT". As written, DT-09 fails "Sand and sea", "Pitter-patter", "Bubbles up" and "Tick, tock", or a reviewer
waives it by hand. **Fix:** add the VISIT exemption to the DT-09 row and to PG_DATA.

---

## 3. The resolved findings (where I checked)

- **CT-M2.** Step 2 calls `flush()` and checks `report().save === 'ok'` and the id in the stored text before step 3 (D-71 PB 149; PB 713-717; QUESTS
  438-442; PG_QUESTS 95-98). The CO-05 row covers failing storage (PB 1001). The turned-down part (reverting a granted gift found on no shelf) has a
  sound reason. A blend row names only its own direct parents (store.ts 100-103, 108-110), so a gift merged twice leaves no trace, and a revert
  would grant it again (QUESTS 449-450; PB 1173).
- **CT-M4.** `propThing` and `propPart`, with the one prop order and parked props for things not yet arrived (contracts 598-607). `thingId` is in
  the snapshot, with nThings = the things out now (837-844). Strike causes (628-632). PH-23 (PB 937). `bindProps` follows the order (contracts
  655-657; PG_RENDER 69).
- **CT-M5.** `contactSlot` (contracts 586-589), `SoftEvent.other` (510-512) and `SoftMetrics.contacts` (531-533). PB 8.9 (453-456), the host at PB
  535-537, PH-19 (PB 933), and the units' pair term from `contacts` (LIFE 551-552).
- **CT-M6.** The snapshot's music fields are deterministic (contracts 799-806). `musicClock` is used only for `at` and the render sway phase
  (732-736; PB 520-523). LIFE 8.4 (455-461), S06 on the sim-time grid (LIFE 304), and the shell owns the kettle's seeded timer (PG_SHELL 145), so
  `musicBoxOn` is on sim time. LF-26 and SH-01 run with music on (PB 909, 1020). The turned-down part (the field from the bed seed) has a sound reason:
  audio may re-voice a degree at synthesis, which changes no LIFE decision (PB 1184).
- **CT-M7.** One Float rule in PB 11.3 (562-565), PLACES P12 (49), PG_SHELL 99-102 and step 4's trap (66), and SH-11 (PB 1030). PH-21 moved to the
  shell (PB 935). Physics has no "ignore gravity" rule (PB 460-461; PG_PHYS).
- **CT-M10.** The shutter and preview with a data URL (PB 656-661; the CSP at index.html 13 allows `img-src data:`). PHOTO is pushed at the shutter
  (QUESTS 83), Q8 (QUESTS 47), and the dark-pattern row (QUESTS 467). The Frame thumbnail is at most 12 KB under `wobblehoard:v2:journal.frame`
  (QUESTS 298; PG_SHELL 164). SH-18 (PB 1037).
- **GT-B1 and RC-B2.** The wisher rule, no natural wish before the first wish, the gap exemption, the 5:00 backstop, a grant on any arrival, and lines
  with `{name}` (LIFE 145; QUESTS 311, 346-351, 483-484; PG_LIFE 63-65; PG_SHELL 91-92). LF-19 and QU-15 cover a profile with no Dollop (PB 902,
  995). The turned-down part (the backfill opens Hearthlog at once) has a sound reason: an existing save always shows a body, and the backstop
  opens Hearthlog by 5:00 anyway (PB 1176).
- **GT-M1.** Tall layouts (D-68 PB 146; PLACES P7 44) and RD-17's bars of 100 / 80 px (PB 958). Turning down 120 px is reasoned: a 1.6 m-wide
  area holds neither two riders nor five spawns (PB 1177). Note: RD-17 checks the front and mid-depth only. By the spec's own 101 / 83 px, the back of
  the 6 m-deep tall area should come out near 70 px (my extrapolation). S2 and S3 tall layouts are not laid yet; that work is assigned to their
  slices (PLACES 236-239).
- **GT-M2.** n2 = the group's count at each new high (contracts 883-884; LIFE 486-491; QUESTS 81, 94). A cut inside a zone emits at once. The quiet
  lifts after 1 s (LIFE 267-268; PB 543-544, 573). The "Who" column is in (LIFE 115, 297). LF-22 and QU-13 (PB 905, 993).
- **GT-M3 and RC-M6.** `REACT_TRIGGERS` gives each of the 23 kinds a condition and a thing source (LIFE 151-182; PB 312). The thing comes from
  `zoneThing` and `patchThing` (contracts 833-836) or `lifeAddLook`'s source thing (LIFE 620-621), whatever behaviour wins. SNOWCAP from a
  `lifeAddLook` fires every time, so I4 is not blocked by a snowball (LIFE 93-94, 169). DT-15, LF-21 and QU-13 (PB 878, 904, 993).
- **GT-M4.** F2 and the thing wish count a USE or a REACT on the thing. A switch favourite counts when the player switches it with the fan watching
  (QUESTS 336, 364). DT-03 (PB 866). See new problem N6 for a cross-reference slip.
- **GT-M5.** The `thingKinds` mask (LIFE 612-616, a LIFE function, not a contract member; QUESTS 336), open places counted only if shipped, and favourites only
  once their place is open. LF-25 and DT-16 (PB 908, 879).
- **GT-M6.** B20 RIDE (LIFE 136, 258-259; contracts 824-827). S11 counts any squishy within 2.5 m (LIFE 309). LF-23 (PB 906). (C3 itself is blocked
  by CT-B2's gate, not by RIDE.)
- **GT-M7.** S07 and S13 are now behaviours (LIFE 305, 311). `ThingDef.peek` and `Spot.peek` (PB 275, 278). LF-09 (PB 892). Moving the S2 and S3
  rocks waits for the re-lay, with a reason (PB 1183).
- **GT-M8.** The one-napper pile rule, the gap-mouth waypoint and an opening of at least 1.35 m (D-76; PLACES 66; LIFE 122, 230; DT-01). By my
  arithmetic the openings are basket 1.36 m, Snowdrift Nest 1.40 m and Cloud Nest 1.40 m. The clear inner radii are 0.80 / 0.80 / 0.85 m, matching
  LIFE 230. The copy is changed (QUESTS 278, 487; PLACES 337, 416, 644).
- **GT-M9, RC-M1 and RC-M8.** Tab stays the browser's, the party is one Tab stop with roving tabindex, a 3:1 ring is shown, and Enter has defined
  behaviour (PB 597-609; QUESTS 576-585; PG_SHELL 155-161). SH-14 (PB 1033). The tracker rule (QUESTS 62, 515; PG_SHELL 120-122) and SH-20 (PB 1039).
- **GT-M10.** Only completable quests are shown (QUESTS 59-62, 283; D-78 PB 156; QU-14 PB 994). Turning down "count every open place" is reasoned:
  the titles say "three places" (PB 1178).
- **GT-M11 and RC-M2.** The haptic and `registerFx` fire only when the completing record is by PLAYER (QUESTS 545-547; PB 581-582; PG_SHELL 111).
  EC-02 checks for 0 haptics while quest moments are above 0 (PB 1013), and SH-16 (PB 1035).
- **GT-M12.** With autonomy off, a player-asked use and a ride still move that squishy, and by-SELF clauses accept flag bit 3 (LIFE 271-274; QUESTS
  95-98; contracts 917-918; D-79). The help line matches in LIFE 274 and QUESTS 572. QU-16 and LF-24 (PB 996, 907).
- **GT-M13.** Every cell names a channel (PLACES 158-163; `Reaction.chan` PB 293). DT-06 counts only real channels (PB 869). The cabin cells are
  re-worded: "hops back from the heat" is B05 (LIFE 121), and the bask-only families get a render pose or a sound (PLACES 342-353). A grep finds no
  "stringier", "fluffs up", "turns round" or "steam soaks" left in a cell.
- **GT-M14.** A 1-bar whistle every 45 to 90 s, never within 60 s of a tune. The Music Box plays at most once per 40 s and a second tap stops it
  (contracts 747-750; PLACES 271, 338; PG_AUDIO 62-64; AU-14 PB 976). Turning down the bar without a qualifier is reasoned: a child tapping can choose
  73% tunes (PB 1181). With no input the kettle alone is at most 3.6 / 48.6 = 7.4%.
- **GT-M15.** The water now starts at z < -1.25 (PLACES 484-486). By my arithmetic it sits 0.05 m clear of the pad's 1.2 m edge, the swirl ring
  0.1 m clear, and the bubble patch's edge 1.55 m from the centre. DT-01 now checks zones against the pad (PB 864). The DT-01 run is deferred to S3
  with a reason (PLACES 488; PB 1182).
- **GT-M16.** `PlayEventRing.v` carries the part for USE RING (contracts 920; QUESTS 75, 95). QU-08 checks that producer and reducer agree (PB 988).
- **RC-M3.** "The player is touching" never means a lock alone (LIFE 38, 254-258, 467, 531; contracts 825-826). LF-04 and AU-13 have lock rows (PB
  887, 975). T11 is queued for LOCK.md (PB 854). See CT-B1 for the one place where a lock still counts.
- **RC-M4.** "Kind" means family in every line, and the Journal shows the family name (D-82; QUESTS 373, 536-537, 556; PLACES 738). A grep of
  player lines finds no species use of "kind" left. Turning down "use species" is reasoned: the family is what reacts differently (PB 1185).
- **RC-M7.** Landscape rows and width rules are adopted (QUESTS 516, 526-529, 543; SH-15 PB 1034; PG_VERIFY 91, 121).
- **RC-M9.** Q3 is reworded (QUESTS 42), and QU-03 checks that no TOUCH clause accepts a press under 0.4 s (PB 983). C8 keeps its player clause.

---

## 4. New problems the fixes brought in

- **N1. LIFE has no way to receive the place it is in.** D-69 puts each PlaceDef in a lazy `src/data/place_<id>.ts` (PB 147, 245, 298). LIFE is pure
  and synchronous, and may import only `../data/` statically (LIFE 37). A static import would pull every place into the life chunk and break T1's
  per-place naming (PB 844). Yet `lifeSetPlace(w, placeIdx, visit)` takes only an index (LIFE 607). The snapshot has no bounds, layout, use-spot,
  peek-spot, mechanism, ride or zone-position field (contracts 778-852). PB 645 says Home's bounds reach LIFE "through the snapshot's place bounds",
  and PG_LIFE 61 says "the host passes [them] as the place bounds", but no such member exists. LIFE also cannot tell the wide layout from the tall
  one (D-68), so LF-06 (PB 889) cannot be built. **Fix:** `lifeSetPlace(w, placeIdx, visit, def: PlaceDef, layout: 0 | 1, bodyScale)` plus
  `lifeSetBounds(w, shape, cx, cz, a, b, round)` for Home's moving bounds, documented in LIFE 12 and PG_LIFE.
- **N2. DT-01 checks use spots against the unshrunk bounds, but LIFE may not go there.** DT-01 requires use and peek spots inside the bounds (PB
  864). LIFE 5.7 (279-280) and LF-06 forbid targets outside the bounds shrunk by R + 0.2 m. In the tall cabin the Snug Basket's centre is at x 1.05
  (PLACES 319), and the tall half-width is 1.25 (311). The shrunk limit is x 0.425 for R 0.625 and 0.65 for R 0.4. So B06 cannot walk into the basket
  without breaking LF-06. Yet the script reported 0 problems. **Fix:** DT-01 should check use and peek spots against the bounds shrunk by R + 0.2
  for the smallest R, or LIFE 5.7 should exempt a thing's use spot. Re-run the cabin.
- **N3. The tall Pillow Swing leaves the bounds.** Its seat sweeps z -3.67 to -2.09 (PLACES 317), but the tall bounds end at z -3.0 (311). DT-01
  checks only "seat or rider spots", meaning the rest spot (PB 864), so at the back of each swing a rider is 0.67 m past the bounds. The corral would
  brake it or pull it off, against the row's own words ("the corral never pulls a rider off"). **Fix:** DT-01 should check rides' swept ranges
  against the bounds, or the corral should be off while `onProp` is a moving prop. Re-lay the tall swing.
- **N4. The motion gate's floor and the rider cost (detailed under CT-B2)** come from D-61 itself.
- **N5. `auto` and locks (detailed under CT-B1)** come from the contract wording added in revision 3.
- **N6. The F2 watchers disagree.** QUESTS 9 (364) says a switch favourite counts while the fan is "watching it (B13 or B18)". LIFE 5.3 (241) says
  "(B02 or B18)". B13 fires when the player touches a character (LIFE 129), not when the player taps a switch. **Fix:** use B02 or B18 in both.
- **N7. A wrong cross-reference.** The CS-02 line (PB 1071-1072) cites "QU-15's producer table". The producer table is QU-09; QU-15 is the no-Dollop
  row.
- **N8. The Leaf Teeter's numbers break the new floor rule (detailed under CT-M9).**

No contradiction found between the four specs and the eight briefs on: the scripts, the REACT triggers, the PIECES count, RIDE, the Float rule, the
kettle and Music Box timings, the gift's verified step 2, the Snap shutter, Tab, the tracker, and the settings v3 change (PB 611-629 and PG_SHELL
112-115 agree).
