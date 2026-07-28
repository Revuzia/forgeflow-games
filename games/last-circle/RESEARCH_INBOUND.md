# Inbound research — owner-supplied sources, reviewed 2026-07-27

## 1. Claude-of-Duty (github.com/mshumer/Claude-of-Duty)
Browser FPS, Three.js r180, ~55k LOC, zero art files — everything procedural.
Directly applicable to Last Circle:
- **Shader pre-warming** — they measured 728–1236 ms stalls from lazy shader
  compilation that median-frame stats hid entirely; pre-warming eliminated
  them. ACTION: add a `renderer.compile(scene, camera)` warm pass (plus one
  off-screen draw of particle/decal/tracer materials) at match load. Likely
  explains any first-shot / first-explosion hitch we have. **S effort.**
- **19 procedural surface types, triplanar projection + parallax occlusion** —
  a zero-asset answer to our "structures are boxes with shared canvas
  textures" decisive visuals gap. CSM cascades + GTAO + AgX grading listed too.
- **Methodology data point**: three rounds of six parallel agents scored WORSE
  than sequential single-owner passes per coupled system (4.05 → 5.05/10 vs
  their benchmark). Matches our practice of one-owner iterations with
  adversarial review — keep it.
- Sobriety check: even with all that, independent critics scored it 5.05/10
  vs real COD (blocky characters, procedural textures fail close-up, weak
  indirect light). Procedural-only has a ceiling — our Meshy characters +
  selective texture spend is the right hybrid.

## 2. MengTo / Skills (github.com/MengTo/Skills)
Open-source Claude SKILLS for Three.js game dev (isometric ARPG: camera, VFX,
audio, monster assets, combat) + a free hosted asset catalog
(vesperfall.mengto.chatgpt.site/asset-catalog). ACTION: mine the skills for
reusable patterns for OUR pipeline (VFX + audio skill structure especially);
check the asset catalog's licence before using anything from it.

## 3. img2threejs v1.4 (github.com/img2threejs)
Open-source image→Three.js reconstruction: 2 reference photos + 1 prompt
(~250K tokens) → a detailed PBR weapon model with real internal structures,
measurement-driven proportions. ACTION: candidate for weapon-model upgrades
and hero props WITHOUT Meshy credits — worth one trial run on a rifle before
the next Meshy prop batch.

## 4. operation-ironhold (github.com/StarKnightt/operation-ironhold)
Single 290 KB HTML FPS built with Opus 5 — enemies that flank/take cover/call
out, sniper breath-hold + sway, mantle. ACTION: two features it ships that our
movement scorecard names as gaps: **sniper breath-hold** (hold key while
scoped → sway pause + zoom steady) and **mantle** (the prior delta rated
mantle effort S). Both are engine-level, no assets.

## Queue impact
Near-term adds (cheap, high-value): shader pre-warm; sniper breath-hold;
mantle. Visuals program: triplanar procedural surfaces alongside (or before)
the xAI texture batch; CSM for shadow range. Tools bench: img2threejs trial.
