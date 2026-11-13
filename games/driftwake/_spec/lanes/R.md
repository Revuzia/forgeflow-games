# Lane R — rewards + shrine hub checkpoint

Resumed 2026-09-30 by the third Lane R agent (two earlier agents killed by
usage limits; no checkpoint file existed). Port 8924.

## Starting state (orchestrator measurement)
- qa_rewards_unit.mjs -> "21 / 21 unit checks PASS" (fake controller + enemies).

## Done (all commands run from games/driftwake)
- Read owned files end to end: modifiers.js, boons.js, relics.js, shop.js,
  boonPick.js, shrineMenu.js, consumer diffs in spellHits/controller/spellSystem.
- CODE CHANGES (this agent):
  - shop.js: dispose() (bus + save-section unregister) for teardown.
  - shrineMenu.js: Esc now LEAVES the shrine from the pane zone too (footer
    promised it; after a mouse click the first Esc only hopped to the nav).
  - modifiers.js: OPT_IGNITE / OPT_RECHILL preallocated (no literal per tick);
    hitMultInto(reg, slot, kind) -> this.hm[0] out-slot (hitMult kept as a
    convenience wrapper); the burn tick uses hitMultInto.
  - spellHits.js `_rm`: uses hitMultInto + hm[0] (no boxed return).
- EFFECT LEDGER: _harness/qa_rewards_ledger.mjs (real SpellSystem, SpellHits,
  controller, registry, Enemies, HealthMotes, Progression; A/B same seed).
  `node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_rewards_ledger.mjs`
  -> "29 / 29 ledger checks PASS". No label-only effect found.
- UI FLOWS: _harness/node_dom_shim.mjs + _harness/qa_rewards_ui_node.mjs
  (real boonPick/shrineMenu/toast/glass DOM, real input.js keydown listener).
  `node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_rewards_ui_node.mjs`
  -> "29 / 29 UI checks PASS" incl. steady-frame ALLOCATION at the floor.
  INFO: Ember Coil burn tick = ~10 B/tick (the damage amount boxed into
  DamageableRegistry.damage — same per-hit class as every spell hit).
- unit probe still "21 / 21 unit checks PASS" after the changes.
- Boss names verified: PAIR_LABEL = The Icewall / Shrinebreaker / Gatekeeper of
  Brass / Warden of the Sundered Gate / Furnace Guardian / Volcanic Plate Knight.

- DONE after the above: shop.js listens to 'realm:entered' (trail re-tint);
  Great Vortex VISUAL parity: spellSystem writes ctx.vortexScale each frame,
  vortex.js scales ring (via _ringBase), helices and grains, spellHits hits on
  vx.ring (no second factor). Ledger now "30 / 30 ledger checks PASS" (adds
  "drawn ring 3.1 -> 3.565, helix 2.360 -> 2.714 = x1.15").
  UI alloc tolerance 4 KB/50k-frame window (0.08 B/frame) + one settle window:
  "29 / 29 UI checks PASS" twice in a row.

- Browser probe _harness/qa_rewards.py updated for today's code: ONE Esc per
  shrine close (Esc now closes from the pane), waitModal uses GAME time (15 min
  wall backstop), travel waits 15 min wall cap, boot timeout 15 min.
  RUN 1 started (background) -> log in the session scratchpad
  browser_run1.log; machine at start: 64 chrome procs, CPU 85%.

- Ledger +1 check (Relic Slot 3 bought for 400 -> 3rd slot live): "31 / 31".

- Ledger: stale needles fixed + a check that every needle resolves: "32 / 32".
- BROWSER RUN 1 (in progress at 21:57): booted in ~15 min of wall time; one
  FAIL "Rime Edge ... ratio 1.07917" (32.375 vs 32.4) = Float32 hp at 1e6
  quantizes to 1/16 -> probe targets now hp 4000 (page.js, qa_rewards.py).
  Run 1 also measured Ember trail albedo red 1.2436 (>1) -> shop.js clamps
  the tinted albedo to <= 0.98 (hue kept); UI probe checks all 6 trails x 3
  realms: "30 / 30 UI checks PASS".

- BROWSER RUN 1 FINISHED 22:09: "=== 45 / 51 checks PASS ===", page errors 0.
  FAILs: Rime Edge 32.375 (1.07917), Tidal Force dealt 9.75 (kb 3.64 = x1.30
  OK), Sunder 33.625, Cinderbrand 32.375, Heart of the Drift 33.625 — all the
  Float32 1/16 quantization of hp 1e6 targets; Driftmark toast "shown": false
  read 400 ms of WALL time after minting (Z pick applied: drift.dmg 1; the
  screenshot shows the toast) -> qa_rewards.py now waits for the class.
  Copy of run 1 json: scratchpad qa_rewards_out_run1.json. Screenshots in
  _shots/rewards_*.png. shrineMenu CSS: short-window pane height (960x540
  cropped the title).
- BROWSER RUN 2 (22:16): "50 / 51" — Sunder baseline 60 = a previous
  Spikes formation still planting at the same aim point hit the new target
  (probe race) -> Q.spikeHit now waits for crystallize idle.
- BROWSER RUN 3 (22:2x): "=== 51 / 51 checks PASS ===", "page errors (0)",
  exit 0. (Rime Edge 32.3999/30 = 1.08; travel same + cross realm d = 0;
  Undying 1 HP then 0; Driftmark toast shown, freeze false; SAVE->reload
  identical.) json copies: scratchpad qa_rewards_out_run{1,2,3}.json.
- FINAL Node: unit 21/21, ledger 32/32, UI 30/30 (all exit 0).
- LANE R STATUS: DONE pending integration (main.js hooks below).

## main.js hooks (for the integrator — lane R never edits main.js)
1. imports: Modifiers (progression/modifiers.js), Boons, Relics, Shop,
   { BoonPick, DriftmarkToast, anyModalOpen } (ui/boonPick.js),
   { ShrineMenu, GlassCounter } (ui/shrineMenu.js).
2. construct AFTER progression + the shared ctx exists (ctx needs character,
   spells, spellHits, registry, enemies, bosses, motes, progression, bus, S,
   getRealm, enterRealm, shrine, rig, terrain, realms, wake, overlay, input):
   mods = new Modifiers(ctx); relics = new Relics(ctx); boons = new Boons(ctx);
   shop = new Shop(ctx); boonPick = new BoonPick(ctx); driftToast = new
   DriftmarkToast(ctx); shrineMenu = new ShrineMenu(ctx); glassHud = new
   GlassCounter(ctx);   (order matters: Modifiers first, Relics before Shop)
3. frame: `mods.update(dt);` right after `spellHits.update(dt);` and
   `boonPick.update(dt); driftToast.update(dt); shrineMenu.update(dt);
   glassHud.update(dt);` after `progression.update(dt);`
4. pointerlockchange: add `&& !anyModalOpen()` before `shell.pause()`.
5. enterRealm: `shop.setRealm(token);` right after `wake.applyRealm(...)`;
   at the end `mods.setRealm(token); shrineMenu.setRealm(token);
   boonPick.setRealm(token); glassHud.setRealm(token);` (+ lane Q's
   bus.emit('realm:entered', {realm: token}), which mods and shop also hear).
6. E key (lane U): `if (ePressed && !anyModalOpen() && shrineMenu.reach)
   shrineMenu.open(shrineMenu.reach);` (or bus 'ui:open' {panel:'shrine'}).

## Next
3. Browser proof at 8924 (_harness/qa_rewards.py from earlier agents — re-read
   it against today's code first; NOT RUN yet).
4. main.js hook snippets for the integrator (in the final report).
