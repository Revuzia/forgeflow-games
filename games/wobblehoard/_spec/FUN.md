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

Owner direction, 2026-10-06: every touch should visibly earn a little, and holding should earn more the longer you hold.

1. **A quick poke always earns a little.** Ordinary tapping (two or three taps a second) pays a small, visible amount. Machine-speed
   mashing is still capped by the per-minute valve and the daily cap.
2. **Holding earns while you hold.** A squeeze already pays per second held; a stretch held out now does too, the same way (up to
   the same cap). While you hold, the meter ring shows a lighter **pending arc** that grows in real time and banks when you let go.
3. **Every gain is visible.** Each paying touch sends a few sparks from the touch point into the meter ring; the ring fills with a
   short ease. Calm effects replace the sparks with a soft glow on the ring.
4. **Pace stays the same.** A capsule still takes about 3 to 4 minutes of active play. The pay values are re-tuned with the economy
   simulation (`_harness/sim_economy.ts`), and `DESIGN.md` 5.4 is updated with the new numbers. MERGE_COST stays 2 unless the
   simulated pace leaves that band.
5. **Activities pay through the same touch kinds.** A toss pays like a pull; a stamp or a roll pays like a squeeze; cutting,
   reconnecting, stacking and taking photos pay nothing extra.

## 3. Build order

1. XP changes (meter rules, pending arc, sparks): small; they make every other activity feel rewarding.
2. Cut and reconnect, Toss, Stack: one physics round (body-to-body contact, pick-up and toss, cut primitives), then render, audio
   and shell.
3. Snap (photo): shell and render only, no physics.
4. Stamp and Roll: a physics round for kinematic tool shapes pressing the body (the plastic families' memory does the rest).
5. Float: later.
