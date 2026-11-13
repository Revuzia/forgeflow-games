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

## Terrain chunking — scoped 2026-07-28 (baseline measured live)

BASELINE (isla_viva, ground view): frame 1,468,758 tris / 380 calls; terrain
180,000 tris = 12.3% of the frame, drawn IN FULL from every viewpoint (one
301x301 mesh — Three culls per-mesh, so nothing ever rejects it).
DE-RISKED: the mesh is PURELY VISUAL (maps.js's own comment: gameplay reads
analytic heightAt0; nothing consumes map.terrain) — chunking cannot move a
collision surface.

PLAN (one focused pass, ~150-200 lines in the terrain build):
- 8x8 grid of 200 m chunks; far LOD = CURRENT 5.33 m/vertex density (the
  distant silhouette must not regress), near ring (3x3 around the camera
  cell) = 2.67 m/vertex (2x silhouette quality where stairstep is visible).
- Near-LOD geometries built LAZILY on first entry to the near ring, cached
  per chunk (<= ~25 builds per match; memory bound ~5.7 MB total).
- 0.5 m skirt on every chunk edge instead of T-junction stitching.
- Expected: ground view ~145k terrain tris (culling wins), aerial ~180k
  (same as today), near-field silhouette 2x, draw calls +63 (trivial).
- Verify: baseline silhouette screenshot saved (terrain_baseline_silhouette),
  compare after; frame-tri counts via renderer.info autoReset=false (NOTE:
  with autoReset on, info reads only the composer's final fullscreen pass).

## WebRTC transport overlay — scoped 2026-07-28

WHY even at 4 humans: the envelope merge fits the 100 msg/s ceiling (80 worst
case), but the 2M msgs/month project quota still caps the WHOLE portfolio at
~20 full-room LC matches/month. P2P DataChannels remove ceiling AND quota for
the dominant traffic (the state envelope), plus cut latency (no relay hop).

DESIGN (overlay, not replacement — Supabase stays for signaling + fallback):
- runtime/net/ffg_rtc.js: RTCMesh — one RTCPeerConnection + ONE unreliable
  DataChannel ({ordered:false, maxRetransmits:0}) per remote peer. 4 humans =
  at most 3 connections per client.
- SIGNALING rides the existing room channel: send("rtc", {to, kind:
  offer|answer|ice, ...}); LC's onMsg forwards "rtc" addressed to this peer.
  Deterministic offerer = lower peer id per pair (no glare). Google STUN only,
  no TURN — NAT-blocked pairs simply stay on Supabase.
- SPLIT: ONLY the merged state envelope (state+evs+bots) moves to the DC.
  Critical low-rate messages (hitYou, died, start, bye, takeover, sync, chat)
  STAY on Supabase — reliability semantics unchanged, and they are a rounding
  error of the quota.
- SEND RULE per tick: DC to every peer whose channel is open; ONE Supabase
  broadcast IF any peer lacks an open DC (they filter by 'from' as today).
  Any RTC failure = exactly today's behaviour, byte-identical.
- VERIFICATION LIMIT (honest): single-client harness can exercise signaling
  plumbing + fallback selection; a REAL P2P state exchange needs two clients —
  loopback RTCPeerConnection pairs CAN be tested in one page (connect two
  local PCs to each other) to prove the mesh class end-to-end.
- Effort: ~150-line mesh + ~40-line net.js integration. Risk: LOW (pure
  overlay; fallback is the current path).
