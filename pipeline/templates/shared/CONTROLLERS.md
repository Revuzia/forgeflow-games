# ForgeFlow Games — Canonical Character Controllers

**Why this directory exists:** Procedural generation kept producing per-game bespoke movement loops with subtle integration-order bugs (apply gravity vs clamp velocity vs resolve collision vs set grounded flag). Each generated `game.js` had its own slightly-broken physics that QA couldn't reliably patch. Industry convention for tight platformers (Celeste, Super Meat Boy, Hollow Knight, Mario, every Unity/Unreal/Godot character) is a **kinematic character controller** — a separate module that owns input → state → velocity → animation. The physics engine just provides collision substrate.

**The rule:** Generated games NEVER inline movement/jump/dash logic. They instantiate a controller and call `controller.tick(time, delta)` once per frame. Generators must not modify controllers; they only choose presets and feel overrides.

---

## Files

| File | Genre | Status |
|---|---|---|
| `platformer_controller.js` | 2D platformer (Phaser 3 + Arcade Physics) | **Shipping** (5 presets: default, mario, celeste, sonic, dkc) — used by `platformer` template |
| `platformer_controller.test.cjs` | Headless tests for the above | **11/11 passing** |
| `topdown_controller.js` | 2D top-down 8-directional (Phaser 3 + Arcade) | **Shipping** (4 presets: default, zelda, hades, twin-stick) — used by `topdown` and `arpg` templates |
| `topdown_controller.test.cjs` | Headless tests for the above | **12/12 passing** |
| _(skip)_ obby controller | 2D parkour platformer | Inlined in template (only 381 lines, works fine) |
| _(skip)_ boardgame controller | Turn-based, no movement | N/A — different problem space |
| _(future)_ `character3d_controller.js` | 3D platformer/ARPG (Three.js + Rapier) | Planned (when 3D pipeline activates) — used by `3d-platformer` and `3d-arpg` templates |

### Per-genre fix matrix (what each template gets)

| Concern | platformer | topdown | obby | arpg | boardgame | 3d-* |
|---|---|---|---|---|---|---|
| `createPlayer` before colliders | template ordering fixed | already correct | already correct | already correct | N/A | N/A |
| Canonical character controller | `PlatformerController2D` | `TopdownController2D` | inlined | `TopdownController2D` | N/A | future `Character3DController` |
| Variable-jump-cut release-edge | yes (in controller) | N/A | N/A | N/A | N/A | future |
| Enemy normalizer | scalar `patrolDir` (in template `update()`) | vec2 `patrolDir.x/y` (in template `update()`) | N/A no enemies | vec2 `patrolDir.x/y` (in template `update()`) | N/A | future |

---

## How a generator uses it

```js
// In GameScene.create() AFTER inputs are wired:
this.controller = new window.PlatformerController2D(this, {
  preset: "celeste",                  // pick the feel
  overrides: GAME_CONFIG.player,      // optional per-game tunings
});
this.controller.attach(this.player);

// In GameScene.update(time, delta):
const intent = this.controller.tick(time, delta);
if (intent.animKey)  this._safePlayAnim(intent.animKey);
if (intent.jumped)   this.playSound("sfx_jump");
if (intent.dashed)   this.emitDust(this.player.x, this.player.y);
```

The pipeline (`run_game_pipeline.py`) auto-injects `<script src="platformer_controller.js"></script>` BEFORE `game.js` in every platformer game's `index.html`, and copies the controller into `games/<slug>/`.

---

## How to add a new genre controller

1. Create `<genre>_controller.js` in this directory following the template:
   - Self-registers on `window.<Genre>Controller2D` (or `Controller3D`)
   - Constructor: `(scene, options)` where `options.preset` selects feel
   - Methods: `attach(player)`, `tick(time, delta, opts)`, `reset()`, `setConfig(overrides)`
   - `tick()` returns `{ animKey, jumped, dashed, onGround, ... }` intent dict
2. Add headless tests in `<genre>_controller.test.cjs`
3. Add the file to the `EXPECTED` list in `run_game_pipeline.py` (~line 1969)
4. Add the file to the `shared_order` list in `run_game_pipeline.py` (~line 2086) so it gets script-tagged into `index.html`
5. Update the corresponding `templates/<genre>/game.js` to instantiate + call the controller
6. Update `debug_strategies.py` `controller_guard_for()` to detect the new controller file and emit a guard for that genre

---

## Tick order (DO NOT REORDER)

The bug surface in 2D platformer controllers is integration order. The canonical order is:

1. Read input + buffer/coyote timers
2. Compute `onGround` from `body.blocked.down || body.touching.down` (single source of truth)
3. Refresh coyote + double-jump on ground
4. Apply horizontal accel/clamp (skipped if dashing or `opts.skipHorizontal`)
5. Process jump (ground → coyote → buffered → double)
6. Apply variable-jump-cut (release while velocity.y < cut threshold)
7. Process dash trigger
8. Emit animation intent
9. Decay timers (dash duration, etc.)

If you reorder these, write tests that prove the new order doesn't regress movement/jump/gravity test cases.

---

## Why this fixes "stuck at QA #1"

Before:
- Each generated `game.js` had inlined movement (~150 lines of velocity math)
- AAA patches (`patch_player_systems.js`, `patch_signature_mechanics.js`) mutated `update()` per game
- Surgical search/replace patches couldn't target subtle bugs that lived in the seams between patches
- Variable-jump-cut, coyote time, dash interactions all interacted unpredictably

After:
- Movement lives in ONE module shared across all platformer games
- Patches CANNOT modify movement (different file; surgical patch search runs against `game.js` only)
- The module has unit tests that gate generation
- Per-game tuning happens via `preset` + `overrides`, not via code mutation

The game.js file is now ~1200 lines of game-specific logic (level setup, enemy AI, HUD, scenes), not 9000 lines of movement glue.
