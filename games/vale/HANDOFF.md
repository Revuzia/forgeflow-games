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
| VFX engine "AAA" upgrade | PAUSED mid-way (7 files in `src/render/vfx/`) | resume: same goal, see below |
| Client UI (15 screens, components) | Done to first pass | `npm run dev` → http://localhost:5190 |
| HUD + input + end-to-end flow | PAUSED mid-way (`src/ui/hud/` 9 files, `src/input/` 4) | resume |
| Audio (numpy synthesis + WebAudio engine) | Library only; no rendered files, no runtime | resume |
| Art pipeline v1 (rig, clips, bake, export, parts library, template) | Done, but the owner rejected the mannequin look | `art/README.md` |
| Art 2.0 hi-fi characters (sculpted volumes → voxel remesh → displacement, cloth draped by simulation, high-to-low bakes, painted albedo, painterly splash) | PAUSED mid-way (`art/blender/common/hifi/` 4 files); proving on Marund | resume |
| Skies (4) + locked LUT grade | Done | `art/out/maps/*/sky.hdr`, `art/out/grade/` |
| Painted 2D (icons, key art, mode cards, loading, backdrops, terrain textures, concept sheets) | Pack ready: generate with Grok Imagine in Chrome (`queue.py next/ingest`) | `tools/imagegen/README.md` |
| Units, structures, monsters, map scenes, menu scene (Blender) | Not started (briefs exist) | `_design/maps/*_landmarks.md` |
| Design note, names-not-used doc, README, game_meta, thumbnail | Not started | |

The typecheck has a few errors in the paused HUD and VFX files. Fix those first.

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
