> **HISTORICAL DOCUMENT (banner added 2026-06-10).** Superseded by the live design: ONE-GAME policy (single journal to M5 DONE; parked blocks promotions), claude -p prompts via STDIN (WinError 206 fix), XCOM detached from the nightly, legacy Phaser path quarantined behind FFG_ALLOW_PHASER=1. Current truth lives in v2_pipeline.py + engine_authoring.py docstrings and forgeflow-engine/ENGINE_GAME_API.md.

# ForgeFlow Engine — Re-Architecture Plan (v2)

> **The flip:** the old pipeline tried to *hallucinate an entire engine + a whole
> game + all its content in one generation pass, then verify it doesn't crash.*
> v2 **assembles game-specific CONTENT on a fixed, tested engine, then verifies it
> is actually good and actually on-genre.**
>
> Root causes this fixes (from the 2026-05-29 audit):
> 1. No engine substrate → every game re-hallucinates 3,000+ lines of engine+game. → **Layer 1**
> 2. Design writes checks the build can't cash. → **Layer 3 (vertical-slice gate)**
> 3. QA measured "boots without crashing," not feel/fidelity. → **Layer 4**
> 4. Generator / level-data / verifier didn't share a contract (the echoes parse-jam). → **Layer 2**
> 5. No cross-game learning. → **Layer 5**
> 6. No art-direction coherence gate. → **Layer 4 (fidelity gate)**

---

## The five layers

```
            ┌─────────────────────────────────────────────────────────┐
  LAYER 5   │  LEARNING STORE   learnings.jsonl  → injected into builds  │
            └─────────────────────────────────────────────────────────┘
            ┌─────────────────────────────────────────────────────────┐
  LAYER 4   │  VERIFICATION LOOP                                        │
            │  contract → signature → functional → fidelity(vision) →   │
            │  feel(play-bot).  Each failure emits a SPECIFIC fix +     │
            │  a learning record.                                       │
            └─────────────────────────────────────────────────────────┘
            ┌─────────────────────────────────────────────────────────┐
  LAYER 3   │  BUILD ORDER (vertical-slice-first)                       │
            │  select-engine → SLICE (1 room, signature mechanic) →     │
            │  [GATE] → expand content → polish.                        │
            └─────────────────────────────────────────────────────────┘
            ┌─────────────────────────────────────────────────────────┐
  LAYER 2   │  TYPED CONTENT SCHEMA  (one contract; gen=level=QA speak) │
            │  content.schema.json + per-genre profiles                 │
            └─────────────────────────────────────────────────────────┘
            ┌─────────────────────────────────────────────────────────┐
  LAYER 1   │  ENGINE SUBSTRATE  (FFG runtime — fixed, versioned,       │
            │  tested; NOT regenerated per game)                        │
            │  kernel + sim cores + per-genre render/input/feel layer   │
            └─────────────────────────────────────────────────────────┘
```

The LLM's job shrinks from *"write a 3,000-line game"* to *"emit an ~800-line
`content.json` that validates against a schema."* That is a task LLMs are
reliable at. Engine correctness and game *feel* become fixed assets, authored
once and reused, instead of a per-game coin-flip.

---

## Layer 1 — Engine substrate (`runtime/`)

A fixed, versioned runtime every game loads via `<script src>` (globals under a
single `window.FFG` namespace; no build step; works with static serve + R2). Three tiers:

- **`ffg_kernel.js`** — boot, Phaser game config, scene stack, input router
  (keyboard/pointer/gamepad), camera helpers, audio bus, a HUD/text framework
  (sharp fonts, `resolution:2`), save/load, scene transitions, a small tween/juice
  helper. Genre-agnostic. *This is the part every game shared but kept re-writing.*
- **`sim/*.js`** — pure simulation cores (the hardened `templates/shared` cores):
  `tactical_grid.js`, `turn_based_combat.js`, etc. No rendering. Deterministic,
  unit-testable, headless-runnable (this is what the signature gate drives).
- **`ffg_<genre>.js`** — per-genre **render + input + feel** layer that binds a sim
  core to the kernel: selection, range highlights, path preview, hit% UI, turn
  banners, damage popups, win/lose flow. *This is the "feel" the old cores lacked.*

A game = `kernel` + the sim core(s) + the genre runtime + a `content.json`. Nothing
else is generated as engine code.

**Versioning:** `runtime/VERSION`. The build copies a pinned runtime version into
each game folder at assemble time (games deploy independently to R2, so each carries
its own copy — same as today's per-game core copies, but now it's ONE tested unit).

## Layer 2 — Typed content schema (`schema/`)

One JSON-Schema contract that **the design phase emits, the level phase emits, and
QA reads** — eliminating the desync that jammed echoes (`tiles` int-grid vs the
solver's expected shape). `content.schema.json` is the base; `profiles/<genre>.schema.json`
constrain per genre. The schema is the design phase's *output target*, so design can
no longer promise mechanics the engine can't express — if it isn't in the schema, it
can't be asked for.

## Layer 3 — Build order (`build_order.py`)

Replaces "generate the whole game" with:
1. **select-engine** — read design → pick genre profile from `registry.json`.
2. **slice** — generate ONLY the content for one playable encounter that exercises
   the *signature mechanic*. Cheap, fast, focused.
3. **[GATE]** — the slice must pass contract + signature + functional + a first
   fidelity read before anything else is generated. **No hollow shells past this point.**
4. **expand** — generate the remaining content (more missions/units/levels). This is
   *data*, not engine code, so it's reliable.
5. **polish** — feel/fidelity passes; asset hookup; audio.

Content generation uses `claude -p`. (In an interactive session the OAuth lock
forbids `claude -p`; `build_order.py --dry-run <content.json>` validates the whole
wiring against hand-authored content, and the live command is printed for the operator.)

## Layer 4 — Verification loop (`gates/`)

| Gate | Q it answers | Tech | Blocks? |
|---|---|---|---|
| contract | Does content match the schema? | Python/jsonschema | yes |
| signature | Does the genre's *defining mechanic* actually do something? | headless Node on the sim | yes |
| functional | Boots, reachable, no console errors? | existing QA bots (Playwright) | yes |
| fidelity | Does a screenshot *look like* the target genre? | vision via `claude -p @img` | soft (score) |
| feel | Does a play-bot make progress / can win+lose? | Playwright | soft (score) |

Every failure produces a **specific** fix instruction (fed back to regeneration,
reflexion-style) **and** a learning record. The signature gate is the one that would
have caught echoes shipping a screen-tint instead of a dual-realm mechanic.

## Layer 5 — Learning store (`learnings.jsonl` + `learn.py`)

Append-only rules accumulated across builds (`{genre, symptom, rule, evidence}`).
`learn.py` injects the relevant rules into the next build's prompt and records new
ones from gate failures. This is the actual "learns over time" mechanism — grounded
in concrete past failures, not vibes.

---

## Generalization across the ~140-game master list

Most of the catalog collapses into ~10 **2D genre buckets**, each served by a sim
core that already exists + a genre runtime:

| Bucket | Sim core | Example master_list titles |
|---|---|---|
| tactics (XCOM/Fire Emblem/Into the Breach) | `tactical_grid` | XCOM, Advance Wars, Into the Breach |
| top-down ARPG (Zelda-like) | `topdown_controller` | Link to the Past, Hyper Light |
| platformer | `platformer_controller` | DKC, Celeste, Hollow Knight (2D) |
| shmup / bullet-hell | `shmup_core` | Geometry Wars, Ikaruga |
| RTS | `rts_core` | StarCraft, Age of Empires |
| tower defense | `tower_defense` | Kingdom Rush, Bloons |
| arcade / breakout / snake | `arcade_core` | Breakout, Pac-Man, Snake |
| beat-em-up | `beatem_up_core` | Streets of Rage |
| metroidvania | `metroidvania_core` | Metroid, Castlevania |
| turn-based RPG / monster-catcher | `turn_based_combat` | Pokemon, Final Fantasy |

**This is "most of them."** Each new genre runtime is a one-time investment that
unlocks a whole bucket of the catalog. Order of build (highest ROI / lowest risk
first): **tactics → top-down ARPG → arcade → shmup → tower-defense → platformer →
the rest.** Tactics is first because turn-based games have *no twitch feel to nail*
and are *trivial to verify by vision* (a clear board state).

**Second track (Phase 2): 3D / voxel.** three.js templates + 135 GLB models +
`voxel_engine.js` exist. Same five-layer architecture, different kernel
(`ffg_kernel_3d` on three.js) and genre runtimes. Deferred until the 2D loop is
proven, because 3D adds rigging/animation asset complexity and much harder vision
verification. Buckets: 3D-platformer, 3D-ARPG, voxel-sandbox, god-sim.

---

## Migration path (non-destructive)

The existing paused pipeline is left intact. v2 is built **alongside** in
`pipeline/engine/`. Cutover is per-genre:
1. Prove the loop on **rift-tactics** (this build).
2. Point `build_order.py` at the tactics profile; generate 2–3 more tactics games
   autonomously to confirm repeatability.
3. Add the next genre runtime; repeat.
4. Once ≥3 buckets ship reliably, retire the old `phase_build` whole-game generator.

## What this build delivers vs. stages

- **Delivered now (works headlessly / in browser):** the plan; the FFG runtime
  (kernel + tactics genre layer + hardened sim); the schema + tactics profile +
  registry; **rift-tactics** (a real, playable, original-IP XCOM-lite assembled from
  `content.json`); the contract gate + signature gate (run now); fidelity/feel gates
  + build_order + learning store as real code with operator handoffs for the parts
  that need `claude -p` / a browser / metered asset spend.
- **Staged (needs operator action / approval):** live `claude -p` content generation
  (OAuth lock); real asset generation (metered spend → Telegram gate); the 3D track;
  the full 140-game sweep.

## Naming / IP

All proof content is original IP ("Rift Tactics", units "Vanguard/Sentinel/etc.").
The schema carries no copyrighted names; `registry.json` references genres only by
mechanic, never by trademarked title in shipped output.
