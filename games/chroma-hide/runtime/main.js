/**
 * CHROMA HIDE — runtime/main.js  (ES module entry)
 * Wires the app flow: Title menu → Game (vs bots) → Results → rematch/menu, with
 * a Pause overlay bound to the page control bar. ?v= propagates to sibling imports.
 */
const V = new URL(import.meta.url).search;

const { Engine } = await import("./engine.js" + V);
const { Game } = await import("./game.js" + V);
const ui = await import("./ui.js" + V);
const { ChromaNet } = await import("./net/chromanet.js" + V);
const { computeSeekerCount, sanitizeSettings, DEFAULTS } = await import("./sim/match_core.js" + V);
const { mapList } = await import("./maps.js" + V);
const { GameAudio } = await import("./audio.js" + V);
const THREE = await import("three");
const MAPS = mapList();
const audio = new GameAudio(); audio.loadVolume();
const pickMap = (id) => (id && id !== "random") ? id : MAPS[(Math.random() * MAPS.length) | 0].id;

const container = document.getElementById("game-container") || document.body;
ui.setUiAudio(audio, container);   // one delegated binding covers every menu, card and chip
// Menu theme is lazy AND gated on first interaction: browsers block autoplay before a
// gesture, and fetching it eagerly would spend 508 KB on a player who hits Play at once.
addEventListener("pointerdown", function menuTheme() {
  removeEventListener("pointerdown", menuTheme);
  if (!window.__CHROMA__ || window.__CHROMA__.phase !== "menu") return;
  audio.playTrack("menu_theme", { gain: 0.22 });
}, { once: false });
const engine = new Engine(container);
engine.start();

window.__CHROMA__ = { engine, THREE, version: V, ready: false, phase: "menu", game: null, lastResult: null };

const hud = ui.createHUD(container); hud.hide();
let game = null, lastConfig = null;

const results = ui.createResults(container, {
  onRematch: () => { if (game && game.online) leaveOnline(); else startGame(lastConfig); },
  onMenu: () => { if (net) leaveOnline(); else toMenu(); },
});
const settings = ui.createSettings(container, {
  onQuality: (q) => engine.applyQuality(q),
  onVolume: (v) => audio.setVolume(v),
  onSensitivity: () => {}, // game reads chroma_sens live from localStorage
  // live-toggle the numeric match readout without needing a restart
  onColorAssist: (on) => { if (game) game._colorAssist = !!on; },
  onClose: () => settings.hide(),
});
const pause = ui.createPauseMenu(container, {
  onResume: () => {}, onPause: () => {},
  onSettings: () => settings.show(), onQuit: () => toMenu(),
});
const lobby = ui.createOnlineLobby(container, {
  onQuick: () => onlineConnect("quick"),
  onCreate: () => onlineConnect("create"),
  onJoin: (code) => onlineConnect("join", code),
  onStart: (opts) => onlineStart(opts),
  onBack: () => leaveOnline(),
}, MAPS);
const title = ui.createTitleMenu(container, {
  onPlay: (cfg) => { audio.select(); audio.stopTrack(0.8); startGame({ ...cfg, mapId: pickMap(cfg.mapId) }); },
  onOnline: () => { title.hide(); lobby.show(); window.__CHROMA__.phase = "lobby"; },
  onHelp: () => alert("HIDERS: paint your body (F) to match a surface, hold still, survive the hunt.\nSEEKERS: find and shoot every hider before the timer — but ammo is limited."),
  onSettings: () => settings.show(),
}, MAPS);

let net = null;
function wireNet() {
  net.on("peer", () => lobby.updatePeers(net.peerIds().length));
  net.on("start", (roster) => startOnlineGame(roster, "guest"));
  net.on("error", () => lobby.setError("Connection error. Try again."));
}
async function onlineConnect(kind, code) {
  try {
    net = new ChromaNet(); wireNet();
    if (kind === "quick") {
      lobby.showWaiting({ host: false, searching: true });
      const m = await net.quickMatch(15000);
      if (!m) { lobby.setError("No match found — try Create Room."); lobby.showWaiting({ host: true, code: await net.hostRoom() }); }
      else { lobby.showWaiting({ host: net.isHost(), code: m.room }); }
    } else if (kind === "create") {
      const c = await net.hostRoom(); lobby.showWaiting({ host: true, code: c });
    } else {
      await net.joinRoom(code); lobby.showWaiting({ host: false, code });
    }
    lobby.updatePeers(net.peerIds().length);
  } catch (e) { lobby.setError("Could not connect. Check your network."); }
}
function onlineStart(opts) {
  const lobbySize = opts.lobbySize, seekerCount = computeSeekerCount(lobbySize);
  const settings = sanitizeSettings({ ...DEFAULTS, mode: opts.mode });
  const roster = net.startMatch(lobbySize, seekerCount, settings, pickMap(opts.mapId));
  startOnlineGame(roster, "host");
}
function startOnlineGame(roster, netRole) {
  lobby.hide(); title.hide(); results.hide();
  if (game) { game.destroy(); game = null; }
  game = new Game(engine, { online: true, net, netRole, roster }, hud, {
    onEnd: (r) => { results.show(r); window.__CHROMA__.phase = "results"; window.__CHROMA__.lastResult = r; }, audio,
  });
  window.__CHROMA__.game = game; window.__CHROMA__.phase = "playing-online";
}
function leaveOnline() {
  if (net) { try { net.leave(); } catch (e) {} net = null; }
  lobby.hide(); title.show(); window.__CHROMA__.phase = "menu";
}

function startGame(cfg) {
  lastConfig = cfg;
  results.hide(); title.hide();
  if (game) { game.destroy(); game = null; }
  game = new Game(engine, cfg, hud, {
    onEnd: (r) => { results.show(r); window.__CHROMA__.phase = "results"; window.__CHROMA__.lastResult = r; }, audio,
  });
  window.__CHROMA__.game = game;
  window.__CHROMA__.phase = "playing";
}
function toMenu() {
  if (game) { game.destroy(); game = null; }
  if (net) { try { net.leave(); } catch (e) {} net = null; }
  results.hide(); hud.hide(); lobby.hide(); title.show();
  window.__CHROMA__.game = null; window.__CHROMA__.phase = "menu";
}

// ── test/debug hooks (backgrounded panes pause rAF; drive frames manually) ────
function pump(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { for (const fn of engine._updaters) fn(dt, i * dt); engine.renderer.render(engine.scene, engine.camera); } }
function sampleScreen(nx, ny) {
  const cv = engine.renderer.domElement, w = 40, h = 24;
  const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
  const cx = tmp.getContext("2d"); cx.drawImage(cv, 0, 0, w, h);
  const p = cx.getImageData(clampi(nx * w, w), clampi(ny * h, h), 1, 1).data;
  return { r: p[0], g: p[1], b: p[2] };
}
const clampi = (v, n) => Math.max(0, Math.min(n - 1, Math.floor(v)));

Object.assign(window.__CHROMA__, { pump, sampleScreen, startGame, toMenu, onlineConnect, startOnlineGame, leaveOnline, getNet: () => net, ChromaNet, ready: true });
