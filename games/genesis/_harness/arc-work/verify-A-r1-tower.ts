// ARC verifier (sim, stage A r1): the god's answers to a tower on the babel scenario, one seed per run (read-only for src).
//   node _harness/arc-work/verify-A-r1-tower.ts <answer> <seed>   (none = the confuse timeline without the answer: baseline deaths)
//   answer: confuse | let | warn | silence | strike
// Rises until the first tower.choice (cap 2.5 y), answers, then measures §8.2 T6/T7/T8/T9 consequences right after, 30 days
// on, and whether they last (5 y on; for let/silence until finished + 3 y, then strike or confuse the standing tower).
import { Sim } from '../../src/sim/sim.ts';
import { peekRel } from '../../src/sim/god/regard.ts';
import { langDistance, styleVariant } from '../../src/sim/people/culture.ts';
import type { TowerState } from '../../src/sim/god/state.ts';

const [answer = 'confuse', seedS = '1'] = process.argv.slice(2);
const seed = Number(seedS);
const t0ms = Date.now();
function mk() { return new Sim({ seed, scenario: 'babel', overrides: { n: 20 } }); }
const sim = mk();
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
const tw = (): TowerState | undefined => sim.u.god.rel?.towers?.at(-1);
const ev: Record<string, number> = {};
const deaths: Record<string, number> = {};
const lines: string[] = [];
let choiceAt = -1;
function drain() {
  for (const e of sim.drainEvents() as unknown as { t: string; a?: number; text?: string; data?: Record<string, unknown> }[]) {
    if (e.t.startsWith('tower') || e.t.startsWith('heart') || e.t === 'found' || e.t === 'settlement.founded') ev[e.t] = (ev[e.t] ?? 0) + 1;
    if (e.t === 'death') deaths[String(e.data?.cause)] = (deaths[String(e.data?.cause)] ?? 0) + 1;
    if (e.t === 'tower.choice' && choiceAt < 0) choiceAt = sim.u.tick;
    if (e.t === 'chronicle' || e.t === 'tell') { const s = String((e as { text?: string }).text ?? ''); if (/tower|tongue|understand|builders/i.test(s)) lines.push(s); }
  }
}
const r2 = (v: number) => Math.round(v * 100) / 100;
function snapTowns(ids: number[]) {
  return ids.map((id) => {
    const st = ps.settlement(id)!;
    const r = peekRel(sim.u, p.id, id);
    return { id, name: st.name, fallen: st.fallen >= 0, pop: (ps.members.get(id) ?? []).length, hh: st.households.filter((h) => h.members.length).length,
      polity: st.polity, langSeed: st.langSeed, line0: st.langLine[0], lineLen: st.langLine.length, style: styleVariant(st),
      pride: r2(r?.pride ?? 0), means: (r?.means ?? []).map(r2), defiance: r2(r?.defiance ?? 0), mem: r?.memory, heart: r?.hearts?.kind,
      griev: r2((st as unknown as { hist?: { grievance: number; why: Record<string, number> } }).hist?.grievance ?? -1),
      tongue: r2((st as unknown as { hist?: { why: Record<string, number> } }).hist?.why?.tongue ?? 0) };
  });
}
function pairs(ids: number[]) {
  const out: number[] = [];
  for (const a of ids) for (const b of ids) if (a < b) { const A1 = ps.settlement(a), B1 = ps.settlement(b); if (A1 && B1) out.push(r2(langDistance(A1, B1))); }
  return out;
}
function rels(ids: number[]) {
  const out: (number[] | null)[] = [];
  for (const a of ids) for (const b of ids) if (a < b) {
    const pa = ps.settlement(a)!.polity, pb = ps.settlement(b)!.polity;
    if (pa === pb) { out.push(null); continue; }
    const rel = ps.relation(Math.min(pa, pb), Math.max(pa, pb));
    out.push(rel ? rel.op.map(r2) : [-9]);
  }
  return out;
}
function run(ticks: number) { const end = sim.u.tick + ticks; while (sim.u.tick < end) { sim.step(Math.min(60, end - sim.u.tick)); drain(); } }

// rise to the first choice
const cap = sim.u.tick + Math.round(2.5 * year);
while (sim.u.tick < cap && choiceAt < 0) { sim.step(60); drain(); }
const t = tw();
if (!t) { console.log('RESULT ' + JSON.stringify({ answer, seed, err: 'no tower' })); process.exit(0); }
const league0 = t.league.slice();
const settle0 = ps.settlements.filter((s) => s.fallen < 0).length;
const out: Record<string, unknown> = { answer, seed, choiceY: choiceAt >= 0 ? r2((choiceAt - (t.begun)) / year) : null, h0: r2(t.height), goal: t.goal, league: league0.length,
  before: { towns: snapTowns(league0), lang: pairs(league0), rels: rels(league0), settlements: settle0 } };
const polities0 = new Set(ps.settlements.filter((s) => s.fallen < 0).map((s) => s.polity)).size;
for (const k of Object.keys(deaths)) delete deaths[k];

function answerNow(k: string, extra: Record<string, unknown> = {}) {
  const r = sim.applyNow({ k, ...extra } as never) as { ok: boolean; msg?: string };
  drain();
  return { ok: r.ok, msg: r.msg };
}

if (answer === 'warn') {
  const host = ps.settlement(t.host)!;
  const ms = (ps.members.get(host.id) ?? []).filter((s) => !(A.flags[s] & 1));
  let called: unknown = null;
  for (const s of ms) { const r = sim.applyNow({ k: 'prophet.call', agent: A.id[s] } as never) as { ok: boolean; msg?: string }; if (r.ok) { called = A.id[s]; break; } }
  out.prophet = called;
  out.cmd = answerNow('tower.warn');
  run(6 * day + 60);
  out.warned = t.warned; out.status6d = t.status;
  out.after6d = { towns: snapTowns(league0) };
  out.sacred = sim.u.god.rel?.places?.filter((q) => q.by === 'prophet').length ?? null;
  // reproduce: same seed, same moment, same prophet -> same heed outcome
  const s2 = mk(); const p2 = s2.u.planets[0];
  while (s2.u.tick < sim.u.tick - (6 * day + 60) - 1) s2.step(Math.min(60, sim.u.tick - (6 * day + 60) - s2.u.tick));
  s2.drainEvents();
  out.reproTick = [s2.u.tick, sim.u.tick - (6 * day + 60)];
  if (called !== null) s2.applyNow({ k: 'prophet.call', agent: called } as never);
  s2.applyNow({ k: 'tower.warn' } as never);
  s2.step(6 * day + 60);
  const t2 = s2.u.god.rel?.towers?.at(-1);
  out.repro = t2?.warned ? JSON.stringify(t2.warned.heeded) === JSON.stringify(t.warned?.heeded) && JSON.stringify(t2.warned.refused) === JSON.stringify(t.warned?.refused) : null;
  void p2;
  // a strike after a refusal
  if (t.status === 'rising' && t.warned?.refused.length) {
    const re = answerNow('tower.warn');
    out.rewarnBlocked = re;
    out.strikeAfterRefusal = answerNow('tower.strike');
    out.provoked = league0.map((id) => peekRel(sim.u, p.id, id)?.since.provoked ?? null);
    out.strikeDeaths = { ...deaths };
  }
  run(2 * year);
  out.after2y = { towns: snapTowns(league0), status: t.status };
} else if (answer === 'confuse' || answer === 'none') {
  const ansT = sim.u.tick;
  if (answer === 'confuse') out.cmd = answerNow('tower.confuse');
  out.right = { lang: pairs(league0), towns: snapTowns(league0), rels: rels(league0) };
  run(30 * day);
  const now = ps.settlements.filter((s) => s.fallen < 0);
  out.d30 = { settlements: now.length, newTowns: now.filter((s) => s.founded >= ansT).map((s) => ({ id: s.id, name: s.name, pop: (ps.members.get(s.id) ?? []).length, lang: s.langSeed, kmFrom: null })), towns: snapTowns(league0), lang: pairs(league0), deaths: { ...deaths } };
  run(5 * year);
  out.y5 = { lang: pairs(league0), towns: snapTowns(league0), rels: rels(league0), status: t.status, towers: sim.u.god.rel?.towers?.length, settlements: ps.settlements.filter((s) => s.fallen < 0).length };
} else if (answer === 'strike') {
  out.cmd = answerNow('tower.strike');
  out.right = { towns: snapTowns(league0), h: t.height, deaths: { ...deaths } };
  run(5 * year);
  out.y5 = { towns: snapTowns(league0), towers: sim.u.god.rel?.towers?.map((q) => [q.status, q.rebuildOf ?? null, r2((q.begun - t.ended) / year)]), building: !!ps.building(t.building) };
} else {
  // let / silence
  if (answer === 'let') out.cmd = answerNow('tower.let');
  out.right = { towns: snapTowns(league0) };
  const capF = sim.u.tick + 10 * year;
  while (sim.u.tick < capF && t.status === 'rising') run(day);
  out.finishedY = r2((sim.u.tick - t.begun) / year);
  out.statusF = t.status; out.answerF = t.answer; out.hF = t.height;
  out.atFinish = { towns: snapTowns(league0), rels: rels(league0), polities: new Set(ps.settlements.filter((s) => s.fallen < 0).map((s) => s.polity)).size, polities0 };
  run(3 * year);
  out.y3 = { towns: snapTowns(league0), polities: new Set(ps.settlements.filter((s) => s.fallen < 0).map((s) => s.polity)).size, godActs: (sim.u.god.rel as unknown as { godActs?: unknown })?.godActs };
  out.late = seed % 2 ? answerNow('tower.strike') : answerNow('tower.confuse');
  out.lateStatus = t.status;
  out.lateLang = pairs(league0);
}
out.events = ev; out.deathsTotal = deaths; out.lines = lines.slice(0, 12); out.secs = Math.round((Date.now() - t0ms) / 1000);
out.arcEvents = (sim.u.god.rel as unknown as { arcEvents?: { kind: string; name: string }[] })?.arcEvents?.map((e) => `${e.kind}:${e.name}`);
console.log('RESULT ' + JSON.stringify(out));
