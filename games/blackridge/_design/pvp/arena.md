# BLACKRIDGE — PVP ARENA: **LANTERNWALK**

*Carved from Meridian Ward. One map, three modes, ten actors, zero networking.*

Status: **BUILD SPEC**, written 2026-08-20 against the v1 build on disk.
Authority order: `pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md` > the v1
design docs > `_design/expansion/pvp_design.md` > **this document**. Where this document
contradicts `pvp_design.md`, the contradiction is listed explicitly in Part 7 with the
reason — never silently.

Owner's directive (verbatim): *"the campaign is not much of a campaign, i fight two bad
guys and then i wandered for 2 minutes and foud nothing. Turn it into a PVP map instead.
the same map can be multiple modes - 1. 5v5 , 2. Capture the Flag, 3. FFA. Each game will
have a maximum of 10 players. At this point thats me, the tester, and 9 ai (npcs). They
need to know the full rules of each game, and fight to win/survive. We will start with the
same MAP for all 3 modes. Campaign is now PVP and this game has no campaign mode atm.
30fps is fine."*

**Scope of this document:** the arena — the carve, the boundary, the loop, the spawn point
set, the per-mode layout, the measured sightline/pacing audit, and the exact split between
geometry changes and data changes. Match rules, bot mode-reasoning, and the match driver
are sibling deliverables; this document specifies only what they consume from the map.

---

## PART 0 — THE CONSEQUENCE THAT REWRITES `pvp_design.md`

**One human plus nine bots means everything runs locally, in one browser, in one
`sim.step`. There is no networking.**

`pvp_design.md` §1.2 excluded two things from v1 and gave netcode reasons for both:

> *"**Free-for-all** — the spawn director's core signal is team influence (Part 2.4); FFA
> spawning is a genuinely different algorithm and would ship worse."*
> *"**Objective modes with carried flags** — carrier state is the hardest thing to
> replicate under client authority (E4); a desynced flag is an unloseable match."*

**Both objections are void, and this document relies on that.** There is no replication,
so there is no carrier desync — the flag is a field on the local sim state, read by the
same code that reads bot health. There is no client authority problem, so there is no
adjudication asymmetry between the human and the bots. FFA's spawn algorithm is not a
netcode problem at all; it is a scoring-weight problem (Part 2.5), and it is cheap.

Everything else that `pvp_design.md` justified with **E3** (Supabase message billing),
**E4** (client authority), Part 6 (fairness/anti-cheat) and Part 1.0.1 (the relay budget)
is **out of scope for this build**. Nothing in this arena spec depends on any of it.

What survives from `pvp_design.md` unchanged and is reused wholesale:
- **PART 2** — the spawn director: authored `spawnPoints[]`, hard vetoes V1–V6, the score
  function, the influence map, the flip rule, the trap override, spawn protection. Reused
  with two numeric overrides (Part 2.6) and one veto retired (V7, Foothold-only).
- **PART 3.0** — the eight-edit carve doctrine. Every edit below is written as a delta
  against it and cites the rule number.
- **PART 4** — the balance deltas (110 HP, `steadyMult` 1.0, jitter cuts, Corvus ADS/settle/
  flinch/glint, tac-sprint 2.5 s, hitstop banned, 1 grenade, friendly fire off).
- **PART 7.2–7.3** — bot difficulty band (Regular default, no Veteran, no adaptive
  difficulty, 110 HP across teams) and the team generalisation change list.

What is **cut** because the owner cut it: the campaign, Foothold, Blackline, the six-map
portfolio, and every net lane (N1). Foothold's five zones are recorded in Part 6.4 as a
zero-cost future hook, because the geometry supports them and deleting the note costs
nothing to keep.

---

## PART 0.1 — EVIDENCE LEDGER

Every number in this document that is not an authored design choice was **measured this
session** by `_design/pvp/arena_probe.mjs`, which imports the real
`core/level/colliders.js`, applies the carve edit list in Part 1, and raycasts it. The
probe is shipped alongside this document and is the acceptance gate (Part 6).

| # | Fact | Source |
|---|---|---|
| **A1** | The map is one hardcoded function. `core/level/layout.js` (777 lines) exports `buildLayout(seed)`; `seed` is documented *reserved* — "wave-1 placement uses no RNG so layout, colliders and nav are bit-identical for every seed". `colliders.js` (80 lines) is a pure transform of it. Editing the arena = editing this one file (or a sibling map module). | read |
| **A2** | The frozen collider contract is `{boxes, groundY, spawns, cover, nodes, bounds}` plus private `{walkRects, refSpawns, zones}`. `nodes` is the **R24 frozen 15-key set**, contract-gated at load (`core/sim/mission.js:40-44` — `checkNode` pushes `unknown node '<n>'`). | read |
| **A3** | `core/ai/nav.js` bakes its grid from `colliders.bounds` at `cell = max(opt, W/160, H/160)`, `STEP 0.36`, `CLEAR_H 1.7`, `FOOT_R 0.2`, and flood-fills from the player spawn + R24 nodes + refSpawns. Per-cell light comes from `ZONE_BASE` keyed on the POI zone names, `DEFAULT_AMBIENT 0.35` otherwise. **A new POI zone with no `ZONE_BASE` entry silently becomes a bright room to the AI.** | read |
| **A4** | Speeds (`combat_spec §1.1`): walk 4.6, sprint 6.4, tac-sprint 7.3 m/s. Every travel-time figure below is at **6.4 m/s** unless stated. | read |
| **A5** | Yaw convention: `layout.js` `REF_SPAWNS.player.yaw = -π/2` documented "faces east along the quay", so **forward = (−sin yaw, −cos yaw)**; yaw 0 = −Z = north. Every yaw in Part 2 uses this. | read |
| **A6** | `core/level/props.js buildKind()` has a `default:` arm returning a plain metal box. **A new prop `kind` that has no `case` renders as a grey box** — new diegetic barriers need either an existing kind or a new case. | read |
| **A7** | `core/level/level.js:1089-1132` renders `layout.walls` generically by `kind` (`rail`/`gate`/`roof`/`slab`/`deck`/`step` special-cased, everything else concrete wall). A new `kind:"wall"` box gets a concrete wall for free — which is why every boundary in Part 1 is a wall box **plus** prop dressing, never a bare wall. | read |
| **A8** | Measured arena: gross 73.0 × 49.1 m, **2593 m² connected walkable ground**, median sightline 6.3 m, band mix 47.4% < 6 m, **0.0% ≥ 55 m**, nearest-of-nine-actors median **9.8 m (1.5 s)**, P(≥1 actor in direct LOS) **75.3%**. | probe |

---

## PART 1 — THE CARVE

### 1.0 Bounds

```
ARENA BOUNDS:  X ∈ [−48.5, +24.5]   Z ∈ [−34.5, +14.6]
               73.0 m (E–W)  ×  49.1 m (N–S)   =  3584 m² gross
```

Convention is unchanged from `level_design §2.1`: origin at map centre, **+X = east,
+Z = south, Y up**, metres. The full campaign map is X,Z ∈ [−60, +60]; the arena is the
**west-central quarter** of it.

**Source zones consumed** (verbatim ids from `layout.js` `ROADS` / `WALK_RECTS`):

| Source id | Extent | Arena role | Kept |
|---|---|---|---|
| `r_plaza` / `w_plaza` | X[−25,15] Z[−18,18] | **the hub** — Meridian Market plaza | Z clipped to +14 |
| `r_arcade` / `w_arc_ground` + `w_arc_upper` | X[−39,−26] Z[−19,5], two floors (upper y +4.2) | **the power position** — Pale Lantern Arcade | whole |
| `r_gallery` / `w_gallery` | X[17,23] Z[−33,13] | **the long lane** — Storm Gallery | whole |
| `r_alley` / `w_alley` | X[−58,−41] Z[−30,42] | **the west lane** — Tannery Alleys | X clipped to ≥ −48, Z clipped to ≤ +14 (`bld_w2` already caps it) |
| `r_cs1` / `w_cs1a` + `w_cs1b` | X[−41,−12.5] Z[−28,−18] | **the north artery, west half** — cross-street | whole |
| `r_street` / `w_street` | X[−12.5,0] Z[−41,−18] | **the north artery, centre** — market street | Z clipped to ≥ −30 |
| `r_cut` / `w_cut` | X[13,28] Z[−22,−18] | **the NE cut** — plaza ⇄ gallery crossing | X clipped to ≤ 23 |
| `w_gal_wdoor` | X[15,17] Z[8,12] | plaza ⇄ gallery south door | whole |
| `w_arc_wdoor` / `w_arc_edoor1` / `w_arc_edoor2` | see `layout.js` | arcade doors | whole |
| `r_ramp` / `w_ramp` | X[−14,−6] Z[18,42] | — | **CUT** (dead-end stub) |
| `r_quay`, `r_blvd`, `r_cye`, `r_customs`, `w_deck` | — | — | **CUT** (outside arena) |
| `w_gal_edoor` | X[23,28] Z[−32,−28] | — | **SEALED** (led only to the boulevard) |

**Deliberately excluded, and why:** the Tramline Boulevard's 78 m lane, the quay, the
customs yard and the tram platform are all outside the arena. `pvp_design §3.3` excluded
them too, but for a reason that is now wrong — it said Lanternwalk must have "no 45 m+
lane" because *"including it would make one map own two bands and leave Spillway with
nothing to be"*. **There is no Spillway and no portfolio: this is the only map, so every
weapon needs a home on it.** The boulevard is still excluded — it is an 18 m-wide bare road
with 7 cover pieces, i.e. exactly the empty-wandering space the owner complained about —
but the long band is *not* omitted. It is provided by the **Storm Gallery**, which
`pvp_design §3.3` mislabelled as "CQB 8–18 m". Measured, the gallery's centre lane is clear
for **46 m** (the shelving and dumpsters are all wall-huggers: `gal_shelf_1` X[17.05,17.55],
`gal_shelf_2` X[22.45,22.95], `gal_dump_1` X[17.05,18.15], `gal_dump_2` X[21.85,22.95] — the
centre X ≈ 19–21 is uninterrupted). Corvus two-shots to 63.8 m at 110 HP (`pvp_design §4.1`),
so the gallery is a real DMR lane and the plaza's 37 m diagonals are a real AR lane.

### 1.1 What gets walled off — the boundary (carve rule 1: bound it diegetically)

Six new boundary elements. **No invisible walls.** Each is a `kind:"wall"` collider box
(rendered as concrete by `level.js` for free, A7) **plus** the named prop dressing so the
edge reads as an object, not as a limit.

| # | id | Collider box | Diegetic form |
|---|---|---|---|
| **B1** | `pvp_bnd_alley_w` | X[−48.5,−48] Y[0,7] Z[−30,+14] | **Container stack line** — 8 stacked 40 ft freight containers along the tannery's service margin, two of them staggered forward. *(New geometry: the alley's real west side is at X = −58; nothing exists at X = −48.)* |
| **B2** | `pvp_bnd_plaza_s` | X[−25,+15] Y[0,6] Z[+14,+14.6] | **Market perimeter hoarding** — plywood site hoarding with fly-posted invented signage, a burned-out delivery truck at X ≈ −5, jersey barriers and police tape. Lines up flush with `bld_s3`'s west face (X = 15, Z = 14) so the whole south edge is one straight run. |
| **B3** | `pvp_bnd_street_n` | X[−12.5,0] Y[0,6] Z[−30.6,−30] | **Customs barricade line** — Vektor Ancile checkpoint: HESCO barrier, chain-link, floodlight tripod (emissive only). |
| **B4** | `pvp_bnd_cut_e` | X[23,24.5] Y[0,5.5] Z[−22,−18] | **Collapsed tram gantry** — the NE cut's east mouth, wires down, sparking (emissive only, no `fx` pool light). Seals the cut at the gallery's east wall so there is no GE-strip stub. |
| **B5** | `pvp_bnd_galdoor_e` | X[23,24.5] Y[0,5.5] Z[−32,−28] | **Welded fire door** — readable as a door, not a blank wall. Seals the gallery's boulevard exit. |
| **B6** | — | *(none needed)* | The alley's **south** cap is `bld_w2` X[−48,−41] Z[14,22] and its **north** cap is `bld_nw` X[−58,−41] Z[−40,−30]; `cs1a`/`cs1b`'s north wall is `bld_nbw` + `bld_nw2` Z[−40,−28]; the gallery's north cap is `gal_cap_n` Z[−34,−33]. **All four already exist.** |

**Ramp deletion.** `w_ramp` / `r_ramp` (X[−14,−6] Z[18,42]) is removed from the walk set —
B2 crosses its mouth at Z = +14. This is the single biggest anti-dead-end edit in the
carve: the ramp was a 24 m one-way corridor to the quay with no return route.

### 1.2 THE LOOP PATCH (carve rule 2: no dead ends)

The campaign map's north half is **directional**: market street runs from the plaza to the
customs yard and stops; the alley runs to the arcade door and stops; the cut runs to the
boulevard and stops. Cut the outer map away and you get three stubs — which is the
mechanical description of the owner's complaint. Four edits close the circuit.

#### L1 — **The North Service Corridor** (the load-bearing edit)

Excavate through `bld_nea` (X[0,13] Z[−40,−18], h 9):

```
void  X[0, 13]  Y[0, 3.4]  Z[−25, −20]      13 × 5 m enclosed corridor
```

- **West end** opens directly onto the market-street pocket's east edge (X = 0).
- **East end** opens into the NE cut at X = 13, Z[−22,−20] (`w_cut` is X[13,28] Z[−22,−18]).
- **Two south doors** through the 2 m wall left at Z[−20,−18]:
  `X[2,5]` and `X[9,12]`, Y[0,2.4] — both onto the plaza's north edge.
- **Two structural piers** (kept material, not cut): `X[5,6.5] Z[−25,−22]` and
  `X[8,9.5] Z[−23,−20]`. Their Z ranges **overlap**, so no straight line of any azimuth
  runs the corridor's length, while each leaves a 2.0 m walkable gap on alternating sides —
  the corridor is an S, not a tube.

`pvp_design §3.3 E6` proposed exactly this corridor at Z[−24,−20] and called it *"the one
that makes it a map"*. **That is confirmed correct and it was nearly broken here**: an
earlier revision of this spec moved it to Z[−22,−18] to align with the cut, which would
have put its south face on `bld_nea`'s outer face (Z = −18) and produced an open loggia
onto the plaza rather than a connector. E6's Z band is right; only the depth (4 → 5 m) and
the piers are new.

With L1, **market street stops being a dead end** and the arena gains a continuous
east–west artery: alley → `cs1a` → `cs1b` → market street → corridor → cut → gallery,
**69 m end to end, entirely north of the plaza**. That is the rotation route a losing team
needs, and it is the thing that makes this a circuit instead of a hub-and-spokes.

#### L2 — **Mid-gallery door**

Split `gal_w_2` (X[15.5,17] Y[0,5.5] Z[−18,8]) with an opening at **Z[−6,−2]**, Y[0,2.4],
header above. The gallery previously had two entrances 30 m apart (the cut at Z ≈ −20 and
the plaza door at Z[8,12]) — a committed grinder. Three entrances at Z −20 / −4 / +10 make
it an artery you can enter and leave.

#### L3 — **Alley ⇄ arcade north door**

Split `arc_w_1` (X[−41,−39] Y[0,8.2] Z[−20,−4]) with an opening at **Z[−17,−13]**, Y[0,2.4].
The alley previously touched the arcade at exactly one point (the existing west door,
Z[−4,0]); with L3 it touches at two, so the alley is a connector rather than a 44 m
committed corridor.

#### L4 — **Alley scaffold stair** (carve rule 4: reverse the one-ways)

The arcade balcony (y +4.2) is the map's only verticality and had exactly two entrances,
both interior staircases. A third, from outside, comes from the alley:

- Replace prop `al_scaf_2` (a scaffold already dressed into the alley at (−41.35, −12))
  with a **scaffold stair tower**: `steps()` run at X[−42.6,−41], Z[−12.2,−9.1], 13 risers
  × 0.30 m on a 0.30 m landing — the identical cadence to `arc_stair_nw`/`arc_stair_se`
  (`layout.js:216-219`), so `moveCapsule`'s step-up budget and the nav floor-chain are
  already proven at these numbers.
- Split `arc_w_1` again with an upper door at X[−41,−39] **Y[4.2,6.4] Z[−12,−9.3]**, landing
  on `arc_slab_wa` (X[−39,−37.6] Y[3.95,4.2] Z[−15.1,5]) — solid at that Z.

> **`pvp_design §3.3 E7` is not buildable as written and is replaced by L4.** E7 proposed
> *"reverse mantle — kiosk roof (−22, 2.6, −6) → arcade balcony east window (−25, 4.2, −6)"*.
> There is no window at y 4.2: `arc_e_b2` is solid from y 0 to **5.3**, and the window band
> `arc_e_m1..m4` runs **y[5.3,7.3]** (`layout.js:173-181`). A 2.6 m kiosk roof to a 5.3 m
> sill is a 2.7 m rise against `combat_spec §1.5`'s 1.35 m mantle ledge cap — twice the
> budget. The window band is a **firing** band from the balcony (floor 4.2, sill 5.3 = chest
> height), not an entrance, and it stays that way.

### 1.3 Anti-tube edits (carve rule 2 + rule 6, found by probe, not by eye)

The probe's long-lane finder caught a **72.0 m clear line** across the whole arena that did
not exist before this carve and was created by L2 + L3: a ray from the alley at
(−47.3, −16.3) threads the new alley→arcade door (Z −17..−13), crosses the arcade, exits
the **existing** arcade east door 1 (Z −13.5..−10.5), crosses the plaza, and enters the
**new** mid-gallery door (Z −6..−2), ending at (23.0, −0.7). Three doorways and an open
plaza in a straight line.

The fix is four interior partitions in the arcade — diegetically shop-unit walls in a
covered market arcade, which the space wants anyway (it is currently a 13 × 24 m open box
with all its cover hugging the walls):

| id | Box | Purpose |
|---|---|---|
| `arc_part_1` | X[−33.5,−32.5] Y[0,3.6] Z[−19,−12] | breaks alley-north-door ⇄ east-door-1 |
| `arc_part_2` | X[−31.5,−30.5] Y[0,3.6] Z[−1.5,+5] | breaks west-door ⇄ east-door-2 |
| `arc_part_3` | X[−36.5,−35.5] Y[0,3.6] Z[−9,−4] | breaks the west-wall ⇄ lightwell diagonal |
| `arc_part_4` | X[−30,−29] Y[0,3.6] Z[−16.5,−13.6] | screens east door 1 from the north |

Props `arc_stall_2` (−33, −18.1) and `arc_stall_5` (−33, 4.1) are deleted — the partitions
occupy their footprints.

**Measured effect:** longest arena ray 72.0 → **67.3 m**; rays ≥ 55 m fell from 0.1% of all
rays to **0.0%**; the arcade's median sightline fell 6.3 → 4.3 m.

### 1.4 Re-covering the connectors (carve rule 6)

`level_design §2.6` deliberately makes connectors sparse — *"risk in transit"*. That is a
single-player rule. Measured before re-covering, the **north artery was a 68.8 m dead
straight line at Z ≈ −21** from the cut to the alley's west wall, and the **alley was a 44 m
straight** with 3 cover pieces (its two dog-leg blockers, `bld_w2` and `bld_w3`, are both
outside the arena's X range once bounded at −48 — `pvp_design §3.3`'s "West lane: CQB
5–14 m" is wrong for the bounded alley).

**North artery — 5 staggered blockers, alternating sides:**

| id | Box | Space | Kind |
|---|---|---|---|
| `n_skip` | X[−33,−29] Y[0,2.6] Z[−28,−25.5] | `cs1a` | builder's skip + spoil |
| `n_van` | X[−39.4,−34.6] Y[0,2.4] Z[−24.6,−20] | `cs1a` | box van, `kind:"van"` |
| `n_boxvan` | X[−20,−16] Y[0,2.5] Z[−22.5,−18.5] | `cs1b` | box van |
| `n_kiosk` | X[−8,−4] Y[0,2.4] Z[−26,−23.5] | market street | shuttered kiosk, `kind:"kiosk"` |
| `n_barrier` | X[−24,−22] Y[0,1.1] Z[−26,−25.4] | `cs1b` | jersey, `kind:"barrier"` (low) |

**Alley — 2 half-width sightline breakers + 3 cover:**

| id | Box | Kind |
|---|---|---|
| `a_container_1` | X[−48,−44.5] Y[0,2.6] Z[−7,−4] | container, west side |
| `a_container_2` | X[−44,−41] Y[0,2.6] Z[+3,+6] | container, east side |
| `a_dump_1` | X[−46.9,−45.1] Y[0,1.25] Z[−22.6,−21.4] | `dumpster` |
| `a_dump_2` | X[−43.9,−42.1] Y[0,1.25] Z[−0.6,+0.6] | `dumpster` |
| `a_pallets` | X[−47.1,−45.9] Y[0,1.1] Z[−12.5,−11.5] | `pallet` |

Plus: `al_dump_6` moves from (−48, −16) to **(−46, −16)** (its AABB straddled B1);
`al_scaf_1`, `al_dump_1..4`, `al_van` are outside the arena and are dropped.

**Measured effect:** alley median sightline 6.0 → **5.0 m**, longest *straight* run 44 →
**22.5 m** (from `alley_mid`); `cs1a` median 7.0 → **4.0 m**; `cs1b` 13.3 → **7.3 m**.

**Plaza — 6 additions, 11 → 17 cover pieces** (measured spacing 103 → **65 m² per piece**):

| id | Box | Kind |
|---|---|---|
| `pk_kiosk_6` | X[−19.3,−16.7] Y[0,2.3] Z[−9.3,−6.7] | `kiosk` |
| `pk_kiosk_7` | X[4.7,7.3] Y[0,2.3] Z[4.7,7.3] | `kiosk` |
| `pk_stall_1` | X[−13.1,−10.9] Y[0,2.4] Z[3.2,4.8] | `stall` |
| `pk_planter_4` | X[7,9] Y[0,0.9] Z[−10.4,−9.6] | `planter` (low) |
| `pk_container` | X[−5,1] Y[0,2.6] Z[−14.2,−11.8] | container — the plaza's north-edge breaker |
| `pk_van` | X[0.9,3.1] Y[0,2.4] Z[5.4,10.6] | `van` |

Deleted (south of B2): `pl_car_5`, `pl_plant_3`, `pl_newsbox_4`. Moved: `pl_car_6`
(−21.5, 14) → **(−21.5, 11)** (its AABB straddled B2).

**Gallery — 3 additions, deliberately low** so the 46 m lane survives:
`g_crate_1` X[18.6,20.4] Y[0,**1.2**] Z[−16.9,−15.1], `g_crate_2` X[20.6,22.4] Y[0,**1.2**]
Z[1.1,2.9], `g_shelf_4` X[22.45,22.95] Y[0,1.8] Z[−28.9,−27.1] (wall-hugger).
Chest-high crates give a crouching duellist cover without capping the standing lane — the
gallery is the one place in the arena where the long line is the point.

### 1.5 The two base rooms (CTF — see Part 3.2)

Two rooms excavated from existing building mass, authored as **exact 180° rotational
mirrors of each other**. This is how an asymmetric campaign map is made fair for CTF:
not by mirroring the map (impossible, and it would destroy the locale fiction, carve rule 3),
but by mirroring **the contested object and its immediate envelope**.

**WEST — "LANTERN YARD"**, excavated from `bld_m1` (X[−41,−25] Z[6,18], h 8, 2 floors):

```
room   X[−39, −28]  Y[0, 3.4]  Z[+8, +16]        11 × 8 m = 88 m²
D1 →  plaza        X[−28,−25] Y[0,2.4] Z[+11,+15]     4.0 m
D2 →  arcade       X[−34,−30] Y[0,2.4] Z[+5, +8]      4.0 m   (also splits arc_n)
D3 →  alley        X[−41,−39] Y[0,2.4] Z[+9, +13]     4.0 m
```

**EAST — "THE EXCHANGE HOUSE"**, excavated from `bld_nea` (X[0,13] Z[−40,−18], h 9), north
of corridor L1:

```
room   X[+1, +12]  Y[0, 3.4]  Z[−34, −26]        11 × 8 m = 88 m²
D1 →  corridor     X[+3,+7]   Y[0,2.4] Z[−26,−25]     4.0 m
D2 →  market st.   X[0,+1]    Y[0,2.4] Z[−33,−29]     4.0 m
D3 →  gallery N    X[+12,+17] Y[0,2.6] Z[−31,−27]     4.0 m   (tunnel: splits bld_nea,
                                                                bld_neb, gal_w_1)
```

D3 is the edit that redeems the gallery's north spur (Z[−33,−22]): with `w_gal_edoor`
sealed by B5, that 11 m of gallery would have been a dead end. Connected to the Exchange
House it becomes the east base's back approach and the gallery keeps its full 46 m.

Interior cover, mirrored piece for piece (offsets given from each room's centre — LY centre
(−33.5, +12), ExH centre (+6.5, −30)):

| offset from centre | size | height | LY id | ExH id |
|---|---|---|---|---|
| (+3.0, +2.5) / (−3.0, −2.5) | 1.4 × 1.2 | 1.25 (low) | `ly_c1` | `ex_c1` |
| (−3.0, +2.5) / (+3.0, −2.5) | 1.4 × 1.2 | 1.25 (low) | `ly_c2` | `ex_c2` |
| (−2.75, −2.5) / (+2.75, +2.5) | 1.5 × 3.0 | **3.4 (full)** | `ly_c3` | `ex_c3` |
| (+3.7, −2.6) / (−3.7, +2.6) | 1.2 × 2.2 | 2.2 (high) | `ly_c4` | `ex_c4` |

The **full-height stack** is not decoration: without it, each room is a straight tube from
its X-normal door to its opposite X-normal door, and the probe found a **63.3 m line** at
Z = 12.8 running plaza → LY D1 → LY room → LY D3 → alley. The stack kills it in both rooms
identically.

### 1.6 Complete edit list (what the build agent executes)

| # | Edit | Type | Detail |
|---|---|---|---|
| E1 | Arena bounds | data | `bounds = {min:[−48.5,−2,−34.5], max:[24.5,14,14.6]}` |
| E2 | 5 boundary walls | **geometry** | B1–B5, §1.1 |
| E3 | Delete `w_ramp`/`r_ramp` | data | walkRect + road removal |
| E4 | North service corridor + 2 south doors + 2 piers | **geometry** | L1, §1.2 |
| E5 | Mid-gallery door | **geometry** | L2 — split `gal_w_2` |
| E6 | Alley ⇄ arcade north door | **geometry** | L3 — split `arc_w_1` |
| E7 | Alley scaffold stair + upper door | **geometry** | L4 — `steps()` + split `arc_w_1` |
| E8 | 4 arcade partitions | **geometry** | §1.3 |
| E9 | Lantern Yard room + 3 doors | **geometry** | split `bld_m1`, `arc_n` |
| E10 | Exchange House room + 3 doors | **geometry** | split `bld_nea`, `bld_neb`, `gal_w_1` |
| E11 | 5 artery blockers | props | §1.4 |
| E12 | 5 alley cover pieces | props | §1.4 |
| E13 | 6 plaza cover pieces | props | §1.4 |
| E14 | 3 gallery cover pieces | props | §1.4 |
| E15 | 8 base cover pieces (mirrored) | props | §1.5 |
| E16 | Prop deletions: `pl_car_5`, `pl_plant_3`, `pl_newsbox_4`, `al_scaf_1/2`, `al_dump_1..4`, `al_van`, `q_van`, `arc_table`, `arc_stall_2`, `arc_stall_5`, all `w_quay`/`w_customs`/`w_blvd`/`w_deck` props | props | §1.1–1.5 |
| E17 | Prop moves: `pl_car_6` → (−21.5, 11); `al_dump_6` → (−46, −16) | props | §1.4 |
| E18 | **Strip the script** (carve rule 5) | data | delete all 44 `refSpawns` wave entries, all mission beats/waves/objectives/checkpoints/pickups/triggers, the `transformer` blackout flag on `pl_transformer`, the `handoff` flag, the `explodable` flag on `cu_drums` (out of arena anyway) |
| E19 | **PVP lighting profile** | data + render | `pvp_design §3.1` verbatim: no playable zone below 18% relative brightness, fog 0.010 → **0.007**, `fake_platform_strip` flicker **off** (out of arena anyway), no dynamic light events, faction rim tint. Plus: 2 new fake sodium heads in the alley (≈ (−45, 5.5, −20) and (−45, 5.5, +2)) and 1 in the corridor, and `L_ARCADE_SKY` retained — the arcade lightwell shaft is the arena's best readability landmark. |

---

## PART 2 — SPAWN POINTS

### 2.1 Schema

Per `pvp_design §2.1`, in `content.json` → `arena.spawnPoints[]`:

```jsonc
{ "id": "sp_g4",
  "pos": [19.5, 0, -6.0],      // metres, ground y
  "yaw": 1.96,                  // forward = (−sin yaw, −cos yaw); faces INTO the arena
  "cluster": "SC_GALLERY",
  "cover": 0.6,                 // authored 0..1: solid cover within 4 m
  "modes": ["tdm", "ctf", "ffa"],
  "zoneHint": "gallery" }
```

### 2.2 The set — 50 points, 7 clusters

**Every point below was validated by the probe against the carved collider set**: walkable,
≥ 1.5 m clearance to the nearest collider face at 1.0 m height, ≥ 8 m unobstructed forward
view along its yaw, and ≥ 3.0 m from every other spawn point.

| Cluster | Pts | bbox | Role | Inward normal |
|---|---|---|---|---|
| `SC_WEST` | 8 | 119 m² | Tannery alley — ALPHA flip target | +X (east) |
| `SC_ARCADE` | 7 | 190 m² | Arcade interior, both floors — ALPHA home | +X |
| `SC_LANTERN` | 7 | 303 m² | Lantern Yard + plaza SW — ALPHA home / CTF base | +X, −Z |
| `SC_NORTH` | 7 | 176 m² | Cross-street `cs1a`/`cs1b` — neutral flip target | +Z (south) |
| `SC_MARKET` | 7 | 253 m² | Market street + corridor + Exchange House — BRAVO home / CTF base | +Z |
| `SC_GALLERY` | 8 | 514 m² | Gallery lane + cut + plaza NE — BRAVO home | −X (west) |
| `SC_PLAZA` | 6 | 825 m² | Plaza ring — **FFA ONLY** | inward |

```jsonc
// ---- SC_WEST  (tdm, ctf, ffa)     cover 0.5–0.8
{ "id":"sp_w1", "pos":[-44.5,0,-28.0], "yaw":-3.14, "cover":0.5 },  // clear 2.0 m, view 21 m
{ "id":"sp_w2", "pos":[-46.5,0,-24.0], "yaw":-3.14, "cover":0.8 },  // clear 1.5 m, view 17 m
{ "id":"sp_w3", "pos":[-43.5,0,-19.0], "yaw":-2.36, "cover":0.5 },  // clear 2.5 m, view 25 m
{ "id":"sp_w4", "pos":[-46.0,0,-14.0], "yaw": 0.00, "cover":0.8 },  // clear 1.5 m, view 16 m
{ "id":"sp_w5", "pos":[-44.0,0,-10.0], "yaw": 0.00, "cover":0.8 },  // clear 1.5 m, view 20 m
{ "id":"sp_w6", "pos":[-43.0,0, -6.0], "yaw": 0.00, "cover":0.8 },  // clear 1.5 m, view 24 m
{ "id":"sp_w7", "pos":[-43.5,0, -3.0], "yaw": 0.00, "cover":0.8 },  // clear 1.5 m, view 27 m
{ "id":"sp_w8", "pos":[-45.5,0,  6.0], "yaw":-2.36, "cover":0.8 },  // clear 1.5 m, view 12 m

// ---- SC_ARCADE  (tdm, ctf, ffa)   cover 0.6–0.9 ; sp_a1/sp_a4 are the balcony-adjacent pair
{ "id":"sp_a1", "pos":[-36.0,0,-16.0], "yaw":-2.75, "cover":0.8 },  // clear 1.5 m, view 23 m
{ "id":"sp_a2", "pos":[-27.5,0,-16.5], "yaw":-3.14, "cover":0.8 },  // clear 1.5 m, view 22 m
{ "id":"sp_a3", "pos":[-28.0,0, -8.0], "yaw":-3.14, "cover":0.7 },  // clear 2.0 m, view 13 m
{ "id":"sp_a4", "pos":[-37.5,0, -2.0], "yaw":-0.79, "cover":0.6 },  // clear 2.5 m, view 17 m
{ "id":"sp_a5", "pos":[-33.5,0,  2.5], "yaw": 0.00, "cover":0.7 },  // clear 2.0 m, view 15 m
{ "id":"sp_a6", "pos":[-29.0,0,  1.5], "yaw": 0.00, "cover":0.8 },  // clear 1.5 m, view 15 m
{ "id":"sp_a7", "pos":[-32.0,0, -8.5], "yaw":-1.18, "cover":0.2 },  // lightwell, open — view 40 m

// ---- SC_LANTERN  (tdm, ctf, ffa)  cover 0.4–0.8
{ "id":"sp_l1", "pos":[-32.0,0, 12.5], "yaw":-1.57, "cover":0.8 },  // LY room, clear 1.5 m
{ "id":"sp_l2", "pos":[-39.5,0, 11.5], "yaw": 0.79, "cover":0.8 },  // LY room, clear 1.5 m
{ "id":"sp_l3", "pos":[-33.0,0,  9.5], "yaw": 0.00, "cover":0.7 },  // LY room, clear 2.0 m
{ "id":"sp_l4", "pos":[-26.0,0, 13.0], "yaw":-1.18, "cover":0.6 },  // LY D1 mouth
{ "id":"sp_l5", "pos":[-17.5,0,  7.0], "yaw":-1.96, "cover":0.6 },  // plaza SW
{ "id":"sp_l6", "pos":[-23.0,0,  2.0], "yaw":-1.57, "cover":0.4 },  // plaza W
{ "id":"sp_l7", "pos":[-12.0,0, 11.5], "yaw":-1.57, "cover":0.5 },  // plaza S

// ---- SC_NORTH  (tdm, ctf, ffa)    cover 0.5–0.8
{ "id":"sp_n1", "pos":[-38.0,0,-26.5], "yaw":-1.96, "cover":0.8 },
{ "id":"sp_n2", "pos":[-31.5,0,-22.5], "yaw":-1.18, "cover":0.6 },
{ "id":"sp_n3", "pos":[-27.0,0,-26.0], "yaw":-2.75, "cover":0.7 },
{ "id":"sp_n4", "pos":[-22.5,0,-22.0], "yaw":-1.18, "cover":0.6 },
{ "id":"sp_n5", "pos":[-17.0,0,-25.5], "yaw":-1.96, "cover":0.6 },
{ "id":"sp_n6", "pos":[-14.5,0,-21.0], "yaw":-3.14, "cover":0.8 },
{ "id":"sp_n7", "pos":[-23.5,0,-19.0], "yaw":-1.96, "cover":0.5 },

// ---- SC_MARKET  (tdm, ctf, ffa)   cover 0.5–0.9
{ "id":"sp_m1", "pos":[-12.0,0,-25.5], "yaw":-2.75, "cover":0.6 },  // clear 1.8 m
{ "id":"sp_m2", "pos":[ -4.0,0,-28.5], "yaw": 1.96, "cover":0.8 },
{ "id":"sp_m3", "pos":[ -9.5,0,-21.0], "yaw": 2.75, "cover":0.3 },  // street mouth, open
{ "id":"sp_m4", "pos":[ -0.5,0,-21.5], "yaw": 1.96, "cover":0.6 },
{ "id":"sp_m6", "pos":[ 11.0,0,-22.5], "yaw":-3.14, "cover":0.8 },  // corridor east mouth
{ "id":"sp_m7", "pos":[  6.5,0,-32.0], "yaw": 1.57, "cover":0.8 },  // ExH room
{ "id":"sp_m8", "pos":[  4.0,0,-27.5], "yaw":-3.14, "cover":0.8 },  // ExH room

// ---- SC_GALLERY  (tdm, ctf, ffa)  cover 0.4–0.8
{ "id":"sp_g1", "pos":[ 20.0,0,-29.0], "yaw":-3.14, "cover":0.6 },  // gallery N spur
{ "id":"sp_g2", "pos":[ 19.0,0,-20.0], "yaw":-3.14, "cover":0.4 },  // cut crossing
{ "id":"sp_g3", "pos":[ 21.0,0,-13.0], "yaw":-3.14, "cover":0.8 },
{ "id":"sp_g4", "pos":[ 19.5,0, -6.0], "yaw": 1.96, "cover":0.5 },  // mid-door
{ "id":"sp_g5", "pos":[ 20.5,0,  4.5], "yaw": 0.00, "cover":0.7 },
{ "id":"sp_g6", "pos":[ 19.5,0, 10.5], "yaw": 0.00, "cover":0.6 },  // plaza door
{ "id":"sp_g7", "pos":[ 10.5,0,-17.5], "yaw": 1.57, "cover":0.6 },  // plaza NE / cut mouth
{ "id":"sp_g8", "pos":[  8.0,0, -6.0], "yaw": 1.18, "cover":0.2 },  // plaza NE, open

// ---- SC_PLAZA  (ffa ONLY)         cover 0.3–0.7
{ "id":"sp_p1", "pos":[-17.0,0,-14.0], "yaw":-2.75, "cover":0.6, "modes":["ffa"] },
{ "id":"sp_p2", "pos":[ -8.0,0, -3.0], "yaw": 0.79, "cover":0.5, "modes":["ffa"] },
{ "id":"sp_p3", "pos":[  7.0,0,-16.0], "yaw": 2.75, "cover":0.6, "modes":["ffa"] },
{ "id":"sp_p4", "pos":[ 12.5,0, -3.0], "yaw": 1.96, "cover":0.3, "modes":["ffa"] },
{ "id":"sp_p5", "pos":[ -2.0,0,  9.0], "yaw": 1.57, "cover":0.4, "modes":["ffa"] },
{ "id":"sp_p6", "pos":[-20.5,0,  6.5], "yaw": 0.00, "cover":0.5, "modes":["ffa"] },
```

**Yaw rule.** The yaws above are the probe's *maximum-forward-view* solution and every one
clears the 8 m gate. Before shipping, the build agent must additionally enforce
`pvp_design §2.1`'s intent — **yaw faces into the arena, never at a wall** — by clamping
each yaw to within **±60° of its cluster's inward normal** (table in §2.2) and re-taking the
best-view yaw inside that cone. Four points want checking specifically: `sp_l1`, `sp_l4`,
`sp_g4` and `sp_n7`, whose max-view yaws point down 39–53 m lanes.

**Optional balcony pair.** `SC_ARCADE` may add two upper-floor points at
`[-37.0, 4.2, -13.0]` and `[-28.5, 4.2, 1.0]`. They are **not** in the validated 50 because
the probe's walkability grid is ground-only; the build agent must validate them against the
baked nav's y = 4.2 floor before enabling. Recommendation: **enable them for FFA only** —
a team-mode spawn on the map's power position is a free hold.

### 2.3 Spawn point authoring contract (amended from `pvp_design §2.1`)

| Contract | `pvp_design §2.1` | **This arena** | Why amended |
|---|---|---|---|
| Point count | 30–50 | **40–50** (shipping 50) | — |
| Nav-walkable | required | required | — |
| Clearance to collider face | ≥ 2.0 m | **≥ 1.5 m** | The arena is deliberately dense: measured median sightline 6.3 m, 47.4% of all rays under 6 m. A 2.0 m bubble is unsatisfiable in a 6 m gallery or a 7 m alley — the probe failed 41 of 51 candidates on it. 1.5 m is still 4.3× the 0.35 m capsule radius. |
| Forward view | ≥ 8 m | ≥ 8 m | unchanged — all 50 pass |
| Points per cluster | ≥ 6 | ≥ 6 | unchanged |
| Cluster spread | ≥ 250 m² | **≥ 110 m² AND max pair separation ≥ 14 m** | Same reason. `SC_WEST` spans a 7 m-wide alley: 119 m² over 34 m of Z is a well-spread cluster and 250 m² is geometrically impossible there. The grenade-cluster failure the 250 m² rule guards against is a *pair-separation* problem, so the amendment measures that directly. |

### 2.4 Spawn director — reused, with two numeric overrides

`pvp_design §2.2–2.5` is adopted whole: hard vetoes V1–V6 and the relaxation ladder, the
score function and its two load-bearing shape properties, the 4 m influence grid at 5 Hz,
cluster ownership, the flip rule with 12 s hysteresis, the trap override with its
`SPAWN COMPROMISED — FALLING BACK` HUD line, and 1.5 s of spawn protection cancelled by
firing/ADS/grenade but **not** by movement.

Two **map-local veto overrides**, declared in map data and gate-checked — the same mechanism
`pvp_design §3.7` specified for BOXCUT:

| Veto | `pvp_design` | **LANTERNWALK** | Evidence |
|---|---|---|---|
| **V1** enemy-within radius | 22 m | **12 m** | Measured mean actor separation is 31 m and median 29 m. A 22 m veto disc is 1520 m² against 2593 m² of walkable ground; with 5 enemies alive it vetoes essentially the whole arena on every spawn, so the relaxation ladder would run on *every* spawn and `counters.spawnStress` would be pinned. At 12 m the disc is 452 m². |
| **V2** enemy LOS to the point | 60 m | **25 m** | Only 0.8% of measured rays exceed 40 m and none exceed 55 m; a 60 m LOS veto is effectively "any LOS at all", which duplicates V1 rather than adding a signal. 25 m brackets the arena's actual engagement band (79.4% of rays are under 15 m). |
| **V3** view cone | ±35°, ≤ 40 m | ±35°, **≤ 20 m** | same reason |
| **V7** Foothold zone veto | — | **retired** | No Foothold. |

Relaxation ladder is unchanged in order: V3 off → V6 off → V2 25 → 15 m → V1 12 → 8 m.
`spawnStress` gate unchanged (median ≤ 0.5 per match).

### 2.5 FFA is a different distribution, not a different map

This is the section `pvp_design §1.2` said could not be written under netcode. It can, and
it is three changes:

1. **`SC_PLAZA` unlocks.** In TDM and CTF the plaza is *between* the teams; a spawn there is
   a spawn inside the enemy formation, and `pvp_design`'s score function would never pick it
   anyway (its friendly-proximity term would be zero and its `facing` penalty maximal). In
   FFA there is no "between" — the plaza is simply the densest, most-covered ground in the
   arena, and locking a 10-player FFA out of its 1102 m² hub forces every spawn onto the
   perimeter and manufactures exactly the empty-rotation problem the owner complained about.
   FFA therefore uses **all 50 points across 7 clusters**; team modes use **44 across 6**.
2. **The friendly term is deleted, and its weight moves to safety.**
   `pvp_design §2.3`'s `+22 × (1 − min(1, dNearestFriendly/35))` is a *proximity* term — it
   exists so you do not spawn alone behind the enemy team. In FFA there is no such thing as
   alone-behind, and every other actor is an enemy. FFA scoring:
   ```
   score(p) =  55 * min(1, dNearestActor(p) / 30)     // was 40 * (d/55); saturates sooner
             + 18 * spread(p)                          // NEW, §2.5.3
             + 10 * p.cover
             - 20 * recency(p)
             - 15 * facing(p)
             + 6  * rng.spawn()
   ```
   The safety term saturates at **30 m, not 55 m**: in a 73 × 49 m arena, 55 m is nearly the
   diagonal, so a 55 m saturation makes the term binary and the director degenerates to
   "pick the farthest point" — the exact failure `pvp_design §2` was written to prevent.
3. **`influence(p)` is replaced by `spread(p)`.** The influence grid's deposits are signed by
   team; with ten mutually hostile actors the signs are meaningless and the grid sums to
   noise. FFA keeps the same 4 m grid at 5 Hz and the same ×0.85/s decay, but every actor
   deposits **+1.0 unsigned** and every death deposits **+2.0**; `spread(p) = 1 − normalised
   cell value`, i.e. *spawn where the map is currently empty*. This is 8 lines in
   `core/match/influence.js` and it reuses the entire existing grid, rebuild cadence and
   decay. Cluster flip and the trap override work unchanged against it — a cluster whose
   3 s rolling `spread` mean drops below **0.35** is a hot cluster, and the team-mode flip
   rule fires on it identically.

There is no fourth change. FFA does not need new geometry, new spawn points beyond the six
plaza ones, or a different arena.

---

## PART 3 — PER-MODE LAYOUT

### 3.1 MODE 1 — **5v5 Team Deathmatch**

**Team homes.** ALPHA = `SC_LANTERN` + `SC_ARCADE` (14 points). BRAVO = `SC_MARKET` +
`SC_GALLERY` (15 points). Flip targets: ALPHA → `SC_WEST`, BRAVO → `SC_NORTH`; either may
flip to the other's flip target under the trap override.

**Measured home parity** (probe, grid BFS at 0.5 m):

| | ALPHA home centroid | BRAVO home centroid |
|---|---|---|
| position | (−33, +1.5) | (+11, −17) |
| straight-line separation | **47.7 m** | |
| path to walkable centroid (−10.9, −8.6) | **24.3 m** | **23.5 m** — **3.3% apart**, inside `pvp_design §3.0` rule 3's ±8% |

**The three engagement lanes:**

| Lane | Geometry | Width | Measured band | Character |
|---|---|---|---|---|
| **CENTRE — the Plaza** | X[−25,15] Z[−18,14], 40 × 32 m, 17 cover pieces | open | **median 10.5 m, longest 37 m from centre, 55 m from the corners** | The hub. Warden's lane. Brightest zone (`ZONE_BASE.poi_plaza 0.35`). Ten mouths onto it: arcade E×2, LY D1, gallery W door, gallery mid door, cut, corridor S×2, `cs1b`, market street. |
| **NORTH — the Artery** | `cs1a` → `cs1b` → market street → corridor → cut, 69 m end to end | 4–12.5 m | **median 4.0–7.5 m**, no straight run over 22 m after the 5 blockers | The rotation route. Vesper/Pike lane. The only way across the map that does not cross the plaza, which is what makes losing a plaza fight survivable. |
| **EAST — the Gallery** | X[17,23] Z[−33,13], 46 m covered arcade | 6 m | **median 5.0 m, lane 46 m** | The long band. Corvus's only home (2-shot to 63.8 m at 110 HP). Darkest zone (`ZONE_BASE.poi_gallery 0.08`). Three entrances at Z −20 / −4 / +10. |
| **WEST — the Alley** | X[−48,−41] Z[−30,14], 44 m | 7 m | **median 5.0 m, longest straight 22.5 m** | ALPHA's flank and the scaffold-stair route to the balcony. |

**Choke points**, in order of how often a match will be decided at them:

1. **The gallery mid door** X[15.5,17] Z[−6,−2] — the only mid-lane crossing between the
   plaza and the gallery; whoever holds it splits the east side.
2. **The cut mouth** X[13,15] Z[−22,−18] — the artery's east end and the gallery's north
   entrance in one 4 m gap.
3. **The corridor piers** X ≈ 6.5 and X ≈ 8, 2.0 m gaps on alternating sides — a 1-wide
   S-bend on the artery's centre.
4. **Arcade east door 1** X[−26,−25] Z[−13.5,−10.5] — ALPHA's shortest plaza entry.
5. **LY D1** X[−28,−25] Z[11,15] — ALPHA's base mouth onto the plaza's SW.

**Power positions and their counterplay** (`pvp_design §3.0` rule 3 requires a named
counterplay route for each):

| # | Position | What it sees | Counterplay |
|---|---|---|---|
| 1 | **Arcade balcony**, y +4.2, firing through the window band y[5.3,7.3] at Z[−16,−13] / [−9,−6] / [−2,+1] | The plaza's west half. **Measured from a window at eye 5.8 m: longest 30.8 m, median 9.3 m.** | **Three** entrances — NW stair, SE stair, and the new alley scaffold stair (L4). Blind to the gallery, the cut, the whole north artery, the Lantern Yard, and its own three stairheads. One grenade (1 per life, `pvp_design §4.4 B13`) clears the balcony ring. |
| 2 | **Plaza kiosk island**, ground, X[−12,+6] Z[−12,0] | Nothing above it — this is cover density, not height: 17 pieces at a measured 65 m² spacing. Holding it means holding the hub's cover. | Overlooked by position 1, flanked by both corridor south doors and by `cs1b`. |
| 3 | **Corridor / cut junction**, X[9,15] Z[−22,−20] | Controls the artery's east end and the gallery's north entrance. | The corridor's own piers block its length; its two south doors put a defender's back to the plaza. |

**Scoring/rules** are the match driver's business, but the map's opinion: `pvp_design §1.1`
Skirmish's 75 kills / 10:00 was sized for 12 actors. At 10 actors on this arena — median
nearest-enemy 9.8 m, **1.5 s** to contact — **50 kills / 8:00** is the map-side
recommendation, with the same 4.0 s respawn (0 s on the first spawn of the match).

### 3.2 MODE 2 — **Capture the Flag**

**Flags.** `FLAG_WEST` at the Lantern Yard room centre **(−33.5, 0, +12.0)**.
`FLAG_EAST` at the Exchange House room centre **(+6.5, 0, −30.0)**.

**Team assignment.** WEST team spawns `SC_LANTERN` + `SC_ARCADE` + `SC_WEST` (22 points);
EAST team spawns `SC_MARKET` + `SC_GALLERY` + `SC_NORTH` (22 points).

**The arcade is deliberately neutral.** It is the map's only two-storey interior, its only
power position, and its best space — and there is nothing on the east side that matches it.
Rather than give one team the best room and then invent a compensation, the best room is
**mid**: both teams pass through or under it, and neither owns it. This is the standard
resolution for a map that was never authored symmetric, and it is why the flag rooms are
carved rather than chosen.

#### How two sides of an asymmetric map are made fair

Four measurable parities. Three are **guaranteed by construction** (the rooms are exact
180° rotational mirrors); two are **measured against the surrounding geometry**, which is
where an asymmetric map can still cheat you.

| # | Parity | Contract | **Measured** | Verdict |
|---|---|---|---|---|
| **P1** | **Approach count** | identical | **3 doors each**, all **4.0 m** wide, at mirrored offsets from each room's centre (§1.5). Each room's three doors lead to three *different kinds* of space: LY → plaza (hub) / arcade (mid) / alley (flank); ExH → corridor (artery) / market street (pocket) / gallery-north (lane). | **PASS by construction** |
| **P2** | **Cover parity inside the flag envelope** | ±15% | **4 pieces each**, mirrored piece for piece: 2 × low (1.25 m), 1 × high (2.2 m), 1 × full-height (3.4 m). **0% apart.** | **PASS by construction** |
| **P3** | **Travel parity — mid to flag** | ±8% | From the plaza centre (−5, −2): **42.0 m to FLAG_WEST, 40.0 m to FLAG_EAST — 4.9% apart.** | **PASS** |
| **P4** | **Travel parity — attacker to enemy flag** | ±8% | From each team's own-base spawn: **WEST → FLAG_EAST 80.0 m; EAST → FLAG_WEST 76.0 m — 5.1% apart.** | **PASS** |
| **P5** | **Longest sightline into the flag site** | ±10 m | **FLAG_WEST 31.0 m; FLAG_EAST 19.5 m — 11.5 m apart.** | **FAIL — residual R1, see Part 6.3** |

**Flag separation: 82.0 m of path, 12.8 s at 6.4 m/s sprint** — long enough that a capture
is a run, short enough that a 10-actor lobby produces contested runs rather than dead time.

**The four routes**, with measured path length:

| Route | Path | Length | Character |
|---|---|---|---|
| **R-DIRECT** | LY D1 → plaza → market-street mouth → ExH D2 | **~50 m** | The short one. It crosses the plaza — the arena's brightest, most-overlooked, most-covered space, watched by the arcade balcony and both corridor doors. The fastest route is deliberately the most exposed one. |
| **R-NORTH** | LY D3 → alley → `cs1a` → `cs1b` → market street → ExH D2 | **~78 m** | The artery. Five staggered blockers, median 4–7 m sightlines, never crosses the plaza. The carrier's route. |
| **R-ARCADE** | LY D2 → arcade → arcade E door → plaza → corridor S door → corridor → ExH D1 | **~70 m** | Interior. Contested at the arcade — the neutral power position sits on it. |
| **R-GALLERY** | LY D1 → plaza → gallery W door → gallery lane → cut → ExH D3 | **~87 m** | The long way, down the 46 m lane. The escort's route if the enemy holds mid, and the one a Corvus punishes. |

**Choke points for CTF specifically:** ExH D3's 5 m tunnel (X[12,17] Z[−31,−27]) is the
single tightest point on any route and is the natural defensive hold for EAST; its mirror
for WEST is LY D3 into the alley. The corridor piers are the artery's throat. The gallery
mid door is where R-GALLERY and R-DIRECT interlock.

**Rules the map assumes** (for the match driver): flags return on a timer rather than
instantly, because at 82 m of separation an instant return makes a dropped flag
unrecoverable; the capture requires your own flag at home, because a 5v5 with 9 bots will
otherwise trade caps continuously; and a carrier is visible to the enemy through geometry,
because a 10-actor arena with 2593 m² has no room for a hide-and-seek phase — the owner
already told us what that feels like.

### 3.3 MODE 3 — **Free-for-all**

Ten mutually hostile actors, no teams, no friendly fire concept (there are no friendlies).

**Why the spawn distribution differs** — three reasons, all consequences of geometry, not
of rules:

1. **There is no safe half.** In TDM and CTF, `SC_LANTERN` is safe *because* four other
   ALPHA actors are between it and the enemy. In FFA every one of the other nine can be
   anywhere, so a perimeter cluster is not safer than a central one — it is just further
   from the action, and it takes the spawning player **7.4 s** (the measured worst-case
   nearest-actor distance, 47.5 m) to rejoin. Locking FFA to the six perimeter clusters
   would maximise exactly the metric the owner complained about.
2. **The hub must be a spawn space.** The plaza is 1102 m² — 42% of the arena's walkable
   ground — and it carries 17 of the arena's cover pieces. `SC_PLAZA`'s six ring points
   (§2.2) put spawns inside it, spread across its perimeter, each with 1.5–3.0 m clearance
   and 23–46 m of forward view.
3. **The objective is minimum distance, not side.** Team modes want *clustered* spawns
   (`pvp_design §2.3`'s friendly-proximity term). FFA wants *maximally separated* ones, which
   is a different argmax over the same point set — hence the score-function swap in §2.5.

**FFA cluster weighting.** All seven clusters are live. The director should treat clusters
as equal-priority (no home cluster, no flip) and rely on `spread(p)` + `recency(p)` alone;
the cluster machinery still runs so that the **trap override** works — three of the last
five spawns dying within 6 s and 20 m still widens V1 to 20 m and V2 to 40 m for 20 s, and
that protection matters more in FFA than anywhere else, because in FFA every spawn point is
in someone's half.

**Map-side rules recommendation:** 25 kills or 8:00, 3.0 s respawn (shorter than TDM — in
FFA there is no team to lose ground while you are dead).

### 3.4 What the bots read off this map

Not this document's deliverable, but the arena is authored to make it cheap, so the hooks
are named here so the AI agent does not have to reverse-engineer them:

- **Cover nodes are already exported.** `colliders.cover` is `[{pos, dir, height}]` built
  from every prop with a `cover` spec (`colliders.js:57-60`), and `botfsm.js:486` already
  scores candidate cover nodes by angle-off-axis and range. Every new prop in Part 1.4/1.5
  ships a `cover` spec, so the bots inherit the whole arena's cover for free.
- **Mode intent rides the existing cover score.** `pvp_design §7.3.5` specifies the minimal
  change: a mode supplies `desiredPosition(bot)` that biases the existing cover-scoring
  function by `+2.5 × inObjectiveBand(node)`. For CTF, `inObjectiveBand` is
  "within 12 m of either flag or within 6 m of the carrier's path"; for TDM it is
  "within 10 m of the highest-influence plaza cell"; for FFA it is 0. **No new FSM state**,
  so the audited fairness surface (`combat_spec §5.5`, §5.6's roll-once-and-latch) is
  untouched.
- **Lane semantics are readable from `walkRects`.** The artery, the gallery, the alley and
  the plaza are distinct rects; a bot choosing "rotate without crossing the plaza" is a
  nav query restricted to the artery rects, not a new pathfinder.
- **`ZONE_BASE` must be extended or bots will fight in the dark as if it were lit** — see
  Part 5.3.

---

## PART 4 — SIGHTLINE AND PACING AUDIT

All figures measured by `_design/pvp/arena_probe.mjs` against the carved collider set at
**eye height 1.60 m**, 72 rays per point, 940 sampled walkable points (67,680 rays).

### 4.1 Size

| | Value |
|---|---|
| Gross bounds | 73.0 × 49.1 m = **3584 m²** |
| Connected walkable **ground** | **2593 m²** |
| Arcade upper floor (balcony ring, y +4.2) | ≈ 250 m² |
| **Total playable surface** | **≈ 2843 m²** |
| **Per actor (10)** | **≈ 284 m²** |

For reference: `pvp_design §3.3` sized LANTERNWALK at 74 × 56 m = 4144 m² gross for
**12 actors**. This carve is **13.5% smaller in gross footprint** for **17% fewer actors**,
so per-actor density is held roughly constant while the specific low-value spaces are the
ones removed. **The carve was shrunk, and here is exactly by how much and where:**

| Cut | Area removed | Why |
|---|---|---|
| Ramp stub `w_ramp` X[−14,−6] Z[18,42] | −192 m² | 24 m one-way dead end |
| Plaza south strip Z[+14,+18] | −160 m² | produced two dead corners with no flanking route |
| Market street north of Z = −30 | −137 m² | dead-end stub once the customs yard is out |
| Gallery east door + GE strip | −45 m² | led only to the excluded boulevard |
| Alley west of X = −48 (never included) | — | `pvp_design`'s bound already |
| **plus** volume consumed by 27 new cover/blocker pieces | −136 m² | the density uplift itself |

### 4.2 Sightline profile

```
all 67,680 rays:   median  6.3 m   mean  9.2 m
                   p75 13.0 m   p90 21.8 m   p99 38.8 m   max 67.3 m

band mix:   < 6 m  47.4%      ← CQB
          6 – 15 m 32.0%      ← CQB/short
         15 – 25 m 13.5%      ← mid
         25 – 40 m  6.2%      ← mid/long
         40 – 55 m  0.8%      ← long
            ≥ 55 m  0.0%      ← none
```

**79.4% of every sightline in the arena is under 15 m.** This is a CQB-dominant map with a
mid band in the plaza and exactly one genuine long lane. That is the correct shape for
10 actors on 2593 m²: contact is the default state, and the long shots are choices you
walk into rather than conditions you are subjected to.

**Per-region** (measured):

| Region | Walkable | Median ray | Longest line |
|---|---|---|---|
| Plaza | 1102 m² | 10.5 m | 55.3 m |
| Gallery | 260 m² | 5.0 m | 59.5 m |
| Arcade (ground) | 253 m² | 4.3 m | 63.5 m |
| Alley | 275 m² | 5.0 m | 65.0 m |
| `cs1a` | 96 m² | 4.0 m | 61.8 m |
| `cs1b` | 108 m² | 7.3 m | 50.5 m |
| Market street | 113 m² | 7.5 m | 47.5 m |
| Corridor | 56 m² | 3.3 m | 56.0 m |
| NE cut | 40 m² | 5.5 m | 61.5 m |
| Lantern Yard | 63 m² | 3.3 m | 60.5 m |
| Exchange House | 80 m² | 3.5 m | 54.3 m |

Read the two columns together. Every region's **median** is 3.3–10.5 m — that is the space
you actually fight in. Every region's **longest** is 47–65 m — that is one specific standing
spot per region, sighted through two to four doorways. Those are **keyholes**, and Part 4.4
names them.

### 4.3 Will players find each other? — the anti-wandering proof

This is the owner's actual complaint, so it gets a direct measurement rather than an
assurance. The model: one observer plus nine other actors, all at uniformly random walkable
positions, 1500 trials.

| | Measured |
|---|---|
| **Nearest other actor — median** | **9.8 m** |
| Nearest other actor — p90 | 18.8 m |
| Nearest other actor — worst case in 1500 trials | 47.5 m |
| **Time to reach the nearest actor @ 6.4 m/s — median** | **1.5 s** |
| Time to reach the nearest actor — p90 | **2.9 s** |
| Time to reach the nearest actor — worst | 7.4 s |
| **P(at least one actor in direct line of sight, right now)** | **75.3%** |
| Mean actors in direct LOS simultaneously | 1.65 |
| Mean separation of a random pair | 30.6 m |
| Fraction of all position pairs with clear LOS | 19.1% |

**Three in four spawns put an enemy in your line of sight before you have moved, and the
median walk to the nearest actor is a second and a half.** The measured worst case in 1500
trials is 7.4 s. There is no configuration of this arena in which a player wanders for two
minutes and finds nothing; the arena is too small, too connected, and too occupied.

For comparison, the failure being replaced: the campaign map is 14,400 m² gross with ≤ 8
bots alive, spawned by scripted waves that stop firing once a beat is cleared — roughly
**5× the area, at most 80% of the actors, and no respawn**.

### 4.4 The residual long lines ("keyholes")

The probe's long-lane finder lists every ray ≥ 38 m and deduplicates by endpoint. After the
Part 1.3 partitions and Part 1.4 blockers, **twelve** distinct lines remain in the 55–67 m
band. Every one threads three or four doorways. The four worth naming:

| Length | From → To | Threads |
|---|---|---|
| 67.0 m | (14.8, −1.8) → (−46.0, −30.1) | plaza NE → arcade E door 1 → arcade → alley door → alley → `cs1a` |
| 66.0 m | (−44.3, −29.3) → (15.6, −1.4) | the same line, reversed — the arena's true long axis |
| 62.0 m | (−46.3, +11.3) → (15.7, +14.0) | alley → LY D3 → LY room → LY D1 → plaza south edge |
| 61.0 m | (−37.3, −12.3) → (23.2, −4.3) | arcade → E door 1 → plaza → gallery mid door → gallery |

**Ruling: these stay, and they are named rather than removed.** A map with no long line has
no marksman fantasy, and Corvus is one of four weapons. They are acceptable because they are
(a) rare — **0.0% of all rays reach 55 m**, and 0.8% reach 40 m; (b) positional — each
requires one specific standing spot and vanishes with one metre of lateral movement; and
(c) telegraphed — `pvp_design §4.3 B6` already gives a scoped Corvus an additive glint
sprite visible beyond 35 m inside its aimed ±12° cone, which is precisely this case.

One cheap edit makes them fairer, and it is folded into E19: put a **fake sodium head** at
each of the two dark keyhole origins (the alley at Z ≈ −20 and Z ≈ +2). Both ends of the
arena's long axis then backlight the shooter, so holding a keyhole costs you your silhouette.
The alley's `ZONE_BASE` ambient is 0.05 — the darkest in the arena — and the PVP lighting
profile's 18% floor (`pvp_design §3.1`) already requires raising it; this just says *where*.

---

## PART 5 — GEOMETRY vs DATA

Precise, because a build agent implements exactly this.

### 5.1 GEOMETRY — `core/level/layout.js` (and its consumers)

Everything in this section changes the **collider set**, which means it changes
`colliders.js` output, the nav bake, `probe_props.mjs`, and the rendered scene, all
automatically — `layout.js` is the single source (A1) and `level.js` renders `walls`
generically by `kind` (A7).

**Recommended structure.** Take `pvp_design §8.1 G1`'s multi-map registry, minimally:

```
core/level/maps/meridian_ward.js    ← today's layout.js, byte-identical content
core/level/maps/lanternwalk.js      ← imports the ward's builders, applies the edit list
core/level/layout.js                ← becomes buildLayout(mapId, seed)
core/level/colliders.js             ← becomes buildColliders(mapId, seed)
```

The campaign is dead, so a single-file mutation of `layout.js` would also work and is
faster. **Recommendation: do the split anyway.** The campaign map is the source of the six
critic shot framings and the whole `visual_target` scorecard that the project's ship bar is
measured against (`level_design §8`); destroying it destroys the ability to re-run that
comparison, and the arena is a *derived* edit that is far easier to audit as a diff against
a preserved original. The split is mechanical and the risk is one-time.

**Changes inside the arena map module:**

| Function | Change |
|---|---|
| `makeBuildings()` | **Split** `bld_nea` (corridor L1 + 2 south doors + 2 piers + ExH room + 3 doors), `bld_neb` (ExH D3 tunnel), `bld_m1` (LY room + 3 doors). Delete every building outside the arena AABB (`bld_w1`, `bld_w3`, `bld_nw`, `bld_s2`, `bld_s3`, `bld_e1/e2`, `bld_cw`, `bld_ce`, `bld_gatehouse`, `bld_gna/gnb`, `bld_ge_*`) — or keep them as out-of-bounds mass for the skyline; either is fine, the nav flood-fill will not reach them. |
| `makeWalls()` | **Add** B1–B5 (5 boundary boxes) and `arc_part_1..4` (4 arcade partitions). **Split** `arc_w_1` twice (L3 ground door Z[−17,−13]; L4 upper door Y[4.2,6.4] Z[−12,−9.3]), `gal_w_1` once (ExH D3), `gal_w_2` once (L2 mid door), `arc_n` once (LY D2). **Add** the L4 scaffold stair via `steps(W, "alley_stair", -42.6, -41, -12.2, -9.1, 13, 0.3, 0.3)` plus a 1 m landing step, exactly matching the `arc_stair_nw` pattern at `layout.js:216-219`. **Delete** `plat_*` (tram platform), `per_*` outside the arena, `canal_edge`, `wall_ce_parapet`, `hdr_ge_*`. |
| `makeProps()` | Add 27 (§1.4, §1.5), delete ~40 (outside arena + E16), move 2 (E17). Every added prop needs a `cover:{dir,height}` spec so `colliders.cover` picks it up for the bots. |
| `NODES` | **R24 amendment, scoped to this map.** `pvp_design §8.1 G1` already rules that "every `nodes` key set becomes per-map", so this is inside an existing decision, not a new one. Arena key set: `plaza_center, plaza_west, plaza_ne, arcade_ground, arcade_upper, arcade_lightwell, alley_mid, alley_north, cs1_mid, street_mouth, corridor_mid, cut_mouth, gallery_north, gallery_mid, gallery_south, lantern_yard, exchange_house`. Any content key outside this set is a **load-time contract failure**, not a silent no-op (`mission.js:40-44`, A2). |
| `WALK_RECTS` | **Add 9:** `w_corridor` X[0,13] Z[−25,−20]; `w_exh` X[1,12] Z[−34,−26]; `w_exh_tunnel` X[12,17] Z[−31,−27]; `w_ly` X[−39,−28] Z[8,16]; `w_ly_d1` X[−28,−25] Z[11,15]; `w_ly_d3` X[−41,−39] Z[9,13]; `w_gal_middoor` X[15,17] Z[−6,−2]; `w_arc_wdoor_n` X[−41,−39] Z[−17,−13]; `w_alley_stair` X[−42.6,−41] Z[−12.2,−9.1] y 0→4.2. **Modify 4:** `w_plaza` max Z 18 → **14**; `w_street` min Z −41 → **−30**; `w_alley` X → **[−48,−41]**; `w_cut` X → **[13,23]**. **Delete:** `w_ramp`, `w_quay`, `w_blvd`, `w_cye`, `w_customs`, `w_deck`, `w_gal_edoor`. |
| `ZONES` | **Add 3:** `poi_lanternyard` {min:[−39,8], max:[−28,16]}, `poi_exchange` {min:[1,−34], max:[12,−26]}, `poi_corridor` {min:[0,−25], max:[13,−20]}. **Modify:** `poi_plaza` max Z 18 → 14; `poi_alleys` → {min:[−48,−30], max:[−41,14]}. **Delete:** `poi_dock`, `poi_blvd`, `poi_platform`, `poi_customs`. |
| `BOUNDS` | `{min:[−48.5,−2,−34.5], max:[24.5,14,14.6]}` |
| `TERRAIN` | Drop `canal` (out of arena). Keep `heroPuddles` — all three are at plaza Z ≤ 12.5, inside the carve. |
| `LIGHT_POLES` | PVP profile per E19. Delete out-of-arena poles (`L_QUAY`, `L_BLVD_*`, `L_FLOOD_*`, `fake_quay_*`, `fake_platform_strip`, `fake_gatehouse`). Keep `L_ALLEY_A`, `L_PLAZA_KEY`, `L_ARCADE_SKY` as reals; the freed keySpot leases go to the alley south end, the corridor, and the gallery — **the pool size never changes** (R3). |

**Also geometry, elsewhere:** `core/level/props.js` needs a `case "container":` in
`buildKind()` — the boundary stacks and the four sightline breakers are all shipping
containers and A6 says an unhandled kind renders as a plain metal box.

### 5.2 PURE DATA — `content.json`

No code changes; a validator and a match driver read these.

| Key | Change |
|---|---|
| `mission` | **Delete** (with it: `phases`, `path`, `beats`, `objectives`, `spawns.waves`, `loadout.slots` if the mode drives loadout). |
| `pickups` | **Delete** all 3 (`pvp_design §5.2`: no attachments, no pickups, no health). |
| `pois` | Rewrite to the arena's 8 zones (§5.1 `ZONES` row). |
| `arena` | **NEW.** `{ id:"lanternwalk", bounds, spawnPoints[50], clusters{7}, vetoOverrides:{V1:12,V2:25,V3:20} }` |
| `modes` | **NEW.** `tdm` / `ctf` / `ffa`, each with `{ actors:10, teams, spawnClusters[], scoreLimit, timeLimit, respawnS, directorProfile }`. `ctf` adds `flags:[{team:"west",pos:[-33.5,0,12]},{team:"east",pos:[6.5,0,-30]}]`. `ffa` sets `directorProfile:"spread"` (§2.5). |
| `archetypes` | Keep `rifleman` / `cqb` / `marksman`; **delete `heavy`** — it exists for campaign beat 6 and `pvp_design §7.2`/R16 forbid HP variation between actors in PVP. All ten actors are 110 HP. |
| `scenarios` | The nine campaign framings (S1–S9, C1) reference `beat` and `clockS` and will fail the contract gate once `mission` is gone. **Replace** with a 5-shot PVP battery per `pvp_design §9.2`: S1 hip-fire in the plaza, S2 ADS down the gallery's 46 m lane, S3 establishing wide over the plaza from the arcade balcony window, S4 material close-up in the Exchange House, S5 elevated from the balcony across the plaza. Fixed seeds per R21. |
| `signage`, `reverbZones` | Keep. Trim `reverbZones.volumes` to the arcade / gallery / Lantern Yard / Exchange House / corridor. |

### 5.3 CODE — neither geometry nor data

| File | Change | Why |
|---|---|---|
| `core/ai/nav.js` | **`ZONE_BASE` must gain `poi_lanternyard: 0.22`, `poi_exchange: 0.20`, `poi_corridor: 0.15`.** | A3: a zone with no entry falls through to `DEFAULT_AMBIENT 0.35`, which would make three dark interiors read to the AI as brighter than the plaza. `perception.js` reads `nav.lightAt(x,z)` for the `combat_spec §5.1` light factor, so this is a **bot fairness bug**, not a cosmetic one. Also update `poi_alleys` upward (0.05 → **0.16**) to match the PVP lighting profile's 18% floor — the light bake and the rendered scene must not disagree. |
| `core/ai/nav.js` (call site) | Bake with **`{cell: 0.75}`**. | Default `cell: 1.0` against the arena's 73 × 49 bounds gives 73 × 49 cells. The corridor's pier gaps are **2.0 m** and the base doors are 4.0 m; with `FOOT_R 0.2`, a 1.0 m cell can mark a 2 m gap unwalkable and silently sever the artery. At 0.75 m the grid is 97 × 65 = 6305 cells, well inside `GRID_MAX 160` and the 150 ms bake budget. |
| `core/sim/mission.js` | **Replaced** by `core/match/match.js` + `core/match/modes/{tdm,ctf,ffa}.js` (`pvp_design §8.2 N2`). `validateContent()`'s node/weapon/trigger checks should be **kept and retargeted** at the `arena`/`modes` blocks — the contract gate is the reason dangling references are build failures rather than empty matches. | |
| `core/match/spawns.js`, `influence.js` | New (`pvp_design §8.2 N3`), plus the FFA `spread()` variant (§2.5.3). | |
| `core/ai/perception.js`, `squad.js`, `core/sim/damage.js` | Team generalisation, `pvp_design §7.3` steps 1–4 and 6. **Not this document's deliverable** but it is the arena's hard prerequisite: `perception.js:69` reads `S.player` as *the* target and nothing in the sim has a `team` field. | |
| `tools/probe_arena.mjs` | New — promote `_design/pvp/arena_probe.mjs` (shipped with this doc) into the tools directory and wire it to the gates in Part 6. | |

---

## PART 6 — ACCEPTANCE GATES

`_design/pvp/arena_probe.mjs` already implements every measurement below against the real
`colliders.js`. Promote it to `tools/probe_arena.mjs`, point it at the built arena map
instead of its inline edit list, and make it exit non-zero on any FAIL.

### 6.1 Arena gates (headless, exit-code)

| # | Gate | Threshold | Measured at spec |
|---|---|---|---|
| **G-A** | Walkable ground | 2400–2800 m², **single connected component** | 2593 m², 1 component ✅ |
| **G-B** | Per-actor surface | 250–320 m² | 284 m² ✅ |
| **G-C** | Band mix | ≥ 40% of rays < 6 m; ≥ 70% < 15 m | 47.4% / 79.4% ✅ |
| **G-D** | Long-line cap | **0.0% of rays ≥ 55 m**; ≤ 1.5% ≥ 40 m; **no ray ≥ 40 m originating within 6 m of a spawn point** | 0.0% / 0.8% / *(to verify)* |
| **G-E** | 10-actor occupancy | median nearest-actor ≤ 12 m; p90 ≤ 22 m; **P(≥1 in LOS) ≥ 70%** | 9.8 m / 18.8 m / 75.3% ✅ |
| **G-F** | Loop probe (`pvp_design §9.1`) | a nav path exists from **every** spawn point to **every** other and to both flags; **zero dead-end rects** — every walkRect has ≥ 2 connections | *(to verify on the baked nav)* |
| **G-G** | Spawn validity | 40–50 points; all nav-walkable; ≥ 1.5 m clearance; ≥ 8 m forward view; ≥ 6 per cluster; cluster bbox ≥ 110 m² and max pair separation ≥ 14 m; **yaw within ±60° of cluster inward normal** | 50 / all pass / all pass / 6–8 / 119–825 m² ✅; yaw clamp *(to apply)* |
| **G-H** | Boundary probe (`pvp_design §9.1`) | raycast every 2 m along the arena AABB; a renderable within 0.5 m at every sample — **no invisible walls** | *(to verify after E2)* |
| **G-I** | CTF parity | P1 door count/width identical; P2 cover identical; **P3 mid→flag ±8%**; **P4 attacker→enemy-flag ±8%**; **P5 flag longest sightline ±10 m** | ✅ / ✅ / 4.9% ✅ / 5.1% ✅ / **11.5 m ❌ (R1)** |
| **G-J** | TDM parity | team home centroid → arena centroid ±8% | 3.3% ✅ |
| **G-K** | `probe_props.mjs` | exit 0 — zero floats, zero clips, base decal on every ground prop > 0.3 m² | *(to run after E11–E17)* |

### 6.2 Bot-only battery (`pvp_design §9.3`, adapted to 10 actors)

10 bots, no human, 20 seeds, per mode. Every match **ends**; `stuckBotSeconds == 0`; median
`spawnStress` ≤ 0.5; **zero deaths within 2.0 s of spawning** across all seeds; and for TDM
and CTF, |mean margin| < 6 kills / < 1 capture over 20 seeds with sides swapped — i.e.
neither spawn cluster set is the winning one. For CTF additionally: **at least 8 of 20 seeds
produce ≥ 1 capture** (a mode where the bots never cap is a mode that is not implemented,
and it will look identical to a mode that is).

### 6.3 Known residuals at spec time

| # | Residual | Fix |
|---|---|---|
| **R1** | **G-I P5 fails**: FLAG_WEST's longest sightline is 31.0 m, FLAG_EAST's is 19.5 m — 11.5 m apart against a ±10 m contract. The cause is outside the mirrored rooms: LY D1 opens onto the plaza's south-west, which is more open than the market-street pocket ExH D2 opens onto. | Place one 2.2 m `stall` at approximately **(−22, 0, +13)**, screening LY D1's plaza approach, and re-run G-I. Expected to bring FLAG_WEST to ≈ 21 m. **Do not** fix it by adding cover *inside* LY — that would break P2's exact mirror. |
| **R2** | `pvp_design §3.0` rule 3's **spawn-centroid metric** measures 43.0 m (LY) vs 38.5 m (ExH) = 11.0%, outside ±8%. | **Amend the metric, do not chase it.** The walkable centroid of an asymmetric arena is at (−10.9, −8.6), inside the plaza's west half, and *nothing in any of the three modes happens there* — it is not an objective, a spawn, or a choke. The contract's purpose (neither side is closer to what is contested) is served correctly and directly by G-I P3 (mid→flag, **4.9%**) and P4 (attacker→enemy flag, **5.1%**), which measure contested locations. Rule 3's centroid clause is retained **for TDM home clusters** (G-J, 3.3% ✅) where there is no objective to measure against. |
| **R3** | Twelve keyhole lines in the 55–67 m band remain (§4.4). | Accepted by ruling. Mitigated by the two alley sodium heads in E19 and by `pvp_design §4.3 B6`'s scope glint. Re-check after E19 that **no keyhole originates within 6 m of a spawn point** (G-D's third clause). |
| **R4** | The two optional arcade-balcony spawn points (§2.2) are unvalidated — the probe's grid is ground-only. | Validate against the baked nav's y = 4.2 floor. Recommendation: FFA only. |

### 6.4 Zero-cost note: Foothold is still available

`pvp_design §1.1 MODE 2` (rotating capture zone) is out of scope because the owner named
three modes and this is not one of them. It is recorded here only because deleting the note
costs nothing and re-deriving it later costs an afternoon: the arena's five natural zone
anchors are the plaza centre **(−5, 0, 0)**, the arcade lightwell **(−32, 0, −8)**, the
cross-street mid **(−26, 0, −23)**, the gallery mid **(20, 0, −4)**, and the corridor/cut
junction **(11, 0, −21)**. Walking that order crosses the plaza or the artery every rotation,
which is the property Foothold needs. Nothing in this carve blocks it; V7 would simply come
back out of retirement.

---

## PART 7 — CORRECTIONS TO `pvp_design.md`

Listed explicitly so nothing is silently overwritten.

| § | `pvp_design.md` says | This document | Reason |
|---|---|---|---|
| **1.0** | 6v6, 12 actors, ≤ 4 humans per team | **5v5 / FFA, 10 actors, 1 human + 9 bots** | Owner's directive. |
| **1.1** | Skirmish 75 kills / 10:00; Foothold; Blackline | **TDM 50 kills / 8:00; CTF; FFA.** Foothold and Blackline out of scope. | Owner's directive; kill target rescaled for 10 actors and a 1.5 s median time-to-contact. |
| **1.2** | FFA excluded — "the spawn director's core signal is team influence" | **FFA ships.** §2.5 replaces the signed influence grid with an unsigned `spread()` on the same grid at the same cadence. | The objection was a netcode-era framing of a scoring-weight problem; there is no netcode. |
| **1.2** | Carried-flag modes excluded — "carrier state is the hardest thing to replicate under client authority" | **CTF ships.** | **The objection is void: there is no replication.** One browser, one sim, one authority. |
| **1.2** | Ranked/killcams excluded | unchanged, still excluded | — |
| **2.1** | spawn clearance ≥ 2.0 m; cluster ≥ 250 m² | **≥ 1.5 m; ≥ 110 m² plus a ≥ 14 m pair-separation clause** | Measured: the arena's median sightline is 6.3 m; 41 of 51 candidates failed the 2.0 m bubble in a 6–7 m-wide gallery and alley. §2.3. |
| **2.2** | V1 22 m, V2 60 m, V3 ≤ 40 m | **V1 12 m, V2 25 m, V3 ≤ 20 m** (map-local override, the BOXCUT §3.7 precedent) | At 22 m the veto disc is 1520 m² against 2593 m² of ground; the ladder would relax on every spawn. §2.4. |
| **2.2** | V7 (Foothold zone veto) | **retired** | No Foothold. |
| **3.2/3.3** | Six-map portfolio; Lanternwalk deliberately has "no 45 m+ lane" so "Corvus is a bad pick" | **One map, so every weapon needs a home.** The long band is the Storm Gallery's measured 46 m centre lane. | The portfolio the omission served does not exist. |
| **3.3** | Bounds X ∈ [−48,+26], Z ∈ [−34,+22] = 74 × 56 m | **X ∈ [−48.5,+24.5], Z ∈ [−34.5,+14.6] = 73.0 × 49.1 m** | 12 → 10 actors; plus the removal of the ramp stub, the plaza south strip, the market-street stub and the GE strip, all of which were dead ends. §4.1 itemises the −13.5%. |
| **3.3** | "West lane: alley stub + arcade, CQB **5–14 m**" | **The bounded alley measures a 44 m straight** — both dog-leg blockers (`bld_w2`, `bld_w3`) are outside X ≥ −48. Fixed by two half-width containers; measured longest straight now **22.5 m**. | Measured, not assumed. |
| **3.3** | "East: Storm Gallery, CQB **8–18 m**" | **The gallery's centre lane is clear for 46 m** — every one of its five cover pieces is a wall-hugger. It is the arena's long band, not its CQB flank. | Measured against `layout.js:416-425`. |
| **3.3 E6** | North service corridor through `bld_nea` at Z[−24,−20] | **Confirmed and adopted**, widened to 5 m with two overlapping piers. An alternative alignment at Z[−22,−18] was tried and rejected — `bld_nea`'s south face *is* Z = −18, so that cut produces an open loggia onto the plaza rather than a connector. | E6 was right. |
| **3.3 E7** | "Reverse mantle — kiosk roof (−22, 2.6, −6) → arcade balcony east window (−25, 4.2, −6)" | **Not buildable; replaced by the alley scaffold stair (L4).** There is no window at y 4.2: `arc_e_b2` is solid to y 5.3 and the window band is y[5.3,7.3]. A 2.6 → 5.3 m rise is 2.7 m against `combat_spec §1.5`'s 1.35 m mantle cap. | `layout.js:173-181`. |
| **3.3 E1–E5, E8–E10** | Seal ramp / alley south / NE cut / market street / gallery north door; re-cover the cross-street; strip the script; PVP lighting | **All adopted**, with revised coordinates (§1.1, §1.4, E18, E19) and one deletion: E2 (alley south seal) is unnecessary — `bld_w2` already caps the alley at Z = +14. | — |
| **3.3** | Four spawn clusters, 38 points | **Seven clusters, 50 points**, including an FFA-only plaza ring | Three modes, and FFA needs the hub. §2.2. |
| **3.3** | Foothold zones; Blackline sites | recorded as a future hook only (§6.4) | Out of scope. |
| **4.x, 7.2–7.3** | Balance deltas; bot difficulty; team generalisation | **adopted unchanged** | — |
| **6.x, 8.2 N1, 9.3 two-human/eight-human batteries** | anti-cheat, relevance culling, mesh, bridge channels, host migration | **entirely out of scope** | No networking. |

---

## PART 8 — OPEN QUESTIONS

1. **Registry split or in-place mutation of `layout.js`?** §5.1 recommends the split so the
   campaign map survives as the visual-gate reference. This is a build-effort trade the
   owner may want to overrule; if overruled, the arena edits go straight into `layout.js`
   and the six campaign shot framings are lost with it.
2. **Does the owner want the campaign map preserved at all?** "*this game has no campaign
   mode atm*" — *atm* is doing work in that sentence. Preserving `maps/meridian_ward.js`
   costs one file and keeps the door open.
3. **Balcony spawns in FFA — yes or no?** (R4.) The arcade balcony is the map's power
   position; spawning there in FFA is defensible, in team modes it is not.
4. **Mode-specific kill/time targets** (50/8:00 TDM, 25/8:00 FFA, CTF cap target) are
   map-side *recommendations* derived from the measured 1.5 s time-to-contact. The match
   driver owns them; they should be tuned against the §6.2 bot-only battery, not guessed.
5. **The `heavy` archetype is deleted** (§5.2). If the owner wants a heavier bot as
   *flavour*, it must differ by weapon and archetype behaviour only — `pvp_design §7.2` and
   R16 forbid HP variation between actors, and the probe cannot catch that violation.

---

*Every measured figure in this document comes from `_design/pvp/arena_probe.mjs` run against
`core/level/colliders.js` this session; every geometric claim about the existing map cites
the line in `core/level/layout.js` it came from. Where the carve produced a defect — the
72 m through-line in §1.3, the 68.8 m artery in §1.4, the base-room tubes in §1.5 — the
probe found it, this document names it, and the fix is in the edit list rather than in a
hope that playtesting will notice.*
