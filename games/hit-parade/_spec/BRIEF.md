# HIT PARADE — owner brief + reference analysis (2026-09-29)

## The ask (owner, verbatim)
"I want a full game built like this https://x.com/PlayworksDennis/status/2104975210604863750"

Standing owner rules that apply (memory): the game ships WEB-playable on the ForgeFlow Games CDN
(unpublished; the catalog toggle is the owner's), it is built to completion without stopping at
checkpoints, the cover is xAI key art via `pipeline/generate_cover.py`, no primitive hero assets,
cartoon-quality crowds (never pills), full ORIGINAL IP (no names/logos/likeness from the reference).

## The reference: "AIN'T DEAD YET" by Dennis Opel (UE5, early WIP, 24 s clip)
Post text: a beat 'em up that is "Fast. Physical. Brutal. And built around making every fight feel
like a show. Because it's on a show." Dev bio: "A Mad World, Fist of the North Star and
Grasshopper inspired beat em up."

What the 24 s clip shows (observed frame-by-frame at 1 s steps):
- **3D, close third-person camera** behind/beside the hero, low and tight (fighters fill ~60% of
  frame height). Camera swings dynamically around the exchange; heavy **motion blur** on blows.
- **Stylised, saturated, cel-leaning look**: blond muscle brawler in a bright yellow tank top and
  black trousers; thugs in red shirts; arena of **blue-painted stone brick walls, iron-banded wooden
  doors, a wall torch, stone floor**. Strong rim/bounce light, chunky proportions.
- **Combat beats seen**: jab/hook exchanges, a body blow that doubles the thug over, a **ground
  slam / takedown** (hero body-slams a thug to the floor), **wall-splat** (thug hits the wall), a
  thug knocked flat then **stomped / ground-pounded**, a spinning back-fist, a big overhead
  **finisher that bursts red comic-style blood splatter** (paint-like splash, not realistic gore).
- **Hit-stop + camera punch-in** on heavy impacts; bodies fly with real weight.
- **TV-show HUD**: show logo bug top-left ("AIN'T DEAD YET · DEATH MATCH · The Iron Theater") with a
  small LIVE indicator; **SCORE** counter top-right in a slanted yellow comic frame; **hero portrait
  + name + health/special bars** bottom-left; **Round N + timer** bottom-right.
- Genre DNA from the dev's own words: MadWorld (TV death-show, points for brutal style, environment
  kills, announcer commentary), Fist of the North Star (exploding finishers, pressure-point
  flurries), Grasshopper/Suda51 (punk attitude, weird hosts, bosses with personality).

## Our game: HIT PARADE (original IP — working title, owner may rename)
**Owner rule (2026-09-29): NO PIRATES — this is a FIGHTING game.** No pirate framing, no pirate
characters (skip the Mixamo "Pirate" body), no pirate props/kits, no nautical theming.

An underground fight network broadcasts a lethal prime-time brawl show from condemned sets. You are a
contestant who has to survive every episode of the season — and win the ratings — to get off the
show. Every hit is scored; the crowd and the ratings meter are part of combat, not decoration.
"Every hit's a hit."

**Owner direction #2 (2026-09-29, verbatim):** "this game should also have PVP option. think street
fighter, we go up against the PC until we get thru to mini boss, then boss. then we can also PVP vs
others using those characters. I would say a minimum of 8-12 characters with their own moves,
attacks, specials, etc. You are the game designer though so you will figure this out."
→ HIT PARADE is a **3D VERSUS FIGHTING GAME** (Street Fighter structure) wearing the reference's
brutal TV-show skin:
- ARCADE ("THE SEASON"): a ladder of 1v1 bouts vs CPU fighters from the roster → MINI BOSS → BOSS,
  hosted as a TV season (the reference's beat-'em-up crowd fight survives as a BRAWL BREAK bonus
  round between bouts, like SF's bonus stages).
- VERSUS: local 2-player, vs CPU, and ONLINE PVP (quick match + private room code) with the same
  roster. Online must feel like a fighting game (deterministic sim + rollback-style netcode).
- ROSTER: 8-12 playable fighters, each with its own normals, specials, super, throws, taunts,
  intro/win poses, and a distinct play style; plus a mini boss and a boss.
- TRAINING mode (move list, dummy) so players can learn each fighter.

**Owner direction #3 (2026-09-30, verbatim):** "this should not be a flat 2d arena/match it should be 3d or
circular where we can walk around the ring to fight" -> HIT PARADE is a full 3D ARENA fighter (Tekken / Soul
Calibur family): sidestep + circle-walk around the opponent inside 360-degree ring arenas, orbit camera.
Supersedes the 2.5D-plane decision. Spec: CONTRACT.md section 35.

Non-negotiables for "built like this":
1. 3D fighter, fast and weighty, with real mocap-quality animation. Versus bouts use a
   fighting-game camera (side-on, dynamic, punch-ins and cinematic cuts on supers/finishers);
   the BRAWL BREAK bonus round uses the reference's close third-person framing.
2. The TV show is the game's frame: live HUD, host/announcer captions, crowd reactions, ratings
   meter that multiplies score and powers finishers, episode/round structure with a timer.
3. Brutal-but-comic impact language: hit-stop, camera punch, motion blur/smear, speed lines,
   comic red splatter (a settings toggle swaps it for sparks/confetti), wall splats, ground slams,
   stomps, grabs/throws, finishers, environment kills.
4. A FULL game: 8-12 distinct fighters + mini boss + boss, several stages (distinct TV sets),
   arcade ladder with per-fighter endings, versus (local/CPU/online), training, menus, settings,
   pause, save/unlocks, results/ratings screens, audio (music + SFX + crowd), mobile touch play.
