// CUT3 (_spec/CUT3.md 3, 4 RENDER): what makes MANY pieces cheap. Pure (no three, no DOM): the numbers the stage, the views and the probes agree on.
//
//  * fineFreqFor: the geodesic frequency of the fine mesh of a body that is NOT a true piece (a whole, a Minis copy). A fine vertex count of 10 f^2 + 2 follows what the body is
//    made of: its share of the whole (a surface of a smaller body is smaller: vertices ~ share^(2/3), the same density per area as the whole's) and its sim mesh (a body of
//    12 sim particles has nothing to place 5,762 fine vertices on). A whole at share 1 on a 642-vertex sim mesh gets the tier's frequency exactly (nothing changes for it).
//  * LOD_TUNING: how many pieces get the table shadow and light pool (the largest), the rest are drawn as jelly, eyes and ember only.
export const LOD_TUNING = {
  /** false = everything as it was before CUT3 (full fine mesh for every body, every view fully drawn): the A / B of the probes, never switched off by the game. */
  enabled: true,
  /** The stage's LARGEST this many bodies keep everything (table shadow, light pool, tier FX, strands); the others get the small-piece look (BodyView.lod 1). 8 = CUT3 section 3. */
  fullViews: 8,
  /** Floor of the fine mesh's frequency: 162 vertices, so a 1/200 mini is still round at 40 px. */
  minFreq: 4,
  /** A share below this counts as this (the share^(2/3) law needs a floor: a share of 0 is no body). */
  minShare: 0.002,
  /** A body whose fine mesh was built for a smaller share is built again once the share it should have is this much bigger in frequency (a mini growing in a Reconnect). */
  regrow: 1.25,
};

/** The sim mesh a detail-3 whole is made of: the reference of the "what the sim can place" law. */
export const WHOLE_SIM_VERTS = 642;

/** The fine frequency a body of `frac` of the whole (1 for a whole) on a mesh of `simVerts` particles gets at a tier whose frequency is `tierFreq`. */
export function fineFreqFor(tierFreq: number, simVerts: number, frac: number | undefined): number {
  if (!LOD_TUNING.enabled) return tierFreq;
  const f = frac !== undefined && Number.isFinite(frac) && frac > 0 ? Math.min(1, Math.max(LOD_TUNING.minShare, frac)) : 1;
  const share = Math.min(1, Math.pow(f, 2 / 3), Math.max(0.0, simVerts / WHOLE_SIM_VERTS));
  const fr = Math.round(tierFreq * Math.sqrt(share));
  return Math.max(Math.min(LOD_TUNING.minFreq, Math.floor(tierFreq)), Math.min(Math.floor(tierFreq), fr));
}
