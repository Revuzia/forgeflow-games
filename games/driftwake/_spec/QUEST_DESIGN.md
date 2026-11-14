# DRIFTWAKE — THE MEANING LAYER (quests, rewards, world purpose)

Owner directive 2026-09-29: "This game has a lot of potential but no real reason
to play. It is cool to surf, but we need quests, real value. This can be a huge
world game." This document is the single source of truth for everything that
gives the world a purpose. Every build lane builds against it; where it and
PROGRESSION_DESIGN.md disagree, PROGRESSION_DESIGN.md wins on NUMBERS (XP, boon
pricing, driftmark curve) and this file wins on STRUCTURE.

## 0. Why the game has no reason to play (verified 2026-09-29)

`progression.objectiveState`, `progression.boons` and `progression.driftmarks`
exist only as save-blob fields — nothing reads or writes them (grep of src/:
the only references are progression.js constructor/save/load). There is no
quest system, no journal, no dialogue, no map screen, no interact key, no
reward beyond XP. The world HAS content anchors — 3 realms, 7 shrines each
(touch-activation live), 9 landmark types x 5 sites per realm, 6 named bosses,
realm portals — but none of it is connected to a goal. PROGRESSION_DESIGN.md
already specified the spine (P3.1), boons (P3.3) and driftmarks (§9); none
were built. This document builds them AND adds the world content a large
open game needs.

Benchmarks, and what each one teaches this layer:
- Breath of the Wild / Elden Ring: every visible landmark must hold a reason
  to ride to it. Nothing on the horizon is scenery-only.
- Ghost of Tsushima: shrines as destinations; a guiding element in the world
  (not just a HUD arrow) points the way.
- Journey: the traversal verb IS the joy — reward the surf, don't just allow it.
- Hades: a choice at every meaningful beat (boons); story in short lines
  delivered between runs, never a wall of text.
- Diablo IV / Destiny: bounties and a clear "next thing to do" at all times.

## 1. Premise (the one-paragraph story)

The world broke. What is left drifts as three shards — Cold, Sand, Ash —
pulling apart a little more every day. Each shard is held by seven SHRINES,
anchor-stones that once bound it to the others, and guarded by two WARDENS
who were meant to keep the anchors lit. The Wardens have turned: corrupted by
the Drift, they are tearing the anchors loose. You are a WAKECASTER, the last
of those who could carve a wake between the shards. Rekindle the shrines,
break the corrupted Wardens, cross each shard, and at the end, MEND THE DRIFT.

Voice: THE ECHO — the remnant voice of the first Wakecaster, living in the
shrines. It speaks only at shrines and at story beats, in one to three short
lines, never more. No NPC model is needed: the Echo is a voice, shown in the
dialogue box with the name "The Echo". Tone: spare, warm, a little sad. Never
exposition dumps. Never modern slang.

## 2. The main quest (the spine) — 20 steps (Cold 8, Sand 6, Ash 6)

One fixed chain per realm. Each step grants objective XP per
PROGRESSION_DESIGN §3.5 (15% of the current level's XP_to_next per step,
25% for a Warden step). Each step has: id, realm, title (≤ 40 chars),
tracker text (≤ 60 chars), completion event, optional waypoint target.

| id | title | completes when | waypoint |
|---|---|---|---|
| cold.1 | The Last Wakecaster | touch the spawn shrine (cold_spawn) | spawn shrine |
| cold.2 | Carve Your Wake | surf 150 m total (RMB held, grounded) | none (teach) |
| cold.3 | Answer the Drift | kill 5 enemies | nearest live pack |
| cold.4 | Kindle the Ring | activate 3 of the 6 ring shrines | nearest dormant shrine |
| cold.5 | Break the Icewall | kill the cold MINI boss | mini boss arena |
| cold.6 | Wake the Anchors | activate all 6 ring shrines | nearest dormant shrine |
| cold.7 | The Shrinebreaker | kill the cold REALM boss | realm boss arena |
| cold.8 | Cross the Drift | step through the portal | portal |

Cold has 8 steps (the first three are the onboarding, §6). Sand and Ash use the
same shape minus the onboarding: arrive (touch the realm's spawn shrine),
kindle 3 → mini boss → all 6 → realm boss → portal. Titles:
- Sand: "Where the Sand Remembers", "Kindle the Ring", "The Gatekeeper of
  Brass", "Wake the Anchors", "Warden of the Sundered Gate", "Onward, Into Ash".
- Ash: "The Burning Shard", "Kindle the Ring", "The Furnace Guardian", "Wake
  the Anchors", "The Volcanic Plate Knight", "Mend the Drift" (→ ending, §9).

GATING (important — replaces the level gates for bosses in normal play): the
mini boss event may only arm once "Kindle the Ring" is complete for that
realm; the realm boss only after "Wake the Anchors". Level gates stay as a
FLOOR (mini ≥ 6, realm ≥ 8) — if the player is under-level when the quest
unlocks the boss, the tracker says "Grow stronger — reach level 6" and the
waypoint points at the densest nearby pack instead. ?test mode lifts both.

THE SIX WARDENS ARE THE SIX LIVE BOSSES (orchestrator decision 2026-09-30).
Every boss step names what the game really spawns: combat/roster.js bossKind
rows, read by combat/bossEncounters.js BOSS_BY_REALM. Cold mini = The Icewall,
Cold realm = Shrinebreaker; Sand mini = Gatekeeper of Brass, Sand realm =
Warden of the Sundered Gate; Ash mini = Furnace Guardian, Ash realm = Volcanic
Plate Knight. The first draft of this table called the Cold mini boss the
Shrinebreaker and the Cold realm boss the Moraine Elder; the Moraine Elder is
a design-park row (combatData BOSSES) with no mesh and is never spawned, so
cold.5 and cold.7 were renamed. Step titles, Echo lines, lore shards, boon
pair labels and the journal all follow this list (src/quests/storyText.js,
src/quests/questData.js).

## 3. Side content — the reason to ride to every horizon

All side content is placed DETERMINISTICALLY (hashed grid, no Math.random),
visible per realm, persisted per realm. Every landmark site hosts exactly one
activity so no landmark is scenery-only.

### 3.1 Relic Caches (exploration)
- One cache at each of the 15 landmark sites per realm (45 total).
- A cache is a small crystal-family formation at the landmark's base with a
  soft pulsing glint visible from 90 m (distance-faded).
- Interact (E, within 3 m) to open. Per realm the 15 caches are exactly:
  2 RELIC caches (§4.2), 12 LORE caches (a lore shard §3.4 + 8-15 Wake Glass
  §4.3), and 1 GRAND cache (60 Wake Glass). Assignment is deterministic by
  site index.
- Opened caches stay open (persisted). Minimap/world map show discovered ones.

### 3.2 Wake Trials (surf challenges — reward the core verb)
- 3 per realm (9 total). A trial is a line of 8-12 glowing ring gates laid
  along a real surf line on that realm's terrain (downhill-biased, validated:
  every consecutive gate pair must be surfable — grade and clearance checked
  at build).
- Start by surfing through the first gate. Timer shows top-center. Missing a
  gate by > 4 m = fail (restart at gate 1). Medals: bronze/silver/gold at
  1.35x / 1.15x / 1.0x of a par time computed from path length / 11 m/s.
- Rewards (first time each medal): bronze 20 Wake Glass, silver 40 + a wake
  trail color, gold 60 + (for the realm's third trial) a RELIC.
- Best time persisted; journal shows medals.

### 3.3 Bounties (named elites — combat with purpose)
- 3 per realm (9 total). A bounty is a named elite from that realm's roster
  (e.g. "Frostfang, the Starved" = a rimeImp at +3 levels, 2.5x HP, a unique
  tint), spawned at a marked site when the player comes within 80 m.
- Bounty board: listed in the journal from the moment the realm's spawn
  shrine is touched; each has a map marker ("last seen near the Frozen
  Crest").
- Reward: 40 Wake Glass + objective XP (15%); the third bounty per realm
  drops a RELIC. Killed bounties stay dead.

### 3.4 Lore Shards (story you find)
- 12 per realm (one in each non-relic cache) = 36 total. Each is a 1-3
  sentence fragment of the world's history, written in the Echo's voice or as
  an inscription. Collecting all 12 of a realm unlocks a journal "Chronicle"
  page and grants a free boon REROLL token.
- Lore must be coherent and escalate: Cold shards explain the anchors and the
  first Wakecaster; Sand shards reveal the Wardens were once guardians; Ash
  shards reveal what broke the world and that mending it will cost the Echo.

## 4. Rewards — every beat pays something that matters

### 4.1 Boons (build choices — PROGRESSION_DESIGN §8.3, now built)
- First kill of each mini boss and realm boss (bossesKilled-gated) opens a
  PICK-OF-TWO boon screen (pauses the game). 6 picks total.
- Use the spec's priced pairs (both options DPS-equal ±2%):
  - Cold mini: "Rime Edge — +8% frost damage" vs "Deep Chill — Chill stacks to 6"
  - Cold realm: "Glacial Guard — +10% max HP" vs "Frost Nova — the Arc chills twice"
  - Sand mini: "Quickened Spikes — Spikes cooldown −2 s" vs "Tidal Force — Wave knockback +30%, Wave damage +8%"
  - Sand realm: "Sandstep — +8% surf speed" vs "Sunder — +12% damage to staggered foes"
  - Ash mini: "Cinderbrand — +8% damage vs chilled" vs "Great Vortex — Vortex radius +15%"
  - Ash realm: "Heart of the Drift — +12% all damage" vs "Undying Wake — once per fight, survive a lethal hit at 1 HP"
- Free respec at any activated shrine (swap within the same pair).

### 4.2 Relics (curated, never random — Hades keepsakes, not loot)
- 12 relics total, exactly 4 per realm, from exactly 4 sources per realm:
  2 relic caches (§3.1), the gold medal of the realm's third Wake Trial
  (§3.2), and the realm's third bounty (§3.3).
- 2 equip slots from the start; slot 3 unlocks after the Sand realm boss.
- Equip/swap at any activated shrine. Effects are small, legible, stacking
  multiplicatively with boons. Examples (build these; all 12 needed):
  Cold: Rime Heart (Chill lasts +1 s), Frostglass Lens (bolt range +20%),
  Keel of the First (surf speed +6%), Warm Hands (mana regen +20%).
  Sand: Brass Buckle (−15% damage taken from heavies), Sand Glass (spell
  cooldowns −8%), Dune Runner (surf jump +25%), Scorpion's Patience (+10%
  damage for 2 s after a dodge-surf).
  Ash: Ember Coil (bolts ignite, 3 dmg/s 2 s), Plate Shard (+15% max HP),
  Furnace Core (vortex +20% duration), Wakemender (motes heal +50%).

### 4.3 Wake Glass (currency with a sink)
- Earned from caches, trials, bounties, boss first-kills (100/150), and a
  small trickle from elites (3 each).
- Spent at any activated shrine's SHOP:
  - Vitality I-V: +4% max HP each (60/90/130/180/240)
  - Wellspring I-V: +4% max mana each (same prices)
  - Boon Reroll token: 80
  - Wake Trail colors (cosmetic, 6): 40 each
  - Relic Slot 3 early: 400 (otherwise free after the Sand realm boss)
- Shop purchases persist; the HUD shows current Wake Glass beside mana.

### 4.4 Driftmarks (post-cap — PROGRESSION_DESIGN §9, now built)
- At level 30, overflow XP mints Driftmarks; each opens a pick of +0.5%
  damage / +0.5% max HP / +0.3% surf speed (speed capped +10%). A small
  counter on the XP bar; the pick is a one-click toast, not a modal.

## 5. Shrines become the hub (Ghost of Tsushima / Souls bonfire)

Interact (E) at an ACTIVATED shrine opens the SHRINE MENU (pauses):
- Rest — full heal + mana, sets respawn here (respawn logic already exists).
- Travel — FAST TRAVEL to any other activated shrine in ANY unlocked realm
  (cross-realm travel calls enterRealm). This is mandatory for a large
  world: without it, backtracking to caches and bounties is a chore.
- Boons — view picks, respec within pairs.
- Relics — equip / swap.
- Shop — Wake Glass purchases.
- Chronicle — shortcut into the journal's lore pages.
The Echo speaks one line the first time each shrine is activated (7 per
realm = 21 lines, each unique and short).

## 6. Onboarding — the first five minutes (PROGRESSION_DESIGN: first ding < 1 min)

1. Title → PLAY → a 3-line INTRO CARD over the key art (fades in line by
   line, skippable with any key): the premise in three sentences.
2. Spawn beside the cold spawn shrine. Tracker: "The Last Wakecaster — touch
   the shrine." Waypoint beacon on the shrine (8 m away).
3. Touch → the Echo speaks (2 lines) → "Carve Your Wake": a soft on-screen
   prompt "Hold RMB to surf" until the player has surfed 20 m, then hidden.
4. "Answer the Drift": a small imp pack is spawned 40 m ahead (forced, not
   left to the director) → prompts "LMB — bolt", "1 — Frost Arc" appear once.
   Killing 5 grants the step XP → FIRST DING inside ~60 s of game time.
5. "Kindle the Ring" opens the world: the waypoint points at the nearest
   dormant ring shrine; the journal and map get a one-time "J — Journal,
   M — Map, E — Interact" hint.
All prompts are one-time, persisted, and never shown again after completion.

## 7. UI — every element has one job

- QUEST TRACKER (top-right, the free corner): main step title + tracker text
  + distance to waypoint; up to 2 tracked side quests below it, smaller.
- WAYPOINT: (a) a world-space light column at the tracked target (crystal
  family shader, realm-tinted, visible to 400 m, fades within 15 m); (b) a
  small HUD compass tick at the top edge of the screen showing its bearing
  when it is off-screen.
- JOURNAL (J): tabs Main / Side / Lore / Stats. Main: all realms' steps with
  done/current/locked. Side: caches found x/15, trials with medals, bounties.
  Lore: collected shards in order, locked ones shown as "???". Stats: level,
  deaths, play time, completion %.
- WORLD MAP (M): full-screen top-down of the current realm (reuse the
  minimap's terrain render at larger scale), showing player, activated vs
  dormant shrines, discovered caches (opened/unopened), trials, bounties
  (known ones), boss arenas once revealed, portal once open, and the tracked
  waypoint. Realm tabs for unlocked realms. Click a shrine to set waypoint.
- DIALOGUE: bottom-center above the spellbar, speaker name + typewriter text,
  auto-advances after reading time, E to skip. Never pauses gameplay.
- TOASTS: "Quest Complete — <title>" banner (top-center, 3 s) with rewards
  listed; "Relic Found" card with name + effect; "Shrine Awakened".
- BOON PICK and SHRINE MENU are the only modals (they pause via S.freezeTime
  and release pointer lock, restoring it on close, per the existing pause
  pattern).
- Everything matches the existing frost-glass UI identity (hud.js/spellbar.js
  styles), realm-tinted where the HUD already is.
- Input: E interact, J journal, M map, Esc closes any open panel before it
  opens the pause menu. Panels must not steal the spell keys while closed.

## 8. Save schema (v4)

Extend the v3 blob — never break old saves (missing fields default):
```
quest: {
  main: { cold: <stepIndex>, sand: <stepIndex>, ash: <stepIndex> },
  surfM: <number>, killsForOnboarding: <number>,
  caches: { <realm>: [siteIndex, ...opened] },
  trials: { <trialId>: { best: <s>, medal: 0|1|2|3 } },
  bounties: { <bountyId>: true },
  lore: [<shardId>, ...],
  hintsSeen: { <hintId>: true },
  endingSeen: false
},
relics: { owned: [<id>], equipped: [<id>|null, x3], slot3: false },
wakeGlass: <int>, shop: { <itemId>: <rank> }, rerolls: <int>,
boons: [{ bossKey, pick: 0|1 }], driftmarkPicks: { dmg, hp, surf }
```
Saving follows the existing rule: on shrine touch, boss kill, level-up,
quest step, and the 10 s heartbeat.

## 9. The ending — "Mend the Drift"

After the Ash realm boss, its portal leads back to the Cold spawn shrine
(the ring closure already implemented). Touching it with all 21 shrines lit
(or the 3 spawn shrines + both bosses of every realm, whichever is reached
— do NOT require 100% shrines) triggers the ending:
1. The Echo's last lines (3).
2. A 25-35 s camera flyover rising from the shrine over the realm, the
   sky warming, all shrines pulsing.
3. Text card: "The Drift is mended." then credits (scrolling, skippable).
4. Return to play: POST-GAME — tracker says "The world is whole. Ride on."
   Caches, trials, bounties remain; driftmarks continue; a "Wakecaster"
   title shows in the journal. endingSeen persisted.

## 10. Acceptance (what "done" means for this layer)

A scripted PLAY from a fresh save, through the real UI, must show:
- intro card → spawn → tracker shows cold.1 → touching the shrine completes
  it and the Echo speaks;
- surfing 150 m completes cold.2; killing 5 completes cold.3; first ding
  < 60 s game time;
- the waypoint beacon and compass point at the nearest dormant shrine;
- activating 3 shrines completes cold.4 and ARMS the mini boss (not before);
- killing the mini boss opens the boon pick; picking applies a real,
  measurable effect (e.g. +8% damage shows in a damage number);
- opening a cache adds a relic or shard + Wake Glass; equipping a relic at
  a shrine changes the measured stat;
- a Wake Trial can be completed with a medal and its best time persists;
- a bounty spawns, is killable, pays, and stays dead;
- fast travel moves the player to another activated shrine (and across
  realms once unlocked);
- journal and map reflect all of the above;
- SAVE → reload → CONTINUE restores all quest/relic/glass/boon state;
- 36/36 enemy gauntlet, boss probes, and all existing gates still pass;
- zero page errors; perf delta ≤ +6 draw calls in a busy scene.
