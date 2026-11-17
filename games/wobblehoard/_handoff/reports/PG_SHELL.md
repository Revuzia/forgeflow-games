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
