// GENESIS — LIVING HISTORY acts of the god (LIVING.md §5.2, §6.5):
//
//   settlement.advance { settlement }      the god lifts a town into its next era: everything up to and including that
//                                          era's ideas, groundwork first (the unwilling are compelled and fear it the
//                                          more); its era clock starts again there (people/eras.ts)
//   settlement.teach { settlement, era }   the same through the teaching act: era 'next' or an era's name
//   world.terraform { planet? }            the barren-world sequence as one act: air now; when the air has warmed the
//                                          rock (or after 14 days) a world-wide storm while the seas rise into the
//                                          lowest quarter of the land; a day later the storm lifts; two days after that
//                                          grass over the land, berry scrub and forests where it is warm and wet. A
//                                          world that is alive already is left as it is. (world/planet.ts
//                                          PlanetState.terraform keeps the stage; sim.ts runPlanet steps it hourly.)

import type { CommandRegistry, Handler, CommandSchema, Args } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Command, CommandResult } from '../types.ts';
import { AgentFlag } from '../types.ts';
import { ERAS } from '../content.ts';
import { makeCtx } from '../people/ctx.ts';
import { computeEra, forceTeach, learn } from '../people/knowledge.ts';
import { advanceList, eraLabel, syncEra } from '../people/eras.ts';
import { histOf } from '../people/politics.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { habitability } from '../space/ships.ts';
import { settlementArg } from './acts.ts';
import { godAct } from './belief.ts';
import { actor, fail, ok } from './util.ts';

let REG: CommandRegistry | null = null;

/** the god's era act on a settlement: lift it into era `era` ('next' or a name) */
function advance(u: Universe, p: Planet, cmd: Command, a: Args): CommandResult {
  const st = settlementArg(p, a);
  if (!st || st.fallen >= 0) return fail('Advance whom? Name a settlement or point at one.');
  const x = makeCtx(u, p);
  const want = String(a.era ?? 'next');
  const target = want === 'next' ? st.era + 1 : (ERAS as readonly string[]).indexOf(want);
  if (target < 0) return fail(`There is no era called '${want}'.`);
  if (target > ERAS.length - 1) return fail(`${st.name} lives in the last age there is.`);
  if (target <= st.era && want !== 'next') return fail(`${st.name} is in the ${ERAS[st.era]} era already.`);
  const list = advanceList(x, st, target).sort((q, w) => x.rt.list[q].era - x.rt.list[w].era || q - w);
  if (!list.length) return fail(`${st.name} knows all there is to know up to the ${ERAS[target]} era.`);
  const slots = (x.ps.members.get(st.id) ?? []).filter((m) => !(x.A.flags[m] & AgentFlag.child));
  if (!slots.length) return fail(`${st.name} has no grown people to teach.`);
  godAct(u, p, st.pos, st.territory + 150, { wonder: 0.3 }, actor(cmd));
  const before = eraLabel(x, st);
  // the first idea is forced on them as the god's teaching (the unwilling compelled, and afraid); the rest follow as
  // lessons, every grown person taught in turn (no chronicle line per idea: one line for the age)
  const f = forceTeach(x, slots, list[0]);
  for (const k of list.slice(1)) for (const s of slots) learn(x, s, k, 'teach');
  st.era = Math.max(st.era, computeEra(x, st));
  const h = histOf(x, st);
  h.eraAt[String(st.era)] = u.tick;
  // (the age is told once, as the god's act: the daily label check finds it told)
  const label = eraLabel(x, st);
  st.firsts[`label:${label}`] ??= u.tick;
  h.label = label;
  syncEra(x, st, h);
  tell(u, p, 'era.god', vars(x, st, -1, { label, era: ERAS[st.era] }), st, [settlementRef(x, st)], 2);
  return ok(`${st.name} is lifted from ${before} into the ${ERAS[st.era]} era (${label}): ${list.length} idea${list.length === 1 ? '' : 's'} taught${f.compelled ? `; ${f.compelled} against their will, and they fear you more for it` : ''}.`);
}

/** a command run as part of a god's act already under way (no costs, no witnesses of its own) */
function quiet(u: Universe, cmd: Command): CommandResult {
  if (!REG) return fail('no registry');
  const v = REG.validate(u, cmd);
  if (!v.ok) return fail(v.msg);
  return REG.handlerOf(cmd.k)!({ u, p: v.p, cmd }, v.args);
}

/** the area-weighted mean temperature of a world's surface (°C) */
function meanTemp(p: Planet): number {
  let s = 0, a = 0;
  for (let c = 0; c < p.count; c++) { s += p.f.temperature[c] * p.grid.area[c]; a += p.grid.area[c]; }
  return a ? s / a : 0;
}

/** the warmest wet land of a world (for scrub and forest), skipping cells near `avoid` */
function goodLand(p: Planet, avoid: number[]): number {
  let best = -1, bv = -Infinity;
  const P = p.grid.pos;
  for (let c = 0; c < p.count; c += 2) {
    if (p.s.ocean[c] || p.f.water[c] > 0.3) continue;
    let near = false;
    for (const o of avoid) if (P[c * 3] * P[o * 3] + P[c * 3 + 1] * P[o * 3 + 1] + P[c * 3 + 2] * P[o * 3 + 2] > 0.995) near = true;
    if (near) continue;
    const t = p.f.temperature[c];
    const v = -Math.abs(t - 20) * 0.1 + p.f.moisture[c] * 2 + p.f.fertility[c];
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}

const at = (p: Planet, c: number) => [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]];

/** hourly while a world is being terraformed (sim.ts runPlanet) */
export function terraformStep(u: Universe, p: Planet): void {
  const tf = p.st.terraform;
  if (!tf || tf.stage >= 4) return;
  const day = p.st.dayHours * 60;
  const since = u.tick - tf.t;
  if (tf.stage === 1 && (meanTemp(p) > 12 || since >= 14 * day)) {
    quiet(u, { k: 'weather.global', kind: 'storm', planet: p.id });
    // the seas rise into the lowest quarter of the land
    const hs: number[] = [];
    for (let c = 0; c < p.count; c += 3) hs.push(p.f.surface[c]);
    hs.sort((q, w) => q - w);
    const level = Math.round(hs[Math.floor(hs.length * 0.25)] ?? p.st.seaLevel);
    if (level > p.st.seaLevel) quiet(u, { k: 'water.sea-level', value: Math.max(-5000, Math.min(5000, level)), planet: p.id });
    tf.stage = 2; tf.t = u.tick;
    u.chronicleAdd(p, 'god', `Rain fell over all of ${p.name}, and the seas filled the low places.`, 2);
  } else if (tf.stage === 2 && since >= day) {
    quiet(u, { k: 'weather.global', kind: 'none', planet: p.id });
    tf.stage = 3; tf.t = u.tick;
  } else if (tf.stage === 3 && since >= 2 * day) {
    quiet(u, { k: 'life.plant', type: 'grass', everywhere: true, density: 0.7, pos: at(p, 0), planet: p.id });
    const a = goodLand(p, []);
    const b = a >= 0 ? goodLand(p, [a]) : -1;
    if (a >= 0) { quiet(u, { k: 'life.plant', species: 'berry-bush', pos: at(p, a), radius: 1800, density: 0.5, planet: p.id }); quiet(u, { k: 'life.forest', pos: at(p, a), radius: 1400, planet: p.id }); }
    if (b >= 0) quiet(u, { k: 'life.forest', pos: at(p, b), radius: 1400, planet: p.id });
    tf.stage = 4; tf.t = u.tick;
    u.chronicleAdd(p, 'god', `Grass, scrub and forest spread over ${p.name}: a living world, waiting for its people.`, 3);
  }
}

export function registerHistoryCommands(r: CommandRegistry): void {
  REG = r;
  const settlement = { type: 'any' as const }, aPos = { type: 'pos' as const };
  const eras = ['next', ...ERAS];
  r.register('settlement.advance', ({ u, p, cmd }, a) => advance(u, p, cmd, a), {
    desc: 'Lift a settlement into its next era (everything up to it taught, willing or not)', category: 'Ideas',
    params: { settlement, pos: aPos, era: { type: 'enum', values: eras, default: 'next', desc: "'next', or an era's name" } },
  });
  // settlement.teach takes an era too ("advance Aru to the next era" is the teaching act of a whole age)
  const teach = r.handlerOf('settlement.teach');
  const ts = r.schema('settlement.teach');
  if (teach && ts) {
    const params = { ...ts.params, knowledge: { ...ts.params.knowledge, required: false }, era: { type: 'enum' as const, values: eras, desc: "a whole era: 'next' or its name" } };
    const schema: CommandSchema = { ...ts, params, anyOf: ['knowledge', 'era'] };
    const h: Handler = (ctx, a) => (a.era !== undefined && a.era !== null && a.knowledge === undefined ? advance(ctx.u, ctx.p, ctx.cmd, a) : teach(ctx, a));
    r.register('settlement.teach', h, schema);
  }
  r.register('world.terraform', ({ u, p }) => {
    const tf = p.st.terraform;
    if (tf && tf.stage < 4) return fail(`${p.name} is being made a living world already.`);
    const sp = u.content.species.idx('plains-folk');
    const fit = sp >= 0 ? habitability(u, p, sp) : { score: 0, breathe: false };
    if (p.airy && fit.breathe && fit.score > 0.3) return fail(`${p.name} is alive already: it has air, water and green land (habitable ${Math.round(fit.score * 100)}%).`);
    if (!p.airy || p.st.atmosphere.pressure < 0.5) {
      const res = quiet(u, { k: 'planet.add-air', amount: 1, planet: p.id });
      if (!res.ok) return res;
    }
    p.st.terraform = { stage: 1, t: u.tick };
    u.chronicleAdd(p, 'god', `The god breathed air onto ${p.name}.`, 2);
    return ok(`${p.name} is to be a living world: air now; when the air has warmed the rock, rain to fill the seas; then grass, scrub and forest (over the next days).`);
  }, { desc: 'Make a barren world a living one (air, seas, plants) in one act', category: 'Worlds', params: {} });
}
