// VALE session — LocalSession: the whole client-side session in the browser (CONTRACT §7, §8).
//
//   idle ─queue()─▶ searching ─▶ found (ready check) ─accept─▶ draft ─▶ loading ─matchReady()─▶ match
//        ◀─────── cancel / decline / timeout (lockout) ◀──┘          (dodge = cancelQueue in draft)
//   match ─end / leave()─▶ postgame (grants, rating, history, profile saved) ─playAgain()─▶ searching
// Custom lobbies and practice skip search and ready check (straight to their draft). Every step
// emits a SessionEvent ('queue' 'draft' 'loading' 'match' 'postgame' 'profile' 'error').
//
// Matchmaking is simulated (matchmaker.ts), every open seat is a bot, the draft runs locally
// (draft.ts), the match runs on a LocalMatchHost (match_host.ts) the presentation pumps each frame.
// Grants (grants.ts), ratings (ratings.ts) and purchases (economy.ts) write the profile, which is
// saved through the ProfileStore after every change. RemoteSession (remote_session.ts) is the
// dedicated-server seam with the same interface.
//
// SEATS + TEAMS: you sit at a random seat of a random team; bot party members (setPartyBots) take
// the next seats of your team. Bot difficulty is queue.bots.difficulty ('by_rating' → your rating's
// band, ratings.ts); bot names are a seeded shuffle of catalog.botNames.
// PROTOCOL: queue.pick ?? mode.pick; practice uses 'role_preset' with QueueRequest.preset, else a
// solo 'blind' pick; custom lobbies use their mode's protocol (preset fighters stay locked).
// DRAFT SIDE EFFECTS: a skin chosen in the draft is equipped on the profile; a loadout chosen in the
// draft is saved as that fighter's loadout.
// TIMERS: the draft advances every DRAFT_TICK_MS on the session Clock. Defaults when a queue has no
// `draft` block: bans 20 s, picks 25 s, bench window 20 s, finalize 8 s (role_preset 5 s).

import type { CatalogT, ModeDefT, QueueDefT, RulesParamsT } from '../contracts/catalog.ts';
import type {
  DraftAction, DraftState, GrantSummary, Identity, MatchClient, MatchHistoryEntry, PartyMember,
  Profile, ProfileStore, QueueRequest, Session, SessionEvent, Settings,
} from '../contracts/session.ts';
import type { LoadoutChoice, MatchResult, MatchSetup, PlayerId } from '../contracts/sim.ts';
import { Rng, stream } from '../sim/rng.ts';
import { BOTS_LINK, type PickLoadout } from './bots_link.ts';
import { iso, RealClock, type Clock } from './clock.ts';
import { DraftHost, type DraftSeatInit, type PickProtocol } from './draft.ts';
import { createFallbackDraftBrain, type DraftBrainFactory } from './draft_brain.ts';
import { equipSkin as equip, ownsSkin, purchase as buy, type PurchaseResult } from './economy.ts';
import { applyGrants, grantsDisabled } from './grants.ts';
import { IdSource, randomSeed, randomToken } from './ids.ts';
import { LocalIdentityProvider } from './identity.ts';
import { LocalMatchHost, forfeitResult, MAX_TIME_SCALE, type BotFactory } from './match_host.ts';
import { Matchmaker, type QueueEvent } from './matchmaker.ts';
import {
  HISTORY_CAP, LocalProfileStore, MemoryProfileStore, isRawStore, migrateProfile, newProfile, reconcileProfile, type ProfileContext,
} from './profile_store.ts';
import {
  botOpponent, compositeOpponent, difficultyForRating, GLICKO, newRatingRecord, rateMatch, shownTier, type Difficulty, type Opponent,
} from './ratings.ts';
import {
  assignTeamRoles, botSkins, buildMatchSetup, checkCustom, customCatalog, customLayout, draftRoles, effectiveRules, fighterPool, findMode,
  findQueue, isFfaMode, modeLayout, pickProtocol, sanitizeLoadout, yourSkins, type SeatSlot,
} from './setup.ts';
import { patchSettings } from './settings.ts';

export const DRAFT_TICK_MS = 100;
export const MAX_PARTY_BOTS = 4;
export const DRAFT_DEFAULTS = { ban: 20, pick: 25, bench: 20, finalize: 8, presetFinalize: 5 } as const;

export type SessionPhase = 'idle' | 'searching' | 'found' | 'accepted' | 'draft' | 'loading' | 'match' | 'postgame';

export interface LocalSessionOptions {
  catalog: CatalogT;
  /** default: LocalProfileStore (localStorage, in-memory fallback) */
  store?: ProfileStore;
  /** default: RealClock */
  clock?: Clock;
  /** session rng seed (default: random) — fixes search times, sides, bot names, draft bots, match seeds */
  seed?: number;
  /** in-match bot controllers (default: the BOTS lane via bots_link.ts; null = idle bots) */
  bots?: BotFactory | null;
  /** draft bots (default: the BOTS lane, else the fallback brain) */
  draftBrain?: DraftBrainFactory;
  /** bot loadouts (default: the BOTS lane, else setup defaults) */
  pickLoadout?: PickLoadout | null;
  /** allow time scale up to 16 in every queue (dev builds, probes) */
  dev?: boolean;
  /** your seat is drafted and/or played by bot brains (probes, attract mode): true = both */
  autopilot?: boolean | 'draft' | 'match';
  /** pre-game countdown seconds (sim default when omitted) */
  pregameSeconds?: number;
  /** simulated search time range in seconds (default 2–6) */
  searchSeconds?: [number, number];
}

/** everything about the match being assembled, from queue pop to post-game */
interface Pending {
  req: QueueRequest;
  queue: QueueDefT;            // the catalog queue (grants, ranked, kind)
  mode: ModeDefT;
  map: string;
  simCatalog: CatalogT;        // custom lobbies run on a derived catalog (setup.ts customCatalog)
  rules: RulesParamsT;
  protocol: PickProtocol;
  you: PlayerId;
  difficulty: Map<PlayerId, Difficulty>;
  byRating: boolean;
  setup?: MatchSetup;
}

export class LocalSession implements Session {
  readonly kind = 'local' as const;
  readonly catalog: CatalogT;
  private readonly clock: Clock;
  private readonly store: ProfileStore;
  private readonly opts: LocalSessionOptions;
  private readonly seed: number;
  private readonly rng: Rng;          // seats, names, match seeds
  private readonly draftRng: Rng;
  private readonly idRng: Rng;
  private readonly ids: IdSource;
  private readonly brainFactory: DraftBrainFactory;
  private p: Profile;
  private readonly idp: LocalIdentityProvider;
  private listeners: ((e: SessionEvent) => void)[] = [];
  private readonly mm: Matchmaker;
  private _phase: SessionPhase = 'idle';
  private partyBots: PartyMember[] = [];
  private lastReq: QueueRequest | null = null;
  private pending: Pending | null = null;
  private draftHost: DraftHost | null = null;
  private draftTimer: (() => void) | null = null;
  private host: LocalMatchHost | null = null;
  private persistOk = true;
  /** matchReady() arrived before the sim was built (a listener on the first 'loading' event) */
  private readyEarly = false;

  constructor(o: LocalSessionOptions) {
    this.opts = o;
    this.catalog = o.catalog;
    this.clock = o.clock ?? new RealClock();
    this.seed = (o.seed ?? randomSeed()) >>> 0;
    this.rng = stream(this.seed, 'session');
    this.draftRng = stream(this.seed, 'draft');
    this.idRng = stream(this.seed, 'ids');
    this.ids = new IdSource(this.idRng, this.clock);
    this.brainFactory = o.draftBrain ?? BOTS_LINK.draftBrain ?? createFallbackDraftBrain;
    this.store = o.store ?? new LocalProfileStore(this.ctx());
    this.p = this.loadProfile();
    this.idp = new LocalIdentityProvider(this.p.identity, (id) => { this.p.identity = id; this.persist(); });
    this.mm = new Matchmaker(this.clock, stream(this.seed, 'matchmaker'), {
      emit: (e) => this.onQueueEvent(e),
      matched: () => this.onMatched(),
    }, o.searchSeconds);
  }

  // ── profile plumbing ─────────────────────────────────────────────────────────────────────────
  private ctx(): ProfileContext {
    return {
      catalog: this.catalog, catalogVersion: this.catalog.version,
      nowIso: () => iso(this.clock.wall()), newId: (prefix) => this.ids.next(prefix),
      token: () => randomToken(this.idRng, 12),
      defaultName: () => `${this.catalog.strings['session.default_name'] ?? 'Player'} ${1000 + this.idRng.int(0, 8999)}`,
    };
  }

  private loadProfile(): Profile {
    const ctx = this.ctx();
    let raw: unknown = null;
    try { raw = isRawStore(this.store) ? this.store.loadRaw() : this.store.load(); } catch { raw = null; }
    const m = migrateProfile(raw, ctx);
    if (m.profile) {
      const changed = reconcileProfile(m.profile, ctx);
      if (m.migrated || changed) this.save(m.profile);
      return m.profile;
    }
    if (m.reason === 'future') {
      // a newer client wrote this profile: never overwrite it; play on an in-memory copy
      this.persistOk = false;
    }
    const fresh = newProfile(ctx);
    this.save(fresh);
    return fresh;
  }

  private save(p: Profile): void {
    if (!this.persistOk) return;
    try { this.store.save(p); } catch (err) { this.emit({ type: 'error', message: `profile not saved: ${String(err)}` }); }
  }
  private persist(): void {
    this.save(this.p);
    this.emit({ type: 'profile', profile: this.profile() });
  }

  private autopilot(part: 'draft' | 'match'): boolean { return this.opts.autopilot === true || this.opts.autopilot === part; }

  // ── Session: basics ──────────────────────────────────────────────────────────────────────────
  get identity(): Identity { return this.idp.current(); }
  get phase(): SessionPhase { return this._phase; }
  /** seconds left on the re-queue lockout */
  lockout(): number { return this.mm.lockout(); }

  profile(): Profile { return structuredClone(this.p); }

  on(cb: (e: SessionEvent) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((x) => x !== cb); };
  }

  private emit(e: SessionEvent): void {
    for (const l of [...this.listeners]) { try { l(e); } catch { /* a listener never breaks the session */ } }
  }
  private error(message: string): void { this.emit({ type: 'error', message }); }

  party(): PartyMember[] {
    const me: PartyMember = { id: this.identity.id, name: this.identity.displayName, isBot: false, ready: true };
    const role = this.lastReq?.roles?.[0];
    if (role) me.role = role;
    return [me, ...this.partyBots.map((m) => ({ ...m }))];
  }

  setPartyBots(count: number): PartyMember[] {
    const n = Math.max(0, Math.min(MAX_PARTY_BOTS, Math.floor(Number.isFinite(count) ? count : 0)));
    if (this._phase !== 'idle' && this._phase !== 'postgame') { this.error('party: cannot change the party now'); return this.party(); }
    const names = this.botNames(new Set([this.identity.displayName]));
    while (this.partyBots.length < n) {
      const i = this.partyBots.length;
      this.partyBots.push({ id: `party-bot-${i + 1}`, name: names[i] ?? `Bot ${i + 1}`, isBot: true, ready: true });
    }
    this.partyBots.length = n;
    return this.party();
  }

  // ── queue ────────────────────────────────────────────────────────────────────────────────────
  queue(req: QueueRequest): void {
    if (!req || typeof req.queue !== 'string') { this.error('queue: no queue given'); return; }
    const queue = findQueue(this.catalog, req.queue);
    if (!queue) { this.error(`queue: unknown queue '${req.queue}'`); return; }
    if (this._phase !== 'idle' && this._phase !== 'postgame') { this.error(`queue: busy (${this._phase})`); return; }
    if (this.p.level < queue.unlockLevel) { this.error(`queue: unlocks at level ${queue.unlockLevel}`); return; }
    if (1 + this.partyBots.length > queue.partyMax) { this.error(`queue: party of ${1 + this.partyBots.length} is over this queue's limit of ${queue.partyMax}`); return; }
    const lock = this.mm.lockout();
    if (lock > 0 && queue.kind !== 'custom' && queue.kind !== 'practice') {
      this.error(`queue: locked out for ${Math.ceil(lock)} s`);
      this.emit({ type: 'queue', state: 'idle', queue: queue.id, lockout: lock });
      return;
    }
    const mode = findMode(this.catalog, queue.mode);
    if (!mode) { this.error(`queue: '${queue.id}' names unknown mode '${queue.mode}'`); return; }
    if (queue.kind !== 'custom' && queue.kind !== 'practice' && pickProtocol(mode, queue) === 'role_preset') {
      if (!req.preset || !this.catalog.fighters.some((f) => f.id === req.preset!.fighter)) { this.error('queue: choose a fighter for this queue (QueueRequest.preset)'); return; }
    }
    if (queue.kind === 'custom') {
      const chk = checkCustom(this.catalog, req.custom);
      if (!chk.ok) { this.error(chk.message); return; }
    }
    this.lastReq = structuredClone(req);
    this.teardownMatch();
    if (queue.kind === 'custom' || queue.kind === 'practice') {
      this._phase = 'accepted';
      this.emit({ type: 'queue', state: 'accepted', queue: queue.id });
      this.beginDraft(req, queue);
      return;
    }
    const seats = queue.bots.fill === 'none' ? 1 + this.partyBots.length : modeLayout(mode).length;
    if (this.mm.start(queue.id, seats)) this._phase = 'searching';
    else this.error('queue: the matchmaker is busy');
  }

  playAgain(): void {
    if (!this.lastReq) { this.error('play again: nothing to repeat'); return; }
    this.queue(structuredClone(this.lastReq));
  }

  acceptMatch(): void { if (!this.mm.accept()) this.error('accept: no ready check'); }
  declineMatch(): void { if (!this.mm.decline()) this.error('decline: no ready check'); }

  cancelQueue(): void {
    if (this._phase === 'searching' || this._phase === 'found' || (this._phase === 'accepted' && !this.draftHost)) { this.mm.cancel(); return; }
    if (this._phase === 'draft' && this.pending) {
      const free = this.pending.queue.kind === 'custom' || this.pending.queue.kind === 'practice';
      const queue = this.pending.queue.id;
      this.stopDraft();
      this.pending = null;
      this._phase = 'idle';
      if (free) this.emit({ type: 'queue', state: 'idle', queue, reason: 'cancelled' });
      else this.emit({ type: 'queue', state: 'idle', queue, reason: 'dodged', lockout: this.mm.penalize() });
    }
  }

  private onQueueEvent(e: QueueEvent): void {
    if (e.state === 'searching') this._phase = 'searching';
    else if (e.state === 'found') this._phase = 'found';
    else if (e.state === 'accepted') this._phase = 'accepted';
    else if (e.state === 'idle') this._phase = 'idle';
    this.emit(e);
  }

  private onMatched(): void {
    const req = this.lastReq;
    const queue = req ? findQueue(this.catalog, req.queue) : undefined;
    if (!req || !queue) { this._phase = 'idle'; return; }
    this.beginDraft(req, queue);
  }

  // ── draft ────────────────────────────────────────────────────────────────────────────────────
  private botNames(exclude: Set<string>): string[] {
    const names = this.catalog.botNames.filter((n) => !exclude.has(n));
    return stream(this.seed, `names:${this.p.history.length}:${this.partyBots.length}`).shuffle([...names]);
  }

  private yourRating(queue: QueueDefT): number {
    const id = queue.ranked?.ratingId;
    return id ? this.p.ratings[id]?.rating ?? GLICKO.rating : GLICKO.rating;
  }

  /** plan the match and open its draft; any failure returns to idle with an 'error' (never a stuck phase) */
  private beginDraft(req: QueueRequest, queue: QueueDefT): void {
    try {
      this.openDraft(this.pending = this.planMatch(req, queue));
    } catch (err) {
      this.stopDraft();
      this.pending = null;
      this._phase = 'idle';
      this.error(`draft: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private openDraft(pd: Pending): void {
    const { req, queue } = pd;
    const seats = this.draftSeats(pd);
    const draft = queue.draft;
    const finalize = pd.protocol === 'role_preset' ? draft?.finalizeSeconds ?? DRAFT_DEFAULTS.presetFinalize : draft?.finalizeSeconds ?? DRAFT_DEFAULTS.finalize;
    const skinCache = new Map<string, string[]>();
    const loadCache = new Map<string, LoadoutChoice>();
    const host = new DraftHost({
      queue: queue.id, mode: pd.mode.id, protocol: pd.protocol, seats, pool: fighterPool(this.catalog),
      bansPerTeam: pd.protocol === 'draft' ? draft?.bansPerTeam ?? 0 : 0,
      timers: { ban: draft?.banSeconds ?? DRAFT_DEFAULTS.ban, pick: draft?.pickSeconds ?? DRAFT_DEFAULTS.pick, bench: draft?.pickSeconds ?? DRAFT_DEFAULTS.bench, finalize },
      bench: queue.bench ?? { size: 0, rerolls: 0 },
    }, stream(this.draftRng.nextU32(), 'host'), {
      brain: (s) => (s.isBot || (s.isYou && this.autopilot('draft')) ? this.brainFactory(this.catalog, this.draftRng.nextU32()) : null),
      skins: (s, f) => {
        if (s.isYou) return yourSkins(this.catalog, this.p, f);
        const k = `${s.player}:${f}`;
        if (!skinCache.has(k)) skinCache.set(k, botSkins(this.catalog, f, this.draftRng));
        return skinCache.get(k)!;
      },
      loadout: (s, f) => {
        if (s.isYou) return sanitizeLoadout(this.catalog, pd.rules, this.p.loadouts[f]);
        const k = `${s.player}:${f}`;
        if (!loadCache.has(k)) {
          const pick = this.opts.pickLoadout !== undefined ? this.opts.pickLoadout : BOTS_LINK.pickLoadout;
          let l: LoadoutChoice | null = null;
          try { l = pick ? pick(this.catalog, f, pd.rules, this.draftRng.nextU32(), s.role) : null; } catch { l = null; }
          loadCache.set(k, sanitizeLoadout(this.catalog, pd.rules, l ?? undefined));
        }
        return loadCache.get(k)!;
      },
      validLoadout: (_s, _f, l) => sanitizeLoadout(this.catalog, pd.rules, l),
      fighterName: (id) => this.catalog.fighters.find((f) => f.id === id)?.name ?? id,
      fits: (f, role) => { const d = this.catalog.fighters.find((x) => x.id === f); return !!d && (d.role === role || d.secondaryRole === role); },
      onChange: () => { if (this.draftHost === host) this.emit({ type: 'draft', state: host.view(pd.you) }); },
      onDone: () => { if (this.draftHost === host) this.finishDraft(); },
    });
    this.draftHost = host;
    this._phase = 'draft';
    host.start();
    // a preset skin (QueueRequest.preset.skin) is applied like a finalize choice: owned skins of that fighter only
    if (req.preset?.skin && this.draftHost === host) host.act(pd.you, { a: 'skin', skin: req.preset.skin });
    if (this.draftHost === host && !host.done) this.draftTimer = this.clock.every(DRAFT_TICK_MS, () => host.advance(DRAFT_TICK_MS / 1000));
  }

  /** queue → mode, map, catalog, protocol, your seat, difficulties */
  private planMatch(req: QueueRequest, queue: QueueDefT): Pending {
    let mode = findMode(this.catalog, queue.mode);
    if (!mode) throw new Error(`unknown mode '${queue.mode}'`);
    let map = mode.map;
    let simCatalog = this.catalog;
    let protocol: PickProtocol = pickProtocol(mode, queue);
    if (queue.kind === 'custom') {
      const chk = checkCustom(this.catalog, req.custom);
      if (!chk.ok) throw new Error(chk.message);
      mode = chk.mode; map = chk.map;
      simCatalog = customCatalog(this.catalog, queue, mode, req.custom?.rulesOverride);
      protocol = pickProtocol(mode, findQueue(simCatalog, queue.id)!);
    } else if (queue.kind === 'practice') {
      protocol = req.preset && this.catalog.fighters.some((f) => f.id === req.preset!.fighter) ? 'role_preset' : 'blind';
    }
    const simQueue = findQueue(simCatalog, queue.id)!;
    const rules = effectiveRules(mode, simQueue);
    const byRating = queue.bots.difficulty === 'by_rating';
    return { req, queue, mode, map, simCatalog, rules, protocol, you: 0, difficulty: new Map(), byRating };
  }

  private draftSeats(pd: Pending): DraftSeatInit[] {
    const { req, queue, mode } = pd;
    const queueDiff: Difficulty = pd.byRating ? difficultyForRating(this.yourRating(queue)) : (queue.bots.difficulty as Difficulty);
    type Slot = SeatSlot & { you?: boolean; party?: boolean; difficulty?: Difficulty; fighter?: string };
    let slots: Slot[];
    if (queue.kind === 'custom') {
      slots = customLayout(mode, req.custom!);
    } else if (queue.kind === 'practice' && queue.bots.fill === 'none') {
      slots = [{ player: 0, team: 0, you: true }];
    } else {
      const lay = modeLayout(mode);
      const myTeam = this.rng.pick([...new Set(lay.map((s) => s.team))]);
      const mine = lay.filter((s) => s.team === myTeam);
      const at = this.rng.int(0, mine.length - 1);
      const youP = mine[at].player;
      const party = new Set<PlayerId>();
      for (let i = 1; i <= this.partyBots.length && i < mine.length; i++) party.add(mine[(at + i) % mine.length].player);
      const keep = queue.bots.fill === 'none' ? lay.filter((s) => s.player === youP || party.has(s.player)) : lay;
      // renumbered so players stay 0..n-1 when seats were dropped
      slots = keep.map((s, i): Slot => ({ player: i, team: isFfaMode(mode) ? i : s.team, you: s.player === youP, party: party.has(s.player) }));
    }
    const you = slots.find((s) => s.you)!.player;
    pd.you = you;
    // roles per team
    const roles = draftRoles(this.catalog, mode);
    const roleOf = new Map<PlayerId, string>();
    if (roles.length) {
      const prefs = [req.preset?.role, req.roles?.[0], req.roles?.[1]];
      for (const t of [...new Set(slots.map((s) => s.team))]) {
        const ps = slots.filter((s) => s.team === t).map((s) => s.player);
        for (const [p, r] of assignTeamRoles(roles, ps, ps.includes(you) ? you : null, prefs, this.rng)) roleOf.set(p, r);
      }
    }
    // names
    const partyNames = this.partyBots.map((m) => m.name);
    const names = this.botNames(new Set([this.identity.displayName, ...partyNames]));
    let partyI = 0, botI = 0;
    return slots.map((s) => {
      const isYou = s.player === you;
      const isParty = !!s.party;
      const name = isYou ? this.identity.displayName : isParty ? partyNames[partyI++] ?? `Bot ${s.player + 1}` : names[botI++ % Math.max(1, names.length)] ?? `Bot ${s.player + 1}`;
      if (!isYou) pd.difficulty.set(s.player, s.difficulty ?? (queue.kind === 'custom' ? 'adept' : queueDiff));
      const d: DraftSeatInit = { player: s.player, team: s.team, name, isBot: !isYou, isYou };
      const role = roleOf.get(s.player);
      if (role) d.role = role;
      const preset = isYou ? (req.preset?.fighter ?? s.fighter) : s.fighter;
      if (preset) d.preset = preset;
      return d;
    });
  }

  draft(action: DraftAction): void {
    const host = this.draftHost, pd = this.pending;
    if (this._phase !== 'draft' || !host || !pd) { this.error('draft: no draft running'); return; }
    const r = host.act(pd.you, action);
    if (!r.ok) { this.error(`draft: ${r.reason}`); return; }
    // the human's cosmetic + loadout choices stick to the profile
    const me = host.view(pd.you).seats.find((s) => s.player === pd.you);
    if (action.a === 'skin' && me?.locked && ownsSkin(this.p, action.skin)) { equip(this.p, this.catalog, me.locked, action.skin); this.persist(); }
    if (action.a === 'loadout' && me?.locked && me.loadout) { this.p.loadouts[me.locked] = { spells: [...me.loadout.spells], boons: [...me.loadout.boons] }; this.persist(); }
  }

  /** the current draft as you see it (null outside a draft) */
  draftView(): DraftState | null { return this.draftHost && this.pending ? this.draftHost.view(this.pending.you) : null; }

  private stopDraft(): void {
    this.draftTimer?.();
    this.draftTimer = null;
    this.draftHost = null;
  }

  private finishDraft(): void {
    const host = this.draftHost, pd = this.pending;
    this.stopDraft();
    if (!host || !pd) return;
    let setup: MatchSetup;
    try {
      const simQueue = findQueue(pd.simCatalog, pd.queue.id)!;
      setup = buildMatchSetup({
        catalog: pd.simCatalog, queue: simQueue, mode: pd.mode, map: pd.map, final: host.final(), difficulty: pd.difficulty,
        seed: this.rng.nextU32(), matchId: this.ids.next('match'), practice: pd.req.practice,
      });
    } catch (err) {
      this.pending = null;
      this._phase = 'idle';
      this.error(`match setup: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    pd.setup = setup;
    this.enterLoading(pd, setup);
  }

  // ── loading + match ──────────────────────────────────────────────────────────────────────────
  private enterLoading(pd: Pending, setup: MatchSetup): void {
    this._phase = 'loading';
    this.readyEarly = false;
    this.emit({ type: 'loading', setup, progress: 0 });
    const free = pd.queue.kind === 'practice' || pd.queue.kind === 'custom' || this.opts.dev === true;
    const bots = this.opts.bots !== undefined ? this.opts.bots : BOTS_LINK.bots?.(pd.simCatalog, setup) ?? null;
    let host: LocalMatchHost;
    try {
      host = new LocalMatchHost(pd.simCatalog, setup, pd.you, {
        bots, pregameSeconds: this.opts.pregameSeconds, maxTimeScale: free ? MAX_TIME_SCALE : 1, autopilot: this.autopilot('match'),
        onEnd: (r) => { if (this.host === host) this.finishMatch(r, false); },
        onForfeit: () => { if (this.host === host) this.finishMatch(forfeitResult(setup, host.view, pd.you), true); },
      });
    } catch (err) {
      this.pending = null;
      this._phase = 'idle';
      this.error(`match: could not start (${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    this.host = host;
    this.emit({ type: 'loading', setup, progress: 1 });
    if (this.readyEarly && this.host === host) { this.readyEarly = false; this.matchReady(); }
  }

  currentMatch(): MatchClient | null { return this._phase === 'loading' || this._phase === 'match' ? this.host : null; }

  matchReady(): void {
    if (this._phase === 'loading' && !this.host) { this.readyEarly = true; return; }   // called from the progress-0 event
    if (this._phase !== 'loading' || !this.host) { this.error('matchReady: nothing is loading'); return; }
    this.host.start();
    this._phase = 'match';
    this.emit({ type: 'match', client: this.host });
  }

  private finishMatch(result: MatchResult, forfeit: boolean): void {
    const pd = this.pending;
    if (!pd || (this._phase !== 'match' && this._phase !== 'loading')) return;
    const ctx = this.ctx();
    const grants: GrantSummary = applyGrants(this.p, ctx, { catalog: this.catalog, queue: pd.queue, result, you: pd.you, forfeit, wall: this.clock.wall() });
    const ratingDelta = this.rate(pd, result, grants);
    const me = result.players.find((x) => x.player === pd.you);
    if (me) {
      const entry: MatchHistoryEntry = {
        matchId: result.matchId, at: iso(this.clock.wall()), queue: result.queue, mode: result.mode, fighter: me.fighter, skin: me.skin,
        won: me.won, placement: me.placement, kills: me.kills, deaths: me.deaths, assists: me.assists, cs: me.cs, duration: result.duration, grants,
      };
      if (ratingDelta !== undefined) entry.ratingDelta = ratingDelta;
      this.p.history.unshift(entry);
      if (this.p.history.length > HISTORY_CAP) this.p.history.length = HISTORY_CAP;
    }
    this.persist();
    this.host?.dispose();
    this.host = null;
    this._phase = 'postgame';
    this.emit({ type: 'postgame', result: structuredClone(result), grants: structuredClone(grants), you: pd.you });
  }

  /** Glicko-2 update for ranked queues (ratings.ts); returns the rating delta */
  private rate(pd: Pending, result: MatchResult, grants: GrantSummary): number | undefined {
    const rk = pd.queue.ranked;
    if (!rk || grantsDisabled(pd.queue)) return undefined;
    const me = result.players.find((x) => x.player === pd.you);
    if (!me) return undefined;
    const before = this.p.ratings[rk.ratingId] ?? newRatingRecord(rk.ratingId, iso(this.clock.wall()));
    const ffa = new Set(result.players.map((x) => x.team)).size > 2;
    const opps: Opponent[] = result.players
      .filter((x) => x.player !== pd.you && (ffa || x.team !== me.team))
      .map((x) => botOpponent(pd.difficulty.get(x.player) ?? 'adept', pd.byRating, before.rating));
    const n = result.players.length;
    const draw = !ffa && result.winningTeam === -1 && result.reason !== 'abandon';
    const score = ffa ? (n > 1 ? (n - me.placement) / (n - 1) : 1) : me.won ? 1 : draw ? 0.5 : 0;
    const after = rateMatch(before, compositeOpponent(opps), score, rk.placementGames, iso(this.clock.wall()));
    this.p.ratings[rk.ratingId] = after;
    grants.ratingBefore = before.rating;
    grants.ratingAfter = after.rating;
    const tb = shownTier(this.catalog.ranks, before), ta = shownTier(this.catalog.ranks, after);
    if (tb) grants.tierBefore = tb;
    if (ta) grants.tierAfter = ta;
    return Math.round((after.rating - before.rating) * 100) / 100;
  }

  private teardownMatch(): void {
    this.host?.dispose();
    this.host = null;
    this.pending = null;
  }

  // ── economy + profile ────────────────────────────────────────────────────────────────────────
  purchase(sku: string): PurchaseResult {
    const r = buy(this.p, this.catalog, sku, { ...this.ctx(), wall: () => this.clock.wall() });
    if (r.ok) this.persist();
    return r;
  }

  equipSkin(fighter: string, skin: string): { ok: boolean; reason?: string } {
    const r = equip(this.p, this.catalog, fighter, skin);
    if (r.ok) this.persist();
    return r;
  }

  saveLoadout(fighter: string, loadout: LoadoutChoice): void {
    if (!this.catalog.fighters.some((f) => f.id === fighter)) { this.error(`loadout: unknown fighter '${fighter}'`); return; }
    const set = this.catalog.setup;
    const spells = [...new Set((loadout?.spells ?? []).filter((s) => set.spells.some((x) => x.id === s)))].slice(0, Math.min(2, set.spellSlots));
    const boons = [...new Set((loadout?.boons ?? []).filter((b) => set.boons.some((x) => x.id === b)))].slice(0, set.boonSlots);
    this.p.loadouts[fighter] = { spells, boons };
    this.persist();
  }

  updateSettings(patch: Partial<Settings>): void {
    this.p.settings = patchSettings(this.p.settings, patch);
    this.persist();
  }

  rename(name: string): void { this.idp.rename(name); }

  resetProfile(): void {
    if (this._phase !== 'idle' && this._phase !== 'postgame') { this.error('profile: cannot reset during a queue, draft or match'); return; }
    try { this.store.reset(); } catch { /* the save below replaces it anyway */ }
    this.p = newProfile(this.ctx(), this.identity);
    this.persist();
  }

  // ── teardown ─────────────────────────────────────────────────────────────────────────────────
  /** stop every timer and the match (page unload, tests) */
  dispose(): void {
    this.mm.reset();
    this.stopDraft();
    this.teardownMatch();
    this.listeners = [];
  }
}

/** a LocalSession on a MemoryProfileStore (Node, tools) */
export function memorySession(o: Omit<LocalSessionOptions, 'store'> & { initial?: unknown }): { session: LocalSession; store: MemoryProfileStore } {
  const store = new MemoryProfileStore(o.initial);
  return { session: new LocalSession({ ...o, store }), store };
}
