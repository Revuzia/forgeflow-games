# VALE improvement plan (orch1)

Written 2026-11-15 07:15 Central on HEAD e490e9d4f. Machine-readable copy: `_design/reviews/orch1/plan.json`.

## Where VALE stands

Par is a verified 7.5 out of 10 with no blocker. No dimension is there yet. The lowest is fighters (5.5), and four blockers are open.

| Area | Score | Open blocker |
|---|---|---|
| Rendering and look | 6.2 | none (the 'bodies buried in fights' frame is likely a capture bug; re-proving it in W1-D) |
| Fighters, units, animation | 5.5 | Odrum's mask reads bone-ivory (FU-2) |
| VFX and combat feel | 7.0 | none |
| Gameplay, balance, systems | 6.4 | none |
| Controls and UX | 6.5 | HOLD-DITHER: a held right button ping-pongs in packed lane fights (CUX-1) |
| Audio | 6.8 | BRIDGE/FRAY too loud, 3-7 LU over the token (AUD-O1) |
| Performance and shipping | 6.5 | 60 fps on High never measured on an idle machine |
| Verify: controls sim | 6.8 | ally-wave pockets, held moves pinned by sieging allies |
| Verify: controls live | 6.5 | HOLD-DITHER reproduces live |
| Verify: ambience ('heavy wind') | 8.0 | none: closed |

## What is safe to ship right now

- Nothing is deployed until the owner gives the release go-ahead (git only, no Cloudflare). The items below are ready for the next playtest upload once the wave-1 idle gate (real-time match, match memory, High frame timing on a quiet machine) passes.
- Ambience bus fix (rulings 34/37): verified pass 8.0 on RIFT/BRIDGE/FRAY live; no heavy wind or repeating whoosh. Safe.
- Player-facing wording commit b888b6fd6 (no bots/AI/CPU words; local seat names; copy probe covers dist and catalog). Safe.
- Ruling 38 movement and picking as on HEAD: wall clicks 4,400/4,400 clean, 0 uncommanded movement over 61,705 live frames, targeting 24/24, Shift 31/31, A-click 32/32, Z 32/32, determinism digests equal. Strictly better than round 3, but the HOLD-DITHER blocker stays open, so it ships as an improvement, not as 'controls fixed'.
- Budgets on HEAD: 445-483k tris (bar 500k), 280-295 draws (450), 40 programs (40) with 0 late, 57/57 probes, build exit 0, 0 console errors. No regression to block an upload.
- NOT safe to call par or to ship as final: Odrum's bone-ivory mask (sensitivity blocker FU-2) is in the live GLB, the BRIDGE/FRAY masters are 3-7 LU too loud, 40 of 96 cards fail, and 60 fps on High has never been measured on an idle machine.

## How the work is ordered

Your reported issues come first: clicking and pathing, targeting, the 'heavy wind', fighter models and cards. Next come the blockers, then everything else by how much a player sees per unit of effort. Duplicates from different reviewers are merged into one item. For example, the four 'fighters are buried under effects' items are one W2-B item, and the two onboarding proposals are one W3-C item.

- **Wave 1** fixes what you reported and what blocks shipping: held moves, ally waves, Shift + left-click to shoot in place, Wicks stuck at the first tower, Odrum's face, fighter colours, the loud BRIDGE/FRAY mix, trustworthy capture tools and crash-proofing.
- **Wave 2** is the look: a brighter world, fighter colour on screen, readable teamfights, cards rebuilt as key art, cast feel and HUD fixes. Cards wait for wave 2 so each recoloured fighter is shot once, after its colours and hands are final.
- **Wave 3** is depth: bots that defend and peel (your ask), balance into the band, animation, onboarding and sound feel.
- **Wave 4** is breadth: vision and ambushes (your 'sneak attack' ask), environment look 2, platform reach and new systems.

Machine rule: each wave has at most 5 lanes, and at most 3 of them heavy. Each heavy lane has its own verifier, so that is at most 6 heavy agents. Every build, Blender run, browser match, soak and perf run goes through `heavy.py`.

## Which model does what

**Opus 5.5** takes work that needs judgement: sim and nav engineering, shaders and render budgets, mix architecture, art direction (colour, cards, animation, VFX look), bot macro and balance, and every adversarial verdict on sensitivity, readability or feel.

**Sonnet 5.5** takes work that is specified and measurable: harness and capture fixes, gates and probes, CSS and layout, robustness fixes with tests, and measurement runs.

| Wave | Lane | What | Implementer | Verifier | Heavy |
|---|---|---|---|---|---|
| 1 | W1-A | Controls: held moves, ally waves, attack in place, stuck Wicks (ruling 39) | Opus 5.5 | Opus 5.5 | yes |
| 1 | W1-B | Fighter colour and faces: Odrum mask, Ardit helm, roster hue wheel | Opus 5.5 | Opus 5.5 | yes |
| 1 | W1-C | Audio mix: loudness leveller, announcer over fights, heal chime budget, loop seams | Opus 5.5 | Opus 5.5 | yes |
| 1 | W1-D | Evidence and gates: capture pack, units gate, clutter gate, quiet precheck | Sonnet 5.5 | Sonnet 5.5 | no |
| 1 | W1-E | Ship hardening: device gate, two tabs, frozen-match recovery, CDN headers (code only) | Sonnet 5.5 | Sonnet 5.5 | no |
| 2 | W2-A | Render look and budget headroom: luminous world, chroma on fighters | Opus 5.5 | Opus 5.5 | yes |
| 2 | W2-B | VFX readability: bodies stay visible in teamfights, death moment, black puffs | Opus 5.5 | Opus 5.5 | yes |
| 2 | W2-C | Cards and hands: hand skinning, key-art splashes and portraits | Opus 5.5 | Opus 5.5 | yes |
| 2 | W2-D | Controls feel: cast buffer, quick cast with indicator, range display, binds | Opus 5.5 | Opus 5.5 | no |
| 2 | W2-E | HUD and UX polish at 1366x768 and 1080p | Sonnet 5.5 | Opus 5.5 | no |
| 3 | W3-A | Bot macro and balance: defend, peel, Longshade, pings, win-rate bands | Opus 5.5 | Opus 5.5 | yes |
| 3 | W3-B | Fighter animation: CC body states, attack line of action, walk blend, value ladder | Opus 5.5 | Opus 5.5 | yes |
| 3 | W3-C | Onboarding: guided first match, event hints, postgame coaching, match log | Opus 5.5 | Opus 5.5 | no |
| 3 | W3-D | Audio feel: own vs foe bells, auto-hit crack, punchy kit hits, UI feedback, music rest | Opus 5.5 | Opus 5.5 | yes |
| 4 | W4-A | Vision depth and ambush play | Opus 5.5 | Opus 5.5 | yes |
| 4 | W4-B | World look 2: fog presentation, canopies, ground macro, water, dawnglass | Opus 5.5 | Opus 5.5 | yes |
| 4 | W4-C | Platform reach: compressed textures, Safari, real network, low-end CPU | Opus 5.5 | Sonnet 5.5 | yes |
| 4 | W4-D | Systems depth: keystones, kit identity, re-keys, facets, mastery | Opus 5.5 | Opus 5.5 | no |
| 4 | W4-E | Ultimate wind-up identity and off-screen threat cue | Opus 5.5 | Opus 5.5 | no |

## Wave 1

### W1-A: Controls: held moves, ally waves, attack in place, stuck Wicks (ruling 39)

**Goal:** A held right button through a packed lane fight always makes progress, the hero walks through its own standing or sieging Wicks, Shift + left-click shoots in place in any direction, and Wicks never freeze at the first mid tower.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Deterministic sim pathing with 4 rounds of regressions behind it, plus two new owner asks from 2026-11-15; needs hard engineering and adversarial sim and live verification (two opus verifiers: sim lens and live lens).

**Work:**

- CUX-1 BLOCKER HOLD-DITHER (dunsom 8:15, 5 reversals in 4 s) and HOLD-PINNED-CRAWL (0.25 m/s on the north wall): commit to an escape lane for >= 2 watchdog windows, forbid a lane whose first leg reverses the last window's, slide on the wall tangent when pinned.
- ALLY-WAVE-SHORT and ALLY-SIEGE-PIN-HELD (verify_controls_sim): own standing or sieging Wicks are walk-through or yield for the local fighter (industry standard: allied minions never box in a hero).
- LATE-HELD-REVERSALS after knockback: the relaxed stuck lane must not walk away from the point for more than one window.
- Owner 2026-11-15: Shift + left-click attack in place (new attackAt command, rebindable attackInPlace, held re-send at attack speed); make test-first probes probe_sim_attack_at and probe_input_shoot pass.
- Owner 2026-11-15 / GPO-19: Wicks stuck at the first mid tower (2536 stuck Wick-seconds per 8 games); make probe_sim_minion_flow and probe_sim_hold_tower pass.
- Minors: pick 216 / 3.21 M wrong near silhouette edges (use the true perspective silhouette); BRIDGE hold-steer backup 0.10-0.17 m (ruling 36 says 0.00); RIFT waves 3 of 816 ending > 2 m short.
- Write ruling 39 in fixwaves/owner_rulings.md (by delegation) with the measured before/after table, superseding the ruling 38 claims that the verifiers disproved.

**Files this lane owns:** `src/sim/movement.ts`; `src/sim/bodypath.ts`; `src/sim/nav*.ts`; `src/sim/units/minions.ts`; `src/sim/core.ts`; `src/sim/world.ts (command validation only)`; `src/sim basic-attack path for attackAt`; `src/contracts/sim.ts (Command union only)`; `src/input/**`; `src/render/pick.ts`; `src/session/settings.ts + src/ui/screens/settings.tsx (attackInPlace bind row only)`; `_harness/probe_sim_hold_tower.ts, probe_sim_attack_at.ts, probe_input_shoot.ts, probe_sim_minion_flow.ts, probe_sim_core_orders.ts, verify_controls_sim_orch.ts, verify_controls_orch.mjs`; `_harness/_tmp_diag_minion_*.ts (promote or archive)`; `_design/reviews/fixwaves/owner_rulings.md (ruling 39 section)`

**Done when:**

- Probes: probe_sim_hold_tower, probe_sim_attack_at, probe_input_shoot, probe_sim_minion_flow all pass; npm run check 62/62 (or more) pass.
- verify_controls_sim_orch on RIFT and BRIDGE, both held runs (4:00-5:30 idle seats and after 8:00 bot seats, 384 moves each): 0 moves with >= 3 reversals of >= 0.5 m legs in any 4 s; 0 held moves ending > 2 m short of an uncrowded point; 0 held moves motionless > 1.5 s while a way exists.
- Waves sampler 816+ moves a map: 0 moves > 2 m short of an uncrowded point with a lane <= 1.3x; detour p95 <= 1.10x of the Dijkstra reference; hold-steer backup <= 0.05 m on every face and corner.
- Pick: wrong-body clicks <= 0.001 % of occlusion clicks and 0 of clump clicks.
- Wicks: <= 100 stuck Wick-seconds per 8 veteran RIFT games and no single Wick stuck > 10 s at the (152,64) / (16,64) gate hotspots.
- Live (real Chrome 1920x1080, 4 fighters incl. dunsom repro, all scenarios after 4:05): 0 HOLD-DITHER, 0 hold crawl under 0.5 m/s for > 2 s, uncommanded movement 0 m, targeting rows no worse than orch1 (24/24, 31/31, 32/32, 32/32, wall 64/64); Shift + left-click 32/32 send attackAt with no move.
- Determinism: same command stream twice gives equal digests on RIFT and BRIDGE; probe_sim_determinism passes.
- Soak (--full --lineup shuffle, seeds 1-40): veteran beats novice >= 72/80, laners in lane >= 65 %, BRIDGE sudden death <= 25 %, 0 bot faults; no gate worse than the ruling 38 baseline.
- Both opus verifiers (sim lens, live lens) score >= 7.5 with no blocker.

### W1-B: Fighter colour and faces: Odrum mask, Ardit helm, roster hue wheel

**Goal:** No fighter face reads as bone, skull or blank; every fighter owns one hue family at the game camera; no enemy top reads ally blue.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Roster colour art direction under the sensitivity and reserved-band rules (three mechanical regrade rounds each made a new collision); the face sign-off is a sensitivity call that needs an adversarial opus eye.

**Work:**

- FU-2 BLOCKER: Odrum mask and hands back to honey (exclude head-skinned texels and the mask island from reserveModes; pay the harm cap by hue shift, not desaturation); cap to deep olive L* <= 40 in game.
- FU-3: Ardit helm out of the ally band (HSV h 180-190 steel-teal or cool slate, coat one value step darker for a crown break); Dunsom and Ulkro zoned under the 8 % harm cap by hue shift, head islands excluded.
- FU-1: roster hue wheel in tokens.json (each top >= 30 deg CIELAB h from every other at C >= 15, outside reserved bands). Keep Vashil lilac; move Dunsom to slate-indigo or ochre and Hesmi to deep teal-ink; bake out Hesmi's cream creases.
- Starts on FU-2 with lineup_qa; switches to the units_gate from W1-D as soon as it lands (W1-D delivers it first).
- npm run content after every GLB change; Burdam not touched (no rebuild needed); Dunsom head and mask untouched (cards lane).

**Files this lane owns:** `art/blender/fighters/{odrum,ardit,dunsom,ulkro,hesmi}.py (zones only, not heads)`; `art/blender/common/zone_grade.py`; `art/blender/fighters/zone_grades.json`; `art/out/fighters/{odrum,ardit,dunsom,ulkro,hesmi}/** and their skins`; `_design/tokens.json (units.hueWheel section only)`; `dist-catalog (via npm run content)`

**Done when:**

- units_gate (W1-D) PASS over 3 seeds x 3 seatings, all 16 fighters: no pair of tops under 30 deg hue with dE < 25; no top in the ally (HSV 200-225), enemy or harm band; values inside the bible band; every fighter has a crown break.
- Odrum in game: mask hue 28-50 HSV and not L* > 75 at low chroma; cap L* <= 40; Ardit helm HSV h 180-190 and dE >= 25 from Lisvel's wrap.
- Ruling 32 harm cap <= 7 % (1 point of margin) on Dunsom, Ulkro and Odrum by both PIL and float measures.
- Every changed GLB within its KiB budget; perf_1080 seed 23 triangle peak not above 483k.
- Opus sensitivity verifier A/B at game camera, card size and 64 px: no skull, bone, blank, mannequin or glowing-eye read on any changed fighter or skin; colour lens score >= 7.5.

### W1-C: Audio mix: loudness leveller, announcer over fights, heal chime budget, loop seams

**Goal:** Every mode plays at the same loudness (-18 +/- 1.5 LUFS), news lines rise over the fight, heals stop chattering, and no ambience loop drops out at its seam.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Mix architecture that must not flatten threats or your own kit (reviewer blocker AUD-O1); needs design judgement and careful DSP engineering plus a critical-listening verifier.

**Work:**

- AUD-O1 BLOCKER: density-aware sfx-bus leveller (cut only, <= 8 dB, attack 0.8 s, release 3 s, -19 LUFS sfx target) with a priority sub-bus after it for AWARE threats, hits on you and your own kit; per-mode trim kept in content/audio.json (not modes.json, which the balance lane owns later).
- AUD-O2: re-measure the announcer margin after O1; if still failing, SFX_DUCK_NEWS_DB 6 -> 8 for band 1-3 lines and duck the priority sub-bus under news.
- AUD-O3: heal chimes only for your own fighter and big ally heals near you; 6/min token bucket, 1 s team merge, >= 25 % max HP bypass.
- Ambience minors from verify_ambience: amb_rift_canopy 110 ms seam silence, amb_fray_lantern 70 ms hole and hiss-class wash (apply the wash gate and its HF cap).
- AUD-O13: one idle runtime proof JSON in _design/reviews/orch1/ at lane end.

**Files this lane owns:** `src/audio/**`; `audio/build.py`; `audio/synth/** (ambience loops only)`; `content/audio.json`; `tools/build_content.ts (audio schema block only)`; `_harness/probe_audio_*.ts`

**Done when:**

- probe_audio_runtime match on rift_coop 3/7/11/21 and bridge_standard / fray_standard 3/7/11: every master inside -18 +/- 1.5 LUFS with >= 0.5 LU margin; own-kit share >= 50 %.
- announcerPeakOverSfxP99Ge3 passes on every run above; healPerMinLe6 passes on bridge_standard 3/7/11.
- audio/build.py --gates PASS; no digital-silence run > 5 ms at any loop seam; ambience bus >= 8 LU under the music at every spot of the 25-point spot probe (ruling 37).
- Pits 3/7/21, probe_audio_announcer and probe_audio_kits pass.
- Opus listening verifier on a BRIDGE 5v5 teamfight capture: no audible pumping, own autos and incoming threats still forward; score >= 7.5.

### W1-D: Evidence and gates: capture pack, units gate, clutter gate, quiet precheck

**Goal:** Every later visual lane can be verified on trustworthy frames, and the idle gates can only run on a quiet machine.

**Models:** implementer Sonnet 5.5, verifier Sonnet 5.5. Mechanical harness and probe work with gates already specified by the reviewers; verification is a numbers check.

**Work:**

- FU-4 first (W1-B needs it): units_gate merging max_units_ab and lineup_qa (rendered CIELAB + HSV, 3 seeds x 3 seatings, min over seeds).
- GFX-11 / FU-16 / VFX-O1(1): orch1_visual_pack.mjs waits for ModelLibrary.pending == 0 and asserts every fighter mesh visible before cap; spectator or local seating so all 16 fighters capture; lossless PNG or WebP q95; correct labels; camps at spawn, mid-fight and death.
- VFX-O1(2-3): 5v5 scan (>= 4 fighters a side within 14 m, objective grouping or scripted moves, seeds 7/11/23) and a 'clutter' section in probe_combat_polish (body occlusion, self-ring found, enemy telegraph edge, particles vs budget). Gates are measured here, enforced by W2-B.
- VFX-O9: 'moments' session (Pit last hit, level up, own kill, Noon Toll) at 0/0.1/0.3/0.8/1.5 s on High and Low with a fired-def log.
- TECH-03: --require-quiet precheck in perf_1080 and probe_match_memory (wait, never kill: outside Chrome GPU <= 5 % CPU, load1 < 2.5, no heavy slot held).
- TECH-04: perf_1080 --match-modes rift,bridge,fray --match-q high,ultra plus RIFT seeds 3 and 21; per-mode peaks in idle_gates.json.
- GFX-10 table (per-tier SSIM and dE vs Ultra incl. Medium) and CUX-16 latency_probe.mjs (UI feedback frames, movement start ms).

**Files this lane owns:** `_harness/orch1_visual_pack.mjs`; `_harness/units_gate.* (new)`; `_harness/max_units_ab.*, lineup_qa.* (read; wrap)`; `_harness/probe_combat_polish.ts (new clutter section only)`; `_harness/perf_1080.mjs`; `_harness/probe_match_memory.*`; `_harness/latency_probe.mjs (new)`; `_design/reviews/orch1/evidence/**, quality_tiers.json`

**Done when:**

- units_gate runs in <= 15 min through heavy.py and reproduces the known fails on HEAD (Vashil-Dunsom dE 6.3, Ardit helm in the ally band).
- Visual pack: 16/16 fighter crops non-empty with the asserted entity id; every teamfight frame has all fighter meshes visible; no palette-quantised grade frames.
- Clutter scan finds >= 30 peak frames with >= 4v4 within 14 m on at least 2 of seeds 7/11/23 and reports median body occlusion, worst-fighter occlusion duration, telegraph edge and self-ring rate.
- --require-quiet refuses to start with load1 >= 2.5 or an outside Chrome GPU helper > 5 % CPU and logs load1 in every report.
- perf_1080 multi-mode run completes and writes per-mode, per-tier tri/draw/program peaks.
- Moments pack has frames for all 4 moments with the fired-def log; GFX-10 table and latency probe report written.
- Heavy use: short capture runs only, always through heavy.py.

### W1-E: Ship hardening: device gate, two tabs, frozen-match recovery, CDN headers (code only)

**Goal:** No player can land in a match that draws nothing, lose purchases to a second tab, or sit in a silently frozen match; returning players stop re-downloading 55 MB.

**Models:** implementer Sonnet 5.5, verifier Sonnet 5.5. Contained, well-specified robustness fixes with test hooks; the CDN change is a header table verified by a local test, and deploying waits for the owner.

**Work:**

- TECH-07: branded plate before mount when WebGL2 is missing, the device is touch-only or the window is under 1024x600; 'try anyway' for hybrids; uses state.error.webgl.
- TECH-08: navigator.locks single-tab lock (or rev + storage-event reconcile) and a toast when the profile store is degraded.
- TECH-09: 30 consecutive pump failures end the match as interrupted (no rating change) and return Home with a toast; 30 render failures show the lost plate and retry setup once.
- TECH-01 (code only, no deploy): add vale to IMMUTABLE_HASHED_GAMES, immutable rules for content-addressed catalog paths, no-cache + ETag for manifest/config/game_controls, 304 on If-None-Match.
- TECH-12: npm run check:browser through heavy.py writes gate_<HEAD>.json; tools/package_deploy.ts refuses to stage without a green report for the tree (logged --override).

**Files this lane owns:** `src/main.ts`; `src/boot/**`; `src/ui/app.tsx (frame-loop error handling only)`; `src/session/profile_store.ts (+ identity hooks)`; `../../workers/games-cdn/src/index.js (vale opt-in only)`; `tools/package_deploy.ts`; `_harness/run_probes.ts, package.json scripts`; `_harness/e2e cases for render=0, touch, two tabs, fault injection`

**Done when:**

- e2e ?render=0 and touch-emulated runs show the plate and cannot queue a match; desktop runs unchanged; 0 console errors.
- Two-store probe: a second tab cannot overwrite wallet, skins or history; the degraded toast shows when storage throws.
- Dev-only fault injection: 30 pump throws -> Home with toast, profile saved, rating unchanged.
- Worker unit test (node, no deploy): hashed vale assets get immutable, manifest gets no-cache + ETag, a matching If-None-Match returns 304; other games' headers byte-identical to before.
- package_deploy refuses a tree with no or red gate_<HEAD>.json.

## Wave 2

### W2-A: Render look and budget headroom: luminous world, chroma on fighters

**Goal:** The world reads luminous and mid-value, fighters out-chroma the floor, and every render budget has headroom again.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Whole-frame value re-key and a hue-preserving character light are art direction plus shader engineering at the 40-program cap; GFX-1 also relaxes an earlier value bar, so it needs a recorded ruling.

**Work:**

- GFX-4 + TECH-05 (merged): fold define-only and per-asset MeshStandardMaterial variants into the uber / world_material paths; target <= 36 programs (stretch 34), 0 late.
- GFX-4 LOD + FU-15 + TECH-14 (merged): non-local fighters to LOD1 at the default zoom, face-locked LOD2 beyond ~22 m or past 6 on screen; actors <= 190k at peak.
- GFX-1: record ruling 40 (by delegation, industry standard for stylised MOBAs: mid-value low-chroma environment, heroes pop by chroma and edge light) superseding r12 B5 bands, then re-key lanes to L* 50-58, jungle floor 28-34, wall faces 24-30, env chroma x0.75; re-solve valeFogShade.
- GFX-2 + FU-5 (merged): hue-preserving crown and fill in the CharLight path, lower AO weight on fighter bodies, top-25 L* <= 80, signature zones C* >= 20.
- GFX-5: fog vs Standing Shadow separated (violet chroma on the Shadow, texture cue in fog).
- GFX-13: per-map height-gradient tint and jungle light-pool decals (no new program).

**Files this lane owns:** `src/render/{lighting,world_material,post,renderer,uber,fog,lod,crowd,quality,sky}.ts`; `src/render/terrain*.ts (materials only)`; `content LUTs (per-map .cube)`; `_design/tokens.json (grade section only)`; `_design/reviews/fixwaves/owner_rulings.md (ruling 40 section)`

**Done when:**

- perf_1080 multi-mode/tier gate (W1-D): programs <= 36 on every mode and tier with 0 first seen after 1:00; triangle peak <= 470k on every gated case; draws <= 450.
- Idle A/B frame time on High 1080p no worse than the wave-1 baseline + 0.5 ms.
- value_probe: lane p50 L* 50-58, jungle floor 28-34, walls 24-30 on all 3 maps; telegraph dE and HARM contrast gates pass; colour-blind sheets pass.
- Fighters: on-screen C >= 70 % of albedo C on signature zones, top-25 L* <= 80; units_gate still passes; Vashil lilac rule dE76 >= 25 holds.
- Fog vs Standing Shadow dE >= 15 on display in a paired Noonline capture.
- Opus render verifier on the W1-D pack: score >= 7.5, no blocker.

### W2-B: VFX readability: bodies stay visible in teamfights, death moment, black puffs

**Goal:** In a 5v5 fight every fighter's body, pose and weapon stay readable; a kill lands as a moment; lanes stop dropping black blots.

**Models:** implementer Opus 5.5, verifier Opus 5.5. A VFX-versus-character compositing rule and the shield-shell look are readability art direction plus render engineering; peak-load verification is adversarial.

**Work:**

- GFX-3 + FU-6 + VFX-O2 + VFX-O3 (merged character protection): VFX alpha/luminance x0.45 inside a fighter mask (reuse INK.mask, no new program), T4 exempt 150 ms; shield orbs fill <= 0.12, rimPow >= 3, scale <= 1.25 x body; zone fills ally <= 0.10, enemy <= 0.18 with the edge carrying identity. Confirm the bodiless lead frame on the W1-D pack first.
- VFX-O4: verify the death event path with a real kill, then collapse on the death tick and a T3 fighter-death VFX (no face fragments).
- VFX-O6: replace ink_puff #17181B in lib_wick_death (and Hesmi / shadow / silence / summon specks) with warm-grey dust.
- VFX-O7: heavy physical hit decal becomes a chalk crack star (L* 45-55).
- VFX-O8: Hesmi, Nurrow, Vashil ults to detailLost <= 1.
- VFX-O10: VFX triangle budget 35k at the 5v5 peak (lower-segment orbs and ringwaves).

**Files this lane owns:** `src/render/vfx/**`; `src/render/ink.ts`; `src/render/director.ts`; `src/render/actors.ts (death collapse timing only)`; `tools/vfx/**`; `content/vfx.json`; `_harness/probe_combat_polish.ts`; `_design/tokens.json (vfx.rules only)`

**Done when:**

- Clutter gate on >= 30 5v5 peak frames: median fighter body occlusion <= 25 %, no fighter > 60 % for > 300 ms, VFX at display L* > 85 covering <= 30 % of any silhouette, enemy telegraph edge >= 0.45, self ring found 100 %.
- probe_combat_polish all sections pass; Hesmi/Nurrow/Vashil detailLost <= 1 and body min >= 0.45.
- grep: no #17181B emitter outside sanctioned Shade uses; vfx_gallery A/B shows dust, not blots.
- Real-kill capture: death VFX and collapse start on the death tick.
- VFX triangles <= 35k at the 5v5 peak; draws <= 450 with the mask; programs not above W2-A's count.
- Opus adversarial verifier at peak load: score >= 7.5, no blocker.

### W2-C: Cards and hands: hand skinning, key-art splashes and portraits

**Goal:** Every fighter's 6 cards read as painted key art at par, with clean hands and safe faces.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Key-art direction and face design under sensitivity rules; every card needs a by-eye adversarial verifier. Starts after W1-B so recoloured fighters are shot once.

**Work:**

- FU-10: fix hand, finger and prop.R weights in the rig step; add the hand-integrity clip_probe check across all clips, fighters and skins.
- FU-11: per-fighter key-art brief, hero lighting rig with a value ladder, paint-over only via tools/imagegen/run_xai.py with silhouette and face locks; the 40 failing cards first, then lift every set to par.
- FU-17: Burdam head (warmer skin, brow and beard mass, lidded eyes kept), then re-shoot his 3 failing splashes.
- Burdam post-build steps after any rebuild (decimate_chains, ORM q40, normal q80, glb_zero_metal, ~1157 KiB).

**Files this lane owns:** `art/blender/common (rig / skin step)`; `art/blender/cards/**`; `art/blender/fighters/{burdam,dunsom}.py (heads and hands only)`; `art/out/fighters/**/cards`; `art/renders/fighters/**`; `content card entries`; `_harness/card_qa*, clip_probe*`

**Done when:**

- Hand-integrity probe: 0 hand triangle edges outside 0.4-1.6x rest over every clip, fighter and skin.
- card_qa passes 96/96; the opus by-eye verifier finds no sensitivity tripwire (no blank, skull, mummy, mannequin, glowing or hollow eyes, tear streaks, tall or pointed hoods) at full, 128 and 64 px.
- Every fighter's card set scores >= 7.5 by the verifier (par); figure >= 2 stops off the background, face 8-12 % of a splash.
- Burdam GLB <= 1172 KiB; units_gate still passes.

### W2-D: Controls feel: cast buffer, quick cast with indicator, range display, binds

**Goal:** No eaten inputs, the genre's quick-cast-with-indicator mode, and a visible attack range.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Changes sim command semantics and input lifecycle (key repeat, self-cast modifier, level-up modifier); input feel is a judgement call that needs an adversarial verifier. Runs after W1-A because it shares src/input and the sim command path.

**Work:**

- CUX-2: one pending cast per entity, 0.4 s expiry, cleared by move/stop/CC/death, fired on the first free tick; HUD outlines the queued slot; player commands only.
- CUX-3: per-slot castMode (normal / quick / quickIndicator) with migration from quickCast; release-to-cast; right-click or Esc cancels.
- CUX-6: rebindable showRange hold plus a ring while attack-move or Shift is armed (reuse the telegraph material).
- CUX-11: levelUpMod (default ControlLeft) and viewAlly1-4 hold keys.

**Files this lane owns:** `src/input/**`; `src/sim/abilities.ts and castSystem`; `src/contracts/sim.ts (PlayerView pending-cast field)`; `src/session/settings.ts`; `src/ui/screens/settings.tsx (Controls tab)`; `src/render/overlay/rings.ts, telegraphs.ts (range ring only)`; `_harness/probe_input_*, probe_sim_cast_buffer.ts (new)`

**Done when:**

- probe_sim_cast_buffer: a key pressed 150 ms before a dash ends fires within 2 ticks of the dash end; expires at 0.4 s; move/stop/CC/death clear it; determinism digests equal.
- Live probe: in quickIndicator mode the cast is sent on the release frame; settings migration maps quickCast=true to quick on every slot.
- Range ring radius = stats.range + body radius; programs unchanged.
- Soak seeds 1-40: no bot gate worse than the W1-A result.
- Opus input-feel verifier: score >= 7.5.

### W2-E: HUD and UX polish at 1366x768 and 1080p

**Goal:** Nothing on the HUD clips, overlaps or hides at 1366x768 and 1080p, and the bars say what they mean.

**Models:** implementer Sonnet 5.5, verifier Opus 5.5. Specified CSS and layout fixes plus screenshots suit sonnet; the readability verdict at two viewports is an adversarial UX judgement for opus.

**Work:**

- CUX-4: death recap capped to the viewport, scrolls, never covers the dial bar; outside-viewport check added to the DOM scan.
- CUX-7: resource bar 11-12 px with cur / max; CUX-12: rank pips 7x3 px with a keyline.
- CUX-8: damage numbers off nameplates and HP bars (offset, alternate sides, merge 120 ms, cap 4 per target).
- CUX-13: one-time name prompt after first-run calibration and a 'You' chip; CUX-14: 1366 truncation fixes (hour board, draft helper, postgame enemy table, shop names); CUX-15: ping wheel contrast and labels.
- VFX-O11: low-HP state on enemy bars (pulse below 25 %).
- AUD-O11: Effects slider copy no longer promises footsteps.

**Files this lane owns:** `src/ui/hud/** (dialbar, world, panels, top, side, minimap)`; `src/ui/styles/hud.css`; `src/ui/screens/{postgame,draft,profile}.tsx`; `src/render/overlay/bars.ts`; `content/strings.en.json (shared-file protocol)`; `_harness/ux DOM scan`

**Done when:**

- ux DOM scan at 1366x768 and 1920x1080: 0 outside-viewport plates, 0 truncation findings for the listed strings, recap fully visible in first and settled frames.
- hud_fight re-shoots: 0 damage numbers drawn over an HP bar at full alpha; <= 4 numbers per target.
- copy_lint passes; 0 console errors; frame_layout F.res fits.
- Opus UX verifier: score >= 7.5 for the HUD lens.

## Wave 3

### W3-A: Bot macro and balance: defend, peel, Longshade, pings, win-rate bands

**Goal:** Bots defend their base and peel for allies (owner ask), the epic objective is contested, every fighter sits inside the win-rate band in every mode.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Team macro and tiered combat micro under perception limits are hard AI engineering; telling pilot error from kit strength is balance judgement.

**Work:**

- GPO-4 (owner ask): defence weighted by enemies sieging, nearest two healthy seats respond, intrusions always answered; promote _tmp_diag_ai.ts to a probe.
- GPO-5: protect intent and a behind posture; CUX-10: bots act on pings (assist, retreat, objective, push, missing) and acknowledge.
- GPO-3: Longshade calls from 16:00, contested defence, bonus scaled by standing defender Needles.
- GPO-2 / GPO-8 / GPO-9: BRIDGE added to the ruling 22 gate; pilot fixes first (Nurrow sleep a backliner, Marund dome divers, Burdam Grudge before ult), then small weights and kit numbers; FRAY ulkro / nurrow weights.
- GPO-17 duo XP; GPO-18 anti-heal classifier; GPO-10 BRIDGE deficit bounty and Returning state.
- CUX-9: authored per-fighter builds (UI-only data) and next-item quick-buy.

**Files this lane owns:** `src/sim/bots/**`; `src/sim/economy.ts`; `content/modes.json`; `content/items.json`; `content/fighters/*.json (kit numbers and build blocks)`; `src/ui/hud/shop.tsx`; `_harness/probe_sim_bot_soak.ts, probe_sim_bot_macro.ts (new)`

**Done when:**

- Macro probe (veteran RIFT, 8+ games): undefended siege time with defenders alive <= 20 %, unanswered base intrusions 0, isolated deaths <= 30 %, no-response peel <= 15 %, behind deaths <= 1.5x even.
- Longshade taken in >= 60 % of games reaching 20:00; first taker wins <= 80 %.
- Win rate: every fighter's 95 % interval inside 40-60 on RIFT and BRIDGE over 400 decided games each (point estimates 45-55 targeted); FRAY placement all 16 within 3.5-7.5 on two fresh seed bases.
- Shaftlight level at 15:00 >= solo median - 1.5; anti-heal owners <= 35 % on RIFT with G7 green; BRIDGE leader-at-5 wins <= 65 %, deaths within 75 s of respawn <= 25 %.
- A Retreat ping pulls nearby bot allies back within 3 s (probe).
- Pace held: first structure 9-12 min, p90 <= 32 min, >= 6 takedowns by 10:00, ruling 21 tail bar; probe_sim_rekey passes; 0 bot faults over the full soak.
- Opus verifier on soak tables and 3 watched matches: score >= 7.5.

### W3-B: Fighter animation: CC body states, attack line of action, walk blend, value ladder

**Goal:** Every CC reads on the body, swings read at 28 m, slowed fighters walk, and bodies have internal value structure.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Animation craft and per-fighter value design are art direction; the CC-kind view field crosses the sim / presentation boundary.

**Work:**

- FU-7: dominant CC kind exposed in the view (presentation only) and generic airborne, sleep, fear and taunt clips on VALE_BIPED_1.
- FU-8: clip_probe line-of-action metrics and re-keys of the worst 30 % per fighter, ults first, impact kept at 40 %.
- FU-9: walk clip phase-synced with run, blended under 0.65 runRef; lean and stride over 1.3 runRef.
- FU-12: 4-5 zones per fighter with >= 15 L* between adjacent large zones; FU-13: Wicks a step down in value and chroma vs fighters.

**Files this lane owns:** `art/blender/common/anim.py`; `art/blender/fighters/*.py (clips and zones)`; `art/out/fighters/**`; `art/blender/units/wick*`; `src/render/actors.ts, stride.ts, turn.ts`; `src/contracts/sim.ts (view ccKind field only)`; `art/blender/fighters/zone_grades.json`

**Done when:**

- clip_probe: counter-twist >= 20 deg, melee tip arc >= 1.2 m, 2-3 frame impact hold, impact at 40 % on re-keyed clips.
- Each CC kind plays its own clip in a capture strip; stunned remains the fallback; determinism digests unchanged.
- Foot slide on walk within the stride.ts bar; every GLB within budget (Burdam <= 1172 KiB); triangle peak <= 470k.
- units_gate passes; Wick vs fighter value/chroma contrast gate passes.
- Opus verifier at the game camera: animation lens >= 7.5.

### W3-C: Onboarding: guided first match, event hints, postgame coaching, match log

**Goal:** A new player is taught the core loop by doing it, gets hints when they matter, and can read their own match.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Teaching order and an event-gated script are design judgement across practice mode, HUD and profile (merges GPO-1 and CUX-5).

**Work:**

- GPO-1 + CUX-5 (merged): tutorial queue on practice with 3 chapters gated on sim events; first 3 matches default to novice co-op; tutorialsSeen read and written; 3-line how-to-play per fighter.
- Event-driven hints replace the 7 timed captions (shop when canShop and gold covers a starter, skill point after 5 s, recall when far from base with 1,200 Gleam, first death -> recap); hint.attack split.
- GPO-20: 'Your hour' postgame card against role benchmarks in content/client.json.
- GPO-21: local match-log export on the player's click only (no network).

**Files this lane owns:** `src/sim/practice*.ts (tutorial setup only)`; `src/session/** (queues routing, profile migration)`; `content/queues.json, content/client.json`; `src/ui/hud/index.tsx (hints)`; `src/ui/screens/{home,postgame}.tsx`; `content/strings.en.json (shared-file protocol)`

**Done when:**

- Scripted e2e completes all 3 chapters through sim events; skip works; tutorialsSeen persists across reload.
- No hint shows in pregame; each event hint fires once on its trigger in a probe run.
- Old profiles migrate (probe with 3 saved schemas); export writes valid JSON only on click; no network request added.
- copy_lint passes; opus onboarding verifier walks a cold first run: score >= 7.5.

### W3-D: Audio feel: own vs foe bells, auto-hit crack, punchy kit hits, UI feedback, music rest

**Goal:** Hits land with contact, the bell tells you which side scored, the UI confirms refused casts and ult-ready, and the score breathes.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Re-voicing under tight identity-distance constraints, a non-verbal own/foe bell language and adaptive-score composition are sound-design work.

**Work:**

- AUD-O4: own/foe variants for first blood, multikills and shutdown; shutdown line only when bounty >= 2 x streakStep.
- AUD-O5 + AUD-O10: contact layer on the 6 dull autos (centroid >= 700 Hz, >= 1.5 % above 6 kHz); Kemdo capped at 30 % above 6 kHz.
- AUD-O6: RMS_RISE_MAX_MS 3.0 extended to the 32 shared kit hits; blow-first pass on the six slow cues.
- AUD-O7: Wick hits shelved below fighter autos in the presence band.
- AUD-O8: cast_denied, ult_ready, low_hp UI cues (client state only).
- AUD-O9: music rest windows, per-map endgame layer, second takes of S2/S3 (streamed).
- Final AUD-O13 rerun on a quiet machine.

**Files this lane owns:** `audio/build.py`; `audio/synth/** (kits, ui, music)`; `audio/blow_search.py`; `src/audio/**`; `content/audio.json`

**Done when:**

- build.py --gates PASS including new attack_hit centroid/HF floors and ceilings, rise <= 3.0 ms on 32 kit hits, identity >= 8 dB per own/foe pair and per kit pair.
- probe_audio_announcer: shutdown bells <= enemy shutdown-eligible downs; own/foe variants chosen by killer team.
- Every fighter attack_hit carries >= the 2-6 kHz band energy of any w_* hit as played (probe_audio_kits).
- Practice-run probe: cast_denied, ult_ready and low_hp each fire once on their trigger.
- AUD-O13 runtime set all pass with >= 0.5 LU margin; match memory stays <= 3000 MB; opus listening verifier >= 7.5.

## Wave 4

### W4-A: Vision depth and ambush play

**Goal:** Walls block sight, lamps can be cleared, every role wards, and bots gank from fog and thickets (owner's 'sneak attack' ask).

**Models:** implementer Opus 5.5, verifier Opus 5.5. Deterministic sub-0.5 ms vision occlusion and a new reveal tool change the jungle meta; ambush behaviour must stay fair inside the perception model.

**Work:**

- GPO-6: wall-clipped vision stamps, a VALE reveal tool, role warding.
- GPO-7: ganks routed through fog and thickets by tier.
- GPO-22: Noonward bot tier for ratings 1825+.

**Files this lane owns:** `src/sim/vision.ts`; `src/sim/bots/** (vision and gank logic)`; `content/items.json or spells (reveal tool)`

**Done when:**

- Vision update <= 0.5 ms; determinism digests equal; lamps placed by every role > 0; >= 15 % of veteran jungler engagements open from thicket or fog; Noonward beats veteran >= 65 % over 40 mirrored games; full re-soak with no gate regression; opus verifier >= 7.5.

### W4-B: World look 2: fog presentation, canopies, ground macro, water, dawnglass

**Goal:** The environment reads painted rather than faceted, with a smooth animated fog edge and readable water.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Fog, foliage, ground and water look development are art direction inside tight program budgets; a sonnet sub-batch is not split out because one eye must hold the look.

**Work:**

- GFX-6 smooth fog edge (needs W2-A program headroom).
- GFX-7 painted canopies.
- GFX-8 ground macro variation and decals.
- GFX-9 water fresnel, depth colour, foam.
- GFX-14 dawnglass windows.

**Files this lane owns:** `src/render/{fog,terrain,terrain_glsl,terrain_inlay,structures}.ts`; `art/blender/env/** (canopy builders)`; `content map textures and decals`

**Done when:**

- Programs <= 38 after the lane, tris <= 470k; fog shader edge never leads the sim grid by > 0.5 m; ground 16-64 px variance up with lane p50 held and telegraph ratio >= 3; team read dE >= 20 on dawnglass; opus render verifier >= 7.5.

### W4-C: Platform reach: compressed textures, Safari, real network, low-end CPU

**Goal:** VALE fits 8 GB laptops, runs in Safari, loads fast on real networks and holds on slow CPUs.

**Models:** implementer Opus 5.5, verifier Sonnet 5.5. The KTX2 pipeline and low-end tier budget need quality trade-off judgement (opus); verification is measurement against numeric bars (sonnet).

**Work:**

- TECH-06 KTX2/Basis with WebP fallback.
- TECH-10 Safari e2e and cross-engine determinism digest (Safari automation needs owner consent).
- TECH-11 throttled network cold run and sky.hdr trim.
- TECH-13 4x CPU-throttled Low budget.

**Files this lane owns:** `tools/build_content.ts (texture export)`; `src/render/assets.ts (loader)`; `src/render/quality.ts, calibration.ts`; `_harness/perf_*, e2e Safari cases`

**Done when:**

- RIFT match memory <= 2200 MB High and <= 1600 MB Low; ruling 32 hue checks still pass; Chrome and Safari digests equal at ticks 900/9000/27000; Low at 4x throttle <= 300k tris, <= 250 draws, renderer CPU <= 8 ms; cable cold run home-to-HUD inside the draft prefetch window.

### W4-D: Systems depth: keystones, kit identity, re-keys, facets, mastery

**Goal:** Choices with playstyle weight, kits that do not all slow, a match frame that no longer maps to the gauge, and a reason to play match 50.

**Models:** implementer Opus 5.5, verifier Opus 5.5. New-system and reward design that must stay original (ruling 4) and balanced across 16 kits.

**Work:**

- GPO-12 keystones.
- GPO-13 thinner slows; Lisvel and Ilsheta skill decisions.
- GPO-14 re-key wave cadence, ult ranks, start gold.
- GPO-15 seeded Sunsplinter facet.
- GPO-11 Fighter Hours, weekly tasks, season reward (cosmetic only).

**Files this lane owns:** `content/{boons,fighters,modes,ranks}.json`; `src/sim/economy.ts, boons`; `src/session/** (progression)`; `src/ui/screens/home.tsx, postgame.tsx`

**Done when:**

- probe_sim_rekey covers the match frame and passes; full soak with every wave-3 gate green; cosmetics-no-stats probe passes; old saves migrate; copy_lint; opus verifier >= 7.5.

### W4-E: Ultimate wind-up identity and off-screen threat cue

**Goal:** A player can tell which ultimate is coming from its wind-up, and hears whether an off-screen threat is above or below.

**Models:** implementer Opus 5.5, verifier Opus 5.5. Per-fighter art direction across 16 ultimates and a spatial-audio design choice that must be A/B tested.

**Work:**

- VFX-O5 signature wind-up silhouettes under a smaller shared dial.
- AUD-O12 off-screen treatment for aware-pass threats (A/B before keeping).

**Files this lane owns:** `tools/vfx/** (windup defs)`; `content/vfx.json`; `src/audio/** (aware-pass spatial only)`

**Done when:**

- probe_kit_hue: signature share >= 0.5 of emissive pixels on wind-up frames for all 16; W2-B clutter gate still passes; AUD-O12 kept only if an A/B shows a correct up/down call >= 75 %.

## Gates between waves

- After wave 1 (lead, serialized, quiet machine via --require-quiet): idle real-time match (>= 99 % of wall-seconds at 58+ fps), probe_match_memory (RIFT <= 3000 MB, homes <= 2500), perf_1080 High frame timing 60 fps; npm run check all pass; completeness critic.
- After each wave: perf_1080 multi-mode gate, full probe suite, full soak seeds 1-40, critic; a lane that fails gets a verify-only re-review after its fix round, never a blind resume.

## Shared files

content/strings.en.json and _design/tokens.json are shared: each lane edits only its own key namespace, checks git diff shows only its own hunks, and commits that file immediately; if another lane's hunk is present it waits and retries. Everything else follows the per-lane file ownership; a lane that needs a file it does not own lists the change in its result for the lead.

## Reviewer conflicts and how they were settled

| Conflict | Ruling (industry standard) |
|---|---|
| GFX-1 wants a brighter world, but the r12 B5 value bands pinned it dark. | Shipped stylised MOBAs keep the ground mid-value and make heroes pop through chroma and edge light. W2-A records ruling 40 before it changes anything. |
| GFX-2 and FU-5 both reshape the character light. | They are one item in W2-A, on one A/B with the value re-key. |
| GFX-3, FU-6, VFX-O1, VFX-O2 and VFX-O3 all treat effects over bodies. | W1-D fixes the capture first, and W2-B then makes one character-protection rule with one gate. |
| GFX-4, TECH-05, FU-15, TECH-14 and VFX-O10 all want budget headroom. | W2-A owns programs and LOD, and W2-B owns VFX triangles. Both run on the one perf gate. |
| GPO-1 and CUX-5 propose two tutorials. | One tutorial on the practice sim with event hints (W3-C). |
| GFX-12, TECH-03 and CUX-16 are all idle measurements. | W1-D adds the quiet precheck and the probes, and the lead runs the idle gate once at the close of wave 1. |
| AUD-O1 wants a per-mode trim in modes.json, which the balance lane edits. | The trim goes in content/audio.json instead, so the two lanes never touch the same file. |
| FU-2 was rated as sonnet work. | It is a sensitivity blocker, so it goes to the opus colour lane, and an opus verifier signs off the face. |
| TECH-02 telemetry versus the 'no network before release' rule. | Local export now (W3-C). The network beacon waits for your release go-ahead. |

## Deferred or dropped

- GPO-16 roster to 24: XL, needs program budget after W2-A/W4-B and a roster-freeze ruling; plan the 8 kits in ROSTER.md only after wave 4.
- TECH-02 network crash/perf telemetry: no network until the owner's release go-ahead; the local export (GPO-21) ships in W3-C instead.
- TECH-01 deploy of the CDN header change and any Cloudflare upload: code lands in W1-E, deploy waits for the owner.
- FU-14 silhouette redesign: needs W2-A triangle headroom and a card re-shoot; schedule after W3-B and W2-C close.
- TECH-15 hot-spot file splits: do it in a quiet window after wave 4, one file per commit, never while lanes are live.
- Dropped as done or verified closed: 'heavy wind' (ruling 37, verify_ambience 8.0; only seam minors kept in W1-C), Ardit's lilac crown (verified on two seeds), the PERF-M1 menu leak (-0.8 %).
- Not counted as a blocker until re-proven: GFX-3 / FU-6 'bodies buried' (lead frame likely a harness artifact; W1-D recaptures, W2-B gates it).

## How the lead monitors

- One heavy-slot queue for the whole machine. The lead checks `heavy.py` status and reaps its own orphans after any kill. It never touches your Chrome, ChatGPT, Codex or Simulators.
- Each lane returns data: what changed, the commits, and the gate numbers. Its verifier re-runs the acceptance probes independently. A failure gets a fix round and then a verify-only re-review, never a blind resume.
- After each wave the lead runs the full probe suite, the multi-mode perf gate, the soak and a completeness critic, and only then opens the next wave.
- Rulings are decided by industry standard under your delegation and written to `fixwaves/owner_rulings.md`: ruling 39 for controls, ruling 40 for the value re-key.
- Nothing is deployed. Git only, until you give the release go-ahead.
