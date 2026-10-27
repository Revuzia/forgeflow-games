// GENESIS — LIVING integration: a save written by the 1.4 BUILD ITSELF (not a 1.5 save rewritten to look old) loads in
// this build (LIVING.md §6.3 rule 4, the 1.4 → 1.5 steps of core/migrate15.ts). The fixture was written by the tree of
// 2026-10-13 (_harness/scratch/living/pace/base, the last 1.4 build) with _harness/scratch/living/integrate/fixture14.ts:
// a bronze town (Aru, 30 people) on a sandbox world of 12, with what each lane's step must handle — a creature adopted and
// leashed to the town (RELATIONSHIP drops it), a disciple (the Called), herds of two kinds that were not real (ice-beast,
// sand-crawler: CONTENT replaced them in place by musk-ox and caracal), a leviathan disaster under way at sea (now the
// rogue wave), a god's item (chocolate, at item index 129 in 1.4: the content has grown under it), sown fields, a painted
// blood rain. The facts the 1.4 build saw are in save-1.4-aru.json beside it. A second fixture, a band at the legacy
// time-lapse, is at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Sim } from '../src/sim/sim.ts';
import { readSave, SAVE_MINOR } from '../src/sim/core/serialize.ts';
import { AgentFlag, AgentFlag2 } from '../src/sim/types.ts';
import { GODS } from '../src/sim/people/defs.ts';
import { lapseLevel } from '../src/sim/perf/lapse.ts';

const DIR = new URL('./fixtures/', import.meta.url);
const bytes = new Uint8Array(gunzipSync(readFileSync(new URL('save-1.4-aru.gnss.gz', DIR))));
interface Facts14 {
  tick: number; bytes: number;
  settlement: { id: number; name: string; era: number; library: number; members: number; leader: number };
  agentIds: number[]; disciple: number; creatures: { name: string; template: string }[];
  herds: Record<string, number>; store: Record<string, number>; disasters: string[]; itemsN: number; chocolateIdx: number; buildings: number;
}
const facts = JSON.parse(readFileSync(new URL('save-1.4-aru.json', DIR), 'utf8')) as Facts14;

test('migration: the fixture really is a 1.4 save (the 1.4 build wrote it; this build reads it as one)', () => {
  assert.equal(bytes.length, facts.bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint16(4, true) & 255, 4, 'minor 4 in the header');
  assert.equal(SAVE_MINOR, 5);
  assert.equal(readSave(bytes).header.migratedFrom, '1.4');
  // what the 1.4 build had in it: a creature, a leviathan, unreal herds, the god's chocolate at index 129
  assert.equal(facts.creatures.length, 1);
  assert.deepEqual(facts.disasters, ['leviathan']);
  assert.ok(facts.herds['ice-beast'] > 0 && facts.herds['sand-crawler'] > 0);
  assert.equal(facts.chocolateIdx, 129);
});

test('migration: a real 1.4 save loads with its people, town and goods; the creature is gone; unreal kinds became real ones', () => {
  const sim = Sim.load(bytes);
  assert.equal(sim.tick, facts.tick);
  const p = sim.u.planets[0]; const ps = p.people; const A = ps.agents;
  // every person of 1.4, no one else
  const alive: number[] = [];
  for (let s = 0; s < A.hi; s++) if (A.alive[s]) alive.push(A.id[s]);
  assert.deepEqual(alive.sort((a, b) => a - b), [...facts.agentIds].sort((a, b) => a - b));
  const st = ps.settlement(facts.settlement.id)!;
  assert.ok(st, 'the town');
  assert.equal(st.name, facts.settlement.name);
  assert.equal(st.era, facts.settlement.era);
  assert.equal(st.leader, facts.settlement.leader);
  assert.equal(st.library.length, facts.settlement.library);
  assert.equal(ps.members.get(st.id)?.length, facts.settlement.members);
  assert.equal(ps.buildings.filter((b) => b.settlement === st.id).length, facts.buildings);
  // its store item by item, by id — the god's chocolate included, wherever the grown content put it
  const items = sim.u.content.items.list;
  assert.ok(items.length > facts.itemsN, 'the content grew under the save');
  for (const [id, q] of Object.entries(facts.store)) {
    const i = items.findIndex((it) => it.id === id);
    assert.ok(i >= 0, `item ${id}`);
    assert.ok(Math.abs(st.store[i] - q) < 1e-3, `${id}: ${st.store[i]} vs ${q}`);
  }
  // the creature is gone from the world and its views
  assert.equal((sim.u.god as unknown as { creatures?: unknown }).creatures, undefined);
  const snap = sim.snapshot();
  assert.equal((snap as unknown as { creatures?: unknown }).creatures, undefined, 'Snapshot.creatures is never sent');
  // the disciple is one of the Called still, with the new faith and loyalty columns filled from love and fear
  const ds = A.slotOf(facts.disciple);
  assert.ok(ds >= 0 && (A.flags[ds] & AgentFlag.disciple) !== 0, 'still a disciple');
  assert.ok(sim.u.god.disciples.some((d) => d.agent === facts.disciple));
  for (const s of ps.members.get(st.id) ?? []) {
    const f = A.faith[s * GODS], l = A.loyalty[s * GODS];
    assert.ok(f >= 0 && f <= 1 && l >= 0 && l <= 1, `faith ${f} loyalty ${l}`);
    assert.ok(Math.abs(l - 0.5 * A.love[s * GODS]) < 1e-6, 'loyalty = half the old love');
  }
  void AgentFlag2;
  // no animal of a kind that is not real; the replaced herds live on as the real kinds (same index, same head)
  const herds: Record<string, number> = {};
  for (const h of ps.herds) if (h.count >= 0.5) { const id = sim.u.content.animals.list[h.species]?.id ?? '?'; herds[id] = (herds[id] ?? 0) + h.count; }
  for (const gone of ['ice-beast', 'sand-crawler', 'haze-ray', 'drift-ray']) assert.equal(herds[gone], undefined, gone);
  assert.ok(Math.abs((herds['musk-ox'] ?? 0) - facts.herds['ice-beast']) < 0.01, `musk-ox ${herds['musk-ox']}`);
  assert.ok(Math.abs((herds.caracal ?? 0) - facts.herds['sand-crawler']) < 0.01, `caracal ${herds.caracal}`);
  // the leviathan at sea goes on as the rogue wave: the sim and its views name the real kind
  assert.deepEqual(sim.u.god.disasters.map((d) => d.kind), ['rogue-wave']);
  const ps0 = snap.planets.find((q) => q.id === p.id)!;
  assert.deepEqual((ps0.disasters ?? []).map((d) => d.kind), ['rogue-wave']);
  // the new views of the town are there (relationship, era label, livelihood)
  const sv = (ps0.settlements ?? []).find((v) => v.id === st.id);
  assert.ok(sv, 'the town in the snapshot');
  assert.ok(sv!.regard && typeof sv!.regard.trust === 'number', 'SettlementView.regard');
  assert.equal(typeof sv!.eraLabel, 'string');
});

test('migration: a loaded 1.4 world saves as 1.5, keeps its hash over save → load, and two loads live on alike for two days', () => {
  const sim = Sim.load(bytes);
  const again = sim.save();
  const dv = new DataView(again.buffer, again.byteOffset, again.byteLength);
  assert.equal(dv.getUint16(4, true) & 255, SAVE_MINOR, 'saved as 1.5');
  assert.equal(readSave(again).header.migratedFrom, undefined);
  const back = Sim.load(again);
  assert.equal(back.hash(), sim.hash());
  const twin = Sim.load(bytes);
  assert.equal(twin.hash(), sim.hash(), 'the same 1.4 bytes load to the same world');
  sim.step(2880); back.step(2880); twin.step(2880);
  assert.equal(back.hash(), sim.hash());
  assert.equal(twin.hash(), sim.hash());
  const ps = sim.u.planets[0].people;
  assert.ok(ps.agents.count >= facts.agentIds.length - 3, `the town lives on (${ps.agents.count} people)`);
  assert.equal(sim.u.god.disasters.length, 0, 'the wave passed');
});

// ───────────────────────────── a band at the legacy time-lapse ─────────────────────────────
// The second 1.4 fixture (_harness/scratch/living/integrate/fixture14b.ts): a stone-age band of 30 wandering a sandbox
// world of 8, natural disasters on, two game days in at the legacy `time.scale { scale: 1000 }` (the old 1000x = 3000x
// now, level 2), written by the 1.4 build.
const band = new Uint8Array(gunzipSync(readFileSync(new URL('save-1.4-band.gnss.gz', DIR))));
const bandFacts = JSON.parse(readFileSync(new URL('save-1.4-band.json', DIR), 'utf8')) as { tick: number; bytes: number; agentIds: number[]; settlements: { id: number; band: boolean }[]; lapse: { scale: number } };

test('migration: a 1.4 band saved at the legacy time-lapse loads at the same level with the same people, and lives on alike', () => {
  assert.equal(band.length, bandFacts.bytes);
  assert.equal(readSave(band).header.migratedFrom, '1.4');
  assert.equal(bandFacts.lapse.scale, 1000);
  const sim = Sim.load(band);
  assert.equal(sim.tick, bandFacts.tick);
  assert.equal(lapseLevel(sim.u), 2, 'the legacy scale 1000 is the deep time-lapse (3000x)');
  const A = sim.u.planets[0].people.agents;
  const alive: number[] = [];
  for (let s = 0; s < A.hi; s++) if (A.alive[s]) alive.push(A.id[s]);
  assert.deepEqual(alive.sort((a, b) => a - b), [...bandFacts.agentIds].sort((a, b) => a - b));
  const b0 = bandFacts.settlements[0];
  assert.equal(!!sim.u.planets[0].people.settlement(b0.id)?.band, b0.band, 'still a band on the move');
  const twin = Sim.load(band);
  assert.equal(Sim.load(sim.save()).hash(), sim.hash());
  sim.step(1440); twin.step(1440);
  assert.equal(twin.hash(), sim.hash(), 'two loads live a day alike');
  assert.equal(lapseLevel(sim.u), 2);
});

// ───────────────────────────── a save of the previous 1.5 build ─────────────────────────────
// (LIVING integration, 2026-10-27) The lanes' second passes and the fifth and sixth integrations added optional saved
// fields under 1.5 without a bump (HISTORY's HistState hard / calam / sick / cp / ep, CONTENT's DerivedAnimal.god, LAND's
// LandState.more and HuntParty.cache, the god's plague stamp in Settlement.recent). This fixture was written by the 1.5
// build of 2026-10-21 00:10, before all of them (LAND's copy of that tree, _harness/scratch/living/land/r5/base, with
// _harness/scratch/living/integrate/r6/fixture15.ts): Aru and its daughter Lune of one polity, Lune's grievance on the
// books with a famine being judged, a zebra the god brought, two days into their lives.
const kin = new Uint8Array(gunzipSync(readFileSync(new URL('save-1.5a-kin.gnss.gz', DIR))));
const kinFacts = JSON.parse(readFileSync(new URL('save-1.5a-kin.json', DIR), 'utf8')) as {
  tick: number; hash: string; bytes: number; capital: number; daughter: number; agentIds: number[];
  settlements: { id: number; name: string; polity: number; parent: number; hist: { grievance: number; famine: number } | null }[];
  species: { id: string; god: number | null }[];
};

test('migration: a save of the previous 1.5 build loads as the same world — its hash, people, towns, polity and grievance', () => {
  assert.equal(kin.length, kinFacts.bytes);
  assert.equal(readSave(kin).header.migratedFrom, undefined, 'a 1.5 save: no migration step');
  const sim = Sim.load(kin);
  assert.equal(sim.tick, kinFacts.tick);
  assert.equal(sim.hash(), kinFacts.hash, 'the same world, hash for hash, as the old build saw it');
  const ps = sim.u.planets[0].people; const A = ps.agents;
  const alive: number[] = [];
  for (let s = 0; s < A.hi; s++) if (A.alive[s]) alive.push(A.id[s]);
  assert.deepEqual(alive.sort((a, b) => a - b), [...kinFacts.agentIds].sort((a, b) => a - b));
  for (const f of kinFacts.settlements) {
    const st = ps.settlement(f.id)!;
    assert.ok(st && st.name === f.name && st.polity === f.polity && st.parent === f.parent, `${f.name} as it was`);
    if (f.hist) assert.equal(st.hist?.grievance, f.hist.grievance, `${f.name}'s grievance`);
  }
  // the god's zebra is there (a kind the old build could not mark as brought: it reads as born here — LIVING §4.8)
  assert.equal(kinFacts.species[0].id, 'zebra');
  assert.equal(kinFacts.species[0].god, null);
  const eco = sim.query('ecology') as { species: { id: string; herds: number }[] };
  assert.ok(eco.species.some((s) => s.id === 'zebra' && s.herds > 0), 'its herds live on');
});

test('migration: the previous 1.5 build\'s grievance record is judged by this build\'s rules, and the world saves, loads and lives on alike', () => {
  const sim = Sim.load(kin);
  const d = sim.u.planets[0].people.settlement(kinFacts.daughter)!;
  // a first-pass record has no `hard`: it is a famine, and this build's view says so while it is judged
  const view0 = (sim.query('settlement', { id: d.id }) as { history: { grievance: { hard?: { kind: string; judged: boolean } } } }).history;
  assert.deepEqual([view0.grievance.hard?.kind, view0.grievance.hard?.judged], ['famine', false]);
  const twin = Sim.load(kin);
  const back = Sim.load(sim.save());
  assert.equal(back.hash(), sim.hash());
  sim.step(3 * 1440); twin.step(3 * 1440); back.step(3 * 1440);
  assert.equal(twin.hash(), sim.hash(), 'two loads live three days alike');
  assert.equal(back.hash(), sim.hash(), 'and a re-saved copy with them');
  // the famine was judged (Aru had food to spare and sent none): the new counters were taken up on the old record
  assert.equal(d.hist!.judged, true);
  assert.ok(d.hist!.grievance > kinFacts.settlements.find((s) => s.id === d.id)!.hist!.grievance, `the unrelieved famine weighed (${d.hist!.grievance})`);
  assert.ok(d.hist!.calam !== undefined && d.hist!.cp !== undefined, 'the calamity counters began');
});
