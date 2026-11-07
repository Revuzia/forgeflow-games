# verify-A-r1-publish ledger (publish verifier, stage A round 1; read-only for src/tests; port 5352)

Tree: HEAD ad9b0cdd (2026-11-07T15:50Z). Bulky output: _harness/scratch/arc/verify-A-r1-publish/.
Probes (tracked): publish-iframe.mjs (r1/r2: entry, idle perf, saves; r2 fixed the r1 node OOM by base64 transfer),
publish-iframe2.mjs (driven-frame perf A/B, gunzipped fixtures into A and B, babel save round trip in A).
Baseline B = scratch/.../base/dist (the pre-arc tree of 2026-11-06 15:48).

- build: `vite build` exit 0, no warnings (build-r2.log, build-live.log; dist/ hashes == dist-r2).
- CDN smoke (`CDN_PORT=5352 node _harness/cdn.mjs` via slot.sh): PASS; 0 console errors, 0 missing, 20/20 hashed
  immutable, workers 200 (cdn-r2.log).
- 888x500 sandboxed cross-origin iframe (site sandbox tokens, COEP credentialless): 0 console errors / page errors /
  crashes / 4xx in every page opened (entry, 5 sandbox perf pages, 7 save pages, babel x2) for A (probe-r2, probe-r4).
- Frame time, default preset (auto = low on SwiftShader), sandbox, 12 driven frames, uncontended run 0:
  A 18.1 ms/frame wall, CPU work mean 9.63 / p95 20.5; B 20.8 ms, 9.56 / 24.4. Run 1 contended (another shots job's
  GPU process): A 13.5 s, B 12.8 s per frame, work 17.3 vs 10.2 (noise, both builds). r2 idle runs: work A 28/28/18 vs
  B 31/58/50. Verdict: not worse. Note: under machine contention SwiftShader frames in the iframe take 8-13 s for
  both builds (environmental; screenshots time out).
- Old saves in A (gunzipped fixtures): save-1.4-aru (tick 300 -> 360 loaded, steps on, hearts: Aru devoted),
  save-1.4-band (2880, hearts [] = band, correct), save-1.5a-kin (3120, hearts Aru quiet), baseline-made sandbox save
  (17.9 MB, tick ~2415 loaded); all ok, no errors; B loads the same fixtures (control).
- Arc-state save made by A (babel, tick 7238, 34.9 MB b64) re-imported into A: hearts identical before/after, steps on.
- HUD heart glyph seen on Aru's chip in the iframe (fx-save-1.4-aru-A.png, chip-zoom.png).
- Open (not mine, evidenced by A-sim stint 7 in contract-changes.md): §8.2 T2 attended pacing unmet (owner/spec call).
