You are the lead developer on VALE, an original 3D lane-brawler (MOBA) for Forgeflow Games, continuing a project that was started in a cloud session. You now run on the owner's Windows PC, which has a real GPU, Blender, the xAI key, and Chrome with the Claude extension. Your job: take VALE to the owner's DONE bar at League-of-Legends-level visual quality, while keeping everything 100% original.

## 1. Set up (do this first, then report what's missing)
- Repo: the `forgeflow-games` folder. Run `git fetch`, then `git checkout claude/youthful-ramanujan-gdud5w`, then `git pull`. Work and push ONLY on this branch. Commit and push often: after every finished step and before any long job.
- `cd games/vale` then `npm install`. Check that Node 22+, Python 3.11+ (`pip install numpy pillow`), ffmpeg on PATH, and Blender 5.1 or 5.2 are present. Set the `BLENDER` env var to blender.exe (e.g. `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`).
- Check that the xAI key exists in `state/.secrets/tokens.json` (key `xai_api_key`), the file `pipeline/generate_cover.py` already reads, or in `$XAI_API_KEY`. Never print or commit it.
- Report the GPU model and anything missing before heavy work.

## 2. Read, in this order
1. `games/vale/_design/BRIEF.md`: the owner's brief, verbatim, plus their later direction. This is the contract.
2. `games/vale/HANDOFF.md`: status of every lane, resume order, and commands.
3. `games/vale/_spec/CONTRACT.md`: the build contract (interfaces, lanes, rules), plus `src/contracts/*.ts`.
4. `games/vale/_design/STYLE_BIBLE.md` (law for every screen and pixel), `WORLD.md` (world, names, glossary), `VOCAB.md` (asset paths, VFX and audio ids), `tokens.json`.
5. As needed: `_design/ROSTER.md`, `_design/fighters/<id>.md` (16 art briefs), `_design/maps/*`, `_design/sections/*`, `_design/research/*` (11 cited research notes plus `protected_names.json`).

## 3. What exists
- **Stack, committed:** a custom TypeScript client on Three.js r186 (WebGL2) + pmndrs postprocessing + N8AO, with Preact UI and Vite 8. Art is authored in Blender and exported as glTF.
- **Content:** the catalog is data. It builds clean, but many art and audio files are still missing:
  - 16 fighters with full kits, 48 skins, 39 items, and the setup layer (8 spells, 9 boons)
  - 24 units, 3 maps (Hourfall, Needlespan, Noonplate)
  - 3 modes (RIFT, BRIDGE, FRAY) and 8 queues
  - store, ranks, client config and 1,371 UI strings
  - Client build and content build are separate. The catalog is versioned and the client boots from a catalog URL.
- **Simulation:** deterministic, with modes as rules layers and a practice tool. The session layer is local with bots (queue, ready check, draft / Lot bench / FFA pick, match host, grants, Glicko-2 ranked, store purchases with ownership records, skin equip, profile), with seams for a server and login. Bots exist; their own probes are still to write. 33 probes pass: `node _harness/run_probes.ts`.
- **Renderer:** the core is done (post stack in the bible's order, sky, fog of war, actors, overlay bars, rings and telegraphs, procedural fallback terrain, menu scene). The client UI has 15 screens.
- **Art pipeline v1:** done (rig `VALE_BIPED_1`, clip library, bakes, export, parts library), but the owner REJECTED the look as mannequins. Skies (4) and the locked LUT grade are done.
- **Paused mid-way:**
  - HUD, input and the end-to-end flow (`src/ui/hud`, `src/input`)
  - AAA VFX engine upgrade (`src/render/vfx`)
  - Audio (`audio/synth` library only)
  - Art 2.0 hi-fi characters (`art/blender/common/hifi`, proving on Marund)
- The typecheck has about 13 errors in the paused files.
- **Image pack:** ready at `tools/imagegen/` (188 images via xAI). See its README.

## 4. What to do, in order (keep typecheck and probes green, commit after each)
1. **Make it playable.** Fix the typecheck errors, then finish the HUD, input and flow. A real player in real Chrome can go home → play → queue RIFT / BRIDGE / FRAY → draft or get assigned → play a full match to a real win → post-game with grants → shop → buy a skin → equip it, and bots fill every seat. Add a dev autopilot with time-scale for fast verification.
2. **Painted 2D via xAI.** Follow `tools/imagegen/README.md`: icons, key art, mode cards, loading screens, backdrops, seamless terrain textures, concept turnarounds. Review every image and regenerate bad ones. Then run `post.py --apply-refs` and wire them in.
3. **Art 2.0 characters in Blender (no external 3D generators).** Prove the method on Marund first:
   - sculpted anatomy from smooth-blended volumes, then voxel remesh and sculpt-style displacement
   - capes and tabards draped with Blender cloth simulation, applied offline
   - hard-surface carving, high-to-low bakes (normal, AO, curvature)
   - a hand-painted albedo
   - illustration-grade splash renders: rendered character over the painted backdrops, then a painterly filter
   - Use the GPU (Cycles GPU and EEVEE) and the concept turnaround as reference.
   - Show the owner a side-by-side with the old look and get sign-off, then roll it out to all 16 fighters and 48 skins. Bible rules hold: masks or visors, no hair cards, no metal/gems/runes/gears, the value gradient, accent ≤ 5%.
4. **VFX at the quality bar of the best shipped lane-brawlers, but original.**
   - Finish the engine: curves, ribbons, a shader-mesh FX material (fresnel, scrolling noise, dissolve), flipbooks, soft particles, distortion, pooled lights, hit-stop and shake.
   - Build the VFX gallery page.
   - Rewrite the `lib_*` presets, then write bespoke VFX for every ability: 16 fighters × 5.
   - Use the bible's Lumen (light) and Shade (ink) families and tier caps. Review frame strips.
5. **Scenery in Blender.** Build the map scenes for Hourfall, Needlespan and Noonplate, plus the menu scene "the Rim at the Split Hour", with landmarks per `_design/maps/*_landmarks.md`, sculpted rocks and trees, the painted textures, and baked lighting/AO. Also the units: Wicks, Needles, Lanterns, Hourbells, monsters, Sunsplinter, Longshade.
6. **Audio.** Original synthesized music beds (menu, draft, three match beds with intense layers), every SFX cue in `content/audio.json`, the WebAudio engine and the event mapping.
7. **Copy.** Ability tooltips with highlighted keywords and scaling, lore, home/store/mode copy, all in WORLD.md tone.
8. **Finish.**
   - The design note: cites the research, names the stack and why, includes the style bible, lists every name deliberately not used.
   - `README`, `public/game_meta.json` + `thumbnail.png`.
   - A 1080p60 check on this GPU with the quality ladder.
   - A full play-through of all three modes, an adversarial review, and push.

## 5. Rules
- **Originality is law.** No names, kits, text, items, map layout, objective names, UI layout, fonts, icons, VFX, music, voice or lore from any game. Check names with `tools/names_check.ts` and `_design/research/protected_names.json`. "Rift" is allowed only as the owner's mode name.
- **Architecture:**
  - The sim never imports render, ui or the DOM.
  - The presentation never imports `src/sim`.
  - Content ids never appear in `src` (`probe_content_ids`).
  - Use erasable-syntax TypeScript with `.ts` imports.
  - The sim is deterministic.
  - Cosmetics never change stats.
  - Content changes go through `content/` and `tools/build_content.ts`.
- **No primitives as shipped art.** Verify at the player's layer: real Chrome, real input, look at the pixels.
- **Commits:** commit and push to `claude/youthful-ramanujan-gdud5w` only, and never deploy without the owner's go-ahead. Deploy tools: `upload_game.py`, `pipeline/deploy_game.py`.
- **Usage limits** have interrupted long agent runs. Keep sub-agents small and resume-aware, at most 2–3 at once, and checkpoint often.
- **Security:** `pipeline/meshy_chars.py` has a Meshy API key hard-coded and committed. Do not use it, and remind the owner to rotate it.

Start with the setup checks in section 1, then give a short status, then begin step 1.
