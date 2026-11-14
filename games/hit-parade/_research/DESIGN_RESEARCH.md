# HIT PARADE - 3D Beat 'em Up Design Research (lane: design)

Status: COMPLETE (2026-09-29). Supporting notes: `_research/design/sources.md` (every fact with its URL,
paraphrased), the parsed SF6 table `_research/design/ufd_sf6_ryu_table.txt`, and runnable calculators in
`tools/research/` (`wikifetch.py` fetches MediaWiki pages):
`framedata_check.py` (chain/cancel math), `camera_framing.py` (camera distance/FOV math),
`scoring_example.py` (score + ratings worked example). Their outputs are saved next to the notes
(`framedata_check_output.txt`, `camera_framing_output.txt`, `scoring_example_output.txt`).

Evidence labels used throughout:
- **[S]** sourced - a number or rule read from the cited URL this session (a few are marked "search
  summary" where the page itself blocked fetching and only the search engine's extract was read).
- **[D]** derived - computed by us from sourced numbers (the calculation is shown or scripted).
- **[R]** recommendation - our design proposal for HIT PARADE. Recommendations are starting values to be
  tuned by persona playtests (GAME_DOCTRINE section 2), not measurements.

Everything is at **60 fps: 1 frame (f) = 16.67 ms**. The sim should run fixed-dt 60 Hz so these frame
counts are exact regardless of render rate (GAME_DOCTRINE section 4).

---

## 0. Summary - the ten decisions that matter most

1. **Chain cadence ~2.4-3.0 hits/s.** Jab 6/3/10 (18 f total); a 4-hit rush chain lasts 1.35 s cancelled
   at the earliest frame and 1.63 s at a relaxed mid-window rhythm [D, framedata_check.py]. That is roughly
   3x faster than the GAME_DOCTRINE duel cadence, deliberately (section 12).
2. **Yakuza-style chain grammar**: up to 4 lights (5 with an upgrade), with a heavy at any chain position
   giving a different finisher (crumple, launcher, spin, wall-splat push, ground slam) [S: yakuza.fandom
   Kiryu fighting style].
3. **Hitstop scales with strength and is asymmetric** (victim freezes 2 f longer than attacker): jab 4/6 f,
   cross 5/7, hook 6/8, launcher 9/11, heavy 12/14, finisher beats 18-24 f [R], anchored to measured
   Capcom beat 'em up values (Final Fight 6 f universal; The Punisher jab 6 f attacker / 8 f victim) and
   fighting games (SF4 9/11/13 f; SFV 8/12/15 f) [S].
4. **Attack tokens**: 2 simultaneous melee attackers on Normal (1 Easy, 3 Hard), plus 1 ranged token,
   with attack starts spaced >= 18 f apart; brutes cost 2 tokens, bosses 3 [R], following the
   Kingdoms of Amalur grid/attack-capacity system and GAME_DOCTRINE's "<=2 attack tokens" [S].
5. **Telegraph floor from a formula**: telegraph = 250 ms reaction + 33 ms dodge start + difficulty
   buffer, giving 500 ms (30 f) minimum on Normal, 400 ms Hard, 650 ms Easy [D from GDKeys formula].
6. **Camera**: vertical FOV 55 deg, 3.0 m from a chest-height pivot; the hero fills 58% of frame height
   (matches the ~60% observed in the reference clip) and pulls out to 5-6 m to frame the engaged group
   [D, camera_framing.py]. Shake is rotational-only, trauma-squared Perlin/simplex noise [S: Eiserloh].
7. **RATINGS = DMC style meter with TV grades**, multiplying score x1.0 to x4.0, with DMC's repetition
   penalty, idle decay and "-2 grades when hit" [S: DMC wiki]; combo cash-out bonus superlinear in hits,
   forfeited if hit (Streets of Rage 4) [S].
8. **Points come from spectacle, not damage**: environment kills and finishers are worth 10-100x a jab
   (MadWorld: rose bush 10,000 / 30,000; sign post 20,000; tire 6,000) [S]. In the worked example a
   stylish 16-action sequence scores 17,406 vs 1,436 for 20 actions of jab mashing [D, scoring_example.py].
9. **Daze meter -> finisher**: health-proportional daze meter (SFV stun 950-1075 vs similar health),
   drains when not hit, max stun 4 s in SFV [S]; HIT PARADE daze 3.0 s grunt / 2.5 s brute / 1.5 s boss,
   finishers invulnerable and token-freezing [R].
10. **Defense is proven, not assumed**: parry 15 f on Normal (doctrine floor 0.25 s) with Sekiro-style
    spam penalty; dodge i-frames 18 f with "dodge anywhere in the windup counts" vs big attacks
    (GAME_DOCTRINE) [S/R]; input buffer 12 f for attacks (hitstop frames don't age it), 21 f for dodge.

---

## 1. Recommended frame data table (60 fps)

Conventions [S: ultimateframedata.com uses the same]: *startup* = the frame number of the first active
frame; *total* = startup + active + recovery - 1; *hitstop att/vic* = freeze frames for attacker / victim
on contact (frozen frames advance neither timeline); *hitstun* = victim stun frames after its hitstop.

### 1a. Reference points actually measured in shipped games

| Game / move | Startup | Active | Recovery | Total | Notes | Source |
|---|---|---|---|---|---|---|
| SF6 Ryu standing LP (jab) | 4 | 3 | 7 | 13 | +4 on hit, -1 on block | [S] ultimateframedata.com/sf6/ryu (raw page parsed) |
| SF6 Ryu standing MP | 6 | 4 | 11 (13 on whiff) | 20 (22 whiff) | +7 on hit; extra recovery on whiff | same |
| SF6 Ryu standing HP | 10 | 5 | 18 | 32 | +4 on hit | same |
| SF6 Ryu standing HK | 12 | 4 | 20 | 35 | +9 on hit | same |
| SF6 Ryu crouching HK (sweep) | 9 | 3 | 23 | 34 | knockdown +40 | same |
| SF6 Ryu Shoryuken LP (launcher) | 5 | 10 | 33 | 47 | knockdown +38, -23 on block | same |
| SF6 forward throw | 5 | 3 | 23 | 30 whiff / 96 hit | throw escape window: until the 9th frame of being thrown (search summary, SuperCombo) | same + [S] search summary |
| Tekken 8 generic jab | 10 | - | - | - | +1 on block, +8 on hit | [S] search summary citing wavu.wiki movelists |

Derived hitstun (our arithmetic, not stated by the source): hitstun ~= on-hit advantage + remaining
active + recovery. SF6 5LP: 4 + 2 + 7 = **13 f**; 5HP: 4 + 4 + 18 = **26 f** [D].

### 1b. HIT PARADE player moves [R] (math verified by `tools/research/framedata_check.py`)

| Move class | Startup | Active | Recovery | Total (ms) | Hitstun / effect on hit | Hitstop att/vic f (ms) | Notes |
|---|---|---|---|---|---|---|---|
| Jab (L1) | 6 | 3 | 10 | 18 (300) | 18 f | 4/6 (67/100) | Fastest button; lunge <= 0.6 m |
| Cross (L2) | 7 | 3 | 12 | 21 (350) | 22 f | 5/7 (83/117) | |
| Hook (L3) | 9 | 3 | 14 | 25 (417) | 24 f, turns victim 60-90 deg | 6/8 (100/133) | |
| Uppercut (L4 ender) | 12 | 4 | 20 | 35 (583) | launch, apex 1.8 m, ~48 f airborne, then knockdown | 9/11 (150/183) | Juggle starter |
| Body blow (L1 -> H) | 11 | 3 | 18 | 31 (517) | crumple 50 f (grab/free-hit window) | 8/10 (133/167) | Yakuza "Body Blow" pattern [S] |
| Low kick | 10 | 3 | 16 | 28 (467) | 22 f stagger (chainable) | 6/8 (100/133) | Beats brute guard (low) |
| Front (push) kick (neutral H) | 13 | 4 | 18 | 34 (567) | pushback 3.5 m; WALL SPLAT if a wall is within 3 m | 10/12 (167/200) | Space-maker |
| Roundhouse (L3 -> H) | 14 | 4 | 20 | 37 (617) | spin knockdown, 70 f down; hits all in 120 deg arc | 10/12 (167/200) | Crowd hit |
| Heavy (charged haymaker) | 20 uncharged (hold up to +40) | 4 | 24 | 47 (783) | uncharged: crumple 60 f + guard break; full charge: blowback 6 m + wall splat | 12/14 (200/233); full charge 16/18 | Armor from frame 8 vs light hits |
| Launcher (back + H) | 14 | 4 | 22 | 39 (650) | launch apex 2.2 m, ~55 f airborne | 9/11 (150/183) | Dedicated juggle opener |
| Air juggle hit (L vs airborne) | 7 | 3 | 12 | 21 (350) | re-lift = 0.7 x previous lift | 5/7 (83/117) | Max 3 air hits (sec. 3) |
| Grab | 8 | 3 | 26 (whiff) | 36 (600) | hold state, max 120 f | 0/0 | Not vs brutes unless dazed |
| Pummel (in hold) | 6 | 2 | 12 | 19 (317) | +10% daze each | 5/7 (83/117) | Max 3 per grab |
| Throw (from hold) | 10 | 6 (body = projectile) | 20 | 35 (583) | thrown 5-7 m, knockdown 80 f; body knocks down enemies it hits | 8/10 (133/167) | Auto-aims +-30 deg toward nearest hazard |
| Stomp (OTG) | 12 | 4 | 18 | 33 (550) | downed only; victim bounces 0.3 m, +20 f down time | 8/10 (133/167) | Max 2 per knockdown |
| Dash attack (sprint + L) | 10 | 8 | 24 | 41 (683) | knockdown 70 f | 8/10 (133/167) | Gap closer, 4 m travel |
| Weapon light | 9 | 4 | 16 | 28 (467) | 26 f | 6/8 (100/133) | 1 durability per hit |
| Weapon heavy | 18 | 5 | 26 | 48 (800) | knockdown / wall splat | 12/14 (200/233) | 2 durability; breaks at 0 (Arkham Knight weapons break after 3 hits [S]) |
| Finisher (on DAZED) | 8 entry (invulnerable) | 2-3 impact beats | - | 60-90 grunt / 180-240 boss | kill (grunt) / phase damage (boss) | 18 then 24 f on beats + 0.3x slow-mo for 20 f | Other enemies' tokens frozen |

Why these values [R, reasoning]:
- The jab is 2 f slower to start than SF6's (6 vs 4) and 5 f longer in total (18 vs 13) because a
  3D brawler needs a readable wind-up pose at close camera and a forward lunge (GAME_DOCTRINE: "Attacks
  step INTO the blow"). It is still ~3x faster than the doctrine's measured duel swings (568-759 ms
  delivery), which is the point of a brawler.
- Recovery is the largest phase of every move (doctrine: "recovery carries the majority of every measured
  cycle") but chains cancel recovery on hit, so the player feels speed only while landing hits - whiffs
  are punished by full recovery (+2 f extra on whiff, as SF6 5MP does: 11 -> 13 [S]).
- Every chain link has >= 10 f of latest-cancel slack (section 2c; the tightest is jab -> body blow at
  10 f), so a player who presses in rhythm, not
  frame-perfectly, still gets a true combo.

### 1c. Enemy attack data [R] (telegraph = startup; see section 4 for the derivation)

| Enemy / attack | Startup (telegraph) Normal | Active | Recovery (punish window) | Notes |
|---|---|---|---|---|
| Grunt jab | 30 f (500 ms) | 4 | 30 f | interruptible by any hit |
| Grunt haymaker | 45 f (750 ms) | 5 | 40 f | parryable, "glint" 12 f before active |
| Rusher lunge (knife/bat) | 36 f + 12 f travel | 6 | 45 f (whiffed lunge +20 f, doctrine) | audio cue at windup start |
| Brute overhead | 54 f (900 ms) | 6 | 50 f | armored through 3 light hits |
| Brute grab (unblockable) | 48 f (800 ms) | 4 | 60 f | red flash; dodge only |
| Thrower (bottle/brick) | 42 f windup | projectile 10 m/s | 36 f | ranged token pool |
| Boss normal | 36-60 f | 4-8 | 40-60 f | per-boss |
| Boss signature | 90-120 f, multi-stage | varies | 70+ f | staged cues (growl, plant, charge) |

---

## 2. Combo chain structure and cancel windows

### 2a. What the references do [S]
- **Yakuza / Like a Dragon** (https://yakuza.fandom.com/wiki/Kazuma_Kiryu/Fighting_Style): a "Rush Combo" of
  light hits (Yakuza 1: jab, gut punch, body hook, roundhouse; Yakuza 0 Rush style up to 8 via upgrades)
  with a "Finishing Blow" (heavy) available at each position giving a different result: Down Blow
  (knockdown), Body Blow (enemy holds abdomen -> follow-up or grab window), Uppercut (airborne, collateral
  damage to enemies in the way), spinning back kick (launch). Downed attack = stomp; running attack =
  dropkick. Heat actions are contextual (wall, railing, held object, number of nearby enemies)
  (https://yakuza.fandom.com/wiki/Heat_Actions).
- **Batman Arkham** (https://arkhamcity.fandom.com/wiki/Freeflow_Combat): freeflow begins at the 3rd
  multiplier; the combo ends on a failed counter, hitting air or a shield, or idling for more than about
  1 s; a special takedown unlocks at 8x (5x upgraded).
- **Streets of Rage 4** (https://streetsofrage.fandom.com/wiki/Streets_of_Rage_4): grounded enemies
  auto-fall after up to 8 hits (anti-infinite), wall bounces max 3 per combo, OTG lift once per combo,
  ground bounces unlimited, counters reset when the enemy returns to neutral.
- **Tekken** (https://wavu.wiki/t/Juggle): launcher -> 3-5 aerial fillers -> one combo extender -> ender
  (-> wall combo); without an extender most combos end after 4-5 hits; only one extender
  per combo.
- **SF6** (search summary of SuperCombo SF6 pages): buffered special cancels into cancellable normals;
  counter-hit +2 advantage and +20% damage.

### 2b. HIT PARADE chain grammar [R]
```
L1 jab -> L2 cross -> L3 hook -> L4 uppercut(launch)     [L5 haymaker-slam unlocked by upgrade]
Heavy at each position (the "Finishing Blow" slot):
  H  (neutral)       front kick: push 3.5 m, wall splat
  L1 H               body blow: crumple 50 f  -> grab / free hit
  L1 L2 H            launcher uppercut: apex 2.2 m -> air juggle
  L1 L2 L3 H         spinning roundhouse: 120 deg crowd knockdown
  L1 L2 L3 L4 H      (upgrade) haymaker ground SLAM: ground bounce (1 per combo)
Directional / contextual:
  back+H launcher | sprint+L dash attack | L/H on downed enemy = stomp |
  grab near wall = wall smash | grab near hazard = hazard throw (environment kill) |
  hold H = charge | weapon equipped: L L H (weapon light, light, heavy)
```

### 2c. Cancel windows [D, framedata_check.py output]
Latest legal cancel frame after the attacker's hitstop ends (the victim must still be in hitstun when the
next move's first active frame arrives): `k_max = hitstun_A + (hitstop_vic - hitstop_att) - startup_B + 1`.

| Link | Latest cancel | Frames left in move A | Effective window |
|---|---|---|---|
| jab -> cross | 14 f (233 ms) | 12 | 12 f (200 ms) |
| cross -> hook | 16 f (267 ms) | 14 | 14 f (233 ms) |
| hook -> uppercut | 15 f (250 ms) | 16 | 15 f (250 ms) |
| jab -> body blow | 10 f (167 ms) | 12 | 10 f (167 ms) |
| cross -> launcher | 11 f (183 ms) | 14 | 11 f (183 ms) |
| hook -> roundhouse | 13 f (217 ms) | 16 | 13 f (217 ms) |
| low kick -> jab | 19 f (317 ms) | 18 | 18 f (300 ms) |
| weapon light -> weapon light | 20 f (333 ms) | 19 | 19 f (317 ms) |
| weapon light -> weapon heavy | 11 f (183 ms) | 19 | 11 f (183 ms) |

Chain durations [D]: rush 4 = 81 f (1.35 s, 3.0 hits/s) at earliest cancels, 98 f (1.63 s, 2.4 hits/s) at
mid-window; J-C-launcher 70-79 f; weapon L-L-H 90-102 f.

Rules [R]:
- **On hit or block**: cancel window opens the frame after the attacker's hitstop ends and closes at
  `k_max` (table). The 12 f attack buffer (section 9) covers the early side, so mashers still chain.
- **On whiff**: chain allowed only from recovery frame 6 onward, and whiffed moves get +2 f recovery
  (SF6 5MP pattern [S]). This makes whiffing the one thing that feels slow.
- **Idle drop**: the chain resets if no attack input arrives before the move's recovery ends (Arkham's
  ~1 s idle rule is for the score combo, not the chain; see section 6).
- **Heavy / grab / dodge / parry cancel** allowed from any chain position during the window: dodge and
  parry cancel even outside the window from recovery frame 4 (GAME_DOCTRINE: "attack-cancel into guard"
  made the parry real).
- **Anti-infinite**: a grounded enemy is force-knocked-down after 8 consecutive hits without
  returning to neutral (SoR4's exact rule [S]).

---

## 3. Hit-stop, hitstun, launch, wall splat, ground bounce, OTG

### 3a. Hitstop evidence [S]
| Game | Hitstop | Source |
|---|---|---|
| Final Fight (1989) | 6 f on every attack, every character | https://shane-sicienski.com/blog/blog-post-title-one-55pmn |
| Knights of the Round | 6 f ground attacks, 7 f air attack | same |
| Warriors of Fate | jab 5 f, air attack 4 f, thrown enemies 0 f | same |
| The Punisher (1993) | **asymmetric**: jab 6 f attacker / 8 f victim; cross 8 f / 10 f | same |
| Street Fighter 4 | light ~9 f, medium ~11 f, hard ~13 f | https://sonichurricane.com/?p=1043 |
| Street Fighter 2 | ~14 f regardless of strength | same |
| Street Fighter V | light 8 f, medium 12 f, heavy 15 f (Ken exceptions 10/12) | search summary of shoryuken.com hitstop article |
| Smash Ultimate | floor((d x 0.65 + 6) x ...) frames, capped at 30 f; attacker hitboxes stay active during hitlag; **reduced when more fighters are present** (multiplier at 30 f of prior hitlag: 0.925 for 3 players, 0.862 for 4, 0.75 for 8) | https://www.ssbwiki.com/Hitlag (via api.php) |
| God of War (2018) | hit stop snaps the target into its hit pose and holds attacker and target on that first frame | https://blog.playstation.com/2022/10/04/game-developers-explain-what-makes-god-of-war-2018s-combat-tick/ |
| SF6 | hitstop exists partly to give time for hit-confirm and cancels (search summary) | SuperCombo SF6 Offense (search summary) |

### 3b. HIT PARADE hitstop rules [R]
- **Tiers** (attacker/victim frames): light 4/6, medium 5-6/7-8, launcher/kick 9-10/11-12, heavy 12/14,
  full-charge 16/18, finisher beats 18 and 24, wall splat impact 10/14, ground slam 12/16, environment
  kill 20 + 0.3x slow-mo for 30 f. These sit between Final Fight's flat 6 f and SFV's 15 f heavy: light
  hits stay snappier than a fighting game because the chain cadence is higher.
- **Asymmetric by +2 f** (The Punisher pattern): the victim's extra freeze is where the shake reads, and
  it hands the attacker 2 f of free advantage, which the chain math above relies on.
- **Multi-target scaling** (Smash pattern): when one attack connects with N enemies, hitstop =
  base x max(0.7, 1 - 0.1 x (N - 1)). Crowd hits stay punchy without stuttering the whole fight.
- **Freeze scope**: hitstop freezes only the attacker, the victim(s) and their animation mixers.
  Everyone else, particles and camera shake keep running (other enemies must not freeze or tokens
  desync). Hitboxes of the frozen attacker stay live (Smash), so a crowd hit can still catch a second
  enemy.
- **Chain compression**: from the 4th consecutive hit in a chain onward, light hitstop drops to 3/5 so
  long juggles don't turn into slideshows.

### 3c. Hitstun and stun states [R] (numbers in section 1b)
- Chain lights 18-24 f; crumple 50-60 f; stagger (low kick) 22 f; launch airtime 48-55 f; knockdown
  60-90 f on the ground, then 10 f invulnerable wake-up; bosses tech on landing (SoR4 lets players tech
  on landing with brief invincibility [S]).
- Reference: SF6 jab derived hitstun 13 f, heavy 26 f [D]; Smash hitstun is proportional to knockback
  (Melee 0.4 f per unit) [S: ssbwiki Hitstun].

### 3d. Juggles [R] (Tekken + SoR4 structure [S])
- Max **3 air hits** after a launch (Tekken fillers: 3-5); each re-lift = 0.7 x previous lift, so the arc
  decays naturally and the enemy lands.
- **1 extender per combo**: the ground slam / ground bounce (Tekken allows only one extender [S];
  SoR4 allows unlimited ground bounces [S] - one is safer for a 3D brawler where juggles cost camera
  readability).
- Damage scaling applies to **brutes and bosses only** (grunts should die fast): 100, 100, 90, 80, 70, 60%
  floor 50%; after a wall hit further x0.8 (Tekken wall scaling [S]; Tekken's aerial scaling is steeper:
  70/50/40/30% [S]).

### 3e. Wall splats and wall bounces [R]
- A knockback move with the victim's path hitting a wall within 3 m -> **WALL SPLAT**: victim pinned
  40 f in a splat pose (comic splatter decal on the wall), then slides down 20 f. Tekken's wall splat
  gives 6 f of wall slump before tech [S]; ours is longer because it is a combo/score opportunity.
- Max **2 splats per combo**; the 3rd wall contact is a plain crumple (SoR4 caps wall bounces at 3 [S]).
- Wall splats need walls: arenas must have walls/props within 6-10 m of the fight centre (level-design
  requirement, section 5).

### 3f. OTG and stomps [R]
- Stomp only on downed enemies, max **2 per knockdown**; the second stomp ends the knockdown (enemy rolls
  away). SoR4 allows an OTG lift once per combo [S] - HIT PARADE's OTG kick-up (downed + launcher input)
  is once per combo too.
- Arkham: the ground takedown awards the most points and Arkham Knight added strikes on downed enemies
  [S] - stomps should score high (150 style + 50 base) because they are the reference clip's signature beat.

---

## 4. Enemy group AI - attack tokens and telegraphs

### 4a. Evidence [S]
- **Kingdoms of Amalur "Belgian AI"** (Game AI Pro ch.28, PDF read in full,
  http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter28_Beyond_the_Kung-Fu_Circle_A_Flexible_System_for_Managing_NPC_Attacks.pdf):
  8-slot world-aligned grid around the player; **grid capacity** (example 12) vs creature grid weight
  (soldier 4, troll 8); **attack capacity** (example 10) vs attack weight (troll charge 6 / club 4, soldier
  lunge 5 / sword 3). Inner "attack" circle = melee range; outer "approach" circle; creatures without a
  slot wait outside and stand in front of a free slot (natural flanking). A slot is released
  **immediately after launching** an attack -> rotation. A central stage manager can steal slots for
  better-positioned creatures. Difficulty scales the capacities, not the per-creature weights.
- **Strayspark attack-token article** (https://www.strayspark.studio/blog/attack-token-system-ue5-group-combat-that-feels-fair):
  baseline pools melee 1, ranged 2, heavy 1; rings melee 150-250 cm, mid 500-800 cm, far 1200-2000 cm;
  aggression scalar 0.5-1.5x; audit leaked tokens every ~2 s; the article's rationale is that players can track about one incoming
  melee attack plus a couple of ranged shots at once.
- **DOOM (2016)** (search summary, gamedeveloper.com "Cyber Demons"): each attack type has a limited token
  pool; demons without a token keep pressure by strafing/advancing.
- **Batman Arkham**: attack tickets, e.g. 15 enemies with 4 tickets (search summary of a Medium article;
  the article itself returned 403 - unverified). Counterable attacks show a lightning-bolt icon above the
  attacker; from Arkham City up to 3 attackers can be countered at once
  (https://arkhamcity.fandom.com/wiki/Counter).
- **God Hand** (https://en.wikipedia.org/wiki/God_Hand): at difficulty levels 1-2 enemies do **not attack
  unless in the player's line of sight** (or being attacked); at 3 and DIE they attack regardless of the
  camera. Enemies "mostly engage one-on-one" early and surround/flank/team-attack later.
- **GAME_DOCTRINE section 2 / PROMPT CORE item 4**: "<=2 attack tokens"; bot reaction delay 300-800 ms;
  roll reactions once per incoming swing and latch.

### 4b. Telegraph length derivation [D]
GDKeys (https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/): anticipation time = player
reaction time + time to trigger the answering ability + a difficulty buffer, with reaction taken as
0.25 s [S]. Mean simple reaction time 231 ms in 1,469 adults (search summary of PMC4374455) and more than 0.3 s for an average player to perceive, decide and press
(https://note.com/darkangels_417/n/nb520b22d60f7) [S]. With a dodge that starts on frame 2 (33 ms):

| Difficulty | 250 ms + 33 ms + buffer | Minimum grunt telegraph |
|---|---|---|
| Easy ("Pilot") | + 350 ms | **650 ms (39 f)** |
| Normal ("Prime Time") | + 200 ms | **500 ms (30 f)** |
| Hard ("Syndicated") | + 100 ms | **400 ms (24 f)** |
| Finale / NG+ | + 50 ms | **333 ms (20 f)** |

Choice reaction is slower than simple reaction (300-400 ms, search summary), so when two tokens are held,
the second attacker's active frame must land **>= 18 f (300 ms) after the first** (token grant spacing).

### 4c. HIT PARADE token table [R]

| Setting | Easy | Normal | Hard | Finale/NG+ |
|---|---|---|---|---|
| Melee attack tokens (simultaneous attackers) | 1 | **2** (doctrine cap) | 3 | 3 |
| Ranged tokens | 1 | 1 | 2 | 2 |
| Engaged-ring slots (approach circle, of 8) | 4 | 6 | 8 | 8 |
| Min spacing between token-holder active frames | 30 f | 18 f | 12 f | 10 f |
| Off-screen enemies may take a melee token | no | no | yes, +400 ms telegraph + edge indicator + audio | yes, +250 ms |
| Telegraph multiplier (floor = 4b) | 1.3x | 1.0x | 0.85x | 0.75x |

Token cost by enemy tier (Amalur-style weights) [R]:

| Tier | Token cost | Attack cadence while holding token | Poise | Telegraph range (Normal) |
|---|---|---|---|---|
| Grunt | 1 | one attack per 2.5-4.0 s (doctrine ~3 s rhythm) | none - every hit interrupts | 30-45 f |
| Rusher | 1 | 1 lunge per 3-5 s | none | 36 f + travel |
| Thrower | ranged pool | 1 throw per 3-4 s | none | 42 f |
| Brute | 2 | 1 attack per 3-4 s | armor through 3 light hits or 1 heavy; interrupt only in first 45% of windup (doctrine) | 48-60 f |
| Showboat (elite) | 2 | parries the 4th hit of a repeated chain (forces variety) | 2 light hits | 36-54 f |
| Boss | 3 (minions limited to 1 token while boss attacks) | per pattern | phase-based armor | 36-120 f |

Behaviour rules [R]:
- Two rings around the player: **attack ring 1.2-2.0 m** (inside = allowed to strike), **approach ring
  3.0-4.0 m** (token holders wait here), outsiders stand at 5-7 m in front of a free slot and taunt / play
  to the crowd (they are part of the show). Metric rings scaled from Strayspark's melee band (1.5-2.5 m).
- Release a token when the attack's active frames START (Amalur releases immediately after launch),
  re-grant after >= spacing frames; audit every 2 s (Strayspark).
- Latch reactions per incoming player attack (doctrine), reaction delay 300-800 ms by tier (doctrine),
  and never cancel their own committed attack (doctrine: a self-cancelling reactive layer "goes 0-for-20").
- Every attack has a unique silhouette pose and a VFX/SFX cue (GDKeys: subtle differences get lost mid-fight); parryable attacks flash a glint 12 f before active; unblockables flash red at windup start.
- Offscreen fairness follows God Hand: at Easy/Normal nothing outside the camera's horizontal FOV + 10 deg
  may start an attack.

---

## 5. Camera

### 5a. Evidence [S]
- Reference clip (BRIEF.md, observed frame-by-frame by the brief author): close camera behind/beside the
  hero, fighters fill ~60% of frame height, swings around the exchange, motion blur, punch-in on heavies.
- UE5 third-person template (search summary: Unreal forums / uhiyama-lab): SpringArm TargetArmLength
  400 cm, camera FieldOfView 90 deg (horizontal), lag speed 3.0.
- Sifu: dynamic lock for fast target switching (https://blog.playstation.com/2021/11/18/how-sifus-kung-fu-combat-works/);
  critics disliked the camera and near walls it zooms in until only the hero's back is visible (search
  summary of Wikipedia reception + Unreal interview).
- God of War 2018: pulled-back camera for wider field of view and target tracking, camera shake strongly
  reduced for legibility (PlayStation Blog link above).
- Eiserloh GDC 2016 (http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf,
  read in full): trauma 0..1, hits add +0.2 or +0.5, linear decay, shake = trauma^2 or ^3 (trauma 0.30 / 0.60 / 0.90 -> 3% / 22% / 73% shake, cubic); **3D: rotational shake only**; Perlin noise (works with pause/slow-mo);
  asymptotic averaging `x += (target - x) * .1` scaled by timeScale, asymmetric per axis/direction;
  framing = primary focus (player) never leaves view, secondary (target) should not, points of interest
  weighted proximity x importance with inner/outer feathering.
- Lock-on (https://critpoints.net/2015/05/24/what-is-your-ideal-form-of-lock-on-in-action-games/): soft lock
  struggles with groups; hard lock best when HELD not toggled and optional.

### 5b. Geometry [D] (`tools/research/camera_framing.py`; three.js `PerspectiveCamera.fov` is VERTICAL -
verified in three 0.186 source: "The vertical field of view")
- UE template hFOV 90 at 16:9 = **vFOV 58.7 deg**; a 1.8 m hero at 4.0 m fills only **40%** of frame
  height - looser than the reference clip.
- Distance for a 1.8 m hero to fill 60 / 50 / 40% of frame height: vFOV 50 -> 3.22 / 3.86 / 4.83 m;
  vFOV 55 -> 2.88 / 3.46 / 4.32 m; vFOV 60 -> 2.60 / 3.12 / 3.90 m.
- vFOV 55 at 3.0 m -> **58%** fill; at 2.2 m -> 79%; vFOV 60 at 5.0 m -> 31%.
- Keeping a ring of radius R around the hero in frame horizontally (15% margin, simplified same-depth
  model): vFOV 55 @16:9 -> R 3 m: 3.73 m, R 4 m: 4.97 m, R 5 m: 6.21 m. Portrait phone (9:19.5) at vFOV 60
  needs **12.95 m for R 3 m** -> portrait is unusable for group fights; force landscape.

### 5c. HIT PARADE camera numbers [R]
| Parameter | Value |
|---|---|
| Pivot | hero hips + 1.35 m (chest), offset 0.35 m to the right |
| Base distance / vFOV | **3.0 m / 55 deg** (hero ~58% of frame height) |
| Pitch | -10 deg default, clamp -35 .. +15 |
| Group framing | distance = clamp(3.0, 6.0, f(R)) where R = radius of token holders + approach-ring enemies around the hero; above 5 m widen vFOV to 60 |
| Framing bias | yaw rotates so the hero sits at 40% screen-x and the current target stays inside the middle 70% (primary/secondary focus rule) |
| Smoothing | asymmetric asymptotic averaging, frame-rate independent: alpha = 1 - (1 - a)^(dt x 60); a = 0.15 zooming OUT, 0.04 zooming IN, yaw 0.12, pitch 0.08; multiply by timeScale |
| Shake | trauma +0.12 light hit, +0.25 heavy, +0.35 player hurt, +0.5 finisher/env kill; decay 1.6/s; shake = trauma^2; max yaw/pitch 2.5 deg, roll 4 deg; rotational only; simplex noise at 12-18 Hz |
| FOV punch | heavy: -3 deg over 4 f, back over 12 f; finisher: dolly to 2.2 m and vFOV 50 (79-88% fill), orbit 20-35 deg, 0.3x slow-mo |
| Wall handling | sphere-cast radius 0.25 m; if pushed below 1.8 m, swing yaw away from the wall (up to 60 deg) instead of pushing to the hero's back (the Sifu complaint); dither-fade occluding props |
| Targeting | soft-lock by default; optional HELD hard-lock (critpoints); target score = 0.5 x dot(input dir, dir to enemy) + 0.3 x (1 - dist/6 m) + 0.2 x (is attacking); stick neutral uses camera forward; keep current target unless a candidate scores 25% higher (no flicker) |
| Magnetism | lunge toward the soft target up to 80% of reach (doctrine), max 0.6 m for lights, 1.5 m for heavies/dash |
| Level-design implication | fight spaces 8-14 m across with walls/hazards inside 6-10 m of centre: tight enough for splats, wide enough for the 6 m group pull-out |

---

## 6. Scoring + RATINGS multiplier

### 6a. What the references do [S]
- **MadWorld** (Wikipedia + madworld.fandom): points per defeat rise with foe power and with more unusual kill methods; stacked setups pay more (a tire jammed on first makes a wall throw worth much more); boss unlocked by a
  point threshold and must be beaten within a time limit. Values: Tire 6,000 jammed / 1,000 thrown; Rose
  Bush (spikes) 10,000 thrown / 30,000 slammed; Sign Post 20,000 each, up to 5 per enemy; finishers are
  the main point source, worth thousands each; boss finishers earn none; Bloodbath Challenges
  (e.g. Turbinator, unlocked at 200,000 points, 3 rounds / 90 s) with rapid-kill names Double, Triple,
  Slaughter, Massacre, Genocide, Madness (7+); DeathWatch Challenges worth 300,000-900,000; a two-man
  commentary team riffs on every item and kill.
- **Bulletstorm** (https://bulletstorm.fandom.com/wiki/Skillshots): skillshots 25 / 50 / 100 points by
  tier, first-time x5, multi-kill points x N x N (3 kills of a 50 skillshot = 450), 135 skillshots; points
  are currency.
- **Batman Arkham** (Counter page): each strike/counter = 10 points x current multiplier.
- **Streets of Rage 4**: 1 point per 1% damage; combo bonus `(damage/6)^1.5 x 2`; combo cashes out after
  ~4 s without a hit; taking a hit forfeits the combo; tiers Nice 60 -> Out Of This World 1000 damage
  (62 -> 4303+ points); assists reduce the end-of-level score.
- **Devil May Cry** (https://devilmaycry.fandom.com/wiki/Stylish_Rank): D..SSS; repeats give diminishing
  returns; idle decay faster at higher ranks (DMC1 loses rank after 1.5 s); DMC4/5 taking damage drops 2
  grades (B -> D, A -> C, S/SS/SSS -> B); rank sets orb payout; DMC5 announcer calls ranks and mocks you
  when hit at S+; music changes with rank (DmC, DMC5).
- **Sleeping Dogs**: face meter fills faster with varied moves in rapid succession and environmental kills.
- **God Hand**: taunts build the Tension gauge; higher difficulty level = more end-of-stage bonus.

### 6b. HIT PARADE scoring [R] (implemented in `tools/research/scoring_example.py`)
**Base points** (x current RATINGS multiplier at award time):

| Action | Points | Ratings gain |
|---|---|---|
| Jab / cross / hook | 10 / 15 / 20 | 4 / 5 / 6 |
| Uppercut, launcher | 40 | 12 |
| Air juggle hit | 30 | 8 |
| Kick | 30 | 10 |
| Throw | 80 | 18 |
| KO grunt / brute | 100 / 500 | 20 / 40 |
| STYLE: wall splat, ground slam | 250 | 30 |
| STYLE: OTG stomp | 200 | 16 |
| STYLE: parry, perfect dodge | 200, 150 | 35, 25 |
| STYLE: crowd hit (one attack, 2+ enemies) | 150 per extra enemy | 20 |
| STYLE: environment kill | 1,000-3,000 by hazard | 60 |
| STYLE: finisher | 1,000 (+500 per prop stuck in the target, MadWorld stacking) | 50 |
| STYLE: taunt (no enemy within 3 m, 5 s cooldown) | 50 | 15 |

**Modifiers**:
- First use of a STYLE event in an episode: x3 points (Bulletstorm uses x5).
- Freshness: ratings gain x0.6 per earlier use of the same action within the last 6 actions (DMC
  diminishing returns). Points are not reduced; the multiplier already rewards variety.
- Combo: the hit counter cashes out 3.0 s after the last landed hit (SoR4 uses ~4 s; shorter keeps
  tension in a 3D arena where enemies are always close): bonus = round(5 x hits^1.5) x multiplier;
  forfeited if the player is hit first (SoR4).
- Multi-KO within 2.0 s: sum of those KO points x (N - 1). On-screen names (original, MadWorld-style
  escalation): 2 DOUBLE BILL, 3 TRIPLE BILL, 4 BOX SET, 5 MARATHON, 6 BINGE, 7+ SERIES FINALE.

**RATINGS meter** (0-699, seven 100-point bands; names are original TV terms):

| Grade | Name | Score multiplier | Idle decay (after 1.5 s idle) |
|---|---|---|---|
| D | DEAD AIR | x1.0 | 8 /s |
| C | CABLE ACCESS | x1.2 | 12 /s |
| B | SYNDICATED | x1.5 | 16 /s |
| A | PRIME TIME | x2.0 | 20 /s |
| S | MUST-SEE | x2.5 | 24 /s |
| SS | VIRAL | x3.0 | 28 /s |
| SSS | HIT PARADE!!! | x4.0 | 32 /s |

- Taking a hit drops **2 grades** to that band's floor (DMC4/5 exact rule).
- RATINGS feeds the show: A+ opens the finisher prompt on dazed enemies; each grade-up triggers a host
  caption + crowd roar + music layer (DMC5/DmC music-by-rank); SSS grants one "SHOWSTOPPER" per round
  (screen-wide super, invulnerable - SoR4 Star Move / No More Heroes Dark Side analogue).
- Episode structure (MadWorld): the boss is gated by a points target (or all waves cleared); each set has
  2-3 optional "sponsor segments" (Bloodbath-style 60-90 s timed challenges around one hazard) and one
  DeathWatch-style episode objective ("wall-splat 5 grunts", "no damage in round 2") worth big bonus.
- Assists (extra lives, auto-parry) apply an end-of-episode score penalty (SoR4) - never a lockout.

### 6c. Worked example [D] (`scoring_example.py`, output saved)
Starting at grade C (150): jab, cross, hook, uppercut, 2 air juggles, ground slam, OTG stomp, KO, parry,
jab, cross, hook, wall splat, throw, environment kill, then cash-out of 14 hits.
- Result: **17,406 points**, RATINGS 413.8 (grade S). The environment kill alone gave 12,000 (2,000 x3
  first-time x2.0 at grade A); cash-out 262 x2.5 = 655.
- The same 16 actions with no first-time bonuses (a later fight in the episode): **6,606 points**.
- A masher doing 5 x (jab, cross, hook, KO) = 20 actions: **1,436 points**, RATINGS stalls at grade B
  (269.0) because freshness decays repeated moves to 3.6 ratings per hook.
- A player hit at grade S drops to B and loses the 4-hit combo in progress.
So style beats spam by 4.6x (repeat fight) to 12x (first fight) in points for fewer actions - the
intended incentive. Tune via the base table, not by adding new mechanics.

---

## 7. Dizzy / stun / finisher rules

### 7a. Evidence [S]
- **SFV stun gauge** (https://streetfighter.fandom.com/wiki/Stun_Gauge via api.php): fills from hits and
  grabs, not from blocked hits; drains at a steady pace if no damage is taken; capacity 950-1075,
  close to the character's health value; stunned for at most 4 s; heavy single hits
  and grabs are the best stun finishers.
- **Sifu**: Structure gauge for player and enemies; blocking fills it quickly; break = takedown; parry
  unbalances the attacker; avoid/duck recovers structure (PlayStation Blog).
- **Sekiro** (https://sekiroshadowsdietwice.wiki.fextralife.com/Deflection): deflects build posture
  "by a significant amount", more for consecutive deflects in a flurry.
- **MadWorld**: finishers on "near-dead" enemies; boss Power Struggles (QTE; fail = heavy damage or death).
- **Yakuza**: Heat actions contextual to wall/railing/object/enemy count, some with QTE for extra damage.
- **Arkham**: counter finishes the last standing enemy (Knight: up to 3).

### 7b. HIT PARADE daze rules [R]
- Every enemy has a **DAZE meter** with capacity = its max HP (SFV proportionality).
- Fill per hit = damage x strength factor (light 0.8, medium 1.0, heavy 1.5, grab-pummel +10% of capacity
  each, wall splat +25%, ground slam +25%, parry +30%). Blocked hits add nothing (SFV).
- Drain: after 1.5 s without being hit, 20% of capacity per second (SFV steady drain).
- Full -> **DAZED**: grunt 180 f (3.0 s), brute 150 f (2.5 s), boss 90 f (1.5 s); SFV max is 4 s.
  After a daze ends the meter refills at half rate for 5 s (anti-loop).
- **Finisher available** on any DAZED enemy, and on grunts under 20% HP (MadWorld near-dead rule).
  Input: grab + heavy together (single contextual FINISH button on touch).
- **Context picks the finisher** (Yakuza): wall within 1.5 m -> wall smash; hazard within 2.5 m ->
  hazard kill (environment kill scoring); holding a weapon -> weapon finisher; 2+ other enemies within 3 m
  -> crowd finisher (hits them too); otherwise signature finisher.
- Finishers are **invulnerable**; all tokens are frozen during a finisher and for 30 f after
  (no cheap hits during the cinematic). Grunt finishers <= 1.5 s (tempo), boss finishers 3-4 s with
  a 2-3 prompt QTE (MadWorld Power Struggle / Yakuza heat QTE); a failed QTE lets the boss break free
  and deals chip damage, never an instant death.
- Bosses need **2 dazes per phase**; the final daze of the last phase triggers the episode's
  signature finisher (red comic splatter, or sparks/confetti with the gore toggle).
- **Player guard meter** (Sifu structure): blocked hits fill it; full = 60 f guard-break stagger; parries
  and perfect dodges drain it; it mends at a threshold as a STATE (doctrine guard-break rule).

---

## 8. Grabs, throws, environment kills

Evidence [S]: SoR4 grabs by walking into enemies, with pummel / forward / back throws and vault throws;
Sleeping Dogs' attack/grapple/counter triad with drag-to-object environmental kills and breakable
weapons; Arkham Knight environmental takedowns on objects highlighted blue, thugs that grab the player
from behind, counter-throws that knock down enemies in the path, weapons breaking after 3 hits; MadWorld
environment hazards (spikes, fans, electricity) that usually kill instantly, spikes slammable
up to 4 times; SF6 throws 5 f startup / 3 f active.

HIT PARADE [R]:
- Explicit grab button (no walk-in grabs - accidental grabs in a 3D crowd are a known SoR-style
  frustration pattern; this is our judgement, not a sourced measurement). Grab 8/3/26 f (section 1).
- Hold up to 120 f; up to 3 pummels; throw in 4 directions or auto-aimed +-30 deg at the nearest
  hazard within 6 m; the thrown body is a projectile that knocks down enemies it touches (Arkham Knight).
- **Environment kills** trigger when a thrown / knocked-back enemy's path meets a hazard volume, or from
  a grab within 2.5 m facing the hazard. Hazards glow with a set-dressing colour cue (Arkham blue-highlight
  pattern) and are scored 1,000-3,000 (section 6). Each set needs 3-6 hazards.
- Brutes can't be grabbed until DAZED; brutes and bosses can grab the player (unblockable, telegraphed,
  dodge to avoid; 30 f mash-out window on Normal).
- Weapons: light/heavy per section 1b; durability 6 light-hit units, heavy costs 2; enemies drop them;
  a breaking weapon scores 200 and shatters in the comic style.

---

## 9. Defense: parry, dodge, block, input buffer

Evidence [S]:
- Parry windows: Sekiro deflect **12 f** (0.2 s), spam shrinks it to 4 or 0 f, penalty resets after 30 f
  or on success, too-early press still guards (fextralife). DMC5 Royal Guard perfect block **6 f**
  (devilmaycry.fandom Royalguard_Style). Sifu vanilla parry 10 f (a mod author's claim, nexusmods 1280,
  unverified). GAME_DOCTRINE: a 0.16 s window was unreachable through command lag; **0.25 s + attack-cancel
  into guard** produced 29 parries in the same harness.
- Dodge: Dark Souls 3 roll i-frames 13 f at 30 fps (0.433 s) (search summary of fextralife/GameFAQs);
  SoR4 jump start-up has i-frames; God Hand maps four dodges to the right stick; GAME_DOCTRINE: 0.28 s
  i-frames vs a 0.62 s windup punished tell-reactors (6/30 wins vs 14/20) -> honour dodges started anywhere
  in a big attacker's windup and give dodged lunges extra recovery.
- Buffer: SF6 4 f early (5 f window) (search summary); Smash Brawl/4 10 f, Ultimate 9 f + hold-to-buffer,
  with the documented downside that buffered moves fire when the situation changed (ssbwiki Buffer);
  GAME_DOCTRINE 0.35 s (called the cheapest feel fix in the doctrine).

HIT PARADE [R]:

| Mechanic | Easy | Normal | Hard | Finale |
|---|---|---|---|---|
| Parry window (press before enemy active frame) | 18 f | **15 f** (doctrine floor) | 12 f (Sekiro) | 9 f |
| Parry spam penalty | -3 f per press within 30 f, min 6 f | -4 f, min 4 f | -4 f, min 4 f | -4 f, min 2 f |
| Perfect-dodge window (enemy active lands in first N f of dodge) | 14 f | 10 f | 8 f | 6 f |

- **Parry**: block pressed inside the window -> attacker staggers 45 f, +30% daze, +200 points; pressed
  earlier -> plain block (Sekiro rule, never punishes caution). Parry cancels any attack from recovery
  frame 4 (doctrine). Parry = counter: the Arkham counter icon appears on counterable attacks at windup
  start; parrying the last standing grunt finishes him.
- **Dodge**: 30 f total, i-frames frames 2-19 (18 f = 300 ms), 3.0 m travel, cancellable into attack from
  frame 22. Perfect dodge -> "INSTANT REPLAY" slow-mo: world timeScale 0.35 for 45 f with the hero at
  full speed (Bayonetta Witch Time / Sleeping Dogs slow-mo pattern), +150 points.
- **Honesty rule** (doctrine): vs attacks with windup >= 40 f, a lateral or away dodge started anywhere in
  the last 60% of the windup counts as a successful dodge; dodged lunges get +20 f recovery (punish window).
- **Block**: hold; 80% damage reduction on lights, chip on heavies, fills the guard meter (section 7).
- **Input buffer**: attack inputs held 12 f (200 ms) and fired on the first frame the chain window opens;
  **hitstop frames do not age the buffer**; only the most recent attack input is kept (avoids Smash's
  stale-buffer problem). Dodge buffer 21 f (0.35 s, doctrine). Parry is never buffered (timing must be
  measured from the real press) - instead it cancels recovery immediately.
- **Clash** (doctrine): player heavy vs enemy heavy with active frames overlapping -> both rebound 20 f,
  sparks, per-pair cooldown 1.0 s. Player lights vs grunt windup: the player wins (grunts have no poise).

---

## 10. Mobile control scheme

Evidence [S]: Apple HIG minimum 44x44 pt; Material 48x48 dp (~9 mm) with >= 8 dp spacing (search
summaries). Floating joystick recommended: zero point at touch-down, keep a press alive when the thumb
slides off (search summary). Streets of Rage 4 mobile has a big left stick + right-side buttons (jump,
attack, special, star, back attack, pickup) with adjustable size, position, spacing and order, yet
reviewers still found touch play holds it back (toucharcade / destructoid / androidcentral search
summaries). Jeff Minter's gesture approach reads direction from a slide anywhere on screen instead of a drawn stick (https://prog21.dadgum.com/124.html).

HIT PARADE [R]:
- **Landscape only** (portrait would need 12.95 m camera distance to frame a 3 m ring at vFOV 60 [D]).
- Left 45% of the screen: floating stick, 60 dp radius, 12% dead zone, re-centres when the thumb drifts
  beyond 1.4x radius.
- Right cluster (sizes in dp): ATTACK 84, HEAVY 68, GRAB 60, DODGE 68, BLOCK/PARRY 60; min 48 dp and
  >= 12 dp gaps; all resizable/movable/reorderable (SoR4 mobile precedent). A contextual FINISH button
  (72 dp, pulses) appears next to ATTACK when a DAZED enemy is in range (God Hand/Yakuza context button).
- Gesture: a swipe anywhere on the right half that starts on empty screen = directional dodge (Minter).
- Auto-targeting: soft-lock with the same scoring as section 5; stick neutral + attack = best target in
  front within 4 m; attacks lunge to it. Tap an enemy to hard-lock (held lock is impossible on touch).
- Camera fully automatic on touch (group framing does the work; no right-stick duties).
- Touch assists (flagged on the results screen, small score penalty per SoR4): parry window +3 f,
  auto-chain variety (repeated ATTACK taps auto-rotate chain branches so freshness doesn't stall).
- Haptics: feature-detect `navigator.vibrate` (not available in every mobile browser) for 15-40 ms pulses
  on heavy hits; gamepad `vibrationActuator` where present.

---

## 11. Difficulty levers

| Lever | Easy "Pilot" | Normal "Prime Time" | Hard "Syndicated" | Finale / NG+ | Source pattern |
|---|---|---|---|---|---|
| Melee / ranged tokens | 1 / 1 | 2 / 1 | 3 / 2 | 3 / 2 | Amalur capacities, doctrine cap |
| Engaged-ring slots | 4 | 6 | 8 | 8 | Amalur grid capacity |
| Telegraph (floor) | 1.3x (650 ms) | 1.0x (500 ms) | 0.85x (400 ms) | 0.75x (333 ms) | GDKeys formula |
| Off-screen attacks | never | never | with indicator +400 ms | with indicator +250 ms | God Hand line-of-sight rule |
| Parry / perfect dodge window | 18 / 14 f | 15 / 10 f | 12 / 8 f | 9 / 6 f | Sekiro, DMC5, doctrine |
| Enemy damage | 0.6x | 1.0x | 1.4x | 2.0x | - |
| Enemies per wave | -30% | base | +25% | +50%, variants earlier | SoR4 difficulty ladder |
| AI reads player input | no | no | no | only Finale-tier elites | SoR4 Mania+ |
| RATINGS decay | 0.7x | 1.0x | 1.2x | 1.5x | DMC decay by rank |
| Daze fill | 1.3x | 1.0x | 0.9x | 0.8x | - |

**Dynamic "Network Pressure"** (God Hand's 1/2/3/DIE bar [S]): within the chosen difficulty a hidden
level -1/0/+1 rises after long unanswered offense + dodges and falls when the player is combo'd; +1 adds a
token spacing reduction of 4 f and +10% enemy damage, and pays +15% end-of-episode bonus (God Hand pays
more at higher levels). It never crosses the chosen band.

---

## 12. GAME_DOCTRINE section 2 - where a brawler must differ, where it still binds

Doctrine section 2 was measured on a slow 1v1 gladiator duel (Colosseum).

**Deliberate differences**
| Doctrine (duel) | HIT PARADE (brawler) | Why |
|---|---|---|
| Swing cycles 1.5-2.5 s; ~3 s between committed attacks; "7 hits in 3 seconds was unplayable" | Player jab 300 ms total; 4-hit chain 1.35-1.63 s (2.4-3.0 hits/s) [D] | Brawler readability comes from chain grammar + hitstop + a single target per hit, not from slow swings. The "7 hits in 3 s" failure was an AI/duel reading problem; a brawler player chaining into hitstun is the genre's core loop. |
| Poise: interrupts only in the first ~45% of windup, 1.6 s immunity | Grunts have NO poise (every hit interrupts); brutes/bosses keep doctrine poise | Hitstun lock on grunts is the power fantasy; poise lives on the tiers that must feel heavy. |
| Buffer 0.35 s for everything | 12 f (200 ms) for attacks, 21 f (0.35 s) for dodge, parry never buffered | At 18-21 f per move, a 21 f attack buffer queues inputs from before the current move started (Smash documents stale-buffer misfires). Dodge keeps the doctrine value. |
| Blocks must punish (riposte on matched block, ~2.2 s cooldown) | Parry punishes (stagger + daze); plain block only reduces damage | Brawler defense centres on parry/dodge; the doctrine principle (defense must create offense) is kept via parry. |

**Still binding (apply as written)**
- Attacks step INTO the blow: lunge/magnetism to the locked target, capped ~80% of reach (section 5).
- Strike frames authored into clips (designed impact frames), and the view's hit frame aligned to the sim.
- Parry must be reachable and PROVEN with a scripted optimal player (15 f Normal, attack-cancel into guard).
- Clash on simultaneous heavies, deterministic, per-pair cooldown, jittered staggers.
- Guard-break is a state that mends at a threshold, and the breaking blow lands.
- AI honesty: latch one reaction roll per incoming attack, count blows not ticks, commit while swinging,
  **cap simultaneous attackers with tokens (2 on Normal)**, reaction delay 300-800 ms.
- Telegraph honesty for the dodge (dodge-in-windup counts; dodged lunge gets extra recovery).
- Every engagement ends: the round timer IS the referee (native to the TV frame). A timeout must never
  reward passivity: the verdict is by RATINGS, and a zero-contact round is "CANCELLED" (a loss).
- Endless/survival mode never ends by referee - passivity summons the next wave.
- Tutorial opponent = teacher band (long telegraphs, demonstrates the verb, taught verb works).
- The final boss must beat good (parry-competent) personas sometimes, or it is a ceremony.
- Persona playtests (rusher, duelist, novice) on identical seeds decide every number in this file.

---

## 13. The 10 highest-impact feel techniques and how to implement each in three.js

APIs named below were checked against the local three 0.186 install
(`games/blocktooth/node_modules/three`): `examples/jsm/math/SimplexNoise.js` (`noise`, `noise3d`),
`examples/jsm/postprocessing/AfterimagePass.js` (constructor `damp = 0.96`),
`examples/jsm/geometries/DecalGeometry.js`, `AnimationUtils.makeClipAdditive`,
`AdditiveAnimationBlendMode`, `PerspectiveCamera.fov` (vertical).

1. **Asymmetric, strength-scaled hitstop in the SIM.** Each actor has `freezeFrames`; on contact set
   attacker = tier.att, victim(s) = tier.vic x multi-target scale. While frozen, skip that actor's sim step
   and call its `AnimationMixer.update(0)` (pose holds on the contact frame, the GoW "pop to hit pose"
   look). Add victim shake as a render-only offset on the root bone (+-2 cm, 30 Hz). Hitboxes stay live.
   Never change the global clock for hitstop (other enemies must keep acting).
2. **Trauma camera shake, rotational only.** `trauma = min(1, trauma + k)`; each frame
   `trauma -= 1.6 * dt`; `s = trauma * trauma`; yaw/pitch/roll offsets = max x s x
   `simplex.noise(seed_i, t * 15)` from `SimplexNoise`, applied to a child "shake" object of the camera rig
   so the base camera stays clean. Uses sim time, so it slows in slow-mo (Eiserloh).
3. **FOV punch + dolly on heavies/finishers and slow-mo beats.** Spring `camera.fov` toward a target
   (-3 deg heavy; 50 deg finisher) and call `camera.updateProjectionMatrix()` when it changes; finishers
   dolly the rig to 2.2 m and orbit 20-35 deg. Slow-mo = a sim `timeScale` (0.3 finisher, 0.35 perfect
   dodge) that also scales camera smoothing alphas and particle dt.
4. **Attack magnetism / lunge.** At the move's startup, lock the soft target; during startup+active move
   the hero along the target direction by min(0.8 x reach gap, lunge cap) with an ease-out curve, and turn
   with a 0.35x turn damp once committed (doctrine). This is what makes 3D hits connect.
5. **Directional, strength-matched hit reactions with additive flinches.** Pick a reaction clip by hit
   direction (front/back/left/right x light/heavy/launch/crumple); for chain lights layer an additive
   flinch on top of the current clip: `THREE.AnimationUtils.makeClipAdditive(clip)` then
   `action.blendMode = THREE.AdditiveAnimationBlendMode`, weight 0.6-1.0 by strength. Heavier hits
   switch the base clip (crumple, launch, spin).
6. **Comic impact VFX stack per hit tier.** Hit flash: set a per-material `emissive`/uniform tint to
   white for 2-3 frames on the victim. Splatter: pooled `InstancedMesh` billboard splats + a
   `DecalGeometry` splat on the wall/floor for splats and slams (swap texture to sparks/confetti with the
   gore toggle). Speed lines + smear: an `AfterimagePass` (damp ~0.8-0.85) enabled only for heavy
   impacts/finishers, or velocity-stretched trail meshes on fists/feet. Pool everything and pre-warm
   shaders (doctrine section 3).
7. **Layered impact audio + crowd.** WebAudio: each hit = low "thump" + mid "crack" + high "slap"
   layers, pitch-randomised +-5%, volume by tier (GoW describes its axe hit as a low-end slam ending in a high-frequency slash); duck music 3-6 dB for 150 ms on heavies; crowd bed volume follows RATINGS, with one-shot
   roars on grade-ups, splats and finishers. Haptics via gamepad `vibrationActuator` / feature-detected
   `navigator.vibrate`.
8. **Input buffer + cancel windows that never drop an input.** A per-player input ring buffer stamped in
   sim frames; attack presses live 12 f (not aged during hitstop), dodge 21 f; the move state machine
   consumes the newest valid input on the first frame a cancel window opens (section 2c tables). Test it
   through real `KeyboardEvent`/touch dispatch (doctrine section 5).
9. **Authored knockback arcs, wall splats and ground bounces (not ragdolls).** Launches, throws and
   blowbacks are kinematic ballistic arcs (apex/airtime from section 1b; re-lift 0.7x per juggle hit);
   a `Raycaster` / capsule sweep along the arc detects walls -> snap to the wall plane, play the splat
   pose for 40 f, spawn decal + trauma +0.35 + 10/14 f hitstop, then slide. Ground bounce = one scripted
   rebound. Deterministic, readable, and scoreable.
10. **The show reacts to every beat (RATINGS feedback loop).** On each style event: host caption line
    (pre-written pools per event, never repeat within 30 s), HUD score punch (scale 1.0 -> 1.25 -> 1.0 over
    12 f, slanted comic frame), RATINGS grade-up stinger + music layer change, crowd reaction, and the
    grade name in the DMC-style meter. DMC5's rank announcer and MadWorld's two-man commentary show this is
    what makes every fight read as a show.

---

## 14. TV-show framing lessons (MadWorld and friends)
- Two-voice commentary riffing on items and kills (MadWorld's Howard + Kreese) beats a single announcer:
  HIT PARADE's host + co-host captions should banter, keyed to events (hazard, weapon, finisher, player
  hit, grade change) [S: madworld.fandom item pages carry per-item commentator lines].
- Violence in a comic register, stylised palette (MadWorld: black/white/red; the designer framed it as comic) [S] -> matches the brief's comic red splatter with a sparks/confetti toggle.
- Points gate progress: boss unlock by score, timed boss fight, optional challenge segments with their
  own hosts (Black Baron) [S] -> HIT PARADE sponsor segments and episode objectives (section 6b).
- Rank at the moment of a KO sets the payout (DMC) [S] -> RATINGS multiplier at award time.

---

## 15. Sources (all read this session unless marked "search summary")
- MadWorld: https://en.wikipedia.org/wiki/MadWorld ; https://madworld.fandom.com/wiki/Bloodbath_Challenges ;
  https://madworld.fandom.com/wiki/Finishers ; https://madworld.fandom.com/wiki/Tire ;
  https://madworld.fandom.com/wiki/Rose_Bush ; https://madworld.fandom.com/wiki/Sign_post ;
  https://madworld.fandom.com/wiki/Explosive_Drum ; https://madworld.fandom.com/wiki/Turbinator ;
  https://madworld.fandom.com/wiki/DeathWatch_Challenge ; https://madworld.fandom.com/wiki/Power_Struggle
- Bulletstorm: https://bulletstorm.fandom.com/wiki/Skillshots ; https://en.wikipedia.org/wiki/Bulletstorm
- Devil May Cry: https://devilmaycry.fandom.com/wiki/Stylish_Rank ; https://devilmaycry.fandom.com/wiki/Royalguard_Style
- Batman Arkham: https://arkhamcity.fandom.com/wiki/Freeflow_Combat ; https://arkhamcity.fandom.com/wiki/Counter ;
  attack-ticket claim: search summary of https://medium.com/@paple124/the-batman-arkham-combat-problem-7a95b90b5857 (403 on fetch)
- Streets of Rage 4: https://streetsofrage.fandom.com/wiki/Streets_of_Rage_4 ; mobile controls: search
  summaries of https://toucharcade.com/2022/05/24/streets-of-rage-4-mobile-review-mr-x-nightmare-dlc-price-worth-it-iphone-ipad-pro-performance-controller-support-graphics-online-multiplayer/
- Yakuza / Like a Dragon: https://yakuza.fandom.com/wiki/Heat_Actions ; https://yakuza.fandom.com/wiki/Kazuma_Kiryu/Fighting_Style
- God Hand: https://en.wikipedia.org/wiki/God_Hand
- Sleeping Dogs: https://en.wikipedia.org/wiki/Sleeping_Dogs_(video_game)
- No More Heroes: https://en.wikipedia.org/wiki/No_More_Heroes_(video_game)
- Sifu: https://blog.playstation.com/2021/11/18/how-sifus-kung-fu-combat-works/ ; parry mod claim:
  https://www.nexusmods.com/sifu/mods/1280 (search summary); camera: search summaries of
  https://en.wikipedia.org/wiki/Sifu_(video_game) and https://www.nexusmods.com/sifu/mods/90
- God of War 2018: https://blog.playstation.com/2022/10/04/game-developers-explain-what-makes-god-of-war-2018s-combat-tick/
- Frame data: https://ultimateframedata.com/sf6/ryu (raw HTML parsed) ; SF6 system facts: search summaries
  of https://wiki.supercombo.gg/w/Street_Fighter_6/Game_Data and /Offense and /Defense (Anubis-blocked) ;
  Tekken: https://wavu.wiki/t/Juggle ; https://wavu.wiki/t/Wall ; jab: search summary of wavu.wiki movelists
- Hitstop: https://shane-sicienski.com/blog/blog-post-title-one-55pmn ; https://sonichurricane.com/?p=1043 ;
  https://www.ssbwiki.com/Hitlag ; https://www.ssbwiki.com/Hitstun ; https://www.ssbwiki.com/Buffer ;
  SFV: search summary of http://shoryuken.com/2016/06/07/hitstop-in-street-fighter-v-kens-not-so-little-secret/
- Stun: https://streetfighter.fandom.com/wiki/Stun_Gauge
- Parry/dodge: https://sekiroshadowsdietwice.wiki.fextralife.com/Deflection ; Dark Souls 3 i-frames: search
  summary of https://darksouls3.wiki.fextralife.com/Carthus_Bloodring
- Group AI: http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter28_Beyond_the_Kung-Fu_Circle_A_Flexible_System_for_Managing_NPC_Attacks.pdf ;
  https://www.strayspark.studio/blog/attack-token-system-ue5-group-combat-that-feels-fair ;
  DOOM: search summary of https://www.gamedeveloper.com/design/cyber-demons-the-ai-of-doom-2016-
- Telegraph / reaction: https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/ ;
  https://note.com/darkangels_417/n/nb520b22d60f7 ; https://www.gamedeveloper.com/design/enemy-attacks-and-telegraphing ;
  reaction-time study: search summary of https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4374455/
- Camera: http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf ;
  https://critpoints.net/2015/05/24/what-is-your-ideal-form-of-lock-on-in-action-games/ ; UE5 template
  defaults: search summary of https://forums.unrealengine.com/t/how-to-get-current-target-arm-length-of-camera-spring-arm-in-third-person-blueprint-template/295421
- Mobile: https://prog21.dadgum.com/124.html ; touch-target sizes: search summaries of
  https://m3.material.io/foundations/designing/structure and Apple HIG summaries
- Internal: `pipeline/knowledge/GAME_DOCTRINE.md` sections 2 and PROMPT CORE; `_spec/BRIEF.md`.

## 16. Gaps and caveats (reported, not papered over)
- No first-party frame data exists publicly for Sifu, Yakuza, Arkham or MadWorld; their numbers here are
  mechanics and point values, not frame timings. The only hard frame data is SF6, Tekken (jab),
  Capcom arcade beat 'em ups (hitstop), Smash, Sekiro, DMC5, Dark Souls 3.
- Several pages blocked automated fetching (SuperCombo, some Medium/Unreal pages); those facts are
  labelled "search summary" and should be treated as unverified leads.
- The Arkham "4 tickets" figure is unverified (source page 403).
- The GDC talks on God of War's camera/combat (Mihir Sheth, GDC 2019) and DOOM's tokens (GDC 2018) were
  found but their content was not available as text; only summaries were read.
- Every [R] number is a starting point. Acceptance = persona playtests (rusher/duelist/novice) through
  the real input path, per GAME_DOCTRINE sections 2 and 5.
