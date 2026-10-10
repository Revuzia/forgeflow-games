# LOCK_GATE: does the Shift lock work on the live game? (INTEGRATION lane, 2026-10-09)

Method: the real game in Chromium (dev server, SwiftShader; the PC was at 100 % CPU for most runs, so 2 to 3 fps: the numbers are physics and input, not speed), REAL mouse, REAL Shift and Esc keys, REAL multi-touch (CDP). A five-point star (Granulo) at 960x600 (desktop) and 390x844 (phone). Script: `_harness/shellview/lock_gate.mjs` (rows `desktop`, `xp`, `phone`, `overshoot`, `ground`). Pictures: `lock_gate/` (5 small PNGs). Nobody heard a sound: the sound CALL was observed (the real audio engine's voice counters).

## Verdict for the owner (plain)
**It works if you stop at full stretch. It does not work if you drag too far, too fast.**
- Press a tip, drag until it will not stretch more, tap Shift: the tip stays locked and the mouse is free. On the star I locked all five tips one after another (a five-way stretch); every Shift took. A ring now sits on each locked tip.
- **The catch, and the most likely reason you kept seeing "Shift does not lock":** pull a lobe too far and the game PICKS THE SQUISHY UP (the old pick-up and toss); a squishy held up cannot be locked, so Shift does nothing. At 960x600 the lobe is full at 198 to 204 px of drag and the squishy lifts at 234 to 240 px: **a 36 px window** (about 18 % of the pull). A slow pull that stops in it locks every time; a fast 440 px drag lifted the squishy in all four runs. Once ONE lobe is locked it cannot happen (two hands never lift): the second lobe, dragged 440 px past the limit, did not lift and locked. Only the FIRST lock is touchy. This needs your decision (below).
- Shift before the lobe is fully stretched does nothing, silently, by design (LOCK.md rule 1).

## Numbers
Desktop 960x600, first full run 10 of 10 (quality fixed to `med`, see 3 below):
- Shift at pull 0.13: no lock, the pull goes on, no sound.
- Five tips locked in a row. Pull at the Shift 0.962 / 0.992 / 0.984 / 0.968 / 1.000 (bar 0.95); drag 198 to 216 px (top tip 378 to 396 px counted: the pointer reached the top edge of the window and the pull finished while it waited; my reading, not isolated). After each Shift the mouse was free at once and ONE lock voice played (`ui:on` 5 of 5). Nothing carried. Volume 1.018 .. 1.057 while locking, 1.026 with five held; still 5 locked 1.5 s later.
- A real click on a locked tip let it go (5 to 4): "Let go.", one `ui:off`, snapped back, **2.95 SP**. Esc let the other four go ("Let go of all.", one `ui:off`, the Menu did not open): **3.215 SP for the four** (about one pull, not four: the freshness rule, LOCK.md); the star settled (stretch 0, volume 1.02).
- Hold XP (fresh meter, page stepped so the hold is exact): held 4.5 s after the lock (heldFor 5.2 to 5.4 s): paid **2.950 SP = the cap** (1.0 + 0.65 x 3), twice. Held 1.2 s after the lock (heldFor 2.483 s): **2.614 = 1.0 + 0.65 x 2.483**; (1.883 s: 2.224 = exact). Locking itself paid nothing.
- Phone 390x844: control (one finger dragged 285 px up) lifts the squishy. With 2, 3, 4, 5 fingers on the star: n fingers seen at the touch, grab events on slots 0..n-1, never picked up, settles after; 3 and 5 fingers all dragged UP (worst case): never picked up. (No Shift, no lock on a phone, as decided.)
- Ground fix, live smoke (not the physics proof, `probe_lock.ts --only=ground`): a pull pressed below the centre and dragged 560 px straight down into the table: dollop, cushlet, fossilo, twangle: volume 0.82 .. 1.00 during, 0.90 .. 1.00 after, nothing inside-out (twangle 0.996 .. 1.000; the probe's old number was -2.5 .. 42), nothing carried, 3 runs. chunkle never turned into a pull (not exercised). The pull stays under full because the hand is floored at the table.
- Regressions after my stage change: SHELL `lock_browser.mjs` 17/17; `probe_gestures` 160/160; `browser_render --only=main` all passed (0 console errors); `probe_lockfx` 15/15 (new); tsc clean.

Honest note, overshoot rows: the window (198/234 px, 204/240 on a quiet PC), the slow approach (locks), 220 and 250 px drags (lock) and the second lobe (locked 2) were each seen in a clean run. In the LAST run three rows and the second-lobe row's first lobe could not press the body and are FAIL "press never grabbed" (not passes). My guess, NOT measured: the meter-full capsule had dropped beside the star and took the press. The next leg should open a fresh page per row. The one full quiet-PC run was 27 of 30 (the other fails: chunkle above; a phone control I had set up as a rub, replaced by the 285 px one).

## What I changed (the marker was missing)
`src/render/lockfx.ts` (new), `src/render/stage.ts`, one optional member in `src/contracts.ts`: `stage.setLockMarkers(points)`. A pale ring with a soft dark halo and a centre dot on each locked tip (6 pooled sprites, one 64 px canvas texture, in 0.15 s, out 0.25 s, breathes 6 % at 0.8 Hz; calm = still, 0.55 opacity; held low for a second after a ceremony flash; no screen light, no shake). A probe found a real bug in it (the ring flickered 1 % every frame once fully in); fixed.
As an art director: the five rings read at once on the yellow jelly (about 38 px at 960x600), clearly different from a merely stretched body; when one tip is let go (picture 3) its ring goes and the tip snaps back with bubbles. Small and calm. The ring sits on the silhouette edge at the tip (it is the grabbed point).

## What is NOT good (ranked)
1. **The 36 px pick-up window.** Not fixed: a physics rule (softbody.ts `LIFT_OVER` 1.15, updateGrabs) and a design trade with the toss.
2. **Perf row FAILS (PHYS left it unmeasured):** `probe_lock.ts --quick --only=perf` prints `FAIL LOCK perf ... threshold: 6 locks <= 2 whole bodies`. Loaded PC: 6 locks 3.13 ms vs 2 bodies 1.82 ms; quiet PC: 2.73 ms vs 1.57 ms (1.7x). About 3 ms of a 16.7 ms frame: not visible, but it breaks the written bar.
3. Silent refusals: Shift below full, and a lock past the cap, say nothing. The cap is 6, 4 on the `low` tier: on the loaded PC the auto quality fell to `low` and the 5th lock was refused with no word (the gate fixes `quality=med`). A slow PC would show "4 of 5".
4. No "ready" cue: you cannot see the moment the pull reaches 0.95.
5. While a lobe is locked the HUD pending arc shows 0 (pay comes at the release, as decided).
6. Lobes dragged DOWN into the table cannot reach 0.95 (the ground floor): the star's lower tips lock only when pulled sideways along the table.

## Decisions for the owner
A. Pick-up vs lock. (1) a lone pull must stay past the line about 0.35 s before the squishy lifts (a Shift tap in that time locks; a quick flick-toss then needs a short hold); (2) move the line from 1.15 to about 1.6 x the full pull (window about 130 px; a longer drag to pick up); (3) Shift while lifted puts it down and locks at full stretch (most work). I recommend (1) or (2): a few lines in `updateGrabs`, then re-run the lift / toss rows (probe_softbody, probe_cut, probe_gestures real rows).
B. Should a Shift below full stretch say a short line ("Stretch it all the way first")? LOCK.md says nothing.

## Not verified
A person hearing the sound; real GPU frame rate; a species with 6+ lobes live; the calm ring live (unit-tested only); the `low` tier ring; Safari / iOS; the window at other sizes (it should scale with the body, about double at 1920x1080: expected, not measured).
