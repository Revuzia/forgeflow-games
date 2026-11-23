# R15 FACING (owner 2026-11-23: "when squishies walk they aren't facing the direction they walk. they need to be able to turn.")

Running report (container may restart: continue from the last finished item).

## Status
- [ ] 1. what "facing" is visually; browser measurement (before)
- [ ] 2. fix
- [ ] 3. probe rows on the DRAWN face
- [ ] 4. screenshots before/after
- [ ] 5. final probes

## Notes
- Face: two eye beads anchored on the sim skin at rest +Z (render/wholeRef.ts, face.ts): the drawn face turns with the particles, so a yaw of X turns it.
- crawl.ts turns X about the centre toward the scoot target (yawTau 0.12 s, yawMax 8 rad/s) while `free && ground && go`.
