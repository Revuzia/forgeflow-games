> **HISTORICAL DOCUMENT (banner added 2026-06-10).** Superseded by the live design: ONE-GAME policy (single journal to M5 DONE; parked blocks promotions), claude -p prompts via STDIN (WinError 206 fix), XCOM detached from the nightly, legacy Phaser path quarantined behind FFG_ALLOW_PHASER=1. Current truth lives in v2_pipeline.py + engine_authoring.py docstrings and forgeflow-engine/ENGINE_GAME_API.md.

# FFG Engine v2 — Build Review

Reviewer pass over the v2 re-architecture build. Verdict: **the architecture is
set up correctly and the proof is real.** Every blocking claim below was verified
by running the code, not by inspection alone.

## What was built (19 files)

| Layer | Files |
|---|---|
| Plan | `ARCHITECTURE.md`, this `REVIEW.md` |
| 1 — Engine substrate | `runtime/ffg_kernel.js`, `runtime/ffg_tactics.js`, `runtime/ffg_loader.js`, `runtime/sim/tactical_grid.js`, `runtime/sim/turn_based_combat.js`, `runtime/VERSION` |
| 2 — Schema | `schema/content.schema.json`, `schema/profiles/tactics.schema.json`, `schema/profiles/topdown.schema.json`, `registry.json` |
| 3 — Build order | `build_order.py` |
| 4 — Gates | `gates/contract_gate.py`, `gates/signature_gate.cjs`, `gates/fidelity_gate.py`, `gates/feel_gate.py`, `gates/run_gates.py` |
| 5 — Learning | `learnings.jsonl`, `learn.py` |
| Proof game | `games/rift-tactics/` (content.json + index.html + copied runtime) |

## Verification evidence (all run during this build)

| Claim | How verified | Result |
|---|---|---|
| Sim cores run headlessly | `node` driver on `tactical_grid.js` | reachable tiles bounded by movement; A* path correct; **battle resolves to victory** |
| Contract gate validates good content | `contract_gate.py rift-tactics/content.json` | **PASS** |
| Contract gate **rejects** bad content | injected aim=5.0, unit-in-wall, out-of-bounds | **FAIL with 3 precise errors** (proves it's a real guard, not a stamp) |
| Signature gate proves the mechanic exists | `signature_gate.cjs` | **11/11 PASS** — movement path-constrained, cover reduces hit (0.45 vs 0.95 open), damage formula, win-on-elimination, AP refill |
| Orchestrator ladder | `run_gates.py rift-tactics` | contract PASS, signature PASS, feel/fidelity DEFER (need browser/`claude -p`) |
| Build order end-to-end | `build_order.py --dry-run` | gate → assemble (copy runtime + write content/index) → re-gate, all PASS |
| Learning injection | `learn.py tactics` | 5 rules rendered into the build prompt |
| **Proof game runs in a real browser** | Chrome preview @ `:8767/games/rift-tactics/` | Phaser loaded, **0 console errors**, FFG v2.0.0, tactics registered, scene built 3v4 on 12×9 grid |
| **Proof game is winnable** | greedy play driven via `scene.__test` hooks | **VICTORY in 4 turns**, enemy HP 25→0, 2 allies survive |
| Runtime copy integrity | `diff` engine source vs game copy | 5/5 files in-sync |

## Coherence check

- **Load order is correct**: kernel → sim → genre runtime → loader; `index.html`
  matches what `build_order._index_html` generates (so a generated game and the
  hand-authored proof are byte-compatible in structure).
- **One contract, three consumers**: `content.json` is consumed by the runtime
  (browser), `contract_gate.py` (schema), and `signature_gate.cjs` (sim) — the
  desync that jammed echoes is structurally impossible now.
- **Dual export pattern**: sim cores set `globalThis.FFG.sim.*` (works in the
  browser as a classic `<script>` and in Node for the gate, despite the package
  being `type:module`). Verified both paths.
- **No stubs in the shipped path**: the tactics runtime is a full render+input+feel
  layer (selection, range highlight, path preview, hit% tooltip, tracers, damage
  popups, turn banners, win/lose) — not the rectangle-only `attach()` the old core had.

## Proven now vs. staged

**Proven (runs today):** the 5-layer architecture; the FFG runtime; the schema +
registry; rift-tactics as a real, winnable, original-IP tactical game assembled
from data on a fixed engine; the contract + signature gates (block) + orchestrator;
build_order assembly; the learning store.

**Staged (needs operator/approval, with real code + handoffs in place):**
- Live `claude -p` content generation (`build_order.py` slice/expand prompts) — blocked by the in-session OAuth lock; run from cmd.exe / Task Scheduler.
- `feel_gate.py` (Playwright) + `fidelity_gate.py` (vision) — need a browser / `claude -p`; the in-browser `__test` playthrough above is the same check run manually and it passed.
- Real art/audio generation (PixelLab/Stability) — metered spend → Telegram gate.
- Additional genre runtimes (topdown, arcade, shmup, …) and the 3D track.

## Risks / follow-ups (honest)

1. The enemy AI in `tactical_grid.js` is competent but basic (nearest-target, shoot-or-advance). Fine for a proof; richer AI (use cover, focus-fire, flank) is a quality lever for later.
2. Mission **progression** (advancing past mission[0]) isn't wired in the tactics runtime yet — by design (vertical-slice-first proves one encounter). It's a small addition: on `end`+victory, load `missions[i+1]`.
3. `fidelity`/`feel` gates are unproven against a live `claude -p`/Playwright run in this session (OAuth + browser constraints). Code is complete; first live run is an operator step.
4. Per-game runtime copies (like the old core copies) mean a runtime bump must be re-propagated to shipped games — `build_order.assemble` does this on rebuild; a future `--reseat-runtime` sweep would update already-deployed games.

## 3D track — Iron Tide (hybrid salvo battleship) [added 2026-05-29]

Proved the architecture generalizes to a **3D, ES-module, three.js** genre on the
same five layers. The 2D classic-script path is untouched.

| Claim | How verified | Result |
|---|---|---|
| Salvo sim runs headless | `node` driver on `sim/battleship.js` | legal 17-cell placement, hit/miss/repeat-invalid/sink correct, full game resolves |
| **AI hunt/target beats random** | sim driver + signature gate | AI clears a 17-cell fleet in **43–50 shots** (random ≈ 94) — real solver, not luck |
| Contract gate | `contract_gate.py iron-tide` | PASS (and it **caught** `view.fog` before I added it to the schema) |
| Signature gate | `signature_gate.cjs battleship` | **9/9 PASS** (placement, fire, sink, AI quality, win detection) |
| **3D scene builds in browser** | Chrome @ `:8767/games/iron-tide/` | three.js r172 loaded, FFG3D v2.0.0, 112 scene objects, 100 click targets, 5v5 fleets |
| **3D game plays to resolution** | `controller.__test.autoPlay()` | ended in 50 turns, winner decided, fleets depleted |
| Ship models load | `fetch` 200 on GLB + `Textures/colormap.png` | Kenney pirate-kit GLBs load (texture fix: copy sibling `Textures/`) |
| 3D runtime copy integrity | `diff` engine vs game | 4/4 in-sync |

New runtime: `3d/ffg_kernel_3d.js` (three.js boot: renderer/scene/lights/loop, GLTF
loader, raycaster, DOM HUD, tween), `3d/ffg_battleship_3d.js` (animated ocean, two
gridded boards, ship models, cannonball-arc cinematic → splash/explosion/sink, pegs,
click-to-fire, win/lose, test hooks), `3d/ffg_boot3d.js` (ESM entry). Plus
`sim/battleship.js`, `schema/profiles/battleship.schema.json`, registry entry
(`status: live, track: 3d`), and the battleship signature test.

**3D-track caveats:** the per-shot cinematic + ocean are functional but a first pass
(not yet AAA-tuned); WebGL screenshots time out in the headless preview (verified via
DOM/state + autoPlay instead); the GLB-texture copy needs to be wired into the
asset step (captured as a learning rule). Mission/match progression and "place your
own fleet" UX are the natural next additions.

## Bottom line

The build does what the plan promised: a game is now **engine + a validated data
file**, not a 3,000-line hallucination. The signature gate makes "shipped a screen
tint instead of the real mechanic" a caught failure. rift-tactics proves the loop
runs, validates, and plays to a win. Adding the next genre is now a bounded,
repeatable unit of work — which is the prerequisite for "most of the 140-game list."
