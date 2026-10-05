// BLOCKTOOTH - net/rtcmesh.ts (lane B-NET). WebRTC DataChannel transport for the lockstep stream.
//
// A pre-opened FULL MESH (up to 3 connections per client, LAST CIRCLE ffg_rtc.js RTCMesh pattern) carrying HOST-STAR
// traffic (guests <-> authority; hashes to everyone). The mesh is pre-opened so host migration needs no new handshake
// (netcode.md 7.1). Per pair, one RTCPeerConnection with two pre-negotiated channels (HIT PARADE transport_rtc.ts):
//   'in'  id 1 {ordered:false, maxRetransmits:0}  INPUT / FRAME / HASH  (loss covered by redundancy)
//   'ctl' id 2 {ordered:true} reliable            LOG / CTL
// The LOWER peer id offers (no glare); a newcomer says `hello` so lower ids know to offer to it. Public STUN only, no
// TURN (owner money gate D11). ICE candidates are batched every 150 ms so signalling costs a handful of Supabase
// messages per pair.
//
// NAT fallback without spend (D11): when there is no direct link to a peer, a packet is FORWARDED through another peer
// that announced a direct link to it (LINKS gossip over 'ctl' every second). Forwarding keeps the channel class.

import type { Mesh } from './lockstep.ts';

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export type RtcSignal =
  | { kind: 'hello' }
  | { kind: 'offer' | 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'cands'; list: RTCIceCandidateInit[]; end?: boolean };

const FWD = 0xf0;
const LINKS = 0xf1;
const TE = new TextEncoder();
const TD = new TextDecoder();

interface Link {
  peer: string;
  pc: RTCPeerConnection;
  dcIn: RTCDataChannel;
  dcCtl: RTCDataChannel;
  offerer: boolean;
  pendingCands: RTCIceCandidateInit[];
  remoteCands: RTCIceCandidateInit[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  open: boolean;
  failed: boolean;
}

export interface RtcMeshOpts {
  self: string;
  /** signalling out (rides the Supabase room channel) */
  signal: (to: string, s: RtcSignal) => void;
  /** every lockstep packet in (forwarded ones arrive with their original sender) */
  onPacket: (from: string, b: Uint8Array) => void;
  /** a direct link opened / failed (failed = ICE failed or closed) */
  onLink?: (peer: string, open: boolean) => void;
  iceServers?: RTCIceServer[];
  log?: (m: string) => void;
}

export class RtcMesh implements Mesh {
  readonly self: string;
  private o: RtcMeshOpts;
  private links = new Map<string, Link>();
  /** peer -> the peers it reported a direct open link to */
  private routes = new Map<string, Set<string>>();
  private gossip: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  sent = 0; recv = 0; forwarded = 0; sendErrors = 0; signals = 0;

  constructor(o: RtcMeshOpts) {
    this.self = o.self;
    this.o = o;
    this.gossip = setInterval(() => this.sendLinks(), 1000);
  }

  static supported(): boolean { return typeof RTCPeerConnection !== 'undefined'; }

  /** make sure a link to every peer exists (lower id offers; higher ids say hello so the lower one offers) */
  connect(peers: readonly string[]): void {
    for (const p of peers) {
      if (p === this.self) continue;
      if (this.self < p) this.ensure(p);
      else { this.sig(p, { kind: 'hello' }); }
    }
  }

  private sig(to: string, s: RtcSignal): void { this.signals++; this.o.signal(to, s); }
  private log(m: string): void { this.o.log?.(m); }

  private ensure(peer: string): Link {
    let l = this.links.get(peer);
    if (l) return l;
    const pc = new RTCPeerConnection({ iceServers: this.o.iceServers ?? ICE_SERVERS });
    const dcIn = pc.createDataChannel('in', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    const dcCtl = pc.createDataChannel('ctl', { negotiated: true, id: 2, ordered: true });
    const link: Link = { peer, pc, dcIn, dcCtl, offerer: this.self < peer, pendingCands: [], remoteCands: [], flushTimer: null, open: false, failed: false };
    l = link;
    this.links.set(peer, link);
    for (const dc of [dcIn, dcCtl]) {
      dc.binaryType = 'arraybuffer';
      dc.onopen = () => this.checkOpen(link);
      dc.onclose = () => this.linkDown(link, 'dc closed');
      dc.onmessage = (e: MessageEvent) => {
        if (!(e.data instanceof ArrayBuffer)) return;
        this.recv++;
        this.onRaw(peer, new Uint8Array(e.data), dc === dcCtl);
      };
    }
    pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
      if (e.candidate) { link.pendingCands.push(e.candidate.toJSON()); this.scheduleFlush(link, false); }
      else this.scheduleFlush(link, true);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'closed') this.linkDown(link, 'pc ' + st);
    };
    if (link.offerer) {
      void (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.sig(peer, { kind: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
        } catch (e) { this.log('offer ' + String(e)); }
      })();
    }
    return link;
  }

  private scheduleFlush(l: Link, end: boolean): void {
    if (end) {
      if (l.flushTimer) { clearTimeout(l.flushTimer); l.flushTimer = null; }
      this.sig(l.peer, { kind: 'cands', list: l.pendingCands.splice(0), end: true });
      return;
    }
    if (l.flushTimer) return;
    l.flushTimer = setTimeout(() => {
      l.flushTimer = null;
      if (l.pendingCands.length) this.sig(l.peer, { kind: 'cands', list: l.pendingCands.splice(0) });
    }, 150);
  }

  async handleSignal(from: string, s: RtcSignal): Promise<void> {
    if (this.closed || from === this.self) return;
    if (s.kind === 'hello') { if (this.self < from) this.ensure(from); return; }
    const l = this.ensure(from);
    try {
      if (s.kind === 'offer' && !l.offerer) {
        await l.pc.setRemoteDescription(s.sdp);
        const ans = await l.pc.createAnswer();
        await l.pc.setLocalDescription(ans);
        this.sig(from, { kind: 'answer', sdp: { type: ans.type, sdp: ans.sdp } });
        await this.flushRemote(l);
      } else if (s.kind === 'answer' && l.offerer) {
        await l.pc.setRemoteDescription(s.sdp);
        await this.flushRemote(l);
      } else if (s.kind === 'cands') {
        for (const c of s.list) l.remoteCands.push(c);
        if (l.pc.remoteDescription) await this.flushRemote(l);
      }
    } catch (e) { this.log('signal ' + String(e)); }
  }

  private async flushRemote(l: Link): Promise<void> {
    if (!l.pc.remoteDescription) return;
    for (const c of l.remoteCands.splice(0)) { try { await l.pc.addIceCandidate(c); } catch (e) { this.log('cand ' + String(e)); } }
  }

  private checkOpen(l: Link): void {
    if (!l.open && l.dcIn.readyState === 'open' && l.dcCtl.readyState === 'open') {
      l.open = true;
      this.o.onLink?.(l.peer, true);
      this.sendLinks();
    }
  }

  private linkDown(l: Link, why: string): void {
    if (l.failed) return;
    l.failed = true;
    const was = l.open;
    l.open = false;
    this.log(`link ${l.peer} down (${why})`);
    if (was || l.pc.connectionState === 'failed') this.o.onLink?.(l.peer, false);
    this.sendLinks();
  }

  isOpen(peer: string): boolean { const l = this.links.get(peer); return !!l && l.open; }
  /** reachable directly or through a relay */
  reachable(peer: string): boolean { return this.isOpen(peer) || this.relayFor(peer) !== null; }
  openPeers(): string[] { return [...this.links.values()].filter((l) => l.open).map((l) => l.peer).sort(); }

  /** resolves with the peers reachable (direct or relayed) once all are, or at the timeout */
  waitOpen(peers: readonly string[], timeoutMs = 6000): Promise<string[]> {
    const want = peers.filter((p) => p !== this.self);
    return new Promise((res) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const ok = want.filter((p) => this.reachable(p));
        if (ok.length === want.length || Date.now() - t0 > timeoutMs) { clearInterval(iv); res(ok); }
      }, 50);
    });
  }

  private relayFor(peer: string): string | null {
    let best: string | null = null;
    for (const [r, set] of this.routes) if (r !== peer && set.has(peer) && this.isOpen(r) && (best === null || r < best)) best = r;
    return best;
  }

  private rawSend(l: Link, b: Uint8Array, reliable: boolean): boolean {
    const dc = reliable ? l.dcCtl : l.dcIn;
    if (dc.readyState !== 'open') return false;
    try { dc.send(b as Uint8Array<ArrayBuffer>); this.sent++; return true; } catch { this.sendErrors++; return false; }
  }

  send(to: string, b: Uint8Array, reliable: boolean): void {
    const l = this.links.get(to);
    if (l && l.open && this.rawSend(l, b, reliable)) return;
    const r = this.relayFor(to);
    if (!r) return;
    const rl = this.links.get(r) as Link;
    this.rawSend(rl, wrapFwd(to, this.self, b), reliable);
  }

  private onRaw(from: string, b: Uint8Array, reliable: boolean): void {
    if (b.length === 0) return;
    if (b[0] === LINKS) {
      try { this.routes.set(from, new Set(JSON.parse(TD.decode(b.subarray(1))) as string[])); } catch { /* malformed */ }
      return;
    }
    if (b[0] === FWD) {
      const f = unwrapFwd(b);
      if (!f) return;
      if (f.to === this.self) { this.o.onPacket(f.from, f.payload); return; }
      const l = this.links.get(f.to);
      if (l && l.open) { this.forwarded++; this.rawSend(l, b, reliable); }
      return;
    }
    this.o.onPacket(from, b);
  }

  private sendLinks(): void {
    if (this.closed) return;
    const body = TE.encode(JSON.stringify(this.openPeers()));
    const b = new Uint8Array(1 + body.length);
    b[0] = LINKS; b.set(body, 1);
    for (const l of this.links.values()) if (l.open) this.rawSend(l, b, true);
  }

  /** selected candidate pair + RTT per open link (match log / lobby RTT warning) */
  async stats(): Promise<Record<string, { local: string; remote: string; rttMs: number | null }>> {
    const out: Record<string, { local: string; remote: string; rttMs: number | null }> = {};
    for (const l of this.links.values()) {
      if (!l.open) continue;
      try {
        const st = await l.pc.getStats();
        let pairId: string | null = null;
        st.forEach((r: { type: string; selectedCandidatePairId?: string }) => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId; });
        let pair: { localCandidateId?: string; remoteCandidateId?: string; currentRoundTripTime?: number } | null = null;
        st.forEach((r: { type: string; id: string; nominated?: boolean; state?: string }) => {
          if (r.type === 'candidate-pair' && ((pairId && r.id === pairId) || (!pairId && r.state === 'succeeded'))) pair = r as never;
        });
        const p = pair as { localCandidateId?: string; remoteCandidateId?: string; currentRoundTripTime?: number } | null;
        const typeOf = (id?: string): string => { let t = '?'; st.forEach((r: { id: string; candidateType?: string }) => { if (r.id === id) t = r.candidateType ?? '?'; }); return t; };
        out[l.peer] = { local: typeOf(p?.localCandidateId), remote: typeOf(p?.remoteCandidateId), rttMs: typeof p?.currentRoundTripTime === 'number' ? Math.round(p.currentRoundTripTime * 1000) : null };
      } catch { /* closed */ }
    }
    return out;
  }

  drop(peer: string): void {
    const l = this.links.get(peer);
    if (!l) return;
    this.links.delete(peer);
    try { l.dcIn.close(); } catch { /* closed */ }
    try { l.dcCtl.close(); } catch { /* closed */ }
    try { l.pc.close(); } catch { /* closed */ }
  }

  close(): void {
    this.closed = true;
    if (this.gossip) { clearInterval(this.gossip); this.gossip = null; }
    for (const p of [...this.links.keys()]) this.drop(p);
  }
}

export function wrapFwd(to: string, from: string, payload: Uint8Array): Uint8Array {
  const t = TE.encode(to), f = TE.encode(from);
  const b = new Uint8Array(3 + t.length + f.length + payload.length);
  b[0] = FWD; b[1] = t.length; b.set(t, 2);
  b[2 + t.length] = f.length; b.set(f, 3 + t.length);
  b.set(payload, 3 + t.length + f.length);
  return b;
}
export function unwrapFwd(b: Uint8Array): { to: string; from: string; payload: Uint8Array } | null {
  if (b.length < 4 || b[0] !== FWD) return null;
  const tl = b[1];
  if (2 + tl >= b.length) return null;
  const fl = b[2 + tl];
  const off = 3 + tl + fl;
  if (off > b.length) return null;
  return { to: TD.decode(b.subarray(2, 2 + tl)), from: TD.decode(b.subarray(3 + tl, 3 + tl + fl)), payload: b.subarray(off) };
}
