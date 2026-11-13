/* Every walkable surface that CROSSES a prismgate's plane outside its lattice
 * span = a walk-around. Also reports what sits on each (checkpoints, coins). */
import fs from 'fs';
for (const id of ['rainbow-1','rainbow-2','rainbow-3']) {
  const mod = await import('../runtime/data/stages/' + id + '.js');
  const def = mod.default || Object.values(mod)[0];
  const objs = def.objects;
  const gates = objs.map((o,i)=>({o,i})).filter(x=>x.o.kind==='prismgate');
  console.log('\n### ' + id);
  for (const {o:g,i:gi} of gates) {
    const vertical = g.slots === 'y';
    const halfSpan = (vertical ? g.s[1] : g.s[2]) / 2;
    const gz = g.p[2], gx = g.p[0];
    for (const [i,o] of objs.entries()) {
      if (!['platform','beam','ice'].includes(o.kind) || !o.p || !o.s) continue;
      const x0=o.p[0]-o.s[0]/2, x1=o.p[0]+o.s[0]/2;
      if (!(x0 < gx-0.2 && x1 > gx+0.2)) continue;         // crosses the plane
      const zlo=o.p[2]-o.s[2]/2, zhi=o.p[2]+o.s[2]/2;
      const outside = vertical ? (o.p[1]+o.s[1]/2 > g.p[1]+g.s[1]/2 || zhi < gz-g.s[2]/2 || zlo > gz+g.s[2]/2)
                               : (zhi < gz-halfSpan || zlo > gz+halfSpan);
      if (!outside) continue;
      // what rides on it?
      const cps = (def.checkpoints||[]).map((c,ci)=>({c,ci})).filter(({c}) =>
        c.p[0]>=x0-0.5 && c.p[0]<=x1+0.5 && Math.abs(c.p[2]-o.p[2])<=o.s[2]/2+0.5 &&
        Math.abs(c.p[1]-(o.p[1]+o.s[1]/2))<2.2);
      const coins = (def.coins||[]).map((c,ci)=>({c,ci})).filter(({c}) => {
        const p=c.p||c; return p[0]>=x0-0.5&&p[0]<=x1+0.5&&Math.abs(p[2]-o.p[2])<=o.s[2]/2+0.8; });
      console.log(`  gate obj${gi} x=${gx}${vertical?' (y-slots)':''}  BYPASSED BY obj${i} ${o.kind} p=[${o.p}] s=[${o.s}]`
        + (cps.length?`  << CHECKPOINT ${cps.map(x=>x.ci).join(',')} ON IT`:'')
        + (coins.length?`  << COIN ${coins.map(x=>x.ci).join(',')} ON IT`:''));
    }
  }
}
