/**
 * CHROMA HIDE — runtime/net/chromanet.js  (browser)
 * Host-authoritative online session over the shared NetPlay relay (Supabase
 * Realtime, $0), modeled on Last Circle's royale/net.js. The HOST runs the
 * authoritative match_sim and broadcasts snapshots (~10 Hz) + events; guests send
 * their input, render from snapshots, and stream their own paint strokes (which
 * the host relays). Catches are host-validated. Join = take over a slot; empty
 * slots are host-simulated bots so a lobby always feels full.
 *
 * Pure wire (de)serialization lives in sim/net_protocol.js and is unit-tested;
 * this file is transport glue + event fan-out only.
 */
import { NetPlay } from "./ffg_netplay.js";
import * as P from "../sim/net_protocol.js";

const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
// public anon key (public-by-design, same across every FFG game)
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomRoomCode() { let c = ""; for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]; return c; }

export class ChromaNet {
  constructor() {
    this.net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, "chroma-hide");
    this.handlers = {};
    this.started = false;
    this.pendingInput = new Map(); // peerId -> latest input (host consumes)
    this.net
      .on("open", (d) => { this._refresh(); this._emit("open", d); })
      .on("matched", (d) => { this._refresh(); this._emit("open", d); })
      .on("peer", (d) => { this._refresh(); this._emit("peer", d); })
      .on("msg", (m) => this._onMsg(m))
      .on("timeout", () => this._emit("timeout", {}))
      .on("error", (e) => this._emit("error", e));
  }
  on(evt, cb) { (this.handlers[evt] = this.handlers[evt] || []).push(cb); return this; }
  _emit(evt, p) { (this.handlers[evt] || []).forEach((cb) => { try { cb(p || {}); } catch (e) { console.error("[chromanet]", e); } }); }

  isHost() { return this.net.isHost(); }
  myId() { return this.net.id; }
  peerIds() { try { return Object.keys(this.net.channel.presenceState()); } catch (e) { return [this.myId()]; } }
  _refresh() { this._peers = this.peerIds(); }

  // ── connection ──────────────────────────────────────────────────────────────
  async hostRoom() { await this.net.connect(); const code = randomRoomCode(); await this.net.joinRoom(code, true); return code; }
  async joinRoom(code) { await this.net.connect(); await this.net.joinRoom(String(code).toUpperCase(), false); return code; }
  async quickMatch(timeoutMs) { await this.net.connect(); return this.net.quickMatch(timeoutMs || 15000); }

  // ── lobby ─────────────────────────────────────────────────────────────────
  sendLobby(cfg) { this.net.send(P.MSG.LOBBY, cfg); }
  /** HOST: build the shared roster from present peers + fill bots, broadcast START. */
  startMatch(lobbySize, seekerCount, settings, mapId) {
    const peerIds = this.peerIds().sort();
    const seed = ((Date.now() & 0x7fffffff) ^ ((Math.random() * 1e9) | 0)) >>> 0;
    const roster = P.buildRoster(peerIds, lobbySize, seekerCount, seed, this.myId());
    const payload = { players: roster.players.map((p) => ({ id: p.id, isBot: p.isBot, role: p.role, name: p.name })), seed, settings, mapId, lobbySize, seekerCount };
    this.net.send(P.MSG.START, payload);
    this.started = true;
    return payload;
  }

  // ── in-match ────────────────────────────────────────────────────────────────
  sendInput(input) { this.net.send(P.MSG.INPUT, input); }               // guest -> host
  sendSnapshot(state) { this.net.send(P.MSG.SNAP, P.packSnapshot(state)); } // host -> all
  sendStrokes(actorId, strokes) { if (strokes && strokes.length) this.net.send(P.MSG.PAINT, { id: actorId, s: P.packStrokes(strokes) }); }
  sendShot() { this.net.send(P.MSG.SHOT, {}); }                          // guest seeker -> host
  sendEvent(ev) { this.net.send(P.MSG.EVENT, ev); }                     // host -> all
  takeInput(peerId) { const i = this.pendingInput.get(peerId); return i || null; }

  _onMsg(m) {
    const { from, t, d } = m;
    switch (t) {
      case P.MSG.LOBBY: this._emit("lobby", d); break;
      case P.MSG.START: this._emit("start", d); break;
      case P.MSG.INPUT: this.pendingInput.set(from, d); this._emit("input", { from, input: d }); break;
      case P.MSG.SNAP: this._emit("snapshot", P.unpackSnapshot(d)); break;
      case P.MSG.PAINT: this._emit("paint", { id: d.id, strokes: P.unpackStrokes(d.s || []) }); break;
      case P.MSG.SHOT: this._emit("shot", { from }); break;
      case P.MSG.EVENT: this._emit("event", d); break;
      case P.MSG.CHAT: this._emit("chat", { from, text: d.text }); break;
      default: break;
    }
  }

  leave() { try { this.net.leave(); } catch (e) {} }
}
