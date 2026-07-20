/**
 * royale/net.js — play-with-friends multiplayer over Supabase Realtime
 * (NetPlay transport — pure WebSocket relay, $0, no Postgres).
 *
 * Model: room code lobby, up to 8 humans. The world is DETERMINISTIC from the
 * shared seed (terrain, POIs, loot spawns, chest contents, storm plan), so
 * only live state is relayed:
 *   - each human simulates their OWN actor and broadcasts state at ~12Hz
 *   - the HOST simulates all 49-minus-guests bots and broadcasts bot
 *     snapshots at 10Hz (guests render them as netRemote actors)
 *   - hits on a human are sent to the victim's client ("hitYou") — the victim
 *     applies damage to itself (client authority over own HP)
 *   - builds / chest opens / item pickups / eliminations mirror as events
 *
 * JOIN = TAKE OVER A BOT SLOT: humans occupy slots s0..sK (sorted by peer id,
 * host = s0); every other slot keeps its bot. A guest joining the lobby simply
 * claims the next slot before match start; when a guest disconnects mid-match
 * the host re-attaches a bot brain to that slot — the actor keeps fighting.
 */
import { NetPlay } from "../../net/ffg_netplay.js";

const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

let S = null; // session

export function init(W) {
  W.net = null;
  W.events.on("openOnline", (sel) => openLobby(W, sel));
  // weapons.js routes hits on netRemote humans here (victim applies to itself)
  W.reportRemoteHit = (target, dmg, weaponId, isHead) => {
    if (S && W.player) send("hitYou", { target: target.id, dmg, attacker: W.player.id, weapon: weaponId, isHead });
  };
  // mirror local events out. Broadcast chests opened by ANYTHING simulated locally
  // (own player + the host's bots) — matches the pickup handler below. The old
  // `a === W.player` guard dropped host-bot opens, so guest clients kept those
  // chests interactable (loot beam + re-open) and the shared world diverged.
  // Replayed opens (loot.js netOpenChest) pass a=null → filtered by the `a &&` guard.
  W.events.on("chestOpened", (a, c) => { if (S && a && !a.netRemote) send("chest", { id: c.id }); });
  // pickups by anything simulated locally (own player + host's bots) despawn everywhere
  W.events.on("pickedUp", (a, data, id) => { if (S && a && !a.netRemote) send("take", { id }); });
  W.events.on("netDropItem", (d) => { if (S) send("drop", d); });
  W.events.on("actorDied", (victim, killerId, weaponId) => {
    if (!S) return;
    // own death, or a host-simulated bot's death → tell everyone
    if (victim === W.player || (S.net.isHost() && victim.isBot && !victim.netRemote)) {
      send("died", { slot: victim.id, killer: killerId, weapon: weaponId });
    }
  });
}

function isAuthority(W) { return S && S.net.isHost(); }
function send(t, d) { if (S) S.net.send(t, d); }

// ── lobby UI ─────────────────────────────────────────────────────────────────
function openLobby(W, sel) {
  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "absolute", inset: "0", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(4,8,16,0.9)", pointerEvents: "auto", fontFamily: "system-ui, sans-serif", color: "#eaf2ff",
  });
  W.kernel.parent.appendChild(root);
  const box = document.createElement("div");
  Object.assign(box.style, { background: "rgba(10,19,31,0.95)", border: "1px solid rgba(120,180,255,0.25)", borderRadius: "14px", padding: "30px 40px", textAlign: "center", minWidth: "380px" });
  root.appendChild(box);
  const html = (s) => { const d = document.createElement("div"); d.innerHTML = s; box.appendChild(d); return d; };
  html(`<div style="font-size:22px;font-weight:900;letter-spacing:2px;margin-bottom:14px">PLAY WITH FRIENDS</div>`);
  const status = html(`<div style="font-size:13px;opacity:.75;margin-bottom:14px">Create a room or join a friend's code. Everyone else stays a bot.</div>`);
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "10px", justifyContent: "center", marginBottom: "12px" });
  box.appendChild(row);
  const mk = (label, primary) => {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, { padding: "10px 22px", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: "800", fontSize: "14px", background: primary ? "#57b0ff" : "rgba(255,255,255,0.12)", color: primary ? "#fff" : "#cfe4ff" });
    row.appendChild(b);
    return b;
  };
  const createB = mk("CREATE ROOM", true);
  const codeInp = document.createElement("input");
  Object.assign(codeInp.style, { padding: "10px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.4)", color: "#fff", width: "90px", textAlign: "center", fontWeight: "800", letterSpacing: "2px" });
  codeInp.placeholder = "CODE";
  codeInp.maxLength = 8;
  row.appendChild(codeInp);
  const joinB = mk("JOIN", false);
  const closeB = mk("CANCEL", false);
  closeB.onclick = () => { if (S) { S.net.leave(); S = null; W.net = null; } root.remove(); };

  const startB = document.createElement("button");
  startB.textContent = "START MATCH";
  Object.assign(startB.style, { padding: "12px 34px", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: "900", fontSize: "16px", background: "#4ade80", color: "#08131f", display: "none", marginTop: "6px" });
  box.appendChild(startB);

  async function enter(code, asHost) {
    createB.disabled = joinB.disabled = true;
    status.textContent = "Connecting…";
    const net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, "last-circle");
    // distinct default names online — two "You"s in one lobby is confusing
    const myName = (W.settings.playerName && W.settings.playerName !== "You")
      ? W.settings.playerName
      : "Player-" + net.id.slice(-3).toUpperCase();
    S = { net, peers: {}, myName, started: false, lastState: 0, lastBots: 0, root };
    W.net = S;
    net.on("msg", (m) => onMsg(W, m));
    net.on("peer", ({ count }) => {
      status.innerHTML = `Room <b style="letter-spacing:3px">${net.room}</b> — ${Math.max(1, count)} player(s) connected` +
        (net.isHost() ? "" : "<br>Waiting for the host to start…");
      if (net.isHost()) startB.style.display = count >= 1 ? "inline-block" : "none";
    });
    await net.joinRoom(code, asHost);
    send("hello", { name: S.myName });
    status.innerHTML = `Room <b style="letter-spacing:3px">${net.room}</b> — share this code.` + (asHost ? "" : "<br>Waiting for the host to start…");
    if (net.isHost()) startB.style.display = "inline-block";
  }

  createB.onclick = () => enter(randCode(), true);
  joinB.onclick = () => { if (codeInp.value.trim()) enter(codeInp.value.trim(), false); };

  startB.onclick = () => {
    if (!S) return;
    // roster: host = slot 0; peers by sorted id = slots 1..k
    const ids = Object.keys(S.peers).sort();
    const roster = [{ peerId: S.net.id, slot: 0, name: S.myName }];
    ids.forEach((pid, i) => roster.push({ peerId: pid, slot: i + 1, name: S.peers[pid] || "Friend" }));
    const cfg = { seed: (Math.random() * 0xffffffff) >>> 0, mapId: W.randomMap(), mode: sel.mode === "practice" ? "standard" : sel.mode, roster };
    send("start", cfg);
    root.remove();
    beginOnlineMatch(W, cfg);
  };
}

function randCode() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

window.addEventListener("beforeunload", () => {
  try { if (S && S.started && S.mySlot != null) S.net.send("bye", { slot: "s" + S.mySlot }); } catch (e) {}
});

function beginOnlineMatch(W, cfg) {
  const me = cfg.roster.find((r) => r.peerId === S.net.id);
  const humans = cfg.roster.map((r) => ({ slot: r.slot, name: r.name, self: r.peerId === S.net.id }));
  S.cfg = cfg;
  S.mySlot = me ? me.slot : 0;
  S.started = true;
  window.__LC__.startMatch({ mapId: cfg.mapId, mode: cfg.mode, seed: cfg.seed, humans, guestOf: S.net.isHost() ? null : "host" });
}

// ── message handling ─────────────────────────────────────────────────────────
function onMsg(W, { from, t, d }) {
  if (!S) return;
  if (t === "hello") { S.peers[from] = d.name; return; }
  if (t === "start" && !S.started) {
    if (S.root) S.root.remove();
    beginOnlineMatch(W, d);
    return;
  }
  if (t === "state") {
    const a = W.actorById.get(d.id);
    if (a && a.netRemote) { applyRemoteState(W, a, d); S.lastSeen = S.lastSeen || {}; S.lastSeen[d.id] = performance.now(); }
    return;
  }
  if (t === "bots" && !S.net.isHost()) {
    for (const b of d.list) {
      const a = W.actorById.get(b.id);
      if (a && a.netRemote) applyRemoteState(W, a, b);
    }
    return;
  }
  if (t === "hitYou") {
    const victim = W.actorById.get(d.target);
    if (!victim) return;
    // I own this actor if it's me, or I'm the host and it's a live bot
    const mine = victim === W.player || (S.net.isHost() && victim.isBot && !victim.netRemote);
    if (mine && victim.alive) W.hurtActor(victim, d.dmg, d.attacker, d.weapon, d.isHead);
    return;
  }
  if (t === "drop") { W.netSpawnItem && W.netSpawnItem(d); return; }
  if (t === "chest") { W.netOpenChest(d.id); return; }
  if (t === "take") { W.netTakeItem(d.id); return; }
  if (t === "died") {
    const a = W.actorById.get(d.slot);
    if (a && a.alive) { a.hp = 0; a.shield = 0; W.killActor(a, d.killer, d.weapon); }
    return;
  }
  if (t === "bye") {
    // a guest left mid-match: host re-attaches a bot brain so the slot fights on
    const a = W.actorById.get(d.slot);
    if (a && a.alive && S.net.isHost() && a.netRemote) {
      a.netRemote = false; a.isBot = true;
      import("./bots.js" + (new URL(import.meta.url).search || "")).then((m) => m.attachBrain(W, a));
      send("takeover", { slot: a.id });
    }
    return;
  }
  if (t === "takeover") {
    const a = W.actorById.get(d.slot);
    if (a && W.player && a !== W.player) { a.netRemote = true; a.isBot = true; }
    return;
  }
  if (t === "sync" && !S.net.isHost()) {
    // late-join / drift correction from host
    W.t = d.t;
    for (const id of (d.loot && d.loot.taken) || []) W.netTakeItem(id);
    for (const id of (d.loot && d.loot.opened) || []) W.netOpenChest(id);
    return;
  }
}

function applyRemoteState(W, a, d) {
  if (!a.netTarget) a.netTarget = { pos: new W.THREE.Vector3(), yaw: 0 };
  a.netTarget.pos.set(d.x, d.y, d.z);
  a.netTarget.yaw = d.yw;
  a.hp = d.hp; a.shield = d.sh;
  a.gliding = !!d.gl;
  if (d.wp && (!a.weapon || a.weapon.id !== d.wp)) {
    a.weapon = { id: d.wp, rarity: 0, magAmmo: 0, state: "ready", cd: 0, reloadT: 0 };
  }
  if (!a.alive && d.hp > 0) return; // stale
}

// ── frame update: outbound state ─────────────────────────────────────────────
export function onMatchStart(W) {
  // host sends world sync for any guest that joined at the boundary
  if (S && S.net.isHost()) {
    send("sync", { t: W.t, loot: W.lootSyncState() });
  }
}

export function update(W, dt) {
  if (!S || !S.started || !W.player) return;
  const now = performance.now();
  // own state 12Hz
  if (now - S.lastState > 83) {
    S.lastState = now;
    const p = W.player;
    send("state", pack(p));
  }
  // host: silent-guest watchdog — no state for 12s mid-match → bot takes over
  if (S.net.isHost() && S.lastSeen && (W.phase === "match" || W.phase === "drop")) {
    for (const id in S.lastSeen) {
      if (now - S.lastSeen[id] > 12000) {
        delete S.lastSeen[id];
        onMsg(W, { from: "watchdog", t: "bye", d: { slot: id } });
      }
    }
  }
  // host: bot snapshots 10Hz (only bots near any human get full rate; far bots 2Hz)
  if (S.net.isHost() && now - S.lastBots > 100) {
    S.lastBots = now;
    S.botsTick = (S.botsTick || 0) + 1;
    const list = [];
    for (const a of W.actors) {
      if (!a.isBot || !a.alive || a.netRemote) continue;
      const far = a.pos.distanceToSquared(W.player.pos) > 300 * 300;
      if (far && S.botsTick % 5 !== 0) continue;
      list.push(pack(a));
      if (list.length >= 24) { send("bots", { list }); list.length = 0; }
    }
    if (list.length) send("bots", { list });
  }
}

function pack(a) {
  return {
    id: a.id,
    x: +a.pos.x.toFixed(2), y: +a.pos.y.toFixed(2), z: +a.pos.z.toFixed(2),
    yw: +a.yaw.toFixed(3), hp: Math.round(a.hp), sh: Math.round(a.shield),
    gl: a.gliding ? 1 : 0, wp: a.weapon ? a.weapon.id : null,
  };
}

/** called by weapons.js when a local shot hits a remote human */
export function reportHit(W, target, dmg, weaponId, isHead) {
  if (!S) return;
  send("hitYou", { target: target.id, dmg, attacker: W.player.id, weapon: weaponId, isHead });
}
