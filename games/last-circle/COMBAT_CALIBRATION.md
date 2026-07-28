All sim constants confirmed against `royale.js` (lines 53–64, 94–99, 103–107, 123–145, 277–298) and handling confirmed in `weapons.js` (equipSlot 189–209, reload 309–326, vmKick 439–444) and `player.js` (FOV lerp line 1515) this session. Report follows.

---

# Last Circle — BR Calibration Report (vs PUBG / Fortnite, Apex/Warzone corroboration)

**Files audited this session:**
`C:\Users\TestRun\Claude Claw\forgeflow-games\games\last-circle\runtime\sim\royale.js` (WEAPONS 53–64, CONSUMABLES 94–99, MOVE 103–107, CROUCH 123, HEAL 128, STAMINA 135–145, effectiveSpread 169–190, STORM_PHASES 277–298)
`C:\Users\TestRun\Claude Claw\forgeflow-games\games\last-circle\runtime\3d\royale\weapons.js` (equipSlot 189–209, reload path 309–326, vmKick 439–444, recoil recovery 253–262)
`C:\Users\TestRun\Claude Claw\forgeflow-games\games\last-circle\runtime\3d\royale\player.js` (ADS FOV lerp, line 1515)

**Correction to the task brief:** the file's reload values are smg **2.0s**, ar **2.4s**, shotgun **3.0s**, sniper **3.0s**, glauncher **3.2s** (brief said 1.9/2.2/2.6/1.9/2.9). All deltas below use the file values. Evidence confidence: PUBG/Fortnite numbers are wiki-tier secondary sources (pubg.wiki.gg per-weapon pages fetched; fortnite.fandom reached via browser/snippets — direct WebFetch returned HTTP 402); items marked *unverified* were not confirmable from a citable source.

## 1. Delta Table

### Movement

| Mechanic | Ours | PUBG | Fortnite | Verdict | Why |
|---|---|---|---|---|---|
| Base move | 6.0 m/s | run 4.7 | run 5.48 | **KEEP** | Deliberate browser-pacing bump (+9.5% vs FN run). Documented in code comment (royale.js:101). |
| Sprint | 8.0 m/s | 6.3 | 7.39 actual (6.47 avg incl. recovery) | **KEEP** | Only +8.3% vs Fortnite's *actual* sprint; the oft-cited 6.47 is an average over sprint+recovery. |
| Sprint:base ratio | 1.33 | 1.34 | 1.35 | **KEEP** | Effectively exact match to both. The scaling is uniform; the *feel relationship* is authentic. |
| ADS move | 3.8 m/s (63% of base) | ~1.7 (anecdotal) | not published | **KEEP** | Matches Warzone's ~61% ADS ratio (unverified-tier source). No primary source justifies a change. |
| Crouch mult | 0.45x (2.7 m/s) | 0.72–0.76x | 0.76x | **OWNER-CALL** | Matches Apex (0.46x), not PUBG/FN. Code comment shows it was deliberately traded against spreadMult 0.62 (royale.js:111–123). PUBG/FN feel = raise to ~0.72; Apex feel = keep. |
| Swim | 4.0 / 5.6 sprint | 2.9 | 5.49 | **KEEP** | The two references disagree hard (PUBG punishes water, FN doesn't). Our swimSprint 5.6 ≈ FN base swim. Middle position is defensible. |
| Weapon-weight move penalty | none | 0–6.1% by class | none | **KEEP** | Fortnite has no penalty either; skipping it is Fortnite-authentic. Optional PUBG flavor: −5% with AR/sniper out. |
| Sprint stamina | 7.4s sprint / 6.3s refill | n/a | 6.67s / ~6.22s | **KEEP** | Within 11% / 1% of Fortnite. Effectively authentic already. |
| Stealth slow-walk | none (floor = crouch 2.7) | 1.7 walk | 2.0 jog | **KEEP** | Only matters if footstep-audio stealth ships. Reasonable browser simplification. |
| Heal move penalty | 0.45x + sprint blocked | n/a | n/a (Apex: 0.60x + no sprint) | **KEEP** | Mechanic direction corroborated by Apex; ours slightly harsher, deliberate (royale.js:124–128). |

### Weapon handling

| Mechanic | Ours | PUBG | Fortnite | Verdict | Why |
|---|---|---|---|---|---|
| AR 330rpm / 30dmg / 1.5x head | 165 DPS | M416 ~700rpm/40dmg, 2.35x head | AR 330rpm/30dmg/1.5x | **KEEP** | Exact Fortnite clone — this was calibrated, not guessed. PUBG's lane is a different game (0.34s TTK vs our/FN 1.09s). |
| AR reload 2.4s | — | M416 tac 2.4 / full 3.1 | SCAR 2.1 | **KEEP** | Lands exactly on PUBG M416 tactical; between the two feels. |
| SMG 720rpm / 2.0s reload | — | UMP45 667rpm, tac 2.0 / full 2.9 | SMG 720rpm, 1.7–2.0s | **KEEP** | rpm exact FN match; reload matches both games' fast lane. |
| Pistol 400rpm / 1.3s reload / 1.5x head | — | P1911 545rpm 1.7–2.0s; P92 667rpm 2.0s | Pistol 405rpm; pistol class 2.0x head | **OWNER-CALL** | rpm is an FN match. Reload 24–35% faster than any PUBG pistol and headMult 1.5 vs FN's 2.0x — the spawn weapon is slightly off-spec both directions. Buffing head to 2.0x changes early-game balance; not low-risk. |
| Shotgun 80rpm / 5 mag / 9 pellets | S1897: 80rpm / 5 / 9 | Pump: 70/85rpm-ish, caps on head dmg | **KEEP** | Exact PUBG S1897 cadence clone. |
| Shotgun reload 3.0s whole-mag | per-shell 0.635–0.715s, full 4.0s | 4.18–4.62s per-shell | **OWNER-CALL** | Ours is 25–52% faster AND the wrong *mechanism* — every real BR pump reloads per-shell, interruptible. Authentic fix is a mechanic change (~0.7s/shell), not a constant tweak. |
| Sniper mag 1 / 3.0s reload | Kar98k 1.9s cycle, 5 mag, 4.0s full | Bolt-Action reload 3.0/2.85s | **KEEP** | Effective shot-to-shot = 3.0s = Fortnite bolt-action feel exactly. Nominal 35rpm is irrelevant with mag 1. |
| GLauncher 55rpm / 4 / 3.2s | no equivalent | Sticky GL: mag 4, 6.5s reload (*unverified*) | **KEEP** | Thin sourcing; mag matches, reload is arcade-fast. No citable case to change. |
| Weapon swap delay | **0s** (instant, carries fire cd — weapons.js:189–209) | Ready Delay 0.4–0.5s on all 6 fetched pages | Equip times on burst weapons (added to kill double-pump; exact seconds unverified) | **ADJUST** | The single clearest authenticity gap. We already have the anti-double-pump cooldown carry; a 0.4s ready delay is the genre-standard mechanism, both games have one, and it is low-risk (bots included). |
| ADS-in time | **0ms mechanically** — spread halves the same frame (royale.js:174); camera FOV lerps ~300ms visually (player.js:1515, dt×10) | not published | not published (Warzone: AR 240–280ms, SMG ~204ms, sniper 520ms+) | **ADJUST (sniper) / OWNER-CALL (rest)** | Instant full-accuracy scope on the 105-dmg one-shot-headshot sniper is outside every reference (real BRs gate snipers 2–3x longer than ARs). ARs/SMGs at ~instant is forgivable arcade feel. |

### Looting / consumables

| Mechanic | Ours | PUBG | Fortnite | Verdict | Why |
|---|---|---|---|---|---|
| Bandage 3s, +15, cap 75 | 4s, +10, cap 75 | 4s, +15, cap 75 | **OWNER-CALL** | Amount+cap = exact FN; only the 3s vs both-games-4s diverges. Snapping to 4s makes it fully authentic; 3s is a coherent browser-pace choice. |
| Medkit 8s to full | 8s | 10s (Ch5: 1s+9s HoT) | **KEEP** | Exact PUBG match. Sitting on a real data point. |
| Mini shield 2s, +25, cap 50 | n/a | 2s, +25, cap 50 | **KEEP** | 1:1 Fortnite copy. |
| Big shield 4s, +50, cap 100 | n/a | 5s (Ch5: 1s+4s HoT) | **OWNER-CALL** | 1s fast vs classic FN, matches the Ch5 HoT window. Same call as bandage — snap or keep the pace bias. |
| Mid-tier heal | none (3s → 8s gap) | First Aid Kit: 6s to 75 HP | n/a | **KEEP** | Gap finding, not an error. If ever wanted, 6s-to-75 is the canonical slot. |
| Chest open: HOLD 2.0s | n/a (instant crate interact) | instant tap | **OWNER-CALL** | No precedent in either benchmark (both open instantly); it's a deliberate risk/reward friction closer to Apex/Warzone stations. Conscious keep/kill decision, not a fix. |
| Item pickup: walkover/tap | per-item animation (~0.5–1s, unverifiable) | near-instant press | **KEEP** | Matches Warzone exactly, close to FN. Browser-BR norm. |
| Revive | none (solo format) | base unverified (~10s folklore; EMT 3s→8s official) | 10s | **KEEP (N/A)** | Solo game — verified no dbno/revive mechanic exists in runtime. Genre band 5–10s if squads ever ship. |

### Zone pacing

| Mechanic | Ours | PUBG | Fortnite | Verdict | Why |
|---|---|---|---|---|---|
| Phase count / total | 8 phases, 775s (12m55s) | 9 phases, 1950s | 9 circles, 1295–1385s | **KEEP** | Deliberate compression (~1.7x vs FN) paired with deliberately faster movement. Owner already tuned this ("shrinks too much too quickly" correction). |
| Wait:shrink rhythm | 0.82:1 | 1.6:1 | 0.79:1 | **KEEP** | Our rhythm is Fortnite-shaped almost exactly (−4%), just time-compressed. |
| Damage ramp | 1,1,2,3,5,7,9,12 | 0.4→11 %HP/s | 1,1,2,5,8,10 (cap 10) | **KEEP** | Curve shape matches FN; final 12 vs FN cap 10 / PUBG 11 is +9–20% but on a shorter match. Not worth churning. |
| Late-phase waits | phases 7–8 wait 25s/20s | late waits 60–70s | circles 7–9 wait **0s** | **OWNER-CALL** | The one structural divergence: FN's endgame storm never stops moving. Convert wait→shrink (below) to get continuous pressure at zero cost to total match length. |
| Final circle | holds at r≈9.4m, never closes | closes to 0 @ 11%/s after 60s hold | closes to 0 | **KEEP** | Documented design decision (royale.js:286–288 — closing to zero crowned corpses). Our held radius ≈ FN's penultimate circle (10m), so it reads as "FN zone 8, frozen". |
| Damage during wait | previous phase's dps (royale.js:385) | same mechanic | same mechanic | **KEEP** | Already authentic. |

## 2. Animation Timing Notes

The sim emits `reloadStart`/`reloadDone` (weapons.js:311, 323) and the reload is a single uninterruptible timer of `def.reloadS`. Whatever the renderer plays must span exactly these durations, per weapon:

| Weapon | Reload anim must span | Fire interval (60/rpm) | vmKick recovery (kick/6 s, weapons.js:271–274, 444) | Note |
|---|---|---|---|---|
| pistol | 1.3s | 0.15s | ~0.12s | recovery fits inside fire interval — clean |
| smg | 2.0s | 0.083s | ~0.083s | kick decay ≈ fire interval: visually saturates under full-auto, acceptable |
| ar | 2.4s | 0.182s | ~0.125s | clean |
| shotgun | 3.0s | 0.75s | ~0.27s | if per-shell reload is ever adopted, the anim becomes a ~0.7s loop per shell instead of one 3.0s clip |
| sniper | 3.0s | n/a (mag 1) | ~0.32s | **worst gap**: every shot auto-triggers the 3.0s reload; the 0.32s kick reads as the bolt cycling, then the gun sits motionless for ~2.7s. The reload animation (bolt + round insert) should fill the full 3.0s window |
| glauncher | 3.2s | 1.09s | ~0.20s | drum-swing anim over 3.2s |

**Equip/draw:** `equipSlot` (weapons.js:189–209) swaps instantly — the only thing carried is leftover fire cooldown — and the visible mesh arrives asynchronously via `refreshWeaponMesh` (awaits the protos promise), so the model can pop in *after* the weapon is already fireable. If the 0.4s ready delay from the adjust list ships, a raise animation of the same 0.4s hides both the delay and the async mesh swap. PUBG's Ready Delay is 0.4–0.5s on every weapon page fetched.

**ADS:** visual and mechanical timelines currently disagree. The camera FOV converges exponentially at `dt*10` (player.js:1515 — τ=100ms, ~95% zoomed at ~300ms), but the sim grants the full 0.5x spread bonus the *same frame* `input.ads` flips (royale.js:174). The screen says "still aiming in" while the sim already shoots at full accuracy. If ADS ramp-in is added (adjust list), gate the spread bonus on the same progress value the FOV lerp uses so the two can never disagree again — and gate the sniper scope overlay (`scopeState` emit, player.js:1519) on its longer duration.

**Recoil recovery** (weapons.js:253–262, ~0.3s recenter) already matches the vmKick timescale; no change needed.

## 3. The Short Adjust List

Conservative — the TTK core (AR/SMG/pistol rpm+damage, shield model, sniper one-shot-headshot) is verified as an exact Fortnite calibration and is **not touched**.

1. **Weapon swap ready delay: 0s → 0.4s** (new constant, e.g. `readyDelayS: 0.4` consumed in `equipSlot`, weapons.js:189–209 — set `startCd = max(carry, slot.cd, 0.4)`).
   Source: PUBG Ready Delay 400–500ms on all six weapon pages fetched (pubg.wiki.gg M416/AKM/UMP45/S1897/Kar98k/P1911); Fortnite added equip times to burst weapons for the same reason (gamerant.com equip-time coverage). Both benchmarks have this; we have zero. One constant, bots inherit it automatically.

2. **Sniper ADS-in gate: instant → 0.5s** (new per-weapon `adsTimeS`: sniper 0.5; optionally ar 0.25, smg 0.2 later). Gate the 0.5x spread multiplier at royale.js:174 and the scope overlay on ADS progress.
   Source: Warzone sniper ADS 520–650ms vs AR 240–280ms (charlieintel/dexerto, secondary); PUBG doesn't publish ADS times (confirmed absent on every page fetched). Minimum-scope version: sniper only — it's the weapon where instant full-accuracy zoom breaks the genre contract hardest.

3. **Endgame storm pressure: convert late waits to shrink, total unchanged** (royale.js:285–288):
   phase 7 `wait 25, shrink 35` → `wait 10, shrink 50`; phase 8 `wait 20, shrink 45` → `wait 0, shrink 65`. Total stays 775s.
   Source: Fortnite circles 7–9 have 0s wait — continuously moving endgame storm (gaming-tools.com/fortnite/the-storm; fandom table via snippet). Preserves the owner's tuned match length while fixing the one structural rhythm divergence.

4. **OWNER-CALL pair (apply together or not at all): bandage useS 3 → 4, big_shield useS 4 → 5.**
   Source: bandage 4.0s in both PUBG (pubg.wiki.gg/wiki/Bandage) and Fortnite (gamepressure/progameguides); big shield 5.0s classic Fortnite. This makes all four consumables exact matches to a real game (medkit=PUBG 8s and mini shield=FN 2s already are). Skip both if the −1s browser-pace bias is wanted — it is at least internally consistent.
   **✅ APPLIED 2026-07-28 (owner-approved): bandage useS=4, big_shield useS=5 (v160). All four consumables now exact benchmark matches.**

**Crouch RESOLVED 2026-07-28 (owner-approved): speedMult 0.45 → 0.72 (v160) — Fortnite/PUBG walk feel; spreadMult 0.62 accuracy bonus retained.**

**Explicitly not adjusted (deliberate or in-band):** absolute movement speeds (+9% vs FN actual sprint, documented design), 2.0s chest hold (no genre precedent but deliberate risk/reward — owner keep/kill decision), final circle 9.4m hold (documented: closing to zero crowned corpses), shotgun whole-mag reload (authentic fix is a per-shell mechanic rework — flag for a future pass, not a constant tweak), pistol headMult 1.5 vs FN 2.0 (spawn-weapon balance, not low-risk), final storm dps 12 vs cap 10–11 (+9% on a compressed match).

**Sourcing caveat:** all PUBG/Fortnite numbers are wiki-tier secondary (pubg.wiki.gg fetched directly; fortnite.fandom blocked via WebFetch HTTP 402, reached via browser/search snippets, corroborated by pockettactics measured tests). PUBG M416 RPM conflicts across aggregators (638–882); no official Krafton/Epic patch-note tables were reachable this session.