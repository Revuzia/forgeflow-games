# Team play review, second attempt prep (2026-11-25, 07:20 CST)

Review only. Nothing under `src/` or `content/` was changed. Every switch was turned on in memory by a throwaway probe (it set the field on the loaded tier profile before any match started). The probe and its outputs are deleted. Base is the live build (catalog 2026.11.18; bots as shipped by ruling 66).

## In plain words

**What is switched off today, and what each piece does**

- **Defence posts** (`guardPosts`). When one of our structures is threatened, the team names defenders and sends them to it. It sends one more defender than there are attackers. They stay until 6 s after the threat is gone, and can recall home to get there. Today only ruling 64's simpler "base answer" runs: the nearest fit fighters go to a base structure while it is being hit.
- **Join a road two of ours commit to** (`joinAt`). From 14:00, if two of our fit fighters (three at novice) are at an enemy structure, that structure becomes the whole team's siege target for 15 s, and the free fighters walk there.
- **Regroup before a siege** (`regroupWait`). Fighters at the group point wait up to 8 s (adept) or 10 s (veteran) for teammates who are still walking in.
- **No walking alone into three** (`loneStop`). From 14:00, a calm walk stops short of three or more enemy fighters if no teammate is there.
- **Push after a won fight or a won defence** (`teamPush`). A won fight goes for the nearest structure, not the least-pushed road. A won defence is treated as a won fight for 20 s.
- **Push and objective pings** (`planPings`). The team says "group here" and "take this". It also treats a person's push and camp pings as team calls, and answers a person's push with "on my way".
- **Hearing teammates** (`hearMates`). A computer-played teammate's own "help here" gets answered, and its own "fall back" gets weighed, the same way a person's would be.

**What I found**

1. **Why games got longer: the posts, and the regroup wait.** Each was turned on alone:
   - Posts at adept made games 1.75 min longer. Six of 32 games reached 30:00; the base had none.
   - The regroup wait cost adept 1.34 min and the won-fight push cost adept 1.44 min.
   - Joining a road cost nothing. With all three tiers pooled, games were 0.33 min shorter, and veteran games 0.88 min shorter.
   - With every ruling 65 switch on together, I reproduced the failed build's pace: adept +1.1 min, veteran +2.0 min.
2. **Why a push ping was answered but not followed.** "On my way" is said by the team as a whole the moment it takes up the ping. No fighter is checked first.
   - The ping only changes which structure the team's siege points at. It never makes any one fighter more likely to push.
   - So every fighter who was defending, taking a camp, protecting a partner, farming the jungle or falling back carries on doing that.
   - The ping is also dropped after 25 s. Half the teammates start 60 m or more away, which at fighter speed is an 18-30 s walk, so they turn back before they get there.
   - Measured: after a person's push ping, the mix of what teammates were doing was the same with the feature on or off. About 4 in 10 were already pushing.
   - About a third to a half of person pushes were "acknowledged and not followed".
3. **Teammates answering each other's "help here" works and costs little on its own.** With it on, 49 % (adept) and 58 % (veteran) of a computer-played fighter's help calls got an "on my way" inside 5 s, against 0 % live. A teammate actually reached the spot inside 5 s 54 / 63 % of the time, against 13-14 % live. Pooled game length changed by +0.15 ± 0.48 min, which is inside noise. In ruling 65 the pace cost came from this piece stacked on top of the posts and the regroup wait.

**What I would build, in this order** (each piece is small, sits behind its own switch, and can ship alone):

1. **Join a road two allies commit to.** It shortens games, and it is the owner's exact ask.
2. **"Take this" objective pings said by the team.** They change nothing in the game, and teammates already follow half of them within 10 s.
3. **Teammates answer each other's "help here"**, but only fighters who are not already on a team push or objective.
4. **An honest push ping.** "On my way" is said only by a fighter that has actually turned to push. The call lasts until the walkers arrive. A person's push gets a real priority for nearby fighters.
5. **Retreat calls between teammates obeyed.** This needs its own measurement first.

**What I would not attempt:**
- Adept defence posts.
- The regroup wait as built.
- The won-fight nearest-structure push.
- The calm-walk stop.
- The team's own "group here" pings, which are followed only 18-21 % of the time within 10 s.
- Veteran posts in this round. They cost 0.7 min and doubled late stalls, and the base answer already covers the base.

## Method

- **Probe.** A throwaway `_harness/_tmp_tpr_pair.ts`, now deleted. It imports `DIFFICULTIES` (src/sim/bots/difficulty.ts) and sets one field per tier before the first match is built, so nothing was edited on disk. The values are ruling 65's:
  - posts `guardPosts` true at the tier's `guardFrom` (novice 2, adept 2, veteran 1);
  - join `joinAt` 3 / 2 / 2;
  - regroup `regroupWait` 6 / 8 / 10 (novice had none in ruling 65; 6 here, so its arm is not empty);
  - lone `loneStop` 4 / 3 / 3;
  - teampush, plan and mates set `teamPush`, `planPings` and `hearMates` true.
  - Two combination arms: join+regroup, and "r65" (ruling 65's full set; adept and veteran only).
- **Lineups and pairing.** The tactics probe's own lineup, both teams at one tier, cut at 30:00, paired by seed against the base arm.
  - RIFT s701-732: 32 pairs per tier per switch, 96 per switch.
  - BRIDGE s701-712: 12 pairs per tier per switch, 36 per switch.
  - In total 132 paired games per switch, about 1,380 games, all run through `heavy.py`.
- **Person proxy.** A computer-played seat 0 whose team brain treats it as a person (`humans.add(0)` at runtime). It sends push pings at 16:30, 19:00, 21:30 and 24:00 on the visible enemy structure nearest its team. RIFT s701-716 per tier, on the base, plan, join and mates arms.
  - This fixes the old `probe_sim_bot_pings` flaw, where the person stood idle in base and the team played four against five.
- **Diagnosis probe.** A throwaway `_tmp_tpr_pushdiag.ts`, also deleted. For each person push (adept, s701-716, 49 pushes), it recorded every teammate's mode, its distance, and the team's siege and ping state at +2, +10, +25 and +27 s.
- **Measures.**
  - "Alone" death: no teammate within 20 m at the moment of death. "Grouped" death: 2+ teammates within 20 m. Both are counted from 14:00.
  - First hit: the first damage from a fighter (or its credited unit) on each structure class, either team.
  - Stall: no structure damage from fighters for 3+ min, from 14:00 (`fstall`).
  - Help answered: a different teammate said onMyWay within 30 m inside 5 s, or a teammate that was 15 m+ away came within 12 m inside 5 s. The 10 s column is arrival only.
  - Push or objective followed: a teammate not within 30 m at the ping came within 30 m inside 10 s. "3@25": three teammates (counting the pinger) within 30 m inside 25 s.

## Numbers

### BRIDGE
Every RIFT-only switch gave byte-identical games to base: 36 of 36 per switch, at every tier. That is by design (all ruling 65 behaviour is RIFT-only).

`plan` adds only pings on BRIDGE:
- push pings said: 230 / 358 / 374 (novice / adept / veteran);
- followed within 10 s: 20 / 32 / 28 %;
- 3 teammates there inside 25 s: 56 / 65 / 66 %.

On BRIDGE the team is already on the one road. Base BRIDGE length is 14.4 / 16.1 / 15.7 min.

### RIFT, one switch at a time (32 pairs per tier; Δ = arm − base, min, ± paired SE)

| arm | tier | Δ length | games at 30:00 (base) | alone / grouped deaths 14:00+ a game | first base-class / core hit (min, games with a core hit) | late stalls a game | mate's help: onMyWay 5 s / reached 5 s |
|---|---|---|---|---|---|---|---|
| base | novice | 24.52 min | 5 | 6.09 / 5.00 | 21.2 / 23.2 (27) | 0.59 | 0 % / 11 % (n 731) |
| base | adept | 22.35 min | 0 | 3.88 / 9.38 | 19.6 / 21.5 (24) | 0.31 | 0 % / 14 % (718) |
| base | veteran | 23.01 min | 1 | 4.25 / 8.03 | 20.7 / 22.1 (23) | 0.53 | 0 % / 13 % (817) |
| posts | novice | +0.32 ± 0.57 | 4 (5) | 6.53 / 5.12 | 21.3 / 23.5 (28) | 0.72 | |
| posts | **adept** | **+1.75 ± 0.56** | **6 (0)** | 4.09 / 11.81 | 20.2 / 22.2 (22) | 0.34 | |
| posts | veteran | +0.68 ± 0.74 | 2 (1) | 4.06 / 9.03 | 21.7 / 23.2 (25) | **1.12** | |
| join | novice | −0.14 ± 0.41 | 5 (5) | 5.88 / 4.78 | 21.3 / 23.1 (26) | 0.59 | |
| join | adept | +0.04 ± 0.64 | 3 (0) | 3.75 / 9.19 | 19.7 / 21.3 (21) | **0.22** | |
| join | veteran | **−0.88 ± 0.62** | 1 (1) | 3.91 / 8.53 | 19.8 / 21.6 (23) | 0.50 | |
| regroup | novice | −1.38 ± 0.73 | 0 (5) | 5.44 / 3.88 | 20.3 / 22.5 (30) | 0.34 | |
| regroup | **adept** | **+1.34 ± 0.76** | **4 (0)** | 4.47 / 12.78 | 20.7 / 22.8 (25) | 0.53 | |
| regroup | veteran | +0.67 ± 0.77 | 2 (1) | 4.53 / 10.12 | 20.7 / 23.3 (29) | 0.81 | |
| lone | novice | +0.20 ± 0.27 | 4 (5) | 6.31 / 5.03 | 21.3 / 23.6 (28) | 0.59 | |
| lone | adept | +0.60 ± 0.43 | 0 (0) | 3.62 / 11.09 | 20.1 / 22.3 (26) | 0.50 | |
| lone | veteran | +0.19 ± 0.47 | 1 (1) | 4.53 / 8.81 | 20.8 / 22.7 (28) | 0.62 | |
| teampush | novice | +0.00 ± 0.58 | 5 (5) | 6.91 / 4.22 | 21.3 / 23.4 (25) | 0.81 | |
| teampush | **adept** | **+1.44 ± 0.87** | 1 (0) | 4.03 / 12.00 | 20.2 / 23.4 (24) | 0.41 | |
| teampush | veteran | +0.36 ± 0.74 | 3 (1) | 5.09 / 9.12 | 20.6 / 22.7 (24) | 0.72 | |
| plan | all | +0.00 (32 / 32 identical) | = base | = base | = base | = base | |
| mates | novice | −0.64 ± 0.89 | 2 (5) | 6.66 / 4.62 | 21.1 / 23.3 (30) | 0.66 | **38 % / 42 %** (714) |
| mates | adept | +0.39 ± 0.77 | 0 (0) | 4.12 / 10.16 | 19.9 / 22.1 (26) | 0.41 | **49 % / 54 %** (711) |
| mates | veteran | +0.71 ± 0.85 | 4 (1) | 4.47 / 10.19 | 20.8 / 22.5 (26) | 0.97 | **58 % / 63 %** (828) |
| join+regroup | adept | +1.18 ± 0.91 | 3 (0) | 4.50 / 12.16 | 19.9 / 22.6 (21) | 0.47 | |
| join+regroup | veteran | +0.28 ± 0.73 | 0 (1) | 4.44 / 9.19 | 20.3 / 23.0 (25) | 0.66 | |
| r65 (all on) | adept | +1.11 ± 0.70 | 2 (0) | 4.06 / 11.91 | 20.0 / 22.9 (26) | 0.31 | 49 % / 55 % |
| r65 (all on) | veteran | **+2.03 ± 0.81** | **6 (1)** | 4.03 / 11.72 | 22.4 / 23.7 (23) | **1.16** | 49 % / 54 % |

**Pooled RIFT Δ length (n 96):**

| arm | Δ length, min |
|---|---|
| posts | **+0.92 ± 0.36** |
| join | −0.33 ± 0.33 |
| regroup | +0.21 ± 0.45 |
| lone | +0.33 ± 0.23 |
| teampush | +0.60 ± 0.43 |
| plan | 0 |
| mates | +0.15 ± 0.48 |

join+regroup is +0.73 ± 0.58 and r65 is +1.57 ± 0.54; both of those are n 64, adept and veteran only.

**Other reads:**
- **Win balance.** Team 0 won 13-17 of 32 in every arm, so no switch bends the sides.
  - Paired winner flips: 0 for plan; 2-12 for join; 12-17 for posts, regroup, teampush and mates.
  - Every behaviour switch except plan reshuffles outcomes. None tilts them.
- **First outer hit** is 15.1-17.0 min at every arm: it is set by the laning phase.
- **Push and objective pings said by the team (plan arm, RIFT).**
  - Push followed within 10 s: 19 / 21 / 18 % (n 730 / 517 / 738).
  - Push, 3 there inside 25 s: 20 / 35 / 31 %.
  - Push, structure hit by the team inside 30 s: 25 / 30 / 20 %.
  - Objective followed within 10 s: **46 / 53 / 50 %** (n 341 / 419 / 561).

### A person's push ping (proxy seat, RIFT s701-716, about 50 pushes per tier)

| arm | tier | acknowledged (onMyWay inside 5 s) | 3 there inside 25 s | a newcomer inside 10 s | hit inside 30 s | acknowledged and not followed | Δ length |
|---|---|---|---|---|---|---|---|
| base (heard but ignored) | n / a / v | 0 / 0 / 0 % | 19 / 27 / 32 % | 13 / 16 / 19 % | 12 / 9 / 6 % | 0 | |
| plan | n / a / v | **56 / 57 / 67 %** | **15 / 39 / 38 %** | 15 / 20 / 29 % | 12 / 12 / 4 % | **23 / 15 / 19** (of 52 / 49 / 48) | +0.09 / **+1.66 ± 1.01** / −0.64 |

So about 30-48 % of person pushes are "on my way, then nobody comes". This is ruling 65's blocker, reproduced in a fair five-against-five game.

Diagnosis probe, adept, 49 person pushes, plan arm against base (base's ping is ignored):
- **Teammates within 30 m of the structure:**
  - at +2 s: 41 of 166 alive;
  - at +10 s: 29 (base 22);
  - at +25 s: 32 (base 8).
  - The ping moves about one teammate in four. It does not move three.
- **Where they started:** 41 within 30 m, 51 at 30-60 m, 47 at 60-90 m, 28 beyond 90 m.
- **What teammates were doing at +25 s** (plan / base):

  | mode | plan | base |
  |---|---|---|
  | push | 46 | 46 |
  | defend | 21 | 24 |
  | objective | 22 | 16 |
  | protect | 17 | 14 |
  | retreat | 16 | 13 |
  | recall | 14 | 11 |
  | jungle farm | 9 | 8 |
  | dead | 37 | 36 |

  The ping does not change what fighters choose to do.
- **The team's siege on the pinged structure:** 40 of 49 at +2 s, 37 at +25 s, **27 at +27 s**. The ping was still live at +27 s in only 9 of 49.

## Root causes, with file:line

**"Acknowledged but not followed"**

1. **The team says "on my way", not a fighter that has turned.** `src/sim/bots/team.ts:1309` calls `callOut('onMyWay', …, this.speaker(...))`. It runs the moment the team takes the ping up (`team.ts:1299`, `pp.on` once numbers are even). The speaker is simply the bot nearest the structure (`team.ts:395`, `speaker`), whatever it is doing.
2. **The ping only re-points the siege.** `team.ts:1298-1312` sets `best` / `group` on the pinged structure. Each fighter still chooses its mode in `src/sim/bots/bot.ts:725-737`, an `else if` chain with no branch for a person's call. A non-window group call is worth 0.56-0.64 (`bot.ts:737`). Several things outrank it or exclude a fighter from it:
   - Objective desire, 0.6-0.9+ (`bot.ts:778`).
   - Helpers, 0.79 (`bot.ts:743`).
   - Posts and base answers, 0.78-0.95 (`bot.ts:747`).
   - Defend calls, 0.55-0.85 (`bot.ts:759-769`).
   - Junglers, which are excluded until the late phase (`bot.ts:737`, `!this.jungle || b.phase === 'late'`).
   - The follow roll (`bot.ts:522-524`).
   - Protect, retreat and recall, which come before any team intent.
3. **The call dies before the walk ends.** `team.ts:505` sets `until: h.t + 25`, and `team.ts:497` drops it. From 60-90 m at 3.35-3.45 m/s (`content/fighters/*.json` moveSpeed), the walk takes 18-27 s, and longer around walls. At +27 s the siege had already moved off the pinged structure in 10 of 49 cases.
4. **A later block can take the target away after the acknowledgement.** The cross-map trade (`team.ts:1360-1370`) re-points `siege` with no un-acknowledgement. Endgame staging (`team.ts:1330-1356`) can also hold the walkers at the group point.

**Longer adept games**

1. **Posts (`guardPosts`).**
   - Every threat on an inner or base structure gets one more defender than its attackers: `team.ts:734`, `n + 1` × `defendMatch`, and adept's `defendMatch` is 1.
   - Posts are refreshed while the threat holds: `team.ts:781`, `defendHold` 6 s.
   - A base post is worth 0.95 in mode choice (`bot.ts:747`). That outranks every siege branch except a rush at the structure (`bot.ts:722-737`).
   - With both teams posting, the base holds longer than it can be broken. That gives 6 games at 30:00 against 0, and +1.75 min.
   - At veteran the 'coming' read (`team.ts:728-731`) and recall-to-defend (`team.ts:790`) double the late stalls (0.53 → 1.12 a game).
2. **Regroup (`regroupWait`).**
   - "Coming" means within 50 m of the group point, not walking to it (`team.ts:1385-1392`). A teammate farming or defending nearby holds the whole siege for the full 8-10 s.
   - The wait restarts every time the siege target changes (`team.ts:1384`).
   - Fighters not yet at the structure drop it (`bot.ts:1693`), so pairs that would have hit with the wave stand and wait.
   - Adept: +1.34 min, 4 games at 30:00 against 0.
3. **Won-fight nearest-structure push (`teamPush`).** The +140-point bonus for the structure nearest the team (`team.ts:1266`) and the 20 s counter-push window (`team.ts:391`) aim won fights at whatever is closest. After a defence, that is often a deeper, defended structure. This is my reading of the code, not a measured trace.
4. **Joins were not a cost on their own.** `team.ts:1271-1295` measured −0.33 min pooled. Ruling 65's "no joins: −0.48" was measured with the regroup on. Joins create more new siege targets, and each new target restarts the regroup wait (`team.ts:1384`). join+regroup at adept is +1.18.

**Teammates' own help calls**

These are off only by `team.ts:534` (`if (d.hearMates)`). The answer logic in `team.ts:519-571` already refuses lost fights (`team.ts:546`). It holds the answerer for 8 s (`team.ts:566`), at 0.79 (`bot.ts:743`). That outranks a non-window group push (0.64), so an answer can pull a fighter off a siege. That is the pace risk to cap.

The same switch also turns on hearing a mate's "fall back" (`bot.ts:583`). Ruling 66 measured that half alone at +0.43 min at veteran.

## Second attempt: small pieces, each behind its own switch

They are ordered by value over risk. Each piece ships alone, keeps BRIDGE and FRAY byte-identical, and is measured against live with the probe used here: RIFT n96 paired, s701-732 plus a fresh window, plus the person proxy.

### 1. Join a road two allies commit to
- **Change:** `joinAt` 3 / 2 / 2 only. Regroup stays 0.
- **Player-visible bar:** watching a RIFT game from 14:00, when two of a team stand at an enemy tower, a third arrives within 20 s in at least half the cases (measure it). Games are no longer: pooled Δ ≤ +0.3 min, and games at 30:00 at or below live.
- **Expected:** Δ −0.3 ± 0.3; adept late stalls 0.31 → 0.22.
- **Risk:** low. Watch that adept core-hit games did not fall: 24 → 21 of 32.

### 2. "Take this" objective pings said by the team
- **Change:** split `planPings` into `sayObjective`, `sayPush` and `hearPersonPlan`. Ship `sayObjective` only.
- **Player-visible bar:** a teammate's "take this" is followed by another teammate inside 10 s at least 45 % of the time, and the camp is taken or contested.
- **Expected:** 46-53 % followed. Games are byte-identical to live: this arm changed nothing in 96 of 96 RIFT games and 36 of 36 BRIDGE games.
- **Risk:** none to pace; ping budget only. A person's camp ping is a separate piece, not this one.

### 3. Teammates answer each other's "help here"
- **Change:** a new `hearMatesAssist`, split from the retreat half. Answerers come only from lane, farm, roam or return modes: never a fighter on a team push, objective or post. At adept and veteran only.
- **Player-visible bar:** in a played match, a computer-played teammate's "help here" draws a "heading there" plus an arrival inside 5 s at least 45 % of the time. Live is 13-14 % (by chance).
- **Expected:** 54-63 % reached (measured without the mode filter; expect a little less with it). Pace Δ ≤ +0.4 min pooled, games at 30:00 ≤ live + 2. Late stalls at veteran must not double: 0.53 → 0.97 without the filter.
- **Risk:** medium-low.

### 4. An honest push ping (a person's "group here")
- **Change:** "On my way" is said from `bot.ts` by a fighter whose mode turned to push for the pinged structure, never by the team (`team.ts:1309`). The call lasts until the fighters who took it arrive (ETA-based, cap 45 s), not a flat 25 s. A person's push gets its own mode utility (about 0.70) for fit non-posted fighters with an ETA within 25 s: more than a plain group follow, less than defence of the base. Bots do not say push pings themselves (`sayPush` stays off: 18-21 % followed).
- **Player-visible bar:** a person's push that gets "on my way" is followed by that fighter, within 30 m by its ETA, every time: acknowledged and not followed = 0. Three teammates there inside 30 s in at least 50 % of pushes at adept and veteran.
- **Expected:** today 39 / 38 % reach 3 inside 25 s, with 15-19 broken of about 50. Pace in proxy games ≤ +0.5 min. The plan arm's adept +1.66 ± 1.01 on n 16 must be re-measured on n 32+.
- **Risk:** medium.

### 5. Retreat calls between teammates obeyed
- **Change:** `hearMatesRetreat` alone (`bot.ts:583` with `people` false), unchanged otherwise.
- **First step:** measure it alone, which this review did not do (ruling 66: +0.43 min at veteran).
- **Player-visible bar:** after a teammate's "fall back", fighters within 25 m who agree are out of the fight inside 3 s, and alone deaths from 14:00 fall by ≥ 10 % with pace Δ ≤ +0.3.
- **Risk:** medium. Ship only if lone deaths actually fall.

### 6. Defence posts only where they pay
- **Do not ship in round two.**
- If tried later, only veteran, only base structures, with the base answer's 1.5 s release in place of `defendHold`, and no +1 defender.
- **Bar:** late stalls ≤ live and Δ ≤ +0.3.

### Would NOT attempt
- **Adept posts:** +1.75 min, 6 games at 30:00 against 0.
- **The regroup wait as built:** +1.34 adept, 4 games at 30:00 against 0. Its "coming" is distance, not intent.
- **The won-fight nearest-structure push and counter-push:** +1.44 adept.
- **The calm-walk stop:** +0.60 adept, no clear drop in lone deaths (3.88 → 3.62 adept; up at veteran).
- **The team's own push pings:** followed 18-21 %, so they would be promises the team does not keep.
- **Turning the r65 bundle back on in any form:** +1.57 pooled, +2.03 at veteran.

### My own additions (genre standard), for later lanes
- **Group before a timed objective spawn.** Ruling 65 left this for later. The objective ping in piece 2 is the visible half of it.
- **Answer a split push with exactly one fighter.**
- **Do not chase past vision on RIFT.**
- **Each is a separate switch with its own bar.** None should be bundled.

## Cleanup
- Deleted `_harness/_tmp_tpr_pair.ts`, `_harness/_tmp_tpr_pushdiag.ts` and the scratch outputs.
- No server was started and no worktree was made.
- No `src/` or `content/` file was touched. `git status -- src content` showed nothing from this review.
