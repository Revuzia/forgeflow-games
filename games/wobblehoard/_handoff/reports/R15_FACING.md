# R15 FACING (owner 2026-11-23: "when squishies walk they aren't facing the direction they walk. they need to be able to turn.")

Running report (container may restart: continue from the last finished item).

## Status
- [x] 1. what "facing" is visually; browser measurement (before) - `_harness/_reports/browser_facing_before.{log,json}` (run from a frozen copy of the pre-fix tree)
- [x] 2. fix - crawl.ts (turn in every mode, eased yaw, glide held + forward creep), softbody.ts (scootK, 3 lines), props.ts (untrack resets scootK); tsc clean
- [x] 3. probe rows on the DRAWN face - probe_crawl CR-15a/b, CR-16 (17/17 pass after; the same rows on the old code: CR-15a 4/20, CR-15b 4/20)
- [x] 4. browser after-run (`_harness/_reports/browser_facing_after.{log,json}`, before log `browser_facing_before.log`), screenshots `shots_facing/{before,after}_{desk,phone}_jellygel_[calm_]{right,away,left,toward}_{a_start,b_mid}.png` (DPR 2)
- [~] 5. final probes, vite build (a floater-in-water regression found by PH-15 fixed: the hold only applies on the ground)

## What the player sees (before; measured in the browser on the drawn eye beads)
- Face = two eye beads on the sim skin at rest +Z; the drawn face and the physics frame agree (median within 1-2 deg; up to ~7 deg while the crawl wave bends the skin).
- CALM / prefers-reduced-motion (world.calm): Crawl.step returned at once, so there was NO turn at all. Home, 3 out, desk: face vs its own way median 135 deg,
  75 % of walking samples > 45 deg off; scripted walks away from the camera 176-180 deg (walks backward), sideways 90 deg. Calm defaults to the OS
  Reduce Motion setting (settings.ts optionalDefaults), so a player with Reduce Motion on never saw a squishy turn.
- Crawl mode: every walk started 100-170 deg off (glide full speed in 0.12 s, the turn 0.2-0.4 s: 2-10 cm slid sideways/backward first), the turn was a snap
  (peak 400-475 deg/s). Steady walking pointed at its own way (median 1-6 deg).
- Home with 3 out also shows walks deflected or pushed back by things/friends (13-30 % of walking samples move against the glide's own heading: a walk into an
  obstacle bounces back once a crawl cycle). That is a blocked-walk behaviour, not the turn; reported, not changed here (see Open).

## Fix (src/physics/crawl.ts, SoftBody.scootK)
- The TURN runs in every mode (Calm keeps no wave, only the turn); CRAWL.on / calm stop only the wave.
- Yaw rate eased: accel 15 rad/s^2, cruise 3.5 rad/s (200 deg/s), slows onto the heading (90 deg ~0.4 s, 180 ~0.9 s to within 30 deg).
- The glide waits for the face: SoftBody.scootK = 0 beyond 25 deg, full within 8 (smoothstep); its speed is capped at once.
- While held it creeps FORWARD along its face (arc 0.5 x asked speed within 30 deg, none at 90+; a retargeted walk's lost speed carries on forward and eases,
  tau 0.25 s): it arcs round instead of sliding sideways. The lean waits for the glide's share; the wave waits until within 35 deg (was 53).

## Open
- Blocked walks at Home bounce back each crawl cycle (Home does not detour round things, by design since R13): visible as a pulse backward. Not a facing fault.

## Measured after (browser, final code; drawn face vs travel over 0.2 s while walking)
- Scripted, all 12 families, desk = phone (physics is frame-independent): median 0.5-8 deg, p90 6-19 deg; away turn (180) to within 20 deg 0.9 s (was 0.4 s
  with a 4-13 cm slide); peak drawn rate 202-233 deg/s (was 460-479); travel before facing 1-5 cm, forward. Single-sample outliers remain at a walk's
  end settle (slowrise 179 deg for ~1 cm) and putty/waterfill on a 90 deg retarget (44-84 deg for ~0.2 s while the front bends toward the new way).
- Calm (3 families): median 0.5, p90 4-5, max 11 (was 180 everywhere).
- LIFE, 3 out (desk): Home median 11.6 (p90 158: pushed-back blocked walks, 17 %), asked walks 4.3/4.8 (p90 28/37), Home Calm 6.7 (was 136), Ripple 3.7,
  Frostbell 1.4. Phone (2 out): Home 7.0, asked 2.4/7.5, Calm 6.6 (was 48.6), Ripple 10.4, Frostbell 1.1. Face vs its own way: median 0.4-6.2 everywhere.
- Floaters: face the camera as before (median 0-7 deg), no drift over 4 cm/s seen in 15 s.
