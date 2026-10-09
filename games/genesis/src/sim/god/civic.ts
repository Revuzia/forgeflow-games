// GENESIS — the god's civic powers (CONTRACT.md §11.1, beyond the peoples' own channels in people/commands.ts): lift a
// whole settlement elsewhere (or send its people walking there), raise a building for a town, give a person a role,
// bind two peoples by a treaty, sway belief directly (love, fear, worship, conversion), silence a town, cure a
// sickness, tame wild herds, turn a person into an animal. Every act is witnessed like any other (powers.ts hooks).

import type { CommandRegistry, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { V3 } from './state.ts';
import { AgentFlag } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, MEMK, NN, NT, ROLE, TRAIT } from '../people/defs.ts';
import { interrupt } from '../people/people.ts';
import { die } from '../people/lifecycle.ts';
import { silence } from '../people/knowledge.ts';
import { tell } from '../people/story.ts';
import { agentName, settlementRef, vars, kName } from '../people/util.ts';
import { cellPos, distM, isLand } from '../people/world.ts';
import { abandon, updateTerritory } from '../people/settlement.ts';
import { updateFlow, updateResources } from '../people/resources.ts';
import { godMaterial, planBuilding } from '../people/buildings.ts';
import { ensureRelation, makePeace, polityName, polityOf, relationOf } from '../people/war.ts';
import { insertSorted } from '../people/lifecycle.ts';
import { animalDef, animalIdx, spawnHerd, herdPos } from '../life/herds.ts';
import { settlementArg } from './acts.ts';
import { godAct } from './belief.ts';
import { actor, cross, dot, fail, herePos, nearestSettlement, norm, ok, placeName, r3 } from './util.ts';

const aPos: ParamSchema = { type: 'pos', desc: 'where (unit vector or lat/lon)' };

/** roles a god can give (people/defs.ts ROLE, without 'none' and 'child') */
export const GOD_ROLES = Object.keys(ROLE).filter((k) => k !== 'none' && k !== 'child');

/** the nearest dry land cell to c (breadth-first over the grid, ascending ids per ring: deterministic) */
export function dryCell(p: Planet, c: number, rings = 40): number {
  const dry = (q: number) => isLand(p, q) && p.f.water[q] < 0.15 && p.f.lava[q] <= 0;
  if (dry(c)) return c;
  const g = p.grid;
  const seen = new Set<number>([c]);
  let fr = [c];
  for (let d = 0; d < rings && fr.length; d++) {
    const nf: number[] = [];
    for (const q of fr) for (let e = g.nbrStart[q]; e < g.nbrStart[q + 1]; e++) { const o = g.nbr[e]; if (!seen.has(o)) { seen.add(o); nf.push(o); } }
    nf.sort((a, b) => a - b);
    for (const o of nf) if (dry(o)) return o;
    fr = nf;
  }
  return -1;
}

/** rotate unit vector v by the rotation that carries a onto b (Rodrigues; identity when a = b) */
function rotator(a: ArrayLike<number>, b: ArrayLike<number>): (v: ArrayLike<number>) => V3 {
  const k = cross(a, b);
  const s = Math.hypot(k[0], k[1], k[2]);
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  if (s < 1e-12) return (v) => [v[0], v[1], v[2]];
  const ax: V3 = [k[0] / s, k[1] / s, k[2] / s];
  return (v) => {
    const kv = cross(ax, v);
    const kd = dot(ax, v);
    return norm([v[0] * c + kv[0] * s + ax[0] * kd * (1 - c), v[1] * c + kv[1] * s + ax[1] * kd * (1 - c), v[2] * c + kv[2] * s + ax[2] * kd * (1 - c)]);
  };
}

/** the god's hand lifts a whole settlement — buildings, people, herds — and sets it down around `to` */
function liftSettlement(u: Universe, p: Planet, x: PCtx, st: Settlement, c1: number): { buildings: number; people: number } {
  const to = cellPos(p, c1) as V3;
  const rot = rotator(st.pos, to);
  let nb = 0;
  for (const b of x.ps.buildings) {
    if (b.settlement !== st.id) continue;
    b.pos = rot(b.pos);
    b.cell = p.cellAt(b.pos);
    nb++;
  }
  x.ps.reindexBuildings();
  const A = x.A;
  const pt = [0, 0, 0];
  let np = 0;
  for (const m of (x.ps.members.get(st.id) ?? []).slice()) {
    if (!A.alive[m] || u.god.isHeld('agent', A.id[m])) continue;
    A.posAt(m, u.tick, pt);
    const q = rot(pt);
    interrupt(x, m);
    A.place(m, q[0], q[1], q[2], u.tick);
    const c = p.cellAt(q);
    A.cell[m] = c;
    x.ps.buckets.move(m, c);
    A.remember(m, MEMK.moved, u.tick, 0);
    np++;
  }
  for (const h of x.ps.herds) {
    if (h.owner !== st.id) continue;
    herdPos(h, u.tick, pt);
    const q = rot(pt);
    h.from = [q[0], q[1], q[2]]; h.to = [q[0], q[1], q[2]]; h.t0 = u.tick; h.t1 = u.tick; h.cell = p.cellAt(q);
  }
  st.pos = to;
  st.cell = c1;
  // the old fields stay behind (their crops run wild); the farmers lay out new ones around the new site
  st.fields = [];
  updateTerritory(x, st);
  updateFlow(x, st);
  updateResources(x, st);
  x.ps.version++;
  return { buildings: nb, people: np };
}

/** the members of a settlement who keep and spread what it knows (priests, teachers, scholars; else the leader) */
function keepersOfLore(x: PCtx, st: Settlement): number[] {
  const A = x.A;
  const members = (x.ps.members.get(st.id) ?? []).filter((m) => A.alive[m] && !(A.flags[m] & AgentFlag.child));
  const out = members.filter((m) => A.role[m] === ROLE.priest || A.role[m] === ROLE.teacher || A.role[m] === ROLE.scholar);
  if (!out.length) { const l = A.slotOf(st.leader); if (l >= 0) out.push(l); }
  if (!out.length && members.length) out.push(members.reduce((a, b) => (A.birth[a] <= A.birth[b] ? a : b)));
  return out;
}

/** everything a person learned beyond their people's upbringing; returns how many ideas were lost */
function forgetAll(x: PCtx, s: number): number {
  const A = x.A;
  const start = x.info[A.species[s]].start;
  const lost: number[] = [];
  for (let k = 0; k < x.rt.n; k++) if (A.knows(s, k) && !start.includes(k)) lost.push(k);
  for (const k of lost) silence(x, [s], k);
  return lost.length;
}

export function registerCivicCommands(r: CommandRegistry): void {
  // ── move a settlement ──
  r.register('settlement.move', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const st = settlementArg(p, { settlement: a.settlement, pos: null });
    if (!st || st.fallen >= 0) return fail('Move which settlement? Name it ("move Aru to the coast").');
    if (st.band) return fail(`${st.name} is a wandering band: it has no town to move yet.`);
    // the new place: `to`, or an explicit pos / lat / lon (a bare pos would otherwise be the camera focus)
    const want = (a.to as V3 | null) ?? (cmd.pos !== undefined || cmd.lat !== undefined || cmd.cell !== undefined ? a.pos as V3 | null : null);
    if (!want) return fail(`Move ${st.name} where? Give a place ("move ${st.name} to the coast").`);
    const c1 = dryCell(p, p.cellAt(want));
    if (c1 < 0) return fail(`There is no dry land near ${placeName(p, want)} for ${st.name}.`);
    const dist = distM(p, st.pos, cellPos(p, c1));
    if (dist < 30) return ok(`${st.name} already stands there.`);
    const g = actor(cmd);
    if (a.mode === 'migrate') {
      const name = st.name;
      const band = abandon(x, st, 'god');
      band.name = name;
      band.target = cellPos(p, c1) as V3;
      band.recent.godSite = u.tick;
      band.recent.keepName = 1;
      godAct(u, p, band.pos, 400, { wonder: 0.4, harm: 0.1 }, g);
      return ok(`The people of ${name} leave their homes and walk toward the new place (${Math.round(dist)} m away); the old town stands empty.`, [settlementRef(x, band)]);
    }
    const from = [...st.pos];
    const dest = placeName(p, cellPos(p, c1)).replace(new RegExp(`^(on|near) ${st.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), 'in the open land');
    const n = liftSettlement(u, p, x, st, c1);
    tell(u, p, 'moved.god', vars(x, st, -1, { text: `The god lifted ${st.name}, houses, hearths and people, and set it down ${Math.round(dist)} m away.` }), st, [settlementRef(x, st)], 3);
    godAct(u, p, from, 600, { wonder: 0.8, harm: 0.15 }, g);
    godAct(u, p, st.pos, 600, { wonder: 0.6 }, g);
    return ok(`The hand lifts ${st.name} — ${n.buildings} buildings and ${n.people} people — and sets it down ${dest} (${Math.round(dist)} m away).`, [settlementRef(x, st)]);
  }, {
    desc: 'Move a settlement: lifted whole by the hand, or its people sent walking to found it anew', category: 'Peoples',
    params: { settlement: { type: 'any', required: true }, to: { type: 'pos', desc: 'the new place (or pos)' }, pos: aPos, mode: { type: 'enum', values: ['lift', 'migrate'], default: 'lift' } },
  });

  // ── raise a building ──
  r.register('settlement.build', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const st = settlementArg(p, a);
    if (!st || st.fallen >= 0) return fail('Build for whom? Name a settlement ("build a temple in Aru").');
    const t = x.c.buildings.idx(String(a.type));
    if (t < 0) return fail(`There is no building called '${a.type}'.`);
    const def = x.c.buildings.list[t];
    const n = Math.max(1, Math.round(Number(a.count ?? 1)));
    let made = 0;
    // site: a construction site the people build themselves (with what they have); else the god raises it finished
    const site = a.site === true;
    for (let i = 0; i < n; i++) {
      const b = planBuilding(x, st, t, !site, site ? -1 : godMaterial(x, st, t));
      if (!b) break;
      made++;
    }
    if (!made) return fail(site ? `${st.name} cannot build a ${def.name.toLowerCase()} (no room, or nothing they know how to build it of).` : `There is no room left around ${st.name} for a ${def.name.toLowerCase()}.`);
    if (site) {
      godAct(u, p, st.pos, st.territory + 200, { wonder: 0.2 }, actor(cmd));
      return ok(`The people of ${st.name} lay out ${made === 1 ? `a ${def.name.toLowerCase()}` : `${made} ${def.name.toLowerCase()}s`} to build.`);
    }
    tell(u, p, 'built.god', vars(x, st, -1, { text: `In a night the god raised ${made === 1 ? `a ${def.name.toLowerCase()}` : `${made} ${def.name.toLowerCase()}s`} at ${st.name}.` }), st, [settlementRef(x, st)], 2);
    godAct(u, p, st.pos, st.territory + 200, { wonder: 0.5, help: 0.3 }, actor(cmd));
    return ok(`${made === 1 ? `A ${def.name.toLowerCase()} rises` : `${made} ${def.name.toLowerCase()}s rise`} at ${st.name}, finished in a moment.`);
  }, {
    desc: 'Raise a finished building for a settlement', category: 'Peoples',
    params: {
      settlement: { type: 'any' }, pos: aPos, type: { type: 'enum', values: (u) => u.content.buildings.ids(), required: true }, count: { type: 'int', min: 1, max: 20, default: 1 },
      site: { type: 'boolean', default: false, desc: 'lay out a site for the people to build (else the god raises it finished)' },
    },
  });

  // ── a role for a person ──
  r.register('agent.role', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const s = x.A.slotOf(a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const A = x.A;
    const st = x.ps.settlement(A.settlement[s]);
    const role = String(a.role);
    const rv = (ROLE as Record<string, number>)[role];
    if (A.flags[s] & AgentFlag.child) return fail(`${agentName(x, s)} is a child.`);
    if (role === 'leader') {
      if (!st) return fail(`${agentName(x, s)} belongs to no settlement to lead.`);
      st.leader = A.id[s];
      st.leaderSince = u.tick;
    }
    A.role[s] = rv;
    // the god's choice holds: role assignment keeps it (settlement.ts assignRoles reads st.recent['r<id>'])
    if (st && role !== 'leader') st.recent[`r${A.id[s]}`] = rv;
    A.remember(s, MEMK.led, u.tick, 0);
    A.love[s * 4 + actor(cmd)] = Math.min(1, A.love[s * 4 + actor(cmd)] + 0.15);
    interrupt(x, s);
    const pt = [0, 0, 0];
    A.posAt(s, u.tick, pt);
    godAct(u, p, pt, 200, { wonder: 0.3 }, actor(cmd));
    const title = role === 'leader' ? `the leader of ${st!.name}` : `a ${role}${st ? ` of ${st.name}` : ''}`;
    if (st) tell(u, p, 'role.god', vars(x, st, s, { text: `The god named ${agentName(x, s)} ${title}.` }), st, [settlementRef(x, st)], role === 'leader' ? 2 : 1);
    return ok(`${agentName(x, s)} is now ${title}.`);
  }, { desc: 'Give a person a role (leader, priest, healer, ...)', category: 'Peoples', params: { id: { type: 'int', required: true, min: 1, desc: 'agent id' }, role: { type: 'enum', values: GOD_ROLES, required: true } } });

  // ── treaties ──
  r.register('settlement.treaty', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const st = settlementArg(p, { settlement: a.settlement, pos: null });
    const o = settlementArg(p, { settlement: a.other, pos: null });
    if (!st || !o || st.id === o.id) return fail('A treaty between whom? Name two settlements ("make Aru and Lune allies").');
    if (st.polity === o.polity) return fail(`${st.name} and ${o.name} are one people already.`);
    const rel = ensureRelation(x, st.polity, o.polity);
    if (!rel) return fail(`${st.name} and ${o.name} cannot meet.`);
    insertSorted(st.contacts, o.id); insertSorted(o.contacts, st.id);
    if (rel.war >= 0) makePeace(x, rel, -1);
    const kind = a.kind === 'trade' ? 'trade-pact' : 'alliance';
    const both = kind === 'alliance' ? ['alliance', 'trade-pact'] : ['trade-pact'];
    for (const k of both) if (!rel.treaties.includes(k)) rel.treaties.push(k);
    const warm = kind === 'alliance' ? 0.6 : 0.4;
    rel.op = [r3(Math.max(rel.op[0], warm)), r3(Math.max(rel.op[1], warm))];
    rel.grievance = [0, 0];
    if (kind === 'trade-pact') rel.trade = Math.max(rel.trade, 12);
    const pa = polityName(x, polityOf(x, st)), pb = polityName(x, polityOf(x, o));
    tell(u, p, kind === 'alliance' ? 'treaty.alliance' : 'treaty.trade', vars(x, st, -1, { polity: pa, other: pb }), st, [settlementRef(x, st), settlementRef(x, o)], 2);
    godAct(u, p, st.pos, st.territory + 150, { wonder: 0.3, help: 0.2 }, actor(cmd));
    godAct(u, p, o.pos, o.territory + 150, { wonder: 0.3, help: 0.2 }, actor(cmd));
    return ok(kind === 'alliance' ? `${st.name} and ${o.name} swear an alliance (and open their markets to each other).` : `${st.name} and ${o.name} make a trade pact: their traders will come and go.`);
  }, { desc: 'Bind two peoples by a treaty (alliance or trade pact)', category: 'Peoples', params: { settlement: { type: 'any', required: true }, other: { type: 'any', required: true }, kind: { type: 'enum', values: ['alliance', 'trade'], default: 'alliance' } } });

  // ── belief ──
  r.register('belief.sway', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const g = typeof a.toGod === 'number' ? Math.max(0, Math.min(3, Math.round(a.toGod))) : actor(cmd);
    const amount = Number(a.amount ?? 0.5);
    const what = String(a.feeling ?? 'love');
    const sts: Settlement[] = [];
    if (a.everywhere === true) sts.push(...x.ps.settlements.filter((s) => s.fallen < 0));
    else {
      const st = settlementArg(p, a) ?? (a.pos ? null : nearestSettlement(p, herePos(u, p), 1500));
      if (st) sts.push(st);
    }
    if (!sts.length) return fail('Whose hearts? Name a settlement ("make Aru love me") or say everywhere.');
    const A = x.A;
    let n = 0;
    for (const st of sts) {
      for (const m of x.ps.members.get(st.id) ?? []) {
        if (!A.alive[m]) continue;
        const L = m * 4 + g, F = m * 4 + g;
        if (what === 'love' || what === 'worship' || what === 'convert') A.love[L] = Math.min(1, A.love[L] + 0.3 * amount);
        if (what === 'fear') { A.fear[F] = Math.min(1, A.fear[F] + 0.35 * amount); A.remember(m, MEMK.fear, u.tick, 0); }
        if (what === 'worship') A.traits[m * NT + TRAIT.piety] = r3(Math.min(1, A.traits[m * NT + TRAIT.piety] + 0.2 * amount));
        if (what === 'convert') {
          for (let o = 0; o < 4; o++) if (o !== g) A.love[m * 4 + o] = r3(A.love[m * 4 + o] * (1 - 0.6 * Math.min(1, amount)));
          A.remember(m, MEMK.converted, u.tick, g);
        } else if (what !== 'fear') A.remember(m, MEMK.miracle, u.tick, 0);
        A.mood[m] = Math.min(1, A.mood[m] + (what === 'fear' ? -0.1 : 0.1) * amount);
        n++;
      }
      if (what === 'convert' || what === 'worship') st.god = g;
      if (what === 'love' || what === 'worship' || what === 'convert') st.belief = r3(Math.min(1, st.belief + 0.3 * amount));
      if (what === 'fear') st.fearGod = r3(Math.min(1, st.fearGod + 0.35 * amount));
      godAct(u, p, st.pos, st.territory + 150, what === 'fear' ? { harm: 0.2 * amount, wonder: 0.2 } : { wonder: 0.3 * amount, help: 0.1 }, g);
      tell(u, p, 'belief.god', vars(x, st, -1, { text: what === 'fear' ? `A dread of the god fell on ${st.name}.` : what === 'convert' ? `${st.name} turned its heart to ${u.god.god(g)?.name ?? 'the god'}.` : what === 'worship' ? `${st.name} began to worship ${g === 0 ? 'the god' : u.god.god(g)?.name ?? 'a god'} with new devotion.` : `A warmth toward the god spread through ${st.name}.` }), st, [settlementRef(x, st)], 1);
    }
    const names = sts.length > 3 ? `${sts.length} settlements` : sts.map((s) => s.name).join(', ');
    const verb = what === 'fear' ? 'fear you' : what === 'worship' ? 'worship you' : what === 'convert' ? `turn to ${g === 0 ? 'you' : u.god.god(g)?.name ?? 'that god'}` : 'love you';
    return ok(`${names}: ${n} hearts ${what === 'fear' ? 'grow afraid' : 'are moved'} — they ${verb} more.`);
  }, {
    desc: 'Sway hearts directly: love, fear, worship, or conversion', category: 'Peoples',
    params: {
      settlement: { type: 'any' }, pos: aPos, everywhere: { type: 'boolean', default: false },
      feeling: { type: 'enum', values: ['love', 'fear', 'worship', 'convert'], default: 'love' }, amount: { type: 'number', min: 0.05, max: 3, default: 0.5 },
      toGod: { type: 'int', min: 0, max: 3, desc: 'convert to this god (0 you)' },
    },
  });

  // ── silence a town ──
  r.register('settlement.silence', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const st = settlementArg(p, a);
    if (!st) return fail('Silence whom? Name a settlement or a person.');
    const A = x.A;
    const members = (x.ps.members.get(st.id) ?? []).filter((m) => A.alive[m]);
    if (typeof a.knowledge === 'string') {
      const k = x.rt.byId.get(a.knowledge)!;
      const n = silence(x, members, k);
      godAct(u, p, st.pos, st.territory + 150, { harm: 0.2, wonder: 0.2 }, actor(cmd));
      return ok(n ? `${st.name} forgets ${kName(x, k)} (${n} minds)${st.library.includes(k) ? ' — but it is written in their books' : ''}.` : `Nobody in ${st.name} knew ${kName(x, k)}.`);
    }
    const who = a.everything === true ? members.filter((m) => !(A.flags[m] & AgentFlag.child)) : keepersOfLore(x, st);
    let lost = 0;
    for (const m of who) {
      lost += forgetAll(x, m);
      A.needs[m * NN + 5] = 0.2;
      A.remember(m, MEMK.silenced, u.tick, 0);
    }
    godAct(u, p, st.pos, st.territory + 150, { harm: 0.4, wonder: 0.3 }, actor(cmd));
    tell(u, p, 'silence.god', vars(x, st, -1, { text: a.everything === true ? `The god took the memory of ${st.name}: they woke knowing only what children know.` : `The god silenced the keepers of lore at ${st.name}.` }), st, [settlementRef(x, st)], 2);
    return ok(a.everything === true ? `${st.name} forgets: ${who.length} people lose ${lost} things they knew.` : `${who.length} keeper${who.length === 1 ? '' : 's'} of lore at ${st.name} fall silent and forget ${lost} thing${lost === 1 ? '' : 's'}.`);
  }, {
    desc: 'Silence a settlement: its keepers of lore (or everyone) forget, or the whole town forgets one idea', category: 'Ideas',
    params: { settlement: { type: 'any' }, pos: aPos, knowledge: { type: 'enum', values: (u) => u.content.recipes.ids() }, everything: { type: 'boolean', default: false } },
  });

  // ── cure a sickness ──
  r.register('life.cure', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const d = typeof a.disease === 'string' ? x.c.diseases.idx(a.disease) : -1;
    const st = a.everywhere === true ? null : settlementArg(p, a);
    const pos = a.everywhere === true ? null : (st ? st.pos : norm(a.pos ?? herePos(u, p)));
    const R = a.everywhere === true ? Infinity : st ? st.territory + 200 : (a.radius as number);
    const A = x.A;
    const pt = [0, 0, 0];
    let n = 0;
    for (let s = 0; s < A.hi; s++) {
      if (!A.alive[s] || A.disease[s] < 0 || (d >= 0 && A.disease[s] !== d)) continue;
      if (st) { if (A.settlement[s] !== st.id) continue; } else if (pos) { A.posAt(s, u.tick, pt); if (distM(p, pt, pos) > R) continue; }
      A.disease[s] = -1;
      A.flags[s] &= ~AgentFlag.sick;
      A.health[s] = Math.max(A.health[s], 0.6);
      A.remember(s, MEMK.healed, u.tick, 0);
      n++;
    }
    let herds = 0;
    for (const h of x.ps.herds) {
      if (h.sick === undefined || h.sick < 0 || (d >= 0 && h.sick !== d)) continue;
      if (pos && !st) { herdPos(h, u.tick, pt); if (distM(p, pt, pos) > R) continue; }
      if (st && distM(p, h.to, st.pos) > R) continue;
      h.sick = -1;
      herds++;
    }
    for (const s2 of x.ps.settlements) {
      if (st && s2.id !== st.id) continue;
      if (!st && pos && distM(p, s2.pos, pos) > R + s2.territory) continue;
      const co = s2.cohort;
      if (co.sick && (d < 0 || co.sick.d === d)) co.sick = undefined;
      if (s2.recent.epidemic !== undefined && (d < 0 || s2.recent.epidemic - 1 === d)) { delete s2.recent.epidemic; delete s2.recent.epidemicSince; delete s2.recent.epidemicDead; }
    }
    if (pos || st) godAct(u, p, st ? st.pos : pos, R === Infinity ? 2000 : R + 200, { help: 0.6 }, actor(cmd), 'heal');
    const what = d >= 0 ? x.c.diseases.list[d].name.toLowerCase() : 'sickness';
    return ok(n || herds ? `The ${what} lifts${st ? ` from ${st.name}` : a.everywhere === true ? ` everywhere on ${p.name}` : ` ${placeName(p, pos!)}`}: ${n} ${n === 1 ? 'person' : 'people'}${herds ? ` and ${herds} herd${herds === 1 ? '' : 's'}` : ''} made well.` : `No one there is sick with ${what}.`);
  }, {
    desc: 'Cure a sickness (one disease, or every one) in a place, a settlement, or everywhere', category: 'Life',
    params: { disease: { type: 'enum', values: (u) => u.content.diseases.ids() }, settlement: { type: 'any' }, pos: aPos, radius: { type: 'number', min: 1, max: 20000, default: 600 }, everywhere: { type: 'boolean', default: false } },
  });

  // ── tame wild herds ──
  r.register('life.tame', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const sp = a.species ? animalIdx(x, String(a.species)) : -1;
    if (a.species && sp < 0) return fail(`No ${a.species} live on ${p.name}.`);
    const st = settlementArg(p, a);
    const pos = st ? st.pos : norm(a.pos ?? herePos(u, p));
    const R = st ? st.territory + 1200 : (a.radius as number);
    const pt = [0, 0, 0];
    let n = 0, head = 0;
    for (const h of x.ps.herds) {
      if (sp >= 0 && h.species !== sp) continue;
      if (h.owner >= 0) continue;
      herdPos(h, u.tick, pt);
      if (a.everywhere !== true && distM(p, pt, pos) > R) continue;
      const keeper = st ?? nearestSettlement(p, pt, 4000);
      h.scared = -1;
      if (keeper) { h.owner = keeper.id; h.state = 4; }
      else h.state = 3;
      n++;
      head += h.count;
    }
    x.ps.version++;
    godAct(u, p, pos, Math.min(R, 3000), { wonder: 0.3, help: 0.2 }, actor(cmd));
    const name = sp >= 0 ? animalDef(x, sp).name.toLowerCase() : 'beasts';
    return ok(n ? `${Math.round(head)} ${name} grow gentle${st ? ` and follow the people of ${st.name}` : ' and come to the nearest people'}.` : `There are no wild ${name} there to tame.`);
  }, {
    desc: 'Tame wild herds: they grow gentle and come to a settlement', category: 'Life',
    params: { species: { type: 'enum', values: (u) => [...u.content.animals.ids(), ...u.planets.flatMap((pl) => pl.people.species.map((d) => d.def.id))] }, settlement: { type: 'any' }, pos: aPos, radius: { type: 'number', min: 1, max: 20000, default: 1500 }, everywhere: { type: 'boolean', default: false } },
  });

  // ── turn a person into an animal ──
  r.register('agent.transform', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const s = x.A.slotOf(a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const sp = animalIdx(x, String(a.into));
    if (sp < 0) return fail(`There is no animal called '${a.into}'.`);
    const def = animalDef(x, sp);
    const A = x.A;
    const name = agentName(x, s);
    const st = x.ps.settlement(A.settlement[s]);
    const pt = [0, 0, 0];
    A.posAt(s, u.tick, pt);
    const c = p.cellAt(pt);
    if (st) tell(u, p, 'transform.god', vars(x, st, s, { text: `The god turned ${name}${st ? ` of ${st.name}` : ''} into a ${def.name.toLowerCase()}.` }), st, [settlementRef(x, st)], 2);
    die(x, s, DEATH.god);
    const h = spawnHerd(x, sp, c, 1);
    godAct(u, p, pt, 400, { wonder: 0.8, harm: 0.4 }, actor(cmd));
    return ok(`${name} shrinks, twists and is gone: a ${def.name.toLowerCase()} stands where ${name} stood.`, [{ kind: 'animal', id: h.id, planet: p.id }]);
  }, { desc: 'Turn a person into an animal', category: 'Peoples', params: { id: { type: 'int', required: true, min: 1, desc: 'agent id' }, into: { type: 'enum', values: (u) => [...u.content.animals.ids(), ...u.planets.flatMap((pl) => pl.people.species.map((d) => d.def.id))], required: true } } });

  void relationOf;
}
