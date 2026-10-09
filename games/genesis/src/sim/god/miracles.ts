// GENESIS — miracles (CONTRACT.md §11.1, §11.2, §16.5): water, food, heal, forest, storm, fire, fireball, shield,
// lightning, wood, fertility, calm, teach, meteor. A miracle is an act AND an introduction: a heal starts medicine
// (the herbalism trigger), a forest starts forestry, a fireball or a lit hearth teaches fire, lightning in a dune leaves
// glass to puzzle over. Miracles spend the god's worship for bonus potency but never fail for want of it (restraint
// mode charges up front instead: belief.ts). Every miracle is witnessed, and a creature nearby watches and learns it.
// The hand casts them (gestures map to them in powers.json); creatures cast the ones they learned, at their skill.

import type { CommandRegistry, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { CommandResult, EntityRef } from '../types.ts';
import type { V3 } from './state.ts';
import { AgentFlag } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { MEMK, NN, DEATH } from '../people/defs.ts';
import { accident, godTeach, libHas } from '../people/knowledge.ts';
import { hasPrereqs } from '../recipes/recipes.ts';
import { birth } from '../people/lifecycle.ts';
import { dropItem, interrupt } from '../people/people.ts';
import { kName } from '../people/util.ts';
import { distM } from '../people/world.ts';
import { herdPos } from '../life/herds.ts';
import { addWater } from '../fields/hydrology.ts';
import { paintWeather, clearWeather } from '../fields/weather.ts';
import { igniteArea, igniteCell, extinguishArea, fuelAt } from '../fields/fire.ts';
import { forestArea } from '../fields/vegetation.ts';
import { relationOf } from '../people/war.ts';
import { godAct, miraclePotency } from './belief.ts';
import { giveTo } from './gifts.ts';
import { hurtPeople } from './harm.ts';
import { spawnDisaster, effR, scaleDisaster } from './disasters.ts';
import { actor, cellPos3, clamp, fail, herePos, nearestSettlement, norm, ok, placeName } from './util.ts';

export const MIRACLES = ['water', 'food', 'heal', 'forest', 'storm', 'fire', 'fireball', 'shield', 'lightning', 'wood', 'fertility', 'calm', 'teach', 'meteor'] as const;
export type MiracleKind = (typeof MIRACLES)[number];

/** worship a miracle can draw on for bonus potency */
const COST: Record<string, number> = { water: 10, food: 15, heal: 20, forest: 15, storm: 15, fire: 8, fireball: 20, shield: 30, lightning: 10, wood: 8, fertility: 25, calm: 15, teach: 30, meteor: 40 };

export interface CastOpts {
  radius?: number;
  /** potency multiplier (worship bonus, a creature's skill) */
  power?: number;
  god: number;
  by: 'god' | 'creature';
  knowledge?: string;
  settlement?: number;
  duration?: number;
}

const DEFAULT_R: Record<string, number> = { water: 180, food: 300, heal: 160, forest: 220, storm: 450, fire: 80, fireball: 60, shield: 220, lightning: 30, wood: 300, fertility: 300, calm: 500, teach: 400, meteor: 90 };

/** cast a miracle at pos; returns the outcome */
export function castMiracle(u: Universe, p: Planet, kind: string, pos: V3, o: CastOpts): CommandResult {
  const k = (MIRACLES as readonly string[]).includes(kind) ? kind as MiracleKind : null;
  if (!k) return fail(`There is no miracle called '${kind}'. Known: ${MIRACLES.join(', ')}.`);
  const R = o.radius ?? DEFAULT_R[k];
  const pw = clamp(o.power ?? 1, 0.05, 5);
  const g = o.god;
  const where = placeName(p, pos);
  const x = p.people ? makeCtx(u, p) : null;
  const st = x ? (o.settlement !== undefined ? x.ps.settlement(o.settlement) ?? null : nearestSettlement(p, pos, R + 600)) : null;
  const near = (rr: number) => (x ? x.ps.settlements.filter((s) => s.fallen < 0 && distM(p, s.pos, pos) <= rr + s.territory) : []);
  const who = o.by === 'creature' ? 'The creature' : 'The god';
  void who;
  let msg = '';
  let created: EntityRef[] | undefined;
  switch (k) {
    case 'water': {
      if (p.airy) paintWeather(u, p, 'rain', pos, R * 1.4, Math.round(240 * pw), clamp(0.8 * pw, 0.2, 1.5), false);
      const vol = addWater(p, pos, R * 0.4, Math.PI * (R * 0.4) ** 2 * 0.4 * pw);
      extinguishArea(u, p, pos, R);
      for (const c of p.cellsNear(pos, R)) p.f.moisture[c] = Math.min(1, p.f.moisture[c] + 0.25 * pw);
      p.bump('moisture');
      const parched = st ? (st.recent.drought !== undefined && u.tick - st.recent.drought < 4 * 1440) || p.f.moisture[st.cell] < 0.3 : false;
      godAct(u, p, pos, R + 300, { help: (parched ? 0.7 : 0.35) * pw }, g, 'water');
      msg = `Water falls ${where}${parched ? ', and the parched land drinks' : ''} (${Math.round(vol)} m³).`;
      break;
    }
    case 'food': {
      const food = st && x ? x.info[st.species].foods.find((i) => x.c.items.list[i]?.id === 'bread') ?? x.info[st.species].foods[0] : u.content.items.idx('berries');
      const n = st && x ? Math.max(4, Math.round(((x.ps.members.get(st.id)?.length ?? 4) + 2) * 1.5 * pw)) : Math.round(20 * pw);
      if (st && food !== undefined && food >= 0) {
        const r = giveTo(u, p, st, food, n, pos, g);
        msg = r.accepted ? `Food rains down on ${st.name}: ${n} ${u.content.items.list[food].name.toLowerCase()}.` : `Food falls on ${st.name}, but they will not touch it (${r.why}).`;
      } else if (x && food !== undefined && food >= 0) {
        dropItem(x, food, n, [pos[0], pos[1], pos[2]], p.cellAt(pos), true);
        godAct(u, p, pos, R, { wonder: 0.3 }, g, 'food');
        msg = `Food appears ${where}.`;
      } else msg = `Food appears ${where}, with nobody to eat it.`;
      godAct(u, p, pos, R, {}, g, 'food');
      break;
    }
    case 'heal': {
      let healed = 0;
      if (x) {
        const A = x.A;
        const pt = [0, 0, 0];
        for (let s = 0; s < A.hi; s++) {
          if (!A.alive[s]) continue;
          A.posAt(s, u.tick, pt);
          if (distM(p, pt, pos) > R) continue;
          if (A.health[s] < 1 || A.disease[s] >= 0) healed++;
          A.health[s] = Math.min(1, A.health[s] + 0.6 * pw);
          if (pw >= 0.5) { A.disease[s] = -1; A.flags[s] &= ~(AgentFlag.sick | AgentFlag.onFire); }
          for (let n = 0; n < NN; n++) A.needs[s * NN + n] = Math.max(A.needs[s * NN + n], 0.6);
          A.remember(s, MEMK.healed, u.tick, 0);
        }
        for (const s2 of near(R)) {
          if (s2.cohort.sick && pw >= 0.5) s2.cohort.sick = null;
          accident(x, s2, 'miracle', s2.cell);
          accident(x, s2, 'miracle-heal', s2.cell);
        }
      }
      godAct(u, p, pos, R + 200, { help: 0.6 * pw }, g, 'heal');
      msg = healed ? `${healed} ${healed === 1 ? 'person is' : 'people are'} made whole ${where}.` : `A healing light passes ${where}.`;
      break;
    }
    case 'forest': {
      const n = forestArea(u, p, pos, R * Math.sqrt(pw), clamp(0.85 * pw, 0.2, 1), -1);
      if (x) for (const s2 of near(R)) { accident(x, s2, 'miracle-forest', s2.cell); accident(x, s2, 'forest', s2.cell); }
      godAct(u, p, pos, R + 300, { help: 0.2 * pw, wonder: 0.45 * pw }, g, 'forest');
      msg = n ? `A forest springs up ${where} (${n} cells).` : `Nothing will grow ${where}.`;
      break;
    }
    case 'storm': {
      if (!p.airy) return fail(`${p.name} has no air for a storm.`);
      const w = paintWeather(u, p, 'thunderstorm', pos, R, Math.round(360 * pw), clamp(1.4 * pw, 0.3, 3), false);
      if (w) created = [{ kind: 'weather', id: w.id, planet: p.id }];
      if (x) for (const s2 of near(R)) accident(x, s2, 'storm', s2.cell);
      godAct(u, p, pos, R + 400, { wonder: 0.5 * pw, harm: 0.15 * pw }, g, 'storm');
      msg = `Black clouds gather ${where}, and the thunder begins.`;
      break;
    }
    case 'fire': {
      // a gentle flame: cold hearths catch, a campfire burns on bare ground; those who see it may learn to keep it
      let lit = 0;
      if (x) {
        for (const s2 of near(R)) {
          for (const b of x.ps.of(s2.id)) {
            if (b.progress < 1 || x.c.buildings.list[b.type].heat <= 0) continue;
            b.fuel = Math.max(b.fuel, Math.round(720 * pw));
            lit++;
          }
          accident(x, s2, 'fire', s2.cell);
          accident(x, s2, 'lightning-fire', s2.cell);
          s2.recent.fire = u.tick;
        }
        x.ps.version++;
      }
      if (!lit && p.airy) {
        // a small fire on open ground near the point (never in a building's cell)
        for (const c of p.cellsNear(pos, Math.max(40, R))) {
          if (x && x.ps.bByCell.get(c).length) continue;
          if (fuelAt(p, c) > 0.05 && igniteCell(u, p, c, 0.35 * pw, 'god')) { lit++; break; }
        }
      }
      godAct(u, p, pos, R + 200, { help: 0.3 * pw, wonder: 0.35 * pw }, g, 'fire');
      msg = lit ? `Fire comes down ${where}: ${lit} hearth${lit === 1 ? '' : 's'} and flames burn.` : `A flame flickers ${where}, but finds nothing to burn.`;
      break;
    }
    case 'fireball': {
      if (!p.airy) return fail(`Nothing burns without air on ${p.name}.`);
      const n = igniteArea(u, p, pos, R * Math.sqrt(pw), 0.95);
      const hurt = hurtPeople(u, p, pos, R * 1.2, 0.8 * pw, DEATH.god, { fear: 0.5 });
      u.emit({ t: 'fireball', planet: p.id, pos: [...pos], a: R, b: pw });
      if (x) for (const s2 of near(R * 4)) { accident(x, s2, 'fireball', s2.cell); accident(x, s2, 'lightning-fire', s2.cell); accident(x, s2, 'fire', s2.cell); }
      godAct(u, p, pos, R * 6, { harm: 0.6 * pw, wonder: 0.4 * pw }, g, 'fireball');
      msg = `A ball of fire bursts ${where} (${n} cells alight${hurt.dead ? `, ${hurt.dead} dead` : ''}).`;
      break;
    }
    case 'shield': {
      const until = u.tick + Math.round((o.duration ?? 1440) * pw);
      const id = u.ids.alloc('shield');
      u.god.shields.push({ id, planet: p.id, pos: [...pos] as V3, radius: R, until, god: g });
      extinguishArea(u, p, pos, R);
      u.emit({ t: 'shield', planet: p.id, pos: [...pos], a: R, b: until, data: { id } });
      godAct(u, p, pos, R + 300, { help: 0.3 * pw, wonder: 0.4 * pw }, g, 'shield');
      msg = `A shield of light closes over ${where.replace(/^(on|near|in) /, '')} for ${Math.round((until - u.tick) / 60)} hours.`;
      break;
    }
    case 'lightning': {
      const c = p.cellAt(pos);
      u.emit({ t: 'lightning', planet: p.id, pos: [...pos], a: 1.5 * pw, data: { cell: c, god: g } });
      if (p.airy) igniteCell(u, p, c, 0.9, 'lightning');
      const hurt = hurtPeople(u, p, pos, R, 1.4 * pw, DEATH.god, { fear: 0.6 });
      if (x) {
        const dune = p.f.sand[c] > 0.8;
        for (const s2 of near(300)) { accident(x, s2, 'lightning', c); if (dune) accident(x, s2, 'lightning-dune', c); if (p.airy) accident(x, s2, 'lightning-fire', c); }
        if (dune) { const gl = x.c.items.idx('glass'); if (gl >= 0) dropItem(x, gl, 1, [pos[0], pos[1], pos[2]], c, true); }
      }
      godAct(u, p, pos, 400, { harm: 0.45 * pw, wonder: 0.35 * pw }, g, 'lightning');
      msg = `Lightning strikes ${where}${hurt.dead ? `: ${hurt.dead} killed` : ''}.`;
      break;
    }
    case 'wood': {
      const wood = u.content.items.idx('wood');
      const n = Math.round(30 * pw);
      if (st && wood >= 0) {
        const r = giveTo(u, p, st, wood, n, pos, g);
        msg = r.accepted ? `${n} logs of wood pile up in ${st.name}.` : `${st.name} will not take the wood (${r.why}).`;
      } else if (x && wood >= 0) { dropItem(x, wood, n, [pos[0], pos[1], pos[2]], p.cellAt(pos), false); msg = `A stack of wood appears ${where}.`; }
      else msg = `Wood appears ${where}, with nobody to use it.`;
      godAct(u, p, pos, R, {}, g, 'wood');
      break;
    }
    case 'fertility': {
      for (const c of p.cellsNear(pos, R)) {
        p.f.fertility[c] = Math.min(1, p.f.fertility[c] + 0.3 * pw);
        if (p.f.crop[c] > 0) p.f.crop[c] = Math.min(1, p.f.crop[c] + 0.25 * pw);
        if (p.f.grass[c] > 0) p.f.grass[c] = Math.min(1, p.f.grass[c] + 0.15 * pw);
      }
      p.bump('fertility'); p.bump('crop'); p.bump('grass'); p.vegDirty = true;
      let born = 0;
      if (x) {
        const pt = [0, 0, 0];
        for (const h of x.ps.herds) { herdPos(h, u.tick, pt); if (distM(p, pt, pos) <= R) h.count = Math.round(h.count * (1 + 0.3 * pw) * 1000) / 1000; }
        // couples are blessed with children
        for (const s2 of near(R)) {
          const A = x.A;
          const mothers = (x.ps.members.get(s2.id) ?? []).filter((m) => A.partner[m] && !(A.flags[m] & AgentFlag.child) && !(A.flags[m] & AgentFlag.elder) && (A.flags[m] & AgentFlag.female));
          for (const m of mothers.slice(0, Math.max(1, Math.round(2 * pw)))) {
            const f = A.slotOf(A.partner[m]);
            birth(x, s2, m, f);
            born++;
          }
        }
      }
      godAct(u, p, pos, R + 200, { help: 0.5 * pw }, g, 'fertility');
      msg = `The land ${where} swells with life${born ? `; ${born} child${born === 1 ? ' is' : 'ren are'} born` : ''}.`;
      break;
    }
    case 'calm': {
      const n = clearWeather(u, p, pos, R);
      extinguishArea(u, p, pos, R);
      let calmed = 0;
      if (x) {
        const A = x.A;
        const pt = [0, 0, 0];
        for (let s = 0; s < A.hi; s++) {
          if (!A.alive[s]) continue;
          A.posAt(s, u.tick, pt);
          if (distM(p, pt, pos) > R) continue;
          A.fear[s * 4] = Math.round(A.fear[s * 4] * 0.5 * 1000) / 1000;
          A.mood[s] = Math.min(1, A.mood[s] + 0.3);
          calmed++;
        }
        for (const h of x.ps.herds) { herdPos(h, u.tick, pt); if (distM(p, pt, pos) <= R && h.state === 2) h.state = 0; }
        // anger cools between neighbours
        const sts = near(R);
        for (let i = 0; i < sts.length; i++) for (let j = i + 1; j < sts.length; j++) {
          const r = relationOf(x, sts[i].polity, sts[j].polity);
          if (r) r.op = [Math.min(1, r.op[0] + 0.15 * pw), Math.min(1, r.op[1] + 0.15 * pw)];
        }
      }
      // storms and fronts nearby lose their strength
      for (const d of u.god.disasters) if (d.planet === p.id && distM(p, d.pos, pos) <= R + effR(d)) scaleDisaster(d, 0.6);
      godAct(u, p, pos, R + 200, { help: 0.4 * pw }, g, 'calm');
      msg = `A great calm settles ${where}${n ? ` (${n} storm${n === 1 ? '' : 's'} dispersed)` : ''}${calmed ? `; ${calmed} hearts are quieted` : ''}.`;
      break;
    }
    case 'teach': {
      if (!x || !st) return fail('Teach whom? There is no settlement near enough.');
      let kid = o.knowledge ? x.rt.byId.get(o.knowledge) : undefined;
      if (o.knowledge && kid === undefined) return fail(`There is no idea called '${o.knowledge}'.`);
      if (kid === undefined) kid = nextIdea(u, p, st.id);
      if (kid === undefined) return ok(`${st.name} already knows all it can grasp.`);
      const members = (x.ps.members.get(st.id) ?? []).filter((m) => !(x.A.flags[m] & AgentFlag.child));
      const n = Math.max(1, Math.ceil(members.length * clamp(0.3 * pw, 0.1, 1)));
      const res = godTeach(x, members.slice(0, n), kid);
      godAct(u, p, st.pos, st.territory + 200, { wonder: 0.3 * pw, help: 0.2 * pw }, g, 'teach');
      if (!res.taught && res.refused) {
        const why = Object.entries(res.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unwilling';
        return { ok: false, msg: `${st.name} refused ${kName(x, kid)} (${why}).` };
      }
      msg = res.taught ? `${res.taught} of ${st.name} now know ${kName(x, kid)}${res.refused ? `; ${res.refused} refused` : ''}.` : `${st.name} already knows ${kName(x, kid)}.`;
      break;
    }
    case 'meteor': {
      const d = spawnDisaster(u, p, 'meteor', { pos, radius: R, intensity: pw, god: g, cause: o.by === 'creature' ? 'creature' : 'god' });
      if (typeof d === 'string') return fail(d);
      created = [{ kind: 'disaster', id: d.id, planet: p.id }];
      msg = `A star falls toward ${where.replace(/^(on|near|in) /, '')}.`;
      break;
    }
  }
  u.emit({ t: 'miracle', planet: p.id, pos: [...pos], a: R, b: pw, text: k, data: { kind: k, god: g, by: o.by } });
  u.god.stat(`miracle.${k}`);
  return ok(msg, created);
}

/** the next idea a settlement could grasp but does not know (cheapest era first) */
export function nextIdea(u: Universe, p: Planet, sid: number): number | undefined {
  const x = makeCtx(u, p);
  const st = x.ps.settlement(sid);
  if (!st) return undefined;
  const members = x.ps.members.get(st.id) ?? [];
  const who = members.find((m) => !(x.A.flags[m] & AgentFlag.child)) ?? members[0];
  if (who === undefined) return undefined;
  let best: number | undefined, be = Infinity;
  for (const r of x.rt.list) {
    if (libHas(st, r.idx) || st.culture.taboos.includes(r.idx)) continue;
    if (r.species && !r.species.includes(st.species)) continue;
    if (!hasPrereqs(r, x.A.know, who * x.A.kw, x.A.kw)) continue;
    const score = r.era * 10 + r.difficulty;
    if (score < be) { be = score; best = r.idx; }
  }
  return best;
}

const mPos: ParamSchema = { type: 'pos', desc: 'where (unit vector or lat/lon)' };

export function registerMiracleCommands(r: CommandRegistry): void {
  for (const k of MIRACLES) {
    r.register(`miracle.${k}`, ({ u, p, cmd }, a) => {
      const g = actor(cmd);
      const pos = norm(a.pos ?? herePos(u, p));
      const power = miraclePotency(u, p, g, COST[k] ?? 10) * ((a.power as number | undefined) ?? 1);
      return castMiracle(u, p, k, pos, {
        radius: a.radius as number | undefined, power, god: g, by: 'god', knowledge: a.knowledge as string | undefined,
        settlement: typeof a.settlement === 'number' ? a.settlement : undefined, duration: a.duration as number | undefined,
      });
    }, {
      desc: `Miracle: ${k}`, category: 'Miracles',
      params: {
        pos: mPos, radius: { type: 'number', min: 5, max: 20000, desc: 'metres' }, power: { type: 'number', min: 0.05, max: 5, default: 1 },
        ...(k === 'teach' ? { knowledge: { type: 'enum', values: (u: Universe) => u.content.recipes.ids() } as ParamSchema, settlement: { type: 'any' } as ParamSchema } : {}),
        ...(k === 'shield' ? { duration: { type: 'number', min: 10, max: 1e6, default: 1440, desc: 'ticks' } as ParamSchema } : {}),
      },
    });
  }
  r.register('miracle.cast', ({ u, p, cmd }, a) => {
    const g = actor(cmd);
    const pos = norm(a.pos ?? herePos(u, p));
    const k = String(a.kind);
    const power = miraclePotency(u, p, g, COST[k] ?? 10) * ((a.power as number | undefined) ?? 1);
    return castMiracle(u, p, k, pos, { radius: a.radius as number | undefined, power, god: g, by: 'god', knowledge: a.knowledge as string | undefined });
  }, {
    desc: 'Cast any miracle (gestures map here)', category: 'Miracles',
    params: { kind: { type: 'enum', values: [...MIRACLES], required: true }, pos: mPos, radius: { type: 'number', min: 5, max: 20000 }, power: { type: 'number', min: 0.05, max: 5, default: 1 }, knowledge: { type: 'enum', values: (u) => u.content.recipes.ids() } },
  });
}

export { interrupt, cellPos3 };
