# FUN: more things to do with your squishies

**Status:** owner request, 2026-10-06 ("we should also be able to do other fun things with our squishies"). This page lists the
activities, the order they are built in, and the shared rules. Each one is built on the soft-body physics that makes Squish Keeper
different. None of them adds a currency, a timer, a paywall or a score you can lose.

## 1. The toy tray

The play view stays clean: one **Toys** button next to the Hoard button opens a small tray of tools. The default tool is the **Hand**:
poke, squish, stretch, as today. Picking a tool changes what a touch does until you pick the Hand again. The keyboard path is
`T` for the tray, the arrow keys to choose, and Enter to pick (only when keyboard shortcuts are on). Every tool works with Calm effects.

| Tool | What you do | What it shows off | Status |
|---|---|---|---|
| **Hand** | Poke, squish, stretch (today's play) | The soft body | Built |
| **Cut** | Swipe to slice a squishy into pieces; drag pieces together to reconnect ([`CUT.md`](CUT.md)) | Volume-true splitting and rejoining | Building |
| **Toss** (Hand, no tool needed) | Pull a squishy past its limit to pick it up, then flick to throw it; it lands, squashes and wobbles; the mat's soft rim bounces it back (stage B item B3) | Momentum, landing squash | Building |
| **Stack** (Hand, several squishies out) | Put 2 to 5 squishies on the mat and stack them; a tall tower sags and topples. A soft "tallest tower" note remembers your best (no score screen) | Body-to-body contact (B2), sag | Building |
| **Stamp** | Press a shape (star, moon, ring, swirl, drop) into a squishy. Putty and mochi keep the print until it slowly heals; jelly springs back at once | The plastic memory of each material family | Next |
| **Roll** | Roll a rolling pin over a squishy to flatten it; firm ones resist, foam ones sink and rise | Material families | Next |
| **Snap** (photo) | Hide the HUD, turn the camera, pick a backdrop tint, save a picture of your squishies as a PNG | The look | Next |
| **Float** | Drop squishies into a shallow water tray where they bob and drift (the existing Float setting, made into a place) | Float mode | Later |

## 2. XP (the meter) for every way of playing

Owner direction, 2026-10-06, in two steps. First: every touch should visibly earn a little, and holding should earn more the longer
you hold. Later the same day the owner decided, and said it was final: **short taps pay nothing.** Taps are free play; holds and
stretches earn. That reverses point 1 as it was first written ("a quick poke always earns a little"); points 2 to 5 stand, with
their numbers re-tuned for it (`DESIGN.md` 5.4).

1. **Taps are free play.** A tap on the squishy (a quick poke, or a squeeze let go before 0.4 s) pays no squish points, sends no
   sparks to the meter ring and does not move it, at any speed and however many. It is still a touch: the squishy still wobbles and
   sounds, and it still counts for the statistics and for the daily tasks that ask for pokes. A touchscreen gives no force reading,
   so there is no "light" or "hard" tap: every tap pays nothing. Earning takes a hold or a stretch.
2. **Holding earns while you hold.** A squeeze held 0.4 s or more pays per second held (0.7 SP + 0.6 SP a second, up to 3 s, and a
   soft pop at 1.8 s); a stretch held out pays per second held the same way (1.0 SP + 0.65 SP a second, up to the same cap). While
   you hold, the meter ring shows a lighter **pending arc** that grows in real time and banks when you let go. Machine-speed
   squeezing or stretching is still capped by the freshness rule, the per-minute valve and the daily cap.
3. **Every gain is visible.** Each paying touch (a squeeze held 0.4 s or more, a stretch) sends a few sparks from the touch point
   into the meter ring; the ring fills with a short ease. Calm effects replace the sparks with a soft glow on the ring. A tap
   sends none: nothing was paid, so nothing is shown.
4. **Pace stays the same.** A capsule still takes about 3 to 4 minutes of active play for a player who squeezes, stretches and mixes
   them (3.2 to 3.7 minutes in the simulation). The squeeze and stretch pay values were re-tuned with the economy simulation
   (`_harness/sim_economy.ts`) to make up for the taps that no longer pay, and `DESIGN.md` 5.4 is updated with the new numbers.
   MERGE_COST stays 2 unless the simulated pace leaves its band. A player who only taps now earns nothing: that is the owner's
   decision, and `DESIGN.md` 5.4 reports what it does to the population pace.
5. **Activities pay through the same touch kinds.** A toss pays like a pull; a stamp or a roll pays like a squeeze (a tap-length
   one pays nothing, like any tap); cutting, reconnecting, stacking and taking photos pay nothing extra.
6. **The medley is a squeeze and a stretch.** The +2 SP variety bonus used to need three different kinds within 12 s, a poke among
   them. A free tap must not unlock a paid bonus, so it is now a squeeze and a stretch within 12 s (a tap neither joins nor
   completes it). The owner can veto this rule (`_handoff/reports/ECON_NOTAP.md`).

## 3. Build order

1. XP changes (meter rules, pending arc, sparks): small; they make every other activity feel rewarding.
2. Cut and reconnect, Toss, Stack: one physics round (body-to-body contact, pick-up and toss, cut primitives), then render, audio
   and shell.
3. Snap (photo): shell and render only, no physics.
4. Stamp and Roll: a physics round for kinematic tool shapes pressing the body (the plastic families' memory does the rest).
5. Float: later.
