// VALE session — from a finished draft (or a custom lobby / practice request) to a MatchSetup.
//
// Everything is read from the catalog: modes (teams, perTeam, pick, roles, playerColors), queues
// (pick override, rules), roles (assign → draft role slots), skins, setup defaults + pools, botNames.
//
// SEATS: team modes put team t's k-th seat at player t × perTeam + k; FFA modes (pick 'ffa_pick' or
// more than two teams) give every seat its own team (team = player, CONTRACT §2) and colorIndex =
// player mod playerColors.length. Team modes use colorIndex = player (stable scoreboard order).
// ROLES (ModeDef.roles + RoleDef.assign, sorted by assign.order): each team gets one role per seat
// while roles last. The human gets QueueRequest.roles[0] if that role exists, else roles[1], else a
// random remaining role ("fill"); every other seat fills the remaining roles in random order.
// SKINS: you wear profile.equipped[f] if owned (else an owned base skin); bots any skin of f.
// LOADOUTS: profile.loadouts[f] (else setup.defaults), sanitized to the rules' pool: known ids,
// pools empty or containing rules.itemPool, no duplicates, at most min(2, spellSlots) spells and
// boonSlots boons, topped up from the defaults and then the pool (CONTRACT §5.3 loadouts).
// CUSTOM LOBBY: the config's mode/map/seats; 'open' seats are filled by bots (no remote players in a
// local build); `rulesOverride` keys must exist in RulesParams with the same JSON type (others are
// dropped). Because the sim resolves rules from the queue id, the custom match runs on a derived
// catalog whose custom queue record points at the config's mode with the override merged in.

import type { CatalogT, ModeDefT, QueueDefT, RulesParamsT, SkinDefT } from '../contracts/catalog.ts';
import type { CustomLobbyConfig, Profile } from '../contracts/session.ts';
import type { LoadoutChoice, MatchSetup, PlayerId, SeatSetup } from '../contracts/sim.ts';
import { deepMerge } from '../sim/catalog_index.ts';
import type { Rng } from '../sim/rng.ts';
import type { FinalSeat, PickProtocol } from './draft.ts';
import { ownsSkin, wornSkin } from './economy.ts';
import type { Difficulty } from './ratings.ts';

type RoleT = CatalogT['roles'][number];

export function findQueue(catalog: CatalogT, id: string): QueueDefT | undefined { return catalog.queues.find((q) => q.id === id); }
export function findMode(catalog: CatalogT, id: string): ModeDefT | undefined { return catalog.modes.find((m) => m.id === id); }

/** mode.rules ⊕ queue.rules (the sim's merge) */
export function effectiveRules(mode: ModeDefT, queue: QueueDefT): RulesParamsT { return deepMerge(mode.rules, queue.rules); }

export function isFfaMode(mode: ModeDefT): boolean { return mode.pick === 'ffa_pick' || mode.teams > 2; }

export function pickProtocol(mode: ModeDefT, queue: QueueDefT): PickProtocol { return queue.pick ?? mode.pick; }

/** fighters a draft may offer (catalog order) */
export function fighterPool(catalog: CatalogT): string[] {
  return catalog.fighters.filter((f) => catalog.skins.some((s) => s.fighter === f.id)).map((f) => f.id);
}

// ── layout + roles ───────────────────────────────────────────────────────────────────────────────
export interface SeatSlot { player: PlayerId; team: number }

/** the seats of a matchmade mode */
export function modeLayout(mode: ModeDefT): SeatSlot[] {
  const out: SeatSlot[] = [];
  const ffa = isFfaMode(mode);
  for (let t = 0; t < mode.teams; t++) for (let k = 0; k < mode.perTeam; k++) {
    const player = t * mode.perTeam + k;
    out.push({ player, team: ffa ? player : t });
  }
  return out;
}

/** draft role slots for a mode (empty when the mode has no role contract) */
export function draftRoles(catalog: CatalogT, mode: ModeDefT): RoleT[] {
  if (!mode.roles) return [];
  return catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign!.order - b.assign!.order) || (catalog.roles.indexOf(a) - catalog.roles.indexOf(b)));
}

/**
 * Roles for one team's seats (same order as `players`). `you` (if on this team) gets a preference;
 * everyone else fills the rest in random order. Seats beyond the role count get none.
 */
export function assignTeamRoles(roles: readonly RoleT[], players: readonly PlayerId[], you: PlayerId | null, prefs: readonly (string | undefined)[], rng: Rng): Map<PlayerId, string> {
  const out = new Map<PlayerId, string>();
  if (!roles.length) return out;
  const left = roles.map((r) => r.id);
  if (you !== null && players.includes(you)) {
    const want = prefs.find((p) => p && left.includes(p));
    const r = want ?? rng.pick(left);
    out.set(you, r);
    left.splice(left.indexOf(r), 1);
  }
  rng.shuffle(left);
  for (const p of players) {
    if (out.has(p)) continue;
    const r = left.shift();
    if (r) out.set(p, r);
  }
  return out;
}

// ── skins + loadouts ─────────────────────────────────────────────────────────────────────────────
export function skinsOf(catalog: CatalogT, fighter: string): SkinDefT[] { return catalog.skins.filter((s) => s.fighter === fighter); }

/** skins the human may wear on a fighter, the worn one first */
export function yourSkins(catalog: CatalogT, profile: Profile, fighter: string): string[] {
  const worn = wornSkin(profile, catalog, fighter);
  const owned = skinsOf(catalog, fighter).filter((s) => ownsSkin(profile, s.id)).map((s) => s.id);
  const list = worn ? [worn, ...owned.filter((s) => s !== worn)] : owned;
  return list.length ? list : skinsOf(catalog, fighter).slice(0, 1).map((s) => s.id);
}

/** a bot's skins on a fighter: a seeded pick first, then the rest */
export function botSkins(catalog: CatalogT, fighter: string, rng: Rng): string[] {
  const all = skinsOf(catalog, fighter).map((s) => s.id);
  if (all.length <= 1) return all;
  const first = rng.pick(all);
  return [first, ...all.filter((s) => s !== first)];
}

const inPool = (pools: readonly string[], pool: string): boolean => pools.length === 0 || pools.includes(pool);

/** a loadout the sim will honour in full under these rules */
export function sanitizeLoadout(catalog: CatalogT, rules: RulesParamsT, l: Partial<LoadoutChoice> | undefined): LoadoutChoice {
  const set = catalog.setup;
  const spellSlots = Math.min(2, set.spellSlots), boonSlots = Math.max(0, set.boonSlots);
  const okSpell = (id: string): boolean => set.spells.some((s) => s.id === id && inPool(s.pools, rules.itemPool));
  const okBoon = (id: string): boolean => set.boons.some((b) => b.id === id && inPool(b.pools, rules.itemPool));
  const fill = (want: readonly unknown[] | undefined, defaults: readonly string[], all: readonly string[], ok: (id: string) => boolean, n: number): string[] => {
    const out: string[] = [];
    for (const src of [want ?? [], defaults, all]) for (const id of src) {
      if (out.length >= n) break;
      if (typeof id === 'string' && ok(id) && !out.includes(id)) out.push(id);
    }
    return out;
  };
  return {
    spells: fill(l?.spells, set.defaults.spells, set.spells.map((s) => s.id), okSpell, spellSlots),
    boons: fill(l?.boons, set.defaults.boons, set.boons.map((b) => b.id), okBoon, boonSlots),
  };
}

/** is this exactly a valid loadout (nothing dropped)? */
export function loadoutValid(catalog: CatalogT, rules: RulesParamsT, l: LoadoutChoice): boolean {
  const s = sanitizeLoadout(catalog, rules, l);
  return s.spells.join() === l.spells.join() && s.boons.join() === l.boons.join();
}

// ── the setup ───────────────────────────────────────────────────────────────────────────────────
export interface SetupInput {
  catalog: CatalogT;
  queue: QueueDefT;
  mode: ModeDefT;
  map: string;
  final: readonly FinalSeat[];
  difficulty: ReadonlyMap<PlayerId, Difficulty>;
  seed: number;
  matchId: string;
  practice?: MatchSetup['practice'];
}

export function buildMatchSetup(inp: SetupInput): MatchSetup {
  const ffa = isFfaMode(inp.mode);
  const colors = inp.mode.playerColors?.length ?? 0;
  const seats: SeatSetup[] = [...inp.final].sort((a, b) => a.player - b.player).map((f) => {
    const s: SeatSetup = {
      player: f.player, team: ffa ? f.player : f.team, name: f.name, fighter: f.fighter, skin: f.skin,
      loadout: { spells: [...f.loadout.spells], boons: [...f.loadout.boons] },
      controller: f.isYou ? 'human' : 'bot',
      colorIndex: ffa && colors > 0 ? f.player % colors : f.player,
    };
    if (f.role) s.role = f.role;
    if (!f.isYou) s.botDifficulty = inp.difficulty.get(f.player) ?? 'adept';
    return s;
  });
  const setup: MatchSetup = {
    matchId: inp.matchId, seed: inp.seed >>> 0, queue: inp.queue.id, mode: inp.mode.id, map: inp.map, seats, catalogVersion: inp.catalog.version,
  };
  if (inp.queue.kind === 'practice') setup.practice = sanitizePractice(inp.practice, effectiveRules(inp.mode, inp.queue));
  return setup;
}

/** practice switches the sim will honour (finite numbers, ≤ 20 dummies, startLevel ≤ maxLevel) */
export function sanitizePractice(p: MatchSetup['practice'] | undefined, rules: RulesParamsT): NonNullable<MatchSetup['practice']> {
  const out: NonNullable<MatchSetup['practice']> = {};
  if (!p) return out;
  if (typeof p.infiniteGold === 'boolean') out.infiniteGold = p.infiniteGold;
  if (typeof p.noCooldowns === 'boolean') out.noCooldowns = p.noCooldowns;
  if (typeof p.dummies === 'number' && Number.isFinite(p.dummies)) out.dummies = Math.max(0, Math.min(20, Math.floor(p.dummies)));
  if (typeof p.startLevel === 'number' && Number.isFinite(p.startLevel)) out.startLevel = Math.max(1, Math.min(rules.maxLevel, Math.floor(p.startLevel)));
  return out;
}

// ── custom lobby ────────────────────────────────────────────────────────────────────────────────
/** optional RulesParams keys (catalog.ts) an override may add when the base rules lack them: path → JSON type */
const OPTIONAL_RULE_KEYS: Readonly<Record<string, 'number' | 'string' | 'object' | 'array'>> = {
  recallTime: 'number', suddenDeathAt: 'number', minionWaves: 'object', surrender: 'object', placementPoints: 'array', tuning: 'object',
  'end.coreStructure': 'string', 'end.killScore': 'number', 'end.lives': 'number', 'end.timeLimit': 'number',
  'respawn.lateGameRampAt': 'number', 'respawn.lateGameMult': 'number', 'minionWaves.upgradeEvery': 'number',
  'tuning.assistWindow': 'number', 'tuning.xpShareRange': 'number', 'tuning.killXpFraction': 'number', 'tuning.multiKillWindow': 'number',
  'tuning.fountainHealPerSec': 'number', 'tuning.suddenDeathRespawnMult': 'number',
};
/** enum-valued RulesParams keys */
const RULE_ENUMS: Readonly<Record<string, readonly string[]>> = {
  shopAccess: ['base', 'base_or_dead', 'anywhere', 'shops'],
  'end.kind': ['core', 'last_standing_or_score', 'score'],
};
const jsonType = (v: unknown): string => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/** the parts of an override that match the RulesParams shape (keys known, JSON types equal, enums valid, numbers finite) */
export function sanitizeRulesOverride(base: Record<string, unknown>, over: unknown, path = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!over || typeof over !== 'object' || Array.isArray(over)) return out;
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v === undefined) continue;
    const key = path ? `${path}.${k}` : k;
    const want = k in base ? jsonType(base[k]) : OPTIONAL_RULE_KEYS[key];
    if (!want || jsonType(v) !== want) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (RULE_ENUMS[key] && !RULE_ENUMS[key].includes(v as string)) continue;
    if (want === 'object' && k in base) out[k] = sanitizeRulesOverride(base[k] as Record<string, unknown>, v, key);
    else if (want === 'object' && key === 'tuning') out[k] = sanitizeRulesOverride({}, v, key);
    else out[k] = v;   // (an absent minionWaves/surrender block is taken as given; a broken one fails createSim → 'error')
  }
  return out;
}

export type CustomCheck = { ok: true; mode: ModeDefT; map: string } | { ok: false; message: string };

export function checkCustom(catalog: CatalogT, cfg: CustomLobbyConfig | undefined): CustomCheck {
  if (!cfg) return { ok: false, message: 'custom lobby: no config' };
  const mode = findMode(catalog, cfg.mode);
  if (!mode) return { ok: false, message: `custom lobby: unknown mode '${cfg.mode}'` };
  const map = cfg.map || mode.map;
  if (!catalog.maps.some((m) => m.id === map)) return { ok: false, message: `custom lobby: unknown map '${map}'` };
  if (!Array.isArray(cfg.seats) || cfg.seats.length === 0) return { ok: false, message: 'custom lobby: no seats' };
  if (cfg.seats.length > 32) return { ok: false, message: 'custom lobby: too many seats' };
  if (cfg.seats.filter((s) => s.kind === 'you').length !== 1) return { ok: false, message: "custom lobby: exactly one seat must be 'you'" };
  for (const s of cfg.seats) {
    if (!Number.isInteger(s.team) || s.team < 0 || s.team > 31) return { ok: false, message: `custom lobby: bad team ${s.team}` };
    if (s.fighter !== undefined && !catalog.fighters.some((f) => f.id === s.fighter)) return { ok: false, message: `custom lobby: unknown fighter '${s.fighter}'` };
  }
  return { ok: true, mode, map };
}

/** seats of a custom lobby (FFA modes: team = player) */
export function customLayout(mode: ModeDefT, cfg: CustomLobbyConfig): (SeatSlot & { you: boolean; difficulty?: Difficulty; fighter?: string })[] {
  const ffa = isFfaMode(mode);
  return cfg.seats.map((s, i) => ({ player: i, team: ffa ? i : s.team, you: s.kind === 'you', difficulty: s.difficulty, fighter: s.fighter }));
}

/** the catalog a custom match runs on: the custom queue re-pointed at the config's mode, override merged */
export function customCatalog(catalog: CatalogT, queue: QueueDefT, mode: ModeDefT, rulesOverride: unknown): CatalogT {
  const base = effectiveRules(mode, { ...queue, rules: queue.mode === mode.id ? queue.rules : {} });
  const over = sanitizeRulesOverride(base as unknown as Record<string, unknown>, rulesOverride);
  const rules = deepMerge(queue.mode === mode.id ? queue.rules : {}, over) as QueueDefT['rules'];
  const q: QueueDefT = { ...queue, mode: mode.id, rules };
  return { ...catalog, queues: catalog.queues.map((x) => (x.id === queue.id ? q : x)) };
}

/** a ready MatchSetup straight from a custom lobby config (random fighters where none was chosen) */
export function buildCustomSetup(catalog: CatalogT, queue: QueueDefT, cfg: CustomLobbyConfig, o: {
  rng: Rng; profile: Profile; displayName: string; botNames: readonly string[]; seed: number; matchId: string;
}): { setup: MatchSetup; catalog: CatalogT } | { error: string } {
  const chk = checkCustom(catalog, cfg);
  if (!chk.ok) return { error: chk.message };
  const sim = customCatalog(catalog, queue, chk.mode, cfg.rulesOverride);
  const q = findQueue(sim, queue.id)!;
  const rules = effectiveRules(chk.mode, q);
  const pool = fighterPool(catalog);
  const lay = customLayout(chk.mode, cfg);
  const usedByTeam = new Map<number, Set<string>>();
  let bot = 0;
  const final: FinalSeat[] = lay.map((s) => {
    const used = usedByTeam.get(s.team) ?? new Set<string>();
    usedByTeam.set(s.team, used);
    const cands = pool.filter((f) => !used.has(f));
    const fighter = s.fighter ?? o.rng.pick(cands.length ? cands : pool);
    used.add(fighter);
    const name = s.you ? o.displayName : o.botNames[bot++ % Math.max(1, o.botNames.length)] ?? `Bot ${s.player + 1}`;
    return {
      player: s.player, team: s.team, name, isBot: !s.you, isYou: s.you, fighter,
      skin: s.you ? yourSkins(catalog, o.profile, fighter)[0] : botSkins(catalog, fighter, o.rng)[0],
      loadout: sanitizeLoadout(catalog, rules, s.you ? o.profile.loadouts[fighter] : undefined),
    };
  });
  const difficulty = new Map<PlayerId, Difficulty>(lay.filter((s) => !s.you).map((s) => [s.player, s.difficulty ?? 'adept']));
  return { setup: buildMatchSetup({ catalog: sim, queue: q, mode: chk.mode, map: chk.map, final, difficulty, seed: o.seed, matchId: o.matchId }), catalog: sim };
}
