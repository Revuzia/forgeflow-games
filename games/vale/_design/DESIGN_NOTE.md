# VALE · Design note

The owner's brief (`_design/BRIEF.md`) asks for a design note that "cites what was researched, names the stack and why, includes the style bible, and lists every name that was deliberately not used". This is that note, written 2026-10-14. It sits on top of the working documents:

| Document | Owns |
|---|---|
| [`_spec/CONTRACT.md`](../_spec/CONTRACT.md) | interfaces: layout, schema, sim, session, render, audio, art, gates |
| [`_design/STYLE_BIBLE.md`](STYLE_BIBLE.md) | look and feel; law for every screen (condensed in §4 below) |
| [`_design/WORLD.md`](WORLD.md) | names, lore and UI voice |
| [`_design/ROSTER.md`](ROSTER.md) | the 16 fighters and their kits |
| [`_design/NAMES_NOT_USED.md`](NAMES_NOT_USED.md) | every name VALE chose not to use (summary in §5) |
| [`_design/research/`](research/) | the eleven research notes (§2) |

---

## 1. What VALE is

VALE is an original 3D lane-brawler that runs in the browser. Its world is one great carved sundial. The needle fell, its shadow stayed, and the light stopped: the west rim lives in a morning that never ends and the east rim in an evening that never reaches night. Two peoples keep the stopped hours. **Aubade** (west, always screen-left) build chalk spires with cool dawnglass; **Serenade** (east, always screen-right) build ironstone domes with warm lampresin. Each believes the last bell left ringing will raise the needle in its own hour. **RIFT** is the war for the dial: five against five on **Hourfall**, three roads, the **Dialwood** between them, and Needles and Lanterns that must fall before a team can silence the enemy **Hourbell**. **BRIDGE** is five against five on **Needlespan**, one road along the fallen needle over a gorge, with fighters dealt by lot. **FRAY** is the **Shadowless Noon**, when nothing casts a shadow and nobody has a side: ten fighters on the **Noonplate**, four lives each, ranked on the **Hour Board**. The same 16 fighters play all three modes, in six classes: Plinth, Breaker, Striker, Slinger, Caster and Tender.

| | RIFT | BRIDGE | FRAY |
|---|---|---|---|
| Map (`content/maps/`) | Hourfall, 170 × 110 m: North, Mid and South Roads, jungle, 12 structures a side | Needlespan, 156 × 44 m: the Span Road, 5 structures a side, no jungle | Noonplate, 64 × 64 m: ten hour-marks, one Lampwright cart |
| Seats | 2 teams × 5, five positions | 2 × 5 | 10 × 1, every seat its own colour |
| Pick | draft; the four RIFT queues layer on top | the Lot: one random fighter each, a team bench of 2, one redraw | free pick, no duplicates |
| Start | level 1, 480 Gleam | level 3, 1,300 Gleam, no recall | level 6 (ultimate ready), 1,400 Gleam |
| Win | silence the Hourbell (sudden death at 40:00) | silence the Hourbell (sudden death at 16:00) | first to 12 kills, last one standing, or best placed at 11:00 |
| Target length | 22–28 min | 14–20 min | 8–11 min |

Source: `content/modes.json`, `content/queues.json`, `content/maps/*.json`. RIFT's queues are Quick (role and fighter chosen before queueing), Draft (1 ban a team), Ranked (2 bans a team, Glicko-2) and Co-op vs bots; Custom and Practice complete the eight queues.

The catalog holds 16 fighters (each a passive, three abilities and an ultimate; 3 Plinths, 3 Breakers, 2 Strikers, 3 Slingers, 3 Casters, 2 Tenders), five positions (Shadehold, Grovehunter, Dialcross, Shaftlight, Lampglass), four resources (Light, Tally, Heat, Unlit), 48 skins that never change stats, 39 items, 8 battle spells, 9 boons, 3 paths, 24 unit types, 5 team buffs, 7 ranks and 1,371 UI strings. A fourth mode tile, **the uncarved hour**, is reserved in data (`content/client.json` `modeSlots`).

**State of the slice (2026-10-14).**

- **Playable end to end.** Home → Play → queue → draft or Lot → match to a real win condition → post-game with grants → shop → buy and equip a skin passes in real Chrome for all three modes (§6).
- **Fighter models: one of sixteen.** Marund is built with the Art 2.0 method (sculpted, painted by concept projection, rigged, 15 clips, a 1.16 MB GLB) with both alternate skins (re-coloured from the same painting), and awaits the owner's sign-off. The other 15 fighters and their skins are next. Until their models land, a production build draws those fighters as overlays only (ring, bars, telegraphs); dev builds behind `?dev=1`, which every harness run uses, draw a stand-in proof mannequin (`src/render/actors.ts`).
- **Units and scenery built.** All ten camp and objective monsters (`art/blender/units/creatures.py`, `creatures_b.py`), the structures, the four Wicks, pickups, the ward, the sparring post, every unit icon, the four skies, 18 map landmarks and the menu's painted set.
- **Audio.** The 91 non-music cues, the music beds (menu, draft, three match beds with combat layers, post-game) and the three end stings are rendered and committed (`audio/build.py`, `audio/build_music.py`).
- **Bots** fill every open seat in every mode. Their own probes and review are still to do (`HANDOFF.md`).

---

## 2. Research

Eleven notes in `_design/research/` were written on 2026-10-07, before any content was locked. Direct page fetches were blocked in that environment, so the facts come from search-result snippets or, for r10 and r11, from downloaded source code and game-data files. Every note marks what it could not confirm as [unverified], treats every number as a calibration range rather than a value to copy, and ends with "Implications for Vale": what to adopt in original form, what must not be copied, and open questions. The brief named two shipped lane-brawlers as the systems references (listed in §5); below they are "the primary reference" and "the secondary reference".

### r01 · Modes and queues (`r01_modes_queues.md`)

**Question.** Which modes and queues are live, and how do the references run "same map, different rules"?

**Found.** Both references separate a mode (the ruleset) from a queue (pool, pick format, stakes) (§1). Faster casual variants raise the starting state, multiply the economy, shorten logistics and make death cheaper, and picking moves before matchmaking (§5). Recommended: a data model of "Mode = Map + RulesetOverlay; Queue = Mode + PickProtocol + Pool + Stakes", a pre-pick fast queue, and browser match lengths of 15–25 minutes with a staged sudden death (§6a.1–3).

**Decided.** A mode is map + pick format + a complete `RulesParams`; a queue overrides it key by key (`content/modes.json`, `content/queues.json`, CONTRACT §5.5). Code branches on `kind`, `pick` and `end.kind`, never on an id. The Quick queue (`rift_quick`) is the fast front door: role and fighter chosen before queueing, level 3 and 1,250 Gleam, Gleam and XP ×1.15, sudden death at 23:00, about 18-minute matches (`_design/sections/modes_economy.md` §3). Leaving a draft locks re-queueing for 5 s × 2^(n−1), capped at 60 s (`src/session/matchmaker.ts`).

### r02 · RIFT match rules (`r02_match_rules_rift.md`)

**Question.** How does a classic 5v5 three-lane match run in 2026: roles, waves, economy, structures, objectives, vision, surrender?

**Found.** The 2026 cycle cut objective clutter and brought the first wave forward to 0:30 (§1). Roles work as a contract with incentives (§2). Recommended: waves that start soon after load, respawns that scale with level and time, a comeback economy, last-line defences that come back, fewer and more meaningful objectives, and time-gated surrender (§14a).

**Decided.** RIFT's first wave comes at 0:30, then every 30 s: 3 Shieldwicks and 3 Glimwicks, a Greatwick every third wave and a Brightwick every second wave from 15:00. Start 480 Gleam, 2.2 Gleam/s, respawn 6 s + 2.4 s a level (max 50), a kill pays 280, surrender from 12:00 at 4 of 5 (`content/modes.json`). Respawns are shorter than the reference on purpose: "a browser player who waits a minute leaves" (`modes_economy.md` §2). Five positions are the role contract (`content/roles.json`). Objectives are two buff camps (Glasshorn, Resinback), the repeatable Sunsplinter and the late Longshade (`content/units.json`, `content/team_buffs.json`). A fallen Lantern relights 4:00 later (until then the team that broke it holds Lanternwake), so a team that is behind gets its last line back (`modes_economy.md` §9.2).

### r03 · Draft, the single-lane random mode, free-for-all (`r03_draft_singlelane_ffa.md`)

**Question.** Which pick formats work at which roster size, how does a single-lane random mode work, and how do free-for-all modes place players and avoid third-party chaos?

**Found.** Pick protocol is its own axis (§0.1). A draft consumes C = 2T + B fighters, so the roster sets the ban count (§1.6). The reference replaced unlimited rerolls with a guaranteed floor of choices (§0.6, §2.1). Single-lane modes start higher, drop recall and shop only at base or on death (§4a.9). FFA modes need catch-up levers, and placement curves are steep at the top with a flat tail (§0.9, §0.10, §3.4, §3.5).

**Decided.** With 16 fighters, Draft uses 1 ban a team (C = 12) and Ranked 2 (C = 14); bans 20 s, picks 1-2-2-2-2-1 at 20 s a turn, finalize 15 s: 155 s in all (`content/queues.json`, `modes_economy.md` §4). BRIDGE's Lot gives every player at least four fighters to choose from: their draw, the team bench of 2 and one redraw (`queues.bridge_standard.bench`). BRIDGE has no recall and `base_or_dead` shopping. FRAY is a score race with lives, r03's second option, because the paired-rounds model needs a round system the sim does not have: 4 lives, 12 kills or 11:00, streak bounties that make the leader worth more, Sunmotes on fixed timers, one shared cart, and `placementPoints` 10/8/6/4/2/0/0/0/0/0 where 6th to 10th never lose anything. r03 §4c.1 noted that 16 fighters suit a 3v3 draft better than 5v5; the brief requires 5v5, so bans stay small and `bansPerTeam` rises in data as the roster grows.

### r04 · HUD, camera and readability (`r04_hud_camera_readability.md`)

**Question.** How do shipped HUDs, minimaps, pings, death recaps, cameras and spectator views work?

**Found.** Keep the centre clear and the edges dense; colour shows allegiance, shape and position show identity; health in fixed units; structured pings with rate limits; explain every death; the camera is a fairness system (§0). Map geometry should give both teams the same view depth (§9a.8).

**Decided.** The bible's HUD budget: Dial Bar bottom centre, minimap bottom right and swappable (`gameplay.minimapSide`), sky strip on top, always-on HUD ≤ 11% of the screen and nothing in the centre 40% × 50%. Health ticks every 100 HP, heavy every 1,000. A fixed 52° camera with a 26° vertical field of view and the same zoom range for everyone, and every team map attacks along the screen horizontal, mirrored across the noon line (STYLE_BIBLE "In-game camera"). Pings: a wheel on G, at most 5 per 4 s per seat (CONTRACT §5.1, `src/input/controller.ts`), one sound per ping kind (`content/audio.json`), off in FRAY. A death recap sits in the HUD (`src/ui/hud/panels.tsx`).

### r05 · Client flow and menu craft (`r05_client_flow_menu_craft.md`)

**Question.** Which screens and gates does a shipped client have, and what makes menus feel finished rather than placeholder?

**Found.** The client is a funnel of timed gates with a visible state and a fallback each (§0.2). Finished menus come from full state coverage, consistent motion and restraint (§0.8). Recommended: a state matrix as the "done" bar, motion tokens, a small shape language with fixed jobs, and using the shared runtime for live 3D menus (§5a.7, §5a.9–11).

**Decided.** Screens are modules registered by id, with navigation from data (`src/ui/screens/`, `content/client.json`). The ready check lasts 10 s (`READY_CHECK_SECONDS`); draft timers are data. The menus are one live 3D scene, the Rim at the Split Hour, in the same WebGL context as the match. The bible fixes three shapes with one job each (plate, ring, wedge), motion tokens from 60 to 1,200 ms, and every state from hover to "new" (STYLE_BIBLE "Menu mood").

### r06 · Art direction for readability (`r06_art_direction_readability.md`)

**Question.** How do shipped lane-brawlers make art serve readability: value, silhouette, team colour, map, FFA colours?

**Found.** Readability is a priority stack; the dangerous edge of an effect gets the most contrast; hue is a reserved resource; silhouette and value come before colour, lighter at the top and darker at the feet; the environment is a stage; players now expect to set the enemy colour; past about eight players, colour alone fails (§0).

**Decided.** "Stone tells you whose land; light tells you whose side": identity lives in the model, allegiance in overlays and lamp cores. Fighters keep the top quarter at L* 70–85 and the feet at 20–35 and no two may overlap by more than 0.80 (silhouette IoU at 64 px, `art/tools/lineup_qa.py`). "A glow is a warning." The enemy colour is marigold, not red, because red sinks into stone under protanopia. FRAY's ten seat colours each carry a glyph, and Settings offers deutan, protan and tritan palettes plus Stamp-forward and Simple colours for FRAY. The bible also makes self and enemy colours player-set; that setting is not in the settings screen yet.

### r07 · Audio (`r07_audio.md`)

**Question.** How do shipped games use music, announcer, effects and mixing, and how can a small team make cohesive original audio?

**Found.** Audio is readability first; weight follows gameplay importance; enemy threat outranks self, ally and ambience; every client gate needs a sound; the announcer is a priority queue; one palette, one key and one motif give a small team cohesion (§0). Recommended: a shared enemy wind-up sweetener, −18 LUFS integrated and ≤ −1 dBTP, Opus (§7a.2, §7a.9, §7a.14).

**Decided.** One sonic sheet: D Dorian with a Lydian G#, 60/90/120 BPM on an 8 s grid, one four-note motif whose last note changes by mode and result, eight synthesized voices (STYLE_BIBLE "Audio"). Enemy wind-ups of tier 3 and up share one shade-breath swell (`m_enemy_windup`). Cue priorities run from 10 (critical alerts) down to 3–5 (world) in `content/audio.json`. The announcer is tonal with on-screen text; there is no voice in this slice (CONTRACT §11). Files are Ogg Opus mastered to the loudness target (`audio/build.py`).

### r08 · Live service, ranked and the session model (`r08_live_service_ranked_session.md`)

**Question.** How do live games structure progress, currencies, ranked, practice, and the session and server model?

**Found.** One earned and one bought currency, cosmetics only; a hidden rating under a visible ladder; servers tick at about 30 Hz; patches ship as content-addressed chunks behind manifests; replays die when sim data is not versioned (§0). Recommended: a fixed step from day one, separate version tracks for client, sim and catalog, an append-only entitlement ledger and no paid randomness (§7a.5, §7a.7, §7a.12–14).

**Decided.** A deterministic 30 Hz fixed-step sim (`TICK_HZ = 30`, CONTRACT §5.1). A local session with the dedicated-server seam already cut (`src/session/local_session.ts`, `remote_session.ts`, CONTRACT §7). Client and content ship as separate builds with a content-addressed, schema-versioned catalog (CONTRACT §3.1–3.3). Cosmetics never change stats (`probe_sim_skin_neutral`), and every wallet change and owned skin is an append-only record (CONTRACT §8). One earned currency, Candles; no premium currency and no paid randomness in this slice (`content/store.json`). Ranked uses Glicko-2 with 5 provisional matches and seven tiers that climb the sun. r08 §7a.1 preferred OpenSkill and warned that Glicko-2 is built for rating periods of 10–15 games; VALE keeps Glicko-2 per match and relies on the high starting deviation to move new ratings fast (`modes_economy.md` §7).

### r09 · Bots (`r09_bots_ai.md`)

**Question.** How can bots fill every seat in every mode and still feel human?

**Found.** A hybrid utility design; players notice human-likeness more than skill; shipped difficulty is mostly reaction time plus economy cheats; pathfinding must be budgeted (§0). Recommended: bots send player commands only, difficulty without stat cheats, per-fighter bot data in the catalog (§6.1–6.5).

**Decided.** Bots run inside the sim tick, read the same fogged view a player gets and send the same commands (CONTRACT §5.7). A 2 Hz team brain, 5 Hz utility mode choice with hysteresis and 30 Hz combat micro; novice, adept and veteran change reaction delay, aim error and last-hit accuracy, never stats (`src/sim/bots/index.ts`, `difficulty.ts`). Each fighter's `ai` block (style, preferred range, combo order) is content. Draft bots pick by role need (`src/sim/bots/draft.ts`); ranked bots pick a difficulty by rating.

### r10 · WebGL rendering (`r10_webgl_rendering_tech.md`)

**Question.** What should a Three.js r186 WebGL2 renderer use to hold 1080p60 with a scalable quality ladder?

**Found.** Keep `WebGLRenderer` and the pmndrs post stack: the WebGPU renderer is still marked experimental and the AO pass does not support it (§0.1, §9). A post chain of half-float buffers, AO, mipmap bloom, tone mapping, a 3D LUT, vignette and SMAA (§0.3). Blender's Multiple Scattering sky, baked without the visible sun so the game's own sun light does that job (§3.1). No preset may change what a player can see (§0.7).

**Decided.** `src/render/post.ts`: N8AO → VFX pass → bloom → tone mapping → LUT `vale_grade_01` → vignette → overlay → SMAA, with the grade and the overlays identical on every tier. Skies are Blender bakes (`art/out/maps/*/sky.hdr`); fog of war is an R8 texture of your team's vision that every world material samples; Low, Medium, High and Ultra presets (CONTRACT §9.4). One deliberate departure: r10 §1.1 suggested AgX for gameplay, but the bible uses Khronos PBR Neutral everywhere so the menus, the match and Blender previews share one transform (`_design/proposals/JUDGING.md`, graft 10).

### r11 · Protected names (`r11_protected_names.md`)

**Question.** Which names may VALE never use?

**Found.** A registry built from game-data files, not memory: 3,590 whole-word entries and 827 exact-name entries in 21 categories (§0). "Rift" and a short list of signature words are denied as whole words; ordinary words that a reference uses as a proper name are denied only as an entire name; shared genre words stay allowed (§6).

**Decided.** `tools/names_check.ts` checks every catalog name and prose string on every content build (CONTRACT §3.4), reading `protected_names.json`, `_design/NAMES_NOT_USED.md` and `_design/names_allowlist.json`. "Rift" is allowed only as the mode and queue name (§5). Fighter names keep 3 or more edits from every protected character (WORLD §4.2).

The style bible itself came from a contest: three proposals were judged on 2026-10-07 and "The Stopped Dial" won, with 15 grafts from the other two (`_design/proposals/JUDGING.md`).

---

## 3. Stack and why

| Layer | Choice | Why |
|---|---|---|
| Platform | A browser game on the Forgeflow Games site (`npm run package` → `deploy/` for the R2 uploader) | Every research note scoped VALE as a browser game. Menus and match share one runtime, which r05 §5a.7 names as an advantage, and the client boots from a catalog URL so content can move to a CDN without a rebuild (brief; CONTRACT §3.5). |
| Renderer | three 0.186.1 (r186), `WebGLRenderer` on WebGL2; postprocessing 6.39.5; n8ao 2.0.1 | r10 §0.1 and §9: the WebGL path keeps N8AO and the pmndrs post stack and works on every browser; WebGPU stays a seam behind the `PostChain` interface (`src/render/post.ts`). |
| Client UI | Preact 11.0.0 + @preact/signals 2.11.3, DOM over the canvas | CONTRACT §10. One framework and one component library (r05 §5a.5). The HUD reads signals that update once per sim tick (`src/ui/hud/model.ts`). |
| Build | Vite 8.3.3 (dev on port 5190, preview on 5191, both serve `/catalog/*`) | The dev server serves the content catalog exactly as production does (`vite.config.ts`). |
| Language | TypeScript 7.0.2 with `erasableSyntaxOnly` and `.ts` import extensions | Node 22 strips the types and runs the sim, tools and probes directly with no build step (CONTRACT §0). |
| Catalog | A zod 4.6.5 schema (`src/contracts/catalog.ts`, strict) | The content build rejects any record that does not parse. The client imports catalog types only, so zod never ships to players (`src/boot/catalog.ts`). |
| Simulation | Deterministic, 30 Hz fixed step, seeded random streams, entities in id order | Same setup + same commands ⇒ the same result digest (`probe_sim_determinism`). The sim never imports three, preact, the DOM or the render, UI and audio code, and no content id appears in `src/` (`probe_content_ids`). Bots and a future server run the same code (r08 §7a.12). |
| Delivery | Two separately shipped builds: the client (`dist/`, no content) and the content catalog (`dist-catalog/`: manifest, `schema-<n>/<version>/catalog.json`, content-addressed assets) | Content ships without a client rebuild, and old clients keep reading the schema they know (CONTRACT §3.1–3.3; r08 §7a.14). |
| 3D art | Blender 5.2, headless and deterministic. Fighters use "Art 2.0": numpy SDF sculpting fitted to the painted concept sheet, then the concept painting projected onto the mesh, occlusion-aware, as base colour; rig `VALE_BIPED_1`; GLB ≤ 1.2 MB with mesh quantization and WebP textures (glTF Transform 4.5.1 in `art/tools/optimize.mjs`) | The brief requires Blender for hero characters and landmarks; the owner ruled out external 3D generators (2026-10-13) and rejected the first pipeline's mannequin look (`HANDOFF.md` "Art 2.0 method", `art/README.md`, CONTRACT §12). |
| VFX | The v2 runtime `src/render/vfx/system.ts`: particle emitters, ribbons, beams, shockwaves, decals, FX meshes and pooled lights, drawn in a post pass after AO so emissive light blooms and the grade applies | VFX are content: 162 definitions (50 shared `lib_*`, 112 written for the 16 fighters) in `content/vfx.json`, authored in Python (`tools/vfx/vfxkit.py`, `lib_defs.py`, `bespoke/<fighter>.py`, `build_vfx.py`) and checked key by key by the content build (CONTRACT §9.5). |
| Audio | numpy synthesis → Ogg Opus 48 kHz (`audio/`); a WebAudio engine with buses, ducking and voice limits (`src/audio/`) | The brief forbids imported audio and CONTRACT §11 forbids samples from any game, library or pack. `audio.events` binds engine roles to cue ids, so no cue id lives in code. |
| Painted 2D | Grok Imagine in Chrome, then the xAI API: 202 images (16 concept sheets for the modellers, 12 terrain textures, 6 backdrops, 13 key-art pieces, 155 icons) | The owner allowed xAI for 2D only (2026-10-13). Prompts are written from the bible and the fighter briefs; every image is reviewed for text, faces, banned motifs and resemblance before it is ingested (`tools/imagegen/README.md`). |
| Fonts | Gloock, Instrument Sans Variable, Atkinson Hyperlegible Next and Mono (Fontsource 5.3.0, OFL-1.1) | Chosen in the bible for legibility and a monospaced digit set (§4.3). |
| Harness | playwright-core driving the installed Chrome with the GPU | CONTRACT §0: verification happens at the player's layer, with real input and pixels read back. |

---

## 4. The style bible (condensed)

The full law is [`_design/STYLE_BIBLE.md`](STYLE_BIBLE.md); its numbers live in `_design/tokens.json`, and `python3 _design/tools/verify_tokens.py` recomputes every colour figure. When a case is not covered, choose whatever speeds the 200 ms read (**threat → side → health → self → objective**), then extend the nearest rule.

### 4.1 World rules

- **Stone tells you whose land; light tells you whose side.** Shape, stone and the ▲ spire / ◠ dome marks are the same for every viewer. Bars, rings, telegraphs, lamp cores and each fighter's `accent` carry the relationship colour (spectators see side colours; FRAY uses seat colours).
- RIFT is the war for the dial (**Hourfall**), BRIDGE the fight along the fallen needle (**Needlespan**), FRAY the Shadowless Noon on the **Noonplate**. Tone: luminous, competitive, a little melancholy; defeat is dignified.
- Fighters wear carved masks or glass visors. No hair cards, cloth simulation or alpha-card foliage.
- **Banned:** gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green sides.

### 4.2 Palette and value law

Colour is a gameplay resource; the client is ink and chalk. Overlays draw after the grade, so every hex is the screen pixel.

- **UI:** ink `#0B0D11` → `#262C37` (backdrop to pressed), hairlines `#2C333F` / `#3D4656`, chalk text `#EDE6D6` (13.9:1 on panels), chalk-hi `#FFF8EA` for the one call to action, secondary text `#ABA597` and `#8F8A80`, disabled `#6E6B66` (always says why). Brand gloam `#A99BFF` never appears in a match. Warn `#F6D04D` always with ▲, ok `#63D88B` always with ✓; danger is the enemy colour with a "!" wedge.

| Relationship | Default | Deutan · Protan · Tritan | Shape code |
|---|---|---|---|
| **Self** Noonwhite | `#F4EFE2` | `#FBF8F0` in all three | double-frame bar, solid ring with a gnomon wedge at facing, minimap wedge |
| **Ally** Dawn azure (Aubade) | `#3F9CFF` | `#2FA8FF` · `#3F9CFF` · `#2FA8FF` | rounded bar ends, 12-dash ring, round portrait |
| **Enemy / harm** Dusk marigold (Serenade) | `#FF9A1F` | `#FFC21F` · `#FFC21F` · `#FF3D6E` | chevron bar ends, ring with 4 inward notches, portrait with a heading wedge |
| **Neutral** Dialstone | `#A9A49A` | same | square ends, no ring until aggro, square |

The worst relationship pair is ΔE 26.6 and the worst against terrain 21.2 under all four visions. Self and enemy colours are meant to be player-set, with a warning below ΔE 20. There is no red enemy: red sinks into stone under protanopia.

**FRAY seats** look the same to every viewer. The worst pair is ΔE ≥ 10.4 under all four visions (≥ 17.0 normal), ≥ 15.5 from Noonwhite, ≥ 10.1 from harm and ≥ 9.6 from heal, and each seat has at least 3.07:1 on the bar plate. The glyph is the sure key: any pair below ΔE 16 in any vision, or below 5 in grey, gets glyphs from different families.

| Seat 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| Crimson `#B2354A` ● | Olive `#767305` ▲ | Lime `#D9FF17` ○ | Green `#20A04E` ✚ | Cyan `#26F3FF` ■ | Blue `#19AFFE` ⧗ | Indigo `#7273F5` ☾ | Violet `#8121FC` ✖ | Plum `#993F94` ▬ | Rose `#DC6294` ◆ |

You see yourself in Noonwhite with your glyph. FRAY telegraphs stay in the harm colour with the caster's seat tick at the origin. Options: **Stamp-forward** (glyphs 150%, fill 60%) and **Simple colours** (everyone else in the harm colour plus glyph).

| Damage type | Colour | Second code |
|---|---|---|
| Physical | Chalkstone `#F1E2C6` | upright numerals |
| Magic | Orchid-rose `#FF7BD5` | oval chip in tooltips and recap |
| True (ignores armor and resist) | `#101216` numerals with a 2 px Noonwhite halo | value inversion |
| Heal | Sap `#63D88B` | "+" prefix, always rises |
| Shield | Dawnglass `#DCE8EE` | 45° hatch |

Ranks brighten as they climb the sun: Lamplit, Greylight, Rosewake, Clearmorn, Highsun, Noonward, Unshadowed. Item tiers are hour-ticks on the frame: Slate, Verdigris, Gloam, Noonlit. Resources are Light `#8F86F0`, Tally `#E8C27A` and Heat `#D96A4A` (hatched).

**Value law for fighters:** the top quarter sits at L* 70–85 and the feet at 20–35, at least 40% of the figure is rest, features are ≥ 6 cm, and the accent covers ≤ 5% (top half), held below the bloom threshold at rest (≤ 0.8) and blooming only in wind-ups (≥ 1.5).

### 4.3 Type

| Role | Face | Job |
|---|---|---|
| Display | Gloock 400 | results, mode and screen titles; never below 28 px |
| Heading | Instrument Sans Variable (wght 400–700, wdth 75–100) | caps headings, labels, buttons at wdth 88–90 |
| Body | Atkinson Hyperlegible Next | running text, names, chat |
| Numeric | Atkinson Hyperlegible Mono (every digit 632 units) | every number that changes |

Nothing below 12 px at any UI scale (0.8–1.5). Display is Title Case; caps only for one-word results and mode names. No faux bold, outlined or gradient text, no text in images, and 35% headroom for localisation.

### 4.4 Menu mood

*Honed stone in long light.* One live 3D scene, **the Rim at the Split Hour**: a terrace on the dial's rim, the Glass Belfry on the left, the Lamp Dome on the right, the fallen needle below, and a low sun from the left whose shadow edge creeps 1° a minute. Every screen is a camera position in it.

- **Mode Dial:** RIFT (three roads crossed by the noon line), BRIDGE (one line over an arc), FRAY (a ring of ten ticks) and the uncarved hour. Choosing swings a gnomon shadow clockwise to it in 360 ms. Modes get no colour.
- **Surfaces:** ink plates at 94%, 2 px radius, a 1 px top-left catch-light, 2% grain. No backdrop blur, gold or metal.
- **Shapes:** plate = structure, ring = time and state, wedge = act, chosen, facing. Ornament only tells time, rank or rarity, at most two per panel.
- **Grid:** 12 columns of 122 px with 24 px gutters and 96 px margins; the 3D subject in columns 7–12, UI in 1–6; one chalk call to action per screen, bottom right; Back top left and Esc.
- **Motion:** 60 · 100 · 160 · 240 · 360 · 720 · 900 · 1200 ms. Enter on `dawn`, exit on `dusk` at 0.7×, `swing` for rewards only. Forward is clockwise. The 30°, 900 ms shadow-line wipe is reserved for client ↔ match. Reduced motion: 120 ms fades and camera cuts.
- **States:** hover = keyboard focus, pressed moves 1 px with sound on pointer-down, selected keeps a chalk hour-tick, disabled says why, locked shows a dashed border and the unlock path, loading is a final-size skeleton, empty is one drawing, one sentence and one action, errors carry a Retry, timers sweep a ring and turn to harm in the last 5 s.
- **Budget:** ≤ 3 ms GPU, 30 fps after 4 s idle, paused when hidden. UI sounds are glass and wood, never beeps.

### 4.5 In-game camera

Pitch 52°, vertical field of view 26° (44.6° horizontal at 16:9), distance 28.5 m, zoom 24.5–33.0 m and the same for everyone (spectators 20–44 m), yaw fixed. That is 82.1 px/m at the focus: a 1.9 m fighter is **96 px** tall at 1080p and 64 px at 720p. **Every team map attacks along the screen horizontal** (Aubade on the left) and mirrors across the north–south noon line, so both sides see the same depth. Abilities up to 10 m stay on screen; longer ones get an edge marker. Camera modes: locked, semi-locked (6 m leash), free, hold-to-scout. Readability signs off at 720p, default zoom, Low tier.

### 4.6 HUD density

| Element | Where | Size at 1080p |
|---|---|---|
| Dial Bar | bottom centre | 640 × 132 |
| Minimap RIFT · BRIDGE · FRAY | bottom right (swappable) | 352 × 198 · 384 × 96 · 232 disc |
| Sky strip (score, clock, objectives) | top centre | 720 × 48 |
| Ally frames · Hour Board | left edge · top right | 4 × 168 × 52 · 220 × 236 |
| Overhead bar | head + 0.35 m, fixed screen size | HP 82 × 9 over resource 82 × 4; ticks every 100 HP, heavy every 1,000 |

Always-on HUD ≤ 11% of the screen (RIFT 10.79%, BRIDGE 9.20%, FRAY 10.84%) and peak ≤ 17%; the centre 40% × 50% holds no HUD. Cooldowns are ink shadows sweeping clockwise from 12 o'clock. Enemy telegraph fill 16 → 30% with a 90% edge, ally edges at 45%, overlaps capped at 40%; telegraphs are never white, never pulse above 2 Hz and look the same on every tier. Damage numbers show only your own hits and heals of ≥ 5% max HP, merged per 0.5 s, at most 8 on screen.

### 4.7 Look rules

- **Lighting:** one sun behind-left of the camera (Hourfall 52°/215°, Needlespan 46°/200°, Noonplate 86°/200°). Fighters carry their own key light in the shader and keep ≥ 75% brightness in shadow. Skies are Blender Multiple Scattering bakes with the visible sun left out. No distance fog, no cloud shadows, walkable roughness ≥ 0.5. Fog of war: value ×0.55, saturation ×0.4; the Standing Shadow keeps its colour and hard edge.
- **Grade:** Khronos PBR Neutral at exposure 1.0 everywhere and one locked 33³ LUT, `vale_grade_01` (cool lift, warm gain, +6% contrast, world chroma near the team hues ×0.85 below value 0.85 so accents keep their hue). Order: N8AO → bloom (threshold 1.0) → tone map → LUT → vignette → overlay → SMAA.
- **Fighters:** role is mass. Plinth a block, Breaker an inverted wedge, Striker a forward diagonal, Slinger a horizontal, Caster a line plus a disc, Tender round with a light vessel. Silhouette overlap ≤ 0.80 at 64 px; 2–4 cm bevels.
- **VFX:** two families. **Lumen** is additive light and glass shards; **Shade** is ink with a light rim. Emissive caps by tier T0–T4: 0.8 · 1.5 · 3 · 6 · ≥ 10, and only T4 reaches white. The danger edge is the brightest part, impacts throw opaque chips, up means help and out means harm, and allies' effects draw at 65%.

### 4.8 Audio direction

D Dorian with a Lydian G#. 60 BPM in menus, 90 in draft, 120 in the match, on an 8 s grid. The motif A4–E5–D5–B4 ends on F#5 (RIFT, victory), G4 (BRIDGE), G#4 (FRAY) or a held B4 (defeat). Eight synthesized voices: dawnglass, hourbell, dial harp, lamp drone, frame drum, escapement, shade breath and FM shimmer. Enemy wind-ups of T3 and up share one shade-breath swell. Mastered to −18 LUFS, −1 dBTP.

---

## 5. Names deliberately not used

The full record is [`_design/NAMES_NOT_USED.md`](NAMES_NOT_USED.md). `tools/names_check.ts` reads it on every content build, so its 54 bulleted names fail the build if they ever appear as a catalog name; its tables keep the rest of the record. In summary:

1. **World and premise names.** A kiln world of fired-clay fighters was dropped after a web check found Double Fine's *Kiln* (April 2026), a team brawler about pottery. "Kiln" is banned inside any name, and 19 kiln-world names are banned outright (Kilnhollow, Handlespan, Wheelhead, the Wheel and others). Fourteen more candidates were rejected for collisions with existing games, films, brands or reference terms, among them Sundial (a seasonal activity in another shipped game), Penumbra, Meridian, Cairn and Spindrift. A third world, a chalk vale above a sea of cloud, was not adopted; its names are recorded but not banned.
2. **Role, class and term names.** The winning proposal's role names (Vanguard, Warden, Marksman) were the primary reference's class names, so the classes became Plinth, Breaker, Striker, Slinger, Caster and Tender. Keeper was dropped as too close to a reference hero in a light-themed world, and the glyph called Hourglass became the sandglass. Genre words get in-world names: fighter, Wicks, Gleam, Needle, Lantern, Hourbell, Noonline, Dialwood, Needlegrass, Sunmotes, battle spells, boons and paths, and "damage that ignores armor and resist".
3. **Fighter names too close to protected characters.** Seventeen rejected: eleven within two edits of a registry name (Obran is two edits from Brand) and six too close to characters in other games or to real people.
4. **Reference kits each fighter does not echo.** For all 16 fighters, the two to four closest shipped kits and what VALE's kit does instead (ROSTER §5).
5. **The protected-names registry.** 3,590 whole-word and 827 exact-name entries in 21 categories. The brief also names League of Legends, Dota, Riot, Summoner's Rift and Howling Abyss as off limits; all are in the registry.

**The one exception: "Rift".** This paragraph is the record that `_design/names_allowlist.json` points to as "DESIGN_NOTE §Names". The registry denies "Rift" as a whole word, and r11 §6 recommended renaming the mode, because a three-lane map called "Rift" in this genre reads as a direct borrow. The owner's brief names the mode RIFT, so the allowlist permits it **only** as the mode name, the queue names, mode-select labels and UI strings. No map, objective, structure, fighter, item or currency uses it; the RIFT map is Hourfall. If the owner wants to drop the risk, the only fallback checked so far is **KEELBREAK** (clear on 2026-10-07, `_design/proposals/bible_clarity.md`). It comes from the cloud world that was not adopted, so a new dial-world name, run through the same checks, would fit VALE better.

---

## 6. Verification

**Gates.** `npm run check` runs `tsc --noEmit`, the content check and every probe. On the working tree of 2026-10-14, typecheck was clean and **37 of 37 probes passed** (`node _harness/run_probes.ts`, run twice, before and after `_design/NAMES_NOT_USED.md` joined the deny-list): 7 content and tooling probes, 6 session probes and 24 sim probes, including determinism, skin neutrality, content ids kept out of code, schema negotiation and a full bot-played session flow for every queue kind. The content check passes with `--allow-missing-assets`; without that flag it fails only on asset files that are still being made (fighter and skin models, portraits, splashes and icons, monster models, unit icons), so plain `npm run check` stops at its content step until that art lands. The names check runs clean in both cases.

**The DONE journey** (`node _harness/e2e.mjs all`, with `npm run dev` running) drives the installed Chrome with real clicks and keys. Your seat plays on the dev autopilot at 16× time so each match reaches a real win condition; bots fill every other seat. The last run (2026-10-14, 06:24–07:30 UTC) passed all four journeys:

| Journey | Result |
|---|---|
| RIFT (Co-op vs bots) | Home → Play → match found → Ready → pick in the draft → loading → in-match shop and scoreboard → **Victory** after 34:26 of match time → post-game, 250 Candles → Home |
| BRIDGE | Lot → match → **Defeat** after 23:41 → 152 Candles |
| FRAY | pick → match → **4th of 10** at the 11:00 limit → 94 Candles |
| Store | Shop → buy the Chalkline Pavise skin for Ardit → equip it |

Both team matches in this run went long (RIFT 22–28 min, BRIDGE 14–20 min targets); one bot-filled run does not measure pacing. `_harness/pacing.ts` does (all-bot matches, many seeds): RIFT mean 24.8 min over 10 seeds, FRAY 9.3. BRIDGE ran 25.2 (17.7–53.2 over 20 seeds) until 2026-10-20, when its respawns were lengthened (8 s + 2 s a level, ×1.45 from 9:00) and sudden death moved to 16:00 with respawns ×3: now 19.0 (14.1–22.9). Short respawns let a losing team stall the one road forever; longer ones turn a won fight into a push. Screenshots land in `_harness/_shots/`.

**1080p60** (`_harness/perf_1080.mjs`, report `_harness/_reports/perf_1080.json`): the real renderer in Chrome on the GPU at 1920 × 1080, DPR 1, with the HUD on, ten minutes into a live RIFT match, camera on the densest fight, 8 s per preset. GPU: Apple M5 (ANGLE Metal).

| Preset | fps | avg ms | p95 ms | p99 ms | render scale | draw calls | triangles |
|---|---|---|---|---|---|---|---|
| Low | 59.2 | 16.90 | 17.1 | 18.5 | 0.75 | 359 | 1.19 M |
| Medium | 58.7 | 17.04 | 18.0 | 18.5 | 0.9 | 402 | 1.47 M |
| High | 58.0 | 17.23 | 17.0 | 18.2 | 1.0 | 410 | 1.77 M |
| Ultra | 39.9 | 25.04 | 34.7 | 35.4 | 1.0 | 415 | 1.78 M |

Low, Medium and High hold the display's 60 Hz (vsync-capped, p95 about 17 ms), which meets CONTRACT §9.4's target of a stable 1080p60 on High. Ultra does not (40 fps). Limits of this result: one machine, an Apple M5 rather than a Windows gaming GPU; RIFT only; and the bench runs with `?dev=1`, so 15 fighters are the proof mannequin, not their final models, and the monsters were not all in yet. Measure again once the Art 2.0 fighters (10–25k triangles and ≤ 1.2 MB each) and the monsters are in.
