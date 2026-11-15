# JUDGE: feasibility and performance (technical director), PLAYGROUND proposals A, B, C

Judge of the design panel, 2026-11-15. Lens: will it run, on a mid-range phone, without breaking what already works. Paths relative to
G = `games/wobblehoard`; line numbers are the tree at HEAD 8ad72fe1 plus the SHELL-4 WIP.

**Read:** STATUS, COMMON, SESSION3, DIRECTION (with 1b), PROPOSAL_A, PROPOSAL_B, PROPOSAL_C (all three in full), the five maps in `_handoff/maps/`.
**Checked in code:** `src/physics/softbody.ts` (supported gravity 1900-1917, float hover 1918-1927, moveTo 1863-1873, collide 1331-1414, the table
pass 2214-2290, slosh 2338-2351, memory 2551-2585, strands 2825-2834, constants 155-186), `src/physics/shape.ts` 205-216, `src/contracts.ts` (SoftEvent,
SoftMetrics, SoftBodyLike, StageLike, Settings), `src/shell/bodies.ts` 95-102 and 171-175, `src/shell/mat.ts` 18-24 and 118, `src/shell/game.ts` 381,
`src/shell/boot.ts` 88-98, `src/collection/store.ts` 138-149 and 259-265, `src/collection/ghost.ts` 152-166, `vite.config.ts` 9-24 and 177-192, `_spec/UI.md`
line 21, `_handoff/reports/SHELL_4.md` line 98.
**Ran:** one short node script in my scratch folder (sphere float limits per water depth, the table friction cap against field accelerations,
prop pose jumps against the particle speed clamp, hop land speeds, mean edge lengths). No tsc (I wrote no code), no probe, no browser, no build.
**Did not check:** any timing on a phone (nobody has one); how detail-2 wholes or the lite fine mesh look; the cost of `foldLimit` under props; the
env bake time at travel; any per-chunk size (no build exists in the tree); how any voice sounds; the name gates.

---

## 1. Scores (this lens only)

| Proposal | Score | Why |
|---|---|---|
| **A** (toy first, 4 places) | **5 / 10** | Precise and honest physics data (sizes, E-numbers, `auto` on land, 0.12 s ease-out, no run-time swap, sleeper mesh skip, journal under its own key). But its load-bearing play depends on things the code cannot do: **autonomous climbing** with 1.26 to 1.90 m/s hops onto 0.14 m steps and 0.24 m cushions (box-edge creases, land events, unproven on 12 families); **its water is too shallow for its own moments** (Shallows at 0.42 m: a body of R 0.5 floats only below density 0.38, so Puddlo at 0.98, jelly 0.92, pop dome 0.80 sit on the bottom; the first-minute "Puddlo bobs in the surge" is false); per-particle buoyancy (the PHYS map warns it bulges the skin); tack and strings on props that do not exist (2.2, M2); detail-2 wholes for every non-active party member although the player can touch any of them; a first-load delta of ~100 KB that breaks D9 once the UI overhaul spends its 90 KB; physics round 3 is not sequenced before its physics; S1 needs water plus three mechanism kinds. Only 4 places (written before 1b). |
| **B** (purpose first, 4 places) | **6 / 10** | The soundest performance stance: no detail-2 wholes, sleep does the work, a deterministic **cost-in-units** cap, hops kept under the 0.9 m/s `land` threshold, whole-body buoyancy with a worked float check, the slosh push enabled in water (it read `softbody.ts` 2346 correctly), the grab-and-carry floor and physics round 3 as **step 0**, and the one reward (4 chosen gift squishies) that keeps the pace by construction. But the Cove's centrepiece is infeasible (the **Tide Puddle** has 0.8 m walls; a 2.0 m/s "water hop" has a 0.2 m apex, so nothing gets in or out by itself); props of **0.08 m** and posts of r 0.05 are thinner than the mean edge of large bodies (0.088 m at detail 3) and of detail-2 pieces (up to 0.123 m), so they poke through; sleepy ones "scoot on" 0.10 to 0.12 m seats with 3.6 cm hops (unproven) and then cannot sleep there; `PlaceId` and `EmoteId` unions inside `contracts.ts` make every new place a contract change (against 1b); first load +110 KB breaks D9 like A; its own med worst case (3 wholes + 6 pieces = 9) exceeds its own cap of 8. Only 4 places. |
| **C** (systems first, 10 places) | **7 / 10** | The only proposal that meets 1b, and the one built for feasibility: flat ground, chunky props, **nothing climbs**, life mostly in the eyes so bodies sleep, nests as floor rings (sleep-compatible), one free prop per place, a 14-mechanism library with checked ranges, the cost of a 10th place, **S1 in the cabin (no water)**, physics round 3 first, the UI overhaul and SHELL-4 counted in the size budget, N/B/O-tagged checks with a prop cost row (PH-12) and a 4x-throttled perf row (PF-01), and it flags its own unproven items. Defects that must be fixed: the run-time `hush` from `performance.now` feeds LIFE (non-deterministic); a 1 / 2 / 4 autonomous-mover cap that its own finales (parade, three-in-a-basket) cannot meet on `low`; a wrong slosh claim (2346 gates on `!gravityOn`); `hop` refuses when not grounded, so the seesaw teeter and spring pads cannot work; wind, updraft, magnet and current as field forces do nothing to a grounded body; the Fizzwell Tub puts the ceremony pad under 0.9 m of water; the Bob Boat is a 2-DOF joint outside its own 4 joints; bowl capsules r 0.07 break its own 0.16 m rule; 11 lifetime capsules push the fastest style to 2.8 min a capsule in week 1 (below the 3.0 gate, by its own arithmetic); the `questGifts` hoard field is dropped by every older build; data for 10 places at "12 KB" is about 3x low. |

**Recommended base: C**, with the corrections below and B's performance stance where they differ (section 6).

---

## 2. Load-bearing claims checked against the code

| # | Claim (who) | What the code does | Verdict |
|---|---|---|---|
| K1 | Bodies rest, nap and sleep **on prop tops** (A Puff Cushion, Rocker nap; B Snooze Cushion, Drift Raft, Rocking Seat; C Sponge Raft, spinner ride) | Supported gravity fades only by `supp = smooth01((near - 1) / 4)` (softbody.ts 2290), and `near` counts particles with y < NEAR = 0.01 m **above y = 0** (2235-2236, 184). On any prop top `near` = 0, so gravity is full and, as the code's own comment says, "a body at rest would sag and creep" (1900-1904). `grounded` (3+ near particles) is false, so the rest test never passes. | **Breaks in all three.** Must-fix F1. |
| K2 | Sticky stretch and slime **stick to props, peel off with strings** (A M2, 2.2 cushion, seesaw, chimes, rocker; C "sticks to the seat, never falls off", "sticks to the pad, then peels off with a thwop", "sticks to floaters (tack)") | Tack is an absolute rest height `H0` above y = 0, applied only inside the table loop (2241-2244, 2262-2271). Strands fire only from a retracting fingertip that held the skin (2825-2831). | **False as physics.** Prop friction mu only (B says so honestly for the yarn). Reclassify to L/B or build a new strand source. F9. |
| K3 | Wind gusts make light families **drift**; an updraft makes a marshmallow **hover 0.3 m**; a magnet makes beads **roll to it**; a current moves bodies (A 1.3, B 1.3, C 1.0 zones and 2.3) | Table friction caps tangential motion per substep at `mu x (load + fload)` (2245-2250) with `load = supp g H^2 x min(LOAD_CONC 10, Mtot / nearMass)` (2221, 186). A grounded body needs about **15 to 27 m/s^2** (more where the load concentrates) to slide; the proposals use 0.5 to 1.2 m/s^2. C's updraft is 1.08 m/s^2 against g = 10. | **No visible effect on grounded bodies**; on the support threshold a small upward push makes a jitter limit cycle (gravity is zero while supported, returns at GOAL_FLOAT 0.03 R, 1916). F8. |
| K4 | Water-filled ones **slosh push** in water (C 9.5 "slosh still works because it pushes when not supported") | The liquid's push runs only `if (!this.gravityOn)` (2346), i.e. float mode, because on the table it "slid the whole body 18 cm" (2344). | **C wrong, B right** (B enables it in water, P10). A's swing slosh is a shell bulge only, which is fine. |
| K5 | Float lines (all) | Sphere model, body resting on the floor: depth 0.42 m (A Shallows) floats only density < 0.54 / 0.38 / 0.26 for R 0.4 / 0.5 / 0.625; 0.55 m (C Tide Pool) < 0.77 / 0.57 / 0.41; 0.75 m (B) < 0.99 / 0.84 / 0.65; 0.9 m (C Tub) < 1.00 / 0.97 / 0.81. | A's Cove float moments are false for every family except slow-rise and marshmallow; C's "jelly floats low" (0.97) is false in the Tide Pool, true in the Tub. F7. |
| K6 | Props couple two ways by "mass-weighted correction" in **body masses** (balls 0.1 to 0.4 body masses, seesaw inertia) (all) | Particle masses are normalised to a mean of 1 (shape.ts 216), so `Mtot` = particle count (softbody.ts 590): a detail-3 whole weighs 642, a detail-2 whole 162, a 1/8 piece at detail 2 also 162. | **Unspecified everywhere**: a seesaw would tip 4x harder for a detail-3 body than for a detail-2 twin, and a 1/8 piece would weigh as much as a detail-2 whole. F3. |
| K7 | Props are kinematic inside a frame and integrate once per frame (all) | Fingertips advance **per substep** (`fdx = cx - f.ocx`, 2129) under a 5.5 m/s cap. A prop that jumps once a frame moves 3.3 / 4.2 / 5.0 cm at 2.0 / 2.5 / 3.0 m/s; corrected in one substep that is 12 / 15 / 18 m/s of particle speed against the 14 m/s clamp (158). C's swing seat reaches 2.5 m/s; A's and B's balls 3 m/s. | **Launches and jitter.** F2. |
| K8 | Autonomous hops under 3.5 to 3.6 cm fire **no `land` by construction** (B, C) | `land` needs 8 airborne substeps and a centre fall speed over 0.9 m/s (2285, 155). A 3.6 cm apex lands at 0.84 m/s: a 0.06 m/s margin, before the goal's un-squash adds rise. Landing on a prop top never fires `land` at all (the detection is in the table loop); stepping off a 0.2 m seesaw end does. | Thin margin. Keep the cap and **also** mark every non-thrown landing `auto` (C's rule, 9.5). F11. |
| K9 | `moveTo` scoots a body over a 0.10 to 0.12 m lip (C bowls, spinner, spring pads; B seats) | `my = this.gravityOn ? 0 : ...` (1867): the glide is horizontal whenever gravity is on, and friction never sees it (1863-1864). Getting over a lip relies on the prop pass shoving the front particles up. | Unproven (C says so: "if PH-03 fails, lips drop to 0.06 m"). Keep C's fallback as the plan, not the hope. |
| K10 | A squash pose is captured by plastic memory unless capped (C 2.1 "capped at 20 s") | Memory is measured against `GB`, the goal without the memory arm (2555-2558): a goal the body is MADE to take is not remembered. | Harmless misreading; the real risk is the lag during a fast anticipation squash and the landing impact (keep C's PH-06 dent row). |
| K11 | Sleep saves ~0.69 ms per resting body (all) | Measured by the PHYS map; but memory families must finish `MEM` first (putty heals over 40 s, so ~3 time constants is ~2 minutes awake after each dent). | Sleep is real but slower for putty, mochi, slime, beads. F6. |
| K12 | `collide` scales fine to 10 characters (implicit) | Every ordered pair calls `o.boundRadius()`, O(n), inside the loop (1334-1340), from `bodies.step` (bodies.ts 171-175): 10 characters = 100 bound-radius passes a frame. | Small (~0.05 ms) but N squared; cache once a frame and skip asleep-asleep pairs. F12. |
| K13 | A hoard field `questGifts`, "migrated by absence", makes quest capsules idempotent (C 9.10) | `serializeHoard` writes a fixed key list (store.ts 259-265) and `sanitizeHoard` rebuilds field by field: the **deployed** build 2683d349 and any rollback drop the field on their next write; the new build then sees "finale done, bit missing" and grants again. | **Double grant across builds.** F14. |
| K14 | First load stays under 1280 to 1290 KB (A, B, C) | `UI.md` line 21 gives the UI overhaul ~90 KB inside the old 1229 KB gate, so the tree before PLAYGROUND can reach ~1229 KB. D9's 1300 leaves **~70 KB**. A adds ~100, B ~110 (both over), C 60 (fits only if its 12 KB for 10 places of data and text holds; A's own estimate is 23 KB for 4). `boot.ts` 94-98 loads physics, stage and audio before play: they are first load. | A and B break D9; C is at the edge. F15. |
| K15 | Float mode (gravity off) (none of them) | `Settings.gravity` is a player setting (contracts.ts 426); mat extras inherit it (mat.ts 118); the hover spring pulls every body to the **world origin** x = z = 0 (1923-1926). | **Unaddressed by all three**: a party in float mode collapses to the middle and props, zones, hops and bounds mean nothing. F10. |
| K16 | X08 pieces cost about what 2 wholes cost | SHELL_4.md 98: 6 pieces 1.207 ms vs 2 wholes 1.223 ms per frame in the real shell (x0.99). | Confirmed. Pieces are not the physics problem; awake wholes are. |

---

## 3. The best ideas to keep (by proposal and section)

**From A**
- 1 intro: flat ground at y = 0 under the whole play area, slopes as tilted boxes, a dry pad 1.0 m from every prop, 5 spawn spots.
- 2.1 rule: cold, warm, wet, sandy and snowy never change stiffness or damping in v1 (no re-gating of 12 families).
- 3.4: hop = `setSquash` then `hop` with glue and peel suspended for 10 substeps; putty and slime never hop (they lean and glide).
- 3.5 and pushback 3: the brain flips at once, but LIFE drivers ease out over ~0.12 s (a hard cut pops the goal under the finger).
- 5.1: squishmoji as a data table of at most 6 SDF primitives in one fragment shader (CSP-safe, one draw); 5.2 the cheapest voice (one
  oscillator, cached PeriodicWave per flavour, one envelope, one formant, panner only off centre) and the `ChatterLimiter` backstop.
- 5.3 / pushback 2: autonomy causes zero haptics. 5.2: chatter never in `ROOM_KINDS`, priority -1, its own rng, silent in ceremonies.
- 9.2 frame order: act after `flushPendingUps` and before `bodies.step`, sense after `drain()`; first version as `onStep`.
- 9.5: no fine-mesh update for a sleeping body; lite fine mesh for chunks.
- 9.7: the journal under `wobblehoard:v2:journal`, newer = read-only, unreadable = parked, union / max merge, `JOURNAL_MIGRATIONS` from day one.
- Pushback 4: no run-time detail swap (it pops the body upright and ticks the luminance).

**From B**
- 3.4: autonomous hops capped at vy 0.85 m/s (apex 3.6 cm) by family group, so the default case never reaches `land` (keep the table of squash, time, vy).
- 2.1: the worked float check (density against the submerged share for R 0.5 and R 0.625), with density as an input of the water zone.
- 6 and pushback 2: **no detail-2 wholes**; sleep does the work; detail 2 stays for small pieces, as today. "If the frame budget is missed, lower
  the awake cap, not the mesh."
- 6: the cost budget in **units** (awake whole 1, sleeping whole 0.05, piece 1/3): a deterministic cap that the code can count.
- 6: a cut keeps the party; when units overflow, sleep the farthest untouched whole first, then refuse kindly.
- 9.5 P10 and P11: enable the slosh push in water (the code gates it today); the grab-and-carry floor before props (props make "below the
  ground" common).
- 7.12: rewards are 4 chosen gift squishies for life, Common and Uncommon, origin `'restock'`, no roll; the pace holds by construction.
- 11.2 step 0: SHELL-4 verified and physics round 3 first.
- 9.9: the next place's chunk prefetched in idle time after its unlock (still lazy).

**From C**
- 0 rules R1 to R10, especially R2 (chunky props, one free prop), R3 (nothing climbs), R4 (life mostly in the eyes so bodies sleep), R7 (autonomy
  can never pay), R9 (measure, do not guess), R10 (node first).
- 1.0: the **14-mechanism library** with allowed parameter ranges checked by a data probe (DT-01), the 8 zone kinds, ground patches, the place
  frame (pad r 1.2, 6 spawn spots, camera box), and 1.11 the cost of a 10th place (data ~1.5 KB, render chunk <= 45 KB, audio <= 6 KB, no new
  physics, LIFE or quest code).
- 1.1 and 2.4: nests and baskets as rings of capsules **on the floor** (bodies inside are grounded, so they can sleep).
- 2.5: the channel matrix per place, so the reaction tables cover every place by construction (DT-06).
- 3.4: the primitive table (scoot, hop, glide, lean, wiggle, settle) with costs; the glide on ice as real momentum (`nudge`), not `moveTo`.
- 5.4: token buckets, drop-not-queue, ducking chatter while the player touches, 0 haptics and 0 camera moves from autonomy, and the pure
  attention arithmetic in `src/life/attention.ts` (node-testable).
- 6.2: one brain per cut squishy, one group bubble with dots, one group voice; piece-to-piece bumps inside a group silent.
- 9.4 and 9.5: `auto` set on every `land` "unless the body was thrown by the player since its last landing"; prop stride with velocity and
  angular velocity; Coulomb friction with the prop's surface velocity; touched prop particles in the fold-limit list.
- 9.6: the ceremony dim for bright places; 9.11: one shared lazy **"away" chunk** plus one chunk per place.
- 9.9: the typed-array event ring and the clause grammar with `withinVisit`; quest indexes append-only.
- 10.3: the size budget counts the UI overhaul and SHELL-4 first.
- 10.5: PH-12 (prop cost <= 1.25x), PH-13 (the 50-species detail-2 sweep), PF-01 to PF-03 with a 4x CPU throttle, SH-05 (a spy on `collection.feed`).
- 11.2: **S1 in the cabin**: all five asks with no water, no slopes and no wind.
- 11.5: pure lanes start in node beside SHELL-4 and the UI overhaul; PLAYGROUND physics only after round 3, in one owner's hands.

---

## 4. Must-fix list (no proposal got these right, or the recommended base C gets them wrong)

| # | Problem | Correction |
|---|---|---|
| **F1** | Support on props (K1): a body on any prop top gets full gravity, sags and creeps, is never `grounded`, so it can never sleep or hop there. All three rest, nap, teeter or bounce on prop tops. | The prop pass counts a particle as **supported** when it is in contact with a prop face whose normal is within 35 deg of world up; supported particles add to `near` / `nearMass` for `supp`, `load` and `grounded` (2221, 2290), and to the `land` detection. No tack on props in v1. A body on a **moving** prop (hinge, slider, free) may not sleep. New PH rows: rest 3 s on a static box top, creep <= 2 mm, 12 families x 3 genomes and detail-2 pieces; hop from a box top. |
| **F2** | Prop pose jumps (K7). | In each substep the body sees every moving prop at `pose(t0) + v x (k H)` (and the rotation advanced by omega x k H), exactly as fingertips advance per substep; the prop still integrates its accumulated impulse once per frame. Clamp prop surface speed to 2.0 m/s (ball) and 2.0 m/s at the swing seat (C's 35 deg x 1.75 m reaches 2.52: lower the limit to 30 deg or the rope to 1.4 m). Row: no particle over 6 m/s from a prop contact. |
| **F3** | Prop coupling mass (K6). | The impulse a body puts into a prop is its correction x `bodyMass / Mtot`, with `bodyMass` = (restRadius / 0.5)^3 x frac (one unit = a default whole). Probe: the same species at detail 3 and detail 2 tilts a seesaw within 5%; a 1/8 piece tilts it 1/8 as much. |
| **F4** | Prop contacts in the fold limit every substep (all three) make every body resting in a bowl run `foldLimit` continuously; no proposal gates it (only C measures it, PH-12). | Add prop-touched particles to the fold list only while the contact is **worked** (penetration > 0.15 x mean edge, or relative speed > 0.3 m/s, or the prop is moving), mirroring the table's `worked` flag (softbody.ts 2227-2229). Keep PH-12 at <= 1.25x. |
| **F5** | Sleep ping-pong: "wake on a contact from an awake body" (A, C) wakes a pile forever while one member is still settling. | Wake on contact only if the awake body's centre speed > 0.05 m/s or its push is over 0.2 x mean edge in one substep; otherwise treat the sleeper as fixed for that pair. Bodies in contact sleep as an island (all members pass the rest test, then all sleep). Row: a pile of 3 sleeps within 3 s and stays asleep 60 s. |
| **F6** | Memory families and sleep (K11): "only after MEM converged" keeps putty awake for minutes. | Allow sleep when max abs(MEM - Q) < 0.02 R; while asleep run `memoryStep` at 1 Hz, and on wake ease the goal over 0.3 s. Count memory families as awake in the cost model until then. |
| **F7** | Float outcomes are hand-written and often false (K5). Water as a separate upward force on top of supported gravity also makes sinkers lift off and jitter (gravity is zero while supported, 1916), and "supported gravity off in water" (all three) makes sinkers sag and creep. | Water = **a scale on gravity**, `g_eff = g x (1 - f_sub / density)`: when `g_eff >= 0` (a sinker) the supported fade applies as today; when `< 0` it acts fully (a floater rises). Whole-body only (no per-particle buoyancy: drop A's E6 text). Every float / sink line in the reaction tables is **generated** by a data probe from density x depth x radius band, never typed. Pool depth per place is chosen from that table (for the water-filled family to float, depth >= 0.75 m at R 0.5). |
| **F8** | Field forces on grounded bodies do nothing (K3). | Wind, updraft, magnet and current act in physics **only on airborne or floating bodies** (field x submerged-or-airborne flag). On the ground they are LIFE and looks: a "hold on" pose, a lean into the gust, a scoot downwind, beads that scoot toward the magnet. C's updraft "hover 0.3 m" is cut or becomes a player toss that floats down slower (gravity scale 0.6 inside the column for airborne light families). This removes most of C's S3 physics risk. |
| **F9** | Tack and strings on props (K2). | v1: prop friction only; no "P" for sticking. Any "sticks and peels with strings" becomes a look: a new stage-side strand source (`partPieces`-style) triggered by the shell when a tacky body leaves a prop it touched for >= 0.5 s. Regenerate the reaction tables with this rule. |
| **F10** | Float mode (K15) is unaddressed. | In every place, and whenever LIFE runs with more than one body, tabletop gravity is forced; the float setting applies only to a single squishy at Home with autonomy paused. One kind line when it is overridden: "Here your squishies stand on the ground." |
| **F11** | `land` routing (K8). B routes by "untouched for 1.0 s" (a toss with 1.2 s of flight loses the player's thud). | Use C's rule everywhere: `auto` on every `land` and prop `bump` unless the body was thrown by the player since its last landing; keep B's 3.6 cm cap as well; PH row reports the maximum landing speed of autonomous hops per family. |
| **F12** | `collide` broad phase is N squared with O(n) bound radii (K12). | Compute `boundRadius` once per body per frame; skip asleep-asleep pairs before the sphere test. |
| **F13** | **C's `hush` input** comes from `performance.now` timing of `bodies.step` (10.2) and changes LIFE's choices: LIFE is no longer a pure function of the snapshot (LF-01, SH-01 break on a loaded machine). | LIFE's motion gate is a **deterministic awake-units count** (B's units: awake detail-3 whole 1.0, asleep 0.05, piece 0.25, touching pair 0.25) against a per-tier budget. Measured frame time stays in the shell for what it does today (refuse more bodies over `FRAME_BUSY_MS` 30, the tier drop at 24 ms) and is pinned under the dev hook. |
| **F14** | Capsule idempotency across builds (K13); A's journal-side `g.paid` and the hoard's counter are two keys written apart (a crash between them loses or doubles). | Prefer B's gift squishies with a **deterministic item id** per finale (for example `gift_c1`, 64 chars of A-Za-z0-9_-; check `makeRow` accepts it): order (1) hoard write adds the row, (2) journal marks it claimed; on load, a row with that id or a claimed bit means never again. Old builds keep ghost rows, so a rollback cannot double it. If capsules are kept, they may not rely on a hoard field older builds drop. |
| **F15** | First-load size (K14). | Measure the HEAD build first (one heavy job). Budget: **PLAYGROUND first-load delta <= 60 KB**. First load holds LIFE, the reducer, the journal store, the bus, the attention arithmetic, emotes, creature voices, sleep and drivers, Home's things, and only the data the brains and the reducer need as numbers. Lazy: the Journal and Travel screens **with all Journal text**, the away chunk (place host, prop kit, water, marks, ambience bed, prop voices), and each place's render, audio and player text. The G0 gate becomes: first load = the entry's static closure plus the closures of the three boot imports (`boot.ts` 94-98); a named allowlist of lazy entry modules; fail if any allowlisted module is in the first-load closure. Total <= 1900 KB, each place chunk <= 45 KB, away chunk <= 120 KB. |
| **F16** | C's mover cap (1 / 2 / 4) against its own finales (Sunrise parade minN 3, Snug as can be minN 3, "every clause reachable at low caps") and against sing-together sway as a physics wiggle. | Make every motion that does not translate the body **render-side** on a sleeping body: breathe, sway on the beat, wiggle, shiver, a lean of <= 0.1 R, the nuzzle press after contact. One per-body shear / scale uniform in the jelly vertex stage, applied to the eye anchors on the CPU too (face.ts fits the beads to the sim footprint, so they need the same transform). Physics drivers only for scoot, hop, glide and the last centimetres to contact. Then "movers" counts only translating bodies, and a group of 4 can sing at ~0 physics cost. Finales needing 3 bodies arriving in one place are satisfied by arrivals in turn (no simultaneity in the rule). RD row: a swaying sleeper's eyes stay on its skin within 1 px. |
| **F17** | `hop` preconditions: C refuses when not grounded; B when airborne. With F1 that is fixed for static tops; on moving props it is not. | `hop` is allowed when supported (F1) by the table or a prop; on a moving prop the hop's horizontal part is relative to the prop surface velocity. Teeter and spring pad rows (PH-04, PH-16) include hops from the prop. |
| **F18** | Prop thickness (B 0.08 m boards, r 0.05 and 0.06 posts; C's bowl capsules r 0.07 against its own 0.16 m rule; A's 0.16 m against its own detail-2 wholes at R 0.625, mean edge 0.175 m). | Minimum thickness and capsule diameter = 1.3 x the largest mean edge that can touch it: **0.16 m** with no detail-2 wholes (largest is a detail-2 piece at frac < 0.35 of R 0.625: 0.123 m), 0.23 m if detail-2 wholes are allowed. DT-01 enforces it for every collider part, including ring capsules and posts. |
| **F19** | Infeasible things: B's **Tide Puddle** (0.8 m walls, apex 0.2 m water hop); C's **Fizzwell Tub** (pad, capsule, decals and marks under 0.9 m of water, every floater awake under the tap swirl); C's **Bob Boat** (floater on a spinner arm: 2 DOF). | Tide Puddle becomes C's M6 pool (a rim of bars with one sloped entry, floor at y = 0, depth from F7). Tub: a bath *edge* place, water over at most half the play area, the pad dry. Bob Boat: an M12 floater with an anchored drift only, or a spinner with a seat (one joint each). |
| **F20** | C's economy: 11 lifetime capsules give its fastest paying style ~2.8 min a capsule in week 1 (its 7.11), below the 3.0 gate; this is not a "lever", it is a gate miss. | B's gift squishies (F14), or at most 1 capsule per finale from the third finale on, with the first two finales keepsake-only; re-run the sim once (heavy). |
| **F21** | Random salts: C uses `0x6c1fe0a7` for both the instance twist (2.6) and every per-character LIFE stream (9.3), so the first LIFE draw at place 0 equals the twist; A and B pick `0x3c6ef372` for different things. | One salt registry in `src/core/rng.ts` (or `src/data/life.ts`) with a probe that every salt is distinct from the three in use (CORE map 1) and from each other. |
| **F22** | Brain tick "every 6th step" (A, C) is 10 Hz only at 60 fps; at 30 fps it thinks at 5 Hz, so behaviour depends on frame rate. | Think when `simTime` crosses the next 0.1 s boundary (staggered by character slot); motion intents keep running every step. |
| **F23** | Zero allocation details: A's `PlayEventSink.push(...)` passes nine numbers to a non-inlined function (doubles box to HeapNumbers, the rule in softbody.ts 3-7); B's `bodyScreen?` returns an object. | C's typed-array ring for events; out-parameter Float32Arrays for screen points (A 9.3 and C 9.4 have the right shape). |
| **F24** | Contracts that lock content (B 9.1: `PlaceId`, `ZoneKind`, `EmoteId`, `BodyLook` unions in `contracts.ts`): a new place or icon becomes a contract change, against 1b. | Contracts carry numbers and strings; the unions live in `src/data/*.ts`. |
| **F25** | Harness time is underestimated: the full render run is already 52 min (RENDER map 8); C's per-place reruns of `sky`, `cer`, `chains`, `perf`, `gallery` over 10 places are hours. | Per-place browser rows run only for places whose chunk or shared kit changed (a hash of the place chunk in the report); one full sweep before each slice ships. The audio "O" checks need headless Chromium (OfflineAudioContext), not node: only `ChatterLimiter` and phrase planning are node. |
| **F26** | Economy check cost: A's EC-01 (5 real wholes + 6 pieces x 10 minutes x 4 places) and C's LF-05 (30 sim minutes on the real SoftBody) are heavy jobs. | B's EC02 shape: the real shell rig with moving mock bodies and the real collection, 30 sim minutes (light), plus one 2-minute run on real SoftBodies. |

---

## 5. What A and B must gain to reach the 1b set (and what the synthesizer must add on top of C)

A and B design 3 places beyond Home and have no mechanism library. To reach "at least 8 places beyond Home, cheap to add":
- **Adopt C's 1.0 library as the only way to build a thing.** Every A and B thing maps onto it: A's Puff Cushion and B's Bouncy Bough = M11
  spring; A's Driftwood Seesaw, Rocker, B's Tilt Board, Rocking Seat = M7; A's Pine Swing, B's Swing Basket = M8; A's Bob Ring, B's Drift Raft =
  M12; A's Sunball, Snowball, Felt Ball, B's four balls = M13; A's Shell Chimes, B's Driftwood Chimes = M10; A's Dune Slide, Sled Slope, B's Sand
  Slide, Sled Hill = M5 (player rides only, R3); A's Book Steps and Felt Ramp **steps are cut** (they exist only for autonomous climbing).
- A's Shake Pine (a branch pendulum triggered by a trunk bump) is M8 on a static M2 trunk: keep it, it is cheap and good.
- With A's and B's places folded in, the synthesizer has C's 9 + A's and B's variants of the same three; pick one beach, one mountain, one cabin.
  C's six others (Puddlebrook, Fizzwell, Cogwhistle, Lanternroof, Echo Hollow, Cloudloft) need the F8 and F19 fixes before they are real.
- **What C still lacks for the set:** a per-place cost table (draw calls and triangles of the set and props, particle caps, env bake time) and
  a ceiling of **at most 8 moving props and 12 collider parts per place** (B's 1 rule; C has no count cap besides "one free prop").

---

## 6. Contradictions the synthesizer must decide

| Topic | A | B | C | Recommendation |
|---|---|---|---|---|
| Autonomous climbing | yes (0.18 m climb hops, step boxes) | no (player rides) | no (R3) | **No.** Steps and tall seats are player rides; a wish asks for the ride (B 1 entry rule). |
| Autonomous hop height | 4 to 18 cm with `auto` lands | <= 3.6 cm | <= 3.5 cm | <= 3.5 cm **and** C's `auto` rule (F11). |
| Water model | per-particle buoyancy, 0.42 m shallows | whole body, 0.75 m basin with walls | whole body, pools 0.06 to 0.9 m with an entry | Whole body as a gravity scale (F7), C's M6 pool, depth from the generated float table; **water in S2, not S1**. |
| Detail-2 whole bodies | every non-active party member on low and med | none | chosen at spawn, DETAIL3_ONLY list | **None in S1 and S2** (B). With sleep and a mover cap, a detail-2 whole saves only ~0.5 ms per *moving* body, while the player can pick and squeeze any body (`pickBody`, game.ts 445-458) and detail-2 fold, press and pull rows are ungated (PHYS map 4). Revisit only with PH-13 and PF-01 data, never as a run-time swap. |
| Character caps | 6 / 8 / 10, awake 4 / 5 / 7 | units 3 / 4 / 5, awake wholes 2 / 3 / 4 | 5 / 8 / 10, movers 1 / 2 / 4, measured hush | Static caps: wholes 3 / 4 / 5 (today's `MAT_LIMIT`, mat.ts 22), pieces 4 / 6 / 6, characters 6 / 8 / 10. Motion gate: deterministic awake units (F13), provisional **1.5 / 2.5 / 4.0**, set from PF-01 (4x throttle) before S1 ships. High stays 5 wholes, not C's 6. |
| Where the attention arithmetic lives | `src/life` | `src/shell` | `src/life` | `src/life/attention.ts` (pure, node-tested); the shell only wires it. |
| Grounded wind, magnet, current | physics | physics | physics | LIFE and looks (F8). |
| First slice place | the beach | the beach | the cabin | **The cabin** (C 11.2): no water, no ramps, no fields; hinge, ball, bowls and warmth zones only. |
| Rewards | 3 capsules for life | 4 gift squishies | 11 capsules for life | **B** (F14, F20). |
| Event bus | function sink with number args | flat record | typed-array ring | C's ring (F23). |
| Contract typing | strings, data unions | unions in `contracts.ts` | numbers and strings | A / C (F24). |
| Prop collider list | packed stride 16 | stride 16 + per-body `propLoad` | stride 24 with velocities | C's stride 24 (it carries the velocities F2 needs), with F3's mass scale. |
| Size gates | 1280 / 1600 | 1280 / 1650 | 1290 / 1850 | F15: measure, first-load delta <= 60 KB, total <= 1900 KB. |
| "Phone" profile | coarse pointer or short side < 600 | coarse and short side < 600 | coarse or width < 700 | One boolean computed by the shell: coarse pointer **or** short side < 600 CSS px; LIFE receives it as data. |
| Brain rate | 10 Hz, motion each frame | 2 Hz | 10 Hz | 10 Hz on sim time (F22), motion each step. |
| Bubbles in photos | on (switch) | on (switch) | hidden | Either is one stage flag; no feasibility difference. |

---

## 7. Which proposal should be the base, per area (this lens)

| Area | Base | Take from the others | Why |
|---|---|---|---|
| **Places and things** | **C** (1.0 library, 1.1 to 1.11, 2.5) | A's per-thing collider sizes as the level of detail every thing must reach; A's Shake Pine; B's per-place collider count cap and luminance cap | Only C has the library, the ranges and the cost of an Nth place; fix F7, F8, F18, F19 first. |
| **Life and social play** | **C** (3.3 behaviours, 3.4 primitives, 4.1, R4, R5, LF-11 joint locks) | A 3.5 touch semantics and ease-out, A 9.2 frame order; B 3.4 hop table; B 3.3 "huff is never about the player's absence" | C's behaviours are the ones that let bodies sleep; add F16 (render-side idle motion) and F13. |
| **Emotes and voices** | **A** (5.1 SDF data table, 5.2 voice, phrases, pitch, `musicClock`) | C 5.3 Echo Hollow repeat without a DelayNode; B 5.3 pieces above D6 at -25 dB | All three are feasible; A's is the most exact to build and to gate. |
| **Pieces and the attention budget** | **C** (6.1 to 6.4, 5.4) | B 6 units and the kind refusal; A 6 "pieces allowed = min(MAX_PIECES, cap - (wholes - 1))" | C's one-brain group and pure buckets are the cheapest correct design. |
| **The Journal and rewards** | **C** for the Journal (7.1 to 7.4, 9.9 grammar and ring, 9.10 store) | **B for rewards** (7.12 gifts, 9.8 backfill, CO-07); A 9.7 for store bounds and two-tab rules | C's grammar scales to 10 chapters and is node-checkable; its rewards fail F14 and F20. |
| **The screens** | **C** (8.1 to 8.10: postcards grid scales to 10 places, the away chunk) | A 8 exact phone geometry and the "Wishes now" keyboard list; B 8.3 load-failure and "Packing up..." lines | Lazy and scalable; A's 2 x 2 Travel grid does not take 10 places. |
| **Architecture and build order** | **C** (9, 10.4, 10.5, 11.5) | B 11.2 step 0 and P11; A 9.3 out-parameter `bodyScreenPoint`; the F-list above | C sequences physics after round 3, starts pure lanes in node in parallel, and ships S1 with the least physics. |

### Build order I recommend (C's 11.5, corrected)
0. Gates first: measure the HEAD build; split G0 into first load and total (F15); `name_gate.ts`; `probe_life_imports.ts`; the salt registry
   (F21); contract members (numbers and strings, F24). In parallel with SHELL-4 and the UI overhaul.
1. Node only, in parallel: DATA (places from the library, the generated float table F7, DT-01 with F18), LIFE (with F13, F16 intents, F22),
   CORE quests + COLLECTION journal (B rewards, F14), the economy rig check (F26).
2. After SHELL-4 is verified, the UI overhaul has landed its tokens, and **physics round 3** (the ground and carry floor, LOCK) is verified:
   PHYS-A (touch gate, `setSquash` / `hop` / lean, support on props F1 with F17, sleep with F5 and F6, `auto` F11, F12, bump memory past 16);
   then PHYS-B (PropWorld static + hinge1 + one ball, with F2, F3, F4). One physics owner, serially.
3. RENDER (render-side idle motion F16, emotes, gaze, expressions, sleep skip, lite chunk mesh, the place host and the cabin chunk), AUDIO
   (chatter, creature voices, ambience bed, the cabin recipe), SHELL (bus, party, LIFE host, attention wiring, travel, journal, tracker, F10).
4. S1 verification: node rows, then PF-01 to PF-03 with the 4x throttle (they set the unit budget), then browser rows; independent verifiers.
5. S2: water (F7) once, then the beach, the mountain and the garden. 6. S3: the rest, with fields as LIFE and looks (F8).

---

## 8. Budgets I would sign

- **Frame (med phone, 16.7 ms):** physics <= 6.0 ms (C), LIFE + attention + quest host <= 0.4 ms, render CPU <= 4.5 ms, audio main thread
  <= 0.5 ms, UI <= 1.0 ms, slack >= 3.5 ms. Quiet-container proxy for physics: <= 2.0 ms for the med S1 scenario (C 10.2: 1 touched + 1
  mover + 2 asleep + props), measured in node; the phone factor stays unknown until PF-01.
- **Per place:** <= 60 draw calls for set and props (C RD-08), <= 8 moving props, <= 12 collider parts, weather particle caps per tier x0.3 in Calm.
- **Size:** F15. **Save:** journal <= 16 000 chars (all three agree), worst case measured by a probe row.
- **Allocation:** 0 B per 120 frames in physics with props, zones and drivers (C PH-11), in LIFE (0 B over 6000 ticks), the bus and the
  reducer; render stays under today's 8.9 KB a frame.

## 9. Plainly not checked by me
Real phone timings; the look of detail-2 wholes, the lite mesh and render-side sway; whether a scoot clears a 0.12 m lip (C PH-03 decides);
`foldLimit` cost with props; env bake time per place; per-chunk sizes; any audio by ear; the name and language gates on any proposed name;
the cut neck swell (PHYS round 3) interacting with prop contact; `makeRow`'s acceptance of a deterministic gift id (F14 says to check it).
