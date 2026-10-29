export const meta = {
  name: 'vale-closing-wave',
  description: 'One VALE closing fix wave (after the closing parity review): budgeted work packages in order on the wave\'s own files, adversarial verify against its done-criteria (incl. per-fighter re-scores), targeted refix rounds',
  phases: [
    { title: 'Fix', detail: 'one engineer per work package, in order (blockers first); commits only the wave\'s own files' },
    { title: 'Verify', detail: 'adversarial verifier re-measures every done-criterion and finding' },
    { title: 'Refix', detail: 'targeted fix of failed blocker/major items (rebuild-budgeted), then verify-only re-check' },
  ],
}

const REPO = '/Users/sitskovich/Developer/forgeflow-games/games/vale'
const BR = 'claude/youthful-ramanujan-gdud5w'
const ENV = 'export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH; export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 --python <script>'
const ROSTER = 'ardit burdam dunsom ervet hesmi ilsheta kemdo lisvel marund nurrow odrum rishal sukri tunlan ulkro vashil'

const SHARED_OWN = {
  CW5: 'art/blender/common/** is yours (except facechip.py); lane CW6 may add to it only additively. Land the card pipeline (package 1) early: CW6 renders its cards with it.',
  CW6: 'art/blender/common/** belongs to lane CW5 (except facechip.py, which is yours): only additive, backward-compatible changes there (new functions/params with old defaults kept). Render cards with CW5\'s card pipeline once it has landed (git log art/blender/portraits.py).',
}
const CARD_BRIEF = 'CARDS (the roster-wide card finding): every skin gets its own splash and portrait staging (own pose or clip frame, yaw, key light and rim, focal light where the brief names one), rendered denoised with no visible grain (figure high-pass <= 2x the plate\'s), subject highlights reaching luma >= 230, the face lit, framing kept to the loading-card crop (16:9 1600x900, figure mass at 0.66-0.76 of the width, head ~0.10, feet ~0.95). You may finish a staged render with a paint-over through tools/imagegen/run_xai.py (it reads the key itself) ONLY if it keeps the model\'s design exactly (no new features, same face, same accents, same skin palette) and you look at every result for sensitivity yourself; otherwise ship the clean staged render. Re-render IN PLACE (same paths).'

const WAVES = {
  CW1: { base: 'CW1', name: 'Engine: kit hue, skin effects, performance, camera & input feel',
    owns: ['src/render/** (except src/render/menu.ts and src/render/terrain*.ts)', 'src/contracts/catalog.ts', 'content/vfx.json', 'content/skins/*.json', 'tools/build_content.ts', 'tools/vfx/**', 'package.json', 'vite.config.ts', '_harness/{probe_kit_hue,probe_combat_polish,perf_1080,overlay_regress,vfx_gallery}.mjs', '_harness/web/render_bench.ts', 'new _harness probes for your items (e.g. probe_bar_clearance.mjs, probe_camera.mjs, probe_input_latency.mjs)'],
    packages: [
      { key: 'hue-skinfx', items: ['combat:C1', 'skins:SKIN-FX', 'critic:combat-16'], brief: 'combat:C1 and the done-criteria for kit hue: probe_kit_hue --slots gates a1/a2/a3/ult of ALL 16 fighters (64/64 slots, signature share >= 0.5, team light <= 0.35 of the add). skins:SKIN-FX: a skin\'s effect tint reaches its fighter\'s own kit effects (Hesmi/Sukri Shadeprint violet, Kemdo Long Evening, every deluxe skin with an effect promise in content/skins) while team rings stay team. critic:combat-16 (closing/critic.json): the closing live kit captures covered only 8 fighters: run the same kit capture and probe_combat_polish ult,hold for all 16 (teleFirst, antic, flashMax, liftMax, distortFrames, core multiple for 64/64 casts) and fix what fails.' },
      { key: 'perf', items: ['perf:PERF-C1', 'perf:PERF-C2', 'critic:b4-realtime'], brief: 'PERF-C1: dynamic resolution must see GPU-bound frames on Chrome/Metal (perf_1080 gains a GPU-bound step: the scale leaves 1.0 within 10 s and fps recovers), Ultra 1080p 60 fps on this Mac. PERF-C2: a RIFT-BRIDGE-FRAY-RIFT session returns to <= 2.5 GB renderer+GPU at Home (KTX2/compressed or released textures, freed skeleton DataTextures, disposed maps; audio memory is CW2\'s). Match-peak programs: 0 programs first seen after loading over 3 seeds with rotated seats. critic:b4-realtime: add the real-time match-density step (perf_1080 --prod --no-build --match-only --match-scale 1, load < 3, >= 99 % of wall-seconds at 58+ fps and no second under 45), profile the worst seconds and fix hitches.' },
      { key: 'camera-input', items: ['critic:camera', 'critic:input-feel', 'combat:bar-clearance'], brief: 'critic:camera (closing/critic.json): measure and gate the camera: per-fighter on-screen height at 28.5 m / 1080p for all 16 bases and skins (gate 105-130 px), edge-pan speed, lock / free toggle, re-centre, follow smoothing, re-centre on respawn (probe_camera_edge.ts plus a new real-client probe); fix what is off (src/render/camera.ts). critic:input-feel: a real-client harness sends 50 CDP orders (move, attack, attack-move, move during a wind-up) and logs by rAF the frame the marker draws and the frame the fighter moves or animates: p50/p95 ms; foot slip per fighter run cycle and turn rate. Fix render-side causes (marker latency, locomotion blending, turn smoothing); sim-side causes (turn rate, order latency in src/sim) go as handoffs to CW3s. combat:bar-clearance: the done-criterion\'s bar-clearance probe over 8 facings (Kemdo lens, Dunsom lantern, Hesmi rack, Vashil ring, Tunlan brim half-covered by their own bar in <= 10 % of frames).' },
      { key: 'polish', items: ['CW1 polish (closing_parity_open.json polish with wave CW1)'], brief: 'Every polish item whose wave is CW1, then re-run the CW1 no-regression set (perf_1080 GATE PASS High+Low, overlay_regress High+Low, value_probe B5, typecheck, strict content:check).' },
    ] },
  CW2: { base: 'CW2', name: 'Audio: ultimates and objectives by ear, runtime truth',
    owns: ['src/audio/**', 'audio/**', 'content/audio.json', 'content/units.json', 'src/boot/main.ts', '_harness/probe_audio_*.mjs', '_harness/audio_probe.mjs', 'new _harness audio probes'],
    packages: [
      { key: 'ults-objectives', items: ['audio:AUD-C1', 'audio:AUD-C3', 'audio:decoded-memory'], brief: 'AUD-C1: every kitted fighter\'s ultimate and kit area/zone effects sound like that fighter (the as-heard gate in audio/build.py: 0 library cues on a kitted fighter\'s cast/area/hit chain; first-300 ms median pair distance >= 15 dB, 0 of 66 ult pairs inside the identity threshold, closing_audio_verify_tool_ultid.py). AUD-C3: Longshade and Sunsplinter get their own attack, ability, roar and death cues, at or above fighter level, sharing nothing with Wicks/camps/fighters. Decoded audio at Home after RIFT/BRIDGE/FRAY <= 150 MB, previous bed freed on change.' },
      { key: 'runtime-polish', items: ['critic:audio-runtime', 'CW2 polish (closing_parity_open.json polish with wave CW2)'], brief: 'critic:audio-runtime (closing/critic.json): verify the runtime claims in a real Chrome capture on the fake output device (the closing_audio_tool_open.mjs method, because pw.mjs probes meter silence on this Mac): inject 50 timed hits and cross-correlate the impact frame (rAF) with the captured audio: p50/p95 offset incl. AudioContext.outputLatency (target p95 <= 1 frame + output latency); re-run the RIFT loudness capture once (master about -19 LUFS, ambience about -28). Then every CW2 polish item (heal chime rate, enemyDown, announcer over sfx p99, ...).' },
    ] },
  CW3s: { base: 'CW3', name: 'Sim, bots & rules (the sim half of CW3)',
    owns: ['src/sim/**', 'src/contracts/** (except src/contracts/catalog.ts)', 'src/session/** (except settings.ts, grants.ts, online_link.ts)', 'server/**', 'content/{queues,team_buffs,items,setup,modes}.json', 'content/fighters/*.json', 'tools/names_check.ts', '_design/research/protected_names.json', '_design/{DESIGN_NOTE.md,ROSTER.md,sections/modes_economy.md,sections/items_setup.md}', '_design/reviews/fixwaves/W4_systems_rekey.md', '_harness/{probe_sim_*.ts,probe_sim_bot_soak.ts,pacing.ts,probe_items.ts}'],
    packages: [
      { key: 'bots-laning', items: ['gameplay:CL-1', 'critic:bot-micro', 'critic:gauge-source'], brief: 'gameplay:CL-1: RIFT bots fight in the laning phase (trades from level 2-3, all-ins on a kill window, ganks, early skirmishes) to the CW3 done-criteria (bot soak on independent seeded per-role lineups, 20 untuned seeds at adept and veteran: credited takedowns by 10:00 at the gauge; G1 gates still pass; no core before 16:00; veteran beats novice >= 85 % on a fresh window of >= 40; duo road level 6 by 8:00). critic:gauge-source: source LoL\'s kills-at-10:00 and first-blood time from published pages you READ (no file downloads of any kind) and state the gauge with its source in modes_economy.md. critic:bot-micro: instrument the soak per tier (skillshot hit rate, dodge rate vs telegraphed areas, deaths below the retreat threshold, focus share on the lowest-EHP target, HP at recall, aggression toward a passive human seat at 3-8 min) and improve the weakest. Re-run pacing and soak once on BRIDGE and FRAY. Take any sim-side input-feel handoff from CW1 (turn rate, order latency).' },
      { key: 'quick-rekey-polish', items: ['originality:C1', 'CW3 polish items in your files'], brief: 'originality:C1: the Quick RIFT queue\'s start (level 3, near-equal gold, pre-pick) maps onto LoL\'s Swiftplay: re-key it to a VALE rule of its own, add rift_quick startLevel/startGold rows to probe_sim_rekey (neither within 10 % of 3 / 1400, no level-3 start), update the queue description and docs. Then every CW3 polish item in your files.' },
    ] },
  CW3c: { base: 'CW3', name: 'Client & HUD (the UI half of CW3)',
    owns: ['src/ui/** (incl. src/ui/hud/**)', 'src/render/menu.ts', 'src/session/{settings,grants,online_link}.ts', 'content/{store,strings.en,client}.json', 'content/ui/**', 'public/**', 'tools/gen_store.ts', 'tools/imagegen/**', 'tools/ui_icons.py', '_design/sections/client_hud.md', '_harness/{e2e,hud_renders,icon_probe,sweep_720}.mjs'],
    packages: [
      { key: 'hud-unmeasured', items: ['critic:hud-states', 'critic:done-unverified', 'critic:ui-layout-originality'], brief: 'critic:hud-states (closing/critic.json): measure live the HUD states the HUD verdict rests on: the "Not enough {resource}" refusal caption with a mana fighter, the 250 ms ready wash and active border, multikill/shutdown/streak banner order and latency (a 5-kill headline must pre-empt the queue), deutan/protan/tritan HUD and minimap shots with relationship-colour dE, BRIDGE and FRAY minimaps; fix what fails. critic:done-unverified: give each of HUD-5, HUD-7, HUD-9, HUD-11, F10, F13, F14, F16, F17 a verdict against its own done-bar in final_parity_open.json and fix the open ones. critic:ui-layout-originality: audit the HUD/menu layout against r04 §2\'s notes on LoL\'s layout (slot order, relative positions, grid shape, minimap corner, scoreboard columns, shop tree): classify each as a genre convention shared with Dota 2 / SMITE / HotS or a one-to-one mapping, and re-key any one-to-one detail to a VALE layout; record the audit in client_hud.md.' },
      { key: 'skins-client', items: ['client:CL-1'], brief: 'client:CL-1: paid skins read as different in every client view: finalize shows a large showcase of the hovered or selected skin; the Shop/Collection caption no longer covers the model; Collection tiles crop each skin so its difference shows; Featured offers show what you buy. Measure with the CW3 done-criteria (incl. Ilsheta First Bell portrait dE >= 18 where it applies).' },
    ] },
  CW4: { base: 'CW4', name: 'World art: Wick sensitivity, landmarks, neutral monsters',
    owns: ['art/blender/maps/**', 'art/blender/props/**', 'art/blender/units/**', 'art/out/maps/**', 'art/out/units/**', 'art/out/props/**', 'art/renders/units/**', 'art/renders/maps/**', 'art/renders/props/**', 'content/maps/*.json', 'src/render/terrain*.ts', '_design/maps/**', '_design/tools/map_gen.py', '_harness/{value_probe,shot_map,shot_structures,probe_wallmask,probe_camera_edge}.mjs', 'new _harness probes for your items'],
    packages: [
      { key: 'wick-sensitivity', items: ['originality:GW-1', 'critic:sensitivity-sweep', 'M8 Wick hood value'], brief: 'originality:GW-1 (blocker): the Greatwick\'s back lantern must not read as two lit eyes: no pair of equal round lit panes from any heading (both teams, every skin). critic:sensitivity-sweep: a live 8-heading sweep at the 28.5 m camera of all 4 Wick kinds x 2 teams plus the Greatwick and the Hooded Lamp ward, and the ruling-7 crown metric over every Wick and ward GLB; fix anything eye-like or peaked. M8: Wick hood L* <= 65 and below the fighters on RIFT High.' },
      { key: 'landmarks', items: ['env:E1'], brief: 'env:E1: the 4 jungle numerals, the VI slab, the FRAY lampwright cart, stalls and fair stands reach the Art 2.0 structure tier at gameplay zoom (painted atlas, AO, edge ink, per-stone values) with value_probe\'s new landmark face-detail gate (faces reach in-game high-pass near the Art 2.0 structures\'). Keep B5 PASS on all maps and tiers, fog lane/jungle 0.50-0.60, wallmask 0/48 RIFT and 0/24 FRAY.' },
      { key: 'monsters-1', items: ['critic:monsters (sunsplinter, longshade, glasshorn, stray_numeral, stray_tick)'], brief: 'critic:monsters (closing/critic.json): the neutral monsters were never reviewed and are unchanged since Oct 14: Sunsplinter (an epic objective) renders as grey boxes, Glasshorn and Stray Numeral as near-untextured off-white solids. FIRST review each (three_snapshot sheet, shot_map at its camp/pit when up at 28.5 m, face high-pass vs an Art 2.0 structure, L*/chroma separation from the camp floor, silhouette distinct from other camps, a horror/face read). Then bring Sunsplinter, Longshade (check only: ruling 1 already applied), Glasshorn, Stray Numeral and Stray Tick to Art 2.0 finish (painted atlas, AO, edge ink, a clear readable creature silhouette, value separation, idle/attack/death motion that reads), VALE-original (WORLD.md), no horror faces. Write art/renders/units/<id>/_review.json per monster (before/after).' },
      { key: 'monsters-2', items: ['critic:monsters (gloamoth, gloamoth_little, resinback, stilltusk, stilltusk_young)'], brief: 'Same as monsters-1 for Gloamoth, Gloamoth Little, Resinback, Stilltusk and Stilltusk Young.' },
      { key: 'polish', items: ['CW4 polish (closing_parity_open.json polish with wave CW4)'], brief: 'Every CW4 polish item (pit water, shot_structures collapse/ruin, canopy notches...), then the CW4 no-regression set.' },
    ] },
  CW5: { base: 'CW5', name: 'Fighters A: Vashil, Ardit, Burdam, Kemdo, Lisvel, Nurrow, Ulkro, Ervet + the card pipeline',
    owns: ['art/blender/common/** (except facechip.py)', 'art/blender/portraits.py', 'art/blender/fighters/plates.json', 'art/tools/**', 'art/blender/fighters/{vashil,ardit,burdam,kemdo,lisvel,nurrow,ulkro,ervet}.py', 'art/out/fighters/{vashil,ardit,burdam,kemdo,lisvel,nurrow,ulkro,ervet}/**', 'art/renders/fighters/{vashil,ardit,burdam,kemdo,lisvel,nurrow,ulkro,ervet}/**', '_design/fighters/{vashil,ardit,burdam,kemdo,lisvel,nurrow,ulkro,ervet}.md'],
    packages: [
      { key: 'vashil-crown-cards', items: ['fighter:vashil:VAS-B1', 'ruling7:crown-metric', 'cards:pipeline'], brief: 'FIRST fighter:vashil:VAS-B1 (blocker): round Vashil\'s cowl (tip radius >= 0.12 m and >= 0.19 m wide 5 cm under the top, closing_vashil_verify_crown.txt method) with a dark break on the pale back, all skins; check a live rear view at the gameplay camera. ruling7:crown-metric: owner_rulings.md ruling 7 — add the crown metric as a gate script over every fighter GLB (art/tools), so CW5/CW6 can check Kemdo, Ulkro and Odrum. cards:pipeline: build the per-skin card staging into art/blender/portraits.py (+ plates.json): a per-skin pose/clip frame, yaw, key/rim/focal light and a denoised render; document it in the file header for CW6. ' + 'Re-render Vashil\'s cards with it as the first proof. ' },
      { key: 'ardit-burdam', items: ['fighter:ardit:ardit-M1', 'fighter:ardit:ardit-M3', 'fighter:burdam:burdam-M2', 'fighter:burdam:burdam-M3', 'fighter:burdam:burdam-M4', 'fighter:burdam:burdam-M5'], brief: 'Model and motion first (secondary motion as baked chains: Ardit tabard top segment <= 30 deg and >= 2 frames behind the thigh; Burdam coat and cowl swing, no candy-wrap forearms), materials (Burdam strap >= 15 L* under the coat, pauldron recesses 15-20 L* darker, edge chalking), the deluxe Almanac Ledger skin reads different from base at the game camera by at least as much as the standard skin; then the cards with the CW5 pipeline.' },
      { key: 'kemdo-lisvel', items: ['fighter:kemdo:kemdo-M3', 'fighter:kemdo:kemdo-M4', 'fighter:kemdo:kemdo-M5', 'ruling7:kemdo-crown', 'fighter:lisvel:lisvel-M1', 'fighter:lisvel:lisvel-M2', 'fighter:lisvel:lisvel-M3', 'fighter:lisvel:lisvel-M4'], brief: 'Kemdo: round the hood crown to ruling 7 (>= 10 cm at 3 cm), tunic secondary motion, the Long Evening deluxe gets real deluxe changes (and its effect tint with CW1), cards. Lisvel: a head and face with a living cue at chip/portrait/splash size (not a bandaged egg; no horror/blank read), painted materials (grain, folds, soles, glossy dawnglass), secondary motion and a Backstep with a real landing, cards.' },
      { key: 'nurrow-ulkro-ervet', items: ['fighter:nurrow:nurrow-M1', 'fighter:nurrow:nurrow-M2', 'fighter:nurrow:nurrow-M3', 'fighter:ulkro:ULK-M1', 'fighter:ulkro:ULK-M2', 'fighter:ulkro:ULK-M3', 'ruling7:ulkro-crown', 'fighter:ervet:ervet-M1'], brief: 'Nurrow: a recall that performs for the full 7 s (no loop seam), cloak secondary motion, cards. Ulkro: round the hood crown to ruling 7, skirt/hood-tail/sash secondary motion, fix the death hold, form and material finish (sleeves, shin wraps, boots with soles, glossy dart heads, no projected smudges), cards. Ervet: per-skin cards.' },
      { key: 'vashil-rest-minors', items: ['fighter:vashil:VAS-M1', 'fighter:vashil:VAS-M2', 'fighter:vashil:VAS-M3', 'CW5 polish', 'critic:recovered-minors (CW5 fighters)'], brief: 'Vashil: a recall whose three wrist-bell rings move something visible, Peal\'s strike without a one-frame pop, Morning Toll without a dead hold and snap, cards (portrait at the brief\'s 28 deg yaw). Then every CW5 polish item, and the reviewer minors the closing hand-off dropped for CW5 fighters (recover them from _design/reviews/closing/fighters/<f>.json and _harness/_reports/closing_<f>_*; verify each against the current GLB and cards; fix the confirmed ones). three_load_test PASS on every GLB, lineup_qa, facechip gate.' },
    ] },
  CW6: { base: 'CW6', name: 'Fighters B: Dunsom, Hesmi, Ilsheta, Marund, Odrum, Rishal, Sukri, Tunlan',
    owns: ['art/blender/fighters/{dunsom,hesmi,ilsheta,marund,odrum,rishal,sukri,tunlan}.py', 'art/out/fighters/{dunsom,hesmi,ilsheta,marund,odrum,rishal,sukri,tunlan}/**', 'art/renders/fighters/{dunsom,hesmi,ilsheta,marund,odrum,rishal,sukri,tunlan}/**', '_design/fighters/{dunsom,hesmi,ilsheta,marund,odrum,rishal,sukri,tunlan}.md', 'art/blender/fighters/face_chips.json', 'art/blender/common/facechip.py'],
    packages: [
      { key: 'hesmi-sukri', items: ['fighter:hesmi:hesmi-M1', 'fighter:hesmi:hesmi-M2', 'fighter:hesmi:hesmi-M4', 'fighter:sukri:SUK-M2', 'fighter:sukri:SUK-M3', 'fighter:sukri:SUK-M5'], brief: 'Hesmi: an eye-band with no block joint inside the eye span and two cool non-emissive glints, alive at 26-128 px (no clenched-teeth or mummy read); honed stone, linen, ironstone and gauntlets separate as materials; the Shadeprint deluxe\'s violet reaches her shadows (model side; effect tint is CW1). Sukri: materials separate in engine (chroma, a face disc darker than the hood), a glassy dawnglass cup, attacks and Mote Toss with their own body motion and real hands, Wrap Cast visible, recall without staff clipping, Shadeprint\'s violet light in the cup. Cards come in package 4.' },
      { key: 'marund-odrum', items: ['fighter:marund:marund-M1', 'fighter:marund:marund-M2', 'fighter:marund:marund-M3', 'fighter:odrum:odrum-M1', 'fighter:odrum:odrum-M2', 'ruling7:odrum-cap'], brief: 'Marund: at the gameplay camera the maul and the action read past the cap; the ultimate\'s 7 m leap is airborne with the maul overhead and a landing slam; idle, recall and channel perform. Odrum: the yoke reads as the brief\'s horizontal balance-scale (a vertical pole in <= 20 % of lane frames); the felt cap reads as felt (hue 34-37 deg, sat <= 0.20) and its crown passes ruling 7; the jerkin does not read as bare skin.' },
      { key: 'dunsom-ilsheta-rishal-tunlan', items: ['fighter:dunsom:dunsom-hat-flat-plate', 'fighter:dunsom:dunsom-idle-recall-frozen', 'fighter:ilsheta:ilsheta-idle-recall-frozen', 'fighter:ilsheta:ilsheta-skins-indistinct', 'fighter:rishal:rishal-M2', 'fighter:rishal:rishal-M3', 'fighter:tunlan:TUN-C2', 'fighter:tunlan:TUN-c4'], brief: 'Recalls and idles that perform for the full 7 s (Dunsom, Ilsheta, Rishal, Tunlan; idles at least the roster median motion); Dunsom\'s hat with a crown-to-rim value ramp >= 10 L* and a felt cue; Tunlan cast_a1/cast_ult move the hat <= 0.3 m per 60 Hz frame with a >= 4-frame settle; Rishal\'s Lamplit deluxe and Ilsheta\'s First Bell read as deluxe (model side).' },
      { key: 'cards', items: ['fighter:dunsom:dunsom-splash-single-pose', 'fighter:hesmi:hesmi-M3', 'fighter:marund:marund-M4', 'fighter:odrum:odrum-M4', 'fighter:rishal:rishal-M1', 'fighter:sukri:SUK-M4', 'fighter:tunlan:TUN-C3', 'cards:ilsheta'], brief: 'All 8 fighters\' cards with CW5\'s card pipeline (check git log art/blender/portraits.py; if it has not landed, wait for it by finishing package 5 items first): Tunlan with the hound shadow and the lantern as key; Sukri with the offered cup as the focal light; Marund with the cap and windows in the portrait and no mouth artifacts; Rishal with the face lit.' },
      { key: 'polish-minors', items: ['CW6 polish', 'critic:recovered-minors (CW6 fighters)'], brief: 'Every CW6 polish item, and the reviewer minors the closing hand-off dropped for CW6 fighters (recover them from _design/reviews/closing/fighters/<f>.json and _harness/_reports/closing_<f>_*; verify each; fix the confirmed ones). three_load_test PASS on every GLB, lineup_qa, facechip gate.' },
    ] },
}

const PRIOR = {}
const RESUME_NOTE = `\nRESUME: an earlier attempt at THIS package was killed mid-work by a session restart at 17:32 on 2026-10-28. Its partial work is already in the repo, committed by that attempt or by the WIP safety syncs (commits titled "vale wip sync", e.g. a5ee8ff7 at 17:34). Before changing anything, read \`git log --oneline -40\` and \`git show --stat\` of the recent commits touching your wave's files, plus \`git status\` / \`git diff\` for your owned paths, and CONTINUE from that state instead of redoing it. Count the earlier attempt against your budget: assume half of this package's rebuild/sweep budget is already spent.`

const W = WAVES[args.wave]
if (!W) throw new Error('unknown wave ' + args.wave)
const OTHER = Object.keys(WAVES).filter(k => k !== args.wave).map(k => `${k} (${WAVES[k].name})`).join('; ')

const RULES = `PROJECT: VALE, an original 3D lane-brawler (MOBA) in ${REPO}, git branch ${BR}. Three.js WebGL2 client, Preact signals, zod content catalog, deterministic 30 Hz sim. The owner's bar: League-of-Legends-level quality, 100 % original. LoL is ONLY A GAUGE of quality and polish: never copy a LoL champion, ability, item, effect, icon, UI layout, rule, number or name; every fix is VALE's own (_design/STYLE_BIBLE.md, _design/WORLD.md). Never download video files and never save any LoL image into the repo.
SOURCE OF TRUTH for your work: the CLOSING review: _design/reviews/closing_parity_review.md (the plan) and _design/reviews/closing_parity_open.json: your wave is waves[] with id ${W.base} (its goal, files and done-criteria) and its findings ("dim:id"; a fighter finding is "fighter:<id>:<finding id>", dim "fighter:<id>"), plus polish[] items whose wave is ${W.base}; the full evidence is in _design/reviews/closing/<dim>.json and _design/reviews/closing/fighters/<id>.json. Items named "critic:..." come from the completeness critic: _design/reviews/closing/critic.json (gaps[]) — your package brief says which. The PAR BAR (owner, ruling 8) is a verified score >= 7.5 with no blocker open (majors on an item already >= 7.5 are backlog); for fighter waves the verifier re-scores each fighter. Read your items before you start.
YOU ARE IN WAVE ${args.wave}: ${W.name}. YOUR WAVE OWNS ONLY: ${W.owns.join('; ')}. ${SHARED_OWN[args.wave] || ''}
CONCURRENCY: other lanes edit the same working tree at the same time, each owning disjoint files: ${OTHER}. Never edit files outside your list; if a fix needs another lane's file, do not touch it — return it in handoffs (to: lane id, what: the exact change). If typecheck / content:check / probes fail in files you do not own, another lane is mid-edit: do not fix or revert them, re-run later; only your own files must be clean. NEVER run git stash, git checkout -- <path>, git restore, git reset, git clean, or anything that changes files you do not own. Do not stop or restart the dev server on :5190 (start it only if it is down: \`cd ${REPO} && npm run dev -- --port 5190 > /tmp/vale_dev.log 2>&1 &\`); a GUI Blender the owner opened may be running — leave it.
GIT: commit only your own paths: \`git add <your paths> && git commit -m "vale ${args.wave}: <what>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <your paths>\`, then \`git push origin ${BR}\`. If .git/index.lock exists or the push races, retry a few times a few seconds apart (a short loop with sleep 3). Never force-push, amend others' commits, or rewrite history. Commit after each finished item (small commits are good).
CODE RULES: erasable TypeScript only (no enum, namespace, parameter properties, decorators); the sim is deterministic (no Math.random / Date / wall-clock in src/sim — use the sim's RNG); keep sim and presentation separate; no content ids hard-coded in src/ (data-driven from content/); cosmetics never change stats; the zod catalog must validate (\`npm run content:check\`). Scripts: npm run typecheck | content:check | probe | check | build. Node env: \`${ENV}; cd ${REPO}\`. Python venv: ~/Developer/forgeflow-games/.venv/bin/python3. Blender 5.2 headless: \`${BLENDER}\`.
OWNER RULINGS (binding, _design/reviews/fixwaves/owner_rulings.md, rulings 1-8; ruling 8 = par bar 7.5; ruling 7 = the crown rule for soft head coverings: fit radius >= 10 cm at 3 cm under the top plus a rear-view check): the owner delegated these calls and they count as owner sign-off: Longshade sundial plate (tears gone, lamp eyes kept), Odrum Shadeprint warm amber lacquer #B39272 with honey-amber eye inlays, Rishal accent = visor ridge blade + two left-temple fins (rear vanes removed, skins never recolour them), the W4 systems re-key is signed off (the probe_sim_rekey 10 % gate stays), Dunsom's gold beak becomes a short rounded bill, the Hooded Lamp ward's pointed finial becomes a rounded knob. Nothing there is pending owner input.
SENSITIVITY (blocker class anywhere): no tall, pointed or conical hoods; no masks/faces that read as horror, hockey mask or blank mannequin; Wicks have no face (no eye-like light pairs, no mouth).
NO HANGS: never run a command that can block forever (tail -f, watch, a pipe or heredoc waiting on stdin, an interactive prompt, a foreground server). Long runs go in the background with a log and a bounded poll loop. Kill helper processes you started before you finish. Tracked files under _harness/_reports (value_probe.json, perf_1080.json, ambient.json, shot_lane.json): restore them with git checkout -- <file> after a run rewrites them unless they are yours.
NO DOWNLOADS: never download files from the internet (datasets, videos, images, archives); reading web pages is fine.
SECRETS: never print, echo or log any API key or token. The xAI image key is used only through tools/imagegen/run_xai.py, which reads it itself. All 3D models are procedural Blender builds. NO DEPLOY: no Cloudflare, no upload, no publishing of any kind.
MACHINE LIMITS (10-core / 16 GB Mac shared with 5 other agents): Blender, harness Chrome (_harness/pw.mjs) and three_snapshot queue for 3 machine-wide heavy slots ("[heavy] ... waiting" is normal — wait, never kill or bypass the queue; ad-hoc heavy commands go through \`python3 art/blender/common/heavy.py run -- <cmd>\`). Run ONE Blender/harness at a time, long runs with a generous Bash timeout (up to 600000 ms) or in the background with a log you poll. Use the repo harnesses on the real Chrome GPU (never your own swiftshader renderer). perf_1080 gates use --prod (dev mode has a known stale-transform failure). At most 3 parallel node sim processes.
BUDGET (hard; you cannot be messaged later): per package at most 3 full Blender rebuilds of any one model or map, at most 3 full perf_1080 / e2e sweeps, at most 4 full soak runs; batch your edits before re-measuring. Aim to finish a package within about 2 hours. When an item's done-criterion is met, stop polishing it. Guide bands (e.g. lineup_qa value bands) missed by <= 2 L* are minors to report, not reasons to rebuild. If a criterion cannot be met within budget, stop and report it as partly/not_done with the measured numbers — honesty beats a false "done".
EVIDENCE: every status cites a reproducible artifact (shot/report path, command, file:line, measured number). Shots go to _harness/_shots/fw_${args.wave}_*, reports to _harness/_reports/fw_${args.wave}_* (git-ignored).`

const PKG_SCHEMA = { type: 'object', properties: {
  items: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, status: { type: 'string', enum: ['done', 'partly', 'not_done'] }, evidence: { type: 'string' } }, required: ['id', 'status', 'evidence'] } },
  commits: { type: 'array', items: { type: 'string' } },
  handoffs: { type: 'array', items: { type: 'object', properties: { to: { type: 'string' }, what: { type: 'string' } }, required: ['to', 'what'] } },
  notes: { type: 'string' },
}, required: ['items', 'commits', 'handoffs', 'notes'] }

const VERIFY_SCHEMA = { type: 'object', properties: {
  pass: { type: 'boolean', description: 'true only if every blocker and major item and every done-criterion passes' },
  items: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string', description: 'dim:id, or done:<n> for a done-list criterion' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
    status: { type: 'string', enum: ['pass', 'partly', 'fail', 'not_measured'] }, evidence: { type: 'string' }, fixHint: { type: 'string' } },
    required: ['id', 'severity', 'status', 'evidence'] } },
  regressions: { type: 'array', items: { type: 'string' } },
  summary: { type: 'string' },
}, required: ['pass', 'items', 'regressions', 'summary'] }

const brief = (rs) => rs.length ? rs.map(r => `- ${r.key}: ${(r.items || []).map(i => `${i.id}=${i.status}`).join(', ')}${(r.handoffs || []).length ? `; handoffs: ${r.handoffs.map(h => `${h.to}: ${h.what}`).join(' | ')}` : ''}`).join('\n') : '(none yet)'

const pkgPrompt = (p, i, prior) => `${RULES}

You are the wave ${args.wave} engineer for work package ${i + 1}/${W.packages.length} "${p.key}". ITEMS: ${p.items.join(', ')}.
${p.brief}
Earlier packages in this wave (already committed):
${brief(prior)}
${(args.wave === 'CW5' || args.wave === 'CW6') ? CARD_BRIEF + '\n' : ''}Do each item's proposed fix (or a better ORIGINAL one), blockers first, then majors, then minors; meet the item's done-criterion (waves[] id ${W.base} .done in closing_parity_open.json, the item's own fix text, or the critic gap's howToMeasure) and MEASURE it with the named harness. Keep changes focused on your items. Before each commit: \`npm run typecheck\` clean for your files, \`npm run content:check -- --allow-missing-assets\` if you touched content, the relevant probes for what you touched. Return per-item status with measured evidence, commit hashes, handoffs for other lanes, and short notes.${(args.resumed || []).includes(p.key) ? RESUME_NOTE : ''}`

const verifyPrompt = (rs, n) => `${RULES}

You are the ADVERSARIAL VERIFIER for wave ${args.wave} (${W.name}), round ${n}. The engineers claim:
${brief(rs)}
Full claims with evidence: ${JSON.stringify(rs.map(r => ({ key: r.key, items: r.items }))).slice(0, 12000)}
Do NOT trust claims or earlier reports: re-measure yourself. Check (1) every criterion in this wave's done-list (waves[] id ${W.base} .done in _design/reviews/closing_parity_open.json${W.base !== args.wave ? `, only the parts that belong to lane ${args.wave}` : ''}; plus, for the critic items in your packages, the measurement closing/critic.json names; for fighter waves, re-score every fighter of the wave 1-10 against the par bar (>= 7.5, no blocker) as items "par:<fighter>") as items "done:<n>", and (2) every blocker/major item of this wave's packages; spot-check the minor items. Default to fail when uncertain or unmeasured. Look for regressions in this wave's area (typecheck in wave files, probes, e2e for UI, perf_1080 --prod for render, value_probe for maps, the art gates for models). Sensitivity: look at every new image/model render yourself. Your ONLY edit: write your verdict JSON to _design/reviews/fixwaves/${args.wave}_verify${n}.json and commit+push that one file. Do not fix anything. For each failure give a concrete fixHint.`

const refixPrompt = (fails, n, prior) => `${RULES}

You are the wave ${args.wave} engineer for REFIX round ${n}. The adversarial verifier failed these items (fix ONLY these, nothing else):
${JSON.stringify(fails).slice(0, 14000)}
Earlier work in this wave: 
${brief(prior)}
Fix each one (or prove the verifier wrong with a measurement), re-measure with the same harness the verifier used, commit+push. Budget for this round: at most 3 full rebuilds/sweeps in total. Return per-item status with evidence.`

const recheckPrompt = (fails, fx, n) => `${RULES}

You are the ADVERSARIAL VERIFIER for wave ${args.wave}, VERIFY-ONLY round ${n}. Re-check ONLY these previously failed items (plus any regression the refix may have caused and any blocker-class new problem you see): 
${JSON.stringify(fails).slice(0, 12000)}
The refix engineer claims: ${JSON.stringify(fx && fx.items || []).slice(0, 6000)}
Re-measure yourself; default to fail when uncertain. Your ONLY edit: write your verdict JSON to _design/reviews/fixwaves/${args.wave}_verify${n}.json and commit+push that one file.`

phase('Fix')
const results = [...(args.prior || PRIOR[args.wave] || [])]
const DONE_KEYS = new Set([...(args.skip || []), ...results.map(r => r.key)])
for (const [i, p] of W.packages.entries()) {
  if (DONE_KEYS.has(p.key)) continue
  const r = await agent(pkgPrompt(p, i, results), { label: `${args.wave}:${p.key}`, phase: 'Fix', schema: PKG_SCHEMA, agentType: 'general-purpose' })
  results.push({ key: p.key, ...(r || { items: p.items.map(id => ({ id, status: 'not_done', evidence: 'agent returned nothing' })), commits: [], handoffs: [], notes: 'agent died' }) })
  log(`${args.wave}:${p.key} → ${(r && r.items || []).map(x => `${x.id}=${x.status}`).join(', ')}`)
}

phase('Verify')
let v = await agent(verifyPrompt(results, 1), { label: `${args.wave}:verify1`, phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose' })
const failing = (vv) => (vv && vv.items || []).filter(x => x.status !== 'pass' && x.severity !== 'minor')
let n = 1
while (v && failing(v).length && n <= 2) {
  if (n === 2 && !failing(v).some(x => x.severity === 'blocker')) break
  const fails = failing(v)
  phase('Refix')
  const fx = await agent(refixPrompt(fails, n, results), { label: `${args.wave}:refix${n}`, phase: 'Refix', schema: PKG_SCHEMA, agentType: 'general-purpose' })
  results.push({ key: `refix${n}`, ...(fx || { items: [], commits: [], handoffs: [], notes: 'agent died' }) })
  n++
  const rv = await agent(recheckPrompt(fails, fx, n), { label: `${args.wave}:verify${n}`, phase: 'Refix', schema: VERIFY_SCHEMA, agentType: 'general-purpose' })
  if (!rv) break
  const byId = new Map(v.items.map(x => [x.id, x]))
  for (const x of rv.items) byId.set(x.id, x)
  v = { ...rv, items: [...byId.values()], pass: [...byId.values()].every(x => x.status === 'pass' || x.severity === 'minor') }
}

return {
  wave: args.wave,
  pass: !!(v && v.pass),
  open: (v && v.items || []).filter(x => x.status !== 'pass'),
  handoffs: results.flatMap(r => (r.handoffs || []).map(h => ({ from: r.key, ...h }))),
  packages: results.map(r => ({ key: r.key, items: (r.items || []).map(i => `${i.id}=${i.status}`), commits: r.commits, notes: (r.notes || '').slice(0, 600) })),
  regressions: v && v.regressions || [],
  summary: v && v.summary || 'no verdict',
}
