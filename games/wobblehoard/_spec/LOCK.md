# LOCK and MULTI-PULL: lock a stretched lobe in place, pull many lobes at once

**Status:** owner request and decisions, 2026-10-06 (chat). Designed here; to be built by the PHYS lane (several concurrent pulls, locks) and the
SHELL lane (Shift key, gestures, Esc, touch fingers), with audio and render touches, and independently verified (physics and shell). Read with
[`FUN.md`](FUN.md), [`CUT.md`](CUT.md) and `src/physics/softbody.ts` (grabs, `updateGrabs`, the `twoHanded` latch).

## 1. What the owner asked for (their words, then the decisions)

"What if left click and hold, then clicking SHIFT locks in the pull, and then I can left click and hold, SHIFT, to lock it into a lone place. A star
for example has 5 corners: it would be cool to lock all of them in and do a 5 way stretch. We can only LOCK with SHIFT when it is FULLY stretched, and it
retains the hold XP."

| # | Decision | Source |
|---|---|---|
| 1 | **PC, lock.** While a lobe is being pulled with the left mouse button, **tapping Shift locks that pull** where it is, **only when it is fully stretched** (pull level at least 0.95, the same bar as the "stretch as far as it will go" task, `STRETCH_FULL_INTENSITY`; the physics clamps a pull at 1.0). The mouse is then free: press another lobe, pull it fully, tap Shift to lock it, and so on. A star (5 tips) can be locked in all 5: a 5-way stretch. | owner |
| 2 | **Unlock.** **Pressing a locked lobe lets it go**: it snaps back (and pays, see 4). **Esc releases all** locked lobes. | owner, 2026-10-06 |
| 3 | **Phones: no lock.** A phone has fingers: up to **5 fingers at once on the squishy** (today 2), each its own press or pull, so a 5-point star takes 5 fingers. Fingers on empty space still turn or zoom the view as now. | owner |
| 4 | **Hold XP: pays on release, capped.** A locked lobe pays when it is released, as if it had been held the whole time since it was grabbed, with today's cap: the hold counts up to 3 s, so 1.0 + 0.65 x min(held, 3) = at most 2.95 SP per lobe, with the usual freshness (a pull released within seconds of another pays almost nothing). Locking loses nothing; leaving lobes locked and walking away earns nothing extra. Cutting, locking and unlocking pay nothing themselves. | owner chose "pays on release, capped" |

## 2. Rules that keep the toy honest
1. **Fully stretched only.** A tap of Shift with a pull below 0.95 does nothing (no lock, no sound). A mirrored Shift pull (Shift held when the pull began, [`src/input/gestures.ts`](../src/input/gestures.ts)) stays as it is; a Shift tap during a mirrored pair locks both hands when both are fully stretched.
2. **Locked lobes are hands.** Two or more hands (fingers, grabs, locked lobes) on a body means it is never picked up (the `twoHanded` rule, commit 19f62137); a locked body cannot be lifted or tossed. Locks end the pick-up latch only when all are released and every finger is up.
3. **Leaving releases** (the CUT.md rule 2 pattern): switching squishy, opening the Hoard, a capsule or a merge, the Cut or Snap tool, the tab hidden more than 60 s, or a reload releases every lock first (instantly when off screen; with the normal snap-back when on screen). Locks are never saved and never appear in the Hoard.
4. **Limits.** At most 6 locked lobes (one per live grab slot plus one), 4 on `low` quality. A lock that would exceed it is refused cleanly.
5. **Calm effects** (DESIGN 6.6): a softer lock marker, no screen light, no shake.
6. **Accessibility.** Esc releases all; the lock is also a toy feature, not a requirement: nothing else in the game needs it.

## 3. How it is built (outline for the lanes)
**PHYS** (`src/physics`). Today there are two grab slots and two finger slots. Add: (a) up to 5 concurrent finger/grab slots (the touch fingers) and a list of **locks** (a lock keeps the grabbed patch's goal at its locked target after the pointer leaves; it counts the hold time since the grab; releasing it fires the normal `snap` event with `heldFor` = the whole hold and intensity = the pull level, so the meter pays it as a pull); (b) additive contract members on `SoftBodyLike`: `lockGrab?(slot): boolean` (true when it locked: fully stretched), `releaseLock?(index | 'all')`, `lockAt?(point): number` (which lock a press is on, for the shell), `metrics.locked` (count); (c) the `twoHanded` latch counts locks as hands; (d) every fold, hop and robustness gate per lock count (1 to 6 lobes on a star species), determinism, zero allocation per step, and perf with 6 locks no worse than 2 whole bodies; (e) the **ground fix** below in the same round.
**SHELL** (`src/input`, `src/shell`, `src/ui`). The Shift keydown (not on repeat, not in a form control; Shift alone must not count as "a key used" for the hint) calls the lock on the active pull; a press on a locked lobe (`lockAt`) releases it; Esc releases all (before it closes a panel only when a lock exists and no panel is open); the gesture machine's `Slot` widens to 0 to 4 for touch; the driver maps each finger to a physics slot; the meter sees each release as a normal pull; the hint and Settings keys line mention it ("Shift while stretched fully locks a pull").
**AUDIO / RENDER.** A small lock click (and a calmer variant); a thin marker at each locked lobe; the flash governor applies.
**Verification.** Independent physics (many locks on 50 species, orders of lock and release, NaN, determinism, allocation, perf) and shell (keyboard and mouse path, the leave paths, the meter) verifiers, as for the Shift pull.

## 4. The ground fix that travels with it (owner report, 2026-10-06)
"Check what happens if the squishy is pulled INTO the ground. It seems a bit buggy." Measured on the real physics (12 species, a lone finger, the target not clamped above the
table, as the game sends it): a long drag straight down (past the pick-up line) folds the body to about 180 degrees in 5 of 12 species (dollop, cushlet, chunkle, fossilo, twangle), the putty
family stays creased for seconds, and twangle turns inside out (volume -2.5 .. 42x). No particle passes through the table. Angled-down and sideways drags are mostly clean. Cause: only a
Shift pair has a floor (`SHIFT_FLOOR_Y`); a lone finger's grab target, and a carried body's hand, may go below the table, and the physics probes clamp the target above it (y >= 0.03), which hides
this. Fix in the PHYS round: a floor for every grab target and for the carry, a probe that does NOT clamp, and an independent check.
