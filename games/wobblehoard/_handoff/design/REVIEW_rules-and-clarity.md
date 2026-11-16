# REVIEW: the PLAYGROUND design (lens: RULES AND CLARITY)

Reviewer: an adversarial reviewer who did not write the design. Date 2026-11-15. Tree: HEAD 4fe77736 plus the uncommitted PLAYGROUND specs,
contract block and briefs. Read in full: `_handoff/STATUS.md`, `briefs/COMMON.md`, `briefs/SESSION3.md`, `design/DIRECTION.md`, `_spec/PLACES.md`,
`LIFE.md`, `QUESTS.md`, `PLAYGROUND_BUILD.md` (PB below), `REFERENCES.md`, `LOCK.md`, `UI.md`, the PLAYGROUND block of `src/contracts.ts`
(481-841) and the eight `_handoff/briefs/PG_*.md`. Spot reads: `FUN.md` (taps, Stamp), `DESIGN.md` 6.6, `src/input/keyboard.ts` 55-125.

**Ran (all light, read only):**
- `npx tsc --noEmit -p tsconfig.json`: exit 0, 1.6 s.
- The real name gate: `_harness/probe_catalog.ts` lines 76-298 copied unchanged into
  `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/review_rules/gate.ts` (only `HARNESS_DIR` pointed at
  `_harness`), driven by `screen.mjs` in the same folder over 1231 texts: 8 coined words (NAME rules), 10 place names, 62 things plus 22 zone and
  patch names, 20 keepsakes, 11 chapters, 24 emote names and 25 meanings, 110 quest titles and hints, 247 quoted lines from the specs and briefs,
  and the **557 family reaction cells** of PLACES 3 and 4 (PROSE rules), plus the Q10 copy words and lengths and the CS-05 first-four-letters rule.
- Results: coined words 0 hits; every place, thing, keepsake, chapter, title and hint 0 hits; CS-05 on place and thing names 0 hits; Q10 lengths
  all pass (titles at most 32, hints at most 90 and 12 words a sentence, at most one "!"). **Hits only in the reaction cells** (finding m1) and
  in quoted rule text that names a rejected word (expected). `fixes.mjs` (same folder) screens every replacement line proposed below: all pass.
- Originality: nothing in the names reads as another game, toy or character ("Nook" and "Pals" are gone, the internal word "squishmoji" never
  reaches player text). I have no originality finding.

**Not checked:** nothing run on a body, a browser, a build or an audio render; I did not read the proposals or judgements; I did not read TRADE,
CUT or DESIGN beyond the lines named; I did not verify the specs' own code line numbers; I did not run any probe suite.

Severity: **blocker** = a lane builds the wrong thing or the game breaks a rule; **major** = a rework or an owner ask left unmet; **minor** = polish.

---

## Blockers

### B1. A keyboard-only player cannot finish the S1 Hearthlog finale: "K" quests have no keyboard route to tap a thing, flick a ball or tap a bubble
- **Where:** QUESTS 6 "Keys" (84-86: K = Space press, "Go play with...", Wishes now, the Cut bar, Snap, Travel); QUESTS 15 Keyboard (522-526);
  PB 11.8 (466-471); SH-14 (PB 782); QU-09 (PB 744); LIFE 5.3 ("switch: never" for squishies, 192).
- **What is wrong:** the keyboard list has no way to tap a thing. Yet these are tagged K: **C8 "Fireside song"** (`USE{hearth, SWITCH, by PLAYER}`:
  the **gift finale of S1** and its Q6 player clause), T7 (tap), W2 (key), W4 (magnet), L7 (Star Scope), E4 (Echo Stone) (all `SWITCH by
  PLAYER`), H9 (`USE{feltball, ROLL, by PLAYER}` x3, a flick), H6 (`UI{EMOTE_TAP}`: the bubble hit areas are pointer DOM that live about 2 s), and I4
  (the pine shakes on a tap or a trunk bump of at least 0.3 m/s, faster than every gait's glide but firm silicone's 0.32, LIFE 5.2). "Go play
  with..." asks a squishy for a use, and squishies never switch. So a keyboard-only player never completes C8, never gets the Hearthlog gift or
  keepsake, and never opens Friends Everywhere (it opens at 2 finales, QUESTS 6.10). QU-09 trusts the hand-written K tags, so it passes.
  DIRECTION D11 ("everything works with keyboard only") is broken in the first shippable slice.
- **Fix:** (1) add a player route: the name tag popover (or a "Things here" list reachable by Tab) gets a second group, "Tap it yourself", with
  every thing that has M14 or is a ball; Enter calls the same switch or `PropWorldLike.poke` path as a pointer tap, recorded `by PLAYER`. (2) For
  H6: while "Tap a bubble" is open, Enter on the focused squishy whose bubble is showing reads its meaning into the polite live region and emits
  `UI{EMOTE_TAP}`; the DOM hit areas get `tabindex="-1"` (they move every 250 ms and must not hold focus). (3) QU-09 derives K per clause from a
  producer table (a `SWITCH by PLAYER`, a `by PLAYER` ROLL or an `EMOTE_TAP` clause needs the routes above), not from the tag. (4) SH-14 walks C8
  by keyboard end to end.

### B2. The whole PLAYGROUND hangs on owning Dollop: a player who merged it away never gets the first wish, Hearthlog or any place
- **Where:** QUESTS 8 (321-323: "Dollop shows a postcard of Hearthlog Cabin"), 13 (446; 452-454: backfill "the first-wish script still runs, so
  everyone gets the first trip"), 6.0 H7 and H8, 7 (Hearthlog "when the first wish shows"); LIFE 4.1 FIRST_WISH (129); PG_SHELL step 2.
- **What is wrong:** DESIGN 25 lets two of a kind merge into a random squishy, and I found no starter guard (`grep starter` over `src/core/merge.ts`
  and `src/collection/*.ts`: only labels and the fresh-save path). An existing player who merged their starter Dollop with a capsule Dollop owns no
  Dollop; a new player can do the same in the minute before the wish. Then FIRST_WISH has no wisher, Hearthlog never opens, H7 and H8 never
  complete, the Home finale never happens, Friends Everywhere (2 finales) never opens, and Ripple needs 12 stamps while at most 8 Home quests are
  doable. The content is locked for good, against Q2 ("a quest can always be done later"). Nothing says what happens when Dollop is owned but on
  the shelf.
- **Fix:** FIRST_WISH picks its wisher: Dollop if out; else an out squishy whose favourite place is Hearthlog (Dollop, Crimpo, Thumbly, Capnap,
  Hushpuff, Pastrel, PLACES 5); else the first party member. Every line takes the name as a field ("{name} wishes for a warm place: Hearthlog
  Cabin."; H7 "{name} has a wish"). Backstop: Hearthlog opens at 5:00 of play even if no wish could show. Add an LF-19 and a QU-05 row: "a profile
  with no Dollop gets the first wish and Hearthlog by 5:00".

---

## Majors

### M1. Tab is taken for party focus: a keyboard trap, and the focused squishy has no visible focus
- **Where:** QUESTS 15 (523: "Tab and [ ] move the focus between party members"); PB 11.8 (467); SH-14; PG_SHELL step 14; PG_VERIFY 6 tests
  "no keyboard trap".
- **What is wrong:** today Tab is the browser's (`keyboard.ts` handles Space, Enter, Escape, `[ ]`, T C H G M, arrows, + and -). If Tab cycles
  party members, a keyboard user can no longer Tab to the Journal, Places, mute or gear buttons (WCAG 2.1.2). Nothing says how the focused squishy
  is shown (UI.md 6: a 3:1 focus ring on every control) or which key opens its name tag popover ("Go play with..." lives there; Enter is already
  taken for the wish card).
- **Fix:** Tab stays the browser's. The party is one Tab stop: a DOM toolbar of one focus proxy per party member (roving tabindex); `[` and `]`
  move inside it (arrows stay the camera). The focused squishy gets a token ring under it at 3:1 and its name tag; Enter opens its wish card if it
  has a wish, otherwise its name tag popover. SH-14 checks Tab reaches every DOM control and leaves the party.

### M2. The quest-complete moment buzzes the phone and asks the music for room when LIFE completed the quest
- **Where:** QUESTS 15 (499-500: "one soft procedural stamp sound ... (a player-caused UI sound) and one 10 ms haptic tick (player-caused)");
  LIFE L7 (34: autonomy never vibrates the phone); EC-02 (PB 762: 0 haptics in a no-input hour); PB 10 (a sound that moved by itself never uses
  `registerFx`).
- **What is wrong:** many quests complete by themselves (H2 `by SELF`, C4, C7, C2 and every REACT quest; VISIT on EC-02's no-input travel). Built
  as written, each fires a haptic, so EC-02's bar fails by the spec's own design, and L7 breaks.
- **Fix:** the moment's haptic and `registerFx` only when the event that completed the last clause has `by PLAYER`; otherwise the stamp sound plays
  as an `auto` UI sound and there is no haptic. EC-02 and SH-16 assert both cases.

### M3. A lock silences the whole party: HELD counts locks, and "while the player touches anything" stops every other bubble and voice
- **Where:** LIFE L2 (29), 5.5 (205), 8.4 (396), 10.2 (449-450); contracts.ts 512-514 (HELD includes `locked`); AU-13; LOCK.md rule 4 (18:
  "leaving lobes locked and walking away earns nothing extra") and 3 (23: "switching squishy ... releases every lock").
- **What is wrong:** LOCK allows a lobe to stay locked while the player watches or walks away. A lane that reads "touches anything" as "any body is
  HELD" stops every P2 and P3 bubble and ducks every voice for as long as a lock exists: the social play of ask 3 goes silent. Separately,
  "pressing another party member is not switching squishy" (LIFE 5.5) changes LOCK.md 3, but PB 17 has a task for CUT.md (T4) and none for LOCK.md.
- **Fix:** define "the player is touching" as a finger down, a grab or a carry (active input), never a lock. A locked body is HELD for its own brain
  only. Add LF-04 and AU-13 rows with a lock and no finger. Add T11: LOCK.md 3 "pressing another party member is not switching squishy".

### M4. "Kinds of squishy" means families in three quests but species elsewhere, and the player is never shown families
- **Where:** QUESTS R2 (129, "three kinds ... `distinct family`"), I3 (147), X6 (269); against F11's hint "Bring out two of the same kind" (344:
  species) and the gift line "Three kinds that are hard to find" (PLACES 673: three species); the Journal page (QUESTS 15, 492-493) shows icon,
  name, traits and facts, **no family word**.
- **What is wrong:** a child who brings three different species of one family to the Rock Pool sees nothing count, and has no way to learn why.
- **Fix:** either change the three rules to `distinct species`, or keep families and (a) show the family word on each Journal page and tile, (b)
  say it in the hint: "A jelly, a foam and a dough in the Rock Pool." Use "kind" for one meaning only in every player line.

### M5. Titles and hints promise deeds their rules do not count (DT-09's keyword table cannot catch these)
- **Where and what:** QUESTS 6.
  - W7 "Sway to the clock" / "Two squishies sway by the Tick Clock." (202): the rule is `USE{tickclock, LISTEN}` = B18 answering a chime (chatty
    over 0.5, and the clock only chimes when the player taps it); the always-on sway within 1.5 m does not count.
  - L9 "A friend pushes the hammock twice." (221) and E5 "answers its own echo, twice" (234): one S11 moment already has 3 pushes and one S16
    has 2 exchanges, but the rules need two whole moments (`x2`).
  - W8 "Spin the cog, bounce the plate, ring the bell." (203): `USE{spinningcog, SPIN}` is a squishy riding it; a child who winds the cog has
    "spun" it.
  - G6 "Cut a squishy into three in the rain." (167): the rule is SPLASH (a Splash Spot), and all of the garden is rain.
  - X1 "Three new hellos" (264): old pairs count too.
  - I7, T9, E9 (151, 187, 238): "Set a squishy at the top..." for `x2`, while T3 says "twice".
  - VISIT titles with no verb (R1 "Sand and sea", G1 "Pitter-patter", T1 "Bubbles up", W1 "Tick, tock") break Q7 as written.
- **Fix:** W7 "Sing to the clock" / "Tap the Tick Clock. Two squishies sing back."; L9 and E5 `x1` (or "two times" and keep x2); W8 "A squishy
  rides the cog. Then a bounce and a ding."; G6 hint "Cut a squishy into three in a Splash Spot."; X1 "Three hellos"; I7, T9, E9 "... two times.";
  Q7 and DT-09 exempt VISIT quests (the hint carries the verb). All of these pass the gate (`fixes.mjs`).

### M6. Quest clauses rely on producer fields and timing the producer specs never define; QU-02 only replays synthetic events
- **Where:** QUESTS 4 REACT row (60: fields "sub, species, family, place, piece flag": no thing); PIECES row (65); LIFE 3.1 (81: a look emits its
  REACT once per visit at 0.5), B15 (116: "its first entry ... per zone per visit"), 9 (408-409: the brain stays on the face piece; piece events
  within 0.5 s merge); QU-02 and QU-08 (PB 737, 743).
- **What is wrong:**
  - Six rules filter REACT by **thing**: R2 `rockpool`, I3 `icepond`, I4 `shakepine`, G7 `dripleaf`, T4 `bubblepatch`, E2 `glowpool`. The ring has
    a `thing` slot (contracts.ts 825), but QUESTS 4 and LIFE never say a REACT fills it or how a zone or patch maps to its thing. A LIFE lane that
    follows QUESTS 4 emits thing -1 and the six quests never complete.
  - I4: SNOWCAP fires once per visit when snow crosses 0.5, whatever the cause; a snowball (+0.5) first means the pine's puff can never count that
    visit.
  - PIECES: is `n` the group size or the pieces that did it within 0.5 s? Does a group cut **inside** a zone get that zone's REACT (B15 needs an
    "entry", and the face piece keeps the whole's per-visit cooldown)? As written, C6 (an S1 main quest: "Cut a squishy into three, near the
    fire"), R6, T6 and E6 may be impossible exactly as their hints tell the child to do them.
  - QU-02 passes with hand-made events and QU-08 checks only event kinds, so no row catches any of this.
- **Fix:** add `thing` to the REACT row (the zone's or patch's owning ThingDef, from `PlaceDef`); a look raised by `lifeAddLook` always emits its
  REACT with the cause's thing (not once per visit); define PIECES `n` = the pieces of the group inside the zone (or using the thing) at that
  tick; on a cut inside a zone, emit `PIECES{zone kind, n}` once. Add **QU-13**: every quest of a shipped chapter completes from a scripted LIFE and
  host scenario (node, the real `lifeStep` and the host's ring writes), not only from synthetic records.

### M7. Landscape is tested but never specified, and the 320 px layout has gaps
- **Where:** PG_VERIFY 6 (80: "390 x 844, 844 x 390, 568 x 320 and 320 x 568"); SH-15 (PB 783: only 390 x 844 and 320 x 568); QUESTS 15 (469-481:
  portrait only; the wish card 358 x 96 at 477; the quest plate "at most 320 px" at 498).
- **What is wrong:** the lane passes SH-15 and the verifier then fails it on two sizes no page lays out (in 568 x 320 the S+104 top inset, the
  plate slot at +70 and a 96 px card leave almost no play view). At 320 px the wish card overflows (358 px), and a 320 px plate has no 16 px gutter
  (UI.md: reflow at 320).
- **Fix:** either drop landscape from PG_VERIFY 6 or add landscape rows to QUESTS 15 and SH-15 (for example: in landscape, the plate and the wish
  card go to the left half under the pill, the button column stays right). Write `width: min(358px, 100vw - 32px)` for the wish card (it may wrap to
  two lines, at most 120 px tall) and `min(320px, 100vw - 32px)` for the plate.

### M8. The tracker pill gets stuck on quests the player cannot do now
- **Where:** QUESTS 3 (47: "the tracker suggests them in order"), 15 (476: "the first unfinished main quest's title"), 13 (442: "keyboard players
  skip it"), 6 (85-86: K\*).
- **What is wrong:** for a keyboard player the pill shows "A big stretch" (H3, K\* until the keyboard stretch lands in S1 step 14, so all of S0)
  and "Tap a bubble" (H6, see B1) with no way to move on; nothing says how a player "skips". In S1, Friends Everywhere X4, X5 and X7 need places S1
  does not have. Nothing says which chapter's quest the pill shows away from that chapter's place.
- **Fix:** the pill shows the first unfinished main quest of the current place's chapter that can be done now (K when the last input was a key;
  every clause's place shipped), then Home's, then Friends Everywhere's. Add an SH row for it.

### M9. Rule Q3 "No quest needs a tap" contradicts ten quests, the S1 gift finale among them, and QU-03 must check it
- **Where:** QUESTS Q3 (30) and QU-03 (PB 739); H6, H9, C8, T7, W2, W4, L7, E4, I4, G7 (taps on things, a flick, a bubble).
- **What is wrong:** read literally, QU-03 fails on C8. The easy "fix" a lane might make, removing the tap clause, would strip C8's player-caused
  clause and break Q6 (LIFE alone could earn the gift).
- **Fix:** Q3: "No quest needs a tap or a poke **on a squishy** (taps on squishies pay nothing, FUN 2). Taps on things, switches, balls and
  bubbles are fine." QU-03 then checks that no TOUCH clause accepts a press under 0.4 s.

---

## Minors

### m1. DT-02 will fail on the reaction cells: they were never screened, and they become Journal text
- **Where:** PLACES "stops it dead" (190, 250, 292, 332, 372, 409, 596) and "stops the marble dead" (193, 487): `unsafeReasonText` word "dead";
  "rattles like beans in a pot" (301): word "pot"; "crisp, clinky rattle" (165) and "clinky rattle" (301): "clinky" ~ "slinky". PB 20 screened 434
  texts, not the 557 cells that PG_DATA turns into `REACTION_TEXT` and the F4 to F7 fact lines.
- **Fix:** "stops it still", "stops the marble still", "rattles like beans in a jar", "crisp, tinkly rattle" (all pass). PB 20 adds the cells to
  its screened set.

### m2. CS-05's scope is unclear in the DATA brief, and the "Puddles" rename is undone in the quest text
- **Where:** PG_DATA DT-02 bullet (75-77) lists CS-05 beside the copy rules with no scope; PLACES 7 (705) scopes it to place and thing names.
  G6 title "Puddle bits" (QUESTS 167), G2 hint "splash in the puddles" (163), the signature verb "puddle jumps" (PLACES 398, 420).
- **What is wrong:** applied to all text, CS-05 fails at once on about 70 words of the titles, hints and cells (my count: boing 16, rattle and its
  forms 34, thud 4, glug 3, dimple 3, wisps 2, nuzzle 1, puddle 2, grant 2). D-49 renamed "Puddles" to "Splash Spots" for Puddlo, yet the quests
  still say "puddles", so a child sees two names for one thing.
- **Fix:** the brief says "CS-05 applies to names: places, things, zones, patches, keepsakes, chapters". Rename G6 "Splashy bits"; G2 hint
  "Three squishies splash in the Splash Spots."

### m3. Sound off: the bubble table is not total, and bubbles are budgeted apart from voices
- **Where:** LIFE 7.2 (335: "every voice phrase has its bubble"), 8.3 (370: chat maps to "none"), 6.1 S02 (238), 10.1 (phone 0.8 bubble starts a
  second against 3 syllable starts); UI-03 (PB 790: "the voice-to-bubble table is total").
- **What is wrong:** UI-03 fails on chat as written. With sound off most voiced moments show nothing, since the bubble budget drops them. Nothing
  defines "sound off" (muted, Voices at 0, or the device).
- **Fix:** "sound off" = muted or Voices at 0. Then chat shows `hello` on its first speaker (inside the budget), and a voiced moment's bubble takes
  the priority its voice had. UI-03 tests that table with chat included.

### m4. New motion has a Calm variant but no reduced-motion one, and the wish re-glance is a pulse
- **Where:** QUESTS 15 (498-499: the stamp "springs in ... Calm: a fade"; 446 and 475: the Places button's "one 400 ms scale-in"); LIFE 7.2 (327:
  re-glances "a 0.2 s grow at 8 s and at 30 s"); DESIGN 6.6 (609: Calm has "no pulses at all"); UI.md 18 (reduced motion **and** Calm fade).
- **What is wrong:** a player with reduced motion who turned Calm off still gets springs and scale-ins, and Calm still gets the re-glance grow.
- **Fix:** every new motion line says "Calm or reduced motion: a fade". In Calm a re-glance is a 0.2 s opacity lift, not a grow. List them in
  UI-02 and RD-09.

### m5. Live-region and name gaps for screen-reader players
- **Where:** QUESTS 15 (474, 475, 501-503, 515-516); LIFE 7.2 (336).
- **What is wrong:** a place opening, the Places button appearing and arrival in a place have no live line. The Journal's "new" state is a 6 px
  dot with no text, and the button's name doesn't change. Four rate-limited sources share one polite region with no queue rule.
- **Fix:** lines "Hearthlog Cabin is open. Find it in Places." and "You are at Hearthlog Cabin."; the Journal button's name becomes "Journal,
  something new"; one queue for the region (quest and wish lines first, at least 2 s apart). SH-16 covers them.

### m6. Word clashes: "quest" leaks into player text, and "stamp" will mean two things
- **Where:** QUESTS 15 (501: "Quest done: Chase the yarn.", "3 quests done"); D-34 (PB 98: "Quests" is a hard word); FUN 1 (19: the queued
  **Stamp** tool presses a star or a moon into a squishy) against "Opens at 28 stamps", the Stamps tab and the stamp plate.
- **What is wrong:** once the Stamp tool ships, a seven-year-old will expect to earn stamps by stamping squishies.
- **Fix:** "New stamp: Chase the yarn." and "3 new stamps". Rename one of the two before the Stamp tool ships (for example the tool "Press" or
  "Prints"), and add it to V19.

### m7. Copy for a seven-year-old and the eyes-only rule
- **Where:** R8 "Sunset hug" (135) and I5 "Warm hugs" (149): squishies have no arms (REFERENCES 3, LIFE L8); the rules are SNUGGLE and NUZZLE.
  "hearth" in C2 and C8 hints (112, 117) and the thing name: not a word a seven-year-old reads; "Window Draught" (PLACES 272) as a zone name.
- **Fix:** "Sunset snuggle"; "Snug in the snow"; the thing "Fireplace", with hints "Two squishies warm up by the fire." and "Tap the fireplace.
  Then three sing together."; "Window Chill". All pass the gate.

### m8. S1 names places that do not exist in S1, and the Friends Everywhere finale cannot open there
- **Where:** PLACES 5 gift table (669: Hearthlog's line "All three love Ripple Shore."); QUESTS 9 F3 hint (336); QUESTS 15 (513: unshipped places
  are hidden, no "coming soon"); PB 15 S1 (595) ships "Friends Everywhere"; X4, X5 and X7 need two or more places beyond Home, or water.
- **What is wrong:** an S1 child is told about a place they can never find. In S1 only 4 of the 7 Friends Everywhere main quests can be done, so its
  finale, gift and keepsake cannot open, and the S1 page does not say so.
- **Fix:** a gift line or hint names a place only if it has shipped (else "All three love the water."); F3 falls back to the friend's family
  riddle. PB 15 states that the Friends Everywhere finale needs S2, and the tracker skips those quests (M8).

### m9. Wrong example in the X3 note
- **Where:** QUESTS 275-276: "reachable with the first gifts alone (Dollop and Crimpo ...; Glugbean and Thumbly too)".
- **What is wrong:** neither pair is on a gift list. The gift pair is Puddlo (Hearthlog list) and Boingle (Ripple list), a Common best pair
  (PLACES 657).
- **Fix:** correct the note; QU-11's scripted stream uses Puddlo and Boingle.

### m10. Gating words a fresh engineer can read two ways
- K\* (QUESTS 85-86): "does not count toward any opening threshold" reads as a runtime rule (drop H3's stamp for everyone), while QU-09 treats it
  as a design proof. Say: "the thresholds must be reachable without it; its stamp counts like any other".
- "never before the Home chapter is done" (QUESTS 386): is that the Home finale, or all 10 Home quests (H3 and H6 shut keyboard players out)?
  Say "after the Home finale (H8)".
- S11 "a friend near" (LIFE 247) and the friend wish's "that friend" (QUESTS 314): any squishy, Met, Friends, or the authored best friend? The card
  example ("Crimpo wants to see Dollop") is a best-friend pair and would give away F3 before its riddle hint. Name the level in both rows.

### m11. Numbers that disagree between pages
- PB 19 (826): the whole-game charter runs "a 30-minute no-input economy run"; EC-02, LIFE L3 and PG_VERIFY 7.3 say 60 sim minutes. Use 60.
- PLACES P12 (38): float only for "a single squishy at Home with autonomy paused"; D-38 (PB 102) and SH-11 override float only "in places and with
  more than one body". One squishy at Home with autonomy on is undefined. Pick one rule.
- PG_AUDIO step 2 (40): pieces are "one octave up, D6 to D7"; LIFE 8.2 (357-358): "x popSize(frac) = (0.5 / frac)^0.4, snapped from D6 to D7".
  Make the brief quote LIFE.

### m12. LF-09's greet bar cannot be met by small parties
- **Where:** LF-09 (PB 659: "a 5-minute default visit gives each squishy about ... 3 to 4 greets"); S01 (LIFE 237: once per pair per visit).
- **What is wrong:** a squishy can greet at most party size minus 1 per visit (2 on low with 3 wholes), and "default visit" (tier, party) is not
  defined. A lane may loosen S01 to pass.
- **Fix:** write the bar per party: greets = every pair once; naps at least 1; thing uses 2 to 3; name the tier and party.

### m13. Three squishmoji colours break their own rule
- **Where:** LIFE 7.1: 17 leaf, accent "felt and lagoon" (304: two accents, the rule is one); 18 moon, "cream outline" (305) inside a cream bubble
  at 0.92 alpha (318); 22 postcard, "the place's sky band" (308), near cream for Ripple Shore and Frostbell Ridge skies (PLACES 312, 351). RD-04
  checks only the ink icon on the fill.
- **Fix:** leaf lagoon only; moon an ink crescent with an amber fill; postcard a sky band with an ink frame. RD-04 also checks the accent at 3:1
  on the fill.

### m14. Signed-in players are promised a gift they cannot take
- **Where:** Q12 (39: no gifts on an account until T8); QUESTS 15 (502: "See your gift"; 506-508: the gift card with [Yes]).
- **Fix:** on a signed-in ledger the chapter plate says "Your gift will wait here for now." with no Yes button, and the pending gift shows in the
  Journal with that line. CO-09 checks the copy.

### m15. The squirt game's "in front" is undefined and it is tagged K
- **Where:** LIFE S14 (250), QUESTS R7 (134), PG_SHELL S2 ("a target within 1.2 m in front").
- **What is wrong:** "in front" could mean toward the camera or along the foam's gaze; a keyboard player cannot place a friend there.
- **Fix:** the target = the nearest party member within 1.2 m and within 60 degrees of the foam's gaze (else the nearest within 1.2 m); a
  keyboard squeeze of a soaked foam uses the same rule.
