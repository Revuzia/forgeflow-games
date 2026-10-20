// VALE server — one online match room (CONTRACT §7.2, src/contracts/net.ts): ready check → draft (the
// same DraftHost the client uses offline; every human sees their own seat's view) → loading → lockstep.
//
// LOCKSTEP: the room runs the authoritative sim (bots included, the same factory the clients use) at
// 30 Hz. Each tick it applies the human commands that arrived since the last tick (and the commands of a
// bot driving any seat whose player left), steps, and broadcasts { tick n, commands }. Clients replay the
// same commands into their own sim. Digests every DIGEST_EVERY ticks catch a client that drifted.

import type { CatalogT, ModeDefT, QueueDefT } from '../src/contracts/catalog.ts';
import { DIGEST_EVERY, type NetProfile, type ServerMsg } from '../src/contracts/net.ts';
import type { DraftAction, QueueRequest } from '../src/contracts/session.ts';
import type { Command, MatchResult, MatchSetup, PlayerId, SimEvent } from '../src/contracts/sim.ts';
import { TICK_DT } from '../src/contracts/sim.ts';
import { BOTS_LINK } from '../src/session/bots_link.ts';
import { DraftHost, type DraftSeatInit } from '../src/session/draft.ts';
import { DRAFT_DEFAULTS } from '../src/session/local_session.ts';
import { difficultyForRating, type Difficulty } from '../src/session/ratings.ts';
import {
  botSkins, buildMatchSetup, draftRoles, effectiveRules, fighterPool, findMode, isFfaMode, modeLayout, pickProtocol, sanitizeLoadout,
} from '../src/session/setup.ts';
import { createBots } from '../src/sim/bots/index.ts';
import { stateDigest } from '../src/sim/core.ts';
import { Rng, stream } from '../src/sim/rng.ts';
import { createSim, worldOf, type Sim } from '../src/sim/sim.ts';

/** a connected player as the room sees it */
export interface Peer {
  readonly id: string;
  name: string;
  send(m: ServerMsg): void;
  room: Room | null;
}
export interface Ticket { peer: Peer; req: QueueRequest; profile: NetProfile; since: number }

export interface RoomOptions {
  catalog: CatalogT;
  queue: QueueDefT;
  tickets: Ticket[];
  seed: number;
  /** ticks per real second (30 = real time; tests run faster) */
  speed?: number;
  readySeconds?: number;
  onClose(room: Room, requeue: Ticket[]): void;
  log?(msg: string): void;
}

type Phase = 'ready' | 'draft' | 'loading' | 'live' | 'ended';
const READY_SECONDS = 10;
const LOAD_TIMEOUT_S = 60;
const DRAFT_TICK_S = 0.1;

export class Room {
  readonly id: string;
  phase: Phase = 'ready';
  private readonly o: RoomOptions;
  private readonly cat: CatalogT;
  private readonly mode: ModeDefT;
  private readonly rng: Rng;
  /** humans, by seat once seated */
  private readonly humans: { t: Ticket; player: PlayerId; accepted: boolean; ready: boolean; left: boolean; token: string; dropped: boolean }[];
  /** every tick of the match (resume replays from here) */
  private readonly history: { n: number; c?: [PlayerId, Command][] }[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private readyLeft: number;
  private draft: DraftHost | null = null;
  private setup: MatchSetup | null = null;
  private sim: Sim | null = null;
  private pending: [PlayerId, Command][] = [];
  private readonly drivers = new Map<PlayerId, { think: (v: never, p: never) => Command[] }>();
  private readonly digests = new Map<number, string>();
  private loadTimer = 0;

  constructor(id: string, o: RoomOptions) {
    this.id = id;
    this.o = o;
    this.cat = o.catalog;
    const mode = findMode(o.catalog, o.queue.mode);
    if (!mode) throw new Error(`queue ${o.queue.id}: unknown mode ${o.queue.mode}`);
    this.mode = mode;
    this.rng = stream(o.seed, `room:${id}`);
    this.readyLeft = o.readySeconds ?? READY_SECONDS;
    this.humans = o.tickets.map((t) => ({ t, player: -1, accepted: false, ready: false, left: false, token: this.rng.nextU32().toString(36) + this.rng.nextU32().toString(36), dropped: false }));
    for (const h of this.humans) h.t.peer.room = this;
    this.broadcastReady();
    this.every(250, () => this.tickReady(0.25 * Math.max(1, o.speed ?? 1)));
  }

  // ── plumbing ────────────────────────────────────────────────────────────────────────────────────
  private every(ms: number, fn: () => void): void { this.timers.push(setInterval(fn, ms)); }
  private stopTimers(): void { for (const t of this.timers) clearInterval(t); this.timers = []; }
  private log(m: string): void { this.o.log?.(`[room ${this.id}] ${m}`); }
  private human(peer: Peer) { return this.humans.find((h) => h.t.peer === peer); }
  private sendAll(m: ServerMsg): void { for (const h of this.humans) if (!h.left) h.t.peer.send(m); }

  /** end the room; tickets in `requeue` go back to the matchmaker */
  private close(requeue: Ticket[] = []): void {
    if (this.phase === 'ended' && !this.timers.length) return;
    this.phase = 'ended';
    this.stopTimers();
    for (const h of this.humans) if (h.t.peer.room === this) h.t.peer.room = null;
    this.o.onClose(this, requeue);
  }

  // ── ready check ─────────────────────────────────────────────────────────────────────────────────
  private broadcastReady(): void {
    const accepted = this.humans.filter((h) => h.accepted).length;
    for (const h of this.humans) {
      h.t.peer.send({ t: 'queue', e: {
        type: 'queue', state: h.accepted ? 'accepted' : 'found', queue: this.o.queue.id,
        readyTimer: Math.max(0, this.readyLeft), readyMax: this.o.readySeconds ?? READY_SECONDS, accepted, total: this.humans.length,
      } });
    }
  }

  private tickReady(dt: number): void {
    if (this.phase !== 'ready') return;
    this.readyLeft -= dt;
    if (this.humans.every((h) => h.accepted)) { this.startDraft(); return; }
    if (this.readyLeft <= 0) { this.failReady(this.humans.filter((h) => !h.accepted).map((h) => h.t.peer)); return; }
    this.broadcastReady();
  }

  /** someone declined or let the timer run out: they go idle, everyone else searches again */
  private failReady(out: Peer[]): void {
    for (const p of out) p.send({ t: 'queue', e: { type: 'queue', state: 'declined', queue: this.o.queue.id, reason: 'declined' } });
    const back = this.humans.filter((h) => !out.includes(h.t.peer)).map((h) => h.t);
    this.close(back);
  }

  accept(peer: Peer): void {
    const h = this.human(peer);
    if (!h || this.phase !== 'ready') return;
    h.accepted = true;
    this.broadcastReady();
    if (this.humans.every((x) => x.accepted)) this.startDraft();
  }

  decline(peer: Peer): void {
    if (this.phase === 'ready') this.failReady([peer]);
  }

  // ── draft ───────────────────────────────────────────────────────────────────────────────────────
  private startDraft(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'draft';
    const q = this.o.queue, mode = this.mode;
    const protocol = pickProtocol(mode, q);
    const rules = effectiveRules(mode, q);
    const lay = modeLayout(mode);
    const ffa = isFfaMode(mode);
    // seats: co-op puts every human on one team; versus queues alternate teams; FFA takes seats in order
    const teams = [...new Set(lay.map((s) => s.team))];
    const coop = q.bots.fill === 'opponents_only' && !ffa;
    const seatOrder: PlayerId[] = [];
    if (coop || ffa) for (const s of lay) seatOrder.push(s.player);
    else {
      const byTeam = teams.map((t) => lay.filter((s) => s.team === t).map((s) => s.player));
      for (let k = 0; seatOrder.length < lay.length; k++) for (const col of byTeam) if (col[k] !== undefined) seatOrder.push(col[k]);
    }
    this.humans.forEach((h, i) => { h.player = seatOrder[i]; });
    const humanOf = new Map(this.humans.map((h) => [h.player, h]));
    // roles: humans take their first free preference, bots fill the rest of their team
    const roles = draftRoles(this.cat, mode);
    const roleOf = new Map<PlayerId, string>();
    if (roles.length) for (const t of teams) {
      const left = roles.map((r) => r.id);
      const seats = lay.filter((s) => s.team === t).map((s) => s.player);
      for (const p of seats) {
        const h = humanOf.get(p);
        if (!h) continue;
        const want = [h.t.req.preset?.role, h.t.req.roles?.[0], h.t.req.roles?.[1]].find((r) => r && left.includes(r)) ?? left[0];
        if (want) { roleOf.set(p, want); left.splice(left.indexOf(want), 1); }
      }
      this.rng.shuffle(left);
      for (const p of seats) if (!roleOf.has(p) && left.length) roleOf.set(p, left.shift()!);
    }
    const taken = new Set(this.humans.map((h) => h.t.profile.name));
    const botNames = this.rng.shuffle(this.cat.botNames.filter((n) => !taken.has(n)));
    let b = 0;
    const difficulty = new Map<PlayerId, Difficulty>();
    const humanRating = Math.round(this.humans.reduce((s, h) => s + (h.t.profile.rating ?? 1500), 0) / Math.max(1, this.humans.length));
    const botDiff: Difficulty = q.bots.difficulty === 'by_rating' ? difficultyForRating(humanRating) : (q.bots.difficulty as Difficulty);
    const seats: DraftSeatInit[] = lay.map((s) => {
      const h = humanOf.get(s.player);
      const d: DraftSeatInit = { player: s.player, team: s.team, name: h ? h.t.profile.name : botNames[b++ % Math.max(1, botNames.length)] ?? `Bot ${s.player + 1}`, isBot: !h, isYou: false };
      const role = roleOf.get(s.player);
      if (role) d.role = role;
      if (h?.t.req.preset?.fighter && this.cat.fighters.some((f) => f.id === h.t.req.preset!.fighter)) d.preset = h.t.req.preset.fighter;
      if (!h) difficulty.set(s.player, botDiff);
      return d;
    });
    const draftCfg = q.draft;
    const finalize = protocol === 'role_preset' ? draftCfg?.finalizeSeconds ?? DRAFT_DEFAULTS.presetFinalize : draftCfg?.finalizeSeconds ?? DRAFT_DEFAULTS.finalize;
    const skinCache = new Map<string, string[]>();
    const loadCache = new Map<string, ReturnType<typeof sanitizeLoadout>>();
    const host = new DraftHost({
      queue: q.id, mode: mode.id, protocol, seats, pool: fighterPool(this.cat),
      bansPerTeam: protocol === 'draft' ? draftCfg?.bansPerTeam ?? 0 : 0,
      timers: { ban: draftCfg?.banSeconds ?? DRAFT_DEFAULTS.ban, pick: draftCfg?.pickSeconds ?? DRAFT_DEFAULTS.pick, bench: draftCfg?.pickSeconds ?? DRAFT_DEFAULTS.bench, finalize },
      bench: q.bench ?? { size: 0, rerolls: 0 },
    }, stream(this.rng.nextU32(), 'host'), {
      brain: (s) => (s.isBot && BOTS_LINK.draftBrain ? BOTS_LINK.draftBrain(this.cat, this.rng.nextU32()) : null),
      skins: (s, f) => {
        const h = humanOf.get(s.player);
        const k = `${s.player}:${f}`;
        if (!skinCache.has(k)) {
          const valid = new Set(this.cat.skins.filter((x) => x.fighter === f).map((x) => x.id));
          const mine = h ? (h.t.profile.skins[f] ?? []).filter((id) => valid.has(id)) : [];
          skinCache.set(k, h && mine.length ? mine : h ? this.cat.skins.filter((x) => x.fighter === f && x.tier === 'base').map((x) => x.id).slice(0, 1) : botSkins(this.cat, f, this.rng));
        }
        return skinCache.get(k)!;
      },
      loadout: (s, f) => {
        const k = `${s.player}:${f}`;
        if (!loadCache.has(k)) {
          const h = humanOf.get(s.player);
          let l = h ? h.t.profile.loadouts[f] : undefined;
          if (!h && BOTS_LINK.pickLoadout) { try { l = BOTS_LINK.pickLoadout(this.cat, f, rules, this.rng.nextU32(), s.role) ?? undefined; } catch { l = undefined; } }
          loadCache.set(k, sanitizeLoadout(this.cat, rules, l));
        }
        return loadCache.get(k)!;
      },
      validLoadout: (_s, _f, l) => sanitizeLoadout(this.cat, rules, l),
      fighterName: (id) => this.cat.fighters.find((f) => f.id === id)?.name ?? id,
      fits: (f, role) => { const d = this.cat.fighters.find((x) => x.id === f); return !!d && (d.role === role || d.secondaryRole === role); },
      onChange: () => { if (this.draft === host) this.sendDrafts(); },
      onDone: () => { if (this.draft === host) this.finishDraft(difficulty); },
    });
    this.draft = host;
    this.sendAll({ t: 'queue', e: { type: 'queue', state: 'accepted', queue: q.id, accepted: this.humans.length, total: this.humans.length } });
    host.start();
    for (const h of this.humans) if (h.t.req.preset?.skin) host.act(h.player, { a: 'skin', skin: h.t.req.preset.skin });
    // draft clock: real time (× speed in tests)
    const dspeed = Math.max(1, this.o.speed ?? 1);
    if (this.draft === host && !host.done) this.every(DRAFT_TICK_S * 1000, () => host.advance(DRAFT_TICK_S * dspeed));
    this.sendDrafts();
    this.log(`draft ${protocol} · ${this.humans.map((h) => `${h.t.profile.name}@${h.player}`).join(', ')}`);
  }

  /** each human gets the draft as their own seat sees it */
  private sendDrafts(): void {
    const host = this.draft;
    if (!host) return;
    for (const h of this.humans) {
      if (h.left) continue;
      const v = host.view(h.player);
      for (const s of v.seats) s.isYou = s.player === h.player;
      h.t.peer.send({ t: 'draft', s: v });
    }
  }

  draftAction(peer: Peer, a: DraftAction): void {
    const h = this.human(peer);
    if (!h || this.phase !== 'draft' || !this.draft) return;
    const r = this.draft.act(h.player, a);
    if (!r.ok) peer.send({ t: 'error', m: `draft: ${r.reason}` });
  }

  private finishDraft(difficulty: Map<PlayerId, Difficulty>): void {
    const host = this.draft;
    if (!host) return;
    this.stopTimers();
    this.draft = null;
    const humanSeats = new Set(this.humans.map((h) => h.player));
    let setup: MatchSetup;
    try {
      setup = buildMatchSetup({
        catalog: this.cat, queue: this.o.queue, mode: this.mode, map: this.mode.map,
        final: host.final().map((f) => ({ ...f, isYou: humanSeats.has(f.player) })), difficulty,
        seed: this.rng.nextU32(), matchId: `net-${this.id}`, practice: undefined,
      });
    } catch (err) {
      this.sendAll({ t: 'error', m: `match setup: ${err instanceof Error ? err.message : String(err)}` });
      this.close();
      return;
    }
    this.setup = setup;
    this.phase = 'loading';
    for (const h of this.humans) if (!h.left) h.t.peer.send({ t: 'loading', setup, you: h.player, room: this.id, token: h.token });
    this.loadTimer = 0;
    this.every(500, () => { this.loadTimer += 0.5; if (this.phase === 'loading' && this.loadTimer >= LOAD_TIMEOUT_S) this.startLive(); });
  }

  // ── live (lockstep) ─────────────────────────────────────────────────────────────────────────────
  ready(peer: Peer): void {
    const h = this.human(peer);
    if (!h || this.phase !== 'loading') return;
    h.ready = true;
    if (this.humans.every((x) => x.ready || x.left)) this.startLive();
  }

  private startLive(): void {
    if (this.phase !== 'loading' || !this.setup) return;
    this.stopTimers();
    const setup = this.setup;
    this.sim = createSim(this.cat, setup, { bots: createBots(this.cat, setup) ?? undefined });
    for (const h of this.humans) if (h.left || !h.ready) this.drive(h.player);
    this.phase = 'live';
    this.sendAll({ t: 'start', tick: this.sim.view.tick });
    const speed = Math.max(1, this.o.speed ?? 1);
    // a steady 30 Hz × speed, catching up on timer jitter without ever bursting more than 8 ticks
    let acc = 0, last = performance.now();
    this.every(Math.max(1, Math.floor((TICK_DT * 1000) / speed / 2)), () => {
      const now = performance.now();
      acc += ((now - last) / 1000) * speed;
      last = now;
      let n = 0;
      while (acc >= TICK_DT && n < 8 && this.phase === 'live') { acc -= TICK_DT; this.step(); n++; }
      if (n >= 8) acc = 0;
    });
    this.log(`live · seed ${setup.seed}`);
  }

  command(peer: Peer, c: Command): void {
    const h = this.human(peer);
    if (!h || this.phase !== 'live' || h.left || this.drivers.has(h.player)) return;
    if (!c || typeof c !== 'object' || typeof (c as { type?: unknown }).type !== 'string') return;
    this.pending.push([h.player, c]);
  }

  private drive(player: PlayerId): void {
    const setup = this.setup;
    const seat = setup?.seats.find((s) => s.player === player);
    const factory = setup ? createBots(this.cat, setup) : null;
    if (!seat || !factory || this.drivers.has(player)) return;
    try {
      const ctrl = factory({ ...seat, controller: 'bot', botDifficulty: seat.botDifficulty ?? 'adept' }, { catalog: this.cat, setup: setup!, rng: stream(setup!.seed, `bots:${player}`) });
      if (ctrl) this.drivers.set(player, ctrl as never);
    } catch (err) { this.log(`driver ${player}: ${String(err)}`); }
  }

  private step(): void {
    const sim = this.sim;
    if (!sim) return;
    const cmds = this.pending;
    this.pending = [];
    for (const [p, ctrl] of this.drivers) {
      const pv = sim.view.players[p];
      if (!pv) continue;
      try { for (const c of ctrl.think(sim.view as never, pv as never)) cmds.push([p, c]); } catch (err) { this.log(`driver ${p}: ${String(err)}`); this.drivers.delete(p); }
    }
    for (const [p, c] of cmds) sim.command(p, c);
    const n = sim.view.tick;
    const events: SimEvent[] = sim.step();
    const tick = cmds.length ? { n, c: cmds } : { n };
    this.history.push(tick);
    this.sendAll({ t: 'tick', ...tick });
    const after = sim.view.tick;
    if (after % DIGEST_EVERY === 0) {
      this.digests.set(after, stateDigest(worldOf(sim)));
      for (const k of this.digests.keys()) if (k < after - DIGEST_EVERY * 20) this.digests.delete(k);
    }
    const end = events.find((e): e is Extract<SimEvent, { e: 'end' }> => e.e === 'end');
    if (end || sim.view.phase === 'ended') {
      const result: MatchResult | null | undefined = end?.result ?? sim.view.result;
      if (result) this.sendAll({ t: 'end', result });
      this.log(`ended · ${result?.reason} · ${result?.duration.toFixed(0)} s`);
      this.close();
    }
  }

  digest(peer: Peer, n: number, h: string): void {
    const mine = this.digests.get(n);
    if (mine !== undefined && mine !== h) {
      this.log(`desync · ${peer.name} at tick ${n}`);
      peer.send({ t: 'desync', n });
    }
  }

  /** a player left the match (or dropped): their seat plays on under a bot; a drop may resume */
  leave(peer: Peer, dropped = false): void {
    const h = this.human(peer);
    if (!h) return;
    h.dropped = dropped && this.phase === 'live';
    if (this.phase === 'ready') { this.failReady([peer]); return; }
    h.left = true;
    if (peer.room === this) peer.room = null;
    if (this.phase === 'live') this.drive(h.player);
    if (this.phase === 'loading' && this.humans.every((x) => x.ready || x.left)) this.startLive();
    if (this.humans.every((x) => x.left && !x.dropped)) this.close();
  }

  /** a dropped player is back: hand the seat back and replay the ticks they missed */
  resume(peer: Peer, token: string, from: number): boolean {
    const h = this.humans.find((x) => x.token === token);
    if (!h || this.phase !== 'live' || !this.setup || !h.dropped) return false;
    h.t = { ...h.t, peer };
    h.left = false;
    h.dropped = false;
    peer.room = this;
    peer.name = h.t.profile.name;
    this.drivers.delete(h.player);
    const first = this.history.length ? this.history[0].n : 0;
    const ticks = this.history.slice(Math.max(0, from - first));
    peer.send({ t: 'replay', ticks });
    this.log(`resume · ${h.t.profile.name} from tick ${from} (${ticks.length} replayed)`);
    return true;
  }
}

export type { Rng };
