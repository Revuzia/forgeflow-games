# VALE: final League-of-Legends parity review (gauge only)

2026-10-28. Build: branch `claude/youthful-ramanujan-gdud5w`, HEAD 025b995d. `src/` and `content/` are unchanged since 1d176f8a, so every dimension measured the same code.

This review rolls up 8 dimension reviews. Each one was checked again by an adversarial verifier, and no finding was refuted. The source data is in `_design/reviews/final/*.json`, and the machine-readable fix list is in `final_parity_open.json`.

LoL is used only as a gauge. Every fix proposed here is VALE's own, per STYLE_BIBLE.md and WORLD.md. Ilsheta's art is excluded because it has its own fix pass.

## (a) Verdict

**VALE is not on par with League of Legends today, but it is no longer far below it on presentation.** Of r12's 24 gap IDs, 15 are closed, 9 are partly closed and none is still fully open.

| Dimension | Score | Where it stands |
|---|---|---|
| HUD | 7 | Nearest to par. It has LoL's full feature set, but item icons and fighter chips cannot be told apart at slot size. |
| Maps | 6.5 | The value band now matches LoL. Landmarks are still greybox and fog is twice too dark. |
| Performance | 6.5 | Holds a steady 60 fps at 1080p High. It leaks about 190 MB of GPU memory per match, and the shipped client quietly renders at 80 %. |
| Combat | 6 | Lead times, wind-ups, CC looks and ultimate brightness are within LoL's ranges. Every cone indicator is drawn inside-out. |
| Menus | 5.5 | Flow and speed match LoL's. The menus look unfinished, and masked horror figures are on the first screen. |
| Originality | 5 | A public API key is exposed, and the rules layer maps onto LoL's. |
| Audio | 4 | One shared sound library. Enemy pings are audible, and match-found is silent in a background tab. |
| Gameplay | 4 | Bots leave their lanes, the jungle falls 4 levels behind, and the difficulty tiers barely differ. |

Between VALE and par stand **8 blocker findings (7 distinct defects)**, 6 of them size S or M. Behind those are **33 majors**, which make two points:

- **Identity:** fighters are not yet individually identifiable by colour, sound, chip or signature hook.
- **Bots:** they do not play a LoL-shaped match (laning, jungle, difficulty, pacing).

The five fix waves in (d) cover every one of these and can run in parallel. The plain average of the scores is 5.6/10.

## (b) Scorecard (verified scores)

| Dimension | /10 | State in one line |
|---|---|---|
| HUD & in-match readability | **7** | B1, M4, M7, M10, m1 and m2 are closed. Item icons are one dark navy family (median p50 31/255). Fighter chips are pale look-alikes (ardit–lisvel distance 33.7). Your own T/F/A and Wicks are never on screen. |
| Maps & environment | **6.5** | B5 value probe passes (lane p50 86–91). Landmarks are pre-Art-2.0 primitives. Fog shows ×0.21–0.32 against the ×0.55 spec. Ground just north of walls hides fighters on 15 % of walkable cells. 4 Outer Needles stand in brush. |
| Performance & stability | **6.5** | 60.1 fps at 1080p High, p99 16.8 ms, CPU 1.23 ms. Probes 40/40, e2e all pass. The post chain leaks 47 render targets per match (+157–266 MB GPU). Dynamic resolution sticks at 0.8 on 60 Hz displays. |
| Combat feel & VFX | **6** | M1, M3, M6, m4 and m5 are closed. Ultimate peak is 2.27–2.64×. Cones are filled inside-out. Recall shows for about 1 s of 6.9 s. 3 of 4 ultimates re-flash every 1 s. 4 kits lose their hue in play. |
| Menus & client flow | **5.5** | Fast flow, and all 16 portraits are present. 4 of 5 Home paintings show blank or horror masks. Leaving a draft strands the client without navigation. Menus use bright studio renders, the post-game table is broken, and text clips at 720p. |
| Originality, legal & sensitivity | **5** | No LoL asset was copied. A Meshy key sits in 10 tracked files of a public repo. The Home 'Your collection' tile shows eared cowls and skull plates. Battle spells, items and buffs track LoL's. Ervet's ultimate matches Riven's. |
| Audio | **4** | Mastering is clean. 16 kits share 27 generic cues. The queue pop is silent when the tab is hidden. Enemy pings and surrender votes play for you. No ambience. 1,778 passive procs per 9 min make no sound. |
| Gameplay, bots & pacing | **4** | Deterministic, 0 faults. Solo laners have 19–25 cs at 10:00 and Wicks kill 63 % of Wicks. The jungle is 3.7–4.0 levels behind. Veteran beats novice only 14 of 24 times. The first Needle falls at a 5.4–6.3 min median. |

## (c) r12 gap status

B3 is marked partly only because Ilsheta is still in her fix pass. A per-fighter art review follows.

| ID | Gap (r12) | Status | Evidence |
|---|---|---|---|
| B1 | Hover freezes the world | **Closed** | `overlay_regress --q high` PASS. Node count stays at 2494 before, during and after a 180-frame hover. e2e shows 0 page errors (`_harness/_reports/final_hud_verify_overlay_regress.json`). |
| B2 | No telegraph or aim drawn | **Partly** | Circles, rings and rects draw. Every cone is filled inside-out: the axis reads alpha 0 while the ground behind the apex fills to 43–102. Cause: `src/render/overlay/telegraphs.ts:76` (combat F1). |
| B3 | Fighter art missing | **Partly** | 15 of 16 fighters are final Art 2.0; Ilsheta is in progress. All 16 portraits show in draft, loading and collection (`final_client_v_1920_draft_myturn.png`). A per-fighter review follows. |
| B4 | No 60 fps at 1080p | **Closed** | High: 60.1 fps, p99 16.8 ms, 179 draws, 385k tris (`final_perf_verify_perf_1080.json`). Caveats: the gate flips on vsync jitter (PERF-V1), and the real client renders at 0.8 scale (PERF-M2). |
| B5 | Ground owns the bright band | **Closed** | `final_maps_value_probe.json` PASS on all maps and both tiers: lane p50 86–91, env180 0 %. Bases are not probed (env m1). |
| M1 | Late or hidden warnings | **Closed** | All 13 delayed damaging areas are 'everyone' with ≥ 0.60 s lead. The build lint is in force. |
| M2 | CC invisible and unnamed | **Partly** | All 17 CC kinds have a sustained look, and a hard-CC drain strip exists (`renderer.ts:148`, `:814`). No status word or icon on the bar (combat F5). By ear, hostile CC plays a friendly buff (AUD-5). |
| M3 | No cast anticipation | **Closed** | 48 of 48 casts ≥ 0.12 s have a windupVfx. |
| M4 | HUD hides loss of control | **Closed** | 'SILENCED 3' chip, slashed slots, refusal captions (`final_hud_s3_07_silence_press.png`). |
| M5 | Basic attacks slow and thin | **Partly** | Ranged wind-ups 0.31–0.38 s. 6 of 8 melee are 0.406–0.452 s, against LoL's ≤ 0.40. Impact fades in about 100 ms. Hesmi's tip travels only 0.61 m (combat m-1, m-2). |
| M6 | Struck unit never reacts | **Closed** | Victim box luma 94 → 226–239 at the beat; the flash series is 0.7 → 0 by frame 5. |
| M7 | Bars undersized, trail invisible | **Closed** | Self bar is 104×10 with the white lost-HP span (`final_hud_s3_04_selfhit_combo.png`). |
| M8 | Wicks identical and too bright | **Partly** | Team models differ, with rounded hoods, one light and no face (`final_originality_wick_hoods_aubade.png`). Hood value L* 64–66 is a recorded leftover (`wave_b_open.json`). A latent faced 'Wick wave' is in `rift_card.webp` (W2). |
| M9 | Structures oversized, hide units, vanish | **Closed** | 317-point sweep with 0 failures, ratio 2.38–2.46, collapse to ruin. Terrain occlusion is a separate gap (env F4). |
| M10 | No always-on outline | **Closed** | m10: 9 units, 0 missing, restWidth 1 (overlay_regress). |
| M11 | Plastic foliage | **Partly** | Every r12 gate passes: canopy p50 51–56, brush bend, 0 px leak. The plates are not painted (env F5, minor). |
| M12 | Kits not identifiable by effect | **Partly** | Content meets the spec: signature 56–80 % of emissive layers. In play, signature share is Tunlan 0.04/0.08, Rishal 0.11/0.00, Hesmi a2 0.01, and Odrum sits in the HARM band (combat F6). No per-fighter sound (AUD-1). |
| M13 | Ultimate has no envelope | **Partly** | Core peak 2.27–2.64× meets 2.3–2.5×. Kemdo, Rishal and Hesmi re-fire the beat every 1 s (combat F3). Tunlan's cone and Rishal's rect are anchored on the caster (F4). |
| M14 | No ambient life | **Closed** | `final_maps_ambient.json` all pass (faintness is a recorded leftover). Audio has no ambience bus content (AUD-8). |
| m1 | Dial Bar states | **Closed** | M:SS cooldowns, regen readout, ledger flyout (`final_hud_1080_10_scoreboard.png`). |
| m2 | Death, level-up and kill banners | **Closed** | Desaturated death, 'YOUR LAMP GOES OUT' with two portraits, LEVEL plate. Level-up and kill-banner timing were not measured. The level-up cue has 119 ms of dead air (AUD-m1). |
| m3 | Minimap anonymous dots | **Partly** | The chip is 29–31 px, at LoL's lower bound. Identity fails: 9 of 15 chips are pale, and 11 of 105 pairs are under 45 (HUD-2). |
| m4 | Camera shake | **Closed** | Camera displacement 0.0000 in 4 ultimate runs. 0 feel layers have shake. |
| m5 | No distortion | **Closed** | 33 defs carry a distort layer. |
| §4 fog | r12 scored fog as 'matches ×0.55' | **Open** | Fog A/B ratio is 0.23–0.32 at fully fogged spots. The FRAY plate goes from luma 84 to 19. Cause: `world_material.ts:84-91` ignores the tone map and LUT (env F3). |

## (d) Fix plan: 5 parallel waves

The waves own **disjoint files**, so they can run at the same time. Inside a wave, blockers go first.

**File ownership:**

| Wave | Owns |
|---|---|
| W1 | `src/render/**` (but not `menu.ts`), `content/vfx.json`, `_design/tokens.json`, the perf, overlay and value harnesses, `package.json`, `pipeline/*.py` |
| W2 | `src/ui/**`, `src/render/menu.ts`, `src/session/{settings,grants}.ts`, `content/ui/**`, `public/`, `tools/imagegen/**`, `content/{client,strings.en}.json`, `_harness/e2e.mjs` |
| W3 | `src/audio/**`, `audio/**`, `content/audio.json`, `src/boot/main.ts` |
| W4 | `src/sim/**`, `src/contracts/**`, `src/session/draft.ts`, `content/{units,items,setup,team_buffs,modes,queues}.json`, `content/fighters/*.json`, sim, pacing and item probes, `ROSTER.md`, `items_setup.md`, `modes_economy.md` |
| W5 | `art/**` (never Ilsheta's paths while her pass runs), `content/maps/*.json`, `_design/tools/map_gen.py` |

**Agreed seams.** These are interfaces fixed up front, so no file is shared:

- W1 adds a `Renderer.listenerFocus()` getter, and W3 wires it in `boot/main.ts`.
- Per-fighter sounds are cues named `f_<fighter>_<slot>`, which the audio engine resolves before `present.sfx`. W3 therefore does not edit `content/fighters`.
- W2 plays `f_<id>_call` at lock-in and `ui_queue_remind` 4 s before the ready check expires. W3 authors both cues.
- W2 generates every new icon, including W4's new items and spells (placeholder glyph until then).
- W1 authors any new VFX for W4's Ervet and Vashil kits after those kits land.
- W4 hands W5 any camp-respawn numbers, because those timers live in `map_rift.json`.
- New player strings from W4 go to W2.

**Before any wave:** the owner revokes and rotates the Meshy key in the Meshy dashboard. Only rotation fixes a key that is already public.

### W1: Engine (truthful danger cues, full-resolution frames, flat memory, readable fog and walls)

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | combat F1: cone telegraphs and aim inside-out. Change `sdSector` to `sign(c.x*p.y - c.y*p.x)`. | **blocker** | S |
| 2 | originality F1: Meshy key in 10 tracked `pipeline/*.py` files of a public repo. Load it from env, add a secret grep to `npm run check`, purge history only with owner approval. | **blocker** | S |
| 3 | combat F3: ultimates re-fire the ×2.4 beat every 1 s. Key the envelope to the cast instance. | major | S |
| 4 | combat F2: recall effect visible for about 1 s of 6.9 s. Sustain while state is recall; author a looping dial-ring channel. | major | S |
| 5 | perf PERF-M2: dynamic resolution stuck at 0.8 from the menu. No sampling in menus or idle cap; configure at setup; up-probe; ignore stale GPU times. | major | S |
| 6 | perf PERF-M1: post chain leaks about 190 MB GPU per match. Build once per quality and dispose old passes. Also prop and crowd geometry. | major | M |
| 7 | env F3: fog ×0.21–0.32 against the ×0.55 spec. Calibrate on the display after tone map and LUT, using one function for all materials. | major | M |
| 8 | env F4: walls hide fighters within 1.7 m north of a block. Draw an occluded-unit silhouette and cap lips within 2 m of lanes. | major | M |
| 9 | combat F6: 4 kits lose their signature hue in play. Re-tune cores in `vfx.json`, give Odrum a cool core secondary, add a hue gate to `vfx_gallery`. | major | L |

**Done when:**
- `overlay_regress` has a cone case: the axis at r/2 is filled, and ±90° and 0.4 m behind the apex are empty, for both enemy telegraph and own aim. It passes.
- Recall VFX shows at every 0.5 s sample through the channel.
- Each ultimate cast produces exactly 1 lift start of ≥ 1.3.
- dynlive: renderScale is 1.0 after 90 s in a match on an idle 60 Hz machine.
- leakid (4 identical rebuilds): render targets, geometries and textures at menu_5 are ≤ their menu_2 values, and GPU-process growth is ≤ 3 %.
- Fog A/B gives a ratio of 0.50–0.60 on lane, plate and jungle at both tiers.
- wallmask: 0 walkable spots leave a fighter under 50 % readable.
- Hue probe: signature share ≥ 0.5 on every a1/a2 slot.
- 0 `msy_` hits in tracked files.
- `perf_1080` still runs at 60 fps with p99 ≤ 25 ms.

### W2: Client front door & HUD (UI code and UI art)

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | client F1 + originality F2: 4 of 5 Home paintings show blank, horror or skull masks, and the collection tile shows eared cowls. Repaint with named roster fighters and add sensitivity negatives and sign-off. | **blocker** | M |
| 2 | client F2: leaving a draft strands the client with no navigation. Clear draft on flow-ending queue events, derive chrome from the route, add an e2e dodge journey. | **blocker** | S |
| 3 | AUD-2 (UI half): queue pop missed in a background tab. Add a Notification, a favicon badge and the 4 s reminder trigger. The engine half is in W3. | **blocker** | S |
| 4 | Latent: `rift_card` shows a faced 'Wick wave', and `bridge_card`/`fray_card` show full-face masks. Repaint before F6 displays them. | major | S |
| 5 | client F4: post-game columns misaligned and items shown as letters. Fix the `.srow` class collision with `hud.css:349` and use the icon component. | major | S |
| 6 | HUD-4: no always-on personal T/F/A or Wicks. Add a Mono 13 ledger line on the sky strip. | major | S |
| 7 | client F9: 1280×720 truncation and content under the footer. Add a 720p token set and a CI sweep. | major | M |
| 8 | client F6: Play screen has no mode art, the default queue is below the fold, and the gnomon crosses the title. | major | M |
| 9 | client F5: draft never shows your fighter large and has no lock-in beat. Use `setMenuView` on hover and lock, plus an original lock-in beat. | major | M |
| 10 | client F8: Collection Skins sparse, with 16 of 32 names clipped. Use a 3:4 tile grid. | major | M |
| 11 | client F3 (UI half): loading cards crop to 3:5 with the fighter at 70–80 % of height. The plates are in W5. | major | S |
| 12 | client F7: Home is static. Add a progress band: level ring, first-win candle, Play again. | major | L |
| 13 | HUD-1: item and ability icons read as one navy family. Tint grounds by ledger family, subject ≥ 60 % of frame, add an icon probe. | major | L |

**Done when:**
- Every image in `content/ui/home` and `content/ui/modes` (plus `public/thumbnail.png`) passes sensitivity sign-off. Each figure is named to a roster id. None shows a blank full-face mask, animal-ear cowl, skull plate, pointed hood or faced Wick.
- The e2e dodge journey asserts 6 nav items and the wallet on Play and Home.
- Post-game header and cell x-centres match within 4 px at 1920 and 1280.
- The 720p sweep finds 0 clipped labels and no text under the footer.
- The selected queue and Find match are above the fold at 720p.
- The draft shows the hovered or locked fighter at ≥ 200 px.
- Icon probe at 38–40 px: p50 ≥ 60, p95 ≥ 190, and no ground shared across families.
- Hidden-tab queue pop fires a Notification. Together with W3, it peaks at ≥ −12 dBFS.

### W3: Audio (fair gates, identity by ear, a world that sounds alive)

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | audio (missed): enemy pings and surrender votes play for you, which leaks enemy comms in online PvP. Gate on team and add a regression probe. | **blocker** | S |
| 2 | AUD-2 (engine half): queue pop is digital silence when hidden. Add an alert bus after the background-mute gain with a floor, plus a reminder cue. | **blocker** | S |
| 3 | AUD-9: listener sits at your fighter or corpse, not the camera (against CONTRACT §11). Listener at the camera focus, plus a 10 m awareness pass. | major | M |
| 4 | AUD-5: fear, sleep, airborne, taunt, disarm and silence play friendly `c_buff`. Give each CC its own cue and spatialise the enemy T3+ wind-up swell. | major | M |
| 5 | AUD-6: 1,778 procs per 9 min are silent and 12 of 16 passives have no sfx. Add a `proc` handler, voice passive damage, add a build gate. | major | M |
| 6 | AUD-8: no ambience anywhere; the slider drives an empty bus. Add 4–6 emitters per map from the existing `art.ambient` points, with the table in `audio.json`. | major | M |
| 7 | AUD-1: no fighter audio identity (27 shared cues, ultimate pair in 12 of 16 kits). Author `f_<fighter>_*` kits with 3 round-robin variants and build gates. | major | XL |

**Done when:**
- The `final_audio_verify_qpop` re-run, hidden tab at default settings, peaks at ≥ −12 dBFS.
- The enemy-ping probe hears 0 cues for other-team pings and surrender votes, and own-team pings still play.
- `audio/build.py` gates:
  - no attack or ultimate cue is shared by two fighters;
  - attack and ultimate cues differ by ≥ 8 dB in 1/3-octave distance between fighters;
  - every cue that fires more than once per second has ≥ 3 variants;
  - every CC kind has its own cue;
  - every passive with a payoff has a proc cue.
- The ambience bus has more than 0 cues.
- A dead-spectating capture hears the fight at the camera.

### W4: Gameplay, bots & systems (a LoL-shaped match made of VALE's own rules)

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | G1: bots leave their lanes. Laners have 19–25 cs at 10:00, Wicks land 63 % of Wick kills, and 10 recalls per 25 min. Lane-first utility, Wick DPS in situate(), stricter Longshade check, role-correct `pacing.ts` and a soak gate. | **blocker** | L |
| 2 | G4: first Outer Needle falls at a 5.4–6.3 min median. Dawn Seal to 7:00, needle_outer at about 4,000 HP, thin-wave protection. | major | M |
| 3 | G2: jungle 3.7–4.0 levels behind at 15:00. Camp XP to ≥ 80 % of lane rate, Grove tithe catch-up, clear loop. | major | M |
| 4 | G5: BRIDGE ends in sudden death in 15 of 20 games, and 10 of 20 skip the chain. Keep `requires` protection and replace the drop with Gorge Wind. | major | M |
| 5 | G3: veteran beats novice only 14 of 24. Add lead conversion and the macroDelay and convertsLeads knobs. | major | L |
| 6 | originality F5: Ervet's ultimate is Riven's reforged-blade reach, and Vashil echoes Brand. Move Ervet's payoff to the shards and give Vashil a chord stun; list both in ROSTER §5. | major | M |
| 7 | originality F4: battle spells, starters, potion, boots, ward, the one-Noonlit rule, buff camps and BRIDGE rules map one-to-one to LoL's. Re-key them to the stopped dial. | major | L |
| 8 | G7: 13 finished items, the same build every game, apex in ≤ 7 of 160, no anti-heal. Grow to about 30 with VALE counters and an enemy-aware buildPlan. | major | XL |

**Done when:** the new `probe_sim_bot_soak.ts`, run on role-correct `pickLoadout` lineups with ≥ 20 seeds at adept and at veteran, shows all of the following:

| Measure | Target |
|---|---|
| Wicks dying before 14:00 last-hit by fighters | ≥ 50 % |
| Solo laner cs at 10:00 | ≥ 45 |
| In-lane share of laning time | ≥ 65 % |
| Fighter deaths to Wicks or monsters with no enemy fighter involved | ≤ 5 % |
| Jungler gap to solo laners at 15:00 | ≤ 1.5 levels |
| Median first structure | 9–12 min |
| Veteran beats novice | ≥ 85 % |
| Veteran beats adept | ≥ 65 % |
| BRIDGE games ending in sudden death | ≤ 25 % |
| BRIDGE cores falling with their chain standing | 0 |
| Finished items per player by 25:00 | ≥ 2.5 |
| Finished items bought at least once over 40 games | ≥ 80 % |

Also: the owner signs off the re-keyed systems table, with no headline number within 10 % of a LoL counterpart.

### W5: World & character art

Runs as three internal streams with disjoint directories: maps, fighters, units.

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | env F6: four side-lane Outer Needles stand inside thickets 4–7, which hides defenders asymmetrically. Keep-out of r + 3 m in `map_gen.py`, then regenerate. | major | S |
| 2 | originality F3: Odrum Shadeprint's grey mask and Longshade's ink tears sit near the horror line. Warm lacquer or amber eye inlay, remove the tears. **Owner call.** | major | S |
| 3 | HUD-2: fighter chips are pale look-alikes. Add a head-and-shoulders face-chip pass on dark ink with a signature-hue rim, rendered to `icon.png` in place. | major | M |
| 4 | env F1: greybox landmarks (Shaft drum, Snap stubs, Arch, Belfry, slabs) and bare out-of-bounds planes. Art 2.0 pass, plus a 20–30 m dressed skirt at L* ≤ 52. | major | XL |
| 5 | client F3 (art half): fighter images are bright studio renders (loading cards p50 205). Painted dusk plates, p50 70–110, re-rendered in place. | major | XL |

**Done when:**
- Point-in-polygon finds 0 structures within collision radius + 3 m of any thicket.
- `shot_map` re-shoots at the same spots show painted albedo with ink and chalk edges.
- The out-of-bounds area at spawn shows the dressed skirt at L* ≤ 52.
- The value probe still passes.
- `fdist.mjs`: every pair at 26 px is ≥ 55.
- Plates measure p50 70–110 by `luma.cjs`.
- The owner's ruling on Shadeprint and Longshade is recorded.

### Polish list (minors; owning wave in brackets)

**Combat**
- F4 [W1]: ultimate whiteout and caster anchor.
- F5 [W1]: CC word or glyph plate on bars.
- m-1 [W1 vfx / W4 windups]: impact hold, melee wind-ups.
- m-2 [W5]: Hesmi attack re-key.
- m-3 [W1]: landing flash wash.

**HUD**
- HUD-3 [W5 art / W2 minimap.tsx]: fog lane contrast, Wick dots.
- HUD-5 [W2]: current rank in tooltips.
- HUD-6 [W2]: kill-feed copy and recap ids.
- HUD-7 [W2]: scoreboard spells column.
- HUD-8 [W2]: 13.6 % budget doc.
- HUD-9 [W2]: 720p scale floor and names.
- HUD-10 [W2]: Linen Hood icon.
- HUD-11 [W2]: ping and shop edge.

**Maps**
- F2 [W5]: FRAY hour-stones off-brief.
- F5 [W5]: painted Dialwood plates.
- m1 [W5 + W1 probe]: base spots, Aubade plaza, Hourbell value.
- m2 [W5]: camp and pit dressing.
- F1 step 4 [W1]: camera clamp inset.

**Performance**
- m1: PNG splashes and draft preload.
- m2: 1.49 GB of unreferenced assets packaged.
- m3 [W1]: console noise.
- m4 [W1]: context-loss handling.
- m5 [W1]: real-play triangle and program peaks.
- V1 [W1]: gate flips on vsync jitter.
- M2 step 5 [W2]: dynamic resolution toggle in Settings.

**Client**
- F10 [W2]: double decline toast.
- F11 [W2/W4]: armour/armor, 'omnivamp'.
- F12 [W4]: draft timers run to zero.
- F13 [W2]: selection tick.
- F14 [W2]: Mono digits in prose.
- F15 [W2]: recognition beat.
- F16 [W2]: 'Connecting…' forever.
- F17 [W2]: profile, history, shop shelves.

**Audio** [all W3]
- AUD-3: bell-language announcer and a sting queue.
- AUD-4: high-frequency transient on physical hits.
- AUD-7: ducking, global voice pool, vamp heal spam.
- AUD-m1: pre-roll on instant cues.
- AUD-m2: static music.
- AUD-m3: .m4a beds.
- AUD-m4: mono and soften options.
- missed: the 'On my way' ping is always silent (`onMyWay` vs `onmyway`).

**Originality**
- F6 [W2]: 'Battle spells' is MLBB's term.
- F7 [W1]: licence notices and credits.
- F8 [W2/W4]: 'gold' and 'jungle' in copy.
- F9 [W2/W5]: hood-shaped icons, Lisvel and Sukri watch, Tunlan demon icon.

**Gameplay**
- G6 [W4]: FRAY lull before 11:00.
- G8 [W4]: ranked bans versus a 16-fighter roster.
- G9 [W4]: Nurrow last in FRAY.
- g1 [W4]: assist-credit kills.
- g2 [W4]: adept RIFT length.
- g3 [W2/W4]: practice tool depth.

## (e) Not measured

- **LoL itself:** no LoL video, pixels or audio were captured. The LoL side comes from r12, r04–r07 and r09 sources. Gauges for icon value, ping size, fog ratio, terrain occlusion and listener placement are qualitative.
- **Hardware:** only Apple M5 with ANGLE-Metal Chrome at 60 Hz. Not covered: Windows mid-range or integrated GPUs, displays above 60 Hz, DPR 2 and 4K, Firefox, older Safari, and the real client at render scale 1.0.
- **Online:** no online PvP, lockstep latency, parties, real matchmaker waits, real-network download, or ranked or draft queues with bans.
- **Human feel:** no human-vs-bot input traces, no human listening test, no 30-minute or 10-fighter teamfight audio mix, and no 5v5 effect density or its frame cost.
- **Quality tiers and accessibility:** VFX at Low and Medium, colourblind palettes, reduce motion, UI scale, gamepad and localisation.
- **Gaps in coverage:**
  - live kits for Ardit, Ervet, Nurrow, Sukri and Ulkro;
  - wall occlusion on BRIDGE and FRAY;
  - out-of-bounds areas at spectator zoom;
  - live death recap and own-takedown banner;
  - level-up and kill banner timing;
  - recall arrival;
  - skin VFX;
  - memory after more than 3 matches.
- **Excluded:** Ilsheta (own review) and the Wick art lane. Trademark registry searches, a secret scan of deleted history files, and kit comparisons against non-LoL MOBAs are also out of scope.
