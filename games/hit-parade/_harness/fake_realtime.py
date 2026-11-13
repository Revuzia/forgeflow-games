"""HIT PARADE - _harness/fake_realtime.py (CHANGED(wf8 gates), harness only - never shipped).

A LOCAL stand-in for the Supabase realtime service, used ONLY by `online2.py --game --fake-realtime` when the real service
is down (2026-10-12: Supabase incident "Realtime latency" - lobby phx_join replies 8-20 s late, after supabase-js's 10 s
join timeout, so no quick match could pair). Everything else stays real: the two Chrome processes, the real game, the
online flow (HELLO, commit-reveal select, READY), WebRTC DataChannels between the two Chromes, the rollback session and
its u32 INPUT packets, the RESULT agreement. Only the lobby / room channels (presence + broadcast) go through this relay
instead of wss://<project>.supabase.co, so a run with it does NOT test Supabase itself - the report says so.

Pieces:
  FakeRealtime(port).start() - an asyncio `websockets` server on 127.0.0.1:<port> in a daemon thread. Topics hold members
      (one per page channel object) and presence entries {key: meta}; `track` / `untrack` / `leave` / a closed socket
      re-broadcast the topic's presence state to every member; `send` forwards a broadcast to every OTHER member
      (supabase `broadcast.self: false`).
  shim_js(port) - an ES module that replaces https://esm.sh/@supabase/supabase-js@<v> (served by a Playwright route):
      createClient() -> { channel(name, opts), removeChannel(ch), auth.getUser() (no user), rpc() (error) } with the slice
      of RealtimeChannel that net/netplay.ts uses (on / subscribe / track / untrack / send / presenceState).
"""
from __future__ import annotations

import asyncio
import json
import threading


class FakeRealtime:
    def __init__(self, port: int):
        self.port = port
        self.topics: dict = {}
        self.stats = {"conns": 0, "joins": 0, "tracks": 0, "sends": 0, "topics": set()}
        self._loop = None
        self._ready = threading.Event()
        self._stop = None
        self.error = None

    # ---- server side
    async def _tx(self, ws, m):
        try:
            await ws.send(json.dumps(m))
        except Exception:
            pass

    def _state(self, t):
        return {k: [v[2]] for k, v in t["presence"].items()}

    async def _bcast_state(self, topic, joins=(), leaves=()):
        t = self.topics.get(topic)
        if not t:
            return
        st = self._state(t)
        for (ws, cid) in list(t["members"].keys()):
            await self._tx(ws, {"op": "state", "cid": cid, "state": st, "joins": list(joins), "leaves": list(leaves)})

    async def _drop(self, ws, cid=None):
        for topic, t in list(self.topics.items()):
            gone = [k for k, v in t["presence"].items() if v[0] is ws and (cid is None or v[1] == cid)]
            for k in gone:
                del t["presence"][k]
            for mk in [mk for mk in t["members"] if mk[0] is ws and (cid is None or mk[1] == cid)]:
                del t["members"][mk]
            if gone:
                await self._bcast_state(topic, leaves=gone)

    async def _handler(self, ws):
        self.stats["conns"] += 1
        try:
            async for raw in ws:
                try:
                    m = json.loads(raw)
                except Exception:
                    continue
                op, topic, cid = m.get("op"), m.get("topic"), m.get("cid")
                t = self.topics.setdefault(topic, {"members": {}, "presence": {}})
                if op == "join":
                    self.stats["joins"] += 1
                    self.stats["topics"].add(topic.split(":")[0] if topic else "")
                    t["members"][(ws, cid)] = m.get("key")
                    await self._tx(ws, {"op": "joined", "cid": cid})
                    await self._tx(ws, {"op": "state", "cid": cid, "state": self._state(t), "joins": [], "leaves": []})
                elif op == "track":
                    self.stats["tracks"] += 1
                    key = m.get("key")
                    t["presence"][key] = (ws, cid, m.get("meta") or {})
                    await self._bcast_state(topic, joins=[key])
                elif op == "untrack":
                    key = m.get("key")
                    v = t["presence"].get(key)
                    if v and v[0] is ws and v[1] == cid:
                        del t["presence"][key]
                        await self._bcast_state(topic, leaves=[key])
                elif op == "send":
                    self.stats["sends"] += 1
                    for (w, c) in list(t["members"].keys()):
                        if not (w is ws and c == cid):
                            await self._tx(w, {"op": "bcast", "cid": c, "event": m.get("event"), "payload": m.get("payload")})
                elif op == "leave":
                    await self._drop(ws, cid)
        except Exception:
            pass
        finally:
            await self._drop(ws)

    def start(self):
        def run():
            loop = asyncio.new_event_loop()
            self._loop = loop
            asyncio.set_event_loop(loop)

            async def main():
                from websockets.asyncio.server import serve
                self._stop = loop.create_future()
                async with serve(self._handler, "127.0.0.1", self.port, max_size=2 ** 22):
                    self._ready.set()
                    await self._stop
            try:
                loop.run_until_complete(main())
            except Exception as e:      # port taken, websockets missing ...
                self.error = repr(e)
                self._ready.set()
        threading.Thread(target=run, daemon=True).start()
        self._ready.wait(15)
        if self.error:
            raise RuntimeError("fake realtime did not start: %s" % self.error)
        return self

    def stop(self):
        if self._loop and self._stop and not self._stop.done():
            self._loop.call_soon_threadsafe(self._stop.set_result, True)

    def summary(self):
        return {"port": self.port, "conns": self.stats["conns"], "joins": self.stats["joins"], "tracks": self.stats["tracks"],
                "sends": self.stats["sends"], "topicKinds": sorted(self.stats["topics"])}


SHIM = r"""// CHANGED(wf8 gates): LOCAL stand-in for supabase-js (harness only, online2.py --fake-realtime). NOT the real service.
const WS_URL = 'ws://127.0.0.1:__PORT__';
let sockP = null;
let seq = 0;
const chans = new Map();
function conn() {
  if (sockP) return sockP;
  sockP = new Promise((res, rej) => {
    const s = new WebSocket(WS_URL);
    s.onopen = () => res(s);
    s.onerror = (e) => { sockP = null; rej(e); };
    s.onclose = () => { sockP = null; };
    s.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } const ch = chans.get(m.cid); if (ch) ch._in(m); };
  });
  return sockP;
}
class Ch {
  constructor(name, opts) {
    this.name = name;
    this.cid = name + '#' + (++seq) + '.' + Math.random().toString(36).slice(2, 8);
    const pk = opts && opts.config && opts.config.presence && opts.config.presence.key;
    this.key = pk || ('anon-' + this.cid);
    this.h = [];
    this.state = {};
    this.subcb = null;
    chans.set(this.cid, this);
  }
  on(type, filter, cb) { this.h.push({ type, ev: filter && filter.event, cb }); return this; }
  _fire(type, ev, p) { for (const x of this.h) if (x.type === type && (x.ev === ev || x.ev === '*')) { try { x.cb(p); } catch (e) { console.warn('fake realtime handler', e); } } }
  _in(m) {
    if (m.op === 'joined') { if (this.subcb) this.subcb('SUBSCRIBED'); return; }
    if (m.op === 'state') {
      this.state = m.state || {};
      for (const k of m.joins || []) this._fire('presence', 'join', { key: k, newPresences: this.state[k] || [], currentPresences: [] });
      for (const k of m.leaves || []) this._fire('presence', 'leave', { key: k, leftPresences: [], currentPresences: [] });
      this._fire('presence', 'sync', {});
      return;
    }
    if (m.op === 'bcast') this._fire('broadcast', m.event, { type: 'broadcast', event: m.event, payload: m.payload });
  }
  _tx(o) { return conn().then((s) => { s.send(JSON.stringify(Object.assign({ topic: this.name, cid: this.cid }, o))); return 'ok'; }); }
  subscribe(cb) { this.subcb = cb || null; this._tx({ op: 'join', key: this.key }).catch((e) => { if (cb) cb('CHANNEL_ERROR', e); }); return this; }
  track(meta) { return this._tx({ op: 'track', key: this.key, meta: meta || {} }); }
  untrack() { return this._tx({ op: 'untrack', key: this.key }); }
  send(msg) {
    let payload = msg && msg.payload;
    if (payload instanceof ArrayBuffer) {   // raw binary (relay tier) -> the {b64} form netplay.ts onBinaryPayload also reads
      let s = ''; const u = new Uint8Array(payload); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      payload = { b64: btoa(s) };
    }
    return this._tx({ op: 'send', event: msg && msg.event, payload });
  }
  presenceState() { return this.state; }
  unsubscribe() { const p = this._tx({ op: 'leave' }); chans.delete(this.cid); return p; }
}
export function createClient() {
  return {
    channel: (name, opts) => new Ch(name, opts),
    removeChannel: (ch) => (ch && ch.unsubscribe ? ch.unsubscribe() : Promise.resolve('ok')),
    removeAllChannels: () => Promise.resolve([]),
    auth: { getUser: async () => ({ data: { user: null }, error: null }), getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    rpc: async () => ({ data: null, error: { message: 'fake realtime: no rpc' } }),
  };
}
export default { createClient };
"""


def shim_js(port: int) -> str:
    return SHIM.replace("__PORT__", str(int(port)))
