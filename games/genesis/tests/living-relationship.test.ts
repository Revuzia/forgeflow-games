// GENESIS — LIVING RELATIONSHIP (LIVING.md §3): the god and the people without a creature. Four values per person and god
// (faith, fear, trust, loyalty) that acts move within a budget; prayers raised by real hardship and answered by the fitting
// act; prophets who speak for the god, gain or lose credibility by what it makes true, and are persecuted by disloyal
// rulers; omens read by the town (and its prophet); sacred places and real sacred animals; wrath as a law (survivable by
// default) with warnings and evacuations; shelter from storms; and the restyle (the Touch, sigils, the Called, rival
// epithets, regard everywhere the UI looks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, twoTowns, must, standing } from './helpers/god.ts';
import { world as pworld, people as ppeople } from './helpers/peoples.ts';
import { GODS, TASK } from '../src/sim/people/defs.ts';
import { AgentFlag, AgentFlag2 } from '../src/sim/types.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { distM } from '../src/sim/people/world.ts';
import { sacredAnimal } from '../src/sim/people/culture.ts';
import { lethality, reach } from '../src/sim/god/wrath.ts';
import { spawnDisaster, AIRBURST_W } from '../src/sim/god/disasters.ts';
import { hurtPeople, onRoad } from '../src/sim/god/harm.ts';
import { PRAYER_KINDS } from '../src/sim/god/prayers.ts';
import { srel } from '../src/sim/god/regard.ts';
import { OMEN_KINDS } from '../src/sim/god/omens.ts';
import { landOf } from '../src/sim/people/ledger.ts';
import type { Settlement } from '../src/sim/people/state.ts';

type S = Sim;

/** a settlement's mean faith, fear, trust and loyalty toward the player god */
function means(sim: S, sid: number): { faith: number; fear: number; trust: number; loyalty: number; n: number } {
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  const m = ps.members.get(sid) ?? [];
  let f = 0, e = 0, t = 0, l = 0;
  for (const s of m) { const i = s * GODS; f += A.faith[i]; e += A.fear[i]; t += A.love[i]; l += A.loyalty[i]; }
  const n = Math.max(1, m.length);
  return { faith: f / n, fear: e / n, trust: t / n, loyalty: l / n, n: m.length };
}

/** a grown member of the town who is not its ruler */
function commoner(sim: S, st: Settlement, skip: number[] = []): number {
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  const s = (ps.members.get(st.id) ?? []).find((q) => !(A.flags[q] & 1) && A.id[q] !== st.leader && !skip.includes(A.id[q]) && (sim.u.tick - A.birth[q]) / sim.u.planets[0].st.orbit.period >= 18);
  assert.ok(s !== undefined, 'a grown commoner');
  return A.id[s];
}

/** empty the town's food stores (the larder only: what people carry stays) */
function starve(sim: S, st: Settlement): void {
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  for (const it of x.info[st.species].foods) st.store[it] = 0;
}

const rel = (sim: S) => sim.u.god.rel!;
const srelOf = (sim: S, sid: number) => rel(sim).st[`0:${sid}`];

// ───────────────────────────── the four values and acts ─────────────────────────────

test('relationship: faith and loyalty are saved per person and god; a killing storm frightens and never raises trust; mercy raises trust within the budget', () => {
  const { sim, st } = town();
  const A = sim.u.planets[0].people.agents;
  assert.ok(A.faith instanceof Float32Array && A.loyalty instanceof Float32Array, 'faith and loyalty columns');
  assert.equal(A.faith.length, A.cap * GODS);
  const bytes = sim.save();
  // a tornado on the town: fear, never trust (baseline: love 0.08 → 0.85)
  const a = Sim.load(bytes);
  const m0 = means(a, st.id);
  must(a, { k: 'disaster.spawn', kind: 'tornado', pos: st.pos });
  a.step(1440);
  const m1 = means(a, st.id);
  assert.ok(m1.trust <= m0.trust + 0.005, `trust ${m0.trust.toFixed(3)} → ${m1.trust.toFixed(3)} after a killing storm`);
  assert.ok(m1.fear >= m0.fear + 0.05, `fear ${m0.fear.toFixed(3)} → ${m1.fear.toFixed(3)}`);
  assert.ok(m1.fear - m0.fear <= 0.4, `one act moves fear by at most the budget (0.35 + a day's witnessing): ${(m1.fear - m0.fear).toFixed(3)}`);
  const acts = srelOf(a, st.id).acts;
  assert.ok(acts.some((r) => r.kind === 'harm'), `the town remembers the act as harm: ${JSON.stringify(acts.map((r) => r.kind))}`);
  // plenty: trust, not fear (and within the budget: no pinned meter)
  const b = Sim.load(bytes);
  const n0 = means(b, st.id);
  must(b, { k: 'miracle.food', pos: st.pos });
  b.step(1440);
  const n1 = means(b, st.id);
  assert.ok(n1.trust >= n0.trust + 0.05, `trust ${n0.trust.toFixed(3)} → ${n1.trust.toFixed(3)} after plenty`);
  assert.ok(n1.trust - n0.trust <= 0.36, `within the act budget: ${(n1.trust - n0.trust).toFixed(3)}`);
  assert.ok(n1.fear <= n0.fear + 0.01, 'plenty frightens nobody');
  assert.ok(n1.faith > n0.faith, 'and it is believed');
  // the regard: trust − fear over the believers, in the snapshot and the query
  const snap = b.snapshot({ drain: false });
  assert.equal(typeof snap.regard, 'number');
  assert.equal(snap.wrath, 0.3);
  const v = snap.planets[0].settlements!.find((q) => q.id === st.id)!;
  assert.ok(v.regard && Math.abs(v.regard.trust - n1.trust) < 0.002, 'SettlementView.regard');
  const q = b.query('regard') as { regard: number; band: string };
  assert.equal(q.regard, snap.regard);
  assert.ok(['feared', 'awed', 'trusted'].includes(q.band));
});

test('relationship: a natural storm is the god\'s only to those who believe it acts', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const m = p.people.members.get(st.id) ?? [];
  // half the town believes the god acts (faith 0.8), half does not (0.1)
  m.forEach((s, k) => { A.faith[s * GODS] = k % 2 ? 0.8 : 0.1; A.fear[s * GODS] = 0.05; });
  const believers = m.filter((_s, k) => k % 2).map((s) => A.id[s]);
  const others = m.filter((_s, k) => !(k % 2)).map((s) => A.id[s]);
  const d = spawnDisaster(sim.u, p, 'tornado', { pos: [st.pos[0], st.pos[1], st.pos[2]], god: -1, cause: 'nature' });
  assert.equal(typeof d, 'object');
  sim.step(360);
  const fearOf = (ids: number[]) => { const xs = ids.map((id) => A.slotOf(id)).filter((s) => s >= 0); return xs.reduce((a, s) => a + A.fear[s * GODS], 0) / Math.max(1, xs.length); };
  assert.ok(fearOf(others) < 0.1, `the unbelieving fear nature, not the god: ${fearOf(others).toFixed(3)}`);
  assert.ok(fearOf(believers) > fearOf(others) + 0.05, `believers read it as the god's: ${fearOf(believers).toFixed(3)} vs ${fearOf(others).toFixed(3)}`);
  assert.ok(!sim.u.chronicle.some((e) => /the god/i.test(e.text) && /tornado/i.test(e.text) && /killed/i.test(e.text)), 'the chronicle does not blame the god for nature');
});

// ───────────────────────────── prayers ─────────────────────────────

test('prayers: hunger raises a prayer for food, plenty answers it, prayer.answer answers it, and unanswered it lapses', () => {
  const { sim, st } = town();
  starve(sim, st);
  sim.step(120);
  const r = srelOf(sim, st.id);
  assert.ok(r && r.prayers.some((q) => q.kind === 'food'), `a prayer for food: ${JSON.stringify(r?.prayers)}`);
  const view = sim.snapshot({ drain: false }).planets[0].settlements!.find((q) => q.id === st.id)!;
  assert.ok(view.prayers?.some((q) => q.kind === 'food'), 'SettlementView.prayers');
  assert.ok((sim.query('prayers') as { settlement: number; prayers: { kind: string }[] }[]).some((q) => q.settlement === st.id && q.prayers.some((r) => r.kind === 'food')), 'query prayers');
  const bytes = sim.save();
  // plenty answers it: the prayer closes, trust and faith rise more than for an unasked gift
  const a = Sim.load(bytes);
  const m0 = means(a, st.id);
  must(a, { k: 'miracle.food', pos: st.pos });
  assert.ok(!srelOf(a, st.id).prayers.some((q) => q.kind === 'food'), 'answered');
  assert.ok((rel(a).stats['prayers.answered'] ?? 0) >= 1);
  a.step(60);
  assert.ok(means(a, st.id).trust > m0.trust + 0.05, 'an answered prayer is trusted');
  assert.ok(a.u.chronicle.some((e) => /the god heard|prayed for .*, and the god answered/i.test(e.text) && e.text.includes(st.name)), 'the chronicle tells of it');
  // the god answers by command (the UI's answer button): the canonical act for the prayer
  const b = Sim.load(bytes);
  const res = b.applyNow({ k: 'prayer.answer', settlement: st.id });
  assert.ok(res.ok, res.msg);
  assert.ok(!srelOf(b, st.id).prayers.some((q) => q.kind === 'food'));
  // unanswered: it lapses at its window's end, and the town trusts a little less
  const c = Sim.load(bytes);
  const pr = srelOf(c, st.id).prayers.find((q) => q.kind === 'food')!;
  pr.until = c.u.tick + 30;
  const t0 = means(c, st.id).trust;
  c.step(120);
  assert.equal(srelOf(c, st.id).lapses, 1, 'one lapsed prayer');
  assert.ok(!srelOf(c, st.id).prayers.some((q) => q.id === pr.id));
  assert.ok(means(c, st.id).trust < t0 + 1e-6, 'a deaf god is trusted less');
});

test('prayers: the god can answer every kind of prayer by command', () => {
  const { sim, st } = town();
  const bytes = sim.save();
  for (const kind of PRAYER_KINDS) {
    const a = Sim.load(bytes);
    const r = srel(a.u, 0, st.id);
    r.prayers.push({ id: 900, kind, since: a.u.tick, until: a.u.tick + 1440, urgency: 1, god: 0 });
    a.u.planets[0].people.worship[0] = 1000;
    const res = a.applyNow({ k: 'prayer.answer', settlement: st.id });
    assert.ok(res.ok, `${kind}: ${res.msg}`);
    assert.ok(!srelOf(a, st.id).prayers.some((q) => q.id === 900), `${kind}: answered`);
  }
});

test('prayers: hardship brings people to pray, and prayer and worship pay the god', () => {
  const { sim, st } = town();
  const A = sim.u.planets[0].people.agents;
  const w0 = { ...rel(sim).stats };
  must(sim, { k: 'disaster.spawn', kind: 'tornado', pos: st.pos });
  let n = 0, pray = 0;
  for (let k = 0; k < 108; k++) {
    sim.step(20);
    for (const s of sim.u.planets[0].people.members.get(st.id) ?? []) { n++; if (A.task[s] === TASK.pray || A.task[s] === TASK.worship) pray++; }
  }
  assert.ok(pray / n >= 0.08, `praying or worshipping after the storm: ${(pray / n).toFixed(3)} of person-samples (baseline 0.002)`);
  const gained = (k: string) => (rel(sim).stats[k] ?? 0) - (w0[k] ?? 0);
  assert.ok(gained('worship.pray') + gained('worship.worship') > 0, 'prayer and worship yield worship');
});

test('a feast is kept in the god\'s name where the town trusts it, and not where it does not', () => {
  const { sim, st } = town();
  const bytes = sim.save();
  const run = (trust: number) => {
    const a = Sim.load(bytes);
    const t = a.u.planets[0].people.settlement(st.id)!;
    const A = a.u.planets[0].people.agents;
    for (const s of a.u.planets[0].people.members.get(st.id) ?? []) A.love[s * GODS] = trust;
    landOf(t).gatherings.push({ kind: 'harvest', from: a.u.tick, until: a.u.tick + 210, cell: t.cell, pos: [t.pos[0], t.pos[1], t.pos[2]], about: [], came: [] });
    const f0 = means(a, st.id);
    a.step(90);
    return { feasts: a.u.god.rel?.stats['feasts'] ?? 0, dFaith: means(a, st.id).faith - f0.faith, told: a.u.chronicle.some((e) => /in the god's name|first cup for the god/.test(e.text)) };
  };
  const trusted = run(0.8);
  assert.equal(trusted.feasts, 1);
  assert.ok(trusted.told, 'chronicled');
  assert.ok(trusted.dFaith > 0.02, `faith +${trusted.dFaith.toFixed(3)}`);
  assert.equal(run(0.2).feasts, 0, 'no feast for a god they do not trust');
});

// ───────────────────────────── prophets ─────────────────────────────

test('prophets: called, a prophecy made true raises credibility, one that fails lowers it; one voice to a town', () => {
  const { sim, st } = town();
  const who = commoner(sim, st);
  const r = sim.applyNow({ k: 'prophet.call', agent: who });
  assert.ok(r.ok, r.msg);
  const ph = rel(sim).prophets.find((q) => q.agent === who)!;
  assert.ok(ph && ph.credibility >= 0.3, 'a called prophet starts at 0.3 (0.45 with a sign)');
  const second = sim.applyNow({ k: 'prophet.call', agent: commoner(sim, st, [who]) });
  assert.equal(second.ok, false, 'one prophet to a town');
  assert.match(second.msg ?? '', /already has a prophet/);
  // the views: SettlementView.prophet, flags2.prophet
  const snap = sim.snapshot({ drain: false });
  assert.equal(snap.planets[0].settlements!.find((q) => q.id === st.id)!.prophet?.agent, who);
  const blk = snap.planets[0].agents!;
  const k = Array.from(blk.id).indexOf(who);
  assert.ok(k >= 0 && blk.flags2 && blk.flags2[k] & AgentFlag2.prophet, 'flags2.prophet on the prophet');
  // foretold, then made true
  must(sim, { k: 'prophet.foretell', agent: who, what: 'rain', days: 2 });
  sim.step(60);
  const c0 = ph.credibility;
  must(sim, { k: 'miracle.water', pos: st.pos });
  assert.equal(ph.fulfilled, 1);
  assert.ok(ph.credibility > c0 + 0.1, `credibility ${c0} → ${ph.credibility}`);
  assert.ok(sim.u.chronicle.some((e) => /foretold .*, and it came|came as .* had said/i.test(e.text) && e.refs?.some((r) => r.kind === 'agent' && r.id === who)), 'chronicled');
  // foretold, and left untrue
  must(sim, { k: 'prophet.foretell', agent: who, what: 'food', days: 1 });
  const c1 = ph.credibility;
  sim.step(1440 + 120);
  assert.equal(ph.failed, 1);
  assert.ok(ph.credibility < c1 - 0.1, `credibility ${c1} → ${ph.credibility}`);
  // the prophets query
  const q = sim.query('prophets') as { agent: number; credibility: number; name: string }[];
  assert.equal(q[0].agent, who);
  assert.ok(q[0].name.length > 0);
  // abandoned: no prophet left, and the town is told
  must(sim, { k: 'prophet.abandon', agent: who });
  assert.equal(rel(sim).prophets.length, 0);
});

test('prophets: a disloyal ruler persecutes a credible prophet within 10 days', () => {
  const { sim, st } = town();
  const A = sim.u.planets[0].people.agents;
  const who = commoner(sim, st);
  must(sim, { k: 'prophet.call', agent: who });
  must(sim, { k: 'prophet.foretell', agent: who, what: 'rain', days: 2 });
  sim.step(60);
  must(sim, { k: 'miracle.water', pos: st.pos });
  const ph = rel(sim).prophets.find((q) => q.agent === who)!;
  assert.ok(ph.credibility > 0.4, `credible: ${ph.credibility}`);
  let day = -1;
  for (let d = 0; d < 10 && day < 0; d++) {
    // the ruler stays disloyal (the fixture: a rival's man)
    const ruler = A.slotOf(st.leader);
    if (ruler >= 0) A.loyalty[ruler * GODS] = Math.min(A.loyalty[ruler * GODS], 0.1);
    sim.step(1440);
    if ((rel(sim).stats['prophets.persecuted'] ?? 0) > 0) day = d;
  }
  assert.ok(day >= 0, 'persecuted within 10 days');
  assert.ok(ph.persecution >= 1 && (ph.silenced > 0 || ph.settlement !== st.id || !A.alive[A.slotOf(who)] || ph.persecution >= 1));
  assert.ok(sim.u.chronicle.some((e) => /forbade the prophet|drove the prophet|killed the prophet|put the prophet/i.test(e.text) && e.refs?.some((r) => r.kind === 'agent' && r.id === who)), 'the chronicle names the persecution');
});

// ───────────────────────────── omens ─────────────────────────────

test('omens: a rainbow over the town is read (by its prophet), moves faith and trust, and is no omen again for ten days', () => {
  const { sim, st } = town();
  const who = commoner(sim, st);
  must(sim, { k: 'prophet.call', agent: who });
  const m0 = means(sim, st.id);
  const r = sim.applyNow({ k: 'god.omen', settlement: st.id, kind: 'rainbow' });
  assert.ok(r.ok, r.msg);
  const m1 = means(sim, st.id);
  assert.ok(m1.faith > m0.faith + 0.05 && m1.trust > m0.trust + 0.02, `faith ${m0.faith.toFixed(3)} → ${m1.faith.toFixed(3)}, trust ${m0.trust.toFixed(3)} → ${m1.trust.toFixed(3)}`);
  assert.ok(sim.u.planets[0].weather.some((w) => sim.u.content.weather.list[w.kind].id === 'rainbow'), 'a rainbow in the sky');
  assert.ok(srelOf(sim, st.id).acts.some((a) => a.kind === 'omen:rainbow'));
  const ph = rel(sim).prophets[0];
  assert.ok(ph.readAt === sim.u.tick, 'the prophet read it');
  assert.ok(sim.u.chronicle.some((e) => e.text.includes('rainbow') && e.text.includes(st.name)));
  assert.ok((sim.query('omens') as { recent: { kind: string }[] }).recent.some((o) => o.kind === 'rainbow'));
  // the same sign again within ten days is no sign
  const m2 = means(sim, st.id);
  must(sim, { k: 'god.omen', settlement: st.id, kind: 'rainbow' });
  assert.ok(Math.abs(means(sim, st.id).faith - m2.faith) < 1e-6, 'a rainbow a day is weather');
  // a sign chosen to fit the world when none is named
  assert.ok(sim.applyNow({ k: 'god.omen', settlement: st.id }).ok);
});

test('omens: every sign spares the town it is sent to — the flood omen rises and falls without taking it (fix r1 #15)', () => {
  // (the flood omen used to be a 200 m flood on the heart: every town it was sent to fell within half a day)
  {
    const { sim, st } = town();
    const p = sim.u.planets[0];
    const n0 = (p.people!.members.get(st.id) ?? []).length;
    const m0 = means(sim, st.id);
    const r = sim.applyNow({ k: 'god.omen', settlement: st.id, kind: 'flood' });
    assert.ok(r.ok, r.msg);
    assert.ok(means(sim, st.id).faith > m0.faith + 0.05, 'the flood is read as a sign: faith rises');
    assert.ok(srelOf(sim, st.id).acts.some((a) => a.kind === 'omen:flood'));
    sim.step(60 * 18);
    assert.ok(st.fallen < 0 && !st.band, `${st.name} still stands`);
    assert.ok((p.people!.members.get(st.id) ?? []).length >= n0, 'nobody left or died of it');
    assert.ok(p.f.water[st.cell] < 0.6, `the heart stays dry (${p.f.water[st.cell].toFixed(2)})`);
    assert.ok(!sim.u.chronicle.some((e) => e.text.includes(`${st.name} fell`)));
  }
  // every other kind: the ones the world allows are made, read, and leave the town standing
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const n0 = (p.people!.members.get(st.id) ?? []).length;
  const made: string[] = [];
  for (const kind of OMEN_KINDS) {
    const m0 = means(sim, st.id);
    const r = sim.applyNow({ k: 'god.omen', settlement: st.id, kind });
    if (!r.ok) continue; // (no rainbow at night, no aurora without a magnetic field)
    made.push(kind);
    assert.ok(means(sim, st.id).faith >= m0.faith, `${kind}: faith does not fall`);
    sim.step(60 * 2);
  }
  sim.step(60 * 12);
  assert.ok(made.length >= 7, `made ${made.join(', ')}`);
  assert.ok(st.fallen < 0 && !st.band, `${st.name} still stands after ${made.join(', ')}`);
  assert.ok((p.people!.members.get(st.id) ?? []).length >= n0 - 1, 'the signs took nobody');
});

test('prophets: a harm foretold and then sent as a disaster comes true — the meteor strikes later than the command (fix r1 #5)', () => {
  // (a disaster kills in its own step, after the command that sent it: the prophecy used to fail as if the god did nothing)
  const { sim, st } = town();
  const who = commoner(sim, st);
  must(sim, { k: 'prophet.call', agent: who });
  must(sim, { k: 'prophet.foretell', agent: who, what: 'harm', days: 2 });
  const c0 = rel(sim).prophets.find((q) => q.agent === who)!.credibility;
  sim.step(360);
  must(sim, { k: 'disaster.spawn', kind: 'meteor', pos: st.pos });
  const ph = () => rel(sim).prophets.find((q) => q.agent === who);
  for (let i = 0; i < 12 && !(ph()?.fulfilled ?? 0); i++) sim.step(120);
  const p = ph();
  assert.ok(p && p.fulfilled >= 1, `fulfilled ${p?.fulfilled} failed ${p?.failed}`);
  assert.ok(p.credibility > c0 && p.credibility > 0.3, `credibility ${c0} → ${p.credibility}`);
  assert.equal(rel(sim).stats?.['prophecies.failed'] ?? 0, 0);
});

test('relationship: a revolt that casts out a Called chief leaves the town to elect one of its own; fear migrants leave as families (fix r1 #1, #2)', () => {
  const sim = pworld(24, 20261008);
  const st = ppeople(sim, 'plains-folk', 30, { era: 'bronze', settled: true });
  const lune = ppeople(sim, 'plains-folk', 30, { era: 'bronze', settled: true });
  sim.step(120);
  const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
  const chief = A.slotOf(st.leader);
  must(sim, { k: 'agent.make-disciple', id: st.leader });
  // a town that fears its god and does not trust it (cast out, not killed: fear ≤ 0.85)
  const set = () => { for (const s of ps.members.get(st.id) ?? []) { const i = s * 4; A.faith[i] = 0.8; A.fear[i] = 0.75; A.love[i] = 0.05; A.loyalty[i] = 0.05; } };
  set();
  const day = Math.round(p.st.dayHours * 60);
  for (let k = 0; k < day + 2 && A.settlement[chief] === st.id; k++) { sim.step(1); if (k % 10 === 0) set(); }
  assert.equal(A.settlement[chief], lune.id, 'the Called chief was driven out to the other town');
  assert.equal(rel(sim).stats?.['revolt.exile'], 1);
  sim.step(day);
  const ls = A.slotOf(st.leader);
  assert.ok(ls >= 0 && A.settlement[ls] === st.id, `${st.name} is led by one of its own (leader ${st.leader})`);
  assert.ok(!(A.flags[chief] & AgentFlag.leader), 'the exile leads nobody');
  // fear migration: fear 0.8, trust 0.1 for three days — the households that leave arrive whole
  const before = new Map(st.households.map((h) => [h.id, h.members.slice()]));
  const set2 = () => { for (const s of ps.members.get(st.id) ?? []) { const i = s * 4; A.fear[i] = 0.8; A.love[i] = 0.1; A.loyalty[i] = 0.5; } };
  for (let k = 0; k < 6 * 24 && !(rel(sim).stats?.['migration.fear']); k++) { set2(); sim.step(60); }
  assert.ok((rel(sim).stats?.['migration.fear'] ?? 0) > 0, 'some households left in fear');
  const came = lune.households.filter((h) => before.has(h.id));
  assert.ok(came.length > 0, 'they came as households (their ids kept)');
  for (const h of came) for (const id of before.get(h.id)!) { const s = A.slotOf(id); if (s >= 0 && !A.mission[s]) assert.ok(h.members.includes(id) && A.settlement[s] === lune.id, `household ${h.id}: ${id} came with them`); }
});

// ───────────────────────────── sacred places and animals ─────────────────────────────

test('sacred: a hallowed place is kept by the nearest town; a real animal made sacred is never hunted there', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const r = sim.applyNow({ k: 'place.sacred', pos: st.pos, kind: 'grove' });
  assert.ok(r.ok, r.msg);
  const pl = rel(sim).places[0];
  assert.equal(pl.settlement, st.id);
  assert.equal(pl.kind, 'grove');
  const x = makeCtx(sim.u, p);
  const deer = x.c.animals.find('deer');
  assert.ok(deer, 'a real animal');
  const s = sim.applyNow({ k: 'settlement.sacred', settlement: st.id, animal: deer!.id });
  assert.ok(s.ok, s.msg);
  const idx = x.c.animals.idx(deer!.id);
  assert.ok(sacredAnimal(x, st, idx), 'hunting it is taboo there');
  const v = sim.snapshot({ drain: false }).planets[0].settlements!.find((q) => q.id === st.id)!;
  assert.equal(v.sacred?.places, 1);
  assert.equal(v.sacred?.animal, deer!.id);
  const q = sim.query('sacred') as { places: unknown[]; animals: { animal: string }[] };
  assert.equal(q.places.length, 1);
  assert.equal(q.animals[0].animal, deer!.id);
  assert.equal(sim.applyNow({ k: 'settlement.sacred', settlement: st.id, animal: 'ice-dragon' }).ok, false, 'no invented animals');
});

// ───────────────────────────── wrath, warnings, evacuation, shelter ─────────────────────────────

test('wrath: a law at 0.3 by default; the meteor at the law leaves the town standing, at wrath 1 it is today\'s ruin', () => {
  assert.equal(lethality(0), 0.1);
  assert.equal(reach(0), 0.6);
  assert.equal(lethality(1), 1);
  assert.equal(reach(1), 1);
  assert.ok(lethality(0.3) > 0.1 && lethality(0.3) < 1 && reach(0.3) > 0.6 && reach(0.3) < 1);
  const { sim, st } = town();
  assert.equal(sim.u.god.laws['god.wrath'], 0.3);
  assert.equal(sim.applyNow({ k: 'set', path: 'god.wrath', value: 2 }).ok, false, 'wrath is 0..1');
  must(sim, { k: 'set', path: 'god.wrath', value: 0.8 });
  assert.equal(sim.u.god.laws['god.wrath'], 0.8);
  assert.equal(sim.snapshot({ drain: false }).wrath, 0.8, 'Snapshot.wrath');
  const { sim: s0 } = town();
  const bytes = s0.save();
  const blow = (w: number | undefined): { killed: number; fallen: boolean } => {
    const a = Sim.load(bytes);
    const ps = a.u.planets[0].people;
    const ids = (ps.members.get(st.id) ?? []).map((s) => ps.agents.id[s]);
    must(a, { k: 'disaster.spawn', kind: 'meteor', pos: st.pos, ...(w === undefined ? {} : { wrath: w }) });
    a.step(720);
    return { killed: ids.filter((id) => ps.agents.slotOf(id) < 0).length / ids.length, fallen: ps.settlement(st.id)!.fallen >= 0 };
  };
  const atLaw = blow(undefined);
  const atOne = blow(1);
  assert.ok(atLaw.killed <= 0.35, `meteor at the law: ${(atLaw.killed * 100).toFixed(0)} % killed (today 100 %)`);
  assert.equal(atLaw.fallen, false, 'the town stands and rebuilds around the crater');
  assert.ok(atOne.killed >= 0.8, `meteor at wrath 1: ${(atOne.killed * 100).toFixed(0)} % killed`);
});

test('wrath: the default meteor bursts in the air — no crater to drown the town, roofs stove in, and of a warned town on the roads a few die; from wrath 0.5 it strikes and digs one', () => {
  // (LIVING §3.9, second pass: the default meteor's 14 m crater filled with water within the hour and drowned the heart of
  // 3 of the 8 acceptance towns, and its warned town, out on the roads, lost nobody — against the §3.7 table's 10–35 %)
  const { sim: s0, st } = town();
  const bytes = s0.save();
  const cast = (w?: number) => {
    const sim = Sim.load(bytes);
    const p = sim.u.planets[0], ps = p.people, A = ps.agents;
    const ids = (ps.members.get(st.id) ?? []).map((s) => A.id[s]);
    const c0 = p.cellAt(st.pos), z0 = p.f.surface[c0];
    const b0 = standing(sim, st.id);
    const r = must(sim, { k: 'disaster.spawn', kind: 'meteor', pos: st.pos, ...(w === undefined ? {} : { wrath: w }) });
    const d = sim.u.god.disasters.find((q) => q.id === r.created![0].id)!;
    const warned = d.st.Wn ?? 0;
    const impacts: Record<string, unknown>[] = [];
    let onRoad = 0;
    for (let t = 0; t < 120; t++) {
      if (sim.u.god.disaster(d.id)) for (const s of ps.members.get(st.id) ?? []) if (A.task[s] === TASK.evacuate) onRoad = Math.max(onRoad, 1);
      sim.step(1);
      for (const e of sim.drainEvents()) if (e.t === 'impact' && (e.data as { kind?: string } | undefined)?.kind === 'meteor') impacts.push(e.data as Record<string, unknown>);
    }
    const killed = ids.filter((id) => A.slotOf(id) < 0).length / ids.length;
    return { killed, dz: p.f.surface[c0] - z0, standing: standing(sim, st.id) / b0, fallen: ps.settlement(st.id)!.fallen >= 0, warned, impacts, onRoad };
  };
  const law = cast();
  assert.ok(law.impacts.length === 1 && law.impacts[0].airburst === 1, `a burst in the air: ${JSON.stringify(law.impacts)}`);
  assert.ok(Math.abs(law.dz) < 0.01, `no crater at the town's heart (${law.dz.toFixed(2)} m)`);
  assert.ok(law.warned + 24 >= 20 && law.onRoad, `seen coming ${law.warned + 24} minutes before the blow, the town out on the roads`);
  assert.ok(law.killed > 0 && law.killed <= 0.35, `of the warned town ${(law.killed * 100).toFixed(0)} % died`);
  assert.ok(law.standing >= 0.6 && law.standing < 1, `roofs stove in, the town standing: ${(law.standing * 100).toFixed(0)} %`);
  assert.equal(law.fallen, false);
  const great = cast(0.6);
  assert.ok(AIRBURST_W <= 0.6 && great.impacts.every((e) => e.airburst === undefined), 'a great meteor strikes the ground');
  assert.ok(great.dz < -5, `and digs a crater (${great.dz.toFixed(1)} m)`);
});

test('wrath: a blast kills one caught on the road with a chance that grows with the blow, at most its cap; those at home take the blow as before', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0], ps = p.people, A = ps.agents;
  const all = (ps.members.get(st.id) ?? []).slice();
  const road = new Set(all.filter((_, i) => i % 2 === 0));
  const ids = all.map((s) => A.id[s]);
  const roadIds = new Set([...road].map((s) => A.id[s]));
  // a flat blow of 0.5 to everyone: past what nobody's body can bear only on the road, and there with certainty
  hurtPeople(sim.u, p, st.pos, 5000, 0.5, undefined, { flat: true, mortal: { k0: 0.1, gain: 100, cap: 1, road } });
  const dead = ids.filter((id) => A.slotOf(id) < 0);
  assert.ok(dead.length === roadIds.size && dead.every((id) => roadIds.has(id)), `the dead are those on the road (${dead.length} of ${roadIds.size})`);
  // without a set: whoever is fleeing now (TASK.evacuate / flee); the cap holds the chance down
  const { sim: s2, st: t2 } = town();
  const p2 = s2.u.planets[0], A2 = p2.people.agents;
  const m2 = (p2.people.members.get(t2.id) ?? []).slice();
  for (const s of m2) A2.task[s] = TASK.evacuate;
  const n0 = m2.length;
  assert.equal(onRoad(p2).size, n0, 'onRoad: everyone fleeing');
  hurtPeople(s2.u, p2, t2.pos, 5000, 0.5, undefined, { flat: true, mortal: { k0: 0.1, gain: 100, cap: 0.25 } });
  const died = m2.filter((s) => !A2.alive[s]).length;
  assert.ok(died >= 1 && died <= Math.ceil(n0 * 0.5), `capped at a quarter: ${died} of ${n0}`);
});

test('warnings: a volcano rumbles for at least 12 hours, the town is ordered out past the danger and the view says so', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const r = sim.applyNow({ k: 'disaster.spawn', kind: 'volcano', pos: st.pos });
  assert.ok(r.ok, r.msg);
  const d = sim.u.god.disasters.find((q) => q.kind === 'volcano')!;
  assert.ok((d.st.Wn ?? 0) >= 720, `a warning of ${d.st.Wn} ticks`);
  const view = sim.snapshot({ drain: false }).planets[0].disasters!.find((q) => q.id === d.id)!;
  assert.equal(view.params?.warning, 1, 'DisasterView.params.warning');
  const ev = srelOf(sim, st.id).evacuate;
  assert.ok(ev && ev.until > sim.u.tick && ev.radius > 0, 'an evacuation order');
  sim.step(480);
  const A = p.people.agents;
  const pt = [0, 0, 0];
  let out = 0, n = 0;
  for (const s of p.people.members.get(st.id) ?? []) { A.posAt(s, sim.u.tick, pt); n++; if (distM(p, pt, ev!.pos) > ev!.radius) out++; }
  assert.ok(out / n >= 0.8, `${out} of ${n} outside the danger radius 8 hours in`);
  assert.ok(sim.u.chronicle.some((e) => /volcano|mountain|smoke|rumbl/i.test(e.text) && e.text.includes(st.name)), 'the warning is chronicled');
});

test('shelter: under a thunderstorm held over the town people go in and outdoor work stops', () => {
  const { sim: s0, st } = town();
  const bytes = s0.save();
  const OUT = new Set<number>([TASK.forage, TASK.chop, TASK.quarry, TASK.fish, TASK.hunt, TASK.farm, TASK.herd, TASK.build, TASK.haul, TASK.wander]);
  const run = (storm: boolean) => {
    const sim = Sim.load(bytes);
    const A = sim.u.planets[0].people.agents;
    if (storm) must(sim, { k: 'weather.paint', kind: 'thunderstorm', pos: st.pos, radius: 800, duration: 1440, intensity: 2, pinned: true });
    let awake = 0, inside = 0, outdoor = 0, shelter = 0;
    for (let k = 0; k < 48; k++) {
      sim.step(10);
      for (const s of sim.u.planets[0].people.members.get(st.id) ?? []) {
        if (A.flags[s] & 1 || A.task[s] === TASK.sleep) continue;
        awake++;
        if (A.inside[s] >= 0 || A.task[s] === TASK.shelter) inside++;
        if (A.task[s] === TASK.shelter) shelter++;
        if (OUT.has(A.task[s])) outdoor++;
      }
    }
    return { inside: inside / awake, outdoor: outdoor / awake, shelter };
  };
  const clear = run(false);
  const storm = run(true);
  assert.ok(storm.shelter > 0, 'the shelter task');
  assert.ok(storm.inside >= 0.5, `inside or sheltering: ${storm.inside.toFixed(3)} (baseline 0.000)`);
  assert.ok(storm.outdoor <= clear.outdoor * 0.4, `outdoor work ${clear.outdoor.toFixed(3)} clear → ${storm.outdoor.toFixed(3)} in the storm`);
});

// ───────────────────────────── the restyle and the words ─────────────────────────────

test('restyle: the Touch, sigils, the Called and rival epithets; regard on the Touch', () => {
  const { sim } = town();
  const powers = sim.u.content.powers.list;
  const name = (cmd: string) => powers.find((pw) => pw.command === cmd)?.name;
  assert.equal(name('hand.grab'), 'Lift');
  assert.equal(name('hand.throw'), 'Hurl');
  assert.equal(name('agent.make-disciple'), 'Call');
  assert.ok(powers.filter((pw) => pw.sigil).length >= 12, 'sigils');
  assert.ok(powers.some((pw) => pw.category === 'Signs' && pw.command === 'prophet.call'));
  const sig = sim.query('sigils') as Record<string, { strokes: string }> | { sigil: string; strokes: string }[];
  assert.ok(JSON.stringify(sig).includes('drop') && JSON.stringify(sig).includes('figure-eight'), 'the sigils query gives the strokes');
  const hand = sim.snapshot({ drain: false }).hand;
  assert.ok(hand && typeof hand.regard === 'number', 'HandView.regard drives the Touch\'s look');
  must(sim, { k: 'rival.add' });
  const rival = sim.u.god.gods.find((g) => g.kind === 'rival')!;
  assert.ok(rival.epithet && rival.epithet.length > 2, `an epithet: ${rival.name} ${rival.epithet}`);
  assert.ok((sim.query('gods') as { title?: string }[]).some((g) => g.title === `${rival.name} ${rival.epithet}`));
  assert.ok(!powers.some((pw) => /black ?& ?white|creature/i.test(`${pw.name} ${pw.desc}`)));
});

test('restyle words: the new names are understood, the old ones still are, and the replies use the new ones', () => {
  const { sim, st, lune, hesh } = twoTowns();
  const OLD = /\b(hand|hands|disciples?|gestures?)\b/i;
  const r = (t: string) => { const x = sim.parse(t); return { x, ks: (x.resolved ?? []).map((c) => c.k), msg: String(x.msg ?? '') }; };
  // the Touch's verbs by their §3.6 names, and the previews named after the powers
  for (const [t, k] of [['rebuke Hesh', 'hand.slap'], ['slap Hesh', 'hand.slap'], ['soothe Hesh', 'hand.stroke'], ['lift Hesh', 'hand.grab'], ['grab Hesh', 'hand.grab'], ['shield Aru', 'miracle.shield']] as const) {
    const a = r(t);
    assert.ok(a.x.ok && a.ks.includes(k), `${t}: ${a.ks} ${a.msg}`);
    assert.ok(!OLD.test(a.msg) && !/→ (grab|slap|stroke|throw)\b|shield miracle/.test(a.msg), `${t} previews the new name: ${a.msg}`);
  }
  // "call Hesh" is a Call; "call Aru Lune" is still a rename
  assert.ok(r('call Hesh').x.resolved?.some((c) => c.k === 'agent.make-disciple' && c.id === hesh), r('call Hesh').msg);
  assert.ok(!r('call Aru Lune').ks.includes('agent.make-disciple'), r('call Aru Lune').msg);
  // orders to the Called: none yet → a reply in the new words
  const none = r('charge the Called to preach');
  assert.ok(/None are Called yet/.test(none.msg) && !OLD.test(none.msg), none.msg);
  assert.ok(!OLD.test(r('order my disciples to preach').msg), 'the old words get the new reply');
  must(sim, { k: 'agent.make-disciple', id: hesh });
  const mem = (sim.query('agent', { id: hesh }) as { memories?: { text: string }[] }).memories ?? [];
  assert.ok(mem.some((m) => m.text === 'was Called by the god') && !mem.some((m) => OLD.test(m.text)), JSON.stringify(mem));
  for (const [t, mode] of [['charge the Called to preach', 'preach'], ['Charge the Called to farm', 'farm'], ['order the called to build', 'build'], ['tell my called to teach', 'teach'], ['the called: worship', 'worship'], ['order my disciples to preach', 'preach']] as const) {
    const a = r(t);
    assert.ok(a.x.ok && a.x.resolved?.some((c) => c.k === 'disciple.order' && c.mode === mode), `${t}: ${JSON.stringify(a.x.resolved)} ${a.msg}`);
    assert.ok(!OLD.test(a.msg), `${t}: ${a.msg}`);
  }
  const what = r('Charge the Called');
  assert.ok(/to do what/.test(what.msg) && !what.ks.includes('agent.make-disciple'), what.msg);
  // the town lifted by the Touch, in the reply
  const lifted = sim.applyNow({ k: 'settlement.move', settlement: lune.id, to: st.pos, mode: 'lift' });
  assert.ok(lifted.ok && /The Touch lifts/.test(String(lifted.msg)) && !OLD.test(String(lifted.msg)), String(lifted.msg));
});

test('free text: the god speaks of prophets, signs, prayers and its own wrath', () => {
  const { sim, hesh } = twoTowns();
  const k = (t: string) => { const r = sim.parse(t); return { r, ks: (r.resolved ?? []).map((c) => c.k) }; };
  const gentle = sim.parse('be gentle with them');
  assert.ok(gentle.ok, gentle.msg);
  assert.deepEqual((gentle.resolved ?? []).map((c) => [c.k, (c as { path?: string }).path, (c as { value?: number }).value]), [['set', 'god.wrath', 0.1]]);
  assert.deepEqual(k('make Hesh my prophet').ks, ['prophet.call']);
  const said = sim.applyNow({ k: 'prophet.call', agent: hesh });
  assert.ok(said.ok, said.msg);
  assert.deepEqual(k('tell Aru through Hesh that rain will come').ks, ['prophet.foretell']);
  assert.deepEqual(k('send a sign to Aru').ks, ['god.omen']);
  assert.deepEqual(k('make the deer sacred to Aru').ks, ['settlement.sacred']);
  const apoc = sim.parse('an apocalyptic earthquake on Aru');
  const q = (apoc.resolved ?? []).find((c) => c.k === 'disaster.spawn') as { wrath?: number; warning?: number } | undefined;
  assert.ok(q && q.wrath === 1 && q.warning === 0, `apocalyptic: ${JSON.stringify(apoc.resolved)}`);
  const pray = sim.parse('what does Aru pray for');
  assert.ok(pray.ok, pray.msg);
});

test('relationship state survives save → load and lives the same future', () => {
  const { sim, st } = town();
  const who = commoner(sim, st);
  must(sim, { k: 'prophet.call', agent: who });
  must(sim, { k: 'prophet.foretell', agent: who, what: 'rain', days: 3 });
  must(sim, { k: 'place.sacred', pos: st.pos });
  must(sim, { k: 'disaster.spawn', kind: 'volcano', pos: st.pos });
  starve(sim, st);
  sim.step(90);
  const b = Sim.load(sim.save());
  assert.equal(b.hash(), sim.hash());
  assert.deepEqual(JSON.parse(JSON.stringify(b.u.god.rel)), JSON.parse(JSON.stringify(sim.u.god.rel)));
  sim.step(240);
  b.step(240);
  assert.equal(b.hash(), sim.hash(), 'the same future');
});
