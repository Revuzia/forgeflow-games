/**
 * ffg_cfroom.js — Last Circle's friends-room transport over the Cloudflare relay
 * (workers/last-circle-net: Worker + one Durable Object room per 4-character code).
 *
 * WHY: royale/net.js used to ride a shared free Supabase Realtime project (ffg_netplay.js), whose
 * 2M messages/month and 100 msg/s ceiling were shared by every ForgeFlow game — about a dozen full
 * matches a month for this game — and which DROPS the connection when exceeded. The relay here is
 * ours, on the same Cloudflare account as the games CDN and DYEFIELD's relay, with its own daily meter.
 *
 * Same surface royale/net.js used on NetPlay, so the game code barely changed:
 *   const net = new RoomNet(baseUrl);            // net.id is this browser's peer id
 *   net.on("open"|"peer"|"msg"|"error"|"lost", cb)
 *   await net.connect();                         // reachability probe (GET /health)
 *   await net.createRoom();  // or net.joinRoom("ABCD") — both resolve to the code, reject with err.code
 *   net.send(type, data);  net.isHost();  net.leave();
 * Wire: client -> {t, d, to?}; relay -> {from, t, d} | {k:"welcome"|"presence"|"err", ...}. "ping" every 25 s
 * (answered by the relay without waking the room). If the socket drops mid-room it rejoins with the same peer
 * id (3 tries); the relay hands the same seat back.
 *
 * Error codes (err.code): 4004 no such room, 4009 room full, 4029 online play full for today,
 * "unreachable" (no answer from the relay).
 */

export const PROD_NET_URL = "https://last-circle-net.isimcha85.workers.dev";

/** Production relay, or the local `wrangler dev` (port 8791) when the game itself is served from this machine.
 *  `?net=` may point at another LOCAL relay only — an invite link must never be able to send players elsewhere. */
export function netBaseUrl() {
  const local = (h) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  try {
    const q = new URLSearchParams(location.search).get("net");
    if (q) { const u = new URL(q); if (local(u.hostname) && /^https?:$/.test(u.protocol)) return u.origin; }
  } catch (e) { /* ignore a malformed override */ }
  try { if (local(location.hostname)) return "http://127.0.0.1:8791"; } catch (e) {}
  return PROD_NET_URL;
}

export class RoomNet {
  constructor(baseUrl) {
    this.base = String(baseUrl || netBaseUrl()).replace(/\/$/, "");
    this.id = Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e9).toString(36);
    this.handlers = {};
    this.ws = null; this.room = null; this.host = null; this.owner = null;
    this.peerCount = 0; this.peerPresent = false; this.ids = [];
    this._left = false; this._ping = null; this._retries = 0;
  }
  on(type, cb) { (this.handlers[type] = this.handlers[type] || []).push(cb); return this; }
  _emit(type, payload) { (this.handlers[type] || []).forEach((cb) => { try { cb(payload || {}); } catch (e) {} }); }

  async connect() {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const to = setTimeout(() => ctl && ctl.abort(), 12000);
    try {
      const r = await fetch(this.base + "/health", { cache: "no-store", signal: ctl ? ctl.signal : undefined });
      if (!r.ok) throw new Error("relay answered " + r.status);
      this.health = await r.json();
    } catch (e) {
      const err = new Error("no answer from the online service"); err.code = "unreachable"; err.cause = e; throw err;
    } finally { clearTimeout(to); }
    return this.health;
  }

  createRoom() { return this._open("/room/new", true); }
  joinRoom(code) { return this._open("/room/" + encodeURIComponent(String(code).trim().toUpperCase()), false); }

  _open(path, creating) {
    this._left = false;
    const url = this.base.replace(/^http/, "ws") + path + "?id=" + encodeURIComponent(this.id);
    return new Promise((resolve, reject) => {
      let settled = false, errCode = null;
      let ws;
      try { ws = new WebSocket(url); } catch (e) { const err = new Error("could not open the connection"); err.code = "unreachable"; reject(err); return; }
      this.ws = ws;
      const fail = (code) => {
        if (settled) return; settled = true;
        const err = new Error(code === 4004 ? "no such room" : code === 4009 ? "room full" : code === 4029 ? "online full today" : "no answer from the online service");
        err.code = code === 4004 || code === 4009 || code === 4029 ? code : "unreachable";
        reject(err);
      };
      const timer = setTimeout(() => { fail("unreachable"); try { ws.close(); } catch (e) {} }, 15000);
      ws.onmessage = (ev) => {
        if (ev.data === "pong") return;
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.k === "err") { errCode = m.code; return; }
        if (m.k === "welcome") {
          clearTimeout(timer);
          this.room = m.room; this._setOwner(m.owner);
          this._presence(m.ids || []);
          this._retries = 0;
          clearInterval(this._ping);
          this._ping = setInterval(() => { try { if (ws.readyState === 1) ws.send("ping"); } catch (e) {} }, 25000);
          if (!settled) { settled = true; this._emit("open", { room: this.room, host: this.host }); resolve(this.room); }
          else this._emit("rejoined", { room: this.room });
          return;
        }
        if (m.k === "presence") { if (m.owner) this._setOwner(m.owner); this._presence(m.ids || []); return; }
        if (m.from && m.t) this._emit("msg", { from: m.from, t: m.t, d: m.d });
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        if (this.ws !== ws) return;           // superseded by a rejoin
        clearInterval(this._ping);
        if (!settled) { fail(errCode || ev.code); return; }
        if (this._left || ev.code === 4001) return;   // we left, or the same id reconnected elsewhere
        // dropped mid-room: rejoin the same room with the same id (the relay gives the seat back)
        if (this.room && this._retries < 3) {
          const wait = 600 * Math.pow(2, this._retries++);
          this._emit("lost", { retrying: true });
          setTimeout(() => { if (!this._left && this.ws === ws) this._open("/room/" + this.room, false).catch(() => this._emit("lost", { retrying: false })); }, wait);
        } else this._emit("lost", { retrying: false });
      };
      ws.onerror = () => { /* onclose follows */ };
    });
  }

  /** The relay hands the room to the longest-present player when its host leaves. During a match the
   *  host role is FROZEN (royale/net.js sets `frozen`): host = authority over the opponents, and that must
   *  not flip under a running match — a lost host is handled there (hostLost). Unfreezing re-reads it. */
  _setOwner(owner) {
    const changed = owner !== this.owner;
    this.owner = owner;
    if (!this.frozen) this.host = owner === this.id;
    if (changed) this._emit("owner", { owner, host: this.host });
  }
  setFrozen(on) { this.frozen = !!on; if (!on) this.host = this.owner === this.id; }

  _presence(ids) {
    this.ids = ids.slice();
    const present = ids.length >= 2;
    if (present !== this.peerPresent || ids.length !== this.peerCount) {
      this.peerPresent = present; this.peerCount = ids.length;
      this._emit("peer", { present, count: ids.length, ids: ids.slice() });
    }
  }

  send(type, data) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    const msg = { t: type, d: data || {} };
    // P2P signaling (royale/net.js sends {to, ...}) goes to the addressee only
    if (type === "rtc" && data && typeof data.to === "string") msg.to = data.to;
    try { ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
  }
  isHost() { return !!this.host; }
  leave() {
    this._left = true;
    clearInterval(this._ping);
    try { if (this.ws) this.ws.close(1000, "leave"); } catch (e) {}
    this.ws = null; this.peerPresent = false;
  }
}
