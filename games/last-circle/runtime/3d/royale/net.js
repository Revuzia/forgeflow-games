/**
 * royale/net.js — play-with-friends multiplayer over Supabase Realtime
 * (NetPlay transport — pure WebSocket relay, $0, no Postgres).
 *
 * Model: room code lobby, up to 4 humans. The old header said 8 and nothing
 * enforced any number — but Supabase Realtime bills one message per RECEIVING
 * subscriber, so a room of H humans costs H per send and total traffic grows
 * as H². At 8 humans the timer traffic alone is several times the free-project
 * 100 msg/s ceiling, and Realtime does not shed load at the cap, it DROPS THE
 * CONNECTION — i.e. the match ends in a disconnect. startB.onclick now
 * truncates the roster to host + 3 and the send rates below scale with H.
 *
 * The world is DETERMINISTIC from the shared seed (terrain, POIs, loot spawns,
 * chest contents, storm plan), so only live state is relayed:
 *   - each human simulates their OWN actor and broadcasts state at 12/8/6 Hz
 *     depending on how many humans are in the room
 *   - the HOST simulates all 49-minus-guests bots and broadcasts bot
 *     snapshots at 10Hz (guests render them as netRemote actors)
 *   - hits on a human are sent to the victim's client ("hitYou") — the victim
 *     applies damage to itself (client authority over own HP)
 *   - chest opens / item pickups / gunfire / emotes mirror as cosmetic events,
 *     batched into one "ev" envelope per 100 ms
 *   - eliminations mirror immediately (authoritative, never batched)
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
  // weapons.js routes hits on netRemote humans here (victim applies to itself).
  // `attackerId` is LAST so the old 4-arg call order still works. It exists
  // because this fires for everything simulated locally — on the host that is
  // all 46 bots, not just W.player — and the hardcoded `attacker: W.player.id`
  // credited the host personally for every bot bullet that landed on a guest:
  // wrong kill feed, wrong killer cam, wrong "eliminated by" on the death screen.
  W.reportRemoteHit = (target, dmg, weaponId, isHead, attackerId) => {
    if (S && W.player) send("hitYou", { target: target.id, dmg, attacker: attackerId || W.player.id, weapon: weaponId, isHead });
  };
  // mirror local events out. Broadcast chests opened by ANYTHING simulated locally
  // (own player + the host's bots) — matches the pickup handler below. The old
  // `a === W.player` guard dropped host-bot opens, so guest clients kept those
  // chests interactable (loot beam + re-open) and the shared world diverged.
  // Replayed opens (loot.js netOpenChest) pass a=null → filtered by the `a &&` guard.
  W.events.on("chestOpened", (a, c) => { if (S && a && !a.netRemote) qsend("chest", { id: c.id }); });
  // pickups by anything simulated locally (own player + host's bots) despawn everywhere
  W.events.on("pickedUp", (a, data, id) => { if (S && a && !a.netRemote) qsend("take", { id }); });
  // relay OUR gunfire so guests see remote muzzle flash + tracers and HEAR the shot
  // (remote actors aren't simulated locally, so their FX never fired online). Throttled
  // for full-auto. Replayed on the other clients via the "fire" case in onMsg.
  W.events.on("shotFired", (a, weaponId, muzzle, dir) => {
    if (!S || !a || a.netRemote || !W.player) return;
    // AUDIBILITY GATE. The 90 ms throttle below bounds one shooter to 11 sends/s
    // but nothing bounded how MANY shooters fire at once: on the host this ran
    // for all 46 bots, and a busy mid-game firefight in three POIs at once was
    // the single largest uncontrolled term in the outbound budget. Nobody can
    // see a muzzle flash or hear a shot 250 m away, so a shot no remote human is
    // near is pure spend. `eyes` mirrors the bot-snapshot construction below;
    // it always contains W.player.pos, so our OWN shots are never gated.
    const eyes = [W.player.pos];
    for (const h of W.actors) if (h.netRemote && !h.isBot && h.alive) eyes.push(h.netTarget ? h.netTarget.pos : h.pos);
    if (eyes.every((p) => a.pos.distanceToSquared(p) > 250 * 250)) return;
    const now = performance.now();
    if (now - (a._fireRelayT || 0) < 90) return;
    a._fireRelayT = now;
    qsend("fire", { id: a.id, w: weaponId, x: +muzzle.x.toFixed(2), y: +muzzle.y.toFixed(2), z: +muzzle.z.toFixed(2), dx: +dir.x.toFixed(3), dy: +dir.y.toFixed(3), dz: +dir.z.toFixed(3) });
  });
  // Emotes are the ONLY expressive act this game has and they were never
  // relayed — with no voice and no text chat, a friend waving at you across a
  // rooftop simply did not happen on their screen. Same shape as the gunfire
  // relay above: only things simulated locally are broadcast.
  W.events.on("emote", (a, kind) => { if (S && a && !a.netRemote) qsend("emote", { id: a.id, k: kind }); });
  W.events.on("netDropItem", (d) => { if (S) qsend("drop", d); });
  W.events.on("actorDied", (victim, killerId, weaponId) => {
    if (!S) return;
    // own death, or a host-simulated bot's death → tell everyone
    if (victim === W.player || (S.net.isHost() && victim.isBot && !victim.netRemote)) {
      send("died", { slot: victim.id, killer: killerId, weapon: weaponId });
    }
  });
  // INVITE DEEP LINK: ?room=CODE opens the lobby and joins straight away.
  // Getting a friend in used to mean reading four randCode() characters aloud.
  // The setTimeout is required, not cosmetic: init() runs at ffg_royale3d.js:90
  // but hudMod.showMenu(W, startMatch) runs synchronously at :384, so opening
  // the lobby inline would build it and then have the menu painted over it.
  try {
    const rc = new URLSearchParams(location.search).get("room");
    if (rc) setTimeout(() => W.events.emit("openOnline", { mode: "standard", room: rc.trim().toUpperCase() }), 0);
  } catch (e) {}
}

function isAuthority(W) { return S && S.net.isHost(); }

// Message types that must never be shed by the budget below: authoritative
// (someone's HP, someone's death, the roster) or latency-critical. `ev` is on
// the list because the ENVELOPE is not the right thing to drop — the flush in
// update() thins its contents first, so shedding never silently strands a
// pickup or a chest open inside a discarded envelope.
const CRITICAL_MSG = { state: 1, bots: 1, hitYou: 1, died: 1, start: 1, hello: 1, bye: 1, takeover: 1, sync: 1, ev: 1 };

/** OUTBOUND BUDGET, in messages per rolling second. Supabase Realtime does not
 *  throttle a connection that exceeds its rate — it DISCONNECTS it, which
 *  mid-match means the game simply ends for everyone in the room. So the load
 *  shedding has to live on this side, and it has to shed the cheap things: a
 *  missing tracer is invisible, a dropped socket is the match. 100 msg/s is the
 *  free-project ceiling and every send is billed once per receiving subscriber,
 *  hence 100/H. Returns the headroom left in the current window. */
function sendBudgetLeft() {
  if (!S) return 0;
  const now = performance.now();
  if (S.sendWinT == null || now - S.sendWinT >= 1000) { S.sendWinT = now; S.sendWinN = 0; }
  const H = Math.max(1, S.net.peerCount || 1);
  return Math.max(8, Math.floor(100 / H)) - (S.sendWinN || 0);
}

function send(t, d) {
  if (!S) return;
  if (sendBudgetLeft() <= 0 && !CRITICAL_MSG[t]) { S.droppedMsgs = (S.droppedMsgs || 0) + 1; return; }
  S.sendWinN = (S.sendWinN || 0) + 1;
  S.net.send(t, d);
}

/** Queue a COSMETIC event instead of sending it now. Five separate relays
 *  (fire/emote/take/chest/drop) each used to be its own message the instant it
 *  happened; a single loot run could fire six sends in one frame. update()
 *  flushes the queue as one "ev" envelope per 100 ms, so a burst costs 10
 *  messages a second instead of however many things happened. */
function qsend(t, d) {
  if (!S) return;
  if (!S.evQ) S.evQ = [];
  // hard ceiling so a pathological frame cannot grow one envelope without bound
  if (S.evQ.length >= 60) { S.droppedMsgs = (S.droppedMsgs || 0) + 1; return; }
  S.evQ.push({ t, d });
}

// ── lobby UI ─────────────────────────────────────────────────────────────────
function openLobby(W, sel) {
  // clickable overlay: pointer lock would send every click to the canvas
  try { document.exitPointerLock && document.exitPointerLock(); } catch (e) {}
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
  // game_controls.js:65 kills the context menu page-wide with capture:true, so a
  // player could not even right-click-copy the room code. Hidden until we are in
  // a room; both host and joined guest can share. Clipboard is a LOCAL API — no
  // network call is added by this.
  const inviteB = mk("COPY INVITE LINK", false);
  inviteB.style.display = "none";
  inviteB.onclick = async () => {
    // build off the CURRENT href so any params the portal put there survive
    let link = S.net.room;   // file:// etc: a URL would not be shareable, so hand over the bare code
    if (/^https?:$/.test(location.protocol)) {
      const u = new URL(location.href);
      u.searchParams.set("room", S.net.room);
      link = u.toString();
    }
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch (e) {}
    if (!ok) {
      // clipboard-write is denied outside a secure context; fall back to the
      // deprecated-but-universal path, then to a selection the player can copy
      try {
        const ta = document.createElement("textarea");
        ta.value = link; ta.style.position = "fixed"; ta.style.opacity = "0";
        root.appendChild(ta); ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch (e) {}
    }
    if (ok) inviteB.textContent = "LINK COPIED";
    else { codeInp.value = S.net.room; codeInp.select(); inviteB.textContent = "SELECT + CTRL-C"; }
    setTimeout(() => { inviteB.textContent = "COPY INVITE LINK"; }, 1600);
  };
  const closeB = mk("CANCEL", false);
  closeB.onclick = () => { if (S) { S.net.leave(); S = null; W.net = null; } root.remove(); };

  // Who is actually in the room. S.peers has held every peer's chosen name since
  // the "hello" handler shipped, but it was read in exactly ONE place — building
  // the roster at match start — so the lobby printed a bare count and never a
  // name, and you could not tell whether the "2 players" was your friend.
  // (rosterEl, not `roster` — startB.onclick below already owns that name for
  //  the roster ARRAY it ships in the start packet)
  const rosterEl = document.createElement("div");
  Object.assign(rosterEl.style, { fontSize: "13px", lineHeight: "1.6", margin: "2px 0 12px", minHeight: "22px", opacity: ".9" });
  box.appendChild(rosterEl);
  function paintRoster() {
    if (!S || !S.net.room) { rosterEl.innerHTML = ""; return; }
    // ffg_netplay.js:64 makes the LOWEST peer id the host, and startB.onclick
    // hands out slots by sorted peer id — so sorting every id (peers + self) on
    // any client reproduces the exact roster the host will build. No guessing.
    const all = Object.keys(S.peers).concat([S.net.id]).sort();
    const badge = (s) => `<span style="font-size:10px;letter-spacing:1px;opacity:.6;margin-left:6px">${s}</span>`;
    let h = "";
    all.forEach((pid, i) => {
      const me = pid === S.net.id;
      // names arrive from other machines — they go through esc() before innerHTML
      const nm = esc(me ? S.myName : (S.peers[pid] || "Friend"));
      if (i > MAX_GUESTS) { h += `<div style="color:#ffb060">${nm}${badge("SPECTATING — ROOM FULL")}</div>`; return; }
      h += `<div style="${me ? "color:#7fd3ff" : ""}">${me ? "<b>" + nm + "</b>" : nm}${badge(i === 0 ? "HOST" : "SLOT " + i)}</div>`;
    });
    rosterEl.innerHTML = h;
  }

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
    S.paintRoster = paintRoster;   // onMsg's "hello" handler repaints through this
    S.status = status;             // beginOnlineMatch reports a full room here
    W.net = S;
    net.on("msg", (m) => onMsg(W, m));
    net.on("peer", ({ count }) => {
      status.innerHTML = `Room <b style="letter-spacing:3px">${net.room}</b> — ${Math.max(1, count)} player(s) connected` +
        (net.isHost() ? "" : "<br>Waiting for the host to start…");
      if (net.isHost()) startB.style.display = count >= 1 ? "inline-block" : "none";
      paintRoster();
    });
    await net.joinRoom(code, asHost);
    send("hello", { name: S.myName });
    status.innerHTML = `Room <b style="letter-spacing:3px">${net.room}</b> — share this code.` + (asHost ? "" : "<br>Waiting for the host to start…");
    inviteB.style.display = "inline-block";
    paintRoster();
    if (net.isHost()) startB.style.display = "inline-block";
  }

  createB.onclick = () => enter(randCode(), true);
  joinB.onclick = () => { if (codeInp.value.trim()) enter(codeInp.value.trim(), false); };
  // arrived via ?room=CODE (see init): show the code we are joining, then join
  if (sel && sel.room) { codeInp.value = sel.room; enter(sel.room, false); }

  startB.onclick = () => {
    if (!S) return;
    // roster: host = slot 0; peers by sorted id = slots 1..k. TRUNCATED at
    // MAX_GUESTS: see the header — outbound traffic is O(H²) against a hard
    // 100 msg/s ceiling that Realtime enforces by dropping the connection.
    // START is deliberately NOT disabled past the cap: a 5th peer wandering in
    // would otherwise lock the host out of ever starting the match. The extras
    // stay in the room and are rejected by name in beginOnlineMatch.
    const ids = Object.keys(S.peers).sort().slice(0, MAX_GUESTS);
    const roster = [{ peerId: S.net.id, slot: 0, name: S.myName }];
    ids.forEach((pid, i) => roster.push({ peerId: pid, slot: i + 1, name: S.peers[pid] || "Friend" }));
    const cfg = { seed: (Math.random() * 0xffffffff) >>> 0, mapId: W.randomMap(), mode: sel.mode === "practice" ? "standard" : sel.mode, roster };
    send("start", cfg);
    if (beginOnlineMatch(W, cfg) !== false) root.remove();
  };
}

// host + 3 guests. Every extra human multiplies EVERY outbound message.
const MAX_GUESTS = 3;

/** Peer names are typed on someone else's machine and this file puts them in
 *  innerHTML — escape before they reach the DOM. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  if (!me) {
    // Not in the roster — the room hit MAX_GUESTS before we did. The old
    // `me ? me.slot : 0` fallback silently handed this client slot 0, which is
    // the HOST's own actor: two machines driving one body, each fighting the
    // other's lerp. Refuse instead, and say so in the lobby that is still open.
    if (S.status) S.status.innerHTML = `Room is full (${MAX_GUESTS + 1} players). This match started without you.`;
    return false;
  }
  const humans = cfg.roster.map((r) => ({ slot: r.slot, name: r.name, self: r.peerId === S.net.id }));
  S.cfg = cfg;
  S.mySlot = me ? me.slot : 0;
  S.started = true;
  window.__LC__.startMatch({ mapId: cfg.mapId, mode: cfg.mode, seed: cfg.seed, humans, guestOf: S.net.isHost() ? null : "host" });
}

// ── message handling ─────────────────────────────────────────────────────────
function onMsg(W, { from, t, d }) {
  if (!S) return;
  // batched cosmetic envelope (see qsend) — unwrap and dispatch in order.
  // A nested "ev" is skipped rather than recursed: we never send one, so it
  // could only ever be a malformed packet, and recursing on it is unbounded.
  if (t === "ev") { for (const m of d.list || []) if (m && m.t !== "ev") onMsg(W, { from, t: m.t, d: m.d }); return; }
  if (t === "hello") {
    // REPLY to a peer we had not seen. "hello" was broadcast once on join and
    // never replayed, so the third person to join learned nobody's name and the
    // two already in the room learned only theirs. Bounded — the reply fires
    // only for a first sighting, and everyone already in the room has us.
    const known = !!S.peers[from];
    S.peers[from] = d.name;
    if (!known) send("hello", { name: S.myName });
    if (S.paintRoster) S.paintRoster();
    return;
  }
  if (t === "start" && !S.started) {
    // remove the lobby only if we actually got a slot — beginOnlineMatch writes
    // the "room is full" message into the lobby that is still on screen
    if (beginOnlineMatch(W, d) !== false && S && S.root) S.root.remove();
    return;
  }
  if (t === "state") {
    const a = W.actorById.get(d.id);
    if (a && a.netRemote) { applyRemoteState(W, a, d); S.lastSeen = S.lastSeen || {}; S.lastSeen[d.id] = performance.now(); }
    // OUTSIDE the actor guard on purpose: the match clock rides the host's own
    // state packet, and a packet whose actor has not been created yet (or has
    // been removed) must still deliver the clock.
    if (d.t != null && !S.net.isHost()) {
      slewClock(W, d.t);
      // Only the HOST's state packet carries the match clock, so this line
      // doubles as host identification — the one fact the guest-side watchdog
      // below needs and previously had nowhere to learn.
      S.hostSlot = d.id;
      S.hostSeen = performance.now();
    }
    return;
  }
  if (t === "bots" && !S.net.isHost()) {
    S.hostSeen = performance.now();          // bot snapshots only ever come from the host
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
  if (t === "fire") {
    // a remote-owned actor fired — replay the cosmetic FX locally (muzzle flash +
    // gunfire indicator + positional gunshot via shotFired, plus a flying tracer).
    // No damage here (that's the authoritative hitYou path); this is FX only.
    const a = W.actorById.get(d.id);
    if (!a || !a.netRemote) return;
    // weapons.js:453 stamps this on the LOCAL fire path only, and player.js:952
    // reads `W.t - a.lastShotT < 1.5` to decide the combat stance. Without it a
    // remote actor shooting at you kept turning to face its run direction and
    // held the relaxed lowReady arm pose (player.js:1028) with the gun down.
    a.lastShotT = W.t;
    const dir = { x: d.dx, y: d.dy, z: d.dz };
    W.events.emit("shotFired", a, d.w, { x: d.x, y: d.y, z: d.z }, dir);
    W.events.emit("tracer", { x: d.x, y: d.y, z: d.z, vx: d.dx * 180, vy: d.dy * 180, vz: d.dz * 180, weaponId: d.w });
    return;
  }
  if (t === "emote") {
    const a = W.actorById.get(d.id);
    if (a && a.netRemote && a.alive) W.playRemoteEmote && W.playRemoteEmote(a, d.k);
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
    // the HOST left mid-match: this bye used to be silently ignored by guests
    // (the branch above is host-only), stranding them in a frozen world — all
    // ~46 host-simulated bots stop at their last lerp target, the clock stops,
    // and nothing on screen says why. A clean host exit now converts the match
    // immediately instead of waiting for the 8s watchdog.
    if (!S.net.isHost() && S.hostSlot && d.slot === S.hostSlot &&
        (W.phase === "match" || W.phase === "drop")) hostLost(W);
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
  // STALE-PACKET GUARD, moved from the bottom of this function to the top. It
  // used to run after every field had already been written, so it guarded
  // nothing: a packet still in flight when the actor died dragged the corpse
  // across the ground and refilled its HP bar. Now it drops the packet.
  if (!a.alive && d.hp > 0) return;
  if (!a.netTarget) a.netTarget = { pos: new W.THREE.Vector3(), yaw: 0 };
  a.netTarget.pos.set(d.x, d.y, d.z);
  a.netTarget.yaw = d.yw;
  a.hp = d.hp; a.shield = d.sh;
  a.gliding = !!d.gl;
  // STANCE. player.js drives the whole remote body off fields that only
  // stepActor ever wrote, and stepActor does not run for a netRemote actor — so
  // every peer and (on a guest) every bot was frozen at createActor's defaults:
  // never crouching (:995 picks the crouch clip off a.crouching), never swimming
  // (:993), never reloading (:1027 reads a.weapon.state), never aiming (:952),
  // and pitch 0 forever so :1040's applyArmPose held the gun dead level no
  // matter where the shooter was actually looking.
  a.pitch = d.pt || 0;
  const f = d.f | 0;
  a.crouching = !!(f & 1);
  a.input.ads = !!(f & 2);
  a.swimming = !!(f & 8);
  a.netChute = !!(f & 16);   // canopy vs freefall; player.js owns the mesh
  if (d.wp && (!a.weapon || a.weapon.id !== d.wp)) {
    a.weapon = { id: d.wp, rarity: 0, magAmmo: 0, state: (f & 4) ? "reloading" : "ready", cd: 0, reloadT: 0 };
    // remotes never pass through equipSlot, so without this their rendered gun
    // stayed the SPAWN PISTOL all match while a.weapon.id advanced — every peer
    // and, on a guest, all ~45 host-driven bots (adversarial review finding).
    // Also keeps the support-hand foregrip measure coherent: it gates on the
    // mesh's wid stamp, which only this refresh updates.
    if (W.refreshWeaponMesh) W.refreshWeaponMesh(a);
  } else if (a.weapon) {
    a.weapon.state = (f & 4) ? "reloading" : "ready";
  }
}

/** Slew this client's match clock toward the host's. Rate-limited rather than
 *  snapped: at 12 packets/s the 0.05 s clamp buys 0.6 s of catch-up per second,
 *  so a one-second error closes in under two seconds and the storm wall never
 *  visibly jumps. The >3 s escape hatch covers a BACKGROUNDED TAB — rAF throttles
 *  to ~1 Hz while ffg_royale3d.js:364 caps each step at Math.min(dt, 0.05), so
 *  that clock falls behind without bound and could never slew back.
 *  A backward correction across a phase boundary can re-emit stormPhase once
 *  (storm.js:99-103); at 0.05 s granularity that is a duplicate warning, nothing
 *  more. Worth it: storm.stateAt(W.t) (storm.js:72) is what puts the wall on
 *  screen and storm damage is applied locally by each client to its own actors
 *  (storm.js:111-140), so a free-running clock means two players disagree about
 *  where the wall is and one takes damage the other believes is impossible. */
function slewClock(W, hostT) {
  const err = hostT - W.t;
  if (Math.abs(err) > 3) { W.t = hostT; return; }
  W.t += Math.max(-0.05, Math.min(0.05, err * 0.25));
}

// ── frame update: outbound state ─────────────────────────────────────────────
/** Tear the session down. W.net/S were cleared in exactly ONE place — the lobby
 *  CANCEL button — so after a single online match every subsequent OFFLINE match
 *  kept broadcasting 12 Hz player state and 10 Hz bot snapshots into the dead
 *  room, replaying phantom kills against deterministic s0..s49 ids that collide
 *  by construction. Worse for solo players: togglePause reads !!W.net, so ESC
 *  stopped pausing offline matches for the rest of the page session.
 *  Called on MAIN MENU rather than inside endMatch, so a future REMATCH can
 *  still reuse the room. */
/** The host is gone (clean bye, crash, or dead socket): convert the match to a
 *  LOCAL CONTINUATION rather than stranding the guest in a frozen world. Every
 *  client runs the full simulation — netRemote actors merely follow snapshots —
 *  so recovery is: hand every remote actor a bot brain, drop the dead link, and
 *  tell the player what happened. The match stays winnable; XP still counts. */
export function hostLost(W) {
  if (!S || S._hostLostRan) return;
  S._hostLostRan = true;
  let converted = 0;
  for (const a of W.actors) {
    if (a.netRemote && a !== W.player) {
      a.netRemote = false; a.isBot = true;
      import("./bots.js" + (new URL(import.meta.url).search || "")).then((m) => m.attachBrain(W, a));
      converted++;
    }
  }
  try { S.net && S.net.leave && S.net.leave(); } catch (e) {}
  W.net = null;                                 // frame gates (hitstop etc.) read this
  W.events.emit("hostLost", converted);
  console.warn(`[net] host lost — converted ${converted} remote actors to bots, continuing offline`);
}

export function leave(W) {
  if (S) {
    try { S.net.leave(); } catch (e) {}
    S = null;
  }
  W.net = null;
}

export function onMatchStart(W) {
  // host sends world sync for any guest that joined at the boundary
  if (S && S.net.isHost()) {
    send("sync", { t: W.t, loot: W.lootSyncState() });
  }
}

export function update(W, dt) {
  if (!S || !S.started || !W.player) return;
  const now = performance.now();
  // OWN STATE, rate scaled by room size. Every send is billed once per receiving
  // subscriber, so H humans at 12 Hz cost 12·H·H messages/s: 48 for a pair but
  // 192 for four, against a 100 msg/s ceiling shared with every other ForgeFlow
  // title. 12/8/6 Hz keeps the state term at 48/72/96. The interpolation
  // constant has to follow the rate or a 6 Hz peer smears — player.js's
  // interpRemote reads W._netLerpK when it is set (default 10 ≈ 12 Hz).
  const H = Math.max(1, S.net.peerCount || 1);
  const stateMs = H <= 2 ? 83 : H === 3 ? 125 : 166;
  W._netLerpK = Math.max(4, 800 / stateMs);
  if (now - S.lastState > stateMs) {
    S.lastState = now;
    const st = pack(W.player);
    // MATCH CLOCK rides the packet that already goes out — zero extra messages.
    // W.t starts at 0 per client (ffg_royale3d.js:218) and free-runs at :366;
    // the only other carrier of `t` is the one-shot "sync" from onMatchStart,
    // so across the 735 s of a standard match the clients drift apart without
    // limit and each one draws the storm somewhere else. Host stamps, guests slew.
    if (S.net.isHost()) st.t = +W.t.toFixed(2);
    send("state", st);
  }
  // FLUSH the batched cosmetic events (see qsend), 10 Hz.
  if (S.evQ && S.evQ.length && now - (S.lastEv || 0) >= 100) {
    S.lastEv = now;
    let list = S.evQ;
    S.evQ = [];
    if (sendBudgetLeft() <= 0) {
      // Over budget. Shed the PURE-FX half and keep the world-state half: a
      // missing tracer or emote is invisible a second later, but a missing
      // "take"/"chest"/"drop" leaves a ghost item every other client can still
      // see and try to pick up. This is the whole point of the budget — Supabase
      // answers an over-rate connection by dropping it, so if something has to
      // go it must be chosen here rather than by the socket dying mid-match.
      const kept = list.filter((m) => m.t !== "fire" && m.t !== "emote");
      S.droppedMsgs = (S.droppedMsgs || 0) + (list.length - kept.length);
      list = kept;
    }
    if (list.length) send("ev", { list });
  }
  // link freshness for the HUD perf readout: age of the most recent state we
  // received from ANY peer. Not RTT — the HUD labels it SYNC, not ping.
  if (S.lastSeen) {
    let freshest = null;
    for (const id in S.lastSeen) {
      const age = now - S.lastSeen[id];
      if (freshest == null || age < freshest) freshest = age;
    }
    W._netStats = W._netStats || {};
    W._netStats.lastSeenAgeMs = freshest;
    W._netStats.peers = Object.keys(S.lastSeen).length;
    W._netStats.dropped = S.droppedMsgs || 0;   // shed by the outbound budget, not lost in transit
  }
  // guest: silent-HOST watchdog. The host-side guest watchdog below has existed
  // all along, but nothing watched the other direction — a host tab closing,
  // crashing, or losing its socket left guests in a dead match forever. The
  // host feeds guests at 12Hz (state) + 10Hz (bots); 8s of silence is ~100
  // missed packets, far past any transient. This also covers the channel-error
  // path with no extra API surface: an errored socket delivers nothing, so the
  // watchdog fires 8s later.
  if (!S.net.isHost() && S.started && S.hostSeen &&
      (W.phase === "match" || W.phase === "drop") &&
      now - S.hostSeen > 8000) {
    hostLost(W);
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
  // The outbound budget cannot shed state/bots/hitYou/died (all CRITICAL), so
  // at 4 humans a busy host is billed x3 receivers and can breach Supabase's
  // 100 msg/s ceiling — which drops the connection, the exact failure the
  // budget exists to prevent. Scale the bot-snapshot interval with the human
  // count instead: 10Hz solo-guest, 8Hz at 3, 6.25Hz at 4. interpRemote already
  // follows the actual snapshot cadence rather than a hardcoded rate, so guests
  // adapt automatically.
  const _humans = 1 + (S.lastSeen ? Object.keys(S.lastSeen).length : 0);
  const _botsMs = _humans >= 4 ? 160 : _humans === 3 ? 125 : 100;
  if (S.net.isHost() && now - S.lastBots > _botsMs) {
    S.lastBots = now;
    S.botsTick = (S.botsTick || 0) + 1;
    // "near a human" used to mean near W.player.pos — which on the host is the
    // HOST's own actor. A guest fighting a bot on the far side of the map got
    // that bot at 2 Hz, i.e. a lerp target up to 500 ms stale, and their hit
    // tests resolve against the rendered position. Measure from every live human
    // instead: at most 7 extra distanceToSquared per bot, and the worst case is
    // only a higher outbound rate (the 24-per-message chunking below caps size).
    const eyes = [W.player.pos];
    for (const h of W.actors) if (h.netRemote && !h.isBot && h.alive) eyes.push(h.netTarget ? h.netTarget.pos : h.pos);
    const list = [];
    for (const a of W.actors) {
      if (!a.isBot || !a.alive || a.netRemote) continue;
      const far = eyes.every((p) => a.pos.distanceToSquared(p) > 300 * 300);
      if (far && S.botsTick % 5 !== 0) continue;
      list.push(pack(a));
      if (list.length >= 24) { send("bots", { list }); list.length = 0; }
    }
    if (list.length) send("bots", { list });
  }
}

/** Used for the local player AND (on the host) for every bot, so one packet
 *  shape covers both. `pt` + the `f` stance byte cost ~18 bytes on a packet
 *  that already carries three float coordinates — see applyRemoteState for what
 *  player.js does with them and what it did without them. */
function pack(a) {
  return {
    id: a.id,
    x: +a.pos.x.toFixed(2), y: +a.pos.y.toFixed(2), z: +a.pos.z.toFixed(2),
    yw: +a.yaw.toFixed(3), pt: +a.pitch.toFixed(2),
    hp: Math.round(a.hp), sh: Math.round(a.shield),
    gl: a.gliding ? 1 : 0, wp: a.weapon ? a.weapon.id : null,
    f: (a.crouching ? 1 : 0) | (a.input.ads ? 2 : 0) |
       (a.weapon && a.weapon.state === "reloading" ? 4 : 0) |
       (a.swimming ? 8 : 0) | (a.chute ? 16 : 0),
  };
}
