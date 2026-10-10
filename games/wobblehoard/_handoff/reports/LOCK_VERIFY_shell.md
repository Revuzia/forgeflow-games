# LOCK_VERIFY_shell: independent SHELL-lens check of the Shift lock (2026-10-09)

Verifier: independent (did not write the code). Real Chromium (SwiftShader), REAL Playwright mouse / keyboard / CDP multi-touch on the real game; the hook (`__WH__`) only READS state and steps time.
Snapshot: working tree copied 18:23 to `C:\Users\TestRun\AppData\Local\Temp\vsl\snap` (the scratch path is 285 chars and Win32 refuses it as a cwd; scripts s1..s13, pictures `shots\` and the raw running log
`LOCK_VERIFY_shell_running_full.md` are in `...\Temp\vsl\`). `tsc --noEmit` on the snapshot: clean. HEAD ab395ac6 has all lock code EXCEPT the marker: `src/render/lockfx.ts` is untracked and the `setLockMarkers` lines in
`stage.ts` / `contracts.ts` are uncommitted (git diff HEAD: the only lock lines that differ). Method note: the PC was at 93-100 % CPU from other jobs (game 1 to 1.5 fps = 13x slow motion), so the sim clock is advanced with
`pause()+step(1/60,n)` between real events (as LOCK_GATE's XP row does); row s12 was repeated in the unpaused real loop with the same result.

## VERDICT: FAIL (2 MAJOR). The lock works when you stop at full on a table; the owner's first complaint is NOT fixed for a normal drag, and a lock cannot happen in Float.

### MAJOR 1 (owner request 1 not delivered): Shift is dead and silent once the pull goes 30 to 50 px past full (the squishy is picked up)
Repro (s1 `overshoot`; star, 960x600; press the upper-right tip; drag outward 6 px per 1/60 s; real Shift keypress):
| after the pull first reads >= 0.95 (232 px) | at the Shift | result |
|---|---|---|
| stop, still 0.33 s | pull 1.00, not carried | LOCKED (1 lock sound, "Locked in place.") |
| 5 more frames (30 px) | carried = true (lift at 262 px), pull reads 0.17 | NOTHING: locked 0, no sound, no line |
| 15 frames (the lift stops it) / 40 frames; Shift at once or after 0.5 s | carried, pull 0.38 / 0.18 | NOTHING |
Window "pull 0.95" to "picked up": 30 px at 960x600 (0.17 s at 180 px/s, 0.07 s at 480 px/s, explore1.mjs); 48 px (0.24 R) at 1280x760 (s9). A person drags until it stops growing, then reaches for Shift: that is the lifted case.
Cause (unchanged; LOCK_GATE decision A still open): `softbody.ts` `LIFT_OVER = 1.15` (line 258), pick-up at 2671, `lockGrab` returns false while `this.carried` (2826). Nothing tells the player why.
The lock itself is fine: stop at full, hold 1 s / 4 s / 10 s, then Shift: locks all three (s10); Shift at pull 0.898 does nothing, at 0.991 on the same pull locks.

### MAJOR 2 (owner requests 1 and 2 together): in Float mode a lock can never happen
Real click on the dock "Float" button (gravity false), drag 440 px (1280x760, R 203, room to spare, s9): pull level 0.05 .. 0.54 (252 px) .. 0.57 (288 px), then flat 0.59-0.60; never 0.95; Shift locked nothing (s8: 4 of 4 rows, 0 / 30 / 90 / 240 px past,
pull 0.60 each). Table, same drag: 0.92 at 252 px, 1.00 at 288 px, lifted at 312 px. Cause: `pullLevel()` (softbody.ts 1397) subtracts the body centre's displacement when no feet are pinned, and a floating body follows the hand.
Float is now a first-class dock button, so "Shift after a full pull" is unreachable there.

### MINOR 3: silent refusals, no "ready" cue
Shift below 0.95, or while lifted, gives no sound and no line (rows above); the player cannot see the moment the pull reaches 0.95. (LOCK_GATE item B, unchanged.)
### MINOR 4: the lock marker is not committed
`lockfx.ts` untracked; `setLockMarkers` in `stage.ts` / `contracts.ts` uncommitted. A build from HEAD has locks but no ring. Fix: commit them.
### MINOR 5: the lock is hard to discover
The first-run pill never mentions it. The line "Shift while stretched fully locks a pull; Esc lets go" showed on the pill's SECOND return (two 20 s idle gaps, s6); it is also in the Settings keys line and How to play.
### NOTES
- A locked Shift pair released by Esc plays two release sounds / pops (audio release 2, pop 6 vs 1 and 3) and counts two pulls ("a locked twin is a lock like any other", driver.ts lockPulls) but pays one pull + 0.09 SP (3.038 SP; a plain Shift pull at a shorter hold 2.322): both match 1.0 + 0.65 x min(held,3).
- Switching squishy (setGenome seam) releases the lock but pays nothing (no snap); Cut / Snap / Hoard / hide > 60 s / capsule / merge release with a snap that pays.
- The quick `[ ]` switcher lists only recent / favourite squishies ("No other squishy to switch to yet."), so the real key was not usable as a leave path in a 2-item hoard.
- A straight-up pull of the top tip hits the window edge at 960x600 (test geometry; dragged diagonally instead).

## Owner scenarios, results (numbers from the runs)
| Item | Result |
|---|---|
| Shift tap: no pull / pull 0.49 / 0.898 | nothing: locked 0, no sound, no line, the pull goes on. PASS |
| Full pull + real Shift tap (stop in the band) | locked 1, hand free (grabbed false), 1 lock sound, "Locked in place.", ring on the tip (`shots/v1_one_locked.png`). PASS |
| The mouse after the lock | moving it and releasing the button: locked stays 1, 0 snap events. PASS |
| Key repeat | Shift held + 2 more keydowns (repeat=true) at pull 0.99: no lock; a fresh tap locks. PASS |
| 2nd and 5th lobe on the star | locks 1..5 at pull 0.985 / 0.974 / 0.975 / 0.979 / 0.976, one sound each, "Locked. 2 held.", never carried, stage markers 5/5, still 5 after 1.5 s, volume 1.017 (`v2_five_locked.png`). PASS |
| A press releases one | real click 25 px inside a tip: 5 -> 4, 1 snap (0.98, heldFor 4.83), "Let go.", 1 let-go sound, paid 2.95, no poke or new pull. PASS |
| Esc | Menu open: closes the Menu, the 4 locks stay; next Esc: all 4 go ("Let go of all.", 1 sound, Menu not opened, star settles, markers 0); one more opens the Menu. PASS |
| Mirrored Shift pull | Shift at the press: 2 grab events, never lifted even 240 px past. Shift tap in it: locked 2 + 1 sound; pair stays after button up, no snap; Esc: 2 snaps. PASS |
| Shift in a form control | text input focused: ignored (pull 0.97, locked 0); after removal it locks. After a real click on the dock Hand button: still locks. PASS |
| XP | control full pull 2.95 SP (cap), 1 snap; lock: 0 SP at the lock, 0 after 4.5 s and after 60 sim-s standing, no snap; Esc: cap 2.95 once (heldFor 61 s); short hold 1.899 = 1.0 + 0.65 x 1.383; two lobes 3.038 (2.95 + 0.09); tasks unchanged until the release (stretch-double 0/1 -> 1/1 on release). PASS |
| Leave paths | Cut tool (2 locks), Snap, Hoard, hide 62 s, capsule, merge: released, markers 0, 1 snap each, no sound. Hide 3 s and window blur: kept. Reload (2 locks): 0 locks, 0 markers, nothing stored. PASS |
| Phone 390x844, CDP touch | 3 / 4 / 5 fingers on 3 / 4 / 5 tips: grab slots [0..n-1], never lifted, n snaps, settles (vol 1.003); 6 fingers: 5 hands; 1 finger far up still lifts; an empty-space drag turns the view (62 % of pixels vs 0.2 % idle); a 2-finger pinch zooms (r 128.9 -> 93.6); 3 + 1 on empty: 3 grabs. PASS |
| Hint / Settings / How to play | start hint "...Shift + drag pulls both sides"; 3 Shift taps + a hold change nothing (not a key used); ArrowLeft gives the keyboard wording; phone hint never names Shift or lock; Settings keys line and How to play row carry the lock text; Settings has no Table / Float row (they are in the dock). PASS |
| Meter / tasks | locking and standing locks pay and count nothing (fill 0, tasks unchanged). PASS |
| Marker, sound | markers 1..5 match the locks, 0 after release; ui:on +1 per lock, ui:off +1 per press / Esc; Calm effects: locks, marker 1, screenLight 0. PASS (nobody listened) |
| Unpaused real loop (s12, 1 fps) | pull 0.951 at 210 px, Shift locks, marker 1, Esc releases. PASS |

## Not verified
Audibility of the sounds; real GPU speed; the 6-lock cap and the `low` tier cap 4 (the star has 5 tips; LOCK_GATE saw a silent refusal); species with 6+ lobes live; locks on mat bodies; pen input; Safari / iOS; the quick-switcher key as a leave path.
Console: 0 page errors; one "AudioContext ... audio device" line (the headless box has no audio device).
