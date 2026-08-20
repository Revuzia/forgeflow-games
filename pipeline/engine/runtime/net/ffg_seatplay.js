/**
 * FFG runtime — net/ffg_seatplay.js
 * N-SEAT (2–5) online turn machine over Supabase Realtime (NetPlay), for the board games.
 *
 * Generalizes ffg_online.js's 2-player strict-alternation to a seat-indexed roster where the
 * HOST owns AI seats and any seat whose human drops. Perfect-information LOCKSTEP: every client
 * runs the same deterministic sim from a shared seed; only the acting authority's move (+ any
 * randomness it materializes) crosses the wire; receivers apply it, never re-roll.
 *
 * Authority: the acting seat = its human, OR the HOST for AI/empty/dropped seats. Every state
 * mutation is funneled through localMoved(); receivers apply via iface.applyRemoteMove().
 *
 * Fixes baked in (from the design's adversarial review):
 *  - roster + drop-detection run off a 3s HELLO heartbeat — NetPlay's `peer` event only fires at
 *    the 1<->2 boundary, so it can't see 3/4/5-peer joins or mid-range (4→3) drops.
 *  - host START is gated on a stable roster (all expected humans seen) so no joiner gets mySeat=-1.
 *  - outbound moves are PACED through a micro-queue (≥90ms apart) so a synchronous multi-action AI
 *    turn can't burst past Supabase's eventsPerSecond=12 limiter.
 *  - per-seat monotonic `seq`; a gap makes the receiver request a host `sync` (authoritative backstop).
 *
 * iface (the game implements): { gameId, parent, title, turnSeconds,
 *   onLobbyOpen(), onLobbyBack(), startGame({seed,seats,mySeat,turnSeat}), onTurn({turnSeat,mySeat,acting}),
 *   applyRemoteMove(seat,payload,rng)->void|Promise, driveAiTurn(seat) [host-only], randomMove(seat),
 *   isOver()->bool, winnerSeat()->int|null, serializeState()->obj, loadState(obj), setStatus(o),
 *   end(result), onPeerDrop(seat), boardHash()->string, testPlayOne() }
 */

export const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
// ANON key is PUBLIC by design (Realtime Broadcast/Presence only — no tables).
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

const V = new URL(import.meta.url).search;                         // propagate cache-bust to sibling import
const { NetPlay, TurnClock } = await import("./ffg_netplay.js" + V);

const SEND_GAP_MS = 90;      // ≥ 1000/12 so a burst never trips the eps limiter
const HELLO_MS = 3000;       // heartbeat cadence
const DEAD_MS = 10000;       // no hello in 10s → peer considered gone
const AI_NAMES = ["Ashen", "Umbral", "Cinder", "Verdant"];

// ── DOM helpers (COPIED from ffg_online.js — those are module-private there; kept in sync by hand) ──
function el(tag, css, html) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
function btn(label, onClick, primary) {
  const b = el("button", "font:bold 15px 'Segoe UI',system-ui,monospace;padding:11px 26px;cursor:pointer;min-width:220px;letter-spacing:1px;border-radius:7px;transition:transform .08s,box-shadow .12s;margin:3px;" +
    (primary ? "color:#062018;background:linear-gradient(#9dffb6,#4fe084);border:1px solid #7CFC9A;box-shadow:0 4px 18px rgba(80,224,132,.35)" : "color:#dfeaff;background:rgba(28,49,72,.85);border:1px solid #3a6c8c"), label);
  b.onmouseenter = () => { b.style.transform = "translateY(-1px)"; }; b.onmouseleave = () => { b.style.transform = "none"; }; b.onclick = onClick; return b;
}
function randomCode() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }

export class SeatPlay {
  constructor(iface) {
    this.if = iface; this.gameId = iface.gameId || "ffg";
    this.net = null; this.clock = new TurnClock(iface.turnSeconds || 30);
    this.isHost = false; this.myPeerId = null; this.mySeat = -1;
    this.seats = []; this.turnSeat = 0; this.phase = "idle";       // idle|lobby|playing|ended
    this.gcfg = { total: 2, ais: 1 };
    this._lobbyPeers = new Map();                                  // peerId -> {name}
    this._lastSeen = new Map();                                    // peerId -> ts
    this._seq = {}; this._expSeq = {};                            // per-seat monotonic counters
    this._q = []; this._flushing = false;                        // outbound pacing queue
    this._hbIv = null; this.overlay = null; this._myName = "P-" + Math.floor(Math.random() * 1e4);
    this.roomCode = null;
  }

  /* ─────────── lobby ─────────── */
  openLobby() { if (this.if.onLobbyOpen) this.if.onLobbyOpen(); this._buildOverlay(); this._lobbyHome(); }
  _buildOverlay() {
    if (this.overlay) this.overlay.remove();
    const parent = this.if.parent || document.body;
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    this.overlay = el("div", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:70;background:radial-gradient(ellipse at center,rgba(6,14,26,.55) 0%,rgba(5,11,20,.92) 100%);color:#eaf3ff;font-family:'Segoe UI',system-ui,monospace;text-align:center");
    parent.appendChild(this.overlay);
  }
  _title(t, sub) { this.overlay.appendChild(el("div", "margin-bottom:4px", '<div style="font-size:clamp(28px,5vw,46px);font-weight:900;letter-spacing:6px;font-family:Georgia,serif;background:linear-gradient(180deg,#fff0c8,#f0c065,#c98a32);-webkit-background-clip:text;background-clip:text;color:transparent">' + t + "</div>" + (sub ? '<div style="font-size:13px;opacity:.85;margin-top:6px;letter-spacing:1px">' + sub + "</div>" : ""))); }
  _clear() { if (this.overlay) this.overlay.innerHTML = ""; }
  closeLobby() { if (this.overlay) { this.overlay.remove(); this.overlay = null; } }
  _lobbyHome() {
    this._clear(); this._title("PLAY ONLINE", "Play the board with friends");
    this.overlay.appendChild(btn("🔑  CREATE ROOM", () => this.createRoom(), true));
    this.overlay.appendChild(btn("⌨  JOIN ROOM", () => this._joinPrompt(), false));
    const back = btn("← BACK", () => this._back(), false); back.style.minWidth = "150px"; back.style.marginTop = "8px";
    this.overlay.appendChild(back);
  }
  _back() { this.teardown(); this.closeLobby(); if (this.if.onLobbyBack) this.if.onLobbyBack(); }
  _joinPrompt() {
    this._clear(); this._title("JOIN ROOM", "Enter your friend's 4-character code");
    const input = el("input", "font:bold 30px monospace;letter-spacing:10px;text-align:center;text-transform:uppercase;width:240px;padding:10px;border-radius:10px;border:1px solid #3a6c8c;background:rgba(8,18,32,.85);color:#eaf3ff;outline:none");
    input.maxLength = 4; input.placeholder = "ABCD";
    input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
    this.overlay.appendChild(input);
    this.overlay.appendChild(btn("CONNECT", () => { const c = input.value.trim().toUpperCase(); if (c.length === 4) this.joinRoom(c); }, true));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim().length === 4) this.joinRoom(input.value.trim().toUpperCase()); });
    const back = btn("← BACK", () => this._lobbyHome(), false); back.style.minWidth = "150px"; this.overlay.appendChild(back);
    setTimeout(() => input.focus(), 30);
  }

  _newNet() {
    const net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, this.gameId);
    net.on("msg", (m) => this._onMsg(m));
    net.on("error", ({ status }) => this._setStatusLine("Connection error (" + status + ")"));
    this.net = net; this.myPeerId = net.id; return net;
  }
  async createRoom(code) {
    this.isHost = true; this.roomCode = code || randomCode();
    this._hostPanel();                                            // draw immediately, roster fills in
    try { const net = this._newNet(); await net.connect(); await net.joinRoom(this.roomCode, true); this.phase = "lobby"; this._startHeartbeat(); this._hostPanel(); }
    catch (e) { this._setStatusLine("Could not create room."); }
  }
  async joinRoom(code) {
    this.isHost = false; this.roomCode = String(code).toUpperCase();
    this._joinWait();
    try { const net = this._newNet(); await net.connect(); await net.joinRoom(this.roomCode, false); this.phase = "lobby"; this._startHeartbeat(); this._joinWait(); }
    catch (e) { this._setStatusLine("Could not join room " + this.roomCode + "."); }
  }
  _rosterHtml() {
    const humans = this.gcfg.total - this.gcfg.ais;
    const peers = [...this._lobbyPeers.keys()].sort();
    const rows = [];
    rows.push('<div style="color:#7CFC9A">● Seat 1 — ' + (this.isHost ? "You (host)" : "Host") + "</div>");
    for (let s = 1; s < humans; s++) { const pid = peers[s - 1]; rows.push('<div style="opacity:' + (pid ? 1 : .4) + '">' + (pid ? "● Seat " + (s + 1) + " — " + (this._lobbyPeers.get(pid).name || "Player") : "○ Seat " + (s + 1) + " — waiting…") + "</div>"); }
    for (let s = humans; s < this.gcfg.total; s++) rows.push('<div style="color:#9bb8ff">◆ Seat ' + (s + 1) + " — AI</div>");
    return rows.join("");
  }
  _hostPanel() {
    if (!this.overlay) this._buildOverlay();
    this._clear(); this._title("HOST ROOM");
    this.overlay.appendChild(el("div", "font-size:13px;opacity:.8;letter-spacing:2px", "ROOM CODE"));
    this.overlay.appendChild(el("div", "font-size:44px;font-weight:900;letter-spacing:10px;font-family:monospace;color:#7CFC9A;background:rgba(8,18,32,.7);border:1px solid #2a6;border-radius:10px;padding:8px 24px;margin:2px 0", this.roomCode || "…"));
    const humans = this.gcfg.total - this.gcfg.ais;
    const step = (label, val, dec, inc) => { const w = el("div", "display:flex;align-items:center;justify-content:center;gap:10px;margin:4px"); w.appendChild(el("span", "font-size:13px;opacity:.85;min-width:110px;text-align:right", label)); const b1 = btn("–", dec, false); b1.style.minWidth = "40px"; const v = el("span", "font-size:20px;font-weight:800;min-width:26px", String(val)); const b2 = btn("+", inc, false); b2.style.minWidth = "40px"; w.append(b1, v, b2); return w; };
    this.overlay.appendChild(step("PLAYERS", this.gcfg.total, () => this._setCfg(this.gcfg.total - 1, this.gcfg.ais), () => this._setCfg(this.gcfg.total + 1, this.gcfg.ais)));
    this.overlay.appendChild(step("AI OPPONENTS", this.gcfg.ais, () => this._setCfg(this.gcfg.total, this.gcfg.ais - 1), () => this._setCfg(this.gcfg.total, this.gcfg.ais + 1)));
    this.overlay.appendChild(el("div", "margin:8px 0 2px;font-size:13px;opacity:.85;text-align:left;min-width:240px", this._rosterHtml()));
    const needJoin = humans - 1, have = this._lobbyPeers.size;
    const ready = have >= needJoin;
    const start = btn(ready ? "▶  START GAME" : "Waiting for " + (needJoin - have) + " more…", () => { if (ready) this.hostStart(); }, ready);
    start.disabled = !ready; start.style.opacity = ready ? 1 : .55; this.overlay.appendChild(start);
    const back = btn("← LEAVE", () => this._back(), false); back.style.minWidth = "150px"; this.overlay.appendChild(back);
  }
  _setCfg(total, ais) { total = Math.max(2, Math.min(5, total)); ais = Math.max(0, Math.min(total - 1, ais)); this.gcfg = { total, ais }; this._broadcastLobby(); this._hostPanel(); }
  _broadcastLobby() { if (this.isHost) this._enqueue({ t: "lobby", d: { cfg: this.gcfg, code: this.roomCode } }); }
  _joinWait() {
    if (!this.overlay) this._buildOverlay();
    this._clear(); this._title("JOINED ROOM " + (this.roomCode || ""), "Waiting for the host to start…");
    this.overlay.appendChild(el("div", "margin:8px 0;font-size:13px;opacity:.85;text-align:left;min-width:240px", this._rosterHtml()));
    const s = el("div", "font-size:15px;opacity:.9;margin-top:8px;color:#9fe6ff", "Connected — waiting for host ▸"); s.className = "sp-status"; this.overlay.appendChild(s);
    const back = btn("← LEAVE", () => this._back(), false); back.style.minWidth = "150px"; this.overlay.appendChild(back);
  }
  _setStatusLine(msg) { const s = this.overlay && this.overlay.querySelector(".sp-status"); if (s) s.textContent = msg; }
  _refreshLobby() { if (this.phase !== "lobby") return; if (this.isHost) this._hostPanel(); else this._joinWait(); }

  /* ─────────── heartbeat / roster / drops ─────────── */
  _startHeartbeat() {
    this._say("hello");
    if (this._hbIv) clearInterval(this._hbIv);
    this._hbIv = setInterval(() => {
      this._say("hello");
      const now = Date.now();
      // host reaps dead peers; every client watches the host
      if (this.isHost) { for (const [pid, ts] of [...this._lastSeen]) if (now - ts > DEAD_MS) this._peerGone(pid); }
      else if (this.phase === "playing" && this.seats[0] && this.seats[0].peerId) { const ts = this._lastSeen.get(this.seats[0].peerId); if (ts && now - ts > DEAD_MS) this._hostGone(); }
    }, HELLO_MS);
  }
  _say(t, d) { if (this.net) { try { this.net.send(t, t === "hello" ? { name: this._myName } : (d || {})); } catch (e) {} } }
  _peerGone(pid) {
    this._lastSeen.delete(pid); this._lobbyPeers.delete(pid);
    if (this.phase === "lobby") { this._refreshLobby(); return; }
    const seat = this.seats.findIndex((s) => s.peerId === pid); if (seat < 0) return;
    this.seats[seat].kind = "ai"; this.seats[seat].peerId = null;                   // host adopts the seat as AI
    this._enqueue({ t: "bye", d: { seat } });
    if (this.if.onPeerDrop) this.if.onPeerDrop(seat);
    if (this.seats.filter((s) => s.kind === "human").length < 1) return this._finish();
    if (this.turnSeat === seat && this.isHost) setTimeout(() => { if (this.turnSeat === seat && this.phase === "playing") this.if.driveAiTurn(seat); }, 400);
  }
  _hostGone() { if (this.phase === "ended") return; this.phase = "ended"; this.clock.stop(); if (this.if.end) this.if.end({ ended: true, reason: "Host left — match ended" }); this.teardown(); }

  /* ─────────── start handshake ─────────── */
  hostStart() {
    if (!this.isHost || this.phase !== "lobby") return;
    const humans = this.gcfg.total - this.gcfg.ais, peers = [...this._lobbyPeers.keys()].sort();
    const seats = [{ seat: 0, kind: "human", peerId: this.myPeerId, name: "Host", color: 0 }];
    for (let s = 1; s < humans; s++) { const pid = peers[s - 1]; if (!pid) return; seats.push({ seat: s, kind: "human", peerId: pid, name: this._lobbyPeers.get(pid).name || "Player", color: s }); }
    for (let s = humans; s < this.gcfg.total; s++) seats.push({ seat: s, kind: "ai", peerId: null, name: AI_NAMES[(s - humans) % 4] + " AI", color: s });
    // random per-match map seed — every client builds the same board from it
    const start = { seed: (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0), seats, turnSeat: 0, cfg: this.gcfg };
    this._enqueue({ t: "start", d: start });
    this._applyStart(start);
  }
  _applyStart(d) {
    this.seats = d.seats; this.turnSeat = d.turnSeat || 0; this._seq = {}; this._expSeq = {};
    this.mySeat = this.seats.findIndex((s) => s.peerId === this.myPeerId);
    if (this.mySeat < 0 && this.isHost) this.mySeat = 0;
    this.phase = "playing"; this.closeLobby();
    this.if.startGame({ seed: d.seed, seats: this.seats, mySeat: this.mySeat, turnSeat: this.turnSeat });
    this._dispatch(this.turnSeat);
  }

  /* ─────────── turn machine ─────────── */
  amActing(seat) { return seat === this.mySeat || (this.isHost && this.seats[seat] && this.seats[seat].kind === "ai"); }
  _dispatch(seat) {
    this.clock.stop();
    if (this.if.onTurn) this.if.onTurn({ turnSeat: seat, mySeat: this.mySeat, acting: this.amActing(seat) });
    if (this.if.setStatus) this.if.setStatus({ turnSeat: seat, mySeat: this.mySeat, seats: this.seats, yours: seat === this.mySeat });
    if (seat === this.mySeat && this.seats[seat] && this.seats[seat].kind === "human") {
      this.clock.start((t) => { if (this.if.setStatus) this.if.setStatus({ turnSeat: seat, mySeat: this.mySeat, seats: this.seats, yours: true, secsLeft: t }); }, () => { try { this.if.randomMove(seat); } catch (e) {} });
    } else if (this.isHost && this.seats[seat] && this.seats[seat].kind === "ai") {
      setTimeout(() => { if (this.turnSeat === seat && this.phase === "playing") { try { this.if.driveAiTurn(seat); } catch (e) {} } }, 600);
    }
  }
  // The GAME calls this after a local AUTHORITATIVE action applied (my human seat, or an AI seat I host).
  // `next` is the seat to act next: same seat for a sub-action (Aether roll/build), the next seat on endTurn.
  localMoved(payload, rng, next) {
    if (this.phase !== "playing") return;
    const seat = this.turnSeat;
    const seq = (this._seq[seat] = (this._seq[seat] || 0) + 1);
    this._enqueue({ t: "mv", d: { seat, p: payload, rng: rng || null, next, seq } });
    if (this.if.isOver && this.if.isOver()) return this._finish();
    const changed = next !== seat; this.turnSeat = next;
    if (changed) this._dispatch(next);
  }
  async _onMv(d) {
    if (this.phase !== "playing") return;
    const exp = (this._expSeq[d.seat] || 0) + 1;
    if (d.seq < exp) return;                                       // duplicate / stale
    if (d.seq > exp) { this.requestSync(); return; }               // gap → wait for authoritative sync
    this._expSeq[d.seat] = d.seq;
    try { await this.if.applyRemoteMove(d.seat, d.p, d.rng); } catch (e) {}
    if (this.if.isOver && this.if.isOver()) return this._finish();
    const changed = d.next !== d.seat; this.turnSeat = d.next;
    if (changed) this._dispatch(d.next);
  }
  requestSync() { if (!this.isHost) this._enqueue({ t: "needsync", d: {} }); }
  _finish() { if (this.phase === "ended") return; this.phase = "ended"; this.clock.stop(); if (this.if.end) this.if.end({ ended: true, winner: this.if.winnerSeat ? this.if.winnerSeat() : null }); }

  /* ─────────── inbound ─────────── */
  _onMsg(m) {
    if (!m) return;
    if (m.from) this._lastSeen.set(m.from, Date.now());
    switch (m.t) {
      case "hello": if (m.from) { if (!this._lobbyPeers.has(m.from)) { this._lobbyPeers.set(m.from, { name: (m.d && m.d.name) || "Player" }); this._refreshLobby(); if (this.isHost) this._broadcastLobby(); } else this._lobbyPeers.set(m.from, { name: (m.d && m.d.name) || "Player" }); } break;
      case "lobby": if (!this.isHost && this.phase === "lobby") { if (m.d && m.d.cfg) this.gcfg = m.d.cfg; this._refreshLobby(); } break;
      case "start": if (!this.isHost) this._applyStart(m.d); break;
      case "mv": this._onMv(m.d); break;
      case "bye": if (!this.isHost && m.d && this.seats[m.d.seat]) { this.seats[m.d.seat].kind = "ai"; this.seats[m.d.seat].peerId = null; if (this.if.onPeerDrop) this.if.onPeerDrop(m.d.seat); } break;
      case "needsync": if (this.isHost) this._enqueue({ t: "sync", d: { state: this.if.serializeState(), turnSeat: this.turnSeat, seats: this.seats } }); break;
      case "sync": if (!this.isHost && m.d) { try { this.if.loadState(m.d.state); } catch (e) {} this.seats = m.d.seats || this.seats; this.turnSeat = m.d.turnSeat; this._dispatch(this.turnSeat); } break;
    }
  }

  /* ─────────── outbound pacing ─────────── */
  _enqueue(msg) { this._q.push(msg); this._flush(); }
  _flush() {
    if (this._flushing || !this.net) return; this._flushing = true;
    const step = () => { const msg = this._q.shift(); if (!msg) { this._flushing = false; return; } try { this.net.send(msg.t, msg.d); } catch (e) {} setTimeout(step, SEND_GAP_MS); };
    step();
  }
  teardown() { this.clock.stop(); if (this._hbIv) { clearInterval(this._hbIv); this._hbIv = null; } try { this.net && this.net.leave(); } catch (e) {} this.net = null; this.phase = "idle"; }
}

/**
 * installSeatPlay(iface) — the game calls this once (lazily). Returns { controller, openLobby }.
 * Publishes window.__sp* hooks so an N-tab test can drive a networked match without canvas clicks.
 */
export function installSeatPlay(iface) {
  const sp = new SeatPlay(iface);
  const api = { controller: sp, openLobby: () => sp.openLobby() };
  if (typeof window !== "undefined") {
    window.FFG_SEATPLAY = api;
    window.__spJoin = async (code, opts) => {
      opts = opts || {};
      if (opts.create) { if (opts.total) sp.gcfg.total = opts.total; if (opts.ais != null) sp.gcfg.ais = Math.min(opts.ais, sp.gcfg.total - 1); await sp.createRoom(String(code).toUpperCase()); }
      else await sp.joinRoom(String(code).toUpperCase());
      return { room: sp.roomCode, host: sp.isHost, myPeerId: sp.myPeerId };
    };
    window.__spStart = () => { sp.hostStart(); return { seats: sp.seats.length, mySeat: sp.mySeat, turnSeat: sp.turnSeat }; };
    window.__spState = () => ({ isHost: sp.isHost, mySeat: sp.mySeat, turnSeat: sp.turnSeat, phase: sp.phase, seats: sp.seats.map((s) => ({ seat: s.seat, kind: s.kind, name: s.name })), lobby: sp._lobbyPeers.size, over: iface.isOver ? iface.isOver() : null, winner: iface.winnerSeat ? iface.winnerSeat() : null, boardHash: iface.boardHash ? iface.boardHash() : null });
    window.__spPlay = () => (iface.testPlayOne ? iface.testPlayOne() : false);
  }
  return api;
}
