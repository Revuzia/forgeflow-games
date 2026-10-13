// VALE HUD — the match model: what the HUD derives from the MatchClient's view and event stream
// (client_hud §4–§7). One per mounted HUD. It owns the signals the widgets read (a frame counter that
// bumps once per new sim tick, the kill feed, the announcer queue, the feed, ping markers, the death
// recap, the surrender vote, the end of the match) and turns SimEvents into words through the strings
// (announce.*, killfeed.*, ping.*, hint.*). It never plays a match cue: the AUDIO lane hears the same
// events. Damage / heal / Gleam numbers go to a listener (the world layer) instead of a signal.

import { batch, signal } from '@preact/signals';
import type { CatalogT, UnitDefT } from '../../contracts/catalog.ts';
import type { DamageLogEntry, MatchClient } from '../../contracts/session.ts';
import type { EntityId, EntityView, MatchResult, PingKind, PlayerId, PlayerView, SimEvent, WorldView } from '../../contracts/sim.ts';
import type { CatalogView } from '../catalog_view.ts';
import { fmtInt } from '../format.ts';

export type Rel = 'self' | 'ally' | 'enemy' | 'neutral';
export interface Who { name: string; fighter?: string; skin?: string; player?: PlayerId; rel: Rel; seat?: number; team?: number }
export interface KillRow { id: number; at: number; kind: 'takedown' | 'fell' | 'structure' | 'objective' | 'wipe' | 'out'; killer?: Who; victim?: Who; assists: Who[]; text: string; mine: boolean }
export interface Banner { id: number; title: string; sub: string; major: boolean; ms: number; tone: 'own' | 'foe' | 'plain' }
export interface FeedLine { id: number; at: number; text: string; tone: 'info' | 'warn' | 'ally' | 'hint' }
export interface PingMark { id: number; at: number; kind: PingKind; x: number; y: number; target?: EntityId; player: PlayerId; self: boolean; fromX: number; fromY: number }
export interface Recap { at: number; open: boolean; killer: EntityId | -1; killerName: string; killerDef: string; log: readonly DamageLogEntry[]; structure: boolean }
export interface Vote { yes: number; no: number; needed: number; by: PlayerId; at: number; voted: boolean; mine?: boolean }
export interface NumberPop { kind: 'damage' | 'heal' | 'gold'; dtype?: 'phys' | 'magic' | 'true'; amount: number; crit: boolean; dst: EntityId; x: number; y: number }

const KILLFEED_MS = 6000, FEED_MS = 6000, PING_MS = 4000;
const MINOR_MS = 2400, MAJOR_MS = 3600;
export const RECAP_DELAY_MS = 1200;

let seq = 1;

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

  private bannerQ: Banner[] = [];
  private bannerTimer = 0;
  private lastTick = -1;
  private off: (() => void) | null = null;
  private numberCbs: ((n: NumberPop) => void)[] = [];
  private wiped = new Set<number>();
  private units = new Map<string, UnitDefT>();
  private recapTimer = 0;
  private disposed = false;

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

  /** per animation frame: bump the frame signal when the sim advanced */
  tick(): void {
    const t = this.view.tick;
    if (t !== this.lastTick) { this.lastTick = t; this.frame.value = t; }
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

  // ── feed + banners ─────────────────────────────────────────────────────────────────────────────
  say(text: string, tone: FeedLine['tone'] = 'info'): void {
    if (!text) return;
    const line: FeedLine = { id: seq++, at: performance.now(), text, tone };
    this.feed.value = [...this.feed.peek().slice(-4), line];
  }
  announce(title: string, sub: string, major: boolean, tone: Banner['tone'] = 'plain'): void {
    if (!title) return;
    const b: Banner = { id: seq++, title, sub, major, ms: major ? MAJOR_MS : MINOR_MS, tone };
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
    batch(() => { for (const ev of evs) this.one(ev, deaths); });
  }

  private one(ev: SimEvent, deaths: Map<EntityId, Extract<SimEvent, { e: 'death' }>>): void {
    const v = this.view;
    switch (ev.e) {
      case 'announce': this.onAnnounce(ev); break;
      case 'takedown': {
        const victim = this.who(ev.victim);
        const mine = ev.killer === this.you || ev.victim === this.you || ev.assists.includes(this.you);
        if (ev.killer >= 0) {
          const assists = ev.assists.filter((a) => a !== ev.killer).map((a) => this.who(a));
          const text = assists.length
            ? this.cv.t('killfeed.takedown_assist', '{killer} took down {victim} with {names}', { killer: this.nameOf(ev.killer), victim: this.nameOf(ev.victim), names: assists.map((a) => this.nameOf(a.player)).join(', ') })
            : this.cv.t('killfeed.takedown', '{killer} took down {victim}', { killer: this.nameOf(ev.killer), victim: this.nameOf(ev.victim) });
          this.killRow({ kind: 'takedown', killer: this.who(ev.killer), victim, assists, text, mine });
          if (ev.streak >= 3 && !this.ffa) {
            const n = Math.min(7, ev.streak);
            const title = this.t(`announce.streak.${n}.title`);
            if (title) this.announce(title, this.t(`announce.streak.${n}.sub`, { name: this.nameOf(ev.killer), n: ev.streak }), ev.streak >= 5, this.side(v.players[ev.killer]?.team));
          }
        } else {
          const vp = v.players[ev.victim];
          const d = vp ? deaths.get(vp.entity) : undefined;
          const k = d && d.killer >= 0 ? v.entity(d.killer) : undefined;
          const text = k?.kind === 'structure' ? this.cv.t('killfeed.fell_to_structure', '{victim} fell to a {structure}', { victim: this.nameOf(ev.victim), structure: this.unitName(k.def) })
            : k?.kind === 'monster' ? this.cv.t('killfeed.fell_to_monster', '{victim} fell to the {unit}', { victim: this.nameOf(ev.victim), unit: this.unitName(k.def) })
              : k?.kind === 'minion' ? this.cv.t('killfeed.fell_to_wicks', '{victim} fell to the Wicks', { victim: this.nameOf(ev.victim) })
                : this.cv.t('killfeed.fell', '{victim} fell', { victim: this.nameOf(ev.victim) });
          this.killRow({ kind: 'fell', victim, assists: [], text, mine });
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
        if (!src || !me || src.owner !== this.you || ev.dst === me.entity || ev.amount <= 0) break;
        const dst = v.entity(ev.dst);
        if (!dst) break;
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
      case 'first_blood': this.announce(this.t('announce.first_blood.title'), this.t('announce.first_blood.sub', { name }), true, this.side(ev.team)); break;
      case 'multikill': {
        const n = Math.max(2, Math.min(5, Number(p.n) || 2));
        this.announce(this.t(`announce.multikill.${n}.title`), this.t(`announce.multikill.${n}.sub`, { name }), n >= 3, this.side(ev.team));
        break;
      }
      case 'shutdown': {
        const victim = this.nameOf(typeof p.victim === 'number' ? p.victim : Number(p.victim));
        this.announce(this.t('announce.shutdown.title'), this.t('announce.shutdown.sub', { name, victim, gold: fmtInt(Number(p.gold) || 0) }), false, this.side(ev.team));
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
  private isNeedleFamily(fam: string): boolean {
    // the roads' many structures are minor news; the stand-alone families (their own strings) are major
    return fam !== 'other' && this.view.entities.filter((e) => e.kind === 'structure' && e.def.split('_')[0] === fam).length > 2;
  }
}
