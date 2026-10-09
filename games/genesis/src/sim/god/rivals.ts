// GENESIS — rival gods (CONTRACT.md §11.8): optional AI gods with an alignment and a temperament, a home settlement
// and a cadence. They act through the SAME command API as the player (registry.dispatch with `god: id`): miracles for
// their believers, smiting the faithful of others, disciples and missionaries, holy wars between peoples of different
// faith. Belief competes: love for each god is held per person; a settlement's god is the one its people love most —
// when it changes, the chronicle says so (a conversion). Never a win condition: sandbox only.
//
//   benevolent  blesses (food, water, heal, fertility), sends missionaries, rarely smites
//   wrathful    smites unbelievers (lightning, fireball, plague), starts holy wars
//   trickster   storms, strange weather, gifts and thefts, odd lessons
//   jealous     smites the faithful of the player most of all, converts with missionaries

import type { CommandRegistry } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Command } from '../types.ts';
import type { Settlement } from '../people/state.ts';
import type { GodRecord } from './state.ts';
import { AgentFlag } from '../types.ts';
import { GODS } from '../people/defs.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { relationOf } from '../people/war.ts';
import { distM } from '../people/world.ts';
import { fail, ok } from './util.ts';

export const TEMPERAMENTS = ['benevolent', 'wrathful', 'trickster', 'jealous'] as const;
const NAMES = ['Vael', 'Oruk', 'Seshet', 'Imra', 'Tannu', 'Khoros', 'Lilet', 'Durn'];
const COLORS = [0x8fd6ff, 0xff6a4a, 0xb48cff, 0x7be08a];

/** settlements on a planet that hold god g (dominant) */
function faithful(p: Planet, g: number): Settlement[] {
  return (p.people?.settlements ?? []).filter((s) => s.fallen < 0 && !s.band && s.god === g);
}

function others(p: Planet, g: number): Settlement[] {
  return (p.people?.settlements ?? []).filter((s) => s.fallen < 0 && !s.band && s.god !== g);
}

/** hourly: each rival whose time has come acts once */
export function rivalsStep(u: Universe, reg: CommandRegistry): void {
  for (const g of u.god.gods) {
    if (g.kind !== 'rival' || !g.alive || u.tick < g.nextAct) continue;
    const p = u.planet(g.home.planet) ?? u.planets.find((q) => q.alive && q.people?.settlements.length);
    if (!p || !p.alive) continue;
    const cmd = choose(u, p, g);
    const act = Math.max(0.05, u.god.law('rivals.activity'));
    g.nextAct = u.tick + Math.round((300 + 600 * hashFloat(g.id, u.tick, 0x417a)) / act);
    if (!cmd) continue;
    const res = reg.dispatch(u, { ...cmd, god: g.id, planet: p.id });
    if (res.ok) {
      g.acts++;
      u.emit({ t: 'rival.act', planet: p.id, text: res.msg, data: { god: g.id, name: g.name, k: cmd.k } });
    }
  }
}

/** what a rival does now (a command, by temperament and the state of its faith) */
function choose(u: Universe, p: Planet, g: GodRecord): Command | null {
  const mine = faithful(p, g.id);
  const home = p.people?.settlement(g.home.settlement);
  const base = home && home.fallen < 0 ? home : mine[0];
  if (!base) {
    // no believers left: a revelation somewhere (wonder makes converts)
    const st = (p.people?.settlements ?? []).find((s) => s.fallen < 0 && !s.band);
    if (!st) return null;
    g.home = { planet: p.id, settlement: st.id };
    return { k: 'miracle.storm', pos: [...st.pos], radius: 300 };
  }
  const unbelievers = others(p, g.id).sort((a, b) => distM(p, a.pos, base.pos) - distM(p, b.pos, base.pos) || a.id - b.id);
  const roll = hashFloat(g.id, u.tick, 0x60d5);
  const t = g.temperament;
  const smiteK = t === 'wrathful' ? 0.45 : t === 'jealous' ? 0.4 : t === 'trickster' ? 0.2 : 0.08;
  const blessK = t === 'benevolent' ? 0.55 : t === 'trickster' ? 0.25 : 0.3;
  const target = t === 'jealous' ? unbelievers.find((s) => s.god === 0) ?? unbelievers[0] : unbelievers[0];
  // a holy war: a believing settlement and an unbelieving neighbour already at odds
  if ((t === 'wrathful' || t === 'jealous') && target && roll < 0.12) {
    const x = makeCtx(u, p);
    const r = relationOf(x, base.polity, target.polity);
    if (r && r.war < 0 && base.polity !== target.polity && Math.min(r.op[0], r.op[1]) < -0.15) return { k: 'settlement.start-war', settlement: base.id, other: target.id };
  }
  if (target && roll < smiteK) {
    const kinds = t === 'trickster' ? ['miracle.storm', 'miracle.lightning'] : ['miracle.lightning', 'miracle.fireball', 'miracle.storm'];
    const k = kinds[Math.floor(hashFloat(g.id, u.tick, 0x60d6) * kinds.length)];
    return { k, pos: [...target.pos], radius: k === 'miracle.storm' ? 350 : 40 };
  }
  if (roll < smiteK + blessK) {
    const need = mine.length ? mine[Math.floor(hashFloat(g.id, u.tick, 0x60d7) * mine.length)] : base;
    const kinds = ['miracle.food', 'miracle.water', 'miracle.heal', 'miracle.fertility', 'miracle.wood'];
    return { k: kinds[Math.floor(hashFloat(g.id, u.tick, 0x60d8) * kinds.length)], pos: [...need.pos] };
  }
  // disciples and missionaries
  const x = makeCtx(u, p);
  const members = (x.ps.members.get(base.id) ?? []).filter((m) => !(x.A.flags[m] & AgentFlag.child) && !(x.A.flags[m] & AgentFlag.disciple));
  const have = u.god.disciples.filter((d) => d.god === g.id).length;
  if (members.length && have < 4) {
    // the most devoted to it
    members.sort((a, b) => x.A.love[b * GODS + g.id] - x.A.love[a * GODS + g.id] || x.A.id[a] - x.A.id[b]);
    return { k: 'agent.make-disciple', id: x.A.id[members[0]], mode: target ? 'missionary' : 'preach', ...(target ? { target: target.id } : {}) };
  }
  return target ? { k: 'miracle.calm', pos: [...base.pos] } : { k: 'miracle.food', pos: [...base.pos] };
}

/** daily: conversions are chronicled when a settlement's god changes; faiths apart sour relations */
export function faithDaily(u: Universe, p: Planet): void {
  const ps = p.people;
  if (!ps || !ps.settlements.length) return;
  const x = makeCtx(u, p);
  const rivals = u.god.gods.some((g) => g.kind === 'rival' && g.alive);
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    const key = `${p.id}:${st.id}`;
    const before = u.god.lastGod[key];
    u.god.lastGod[key] = st.god;
    if (before === undefined || before === st.god || !rivals) continue;
    const from = before >= 0 ? u.god.god(before)?.name ?? 'an old god' : 'no god';
    const to = st.god >= 0 ? u.god.god(st.god)?.name ?? 'a new god' : 'no god at all';
    const text = st.god === 0 ? `${st.name} turned from ${from} to you.` : before === 0 ? `${st.name} turned away from you, to ${to}.` : `${st.name} turned from ${from} to ${to}.`;
    tell(u, p, 'conversion', vars(x, st, -1, { god: to, text }), st, [settlementRef(x, st)], 2);
    u.emit({ t: 'conversion', planet: p.id, pos: [...st.pos], a: before, b: st.god, ref: settlementRef(x, st), data: { from: before, to: st.god } });
  }
  if (!rivals) return;
  // two faiths side by side: opinion sours a little each day
  for (const r of ps.relations) {
    const a = ps.settlements.find((s) => s.polity === r.a && s.fallen < 0);
    const b = ps.settlements.find((s) => s.polity === r.b && s.fallen < 0);
    if (!a || !b || a.god < 0 || b.god < 0 || a.god === b.god) continue;
    r.op = [Math.max(-1, Math.round((r.op[0] - 0.01) * 1000) / 1000), Math.max(-1, Math.round((r.op[1] - 0.01) * 1000) / 1000)];
  }
}

export function registerRivalCommands(r: CommandRegistry): void {
  r.register('rival.add', ({ u, p }, a) => {
    const used = new Set(u.god.gods.filter((g) => g.alive).map((g) => g.id));
    let id = -1;
    for (let k = 1; k < GODS; k++) if (!used.has(k)) { id = k; break; }
    if (id < 0) return fail(`There can be at most ${GODS - 1} rival gods at once (remove one first).`);
    const temperament = String(a.temperament ?? TEMPERAMENTS[Math.floor(hashFloat(u.tick, id, 0x7e3) * TEMPERAMENTS.length)]);
    const name = (typeof a.name === 'string' && a.name.trim()) ? a.name.trim().slice(0, 24) : NAMES[(id * 3 + u.tick) % NAMES.length];
    // its first people: the settlement named, else the one least devoted to you
    const sts = (p.people?.settlements ?? []).filter((s) => s.fallen < 0 && !s.band);
    let home: Settlement | undefined;
    if (typeof a.settlement === 'number') home = sts.find((s) => s.id === a.settlement);
    else if (typeof a.settlement === 'string') home = sts.find((s) => s.name.toLowerCase().startsWith(String(a.settlement).toLowerCase()));
    home ??= sts.slice().sort((q, w) => q.belief - w.belief || q.id - w.id)[0];
    const align = typeof a.alignment === 'number' ? a.alignment : temperament === 'benevolent' ? 0.6 : temperament === 'trickster' ? 0 : -0.5;
    const rec: GodRecord = {
      id, name, kind: 'rival', alignment: align, temperament, home: { planet: p.id, settlement: home?.id ?? -1 }, nextAct: u.tick + 30,
      acts: 0, help: 0, harm: 0, wonder: 0, color: COLORS[id % COLORS.length], alive: true,
    };
    u.god.gods = u.god.gods.filter((g) => g.id !== id);
    u.god.gods.push(rec);
    u.god.gods.sort((q, w) => q.id - w.id);
    // a revelation in its home: the people there come to know it
    if (home && p.people) {
      const x = makeCtx(u, p);
      for (const m of x.ps.members.get(home.id) ?? []) x.A.love[m * GODS + id] = Math.min(1, x.A.love[m * GODS + id] + 0.35);
      tell(u, p, 'rival.arrives', vars(x, home, -1, { god: name, text: `A new god, ${name} the ${temperament}, spoke to the people of ${home.name}.` }), home, [settlementRef(x, home)], 3);
    } else u.chronicleAdd(p, 'god', `A new god, ${name} the ${temperament}, stirred in the sky of ${p.name}.`, 3);
    return ok(`${name}, a ${temperament} god, now walks ${p.name}${home ? ` (worshipped first at ${home.name})` : ''}.`);
  }, {
    desc: 'Add a rival god', category: 'Laws',
    params: { name: { type: 'string' }, temperament: { type: 'enum', values: [...TEMPERAMENTS] }, alignment: { type: 'number', min: -1, max: 1 }, settlement: { type: 'any' } },
  });
  r.register('rival.remove', ({ u, p }, a) => {
    const g = typeof a.id === 'number' ? u.god.god(a.id) : typeof a.name === 'string' ? u.god.gods.find((q) => q.name.toLowerCase() === String(a.name).toLowerCase()) : u.god.gods.find((q) => q.kind === 'rival' && q.alive);
    if (!g || g.kind !== 'rival' || !g.alive) return fail('There is no such rival god.');
    g.alive = false;
    u.god.disciples = u.god.disciples.filter((d) => d.god !== g.id);
    u.chronicleAdd(p, 'god', `${g.name} fell silent and was forgotten by degrees.`, 2);
    return ok(`${g.name} is gone; those who loved it will forget in time.`);
  }, { desc: 'Remove a rival god', category: 'Laws', params: { id: { type: 'int', min: 1, max: GODS - 1 }, name: { type: 'string' } } });
}
