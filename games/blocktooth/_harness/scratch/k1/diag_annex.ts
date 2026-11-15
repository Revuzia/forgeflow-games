
// diag: why an owed RECORDS ANNEX is not placed (probe_map K, grideast molo 1337)
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import * as draft from '../../../src/upgrades/draft.ts';
import * as bot from '../../bot.ts';
import { spawnRing } from '../../../src/ai/director.ts';
import { OBJECTIVES, RANKS } from '../../../src/core/config.ts';
const [titan, biome, seedS] = process.argv.slice(2);
const w = createWorld({ titan: (titan ?? 'molo') as any, biome: (biome ?? 'grideast') as any, seed: Number(seedS ?? 1337) });
let lastLog = -1;
while (!w.run.result && w.t < 900) {
  while (draft.hasPendingDraft(w)) { const off = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : draft.rollOffer(w, w.upgrades.chestDrafts > 0); draft.pickUpgrade(w, bot.botPickUpgrade(w, off)); }
  stepWorld(w, bot.botInput(w));
  for (const e of w.events) {
    if (e.type === "rankUp" || e.type === "gateDefeated" || e.type === "gateLocked" || e.type === "gateSpawn") console.log(`${w.t.toFixed(2)} ${e.type} ${JSON.stringify(e)}`);
    if (e.type === "gateDefeated") console.log("  tick events: " + w.events.map((q: any) => q.type + (q.type === "bossHit" ? "(" + (q.src ?? q.source ?? "") + ")" : "")).join(" "));
    if (e.type === 'objectiveSpawn' && e.kind === 'recordsAnnex') console.log(`${w.t.toFixed(2)} ANNEX placed`);
  }
  const m = w.map as any;
  if (w.events.some((q: any) => q.type === "rankUp") || Math.abs(w.t - 461.37) < 0.02) console.log(`  annexDue after tick ${w.t.toFixed(2)}: [${m.annexDue.join(",")}] result ${w.run.result}`);
  if (m.annexDue.length && w.t >= m.annexDue[0] - 1e-6 && w.t - lastLog > 2.9) {
    lastLog = w.t;
    const ring = spawnRing(w), T = w.titan, can = RANKS[T.rank].canFlatten;
    let n = 0, inBand = 0;
    for (const b of w.city.buildings) { if (b.collapsed || b.alive < 1 || (b.tier !== can && b.tier !== can - 1)) continue; n++; const d = Math.hypot(b.x - T.x, b.z - T.z); if (d >= OBJECTIVES.annex.bandMin * ring && d <= OBJECTIVES.annex.bandMax * ring) inBand++; }
    console.log(`${w.t.toFixed(2)} annex due ${m.annexDue.map((x: number) => x.toFixed(1)).join(',')} rank ${T.rank} ring ${ring.toFixed(1)} eligible ${n} inBand ${inBand} objectives alive ${w.map.objectives.filter((o) => o.alive).map((o) => o.kind).join(',')} titan ${T.x.toFixed(0)},${T.z.toFixed(0)}`);
  }
}
console.log('end', w.run.result, w.t.toFixed(1));
