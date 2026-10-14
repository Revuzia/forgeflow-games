# VALE — handoff and resume guide (2026-10-13)

Read this first when resuming VALE in any session, whether the cloud container or the owner's PC.
Branch: `claude/youthful-ramanujan-gdud5w`. Spine: `_spec/CONTRACT.md`. Look and feel:
`_design/STYLE_BIBLE.md` (law). World and names: `_design/WORLD.md`. Asset paths and ids:
`_design/VOCAB.md`.

## Where every lane stands

| Lane | State | Proof |
|---|---|---|
| Research | Done: 11 cited notes + protected-names registry (3,590 names) | `_design/research/` |
| Style bible, world, tokens | Done ("The Stopped Dial") | `_design/STYLE_BIBLE.md`, `WORLD.md`, `tokens.json` |
| Content | Done: 16 fighters / 48 skins / 39 items / 8 spells + 9 boons / 24 units / 3 maps / 3 modes / 8 queues / store / client / 1,371 strings; catalog builds clean, assets pending | `node tools/build_content.ts --check --allow-missing-assets` |
| Sim (deterministic, Rift/Bridge/Fray rules, practice) | Done + reviewed | `node _harness/run_probes.ts` |
| Session (queue, ready check, draft/Lot/pick, match host, grants, Glicko-2, store, equip, profile) | Done | `probe_session_*` |
| Bots (utility AI + draft brain) | Built; its own probes and review still to do | `src/sim/bots/`, `probe_session_botslane` |
| Renderer (post stack, sky, fog of war, actors, overlay, menu scene) | Core done; typecheck clean at last full run | `_harness/web/render_bench.html` |
| VFX engine v2 + bespoke effects | Done: v2 runtime (post pass, soft depth), 50 lib_* + bespoke effects for all 16 fighters (~196 defs); passives fire on the sim `proc` event | `node _harness/vfx_gallery.mjs <prefix>` |
| Client UI (15 screens, components) | Done to first pass | `npm run dev` → http://localhost:5190 |
| HUD + input + end-to-end flow | Done: DONE journey passes in real Chrome (RIFT, BRIDGE, FRAY, shop buy + equip) | `node _harness/e2e.mjs all` |
| Audio (numpy synthesis + WebAudio engine) | Runtime done (`src/audio/index.ts`, event roles bound in `audio.events`); cue + music renders in progress (agents) | `audio/build.py` |
| Art pipeline v1 (rig, clips, bake, export, parts library, template) | Done, but the owner rejected the mannequin look | `art/README.md` |
| Art 2.0 characters: SDF-sculpted volumes fitted to the concept sheet, base colour = the concept painting projected occlusion-aware onto the game mesh | Marund DONE as a full fighter, AWAITING OWNER SIGN-OFF (`art/renders/_art2/marund_signoff.jpg`); 15 fighters to go | `python3 art/build.py fighter marund --no-skins` |
| Skies (4) + locked LUT grade | Done | `art/out/maps/*/sky.hdr`, `art/out/grade/` |
| Painted 2D (icons, key art, mode cards, loading, backdrops, terrain textures, concept sheets) | Done: 202 images (Grok in Chrome + xAI API for the last 14) | `tools/imagegen/README.md` |
| Units, structures, monsters, map scenes, menu scene (Blender) | Structures, Wicks, pickups/ward/post, scatter props, 18 landmarks on all 3 maps, menu painted set: done. Monsters (10): in progress | `art/blender/{units,props,maps}/`, `_harness/shot_map.mjs --nofog --at x,y` |
| Design note, names-not-used doc, README, game_meta, thumbnail | Not started | |

Typecheck, content check (`--allow-missing-assets` until the remaining fighters/monsters land) and all 37 probes are green.

## Owner's quality bar (2026-10-13)

The owner compared the current characters, scenery, menus and copy with League of Legends and
found them well short. Goals:

- **3D characters:** Art 2.0 in Blender, no external 3D generators. Hero-quality sculpted forms,
  real cloth folds, and hand-painted baked textures.
- **Spell VFX:** quality on par with top shipped lane-brawlers, but 100% original in look.
- **Menus:** painted art, motion, and rich copy.
- **Scenery:** painted terrain, landmarks and lighting.

Originality rules still hold: nothing copied from any game.

## Resume order (each step leaves the tree typechecking and probes green)
1. Fix the paused typecheck errors, then finish the HUD, input and end-to-end flow. Done means
   Play → queue → draft → match → postgame → shop → equip works in the browser for RIFT, BRIDGE
   and FRAY.
2. Finish the VFX engine and gallery, then rewrite the `lib_*` presets. After that, write bespoke
   VFX for every ability: 16 fighters × 5.
3. Prove Art 2.0 on Marund and get the owner to sign off on the side-by-side comparison. Then roll
   it out to the 15 remaining fighters and 45 skins.
4. Run the image pack (`tools/imagegen/README.md`) and wire the icons, key art and terrain
   textures in.
5. Build units, structures, monsters and the 3 map scenes plus the menu scene with Art 2.0 methods
   and the painted textures.
6. Audio: render every cue and music bed, then build the runtime engine.
7. Copy pass: ability tooltips with keyword and scaling highlighting, lore, home and store copy.
8. Write the design note, the names-not-used doc, README, game_meta.json and the thumbnail.
   Then run the full end-to-end play-through and review, and push.

## Art 2.0 method (proved on Marund, 2026-10-14)
1. Concept sheet (front + back, painted) -> projection plates: `python3 art/tools/concept_plates.py <id>
   --height <m> [--erase-saturated-above <m>]` (repo venv: numpy, Pillow, scipy). Writes
   `art/.cache/concept/<id>_{front,back}.png` + `_plates.json`. Erase details the model builds as
   geometry (Marund's painted gem rings -> real windows).
2. Fit the forms on a 10 cm grid over the concept and write `art/blender/fighters/<id>.py`: numpy SDF
   parts (`common/hifi/sdf.py`), one Part per binding, a rig fitted to the anatomy, `PROJECTION = {...}`.
   Check the fit with the silhouette overlay (see `art/blender/proto/marund_v2.py`, the proof script).
3. Near-flat tops that the game camera sees (a cap crown) get a top plate (`proto/marund_cap_top.py`).
4. `python3 art/build.py fighter <id> --no-skins --clip-sheet` with PATH incl. /opt/homebrew/bin and
   CHROME=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome. Gates: three load test OK,
   <= 1.2 MB, accent 2-6 %, facing +Z. Copy `art/out/fighters/<id>/art.json` into the content `art`.
5. Skins: palette swaps cannot repaint a painting; each skin needs its own painted concept (Grok/xAI)
   and the same projection. Splashes: the pipeline's splash works but its backdrop is procedural;
   composite over the painted backdrops (`art/out/backdrops/`) instead.

## Session log: owner's Mac, 2026-10-14
- Later on 10-14: bespoke VFX for all 16 fighters committed; passives show via a presentation-only sim
  `proc` event (CONTRACT §5.1). Landmarks: `art/blender/maps/landmarks.py` (18 GLBs) placed by the renderer
  from `map.art.terrain.landmarks[].model` on the ground there (cliff tops, the rim), scatter kept out of
  their footprint, a landmark covering a whole wall polygon replaces its block; numerals laid back 52 deg to
  read from the camera. Fallen Shaft water and the Standing Shadow pit re-surfaced. Audio cue ids moved out
  of `src/` into `audio.events` (probe_content_ids was failing). 14 more painted icons via xAI (Ervet's hilt
  form, monster abilities). Tooltip keywords highlighted. Monsters: an agent is building the four quadruped
  camps (`art/blender/units/creatures.py`, progress in `art/renders/units/_creatures_progress.md`).
- Step 4 engine: the v2 VFX runtime (src/render/vfx/system.ts) replaces v1; VFX draw in a post pass after AO
  (soft depth, bloom, grade); the content build validates the v2 vocabulary (CONTRACT §9.5); authoring kit
  tools/vfx/ (vfxkit.py, lib_defs.py = the 50 lib_*, bespoke/<fighter>.py, build_vfx.py → content/vfx.json);
  gallery: node _harness/vfx_gallery.mjs [prefix] (contact sheets at the real camera).
- Step 5 so far: painted terrain textures + vertex-painted scatter props (art/blender/props/scatter.py), the
  five structures (art/blender/units/structures.py), the four Wicks on the fighter pipeline
  (art/blender/units/wicks.py, spec.KIND), the menu's painted set (client.menuScene.backdrop) with a live 3D
  showcase on a plinth. Still to do: monsters (10), pickups/ward/sparring post, map landmarks (Glass Belfry,
  Lamp Dome, numerals, noon stone, fallen drum), the Blender menu scene.
- Step 6 runtime: src/audio/index.ts (WebAudio engine; silent until cues render). Still to do: the 94 cue
  recipes + 6 beds (audio/cuelib.py, bedlib.py exist; no cue is defined yet) and an audio build → audio/out.
- Step 1 DONE: the HUD stylesheet leaked into the menus (`.shop`/`.score`/`.hrow`/`.stile` clashed with
  the Shop and post-game screens) -> HUD classes renamed; full e2e PASS (rift/bridge/fray/store);
  menus get an ink scrim over the live scene.
- Art 2.0 proved on Marund end to end (sculpt, projection paint, rig, 15 clips, GLB 1.16 MB, in game).
- Next: owner sign-off on Marund -> roll out to the other 15 fighters (+ skin concepts), then VFX
  (step 4), map scenes + menu scene (step 5: the placeholder low-poly scenery is now the weakest read).

### Art 2.0 rollout prep (10-14, waiting on the owner's sign-off)
- Skins: `pipeline.build` re-colours the projected painting per part (skin role / base role per channel,
  `project.recolour`); skin-only extras paint flat via `spec.SKIN_FLAT`. Proven on Marund's two skins
  (`art/renders/_art2/marund_skins.jpg`). Copy each fighter's skin palettes from `_design/fighters/<id>.md` §9.
- Concept plates exist for all 16 (`art/.cache/concept/`, not committed; rerun `concept_plates.py <id> --height
  <content art.height>`). Fix before projecting: pale background kept between the legs (Ardit, Dunsom, Lisvel,
  Tunlan, Sukri) and pale cloth cut as background (Ilsheta's and Sukri's hoods/backs): tune per fighter
  (threshold / erode / erase options) and check `<id>_mask.png`.
- Build env: `export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH` first, or the GLB is not
  optimised (over budget), renders are not denoised and the three.js QA is skipped.

## Session log: owner's Mac, 2026-10-13 (paused by the owner mid-run)
Done and pushed:
- Toolchain on the Mac (Homebrew, Node 22, Python, ffmpeg, gh, Blender 5.2.2); Cycles on Metal
  (`scene.cycles_device`, `VALE_CYCLES_DEVICE=CPU` forces CPU).
- Match HUD assembled (`src/ui/hud/index.tsx`, `shop.tsx`, `world.tsx`, `styles/hud.css`); input in
  the capture phase; end-banner hold + match-end sting; base shop radius 9 m.
- HUD art kit 1: `art/blender/ui/hud_kit.py` (Dial Bar, minimap frames, sky strip, 9-slice plate →
  `src/ui/art/hud/*.webp`, positions → `src/ui/hud/frame_layout.ts`) and painted minimaps
  `art/blender/ui/minimap_paint.py` → `art/out/maps/<id>/minimap.png`.
- Dev autopilot (`?dev=1&autopilot=1|match&speed=16&autoflow=1`) and `_harness/e2e.mjs` +
  `_harness/pw.mjs` (playwright-core driving the installed Chrome, GPU). RIFT journey passes through
  post-game; the shop step fails because post-game has no nav (go Home first, then Shop).
- Image pack: 39/39 item icons generated in Grok Imagine (Chrome) and wired; visual prompts for the
  16 concepts, 39 items, 80 abilities, 22 setup/team-buff icons (`tools/imagegen/*_subjects.json`,
  `build_*_prompts.py`). Ability icons: 1/80 (ardit_turned_blades) in `tools/imagegen/raw/`.

Resume:
1. Grok in Chrome: the owner's weekly SuperGrok limit was at ~68% (resets Oct 15, 2:01 PM). Owner's
   rule: generate in Grok until 90%, then do the rest with the xAI API (`run_xai.py`, needs
   `XAI_API_KEY` set by the owner). Grok loop: `queue.py next --kind icon`, Quality 2.0, ×4, 1:1,
   pick by eye (no gems, gold, runes, modern looks), download as `~/Downloads/vale_<id>.jpg`,
   `queue.py ingest <id> <file>`, then `post.py --apply-refs` and a content build.
2. Then finish step 1: e2e shop/equip step, BRIDGE and FRAY journeys, draft pick by click.

## Running it
```
cd games/vale && npm install
node tools/build_content.ts --allow-missing-assets   # content build → dist-catalog/
npm run dev                                           # client at http://localhost:5190 (?dev=1 for debug)
node _harness/run_probes.ts                           # all probes
python3 art/build.py <target>                         # Blender builds; auto-detects /Applications/Blender.app (or set $BLENDER)
```

## Environment notes
- **Cloud container:** 4 CPUs, no GPU. Cycles runs on CPU only and there is no EEVEE.
  Screenshots use headless Chromium with SwiftShader (slow, around 12 fps; perf numbers there
  are not representative). xAI is blocked unless the owner allows `api.x.ai` and adds
  `XAI_API_KEY`.
- **Owner's Mac:** a real GPU (Cycles on Metal and EEVEE, true WebGL 1080p60 checks), and Blender
  (install it if missing; `art/build.py` auto-detects `/Applications/Blender.app`). Chrome has the
  Claude extension, and the owner is signed in to Grok Imagine for 2D images
  (`tools/imagegen/README.md`).
- **Usage:** session limits have interrupted agent work several times. Keep agents small and
  resume-aware, and checkpoint-commit often.
