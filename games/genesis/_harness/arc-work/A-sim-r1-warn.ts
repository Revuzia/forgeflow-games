// A-sim-r1 probe (finding 4): babel, rise to the first tower.choice, call a prophet in the host, warn; after each
// refusal wait out the year and warn again (up to 4 warnings). Prints the heed inputs per town and each outcome.
//   node _harness/arc-work/A-sim-r1-warn.ts <seed>
import { Sim } from '../../src/sim/sim.ts';
import { peekRel, relOf } from '../../src/sim/god/regard.ts';
import type { TowerState } from '../../src/sim/god/state.ts';
const seed = Number(process.argv[2] ?? 1);
const sim = new Sim({ seed, scenario: 'babel', overrides: { n: 20 } });
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
const r2 = (v: number) => Math.round(v * 100) / 100;
let choice = false;
const drain = () => { for (const e of sim.drainEvents() as { t: string }[]) if (e.t === 'tower.choice') choice = true; };
const cap = Math.round(2.5 * year);
while (sim.u.tick < cap && !choice) { sim.step(60); drain(); }
const t = sim.u.god.rel?.towers?.at(-1) as TowerState | undefined;
if (!t) { console.log('RESULT ' + JSON.stringify({ seed, err: 'no tower' })); process.exit(0); }
const host = ps.settlement(t.host)!;
for (const s of (ps.members.get(host.id) ?? []).filter((s) => !(A.flags[s] & 1))) { const r = sim.applyNow({ k: 'prophet.call', agent: A.id[s] } as never) as { ok: boolean }; if (r.ok) break; }
const out: Record<string, unknown>[] = [];
for (let k = 0; k < 4 && t.status === 'rising'; k++) {
  if (t.warned && sim.u.tick < t.warned.disabledUntil) { while (sim.u.tick < t.warned.disabledUntil && t.status === 'rising') { sim.step(60); drain(); } }
  if (t.status !== 'rising') break;
  const r = sim.applyNow({ k: 'tower.warn' } as never) as { ok: boolean; msg?: string };
  if (!r.ok) { out.push({ k, fail: r.msg }); break; }
  const ph = relOf(sim.u).prophets.find((q) => q.agent === t.warned!.agent);
  const cred0 = ph?.credibility ?? 0.3;
  const ins = t.league.map((id) => { const q = peekRel(sim.u, p.id, id)!; const f0 = Math.min(1, q.means[0] + (q.since.tDrain ?? 0));
    const heed = Math.min(0.2, Math.max(0.01, 0.02 + 0.08 * cred0 * f0 - 0.05 * (q.pride ?? 0) + 0.06 * q.means[1] + 0.02 * q.means[2] + 0.03 * (q.since.tRefusals ?? 0)));
    return { id, heed: Math.round(heed * 1000) / 1000, m: q.means.slice(0, 3).map(r2), pride: r2(q.pride ?? 0), drain: r2(q.since.tDrain ?? 0), ref: q.since.tRefusals ?? 0 }; });
  sim.step(6 * day + 60); drain();
  out.push({ k, y: r2(sim.u.tick / year), h: r2(t.height / t.goal), cred: ph?.credibility, ins, heeded: t.warned!.heeded, refused: t.warned!.refused, status: t.status });
}
// T8 last clause: a strike after a refusal is foretold or provoked (the host's act record)
let strike: unknown = null;
if (t.status === 'rising' && t.warned?.refused.length) {
  const r = sim.applyNow({ k: 'tower.strike' } as never) as { ok: boolean; msg?: string };
  sim.step(2 * day); drain();
  const a = peekRel(sim.u, p.id, t.host)?.acts.filter((q) => q.kind === 'harm' && q.god === 0).at(-1);
  strike = { ok: r.ok, foretold: a?.foretold, provoked: a?.provoked, dead: a?.dead };
}
const sacred = relOf(sim.u).places.filter((q) => (q as { by?: string }).by === 'prophet').length;
console.log('RESULT ' + JSON.stringify({ seed, host: t.host, first: out[0], firstHeed: (out[0]?.heeded as number[] | undefined)?.length ?? 0, warnings: out.length, status: t.status, sacred, strike, all: out.slice(1) }));
