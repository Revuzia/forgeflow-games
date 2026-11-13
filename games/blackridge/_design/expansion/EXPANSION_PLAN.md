# BLACKRIDGE — EXPANSION PLAN (authoritative synthesis)

Status: **BINDING for the expansion**, pending the owner decisions in Part 8 and the A0
freeze amendments in Part 9. Expansion director synthesis, 2026-08-19.

Authority order: `pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md` >
**this document** > the four expansion design docs (`campaign_biomes.md`,
`pvp_design.md`, `level_architecture.md`, `netcode.md`) > the six v1 design docs.

Where an expansion doc conflicts with a ruling below, the ruling wins and the conflict
is recorded in Part 1. No build lane re-litigates a ruling; a genuinely new conflict
goes to A0 as a freeze-amendment request.

Owner directive (verbatim): *"I want a pvp mode ultimately, where we have MULTIPLE maps
from different areas of the campaign, which im assuming has things like outdoor, or
forest, or office, or various areas to fight/explore."*

Inputs read in full this session: all four expansion docs, `BUILD_PLAN.md`,
GAME_DOCTRINE.md §5. On-disk facts re-verified independently this session are marked
**[verified]** with the command that produced them.

---

## PART 0 — INDEPENDENT VERIFICATION LEDGER

The four designers each cite the code. I re-checked the claims that a ruling turns on,
because one of them is wrong and the plan changes because of it.

| # | Claim | Result |
|---|---|---|
| V1 | `stepPlayer` is hard-bound to the singleton player | **[verified]** `core/sim/player.js:72-73` — `export function stepPlayer(state, cmd, world, weapons, dt, sim) {` / `const p = state.player;` |
| V2 | `stepBotLocomotion` has no slide / mantle / jump / tac-sprint | **[verified]** `core/sim/player.js:587-617` read in full: yaw, stance, accel/decel toward `MOVE.CROUCH\|SPRINT\|WALK`, gravity, `moveCapsule`, footstep phase. No slide, no mantle, no jump, no `MOVE.TAC`. |
| V3 | `buildLayout` / `buildColliders` take no map id | **[verified]** `layout.js:758 export function buildLayout(seed = 1)`; `colliders.js:28 export function buildColliders(seed = 1)` |
| V4 | `materials.js` is a module singleton that ignores its arguments after first call | **[verified]** `materials.js:31 let CACHE = null;` → `:521 if (CACHE) return CACHE;` |
| V5 | Light pool counts are module constants | **[verified]** `lighting.js:33-34 const SPOT_COUNT = 8; const POINT_COUNT = 4;` |
| V6 | The FFG net substrate exists on disk as cited | **[verified]** `pipeline/engine/runtime/net/ffg_netplay.js`, `games/last-circle/runtime/net/ffg_rtc.js`, `games/chroma-hide/runtime/net/loopback.js` all present |
| V7 | **Meridian Ward has no recorded critic scoring iteration** | **[verified by absence]** `find games/blackridge -name "scores*"` → **zero matches**. `_shots/` holds shot batteries through `iter95` with manifests, but `scores.jsonl` — the R27 append-only critic record that the ship bar is measured from — does not exist anywhere in the game directory. |
| V8 | `game_meta.json` status | **[verified]** `"status": "unpublished"` |

**V2 is the finding that changes the plan.** `pvp_design.md` §8.2 states that remote
humans are bot records with `brain:'net'` and that this "should be treated as binding."
For rendering that is correct and valuable. For simulation it is false: a remote human
driven through `stepBotLocomotion` is a human who cannot slide, mantle, jump or
tac-sprint — i.e. cannot use four of the game's signature verbs (BUILD_PLAN R7).
Ruling X4 corrects it.

**V7 is the finding that sets Phase 0.** The expansion's entire schedule is dominated by
per-map critic loops, and we have **zero** empirical data on how many iterations one map
takes, because no scored iteration has been recorded. Every schedule statement in Part 7
carries that caveat explicitly rather than burying it.

---

## PART 1 — CONFLICT RESOLUTIONS

X-numbered rulings. Each states the conflict, the ruling, and why. Referenced by the
roadmap and the amendment register.

### X1 — Authority model: HOST-AUTHORITATIVE. `netcode.md` wins.

**Conflict.** `pvp_design.md` Part 6.1 states as fact: *"There is no server. The client
is authoritative over its own position, its own health, and the hits it claims,"* and
builds an elaborate mitigation stack on top of it (§6.3 host-side hit-claim replay
validation, §6.2 sender-side culling, §6.4 make-cheating-pointless). `netcode.md` §2.1
explicitly rejects that model, quoting Last Circle's `hitYou` path at
`royale/net.js:417-423` as "immortality in three lines of console," and rules
host-authoritative with client prediction and favour-the-shooter rewind.

**Ruling: host-authoritative.** Guests send buttons and a look direction. The input
packet carries no position, no velocity, no hit claim and no damage number; the host
derives all of it (`netcode.md` §4.3).

**Why.** `pvp_design`'s own exploit table (§6.1) answers "preventable?" with **No** for
speed, teleport, aimbot, infinite HP, no-recoil and no-spread. Under X1, five of those
seven rows become *impossible by construction* rather than *mitigated by counters* — and
it costs nothing extra, because the transport, the topology and the tick rates are the
same either way. The deciding asset is one both docs agree on: `sim.step(cmd)` is a
fixed-dt, command-driven, THREE-free, deterministic simulation, which is the exact shape
host authority and prediction require.

**Two consequences that delete work, and they are worth naming:**

- `pvp_design` §6.3's hit-claim replay validator (rewind cap, LOS recheck, falloff
  consistency, position plausibility, rate limit) becomes **dead code**. There is no hit
  claim on the wire to validate. Do not build it.
- `pvp_design` §6.2's *separate* 2 m-quantised 5 Hz "coarse adjudication stream to the
  host" becomes **dead code**. It existed only because clients owned their own positions
  and the host needed *some* view of them for spawn scoring. Under host authority the
  host already has every position at 60 Hz. **Delete the stream and its
  suppression-detection asymmetry logic.**

What survives from `pvp_design` Part 6: the *relevance culling* concept (§6.2), which
`netcode.md` independently specifies at phase N5 as a host→guest omission rule; the
version+mapHash join handshake (§6.5); host kick / vote-kick / local blocklist (§6.4);
and the honest-labelling posture. Those merge into the netcode model unchanged.

### X2 — Transport topology: STAR, not mesh. `netcode.md` wins.

**Conflict.** `pvp_design` §1.0.1: *"RTC mesh carries state."* `netcode.md` §2.2:
star topology, each guest holds exactly one DataChannel, host holds H−1.

**Ruling: star.** It follows directly from X1 — every packet's endpoint is the host, so
a mesh is connection state and NAT-traversal exposure bought for nothing.

**The fallback paths merge.** `pvp_design`'s per-peer bridge channel
(`ffg:blackridge:<code>:b:<peerId>`, 2 subscribers so each message bills 1) and
`netcode.md` §5.4's Supabase fallback are the same mechanism described twice. Merged
form: the bridge channel is the transport, `netcode.md`'s rate ladder is the cadence
(12 Hz at 2 humans / 8 Hz at 3 / 5 Hz at 4+, interp buffer widened to 2× interval), and
the cap is **3 concurrent fallback guests** (`netcode.md` §5.4) rather than
`pvp_design`'s 2. `pvp_design`'s rule that the excluded player is told honestly —
*"your network can't reach the other players directly"*, with an offer to play local
bots or requeue — is adopted verbatim. **Never silently degrade the whole room to
rescue one peer.**

### X3 — Population: ship at 4v4; 6v6 is a measured per-map unlock.

**Conflict.** `pvp_design` §1.0 rules 6v6 / 12 actors with ≤4 humans per team.
`netcode.md` §5.5 targets 4v4 / 8 humans as the shipping mode with 6v6 "gated behind a
measured host-uplink check" (~33 KB/s sustained on one player's home upload).

**Ruling: the shipping default is 4v4 — 8 actors, up to 8 humans, bots filling every
empty slot. 6v6 (12 actors) is a per-map flag, unlocked only after the Phase 6
measurement passes on that map.**

**Why.** Both docs cap humans at 8 for the same reason. The disagreement is total actor
count, and 12 is simultaneously the engine ceiling (R23: 12 bots max, AI ≤1.5 ms) *and*
the uplink stretch. Shipping at the ceiling on both axes at once leaves zero headroom
for the two numbers nobody has measured (host frame time under net load, and real home
upload). 4v4 has headroom on both.

**Mode scalars scale with population, declared per mode, not hardcoded:** Skirmish score
limit = 12.5 × actors (**50 at 4v4**, 75 at 6v6). Foothold's 200 points and 60 s zone
rotation are time-driven and unchanged. Blackline is 4v4 already. Every other number in
`pvp_design` Part 1 stands.

### X4 — Remote humans: rendered as bot records, simulated as players. Both docs are half right.

**Conflict.** `pvp_design` §8.2 declares "remote humans are bot records with
`brain:'net'`" and says it "should be treated as binding" because it keeps the blast
radius small. `netcode.md` §7 says a remote human cannot be a bot, because
`stepBotLocomotion` has none of the signature verbs.

**Verified: `netcode.md` is right on the sim side (V2, above).**

**Ruling — the corrected binding rule:**

> A remote human is an **actor record**, rendered through the identical
> `soldiers.js` / `fx` / `audio` / `hud` path as a bot (this is `pvp_design`'s real and
> valuable insight, and it stands), and **simulated on the host through the full player
> path**, not the bot locomotion path.

That requires `netcode.md`'s N-R1/N-R2: generalize `stepPlayer(state, cmd, …)` into
`stepActor(sim, actor, cmd, dt)`, with `state.player` kept as a **live alias** of
`state.actors[myIndex]` so single-player and every existing probe are untouched.

**Why this correction matters more than it looks.** `pvp_design`'s effort estimate is
built on the false version: it lists G2 (teams) as its only large sim change and assumes
`soldiers/fx/audio/hud need zero changes` covers the rest. The view layer does need zero
changes. The sim layer needs the largest single refactor in the expansion. Any plan
built on the un-corrected claim would under-scope the project by roughly one full lane
of its hardest work.

### X5 — Teams (G2) and actor generalization (N-R1/N-R2) are ONE lane, not two.

**Conflict.** `pvp_design` G2 scopes "teams" as `team` fields plus `perception.js`
target-list generalization plus per-team `squad.js`. `netcode.md` N-R1/N-R2 scopes
"actors" as `stepPlayer` → `stepActor` plus `state.actors[]`. They are the same refactor
seen from two ends, and both amend the frozen `sim.state` shape.

**Ruling: one lane, one freeze-amendment block, executed together, named `S1`.** Doing
them as two passes means two amendments to `sim.state` and two passes over the audited
AI fairness surface — which BUILD_PLAN Part 6 already ranks as a top risk class.

`pvp_design` §7.3's target-switching hysteresis (swap only if the new candidate's
awareness exceeds the current target's by 0.25, or the current target has been lost
≥ 2 s) is **specified as part of S1, not left to implementation**, because without it a
bot in a multi-target world re-rolls its reaction latch and violates `combat_spec` §5.6's
roll-once-and-latch guarantee — the mechanism that makes the AI feel fair.

### X6 — Arena roster: the campaign owns the locale set. `campaign_biomes.md` wins.

**Conflict.** `campaign_biomes` produces 11 arenas from 8 missions (MERIDIAN, DRYDOCK,
HOLLOWMERE COMPOUND, DEADFALL, GLASS FLOOR, THE ATRIUM, SABLE PIT, THE CROSSING, THE
CISTERN, PALE HARVEST, ASHFALL). `pvp_design` §3.2 specifies six maps — LANTERNWALK,
HOLLOWPINE, EXCHANGE, **SPILLWAY** (a dam service deck), BOXCUT, **SLIPWAY** (a rail /
freight yard). Two of those biomes — the dam and the rail yard — **exist in no campaign
mission**, which contradicts the owner's directive that PVP maps come from campaign
areas, and each would cost a whole art set to serve one arena.

**Ruling: every arena is a carve of a campaign locale. `pvp_design`'s lane specs,
carve doctrine, spawn clusters and power-position/counterplay discipline are retained
and retargeted onto the biome set.**

| `pvp_design` map | Retargeted to | Notes |
|---|---|---|
| LANTERNWALK | **LANTERNWALK** (M1 Meridian Ward) | unchanged; metre-exact spec in `pvp_design` §3.3 stands, all 10 carve edits E1–E10 |
| EXCHANGE | **GLASS FLOOR** (M4) | lane spec (open plan / atrium / executive ring) maps directly onto the biome's floor plate + cores |
| HOLLOWPINE | **HOLLOWMERE COMPOUND** (M3) | logging-camp lanes become relay-compound lanes; the mill catwalk becomes the firewatch tower / relay shed |
| SPILLWAY | **DRYDOCK** (M2) | see below |
| BOXCUT | **THE CROSSING** (M5 border post) | the small map; keeps `pvp_design` §3.7's map-local veto override (V1 14 m, V2 30 m), declared in map data and gate-checked |
| SLIPWAY | **dropped** | its identity — container stacks, long lanes with no mid band — is already DRYDOCK's. A second container map is not a portfolio slot. |

**SPILLWAY → DRYDOCK is the substantive swap.** Spillway's portfolio job was "the long
band + the only high-key lighting." `visual_target` §0.1 and `campaign_biomes` M5 both
say high-key daylight is the hardest thing this stack can fake; Spillway would have made
the *hardest lighting problem in the project* a launch dependency, in a biome that
doesn't exist. Drydock Seven gives the long lane honestly — `campaign_biomes` M2 states
"the dock floor is a ~90 m canyon (the long lane, at the bottom)" — at blue hour, which
`campaign_biomes` ranks 4th with **LOW** critic risk and a wet path that transfers 1:1
from the shipped map. The true long-band map (SABLE PIT, up to 140 m) arrives in wave 3,
and Corvus's proper home arrives with it. **That is an accepted launch-window gap:
at launch, Corvus is a situational pick whose only home is Drydock's dock floor.**

**Portfolio rule, amended.** `pvp_design` §3.2 requires no two launch maps to share a
dominant sightline band. THE CISTERN (CQB 75%) and GLASS FLOOR (CQB 60%) both violate
that. Ruling: the rule becomes **"a distinct dominant band OR a distinct dominant
tactical verb, plus a distinct time of day, per map."** The Cistern's verb is
sound-and-light discipline among hard 90° brick corners with no daylight; the Glass
Floor's is angles-and-pre-fire through soft cover you can shoot through, in an interior
storm evening. Those are not the same map, and the times of day are all four distinct:
night rain / no daylight / interior evening / blue hour.

### X7 — "First new map" — three docs, three answers, no actual conflict once sequenced.

**Conflict.** `campaign_biomes` §6 says build THE UNDERCROFT first (it is the refactor
vehicle). `pvp_design` §8.3 says build LANTERNWALK first (it proves the carve pipeline on
geometry that already passed the bar). `level_architecture` Phase 6 says build a
throwaway **office** blockout first (it stresses the map format hardest: no sky, no rain,
`reflect:null`, multi-floor nav, interior-only reverb).

**Ruling: they are three different artefacts. Sequence, do not choose.**

1. **The office blockout is a disposable test fixture** (`level_architecture` Phase 6).
   Never dressed, never scored, never shipped, deleted after it passes. Its only job is
   to prove that boot, nav, sim, the light pool and the harness survive a map sharing no
   assumption with Meridian.
2. **LANTERNWALK is the first arena** — and it needs no new biome at all, only the map
   registry plus the arena layer. It can be carved while Undercroft art is in flight.
3. **THE UNDERCROFT is the first shipped new map / new biome** (`campaign_biomes`'
   refactor vehicle logic stands in full).

### X8 — Node keys: per-map sets with a referential gate. `level_architecture` wins.

**Conflict.** `campaign_biomes` G3 proposes namespacing every node key as
`<mapId>.<nodeKey>`. `level_architecture` §2.2 proposes per-map node sets, a referential
contract gate ("every node a mission/scenario references exists in that mission's map"),
and a per-map `expectNodes` fixture pinning Meridian's 15 to preserve today's gate
strength.

**Ruling: `level_architecture`.** Namespacing forces a rewrite of every existing
content.json reference for zero added safety, and it bakes a map's name into a key —
which breaks the moment a map is renamed or an arena reuses a mission's nodes. The
referential gate is strictly stronger (it catches a dangling ref across *any* map) and
costs no rewrites. Freeze amendment against R24 either way (Part 9).

### X9 — Where arena data lives: split by kind, not by file convenience.

**Conflict.** `campaign_biomes` Part 2 rule 6: the carve is *"a data flag on the map's
layout export, never a copied geometry."* `level_architecture` Part 6 Q4 recommends
separate `content/arenas/<id>.json` files to keep A3 (space) and A2 (content) ownership
disjoint.

**Ruling: split by kind.**
- **In the map file (A3, space):** the carve rectangle, the **loop patch** connector, and
  the boundary masses that seal the arena diegetically. These are geometry — and the loop
  patch must exist in the campaign map too (`campaign_biomes` rule 3: in campaign it is
  an unused alternate route). Putting it anywhere else forks geometry, which is the exact
  invariant `level_architecture` exists to protect.
- **In `content/arenas/<id>.json` (A2 / N-lanes, content):** spawn points and clusters,
  mode config, Foothold zones, Blackline sites, the map-local veto overrides, and the
  `lightingProfile` selection.

### X10 — PVP lighting profile is map data, not a runtime branch.

`pvp_design` §3.1 specifies a real balance change (18% brightness floor in every playable
zone, fog ×0.7, faction rim tint, flicker off, dynamic light events banned) applied "at
map load." `level_architecture` §2.2 moves practical intensity/distance/penumbra out of
`level.js`'s `specById` and into the map.

**Ruling: the profile is a block inside the map file —
`lights.profiles.{campaign, pvp}` — not a branch inside `lighting.js`.** Single source
preserved. All three docs agree the R3 pool is never resized; that is reaffirmed here as
permanent: **1 dir + 1 hemi + 8 spot + 4 point, for every map, in both profiles,
forever.** `level_architecture`'s promotion of the silent 9th-spot truncation
(`lighting.js:577-579`) to a `probe_props` build failure is adopted.

### X11 — Hitstop stays banned in PVP, for a stronger reason than given.

`pvp_design` B12 bans hitstop because dt scaling "desynchronises this client from every
other one." Under X1 the reason is harder: `netcode.md` §3.7 item 1 shows prediction is
exact *only* because client and host run byte-identical movement code at byte-identical
`DT = 1/60`, which is what lets the reconciliation dead zone be 3 cm instead of 30 cm.
**Any dt scaling on a guest breaks reconciliation itself, not merely the visuals.**
Ruling: banned in PVP; replaced by full-strength view-only feedback per B12.

### X12 — Ratings and progression: none, through every phase in this plan.

`pvp_design` Part 5.5 (no server-side stat writes, because FFG registry writes need the
`service_role` key and a browser client must never hold one) and `netcode.md` §4.5
(unranked through N5, because a ladder in a host-is-a-player topology rewards hosting)
agree from different directions. **Ruling: no XP, no unlocks, no currency, no
leaderboard, no Elo, no performance achievements. Local `localStorage` records only.**
Only the optional N6 referee could change this, and it is owner-gated (Part 8).

### X13 — Campaign and PVP lanes are file-disjoint and run in parallel — with one exception.

`netcode.md` §9.5 warns that its §7 refactor touches `core/sim/player.js`,
`core/sim/sim.js` and `core/rng.js` — "the same files a multi-environment campaign
expansion will touch" — and recommends landing the sim refactor first, then fanning out.

**Ruling: the sim lane (`S1`) and the level lane (`L1`) are disjoint by file
(`core/sim/*` + `core/rng.js` vs `core/level/*`) and run in parallel, with two named
serialization points:**
1. **`runtime/boot.js` is A0's file and both lanes need it.** A0 sequences those touches;
   no lane edits boot.js directly.
2. **G9 (heightfield ground) is the exception.** It touches `world.sphereGround` and
   `moveCapsule` — sim files — so it is sequenced *after* S1 lands. Only M5 Sable Run
   needs it, and M5 is last anyway, so this costs nothing.

---

## PART 2 — THE REFACTOR-FIRST RULING

**Question put to me:** must `level_architecture`'s migration land BEFORE biome #2 is
authored?

**Ruling: CONFIRMED, and strengthened. The migration lands before biome #2, and the
migration itself does not start until Phase 0 closes.**

### Why confirmed

The counter-proposal — author the Undercroft against the current system and refactor
later — costs, concretely:

- `level.js` today holds **62 literal-coordinate constructions across 13 hardcoded
  blocks** (`level_architecture` §1.2), and only 14 of its 955 lines reference `layout.`
  at all. A second map authored the same way doubles that, and the eventual extraction
  then has to be done against two maps with a regression baseline for neither.
- `materials.js` **[verified V4]** returns the *first* map's material set forever
  (`let CACHE = null` → `if (CACHE) return CACHE`). A second biome authored before
  Phase L3 silently renders in Meridian's materials, and the failure mode is a subtle
  wrong-looking map rather than a crash — the worst possible thing to hand a critic loop.
- The ≤120 texture / ≤200 MB VRAM budget breaks at biome 3 without `disposeBiome`
  (`level_architecture` §3.3). PVP map rotation makes in-session switching mandatory, so
  this is not deferrable.

### The strengthening — this is a correctness constraint, not a priority call

`level_architecture` Phase 2 sub-steps **4 and 9** add colliders where visual-only
geometry stood today (boulevard gantry posts; lamp/neon masts — the verified invariant
violation at §1.3a). Those steps **move pixels and change ballistics and nav**.

The critic loop compares iteration N against N−1 and N−2 from `scores.jsonl` (BUILD_PLAN
§5.6), and BUILD_PLAN risk 7 names determinism leaks poisoning the critic loop as a
top-10 risk. **Running the refactor concurrently with Meridian's critic loop would make
consecutive iterations non-comparable and invalidate the plateau rule.** That is why
Phase 0 is not merely first in priority — the expansion is *technically prevented* from
starting until the ship decision is recorded.

### The exact order

```
PHASE 0   Meridian Ward reaches the critic ship bar. scores.jsonl records the
          3-critic ship-decision iteration. NOTHING BELOW STARTS BEFORE THIS.
   ↓
L0  Baseline: colliders.sha256 + placements.sha256 + the green iterNN PNG set
L1  Pure extraction → kit/authoring.js + maps/meridian_ward.js   [hash-identical gate]
L2  level.js dressing extraction, 9 sub-steps, one commit each   [the risky one; 2–3× any other phase]
L3  De-singleton materials + props; create biomes/wet_city_night.js at today's exact values
L4  Parameterise the five private consumers (nav / reflect / prewarm / sky / ambience)
L5  Content split, map registry, boot ?map=, teardown + dispose
L6  Throwaway OFFICE blockout — proves the seams, never dressed, deleted after
   ↓
ARENA LAYER (needs no further level refactor — level_architecture Phase 7)
   ↓
BIOME #2 (THE UNDERCROFT) may now be authored.
```

**No new map art is commissioned before L6 passes.** LANTERNWALK's carve is the one
thing that may run alongside L5–L6, because it authors no new art — it is edits to
geometry that already exists and already passed the bar.

---

## PART 3 — THE PHASED ROADMAP

Ordered by (player value × risk retired). Two tracks run in parallel after Phase 2 —
**SIM/NET** and **LEVEL/ART** — because X13 establishes they are file-disjoint. Lane ids
follow BUILD_PLAN Part 2 (A0–A11) plus the new lanes from `pvp_design` §8.2 (N1–N5) and
this document (S1, L1).

Every acceptance criterion below is **measured**, per doctrine §5: *"Done = observed
effect in the LIVE system. Compiles/probe-passes are proxies."*

---

### PHASE 0 — SHIP MERIDIAN WARD *(this is the current work; the expansion has not started)*

**Say it plainly: there is no expansion until the v1 map clears the bar.** Everything in
this document is a plan for work that begins after a recorded ship decision, and Part 2
shows the constraint is technical, not merely managerial.

**Current state [verified V7]:** shot batteries exist through `_shots/iter95`, but
`scores.jsonl` — the R27 append-only critic record the ship bar is read from — **does not
exist anywhere in the game directory**. Zero scored critic iterations are on record. The
critic loop is the thing that has not happened yet.

- **Ships:** BLACKRIDGE v1 — one mission, Meridian Ward, at the frozen bar.
- **Lanes:** all of A0–A11 as BUILD_PLAN Part 3 wave 3 specifies.
- **Acceptance (frozen, BUILD_PLAN Part 5 — verbatim, not restated loosely):**
  - Critic ship bar: **every dimension ≥ 8 AND mean ≥ 8.5 AND blind verdict at least
    "borderline" from EVERY critic**; ≥2 cold critics per scoring iteration, **3 on the
    ship-decision iteration**; a single confident "no" blocks ship.
  - `scores.jsonl` exists and contains the ship-decision rows. *(This is the gate the
    expansion reads; today it is the gate that cannot be read.)*
  - perfprobe all three phases: p50 ≤ 16.7 ms, **p99 ≤ 33.3 ms (FAIL-class)**,
    **programs delta == 0**, draws ≤ 320 median.
  - Persona battery at the §5.4 bars; `stuckBotSeconds == 0`; every match ends.
  - Ship blockers clear: `__FFG_FALLBACKS__` empty, no contract-gate throw, probe_props
    exit 0, every selftest exit 0.
  - `deployverify.py` exit 0 including one production bot-match.
- **Unblocks:** literally everything below.

---

### PHASE 1 — `S1`: ACTOR GENERALIZATION + TEAMS *(SIM/NET track opens)*

The largest single engineering item in the expansion, and it produces no player-visible
change. It goes first on its track because it blocks both PVP and every fairness claim.

- **Ships:** nothing visible. Internally: `stepActor(sim, actor, cmd, dt)` with
  `state.player` as a live alias of `state.actors[myIndex]` (X4); `state.actors[]` with a
  `kind` field; `team` on every actor; friendly-fire gate in `damage.js`;
  `perception.js` generalized from `S.player` to an enemy-team target list with the 0.25
  / 2 s hysteresis (X5); `squad.js` per team, with the ≤2 fire-token and ≤3-damaging-
  attackers-per-250 ms caps applied **per human target** rather than globally;
  per-shot RNG `mulberry32(hash(seed, shooterId, shotSeq))` (N-R3); `stepLocalActor`
  (N-R5); fixed-size snapshot/restore rings (N-R6); `applyDamage` accepting player ids
  (N-R7); mode split so `mission.tick` is campaign-only (N-R9).
- **Lanes:** one lane (A1 + A5 jointly, as a single owner for the duration — X5 forbids
  splitting it). A0 pre-approves the Part 9 amendment block before the lane starts.
- **Acceptance (measured):**
  1. **Every existing selftest and probe passes unchanged, with zero edits to any test
     file.** `sim.selftest.cjs`, `ai.selftest.cjs`, `probe_props.mjs`, all four personas,
     the full shot battery. This is the whole acceptance test for the refactor and it is
     binary.
  2. `ai.selftest.cjs`'s 30-seed fairness battery extended to a two-team world and green:
     zero pre-reaction shots, latched rolls never re-rolled on target switch, token caps
     held per human target, zero muzzle-blocked pulls.
  3. **6v6 bots-vs-bots on Meridian Ward, headless, 20 seeds: every match ends,
     `stuckBotSeconds == 0`, `|mean score margin| < 8 kills`** (neither side is the
     winning side). Per `pvp_design` §8.3: *"if 6v6 bots-vs-bots on Meridian Ward is not
     fair and does not end, nothing after it matters."*
  4. `stepLocalActor` replay of **15 ticks ≤ 1.0 ms**, asserted by a probe. *(This
     number decides whether client prediction is viable at all — Phase 4 is built on it.)*
  5. Single-player TTK / spread / recoil probe results **bit-identical** before and after
     N-R3's RNG change.
- **Unblocks:** Phase 3 (local PVP), Phase 4 (netcode), and every fairness claim in both.

---

### PHASE 2 — `L1`: LEVEL MIGRATION *(LEVEL/ART track opens; parallel with Phase 1)*

`level_architecture` Parts 4 and 5, executed as L0–L6 per Part 2 above.

- **Ships:** nothing visible. Meridian Ward renders and plays byte-identically, out of
  `core/level/maps/meridian_ward.js`, through a registry, with a working teardown path.
- **Lanes:** one level lane (A3) with A0 on boot.js and A2 on the content split.
- **Acceptance (measured, per sub-phase — each individually committable and revertable):**
  - **L1:** `probe_props.mjs` exit 0 **and both L0 hashes byte-identical**. A mechanical
    move; differing hashes mean something was retyped.
  - **L2 (each of 9 sub-steps):** `probe_props` exit 0 + `sim.selftest.cjs` exit 0 +
    `ai.selftest.cjs` exit 0 + battery compared against the L0 PNGs. Only steps 4 and 9
    (gantry posts, lamp masts — new colliders) may move pixels; everything else must be
    visually identical. Steps 4 and 9 additionally require all four persona playprobe runs
    green, because bots pathed through those posts yesterday and collide with them today.
  - **L2 step 3 specifically:** the rain-occlusion de-fork. The two copies disagree today
    on four ceiling heights (`level.js:941-946` vs `weather.js:132-138`). Take `level.js`'s
    values, record the diff, and **wire the rain-occlusion probe (camera inside each
    volume for 120 frames → zero streak instances) BEFORE this step, not after.**
  - **L3:** `stats().programs` at end of prewarm **unchanged** (this is the proof that the
    value-free `customProgramCacheKey` argument holds), and `stats().textures` **read, not
    assumed** — a `Map` keyed wrong silently doubles it.
  - **L4:** full battery + perfprobe all three phases (sky and reflect are draw-call and
    program adjacent — run it, don't infer it).
  - **L5:** `bootcheck.py` exit 0 + full battery + one playprobe per persona. The teardown
    path is where `attach(bridge)` handlers and `onBeforeRender` hooks leak.
  - **L6:** throwaway office blockout — `probe_props --map <id>` exit 0, contract gate
    exit 0, boots to a playable state, one battery iteration produces PNGs at all (**not**
    that they score). Then delete it.
- **Unblocks:** all arena carving, all biome authoring, PVP map rotation.

---

### PHASE 3 — LANTERNWALK + LOCAL PVP *(the first playable PVP, with zero netcode)*

This is the highest value-per-risk item in the plan, and neither source document quite
claims it: **a complete, playable PVP mode ships before one line of network code exists.**
`pvp_design` §8.3 treats bots-vs-bots as a test; it is a shippable feature.

- **Ships:** Skirmish and Foothold, 4v4, human + 7 bots, on LANTERNWALK. The arena layer,
  the spawn director, the match-rules layer, the PVP shell, and the PVP tuning fork.
- **Lanes:** `N3` spawn-director (THREE-free, Node-testable — the highest-value single
  lane), `N2` match-rules (`match.js` + `modes/{skirmish,foothold}.js`), `N4` pvp-shell
  (lobby / scoreboard / PVP HUD on A10's primitives), `N5` arena lane for LANTERNWALK
  (the 10 carve edits E1–E10 of `pvp_design` §3.3), plus `G3` tuning fork and `G4`
  lighting profile (both small).
- **Acceptance (measured):**
  - **Balance fork gates** — `sim.selftest.cjs --pvp`: every STK row in `pvp_design`
    §4.1; `steadyMult === 1.0` under PVP tuning; **no PVP TTK below 220 ms**; HP is 110
    for every actor **including bots** (R16 across teams); and the SP table
    **bit-identical** to the untuned `WEAPONS` export. The Warden far row
    (5 × 22 = exactly 110) is asserted explicitly so a future edit cannot silently turn
    a 320 ms kill into a 400 ms one.
  - **Spawn director** — the real pass/fail: bot-only battery, 20 seeds, **zero spawn
    deaths within 2.0 s of spawning**; median `spawnStress` ≤ 0.5; every match ends;
    `stuckBotSeconds == 0`.
  - **Per-map arena gates** (`pvp_design` §9.1, now the standard for every arena):
    loop probe (nav path from every spawn point to every other and to every Foothold
    zone; no path traverses the same corridor cell twice); balance probe (spawn-centroid
    distance ±8%, cover count ±15%, longest sightline ±10 m, per-zone rotation time
    ±2.0 s); spawn-point validity (30–50 points, nav-walkable, ≥2.0 m clearance, ≥6 per
    cluster over ≥250 m², ≥8 m forward view); **boundary probe — raycast every 2 m along
    the arena edge, assert a renderable within 0.5 m** (no invisible walls, ever).
  - **Visual gate:** LANTERNWALK's own 5-shot battery **in the PVP lighting profile**,
    at the full ship bar (see Part 5 — the PVP profile is a separate scored pass).
  - **Perf:** the new worst case — 8 actors visible, 4 shooting, PVP lighting profile,
    the map's densest space. `programs delta == 0` must survive the faction rim tint,
    which must be **the same material with a uniform**, never a second material.
- **Unblocks:** the whole PVP mode design is now falsifiable by playing it. If Skirmish
  is not fun here, no objective layer and no netcode will save it — and we find that out
  before spending the netcode budget.

---

### PHASE 4 — NETCODE TO TWO REAL HUMANS *(`netcode.md` N0–N3)*

- **Ships:** two humans, room code, Skirmish, LANTERNWALK, host-authoritative, with
  prediction, interpolation and lag compensation.
- **Lanes:** `N0` protocol + loopback + `net.selftest.cjs` (pure Node, no browser);
  `_harness/netprobe.py` (**entirely new — no multi-client harness exists in this repo;
  the closest thing anywhere drives two pages but never two clients of one match**);
  `N1` session/transport/lobby; `N2` prediction + reconciliation; `N3` interpolation +
  rewind. The harness lane is independent of the sim work and starts immediately.
- **Acceptance (measured; these numbers replace every estimate in `netcode.md`):**
  - **N0:** 100,000 randomized 12-actor snapshot round-trips — position error ≤ 1 cm,
    yaw ≤ 1.4°, zero flag/HP/weapon corruption. Two in-process sims, 10,000 ticks, ideal
    link: **state hashes identical at every 60th tick**. At 50/100/200 ms + 20 ms jitter
    + 2% loss: reconciled local-actor position error **p95 ≤ 5 cm, max ≤ 25 cm**, replay
    cost **p99 ≤ 1.0 ms**.
  - **N1 — done = two real browsers, two real players, a finished match.** Guest kills
    host and host kills guest, each confirmed on **both** clients; both scoreboards agree
    at match end (any disagreement = fail); zero page errors either side;
    `__FFG_FALLBACKS__` empty on both. **Reported, not asserted:** median/p95 RTT,
    snapshot inter-arrival p95, billed Supabase msg/s (must be < 20 with RTC up),
    bytes/s each way.
  - **N2:** predicted-vs-authoritative **p95 ≤ 5 cm** over a 60 s scripted run at 100 ms;
    **mispredictions/min ≤ 6** at 100 ms / 2% loss; **zero hard snaps (>1.5 m)** in 60 s
    of legal movement *including slides, mantles and jumps* — the verbs bots don't have
    are exactly where prediction breaks first; guest p99 ≤ 33.3 ms with the net loop live.
  - **N3:** hit-rate ≥ **0.95 × offline baseline at 50 and 100 ms** (200 ms reported, not
    asserted — the rewind clamp legitimately costs hits there); behind-cover death
    distribution reported by `rewindMs` bucket with the only assertion being **no death
    exceeds the 250 ms clamp**; remote animation parity ≥ **95%** of sampled frames.
  - **The netprobe must defeat the rAF gotcha or it will report perfect netcode on a link
    it never exercised:** `--disable-background-timer-throttling`,
    `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`;
    separate browser *contexts* with explicit `--window-position`; `stepFrames` for
    deterministic assertions and the **real rAF loop** for every timing assertion.
- **Unblocks:** Phase 6 scale-up; and it produces the first honest capacity numbers this
  project has ever had against this transport.

---

### PHASE 5 — BIOME #2: THE UNDERCROFT + THE CISTERN *(LEVEL/ART track; parallel with Phase 4)*

- **Ships:** M6 mission locale + the CISTERN arena (4v4 CQB, no daylight).
- **Why second overall and first among biomes:** it is the map with the fewest new
  variables — no sky, no weather, no LOD, no aerial perspective, no planar pass required,
  no new render technology — and a lighting model identical to the one already shipping.
  If the refactor is proven here, every later biome is art plus a preset. `campaign_biomes`
  §6 is right and the ruling stands: *"If we prove it on the forest, we will be debugging
  the map registry and the foliage instancer at the same time, and we will not know which
  one is lying to us."*
- **Lanes:** ~2.5 lane-equivalents — one level lane (layout/colliders/props/materials +
  the brick-vault trim sheet), partial A6 (no sky preset needed; fog block + the
  weapon-light spot lease), partial A9 (underground bed + the reverb set that is half this
  biome's atmosphere), A2 (mission data, spawns, scenarios), A11 (shot battery poses +
  scenario seeds), N5 (the CISTERN carve).
- **Acceptance:** the full per-map definition of done (Part 5), **twice** — once in the
  campaign profile for the mission map, once in the PVP profile for the arena.
- **Unblocks:** the biome pipeline itself. Every later biome is cheaper because this one
  paid the first-time cost of the kit / biome / map three-way split.

---

### PHASE 6 — SCALE TO 8 HUMANS *(`netcode.md` N4–N5)*

- **Ships:** 4v4 with bot backfill on by default, host migration, relevance culling,
  Supabase fallback proven, and the 6v6 unlock measurement.
- **Acceptance (measured):**
  - **N4:** kill the DataChannel mid-match — the match **continues** on Supabase, no page
    error, no scoreboard divergence, rate ladder engaged. Across a 5-minute 4-player match
    with RTC down entirely, peak billed Supabase msg/s stays under `100/H`. 10% loss for
    30 s: no desync, scoreboards still agree.
  - **N5:** 8 clients complete a full match, scoreboards agree on all 8. Kill 3 guests:
    bots take over within **3 s**, match still ends, `stuckBotSeconds == 0`. Kill the
    host: migration completes in **≤ 2 s**, score survives, match ends normally on every
    surviving client. Host perf under full load: **sim tick ≤ 3 ms, AI ≤ 1.5 ms,
    p99 ≤ 33.3 ms**. Culling on: a guest's snapshot contains **no actor it has neither
    seen in the last 1 s nor been damaged by in the last 2 s**, with N3's hit rate
    unchanged.
  - **The 6v6 unlock gate (X3):** 12 actors, measured host uplink sustained ≥ 33 KB/s
    *and* host p99 ≤ 33.3 ms *and* AI ≤ 1.5 ms, on that map. Pass → 6v6 flag on for that
    map. Fail → that map stays 4v4, permanently, and that is a fine answer.
  - **A probe nothing tests today:** a 6v6 that mass-disconnects into 12 bots. Must be run.
- **Unblocks:** PVP launch.

---

### PHASE 7 — BIOME #3: THE GLASS FLOOR + GLASS FLOOR / ATRIUM arenas

The owner's named biome #1 (**office**), and `campaign_biomes` ranks it the best
payoff-per-cost in the set: zero new render technology beyond the shared LIGHTCOOKIE,
the Kenney furniture kit verified on disk, and the existing planar-reflection pass
re-masked from the plaza to the floor plate at the same budget.

- **Ships:** M4 mission locale, plus **two** arenas (GLASS FLOOR 4v4/6v6 and THE ATRIUM
  4v4) — the second carve is a different rectangle of a map that already exists.
- **Named risk with a named probe:** D1. An interior legitimately lit by its hemisphere is
  one step from `visual_target`'s ambient-only → max 3 hard cap. It survives only if all
  three are probe-verified: the slat cookie gives visible directional structure, the
  troffer pool-decals give local floor structure, and the server room / stairwells /
  alarm-state floor are **genuinely dark**. **Put the calibration-card probe in the
  open-plan bay, not the lobby.**
- **Prerequisite:** LIGHTCOOKIE (G7) ships in Phase 2's tail or Phase 5 — before M4, M3
  and M5, all three of which consume it. One shader feature, three biomes, no added lights,
  one extra `customProgramCacheKey` bit.

---

### PHASE 8 — BIOME #4: DRYDOCK SEVEN + DRYDOCK arena → **PVP LAUNCH**

- **Ships:** M2 mission locale + the DRYDOCK arena. **The four-map launch roster is now
  complete: LANTERNWALK · THE CISTERN · GLASS FLOOR · DRYDOCK.** Foothold ships across the
  roster. Blackline ships if and only if its gate passes.
- **Blackline gate (empirical, `pvp_design` §9.3):** median dead-time per round **≤ 35 s**
  and no round exceeds 1:45, in both the two-human and bot-fill batteries. Fail → Blackline
  ships in the first update, **spec unchanged**, because the fix would be map/rules tuning,
  not a redesign.
- **Why Drydock is the launch closer:** it proves "outdoor but still dark" — the half-step
  between fully-controlled M1 lighting and a real sun — while reusing the wet path
  wholesale, and it builds the alpha-lattice material class that M7 needs later. Going
  straight from interiors to a bright forest skips the rung.

---

### PHASE 9 — MERIDIAN ASH + ASHFALL *(the cheapest content in the entire plan)*

~95% reuse: identical geometry, identical colliders, a new `LIGHT_POLES` data set (8 fire
pools), a smoke-sky preset, an ash weather preset, ~12 damage props, 8 decal variants, a
fire ambient bed. **No new textures, no new technology, no new characters**, and
deliberately no dependency on M5's daylight tech.

- **The one thing that can make it fail, stated as a gate:** *"If the player can walk
  mission 1's route unchanged, the reprise has failed."* The collapsed facade must close
  the alley dog-legs, the plaza crater must open a sightline that never existed, and the
  arcade upper floor must become impassable. Acceptance is a nav-diff assertion against
  M1, not a screenshot.
- **Schedule note worth acting on independently:** ASHFALL does not need the M8 mission.
  It is a lighting-and-dressing variant of shipped geometry and **can be pulled forward
  into the PVP roster at any time** if the roster needs a fifth map early.

---

### PHASE 10 — HOLLOWMERE + HOLLOWMERE COMPOUND / DEADFALL *(owner's named "forest")*

Carries the expansion's single largest new render subsystem: the foliage instancer, the
two-frequency vertex wind shader, and card LOD. **No vegetation asset pack exists on disk
[verified by `campaign_biomes` Part 0 and re-flagged in Part 7 below].**

- **Perf is the gate before any D-score.** Alpha-test foliage is the worst overdraw case
  in the catalogue on Iris Xe. Mandatory and non-negotiable: ≤12 cards per tree; alpha-test
  (`alphaTest 0.5`, `depthWrite true`), never alpha-blend; LOD drops *cards* before it
  drops *trees* so silhouette count survives; the whole layer scales with the quality
  preset; and **perfprobe's combat phase runs inside the densest stand, not at the
  compound.**
- **Two arenas for one carve's work:** the compound (6v6, buildings anchor + forest flanks)
  and DEADFALL (4v4, pure forest concealment duel, the same instances rescattered).

---

### PHASE 11 — SABLE RUN + SABLE PIT / THE CROSSING *(owner's named "outdoor")*

The most expensive and highest-risk biome in the set, and the only one that requires a
sim-side change (G9 heightfield — sequenced after S1 per X13).

- **Three critic dimensions have their worst case here simultaneously:** D1 (key:ambient
  under a soft sky), D3 (a 120 m tiled ground plane), D4 (aerial perspective at daylight
  densities). No other biome stacks three.
- **The commitment that makes it survivable: BROKEN OVERCAST, never clear noon.** A clear
  60° sun demands crisp long shadows a 1024 map cannot deliver across 120 m (~12 cm/texel)
  and flattens every material we own. This is a defensible photographic reference, not a
  cop-out, and it is binding.
- **Delivers the portfolio's long band at last** — SABLE PIT, up to ~140 m — which is
  where Corvus finally gets a home map. Plus THE CROSSING (4v4 small map) from the same
  locale.

---

### PHASE 12 — PALE HARVEST + arena *(the title pays off)*

Cheap **only if** Phase 11 shipped: a whiteout sky is a degenerate daylight sky. Reuses
the weather instancer (new velocity/size/blend), M2's alpha-lattice class for the radar
mesh, and M6's practical model for the bunker interiors.

- **Stated up front rather than discovered in iteration 3:** in a whiteout there are
  almost no shadows and the hemisphere carries the frame, so 4:1 key:ambient is nearly
  unachievable *in the open*. The ratio is carried by bunker interiors, structure lee
  sides, and the warm-island practicals — **so the D1-scoring battery frames must be
  composed to include one of those.**

---

### PHASE N6 — AUTHORITATIVE REFEREE *(optional; owner spend decision; not scheduled)*

Deferred, but designed-for from day one: the protocol in `netcode.md` §3 is written so
that moving authority from the host's browser to a Cloudflare Durable Object running the
same sim module changes the transport and the trust model but **not the message shapes**.

**First task of the phase, before any code: verify current Durable Object pricing and CPU
accounting by running `core/sim/sim.selftest.cjs` in a DO and producing a measured
cost-per-match. Do not design against a remembered price.**

Only N6 removes host advantage, host migration, host cheating, and the ratings blocker.

---

## PART 4 — BIOME BUILD ORDER

`campaign_biomes` ranks by payoff ÷ cost. Cross-checking that ranking against arena
quality does not change the order — which is the strongest evidence the ranking is right.

| Order | Biome | Payoff÷cost | Critic risk | Arenas produced | Arena value | Phase |
|---|---|---|---|---|---|---|
| 1 | **M6 The Undercroft** | 2.67 | LOW | THE CISTERN | High — the fast brutal small map the roster needs, and the only true CQB/no-daylight slot | 5 |
| 2 | **M4 The Glass Floor** | 1.80 | LOW–MED | GLASS FLOOR + THE ATRIUM | Highest — best Blackline map in the set, two arenas for one carve's work, owner-named | 7 |
| 3 | **M2 Drydock Seven** | 1.60 | LOW | DRYDOCK | High — the only launch map with real verticality *and* the one long lane | 8 |
| 4 | **M8 Meridian Ash** | 4.00 | LOW | ASHFALL | Free — M1 geometry, fire-lit; pullable forward at any time | 9 |
| 5 | **M3 Hollowmere** | 1.13 | MED–HIGH | COMPOUND + DEADFALL | High, owner-named ("forest"); two arenas | 10 |
| 6 | **M5 Sable Run** | 0.70 | HIGH | SABLE PIT + THE CROSSING | High, owner-named ("outdoor"); delivers the long band and Corvus's home | 11 |
| 7 | **M7 Pale Harvest** | 1.33 | MED | PALE HARVEST | Medium — whiteout makes a big map play small, a genuinely novel read | 12 |

**Note the one deviation from raw payoff÷cost:** M8 Meridian Ash ranks #1 at 4.00 but
ships 4th. That is deliberate — Ashfall is an *arena* the roster can have early and cheaply
(and the plan says so explicitly in Phase 9), but Meridian Ash is a *finale mission* and
shipping the campaign's ending before its middle is incoherent. The arena and the mission
are decoupled precisely so we can take the cheap half early.

**The owner's three named biomes arrive 2nd (office), 5th (forest) and 6th (outdoor).**
That is not the order he named them, and `campaign_biomes` prices the alternative honestly:
leading with M4 → M3 → M5 means debugging the map registry concurrently with the foliage
instancer and the heightfield — the two highest-risk technologies in the expansion — and
wave 1 approximately doubles in duration. **Recommendation: take the cheap order. The
owner's #1 named biome still arrives second, and it arrives working.** This is owner
decision D6 in Part 8.

### Hard dependencies between biomes (do not reorder across these)

- **LIGHTCOOKIE (G7) before M3, M4 and M5.** One world-space multiply channel serving
  canopy dapple, venetian slats and cloud-shadow bands. Build it once, in the
  generalization phase.
- **M2's alpha-lattice material class before M7's radar mesh.**
- **M3's vertex-wind shader before M5's scrub.**
- **M5's daylight sky preset before M7's whiteout** (a whiteout is a degenerate daylight
  sky — if M5 shipped, M7 is cheap; if not, M7 pays for it).
- **S1 before G9 (heightfield), G9 before M5** (X13).
- **M8 depends on nothing beyond the L1 migration** — deliberately fire-lit dawn rather
  than daylight, so the finale carries no technology dependency.

---

## PART 5 — HOW THE QUALITY BAR EXTENDS *(the expansion may never regress v1)*

The v1 gates (BUILD_PLAN Part 5) apply to every new map and to PVP, unchanged. These are
the extensions, and they are FAIL-class.

### 5.1 The ship bar is per map, never averaged

> **Every dimension ≥ 8 AND mean ≥ 8.5 AND blind verdict at least "borderline" from EVERY
> critic.** ≥2 cold critics per scoring iteration, **3 on the ship decision**. A single
> confident "no" from any critic blocks ship.

Applied **independently per map**. Averaging maps would let a strong Meridian carry a weak
forest — precisely the "averaging-away a weak dimension" the frozen bar forbids. The
plateau STOP rule (BUILD_PLAN §5.6) also applies **per map independently**: two consecutive
iterations with no improvement in any scenario's mean → stop, escalate through the session
outbox with the trend table, the three worst tells, and an honest assessment of what the
plateau is. **Never both-loop.**

### 5.2 A map that is both a mission and an arena is scored TWICE

**This is an addition neither source doc makes explicitly, and it is load-bearing.** The
PVP lighting profile (X10) changes the fog density ×0.7, raises the key and the practical
count, raises the darkest-zone floor to 18%, kills flicker and bans dynamic light events.
That is a materially different frame. **A map passing the bar in the campaign profile does
not prove the arena passes.**

Ruling: the mission map's battery is shot in the campaign profile; the arena's battery is
shot in the PVP profile; **both must pass the full bar independently.** LANTERNWALK's
Phase 3 battery is a PVP-profile battery even though its geometry already passed in the
campaign profile.

### 5.3 Battery vocabulary stays frozen; only poses change

Scenario ids stay the R10 vocabulary (`S1`–`S9`, `C1`) across every map, because they
encode **what the frame must show**, not where it is shot. S3 is "quiet establishing wide"
on every map; only the pose changes. A map may mark a scenario **n/a by design** (an office
map has no S5 sky/horizon frame) — and **the critic must be told it is absent by design,
never merely missing.**

Output namespaces to `_shots/<mapId>/iterNN/`; the never-overwrite guard (exit 3) becomes
per-map so map 2's iteration 1 cannot collide with map 1's; `scores.jsonl` rows gain a
`"map"` field and a `"profile": "campaign"|"pvp"` field. R27's format is otherwise
unchanged.

### 5.4 Regression coverage across N maps

Full battery on the map under active iteration; a **3-shot regression subset (S1 / S3 / S4)
on every finished map, every iteration**. A regression subset that moves triggers a full
battery on that map. This is what catches a shared-kit or biome change silently degrading a
map that already shipped.

### 5.5 The biome-coherence pass (new, non-scored)

The frozen D1–D10 scorecard is not touched. A **separate, non-scored** pass shows a critic
one frame from each map and asks: *do these read as the same game?* Per-map scoring alone
cannot catch eight maps that each pass and collectively look like eight different games.

### 5.6 Per-map headless gates

`probe_props --map <id>` / `--all` (**CI meaning: adding map 5 cannot break map 2
silently**), with the new checks the map format makes possible: `real:true` practical count
≤ 8 (a 9th is a build failure, not a console warning); every `props[].kind` in the kit ∪
biome vocabulary; every ground `kind` bound by the biome's `groundBinding`; every decal kind
in `dressVocab`. Plus the nav gate, the referential contract gate per (mission, map), and —
for arenas — the loop / balance / spawn-validity / boundary probes of Phase 3.

### 5.7 Per-map perf gates

The Part 5.2 budget is per-map, and each map declares its **own named degradation path**
(Meridian's is the planar pass auto-off at the dynres floor; a forest's is instance-count
scaling). PVP adds a new worst case: **12 actors visible, 6 shooting, PVP lighting profile,
the map's densest space.** Two named risks: `programs delta == 0` must survive the faction
tint (same material + uniform, never a second material), and the ≤320 median draw budget
must survive the most open arena in the roster.

### 5.8 Ship blockers, unchanged and absolute

`__FFG_FALLBACKS__` non-empty · any contract-gate throw · probe_props failure · any selftest
non-zero · `game_meta.json` publish flip without owner OK. **Per map.**

### 5.9 Netcode gates are measured numbers, not code existence

Every phase in Part 3's SIM/NET track names the number it must produce. The plateau rule
applies to netcode phases too, and `netcode.md` §6.3 names the specific seductive failure
mode: *"endless smoothing constants that make a graph prettier without making the game
better."* The gate is the measured number in the phase's acceptance test.

---

## PART 6 — WHAT THIS COSTS

In agent-lane terms (one lane ≈ one owner working one file set to a gate), and with the
dependencies that actually bind.

| Block | Lanes | Notes |
|---|---|---|
| Phase 0 (finish v1) | already staffed | **Unknown remaining — see Part 7 risk R1.** No scored critic iteration is on record [verified V7], so there is no basis to estimate how many remain. |
| `S1` sim generalization | **1 lane, the largest single item** | Blocking. Acceptance is binary: every existing test passes with zero edits. |
| `L1` level migration (L0–L6) | **~2 lane-sessions** | L2 is 9 gated sub-steps and is 2–3× any other sub-phase. L4 is parallelisable (5 independent one-commit changes). |
| PVP core (N2 rules, N3 spawns, N4 shell, G3, G4) | **~3 lanes** | N3 is the highest-value single lane and is pure Node-testable logic. |
| Netcode (N0, netprobe, N1–N3) | **~3–4 lanes** | `netprobe.py` is entirely new work — no multi-client harness exists in this repo. |
| Netcode scale (N4–N5) | **~1–2 lanes** | Gated on host CPU headroom being measured first. |
| Per arena carve | **~1 lane each** | Carving is level design, not configuration. |
| Per biome | **~2.5 lane-equivalents + one full critic loop** | The critic loop, not the geometry, is the schedule driver. |

**Cost is very unevenly distributed across biomes** and the plan exploits that: M8
(Meridian Ash) and M6 (The Undercroft) are roughly **half** a normal biome each; M4 and M2
are normal; M7 is normal-plus *and only if M5 shipped first*; M3 carries the foliage
subsystem; M5 is roughly **double** a normal biome and carries the only sim-side change.

**Rough total: on the order of 35–45 lane-equivalents plus 8 independent critic loops** —
and the second number, not the first, is the schedule. **Gated spend for the plan as
written: $0**, with two conditional exceptions (D4, D5 in Part 8).

---

## PART 7 — SCOPE HONESTY

### 7.1 The riskiest assumptions, ranked

**R1 — We have no empirical critic-loop iteration count. [verified V7]**
The expansion's schedule is dominated by 8 per-map critic loops, and `scores.jsonl` does
not exist, so we have never measured how many iterations one map takes. Every schedule
statement in this document inherits that uncertainty. **Phase 0's real output is not just a
shipped map — it is the first data point on the cost of the loop that prices everything
else.** Treat the Phase 0 iteration count as the calibration constant for Parts 3 and 6.

**R2 — Every Supabase rate number in this plan is a hypothesis.**
`netcode.md` §1.3 marks the concurrency cap, the monthly message quota, the 100 msg/s
per-connection ceiling, the per-receiving-subscriber billing unit and the drop-not-throttle
over-rate behaviour as **[unverified]** — all are code comments, never measured. Worse, the
codebase disagrees with itself: the pipeline master declares `eventsPerSecond: 12` and
last-circle's copy declares 30 with a comment that 12 *"has been under-declaring by roughly
half since the game shipped, which also made every capacity estimate against this transport
~2x optimistic."* **Phase 4's N1 acceptance measurements are the first real numbers, and
this plan gets rewritten against them.**

**R3 — Host CPU under full load is unmeasured, and it is the 6v6 kill switch.**
The 3 ms sim / 1.5 ms AI / 33.3 ms p99 budget was written for single-player. In PVP the
host runs 12 actors + all AI + its own render + 11 snapshot streams. If it does not hold,
6v6 dies and 4v4 may need a cut. Measured in Phase 6, and X3 already assumes the pessimistic
answer.

**R4 — `stepLocalActor` replay at ≤1.0 ms is unproven and load-bearing.**
If a 15-tick replay is not that cheap, client prediction is not viable, and prediction is
the single lever that makes the mode feel good at any ping. Measured in N0 — the cheapest
possible place to find out, which is why N0 is first on the netcode track.

**R5 — No vegetation asset pack exists on disk.**
Verified absence in `campaign_biomes` Part 0. The forest's hero asset class does not exist.
Trees are either generated procedurally behind the doctrine §7 visual-quality gate, or a
gated asset spend. This is the single reason M3 is expensive, and it is an owner decision
(D5) rather than a design one.

**R6 — Two character bodies across eight environments will read thin.**
A harbour crew, a forest recon element, corporate security and an arctic garrison are four
distinct silhouettes; tinting `soldier.glb` four ways will be noticed. Cheapest mitigation
is per-biome **attachment** sets (helmets, packs, hoods, parkas) on existing bodies. Owner
decision D4.

**R7 — Payload and VRAM at eight maps is unproven.**
The ≤6 MB-to-menu and ≤+5 MB-per-mission budgets were sized for one map. `level_architecture`
§3.3 is explicit: two biomes resident is up to 240 textures against a ≤120 gate, **so map
switch must dispose the outgoing biome.** In-session PVP map rotation is what makes disposal
mandatory rather than optional (owner decision D7).

**R8 — Daylight at the AAA bar is the least certain visual claim in the plan.**
`level_design` §0 rejected daylight for v1 on four stack-specific grounds — 1024 shadow cap,
no baked GI, no GTAO/TAA, fog-as-perf-tool fighting the premise — and **none of those has
changed.** M5's broken-overcast commitment is a mitigation set, not a refutation. If M5
plateaus twice, the honest exit is escalation per §5.6, and the honest fallback is that
"outdoor" is already proven twice without a sun (M2 blue hour, M7 whiteout).

### 7.2 What may NOT be achievable in a browser — stated plainly

1. **A cheat-free public match. Not achievable, ever, without N6.** Host authority (X1)
   makes speed, teleport, damage inflation, fire-rate and god-mode *impossible by
   construction*. It does **not** stop an aimbot — a perfect look direction is a legal
   input — and it does **not** stop a malicious host, who can do anything. Relevance culling
   starves a downloaded ESP script of data but does not stop a modified client. **The honest
   framing: room-code matches among friends are competitive-grade; public quick match is
   casual-grade, permanently.** Store copy must say "play with friends," not "competitive"
   (doctrine §6: store copy is a contract).
2. **Player count: 8 humans is the ceiling, and 12 actors is a stretch bound by one
   player's home upload.** Not a hand-wave — the numbers: 4v4 costs the host ~21 KB/s
   sustained uplink and is comfortable; 6v6 costs ~33 KB/s and is marginal on many home
   connections; anything above 12 requires N6. **The honest sentence for the owner: netcode
   limits us to 8 humans at this quality, shipping at 4v4, with 6v6 as a per-map unlock
   only where one player's upload and CPU measurably carry it.**
3. **Sub-frame fairness between two players at different pings. Not achievable.** There is
   no referee at the network's midpoint. Someone always wins the tie, and **the host
   experiences none of the latency at all** — in an 8-player lobby, one player is having a
   LAN experience and seven are not.
4. **Matches above ~250 ms RTT are not playable at this TTK.** Blackridge's TTK band is
   200–320 ms, *comparable to the round trip*. At 200 ms, "I died behind cover" becomes a
   routine and **factually correct** observation — that is the price of favour-the-shooter,
   and it is the same price CoD pays. Beyond 250 ms the rewind clamps and shots at moving
   targets miss outright. **Matchmaking must refuse to pair there and say why.** Region-blind
   global matchmaking on a browser game will produce these matches, so an RTT gate before
   match start is part of the design, not polish.
5. **NAT traversal without TURN. Some pairs will never connect.** STUN only; a blocked pair
   never opens a DataChannel and rides the slow relay, and above 3 such guests the lobby
   closes. Residual risk accepted (owner decision D2).
6. **Hero forest foliage at the bar on Iris Xe is the top perf risk in the expansion.**
   Alpha-test overdraw is the worst case in the catalogue and it is gated *before* any
   D-score.
7. **A meaningful ladder. Not achievable before N6**, and this plan ships without one on
   purpose (X12) — which is simultaneously the most effective free anti-cheat measure
   available, because there is nothing to farm.

### 7.3 What this plan deliberately does not do

- It does not resize the 14-light pool for any biome, ever. Daylight maps waste 6–8 spot
  slots and that is an **accepted, documented cost** — changing the count is a
  shader-permutation key worth 640–900 ms of recompiles across every map.
- It does not add attachments, perks, killstreaks, FFA, flag-carry modes, killcams, or
  aim assist. Each is named as excluded so nobody "finds" them missing.
- It does not put moving geometry (doors, lifts, water level) in any arena. A door state is
  replicated state; glass shatters to a decal and **stays geometry**.
- It does not build code obfuscation, anti-debugger traps, or heuristic aim analysis.
  Against a client whose full source ships to the attacker these are security theatre that
  cost build time and break the harness.

---

## PART 8 — WHAT THE OWNER MUST DECIDE

Nine genuine decisions — scope, spend, priority. One recommendation each. None of these
blocks Phase 0.

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| **D1** | **Ship PVP at 4v4, or hold for 6v6?** | **4v4.** It is comfortable on both unmeasured axes; 6v6 unlocks per map after the Phase 6 measurement. Holding the whole mode for 6v6 bets the launch on one player's home upload. | Phase 3 mode config |
| **D2** | **Paid TURN relay?** | **No.** Ship without it, measure the fallback rate in Phase 6, revisit only if it exceeds ~10% of peers. The design works without it; it just excludes some pairs. | Nothing — bounds who can play |
| **D3** | **Is a paid Cloudflare Workers plan (N6 referee) ever on the table?** | **Answer needed, not now but before store copy is written.** If never: host advantage and an unranked mode are permanent design facts and the marketing copy must say "play with friends." Recommend answering "not for v1, revisit after launch." | Store copy; ratings forever |
| **D4** | **Meshy spend for per-biome character variety?** | **Not yet.** Ship per-biome *attachment* sets (helmets, packs, hoods, parkas) on the two existing bodies first — $0. Revisit after biome 3, when we can see whether it actually reads thin. | Nothing yet |
| **D5** | **Asset spend for forest vegetation (M3 has no pack on disk)?** | **Pre-authorize a capped spend now** rather than mid-wave. M3 is an owner-named biome and it is the one biome whose hero asset class does not exist; discovering the procedural route fails the gate *after* the wave starts costs a stall. Alternative: accept M3 slips behind M5/M7. | Phase 10 |
| **D6** | **Cheap-first biome order, or the owner's three named biomes first?** | **Cheap-first** (Undercroft → Glass Floor → Drydock). The owner's #1 named biome (office) still arrives second, and it arrives working. The named-first swap doubles wave 1 by debugging the map registry concurrently with the foliage instancer and the heightfield. | Phases 5–12 ordering |
| **D7** | **Must PVP rotate maps without a page reload?** | **Yes — build the teardown/dispose path.** A reload between rounds is a bad player experience, and disposal is required by the VRAM budget at biome 3 regardless. This answer sizes L3 and L5. | L3 / L5 scope |
| **D8** | **Blackline in the launch build or the first update?** | **Let the gate answer** (median dead-time ≤ 35 s per round). Default to update; the spec does not change either way. | Phase 8 scope |
| **D9** | **Does PVP launch before the campaign expansion completes?** | **Yes.** PVP launches on the four-map wave-1 roster (Phase 8) while M6/M4/M2 are still being missionized. Arenas and missions are decoupled by design (X9), so this costs nothing. | Phase 8 framing |

**Unchanged and not a decision:** the `game_meta.json` publish flip stays the owner's call,
per the established FFG rule. PVP does not change that.

---

## PART 9 — FREEZE AMENDMENT REGISTER *(A0 approves as ONE block before any lane starts)*

Consolidated from all four docs. No lane codes against any of these until A0 signs off.

**Sim block (S1 — must be approved before Phase 1):**
1. `sim.state` shape: `state.actors[]` with a `kind` field; `state.player` retained as a
   **live alias** of `state.actors[myIndex]` so single-player and every existing probe are
   untouched (architecture §3.5.1). *(N-R1, N-R2, X4, X5)*
2. `stepPlayer` → `stepActor(sim, actor, cmd, dt)`; additive export
   `stepLocalActor(sim, actor, cmd, dt)` — movement + weapon machine only. *(N-R5)*
3. `core/rng.js` contract: per-shot spread becomes a pure function of the shot,
   `mulberry32(hash(seed, shooterId, shotSeq))`. **Must be verified not to change
   single-player TTK/spread probe results.** *(N-R3)*
4. `stepActorWeapon` emits view events for all local-visible actors, not only `isP`.
   Additive; no new event types. *(N-R4)*
5. Additive fixed-size snapshot/restore for prediction and rewind rings —
   `sim.snapshot()` (a `JSON.parse(JSON.stringify(state))`) is banned from the hot path
   against the "0 allocations in any update()" budget. *(N-R6)*
6. `applyDamage` `who` accepts player ids; friendly-fire gate. *(N-R7)*
7. Mission/mode split: `mission.tick` is campaign-only; PVP modes under
   `core/sim/modes/`. The `phase` enum gains PVP states. *(N-R9)*
8. `team` field on every actor; `squad.js` per team; token caps per human target. *(X5)*

**Level block (L1 — must be approved before Phase 2):**
9. `buildLayout(mapData, seed)`; `buildColliders(layout)`; `makeMaterials(biomeId, ctx)`;
   `bakeNav(colliders, opts)` gains `zoneAmbient` + `links`. `buildLevel` and `buildProps`
   signatures unchanged. *(level_architecture §2.4)*
10. **R24 amended:** the global 15-key node literal becomes per-map node sets with a
    referential contract gate and a per-map `expectNodes` fixture pinning Meridian's 15.
    `probe_props.mjs`'s `R24_KEYS` array is deleted. *(X8)*
11. Surface vocabulary extended: `needles`, `water_shallow`, `snow` added to the frozen
    `concrete|metal|dirt|wood|glass` set shared with fx and audio. **Every biome must
    export all six original keys whatever they mean locally** — this is what keeps
    `fx/impacts.js` and `audio/sfx.js` biome-blind at zero cost. *(campaign_biomes G8)*
12. Silent truncation of a 9th `real:true` practical (`lighting.js:577-579`) is promoted
    from a console warning to a `probe_props` build failure. Pool size itself is
    **never** amended. *(X10)*
13. Rain-occlusion volumes de-forked to a single source in the map; the four disagreeing
    ceiling heights resolved to `level.js`'s values, with the diff recorded. *(L2 step 3)*

**Harness block:**
14. `scores.jsonl` rows gain `"map"` and `"profile"` fields (R27 otherwise unchanged);
    shot output namespaces to `_shots/<mapId>/iterNN/`; the never-overwrite exit-3 guard
    becomes per-map; a scenario may be marked **n/a by design**. *(§5.3)*
15. `probe_props.mjs` gains `--map <id>` / `--all`; the contract gate loops over
    `content/index.json` missions resolving `mapId` → map → colliders. *(§5.6)*
16. New: `_harness/netprobe.py`, multi-client, with the three anti-backgrounding launch
    flags and the dual `stepFrames` / real-rAF measurement modes. *(Phase 4)*

**New file, not an amendment:**
17. Blackridge vendors `games/blackridge/core/net/ffg_netplay.js` with its own
    `eventsPerSecond`, per the established per-game-copy convention. **Editing the
    pipeline master would silently change 13 other games.** *(N-R8)*

---

## PART 10 — RULES THIS PLAN BINDS ITSELF TO

1. **Phase 0 first, absolutely.** Not a priority call — a correctness constraint (Part 2).
2. **Every rate, budget and capacity number about the network is a hypothesis** until
   Phase 4's N1 measures it on the live transport. The codebase's own estimates were ~2×
   wrong for the entire shipped life of Last Circle.
3. **No phase is done because code exists.** Done = the measured number in that phase's
   acceptance test, observed in the live system (doctrine §5).
4. **Verdicts never round up.** A phase that hits 4 of 5 acceptance criteria is reported as
   partial, with the failing number printed verbatim.
5. **The ship bar is per map and is never averaged.** No "multiplayer maps can look worse"
   clause exists, and none will be added.
6. **Do not copy client-authoritative damage.** X1 is the reason it was rejected on
   purpose; if a future agent finds `hitYou` convenient, this line is why not.
7. **The 14-light pool is never resized.** For any biome, in any profile, forever.
8. **Every gated spend goes to the owner before it is incurred.** Total unavoidable spend
   for this plan as written: **$0**.

---

*Expansion director sign-off: every conflict located across the four expansion docs is
ruled on above (X1–X13) with its reason. The one factual error found — `pvp_design` §8.2's
"binding" claim that remote humans can be modelled as bot records — was verified against
`core/sim/player.js:72-73` and `:587-617` this session and corrected in X4, and the plan's
effort estimate is re-based on the correction. Nothing here re-litigates a BUILD_PLAN
ruling; everything that needs the v1 freeze to move is a request in Part 9, not an
assumption. Fix the generator, verify at the player's layer, report with total fidelity.*
