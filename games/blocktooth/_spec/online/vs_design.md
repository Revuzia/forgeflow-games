# BLOCKTOOTH VS: "ZONING DISPUTE" (4-titan online mode). Game design

Status: DESIGN PROPOSAL (read-only research, 2026-10-01). No game code was edited. Every claim about the existing
game cites `file:line` (paths are relative to `games/blocktooth/` unless they start with `forgeflow-games/`).
Labels: **[verified]** = read in the file this session; **[inferred]** = my reading or extrapolation, not measured;
**[proposal]** = a design number for a VS tuning lane to measure, then keep or change.

Owner ask this answers: "4 players on a map and each competing to grow larger and then fighting each other - real
players and bots fill." Stats, achievements, leaderboards and the netcode/lobby plumbing belong to the sibling
`_spec/online/` docs. This file covers the GAME RULES only, plus the few sim events those docs need from it (§13).

---

## 0. One-paragraph pitch

Four baby titans drop into one city, one in each quadrant. For 4 minutes the city is food and nobody can hurt anybody
(**OPEN HOUSE**). Then claws come out (**HOSTILE TAKEOVER**): titans can knock each other out. A KO'd titan comes back
2 levels lighter, and the titan who scored the KO banks XP from it. At 7:00 the city is **condemned** from the outside
in (**FINAL NOTICE**). KO'd titans stop coming back, and the last titan standing makes the front page. The match ends
by 10:45 at the latest. Empty seats get bots, and a human can take over a bot seat during OPEN HOUSE.

---

## 1. Ground truth this design is built on

| Fact | Evidence |
|---|---|
| The sim holds exactly ONE titan: `World.titan: TitanState`, built once in `createWorld` | [verified] `src/core/types.ts:604`, `src/core/world.ts:54` |
| Damage to the titan goes through `hurtTitan(w, …)`, which reads `w.titan` (armor, i-frames, shield, kit hook) | [verified] `src/titans/titansim.ts:671-695` |
| The sim is FROZEN (not slowed) while a draft owns the screen | [verified] `src/core/world.ts:114-116` |
| SIZE comes from LEVEL. Ranks I-V at LV 1/7/16/27/35, heights 1.2/5/14/32/60 m | [verified] `src/core/config.ts:155-160`, `:168` |
| Per-rank titan multipliers: hp 1/1.8/3.2/5.5/9, dmg 1/3/8/20/45 | [verified] `src/core/config.ts:156-160` |
| Contact crush: enemies shorter than 0.45 × titan height are crushed | [verified] `src/core/config.ts:187-188` |
| Bigger titans walk faster in metres: `3.2 + 1.9·H^0.8` m/s | [verified] `src/core/config.ts:221-222` |
| The old 10-minute economy is still documented. Ungoverned LV 6/15/26/37 at 90/210/360/480 s; Size-ups II 70-121 s, III 191-247, IV 329-388, V 413-483; 39-44 drafts per run | [verified] `src/core/config.ts:13-14` (says the table below is the 10-minute run), `:43-46` |
| The 20-minute solo pacing uses XP_STRETCH / PACE_STRETCH / RANK_SCHEDULE_S rubber band | [verified] `src/core/config.ts:16-22`, `:235-242`, `:277-291`; `src/titans/titansim.ts:514-537` |
| Gatekeepers lock the rank until killed. HP 1 000 / 4 500 / 20 000; hit cap 40 % of maxHp; titan DPS on a rig capped at 6 % of its maxHp per 1 s | [verified] `src/meta/gates.ts:5-23`, `src/core/config.ts:75`, `:986-992` |
| City: blocks 72 m apart; GRID-EAST 15×16, WHITE STACKS 14×13, LOCKWATER 13×16 blocks (≈1 km a side) | [verified] `src/core/config.ts:338-339`, `src/data/biomes.ts:9-10` |
| Repair crews rebuild lots away from the titan, up to 384 crews, target 95 % standing floors | [verified] `src/city/citysim.ts:77-106`, `:118`, `:130` |
| Build slots: SLOT_CAP 8, overflow rewards SICK DAY / HOT TIP / HARD HAT | [verified] `_spec/FEATURES_V2.md:938`, `:972-980` |
| UPROAR meter max 100, 6 s lockout after firing, roar gives invulnerability | [verified] `src/core/config.ts:1051-1075`, `src/titans/titansim.ts:675` |
| Power-ups: CLEANUP CREW, DEMOLITION NOTICE, RED LIGHT, RUSH HOUR, BACK PAY | [verified] `_spec/FEATURES_V2.md:758-764` |
| Auto-attack targeting: enemy → boss part → city, through `findTarget(…, preferEnemies)` | [verified] `src/combat/targeting.ts:3-10`, `:114-118` |
| A deterministic headless bot exists (THREAT → BOSS → FOOD → STUCK, plus a draft scorer) | [verified] `_harness/bot.ts:8-21` |
| FFG's 4-titan ceiling matches the platform's: last-circle caps rooms at 4 humans because Supabase Realtime traffic grows with the square of the human count and drops the connection at the cap | [verified] `forgeflow-games/games/last-circle/runtime/3d/royale/net.js:5-11`, `:367` |
| FFG's MP pattern: deterministic world from a shared seed; each human simulates their own actor; the host simulates the bots; the victim applies damage to itself; joining = taking over a bot slot; a guest who drops is replaced by a bot | [verified] `…/last-circle/runtime/3d/royale/net.js:13-29`; same authority model in `…/pirates-cove/runtime/net/covenet.js:4-18` |
| The shared NetPlay quick match pairs TWO peers (1v1) | [verified] `forgeflow-games/pipeline/engine/runtime/net/ffg_netplay.js:16`, `:78-97` |
| Ratings RPC is 2-player only (`p_white`, `p_black`, result white/black/draw) | [verified] `forgeflow-games/supabase/migrations/0004_game_ratings.sql:45`, `:59-60` |

What follows from this: VS needs more than one titan in the sim, or rival titans fed in as external actors. Drafts
cannot pause the shared sim. The 20-minute pacing has to be replaced by a 10-minute VS pacing (there is a measured
one to start from). Hard size-gate locks cannot stay, because a lock one player cannot open makes the leader
unbeatable.

---

## 2. Decisions at a glance

| Topic | Decision | Main reason |
|---|---|---|
| Match length | **10:00 + LAST CALL up to 0:45 (hard end 10:45)** | The documented 10-minute economy reaches Size V at ~7-8 min (`config.ts:43-44`), so the fight happens between giants. Half the solo run. |
| Phases | OPEN HOUSE 0:00-4:00 (no rival damage) → HOSTILE TAKEOVER 4:00-7:00 (KO + respawn) → FINAL NOTICE 7:00-10:00 (elimination + closing ring) → LAST CALL | "Grow, then fight", as the owner described it. Each phase changes one rule, so every banner is readable. |
| Size gates | **No locks in VS.** Ranks come from levels alone. The 3 gatekeepers become shared **PUBLIC TENDER** events whose rewards are split by damage share | A lock someone can't open is a death sentence in PvP |
| City boss | **Not in VS v1.** The CONDEMNATION ring is the finale | The boss system is a single slot (`World.boss`, `types.ts:610`) tuned for one Size IV titan (`GATEKEEPERS.md §4.2`). 4 giants + a 100k-HP rig would be unreadable. |
| PvP damage | **A % of the victim's max HP per hit**, × a capped **size edge** (+12 % per rank, max ±36 %) | Raw damage scales ×45 with rank and HP only ×9 (`config.ts:156-160`), so raw PvP would be one-shots |
| Comeback | Leader-relative catch-up XP, a FRONT PAGE bounty on the leader, tenders placed near the last-place titan, small KO rewards for bullying, a capped size edge | So the leader is strong but can be beaten |
| Drafts | **CARD RAIL**: 3 cards slide up while play continues. 1/2/3 to pick, R to reroll, auto-pick after 12 s. Drafts every level to LV 12, then every 2nd level. No banish/lock in VS. | The shared sim can't freeze (`world.ts:114-116`) |
| Enemies | Civil Defense units are **assigned** to one titan (stripe in that titan's seat colour), with budget × 0.6 per titan and × 1.3 on the leader | Keeps PvE as pressure rather than the main threat. Also cheap to network (each owner simulates its own units). |
| Win / placement | Last standing = 1st, then reverse elimination order. VS SCORE breaks ties. | Simple, final, easy to read |
| Bots | Fill every empty seat. ROOKIE / REGULAR / VETERAN, built on `_harness/bot.ts` plus a RIVAL layer | Every match is a 4-titan match |
| After death | Follow the killer for 2.5 s, then spectate living titans (Q/E), live scoreboard, LEAVE anytime | Nobody stares at a black screen |
| Rematch | Same room and seats, new seed, 15 s vote, 10 s titan swap, bots refill empty seats | One click back in |

---

## 3. Match length and phases (with the rule that changes in each)

Timeline (world seconds; **[proposal]** values, to be tuned by the VS pacing lane, §14):

| Clock | Phase | The rule that changes | Banner (tabloid voice) |
|---|---|---|---|
| -0:05-0:00 | COUNTDOWN | Titans visible and frozen in their quadrants; seat cards slide in | `ZONING DISPUTE — FOUR APPLICANTS, ONE CITY` |
| 0:00-4:00 | **OPEN HOUSE** | No rival damage. Rival hits SHOVE only (knockback, no HP). The city is the race. | `OPEN HOUSE — EAT FIRST, ASK LATER` |
| 0:25 | PUBLIC TENDER 1 | STENCIL-1 arrives (marker 15 s ahead). A fight is 80-110 s; the next rig arrives 15 s after the last one is paid (never two at once) | `PUBLIC TENDER: STENCIL-1 — BIDS BY DAMAGE` |
| ~2:00 | PUBLIC TENDER 2 | CORDON-2 arrives (queued behind tender 1) | |
| 4:00-7:00 | **HOSTILE TAKEOVER** | Rival damage on. A KO = **EVICTED**: respawn in 5 s, −2 levels (never below the current Size). The FRONT PAGE crown goes live. | `HOSTILE TAKEOVER — THE CLAWS ARE OUT` |
| ~3:50 | PUBLIC TENDER 3 | SWITCHBOARD-5 arrives (queued behind tender 2); paid before 7:00 in every measured match | |
| 7:00-10:00 | **FINAL NOTICE** | No respawns (a KO = eliminated). The **CONDEMNATION ORDER** ring closes in 3 steps. Repair crews switch to demolition. | `FINAL NOTICE — THE CITY IS CONDEMNED` |
| 10:00-10:45 | **LAST CALL** | The ring closes to its last circle. Ring damage climbs every 5 s. Hard end at 10:45 (tie-break, §9). | `LAST CALL` |

Why these times:
* **OPEN HOUSE ends at 4:00.** The ungoverned 10-minute curve puts titans at about LV 15 at 210 s and LV 26 at 360 s
  (`config.ts:44`). At 4:00 everyone is around early Size III (14 m+). That is big enough for kit fights to look
  like kaiju fights, and early enough that no one has run away with it. [inferred: with 4 titans sharing one city the
  per-titan XP rate may be lower; the pacing lane measures it]
* **FINAL NOTICE starts at 7:00.** The 10-minute economy measured Size IV at 329-388 s and Size V at 413-483 s
  (`config.ts:43`). The elimination phase is fought at Size IV-V, which is the spectacle the owner described.
* **10 minutes in total**: inside the requested 8-12 window, half the 20-minute solo run (`config.ts:13`), and it
  fits a "one more match" session.
* **Hard end at 10:45** so a match never stalls (no hiding titan can drag it out).

VS pacing config **[proposal]**: a `VS` block in `config.ts` read only when the world is in VS mode. It sets
`XP_STRETCH` to 1 (the pre-p20 curve), `PACE_STRETCH` to 1, and turns the schedule rubber band (`RANK_SCHEDULE_S`
catch-up and AHEAD governor, `titansim.ts:514-537`) OFF. In its place goes the leader-relative catch-up in §6.2.
Solo stays byte-identical.

---

## 4. Size gates, gatekeepers and the city boss with 4 titans

### 4.1 No locks in VS
Solo: reaching LV 7/16/27 LOCKS the rank until that gatekeeper dies (`meta/gates.ts:5-13`). In VS that would
hand the match to whoever kills the rig first. **VS ranks come from RANK_LEVELS alone**: the gate state starts
"all unlocked" and the time caps (`GATES.capS`, `config.ts:966`) are not used.

Options considered:
| Option | Verdict |
|---|---|
| Per-player gatekeepers (each titan fights its own STENCIL-1 at LV 7) | Rejected. Up to 4 rigs alive at once, but `World.boss` is a single slot (`types.ts:610`) and the rig views are heavy (`ai/bossview.ts` is 1 960 lines). The match also splits into 4 solo games. |
| Shared gatekeeper that still LOCKS everyone's rank | Rejected. One kill decides 3 players' growth. |
| **Shared gatekeeper as a reward event (PUBLIC TENDER)** | **Chosen.** It pulls titans together (natural third-party fights), still uses the 3 authored rigs, and never blocks growth. |

### 4.2 PUBLIC TENDER (the shared gatekeeper events)
* **When** (BOSSHP, 2026-10-06): STENCIL-1 at 0:25, then CORDON-2 and SWITCHBOARD-5 each 15 s after the previous rig is paid (earliest 1:30 / 3:10;
  measured medians 2:02 / 3:50). The fights are long now (see HP / DPS cap), so one rig is up at a time and the next one queues; a tender not
  up by 9:00 is dropped. Each rig is roughly level-matched to the
  ungoverned curve (its solo role is the LV 7/16/27 ceiling, `GATEKEEPERS.md §3.1-§3.3`; the 10-minute curve hits
  LV 6/15/26 at 90/210/360 s, `config.ts:44`). [inferred]
* **Where**: a crosswalk in the **last-place titan's quadrant** (lowest level; ties go to fewer KOs), at least 1.5 ×
  that titan's spawn ring from every titan. The marker and its minimap ping appear 15 s ahead for everyone. The
  trailing titan gets first crack, and everyone can see that coming.
* **HP** (BOSSHP: "boss fights in online should have a lot more HP"): solo HP × `VS.tender.hpMul[gate]` (3.7 / 4.6 / 3.5) × (1 + 1.0 × (titans within 2 × spawn ring when it
  spawns − 1)), recomputed once when the intro ends. Measured fight length (rig live to paid, REGULAR bots, 36 matches): 82 / 96 / 108 s median
  (was 22 / 26 / 28 s), 3-4 attackers median 97 s; a lone attacker (the other three seats idle) 145-183 s / 166-226 s on STENCIL / CORDON.
  FATIGUE: after 110 s up, every titan hit on the rig deals × (1 + overrun / 40 s), so no fight drags on. **[measured]**
* **Target choice**: the rig hunts the titan with the most damage dealt to it in the last 5 s (it starts on the
  nearest titan). It switches at most every 4 s, and the switch is telegraphed by the rig's head/turret turning, so
  tanking is a choice.
* **DPS cap**: the solo per-titan window (6 % of maxHp per 1 s, `config.ts:991-992`) becomes a **global** window
  of 1.2 % × (1 + 0.5 × (attackers − 1)), capped at 3 % (BOSSHP: it was 6 % / 12 %, which at the new HP would have capped the fight at 8-17 s
  whatever the HP: the cap is a FRACTION of max HP). A 4-titan pile-on takes at least ~35 s. That leaves time for the fight around the rig.
  While a rig is up, only the titans working it (within 2 × spawn ring) get the thinner PvE spawn budget (`VS.tender.spawnMulNear`); everyone else eats normally.
* **Hit cap**: the solo 40 % hit cap (`config.ts:986-987`) stays, applied per victim.
* **Reward, split by damage share** (the "bids"):
  * the XP lump the solo breach would have given (`breachTo` top-up, `titansim.ts:637`) × share, with a minimum of
    15 % of the lump for any titan that dealt ≥ 5 %;
  * the **top bidder** (most damage) gets the wreck's chest. In VS it opens as a rare+ CARD RAIL offer (§7), not a
    pickup, because chests are a shared world item that is tricky to contest fairly;
  * UPROAR + `GATES.reward.uproar` (40, `config.ts:996`) × share.
  * The last hit gets nothing extra. That kills kill-steal frustration: damage is what counts.
* **PvP around a tender**: during OPEN HOUSE rivals still can't hurt each other near the rig, but they can shove each
  other out of its paint. After 4:00 (TENDER 3) the rig fight is a live free-for-all.
* **Ignored rig**: after 60 s with no titan within 2 × spawn ring it leaves ("BID WITHDRAWN") and pays nothing.

### 4.3 The city boss
**Out of VS v1.** CAISSON-4 / IRON GULLY / PARKADE-6 are re-scaled for one Size IV titan with a scripted finale
(`GATEKEEPERS.md §4.2-§4.3`; `world.ts:106-110` ends the solo run on its kill). In VS the finale is the titans
themselves plus the CONDEMNATION ring (§5). **v2 option** (not in this spec): a "MAIN EVENT" playlist where the city
boss walks in at 7:00 as a neutral hazard that attacks the FRONT PAGE titan.

---

## 5. FINAL NOTICE: the CONDEMNATION ORDER ring

* The ring centre is the **tallest-tier block cluster** (the downtown towers, tier 3-4 floors: the Size IV-V meal,
  `config.ts:305-311`). It is picked deterministically from the seed at match start and shown on the minimap from
  6:30.
* Steps **[proposal]**: 7:00 → 75 % of the city's half-width, 8:00 → 50 %, 9:00 → 30 %, 10:00 (LAST CALL) → 15 %
  (≈ 80 m: two Size V bodies' worth of shoving room). Each step shrinks over 20 s, with a red cordon line painted on
  the roads.
* **Outside the ring**: condemned. Repair crews become **demolition crews** (the reverse of the rebuild model,
  `citysim.ts:77-106`): condemned buildings come down on a cosmetic schedule and drop no XP. A titan outside takes
  STILT MORTAR barrage telegraphs (the existing walker circle telegraph, `types.ts:39`) every 1.5 s, aimed at it. Each
  shell does 4 % maxHp, +1 % per step. A titan can dodge them, so leaving the ring is a choice and doesn't kill
  instantly.
* **LAST CALL** (10:00): mortar damage +2 % every 5 s, so someone must fall by 10:45.

Why a ring and not a timer win: a timer rewards hiding, the ring forces the final fight, and the "condemned city"
fits the tabloid/municipal voice of the game (perks are PETTY CASH, RED TAPE, STAY OF DEMOLITION, `types.ts:859`).

---

## 6. Titan-vs-titan combat

### 6.1 The damage rule (one formula, all kits)
```
pvpDamage = victim.maxHp × kitPct(hit) × power(attacker) × sizeEdge(attacker, victim) × phaseMul
  power     = min(1.6, sqrt(attacker.stats.damage))        // builds matter, compressed
  sizeEdge  = clamp(1 + 0.12 × (attacker.rank − victim.rank), 0.64, 1.36)
  phaseMul  = 0 in OPEN HOUSE (knockback only), 1 after 4:00
then: victim armor (100 / (100 + armor)), shield, i-frames, kit onHurt, exactly as hurtTitan does today
(titansim.ts:676-687).
```
Why a % of max HP: raw kit damage carries the rank multiplier (×45 at Size V, `config.ts:160`) while HP only grows
×9, so raw PvP between ranks would be instant deletes. A % rule makes time-to-kill a design number. **Target TTK**:
an equal-size 1v1 with both titans landing their autos lasts about **15 s** (hooks, dashes and UPROAR shorten or save
it). That is long enough to read, to dash out, and for a third titan to arrive. **[proposal]**

Size still matters, but capped: a Size V hitting a Size III deals ×1.24 and takes ×0.76. That is enough to feel big
and not enough to be untouchable. Two smaller titans focusing one leader beat it.

### 6.2 Comeback rules (so the leader is not unbeatable)
1. **Capped size edge** (±36 %, above).
2. **Leader-relative catch-up XP** (replaces the schedule rubber band in VS): growth XP × min(1.5, 1 + 0.08 ×
   (leader level − my level)). The leader gets × 1. It runs in every phase. **[proposal]** (same idea as the solo
   catch-up, `titansim.ts:522-524`, measured against the leader instead of the clock)
3. **FRONT PAGE crown** (from 4:00; the highest level, ties go to more XP): the crown holder shows through buildings
   for everyone, its Civil Defense heat is × 1.3, damage dealt to it charges the attacker's UPROAR × 1.5, and
   **evicting** it pays the killer a bonus of 1 level of XP ("HEADLINE STOLEN").
4. **Tenders spawn by the last-place titan** (§4.2).
5. **Bullying doesn't pay**: KO XP = 40 % of the XP the victim lost, × 0 if the victim is 2+ ranks smaller than the
   killer ("NO STORY HERE"). Same-size or bigger victims pay full.
6. **KO costs levels but never a Size**: −2 levels' worth of XP, floored at the start of the victim's current rank
   (`RANK_LEVELS`, `config.ts:168`). It hurts without shrinking the body. [inferred: the sim only grows; there is no
   shrink path in `titansim.ts` grow / `breachTo` (`:573`, `:637`), so this also avoids new tween code]
7. **CC can't chain**: any root / tangle / drag / stun on a rival lasts at most 1.0 s and gives 3 s of **CLEARED**
   (immune to rival CC), with a white rim flash.
8. **KO credit** goes to the most damage in the last 10 s; anyone else who dealt ≥ 15 % in that window gets an ASSIST
   (25 % of the KO XP).

### 6.3 Contact between titans
* **Body collision**: titans push apart. The push splits by height² (the bigger body moves less). No damage.
* **STOMPED**: a titan under 0.45 × the other's height (the existing `CRUSH_RATIO`, `config.ts:188`) gets
  stomped when the bigger titan moves through it: 6 % maxHp, a 1.5 H knockback, and 1.5 s before the same pair can
  stomp again. This is never an instant crush. With catch-up, gaps of 2+ ranks should be rare after 4:00 [inferred].
* **OPEN HOUSE**: rival hits and stomps deal knockback only, with a grey "NO CONTEST" spark so players learn the rule
  by seeing it.
* **Spawn protection** after an EVICTED respawn: 3 s, broken early by attacking a rival.

### 6.4 Each kit against another titan (auto / SPACE hook / dash)
Base kits: `src/data/titans.ts:39-161`. The `kitPct` values are **[proposal]** for a VS bot sweep to tune toward the
~15 s TTK.

| Titan | Auto vs a rival | SPACE (hook) vs a rival | Dash vs a rival | PvP identity |
|---|---|---|---|---|
| **MOLO** (SMASH TANK, 140 HP, armor 10) | CURB BITE front cone: **4 %** per bite (0.75 s). Positional: get behind MOLO. | GULLET VACUUM: drags a rival **under 0.7 × its height** to the jaws (counts as CC: ≤ 1 s, then CLEARED); similar-size rivals are only slowed 30 %. Shield on release as today. | LOW TACKLE: shove 1.5 H + **5 %**, i-frames as today (`TITAN.dashIframes` 0.3 s, `config.ts:877`) | Brawler who wins up close and loses when kited |
| **VOLT-KITE** (CHAIN ASSASSIN, 90 HP, 2 dashes) | FORK-ARC: **2.5 %** to a rival in the chain (forks still hit enemies). Grounded wires shock rivals **2 %/s**. | RECAST: DETONATE: **8 % per wire** touching the rival (max 3 wires counted = 24 %). Lure rivals over your wires. | LIVE WIRE LUNGE: lays wires, which are zone control | High-skill kiter that punishes chasers |
| **HEARTHBACK** (ERUPTION FORTRESS, 170 HP, armor 20) | MAGMA STOMP: painted circle, erupts 0.6 s later for **7 %** + knockback. Fully dodgeable, readable. | SHELL VENT: the shell also stores **PvP** damage taken (60 %, as today). The vent ring scales with the store: **6 % + 0.5 % per stored point**, capped at 25 %. | CALDERA SHOVE: big shove + **6 %** | Counter-puncher: hit it and it hits back harder |
| **BRIARWICK** (AREA CONTROL, 120 HP) | BURR LASH line: **3 %**. Rivals trigger ripe pods: **3 %** + TANGLE (40 % slow, 1 s; CC rules apply). | POP-UP PARK: ring **6 %** + tangle; the pod chain does **3 %** per pod that reaches the rival, max 4 counted | BRAMBLE BOUND: drops pods behind it, a chase breaker | Owns ground and makes fights happen on its turf |

* **Auto-targeting in VS** (after 4:00): if a rival is inside the kit's reach, the auto prefers it. Order: rival →
  open gatekeeper weak point → enemy → city (today's order without the rival is in `targeting.ts:3-10`). During OPEN
  HOUSE rivals are never auto-targeted, so autos keep eating the city.
* **UPROAR vs rivals**: the ultimate hits rivals for **22 % maxHp** × sizeEdge (once per ultimate, whatever the
  pulse count), plus each kit's CC under the CC rules. The roar's invulnerability is unchanged (`titansim.ts:675`).
  Rival damage charges UPROAR like boss hits do (`ULT.bossHit`, `config.ts:1065-1066`): points = 120 × the fraction
  of the rival's maxHp dealt. **[proposal]**
* **Thorns** reflect on rival hits (`damage.ts:406-431`) at 50 % effectiveness, so it isn't a free win against
  rapid-hit kits.
* **Lifesteal** on rival damage: 50 % effectiveness (same reason).

---

## 7. Build slots and drafts in VS: the CARD RAIL

Problem: today a level-up opens a full-screen draft and the sim freezes (`world.ts:114-116`). In a shared match that
would freeze everyone, or kill the player who is drafting. In the 10-minute economy a run held 39-44 drafts
(`config.ts:46`), about one every 15 s.

**The CARD RAIL** (VS only):
* On a level-up, 3 compact cards slide up above the ability bar. **The game never stops.** Keys **1 / 2 / 3** (pad:
  D-pad left/up/right; touch: tap), **R** = reroll (spends the `rerolls` stat as today, `upgrades/draft.ts:17-18`). Each
  card shows only its name, icon, slot tag (NEW / UPGRADE / SHARES A SLOT / ONE-OFF) and one short effect line. The
  full text appears in a tooltip on hover or a long-press.
* **12 s auto-pick**: if the player ignores the offer it picks the bot's choice (`botPickUpgrade`, `_harness/bot.ts:20-21`;
  deterministic). A ring timer drains on the rail. Queued offers show as a "+2" badge and present one at a time.
* **Draft cadence [proposal]**: a draft on every level up to LV 12, then on every 2nd level. That gives roughly 11 +
  12 ≈ 23 drafts instead of ~40, which is fewer decisions to make mid-fight. A level without a draft still grows the
  body and stats as today.
* **Banish and lock are hidden in VS**. One press per decision. The rules are unchanged in solo.
* **SLOT_CAP stays 8** and overflow rewards work as today (`FEATURES_V2.md:938`, `:972-980`). With ~23 drafts the
  slots fill around the end of HOSTILE TAKEOVER [inferred], which makes late upgrades meaningful.
* **Pre-match pick**: during the lobby countdown each player picks 1 starting card from a 3-card offer (a common
  "opening card"), so the first seconds of OPEN HOUSE need no input.
* **Tender chest**: the top bidder gets a rare+ rail (the chest-draft rules, `upgrades/draft.ts:14-16`).
* **Fair pool**: VS uses the **fresh-profile pool**. No locked cards, no profile perks (`RunOptions.meta`,
  `types.ts:629-633`, is sanitized to an empty VS meta). Palettes (cosmetic, `types.ts:931`) stay. A new player's card
  pool is identical to a veteran's. Unlocks stay a solo reward.

---

## 8. Enemies, civilians and repair crews in VS

* **Civil Defense units are ASSIGNED**. The director runs per titan, each with its own spawn ring around its titan
  (`director.ts:125-127`), with budget × **0.6** per titan (PvE is pressure, rivals are the threat) and × 1.3 for the
  FRONT PAGE crown. Each unit has a stripe in its titan's **seat colour**. It hunts and shoots only that titan. Rival
  attacks pass through it, and only its titan gets XP for killing it.
  *Why*: readable (you can see whose war each unit belongs to) and cheap to network: each owner simulates its own
  units, and others render a low-rate cosmetic mirror (the last-circle pattern of simulating your own actor and
  mirroring events, `net.js:13-24`). [inferred: the netcode doc decides how units are mirrored]
* **RAMROD elite**: off in VS (the elite window is a solo pacing beat: `ELITE_AT_S`, `config.ts:951-952`; one per run, `config.ts:22`).
  The tenders take that role.
* **Power-ups** (`FEATURES_V2.md:758-764`) are **shared world items**. The first to touch one takes it; there are
  few, so syncing them is cheap. RED LIGHT freezes only the collector's own Civil Defense units (rivals ignore it, as
  bosses do today). DEMOLITION NOTICE hits only the collector's own units. RUSH HOUR and BACK PAY are unchanged.
  CLEANUP CREW magnets only the collector's own rubble.
* **Rubble is private, the city is shared**. Buildings and floors are one shared, deterministic city (`generateCity`
  from the seed, `world.ts:44`). Breaking floors and collapses are broadcast. The XP pickups a titan's destruction drops
  belong to that titan (rendered only for it). The contest is over **which titan gets the buildings**, especially the
  downtown towers. [inferred: this keeps the sync to building events and avoids syncing up to 600 pickups,
  `config.ts:346`]
* **Repair crews**: on from the first minute in VS, dispatched away from **every** titan (the solo rule uses the one
  titan's view edge, `citysim.ts:87-91`). [inferred: four titans eat about 4× faster. Solo measurements had a single
  titan eating the city down to ~13 % standing floors over ~16 minutes without crews (`citysim.ts:79-81`), so 4 titans
  over 7 minutes (≈ 28 titan-minutes) would empty it without crews. The pacing lane must measure floors standing at
  4:00 / 7:00 with 4 bots.] From 7:00 the crews outside the ring switch to demolition (§5).
* **Civilians**: purely cosmetic already (`render/civilians.ts:3`). Crowds flee from any titan. No change.

---

## 9. Win condition, placement and VS SCORE

* **Winner**: the last titan standing in FINAL NOTICE / LAST CALL.
* **Placement**: 1st = winner; then in reverse elimination order (eliminated later = higher). KOs during HOSTILE
  TAKEOVER don't eliminate anyone.
* **Ties** (same-tick eliminations, or several alive at 10:45): higher HP fraction, then higher VS SCORE, then lower
  seat index (deterministic).
* **Leavers**: a human who leaves is replaced by a bot (the last-circle pattern, `net.js:26-29`), and the human's
  placement for rating is **4th** (deters rage-quits). Stats from their own play still count.
* **VS SCORE** (shown on the end card and used for tie-breaks and stats, never to decide the winner):
  `tonnage leveled (k-tons) + 2 × PvP damage dealt (% of a maxHp, summed) + 150 × evictions + 50 × assists +
  bid share × 300 per tender + 100 × peak Size rank`. **[proposal]**
* **Ratings** (for the leaderboard doc): placement among **humans only** breaks into pairwise results (up to 6 pairs:
  the higher-placed human "wins" each pair). [inferred: the existing RPC takes one 2-player result
  (`0004_game_ratings.sql:59-60`), so it is either called per pair or a new FFA RPC is added; the leaderboard doc
  decides. Bots never move a rating. A human who took over a bot mid-match gets stats but no rating change.]

---

## 10. Bots (fill empty seats)

* **Fill rule**: quick match waits up to **20 s** for humans, then starts with bots in the empty seats (up to 3).
  Private rooms: the host can START at any time, and the rest are bots.
* **Join in progress**: a human can take over a bot seat **until 3:00** (OPEN HOUSE). They inherit that bot's titan,
  level and build, with a "TAKEOVER" banner. This mirrors last-circle's join-by-taking-a-bot-slot (`net.js:26-29`).
  After 3:00 newcomers spectate and are first in line for the rematch.
* **Who simulates them**: the host (FFG pattern, `net.js:17`; `covenet.js:13-17`). A dropped guest's titan gets a
  bot brain on the next tick and keeps fighting.
* **Brain**: today's bot priorities THREAT → BOSS → FOOD → STUCK (`_harness/bot.ts:8-21`) plus three VS layers:
  1. **RING**: in FINAL NOTICE, stay inside the next ring step with a 1 H margin. Leave mortar paint as THREAT does today.
  2. **RIVAL** (after 4:00): engage a rival when `myHP% ≥ engageHp` and `sizeEdge ≥ engageEdge`. Disengage under
     `fleeHp`. Prefer a rival that is already hurt or already fighting someone (third-party), but **anti-dogpile**:
     never become the 3rd attacker on one target unless it wears the FRONT PAGE crown. **Bots never prefer humans over
     bots** (target choice ignores who is human).
  3. **TENDER**: go for a tender when it is closer to me than to at least one rival, or when I am in last place.
* **Difficulty** **[proposal]** (all deterministic; "dodge chance" is a hash of the telegraph id, not an RNG draw, to
  keep the sim reproducible as `bot.ts:3-6` requires):

| Knob | ROOKIE | REGULAR (default) | VETERAN |
|---|---|---|---|
| Reaction delay to new paint | 12 ticks (0.4 s) | 6 ticks | 3 ticks |
| Telegraphs dodged | 40 % | 70 % | 90 % |
| Hook use | on cooldown | in context (`hookDecision` today) | in context + combos (VOLT wires then DETONATE) |
| UPROAR | when full | in fights or a crowd | to finish a rival or escape a KO |
| Engage HP / edge / flee HP | 75 % / ≥ +1 rank / 40 % | 55 % / ≥ 0 / 30 % | 45 % / ≥ −1 / 20 % |
| Hearthback stomp lead | none | half | full |
| Draft | weighted random | `botPickUpgrade` | `botPickUpgrade` + recipe chasing (`bot_draft.ts` +14/+30 rule, `upgrades/draft.ts:61-62`) |

* **Quick-match difficulty**: by the average rating of the humans in the room, when there are logged-in ratings:
  under 1100 → ROOKIE, 1100-1350 → REGULAR, over 1350 → VETERAN [proposal]; guests get REGULAR. VS BOTS practice
  (offline, §12): the player picks.
* **Honesty**: bots are labelled **BOT** on seat cards, the scoreboard and the end card. Bot names are original
  handler call-signs (e.g. "UNIT 9 — LOOSE PERMIT", "UNIT 4 — NIGHT SHIFT"), and bot titans use the default
  palettes.

---

## 11. Spectating, death and rematch

* **EVICTED (4:00-7:00)**: the camera holds on the killer for the 5 s respawn, with a "BACK IN 5" stamp, the KO
  line ("EVICTED BY VOLT-KITE — −2 LV") and the levels lost.
* **Eliminated (7:00+)**: 2.5 s following the killer, then **spectate**. **Q / E** (pad LB/RB; touch: arrows) cycle
  the living titans. Seat cards stay up. A minimap toggle (M) shows the whole ring. **LEAVE** works at any time; the
  placement is already locked and the match result still posts.
* **End card** (a front page, the game's tabloid voice): placement 1-4, each titan's portrait, peak Size, VS SCORE
  line items, the match's headline ("MOLO WINS ZONING DISPUTE IN 9:12"), and earned VS achievements (owned by the
  stats doc).
* **REMATCH**: a button on the end card with a 15 s vote. Humans who vote stay in the same room and seats. The seed
  is new and the biome rotates GRID-EAST → WHITE STACKS → LOCKWATER (`types.ts:42`). A 10 s titan-swap window
  follows. Seats of humans who left are refilled by bots (or by a spectator waiting in the room). If no one votes,
  everyone returns to the lobby. The host starts the rematch. If the host left, the lowest remaining peer id hosts
  [inferred: the netcode doc owns host migration; pirates-cove currently voids a match on host loss,
  `covenet.js:18`].

---

## 12. Readability rules (4 titans on one screen)

* **Seat colours** (4 rings under each titan, independent of titan palettes, so duplicates read): seat 1 coral
  `#ff5a6e`, seat 2 sky `#4dabff`, seat 3 amber `#ffc93c`, seat 4 violet `#b57bff`. Duplicate titans are allowed (any
  pick, no pick conflicts) and the seat ring tells them apart.
* **Nameplates** over each rival: name, LV, Size numeral, HP bar. Off-screen rivals get arrows at the screen edge in
  their seat colour. A rival much smaller than you gets an extra pip so a 5 m titan never vanishes under a 60 m
  camera (the camera frames your own body, `config.ts:455`).
* **HUD**: phase banner and clock at top centre. 4 seat cards on the left (portrait, LV, Size, HP, evictions,
  crown). The minimap always shows rivals, tenders, power-ups and the ring.
* **Rule tells**: the grey NO CONTEST spark (OPEN HOUSE), the white CLEARED rim (CC immunity), and the gold crown
  beam on FRONT PAGE.

---

## 13. What the sim must emit for stats, achievements and leaderboards (handoff to sibling docs)

New `SimEvent`s **[proposal]** (today's union is at `types.ts:500`): `vsPhase {phase}`, `rivalHit {from, to, pct}`,
`evicted {victim, killer, assists[], levelsLost}`, `eliminated {victim, killer, place}`, `tenderSpawn {gate, x, z}`,
`tenderPaid {gate, shares[]}`, `crown {holder}`, `vsEnd {placements[], scores[]}`. Per-match counters for the stats
doc: placement, evictions, assists, PvP damage dealt/taken, tenders bid / top bid, peak Size + time to Size V,
tonnage, the titan played, crown time.

Suggested VS achievements (original names; the stats doc decides): **CERTIFIED HEADLINE** (win a match), **HOSTILE
TAKEOVER** (evict the FRONT PAGE titan), **LOWEST BID WINS** (top bidder on a tender from last place), **ZONED
RESIDENTIAL** (win without being evicted), **FULL HOUSE** (win a match with 3 humans in the room). No negative
achievements.

---

## 14. Build order and acceptance (recommendation)

1. **VS BOTS (offline)** first: the same mode, 1 human + 3 bots, no networking. It proves the multi-titan sim,
   PvP rules, the CARD RAIL, tenders and the ring before any netcode, and players get a playable practice mode.
   Architecture choice for the sim lane [inferred]: the sim holds one titan (`types.ts:604`) and core damage paths
   read `w.titan` (`titansim.ts:672`, `damage.ts:439`). The choice is either a titans-array refactor or one World per
   titan with rivals fed in as actors. The netcode/architecture doc decides.
2. **Online** on top (4 humans max, matching `net.js:5-11`): rooms of 4, quick match that fills with bots,
   join-by-takeover, rematch.
3. **Acceptance [proposal]**, measured with a headless 4-bot VS probe (seeds 1337/7/99 × 3 biomes, REGULAR bots):
   median match end 9:00-10:45 and never past 10:45. Median LV at 4:00 is 14-19 and at 7:00 is 28-35. City floors
   standing at 7:00 ≥ 35 %. Equal-size REGULAR 1v1 TTK median 12-20 s. The FRONT PAGE crown at 7:00 wins ≤ 50 % of
   matches (the leader must be beatable). No match with a 2+ rank gap between 1st and 4th at 7:00 in more than 25 %
   of runs. Solo GATE 2 hashes unchanged (VS code is mode-gated).

---

## 15. Open questions for the owner (defaults above are built unless changed)

1. Elimination in the last 3 minutes (default), or respawns all match long and placement by VS SCORE? Elimination is
   the more dramatic finish and fits "fighting each other".
2. City boss cameo ("MAIN EVENT" playlist) in a later version? Default: no.
3. Team mode (2v2) later? This design works for it unchanged except the win condition. Default: FFA only at launch.
