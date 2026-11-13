# Owner decisions on the parity plan (recorded 2026-10-20, owner's words in quotes)

Owner: "yes to all" to the recommendations in PLAN.md section 3, with these changes:

| # | Decision | Recorded answer |
|---|---|---|
| OD-1 | Final circle placement | YES: area-uniform, land-checked placement (F ~0.85); storm timeline unchanged. Bump MAP_GEN_VERSION. |
| OD-2 | Darker, higher-contrast drop view | YES: target mean luminance 0.45-0.50 per map, candidate picked from the P1-G A/B sheet. |
| OD-3 | Squad respawn style | Knock-and-revive (DBNO) - "for squads, this is only in SQUAD mode, not FFA". Solo / free-for-all: a lethal hit kills, no knock state. No beacons. |
| OD-4 | Modes | YES: Duos / Trios (squad modes) with bot teammates; no ranked. |
| OD-5 | Attachments | NO for now ("Skip gun attachments for now"). |
| OD-6 | Gun feel | Per-class ADS time YES. Melee, per-shell shotgun reload, crouch-speed change NO (recommendation). |
| OD-7 | Landing choice | YES: optional big-map waypoint during freefall; auto stays the default. |
| OD-8 | Fall damage | CHANGED: "fall damage should exist naturally" - real HP damage from high falls, scaled by fall height (no damage for ordinary steps, stairs, ledge drops, mantles, or parachute/glider landings; lethal only from very high falls). Plus the landing stagger. |
| OD-9 | Teammate status | YES: inside the existing vitals anchor, no new panel. |
| OD-10 | Paid relay / TURN server | NO ("no paid server right now"). |
| OD-11 | Enemy name tags | YES: only within ~25-30 m or when aimed at. |
| OD-12 | Vehicles / prone | NO vehicles ("no vehicles at this time"); prone no. Others decided after P2 data. |
| NEW | Graphics settings | "in settings we can have low, med, high, ultra graphics": four presets LOW / MEDIUM / HIGH / ULTRA in the Video settings, plus auto-pick on first run and the in-match ladder. ULTRA = the best the game can look (full DPR, SMAA, highest shadow/foliage/draw distances, bloom). |
| NEW | Performance | "the FPS is bad on my PC but im sure it will be fine on my mac or others pc's just ensure you can get it to its best": optimise to the best achievable frame time on every tier; the dev box's UHD iGPU is the worst case, not the target to cap quality at. |

## Applied from the P1-G decision pack (F:/lc_p1/P1-G/DECISIONS.md, 2026-10-20), within the owner's "yes to all"
- OD-1: use F = 1.0 (full area-uniform range), not 0.85 - at 0.85 Isla Viva misses the plan's own p50 >= 150 m bar (146 m); F 1.0 gives 164 / 186 / 189 m. STANDARD mode only; Quick Match keeps today's rule (the same rule would stretch its storm from 299 s to 352 s median). Removes today's ~1-in-10 Deepwood river finals (192 of 2000 seeds -> 0).
- OD-2: grade G2 "Balanced" (ground and water ~40 % darker plus a small exposure cut; sun and fill unchanged), drop-view mean 0.45-0.50 per map; measure Deepwood on its forest half; interiors must stay at or above a mean of 0.15 (today 0.20-0.30).
