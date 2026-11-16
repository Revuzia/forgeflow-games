// shared by tests/reach-*.test.ts (POWERS-GROWTH v3): a small BOUND world with one living town, and direct access to the
// people's regard so the measure can be tested without waiting for the sim to move it.
import { Sim } from '../src/sim/sim.ts';
import { AgentFlag } from '../src/sim/types.ts';
import { GODS } from '../src/sim/people/defs.ts';
import { reachDaily, reachSeen, reachView, type ReachView } from '../src/sim/god/reach.ts';

export function world(bound = true, seed = 5): Sim {
  return new Sim({ seed, scenario: 'shore', overrides: { n: 20 }, bound });
}

export function ctx(sim: Sim) {
  const p = sim.u.planets.find((q) => q.people.agents.count > 0)!;
  const ps = p.people, A = ps.agents;
  const st = ps.settlements.filter((s) => s.fallen < 0).sort((a, b) => (ps.members.get(b.id)?.length ?? 0) - (ps.members.get(a.id)?.length ?? 0))[0];
  const grown = (ps.members.get(st.id) ?? []).filter((s) => A.alive[s] && !(A.flags[s] & AgentFlag.child));
  const set = (s: number, faith: number, trust = 0, fear = 0) => { A.faith[s * GODS] = faith; A.love[s * GODS] = trust; A.fear[s * GODS] = fear; };
  const clear = () => { for (let s = 0; s < A.hi; s++) set(s, 0); };
  const seen = () => reachSeen(sim.u, p.id, st.id);
  const day = (n = 1): ReachView => { for (let i = 0; i < n; i++) reachDaily(sim.u); return reachView(sim.u); };
  const pool = (v?: number): number => { if (v !== undefined) { for (const q of sim.u.planets) q.people.worship[0] = 0; ps.worship[0] = v; } return reachView(sim.u).pool; };
  const cast = (c: Record<string, unknown>) => sim.applyNow(c as never);
  return { p, ps, A, st, grown, set, clear, seen, day, pool, cast, at: [...st.pos] as number[] };
}
