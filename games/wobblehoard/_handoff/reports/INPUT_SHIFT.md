# INPUT-SHIFT report (lane SHELL, input part): Shift + drag pulls both sides on PC

Branch claude/exciting-faraday-2dakqx, local HEAD 13bf8f55 at start (nothing committed by this engineer: the orchestrator commits).
Owner decision (2026-10-06): on a mouse or pen, holding Shift while dragging on a squishy pulls BOTH sides at once, like two fingers on a phone.

## Status: complete, with one open physics issue and three decisions for the owner (see the end)

| # | Item | Result |
|---|------|--------|
| 1 | gestures.ts mirror state machine | DONE. Differential against the old machine (commit 13bf8f55): 25 000 random scripts, 1 513 220 actions, 0 differences |
| 2 | pointer.ts, game.ts facade, driver.ts pass-through | DONE |
| 3 | Feedback per slot, the meter pays the pair once | DONE |
| 4 | Hint text (desktop only), Settings Keys line | DONE |
| 5 | probe_gestures rows | 73 -> 123 checks, all pass |
| 6 | Real-physics checks | DONE (probe_gestures section 11, node_checks 7e) |
| 7 | probe_app / node_checks rows | probe_app 160 -> 181; node_checks 114 (10 new) |
| 8 | Browser check | DONE (real mouse, real Shift key, real physics and audio) |

## Design as built

**Trigger and rule** (`src/input/gestures.ts`). `PointerSample.shift?: boolean` (additive). It is read ONCE, by the move that commits a press to
a pull (the existing outward drag past the 14 px slop with cos > 0.2; the up that commits counts too). If it is true and the other body slot is
free (no Space finger, no second touch, no earlier mirror), the machine reflects the press point through `host.bodyScreen()` and ray-tests it with
`host.hitTest`; on a miss it shrinks toward the centre x0.92 per try down to x0.5 (nine tries: 1, .92, .846 ... .513). On a hit it emits a second
`grab { slot: other, vertex, target, mirrorOf: realSlot }` right after the real grab. The target is `host.planePoint` of the pointer reflected
through the centre, on the camera-facing plane through the mirrored vertex (as the real grab's target is on its own). On every later move it emits
`grabMove` for the real slot, then for the mirror slot from `2 * liveCentre - pointer` (the centre is re-read on each move). The other slot busy,
a lost body, or nothing hit = the plain single pull, silently. A gesture never changes mode midway: Shift released later keeps the mirror, Shift
pressed later does nothing. Pointer up, cancel, a duplicate down, `cancelAll` and a lost body emit `grabRelease` for both slots, real first,
exactly once each (why `up` or `cancel`). A mirror slot counts as busy, so a third finger on the body is ignored. Without `shift` no new code
path runs: the action stream is bit for bit the old one (no `mirrorOf` key is even present). `GestureSnapshot` gained `mirror: Slot | -1`.
`src/contracts.ts` is untouched.

**Glue.** `pointer.ts` passes `shift: true` from mouse and pen pointer events only (down, move, up, and the lost-button up); a touch never carries
it. The facade (`game.ts` `PointerIn.shift`) passes it through and also drops it for `type: 'touch'` (Space's synthetic finger and the debug hook
are `touch`). The Cut and Snap tools and ceremonies return before the gesture machine, so there is no mirror there.

**Driver** (`driver.ts`). The `grab` action's `mirrorOf` marks the slot (`touch.mirrored[slot]`); a release marks the step at which that hand's
`snap` is drained (`touch.mirrorEvent('grab' | 'snap', slot)`, the same step-count trick as `skipRelease`). `touch.pullFor` is 0 for the mirrored
hand, so the pending arc shows ONE stretch. New: `SHIFT_FLOOR_Y = 0.02`: while a Shift pair is held on a table (gravity on), neither hand is asked
for a point lower than 2 cm above the table (see "Physics"; a lone finger and two real fingers are untouched).

**One pull, one set of feedback, one payment.** The second hand's `grab` and `snap` SoftEvents are flagged `twin` where the game drains them
(`game.ts` `drainBody`): `feedback.handle(ev, twin)` makes no stretch voice, release sound, haptic, shake, bubbles, pops, stat or toss for them, and
the game does not feed them to the collection (no meter pay, no Tasks count, no spark). The one voice and the one release are panned from the real
finger. The strand and tension logic still reads both slots (the stronger one).

**Hint.** `HINT_TEXT.pointer` = "Click to poke · hold to squish · drag out to stretch · Shift + drag pulls both sides" (mouse or pen only; the touch
line is unchanged and a phone never shows it). Pressing Shift alone is not a "key used" (keyboard.ts ignores it), so the line does not flip to the
keyboard wording. The Settings "Keys:" line (shown for a fine pointer or once a key was used) gained "Shift + drag pulls both sides". The other
strings the ECON engineer listed (hint.ts, playTarget.ts:22, settingsPanel.ts:104, hoard/panel.ts:345, hudBinding.ts:307, toyTray.ts:12) name actions
("poke, squeeze, stretch"), none promises a reward, so they are left; "Squish to earn capsules" (hoard/panel.ts:343, collection/copy.ts:21) is true
because a held squeeze and a stretch still pay. Not changed: nobody asked for a reorder of "poke" first.

## Files changed (this task only)
`src/input/gestures.ts`, `src/input/pointer.ts`, `src/shell/game.ts` (PointerIn.shift + facade pass-through; the 3-line `twin` skip in `drainBody`),
`src/shell/driver.ts`, `src/shell/feedback.ts`, `src/ui/hint.ts`, `src/ui/settingsPanel.ts`, `_harness/probe_gestures.ts`, `_harness/probe_app.ts`,
`_harness/shellview/node_checks.ts` (section 7e), `_harness/browser_shell.mjs` (sections shift-pull, shift-hint-reflow, shift-touch),
`_handoff/reports/INPUT_SHIFT.md`. Not mine and not touched by me (already modified in the tree): `package-lock.json`,
`_handoff/reports/VERIFY_ECON_NOTAP.md`.

## Checks (commands run on the final tree; tsc clean throughout)
* `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: clean (no output).
* `node _harness/probe_gestures.ts`: **123/123** (was 73). New: the mirror (order of actions, slots, vertex, mirrored targets, one pull gesture, snapshot,
  third finger ignored), later moves mirrored, the LIVE centre, Shift released mid-drag, up / cancel / cancelAll / duplicate down release both once, nothing
  leaks afterwards, Shift after the press ignored, Shift at the press only ignored, slop respected, commit on up, fallbacks (second touch before and after,
  Space's finger, no late mirror), a freed slot, the real finger on slot 1, the miss ladder (x0.92 steps, last try x0.513, 9 tests then none), a lost body,
  Shift on empty space / right button / rub / tap changing nothing, a pinned hash of 300 no-Shift fuzz streams (computed from the OLD machine), a Shift fuzz
  (600 scripts x 260 events, Space finger, second touches, cancels, a sliding or lost body, holes in the ray: 0 violations, 253+ mirrors, deterministic),
  and the REAL SoftBody rows (below).
* `node _harness/probe_app.ts`: **181/181** (was 160): the 21 new rows drive the facade with the mock body (two grabs, mirrored targets, one voice, one release,
  one payment, the same stats, the pending arc, pen, touch, Space, hidden / context loss / covering panel / cancel release both once, Snap tool).
* `node _harness/shellview/node_checks.ts`: **114/114**; 10 new in section 7e (pointer glue: mouse, no Shift, pen, touch, lost button; then the whole game on the
  real SoftBody and the real collection: Shift, plain, touch, feedback, meter).
* Mutation check of the new rows (copies in a scratch snapshot): (1) twin never set, (2) mirror not released, (3) mirror slot not counted busy, (4) mirror target
  not reflected, (5) facade lets touch through, (6) a late Shift mirrors, (7) the floor clamp removed. Each made the rows that should catch it FAIL (for example
  (1) 4 probe_app rows: voices 2, release 2, pops 6, meter 1.3647 vs 1.3250; (7) 3 of 21 pulls turned the mesh inside out, volume -0.49 .. 2.21).
* Browser (Chromium + SwiftShader, port 5366, `--only=desktop-boot,shift-pull,shift-touch`): `desktop-boot` + `shift-pull` + `shift-touch` **29/29** (desktop-boot 20, shift-pull 7, shift-touch 2) on the final tree, and `shift-hint-reflow` **3/3** (run alone). Rows: the desktop hint names the Shift pull on one line at 15 px; the Shift key alone leaves the pointer wording; a real mouse Shift drag of 1.50 x maxPull gives two grab events (fingers 0 and 1; the page saw shiftKey on 8 pointermoves), Shift let go mid-drag keeps both hands, two snaps at 1.00 / 1.00, one audio.release, metrics.carried false on all 379 sampled frames, the body back at volume 1.000; the same drag without Shift is one grab, carried, one snap; a CDP touch drag with the Shift modifier (the page saw shiftKey on touch events) = one grab; the touch hint has no Shift; at 320 x 568 with a MOUSE the longer hint is two lines at 12 px, inside the screen and clear of the bottom row, at 568 x 320 one line at 13.5 px. Console and network errors were NOT checked in these runs (that section was filtered out).

## Numbers

### Meter: what the mirror would pay if fed, and what the game pays
Real collection feed (`createCollection`, `collection.feed`), current pay constants (pullBase 1.0 + 0.65 SP per second held, freshness tau 3 s, floor 0.03).
The second hand's snap, fed, is a second pull inside the freshness window and pays 0.03 of the pull:

| previous pull | extra SP of the mirror if fed |
|---|---|
| none, or 3 s or more ago | +3.0 % (every hold: 0.2 s 1.130 -> 1.164 SP, 3 s 2.950 -> 3.038 SP) |
| 2 s ago | +6.7 % |
| 1 s ago | +26.5 % |

That is over the 5 % line at any cadence under about 2.3 s, and it would also double a "pull N times" Tasks goal and the pull stat, so **the pair pays ONCE**
(shell-side, as above). Through the whole game on the real SoftBody a Shift pull pays 2.2693 SP and the same pull without Shift 2.2693 SP (difference
< 1e-6; node_checks 7e). In probe_app (mock body) 1.3250 vs 1.3250. Freshness is therefore the same as a single pull's.

### Physics (real SoftBody)
* Through the game (createApp + real SoftBody + real collection, Dollop, press 0.75 r right of the centre, drag 1.8 x maxPull, 1 s hold, 8-frame flick, let go):
  Shift = two grabs (fingers 0, 1), two snaps at pull level 1.00 / 1.00, both sides of the skin out 0.64 / 0.71 maxPull beyond the rest edge, `metrics.carried`
  never true, no lift or toss voice, lowest particle at the table. Plain = one grab, carried, one lift voice, one toss. Touch with the Shift flag = one grab,
  carried (never mirrors).
* probe_gestures section 11 (gesture actions -> the real driver -> the real SoftBody, the game's camera, 1280 x 800): dollop, cushlet, munchip, twangle: 4/4 Shift pulls
  carried false, both snaps >= 0.95, each side out >= 0.4 maxPull (measured 0.51 to 0.77); 4/4 plain pulls lift; no NaN, nothing under the table.
* Browser, real mouse: Shift + drag 1.50 x maxPull (lift limit 1.15): two grab events (fingers 0 and 1), two snaps at 1.00 / 1.00, ONE `audio.release`,
  `metrics.carried` false on all 359 sampled frames, body back at volume 1.000 after the let-go; the same drag without Shift: one grab, carried, one snap.
  Screenshot judged: `_shots/shell/shift_pull_desktop.png` (both tips stretch out left and right, the body stays on the table).

### Two-handed pulls in the game's camera geometry: creases (OPEN, needs the PHYSICS lane) and the floor clamp (done here)
Scratch sweep (`inshift/phys7.ts`, 6 species dollop, wrigglo, cushlet, twangle, chunkle, munchip x 7 press points, drag 1.8 x maxPull, 38 cases that hit; mock stage
camera 800 x 600; dihedral fold = the physics lane's fold meter):

| input | fold > 120 deg | fold > 150 deg | carried | NaN | under table | volume outside 0.5 .. 1.5 |
|---|---|---|---|---|---|---|
| Shift pull, no floor clamp | 27 / 38 | 22 / 38 | 0 | 0 | 0 | **3 / 38** (-0.97 .. 3.08) |
| two real fingers (touch) at the same two points | 24 / 38 | 18 / 38 | 1 | 0 | 0 | 3 / 38 |
| single finger (it lifts) | 7 / 38 | 7 / 38 | 38 | 0 | 0 | 0 |
| **Shift pull with the floor clamp (as shipped)** | 29 / 38 | 21 / 38 | 0 | 0 | 0 | **0 / 38** (0.95 .. 1.06) |

So a Shift pull behaves like two fingers on a phone today (same creases in the same cases): the physics lane's own two-grab rows press from the SIDE (horizontal
rays) and do not see it; the game presses the FRONT surface and drags in the camera plane. The inversions came from presses near the top of the dome, where the
mirrored hand is dragged DOWN through the table (the physics has no answer for a two-handed grab target under the table); `SHIFT_FLOOR_Y` removes them (0 of
38, and 0 of 21 in the permanent row, which fails with the clamp removed). The creases (fold > 120 deg in 29 of 38) are NOT fixed by it and are the physics lane's.

## Not run / known issues
* Not run: the full browser_shell run (only `desktop-boot`, `shift-pull`, `shift-hint-reflow` and `shift-touch` ran; the console-and-network section was filtered out, so "0 console errors" is not a reported row; the reflow / touch-phone sections at 320 px use touch
  contexts, which never show the Shift line, and were not re-run); `_harness/run_probes.ts` (the full probe suite); the render and audio harnesses. Nobody has listened
  to the sounds (one voice, one release: counted, not heard).
* A real pen was never used: the pen path is tested through the pointer-glue stub and the facade only (spec: pen mirrors like a mouse).
* The mirror shrink (x0.92 .. x0.5) keeps the reflected-pointer target of the spec, so a mirror that had to shrink pulls its side a little further than the real side
  (by (1 - k) x the press offset: 8 % of it at the first shrink, up to 49 % at the ninth). Rare (a lopsided silhouette); the spec's choice.
* The real hand's first target is not floor-clamped (the mirror is not known yet when it is made); later moves are.
* Creases of two-handed pulls: see above; PHYSICS lane.
* Wall-clock: the machine ran at 96 to 99 % load from other work during the browser runs, so a browser run took 8 to 25 minutes.

## Decisions for the owner
1. **Pay once.** A Shift pull pays, counts for Tasks and for the stats exactly like one pull (the alternative, feeding the second hand, pays +3 % to +26 % extra and doubles
   a "pull N times" goal).
2. **The floor clamp.** While a Shift pair is held neither hand is pulled to below 2 cm above the table (it stops the mesh turning inside out; it only matters for a press near
   the top of the dome or near the centre). Say if you would rather have the pure mirror and let the physics lane solve it.
3. **Hint wording.** "Shift + drag pulls both sides" is appended to the desktop hint (and to the Settings Keys line); on a 320 px mouse window it wraps to two lines
   (see the shift-hint-reflow rows). A shorter line ("Shift + drag: both sides") is a one-string change in `src/ui/hint.ts`.

## Needs other lanes
* PHYSICS: two-handed grabs in the game's camera geometry crease (fold > 120 deg in 24 to 29 of 38 cases, both for two fingers and for Shift) and have no handling of a grab
  target under the table; the shell's clamp is a stopgap for the second only.
