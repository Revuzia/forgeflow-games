# HIT PARADE - Versus Fighting Game Design Research (lane: fighting design)

Date: 2026-09-29. Scope: turn Street Fighter 6 / SFII / Tekken 8 / Mortal Kombat 1 / Virtua Fighter conventions into
concrete numbers for HIT PARADE's 1v1 versus game (arcade ladder vs CPU -> mini boss -> boss, local + online PVP,
10 fighters). The beat-'em-up lane (`DESIGN_RESEARCH.md`) still owns the BRAWL BREAK bonus round; the netcode lane
(`NETCODE.md`) owns rollback details. This file owns the versus rules.

**Evidence labels** (fable-method "claims ship with evidence"):
- **[S]** = stated by a source I read this session (URL inline). "(search summary)" = only a search-engine summary was
  available, the page itself was not read; treat as weaker.
- **[M]** = measured by our own script from source data (SuperCombo / wavu.wiki Cargo tables). Outputs saved under
  `_research/fighting/`.
- **[D]** = derived by our arithmetic (script named).
- **[R]** = our recommendation. Every [R] number is a starting value for the persona playtests (doctrine section 2),
  not a law.

Scripts (all under `tools/research/`, ASCII, runnable with plain `python`):

| Script | What it does | Output |
|---|---|---|
| `fg_wikifetch.py` | fetches MediaWiki wikitext via `api.php` (SuperCombo, wavu, fandom, Wikipedia, ssbwiki); raw pages cached in the scratchpad only | - |
| `fg_sf6_class_stats.py` | pulls all 2,450 rows of SuperCombo's `SF6_FrameData` + 34 rows of `SF6_CharacterData`, computes per-move-class medians | `_research/fighting/sf6_class_stats.txt` |
| `fg_t8_class_stats.py` | pulls all 6,591 rows of wavu.wiki's Tekken 8 `Move` table, per-class medians | `_research/fighting/t8_class_stats.txt` |
| `fg_versus_scale_camera.py` | converts SF6 spacing ratios to metres (explicit scale assumption) + side-on camera distances | `_research/fighting/versus_scale_camera_output.txt` |
| `fg_template_check.py` | verifies the HIT PARADE frame-data template arithmetic and prints it | `_research/fighting/template_check_output.txt` |

---

## 0. Summary - the twelve decisions

1. **2.5D plane, not full 3D** (section 6). 3D bodies and 3D sets on a single fight line, like SF6 ("continues the
   2.5D style introduced in Street Fighter IV" - https://en.wikipedia.org/wiki/Street_Fighter_6). No sidestep.
   The reference's 3D camera energy lives in super/finisher cinematics, the KO camera and the BRAWL BREAK round.
2. **60 Hz sim, frame data in frames, SF6 conventions** (startup counts the first active frame; advantage =
   stun - (active + recovery)). Matches the tech lane's `SIM_DT = 1/60` (TECH_REUSE.md).
3. **Health 10,000** per fighter, archetype range **9,000-11,000** (SF6 measured 10000 [9000..11000] [M]).
   Mini boss 11,500, boss 13,000 [R].
4. **99-second rounds, first to 2 rounds, max 5 rounds** (SF convention [S]); the timer freezes during super
   cinematics (SF6 [S]).
5. **SF6 damage scaling table verbatim** (100/100/80/70/... with light-starter 100/80/70/...; supers keep 30/40/50%
   minimum) [S].
6. **Three meters**: HP; **SHOWTIME** (super gauge, 3 bars x 10,000, SF6 gain rules) which is also the TV
   RATINGS meter on screen; **NERVE** (SF6 Drive analog, 6 bars x 10,000: parry, IMPACT, rush, EX specials, shove),
   with **STAGE FRIGHT** as its burnout state [R on SF6 numbers].
7. **Throws**: 5f startup, 0.60 m range, tech window 9 frames, strikes beat throws on the same frame, punish-counter
   throws +70% and unbreakable (all SF6 [S]).
8. **Parry**: holdable, catches everything from frame 1 (always reachable), perfect parry in the first **3** frames
   (SF6 is 2; +1 for browser input jitter [R]), 60-frame zoomed freeze on a perfect parry (SF6 [S]).
9. **Input**: 5-frame link buffer, 8-frame dash buffer, 11-frame wakeup reversal window; motion windows QCF 11f,
   half-circle 12f, 360 32f (WydD's SF6 measurements [S]); charge 45f with 10f keep (SF6 Guile [S]).
10. **Two control types**: CLASSIC (6 attack buttons, motion inputs) and SIMPLE (L/M/H + SPECIAL + ASSIST, SF6
    Modern rules incl. the 20% damage penalty on one-button specials [S]). Touch defaults to SIMPLE.
11. **Arcade "THE SEASON"**: 8 bouts = 4 random, RIVAL (bout 5), 1 random, MINI BOSS (bout 7), BOSS (bout 8), with
    BRAWL BREAK bonus rounds after bouts 3 and 6 (SF4 / SF Alpha / Tekken 1 / SFII structures [S]); a 5-bout
    "PILOT" option (SF6 offers 5 or 12 stages [S]).
12. **CPU difficulty 1-8** driven by honest levers (reaction delay 48f -> 18f, block/anti-air/punish rates, combo
    route, meter use). Never read inputs; the 18f floor equals the doctrine's 300 ms and sits inside the 12-19f
    human response band reported by the Killer Instinct Shadow AI article [S].

---

## 1. Frame-data template (60 fps) per move class

### 1a. What the roster medians actually are (measured)

Source: SuperCombo `SF6_FrameData` Cargo table (https://wiki.supercombo.gg/w/Street_Fighter_6/Game_Data, queried via
`https://wiki.supercombo.gg/api.php?action=cargoquery`), 2,450 rows, 34 characters. Values are
median [min..max] (n rows). Script: `fg_sf6_class_stats.py` [M]. Hitstun/blockstun/hitstop are the per-move cells.

| SF6 class | Startup | Active | Recovery | On hit | On block | Damage | Hitstun | Blockstun | Hitstop | Super gain (hit) | Drive dmg on block | Reach (SF6 units) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stand light (5LP/5LK) n=63 | 5 [4..9] | 3 | 10 [6..17] | +3 | -2 | 300 | 16 | 10 | 9 [9..11] | 300 | 500 | 1.13 |
| crouch light (2LP/2LK) n=62 | 5 [4..6] | 3 | 9 | +4 | -2 | 260 | 15 | 10 | 9 [9..9] | 300 | 500 | 1.08 |
| stand medium n=62 | 8 [5..14] | 3 | 16 | +3 | -3 | 600 | 23 | 17 | 11 | 500 | 3000 | 1.47 |
| crouch medium n=62 | 8 [6..12] | 3 | 16 | +4 | -2 | 600 | 22 | 16 | 11 | 500 | 3000 | 1.45 |
| stand heavy n=62 | 12 [5..19] | 3 | 20 | +2 | -3 | 800 | 26 | 20 | 13 | 1000 | 5000 | 1.77 |
| crouch heavy 2HP n=31 | 9 [7..19] | 4 | 21 | +2 | -6 | 800 | 27 | 20 | 13 | 1000 | 5000 | 1.20 |
| sweep 2HK n=31 (29 knock down) | 10 [8..14] | 3 | 24 | KD +33 | -11 | 900 | - | 18 | 13 | 1000 | 4000 | 1.84 |
| command normals n=102 | 16 [5..37] | 3 | 20 | +3 | -3 | 800 | 25 | 20 | 13 | 1000 | 4000 | 1.70 |
| air light n=62 | 5 | 7 | 3 landing | +5 | +1 | 300 | 13 | 9 | 9 | 300 | 1500 | 0.82 |
| air medium n=62 | 7 | 6 | 3 landing | +9 | +5 | 600 | 17 | 13 | 11 | 500 | 2500 | 1.09 |
| air heavy n=61 | 10 | 6 | 3 landing | +9 | +4 | 800 | 19 | 15 | 13 | 1000 | 4000 | 1.13 |
| forward throw (LPLK) n=31 | 5 [5..5] | 3 | 23 [23..23] | KD +21.5 | - | 1200 | - | - | - | 2000 | - | 0.80 |
| projectile (236P class) n=40 | 14 [10..56] | - | 31.5 | -1 | -5 | 600 | 31.5 | 27 | **8** | 600 | 2500 | - |
| DP / 623 anti-air n=54 (51 KD) | 7 [5..32] | 8 | 24.5 | KD +31 | **-29** [-45..3] | 1000 | - | 20 | 14.5 | 800 | 4000 | 1.14 |
| command grab n=41 (40 KD) | 8 [4..55] | 3 | 51 | KD +27 | - | 2200 | - | - | - | 3000 | - | 1.31 |
| Drive Impact n=32 | 26 | 2 | 35 | KD +35 | -3 | 800 | - | 34 | **25** | 0 (the Gauges page says DI builds no super; the table's bracketed "[3000]" cell is unexplained) | 5000 | 2.52 |
| super Lv1 n=46 | 8.5 | 5 | 52.5 | KD +23 | -32 | 2000 | - | 40.5 | 9 | -10000 | 600 | 2.61 |
| super Lv2 n=62 | 9 | 6 | 39 | KD +23.5 | -29 | 2800 | - | 25 | 8.5 | -20000 | 5000 | 2.48 |
| super Lv3 / Critical Art n=63 | 10 [5..20] | 4 | 58 | KD +19 | -41.5 | 4500 [2600..5300] | - | 25 | 9 | -30000 | 7500 | 1.94 |

Specific reference rows pulled from the same table [M]:
- Screw Piledriver (Zangief 360+P): 5 / 3 / 54, damage LP 2500 / MP 2900 / HP 3300, reach LP 1.62 / MP 1.47 / HP 1.22
  (the weaker version reaches further), hard knockdown +28..+30.
- Sonic Boom (Guile [4]6P): startup 10, recovery 30, +3 on hit, -3 on block, 550 damage, hitstop 8; Somersault
  Kick ([2]8K): 5/6/7 startup, air-invulnerable 1-7 / 1-8 / 1-9, -30..-32 on block.
- Shoryuken (Ryu 623P): LP 5 / MP 6 / HP 7 startup, 10 active, -23 / -32 / -39 on block, 1100 / 1200 / 1400 damage.
- Rush specials: Juri 214LK 10/4/19 -4; E. Honda Sumo Headbutt LP 10 startup -3 on block, air-invulnerable 4-13;
  Cammy Spiral Arrow LK 9/13/21 -12, throw-invulnerable 9-24.

Tekken 8 cross-check (wavu.wiki `Move` Cargo table, https://wavu.wiki, 6,591 rows; `fg_t8_class_stats.py`) [M]:
jab (1) is **i10 in all 42 rows**, +1 on block, +8 on hit, 5 damage; df+1 mid check i13, -3 / +5, 10 damage; d+3/d+4
low poke i16, -15 on block; generic throws (1+3 / 2+4) i12, 35 damage; Heat Burst (2+3) i16, +1 on block. Tekken is
slower and heavier than SF (jab i10 vs SF6 5f light) because a 3D fighter's neutral is built on sidestep and
movement, not on 5-frame pokes.

### 1b. HIT PARADE template (60 fps) - normals

Arithmetic verified by `fg_template_check.py` (output: `_research/fighting/template_check_output.txt`) [D][R].
Values sit on the SF6 medians above; reach converted with the scale in section 2h.

| Class | Startup | Active | Recovery | Total | Hitstun | Blockstun | On hit | On block | On punish-counter hit | Damage | Hitstop | Guard | Super gain hit / block | Reach |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stand light | 5 | 3 | 9 | 16 | 15 | 10 | +3 | -2 | +7 | 300 | 9 | H/L | 300 / 150 | 0.85 m |
| crouch light (low) | 5 | 3 | 9 | 16 | 15 | 10 | +3 | -2 | +7 | 250 | 9 | L | 300 / 150 | 0.81 m |
| stand medium | 8 | 3 | 16 | 26 | 22 | 16 | +3 | -3 | +7 | 600 | 11 | H/L | 500 / 250 | 1.11 m |
| crouch medium (low poke, cancelable) | 8 | 3 | 15 | 25 | 22 | 16 | +4 | -2 | +8 | 600 | 11 | L | 500 / 250 | 1.09 m |
| stand heavy | 12 | 3 | 20 | 34 | 25 | 20 | +2 | -3 | +6 | 800 | 13 | H/L | 1000 / 500 | 1.33 m |
| crouch heavy (anti-air normal) | 9 | 4 | 21 | 33 | 27 | 19 | +2 | -6 | +6 | 800 | 13 | H/L | 1000 / 500 | 0.90 m |
| sweep (low, knockdown) | 10 | 3 | 24 | 36 | KD | 16 | KD +33 | -11 | KD | 900 | 13 | L | 1000 / 500 | 1.38 m |
| overhead (6 + button) | 18 | 3 | 17 | 37 | 22 | 16 | +2 | -4 | +6 | 600 | 11 | H (stand block only) | 500 / 250 | 1.10 m |
| air light | 5 | 7 | 3 landing | - | 13 | 9 | +5 typical | +1 typical | - | 300 | 9 | H | 300 / 150 | 0.62 m |
| air medium | 7 | 6 | 3 landing | - | 17 | 13 | +9 | +5 | - | 600 | 11 | H | 500 / 250 | 0.82 m |
| air heavy | 10 | 6 | 3 landing | - | 19 | 15 | +9 | +4 | - | 800 | 13 | H | 1000 / 500 | 0.85 m |

Design consequences (from the check script):
- **No normal links into another on a normal hit** (+2..+4 vs a 5f fastest button): combos come from **chains**
  (light -> light), **cancels** (normal -> special during hitstop + recovery) and **target combos**. That keeps
  execution browser-friendly. A **punish counter** (+4) opens links (+6..+8 -> lights and mediums), exactly the SF6
  pattern ("your first attack will have 4 extra frames of hit advantage" on punishes -
  https://wiki.supercombo.gg/w/Street_Fighter_6/Defense) [S].
- Nothing but sweep, anti-air heavy and specials is punishable on block (the script warns on any other normal <= -5).
- Rule of thumb [M]: **blockstun = hitstun - 6** for ground normals (SF6 medians: 16/10, 23/17, 26/20, 22/16),
  **hitstun - 4** for air normals (13/9, 17/13, 19/15).
- The shoto (section 8) gets one 4f jab as a character trait, which restores light -> medium links for that fighter only.

### 1c. HIT PARADE template - specials, supers, system moves

| Class | Startup | Active | Recovery | On block | On hit | Damage | Hitstop | Invulnerability / armor | Notes (source of the shape) |
|---|---|---|---|---|---|---|---|---|---|
| Projectile L / M / H | 16 / 14 / 12 | until it hits | 31 / 33 / 35 (total 47) | -5 point blank | -1..+2 | 600 | 8 | none | Ryu Hadoken 16/14/12 startup, 47 total [M]; projectile hitstop 8 is SF6's median [M]. Speed [R]: 4.5 / 6.0 / 7.5 m/s (a 3 m gap takes 40 / 30 / 24 frames, jumpable on reaction). Charge version: startup 10, recovery 30, -3 (Sonic Boom) [M]. |
| Anti-air reversal (DP) L / M / H | 5 / 6 / 7 | 10 | 33 / 42 / 46 incl. landing | -23 / -32 / -39 | KD +35 | 1000 / 1100 / 1300 | 15 | air-invulnerable L 1-14 / M 1-9 / H 1-8; EX (2 NERVE) fully invulnerable 1-8 | Ryu 623P rows incl. invuln cells (623LP 1-14 Air, 623MP 1-9 Air, 623HP 1-8 Air, 623PP 1-8 Full) [M]; roster median -29 on block [M]. |
| Rush special L / M / H | 10 / 12 / 14 | 4 | 19-22 | -4 / -6 / -12 (H travels furthest) | KD +30..+37 | 900 / 1000 / 1100 | 13 | H version throw-invulnerable during travel | Juri 214LK 10/4/19 -4, E. Honda headbutt -3, Cammy Spiral Arrow -12 [M]. Travel 1.2 / 1.8 / 2.6 m [R]. |
| Command grab L / M / H | 5 | 3 | 54 (whiff) | unblockable | hard KD +28 | 2500 / 2900 / 3300 | 0 (throw) | none; whiff = huge punish | Screw Piledriver [M]. Reach L 1.22 m / M 1.10 m / H 0.92 m (L trades damage for reach, as SF6) [D, K=0.752]. 360 window 32 f [S]. |
| Normal throw (fwd / back) | 5 | 3 | 23 (whiff 30 total) | - | KD +21 (back throw +11..+17) | 1200 | 0 | strikes beat throws on the same frame | SF6 all 31 rows 5/3/23 [M]; rules in section 3c. |
| IMPACT (Drive Impact analog) | 26 | 2 | 35 | -3 | KD +35; corner = wall splat | 800 | **25** | 2 hits of armor through startup + active | SF6 DI is identical in all 32 rows [M]; armor and wall splat rules [S] section 3b. Costs 1 NERVE bar. |
| SUPER Lv1 (1 bar) | 8-9 | 5 | 50 | -30 | KD +23 | 2000 | 9 per hit, 20 on the last | Lv1 on the shoto / rushdown / charge: invulnerable 1-(startup+2) | SF6 Lv1 median 8.5 startup, 2000 dmg, -32 [M]. Min damage 30% after scaling [S]. |
| SUPER Lv2 (2 bars) | 9 | 6 | 40 | -29 | KD +23 | 2800 | same | usually strike/throw-invulnerable | SF6 Lv2 median [M]; min 40% [S]. |
| SUPER Lv3 "PRIME TIME" (3 bars) | 10 | 4 | 58 | -42 | KD +19 | 4500 | cinematic | fully invulnerable 1-13 typical | SF6 Lv3/CA median 4500 [2600..5300] [M]; min 50% [S]. Full camera cinematic, timer frozen [S]. |
| LAST CALL (desperation, HP <= 30%) | 12 | 4 | 50 | -24 | cinematic | 3000 | cinematic | armored startup | MK1 Fatal Blow rules [S] section 2e. No meter; once per match if it lands. |
| Parry (hold) | 1 | 12, extended while held | 33 after release | = block adv | - | - | - | perfect parry in active frames 1-3 | SF6 regular 12~ active, perfect in 2 frames, 33 recovery [S]; +1 perfect frame [R]. |
| Forward dash / back dash | - | - | 18 / 23 total | - | - | - | - | back dash throw-invulnerable frames 1-15 | Throw-invuln 15f is SF6 [S]; totals [R]. Distances 1.06 m / 0.68 m [D]. |
| Jump (neutral / fwd / back) | 4 prejump | 38 airborne | 3 landing | - | - | - | - | prejump frames unthrowable | SF6 "4+38+3" is the most common jump [M]; prejump rules [S]. Apex 1.59 m, forward distance 1.43 m [D]. |

---

## 2. Universal system numbers

### 2a. Health, damage, round structure

| Item | HIT PARADE [R] | Evidence |
|---|---|---|
| Base HP | **10,000** | SF6 median 10000, range 9000 (Akuma) to 11000 (Zangief); 10500 for Alex, Arjun, E. Honda, Marisa [M]. SF4: "average character has 1000", 900 low, 1100 high, boss Seth 750, Rufus 1150 (https://wiki.supercombo.gg/w/Street_Fighter_IV/Basic_Elements/Life_Meter) [S]. MK1: most 1000, range 900 (Nitara) to 1100 (Conan, Havik, General Shao) (https://wiki.supercombo.gg/w/Mortal_Kombat_1/Game_Data) [S]. Tekken 8: 180 at release, 200 in patch 2.00.02, 190 in 3.02.01 (https://tekken.fandom.com/wiki/Health) [S]. |
| Archetype HP band | 9,000 - 11,000 (+-10%) | same spreads: SF6 +-10%, MK1 +-10%, SF4 -15%..+15% |
| Mini boss / boss HP | 11,500 / 13,000 | Tekken 6: players 180, boss Azazel 240 (1.33x) (tekken.fandom Health) [S]; SF4 went the other way: Seth 750 with stronger tools [S]. We use +30% plus phases, not cheats (section 10). |
| Typical combo damage | meterless 1,400-2,640 (14-26% HP); with a Lv3 super ~5,300 (53%) | [D] from the template + SF6 scaling (2c): (a) crouch medium 600 x1.0 + rush special M 1000 x0.8 (2MK-class starter) = 1,400; (b) air heavy 800 + stand heavy 800 + DP H 1300 x0.8 = 2,640; (c) punish counter stand heavy 800 x1.2 + link stand medium 600 + rush H 1100 x0.8 = 2,440; (b) + Lv3 4500 x0.6 (SF6: Lv3 "acts as if there is 1 additional hit of scaling") = 5,340 |
| Round timer | **99**, counts down 1 per 60 sim frames | SF4 timer "starts at 99" (https://wiki.supercombo.gg/w/Street_Fighter_IV/Basic_Elements/Timer) [S]; SF main series options 30/60/99/infinite (https://streetfighter.fandom.com/wiki/Round_Timer) [S]; SF6 tournament setting 99 s, 3 rounds per game (https://help.playvs.com/en/articles/9689384-street-fighter-6-rulebook, search summary). Tekken default 60 s (search summary citing tekken.fandom). |
| Timer freezes | during super cinematics and after a KO | SF6: "The round timer is frozen for the entire duration of a Super Art" (https://wiki.supercombo.gg/w/Street_Fighter_6/Gauges) [S]; SF timer stops on KO and on Super Combo (streetfighter.fandom Round Timer) [S]. |
| Rounds | first to **2** round wins; **max 5 rounds**; draw rounds count as a win for both | SFII: "The first fighter to win two rounds is declared the victor"; max 10 rounds in World Warrior, reduced to 4 from Champion Edition; a final-round tie = CPU wins in single player, both lose in 2P (https://en.wikipedia.org/wiki/Street_Fighter_II) [S]. |
| Time-out verdict | higher HP **fraction** wins, strict; exact tie = draw; in ARCADE an exact tie on the last round = CPU wins | SFII rule above [S] + doctrine "A timeout verdict must never reward passivity" (strict advantage only). |
| Round-start distance | 2.40 m centre to centre (just outside sweep reach 1.38 m + a medium step) | [R]; SF6's start distance was not in the pages read. |
| Stage width | 16 m wall to wall; camera separation cap 6.0 m | [R] (tunable by persona playtest: from centre, ~3 knockdowns + pushes should reach a corner) |
| Recoverable (grey) HP | armor absorbs and chip become grey HP; 120-frame delay, then +2 HP/frame; lost on the next real hit; can KO | SF6 exact rule (https://wiki.supercombo.gg/w/Street_Fighter_6/Game_Data) [S] |

### 2b. Counter hits

| Hit type | Frame bonus | Damage | Extra | Source |
|---|---|---|---|---|
| Counter hit (hit during the opponent's startup/active) | +2 | +20% | trades: both sides get a counter hit | SF6 (https://wiki.supercombo.gg/w/Street_Fighter_6/Offense) [S]; Tekken CH = 120% damage (https://wavu.wiki/t/Counter_hit) [S] |
| Punish counter (hit during recovery) | +4 | +20% | drains opponent NERVE; select heavies gain crumple/launch | SF6 [S] |
| Punish-counter throw | - | **+70%** | hard knockdown (no back rise), drains 1 NERVE bar; throws always punish-counter a parry | SF6 [S] |

### 2c. Damage scaling (adopt SF6 verbatim) [S]
Source: https://wiki.supercombo.gg/w/Street_Fighter_6/Game_Data. "Attack" = each player-input move, not each hit
(a multi-hit special counts once; each part of a target combo counts).

| Attack # | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10+ |
|---|---|---|---|---|---|---|---|---|---|---|
| General | 100% | 100% | 80% | 70% | 60% | 50% | 40% | 30% | 20% | 10% |
| Light normal (or crouch medium) starter | 100% | 80% | 70% | 60% | 50% | 40% | 30% | 20% | 10% | 10% |

Modifiers (SF6 [S] -> HIT PARADE names):
- Supers never drop below **30% (Lv1) / 40% (Lv2) / 50% (Lv3)** of their damage; a Lv3 cancelled from a special takes an
  extra 10% penalty (100 -> 90).
- Punish after a **perfect parry**: whole combo x0.5 (50 -> 50 -> 40 -> 35 ...); super gain 80%, NERVE gain 50%.
- **RUSH mid-combo** (Drive Rush analog): all remaining hits x0.85, rounded down, not stacking.
- **IMPACT**: on hit or stun = 20% starter scaling (then 80 -> 70 -> 60); blocked corner splat = x0.8 multiplier.
- **Throws comboed into** (after stun/crumple/splat) take an immediate -20%.
- Tekken comparison: aerial hits 70% / 50% / 40% / 30% from the first juggle hit, x0.8 after a wall hit
  (https://wavu.wiki/t/Juggle) [S]; SFV used a simple 100/90/80.../10 ladder
  (https://wiki.supercombo.gg/w/Street_Fighter_V/Game_Data) [S].
- **No GUTS** [R]. SFV reduced damage below 50/30/15% HP to 95/90/75% (SFV Game Data) [S]; HIT PARADE already has LAST
  CALL as its comeback, and two comeback systems blur the ratings read.

### 2d. SHOWTIME gauge (super meter = the on-screen RATINGS meter)
SF6 rules adopted (https://wiki.supercombo.gg/w/Street_Fighter_6/Gauges) [S]:
- 3 bars x 10,000; both players start the **match** empty; the gauge **carries between rounds**.
- Gain on hit = the move's value (template: light 300, medium 500, heavy 1000, special 600-1400, throw 2000); on block
  the attacker gets 50%; the defender gets **70% of it when hit** and **25% when blocking**. **No gain on whiff**.
  Throw tech also builds meter. Gain is not scaled by combo scaling or counter status (throws are the exception).
  IMPACT, SHOVE and supers build no super meter themselves (SF6: Drive Impact, Drive Reversal and Super Arts "do not
  build additional Super Gauge") [S].
- Costs: Lv1 10,000 / Lv2 20,000 / Lv3 30,000 (SF6 super rows: superGain -10000/-20000/-30000 [M]).
- Derived [D]: one bar = 34 landed lights or 10 landed heavies or 5 throws.
- **TV layer [R]**: the RATINGS number the HUD shows is SHOWTIME x a style multiplier for SCORE only; the style
  multiplier never touches versus damage or meter (online balance must not depend on flair scoring).

### 2e. LAST CALL (desperation finisher) [R on MK1 numbers]
MK1 Fatal Blow (https://wiki.supercombo.gg/w/Mortal_Kombat_1/Offense) [S]: available at <= 30% health; if blocked,
whiffed or interrupted it goes on a **9-second** cooldown; once it hits it is gone for the match. Tekken's analog: Rage
at <= 45 HP (Tekken 8 season 3; 43 in S1, 47 in S2) (https://wavu.wiki/t/Rage) [S], i.e. ~24% of 190 HP; wavu also lists
+10% damage in Rage but marks that line "citation needed".
- HIT PARADE: LAST CALL unlocks at **<= 30% HP**, input = both HEAVY buttons + SPECIAL in SIMPLE, 236236 + both heavies
  in CLASSIC, 3,000 damage, armored startup, host caption "LAST CALL!", 9 s cooldown on whiff/block, once per match on hit.
  No passive damage bonus.

### 2f. NERVE gauge (SF6 Drive analog) and STAGE FRIGHT (burnout)
All base numbers are SF6 (https://wiki.supercombo.gg/w/Street_Fighter_6/Gauges) [S]; names and the cut list are [R].

| Item | SF6 value [S] | HIT PARADE [R] |
|---|---|---|
| Size | 6 bars; 1 bar = 10,000 | same |
| Start of each round | full | same |
| Passive regen | 40 / frame (24% of a bar per second); 20 / frame in hitstun or airborne; +20 / frame walking forward (frame 11+ of a forward walk doubles base regen) | same, minus the frame-11 walk doubling (hidden rule, low value) |
| Blocking | drains per move (light 500, medium 3000, heavy 5000 [M medians]) and stops regen for 90 frames | same |
| Regen cooldown after spending | 120 frames (EX, IMPACT, shove, rush cancel); 240 after a whiffed parry | same |
| Parry | 5000 on activation (frame 2) + 50 per frame from frame 4; parrying a projectile refunds 5000, a normal/special 10000, a super or IMPACT 20000 | same |
| IMPACT (Drive Impact) | 1 bar | same |
| RUSH (Drive Rush) | from parry: ~1 bar total (SuperCombo's table lists half a bar on top of the parry; Capcom's text says "1 Drive Stock"); cancel from a normal: 3 bars; startup 3+8 (from parry) / 9 (cancel); normals out of the rush get +4 | same |
| EX specials (Overdrive) | 2 bars | same |
| SHOVE (Drive Reversal) | 2 bars, from blockstun | same, damage is grey HP only |
| Any action with a sliver left | allowed | same (it is how rounds get stolen) |
| **Burnout** penalties | +4 blockstun on everything blocked; chip damage from specials/supers (~25% of damage); corner IMPACT stuns on hit **or block**; no Drive actions until the gauge is **completely** refilled | **STAGE FRIGHT**: same four penalties. Regen in burnout 50 / frame -> a passive full refill is 1,200 frames = **20 s** [D]; landing hits shortens it. Community reports ~17 s (https://www.eventhubs.com/news/2022/jun/14/burnout-state-street-fighter-6/, search summary). |
| Stun after corner IMPACT in burnout | opponent hittable for **195 frames** from wall contact, combos start at 80% | same; HUD caption "STAGE FRIGHT!" |

Why a guard resource at all [R + S]: SF6's gauge "weakens passive, defensive playstyles significantly" (SF6 Gauges) [S]
and it is the SF6 answer to the "guard crush" family Infil describes as a reason "to not try to block forever"
(https://glossary.infil.net, "Guard Crush") [S]. It is also the direct fighting-game form of the doctrine's
"guard-break is a state that mends at a threshold" rule (section 12).

### 2g. Hitstop / hitstun / blockstun per strength

| Strength | Hitstop HP [R] | SF6 measured hitstop [M] | SF4 / SFV / SFII (via DESIGN_RESEARCH.md 3a, sourced there) | Hitstun HP (stand / crouch / air) [R] | Blockstun HP (stand / crouch / air) [R] | SF6 medians hitstun / blockstun [M] |
|---|---|---|---|---|---|---|
| Light | 9 | 9 [9..11] | SF4 ~9, SFV 8 (search summary), SFII ~14 flat | 15 / 15 / 13 | 10 / 10 / 9 | 16/10 stand, 15/10 crouch, 13/9 air |
| Medium | 11 | 11 [4..12] | SF4 ~11, SFV 12 | 22 / 22 / 17 | 16 / 16 / 13 | 23/17, 22/16, 17/13 |
| Heavy | 13 | 13 [2..13] | SF4 ~13, SFV 15 | 25 / 27 / 19 | 20 / 19 / 15 | 26/20, 27/20, 19/15 |
| Special (strike) | 15 | DP 14.5 median; Ryu specials 15 | - | per move (knockdowns common) | 20-22 | DP blockstun 20 |
| Projectile | 8 | 8 [5..10] | - | 31 | 27 | 31.5 / 27 |
| IMPACT | 25 | 25 (all 32 rows) | - | KD | 34 | - / 34 |
| Super, per hit / last hit | 9 / 20 | Lv3 median 9, max 20 | - | cinematic | 25 | - |
| Punish counter on a heavy | +4 (17) | "some Punish Counters with special effects can have extra long hitstop" (SF6 Game Data) [S] | - | +4 frames | - | - |
| KO hit | 30, then slow-mo (section 7c) | - | - | - | - | - |

- Hitstop freezes both fighters; both timelines stop (SF6 Game Data: "time essentially stops for both characters")
  [S], and "hitstop helps to give players time to input a special move cancel and hitconfirm" [S] - so the cancel
  window is measured in sim frames that exclude hitstop, and inputs made during hitstop are buffered (section 4).
- Blockstop = hitstop (same table) [R].

### 2h. Spacing, walk speeds, pushback, corners
SF6 does not define its distance unit in the pages read, so HIT PARADE borrows **ratios** and converts with an explicit
scale **K = 0.752 m per SF6 unit**, anchored on one assumption: the median SF6 standing light reach (1.13 u) should be
~0.85 m for a 1.8 m fighter. Output from `fg_versus_scale_camera.py` [D]:

| Quantity | SF6 median [M] | HIT PARADE [D] |
|---|---|---|
| throw range | 0.80 u | 0.60 m |
| standing light / crouching light reach | 1.13 / 1.08 u | 0.85 / 0.81 m |
| standing / crouching medium reach | 1.47 / 1.45 u | 1.11 / 1.09 m |
| standing heavy / sweep reach | 1.77 / 1.84 u | 1.33 / 1.38 m |
| IMPACT reach | 2.52 u | 1.90 m |
| forward / back dash distance | 1.41 / 0.90 u | 1.06 / 0.68 m |
| forward jump distance / apex | 1.90 / 2.12 u | 1.43 / 1.59 m |
| forward / back walk | 0.047 / 0.032 u per frame | **2.12 / 1.44 m/s** (back = 68% of forward) |
| light pushback on block | 0.36 u | 0.27 m |
| IMPACT pushback on block | 1.801 u (SF6 Gauges [S]) | 1.35 m |

Rules (SF6 [S] unless noted):
- First walk frame moves at 1/4 speed (SF6 Movement: https://wiki.supercombo.gg/w/Street_Fighter_6/Movement).
- Crouching hurtbox shifts on the 5th crouch frame; holding back during an attack's startup enters proximity guard
  inside the attack's range (SF6 Defense/Game Data).
- **Corner rule**: when the defender is against the wall, the pushback goes to the attacker (SF6 parry pushback notes:
  "If one character is cornered, all pushback will be transferred to the non-cornered character") [S]; a parried strike
  splits pushback 50/50 between both [S].
- Auto guard: inside a true blockstring, mids and overheads auto-block; lows still need crouch-block (SF6 Defense) [S].

### 2i. Juggles
Adopt SF6's integer juggle system (https://wiki.supercombo.gg/w/Street_Fighter_6/Glossary) [S]: every hit carries
**Juggle Start (JS)**, **Juggle Increase (JI)** and **Juggle Limit (JL)**; the defender carries a juggle count (JC).
A hit connects on an airborne opponent only if JL >= JC; normals are JL 0 (free-juggle state only); JC -1 = crumple.
Ryu's rows show the pattern: DP JS1 JI1 JL5(7); OD Tatsu JL 1/3/5/7/9 per hit; supers JL 99 [M].
HIT PARADE additions [R]: max **1 wall splat** and **1 ground bounce** per combo (Tekken allows one combo extender per
combo - https://wavu.wiki/t/Juggle [S]; SoR4 caps wall bounces at 3, DESIGN_RESEARCH.md 3d); a juggled fighter
techs on landing unless the hit was a hard knockdown.

---

## 3. Defense: block, parry, guard resource, throws

### 3a. Block
- **Hold back** to block (stand = highs/mids, crouch-back = mids/lows), SF6 standard [S]. MK1 instead uses a dedicated
  block button with 0-frame startup and a 2-frame "flawless block" (https://wiki.supercombo.gg/w/Mortal_Kombat_1/Defense)
  [S]; Tekken blocks by holding back too (https://wavu.wiki/t/Controls) [S].
- HIT PARADE [R]: hold-back on CLASSIC and SIMPLE (the fight plane makes "back" unambiguous; on touch the left thumb
  holds the stick away, and SF4 Champion Edition mobile also kept a virtual pad for directions - section 5c). An optional
  "GUARD" button (MK-mobile style) exists on the SWIPE touch scheme only.
- Chip [R]: none from normals; specials/supers chip 25% only during STAGE FRIGHT (SF6 burnout rule [S]). MK1 chips a
  minimum 3 damage (0.3%) on everything (MK1 Defense) [S]; Tekken 8 chips 20% in Heat (https://wavu.wiki/t/Recoverable_health) [S]
  - rejected: chip on normals rewards mashing into block.

### 3b. Parry and IMPACT (the SF6 Drive pair)
Regular parry (SF6 [S], https://wiki.supercombo.gg/w/Street_Fighter_6/Gauges):
- Hold PARRY: parries all strikes and projectiles **from any direction starting on frame 1**, active 12 frames and
  extended while held; the result has the same frame advantage as blocking; 33 frames of recovery after release (can
  block, cannot act); throws (incl. command grabs) beat it as unescapable punish counters.
Perfect parry: first **2** frames in SF6 -> **3** in HIT PARADE [R] (one tick of rAF/input jitter; identical window
for every control type so online stays fair). Effects kept from SF6 [S]: zoomed **60-frame screen freeze**, the opponent
cannot cancel, the defender is fully invulnerable for 6 frames after the freeze, any held button is buffered, punish x0.5
damage. Vs projectiles: no freeze, 11-frame recovery, throw-invulnerable (SF6) [S].
IMPACT: 26f startup, **2 hits of armor**, -3 on block, massive pushback midscreen, **wall splat** near the corner on hit
or block, crumple if it absorbs a hit or punish-counters; beaten by throws, armor-break (supers, shove) and
counter-IMPACT (which lands as a punish counter); two IMPACTs on the same frame **clash and both refund** their bar
(SF6) [S]. Armor damage becomes grey HP and can KO (SF6) [S].

### 3c. Throws and throw tech

| Item | SF6 [S] | Tekken 8 [S] | VF5 | MK1 [S] | HIT PARADE [R] |
|---|---|---|---|---|---|
| Startup | 5 (all 31 rows) [M] | 12 (generic 1+3 / 2+4, 35 dmg) [M] | 12 (was 8 in VF4) (https://en.wikipedia.org/wiki/Virtua_Fighter_5) [S] | throw button or 1+3 | **5** |
| Range | 0.80 u median, 0.80-1.02 (Zangief 1.02) [M] | homing variants f+1+3 | - | - | **0.60 m** (grappler 0.77 m) |
| Tech window | until the **9th frame** of being thrown (https://wiki.supercombo.gg/w/Street_Fighter_6/Defense) | **20 frames**, 14 on counter hit; must press the matching 1 / 2 / 1+2 (https://wavu.wiki/t/Throw) | 20 frames (search summary of virtuafighter.com wiki; page returned 403) | press 1/3 vs back throw, 2/4 vs forward throw | **9 frames**, universal throw input |
| Damage | 1200 median [M] | 35 of 180 HP (19%) | - | back throw 11% | **1200** (12%) |
| Throw vs strike same frame | strike wins | - | clash system: a throw can cancel an attack (VF5, Wikipedia) | - | strike wins |
| Unthrowable | hitstun, blockstun +2f after, wakeup +1f, prejump, back dash frames 1-15 | - | - | - | same as SF6 |
| Untechable | throws landing in recovery (punish); throws during rush movement | on armored moves / back | 0-frame throws after an evade | - | same as SF6 |
| Anti option-select | tech fails if the input would have produced a special | - | - | - | same |

Why 9 frames and not Tekken's 20: in 2D Street Fighter the tech is a **prediction** (9 frames is under the ~13-14 frame
human simple reaction time recorded in DESIGN_RESEARCH.md section 5/9), and the strike/throw/shimmy guess is the core
mind game (Infil "Shimmy", "Tick Throw" - https://glossary.infil.net) [S]; Tekken's reactable break exists because a 3D
game's guard breakers are reactable by design ("throws in Tekken are breakable on reaction", wavu Throw) [S].
HUD [R]: SF6 shows "Throw Escape" on the side of whoever teched last (SF6 Defense) [S]; keep it - it teaches timing.

### 3d. Reversals and wakeup
- Wakeup: normal rise or back rise (hold 2 buttons) with identical knockdown advantage; hard knockdowns (punish-counter
  throws) forbid back rise (SF6 Defense) [S].
- Invincible reversals [R]: meterless DPs are air-invulnerable only; full invulnerability costs NERVE (EX, 2 bars) or
  SHOWTIME (supers) - SF6's rule "Only OD Special Moves and Supers can have true invincibility on startup" (SF6 Defense) [S].

---

## 4. Input: buffer, motion parsing, leniency, CLASSIC vs SIMPLE

### 4a. Buffers

| Buffer | SF6 [S] | Tekken 8 [S] | Smash (context) | HIT PARADE [R] |
|---|---|---|---|---|
| Normal / link | any move up to **4 frames early** (5-frame window) (SF6 Game Data) | **8 frames** (9-frame window) (https://wavu.wiki/t/Input_buffer) | Ultimate 9f + hold-to-buffer; buffered moves can fire after the situation changed (https://www.ssbwiki.com/Buffer) | **4 frames early** CLASSIC; **7 frames early** SIMPLE (offline and online; it only widens the player's own timing) |
| Dash | 7 early (8 window) | - | - | 7 early |
| Wakeup reversal | Game Data page: 7 early (8 window); Defense page: 10 on wakeup, 4 after hit/blockstun (11 / 5 windows) - the two SuperCombo pages disagree | - | - | 10 early on wakeup, 4 after hit/blockstun |
| Screen freeze (perfect parry, super flash) | hold a button to auto-buffer; the most recent input wins; releasing cancels | - | - | same |
| During hitstop | cancels input during hitstop are kept | - | - | kept; hitstop frames do not age the buffer |
| Negative edge | releasing a held button counts as a press for specials (Infil "Negative Edge") | - | - | on, specials and supers only |

### 4b. Motion input parsing
Windows = maximum frames from the first direction to the button press.

| Motion | SF6 measured (Loic "WydD" Petit via https://www.eventhubs.com/news/2023/jun/17/sf6-input-trouble-breakdown/) [S] | HIT PARADE [R] |
|---|---|---|
| Quarter circle (236 / 214) | **11** frames ("1-3 frames more strict" than SFV across the board) | 11 |
| Dragon punch (623) | not given in the article | 11; accept **323** and **6236** shortcuts (Infil "Shortcut": "A common shortcut ... for the 623 is 323") [S] |
| Half circle (41236) | **12** (SFV 8) | 12 |
| 360 / SPD | **32** (SFV 25) | 32; any 3 of the 4 cardinals + button, jump frames ignored for the input (grappler kit) |
| Double quarter circle (236236) | not given | 20 |
| Charge ([4]6, [2]8) | Guile: **45f** charge, kept **10-12f** after release (up to 13-15f for some) (https://wiki.supercombo.gg/w/Street_Fighter_6/Guile); "Charge Keep ... usually 10 or 12 frames" (SF6 Game Data) | 45f, keep 10f; charge persists through blockstun/hitstun and dashes (SF6 practice) |
| Dash (66 / 44) | first tap held <= 8f, neutral gap <= 8f (fastest 3f, slowest 17f total) (SF6 Movement) | same |

Priority when one input matches several moves (SF6 order from the EventHubs article) [S]: EX specials > supers > DP
motions > quarter circles > half circles > other specials > normals. HIT PARADE adds [R]: throw (L+M) and parry are
checked before normals; IMPACT (both heavies) before specials (SF6: "Drive moves take priority over special moves (but not
Super Arts)", SF6 Gauges) [S].
SOCD on keyboards/leverless: **left+right = neutral, up+down = neutral** (Tekken's rule: opposite directions "cancel each
other out", https://wavu.wiki/t/Controls) [S].

### 4c. CLASSIC vs SIMPLE (SF6 Classic vs Modern)
SF6 Modern (https://wiki.supercombo.gg/w/Street_Fighter_6/Controls) [S]:
- Buttons: L, M, H (no punch/kick split), **Special (SP)**, **Assist**, plus dedicated Parry and Impact; throw = L+M.
- SP + direction (neutral, forward, down, back) = one-button specials; down-back / down / down-forward + SP select
  strengths of the down-SP move; **H+SP = super**, SA1 on neutral/forward, SA2 on back, SA3 on down.
- Holding Assist changes L/M/H and runs **assist combos** by repeated taps; Assist + SP + direction = EX version.
- **One-button specials/supers take 20% less damage**; that is the only penalty - assist combos, including the
  specials/supers inside them, have **no** penalty; one-button moves are genuinely faster from neutral because they skip
  the motion frames.
Tekken 8's equivalent is **Special Style** (toggle with L1 mid-match; one button per recommended move/combo; low damage)
(https://wavu.wiki/t/Special_Style, https://tk8.tekken-official.jp/en/battle/basic_operations.php) [S]. Infil: auto combos
"come with benefits and drawbacks just like any other game system" (https://glossary.infil.net, "Auto Combo") [S].

HIT PARADE [R]:

| | CLASSIC | SIMPLE |
|---|---|---|
| Attack buttons | LP MP HP LK MK HK | L M H |
| Specials | motion inputs (4b) | SP + neutral/forward/down/back; motions still work on L/M/H |
| Supers | 236236 + P/K etc. | H+SP (+ neutral/back/down for Lv1/2/3) |
| EX (2 NERVE) | motion + 2 buttons of a type | ASSIST + SP + direction |
| Assist combos | none | hold ASSIST + tap L/M/H (3 per fighter: poke confirm, anti-air, big punish) |
| Throw / Parry / Impact | LP+LK / MP+MK / HP+HK (+ macro keys) | L+M / PARRY / IMPACT dedicated |
| Damage | 100% | one-button specials/supers x0.8; everything else 100% |
| Timing windows (parry, tech, links) | identical | identical (buffer 7 vs 4 early is the only difference) |
| Online | matchmaking shows each player's control icon | same |

---

## 5. Control scheme recommendation

### 5a. Keyboard (PC)
SF6's default keyboard layout (search summary: https://outsidergaming.com/street-fighter-6-keyboard-controls/): WASD for
directions, **U I O** = light/medium/heavy punch, **J K L** = light/medium/heavy kick. Tekken notes that on keyboards
"directional inputs are handled by push buttons" and treats keyboard like a hitbox (https://wavu.wiki/t/Controls) [S].

| Action | CLASSIC P1 [R] | SIMPLE P1 [R] | P2 on the same keyboard [R] |
|---|---|---|---|
| Up / left / down / right | W A S D (Space = up too) | same | arrow keys |
| LP / MP / HP | U / I / O | - | numpad 4 / 5 / 6 |
| LK / MK / HK | J / K / L | - | numpad 1 / 2 / 3 |
| L / M / H | - | J / K / L | numpad 1 / 2 / 3 |
| SPECIAL | - | I | numpad 5 |
| ASSIST (hold) | - | U | numpad 4 |
| THROW macro | H | H (= L+M) | numpad 0 |
| PARRY | ; (= MP+MK) | O | numpad 6 |
| IMPACT | P (= HP+HK) | P | numpad + |
| Pause / menu | Esc | Esc | - |

Notes: SOCD cleaning per 4b. All keys remappable (the dyefield key-remap capture is reused per TECH_REUSE.md). Two players
on one keyboard can hit key-rollover limits on cheap keyboards [R, not measured]; the menu should suggest a gamepad for P2.

### 5b. Gamepad (Standard mapping, `navigator.getGamepads`)
[R] - the conventional six-button pad split (punches on the top row, kicks on the bottom row), not a claim about SF6's
exact default:

| Button | CLASSIC | SIMPLE |
|---|---|---|
| X / Square | LP | L |
| Y / Triangle | MP | M |
| RB / R1 | HP | H |
| A / Cross | LK | SPECIAL |
| B / Circle | MK | ASSIST (hold) |
| RT / R2 | HK | IMPACT |
| LB / L1 | PARRY | PARRY |
| LT / L2 | IMPACT | THROW (L+M) |
| D-pad and left stick | move (stick uses 8-way sectors, 30% dead zone) | same |

### 5c. Touch (mobile)
Evidence:
- **SF4 Champion Edition** (mobile): virtual pad left + action buttons right, an **SP button** that fires specials with
  a single touch, adjustable position/size/transparency, virtual buttons vanish when a controller connects (search
  summaries: https://toucharcade.com/2017/07/12/street-fighter-iv-champion-edition-review/,
  https://en.androidayuda.com/games/recomendados/street-fighter-iv-champion-edition-game/).
- **Marvel Contest of Champions**: tap = light, swipe = medium, two-finger hold right = heavy, two-finger hold left =
  block, swipe left side = dodge (search summary: https://www.supercheats.com/marvel-contest-of-champions/walkthrough/controls).
  Design reading (fetched: https://lawofgamedesign.com/2014/12/19/theory-marvel-contest-of-champions-and-2d-fighting-with-few-controls/):
  movement is only toward/away, no jump or sidestep, yet the attack/block/throw triangle and space control survive.
- **Mortal Kombat mobile**: tap to attack, hold two fingers to block, swipes for specials (search summary:
  https://primagames.com/tips/tips-mortal-kombat-x-mobile-iphone-and-ipad).
- **Tekken Mobile** (2018-2019): tap right side = attack, tap left = block, hold left = block-breaking attack; it was
  shut down on 2019-02-15 (search summary: https://en.wikipedia.org/wiki/Tekken_Mobile).
- **Brawlhalla mobile**: stick left; light, heavy, signature and jump buttons right; full layout customization (search
  summary: https://news.ubisoft.com/en-us/article/1kyM6xMlvLXtYa0un5XpKN/brawlhalla-now-available-on-mobile).
- **Street Fighter: Duel** is an idle/team RPG with auto-battle (search summary:
  https://gameinformer.com/2023/01/31/street-fighter-duel-is-a-free-to-play-mobile-rpg-arriving-in-february) - not a
  versus-controls reference.
- Target sizes from DESIGN_RESEARCH.md section 10 (Apple 44 pt, Material 48 dp); the dyefield touch engine
  (floating stick, multi-touch, 44 px floor, haptics) is reused per TECH_REUSE.md.

HIT PARADE touch [R] (landscape only):
- **Default = SIMPLE "PAD"**: left 45% = floating stick (8-way, 60 dp radius, 15% dead zone, up-sector 60 degrees wide
  so jumps need intent); hold away from the opponent = block, down-away = crouch block.
- Right cluster (dp): **L 72, M 72, H 72, SP 84** in an arc; **PARRY 64** above; **IMPACT 60** and **THROW 60** as
  macro buttons; SUPER lights up on SP when a bar is ready (H+SP macro button 64 dp appears); ASSIST as a toggle chip
  (tap to latch assist mode for 1 s) because holding a modifier plus tapping is awkward on glass.
- All buttons movable/resizable/transparent (SF4 CE, Brawlhalla precedent); press stays alive when the thumb slides.
- **Optional "SWIPE" scheme** (MCoC/MK-mobile style, offline and casual online only): tap right = L, swipe right-toward =
  M, two-finger tap right = H, swipe up on right = SP, two-finger hold left = GUARD, swipe back on left = back dash,
  swipe forward on left = dash. No jump button in SWIPE (MCoC precedent), jump via swipe up on the left.
- CLASSIC on touch is allowed (motions on the stick) but not default.
- Online: touch players get no timing advantages; the control icon is shown in the lobby.

---

## 6. 2.5D plane vs full 3D - recommendation: **2.5D plane**

| Factor | 2.5D plane (SF6) | Full 3D (Tekken / VF) | Evidence |
|---|---|---|---|
| Proven modern template | SF6 is 3D models on a 2D plane, with rollback and crossplay | Tekken 8 (Unreal Engine 5, Heat system); its netcode was not verified in the pages read | Wikipedia SF6 ("2.5D", "rollback netcode") [S]; Wikipedia Tekken 8 [S] |
| Core movement verbs | walk, dash, jump, crouch | + sidestep and sidewalk, "the defining factor in it being a 3D fighting game" | https://wavu.wiki/t/Sidestep [S] |
| Per-move data burden | startup/active/recovery/hitbox | + tracking left/right and homing flags for every move (wavu's Move table has `tracksLeft` / `tracksRight` fields) | https://wavu.wiki/t/Tracking [S]; Cargo field list [M] |
| Timing subtlety | 5-frame buttons, links | a step "doesn't start until releasing the direction"; up can be held 8f before it becomes a jump; most moves are stepped by about 8-12 frames of step; step attacks start no earlier than the 10th step frame | wavu Sidestep [S] |
| Throws | 5f, predictive tech | reactable 20f break with 3 break buttons | section 3c [S] |
| Mobile touch | 8-way stick + buttons works (SF4 CE, Brawlhalla) | mobile ports stripped it: MCoC has no sidestep or jump; Tekken Mobile became tap-to-attack | section 5c [S] |
| Camera | fixed side axis; zoom by separation | must orbit to keep the line between fighters perpendicular to the view, needs occlusion handling | [R] |
| Rollback cost | state = x, y, facing sign per fighter | + z, yaw, per-move tracking resolution; more state to save/hash per frame | GGPO requires a deterministic sim and replays mispredicted frames (up to `GGPO_MAX_PREDICTION_FRAMES 8`, https://github.com/pond3r/ggpo/blob/master/src/include/ggponet.h) [S]; cost increase [D qualitative] |
| Owner ask | "think street fighter" | - | BRIEF.md owner direction #2 |

**Recommendation [R]:** 2.5D. Characters, sets and crowds are full 3D; gameplay positions live on one X axis (plus Y for
jumps); facing is a sign flip handled by the sim (cross-ups switch it after the pass). 3D spectacle is carried by
(a) authored super/LAST CALL camera tracks, (b) the KO orbit, (c) wall splats against 3D set walls, (d) the BRAWL BREAK
bonus round in free 3D, where the beat-'em-up lane's third-person rules apply. No sidestep, no 8-way run (SoulCalibur's
8-way run was not researched further this session because the plane decision removes it).

---

## 7. Camera, hitstop presentation, KO slow-mo

### 7a. Conventions [S]
- SF4 (2.5D): the camera breaks from its fixed side position essentially only for Super and Ultra combos (search summary:
  https://streetfighter.fandom.com/wiki/Street_Fighter_IV_series).
- SF6 perfect parry: "a zoomed-in screen freeze" of 60 frames (SF6 Gauges) [S].
- Common 2D-fighter camera: follow the midpoint of the two fighters, pull back with separation, clamp min/max distance
  (search summary: Unity/Phaser forum results for "fighting game camera").
- Smash Ultimate "Special Zoom": on certain decisive hits the background flashes, time slows substantially and the
  camera zooms to the impact; it is nearly disabled with more than two players and never fires in the last 5 seconds of
  a timed match; a "Finish Zoom" marks the match-ending hit; the slowdown factor itself is undocumented
  (https://www.ssbwiki.com/Special_Zoom) [S].

### 7b. HIT PARADE side-on camera numbers [D][R]
From `fg_versus_scale_camera.py` (pinhole model, three.js vertical FOV, 1.8 m fighters, 0.35 m body half-width, 0.9 m edge
margin, 0.45 m headroom):

| Separation s | vFOV 35, 16:9: distance / fighter height fill | vFOV 35, 19.5:9 phone | vFOV 30, 16:9 | vFOV 40, 16:9 |
|---|---|---|---|---|
| 0.8-1.8 m | 4.36 m / 65% | 4.36 m / 65% | 5.13 m / 65% | 3.78 m / 65% |
| 3.0 m | 4.91 m / 58% | 4.36 m / 65% | 5.77 m / 58% | 4.25 m / 58% |
| 4.0 m | 5.80 m / 49% | 4.76 m / 60% | 6.82 m / 49% | 5.02 m / 49% |
| 6.0 m (cap) | 7.58 m / 38% | 6.22 m / 46% | 8.92 m / 38% | 6.57 m / 38% |

- **vFOV 35 degrees** [R]: at s = 3 m an object 0.5 m nearer the camera looks 11% bigger (13% at 40 degrees, 20% at the
  brawl camera's 55 degrees) [D] - flatter perspective keeps the 2D plane readable while still looking 3D.
- Distance = max(vertical floor 4.36 m, horizontal need); clamp 4.36-7.6 m; separation cap 6.0 m (fighters cannot walk
  apart beyond it - the SF "screen edge" wall). Phones get tighter framing automatically (wider aspect).
- Look-at = fighters' midpoint X, Y = 1.0 m; camera height 1.25 m; pitch -2..-4 degrees. Jumps pan the camera UP (keep the
  higher head inside the top 12%), they do not zoom.
- Smoothing: asymmetric (zoom out fast, in slow) as in DESIGN_RESEARCH.md 5c; rotational shake only (Eiserloh, sourced
  there), trauma +0.10 light / +0.2 heavy / +0.35 IMPACT or punish counter / +0.5 KO; zero shake during a perfect-parry
  freeze (the read matters more).
- Cinematics (authored per super): 45-180 frames, cut-based, 3D orbits allowed, timer frozen. Not skippable in matches:
  both online clients must play them for the same deterministic number of frames; a "short cinematics" setting may only
  change camera shots, never the frame count.

### 7c. KO sequence [R]
1. KO hit: hitstop 30 frames, flash, host caption "K.O."/show-specific word.
2. Slow-mo: world time x0.25 for 45 real frames (sim time advances ~11 frames), camera orbits 25 degrees toward the loser.
3. Final round of the match: add the Finish-Zoom look (background flash + impact lines) and hold 60 frames on the winner.
The KO slow-mo is presentation only: the round result is decided at the KO frame, so rollback never has to re-run it.

---

## 8. Roster archetype matrix (10 fighters + mini boss + boss)

### 8a. Archetype definitions (Infil glossary, https://glossary.infil.net) [S]
- **Shoto / all-rounder**: fireball, DP, rush kick; solid neutral with fireballs, anti-air on jumps. "All-rounder" = a
  little of everything, competent from most ranges.
- **Rushdown**: get close and keep attacking; tools to get around long-range attacks, tricky approaches, many mixups.
- **Grappler**: throws and command throws; moves and jumps slowly, weak at range, terrifying up close.
- **Zoner**: attacks from long range (projectiles or long normals), strong backward movement; not helpless up close.
- **Charge character**: specials by holding a direction; must find moments to sit still and build charge.
- **Stance**: a mode that changes available attacks or movement (common in 3D fighters).
- **Big body**: tall, wide hurtbox; slow but strong close; bigger hurtbox lets some combos/attacks connect, weak to
  pressure.
- **Zoning**, **footsies**, **okizeme**, **vortex** definitions from the same glossary inform the remaining three
  archetypes (aerial mobility, setplay, counter/footsies).

### 8b. How the shipped games spread their stats (balance levers) [M][S]

| Lever | SF6 roster spread [M] | Who sits at the extremes [M] | Other games [S] |
|---|---|---|---|
| HP | 9000..11000 | Akuma 9000 (glass cannon); Zangief 11000 (grappler); 10500 = Alex, Arjun, E. Honda, Marisa (big bodies) | SF4 850 (Akuma) .. 1150 (Rufus), boss Seth 750; MK1 900..1100 |
| Forward walk | 0.028..0.0561 u/f (x0.60..x1.19 of median 0.047) | slowest Dhalsim 0.028 (zoner), JP 0.037, Zangief 0.0364; fastest Kimberly SA3 0.0561, Cammy/Kimberly 0.0505 | - |
| Back walk | 0.025..0.0366 | slowest Dhalsim, E. Honda, JP, Zangief 0.025 | - |
| Forward dash | 1.00..1.90 u | shortest Alex 1.00, Zangief 1.007; longest Juri 1.903 (rushdown) | - |
| Throw range | 0.80..1.02 u | Zangief 1.02; Blanka, E. Honda, Marisa 0.9 | - |
| Throw hurtbox | 0.33..0.49 u | wider on big bodies ("A wider throw hurtbox makes a character more susceptible to throw loops", SF6 Offense [S]) | - |

Principles [R]: trade mobility for HP and damage; trade range for damage (Screw Piledriver's weak version reaches further
[M]); every plan A has a readable counter (doctrine "a special move is a contract with counters on BOTH sides"); the HP
bar is drawn at the same length for everyone (SF4 notes bars are one fixed length regardless of HP [S]), so show real HP
numbers in TRAINING.

### 8c. HIT PARADE roster (working names - the characters lane owns final names, bodies and looks) [R]
Baseline all-rounder numbers: HP 10,000; walk 2.12 / 1.44 m/s; dash 1.06 / 0.68 m; throw 0.60 m; jump 45f.
SIMPLE mapping convention: 5SP = main special, 6SP = approach, 2SP = anti-air or down special, 4SP = defensive/trick;
H+SP = supers (5/6 = Lv1, 4 = Lv2, 2 = Lv3), as SF6 Modern [S].

| # | Fighter (TV persona) | Archetype | HP | Walk f / b (m/s) | Dash f / b (m) | Throw (m) | Signature specials (template class, key numbers) | Supers (Lv1 / Lv2 / Lv3) | Weakness (the counter) | Difficulty |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **REX "THE HEADLINER" CALLOWAY** - ex-champ boxer, the show's poster boy | Shoto all-rounder | 10,000 | 2.12 / 1.44 | 1.06 / 0.68 | 0.60 | BRICKBAT (thrown brick projectile, 16/14/12f); SHOWSTOPPER UPPER (DP 5/6/7f, air-inv 1-14/1-9/1-8); HEADLINE HOOK (rush, 10/12/14f, -4/-6/-12); one 4f jab (links) | Lv1 invulnerable uppercut rush; Lv2 brick barrage; Lv3 "Main Event" cinematic | jack of all trades; lower corner damage than specialists | 1 |
| 2 | **DANI "RED LIGHT" KROSS** - kickboxer, stage-crew brawler | Rushdown | 9,500 | 2.28 / 1.49 | 1.43 / 0.84 | 0.60 | CUE SLIDE (low rush 12f, -6); STAGE DIVE (overhead hop 20f, +1); flip kick DP-lite (7f, not invulnerable; EX invulnerable); RUSH costs 2.5 bars instead of 3 | Lv1 kick flurry; Lv2 install "ON AIR" (+walk speed, specials chain, 8 s); Lv3 cinematic | no fireball, weak anti-air, lowest-HP brawler | 2 |
| 3 | **OTTO "THE MOUNTAIN" BRUHN** - wrestling-show relic | Grappler | 11,000 | 1.64 / 1.13 | 0.76 / 0.54 | 0.77 | BODY SLAM (360 command grab, 5f, L 1.22 m/2500 .. H 0.92 m/3300); LARIAT (anti-air + projectile-invulnerable spin); armored step (1 hit armor, 18f) | Lv1 running grab; Lv2 air grab (anti-air super); Lv3 "Finishing Move" grab cinematic | slowest walk, shortest dash, zoned out; big hurtbox | 3 |
| 4 | **STORMY "THE FORECAST" VANCE** - the network's weather girl | Zoner | 9,500 | 1.26 / 1.13 | 1.10 / 0.75 | 0.60 | COLD FRONT (straight projectile), HAIL (arcing, anti-jump), UMBRELLA POKE (longest medium, 1.4 m); teleport-lite "SCENE CHANGE" 4SP (40f, punishable) | Lv1 lightning column; Lv2 storm field (projectiles speed up 6 s); Lv3 cinematic | slowest walk; up close her only escape is EX or Lv1 | 2 |
| 5 | **SGT. HAL "RIOT" MERCER** - riot cop turned contestant | Charge (hold back/down 45f) | 10,000 | 1.94 / 1.44 | 1.18 / 0.56 | 0.60 | SHIELD TOSS ([4]6P, 10f, -3); BATON FLIP ([2]8K anti-air, 5/6/7f, air-inv); SHIELD RUSH ([4]6K, armor on H) | Lv1 charge-less shield bash (reversal); Lv2 tear gas zone; Lv3 cinematic | charge makes him predictable; weak when forced to walk forward | 2 |
| 6 | **VIVIENNE "HIGH ROLLER" LACROIX** - card sharp dealer | Stance + trickster | 9,500 | 2.12 / 1.44 | 1.30 / 0.80 | 0.60 | HOLD 'EM stance (from 214K; 3 follow-ups: low, overhead, throw-invulnerable hop); card fan (short projectile 0.9 m range cap); fake-out cancel (1 NERVE bar) | Lv1 card cyclone; Lv2 "ALL IN" (next hit unblockable if it lands within 3 s, cancelled if she is hit); Lv3 cinematic | stance has readable tells; low HP; weak defense without meter | 3 |
| 7 | **GUS "PRIME CUT" MOREAU** - butcher-shop bruiser from the BUTCHER BLOCK set | Big body / armored striker | 10,500 | 1.80 / 1.20 | 0.95 / 0.60 | 0.68 | MEAT HOOK (slow 2-hit armored heavy, 22f, wall splat in corner); CHOP (overhead 20f, +2); HAM SLAM (ground bounce launcher) | Lv1 armored charge; Lv2 hook pull (brings opponent in from 3 m); Lv3 cinematic | big hurtbox, slow buttons; armor loses to throws and multi-hits | 1 |
| 8 | **KIT "STUNT DOUBLE" CASSIDY** - stunt performer | Aerial mobility | 9,500 | 2.20 / 1.50 | 1.20 / 0.90 | 0.60 | WIRE JUMP (high jump 6+40+3, like SF6 Viper's high jump [M]); DIVE KICK (air, 10f, +2 on block if deep); WALL RUN (bounce off stage walls within 1.5 m) | Lv1 air super; Lv2 "STUNT CAR" crossing rush; Lv3 cinematic | anti-air gets full punishes; landing recovery on the dive | 3 |
| 9 | **JUNO "BOOM" PARK** - pyrotechnics tech for the show | Setplay / traps | 10,000 | 2.00 / 1.40 | 1.00 / 0.75 | 0.60 | CHARGE PLANT (place 1 of 2 timed charges, fuses 60 / 120f, cannot be moved); SPARKLER (short projectile); DETONATE (4SP: sets off charges early, 1 NERVE bar) | Lv1 flare burst; Lv2 fireworks rain (area); Lv3 cinematic | slow setup; charges can be parried/destroyed by any hit; weak without her traps | 3 |
| 10 | **EZRA "SLOW BURN" KADE** - ex cage fighter, counter-puncher | Counter / footsies | 10,000 | 2.05 / 1.50 | 1.00 / 0.80 | 0.60 | COUNTER STANCE (4SP: catches strikes frames 4-20, 30f whiff recovery, loses to throws/projectiles); longest pokes (+15% reach on mediums); low-risk sweep (-7) | Lv1 counter super; Lv2 install "SLOW BURN" (punish counters +2 f bonus, 10 s); Lv3 cinematic | few ways in; counters lose to throws and delays; needs reads | 2 |
| MB | **THE ENFORCER** - the network's security chief (mini boss, bout 7) | Armored grappler-striker hybrid | 11,500 | 1.80 / 1.20 | 0.90 / 0.60 | 0.70 | 2-hit armor on heavies; baton rush; command grab; taser projectile | Lv1-Lv3 like any fighter + one "SECURITY SWEEP" super armor dash | armor loses to throws and IMPACT-break; honest AI (section 10) | - |
| B | **RICKY MARQUEE** - the host (final boss, bout 8; unlocks as playable) | Stance/zoner hybrid with two phases | 13,000 | 2.12 / 1.44 | 1.20 / 0.80 | 0.60 | mic-cane pokes; spotlight projectile; "COMMERCIAL BREAK" parry-counter; phase 2 at 50% HP adds a second projectile type and a Lv3 that uses the arena | phase 2 unlocks "SEASON FINALE" | two readable phases; same frame rules as players | - |

Balance notes [R]: the HP spread (9,500-11,000) and walk spread (1.26-2.28 m/s = x0.59..x1.08 of baseline) sit inside SF6's
measured spreads (HP +-10%, walk x0.60..x1.19) [M]. Damage leaders (grappler's 3300 grab, big body armor hits) pay with the
slowest movement. The ENFORCER and RICKY unlock for VERSUS after an arcade clear (Tekken 1 unlocked the sub-boss after the
ending, https://tekken.fandom.com/wiki/Arcade_Mode [S]); locked out of ranked until tuned.

---

## 9. Arcade ladder ("THE SEASON")

### 9a. What the reference ladders do [S]

| Game | Structure | Source |
|---|---|---|
| SFII World Warrior | 7 other playable fighters, then 4 CPU-only "Grand Masters" (Balrog, Vega, Sagat, M. Bison last) = 11 bouts; bonus stage after every third match (car, barrels, oil drums); car stage 40 s | https://en.wikipedia.org/wiki/Street_Fighter_II ; https://streetfighter.fandom.com/wiki/Bonus_Stage |
| Street Fighter Alpha 3 | rivals at stage 5 and stage 9, sub-bosses then final boss | https://streetfighter.fandom.com/wiki/Rival |
| Street Fighter III: 3rd Strike | rival at stage 9 before Gill; car + parry bonus stages | streetfighter.fandom Rival / Arcade Mode |
| Street Fighter IV | 6 random opponents -> rival -> Seth = 8 bouts; bonus stages from Super SFIV on | https://streetfighter.fandom.com/wiki/Arcade_Mode |
| Street Fighter V Arcade Edition | 6 ladders themed on past games; SFII and SFV ladders put a bonus stage after the 4th / 5th opponent | same |
| Street Fighter 6 | choose **5 or 12** stages; rival cutscene + **rival on the final stage**; bonus stages: semi-truck (30 s) in both, basketball **parry** challenge only in 12; bonus stages can be disabled; separate 5- and 12-stage leaderboards | same + Bonus Stage page |
| Tekken (1994) | 9 stages: 7 random, stage 8 = character's sub-boss, stage 9 = Heihachi; clearing unlocks the sub-boss | https://tekken.fandom.com/wiki/Arcade_Mode |
| Tekken 2 | 10 stages: 7 random, sub-boss, Kazuya, Devil | same |

### 9b. HIT PARADE [R]
**FULL SEASON (8 episodes, ~15-20 min)**

| Slot | Bout | CPU level (on Normal) | Notes |
|---|---|---|---|
| Ep 1 | random roster fighter | L2 | teaching fight: the host explains one mechanic per episode on first playthrough |
| Ep 2 | random | L3 | |
| Ep 3 | random | L3 | |
| BRAWL BREAK 1 | beat-'em-up crowd round, 45 s, score only | - | SFII bonus-every-3rd-match pattern; SF6 truck 30 s; rules owned by DESIGN_RESEARCH.md |
| Ep 4 | random | L4 | |
| Ep 5 | **RIVAL** (fixed per fighter, cutscene + banter) | L5 | SF Alpha 3 rival at stage 5 |
| Ep 6 | random | L5 | |
| BRAWL BREAK 2 | "HECKLER TOSS": parry objects thrown from the crowd, perfect parries score double | - | SF3 / SF6 parry bonus stage |
| Ep 7 | **MINI BOSS - THE ENFORCER** | L6 + boss kit | Tekken sub-boss slot |
| Ep 8 | **BOSS - RICKY MARQUEE** (two phases; a continue restarts the whole boss bout) | L6 + boss kit | per-fighter ending |

**PILOT (5 episodes, ~8-10 min)**: Ep 1-3 random (L2, L3, L4), BRAWL BREAK after Ep 2, Ep 4 MINI BOSS, Ep 5 BOSS.
- Difficulty setting shifts the whole ladder: Easy -2 levels, Hard +2 (cap 8).
- Continues: unlimited, but a continue resets the episode's RATINGS; score leaderboards per ladder length (SF6 keeps
  separate 5/12 boards [S]).
- Episode = best of 3 rounds. The boss bout is best of 3; phase 2 triggers the first time his HP drops below 50% in any
  round and stays on for the rest of the bout (his HP still resets each round).
- Rival pairs (5 pairs): Headliner-Slow Burn, Red Light-Stunt Double, Mountain-Prime Cut, Forecast-Boom, Riot-High Roller.

---

## 10. CPU difficulty levers

Evidence [S]:
- Killer Instinct's Shadow AI (https://www.gamedeveloper.com/programming/the-killer-groove-the-shadow-ai-of-killer-instinct):
  humans respond in "around 12-19 frames" at 60 fps and the shadow aims for that, not perfect reactions; case-based
  reasoning with 400-700 patterns per match, over 40 similarity metrics; it sometimes picks a lower-ranked action to
  stay unpredictable. GDC 2016 talk "Designing AI for Competitive Games" by the same team
  (https://gdcvault.com/play/1023291/Designing-AI-for-Competitive, search summary).
- Sonic Hurricane, "Thoughts on Fighting Game AI" (https://sonichurricane.com/?p=2452): CPUs feel cheap when they swap
  anticipation for machine reaction speed (e.g. SF4 Seth's reactionary grab/uppercut mixup); static AIs are either
  unbeatable or exploitable forever; recommends meaningful low difficulties (KOF2002 cited as an example of fair-feeling
  AI tools).
- SF6 CPU goes to level 8 in Versus; players and pros report level 8 reacts at inhuman speed / reads inputs (search
  summaries: https://www.eventhubs.com/news/2023/apr/22/hifight-level8-cpu-handicap-sf6/,
  https://steamcommunity.com/app/1364780/discussions/0/603031621173612746/). SF6 arcade lets you pick difficulty
  (search summary of streetfighter.fandom Arcade Mode results).
- Doctrine section 2 AI honesty rules (reaction delay 300-800 ms, latch one reaction roll per incoming attack, commit
  while swinging) - quoted in section 12.

HIT PARADE levers [R] (level 0 = TUTOR band, teaches; 1-8 = versus/arcade):

| Lever | L0 tutor | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 |
|---|---|---|---|---|---|---|---|---|---|
| Reaction delay to a VISIBLE startup (frames) | 60 | 48 | 42 | 36 | 32 | 28 | 24 | 21 | **18** (= 300 ms, doctrine floor; inside the human 12-19f band) |
| Block chance once reacted | 0.6 (demonstrates) | 0.10 | 0.25 | 0.40 | 0.55 | 0.65 | 0.75 | 0.85 | 0.90 |
| Guess weights on unreactable mixups (startup < reaction delay) | 50/50 | 50/50 | 50/50 | 50/50 | adapts +10% to the player's last 3 choices | +15% | +20% | +25% | +30% (never 100%) |
| Anti-air a jump-in | 0.1 | 0.05 | 0.15 | 0.30 | 0.45 | 0.60 | 0.70 | 0.80 | 0.85 |
| Punish a move <= -5 on block | 0 | 0.05 | 0.15 | 0.30 | 0.45 | 0.60 | 0.75 | 0.85 | 0.90 |
| Punish route | jab | single hit | 2 hits | chain -> special | bread-and-butter | B&B + meter | best meterless | best + meter | best + corner route |
| Throw tech rate (a guess) | 0 | 0 | 0.10 | 0.20 | 0.30 | 0.40 | 0.45 | 0.50 | 0.55 |
| Parry use | never | never | never | rare | projectiles only | + slow strikes | + perfect parry attempts (same reaction limit) | + parry-rush | + baits |
| Meter use | never | never | EX only | Lv1 | Lv1/2 | all | all + cancel supers | all | all |
| NERVE management | none | none | none | avoids STAGE FRIGHT | + punishes burnout | + IMPACT on reads | + counter-IMPACT on reaction (26f startup is reactable) | same | same |
| Execution drop rate | 0.5 | 0.4 | 0.3 | 0.2 | 0.15 | 0.1 | 0.05 | 0.02 | 0 |
| Aggression (attack vs wait) | 0.2 | 0.3 | 0.35 | 0.4 | 0.45 | 0.5 | 0.55 | 0.6 | adapts |
| Input reading | never at any level | | | | | | | | |

Rules [R]: the CPU sees only sim state the player could see (startup animation begins -> reaction clock starts);
one reaction roll per incoming attack, latched (doctrine); bosses get **tools** (armor, extra HP, phases), never
faster reactions than L8. Persona acceptance tests (section 12) must show the boss sometimes beating the "good player"
persona and L1 losing to the novice persona most of the time.

---

## 11. Top 10 feel techniques (with numbers)

1. **Hitstop by strength** - 9 / 11 / 13 / 15 / 25 frames (light / medium / heavy / special / IMPACT), SF6's measured
   medians [M]; the victim shakes during the freeze, the attacker holds the impact pose (God of War technique, sourced in
   DESIGN_RESEARCH.md 3a). Hitstop is also the cancel/hit-confirm window (SF6 Game Data) [S].
2. **Punish-counter spike** - +4 frames, +20% damage, +4 hitstop on heavies, orange "PUNISH COUNTER" caption and a
   heavier SFX layer (SF6 values [S]); it is what makes blocking-then-punishing feel like the best play.
3. **Perfect-parry freeze** - 60-frame zoomed freeze, punish buffered by holding a button, x0.5 punish damage (SF6 [S]).
   The single most "TV moment" defensive verb; host caption "WHAT A SAVE".
4. **Super cinematics with a frozen clock** - authored 3D camera cuts, timer frozen (SF6 [S]; SF4's camera only leaves
   the side view for supers [S]). Lv3 "PRIME TIME" = crowd pop + ratings spike.
5. **Corner IMPACT wall splat and STAGE FRIGHT stun** - 2-hit armored lunge, wall splat in the corner, 195-frame stun if
   the defender is in burnout (SF6 [S]); comic splatter on the wall (brief non-negotiable 3).
6. **KO slow-mo + finish zoom** - 30f KO hitstop, x0.25 time for 45 frames, 25-degree orbit, finish zoom on the match
   point (Smash Special/Finish Zoom convention [S], numbers [R]).
7. **Tight side camera** - vFOV 35, 4.36-7.6 m, fighters 38-65% of frame height, pan (not zoom) on jumps, fast zoom-out /
   slow zoom-in [D][R]. Keeps both fighters readable on phones.
8. **Pushback and the corner** - light pushback 0.27 m, IMPACT 1.35 m, pushback transfers to the attacker at the wall
   (SF6 [S]); the space war (footsies) is only real if pushback is honest.
9. **Input leniency that stays precise** - 4-frame early buffer, 11f quarter circles, DP shortcuts, negative edge,
   hold-to-buffer in freezes, SIMPLE mode's one-button specials (SF6 [S]); plus identical timing windows online.
10. **Readable throw game** - 5f throws, 9f tech, "THROW ESCAPE" shown on the side of the later input, punish-counter
    throws +70% (SF6 [S]); every strike/throw/shimmy guess is legible to the players and the crowd.

---

## 12. GAME_DOCTRINE section 2 - what binds a versus fighter and what must deliberately differ

Doctrine section 2 (`pipeline/knowledge/GAME_DOCTRINE.md` lines 56-162) was measured on a third-person gladiator duel.

**Deliberate differences**

| Doctrine rule (section 2) | HIT PARADE versus | Why |
|---|---|---|
| "Anchor timing to measured human motion": full swing cycles 1.5-2.5 s, ~one committed attack per ~3 s | Normals total 16-37 frames (0.27-0.62 s); specials up to ~60 frames | Fighting-game readability comes from frame data (startup/recovery), hitstop and spacing, not from slow swings; SF6's roster medians are 16-36 frame normals [M]. What survives: big commitments (DP -29, sweep -11, command grab 54f whiff recovery) must be slow to recover and punishable. |
| "Attacks step INTO the blow" via a lunge toward a target locked at commit, capped ~80% of reach | Authored per-move forward movement only; **no lock-on lunge or magnetism** | On a 2D line the opponent is always ahead; auto-lunge would be auto-aim in PVP and would break spacing (the core of footsies). SF6 stores per-move movement (`moveDist` field) [M]. |
| "Buffer inputs ~0.35 s" | 4 frames early (CLASSIC), 7 (SIMPLE); dash 7; wakeup 10 | SF6 4f / Tekken 8f are the genre standard [S]; a 21-frame buffer would turn links into free inputs and cause stale-input misfires (Smash documents buffered moves firing after the situation changed [S]). |
| "Poise": interrupts only in the early windup, ~1.6 s immunity | Every hit interrupts (hitstun) unless the move has explicit armor (IMPACT 2 hits, big-body specials, boss) | Hitstun is the combo system. Anti-mash comes from frame data (lights -2 on block, chains end), light-starter damage scaling and the NERVE drain on block. |
| "Blocks must PUNISH" via an automatic riposte on matched blocks | Blocking punishes through frame disadvantage (anything <= -5 is punishable), perfect parry, and SHOVE | Automatic ripostes would decide PVP for the players; the principle (defense must create offense) is kept, the mechanism is the genre's. |
| "Telegraph honesty extends to the DODGE" (i-frames honoured during a windup) | No dodge on the 2.5D plane; honesty = **reactability**: overheads >= 18f, IMPACT 26f, supers have a freeze; throws are deliberately unreactable (9f tech) | Throws in 2D fighters are a prediction game (section 3c). |
| "Simultaneous attacks must CLASH" | Normals **trade** (both take a counter hit, SF6 [S]); only IMPACT vs IMPACT and projectile vs projectile clash (SF6 [S]) | Trades are genre-standard and readable; the doctrine's anti-phase-lock concern is moot because the sim is lockstep-deterministic and positions change on every trade. |
| "Cap simultaneous attackers with tokens" | 1v1: not applicable (still applies in BRAWL BREAK) | - |

**Binds as written**
- **View strike frame aligned to the sim** - stronger than ever: under rollback the view must render purely from sim
  state each frame, and clips are authored to the frame-data table (startup frame = impact pose).
- **Make the parry reachable, then prove it** - regular parry is active from frame 1 and holdable (always reachable);
  the 3-frame perfect window must be proven by a scripted optimal player through the real input path (keyboard, pad,
  touch) and through the rollback delay.
- **Guard-break is a STATE that mends at a threshold, and the breaking blow lands** - STAGE FRIGHT ends only when NERVE is
  completely refilled (hysteresis, so it cannot re-fire at its own trigger), and the IMPACT that causes the stun still
  deals damage.
- **AI honesty** - latch one reaction roll per incoming attack; count blows not ticks; commit while mid-swing; reaction
  delay 300-800 ms = 18-48 frames (section 10's L8..L1); no input reading.
- **Every bout ends** - 99-second rounds, max 5 rounds.
- **A timeout verdict must never reward passivity** - strict HP-fraction comparison; arcade exact tie = CPU wins (SFII
  rule [S]).
- **The tutorial opponent is a TEACHER** - CPU level 0 band; TRAINING mode with a dummy that demonstrates each verb.
- **Persona playtests** - headless personas on identical seeds: masher (lights only), turtle (always blocks), jumper
  (jump-in spam), zoner (projectile spam), novice (400 ms delayed inputs), optimal (frame-perfect punishes). Acceptance
  questions: does blocking + punishing beat mashing? does anti-air beat jumping? can the novice beat L1? does the boss
  sometimes beat the optimal persona?
- **A special move is a contract with counters on both sides** - projectile -> jump / parry / IMPACT-armor; DP -> block
  and punish (-23..-39); command grab -> jump / back dash / strike; IMPACT -> throw / counter-IMPACT / armor break;
  counter stance -> throw / delay.
- **Data without a consumer is a lie** - every archetype stat in `fighters.json` (HP, walk, dash, throw range, reach
  bonuses) must be read by the sim and verified numerically by a probe.
- **Final boss that never loses to good play is a ceremony** - boss must beat the optimal persona sometimes and lose to it
  mostly; tools not cheats.
- **Endless mode never ends by referee** - applies to any SURVIVAL mode.
- **Fast closing speeds need sub-tick resolution** - check: projectile speed x 1/60 must stay under the smallest hurtbox
  width (7.5 m/s -> 0.125 m per tick vs ~0.3 m bodies: fine); any faster move gets swept collision.

---

## 13. Sources (read this session unless marked search summary)

SuperCombo wiki (read via `https://wiki.supercombo.gg/api.php`, the HTML pages are behind a bot wall):
- https://wiki.supercombo.gg/w/Street_Fighter_6/Game_Data - frame data conventions, input buffer 4f early, charge keep
  10/12f, hit priority/trades, hurtbox transition, recoverable HP 120f + 2/frame, damage scaling tables and modifiers.
- https://wiki.supercombo.gg/w/Street_Fighter_6/Gauges - Drive gauge (6 bars, costs, regen 40/f, cooldowns), Burnout
  (+4 blockstun, chip ~25%, corner stun, 195f), Drive Impact (2-hit armor, wall splat, clash refund, 1.801 pushback), Parry
  (5000 + 50/f, 12f active, 2f perfect, 33f recovery, 60f freeze, x0.5 punish), Drive Rush (3+8 / 9 startup), Super gauge
  (3 bars, carry-over, gain split 100/50 attacker, 70/25 defender, no whiff gain), timer frozen during supers.
- https://wiki.supercombo.gg/w/Street_Fighter_6/Controls - Classic vs Modern, SP button, Assist combos, 20% penalty rule.
- https://wiki.supercombo.gg/w/Street_Fighter_6/Defense - throw escape until the 9th frame, anti-OS rule, proximity/auto
  guard, wakeup reversal buffer 10 / 4, armor rules.
- https://wiki.supercombo.gg/w/Street_Fighter_6/Offense - trades, strikes beat throws, counter hit +2/+20%, punish counter
  +4/+20%, throw PC +70% + hard knockdown + 1 bar, throw invulnerability windows, throw loops.
- https://wiki.supercombo.gg/w/Street_Fighter_6/Movement - first walk frame 1/4 speed, dash input 8f/8f, prejump 4f,
  landing 3f.
- https://wiki.supercombo.gg/w/Street_Fighter_6/Glossary - juggle count / start / increase / limit.
- https://wiki.supercombo.gg/w/Street_Fighter_6/Guile - 45f charge, 10-15f keep.
- Cargo tables `SF6_FrameData` (2,450 rows) and `SF6_CharacterData` (34 rows) - measured by `fg_sf6_class_stats.py`.
- https://wiki.supercombo.gg/w/Street_Fighter_V/Game_Data - SFV scaling 100/90/.../10, GUTS 95/90/75%, CA 50% minimum.
- https://wiki.supercombo.gg/w/Street_Fighter_IV/Basic_Elements/Life_Meter and .../Timer - SF4 HP table, 99 timer.
- https://wiki.supercombo.gg/w/Mortal_Kombat_1/Game_Data, /Defense, /Offense, /Gauges, /Kontrols - MK1 HP table, block
  button, flawless block 2f, chip 3, throw tech buttons, back throw 11%, Fatal Blow 30% / 9 s, meter 3 bars / first-hit
  bonus, breaker 3 bars.
- https://wiki.supercombo.gg/w/Street_Fighter_II:_World_Warrior - 8-character roster, bonus stages.
wavu.wiki (Tekken, read via `https://wavu.wiki/w/api.php`):
- https://wavu.wiki/t/Throw (i12-14 generic throws, 35 dmg, 20f break / 14f on CH, hands rule), https://wavu.wiki/t/Input_buffer
  (8f), https://wavu.wiki/t/Sidestep (u held <= 8f, d <= 7f, 8-12f of step, SS attacks from frame 10, 42f stance),
  https://wavu.wiki/t/Juggle (70/50/40/30 scaling, x0.8 after wall, one extender), https://wavu.wiki/t/Heat (900F),
  https://wavu.wiki/t/Rage (45 HP season 3, +10%), https://wavu.wiki/t/Recoverable_health (chip 20% in Heat),
  https://wavu.wiki/t/Counter_hit (120%), https://wavu.wiki/t/Controls (SOCD cancel, keyboard = buttons),
  https://wavu.wiki/t/Special_Style, https://wavu.wiki/t/Tracking, https://wavu.wiki/t/Movement.
- Cargo table `Move` (6,591 rows) - measured by `fg_t8_class_stats.py`.
Other wikis:
- https://tekken.fandom.com/wiki/Health (T8 180 -> 200 -> 190; T6 180 vs Azazel 240), https://tekken.fandom.com/wiki/Arcade_Mode
  (Tekken 1: 9 stages, sub-boss at 8; Tekken 2: 10).
- https://streetfighter.fandom.com/wiki/Arcade_Mode, /Bonus_Stage, /Rival, /Round_Timer (SF4 6+rival+Seth; SF6 5 or 12 stages,
  truck 30 s, parry bonus; Alpha 3 rivals at 5 and 9; 3rd Strike rival at 9; timer options 30/60/99; timer stops on super/KO).
- https://en.wikipedia.org/wiki/Street_Fighter_II (first to two rounds, max 10 -> 4 rounds, bonus after every third match,
  7 + 4 Grand Masters), https://en.wikipedia.org/wiki/Street_Fighter_6 (2.5D, rollback, 18 launch characters, three control
  types incl. offline-only Dynamic), https://en.wikipedia.org/wiki/Tekken_8 (Unreal Engine 5, Heat, Tornado, 32 base
  characters; the article does not state its netcode type),
  https://en.wikipedia.org/wiki/Virtua_Fighter_5 (throws 8 -> 12f, 0-frame throws after an evade, Offensive Move, clash).
- https://www.ssbwiki.com/Special_Zoom and https://www.ssbwiki.com/Buffer (Smash zoom/slowdown rules; buffer pitfalls).
- https://glossary.infil.net (JSON at /json/glossary.json) - archetype and system definitions.
Articles:
- https://www.eventhubs.com/news/2023/jun/17/sf6-input-trouble-breakdown/ - WydD's SF6 input windows and priority order.
- https://www.gamedeveloper.com/programming/the-killer-groove-the-shadow-ai-of-killer-instinct - KI Shadow AI facts.
- https://sonichurricane.com/?p=2452 - fighting game AI critique.
- https://lawofgamedesign.com/2014/12/19/theory-marvel-contest-of-champions-and-2d-fighting-with-few-controls/ - MCoC minimal controls.
- https://tk8.tekken-official.jp/en/battle/basic_operations.php - Tekken 8 Special Style toggle (L1), recoverable damage.
- https://github.com/pond3r/ggpo (README + `src/include/ggponet.h`: `GGPO_MAX_PREDICTION_FRAMES 8`, determinism, frame delay).
Search summaries only (pages not read): SF6 keyboard layout (outsidergaming.com), SF6 tournament rules (help.playvs.com),
burnout ~17 s (eventhubs/gamerant), SF6 level-8 CPU reports (eventhubs, Steam), VF5 20f throw-escape window
(virtuafighter.com wiki, 403), mobile control descriptions (toucharcade, androidayuda, supercheats, primagames, Wikipedia
Tekken Mobile, Ubisoft Brawlhalla), Street Fighter: Duel (gameinformer), GDC Vault KI talk, SF4 camera (streetfighter.fandom),
Tekken default 60 s timer (tekken.fandom via search), SFV hitstop 8/12/15 (via DESIGN_RESEARCH.md).
Prior lane files used: `_research/DESIGN_RESEARCH.md` (hitstop history, reaction times, mobile target sizes, camera
smoothing), `_research/TECH_REUSE.md` (SIM_DT 1/60, dyefield input/touch reuse), `_spec/BRIEF.md`, `_spec/DESIGN.md`.

---

## 14. Gaps and caveats (reported, not papered over)
- **SF6 distance units are undefined in the pages read**, so every metre value in this file depends on the scale
  assumption K = 0.752 m/unit (median light reach 1.13 u = 0.85 m). Ratios are measured; absolute metres are derived.
  Tune K once the real rig's arm reach is measured.
- **Round-start distance, stage width, dash durations, projectile speeds** were not found in sources; they are [R].
- **DP and double-quarter-circle input windows**: the WydD article gave QC 11, HC 12, 360 32 only; DP 11 and 236236 20
  are [R].
- **SuperCombo pages disagree on the wakeup reversal buffer** (Game Data: 7 early; Defense: 10 early); I chose 10.
- **Class medians include some mis-classified rows**: the "command grab" class includes throw follow-ups (hence startup
  up to 55); "command normals" mixes overheads with other direction+button moves; the Tekken "launcher" class catches any
  single-input move with an airborne hit state. Specific reference rows (section 1a) are exact.
- **Tekken 8 table contains 62 character ids** (likely including variants/bosses); medians are still dominated by the
  regular cast (jab n=42).
- **VF5 evade and throw-escape numbers** are from search summaries only (virtuafighter.com returned 403). VF details
  were not needed once the 2.5D plane was chosen.
- **No numeric KO slow-mo or camera FOV value exists in the sources read** for SF6 or Tekken; the KO sequence and vFOV 35
  are [R] backed by the derivation in 7b.
- **CPU level table values are [R]**; the only external numbers are the human 12-19f band (KI) and the doctrine's
  300-800 ms. They must be tuned with the persona harness.
- **Mobile control facts** for SF4 CE, MK mobile, MCoC controls, Tekken Mobile and Brawlhalla are search summaries; the MCoC
  design analysis page was read.
- **SF6 arcade length wording**: the fandom Arcade Mode page says "5 or 12 stages" while its Bonus Stage page says "six-stage
  ladder"; I used 5 / 12.
- **Tekken 8 netcode**: not verified (Wikipedia's only rollback mention is about who handles Tekken 7's rollback patch).
- Nothing here was play-tested; every [R] is a starting point for the doctrine's persona playtests.
