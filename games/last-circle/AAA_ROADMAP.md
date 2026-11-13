# LAST CIRCLE → AAA / FINAL DROP: THE OWNER'S ROADMAP

## 1. HONEST HEADLINE

Last Circle is already a genuinely good browser BR — **11 of 16 benchmark dimensions sit at parity-or-better vs Final Drop**, and the systems layer (menu depth, inventory, practice, progression architecture, netcode design, load engineering) is done and hardened over ~110 fix rounds. It is **not** far from *beating Final Drop*: that gap is now almost entirely a **raster-art layer** (the entire game ships with zero image files — every visual is CSS gradient, OS emoji, shader math, or flat-shaded primitive), a **handful of pure-code rendering upgrades that need no asset at all**, an **animation/retention content refill**, and **one critical multiplayer bug**. All of that is reachable in a focused week. What is **not** reachable in a 20 MB browser build, and should not be chased: photoreal PBR with hundreds of dynamic lights, HRTF/recorded voice acting, and dedicated-server multiplayer (60–100 real players, authoritative lag-comp/rewind, anti-cheat). The serverless 4-humans-+-46-bots model is a *correct, deliberate* design point, not a deficiency — leave it. **Bottom line: parity-and-beyond vs Final Drop is a one-week push; true AAA is a different budget class and mostly a ceiling to acknowledge, not close.**

---

## 2. BUGS STILL PRESENT (ranked by severity)

| # | Sev | Bug | File:line | Effect |
|---|-----|-----|-----------|--------|
| 1 | **CRITICAL** | Host departure unhandled — guests get no signal when host leaves; `bye` is gated to `isHost` so guests ignore it, watchdog is host-only, and no `net.on('error')` is registered mid-match | `net.js:408-417`, `net.js:560`, (missing handler in `enter()`); `ffg_netplay.js:90` | All ~46 host-simulated bots freeze, host avatar freezes, clock stops — guests stranded in a dead match with no "host left" screen |
| 2 | **CRITICAL** | Outbound budget can't prevent host disconnect at 4 humans — `state`/`bots`/`hitYou`/`died` are all in `CRITICAL_MSG` and bypass shedding; only cosmetic `ev` traffic is droppable | `net.js:109`, `net.js:6-12`, `net.js:569-589` | A busy host billed ×3 receivers can push past Supabase's 100 msg/s ceiling → Supabase **drops the connection** (the exact failure the budget exists to prevent) |
| 3 | MED | Grenade-launcher projectile mesh leaks onto reused bullets — pool is shared LIFO, `kill()` removes `p.m` from scene but never nulls it; line 491 re-shows any leftover mesh | `weapons.js:487-491`, `weapons.js:534-537` | After firing the GL once, the next pistol/AR/SMG bullets drag a green/orange sphere along their flight path. Intra-match reproducible |
| 4 | MED | `stepMarks` Map is module-level, keyed by reused actor id, stores `W.t`, and is never reset between matches | `hud.js:2037`, `hud.js:2068-2070` | On match 2+ the throttle `W.t - last < 1.4` is permanently true — footstep-direction chevrons never render for the rest of the session |
| 5 | MED | Loot pickups and storm/supply alerts share ONE DOM node (`flashMsg`→`R.stormMsg`) with one 2600 ms timer | `hud.js:2486-2491`, `2448-2458`, `2460-2461`, `2476-2482` | Rapid pickups clobber each other (last-write-wins), a storm warning stomps or is stomped by a pickup line, and a legendary pickup is visually identical (same purple) to a storm alert |
| 6 | MED | No mid-match rejoin — a dropped guest's slot is frozen to a bot; a returning peer gets a new id with no slot mapping | `ffg_royale3d.js:348-365`, `net.js:408-421` | A wifi blip permanently demotes a friend to a bot for the rest of the match |
| 7 | LOW | Bot heal-retreat is dead code — reads `bb.lastThreat` (never assigned) and `bb.target.pos` (target is an id string → undefined), so `away` is always null | `bots.js:586` | Bots stand motionless in the open for the entire heal channel (up to 8 s), contradicting the fix the comment at `bots.js:579-585` claims. Correct field is `bb.targetPos` |
| 8 | LOW | Farthest ranging label culled where used — dummies are `isBot:true` so nametags cull at 70 m, but the 80 m dummy sits ~80–85 m from spawn camera | `player.js:809-810` | The single most useful long-range ranging marker's "80m" label never displays. Fix: exempt `a.isDummy` from the bot cull |
| 9 | LOW | Menu clips on short viewports — layer is `overflow:hidden`, center stack is `justify-content:center` with no scroll | `hud.js:536`, `hud.js:555-558` | On ≤800px-height laptops / mobile-landscape, the XP strip + daily-challenges block get pushed off the top edge with no way to scroll to them |
| 10 | TRIVIAL | HUD announce/indicator DOM leaks across matches — `annWrap`/`_annQ` timers and `inds` array hold references to nodes detached by `hideHUD` | `hud.js:2527-2534`, `hud.js:2036`, `hud.js:1737` | Harmless (no visible effect, tiny leak); callbacks run against detached nodes |

All other lenses (character-models, weapon-viewmodels, vfx-juice, audio-polish, performance-load, world-art rendering) reported **no functional bugs this pass** — only the cleanup items folded into the fix queue below.

---

## 3. FIX QUEUE — PURE CODE (no asset spend)

Ranked by tier. Effort S/M/L. Everything here is code the owner is *not* paying an asset budget for.

### P0 — Bugs (fix first)
| Fix | Eff | Anchor |
|-----|-----|--------|
| Host-departure: guest-side watchdog → tear down net, flip remote bots to local brains via `botsMod.attachBrain`, keep player, show "Host left — finishing solo" toast (local continuation; skip fragile true host-migration) | **M** | `net.js` update loop; `ffg_netplay.js` |
| Register `net.on('error')` + "Reconnecting…" overlay when SYNC age > ~2 s / on CHANNEL_ERROR, routing to the same local-continuation path | S | `net.js enter()`, `hud.js:1752-1753` |
| Grenade mesh leak: null `p.m` in `kill()`, or gate the show at line 491 on `o.mesh` | S | `weapons.js:491`, `534-537` |
| Reset `stepMarks` at match start | S | `hud.js:2037` / `showHUD` |
| Split pickup feed from storm node (see inventory feed below) | M | `hud.js:2448`, `2486-2491` |
| Bot heal-retreat: read `bb.targetPos` not `bb.target.pos` | S | `bots.js:586` |
| Exempt `a.isDummy` from 70 m nametag cull | S | `player.js:809-810` |
| Menu `wrap`: `overflow-y:auto` + `justify-content:flex-start` below a height threshold | S | `hud.js:555-558` |

### P1 — Highest-leverage de-flatten (pure code, no art needed)
| Fix | Impact | Eff | Anchor |
|-----|--------|-----|--------|
| **IBL / `scene.environment` via PMREM** — render the existing sky dome through `PMREMGenerator.fromScene` once per map; then let steel/cars/containers/weapon barrels take `metalness>0`. *Highest value-per-effort item in the whole world lens; needs zero generated art.* | **HIGH** | `maps.js:270/403/1651`, `weapons.js:167` |
| **CSM cascaded shadows** — swap the single `DirectionalLight` shadow (±80 m, ~55 m coverage) for `three/addons/csm/CSM.js`, 3–4 cascades to ~400 m; respect the sun-vector/offset coupling | **HIGH** | `ffg_kernel_3d.js:74-78`, `maps.js:22-24` |
| **Chromatic-aberration ShaderPass** on hit — composer already exists (RenderPass+UnrealBloom+Output); add a channel-offset pass driven by the hit event | **HIGH** | `ffg_kernel_3d.js:153-168` |
| **ADS shoulder pose** — add `POSES.adsAim` (arms tighter, receiver to eye line) selected when `a.input.ads`; today ADS only changes camera dist/FOV, body never shoulders | **HIGH** | `player.js:1221-1223`, `pose.js:103` |
| **Hit-react flinch** — decaying additive spine/shoulder rotation on `actorHurt`, layered on the existing after-mixer pose pass (only a color flash exists today) | **HIGH** | `player.js:1461`, `fx.js:139` |
| **Reload procedural motion** — drive `a.weaponMesh` dip+tilt and cycle the reload sub-pose over `weapons.js reloadT`, synced to the audio timers (currently a static held pose) | **HIGH** | `pose.js:119`, `weapons.js:308-323`, `audio.js:512-526` |
| **Character far-LOD** — cull/swap bodies past ~90 m (see perf section; decimation is a build step, not Meshy) | **HIGH** | `player.js:790-803`, `1168` |

### P2 — Retention systems (pure code; the reward-track content refill needs Meshy — see §4)
| Fix | Impact | Eff | Anchor |
|-----|--------|-----|--------|
| **Achievements/medals** — localStorage medal tracker off existing career counters + a medal grid in `showCareer`; ships with emoji placeholders, stays fully local (respects no-SDK/DRAFT). The `hooks.achievement(...)` call sites already exist but are inert | **HIGH** | `hud.js:2763-2767`, `2888`, `ffg_royale3d.js:113` |
| **Cosmetic recolor tiers** — add a `tint` field to `MENU_SKINS`, multiply `material.color` on rig load → ~10–15 low-cost unlock tiers for $0, pacing the reward track | **HIGH** | `hud.js:129-135`, `168`, `919` |
| **Skill/competitive ladder** — derive a Bronze→Champion rank from rolling avg placement/win-rate (already tracked at `career.placementSum`), shown beside the level rank | MED | `hud.js:158-160`, `2912` |
| **Seasonal cadence** — wrap XP in a season object (start/end + "SEASON ENDS IN Nd" line); surface the unlock-reset policy to owner before shipping | MED | `hud.js:1480-1490`, `611` |
| **Weekly/mastery challenges** — off existing `career.mapWins`/`killsByCls` ("Win on all 3 maps", "kill with each weapon class") | S | `hud.js:1440-1455`, `1491` |
| **Own-elimination screen pop** + **crit damage-number scale-pop** (`dmgNumber` scale param already exists, every call passes literal 1) + **winning-kill slow-mo ramp** (timescale plumbing exists) | MED/LOW | `hud.js:2401-2434`, `fx.js:323/375`, `ffg_royale3d.js:494-497` |

### P3 — Structure / perf / feel (pure code)
| Fix | Impact | Eff | Anchor |
|-----|--------|-----|--------|
| **Dedicated stacking pickup feed** — reuse the kill-feed pattern; up to 4 rows tinted by `RARITY_COLOR`, own fade timers; leave `R.stormMsg` for storm/supply only (fixes bug #5) | MED | `hud.js:1646`, `2448` |
| **Frustum-chunk foliage** — split each per-kind `InstancedMesh` into an 8×8 grid so off-screen chunks frustum-reject (currently the whole 1600 m map submits even pointing at sky); then density can rise | MED | `maps.js:1749-1760` |
| **meshopt GLB compression** — `gltfpack -cc` over `assets/chars/**` + `assets/props/**`, register `setMeshoptDecoder`; geometry (not texture) dominates each GLB, ~3–5× smaller match-start download | MED | `ffg_kernel_3d.js:85` |
| **Snapshot interpolation buffer** — 2-entry buffer, render ~100 ms in the past (or extrapolate along derived velocity, clamped); single biggest smoothness win under jitter | HIGH | `player.js:1241-1270`, `net.js:515` |
| **Delta-encode bot snapshots** + drop bot rate to ~6–7 Hz at H≥4 — adds headroom so the 4-human roster need not shrink (mitigates bug #2) | HIGH | `net.js:569-589` |
| **Predicted kill-confirm** on host-simulated bots (reconcile against authoritative `died`) | MED | `net.js:379-407` |
| **Rarity-tinted hotbar cells** + **ammo-type color coding** (both peripheral-vision reads) | MED/LOW | `hud.js:2181`, `1833`, `2207` |
| **Per-weapon stats card** in practice (all numbers exist in `K.WEAPONS`) + **per-distance range breakdown + reset + optional strafing dummies** (`attachBrain`) + **add SMG to practice kit** | MED | `royale.js:52-64`, `hud.js:1867-1873`, `player.js:488-492` |

### P4 — Cheap polish & dead-weight cleanup (pure code)
- **SVG icon set** replacing OS emoji (⚔ ⚡ ◎ 🌐 ⚙ …) — a shared `icon(name)` helper; crisp at any DPI, OS-stable, zero bytes. **Do NOT spend xAI on this** (`hud.js:654` etc.).
- **Tab-sectioned settings** (Gameplay/Audio/Video/Controls/Account) — groups already exist as contiguous blocks (`hud.js:2979-3153`).
- **Film-grain + vignette overlay** on the menu (marries future raster art to the WebGL frame).
- **Idle breathing/weapon-sway** (phase-offset per actor) + **landing squash** on airborne→ground.
- **Rarity-colored loot beam** (only chests get a fixed-gold beam today).
- **Multi-zone reverb** scaling by enclosure size + **distinct milestone stingers** (both audio, pure code).
- **Defer emote clips off match-start critical path** (~1 MB) + **gate `preserveDrawingBuffer` behind a QA flag** + **drop redundant legacy `wpn-pistol/shotgun.glb` loads** (~150 KB).
- **Delete dead weight**: 15 `*_idlearmed/_walkarmed/_runarmed` GLBs (~776 KB, `player.js:153`) + `runtime/3d/waternormals.jpg` (243 KB, referenced nowhere).

---

## 4. MESHY SHOPPING LIST

All costs **rough — confirm against current Meshy character/animation pricing before ordering.** Smart-topology (`reference_meshy_smart_topology`) means the 5 skins share bone names, so retargeted clips reuse the existing rig.

| # | Job | Tool / spec | Credits (rough) | Plug-in |
|---|-----|-------------|-----------------|---------|
| 1 | **Animation pass — 2 deaths + 6 emotes** (batched, all 5 skins) | Meshy `/openapi/v1/animations` library action_ids: 2 death/knockdown (fall-backward, spin-down) + 6 emotes (backflip, salute, floss/dance-2, facepalm, point-and-laugh, victory-flex). Retarget onto the 5 **original** meshes via `pipeline/retarget_clips_v3.py` (world-space, keep mesh). SAFE — full-body, pose layer is OFF on death/emote. | **~145** (batched: 5×(5cr re-rig + 8×3cr) = 145) | `MESHY_CLIPS` + `classifyClips` (`player.js:153,396-399`); death random-pick at `player.js:1494`; `EMOTES` gate table beside `MENU_SKINS` wired into `rewardTable()` (`hud.js:129,168`); replace hardcoded B/N with a radial **emote wheel** (`player.js:606`) |
| 2 | **Practice dummy target** | Meshy t2m, **textured, smart-topology** (same skeleton → existing idle/hit/death clips retarget free). Prompt: *"humanoid ballistic-gel / straw practice dummy on a low weighted stand, matte neutral body, bright high-contrast concentric scoring rings on chest and head, no arms."* 1 model. | **~150–250** | Branch on `a.isDummy` in `loadActorModels` (`player.js:506-513`). **Cheaper alt: skip Meshy, use 1 xAI bullseye decal texture on the existing skin torso/head** (~$0.03) — see §5 |
| 3 | **Hero scenery landmarks** (cosmetic, no interior) | Meshy t2m textured, ~15–25 cr each: rusted gantry crane superstructure, stone volcano shrine/idol, fire-lookout radio mast, wrecked bush plane, monument/obelisk. **NOT the enterable lighthouse/steeple/tower — those stay procedural (you fight inside them).** | **~100** (5×~20) | Clone-place like the sky-island crystal path (`maps.js:1919-1935`). +~2 MB |
| 4 | **Biome prop variety** (low-poly) | Meshy t2m textured, ~10–20 cr each: saguaro/agave, dead + snow-laden conifer, fern/undergrowth clump, 2 boulder variants, banana plant, wrecked-car variant. ~8 props, keep each ≤~350 KB. | **~120** (8×~15) | Add a `kind` + `scatterTrees` call — the instancing loop already handles arbitrary kinds/colliders/HP (`maps.js:765,1729-1788`). +~2.5 MB |

**Core recommended Meshy total: ~515–615 credits** (~365–465 if the dummy is done via xAI decal instead of a Meshy model).

**Optional / defer (not in core):**
- **2–3 hero skin retextures** for top-of-track showcase unlocks (Meshy "retexture existing model": *"ornate gold-plated armor"*, *"carbon-fiber matte"*) — ~30–60 cr each (~90–180 total). Use sparingly; flat `tint` recolors (pure code) cover most tiers for $0.
- **Reload clip pilot** — retarget ONE library reload clip on ONE skin (~8 cr) to test whether arms fold before committing; the pure-code reload motion (§3 P1) is the recommended first choice.
- **Brass casing GLB** (~10–15 cr) — **SKIP**; the cube is invisible at gameplay range.

> Note on emote credits: the progression lens optimistically states one clip "retargets to all 5 for free"; the character-models lens accounts per-skin re-rig (`retarget_clips_v3.py`, 5 cr) + per-clip (3 cr). I've budgeted on the **conservative per-skin model (~145 cr)** — smart-topology may bring it lower; confirm at order time.

---

## 5. XAI (GROK) SHOPPING LIST

All cheap (auto-topoff is $1 per `reference_xai_image_gen`). **Total for the full high+medium set is under ~$3; the essential set is well under $1.** Grok output is opaque (no alpha) — use **black backgrounds for additive FX** (the trick the existing blast flash already uses) and derive normal maps in-code via the existing Sobel path.

### FX sprites & decals (highest juice-per-dollar — consolidate weapon + vfx lenses into one order)
| Asset | Prompt / spec | Cost | Plug-in |
|-------|---------------|------|---------|
| **Muzzle-flash flare sheet** | 512×512, **black bg (additive)**, 2×2 or 3×1 rotational variants: white-hot core, 4–6 unequal radial yellow/orange petals, faint blue-white smoke wisp | ~$0.07 | Pool AdditiveBlending Sprites mirroring `ensureBlasts`; spawn in shot-fired handler, replace the 6-cube burst (`fx.js:104-124,160-164`) |
| **Explosion fireball core** | 1024×1024, black bg, hot orange-white radial with wispy flame tongues | ~$0.07 | Second pooled Sprite/Plane pool in `fx.js init()`, spawn from explosion handler (`fx.js:220-235`) |
| **Radial spark burst** | 1024×1024, black bg, thin yellow-white streak rays from centre | ~$0.07 | Same pool, impact/explosion handlers |
| **Bullet-impact decal atlas** | 1024×1024, 2×2, transparent (or white-luminance): concrete hole+cracks, metal pockmark+bright rim, splintered wood, dark scorch ring | ~$0.07 | ~32–64 pooled `PlaneGeometry` quads, `alphaTest`, `polygonOffset`; orient to surface normal on impact (`fx.js:215`), pick cell from the surface tag already on the event, fade over ~8 s. Skip 'flesh' |

### Menu key-art (first-screen, high attention)
| Asset | Prompt / spec | Cost | Plug-in |
|-------|---------------|------|---------|
| **Menu skybox** | ~2048×1024 wide golden-hour tropical cloudscape, warm amber horizon → deep blue zenith, soft cumulus, no horizon objects, no text. Orient the equirect seam behind the camera's dominant orbit arc | ~$0.10 (3–4 tries) | `TextureLoader` → `W.assetBase+'assets/ui/sky_menu.jpg'`, set as `skyGeo` map / `scene.background`; keep shader as fetch-fail fallback (`hud.js:266-279`) |
| **Mode-card banners (×3)** | ~640×220 each, dark/low-contrast so white text stays legible: (1) BR = ~50 parachutes on a golden island; (2) Quick Match = close-quarters muzzle-flash firefight; (3) Practice = calm range with target dummies | ~$0.30 | Absolutely-positioned `backgroundImage` under each card `row` with a left-dark gradient scrim (`hud.js:655-700`) |
| **Logo / emblem mark** | ~1024×1024 → 110 px, circular concentric-rings / crosshair-in-circle insignia, navy + cyan-to-violet brand gradient, metallic edge, transparent/flat-dark bg, **NO lettering** (keep the crisp CSS wordmark) | ~$0.10 (3–4 tries) | Prepend `<img>` to `titleBlock` above the wordmark; reuse as favicon + top chrome bar (`hud.js:548,561`) |
| **Locker backdrop** *(optional, low)* | ~560×560 dark dropship-bay, heavy vignette, brand-blue rim light, no characters/text | ~$0.10 | `stage` `backgroundImage` behind the transparent preview canvas (`hud.js:781`) |

### World textures (kill the "still procedural" tell)
| Asset | Prompt / spec | Cost | Plug-in |
|-------|---------------|------|---------|
| **8 structure albedos** | seamless-tileable 1024×1024 JPEGs: painted wood plank siding, poured concrete panel, corrugated sheet metal, adobe/sandstone stucco, red barn board, grey stone masonry, roof shingle/clay tile, glass-curtain/mullion facade | ~$0.24 | Tag `addBox`/structure generators with `mat`, key `batches` by `color\|mat` (`maps.js:548-554`), look mat up in a `{mat:{map,normal}}` table in the merge loop (`maps.js:1654-1666`). Normals derived in-code (Sobel). +~1.8 MB |
| **3 cloud sprite sheets + 1 horizon band** | transparent 1024×1024 cumulus (bright tropical / golden savanna / cool cirrus-snow) + one 2048×1024 horizon cloud-band strip | ~$0.15 | Swap `cloudTex` per map (`maps.js:467`), add horizon band as a faint second layer above the dome horizon stop. +~1 MB |
| **6 ground-detail albedos** | seamless 1024×1024: grass, dry-savanna grass, sand/dune, rock/gravel, forest leaf-litter, snow | ~$0.20 | Per-map dominant detail → terrain `material.map` (`maps.js:383-388`); normals via Sobel. +~1.2 MB |
| **Shoreline foam** *(low)* | seamless 1024×1024 foam/wave-crest alpha | ~$0.03 | Thin foam ring where `\|heightAt0 − waterY\|` is small (`maps.js:396-428`). Much of the water win comes free once IBL lands |
| **Practice-dummy decal** *(alt to Meshy #2)* | tileable bullseye / concentric scoring-zone decal | ~$0.03 | Apply to existing skin torso/head material — pure-code plumbing |

### Optional icon/UI batches (ship emoji first; replace only if you want the polish)
- ~24 medal/badge icons, ~8 rank emblems, 5 ammo-type pictograms, 4 flat consumable icons, 1 season banner — 128–256 px transparent, one batch each. **All optional; none required for parity.** **Do NOT use xAI for the menu iconography set — that is pure-code SVG (§3 P4).**

---

## AUDIO SHOPPING LIST — CC0 DOWNLOAD ($0, neither Meshy nor xAI)

No authorized tool generates audio; every gap below closes via **free CC0 downloads already sourced and licence-verified in `AUDIO_SOURCES.md`** — the cost is slice/encode/wire effort, not tokens. The audio *engineering* is already at Final Drop parity (true HRTF panner, per-class audible radii, distance lowpass, limiter, convolution reverb, sidechain-ducked music). What's missing is **recorded content density**.

1. **Character vocals** (biggest immersion tell) — ~10–14 male grunt/effort/death one-shots (qubodup slightscreams, thebardofblasphemy death/pain, Potapooo 39934 — all CC0). All 5 skins are male-coded → route to the male pool (the "female death vocal" line in `AUDIO_SOURCES.md §4` is **moot**, needs no spend). Slice ~0.25–0.35 s mono, ~96 kbps ogg (~150 KB total). Wire `voc_hurt`/`voc_death`/`voc_jump` into `actorHurt`/`actorDied`/jump handlers (`audio.js:538-545,657`), keeping the synth thump as fallback.
2. **Weapon reports** — 5–6 dry CC0 reports (Free Firearm Sound Library GitHub mirror — cherry-pick, do NOT pull the 194 MB archive; LeMudCrab GL). **Layer the recorded body UNDER the existing synth transient/crack** through the same `spatial()` out with the current decorrelation + range lowpass — do not replace (`audio.js:362-407`).
3. **Reload foley + wind + ocean loops** (lowest priority) — SpringySpringo reloads, BigSoundBank wind, kkenny101 ocean, all CC0. Swap the synth `thump()` and `noiseBuf` beds (`audio.js:512-527,779-818`).

> Spoken announcer / stem-based adaptive music are the audio qualities that **do NOT close cheaply** — no CC0 pack fits a specific BR callout script and no speech generator is authorized. The current filter-thinning music and DOM announcements are good enough; do not chase VO.

---

## 6. THE MENU / INVENTORY / TRAINING VERDICT

The owner asked specifically for "proper menu, inventory, training." Honest read: **all three are already built to at-or-beyond CrazyGames-BR structure** — none needs a rebuild. Here is exactly what each needs to be commercial-grade.

### MENU — verdict: **close** (structure done; needs the art layer)
It already has a **live 3D cinematic diorama** (shader sky, procedural island, storm-ring motif, sky-islands, palms, dust, god-rays, bloom, orbiting camera), a **character locker/turntable** rendering the real Meshy GLBs, **glass mode cards**, a **progression strip** (LVL/rank/XP/streak/next-unlock), **daily challenges**, **deep settings** (17-action rebind, career export/import), and a **first-run flow**. The ONLY gap is that `assets/` contains **zero image files** — every visual is CSS/emoji/shader. Commercial-grade =
- **xAI**: menu skybox on the diorama, mode-card banners, logo/emblem mark (§5).
- **Pure code**: SVG icon set replacing OS emoji, tab-sectioned settings, film-grain/vignette overlay, and **fix the short-viewport clipping bug (#9)**.
It is not missing features — it needs the raster art + three small code passes.

### INVENTORY — verdict: **parity** (already at/slightly ahead of Final Drop)
5-cell hotbar with **3D-rendered weapon icons** (from the actual view-models), **colorblind-safe rarity** (stripe + Roman numeral), reserve-ammo + stack counts, reload progress bar, and **outcome-naming interact labels** ("Swap for X — drops Y"). The deliberate no-backpack/no-Tab model is correct — **do not add one.** To reach commercial-grade / pull ahead:
- **Pure code (do first — it's also bug #5)**: dedicated stacking rarity-tinted pickup feed, freeing `R.stormMsg` for storm alerts.
- **Pure code**: rarity-tinted hotbar cell body + ammo-type color coding (peripheral reads).
- **xAI (optional polish)**: flat consumable icons (the two shield potions read near-identical at 40 px as 3D thumbnails) — keep the 3D render for weapons.

### TRAINING — verdict: **parity** (real practice stack already ships)
PRACTICE mode already has **no storm, full auto-granted loadout, a 5-dummy range at 12/22/35/55/80 m, dummies that reset instead of dying with real hit feedback, and a live SHOTS/HITS/ACC%/HEADSHOTS/DMG readout** — better than most browser BRs. **Do NOT rebuild these, do NOT add a movement course or bespoke arena (both owner-decided-against).** Commercial-grade =
- **Owner decision** (then pure code): an **opt-in, skippable coach** ("cut your chute / loot this / pop the 35 m dummy") — every event hook already exists (`dummyPopped`, `actorHurt`, `chuteCut`, `interact`) — but the owner has an explicit stated position *against forced tutorials*, so the scope call is his.
- **Meshy or xAI**: **distinct dummy target identity** (currently the dummies wear random player skins → the range reads as five idle players). Meshy scoring-ring dummy (~150–250 cr) or the cheaper xAI bullseye decal (~$0.03).
- **Pure code**: per-weapon stats card, per-distance breakdown + reset + optional strafing targets, add the SMG to the kit, and **fix the 80 m ranging-label cull (bug #8)**.

---

## 7. THE ONE-WEEK PATH TO BEATING FINAL DROP

Decisive and ordered. Final Drop's edges over Last Circle are **visuals, audio, retention, multiplayer** (monetisation is constrained out — stay DRAFT, no SDK/ads). This week closes all four. **Kick off async asset generation on Day 1** so it lands mid-week while pure-code work runs in parallel.

**Day 1 — unblock everything async + de-flatten the world (no assets needed yet)**
- Fire the **entire xAI batch** (FX sprites + decals, menu skybox/cards/logo, 8 structure textures, cloud sheets, ground details) — ~$3, one sitting.
- Queue the **Meshy animation pass** (2 deaths + 6 emotes, ~145 cr) and the **biome/hero props + dummy** jobs — they're queued/async.
- Ship **IBL/PMREM** (`scene.environment`) + let metals go metallic. Single highest value-per-effort change in the game; zero art.

**Day 2 — rendering + the critical MP bug**
- **CSM cascaded shadows** to ~400 m.
- **Host-departure local-continuation + `net.on('error')` + "Reconnecting…" overlay** (bug #1/#2). A silently-dying multiplayer match is *worse* than Final Drop; this must land.
- **Delta-encode bot snapshots / drop to ~6–7 Hz at H≥4** to give the 4-human roster real headroom.

**Day 3 — combat feel (juice)**
- Wire the **FX sprite pool** (muzzle flash, explosion, sparks) + **impact-decal pool** as they arrive from xAI.
- **Chromatic-aberration pass**, **own-elimination screen pop**, **crit damage-number scale-pop**, **winning-kill slow-mo**.
- **ADS shoulder pose + hit-react flinch + procedural reload motion** (all pure code).

**Day 4 — world art wiring**
- Wire the **8 structure textures** (mat-tagged batches), **cloud sheets + horizon band**, **per-map ground details**. This kills the last "still procedural" tell.
- **Frustum-chunk foliage** (8×8 grid) so density can rise without a frame hit.

**Day 5 — retention refill (the churn fix)**
- Wire the **Meshy emote/death clips**: emote wheel, `EMOTES` gate table into `rewardTable()`, death random-pick.
- **Achievements/medals** (pure code, emoji placeholders) + **cosmetic recolor tint tiers** (~10–15 unlock tiers for $0) + **skill ladder rank**. This refills the reward track that currently runs dry at L22 — the single biggest churn driver.

**Day 6 — audio content + menu/inventory finish**
- **Download & wire the CC0 vocals + layered weapon reports** ($0, already sourced). Biggest audio immersion win.
- Wire **menu skybox + mode-card art + logo**, ship the **SVG icon set** and **tab settings**, fix the **short-viewport clip**.
- Ship the **dedicated pickup feed** (fixes bug #5) + rarity-tinted cells.

**Day 7 — polish, cleanup, verify**
- **Snapshot interpolation buffer** (net smoothness), **predicted kill-confirm**, **connection-health UI**.
- Wire **hero landmark + biome props** as they finish generating; **distinct dummy targets** in practice + fix the ranging-label cull.
- Cleanups: delete the 776 KB dead armed GLBs + `waternormals.jpg`, gate `preserveDrawingBuffer`, defer emote clips off the load path, drop redundant legacy weapon GLBs, `meshopt` compress.
- **Playtest a full match + a 4-player friend match** end-to-end and confirm the effect in the live build (not just a clean compile).

**What this week does NOT attempt (and shouldn't):** dedicated-server multiplayer / 60+ real players / lag-comp / anti-cheat (needs paid infra — the serverless $0 model is correct for friends-play), cloud save (gated by no-SDK/DRAFT), photoreal PBR, spoken VO, and facial/finger rig regen (hard Meshy ceiling, near-zero ROI at TPS distance). Those are the AAA line the browser build's ceiling forbids — acknowledge them, don't chase them.

---
**Total spend to beat Final Drop:** ~$3 in xAI + ~515–615 Meshy credits (~365–465 if the dummy uses an xAI decal) + $0 CC0 audio. Everything else is pure code you already own. Roadmap source lenses cross-referenced: menu, inventory, training, character-models, world-art, weapon-viewmodels, vfx, progression, audio, multiplayer, performance, live-bug-hunt.