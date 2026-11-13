"""HIT PARADE - netcode lane: WebRTC facts measurable from THIS machine (headless Playwright Chromium).

1. STUN gathering: one RTCPeerConnection per STUN server, time to first host / first srflx candidate.
2. NAT mapping behaviour: ONE RTCPeerConnection with several STUN servers. For each local base
   port (candidate.relatedPort) compare the public mapped port each STUN server reports.
   Same mapped port for every server  -> endpoint-independent mapping (P2P friendly).
   Different ports                    -> endpoint-dependent ("symmetric") mapping (needs TURN
                                          when the other side is also restrictive).
   The public IP is never written anywhere (privacy); only ports and booleans are kept.
3. Loopback DataChannel: two peers in one page, {ordered:false, maxRetransmits:0}; time from
   createOffer to channel open, then 200 pings at 60 Hz -> RTT of the browser WebRTC stack itself
   (no internet path; this is the floor the stack adds, not player-to-player latency).

Usage:  python tools/research/net_webrtc_probe.py
Output: _research/netcode/webrtc_probe_<stamp>.json
"""
import json
import os
import time
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

OUT_DIR = "C:/Users/TestRun/Claude Claw/forgeflow-games/games/hit-parade/_research/netcode"

STUNS = [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
    "stun:stun.cloudflare.com:3478",
]

JS = r"""
async (stuns) => {
  const now = () => performance.now();
  const out = { gathering: [], mapping: null, loopback: null };
  const parse = (c) => {
    // candidate:<foundation> <component> <proto> <prio> <addr> <port> typ <type> [raddr x rport y]
    const p = c.candidate.split(' ');
    const o = { proto: p[2], port: +p[5], type: p[7] };
    const ri = p.indexOf('rport'); if (ri > 0) o.rport = +p[ri + 1];
    o.addrKind = /\.local$/.test(p[4]) ? 'mdns' : (p[4].includes(':') ? 'ipv6' : 'ipv4');
    return o;
  };
  const gather = (iceServers, ms) => new Promise(async (resolve) => {
    const t0 = now(); const cands = []; let done = false;
    const pc = new RTCPeerConnection({ iceServers });
    pc.createDataChannel('g');
    const fin = () => { if (done) return; done = true; try { pc.close(); } catch (e) {} resolve({ ms: Math.round(now() - t0), cands }); };
    pc.onicecandidate = (e) => { if (!e.candidate) return fin(); if (!e.candidate.candidate) return; const o = parse(e.candidate); o.t = Math.round(now() - t0); o.url = e.candidate.url || null; cands.push(o); };
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') fin(); };
    await pc.setLocalDescription(await pc.createOffer());
    setTimeout(fin, ms);
  });
  for (const s of stuns) {
    const g = await gather([{ urls: s }], 6000);
    const host = g.cands.filter((c) => c.type === 'host'), srflx = g.cands.filter((c) => c.type === 'srflx');
    out.gathering.push({ stun: s, gather_ms: g.ms, host_n: host.length, srflx_n: srflx.length,
      first_host_ms: host.length ? Math.min(...host.map((c) => c.t)) : null,
      first_srflx_ms: srflx.length ? Math.min(...srflx.map((c) => c.t)) : null });
  }
  // mapping test: all STUN servers on one PC; compare mapped port per base port
  const g = await gather(stuns.map((u) => ({ urls: u })), 8000);
  const byBase = {};
  for (const c of g.cands.filter((c) => c.type === 'srflx' && c.proto === 'udp')) {
    (byBase[c.rport] = byBase[c.rport] || []).push({ url: c.url, port: c.port, addrKind: c.addrKind });
  }
  const groups = Object.entries(byBase).map(([rport, list]) => ({ base_port: +rport, n: list.length,
    mapped_ports: [...new Set(list.map((x) => x.port))], servers: [...new Set(list.map((x) => x.url))] }));
  out.mapping = { srflx_udp: g.cands.filter((c) => c.type === 'srflx' && c.proto === 'udp').length, groups,
    endpoint_independent: groups.length ? groups.every((x) => x.mapped_ports.length === 1) : null,
    groups_with_multiple_servers: groups.filter((x) => x.servers.length > 1).length };
  // loopback DataChannel
  const a = new RTCPeerConnection({ iceServers: [{ urls: stuns[0] }] });
  const b = new RTCPeerConnection({ iceServers: [{ urls: stuns[0] }] });
  a.onicecandidate = (e) => { if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {}); };
  b.onicecandidate = (e) => { if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {}); };
  const t0 = now();
  const dcA = a.createDataChannel('in', { ordered: false, maxRetransmits: 0 });
  dcA.binaryType = 'arraybuffer';
  const opened = new Promise((r) => { dcA.onopen = () => r(now() - t0); });
  b.ondatachannel = (e) => { const dcB = e.channel; dcB.binaryType = 'arraybuffer'; dcB.onmessage = (m) => dcB.send(m.data); };
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);
  const openMs = await Promise.race([opened, new Promise((r) => setTimeout(() => r(null), 10000))]);
  const rtts = []; const sentAt = new Map();
  const series = [];
  dcA.onmessage = (m) => { const s = new DataView(m.data).getUint16(0, true); const t = sentAt.get(s); if (t != null) { rtts.push(now() - t); series.push([s, Math.round((now() - t) * 10) / 10]); } };
  if (openMs != null) {
    await new Promise((r) => setTimeout(r, 1000)); // let the association settle before timing
    const start = now();
    for (let k = 0; k < 200; k++) {
      const due = start + k * 1000 / 60;
      while (now() < due) await new Promise((r) => setTimeout(r, 1));
      const buf = new ArrayBuffer(24); new DataView(buf).setUint16(0, k, true); sentAt.set(k, now()); dcA.send(buf);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const s = rtts.slice().sort((x, y) => x - y);
  const q = (p) => s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] * 100) / 100 : null;
  out.loopback = { open_ms: openMs == null ? null : Math.round(openMs), sent: 200, received: rtts.length,
    rtt_ms: { median: q(50), p90: q(90), p99: q(99), max: q(100) }, series };
  a.close(); b.close();
  return out;
}
"""


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("about:blank")
        t0 = time.time()
        res = page.evaluate(JS, STUNS)
        res["wall_s"] = round(time.time() - t0, 1)
        res["browser"] = browser.version
        browser.close()
    res["started"] = started
    res["tool"] = "hit-parade/tools/research/net_webrtc_probe.py"
    stamp = started.replace(":", "-").replace(".", "-")
    path = OUT_DIR + "/webrtc_probe_" + stamp + ".json"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(res, fh, indent=2)
    print(json.dumps(res, indent=2))
    print("wrote", path)


if __name__ == "__main__":
    main()
