# R15 FACING (owner 2026-11-23: "when squishies walk they aren't facing the direction they walk. they need to be able to turn.")

Running report (container may restart: continue from the last finished item).

## Status
- [x] 1. what "facing" is visually; browser measurement (before) - `_harness/_reports/browser_facing_before.{log,json}` (run from a frozen copy of the pre-fix tree)
- [x] 2. fix - crawl.ts (turn in every mode, eased yaw, glide held + forward creep), softbody.ts (scootK, 3 lines), props.ts (untrack resets scootK); tsc clean
- [x] 3. probe rows on the DRAWN face - probe_crawl CR-15a/b, CR-16 (17/17 pass after; the same rows on the old code: CR-15a 4/20, CR-15b 4/20)
- [x] 4. browser after-run (`_harness/_reports/browser_facing_after.{log,json}`, before log `browser_facing_before.log`), screenshots `shots_facing/{before,after}_{desk,phone}_jellygel_[calm_]{right,away,left,toward}_{a_start,b_mid}.png` (DPR 2)
- [x] 5. final probes: probe_crawl 17/17, probe_playground 74/74 (PH-15 first FAILED: a floater in a pool cannot turn (off the ground) so the hold froze its glide; fixed: the hold applies only on the ground), probe_life_selfuse all pass (54 visits), probe_gestures 176/176, probe_float 15/16 (F4 Table at hearthlog, see Open); tsc clean; vite build exit 0 (first-play 465 KB gzip, assets 2148.6 KB)

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
- (RESOLVED, follow-up item 2) probe_float F4 'Table at hearthlog': with only crawl.ts reverted on today's tree the row passes 16/16; instrumented, BOTH trees
  sample body 0's "rest" height mid-crawl (pre-fix 0.364, passing against its true rest 0.393 by 1 mm; with R15 0.430, failing). Float behaviour itself is
  unchanged (the float branch of Crawl.step is untouched; the hold is let go when gravity is off). The row was wrong: re-specified in probe_float.ts (reference
  taken when no body walks or crawls; same 3 cm / 3 s limit, reason at the row). Now 16/16 on today's tree and on the crawl-reverted tree.
- The final browser after-run was made before the floater-on-the-ground fix (affects only off-ground bodies). CR-12 cost once read 71.6 us/body over 60 on a loaded
  box, then passed on the rerun (17/17).
- Blocked walks at Home bounce back each crawl cycle (Home does not detour round things, by design since R13): visible as a pulse backward. Not a facing fault.

## Measured after (browser, final code; drawn face vs travel over 0.2 s while walking)
- Scripted, all 12 families, desk = phone (physics is frame-independent): median 0.5-8 deg, p90 6-19 deg; away turn (180) to within 20 deg 0.9 s (was 0.4 s
  with a 4-13 cm slide); peak drawn rate 202-233 deg/s (was 460-479); travel before facing 1-5 cm, forward. Single-sample outliers remain at a walk's
  end settle (slowrise 179 deg for ~1 cm) and putty/waterfill on a 90 deg retarget (44-84 deg for ~0.2 s while the front bends toward the new way).
- Calm (3 families): median 0.5, p90 4-5, max 11 (was 180 everywhere).
- LIFE, 3 out (desk): Home median 11.6 (p90 158: pushed-back blocked walks, 17 %), asked walks 4.3/4.8 (p90 28/37), Home Calm 6.7 (was 136), Ripple 3.7,
  Frostbell 1.4. Phone (2 out): Home 7.0, asked 2.4/7.5, Calm 6.6 (was 48.6), Ripple 10.4, Frostbell 1.1. Face vs its own way: median 0.4-6.2 everywhere.
- Floaters: face the camera as before (median 0-7 deg), no drift over 4 cm/s seen in 15 s.

## Follow-up 1: walks into a friend (Home 3 out, p90 158 deg)
- Cause (browser, `--sec=surge`/`surge1`): not the crawl alone (1 body out: no backward motion; node, same genomes: none). With 3 out a walker reached a friend,
  pushed it along (the friend, asleep, woke and slid away in step) and was thrown back once a crawl cycle: 1-3 cm backward pulses with its face ahead.
- Fix, first version (stop at the friend, counted in scootBlocks): REJECTED by probe_life_selfuse (SU-04 hearthlog, SU-06 Home: 2 things used instead of 3;
  SU-05 flip-flop): stopped walks made LIFE give up and re-plan.
- Fix, final (crawl.ts): a friend touching it in the 55 deg cone ahead of its way makes it STEER ROUND: its way becomes the tangent round the friend on the
  target's side (held until the friend is beside or behind it), the glide (straight at the target) is held and the forward creep along its face carries it
  round; if its target is where the friend is (nearer the friend's centre than it is) it stops facing its way and LIFE's blocked rule ends the walk.
  Contact approaches (<= 0.05 m/s) still touch. Nothing new is signalled to LIFE.
- Measure: SELF-POWERED = its own drive (glide + forward creep) over 3 cm/s; every walking sample is still reported beside it.
  Run with the first (stop) version (desk / phone, 3 out, self-powered: median / p90 / worst) - superseded by the final run below:
  Home life 3.7/20.1/82.8 | 3.4/14.7/32.6; asked 5.1/13.4/94.6 and 3.0/10.8/100.9 | 2.6/9.8/35.6 and 6.6/37.2/111; Home Calm 3.2/17.9/83.8 (n 23) |
  6.6/12.3/29.2; Ripple 1.8/10.2/110.5 | 1.4/14.8/80.8; Frostbell 1.2/9.8/41.1 | 1.2/17.2/122.4. Samples over 60 deg: 0-5 per 30 s section.
  All walking samples (incl. shoved) p90: desk Home 117, Home Calm 160 (37 % pushed), phone Home 16.7.
- Open: the few self-powered samples over 60 deg (single 0.1 s samples) are not diagnosed.
