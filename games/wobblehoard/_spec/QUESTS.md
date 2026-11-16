# QUESTS: the Journal, wishes, discoveries and keepsakes

**Status:** final design, 2026-11-15 (the PLAYGROUND synthesizer). Read with [`PLACES.md`](PLACES.md), [`LIFE.md`](LIFE.md) and
[`PLAYGROUND_BUILD.md`](PLAYGROUND_BUILD.md) (save format, contract, checks). **Owner ask 5:** "a real playable game with goals, quests, or something
that will give playing it a purpose". Paths are relative to `games/wobblehoard`.

**Revision, 2026-11-15 (the continuing synthesizer):** (1) a WISH GRANTED event now says who granted it (section 4): a nap, song, thing or
warm-up wish can come true with no input, so the Frostbell gift finale I8 counted LIFE alone as the player (Q6, JUDGE_COHERENCE M1); I8 now needs a
wish the player granted. (2) F1 had no typed event ("B10 plays" is a behaviour): B10 now emits REACT LOVE. (3) BRING is one record per party
member, which F0 needs. (4) Places with `shipped: false` are not shown in Travel. (5) The Hearthlog finale (S1) no longer promises the Bounce
Pad before the flush pad ships (S2). (6) The first minute names the FIRST_PLAY script and B09's hello. Nothing else changed.

**Revision 3, 2026-11-15 (after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84 and 23):** (1) the first wish needs no Dollop
(8, 13: any party member can wish it, with a 5:00 backstop); (2) every REACT carries a thing and every REACT kind has a trigger (4, LIFE 4.2), a
PIECES record carries the group's count (4), and a USE RING carries its part (5); (3) Q3 says what it protects (no tap or poke on a squishy), Q8
counts a photo at the shutter, X10 needs the player; (4) keyboard routes for switches, balls and bubbles, and K is derived from them (6, 15); (5)
only completable quests are shown, so Friends Everywhere's place-spanning quests and finale wait for S2 (3, 6.10); (6) with autonomy off,
by-SELF rules accept the player's own uses (5); (7) wishes target only what open places have, one wish bubble shows at a time, a ride wish is
granted by RIDE, and a friend wish never names an unfound best friend (8); a favourite thing counts by a USE or a REACT (9); no line names a place
that has not shipped (9, 15);
(8) the gift's hoard write is verified before "granted" (11); (9) titles and hints fixed where they promised what the rule does not count, and
"kind" means a family everywhere (6); (10) the screens: Tab stays the browser's, landscape rows, live lines, "New stamp", the shutter, the quest
moment's haptic only for the player's own deed (15).

## 1. The purpose, in one paragraph

Squish Keeper's loop today is touch, meter, capsule, merge: good for a session, with no answer to "why tomorrow?". The **Journal** is that answer,
and it never turns play into a currency. It is a book of **stamps**: every quest is a small thing to see or do with your squishies in a place
("Two squishies warm up by the fire."), and each one done stamps the page. Stamps open new places, one after another, over about two weeks of
play. Each squishy has a **page of 12 facts to discover** (what it loves, where it is happiest, who its best friend is, what it does in water, in
the cold, by the fire), so every capsule opens a new page and every repeat copy has a use. Squishies **wish** for things (a place, a friend, a
ride, a slow squeeze), and granting a wish is how you find out what they love. Friendships grow while they play together. Finales change the place
for a moment (a sunset, falling stars, a song by the fire) and leave a **keepsake** on the shelf at Home. The only economy touch is **five chosen
gift squishies for life**; nothing in the Journal pays squish points or capsules, nothing can be lost, nothing has a timer.

## 2. Rules (every quest, every reward, every line)

| # | Rule | Check |
|---|---|---|
| Q1 | No currency: stamps, warmth and friendship points are counts that only grow; nothing is ever spent, exchanged or decremented. | QU-10 (CS-13) |
| Q2 | No timers that punish, no fail states, no streaks, no calendar gates on content. A quest can always be done later. Places open by stamps only. | QU-06, audit 15 |
| Q3 | No quest needs a tap or a poke **on a squishy** (taps on squishies pay nothing and are free play, FUN 2). Taps on things, switches, balls and bubbles are fine: they are how the player plays with a place. | QU-03 (no TOUCH clause accepts a press under 0.4 s) |
| Q4 | A main quest names a family only if that family has at least 2 Commons (jellygel, waterfill, gummy, marshmallow, mochidough); no quest needs a species above Uncommon; every clause is reachable at `low` caps (3 wholes, 6 characters with pieces) **with one mover at a time** (LIFE 10.3: at the provisional phone factor low and med move one squishy at a time; every joint moment takes turns, so a snuggle of three gathers one by one). | QU-03 |
| Q5 | Counts stay small: a main quest repeats one deed at most 3 times (a distinct count at most 4); a bonus at most 5 (distinct 6). "Distinct" is preferred: three different squishies teaches "in their own way". | QU-04 (JUDGE_FUN F14) |
| Q6 | Every finale opens at 5 of its chapter's 7 main quests (Home's opens when the first wish shows); a finale that gives a gift has at least one clause the player causes (a touch, a toss, a player use, a ride the player sets up, a photo, a wish the player granted: `by PLAYER`, section 4), so LIFE alone can never earn an item. | QU-05, QU-07 (JUDGE_COHERENCE M1) |
| Q7 | A title says what you do, and its verb matches its rule's event ("Say hello" is a greet, never a squeeze). A VISIT quest's title may name the place's feel ("Sand and sea") because its hint carries the verb ("Go to Ripple Shore."); its hint, and every hint, must match its rule's count ("two times" for x2). | DT-09 (JUDGE_FUN F23) |
| Q8 | A photo counts when the shutter is pressed and the in-page preview shows, never on a file save; saving the photo is optional (PLAYGROUND_BUILD 11.15). | QU-08, SH-18 (M19) |
| Q9 | No progress number ever goes down on screen; main quests have no "within one visit" clauses. | QU-10 (M20) |
| Q10 | Copy is kind and plain: titles at most 32 characters, hints at most 90 and at most 12 words a sentence, at most one "!" per text; no "sad", "lonely", "grumpy", "hurt", "misses you", "come back" or "hurry". | DT-02, DT-08 (CS-04) |
| Q11 | Quest ids, keepsake bits, place ids and fact bits are append-only indexes (like the species idx), so a save never breaks. | DT-14 |
| Q12 | Journal items (the gift squishies) exist on the **Practice shelf only**. A signed-in account gets keepsakes, facts and places, and gifts only once a host operation with a per-account lifetime cap exists (`wh_claim_journal_gift`, a COLLECTION server task; COLLECTION C-6: "any promotion path is a forgery path"). | CO-09 (M3) |

---

## 3. The Journal

Four tabs: **Stamps** (the chapters and their quests), **Squishies** (50 pages of facts), **Friends** (pairs and levels), **Keepsakes** (the shelf).
11 chapters: Home, the nine places, and **Friends Everywhere** (quests across places). Each chapter has **7 main quests, a finale and 2 bonus
quests** (110 quests, 110 stamps). All quests of an open chapter are open at once. **A quest is shown only when it can be completed with the
places that have shipped** (and their things): a clause that needs an unshipped place, or a kind of thing no shipped place has, hides the quest
until it can be done; a chapter of an unshipped place is hidden, as Travel hides the place; a finale is shown once its chapter can reach 5
shown main quests (PLAYGROUND_BUILD D-78, QU-14). The tracker shows the first one that can be done now (15).

## 4. Typed events (`EV` ids in `src/data/quests.ts`; the play-event ring of contracts.ts PLAYGROUND)

The reducer's only input. Every kind has a named producer (QU-08). All are player-or-self tagged (`by`). Flag bit 3 marks a record made while
"Squishies move on their own" was off (5).

| EV | Fields | Producer | When |
|---|---|---|---|
| VISIT | place | shell place manager | arrival after a trip (Home counts on return) |
| BRING | place, a (the species of the member), n (party size, pieces count) | shell party manager (`mat.ts` add and remove carry the item id; today only `onChange` with no payload, SHELL map 4) | one record per member that comes out, and one per member on arrival |
| TOUCH | sub SQUEEZE, STRETCH or TOSS; species; v = held s or pull level | shell `drainBody`, a copy of the meter's mapped touch and of feedback's toss; **player only**; counts even while 5 capsules wait | each paying touch and each toss |
| SIGNATURE | species | LIFE host (B08 on its loved touch, which may be a poke) | once per session per instance |
| USE | thing, sub verb (ROLL, ROCK, SWING, SPIN, BOUNCE, RING, NAP, FLOAT_ON, SLIDE, SWITCH, LISTEN, LEAN, WADE, SHAKE, STEP), species, by; v = the part index 0..7 for RING (`PropWorldLike.propPart` of the struck prop) | LIFE host (by itself); prop strikes (`drainStrikes`: cause 1, a body, gives by itself with that body's species; cause 0, the player, gives by PLAYER; **cause 2, the weather, gives no USE at all**, only a sound); the shell for switches, flicks and rides the player set up, and for the keyboard's "Tap it yourself" (by the player) | a use completes |
| REACT | sub kind (FLOAT, WADE, SOAK, TOAST, RISE, OOZE, WARM, SHIVER, FROST, SNOWCAP, GLIDE, SPLASH, DRIFT, LIFT, RATTLE, GLOW, GAZE_SKY, PRINT, SHOWER, FIZZ, HOLD_ON, DRY, LOVE), species, family, place, **thing** (the thing owning the zone or patch it happened in, or the thing that caused it: LIFE.md 4.2), piece flag | LIFE host, by `REACT_TRIGGERS` (LIFE.md 4.2: every kind's condition; it fires whatever the squishy is doing) | a family reaction happens |
| SOCIAL | sub kind (GREET, CHAT, BOOP, NUZZLE, COPY, PARADE, SING, SNUGGLE, PILE, COMFORT, TEETER, PUSH, PASS, PEEK, SQUIRT, MIRROR, ECHO, DUET, TWIRL), a, b, n, place, thing | LIFE host (SQUIRT: the shell, from the player's squeeze) | a moment completes |
| FRIEND | a, b, sub level (MET, FRIENDS, CLOSE) | the reducer itself (derived from SOCIAL points) | a pair reaches a level |
| WISH | sub SHOWN, SEEN or GRANTED; species; v = wish kind; by | LIFE host (SHOWN, GRANTED; kind and target from `lifeWishOf`); shell (SEEN: the card opened) | GRANTED carries **by PLAYER** for a place, friend, ride or touch wish (the player's trip, bringing out, set-up or touch granted it), and for a nap, song, thing or warm-up wish only when the player carried, tossed or asked "Go play with..." for that squishy in the 10 s before the grant; otherwise by SELF |
| DISCOVER | species, sub fact (F0..F11) | the reducer itself (derived, section 9) | a fact is found |
| PIECES | sub = the underlying USE verb or REACT kind, **n = the group's piece count at a new high for this visit** (the pieces inside the zone, or that used the thing within 4 s), place, thing | LIFE host for a piece group's event (LIFE.md 9); a cut inside a zone gives its PIECES record at once | each new high |
| CUT / WHOLE | n pieces / the most pieces of that cut | shell `cut.ts` (a new `onCut` hook: today Split in two and Reconnect all emit nothing and `joined` is never emitted, SHELL map 4) | |
| PHOTO | n characters in the frame, best-pair flag, place | shell Snap, **at the shutter** (the in-page preview shows; Save is optional) | |
| CAPSULE | sub tier, new flag | shell ceremony end (`RevealInfo`) | |
| GIFT | species | the journal's gift claim | |
| UI | sub JOURNAL, TRAVEL, EMOTE_TAP, GO_PLAY | shell UI (EMOTE_TAP from a bubble tap, or from Enter on a focused squishy while its bubble shows) | |

## 5. The rule grammar

A quest is 1 to 3 **clauses**, all required, each kept as a persistent counter (never reset). A clause:
`{ ev, sub?: id[] (any of), place?: id | 'away' (any place but Home), thing?, mech?, family?, minN?, by?: SELF | PLAYER, count, distinct?: 'species' | 'family' | 'thing' | 'part'
| 'pair' | 'place', sameSpecies?: true }`. `distinct` keeps a bitset (species 64 bits, families 16, things 64, parts 8, places 16, pairs a hash set of
at most 32). `sameSpecies` on every clause of a quest means one species must appear in all of them (the quest completes when the AND of the clauses'
species bitsets is not zero). `minN` counts characters in one event (pieces count: for a PIECES record it is `n`, the group's count at a new high).
`distinct 'part'` reads the part index the record carries in `v` (USE RING). **`by SELF` and autonomy off:** a by-SELF clause also accepts a
by-PLAYER record that carries flag bit 3 (made while "Squishies move on their own" was off), so a player who turned it off can still finish the
chapter with "Go play with..." and the rides (PLAYGROUND_BUILD D-79); a quest that still cannot be done then shows "Needs: Squishies move on their
own" and the tracker skips it. Rules below use the shorthand `Ev{fields} xN`.

---

## 6. The chapters

"Keys": **K** = the keyboard can complete it, **derived per clause from a producer table of the keyboard routes** (QU-09; PLAYGROUND_BUILD.md
11.8): Space on the focused squishy, the keyboard stretch, "Go play with..." for uses and rides, **"Tap it yourself"** for every switch and every
ball, **Enter on a focused squishy while its bubble shows** (a bubble tap), the Wishes now list, the Cut bar's Split in two and Reconnect all, the
Snap shutter, Travel. **K\*** = needs the keyboard stretch: the opening thresholds must be reachable without it (CS-02); its stamp counts like any
other.

### 6.0 Home: "First Days" (idx 0..9; opens at the start; the finale opens when the first wish shows)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| H1 | A gentle squeeze | Press and hold your squishy for a moment. | TOUCH{SQUEEZE, v >= 0.4} x1 | K |
| H2 | Watch it play | Let go and wait a little. | USE{place home, by SELF} x1 | K |
| H3 | A big stretch | Pull it out, then let go. | TOUCH{STRETCH, v >= 0.35} x1 | K\* |
| H4 | Open a capsule | Squeeze and stretch to fill the meter. | CAPSULE{} x1 | K |
| H5 | Say hello | Two squishies out together will say hello. | SOCIAL{GREET} x1 | K |
| H6 | Tap a bubble | Tap a bubble to see what it means. | UI{EMOTE_TAP} x1 | K |
| H7 | A first wish | Tap the thought bubble to read it. | WISH{SEEN} x1 | K |
| H8 | **A wish comes true** (finale) | Go to the place on the postcard. | WISH{GRANTED, kind PLACE} x1 (the first wish is granted by the first arrival at Hearthlog Cabin with any party, LIFE 4.1) | K |
| H9 | Roll the felt ball | Flick the Felt Ball three times. | USE{feltball, ROLL, by PLAYER} x3 | K |
| H10 | Nap time | Two squishies nap on the Snooze Rug. | SOCIAL{PILE, thing snoozerug, minN 2} x1 | K |

Finale reward: keepsake **Felt Star**; the Keepsake Shelf arrives at Home (once its spot is in view, PLACES 4.1); the tracker then suggests the daily
Restock gift (a feature of today; JUDGE_FUN F26: not before the first hello). Spectacle: the postcard in the wisher's thought bubble (Dollop's,
when Dollop is out) unfolds into the cabin as you travel.

### 6.1 Hearthlog Cabin: "By the Fire" (idx 10..19; opens when the first wish shows)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| C1 | Come in from the snow | Go to Hearthlog Cabin. | VISIT{hearthlog} x1 | K |
| C2 | Cozy by the fire | Two squishies warm up by the fire. | REACT{WARM, place hearthlog} x2 distinct species | K |
| C3 | A push on the swing | Set one on the swing. A friend may push it. | SOCIAL{PUSH, place hearthlog} x1 | K |
| C4 | Chase the yarn | Two squishies chase the Yarn Ball. | USE{yarnball, ROLL, by SELF} x2 distinct species | K |
| C5 | Two on the rocker | Set two squishies on the Rocker Board. | SOCIAL{TEETER, thing rockerboard} x1 | K |
| C6 | Little bits by the fire | Cut a squishy into three, near the fire. | PIECES{WARM, place hearthlog, minN 3} x1 | K |
| C7 | Answer the kettle | When the kettle whistles, someone sings back. | USE{kettle, LISTEN, by SELF} x1 | K |
| C8 | **Fireside song** (finale) | Tap the fireplace. Then three sing together. | USE{hearth, SWITCH, by PLAYER} x1 + SOCIAL{SING, place hearthlog, minN 3} x1 (the thing id stays `hearth`; its name is the Fireplace) | K ("Tap it yourself") |
| C9 | Toasty and golden | A marshmallow toasts, or a mochi rises. | REACT{TOAST or RISE, place hearthlog} x1 | K |
| C10 | Who loves the cabin? | Find a squishy that loves it here. | DISCOVER{F1, place hearthlog} x1 | K |

Finale: keepsake **Ember Pinecone**; a **gift** (Puddlo, Crumbit or Swishel); the Bounce Pad arrives at Home once the flush pad ships (S2: the pad is
S2 physics, PLAYGROUND_BUILD 15, so an S1 build never promises it). Spectacle: the fire swells and everyone sings with the music.

### 6.2 Ripple Shore: "Sun and Splash" (idx 20..29; opens at 12 stamps)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| R1 | Sand and sea | Go to Ripple Shore. | VISIT{ripple} x1 | K |
| R2 | Three in the pool | See three kinds of squishy in the Rock Pool. | REACT{FLOAT or WADE, thing rockpool} x3 distinct family | K |
| R3 | Ring the shells | Ring three different shells. | USE{shellchimes, RING} x3 distinct part | K |
| R4 | Pass the pebble | Two squishies pass the Pebble Ball. | SOCIAL{PASS, thing pebbleball} x1 | K |
| R5 | Peekaboo by the log | Watch two play peekaboo by the log. | SOCIAL{PEEK, thing driftlog} x1 | K |
| R6 | Bits in the pool | Cut a squishy into three in the pool. | PIECES{FLOAT or WADE, place ripple, minN 3} x1 | K |
| R7 | A squirt for a friend | Soak a marshmallow, then squeeze it at a friend. | SOCIAL{SQUIRT, place ripple} x1 | K |
| R8 | **Sunset snuggle** (finale) | Squeeze one on the sand. Then three snuggle. | TOUCH{SQUEEZE, place ripple} x1 + SOCIAL{SNUGGLE, place ripple, minN 3} x1 (S07 is a behaviour that gathers three, LIFE 6.1) | K |
| R9 | Slide off the mound | Set squishies on the Sand Mound. | USE{sandmound, SLIDE} x2 | K |
| R10 | Who loves the shore? | Find a squishy that loves it here. | DISCOVER{F1, place ripple} x1 | K |

Finale: keepsake **Sea-glass Pebble**; a **gift** (Boingle, Hooplet or Knubby). Spectacle: the sky warms to sunset.

### 6.3 Frostbell Ridge: "Frost and Glide" (idx 30..39; opens at 20 stamps)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| I1 | Hello, snow | Go to Frostbell Ridge. | VISIT{frostbell} x1 | K |
| I2 | Frosty friends | Two squishies get frosty. | REACT{FROST, place frostbell} x2 distinct species | K |
| I3 | Zoom on the ice | Two kinds of squishy glide on the Ice Pond. | REACT{GLIDE, thing icepond} x2 distinct family | K |
| I4 | Snow from the pine | A bump on the pine drops snow on a friend. | REACT{SNOWCAP, thing shakepine} x1 | K |
| I5 | Snug in the snow | Watch two squishies nuzzle in the snow. | SOCIAL{NUZZLE, place frostbell} x1 | K |
| I6 | Bits on the ice | Cut a squishy into three on the ice. | PIECES{GLIDE, place frostbell, minN 3} x1 | K |
| I7 | Down the glide ramp | Set a squishy at the top of the ramp two times. | USE{glideramp, SLIDE} x2 | K |
| I8 | **Stars over a snuggle** (finale) | Grant a wish here. Then three nap together. | WISH{GRANTED, place frostbell, by PLAYER} x1 + SOCIAL{PILE, place frostbell, minN 3} x1 | K |
| I9 | Ring the icicles | Ring the Icicle Bells five times. | USE{iciclebells, RING} x5 | K |
| I10 | Who loves the snow? | Find a squishy that loves it here. | DISCOVER{F1, place frostbell} x1 | K |

Finale: keepsake **Tiny Frost Bell**; a **gift** (Munchip, Sproutle or Acornel). Spectacle: the snow slows and the stars come out.

### 6.4 Rainleaf Garden: "Rainy Day Play" (idx 40..49; opens at 28 stamps)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| G1 | Pitter-patter | Go to Rainleaf Garden. | VISIT{rainleaf} x1 | K |
| G2 | Splash, splash | Three squishies splash in the Splash Spots. | REACT{SPLASH, place rainleaf} x3 distinct species | K |
| G3 | Teeter on a leaf | Set two squishies on the Leaf Teeter. | SOCIAL{TEETER, thing leafteeter} x1 | K |
| G4 | Boing on the moss | Bounce on the Moss Bouncer three times. | USE{mossbouncer, BOUNCE} x3 | K |
| G5 | Follow the leader | Three squishies follow one another. | SOCIAL{PARADE, place rainleaf, minN 3} x1 | K |
| G6 | Splashy bits | Cut a squishy into three in a Splash Spot. | PIECES{SPLASH, place rainleaf, minN 3} x1 | K |
| G7 | A shower from the leaf | Tap the Drip Leaf over a squishy. | REACT{SHOWER, thing dripleaf} x1 | K |
| G8 | **When the rain stops** (finale) | Take a photo in the garden. Then three sing. | PHOTO{place rainleaf, minN 2} x1 + SOCIAL{SING, place rainleaf, minN 3} x1 | K |
| G9 | Soak it up | A foam squishy soaks up the rain. | REACT{SOAK, place rainleaf} x1 | K |
| G10 | Who loves the rain? | Find a squishy that loves it here. | DISCOVER{F1, place rainleaf} x1 | K |

Finale: keepsake **Raindrop Bead**; a **gift** (Plumpet, Glugbean or Tadpolo). Spectacle: the rain stops and the leaves drip one by one in key.

### 6.5 Fizzwell Tub: "Bath Time" (idx 50..59; opens at 36 stamps)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| T1 | Bubbles up | Go to Fizzwell Tub. | VISIT{fizzwell} x1 | K |
| T2 | One floats, one sits | See one squishy float and one sit in the bath. | REACT{FLOAT, place fizzwell} x1 + REACT{WADE, place fizzwell} x1 | K |
| T3 | Round the swirl | Ride the Swirl Ride twice. | USE{swirlride, SPIN} x2 | K |
| T4 | Fizz in the bubbles | Two squishies fizz in the Bubble Patch. | REACT{FIZZ, thing bubblepatch} x2 distinct species | K |
| T5 | Bath-time hellos | Three different pairs say hello in the bath. | SOCIAL{GREET, place fizzwell} x3 distinct pair | K |
| T6 | Bubbly bits | Cut a squishy into three in the bath. | PIECES{FLOAT or WADE, place fizzwell, minN 3} x1 | K |
| T7 | Run the tap | Tap the tap. Watch a floater drift round. | USE{tap, SWITCH, by PLAYER} x1 + REACT{DRIFT, place fizzwell} x1 | K |
| T8 | **Bubble song** (finale) | Three squishies sing in the bath. | SOCIAL{SING, place fizzwell, minN 3} x1 | K |
| T9 | Whee, soap slide | Set a squishy at the top of the Soap Slide two times. | USE{soapslide, SLIDE} x2 | K |
| T10 | Who loves the bath? | Find a squishy that loves it here. | DISCOVER{F1, place fizzwell} x1 | K |

Finale: keepsake **Bubble Ring** (no gift). Spectacle: bubbles rise in a slow column around the party.

### 6.6 Cogwhistle Bench: "Tick and Spin" (idx 60..69; opens at 45 stamps)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| W1 | Tick, tock | Go to Cogwhistle Bench. | VISIT{cogwhistle} x1 | K |
| W2 | Wind the cog | Tap the key. Then ride the cog round. | USE{windupkey, SWITCH, by PLAYER} x1 + USE{spinningcog, SPIN} x1 | K |
| W3 | Boing on the plate | Bounce on the Spring Plate three times. | USE{springplate, BOUNCE} x3 | K |
| W4 | The marble and the magnet | Tap the magnet. Watch the marble roll to it. | USE{magnet, SWITCH, by PLAYER} x1 + USE{steelmarble, ROLL} x1 | K |
| W5 | Copy me | Watch a squishy copy a friend, twice. | SOCIAL{COPY, place cogwhistle} x2 | K |
| W6 | Bits on the cog | Cut a squishy into three on the cog. | PIECES{SPIN, place cogwhistle, minN 3} x1 | K |
| W7 | Sing to the clock | Tap the Tick Clock. Two squishies sing back. | USE{tickclock, LISTEN} x2 distinct species | K ("Tap it yourself") |
| W8 | **The big machine** (finale) | A squishy rides the cog. Then a bounce and a ding. | USE{spinningcog, SPIN} x1 + USE{springplate, BOUNCE} x1 + USE{littlebell, RING} x1 | K |
| W9 | Ding | Ring the Little Bell three times. | USE{littlebell, RING} x3 | K |
| W10 | Who loves the bench? | Find a squishy that loves it here. | DISCOVER{F1, place cogwhistle} x1 | K |

Finale: keepsake **Little Brass Cog**. Spectacle: the cog, the plate and the bell play one tune together.

### 6.7 Lanternroof: "Moon and Lanterns" (idx 70..79; opens at 54 stamps)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| L1 | Up on the roof | Go to Lanternroof. | VISIT{lanternroof} x1 | K |
| L2 | Moon watchers | Two squishies gaze at the moon. | REACT{GAZE_SKY, place lanternroof} x2 distinct species | K |
| L3 | Light the lanterns | Light three different lanterns. | USE{lanternline, RING} x3 distinct part | K |
| L4 | Ride the vane | Ride the Vane Disc when the breeze turns it. | USE{vanedisc, SPIN} x1 | K |
| L5 | Hold on, breeze | Two squishies hold on in a gust. | REACT{HOLD_ON, place lanternroof} x2 distinct species | K |
| L6 | Bits in the breeze | Cut a squishy into three on the roof. | PIECES{HOLD_ON, place lanternroof, minN 3} x1 | K |
| L7 | A shooting star | Look through the Star Scope. | USE{starscope, SWITCH, by PLAYER} x1 | K |
| L8 | **Lantern song** (finale) | Three squishies sing on the roof. | SOCIAL{SING, place lanternroof, minN 3} x1 | K |
| L9 | Hammock push | A friend pushes the hammock. | SOCIAL{PUSH, thing hammock} x1 (one moment is already 3 pushes) | K |
| L10 | Who loves the night? | Find a squishy that loves it here. | DISCOVER{F1, place lanternroof} x1 | K |

Finale: keepsake **Paper Lantern**. Spectacle: the lanterns glow one by one in time with their song.

### 6.8 Echo Hollow: "Hello, Hello" (idx 80..89; opens at 63 stamps)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| E1 | Hello, hello, hello | Go to Echo Hollow. | VISIT{echohollow} x1 | K |
| E2 | Glow bath | Two squishies glow in the Glow Pool. | REACT{GLOW, thing glowpool} x2 distinct species | K |
| E3 | Crystal scale | Ring three different crystals. | USE{crystals, RING} x3 distinct part | K |
| E4 | Wake the echo | Tap the Echo Stone. | USE{echostone, SWITCH, by PLAYER} x1 | K |
| E5 | Echo talk | A squishy answers its own echo. | SOCIAL{ECHO, place echohollow} x1 (one moment is already 2 exchanges) | K |
| E6 | Glowing bits | Cut a squishy into three in the glow. | PIECES{GLOW, place echohollow, minN 3} x1 | K |
| E7 | Peekaboo by the rock | Watch two play peekaboo by the Hum Rock. | SOCIAL{PEEK, thing humrock} x1 | K |
| E8 | **Cave song** (finale) | Three squishies sing in the cave. | SOCIAL{SING, place echohollow, minN 3} x1 | K |
| E9 | Stone slide | Set a squishy at the top of the Stone Slide two times. | USE{stoneslide, SLIDE} x2 | K |
| E10 | Who loves the cave? | Find a squishy that loves it here. | DISCOVER{F1, place echohollow} x1 | K |

Finale: keepsake **Glow Crystal**. Spectacle: the crystals glow a scale as they sing.

### 6.9 Cloudloft: "Above the Clouds" (idx 90..99; opens at 72 stamps)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| U1 | Above the clouds | Go to Cloudloft. | VISIT{cloudloft} x1 | K |
| U2 | Boing on the puffs | Bounce on the Puff Pads three times. | USE{puffpads, BOUNCE} x3 | K |
| U3 | Float down slowly | Two squishies float down in the updraft. | REACT{LIFT, place cloudloft} x2 distinct species | K |
| U4 | Kite swing | A friend pushes the Kite Swing. | SOCIAL{PUSH, thing kiteswing} x1 | K |
| U5 | Bounce in turn | Watch squishies bounce one after another. | SOCIAL{COPY, thing puffpads} x1 | K |
| U6 | Bouncy bits | Cut a squishy into three on the pads. | PIECES{BOUNCE, place cloudloft, minN 3} x1 | K |
| U7 | Roll the cloud ball | Two squishies pass the Cloud Ball. | SOCIAL{PASS, thing cloudball} x1 | K |
| U8 | **Sunrise parade** (finale) | Three squishies parade under the arch. | SOCIAL{PARADE, thing sunbowarch, minN 3} x1 | K |
| U9 | Cloud nap | Two squishies nap by the Cloud Nest. | SOCIAL{PILE, thing cloudnest, minN 2} x1 (a pile counts for the nest when any napper is inside it: one curls up inside, a friend naps against it) | K |
| U10 | Who loves the sky? | Find a squishy that loves it here. | DISCOVER{F1, place cloudloft} x1 | K |

Finale: keepsake **Cloud Puff**. Spectacle: the sun rises and a soft bow of light arcs over the parade.

### 6.10 Friends Everywhere (idx 100..109; opens when 2 chapter finales are done; in an S1 build only X1, X2, X3, X6 and X10 are shown, since X4, X5, X7 and X9 need places S1 does not have and the finale X8 needs 5 shown main quests: they appear when S2 ships, D-78)

| # | Title | Hint | Rule | Keys |
|---|---|---|---|---|
| X1 | Three hellos | Three different pairs say hello. | SOCIAL{GREET} x3 distinct pair | K |
| X2 | Real friends | Two squishies become friends. | FRIEND{level FRIENDS} x1 | K |
| X3 | Best friends found | Find a pair of best friends. | DISCOVER{F3} x1 | K |
| X4 | A song in three places | Sing together in three places. | SOCIAL{SING} x3 distinct place | K |
| X5 | Little travellers | Visit three places beyond Home. | VISIT{place away} x3 distinct place | K |
| X6 | Every way is fine | Watch four kinds of squishy react to a place. | REACT{} x4 distinct family | K |
| X7 | Water, snow and fire | One squishy in water, in the cold and by a fire. | REACT{WADE or FLOAT, sameSpecies} + REACT{FROST or SHIVER, sameSpecies} + REACT{WARM, sameSpecies}, each x1 | K |
| X8 | **Picture of friends** (finale) | Take a photo of three, with best friends in it. | PHOTO{minN 3, best pair} x1 | K |
| X9 | A nap in three places | Nap piles in three different places. | SOCIAL{PILE} x3 distinct place | K |
| X10 | Wishes come true | Grant five wishes. | WISH{GRANTED, by PLAYER} x5 (a wish that came true by itself does not count: the title says the player grants them) | K |

Finale: keepsake **Friendship Frame** (a thumbnail of the X8 photo, at most 12 KB under its own key, shows in it on the Journal page:
PLAYGROUND_BUILD 11.15); a **gift** (Capnap, Kneadle or Wrigglo). X3 is reachable with the first gifts alone: Puddlo (on the Hearthlog gift list)
and Boingle (on the Ripple Shore list) are a Common best-friend pair (PLACES 5); QU-11's scripted stream uses them.

**The travel threads** (JUDGE_FUN F24) are X4, X7 and X9: each uses events that already exist.

---

## 7. The order places open, and why

| Place | Opens | Estimated (a regular player, about 25 min an active day) |
|---|---|---|
| Home | at the start | minute 0 |
| Hearthlog Cabin | when the first wish shows (whoever wishes it, LIFE 4.1; at the latest at 5:00 of play, even if no squishy could show it) | about minute 3 to 5 |
| Ripple Shore | 12 stamps | day 1, the second session |
| Frostbell Ridge | 20 | about active day 2 |
| Rainleaf Garden | 28 | about active day 3 |
| Fizzwell Tub | 36 | about active day 4 |
| Cogwhistle Bench | 45 | about active day 5 or 6 |
| Lanternroof | 54 | about active day 7 |
| Echo Hollow | 63 | about active day 8 or 9 |
| Cloudloft | 72 | about active day 10 (about two weeks of calendar time at 70% active days, DESIGN 5.12) |
| Friends Everywhere | 2 chapter finales (in S1 only its quests that S1 can complete are shown, 6.10) | about the second session |

**How the thresholds were set** (estimates, not a playtest; QU-11 replays a scripted regular-player event stream to check them): Home gives about 8
stamps in its first 5 minutes; after that a chapter's main quests come about one every 3 to 4 minutes of play, so a 25-minute active day earns about
7 stamps, and a gap of 8 to 9 stamps opens a place every 1 to 2 sessions. All 110 stamps take about 6 hours of play (about 3 weeks). **Stamps only,
no calendar gate** (JUDGE_COHERENCE M21: a daily content limit is an appointment mechanic, DESIGN 8.4); the once-a-day limit belongs to the gifts
(section 11), not to places. A place that has not shipped yet (S2, S3) is skipped; its stamps are kept and it opens the moment it ships if the count
is reached. The Places button stays hidden until a second place opens (minute 0 stays clean).

---

## 8. Wishes

| Wish | Glyph in the thought bubble | Card line (example) | Shown when | Granted when |
|---|---|---|---|---|
| a place | postcard with the place's sky band | "Puddlo wishes to visit Ripple Shore." | play > 0.8; an open place that is not here; while its favourite place is undiscovered and open, 40% of these are its favourite | it arrives there in the party |
| a kind of thing | ball, bell, droplet, note, flame or sun | "Twangle wants to play with a ball." | play > 0.8, and no such thing here or its favourite thing is here; **only a kind in the `thingKinds` mask** (kinds that stand in open, shipped places; LIFE 12), and its favourite thing only once its favourite place is open | it uses one, or reacts to one: any USE **or REACT** event whose `thing` has that kind; for a switch kind, the player switches one while it watches within 1.5 m (the F2 rule, section 9) |
| a ride | star | "Hooplet wants a ride down the Glide Ramp." | play > 0.7 next to a ride, at most one ride wish open in a place | the player sets it on that ride and it rides: its RIDE state starts on that ride (B20, LIFE 4), so the grant is by PLAYER |
| a friend | snug (the tier gem of the friend shows too) | "Crimpo wants to see Thumbly." (only species you own) | company > 0.8, and **that friend is at Friends or closer with it, or is its best friend once F3 is found** (a best friend is never wished for before its riddle is solved, so a wish never gives F3 away); the friend is on the shelf, not out | they greet or nuzzle; the grant's greet ignores S01's once-per-visit limit and gives no friendship points |
| a squeeze or a stretch | squeeze or stretch | "Glugbean wishes for a slow squeeze." | play > 0.6, its loved touch is a squeeze or a pull, at most once per 10 min | the player squeezes it for 1 s or more, or pulls it to level 0.6 or more |
| a nap | zzz | "Wisplet is sleepy." | rest > 0.8, no nap spot within 2 m | it naps (carry it to a nap spot, or wait) |
| a song | note | "Chunkle wants to sing." | chatty > 0.6, company > 0.5 | it sings with another |
| warm up or dry off | flame or sun | "Capnap wants to warm up." | frost or soak over 0.7 for 20 s | the look falls under 0.1 |

**Caps and rhythm:** at most 1 open wish per squishy, **1 wish bubble on screen** (the wish slot of LIFE 10.1; any other open wish on screen shows
only as its still dot), 3 kept in the Journal (a 4th quietly replaces the oldest); a new wish needs 180 s of play since that squishy's last one, and
120 s since any new wish on screen (QU-12, LF-14). **The first wish is scripted** (FIRST_WISH, LIFE 4.1): 60 s after the first capsule's reveal (at
the latest at 5:00 of play) **the wisher** shows a postcard of Hearthlog Cabin: Dollop if it is out; else a squishy out whose favourite place is
Hearthlog Cabin; else the party member out longest. Its card reads "{name} wishes for a warm place: Hearthlog Cabin." (for example "Dollop wishes for
a warm place: Hearthlog Cabin.") with [Let's go] and [Not now]. The scripted wish ignores the 120 s and 180 s gaps, and **no natural wish shows
before it**. If no squishy can show it by 5:00 (all held or quiet), it rests in the Journal at once ("A wish for a warm place: Hearthlog Cabin. It
can wait.") and Hearthlog opens all the same. It is granted by the **first arrival at Hearthlog Cabin with any party** (H8), whoever wished it.
**Wishes steer discovery:** while a species' favourite place or thing is undiscovered (and its place is open), 40% of its place and thing wishes
point at it. **Nothing is lost:** a wish has no visible timer; when the squishy goes back to the shelf the wish **rests** in
the Journal ("Puddlo still wishes to visit Ripple Shore. It can wait."; not "No hurry": "hurry" is a copy-gate word, M4). A wish never causes sadness and never escalates (no second, bigger bubble). A
grant gives warmth +3, fact F10, a sparkle and a happy trill; never points or a capsule. **Keyboard:** the Journal's **Wishes now** list shows every
open wish as a row with a button ("Bring Crimpo", "Go to Ripple Shore", "Set Hooplet on the ramp").

## 9. Discoveries: 12 facts per species (a 16-bit mask each, 600 dots in all)

| Bit | Fact | Journal line (example) | Found when | Hint until found (never a blank) |
|---|---|---|---|---|
| F0 | Met | "You met Puddlo." | BRING or CAPSULE or GIFT of the species | "Bring it out to meet it." |
| F1 | Favourite place | "Puddlo loves Ripple Shore." | a REACT LOVE of the species (B10 plays in its favourite place) | "Take it on a trip to find the place it loves." |
| F2 | Favourite thing | "Its favourite thing is the Rock Pool." | a USE **or REACT** event of the species whose `thing` is its favourite thing (by itself, or a ride you set up). For a switch favourite (Tap, Horseshoe Magnet, Star Scope, Echo Stone: a squishy never uses a switch, PLACES 2.1 M14), the player switches it while a squishy of that species is within 1.5 m and watching it (B13 or B18). DT-03: every favourite thing has such an event | "Watch what it plays with in the place it loves." |
| F3 | Best friend | "Its best friend is Boingle." | the authored pair greets for the first time | "Its best friend loves Frostbell Ridge." (the friend's favourite place), **only while that place has shipped**; otherwise "Its best friend is a {family name} squishy." (for example "Its best friend is a Jelly Gel squishy."; the names of `MATERIAL_FAMILIES`) |
| F4 | Water way | "In water, Puddlo wades and sloshes." (the family's line) | a REACT FLOAT, WADE, SOAK or SPLASH of the species | "Find out what it does in water." |
| F5 | Warm way | "By the fire, it relaxes a little flatter." | a REACT WARM, TOAST, RISE or OOZE | "Find out what it does by something warm." |
| F6 | Cold way | "In the cold, it shivers." | a REACT FROST, SHIVER, SNOWCAP or HOLD_ON | "Find out what it does in the cold." |
| F7 | Ground way | "On ice, it glides a long way." | a REACT GLIDE or PRINT | "Find out what it does on ice or snow." |
| F8 | Its song | "Puddlo's song" with a play button (its motif) | it sings with another (SOCIAL SING with it) | "Let it sing with friends." |
| F9 | Loved touch | "It loves a poke." | SIGNATURE | "Try a squeeze, a stretch or a poke." |
| F10 | Its wish | "It wished to visit Ripple Shore." | a WISH GRANTED for it | "Grant one of its wishes." |
| F11 | Twin dance | "Two Puddlos dance alike!" | SOCIAL MIRROR (two of the same species) | "Bring out two Puddlos." (the species' own name, as in the found line: "kind" means a family in every player line, 6) |

A page with F0 to F10 gets a **gold edge**; F11 adds a small twin mark (it needs a second copy, so repeats are never flat: JUDGE_FUN B best idea 4).
Facts belong to the species, so merging copies away never loses a fact. The hints name places and species, which gives trading a reason later
("Its best friend is Slumbrel"), and Journal progress itself is never traded or shown to anyone.

## 10. Keepsakes (20; a 32-bit set; procedural little objects on the Home shelf, each with its own small sound)

| Bit | Keepsake | Found by |
|---|---|---|
| 0 | Felt Star | the Home finale |
| 1 | Ember Pinecone | the Hearthlog finale |
| 2 | Sea-glass Pebble | the Ripple Shore finale |
| 3 | Tiny Frost Bell | the Frostbell Ridge finale |
| 4 | Raindrop Bead | the Rainleaf Garden finale |
| 5 | Bubble Ring | the Fizzwell Tub finale |
| 6 | Little Brass Cog | the Cogwhistle Bench finale |
| 7 | Paper Lantern | the Lanternroof finale |
| 8 | Glow Crystal | the Echo Hollow finale |
| 9 | Cloud Puff | the Cloudloft finale |
| 10 | Friendship Frame | the Friends Everywhere finale |
| 11 | Pair Charm | your first best-friend pair found (F3) |
| 12 | Friendship Ribbon | your first pair of Close friends |
| 13 | Ribbon Garland | five pairs of Close friends |
| 14 | Songbook | a song together in five places |
| 15 | Wish Jar | ten wishes come true |
| 16 | Little Button | five gold-edged pages |
| 17 | Thimble | fifteen gold-edged pages |
| 18 | Pocket Map | a visit to every place |
| 19 | Friends Quilt | all 25 best-friend pairs found (a long goal that trading helps with; no economy change) |

No keepsake is named for hearts (the Hoard's Heart is the protection mark; the proposals' "Twin Hearts" and "Big Heart Quilt" became the Pair Charm
and the Friends Quilt). Unfound keepsakes show as dashed outlines with their "found by" line as the hint.

---

## 11. Rewards, and the proof that the economy pace holds

| Reward | Touches the economy? | Bound | Effect on the tested pace |
|---|---|---|---|
| squish points from the Journal or LIFE | **no**: `src/core/quests.ts` imports no meter function (QU-01); LIFE has no press, grab or lock intent (L3) | 0 | none |
| capsules from the Journal | **no** | 0 | none |
| **gift squishies** (one chosen from a fixed, shown list of 3 at five finales) | yes, items | **5 for life**, Common or Uncommon only, **at most 1 per UTC day** (enforced in the claim), only after the Home finale (H8), Practice shelf only | below |
| stamps, keepsakes, facts, warmth, friendship, places | no (looks, behaviour, content) | | none |
| daily tasks and the Restock | unchanged (2 tasks a day, 5 a week; one pick a day) | | none |

**The pace (active minutes per capsule) cannot move:** it is a property of the meter alone (`src/core/meter.ts`), and nothing new feeds the meter
except the player's own touches at today's pay (the valve of 40 SP a minute and the daily cap of 12 still bound everything). The gate stays as it is:
paying styles at 3.0 to 3.8 active minutes a capsule (probe_economy), measured 3.3 / 3.5 / 3.7 for squeezer / puller / mixed and 3.2 for the holder
(DESIGN 5.4); MERGE_COST stays 2 (it flips only near 1.5 minutes). The Journal grants **no capsules**, which removes the week-1 pace problem of the
capsule designs (11 capsules would have put the fastest style near 2.7 to 2.9 minutes a capsule in week 1, JUDGE_COHERENCE 1.2).

**The gifts, in numbers** (the arithmetic of proposal B 7.12, extended to 5): a regular player gets about 6.0 play capsules per active day (DESIGN 5.4,
sim C) plus a restock pick and the weekly task capsules, so about 5.6 items a calendar day and about 168 by day 30: five gifts are 3% of the items
at day 30. A specific Common arrives on its own in about 2.9 days (capsule odds plus the restock), a specific Uncommon in about 5.9, so even five
Uncommon picks save at most about 30 species-days on rows that finish by day 9 (Commons) and 19 (Uncommons) anyway. The all-50 day (247 solo / 153
with trade, DESIGN 5.4) is bound by the Legendary and Mythic rows, which gifts never touch: it moves by less than one day (estimate; EC-04 re-quotes
section K once, a heavy job). Five extra items allow at most 2 extra merges for life (Common or Uncommon tickets).

**How a gift is granted (exactly once, across reloads, two tabs and older builds; JUDGE_COHERENCE M2, JUDGE_FEASIBILITY F14):**
1. The journal writes `gift[chapter] = pending` with the picked species, unthrottled, at once.
2. The collection adds the gift's ghost row through a new `ghostGrantGift(save, chapter, pick, ctx)` in `src/collection/ghost.ts`: origin
   **`'restock'`** (an existing code, `store.ts` 50: a new code would make every older build drop the row, `store.ts` 96), the genome from
   `speciesBaseGenome(pick, seed)` with seed = `hashString(deviceId + ':gift:' + chapter)` (no roll), and the **deterministic item id**
   `'jg-' + deviceId + '-' + chapter` (at most 46 characters, inside `ID_PATTERN` `^[A-Za-z0-9_-]{1,64}$`, constants.ts 45). If a row with that id
   already exists (`hasId`), it does nothing and reports success. **Step 2 is a verified write** (D-71): after adding the row the claim calls the
   hoard store's `flush()` (store.ts 592) and goes on only when `report().save === 'ok'` and the row's id is in the stored text. Today's grants only
   call `markDirty()` (index.ts 121), which waits up to 2000 ms (`SAVE_THROTTLE_MS`, constants.ts 29) and never writes on a quota failure (store.ts
   557), so without the check a crash could leave `granted` with no row. If the check fails, the gift stays `pending` ("Your gift will wait here.")
   and the claim tries again on the next load or claim.
3. The journal writes `gift[chapter] = granted`, unthrottled.
On load: a `pending` gift whose id is on the shelf, or named as a parent of a blend row, is marked granted; otherwise steps 2 and 3 run again. Older
builds never read the journal key and keep the ghost row (`sanitizeRow` keeps any valid id with origin 'restock'), so a rollback cannot double it. At
the shelf cap (GHOST_CAP 100) the claim refuses and the gift keeps waiting: "Your shelf is full. Your gift will wait here." A second gift on the same
UTC day waits too: "One gift a day. This one will wait for you." A signed-in ledger sees "Your gift will wait here for now." with no Yes button
until the server op exists (PLAYGROUND_BUILD T8; CO-09). The Hoard shows **"Gift"** as the origin of a `jg-` id (copy.ts 202-203 would say
"Restock"); the stored origin stays `'restock'`. A load never turns a granted gift back to pending: a blend row keeps only its own parents' ids
(store.ts 101, 110), so a gift merged twice leaves no trace of its id, and a revert would grant it again (PLAYGROUND_BUILD 23). (CO-05, CO-09, CS-03.)

## 12. The dark-pattern audit (a checked table: CS-04, QU-10, LF-13)

| Pattern | Here? | Why not |
|---|---|---|
| streaks, daily login rewards | no | no day counter anywhere in the Journal; the restock and tasks keep their "never accumulate guilt" rule (DESIGN 8.4) |
| countdowns, limited-time quests, fear of missing out | no | every quest, wish and keepsake is permanent; no wish shows a timer; places open by stamps only |
| loss, decay, neglect | no | needs reset when a squishy comes out; warmth and friendship never fall; a merge keeps the larger warmth; nothing can be failed |
| guilt copy | no | the copy gate words (Q10); a huff is about the ball or a seat, never the player, and lasts at most 3 s |
| sulks caused by the player | no | the huff trigger table holds squishy-to-squishy scene events only (LF-13); no "hold me after 3 minutes"; no sadness at an unanswered wish |
| random rewards for finishing a set | no | gifts are chosen from fixed, shown lists; keepsakes are fixed |
| nags and notifications | no | no push; one small dot on the Journal button for something new, never a number; a wish re-glances at most twice |
| variable rewards to keep tapping | no | wishes are spaced (120 to 180 s), capped and never paid; taps pay nothing |
| social pressure between players | no | friendship is between squishies only; Journal progress is never shown to anyone |
| grind | no | at most 3 of one deed in a main quest, 5 in a bonus; all 110 quests in about 6 hours |
| idle income | no | autonomy pays 0 (EC-02, LIFE L3) |
| a file download to finish a quest | no | a photo counts when the shutter is pressed and the in-page preview shows; saving it is optional (Q8) |
| a quest locked behind a setting | no | with autonomy off, quests that need a squishy to act on its own show "Needs: Squishies move on their own" and nothing else is locked; the player-asked ways ("Go play with...", the rides the player sets up) still count (LIFE 5.6) |

---

## 13. The first ten minutes (a new player; economy times from DESIGN 5.4: first capsule about 77 s, ramp 30 / 50 / 75 SP)

| Time | What happens | Quests |
|---|---|---|
| 0:00 | Title, "Wake it up". Dollop on the felt at Home with the Felt Ball beside it. Home's other things appear one by one, each at its arrival event and only once its spot is inside the visible table (PLACES 4.1, PLAYGROUND_BUILD 11.13), so with one squishy on a phone the Music Box may wait for a wider view. Until the life chunk lands (about the first seconds of play, 11.14) Home is today's toy. The tracker pill: "A gentle squeeze". The hint says "Hold to squeeze". | |
| 0:05 to 0:40 | A held squeeze: the first stamp lands ("New stamp: A gentle squeeze"). | H1 |
| 0:40 | **The first minute (FN-01):** the player lets go for 6 s; the shell sends LIFE the FIRST_PLAY script (LIFE.md 4.1). Within 10 s Dollop looks at the Felt Ball (a question bubble with the word "curious"), hops three small hops to it and boops it; the ball rolls at least 0.2 m; a sparkle. If the player never pauses, Dollop does it during the first capsule's wait. | H2 |
| about 1:00 | A stretch and let go (touch or mouse; keyboard players skip it). | H3 |
| 1:17 | The meter fills; the capsule drops (built). | |
| 1:30 | Open it. **The newcomer stays out** (a new rule: a new squishy comes out to say hello when the party has room). Its shy arrival: it keeps a little distance and looks down between glances, but says hello within 5 s (B09's rule for every NEW squishy, LIFE.md 4: that hello is an S01 greet with Dollop, whatever the distance): a hello hop from Dollop, a call and a mirrored answer, the word "hello" under the bubble. The Snooze Rug arrives. | H4, H5 |
| 2:00 to 3:00 | Free play. They play by themselves between touches. If no bubble was tapped after 2 minutes, the tracker says "Tap a bubble". The Warm Lamp arrives (after the first capsule). | H6 |
| about 2:30 to 5:00 | 60 s after the first reveal (5:00 at the latest), the wisher faces you with a postcard thought bubble: Dollop if it is out, else a cabin fan, else the squishy out longest (LIFE 4.1); no other wish shows before it. Tap it: "Dollop wishes for a warm place: Hearthlog Cabin." [Let's go] [Not now]. Hearthlog opens; the Places button appears with one 400 ms scale-in (no pulse; Calm or reduced motion: a fade). "Not now" leaves the wish resting in the Journal. If nobody can show it by 5:00, it rests in the Journal at once and Hearthlog opens all the same. | H7 |
| about 3:30 to 5:30 | Travel (the party comes along; a 0.6 s snapshot crossfade; the place's data and chunk were prefetched when it opened; a portrait phone gets the tall layout, PLACES 4.2). Arrival hops, one shared sparkle. The wish comes true on the first arrival, whoever is in the party: the **Home finale** (Felt Star; "A wish came true!"). Dollop's love moment, if Dollop came: "Dollop loves Hearthlog Cabin." | H8, C1, C10 |
| 5:30 to 7:00 | Dollop and the newcomer walk to the fireplace (flame bubbles); a marshmallow would toast golden and hop back from the heat. The yarn ball rolls; the player flicks it and they chase it. The second capsule (50 SP) around now. | C2, C4 |
| 7:00 to 8:30 | The kettle whistles by itself (one short bar, PLACES 4.2); the chatty one answers it. The player sets the two on the Rocker Board: they stay on for their ride (RIDE, LIFE B20) and teeter. | C7, C5 |
| 8:30 to 10:00 | The third capsule (75 SP) opens on the cabin's pad; three squishies now. Energy is lower: one curls up in the Snug Basket and a friend naps against it. The tracker suggests "Fireside song" once 5 main quests are done. | (C3, C8 next) |

About 10 stamps in 10 minutes, one every minute at first, then slower. **Existing players** (a `bf` backfill, once, from the Hoard): F0 for every
owned species; H1, H3 and H4 done when the shelf shows they were done (opened at least one capsule, owns two or more); the first-wish script still
runs, 60 s into the first session with the Journal, so everyone gets the first trip, and its wisher rule means a save without a Dollop still gets
it (LIFE 4.1, QU-15). Returning players never redo onboarding they already did (CO-04). A capsule reveal is not "coming out": needs and looks
are kept through it (LIFE 3), so the 8:30 reveal does not undo the sleepy cabin of the last row, and a toasted marshmallow stays golden.

## 14. Day 2, day 7, day 30 (a regular player; estimates)

| Day | Where they are | What pulls them back (nothing pushes) |
|---|---|---|
| 1 | Home done; Hearthlog half to all done; Ripple Shore open by the second session; about 5 species; 8 to 15 facts; the first gift picked | an open wish resting in the Journal; a half-explored place |
| 2 | Ripple Shore's finale (the sunset, the second gift); Frostbell open; the first best-friend pair likely (Glugbean and Thumbly, or Dollop and Crimpo) | the Journal opens where they left it; the daily Restock and tasks as today |
| 7 | 6 or 7 places open; about 55 stamps; about 20 species (DESIGN 5.9 week 1 mean 20.1); 80 to 120 facts; 3 to 6 best-friend pairs found; 7 to 10 keepsakes; 4 gifts | new species open new pages; wishes point at undiscovered favourites; Close friends pairs and their twirls |
| 30 | every place open; 90 to 110 stamps; about 35 species (week 4 mean 34.7); about 250 of 600 facts; 10 to 14 best-friend pairs; 15 to 18 keepsakes; gold-edged pages | every capsule is "a new page" or "a twin for a dance"; merges bring pages; the last Mythic pages and the Friends Quilt ride the collection's own arc (247 / 153 days) |

---

## 15. The screens (built on the UI overhaul's tokens and components, `theme.ts` and `h()`, through the CSSOM only; UI.md bar)

**Phone, 390 x 844** (S = the safe-area top inset; the free HUD space is the top row between the wordmark and the buttons, and the right edge under
the top bar, SHELL map 3):

| Element | Position | Size | Behaviour |
|---|---|---|---|
| Journal button | x 330, y S+60 | 44 x 44 | book icon; one 6 px amber dot when something is new (a gift, an unseen fact, a keepsake), never a number; its accessible name is "Journal" and becomes **"Journal, something new"** while the dot shows |
| Places button | x 330, y S+112 | 44 x 44 | signpost icon; **hidden until a second place opens**, then one 400 ms scale-in (Calm or reduced motion: a fade); the live line "Hearthlog Cabin is open. Find it in Places." |
| Quest pill (the tracker) | x 16, y S+64, right edge at most 318 | 36 tall with a 44 px hit area; width 120..302 | chapter icon and the title (15 px, truncated with an ellipsis, never wrapped) of **the first unfinished main quest that can be done now** (SH-20): of this place's chapter, then Home's, then Friends Everywhere's; never a hidden quest, one blocked by autonomy off, or (when the last input was a key) one without K; "2 of 3" for counts; tap = the Journal at that quest; fades out while the reveal plate or a quest moment uses the plate slot |
| Wish card | the plate slot (top +70) | `min(358px, 100vw - 32px)` wide; one or two lines, at most 120 px tall | the species' tier gem and colour, one sentence that names the target, two 44 px buttons ("Let's go", "Not now", "Bring Crimpo") |
| Bubble hit areas and word labels | over the 3D bubbles | 44 x 44 / one word | DOM placed from `emoteScreen` every 250 ms, slid clear of the capsule; never over the body's silhouette; `tabindex="-1"` (they move and must never hold focus; the keyboard reads bubbles through Enter, below) |

The shell reports a top inset of S+104 and a right inset of 60 px (`setSafeInsets`), so the capsule lands clear. **At 320 x 568** the pill is at
most 236 px (icon + "2/3" when it must) and the button column moves to x 260. Every new element joins the Snap hide list and `.hud-top`, and every
new colour pair joins `CONTRAST_PAIRS`.

**Desktop, 1280 x 800:** the top-right cluster holds Journal, Places, mute and gear (4 x 44, 8 px gaps, labels on hover and focus: "Journal (J)",
"Places (P)"); the pill at x 24, y 72, at most 360 px wide, 40 tall, "Next: Chase the yarn".

**Landscape phones, 844 x 390 and 568 x 320** (UI.md 3 covers both orientations): the button column stays at the right edge under the top bar;
the plate and the wish card sit in the **left half, under the pill**, so neither covers the party or the capsule; the Journal and Travel sheets
use the full height with their grids taking columns from the width; every target stays at least 44 px (SH-15). A landscape frame uses the place's
wide layout (aspect 0.9 or more, PLACES P7).

**The Journal.** Phone: a full sheet (the Hoard's sheet pattern, z through the tokens, `suspend('covered')`); a 44 px segmented control: **Stamps |
Squishies | Friends | Keepsakes** ("Quests" is a hard word for a seven-year-old). *Stamps:* a **Wishes now** card at the top (each open wish as a 56 px
row with its action button); chapter cards (an 8 px strip in the place's colours, the name, "6 of 10"); quest rows 56 px (a stamp circle, the title
16 px, the hint 13 px dim, "2 of 3" in tabular numerals; a thin bar for counts); bonus quests under a thin rule; locked chapters collapse to one line
("Opens at 28 stamps", shown as stamps, never a countdown). *Squishies:* a grid of tiles (columns from the width: 5 at 390 px, 4 at 320 px), each with
the species icon, its **family name** (the Hoard's words, `MATERIAL_FAMILIES[f].name`, D-82) and a ring of 12 dots; unowned species show a dim
silhouette as the Hoard does; a page shows the icon, name, family name, the two trait words, the 12 fact rows (each its line or its hint),
friends, warmth as glow dots and the play button of its song. *Friends:* 56 px rows (two icons, two
names, the level word, Met / Friends / Close friends, a "Best friends" tag; no hearts). *Keepsakes:* a grid of 80 px cells (columns from the width).
Desktop: a centred two-page book 960 x 600 with `holdInput('journal')`; the squishies keep living behind a 60% scrim. The Journal and its text are a
lazy chunk loaded on first open.

**The quest-complete moment.** The plate slot (top +70, centred, `min(320px, 100vw - 32px)` wide), 2.4 s (reading time), a stamp shape springs in
(scale 0.6 to 1 in 220 ms; Calm or reduced motion: a fade), **"New stamp: Chase the yarn"**, "4 of 10" on the right; one soft procedural stamp
sound in D. **Who it belongs to** (PLAYGROUND_BUILD D-84): when the ring record that completed the quest is by PLAYER, the stamp sound is a
player-caused UI sound (it may use `registerFx`) and one 10 ms haptic tick plays; when it is by SELF (a squishy did it on its own), the same sound
plays as an `auto` UI sound and **no haptic**. Queued like a ceremony: never within 1 s of a burst, never over a reveal, at most 3 in the queue at
least 2.6 s apart (more become **"3 new stamps"**); one line in the polite live region ("New stamp: Chase the yarn."). **Chapter done:** the same
slot, 4 s, two lines and a 44 px "See your gift" button. **Facts:** no plate (they are frequent): a sparkle on the squishy, the Journal dot, and at
most one live line every 10 s ("New: Puddlo loves Ripple Shore."). **Keepsake found:** the plate, 2.4 s, "Found: Sea-glass Pebble"; at the finale
the keepsake drops beside the party like a capsule (Calm or reduced motion: a fade) and later stands on the Home shelf.

**The polite live region** is one queue (SH-16): quest and wish lines first, then facts, place lines and bubble readings; at least 2 s between
lines. The place lines are "Hearthlog Cabin is open. Find it in Places." when a place opens and "You are at Hearthlog Cabin." on arrival.

**The gift card** (in the Journal): three species tiles (icon, name, family name, "New" when you have none, "Dollop's best friend" when true;
columns from the width, one column at 320 px), the list's line ("All three love Ripple Shore."; **while the named place has not shipped, "Three
new friends for you."** instead, PLACES 5), then "Bring Puddlo home?" with [Yes] and [Not yet] (the gift waits for ever). On a signed-in ledger
the card shows "Your gift will wait here for now." with no Yes button (section 11).

**Travel ("Places").** Phone: a full-height sheet (`suspend('covered')`); desktop: a centred panel 760 x 560 (`holdInput('travel')`); it opens only
when idle (never during a ceremony). A grid of **postcards** (2 columns at 390 px, 1 column at 320 px, 3 on a desktop): a CSS gradient of the place's
sky, its name, "3 of yours love it" (counted from known F1 facts only), "6 of 10 stamps" or, for a closed place, "Opens at 28 stamps"; "Here" on the
current one; a place with `shipped: false` is not shown at all (no "coming soon" card). Under the grid, **"Who's coming?"**: 56 px chips of the party (gem, colour, name under), up to the tier's whole cap, the current party
preselected, and "Change" (a shelf picker). One primary button, "Go to Ripple Shore". Going: `leaving()` (reconnect a cut, release locks), the
snapshot crossfade (0.6 s, never a flash), the prefetched data and chunk, the layout for the frame (aspect under 0.9: the tall layout, PLACES P7),
the party at its spawn spots, the ambience crossfade (2 s); after 300 ms of loading, "Packing up..."; a load failure keeps you where you were:
"Ripple Shore did not load. Try again." On arrival the live line "You are at Ripple Shore."

**Settings** (two new rows in each existing group; `SETTINGS_VERSION` 3, PLAYGROUND_BUILD 11.9): Sound: **"Voices"** (a slider, default 60%),
**"Place sounds"** (a slider, default 50%). Play: **"Squishies move on their own"** (a switch, default on; help line "When off, they stay where you
put them. They still look around and chirp, and play when you ask.", the same words as LIFE 5.6) and **"Words under bubbles"** (a switch, default
off). **The Snap bar** (PLAYGROUND_BUILD 11.15): a **shutter** button that takes the photo and shows it in the page (a small preview with
**"Save"**, optional, and "Close"); the photo counts for the Journal at the shutter (Q8); **"Bubbles in photo"** (on) and **"Pose!"**.

**Keyboard** (when shortcuts are on; the same model as PLAYGROUND_BUILD 11.8): **J** the Journal, **P** Places (both free today: keyboard.ts uses
Space, Enter, Escape, [ ] T C H G M, the arrows, + and -). **Tab stays the browser's**: it always reaches the Journal, Places, mute and gear buttons
and can leave the party. **The party is one Tab stop**: a toolbar of one focus proxy per party member (roving tabindex, each named like "Dollop,
Jelly Gel"), inside which [ and ] move the focus (the arrows stay the camera; with one character out, [ ] switch squishy as today); the focused
squishy shows a ring under it and its name tag. **Space presses the focused squishy** instead of the screen centre; hold Space, then an arrow pulls
it to that side (the keyboard stretch), released with Space. **Enter** on the focused squishy opens its wish card when it has a wish, otherwise its
name tag popover; either way a bubble showing over it then is read into the live region ("Hello!") and counts as tapping that bubble (H6). The
popover has **"Go play with..."** (floor things ask LIFE for that use, which also works with autonomy off; rides perform a scripted lift onto them,
`carryTo`, which never pays) and **"Tap it yourself"** (every switch and ball in the place, the same path as a tap: "Tap the fireplace", "Roll the
Felt Ball"). Escape order: tray, Settings, Journal, Places, Hoard, tool, plate, then locks (LOCK 3); focus returns to the opener.

## 16. Not checked

No timing here is measured: the minute-by-minute table and the day 2 / 7 / 30 table are estimates from DESIGN 5.4, 5.9 and 5.12 (QU-11 replays a
scripted stream; a real playtest is the verifiers' FN-01 and FN-06). The 390 x 844 positions are taken from the SHELL map and proposal B and must be
re-laid on the UI overhaul's components; the landscape rows (844 x 390, 568 x 320) are rules, not measured positions. I ran the name gate on every
name, title and hint of this page (PLAYGROUND_BUILD.md 20). **Revision 3:** I re-screened every new or changed title, hint and line (the retitled
quests, the wish and gift lines, the live lines, the settings help line, "New stamp", the F3 and F11 hints) with the same gate code; I did not
re-time the first ten minutes, run QU-09 or QU-15, or check the Friends Everywhere split against a real S1 shipped set (QU-14 will).
