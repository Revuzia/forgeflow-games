// probe (lane W4, originality F4): the systems layer re-keyed to VALE's own stopped-dial rules, on the REAL catalog
// (built in memory from content/) and the real maps. Before/after table and owner sign-off:
// _design/reviews/fixwaves/W4_systems_rekey.md.
//   1. the gauge: no headline number of a battle spell, starter, potion, boots, ward, camp buff, the epic buff or the
//      BRIDGE start within 10 % of its reference-genre counterpart (LoL used ONLY as a gauge: numbers, never assets)
//   2. rules that no longer map one-to-one, exercised in the sim:
//      · default spell pair is not blink + heal; Glint Step leaves its shadow behind as a slowing patch
//      · starters fold into the first Gloam core (foldsInto) — the starter grows into the role's first core
//      · the dial-slot rule replaces the one-Noonlit cap (two Noonlit items must stand 4+ hours apart)
//      · Clearglass works on your own side of the Noonline, Resinburn on the enemy side (two-hit ignite)
//      · BRIDGE shops at your standing Needles (shopAccess 'needles'); its Lot has no redraws, one take, and burns down
//   Run: node _harness/probe_sim_rekey.ts
import type { CatalogT, EffectT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createSim, type Sim } from '../src/sim/sim.ts';
import { addTeamBuff } from '../src/sim/core.ts';
import { killEntity } from '../src/sim/combat.ts';
import { issueAttack } from '../src/sim/movement.ts';
import { quoteBuy } from '../src/sim/shop.ts';
import type { Entity, Player } from '../src/sim/entity.ts';
import { Rng } from '../src/sim/rng.ts';
import { DraftHost, type DraftConfig, type DraftSeatInit } from '../src/session/draft.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCopyHit, lintPlayerCopy } from '../src/ui/copy_lint.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';

const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP probe_sim_rekey: content build failed'); process.exit(77); }
const catalog: CatalogT = built.catalog;
const spell = (id: string) => catalog.setup.spells.find((s) => s.id === id)!;
const item = (id: string) => catalog.items.find((i) => i.id === id)!;
const buffDef = (id: string) => catalog.teamBuffs.find((b) => b.id === id)!;
const unit = (id: string) => catalog.units.find((u) => u.id === id)!;
const mode = (id: string) => catalog.modes.find((m) => m.id === id)!;
const queue = (id: string) => catalog.queues.find((q) => q.id === id)!;
const cd = (v: number | number[]): number => (Array.isArray(v) ? v[0] : v);
const firstOp = <K extends EffectT['op']>(effs: readonly EffectT[], op: K): Extract<EffectT, { op: K }> | undefined => {
  for (const e of effs) {
    if (e.op === op) return e as Extract<EffectT, { op: K }>;
    for (const k of ['onHit', 'onTick', 'onArrive', 'effects', 'then'] as const) {
      const sub = (e as Record<string, unknown>)[k] as EffectT[] | undefined;
      if (sub) { const f = firstOp(sub, op); if (f) return f; }
    }
  }
  return undefined;
};

// ── 1. the gauge ────────────────────────────────────────────────────────────────────────────────
// Reference-genre counterparts (League of Legends live values as recalled for the gauge, approximate; 1 m = 100 units,
// base move speed 335 units = 3.45 m/s for relative speeds). Where the reference value moved between patches, both
// readings are listed and VALE must clear every one of them.
interface Row { sys: string; what: string; vale: number; lol: number[] }
const L1_HP = 650; // a level-1 VALE fighter's max health, for %-of-max-health values
const MS0 = 3.45;
const glint = spell('glint_step'), sap = spell('saplight'), hair = spell('hairline'), hour = spell('hourstrike');
const run = spell('running_light'), shake = spell('shake_loose'), pane = spell('glass_pane');
const zoneHeal = firstOp(sap.effects, 'heal')!;
const sapTicks = (firstOp(sap.effects, 'zone')!.duration as number) / firstOp(sap.effects, 'zone')!.interval;
const paneSh = firstOp(pane.effects, 'shield')!;
const paneAmt = paneSh.amount as { base: number; level: number };
const hourDmg = firstOp(hour.effects, 'damage')!.amount as { base: number; level: number };
const flask = item('sap_flask'), lamp = item('spare_lamp');
const flaskRep = firstOp(flask.active!.effects, 'repeat')!;
const flaskTotal = flaskRep.count * (firstOp(flaskRep.effects, 'heal')!.amount as number);
const lampSummon = firstOp(lamp.active!.effects, 'summon')!;
const glassAmt = (buffDef('clearglass').passives[0].triggers[0].effects[0] as Extract<EffectT, { op: 'buff' }>).stats!.haste!;
const bridge = mode('bridge').rules;
const ROWS: Row[] = [
  { sys: 'Glint Step ~ Flash', what: 'distance m', vale: firstOp(glint.effects, 'blink')!.distance, lol: [4] },
  { sys: 'Glint Step ~ Flash', what: 'cooldown s', vale: cd(glint.cooldown), lol: [300] },
  { sys: 'Saplight ~ Heal', what: 'L1 heal (650 hp, full pool)', vale: sapTicks * ((zoneHeal.amount as { targetMaxHp: number }).targetMaxHp * L1_HP), lol: [80] },
  { sys: 'Saplight ~ Heal', what: 'L18 heal (2,500 hp, full pool)', vale: sapTicks * ((zoneHeal.amount as { targetMaxHp: number }).targetMaxHp * 2500), lol: [318] },
  { sys: 'Saplight ~ Heal', what: 'cooldown s', vale: cd(sap.cooldown), lol: [240] },
  { sys: 'Hairline ~ Ignite', what: 'cooldown s', vale: cd(hair.cooldown), lol: [180] },
  { sys: 'Hairline ~ Ignite', what: 'healing cut', vale: firstOp(hair.effects.filter((e) => e.op === 'status' && e.status === 'grievous'), 'status')!.power as number, lol: [0.4] },
  { sys: 'Hourstrike ~ Smite', what: 'L1 flat damage', vale: hourDmg.base + hourDmg.level, lol: [600] },
  { sys: 'Hourstrike ~ Smite', what: 'charges', vale: hour.charges!.max, lol: [2] },
  { sys: 'Hourstrike ~ Smite', what: 'recharge s', vale: cd(hour.charges!.recharge), lol: [90] },
  { sys: 'Running Light ~ Ghost', what: 'peak move speed', vale: firstOp(run.effects, 'status')!.power as number, lol: [0.24, 0.48] },
  { sys: 'Running Light ~ Ghost', what: 'duration s', vale: firstOp(run.effects, 'status')!.duration as number, lol: [10] },
  { sys: 'Running Light ~ Ghost', what: 'cooldown s', vale: cd(run.cooldown), lol: [210, 240] },
  { sys: 'Shake Loose ~ Cleanse', what: 'cooldown s', vale: cd(shake.cooldown), lol: [210] },
  { sys: 'Shake Loose ~ Cleanse', what: 'tenacity granted', vale: firstOp(shake.effects, 'buff')?.stats?.tenacity ?? 0, lol: [0.65] },
  { sys: 'Glass Pane ~ Barrier', what: 'L1 shield', vale: paneAmt.base + paneAmt.level, lol: [105] },
  { sys: 'Glass Pane ~ Barrier', what: 'L18 shield', vale: paneAmt.base + 18 * paneAmt.level, lol: [411] },
  { sys: 'Glass Pane ~ Barrier', what: 'duration s', vale: paneSh.duration as number, lol: [2.5] },
  { sys: 'Glass Pane ~ Barrier', what: 'cooldown s', vale: cd(pane.cooldown), lol: [180] },
  { sys: 'Notched Blade ~ Doran\'s Blade', what: 'price', vale: item('notched_blade').cost, lol: [450] },
  { sys: 'Notched Blade ~ Doran\'s Blade', what: 'attack', vale: item('notched_blade').stats.ad ?? 0, lol: [8] },
  { sys: 'Notched Blade ~ Doran\'s Blade', what: 'health', vale: item('notched_blade').stats.hp ?? 0, lol: [80] },
  { sys: 'Reading Lens ~ Doran\'s Ring', what: 'price', vale: item('reading_lens').cost, lol: [400] },
  { sys: 'Reading Lens ~ Doran\'s Ring', what: 'power', vale: item('reading_lens').stats.ap ?? 0, lol: [15, 18] },
  { sys: 'Reading Lens ~ Doran\'s Ring', what: 'health', vale: item('reading_lens').stats.hp ?? 0, lol: [70] },
  { sys: 'Ironstone Guard ~ Doran\'s Shield', what: 'price', vale: item('ironstone_guard').cost, lol: [450] },
  { sys: 'Ironstone Guard ~ Doran\'s Shield', what: 'health', vale: item('ironstone_guard').stats.hp ?? 0, lol: [110] },
  { sys: 'Grove Sickle ~ jungle starter', what: 'price', vale: item('grove_sickle').cost, lol: [450] },
  { sys: 'Sap Flask ~ Health Potion', what: 'price', vale: flask.cost, lol: [50] },
  { sys: 'Sap Flask ~ Health Potion', what: 'total heal', vale: flaskTotal, lol: [120] },
  { sys: 'Sap Flask ~ Health Potion', what: 'duration s', vale: (flaskRep.count - 1) * flaskRep.interval, lol: [15] },
  { sys: 'Sap Flask ~ Health Potion', what: 'stack', vale: flask.consumable!.maxStack, lol: [5] },
  { sys: 'Road Sandals ~ Boots', what: 'price', vale: item('road_sandals').cost, lol: [300] },
  { sys: 'Road Sandals ~ Boots', what: 'move speed (share of base)', vale: (item('road_sandals').stats.moveSpeed ?? 0) / MS0, lol: [25 / 335] },
  { sys: 'tier-2 boots ~ tier-2 boots', what: 'move speed (share of base)', vale: (item('dust_runners').stats.moveSpeed ?? 0) / MS0, lol: [45 / 335] },
  { sys: 'Dust Runners ~ Berserker\'s Greaves', what: 'price', vale: item('dust_runners').cost, lol: [1100] },
  { sys: 'Dust Runners ~ Berserker\'s Greaves', what: 'attack speed', vale: item('dust_runners').stats.attackSpeed ?? 0, lol: [0.25, 0.35] },
  { sys: 'Felt Treads ~ Mercury\'s / Plated', what: 'price', vale: item('felt_treads').cost, lol: [1100, 1200, 1250] },
  { sys: 'Felt Treads ~ Mercury\'s Treads', what: 'tenacity', vale: item('felt_treads').stats.tenacity ?? 0, lol: [0.3] },
  { sys: 'Chalk Slippers ~ Sorcerer\'s / Ionian', what: 'price', vale: item('chalk_slippers').cost, lol: [900, 1000, 1100] },
  { sys: 'Chalk Slippers ~ Ionian Boots', what: 'ability haste', vale: item('chalk_slippers').stats.haste ?? 0, lol: [10, 20] },
  { sys: 'Spare Lamp ~ Control / Stealth Ward', what: 'price', vale: lamp.cost, lol: [75] },
  { sys: 'Spare Lamp ~ Stealth Ward', what: 'lamp life s', vale: cd(lampSummon.duration), lol: [90, 120, 150] },
  { sys: 'Spare Lamp ~ Stealth Ward', what: 'lit at once', vale: lampSummon.maxAlive ?? 0, lol: [3] },
  { sys: 'Hooded Lamp ~ ward', what: 'sight m', vale: unit('hooded_lamp').sightRange, lol: [9] },
  { sys: 'Clearglass ~ blue buff', what: 'ability haste', vale: glassAmt, lol: [10] },
  { sys: 'Clearglass ~ blue buff', what: 'duration s', vale: buffDef('clearglass').duration ?? 0, lol: [120] },
  { sys: 'Resinburn ~ red buff', what: 'duration s', vale: buffDef('resinburn').duration ?? 0, lol: [120] },
  { sys: 'The Long Shade ~ Baron', what: 'attack', vale: buffDef('long_shade').stats.ad ?? 0, lol: [12, 24, 36, 48] },
  { sys: 'The Long Shade ~ Baron', what: 'duration s', vale: buffDef('long_shade').duration ?? 0, lol: [180] },
  { sys: 'BRIDGE ~ ARAM', what: 'start level', vale: bridge.startLevel, lol: [3] },
  { sys: 'BRIDGE ~ ARAM', what: 'start Gleam', vale: bridge.startGold, lol: [1400] },
  { sys: 'BRIDGE Lot ~ ARAM bench', what: 'redraws per seat', vale: queue('bridge_standard').bench!.rerolls, lol: [1, 2] },
];
section('gauge: every headline number at least 10 % from its counterpart', () => {
  const close: string[] = [];
  const lines: string[] = [];
  for (const r of ROWS) {
    const worst = Math.min(...r.lol.map((l) => (l === 0 ? (r.vale === 0 ? 0 : 1) : Math.abs(r.vale / l - 1))));
    lines.push(`${r.sys} · ${r.what}: VALE ${+r.vale.toFixed(3)} vs ${r.lol.join(' / ')} (${(worst * 100).toFixed(0)} %)`);
    if (worst < 0.1 - 1e-9) close.push(lines[lines.length - 1]);
  }
  console.log(lines.map((l) => `  ${l}`).join('\n'));
  check(`${ROWS.length} headline numbers, none within 10 % of the counterpart`, close.length === 0, close);
});

// ── 2. rules in the sim ─────────────────────────────────────────────────────────────────────────
function seat(i: number, team: number, fighter: string, spells?: string[]): SeatSetup {
  const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '';
  return { player: i, team, name: `P${i}`, fighter, skin, loadout: { spells: spells ?? catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
    controller: 'human', colorIndex: i };
}
function mkSim(modeId: string, seats: SeatSetup[]): Sim {
  const m = mode(modeId);
  const q = catalog.queues.find((x) => x.mode === modeId && x.kind === 'standard')!;
  const setup: MatchSetup = { matchId: `rekey-${modeId}`, seed: 7, queue: q.id, mode: m.id, map: m.map, seats, catalogVersion: catalog.version };
  const sim = createSim(catalog, setup, { pregameSeconds: 0 });
  for (const p of sim.world.players) if (p?.ent) p.ent.autoAttack = false;
  sim.step();
  return sim;
}
const P = (sim: Sim, i = 0): Player => sim.world.players[i];
const E = (sim: Sim, i = 0): Entity => sim.world.players[i].ent!;
const place = (sim: Sim, i: number, x: number, y: number): void => { const e = E(sim, i); e.x = x; e.y = y; e.path.length = 0; sim.world.hashDirty = true; };
const steps = (sim: Sim, sec: number): SimEvent[] => { const out: SimEvent[] = []; for (let i = 0; i < Math.round(sec * 30); i++) out.push(...sim.step()); return out; };
const cmd = (sim: Sim, c: Parameters<Sim['command']>[1], p = 0): SimEvent[] => { sim.command(p, c); return sim.step(); };
const denied = (ev: SimEvent[]): string | undefined => ofType(ev, 'announce').find((a) => a.key === 'shop_denied')?.params?.reason as string | undefined;
const FIGHTERS = catalog.fighters.map((f) => f.id).sort();
const melee = catalog.fighters.find((f) => f.attack.range < 3)!.id;

section('spells: VALE default pair; Glint Step leaves its shadow behind', () => {
  const d = catalog.setup.defaults.spells.map(spell);
  const blinks = d.some((s) => JSON.stringify(s.effects).includes('"op":"blink"')), heals = d.some((s) => JSON.stringify(s.effects).includes('"op":"heal"'));
  check('default pair is not blink + heal', !(blinks && heals), catalog.setup.defaults.spells);
  check('no default spell heals', !heals);
  const sim = mkSim('rift', [seat(0, 0, melee, ['glint_step', 'glass_pane']), seat(1, 1, FIGHTERS[1])]);
  const bs = sim.world.mapDef.bases;
  const cx = (bs[0].spawn[0] + bs[1].spawn[0]) / 2, cy = (bs[0].spawn[1] + bs[1].spawn[1]) / 2;
  place(sim, 0, cx - 6, cy); place(sim, 1, cx - 6, cy + 9); sim.step();
  const x0 = E(sim).x;
  const ev = cmd(sim, { type: 'cast', slot: 'spell1', x: x0 + 20, y: E(sim).y });
  ev.push(...steps(sim, 0.5));
  check('Glint Step: a 4.5 m blink', near(E(sim).x - x0, 4.5, 0.3), E(sim).x - x0);
  check('Glint Step: the shadow zone stays at the start', sim.world.entities.some((z) => z.kind === 'zone' && z.def === 'glint_shadow' && Math.abs(z.x - x0) < 0.6));
});

section('items: a starter grows into the first Gloam core; the dial-slot rule', () => {
  const sim = mkSim('rift', [seat(0, 0, melee), seat(1, 1, FIGHTERS[1])]);
  const b = sim.world.mapDef.bases.find((x) => x.team === 0)!;
  place(sim, 0, b.shop.at[0], b.shop.at[1]); sim.step();
  const p = P(sim);
  p.gold = 20000;
  cmd(sim, { type: 'buy', item: 'notched_blade' });
  const core = catalog.items.find((i) => i.tier === 'core' && i.tags.includes('attack'))!;
  const q = quoteBuy(sim.world, p, core.id);
  check(`fold: ${core.name} costs ${core.cost - item('notched_blade').cost} with Notched Blade carried (its full ${item('notched_blade').cost} counts)`,
    q.ok && q.price === core.cost - item('notched_blade').cost, q);
  cmd(sim, { type: 'buy', item: core.id });
  check('fold: the starter is consumed into the core', p.items.includes(core.id) && !p.items.includes('notched_blade'));
  const q2 = quoteBuy(sim.world, p, catalog.items.filter((i) => i.tier === 'core' && i.id !== core.id)[0].id);
  check('fold: only the first core (no starter left to fold)', q2.ok && q2.price === catalog.items.filter((i) => i.tier === 'core' && i.id !== core.id)[0].cost);
  const noon = catalog.items.filter((i) => i.tier === 'apex');
  const at = (h: number) => noon.find((i) => i.dial?.hour === h)!;
  cmd(sim, { type: 'buy', item: at(12).id });
  check(`dial: ${at(12).name} (12) then ${at(8).name} (8): 4 hours apart, allowed`, cmd(sim, { type: 'buy', item: at(8).id }) && p.items.includes(at(8).id));
  check(`dial: ${at(2).name} (2) refused next to ${at(12).name} (12)`, denied(cmd(sim, { type: 'buy', item: at(2).id })) === 'unique');
  check(`dial: ${at(4).name} (4) allowed: a third Noonlit item 4 hours from both`, (cmd(sim, { type: 'buy', item: at(4).id }), p.items.includes(at(4).id)));
  check('dial: no uniqueGroup noonlit is left anywhere', catalog.items.every((i) => i.uniqueGroup !== 'noonlit'));
});

section('camp buffs: Clearglass on your own side, Resinburn on the enemy side', () => {
  const sim = mkSim('rift', [seat(0, 0, melee), seat(1, 1, FIGHTERS[2])]);
  const w = sim.world;
  const own = w.mapDef.bases.find((b) => b.team === 0)!, foe = w.mapDef.bases.find((b) => b.team === 1)!;
  const mid = { x: (own.spawn[0] + foe.spawn[0]) / 2, y: (own.spawn[1] + foe.spawn[1]) / 2 };
  // just either side of the noon line, at the Seat (open ground, out of every Needle's reach)
  const ownX = mid.x + (own.spawn[0] - mid.x) * 0.08, ownY = mid.y + (own.spawn[1] - mid.y) * 0.08;
  const foeX = mid.x + (foe.spawn[0] - mid.x) * 0.08, foeY = mid.y + (foe.spawn[1] - mid.y) * 0.08;
  place(sim, 0, ownX, ownY); place(sim, 1, ownX + 30, ownY); steps(sim, 0.2);
  const h0 = E(sim).stats.haste;
  addTeamBuff(w, 0, 'clearglass');
  steps(sim, 1.2);
  check('Clearglass: +16 ability haste on your own side', near(E(sim).stats.haste - h0, 16, 1e-6), E(sim).stats.haste - h0);
  place(sim, 0, foeX, foeY); steps(sim, 1.2);
  check('Clearglass: nothing on the enemy side', near(E(sim).stats.haste, h0, 1e-6), E(sim).stats.haste);
  addTeamBuff(w, 0, 'resinburn');
  place(sim, 1, foeX + 1.5, foeY); steps(sim, 0.2);
  const tgt = E(sim, 1);
  tgt.autoAttack = false;
  issueAttack(w, E(sim), tgt);
  const ev = steps(sim, 3);
  const ign = ofType(ev, 'damage').filter((d) => d.dst === tgt.id && d.ability === 'resinburn_ignite' && d.dtype === 'magic');
  const slowed = ofType(ev, 'status').some((s) => s.dst === tgt.id && s.status === 'slow');
  check('Resinburn (enemy side): the first attack sticks resin (slow), the next ignites it (magic damage)', slowed && ign.length >= 1, { slowed, ign: ign.length });
  check('Resinburn: at most one ignite per 4 s per target', ign.length <= 1, ign.length);
  // own side: no resin
  const sim2 = mkSim('rift', [seat(0, 0, melee), seat(1, 1, FIGHTERS[2])]);
  addTeamBuff(sim2.world, 0, 'resinburn');
  place(sim2, 0, ownX, ownY); place(sim2, 1, ownX + 1.5, ownY); steps(sim2, 0.2);
  E(sim2, 1).autoAttack = false;
  issueAttack(sim2.world, E(sim2), E(sim2, 1));
  const ev2 = steps(sim2, 3);
  check('Resinburn: nothing on your own side', !ofType(ev2, 'damage').some((d) => d.ability === 'resinburn_ignite'));
  const ls = buffDef('long_shade');
  check('The Long Shade: haste and tenacity, no attack or power', !ls.stats.ad && !ls.stats.ap && (ls.stats.haste ?? 0) > 0 && (ls.stats.tenacity ?? 0) > 0, ls.stats);
});

section('BRIDGE: shop at your standing Needles', () => {
  const r = mode('bridge').rules;
  check("BRIDGE rules: no recall, shopAccess 'needles' with Needle units", r.recall === false && r.shopAccess === 'needles' && !!r.shopAt && r.shopAt.units.length > 0, [r.shopAccess, r.shopAt]);
  const sim = mkSim('bridge', [seat(0, 0, melee), seat(1, 1, FIGHTERS[3])]);
  const w = sim.world;
  const needles = w.entities.filter((e) => e.kind === 'structure' && e.team === 0 && !!e.def && r.shopAt!.units.includes(e.def));
  const outer = needles.sort((a, b) => b.x - a.x)[0];
  place(sim, 0, outer.x + 2, outer.y + 3); place(sim, 1, 140, 22); steps(sim, 0.2);
  check('alive beside your own outer Needle: you can shop', P(sim).canShop);
  place(sim, 0, outer.x + 15, outer.y); steps(sim, 0.2);
  check('alive 15 m past it: you cannot', !P(sim).canShop);
  place(sim, 0, outer.x + 2, outer.y + 3); steps(sim, 0.1);
  killEntity(w, outer, null);
  steps(sim, 0.2);
  check('once that Needle falls, its shop is gone', !P(sim).canShop);
  killEntity(w, E(sim), null);
  steps(sim, 0.2);
  check('dead: you can shop', P(sim).canShop);
});

section("BRIDGE: the Lot — no redraws, one take per seat, it burns down", () => {
  const b = queue('bridge_standard').bench!;
  check('bridge_standard Lot: 3 more per team, 0 redraws, 1 take, burns every 8 s', b.size === 3 && b.rerolls === 0 && b.swaps === 1 && b.fade === 8, b);
  const seats: DraftSeatInit[] = [];
  for (let t = 0; t < 2; t++) for (let k = 0; k < 5; k++) seats.push({ player: t * 5 + k, team: t, name: `S${t * 5 + k}`, isBot: false, isYou: t * 5 + k === 0 });
  const cfg: DraftConfig = { queue: 'bridge_standard', mode: 'bridge', protocol: 'random_bench', seats, pool: FIGHTERS, bansPerTeam: 0,
    timers: { ban: 0, pick: 25, bench: 25, finalize: 5 }, bench: { size: b.size, rerolls: b.rerolls, swaps: b.swaps, fade: b.fade } };
  const h = new DraftHost(cfg, new Rng(5), {
    brain: () => null, skins: (_s, f) => catalog.skins.filter((x) => x.fighter === f).map((x) => x.id),
    loadout: () => ({ spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() }),
    validLoadout: (_s, _f, l) => l, fighterName: (id) => id,
  });
  h.start();
  const v0 = h.view(0);
  check('16 fighters: 10 drawn and 3 on each Lot, no duplicates', v0.bench[0].length === 3 && new Set([...h.view(null).seats.map((s) => s.locked), ...h.view(null).bench[0], ...h.view(null).bench[1]]).size === 16);
  check('redraw refused (no draws)', !h.act(0, { a: 'reroll' }).ok);
  const take = v0.bench[0][2];
  check('one take from the Lot', h.act(0, { a: 'benchSwap', fighter: take }).ok && h.view(0).seats[0].locked === take);
  check('a second take is refused', (h.act(0, { a: 'benchSwap', fighter: h.view(0).bench[0][0] }) as { reason?: string }).reason === 'no_swaps');
  for (let i = 0; i < 81; i++) h.advance(0.1);
  check('after 8 s the Lot has burned down by one', h.view(0).bench[0].length === 2, h.view(0).bench[0].length);
  for (let i = 0; i < 160; i++) h.advance(0.1);
  check('by 24 s the Lot is empty', h.view(0).bench[0].length === 0 || h.view(0).phase !== 'bench', [h.view(0).bench[0].length, h.view(0).phase]);
});

section("VALE's own words in W4's player copy (originality F8, client F11)", () => {
  // W2's copy lint (src/ui/copy_lint.ts) over the content this lane owns: no genre word where VALE has its own
  // (gold → Gleam, jungle → Dialwood …), no raw stat id where the stat has a display name ('omnivamp' → Drain),
  // American spelling. W2 runs the same lint over strings.en.json and client.json.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'content');
  const files: Record<string, unknown> = {};
  for (const f of ['units', 'items', 'setup', 'team_buffs', 'modes', 'queues']) files[`content/${f}.json`] = JSON.parse(readFileSync(join(root, `${f}.json`), 'utf8'));
  for (const f of readdirSync(join(root, 'fighters')).filter((x) => x.endsWith('.json'))) files[`content/fighters/${f}`] = JSON.parse(readFileSync(join(root, 'fighters', f), 'utf8'));
  const strings = JSON.parse(readFileSync(join(root, 'strings.en.json'), 'utf8')) as Record<string, string>;
  const hits = lintPlayerCopy(files, strings).filter((h) => !h.path.startsWith('strings.'));
  check(`0 copy-lint hits in ${Object.keys(files).length} W4 content files`, hits.length === 0, hits.slice(0, 6).map(formatCopyHit));
});

finish('probe_sim_rekey');
