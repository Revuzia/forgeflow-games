// VALE HUD — the match model: what the HUD derives from the MatchClient's view and event stream
// (client_hud §4–§7). One per mounted HUD. It owns the signals the widgets read (a frame counter that
// bumps once per new sim tick, the kill feed, the announcer queue, the feed, ping markers, the death
// recap, the surrender vote, the end of the match) and turns SimEvents into words through the strings
// (announce.*, killfeed.*, ping.*, hint.*). It never plays a match cue: the AUDIO lane hears the same
// events. Damage / heal / Gleam numbers go to a listener (the world layer) instead of a signal.
//
// PER-TICK WORK (r12 B4): widgets do not re-render every sim tick. A widget re-renders only when a small
// key of its discrete state changes (useViewKey in ctx.ts), and continuous values (cooldown sweeps and
// seconds, bar widths, timers, Gleam) are written straight into the DOM by WRITERS (onWrite) that this
// model runs once per new sim tick from the HUD's rAF loop. `derived()` caches what several widgets need
// per tick (your loss-of-control status, which abilities' effects are running); `chips(e)` caches a unit's
// status row (statuses, buffs, team buffs → buff / debuff chips) per tick.

import { batch, signal } from '@preact/signals';
import type { CatalogT, UnitDefT } from '../../contracts/catalog.ts';
import type { DamageLogEntry, MatchClient } from '../../contracts/session.ts';
import type { EntityId, EntityView, MatchResult, PingKind, PlayerId, PlayerView, SimEvent, WorldView } from '../../contracts/sim.ts';
import type { CatalogView } from '../catalog_view.ts';
import { fmtInt } from '../format.ts';

export type Rel = 'self' | 'ally' | 'enemy' | 'neutral';
export interface Who { name: string; fighter?: string; skin?: string; player?: PlayerId; rel: Rel; seat?: number; team?: number }
/** what a fighter fell to when no fighter took them down (HUD-6: the kill feed draws it as a glyph, not a sentence) */
export interface Cause { kind: 'structure' | 'monster' | 'wicks'; name: string; rel: Rel }
export interface KillRow { id: number; at: number; kind: 'takedown' | 'fell' | 'structure' | 'objective' | 'wipe' | 'out'; killer?: Who; victim?: Who; assists: Who[];
  /** the full sentence: the row's aria-label, and its visible words only where no chip already says them */
  text: string; mine: boolean; cause?: Cause }
export interface Banner { id: number; title: string; sub: string; major: boolean; ms: number; tone: 'own' | 'foe' | 'plain';
  /** kill banners: the fighter who scored (a) and the one who fell (b), shown as round portraits */
  a?: Who; b?: Who }
export interface FeedLine { id: number; at: number; text: string; tone: 'info' | 'warn' | 'ally' | 'hint' }
export interface PingMark { id: number; at: number; kind: PingKind; x: number; y: number; target?: EntityId; player: PlayerId; self: boolean; fromX: number; fromY: number }
export interface Recap { at: number; open: boolean; killer: EntityId | -1; killerName: string; killerDef: string; log: readonly DamageLogEntry[]; structure: boolean }
export interface Vote { yes: number; no: number; needed: number; by: PlayerId; at: number; voted: boolean; mine?: boolean }
export interface NumberPop { kind: 'damage' | 'heal' | 'gold'; dtype?: 'phys' | 'magic' | 'true'; amount: number; crit: boolean; dst: EntityId; x: number; y: number }

const KILLFEED_MS = 6000, FEED_MS = 6000, PING_MS = 4000;
const MINOR_MS = 2400, MAJOR_MS = 3600, KILL_MS = 3500;
/** statuses that stop casting (sim status.ts canCast: hard CC, taunt, fear); silence stops abilities only */
export const CAST_LOCK = new Set<string>(['stun', 'airborne', 'sleep', 'taunt', 'fear']);
/** loss of control the CC chip names, strongest first */
export const LOC_ORDER: readonly string[] = ['stun', 'airborne', 'sleep', 'fear', 'taunt', 'silence', 'root', 'disarm'];
/** statuses that help their holder (a buff border); every other one is a debuff */
export const HELPFUL = new Set<string>(['haste', 'invisible', 'untargetable', 'unstoppable']);
/** one chip of a status row: a status kind (merged), a buff (per id and applier) or a team buff */
export interface Chip {
  /** stable across ticks: 's:<kind>' · 'b:<id>:<src>' · 't:<id>' */
  key: string;
  type: 'status' | 'buff' | 'team';
  /** status kind · buff id · team buff id */
  id: string;
  /** the record that applied it (buffs: ability / item / spell id) */
  source: string;
  /** helps its holder (applied by its own side, or a helpful status) */
  good: boolean;
  stacks: number;
  remaining: number;
  duration: number;
}
export const CHIP_MAX = 12;
/** what a row of at most `max` chips shows: everything when it fits; when it overflows, every harm first
 *  (loss of control first, as chips() sorts it) and then as much help as is left — the harm you most need to
 *  see is never what "+n" hides. The display order stays help, then harm. */
export function rowFit(list: readonly Chip[], max: number): { shown: Chip[]; hidden: Chip[] } {
  if (list.length <= max) return { shown: [...list], hidden: [] };
  const good = list.filter((c) => c.good), bad = list.filter((c) => !c.good);
  const nBad = Math.min(bad.length, max), nGood = Math.max(0, max - nBad);
  return { shown: [...good.slice(0, nGood), ...bad.slice(0, nBad)], hidden: [...good.slice(nGood), ...bad.slice(nBad)] };
}
/** a refusal caption over the Dial Bar */
export interface Caption { n: number; text: string; tone: 'warn' }
/** per-tick derived state (cached on the view tick) */
export interface Derived {
  tick: number;
  /** ability / item / spell ids whose effect is running → seconds left (Infinity = while it lasts). Read from
   *  the provenance the sim view carries: your buffs (BuffView.source), statuses you put on yourself
   *  (StatusView.source + src), zones you placed (EntityView.def is the ability id) and your channel */
  active: Map<string, number>;
  /** the loss-of-control status the CC chip shows */
  loc: { kind: string; remaining: number; duration: number } | null;
  /** you cannot cast anything (stun, airborne, sleep, taunt, fear) — the status that does it */
  castLock: string | null;
  silenced: boolean;
  /** rooted: dashes fail (the Dial Bar marks dash abilities) */
  rooted: boolean;
}
export const RECAP_DELAY_MS = 1200;

let seq = 1;
const rankLoc = (kind: string): number => { const i = LOC_ORDER.indexOf(kind); return i < 0 ? 99 : i; };

export class HudModel {
  readonly client: MatchClient;
  readonly cv: CatalogView;
  readonly ffa: boolean;
  /** bumps once per new sim tick (widgets read it to re-render) */
  readonly frame = signal(0);
  readonly killfeed = signal<KillRow[]>([]);
  readonly banner = signal<Banner | null>(null);
  readonly feed = signal<FeedLine[]>([]);
  readonly pings = signal<PingMark[]>([]);
  readonly recap = signal<Recap | null>(null);
  readonly vote = signal<Vote | null>(null);
  readonly ended = signal<MatchResult | null>(null);
  /** your level-ups (a counter the Dial Bar animates on) */
  readonly levelUp = signal({ n: 0, level: 0 });
  /** a refused action, for the slot shake (+ the why) */
  readonly denied = signal<{ n: number; slot: string; why: string }>({ n: 0, slot: '', why: '' });
  /** casts you made (the slot press flash) */
  readonly pressed = signal<{ n: number; slot: string }>({ n: 0, slot: '' });
  /** the refusal caption over the Dial Bar (1.2 s) */
  readonly caption = signal<Caption>({ n: 0, text: '', tone: 'warn' });
  /** a press while you cannot act: the loss-of-control chip pulses (it already says why) */
  readonly locPulse = signal(0);
  /** your current target (selected, attacked or last hit fighter): the target frame */
  readonly target = signal<EntityId>(-1);

  private bannerQ: Banner[] = [];
  private bannerTimer = 0;
  private lastTick = -1;
  private off: (() => void) | null = null;
  private numberCbs: ((n: NumberPop) => void)[] = [];
  private hurtCbs: ((amount: number) => void)[] = [];
  private wiped = new Set<number>();
  private units = new Map<string, UnitDefT>();
  private recapTimer = 0;
  private disposed = false;
  private writers = new Set<() => void>();
  private writeTick = -1;
  private derivedCache: Derived = { tick: -1, active: new Map(), loc: null, castLock: null, silenced: false, rooted: false };
  private chipCache = new Map<EntityId, { tick: number; list: Chip[]; key: string }>();
  /** this batch's takedown that involves you (its banner waits for the batch's announces) */
  private pendingKill: { killer: PlayerId; victim: PlayerId } | null = null;
  private lastKill: { killer: Who | undefined; victim: Who } | null = null;

  constructor(client: MatchClient, cv: CatalogView) {
    this.client = client;
    this.cv = cv;
    this.ffa = cv.isFfa(cv.mode(client.setup.mode));
    for (const u of (cv.c as CatalogT).units) this.units.set(u.id, u);
    this.off = client.onEvents((evs) => { try { this.onEvents(evs); } catch (e) { console.error('[vale] hud events', e); } });
    if (client.view.phase === 'ended' && client.view.result) this.ended.value = client.view.result;
  }

  dispose(): void {
    this.disposed = true;
    this.off?.(); this.off = null;
    clearTimeout(this.bannerTimer); clearTimeout(this.recapTimer);
    this.numberCbs = [];
    this.hurtCbs = [];
    this.writers.clear();
  }

  /** a DOM writer run once per new sim tick (and once now); returns its removal */
  onWrite(fn: () => void): () => void {
    this.writers.add(fn);
    try { fn(); } catch (e) { console.error('[vale] hud writer', e); }
    return () => { this.writers.delete(fn); };
  }
  /** run every writer on the next frame even without a new sim tick (paused practice, a re-render) */
  flushWriters(): void { this.writeTick = -1; }

  /** per-tick derived state, cached on the view tick */
  derived(): Derived {
    const v = this.view;
    if (this.derivedCache.tick === v.tick) return this.derivedCache;
    const d: Derived = { tick: v.tick, active: new Map(), loc: null, castLock: null, silenced: false, rooted: false };
    const body = this.body;
    if (body && body.alive) {
      for (const b of body.buffs) d.active.set(b.source, Math.max(d.active.get(b.source) ?? 0, b.remaining));
      let best = -1;
      for (const s of body.statuses) {
        // a status your own ability (item, spell) put on you runs that ability's effect (StatusView.source)
        if (s.source && s.src === body.id && s.remaining > 0) d.active.set(s.source, Math.max(d.active.get(s.source) ?? 0, s.remaining));
        if (CAST_LOCK.has(s.kind) && (!d.castLock || LOC_ORDER.indexOf(s.kind) < LOC_ORDER.indexOf(d.castLock))) d.castLock = s.kind;
        if (s.kind === 'silence') d.silenced = true;
        if (s.kind === 'root') d.rooted = true;
        const rank = LOC_ORDER.indexOf(s.kind);
        if (rank < 0) continue;
        const score = (LOC_ORDER.length - rank) * 1000 + s.remaining;
        if (score > best) { best = score; d.loc = { kind: s.kind, remaining: s.remaining, duration: Math.max(s.duration, s.remaining, 0.01) }; }
      }
      // zones you placed run their ability's effect (EntityView.def is the ability id for zones)
      for (const e of v.entities) if (e.kind === 'zone' && e.owner === this.you && e.alive) d.active.set(e.def, Infinity);
      // a channel runs the ability being channelled
      if (body.state === 'channel') {
        const slot = body.anim.startsWith('cast_') ? body.anim.slice(5) : '';
        const av = this.me?.abilities.find((a) => a.slot === slot);
        if (av) d.active.set(av.id, Math.max(d.active.get(av.id) ?? 0, Math.max(0, body.stateDuration - body.stateTime)));
      }
    }
    this.derivedCache = d;
    return d;
  }

  /** a unit's status row for this tick: buffs first, then debuffs (loss of control first); cached per tick.
   *  A row that overflows its cap drops help before harm (StatusRow, rowFit) */
  chips(e: EntityView): { list: Chip[]; key: string } {
    const v = this.view;
    const c = this.chipCache.get(e.id);
    if (c && c.tick === v.tick) return c;
    const good: Chip[] = [], bad: Chip[] = [];
    const byKind = new Map<string, Chip>();
    for (const s of e.statuses) {
      if (s.remaining <= 0) continue;
      const k = byKind.get(s.kind);
      if (k) { k.stacks++; if (s.remaining > k.remaining) { k.remaining = s.remaining; k.duration = Math.max(s.duration, s.remaining); } continue; }
      const chip: Chip = { key: `s:${s.kind}`, type: 'status', id: s.kind, source: '', good: HELPFUL.has(s.kind), stacks: 1, remaining: s.remaining, duration: Math.max(s.duration, s.remaining, 0.01) };
      byKind.set(s.kind, chip);
      (chip.good ? good : bad).push(chip);
    }
    for (const ch of byKind.values()) if (ch.stacks < 2) ch.stacks = 0;   // merged statuses show no count
    bad.sort((a, b) => rankLoc(a.id) - rankLoc(b.id));
    for (const b of e.buffs) {
      const src = b.src !== undefined && b.src >= 0 ? v.entity(b.src) : undefined;
      const helps = !src || src.team === e.team;
      const chip: Chip = { key: `b:${b.id}:${b.src ?? -1}`, type: 'buff', id: b.id, source: b.source, good: helps, stacks: b.stacks > 1 ? b.stacks : 0,
        remaining: b.remaining, duration: Math.max(b.duration, b.remaining, 0.01) };
      (helps ? good : bad).push(chip);
    }
    if (e.kind === 'fighter' && e.team >= 0) {
      const t = v.teams.find((x) => x.team === e.team);
      if (t) for (const tb of t.buffs) {
        const def = (this.cv.c as CatalogT).teamBuffs.find((x) => x.id === tb.id);
        good.push({ key: `t:${tb.id}`, type: 'team', id: tb.id, source: tb.id, good: true, stacks: 0, remaining: tb.remaining,
          duration: def?.duration ?? (Number.isFinite(tb.remaining) ? Math.max(tb.remaining, 0.01) : Infinity) });
      }
    }
    const list = [...good, ...bad];
    const out = { tick: v.tick, list, key: list.map((x) => `${x.key}${x.stacks ? `x${x.stacks}` : ''}`).join(',') };
    this.chipCache.set(e.id, out);
    if (this.chipCache.size > 64) for (const id of this.chipCache.keys()) { if (id !== e.id && this.chipCache.get(id)!.tick !== v.tick) this.chipCache.delete(id); }
    return out;
  }

  /** a unit you selected (left click) or ordered an attack on: the target plate follows it */
  select(id: EntityId | null): void {
    if (id === null) { this.target.value = -1; return; }
    const e = this.view.entity(id);
    if (!e || !e.alive || e.id === this.body?.id || e.kind === 'projectile' || e.kind === 'zone' || e.kind === 'pickup' || e.kind === 'ward' || e.maxHp <= 0) return;
    this.target.value = id;
  }


  // ── views ──────────────────────────────────────────────────────────────────────────────────────
  get view(): WorldView { return this.client.view; }
  get you(): PlayerId { return this.client.you; }
  get me(): PlayerView | undefined { return this.view.players[this.you]; }
  get myTeam(): number { return this.me?.team ?? 0; }
  get body(): EntityView | undefined { const p = this.me; return p ? this.view.entity(p.entity) : undefined; }
  unit(id: string | undefined): UnitDefT | undefined { return id ? this.units.get(id) : undefined; }
  relOfTeam(team: number): Rel { return team < 0 ? 'neutral' : team === this.myTeam ? 'ally' : 'enemy'; }
  relOfPlayer(p: PlayerId): Rel { return p === this.you ? 'self' : this.relOfTeam(this.view.players[p]?.team ?? -1); }
  relOfEntity(e: EntityView): Rel {
    if (e.owner === this.you && e.kind === 'fighter') return 'self';
    if (e.kind === 'monster' || e.kind === 'pickup') return 'neutral';
    return this.relOfTeam(e.team);
  }
  who(p: PlayerId): Who {
    const pv = this.view.players[p];
    const seat = pv ? (pv.colorIndex % 10) + 1 : undefined;
    return { name: pv?.name ?? '', fighter: pv?.fighter, skin: pv?.skin, player: p, rel: this.relOfPlayer(p), seat, team: pv?.team };
  }
  teamName(team: number): string { return this.cv.t(team === 0 ? 'team.aubade' : 'team.serenade', team === 0 ? 'Aubade' : 'Serenade'); }

  /** per animation frame: bump the frame signal when the sim advanced, then run the DOM writers */
  tick(): void {
    const t = this.view.tick;
    if (t !== this.lastTick) { this.lastTick = t; this.frame.value = t; }
    if (t !== this.writeTick) {
      this.writeTick = t;
      for (const w of this.writers) { try { w(); } catch (e) { console.error('[vale] hud writer', e); } }
    }
    const tg = this.target.peek();
    if (tg >= 0) { const e = this.view.entity(tg); if (!e || !e.alive || (e.team !== this.myTeam && (e.visibleMask & (1 << this.myTeam)) === 0)) this.target.value = -1; }
    const now = performance.now();
    const kf = this.killfeed.peek();
    if (kf.length && now - kf[kf.length - 1].at > KILLFEED_MS) this.killfeed.value = kf.filter((r) => now - r.at <= KILLFEED_MS);
    const fd = this.feed.peek();
    if (fd.length && now - fd[0].at > FEED_MS) this.feed.value = fd.filter((r) => now - r.at <= FEED_MS);
    const pg = this.pings.peek();
    if (pg.length && now - pg[0].at > PING_MS) this.pings.value = pg.filter((r) => now - r.at <= PING_MS);
    const v = this.vote.peek();
    if (v && now - v.at > 60000) this.vote.value = null;
  }

  onNumber(cb: (n: NumberPop) => void): () => void {
    this.numberCbs.push(cb);
    return () => { this.numberCbs = this.numberCbs.filter((x) => x !== cb); };
  }
  /** damage your fighter takes (amount), for the optional damage edge (Settings.access.damageFlash) */
  onHurt(cb: (amount: number) => void): () => void {
    this.hurtCbs.push(cb);
    return () => { this.hurtCbs = this.hurtCbs.filter((x) => x !== cb); };
  }

  // ── feed + banners ─────────────────────────────────────────────────────────────────────────────
  say(text: string, tone: FeedLine['tone'] = 'info'): void {
    if (!text) return;
    const line: FeedLine = { id: seq++, at: performance.now(), text, tone };
    this.feed.value = [...this.feed.peek().slice(-4), line];
  }
  announce(title: string, sub: string, major: boolean, tone: Banner['tone'] = 'plain', who?: { a?: Who; b?: Who }): void {
    if (!title) return;
    const b: Banner = { id: seq++, title, sub, major, ms: who ? KILL_MS : major ? MAJOR_MS : MINOR_MS, tone, ...(who?.a ? { a: who.a } : {}), ...(who?.b ? { b: who.b } : {}) };
    if (!this.banner.peek()) { this.showBanner(b); return; }
    this.bannerQ.push(b);
    if (this.bannerQ.length > 2) this.bannerQ.shift();
  }
  private showBanner(b: Banner): void {
    this.banner.value = b;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      if (this.disposed) return;
      const next = this.bannerQ.shift() ?? null;
      if (next) this.showBanner(next); else this.banner.value = null;
    }, b.ms);
  }
  private killRow(r: Omit<KillRow, 'id' | 'at'>): void {
    const row: KillRow = { ...r, id: seq++, at: performance.now() };
    this.killfeed.value = [row, ...this.killfeed.peek()].slice(0, 3);
  }

  // ── strings ────────────────────────────────────────────────────────────────────────────────────
  private t(key: string, params?: Record<string, string | number>): string { return this.cv.t(key, '', params); }
  private has(key: string): boolean { return key in this.cv.c.strings; }
  private side(team: number | undefined): 'own' | 'foe' { return team === this.myTeam ? 'own' : 'foe'; }
  /** structure family for announce lookups: the unit id's first word when the strings know it, else 'other' */
  private family(prefix: string, def: string | undefined): string {
    if (!def) return 'other';
    if (this.has(`${prefix}.${def}.own.title`)) return def;
    const head = def.split('_')[0];
    return this.has(`${prefix}.${head}.own.title`) ? head : 'other';
  }
  private nameOf(p: PlayerId | undefined): string { return p === undefined ? '' : p === this.you ? this.cv.t('killfeed.you', 'You') : this.view.players[p]?.name ?? ''; }
  private unitName(def: string | undefined): string { return this.unit(def)?.name ?? ''; }

  // ── events ─────────────────────────────────────────────────────────────────────────────────────
  private onEvents(evs: SimEvent[]): void {
    const deaths = new Map<EntityId, Extract<SimEvent, { e: 'death' }>>();
    for (const ev of evs) if (ev.e === 'death') deaths.set(ev.dst, ev);
    batch(() => {
      for (const ev of evs) this.one(ev, deaths);
      // a takedown that involves you gets its own banner unless the batch announced it (first, multi, shutdown, streak)
      const k = this.pendingKill;
      this.pendingKill = null;
      if (k) {
        const you = k.killer === this.you;
        const key = you ? 'announce.takedown.you' : k.victim === this.you ? 'announce.takedown.fell' : 'announce.takedown.assist';
        const title = this.t(`${key}.title`);
        if (title) this.announce(title, this.t(`${key}.sub`, { victim: this.nameOf(k.victim), killer: this.nameOf(k.killer) }), false, k.victim === this.you ? 'foe' : 'own',
          { a: this.who(k.killer), b: this.who(k.victim) });
      }
    });
  }

  private one(ev: SimEvent, deaths: Map<EntityId, Extract<SimEvent, { e: 'death' }>>): void {
    const v = this.view;
    switch (ev.e) {
      case 'announce': this.onAnnounce(ev); break;
      case 'takedown': {
        const victim = this.who(ev.victim);
        const mine = ev.killer === this.you || ev.victim === this.you || ev.assists.includes(this.you);
        this.lastKill = { killer: ev.killer >= 0 ? this.who(ev.killer) : undefined, victim };
        if (ev.killer >= 0 && !this.ffa && (ev.killer === this.you || ev.victim === this.you || ev.assists.includes(this.you))) this.pendingKill = { killer: ev.killer, victim: ev.victim };
        if (ev.killer >= 0) {
          const assists = ev.assists.filter((a) => a !== ev.killer).map((a) => this.who(a));
          const text = assists.length
            ? this.cv.t('killfeed.takedown_assist', '{killer} took down {victim} with {names}', { killer: this.nameOf(ev.killer), victim: this.nameOf(ev.victim), names: assists.map((a) => this.nameOf(a.player)).join(', ') })
            : this.cv.t('killfeed.takedown', '{killer} took down {victim}', { killer: this.nameOf(ev.killer), victim: this.nameOf(ev.victim) });
          this.killRow({ kind: 'takedown', killer: this.who(ev.killer), victim, assists, text, mine });
          if (ev.streak >= 3 && !this.ffa) {
            const n = Math.min(7, ev.streak);
            const title = this.t(`announce.streak.${n}.title`);
            if (title) { this.pendingKill = null; this.announce(title, this.t(`announce.streak.${n}.sub`, { name: this.nameOf(ev.killer), n: ev.streak }), ev.streak >= 5, this.side(v.players[ev.killer]?.team), { a: this.who(ev.killer), b: victim }); }
          }
        } else {
          const vp = v.players[ev.victim];
          const d = vp ? deaths.get(vp.entity) : undefined;
          const k = d && d.killer >= 0 ? v.entity(d.killer) : undefined;
          const text = k?.kind === 'structure' ? this.cv.t('killfeed.fell_to_structure', '{victim} fell to the {structure}', { victim: this.nameOf(ev.victim), structure: this.unitName(k.def) })
            : k?.kind === 'monster' ? this.cv.t('killfeed.fell_to_monster', '{victim} fell to the {unit}', { victim: this.nameOf(ev.victim), unit: this.unitName(k.def) })
              : k?.kind === 'minion' ? this.cv.t('killfeed.fell_to_wicks', '{victim} fell to the Wicks', { victim: this.nameOf(ev.victim) })
                : this.cv.t('killfeed.fell', '{victim} fell', { victim: this.nameOf(ev.victim) });
          const cause: Cause | undefined = k?.kind === 'structure' ? { kind: 'structure', name: this.unitName(k.def), rel: this.relOfTeam(k.team) }
            : k?.kind === 'monster' ? { kind: 'monster', name: this.unitName(k.def), rel: 'neutral' }
              : k?.kind === 'minion' ? { kind: 'wicks', name: this.cv.t('killfeed.cause.wicks', 'Wicks'), rel: this.relOfTeam(k.team) } : undefined;
          this.killRow({ kind: 'fell', victim, assists: [], text, mine, cause });
        }
        this.checkWipe();
        break;
      }
      case 'structure': {
        const text = this.cv.t('killfeed.structure', '{team} lost a {structure}', { team: this.teamName(ev.team), structure: this.unitName(ev.def) });
        this.killRow({ kind: 'structure', victim: { name: this.unitName(ev.def), rel: this.relOfTeam(ev.team), team: ev.team }, assists: [], text, mine: false });
        break;
      }
      case 'objective': {
        const text = this.cv.t('killfeed.objective', '{team} took the {unit}', { team: this.teamName(ev.team), unit: this.unitName(ev.unit) });
        this.killRow({ kind: 'objective', killer: { name: this.teamName(ev.team), rel: this.relOfTeam(ev.team), team: ev.team }, assists: [], text, mine: false });
        break;
      }
      case 'eliminated': {
        this.killRow({ kind: 'out', victim: this.who(ev.player), assists: [], text: this.cv.t('killfeed.eliminated', '{victim} is out', { victim: this.nameOf(ev.player) }), mine: ev.player === this.you });
        break;
      }
      case 'respawn': {
        const p = v.players[ev.player];
        if (p) this.wiped.delete(p.team);
        if (ev.player === this.you) { clearTimeout(this.recapTimer); this.recap.value = null; }
        break;
      }
      case 'death': {
        const me = this.me;
        if (me && ev.dst === me.entity) {
          const k = ev.killer >= 0 ? v.entity(ev.killer) : undefined;
          const log = this.client.damageLog?.() ?? [];
          const last = [...log].reverse().find((l) => l.src === ev.killer) ?? log[log.length - 1];
          const kp = k && k.owner >= 0 ? v.players[k.owner] : undefined;
          const r: Recap = {
            at: performance.now(), open: false, killer: ev.killer,
            killerName: kp ? kp.name : k ? this.unitName(k.def) || (last?.srcName ?? '') : last?.srcName ?? '',
            killerDef: kp ? kp.fighter : k?.def ?? last?.srcDef ?? '',
            log: [...log], structure: k?.kind === 'structure' || k?.kind === 'minion' || k?.kind === 'monster',
          };
          this.recap.value = r;
          clearTimeout(this.recapTimer);
          this.recapTimer = window.setTimeout(() => { if (!this.disposed && this.recap.peek() === r) this.recap.value = { ...r, open: true }; }, RECAP_DELAY_MS);
        }
        break;
      }
      case 'levelUp':
        if (ev.player === this.you) this.levelUp.value = { n: this.levelUp.peek().n + 1, level: ev.level };
        break;
      case 'ping': {
        const pv = v.players[ev.player];
        if (!pv || pv.team !== this.myTeam) break;
        const from = v.entity(pv.entity);
        const mark: PingMark = { id: seq++, at: performance.now(), kind: ev.kind, x: ev.x, y: ev.y, target: ev.target, player: ev.player, self: ev.player === this.you, fromX: from?.x ?? ev.x, fromY: from?.y ?? ev.y };
        const mine = this.pings.peek().filter((p) => p.player === ev.player);
        const drop = mine.length >= 3 ? mine[0].id : -1;
        this.pings.value = [...this.pings.peek().filter((p) => p.id !== drop), mark];
        if (ev.player !== this.you) this.say(this.cv.t(`ping.${ev.kind}.log`, '{name}', { name: pv.name }), 'ally');
        break;
      }
      case 'damage': {
        const src = ev.src >= 0 ? v.entity(ev.src) : undefined;
        const me = this.me;
        if (me && ev.dst === me.entity && ev.amount > 0) for (const cb of this.hurtCbs) { try { cb(ev.amount); } catch { /* never breaks the match */ } }
        if (!src || !me || src.owner !== this.you || ev.dst === me.entity || ev.amount <= 0) break;
        const dst = v.entity(ev.dst);
        if (!dst) break;
        if (dst.kind === 'fighter' && src.kind === 'fighter') this.target.value = dst.id;
        this.pop({ kind: 'damage', dtype: ev.dtype, amount: ev.amount, crit: ev.crit, dst: ev.dst, x: dst.x, y: dst.y });
        break;
      }
      case 'heal': {
        const src = ev.src >= 0 ? v.entity(ev.src) : undefined;
        if (!src || src.owner !== this.you) break;
        const dst = v.entity(ev.dst);
        if (!dst || ev.amount < 0.05 * dst.maxHp) break;
        this.pop({ kind: 'heal', amount: ev.amount, crit: false, dst: ev.dst, x: dst.x, y: dst.y });
        break;
      }
      case 'gold':
        if (ev.player === this.you && ev.amount >= 1 && (ev.reason === 'cs' || ev.reason === 'kill' || ev.reason === 'assist' || ev.reason === 'structure' || ev.reason === 'objective' || ev.reason === 'pickup')) {
          this.pop({ kind: 'gold', amount: ev.amount, crit: false, dst: -1, x: ev.x, y: ev.y });
        }
        break;
      case 'recall':
        if (ev.player === this.you && ev.state === 'cancel') this.say(this.cv.t('hud.recall_cancelled', 'Recall cancelled.'), 'info');
        break;
      case 'end':
        this.ended.value = ev.result;
        break;
      default: break;
    }
  }

  private pop(n: NumberPop): void { for (const cb of this.numberCbs) { try { cb(n); } catch { /* never breaks the match */ } } }

  /** RIFT/BRIDGE team wipe (derived: the sim has no event) — every fighter of a team down at once */
  private checkWipe(): void {
    if (this.ffa) return;
    const v = this.view;
    const teams = new Set(v.players.map((p) => p.team));
    for (const team of teams) {
      if (this.wiped.has(team)) continue;
      const ps = v.players.filter((p) => p.team === team);
      if (ps.length < 2 || !ps.every((p) => p.respawnIn > 0 || !(v.entity(p.entity)?.alive ?? false))) continue;
      this.wiped.add(team);
      const side = this.side(team);
      this.announce(this.t(`announce.team_wipe.${side}.title`), this.t(`announce.team_wipe.${side}.sub`, { team: this.teamName(team) }), true, side === 'own' ? 'foe' : 'own');
      this.killRow({ kind: 'wipe', victim: { name: this.teamName(team), rel: this.relOfTeam(team), team }, assists: [], text: this.cv.t('killfeed.wipe', 'Lamps out for {team}', { team: this.teamName(team) }), mine: false });
    }
  }

  private onAnnounce(ev: Extract<SimEvent, { e: 'announce' }>): void {
    const p = ev.params ?? {};
    const name = this.nameOf(ev.player);
    switch (ev.key) {
      case 'match_start': {
        const mode = this.cv.queue(this.client.setup.queue)?.kind === 'practice' ? 'practice' : this.client.setup.mode;
        this.announce(this.t(`announce.match_start.${mode}.title`) || this.cv.t('hud.live', 'Live'), this.t(`announce.match_start.${mode}.sub`), true);
        break;
      }
      case 'first_blood': this.pendingKill = null; this.announce(this.t('announce.first_blood.title'), this.t('announce.first_blood.sub', { name }), true, this.side(ev.team), this.killWho(ev.player)); break;
      case 'multikill': {
        const n = Math.max(2, Math.min(5, Number(p.n) || 2));
        this.pendingKill = null;
        this.announce(this.t(`announce.multikill.${n}.title`), this.t(`announce.multikill.${n}.sub`, { name }), n >= 3, this.side(ev.team), this.killWho(ev.player));
        break;
      }
      case 'shutdown': {
        const vp = typeof p.victim === 'number' ? p.victim : Number(p.victim);
        const victim = this.nameOf(vp);
        this.pendingKill = null;
        this.announce(this.t('announce.shutdown.title'), this.t('announce.shutdown.sub', { name, victim, gold: fmtInt(Number(p.gold) || 0) }), false, this.side(ev.team),
          { a: ev.player !== undefined ? this.who(ev.player) : undefined, b: Number.isFinite(vp) && this.view.players[vp] ? this.who(vp) : undefined });
        break;
      }
      case 'structure_destroyed': {
        const fam = this.family('announce.structure_destroyed', String(p.def ?? ''));
        const side = this.side(ev.team);
        const params = { team: this.teamName(ev.team ?? 0) };
        // the fallen structure's side: "own" is bad news, so the banner tone flips
        this.announce(this.t(`announce.structure_destroyed.${fam}.${side}.title`, params), this.t(`announce.structure_destroyed.${fam}.${side}.sub`, params), fam !== 'other' && !this.isNeedleFamily(fam), side === 'own' ? 'foe' : 'own');
        break;
      }
      case 'structure_respawned': {
        const fam = this.family('announce.structure_respawned', String(p.def ?? ''));
        const side = this.side(ev.team);
        const params = { team: this.teamName(ev.team ?? 0) };
        this.announce(this.t(`announce.structure_respawned.${fam}.${side}.title`, params), this.t(`announce.structure_respawned.${fam}.${side}.sub`, params), false, side);
        break;
      }
      case 'objective_taken': {
        const unit = String(p.unit ?? '');
        const key = this.has(`announce.objective_taken.${unit}.own.title`) ? unit : 'other';
        const side = this.side(ev.team);
        const params = { team: this.teamName(ev.team ?? 0) };
        this.announce(this.t(`announce.objective_taken.${key}.${side}.title`, params), this.t(`announce.objective_taken.${key}.${side}.sub`, params), true, side);
        break;
      }
      case 'eliminated': {
        const you = ev.player === this.you;
        const params = { name, ord: this.cv.ordinal(Number(p.placement) || 0), total: this.view.players.length };
        this.announce(this.t(`announce.eliminated.${you ? 'you' : 'other'}.title`, params), this.t(`announce.eliminated.${you ? 'you' : 'other'}.sub`, params), you, you ? 'foe' : 'plain');
        break;
      }
      case 'sudden_death': this.announce(this.t('announce.sudden_death.title'), this.t('announce.sudden_death.sub'), true); break;
      case 'surrender_vote': {
        if (ev.team !== this.myTeam) break;
        const prev = this.vote.peek();
        const voted = (prev?.voted ?? false) || ev.player === this.you;
        const mine = prev?.mine ?? (ev.player === this.you && !prev ? true : undefined);
        this.vote.value = { yes: Number(p.yes) || 0, no: Number(p.no) || 0, needed: Number(p.needed) || 1, by: prev?.by ?? (ev.player ?? -1), at: prev?.at ?? performance.now(), voted, ...(mine !== undefined ? { mine } : {}) };
        if (!prev) this.say(this.cv.t('hud.surrender.vote', '{name} proposes to surrender.', { name }), 'warn');
        break;
      }
      case 'surrender_passed': case 'surrender_failed': {
        if (ev.team !== this.myTeam) break;
        this.vote.value = null;
        this.announce(this.t(`announce.${ev.key}.title`), this.t(`announce.${ev.key}.sub`), false);
        break;
      }
      case 'shop_denied': {
        if (ev.player !== this.you) break;
        let reason = String(p.reason ?? 'unknown');
        if (reason === 'access' && this.has(`announce.shop_denied.access_${this.client.setup.mode}`)) reason = `access_${this.client.setup.mode}`;
        this.say(this.t(`announce.shop_denied.${reason}`) || this.cv.t('announce.shop_denied.unknown', 'That item is not for sale.'), 'warn');
        this.denied.value = { n: this.denied.peek().n + 1, slot: 'shop', why: reason };
        break;
      }
      case 'practice': if (ev.player === this.you) this.say(this.t(`announce.practice.${String(p.action ?? '')}`), 'info'); break;
      case 'practice_reset': this.announce(this.t('announce.practice_reset.title'), this.t('announce.practice_reset.sub'), false); break;
      default: {
        const title = this.t(`announce.${ev.key}.title`);
        if (title) this.announce(title, this.t(`announce.${ev.key}.sub`, p), false);
      }
    }
  }
  /** portraits for a kill announce: the scorer and the fighter of this batch's takedown */
  private killWho(killer: PlayerId | undefined): { a?: Who; b?: Who } | undefined {
    if (killer === undefined) return undefined;
    const k = this.lastKill;
    return { a: this.who(killer), b: k && k.killer?.player === killer ? k.victim : undefined };
  }
  private isNeedleFamily(fam: string): boolean {
    // the roads' many structures are minor news; the stand-alone families (their own strings) are major
    return fam !== 'other' && this.view.entities.filter((e) => e.kind === 'structure' && e.def.split('_')[0] === fam).length > 2;
  }
}
