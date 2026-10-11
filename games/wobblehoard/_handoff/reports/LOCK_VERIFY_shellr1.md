# LOCK_VERIFY_shellr1: SHELL re-verification of the lock fix round (independent, 2026-10-10)

Scope: re-run ONLY the findings of `LOCK_VERIFY_shell.md` with their own repros, plus the rows next to them. Fix report: `LOCK_ALL.md`. Real Chromium (SwiftShader), REAL Playwright mouse / keyboard / CDP multi-touch on the real game; the `__WH__` hook only READS state and steps time. The PC was at 100 % CPU (game 2.4 to 2.8 fps), so time is advanced with `pause()+step(1/60)` between real events; the overshoot row was also run in the unpaused real loop. Ports 5473 / 5474.
Snapshot: WORKING TREE copied 00:29 to `C:\Users\TestRun\AppData\Local\Temp\vsr1\snap` (short path; the scratch path is refused as a Win32 cwd). `tsc --noEmit` clean. At the end the lock files (softbody.ts, contracts.ts, game.ts, driver.ts, stage.ts, lockfx.ts, keyboard.ts, hint.ts) are byte-identical to the live tree. Scripts `vsr1\s*.mjs`, pictures `vsr1\shots\`; the long running log is `vsr1\report_running_full.md`.
**Tree note:** HEAD 713081e6 (23:19) holds the WITHDRAWN design (LIFT_OVER 1.3 + LIFT_DWELL 0.3 s + put-back). The final code that LOCK_ALL describes (LIFT_OVER 1.15, no dwell, put-back, float lock) exists only in the uncommitted working tree (`git diff HEAD`: softbody.ts, a contracts.ts comment, probe_lock.ts). I verified the working tree; it must be committed.

## VERDICT: PASS. Both first-round MAJORs are fixed; no new MAJOR; 4 MINOR (1 new, 3 open)

| First-round finding | Result | Evidence (real input) |
|---|---|---|
| MAJOR 1: Shift dead once the drag is 30 to 50 px past full (squishy lifted) | **FIXED** | `s1 --only=overshoot` (granulo, 960x600): stop at full / 30 px / 90 px / 240 px past full: locked 1 in 4/4 (first round 1/4), each 1 lock sound and "Locked in place."; pull at the Shift 1.00 / 0.17 / 0.38 / 0.18, carried TRUE in the last three (the lift is undone). Unpaused real loop at 2.8 fps (`s23`): lifted at 266 px, Shift at once and 3 s later: locked 1, not carried, marker 1, Esc releases (6/6). |
| MAJOR 2: Float, a lock can never happen | **FIXED** | Real click on dock Float (gravity false): `s9` 440 px drag (pull reads 0.60, never 0.95): locked after Shift 1 (first round 0); `s8` 0 / 30 / 90 / 240 px more: 4/4 lock (first round 0/4). |
| MINOR 4: marker not committed | **FIXED** | `lockfx.ts` tracked; `setLockMarkers` in HEAD (`contracts.ts:530`, `stage.ts:219,808`); rings seen live. |
| MINOR 3: silent refusals, no ready cue | **STILL OPEN** | Shift at 0.49 / 0.898: no lock, no sound, no line (`s1`, `s10`). Float 60 .. 230 px: refused silently (pull 0.11 .. 0.52). `quality=low`: 5th lock refused, 0 sounds, no new line (live text stays "Locked. 4 held."; `s25`). No "ready" cue in the source. |
| MINOR 5: lock hard to discover | **STILL OPEN** | First-run pill never names it; "Shift while stretched fully locks a pull; Esc lets go" shows on the pill's SECOND return (`s6`); Settings keys line and How to play carry it. |

## After an overshoot lock: what the player gets
- Body (`shell.tools().body`): world x 1.794 while carried -> **0.32 on the next frame** (the control rests at 0.33); volume 1.04; ring on the tip. `shots\r1_over240px_wait.png` is the same star as the control `r1_ctl_stop_at_full.png`. Node probe on the snapshot's SoftBody (`pb1.ts`: granulo, dollop, twangle; carried at 1.9x and 3.5x; Shift at once or 20 frames later): centre 2.5 .. 11 R away while carried -> 0.5 .. 1.0 R next frame, within 0.05 R of the control after 1 s, no undershoot.
- On screen the star then appears at x 252 and glides to 514 over about 40 frames (0.7 s): that is the framing CAMERA easing back (cam x 1.05 -> 0.2), not the body (`t_lifted240_f1.png`, `f4.png`).
- Voices (`s24`, real engine spies): Shift after a lift plays ONLY the lock click (`ui:on` +1), no toss / land / bump / lift / pop (`lift` +1 was the earlier pick-up); Esc: release + pop x3 as the control, 1 snap.
- Pay (`s20`, `s2`): 0 SP at the lock and while standing; Esc: 1 snap, intensity 1, heldFor 4.0 / 4.1 / 4.85 / 6.57 s, **2.95 SP** (cap) each; volume 1.005, stretch 0 after. Short hold 1.899 = 1.0 + 0.65 x 1.383; a lobe locked 60 sim-s pays 0, then 2.95; two locks 3.038.

## Float beyond the first-round repro (`s30`, 1280x760, 13/13)
Short drag does not lock (60 / 120 / 180 / 230 px: locked 0, 0 sounds); the SAME pull dragged to 440 px (hand at the limit) locks, 1 sound. Held 6 s: volume 1.035, finite, bobs +-0.015 world units (`f_hold_2s.png`). Esc: 1 snap, intensity 0.95, heldFor 7.37 s, 2.950 SP, star settles. Three tips locked (pull 0.61 / 0.83 / 0.80; `f_three.png` clean). Float -> Table with 3 locks held: volume 1.015, no crash; Table lock -> Float: locked 1. In Float "full" means the hand is at its limit and the lobe at least 0.25 stretched (`LOCK_FLOAT_MIN`).

## Regression rows next to the findings (real events)
- Pick-up and toss unchanged: plain drag lifts at 252 px (`lift` +1); a 40 px/frame flick + release: toss +1, land +1 (`s22`). Table drag: pull 0.92 at 252 px, 1.00 at 288, lift at 312 px (`s9`; line still 1.15).
- Shift pair never lifts (240 px past full); a Shift tap in it locks both ("Locked. 2 held.", stays after button up, 0 snaps; Esc 2 snaps, 3.038 vs plain 2.322 SP); with one lock held a second lobe dragged 480 px never lifts and locks (`s3`, `s20`).
- `s10`: hold 1 / 4 / 10 s then Shift locks 3/3; Shift at 0.898 nothing, same pull at 0.991 locks; a second tap nothing.
- `s1 flow`: five lobes locked at pull 0.974 .. 0.985 (never carried, 5 markers, volume 1.017); a press 25 px beside a locked tip releases that one (5 -> 4, 1 snap, 2.95 SP, "Let go."); with the Menu open Esc closes it and keeps 4 locks, the next Esc "Let go of all." with no Menu; key repeat ignored; text input ignored; dock Hand focus still locks. 20 ok; its 4 FAILs are bugs of my script copy (a `stretch > 0.25` bar that one tip never reaches: it reads 0.07, also in the first round's own picture; a live-log read taken before the debounced "Locked. 2 held." arrived; two hint rows with a wrong baseline, redone in `s6` 8/8).
- Leave paths (`s4`): Cut tool 2 -> 0, Snap, Hoard, tab hidden 62 s release (1 snap each, markers 0); hidden 3 s keeps. Phone 390x844 (`s5`, CDP touch): 3 / 4 / 5 fingers = 3 / 4 / 5 grabs on slots 0..n-1, never lifted, settles; 6th finger: 5 hands; one finger far up lifts; empty-space drag turns, pinch zooms; no Shift or lock text on the phone. Calm effects: locks, marker 1, screenLight 0 (`s7`).
- Node: `probe_gestures` 160/160, `shellview/lock_checks` 96/96, `probe_lock_shell` 96/96, `tsc` clean. 0 page errors in every browser run.
- HEAD 713081e6 (withdrawn design), same overshoot rows: 4/4 lock too, but its pick-up timing differs (the 240 px row carried at 394 px, not 262); LOCK_ALL says its browser_shell snap-mat carry row fails; I did not re-run that row.

## Findings (all MINOR)
1. **MINOR 6 (new): the put-back is an abrupt pop.** Repro `s21.mjs` / `s22.mjs`: drag 240 px past full (body lifts), real Shift; frame 1: the body is at its home in one step (3 body radii), the star shows at the screen edge and slides back with the camera over 0.7 s. The lock itself is right. A short ease or a held camera would read better.
2. **MINOR 3 (open): refusals are silent, no ready cue** (rows above: Shift below full, Float short drags, the 5th lock on `low`). LOCK.md rule 1 asks for "nothing"; LOCK_GATE decision B stands open.
3. **MINOR 5 (open): the lock is only named on the pill's second return.**
4. **MINOR (process): the committed HEAD is not the fixed code** (tree note).

## Not verified
Hearing the sounds; real GPU frame rate; the 6-lock cap (a 6+ lobe species; the cap-4 `low` tier was seen); locks on mat bodies and cut pieces; Safari / iOS; pen input; capsule / merge / reload / switch leave paths (no code in them changed); physics folds with 4+ locks (LOCK_ALL item B, the physics verifier's lane).
