# HIT PARADE — Design v1 (fighting-game pivot; numbers pending FIGHTING_DESIGN / NETCODE research)

Owner rules: NO PIRATES (fighting game — no pirate framing, bodies, props, nautical theming).
Street Fighter structure: arcade ladder vs CPU → MINI BOSS → BOSS; local + ONLINE PVP with the
same roster; 8-12 fighters with their own moves, attacks and specials. I am the game designer.

## Fiction
KNOCKOUT 13 is an underground fight network that takes over the late-night airwaves every Friday
with HIT PARADE — a live, no-rules fight show shot on condemned sets across a rotting city.
Fighters sign up for money, revenge or fame; the season ends when one of them beats the network's
monster (THE FREAK) and then the host himself.
- **Host: RICKY MARQUEE** — sequined jacket, microphone-cane, relentless smile; caption cards and
  stingers are the commentary layer; FINAL BOSS.
- **Stage manager: DEE-DEE DIAL** — deadpan UI voice ("ROUND ONE", "COMMERCIAL BREAK", "SUDDEN
  DEATH", "RATINGS SPIKE").
- The **crowd** (stylised cartoon people, never pills) and the **RATINGS** are systems.

## Pillars
1. **Every hit is a show** — heavy, readable impacts; hit-stop, punch-in, smear, splatter
   (settings toggle → sparks/confetti); the crowd and host react to what actually happened.
2. **A real fighting game** — honest frame data, distinct kits, readable 1v1, fair online play.
3. **Brutal but comic** — over-the-top supers/finishers, wall splats, slams; no realistic gore.
4. **Pick up and play, deep to master** — SIMPLE controls (special button + direction) and CLASSIC
   motion inputs; the same frame data underneath.

## Modes
- **THE SEASON (Arcade)**: pick a fighter → 6 ranked bouts vs roster CPU (difficulty ramps) with a
  **BRAWL BREAK** bonus round after bout 3 (the reference's crowd beat-down: survive waves of
  studio goons for score) → **MINI BOSS: THE FREAK** → **BOSS: RICKY MARQUEE** → per-fighter
  ending card + ratings total. Bouts are best-of-3 rounds with a round timer.
- **VERSUS**: local 2 players (split keyboard / two gamepads), vs CPU (pick difficulty).
- **ONLINE**: Quick Match and private Room Code, same roster and stages, rematch loop, W/L
  (+rating when both signed in, reusing the FFG ratings RPC).
- **TRAINING**: dummy (stand/crouch/block/jump/CPU), move list, input display, frame data readout.
- **Unlocks/save**: boss + mini boss playable in Versus after clearing the Season; colour
  alternates; per-fighter Season clears.

## Roster (10 playable + mini boss + boss) — kits built from the animation sources we own
Bodies are chosen by the characters lane (Mixamo library); names/looks are original.
| # | Fighter (working) | Style / archetype | Signature sources |
|---|---|---|---|
| 1 | DUKE DUCHAMP — "The Champ" | boxer all-rounder: dash straight, rising uppercut (anti-air), weave counter; super MAIN EVENT flurry | CMU boxing takes |
| 2 | KIRA VOSS — "The Striker" | kickboxer rushdown: spinning heel, rising knee, flying kick; super HIGHLIGHT REEL | CMU kicks / spin + jump kicks |
| 3 | SPIN CRUZ — "B-Boy" | trickster low-profile: flair sweeps, handstand kicks, footwork stance | Breakdance pack |
| 4 | THIRSTY LU — "Drunken Fist" | unpredictable feints, stumble-dodges, bottle spit (fire) | Male_Drunk pack + CMU |
| 5 | GAZZA KANE — "Goal Line" | zoner-striker with a ball projectile, slide tackle, header, scissor-kick super | Soccer pack |
| 6 | BRUNO "THE FRIDGE" | grappler big body: command slams, body block armour, flex buff | Brute body; goalkeeper/throw-in; creature flex |
| 7 | OFFICER KRANE — "Riot Act" | riot shield + baton: shield bash, parry stance, taser shot | Sword_and_Shield pack |
| 8 | THE BUTCHER | slow heavy-hitter with a cleaver: hook-grab, overhead chop, rage | Pro_Melee_Axe pack |
| 9 | THE GREAT ZAMBINI | stage magician zoner: card fans, fireball, teleport, trapdoor | Magic spell packs |
| 10 | RERUN | undead contestant: crawl low-profile, bite command grab, won't stay down | Scary_Zombie pack |
| MB | THE FREAK | mini boss: super-armour mutant, leaping smash, roar | Creature pack |
| B | RICKY MARQUEE | boss showman: mic-cane combos, stage-light pyro, trapdoors, audience vote | Great_Sword + magic + gestures |

## Stages (TV sets) — no pirate/nautical sets
THE RUST THEATER (the reference's blue brick pit) · BUTCHER BLOCK (cooking-show meat locker) ·
WHEEL OF PAIN (neon game-show floor) · CHANNEL 13 ROOFTOP (night, rain) · THE CONTROL ROOM
(finale under the studio; boss stage). Each stage: crowd, wall/corner splats, breakable dressing.

## TV frame (UI)
Show logo bug + LIVE top-left, SCORE/RATINGS top-right in a slanted comic frame, fighter
portraits + health + HYPE (super) bars, ROUND pips + timer centre-top in versus, host caption
card, combo counter with style words (SOLID / SPICY / BRUTAL / PRIME TIME / SYNDICATED).
