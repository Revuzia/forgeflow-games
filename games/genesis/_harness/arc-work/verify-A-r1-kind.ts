// ARC verifier: why a kind god's town does not turn devoted (M3 kind). Prints command results and the regard means.
import { Sim } from '../../src/sim/sim.ts';
import { srel } from '../../src/sim/god/regard.ts';
import { GODS, NT, TRAIT } from '../../src/sim/people/defs.ts';
import { AgentFlag } from '../../src/sim/types.ts';
const seed = Number(process.argv[2] ?? 1);
const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 } as never);
const r0 = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 45, era: 'bronze', settled: true, wildGame: false } as never);
const sid = r0.created!.find((e) => e.kind === 'settlement')!.id;
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.round(p.st.dayHours * 60);
const res: Record<string, number> = {};
function means(tag: string) {
  let n = 0, fa = 0, lo = 0, fe = 0, ly = 0, mo = 0, dv = 0, c1 = 0, c2 = 0, c3 = 0;
  for (const s of ps.members.get(sid) ?? []) {
    if (A.flags[s] & AgentFlag.child) continue;
    const i = s * GODS; n++;
    fa += A.faith[i]; lo += A.love[i]; fe += A.fear[i]; ly += A.loyalty[i]; mo += A.mood[s];
    if (A.faith[i] >= 0.5) c1++; if (A.love[i] >= A.fear[i]) c2++; if (A.loyalty[i] >= 0.35) c3++;
    if (A.faith[i] >= 0.5 && A.love[i] >= A.fear[i] && A.loyalty[i] >= 0.35) dv++;
  }
  const r = srel(sim.u, p.id, sid);
  console.log(tag, 'n', n, 'faith', (fa / n).toFixed(2), 'love', (lo / n).toFixed(2), 'fear', (fe / n).toFixed(2), 'loyalty', (ly / n).toFixed(2), 'mood', (mo / n).toFixed(2),
    'faith>=.5', c1, 'love>=fear', c2, 'loyal>=.35', c3, 'devotedRule', dv, 'kind', r.hearts?.kind, JSON.stringify(r.hearts ?? {}), 'prayers', r.prayers.length, 'dusk', JSON.stringify(r.dusk), 'pride', r.pride);
}
sim.step(day);
means('day1');
for (let d = 0; d < 48; d++) {
  const r = srel(sim.u, p.id, sid);
  const cmds: Record<string, unknown>[] = [];
  if (r.prayers.length) cmds.push({ k: 'prayer.answer', settlement: sid });
  if (d % 3 === 0) cmds.push({ k: 'settlement.gift', settlement: sid, items: { bread: 40 } });
  if (d % 4 === 1) cmds.push({ k: 'life.bless', pos: [...ps.settlement(sid)!.pos] });
  for (const c of cmds) { const o = sim.applyNow(c as never); const key = `${c.k}:${o.ok ? 'ok' : o.msg}`; res[key] = (res[key] ?? 0) + 1; }
  sim.step(day);
  if (d % 12 === 11) means(`day${d + 2}`);
}
console.log(JSON.stringify(res));
