# PG_SHELL running report (SHELL lane for PLAYGROUND: the LIFE host, the party, the Journal, Travel, the chunk names, the checks)

Brief: `_handoff/briefs/PG_SHELL.md` (revision 4 + the owner's D-95 notes). Port 5366 (prod-build checks on 5367 only when free).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_shell/`. No git write command is ever run.
There was no earlier PG_SHELL report: rounds 1 and 2 never started the shell lane (the shell was frozen while the PC line was unmerged).

# Round 3 (2026-11-17, HEAD 4f4c35d4b: the merge 5ac76e503 of the PUBLISHED PC line and the PLAYGROUND lanes, plus round-3 lane work)

Scope of this run (orchestrator): wire PLAYGROUND into the PUBLISHED shell so it is playable: S0 "Life at Home", then S1 "Hearthlog Cabin":
(1) the LIFE host (lazy life chunk, snapshot, intents through PG_PHYS / PG_RENDER / PG_AUDIO, touch gate, attention, autonomy + Voices + Place
sounds settings, quiet under a non-Hand tool, cut pieces as groups); (2) the party (2 to 5 out at Home through the Hoard, the PC's multi-body
mat); (3) the Journal (dock entry, later-* panel: quests, facts, wishes, keepsakes, gift card; fed by collection.feedPlay; the first wish);
(4) Travel (dock entry, place picker, fade, loadPlace / setPlace / setPlayBounds, ambience, music style, props bound to render); (5) vite.config.ts
chunk names for G0 / G0b; (6) checks, one browser run of the published-feature sections, a scripted playthrough with screenshots.
Files: `src/shell/**`, `src/ui/**`, `src/input/**`, `vite.config.ts`, `src/core/settings.ts`, the Settings members of `src/contracts.ts`,
`_harness/shellview/node_checks.ts`, `_harness/probe_app.ts`, my own scratch scripts. Never `src/physics` (fallbacks are marked FALLBACK).

## 0. State found at the start (02:00 UTC)
- No round-3 shell edit existed: `git diff --stat 5ac76e503 HEAD -- src/shell src/ui src/input vite.config.ts` is empty; no PG_SHELL report.
- `src/shell`, `src/ui`, `src/input` are the PC's published files byte for byte (MERGE_PC.md). PLAYGROUND's stage, audio, physics, life, data and
  collection members exist but nothing in the shell calls them (PG_RENDER E1: 0 calls of the 19 stage members).
- PG_PHYS round 3 NOT BUILT (its report section 6) and therefore FALLBACKS here: `SoftEvent.auto` / `prop` / `other`, `mods`, `setBounds` /
  `setHome`, the 32-slot `contactSlot` bump memory and `metrics.contacts`, `carryTo`. Built and used: `scootTo`, `hop`, `setSquash`,
  `sleepEnabled`, `sleep()`, `wake()`, `contactSlot` (field), `setPropWorld`, `buildPropWorld`, `setParked`, `setBallBounds`, `drainStrikes`.

## 1. Baseline (this machine, HEAD 4f4c35d4b with the QUESTS lane's 3 uncommitted harness edits; one probe at a time)
| check | result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | exit 0 (2.2 s) |
| probe_app | 183/183 |
| probe_gestures | 160/160 |
| probe_merge | 22/22 |
| probe_collection | 73/74 on 2 of 4 runs, 74/74 on the others: C08 (previewTouch allocation, 160 000 B / 20 000 calls) is FLAKY at HEAD (known: STATUS, PG_QUESTS) |
| shellview/node_checks | 130/130 |
| probe_economy | all passed |
| probe_catalog | all passed |
| probe_life | 95 ok, 1 fail (LF-02, PG_LIFE's) |
| probe_chatter | 42/42 |
| renderview/pg_node_checks | 40 ok, 0 FAIL (the brief's "35" grew with PG_RENDER's rows) |

## Steps (updated after every finished step)
| step | what | state |
|---|---|---|
| 0 | read brief, SESSION3, MERGE_PC (doubts), STATUS, PLAYGROUND_BUILD 4/11/13/14.3/15, every PG_* report's requests to PG_SHELL, the PC shell / UI / input code, vite.config.ts | DONE 02:20 |
| 1 | baseline | DONE 02:25 (table above) |
| 2 | settings v3 (PLAYGROUND_BUILD 11.9): `Settings.chatter` / `ambience` / `autonomy` in the contract's PLAYGROUND block + `src/core/settings.ts` (SETTINGS_VERSION 3, keys, defaults 0.6 / 0.5 / true, by absence) + `settingsCtl.ts` (chatter and ambience in the ONE existing `audio.setSettings` call, so no call count changes) + rows "Voices" (wh-chatter), "Place sounds" (wh-ambience) in Sound and "Squishies move on their own" (wh-autonomy, the spec's help line) first in Other | DONE 02:50: tsc 0; node_checks **136/136** (130 + 6 new); probe_app 183/183; probe_screens 43/43 |

### Step 2 notes (settings)
- **Only three of the five PLAYGROUND settings landed**: `bubbleWords` and `bubblesInPhoto` wait for the word labels and the Snap shutter, which this run does not build. Adding them later needs no version bump (v 3 already carries a newer blob's keys). Said in the contract's comment.
- **Re-specified rows (written reason: PLAYGROUND_BUILD 11.9 raises the format to v 3 so the PUBLISHED v2 build carries the new keys instead of erasing them; same rule, the build's own number)**: node_checks "migration: the first save writes v: 2" -> v: 3; node_checks "a blob from a NEWER build (v: 3)" -> v: 4 (v 3 is this build's own format now); browser_shell.mjs the same three rows (lines ~837, ~3815, ~3822); probe_screens' pinned Sound / Other row lists gain wh-chatter, wh-ambience and wh-autonomy (every PC row keeps its id, order and group).
- New node_checks rows: the defaults; a v2 blob reads as v3; a v3 save round-trips Voices 0.25 / Place sounds 0 / autonomy off; a hostile blob; **the rollback row**: the published v2 settings code (frozen verbatim in `_harness/shellview/settings_v2_frozen.ts`, only its imports and the v2 Settings type changed) saving over our v3 blob carries all three keys and keeps v 3; live application (setSettings gets chatter / ambience, autonomy makes no audio call).
| 3 | the LIFE host (`src/shell/later-life.ts`, the life chunk's facade) + the first-load seam (`src/shell/lifeLink.ts`: the host interface and the early log) + game.ts's three simStep lines (act before bodies.step, sense after drain, quest after the ceremonies; never onStep hooks, D-58) + the boot loader (after the first frame of play, retries at 3 s x tries, never breaks play) + the dev hook's `life()`, `quests()`, `travel()` | DONE 04:10: tsc 0; scratch FN-01-style run on the REAL SoftBody (below) |
| 4 | the Journal and Places dock entries (dock Collection group, beside the Hoard; hidden until the life chunk lands; Places once a second place is open) + `src/ui/later-journal.ts` (Journal: Stamps with Wishes now and the gift card, Squishies with family names, Friends, Keepsakes; Travel: postcards, "Opens at N stamps", the unshipped eight as "coming later" because their data says shipped: false) + `src/ui/journal.css` + `src/ui/wishes.ts` (44 px bubble hit areas, life chunk) + a `map` icon | DONE 04:30 (tsc 0); browser not yet run |
| 5 | vite.config.ts: later-* names for the away chunk, the per-place chunks (render, audio, data), the stage's lazy `lifelook` and shared lazy-only chunks; the HONESTY CHECK (a build fails when a chunk G0b counts statically imports a later-* chunk) | DONE 04:40: one build, numbers below |

### Step 3 notes: what the host does (and the FALLBACKS for what PG_PHYS did not build)
- Characters by stable slot (0..15): the play body, the squishies brought out (the PC's mat: `mat.add`, shared bodies with contact) and the cut's pieces (the play body = the face piece, the other pieces chunks, group = the whole's old slot, as PG_LIFE's step.ts header asks). The registry re-syncs only when the bodies on the mat change (an O(n) check per frame, no allocation). `contactSlot` = the slot.
- Snapshot filled in place each frame (rows = slots): centre and velocity (from centre deltas), screen position (`stage.bodyScreenPoint`), flags from metrics (TOUCHED, CARRIED, LOCKED, ASLEEP, GROUNDED, ON_PROP, AIRBORNE, TOSSED, VISIBLE, MEMORY_BUSY, RIDE 20 s on a ride prop), zones and patches from the PlaceDef in the layout in use (Home's in slot units x bodyScale), the things out now (Home: only arrived ones) with their prop poses, touch kinds from the player's events (POKE, SQUEEZE / SQUEEZE_1S, STRETCH / STRETCH_06, CARRY, TOSS / TOSS_HARD), units (awake whole 1, piece 0.22, sleeper 0.03, a touching pair 0.25), music on, the 66 BPM beat phase on sim time (never musicClock), quiet (a sheet open, travel, a non-Hand tool, the cut busy, a ceremony, input not live, a hidden tab), autonomy from Settings.
- Intents through the one arbiter: SCOOT -> `scootTo` only (never moveTo); HOP with its anticipation squash 0.12 s before the impulse; SQUASH -> `setSquash`; POSE / GAZE / EXPRESS -> the stage; EMOTE -> 8 stage bubble slots (one say and one wish per character; say 2 s; a wish dot = flags bit 1); VOICE -> `lifePhrase` + `audio.creature` (flavour by family, pitch x popSize for pieces, pan / level from the screen, `sing` for SING and DUET; `at` = 0, NOT yet mapped onto musicClock's eighth); CANCEL drops the character's queue; delayed intents wait in a typed-array queue.
- LIFE's events -> the play-event ring by the PG_LIFE / PG_QUESTS conventions (a grant greet thing -2 -> v -1; WISH SHOWN with lifeWishOf's kind and target; the 5:00 backstop's WISH SHOWN a = 255; GRANTED of a FRIEND / PLACE / RIDE / TOUCH wish by PLAYER; flag bit 3 while autonomy is off; PIECES flag). Shell producers: TOUCH squeeze (>= 0.4 s, v = hold s) and stretch (v = pull level), CAPSULE (a capsule ceremony's end), VISIT (travel, by PLAYER), UI JOURNAL / TRAVEL (a sheet opened), UI EMOTE_TAP and WISH SEEN (a bubble tapped), USE by a body's strike of a chime (props). The ring (64) drains once a frame into `collection.feedPlay`; the journal is `attachJournal(game.hoard)` (the trophies' observing wrapper passes it through, PG_QUESTS CO-12).
- Journal -> LIFE: `lifeSetJournal` (owned species, open places, known favourites from facts F1 / F2, the open places' thing kinds) at attach and on every quest / unlock event; `lifeSetFriends` for every owned species (and on FRIEND >= 2 and F3); `lifeSetPair` for every pair out at each party change and on FRIEND events; `lifeSetHops(w, 0)` (S1).
- Scripts: FIRST_PLAY 6 s after the player first lets go of the play squishy on a fresh profile (latched at attach: the first stamp lands during it); FIRST_WISH 60 s after the first capsule reveal, else at 5:00 (the backstop arg), wisher by D-70 (Dollop, else a Hearthlog fan, else out longest).
- Home (D-67, D-88): `buildPropWorld(HOME, frame, bodyScale)` (bodyScale from `stage.matLayout`), every thing parked, then shown by its event (ball and Music Box at once, the rug after H5's hello, the lamp after H4, the shelf with H8, never the pad in S1) AND the party's `fromN` in the frame in use: `world.setParked`, `stage.setHomeThing`, `stage.bindProps(poses, count, propThing)`, the Felt Ball's bounds = `stage.visibleTable`; re-laid when the frame crosses aspect 0.9 or the body scale changes; `stage.setAutonomyFraming(true)` at Home; `setKeepsakes` from the journal.
- The awake budget: sleep is opted in (`sleepEnabled`) only while 2+ wholes are out (one squishy alone is the published toy, physics-wise untouched); over `unitCap` + allowance the farthest untouched LIFE scoot stops, else the farthest untouched still whole is put to `sleep()`. `stage.setBodyAsleep` mirrors physics sleep. `audio.setTouching` on each change of "the player is touching" (finger, grab, carry; a lock alone never).
- The Float rule (D-83): Float with one squishy at Home binds no prop world and LIFE gets autonomy false; with more out (or in a place) gravity is forced on the bodies at run time (the setting is not changed), `setFloatMode(false)`, and "Here your squishies stand on the ground." once a session.
- **FALLBACKS (PG_PHYS round 3 did not build these; marked FALLBACK in the code):** `SoftEvent.auto` -> the host decides (a land of a body LIFE drove in the last 2 s that nobody touches or threw; a bump while nobody touches any body and some body was LIFE-driven in the last 2 s; physics' own `ev.auto` wins whenever it is set). An auto event goes to `audio.autoThud` through the attention budget and never to feedback.handle or collection.feed (no haptic, no shake, never paid). `SoftEvent.other` -> a bump's partner is the nearest other character to the contact point. `metrics.contacts` -> a touching pair = centres closer than r1 + r2 + 0.02 m. `setBounds` / `setHome` -> each body keeps the PC's mat corral, RE-HOMED where LIFE last brought it to rest (`setHome` when physics offers it, else the corral's own home fields the constructor and `placeAt` write): without it the corral glided every LIFE use back to the spawn spot at up to 0.35 m/s. `carryTo` -> LIFE's USE intent and "Go play with..." on a ride do nothing.

### Scratch run (node, the REAL SoftBody with a recording stage stub; `scratchpad/pg_shell/fn01.ts`, light: 3.5 s + 32 s)
1280 x 800, a fresh profile; a 1.2 s squeeze of Dollop through the real input path; Crimpo and Capnap brought out by `mat.add`; 30 s, then to 5:20 of sim time, then a trip to the cabin and home:
- **1.60 ms per frame** for 3 real bodies + LIFE + the host in node.
- H1 "A gentle squeeze" (the real release, v = 1.2 s), H5 "Say hello" (LIFE's SOCIAL GREET, at 4.5 s), H2 "Watch it play" (FIRST_PLAY 6 s after the release -> a USE by SELF): moments "New stamp: ..." for each; Crimpo and Dollop are an authored best pair: keepsake bit 11 (Pair Charm).
- 10 bubbles (sparkle, hello x4, question, play ...) and 20 voices in the first 30 s; 35 `setBodyPose`, 29 `setBodyGaze`, 5 `setBodyExpression`; Home's things: the ball and the Music Box at once, the rug after the hello (fromN 2), the lamp waits for H4.
- The awake budget on med: two of three asleep at rest (units 1.06 = the floor).
- At 5:00 the FIRST_WISH backstop: Dollop's place wish rests in the Journal, Hearthlog opens ("Hearthlog Cabin is open. Find it in Places."); `travel('hearthlog')`: VISIT -> H8 "A wish comes true", C1, C10 done; "You are at Hearthlog Cabin."; the cabin's 6 things bound; back `travel('home')`: "You are at Home.".
- Not shown by this run: H3 (my synthetic touch drag did not become a pull: a harness detail, the browser run uses a real stretch), the cut with LIFE, the Float rule.

### Step 5 notes: sizes (one build each, `vite build --outDir scratch`)
| | HEAD 4f4c35d4b (git archive) | now |
|---|---|---|
| G0 (whole output) | 2136 KB of 3072 | **2355 KB** of 3072 |
| G0b (first play, gzip) | 518 KB of 600 (every lazy PLAYGROUND chunk counted: none was named later-*) | **459 KB** of 600 |
| index (entry) | 488.14 KB (180.35 gzip) | 491.82 KB (181.66 gzip): **+3.7 KB** |
| later-life (new) | - | **168.15 KB** (60.81 gzip) |
| later-journal (new) | - | 21.40 KB js + 4.75 KB css |
The honesty check passed (no first-play chunk statically imports a later-* chunk). Renamed lazy chunks: later-away (18.6 KB), later-away-sound (13.3), later-lifelook (23.8), later-place-<id> (render), -sound, -data for every place, 2 x later-shared (17.6, 9.5: data/life, places, quests, journal_text shared by the lazy chunks). NOT renamed, on purpose: `life_voices` (15.6 KB: the audio engine loads it at the first unlock, which is the start of play, so it is first-play and G0b counts it).
**One-file bytes (14.3's method, rolldown, imports external, minified)**: first load: game.ts 15 572 -> 16 402 (+830), hudBinding.ts 15 608 -> 16 831 (+1 223), boot.ts 7 556 -> 8 301 (+745), settingsCtl.ts +86, settings.ts +192, icons.ts +69, lifeLink.ts 362 (new): **+3.5 KB of the shell's 12 KB cap**. Life chunk: later-life.ts 29 162 B (the spec estimated 16 KB for the hosts and the attention wiring), wishes.ts 1 318 B. Screens: later-journal.ts 10 221 B, screenCopy.ts +318 (later-screens).
**The life chunk is OVER its 150 KB cap: 168.15 KB** (src/life alone is ~98 KB per PG_LIFE, the reducer + journal ~38 KB per PG_QUESTS, props.ts 15 KB, the host 29 KB). D-92's overflow rule names the next moves (pack the big tables; move the play-time UI to a `play` chunk); none is done this run.

# Round 3, second engineer (2026-11-17 from 02:35 UTC; HEAD 8a6a05e49; the container restarted at 02:33)
Continued from the report above. Verified at the start: tsc 0; the first engineer's code is committed (later-life.ts, lifeLink.ts, later-journal.ts, wishes.ts,
journal.css, settings v3, vite names); node_checks already held a section 12 with 8 LIFE-host rows (so 144 = 130 + 6 settings + 8 host, not the 136 above);
probe_app 183/183. The scratch FN-01 run (`scratchpad/pg_shell/fn01.ts`) still passes its story in node.

## Steps (this engineer)
| step | what | state |
|---|---|---|
| 6 | review of the host against the real PC shell and the lanes' APIs; fixes below | DONE 03:40 (tsc 0; node scratch `scratchpad/pg_shell/fn02.ts` 8/8; probe_app 183/183; node_checks 144/144) |

### Step 6 notes: what was wrong or missing, and what changed
- **The party was lost at every ceremony** (ceremonies' `beforeStart` -> `mat.clear()`), and a capsule's newcomer REPLACED the play squishy. Now (11.3, D-52, QUESTS 13 "the
  newcomer stays out"): the host reads the stash from its registry at the ceremony's start (who was out), holds the registry while the ceremony runs and until the party is back
  (no lifeRemove / lifeAdd for a ceremony, as LIFE's step.ts header asks), and right after the end brings the squishies back one per step (`mat.add(..., { restore: true })`:
  `restore` skips only the frame-time 'busy' refusal, mat.ts); for a capsule the squishy that was in play comes back beside the newcomer when the party has room, else "X went
  back to the shelf for a rest.". A character whose squishy comes back in a new body keeps its LIFE slot and brain (`rebind` by item id; also a quick switch to a squishy that
  was out). The newcomer is added NEW (lifeAdd isNew: B09's shy arrival and its hello within 5 s: H5 lands within seconds of the first capsule). Done in the LIFE chunk only, so
  the published first-load code path (and every probe without the host) is unchanged.
- **PG_PHYS bug, FALLBACK in the shell: Home's things never got a collider.** `props.ts` fills its `things` table with -1 and increments the per-thing prop COUNT from -1, so
  `setParked(thing, ...)` loops over count - 1 props: a one-part thing (every Home thing) is never shown or parked. Home's world is built all parked, so the Felt Ball never
  rolled, nothing at Home could be bumped or tapped (`raycast` skips parked props). `parkThing()` (later-life.ts, exported, marked FALLBACK) sets each prop's park byte and rewrites
  its pose (`writePose`) exactly as setParked means to. Verified: Home's 4 props raycast after showing, a 1.2 m/s poke rolls the ball 0.5 m in 0.5 s, re-parking removes the
  collider again. **Request to PG_PHYS:** count from 0 (`things[t * 2 + 1]` starts at -1); then parkThing's own loop finds nothing to do.
- **Thing taps (new; D-93's pointer half, PLACES 2.1 M13 / M14):** a Hand press that hits no squishy, released within 350 ms and 12 px over a shown thing (`world.raycast` from the
  camera ray; a squishy in front of the thing takes the press): a ball rolls away from the camera (1.2 m/s), a hinge or chime is poked, the Music Box plays its tune (a second
  tap stops it, one start per 40 s), the kettle whistles, the fireplace / lamp switch (its zone byte and its puff). One USE record by PLAYER each (H9 "roll the ball" x3 and C8's
  fire clause become reachable). game.ts passes the press and release to the host (two lines; only with a host).
- **The kettle (PLACES 4.2, C7):** a seeded whistle every 45 to 90 s of sim time in a place with a kettle, never within 60 s of a Music Box tune, never while LIFE is quiet:
  `audio.musicBox({ on: true, tune: 1 })`, the snapshot's musicBoxOn for its 3.6 s bar (LIFE's B18 answer -> USE LISTEN), `stage.thingFx(kettle, 1, 1)` and the steam
  (`lifeAddLook` wet +0.2 within 1.2 m, the kettle the source). A tune stops when the party travels.
- **Coming home** put the squishies at mat slots by LIFE slot order; now the play body at slot 0 and the k-th squishy out at slot k (as mat.ts builds them).
- **"New stamp: ..."** had no title outside Home; the title now comes from journal_text, imported lazily (its own chunk `later-journal-text`, vite.config.ts facade).
- In a place, a squishy that joins (the Hoard, back from a ceremony) stands at the layout's free spawn spot (the mat builds it at Home's mat spot, which may be inside a thing).
- The Felt Ball's bounds follow the rest framing at 1 Hz at Home (visibleTable is zero-allocation); travel waits while a ceremony runs or its party is coming back.
- The debug view adds `party` (held, restoring, newcomer), `tap` (the last tap's outcome) and `tune` (the Music Box / kettle state).
- scratch `fn02.ts` (node, real SoftBody, stub stage with a capsule drop): Felt Ball x3 by the player -> H9; first capsule -> 2 out, Dollop kept its slot; 3 capsules -> 4 out,
  slots kept; Music Box tap on / tap off; the cabin opens 60 s after the first reveal; the kettle armed 45..90 s ahead and whistles by itself (C7 "Answer the kettle"); a tap on
  the fireplace switches it; home again in mat order. 8/8.
| 7 | checks: node_checks section 13 on the REAL SoftBody (11 rows: the parkThing FALLBACK, FN-01 H1 + H2, three ball flicks -> H9, the party through a capsule (D-52) and the newcomer's hello (H5), the Music Box tap on / off, the first wish -> the cabin (H8, C1) with the kettle armed, the cabin's stamp titles, the kettle's whistle, the fireplace tap, home in mat order); probe_app's PLAYGROUND section (4 rows: the early log, the squeeze kept before the host, mat.add restore, the chunk-name rules of vite.config.ts `laterChunkName`) | DONE 03:15: **node_checks 155/155** (38.7 s), **probe_app 187/187**, tsc 0 |
| 8 | browser: new sections `pg-playthrough` (1280 x 800) and `pg-phone` (390 x 844) in browser_shell.mjs (the scripted S0 + S1 playthrough on the real game; sim stepped through the dev hook) | RUN 1 in progress (03:00): desktop rows all ok (below) |

### Step 7 / 8 notes
- The Journal's selected tab had no fill (journal.css used `--k-sel-bg`, which the kit does not define): now the kit's selected pair (`--k-sel-fill` / `--k-sel-edge`, as `.k-chip[aria-pressed]`) and a forced-colors rule.
- A tapped WISH bubble now reads its card's line ("Dollop wishes for a warm place: Hearthlog Cabin.") through a lazy import of `later-journal.ts` `wishLine` (boot.ts passes it to `attachBubbleTaps`); the words stay in the screens chunk. The wish CARD itself ([Let's go] [Not now]) is NOT built.
- Browser run 1, `pg-playthrough` (desktop), every row ok: the life chunk lands 2.6 s after Wake (the Journal in the dock, Places hidden); H1 with its toast "New stamp: A gentle squeeze";
  FIRST_PLAY 6 s after the release, H2, the Felt Ball shown with a collider and **moved 0.23 m by Dollop's own boop**; the first capsule's newcomer in play with Dollop back beside it in
  its LIFE slot; a third out by the Hoard's real "Bring out" (3 out); H5; in 40 s of sim LIFE did emote 7, voice 20, scoot 12, hop 24, gaze 21, pose 44, auto events 8 (all through the
  attention budget), Home's ball, Music Box, rug and lamp arrived; a real mouse click on the Music Box plays the tune, a second stops it; the Journal (4 tabs, H1 H2 H4 H5 done, LIFE
  quiet under it, Esc closes, focus back on the button); the first wish opens Hearthlog (the live line, the Places button); the Travel sheet (Home here, the cabin "Go to", the 8 unshipped
  "coming later"); the trip by the sheet arrives in 1.75 s of sim (H8, C1, C10 "Who loves the cabin?"); a real click on the fireplace is a thing tap; home again by the sheet in mat order.
  Screenshots (looked at): `_shots/shell/pg_home_party_desktop.png` (three out, the lamp, the Music Box, the rug, Journal in the dock), `pg_journal_desktop.png`, `pg_travel_desktop.png`,
  `pg_cabin_desktop.png` (the fireplace lit, swing, kettle, yarn ball, rocker, Dollop napping in the snug basket by the fire), `pg_home_first_minute_desktop.png`, `pg_home_back_desktop.png`.

# Round 4 (2026-11-17 from 05:05 UTC; HEAD 7e64f2018; the container had just restarted: nothing of anyone running)
Scope (orchestrator): (1) finish step 8: the pg-phone section, ONE browser run of the published-feature sections (trophies, dock, cut, photo, lock,
screens) on this tree, compare each failing row with the PC's own numbers (STATUS, its reports), fix what PLAYGROUND caused; (2) polish from the
screenshots: "Put back 2" an unstyled grey box (both layouts); phone cabin: a jagged black shape beside the ball's mat, the low table over the bottom of
the play area, the dock tooltip over the name tag; the dev stats overlay never in production; (3) D-95 revised: the swing and rocker AUTO toggle (a small
kit control on the thing, keyboard reachable, off by default) and grabbing the seat or rider by hand (PG_PHYS's API if it lands this round, else a marked
FALLBACK); (4) the trophies' gift sweep and every other open request to PG_SHELL in the PG_*.md reports (each listed done / not); (5) S2 places
(Ripple Shore, Frostbell Ridge, Rainleaf Garden) opened in Travel only if their data, render and sound chunks load and a visit works end to end.
No git write command. Port 5366 only (5367 only when free).

## R4.0 Baseline (05:10, HEAD 7e64f2018, clean tree, one probe at a time: `scratchpad/pg_shell/baseline.sh r4/base`)
| check | result |
|---|---|
| tsc | exit 0 (1.7 s) |
| probe_app | 187/187 |
| probe_gestures | 160/160 |
| probe_merge | 22/22 |
| probe_trophies | 31/31 |
| probe_collection | 73/74 (C08 previewTouch allocation 160 000 B / 20 000 calls: the known flaky row, PC STATUS and PG_QUESTS) |
| shellview/node_checks | 156/156 (36 s) |
| probe_economy, probe_catalog | all passed |
| probe_life | 95 ok, 1 fail (LF-02, PG_LIFE's) |
| probe_chatter | 42/42 |
| renderview/pg_node_checks | 40 ok, 0 FAIL |
| probe_screens | 43/43 |

## R4 steps (updated after every finished step)
| step | what | state |
|---|---|---|
| R4.0 | read the report, SESSION3, the brief with D-95 revised, STATUS, MERGE_PC, every PG_* request to PG_SHELL; baseline | DONE 05:12 |
| R4.1 | polish, first part: (a) "Put back n" is a kit button now (`src/ui/hoard/panel.ts`: `mat-chip k-btn k-btn--sm`, its word a `k-btn-label`); the cause is the PC's own published code: hud.css says "a kit button (hudBinding adds `k-btn`)" but neither hudBinding nor panel.ts ever added it (same at 9211d66ba), so the chip drew as the browser's default grey button in every layout; (b) the Journal and Places dock tooltips follow every other dock button (toolbar.ts): only while the dock draws no labels (`when: form !== 'full'`) and on the dock's side (`tipSide`); (c) the dev stats overlay: `boot.ts` 282 creates it only under `import.meta.env.DEV && cfg.dev` (vite drops it from a build; the prod-build section greps and boots the build with `?dev=1&lab=1`); my pg screenshots hide it | DONE 05:20 (tsc 0); the build grep in the browser run |
| R4.2 | requests: the Hoard swatch's "Gift" (`originCopy(it.origin, it.id)`, PG_QUESTS request 4) DONE; the trophies' gift sweep NOT DONE, see the note below | 05:25 |

### R4.2 note: the trophies' gift sweep (PG_QUESTS R3 step 1) is NOT in, on purpose
The one line (`g.hoard.onEvent`: a `gift` event with `state === 'granted'` -> `sweepSpecies(false)`) was written and run: it turns PG_QUESTS's own
passing row RED: probe_journal **CO-12 "trophy behaviour is unchanged by the Journal: the trophies' save (nine counters, the earned set) with a Journal
attached, a ring fed and a gift granted equals the save without one"** (A species 1, B species 2: the gifted species is counted, which is exactly what
the sweep is for). The two asks contradict each other, and the row is PG_QUESTS's file, so I reverted the line (probe_journal all ok again).
**Request to PG_QUESTS (or the orchestrator):** re-specify CO-12 row 3 with the written reason "the trophies count a gifted species at once (the
sweep PG_QUESTS asked for)": compare the save with `species` left out, and assert B's `species` equals the species owned after the grant. Then the line
goes in as written above (achievementsBinding.ts `attach()`, one condition), no other change.
| R4.3 | D-95 revised: the AUTO chips and the hand on the seat (on PG_PHYS round 4's `setAuto` / `grabProp` / `dragPropRay` / `releaseProp`, in its working tree since 05:10) | DONE 05:40: tsc 0; node_checks **160/160** (4 new rows below); scratch browser run on 5366 (below) |
| R4.4 | the round-3 phone shot's "jagged black shape" found and fixed: **Home's things never left Home** | DONE 05:38 (node row) |
| R4.5 | other requests: the held creak / roll voices, the fire's crackle, the place finale light, a cold place's voice pitch, LIFE's CUT touch before the cut whole leaves | DONE 05:45 (tsc 0, node_checks 160/160) |

### R4.3 notes: D-95 revised as built
- **The control** (`src/ui/thingAuto.ts`, NEW, life chunk: later-life.ts re-exports it, boot.ts attaches it with the bubble taps): one small kit toggle chip per hinge ride in
  the place shown (the Pillow Swing and the Rocker Board at the cabin; Rainleaf's Leaf Teeter once Rainleaf ships), `k-chip` with `aria-pressed` (32 px to see,
  44 px to hit), the word "Auto" and the `reset` icon, named "Auto: the Pillow Swing moves by itself". OFF by default; only the player switches it (LIFE and
  autonomy never call it; the autonomy setting does not touch it: the revised D-95 makes it the player's choice). It is a real button in the page's Tab order
  (Tab stays the browser's, D-77); Space / Enter toggle it; the live region says "The Pillow Swing moves by itself." / "... slows down by itself.".
  Anchors stand still: a swing's beam (the ropes' top, `p.pivotY`), 0.65 m above a rocker's pivot (over its riders' heads); placed every 250 ms (never per frame),
  hidden while LIFE is quiet (a sheet, a ceremony, travel, any tool but the Hand), moved up past any HUD box it would cover (top buttons, hint, info row, dock,
  ring, Put back, toasts), else hidden for that round. A ride's AUTO is kept for the session across trips (re-applied on arrival).
- **The hand** (later-life.ts `grabAt` / `dragAt` / `dropAt` / `holds`; game.ts: 6 lines in the input port): a Hand press on a swing seat or rocker board with no squishy
  in front is the host's (the gesture machine never sees it, so the view does not turn); a drag pulls it (`dragPropRay` from the pointer ray), the release lets it swing
  on (AUTO off: it dies down; on: physics eases it back to the arc); a still tap (< 350 ms, < 12 px) stays round 3's poke + USE by PLAYER; a moved release writes one
  USE by PLAYER. The rider is grabbed as any squishy (the gesture machine; physics' held-rider rule makes the hand win). `releaseEverything`, `cancelAll`, a
  pointer cancel, a trip and dispose let go.
- **FALLBACK** (marked in later-life.ts): physics without `setAuto` / `grabProp` (the round-3 props.ts): no chip is offered and a press on the seat stays round 3's tap or
  the camera's drag. The node row reports which branch ran.
- node_checks rows (section 13, REAL SoftBody + REAL PropWorld): AUTO (two chips, both off; seat x range at rest 0.000 m, AUTO on **0.486 m** (+-0.24 m = the 10 deg arc on
  the 1.4 m rope), 30 s after off 0.010 m); the hand (the press is the host's, a 112 px drag pulls the seat 0.003 -> 0.597 m, then a 1.08 m range in 2 s); the held
  creak (1 722 calls, held up to 0.73, then 0); Home's things leave with Home.
- Scratch browser run (`scratchpad/pg_shell/r4/explore.mjs`, 1280x800 and 390x844, the REAL game): AUTO by a real click on the chip: the resting seat (x 0.000)
  swings +-0.243 m steadily for 12 s; a real mouse drag on the seat: `hand:pillowswing`, the seat swung +-0.52 m after release and settled back to the AUTO arc.
  0 console errors on both pages.

### R4.4 notes: "a jagged black shape beside the ball's mat" (round-3 phone cabin shot)
The stage draws a SHOWN Home thing at the bound prop whose `propThing` equals ITS index (contracts: "a bound prop's pose moves it after that"). The host never hid
Home's things on a trip, so in a place the Felt Ball, the Music Box and the Snooze Rug followed the place's things 0, 1 and 2: at the cabin (tall) the dark Snooze Rug
lay under the Yarn Ball (thing 2) and z-fought the cabin's rug and floor (the jagged black edge); at Ripple, Frostbell and Rainleaf the ball and the box stood at
their Home spots (a stray pink ball and a red box in every S2 shot, the box under Rainleaf's Leaf Teeter, thing 1). Fix: `enterPlace` parks every shown Home thing
(`setHomeThing(k, false)`); home again shows them by the same rule as before. **Request to PG_RENDER (defensive):** the home kit could ignore bound poses while a place
is shown.

### R4.5 notes
- PG_AUDIO: a hinge's creak and a ball's roll are HELD voices now (`prop({ kind, key: prop, held: speed 0..1, size })` every frame while it moves, once 0 when it stops;
  `auto` unless the player's hand holds it or the player tapped a thing in the last 2 s); the fireplace's crackle puffs the bed when a tap lights it; a place with a
  whole-place cold zone (strength >= 0.5: Frostbell) sings a semitone lower (x 2^(-1/12)).
- PG_RENDER: a chapter's finale completed in its own place draws the place's finale light (`thingFx(-1, 2, 1)`), eased back after 20 s of sim (`thingFx(-1, 2, 0)`).
- PG_LIFE (LIFE 9): when a cut replaces the whole, the whole gets ONE more frame with touch kind CUT (the curious one walks over to look), then it leaves and its pieces
  join (node row "a cut with LIFE" still ok).
- Hoard: a Journal gift's swatch reads "Gift" (`originCopy(it.origin, it.id)`, PG_QUESTS request 4).
- The phone's hint pill stands one row higher while "Put back n" shows (stack layout, 381 px and wider; hud.css): the two shared a band and the chip covered the pill's
  end ("Tap to poke · hold to squish · drag..." under "Put back 1" in my first 390x844 shot).
- The dev hook: `travel(place, any)` (dev only: a place that has not shipped or opened yet, for the S2 checks; contract DebugHook: an optional second argument,
  additive) and `shell.stageObj()` (dev only).

### R4.6 Every request to PG_SHELL in the PG_*.md reports (state at R4; "r3" = done in round 3 and verified in its rows)
| from | request | state |
|---|---|---|
| PG_QUESTS 1 | attachJournal through the trophies wrapper; feedPlay once a frame; setJournalParty on each party change; journal() for the screens | DONE r3 |
| PG_QUESTS 2 | quest `byPlayer` gates the haptic; unlock place 1 line; gift ready / pending / granted | DONE r3 (the gift card's claim path: the Journal shows it; QUESTS 11's card copy as built in round 3) |
| PG_QUESTS 3 | ring conventions (WISH thing / v, the 5:00 backstop a = 255, VISIT by PLAYER, SOCIAL v -1, BRING per member, PIECES sub, TOUCH v) | DONE r3; BRING was missing (the reducer's MET fact and the favourite-place warmth read it): DONE R4 (one per squishy the player brings out of the Hoard or switches to, and one per member arriving with a trip; not for the attach's party or a capsule's newcomer, whom CAPSULE records) |
| PG_QUESTS 4 | Hoard swatch "Gift" (`originCopy(it.origin, it.id)`) | DONE R4 |
| PG_QUESTS 5 | the gift card through `claimGift`, its refusal messages, no Yes button for a signed-in ledger | DONE r3 (later-journal.ts) |
| PG_QUESTS 6 | the Friendship Frame thumbnail (`JOURNAL_FRAME_KEY`) at the X8 photo | NOT DONE: needs the Snap shutter (11.15), not built |
| PG_QUESTS R3 step 1 | the trophies' gift sweep (one line in achievementsBinding.ts) | NOT DONE: contradicts PG_QUESTS's own CO-12 row 3 (R4.2 note); the line and the re-spec are written there |
| PG_QUESTS R3 step 2 | lifeSetFriends for every owned species after lifeSetJournal; on FRIEND >= 2 and F3 | DONE r3 |
| PG_LIFE | snapshot by slot, no extra attention filter, no lifeRemove / lifeAdd for a ceremony, a cut = remove + add pieces with the group, USE by PLAYER b 254, the backstop WISH, HOP's anticipation, GAZE NaN = camera, EMOTE bits | DONE r3 |
| PG_LIFE | SOCIAL GREET thing -2 -> v -1, FRIEND wish granted by PLAYER, lifeSetHops(w, 0) in S1 | DONE r3 |
| PG_LIFE | the CUT touch kind on the whole before it is removed (the curious one's walk-over) | DONE R4 |
| PG_LIFE | lifeSetHops(w, mask) in S2 (families PH-01 passed with `auto` landings) | NOT DONE: S2 not open; physics has no `auto` landings yet |
| PG_AUDIO | setTouching on change; `auto` lands / bumps -> autoThud; prop strikes with `auto = cause !== 0`; ball `size`; chime `note`; sing for SING / DUET; a piece's pitch x popSize; the kettle `musicBox({ tune: 1 })`; setAmbience / setMusicStyle on arrival, `{ place: null }` and 'home' at Home | DONE r3 |
| PG_AUDIO | held voices: the rocker's / swing's creak and a rolling ball every frame while it moves (key, held) | DONE R4 |
| PG_AUDIO | the fire's crackle puff `prop({ kind: crackle })` | DONE R4 (when a tap lights it) |
| PG_AUDIO | a cold place's voice pitch x 2^(-1/12) | DONE R4 |
| PG_AUDIO | `loadAmbience` prefetched when the place OPENS (not at the trip) | DONE R4: on the `unlock` event of a shipped place, 1.5 s later, `loadPlaceDef`, `stage.loadPlace` and `audio.loadAmbience` in the background (11.7); the trip still awaits all three (cached by then) |
| PG_AUDIO | `sing: true` on finale phrases | NOT DONE: LIFE's phrase ids carry no "finale"; SING / DUET are sung |
| PG_AUDIO | held rustle (Shake Pine) / whoosh (slides, rides), a splash on water entry, a snow-print crunch, cog ticks, `weather`, `echo` / `echoes` | NOT DONE: S2 / S3 places are not open, and physics has no water entry, slides, gusts or waves to forward |
| PG_RENDER | setAutonomyFraming, setHomeThing, setKeepsakes, bindProps with propThing, setBodyAsleep, emote flags bit 1 (still dot), loadPlace / setPlace / setPlayBounds, setBodyLook (frost, wet, sand, toast, snow), thingFx for the kettle and the hearth | DONE r3 |
| PG_RENDER | `thingFx(-1, 2, 1)` at a finale, `0` to end it | DONE R4 (a finale done in its own place; 20 s of sim) |
| PG_RENDER | setBodyBreath for a basking firm silicone / pop dome | NOT DONE: LIFE gives the host no "basking" state |
| PG_RENDER | setEmotesInPhoto with the Snap bar's switch | NOT DONE: the Snap shutter and its "Bubbles in photo" switch (11.15) are not built; the stage's default (bubbles drawn) stands |
| PG_RENDER | reactFx for a reaction cell's PARTICLE channel (1, 2, 4, 5, 6, 8, 9) | NOT DONE: no LIFE output names a reaction cell's particle; a host-side cell interpreter would duplicate LIFE's reaction rules. **Request to PG_LIFE:** an event or intent per PARTICLE cell (kind = the preset, the character) |
| PG_RENDER | thingFx on a Shake Pine shake, a Drip Leaf tap | NOT DONE: Frostbell and Rainleaf are not open |
| PG_PHYS | call the PG members on the SoftBody itself; one beginFrame / endFrame; drainStrikes; Home built parked + setParked / setBallBounds | DONE r3; the `parkThing` FALLBACK stays (harmless: with PG_PHYS's round-4 count fix in its working tree, `setParked` does it and the fallback's loop finds nothing to do) |
| PG_DATA | a ramp rider at its top spot; block rows; the Drip Leaf's use spot | NOT DONE: S2 not open (and physics has no ramp) |
| PG_DATA | the kettle's steam r 1.2 m | DONE r3 (from the data, `p.steamR`) |
| R4.7 | PG_PHYS round 4's other members, used where present (guarded, the FALLBACKS stay for an older physics): `SoftEvent.other` (a bump's partner slot), `metrics.contacts` (the touching pairs of `units`), `setBounds` (a place's area on arrival and for a squishy who joins there; `-1` at Home, where the published corral about each body's spot stays: D-87's rectangle is NOT sent, so one squishy alone stays the published toy); `SoftEvent.auto` and `setHome` were already read when present. BRING records (QUESTS 4) added | DONE 05:55: tsc 0; node_checks 160/160 on the working tree's physics (PG_PHYS's uncommitted round-4 softbody.ts / props.ts) |

### Sizes (14.3's one-file method, rolldown, imports external, minified; `scratchpad/pg_shell/size.mjs`, HEAD 7e64f2018 vs now)
| module | chunk | HEAD | now | delta |
|---|---|---|---|---|
| shell/game.ts | first load | 16 521 | 16 779 | +258 (the hand's 6 input-port lines) |
| shell/boot.ts | first load | 8 370 | 8 433 | +63 (attach the AUTO chips) |
| shell/hudBinding.ts | first load | 16 831 | 16 937 | +106 (the dock tips' `when` and side) |
| ui/hoard/panel.ts | first load | 24 669 | 24 710 | +41 (kit classes, the gift's origin) |
| **shell first-load share** | | | | **+468 B this round; about 4.0 KB of the 12 KB cap with round 3's 3.5 KB** |
| shell/later-life.ts | life chunk | 35 711 | 41 056 | +5 345 (D-95's hand and AUTO rows, held voices, finale, BRING, the physics members) |
| ui/thingAuto.ts (new) | life chunk | - | 2 349 | new |
The life chunk was already OVER its 150 KB cap at round 3 (168.15 KB); this round adds 7.7 KB (one-file bytes) to it. D-92's overflow moves (pack the big tables; a `play` chunk for the play-time UI) are still not done.
| R4.8 | (5) the S2 places: visited end to end through the dev path, both layouts; **NOT opened** (they stay "coming later": reasons below) | DONE 05:40 (decision; re-checked at the end of the round) |
| R4.9 | `_harness/uikit/pages/pg.ts` (NEW, batch PG): the Auto chip off / on on the four backdrops, "Put back n", the Journal and Places dock entries, built as the game builds them | DONE 05:58 (tsc 0; the kit page was not shot this run) |

### R4.8 notes: why Ripple Shore, Frostbell Ridge and Rainleaf Garden stay "coming later"
The visits themselves work: `scratchpad/pg_shell/r4/explore.mjs` (the REAL game, 1280x800 and 390x844, the dev hook's `travel(id, true)` that skips the shipped and
open checks; screenshots kept as `_shots/shell/pg_r4_explore_<place>_<desktop|phone>.png`): each place's data, look and sound chunks load, the party arrives in
the right layout (wide 0 / tall 1), stands at the place's spawn spots, the things that have props are bound, Rainleaf's Leaf Teeter gets its Auto chip, home
again works; **0 console errors, 0 failed requests on both pages**. They do not hold up as places yet:
1. **Physics has no ramp, pad or floater** (PG_PHYS round 3 "NOT BUILT"; round 4's working tree adds none): Frostbell's Glide Ramp, Rainleaf's Moss Bouncer and
   Ripple's Bob Ring are drawn with NO collider (`life().things` shows no prop for them): a squishy walks through the ramp and the ring, nothing slides, bounces
   or floats.
2. **No water physics** (the zones are flags only): the Rock Pool, the Steam Pool and the Splash Spots leave `submerged` at 0, so FLOAT / WADE / SOAK never happen
   and the chapters' quests that need them cannot complete (a stall, D-78's "only completable quests" would hide them, but then the chapters are half empty).
3. In the tall layouts the front-band things (Ripple's Sand Mound, Frostbell's Snowdrift Nest) lie under the HUD rows, as the cabin's Rocker Board does (below).
4. Flipping `shipped` is the orchestrator's (data/places.ts PLACE_INFO and each PlaceDef, PG_DATA brief); the shell needs NO change then: Travel, the journal's
   compiled rules and LIFE's thing kinds all follow PLACE_INFO.shipped, and `travel(id, true)` stays the dev check path.
Found and FIXED on the way (R4.4): Home's Felt Ball and Music Box stood in every S2 place.

### The cabin's "low table" on a phone (round-3 shot): the Rocker Board, a layout matter (request)
The "low table" is the 2.2 m Rocker Board: the cabin's TALL layout puts it at (0.03, 3.0), the very front edge of the play bounds (hz 3), so on a 390x844 phone it
fills the bottom band behind the hint, "Put back" and the name tag and hides whoever is behind it. The shell frames the layout's bounds as specified (`setPlayBounds`,
`setSafeInsets` from the info row). **Request to PG_DATA:** move the tall Rocker Board out of the front band (e.g. beside the rug at z ~ 1.6, or along a side wall);
the same holds for Ripple's Sand Mound and Frostbell's Snowdrift Nest in their tall layouts. **Request to PG_RENDER (optional):** frame a place's things' footprints,
not only its bounds, above the HUD rows. The hint pill no longer runs under "Put back" (R4.5).

### R4 browser runs: method (one heavy job at a time, port 5366 only)
- Run 1 (05:29, on the WORKING tree) was STOPPED at 05:40: other lanes edit in parallel and PG_PHYS's `softbody.ts` was caught mid-edit by the dev server
  (`hoard-loop`: "TypeError: this.playerHas is not a function at SoftBody.postSubstep"), so every page after that point ran on a broken physics. Its one earlier
  FAIL (shift-pull "the same drag WITHOUT Shift ... one snap": snap none) is re-measured below on the snapshots.
- From run 2 the browser runs use SNAPSHOT trees in the scratch folder: `tree_mine` = `git archive HEAD` + only MY lane's working files (`sync_mine.sh`), for the
  published sections (HEAD's physics: the AUTO chip is in its FALLBACK there); `tree_full` = tree_mine + PG_PHYS's working `src/physics` taken at a moment it
  typechecks and node_checks pass, for the PG sections (AUTO and the hand need PG_PHYS round 4); `tree_head` (HEAD) and `tree_pc` (the PC's published 9211d66ba)
  for A/B of any failing row.
| R4.10 | node_checks section 13 gains the S2 dev-path row (each S2 place refused by the sheet's path, then visited by `travel(id, true)`: data loads, the party arrives, the things physics builds are bound; the ones it does not: Ripple rockpool + bobring, Frostbell icepond + glideramp + steampool, Rainleaf splashspots + mossbouncer + steppingstones) | DONE 05:47: node_checks **161/161**, probe_app 187/187, probe_gestures 160/160, tsc 0 |
| R4.11 | **a bug of mine found by run 2 and fixed**: the hand slots (R4.3) used the id -1 as "free", and the dev hook's pointers have NEGATIVE ids (-1 for its pointer 0), so `dragAt` took every move of that pointer and no squishy could be lifted through the dev hook (run 2: shift-pull's plain drag, snap-mat's carry, cut-real's carry rows: `carried false`, events grab but no lift). A slot is in use by its own flag now, `dropAll()` replaces the `-1` "every hand" call (game.ts cancelAll / releaseEverything). New node row: a drag by pointer id -1 far out of the squishy lifts it with the host attached and the host does not hold it. A node A/B (`scratchpad/pg_shell/r4/carry_ab.ts`, a mouse id 1) lifted the squishy on the PC tree, HEAD and mine alike, which is how the cause was narrowed to the id | DONE 06:25: node_checks **162/162**, tsc 0 |
- Run 2 (`r4/pub2`, tree_mine before R4.11) stopped after cut-real: the -1 bug (R4.11) turned every dev-hook carry into a FAIL (snap-mat carry, cut-real drag to
  reconnect and toss, and the "4 pieces by presses" row after them: 5 pieces because the reconnect never happened). It also showed hoard-loop green (the kit
  "Put back 2" chip included: `{"hidden":false,"text":"Put back2",...}`), shift-hint-reflow, shift-touch, settings-panel-desktop, toolbar green.
- **A/B on the PC's own published tree** (`r4/ab_pc`, 9211d66ba, same machine, same port, `--only=desktop-boot,mouse-gestures,shift-pull,snap-mat,cut-real`): 65/67.
  Its two FAILs are cut-real's "leaving: a quick switch reconnects at once" (`k1 pieces 2, tsw {p:2, x:1}`) and "leaving: hidden 30 s keeps the pieces; hidden
  over 60 s comes back whole" (`short 3, long 1`): **identical numbers to run 2 on our tree, so they are the PC's own on this machine, not PLAYGROUND's**.
  The PC tree passes shift-pull here; ours failed its plain-drag row in runs 1 and 2: the squishy stood elsewhere by then (the PC pressed at x 734, ours at
  551 and 535 for the Shift pull, from the body's place at the section's start: LIFE had moved Dollop, FIRST_PLAY and autonomy, D-37 / FN-01). Re-specified
  with the reason in the code: the plain drag starts from the same spot on the squishy where it stands NOW (path, length and assertions unchanged).
| R4.12 | **run 3 (`r4/pub3`, tree_mine with R4.11) found three PLAYGROUND regressions of the published UI; fixed:** (a) the Journal (and Places) in the dock's Collection group pushed the published Table / Float pair behind More at 390x844 and kept the Hoard's count (toolbar-gravity: "the pair is in the tray" shown [null, null]; "the Hoard gives its count away" form full; the section then stopped: the Float button had no box), and made the Journal a Tab stop between Menu and Hoard (K04 at 1280 and 390, both walks). Fix (the brief: "the Journal and Places buttons go in the top-right column"): a `.hud-life` column under the top row's right end (icon buttons with names and tooltips; a row on tiny; under the 320 px hint), first in the HUD's DOM so Tab reaches them just before Full screen; the dock is the PC's again. (b) K02 at 358x201 and 632x355: a bubble's 44 px hit area ("Ooh, wow!") clipped at the window edge (45x42) or covered (0x0): a hit area now shows only when its whole 44 x 44 box is inside the window and clear of the HUD. (c) cut-touch: a real finger swipe on a phone drew no blade (the swipe starts above the squishy, where a bubble's hit area took the press): the hit areas are the Hand's only (hidden at once by CSS with Cut or Snap in hand, and by the placement) | DONE 07:15: tsc 0; probe_app 187/187, probe_overlays 21/21, probe_uikit 62/62, node_checks 162/162; the browser re-run of these sections below |
- Run 3 other rows so far: shift-pull ALL ok with the re-specified plain drag (the log: "the squishy at (482, 432) then (580, 375)": LIFE had moved it); hoard-loop, snap-mat
  (the carry into the neighbour: ok), shift-*, settings green; cut-real: only the PC's own two "leaving" rows (identical numbers again); toolbar: "Enter on Cut ...
  the live region says how it works ... the 1.4 s caption chip" FAILED (live "", caption shown false) where run 2 passed it on the same code path (a 1.4 s
  window read late at load 7: classified a load-timing flake, re-run below).
- **Run 3 result (`r4/pub3`, tree_mine with R4.11, 06:34-07:41): 410/432.** The 22 FAILs, classified:
  - PLAYGROUND's, FIXED in R4.12 (re-run 4 below): toolbar-gravity x3 (the Journal in the dock at 390), K02 x9 (a bubble's hit area at the window edge or under the
    HUD; at 568x320 Snap also "Mute sound 41x44", the Journal crowding the strip's top tray), K04 x4 (the Journal stop), cut-touch x1 (a bubble's hit area took the
    swipe), keyboard-only "Tab order in play ... and no other stop" (the Journal stop: RE-SPECIFIED with its reason, D-77: the Journal and Places come first, just
    before Full screen, every published stop in its place), fix2-dock "small landscape 568x320: the Cut strip ... covers under 5 %" (cutWhole 0.218, cut2 0.342:
    to be re-measured without the Journal in the strip's tray).
  - The PC's own on this machine (A/B above, identical numbers): cut-real "leaving: a quick switch ..." and "leaving: hidden 30 s ... 60 s".
  - Load timing: toolbar "Enter on Cut ... the 1.4 s caption chip" (passed in run 2 on the same path; re-run 4).
  - Green on our tree: desktop-boot, mouse-gestures, shift-pull (re-specified plain drag), shift-hint-reflow, shift-touch, settings-panel-desktop, hoard-loop (the kit
    "Put back" chip), snap-mat (photo: Snap, Save, the carry into a neighbour), toolbar-phone, toolbar-sweep, cut-x (the whole cut suite), cut-swell, cut-low,
    hoard-phone, menu-pause, fullscreen-gate, toasts, modal-layers, ui-sounds, **prod-build** (G0 2373 KB of 3072, G0b 459 KB gzip of 600; "no DebugHook, no sound
    lab, no dev CSS" grep of 50 files; strict CSP 0 violations; **`?dev=1&lab=1` on the build: no `window.__WH__`, NO STATS OVERLAY, no sound lab**: the dev
    overlay is harness-only, confirmed), console-and-network 40/40.
