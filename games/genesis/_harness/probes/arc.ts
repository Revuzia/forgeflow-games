// ARC §8 multi-seed probe (run through _harness/slot.sh). Modes:
//   node _harness/probes/arc.ts unattended <seed> [years=60]   T2 (towers begun, first year, attempts) + T4 (>= 50 % in
//        <= 6 y, omens per tower reaching 75 %, a builder on site in sampled work hours) + M1/M2 on the side.
//        Sandbox (n=20), natural disasters on, 60 plains folk at the bronze age, no god acts.
//   node _harness/probes/arc.ts attended <seed> [years=20]     T2 attended pacing: as unattended, plus a gentle god that
//        answers every open prayer once a day (prayer.answer); wants the first tower in years 7-14 on >= 3/8.
//   node _harness/probes/arc.ts babel <seed> [years=2.2]       T3 (begun <= 30 d, first tower.choice <= 2 y) and T5.
//   node _harness/probes/arc.ts harsh <seed> [years=3]         D2 (stage B): an unprovoked storm (+ a bolt with HARSH_BOLT=1) at wrath 0.3 on
//        the first town every 4 months (§8.1 M3 harsh): defy acts per kind (hurl on >= 4/8), defiance max.
//   node _harness/probes/arc.ts dmercy|dwrath <seed> [years=27] D5 (lead ruling 2026-11-09): a year of harsh storms (trust <
//        0.3), defiance.set 0.6 at year 1, every defiant act answered with mercy (dmercy) or wrath (dwrath) through year
//        26, then the SAME provocation in both arms (the harsh protocol for a year, no answers): the descendants' mean
//        defiance / fear (end of it and its mean), their acts, and what they remember in words (remember, answered).
// Every mode also reports the stage B tallies: defy events per kind, defiant town-years share, burns.
// One JSON line per run, prefixed RESULT.
import { Sim } from '../../src/sim/sim.ts';
import { peekRel } from '../../src/sim/god/regard.ts';
import { distM } from '../../src/sim/people/world.ts';
import { langDistance } from '../../src/sim/people/culture.ts';
import { TASK } from '../../src/sim/people/defs.ts';
import { sunElevation } from '../../src/sim/people/world.ts';
import type { TowerState } from '../../src/sim/god/state.ts';
import { heartView } from '../../src/sim/god/arc.ts';
import { answeredWords } from '../../src/sim/god/defiance.ts';

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
const years = Number(yearsS ?? (mode === 'babel' ? 2.2 : mode === 'attended' ? 20 : mode === 'harsh' ? 3 : mode === 'dmercy' || mode === 'dwrath' ? 27 : 60));
const pair = mode === 'dmercy' || mode === 'dwrath';
const harshUntil = mode === 'harsh' ? Infinity : pair ? 1 : -1;
const provoke = pair ? years - 1 : Infinity;
const provT = { def: 0, fear: 0, n: 0, acts: 0 };
const defy: Record<string, number> = {};
let defiantDays = 0, defMax = 0, answersGiven = 0, nextHarsh = 0, defySet = false;
let def25 = -1, newborn10 = -1, mem: unknown = null;
const firstTown = ps.settlements.find((s) => !s.band && s.fallen < 0);
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
  const yr = (sim.u.tick - start) / year;
  const target = firstTown && firstTown.fallen < 0 ? firstTown : ps.settlements.filter((s) => s.fallen < 0 && !s.band).sort((a, b) => (ps.members.get(b.id)?.length ?? 0) - (ps.members.get(a.id)?.length ?? 0) || a.id - b.id)[0];
  if (target && (yr < harshUntil || yr >= provoke) && sim.u.tick >= nextHarsh) {
    nextHarsh = sim.u.tick + Math.round(year / 3);
    sim.applyNow({ k: 'miracle.storm', pos: [...target.pos], radius: 350, wrath: 0.3 } as never);
    if (process.env.HARSH_BOLT) sim.applyNow({ k: 'miracle.lightning', pos: [...target.pos], wrath: 0.3 } as never);
  }
  if ((mode === 'dmercy' || mode === 'dwrath') && firstTown && !defySet && yr >= 1) {
    defySet = true;
    if (firstTown.fallen < 0) sim.applyNow({ k: 'defiance.set', settlement: firstTown.id, value: 0.6 } as never);
  }
  if ((mode === 'dmercy' || mode === 'dwrath') && def25 < 0 && yr >= 25) {
    const live = ps.settlements.filter((s) => s.fallen < 0 && !s.band);
    def25 = live.length ? Math.round(1000 * live.reduce((a, s) => a + (peekRel(sim.u, p.id, s.id)?.defiance ?? 0), 0) / live.length) / 1000 : 0;
  }
  if ((mode === 'dmercy' || mode === 'dwrath') && newborn10 < 0 && yr >= 11) {
    let t = 0, n = 0;
    for (let s = 0; s < A.hi; s++) if (A.alive[s] && A.birth[s] > start + year) { t += A.love[s * 4]; n++; }
    newborn10 = n ? Math.round(1000 * t / n) / 1000 : -1;
    mem = firstTown ? peekRel(sim.u, p.id, firstTown.id)?.memory ?? null : null;
  }
  for (const e of sim.drainEvents()) {
    const t = (e as unknown as { t: string; data?: { tower?: number } }).t;
    if (t === 'defy') {
      const d = (e as unknown as { data: { kind: string; settlement: number } }).data;
      defy[d.kind] = (defy[d.kind] ?? 0) + 1;
      if (pair && yr >= provoke) provT.acts++;
      if (pair && yr < provoke) {
        const r = sim.applyNow({ k: 'defiance.answer', settlement: d.settlement, how: mode === 'dmercy' ? 'mercy' : 'wrath' } as never);
        if (r.ok) answersGiven++;
      }
    }
    if (t === 'defy.answered') { const h = (e as unknown as { data: { how: string } }).data.how; defy[`ans.${h}`] = (defy[`ans.${h}`] ?? 0) + 1; }
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
    // a work hour (the sun well up at the site: local mid-morning to mid-afternoon; stint 5 -- the old test used the
    // planet clock, which is night at a site on the far side): a real builder within 150 m on TASK.build
    if (tw.status === 'rising' && sunElevation(sim.u, p, sim.u.tick, tw.pos) > 0.35) {
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
      const rr = peekRel(sim.u, p.id, st.id);
      const h = rr?.hearts;
      if (!h) { noHeart++; continue; }
      if (h.kind === 'defiant') defiantDays++;
      if (pair && yr >= provoke) { provT.def += rr?.defiance ?? 0; provT.fear += rr?.means[1] ?? 0; provT.n++; }
      defMax = Math.max(defMax, rr?.defiance ?? 0);
      const k = lastKind.get(st.id);
      if (k !== undefined && k !== h.kind) heartChanges++;
      lastKind.set(st.id, h.kind);
    }
  }
}
function provOut(): Record<string, unknown> {
  const live = ps.settlements.filter((s) => s.fallen < 0 && !s.band);
  const avg = (f: (r: NonNullable<ReturnType<typeof peekRel>>) => number) => live.length ? Math.round(1000 * live.reduce((a, s) => a + f(peekRel(sim.u, p.id, s.id)!), 0) / live.length) / 1000 : 0;
  return { prov: { defEnd: avg((r) => r.defiance ?? 0), fearEnd: avg((r) => r.means[1]), defMean: provT.n ? Math.round(1000 * provT.def / provT.n) / 1000 : 0,
    fearMean: provT.n ? Math.round(1000 * provT.fear / provT.n) / 1000 : 0, acts: provT.acts,
    remember: live.map((s) => heartView(peekRel(sim.u, p.id, s.id), s)?.remember ?? []), answered: live.map((s) => answeredWords(peekRel(sim.u, p.id, s.id))) } };
}
const list = [...tws.values()];
const towns = ps.settlements.filter((s) => s.fallen < 0 && !s.band);
const prides = towns.map((s) => Math.round((peekRel(sim.u, p.id, s.id)?.pride ?? 0) * 100) / 100);
console.log('RESULT ' + JSON.stringify({
  mode, seed, years, secs: Math.round((Date.now() - t0ms) / 1000), towns: towns.length, prides,
  towers: list.length, answered, firstYear: list.length ? Math.round(list[0].begun * 10) / 10 : null,
  choiceYear: choice >= 0 ? Math.round(((choice - start) / year) * 100) / 100 : null,
  detail: list.map((w) => ({ ...w, begun: Math.round(w.begun * 10) / 10, frac: Math.round(w.frac * 100) / 100, onSitePct: w.samples ? Math.round((100 * w.onSite) / w.samples) : null })),
  defy, defiantTownYearShare: townDays ? Math.round((defiantDays / townDays) * 1000) / 1000 : 0, defMax: Math.round(defMax * 1000) / 1000,
  answersGiven, def25, newborn10, mem,
  ...(pair ? provOut() : {}),
  events: evCount, heartChangesPerTownDay: townDays ? Math.round((heartChanges / townDays) * 1000) / 1000 : 0, noHeart,
}));
