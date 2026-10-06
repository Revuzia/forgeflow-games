import * as CAT from '/home/user/forgeflow-games/games/wobblehoard/src/data/catalog.ts';
import * as MG from '/home/user/forgeflow-games/games/wobblehoard/src/core/merge.ts';
const TI = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
for (let i = 0; i < 6; i++) {
  const parentTier = TI[Math.max(0, i - 1)], seed = 5 + i, tier = TI[i];
  const sp = CAT.speciesInTier(parentTier)[seed % CAT.speciesInTier(parentTier).length];
  const parents = [0, 1].map((k) => CAT.speciesBaseGenome(sp.id, seed * 31 + k + 1));
  const rs = CAT.speciesInTier(tier)[(seed * 7) % CAT.speciesInTier(tier).length];
  const g = MG.lineageGenome(CAT.speciesBaseGenome(rs.id, seed * 131 + 9), parents, seed);
  console.log(tier, 'parents', sp.id, sp.family, parents.map((p) => p.hue + '/' + p.lightness.toFixed(2)).join(' '), '-> result', rs.id, rs.family, g.hue, g.lightness.toFixed(2));
}
