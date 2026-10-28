// GENESIS — LIVING LAND (LIVING.md §2.1): hunting. A people that knows hunting and has game within its territory and
// two kilometres beyond sends HUNTERS (15-30 % of a band's food workers, 5-15 % of a farming town's: settlement.ts
// assignRoles reads huntQuota). The hunters go out as a PARTY of 2-6, led by the most skilled, mustered at home with
// food for the trip from the store; with hunters enough a second party goes out after another herd (PARTIES_MAX — two
// parties of three rather than one of six when both can set out together): the party picks a herd
// (the most meat for the walk), TRACKS it (each leg is re-planned toward where the herd is now, as far as the daylight
// allows), camps at night where it is (perf/pace.ts: a hunt is a trip with a camp), and when it closes on the herd,
// STALKS it: one encounter for the whole party at a time, won with a chance that grows with the hunters there, their
// skill and weapons and falls with the prey's speed. A kill is butchered where it fell and the party carries home what it
// can — one carcass-load each (LOAD_KG); the rest of a big beast is left by the kill and fetched in relays while it keeps
// (CACHE_DAYS), then it is the scavengers'. Never more than a fifth of a herd at once,
// and a herd of fewer than three is spared unless the people starve. Dangerous game (aurochs, bison, bears, wolves) only
// for a party of four or more with spears or bows; prey may wound a hunter (rarely kill one). A kill of a species people
// can tame may bring young home (people/herding.ts youngFromHunt). The first great hunt of a settlement and the first
// kill of each species on a world are told in the chronicle; the books keep the kills, trips, injuries and the meat.

import type { PCtx } from './ctx.ts';
import type { Herd, Settlement } from './state.ts';
import type { TaskSpec } from './tasks.ts';
import type { AnimalDef } from '../content.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { DEATH, INV, MEMK, NS, NT, ROLE, SKILL, TASK, TRAIT } from './defs.ts';
import { animalDef, herdPos } from '../life/herds.ts';
import { sacredAnimal } from './culture.ts';
import { libHas, libraryEffect } from './knowledge.ts';
import { distM, offsetPoint, spotInCell } from './world.ts';
import { bestFood, foodDays, storeAdd, storeAny, storeTake } from './store.ts';
import { practise, die } from './lifecycle.ts';
import { camping, daylightLeft, endTrip, walkRate, walkTicks } from '../perf/pace.ts';
import { tell } from './story.ts';
import { agentRef, emitAt, settlementRef, vars } from './util.ts';
import { accident } from './knowledge.ts';
import { addFood, bump, landOf, ledger, type HuntParty } from './ledger.ts';
import { youngFromHunt } from './herding.ts';
import { statusGain } from './outlets.ts';
import { itemIdx } from './resources.ts';
import { fieldCounts } from './crops.ts';

/** how far beyond the territory hunters go for game (m) */
export const HUNT_RANGE_M = 2000;
/** a party is 2-6 hunters */
export const PARTY_MIN = 2, PARTY_MAX = 6;
/** what one hunter carries home of a kill (kg) */
export const LOAD_KG = 30;
/** the share of a beast's live weight that is meat once it is butchered (a deer of 80 kg gives ~34 kg) */
export const DRESSED = 0.42;
/** a party gives up after this many days out */
export const PARTY_DAYS = 4;
/**
 * LAND round 5 (2026-10-21): a band with hunters enough sends out a second party while the first is away — a party
 * of 2-3 was out ~3 days for one boar (`r5/pprobe.ts`: 13 parties, 7 kills in five years on seed 7), and the other
 * hunters gathered. At most this many parties of a settlement are out at once, each after its own herd.
 */
export const PARTIES_MAX = 2;
/**
 * A party musters at home: hunters within this of the settlement's centre (m), who set out together with the trip's food
 * from the store (PARTY_FOOD_DAYS). It took any hunter in the territory and the walk out of the one gathering 850 m off
 * began when its session ended; without food in hand they walked home from the herd to eat (`r5/tprobe.ts`).
 */
export const MUSTER_M = 250;
export const PARTY_FOOD_DAYS = 2;
/**
 * The rest of a big kill: what the hunters there cannot carry (more than CACHE_MIN_KG) is left by the kill, and they
 * come back for it in relays while it keeps (CACHE_DAYS) — a party of three carried home 90 of a wild horse's 150 kg and
 * left the rest to the scavengers (seed 7's game was horses and aurochs).
 */
export const CACHE_MIN_KG = 15, CACHE_DAYS = 1.5;
/** encounters of a party are at least this far apart (ticks): the hunters there wait for one another */
const ENCOUNTER_GAP = 60;

const _p = [0, 0, 0];
const _q = [0, 0, 0];

/** the settlement is starving (a famine notice in the last 6 days, or under a day of food a head) */
export function famine(x: PCtx, st: Settlement): boolean {
  if (st.recent.famineAt !== undefined && x.tick - st.recent.famineAt < 6 * x.day) return true;
  const n = (x.ps.members.get(st.id)?.length ?? 0) + st.cohort.n[1];
  return n > 0 && foodDays(x, st) < n * 0.5;
}

/** a farming town (fields worked), not a band living off the wild */
export function farming(x: PCtx, st: Settlement): boolean {
  const ag = x.rt.byId.get('agriculture');
  return ag !== undefined && libHas(st, ag) && st.fields.length >= 3;
}

/** the settlement holds spears or bows (store, or in its hunters' hands) */
export function armed(x: PCtx, st: Settlement): boolean {
  const tags = x.c.itemsByTag.get('hunt') ?? [];
  if (tags.length && storeAny(st, tags) >= 1) return true;
  const A = x.A;
  for (const m of x.ps.members.get(st.id) ?? []) {
    const t = A.tool[m];
    if (t >= 0 && (x.c.items.list[t].tags.includes('hunt') || x.c.items.list[t].tags.includes('weapon'))) return true;
  }
  return false;
}

/** the weight of one butchered carcass (kg) and its products: meat by the beast's weight, the rest as animals.json lists */
export function carcass(a: AnimalDef): { item: string; qty: number }[] {
  const mass = a.mass ?? 60 * a.size * a.size * a.size;
  const out: { item: string; qty: number }[] = [];
  let meat = false;
  for (const io of a.products) {
    if (!io.item) continue;
    if (io.item === 'meat') { out.push({ item: 'meat', qty: Math.max(io.qty, Math.round(mass * DRESSED * 10) / 10) }); meat = true; }
    else out.push({ item: io.item, qty: io.qty });
  }
  if (!meat) out.unshift({ item: 'meat', qty: Math.round(mass * DRESSED * 10) / 10 });
  return out;
}

/**
 * Is herd h game for the hunters of st? A wild herd of the land (no fish, birds, insects or kept beasts), not their
 * sacred animal, three head or more (fewer only in famine), dangerous prey only when `bold` (a party of 4+ with weapons).
 */
export function isGame(x: PCtx, st: Settlement, h: Herd, bold: boolean, hungry: boolean): boolean {
  if (h.owner >= 0 || h.count < 1) return false;
  const a = animalDef(x, h.species);
  if (a.habitat !== 'land' || a.domestic || a.kind === 'insect' || a.kind === 'fish' || a.kind === 'domestic' || a.kind === 'bird') return false;
  if (a.danger >= 0.3 && !bold) return false;
  if (h.count < 3 && !hungry) return false;
  return !sacredAnimal(x, st, h.species);
}

/** how far the hunters of st range from its centre (m): the territory and two kilometres beyond */
export function huntRange(st: Settlement): number {
  return st.territory + HUNT_RANGE_M;
}

/**
 * The best game for a party of n of st from point `from`: the most meat they can carry home for the walk (null none).
 * Herds another party of this settlement already follows are left alone.
 */
export function bestGame(x: PCtx, st: Settlement, from: ArrayLike<number>, n: number, bold: boolean, skip?: readonly number[]): Herd | null {
  const hungry = famine(x, st);
  const range = huntRange(st);
  const P = x.p.grid.pos, R = x.p.st.radius;
  let best: Herd | null = null, bv = 0;
  for (const h of x.ps.herds) {
    if (!isGame(x, st, h, bold, hungry) || (skip && skip.includes(h.id))) continue;
    const hc = h.cell;
    // (fix r2 #2) game standing in water (a herd at the shore's edge cell) is not walked to: a coastal party sent after
    // it stood at the shore re-planning a leg of no length every few minutes
    if (x.p.f.water[hc] > 0.6 || x.p.s.ocean[hc]) continue;
    const dHome = Math.acos(Math.min(1, P[hc * 3] * st.pos[0] + P[hc * 3 + 1] * st.pos[1] + P[hc * 3 + 2] * st.pos[2])) * R;
    if (dHome > range) continue;
    const d = Math.acos(Math.min(1, P[hc * 3] * from[0] + P[hc * 3 + 1] * from[1] + P[hc * 3 + 2] * from[2])) * R;
    const a = animalDef(x, h.species);
    const kg = carcassKg(a);
    const take = Math.min(kg * Math.max(1, Math.floor(h.count * 0.2)), n * LOAD_KG);
    const v = (take * (1 - a.flee * 0.4)) / (d + 300);
    if (v > bv || (v === bv && best && h.id < best.id)) { bv = v; best = h; }
  }
  return best;
}

function carcassKg(a: AnimalDef): number {
  let kg = 0;
  for (const p of carcass(a)) kg += p.qty * itemKg(p.item);
  return kg;
}

const KG: Record<string, number> = { meat: 1, hide: 3, fur: 2, bone: 1, wool: 1, chitin: 1 };
function itemKg(id: string): number {
  return KG[id] ?? 1;
}

/** the share of the food workers who hunt: in a band living off the wild (LIVING §2.1: 15-30 %; round 5: the top of the
 * range, so two parties can be out), and in a farming town (5-15 %) */
export const HUNTERS_BAND = 0.3, HUNTERS_TOWN = 0.15;
/**
 * (fix r1 #11, the owner's 'hunting/herding where game exists') A farming village went on hunting: for hides and furs as
 * well as meat, all together in the slack of the farming year, and after the wolves that took its beasts. Before this
 * a farming town (10 % of its food workers hunters, a party only while the meat in store was under a day a head) all but
 * stopped hunting after its first decade with herds 150-300 m off (r6 alone runs: 28/27/1/1/1 parties a decade on seed 3;
 * kills 3.9 per 100 people a year against >= 20, hunted share of food 0.065 against 0.15-0.35; 900 head of village
 * livestock taken by predators in 8 x 50 years and never answered).
 *   HIDES_PER_HEAD: below this many hides and furs a head in store the hunters go out though meat is in store.
 *   FOLK_HUNT_DAYS: a farming town's folk hunt — its hunters with able men and women at home (farmers unless a field is
 *     ripe, herders, gatherers, crafters, builders) — once in this many days. (A slack-season gate was tried first: with
 *     fields sown in turn a town always had one ripe or waiting, and seed 3's folk hunt never came — fix/bud/folkdbg.ts.)
 *   RAID_DAYS: a pack that took the town's beasts is hunted down (hunters and herders) while its trail is this fresh.
 */
export const HIDES_PER_HEAD = 0.25, FOLK_HUNT_DAYS = 3, RAID_DAYS = 2;
/**
 * (fix r1, stint 5) The folk hunt and the hunt for a raiding pack are built but OFF by default (0): on the acceptance
 * re-run (fix/acc/out vs integrate/r6/out, 4 worlds left alone for 45-50 years) a farming town with them bore 30-60 % fewer
 * children (births 52/75, 74/125, 57/83, 42/103), its hunters were hurt 2-30x as often (8/4, 48/17, 95/3, 87/5) and a
 * predator killed 13-14 of them on two worlds (0-1 before): able farmers away on multi-day trips every third day of a
 * 12-day year, and herders sent after wolf packs. With both off (fix/hv/noboth, seed 2, 25 years) births 37 and the town
 * at 46 (r6: 38, 49). A re-tune (a folk hunt a year, day trips; a pack hunted by armed hunters only) is open (LIVING §11.3).
 * Tests turn them on through this object (and restore it); the sim never writes it.
 */
export const HUNT_TUNE = { folkDays: 0, raidDays: 0 };

/** hunters wanted (settlement.ts assignRoles): of `food` food workers, when hunting is known and game is within range */
export function huntQuota(x: PCtx, st: Settlement, food: number): number {
  const k = x.rt.byId.get('hunting');
  if (k === undefined || !libHas(st, k) || st.besieged >= 0 || food < 2) return 0;
  const easy = bestGame(x, st, st.pos, PARTY_MIN, false);
  // only dangerous game within range (aurochs, bison, bears): a party of four with spears (planJobs makes spears for
  // the hunters it has)
  if (!easy && !bestGame(x, st, st.pos, 4, true)) return 0;
  const share = farming(x, st) ? HUNTERS_TOWN : HUNTERS_BAND;
  let n = Math.round(food * share);
  if (n < PARTY_MIN && food >= 4) n = PARTY_MIN;
  if (!easy && n < 4 && food >= 6) n = 4;
  return Math.min(n, food - 1);
}

/** the parties of st out now, the first one first */
export function parties(st: Settlement): HuntParty[] {
  const L = st.land;
  if (!L) return [];
  const out: HuntParty[] = [];
  if (L.party) out.push(L.party);
  if (L.more) for (const p of L.more) out.push(p);
  return out;
}

/** agent ids of st's hunting parties while they are out (settlement.ts assignRoles keeps them hunters until back) */
export function partyOut(st: Settlement): readonly number[] {
  const L = st.land;
  if (!L?.more?.length) return L?.party?.members ?? [];
  const ids: number[] = [];
  for (const p of parties(st)) for (const id of p.members) ids.push(id);
  return ids;
}

/** the party of st agent s belongs to (null none) */
export function partyOf(x: PCtx, st: Settlement, s: number): HuntParty | null {
  const id = x.A.id[s];
  for (const p of parties(st)) if (p.members.includes(id)) return p;
  return null;
}

/**
 * Hourly (people/land.ts): a party sets out in the morning when two or more hunters are at home and game is within
 * range — a second one while the first is away when there are hunters enough (PARTIES_MAX), after other game; a party
 * that has made its kill and come home, lost its game, or been out too long, breaks up.
 */
export function huntHourly(x: PCtx, st: Settlement): void {
  const L = landOf(st);
  const A = x.A;
  if (L.party && !keepParty(x, st, L.party)) L.party = null;
  if (L.more) {
    L.more = L.more.filter((p) => keepParty(x, st, p));
    if (!L.party && L.more.length) L.party = L.more.shift()!;
    if (!L.more.length) delete L.more;
  }
  const out = parties(st);
  if (out.length >= PARTIES_MAX) return;
  // a new party: hunters of the settlement at home and free, in the morning (the walk out wants the day), when the meat
  // in store runs low (a store full of grain is no reason to rest the spears; one full of meat is)
  const k = x.rt.byId.get('hunting');
  if (k === undefined || !libHas(st, k) || st.besieged >= 0) return;
  if (daylightAt(x, st) < 6 * 60) return;
  const heads = (x.ps.members.get(st.id)?.length ?? 0) + st.cohort.n[1];
  // (fix r1 #11) why the spears go out: meat running low or famine, hides and furs wanted, a pack that took the town's
  // beasts, or a farming town's folk hunt (the last two muster other able adults at home too)
  const raid = out.length ? null : raidingPack(x, st);
  const folk = raid === null && !out.length && folkHuntDue(x, st);
  if (raid === null && !folk && !famine(x, st) && meatDays(x, st) >= MEAT_DAYS * heads && hidesIn(x, st) >= HIDES_PER_HEAD * heads) return;
  const helpers = raid !== null || folk;
  const ripe = helpers && fieldCounts(st)[2] > 0;
  const busy = out.length ? partyOut(st) : null;
  const hunters: number[] = [];
  for (const m of x.ps.members.get(st.id) ?? []) {
    const r = A.role[m];
    if (!(r === ROLE.hunter || (helpers && (HELPERS.includes(r) || (r === ROLE.farmer && !ripe))))) continue;
    if (A.mission[m] || A.flags[m] & AgentFlag.child || A.health[m] < 0.55 || A.camp[m] >= 0) continue;
    if (busy && busy.includes(A.id[m])) continue;
    // at home (the party sets out together), not still on the way back with the last kill
    A.posAt(m, x.tick, _p);
    if (distM(x.p, _p, st.pos) > Math.min(MUSTER_M, st.territory + 100) || carriedKg(x, m) > 5) continue;
    hunters.push(m);
  }
  if (hunters.length < PARTY_MIN) return;
  // (a folk hunt is tried once in FOLK_HUNT_DAYS, a pack once: the people were home, with or without game for them)
  if (folk) st.recent.folkHunt = x.tick;
  if (raid !== null) { delete st.recent.raidAt; delete st.recent.raidBy; }
  // the most skilled lead (ties: the elder id); hunters before the others who take up the spear
  hunters.sort((a, b) => Number(A.role[b] === ROLE.hunter) - Number(A.role[a] === ROLE.hunter) || A.skills[b * NS + SKILL.hunt] - A.skills[a * NS + SKILL.hunt] || A.id[a] - A.id[b]);
  if (helpers) {
    // one party, after the pack (when it is game for them: dangerous beasts want four with spears or bows) or the best game
    const party = hunters.slice(0, PARTY_MAX);
    const bold = party.length >= 4 && armed(x, st);
    const g = raid !== null ? (isGame(x, st, raid, bold, true) ? raid : null) : bestGame(x, st, st.pos, party.length, bold);
    if (!g) return;
    // they are hunters until the party is home (assignRoles keeps a party out hunting, then gives the roles out again)
    for (const m of party) A.role[m] = ROLE.hunter;
    const np: HuntParty = { id: x.tick, members: party.map((m) => A.id[m]), herd: g.id, species: g.species, since: x.tick, lastTry: -1, kills: 0 };
    L.party = np;
    for (const m of party) provision(x, st, m, PARTY_FOOD_DAYS);
    ledger(x, st).huntTrips++;
    return;
  }
  let free = hunters;
  while (out.length < PARTIES_MAX && free.length >= PARTY_MIN) {
    // hunters enough at home for two parties and none out: two parties of 2-3, after two herds (a party of three hunts as
    // well as a crowd of six), unless only dangerous game is near — that wants the four together
    const all = Math.min(PARTY_MAX, free.length);
    const n = !out.length && PARTIES_MAX > 1 && free.length >= 2 * PARTY_MIN + 1 ? Math.ceil(free.length / 2) : all;
    const skip = out.map((q) => q.herd);
    let party = free.slice(0, n);
    let g = bestGame(x, st, st.pos, party.length, party.length >= 4 && armed(x, st), skip);
    if (!g && n < all) { party = free.slice(0, all); g = bestGame(x, st, st.pos, party.length, party.length >= 4 && armed(x, st), skip); }
    if (!g) return;
    const np: HuntParty = { id: x.tick + out.length, members: party.map((m) => A.id[m]), herd: g.id, species: g.species, since: x.tick, lastTry: -1, kills: 0 };
    if (!L.party) L.party = np; else (L.more ??= []).push(np);
    out.push(np);
    for (const m of party) provision(x, st, m, PARTY_FOOD_DAYS);
    ledger(x, st).huntTrips++;
    free = free.slice(party.length);
  }
}

/** (fix r1 #11) hides and furs in st's store */
function hidesIn(x: PCtx, st: Settlement): number {
  let n = 0;
  for (const id of ['hide', 'fur']) { const it = itemIdx(x, id); if (it >= 0) n += st.store[it] ?? 0; }
  return n;
}

/**
 * (fix r1 #11) the pack that took st's beasts (life/ecology.ts stamps `recent.raidAt` / `raidBy`), while its trail is
 * fresh (RAID_DAYS) and it is within the hunters' range; null none (a stale mark is forgotten)
 */
function raidingPack(x: PCtx, st: Settlement): Herd | null {
  const t = st.recent.raidAt;
  if (t === undefined) return null;
  if (HUNT_TUNE.raidDays <= 0 || x.tick - t > HUNT_TUNE.raidDays * x.day) { delete st.recent.raidAt; delete st.recent.raidBy; return null; }
  const h = x.ps.herd(st.recent.raidBy ?? -1);
  if (!h || h.count < 1) return null;
  const P = x.p.grid.pos, hc = h.cell;
  const d = Math.acos(Math.min(1, P[hc * 3] * st.pos[0] + P[hc * 3 + 1] * st.pos[1] + P[hc * 3 + 2] * st.pos[2])) * x.p.st.radius;
  return d <= huntRange(st) ? h : null;
}

/** (fix r1 #11) the roles that join a folk hunt or a hunt for a pack (besides hunters, and farmers with no field ripe) */
const HELPERS: readonly number[] = [ROLE.herder, ROLE.gatherer, ROLE.crafter, ROLE.builder, ROLE.none];

/** (fix r1 #11) a farming town's folk hunt is due (once in FOLK_HUNT_DAYS) */
function folkHuntDue(x: PCtx, st: Settlement): boolean {
  return HUNT_TUNE.folkDays > 0 && farming(x, st) && (st.recent.folkHunt === undefined || x.tick - st.recent.folkHunt >= HUNT_TUNE.folkDays * x.day);
}

/** a party out: the dead and the departed leave it; false when it breaks up (home with its kill, lost, out too long) */
function keepParty(x: PCtx, st: Settlement, p: HuntParty): boolean {
  const A = x.A;
  p.members = p.members.filter((id) => { const s = A.slotOf(id); return s >= 0 && A.alive[s] && A.settlement[s] === st.id && A.role[s] === ROLE.hunter; });
  const out = p.members.some((id) => { const s = A.slotOf(id); return s >= 0 && (A.camp[s] >= 0 || (A.task[s] === TASK.hunt)); });
  const old = x.tick - p.since > PARTY_DAYS * x.day;
  // (the rest of the kill left by it: kept for them while it is fresh, then the scavengers' and the flies')
  if (p.cache && x.tick - p.cache.t > CACHE_DAYS * x.day) delete p.cache;
  if (p.members.length === 0 || old || (p.kills > 0 && !out && !p.cache)) return false;
  // the herd is gone: the next game near the party (not another party's), else home
  const h = x.ps.herd(p.herd);
  if (!h || h.count < 1) {
    const lead = A.slotOf(p.members[0]);
    if (lead >= 0) A.posAt(lead, x.tick, _p); else { _p[0] = st.pos[0]; _p[1] = st.pos[1]; _p[2] = st.pos[2]; }
    const others = parties(st).filter((q) => q !== p).map((q) => q.herd);
    const g = bestGame(x, st, _p, p.members.length, p.members.length >= 4 && armed(x, st), others);
    if (!g || p.kills > 0) return false;
    p.herd = g.id; p.species = g.species;
  }
  return true;
}

/** a hunter setting out takes food for `days` from the store (what they carry already counts) */
function provision(x: PCtx, st: Settlement, m: number, days: number): void {
  const A = x.A;
  const sp = x.info[A.species[m]];
  let have = 0;
  for (const it of sp.foods) { const q = A.carried(m, it); if (q > 0) have += q * sp.edible[it]; }
  if (have >= days * 0.5) return;
  const f = bestFood(x, st);
  if (f < 0) return;
  const got = storeTake(st, f, (days - have) / Math.max(0.05, sp.edible[f]));
  if (got <= 0) return;
  const left = A.give(m, f, got);
  if (left > 0) storeAdd(x, st, f, left);
}

/** days of meat a head the store holds before a party is no longer sent out */
export const MEAT_DAYS = 1;

/** food-days of meat (fresh, dried, cooked) in st's store */
export function meatDays(x: PCtx, st: Settlement): number {
  const ed = x.info[st.species].edible;
  const A = x.A;
  let d = 0;
  const meats = x.c.itemsByTag.get('meat') ?? [];
  for (const it of meats) if ((st.store[it] ?? 0) > 0) d += st.store[it] * ed[it];
  // and what the hunters are carrying home
  for (const m of x.ps.members.get(st.id) ?? []) {
    if (A.role[m] !== ROLE.hunter) continue;
    for (const it of meats) { const q = A.carried(m, it); if (q > 0) d += q * ed[it]; }
  }
  return d;
}

function daylightAt(x: PCtx, st: Settlement): number {
  const A = x.A;
  for (const m of x.ps.members.get(st.id) ?? []) if (!(A.flags[m] & AgentFlag.child)) return daylightLeft(x, m);
  return 0;
}

/**
 * The hunter's next leg (decide.ts planHunt, the hunter's work and a hunting trip's work at its camp): close on the
 * party's herd — a stalk when it is near (data2 0: the encounter at the work's end), else a leg toward it as far as the
 * day allows (data2 1). Null: not in a party, the party is done (its kill made), or no daylight left to walk.
 */
export function huntTask(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  const p = partyOf(x, st, s);
  if (!p) return null;
  // the kill is made: back for what was left of it, once the load in hand is home; else those still out come home with
  // the others (a camp of the hunt is struck)
  if (p.kills > 0) {
    const f = fetchTask(x, s, p);
    if (f) return f;
    if (camping(x, s) && (A.tripTask[s] & 255) === TASK.hunt) endTrip(x, s);
    return null;
  }
  const h = x.ps.herd(p.herd);
  if (!h || h.count < 1) return null;
  herdPos(h, x.tick, _q);
  A.posAt(s, x.tick, _p);
  const d = distM(x.p, _p, _q);
  const edge = x.p.edgeM;
  const ang = hashFloat(A.id[s], p.id, 0x4b1) * Math.PI * 2;
  if (d <= 1.5 * edge) {
    // close: stalk it (a spot downwind of the herd, a few tens of metres off)
    const goal = offsetPoint(_q, 12 + 18 * hashFloat(A.id[s], x.tick, 0x4b2), ang, x.p.st.radius, [0, 0, 0]);
    const c = x.p.cellAt(goal);
    if (camping(x, s)) A.camp[s] = c; // (the camp follows the game)
    return { kind: TASK.hunt, goal, goalCell: c, work: 120, target: h.id, data2: 0 };
  }
  // tracking: a leg toward where the herd is now, as far as the daylight allows (the night is spent where it ends)
  const light = daylightLeft(x, s);
  const v = walkRate(x, s);
  const reach = (light - 20) * v * 0.75;
  if (reach < 40) return null;
  const leg = Math.min(d - edge, reach);
  // a leg's end on dry land: shorter legs where water lies between them and the herd (the route goes round it)
  const here = x.p.cellAt(_p);
  const G = x.p.grid.pos;
  for (const k of [1, 0.75, 0.5, 0.3]) {
    const f = Math.max(0, Math.min(1, (leg * k) / d));
    const goal = [_p[0] + (_q[0] - _p[0]) * f, _p[1] + (_q[1] - _p[1]) * f, _p[2] + (_q[2] - _p[2]) * f];
    const l = Math.hypot(goal[0], goal[1], goal[2]) || 1;
    goal[0] /= l; goal[1] /= l; goal[2] /= l;
    let c = x.p.cellAt(goal);
    if (x.p.f.water[c] > 0.6) {
      // the dry cell beside the leg's end nearest the herd (fix r2 #2: not the first one, and never the hunter's own:
      // that leg went nowhere)
      const g = x.p.grid;
      let dry = -1, best = -Infinity;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const nc = g.nbr[e];
        if (x.p.f.water[nc] > 0.6 || nc === here) continue;
        const near = G[nc * 3] * _q[0] + G[nc * 3 + 1] * _q[1] + G[nc * 3 + 2] * _q[2];
        if (near > best || (near === best && nc < dry)) { best = near; dry = nc; }
      }
      if (dry < 0) continue;
      c = dry;
      spotInCell(x.p, c, A.id[s], 0x4b3, goal);
    }
    if (distM(x.p, _p, goal) < 10) continue;
    if (camping(x, s)) A.camp[s] = c;
    return { kind: TASK.hunt, goal, goalCell: c, work: 5, target: h.id, data2: 1 };
  }
  // (fix r2 #2) no leg takes them nearer: water lies between the party and its game — it turns to other game, else the
  // hunt is over (keepParty sends them home)
  const others = parties(st).filter((q) => q !== p).map((q) => q.herd);
  const g = bestGame(x, st, _p, p.members.length, p.members.length >= 4 && armed(x, st), [...others, p.herd]);
  if (g) { p.herd = g.id; p.species = g.species; } else p.since = Math.min(p.since, x.tick - PARTY_DAYS * x.day - 1);
  return null;
}

/**
 * The end of a hunter's stalk (work.ts, TASK.hunt): the party's encounter with the herd — once per ENCOUNTER_GAP for the
 * whole party, with the hunters within reach of the herd. A tracking leg (data2 1) does nothing (the next decision
 * walks on); a walk back to the kill (data2 2) takes up a load of what was left of it (fetchCache).
 */
export function huntEncounter(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  if (!st || A.tData2[s] === 1) return;
  if (A.tData2[s] === 2) { fetchCache(x, s, st); return; }
  const p = partyOf(x, st, s);
  if (!p || p.kills > 0) return;
  const h = x.ps.herd(A.tTarget[s]);
  if (!h || h.count < 1 || h.id !== p.herd) return;
  practise(x, s, SKILL.hunt, 0.02);
  if (p.lastTry >= 0 && x.tick - p.lastTry < ENCOUNTER_GAP) return;
  herdPos(h, x.tick, _q);
  const reach = 2.5 * x.p.edgeM;
  // the hunters there
  const here: number[] = [];
  for (const id of p.members) {
    const m = A.slotOf(id);
    if (m < 0 || !A.alive[m]) continue;
    A.posAt(m, x.tick, _p);
    if (distM(x.p, _p, _q) <= reach && (A.task[m] === TASK.hunt || A.task[m] === TASK.camp)) here.push(m);
  }
  if (!here.length) return;
  p.lastTry = x.tick;
  h.scared = x.tick;
  const a = animalDef(x, h.species);
  let skill = 0, weapon = 1;
  for (const m of here) {
    skill += A.skills[m * NS + SKILL.hunt];
    const t = A.tool[m];
    if (t >= 0) {
      const it = x.c.items.list[t];
      if (it.tags.includes('hunt') || it.tags.includes('weapon')) weapon = Math.max(weapon, 1 + 0.35 * (it.quality ?? 1));
    }
  }
  skill /= here.length;
  // each hunter's chance to bring it down; the party's is the chance that one of them does
  const one = 0.14 * (0.6 + 1.1 * skill) * weapon * (1 - a.flee * 0.45) * (1 - a.danger * 0.3) * libraryEffect(x, st, 'yield.hunt');
  const pKill = 1 - Math.pow(1 - Math.min(0.9, one), here.length);
  const dice = hashFloat(p.id, h.id, x.tick, 0x4b7);
  // the hunted may fight back (one of them, the boldest in front)
  if (a.danger > 0) {
    const front = here.reduce((b, m) => (A.traits[m * NT + TRAIT.boldness] > A.traits[b * NT + TRAIT.boldness] ? m : b), here[0]);
    const sk = A.skills[front * NS + SKILL.hunt];
    if (hashFloat(A.id[front], h.id, x.tick, 0x4b8) < a.danger * (1 - sk * 0.6) * 0.3) wound(x, st, front, a, h.species);
  }
  if (dice >= pKill) return;
  // the kill: butchered where it fell, what they can carry goes home
  const hungry = famine(x, st);
  const spare = h.count >= 3 ? Math.max(1, Math.floor(h.count * 0.2)) : hungry ? 1 : 0;
  if (spare <= 0) return;
  const kg = carcassKg(a);
  const carry = here.filter((m) => A.alive[m]).length * LOAD_KG;
  const kills = Math.max(1, Math.min(spare, Math.floor(carry / Math.max(1, kg)) || 1, 1 + Math.floor(here.length / 3)));
  h.count = Math.max(0, h.count - kills);
  p.kills += kills;
  const row = ledger(x, st);
  bump(row.kills, a.id, kills);
  // share the meat, hides and bones among the hunters there (meat first), each up to a load
  const goods = carcass(a).map((g) => ({ item: x.c.items.idx(g.item), qty: g.qty * kills, kg: itemKg(g.item) })).filter((g) => g.item >= 0);
  const carriers = here.filter((m) => A.alive[m]);
  for (const m of carriers) {
    let room = LOAD_KG - carriedKg(x, m);
    for (const g of goods) {
      if (room <= 0.05 || g.qty <= 0.01) continue;
      const q = Math.min(g.qty, room / g.kg);
      const got = Math.round(q * 100) / 100;
      if (got <= 0) continue;
      const left = A.give(m, g.item, got);
      const took = got - left;
      g.qty -= took;
      room -= took * g.kg;
      if (x.c.items.list[g.item].id === 'meat') addFood(x, st, 'hunt', g.item, took);
    }
    A.remember(m, MEMK.hunted, x.tick, h.species);
    practise(x, m, SKILL.hunt, 0.03);
    // a successful hunt is a thing to have done (people/outlets.ts)
    statusGain(x, m, 0.2);
  }
  // what they could not carry is left by the kill, for them to come back for (fetchTask)
  let restKg = 0;
  for (const g of goods) if (g.qty > 0.01) restKg += g.qty * g.kg;
  if (restKg >= CACHE_MIN_KG) {
    const rest: Record<string, number> = {};
    for (const g of goods) if (g.qty > 0.01) rest[x.c.items.list[g.item].id] = Math.round(g.qty * 100) / 100;
    p.cache = { c: x.p.cellAt(_q), pos: [_q[0], _q[1], _q[2]], goods: rest, t: x.tick };
  }
  // in a famine, the beast that feeds them may become sacred to them (culture.ts)
  if (hungry) st.recent.savedBy = h.species;
  emitAt(x, s, { t: 'hunt', ref: settlementRef(x, st), text: a.id, data: { settlement: st.id, species: a.id, kills, hunters: here.length } });
  chronicleHunt(x, st, a, kills, here);
  // young of a beast people can tame may come home with them (people/herding.ts)
  if (a.domesticable && a.domesticatesTo && hashFloat(p.id, h.id, 0x4b9) < 0.25) youngFromHunt(x, st, a, 1 + (hashFloat(p.id, h.id, 0x4ba) < 0.5 ? 1 : 0));
}

/**
 * Back to the kill (huntTask, a party that has made its kill): a hunter of the party with empty hands walks to what was
 * left of it while it keeps, with the daylight to get there (data2 2: fetchCache at the task's end). Null: nothing left
 * to fetch, or the load in hand is not home yet.
 */
export function fetchTask(x: PCtx, s: number, p: HuntParty): TaskSpec | null {
  const c = p.cache;
  if (!c || x.tick - c.t > CACHE_DAYS * x.day || carriedKg(x, s) > 5) return null;
  const A = x.A;
  A.posAt(s, x.tick, _p);
  if (walkTicks(x, s, _p, c.pos) + 30 > daylightLeft(x, s)) return null;
  return { kind: TASK.hunt, goal: [c.pos[0], c.pos[1], c.pos[2]], goalCell: c.c, work: 20, target: -1, data2: 2 };
}

/** at the kill (a fetch's end): the hunter takes up a load of what was left (meat first), and it goes home with them */
function fetchCache(x: PCtx, s: number, st: Settlement): void {
  const A = x.A;
  const p = partyOf(x, st, s);
  const c = p?.cache;
  if (!p || !c) return;
  A.posAt(s, x.tick, _p);
  if (distM(x.p, _p, c.pos) > 2 * x.p.edgeM) return;
  let room = LOAD_KG - carriedKg(x, s);
  const ids = Object.keys(c.goods).sort((a, b) => (a === 'meat' ? -1 : b === 'meat' ? 1 : a < b ? -1 : a > b ? 1 : 0));
  for (const id of ids) {
    const it = x.c.items.idx(id);
    const kg = itemKg(id);
    const want = Math.min(c.goods[id], room / kg);
    const got = Math.round(want * 100) / 100;
    if (it < 0 || got <= 0) continue;
    const took = Math.round((got - A.give(s, it, got)) * 100) / 100;
    if (took <= 0) continue;
    c.goods[id] = Math.round((c.goods[id] - took) * 100) / 100;
    room -= took * kg;
    if (id === 'meat') addFood(x, st, 'hunt', it, took);
    if (c.goods[id] <= 0.01) delete c.goods[id];
  }
  let left = 0;
  for (const id in c.goods) left += c.goods[id] * itemKg(id);
  if (left < 1) delete p.cache;
}

/** kg agent s carries */
function carriedKg(x: PCtx, s: number): number {
  const A = x.A;
  let kg = 0;
  for (let k = 0; k < INV; k++) {
    const it = A.invItem[s * INV + k];
    if (it >= 0) kg += A.invQty[s * INV + k] * itemKg(x.c.items.list[it].id);
  }
  return kg;
}

/** a hunter hurt by the prey (rarely killed) */
function wound(x: PCtx, st: Settlement, m: number, a: AnimalDef, sp: number): void {
  const A = x.A;
  A.health[m] -= 0.15 + a.danger * 0.3;
  A.flags[m] |= AgentFlag.sick;
  A.remember(m, MEMK.injured, x.tick, sp);
  const row = ledger(x, st);
  row.huntInjuries++;
  accident(x, st, 'injury', A.cell[m]);
  if (A.health[m] <= 0) {
    row.huntDeaths++;
    die(x, m, DEATH.predator);
  }
}

/** the chronicle: the first kill of each species on this world, the first great hunt of a settlement */
function chronicleHunt(x: PCtx, st: Settlement, a: AnimalDef, kills: number, here: number[]): void {
  const key = `kill:${a.id}`;
  const great = here.length >= 3 && (kills >= 2 || (a.mass ?? 0) >= 300);
  const L = landOf(st);
  if (great && L.firsts['great-hunt'] === undefined) {
    L.firsts['great-hunt'] = x.tick;
    for (const m of here) x.A.remember(m, MEMK.huntFeat, x.tick, a ? x.c.animals.idx(a.id) : 0);
    tell(x.u, x.p, 'hunt.great', vars(x, st, here[0], { count: here.length, animal: kills > 1 ? `${NUMBER[kills] ?? kills} ${plural(a.name)}` : `${/^[aeiou]/i.test(a.name) ? 'an' : 'a'} ${a.name.toLowerCase()}` }), st, [settlementRef(x, st), agentRef(x, here[0])]);
    x.ps.firsts[key] ??= x.tick;
    return;
  }
  if (x.ps.firsts[key] === undefined) {
    x.ps.firsts[key] = x.tick;
    tell(x.u, x.p, 'hunt.first', vars(x, st, here[0], { animal: a.name.toLowerCase() }), st, [settlementRef(x, st), agentRef(x, here[0])], 0);
  }
}

const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function plural(name: string): string {
  const n = name.toLowerCase();
  if (/(deer|sheep|bison|fish|aurochs|moose|elk|ox)$/.test(n)) return n;
  if (/(x|s|ch|sh)$/.test(n)) return n + 'es';
  if (/[^aeiou]y$/.test(n)) return n.slice(0, -1) + 'ies';
  return n + 's';
}
