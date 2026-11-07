// T7 (stint 6): babel <seed>: let the tower rise <years>, strike at the default wrath at a daylight work hour; deaths vs
// builders on site (<= 120 m), and whether the remains (great-tower building) still stand <after> years later.
import { Sim } from '../../src/sim/sim.ts';
import { distM, sunElevation } from '../../src/sim/people/world.ts';
const [seedS = '1', yearsS = '0.5', afterS = '3'] = process.argv.slice(2);
const sim = new Sim({ seed: Number(seedS), scenario: 'babel', overrides: { n: 20 } });
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
sim.step(Math.round(Number(yearsS) * year));
const tw = () => sim.u.god.rel!.towers!.find((t) => t.status === 'rising');
let guard = 0;
while (tw() && sunElevation(sim.u, p, sim.u.tick, tw()!.pos) < 0.35 && guard++ < 200) sim.step(30);
const t = tw();
if (!t) { console.log('RESULT', JSON.stringify({ seed: seedS, err: 'no rising tower', towers: sim.u.god.rel?.towers?.map((q) => q.status) })); process.exit(0); }
const P = [0, 0, 0]; let onSite = 0;
for (const sid of t.league) for (const s of ps.members.get(sid) ?? []) { A.posAt(s, sim.u.tick, P); if (distM(p, P, t.pos) <= 120) onSite++; }
const pop0 = t.league.reduce((n, sid) => n + (ps.members.get(sid)?.length ?? 0), 0);
sim.drainEvents();
const r = sim.applyNow({ k: 'tower.strike' } as never);
const ev = sim.drainEvents().find((e) => (e as { t: string }).t === 'tower.struck') as unknown as { data: { dead: number; tiers: number } } | undefined;
const b = t.building;
sim.step(Math.round(Number(afterS) * year));
const stands = !!ps.building(b);
console.log('RESULT', JSON.stringify({ seed: Number(seedS), ok: r.ok, msg: r.ok ? undefined : r.msg, tiers: t.tiers, fell: ev?.data.tiers, onSite, dead: ev?.data.dead, pop0, ok50: onSite ? (ev?.data.dead ?? 0) <= 0.5 * onSite : (ev?.data.dead ?? 0) === 0, le10: (ev?.data.dead ?? 0) <= 10, remainsAfter: stands, afterYears: Number(afterS), status: t.status }));
