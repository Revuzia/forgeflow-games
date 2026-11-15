
### Allocation rate — framepump7.py (HeapProfiler.startSampling, samplingInterval 4096,
### includeObjectsCollectedByMinorGC + MajorGC = TOTAL allocated, 600 pumped match frames, 49 bots live)
- **554.5 KB allocated per frame** (332,699 KB over 600 frames) = ~33 MB/s at 60 fps. Exact method, contaminated box
  does not change allocation counts.
- **W.map.queryColliders called 423.2 times per frame** (counting wrapper on W.map; external callers only —
  maps.js-internal calls at :2174 / :2241 are not counted). Each call allocates an array, a Set and 1-4 string keys.
- Top sites (KB per frame): testSegment weapons.js:663 **180.7** (projectile sub-step collision: queryColliders +
  segmentColliders + a Math.hypot per actor per sub-step; weapons.js:630 `const steps = Math.max(1, Math.min(8,
  Math.ceil((speed * dt) / 2.5)));`) · three Interpolant.evaluate three.core.js:25141 **95.2** (the 50 animation mixers,
  G7) · native Math.hypot **60.1** · syncObj player.js:1380 20.3 (playAnim option literals) · native Set 18.6 +
  the queryColliders call path 17.9 (my counting wrapper's frame; the Set/array/key allocations of queryColliders
  land here and under maps.js:2141 1.0) · segmentColliders sim/royale.js:260 14.4 · stepActor player.js:1007 14.1 ·
  actEngage bots.js:1151 12.0 · three slerpFlat 11.8 · stepProjectiles weapons.js:619 11.5 · losBlocked maps.js:2154 10.2 ·
  loot update loot.js:650 9.0 · moveToward bots.js:752 6.7 · perceive bots.js:361 4.0 · moveBasis sim/royale.js:192 3.1.
- By file (MB over 600 frames): weapons.js 117.3 · native 71.2 · three.core.js 68.8 · player.js 24.1 · bots.js 19.7 ·
  sim/royale.js 12.2 · maps.js 8.9 · loot.js 6.8 · pose.js 1.4 · fx.js 1.0 · hud.js 0.8 · audio.js 0.4.
- JS heap across the window 40.6 -> 30.9 MB (GC ran inside it); the retained-only sample of run 6 (0.6 KB/frame) is
  superseded by this.
- Correction to the static guess: the fx.js / hud.js / loot.js literals are small change (<= 9 KB/frame together);
  the real allocator is the projectile collision path in weapons.js + queryColliders + Math.hypot, then the mixers.
