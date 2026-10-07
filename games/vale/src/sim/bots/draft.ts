// VALE bots — the draft brain, setup-layer loadouts and skins (CONTRACT §5.7, §7).
//
//   createDraftBrain(catalog, seed) → { act(state, seat) → DraftAction | null }
//     The session's draft host asks a bot seat what to do; the brain answers with the same
//     DraftActions a human sends (one per call; null = nothing to do now). It remembers per seat
//     what it already did (skin/loadout sent, bench swaps tried) so repeated calls converge.
//     * ban: highest threat = style power heuristic + kit difficulty + a seeded jitter; never a
//       fighter an ally hovers or locked, never one already banned;
//     * pick (draft / blind / role preset): role need first (the seat's RoleDef — else the first
//       role the team has not covered — matched against FighterDef.role 1.0 / secondaryRole 0.6),
//       then team composition (a frontline if there is none, the damage type the team lacks, no
//       style stacking), comfort (simpler kits), and a seeded per-(seat, fighter) variety term that
//       is stable across calls so a hover never flickers; hover first, lock on the next call;
//     * Bridge (random_bench): swap the own fighter for a bench fighter that fits the team clearly
//       better (once), or reroll a poor fit when rerolls remain;
//     * Fray (ffa_pick): pick freely, never a fighter another seat already locked;
//     * finalize: a skin (pickSkin) and a loadout (pickLoadout); trade requests are accepted.
//   pickLoadout(catalog, fighter, pool, role?) → LoadoutChoice
//     battle spells by their ai.use against the fighter's style (escape for squishy ranged styles,
//     gap-closers for divers, heals for sustain/wardens, executes for burst), honouring the setup
//     pools and slot counts; spells that cannot target fighters (monster-only smites) only for a
//     jungle role. Boons by how much their stat block is worth to the style, preferring one path.
//   pickSkin(catalog, fighter, seed) → any skin of the fighter (cosmetic only; ownership is a
//     human concern), seeded for variety.

import type { CatalogT, FighterDefT } from '../../contracts/catalog.ts';
import type { DraftAction, DraftSeat, DraftState } from '../../contracts/session.ts';
import type { LoadoutChoice, PlayerId } from '../../contracts/sim.ts';
import { hashString } from '../rng.ts';
import {
  abilityInfo, fighterProfile, statValue, STYLE_POWER, U_BUFF, U_DAMAGE, U_ENGAGE, U_ESCAPE, U_EXECUTE, U_GAPCLOSE, U_HEAL, U_SHIELD,
  type FighterProfile, type Style,
} from './knowledge.ts';

export interface DraftBrain {
  act(state: DraftState, seat: PlayerId): DraftAction | null;
}

interface SeatMemo { skin: boolean; loadout: boolean; benchSwaps: number; rerolled: boolean; prehover: boolean; lastFighter: string | null }

/** stable [0, 1) noise for (seed, key) */
function jitter(seed: number, key: string): number { return hashString(key, (hashString('draft') ^ (seed >>> 0)) >>> 0) / 4294967296; }

export function createDraftBrain(catalog: CatalogT, seed: number): DraftBrain {
  const fighters = new Map<string, FighterDefT>(catalog.fighters.map((f) => [f.id, f]));
  const profiles = new Map<string, FighterProfile>();
  const prof = (id: string): FighterProfile | null => {
    let p = profiles.get(id);
    if (p) return p;
    const f = fighters.get(id);
    if (!f) return null;
    p = fighterProfile(f);
    profiles.set(id, p);
    return p;
  };
  const roles = new Map(catalog.roles.map((r) => [r.id, r]));
  const memo = new Map<PlayerId, SeatMemo>();
  const mem = (seat: PlayerId): SeatMemo => {
    let m = memo.get(seat);
    if (!m) { m = { skin: false, loadout: false, benchSwaps: 0, rerolled: false, prehover: false, lastFighter: null }; memo.set(seat, m); }
    return m;
  };

  const threat = (id: string): number => {
    const f = fighters.get(id), p = prof(id);
    if (!f || !p) return 0;
    return (STYLE_POWER[p.style] ?? 1) + f.difficulty * 0.12 + jitter(seed, `ban:${id}`) * 0.25;
  };

  const chosenOf = (s: DraftSeat): string | undefined => s.locked ?? s.hover;

  /** the role a seat should fill: its own, else the first (by order) its team has not covered */
  const roleNeed = (state: DraftState, me: DraftSeat): string | undefined => {
    if (me.role) return me.role;
    const mates = state.seats.filter((s) => s.team === me.team && s.player !== me.player);
    const covered = new Set<string>();
    for (const s of mates) {
      if (s.role) { covered.add(s.role); continue; }
      const f = chosenOf(s);
      const fd = f ? fighters.get(f) : undefined;
      if (fd) covered.add(fd.role);
    }
    const ordered = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign!.order - b.assign!.order) || (a.id < b.id ? -1 : 1));
    for (const r of ordered) if (!covered.has(r.id)) return r.id;
    return undefined;
  };

  /** how well `id` fits seat `me` on its team (role, composition, comfort, variety) */
  const fit = (state: DraftState, me: DraftSeat, id: string, ffa: boolean): number => {
    const f = fighters.get(id), p = prof(id);
    if (!f || !p) return -Infinity;
    let s = 0;
    if (!ffa) {
      const role = roleNeed(state, me);
      if (role) s += f.role === role ? 2 : f.secondaryRole === role ? 1.2 : roleStyleFit(roles.get(role)?.assign, p.style);
      else s += 0.6;
      const mates = state.seats.filter((x) => x.team === me.team && x.player !== me.player).map(chosenOf).filter((x): x is string => !!x);
      const mp = mates.map((m) => prof(m)).filter((x): x is FighterProfile => !!x);
      const fronts = mp.filter((x) => x.front).length;
      if (p.front && fronts === 0) s += 0.6;
      if (p.front && fronts >= 2) s -= 0.4;
      const magic = mp.filter((x) => x.scaling === 'magic').length, phys = mp.length - magic;
      if (p.scaling === 'magic' && magic < phys) s += 0.3;
      if (p.scaling === 'phys' && phys < magic) s += 0.3;
      for (const m of mp) if (m.style === p.style) s -= 0.3;
      if (mates.includes(id)) s -= 5;
    }
    s += (4 - f.difficulty) * 0.05;
    s += jitter(seed, `pick:${me.player}:${id}`) * (ffa ? 1.2 : 0.4);
    return s;
  };

  const bestPick = (state: DraftState, me: DraftSeat, ffa: boolean): string | null => {
    const banned = new Set(state.bans.map((b) => b.fighter).filter((x): x is string => !!x));
    const lockedByOthers = new Set(state.seats.filter((s) => s.player !== me.player && s.locked).map((s) => s.locked!));
    const hoveredByMates = new Set(state.seats.filter((s) => s.player !== me.player && s.team === me.team && s.hover).map((s) => s.hover!));
    let best: string | null = null, bs = -Infinity;
    for (const id of state.available) {
      if (banned.has(id) || lockedByOthers.has(id) || !fighters.has(id)) continue;
      let s = fit(state, me, id, ffa);
      if (hoveredByMates.has(id)) s -= 3; // leave a teammate's intended pick alone
      if (s > bs) { bs = s; best = id; }
    }
    return best;
  };

  const finalize = (state: DraftState, me: DraftSeat): DraftAction | null => {
    const m = mem(me.player);
    const f = me.locked ?? me.hover;
    if (!f) return null;
    if (m.lastFighter !== f) { m.lastFighter = f; m.skin = false; m.loadout = false; }
    if (!m.skin) { m.skin = true; const skin = pickSkin(catalog, f, seed + me.player); if (skin) return { a: 'skin', skin }; }
    if (!m.loadout) {
      m.loadout = true;
      const mode = catalog.modes.find((x) => x.id === state.mode);
      const queue = catalog.queues.find((q) => q.id === state.queue);
      const pool = (queue?.rules as { itemPool?: string } | undefined)?.itemPool ?? mode?.rules.itemPool ?? '';
      return { a: 'loadout', loadout: pickLoadout(catalog, f, pool, me.role ?? roleNeed(state, me)) };
    }
    return null;
  };

  return {
    act(state: DraftState, seat: PlayerId): DraftAction | null {
      const me = state.seats.find((s) => s.player === seat);
      if (!me) return null;
      const mode = catalog.modes.find((x) => x.id === state.mode);
      const queue = catalog.queues.find((q) => q.id === state.queue);
      const pick = queue?.pick ?? mode?.pick;
      const ffa = pick === 'ffa_pick' || (mode ? mode.teams > 2 : false);
      const m = mem(seat);
      const myTurn = !!state.turn && state.turn.players.includes(seat);
      // trades: accept what teammates ask for
      const trade = state.trades?.find((t) => t.to === seat);
      if (trade) return { a: 'tradeAccept', with: trade.from };
      switch (state.phase) {
        case 'ban': {
          if (myTurn && state.turn!.action === 'ban') {
            const banned = new Set(state.bans.map((b) => b.fighter).filter((x): x is string => !!x));
            const allyHeld = new Set<string>();
            for (const s of state.seats) if (s.team === me.team) { if (s.hover) allyHeld.add(s.hover); if (s.locked) allyHeld.add(s.locked); }
            let best: string | null = null, bs = -Infinity;
            for (const id of state.available) {
              if (banned.has(id) || allyHeld.has(id)) continue;
              const t = threat(id);
              if (t > bs) { bs = t; best = id; }
            }
            return best ? { a: 'ban', fighter: best } : null;
          }
          if (!me.hover && !m.prehover && !ffa) {
            m.prehover = true;
            const want = bestPick(state, me, ffa);
            if (want) return { a: 'hover', fighter: want };
          }
          return null;
        }
        case 'pick': {
          if (me.locked) return finalize(state, me);
          if (myTurn && (state.turn!.action === 'pick' || state.turn!.action === 'free')) {
            const want = bestPick(state, me, ffa);
            if (!want) return null;
            if (me.hover !== want) {
              // a hover that is still a fine pick is kept (no flicker as teammates hover)
              if (me.hover && state.available.includes(me.hover) && fit(state, me, me.hover, ffa) >= fit(state, me, want, ffa) - 0.25 &&
                !state.seats.some((s) => s.player !== seat && s.locked === me.hover)) return { a: 'lock' };
              return { a: 'hover', fighter: want };
            }
            return { a: 'lock' };
          }
          if (!me.hover && !m.prehover && !ffa) {
            m.prehover = true;
            const want = bestPick(state, me, ffa);
            if (want) return { a: 'hover', fighter: want };
          }
          return null;
        }
        case 'bench': {
          const cur = me.locked ?? me.hover;
          const bench = state.bench[me.team] ?? [];
          if (cur && m.benchSwaps < 1 && bench.length > 0) {
            const curFit = fit(state, me, cur, false);
            let best: string | null = null, bs = curFit + 0.5;
            for (const id of bench) { const s = fit(state, me, id, false); if (s > bs) { bs = s; best = id; } }
            if (best) { m.benchSwaps++; return { a: 'benchSwap', fighter: best }; }
            if (!m.rerolled && (me.rerolls ?? 0) > 0 && curFit < 0.4) { m.rerolled = true; return { a: 'reroll' }; }
          }
          return finalize(state, me);
        }
        case 'trade': return null;
        case 'finalize': return finalize(state, me);
        default: return null;
      }
    },
  };
}

/** without a FighterDef.role match: how plausible a style is for a role's position */
function roleStyleFit(a: { lane: string | null; jungle: boolean; support: boolean } | undefined, style: Style): number {
  if (!a) return 0.2;
  if (a.jungle) return style === 'diver' || style === 'skirmisher' || style === 'burst' ? 0.5 : 0.1;
  if (a.support) return style === 'warden' || style === 'frontline' ? 0.6 : 0.05;
  return style === 'warden' ? 0 : 0.3;
}

const SPELL_PREF: Readonly<Record<Style, Partial<Record<number, number>>>> = {
  marksman: { [U_ESCAPE]: 3, [U_HEAL]: 1.5, [U_DAMAGE]: 1, [U_EXECUTE]: 1, [U_BUFF]: 0.8 },
  artillery: { [U_ESCAPE]: 3, [U_HEAL]: 1.2, [U_EXECUTE]: 1.4, [U_DAMAGE]: 1.2 },
  burst: { [U_EXECUTE]: 2.6, [U_DAMAGE]: 2, [U_GAPCLOSE]: 2, [U_ESCAPE]: 2 },
  skirmisher: { [U_GAPCLOSE]: 1.8, [U_ESCAPE]: 1.8, [U_EXECUTE]: 2, [U_DAMAGE]: 1.5, [U_HEAL]: 1 },
  diver: { [U_GAPCLOSE]: 2.2, [U_ENGAGE]: 2, [U_ESCAPE]: 1.2, [U_EXECUTE]: 1.2, [U_HEAL]: 1 },
  frontline: { [U_ENGAGE]: 2.2, [U_GAPCLOSE]: 2, [U_HEAL]: 1.2, [U_SHIELD]: 1.2, [U_ESCAPE]: 1 },
  warden: { [U_HEAL]: 2.6, [U_SHIELD]: 2.2, [U_ESCAPE]: 1.8, [U_BUFF]: 1 },
  sustain: { [U_HEAL]: 2.4, [U_ESCAPE]: 1.6, [U_DAMAGE]: 1.2, [U_EXECUTE]: 1.2 },
};

export function pickLoadout(catalog: CatalogT, fighter: FighterDefT | string, pool: string, role?: string): LoadoutChoice {
  const def = typeof fighter === 'string' ? catalog.fighters.find((f) => f.id === fighter) : fighter;
  const setup = catalog.setup;
  if (!def) return { spells: setup.defaults.spells.slice(), boons: setup.defaults.boons.slice() };
  const prof = fighterProfile(def);
  const jungle = !!(role && catalog.roles.find((r) => r.id === role)?.assign?.jungle);
  const inPool = (pools: readonly string[]): boolean => pools.length === 0 || !pool || pools.includes(pool);
  const pref = SPELL_PREF[prof.style];
  const scored = setup.spells.filter((s) => inPool(s.pools)).map((s) => {
    const info = abilityInfo(s);
    let v = 0;
    for (const k in pref) if (info.use & Number(k)) v += pref[Number(k)] ?? 0;
    // a spell that cannot touch fighters (a monster smite) is a jungler's tool
    const f = s.targeting.filter;
    const noFighters = s.targeting.kind === 'unit' && f && f.fighters === false;
    if (noFighters) v = jungle ? 10 : -5;
    return { id: s.id, v };
  }).sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
  const spells = scored.slice(0, Math.min(2, setup.spellSlots)).map((s) => s.id);
  const boonsScored = setup.boons.filter((b) => inPool(b.pools)).map((b) => ({ id: b.id, path: b.path, v: statValue(b.stats, prof) + statValue(b.statsPerLevel, prof) * 6 + b.triggers.length * 3 }))
    .sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
  const boons: string[] = [];
  const first = boonsScored[0];
  if (first && setup.boonSlots > 0) {
    boons.push(first.id);
    const rest = boonsScored.slice(1).map((b) => ({ ...b, v: b.v + (b.path === first.path ? 2 : 0) })).sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
    for (const b of rest) { if (boons.length >= setup.boonSlots) break; boons.push(b.id); }
  }
  return { spells, boons };
}

/** any skin of the fighter, seeded (bots are owned-agnostic: skins are cosmetic) */
export function pickSkin(catalog: CatalogT, fighter: string, seed: number): string {
  const skins = catalog.skins.filter((s) => s.fighter === fighter).map((s) => s.id).sort();
  if (skins.length === 0) return '';
  return skins[Math.floor(jitter(seed, `skin:${fighter}`) * skins.length)];
}
