> **HISTORICAL DOCUMENT (banner added 2026-06-10).** Superseded by the live design: ONE-GAME policy (single journal to M5 DONE; parked blocks promotions), claude -p prompts via STDIN (WinError 206 fix), XCOM detached from the nightly, legacy Phaser path quarantined behind FFG_ALLOW_PHASER=1. Current truth lives in v2_pipeline.py + engine_authoring.py docstrings and forgeflow-engine/ENGINE_GAME_API.md.

# Void Skirmish — XCOM 2 Feature Parity & Build Roadmap

Researched from XCOM 2 (2016) + War of the Chosen (2017) via the XCOM wikis,
StrategyWiki, UFOpaedia, and xcom.com dev posts (2026-05-31). This is the build
spec we measure Void Skirmish against. Status legend: ✅ done · 🟡 partial · ❌ missing.

## Parity status (tactical layer)

| Feature | Status | Notes |
|---|---|---|
| 2-action economy (shoot ends turn, dash) | ✅ | sim: actionPoints 2, shooting zeroes AP |
| Cover half/full, directional, flanking | ✅ | coverPenalty 0.2/0.4, flank ignores cover + crit 0.5 |
| Overwatch + reaction fire (×0.7) | ✅ | overwatchUnit + _triggerOverwatch |
| Suppression (−aim + reaction on move) | ✅ | Vanguard ability, −0.35 aim |
| Classes + 1 signature ability each | 🟡 | 5 classes, ONE ability each (XCOM has full trees) |
| Cinematic kill-cam (slow-mo on kills) | ✅ | camera swoop on player kills (2026-05-31) |
| Destructible cover + walls | ✅ | frag shreds cover 3→2→0 + blows wall 1→0 (2026-05-31) |
| **Concealment + pod activation (scamper, ambush)** | ❌ | **highest-value missing tactical feature** |
| Height advantage (+aim from elevation) | ❌ | maps are flat, no verticality |
| Hit math: graze band, dodge, holo-targeting | ❌ | we have aim − cover + flank only |
| Mission objectives beyond "kill all" | ❌ | timers, hack, VIP, evac, defend |
| Reinforcements (telegraphed drop-ins) | ❌ | |
| Enemy roster escalation + special mechanics | 🟡 | 4 archetypes w/ basic AI; no Viper pull / Sectoid MC / etc. |
| Spreading hazards (fire/acid/poison) | 🟡 | static hazard tiles only |
| Timed loot drops | ❌ | |

## Parity status (strategic layer)

| Feature | Status | Notes |
|---|---|---|
| Avatar doom clock | ✅ | rises per mission, clean-win pushes back, doom-out = loss |
| Persistent roster, ranks, XP, permadeath, Memorial | ✅ | Rookie→Captain, slot-aligned, barracks debrief |
| Supplies + squad upgrades | 🟡 | 2 upgrades (aim/armor); no research tree/proving ground |
| Geoscape / Avenger / regions / scanning | ❌ | |
| Research tree + Engineering + Proving Ground | ❌ | |
| Soldier customization / bonds / fatigue (WOTC) | ❌ | names + ranks only |
| Black Market / Intel / Elerium economy | ❌ | supplies only |
| Dark Events / Covert Actions / Resistance Orders | ❌ | |
| The three Chosen (recurring rival bosses) | ❌ | |

## Recommended build order (next)
1. **Concealment + pods** — squad starts concealed; enemies in 2-3 pods that don't act until their pod is revealed (LOS or attack), then scamper to cover. Ambush shots from concealment ignore the overwatch penalty. *Mostly sim-side, headless-testable; transforms the tactical opening.*
2. **Mission objective variety** — add a turn-timer + a "hack the relay" / "reach evac" objective type to the mission schema and sim end-conditions.
3. **Height advantage** — add an elevation field to tiles; +aim when shooting downward; multi-level buildings you can climb.
4. **Enemy special mechanics** — give archetypes signature moves (a "Viper" tongue-pull, a "Sectoid" mind-control, a Muton-grade tank) and escalate composition by mission.
5. **Reinforcements** — telegraphed enemy drop-ins on a schedule on timed missions.
6. **Strategic depth** — research/upgrade tree feeding the roster; more Avatar-pushback paths.

---

## Full researched checklist (XCOM 2 + WOTC)

> Defense is on a 0–100 scale (1 Defense = −1 enemy hit%). [WOTC] = War of the Chosen. [uncertain] = not pinned to a canonical numeric source.

### Action economy
- 2 AP per unit per turn. Blue move = 1 AP (inner ring); Yellow/Dash = 2 AP (outer ring, ends turn).
- Two blue moves cover less than one yellow dash for the same 2 AP.
- Abilities: 2 AP (teal), 1 AP (green), or 0 AP/free (purple). Move-then-shoot allowed; shoot-then-move generally not.

### Cover
- Low/half = +20 Defense; High/full = +40. Hunker Down = +30 Def / +50 Dodge (ends turn).
- Directional; only the higher of two same-side covers applies. Flanking ignores cover Defense + grants crit. Cover is destructible.

### Height advantage
- Shooting from higher elevation = flat **+20 Aim** to the attacker.

### Concealment & pod activation
- Squad usually starts concealed. Enemies move in pods (2-3, larger late). Reveal on attack / being seen / detection radius.
- On reveal the pod **scampers** to cover (no shot that turn). Shots from concealment ignore the overwatch aim penalty (ambush). Ranger Phantom + [WOTC] Reaper Shadow keep personal stealth.

### Overwatch / suppression
- Overwatch fires at first enemy that moves in range; **×0.7** vs normal mover, **×0.6** vs dasher; **×1.0** from concealment.
- Suppression: −50 Aim + reaction shot if target moves (2 ammo).

### Hit math
- Hit% = Aim − Defense ± mods, clamped 0–100. Cover subtracts Def; height +20 aim; flanking ignores cover + ~+40–50 crit [uncertain].
- Holo-Targeting marks a target → squad +to-hit (≈+10/+15/+20 by tier [verify]). Squadsight = shoot what allies see, distance aim penalty [uncertain]. [WOTC] Graze Band default ±10 (downgrades a hit to a graze). Dodge demotes a result one tier (crit→hit→graze→miss); only vs <100 aim; each aim>100 cancels 1 dodge.

### Classes (base) + signature abilities
- **Ranger**: Slash, Phantom, Blademaster, Run & Gun, Bladestorm, Shadowstrike (+25 aim/+25 crit from concealment), Rapid Fire, Reaper (capstone).
- **Sharpshooter**: Squadsight, Deadeye, Lightning Hands (free pistol), Death From Above (sniper kill on lower target refunds action), Faceoff, Kill Zone, Serial (capstone).
- **Grenadier**: Launch Grenade, Shredder (armor shred), Demolition, Heavy Ordnance, Blast Padding, Holo Targeting, Salvo, Saturation Fire (capstone).
- **Specialist**: Gremlin, Aid Protocol, Combat Protocol, Medical Protocol, Haywire (hack robots), Revival Protocol, Capacitor Discharge (capstone); general hacking.
- **Psi Operative** (trained in Psi Lab): Soulfire, Insanity, Stasis, Void Rift, Domination (perma-MC, once/mission), grid-trained non-linearly.

### [WOTC] hero factions
- **Reaper** (Shadow stealth, Claymore, Banish). **Skirmisher** (Grapple, Justice, Interrupt, Battlelord, two attacks/turn). **Templar** (Rend→Focus, Volt, Momentum, Parry, Ionic Storm).

### Kill / action cam
- Procedural "action camera": overhead → close over-the-shoulder/low angle on the actor, tracks the shot. **Slow-mo on kills and overwatch reaction shots.** Toggleable. Exact swoop/dwell/FOV not published [uncertain] — implement to taste.

### Environmental destruction & hazards
- Walls/floors/roofs/cover destructible; destroying a floor drops units a level. Cars explode (1-turn fuse) for AoE, can chain.
- Fire 1-3 dmg, organic only, blocks abilities, spreads. Acid 1-3, organic+mech, DoT/armor degrade, pools persist. Poison 1/turn + −aim/−mobility, organic, gas lingers. ADVENT immune to fire/poison. Explosions destroy loot.

### Verticality / LOS
- Multi-level maps (roofs, floors, catwalks). Grapple for vertical reposition. LOS + fog of war; Squadsight extends shooting range to allied vision.

### Mission objectives
- Hack workstation/relay (~8 turns). Destroy relay (timer). Defend device (~30 HP). VIP extract (~12 turns to evac). VIP capture (KO + carry to evac = Supplies+Intel) vs kill (Supplies). Evac flare → Skyranger arrives in several turns [WOTC]. Retaliation: rescue ≥6 of ~13 civilians. Many missions turn-timed.

### Reinforcements
- Red flare marker at start of enemy turn shows drop tile; troops drop next turn (telegraphed 1 turn). Prefer flanks; arrive on a schedule.

### Enemy roster escalation
- Early: ADVENT Trooper/Officer, Sectoid (mindspin/reanimate), Viper (tongue-pull/bind/poison), Faceless.
- Mid: ADVENT MEC, Muton (counterattack), Stun Lancer, Berserker, Chryssalid (poison, eggs), Shieldbearer.
- Late: Andromedon (acid, husk-suit on death), Archon (flying AoE), Codex (teleport/clone/psi-bomb), Gatekeeper (reanimate, AoE), Sectopod (huge). Avatar (boss).
- [WOTC]: The Lost (zombie swarms, free headshot chain), Spectre (shadow-clone), Purifier (flamethrower), the three Chosen.

### Loot
- Killed enemies may drop loot: 3×3 radius marker, **3-turn timer** to grab or lose it. Contents: mods, PCS, Elerium Cores, data. Explosions destroy loot. Vulture upgrade = more drops.

### Strategic layer
- **Avatar Project**: 12-block bar fed by alien facilities; full → Doom Countdown (24/22.75/15/27.33 days by difficulty). Reduce via facility assaults, story missions, skulljacks, [WOTC] covert actions.
- **Avenger** mobile base; world regions need Contact (Intel + Resistance Comms). Scan sites for rewards.
- **Avenger rooms**: 12-room grid (4×3), debris cleared by Engineers. GTS, Advanced Warfare Center, Proving Ground, Lab, Workshop, Power Relay, Resistance Comms, Psi Lab, Shadow Chamber, [WOTC] Training Center / Resistance Ring / Infirmary.
- **Research** (Scientists) → weapon/armor tiers (Conventional→Mag→Beam/Plasma) + autopsies. **Proving Ground** (Supplies-cost experimental gear, Skulljack). **Engineers** staff facilities.
- **Ranks**: Rookie→Squaddie→Corporal→Sergeant→Lieutenant→Captain→Major→Colonel. Rookie gets a random class at first promotion. Kill thresholds (Rookie diff): 1/5/12/24/38/57/81. One promotion per mission. Two-ability choice per rank. Permadeath + Memorial. Nicknames at Sergeant.
- **[WOTC]** Will/fatigue (Tired→Shaken), Bonds (compatibility → bonus AP/aim/dual strike), Training Center respec.
- **Economy**: Supplies (build/buy), Intel (contact/black market), Elerium Crystals/Cores (advanced gear), Alloys, corpses. Black Market buys with Intel / sells for Supplies (2-3 boosted items/month).
- **Dark Events** (cancel one via Guerrilla Op). Resistance Havens. [WOTC] Covert Actions (timed off-map, rewards/risks), Resistance Orders (passive monthly bonuses), Faction Influence, the three **Chosen** (Assassin/Hunter/Warlock — random strengths/weaknesses, capture soldiers, resurrect until Stronghold assault).
