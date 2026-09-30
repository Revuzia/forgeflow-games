# Design lane - source notes (fetched 2026-09-29)
Each entry: URL - what was actually read - key facts (paraphrased; numbers as fetched). Raw page copies were used only as a session cache and are not kept in the project.

## MadWorld
- https://madworld.fandom.com/wiki/Bloodbath_Challenges (read via Fandom api.php wikitext)
  - Bloodbath Challenges: time-limited (a few minutes) bonus events announced by the Black Baron; off-objective kills still give normal points but no bonus.
  - Combo names for rapid successive objective kills: 2 Double, 3 Triple, 4 Slaughter, 5 Massacre, 6 Genocide, 7+ Madness.
  - Examples: Turbinator (toss into jet engine), Rocket Reamer (train), Death Press (spiked press every few seconds), Man Darts (bat into dartboard), Hanabi (barrel fireworks), Man Golf.
  - Two commentators (Howard "Buckshot" Holmes + Kreese Kreeley) do double-act banter.
- https://en.wikipedia.org/wiki/MadWorld (Gameplay section via api.php)
  - Boss is gated behind a point threshold; other challenges/mini-bosses unlock at point thresholds; boss must be beaten within a time limit.
  - Points per defeat increase with foe power and more unusual methods - e.g. a wall throw is worth much more if a tire was jammed on the enemy first (stacked setups).
  - Boss finishers = "Power Struggles" (QTE), also on some normal enemies.
  - Designer frames the violence as comic.

## Bulletstorm
- https://bulletstorm.fandom.com/wiki/Skillshots (api.php)
  - Tiers: blue 25 sp, yellow 50 sp, red 100 sp; secret one-offs 1250/1750; first-time performance = 5x.
  - Multi-kill: sp x N enemies x N again (3 kills of 50 -> 450).
  - Stackable skillshots. 135 skillshots total. Examples: Graffiti 25 (kick into surface), Shocker 100 (fling into electricity), Voodoo Doll 100 (fling onto sharp metal), Vertigo 50 (huge drop), Bossed 250 (kill miniboss).
- https://en.wikipedia.org/wiki/Bulletstorm - launched enemies go into slow motion enabling skillshots; points are currency at dropkits.

## Devil May Cry Stylish Rank
- https://devilmaycry.fandom.com/wiki/Stylish_Rank (api.php)
  - D..SSS letter grades; repeated moves give diminishing returns; taunts add style but not in succession.
  - Gauge decays with inactivity, decays faster at higher grades; DMC1 loses rank after 1.5 s idle.
  - DMC4/5: taking damage drops 2 grades (B->D, A->C, S/SS/SSS->B).
  - Rank at enemy death sets orb payout; DMC5 announcer voices B..SSS and taunts when hit at S+; DmC/DMC5 music changes with rank.

## Batman Arkham Freeflow
- https://arkhamcity.fandom.com/wiki/Freeflow_Combat (api.php)
  - Freeflow begins at the 3rd multiplier; combo ends on failed counter, hitting air/shielded enemy, or idling for more than about 1 s.
  - Special move unlocked at 8x (5x with upgrade), meter resets after use.
  - Critical strike = +2 multiplier if not mashing. Arkham Knight: environmental takedowns (objects highlighted blue), weapons break after 3 hits, thugs grab from behind.
- WebSearch summary (medium.com/@paple124 result): attack ticket system - e.g. 15 enemies, 4 tickets.

## Group AI
- Game AI Pro ch.28 "Beyond the Kung-Fu Circle" (Michael Dawe, Kingdoms of Amalur) http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter28_Beyond_the_Kung-Fu_Circle_A_Flexible_System_for_Managing_NPC_Attacks.pdf (PDF read in full)
  - 8-slot world-aligned grid around the player; grid capacity (example 12) vs creature grid weight (soldier 4, troll 8); attack capacity (example 10) vs attack weight (troll charge 6 / club 4; soldier lunge 5 / swing 3).
  - Approach circle (outer) + attack circle (inner = melee min/max distance); unassigned creatures stand outside the outer circle in front of a free slot (natural flanking).
  - Slot released immediately after launching an attack -> rotation; stage manager can steal slots for better-positioned creatures.
  - Difficulty = scale grid capacity and attack capacity, not per-creature weights.
- https://www.strayspark.studio/blog/attack-token-system-ue5-group-combat-that-feels-fair
  - Baseline pools: melee 1, ranged 2, heavy 1; rings melee ~150-250 cm, mid ~500-800 cm, far ~1200-2000 cm; aggression scalar 0.5-1.5x; token audit every ~2 s. Rationale: players can track about one incoming melee attack plus a couple of ranged shots at once.
- https://www.gamedeveloper.com/design/cyber-demons-the-ai-of-doom-2016- (search summary) - DOOM: each attack type has limited tokens; demons request/release; non-token demons strafe/advance.

## Sifu
- https://blog.playstation.com/2021/11/18/how-sifus-kung-fu-combat-works/
  - Structure gauge for player and enemies; break it -> takedown. Blocking fills gauge quickly; parry deflects and unbalances; avoid (duck/jump) recovers balance.
  - Focus charge slows time, choose a weak point.
  - dynamic camera lock for target switching; 60 fps.
- https://www.nexusmods.com/sifu/mods/1280 (search summary) - ParryFix mod extends parry window "from 10 to 24 frames" (implies vanilla 10 frames = 167 ms at 60 fps; per mod author, unverified by us).

## Fighting-game hitstop / hitlag
- WebSearch summary of shoryuken.com/2016/06/07/hitstop-in-street-fighter-v-kens-not-so-little-secret/ : SFV light 8f, medium 12f, heavy 15f hitstop (Ken mediums 10, heavies 12). Direct page fetch failed (JS redirect).
- WebSearch summary citing SuperCombo SSF2T: light/medium/hard 11/16/20 (labelled "stun" in summary - treat as unverified).
- https://www.ssbwiki.com/Hitlag (search summary): Ultimate hitlag = floor((d*0.65+6)*h*e...) frames, cap 30 frames.

## Arkham Counter
- https://arkhamcity.fandom.com/wiki/Counter (api.php)
  - Counter adds 1 multiplier and scores 10 points per multiplier, same as a strike (strike score = 10 x current multiplier).
  - Arkham City+: up to 3 enemies countered simultaneously; lightning-bolt counter icon above the attacker's head as telegraph.
  - Last standing enemy: counter finishes him (Knight: up to 3 last enemies).

## Smash Bros (hitlag / hitstun / buffer) - https://www.ssbwiki.com (api.php)
- Hitlag freezes attacker AND victim; attacker hitboxes stay active during hitlag; victim shakes in first flinch frame.
- Brawl/Smash4 hitlag = floor((d*0.3846154+5)*h*e); Ultimate = floor((d*0.65+6)*h*e*s)...; capped at 30 frames.
- Ultimate SCALES HITLAG DOWN with player count above 10 frames: multiplier at 30f = 0.925 (3p), 0.862 (4p), 0.75 (8p). (Relevant: multi-enemy brawls should shorten stacked hitstop.)
- Hitstun proportional to knockback: Melee 0.4 frames/unit; SSB64 0.533.
- Buffer: Brawl/Smash4 10 frames at end of animations; Ultimate 9 frames + hold-to-buffer.

## God Hand - https://en.wikipedia.org/wiki/God_Hand (api.php)
- Four dodges on the right stick; Tension gauge fills on hits/dodges/taunts -> timed invincible God Hand mode; God Roulette super moves cost 1-3 orbs.
- Dynamic difficulty bar levels 1, 2, 3, DIE: rises on unanswered hits dealt + dodges, drops when you get combo'd. At levels 1-2 enemies do NOT attack unless in the player's line of sight or being attacked; at 3/DIE they attack regardless of camera. Higher level = more end-of-stage bonus points.
- Enemies "mostly engage one-on-one" early; at higher levels they surround/flank and use team attacks.

## Sleeping Dogs - https://en.wikipedia.org/wiki/Sleeping_Dogs_(video_game) (api.php)
- Melee = attack / grapple / counter; face meter fills faster with varied moves in rapid succession or environmental attacks (drag enemy to highlighted object). Weapons break with use. Triad XP proportional to move complexity.

## No More Heroes - https://en.wikipedia.org/wiki/No_More_Heroes_(video_game) (api.php)
- Death blow via on-screen gesture prompt; stunned enemies can be thrown with wrestling moves; "Dark Side" slot machine after a death blow grants a random power-up (up to killing every enemy on screen).

## Yakuza / Like a Dragon - https://yakuza.fandom.com/wiki/Heat_Actions (api.php)
- Heat gauge separate from health, fills on landing attacks/grabs; spend a segment for a contextual Heat Action (depends on wall/railing proximity, held object, number of nearby enemies, health state).
- Some Heat Actions add QTE for extra damage at extra Heat cost; enemies/bosses have Heat Actions too. Yakuza 3 "Red Heat" = last 3 bars unlock new actions.

## Streets of Rage 4 - https://streetsofrage.fandom.com/wiki/Streets_of_Rage_4 (api.php)
- Anti-infinite: every enemy auto-falls after taking up to 8 hits (counter resets when it recovers from hitstun).
- Wall bounces max 3 per combo; OTG lift once per combo; ground bounces unlimited; counters reset when enemy returns to neutral.
- Jump start-up has i-frames; ground tech on landing gives brief invincibility.
- Score: 1 point per 1% damage; combo bonus = (damage/6)^1.5 * 2; breakables extend and add hits; pickups extend; taking a direct hit breaks combo and awards nothing; combo cashes out after ~4 s without a hit.
- Combo tiers by combo damage: 60 Nice (62+ pts), 120 Great (179+), 200 Super (385+), 350 Excellent (891+), 520 Amazing (1614+), 700 Sick (2520+), 1000 Out Of This World (4303+).
- Specials cost health shown as green "recoverable health" refilled by landing hits; lost on taking a hit. Star Moves = limited supers, invulnerable.
- Six difficulties; higher = more enemies on screen, stronger variants earlier, smarter AI; Mania+ enemies faster and read inputs.
- Assists (extra lives/stars) apply an end-of-level score penalty.

## MadWorld point values (madworld.fandom.com api.php)
- https://madworld.fandom.com/wiki/Finishers - finishers are the main point source (thousands each); punches/kicks deal damage; environmental kills usually kill instantly; spikes can be slammed repeatedly (4 times); impalings up to 5 per enemy; boss finishers earn no points.
- https://madworld.fandom.com/wiki/Tire - 6,000 jammed onto enemy / 1,000 thrown; immobilizes until he frees himself.
- https://madworld.fandom.com/wiki/Rose_Bush - 10,000 thrown / 30,000 slammed ("Murder").
- https://madworld.fandom.com/wiki/Sign_post - 20,000 each, up to 5 per enemy.
- https://madworld.fandom.com/wiki/Explosive_Drum - multi-kill (six + miniboss) can earn "Ultra Violence rating".
- https://madworld.fandom.com/wiki/Turbinator - unlocked at 200,000 points; 3 rounds, 90 s total (single player).
- https://madworld.fandom.com/wiki/DeathWatch_Challenge - optional per-level objectives worth 300,000-900,000 (e.g. "Score 3200000 points!" = 900,000; "Kill the boss in 15 minutes!" = 300,000).
- https://madworld.fandom.com/wiki/Power_Struggle - boss/miniboss gesture QTE; fail = heavy damage/instant death, win = big damage.

## Tekken (wavu.wiki api.php)
- https://wavu.wiki/t/Juggle - combo = launcher, 3-5 aerial filler hits, extender (tornado), ender (- wall combo). Aerial damage scaling per hit: 70%, 50%, 40%, 30% (4+). After a wall hit all subsequent hits x0.8. Grounded hits base 80%. Counter hit = 120% damage.
- https://wavu.wiki/t/Wall - wall splat: opponent slides off wall, briefly intangible, then 6 frames of wall slump before tech roll.
- WebSearch summary citing wavu.wiki movelists: generic Tekken 8 jab i10, +1 on block, +8 on hit.

## Street Fighter 6 measured frame data
- https://ultimateframedata.com/sf6/ryu (raw HTML parsed by us -> ufd_sf6_ryu_table.txt). Startup/active/recovery/total/onhit/onblock:
  - 5LP 4/3/7/13 +4/-1; 5MP 6/4/11/20 +7/-1; 5HP 10/5/18/32 +4/-2; 5LK 5/3/11/18; 5MK 9/3/18/29; 5HK 12/4/20/35 +9/+1
  - 2HK sweep 9/3/23/34 knockdown +40 / -12
  - Shoryuken LP 5/10/33/47 KD +38 / -23; HP 7/10/46/65
  - Forward throw 5/3/23, 30 whiff / 96 hit
  - Level 3 super startup 5, total 87
- Derived by us (not stated by source): hitstun ~= on-hit advantage + (active-1) + recovery -> 5LP ~13f, 5HP ~26f (excludes hitstop).
- WebSearch summaries (SuperCombo SF6 pages, direct fetch blocked by Anubis): input buffer = any move buffered up to 4 frames early (5-frame window); counter hit +2 advantage and +20% damage; throws 5f startup / 3f active; throw escape window until the 9th frame of being thrown.
- WebSearch summary of shoryuken.com hitstop article: SFV hitstop light 8f / medium 12f / heavy 15f (as quoted: "on block").

## Parry / deflect windows
- https://sekiroshadowsdietwice.wiki.fextralife.com/Deflection - deflect window 12 frames (0.2 s before hit); spam shrinks it to 4 or 0 frames; penalty resets after 30 frames or on a successful deflect; guard pressed too early still guards.
- https://devilmaycry.fandom.com/wiki/Royalguard_Style (api.php) - DMC5 perfect Royal Block window 6 frames, unchanged from earlier games; normal block drains DT gauge instead of chip.
- Sifu ParryFix mod (nexusmods 1280) - "from 10 to 24 frames" (mod author's claim of vanilla 10 f).

## Telegraph / reaction
- https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/ - Anticipation -> Attack -> Recovery; anticipation = reaction time + ability trigger time + difficulty buffer; reaction = 0.25 s (15 f at 60 fps); input lag target < 100 ms; each anticipation pose must be unique in silhouette.
- https://note.com/darkangels_417/n/nb520b22d60f7 - average player needs > 0.3 s to perceive, decide and press; up to 3 s telegraph may be needed for novices / busy screens; telegraphs get buried in busy 3D scenes.
- https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4374455/ (search summary) - 1,469 subjects, mean simple RT 231 ms (213 ms hardware-corrected), rising with age.

## Camera
- http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf (PDF read in full)
  - Trauma in [0,1]; hits add +0.2 or +0.5; decays linearly; shake = trauma^2 or ^3 (trauma 0.30/0.60/0.90 -> 3%/22%/73% shake, cubic).
  - 3D: ROTATIONAL shake only (translational judged poor in 3D); use Perlin noise (works with pause/slow-mo).
  - Asymptotic averaging x += (target-x)*0.1 per frame, scale weight by timeScale; asymmetric per-axis weights.
  - Framing: primary focus (player) never leaves view; secondary (targeted enemy) should not; points of interest weighted by proximity*importance with inner/outer feathering.
- https://blog.playstation.com/2022/10/04/game-developers-explain-what-makes-god-of-war-2018s-combat-tick/ - hit stop snaps the target into its hit pose and holds attacker and target on that first frame; pulled-back camera for FOV and target tracking; reduced camera shake for legibility; yellow/red ring attack indicators.
- https://critpoints.net/2015/05/24/what-is-your-ideal-form-of-lock-on-in-action-games/ - hard lock vs soft lock vs camera lock; soft-lock struggles with groups; recommends held (not toggled) hard lock as optional tool.
- UE5 third-person template (search summary: forums.unrealengine.com, uhiyama-lab): SpringArm TargetArmLength 400 cm, camera FOV 90 (horizontal), camera lag speed 3.0.
- Sifu (search summaries, nexusmods 90 / Steam): community complains default FOV restrictive; wall proximity zooms in so only hero's back visible (Unreal interview summary).

## Mobile
- Search summaries: Apple HIG min 44x44 pt; Material 48x48 dp (~9 mm); >= 8 dp spacing. Floating joystick (zero at touch-down point) recommended; keep press alive when thumb slides outside the button.
