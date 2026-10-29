# VALE: closing League-of-Legends parity review (gauge only)

2026-10-29. Branch `claude/youthful-ramanujan-gdud5w`. `src/`, `content/` and `art/out/` have not changed since 09d330c0 (07:21 today), so every lens measured the same build. Since then only review files have been committed.

This review rolls up two sets of reviews. The first is 8 dimension reviews. The second is 16 per-fighter art reviews, the first time each fighter has been judged on its own. An adversarial verifier re-measured every one on the real Chrome GPU, the GLBs and the shipped files. Findings the verifiers refuted are left out. The source data is in `_design/reviews/closing/*.json` and `_design/reviews/closing/fighters/*.json`. The machine-readable fix list is `closing_parity_open.json`.

LoL is only a gauge. Every fix below is VALE's own, per STYLE_BIBLE.md and WORLD.md.

**Par bar.** A dimension or fighter is ON PAR when its verified score is 8 or more and it has no confirmed blocker or major open.

## (a) Verdict

**VALE is not on par with League of Legends today.**

- **Dimensions:** only HUD & in-match readability is on par (8.0, minors only). The other seven score 6.0 to 7.8, and each has at least one confirmed major.
- **Fighters:** none of the 16 is on par. They score 5.5 to 6.5, and every one has at least one confirmed major.
- **Sensitivity:** two blocker-class problems are open.
  - Vashil's pale cowl comes to a soft point and reads as a peaked white hood from behind at the gameplay camera.
  - The Greatwick's back lantern shows two round lit panes side by side, which read as eyes on the lane heading. The verifiers rated it a minor watch; this review rules it blocker class (see Synthesis rulings).

**What the fix waves achieved.**

- All 8 blockers of the final review are marked done, and no closing lens reproduced any of them.
- The dimension average rose from 5.6 to 7.2.
- Of r12's 24 gaps, 18 are now closed and 6 partly closed; none is fully open. In the final review it was 15 closed and 9 partly.
- Timing, telegraphs, CC words, frame rate, value bands, fog, HUD information and the systems re-key now meet the gauge.

**What stands between each dimension and par:**

- **Combat (7.5):** C1. On 18 of 32 third-ability and ultimate slots, team orange or a shared white or glass light outshines the fighter's own colour.
- **Maps (7.5):** E1. The jungle numerals, the VI slab and FRAY's cart, stalls and fair stands are untextured grey beside finished Art 2.0 structures.
- **Performance (7.0):**
  - PERF-C1: dynamic resolution never steps down when the GPU is the bottleneck on Chrome/Metal, and Ultra misses 60 fps on the reference M5.
  - PERF-C2: a session holds about 4.7 GB after one pass over the three maps and never releases it.
- **Menus (7.5):** CL-1. Six paid skins, three of them deluxe and three of the four Featured offers, read as the base skin, and finalize has no large skin preview.
- **Audio (6.5):**
  - AUD-C1: 12 of 16 ultimates land on one shared boom.
  - AUD-C3: the two epic objectives sound like camp monsters.
  - Missing voice weighs on the score but is an owner scope decision.
- **Originality (7.8):**
  - C1: the Quick queue's start (level 3, near-equal gold, pre-pick) maps onto Swiftplay, outside the owner's re-key gate.
  - The Greatwick lantern ruling above.
- **Gameplay (6.0):** CL-1. Bots barely fight before 15:00: about 1.8 takedowns by 10:00, against LoL's kill pressure from level 2-3.
- **Fighters (5.5-6.5):** the gaps are shared across the roster.
  - 16 of 16 have splash and portrait cards that are one grainy model render, reused across skins.
  - 7 have a frozen recall.
  - 6 have long garments with no secondary motion.
  - 6 have deluxe or featured skins that read as the base.
  - 5 have materials that merge into one matte clay.
  - Fighter-specific issues: faces (Hesmi, Lisvel), silhouettes (Odrum's yoke, Marund's cap) and pose pops (Tunlan, Vashil).

The six waves in (d) can run in parallel on disjoint files. They cover every blocker and major. A dimension or fighter reaches par only when a re-review scores it 8 or more, so each wave ends with that re-review.

## (b) Scorecard

### Dimensions (verified scores)

| Dimension | Previous (final) | Closing (verified) | ON PAR | State in one line |
|---|---|---|---|---|
| HUD & in-match readability | 7 | **8.0** | **yes** | HUD-1, HUD-2 and HUD-4 are closed by measurement: item icons p50 min 66, chip min pair 58.9, T/F/A always on. 10 minors remain; the worst is the 'You takes five in a row' banner queued FIFO, so the 5-kill headline arrives 7.1 s late. |
| Combat feel & VFX | 6 | **7.5** | no | Telegraphs from f0, wind-ups, CC words, victim flash, one ult beat and 0 shake all meet the gauge. C1: 18 of 32 a3/ult slots fail the 0.5 signature share, plus Kemdo a3 as a false pass. |
| Maps & environment | 6.5 | **7.5** | no | B5 lane p50 89, fog 0.537, bases, walls and Art 2.0 structures pass. E1: in-game face high-pass of the numerals is 0.7-1.3, against 2.9 for lane flagstone and 19.8 for the Needle; FRAY props date from Oct 14. |
| Performance & stability | 6.5 | **7.0** | no | High and Low run at 60.1 fps with 0 dropped frames; e2e 7/7; probes 48/48. PERF-C1: Ultra 33-45 fps with the scale stuck at 1.0. PERF-C2: 4.70 GB renderer + GPU after RIFT, BRIDGE and FRAY. |
| Menus & client flow | 5.5 | **7.5** | no | Flow, speed, states and painted menus are close to LoL tier. CL-1: portrait ΔE 2.0 (Ilsheta First Bell) to 7.2; finalize has no showcase. 9 minors. |
| Audio | 4 | **6.5** | no | Per-fighter kits, 114 hit cues within 10.6 ms, 16 ambience emitters, master at -19 LUFS. AUD-C1: the shared cue is 55-92 % of the first 300 ms of 12 ult landings. AUD-C3: Longshade's autos play 5-10 dB under a fighter's. |
| Originality, legal & sensitivity | 5 | **7.8** | no | No LoL asset or name copied; secret scan clean; re-key gate 38/38. C1: Quick queue level 3, 1,250 Gleam, pre-pick. GW-1: Greatwick lantern eye-pair, blocker class (synthesis ruling). |
| Gameplay, bots & pacing | 4 | **6.0** | no | Last-hit 52-56 %, in lane 78-83 %, jungle level gap 0.5, pacing PASS. CL-1: 1.75-1.90 takedowns by 10:00, 2-5 of 20 games with none, ults held to 12-18 min. |

The plain average of the eight scores is **7.2** (final review: 5.6).

### Fighters (verified scores; the first per-fighter review)

| Fighter | Verified | ON PAR | Blocker / majors | Main open issue |
|---|---|---|---|---|
| Vashil | **5.5** | no | 1 / 3 | **Blocker:** the soft-pointed pale cowl reads as a peaked white hood from behind. Its tip radius is about 7.3 cm, the sharpest crown on the roster. Also a frozen recall, Peal and Toll popping in one display frame, and the cards. |
| Burdam | 6.0 | no | 0 / 4 | Every material reads as one matte clay, with straps lighter than the coat. The long coat and cowl have no motion. The Almanac deluxe is about dE 4 from base. Cards. |
| Hesmi | 6.0 | no | 0 / 4 | The eye-band reads as clenched teeth, because block joints at ±17° split each eye. The hood and the cut band are dE 1-2 apart. Shadeprint's violet never reaches her shadows. Cards. |
| Lisvel | 6.0 | no | 0 / 4 | The head reads as a bandaged egg with an opaque visor slab and no living cue. Materials are clay. Backstep hangs at its apex and pops down. Cards. |
| Marund | 6.0 | no | 0 / 4 | The cap swallows the maul and the action. The 7 m ult leap plays as a ground slide. Idle and recall are frozen. Cards. |
| Odrum | 6.0 | no | 0 / 3 | The yoke reads as a vertical pole through the body in lane travel, in 78-80 % of frames. The cap and lifted jerkin read as bare pink skin. Cards. |
| Sukri | 6.0 | no | 0 / 4 | Materials do not separate (chroma 3-8) and the dawnglass cup is opaque. Attacks and Mote Toss share one arm-only staff arc. Shadeprint's violet light never shows in game. Cards. |
| Ardit | 6.5 | no | 0 / 2 | The tabard panels swing as rigid boards with 0 frames of lag behind the thigh. All skins share one grainy splash pose. |
| Dunsom | 6.5 | no | 0 / 3 | Idle, recall and channel are frozen (at most 3.1°). The hat, his largest surface, is a flat plate with a 3 L* ramp. Splashes share one pose. |
| Ervet | 6.5 | no | 0 / 1 | Closest to par: the only major is the cards, one grainy victory render for all three skins (grain 5.5-6.5 against 0.3-0.7 on the plate). |
| Ilsheta | 6.5 | no | 0 / 2 | Idle, recall and channel are near-static, and the 7 s recall loops a 2 s bow. The First Bell deluxe portrait matches base (mean difference 3.5). |
| Kemdo | 6.5 | no | 0 / 3 | The knee-length tunic is skinned rigidly to the thighs. The featured Long Evening deluxe is a recolour with no effect tint. Cards. |
| Nurrow | 6.5 | no | 0 / 3 | The 2 s recall loops through the 7 s channel. The felt cloak swings only 1.2° in the run. Cards. |
| Rishal | 6.5 | no | 0 / 3 | Recall and channel are frozen (at most 1.84°). The Lamplit deluxe is a palette swap plus an 8 cm cage. Cards. |
| Tunlan | 6.5 | no | 0 / 3 | Both fear casts snap pose to pose: the hat jumps 0.5-0.7 m in one display frame. The 7 s recall is frozen. The cards have no hound shadow. |
| Ulkro | 6.5 | no | 0 / 3 | The skirt boards up over the thigh in the run, and the hood-tail and sash are rigid. Ribbed-tube wraps and soleless bulb boots. Cards. |

Mean fighter score: **6.25**. Silhouettes are a real strength: the maximum pairwise IoU64 is 0.77, under the 0.80 gate. Sensitivity is clean on 15 of 16; the exception is Vashil. Hesmi, Lisvel and Ulkro have faces that do not yet read as alive, and Dunsom's mask is a minor watch.

### Synthesis rulings (this review)

1. **GW-1, the Greatwick lantern, is promoted to blocker class.** The originality verifier rated it a minor watch from one angle (m4). The HUD verifier then caught both enemy Greatwicks marching the lane at 10:15 with the back lantern as a grey box carrying two equal round lit panes side by side over the hood. At native 1x this reads as a box head with two eyes (`_harness/_shots/closing_hud_verify_04z_wicks_1x.png`, `_3x.png`). I checked the 1x crop and agree.
   - The binding rule says Wicks carry no eye-like light pairs.
   - Owner ruling 5 applied the sensitivity rules strictly, down to a ward's finial.
   - The conservative, industry-standard call is therefore blocker class. The fix is size S.
   - CW4 records it as owner ruling 6 when it lands.
   The originality score (7.8) stays as verified. The dimension was not on par before this ruling either.
2. **SKIN-FX is a new engine finding.** It merges the effect halves of four confirmed fighter majors: hesmi-M4, SUK-M5, kemdo-M5 and rishal-M3. A skin's `vfxTint` reaches only layers keyed `element`, and no kit uses them (`src/contracts/catalog.ts:402`, `src/render/director.ts:398-401`), so deluxe effect themes never show. CW1 owns it; the art halves stay with the fighters.
3. **Duplicates are merged.** Originality C2 (Dunsom's mask) and dunsom-face-skull are one fix, in CW6. The HUD's hud-c10 chip watch goes to the same wave.

## (c) r12 gap status

| ID | Gap (r12) | Final | Closing | Evidence (one line) |
|---|---|---|---|---|
| B1 | Hover freezes the world | Closed | **Closed** | overlay_regress --q high PASS; node count 2669 constant through a 180-frame hover (_harness/_reports/closing_hud_verify_overlay_regress.json). |
| B2 | No telegraph or aim drawn | Partly | **Closed** | overlay_regress PASS on High and Low; enemy cone opens away from the caster with fill inside the edges; Tunlan ult cone drawn from f0 (closing_combat_overlay_regress.json, _harness/_shots/closing_combat_overlay_cone_enemy.png). |
| B3 | Fighter art missing | Partly | **Closed** | All 16 fighters are final Art 2.0 and load in pick grid, finalize and Collection; 80 bot games with all 16 seated, 0 faults. Finish is not at par: 0 of 16 fighters reach 8 (fighter table). |
| B4 | No 60 fps at 1080p | Closed | **Closed** | perf_1080 --prod GATE PASS: High 60.1 fps, 0 of 601 frames dropped, p95 16.7 ms; Low 60.1 fps (closing_perf_verify_gate.json). Ultra misses 60 (PERF-C1). |
| B5 | Ground owns the bright band | Closed | **Closed** | value_probe RIFT/FRAY High PASS: RIFT lane p50 89, frame p50 63; FRAY 87 / 85 (closing_envv_value_probe.json). |
| M1 | Late or hidden warnings | Closed | **Closed** | Every 'everyone' cast telegraphs from f0; all 12 delayed effects have castTime + delay ≥ 0.6 s (closing_combat_kits.json, content walk). |
| M2 | CC invisible and unnamed | Partly | **Closed** | CC plates show word plus glyph with a 70 ms fade-in; overhead STUNNED word; hostile CC sound path PASS per reviewer (fw_W1_polish_cc_plates_closing_combat.png, closing_hud_A06_stun_full.png). |
| M3 | No cast anticipation | Closed | **Closed** | 48 of 48 casts with castTime ≥ 0.12 s name an existing windupVfx. |
| M4 | HUD hides loss of control | Closed | **Closed** | Lock chip, ember tint, status row and live refusal captions ('Hurl ready in 5 s'); 'Not enough {resource}' not seen live (closing_hud_verify_capture.json). |
| M5 | Basic attacks slow and thin | Partly | **Partly** | Wind-ups 0.21-0.26 s on all 16 with own trails; impact disc ≥ 0.5x victim height holds only 67-167 ms against about 200 ms (fw_W1_combat_polish_closing_combat_verify.json `hold`; combat C3). |
| M6 | Struck unit never reacts | Closed | **Closed** | Victim flash peaks 0.45 and clears by 167 ms; ability hits 0.7, ults 1.0 (closing_combat_overlay_regress.json, closing_combat_kits.json). |
| M7 | Bars undersized, self trail invisible | Closed | **Closed** | Self bar with level chip, ticks and resource strip; enemy bar about 105 px; Wick bars 58x5; segmented structure bar (closing_hud_verify_04_mid_full.png). |
| M8 | Wicks identical and out-value fighters | Partly | **Partly** | Wick hoods round, one central light, no mouth (closing_originality_verify_wick_closeups.png); the Greatwick back lantern reads as two lit eyes at 1x on the lane heading (closing_hud_verify_04z_wicks_1x.png, ruled blocker class); hood value half not measured. |
| M9 | Structures hide units and vanish | Closed | **Closed** | Collapse and ruin reproduced at t=430 (closing_env_structures_rift_t430.json); the harness silently skips at its default t (env m-6). |
| M10 | No always-on outline | Closed | **Closed** | overlay_regress m10: 18 of 18 units drawn, 0 missing, rest width 1. |
| M11 | Plastic foliage | Partly | **Partly** | Brush leak 0 px, canopy p50 52; Dialwood crowns are still flat, straight-edged plates at 28.5 m (env m-7; closing_envv_rift_nf_at1.png). |
| M12 | Fighters not told apart by effects | Partly | **Partly** | a1/a2 hue pass 32/32; a3/ult fail 18 of 32 (+ Kemdo a3 false pass) by team or neutral light share (closing_combat_verify_hue_decomp.json); by ear 12 of 16 ult landings share c_ult_release (AUD-C1). |
| M13 | Ult impacts have no envelope | Partly | **Partly** | One beat per cast, lift 1.4, distortion 23-29 frames, cam jitter 0; Hesmi core x2.25 with the victim 0.826 white (combat C2); ult onset 55-92 % one shared cue (AUD-C1). |
| M14 | No ambient life | Closed | **Closed** | Motes, flee 0.033 s, cost 0.05-0.06 ms (closing_env_ambient.json); 16 ambience emitters; BRIDGE/FRAY flames under the band (env m-5). |
| m1 | Dial Bar states missing | Closed | **Closed** | M:SS cooldowns ('3:23'), regen '+2.4', ledger flyout (closing_hud_verify_07_death_full.png); ready-wash timing not measured. |
| m2 | Death, level and kill banners thin | Closed | **Closed** | Banners hold 3.5-4.0 s with two faces; own-death grade 0.98 -> 0 over 400 ms; copy and priority defect is hud-c1; enemy deaths silent is AUD-C6. |
| m3 | Minimap fighters are anonymous dots | Partly | **Closed** | Face-chip min pair 58.9 (was 33.7), 0 of 120 pairs under 45 (closing_hud_verify_face_chips_150_named.png). |
| m4 | Camera shake | Closed | **Closed** | 0 shake layers in content/vfx.json; camJitter 0.0000 on all 32 live casts. |
| m5 | No distortion; thin T2 shapes | Closed | **Partly** | Distortion on all 8 live ultimates (23-29 frames). The T2 secondary-shape audit is still not measured; the final review closed m5 on distortion alone, so this is a stricter reading, not a regression in the build. |

**Totals:** 18 closed, 6 partly, 0 open (final review: 15 / 9 / 0). The two extra gaps the final review tracked are both closed:

- **Fog (r12-4-fog):** unseen-to-lit 0.537 on lane and jungle; landmarks 0.542; lamps 0.552.
- **Base identity:** plaza saturation 0.26 / 0.35; structure L* p95 76 / 68.5.

## (d) Fix plan: 6 parallel waves

Wave names start with CW (closing wave) so they are not confused with the earlier W1-W5b. Each wave owns its files outright: no file is shared between waves. Inside a wave, blockers go first. Three waves run Blender (CW4, CW5, CW6), so each runs one Blender job at a time against the machine's three heavy slots.

**File ownership:**

| Wave | Owns |
|---|---|
| CW1 Engine, VFX & skin effects | `src/render/**` (but not `menu.ts` or `terrain*.ts`), `src/contracts/catalog.ts`, `content/vfx.json`, `content/skins/*.json`, `tools/build_content.ts`, `tools/vfx/**`, the kit-hue, combat-polish, perf, overlay and vfx-gallery harnesses, `_harness/web/render_bench.ts`, new `_harness/probe_bar_clearance.mjs` |
| CW2 Audio identity & memory | `src/audio/**`, `audio/**`, `content/audio.json`, `content/units.json`, `_harness/probe_audio_*.mjs` |
| CW3 Match rules, bots & client | `src/sim/**`, `src/session/**`, `src/ui/**`, `src/render/menu.ts`, `content/{queues,team_buffs,items,setup,modes,store,strings.en,client}.json`, `content/fighters/*.json`, `content/ui/**`, `tools/{gen_store,names_check}.ts`, `protected_names.json`, `DESIGN_NOTE.md`, `ROSTER.md`, `modes_economy.md`, `W4_systems_rekey.md`, sim, pacing and e2e harnesses |
| CW4 World & unit art | `art/blender/{maps,props,units}/**`, `art/out/{maps,units}/**`, `art/renders/units/**`, `content/maps/*.json`, `src/render/terrain*.ts`, `_design/maps/**`, value, shot_map, shot_structures, wallmask and camera-edge harnesses |
| CW5 Fighter art A + shared pipeline | `art/blender/common/**` (but not `facechip.py`), `art/blender/portraits.py`, `art/blender/fighters/plates.json`, `art/tools/**`, and for Vashil, Ardit, Burdam, Kemdo, Lisvel, Nurrow, Ulkro and Ervet: `art/blender/fighters/<id>.py`, `art/out/fighters/<id>/**`, `art/renders/fighters/<id>/**`, `_design/fighters/<id>.md` |
| CW6 Fighter art B | The same four paths for Dunsom, Hesmi, Ilsheta, Marund, Odrum, Rishal, Sukri and Tunlan, plus `art/blender/fighters/face_chips.json` and `art/blender/common/facechip.py` |

**Agreed seams.** These interfaces are fixed up front, so no file is shared:

- **CW5 lands first, and CW6 builds on it.** Its first commit is the shared card pipeline, the spring-chain helper and the bake fix:
  - the card pipeline renders a denoised subject at 2× or more samples, lit by the plate's sun with rim and bounce, with a paint-over grade, a contact shadow and a per-skin SPLASH and PORTRAIT schema;
  - the spring-chain helper lives in `anim.py`;
  - the bake sets metal to 0.
- **CW1 exposes `Renderer.calibrate()`**, which returns high, medium or low from a 3 s Home sample. CW3 stores the result as the first-run preset and shows a VALE-styled notice.
- **Bar clearance is computed, not authored.** CW1 computes each fighter's bar clearance from its GLB (hood crown and idle and run socket tops, plus 0.35 m), so no content field is needed. This covers Kemdo's lens, Dunsom's lantern, Hesmi's rack, Vashil's ring and Tunlan's brim.
- **Marund's Domefall leap** is split three ways:
  - CW6 authors the clip;
  - CW3 adds a per-effect dash arc (`src/sim/movement.ts`) and the ult's `present.anim` (`content/fighters/marund.json`);
  - CW1 adds a dash-progress role in `actors.ts`, which Lisvel's Backstep can also use.
- **AUD-C1 is fixed in the audio engine** with a kit-aware `area` case and a build gate that reads `content/fighters`. CW2 never edits `content/fighters`.
- **The memory gate is shared.** CW2's decoded-audio budget feeds CW1's footprint gate, so CW2 lands its budget before CW1 enforces the gate.
- **The skin ΔE gate is CW3's.** CW3 owns `tools/gen_store.ts` and the Featured shelf. The First Bell re-palettes come from CW5 (Ardit, Vashil) and CW6 (Ilsheta). Until they pass, those skins come off Featured.
- **Skin content files belong to CW1.** CW1 owns `content/skins/*.json`: Kemdo, Ulkro and Rishal tints and the Nurrow Shadeprint copy. CW3 owns `ROSTER.md` (burdam-M4's line, Nurrow §5).
- **Lamp sounds need no content change.** CW2 plays them from the ward-spawn event, so `content/items.json` stays with CW3.
- **The minimap is split.** CW4 paints the four RIFT numerals into `minimap.png`; CW3 feathers the fog in `minimap.tsx`.

**Owner decision, not a wave:** fighter voice and a spoken announcer (AUD-C2). `_spec/CONTRACT.md` §11 scopes voice out. Lifting it is an XL audio lane, and it would be the largest single difference a LoL player still hears.

### CW1: Engine, VFX & skin effects

**Goal:** Every fighter keeps its own colour on all four abilities, deluxe skins change their effects, the frame-rate safety net works on Chrome/Metal, a session stays inside a laptop's memory, and nothing the engine draws hides a fighter's accent.

**Size:** XL (C1 L, PERF-C2 L, PERF-C1 M, SKIN-FX M).

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | `C1` (combat): Ultimates and third abilities lose the fighter's signature in play: 18/32 a3/ult slots read as team orange or as shared white/glass neutrals. | major | L |
| 2 | `PERF-C1` (perf): Dynamic resolution stays blind when the GPU is the bottleneck on Chrome/Metal, and Ultra misses 60 fps on the reference M5. *Split: Controller, Ultra rebalance and the calibration API are CW1; the default preset in src/session/settings.ts and the VALE-styled notice in settings.tsx are CW3.* | major | M |
| 3 | `PERF-C2` (perf): A play session climbs to about 4.7 GB across Chrome's renderer and GPU processes and gives none of it back. *Split: KTX2 textures, model cache budget and the footprint gate are CW1; decoded-audio budget and bed eviction in src/audio/index.ts are CW2.* | major | L |
| 4 | `SKIN-FX` (skins): A skin's effect tint never reaches its fighter's own kit effects, so deluxe 'violet shadows / violet light' skins look like the base in play. | major | M |

**Done when:**
- probe_kit_hue gains --slots and gates a1/a2/a3/ult of all 16 fighters: frame-integrated signature share ≥ 0.5 on 64/64 slots, AND team light ≤ 0.35 of the added light in the team-blackout cast on every a3/ult; Kemdo a3 keeps ≥ 0.5 with team blacked out. Both gates join the integration gate.
- probe_combat_polish ult,hold: Hesmi first-beat core ≥ 2.3x and full-frame body white ≤ 0.35 for ≤ 2 frames (Nurrow and Dunsom ults too); impact disc ≥ 0.5x victim height for ≥ 167 ms on Kemdo, Rishal and Tunlan.
- Skin effects: on Hesmi Shadeprint and Sukri Shadeprint the a1 and ult layers measure in the skin's violet family while team rings stay team; Kemdo Long Evening and Rishal Lamplit show their own tint in a cast capture.
- perf_1080 --prod gains a GPU-bound step (Ultra 1080p, or High at 2x render scale) with dynamic resolution on: the scale leaves 1.0 within 10 s and fps recovers to ≥ 58. Ultra holds 60 on the M5 or is gated. Renderer.calibrate() exists and is covered by a probe.
- perf_1080 --prod memory step plays RIFT, BRIDGE, FRAY, RIFT in one page: renderer + GPU process footprint at Home ≤ 2.5 GB (with CW2), model textures load as KTX2, and ImageBitmaps are closed after upload; probe_ctxloss still passes.
- Match-peak step over 3 seeds with rotated seats: 0 programs first seen after loading; 0 leftover skeleton DataTextures after 2 full cycles.
- Bar-clearance probe over 8 facings: Kemdo's lens, Dunsom's lantern, Hesmi's rack top, Vashil's ring and Tunlan's brim are half-covered by their own bar in ≤ 10 % of idle and run cases.
- No regression: perf_1080 GATE PASS at High and Low, overlay_regress PASS at High and Low, value_probe B5 PASS, typecheck and strict content:check clean.

### CW2: Audio identity & memory

**Goal:** A player can name the ultimate and the objective by ear: no shared boom under a fighter's own release, epic objectives with their own weight and death, and decoded audio that does not pile up across a session.

**Size:** L (AUD-C1 M, AUD-C3 M, audio half of PERF-C2 M).

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | `AUD-C1` (audio): 12 of 16 ultimates still land on one shared generic boom; 34 more kit area/zone effects layer library cues. | major | M |
| 2 | `AUD-C3` (audio): Epic objectives sound like camp monsters: Longshade and Sunsplinter use only shared library cues, play under fighter level, and have no death sound. | major | M |

**Done when:**
- audio/build.py gains an 'as heard' gate that sums every cue the engine plays for each kitted fighter's cast, area and hit chain: 0 library cues on a kitted fighter's area/zone, 0 c_ult_release under any of the 16 ultimates; probe_audio_kits K9 PASS.
- Re-run _harness/_reports/closing_audio_verify_tool_ultid.py on the shipped files: first-300 ms median pair distance ≥ 15 dB and 0 of 66 ult pairs inside the take-to-take spread.
- Epic-objective gate: Longshade and Sunsplinter share no attack, ability or death cue with a Wick, camp or fighter; their autos land at or above a fighter auto (file LUFS + catalog gain + engine multiplier); each has a death cue and a pit presence emitter.
- Decoded audio at Home after RIFT, BRIDGE, FRAY is ≤ 150 MB (closing_perf_verify_mem method); the previous bed is freed on a bed change.
- Minors measured: heal chimes ≤ 6 per minute in a 7-minute RIFT capture; enemyDown fires; announcer line peak ≥ 3 dB over sfx p99 in a teamfight capture; Dunsom and Ulkro autos ≤ 0.6 energy share in 2-5 kHz; lamp set and lamp out cues play.
- Existing audio probes still pass. Captures use Chrome's fake output device (as closing_audio_tool_open.mjs), because pw.mjs audio probes meter silence on this Mac.

### CW3: Match rules, bots & client

**Goal:** Bots fight in the laning phase the way a League player expects, every queue's rules are VALE's own, and the client sells skins that look different, with a clean HUD and copy. Two disjoint lanes: sim/rules and UI/client.

**Size:** XL (gameplay CL-1 L, client CL-1 L, originality C1 S, many S/M minors).

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | `CL-1` (menus): Paid skins read as the base in every client view, and finalize has no large skin preview. *Split: Finalize showcase, caption placement, Collection tile crops, store tiers and the gen_store ΔE gate are CW3; the First Bell re-palettes and portrait framing are CW5 (Ardit, Vashil) and CW6 (Ilsheta).* | major | L |
| 2 | `CL-1` (gameplay): RIFT bots barely fight before 15:00: the laning phase is quiet. | major | L |
| 3 | `C1` (originality): The Quick RIFT queue maps rule for rule onto LoL's Swiftplay, outside the owner's re-key gate. | major | S |

**Done when:**
- Bot soak on independent lineups (seeded per-role shuffle as closing_gameplay_verify_tools/v_gp.mts, 20 untuned seeds each at adept and veteran): ≥ 6 credited takedowns by 10:00 per game (both teams), ≤ 1 in 20 games without one; median longest no-death stretch from 3:00 ≤ 3 min; shadehold takedowns before 14:00 ≥ 1 per game; every fighter first ults at a median ≤ 10 min. These become r09 §4.4 gates in probe_sim_bot_soak.ts.
- G1 gates still pass (last-hit ≥ 50 %, in lane ≥ 75 %); no RIFT core falls before 16:00; Sunsplinter first take ≤ 3 min after spawn (median); Splinters stack to 3 as designed; pacing.ts PASS.
- Veteran beats novice ≥ 85 % on a fresh untuned window of ≥ 40 games; duo road reaches level 6 by 8:00 (median).
- probe_sim_rekey has rift_quick startLevel and startGold rows; neither is within 10 % of 3 / 1400 and there is no level-3 start; 0 failures; queue description, DESIGN_NOTE.md:53 and modes_economy.md §3 updated.
- Client: finalize shows a large showcase of the hovered or selected skin; the Shop/Collection caption no longer covers the model; Collection tiles crop each skin's changed part; tools/gen_store.ts fails any paid skin with portrait CIE76 ΔE < 12 vs base (deluxe < 18).
- HUD and client minors closed with their checks (strings lint for second-person banners, banner priority so a multikill pre-empts the queue, single scoreboard grid, opaque empty slots, recap CC line, call-outs); e2e asserts no detached .hud tree after 2 matches.
- e2e all PASS with 0 console lines, typecheck, strict content:check 0 warnings; HUD stays on par (hud_renders --at 100, icon_probe OK, overlay_regress PASS).

### CW4: World & unit art

**Goal:** Every landmark and prop in play is finished to the same tier as the Art 2.0 structures, and no Wick carries an eye-like light pair.

**Size:** L (E1 L, Greatwick S first).

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | `GW-1` (originality): Greatwick back lantern reads as a box head with two lit eyes on the normal lane heading (sensitivity, Wick no-face rule). *(Was originality m4 (minor watch).)* | **blocker** | S |
| 2 | `E1` (maps): In-play landmarks and FRAY props have untextured faces at gameplay zoom: the 4 jungle numerals, the VI slab, the FRAY cart, the lampwright stalls and the fair stands. | major | L |

**Done when:**
- Greatwick (both teams, every skin): three_snapshot at 8 facings at the 28.5 m camera and a live RIFT frame on the lane heading show no pair of equal round lit panes side by side; a sensitivity reviewer signs it off. Done first.
- value_probe gains a landmark face-detail gate: the faces of the four numerals, the VI slab, the lampwright cart and stalls and the fair stands reach in-game high-pass ≥ the lane flagstone (2.9) with ≥ 6 L* breakup at ≥ 0.5 m after the content value multiplier; fresh shot_map frames at the closing_envv positions; numerals lean ≤ 25 deg; stall lamps are not a symmetric pair.
- B5 value_probe PASS on all maps and both tiers; fog lane/jungle 0.50-0.60; wallmask 0/48 RIFT and 0/24 FRAY.
- Minors: pit water saturation ≤ 0.45 at L* ≤ 30 with a bank lip; shot_structures exits 1 unless collapse and ruin happen; canopy p50 45-60 with notched, veined plates; minimap.png shows the four numerals.
- M8 value half measured: Wick hood L* ≤ 65 and below the fighters on RIFT High.

### CW5: Fighter art A + shared card and motion pipeline

**Goal:** Vashil's blocker first; then 8 fighters (Vashil, Ardit, Burdam, Kemdo, Lisvel, Nurrow, Ulkro, Ervet) reach the par bar: clean per-skin cards, cloth that moves, recalls that perform, materials that separate, and deluxe skins that look deluxe. CW5 owns the shared Blender pipeline and lands it first.

**Size:** XL (1 blocker + 23 majors over 8 fighters).

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | `VAS-B1` (Vashil): Soft-pointed pale cowl over a pale floor-length robe: from behind at the gameplay camera the head reads as a peaked white hood. | **blocker** | M |
| 2 | `ardit-M1` (Ardit): Splashes are one static model render reused for every skin, with render grain and no highlights. | major | L |
| 3 | `ardit-M3` (Ardit): Run: tabard panels kick out as rigid boards that track the thigh with no lag. | major | M |
| 4 | `burdam-M2` (Burdam): Every material reads as one matte clay: plaster pauldrons, straps lighter than the coat, no recess staining or edge chalking. | major | M |
| 5 | `burdam-M3` (Burdam): The splash is a grainy, flat-lit static render pasted on a painted plate, with the same pose and framing for every skin. | major | L |
| 6 | `burdam-M4` (Burdam): The deluxe 'Almanac Ledger' skin is nearly indistinguishable from the base, and changes less than the standard skin. *Split: Coat, cowl and board re-theme are CW5; the ROSTER.md:152 line goes to CW3.* | major | M |
| 7 | `burdam-M5` (Burdam): No secondary motion on the long coat or cowl: the coat stretches with the thighs instead of swinging, and the forearms candy-wrap. | major | M |
| 8 | `ervet-M1` (Ervet): All three splashes reuse one grainy static render of the same stand pose. | major | L |
| 9 | `kemdo-M3` (Kemdo): Splash and portrait are grainy model renders on soft plates, in one pose for all three skins. | major | M |
| 10 | `kemdo-M4` (Kemdo): No secondary motion: the knee-length tunic skirt is skinned rigidly to the thighs. | major | L |
| 11 | `kemdo-M5` (Kemdo): The featured 1,500-candle deluxe skin is a recolour plus four small tassel plates, with no effect tint and the base splash pose. *Split: Material re-theme and splash are CW5; the plum vfxTint is CW1 finding SKIN-FX.* | major | M |
| 12 | `lisvel-M1` (Lisvel): Head and face read as a bandaged egg with an opaque slab over the eyes; no living cue at chip, portrait or splash size. | major | M |
| 13 | `lisvel-M2` (Lisvel): Splash and portraits are grainy static model renders on painted plates; stiff poses, and one portrait pose for all skins. | major | L |
| 14 | `lisvel-M3` (Lisvel): Every material reads as one matte clay: plaster sleeves, rubber straps, opaque glass, an ash bow with no grain. | major | L |
| 15 | `lisvel-M4` (Lisvel): No secondary motion and a Backstep that hangs at its apex and pops down with no landing (static recall body). *Split: Clip work is CW5; an optional dash-end follow-through in src/render/actors.ts is CW1.* | major | M |
| 16 | `nurrow-M1` (Nurrow): Splashes and portraits are grainy static model renders on painted plates, in one victory stand for all three skins. | major | L |
| 17 | `nurrow-M2` (Nurrow): Recall is a frozen 2 s loop played through the 7 s recall (channel likewise near-static). | major | M |
| 18 | `nurrow-M3` (Nurrow): The knee-length felt cloak is a rigid board in run, dash and idle. | major | M |
| 19 | `ULK-M1` (Ulkro): Splash and portraits are grainy model renders on painted plates, in one stiff frontal stand reused by all three skins. | major | L |
| 20 | `ULK-M2` (Ulkro): No secondary motion: the knee-length skirt boards up over the thigh in the run, and the hood-tail and sash are rigid; the death hold sinks the right leg 20 cm. | major | L |
| 21 | `ULK-M3` (Ulkro): Form and material finish: ribbed-tube sleeve and shin wraps, sole-less bulb boots, matte frosted dart heads, projected smudges on the tunic. | major | L |
| 22 | `VAS-M1` (Vashil): Recall is a frozen pose: the brief's three wrist-bell rings move nothing visible. | major | S |
| 23 | `VAS-M2` (Vashil): Peal's strike pops in one display frame and Morning Toll holds a dead bent pose, then snaps upright. | major | M |
| 24 | `VAS-M3` (Vashil): Cards: one static victory render serves all three skins, the portrait is frontal against the brief's 28° yaw, and the figure is speckled with render grain. | major | M |

**Done when:**
- Vashil crown: tip radius ≥ 0.12 m and ≥ 0.19 m wide 5 cm under the top (closing_vashil_verify_crown.txt method), with a dark break on the pale back; a live walk-away capture at the 28.5 m camera shows no peak; 'rounded cowl' in vashil.md.
- Cards, all 8: figure high-pass ≤ 2x the plate's, subject highlights reach luma ≥ 230, each skin has its own clip, pose, yaw and light (figure-box MAD vs base ≥ 30/255), each portrait derives from its skin's staging; Vashil portrait yaw 28 deg.
- Motion: baked chains on Ardit tabard (top segment ≤ 30 deg, ≥ 2 frames behind the thigh), Burdam coat and cowl, Kemdo tunic, Lisvel tabard, Nurrow cloak (10-15 deg swing in run) and Ulkro skirt and hood-tail; Vashil recall fills RIFT 7 s with three visible bell rings; no single 60 Hz display frame moves Vashil rod head > 0.3 m in Peal or Morning Toll, with a moving hold; Lisvel Backstep lands.
- Materials: Burdam strap ≥ 15 L* under the coat and pauldron recesses 15-20 L* darker; Lisvel and Ulkro painted material passes (grain, folds, soles, glossy dawnglass); Ervet blade bevel-to-core range ≥ 20 L*; at the gameplay camera each named material pair differs by dE ≥ 8.
- Skins: Burdam Almanac and Kemdo Long Evening differ from base at the game camera by at least as much as the fighter's standard skin; Ardit and Vashil First Bell portraits pass CW3 ΔE ≥ 18.
- three_load_test PASS on every GLB (Ervet recall ≤ 6 s); lineup_qa run; a per-fighter re-review scores each of the 8 ≥ 8 with no major.

### CW6: Fighter art B

**Goal:** 8 fighters (Dunsom, Hesmi, Ilsheta, Marund, Odrum, Rishal, Sukri, Tunlan) reach the par bar: faces that read as alive, silhouettes that read in lane, recalls that perform, poses without pops, materials that separate and per-skin cards.

**Size:** XL (26 majors over 8 fighters).

| # | Finding | Sev | Size |
|---|---|---|---|
| 1 | `dunsom-hat-flat-plate` (Dunsom): The hat, his largest on-screen surface, renders as a flat pale plate with no value ramp or felt cue. | major | S |
| 2 | `dunsom-idle-recall-frozen` (Dunsom): Idle, recall and channel are frozen poses, and the recall does not do what the brief asks. | major | M |
| 3 | `dunsom-splash-single-pose` (Dunsom): All three splashes are one victory-pose render; Highrim and Almanac reuse one painted scene. | major | L |
| 4 | `hesmi-M1` (Hesmi): The eye-band reads as a clenched-teeth grin, a blank mummy face with no living cue. | major | M |
| 5 | `hesmi-M2` (Hesmi): Honed stone, linen, ironstone and gauntlets all read as one matte plaster; the cut band is the same colour as the hood. | major | L |
| 6 | `hesmi-M3` (Hesmi): Splash and portrait are grainy model renders on a reused plate, with the same static hold on every skin. | major | L |
| 7 | `hesmi-M4` (Hesmi): Shadeprint (deluxe) is a palette swap whose headline 'violet shadows' never reach her shadows, with the base splash and pose. *Split: Model rims, splash and pose are CW6; the effect half (vfxTint reaching her shadows) is CW1 finding SKIN-FX.* | major | M |
| 8 | `ilsheta-idle-recall-frozen` (Ilsheta): Idle, recall and channel are near-static; the 7 s recall loops a 2 s bow that barely moves. | major | M |
| 9 | `ilsheta-skins-indistinct` (Ilsheta): The First Bell deluxe portrait and the Collection skin tiles are indistinguishable from base; base and Stillwater splashes share one pose. *Split: Portraits and splashes are CW6; the Collection tile crop and the gen_store ΔE gate are CW3.* | major | M |
| 10 | `marund-M1` (Marund): At the gameplay camera the cap swallows the maul and the action: attacks and casts read as the disc tipping toward the target. | major | L |
| 11 | `marund-M2` (Marund): The ultimate's 7 m leap plays as a ground slide: no airborne arc, no maul overhead, no landing slam pose. *Split: CW6 authors the domefall_leap clip; CW3 adds the per-effect dash arc (src/sim/movement.ts) and the ult present.anim (content/fighters/marund.json); CW1 adds the dash role in src/render/actors.ts.* | major | M |
| 12 | `marund-M3` (Marund): Idle, recall and channel are nearly static, and the brief's character beats are missing. | major | M |
| 13 | `marund-M4` (Marund): Splash and portrait: grainy renders on a painted plate, one pose for every skin, the cap and windows cropped out of the portrait, mouth artifacts, identical skin tiles. | major | L |
| 14 | `odrum-M1` (Odrum): The yoke reads as a vertical pole through the body for most of a RIFT match, not the brief's horizontal balance-scale read. | major | L |
| 15 | `odrum-M2` (Odrum): At the gameplay camera the felt cap reads as a bald pink scalp and the lifted jerkin as bare pink skin. | major | M |
| 16 | `odrum-M4` (Odrum): Splash and portraits are grainy static model renders; all three skin splashes share one victory pose and composition. | major | M |
| 17 | `rishal-M1` (Rishal): Splashes and portraits are grainy static model renders in one victory stand for all three skins, with the face in shadow. | major | L |
| 18 | `rishal-M2` (Rishal): Recall (7 s) and channel are frozen poses with no motion. | major | M |
| 19 | `rishal-M3` (Rishal): The 1,500-candle Lamplit deluxe is a palette swap plus an 8 cm lamp cage; Chalkline's 'ink-gray steel' does not read on its cards. *Split: Surface, lamp bead and splash are CW6; the skin VFX override path is CW1 (SKIN-FX); the store tier/price is CW3.* | major | L |
| 20 | `SUK-M2` (Sukri): Materials do not separate in engine (chroma 3-8, face disc barely darker than the hood) and the dawnglass cup is an opaque frosted cylinder. | major | L |
| 21 | `SUK-M3` (Sukri): Attacks and Mote Toss share one arm-only staff arc; fist hands; Wrap Cast's overhead loop hides behind the hood; recall staff runs into the hood; stunned cup barely swings. | major | L |
| 22 | `SUK-M4` (Sukri): Splash and portrait are static Cycles renders on a painted plate (roster pipeline); one pose for all three skins; the offered cup is not the focal light. | major | L |
| 23 | `SUK-M5` (Sukri): Shadeprint (deluxe): its headline 'cup holds violet light' never reaches the game, and its splash and portrait reuse the base pose. *Split: Glass and splash are CW6; the violet cup light in play is CW1 finding SKIN-FX.* | major | M |
| 24 | `TUN-C2` (Tunlan): cast_a1 and cast_ult snap pose to pose: the hat and upper body jump about 0.5-0.7 m in one display frame, freeze, then pop back. | major | M |
| 25 | `TUN-C3` (Tunlan): All three splashes are one static victory render with no hound shadow; the lantern is not the focal light, and the Lamplit deluxe card reads as a beige version of the base. | major | L |
| 26 | `TUN-c4` (Tunlan): Recall is a frozen pose played through the whole 7 s recall (upgraded from minor). | major | M |

**Done when:**
- Hesmi eye-band: no block joint inside the eye span, two cool non-emissive glints; chip, portrait and icon read as alive at 26-128 px (sensitivity reviewer).
- Recall and idle: Dunsom, Ilsheta, Marund, Rishal and Tunlan fill RIFT 7 s recall with a performance (no loop seam); their idles reach at least the roster median head travel (3.8 cm).
- Pops: Tunlan cast_a1 and cast_ult move the hat ≤ 0.3 m per 60 Hz display frame with a ≥ 4-frame settle; Marund ult is airborne mid-leap with the maul overhead and a landing slam; Sukri attacks and Mote Toss are distinct clips with open hands.
- Reads in lane: Odrum yoke reads as a vertical pole in ≤ 20 % of lane frames; Odrum cap hue 34-37 deg, sat ≤ 0.20; Dunsom hat crown-to-rim ramp ≥ 10 L*; Marund maul head clears the cap rim at impact; Hesmi stone vs linen dE ≥ 8; Sukri wraps chroma 10-18 with a see-through cup.
- Cards for all 8 as CW5 (own staging per skin, grain ≤ 2x plate); Tunlan hound shadow with the lantern as key; Ilsheta First Bell portrait passes CW3 ΔE ≥ 18.
- three_load_test PASS on every GLB; a per-fighter re-review scores each of the 8 ≥ 8 with no major.

### Polish list (minors, grouped by owning wave)

Each line gives the finding id, its lens, its title and its size; [also ...] names a wave that holds a seam of the fix. The `what`, `evidence` and `fix` fields are in `closing_parity_open.json` → `polish`.

**CW1 Engine, VFX & skin effects** (9)

- `C2` (combat): Hesmi's Felled Shard whites out the struck unit for about 5 frames; its first beat is x2.25 (< 2.3). Nurrow's and Dunsom's ultimates do so for 1-2 frames (S).
- `C3` (combat): Basic-attack impacts read large for only 67-167 ms (S).
- `OBS-camjump` (engine): One-frame actor drop right after a camera focus jump (bars drawn, bodies missing) (S).
- `m-5` (maps): BRIDGE and FRAY lamp flames sit under the flame band (S). [also CW4]
- `m5` (originality): Withdrawn pre-fix images remain in the local dist-catalog (not deployed) (S).
- `PERF-C4` (perf): The real client goes over the 40-program count that the gate's fixed seats hold, and sometimes compiles shaders mid-match (S).
- `hesmi-m3` (Hesmi): The rack top tucks under the player's own health bar during an attack (S). [also CW6]
- `kemdo-M1` (Kemdo): At some facings the lens and its ring pass under her own overhead bar, about a quarter of idle and run frames (M). [also CW5]
- `TUN-c2` (Tunlan): The overhead HP bar's under-panel covers the far brim (S). [also CW6]

**CW2 Audio identity & memory** (7)

- `AUD-C2` (audio): No vocal layer: no fighter voice and no spoken announcer (scoped out by CONTRACT §11) (XL).
- `AUD-C4` (audio): Match music is one 160 s loop plus one intense layer per map; no dead or objective state (M).
- `AUD-C5` (audio): Heal chimes fire about 35 times a minute (flask ticks, small item heals) (S).
- `AUD-C6` (audio): Enemy fighter deaths away from you are silent (no enemy-down cue) (S).
- `AUD-C7` (audio): Announcer lines sit at fight level rather than on top of it (S).
- `AUD-C8` (audio): Some kit autos are narrow tones in the 2-5 kHz band (S).
- `AUD-C9` (audio): Vision has no sound of its own: lamp set uses the generic summon cue, and lamp or summon death is silent (S).

**CW3 Match rules, bots & client** (29)

- `CL-2` (menus): The Draft ban prompt reads 'Your team bans 0.' (S).
- `CL-3` (menus): The inline noon tick reads as the letter 'I' (S).
- `CL-4` (menus): Ally seats lose the fighter name in finalize (the lock-in beat itself exists) (S).
- `CL-5` (menus): Redundant or cryptic copy: queue-card chips, the ledger cap line, the finalize summary, the showcase role, and the ready-check line (S).
- `CL-6` (menus): Key-art paintings are bright daylight against the dusk client (M).
- `CL-7` (menus): Screen transitions stack two full screens of text (S).
- `CL-8` (menus): Unforeseen queue refusals from the session are silent (S).
- `CL-9` (menus): 1280x720 fit gaps: shop skin names and the role picker (S).
- `CL-10` (menus): Home has no tasks or events, the CTA ignores the player's queue, and the top bar ignores the chosen emblem (M).
- `CL-2` (gameplay): Objective contests are thin: Sunsplinter waits about 9 min, Longshade is taken late and only to close (M).
- `CL-g1` (gameplay): The lane hold can leave a base undefended: Hourbell lost at 13.2 min with 6 takedowns (S).
- `CL-g2` (gameplay): The duo road runs about 3 levels behind the solo laners; the carry reaches level 6 at about 9.5 min (S).
- `CL-g3` (gameplay): Tier separation misses the 85 % bar on seed windows the tuning has not seen (S).
- `CL-g4` (gameplay): Per-fighter RIFT balance can't be measured: harness lineups lock teammates together (S).
- `CL-g5` (gameplay): Roster depth: three natives per role, so lane matchups keep recurring (XL).
- `hud-c1` (HUD): Personal highlight banners put 'You' into a third-person line ('You takes five in a row.'), and the banner queue has no priority (S).
- `hud-c2` (HUD): Minimap: fog at vision-cell resolution, flat chart art, and the RIFT numeral callouts are not drawn (M). [also CW4]
- `hud-c3` (HUD): Percent-penetration stat lines read '+10% Magic penetration %' in the tooltip and the shop (S).
- `hud-c4` (HUD): Death recap: damage-type chips can overflow, and the recap has no crowd-control time (S).
- `hud-c5` (HUD): No call-outs from HUD elements: Alt-click on an ability, item or timer does nothing (M).
- `hud-c6` (HUD): Strike-family blade icons look alike at slot size; median subject fill is 0.47 (M).
- `hud-c7` (HUD): Scoreboard: the two team tables size their columns independently (S).
- `hud-c8` (HUD): Kill-feed victim chip: the grayscale filter also greys its team ring (S).
- `hud-c9` (HUD): Empty inventory slots are see-through to the world (S).
- `m1` (originality): Regression: Nurrow's Snuff-on-sleeper bonus contradicts ROSTER §5's 'no wake bonus' (S).
- `m2` (originality): Finished items and boons are outside the re-key gate; Hourcleaver sits near Sterak's Gage (S).
- `m3` (originality): The names lint misses plurals and paraphrases; one 'lanes' leak (S).
- `m6` (originality): Owner-accepted naming and format risk: RIFT, and BRIDGE as a single road over a gorge (S).
- `PERF-C3` (perf): Each match leaves its whole in-match HUD tree in memory as detached DOM, plus 16 small skeleton textures (M). [also CW1]

**CW4 World & unit art** (6)

- `m-1` (maps): The Sunsplinter pit and Fallen Shaft water reads as a tiled blue pool (M).
- `m-2` (maps): Base spawn plazas are empty: no fountain object, and the shop is not visible from spawn (M).
- `m-3` (maps): Procedural cloud-noise blotches on the Seat ring, the base plazas and the Longshade floor (S).
- `m-4` (maps): Cleared camps read as bare paved discs; the camp-lip dressing is too small to read (M).
- `m-6` (maps): shot_structures' collapse and respawn checks silently do nothing at the default t (S).
- `m-7` (maps): Dialwood crowns are still flat, straight-edged plates at close range (F5 residual) (L).

**CW5 Fighter art A + shared card and motion pipeline** (33)

- `OBS-metal` (engine): Residual metalness in fighter ORM maps although the briefs say metalness 0 (S).
- `ardit-M2` (Ardit): Lancing Run pane is foreshortened from the gameplay camera, and Muster's key pose is no bigger than an ordinary cast (M).
- `ardit-m3` (Ardit): Skin portraits are near-identical to the base portrait (S).
- `ardit-M4` (Ardit): Model finish: plain box helm and pauldrons, soft low-contrast whites, pane reads as a pale board in match (M).
- `burdam-M1` (Burdam): The ledger mask is a featureless yellow dome from the game camera, and a darker gold plate on a white dome in the 2D art (M).
- `OBS-burdam-clip` (Burdam): Unverified watch: hand or cleaver vertices inside the mask or cowl in cast_a1 and dash (S).
- `ervet-m1` (Ervet): The death hold puts the left foot and hand through the floor (S).
- `ervet-M2` (Ervet): The showcase idle_lobby barely moves the sword, and the brief's 'turn the blade to the light' beat is weak (S).
- `ervet-m2` (Ervet): The victory hold has no break-and-reform, and the blade point hovers (S).
- `ervet-M3` (Ervet): Whole Again's Great form looks like the base form (seams about 1.3 px) (S). [also CW1]
- `ervet-m3` (Ervet): Stillwater reads almost as the base skin (S).
- `ervet-M4` (Ervet): The blade does not read as glass, and the back of the helm reads as a box from the high camera (M).
- `ervet-m4` (Ervet): Card lames are over the brief's 40 % limit inside the reserved azure band (S).
- `ervet-m5` (Ervet): The base GLB fails three_load_test on the 9 s recall (S).
- `ervet-m6` (Ervet): The brief and the model disagree on blade length and visor (S).
- `kemdo-M2` (Kemdo): The model carries none of her signature hue; she separates from the beige lane by value only (M).
- `kemdo-m3` (Kemdo): Highrim reads close to base outside the portrait (S).
- `kemdo-m6` (Kemdo): The lineup QA still flags Kemdo's value gradient and edge-on accent, and disagrees with the in-match read (S).
- `kemdo-v1` (Kemdo): Verifier-added: at the gameplay camera the brow eave over the dark slit reads as a mouth-like stripe with no visible eyes (S).
- `lisvel-m1` (Lisvel): The bow sinks into the floor in the lobby, taunt and death (S).
- `lisvel-m2` (Lisvel): Each auto-attack whips the bow about 1.9 m in the first two frames (S).
- `lisvel-m3` (Lisvel): The skins are weak: Gorgewalk's body is almost the base's, and both read only through the bow and quiver (S).
- `lisvel-m4` (Lisvel): The portrait loses the bow: only a vertical pale stick with the tip cap shows (S).
- `nurrow-m1` (Nurrow): The hat hides the body: at facing 0 and in the lunges she reads as a disc on legs (S).
- `nurrow-m2` (Nurrow): The hat has no value headroom, and the felt drifts toward rose (mostly in the store art) (S).
- `nurrow-m3` (Nurrow): The death passes the blade and a leg through the floor (S).
- `nurrow-M4` (Nurrow): Lacquer hat and carved mask have no gloss; the normal map is the roster's flattest (materials otherwise separate) (M).
- `nurrow-m4` (Nurrow): The face reads sly rather than asleep; the chip backdrop is in Tunlan's magenta family (S). [also CW6]
- `nurrow-m5` (Nurrow): Skin issues and the Shadeprint store copy are still open (S). [also CW1]
- `nurrow-m6` (Nurrow): The atlas is fragmented, the maps are low-res, and some metalness remains (M).
- `ULK-M4` (Ulkro): Skins are modest: Highrim is a paler sand, and Long Evening has no effect tint (M). [also CW1]
- `ULK-V1` (Ulkro): Verifier-added: the face has no living cue: an opaque wooden band over a linen wrap, a grin-like stripe at the game camera (S).
- `VAS-m5` (Vashil): Side clapper drops are 7 cm faceted azure blobs that read as hanging gems (brief: 2 cm beads, no gems) (S).

**CW6 Fighter art B** (26)

- `hud-c10` (HUD): Sensitivity watch: tight face-chip crops put masks at 60-70 % of the frame (Dunsom, Sukri) (S).
- `C2` (originality): Sensitivity watch: Dunsom's gold mask has ink eye recesses and teeth-like lower seams, and reads skull-adjacent at chip size (S).
- `dunsom-face-skull` (Dunsom): The carved mask's ink eyes have no catch-light and read stern and skull-adjacent at chip size, and the chip omits the lantern (S).
- `dunsom-lantern-nameplate` (Dunsom): At idle the lantern sits behind the nameplate and the shaft crosses the HP bar (leftover 14) (S). [also CW1]
- `hesmi-m1` (Hesmi): Value bands miss the brief; the boots render saturated violet instead of leather (S).
- `hesmi-m2` (Hesmi): No secondary motion (0 spring chains) (S).
- `hesmi-m4` (Hesmi): On her own screen the inlays render near-white against the pale band (S).
- `hesmi-m5` (Hesmi): The icon has no cut top, though the brief asks for one (S).
- `hesmi-m6` (Hesmi): Fragmented texture atlas and speckles on the hood (S).
- `ilsheta-chimney-hook-lost` (Ilsheta): The chimney visor reads as a small grey cap, not the brief's brightest vertical, and its glass renders as an opaque white tube on the plinth (M).
- `ilsheta-no-own-hue` (Ilsheta): The model carries none of her signature hue, so the self view and portrait chips are colourless (S).
- `marund-M5` (Marund): Stone, linen and mask read as one pale, low-chroma matte family in close views (S).
- `marund-v1` (Marund): Verifier-added: no sway or cap bones; the brief's apron chains are not delivered (M).
- `odrum-M3` (Odrum): Feet glide flat on the floor in attack2, three casts and victory (no lift on the step-ins) (M).
- `rishal-m1` (Rishal): At the gameplay camera the head reads as a white egg under a three-prong 'rabbit-ear' V; the self accent disappears (M). [also CW1]
- `rishal-m2` (Rishal): The brief's knife guard and two-plate crest are not delivered (S).
- `rishal-m3` (Rishal): Blades pass into the thigh, tabard and hips; a foot goes 21 cm through the floor in death (S).
- `rishal-m4` (Rishal): The tabard is skinned to the legs with no secondary motion (M).
- `rishal-m5` (Rishal): Model finish: ragged back strap, residual metalness, bare dowel neck (S).
- `rishal-m6` (Rishal): The model carries none of his crimson signature and sits in the roster's cool grey cluster (S).
- `SUK-M1` (Sukri): Watch item: short chin cracks under the mouth corners (and a nose-bridge nick) on the carved face (S).
- `SUK-m2` (Sukri): The top of the face disc sits in the hood's shadow in the portrait, and a near-black crescent frames the mask on the shadow side (S).
- `TUN-C1` (Tunlan): In match the robe renders darker than the lane and well below the brief's mid band, and the hands are often under the brim (S). [also CW1]
- `TUN-c1` (Tunlan): Death has no opening bow, the hat pops off the head in one frame, and she ends on hands and knees (S).
- `TUN-c3` (Tunlan): In the run cycle the dark leggings break through the robe hem (S).
- `TUN-c5` (Tunlan): The head reads as a box with a cracked carved face in close views (S).

## (e) What was not measured

- **LoL itself:** no LoL video, pixels or audio were captured. The gauge comes from r12, r04-r07 and r09 and their sources. Two LoL figures used for severity are from memory, not primary sources:
  - about 6 kills per team by 10:00;
  - the first-Baron win rate.
  Swiftplay's level-3 start with 1,400 gold was confirmed on Riot's support page.
- **Hardware:** only an Apple M5 with ANGLE-Metal Chrome at 60 Hz. The effect of PERF-C1 and PERF-C2 on 8 GB or integrated-GPU machines is inferred, not measured. The Windows (D3D11) GPU timer is untested.
- **Online:** none of this was tested:
  - PvP and parties;
  - friends, invites and real ready-check peers;
  - surrender votes and ping muting;
  - real-network download times.
- **Human feel:** none of this was tested:
  - human-vs-bot input traces;
  - a human listening test (audio was judged by loudness, spectra and distances only);
  - fatigue over a 30-minute match.
  The default audio device does not render on this Mac, so captures used Chrome's fake output.
- **Tiers and accessibility:** these were not checked:
  - kit VFX at Medium and Low;
  - the environment at Medium and Ultra;
  - colourblind palettes;
  - reduced motion and the UI-scale extremes;
  - gamepad;
  - localisation headroom.
- **Combat coverage:** these were not measured:
  - the ally (blue) view of the a3/ult hue test;
  - a dense 6-10 effect teamfight by metric;
  - the full run of all 17 CC looks;
  - the T2 secondary-shape audit (m5);
  - damage-number timing against the impact frame;
  - Hesmi's attack tip travel in metres.
- **HUD and client coverage:** these were not measured:
  - the 'Not enough {resource}' caption;
  - multikill, streak, shutdown and team-wipe banners;
  - a real multi-source death recap;
  - ready-wash timing;
  - the BRIDGE and FRAY minimaps;
  - the Core and Apex shop trees;
  - ranked placement screens;
  - custom lobbies;
  - match-history reopen (code only).
- **World coverage:** these were not measured:
  - objective pits with their objectives spawned;
  - BRIDGE gameplay shots with fog (they timed out under load);
  - wallmask on BRIDGE;
  - dynamic world moments;
  - per-quadrant hue tint;
  - the Wick hood value half of M8.
- **Performance coverage:** these were not measured:
  - a production-bundle full match (the real-client runs used a dev-flag bundle);
  - `npm run package` size;
  - throttled-network load times;
  - the hitch length of mid-match shader compiles;
  - the heap retainer path of the leaked HUD;
  - memory on BRIDGE and FRAY beyond the one pass in the PERF-C2 run.
- **Audio coverage:** these were not measured:
  - an ult cast in a real Chrome capture (the ult layering was proven on a stub match);
  - BRIDGE and FRAY mix in real Chrome;
  - Safari before 18.4;
  - whether the music's combat layer engages at the right moments.
- **Gameplay coverage:** these were not re-run by the verifier, which accepted the reviewer's runs:
  - BRIDGE, FRAY, G5-G8 and practice;
  - RIFT per-fighter balance, which cannot be measured until CL-g4 lands.
- **Fighters:**
  - **Unverified reviewer minors:** some were cut off in the hand-off to verifiers and are not in this list. They are Dunsom's after the nameplate item, all of Ilsheta's, Kemdo's m1, m2, m4 and m5, Odrum's after M4, and all of Vashil's except m5.
  - **Fresh GPU runs:** where a GLB was unchanged since the reviewer's capture, several verifiers re-measured the raw frames and the GLB instead of queueing a new GPU run.
  - **Burdam watch:** his cast_a1 and dash frames (hand or cleaver inside the mask) were not rendered.
- **Originality:** none of this was audited:
  - trademark registry searches;
  - git-history contents;
  - melodic similarity of the music;
  - provenance of the AI-generated art.
  The secret-scan fix lives on this branch, and master picks it up when the branch merges.
