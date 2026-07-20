# CHROMA HIDE — Full Build Plan

*A ForgeFlow Games original, inspired by the mechanics of MECCHA CHAMELEON.*
Working title / slug: **CHROMA HIDE** / `chroma-hide` (owner-renameable).
Plan authored 2026-07-19. Status: **PLAN — not yet built.**

---

## 0. One-paragraph pitch

A real-time, browser-playable multiplayer hide-and-seek game where **Hiders paint their own blank-white 3D bodies** — freehand, with a real brush, an eyedropper, and metallic/roughness sliders — to melt into the stage, then hold a pose and hide *in plain sight*. **Seekers** stalk the map with a gun and limited ammo, shooting anything that looks a shade wrong. The twist that made the source game a 15-million-seller: hiding isn't about geometry, it's about **artistic skill** — and you score points for lingering in a Seeker's line of sight without being caught. We build the same magic on our Three.js + NetPlay stack, and we add the one thing the original lacks — **AI bots** — so a single player can enjoy the full loop and every online lobby always feels full.

---

## 1. Fidelity note — what's verified vs. what we're choosing

This plan is grounded in a cross-verified research pass (professional sources: Kotaku, GAME Watch, AKIBA PC Hotline, GameRant, TheGamer, Wikipedia, Steam store + official news feed). Mechanics below are labelled:

- **[V]** = verified from ≥2 independent sources (or first-party Steam/official patch notes).
- **[D]** = our **design default** for a number the developers **never publicly disclosed**. The source game's exact prep/hunt timers, Seeker ammo/HP counts, and line-of-sight scoring formula are undocumented anywhere — so we specify balanced, host-adjustable defaults and tune in playtest. These are the five research gaps that could not be closed and do not exist in any public source.
- **[A]** = deliberate **adaptation** for our platform (browser / Three.js / Supabase-Realtime relay / bots-fill-lobby), differing from the UE5/Steam original on purpose.

**IP stance:** we clone the *mechanic* (unprotectable), not the brand. Do **not** ship under the name "Meccha Chameleon," reuse its logo, map names (HIKAKIN Museum, Death Burger, etc.), or marketing copy. All stage names, art, and title in this plan are original. This is a homage build, same as our other genre homages.

---

## 2. The source game, distilled (how it "fully functions")

Everything a from-scratch rebuild must reproduce, condensed from the research:

**Match loop [V]:** Lobby (host sets mode / map / Seeker count / timers) → role split into **Hiders ("Chameleons")** and **Seekers ("Hunters")** → **Prep/Paint phase** (Hiders roam, sample colors, paint their white bodies, pick a pose; Seekers locked in spawn) → **Hunt phase** (Seekers released, first- or third-person, shoot suspects) → **Answer-Check / Results** (reveal Hider spots, "Missed Spots" ranking).

**Win conditions [V]:** Seekers win by shooting **every** Hider before the timer; Hiders win if **at least one** survives to zero.

**The catch [V]:** a Hider is out **only when physically shot** — being seen isn't enough. Launch had unlimited ammo + ~2 s between shots; a post-launch patch added the **ammo economy** the community credits with "saving the game": **miss → −1 ammo, hit → +1, fleeing target is free, all Seekers out of ammo → Hiders win.** No radar/scanner exists — the gun even doubles as a flashlight.

**The paint system (the crown jewel) [V]:** each round you spawn pure white and paint your 3D body **directly in world space** (no UV screen). Tools: brush (size via RMB-drag), **eyedropper** that samples a surface's exact **base color** (but *not* reliably its metallic/roughness — those you set by hand), **metallic + roughness sliders** (0–100 %), HSV/RGB, a saveable palette, an x-ray toggle to reach wall-pressed areas, and a cast-shadow toggle. **No undo.** You can **keep painting and moving after the hunt starts.**

**Hider kit [V]:** pick a **pose** (stand / crouch / ball / lie / wall-flatten / arms-up / dome), a **body shape** (blobby vs. cube — cube matches boxes/fences), a **size** (×1.0 / ×1.4 / ×1.7), and drop up to **2 static clones**. A **whistle/taunt** makes noise (Seekers hear rough direction only); with **Forced Taunt** on, everyone auto-whistles on an interval. An **anti-cheese "too-buried" warning** flashes and can reveal you if you shove your body inside geometry.

**Signature scoring [V]:** beyond the binary win, Hiders earn points for **time spent inside a Seeker's direct line of sight** without being caught (rewards brazen hiding-in-plain-sight and whistle-baiting). Results show a **Missed Spots / Missed Enemies** ranking of what each Seeker walked past.

**Modes [V]:** **Normal** (fixed teams), **Infection** (caught Hider joins Seekers, snowballs), **Double** (everyone hides, then everyone hunts; winner = best seeking), **Reverse Chicken Race** (everyone paints, one paint job is revealed, the rest race to find that player).

**Social/tech [V]:** premium $5.99, **no progression / no achievements / no paid cosmetics** (cosmetics are the paint you make yourself + 11 free emotes); UE5 + **Epic Online Services listen-host lobbies** (no dedicated servers), 2–10 recommended (up to ~24 network-dependent), Steam Workshop maps, text + proximity voice chat, streamer-friendly. Reception: 90 % Very Positive; famously **janky** (lobby stalls, void falls, no anti-cheat).

**The magic to preserve:** the Prop-Hunt **inversion** — you stay visible and win by craft, not by finding an unfindable crack. It's a *framework for creativity and playacting*, not a twitch shooter. Every design decision below protects that.

---

## 3. Platform adaptation — source → ForgeFlow

| Dimension | Source (Meccha Chameleon) | CHROMA HIDE (ours) |
|---|---|---|
| Engine | Unreal Engine 5.6 | **Three.js r0.172** (shared FFG 3D kernel) [A] |
| Distribution | Steam, Windows .exe, $5.99 | **Browser, free**, forgeflowgames.com portal [A] |
| Netcode | Epic Online Services listen-host | **NetPlay** — Supabase Realtime Broadcast+Presence relay, host-authoritative ($0) [A] |
| Lobby fill | Strictly 2+ humans, **no bots** | **AI Hiders + AI Seekers fill empty slots** (host-simulated), so solo play + testing + always-full lobbies [A] |
| Anti-cheat | None | Client-authority-over-own-life + host validation of catches; no kernel AC needed for a casual browser game |
| Voice | Proximity voice | **Text chat + whistle SFX** v1; proximity WebRTC voice deferred to a stretch goal [A] |
| Workshop | Steam Workshop maps | Fixed first-party map set v1; data-driven map format leaves the door open for UGC later |

The bots adaptation is the single most important design choice: it converts a game that **required** a full human lobby (a real friction point — see the "stuck in lobby" complaints) into one that is **playable and fully testable by one person**, matching our platform standard that games ship web-playable and pass an automated selftest. Bots are also our verification harness.

---

## 4. Technical architecture

### 4.1 Repo layout (flat bespoke `runtime/`, grid-rush style — verified against `last-circle`, `pirates-cove`, `grid-rush`)

Bespoke standalone Three.js structure (NOT the genre-registry kernel) — this game's loop (paint mode, FPS seeker, hide/seek phases) is too custom for the registry, and `grid-rush` already establishes the flat-`runtime/` bespoke pattern.

```
games/chroma-hide/
  index.html                 # importmap(three) + GAME_CONFIG{fs_hotkey:false} + boot tags, ?v=N   [M0 ✓]
  game_meta.json             # title, slug, genre, controls, tags, status                            [M0 ✓]
  game_controls.js           # universal control bar, copied verbatim (fullscreen/mute/pause/bug)     [M0 ✓]
  content.json               # catalog copy / how-to-play                                             [M0 ✓]
  thumbnail.png              # catalog card art (generate_cover.py)                                   [M6]
  menu_bg.png                # title-screen key art                                                   [M5]
  selftest.mjs               # static gate: file-exists + node --check + boot strings + pure-sim tests [M0 ✓, grows/milestone]
  assets/                    # models (GLB), textures, audio                                          [M5]
  runtime/
    main.js                  # ES-module entry: build Engine, mount menu→match (M0: demo room)        [M0 ✓]
    engine.js                # lean bespoke three.js substrate (renderer/scene/lights/loop/raycast)   [M0 ✓]
    game.js                  # match orchestrator: phases, world, ties systems together               [M2]
    paint.js                 # THE paint system (albedo/metal/rough canvases, brush, eyedropper)      [M1]
    hider.js                 # hider controller (move, pose, clone, whistle, too-buried)              [M2]
    seeker.js                # seeker controller (move, aim, gun, ammo economy, LOS test)             [M2]
    bots.js                  # AI hiders (pick spot→auto-paint→pose) + AI seekers (sweep→suspect→shoot) [M2]
    maps.js                  # data-driven stage definitions + loader                                 [M2/M5]
    ui.js                    # menus / HUD / results / pause (DOM overlay)                            [M2/M4/M5]
    audio.js, fx.js          # whistle/muzzle/footsteps/music; paint splats, muzzle flash            [M5]
    net/
      ffg_netplay.js         # COPIED shared transport (Supabase Realtime)                            [M3]
      chromanet.js           # host-authoritative real-time session (this game's protocol)            [M3]
      ffg_ratings.js         # optional W/L reporting (copied)                                        [M3]
    sim/
      match_core.js          # PURE match rules: phases/timers/roles/ammo/LOS/win/modes (node-tested) [M0 ✓]
      util.js                # PURE helpers: seeded RNG, clamp/lerp, formatTime, color conversions    [M0 ✓]
```

**Progress:**
- **M0 complete & verified 2026-07-19** — 40/40 selftest green; lit room renders (framebuffer sampled: 100% non-black, warm palette, 17 colour buckets); no console errors. Fixed a 0×0-canvas layout-timing bug (ResizeObserver). Screenshot capture unavailable in the backgrounded preview pane (documented env limitation) — verified via pixel-sampling + probes instead.
- **M1 (paint system) complete & verified 2026-07-19** — `sim/paint_buffer.js` (pure brush-stamp math + FNV hash), `paint.js` (3 CanvasTextures albedo/metal/rough on a MeshStandardMaterial, raycast-to-UV brush, eyedropper, x-ray, shadow, clear/no-undo, orbit), `paint_ui.js` (colour picker, metal/rough/size sliders, palette, action buttons). Headless determinism gate green (replay reproduces hashes; order-dependent). Live: painting applies to the body (white→magenta), **all 4 eyedrops match target base colour exactly (chest/teal/chrome/wall) with metal+rough correctly NOT copied** (the faithful sheen quirk), paint perf **0.76 ms/stamp (~1300 fps-equiv, far above 60)**, x-ray + shadow toggles work. Fixed 2 real bugs: eyedrop linear→sRGB colour conversion, and a camera-matrix raycast guard.
- **M2 — full single-player loop vs bots COMPLETE & verified 2026-07-20.**
  - Part 1 (sim core): `sim/match_sim.js` (PURE 2D match brain — phase advance, bot hiders pick spots/hide/flee/whistle, bot seekers patrol + cone/LOS-occlusion detect + ammo-economy shoot + catch + infection-convert, LOS scoring, win) + `maps.js` (pure "The Manor" data + `toSimMap`). Headless gate: strong-seeker→Seeker-win, blind-seeker→Hider-win, deterministic per seed, local-input movement.
  - Part 2 (3D body): `game.js` orchestrator (builds map meshes + capsule actors from the sim, drives phases, cameras = hider 3rd-person/paint-orbit + seeker 1st/3rd-person, wires PaintSystem to local hider + gun raycast/ammo to local seeker, HUD), `ui.js` (title menu w/ role+mode+lobby-size, HUD, results scoreboard, pause bound to control bar), `main.js` rewired to menu→game→results→rematch/menu.
  - **Live gate MET (browser)**: title renders; start-as-hider (6p→2 seekers/4 hiders, paint attached) → paint the body (81 strokes) → fast-forward whole match → resolves to Results (Seekers win, scoreboard incl. local); start-as-seeker + Infection → ammo drops 8→5 on 3 misses (economy works) → resolves (Hiders win); back-to-menu cleans up. No console errors. Selftest green (69 checks). Fixed a strict-mode getter-assignment bug in main.js.
- **M3 — online multiplayer, NETCODE + SYNC complete & verified 2026-07-20 (part 1/2).**
  - Copied shared `net/ffg_netplay.js` (last-circle's copy — has the quickMatch lobby-linger reliability fix) + `net/ffg_ratings.js`. Built `sim/net_protocol.js` (PURE wire format: quantized actor/snapshot/stroke pack-unpack + `buildRoster` peers+fill-bots+roles) and `net/chromanet.js` (host-authoritative session on NetPlay: room-code/quick-match, lobby, host broadcasts snapshots ~10Hz + events, guests send input + stream paint, host-validated shots). `Game` now runs offline/host/guest: host feeds all human inputs into the authoritative sim + broadcasts; guest renders snapshots + sends input + streams its own paint; every human hider gets a paint surface so remote disguises render. Sim movement keyed off `!isBot` (multi-human).
  - **Headless sync gate MET** via `net/loopback.js` (in-process ChromaNet double running real pack/unpack) — two Games (host+guest) in one page: identical 4-actor build, guest mirrors host positions **maxErr 0.00** across all actors (incl. guest's own input relayed through host + bots), paint **streams 25→25 strokes** onto the remote body. Only the Supabase socket itself is unverified here — it's the identical module proven live in last-circle/pirates-cove. Selftest **86 checks green**. Cache-bust `?v=6`.
- **M4 — modes polish, part 1 complete & verified 2026-07-20.** Answer-Check **reveal** (on the ANSWER_CHECK phase all hider spots reveal; survivors glow + get a teal beacon ring; HUD banner "N survived"), **emote wheel** (E opens an 8-emoji bar → floating billboard sprite above the body, broadcast as an `emote` net event so others see it online), **Reverse Chicken Race** now a DISTINCT flow (everyone hides in prep → at hunt one hider is revealed as "the mark" + everyone else becomes a seeker racing to it; finder gets the 500 reward; bots beeline the revealed mark), and **Missed-Spots** labeling already in the results scoreboard (survived/caught + score). Headless gate: all 4 modes reach a valid verdict; reverse verified distinct (everyone-hides → mark revealed → others seek). Live: reverse round + emote + reveal + results all fire, no console errors. Selftest **93 checks green**. Cache-bust `?v=9`. Remaining M4 (part 2, next): Double's distinct "hide-a-decoy then everyone hunts decoys" flow (currently Double resolves but plays Normal-like).
  - Note: the source game's Double-mode rules are genuinely ambiguous across sources; our interpretation is documented below.
- **M4 part 2 — Double mode COMPLETE & verified 2026-07-20.** Double is now a DISTINCT flow: everyone paints & hides in prep, then at hunt ~half are activated as seekers and the rest stay hidden (roles decided at hunt start, so you prep a disguise not knowing your role) — a real twist over Normal, resolving as a team verdict. `convertDouble` in match_sim; game.js `_onPhaseChange` now flips the LOCAL player's role at hunt (fixes both Double AND Reverse for the human, with a "You're a SEEKER!/hiding!" toast + camera/HUD swap). Headless: double is distinct (all-hiders prep → 3 seekers at hunt for 6p) + resolves. **M4 fully done — all 4 modes distinct.**
- **M5 — maps + polish, IN PROGRESS 2026-07-20.**
  - **Two new stages** authored as pure data in `maps.js` (game.js builder was already generic): **Understage** (dark maintenance tunnels — steel pipes, rust barrels, low ambient; the "control your gloss/brightness" map) and **The Hollow** (liminal mono-yellow, sparse angular cover, long sightlines, flat bright light — the hard map). **Stage picker** added to the title menu + online lobby (🎲 Random + 3 named stages), threaded through offline `startGame` and online `startMatch`; map list passed as data from main.js (imports maps with `?v`) so cache-busting stays correct. **Seeker flashlight** added (the gun-as-flashlight — a point light following the local seeker in hunt; essential on Understage). Live-verified: all 3 stages build + play to a verdict; menu shows all 4 options; Understage playable (maxBrightness 187, flashlight lifts lit-area 16%→22%); no console errors. Selftest **102 checks green**. Cache-bust `?v=11`.
  - **Audio complete & verified 2026-07-20** — `audio.js` procedural WebAudio (no asset files): whistle, footstep, gunshot, catch, miss, UI blip + a subtle detuned-drone ambient music bed; created via the game_controls-wrapped AudioContext so the page Mute suspends it. Wired into game.js: whistle/gunshot/catch/miss on events (offline+host+guest), footsteps on local movement (throttled), music start/stop on match begin/end. Live-verified: ctx resumes on the click gesture (state "running"), music starts, all 6 SFX + a full round fire with no throw.
  - **Settings menu complete & verified 2026-07-20** — `ui.createSettings`: graphics quality (Low/Med/High → `ffg_settings` + `engine.applyQuality`), mouse sensitivity (game reads `chroma_sens` live in the camera handler), master volume (→ shared audio), colour-blind assist toggle. Opened from title + pause; live-verified it renders + quality applies (High caps at device DPR, correct).
  - **Perf**: handled by the quality preset (DPR cap + shadow toggle in engine.js) — the paint pipeline is 0.76ms/stamp (M1), the sim is 2D/cheap.
  - **Mobile/touch: intentionally NOT built** — the source game is PC/keyboard-mouse only, and a freehand-paint + mouse-look-FPS game is inherently desktop; forcing touch controls would degrade it. Documented as a matching desktop-first limitation. **M5 substantially complete.** Selftest 104 green. Cache-bust `?v=12`.
- **M3 part 2/2 — lobby + LIVE 2-tab COMPLETE & verified 2026-07-20.** Added the online lobby UI (`ui.createOnlineLobby`: Quick Match / Create Room / Join-by-code + waiting room w/ mode+lobby-size, host Start) + a "🌐 Play Online" menu button, wired through `main.js` (connect → host `startMatch` broadcasts roster → both build Game online). **GENUINE LIVE 2-TAB SUCCESS over real Supabase** (not env-blocked — better than prior MP games): two tabs connected (presence peers=2 both sides), bidirectional broadcast with correct pack/unpack (win event + snapshot `timeLeft 88` decoded), match START handoff delivered the identical roster (same seed 1783452046, 2 humans+2 bots, guest found its own hider role), and **30 host snapshots streamed + applied over the wire with phase + timeLeft (42) synced exactly**. Fixed a real netcode bug found via the 2-tab test: `_stepGuest` discarded each snapshot after one lerp, so the guest stopped interpolating when snapshots paused — now it keeps converging toward the latest target (loopback-verified: errAfterPause 0.000, exact position match). Selftest 86 green. Cache-bust `?v=8`. **M3 DONE.**

### 4.2 The 3D kernel & performance budget [A]

Reuse `ffg_kernel_3d.js` (DPR cap 1.5, shadow map 1024, strip GLB lights — per our FPS memory). The paint system is the perf-sensitive novelty; budget for it in §5.1. Target 60 fps on mid hardware, graceful to 30. No Lumen/RT — we use baked/simple lighting so the *material sheen* the game depends on (metallic/roughness) still reads, but cheaply (a single directional key + hemi ambient + a few point lights per map).

### 4.3 Networking model — host-authoritative real-time [A][V-analog]

Directly mirrors **Last Circle** (`royale/net.js`) and **Pirate's Cove Arena** (`covenet.js`), our two proven real-time games on the same relay:

- **Transport:** `NetPlay` over Supabase Realtime. `quickMatch()` pairs into a room (lower peer-id = host) or `joinRoom(code)` with a 4-char code. Same project `wugoxdewcdxzfppgzohy`, public anon key.
- **Authority:** **host owns** the match clock, phase transitions, all **bot** actors, catch **validation**, and the win check. Each human has **authority over its own transform and its own life** (when told "you're shot," the victim applies it and rebroadcasts — the Last Circle `hitYou` pattern).
- **Tick rates:** humans broadcast own transform + pose at **~10–12 Hz** (Hiders are usually still → send-on-change + 2 Hz keepalive; Seekers stream at 12 Hz). Host broadcasts bot snapshots at **10 Hz** with LOD (distant bots ~2 Hz). Values quantized (`pack()` int16 pos / int8 yaw) like Last Circle.
- **Join = take over a bot slot:** slots `s0..sK` sorted by peer id (host = s0); a joiner claims the next open slot in the lobby; a mid-match dropout's slot **re-attaches a bot brain** so the round never breaks. (Last Circle's exact model.)
- **No host migration v1** (host leaving voids the match — same as covenet). Documented limitation.

### 4.4 Paint over the wire — the one hard networking problem [A]

You never stream the painted **textures** (too big). You stream **strokes**:

- A stroke = `{u, v, size, r,g,b, metal, rough, tool}` — ~10 bytes packed.
- During prep, batch strokes at ~5 Hz per painter; peers **replay** them onto their local copy of that painter's three canvases (albedo/metal/rough).
- **Late joiners / hunt start:** the painter sends its **full stroke list once** (or a compressed keyframe: a downscaled PNG dataURL if the list is huge). A hider who keeps painting mid-hunt streams deltas at ~2 Hz.
- **Bots:** the host generates their paint locally and broadcasts the stroke list once at prep-end (bots paint "instantly" in logic, revealed as a quick time-lapse for feel).

This keeps paint deterministic and cheap, and makes the whole match **replayable from the seed + stroke log** — which is exactly what powers the selftest and the Answer-Check reveal.

---

## 5. Core systems — detailed specs

### 5.1 Paint system (`paint.js`) — build this first, it's the game

**Data:** per body, three `CanvasTexture`-backed 2D canvases at **1024²** (bump to 2048² as a quality setting) — **albedo**, **metalness**, **roughness** — bound to a `MeshStandardMaterial` (`map`, `metalnessMap`, `roughnessMap`). Init albedo = white, metal = 0, rough = ~0.8. Body mesh carries a **padded, non-overlapping UV unwrap** (author once in Blender; pad islands to avoid seam bleed).

**Brush (apply paint) [V]:**
1. Raycast cursor → body mesh → hit gives a **UV** (`intersection.uv`).
2. Stamp a soft radial brush at `uv * 1024` into **all three** canvases with the current color / metal / rough; `texture.needsUpdate = true` (throttle to once per frame).
3. Brush size via **RMB-drag** (drag right = bigger) [V]. Large brush for base coat, small for seams (mirrors the guide meta).
4. **No undo** [V] — faithful and simpler. (A "clear all → white" reset is allowed; undo is not.)
5. Seam handling: paint in a small 3D neighborhood (project the brush to nearby triangles) OR rely on padded UVs; v1 uses padded UVs + slight over-spray, revisit if seams show.

**Eyedropper (sample) [V] — elegant mapping of a verified quirk:** the real eyedropper copies **base color but not metallic/roughness**. Implement exactly that: maintain an **albedo-only offscreen pass** (render the scene with an override material that outputs each surface's unlit base color) into a small RT; on Space [V], `readRenderTargetPixels` at the cursor → set brush **color**; **do not** touch the metal/rough sliders. This is faithful *and* cheaper than trying to read material params per-pixel, and it naturally reproduces the "sheen mismatch betrays you" skill ceiling.

**Material sliders [V]:** Metallic 0–100 %, Roughness 0–100 %, plus HSV nudge + RGB entry + a **saveable palette** ("+" adds current color) and **save-theme presets** (localStorage; the source's "save themes" feature). Recipes work exactly as documented (chrome = 220/220/220, M100, R0).

**Inspection aids [V]:** middle-mouse **orbit** the camera around your own body; **key 3** toggles **x-ray** (render body with `depthTest:false` / see-through shader) to paint wall-pressed areas; **V** toggles the body's **cast shadow** so you can keep whichever blends.

**Perf:** three 1024² canvas uploads only on stroke frames; the albedo pass renders at ¼ res only while the eyedropper key is held. Well within budget.

**Acceptance:** paint a body to match a wall, eyedrop the wall color, set metal/rough, orbit-inspect all sides, x-ray a back face — all at ≥60 fps; strokes replay identically on a second tab.

### 5.2 Match state machine (`match_core.js` — pure/testable, driven by host)

States: `LOBBY → ROLE_ASSIGN → PREP → HUNT → ANSWER_CHECK → RESULTS → (rematch)LOBBY`.

**Timers [D]** (host-adjustable; defaults chosen from the ~90 s prep hint + 2–3 min fan consensus, since exact values are undocumented):
- Prep: **90 s** (range 30–180, 15 s steps).
- Hunt: **150 s** (range 90–300, 30 s steps).
- Answer-Check: **12 s** fixed reveal.

**Role assignment [D]** (undocumented officially): **1 Seeker per 4 players**, rounded, host-overridable (1..N−1). Assignment random with **anti-repeat** (don't Seek twice in a row); volunteer-Seeker toggle as a nicety.

**Win check [V]:** Hunt ends when timer hits 0 (≥1 Hider alive → Hiders win) OR all Hiders caught (Seekers win) OR (ammo economy on) all Seekers out of ammo (Hiders win).

### 5.3 Seeker (`seeker.js`) [V]

- **Camera:** first-person default; **RMB toggles third-person** (the v2.0.0 motion-sickness fix — ship it from day one) [V]. FOV ~105.
- **Gun:** LMB fires a hitscan ray; catches a Hider **or any of its clones** (shooting a clone eliminates its owner) [V]. Gun cone casts a soft light (the "flashlight" the community relies on) [V].
- **Ammo economy [D-numbers/V-rule]:** start **8** ammo; **miss −1, hit +1**, shooting at a **fleeing** (moving) target is **free**; **~1.5 s** shot cooldown; a Seeker at 0 can't fire; **all Seekers at 0 → Hiders win.** (Rule verified; counts are our defaults — host slider 4–∞, "unlimited" reproduces launch behavior.)
- **No radar/scanner/marking** [V] — the only "tools" are eyes, the flashlight-gun, sound, and the live score readout.

### 5.4 Hider (`hider.js`) [V]

- Third-person, walk-only (**no sprint** — verified; movement is what gets you spotted).
- **Pose wheel** (R/Q): stand, crouch, ball, lie, wall-flatten, arms-up, dome [V]. Recommended flow spot → pose → paint is a tutorial tip, not enforced.
- **Body shape** (lobby): blobby vs. cube [V]. **Size:** ×1.0 / ×1.4 / ×1.7 [V].
- **Clones:** up to **2**, **30 s** cooldown, static snapshots of your current paint+pose [V].
- **Whistle/taunt** (key 1): emits a positional-but-fuzzy sound; Seekers hear **direction+distance, not exact position** [V]. **Forced Taunt** [V] auto-whistles every **45 s [D]** (host 15–120 s or off); manual taunt resets the timer.
- **Too-buried anti-cheese [V]:** if >~50 % of the body's bounds are inside static geometry, show a warning at **3 s [D]**, flash + **reveal** at **6 s [D]**.
- **Keep painting/moving during Hunt** [V] — allowed; just risky.
- **Caught → spectate:** free-cam + follow-Seeker camera [V].

### 5.5 Line-of-sight scoring (`scoring.js`) — signature system [V-concept / D-formula]

The formula is undisclosed everywhere; ours: each host tick, for each (Seeker, uncaught Hider) pair, test **in view cone** (≤ Seeker FOV half-angle) **and** **unoccluded** (single raycast Seeker→Hider) **and** within **≤25 m**. If yes, accrue to the Hider:

```
pts_per_sec = BASE(10) * (1 + (1 - dist/25))      # closer = more, ~10–20/s
```

Accrual is **host-authoritative** (no client can inflate score). Results show each Hider's total and a **Missed-Spots ranking** — the top unfound Hiders by (LOS duration × proximity) that each Seeker walked past [V]. This is the loop that makes hiding-in-plain-sight and whistle-baiting rational.

### 5.6 Bots (`bots.js`) — our platform adaptation [A]

- **AI Hider:** pick an unclaimed spot near paintable cover → sample the dominant nearby surface color (uses the same albedo pass) → auto-generate a plausible stroke list (base coat + a few accent strokes, set metal/rough to the surface) → choose a fitting pose/shape → hold, with occasional micro-whistles when Forced Taunt is on. Difficulty scales paint accuracy and pose suitability.
- **AI Seeker:** patrol waypoints → raycast "suspicion" scoring on nearby paintable props (compare a candidate's silhouette/material delta vs. its backdrop) → approach suspicious spots → **shoot on threshold**, respecting the ammo economy (won't spray — models the miss penalty). Difficulty scales detection threshold, reaction time, and aim jitter.
- Host simulates all bots; guests render them as remote actors. Bots are also the **selftest actors** (headless match to a win).

### 5.7 Modes (`match_core.js` variants) [V]

1. **Normal** — fixed teams; caught Hiders spectate.
2. **Infection** — caught Hider **converts to Seeker**; round ends when the last Hider falls (or timer).
3. **Double** — everyone paints & hides, then **all become Seekers**; winner = most finds / best seek score. (Sources conflict on details → we ship the better-sourced "everyone hunts simultaneously" reading, winner by find-count; documented as our interpretation.)
4. **Reverse Chicken Race** — everyone paints; one paint job is **revealed in a display**; the rest race to find that player; finder gets points (we use **500**, matching the post-nerf value) [V].

### 5.8 Maps (`maps.js`) — data-driven, original stages

Ship **3 at v1** with strong, *distinct* paintable palettes and clear hiding affordances (the source's key differentiator is palette variety, not size). Original themes:

- **"The Manor"** — warm mansion: lobby, kitchen, library; damask patterns, wood, brass, tall ceilings. (Mansion analog — the flagship, largest.)
- **"Understage"** — dark maintenance tunnels: pipes, barrels, brick, graffiti. Darkest palette; rewards gloss/brightness control. (Sewer analog.)
- **"The Hollow"** — liminal mono-yellow rooms, sparse angular cover, long sightlines. The "hard" map. (Backrooms analog.)

Each map is data: spawn zones (Seeker cage + Hider region), prop list with materials, light rig, nav mesh / waypoints for bots, and a **too-buried collision volume set**. Add ~1 map per post-launch update (their cadence was aggressive; ours is data-driven so a map is a JSON + GLB + waypoints, not code).

### 5.9 UI / UX

- **Lobby:** Quick Match, Create Room (4-char code), Join by code (adapts their server-browser to our relay); host controls for mode/map/Seeker count/timers/Forced-Taunt/ammo-limit; bot-fill slider; ready + start. Kick power for host.
- **Prep HUD:** paint palette + sliders + eyedropper prompt, pose wheel, clone button, "Until Hunt" countdown, self-inspect orbit hint.
- **Hunt HUD:** Seeker = crosshair + ammo; Hider = live LOS score + whistle/clone cooldowns + Forced-Taunt timer.
- **Answer-Check/Results:** reveal all Hider spots, Missed-Spots ranking, per-player scores, MVP, rematch.
- **Emotes** [V]: a small free emote wheel (hold R center) — our nod to their 11 emotes; no monetization.
- **Settings:** rebindable keys, FOV, sensitivity, invert-Y, quality (paint res 1024/2048, shadows, DPR), color-blind palette assist, motion-blur off, master/music/SFX volumes.
- **`game_controls.js`** overlay string (FFG standard): `WASD move · Mouse look · F paint · Space eyedropper · LMB paint/fire · RMB brush size (paint) / 3rd-person (seek) · MMB orbit · R pose · 1 whistle · 3 x-ray · V shadow`.

### 5.10 Progression / cosmetics [V]

Match the source's **anti-progression** stance: **no XP, no unlocks, no shop.** "Cosmetics" = the paint you make (+ save-theme presets) and free emotes. **Optional, decoupled:** wire our shared `ffg_ratings.js` for online W/L on the profile (rated only when both signed in), and *optionally* a couple of FFG achievements ("First Perfect Hide," "Sharpshooter — win with ≥6 ammo left") — but keep it invisible to the core loop. Confirm with owner before enabling ratings/achievements (portal-side toggle; consistent with our leaderboards-rollout gate).

---

## 6. Audio [V]

Whistle/taunt (positional, low-pass-filtered by distance so it reads as "roughly over there"), footsteps (movement tell), muzzle + reload, ambient per-map bed, light procedural menu music (per-slug seed → unique, per our music-uniqueness rule — no shared Kenney dup). Proximity **voice** (WebRTC) is a **stretch goal**, not v1.

---

## 7. Networking protocol (message types)

Host-authoritative; all quantized. Types (broadcast via `net.send(type,data)`):

| Type | From | Rate | Payload |
|---|---|---|---|
| `hello` | all | on join | {id, name, slot, signedIn} |
| `lobby` | host | on change | {mode, map, seekerCount, timers, forcedTaunt, ammoLimit, roster} |
| `phase` | host | on change | {state, endsAt, seed} |
| `xform` | human | 10–12 Hz | {slot, pos, yaw, pose, moving} |
| `botsnap` | host | 10 Hz (LOD) | [{slot,pos,yaw,pose}...] |
| `stroke` | painter | ~5 Hz batch | {slot, [strokes...]} |
| `paintfull` | painter/host | on join / prep-end | {slot, strokeList | pngKeyframe} |
| `whistle` | human/host | on taunt | {slot, pos} |
| `clone` | human/host | on drop | {slot, pos, yaw, pose, paintRef} |
| `shot` | seeker | on fire | {slot, origin, dir} |
| `caught` | host | on validated catch | {victimSlot, bySlot} |
| `score` | host | 2 Hz | {slot: pts, ...} |
| `result` | host | on end | {winner, scores, missedSpots} |

Catch flow: Seeker sends `shot` → **host** raycasts against authoritative positions → on hit sends `caught` → victim (if human) confirms self-elimination and stops broadcasting `xform`. Prevents client-side "I wasn't hit" cheating for the common case.

---

## 8. Milestones & acceptance gates

Each milestone ends at an **observed effect** (Fable invariant 1), gated by `selftest.mjs` + a live browser check. Bots make every gate runnable solo/headless.

- **M0 — Scaffold (0.5 d).** Folder, `index.html` (importmap + `?v=1` boot tags per the Last-Circle pattern), kernel mount, empty scene, `game_meta.json`, `selftest.mjs` (file-exists + `node --check`). *Gate:* page loads, renders a lit room, selftest green.
- **M1 — Paint system (2–3 d).** `paint.js` complete: brush on a UV'd body, eyedropper via albedo pass, metal/rough sliders, palette, x-ray, shadow toggle, no-undo, orbit-inspect. *Gate:* live — paint a body to match a wall and eyedrop it at ≥60 fps; a headless stroke-replay test reproduces a target texture hash.
- **M2 — Full single-player loop vs bots (3–4 d).** Match state machine, one map, Hider controller (pose/shape/size/clone/whistle/too-buried), Seeker controller (gun/ammo/LOS/flashlight), scoring, bots (AI hiders + seekers). *Gate:* a human can play a complete Normal round to a win **against bots**; `sim/match_core` headless test drives bots to both a Hider-win and a Seeker-win.
- **M3 — Online multiplayer (2–3 d).** `chromanet.js` on NetPlay: lobby (quick/create/join), roster, phase sync, `xform`/`botsnap`, stroke streaming, host-validated catches, join-as-bot-takeover. *Gate:* **2-tab live playtest** — tab A hides & paints, tab B (seeker) sees the identical paint and scores a catch; `window.__mp*` hooks expose state for the automated 2-tab harness.
- **M4 — All modes (1–2 d).** Infection, Double, Reverse Chicken Race + Answer-Check/Missed-Spots results + emotes. *Gate:* each mode reaches a correct win/verdict in a headless bot match; live smoke test each.
- **M5 — Maps + polish + settings (2–3 d).** Add Understage + The Hollow, VFX/audio, full settings, controller-less mobile/touch fallback check, perf pass (DPR/shadow budget, paint-res quality tiers), the janky-lobby hardening (no void falls, no stuck lobby — the source's top complaints, which we explicitly avoid). *Gate:* 3 maps playable, 60 fps mid-hardware, selftest + feel check green on all.
- **M6 — Deploy (0.5 d).** `thumbnail.png` + `menu_bg.png` (generate_cover, then restore card per the thumbnail gotcha), `content.json`, bump `?v=`, `python pipeline/deploy_game.py --game-dir games/chroma-hide --slug chroma-hide` → lands **unpublished** on R2 + registry; verify `/games/chroma-hide` loads from CDN. **Publish is the owner's toggle** (gate).

Rough total: **~2 weeks** of focused build; M1–M2 are the risk-bearing core.

---

## 9. Testing & verification

- **`selftest.mjs`** (static gate, our convention): every runtime file exists, `node --check` passes, `index.html` contains the boot strings and `?v=`.
- **`sim/match_core` headless tests** (`.cjs`): timers, role assignment, ammo economy, LOS accrual, each mode's win logic — pure functions, no browser.
- **Paint determinism test:** replay a fixed stroke list → assert an image hash (guards the net-replay path).
- **MP:** `window.__mp*` / `window.__sp*`-style hooks → automated 2-tab harness (two `chromium.launch()`, `bring_to_front()` on the receiver — per our headless MP gotcha), then a **manual live 2-tab cert** before publish.
- **Feel/perf:** browser-pane smoke — load, play a bot round to a win, screenshot, check console/network clean, verify fps.

## 10. Deploy & registry

`deploy_game.py` → R2 bucket `forgeflow-games` (incremental md5 vs `state/r2_manifest_chroma-hide.json`; index/meta/content always re-pushed; CF cache purge) + Supabase `games` upsert (service-role) landing `status='unpublished'`; auto-runs `deploy_portal.py` to refresh the prerendered detail page. **Cache-bust:** bump `?v=` on every JS/HTML change (immutable-CDN gotcha). Owner flips to `published` in the portal admin.

---

## 11. Risks & open questions

- **Paint performance / seams (highest risk).** 3 canvas maps × frequent uploads and UV-seam bleed. *Mitigation:* padded UVs, once-per-frame upload throttle, 1024² default with 2048² as opt-in, profile in M1 before building on it.
- **Undocumented numbers [D].** Prep/hunt timers, ammo/HP counts, LOS formula, role ratio, Double-mode exact rules — **no public source has them** (the 5 research gaps). *Mitigation:* every one is a host-adjustable setting with a sensible default; tune in playtest. Do not present our numbers as canonical.
- **Bots must be fun, not just functional.** A dumb AI Seeker breaks the fantasy. *Mitigation:* difficulty tiers, the suspicion-scoring model, and playtest tuning; bots are M2 core, not an afterthought.
- **Relay scale.** Supabase Realtime eps≈12 cap — the 90 ms micro-queue pattern from `ffg_seatplay.js` applies; keep lobbies to ~10 like the source's recommended range, bot-fill the rest.
- **IP.** Original title/art/map-names/brand are off-limits; ship original everywhere. Do not imply affiliation.
- **Scope.** Proximity voice, Workshop/UGC maps, achievements/ratings, mobile-touch controls are **explicitly deferred** past v1 and called out here so they aren't silently dropped or silently added.

## 12. Chosen defaults (single source of truth for the [D] numbers)

| Setting | Default | Range (host) |
|---|---|---|
| Prep timer | 90 s | 30–180, 15 s |
| Hunt timer | 150 s | 90–300, 30 s |
| Seekers | ⌈players/4⌉ | 1..N−1 |
| Seeker start ammo | 8 | 4–∞ (∞ = launch feel) |
| Ammo: miss / hit / flee | −1 / +1 / 0 | fixed rule |
| Shot cooldown | 1.5 s | — |
| LOS score | 10/s × (1+(1−d/25)), ≤25 m, cone+raycast | — |
| Forced-taunt interval | 45 s | off / 15–120 |
| Clones | 2, 30 s cd | — |
| Body sizes | ×1.0 / ×1.4 / ×1.7 | — |
| Reverse-CR find reward | 500 | — |
| Paint res | 1024² | 1024 / 2048 |

---

*Ready to build. Recommended first action: M0 scaffold + a spike of the M1 paint system (the make-or-break piece), then reassess timers and bot fun in a live playtest before committing to M3+.*
