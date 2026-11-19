# R10_PLAYUX: round 10b, the PLAY-UX engineer (Float for everyone; an easier way to take squishies out). No git write command is run.

Brief: the orchestrator's round-10b task (owner, 2026-11-19: "looks like gravity is broken - float doesnt actually make them float. also there needs to be an
easier way to take out squishies for them to play together"). Later in the round: item 3 (rotate with right click while cutting) and item 4 (cut any/all with a party).
Started 2026-11-19 at HEAD 2226640db, with the R10 FIX engineer editing the same tree. Ports 5360 to 5363.
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r10_playux/` (`S/` below).

## Status
| item | what | state |
|---|---|---|
| 1 | Float floats everyone everywhere (D-97 replaces D-83) | DONE: probe_float 14/14; browser_float 22/22 (both frames, 1 and 3 out, Home and the cabin) |
| 2 | an easier way to take squishies out to play together | DONE: probe_party 10/10; browser_party 26/26 (both frames, after the desktop label fix) |
| 3 | rotate with right click while cutting (D-98) | DONE: node_checks 186/186 (one row re-specified, one new); browser_cutparty D-98 rows pass |
| 4 | cut any/all with a party (D-99) | DONE for ANY one squishy (the stroke chooses), then another after Reconnect all: probe_partycut 6/6, browser_cutparty 10/10; ALL AT ONCE not done (one cut tree) |

## 1. Float

### Causes (reproduced)
Browser (`S/float_repro.mjs`, 1280x800, real click on the dock's Float, one squishy at Home): the body's centre rose only **0.13 m** (0.304 -> 0.429) and stayed
there. Node (`S/hover.ts`, the real SoftBody): a resting starter rose **0.05 m** (0.395 -> 0.445; the hover aims at 0.86).
1. **Float failed with ONE squishy at Home too (a separate physics bug)**: the table's tack layer (softbody.ts table pass, `glue`) and its peel damping still acted
   in float mode. Float chosen while the body RESTED on the table kept its foot glued; the weak hover spring only stretched it up. (A body that boots in float, `?float=1`,
   starts in the air and never touched the tack, which is why the published rows never saw it.)
2. **The hover pulled every body to the world origin** (`ax = -w2 * cx`): an extra built at x 1.3 slid to x 0.2 in 2 s (node). This is the collapse D-83 hid.
3. **D-83 in the life host** (`later-life.ts` floatRule): with more than one squishy out, a cut, or at any place it forced `body.gravity = true` and
   `stage.setFloatMode(false)` (the saved setting said Float, the dock showed Float pressed, nothing floated; one toast "Here your squishies stand on the ground."
   per session, easy to miss).

### Changes
- `src/physics/softbody.ts` (3 small edits): the hover spring holds the body over its HOME (`homeX/homeZ`: the origin for the play body as before, a mat
  squishy's or a piece's own spot, where LIFE last brought it to rest); the tack layer is off while floating; a floating body with place bounds is corralled by
  them (Home's home corral stays table-only as published); NEW gentle descent: for 2 s after gravity comes back, or until a support is reached, the fall speed is
  capped at 0.9 m/s (`DESCEND_S`, `DESCEND_V`, field `descendT`, reset() clears it).
- `src/shell/later-life.ts` (the Float rule): Float floats every squishy out at every place; every body's gravity follows the setting; on Float each squishy's
  hover spot is where it stands (`floatHome`: a walk is ended, the spot is kept inside the place's area by radius + 0.25 m); the place's prop world stays bound and
  stepping, Home's things stay shown (not parked); the player's taps and grabs on things work while floating; LIFE's autonomy is off while floating (no walks,
  hops, self-started uses or rides; emotes, looks, voices go on), AUTO chips hide; Table restores everything. The "stand on the ground" line is gone.
- `_harness/probe_float.ts` (new, real SoftBody + props + LIFE + host): 14 rows.

### Measured (node, `node _harness/probe_float.ts`: 14/14, 37 s)
| case | rise (min over 20 s) | drift | closest pair | Table: fall max / at rest |
|---|---|---|---|---|
| 1 out, Home | 0.417 m | 0.000 m | - | 0.91 m/s / 1.32 s |
| 3 out, Home | 0.259 m | 0.005 m | 1.03 m | 0.96 m/s / 1.73 s |
| 3 out, Hearthlog | 0.23 m (capnap, tall) | 0.000 m | 1.51 m | 0.94 m/s / 2.40 s |
| 3 out, Ripple | 0.23 m | 0.000 m | 2.22 m | 0.94 m/s / 2.22 s |
Shove 6 m/s toward the nearest edge while floating: caught inside (peak -0.53 m Hearthlog, -0.27 m Ripple, i.e. inside the edge). Floating 60 s with 3 out:
emote 2, voice 4, gaze 45, scoot 0, hop 0. Cut while floating: both halves float (y 0.77) 0.37 m apart (they used to be pulled together).

### Browser (`node _harness/browser_float.mjs`, port 5361; first run)
- The first run failed `home1` desk "stays in frame" 20 of 20 samples: one squishy at Home now floated 0.51 m, and Home's camera (D-37: the autonomy framing aims at
  the body's REST spot and the band framer measures it at rest) let its top leave the frame (shot `_harness/_renders/float/float_home1_desk.png`, the old one).
  Fix in `src/render/stage.ts` (2 lines): while Float is on each body is measured live by the band framer and the single body is followed (as the published toy did).
  Re-run: home1 desk rise 0.504 m, 0 off-frame samples, Table at rest 0.75 s; cabin1 desk rise 0.442 m, 0 off-frame, at rest 0.5 s.
- Spec: D-97 appended at the end of `_spec/PLAYGROUND_BUILD.md`; the D-83 row there and P12 in `_spec/PLACES.md` are marked SUPERSEDED. No probe row asserted
  D-83's forced table (grep of _harness for D-83, floatParked, "stand on the ground", gravity forcing: none), so no row was re-specified.

## 2. Friends strip (in progress)
- **Today's path** (read from the code, measured in the browser row): Hoard button -> a plinth -> its card's "Bring out" (the Hoard closes) = 3 taps for the second
  squishy, 6 for the third; nothing on the play screen says it can be done (the HUD's "Your squishies" button is icon-only and only lists who is out; the quick
  switcher swaps the play squishy, it never adds one).
- **New**: `src/ui/later-party.ts` (+ `party.css`, the pure `partyPick.ts`), attached by `ui/later-play.ts` (the later-play chunk: no first-play bytes). A labelled
  "Friends" pill with a plus right after the name tag in the info row; once friends are out it shows their faces. A tap opens a small card "Friends out to play" with
  "N of cap", "Bring friends" (one tap fills to the cap: most recently played, then hearted, then newest; one copy per species) and a face per owned species (tap: out /
  back; the one you play with is marked). The mat decides (tier cap, frame-time guard): a refusal is said in the card and the live region. The Hoard card's "Bring out"
  now reads "Take out too" (+ icon); browser_shell.mjs's 4 rows that matched /Bring out/ accept either word (written reason at the helper).
- Node: `node _harness/probe_party.ts` 10/10.

## 3. Rotate while cutting (cause)
`src/shell/game.ts` input port: with the Cut tool every pointerdown went to the blade branch, which returned for any button but the left one; so a right or middle
drag did nothing (node_checks even asserted it: "a right drag in the Cut tool is nothing: not a blade"). Touch: a second finger was ignored while a stroke was down.

## 4. Cut any squishy of a party (cause)
`src/shell/cut.ts` cuts only the play body: `swipe()` aims at the play body's pieces (`targetOf`), so a stroke across another squishy out was a "miss". The cutter
holds ONE tree of pieces anchored on the play body (identity, HUD, Reconnect all, joins, piece cache), so cutting several at once is not possible without a cutter per
squishy; the honest most is "any one, chosen by the stroke, then another after Reconnect all" (D-99 at the end of PLAYGROUND_BUILD.md, with what "all at once" needs).

### Item 2 browser (first run, `node _harness/browser_party.mjs --port=5362`: 26/26, both frames)
- Taps by real input: BEFORE (the Hoard's path) 2 out in 3 taps, 3 out in 6; AFTER (the strip) 2 out in 2 taps, 3 out in 3; "Bring friends" fills to the cap in 1 tap
  from the picker (1 -> 5 on high); at the cap (low: 3) the next face is refused with "3 can play at once on this device. Send one back first."; the Hoard card's
  "Take out too", the quick switcher and the Cut with one out still work; 0 console errors.
- **Looked at the shots as a designer** (`_harness/_renders/party/*.png`): phone good (the "+ Friends" pill in the info row; faces of the friends out; the picker
  above it leaves the squishies visible). DESKTOP BAD: the row between the name tag and the dock is ~100 px, so the strip stepped down to a bare amber "+" with no
  word (the row passed only because the word was in the DOM). Fixed: on the wide layout the strip stands on its own line right above the name tag and the quick
  switcher's row moves up one line (party.css); the row now also requires the word to be VISIBLE (form not 'icon', label >= 40 px wide).

## 3. Rotate while cutting: change
`src/shell/game.ts`: with the Cut tool a right or middle mouse press is a view drag (Snap's drag map and orbit), never a blade; a left stroke in progress is untouched;
on touch a second finger drops a finger's stroke and the two fingers pinch-zoom (one left turns the view). `isDown` already answers for the view drags.
node_checks: the SHELL-4 row that asserted "a right drag in the Cut tool is nothing" is RE-SPECIFIED (written reason in the row: D-98) to "it orbits and is never a
blade"; a new D-98 row (middle drag orbits, right drag during a left stroke orbits and the stroke still cuts, two fingers pinch, a lone finger cuts).

## 4. Cut any squishy of a party: change
- `src/shell/bodies.ts` `exchange(body)`: a whole shared extra becomes the play squishy where it stands (stage.setPrimaryBody; the old play body stays out as an extra
  with its own view; nothing rebuilt or moved; identity follows, not silent: the name tag and the live line say who is in play).
- `src/shell/game.ts`: the Cut stroke's release: when `cut.swipe` misses and the stroke crosses another whole squishy (16 samples, nearest hit) -> exchange + the same
  stroke cuts it; while one squishy is in pieces -> "One squishy at a time: Reconnect all, then cut another." (notice) and nothing is cut. One out: unchanged.
- `src/shell/cut.ts` optional dep `homeSpot()`: Reconnect all glides / rebuilds the whole at the squishy's own spot after an exchange (null = the middle, as published).
- `_harness/probe_partycut.ts` (REAL SoftBody + LIFE host rig): 6/6 (C1 cut a non-play squishy; C2 back together at its own spot 0.000 m off, wholes >= 1.14 m apart;
  C3 refused in words while one is cut; C4 then another; C5 one out = the published cut).
- D-98 and D-99 appended at the end of `_spec/PLAYGROUND_BUILD.md` (D-99 says what "all at once" would take).

## Probes after all four items (sequential, `S/suite.sh`, 2026-11-19 ~06:50 UTC)
node_checks 186/186 (185 + the new D-98 row; the SHELL-4 isDown row re-specified for D-98); probe_float 14/14; probe_party 10/10; probe_partycut 6/6;
probe_app 188/188; probe_gestures 160/160; probe_cut 17/17 (142 s); probe_playground (quick) 74/74; probe_r8_features 9/9; probe_life 127/128 (LF-02, the known
lifeStep allocation row, identical numbers to VERDICT_R9 / R9_FIX: pre-existing, src/life untouched by this lane). tsc clean.

## Browser checks (final run, `S/bsuite.sh`)
Run with `WH_FROZEN=1` (vite.config.ts: no HMR, no watching): the first final run of browser_party.mjs died at its 7th row when another engineer's edit reloaded
the dev page (`window.__WH__` undefined). Commands: `WH_FROZEN=1 node _harness/browser_party.mjs --port=5362`, `WH_FROZEN=1 node _harness/browser_cutparty.mjs
--port=5363`, `WH_FROZEN=1 node _harness/browser_float.mjs --port=5361` (each about 10 to 20 min on this loaded machine; `--only=desk|phone`).
- browser_party.mjs (frozen): **26/26**, both frames. Desktop now shows "+ Friends" with its word above the name tag (label 53 px wide, form full), the quick switcher
  one line up; 3 out: two faces + "+ Friends", nothing overlapped, no squishy disc under it. Shots `_harness/_renders/party/{party_1out,party_picker,party_picker3,
  party_3out,party_full,party_cap}_{desk,phone}.png` (looked at).
- browser_cutparty.mjs (frozen): **10/10**. D-98 desk: a real right-button drag with the Cut tool turned the camera yaw 0.21 -> -2.03 rad and cut nothing; a left
  drag then cut (2 pieces). D-99 desk and phone (3 out, real mouse / CDP touch): the stroke across Puddlo (not the play squishy) cut Puddlo (name tag "Puddlo", 2
  pieces, 3 out); a stroke across another while it was cut said "One squishy at a time: Reconnect all, then cut another." and cut nothing; Reconnect all (its bar
  button) gave 1 piece and 3 out; 0 console errors. Shots `_harness/_renders/cutparty/*.png` (looked at: the cut squishy's halves at its own spot, the others whole).
- browser_float.mjs (frozen): **22/22**. Rise (lowest centre over its table rest, every second of 20 s) / off-frame samples / Table at rest:
  desk home1 0.514 m / 0 / 0.75 s; desk cabin1 0.442 / 0 / 0.75; desk home3 0.316 / 0 / 0.75; desk cabin3 0.318 / 0 / 0.75; phone home1 0.466 / 0 / 1.0;
  phone cabin1 0.499 / 0 / 0.75; phone home3 0.335 / 0 / 0.75; phone cabin3 0.321 / 0 / 1.0; 0 console errors both frames. The 3 out are taken out by the Friends
  strip (real taps). Shots `_harness/_renders/float/float_{home1,cabin1,home3,cabin3}_{desk,phone}.png` (looked at: everyone up off the floor with shadows, in frame).

## Size (T1)
Not measured by a build (the machine was busy; the other engineer owns the size work). Measured by module: the Friends strip adds 7.2 KB minified JS (rolldown, deps
external) + 2.9 KB minified CSS (lightningcss) to the LAZY later-play chunk; the first-play files grow by about 1.5 KB (game.ts stroke routing and view drags,
bodies.exchange); softbody and later-life changes are net about +0.5 KB. So T1 (all assets) grows by roughly 12 KB: this makes the failing 2000 KB gate WORSE by
that much. Not offset.

## Not done / open
- Cutting SEVERAL squishies at the same time (D-99 says what it takes: a cutter per squishy).
- T1 +~12 KB (above).
- After an exchange the play squishy is the cut one (the name tag follows); the history notes it, so a reload starts with it. Reconnect returns it to the spot it had
  when the stroke chose it, not to where LIFE may have walked it since.
- The whole browser_shell.mjs was not run (70 min); its 4 rows that matched "Bring out" now accept "Take out too"; the quick switcher row moves up one line on the
  wide layout while the Friends strip shows (no browser_shell row measured its exact height, but sections that compare it with the name tag were not re-run).
- probe_life LF-02 (lifeStep allocation) fails as before this round (src/life untouched here).
