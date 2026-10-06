// BLOCKTOOTH - net/session.ts (lane B-NET). One online match, end to end: the API the app (B-VIEW) calls.
//
//   room (Supabase: quick match / room code / START / RESULT / signalling)
//     -> RtcMesh (WebRTC: the lockstep stream, host star over a pre-opened mesh)
//       -> LockstepPeer (host-clocked lockstep over a SimPort)
//         <- PumpClock (Worker clock: keeps the authority ticking in a hidden tab)
//
// Usage (app side):
//   const s = new OnlineSession({ build, name, sim: vsWorldPort({ viewSeat: () => mySeat }) /* soloWorldPort(...) for the 1-titan World */, makeStart });
//   const ok = await s.quickMatch();                 // or s.hostCode(Room.makeCode()) / s.joinCode(code)
//   each frame:  s.setInput(titanInput, card);  render s.world (s.peer.simTick advances on the Worker clock)
//   events:      onEvent({type:'started'|'net'|'result'|'error'})
// A running match keeps answering newcomers in its room with a replay-join offer for a bot seat until 3:00, and
// advertises itself in the quick-match lobby while it has a bot seat to give.

import type { TitanInput } from '../core/types.ts';
import { JOIN_CUTOFF_TICK, INPUT_BYTES, TICK_MS, encodeInput, type StartInfo } from './proto.ts';
import { LockstepPeer, type NetEvent } from './lockstep.ts';
import { Room, type RealtimeClient, type RoomStatus, type StartResult } from './room.ts';
import { RtcMesh, type RtcSignal } from './rtcmesh.ts';
import { PumpClock, nowMs } from './clock.ts';
import type { SimPort, Standings } from './simport.ts';

export type SessionEvent =
  | { type: 'status'; status: RoomStatus }
  | { type: 'started'; start: StartInfo; seat: number; host: boolean; reachable: string[]; unreachable: string[]; joined: boolean }
  | { type: 'net'; ev: NetEvent }
  | { type: 'result'; standings: Standings; agreed: boolean }
  | { type: 'error'; why: string };

export interface OnlineSessionOpts<W> {
  build: string;
  name?: string;
  sim: SimPort<W>;
  /** host side: build the START from the final human roster (seed, biome, titans, bot seats, endTick) */
  makeStart: (humans: string[]) => StartInfo;
  onEvent?: (e: SessionEvent) => void;
  client?: () => Promise<RealtimeClient>;
  iceServers?: RTCIceServer[];
  /** wait for every human's WebRTC link this long before starting anyway (a silent seat goes AFK -> bot) */
  connectMs?: number;
  /** sim steps per pump (browser responsiveness; a joiner's replay uses `replayStepsPerPump`) */
  stepsPerPump?: number;
  replayStepsPerPump?: number;
  log?: (m: string) => void;
  /** TEST HOOK (harness only): drop WebRTC signalling to `to` so that pair never connects directly (NAT emulation) */
  signalFilter?: (to: string) => boolean;
  /** room channel namespace (default 'blocktooth'): dev / test runs use their own so they never meet real players */
  gameId?: string;
  /** extra presence fields this peer shows the room (the lobby reads the titan pick of every seat from them) */
  info?: Record<string, unknown>;
  /** app side (lane O-LOBBY): awaited with the START (and the replay-join offer) BEFORE the world is built and the links are
   *  waited for. Load / mount the views here: the signalling listeners are already up (a faster peer's offer is answered), and
   *  no peer starts its sim until every link is open or `connectMs` ran out, so a slow loader does not miss the countdown. */
  beforeStart?: (r: StartResult) => Promise<void>;
}

export class OnlineSession<W> {
  readonly room: Room;
  mesh: RtcMesh | null = null;
  peer: LockstepPeer<W> | null = null;
  readonly clock = new PumpClock(60);
  start: StartInfo | null = null;
  private o: OnlineSessionOpts<W>;
  private inBuf = new Uint8Array(INPUT_BYTES);
  private offers = new Set<string>();
  private advertised = false;
  private resultSent = false;

  constructor(o: OnlineSessionOpts<W>) {
    this.o = o;
    this.room = new Room({ build: o.build, name: o.name, client: o.client, gameId: o.gameId, info: o.info });
  }

  get world(): W | null { return this.peer ? this.peer.world : null; }
  private emit(e: SessionEvent): void { try { this.o.onEvent?.(e); } catch (err) { console.warn('[session] handler', err); } }
  private onStatus = (s: RoomStatus): void => this.emit({ type: 'status', status: s });

  async quickMatch(waitMs?: number): Promise<boolean> {
    const r = await this.room.quickMatch({ makeStart: this.o.makeStart, waitMs, onStatus: this.onStatus });
    return r ? this.begin(r) : false;
  }
  /** `waitMs` > 0: the host (lowest id in the room) also starts after that long (the REMATCH room: bots fill whoever did not come) */
  async hostCode(code: string, waitMs = 0): Promise<boolean> {
    const r = await this.room.hostCode(code, { makeStart: this.o.makeStart, onStatus: this.onStatus, waitMs });
    return r ? this.begin(r) : false;
  }
  async joinCode(code: string): Promise<boolean> {
    const r = await this.room.joinCode(code, { onStatus: this.onStatus });
    return r ? this.begin(r) : false;
  }
  /** the D8 "Start now with bots" button */
  startNow(): void { this.room.startNow(); }
  cancel(): void { this.room.cancel(); }

  /** the input layer's sample for this frame (quantised exactly as the wire carries it) */
  setInput(inp: TitanInput, card = 0): void {
    encodeInput(inp, this.inBuf, 0, card);
    this.peer?.setLocalInput(this.inBuf);
  }

  private async begin(r: StartResult): Promise<boolean> {
    const start = r.start;
    this.start = start;
    const self = this.room.id;
    const now = nowMs;
    const mesh = new RtcMesh({
      self,
      iceServers: this.o.iceServers,
      signal: (to: string, s: RtcSignal) => { if (this.o.signalFilter && !this.o.signalFilter(to)) return; this.room.send('rtc', { to, s: s as unknown as Record<string, unknown> }); },
      onPacket: (from: string, b: Uint8Array) => { this.peer?.receive(from, b, now()); },
      onLink: (peer: string, open: boolean) => { if (!open && this.peer && !mesh.reachable(peer)) this.peer.peerGone(peer, now()); },
      log: this.o.log,
    });
    this.mesh = mesh;
    this.room.onMsg((m) => {
      if (m.t === 'rtc' && m.d.to === self) void mesh.handleSignal(m.from, m.d.s as unknown as RtcSignal);
      else if (m.t === 'result' && this.peer && m.d.standings) this.peer.results.set(m.from, m.d.standings as unknown as Standings);
    });
    const humans = r.running ? (r.running as { humans?: string[] }).humans ?? [] : start.seats.filter((s) => s.kind === 'human' && s.peer).map((s) => s.peer as string);
    if (this.o.beforeStart) {
      try { await this.o.beforeStart(r); } catch (err) { this.emit({ type: 'error', why: 'load failed: ' + String(err) }); this.leave(); return false; }
    }
    mesh.connect(humans);
    const reachable = await mesh.waitOpen(humans, this.o.connectMs ?? 8000);
    const unreachable = humans.filter((h) => h !== self && !reachable.includes(h));
    const running = r.running as (StartResult['running'] & { seat?: number }) | undefined;
    if (running && !reachable.includes(running.authority)) { this.emit({ type: 'error', why: "couldn't connect to the match" }); this.leave(); return false; }
    this.peer = new LockstepPeer<W>({
      self, start, sim: this.o.sim, mesh, now: now(),
      joiner: running ? { seat: running.seat ?? -1, authority: running.authority, epoch: running.epoch } : undefined,
      // a replay / catch-up never freezes the page (Worker pumps at 60 Hz); the world says what it can afford (SimPort.catchup)
      maxStepsPerPump: running ? (this.o.replayStepsPerPump ?? this.o.sim.catchup?.maxStepsPerPump ?? 2000) : (this.o.stepsPerPump ?? 60),
      stepBudgetMs: running ? (this.o.sim.catchup?.stepBudgetMs ?? 25) : 10,
      onEvent: (ev) => this.onNet(ev),
      log: this.o.log,
    });
    this.clock.start(() => this.pump());
    this.room.onPresence(() => this.answerNewcomers());
    const seat = start.seats.findIndex((s) => s.peer === self);
    this.emit({ type: 'started', start, seat: running ? (running.seat ?? -1) : seat, host: r.host, reachable, unreachable, joined: !!running });
    return true;
  }

  /** pump from the app's frame loop too (lane O-LOBBY): the Worker clock is the primary driver and keeps a HIDDEN tab ticking, but if it
   *  is late to start or starved, a visible page must not wait for it. pump() is wall-time based, so a second driver is harmless. */
  kick(): void { this.pump(); }

  private pump(): void {
    const p = this.peer;
    if (!p) return;
    p.pump(nowMs());
    if (p.isAuthority) this.advertise();
  }

  private onNet(ev: NetEvent): void {
    this.emit({ type: 'net', ev });
    if (ev.type === 'result' && !this.resultSent && this.start) {
      this.resultSent = true;
      // Supabase RESULT (one per peer per match); the bridge report (forgeflow:vs_result) is the app's job (Phase A)
      this.room.sendResult({ matchId: this.start.matchId, hash: ev.standings.hash, standings: ev.standings as unknown as Record<string, unknown> });
      setTimeout(() => this.emit({ type: 'result', standings: ev.standings, agreed: !!this.peer?.resultsAgree() }), 1500);
    }
  }

  /** authority: offer a free bot seat to a compatible newcomer in the room (replay join until 3:00) */
  private answerNewcomers(): void {
    const p = this.peer, start = this.start;
    if (!p || !start || !p.isAuthority || p.confirmed >= JOIN_CUTOFF_TICK - 10 * 30) return;
    const roster = p.roster();
    const inMatch = new Set(roster.filter((s) => s.peer && !s.left).map((s) => s.peer as string));
    const freeSeat = roster.find((s) => !s.peer || s.left);
    if (!freeSeat) return;
    for (const id of this.room.humans()) {
      if (inMatch.has(id) || this.offers.has(id) || id === this.room.id) continue;
      this.offers.add(id);
      this.room.send('start', { start: start as unknown as Record<string, unknown>, to: id,
        running: { authority: this.room.id, epoch: p.epoch, tick: p.confirmed, seat: freeSeat.slot, humans: [...inMatch] } });
      break;                                   // one offer per presence change: seats fill one at a time
    }
  }

  /** authority: keep a lobby advert while a bot seat is free and the replay-join window is open */
  private advertise(): void {
    const p = this.peer;
    if (!p) return;
    const free = p.roster().filter((s) => !s.peer || s.left).length;
    const open = free > 0 && p.confirmed < JOIN_CUTOFF_TICK - 15 * 30;
    if (open && !this.advertised) {
      this.advertised = true;
      void this.room.advertiseRunning(free, Date.now() + (JOIN_CUTOFF_TICK - p.confirmed) * TICK_MS);
    } else if (!open && this.advertised) {
      this.advertised = false;
      void this.room.stopAdvertising();
    }
  }

  leave(): void {
    this.peer?.leave(nowMs());
    this.clock.stop();
    setTimeout(() => { this.mesh?.close(); this.room.leave(); }, 300);
  }
}
