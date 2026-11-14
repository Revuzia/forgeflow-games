# Shroud of the Ancients — Multi-Session Rebuild Plan

**Last updated:** 2026-05-11
**Status:** Pass 1 complete. Pass 2 queued.
**Owner:** Claude Claw
**Reference:** [`ZELDA_REFERENCE.md`](./ZELDA_REFERENCE.md) (canonical Zelda mechanics + 20-item gap analysis)

---

## Why a multi-session plan

The user asked for a "full Zelda port" comparing the build to canon. The
realistic scope is multi-week pipeline work, not a single conversation. This
file is the contract between sessions — each pass has a hard scope, exits
through Telegram approval, and the next pass picks up where the last stopped.

The Bible rule applies: **AAA-or-flagged**. If a pass ships below that bar,
the next pass owns the regression.

---

## Pass 1 — DONE (2026-05-11)

**Deliverables shipped this session:**
- ✅ Audit: 8,461-line `game.js`, 14 Phaser scenes, 405 files in the game dir,
  60+ stuck `levels.json.bak_*` backups (158 MB of bloat).
- ✅ Research: [`ZELDA_REFERENCE.md`](./ZELDA_REFERENCE.md) (318 lines) —
  core loop, hearts, rupees, sword, dungeons, overworld, items, bosses,
  audio cues, save model + a 20-item gap analysis.
- ✅ Hide-on-portal: N/A — Shroud was never inserted into
  `forgeflow-games.public.games` so users can't navigate to it from the
  homepage / category grid. Game URL only reachable by direct typing.
- ✅ Boot-hang diagnosis: confirmed it's a **preview-environment artifact**
  (`document.hidden=true` causes `requestAnimationFrame` to never fire);
  the real game loads in a foreground tab. The user's actual complaint
  ("Level 1 can't be passed") is a gameplay-layer issue downstream of boot.
- ✅ Disk cleanup: deleted 351 `levels.json.bak_*` files (181 MB → 26 MB
  for the game dir). Capped the pipeline's backup generator to keep only
  the 5 most-recent backups going forward (`scripts/run_game_pipeline.py`
  line ~4811).

**Known unresolved (intentionally deferred):**
- "Level 1 can't be completed" — needs visual session in a foreground
  browser to reproduce. Pass 2.
- Procgen layer is broken: `levels.json` is narrative metadata (Acts →
  regions → NPCs → encounter tables), not tilemap data. The game derives
  rooms procedurally and apparently doesn't lay out a valid path from
  spawn → first boss. Pass 3.
- Asset bloat: ~150 PNGs preloaded eagerly (banners, button states, bar
  variants), most unused. Pass 6.

---

## Pass 2 — Make Level 1 finishable (NEXT — recommended next session)

**Goal:** ship a single hand-authored, demonstrably playable Act 1
"Verdant Cradle" experience. Forget procgen for now. Forget Acts 2–6.
A user clicking "play" reaches a victory screen via this exact path:

```
Title → Canopy Village (1 room, dialogue with Elder Mira gives intro) →
  Emerald Thicket (1 room, 2 Thornback Lurker enemies, sword teaches X-attack) →
  Ruins of First Light (3-room mini-dungeon: key room → puzzle room → boss room) →
  Mini-boss: Guardian of First Light (single Geomancer Statue, telegraphed slam) →
  Heart Container drop → Warp out → Win screen
```

That's the **minimum viable Zelda**. If a player can complete this in 5–8
minutes the game is back on the rails.

**Concrete tasks:**

1. **Open Shroud in Chrome MCP (not Claude Preview)** so raf actually fires.
2. **Reproduce the level-1 blocker on video / via screenshot eval.** Identify
   the exact failure: bad spawn, unreachable door, unkillable enemy, broken
   collision, etc.
3. **Author Act 1 as hand-built `levels.json`**, structure:
   ```json
   {
     "act_num": 1,
     "rooms": [
       { "id": "canopy_village", "tiles": [[...18×11 grid...]], "exits": {...}, "npcs": [...], "spawn": [x,y] },
       { "id": "thicket_a", ... },
       { "id": "ruins_entrance", ... },
       { "id": "ruins_key_room", "key_drop": true, ... },
       { "id": "ruins_puzzle_room", "puzzle": "push-block-onto-pressure-plate", ... },
       { "id": "ruins_boss_room", "boss": "Guardian_of_First_Light", "locked_until_key": true, "heart_container_drop": true, ... }
     ]
   }
   ```
   18×11 tiles × 16px = 288×176 px screens, matching NES Zelda screen geometry.
4. **Wire the warp + win screen.** Picking up the heart container in the boss
   room sets `act1_complete=true` in localStorage and triggers Win scene.
5. **QA via Chrome MCP**: run end-to-end, hands-off, watch the player reach
   Win without manual intervention from the autoplayer.
6. **Telegram approval gate**: send a 30s screen-record to the user before
   pushing to prod.

**Acceptance:** real human user completes Level 1 in < 10 minutes on first
play with no hint sheet. Mid-difficulty (canon Act 1 = the easy intro).

**Estimated session length:** 3–4 hours of focused work.

---

## Pass 3 — Combat parity with canon

**Goal:** sword + bow + bomb feel like Zelda, not generic top-down.

**Tasks:**
- Sword slash: 4-directional sprite, 8-frame anim, ~100ms windup, ~200ms
  active hitbox, ~150ms recovery. Hitbox is a rectangle in front of player,
  not a melee circle.
- Half-heart damage: enemies deal 0.5/1.0/2.0 hearts (canon).
- Knockback: 8px on hit, 600ms invincibility flicker.
- Spin attack: hold X for 1.0s (not 2.0 — ALttP standard), 360° radius hitbox,
  charged glow VFX during windup.
- Bow + arrows: C key fires arrow in facing direction, projectile pool of 8,
  collides with enemies, embeds in walls 0.5s then despawns.
- Bombs: drop at player feet, 2s fuse, 32px radius blast, destroys "weak
  wall" tiles + damages enemies.
- Audio: per-weapon SFX from the existing `assets/audio/` stash (sfx_attack,
  sfx_hit, sfx_pickup, etc.).

**Reference:** `ZELDA_REFERENCE.md` §2 + §4.

---

## Pass 4 — Hearts, rupees, keys, items HUD

**Goal:** real Zelda HUD with hearts (half-heart resolution), rupee count
with wallet cap, small-key counter, magic meter, B/A item slots.

**Tasks:**
- Heart container math: max 3 → +1 per boss + +1 per 4 heart pieces. Half-
  heart sprite for partial damage. Low-hearts beep at 1 heart.
- Rupee system: green=1, blue=5, red=20, gold=100. Wallet caps at 99/300/999
  (3 upgrade tiers).
- Small keys per dungeon (carry across rooms within one dungeon, reset on
  exit). Big key opens boss door. Compass reveals chest icons on map.
- Item-cycle slot: B-button bound to selected item (boomerang, bombs, bow,
  hookshot, fire rod, ice rod, lamp, magic powder, etc.). Esc opens select
  menu (paused).
- Magic meter: drains on rod use / spin attack, refills from green magic
  drops or potion.

---

## Pass 5 — Dungeon anatomy + boss formula

**Goal:** each Act-end dungeon has the canon shape — entrance, key room,
mini-boss, dungeon item, puzzle gauntlet, boss key, big door, boss room,
heart container, warp.

**Tasks:**
- Dungeon flag system: track key/compass/map/big-key acquired per dungeon.
- Mini-boss layer: 6 mini-bosses (one per act). Currently the design lists
  21 enemies but no mini-boss tier. Mark the 6 hardest enemies as
  promotable to mini-boss.
- Boss formula: 3 phases, each phase exposes a weak point gated by a
  specific dungeon item (sword phase → bomb phase → bow phase). Audio
  switches to `music_boss.ogg` on phase 1.
- Boss arena: locked square room, doors lock on entry, unlock on victory.
- Reward: Heart Container drops on boss death (Zelda canon: full container,
  not piece).

**Reference:** `ZELDA_REFERENCE.md` §6 + §9.

---

## Pass 6 — Overworld + secrets + fast travel

**Goal:** overworld feels like an interconnected world, not a corridor.

**Tasks:**
- Overworld map: 6 acts × 6 regions = 36 screens. Each screen is 18×11
  tiles. Player walks between screens with edge-of-screen transitions
  (camera pan, not fade — ALttP standard).
- Bombable walls: tiles that look weakened, take damage from bomb blast,
  reveal a passage.
- Burnable bushes: ember torch sets the tile on fire, reveals hidden cave
  entrance.
- Whistle / Recorder relic: warp to one of 6 fixed warp points (one per
  act's hub town).
- Secret jingle: ALttP's "ti-li-li-LING" plays on secret discovery.
- Asset bloat: trim the eager-loaded UI sprites in PreloadScene. ~150 PNGs
  → ~30 PNGs.

---

## Pass 7 — Save model + checkpoints + new game

**Tasks:**
- Save points: fairy fountains (1 per act) and town inns. Esc menu → "Save"
  writes to localStorage.
- Game-over flow: respawn at last save with full hearts but lose any
  unsaved progress (no rupees lost — Zelda canon).
- New Game + slot select: 3 save slots, slot picker on title screen.
- Heart-piece tracking: 24 pieces total (4 per act) → 6 extra containers.
- Continue / Erase per slot.

---

## Pass 8 — Polish, juice, audio, accessibility

**Tasks:**
- Screen shake on hit / boss attack.
- Hitstop: 60–80ms freeze frame on sword hit.
- Item-get fanfare: ALttP "do-do-do-DOOOO" jingle on dungeon item pickup.
- Low-hearts beep: 1Hz beep at ≤1 heart.
- Color-blind mode (per design.json's `accessibility.js`).
- Controller support via the existing `gamepad.js`.
- Final FPS pass (target 60 on a 2019 MBP).

---

## Pass 9 — Procgen revival (optional, post-launch)

The current procgen layer is broken — it derives rooms from quest narrative
JSON. Keep it disabled and ship Pass 2–8 as hand-authored content for
launch. If we want procgen back, the inputs need to be:
- Tile palette + collision rules
- Room templates (key room, puzzle room, boss room)
- Region connectivity graph
- Lock-and-key dependency DAG

That's its own multi-week project.

---

## Risks + caveats

- **Asset licensing:** the existing `assets/` folder mixes Kenney
  (CC0/free), unattributed protagonist sprites, and AI-generated room
  backgrounds (`_room_w1_*.png`). Pre-launch audit needed.
- **Music:** 4 tracks (menu / level / dungeon / boss) — enough for the
  whole game if we accept theme reuse. If we want one track per act,
  generate via `pipeline/assets/music/` or Stability Audio.
- **Pipeline bug:** the level-regen script in `scripts/run_game_pipeline.py`
  was leaking 461KB backups every minute with no cleanup until Pass 1's
  cap was added. Watch for similar leaks elsewhere.
- **Two `levels.json` shapes:** narrative metadata (current shape) vs
  tilemap data (Pass 2's shape). Pass 2 will need a clear naming
  convention — probably `acts.json` (narrative) and `levels.json`
  (gameplay).

---

## How to resume

When a new session opens Shroud-related work:

1. Read this file first.
2. Read `ZELDA_REFERENCE.md` to refresh on canon.
3. Check `state/progress.json` for the last-completed pass marker:
   `{ "shroud_pass": <N> }`.
4. Start the next pass. Do not start a pass + 1 until pass + 0 ships
   to prod and the user clicks through it.

