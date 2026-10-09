// GENESIS — mods (CONTRACT.md §9, §19): data packs for species, items, recipes, buildings, disasters, events, powers,
// names, scenarios and ships are validated by content.ts with readable errors; the example packs in mods/ load and do
// what they say (a new people with its own tongue and recipes lives; a new disaster strikes; a chronicle set re-voices
// the history); packs load through the worker's 'mod' message before the world is made, and a pack of only new things
// joins a running world in place with every index kept; saves list their packs and refuse to load without them; the
// save format is versioned (older saves migrate, newer or foreign ones are refused in words).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { loadContent, ContentError, type ContentPack } from '../src/sim/content.ts';
import { BASE_PACK } from '../src/data/index.ts';
import { Sim } from '../src/sim/sim.ts';
import { validatePowers } from '../src/sim/god/powers.ts';
import { readSave, SAVE_MAJOR, SAVE_MINOR } from '../src/sim/core/serialize.ts';
import type { FromWorker, ToWorker } from '../src/sim/types.ts';
import { must } from './helpers/peoples.ts';

const MODS = new URL('../mods/', import.meta.url);
const pack = (f: string): ContentPack => JSON.parse(readFileSync(new URL(f, MODS), 'utf8')) as ContentPack;
const SINGERS = pack('species-stone-singers.json');
const SALT = pack('disaster-salt-wind.json');
const ASH = pack('chronicle-book-of-ash.json');

test('every example pack in mods/ loads, its references resolve, and a world runs with all of them', () => {
  const files = readdirSync(MODS).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 4, `${files.length} packs`);
  const all = files.map(pack);
  for (const p of all) {
    const c = loadContent([BASE_PACK, p]);
    assert.ok(c.packs.includes(p.id), p.id);
  }
  const c = loadContent([BASE_PACK, ...all]);
  assert.ok(c.species.has('stone-singers') && c.disasters.has('salt-wind') && c.phonologies.has('stone-tongue'));
  const sim = new Sim({ seed: 3, scenario: 'sandbox', content: all, overrides: { n: 12 } });
  assert.deepEqual(validatePowers(sim.registry, sim.content), []);
  assert.deepEqual(sim.content.packs, ['base', ...all.map((p) => p.id)]);
  sim.step(60);
});

test('broken packs are refused with every problem named, readably', () => {
  const refuse = (p: ContentPack, ...res: RegExp[]) => {
    let msg = '';
    try { loadContent([BASE_PACK, p]); } catch (e) { assert.ok(e instanceof ContentError, String(e)); msg = (e as Error).message; }
    assert.ok(msg, `${p.id} should be refused`);
    for (const re of res) assert.match(msg, re);
  };
  const sp = SINGERS.species![0];
  refuse({ id: 'bad-species', species: [{ ...sp, id: 'rock-folk', body: 'octopod' }] }, /bad-species › species\[0\] 'rock-folk'/, /"body" must be one of .*octopod/);
  refuse({ id: 'bad-tongue', species: [{ ...sp, id: 'rock-folk', phonology: 'stone-tongu' }] }, /phonology refers to unknown phonology 'stone-tongu'/);
  refuse({ id: 'bad-recipe', recipes: [{ ...SINGERS.recipes![1], id: 'r1', inputs: [{ item: 'stonne', qty: 3 }], knowledge: ['stone-songg'] }] },
    /unknown item 'stonne' — did you mean 'stone'\?/, /unknown recipe 'stone-songg'/);
  refuse({ id: 'bad-building', buildings: [{ ...SINGERS.buildings![0], id: 'b1', materials: ['granit'], recipe: 'nothing' }] },
    /unknown material 'granit'/, /unknown recipe 'nothing'/);
  refuse({ id: 'bad-ship', ships: [{ id: 'balloon', name: 'Balloon', class: 'air', hull: 'balloon', pad: 'mast', knowledge: [], fuel: [{ item: 'coal', qty: 1 }], crew: [1, 2], cargo: 1, prep: 1, orbitHours: 0, days: [0.1, 0.2], altitude: 100, reliability: 0.9, returns: true }] },
    /bad-ship › ships\[0\] 'balloon'.*knowledge/, );
  refuse({ id: 'bad-ship-2', ships: [{ id: 'balloon', name: 'Balloon', class: 'air', hull: 'baloon', pad: 'mastt', knowledge: ['airships'], fuel: [{ item: 'coall', qty: 1 }], crew: [1, 2], cargo: 1, prep: 1, orbitHours: 0, days: [0.1, 0.2], altitude: 100, reliability: 0.9, returns: true }] },
    /hull refers to unknown item 'baloon'/, /pad refers to unknown building 'mastt'/, /did you mean 'coal'/);
  refuse({ id: 'bad-names', names: [{ id: 'x', onsets: [], vowels: ['a'], codas: [], syllables: [1, 2], personal: [1, 1], sep: '', features: {} }] }, /"onsets" must not be empty/);
  refuse({ id: 'bad-scenario', scenarios: [{ id: 's', name: 'S', star: 'G', planets: [{ name: 'A', kind: 'terran', orbit: { a: 1 } }], peoples: [{ species: 'plains-folk', planet: 0, count: 10, knowledge: ['rocketry'], store: { 'rocket-fuell': 3 } }] }] },
    /peoples\[0\]\.knowledge refers to unknown recipe 'rocketry'/, /did you mean 'rocket-fuel'/);
  const dis = SALT.disasters![0];
  refuse({ id: 'bad-disaster', disasters: [{ ...dis, id: 'd1', effectors: [{ type: 'shatter' as never }] }] }, /effectors\[0\]\.type must be one of/);
  refuse({ id: 'bad-event', events: [{ id: 'e1', kind: 'founding', weight: 9, text: [] }] }, /"weight" = 9 is outside 0\.\.3/, /"text" must not be empty/);
  // a template asking for a word the chronicle never fills would print its braces
  refuse({ id: 'bad-words', events: [{ id: 'founding', kind: 'founding', weight: 1, text: ['{fooo} came to {setlement}'] }] },
    /bad-words › events\[0\] 'founding': text\[0\] asks for \{fooo\}, which the chronicle never fills/, /\{setlement\}.*did you mean \{settlement\}\?/);
  // one pack naming an id twice: the second would silently win
  refuse({ id: 'dup', items: [{ id: 'gizmo', name: 'Gizmo', tags: [], weight: 1, value: 1 }, { id: 'gizmo', name: 'Gizmo 2', tags: [], weight: 1, value: 1 }] },
    /dup › items\[1\] 'gizmo': the id 'gizmo' is already used by items\[0\] in this pack/);
  // a power without a handler is refused when the world is made
  let msg = '';
  try { new Sim({ seed: 1, scenario: 'sandbox', content: [{ id: 'bad-power', powers: [{ ...SALT.powers![0], id: 'p1', command: 'glass.summon' }] }], overrides: { n: 8 } }); } catch (e) { msg = (e as Error).message; }
  assert.match(msg, /'glass.summon' has no handler/);
});

test('a modded people lives: its own tongue, its own recipes, its own holy building', () => {
  const sim = new Sim({ seed: 21, scenario: 'sandbox', content: [SINGERS], overrides: { n: 20, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const base = loadContent([BASE_PACK]);
  assert.equal(sim.content.species.idx('stone-singers'), base.species.size, 'appended after the base peoples');
  const r = must(sim, { k: 'life.spawn-people', species: 'stone-singers', count: 24, settled: true });
  const sid = r.created!.find((e) => e.kind === 'settlement')!.id;
  const p = sim.u.planets[0];
  const st = p.people.settlement(sid)!;
  assert.match(st.name, /-/, `a name in the stone tongue (${st.name})`);
  for (let d = 0; d < 6; d++) sim.step(1440);
  const alive = p.people.members.get(sid)?.length ?? 0;
  assert.ok(alive >= 16, `${alive} stone-singers alive after six days`);
  const sp = sim.content.species.idx('stone-singers');
  for (const s of p.people.members.get(sid) ?? []) assert.equal(p.people.agents.species[s], sp);
  // their own recipe: given to them, it is theirs alone (the plains folk cannot hold it, even made to)
  const k = sim.u.content.recipes.idx('stone-song');
  must(sim, { k: 'idea.teach', settlement: sid, knowledge: 'stone-song', force: true });
  const A = p.people.agents;
  const adults = (p.people.members.get(sid) ?? []).filter((s) => !(A.flags[s] & 1));
  assert.ok(adults.filter((s) => A.knows(s, k)).length >= adults.length - 1, 'the stone-singers know the stone-song');
  const pf = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 10, settled: true, lat: 30, lon: 60 });
  const pid = pf.created!.find((e) => e.kind === 'settlement')!.id;
  sim.applyNow({ k: 'idea.teach', settlement: pid, knowledge: 'stone-song', force: true });
  assert.ok((p.people.members.get(pid) ?? []).every((s) => !A.knows(s, k)), 'not for plains folk');
  // and with it, a song-cairn of their own: laid out as a site, built by their own hands
  const cairn = sim.content.buildings.idx('song-cairn');
  must(sim, { k: 'settlement.build', settlement: sid, type: 'song-cairn', site: true });
  const site = p.people.buildings.find((b) => b.settlement === sid && b.type === cairn)!;
  assert.ok(site && site.progress < 1);
  for (let d = 0; d < 4 && site.progress < 0.05; d++) sim.step(1440);
  assert.ok(site.progress > 0 && site.delivered > 0, `they bring stone and work on it (${site.progress.toFixed(2)})`);
  sim.step(600);
});

test('a modded disaster strikes, and a chronicle set re-voices the history', () => {
  const sim = new Sim({ seed: 8, scenario: 'sandbox', content: [SALT, ASH], overrides: { n: 16, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const pw = sim.content.powers.get('disaster-salt-wind');
  const p = sim.u.planets[0];
  const sum = (a: Float32Array) => a.reduce((q, v) => q + v, 0);
  const grass0 = sum(p.f.grass), salt0 = sum(p.f.pollution);
  must(sim, { k: pw.command, ...pw.params, lat: 5, lon: 10, radius: 600 });
  const view = sim.snapshot().planets[0].disasters!.find((d) => d.kind === 'salt-wind');
  assert.ok(view, 'the salt wind blows');
  sim.step(300);
  assert.ok(sum(p.f.grass) < grass0, 'the grass withers');
  assert.ok(sum(p.f.pollution) > salt0 + 0.5, 'the fields are salted');
  // the words reach it — and it does what they say (a whole name beats the 'wind' inside it)
  for (const t of ['salt wind', 'salt gale']) {
    const parsed = sim.parse(t);
    assert.ok(parsed.ok, `${t}: ${parsed.msg}`);
    assert.equal(parsed.resolved?.[0].kind, 'salt-wind');
    const done = sim.applyNow({ k: 'freeform', text: t });
    assert.ok(done.ok, `${t}: ${done.msg}`);
  }
  // the Book of Ash speaks of a founding in its own voice
  must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 12, settled: true });
  const text = sim.u.chronicle.map((e) => e.text).join('\n');
  assert.match(text, /Count the years from this|stopped walking/);
});

test('a running world takes a pack of only new things in place (indices kept); a pack that changes things waits for the next world', () => {
  const sim = new Sim({ seed: 4, scenario: 'sandbox', overrides: { n: 12 } });
  const before = { species: sim.u.content.species.ids(), items: sim.u.content.items.ids(), recipes: sim.u.content.recipes.ids() };
  sim.step(30);
  const r = sim.addPack(SINGERS);
  assert.ok(r.ok, r.msg);
  assert.deepEqual(sim.u.content.species.ids().slice(0, before.species.length), before.species, 'every species where it was');
  assert.deepEqual(sim.u.content.items.ids().slice(0, before.items.length), before.items);
  assert.deepEqual(sim.u.content.recipes.ids().slice(0, before.recipes.length), before.recipes);
  assert.ok(sim.content.packs.includes('stone-singers'));
  must(sim, { k: 'life.spawn-people', species: 'stone-singers', count: 8, settled: true });
  sim.step(60);
  const flora = pack('example-highland-flora.json');
  const r2 = sim.addPack(flora);
  assert.equal(r2.ok, false);
  assert.match(r2.msg ?? '', /plants 'pine'.*next world/);
  // a save lists its packs and refuses to load without them, in words
  const bytes = sim.save();
  const file = readSave(bytes);
  assert.deepEqual((file.header.packs as { id: string }[]).map((x) => x.id), ['base', 'stone-singers']);
  assert.throws(() => Sim.load(bytes), /needs the content pack 'The stone-singers' \(stone-singers 1\.0\.0\).*Load it/);
  const back = Sim.load(bytes, [SINGERS]);
  assert.equal(back.hash(), sim.hash());
});

test('the worker takes packs before the world is made (and refuses a broken one in words)', async () => {
  const w = new Worker(new URL('./helpers/workerboot.ts', import.meta.url));
  const got: FromWorker[] = [];
  const next = (pred: (m: FromWorker) => boolean): Promise<FromWorker> => new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('timeout')), 60000);
    const on = (m: FromWorker) => { got.push(m); if (pred(m)) { clearTimeout(t); w.off('message', on); ok(m); } };
    w.on('message', on);
  });
  const send = (m: ToWorker) => w.postMessage(m);
  try {
    await next((m) => (m as { type: string }).type === '__booted');
    let r = next((m) => m.type === 'result' && m.id === 1);
    send({ type: 'mod', id: 1, pack: SINGERS });
    const r1 = await r as Extract<FromWorker, { type: 'result' }>;
    assert.ok(r1.result.ok, r1.result.msg);
    assert.match(r1.result.msg ?? '', /world you create/);
    r = next((m) => m.type === 'result' && m.id === 2);
    send({ type: 'mod', id: 2, pack: { id: 'broken', species: [{ id: 'x' }] } });
    const r2 = await r as Extract<FromWorker, { type: 'result' }>;
    assert.equal(r2.result.ok, false);
    assert.match(r2.result.msg ?? '', /broken › species\[0\] 'x'/);
    const ready = next((m) => m.type === 'ready');
    send({ type: 'init', scenario: 'sandbox', seed: 3, options: { overrides: { n: 12 }, speed: 0 } });
    const rd = await ready as Extract<FromWorker, { type: 'ready' }>;
    assert.deepEqual(rd.content, ['base', 'stone-singers']);
    // and a pack of new things joins the running world
    r = next((m) => m.type === 'result' && m.id === 3);
    send({ type: 'mod', id: 3, pack: SALT });
    const r3 = await r as Extract<FromWorker, { type: 'result' }>;
    assert.ok(r3.result.ok);
    assert.match(r3.result.msg ?? '', /part of this world/);
    r = next((m) => m.type === 'result' && m.id === 4);
    send({ type: 'cmd', id: 4, cmd: { k: 'disaster.spawn', kind: 'salt-wind', lat: 0, lon: 0 } });
    const r4 = await r as Extract<FromWorker, { type: 'result' }>;
    assert.ok(r4.result.ok, r4.result.msg);
  } finally {
    await w.terminate();
  }
});

test('saves are versioned: this build writes 1.4; an older save migrates, a newer or foreign one is refused in words', () => {
  const sim = new Sim({ seed: 6, scenario: 'sandbox', overrides: { n: 12 } });
  sim.step(20);
  const bytes = sim.save();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint16(4, true), (SAVE_MAJOR << 8) | SAVE_MINOR);
  assert.equal(SAVE_MINOR, 4);
  // an older save (1.0: no space, no god, no pack list) migrates
  const old = rewrite(bytes, 0, (h) => { delete h.space; delete h.packs; delete h.god; });
  const back = Sim.load(old);
  assert.equal(readSave(old).header.migratedFrom, '1.0');
  assert.equal(back.u.space.ships.length, 0);
  assert.equal(back.tick, sim.tick);
  back.step(30);
  // a newer minor, another major: refused in words
  assert.throws(() => Sim.load(rewrite(bytes, 9, () => {})), /newer GENESIS \(format 1\.9.*reads up to 1\.4\)/);
  // a phase-4 save of the first pass (1.3: ships without set-aside goods) migrates too
  const p13 = rewrite(bytes, 3, (h) => { delete h.frozen; });
  assert.equal(readSave(p13).header.migratedFrom, '1.3');
  assert.equal(Sim.load(p13).tick, sim.tick);
  const foreign = bytes.slice();
  new DataView(foreign.buffer).setUint16(4, (2 << 8) | 0, true);
  assert.throws(() => Sim.load(foreign), /incompatible GENESIS version \(format 2\.0/);
});

/** the same save with another minor version and an edited header (blob section copied as it is) */
function rewrite(bytes: Uint8Array, minor: number, edit: (h: Record<string, unknown>) => void): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hlen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + hlen))) as Record<string, unknown>;
  edit(header);
  const start = (12 + hlen + 7) & ~7;
  const blobs = bytes.subarray(start);
  const json = new TextEncoder().encode(JSON.stringify(header));
  const nstart = (12 + json.length + 7) & ~7;
  const out = new Uint8Array(nstart + blobs.length);
  out.set(bytes.subarray(0, 12));
  const ov = new DataView(out.buffer);
  ov.setUint16(4, (SAVE_MAJOR << 8) | minor, true);
  ov.setUint32(8, json.length, true);
  out.set(json, 12);
  out.set(blobs, nstart);
  return out;
}

/** a pack of new things only: two gems */
const GEMS: ContentPack = { id: 'gems', name: 'Gems', version: '1', items: [
  { id: 'ruby', name: 'Ruby', tags: ['valuable'], weight: 0.1, value: 30 } as never,
  { id: 'opal', name: 'Opal', tags: ['valuable'], weight: 0.1, value: 25 } as never,
] };

test('a save opens with its packs in its own order, whatever order they are given in; a pack it never had is laid on top only if it adds new things', () => {
  const sim = new Sim({ seed: 9, scenario: 'sandbox', content: [SINGERS, GEMS], overrides: { n: 12 } });
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 10, settled: true });
  const sid = r.created!.find((e) => e.kind === 'settlement')!.id;
  must(sim, { k: 'settlement.gift', settlement: sid, items: { ruby: 5 } });
  sim.step(30);
  const bytes = sim.save();
  const ruby = sim.content.items.idx('ruby');
  // given in another order: laid in the save's own order — the rubies stay rubies
  const back = Sim.load(bytes, [GEMS, SINGERS]);
  assert.equal(back.hash(), sim.hash());
  assert.deepEqual(back.content.packs, ['base', 'stone-singers', 'gems']);
  assert.equal(back.content.items.idx('ruby'), ruby);
  assert.equal(back.u.planets[0].people.settlement(sid)!.store[ruby], 5);
  // a pack the save never had that changes what it has: refused, in words
  const flora = pack('example-highland-flora.json');
  assert.throws(() => Sim.load(bytes, [SINGERS, GEMS, flora]), /made without the pack 'Highland flora' \(it changes plants 'pine'.*Unload it to open this save/i);
  // one of only new things: laid on top, every index the save uses kept
  const more = Sim.load(bytes, [SALT, GEMS, SINGERS]);
  assert.deepEqual(more.content.packs.slice(0, 3), ['base', 'stone-singers', 'gems']);
  assert.ok(more.content.packs.includes('salt-wind'));
  assert.equal(more.content.items.idx('ruby'), ruby);
  assert.equal(more.u.planets[0].people.settlement(sid)!.store[ruby], 5);
});

test('the god\'s inventions keep their place when a pack joins the running world after them (and in its saves)', () => {
  const sim = new Sim({ seed: 2, scenario: 'sandbox', overrides: { n: 12 } });
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 10, settled: true });
  const sid = r.created!.find((e) => e.kind === 'settlement')!.id;
  must(sim, { k: 'freeform', text: 'introduce chocolate' });
  const choc = sim.u.content.items.idx('chocolate');
  assert.ok(choc >= 0, 'chocolate exists');
  must(sim, { k: 'settlement.gift', settlement: sid, items: { chocolate: 7 } });
  const ok = sim.addPack(GEMS);
  assert.ok(ok.ok, ok.msg);
  assert.equal(sim.u.content.items.idx('chocolate'), choc, 'chocolate where it was');
  assert.equal(sim.u.content.items.list[choc].id, 'chocolate');
  // a later invention goes after the pack
  must(sim, { k: 'freeform', text: 'introduce marzipan' });
  assert.ok(sim.u.content.items.idx('marzipan') > sim.u.content.items.idx('opal'));
  assert.equal(sim.u.content.items.idx('chocolate'), choc);
  const bytes = sim.save();
  const back = Sim.load(bytes, [GEMS]);
  assert.equal(back.hash(), sim.hash());
  assert.equal(back.u.content.items.idx('chocolate'), choc);
  assert.equal(back.u.planets[0].people.settlement(sid)!.store[choc], 7);
});

test('the worker keeps the order of its packs when one is sent again, and says a pack the running world cannot take is kept for the next', async () => {
  const w = new Worker(new URL('./helpers/workerboot.ts', import.meta.url));
  const next = (pred: (m: FromWorker) => boolean): Promise<FromWorker> => new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('timeout')), 60000);
    const on = (m: FromWorker) => { if (pred(m)) { clearTimeout(t); w.off('message', on); ok(m); } };
    w.on('message', on);
  });
  const send = (m: ToWorker) => w.postMessage(m);
  try {
    await next((m) => (m as { type: string }).type === '__booted');
    for (const [id, pk] of [[1, SINGERS], [2, GEMS], [3, SINGERS]] as const) {
      const r = next((m) => m.type === 'result' && m.id === id);
      send({ type: 'mod', id, pack: pk });
      assert.ok((await r as Extract<FromWorker, { type: 'result' }>).result.ok);
    }
    const ready = next((m) => m.type === 'ready');
    send({ type: 'init', scenario: 'sandbox', seed: 3, options: { overrides: { n: 12 }, speed: 0 } });
    assert.deepEqual((await ready as Extract<FromWorker, { type: 'ready' }>).content, ['base', 'stone-singers', 'gems'], 'stone-singers kept its place');
    const r = next((m) => m.type === 'result' && m.id === 4);
    send({ type: 'mod', id: 4, pack: pack('example-highland-flora.json') });
    const res = (await r as Extract<FromWorker, { type: 'result' }>).result;
    assert.equal(res.ok, false);
    assert.equal(res.deferred, true);
    assert.match(res.msg ?? '', /next world/);
  } finally {
    await w.terminate();
  }
});
