# greatwick (siege wick, 1.5 m): Art 2.0 build progress

Owner files: art/blender/units/wick_greatwick.py, art/blender/proto/wick_greatwick_*.py,
art/out/units/greatwick_{aubade,serenade}.glb, art/renders/units/*greatwick*.

## Milestones
- 2026-10-20 10:17 start. Read brief §0-§6 (greatwick §3.3), concepts, wick_common, marund (+ v2 fit), burdam
  (paint-pose + bind wrappers). Measured both concepts on a grid:
  - Aubade (front cx 573 / ground ~1372, back cx 1506 / ground ~1370, ~762 px/m from the roof top 1.52 m):
    hood crown 1.20, knob 1.28, lantern panes 1.13-1.40, roof 1.53, spires 1.62, haft ~0.46, hem ~0.10,
    lantern frame only 0.37 m wide (roof 0.47): narrower than the hood (0.53) -> brief wants 0.62.
  - Serenade (front cx ~527 / ground ~1352, back cx 1521 / ground ~1345, ~755 px/m from the lid top 1.56 m):
    hood crown 1.33 (13 cm above Aubade), drum 1.14-1.47 x 0.71-0.75 m, lid 1.56, haft ~0.52, hem 0.15.
  - The shared plate cut: Aubade front sole row 1285 is wrong (boots at 1305-1385); feet cut out of the mask.
  Plan: sculpt each faction in CONCEPT space (pixel-true fit), then per-part warps move parts into the
  shared model layout (Aubade lantern widened, Serenade upper body lowered so the hood crown is ~1.25 and the
  drum narrowed); the paint pass inverts the warps (paint pose, as burdam does) so the projection stays exact.
