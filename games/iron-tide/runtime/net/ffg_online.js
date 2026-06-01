/**
 * FFG runtime — net/ffg_online.js  (ES module)
 * The ONLINE-PLAY controller for Iron Tide. Owns the lobby UI (Quick Match /
 * Create Room / Join Room), wires the verified transport (NetPlay) + the 15-second
 * per-turn clock (TurnClock) from ffg_netplay.js, and drives the networked
 * turn/shot protocol against the battleship renderer.
 *
 * SINGLE-PLAYER IS UNTOUCHED: this module is lazy-loaded ONLY when the player
 * clicks "PLAY ONLINE" on the menu, so the vs-AI path never imports supabase-js
 * or pays any of this cost. The renderer registers a small interface on
 * window.FFG_IRONTIDE_MP that this module calls to begin placement, render shots,
 * gate turns, and end the match. Nothing here knows three.js — all rendering is
 * delegated, so the exact same cinematic VFX serve both modes.
 *
 * PROTOCOL (Supabase Realtime Broadcast, relayed by NetPlay.send/on('msg')):
 *   ready  {}                              — I finished placing my fleet.
 *   fire   {x,y}                           — I (the attacker) shoot YOUR water.
 *   result {x,y,outcome,ship?,win?}        — I (the defender) resolved that shot
 *                                            on MY OWN fleet; here's what happened.
 *   rematch{}  /  bye{}                    — housekeeping (optional).
 *
 * WHY the defender resolves: in real online Battleship each client only knows its
 * OWN ship layout. So the attacker never resolves a shot locally — it broadcasts
 * fire{x,y}; the DEFENDER runs the sim against its own fleet (sim.fire("enemy",…)
 * which targets the local player's board) and broadcasts the authoritative result
 * back. The attacker just renders the peg/explosion from that result. Enemy ships
 * stay hidden — that's the game.
 *
 * HOST moves first (NetPlay.isHost()), then turns strictly alternate.
 */

// Supabase creds. The ANON key is PUBLIC by design (RLS-gated; here we use only
// Realtime Broadcast/Presence, which touch no tables). NEVER put service_role here.
export const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

const GAME_ID = "iron-tide";
const TURN_SECONDS = 15;

const V = new URL(import.meta.url).search; // propagate cache-bust to sibling import
const { NetPlay, TurnClock } = await import("./ffg_netplay.js" + V);

// ── small DOM helpers (match the shell's dark/teal cinematic styling) ──────────
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

/**
 * OnlineController — created by the renderer (which passes it the `iface` it can
 * drive). The renderer calls `controller.openLobby()` when PLAY ONLINE is chosen.
 *
 * iface (renderer-provided):
 *   parent           : DOM element to overlay the lobby on
 *   onLobbyOpen()    : renderer hides menu / stops idle spin
 *   beginPlacement(onAllPlaced) : start the SAME ship-placement UI; call back when
 *                                 the local fleet is fully placed
 *   autoPlace(onAllPlaced)      : auto-place the rest (for the 15s placement safety
 *                                 + the test hook), then call back
 *   resolveIncoming(x,y) -> {outcome,ship?,shipCells?,win?}
 *                      : DEFENDER resolves a shot on the LOCAL fleet, renders it
 *                        (peg/explosion/sink on the player's own board), returns the
 *                        authoritative outcome to broadcast back
 *   renderOutgoing(x,y,outcome,shipCells, done) :
 *                        ATTACKER renders the cannonball + peg/explosion on the
 *                        ENEMY board from the result; calls done() when the VFX end
 *   markEnemySunk(ship) : flip an enemy-fleet HUD pip to sunk (attacker side)
 *   setStatus({turn,secsLeft,myTurn,banner}) : update the HUD line + timer
 *   canFire(x,y) -> bool: cell not already shot (repeat guard) on the enemy board
 *   markShot(x,y)       : record an outgoing shot so the cell can't be re-fired
 *   end(victory, subtitle) : show the VICTORY/DEFEAT end screen, stop play
 *   onError(msg)        : surface a connection error in the lobby
 */
export class OnlineController {
  constructor(iface) {
    this.if = iface;
    this.net = null;
    this.clock = new TurnClock(TURN_SECONDS);
    this.isHost = false;
    this.myTurn = false;
    this.iReady = false;
    this.peerReady = false;
    this.inGame = false;
    this.ended = false;
    this.pendingFire = null; // {x,y} broadcast, awaiting a result
    this.overlay = null;
    this._statusBanner = "";
    this._setup = false;
  }

  // ── lobby overlay ───────────────────────────────────────────────────────────
  openLobby() {
    if (this.if.onLobbyOpen) this.if.onLobbyOpen();
    this._buildOverlay();
    this._lobbyHome();
  }
  _buildOverlay() {
    if (this.overlay) { this.overlay.remove(); }
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
    this._title("PLAY ONLINE", "Battle a live opponent");
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
    const net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, GAME_ID);
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
      const res = await net.quickMatch(60000); // 60s timeout
      if (!res) { this._setWaitingMsg("No opponent found. Try again."); return; }
      this.isHost = !!res.host;
      this._enterPlacement();
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
      // placement begins as soon as the peer joins (handled in _onPeer)
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
      await net.joinRoom(code, false); // joiner is not host
      this.isHost = false;
      // If the host is already present, presence sync fires immediately.
      if (this.net.peerPresent) this._enterPlacement();
    } catch (e) {
      if (this.if.onError) this.if.onError(String(e && e.message || e));
      this._setWaitingMsg("Could not join room.");
    }
  }

  _onPeer(present) {
    if (present && !this.inGame && !this._placing) {
      // Opponent connected — start placement on both sides.
      this._enterPlacement();
    } else if (!present && (this.inGame || this._placing) && !this.ended) {
      // Opponent left mid-match.
      this._opponentLeft();
    }
  }

  _enterPlacement() {
    if (this._placing || this.inGame) return;
    this._placing = true;
    this.isHost = this.net.isHost(); // authoritative once paired
    this.closeLobby();
    // The renderer runs its normal placement UI; when the local fleet is fully
    // placed we mark ourselves ready and tell the opponent.
    this.if.beginPlacement(() => this._localReady());
  }

  _localReady() {
    if (this.iReady) return;
    this.iReady = true;
    this.net.send("ready", {});
    this._maybeStartBattle();
  }
  _maybeStartBattle() {
    if (this.iReady && this.peerReady && !this.inGame) {
      this._placing = false;
      this.inGame = true;
      this.myTurn = this.isHost; // host fires first
      this._beginTurnState();
    } else if (this.iReady && !this.peerReady) {
      // Waiting for the opponent to finish placing.
      this.if.setStatus({ banner: "Waiting for opponent to deploy…", myTurn: false, secsLeft: null });
    }
  }

  // ── turn machine ───────────────────────────────────────────────────────────
  _beginTurnState() {
    if (this.ended) return;
    this.pendingFire = null;
    this._startClock();
    this._pushStatus();
  }
  _pushStatus() {
    this.if.setStatus({
      myTurn: this.myTurn,
      secsLeft: this.clock.running() ? this.clock.left : null,
      banner: this.myTurn ? "Your move — click enemy waters" : "Opponent's move…",
    });
  }
  _startClock() {
    this.clock.stop();
    if (this.ended) return;
    this.clock.start(
      (secsLeft) => { this.if.setStatus({ myTurn: this.myTurn, secsLeft: secsLeft, banner: this.myTurn ? "Your move — click enemy waters" : "Opponent's move…" }); },
      () => this._onTimeout()
    );
  }
  _onTimeout() {
    if (this.ended) return;
    if (this.myTurn && !this.pendingFire) {
      // Auto-forfeit the turn: fire at a random un-shot enemy cell so play never stalls.
      const cell = this.if.randomUnshotCell ? this.if.randomUnshotCell() : null;
      if (cell) this.fire(cell.x, cell.y, true);
      else this._passTurn(); // board exhausted (shouldn't happen before a win)
    } else if (!this.myTurn) {
      // Opponent's clock expired on our screen too — they should auto-fire; we just
      // keep waiting. (Their client owns their forfeit.) Re-arm a fresh clock so the
      // UI keeps counting if their message is delayed.
      this._startClock();
    }
  }
  _passTurn() {
    this.myTurn = false;
    this._beginTurnState();
  }

  /** ATTACKER: I shoot the opponent's water at (x,y). */
  fire(x, y, fromTimeout) {
    if (this.ended || !this.inGame || !this.myTurn || this.pendingFire) return false;
    if (!this.if.canFire(x, y)) return false; // already shot there
    this.clock.stop();
    this.pendingFire = { x, y };
    this.if.markShot(x, y);
    this.net.send("fire", { x, y });
    this.if.setStatus({ myTurn: false, secsLeft: null, banner: "Salvo away… awaiting impact" });
    return true;
  }

  _onMsg(m) {
    if (!m || this.ended) return;
    const t = m.t, d = m.d || {};
    if (t === "ready") {
      this.peerReady = true;
      this._maybeStartBattle();
      return;
    }
    if (t === "fire") {
      this._handleIncomingFire(d.x, d.y);
      return;
    }
    if (t === "result") {
      this._handleResult(d);
      return;
    }
    if (t === "bye") {
      this._opponentLeft();
      return;
    }
  }

  /** DEFENDER: opponent shot MY water — resolve on my own fleet, render it, reply. */
  _handleIncomingFire(x, y) {
    if (this.ended) return;
    this.clock.stop();
    this.if.setStatus({ myTurn: false, secsLeft: null, banner: "Incoming fire…" });
    const res = this.if.resolveIncoming(x, y) || { outcome: "miss" };
    // Reply with the authoritative outcome (+ ship cells so the attacker can render
    // the revealed wreck on a sink).
    this.net.send("result", {
      x, y,
      outcome: res.outcome,
      ship: res.ship || null,
      shipCells: res.shipCells || null,
      win: !!res.win, // true = the SHOOTER (opponent) just sank my last ship → they win
    });
    if (res.win) {
      // I lost — my whole fleet is down.
      this._finish(false, "Your fleet was sunk");
      return;
    }
    // Turn passes to me (the defender) after a beat for the impact VFX to land
    // (cannonball flight ~0.72s + splash/peg). The renderer also gates clicks on
    // its own `busy` flag, so this is purely about when the HUD says "your move".
    const handoff = (res.outcome === "sink") ? 1700 : 1250;
    setTimeout(() => { if (!this.ended) { this.myTurn = true; this._beginTurnState(); } }, handoff);
  }

  /** ATTACKER: opponent resolved my shot — render the peg/explosion from the result. */
  _handleResult(d) {
    if (this.ended) return;
    const pend = this.pendingFire;
    this.pendingFire = null;
    const x = d.x, y = d.y;
    this.if.renderOutgoing(x, y, d.outcome, d.shipCells || null, () => {
      if (this.ended) return;
      if (d.outcome === "sink" && d.ship) this.if.markEnemySunk(d.ship);
      if (d.win) {
        // I sank their last ship → I win.
        this._finish(true, "Enemy fleet destroyed");
        return;
      }
      // Turn passes to opponent.
      this.myTurn = false;
      this._beginTurnState();
    });
  }

  _opponentLeft() {
    if (this.ended) return;
    this.clock.stop();
    this._finish(true, "Opponent left — match ended");
  }

  _finish(victory, subtitle) {
    if (this.ended) return;
    this.ended = true;
    this.inGame = false;
    this.clock.stop();
    this.if.end(victory, subtitle);
    try { this.net && this.net.send("bye", {}); } catch (e) {}
    // Leave the channel shortly after, letting the bye flush.
    setTimeout(() => { try { this.net && this.net.leave(); } catch (e) {} }, 300);
  }

  teardown() {
    this.clock.stop();
    try { this.net && this.net.leave(); } catch (e) {}
    this.net = null;
    this.iReady = this.peerReady = this.inGame = this._placing = false;
    this.pendingFire = null;
  }
}

/**
 * install(iface) — the renderer calls this once. Returns an object with:
 *   openLobby()  : open the PLAY ONLINE lobby
 *   controller   : the live OnlineController (for test hooks)
 * Also publishes window.__mp* test hooks so the 2-client Playwright test can drive
 * the networked flow deterministically without clicking the 3D canvas.
 */
export function installOnline(iface) {
  const controller = new OnlineController(iface);
  const api = {
    controller,
    openLobby: () => controller.openLobby(),
  };
  if (typeof window !== "undefined") {
    window.FFG_IRONTIDE_ONLINE = api;
    // ── deterministic test hooks (used by the 2-client e2e test) ──────────────
    window.__mpQuick = () => controller.startQuickMatch();
    // Join a SPECIFIC room as host/guest (the test pairs both clients on one code).
    window.__mpJoin = async (code, asHost) => {
      controller._waiting && controller._buildOverlay();
      const net = controller._newNet();
      await net.connect();
      await net.joinRoom(String(code).toUpperCase(), !!asHost);
      controller.isHost = !!asHost;
      if (net.peerPresent) controller._enterPlacement();
      return { room: String(code).toUpperCase(), host: !!asHost };
    };
    window.__mpReady = () => { // auto-place the local fleet, then signal ready
      if (iface.autoPlace) iface.autoPlace(() => controller._localReady());
      else controller._localReady();
    };
    window.__mpFire = (x, y) => controller.fire(x, y);
    window.__mpState = () => ({
      isHost: controller.isHost,
      myTurn: controller.myTurn,
      iReady: controller.iReady,
      peerReady: controller.peerReady,
      inGame: controller.inGame,
      ended: controller.ended,
      peerPresent: controller.net ? controller.net.peerPresent : false,
      pendingFire: controller.pendingFire,
      secsLeft: controller.clock.running() ? controller.clock.left : null,
    });
  }
  return api;
}
