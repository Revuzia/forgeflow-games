// ARC §8.4 / §8.5 probe (stage C), run through _harness/slot.sh. One RESULT line per run.
//   node _harness/probes/arc-book.ts unattended <seed> [years=60]  B1: ages (>= 3), the story's shape (title, opening,
//        characters, epithet, <= 8 sentences per age, generations <= 12, closing never "The End"), its cost, and the
//        covenant lines on the side (natural great destructions, offers). Sandbox, 60 plains folk, no god acts.
//   node _harness/probes/arc-book.ts scripted <seed> [years=32]   B1 scripted arc on `babel`: a flood on the host town
//        (wrath 1; covenant.offer if it was not great), covenant.make no-flood, the tower (babel builds it), confuse at
//        the first tower.choice, defiance.set 0.6 on a league town at year 12 and mercy to its first act; then the ages
//        in order (flood, covenant, tower, scattering) and B4 legends by year 30 (stage C3).
import { Sim } from '../../src/sim/sim.ts';

const [mode = 'unattended', seedS = '1', yearsS] = process.argv.slice(2);
const seed = Number(seedS);
const t0ms = Date.now();
const scripted = mode === 'scripted';
const sim = scripted ? new Sim({ seed, scenario: 'babel', overrides: { n: 20 } }) : new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
if (!scripted) {
  const r = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 60, era: 'bronze', settled: true } as never);
  if (!r.ok) throw new Error(r.msg);
}
const p = sim.u.planets[0], ps = p.people!;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
const years = Number(yearsS ?? (scripted ? 32 : 60));
const start = sim.u.tick, end = start + Math.round(years * year);
const ev: Record<string, number> = {};
const log: string[] = [];
let stage = 0, offerHow = '', defTown = -1, mercy = 0;
// scripted: pride starts low (pride.set 0) so it grows back on its own after the flood and the covenant: pride, then a tower
if (scripted) for (const st of ps.settlements) if (st.fallen < 0 && !st.band) sim.applyNow({ k: 'pride.set', settlement: st.id, value: 0 } as never);
const host = () => ps.settlements.filter((s) => s.fallen < 0 && !s.band).sort((a, b) => (ps.members.get(b.id)?.length ?? 0) - (ps.members.get(a.id)?.length ?? 0) || a.id - b.id)[0];

while (sim.u.tick < end) {
  sim.step(scripted ? 60 : Math.round(day / 2));
  const yr = (sim.u.tick - start) / year;
  for (const e of sim.drainEvents() as { t: string; data?: Record<string, unknown> }[]) {
    ev[e.t] = (ev[e.t] ?? 0) + 1;
    if (!scripted) continue;
    if (e.t === 'tower.begun' || e.t === 'covenant.bow' || e.t === 'covenant.offered') log.push(`y${yr.toFixed(2)} ${e.t}`);
    if (e.t === 'tower.choice' && stage === 3) {
      const r = sim.applyNow({ k: 'tower.confuse' } as never);
      log.push(`y${yr.toFixed(2)} confuse ${r.ok}`); stage = 4;
    }
    if (e.t === 'defy' && stage === 5 && e.data?.settlement === defTown && !mercy) {
      const r = sim.applyNow({ k: 'defiance.answer', settlement: defTown, how: 'mercy' } as never);
      mercy = r.ok ? 1 : 0; log.push(`y${yr.toFixed(2)} mercy ${r.ok}`);
    }
  }
  if (!scripted) continue;
  const R = sim.u.god.rel!;
  if (stage === 0 && sim.u.tick - start >= 60) {
    // the flood: covenant.offer opens the offer "as if a great flood had struck" the host (§6.4 debug; no deaths, so the
    // town's pride is not broken by the harm and the tower can still come of its own pride)
    const h = host();
    const r = sim.applyNow({ k: 'covenant.offer', settlement: h.id } as never);
    offerHow = 'debug';
    log.push(`y${yr.toFixed(2)} flood-offer ${r.ok}`); stage = 1.5;
  } else if (stage === 1.5 && sim.u.tick - start >= 3 * day) {
    const r = sim.applyNow({ k: 'covenant.make', vow: 'no-flood' } as never);
    log.push(`y${yr.toFixed(2)} make ${r.ok} ${offerHow}`); stage = 2;
  } else if (stage === 2 && (R.covenants ?? []).some((c) => c.signAt < 0)) {
    stage = 3;
  } else if (stage === 4 && yr >= 12) {
    const t = ps.settlements.find((s) => s.fallen < 0 && !s.band);
    if (t) { defTown = t.id; sim.applyNow({ k: 'defiance.set', settlement: t.id, value: 0.6 } as never); sim.applyNow({ k: 'pride.set', settlement: t.id, value: 0.7 } as never); }
    log.push(`y${yr.toFixed(2)} defiance.set ${defTown}`); stage = 5;
  }
}
const ages = (sim.query('ages', {}) as { kind: string; name: string; begun: number; ended: number }[]).filter((a) => true);
const t1 = performance.now();
const story = sim.query('story', {}) as { title: string; opening: string; people: { line: string }; god: { line: string; epithet: string }; ages: { name: string; paragraphs: string[]; told?: string }[]; generations: string[]; promises: string[]; closing: string };
const storyMs = Math.round((performance.now() - t1) * 10) / 10;
const kinds = ages.map((a) => a.kind);
const order = ['flood', 'covenant', 'tower', 'scattering'];
let oi = 0;
for (const k of kinds) if (k === order[oi]) oi++;
const legends = ps.settlements.flatMap((s) => sim.u.god.rel?.st[`0:${s.id}`]?.legends ?? []);
console.log('RESULT ' + JSON.stringify({
  mode, seed, years, secs: Math.round((Date.now() - t0ms) / 1000), agents: ps.agents.count,
  nAges: ages.length, ages: ages.map((a) => `${a.kind}@${((a.begun - start) / year).toFixed(1)}:${a.name}`),
  scriptedOrder: scripted ? oi === order.length : undefined, log: scripted ? log : undefined, offerHow: scripted ? offerHow : undefined,
  story: { title: story.title, opening: !!story.opening, people: !!story.people.line, god: !!story.god.line, epithet: story.god.epithet,
    maxSentences: Math.max(0, ...story.ages.map((a) => a.paragraphs.length)), generations: story.generations.length, closing: story.closing,
    theEnd: /the end/i.test(story.closing), ms: storyMs, told: story.ages.filter((a) => a.told).length },
  legends: legends.length, legendGens: [...new Set(legends.map((l) => l.gen))].sort(), legendMaxLen: Math.max(0, ...legends.map((l) => l.text.length)),
  covenant: { great: (sim.u.god.rel?.arcEvents ?? []).filter((e) => e.kind === 'great').length, offers: ev['covenant.offered'] ?? 0, bows: ev['covenant.bow'] ?? 0, broken: ev['covenant.broken'] ?? 0 },
  events: Object.fromEntries(Object.entries(ev).filter(([k]) => /^(covenant|chronicle\.age|legend|tower\.(begun|confused|choice)|defy)/.test(k))),
}));
