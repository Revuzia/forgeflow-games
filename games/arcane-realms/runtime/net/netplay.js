// Arcane Realms — online play transport: Supabase Realtime Broadcast + Presence.
// Pure WebSocket relay (no Postgres, free tier). A ROOM is channel
// `arc:<code>`; QUICK MATCH pairs the two lowest peer ids in `arc-lobby`.
// The anon key is public-by-design (client credential, RLS enforced server-side).
// Same proven architecture as the other ForgeFlow online games; implemented
// fresh for Arcane Realms with a turn-lockstep protocol on top (see online.js).

const SUPABASE_URL = 'https://wugoxdewcdxzfppgzohy.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves';
const GAME_ID = 'arcane-realms';

export class NetPlay {
  constructor() {
    this._rand = Math.floor(Math.random() * 1e9).toString(36);
    this.id = Date.now().toString(36) + '_' + this._rand;
    this.handlers = {};
    this.sb = null; this.channel = null; this.lobby = null;
    this.host = null; this.room = null; this.peerPresent = false;
  }
  on(type, cb) { (this.handlers[type] = this.handlers[type] || []).push(cb); return this; }
  _emit(type, payload) { (this.handlers[type] || []).forEach((cb) => { try { cb(payload || {}); } catch { /* handler error */ } }); }

  async connect() {
    if (this.sb) return this.sb;
    const mod = await import('https://esm.sh/@supabase/supabase-js@2');
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { realtime: { params: { eventsPerSecond: 12 } } });
    return this.sb;
  }

  async joinRoom(code, asHost) {
    await this.connect();
    this.room = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (asHost != null) this.host = !!asHost;
    const ch = this.sb.channel('arc:' + GAME_ID + ':' + this.room, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.id } },
    });
    this.channel = ch;
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => {
      if (!payload || payload.from === this.id) return;
      this._emit('msg', { from: payload.from, t: payload.t, d: payload.d });
    });
    ch.on('presence', { event: 'sync' }, () => {
      const ids = Object.keys(ch.presenceState());
      const present = ids.length >= 2;
      if (present && this.host == null) this.host = this.id === ids.slice().sort()[0];
      if (present !== this.peerPresent) {
        this.peerPresent = present;
        this._emit('peer', { present, count: ids.length });
      }
    });
    await new Promise((res) => {
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ id: this.id });
          this._emit('open', { room: this.room, host: this.host });
          res();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this._emit('error', { status });
          res();
        }
      });
    });
    return this.room;
  }

  async quickMatch(timeoutMs = 90000) {
    await this.connect();
    const lobby = this.sb.channel('arc-lobby:' + GAME_ID, { config: { presence: { key: this.id } } });
    this.lobby = lobby;
    return new Promise((resolve) => {
      let done = false;
      const tryPair = async () => {
        if (done) return;
        const ids = Object.keys(lobby.presenceState()).sort();
        if (ids.length >= 2) {
          const a = ids[0], b = ids[1];
          if (this.id === a || this.id === b) {
            done = true;
            const code = (a.slice(-4) + b.slice(-4)).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
            this.host = this.id === a;
            // Join the derived room FIRST, but stay tracked in the lobby a few
            // seconds. The old code untracked immediately, so the peer who joined
            // the lobby first would read a live presenceState() that no longer
            // contained us and would never pair — orphaning both sides. Lingering
            // guarantees BOTH players observe the same two-peer snapshot.
            await this.joinRoom(code, this.host);
            this._emit('matched', { room: code, host: this.host });
            resolve({ room: code, host: this.host });
            setTimeout(() => {
              try { lobby.untrack(); this.sb.removeChannel(lobby); } catch { /* closed */ }
              if (this.lobby === lobby) this.lobby = null;
            }, 4000);
          }
        }
      };
      lobby.on('presence', { event: 'sync' }, tryPair);
      lobby.on('presence', { event: 'join' }, tryPair); // fire on arrival, not just full re-sync
      lobby.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') { await lobby.track({ id: this.id }); tryPair(); }
      });
      if (timeoutMs) setTimeout(() => {
        if (!done) {
          done = true;
          try { this.sb.removeChannel(lobby); } catch { /* closed */ }
          this.lobby = null;
          this._emit('timeout', {});
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  send(type, data) {
    if (!this.channel) return false;
    this.channel.send({ type: 'broadcast', event: 'msg', payload: { from: this.id, t: type, d: data || {} } });
    return true;
  }
  isHost() { return !!this.host; }
  leave() {
    try { if (this.channel) this.sb.removeChannel(this.channel); } catch { /* closed */ }
    try { if (this.lobby) this.sb.removeChannel(this.lobby); } catch { /* closed */ }
    this.channel = this.lobby = null;
    this.peerPresent = false;
  }
}
