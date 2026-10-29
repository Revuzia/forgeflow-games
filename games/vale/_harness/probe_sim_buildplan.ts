// probe (lane SIM, wave W4, gameplay:G7): the bots' build plan reads the enemy team.
//
// Builds the REAL catalog in memory from content/ (tools/build_content.ts, like the bot soak) and runs
// src/sim/bots/knowledge.ts buildPlan for every fighter in its native role against fixed enemy teams
// made of real fighters (chosen by what their kits do, read from the data: never by id):
//
//   healers   the five fighters whose kits heal or drain most        → an anti-heal piece in the first three
//   none      five fighters with no heal in their kits               → no anti-heal piece
//   tanks     the front lines (frontline / warden, then divers)      → a tank breaker in the first three
//   burst     the burst styles (then divers)                         → squishies take a burst ward
//   magic / phys  all-magic and all-physical teams                   → resist vs armor tilt in the defence
//   situational   against burst a support takes a lookout and a frontline takes peel; a hunting jungler against
//                 a soft back line takes a takedown piece (integ systems-18)
//
// Checks: plans are legal (pool, unique groups, dial-slot rule, one anti-heal piece); counters appear when
// the enemy team calls for them and stay out when it does not; builds change with the enemy team; the
// Lampglass path buys support pieces first; across fighters × teams the first three pieces cover the
// finished catalog (every Gloam and Noonlit item has a buyer); determinism (same inputs, same plan).
//
//   node _harness/probe_sim_buildplan.ts      exit 0 PASS · 1 FAIL · 77 SKIP (content build failed)
import type { CatalogT, ItemDefT } from '../src/contracts/catalog.ts';
import { indexCatalog, resolveRules } from '../src/sim/catalog_index.ts';
import { buildPlan, fighterProfile, itemRole, readEnemies, type FighterProfile } from '../src/sim/bots/knowledge.ts';
import { dialClash } from '../src/sim/shop.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { check, finish, section } from './fixtures/sim_fixture.ts';

const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP probe_sim_buildplan: the content build failed'); process.exit(77); }
const catalog: CatalogT = built.catalog;
const idx = indexCatalog(catalog);
const queue = catalog.queues.find((q) => q.mode === 'rift' && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === 'rift');
if (!queue) { console.log('SKIP probe_sim_buildplan: no RIFT queue'); process.exit(77); }
const rules = resolveRules(idx, 'rift', queue.id);
const items = new Map(catalog.items.map((i) => [i.id, i] as const));
const item = (id: string): ItemDefT => items.get(id)!;
const finished = catalog.items.filter((i) => (i.tier === 'core' || i.tier === 'apex') && (i.pools.length === 0 || i.pools.includes(rules.itemPool)));
const profiles = catalog.fighters.map((f) => fighterProfile(f));
const prof = new Map(profiles.map((p) => [p.def.id, p] as const));
const roles = new Map(catalog.roles.map((r) => [r.id, r] as const));

// ── enemy teams, chosen from what the kits do ─────────────────────────────────────────────────────
const sortBy = (pred: (p: FighterProfile) => number): FighterProfile[] => profiles.slice().sort((a, b) => pred(b) - pred(a) || (a.def.id < b.def.id ? -1 : 1));
const TEAMS: Record<string, FighterProfile[]> = {
  healers: sortBy((p) => (p.heals ? 2 : 0) + (p.style === 'sustain' ? 1 : 0)).slice(0, 5),
  none: profiles.filter((p) => !p.heals && p.style !== 'frontline' && p.style !== 'warden').slice(0, 5),
  tanks: sortBy((p) => (p.style === 'frontline' || p.style === 'warden' ? 2 : p.style === 'diver' ? 1 : 0)).slice(0, 5),
  burst: sortBy((p) => (p.style === 'burst' ? 2 : p.style === 'diver' ? 1 : 0)).slice(0, 5),
  magic: sortBy((p) => (p.scaling === 'magic' ? 1 : 0)).slice(0, 5),
  phys: sortBy((p) => (p.scaling === 'phys' ? 1 : 0) + (p.heals ? -0.5 : 0)).slice(0, 5),
};
for (const [k, t] of Object.entries(TEAMS)) {
  const r = readEnemies(t);
  console.log(`  team ${k.padEnd(7)} ${t.map((p) => p.def.id).join(', ').padEnd(44)} healers ${r.healers} tanks ${r.tanks} threats ${r.threats} magic ${r.magic.toFixed(1)}`);
}

interface Seat { f: FighterProfile; role: string; jungle: boolean; support: boolean }
const seats: Seat[] = profiles.map((f) => {
  const a = roles.get(f.def.role)?.assign;
  return { f, role: f.def.role, jungle: !!a?.jungle, support: !!a?.support || f.style === 'warden' };
});
const planFor = (s: Seat, team: string, salt = 7): string[] =>
  buildPlan(idx, rules, s.f, s.jungle, { support: s.support, enemies: TEAMS[team].filter((e) => e.def.id !== s.f.def.id), salt }).core.slice();
const plans = new Map<string, string[]>();
for (const s of seats) for (const t of Object.keys(TEAMS)) plans.set(`${s.f.def.id}/${t}`, planFor(s, t));
const P = (f: string, t: string): string[] => plans.get(`${f}/${t}`) ?? [];
const first3 = (f: string, t: string): ItemDefT[] => P(f, t).slice(0, 3).map(item);

section('plans are legal', () => {
  const bad: string[] = [];
  for (const [k, plan] of plans) {
    const its = plan.map(item);
    if (its.length < 4) bad.push(`${k}: ${its.length} pieces`);
    if (its.some((i) => !finished.includes(i))) bad.push(`${k}: a piece outside the RIFT finished pool`);
    const groups = its.map((i) => i.uniqueGroup).filter((g): g is string => !!g);
    if (new Set(groups).size !== groups.length) bad.push(`${k}: two of one unique group`);
    if (its.some((a, i) => its.some((b, j) => j > i && dialClash(a, b)))) bad.push(`${k}: a dial clash`);
    if (its.filter((i) => itemRole(i).antiHeal).length > 1) bad.push(`${k}: two anti-heal pieces`);
    if (item(plan[0])?.tier !== 'core') bad.push(`${k}: the first piece is not a Gloam core`);
  }
  check(`${plans.size} plans (16 fighters × 6 enemy teams): legal, 4-5 finished pieces, first a Gloam core`, bad.length === 0, bad.slice(0, 8));
  const again = seats.every((s) => Object.keys(TEAMS).every((t) => planFor(s, t).join() === P(s.f.def.id, t).join()));
  check('determinism: the same seat, team and salt give the same plan', again);
});

section('counters follow the enemy team', () => {
  const ah = (f: string, t: string): boolean => first3(f, t).some((i) => itemRole(i).antiHeal);
  const vsHeal = seats.filter((s) => ah(s.f.def.id, 'healers'));
  const vsNone = seats.filter((s) => P(s.f.def.id, 'none').some((id) => itemRole(item(id)).antiHeal));
  console.log(`  anti-heal in the first three vs healers: ${vsHeal.map((s) => `${s.f.def.id}:${first3(s.f.def.id, 'healers').find((i) => itemRole(i).antiHeal)?.id}`).join(' ')}`);
  check(`against five healers, ≥ 75 % of fighters take an anti-heal piece in their first three (${vsHeal.length}/${seats.length})`, vsHeal.length >= 0.75 * seats.length);
  check(`against no healers, ≤ 15 % carry one anywhere in the plan (${vsNone.length}/${seats.length})`, vsNone.length <= 0.15 * seats.length, vsNone.map((s) => s.f.def.id));
  const dealers = seats.filter((s) => !s.support && !s.f.front);
  const tb = dealers.filter((s) => first3(s.f.def.id, 'tanks').some((i) => itemRole(i).tankBreak));
  const tbNone = dealers.filter((s) => first3(s.f.def.id, 'none').some((i) => itemRole(i).tankBreak));
  check(`against front lines, ≥ 60 % of damage dealers take a tank breaker in their first three (${tb.length}/${dealers.length}; ${tbNone.length} against no front line)`,
    tb.length >= 0.6 * dealers.length && tb.length > tbNone.length);
  const squish = seats.filter((s) => s.f.squishy && !s.support);
  const bw = squish.filter((s) => first3(s.f.def.id, 'burst').some((i) => itemRole(i).burstWard));
  const bwNone = squish.filter((s) => first3(s.f.def.id, 'none').some((i) => itemRole(i).burstWard));
  check(`against burst, ≥ 50 % of squishy fighters take a burst ward in their first three (${bw.length}/${squish.length}; ${bwNone.length} against no burst)`, bw.length >= 0.5 * squish.length && bw.length > bwNone.length);
  // damage mix: summed resist minus armor of the plan, magic team vs physical team
  const tilt = (f: string, t: string): number => P(f, t).reduce((a, id) => a + (item(id).stats.resist ?? 0) - (item(id).stats.armor ?? 0), 0);
  const leans = seats.filter((s) => tilt(s.f.def.id, 'magic') > tilt(s.f.def.id, 'phys')).length;
  const against = seats.filter((s) => tilt(s.f.def.id, 'magic') < tilt(s.f.def.id, 'phys')).length;
  check(`against an all-magic team plans carry more resist than against an all-physical one (${leans} lean that way, ${against} the other)`, leans > against && against <= 2);
});

section('builds change with the enemy team; the Lampglass path', () => {
  const changed = seats.filter((s) => new Set(Object.keys(TEAMS).map((t) => P(s.f.def.id, t).slice(0, 3).join('>'))).size >= 3);
  check(`≥ 80 % of fighters build at least three different first-three sets across the six teams (${changed.length}/${seats.length})`, changed.length >= 0.8 * seats.length,
    seats.filter((s) => !changed.includes(s)).map((s) => s.f.def.id));
  const sup = seats.filter((s) => s.support);
  const supOk = sup.filter((s) => Object.keys(TEAMS).every((t) => P(s.f.def.id, t).slice(0, 2).every((id) => item(id).tags.includes('support') || itemRole(item(id)).antiHeal || item(id).tags.includes('defense'))));
  check(`the Lampglass path (${sup.map((s) => s.f.def.id).join(', ')}): the first two pieces are support, defence or anti-heal pieces, never damage pieces`, supOk.length === sup.length,
    sup.filter((s) => !supOk.includes(s)).map((s) => `${s.f.def.id}: ${P(s.f.def.id, 'none').slice(0, 2)}`));
  const salts = seats.filter((s) => new Set([1, 2, 3, 4, 5, 6].map((salt) => planFor(s, 'none', salt).slice(0, 2).join('>'))).size >= 2);
  check(`a seat's taste (the salt) varies the first two pieces for ≥ 50 % of fighters against one team (${salts.length}/${seats.length})`, salts.length >= 0.5 * seats.length);
});

section('situational answers: a lookout, peel, a takedown piece (integ systems-18)', () => {
  // narrower than the counters above: each only when the match calls for it, and only for the seat that uses it
  const has = (f: string, t: string | FighterProfile[], s: Seat, pick: (i: ItemDefT) => boolean): boolean => {
    const plan = typeof t === 'string' ? P(f, t) : buildPlan(idx, rules, s.f, s.jungle, { support: s.support, enemies: t.filter((e) => e.def.id !== f), salt: 7 }).core;
    return plan.slice(0, 3).some((id) => pick(item(id)));
  };
  const sup = seats.filter((s) => s.support);
  const look = (s: Seat, t: string): boolean => has(s.f.def.id, t, s, (i) => itemRole(i).reveals);
  check(`against burst (threats ${readEnemies(TEAMS.burst).threats}), a support takes a lookout in its first three (${sup.filter((s) => look(s, 'burst')).map((s) => s.f.def.id).join(', ') || 'none'}); fewer against no burst (${sup.filter((s) => look(s, 'none')).length})`,
    sup.filter((s) => look(s, 'burst')).length >= 1 && sup.filter((s) => look(s, 'burst')).length > sup.filter((s) => look(s, 'none')).length);
  const fronts = seats.filter((s) => !s.support && (s.f.style === 'frontline' || s.f.style === 'warden'));
  const peel = (s: Seat, t: string): boolean => has(s.f.def.id, t, s, (i) => itemRole(i).peel);
  check(`against burst, a frontline takes peel in its first three (${fronts.filter((s) => peel(s, 'burst')).map((s) => s.f.def.id).join(', ') || 'none'}); fewer against no burst (${fronts.filter((s) => peel(s, 'none')).length})`,
    fronts.filter((s) => peel(s, 'burst')).length >= 1 && fronts.filter((s) => peel(s, 'burst')).length > fronts.filter((s) => peel(s, 'none')).length);
  const soft = profiles.filter((p) => p.squishy).slice(0, 5);
  const hunters = seats.filter((s) => s.jungle && !s.support && (s.f.style === 'diver' || s.f.style === 'skirmisher'));
  const td = (s: Seat, t: string | FighterProfile[]): boolean => has(s.f.def.id, t, s, (i) => itemRole(i).takedown);
  check(`against a soft back line (${readEnemies(soft).soft} squishies), a hunting jungler takes a takedown piece in its first three (${hunters.filter((s) => td(s, soft)).map((s) => s.f.def.id).join(', ') || 'none'}); fewer against front lines (${hunters.filter((s) => td(s, 'tanks')).length})`,
    hunters.filter((s) => td(s, soft)).length >= 1 && hunters.filter((s) => td(s, soft)).length > hunters.filter((s) => td(s, 'tanks')).length);
});

section('every finished item has a buyer', () => {
  const used = new Map<string, number>();
  for (const s of seats) for (const t of Object.keys(TEAMS)) for (const salt of [1, 2, 3, 4]) for (const id of planFor(s, t, salt).slice(0, 3)) used.set(id, (used.get(id) ?? 0) + 1);
  const never = finished.filter((i) => !used.has(i.id)).map((i) => i.id);
  console.log(`  first-three picks over 16 fighters × 6 teams × 4 tastes: ${[...used.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  check(`${finished.length} finished items: every one is among some fighter's first three pieces (never: ${never.join(', ') || '-'})`, never.length === 0, never);
  const anti = finished.filter((i) => itemRole(i).antiHeal).map((i) => i.id);
  check(`an anti-heal family exists (${anti.join(', ')}), one piece per damage kind`, anti.length >= 3 &&
    anti.some((id) => item(id).tags.includes('attack')) && anti.some((id) => item(id).tags.includes('magic')) && anti.some((id) => item(id).tags.includes('defense')));
});

finish('probe_sim_buildplan');
