export {};
const { UPGRADES, UPGRADE_BY_ID } = await import('../../../src/data/upgrades.ts');
const { EVOLUTIONS } = await import('../../../src/data/evolutions.ts');
for (const r of EVOLUTIONS) { const e = UPGRADE_BY_ID[r.id], b = UPGRADE_BY_ID[r.base], c = UPGRADE_BY_ID[r.with];
  console.log(r.id.padEnd(28), (e.titan??'-').padEnd(10), e.locked?'L':' ', `${b.id}(${b.rarity}/${b.maxStacks}${b.minRank?' r'+b.minRank:''}${b.locked?' L':''})`, `+ ${c.id}(${c.rarity}/${c.maxStacks}${c.minRank?' r'+c.minRank:''}${c.locked?' L':''})`); }
const cnt: Record<string, Record<string, number>> = {};
for (const u of UPGRADES) { if (u.evo||u.perk) continue; const k = (u.titan??'generic') + (u.locked?'-L':''); cnt[k] ??= {}; cnt[k][u.rarity] = (cnt[k][u.rarity]??0)+1; }
console.log(cnt);
