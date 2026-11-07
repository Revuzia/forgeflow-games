# ARC §6 contract changes (append-only; who, when, what, why)

- 2026-11-07 render (A-render stint 1): §6.2 TowerView — clarified, not changed in type: `height` is what stands, and on
  a `struck` tower `tiers` keeps the tier count before the fall (render/life/tower.ts heaps `tiers - ceil(height/12)`
  fallen tiers as the rubble mound; if the sim recomputes tiers from height the mound falls back to one tier's worth).
  Sim lane: when building tower.strike, lower `height` to the standing remains and leave `tiers` as it was.
