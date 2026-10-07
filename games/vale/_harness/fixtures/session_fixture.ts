// Synthetic SESSION catalog + drivers for lane-SESSION probes (_harness/probe_session_*.ts).
// NOT content: every id is a placeholder (fx_*). Built on match_fixture.ts (maps, units, items) and
// validated by the real zod Catalog schema.
//
// Roles   fx_role_top / _jungle / _mid / _carry / _support with RoleDef.assign on fx_rift_map's lanes
// Fighters the six match-fixture fighters + ten more (fx_s_*), each given one of the five roles
//         (16: a 5v5 draft with 2 bans per team needs 14)
// Modes   fx_s_rift   5v5 'draft' with roles on fx_rift_map (core)
//         fx_s_bridge 3v3 'random_bench' on fx_lane_map (core)
//         fx_s_fray   6 × 1 'ffa_pick' on fx_fray_map (last_standing_or_score)
// Queues  fx_s_standard (draft, 2 bans) · fx_s_quick (role_preset) · fx_s_ranked (glicko2,
//         2 placement games, by_rating bots) · fx_s_coop (blind, novice) · fx_s_bridge (bench 2,
//         1 reroll) · fx_s_fray (placement grants) · fx_s_custom · fx_s_practice · fx_s_locked
//         (unlockLevel 30). Matchmade queues add `end.timeLimit` so probe matches end quickly by a
//         real end condition ('time') when no core falls.
// Store   fx_coin (earned) + fx_gem; offers: brawler alt (40 coin), ranger alt (500 coin), an
//         expired one, a future one, a gem one; starter ownership = every base skin; starter wallet
//         25 coin. Ranks fx_tier_a..d at 0 / 1400 / 1550 / 1700.

import { Catalog, type CatalogT } from '../../src/contracts/catalog.ts';
import type { DraftAction, DraftState, QueueRequest, SessionEvent } from '../../src/contracts/session.ts';
import type { MatchResult, MatchSetup, SeatSetup } from '../../src/contracts/sim.ts';
import { ManualClock } from '../../src/session/clock.ts';
import { LocalSession, type LocalSessionOptions } from '../../src/session/local_session.ts';
import { MemoryProfileStore } from '../../src/session/profile_store.ts';
import { ability, fighter, mode, queue, rawCatalog } from './catalog_fixture.ts';
import { fixtureBots } from './fixture_bot.ts';
import { ALT_SKINS, FIGHTERS, FRAY_MAP, ITEMS, LANE_MAP, LANE_RULES, RIFT_MAP, TEAM_BUFFS, UNITS } from './match_fixture.ts';

type Raw = Record<string, unknown>;
const ICON = 'assets/fx/icon.png';

export const ROLE_IDS = ['fx_role_top', 'fx_role_jungle', 'fx_role_mid', 'fx_role_carry', 'fx_role_support'] as const;
const ROLES: Raw[] = [
  { id: 'fx_role', name: 'Fx Role', contract: 'synthetic', icon: ICON, color: '#112233' },
  { id: 'fx_role_top', name: 'Fx Top', contract: 'synthetic', icon: ICON, color: '#aa0000', assign: { lane: 'fx_top', order: 0 } },
  { id: 'fx_role_jungle', name: 'Fx Jungle', contract: 'synthetic', icon: ICON, color: '#00aa00', assign: { lane: null, jungle: true, order: 1 } },
  { id: 'fx_role_mid', name: 'Fx Mid', contract: 'synthetic', icon: ICON, color: '#0000aa', assign: { lane: 'fx_mid', order: 2 } },
  { id: 'fx_role_carry', name: 'Fx Carry', contract: 'synthetic', icon: ICON, color: '#aaaa00', assign: { lane: 'fx_bot', order: 3 } },
  { id: 'fx_role_support', name: 'Fx Support', contract: 'synthetic', icon: ICON, color: '#00aaaa', assign: { lane: 'fx_bot', support: true, order: 4 } },
];

function combatKit(id: string, dmg: number): Raw {
  return {
    a1: ability(`${id}_a1`, [{ op: 'area', shape: { kind: 'circle', radius: 3 }, at: 'self',
      onHit: [{ op: 'damage', amount: { base: [dmg, dmg * 1.5, dmg * 2], ad: 0.5 }, type: 'phys' }] }], { cooldown: [4, 3.5, 3], cost: 30 }),
    a2: ability(`${id}_a2`, [{ op: 'projectile', speed: 22, range: 8, width: 0.8,
      onHit: [{ op: 'damage', amount: { base: dmg, ad: 0.6 }, type: 'phys' }] }], { cooldown: 5, cost: 40, targeting: { kind: 'direction', range: 8 } }),
  };
}
const EXTRA: Raw[] = ['fx_s_warden', 'fx_s_archer', 'fx_s_mystic', 'fx_s_skirm', 'fx_s_guard', 'fx_s_rogue', 'fx_s_lancer', 'fx_s_seer',
  'fx_s_brute', 'fx_s_scout'].map((id, i) =>
  fighter(id, { base: { hp: 1000 + i * 40, hpRegen: 1, ad: 55 + i * 2, attackSpeed: 0.9, moveSpeed: 3.4, armor: 20 },
    growth: { hp: 80, ad: 3 }, attack: i % 2 ? { range: 5, windup: 0.25, projectileSpeed: 20 } : { range: 1.6, windup: 0.3 }, ...combatKit(id, 50 + i * 5) }));
export const SESSION_FIGHTERS: Raw[] = [...FIGHTERS, ...EXTRA].map((f, i) => ({ ...f, role: ROLE_IDS[i % 5], secondaryRole: ROLE_IDS[(i + 2) % 5] }));
const EXTRA_ALTS: Raw[] = EXTRA.map((f) => ({ id: `${f.id as string}_alt`, fighter: f.id, name: 'Fx Alt', tier: 'standard', model: 'assets/fx/f2.glb',
  portrait: 'assets/fx/p2.png', splash: 'assets/fx/s2.png', releasedIn: '2026.10.0' }));

const RIFT_RULES: Raw = {
  ...LANE_RULES, maxLevel: 18, xpTable: [280, 380, 480, 580, 680, 780, 880, 980, 1080, 1180, 1280, 1380, 1480, 1580, 1680, 1780, 1880],
  abilityRanks: { basicMax: 3, ultLevels: [6, 11, 16] },
  minionWaves: { first: 10, interval: 30, upgradeEvery: 90, composition: [{ unit: 'fx_lane_minion', count: 3 }, { unit: 'fx_ranged_minion', count: 3 }] },
};
const FRAY_RULES: Raw = Object.fromEntries(Object.entries({
  ...LANE_RULES, minionWaves: undefined, structures: false, jungle: false, shopAccess: 'shops', recall: false, fountainHeals: false,
  surrender: undefined, respawn: { base: 3, perLevel: 0, max: 10 },
  end: { kind: 'last_standing_or_score', lives: 2, killScore: 4, timeLimit: 240 }, placementPoints: [10, 7, 5, 3, 2, 1],
}).filter(([, v]) => v !== undefined));

/** probe matches end by a real condition within this much game time */
export const PROBE_TIME_LIMIT = 40;
const fastEnd = (kind: string, extra: Raw = {}, limit = PROBE_TIME_LIMIT): Raw => ({ end: { kind, ...extra, timeLimit: limit } });
const GRANTS = { win: 30, loss: 10, perMinute: 2, cap: 60, xpWin: 120, xpLoss: 60 };
const NO_GRANTS = { win: 0, loss: 0, perMinute: 0, cap: 0, xpWin: 0, xpLoss: 0 };
const DRAFT = { bansPerTeam: 2, pickSeconds: 8, banSeconds: 6, finalizeSeconds: 4 };

/** `timeLimit`: false = the modes' own end rules only; a number = that queue time limit (default PROBE_TIME_LIMIT) */
export function sessionCatalog(o: { timeLimit?: boolean | number } = {}): CatalogT {
  const limit = typeof o.timeLimit === 'number' ? o.timeLimit : PROBE_TIME_LIMIT;
  const coreEnd = o.timeLimit === false ? {} : fastEnd('core', { coreStructure: 'fx_core' }, limit);
  const frayEnd = o.timeLimit === false ? {} : fastEnd('last_standing_or_score', { lives: 2, killScore: 4 }, limit);
  const raw = rawCatalog({
    fighters: SESSION_FIGHTERS,
    units: UNITS, items: ITEMS, teamBuffs: TEAM_BUFFS,
    maps: [LANE_MAP, FRAY_MAP, RIFT_MAP],
    skins: [...ALT_SKINS, ...EXTRA_ALTS],
    modes: [
      mode('fx_s_rift', 'fx_rift_map', RIFT_RULES, { teams: 2, perTeam: 5, pick: 'draft', roles: true }),
      mode('fx_s_bridge', 'fx_lane_map', LANE_RULES, { teams: 2, perTeam: 3, pick: 'random_bench' }),
      mode('fx_s_fray', 'fx_fray_map', FRAY_RULES, { teams: 6, perTeam: 1, pick: 'ffa_pick',
        playerColors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'] }),
    ],
    queues: [
      queue('fx_s_standard', 'fx_s_rift', 'standard', { rules: coreEnd, draft: DRAFT, grants: GRANTS, order: 1 }),
      queue('fx_s_quick', 'fx_s_rift', 'quick', { rules: coreEnd, pick: 'role_preset',
        draft: { bansPerTeam: 0, pickSeconds: 0, banSeconds: 0, finalizeSeconds: 3 }, grants: GRANTS, order: 2 }),
      queue('fx_s_ranked', 'fx_s_rift', 'ranked', { rules: coreEnd, draft: { ...DRAFT, bansPerTeam: 1 },
        ranked: { ratingId: 'fx_s_rating', model: 'glicko2', placementGames: 2 }, bots: { fill: 'all_open', difficulty: 'by_rating' },
        partyMax: 2, grants: GRANTS, order: 3 }),
      queue('fx_s_coop', 'fx_s_rift', 'coop', { rules: coreEnd, pick: 'blind', draft: { bansPerTeam: 0, pickSeconds: 10, banSeconds: 0, finalizeSeconds: 3 },
        bots: { fill: 'opponents_only', difficulty: 'novice' }, grants: { ...GRANTS, win: 20, loss: 8 }, order: 4 }),
      queue('fx_s_bridge', 'fx_s_bridge', 'standard', { rules: coreEnd, bench: { size: 2, rerolls: 1 },
        draft: { bansPerTeam: 0, pickSeconds: 10, banSeconds: 0, finalizeSeconds: 3 }, grants: GRANTS, order: 5 }),
      queue('fx_s_fray', 'fx_s_fray', 'standard', { rules: frayEnd, draft: { bansPerTeam: 0, pickSeconds: 10, banSeconds: 0, finalizeSeconds: 3 },
        grants: { ...GRANTS, placement: [20, 12, 8, 4, 2, 0] }, partyMax: 1, order: 6 }),
      queue('fx_s_custom', 'fx_s_rift', 'custom', { draft: { bansPerTeam: 0, pickSeconds: 10, banSeconds: 0, finalizeSeconds: 3 },
        bots: { fill: 'all_open', difficulty: 'adept' }, partyMax: 10, grants: NO_GRANTS, order: 7 }),
      queue('fx_s_practice', 'fx_s_rift', 'practice', { bots: { fill: 'none', difficulty: 'adept' }, partyMax: 1, grants: NO_GRANTS,
        draft: { bansPerTeam: 0, pickSeconds: 10, banSeconds: 0, finalizeSeconds: 2 }, order: 8 }),
      queue('fx_s_locked', 'fx_s_rift', 'standard', { rules: coreEnd, draft: DRAFT, grants: GRANTS, order: 9, unlockLevel: 30 }),
    ],
  });
  raw.roles = ROLES;
  raw.ranks = [
    { id: 'fx_tier_a', name: 'Fx Tier A', minRating: 0, color: '#555555', emblem: ICON },
    { id: 'fx_tier_b', name: 'Fx Tier B', minRating: 1400, color: '#666666', emblem: ICON },
    { id: 'fx_tier_c', name: 'Fx Tier C', minRating: 1550, color: '#777777', emblem: ICON },
    { id: 'fx_tier_d', name: 'Fx Tier D', minRating: 1700, color: '#888888', emblem: ICON },
  ];
  const fighters = SESSION_FIGHTERS.map((f) => f.id as string);
  raw.store = {
    currencies: [
      { id: 'fx_coin', name: 'Fx Coin', desc: 'synthetic', icon: ICON, earnedOnly: true },
      { id: 'fx_gem', name: 'Fx Gem', desc: 'synthetic', icon: ICON, earnedOnly: false },
    ],
    offers: [
      { sku: 'fx_offer_brawler_alt', kind: 'skin', ref: 'fx_brawler_alt', price: { currency: 'fx_coin', amount: 40 } },
      { sku: 'fx_offer_ranger_alt', kind: 'skin', ref: 'fx_ranger_alt', price: { currency: 'fx_coin', amount: 500 } },
      { sku: 'fx_offer_expired', kind: 'skin', ref: 'fx_juggernaut_alt', price: { currency: 'fx_coin', amount: 1 }, until: '2026-01-01T00:00:00Z' },
      { sku: 'fx_offer_future', kind: 'skin', ref: 'fx_fury_user_alt', price: { currency: 'fx_coin', amount: 1 }, from: '2027-01-01T00:00:00Z' },
      { sku: 'fx_offer_gem', kind: 'skin', ref: 'fx_heat_user_alt', price: { currency: 'fx_gem', amount: 10 } },
    ],
    shelves: [{ id: 'fx_shelf', name: 'Fx Shelf', skus: ['fx_offer_brawler_alt', 'fx_offer_ranger_alt'], layout: 'grid' }],
    starterOwnership: fighters.map((f) => `${f}_skin`),
    starterWallet: { fx_coin: 25 },
  };
  const r = Catalog.safeParse(raw);
  if (!r.success) throw new Error(`session fixture catalog: ${r.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}

/** a schema-0 (prototype) save blob for the migration probe */
export const PROFILE_V0 = {
  id: 'local-legacy0001', name: '  Old   Timer  ', created: '2026-09-01T10:00:00.000Z', level: 4, xp: 35,
  coins: { fx_coin: 70, fx_unknown_currency: 9 },
  skins: ['fx_brawler_alt', 'fx_brawler_skin', 'fx_gone_skin'],
  equipped: { fx_brawler: 'fx_brawler_alt', fx_ranger: 'fx_ranger_alt' },
  ratings: { fx_s_rating: { rating: 1620, rd: 120, games: 12, wins: 7 } },
  history: [{ whatever: true }],
  settings: { audio: { master: 0.3 }, video: { preset: 'low' }, nonsense: 1 },
};

// ── drivers ─────────────────────────────────────────────────────────────────────────────────────
export interface Harness {
  session: LocalSession;
  clock: ManualClock;
  store: MemoryProfileStore;
  catalog: CatalogT;
  events: SessionEvent[];
}

/** in-match fixture bots: team 0 pushes, others defend; lanes spread by seat */
export const probeBots = fixtureBots((s: SeatSetup) => (s.team === 0 ? 'push' : 'defend'), { lane: (s) => s.player });

export function harness(o: Partial<LocalSessionOptions> & { store?: MemoryProfileStore; catalog?: CatalogT } = {}): Harness {
  const catalog = o.catalog ?? sessionCatalog();
  const clock = (o.clock as ManualClock | undefined) ?? new ManualClock();
  const store = o.store ?? new MemoryProfileStore();
  const session = new LocalSession({ seed: 7, dev: true, autopilot: true, bots: probeBots, pregameSeconds: 1, ...o, catalog, clock, store });
  const events: SessionEvent[] = [];
  session.on((e) => events.push(e));
  return { session, clock, store, catalog, events };
}

export function lastOf<T extends SessionEvent['type']>(h: Harness, t: T): Extract<SessionEvent, { type: T }> | undefined {
  for (let i = h.events.length - 1; i >= 0; i--) if (h.events[i].type === t) return h.events[i] as Extract<SessionEvent, { type: T }>;
  return undefined;
}
export function countOf(h: Harness, pred: (e: SessionEvent) => boolean): number { return h.events.filter(pred).length; }

/** advance the manual clock in 100 ms steps until pred() or limit */
export function waitFor(h: Harness, pred: () => boolean, limitMs = 60_000): boolean { return h.clock.advanceUntil(pred, limitMs, 100); }

export interface FlowResult {
  ok: boolean; why?: string;
  setup?: MatchSetup; result?: MatchResult;
  postgame?: Extract<SessionEvent, { type: 'postgame' }>;
  drafts: DraftState[];
  gameSeconds: number;
}

/**
 * queue → (search → found → accept) → draft (driver or autopilot) → loading → matchReady → pump at
 * time scale 16 until post-game. `driver` gets your DraftState after every draft event.
 */
export function runFlow(h: Harness, req: QueueRequest, o: { driver?: (s: DraftState) => DraftAction | null; maxGameSeconds?: number; beforeMatch?: () => void } = {}): FlowResult {
  const out: FlowResult = { ok: false, drafts: [], gameSeconds: 0 };
  const start = h.events.length;
  h.session.queue(req);
  const fresh = (): SessionEvent[] => h.events.slice(start);
  const err = fresh().find((e) => e.type === 'error');
  if (err && err.type === 'error') { out.why = err.message; return out; }
  if (req.queue && !/custom|practice/.test(h.catalog.queues.find((q) => q.id === req.queue)?.kind ?? '')) {
    if (!waitFor(h, () => h.session.phase === 'found', 20_000)) { out.why = `no ready check (phase ${h.session.phase})`; return out; }
    h.session.acceptMatch();
  }
  let seen = h.events.length;
  const draftDone = waitFor(h, () => {
    for (; seen < h.events.length; seen++) {
      const e = h.events[seen];
      if (e.type === 'draft') {
        out.drafts.push(e.state);
        const a = o.driver?.(e.state);
        if (a) h.session.draft(a);
      }
    }
    return h.session.phase === 'loading' || h.session.phase === 'idle';
  }, 600_000);
  for (; seen < h.events.length; seen++) { const e = h.events[seen]; if (e.type === 'draft') out.drafts.push(e.state); }
  if (!draftDone || h.session.phase !== 'loading') { out.why = `draft did not finish (phase ${h.session.phase})`; return out; }
  out.setup = lastOf(h, 'loading')?.setup;
  o.beforeMatch?.();
  h.session.matchReady();
  const client = h.session.currentMatch();
  if (!client) { out.why = 'no match client'; return out; }
  client.setTimeScale(16);
  // each pump of 1/30 s at time scale 16 runs 16 ticks
  const pumps = Math.ceil(((o.maxGameSeconds ?? PROBE_TIME_LIMIT + 30) * 30) / 16) + 10;
  const phase = (): string => h.session.phase;   // a getter: re-read after every pump
  for (let i = 0; i < pumps && phase() === 'match'; i++) client.pump(1 / 30);
  out.gameSeconds = client.view.time;
  const pg = lastOf(h, 'postgame');
  if (phase() !== 'postgame' || !pg) { out.why = `no post-game (phase ${phase()}, t ${client.view.time.toFixed(1)})`; return out; }
  out.postgame = pg; out.result = pg.result; out.ok = true;
  return out;
}
