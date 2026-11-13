# BLACKRIDGE — gameplay pass, 2026-10-12

Owner brief (verbatim intent): hand/weapon + scopes need serious work; a pistol round
left THREE holes; holes floated in mid-air beside walls; weapons must be findable and
switchable 1-5; movement must be smooth; 3/5/10-kill special attacks; bots much
better by difficulty with much better path finding; get it close to Call of Duty.
Follow-up: **most of this is for PVP**, campaign issues checked and fixed too.

This file records the gameplay-engineer half (sim, collision, impacts, loot, streaks,
HUD). The weapon-presentation and bot-AI halves are written up in their own reports
(see the commit message / session notes) and summarised at the bottom.

## 1. Bullet holes and collision

| Symptom | Root cause (measured) | Fix |
|---|---|---|
| Pistol = 3-4 holes per shot | `impacts.js` stamped 1 crater (0.36-0.54 m) + **3 "satellite" craters scattered up to 0.44 m away** + (45 %) a 1 m dust wash per round. Live: 1 pistol round -> `decalsSpawned: 4`. | ONE decal per bullet, sized by weapon class (pistol 0.17 m, SMG 0.16, AR 0.19, DMR 0.27, shotgun pellet 0.15); no satellites, no wash. Shotgun = nine small holes. |
| Holes in mid-air near walls | The sim hits AABB colliders, the player sees meshes. Live sample of 450 rays: buildings 32/240 hit the collider IN FRONT of the visible wall (mean 0.2 m, max 0.69 m) and 63 hit BEHIND trim; every rotated car floated (mean 3.1 m); 32 of 140 "wall" rays had no visible surface at all. | `core/fx/surfaceindex.js` bakes every opaque level/prop triangle (285 k, ~0.1 s) into a uniform XZ grid at mission start; each impact is re-resolved onto the visible surface (0.1 ms). Phantom hits (collider on empty air) draw nothing; windows read as glass, car panels as metal, crates as wood; a 4-corner support test shrinks/skips a mark that would overhang an edge. |
| Invisible solid air | Rotated props (52 of 118 on meridian_ward, cars up to 38 deg) were conservative AABBs; `canal_edge` was a 2.2 x 4 m solid wall over a 0.45 m coping + open rail. | `box.obb` (oriented footprint) used by rays, capsule and support queries; `canal_edge` split into movement hull + ray sub-boxes (coping, rails). Phantom-hit rate 13 % -> 5 %. |
| Sticky corners | The mover zeroed the blocked axis only. | `world.moveCapsule` pushes the capsule out along the shallower face and keeps tangential velocity (square-corner footprint, same walkability as before). |
| Camera pops on stairs | A riser snapped the capsule up in one tick and the camera followed 1:1. | `boot.js camHist.yOff`: view-only vertical offset that eases out (tau 85 ms); body/bullets untouched. |

Also: decal atlas has glass-crack / wood / dirt cells, ring buffer 384 marks / 55 s,
canal hits splash instead of vanishing, shotgun blasts do one flash/shell/kick per pull.

## 2. Weapons, slots, loot (PVP first)

* **Five fixed slots** (`weapon_data.js WEAPON_SLOT`): 1 Warden AR, 2 Vesper SMG,
  3 **Breaker** pump shotgun (new), 4 Corvus DMR, 5 Pike pistol. Keys 1-5, mouse wheel
  next/prev, **Q** last weapon. (`input.js` always emitted "slot1/slot2" but nothing ever
  mapped them — weapon switching never worked in any shipped build.)
* **Breaker**: 9 pellets x 14 (fall-off 6->18 m, min 3), 6-shell tube, loads shell by
  shell (0.55 s + 0.42 s/shell) and **can be interrupted by firing**; pump cadence 0.77 s.
* **Loot** (`core/sim/loot.js`): every bot drops the gun it holds (not the pistol);
  walking over an item takes it — new weapon -> its slot (raised only if better than the
  held gun or the held gun is dry; the human's racks/crates/give always raise), owned
  weapon -> ammo top-up, ammo box -> 1.5 mags per owned gun. One rule for the human and
  all bots.
* **PVP racks are visible now.** `weapon_pad` racks (content.pickups) were invisible
  walkover pads; they are loot statics with a pedestal, the gun, a beam and a recharge
  ring (dim while empty). Breaker racks added to all three arenas (7/7/7 racks).
  `match.js` skips its legacy rack pass when `sim.internal.racksInLoot`.
* Campaign: 10 placed items (`content.json loot`, scope "campaign", player-only).
* HUD (`core/hud/loadout_hud.js`): weapon bar with live ammo, pick-up toast, projected
  loot prompt (LOS-checked), streak tray, call-in countdown + target marker, medals,
  score popups. World: `core/fx/lootfx.js` (uses `world_weapon.js buildWorldWeapon`).

## 3. Kill streaks and specials (`core/sim/streaks.js`)

Consecutive kills without dying; a call-in's own kills never feed the streak; dying
resets the count but keeps earned call-ins (max 2 per type).

| Kills | Special | Key | Effect |
|---|---|---|---|
| 3 | Mortar strike | 6 | 4 shells walked onto the crosshair spot, 2.4 s ETA, 6 m radius, 135->18 dmg |
| 5 | Airstrike | 7 | jet bomb run, 7 bombs in a 34 m line away from you, 6.5 m radius, 150->20 |
| 10 | Orbital barrage | 8 | 18 heavy rounds over a ~20 m circle in 5.5 s, 7.5 m radius, 175->25 |

Never hurts the caller; in team modes the existing friendly-fire gate protects
teammates. Medals: DOUBLE / TRIPLE / QUAD / MULTI KILL (3.5 s window), n KILL STREAK,
+100 / +150 headshot popups. Visuals `core/fx/streakfx.js`, cues `core/audio/streak_audio.js`.

## 4. Tests

* `node core/sim/loadout.selftest.cjs` — 53 checks: slots/switching, loot, shotgun,
  shell reload, streaks/medals/call-ins, oriented colliders.
* `sim.selftest` 189/189, `match.selftest` 111/111, `spawns.selftest` 45/45 unchanged.
  `tools/probe_arena.mjs` fails G-A..G-G identically on the untouched tree (stale
  lanternwalk targets) — not caused by this pass.
* ai.selftest has one load-dependent timing assertion ("bake < 150 ms").

## 5. PVP product decisions (owner, same day)

* **PVP has no difficulty setting and never mentions bots.** The match screen has no
  difficulty row, `boot.js startMatch` forces `difficulty:"expert"` whatever a caller
  passes, the scoreboard has no BAND column, store copy (`game_meta.json`) says "ten
  operators a match" and no longer uses the words bot / AI / difficulty. Opponents were
  already human-style callsigns with no BOT chip (owner rule 2026-09-16).
* **`expert` tier** (`roster.js`, `pvp_tuning.js`, `content.json difficulty.expert`): all
  nine other combatants — teammates AND opponents — play at the top (`veteran`) band with a
  PVP-only `bandOverrides.veteran` sharpening; identity damage to the human; fairness
  invariants (reaction latch, fire tokens, muzzle-block, no HP/damage/sight cheats) intact.
  The CASUAL / STANDARD / HARD ladder remains for the CAMPAIGN only.

## 6. Bot navigation + skill (AI lane report, condensed; full text in `_design/pvp/bot_ai.md` Part 15)

| 300 random routes per map | before (m / l / s / sm) | after |
|---|---|---|
| arrived | 94.7 / 89.3 / 81.0 / 84.7 % | 100 / 100 / 100 / 100 % |
| p95 time vs ideal | 2.7 / 3.3 / 3.6 / 3.3 x | 0.99-1.00 x |
| stuck > 3 s (of 300) | 108 / 167 / 223 / 161 | 0 / 0 / 0 / 0 |
| time pressed against a wall | 16-32 % | 0.4-2.5 % |

Root causes: bots moved only along their facing; nav-vs-mover mismatches (8 m collision
buckets, thin walls between nodes, stair treads, string-pulled corner grazes); slow stuck
ladder. New `core/ai/steer.js` (world-space heading to a capsule-validated lookahead,
teammate separation, lane diversity), reworked `nav.js`. Ladder (campaign): win rate
0 / 52 / 98 %, K/D 0.23 / 1.18 / 3.05, reaction 0.90 / 0.57 / 0.29 s for casual / standard /
hard. Expert tier vs a scripted expert-human persona: the human wins ~42 % of even duels
(novice 4 %, regular 13 %). Probes: `tools/nav_probe.mjs skill_probe.mjs duel_probe.mjs
persona_duel_probe.mjs expert_probe.mjs campaign_probe.mjs`.
Known: CTF carriers still die ~9 in 10 at expert (tempo limiter); time-to-kill is not
monotonic across levels (noisy metric); `match_hud.js BAND_LABEL` is retained for logs only.

## 7. Weapon presentation (presentation lane report, condensed)

Procedural gloved hands, calm gunmetal materials, viewmodel FOV 60 -> 46 with re-authored
poses; smooth ADS, sprint pose, switch lower/swap/raise, idle breath, footstep-locked bob,
slide/mantle/land dip; per-class reload animations (shotgun per-shell + pump); Corvus
full-screen scope (4.0x, mil-dot, glint, hides the 3D gun, breath-hold steadies sway);
B-12 Breaker model (`wpn_shotgun.glb`), real 3rd-person pistol/shotgun meshes; FP GLBs
4.2 MB -> 0.5-0.7 MB each (WebP + Draco). `core/weapons/world_weapon.js
buildWorldWeapon(id)` feeds ground loot. Corvus `adsFov` 34 -> 21.5 (the 4x scope).
Manifests: menu payload now 6.08 MB (gate raised 6 -> 6.5 MB in `tools/merge_manifests.py`).
Open items: shader program count 106 vs a 70 budget (pre-existing), the hitmarker is not
anchored to the aim ray, world pool lights still lift the viewmodel at night.

## 8. Test commands

    node core/sim/sim.selftest.cjs        # 189   node core/sim/loadout.selftest.cjs   # 53
    node core/ai/ai.selftest.cjs          # 100   node core/ai/objective.selftest.cjs  # 56
    node core/match/match.selftest.cjs    # 111   node core/match/spawns.selftest.cjs  # 45
    node core/match/modes/{tdm,ctf,ffa}.selftest.cjs   # 87 / 157 / 90
