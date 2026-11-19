# VERDICT_R9: independent verification of Squish Keeper at HEAD d2bd392ea (2026-11-19)

**VERDICT (FINAL, 05:50 UTC): NOT READY to deploy with all six places open. No BLOCKER; regression, saves, actions, quests, tosses, Home clicks, chips and sound levels pass with 0 errors. MAJOR C1: Ripple Shore and Cloudloft give only 2 things used on their own on the phone at both quality tiers. MAJOR C2: at the low tier Frostbell (phone), Rainleaf (phone) and Lanternroof (desktop) fall to 1 to 2 (4 / 3 / 4 at high). Deployable: close all five new places (Home + Hearthlog only), or, if the high tier is accepted, close Ripple Shore and Cloudloft; neither reduced build was built or run here.**

Verifier: independent; wrote no file in `src` or `_harness`, ran no git write command. **Every result is for HEAD d2bd392ea** (a `git archive` copy); at 05:50 UTC the working tree had new uncommitted edits by another agent (`src/life/step.ts`, `src/life/world.ts`, `src/render/places/cloudloft.ts`, `_harness/probe_life_selfuse.ts`, an R10 fix lane): they are NOT covered here. Nothing of mine is left running (the remaining `probe_life_selfuse` process belongs to that lane).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_verify_r9/` (below `S/`): `scripts/`, `logs/`, `shots/`, `snap/` (copy of the tree).
Ports: 5370 (vite dev of the copy), 5371 (new prod, static), 5372 (live snapshot, static), 5373 (old build 23c684a60, static).

## How to continue if cut off
Scripts in `S/scripts/` (all mine): `common.mjs` (real mouse / CDP-touch input interleaved with stepping the paused sim; spies on `stage.emote` and the audio engine's `creature`),
`mkseed_r9.mjs` (a seed: fresh profile, capsules, N out via the Hoard, journal st 45 + cabin bit), `place.mjs` (one place, one frame), `runC.sh` (all places, skips finished ones),
`home.mjs`, `oldsave.mjs` + `loadsave.mjs` (the 23c684a60 save), `runB.sh` (regression: `arun.mjs`, `savetest.mjs`, `reqlog.mjs` from pg_verify3), `runprobes.sh`.
Servers: `node S/scripts/serve.mjs <dist> <port>`; vite dev: `cd S/snap/games/wobblehoard && node node_modules/vite/bin/vite.js --port 5370 --strictPort --host 127.0.0.1`.

## Checks done (in order)

### (a1) Build and sizes (DONE 00:50 UTC)
- Copy: `git archive HEAD games/wobblehoard` into `S/snap` (HEAD d2bd392ea; the working tree had no change to tracked files, `diff -rq S/snap/.../src G/src` empty). `S/snap_old` = `git archive 23c684a60` (the build now live).
- `tsc --noEmit -p tsconfig.json`: exit 0 (1.8 s). `vite build`: exit 0, 1.23 s, 242 modules; [G0] 2517 KB of 3072; [G0b] 466 KB gzip of 600 (`S/logs/build_new.log`). Old 23c684a60: [G0] 2418 KB, [G0b] 462 KB.
- Live snapshot `_live_snapshot/2026-11-16`: `sha256sum -c SHA256SUMS` all OK.
- **First-play closure** (static, `S/scripts/fp.py`, html + entry closure, no later-*/life_*): new **1529.9 KB raw / 467.8 KB gzip**; live snapshot 1454.4 / 443.0; 23c684a60 1513.6 / 463.8.
  PLAYGROUND delta vs the snapshot **+75.5 KB raw / +24.8 KB gzip** (23c684a60 was +59.2 / +20.8). SZ-01's hard cap is 70 KB (target 60): **missed by 5.5 KB raw** (finding A1).
  The growth since 23c684a60 is mostly `three.core` 207,179 -> 222,068 B (+14.9 KB: more of three.js pulled into the first load) and `stage` +1.3 KB.
- **Life chunk**: `later-life-*.js` **68.64 KB** raw (25.95 KB gzip): under 150 KB. BUT the brain was moved out (round 7, vite.config.ts 60-68) into `later-brain-*.js` **112.65 KB**, which later-life imports
  and which loads with it at once: the life set fetched at Wake is **181.3 KB** raw (64.8 KB gzip). PG2 measured the whole thing at 145.4 KB in one chunk. Finding A2 (the cap is met by a split, not by size).
- Places (render+audio+data, cap 45 KB each): Lanternroof 25.3, Hearthlog 19.9, Frostbell 18.0, Cloudloft 18.3, Ripple 14.8, Rainleaf 14.0: all pass. Away 35.1 of 90: pass.
- **Total**: `dist/assets` **2095.0 KB** (decimal; 2045.9 KiB) against D9 / SZ-02's 2000 KB (PG2 measured 1993.2 on the same basis): **over by 95 KB** (finding A3). The build's own gate is still the old G0 3072 KB, so `vite build` does not catch it; the T1 gate of PLAYGROUND_BUILD.md was never built.

### (a2) Dropped places in the build (static, DONE 00:55 UTC)
- `grep -i "Fizzwell|Cogwhistle|Echo Hollow"` over `S/snap/.../dist`: **no player-visible name**. The only hits are the lowercase id table `PLACE_IDS` (`home, hearthlog, ripple, frostbell, rainleaf, fizzwell, cogwhistle, lanternroof, echohollow, cloudloft`: append-only save indices, D-96 tombstones) and one zero-weight map (`fizzwell:0`) in `later-shared-*.js`. Not a finding (needed for old saves' place bits). DOM text is checked in every browser run below.

### (a3) Node probes (DONE 01:21 UTC; 42 runs, one at a time on the copy, 26 min; logs `S/probes_new/<name>.log`, `summary.txt` ends ALLDONE)
Pass: probe_app 188/188, boot 30/30, catalog all, chatter 42/42, collection_imports 10/10, cut 17/17, economy all, families 22/22, flush 11/11 (quick), genome ok,
gestures 160/160, journal all, life_imports all, **life_selfuse all** (SU-01 3+ things by themselves in 300 s for 5 of 5 parties at all 6 places, node sim; SQ-01 soak + squirt),
lock_shell 96/96, lockfx 15/15, many 43/43, materials all, merge 22/22, neck 8/8, optbar 42/42, overlays 21/21, parts 11/11, pg_economy all run (2 NOT RUN), pg_lifequests 16/16,
playground 74/74 (quick), portal 82/82, quests all run (3 NOT RUN), **r8_features 9/9**, screens 43/43, tips ok, trophies 31/31, uikit 62/62, shellview/node_checks 185/185, renderview/pg_node_checks 40/0.

| Probe | Failing rows | Same as the published / PG2 baseline? |
|---|---|---|
| probe_collection 73/74 | C08 previewTouch allocation | yes (pre-existing) |
| probe_lock 82/87 | LOCK orders crimpo, LOCK slots cushlet, LOCK perf | yes (same 3) |
| probe_softbody 115/116 | G1p warmUp lone finger | yes |
| probe_species 25/31 | press matrix rest; FULL PULL putty; RUBS waterfill / putty / slimegoo / beadsqueeze | yes (same 6) |
| probe_truecut 104/113 (--quick) | G2, G3 x2, G4 x4, G7 nested, L2 rest pose | yes (same 9) |
| probe_life 127/128 | LF-02 lifeStep allocation (72 to 152 KB per 1000-tick window, bar 0) | yes (PG2 had it) |
| probe_pg_data | **DT-18** (round 8): "no Home thing hides behind a party slot": TALL keepsakeshelf 95 % hidden at n3; WIDE musicbox 54 % hidden at n3; WIDE warmlamp 95 % | NEW guard row, fails: the Home things are still drawn behind the party (R9 made them clickable through the squishies instead). Checked in the browser in (d). |

No new failure that is a regression of published behaviour. DT-18 is the honest layout guard of a known Home issue (finding D1 below, severity set after the browser check).

### (b1) Published steps, desktop 1280x800 (DONE 01:36 UTC)
- Same script and seed as PG2 (`S/scripts/arun.mjs`, seed `S/logs/seed_live_2dollops.json`), live snapshot on :5372 against the new prod build on :5371 (`S/logs/A_{live,new}_desk.out`; compare `S/scripts/cmpA.py`).
- 23 of 23 steps ok on both (title, Wake, poke, first squeeze, first stretch, capsule earned and opened, Hoard Shelf / Gift / Today, merge, Cut, Reconnect all, Done, Snap, Save, lock, Float/Table, Settings, Trophies, keyboard walk). 0 console errors, 0 page errors, 0 failed requests on both.
- Differences: the capsule and merge results are random on both builds (live got Glugbean then Crimpo; new got Boingle then a Tier up to Knubby); the new build says "Hearthlog Cabin is open. Find it in Places." (PLAYGROUND, expected). Every Cut / Reconnect / Snap / lock / Float line is identical.

### (b2) Published steps, phone 390x844 (DONE 01:58 UTC)
- `S/logs/A_{live,new}_phone.out`: 23 of 23 steps ok on both, 0 console / page / request errors on both. Differences: random capsule / merge results; one live run spoke "Whole again." after Reconnect all and the new run did not (PG2 saw exactly this; re-tested below by `crun.mjs`).

### (b3) Saves crossing both ways (DONE 01:58 UTC; `S/logs/S_A0..A4.out`, stores `S/logs/store_A*.json`)
- A0 live save on live -> A1 on new: same squishy (Dollop, Common), "Hoard, 1 of 50 species, a gift is waiting", the same shelf ("Dollop, Common, 2 copies, 1 spare"), Trophies 1/20, the same settings plus the three new rows (Voices 60, Place sounds 50, "Squishies move on their own" on), the same hoard ghosts.
- A2: the new build switches autonomy off (settings written `v: 3 ... autonomy: false`). A3: that save on live (the rollback) loads with the same trophies, shelf and settings and keeps the unknown `autonomy` field. A4: back on new, "Squishies move on their own" is still off, nothing lost. 0 errors in all five.

### (b4) First-play download by request log (DONE 01:58 UTC; `S/logs/REQ_{new,live}.json`)
- Before Wake: new **1529.9 KB raw / 467.8 KB gzip in 11 requests**, live 1454.4 / 443.0 in 9: **+75.5 KB raw (+5.2 %), +24.8 KB gzip** (confirms A1: over SZ-01's 70 KB hard delta; PG2 measured +59.2). After Wake the new build fetches 15 lazy files, 367.1 KB raw / 134.1 KB gzip (PG2: 13 files, 318.7 KB), including `later-life` 68.6 KB and `later-brain` 112.7 KB together. 0 failed requests.

### (b5) Phone cut / reconnect re-test, cut with one out, the 23c684a60 save (DONE 02:20 UTC)
- `crun.mjs` (phone, cut and reconnect twice; `S/logs/C_{live,new}_phone.out`): the same line sequence on both builds, "Cut into 2 pieces. Bronze trophy: Clean Cut.", "Whole again.", "Bronze trophy: Whole Again." on both. The missing "Whole again." of (b2) is a timing artefact of arun, as PG2 found.
- **Cut with ONE squishy out** (`cut1.mjs`, 6 successive cuts then Reconnect all, dev servers of 23c684a60 on :5374 and HEAD on :5370; `S/logs/CUT1_{old23c,new}_desk.out`): pieces 2, 3, 4, 5, 6, 7 on both, particles 1284 / 966 / 648 / 810 / 972 / 1014 on both, fractions equal within 0.006 (the last sliver 0.028 vs 0.022: the scripted swipe is placed from the body's screen box, which sits 0.03 of the frame higher on HEAD), the same lines ("Cut into 4 pieces. Silver trophy: Four Little Ones."), 0 errors. Screens `S/shots/CUT1_old23c_desk_pieces.png` and `CUT1_new_desk_pieces.png` look the same. Unchanged.
- **A save made on 23c684a60** (its own build in `S/snap_old`; `oldsave.mjs` on its dev server: Wake, squeeze, stretch, 3 capsules, a second squishy brought out by the Hoard; `S/logs/save_23c.json`, journal done H1 to H5, 5 stamps): loads in the 23c prod build and in the new prod build with the same Journal (`S/logs/LS_{old,new}.json`): "A gentle squeeze / Watch it play / A big stretch / Open a capsule / Say hello: Done", 5 stamps ("5 of 25" on 23c, "5 of 80" on new: more chapters ship), 0 errors.
  The first wish never showed on 23c in 194 to 450 s of stepped sim (`S/logs/OLDSAVE2.out`, `OLDSAVE3.out`: `firstWishSent` true, no wish bubble, no wish on any character), so the cabin could not be opened by play on that build within my budget. I then set the cabin's open bit in that save (`pl |= 2, fw = [2, 0]`, `S/logs/save_23c_cabin.json`): **the 23c prod build shows Hearthlog Cabin open with "Go to", and so does the new build** (Home "5 of 10 stamps" kept, the five new places listed shut, "Opens at 12 / 20 / 28 / 36 / 45 stamps"); "Go to Hearthlog Cabin" travels on both ("New stamp: Who loves the cabin?"). 0 errors. Screens `S/shots/LS_{old23c,new}_cabin_{journal,places,cabin}.png`.
  On reload the save brings back only the play squishy (the other two wait on the quick-switch row) on both builds: not a regression.

**(b) verdict: PASS.** Every published step the same on both frames, saves cross both ways, the cut with one out unchanged, a 23c684a60 save keeps its Journal progress and its open cabin.

### (c) Every open place, 1280x800 and 390x844 (IN PROGRESS; `S/scripts/place.mjs`, one run per place and frame, `S/logs/PL_<place>_<frame>.{out,json}`, shots `S/shots/PL_<place>_<frame>_*.png`)
Method per run: the seed `S/logs/seed_p3.json` (a fresh dev profile, 6 capsules, journal stamps 45 + the cabin bit: every place open); Wake; the two others brought out by the Hoard (3 out);
the Places sheet opened by a real tap on the dock's Places button, "Go to <place>" by a real tap; then the sim PAUSED and stepped **180 s with no input**, sampled every 0.5 s
(LIFE's behaviour and target thing per squishy, the host's by-itself USE records `selfUsed`, every `stage.emote` icon and every `audio.creature` phrase caught by a spy); then the place's
actions by REAL mouse / CDP touch events (press on the upper part of a squishy and pull it out to carry it, steer, let go; taps on the things' screen points); quests from the journal;
four hard tosses (left, right-up, down, up) with every body checked inside the layout's bounds and the frame for 6 s; Home by the Places sheet. "Things used on their own" = the host's
by-itself USE records (`selfUsed`); "busy" = LIFE's behaviour USE / RIDE / NAP / BASK / ZONE on a thing, per squishy (independent of the host's count).

| Place | Frame | Things used on their own (host USE) | Per squishy (busy with) | Emotes (n: names) | Voices (n: phrases) | Player actions | Quests done | Hard toss | Home | Errors |
|---|---|---|---|---|---|---|---|---|---|---|
| Hearthlog Cabin | desk | **5**: rockerboard, kettle, snugbasket, yarnball, pillowswing | Glimglop: rocker, hearth (bask), yarn, basket, swing; Dollop: yarn, basket; Crimpo: rocker (ride), yarn, basket | 42: question 17, hello 7, star 7, sparkle 4, swirl 2, zzz 2, ball, puff, sun | 76: chirp 50, chirp-coo 5, coo-coo 5, coo-chirp-chirp 4 ... | fireplace tap; Glimglop carried onto the Pillow Swing (rides, onProp 3); two set on the Rocker Board ("New stamp: Two on the rocker"); yarn tap | C1 (arrive), C7, C10 on their own; **C5** by play | 4/4 inside | arrived, 3 out | 0 |

| Hearthlog Cabin | phone | **3**: kettle, rockerboard, snugbasket (+ a social moment at the yarn ball) | Glimglop: rocker, hearth (bask), yarn, basket; Dollop: yarn, basket; Crimpo: rocker (ride), yarn | 37: question 15, hello 8, star 4, ball 2, sparkle 2, zzz 2, snug, giggle, swirl, stretch | 64: chirp 47, coo-coo 4, chirp-coo-chirp 3 ... | fireplace tap; Glimglop onto the swing (rides); two on the Rocker Board ("Two on the rocker") | C1, C7, C10; **C5** by play | inside the room and the frame; a body that was on the rocker rested at (1.18, 3.60), 0.6 m in front of the tall bounds, at x 368 of 390 px (its edge at the frame's edge) | arrived, 3 out | 0 |

| Ripple Shore | desk | **2** in 180 s: pebbleball, driftlog (+ a social moment at the pebble ball); shellchimes only after my actions (3 by 260 s) | Glimglop: rock pool, drift log, shell chimes, sand mound; Dollop: pebble ball, shell chimes, sand mound; Crimpo: drift log only (ride 40 s). LIFE's own per-squishy counters credit 4 things (chimes, mound, ball, log) but the host wrote USE records for 2: walks to the chimes and the mound ended without a strike | 46: question 16, hello 10, zzz 7, swirl 4, snug 2, sun 2, ball 2, sparkle 2, bell | 59: chirp 37, coo 8, coo-coo 6, chirp-coo 4 ... | Glimglop and Crimpo carried into the Rock Pool (wet look 1, submerged 0.2, Glimglop rides the Bob Ring); squeeze after 20 s: **0 squirts** (neither is a foam: the squirt is foam-only by design; re-tested with a Wisplet below); 5 shell taps ("Ring the shells"); 2 on the Sand Mound ("Slide off the mound") | R1, R4 on their own; **R3, R9** by play | 4/4 inside | arrived, 3 out | 0 |

| Ripple Shore | phone | **2** in 180 s: pebbleball, sandmound (+ social at the pebble ball) | Glimglop: drift log (62 s), the pool for 0.5 s; Dollop: pebble ball, drift log; Crimpo: sand mound (ride 20 s), drift log. Nobody waded or floated in the Rock Pool on its own on either frame | 39: question 18, hello 7, zzz 6, sun 3, ball 3, star, swirl | 66: chirp 49, coo 8, coo-coo 5 ... | Glimglop into the pool (wet 1, rides the Bob Ring); my second carry to the pool missed by 1.6 m (the steer, not the game); 5 shell taps; 2 on the mound | R1, R4; **R3, R9** by play | 3 carried tosses inside (the left one did not lift) | arrived, 3 out | 0 |

| Frostbell Ridge | desk | **4**: snowball (14 s), glideramp (88 s), snowdriftnest (88 s), icepond (118 s) (+ reacted: snowball, steam pool) | Glimglop: steam pool (bask), ramp, nest (nap), icicle bells; Dollop: snowball, ramp (ride 20 s), bells, nest; Crimpo: ice pond (72 s), steam pool, nest | 47: question 24, ball 6, hello 5, sparkle 3, zzz 3, snowflake 2, swirl 2, sun, star | **149**: chirp 137 (!), chirp-coo 4 ... (2.5 x the other places: a stream of single chirps in the cold) | flick onto the ice: my toss landed Glimglop ON Crimpo (stacked, `S/shots/PL_frostbell_desk_act_ice.png`), so the player's ice slide is not shown by this run (Crimpo's own glide on the pond is); Crimpo set at the ramp top slid down 0.5 m ("Down the glide ramp" after 2); a friend under the pine, pine tapped: snow look 0.92 -> 1.0, "Snow from the pine"; 5 bell taps: "Ring the icicles" | I1, I2; **I4, I7, I9** by play | 4/4 inside | arrived, 3 out | 0 |

| Frostbell Ridge | phone | **2** in 180 s: snowdriftnest (81 s), snowball (100 s); **still 2 at 300 s** (watch extended to 300 s, no input) | Glimglop: ramp (credited by LIFE, no USE record), nest (nap, ride), steam pool (ride); Dollop: snowball (60 s); Crimpo: ice pond (27 s + 30 s + ride 19 s: never recorded as a use), nest | 39: question 14, hello 10, zzz 4, ball 3, swirl 3, snowflake 2, snug 2, note | 55: chirp 40, coo-coo 5, coo 4 ... | flick onto the ice: landed on the pond, slid 0.33 m (Glimglop, slime: sticky by design); Crimpo at the ramp top slid down ("Down the glide ramp" after 2); friend under the pine + tap: snow 0.58 -> 1.0, "Snow from the pine"; 5 bell taps: "Ring the icicles" | I1, I2; **I4, I7, I9** by play | 4/4 inside | arrived, 3 out | 0 |

| Rainleaf Garden | desk | **3**: seedpod (20 s), leafteeter (86 s), steppingstones (141 s) (+ reacted: drip leaf) | Glimglop: drip leaf, Leaf Teeter (ride 20 s), seed pod; Dollop: seed pod, Moss Bouncer, splash spots, stones; Crimpo: Moss Bouncer, teeter, stones | 39: question 17, hello 8, sparkle 3, droplet 3, star 3, zzz 2, ball, swirl, leaf | 63: chirp 46, chirp-coo 6, coo-chirp 4 ... | rain: all three wet (look 1.0) after the watch; drip leaf: my carry stopped 0.94 m short of the drip spot, the tap on the leaf registered, G7 "A shower from the leaf" was already done during the watch; **Moss Bouncer: Crimpo dropped on it 3 times from carry height (1.4 m): it landed and stayed, no rebound over 6 cm** (heights 1.38 -> 0.31 -> rest), yet "Boing on the moss" (G4, 3 bounces) was stamped; the pad is hidden under the flattened dough in the shot (`S/shots/PL_rainleaf_desk_act_moss.png`). Re-tested with every squishy below | G1, G7; **G4** by play | 4/4 inside | arrived, 3 out | 0 |

| Rainleaf Garden | phone | **1** in 180 s: leafteeter (67 s); **still 1 at 300 s** | Glimglop: teeter (ride 20 s), seed pod; **Dollop "USE seedpod" for 77 s + 74 s and Crimpo "USE steppingstones" for 60 s + 75 s while they moved 0.21 m and 0.05 m in 180 s**: two squishies stand still for 2.5 minutes "going to" a thing they never reach and never use (`S/shots/PL_rainleaf_phone_after_watch.png`, `..._watch_100s.png`) | 57: question 21, star 10, hello 7, ball 6, zzz 5, droplet 3, swirl 3, snug, postcard | 66: chirp 48, coo 5, coo-coo 4 ... | rain: Dollop and Crimpo wet 1.0, Glimglop 0; Glimglop carried under the Drip Leaf (0.005 m) + tap: wet 0.9 -> 1.0, "A shower from the leaf"; the leaf blade is drawn THROUGH Glimglop's body; Moss Bouncer x3 (Crimpo): small rebounds of 0.11 to 0.15 m, "Boing on the moss" | G1, G10; **G4, G7** by play | 4/4 inside (one in flight 0.05 m past the side at 1 s) | arrived, 3 out | 0 |

| Lanternroof | desk | **1** in 180 s: vanedisc (73 s); **still 1 at 300 s** | Glimglop: vane, chimney corner (nap 15 s); Dollop: vane (34 s); Crimpo: "USE starscope" 32 s + 48 s while moving 0.07 m (it lies asleep at the back, eyes shut, `S/shots/PL_lanternroof_desk_watch_100s.png`). All three end piled in the back right corner; the hammock's post and rope pass through Glimglop and the hammock's "Auto" chip sits on its face | 34: question 15, hello 11, snug 4, sparkle 2, zzz 2 | 56: chirp 35, chirp-coo 7, coo-chirp 6 ... | breeze: the Night Breeze gusted (level 1), the vane turned in 107 of 360 samples on its own; Star Scope tap: comet on, "A shooting star"; my carry to the Chimney Corner FAILED (the steer took it 5.5 m the wrong way: tool fault, not checked); Crimpo set on the Vane Disc: it turned in 7 of 24 samples; 5 lantern taps: "Light the lanterns" | L1, L4, L5 on their own; **L2, L3, L7** after / by play | 4/4 inside | arrived, 3 out | 0 |

| Lanternroof | phone | **2** USE: vanedisc (78 s), hammock (90 s); **5 with their own REACT records**: + moondish (gaze at the moon: "Moon watchers" stamped on its own), starscope (comet), chimneycorner (warm) | Glimglop: vane, chimney (bask), moon dish; Dollop: hammock (ride), moon dish, star scope; Crimpo: moon dish, "USE starscope" 48 s, chimney nap | 38: question 15, hello 9, moon 3, zzz 3, snug 2, swirl 2, star 2, droplet, sun | 60: chirp 37, coo-coo 7 ... | breeze gusts, vane turned in 114 samples on its own; scope tap: comet, "A shooting star"; Glimglop carried to the Chimney Corner (0.04 m) but its toast look stayed 0 after 15 s; Crimpo on the vane: turned 7 of 24 samples, 1 rider; 5 lantern taps: "Light the lanterns" | L1, L2, L4, L9 on their own; **L3, L5, L7** | 4/4 inside | arrived, 3 out | 0 |

**Counting rule, revised after these runs**: the host also records a by-itself engagement with a thing as a REACT (a wade, a glide on the ice, a shower under the leaf, a gaze at the moon) or a SOCIAL moment around it.
I count a thing as "used on their own" if it has a by-itself USE **or** REACT record (social moments listed separately). Re-counted: Hearthlog desk 5, phone 3; Ripple desk 2, phone 2 (with social: 2, 2);
Frostbell desk 5, phone 2 (with social 2); Rainleaf desk 4, phone 1 (with social 2); Lanternroof desk 1 (with social 1), phone 5. The verdict uses this count.
**Tier caveat**: SwiftShader makes `quality: auto` resolve to the LOW tier (dev overlay "low"), whose awake budget lets fewer squishies move at once (in the low-count runs two of three lay asleep in a USE behaviour).
The low-count runs are being repeated with quality forced to high (`S/logs/PL_<place>_<frame>_high.json`).

| Cloudloft | desk | USE 1: cloudnest (79 s); REACT updraft; SOCIAL cloudball ("Roll the cloud ball" U7 stamped on its own): **3 with social, 2 without**; still the same set at 300 s | Glimglop: "USE sunbowarch" 55 s (never recorded), nest nap 74 s; Dollop: puff pads, cloud ball 80 s, nest; Crimpo: pads, arch 40 s (never recorded), nest | 39: question 18, hello 9, sun 4, zzz 4, sparkle 2, ball 2 | 71: chirp 50, chirp-coo 6, coo 6 ... | Puff Pads: Glimglop dropped twice (one rebound of 0.24 m each), Dollop once (5 rebounds), "Boing on the puffs" (U2); updraft: Dollop fell straight through, Crimpo floated down slowly (1.43 -> 0.56 m over 4 s), "Float down slowly" (U3); my carry under the Sunbow Arch stopped 1.3 m short (tool) | U1, U7; **U2, U3** by play | 4/4 inside | arrived, 3 out | 0 |

**Counting rule, final**: a thing counts as used on their own if it has a by-itself USE, REACT or SOCIAL record (a ball passed between two counts). Counts with this rule: Hearthlog 5 / 4, Ripple 2 / 2, Frostbell 5 / 2, Rainleaf 4 / 2, Lanternroof 1 / 5, Cloudloft 3 / (phone pending) (desk / phone).

| Cloudloft | phone | USE 1: cloudnest (83 s); SOCIAL cloudball (U7 on its own): **2 with social**; at 300 s the same two | Glimglop: kite swing, cloud ball, nest; Dollop: cloud ball 62 s, nest; Crimpo: cloud ball, nest 66 s; all three asleep at the end | 42: question 18, hello 10, zzz 4, sun 3, snug 3, ball 3, bell | 56: chirp 37, coo-coo 5, coo 5, hum 3 ... | **Puff Pads on the phone: Glimglop 3 rebounds, Dollop 5, Glimglop again 1: they bounce**; "Boing on the puffs" (U2); updraft: Dollop hovered at 1.3 m for 1.5 s then dropped, Crimpo floated down 1.5 -> 0.67 m over 4 s, "Float down slowly" (U3); Glimglop set under the Sunbow Arch (0.03 m) | U1, U7; **U2, U3** | the left toss crossed the frame's left edge in flight (x 1 px at 0.5 s), then came back inside; 4/4 end inside | arrived, 3 out | 0 |


**Quality forced to HIGH (unitCap 2.494, moverCap 2; same seed and script; `S/logs/PL_<place>_<frame>_high.json`)**:
| Place | Frame | Low tier (auto on SwiftShader) | High tier | Note |
|---|---|---|---|---|
| Lanternroof | desk | 1 | **4** (USE vanedisc 62 s, hammock 93 s; REACT starscope, moondish; + social chimney corner = 5) | L2, L4, L5 on their own; every squishy moves (path 3.5 / 12.2 / 9.5 m against 2.9 / 3.9 / 0.07 at low) |
| Ripple Shore | desk | 2 | **3** (USE rockpool 28 s (a wade), driftlog 95 s, pebbleball 96 s) | all three move (5.6 / 7.7 / 7.4 m); Dollop also walks to the chimes and the mound |
| Frostbell | phone | 2 | **4** (snowball 17 s, glideramp 45 s, shakepine 126 s, snowdriftnest 131 s; REACT snowball, shakepine) | I2, I4 on their own; Dollop and Crimpo glide on the ice pond (ride 40 s each) |
| Ripple Shore | phone | 2 | **2** (USE pebbleball 43 s; REACT rockpool; still 2 at 300 s) | **fails at high too**: Glimglop and Crimpo start walks to five things each and finish none; 156 voices in 180 s (139 single chirps) |
| Cloudloft | phone | 2 | **2** (USE cloudnest 80 s, cloudball 110 s; still 2 at 300 s) | **fails at high too**: walks to the kite swing, the arch and the pads end without a use |
| Rainleaf | phone | 1 (2 with social) | **3** (USE leafteeter 124 s, seedpod 141 s; REACT dripleaf; stepping stones by 300 s) | G7, G10 on their own; all three move (6.3 / 5.4 / 5.0 m); Crimpo still stands at the stones 33 s without a use |


**Moss Bouncer drop re-test, every squishy, both frames** (`S/scripts/pads.mjs`, `S/logs/PAD_rainleaf_{desk,phone}.out`; each carried by real input over the pad and let go from 1.2 to 2.1 m; height sampled every 0.05 s):
desktop: Glimglop (slime) one rebound of **0.24 m**; Dollop (jelly) four small rebounds up to 0.08 m; Crimpo (dough) none. Phone: Glimglop **0.29 m**; Dollop four rebounds up to 0.13 m; Crimpo landed beside the pad.
So a drop on the Moss Bouncer bounces on both frames (clearly for slime, weakly for jelly, not for dough, which the family table allows). "Boing on the moss" (G4) stamped on both frames. 0 errors.
**Puff Pads** (from the place runs): desktop Dollop 5 rebounds, Glimglop one of 0.24 m; phone Glimglop 3, Dollop 5: they bounce on both frames; U2 stamped on both.

**Beach squirt with a foam, both frames** (`S/scripts/squirt.mjs`, `S/logs/SQ_{desk,phone}.json`; a Wisplet from capsules, brought out, Places sheet to Ripple, Wisplet carried into the Rock Pool, 20 s, a friend set near, Wisplet squeezed 1.4 s by real input):
desktop and phone alike: in the pool it rides the Bob Ring (wet 1.0), soak 0.3 -> **1.0 after 20 s**, the squeeze makes **1 squirt** (the arc of drops is drawn: `S/shots/SQ_phone_squirt.png`), soak falls to 0.73, **"A squirt for a friend" (R7) stamped**. 0 errors.


### (d) Home and the new features (DONE 05:30 UTC; `S/scripts/home.mjs`, `home2.mjs`; `S/logs/HM_{n3_desk,n5_desk,n1_phone}.out`, `HM2.json`; seed `S/logs/seed_home.json` = seed_p3 with H4, H5, H8, C8 done so all four things are shown)
- **3 out, desktop**: Music Box click: tune ON (`tune.on` true), a second click OFF; Warm Lamp click goes to the lamp (`tap: warmlamp`); Bounce Pad click goes to the pad (through a squishy: "through bouncepad (1)"); Keepsake Shelf: its centre click went to the Felt Ball that had rolled in front of it ("through feltball"), and in the re-test its centre, top and right end go to the shelf (`tap: keepsakeshelf`), its left end to a squishy walking past. Felt Ball click: the ball. 0 errors.
- **5 out could not be made: the mat stopped at 4** ("Granulo is out on the mat (4 of 4)"; the fifth "Bring out" did nothing) with this profile on the low tier. With **4 out**: Music Box on / off, Warm Lamp, Keepsake Shelf ("clear keepsakeshelf") all go to the thing; the **Bounce Pad click went to a squishy walking over it** ("moving crimpo": the through-tap only passes resting squishies, by design). MINOR (D2): a click on the pad can be taken by a passer-by; it works when nobody walks over it.
- **A still click on a resting squishy that covers the Music Box goes to the box**: Glimglop set in front of it (covering its screen centre), click there: `tap: musicbox`, "through musicbox (1)", the tune starts (`S/shots/HM_n3_desk_cover_click.png`). **It does not break the squishy**: on that covering squishy a 1.4 s squeeze gives poke / press / release, compression 0.19, press 1.0 (an uncovered squishy: 0.18, 1.0); a sideways pull gives grab / snap (compression 0.16); a still tap at its own centre pokes it (`miss`, no thing behind that point); it is picked up and carried 1 m (`carried: true`). (`S/logs/HM2.json`)
- **Phone, one out**: the Felt Ball (centre 309,445, r 41 px) stands **clear of the squishy** (centre 180,329, r 85): 48 px gap, no overlap (`S/shots/HM_n1_phone_party.png`). The Music Box, lamp, shelf and pad are hidden with one out on the phone (their `fromN`), as the data says.
- **"Who's coming?" chips** (Places sheet, 3 and 4 out): one chip per squishy out, 56 px tall, the one in hand marked "in your hand, always comes" and not toggleable; a tap on Dollop's chip: `aria-pressed` false, "Dollop stays at Home."; "Go to Hearthlog Cabin": the party arrives without Dollop (3 -> 2, 4 -> 3). Works.
- **Photo frame and Journal gifts in the trophies**: NOT checked in the browser (no time left in this window); `probe_r8_features` 9/9 covers them in node (the frame's thumbnail write and read, the gift sweep on a `gift` hoard event).
- DT-18 (Home things hidden behind the party): seen in the screens (with 3 out the Felt Ball and the Music Box sit partly behind squishies, `S/shots/PL_cloudloft_desk_home_back.png`); the through-tap makes them clickable. MINOR (D1).


### (e) Sound (DONE 05:40 UTC; `node _harness/sound_survey.ts --port=5376` on the copy, 77 s; `S/logs/sound_survey.{log,json}`)
- 76 sounds rendered offline through the game's own master chain: **0 clipped samples anywhere**; the worst master peak **-4.0 dBFS** at master 1.0 (the clip test); every place mix (Home, Hearthlog, Ripple, Frostbell, Rainleaf, Lanternroof, Cloudloft at master 0.8 and 1.0) `noClip: true`, master peaks -18.2 to -14.0 dBFS, voices 8.5 to 14.4 dB over the ambience, no stem more than 6.4 dB over its peers (rule 12 dB); 0 page errors.
- **No silent sound**: the quietest is the thing "tick" (peak -38.7 dBFS, 10 ms), which is also the one sound flagged with a **click at its start** (MINOR E1). The other note is informational (the cabin fire's bed swells 3.6 dB when the fireplace is tapped, as designed).
- Not measurable offline: how often voices play. In the place runs the voice spy counted 45 to 76 creature phrases per 180 s, but **149 at Frostbell (desk, low) and 156 at Ripple (phone, high), about 140 of them a single "chirp"** (MINOR E2: likely a chatter of chirps nearly every second; nobody has listened).
- Nobody has listened to any of it (no audio device here).


## Per place: OPEN-READY

Things used on their own in 180 s with no input (by-itself USE, REACT or SOCIAL record of the host; one run per place and frame at the LOW tier that `quality: auto` resolves to here; HIGH = quality forced high, run only where low fell short):

| Place | Desk (low) | Phone (low) | High rerun | OPEN-READY | Why |
|---|---|---|---|---|---|
| Hearthlog Cabin | 5 | 4 | - | **yes** | 3+ on both frames, each squishy in its own way, emotes (9 kinds) and voices, C5 by play, tosses inside, home again, 0 errors |
| Ripple Shore | 2 | 2 | desk 3, **phone 2** | **no** | below 3 on the phone even at high quality; at low nobody wades or floats on its own; the actions (pool, soak, squirt with a foam, shells, mound) and R3 / R7 / R9 work |
| Frostbell Ridge | 5 | 2 | phone 4 | **no at low, yes at high** | the phone at the low tier: 2 things by 300 s (Crimpo "uses" the ice pond for 76 s with no record); every action works (ramp, pine snow, bells, ice) |
| Rainleaf Garden | 4 | 2 | phone 3 | **no at low, yes at high** | the phone at the low tier: 1 USE by 300 s, two squishies stand still 2.5 min in a "use" they never finish; rain, drip leaf and the Moss Bouncer (both frames) work |
| Lanternroof | 1 | 5 | desk 4 | **no at low, yes at high** | the desktop at the low tier: 1 thing by 300 s, two of three asleep in a "use"; breeze, scope comet, vane and lanterns work; my chimney carry missed (not checked) |
| Cloudloft | 3 | 2 | **phone 2** | **no** | below 3 on the phone at BOTH tiers (2 by 300 s: nest and ball; walks to the kite swing, arch and pads end without a use); pads bounce on both frames, updraft floats, U2 / U3 by play |

## Findings (severity, repro, screenshot)

| Id | Severity | Finding | Repro / evidence |
|---|---|---|---|
| C1 | **MAJOR** | **Ripple Shore and Cloudloft miss the owner's bar on the phone at BOTH quality tiers: 2 things used on their own in 180 s (and still 2 at 300 s)**; Ripple also 2 on the desktop at low. Squishies start walks to the shells, mound, pool (Ripple) or kite swing, arch, pads (Cloudloft) and finish none | `place.mjs <dev> phone ripple seed_p3.json 180` (+ `Q=high`); `S/logs/PL_ripple_{desk,phone}{,_high}.json`; `S/shots/PL_ripple_phone_watch_100s.png` (all three piled at the log); `S/logs/PL_cloudloft_phone{,_high}.json` |
| C2 | **MAJOR** | **At the low quality tier the variety collapses at four more places**: Frostbell phone 2, Rainleaf phone 1 to 2 (two squishies frozen 2.5 min in a USE behaviour), Lanternroof desktop 1 (two asleep in a USE), Cloudloft phone 2. With quality forced high the same scripts give 4, 3, 4. The awake budget of the low tier (fewer movers) starves the by-itself uses; R9's node probe (SU-01) does not run the low tier or the tall phone layouts | `S/logs/PL_{frostbell,rainleaf,cloudloft}_phone.json`, `PL_lanternroof_desk.json` vs `*_high.json`; `S/shots/PL_rainleaf_phone_after_watch.png`, `PL_lanternroof_desk_watch_100s.png` |
| A1 | MINOR | First-play download +75.5 KB raw over the snapshot (SZ-01 hard cap 70 KB; three.core +14.9 KB since 23c684a60) | `S/logs/REQ_{new,live}.json`, fp.py |
| A2 | MINOR | The 150 KB life cap is met by splitting LIFE into `later-brain` (112.7 KB) loaded together with `later-life` (68.6 KB): 181 KB at Wake | `S/logs/build_new.log` |
| A3 | MINOR | `dist/assets` 2095 KB against D9 / SZ-02's 2000 KB (the build gate is still G0 3072 KB, so `vite build` passes); D-92 says the last-opening place should then ship false | `S/logs/build_new.log` |
| D1 | MINOR | Home things still drawn behind the party (DT-18 fails: shelf 95 % hidden at n3 tall, Music Box 54 %, lamp 95 % wide); clickable through resting squishies now | probe_pg_data DT-18; `S/shots/PL_cloudloft_desk_home_back.png` |
| D2 | MINOR | With 4 out a click on the Bounce Pad was taken by a squishy walking over it (`through: moving crimpo`) | `S/logs/HM_n5_desk.out` click_bouncepad |
| D3 | MINOR | 5 out could not be reached: the mat stopped at "4 of 4" with this profile on the low tier, so "five out" was not checked | `S/logs/HM_n5_desk.out` party |
| V1 | MINOR | Clipping and crowding: the Drip Leaf blade drawn through a squishy (Rainleaf phone); the hammock post and rope through Glimglop with the Auto chip on its face (Lanternroof desk); an emote bubble over the swing's Auto chip (cabin desk); the Shake Pine's crown cut by the top of the frame (Frostbell desk); the Sunbow Arch reads as one orange post on the phone; parties arrive piled on top of each other (Frostbell phone, Ripple phone) | `S/shots/PL_rainleaf_phone_after_watch.png`, `PL_lanternroof_desk_watch_100s.png`, `PL_hearthlog_desk_after_watch.png`, `PL_frostbell_desk_act_ice.png`, `PL_cloudloft_phone_arrive.png`, `PL_frostbell_phone_arrive.png` |
| V2 | MINOR | Cabin on a phone: a squishy rested 0.6 m in front of the tall bounds at x 368 of 390 px (its edge at the frame's edge) after other squishies were tossed | `S/logs/PL_hearthlog_phone.json` hard_toss |
| E1 | MINOR | The thing "tick" sound starts with a click | `S/logs/sound_survey.log` |
| E2 | MINOR | About 140 single "chirp" phrases in 180 s at Frostbell (desk, low) and Ripple (phone, high), 2 to 3 x the other places | voice spy, `S/logs/PL_frostbell_desk.json`, `PL_ripple_phone_high.json` |
| X1 | MINOR (note) | On 23c684a60 (the live build) the first wish never showed in 194 to 450 s of stepped play with 3 out (`firstWishSent` true, no wish on anyone); not re-checked on HEAD | `S/logs/OLDSAVE2.out`, `OLDSAVE3.out` |

No BLOCKER: 0 console errors, 0 page errors, 0 failed requests in every run (32 browser runs); every published step and both save directions unchanged; no trace of Fizzwell Tub, Cogwhistle Bench or Echo Hollow in any Places sheet or build string a player can see; every hard toss ends inside the play area.

## Ready to deploy with all six places open: **NO**, because
the owner's bar for a place (3 different things used on their own in 180 s, on both frames) is met only by Hearthlog Cabin at the tier this machine resolves to; Ripple Shore and Cloudloft miss it on the phone even at high quality (C1); Frostbell, Rainleaf and Lanternroof miss it on one frame at the low tier only (C2). Everything else (regression, saves, actions, quests, tosses, Home clicks, chips, sound levels) holds.

**To make a deployable build**: set `shipped: false` for **Ripple Shore, Frostbell Ridge, Rainleaf Garden, Lanternroof and Cloudloft** (in `src/data/places.ts` PLACE_INFO and each PlaceDef's own `shipped`), leaving Home + Hearthlog Cabin, which is the live content plus rounds 6 to 9's fixes. If the owner accepts the HIGH tier as the measure (devices fast enough for it), close **Ripple Shore and Cloudloft** and keep Frostbell, Rainleaf and Lanternroof (they reach 4 / 3 / 4 at high; low-end devices would see 1 to 2).
**Is that reduced build ready?** Not verified: I built and ran neither reduced build. Everything it keeps passed here (Hearthlog both frames, Home, regression, saves, 0 errors), and PG2 verified a Home + Hearthlog build before; it needs one build and a short smoke run (Places sheet lists only Home and the cabin, the cabin's travel, no "Opens at" line for a closed place, a save whose journal has the closed places' bits still loads) before deploy.

## What was not checked
- Audio by ear (no device); voice frequency only counted.
- The photo frame (Friendship Frame thumbnail) and Journal gifts on the trophies shelf in the browser (node `probe_r8_features` 9/9 only).
- 5 out at Home (mat capped at 4 here); landscape phones, 320 px, Calm / reduced motion; keyboard and screen-reader paths of the new UI.
- The chimney carry at Lanternroof desk and the Sunbow Arch carry on desktop (my steering missed); the Leaf Teeter and Kite Swing by the player; the player's ice flick on desktop landed on another squishy.
- Places at the MED tier; real GPUs and devices (SwiftShader only); more than one run per place and frame at each tier (the counts are single samples of a stochastic simulation).
- The first wish and cabin opening by real play on HEAD (the place runs used a journal with 45 stamps); frame cost / performance.
- The 23c684a60 save's cabin bit was set by hand (`pl |= 2`), because its first wish did not show in my budget.

