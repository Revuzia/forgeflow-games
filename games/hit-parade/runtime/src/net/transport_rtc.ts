// HIT PARADE - net/transport_rtc.ts (lane NET). Tier-1 transport: one RTCPeerConnection per 1v1 with two
// pre-negotiated DataChannels (adapted from games/last-circle/runtime/net/ffg_rtc.js, NETCODE 3.1):
//   'in'  id 1 {ordered:false, maxRetransmits:0}  60 Hz INPUT packets (loss is covered by redundancy)
//   'ctl' id 2 {ordered:true} reliable            snapshots, desync/recovered/delay, flow JSON (text)
// Public STUN only (Google x2 + Cloudflare, all measured answering in NETCODE 0.5), no TURN (owner gate:
// TURN costs money, NETCODE 7.1). The LOWER peer id offers (no glare). Signalling rides the NetPlay room
// channel through the caller's `signal` callback; ICE candidates are batched every 150 ms so a match costs
// a handful of Supabase messages, never a stream.

import type { Transport } from '../core/net/rollback.ts';

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export type RtcSignal =
  | { kind: 'offer' | 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'cands'; list: RTCIceCandidateInit[]; end?: boolean };

export interface RtcPairInfo { local: string; remote: string; protocol: string; rttMs: number | null }

export class RtcTransport implements Transport {
  readonly kind = 'rtc' as const;
  readonly offerer: boolean;
  private pc: RTCPeerConnection | null = null;
  private dcIn: RTCDataChannel | null = null;
  private dcCtl: RTCDataChannel | null = null;
  private inbox: { b: Uint8Array; ctl: boolean; at: number }[] = [];
  private signal: (s: RtcSignal) => void;
  private onText: ((s: string) => void) | null;
  private log: (m: string) => void;
  private pendingCands: RTCIceCandidateInit[] = [];
  private remoteCandQueue: RTCIceCandidateInit[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private openWaiters: ((ok: boolean) => void)[] = [];
  private closed = false;
  lastRecvAt = -1;
  sent = 0;
  recv = 0;
  sendErrors = 0;
  signalsSent = 0;
  openedAt = -1;
  startedAt = -1;

  constructor(o: { offerer: boolean; signal: (s: RtcSignal) => void; onText?: (s: string) => void; log?: (m: string) => void }) {
    this.offerer = o.offerer;
    this.signal = (s) => { this.signalsSent++; o.signal(s); };
    this.onText = o.onText ?? null;
    this.log = o.log ?? (() => { /* quiet */ });
  }

  static supported(): boolean { return typeof RTCPeerConnection !== 'undefined'; }

  /** Create the peer connection + channels; the offerer sends the offer. */
  async start(): Promise<void> {
    if (this.pc) return;
    this.startedAt = performance.now();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    this.dcIn = pc.createDataChannel('in', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.dcCtl = pc.createDataChannel('ctl', { negotiated: true, id: 2, ordered: true });
    for (const dc of [this.dcIn, this.dcCtl]) {
      dc.binaryType = 'arraybuffer';
      const ctl = dc === this.dcCtl;
      dc.onopen = () => this.checkOpen();
      dc.onclose = () => { this.log('dc ' + dc.label + ' closed'); };
      dc.onmessage = (e: MessageEvent) => {
        this.lastRecvAt = performance.now();
        this.recv++;
        if (typeof e.data === 'string') {
          if (this.onText) { try { this.onText(e.data); } catch (err) { console.warn('[rtc] text handler', err); } }
          return;
        }
        const b = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : null;
        if (b) this.inbox.push({ b, ctl, at: this.lastRecvAt });
      };
    }
    pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
      if (e.candidate) { this.pendingCands.push(e.candidate.toJSON()); this.scheduleFlush(false); }
      else this.scheduleFlush(true);
    };
    pc.oniceconnectionstatechange = () => {
      this.log('ice ' + pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') this.resolveOpen(false);
    };
    if (this.offerer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal({ kind: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
    }
  }

  private scheduleFlush(end: boolean): void {
    if (end) {
      if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
      this.signal({ kind: 'cands', list: this.pendingCands.splice(0), end: true });
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.pendingCands.length) this.signal({ kind: 'cands', list: this.pendingCands.splice(0) });
    }, 150);
  }

  async handleSignal(s: RtcSignal): Promise<void> {
    if (this.closed) return;
    if (!this.pc) await this.start();
    const pc = this.pc as RTCPeerConnection;
    try {
      if (s.kind === 'offer' && !this.offerer) {
        await pc.setRemoteDescription(s.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        this.signal({ kind: 'answer', sdp: { type: ans.type, sdp: ans.sdp } });
        await this.flushRemoteCands();
      } else if (s.kind === 'answer' && this.offerer) {
        await pc.setRemoteDescription(s.sdp);
        await this.flushRemoteCands();
      } else if (s.kind === 'cands') {
        for (const c of s.list) this.remoteCandQueue.push(c);
        if (pc.remoteDescription) await this.flushRemoteCands();
      }
    } catch (e) {
      this.log('signal error ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  private async flushRemoteCands(): Promise<void> {
    const pc = this.pc;
    if (!pc || !pc.remoteDescription) return;
    const list = this.remoteCandQueue.splice(0);
    for (const c of list) {
      try { await pc.addIceCandidate(c); } catch (e) { this.log('addIceCandidate ' + (e instanceof Error ? e.message : String(e))); }
    }
  }

  private checkOpen(): void {
    if (this.isOpen()) {
      if (this.openedAt < 0) this.openedAt = performance.now();
      this.resolveOpen(true);
    }
  }

  private resolveOpen(ok: boolean): void {
    const w = this.openWaiters.splice(0);
    for (const cb of w) cb(ok);
  }

  isOpen(): boolean {
    return !!this.dcIn && !!this.dcCtl && this.dcIn.readyState === 'open' && this.dcCtl.readyState === 'open';
  }

  /** Resolves true once both channels are open, false on ICE failure or timeout (5 s = NETCODE 3.1). */
  waitOpen(timeoutMs = 5000): Promise<boolean> {
    if (this.isOpen()) return Promise.resolve(true);
    return new Promise((res) => {
      let done = false;
      const fin = (ok: boolean): void => { if (!done) { done = true; clearTimeout(t); res(ok); } };
      const t = setTimeout(() => fin(this.isOpen()), timeoutMs);
      this.openWaiters.push(fin);
    });
  }

  sendInput(b: Uint8Array): void {
    const dc = this.dcIn;
    if (!dc || dc.readyState !== 'open') return;
    try { dc.send(b as Uint8Array<ArrayBuffer>); this.sent++; } catch { this.sendErrors++; }
  }

  sendCtl(b: Uint8Array): void {
    const dc = this.dcCtl;
    if (!dc || dc.readyState !== 'open') return;
    try { dc.send(b as Uint8Array<ArrayBuffer>); this.sent++; } catch { this.sendErrors++; }
  }

  sendText(s: string): boolean {
    const dc = this.dcCtl;
    if (!dc || dc.readyState !== 'open') return false;
    try { dc.send(s); this.sent++; return true; } catch { this.sendErrors++; return false; }
  }

  drain(cb: (b: Uint8Array, ctl: boolean, at?: number) => void): void {
    if (this.inbox.length === 0) return;
    const list = this.inbox.splice(0);
    for (const it of list) cb(it.b, it.ctl, it.at);
  }

  /** Selected candidate pair (host / srflx / prflx / relay) + ICE RTT, for the match log (NETCODE 3.1). */
  async pairInfo(): Promise<RtcPairInfo | null> {
    const pc = this.pc;
    if (!pc) return null;
    try {
      const stats = await pc.getStats();
      let pairId: string | null = null;
      stats.forEach((r: { type: string; selectedCandidatePairId?: string }) => {
        if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
      });
      let pair: { localCandidateId?: string; remoteCandidateId?: string; currentRoundTripTime?: number; nominated?: boolean; state?: string } | null = null;
      stats.forEach((r: { type: string; id: string; nominated?: boolean; state?: string }) => {
        if (r.type !== 'candidate-pair') return;
        if ((pairId && r.id === pairId) || (!pairId && r.nominated && r.state === 'succeeded')) pair = r as never;
      });
      if (!pair) return null;
      const p = pair as { localCandidateId?: string; remoteCandidateId?: string; currentRoundTripTime?: number };
      const cand = (id?: string): { candidateType?: string; protocol?: string } => {
        let out: { candidateType?: string; protocol?: string } = {};
        stats.forEach((r: { id: string }) => { if (r.id === id) out = r as never; });
        return out;
      };
      const l = cand(p.localCandidateId), r = cand(p.remoteCandidateId);
      return { local: l.candidateType ?? '?', remote: r.candidateType ?? '?', protocol: l.protocol ?? '?',
        rttMs: typeof p.currentRoundTripTime === 'number' ? Math.round(p.currentRoundTripTime * 1000) : null };
    } catch {
      return null;
    }
  }

  close(): void {
    this.closed = true;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    try { this.dcIn?.close(); } catch { /* closed */ }
    try { this.dcCtl?.close(); } catch { /* closed */ }
    try { this.pc?.close(); } catch { /* closed */ }
    this.resolveOpen(false);
  }
}
