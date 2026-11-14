# Arcane Realms TCG — Design Document

A polished 2D digital collectible card game rendered in Three.js/WebGL. A hybrid of
Magic: The Gathering (tap mechanic, combat depth, five-faction color pie, rarity) and
Hearthstone (auto-mana, attack targeting, fast digital pacing, secrets/traps), with
D&D-fantasy flavor throughout.

---

## 1. Research synthesis (what we borrowed and why)

Sources studied: MTG (Arena), Hearthstone, Legends of Runeterra, Eternal, Shadowverse,
plus the Hearthstone-AI competition literature.

| Problem | Winning pattern | Adopted |
|---|---|---|
| Resource randomness (mana screw/flood) makes digital games feel bad | Hearthstone auto-mana: +1 crystal/turn, refill each turn, cap 10. Reliable "X mana on turn X" curve → decks are 100% action cards, games 5–15 min | ✅ Auto-mana, cap 10 |
| Pure auto-mana removes ramp/fixing decisions | Keep ramp as a faction identity (Wildgrove gets temporary/permanent crystal effects) | ✅ |
| First-player advantage (tempo lead) | HS: 2nd player gets +1 card and The Coin. Measurably closes winrate gap | ✅ +1 card & **Arcane Ember** (0-cost: +1 mana this turn) |
| MTG blocker assignment is clunky without a stack/priority UI | HS attack-targeting: attacker picks any legal target; defense is expressed via **Guard** (taunt), stats, and traps | ✅ HS targeting + Guard |
| No interaction on opponent's turn feels flat | HS Secrets → face-down **Traps** trigger on conditions during enemy turn. Reactive counterplay without a priority system | ✅ Trap card type |
| Games stalling out | MTG-style **fatigue**: empty deck → escalating damage per draw | ✅ |
| Card advantage vs tempo must both be viable | Draw engines (Tidecall), cheap efficient threats (Emberforge), value trades (keywords) | ✅ per-realm identities |
| Turn clarity | Explicit phase flow DRAW → MAIN → COMBAT → END (MTG structure, single main) | ✅ phase bar UI |
| AI quality | Competition baseline: turn-local action-sequence search, greedy one-step lookahead + heuristic state evaluation + lethal solver | ✅ see §7 |

## 2. Core rules

- **Heroes**: both players start at **30 HP**. Reduce the enemy hero to 0 → win.
- **Decks**: exactly **30 cards**, max **2 copies** per card (**1** for Legendary).
  A deck picks up to **2 realms**; Neutral cards are always allowed.
- **Mana**: start with 1 max crystal (first turn), +1 max each of your turns (cap **10**),
  all crystals refill at your turn start. Second player gets +1 starting card and the
  **Arcane Ember** token (0-cost spell: gain 1 mana crystal this turn only).
- **Hand limit**: 10 (excess draws are burned, shown to the player).
- **Board limit**: 6 creatures per side.
- **Fatigue**: drawing from an empty deck deals 1, 2, 3, … damage to your hero.

### Turn phases
1. **DRAW** (auto): untap all your creatures, wear off summoning sickness, resolve
   start-of-turn effects (regenerate, dooms), gain/refill mana, draw a card.
2. **MAIN**: play creatures, spells, traps. No attacking yet.
3. **COMBAT**: declare attacks one at a time (each untapped, non-sick creature may
   attack once). Spells may still be cast during COMBAT (combat tricks), but **no new
   creatures** may be summoned. Entering COMBAT is one-way (plan buffs first!).
   Dragging a creature onto a target from MAIN auto-advances to COMBAT.
4. **END**: end-of-turn effects resolve; pass to opponent.

### Combat
- Attacker taps (**rotates 90°**) and deals its ATK to the target; if the target is a
  creature, it simultaneously deals its ATK back to the attacker.
- Tapped creatures **cannot attack** but still retaliate when attacked.
- **Summoning sickness**: creatures cannot attack the turn they're played (unless Swift).
- Legal targets: enemy hero or enemy creatures — subject to Guard / Flying / Stealth.
- Creatures untap at the start of their owner's turn (smooth reverse rotation).

## 3. Keywords (11 + 2 trigger words)

| Keyword | Effect |
|---|---|
| **Guard** | Enemies must attack your Guard creatures first |
| **Swift** | Can attack the turn it's summoned |
| **Flying** | Can only be attacked/blocked by Flying creatures (spells still hit it). A Flying creature with Guard, or one that is tapped, loses this evasion |
| **Stealth** | Can't be attacked or targeted until it attacks (or deals damage) |
| **Ward** | Negates the first enemy spell or effect that targets it (then breaks) |
| **Lifesteal** | Damage it deals also heals your hero |
| **Venomous** | Any damage it deals to a creature destroys that creature |
| **Cleave** | Its attacks also hit the creatures adjacent to the target |
| **Piercing** | Excess lethal damage vs a creature carries over to the enemy hero |
| **Regenerate X** | Restores X HP at the start of your turn |
| **Frenzy +X** | Has +X ATK while damaged |
| *Rally:* | Trigger word — effect when the creature is played from hand |
| *Last Rites:* | Trigger word — effect when the creature dies |

## 4. The five Realms (color pie) + Neutral

| Realm | Color | Identity | D&D flavor |
|---|---|---|---|
| **Emberforge** | Red `#e8542f` | Aggro, burn, Swift, Frenzy, dragons | dragons, goblins, forge devils |
| **Tidecall** | Blue `#2f7fe8` | Draw, bounce, freeze (tap-lock), Ward, control | wizards, water elementals, leviathans |
| **Wildgrove** | Green `#3fae52` | Ramp, big stats, buffs, Regenerate, Piercing | beasts, elves, treants, giants |
| **Dawnward** | Gold `#e8b93a` | Heal, Guard, tokens, board-wide buffs, Lifesteal | clerics, paladins, celestials |
| **Gravemire** | Purple `#8a3fd4` | Removal, sacrifice, Last Rites, resurrection, Venomous | undead, liches, demons |
| **Neutral** | Grey `#8d99ae` | Flexible mercenaries, constructs, dungeon monsters | mimics, oozes, adventurers |

## 5. Card economy

- **110 unique cards**: 18 per realm (90) + 20 Neutral.
- **Rarity**: Common 40 / Uncommon 30 / Rare 22 / Epic 11 / Legendary 7.
- Every card: unique generated artwork, name, cost, ATK/HP (creatures), rules text,
  flavor text, realm-colored frame, rarity gem.
- **Epic**: animated purple rune-glow frame + play shockwave FX.
- **Legendary**: golden dragon-frame, idle ember particles, dramatic on-play banner +
  particle burst, unique attack trails, death implosion FX.
- Collection is fully unlocked (it's a complete game, not a grind): the Collection
  screen is a browsable gallery with filters (realm, rarity, type, cost, text search).

## 6. Game modes & screens

- **Main menu**: Play vs AI (3 difficulties), Deck Builder, Collection, Settings.
- **Deck Builder**: create/edit/save/delete decks (localStorage), 2-realm rule
  enforced, live mana curve histogram, auto-complete suggestion button.
- **6 prebuilt starter decks** (one per archetype) playable immediately.
- **Settings**: music/SFX volume, animation speed, particle density, screen shake.

## 7. AI opponent

Turn-local action-sequence search (the Hearthstone-AI competition baseline):
- Enumerate legal actions (plays with all target choices, attacks with all targets,
  phase change, end turn).
- Simulate each on a cloned state → score with heuristic evaluation:
  hero HP diff (survival-weighted), board material (stat value + keyword premiums),
  card advantage, tempo (mana spent), lethal bonus.
- **Lethal solver** runs first each turn: exact check whether available attacks + burn
  reach lethal through Guards; if yes, execute the kill line.
- Difficulties: **Squire** (greedy with noise + no lookahead), **Knight** (full greedy),
  **Archmage** (greedy + trade optimizer + 2-step spell/attack ordering beam).
- AI plays the same rules engine through the same action API as the player (no cheats).

## 8. Presentation

- **Three.js WebGL**, orthographic-ish perspective onto a wooden/stone fantasy table.
- Cards are textured quads composited on offscreen canvas (art + realm frame + cost
  gem + stats + name + rules text) → crisp at any zoom via generous texture res.
- Animations (all eased, interruptible): hover lift/enlarge, play-from-hand arc,
  **tap = smooth 90° rotation**, untap reverse, attack lunge + impact shake, damage
  number pops, death dissolve + particles, draw slide, trap flip-reveal.
- Particle system: instanced quads; realm-colored impact bursts; Epic/Legendary auras.
- **Audio**: bespoke procedural WebAudio — original fantasy score (menu theme, two
  battle themes, victory/defeat stings) + ~18 synthesized SFX (play, tap, attack
  whoosh, impacts, deaths, UI, legendary fanfare). No reused tracks.
- All art generated fresh via xAI (grok-imagine-image) for THIS game. No reuse.

## 9. Testing gates

- `node selftest.mjs` — structural: engine invariants, every card resolves its effect,
  keyword semantics, trap triggers, mana/tap/phase legality, fatigue, win detection.
- `node selftest.mjs --matches` — AI vs AI full matches across all starter decks
  (deterministic seeds): must complete without exceptions, games end < 60 turns,
  winrates within sane band.
- Browser: `window.__ARC__` debug hook (`state()`, `play()`, `ff()`, `screenshot`
  helpers) + Claude Preview MCP playtesting with synthetic PointerEvents.

## 10. Slug / deploy

- Slug: `arcane-realms` · genre `cardbattler` · deploy via `pipeline/deploy_game.py`
  (status draft until owner flips publish).
- Preview: serve_nocache on port **8183**, `/games/arcane-realms/index.html?v=…`.
- REDEPLOY RULE: bump `?v=` in index.html AND all intra-runtime imports (use
  `node bump_version.mjs <n>`).
