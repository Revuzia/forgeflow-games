// GENESIS — the god's words and powers do what they say (CONTRACT.md §11, the omnipotence audit): every finding of the
// audit, on the world it ran on (Aru: 30 bronze-age plains folk; Lune: 20 coastal folk 0.9–1.6 km away; Hesh, a grown
// person of Aru; the camera on Aru). Words that mean one thing never do another (the sea level never razes a town, a
// prohibition is never the act, a withdrawal never creates); live things are acted on by name; what cannot be done says
// so with what can; a question is answered; and the commands the words reach really change the world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoTowns, must, standing, ruined } from './helpers/god.ts';
import type { Command, CommandResult } from '../src/sim/types.ts';
import { Sim } from '../src/sim/sim.ts';
import { distM } from '../src/sim/people/world.ts';
import { AgentFlag } from '../src/sim/types.ts';

type Want = string | ((c: Command[], sim: Sim, w: W) => string | true);
interface W { aru: number; lune: number; hesh: number }

const json = (c: Command[]): string => JSON.stringify(c.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) && v.length === 3 && typeof v[0] === 'number' ? 'v3' : v]))));
const near = (sim: Sim, a: unknown, b: ArrayLike<number>, m: number): boolean => Array.isArray(a) && distM(sim.u.planets[0], a as number[], b) <= m;
const posOf = (sim: Sim, sid: number): number[] => sim.u.planets[0].people.settlement(sid)!.pos;

/** words -> what they must resolve to (parse only: nothing changes) */
const PHRASES: [string, Want][] = [
  // the sea, the ground, never a town razed
  ['raise the sea level by 20 metres', (c) => (c.length === 1 && c[0].k === 'water.sea-level' && c[0].delta === 20) || json(c)],
  ['sea level 20', (c) => (c[0].k === 'water.sea-level') || json(c)],
  ['level the ground', (c) => (c[0].k === 'terrain.flatten') || json(c)],
  ['level the hills near Aru', (c) => (c[0].k === 'terrain.flatten') || json(c)],
  ['drain the sea', (c) => (c[0].k === 'water.sea-level' && Number(c[0].delta) < 0) || json(c)],
  ['drain the lake', (c) => (c[0].k === 'water.drain') || json(c)],
  // one person or one kind, never everyone
  ['smite Hesh', (c, _s, w) => (c.length === 1 && c[0].k === 'agent.kill' && c[0].id === w.hesh) || json(c)],
  ['strike Hesh down', (c, _s, w) => (c.length === 1 && c[0].k === 'agent.kill' && c[0].id === w.hesh) || json(c)],
  ['kill all the fish', (c) => (c[0].k === 'life.cull' && c[0].species === 'fish-shoal') || json(c)],
  ['kill all the wolves', (c) => (c[0].k === 'life.cull' && c[0].species === 'wolf') || json(c)],
  ['kill everyone in Lune', (c, _s, w) => (c[0].k === 'life.kill' && c[0].settlement === w.lune && c[0].what === 'people') || json(c)],
  // worlds are born only when asked for
  ['make the world warmer', (c) => (c[0].k === 'set' && c[0].path === 'climate.offset' && Number(c[0].value) > 0) || json(c)],
  ['make it rain all over the world', (c) => (c[0].k === 'weather.global' && c[0].kind === 'rain') || json(c)],
  ['make a new world', 'world.birth'],
  // withdrawals take away
  ['remove the horses from Aru', (c, _s, w) => (c[0].k === 'life.cull' && c[0].species === 'horse' && c[0].settlement === w.aru) || json(c)],
  ['make horses extinct', (c) => (c[0].k === 'life.extinct' && c[0].species === 'horse') || json(c)],
  ['remove the coastal folk', (c) => (c[0].k === 'life.extinct' && c[0].species === 'coastal-folk') || json(c)],
  ['take the people of Lune away', (c, _s, w) => (c[0].k === 'life.extinct' && c[0].settlement === w.lune) || json(c)],
  ['withdraw the rice from Aru', (c, _s, w) => (c[0].k === 'settlement.withdraw' && c[0].crop === 'rice' && c[0].settlement === w.aru) || json(c)],
  ['take the wheel from Aru', (c, _s, w) => (c[0].k === 'settlement.withdraw' && c[0].idea === 'wheel' && c[0].settlement === w.aru) || json(c)],
  ['remove the pox from the world', (c) => (c[0].k === 'life.cure' && c[0].everywhere === true) || json(c)],
  ['take the bronze tools away from Aru', (c) => (c[0].k === 'settlement.withdraw' && c[0].item === 'bronze-tools') || json(c)],
  // rivers, prohibitions, the air, fire
  ['carve a river from Aru to the sea', (c, sim) => (c.length === 1 && c[0].k === 'terrain.river' && near(sim, c[0].pos, posOf(sim, 1), 400)) || json(c)],
  ['forbid war', (c) => (c.length >= 1 && c.every((x) => x.k === 'settlement.law' && x.law === 'peace')) || json(c)],
  ['ban fire in Lune', (c, _s, w) => (c[0].k === 'settlement.law' && c[0].law === 'no-fire' && c[0].settlement === w.lune) || json(c)],
  ['no more natural disasters', (c) => (c[0].k === 'set' && c[0].path === 'disasters.natural' && c[0].value === 0) || json(c)],
  ['thicken the air', 'planet.add-air'],
  ['add 30% more air', (c) => (c[0].k === 'planet.add-air' && c[0].amount === 0.3) || json(c)],
  ['make the sky blood red', (c) => (c[0].k === 'planet.atmosphere' && Array.isArray(c[0].tint)) || json(c)],
  ['put out the fires everywhere', (c) => (c[0].k === 'fire.extinguish' && Number(c[0].radius) >= 20000 || c[0].everywhere === true) || json(c)],
  // disasters: random, forever
  ['send a random disaster', (c) => (c[0].k === 'disaster.spawn' && c[0].kind === 'random') || json(c)],
  ['a drought on Aru that never ends', (c) => (c[0].kind === 'drought' && c[0].duration === -1) || json(c)],
  // the weather
  ['snow everywhere', (c) => (c[0].k === 'weather.global' && c[0].kind === 'snow') || json(c)],
  ['sandstorms everywhere', (c) => (c[0].k === 'weather.global' && c[0].kind === 'sandstorm') || json(c)],
  ['acid rain everywhere', (c) => (c[0].k === 'weather.global' && c[0].kind === 'acid-rain') || json(c)],
  ['make ash fall everywhere', (c) => (c[0].k === 'weather.global' && c[0].kind === 'ashfall') || json(c)],
  ['northern lights', (c) => (c[0].kind === 'aurora-storm') || json(c)],
  ['cover Lune in snow', (c) => (c[0].k === 'terrain.paint-material' && c[0].material === 'snow') || json(c)],
  ['make the wind blow from the east', (c) => (c[0].k === 'weather.wind' && c[0].from === 90) || json(c)],
  ['a storm front on the east coast', (c, sim) => {
    const p = sim.u.planets[0];
    if (c[0].k !== 'weather.paint' || !Array.isArray(c[0].pos)) return json(c);
    const cell = p.cellAt(c[0].pos as number[]);
    return (!!p.s.coast[cell] || !!p.s.ocean[cell]) || `${json(c)}: not on a coast`;
  }],
  // time
  ['make it noon in Lune', (c, sim) => (c[0].k === 'time.set-hour' && c[0].hour === 12 && near(sim, c[0].at, posOf(sim, 2), 1)) || json(c)],
  ['scrub to 3 pm', (c) => (c[0].k === 'time.set-hour' && c[0].hour === 15) || json(c)],
  ['make the year 30 days long', (c) => (c[0].k === 'time.year-length' || (c[0].k === 'set' && /year/i.test(String(c[0].path)))) || json(c)],
  ['go forward a day', (c) => (c[0].k === 'time.step' && c[0].ticks === 1440) || json(c)],
  ['stop the seasons', 'weather.pin-season'],
  ['make it night forever', (c) => (c[0].k === 'time.set-hour' && c[1]?.k === 'time.freeze-sun') || json(c)],
  // relative laws
  ['double gravity', (c) => (c[0].k === 'set' && c[0].path === 'planet.gravity' && Math.abs(Number(c[0].value) - 19.6) < 0.2) || json(c)],
  ['make gravity 50% stronger', (c) => (c[0].k === 'set' && Math.abs(Number(c[0].value) - 14.7) < 0.2) || json(c)],
  ['make the people taller', (c) => (c.length === 2 && c.every((x) => x.k === 'set' && /\.size$/.test(String(x.path)))) || json(c)],
  // the ground shaped
  ['lay a road from Aru to Lune', (c, sim) => (c[0].k === 'terrain.pave' && near(sim, c[0].to, posOf(sim, 2), 1)) || json(c)],
  ['pave Aru', 'terrain.pave'], ['scorch the land here', 'fire.ignite'], ['forest everywhere', (c) => (c[0].k === 'life.forest' && c[0].everywhere === true) || json(c)],
  ['make the desert bloom', (c) => (c.some((x) => x.k === 'life.paint-biome' && x.biome === 'grassland')) || json(c)],
  ['bloom', (c) => (c[0].k === 'life.plant') || json(c)],
  // settlements
  ['move Aru north', (c, _s, w) => (c[0].k === 'settlement.move' && c[0].settlement === w.aru) || json(c)],
  ['found a new town north of Lune', (c) => (c[0].k === 'settlement.found') || json(c)],
  ['add a person to Aru', (c, _s, w) => (c[0].k === 'life.spawn-people' && c[0].settlement === w.aru && c[0].count === 1) || json(c)],
  ['a child is born in Aru', (c) => (c[0].k === 'life.spawn-people' && c[0].children === true) || json(c)],
  ['build a temple in Aru', (c) => (c[0].k === 'settlement.build' && c[0].type === 'temple') || json(c)],
  ['make Aru and Lune allies', (c, _s, w) => (c[0].k === 'settlement.treaty' && c[0].kind === 'alliance' && c[0].settlement === w.aru && c[0].other === w.lune) || json(c)],
  ['ally Aru with Lune', (c, _s, w) => (c[0].k === 'settlement.treaty' && c[0].settlement === w.aru && c[0].other === w.lune) || json(c)],
  ['merge Aru into Lune', (c, _s, w) => (c[0].k === 'settlement.merge' && c[0].settlement === w.aru && c[0].other === w.lune) || json(c)],
  ['make Lune fear me', (c, _s, w) => (c[0].k === 'belief.sway' && c[0].feeling === 'fear' && c[0].settlement === w.lune) || json(c)],
  ['silence Lune', (c, _s, w) => (c[0].k === 'settlement.silence' && c[0].settlement === w.lune) || json(c)],
  ['repeal the law of hospitality in Aru', (c) => (c[0].k === 'settlement.law' && c[0].on === false) || json(c)],
  ['give Lune rice', (c) => (c[0].k === 'settlement.introduce' && c[0].crop === 'rice') || json(c)],
  ['give Aru a telescope', (c) => (c[0].k === 'settlement.gift' ? Object.values(c[0].items as Record<string, number>)[0] === 1 : c.some((x) => x.k === 'settlement.introduce')) || json(c)],
  // people by name
  ['move Hesh to Lune', (c, sim, w) => (c[0].k === 'agent.move' && c[0].id === w.hesh && near(sim, c[0].pos, posOf(sim, w.lune), 300)) || json(c)],
  ['silence Hesh', (c, _s, w) => (c[0].k === 'agent.silence' && c[0].id === w.hesh) || json(c)],
  ['possess Hesh', (c, _s, w) => (c[0].k === 'agent.possess' && c[0].id === w.hesh) || json(c)],
  ['make Hesh the chief of Aru', (c, _s, w) => (c[0].k === 'agent.role' && c[0].id === w.hesh && c[0].role === 'leader') || json(c)],
  ['turn Hesh into a frog', (c, _s, w) => (c.some((x) => x.k === 'agent.transform' && x.id === w.hesh && x.into === 'frog')) || json(c)],
  ['send a meteor at Hesh', (c) => (c[0].k === 'disaster.spawn' && c[0].kind === 'meteor') || json(c)],
  ['teach Aru iron', (c) => (c[0].k === 'settlement.teach' && c[0].knowledge === 'iron-smelting') || json(c)],
  // the hand, the creature, the rivals, saves
  ['throw Hesh at Lune', (c, _s, w) => (c[0].k === 'hand.grab' && (c[0].target as { id: number })?.id === w.hesh && c[1]?.k === 'hand.throw') || json(c)],
  ['conjure 20 bread into my hand', (c) => (c[0].k === 'hand.grab' && c[0].item === 'bread' && c[0].qty === 20) || json(c)],
  ['give me a creature', 'creature.adopt'], ['adopt a great cat near Lune', (c) => (c[0].k === 'creature.adopt' && c[0].template === 'great-cat') || json(c)],
  ['make the creature bigger', 'creature.grow'],
  ['give Lune a jealous god', (c) => (c[0].k === 'rival.add' && c[0].temperament === 'jealous') || json(c)],
  ['save the game', 'meta.save'], ['load the game', 'meta.load'], ['resume', (c) => (c[0].k === 'time.speed' && c[0].speed === 1) || json(c)],
  // verbs that look like nouns
  ['make every tree bear fruit', (c) => (!c.some((x) => x.k === 'life.spawn-animal')) || json(c)],
  ['make the wolves friendly', (c) => (c[0].k === 'life.tame' && c[0].species === 'wolf') || json(c)],
  ['make Aru fertile', 'miracle.fertility'],
  ['melt the ice caps', (c) => (!c.some((x) => x.k === 'life.paint-biome')) || json(c)],
];

test(`${PHRASES.length} audit phrases resolve to what they mean on the two-peoples world, and parsing changes nothing`, () => {
  const { sim, st, lune, hesh } = twoTowns();
  const w: W = { aru: st.id, lune: lune.id, hesh };
  const h = sim.hash();
  const fails: string[] = [];
  for (const [text, want] of PHRASES) {
    const r = sim.parse(text);
    if (!r.ok || !r.resolved?.length) { fails.push(`"${text}": not understood (${r.msg})`); continue; }
    if (typeof want === 'string') { if (r.resolved[0].k !== want) fails.push(`"${text}": ${json(r.resolved)}, wanted ${want}`); continue; }
    const v = want(r.resolved, sim, w);
    if (v !== true) fails.push(`"${text}": ${v}`);
  }
  assert.deepEqual(fails, [], fails.join('\n'));
  assert.equal(sim.hash(), h, 'parse() changed nothing');
});

/** words that cannot be carried out as said answer with a question or the nearest power — never a wrong act */
test('what the words cannot do (or lack a target for) is said plainly, with what can be done, and nothing happens', () => {
  const { sim } = twoTowns();
  const h = sim.hash();
  const cases: [string, RegExp, string?][] = [
    ['possess', /whom/i, 'agent.possess'], ['move the sun', /what hour/i, 'time.set-hour'], ['make a disciple', /whom/i, 'agent.make-disciple'],
    ['make the planet bigger', /cannot be made bigger/i], ['give the world rings', /rings/i],
    ['move the tornado to Lune', /no tornado/i, 'disaster.spawn'], ['tilt the world', /how far/i],
    ['smite the wicked', /whom|who|which/i], ['tell my disciples to farm', /no disciples/i, 'disciple.order'],
  ];
  for (const [text, re, hint] of cases) {
    const r = sim.parse(text);
    assert.equal(r.ok, false, `${text}: ${JSON.stringify(r)}`);
    assert.match(r.msg ?? '', re, text);
    assert.doesNotMatch(r.msg ?? '', /is required|must be|unknown param/i, `${text}: a question, not a schema error`);
    if (hint) assert.equal(r.resolved?.[0]?.k, hint, `${text}: the preview names the power it is about`);
    const run = sim.applyNow({ k: 'freeform', text });
    assert.equal(run.ok, false, text);
  }
  assert.equal(sim.hash(), h, 'nothing happened');
});

test('a plain question is answered from the world (and changes nothing)', () => {
  const { sim, st, lune } = twoTowns();
  const h = sim.hash();
  const ask = (t: string): CommandResult => { const r = sim.applyNow({ k: 'freeform', text: t }); assert.ok(r.ok, `${t}: ${r.msg}`); assert.equal(r.resolved?.length ?? 0, 0, t); return r; };
  const pop = (sim.query('settlement', { id: st.id }) as { population: number }).population;
  assert.match(ask('how many people live in Aru?').msg!, new RegExp(`Aru has ${pop} people`));
  assert.match(ask('where is Hesh?').msg!, /Hesh is/);
  const leader = (sim.query('settlement', { id: lune.id }) as { leader: { name: string } | null }).leader;
  assert.match(ask('who leads Lune?').msg!, leader ? new RegExp(leader.name) : /no leader/);
  assert.match(ask('what does Lune know?').msg!, /Lune knows/);
  assert.match(ask('what time is it?').msg!, /It is \d+:\d\d/);
  assert.match(ask('how many people are there?').msg!, /in 2 settlements/);
  assert.match(ask('how old is Hesh?').msg!, /years old/);
  assert.equal(sim.hash(), h);
  // a request phrased as a question is still a request
  assert.equal(sim.parse('can you make it rain?').resolved?.[0].k, 'water.rain');
});

function run(sim: Sim, text: string): CommandResult {
  const r = sim.applyNow({ k: 'freeform', text });
  assert.ok(r.ok, `${text}: ${r.msg}`);
  return r;
}

test('the sea rises and the ground is levelled without a town thrown down; no world is born of a warmer sky', () => {
  const { sim } = twoTowns();
  const p = sim.u.planets[0];
  const sea = p.st.seaLevel, worlds = sim.u.planets.length, ruins = ruined(sim), up = standing(sim);
  run(sim, 'raise the sea level by 20 metres');
  assert.equal(p.st.seaLevel, sea + 20);
  run(sim, 'level the ground');
  run(sim, 'make the world warmer');
  assert.equal(sim.u.planets.length, worlds, 'no world was born');
  assert.equal(ruined(sim), ruins, 'nothing was razed');
  assert.ok(standing(sim) >= up - 1, 'the towns still stand');
});

test('what is taken away goes: animals, a people, a crop, an idea, tools — never more of it', () => {
  const { sim, st, lune } = twoTowns();
  const p = sim.u.planets[0];
  const ps = p.people;
  const wolfIdx = sim.u.content.animals.idx('wolf');
  must(sim, { k: 'life.spawn-animal', species: 'wolf', count: 8, pos: st.pos });
  const wolves = (): number => ps.herds.filter((h) => h.species === wolfIdx).reduce((n, h) => n + h.count, 0);
  const w0 = wolves();
  assert.ok(w0 >= 8);
  run(sim, 'remove the wolves from Aru');
  assert.ok(wolves() < w0, `fewer wolves (${w0} -> ${wolves()})`);
  // an idea Aru holds, taken
  const wheel = sim.u.content.recipes.idx('wheel');
  if (!st.library.includes(wheel)) must(sim, { k: 'settlement.teach', settlement: st.id, knowledge: 'wheel', force: true });
  assert.ok(st.library.includes(wheel), 'Aru knows the wheel');
  run(sim, 'take the wheel from Aru');
  assert.ok(!st.library.includes(wheel), 'and no longer');
  // a crop given, then withdrawn
  run(sim, 'give Aru rice');
  const rice = sim.u.content.plants.idx('rice');
  assert.equal(st.crop, rice, 'rice is their crop');
  run(sim, 'withdraw the rice from Aru');
  assert.notEqual(st.crop, rice, 'rice taken away');
  // a whole people
  const coastal = sim.u.content.species.idx('coastal-folk');
  const count = (sp: number): number => { let n = 0; for (let s = 0; s < ps.agents.hi; s++) if (ps.agents.alive[s] && ps.agents.species[s] === sp) n++; return n; };
  const plains = count(sim.u.content.species.idx('plains-folk'));
  assert.ok(count(coastal) > 0);
  run(sim, 'remove the coastal folk');
  assert.equal(count(coastal), 0, 'the coastal folk are gone');
  assert.equal(count(sim.u.content.species.idx('plains-folk')), plains, 'and only they');
  assert.ok(ps.settlement(lune.id)!.fallen >= 0 || !(ps.members.get(lune.id)?.length), 'Lune is empty');
});

test('a prohibition is a law, never the act: "forbid war" keeps the peace; repealing it lifts the law', () => {
  const { sim, st, lune } = twoTowns();
  const laws = (sid: number): string[] => sim.u.god.settlementLaws[`0:${sid}`] ?? [];
  run(sim, 'forbid war');
  assert.ok(laws(st.id).includes('peace') && laws(lune.id).includes('peace'), JSON.stringify(sim.u.god.settlementLaws));
  assert.ok(!sim.u.planets[0].people.relations.some((r) => r.war >= 0), 'no war began');
  run(sim, 'repeal the law of peace in Aru');
  assert.ok(!laws(st.id).includes('peace'), 'repealed in Aru');
  assert.ok(laws(lune.id).includes('peace'), 'still kept in Lune');
});

test('the air and the sky: a blood-red sky is tinted, the air thickened, a planet-wide clear lifts the global weather', () => {
  const { sim } = twoTowns();
  const p = sim.u.planets[0];
  run(sim, 'make the sky blood red');
  const t = p.st.atmosphere.tint!;
  assert.ok(t && t[0] > t[1] && t[0] > t[2], `red (${t})`);
  const pr = p.st.atmosphere.pressure;
  run(sim, 'thicken the air');
  assert.ok(p.st.atmosphere.pressure > pr);
  run(sim, 'snow everywhere');
  assert.equal(p.st.globalWeather, 'snow');
  run(sim, 'clear the skies');
  assert.equal(p.st.globalWeather, null, 'the planet-wide snow lifts');
});

test('a live disaster is acted on by words; with none, nothing is spawned in its place', () => {
  const { sim, st, lune } = twoTowns();
  const g = sim.u.god;
  // none alive: "move the tornado" says so and makes none
  const r0 = sim.applyNow({ k: 'freeform', text: 'move the tornado to Lune' });
  assert.equal(r0.ok, false);
  assert.equal(g.disasters.length, 0);
  must(sim, { k: 'disaster.spawn', kind: 'tornado', pos: st.pos });
  const d = g.disasters[0];
  const scale = d.scale;
  run(sim, 'make the tornado twice as big');
  assert.equal(g.disasters.length, 1, 'still one tornado');
  assert.ok(Math.abs(d.scale - scale * 2) < 1e-6, `twice (${scale} -> ${d.scale})`);
  run(sim, 'hold the tornado where it is');
  assert.equal(d.frozen, true);
  run(sim, 'let the tornado go on');
  assert.equal(d.frozen, false);
  run(sim, 'move the tornado to Lune');
  sim.step(30);
  assert.ok(g.disasters.length === 0 || distM(sim.u.planets[0], g.disasters[0].pos, lune.pos) < distM(sim.u.planets[0], st.pos, lune.pos), 'it heads for Lune');
  if (g.disasters.length) run(sim, 'make the tornado go away');
  assert.equal(g.disasters.length, 0, 'gone');
});

test('a random disaster is one of the world\'s own (the same on every run); a drought that never ends does not end', () => {
  const a = twoTowns(), b = twoTowns();
  run(a.sim, 'send a random disaster');
  run(b.sim, 'send a random disaster');
  const ka = a.sim.u.god.disasters.map((d) => d.kind), kb = b.sim.u.god.disasters.map((d) => d.kind);
  assert.equal(ka.length, 1);
  assert.notEqual(ka[0], 'random');
  assert.deepEqual(ka, kb, 'deterministic');
  const { sim } = twoTowns();
  run(sim, 'a drought on Aru that never ends');
  const d = sim.u.god.disasters.find((x) => x.kind === 'drought')!;
  assert.equal(d.life, -1);
  sim.step(3000);
  assert.ok(sim.u.god.disasters.some((x) => x.kind === 'drought'), 'still there after two days');
  run(sim, 'end the drought');
  assert.ok(!sim.u.god.disasters.some((x) => x.kind === 'drought'));
});

test('time in words: local noon where named, a day stepped, the year\'s length, the sun held for "forever"', () => {
  const { sim, lune } = twoTowns();
  const p = sim.u.planets[0];
  run(sim, 'make it noon in Lune');
  const h0 = p.paramsAt(sim.tick, sim.u.sun(p, sim.tick)).hourAtLon0;
  const lon = Math.atan2(lune.pos[0], lune.pos[2]);
  const local = (((h0 + (lon / (Math.PI * 2)) * p.st.dayHours) % p.st.dayHours) + p.st.dayHours) % p.st.dayHours;
  assert.ok(Math.abs(local - 12) < 0.05, `noon at Lune (${local})`);
  const t = sim.tick;
  run(sim, 'go forward a day');
  assert.equal(sim.tick, t + 1440);
  run(sim, 'make it night forever');
  assert.equal(p.st.sunFrozen, true, 'the sun stands still');
  const r = run(sim, 'make the year 30 days long');
  assert.ok(Math.abs(p.st.orbit.period / (p.st.dayHours * 60) - 30) < 0.5, `${r.msg}: ${p.st.orbit.period / (p.st.dayHours * 60)} days`);
});

test('compound sentences: each clause keeps its own place, a place named once is carried', () => {
  const { sim, st, lune } = twoTowns();
  const r = sim.parse('bless Aru and curse Lune');
  assert.deepEqual(r.resolved!.map((c) => c.k), ['life.bless', 'life.curse']);
  assert.ok(near(sim, r.resolved![0].pos, st.pos, 1) && near(sim, r.resolved![1].pos, lune.pos, 1), json(r.resolved!));
  const r2 = sim.parse('make it rain on Lune and send wolves');
  assert.ok(r2.resolved!.every((c) => near(sim, c.pos, lune.pos, 1)), json(r2.resolved!));
  const r3 = sim.parse('an earthquake, a flood and a plague on Lune');
  assert.equal(r3.resolved!.length, 3);
  assert.ok(r3.resolved!.every((c) => near(sim, c.pos, lune.pos, 1)), json(r3.resolved!));
});

test('people by name: moved, made chief, silenced, possessed, struck down — that person alone', () => {
  const { sim, st, lune, hesh } = twoTowns();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  run(sim, 'move Hesh to Lune');
  assert.ok(distM(p, (sim.query('agent', { id: hesh }) as { pos: number[] }).pos, lune.pos) < 300, 'Hesh stands at Lune');
  run(sim, 'make Hesh the chief of Aru');
  assert.equal(st.leader, hesh);
  run(sim, 'possess Hesh');
  assert.ok(A.flags[A.slotOf(hesh)] & AgentFlag.possessed);
  run(sim, 'stop possessing Hesh');
  assert.ok(!(A.flags[A.slotOf(hesh)] & AgentFlag.possessed));
  const lore = (sim.query('agent', { id: hesh }) as { knowledge: string[] }).knowledge.length;
  run(sim, 'silence Hesh');
  assert.ok((sim.query('agent', { id: hesh }) as { knowledge: string[] }).knowledge.length < lore, 'Hesh forgets');
  let alive = 0;
  for (let s = 0; s < A.hi; s++) if (A.alive[s]) alive++;
  run(sim, 'smite Hesh');
  let after = 0;
  for (let s = 0; s < A.hi; s++) if (A.alive[s]) after++;
  assert.ok(A.slotOf(hesh) < 0 || !A.alive[A.slotOf(hesh)], 'Hesh is dead');
  assert.equal(after, alive - 1, 'and nobody else');
});

test('settlements: moved whole, founded from nothing, joined, built in, allied, swayed', () => {
  const { sim, st, lune } = twoTowns();
  const p = sim.u.planets[0];
  const ps = p.people;
  const before = [...st.pos];
  const up = standing(sim, st.id);
  run(sim, 'move Aru north');
  assert.ok(distM(p, st.pos, before) > 200, `Aru moved (${distM(p, st.pos, before)} m)`);
  assert.ok(st.pos[1] > before[1], 'north');
  assert.ok(standing(sim, st.id) >= up - 1, 'its buildings came with it');
  // founded from nothing (no wandering band needed)
  const n0 = ps.settlements.filter((t) => t.fallen < 0).length;
  run(sim, 'found a new town south of Lune');
  assert.equal(ps.settlements.filter((t) => t.fallen < 0).length, n0 + 1);
  // a person joins a town (not a new band)
  const pop = (ps.members.get(lune.id) ?? []).length;
  run(sim, 'add five people to Lune');
  assert.equal((ps.members.get(lune.id) ?? []).length, pop + 5);
  assert.equal(ps.settlements.filter((t) => t.fallen < 0).length, n0 + 1, 'no new settlement');
  // built
  const temple = sim.u.content.buildings.idx('temple');
  run(sim, 'build a temple in Aru');
  assert.ok(ps.buildings.some((b) => b.settlement === st.id && b.type === temple), 'a temple is planned in Aru');
  // allied
  run(sim, 'make Aru and Lune allies');
  const rel = ps.relations.find((r) => (r.a === st.polity && r.b === lune.polity) || (r.a === lune.polity && r.b === st.polity));
  assert.ok(rel?.treaties.includes('alliance'), JSON.stringify(rel));
  // swayed
  const love0 = (sim.query('settlement', { id: lune.id }) as { belief: number }).belief;
  run(sim, 'make Lune love me');
  sim.step(2);
  assert.ok((sim.query('settlement', { id: lune.id }) as { belief: number }).belief >= love0);
});

test('commands refuse unknown parameters with the right name; life.kill takes a settlement and kills only it', () => {
  const { sim, st, lune } = twoTowns();
  const bad = sim.applyNow({ k: 'terrain.raise', pos: st.pos, radios: 300 });
  assert.equal(bad.ok, false);
  assert.match(bad.msg ?? '', /radios/);
  assert.match(bad.msg ?? '', /radius/);
  const ps = sim.u.planets[0].people;
  const aru = (ps.members.get(st.id) ?? []).length;
  must(sim, { k: 'life.kill', settlement: lune.id, what: 'people' });
  assert.equal((ps.members.get(lune.id) ?? []).filter((m) => ps.agents.alive[m]).length, 0, 'Lune is dead');
  assert.equal((ps.members.get(st.id) ?? []).length, aru, 'Aru untouched');
});

test('teaching refusals read plainly, and "force" teaches anyway', () => {
  const { sim, st } = twoTowns();
  const C = sim.u.content.recipes;
  // a craft Aru lacks the groundwork for
  const lib = new Set(st.library);
  const far = C.list.find((r, i) => !lib.has(i) && (r.knowledge ?? []).length > 0 && (r.knowledge ?? []).every((k) => C.idx(k) >= 0) && (r.knowledge ?? []).some((k) => !lib.has(C.idx(k))));
  assert.ok(far, 'some craft is out of reach');
  const r = sim.applyNow({ k: 'settlement.teach', settlement: st.id, knowledge: far!.id });
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.msg ?? '', /[a-z]+-[a-z]+/, `names, not ids: ${r.msg}`);
  assert.match(r.msg ?? '', /insist|force/i, 'and says how to insist');
  must(sim, { k: 'settlement.teach', settlement: st.id, knowledge: far!.id, force: true });
  assert.ok(st.library.includes(C.idx(far!.id)), 'taught by force');
});

test('a loaded world can still be rewound to before the load, the same as the world that saved it', () => {
  const { sim } = twoTowns();
  sim.keyframeEvery = 60;
  sim.step(300);
  const t = sim.tick;
  const back = Sim.load(sim.save());
  const [lo] = back.rewindRange();
  assert.ok(lo < t, `history kept (${lo} < ${t})`);
  const target = lo + 30;
  assert.ok(sim.rewind(target) && back.rewind(target));
  assert.equal(back.hash(), sim.hash(), 'the same past');
  sim.step(40); back.step(40);
  assert.equal(back.hash(), sim.hash(), 'and the same future');
});

test('the wind blows from the quarter named, and survives the hourly climate pass', () => {
  const a = twoTowns(), b = twoTowns();
  run(a.sim, 'make the wind blow from the east for a day');
  a.sim.step(130); b.sim.step(130);
  const p = a.sim.u.planets[0], q = b.sim.u.planets[0];
  // westward push: the wind's component toward the west, averaged
  let dw = 0;
  const P = p.grid.pos;
  for (let c = 0; c < p.count; c++) {
    const x = P[c * 3], z = P[c * 3 + 2];
    const e = [z, 0, -x];
    const l = Math.hypot(e[0], e[2]) || 1;
    const west = (v: Planet0): number => -(v.f.windX[c] * e[0] + v.f.windZ[c] * e[2]) / l;
    dw += west(p) - west(q);
  }
  dw /= p.count;
  assert.ok(dw > 5, `the wind pushes west by ${dw.toFixed(1)} m/s on average after the climate pass`);
});
type Planet0 = Sim['u']['planets'][number];

test('a road laid by the god stays: road = 1, unworn by time', () => {
  const { sim } = twoTowns();
  const p = sim.u.planets[0];
  run(sim, 'lay a road from Aru to Lune');
  const cells = [...p.f.road.keys()].filter((c) => p.f.road[c] === 1);
  assert.ok(cells.length >= 3, `${cells.length} road cells`);
  sim.step(1500);
  assert.ok(cells.every((c) => p.f.road[c] === 1), 'not one has faded');
});

test('the hand: a named person thrown, a held one dropped over a town; the creature grown', () => {
  const { sim, lune, hesh } = twoTowns();
  const p = sim.u.planets[0];
  run(sim, 'pick up Hesh');
  run(sim, 'drop him on Lune');
  sim.step(5);
  assert.ok(distM(p, (sim.query('agent', { id: hesh }) as { pos: number[] }).pos, lune.pos) < 400, 'Hesh came down at Lune');
  run(sim, 'adopt an ape');
  const c = sim.u.god.creatures.find((x) => x.alive)!;
  const h = c.height;
  run(sim, 'make the creature bigger');
  assert.ok(c.height > h, `grew ${h} -> ${c.height}`);
});
