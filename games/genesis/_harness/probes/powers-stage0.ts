// POWERS-GROWTH stage 0 measurement (no sim changes). Usage:
//   node _harness/probes/powers-stage0.ts <scenario|default> <behaviour none|help|severe|mixed> <seed> [years=10] [n=20]
// Faith / fear / trust per person (god 0), worship, shrines/temples, v1 Following F and share S (spec section 2, without the
// pride / defiance / covenant modifiers), once per game day. One JSON line prefixed RESULT.
// 'default' = sandbox world (the barren default has no people) + 60 plains-folk, bronze, settled.
// Acts: 2 per game day (every half day) at the largest living town, rotating through the behaviour's list.
import { Sim } from '../../src/sim/sim.ts';
import { GODS } from '../../src/sim/people/defs.ts';
import { AgentFlag } from '../../src/sim/types.ts';

const [scen = 'default', beh = 'none', seedS = '1', yearsS = '10', nS = '20'] = process.argv.slice(2);
const seed = Number(seedS), years = Number(yearsS);
const t0 = Date.now();
const sim = scen === 'default'
  ? new Sim({ seed, scenario: 'sandbox', overrides: { n: Number(nS), vegetation: 1 } })
  : new Sim({ seed, scenario: scen, overrides: { n: Number(nS) } });
if (scen === 'default') {
  const r = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 60, era: 'bronze', settled: true } as never);
  if (!r.ok) throw new Error(r.msg);
}
const p = sim.u.planets.find((q) => q.people && q.people.agents.hi > 0) ?? sim.u.planets[0];
const ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const yearTicks = 12 * day; // a game year is 12 game days (all scenarios use yearDays 12; the sandbox year is checked below)
const bIdx = (id: string) => sim.u.content.buildings.list.findIndex((b) => b.id === id);
const SHRINE = bIdx('shrine'), TEMPLE = bIdx('temple');

const HELP: Record<string, unknown>[] = [
  { k: 'miracle.food' }, { k: 'miracle.water' }, { k: 'miracle.heal' }, { k: 'settlement.gift', items: { bread: 6 } },
];
const SEVERE: Record<string, unknown>[] = [
  { k: 'miracle.lightning', wrath: 0.3 }, { k: 'fire.ignite' }, { k: 'weather.paint', kind: 'hail', radius: 300, intensity: 0.8 },
  { k: 'disaster.spawn', kind: 'quake', radius: 300, wrath: 0.3 },
];
const list = beh === 'help' ? HELP : beh === 'severe' ? SEVERE : beh === 'mixed' ? [HELP[0], SEVERE[0], HELP[1], SEVERE[2], HELP[2], SEVERE[1], HELP[3], SEVERE[3]] : [];

function target() {
  let best: (typeof ps.settlements)[number] | null = null, bn = -1;
  for (const s of ps.settlements) {
    if (s.fallen >= 0 || s.band) continue;
    const n = ps.members.get(s.id)?.length ?? 0;
    if (n > bn) { bn = n; best = s; }
  }
  return best;
}
const sum = (): number => ps.settlements.reduce((a, s) => a + (s.worshipBy?.[0] ?? 0), 0);

const road = new Map<number, number>(); // spec 2.1 hysteresis: id -> 1 trust, 2 fear (trustLine .50 keep .50, fearLine .35 keep .04)
let popMax = 12, actN = 0, actOk = 0, acted = 0, nextAct = 0;
const cross: Record<string, number> = { F3: -1, F20: -1, F70: -1, F200: -1, R3: -1, R20: -1, R70: -1, R200: -1 };
const rows: number[][] = [];
const start = sim.u.tick;
let lastGen = 0;
const days = Math.round(years * 12);
for (let d = 1; d <= days; d++) {
  // two acts a day: at the day's start and half a day later
  for (let h = 0; h < 2; h++) {
    const t = target();
    if (list.length && t) {
      const c = { ...list[actN % list.length], pos: [...t.pos], settlement: t.id } as Record<string, unknown>;
      if (c.k === 'settlement.gift' || c.k === 'life.cure') delete c.pos; else delete c.settlement;
      const r = sim.applyNow(c as never);
      actN++; if (r.ok) actOk++;
    }
    sim.step(Math.round(day / 2));
  }
  let rT = 0, rF = 0, gp = 0, bel = 0;
  let pop = 0, F = 0, f30 = 0, f55 = 0, e30 = 0, e55 = 0, l30 = 0, l55 = 0, fe30 = 0, fe55 = 0, fl30 = 0, fl55 = 0;
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    pop++;
    const f = A.faith[s * GODS], e = A.fear[s * GODS], l = A.love[s * GODS];
    if (f >= 0.3) f30++; if (f >= 0.55) f55++;
    if (e >= 0.3) e30++; if (e >= 0.55) e55++;
    if (l >= 0.3) l30++; if (l >= 0.55) l55++;
    if (!(A.flags[s] & AgentFlag.child)) {
      gp++;
      const id = A.id[s], cur = road.get(id) ?? 0;
      if (f >= 0.2999) {
        bel++;
        let nr = cur;
        if (cur === 1 && l < 0.5) nr = 0; else if (cur === 2 && e < 0.04) nr = 0;
        if (nr === 0 || cur !== nr || true) {
          const tOk = l >= 0.5 && l >= e, fOk = e >= 0.35 && e > l;
          if (nr === 0) nr = tOk ? 1 : fOk ? 2 : 0;
          else if (nr === 2 && tOk) nr = 1; else if (nr === 1 && fOk) nr = 2;
        }
        road.set(id, nr);
        if (nr === 1) rT++; else if (nr === 2) rF++;
      } else road.delete(id);
    }
    if (f >= 0.3 && e >= 0.3) fe30++; if (f >= 0.55 && e >= 0.55) fe55++;
    if (f >= 0.3 && l >= 0.3) fl30++; if (f >= 0.55 && l >= 0.55) fl55++;
  }
  F = bel + rT + rF; // v2 F: grown believers + those on a road
  const Fv1 = f30 + f55;
  popMax = Math.max(popMax, gp);
  const S = F / (2 * popMax);
  const th: [string, number, boolean][] = [['3', 3, F >= 3], ['20', 20, F >= 20 || S >= 0.35], ['70', 70, F >= 70 || (S >= 0.6 && F >= 30)], ['200', 200, F >= 200 || (S >= 0.8 && F >= 60)]];
  for (const [k, n, ok] of th) {
    if (cross['F' + k] < 0 && F >= n) cross['F' + k] = d;
    if (cross['R' + k] < 0 && ok) cross['R' + k] = d;
  }
  if (d % 12 === 0) {
    const gen = sum();
    let sh = 0, tp = 0;
    for (const b of ps.buildings) if (b.progress >= 1) { if (b.type === SHRINE) sh++; else if (b.type === TEMPLE) tp++; }
    rows.push([pop, f30, f55, e30, e55, l30, l55, fe30, fe55, fl30, fl55, Math.round(gen * 100) / 100, Math.round(ps.worship[0] * 100) / 100, sh, tp, F, Math.round(S * 1000) / 1000, popMax, rT, rF, bel, Fv1, ps.settlements.filter((q) => q.fallen < 0 && !q.band).length]);
    void lastGen; lastGen = gen;
  }
}
console.log('RESULT ' + JSON.stringify({ scen, beh, seed, n: Number(nS), yearTicks, dayTicks: day, orbitDays: Math.round(p.st.orbit.period / day * 10) / 10, acts: actN, actOk, cross, rows, ms: Date.now() - t0 }));
