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
 *   - each human simulates their OWN actor and broadcasts state at 12/8/5 Hz
 *     depending on how many humans are in the room
 *   - the HOST simulates all 49-minus-guests bots; snapshots (10/8/6.25 Hz)
 *     ride the host's state packet (guests render them as netRemote actors)
 *   - hits on a human are sent to the victim's client ("hitYou") — the victim
 *     applies damage to itself (client authority over own HP)
 *   - chest opens / item pickups / gunfire / emotes mirror as cosmetic events,
 *     batched and RIDING THE STATE PACKET (envelope merge — one billed message
 *     per client per state tick carries state + evs + [host] bot snapshots)
 *   - eliminations mirror immediately (authoritative, never batched)
 *
 * JOIN = TAKE OVER A BOT SLOT: humans occupy slots s0..sK (sorted by peer id,
 * host = s0); every other slot keeps its bot. A guest joining the lobby simply
 * claims the next slot before match start; when a guest disconnects mid-match
 * the host re-attaches a bot brain to that slot — the actor keeps fighting.
 *
 * VERSION GUARD (contract C-VER, Wave 7 lane 7C). The world is rebuilt on every
 * client from the shared seed, so two clients whose WORLD GENERATORS differ
 * (maps.js MAP_GEN_VERSION) build different ground, colliders and towns from the
 * same seed — remote players float, sink or stand in walls. The handshake now
 * carries that version:
 *   hello  { name, gv, host }   gv = the sender's MAP_GEN_VERSION, host = 1 for the room's creator
 *   start  { ..., gv }          the host's version, next to the seed
 *   refuse { gv, hostGv, name } a guest that would not build the host's world says so
 * A peer that sends no `gv` (every build before this one) is version 1. Same
 * version -> everything below is exactly as before. A guest that differs REFUSES
 * the room (on-screen message, RELOAD button when its own page is the stale one)
 * and the host is told why; the host also leaves a mismatched peer out of the
 * roster, so no slot is ever handed to a client that would build another world.
 * The pure decisions live in SquadHandshake / judgeGv (selftest: net.selftest.cjs);
 * the DOM and the sends stay in the lobby code below.
 *
 * MAP FALLBACK (contract C-FALLBACK, Wave 7 completion round, lane D1). The handshake above compares the version a page ADVERTISES (the
 * MAP_GEN_VERSION export, read in the lobby before any map exists). A page whose towngen.js / citykit.js failed to import twice builds the
 * Wave-6 Savanna layout instead (maps.js says so: W.mapFallback = { from, to, reason }, map.genVersion = the version it really built, and a
 * "mapFallback" event on W.events), so it holds a different world than the one it advertised. Such a client must not take part in a squad:
 *   - when its match goes live (onMatchStart: the first moment actors and the HUD exist) it LEAVES the room - a "mapfail" message (name, the two
 *     versions, the reason) and the old-style "bye" for its slot go out, its remote actors become bots (the hostLost conversion) and W.net is
 *     cleared, so the match carries on as a SOLO match on the layout it really has - and shows a card on screen: "Part of the map failed to
 *     load ... reload the page" (RELOAD PAGE / KEEP PLAYING);
 *   - the rest of the room reads why (a lobby line / the HUD chat log); the host turns the leaver's body into a bot; if the leaver was the HOST
 *     the guests continue offline exactly as when a host disconnects (hostLost) and are told why;
 *   - a solo match (no squad session) is untouched; a squad whose members all built the same world is untouched.
 * The fallback is found three ways, whichever maps.js provides: the "mapFallback" event (while this session's match loads), W.mapFallback /
 * map.fallback, and the built map's genVersion differing from the advertised one. Pure parts: normFallback / judgeFallback / fallbackLine /
 * detectMapFallback / SquadHandshake.onMapFail (selftest); the browser proof is _harness/squadguard_live.py case "fallback".
 */
import { NetPlay } from "../../net/ffg_netplay.js";
import { RTCMesh } from "../../net/ffg_rtc.js";

const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

let S = null; // session

// ── VERSION GUARD: pure part ─────────────────────────────────────────────────
// IMPORTANT: every royale module is loaded with the SAME ?v= query as the boot module (ffg_royale3d.js `const V = ...`). A bare
// "./maps.js" from here would be a SECOND instance of maps.js (and a stale one after an in-place edit); with the query it is the
// instance the boot already loaded - no new fetch. The same query is used for bots.js below.
const V = new URL(import.meta.url).search;

/** A world-generator version as a positive integer. Anything that is not one (a missing field - every build before the guard -, a
 *  string, NaN, a negative) is version 1. */
export function normGv(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 9999 ? v : 1;
}

/** null when the two versions agree, else what the mismatch means for THIS side (`local`). */
export function judgeGv(local, remote) {
  const l = normGv(local), r = normGv(remote);
  if (l === r) return null;
  const mineOlder = l < r;
  return {
    local: l, remote: r, mineOlder,
    title: mineOlder ? "Your game is out of date" : "The host's game is out of date",
    detail: mineOlder
      ? `This room runs game version ${r}; this page is on version ${l}. Reload the page to update, then join again.`
      : `This room runs game version ${r}; this page is on version ${l}. Ask the host to reload their page, then join again.`,
    reload: mineOlder,
  };
}

/** The line the HOST reads when a guest refused: who, which versions, and who has to reload. */
export function refusalLine(name, guestGv, hostGv) {
  const nm = String(name == null || name === "" ? "A player" : name).slice(0, 24);
  const g = normGv(guestGv), h = normGv(hostGv);
  return g < h
    ? `${nm} could not join: their game is out of date (version ${g}, this room runs version ${h}). They need to reload the page.`
    : `${nm} could not join: your game is out of date (they run version ${g}, this room runs version ${h}). Reload this page, then start a new room.`;
}

/** The line the HOST reads about a peer it left out of the roster (its hello said another version). */
export function leftOutLine(name, peerGv, hostGv) {
  const nm = String(name == null || name === "" ? "A player" : name).slice(0, 24);
  const g = normGv(peerGv), h = normGv(hostGv);
  return g < h
    ? `${nm} is not in this match: their game is out of date (version ${g}, this room runs version ${h}). A bot has their place; they need to reload the page.`
    : `${nm} is not in this match: this room runs version ${h} and they run version ${g}. A bot has their place; reload this page to match them.`;
}

// ── MAP FALLBACK: pure part (contract C-FALLBACK) ─────────────────────────────────────────────────────────────────────────────────────────
/** The fallback record from either shape maps.js uses - the contract's W.mapFallback { from, to, reason } or the event / map.fallback
 *  { genVersion, wanted, reason } - as { wanted, built, reason } (a version is null when the record has none). null when `x` is not an object. */
export function normFallback(x) {
  if (!x || typeof x !== "object") return null;
  const ver = (v) => (typeof v === "number" && Number.isFinite(v) ? normGv(v) : null);
  const wanted = ver(x.from) != null ? ver(x.from) : ver(x.wanted);
  const built = ver(x.to) != null ? ver(x.to) : ver(x.genVersion);
  return { wanted, built, reason: String(x.reason == null ? "" : x.reason).slice(0, 200) };
}

/** What a page tells ITS OWN player when it holds another world than the one it advertised (`fb` = a normFallback result). */
export function judgeFallback(localGv, fb) {
  const l = normGv(localGv);
  return {
    local: l, wanted: fb && fb.wanted != null ? fb.wanted : l, built: fb && fb.built != null ? fb.built : null, reason: fb && fb.reason ? fb.reason : "",
    title: "Part of the map failed to load",
    detail: "This page could not load the whole map, so it would play a different world from the rest of the squad. You have left the room and this match carries on solo. Reload the page to fix it, then join again.",
    reload: true,
  };
}

/** The line the ROOM reads when a squad-mate left because its map fell back. `host`: the leaver was the room's host. */
export function fallbackLine(name, host) {
  const nm = String(name == null || name === "" ? "A player" : name).slice(0, 24);
  return host
    ? `${nm} (the host) had to leave: part of their map failed to load, so they would have played a different world. The match carries on offline.`
    : `${nm} left the squad: part of their map failed to load, so they would have played a different world. A bot has their place; they need to reload the page.`;
}

/** Does the world this page BUILT differ from the one it advertised? `advertised` = the MAP_GEN_VERSION it sent in its hello, `seen` = what the
 *  "mapFallback" event delivered while THIS session's match was loading (fresh by construction). Returns { wanted, built, reason, via } or null.
 *  Found by (in this order) the event, map.fallback, the built map's genVersion differing from the advertised one, and W.mapFallback - which is
 *  trusted only when the built map does not contradict it (a record left by an EARLIER match on this page must not make a healthy map look like
 *  a fallback: a map that says it is the advertised version and carries no .fallback is healthy). */
export function detectMapFallback(W, advertised, seen) {
  const adv = normGv(advertised);
  const map = W && W.map ? W.map : null;
  const mapGv = map && map.genVersion != null ? normGv(map.genVersion) : null;
  if (seen) return Object.assign({ via: "event" }, seen);
  const mf = map && map.fallback ? normFallback(map.fallback) : null;
  if (mf) return Object.assign({ via: "map.fallback" }, mf);
  if (mapGv != null && mapGv !== adv) return { wanted: adv, built: mapGv, reason: "the built map is version " + mapGv + ", this page advertised " + adv, via: "genVersion" };
  const wf = W ? normFallback(W.mapFallback) : null;
  if (wf && mapGv == null) return Object.assign({ via: "W.mapFallback" }, wf);
  return null;
}

/** The pure half of the squad handshake: who is in the room at which world version, who may get a slot, what a guest does with a start
 *  message. net.js feeds it the messages and does the sending / painting; net.selftest.cjs drives two of these through an in-memory bus. */
export class SquadHandshake {
  constructor({ id, name, gv, host }) {
    this.id = id; this.name = name; this.gv = normGv(gv); this.host = !!host;
    this.peers = new Map();            // peer id -> { name, gv, host }
  }
  /** the body of our "hello" */
  helloMsg() { return { name: this.name, gv: this.gv, host: this.host ? 1 : 0 }; }
  /** a "hello" arrived. `first`: we had not seen this peer. `refuseNow`: set when WE are a guest and the peer is the room's host
   *  (it said so) on another version - leave at once instead of waiting for START. */
  onHello(from, d) {
    d = d || {};
    const first = !this.peers.has(from);
    const rec = { name: d.name, gv: normGv(d.gv), host: d.host === 1 || d.host === true };
    this.peers.set(from, rec);
    const mismatch = judgeGv(this.gv, rec.gv);
    return { first, rec, mismatch, refuseNow: !this.host && rec.host ? mismatch : null };
  }
  /** a peer's version (a peer that never said hello is version 1) */
  gvOf(id) { const r = this.peers.get(id); return r ? r.gv : 1; }
  /** HOST: the start roster from `names` (peer id -> name). Peers on another version are LEFT OUT (`left`), the rest are sorted by id and
   *  cut at `maxGuests` (`over`: stay in the room, told "room is full"). Host = slot 0. */
  planStart(names, maxGuests) {
    const roster = [{ peerId: this.id, slot: 0, name: this.name }];
    const left = [], over = [];
    for (const pid of Object.keys(names).sort()) {
      const gv = this.gvOf(pid), nm = names[pid] || "Friend";
      if (gv !== this.gv) { left.push({ peerId: pid, name: nm, gv }); continue; }
      if (roster.length - 1 >= maxGuests) { over.push({ peerId: pid, name: nm }); continue; }
      roster.push({ peerId: pid, slot: roster.length, name: nm });
    }
    return { roster, left, over };
  }
  /** HOST: the "start" message for `cfg` (seed, map, mode, roster) */
  startMsg(cfg) { return Object.assign({}, cfg, { gv: this.gv }); }
  /** GUEST: judge a "start" message. null = same world, go. Else the judgement plus `slot`: the slot an OLD host (no guard) gave us in
   *  its roster, so the refusal can free it ("bye") instead of leaving a frozen remote body in the host's match. */
  judgeStart(d) {
    const j = judgeGv(this.gv, d ? d.gv : undefined);
    if (!j) return null;
    const me = d && Array.isArray(d.roster) ? d.roster.find((r) => r && r.peerId === this.id) : null;
    return Object.assign({ slot: me && me.slot != null ? me.slot : null }, j);
  }
  /** A "mapfail" arrived: a peer left because its map fell back (C-FALLBACK). `roster` = the match's roster ([{ peerId, slot, name }]). null when
   *  the sender is not in this match (nothing to free, nothing to tell). The slot, the name and "is it the host" (slot 0) come from the ROSTER,
   *  never from the message body: any peer can send anything, and a body must not be able to kick somebody else's slot. */
  onMapFail(from, d, roster) {
    const me = Array.isArray(roster) ? roster.find((r) => r && r.peerId === from) : null;
    if (!me || typeof me.slot !== "number") return null;
    const host = me.slot === 0;
    const fb = normFallback({ from: d && d.wanted, to: d && d.built, reason: d && d.reason });
    return { from, slot: me.slot, id: "s" + me.slot, name: me.name, host, wanted: fb.wanted, built: fb.built, reason: fb.reason, line: fallbackLine(me.name, host) };
  }
}

let _localGv = null, _localGvP = null;
/** This page's MAP_GEN_VERSION: the export of maps.js, read through the already-loaded module (same ?v= as the boot, so no fetch). A
 *  maps.js without the export is version 1. A failed import (it cannot be, the boot needed the module) is 1 for this call and is NOT
 *  cached, so a later lobby retries. */
function localGenVersion() {
  if (_localGv != null) return Promise.resolve(_localGv);
  if (!_localGvP) {
    _localGvP = import("./maps.js" + V).then(
      (m) => (_localGv = normGv(m && m.MAP_GEN_VERSION)),
      (e) => { console.warn("[net] could not read MAP_GEN_VERSION from maps.js:", e); _localGvP = null; return 1; });
  }
  return _localGvP;
}

export function init(W) {
  W.net = null;
  localGenVersion();   // warm: the lobby needs the number the moment it opens (an already-loaded module, so this is instant)
  W.events.on("openOnline", (sel) => openLobby(W, sel));
  // C-FALLBACK: maps.js says, while this match's map is being built, that part of it failed to load (towngen.js / citykit.js). A squad session notes it
  // and acts when the match goes live (onMatchStart / update); with no squad session (a solo match) there is nothing to do and nothing changes.
  W.events.on("mapFallback", (info) => { if (S && S.started && !S.mapFallback) S.mapFallback = normFallback(info) || { wanted: null, built: null, reason: "" }; });
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
  // squad chat: rate-limited, rides the ev envelope (one billed message = the
  // state packet it boards). Returns true when accepted so hud can echo it.
  W.sendChat = (m) => {
    if (!S || !W.player) return false;
    const now = performance.now();
    if (now - (S._lastChatT || 0) < 1500) return false;
    S._lastChatT = now;
    qsend("chat", { id: W.player.id, m: String(m).slice(0, 80) });
    return true;
  };
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
const CRITICAL_MSG = { state: 1, bots: 1, hitYou: 1, died: 1, start: 1, hello: 1, bye: 1, takeover: 1, sync: 1, ev: 1, rtc: 1, refuse: 1, mapfail: 1 };

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
 *  flushes the queue INTO THE STATE PACKET (st.evs) on the state tick, so a
 *  burst costs zero extra messages — the ride-along is free because messages,
 *  not bytes, are the billed unit. */
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
  closeB.onclick = () => { attempt++; if (S) { try { S.rtc && S.rtc.close(); } catch (e) {} S.net.leave(); S = null; W.net = null; } root.remove(); };

  // Who is actually in the room. S.peers has held every peer's chosen name since
  // the "hello" handler shipped, but it was read in exactly ONE place — building
  // the roster at match start — so the lobby printed a bare count and never a
  // name, and you could not tell whether the "2 players" was your friend.
  // (rosterEl, not `roster` — startB.onclick below already owns that name for
  //  the roster ARRAY it ships in the start packet)
  const rosterEl = document.createElement("div");
  Object.assign(rosterEl.style, { fontSize: "13px", lineHeight: "1.6", margin: "2px 0 12px", minHeight: "22px", opacity: ".9" });
  box.appendChild(rosterEl);
  // Notices (textContent only): why a guest was left out / refused. A separate line, because `status` is rewritten on every peer change.
  const noteEl = document.createElement("div");
  Object.assign(noteEl.style, { fontSize: "12.5px", lineHeight: "1.5", margin: "0 0 10px", color: "#ffb060", display: "none" });
  noteEl.setAttribute("data-net-notice", "");
  box.appendChild(noteEl);
  // `key` (a peer id): one line per peer - the guest's own refusal replaces the line the host wrote when its hello arrived
  function notice(text, key) {
    let row = key != null ? [...noteEl.children].find((r) => r._key === key) : null;
    if (!row) { row = document.createElement("div"); row._key = key; noteEl.appendChild(row); }
    row.textContent = String(text).slice(0, 220);
    while (noteEl.children.length > 3) noteEl.firstChild.remove();
    noteEl.style.display = "block";
  }
  function paintRoster() {
    if (!S || !S.net.room) { rosterEl.innerHTML = ""; return; }
    // ffg_netplay.js:64 makes the LOWEST peer id the host, and startB.onclick
    // hands out slots by sorted peer id — so sorting every id (peers + self) on
    // any client reproduces the exact roster the host will build. No guessing.
    // A peer on another WORLD VERSION never gets a slot (SquadHandshake.planStart), so it is shown as such and does not count towards the
    // slot numbers or the room cap.
    const all = Object.keys(S.peers).concat([S.net.id]).sort();
    const badge = (s) => `<span style="font-size:10px;letter-spacing:1px;opacity:.6;margin-left:6px">${s}</span>`;
    let h = "";
    let i = -1;                  // index among the peers that can take a slot (self included)
    all.forEach((pid) => {
      const me = pid === S.net.id;
      // names arrive from other machines — they go through esc() before innerHTML
      const nm = esc(me ? S.myName : (S.peers[pid] || "Friend"));
      if (!me && S.hs.gvOf(pid) !== S.hs.gv) {
        h += `<div style="color:#ff9b8a" data-net-peer-gv="${S.hs.gvOf(pid)}">${nm}${badge("VERSION " + S.hs.gvOf(pid) + " — CAN'T JOIN, MUST RELOAD")}</div>`;
        return;
      }
      i++;
      if (i > MAX_GUESTS) { h += `<div style="color:#ffb060">${nm}${badge("SPECTATING — ROOM FULL")}</div>`; return; }
      h += `<div style="${me ? "color:#7fd3ff" : ""}">${me ? "<b>" + nm + "</b>" : nm}${badge(i === 0 ? "HOST" : "SLOT " + i)}</div>`;
    });
    rosterEl.innerHTML = h;
  }
  // The guest-side refusal: the plain-language reason in the lobby, the buttons back, and a RELOAD button when THIS page is the stale one.
  let reloadB = null;
  function showRefusal(j) {
    status.textContent = "";
    const b = document.createElement("b");
    b.style.color = "#ffb060";
    b.textContent = j.title;
    status.appendChild(b);
    status.appendChild(document.createElement("br"));
    status.appendChild(document.createTextNode(j.detail));
    status.setAttribute("data-net-refused", j.mineOlder ? "page-older" : "host-older");
    status.setAttribute("data-net-versions", j.local + "/" + j.remote);
    if (reloadB) { reloadB.remove(); reloadB = null; }
    if (j.reload) {
      reloadB = document.createElement("button");
      reloadB.textContent = "RELOAD PAGE";
      reloadB.setAttribute("data-net-reload", "");
      Object.assign(reloadB.style, { padding: "10px 22px", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: "800", fontSize: "14px", background: "#ffb060", color: "#08131f", marginBottom: "12px" });
      reloadB.onclick = () => { try { location.reload(); } catch (e) {} };
      status.after(reloadB);
    }
    createB.disabled = joinB.disabled = false;
    startB.style.display = "none";
    inviteB.style.display = "none";
    rosterEl.innerHTML = "";
  }

  const startB = document.createElement("button");
  startB.textContent = "START MATCH";
  Object.assign(startB.style, { padding: "12px 34px", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: "900", fontSize: "16px", background: "#4ade80", color: "#08131f", display: "none", marginTop: "6px" });
  box.appendChild(startB);

  // One attempt at a time. A newer attempt (or CANCEL) makes an older one stale: when
  // its await finally settles it only cleans up after itself.
  let attempt = 0;
  const within = (p, ms, what) => new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(what)), ms);
    p.then((v) => { clearTimeout(to); res(v); }, (e) => { clearTimeout(to); rej(e); });
  });
  const connectWithin = (net, ms) => within(net.connect(), ms, "no answer from the online service in " + Math.round(ms / 1000) + " s");
  // The failure line + the buttons back. Plain text only (textContent): the error
  // message is shown in the console, not injected into the page.
  function offline(e) {
    status.textContent = "";
    const b = document.createElement("b");
    b.style.color = "#ff9b8a";
    b.textContent = "Couldn't reach the online service.";
    status.appendChild(b);
    status.appendChild(document.createElement("br"));
    status.appendChild(document.createTextNode("Check your connection and try again, or play solo from the menu."));
    status.setAttribute("data-net-error", String((e && e.message) || e || "error").slice(0, 200));
    createB.disabled = joinB.disabled = false;
    startB.style.display = "none";
    inviteB.style.display = "none";
    rosterEl.innerHTML = "";
  }
  async function enter(code, asHost) {
    const my = ++attempt;
    createB.disabled = joinB.disabled = true;
    status.textContent = "Connecting…";
    // a new attempt starts clean: the last refusal's reason, reload button and notices belong to the last room
    for (const a of ["data-net-refused", "data-net-versions", "data-net-error"]) status.removeAttribute(a);
    if (reloadB) { reloadB.remove(); reloadB = null; }
    noteEl.textContent = ""; noteEl.style.display = "none";
    const net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, "last-circle");
    // joinRoom resolves (it does not reject) on CHANNEL_ERROR / TIMED_OUT and reports
    // them through "error" — without this the lobby printed a room code for a room
    // nobody could ever reach.
    let chanErr = null;
    net.on("error", (e) => { chanErr = (e && e.status) || "error"; });
    try {
      await connectWithin(net, 20000);
    } catch (e) {
      // esm.sh unreachable, supabase-js failed to load, or no answer: say so and give the
      // buttons back. Before this, enter() had no catch — "Connecting…" forever with
      // CREATE ROOM and JOIN both disabled.
      console.warn("[net] online service unreachable:", e);
      if (my === attempt && root.isConnected) offline(e);
      return;
    }
    if (my !== attempt || !root.isConnected) return;   // cancelled / superseded while loading
    const gv = await localGenVersion();                // this page's world-generator version (instant: the module is already loaded)
    if (my !== attempt || !root.isConnected) return;
    // distinct default names online — two "You"s in one lobby is confusing
    const myName = (W.settings.playerName && W.settings.playerName !== "You")
      ? W.settings.playerName
      : "Player-" + net.id.slice(-3).toUpperCase();
    S = { net, peers: {}, myName, started: false, lastState: 0, lastBots: 0, root, gv, refusals: [] };
    S.hs = new SquadHandshake({ id: net.id, name: myName, gv, host: !!asHost });   // who is at which world version (C-VER)
    S.paintRoster = paintRoster;   // onMsg's "hello" handler repaints through this
    S.status = status;             // beginOnlineMatch reports a full room here
    S.notice = notice;             // host: why a guest was left out / refused (lobby line; in a match it goes to the chat log)
    S.showRefusal = showRefusal;   // guest: refuseRoom paints the reason + RELOAD button through this
    // P2P overlay (ffg_rtc.js): the state envelope prefers DataChannels;
    // signaling + everything critical + the full fallback stay on Supabase.
    // ensurePeer is called lazily the first time a peer's state arrives (both
    // sides converge; the lower-id offerer rule breaks the tie).
    S.rtc = new RTCMesh(net.id, (to, payload) => send("rtc", Object.assign({ to }, payload)));
    S.rtc.onMessage = (m) => { if (m && m.t) onMsg(W, { from: m.from, t: m.t, d: m.d }); };
    W.net = S;
    net.on("msg", (m) => onMsg(W, m));
    net.on("peer", ({ count }) => {
      if (S !== sess) return;
      status.innerHTML = `Room <b style="letter-spacing:3px">${net.room}</b> — ${Math.max(1, count)} player(s) connected` +
        (net.isHost() ? "" : "<br>Waiting for the host to start…");
      if (net.isHost()) startB.style.display = count >= 1 ? "inline-block" : "none";
      paintRoster();
    });
    const sess = S;
    try {
      await within(net.joinRoom(code, asHost), 20000, "the room did not answer in 20 s");
      if (chanErr) throw new Error("realtime channel " + chanErr);
    } catch (e) {
      console.warn("[net] could not join the room:", e);
      if (S === sess) { try { S.rtc && S.rtc.close(); } catch (x) {} try { net.leave(); } catch (x) {} S = null; W.net = null; }
      else { try { net.leave(); } catch (x) {} }
      if (my === attempt && root.isConnected) offline(e);
      return;
    }
    if (S !== sess || my !== attempt) { try { net.leave(); } catch (x) {} return; }   // cancelled while joining
    send("hello", S.hs.helloMsg());
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
    // VERSION GUARD: a peer on another world version gets no slot (it would build
    // a different map from this seed) - planStart leaves it out and says so.
    const plan = S.hs.planStart(S.peers, MAX_GUESTS);
    const roster = plan.roster;
    const cfg = S.hs.startMsg({ seed: (Math.random() * 0xffffffff) >>> 0, mapId: W.randomMap(), mode: sel.mode === "practice" ? "standard" : sel.mode, roster });
    send("start", cfg);
    if (beginOnlineMatch(W, cfg) !== false) {
      // the host reads WHY someone is not in this match: in the lobby when their hello arrived, and in the chat log once the match is live
      // (onMatchStart - the lobby is about to go and the HUD chat is not up during the load)
      S.pendingNotices = plan.left.map((l) => leftOutLine(l.name, l.gv, S.gv));
      for (const l of plan.left) W.events.emit("squadRefused", { peerId: l.peerId, name: l.name, gv: l.gv, hostGv: S.gv, by: "host" });
      root.remove();
    }
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

// (guarded so net.selftest.cjs can import this module in Node)
if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("beforeunload", () => {
  try { if (S && S.started && S.mySlot != null) S.net.send("bye", { slot: "s" + S.mySlot }); } catch (e) {}
});

/** Tell the player (host side) something about the squad: the lobby line while the lobby is up, else the HUD's chat log
 *  (W.pushChat, textContent only). Never throws. */
function notify(W, text, key) {
  try {
    if (S && S.notice && S.root && S.root.isConnected) { S.notice(text, key); return; }
    if (W.pushChat) W.pushChat("SQUAD", String(text).slice(0, 200), false);
  } catch (e) {}
}

/** GUEST: this room would build another world than this page. Refuse it: say so on screen, tell the host why, free the slot an old
 *  (unguarded) host may have given us, and leave the room. `j` = judgeGv / judgeStart result. */
function refuseRoom(W, j, hostId) {
  const sess = S;
  if (!sess || sess.refused) return;
  sess.refused = j;
  const net = sess.net, name = sess.myName, gv = sess.gv;
  console.warn(`[net] refusing the room: this page is world version ${j.local}, the room runs ${j.remote}`);
  try { if (sess.showRefusal) sess.showRefusal(j); } catch (e) {}
  const out = (t, d) => { try { net.send(t, d); } catch (e) {} };
  out("refuse", { gv, hostGv: j.remote, name });                              // the host reads why (CRITICAL: never shed)
  if (j.slot != null) out("bye", { slot: "s" + j.slot });                     // an old host put us in its roster: it hands the body to a bot
  W.events.emit("squadRefused", { peerId: net.id, name, gv, hostGv: j.remote, by: "guest", host: hostId || null });
  try { sess.rtc && sess.rtc.close(); } catch (e) {}
  net.handlers = {};                       // nothing this channel still delivers may reach a NEW session's onMsg while it winds down
  if (S === sess) { S = null; W.net = null; }
  // leave a moment later so the two sends above are on the wire; an old host loads its match for a while before the body exists, so
  // the "bye" is repeated once, then we are gone
  setTimeout(() => { if (j.slot != null) out("bye", { slot: "s" + j.slot }); }, 12000);
  setTimeout(() => { try { net.leave(); } catch (e) {} }, j.slot != null ? 13000 : 500);
}

// ── MAP FALLBACK: the leaving side and the room's side (contract C-FALLBACK, see the header) ───────────────────────────────────────────────
let _fbCard = null;
/** The on-screen message of a client that left the squad because its map fell back. Not a modal - the match carries on under it - but a card at the
 *  top with RELOAD PAGE and KEEP PLAYING (textContent only). It gives the mouse back like every clickable overlay (hud.js releaseCursor). */
function showFallbackCard(W, j) {
  try {
    if (_fbCard) { _fbCard.remove(); _fbCard = null; }
    try { document.exitPointerLock && document.exitPointerLock(); } catch (e) {}
    try { W.kernel.renderer.domElement.style.cursor = ""; } catch (e) {}
    W._suppressNextShot = true;           // the click that re-grabs the pointer must not also fire the weapon
    const card = document.createElement("div");
    card.setAttribute("data-net-fallback", j.wanted + "/" + (j.built == null ? "?" : j.built));
    Object.assign(card.style, {
      // below the HUD's top rows (storm timer, level bar, mission card end near 170 px) so the circle timer stays readable under it
      position: "absolute", left: "50%", top: "178px", transform: "translateX(-50%)", zIndex: 80, width: "min(94vw, 620px)", boxSizing: "border-box",
      background: "rgba(10,19,31,0.96)", border: "1px solid rgba(255,176,96,0.65)", borderRadius: "12px", padding: "12px 16px", textAlign: "center",
      color: "#eaf2ff", fontFamily: "system-ui, sans-serif", fontSize: "13px", lineHeight: "1.4", pointerEvents: "auto", boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
    });
    const t = document.createElement("div");
    t.textContent = j.title;
    Object.assign(t.style, { fontWeight: "900", fontSize: "16px", letterSpacing: "1px", color: "#ffb060", marginBottom: "6px" });
    const d = document.createElement("div");
    d.textContent = j.detail;
    d.style.marginBottom = "10px";
    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" });
    const mkb = (label, primary, fn, attr) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.setAttribute(attr, "");
      Object.assign(b.style, { padding: "9px 20px", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: "800", fontSize: "13px", background: primary ? "#ffb060" : "rgba(255,255,255,0.14)", color: primary ? "#08131f" : "#cfe4ff" });
      b.onclick = fn;
      row.appendChild(b);
    };
    mkb("RELOAD PAGE", true, () => { try { location.reload(); } catch (e) {} }, "data-net-reload");
    mkb("KEEP PLAYING", false, () => { card.remove(); if (_fbCard === card) _fbCard = null; }, "data-net-dismiss");
    card.append(t, d, row);
    (W.kernel.parent || document.body).appendChild(card);
    _fbCard = card;
    // the card belongs to the match it was raised in: it goes when the player is back at the menu, and after 40 s (a player with the mouse locked
    // cannot click KEEP PLAYING without pressing ESC first, and the card must not cover the HUD for the rest of the match)
    const ph0 = W.phase, born = performance.now();
    const iv = setInterval(() => {
      if (!card.isConnected) { clearInterval(iv); return; }
      if ((ph0 !== "menu" && W.phase === "menu") || performance.now() - born > 40000) { card.remove(); clearInterval(iv); if (_fbCard === card) _fbCard = null; }
    }, 500);
    return card;
  } catch (e) { console.warn("[net] could not show the map-fallback card:", e); return null; }
}

/** Every actor this client was only following (remote humans, the host's bots) fights on under a local bot brain - the hostLost conversion. */
function convertRemotesToBots(W) {
  let converted = 0;
  for (const a of W.actors || []) {
    if (a.netRemote && a !== W.player) {
      a.netRemote = false; a.isBot = true;
      import("./bots.js" + V).then((m) => m.attachBrain(W, a));
      converted++;
    }
  }
  return converted;
}

/** HOST: the human in `a`'s slot is gone for good -> its body fights on under a bot brain, and the guests are told. */
function takeOverBody(W, a) {
  a.netRemote = false; a.isBot = true;
  import("./bots.js" + V).then((m) => m.attachBrain(W, a));
  send("takeover", { slot: a.id });
}

/** HOST: free slot `id` (a "mapfail" / "bye" for it arrived). false = the body does not exist yet (this host is still loading its match when the
 *  guest's message arrives): the caller remembers the slot and drainPending does it once the actors exist. */
function hostTakeOver(W, id) {
  const a = W.actorById && W.actorById.get(id);
  if (!a) return false;
  if (a.alive && S.net.isHost() && a.netRemote) takeOverBody(W, a);
  return true;
}

/** Work a "mapfail" asked for before this client's actors existed: the host's slot take-overs, a guest's "the host left". Called when the match goes
 *  live and from update() while something is pending. */
function drainPending(W) {
  if (!S) return;
  if (S.pendingTakeovers && S.pendingTakeovers.size && W.actorById && W.actorById.size) {
    for (const id of [...S.pendingTakeovers]) if (hostTakeOver(W, id)) S.pendingTakeovers.delete(id);
  }
  if (S.hostGone && W.player) { S.hostGone = false; hostLost(W); }
}

/** Tell the player (a squad-mate left because its map fell back): the HUD chat log once the HUD is up, else remembered for onMatchStart. */
function tellRoom(W, text, key) {
  if (W.phase === "match" || W.phase === "drop") { notify(W, text, key); return; }
  (S.pendingNotices = S.pendingNotices || []).push(text);
}

/** THE LEAVING SIDE of C-FALLBACK: this page holds another world than the one it advertised, so it must not play in the squad. Tells the room (a
 *  "mapfail" with both versions, and the old-style "bye" for the slot, which builds from before this contract understand), turns every remote body
 *  into a bot, drops the session (W.net = null: a solo match from here) and puts the reason on screen. `fb` = a detectMapFallback result. */
function leaveForFallback(W, fb) {
  const sess = S;
  if (!sess || sess.fallbackDone) return;
  sess.fallbackDone = true;
  const net = sess.net, isHost = net.isHost();
  const j = judgeFallback(sess.gv, fb);
  const me = sess.cfg && Array.isArray(sess.cfg.roster) ? sess.cfg.roster.find((r) => r && r.peerId === net.id) : null;
  console.warn(`[net] leaving the squad: this page built map version ${j.built == null ? "?" : j.built} but advertised ${j.wanted} (${fb.via || "fallback"}${fb.reason ? ": " + fb.reason : ""})`);
  const out = (t, d) => { try { net.send(t, d); } catch (e) {} };
  out("mapfail", { name: sess.myName, gv: sess.gv, wanted: j.wanted, built: j.built, reason: String(fb.reason || "").slice(0, 120), host: isHost ? 1 : 0, slot: me ? me.slot : null });
  if (me) out("bye", { slot: "s" + me.slot });
  const converted = convertRemotesToBots(W);
  W.squadLeft = { reason: "map-fallback", wanted: j.wanted, built: j.built, via: fb.via || null, host: isHost, converted };
  W.events.emit("squadMapFallback", { peerId: net.id, name: sess.myName, wanted: j.wanted, built: j.built, via: fb.via || null, host: isHost, by: "self" });
  try { sess.rtc && sess.rtc.close(); } catch (e) {}
  net.handlers = {};                       // nothing this channel still delivers may reach a NEW session's onMsg while it winds down
  if (S === sess) { S = null; W.net = null; }
  setTimeout(() => { try { net.leave(); } catch (e) {} }, 500);   // a moment later, so the two sends above are on the wire
  showFallbackCard(W, j);
}

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
    const hr = S.hs.onHello(from, d);
    S.peers[from] = d && d.name;
    if (hr.first) send("hello", S.hs.helloMsg());
    // VERSION GUARD, guest side: the room's host says it builds another world -> refuse now rather than at START
    if (hr.refuseNow) { refuseRoom(W, hr.refuseNow, from); return; }
    // VERSION GUARD, host side: say (in the lobby) that this peer will not get a slot
    if (hr.first && hr.mismatch && S.hs.host && S.notice) S.notice(leftOutLine(d && d.name, hr.rec.gv, S.gv), from);
    if (S.paintRoster) S.paintRoster();
    return;
  }
  if (t === "start" && !S.started) {
    // VERSION GUARD: the host's start carries its world version next to the seed (none = version 1, every build before the guard).
    // A different generator would build different ground and colliders from this seed - refuse instead of starting.
    const j = S.hs.judgeStart(d);
    if (j) { refuseRoom(W, j, from); return; }
    // remove the lobby only if we actually got a slot — beginOnlineMatch writes
    // the "room is full" message into the lobby that is still on screen
    if (beginOnlineMatch(W, d) !== false && S && S.root) S.root.remove();
    return;
  }
  if (t === "refuse") {
    // a guest would not build our world (host only reads this; it is also what the guest's own ui already showed it)
    if (S.net.isHost() && d) {
      const line = refusalLine(d.name, d.gv, S.gv);
      S.refusals.push({ from, name: String(d.name == null ? "" : d.name).slice(0, 24), gv: normGv(d.gv), hostGv: S.gv, t: performance.now() });
      notify(W, line, from);
      W.events.emit("squadRefused", { peerId: from, name: d.name, gv: normGv(d.gv), hostGv: S.gv, by: "guest" });
    }
    return;
  }
  if (t === "mapfail") {
    // C-FALLBACK, the room's side: a squad-mate's map fell back (it would play another world) and it has left. Its slot, name and "was it the host"
    // come from OUR roster, not from the message body. Say why; the host turns its body into a bot, the guests treat a leaving host like a lost one.
    const r = S.hs.onMapFail(from, d, S.cfg && S.cfg.roster);
    if (!r) return;
    (S.mapFails = S.mapFails || []).push({ from, id: r.id, name: r.name, host: r.host, wanted: r.wanted, built: r.built });
    tellRoom(W, r.line, from);
    if (S.net.isHost()) { if (!hostTakeOver(W, r.id)) (S.pendingTakeovers = S.pendingTakeovers || new Set()).add(r.id); }
    else if (r.host) { if (W.player) hostLost(W); else S.hostGone = true; }
    W.events.emit("squadMapFallback", { peerId: from, name: r.name, wanted: r.wanted, built: r.built, host: r.host, by: "peer" });
    return;
  }
  if (t === "rtc") {
    // P2P signaling relayed over the room channel — only the addressee acts
    if (S.rtc && d && d.to === S.net.id && from) S.rtc.handleSignal(from, d);
    return;
  }
  if (t === "state") {
    // lazy mesh negotiation: the first state we SEE from a peer starts the
    // DataChannel handshake for that pair (both sides converge on it)
    if (S.rtc && from) S.rtc.ensurePeer(from);
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
    // ENVELOPE MERGE (sender side in update()): bot snapshots and the batched
    // ev list now ride the state packet — one billed message instead of three
    // streams. The standalone "bots"/"ev" handlers below stay for peers that
    // still send the pre-merge streams; since the VERSION GUARD (C-VER) such a
    // peer can no longer be in a match with this build (it has no `gv`, so it is
    // version 1 and the room refuses it), so they are only reachable by a
    // same-version peer that chooses to send them. Kept, harmless, byte-identical.
    if (d.bots && !S.net.isHost()) {
      for (const b of d.bots) {
        const ba = W.actorById.get(b.id);
        if (ba && ba.netRemote) applyRemoteState(W, ba, b);
      }
    }
    if (d.evs) { for (const m of d.evs) if (m && m.t !== "ev") onMsg(W, { from, t: m.t, d: m.d }); }
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
  if (t === "chat") {
    // squad text — hud renders it via textContent (remote strings never touch
    // innerHTML). Rides the ev envelope; NOT in the fire/emote shed list, so
    // the budget can't silently eat a message.
    if (d.id !== undefined && typeof d.m === "string") W.events.emit("chatMsg", d.id, d.m.slice(0, 80));
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
    if (a && a.alive && S.net.isHost() && a.netRemote) takeOverBody(W, a);
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
  // remotes never run stepActor, so these fields are only read by syncObj's
  // anim branches (mantle tuck; hit flinch — whose decay runs in syncObj,
  // which interpRemote calls). Refresh-while-set, decay after.
  a.mantleT = (f & 32) ? 0.2 : null;
  if (f & 64) a.hitReactT = Math.max(a.hitReactT || 0, 0.25);
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
  const converted = convertRemotesToBots(W);
  try { S.rtc && S.rtc.close(); } catch (e) {}
  try { S.net && S.net.leave && S.net.leave(); } catch (e) {}
  W.net = null;                                 // frame gates (hitstop etc.) read this
  W.events.emit("hostLost", converted);
  console.warn(`[net] host lost — converted ${converted} remote actors to bots, continuing offline`);
}

export function leave(W) {
  if (S) {
    try { S.rtc && S.rtc.close(); } catch (e) {}
    try { S.net.leave(); } catch (e) {}
    S = null;
  }
  W.net = null;
}

export function onMatchStart(W) {
  if (!S) return;
  // C-FALLBACK: the first moment actors and the HUD exist. A client that holds another world than the one it advertised leaves the squad here
  // (nothing below - no sync, no state - is sent for it).
  if (S.started) {
    const fb = detectMapFallback(W, S.gv, S.mapFallback);
    if (fb) { leaveForFallback(W, fb); return; }
  }
  drainPending(W);        // take-overs / "the host left" that arrived while this client was still loading
  // host sends world sync for any guest that joined at the boundary
  if (S.net.isHost()) send("sync", { t: W.t, loot: W.lootSyncState() });
  // the HUD is up now: say who was left out of this match, and why (lobby time passed while the match loaded), or who left while it loaded
  const pend = S.pendingNotices;
  if (pend && pend.length) { S.pendingNotices = null; for (const t of pend) notify(W, t); }
}

export function update(W, dt) {
  if (!S || !S.started || !W.player) return;
  if (S.mapFallback && !S.fallbackDone) { leaveForFallback(W, detectMapFallback(W, S.gv, S.mapFallback)); return; }   // (onMatchStart normally got there first)
  if (S.pendingTakeovers || S.hostGone) drainPending(W);
  const now = performance.now();
  // OWN STATE, rate scaled by room size. Every send is billed once per receiving
  // subscriber, so H humans at 12 Hz cost 12·H·H messages/s: 48 for a pair but
  // 192 for four, against a 100 msg/s ceiling shared with every other ForgeFlow
  // title. 12/8/6 Hz keeps the state term at 48/72/96. The interpolation
  // constant has to follow the rate or a 6 Hz peer smears — player.js's
  // interpRemote reads W._netLerpK when it is set (default 10 ≈ 12 Hz).
  const H = Math.max(1, S.net.peerCount || 1);
  // 12/8/5 Hz. The 4-human floor moved 6 -> 5 as part of the ENVELOPE MERGE
  // below: the state packet is now the ONLY periodic message a client sends —
  // evs ride it, and on the host the bot snapshots ride it too. Messages are
  // the billed unit (each send costs one per receiving subscriber), so the
  // steady-state worst case is exactly the state term: 12·2·2=48 for a pair,
  // 8·3·3=72 at three, 5·4·4=80 at four — under the 100 msg/s ceiling WITH
  // everything aboard, where the old separate state+ev+bots streams could
  // stack to ~300 msg/s in a 4-human fight and Supabase answers over-rate by
  // dropping the connection.
  const _humans = 1 + (S.lastSeen ? Object.keys(S.lastSeen).length : 0);
  const _botsMs = _humans >= 4 ? 160 : _humans === 3 ? 125 : 100;
  if (S.net.isHost() && now - S.lastBots > _botsMs) {
    S.lastBots = now;
    S.botsTick = (S.botsTick || 0) + 1;
    // "near a human" used to mean near W.player.pos — which on the host is the
    // HOST's own actor. A guest fighting a bot on the far side of the map got
    // that bot at 2 Hz, i.e. a lerp target up to 500 ms stale, and their hit
    // tests resolve against the rendered position. Measure from every live human
    // instead: at most 7 extra distanceToSquared per bot.
    const eyes = [W.player.pos];
    for (const h of W.actors) if (h.netRemote && !h.isBot && h.alive) eyes.push(h.netTarget ? h.netTarget.pos : h.pos);
    const list = [];
    for (const a of W.actors) {
      if (!a.isBot || !a.alive || a.netRemote) continue;
      const far = eyes.every((p) => a.pos.distanceToSquared(p) > 300 * 300);
      if (far && S.botsTick % 5 !== 0) continue;
      list.push(pack(a));
    }
    // STAGED, not sent: the list rides the host's next state packet (see the
    // envelope merge above). If two bot ticks elapse before a state tick —
    // impossible at current rates, host state Hz >= bot Hz at every room size
    // — the newer list simply replaces the staler one, which is what a
    // snapshot protocol wants anyway.
    if (list.length) S.pendingBots = list;
  }
  const stateMs = H <= 2 ? 83 : H === 3 ? 125 : 200;
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
    // EVS RIDE THE STATE TICK (was a separate 10 Hz "ev" stream). Same
    // over-budget shedding: drop the PURE-FX half (tracer/emote — invisible a
    // second later), keep the world-state half (take/chest/drop — a missing
    // one leaves a ghost item every other client can still try to pick up).
    if (S.evQ && S.evQ.length) {
      let list = S.evQ;
      S.evQ = [];
      if (sendBudgetLeft() <= 0) {
        const kept = list.filter((m) => m.t !== "fire" && m.t !== "emote");
        S.droppedMsgs = (S.droppedMsgs || 0) + (list.length - kept.length);
        list = kept;
      }
      if (list.length) st.evs = list;
    }
    // HOST: bot snapshots ride the same packet when due (cadence unchanged —
    // the attach below only fires when _botsMs has elapsed, and the host's
    // state rate is always >= the bot rate at every room size). Chunking to 24
    // was message-size prudence from the multi-stream era; one 46-bot list is
    // ~3.7 KB, far under Realtime's payload limit, and one packet beats three.
    if (S.net.isHost() && S.pendingBots) {
      st.bots = S.pendingBots;
      S.pendingBots = null;
    }
    // P2P FIRST: the envelope goes over DataChannels to every peer whose
    // channel is open; ONE Supabase broadcast only if any peer lacks one
    // (that peer filters by `from` exactly as before; a DC peer seeing the
    // duplicate just re-applies the same snapshot — harmless by design).
    // Any RTC failure therefore degrades to the exact pre-RTC behaviour.
    let covered = false;
    if (S.rtc) {
      const r = S.rtc.sendState({ from: S.net.id, t: "state", d: st });
      covered = r.allCovered;
    }
    if (!covered) send("state", st);
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
    // bits 32/64: mantle + hit-react — transient states, but 0.25-0.5 s spans
    // 2-6 packets at 5-12 Hz so remotes catch them; older peers ignore
    // unknown bits (sweep findings: both were invisible to other clients)
    f: (a.crouching ? 1 : 0) | (a.input.ads ? 2 : 0) |
       (a.weapon && a.weapon.state === "reloading" ? 4 : 0) |
       (a.swimming ? 8 : 0) | (a.chute ? 16 : 0) |
       (a.mantleT != null ? 32 : 0) | (a.hitReactT > 0 ? 64 : 0),
  };
}
