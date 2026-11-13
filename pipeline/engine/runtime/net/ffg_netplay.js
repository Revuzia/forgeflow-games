/**
 * FFG runtime — net/ffg_netplay.js
 * Turn-based online multiplayer over SUPABASE REALTIME (Broadcast + Presence).
 *
 * WHY this transport: Broadcast/Presence are a pure WebSocket relay — they NEVER
 * touch Postgres, so there are no database fees; they run on Supabase's free
 * Realtime quota (200 concurrent conns, 2M msgs/mo). Turn-based games send only a
 * few small discrete messages, so this is $0 and plenty fast. supabase-js is
 * lazy-loaded (dynamic import) only when a player actually chooses online play, so
 * the single-player bundle stays lean.
 *
 * Model: a ROOM is a Realtime channel `ffg:<gameId>:<code>`. Two players join it;
 * Presence tells each side when the other is connected/gone; Broadcast carries the
 * game messages (ready, fire, result, …). QUICK MATCH uses a shared lobby channel
 * `ffg-lobby:<gameId>` where waiting players announce via Presence and the two
 * lowest peer-ids pair into a deterministic room (lower id = host, moves first).
 *
 * Game-agnostic: Iron Tide and the new naval game both use it. Usage:
 *   const net = new NetPlay(URL, ANON, "iron-tide");
 *   net.on("open", ({host}) => ...).on("peer", ({present}) => ...).on("msg", ({t,d}) => ...);
 *   await net.connect(); await net.quickMatch();   // or net.joinRoom("ABCD", true/false)
 *   net.send("fire", {x,y});
 */

export class NetPlay {
  constructor(url, anonKey, gameId) {
    this.url = url; this.anonKey = anonKey; this.gameId = gameId || "ffg";
    // peer id: sortable, unique. Lower id is the deterministic host (first move).
    this._rand = Math.floor(Math.random() * 1e9).toString(36);
    this.id = Date.now().toString(36) + "_" + this._rand;
    this.handlers = {};
    this.sb = null; this.channel = null; this.lobby = null;
    this.host = null; this.room = null; this.peerPresent = false; this._paired = false;
  }
  on(type, cb) { (this.handlers[type] = this.handlers[type] || []).push(cb); return this; }
  _emit(type, payload) { (this.handlers[type] || []).forEach((cb) => { try { cb(payload || {}); } catch (e) {} }); }

  // Lazy-load supabase-js + create the client. Safe to call once.
  async connect() {
    if (this.sb) return this.sb;
    const mod = await import("https://esm.sh/@supabase/supabase-js@2");
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    this.sb = createClient(this.url, this.anonKey, { realtime: { params: { eventsPerSecond: 12 } } });
    return this.sb;
  }

  // Join a specific ROOM channel (private play-with-a-friend via a shared code).
  // asHost decides first move when known; for quick-match the lower id is host.
  async joinRoom(code, asHost) {
    await this.connect();
    this.room = String(code).toUpperCase();
    if (asHost != null) this.host = !!asHost;
    const ch = this.sb.channel("ffg:" + this.gameId + ":" + this.room, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.id } },
    });
    this.channel = ch;
    ch.on("broadcast", { event: "msg" }, ({ payload }) => {
      if (!payload || payload.from === this.id) return;
      this._emit("msg", { from: payload.from, t: payload.t, d: payload.d });
    });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState(); const ids = Object.keys(state);
      const present = ids.length >= 2;
      if (present && this.host == null) this.host = this.id === ids.slice().sort()[0]; // deterministic
      if (present !== this.peerPresent) { this.peerPresent = present; this._emit("peer", { present: present, count: ids.length }); }
    });
    await new Promise((res) => {
      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") { await ch.track({ id: this.id, at: this.id }); this._emit("open", { room: this.room, host: this.host }); res(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { this._emit("error", { status: status }); res(); }
      });
    });
    return this.room;
  }

  // QUICK MATCH: announce in the lobby; the two lowest peer-ids pair into a room
  // named from their ids. Deterministic + symmetric so both compute the same room.
  async quickMatch(timeoutMs) {
    await this.connect();
    const lobby = this.sb.channel("ffg-lobby:" + this.gameId, { config: { presence: { key: this.id } } });
    this.lobby = lobby;
    return new Promise((resolve) => {
      let done = false;
      const tryPair = async () => {
        if (done) return;
        const ids = Object.keys(lobby.presenceState()).sort();
        if (ids.length >= 2) {
          const a = ids[0], b = ids[1]; // the two lowest pair up
          if (this.id === a || this.id === b) {
            done = true;
            const code = (a.slice(-4) + b.slice(-4)).toUpperCase();
            this.host = this.id === a;
            try { await lobby.untrack(); this.sb.removeChannel(lobby); } catch (e) {}
            this.lobby = null;
            await this.joinRoom(code, this.host);
            this._emit("matched", { room: code, host: this.host });
            resolve({ room: code, host: this.host });
          }
        }
      };
      lobby.on("presence", { event: "sync" }, tryPair);
      lobby.subscribe(async (status) => { if (status === "SUBSCRIBED") { await lobby.track({ id: this.id }); tryPair(); } });
      if (timeoutMs) setTimeout(() => { if (!done) { done = true; try { this.sb.removeChannel(lobby); } catch (e) {} this._emit("timeout", {}); resolve(null); } }, timeoutMs);
    });
  }

  // Broadcast a game message to the opponent.
  send(type, data) {
    if (!this.channel) return false;
    this.channel.send({ type: "broadcast", event: "msg", payload: { from: this.id, t: type, d: data || {} } });
    return true;
  }
  isHost() { return !!this.host; }
  leave() {
    try { if (this.channel) this.sb.removeChannel(this.channel); } catch (e) {}
    try { if (this.lobby) this.sb.removeChannel(this.lobby); } catch (e) {}
    this.channel = this.lobby = null; this.peerPresent = false;
  }
}

/**
 * TurnClock — a per-turn countdown so online play can't stall. Default 15s.
 * onTick(secondsLeft) updates the UI; onExpire() fires once at 0 (the game then
 * auto-passes/forfeits the turn). Game-agnostic + reusable across Iron Tide and
 * the new naval/chess games. `_step()` is exposed so the countdown is unit-testable
 * without waiting on the wall clock.
 */
export class TurnClock {
  constructor(seconds) { this.total = seconds != null ? seconds : 15; this.left = this.total; this._iv = null; this.onTick = null; this.onExpire = null; }
  start(onTick, onExpire) {
    this.stop(); this.left = this.total; this.onTick = onTick || null; this.onExpire = onExpire || null;
    if (this.onTick) this.onTick(this.left);
    this._iv = setInterval(() => this._step(), 1000);
    return this;
  }
  _step() {
    this.left -= 1;
    if (this.onTick) this.onTick(Math.max(0, this.left));
    if (this.left <= 0) { this.stop(); if (this.onExpire) this.onExpire(); }
  }
  running() { return !!this._iv; }
  stop() { if (this._iv) { clearInterval(this._iv); this._iv = null; } }
}
