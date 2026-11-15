/**
 * ffg_rtc.js — P2P DataChannel overlay for the high-rate state envelope.
 *
 * WHY: the envelope merge fits Supabase's 100 msg/s ceiling (80 worst-case at
 * 4 humans), but the 2M msgs/month project quota still caps the portfolio at
 * ~20 full-room matches a month. Moving ONLY the state envelope to unreliable
 * P2P DataChannels removes ceiling and quota for ~95% of traffic and drops a
 * relay hop of latency. Everything else — signaling, hitYou/died/start/bye/
 * takeover/sync/chat, and the complete fallback path — STAYS on Supabase, so
 * any RTC failure is byte-identical to the pre-RTC behaviour.
 *
 * Topology: full mesh, at most 3 connections per client (4-human rooms).
 * Signaling rides the existing room channel via the caller-provided signal()
 * (net.js sends {t:"rtc", d:{to, kind, ...}}). Deterministic offerer — the
 * LEXICALLY LOWER peer id creates the offer per pair — so no glare. Google
 * STUN only, no TURN: a NAT-blocked pair simply never opens and that peer
 * keeps riding Supabase.
 *
 * The data channel is UNRELIABLE ({ordered:false, maxRetransmits:0}) on
 * purpose: the state envelope is a snapshot stream — a lost packet is
 * superseded by the next one 83-200 ms later, and retransmitting stale state
 * is worse than dropping it.
 */
export class RTCMesh {
  constructor(myId, signal) {
    this.id = myId;
    this.signal = signal;           // (toPeerId, {kind, sdp?|cand?}) => void
    this.peers = new Map();         // peerId -> {pc, dc, open}
    this.onMessage = null;          // ({from, t, d}) — parsed DC payloads
  }

  _wireChannel(p, dc) {
    p.dc = dc;
    dc.onopen = () => { p.open = true; };
    dc.onclose = () => { p.open = false; };
    dc.onerror = () => { p.open = false; };
    dc.onmessage = (e) => {
      if (!this.onMessage) return;
      try { this.onMessage(JSON.parse(e.data)); } catch (err) { /* malformed — drop */ }
    };
  }

  ensurePeer(peerId) {
    if (peerId === this.id) return null;
    let p = this.peers.get(peerId);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    p = { pc, dc: null, open: false };
    this.peers.set(peerId, p);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal(peerId, { kind: "ice", cand: e.candidate.toJSON() }); };
    if (String(this.id) < String(peerId)) {
      // we are the offerer for this pair
      this._wireChannel(p, pc.createDataChannel("state", { ordered: false, maxRetransmits: 0 }));
      pc.createOffer().then((offer) => pc.setLocalDescription(offer))
        .then(() => this.signal(peerId, { kind: "offer", sdp: pc.localDescription.toJSON() }))
        .catch(() => { /* stay on the Supabase path */ });
    } else {
      pc.ondatachannel = (e) => this._wireChannel(p, e.channel);
    }
    return p;
  }

  async handleSignal(from, d) {
    const p = this.ensurePeer(from);
    if (!p) return;
    try {
      if (d.kind === "offer") {
        await p.pc.setRemoteDescription(d.sdp);
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        this.signal(from, { kind: "answer", sdp: p.pc.localDescription.toJSON() });
      } else if (d.kind === "answer") {
        await p.pc.setRemoteDescription(d.sdp);
      } else if (d.kind === "ice" && d.cand) {
        await p.pc.addIceCandidate(d.cand);
      }
    } catch (e) { /* negotiation hiccup — that pair stays on Supabase */ }
  }

  /** Send the envelope to every open channel. Returns {sent, allCovered}:
   *  allCovered is true only when EVERY known peer got it P2P — the caller
   *  broadcasts once via Supabase otherwise (receivers dedupe by design: a
   *  peer with an open DC that also sees the broadcast just applies the same
   *  snapshot twice, which a snapshot protocol tolerates). */
  sendState(msg) {
    let sent = 0, missing = false;
    const s = JSON.stringify(msg);
    for (const p of this.peers.values()) {
      if (p.open && p.dc && p.dc.readyState === "open") {
        try { p.dc.send(s); sent++; } catch (e) { p.open = false; missing = true; }
      } else missing = true;
    }
    return { sent, allCovered: !missing && this.peers.size > 0 };
  }

  openCount() { let n = 0; for (const p of this.peers.values()) if (p.open) n++; return n; }

  removePeer(peerId) {
    const p = this.peers.get(peerId);
    if (!p) return;
    try { if (p.dc) p.dc.close(); } catch (e) {}
    try { p.pc.close(); } catch (e) {}
    this.peers.delete(peerId);
  }

  close() { for (const id of [...this.peers.keys()]) this.removePeer(id); }
}
