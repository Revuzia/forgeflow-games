/* Difficulty proxies per stage, to benchmark the rainbow world against the
 * stages the owner already rates as properly hard.
 *  - forward hop gap: for each walkable surface, the smallest edge-to-edge gap
 *    to any surface further along the route axis (within jump reach). Small
 *    median = stepping-stone carpet = easy.
 *  - deck area: walkable surface sizes. Big decks = easy landings.
 *  - hops per 100 m: surface density along the route. */
import fs from 'fs';
const WALK = ['platform','beam','ice','vanish','conveyor','mover'];
const stages = process.argv.slice(2).length ? process.argv.slice(2)
  : ['temple-3','spire-2','rainbow-1','rainbow-2','rainbow-3'];
const q = (a, p) => { const s=[...a].sort((x,y)=>x-y); return s.length? s[Math.min(s.length-1, Math.floor(p*s.length))] : 0; };
for (const id of stages) {
  const mod = await import('../runtime/data/stages/' + id + '.js');
  const def = mod.default || Object.values(mod)[0];
  const surf = def.objects.filter(o => WALK.includes(o.kind) && o.p && o.s);
  const gaps = [], areas = [];
  for (const a of surf) {
    areas.push(a.s[0] * a.s[2]);
    const ax1 = a.p[0] + a.s[0]/2;
    let best = null;
    for (const b of surf) {
      if (b === a) continue;
      const bx0 = b.p[0] - b.s[0]/2;
      if (bx0 <= ax1 - 0.5) continue;                       // forward only
      const dx = Math.max(0, bx0 - ax1);
      const dz = Math.max(0, Math.abs(a.p[2]-b.p[2]) - (a.s[2]+b.s[2])/2);
      const gap = Math.hypot(dx, dz);
      const dy = (b.p[1]+b.s[1]/2) - (a.p[1]+a.s[1]/2);
      if (gap > 7.6 || dy > 2.0 || dy < -6) continue;       // out of jump reach
      if (best === null || gap < best) best = gap;
    }
    if (best !== null) gaps.push(best);
  }
  const len = Math.max(...def.objects.filter(o=>o.p).map(o=>o.p[0])) - Math.min(...def.objects.filter(o=>o.p).map(o=>o.p[0]));
  const trivial = gaps.filter(g=>g<2.5).length, easy = gaps.filter(g=>g>=2.5&&g<4.4).length,
        demanding = gaps.filter(g=>g>=4.4).length;
  console.log(id.padEnd(10)
    + `  surfaces ${String(surf.length).padStart(3)} (${(100*surf.length/len).toFixed(1)}/100m)`
    + `  gap p50 ${q(gaps,.5).toFixed(2)} p75 ${q(gaps,.75).toFixed(2)}`
    + `  trivial<2.5 ${(100*trivial/gaps.length).toFixed(0)}%  2.5-4.4 ${(100*easy/gaps.length).toFixed(0)}%  >=4.4 ${(100*demanding/gaps.length).toFixed(0)}%`
    + `  deckArea p50 ${q(areas,.5).toFixed(1)} p75 ${q(areas,.75).toFixed(1)}`);
}
