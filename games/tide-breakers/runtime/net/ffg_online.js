/**
 * FFG runtime — net/ffg_online.js  (GENERIC perfect-information online play)
 *
 * Lobby UI (Quick Match / Create Room / Join Room) + a 15-second per-turn clock +
 * a MOVE-RELAY turn machine over Supabase Realtime (Broadcast/Presence via NetPlay).
 *
 * Unlike Iron Tide's battleship online (where each client hides its own board, so the
 * DEFENDER resolves shots), this is for PERFECT-INFORMATION games — chess, free naval —
 * where BOTH clients run the SAME deterministic sim. So we only relay each move's
 * payload and apply it locally on the other side. The game owns the sim + animation;
 * this module owns matchmaking, turn alternation, and the clock.
 *
 * SINGLE-PLAYER IS UNTOUCHED: lazy-loaded only when the player clicks PLAY ONLINE, so
 * supabase-js never enters the vs-AI bundle.
 *
 * PROTOCOL (NetPlay.send/on('msg')):
 *   mv  {p:<movePayload>}   — I made a move; here is the opaque payload your sim applies.
 *   bye {}                  — I'm leaving / the game ended.
 *
 * HOST plays the side that moves first; turns strictly alternate.
 *
 * iface (the game provides this):
 *   parent            : DOM element to overlay the lobby on
 *   onLobbyOpen()     : hide the title menu / stop idle spin
 *   onLobbyBack()     : return to the title menu (lobby was cancelled)
 *   startGame(isHost) : begin a FRESH networked game; host = the first-moving side
 *   isMyTurn()        : -> bool (true when sim.turn === my side)
 *   applyRemoteMove(payload) : apply + animate the opponent's move on the local sim
 *                              (may be async; return a Promise to gate the clock)
 *   randomMove()      : make a random legal move for MY side (timeout safety). It must
 *                       apply locally; the game's normal move path will broadcast it.
 *   isOver()          : -> bool (game finished — checkmate/draw/etc.)
 *   setStatus({myTurn, secsLeft, banner}) : update the in-game HUD line + timer
 *   end(victory, subtitle)  : optional end screen (the game usually ends itself)
 */

export const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
// ANON key is PUBLIC by design (we use only Realtime Broadcast/Presence — no tables).
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

const TURN_SECONDS = 15;

const V = new URL(import.meta.url).search; // propagate cache-bust to sibling import
const { NetPlay, TurnClock } = await import("./ffg_netplay.js" + V);

// ── small DOM helpers (match the cinematic dark/teal shell styling) ────────────
function el(tag, css, html) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (html != null) e.innerHTML = html;
  return e;
}
function btn(label, onClick, primary) {
  const b = el(
    "button",
    "font:bold 15px 'Segoe UI',system-ui,monospace;padding:11px 26px;cursor:pointer;" +
      "min-width:220px;letter-spacing:1px;border-radius:7px;transition:transform .08s,box-shadow .12s;" +
      (primary
        ? "color:#062018;background:linear-gradient(#9dffb6,#4fe084);border:1px solid #7CFC9A;box-shadow:0 4px 18px rgba(80,224,132,.35)"
        : "color:#dfeaff;background:rgba(28,49,72,.85);border:1px solid #3a6c8c"),
    label
  );
  b.onmouseenter = () => { b.style.transform = "translateY(-1px)"; };
  b.onmouseleave = () => { b.style.transform = "none"; };
  b.onclick = onClick;
  return b;
}
function randomCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class OnlineController {
  constructor(iface) {
    this.if = iface;
    this.gameId = iface.gameId || "ffg";
    this.net = null;
    this.clock = new TurnClock(TURN_SECONDS);
    this.isHost = false;
    this.inGame = false;
    this.ended = false;
    this._placing = false; // "connecting/handshaking" guard
    this.overlay = null;
  }

  // ── lobby overlay ───────────────────────────────────────────────────────────
  openLobby() {
    if (this.if.onLobbyOpen) this.if.onLobbyOpen();
    this._buildOverlay();
    this._lobbyHome();
  }
  _buildOverlay() {
    if (this.overlay) this.overlay.remove();
    const parent = this.if.parent || document.body;
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    this.overlay = el(
      "div",
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;" +
        "gap:14px;z-index:70;background:radial-gradient(ellipse at center,rgba(6,14,26,.55) 0%,rgba(5,11,20,.9) 100%);" +
        "color:#eaf3ff;font-family:'Segoe UI',system-ui,monospace;text-align:center"
    );
    this.overlay.className = "ffg-online-overlay";
    parent.appendChild(this.overlay);
  }
  _title(t, sub) {
    this.overlay.appendChild(
      el(
        "div",
        "margin-bottom:6px",
        '<div style="font-size:clamp(30px,5vw,52px);font-weight:900;letter-spacing:6px;font-family:Georgia,serif;' +
          "background:linear-gradient(180deg,#fff0c8,#f0c065,#c98a32);-webkit-background-clip:text;background-clip:text;color:transparent;" +
          'text-shadow:0 4px 26px rgba(0,0,0,.65)">' + t + "</div>" +
          (sub ? '<div style="font-size:14px;opacity:.85;margin-top:8px;letter-spacing:1px">' + sub + "</div>" : "")
      )
    );
  }
  _clear() { if (this.overlay) this.overlay.innerHTML = ""; }
  closeLobby() { if (this.overlay) { this.overlay.remove(); this.overlay = null; } }

  _lobbyHome() {
    this._clear();
    this._title("PLAY ONLINE", "Face a live opponent");
    this.overlay.appendChild(el("div", "height:6px"));
    this.overlay.appendChild(btn("⚡  QUICK MATCH", () => this.startQuickMatch(), true));
    this.overlay.appendChild(btn("🔑  CREATE ROOM", () => this.startCreateRoom(), false));
    this.overlay.appendChild(btn("⌨  JOIN ROOM", () => this._joinRoomPrompt(), false));
    const back = btn("← BACK", () => this._backToMenu(), false);
    back.style.minWidth = "150px"; back.style.marginTop = "10px";
    this.overlay.appendChild(back);
  }
  _backToMenu() {
    this.teardown();
    this.closeLobby();
    if (this.if.onLobbyBack) this.if.onLobbyBack();
  }
  _waiting(msg, code) {
    this._clear();
    this._title("PLAY ONLINE");
    if (code) {
      this.overlay.appendChild(el("div", "font-size:13px;opacity:.8;letter-spacing:2px", "ROOM CODE"));
      this.overlay.appendChild(
        el(
          "div",
          "font-size:46px;font-weight:900;letter-spacing:10px;font-family:monospace;color:#7CFC9A;" +
            "background:rgba(8,18,32,.7);border:1px solid #2a6;border-radius:10px;padding:10px 26px;margin:4px 0",
          code
        )
      );
      this.overlay.appendChild(el("div", "font-size:13px;opacity:.7;max-width:380px", "Share this code with a friend. They pick <b>Join Room</b> and enter it."));
    }
    const spin = el("div", "font-size:16px;opacity:.9;margin-top:10px;color:#9fe6ff", msg || "Waiting for opponent…");
    spin.className = "ffg-online-status";
    this.overlay.appendChild(spin);
    const cancel = btn("CANCEL", () => this._backToMenu(), false);
    cancel.style.minWidth = "150px"; cancel.style.marginTop = "12px";
    this.overlay.appendChild(cancel);
  }
  _setWaitingMsg(msg) {
    const s = this.overlay && this.overlay.querySelector(".ffg-online-status");
    if (s) s.textContent = msg;
  }
  _joinRoomPrompt() {
    this._clear();
    this._title("JOIN ROOM", "Enter your friend's 4-character code");
    const input = el(
      "input",
      "font:bold 30px monospace;letter-spacing:10px;text-align:center;text-transform:uppercase;width:240px;" +
        "padding:10px;border-radius:10px;border:1px solid #3a6c8c;background:rgba(8,18,32,.85);color:#eaf3ff;outline:none"
    );
    input.maxLength = 4;
    input.placeholder = "ABCD";
    input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
    this.overlay.appendChild(input);
    const go = btn("CONNECT", () => {
      const code = input.value.trim().toUpperCase();
      if (code.length === 4) this.startJoinRoom(code);
    }, true);
    this.overlay.appendChild(go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim().length === 4) this.startJoinRoom(input.value.trim().toUpperCase()); });
    const back = btn("← BACK", () => this._lobbyHome(), false);
    back.style.minWidth = "150px";
    this.overlay.appendChild(back);
    setTimeout(() => input.focus(), 30);
  }

  // ── connection flows ──────────────────────────────────────────────────────────
  _newNet() {
    const net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, this.gameId);
    net.on("peer", ({ present }) => this._onPeer(present));
    net.on("msg", (m) => this._onMsg(m));
    net.on("error", ({ status }) => { if (this.if.onError) this.if.onError("Connection error: " + status); this._setWaitingMsg("Connection error (" + status + ")"); });
    this.net = net;
    return net;
  }
  async startQuickMatch() {
    this._waiting("Searching for an opponent…");
    try {
      const net = this._newNet();
      await net.connect();
      const res = await net.quickMatch(60000);
      if (!res) { this._setWaitingMsg("No opponent found. Try again."); return; }
      this.isHost = !!res.host;
      this._enterGame();
    } catch (e) {
      if (this.if.onError) this.if.onError(String(e && e.message || e));
      this._setWaitingMsg("Could not connect.");
    }
  }
  async startCreateRoom() {
    const code = randomCode();
    this._waiting("Waiting for opponent…", code);
    try {
      const net = this._newNet();
      await net.connect();
      await net.joinRoom(code, true); // creator is host
      this.isHost = true;
      // game begins as soon as the peer joins (handled in _onPeer)
    } catch (e) {
      if (this.if.onError) this.if.onError(String(e && e.message || e));
      this._setWaitingMsg("Could not create room.");
    }
  }
  async startJoinRoom(code) {
    this._waiting("Connecting to room " + code + "…");
    try {
      const net = this._newNet();
      await net.connect();
      await net.joinRoom(code, false);
      this.isHost = false;
      if (this.net.peerPresent) this._enterGame();
    } catch (e) {
      if (this.if.onError) this.if.onError(String(e && e.message || e));
      this._setWaitingMsg("Could not join room.");
    }
  }

  _onPeer(present) {
    if (present && !this.inGame && !this._placing) {
      this._enterGame();
    } else if (!present && this.inGame && !this.ended) {
      this._opponentLeft();
    }
  }

  // ── game start + turn machine ─────────────────────────────────────────────────
  _enterGame() {
    if (this._placing || this.inGame) return;
    this._placing = true;
    this.isHost = this.net.isHost(); // authoritative once paired
    this.closeLobby();
    this.inGame = true;
    this._placing = false;
    // Build a fresh networked game; host plays the first-moving side.
    this.if.startGame(this.isHost);
    if (this.if.isMyTurn()) this._myTurnStart();
    else this._pushStatus(false, "Opponent's move…");
  }

  _myTurnStart() {
    if (this.ended) return;
    this.clock.stop();
    this.clock.start(
      (secsLeft) => this._pushStatus(true, "Your move", secsLeft),
      () => this._onTimeout()
    );
    this._pushStatus(true, "Your move", this.clock.left);
  }
  _pushStatus(myTurn, banner, secsLeft) {
    if (this.if.setStatus) this.if.setStatus({ myTurn: !!myTurn, banner: banner || "", secsLeft: secsLeft != null ? secsLeft : null });
  }
  _onTimeout() {
    if (this.ended || !this.if.isMyTurn() || this.if.isOver()) return;
    // Safety: make a random legal move so play never stalls. The game's normal move
    // path broadcasts it for us (via localMoved), so we don't send here.
    try { this.if.randomMove(); } catch (e) {}
  }

  /** The GAME calls this AFTER a local move has applied+animated (user OR timeout). */
  localMoved(payload) {
    if (!this.inGame || this.ended) return;
    this.clock.stop();
    try { this.net.send("mv", { p: payload }); } catch (e) {}
    if (this.if.isOver()) { this.finish(); return; }
    this._pushStatus(false, "Opponent's move…");
  }

  /** Send an app-level message (e.g. profile handshake) over the same channel. */
  sendRaw(t, d) { try { if (this.net) this.net.send(t, d); } catch (e) {} }

  async _onMsg(m) {
    if (!m || this.ended) return;
    if (m.t === "bye") { this._opponentLeft(); return; }
    if (m.t !== "mv") { if (this.if.onPeerMessage) this.if.onPeerMessage(m.t, m.d); return; }
    // Apply the opponent's move (may animate). Then it's my turn.
    try { await this.if.applyRemoteMove(m.d && m.d.p); } catch (e) {}
    if (this.ended) return;
    if (this.if.isOver()) { this.finish(); return; }
    if (this.if.isMyTurn()) this._myTurnStart();
    else this._pushStatus(false, "Opponent's move…"); // (shouldn't happen in strict alternation)
  }

  _opponentLeft() {
    if (this.ended) return;
    this.clock.stop();
    this.ended = true; this.inGame = false;
    if (this.if.end) this.if.end(true, "Opponent left — you win");
    setTimeout(() => { try { this.net && this.net.leave(); } catch (e) {} }, 200);
  }

  /** The game calls this when IT detects the game is over (checkmate/draw). */
  finish() {
    if (this.ended) return;
    this.ended = true; this.inGame = false;
    this.clock.stop();
    try { this.net && this.net.send("bye", {}); } catch (e) {}
    setTimeout(() => { try { this.net && this.net.leave(); } catch (e) {} }, 300);
  }

  teardown() {
    this.clock.stop();
    try { this.net && this.net.leave(); } catch (e) {}
    this.net = null;
    this.inGame = this._placing = false;
  }
}

/**
 * installOnline(iface) — the game calls this once (lazily). Returns:
 *   controller   : the live OnlineController
 *   openLobby()  : open the PLAY ONLINE lobby
 * Also publishes window.__mp* hooks so a 2-client Playwright test can drive a match
 * deterministically without clicking the 3D canvas.
 */
export function installOnline(iface) {
  const controller = new OnlineController(iface);
  const api = { controller, openLobby: () => controller.openLobby() };
  if (typeof window !== "undefined") {
    window.FFG_ONLINE = api;
    window.__mpJoin = async (code, asHost) => {
      controller._buildOverlay();
      const net = controller._newNet();
      await net.connect();
      await net.joinRoom(String(code).toUpperCase(), !!asHost);
      controller.isHost = !!asHost;
      if (net.peerPresent) controller._enterGame();
      return { room: String(code).toUpperCase(), host: !!asHost };
    };
    window.__mpState = () => ({
      isHost: controller.isHost,
      inGame: controller.inGame,
      ended: controller.ended,
      myTurn: controller.if.isMyTurn ? controller.if.isMyTurn() : null,
      over: controller.if.isOver ? controller.if.isOver() : null,
      peerPresent: controller.net ? controller.net.peerPresent : false,
      secsLeft: controller.clock.running() ? controller.clock.left : null,
    });
  }
  return api;
}
