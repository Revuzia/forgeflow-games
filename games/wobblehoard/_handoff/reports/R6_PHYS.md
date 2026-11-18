# R6_PHYS: round 6, the PHYS lane (src/physics and its probes; port 5368). No git write command is run.

Started 2026-11-18, HEAD 4225da645 (tree clean at the start; softbody.ts unchanged since ad49b7902). No earlier R6_PHYS.md existed: fresh start.
Scope (orchestrator): (1) surface mods (Ice Pond grip/drag per family, wet grip, the soaked-density seam PG_SHELL asked for); (2) Ripple's surf
edge if PLACES 4.3 needs it; (3) wind gusts (Lanternroof's Night Breeze) and the updraft column (Cloudloft), the cloud floor's soft bounce if
4.10 asks; (4) the parapet / bounds guarantee for Lanternroof and Cloudloft; (5) remove nothing Home or Hearthlog use. NOT built by order:
magnet, turntable, motors (dropped places, D-96). softbody.ts first-load budget: 15 B left at the start.

Scratch: `scratchpad/r6_phys/` (runner `run.sh <tree> <out> <probes...>`, sizes via `scratchpad/pg_phys/size.mjs`).

## Status (updated after every finished item)
| item | what | state |
|---|---|---|
| 0 | baseline on a `git archive HEAD` copy (`r6_phys/head`), one probe after another, logs `r6_phys/base/` | DONE 02:45 (species last: 25/31, the known 6) |
| 1 | surface mods in props.ts (ground, patches, ice, wet grip) + the `mods(body)` seam; probe rows `--only=surface` | DONE 03:05: tsc 0; 5 new rows pass |
| 2 | Ripple's surf: waves (surface 0.06 -> 0.12 m every 7..10 s, shoreward water, a shell rung by every second wave); `--only=surf` | DONE 03:05: 3 new rows pass |
| 3 | wind gusts (own clock or `setGust`), the updraft (bodies and the ball), the three Puff Pads built, the Sunbow Arch built; `--only=wind,updraft` | DONE 03:25: 6 new rows pass |
| 4 | the bounds guard (Lanternroof parapets, Cloudloft open); `--only=guard` (4 layouts with `--only`; the quick set: Lanternroof wide, 6 throws) | DONE 03:35: 4 rows pass; A/B: without it 3 of 5 over-the-parapet throws end ON the 2.4 m physics parapet (y 2.74..2.77) |
| 5 | regression: probe_playground quick + alloc, node_checks, probe_app, probe_chatter, probe_pg_data (the only probes that import props.ts; softbody.ts is NOT changed) | DONE 04:00 (section 3) |
| 6 | determinism row for the round-6 paths (PH-10) | DONE: equal |

## 0. Baseline (HEAD 4225da645, `r6_phys/base/summary.txt`)
| probe | HEAD | | probe | HEAD |
|---|---|---|---|---|
| probe_playground (quick) | 56/56 (32.1 s) | | probe_app | 187/187 |
| probe_softbody --quick | 114/116 (the 2 known) | | probe_gestures | 160/160 |
| probe_lock --quick | 45/48 (2 known open, 1 perf: known) | | probe_merge | 22/22 |
| probe_cut / flush / neck / parts | 17/17, 11/11, 8/8, 11/11 | | shellview/node_checks | 171/171 |
| probe_tips | 34 cuts, 33 made, 1 refused, 33 within | | probe_life | 117 ok, 1 fail (LF-02, PG_LIFE's) |
| probe_materials / families / many --quick | all, 22/22, 43/43 | | probe_chatter | 42/42 |
| probe_truecut --quick | 104/113 (known builder rows) | | renderview/pg_node_checks | 40 ok |
| probe_species | 25/31 (known: press gloopsy, FULL PULL putty, RUBS x4) | | | |
| probe_trophies / journal / quests / pg_lifequests | 31/31, all, all (3 NOT RUN), 14/14 | | probe_pg_data | 2 FAIL at HEAD (DT-01 Home B5 phone ball spot; DT-01 cabin tall rocker under the HUD: PG_DATA's, not physics) |

## 1. Where the code is, and the sizes (14.3's one-file rolldown, `scratchpad/pg_phys/size.mjs`)
- **softbody.ts is NOT changed** (112 948 B, the first-load cap still has its 15 B). Everything below is in `src/physics/props.ts` (the `later-props` chunk,
  loaded with the life chunk): **26 805 -> 36 955 B (+10 150 B)**. No new module, no new dependency, no contract change (the shell types the world as props.ts'
  `PropWorld`, so the new members are visible to it as they are).
- How it reaches the solver without first-load code: the world writes the body's OWN fields once a frame (in `beginFrame` -> zoneStep, before the bodies step):
  `p.tableMu`, `p.glue`, `p.groundDamp` and `dragF` (the solver reads them every substep, as before), and nudges (`SoftBody.nudge`) for wind, updraft, waves and the
  guard. At the bind (`trk`) it saves the body's own four values; when the body leaves the world (`setPropWorld(null)` or another world) it writes them back
  **bit for bit** (probe row). `p` is a per-body object (applyMaterial's copy), so no other body shares it.
- **The live places are untouched**: `PROPS.SURF_LIVE = false` keeps Home and Hearthlog Cabin on the published floor (their ground and rug patches are NOT applied,
  no guard); their zones have no wind, updraft or wave. Probe row: a body on Home's Snooze Rug and on the cabin's rug keeps its four values bit for bit, its eased
  multipliers all 1. (PLACES 4.2 gives the cabin boards grip 0.9 and its rug 1.25 / glue 1.1, Home's Snooze Rug grip 1.15: a feel change to a LIVE place nobody
  asked for this round; one flag turns it on. ORCHESTRATOR's call.)

## 2. What is built (each with its probe rows; `node _harness/probe_playground.ts --only=surface,surf,wind,updraft,guard`)
### 2.1 Surface modifiers (item 1; PLACES 2.2 ground patches, 2.4; PLAYGROUND_BUILD 8.1)
- Per tracked body, from the PlaceDef: the place's `ground` {grip, glue, peel, drag}, replaced field by field by the first patch that holds the body's centre, grip
  x `WET_GRIP` 0.8 inside a wet zone that is on (Rainleaf's Rain only in its shower phase, 40 s on / 30 s off on the world's clock from the arrival; the Drip Leaf's
  zone when the shell switches it on; sticky stretch and slime keep theirs), x the shell's mods[0..3]; eased with `MODS_TAU` 0.1 s (95 % in 0.3 s); written into
  tableMu, glue, groundDamp, dragF (drag 1/s x the multiplier: ice's 0.25). A sleeping body is not eased (it applies at the next wake, 8.1).
- **ICE** (Frostbell's Ice Pond, the patch with `ice: true`): the grip is ABSOLUTE, `ICE_MU` 0.3 x the family's ice grip (FAMILY_REACT.iceGrip), so the glide ranks by
  ice grip exactly. **Deviation from PLACES 2.4's arithmetic, with the measurement:** "tableMu x ice grip" (firm silicone 2.25 x 0.08 = 0.18) glides at most
  **0.225 m** from LIFE's 0.8 m/s GLIDE nudge (12 families: 0.225 firm .. 0.002 sticky; scratch `r6_phys/x/ice1.ts rel 1 0.8`), under LIFE's own GLIDE REACT threshold
  (0.5 m, data/life.ts) and quest I3 "GLIDE on the Ice Pond" could never be done. With ICE_MU 0.3, nudged at 0.8 m/s on the pond (m, ice / packed snow beside it):
  firm silicone 0.69 / 0.003, pop dome 0.68, gummy 0.66, jelly gel 0.61, water fill 0.60, bead squeeze 0.50, marshmallow 0.44, slow-rise 0.38, mochi 0.34, putty 0.30,
  sticky stretch 0.18, slime 0.15 / 0.004; **Spearman 0.993** against the ice grip (PH-08 bar 0.8). Every family stops dead on the snow (<= 0.005 m).
- **Wet grip** (row): Rainleaf's rain, jelly x0.682 (want 0.85 x 0.8 = 0.680), sticky stretch x0.851 (keeps the loam's 0.85); at 45 s (dry phase) jelly x0.849.
- **Sand** (PH-08 "sand stops a slide within 0.3 s"): Ripple's grip 1.35, 6 families nudged at 0.8 m/s: the foot's mean move after 0.3 s 0.1..0.4 mm (a slide moves the
  particles on the floor together), each slid 1..3 mm in all.
- **The density seam PG_SHELL asked for** (SoftBodyLike.mods[4], served by the world because softbody.ts has no bytes for a field): `world.mods(body)` -> the body's 8
  floats (null for a body of another world). [4] starts at the family's DRY density; the shell writes the soaking / drying foam's density (lerp to soakedDensity by
  its soak look) at <= 10 Hz; physics reads it every frame for water (and lerps the field catch to `catchSoaked` by the same share). A sleeper in water wakes when [4]
  changes by more than 0.02 (8.1). Row: a dry slow-rise floats in the Steam Pool (lowest point 0.012 m: it rises until its submerged share is its density), written
  1.2 it settles (0.000 m, submerged 0.16), asleep there a change of 0.01 lets it sleep on, written 0.15 it wakes and floats again (0.012 m).
  [5] x the family's catch, [6] x its pad bounce gain, [0..3] x grip / glue / peel / drag on top of what physics already applies (the shell need not write them).

### 2.2 Ripple Shore's surf edge (item 2; PLACES 4.3)
PLACES 4.3 asks for more than the static zone ("surface 0.06 m rising to 0.12 m on a wave every 7 to 10 s"), so: a water zone with `wave` data gets waves on the
world's clock (deterministic draws in its every-s range): rise 1.6 s, hold 0.6 s, fall 2.8 s (smoothstep), surface + amp x level; while it rises its water runs toward
the shore at up to `WAVE_V` 0.12 m/s (back at 0.6 x as it falls): a FLOATING body follows it by its water drag, a wader never (its drag is toward rest, as for a
current). Every second wave's crest sways one chime of the place and rings it (a strike of cause 2: a sound only, D-64; the shell already skips USE for cause 2).
Rows (62 s): 7 waves at 8.4 .. 58.9 s, gaps 7.5..9.6 s; a jelly wading at the water line: submerged 0.010 .. 0.038, moved 0.0000 m; a floating mini marshmallow
(frac 0.1) carried 0.031 m shoreward and back; 4 cause-2 strikes, 0 of another cause. Readout `world.waveLevel(zone)` (0..1) for the render's surf lines and the sound.
A wave does not wake a sleeper (its last wet share stands).

### 2.3 Wind gusts, the updraft, the Puff Pads, the Sunbow Arch (item 3; PLACES 2.2, 4.8, 4.10; PH-17)
- **Gusts**: a wind zone with `gust` data runs its own clock (first gust within its every-s range of the arrival, each `forS` long, ramped in and out over
  `GUST_EASE` 0.3 s), or the shell drives it: `world.setGust(zone, on)` (the first call hands that zone to the caller for good: drive it from LIFE's `lifeGustOn` so
  LIFE's HOLD_ON, the gust sound and the push agree; PG_LIFE's round-4 request). A gust pushes an AIRBORNE or FLOATING body inside the zone by `WIND_ACC` 1.2 m/s^2 x
  its catch x strength x the ramp, never a held one (fingers, a grab, a carry, a lock, carryTo, moveTo), never a grounded or sleeping one. Direction: the zone's `flow`
  when the data gives one, else from the zone's centre toward the play area's centre (+x for a zone centred on it): Lanternroof wide's Night Breeze blows toward the
  roof's middle (-x), the tall one and Frostbell's / Cloudloft's back-band zones +z (from the back toward the camera). A gust's start sways the chimes hanging in its
  zone and rings one (cause 2). Readout `world.gustLevel(zone)`.
  Rows: the Night Breeze's own clock, 62 s: 7 gusts, gaps 6.3..10.0 s, each 2.50 s; a marshmallow tossed up in it drifts **0.156 m** along the wind (gust minus no gust),
  a putty 0.016 m; a grounded marshmallow moves 0.0000 m, a carried one ends 0.0000 m from its carry spot, a sleeper stays asleep, through 2.5 s of gust.
- **The updraft**: an airborne body inside the column falls with gravity x (1 - 0.4 x catch x strength) (PLACES 2.2): dropped from 1.2 m a marshmallow takes x1.333
  as long to land inside as outside (sqrt(1 / 0.6) = 1.29), a putty x1.037. A ball off the floor in the column too, at its data's `updraftCatch` (else 0.8): the
  Cloud Ball poked up at 3 m/s stays up x1.478 (1 / (1 - 0.32) = 1.47). "A light squishy rides up gently": with the pads, a pop dome's kicks grow to the pad's cap
  speed and that carries it higher in the column: highest 0.325 m there vs 0.273 m outside (x1.19); a marshmallow's own bounce is small (its squash swallows a kick,
  PG_PHYS R4.4) but stays up longer (0.167 / 0.150 s). No net lift is added (PLACES 2.2 says "falls slower"; a body that rose by itself would need the guard to
  hold it in).
- **The Puff Pads** (PLACES 4.10 "M11 x3"): round 4 built only part 0 of a multi-part pad thing. Now a pad thing of `p.n` parts builds part i at (p.x<i>, p.z<i>)
  (wide); tall: (p.tx<i>, p.tz<i>) when given, else part 0's wide offset (REQUEST to PG_DATA below: the tall offsets put two pads outside the 2.5 m frame).
- **The Sunbow Arch** (p.arch, was "not built yet"): 3 static capsules r size[0]: part 0 the -x post, part 1 the +x post (floor to the top bar's centre line), part 2 the
  top bar along local x at height - r; p.width / p.height. (For PG_RENDER: the poses follow that order.)
- **NOT built** (by order, D-96 names wind and the updraft as the only new physics): the Vane Disc's turntable (it stays flush floor: no collider, no gust torque).

### 2.4 The bounds guard (item 4)
The play area's limits per side from the layout: a side with a wall beyond the bounds' edge (Lanternroof's parapet on four sides) stops at the wall's inner face; an
open side (Cloudloft, and every S2 place) at the edge + the corral's rim + 0.05 m. For a body nobody holds: on a walled side, when the body reaches above the wall's
top (`WALL_H` 2.4 m: the physics parapet is taller than the drawn 0.6 m one, so below it the wall itself holds every toss) its centre stays inside the inner face less
its radius (outward speed reflected, `GUARD_E` 0.35); on an open side past the limit likewise at any height (the corral's rim bounce acts first; this is its backstop),
and a body RESTING past an open side for 1 s is carried back in (carryTo, 1.2 s). Rows (`--only=guard`: 4 layouts x 3 families x 12 throws: 6 m/s out + 4 up from
near each side, 10 m/s up beside each side with 1.5 m/s toward it, the corners; gusts on, the updraft on, setBounds as the shell sets it): Lanternroof wide / tall:
no centre past a parapet's inner face (worst -0.230 / -0.231 m), no particle through or over one (worst -0.293 / -0.290 m inside its outer face), above the parapet's
top worst 0.007 / 0.005 m past the inner face less the radius (bar 0.1); Cloudloft wide / tall: worst -0.300 m (the corral's rim holds them); after 6 s all 144
inside. **A/B** (`r6_phys/x/guard0.ts`): with the guard off, 3 of the 5 over-the-parapet throws come to rest ON the 2.4 m physics parapet (y 2.74..2.77: in the air
above the drawn one).

## 3. Regression (`r6_phys/after1/`; tree `r6_phys/mine` = `git archive HEAD` + my two files only, because other round-6 lanes' edits were in the working tree)
softbody.ts is unchanged, so only the probes that import props.ts can move: probe_playground, probe_app, probe_chatter, probe_pg_data, shellview/node_checks
(grep of `_harness`; pf00_work is a scratch tool). The physics-only probes (softbody, lock, cut, flush, neck, parts, tips, materials, families, many, truecut,
species) bind no PropWorld and run no line of props.ts: not re-run (their HEAD numbers in section 0 stand). `npx tsc --noEmit -p tsconfig.json`: exit 0 on the
`mine` tree and on the working tree (with the other lanes' edits) at the end.
| probe | HEAD | after |
|---|---|---|
| probe_playground (quick set) | 56/56, 32.1 s | **73/73, 41.1 s** (+17 rows; the 56 old rows: 50 identical values, 2 timing rows (PH-09 0.35 -> 0.40 us, PH-12 x1.097 -> x1.084), 2 INFO / row texts updated (PH-15's "not built" list, PH-23's cause-2 note), and 2 S2 rows moved by the new surface, as they should: Ripple's wading jelly submerged 0.211 -> 0.209 (the sand's glue and peel), the Glide Ramp's firm silicone slid 1.04 -> 1.12 m (it runs out onto the ice)) |
| probe_playground --only=alloc (PH-11) | 0 B, 0 B | **0 B, 0 B** and the new round-6 row **0 B** (windows 16, 0, 0, 0 B) |
| probe_playground --only=surface,surf,wind,updraft,guard (all four guard layouts) | - | **18/18** (also on the working tree with R6_DATA's data edits: 30/30 with water, pad, order) |
| probe_app | 187/187 | **187/187** |
| probe_chatter | 42/42 | **42/42** |
| probe_pg_data | 32 ok, 2 FAIL | **the same 2 FAIL** (DT-01 Home B5 phone ball spot; cabin tall rocker under the HUD: PG_DATA's camera rows, not physics) |
| shellview/node_checks | 171/171 | **171/171** |
| probe_gestures, probe_trophies, probe_merge, probe_life, probe_journal, probe_quests, probe_pg_lifequests, pg_node_checks | 160/160, 31/31, 22/22, 117+1 (LF-02), all, all, 14/14, 40 | not re-run: none of them imports props.ts or a changed module |

## 4. For the other lanes (requests)
- **PG_SHELL** (later-life.ts; nothing is REQUIRED: ice, wet grip, waves, gusts on their own clock, the updraft and the guard all act from the PlaceDef the world is
  built from): (1) **density**: for a foam (slow-rise, marshmallow) write `world.mods(c.body)[4] = density + (soakedDensity - density) x min(1, soak look)` at
  <= 10 Hz (`mods` returns null for a body not bound to that world); that closes PG_SHELL R4.7's "mods not built" and SOAK -> sinks. (2) **gust sync**: once a frame
  for each wind zone k, `world.setGust(k, lifeGustOn(lifeWorld, k))` (PG_LIFE R4's request): then the push, LIFE's HOLD_ON and the gust sound share LIFE's clock
  (until then physics' own clock runs, same every-s ranges, its own draws). (3) readouts for the sound and look: `world.gustLevel(k)` (0..1), `world.waveLevel(k)`
  (0..1, Ripple's surf), `world.time`. (4) cut pieces made at a place should be bound to the world (`setPropWorld`) like the party, or they get no ice, wind or guard.
- **PG_DATA**: (1) Cloudloft's TALL layout has one spot for the Puff Pads thing: give parts 1 and 2 their tall spots as `p.tx1, p.tz1, p.tx2, p.tz2` (today they sit
  at their wide offsets from part 0, -4.8 m and -2.6 m in x: outside the 2.5 m frame). (2) a wind zone's direction is its `flow` [vx, vz] when given; without one
  physics blows from the zone's centre toward the play area's centre (Lanternroof wide: -x, toward the room; Frostbell's Wind Gap, Cloudloft's Breeze, Lanternroof
  tall: +z, from the back toward the camera): set `flow` where a designer wants another. (3) ICE_MU (props.ts) is the physics' answer to the GLIDE threshold; if you
  re-tune `iceGrip`, PH-08's ranking and the 0.5 m glide row will tell.
- **PG_RENDER** (Cloudloft / Lanternroof looks, when built): the prop order and geometry physics uses: the Puff Pads = 3 flush pad props (part 0 at the thing's spot,
  parts 1 and 2 at p.x1/z1, p.x2/z2); the Sunbow Arch = 3 static capsules r 0.16: two posts at local x = +-(width / 2 - r) from the floor to height - r, the top bar
  along local x at height - r (its caps on the posts' centre lines); the Vane Disc has NO prop (flush floor); the parapet walls are 2.4 m tall in physics (WALL_H)
  under the drawn 0.6 / 0.3 m parapet (the guard keeps a toss from landing on the invisible top). Surf lines can follow `waveLevel`, gust streaks `gustLevel`.
- **Orchestrator**: (1) `PROPS.SURF_LIVE` (false): the cabin's boards (grip 0.9) and rug (1.25 / glue 1.1) and Home's Snooze Rug (1.15) are NOT applied, so the two
  live places stay bit for bit as published; flip it when the owner wants those feels. (2) contracts.ts' `SoftBodyLike.mods` comment still describes a field on
  the body: it is served as `PropWorld.mods(body)` (no first-load bytes); a one-line note there would keep the seam honest (contracts.ts is not my file).

## 5. Known issues and NOT done (honest list)
- NOT built by order (D-96): the magnet, turntables and motors (Fizzwell, Cogwhistle; and Lanternroof's Vane Disc, a gust-turned turntable, stays flat floor: "push it
  round with a poke" and "ride it when the breeze turns it" do nothing). Say if the Vane Disc is wanted: it needs a hinge turntable whose surface carries a body on the
  table pass (the table friction does not know a moving floor today), so likely a few solver bytes.
- Per-family grip on the Glide Ramp: prop friction is the prop's mu for every body (the solver has no per-body prop friction, and softbody.ts has no bytes): every
  family slides the 0.1 ramp alike, then glides on the ice by its family. The ramp's foot is in the pond, so the ranking shows where it lands.
- The glide distances use ICE_MU 0.3 (absolute), not PLACES 2.4's tableMu x ice grip (measured too short for LIFE's GLIDE: section 2.1).
- Waves never wake a sleeper (a wader that fell asleep keeps its last submerged share); gusts never wake one either (they act on airborne / floating bodies only).
- The guard's carry-back exists only for OPEN sides (a body resting past a parapet cannot be carried over a 2.4 m wall by carryTo's 0.6 m arc); with the walls and
  the guard none got there in 144 throws, but a hand that lifts a body over a parapet and lets go outside it would leave it there.
- The updraft adds no net lift ("falls slower"): a marshmallow's own pad bounce stays small (its squash swallows a kick); a firm pop dome rides 1.19 x higher there.
- The quick set of probe_playground is 41 s on this machine (the 20 s target was already missed at HEAD, 32 s); the new sections cost about 9 s of it (guard 2.2, surface
  2.9, surf 2.2, updraft 1.3, wind 0.7). `--only=guard` runs all four layouts (about 25 s).
- No browser run (none needed for physics-only changes in a chunk that Home and the cabin run bit for bit; the S2 / S3 places are not shipped). No git write command
  was run. Nothing of mine left running (`ps` checked).
