// ARC §8 multi-seed probe (run through _harness/slot.sh). Modes:
//   node _harness/probes/arc.ts unattended <seed> [years=60]   T2 (towers begun, first year, attempts) + T4 (>= 50 % in
//        <= 6 y, omens per tower reaching 75 %, a builder on site in sampled work hours) + M1/M2 on the side.
//        Sandbox (n=20), natural disasters on, 60 plains folk at the bronze age, no god acts.
//   node _harness/probes/arc.ts attended <seed> [years=20]     T2 attended pacing: as unattended, plus a gentle god that
//        answers every open prayer once a day (prayer.answer); wants the first tower in years 7-14 on >= 3/8.
//   node _harness/probes/arc.ts babel <seed> [years=2.2]       T3 (begun <= 30 d, first tower.choice <= 2 y) and T5.
// One JSON line per run, prefixed RESULT.
import { Sim } from '../../src/sim/sim.ts';
import { peekRel } from '../../src/sim/god/regard.ts';
import { distM } from '../../src/sim/people/world.ts';
import { langDistance } from '../../src/sim/people/culture.ts';
import { TASK } from '../../src/sim/people/defs.ts';
import type { TowerState } from '../../src/sim/god/state.ts';

const [mode = 'unattended', seedS = '1', yearsS] = process.argv.slice(2);
const seed = Number(seedS);
const t0ms = Date.now();
const sim = mode === 'babel'
  ? new Sim({ seed, scenario: 'babel', overrides: { n: 20 } })
  : new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
if (mode !== 'babel') {
  const r = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 60, era: 'bronze', settled: true } as never);
  if (!r.ok) throw new Error(r.msg);
}
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
const years = Number(yearsS ?? (mode === 'babel' ? 2.2 : mode === 'attended' ? 20 : 60));
let answered = 0;
const srelP = (await import('../../src/sim/god/regard.ts')).peekRel;
const start = sim.u.tick, end = start + Math.round(years * year);

interface TW { id: number; begun: number; half: number; q75: number; omens: number; status: string; frac: number; samples: number; onSite: number; league: number; lang2y: number }
const tws = new Map<number, TW>();
let choice = -1, heartChanges = 0, townDays = 0, noHeart = 0;
const lastKind = new Map<number, string>();
const evCount: Record<string, number> = {};

function towers(): TowerState[] { return sim.u.god.rel?.towers ?? []; }

while (sim.u.tick < end) {
  sim.step(Math.round(day / 4));
  for (const e of sim.drainEvents()) {
    const t = (e as unknown as { t: string; data?: { tower?: number } }).t;
    if (!t.startsWith('tower.') && !t.startsWith('heart')) continue;
    evCount[t] = (evCount[t] ?? 0) + 1;
    if (t === 'tower.choice' && choice < 0) choice = sim.u.tick;
    if (t === 'tower.omen') { const id = (e as unknown as { data?: { tower?: number } }).data?.tower; const w = id !== undefined ? tws.get(id) : [...tws.values()].at(-1); if (w) w.omens++; }
  }
  for (const tw of towers()) {
    let w = tws.get(tw.id);
    if (!w) { w = { id: tw.id, begun: (sim.u.tick - start) / year, half: -1, q75: -1, omens: 0, status: '', frac: 0, samples: 0, onSite: 0, league: tw.league.length, lang2y: -1 }; tws.set(tw.id, w); }
    w.status = tw.status;
    const f = tw.goal > 0 ? tw.height / tw.goal : 0;
    w.frac = Math.max(w.frac, f);
    if (w.half < 0 && f >= 0.5) w.half = (sim.u.tick - start) / year - w.begun;
    if (w.q75 < 0 && f >= 0.75) w.q75 = (sim.u.tick - start) / year - w.begun;
    if (w.lang2y < 0 && tw.status === 'rising' && (sim.u.tick - start) / year - w.begun >= 2) {
      const lg = tw.league.map((id) => ps.settlement(id)!).filter(Boolean);
      let m = 0; for (const a of lg) for (const b of lg) if (a.id < b.id) m = Math.max(m, langDistance(a, b));
      w.lang2y = m;
    }
    // a work hour (local mid-morning to mid-afternoon at the site): a real builder within 150 m on TASK.build
    const hr = ((sim.u.tick % day) / day) * 24;
    if (tw.status === 'rising' && hr > 9 && hr < 16) {
      w.samples++;
      let on = false;
      const P = [0, 0, 0];
      for (const sid of tw.league) for (const s of ps.members.get(sid) ?? []) {
        if (A.task[s] !== TASK.build) continue;
        A.posAt(s, sim.u.tick, P);
        if (distM(p, P, tw.pos) < 150) { on = true; break; }
      }
      if (on) w.onSite++;
    }
  }
  if ((sim.u.tick - start) % day < day / 4) {
    if (mode === 'attended') for (const st of ps.settlements) {
      if (st.fallen >= 0 || !srelP(sim.u, p.id, st.id)?.prayers.length) continue;
      if (sim.applyNow({ k: 'prayer.answer', settlement: st.id } as never).ok) answered++;
    }
    for (const st of ps.settlements) {
      if (st.fallen >= 0 || st.band) continue;
      townDays++;
      const h = peekRel(sim.u, p.id, st.id)?.hearts;
      if (!h) { noHeart++; continue; }
      const k = lastKind.get(st.id);
      if (k !== undefined && k !== h.kind) heartChanges++;
      lastKind.set(st.id, h.kind);
    }
  }
}
const list = [...tws.values()];
const towns = ps.settlements.filter((s) => s.fallen < 0 && !s.band);
const prides = towns.map((s) => Math.round((peekRel(sim.u, p.id, s.id)?.pride ?? 0) * 100) / 100);
console.log('RESULT ' + JSON.stringify({
  mode, seed, years, secs: Math.round((Date.now() - t0ms) / 1000), towns: towns.length, prides,
  towers: list.length, answered, firstYear: list.length ? Math.round(list[0].begun * 10) / 10 : null,
  choiceYear: choice >= 0 ? Math.round(((choice - start) / year) * 100) / 100 : null,
  detail: list.map((w) => ({ ...w, begun: Math.round(w.begun * 10) / 10, frac: Math.round(w.frac * 100) / 100, onSitePct: w.samples ? Math.round((100 * w.onSite) / w.samples) : null })),
  events: evCount, heartChangesPerTownDay: townDays ? Math.round((heartChanges / townDays) * 1000) / 1000 : 0, noHeart,
}));
