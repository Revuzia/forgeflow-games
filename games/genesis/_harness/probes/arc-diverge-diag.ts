import { Sim } from '../../src/sim/sim.ts';
import { planetArrays } from '../../src/sim/world/planet.ts';
interface Run { sim: Sim; log: string[]; stage: number; defTown: number; broke: number }

/** one scripted-arc driver; every action keys off the sim's own tick and state, so a loaded copy repeats it exactly */
function drive(r: Run, endTick: number, onStep?: (sim: Sim) => void): void {
  const sim = r.sim;
  const p = sim.u.planets[0], ps = p.people!;
  const day = Math.max(60, Math.round(p.st.dayHours * 60)), year = Math.max(day, Math.round(p.st.orbit.period));
  const host = () => ps.settlements.filter((s) => s.fallen < 0 && !s.band).sort((a, b) => (ps.members.get(b.id)?.length ?? 0) - (ps.members.get(a.id)?.length ?? 0) || a.id - b.id)[0];
  while (sim.u.tick < endTick) {
    sim.step(Math.min(day, endTick - sim.u.tick));
    onStep?.(sim);
    const yr = sim.u.tick / year;
    for (const e of sim.drainEvents() as { t: string }[]) {
      if (e.t === 'tower.choice' && r.stage === 3) { r.log.push(`y${yr.toFixed(1)} confuse ${sim.applyNow({ k: 'tower.confuse' } as never).ok}`); r.stage = 4; }
    }
    const R = sim.u.god.rel!;
    const h = host();
    if (r.stage === 0 && sim.u.tick >= 60) {
      if (r.stage === 0 && h) { r.log.push(`y${yr.toFixed(1)} offer ${sim.applyNow({ k: 'covenant.offer', settlement: h.id } as never).ok}`); r.stage = 1; }
    } else if (r.stage === 1 && sim.u.tick >= 4 * day) {
      r.log.push(`y${yr.toFixed(1)} make ${sim.applyNow({ k: 'covenant.make', vow: 'no-flood' } as never).ok}`); r.stage = 2;
    } else if (r.stage === 2 && (R.towers?.length ?? 0) > 0) r.stage = 3;
    else if (r.stage === 4 && yr >= 12) {
      const t = ps.settlements.find((s) => s.fallen < 0 && !s.band);
      if (t) {
        r.defTown = t.id;
        sim.applyNow({ k: 'defiance.set', settlement: t.id, value: 0.7 } as never);
        sim.applyNow({ k: 'pride.set', settlement: t.id, value: 0.7 } as never);
        r.log.push(`y${yr.toFixed(1)} defiance.set ${t.id}`);
      }
      r.stage = 5;
    } else if (r.stage === 5 && yr >= 14 && h) {
      // the storm on a defiant town (defiance), then the cast that breaks the covenant (the break)
      const t = ps.settlement(r.defTown) ?? h;
      sim.applyNow({ k: 'miracle.storm', pos: [...t.pos], radius: 350, wrath: 0.4 } as never);
      r.log.push(`y${yr.toFixed(1)} storm`); r.stage = 6;
    } else if (r.stage === 6 && yr >= 16 && h) {
      const res = sim.applyNow({ k: 'miracle.lightning', pos: [...h.pos], wrath: 0.7, covenant: 'break' } as never);
      r.broke = (R.covenants ?? []).some((c) => c.status === 'broken') ? 1 : 0;
      r.log.push(`y${yr.toFixed(1)} break ${res.ok} broken=${r.broke}`); r.stage = 7;
    } else if (r.stage === 7 && yr >= 20) {
      const t = ps.settlement(r.defTown);
      if (t && t.fallen < 0) sim.applyNow({ k: 'defiance.answer', settlement: t.id, how: 'mercy' } as never);
      r.stage = 8;
    }
  }
}


const fresh = (): Run => ({ sim: new Sim({ seed: 1, scenario: 'babel', overrides: { n: 20 } }), log: [], stage: 0, defTown: -1, broke: 0 });
const a = fresh(); const yr = 17280;
drive(a, 40*yr);
const b: Run = { ...a, sim: Sim.load(a.sim.save()), log: [...a.log] };
const day = 1440;
const hdr = (r: Run) => JSON.stringify((r.sim as any).header(false), (k,v)=> (k==='stamp'||k==='fieldVer')?undefined:v);
for (let d = 0; d < 100; d++) {
  const prev = JSON.stringify([a.stage,b.stage]);
  drive(a, 40*yr + (d+1)*day); drive(b, 40*yr + (d+1)*day);
  if (a.sim.hash() !== b.sim.hash()) {
    console.log('DIVERGE day', d, 'tick', a.sim.u.tick, 'stages', a.stage, b.stage);
    const ha = JSON.parse(hdr(a)), hb = JSON.parse(hdr(b));
    const walk = (x:any,y:any,path:string,out:string[]) => { if (out.length>40) return; if (typeof x!=='object'||x===null||typeof y!=='object'||y===null) { if (x!==y) out.push(path+': '+JSON.stringify(x)?.slice(0,80)+' vs '+JSON.stringify(y)?.slice(0,80)); return; } const keys=new Set([...Object.keys(x),...Object.keys(y)]); for (const k of keys) walk(x[k],y[k],path+'.'+k,out); };
    const out:string[]=[]; walk(ha,hb,'hdr',out); console.log(out.join('\n'));
    for (let i=0;i<a.sim.u.planets.length;i++){ const pa=[...planetArrays(a.sim.u.planets[i])], pb=[...planetArrays(b.sim.u.planets[i])]; for (let j=0;j<pa.length;j++){ const x=pa[j][1] as any, y=pb[j][1] as any; let n=0, first=-1; for (let k=0;k<x.length;k++) if (x[k]!==y[k] && !(x[k]!==x[k]&&y[k]!==y[k])) { n++; if(first<0) first=k; } if (n) console.log('array', pa[j][0], 'diffs', n, 'first', first, x[first], y[first]); } }
    process.exit(0);
  }
}
console.log('no divergence in 100 days');
