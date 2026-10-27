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
 *
 * PARITY WAVES P2+P3 (lane net). Five additions, every one backward-compatible with a same-version peer that lacks them:
 *   C-MODE   the host picks the TEAM mode in the lobby (DUOS / TRIOS / SQUADS, or AUTO = the smallest that holds the room); the "start" carries
 *            teamMode next to the pace (`mode`, unchanged) and every roster entry carries its human's teamId. A "room" message tells the
 *            guests the host's pick while they wait. The boot builds the teams and the bot teammates from teamMode (resolveTeamMode is the
 *            same rule on both sides).
 *   C-DBNO   bit 256 of the stance byte = downed (while downed, hp carries the bleed pool: no extra key, a normal packet is byte-identical); a "revive"
 *            message { k: down | start | cancel | done, id, by }. The downed actor's OWNER revives it (it is the authority over its life, like
 *            over its HP): a "done" is accepted only after that owner saw the reviver's "start" at least K.REVIVE_S earlier.
 *   LC-49    every state packet carries q (a per-sender sequence number) and t (the sender's match clock = the host's, which guests slew to:
 *            the server-time stamp). SeqGate drops duplicates (the RTC + relay copies of one packet) and never lets a late packet pull a
 *            remote body, its HP or the clock backwards; the events riding a late packet still apply.
 *            REJOIN: a guest whose page reloads (or who opens the invite link again) inside REJOIN_MS (60 s) gets its own slot back. Its
 *            hello always carried a commitment rk = hash(secret); the secret stays in that tab (sessionStorage, localStorage fallback) with
 *            its inventory, and a reloaded page shows it (rj) to ask for the slot. The host checks it, hands the start back ("rejoin" ok),
 *            keeps the body under its bot brain while the page loads, and on "ready" gives the body back ("back": position, HP, alive)
 *            with a targeted loot sync and the list of the dead.
 *   LC-14    frag throws ("nade", cosmetic: remote clients can draw the arc / play the toss) and smoke clouds ("smoke": W.smokes entries made
 *            here are relayed once, so the host's bots and every screen see the same smoke; at most SMOKE_MAX_PER_SENDER per sender).
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

/** How long a peer we have heard (hello) but never seen in the room's presence list still counts as present (LC-11, see isPresent). */
export const PRESENCE_GRACE_MS = 3000;

/** The pure half of the squad handshake: who is in the room at which world version, who may get a slot, what a guest does with a start
 *  message. net.js feeds it the messages and does the sending / painting; net.selftest.cjs drives two of these through an in-memory bus. */
export class SquadHandshake {
  constructor({ id, name, gv, host }) {
    this.id = id; this.name = name; this.gv = normGv(gv); this.host = !!host;
    this.peers = new Map();            // peer id -> { name, gv, host }
    // PRESENCE (parity LC-11). The roster used to be built from every peer that ever said hello, so a friend who joined and closed the tab
    // before START still got a slot: an immortal, frozen squad-mate nobody owned (storm skips netRemote, the team stayed alive, the match could
    // never end). The room's presence list is the truth about who is still here. `present` = the latest presence ids, `seen` = every id that
    // was ever in it, `helloAt` = when a peer's first hello arrived (a hello can beat that peer's own presence to us by a moment).
    this.present = null;               // null = no presence report yet (every peer counts as present)
    this.seen = new Set();
    this.helloAt = new Map();
  }
  /** The room's presence list changed (`ids` = every peer id in it, ours included). Returns the ids that LEFT since the last report. */
  onPresence(ids) {
    const now = new Set((ids || []).map(String));
    const left = this.present ? [...this.present].filter((p) => !now.has(p)) : [];
    for (const p of now) this.seen.add(p);
    this.present = now;
    return left;
  }
  /** Is `pid` still in the room? With no presence report yet: yes. A peer in the presence list: yes. A peer that WAS in it and is gone: no.
   *  A peer we have only heard (hello) and never seen in presence: yes for PRESENCE_GRACE_MS after its hello (presence can lag a broadcast),
   *  then no. `nowMs` = performance.now() (or any monotonic clock the hello times were stamped with). */
  isPresent(pid, nowMs) {
    if (pid === this.id) return true;
    if (!this.present) return true;
    if (this.present.has(pid)) return true;
    if (this.seen.has(pid)) return false;
    const t = this.helloAt.get(pid);
    return t != null && nowMs != null && nowMs - t <= PRESENCE_GRACE_MS;
  }
  /** the body of our "hello" */
  helloMsg() { return { name: this.name, gv: this.gv, host: this.host ? 1 : 0 }; }
  /** a "hello" arrived. `first`: we had not seen this peer. `refuseNow`: set when WE are a guest and the peer is the room's host
   *  (it said so) on another version - leave at once instead of waiting for START. */
  onHello(from, d, nowMs) {
    d = d || {};
    const first = !this.peers.has(from);
    const rec = { name: d.name, gv: normGv(d.gv), host: d.host === 1 || d.host === true };
    // LC-49 rejoin: the guest's commitment (rejoinHash of the secret its tab keeps); the host files it per slot at START
    if (typeof d.rk === "string" && d.rk.length >= 4 && d.rk.length <= 32) rec.rk = d.rk;
    this.peers.set(from, rec);
    if (first || !this.helloAt.has(from)) this.helloAt.set(from, nowMs != null ? nowMs : 0);
    const mismatch = judgeGv(this.gv, rec.gv);
    return { first, rec, mismatch, refuseNow: !this.host && rec.host ? mismatch : null };
  }
  /** a peer's version (a peer that never said hello is version 1) */
  gvOf(id) { const r = this.peers.get(id); return r ? r.gv : 1; }
  /** HOST: the start roster from `names` (peer id -> name). Peers on another version are LEFT OUT (`left`), the rest are sorted by id and
   *  cut at `maxGuests` (`over`: stay in the room, told "room is full"). Host = slot 0. */
  planStart(names, maxGuests, nowMs) {
    const roster = [{ peerId: this.id, slot: 0, name: this.name }];
    const left = [], over = [], gone = [];
    for (const pid of Object.keys(names).sort()) {
      const gv = this.gvOf(pid), nm = names[pid] || "Friend";
      // a peer on another world version is LEFT OUT and named (the host is told why), whether or not it is still in the room - a refusing
      // guest leaves the room by itself a moment after it refuses
      if (gv !== this.gv) { left.push({ peerId: pid, name: nm, gv }); continue; }
      // LC-11: a same-version peer that left the room before START gets NO slot (it is "gone", not left out: nobody is there to tell)
      if (!this.isPresent(pid, nowMs)) { gone.push({ peerId: pid, name: nm }); continue; }
      if (roster.length - 1 >= maxGuests) { over.push({ peerId: pid, name: nm }); continue; }
      roster.push({ peerId: pid, slot: roster.length, name: nm });
    }
    return { roster, left, over, gone };
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

// ── SENDER BINDING (parity LC-11): pure ──────────────────────────────────────────────────────────────────────────────────────────────────
// Every in-match message used to be applied on its body alone: a guest console could send hitYou { target: the host, dmg: 37, attacker: a
// bot } (host HP 100 -> 63), died { slot: a host bot } (the bot fell over, the kill went to the sender), takeover { slot } (the host stopped
// simulating its own bot) or bye { slot } for anybody. The precedent is onMapFail above: the slot comes from the ROSTER entry of the sender,
// never from the body. Here the same rule covers the rest:
//   state / chat / ping       the actor in the body must be the sender's own slot
//   fire / emote / heal / rld the sender's own slot, or (host only) a bot it simulates
//   hitYou                    the attacker must be the sender's slot, or (host only) a bot; the damage must fit the weapon's biggest single hit
//   died                      the sender's own slot, or (host only) a bot
//   bye                       the sender's own slot only
//   takeover / sync           from the host only (and never TO the host)
//   chest / take / drop / boom any member of this match (world events anyone may cause)
//   revive (P23)              "down": the knocked actor's owner; start / cancel / done: the reviver's (own slot, or host for a bot)
//   nade / smoke (P23)        the thrower's own slot, or (host only) a bot it simulates
//   rejoin (P23)              "ready": the slot's own peer; ok / back / no: the host only
// LIMIT, stated plainly: `from` itself is written by the sending client (ffg_netplay.js puts it in the payload, and so do the RTC frames). This
// stops a forged message sent through the game's own send path or by a client that keeps its own id; a client that also forges `from` can
// only be stopped by a server (owner decision OD-10 / look-plan D9).

/** The roster slot of peer `from` in `roster` ([{ peerId, slot }]), or null when it is not in this match. */
export function slotOfPeer(roster, from) {
  if (!Array.isArray(roster) || from == null) return null;
  const r = roster.find((x) => x && x.peerId === from);
  return r && typeof r.slot === "number" ? r.slot : null;
}

/** The biggest damage one hit of `weaponId` can deal (legendary, point blank, headshot, top of the damage roll), +1 for rounding. `K` = the
 *  sim (W.SIM). null when the sim or the weapon is unknown. */
export function maxHitDamage(K, weaponId) {
  if (!K || !K.WEAPONS || !K.WEAPONS[weaponId] || typeof K.hitDamage !== "function") return null;
  const tiers = Array.isArray(K.RARITY) ? K.RARITY.length : 5;
  let best = 0;
  for (let r = 0; r < tiers; r++) for (const head of [false, true]) best = Math.max(best, K.hitDamage(weaponId, r, 0, head, 1), K.hitDamage(weaponId, r, 0, head));
  return best + 1;
}

/** May the peer `from` send message `t` with body `d` in this match? ctx = { roster, isHost (this client), actor(id) -> { isBot } | null, K }.
 *  ctx.selfId = this client's own actor id (when known): the host may speak for any actor EXCEPT that one.
 *  Returns null when it may, else a short reason (logged and counted, never shown). */
export function senderMay(t, d, from, ctx) {
  const roster = ctx && ctx.roster;
  const slot = slotOfPeer(roster, from);
  if (slot == null) return "sender not in this match";
  d = d || {};
  const own = "s" + slot, fromHost = slot === 0;
  // the HOST simulates every bot and every body it took over from a guest that left; it may speak for any actor but the receiver's own
  // (this client is the authority over its own HP and life - a hit reaches it as hitYou, never as a bare "died")
  const botOk = (id) => {
    if (!fromHost || id == null) return false;
    if (ctx.selfId != null && id === ctx.selfId) return false;
    const a = ctx.actor ? ctx.actor(id) : null;
    return !!a && (a.isBot || ctx.selfId != null);
  };
  switch (t) {
    case "state": return d.id === own ? null : "state for another slot";
    case "chat": case "ping": return d.id === own ? null : t + " for another slot";
    case "fire": case "emote": case "heal": case "rld":
      return d.id === own || botOk(d.id) ? null : t + " for another actor";
    case "hitYou": {
      if (!(d.attacker === own || botOk(d.attacker))) return "hit credited to another actor";
      const dmg = d.dmg;
      if (typeof dmg !== "number" || !Number.isFinite(dmg) || dmg <= 0) return "bad damage";
      const cap = maxHitDamage(ctx.K, d.weapon);
      if (ctx.K && ctx.K.WEAPONS && cap == null) return "unknown weapon";
      if (cap != null && dmg > cap) return "damage over the weapon's biggest hit";
      return null;
    }
    case "died": return d.slot === own || botOk(d.slot) ? null : "death of another actor";
    case "bye": return d.slot === own ? null : "bye for another slot";
    case "takeover": case "sync": case "bots": return fromHost && !ctx.isHost ? null : t + " not from the host";
    // C-DBNO: a knock is announced by the downed actor's owner; start / cancel / done by the reviver's
    case "revive":
      if (d.k === "down") return d.id === own || botOk(d.id) ? null : "knock of another actor";
      return d.by === own || botOk(d.by) ? null : "revive by another actor";
    // LC-14: a throw / a smoke cloud belongs to the actor that threw it
    case "nade": return d.id === own || botOk(d.id) ? null : "throw by another actor";
    case "smoke": return d.by === own || botOk(d.by) ? null : "smoke by another actor";
    // LC-49 rejoin: "ready" from the slot's own (new) peer; ok / back / no from the host only
    case "rejoin":
      if (d.k === "ready") return d.slot === slot ? null : "rejoin for another slot";
      return fromHost && !ctx.isHost ? null : "rejoin not from the host";
    default: return null;                    // chest / take / drop / boom / unknown: any member of the match
  }
}

// ── PING (parity LC-07): pure ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One ping per second per sender, on both sides of the wire: the sender never queues more, the receiver drops a faster stream. */
export const PING_MIN_MS = 1000;
export class PingLimiter {
  constructor(minMs) { this.minMs = minMs == null ? PING_MIN_MS : minMs; this.last = new Map(); }
  /** true (and the time is booked) when `key` may ping at `nowMs` */
  allow(key, nowMs) {
    const t = this.last.get(key);
    if (t != null && nowMs - t < this.minMs) return false;
    this.last.set(key, nowMs);
    return true;
  }
}
/** The ping gate, one per STREAM: a sender's world ping ("<id>:w") and map pin ("<id>:m") each get their own 1/s, so a pin is never refused
 *  because a world ping just went out (or the other way round). A stream with `coalesce` (map pins) never DROPS the newest body when it is
 *  over the rate: it is held (newest replaces older) and handed out by due() the moment the limit frees, so a player who moves a pin twice in
 *  one second ends with the LAST pin on every peer. A clear ("clr") always passes at once and cancels anything held on its stream.
 *  offer() -> { now: body | null, wait: ms | null }  (now = send / show it now; wait = a held body is due in that many ms). */
export class PingOutbox {
  constructor(minMs) { this.lim = new PingLimiter(minMs); this.held = new Map(); }
  offer(stream, body, nowMs, coalesce) {
    if (!body) return { now: null, wait: null };
    if (body.k === "clr") { this.held.delete(stream); return { now: body, wait: null }; }
    if (this.lim.allow(stream, nowMs)) { this.held.delete(stream); return { now: body, wait: null }; }
    if (!coalesce) return { now: null, wait: null };
    this.held.set(stream, body);
    return { now: null, wait: this.waitMs(stream, nowMs) };
  }
  waitMs(stream, nowMs) { const t = this.lim.last.get(stream); return t == null ? 0 : Math.max(0, this.lim.minMs - (nowMs - t)); }
  /** Every held body whose limit has freed by `nowMs` (booked as sent), as [stream, body] pairs. */
  due(nowMs) {
    const out = [];
    for (const [stream, body] of this.held) if (this.lim.allow(stream, nowMs)) out.push([stream, body]);
    for (const [stream] of out) this.held.delete(stream);
    return out;
  }
  get pending() { return this.held.size; }
}
/** Pings go to the SENDER'S team only: a receiver shows one only when both actors carry the same non-empty teamId. */
export function pingTeamOk(myTeam, senderTeam) {
  return myTeam != null && myTeam !== "" && myTeam === senderTeam;
}
export const PING_KINDS = ["go", "enemy", "pin", "clr"];
/** A ping body as it travels: kind whitelisted, coordinates finite and rounded, inside +-`half` (the map half-size, default 2000). null = drop. */
export function normPing(d, half) {
  if (!d || typeof d !== "object") return null;
  const k = PING_KINDS.includes(d.k) ? d.k : null;
  if (!k) return null;
  const H = half > 0 ? half : 2000;
  if (k === "clr") return { k, src: d.src === "m" ? "m" : "w" };
  const ok = (v, lim) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim;
  if (!ok(d.x, H) || !ok(d.z, H) || !ok(d.y, 5000)) return null;
  return { k, src: d.src === "m" ? "m" : "w", x: +d.x.toFixed(1), y: +d.y.toFixed(1), z: +d.z.toFixed(1) };
}

// ══ PARITY WAVES P2+P3, lane net ════════════════════════════════════════════════════════════════════════════════════════════════════════
// C-MODE team modes, C-DBNO knock / revive, LC-49 sequence numbers + server-time stamps + rejoin, LC-14 smoke / frag relay. Pure parts first
// (net.selftest.cjs drives them); the wiring is in init / onMsg / update / pack below.

// ── C-MODE: team modes (parity LC-19, owner OD-4) ─────────────────────────────────────────────────────────────────────────────────────
export const TEAM_MODES = ["solo", "duo", "trio", "squad"];
/** The contract's team sizes; K.TEAM_SIZE (sim/royale.js) wins when the sim has it. */
export const TEAM_SIZE_DEF = Object.freeze({ solo: 1, duo: 2, trio: 3, squad: 4 });
function teamSizes(K) {
  const T = K && K.TEAM_SIZE;
  return T && typeof T === "object" && T.solo >= 1 ? T : TEAM_SIZE_DEF;
}
/** A team mode name, or null when `x` is not one. */
export function normTeamMode(x) { return typeof x === "string" && TEAM_MODES.includes(x) ? x : null; }
/** The team mode a room plays: `want` (the host's pick, null = no pick) for `nHumans` humans at pace `pace`. Every human in a room is one team
 *  (they came to play together), so a pick too small for the room becomes the smallest mode that holds them all; no pick = that smallest fit;
 *  practice is solo. The SAME rule as the boot's resolveTeamMode (ffg_royale3d.js), so a host and every guest that run it on the roster agree. */
export function resolveTeamMode(want, nHumans, pace, K) {
  const T = teamSizes(K);
  const n = Math.max(1, nHumans | 0);
  if (pace === "practice") return "solo";
  const w = normTeamMode(want);
  if (w && T[w] >= n) return w;
  const order = TEAM_MODES.filter((k) => T[k] >= 1).sort((a, b) => T[a] - T[b]);
  for (const k of order) if (T[k] >= n) return k;
  return order[order.length - 1];
}
/** D5, run it back: the team-mode PICK of the next match in the room. `cfg` = the start of the match that ended (its teamWant: a mode or
 *  "auto"), `asked` = the caller's mode (the boot passes the mode the last match resolved to). The room's own pick wins; AUTO stays AUTO
 *  (null); only a start that carried no teamWant falls back to `asked`. "solo" in a room = AUTO. */
export function rematchTeamWant(cfg, asked) {
  const tw = cfg && typeof cfg.teamWant === "string" ? cfg.teamWant : null;
  const w = tw === "auto" ? null : tw != null ? normTeamMode(tw) : normTeamMode(asked);
  return w === "solo" ? null : w;
}
/** The teamId of the human in roster slot `slot` for `teamMode`: solo = the actor's own id ("s" + slot, what Match.teamOf falls back to), a
 *  team mode = "t0" (the humans' team; the boot fills its other seats with bot teammates and numbers the bot teams t1, t2, ...). */
export function humanTeamId(slot, teamMode, K) {
  return (teamSizes(K)[normTeamMode(teamMode) || "solo"] || 1) > 1 ? "t0" : "s" + slot;
}
/** C-MODE cross-check: do the teams the boot BUILT group the humans the way the start's teamIds do? rows = [[actorId, builtTeamId, wantTeamId]];
 *  a null built team is the actor's own id (Match.teamOf's fallback). Names may differ (the boot may call the humans' team "sq" or "t0"): only
 *  the grouping counts - two humans share a built team exactly when they share a wanted one. Returns the pairs that disagree ([] = same). */
export function teamPartitionDiff(rows) {
  const R = (Array.isArray(rows) ? rows : []).filter((r) => Array.isArray(r) && typeof r[0] === "string" && r[2] != null).map((r) => [r[0], r[1] != null ? r[1] : r[0], r[2]]);
  const bad = [];
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    if ((R[i][1] === R[j][1]) !== (R[i][2] === R[j][2])) bad.push([R[i][0], R[j][0]]);
  }
  return bad;
}
/** The start roster with each human's teamId (C-MODE: net.js carries mode + teamId in the handshake). */
export function rosterWithTeams(roster, teamMode, K) {
  return (Array.isArray(roster) ? roster : []).map((r) => Object.assign({}, r, { teamId: humanTeamId(r.slot, teamMode, K) }));
}

// ── LC-49: sequence numbers on the state stream ───────────────────────────────────────────────────────────────────────────────────────
/** Every state packet carries q = a per-sender counter (pack()). The DataChannel is unordered and a peer without one ALSO gets the Supabase
 *  copy of the same packet, so packets arrive late, early and twice; nothing used to say which was newest, and a late packet pulled the remote
 *  body back to where it was 100-300 ms ago (the audit's "out-of-order packet can pull remote back"). accept(sender, q) ->
 *    "new"   newer than anything seen from this sender: apply everything
 *    "old"   older than the newest but never seen: its positions / HP / clock are stale (dropped); the events riding it are not (applied)
 *    "dup"   seen already (the RTC + relay copy of one packet), or too old to tell: dropped entirely
 *  A packet with no q (a sender from before this change) is always "new": exactly the old behaviour. */
export class SeqGate {
  constructor(win) { this.win = win > 0 ? win : 64; this.top = new Map(); this.seen = new Map(); this.n = { new: 0, old: 0, dup: 0 }; }
  accept(key, q) {
    if (typeof q !== "number" || !Number.isInteger(q) || q < 0) { this.n.new++; return "new"; }
    const top = this.top.get(key);
    if (top == null) { this.top.set(key, q); this.seen.set(key, new Set([q])); this.n.new++; return "new"; }
    const s = this.seen.get(key);
    if (q > top) {
      this.top.set(key, q); s.add(q);
      if (s.size > this.win) for (const x of s) if (x <= q - this.win) s.delete(x);
      this.n.new++; return "new";
    }
    if (q <= top - this.win || s.has(q)) { this.n.dup++; return "dup"; }
    s.add(q); this.n.old++; return "old";
  }
  reset(key) { this.top.delete(key); this.seen.delete(key); }
}

// ── LC-49: rejoin within REJOIN_MS on ?room= ──────────────────────────────────────────────────────────────────────────────────────────
/** A guest whose page reloads (or who opens the invite link again) inside this window gets ITS OWN slot back, body and all. */
export const REJOIN_MS = 60000;
/** A rostered guest slot whose state has been silent this long, asked for with its right rejoin secret, has left (judgeRejoin). A live page
 *  sends state at 12 Hz; a hidden tab of the same browser goes quiet too - and then the page asking with that tab's secret IS its player. */
export const REJOIN_SILENT_MS = 4000;
/** The returning page asks every REJOIN_ASK_EVERY_MS while the host answers "retry" (its old page not seen leaving yet), for up to REJOIN_MS. */
export const REJOIN_ASK_EVERY_MS = 3000;
export const REJOIN_ASK_TRIES = Math.ceil(REJOIN_MS / REJOIN_ASK_EVERY_MS) + 1;
/** 53-bit string hash (cyrb53). The rejoin key is a commitment: a guest's hello carries rejoinHash(secret) (every peer of the room reads it,
 *  all messages are broadcasts), the secret stays in that tab's storage and is shown only when it asks for its slot back. Not cryptographic:
 *  it stops a squad-mate's console from claiming someone else's slot; a client that also forges `from` needs a server (OD-10). */
export function rejoinHash(secret) {
  const s = String(secret == null ? "" : secret);
  let h1 = 0xdeadbeef ^ 0x51, h2 = 0x41c6ce57 ^ 0x51;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** 128 random bits as hex (crypto.getRandomValues when the page has it). */
export function newRejoinSecret() {
  const b = new Uint32Array(4);
  try { (globalThis.crypto || {}).getRandomValues(b); } catch (e) { for (let i = 0; i < 4; i++) b[i] = (Math.random() * 4294967296) >>> 0; }
  if (!b[0] && !b[1]) for (let i = 0; i < 4; i++) b[i] = (Math.random() * 4294967296) >>> 0;
  return [...b].map((x) => x.toString(16).padStart(8, "0")).join("");
}
/** The rejoin request of a hello (`d.rj`: one { slot, key } or a list of up to 3), normalised. [] = none. */
export function normRejoinReq(rj) {
  const list = Array.isArray(rj) ? rj.slice(0, 3) : rj ? [rj] : [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const slot = r.slot;
    if (!Number.isInteger(slot) || slot < 1 || slot > 49 || typeof r.key !== "string" || r.key.length < 8 || r.key.length > 64) continue;
    out.push({ slot, key: r.key });
  }
  return out;
}
/** HOST: may peer `from` take roster slot `req.slot` back? ctx = { roster, keys (Map slot -> committed hash), goneAt ({ "s<slot>": ms }),
 *  nowMs, live (the match is in drop / match phase), gvOk (its hello's version is ours) }. The slot must be a guest slot of this match whose
 *  owner has LEFT (a bye from it, its presence gone, or the host's watchdog took the body) no more than REJOIN_MS ago, and the secret must hash
 *  to the slot's commitment. Returns { ok: true, slot } or { ok: false, why, retry } (retry: the slot's owner has not been seen leaving yet -
 *  a reload can beat its own presence-leave to the host, so the asker tries again a moment later). */
export function judgeRejoin(req, from, ctx) {
  ctx = ctx || {};
  if (!req) return { ok: false, why: "no request" };
  if (!ctx.live) return { ok: false, why: "no match in progress" };
  if (!ctx.gvOk) return { ok: false, why: "another game version" };
  const r = Array.isArray(ctx.roster) ? ctx.roster.find((x) => x && x.slot === req.slot) : null;
  if (!r || r.slot === 0) return { ok: false, why: "not a guest slot of this match" };
  if (r.peerId === from) return { ok: false, why: "already this peer's slot" };
  const want = ctx.keys && ctx.keys.get ? ctx.keys.get(req.slot) : null;
  if (!want || rejoinHash(req.key) !== want) return { ok: false, why: "wrong rejoin key" };
  let gone = ctx.goneAt ? ctx.goneAt["s" + req.slot] : null;
  // fix round (the intermittent ?room= rejoin): a page that closed without a bye (a crash, a killed tab) was only seen leaving by the host's
  // 12 s silence watchdog, and the asking page gave up after ~15 s of retries - on a loaded box the two raced. The right secret for the slot
  // AND a slot that has been silent for REJOIN_SILENT_MS is the leave: the window opens from the slot's last packet.
  if (gone == null && typeof ctx.silentMs === "number" && Number.isFinite(ctx.silentMs) && ctx.silentMs >= REJOIN_SILENT_MS) gone = ctx.nowMs - ctx.silentMs;
  if (gone == null) return { ok: false, why: "the slot's player has not left", retry: true };
  if (ctx.nowMs - gone > REJOIN_MS) return { ok: false, why: "rejoin window over" };
  return { ok: true, slot: req.slot };
}

/** HOST, LC-49 RECONNECT: may the body `id`, which the silent-guest watchdog gave to a bot at `takenAt`, go back to peer `from` whose state packet
 *  just arrived? ctx = { takenAt, nowMs, senderSlot (the roster slot of `from`), id, alive, isBot, rejoinedBy (the peer a rejoin gave the slot
 *  to, or null), from }. "ok" | "expired" (past REJOIN_MS: forget it) | "no". */
export function judgeReclaim(c) {
  c = c || {};
  if (typeof c.takenAt !== "number" || !c.alive || !c.isBot) return "no";
  if (!(c.senderSlot > 0) || "s" + c.senderSlot !== c.id) return "no";
  if (c.rejoinedBy != null && c.rejoinedBy !== c.from) return "no";
  if (c.nowMs - c.takenAt > REJOIN_MS) return "expired";
  return "ok";
}

// ── C-DBNO: knock and revive (owner OD-3: team modes only) ────────────────────────────────────────────────────────────────────────────
/** Bit 256 of the state packet's stance byte: the actor is DOWNED (crawling, bleeding out). Older peers ignore unknown bits. */
export const F_DOWNED = 256;
export const REVIVE_KINDS = ["down", "start", "cancel", "done"];
/** A "revive" body: { k, id (the downed actor), by (the reviver; the knocker for "down") }. null = drop. */
export function normRevive(d) {
  if (!d || typeof d !== "object" || !REVIVE_KINDS.includes(d.k)) return null;
  const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= 24;
  if (!idOk(d.id)) return null;
  if (d.k !== "down" && !idOk(d.by)) return null;
  return { k: d.k, id: d.id, by: idOk(d.by) ? d.by : null };
}
/** OWNER of the downed actor: is a "done" from `by` a real revive? `rec` = the "start" this client saw from that reviver ({ by, at }); the
 *  channel lasts reviveMs (K.REVIVE_S), relay jitter gets 750 ms. A done with no start, from another reviver, or too early is refused - the
 *  owner of an actor is the authority over its life, as it is over its HP (hitYou). */
export function reviveDoneOk(rec, by, nowMs, reviveMs) {
  if (!rec || rec.by !== by || typeof rec.at !== "number") return false;
  const need = (reviveMs > 0 ? reviveMs : 5000) - 750;
  return nowMs - rec.at >= need;
}
/** OWNER: how far (m) the reviver's last packet may be from the downed body for a "done": K.REVIVE_RANGE (sim's single source, D3;
 *  2 m when sim has none) + REVIVE_LAG_SLACK_M for the reviver's packet age. */
export const REVIVE_LAG_SLACK_M = 3;
export function reviveDoneRange(K) {
  const r = K && typeof K.REVIVE_RANGE === "number" && K.REVIVE_RANGE > 0 && K.REVIVE_RANGE < 50 ? K.REVIVE_RANGE : 2;
  return r + REVIVE_LAG_SLACK_M;
}

// ── LC-14: smoke relay ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A smoke cloud as it travels ({ x, y, z, r, rMax, t0, t1 } in match time, C-SMOKE / D1): r = the LIVE radius when it was sent, rMax = the
 *  full radius it grows to (weapons.js tickSmokes rewrites r from t0 + rMax on every client, so a relayed cloud grows exactly like the
 *  thrower's - without rMax it fell back to the send-time r and stayed at 35 % of its size on every other screen). A sender without rMax
 *  (r is then the full radius) is read as rMax = r. Finite, on the map (+-half), rMax 0.5..15 m with 0 <= r <= rMax, a life of at most 60 s.
 *  null = drop. */
export function normSmoke(d, half) {
  if (!d || typeof d !== "object") return null;
  const H = half > 0 ? half : 2000;
  const fin = (v, lim) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim;
  if (!fin(d.x, H) || !fin(d.z, H) || !fin(d.y, 5000) || !fin(d.t0, 1e6) || !fin(d.t1, 1e6) || !fin(d.r, 15)) return null;
  const rMax = d.rMax == null ? d.r : d.rMax;
  if (!(rMax >= 0.5 && rMax <= 15) || !(d.r >= 0 && d.r <= rMax) || !(d.t1 > d.t0) || d.t1 - d.t0 > 60) return null;
  const r2 = (v) => +(+v).toFixed(2);
  return { x: r2(d.x), y: r2(d.y), z: r2(d.z), r: r2(d.r), rMax: r2(rMax), t0: r2(d.t0), t1: r2(d.t1) };
}
/** At most this many relayed smokes alive per THROWER at once (D12: counted per `by`, not per sending peer - the host relays the smokes of
 *  every bot it simulates, and a cap per peer let a 7th host-side smoke vanish on the guests while it still blinded the host's bots). A guest
 *  can only name its own actor (senderMay), so for a guest this is still its own cap. */
export const SMOKE_MAX_PER_THROWER = 6;
/** (the old name: the cap is per thrower now) */
export const SMOKE_MAX_PER_SENDER = SMOKE_MAX_PER_THROWER;
/** Relayed smokes alive at once from every thrower together (a bound on the sight-line cost, far above play: 12 per client's own weapons.js). */
export const SMOKE_MAX_RELAYED = 48;
/** May a relayed smoke by `by` join `list` (W.smokes) at match time t? null = yes, else the reason it is refused. */
export function smokeRelayRoom(list, by, t) {
  let mine = 0, all = 0;
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || !x._net || x.t1 < t) continue;
    all++;
    if (x.by === by) mine++;
  }
  if (mine >= SMOKE_MAX_PER_THROWER) return "smoke flood (thrower)";
  if (all >= SMOKE_MAX_RELAYED) return "smoke flood (all)";
  return null;
}

// ── late-join loot sync (P23 fix round) ──────────────────────────────────────────────────────────────────────────────────────────────
/** The id prefix of the items a chest bursts into (loot.js openChest: "cb:<chest id>:<i>", a supply crate "sd:<n>:<i>"). */
export function chestItemPrefix(c) {
  if (!c || typeof c !== "object") return null;
  return c.supply ? "sd:" + c.n + ":" : typeof c.id === "string" ? "cb:" + c.id + ":" : null;
}
/** Is `id` an item a chest / supply crate bursts into (its take can arrive before that chest is open on this client)? */
export function isChestItem(id) { return typeof id === "string" && /^(cb|sd):/.test(id); }
/** Apply a host's late-join / rejoin loot sync ({ taken: [item ids], opened: [chest ids] }): the OPENED list first - an item a chest bursts
 *  into exists on this client only once that chest is open, so a take applied before the open was a no-op and the item came back as a ghost
 *  the moment the chest opened here - then the TAKEN list. Returns the chest items it took, which the caller keeps until their chest opens here
 *  (a supply crate that has not landed on this client yet opens later: loot.js pendingOpen). open(id) / take(id) are W.netOpenChest /
 *  W.netTakeItem. */
export function applyLootSync(loot, open, take) {
  const out = [];
  if (!loot || typeof loot !== "object") return out;
  for (const id of Array.isArray(loot.opened) ? loot.opened : []) if (typeof id === "string") open(id);
  for (const id of Array.isArray(loot.taken) ? loot.taken : []) { if (typeof id !== "string") continue; take(id); if (isChestItem(id)) out.push(id); }
  return out;
}
/** Takes kept for chests that are not open on this client yet: at most this many (oldest dropped). */
export const LOOT_DEFER_MAX = 512;

/** A live tab rewrites its rejoin record every 2 s, so another tab's record younger than this belongs to a tab that is still playing. */
export const REJOIN_LIVE_TAB_MS = 3000;
/** The rejoin candidates a page asks with for `room` (newest first, at most 3): this tab's own record (sessionStorage `own`) when it is for
 *  this room and fresh, then records other tabs of this browser left in localStorage (`list`) that STOPPED updating (younger than
 *  REJOIN_LIVE_TAB_MS = a tab still playing) - or that their tab marked `closed` as it went away (pagehide): such a record is a candidate at
 *  once, so the invite link opened in a new tab the moment the old one closed still gets its slot back. */
export function rejoinCandidates(room, own, list, nowMs) {
  const out = [];
  const fresh = (r) => r && r.room === room && Number.isInteger(r.slot) && typeof r.key === "string" && typeof r.at === "number" && nowMs - r.at <= REJOIN_MS + 15000;
  if (fresh(own)) out.push(own);
  const rest = (Array.isArray(list) ? list : []).filter((r) => fresh(r) && (r.closed === 1 || nowMs - r.at >= REJOIN_LIVE_TAB_MS) && !out.some((o) => o.slot === r.slot)).sort((a, b) => b.at - a.at);
  for (const r of rest) if (out.length < 3) out.push(r);
  return out;
}
/** The returning page re-reads the records: ms until the youngest record that is not a candidate YET (another tab's, fresh, not closed,
 *  younger than REJOIN_LIVE_TAB_MS - a tab killed without a pagehide, or one still closing) becomes one; -1 when there is none to wait for.
 *  A tab that really is still playing keeps its record young, so the caller caps how often it re-reads (REJOIN_RESCANS). */
export function rejoinRescanMs(room, own, list, nowMs) {
  const have = rejoinCandidates(room, own, list, nowMs);
  let best = -1;
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.room !== room || !Number.isInteger(r.slot) || typeof r.key !== "string" || typeof r.at !== "number" || r.closed === 1) continue;
    const age = nowMs - r.at;
    if (age < 0 || age >= REJOIN_LIVE_TAB_MS || have.some((o) => o.slot === r.slot)) continue;
    const ms = REJOIN_LIVE_TAB_MS - age + 50;
    if (best < 0 || ms < best) best = ms;
  }
  return best;
}
/** How many times the returning page re-reads the records while it has no candidate (each wait <= REJOIN_LIVE_TAB_MS). */
export const REJOIN_RESCANS = 3;

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
  // LC-49: the rejoin record is refreshed from update() every 2 s - which a hidden tab does not run (no rAF). A tab that is hidden and then
  // closed (or killed) writes its record (time + kit) the moment it is hidden / unloaded, so the page that comes back asks with a fresh one.
  if (typeof window !== "undefined" && window.addEventListener && typeof document !== "undefined") {
    // pagehide marks the record `closed`: the tab is going away, so a new tab need not wait REJOIN_LIVE_TAB_MS before it asks with it (a
    // tab that comes back from the back/forward cache rewrites it from update() within 2 s, unmarked). Only hidden = maybe still playing.
    const flushRejoin = (closed) => {
      try {
        if (S && S.started && S.net && !S.net.isHost() && !S.rejoin && W.player && W.player.alive && (W.phase === "match" || W.phase === "drop")) { S.rjSavedAt = performance.now(); saveRejoin(W, closed); }
      } catch (e) {}
    };
    window.addEventListener("pagehide", () => flushRejoin(true));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushRejoin(false); });
  }
  // a chest / supply crate that opened HERE after another client took items out of it (late join, a crate that landed late here, a take
  // that beat the chest's own open message): those items go at once - never a ghost item that cannot be picked up anywhere else
  W.events.on("chestOpened", (a, c) => {
    if (!S || !S.lootDefer || !S.lootDefer.size || !W.netTakeItem) return;
    const pre = chestItemPrefix(c);
    if (!pre) return;
    for (const id of [...S.lootDefer]) if (id.startsWith(pre)) { S.lootDefer.delete(id); W.netTakeItem(id); }
  });
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
  // REMOTE FOLEY (parity LC-09). A remote actor never runs the local heal / reload code, so its heal hum and reload clicks only ever played on
  // the machine that simulated it: on a guest, every host bot reloaded and healed in silence. The two events are relayed like gunfire (only for
  // actors simulated here, only when a remote human is near enough to hear: audio plays both within 25 m) and replayed through the same
  // events (healStart / reloadStart) on the other clients, where audio.js already voices them positionally.
  const nearRemoteHuman = (a, r) => {
    if (!W.player) return false;
    for (const h of W.actors) if (h.netRemote && !h.isBot && h.alive && a.pos.distanceToSquared(h.netTarget ? h.netTarget.pos : h.pos) <= r * r) return true;
    return false;
  };
  W.events.on("healStart", (a, cid) => { if (S && S.started && a && !a.netRemote && nearRemoteHuman(a, 60)) qsend("heal", { id: a.id, c: String(cid || "") }); });
  W.events.on("reloadStart", (a, wpn) => { if (S && S.started && a && !a.netRemote && wpn && nearRemoteHuman(a, 60)) qsend("rld", { id: a.id, w: wpn.id }); });
  // REMOTE EXPLOSIONS (parity LC-14). explode() only runs for rounds simulated HERE, so a grenade-launcher shell or a frag thrown by a remote
  // player (or, on a guest, by a host bot) burst on its owner's screen and nowhere else - the damage arrived (hitYou), the blast never did. Relayed
  // once per blast within 250 m of a remote human and replayed as the same "explosion" event (fx.js + audio.js draw and voice it); the replay is
  // tagged { net: true } so it is never relayed again.
  W.events.on("explosion", (pos, r, meta) => {
    if (!S || !S.started || !pos || (meta && meta.net) || !W.player) return;
    let near = false;
    for (const h of W.actors) if (h.netRemote && !h.isBot && h.alive) {
      const p = h.netTarget ? h.netTarget.pos : h.pos;
      if ((p.x - pos.x) ** 2 + (p.z - pos.z) ** 2 <= 250 * 250) { near = true; break; }
    }
    if (near) qsend("boom", { x: +(+pos.x).toFixed(2), y: +(+pos.y).toFixed(2), z: +(+pos.z).toFixed(2), r: +(+r || 3.5).toFixed(2) });
  });
  // C-DBNO (P3, lane net slice). The OWNER of an actor (its human, or the host for a bot) runs the knock / bleed / revive state machine
  // (player.js); the others see the downed bit on the state packet (pack, F_DOWNED) and these one-off "revive" messages - sent at once, never
  // batched (rare, and a revive is someone's life):
  //   down   { id, by }  this client's actor was knocked (by = the knocker): kill feed + knock cue at once instead of on the next state tick
  //   start  { id, by }  a reviver simulated HERE began the channel on a downed actor - its owner may accept a "done" K.REVIVE_S later
  //   cancel { id, by }  ...and let go
  //   done   { id, by }  ...and finished: the downed actor's owner revives it (reviveDoneOk)
  // The replays below are emitted with { net: true } and never relayed again.
  const idOf = (x) => (x && typeof x === "object" ? x.id : typeof x === "string" ? x : null);
  const localSim = (a) => !!a && typeof a === "object" && !a.netRemote && !a.isDummy;
  W.events.on("actorDowned", (a, src, meta) => {
    if (!S || !S.started || !localSim(a) || (meta && meta.net)) return;
    send("revive", { k: "down", id: a.id, by: idOf(src) });
  });
  W.events.on("reviveStart", (by, target, meta) => {
    if (!S || !S.started || !localSim(by) || !idOf(target) || (meta && meta.net)) return;
    (S.reviveOut = S.reviveOut || new Map()).set(by.id, idOf(target));
    send("revive", { k: "start", id: idOf(target), by: by.id });
  });
  W.events.on("reviveCancel", (by, target, meta) => {
    if (!S || !S.started || !localSim(by) || (meta && meta.net)) return;
    const tid = idOf(target) || (S.reviveOut && S.reviveOut.get(by.id));
    if (S.reviveOut) S.reviveOut.delete(by.id);
    if (tid) send("revive", { k: "cancel", id: tid, by: by.id });
  });
  W.events.on("actorRevived", (a, by, meta) => {
    if (!S || !S.started || !a || (meta && meta.net)) return;
    const b = by && typeof by === "object" ? by : W.actorById && W.actorById.get(by);
    if (b && S.reviveOut) S.reviveOut.delete(b.id);
    // the reviver's client finished the channel on a body it does not own: the owner applies it
    if (a.netRemote && localSim(b)) send("revive", { k: "done", id: a.id, by: b.id });
  });
  // LC-14 THROWS: a frag / smoke thrown by an actor simulated here, relayed like gunfire (cosmetic, rides the state packet, only when a remote
  // human is near enough to see it) and replayed as the same "grenadeThrown" event tagged { net: true }: a listener may draw the arc or play
  // the toss, it must never spawn a damaging round (the blast arrives as "boom", the damage as hitYou).
  W.events.on("grenadeThrown", (a, wid, o, v, meta) => {
    if (!S || !S.started || !localSim(a) || (meta && meta.net) || !o || !v) return;
    if (!nearRemoteHuman(a, 250)) return;
    const f = (x) => +(+x || 0).toFixed(2);
    qsend("nade", { id: a.id, w: String(wid || "").slice(0, 16), x: f(o.x), y: f(o.y), z: f(o.z), vx: f(v.x), vy: f(v.y), vz: f(v.z) });
  });
  // PING (parity LC-07): hud.js builds the ping and calls this; one per second PER STREAM (PingOutbox: world pings and map pins are limited
  // separately), sent at once (or, over budget, riding the state envelope like chat). A map pin over the rate is HELD and sent the moment
  // the limit frees (newest wins) - dropping it left the squad on the player's previous pin while their own map showed the new one.
  // Returns true when it went out or is held to go out. Receivers show it only for their own team (onMsg "ping").
  W.sendPing = (p) => {
    if (!S || !S.started || !W.player || !p) return false;
    const body = normPing(p, W.map && W.map.size ? W.map.size / 2 + 50 : 2000);
    if (!body) return false;
    const box = S.pingOut = S.pingOut || new PingOutbox();
    const r = box.offer("me:" + body.src, body, performance.now(), body.src === "m");
    if (r.now) { pingWire(W, r.now); return true; }
    if (r.wait == null) return false;
    S.pingHeld = (S.pingHeld || 0) + 1;
    setTimeout(() => flushPingOut(W, box, true), r.wait + 5);          // update() flushes too (a throttled timer cannot strand the pin)
    return true;
  };
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
    if (victim === W.player) clearRejoin();       // LC-49: nothing to come back to
    if (S.reviveIn) delete S.reviveIn[victim.id];
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
const CRITICAL_MSG = { state: 1, bots: 1, hitYou: 1, died: 1, start: 1, hello: 1, bye: 1, takeover: 1, sync: 1, ev: 1, rtc: 1, refuse: 1, mapfail: 1,
  revive: 1, smoke: 1, rejoin: 1, room: 1 };      // P23: a life (revive), a sight line (smoke), a slot (rejoin), the room's team mode - all rare

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

/** LC-07: one ping on the wire. ON THE WIRE AT ONCE when the outbound budget has room (a ping is <= 2 messages a second per human: one world
 *  ping + one pin), else it boards the next state packet like chat (free). Riding the envelope only made its latency the host's FRAME
 *  cadence: measured 921 ms on a starved box against the 500 ms bar, where a direct send is one relay hop. */
function pingWire(W, body) {
  if (!S || !W.player) return;
  const msg = Object.assign({ id: W.player.id }, body);
  if (sendBudgetLeft() > 2) send("ping", msg); else qsend("ping", msg);
}
/** LC-07: send the held map pin once its limit frees (timer + update()). `box` pins the session: a rematch / leave replaced S.pingOut, so a
 *  pin held in the last match never lands in the next one. */
function flushPingOut(W, box, timer) {
  if (!S || !S.started || !box || S.pingOut !== box || !box.pending) return;
  for (const [, body] of box.due(performance.now())) { pingWire(W, body); S.pingHeldSent = (S.pingHeldSent || 0) + 1; }
  if (timer && box.pending) setTimeout(() => flushPingOut(W, box, true), box.waitMs("me:m", performance.now()) + 5);   // timer early: re-arm
}
/** LC-07, receiving side: a squad-mate's map pin that came in faster than the receive limit is shown when that limit frees (newest wins),
 *  never dropped - the sender coalesces too, but relay jitter can bunch two of its 1/s sends closer than the receive limit. */
function flushPingIn(W, box, timer) {
  if (!S || !S.started || !box || S.pingIn !== box || !box.pending) return;
  for (const [stream, body] of box.due(performance.now())) W.events.emit("netPing", Object.assign({ owner: stream.slice(0, stream.lastIndexOf(":")) }, body));
  if (timer && box.pending) setTimeout(() => flushPingIn(W, box, true), 60);
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
/** The squad screens' stylesheet (LC-85), injected once: the HUD's look (hud.js PANEL / BTN / the menu's ghost buttons) for the lobby, the
 *  rematch wait card and the map-fallback card. Fonts are hud.js's (Orbitron + Rajdhani, linked by its menu before any squad screen opens);
 *  the stacks fall back to the HUD's own system faces. */
const NET_CSS = `
.lcn-veil { position: absolute; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; pointer-events: auto;
  background: radial-gradient(ellipse at 50% 40%, rgba(10,24,48,0.72) 0%, rgba(3,8,16,0.92) 100%); color: #eaf2ff;
  font-family: Rajdhani, 'Segoe UI', system-ui, sans-serif; }
.lcn-box { box-sizing: border-box; max-width: calc(100vw - 32px); padding: 28px 38px 24px; border-radius: 16px;
  background: linear-gradient(165deg, rgba(12,24,44,0.86) 0%, rgba(8,16,30,0.92) 100%); border: 1px solid rgba(140,200,255,0.28);
  box-shadow: 0 12px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(0,0,0,0.25); }
.lcn-title { font-family: Orbitron, 'Segoe UI', system-ui, sans-serif; font-size: 20px; font-weight: 900; letter-spacing: 3px; margin-bottom: 12px;
  background: linear-gradient(180deg, #ffffff 10%, #a8d4ff 60%, #6ab6ff 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lcn-sub { font-size: 15px; font-weight: 600; letter-spacing: .3px; line-height: 1.45; color: #c8dcf2; margin-bottom: 14px; }
.lcn-sub b { color: #fff; font-family: Orbitron, 'Segoe UI', system-ui, sans-serif; font-weight: 800; }
.lcn-row { display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.lcn-btn { font-family: Rajdhani, 'Segoe UI', system-ui, sans-serif; font-weight: 700; font-size: 14px; letter-spacing: 1.5px; text-transform: uppercase;
  padding: 10px 20px; border-radius: 12px; cursor: pointer; color: #cfe4ff; background: rgba(255,255,255,0.06); border: 1px solid rgba(140,200,255,0.2);
  transition: transform .12s ease, filter .12s, border-color .15s; }
.lcn-btn:hover { transform: translateY(-1px); filter: brightness(1.12); border-color: rgba(140,200,255,0.45); }
.lcn-btn:active { transform: translateY(1px); }
.lcn-btn:disabled { opacity: .45; cursor: default; transform: none; filter: none; }
.lcn-btn.pri { font-family: Orbitron, 'Segoe UI', system-ui, sans-serif; font-weight: 800; font-size: 13px; letter-spacing: 2px; color: #fff;
  background: linear-gradient(180deg, #6ec4ff, #2f7fd6); border-color: rgba(160,215,255,0.55); box-shadow: 0 0 18px rgba(60,150,255,0.28); }
.lcn-btn.go { font-family: Orbitron, 'Segoe UI', system-ui, sans-serif; font-weight: 900; font-size: 15px; letter-spacing: 2.5px; padding: 12px 34px;
  color: #06140c; background: linear-gradient(180deg, #7cf0a8, #34c46e); border-color: rgba(160,255,200,0.6); box-shadow: 0 0 22px rgba(70,220,130,0.3); }
.lcn-btn.warn { color: #1a1004; background: linear-gradient(180deg, #ffc98a, #ff9f45); border-color: rgba(255,210,150,0.7); }
.lcn-code { font-family: Orbitron, 'Segoe UI', system-ui, sans-serif; font-weight: 800; font-size: 15px; letter-spacing: 3px; text-align: center; text-transform: uppercase;
  width: 104px; padding: 9px 8px; border-radius: 12px; border: 1px solid rgba(140,200,255,0.3); background: rgba(0,0,0,0.42); color: #fff; outline: none; }
.lcn-code:focus { border-color: rgba(120,200,255,0.7); box-shadow: 0 0 0 2px rgba(87,176,255,0.25); }
.lcn-roster { font-size: 15px; font-weight: 700; line-height: 1.65; margin: 2px 0 12px; min-height: 22px; color: #dfeaff; }
.lcn-badge { font-family: Orbitron, 'Segoe UI', system-ui, sans-serif; font-size: 9.5px; font-weight: 800; letter-spacing: 1.2px; opacity: .62; margin-left: 8px; }
.lcn-note { font-size: 14px; font-weight: 600; line-height: 1.45; margin: 0 0 10px; color: #ffb060; }
`;
function ensureNetStyles() {
  if (typeof document === "undefined" || document.getElementById("lc-net-css")) return;
  const st = document.createElement("style");
  st.id = "lc-net-css";
  st.textContent = NET_CSS;
  document.head.appendChild(st);
}

function openLobby(W, sel) {
  // clickable overlay: pointer lock would send every click to the canvas
  try { document.exitPointerLock && document.exitPointerLock(); } catch (e) {}
  // LC-85: the squad panel wore system-ui and flat buttons, the one screen in the game that did not look like the game. It now uses the HUD's
  // fonts (Orbitron titles, Rajdhani body), its glass panel and its button shapes (ensureNetStyles). The box keeps its inline min-width and its
  // child order (title, status, buttons row, roster, notices, START) - _harness/squadguard_live.py finds the box and the status line by them.
  ensureNetStyles();
  const root = document.createElement("div");
  root.className = "lcn-veil";
  root.dataset.net = "lobby";
  W.kernel.parent.appendChild(root);
  const box = document.createElement("div");
  box.className = "lcn-box";
  Object.assign(box.style, { textAlign: "center", minWidth: "380px" });
  root.appendChild(box);
  const html = (s) => { const d = document.createElement("div"); d.innerHTML = s; box.appendChild(d); return d; };
  html(`<div class="lcn-title">PLAY WITH FRIENDS</div>`);
  const status = html(`Create a room or join a friend's code. Everyone else stays a bot.`);
  status.className = "lcn-sub";              // on the OUTER line: status.textContent / innerHTML rewrite its content all through the lobby
  const row = document.createElement("div");
  row.className = "lcn-row";
  box.appendChild(row);
  const mk = (label, primary) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = primary ? "lcn-btn pri" : "lcn-btn";
    row.appendChild(b);
    return b;
  };
  const createB = mk("CREATE ROOM", true);
  const codeInp = document.createElement("input");
  codeInp.className = "lcn-code";
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
  rosterEl.className = "lcn-roster";
  box.appendChild(rosterEl);
  // Notices (textContent only): why a guest was left out / refused. A separate line, because `status` is rewritten on every peer change.
  const noteEl = document.createElement("div");
  noteEl.className = "lcn-note";
  noteEl.style.display = "none";
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
    // LC-11: only peers still in the room (a friend who closed the tab is no longer listed, and gets no slot at START); a peer on another
    // world version stays listed with its badge after it leaves, so the host can still read why it is not in the match
    const nowP = performance.now();
    const all = Object.keys(S.peers).filter((pid) => S.hs.isPresent(pid, nowP) || S.hs.gvOf(pid) !== S.hs.gv).concat([S.net.id]).sort();
    const badge = (s) => `<span class="lcn-badge">${s}</span>`;
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
    paintMode();                 // C-MODE: AUTO's pick and the too-small buttons follow the head count
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
      reloadB.className = "lcn-btn warn";
      reloadB.style.marginBottom = "12px";
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
  startB.className = "lcn-btn go";
  Object.assign(startB.style, { display: "none", marginTop: "6px" });
  box.appendChild(startB);

  // C-MODE (P3, owner OD-4): the TEAM mode of the room. The host picks it (AUTO = the smallest mode that holds everyone in the room; a pick too
  // small for the room is played as the smallest that holds it - resolveTeamMode); the guests read the host's pick ("room" message). Every human
  // in the room is one team; the boot fills the team's other seats with bot teammates. Placed AFTER the START button so the box keeps the
  // child order squadguard_live.py reads (title, status, buttons row, roster, notices, START).
  // D5: the menu's team pick comes along - the SQUAD UP button sends only { mode } (hud.js), and the pick lives in W.settings.teamMode (the
  // mode card writes it), so a menu pick of SQUADS is the room's starting pick instead of AUTO.
  let teamWant = normTeamMode(sel && (sel.teamMode || sel.team)) || normTeamMode(W.settings && W.settings.teamMode);
  if (teamWant === "solo") teamWant = null;           // a room is for playing together: solo in a room = AUTO
  const modeRow = document.createElement("div");
  modeRow.className = "lcn-row";
  modeRow.setAttribute("data-net-teammode", "");
  Object.assign(modeRow.style, { display: "none", marginTop: "12px", marginBottom: "0" });
  box.appendChild(modeRow);
  const modeLbl = document.createElement("span");
  modeLbl.className = "lcn-badge";
  Object.assign(modeLbl.style, { opacity: "0.8", marginLeft: "0", fontSize: "10.5px" });
  modeRow.appendChild(modeLbl);
  const MODE_LABEL = { solo: "SOLO", duo: "DUOS", trio: "TRIOS", squad: "SQUADS" };
  const modeBtns = [];
  for (const m of [null, "duo", "trio", "squad"]) {
    const b = document.createElement("button");
    b.className = "lcn-btn";
    Object.assign(b.style, { padding: "7px 13px", fontSize: "12.5px" });
    b._mode = m;
    b.onclick = () => { teamWant = m; paintMode(); sendRoom(); };
    modeRow.appendChild(b);
    modeBtns.push(b);
  }
  /** how many humans the host's START would roster right now (itself included) */
  const humansNow = () => (S && S.hs ? S.hs.planStart(S.peers, MAX_GUESTS, performance.now()).roster.length : 1);
  function paintMode() {
    if (!S || !S.net || !S.net.room) { modeRow.style.display = "none"; return; }
    modeRow.style.display = "flex";
    const host = S.net.isHost();
    const n = host ? humansNow() : null;
    const eff = host ? resolveTeamMode(teamWant, n, sel && sel.mode, W.SIM) : (S.roomTm || null);
    modeRow.setAttribute("data-net-teammode", eff || "");
    modeLbl.textContent = host ? "TEAM MODE" : eff ? "TEAM MODE: " + MODE_LABEL[eff] + " (HOST'S PICK)" : "TEAM MODE: THE HOST PICKS";
    for (const b of modeBtns) {
      b.style.display = host ? "" : "none";
      if (!host) continue;
      const size = b._mode ? (W.SIM && W.SIM.TEAM_SIZE ? W.SIM.TEAM_SIZE[b._mode] : TEAM_SIZE_DEF[b._mode]) : null;
      b.textContent = b._mode ? MODE_LABEL[b._mode] : "AUTO" + (teamWant == null ? " · " + MODE_LABEL[eff] : "");
      b.disabled = b._mode != null && size < n;            // too small for everyone here
      b.className = (b._mode === teamWant ? "lcn-btn pri" : "lcn-btn");
      b.title = b.disabled ? "This room has " + n + " players" : "";
    }
  }
  /** HOST: tell the room the pick (on change, and to each newcomer) */
  function sendRoom() {
    if (!S || !S.net || !S.net.isHost() || S.started) return;
    const n = humansNow();
    send("room", { tm: resolveTeamMode(teamWant, n, sel && sel.mode, W.SIM), want: teamWant || "auto" });
  }

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
    // LC-49 rejoin: this tab's secret for this room; only its hash (rk) ever goes on the wire, until a reloaded page asks for its slot back
    S.rjSecret = newRejoinSecret();
    S.rk = rejoinHash(S.rjSecret);
    S.paintMode = paintMode;       // C-MODE: the "room" message repaints the guest's team-mode line through this
    S.sendRoom = sendRoom;         // C-MODE: the host tells each newcomer its pick
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
    net.on("peer", ({ count, ids }) => {
      if (S !== sess) return;
      // LC-11: the presence list is who is still in the room. A peer that left is dropped from the lobby roster and from the START plan
      // (SquadHandshake.isPresent); mid-match it lets the host's watchdog see a guest that is gone before it ever sent a state packet.
      if (Array.isArray(ids)) {
        const gone = S.hs.onPresence(ids);
        if (gone.length) S.presenceLeft = (S.presenceLeft || []).concat(gone.map((p) => ({ peerId: p, at: Math.round(performance.now()) }))).slice(-16);
        // LC-49: a squad-mate who left mid-match may come back for its slot within REJOIN_MS (the clock starts here, or at its bye)
        if (gone.length && S.started && S.cfg && Array.isArray(S.cfg.roster)) {
          for (const r of S.cfg.roster) if (r && r.slot > 0 && gone.includes(r.peerId)) markGone(r.slot);
          for (const p of gone) { try { S.rtc && S.rtc.removePeer(p); } catch (e) {} }
        }
        // a guest waiting to "run it back" whose host has gone will wait forever: say so on the card (its MAIN MENU button still works)
        const hp = S.cfg && Array.isArray(S.cfg.roster) && S.cfg.roster[0] ? S.cfg.roster[0].peerId : null;
        if (_waitCard && hp && gone.includes(hp)) {
          const sub = _waitCard.querySelector(".lcn-sub");
          if (sub) sub.textContent = "The host has left the room, so there is no next match to join. Head back to the menu to play on.";
          _waitCard.setAttribute("data-net-rematch-wait", "host-left");
        }
      }
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
    // LC-49 REJOIN: a page that played in this room a moment ago (this tab's record, or one a closed tab of this browser left) asks for its
    // slot back in its hello; the host answers "rejoin" ok (the match's start) or no (why). Asked again every REJOIN_ASK_EVERY_MS while the
    // host has not yet seen the old page leave (a reload can beat its own presence-leave), for the whole rejoin window (REJOIN_ASK_TRIES; it
    // was 6 tries = 15 s, which a host that only learns of a crashed tab from its 12 s silence watchdog could miss on a loaded box).
    // The records are read again on every ask (second fix pass): a tab closed a moment ago left a record only ms old - marked `closed` on
    // pagehide, but a killed tab's is unmarked and younger than REJOIN_LIVE_TAB_MS - so a page with no candidate yet re-reads the records
    // when the youngest one comes of age (rejoinRescanMs, at most REJOIN_RESCANS times) and starts asking then; until it has given up, the
    // host's "busy" (that first hello carried no rj) is held back (S.rjBusy), not shown.
    const readCands = () => (asHost ? [] : rejoinCandidates(net.room, rjRead(rjSS(), RJ_SS), rjRead(rjLS(), RJ_LS + net.room), Date.now()));
    const mergeCands = (old, now) => { const out = now.slice(0, 3); for (const c of old || []) if (out.length < 3 && !out.some((o) => o.slot === c.slot)) out.push(c); return out; };
    const asking = () => {
      status.innerHTML = `Room <b style="letter-spacing:3px">${net.room}</b> — rejoining your match…<br>Waiting for the host to start…`;
      status.setAttribute("data-net-rejoin", "asking");
    };
    const ask = () => {
      if (S !== sess || !S.rejoinAsk || S.started) return;
      if (S.rejoinAsk.tries >= REJOIN_ASK_TRIES) {
        S.rejoinAsk = null;
        status.innerHTML = `Room <b style="letter-spacing:3px">${net.room}</b> — could not get your place back.<br>Waiting for the host to start…`;
        status.setAttribute("data-net-rejoin", "gave-up");
        return;
      }
      S.rejoinAsk.tries++;
      S.rejoinAsk.cands = mergeCands(S.rejoinAsk.cands, readCands());
      send("hello", Object.assign(myHello(), { rj: S.rejoinAsk.cands.map((c) => ({ slot: c.slot, key: c.key })) }));
      setTimeout(ask, REJOIN_ASK_EVERY_MS);
    };
    const startAsk = (cands, first) => {
      S.rejoinAsk = { cands, tries: 1, at: performance.now() };
      S.rjBusy = null;
      if (!first) { send("hello", Object.assign(myHello(), { rj: cands.map((c) => ({ slot: c.slot, key: c.key })) })); asking(); }
      setTimeout(ask, REJOIN_ASK_EVERY_MS);
    };
    const cands = readCands();
    const hello = myHello();
    if (cands.length) {
      hello.rj = cands.map((c) => ({ slot: c.slot, key: c.key }));
      startAsk(cands, true);
    } else if (!asHost) {
      const rescan = (n) => {
        if (S !== sess || S.started || S.rejoinAsk) return;
        const c2 = readCands();
        if (c2.length) { S.rjRescan = 0; startAsk(c2, false); return; }
        const ms = n < REJOIN_RESCANS ? rejoinRescanMs(net.room, rjRead(rjSS(), RJ_SS), rjRead(rjLS(), RJ_LS + net.room), Date.now()) : -1;
        if (ms >= 0) { S.rjRescan = 1; setTimeout(() => rescan(n + 1), ms); return; }
        S.rjRescan = 0;
        if (S.rjBusy) { const b = S.rjBusy; S.rjBusy = null; onRejoinAnswer(W, b.from, b.d); }   // the host's held-back "busy"
      };
      const ms0 = rejoinRescanMs(net.room, rjRead(rjSS(), RJ_SS), rjRead(rjLS(), RJ_LS + net.room), Date.now());
      if (ms0 >= 0) { S.rjRescan = 1; setTimeout(() => rescan(1), ms0); }
    }
    send("hello", hello);
    status.innerHTML = `Room <b style="letter-spacing:3px">${net.room}</b> — ` + (cands.length ? "rejoining your match…" : "share this code.") +
      (asHost ? "" : "<br>Waiting for the host to start…");
    if (cands.length) status.setAttribute("data-net-rejoin", "asking");
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
    const plan = S.hs.planStart(S.peers, MAX_GUESTS, performance.now());
    const pace = sel.mode === "practice" ? "standard" : sel.mode;
    // C-MODE: the team mode rides the start next to the pace (`mode` stays the pace, as every build reads it); each roster entry names its teamId
    const teamMode = resolveTeamMode(teamWant, plan.roster.length, pace, W.SIM);
    const roster = rosterWithTeams(plan.roster, teamMode, W.SIM);
    const cfg = S.hs.startMsg({ seed: (Math.random() * 0xffffffff) >>> 0, mapId: W.randomMap(), mode: pace, teamMode, teamWant: teamWant || "auto", roster });
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
// a rostered guest that never sends a state packet is handed to a bot this long after the host's match went live (LC-11, update()). The
// slowest measured cold match load is ~30 s (parity audit, cold Quick 29.7 s); twice that is not a load any more.
const NEVER_SEEN_MS = 60000;

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

// ── P23 wiring helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Our hello: the handshake's body + this tab's rejoin commitment (LC-49). */
function myHello() { return Object.assign(S.hs.helloMsg(), S.rk ? { rk: S.rk } : {}); }

/** LC-49: roster slot `slot`'s player left (bye / presence / watchdog take-over): the REJOIN_MS window opens (the earliest sighting counts). */
function markGone(slot) {
  if (!S || !(slot > 0)) return;
  const g = S.goneAt = S.goneAt || {};
  if (g["s" + slot] == null) g["s" + slot] = performance.now();
}

// LC-49 rejoin record, kept by the guest's own tab: sessionStorage (survives a reload of this tab) + a localStorage copy per room (survives
// closing the tab and opening the invite link in a new one). Every access is guarded: storage can be missing, full or blocked.
const RJ_SS = "lc.rejoin.v1", RJ_LS = "lc.rejoin.v1.";
function rjSS() { try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch (e) { return null; } }
function rjLS() { try { return typeof window !== "undefined" ? window.localStorage : null; } catch (e) { return null; } }
function rjRead(store, key) { try { const s = store && store.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function rjWrite(store, key, v) { try { if (!store) return; if (v == null) store.removeItem(key); else store.setItem(key, JSON.stringify(v)); } catch (e) {} }
/** GUEST: write this tab's rejoin record (room, slot, secret, kit; `closed` = written on pagehide, the tab is going away). */
function saveRejoin(W, closed) {
  if (!S || !S.started || S.net.isHost() || S.mySlot == null || !(S.mySlot > 0) || !S.rjSecret || !S.net.room) return;
  const p = W.player;
  let inv = null;
  try { if (p && p.inventory) inv = JSON.parse(JSON.stringify({ slots: p.inventory.slots, active: p.inventory.active, ammo: p.inventory.ammo })); } catch (e) {}
  const rec = { room: S.net.room, slot: S.mySlot, key: S.rjSecret, name: S.myName, gv: S.gv, seed: S.cfg ? S.cfg.seed : null, at: Date.now(), inv };
  if (closed) rec.closed = 1;
  rjWrite(rjSS(), RJ_SS, rec);
  const now = Date.now();
  const list = (rjRead(rjLS(), RJ_LS + rec.room) || []).filter((x) => x && x.slot !== rec.slot && now - (x.at || 0) < REJOIN_MS + 15000);
  list.push(rec);
  rjWrite(rjLS(), RJ_LS + rec.room, list.slice(-4));
}
/** Forget this tab's rejoin record for the current room (left on purpose, died, or the room is gone). */
function clearRejoin() {
  const own = rjRead(rjSS(), RJ_SS);
  const room = S && S.net && S.net.room ? S.net.room : own && own.room;
  if (!room) return;
  if (own && own.room === room) rjWrite(rjSS(), RJ_SS, null);
  const slot = S && S.mySlot != null ? S.mySlot : own && own.slot;
  const list = (rjRead(rjLS(), RJ_LS + room) || []).filter((x) => x && x.slot !== slot);
  rjWrite(rjLS(), RJ_LS + room, list.length ? list : null);
}

/** LC-14 / C-SMOKE: relay each smoke cloud this client made (no _net mark) once. Its owner is the thrower when weapons.js names it, else this
 *  client's own actor (senderMay binds a smoke to the sender's slot or, on the host, a bot). */
function relaySmokes(W) {
  const own = W.player ? W.player.id : null;
  for (const s of W.smokes) {
    if (!s || s._net || s._tx) continue;
    s._tx = 1;
    const body = normSmoke(s, W.map && W.map.size ? W.map.size / 2 + 50 : 2000);
    if (!body) continue;
    let by = s.by || s.ownerId || s.owner || own;
    if (typeof by === "object" && by) by = by.id;
    const a = by && W.actorById ? W.actorById.get(by) : null;
    if (!a || a.netRemote || (a !== W.player && !(S.net.isHost() && a.isBot))) by = own;
    send("smoke", Object.assign(body, { by }));
  }
  // remote clouds this file added: dropped a second after they end (weapons.js prunes its own)
  // (in place: weapons.js / fx.js / maps.js may hold the array itself)
  for (let i = W.smokes.length - 1; i >= 0; i--) { const x = W.smokes[i]; if (x && x._net && x.t1 < W.t - 1) W.smokes.splice(i, 1); }
}

/** Does this client own actor `a`'s life? Its own player, or (host) a bot it simulates. */
function ownsActor(W, a) { return !!a && (a === W.player || (S && S.net.isHost() && a.isBot && !a.netRemote)); }

/** C-DBNO, a "revive" message (sender already bound by senderMay). */
function onRevive(W, from, d) {
  const r = normRevive(d);
  if (!r) { reject("revive", from, "malformed revive"); return; }
  const a = W.actorById && W.actorById.get(r.id);
  if (!a || !a.alive) return;
  const by = r.by && W.actorById ? W.actorById.get(r.by) : null;
  const K = W.SIM || {};
  if (r.k === "down") {
    // the owner's knock, at once (the bit follows on its state packets): kill feed + cue
    if (!a.netRemote) return;
    if (!a.downed) { a.downed = true; a.downedT = W.t; }
    W.events.emit("actorDowned", a, by || r.by, { net: true });
    return;
  }
  if (!by || !by.netRemote) return;                       // a reviver this client simulates never needs its own message back
  if (r.k === "start" || r.k === "cancel") {
    if (r.k === "start" && ownsActor(W, a)) (S.reviveIn = S.reviveIn || {})[a.id] = { by: by.id, at: performance.now() };
    if (r.k === "cancel" && S.reviveIn && S.reviveIn[a.id] && S.reviveIn[a.id].by === by.id) delete S.reviveIn[a.id];
    W.events.emit(r.k === "start" ? "reviveStart" : "reviveCancel", by, a, { net: true });
    return;
  }
  // done: only the owner applies it, only for a downed actor, only after this owner saw that reviver's start a full channel ago, and only
  // when the reviver is near (its last packet within K.REVIVE_RANGE (2 m) + REVIVE_LAG_SLACK_M of lag slack: reviveDoneRange)
  if (!ownsActor(W, a) || !a.downed) return;
  const rec = S.reviveIn && S.reviveIn[a.id];
  const reviveMs = (K.REVIVE_S > 0 ? K.REVIVE_S : 5) * 1000;
  if (!reviveDoneOk(rec, by.id, performance.now(), reviveMs)) { reject("revive", from, "revive done without a full channel"); return; }
  const bp = by.netTarget ? by.netTarget.pos : by.pos;
  if (bp && a.pos && bp.distanceTo(a.pos) > reviveDoneRange(K)) { reject("revive", from, "reviver too far"); return; }
  delete S.reviveIn[a.id];
  if (typeof W.reviveActor === "function") W.reviveActor(a, by);
  else {
    // (until player.js provides W.reviveActor: the contract's end state - up, 30 HP - and the event every lane listens for)
    a.downed = false; a.downedHp = 0;
    a.hp = Math.max(1, K.REVIVE_HP > 0 ? K.REVIVE_HP : 30);
    W.events.emit("actorRevived", a, by, { net: true });
  }
  (S.relayIn = S.relayIn || {}).revived = ((S.relayIn && S.relayIn.revived) || 0) + 1;
}

/** LC-49: an actor that died before this page (re)joined - out of the alive count, its body hidden, no kill-feed line, no death cue. */
function quietDeath(W, id, killer) {
  const a = typeof id === "string" && W.actorById ? W.actorById.get(id) : null;
  if (!a || !a.alive || a === W.player) return;
  a.alive = false; a.hp = 0; a.shield = 0;
  try { if (W.match && W.match.eliminate) W.match.eliminate(a.id, typeof killer === "string" ? killer : null, null, W.t); } catch (e) {}
  try { if (a.obj) a.obj.visible = false; } catch (e) {}
}
/** HOST: every registered actor that is dead, with its killer when known ([id, killer]). */
function deadList(W) {
  const out = [];
  for (const a of W.actors || []) if (!a.alive && !a.isDummy) out.push([a.id, a.lastAttacker && typeof a.lastAttacker === "string" ? a.lastAttacker : null]);
  return out;
}
/** HOST: the body of a slot as the rejoining page needs it. */
function bodySnap(a) {
  const f2 = (v) => +(+v || 0).toFixed(2);
  return { x: f2(a.pos.x), y: f2(a.pos.y), z: f2(a.pos.z), yw: +(+a.yaw || 0).toFixed(3), hp: Math.round(a.hp), sh: Math.round(a.shield),
    alive: a.alive ? 1 : 0, gl: a.gliding ? 1 : 0, dn: a.downed ? 1 : 0, dh: a.downed ? Math.round(a.downedHp || 0) : 0 };
}

/** HOST, a hello while our match runs: a squad-mate asking for its slot back (rj), or a friend who arrived late. */
function hostRejoinHello(W, from, d, hr) {
  const reqs = normRejoinReq(d && d.rj);
  const live = W.phase === "match" || W.phase === "drop";
  if (!reqs.length) { if (hr.first) send("rejoin", { k: "no", to: from, code: "busy", why: "a match is in progress in this room" }); return; }
  let last = null;
  for (const req of reqs) {
    const now = performance.now(), seen = S.lastSeen ? S.lastSeen["s" + req.slot] : null;
    const j = judgeRejoin(req, from, { roster: S.cfg && S.cfg.roster, keys: S.slotKeys, goneAt: S.goneAt, nowMs: now, live, gvOk: !hr.mismatch,
      silentMs: typeof seen === "number" ? now - seen : null });
    if (j.ok) { acceptRejoin(W, from, j.slot, hr); return; }
    last = j;
  }
  const retry = !!(last && last.retry) || (!live && W.phase !== "over" && W.phase !== "menu");
  (S.rejoinLog = S.rejoinLog || []).push({ from, why: last ? last.why : "?", at: Math.round(performance.now()) });
  if (S.rejoinLog.length > 16) S.rejoinLog.shift();
  send("rejoin", { k: "no", to: from, code: retry ? "retry" : "final", why: last ? last.why : "no request" });
}
/** HOST: give roster slot `slot` to peer `from`. The body stays under (or goes to) a bot brain until the page has loaded ("ready"). */
function acceptRejoin(W, from, slot, hr) {
  const id = "s" + slot;
  const old = S.cfg.roster.find((r) => r.slot === slot);
  const roster = S.cfg.roster.map((r) => (r.slot === slot ? Object.assign({}, r, { peerId: from }) : r));
  S.cfg = Object.assign({}, S.cfg, { roster });
  if (hr && hr.rec && hr.rec.rk) S.slotKeys.set(slot, hr.rec.rk);        // the new tab's commitment: a second reload can come back too
  if (S.goneAt) delete S.goneAt[id];          // (null when the slot was judged gone by its silence alone)
  // the old page's last packet must not trip the silence watchdog while the new page loads (its "ready" starts the slot's clock again)
  if (S.lastSeen) delete S.lastSeen[id];
  (S.rejoined = S.rejoined || {})[id] = { peer: from, at: performance.now(), ready: false };
  try { if (old && S.rtc) S.rtc.removePeer(old.peerId); } catch (e) {}
  const a = W.actorById && W.actorById.get(id);
  if (a && a.alive && a.netRemote) takeOverBody(W, a);                   // nobody drives it while the page loads: a bot does
  if (S.goneAt) delete S.goneAt[id];
  send("rejoin", { k: "ok", to: from, peer: from, slot, start: Object.assign({}, S.cfg, { rejoin: 1 }) });
  notify(W, String((old && old.name) || "A squad-mate").slice(0, 24) + " is reconnecting...");
  W.events.emit("squadRejoin", { slot, peerId: from, name: old ? old.name : null, stage: "ok" });
}
/** THE RETURNING PAGE: the host's answer to its rejoin hello (ok -> load the match; no -> say why, or wait for the next try). */
function onRejoinAnswer(W, from, d) {
  const st = S.status;
  if (d.k === "no") {
    if (d.code === "retry" && S.rejoinAsk) return;            // the old page has not been seen leaving yet: the next try (3 s) asks again
    // "busy" answers a hello WITHOUT rj (the host sends it for no other): while this page asks with rj it is a stale reply (the hello that
    // answered the host's own hello, or the first one before the records came of age) - the rj hellos get their own answers
    if (d.code === "busy" && S.rejoinAsk) return;
    if (d.code === "busy" && S.rjRescan) { S.rjBusy = { from, d }; return; }   // a closed tab's record may still come of age
    if (S.rejoinAsk || d.code === "busy") {
      S.rejoinAsk = null;
      if (d.code !== "busy") clearRejoin();
      if (st) {
        st.textContent = "";
        const b = document.createElement("b");
        b.style.color = "#ffb060";
        b.textContent = d.code === "busy" ? "A match is already running in this room." : "Couldn't get your place back.";
        st.appendChild(b);
        st.appendChild(document.createElement("br"));
        st.appendChild(document.createTextNode(d.code === "busy" ? "Stay here: when the host runs it back, you are in the next match." : "The host said: " + String(d.why || "").slice(0, 80) + ". Wait here for the next match."));
        st.setAttribute("data-net-rejoin", d.code === "busy" ? "busy" : "refused");
      }
    }
    return;
  }
  if (d.k !== "ok" || !S.rejoinAsk || !d.start || !Array.isArray(d.start.roster)) return;
  if (S.hs.judgeStart(d.start)) { reject("rejoin", from, "rejoin on another world version"); return; }
  const me = d.start.roster.find((r) => r && r.peerId === S.net.id);
  if (!me || me.slot !== d.slot) return;
  const cand = S.rejoinAsk.cands.find((c) => c.slot === d.slot);
  S.rejoinAsk = null;
  S.rejoin = { slot: d.slot, at: performance.now(), inv: cand ? cand.inv : null, state: "loading", tries: 0 };
  if (st) st.setAttribute("data-net-rejoin", "ok");
  W.events.emit("squadRejoin", { slot: d.slot, stage: "loading" });
  if (beginOnlineMatch(W, Object.assign({}, d.start, { rejoin: 1 })) !== false && S && S.root) S.root.remove();
}
/** In a match: the rejoin messages (sender bound by senderMay: "ready" from the slot's own peer, the rest from the host). */
function onRejoinInMatch(W, from, d) {
  if (!d) return;
  const slot = d.slot;
  if (d.k === "ok") {
    // a squad-mate is back under a new peer id: its slot answers to that peer from now on (sender binding, rejoin of its body)
    if (d.peer === S.net.id || !Number.isInteger(slot) || !Array.isArray(S.cfg && S.cfg.roster)) return;
    const old = S.cfg.roster.find((r) => r.slot === slot);
    if (!old || slot === 0) return;
    S.cfg = Object.assign({}, S.cfg, { roster: S.cfg.roster.map((r) => (r.slot === slot ? Object.assign({}, r, { peerId: d.peer }) : r)) });
    try { if (S.rtc) S.rtc.removePeer(old.peerId); } catch (e) {}
    if (S.rxGate) S.rxGate.reset(old.peerId);
    tellRoom(W, String(old.name || "A squad-mate").slice(0, 24) + " is reconnecting...", "rj" + slot);
    return;
  }
  if (d.k === "ready" && S.net.isHost()) {
    const id = "s" + slot, a = W.actorById && W.actorById.get(id);
    const rj = S.rejoined && S.rejoined[id];
    if (!a || !rj || rj.peer !== from) return;
    const now = performance.now();
    if (!rj.ready) {
      rj.ready = true; rj.readyAt = now;
      if (a.alive) {
        // the body is the human's again: its brain idles (bots.js skips netRemote actors), the page drives it from its next state packet
        a.isBot = false; a.netRemote = true;
        if (!a.netTarget) a.netTarget = { pos: a.pos.clone(), yaw: a.yaw };
        else { a.netTarget.pos.copy(a.pos); a.netTarget.yaw = a.yaw; }
      }
      (S.lastSeen = S.lastSeen || {})[id] = now;
      (S.everSeen = S.everSeen || {})[id] = true;
      if (S.tookOver) delete S.tookOver[id];
      W.events.emit("squadRejoin", { slot, peerId: from, stage: "back" });
    }
    send("sync", { t: +W.t.toFixed(2), loot: W.lootSyncState ? W.lootSyncState() : null, to: from, dead: deadList(W) });
    send("rejoin", Object.assign({ k: "back", slot, to: from }, bodySnap(a)));
    return;
  }
  if (d.k === "back") {
    if (d.to !== S.net.id) {
      // another client: the body is a human's again
      const a = W.actorById && W.actorById.get("s" + slot);
      if (a && a !== W.player && a.netRemote) a.isBot = false;
      return;
    }
    if (S.rejoin && slot === S.mySlot) applyRejoinBack(W, d);
  }
}
/** THE RETURNING PAGE: the host handed the body back - put this page's player where the body is, as it is, with the kit this tab saved. */
function applyRejoinBack(W, d) {
  const p = W.player, rj = S.rejoin;
  S.rejoin = null;
  if (!p) return;
  const fin = (v) => typeof v === "number" && Number.isFinite(v);
  if (!d.alive) {
    clearRejoin();
    p.hp = 0; p.shield = 0;
    if (W.killActor) W.killActor(p, null, null);
    notify(W, "You were eliminated while you were away.");
    W.events.emit("squadRejoin", { slot: rj.slot, stage: "dead" });
    return;
  }
  if (fin(d.x) && fin(d.y) && fin(d.z)) {
    p.pos.set(d.x, d.y + 0.05, d.z);
    if (p.vel) p.vel.set(0, d.gl ? -2 : 0, 0);
    if (!d.gl) {
      if (p.chute) { p.gliding = true; p.pos.y += 0.5; }          // a canopy is out: let the glide land it (player.js removes the canopy)
      else { p.gliding = false; p.onGround = false; }
    }
    if (p.obj) p.obj.position.copy(p.pos);
  }
  if (fin(d.yw)) p.yaw = d.yw;
  if (fin(d.hp)) p.hp = Math.max(1, d.hp);
  if (fin(d.sh)) p.shield = Math.max(0, d.sh);
  if (d.dn) { p.downed = true; p.downedT = W.t; if (fin(d.dh)) p.downedHp = d.dh; }
  restoreInventory(W, p, rj && rj.inv);
  S.rejoinDone = { slot: rj.slot, ms: Math.round(performance.now() - rj.at) };
  S.rjSavedAt = 0;                                                  // the new secret is written on the next update()
  notify(W, "Back in the match.");
  W.events.emit("squadRejoin", { slot: rj.slot, stage: "back", ms: S.rejoinDone.ms });
}
/** The kit this tab saved before it reloaded (weapons, consumables, ammo, the active slot); anything the sim does not know is dropped. */
function restoreInventory(W, p, inv) {
  if (!inv || !Array.isArray(inv.slots) || !p.inventory || !Array.isArray(p.inventory.slots)) return false;
  const K = W.SIM || {};
  const known = (s) => s && typeof s === "object" && typeof s.id === "string" && ((K.WEAPONS && K.WEAPONS[s.id]) || (K.CONSUMABLES && K.CONSUMABLES[s.id]));
  for (let i = 0; i < p.inventory.slots.length; i++) p.inventory.slots[i] = known(inv.slots[i]) ? Object.assign({}, inv.slots[i]) : null;
  if (inv.ammo && p.inventory.ammo) for (const k in p.inventory.ammo) if (typeof inv.ammo[k] === "number" && Number.isFinite(inv.ammo[k])) p.inventory.ammo[k] = Math.max(0, inv.ammo[k]);
  let idx = Number.isInteger(inv.active) && p.inventory.slots[inv.active] ? inv.active : p.inventory.slots.findIndex((s) => s && s.kind === "weapon");
  if (idx < 0) idx = 0;
  try { if (W.equipSlot) W.equipSlot(p, idx); else p.inventory.active = idx; } catch (e) { p.inventory.active = idx; }
  return true;
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
      color: "#eaf2ff", fontFamily: "Rajdhani, 'Segoe UI', system-ui, sans-serif", fontSize: "14px", fontWeight: "600", lineHeight: "1.4", pointerEvents: "auto", boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
    });
    const t = document.createElement("div");
    t.textContent = j.title;
    Object.assign(t.style, { fontFamily: "Orbitron, 'Segoe UI', system-ui, sans-serif", fontWeight: "900", fontSize: "15px", letterSpacing: "1.5px", color: "#ffb060", marginBottom: "6px" });
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
  // LC-49: a body handed back to a rejoined guest keeps its (idle: bots.js skips netRemote actors) brain; a second take-over wakes THAT
  // brain instead of adding another one that would drive the same body twice
  if (!a.brain) import("./bots.js" + V).then((m) => m.attachBrain(W, a));
  send("takeover", { slot: a.id });
  const sl = parseInt(String(a.id).slice(1), 10);
  if (sl > 0) markGone(sl);
}

/** HOST, LC-49 RECONNECT: a state packet (sender already bound to its own slot by senderMay) for body `a`, which this host's watchdog gave to a
 *  bot because the peer was SILENT - not because it said bye, failed its map or was replaced by a rejoin. Inside REJOIN_MS of that take-over
 *  the body goes back to the peer: its brain idles (bots.js skips netRemote actors), the packet's position wins (the guest's page kept
 *  simulating it), and every guest is told the body is a human's again ("rejoin" back, addressed to the peer, which ignores it). */
function reclaimSilentBody(W, a, from, d) {
  const at = S.silentTake && S.silentTake[a.id];
  if (at == null) return false;
  const now = performance.now();
  const slot = slotOfPeer(S.cfg && S.cfg.roster, from);
  const j = judgeReclaim({ takenAt: at, nowMs: now, senderSlot: slot, id: a.id, alive: a.alive, isBot: a.isBot,
    rejoinedBy: S.rejoined && S.rejoined[a.id] ? S.rejoined[a.id].peer : null, from });
  if (j === "expired") delete S.silentTake[a.id];
  if (j !== "ok") return false;
  const fin = (v) => typeof v === "number" && Number.isFinite(v);
  delete S.silentTake[a.id];
  if (S.goneAt) delete S.goneAt[a.id];
  if (S.tookOver) delete S.tookOver[a.id];
  a.isBot = false; a.netRemote = true;
  if (fin(d.x) && fin(d.y) && fin(d.z)) a.pos.set(d.x, d.y, d.z);
  if (!a.netTarget) a.netTarget = { pos: a.pos.clone(), yaw: a.yaw };
  else { a.netTarget.pos.copy(a.pos); a.netTarget.yaw = a.yaw; }
  (S.reclaimed = S.reclaimed || []).push({ id: a.id, peer: from, afterMs: Math.round(now - at) });
  if (S.reclaimed.length > 16) S.reclaimed.shift();
  send("rejoin", Object.assign({ k: "back", slot, to: from }, bodySnap(a)));
  notify(W, String(((S.cfg.roster.find((r) => r.slot === slot) || {}).name) || "A squad-mate").slice(0, 24) + " reconnected.");
  W.events.emit("squadRejoin", { slot, peerId: from, stage: "reconnect", ms: Math.round(now - at) });
  return true;
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
  // C-MODE: the team mode (null from a host without it = the boot's own default) and each human's teamId travel with the start
  const teamMode = normTeamMode(cfg.teamMode);
  const humans = cfg.roster.map((r) => {
    const h = { slot: r.slot, name: r.name, self: r.peerId === S.net.id };
    if (teamMode) h.teamId = typeof r.teamId === "string" && r.teamId.length <= 24 ? r.teamId : humanTeamId(r.slot, teamMode, W.SIM);
    return h;
  });
  if (S.started) resetMatchState();          // LC-18 rematch: the room stays, everything about the last match goes
  S.cfg = cfg;
  S.mySlot = me ? me.slot : 0;
  S.started = true;
  S.rematchN = Math.max(S.rematchN | 0, cfg.rematch | 0);
  // LC-49: the host files each guest's rejoin commitment by slot; a guest keeps its secret (and, from update(), its kit) for a reload
  if (S.net.isHost()) {
    S.slotKeys = new Map();
    for (const r of cfg.roster) { const rec = r && r.slot > 0 ? S.hs.peers.get(r.peerId) : null; if (rec && rec.rk) S.slotKeys.set(r.slot, rec.rk); }
  } else if (!cfg.rejoin) saveRejoin(W);
  const opts = { mapId: cfg.mapId, mode: cfg.mode, seed: cfg.seed, humans, guestOf: S.net.isHost() ? null : "host" };
  if (teamMode) opts.teamMode = teamMode;
  if (cfg.rejoin) opts.rejoin = { slot: S.mySlot };     // (the boot may skip its lobby countdown for it; net.js places the body on "back")
  window.__LC__.startMatch(opts);
}

// ── message handling ─────────────────────────────────────────────────────────
/** A message senderMay (or a handler) turned away: counted per type, the last few reasons kept for a probe / the console (never shown). */
function reject(t, from, why) {
  if (!S) return;
  const r = S.rejected = S.rejected || { n: 0, byType: {}, last: [] };
  r.n++; r.byType[t] = (r.byType[t] || 0) + 1;
  r.last.push({ t, from: String(from || "").slice(0, 40), why });
  if (r.last.length > 12) r.last.shift();
  if (r.n <= 5 || r.n % 50 === 0) console.warn("[net] ignored a '" + t + "' message: " + why + " (" + r.n + " so far)");
}

/** Is a "start" from the room's host? The peer whose hello said host: 1 - or, when no such hello arrived, the peer the roster puts in slot 0. */
function startFromHost(from, d) {
  let knownHost = null;
  for (const [pid, rec] of S.hs.peers) if (rec && rec.host) { knownHost = pid; break; }
  if (knownHost) return from === knownHost;
  return !!(d && Array.isArray(d.roster) && d.roster[0] && d.roster[0].slot === 0 && d.roster[0].peerId === from);
}

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
    const hr = S.hs.onHello(from, d, performance.now());
    S.peers[from] = d && d.name;
    // a peer heard for the first time may be ahead of its own presence: repaint once the grace window ends, so a ghost hello leaves the list
    if (hr.first && S.paintRoster) setTimeout(() => { if (S && S.paintRoster && !S.started) S.paintRoster(); }, PRESENCE_GRACE_MS + 100);
    if (hr.first) send("hello", myHello());
    // VERSION GUARD, guest side: the room's host says it builds another world -> refuse now rather than at START
    if (hr.refuseNow) { refuseRoom(W, hr.refuseNow, from); return; }
    // VERSION GUARD, host side: say (in the lobby) that this peer will not get a slot
    if (hr.first && hr.mismatch && S.hs.host && S.notice) S.notice(leftOutLine(d && d.name, hr.rec.gv, S.gv), from);
    if (S.net.isHost()) {
      // LC-49: a hello while our match runs = a squad-mate asking for its slot back (rj), or a friend who arrived late (told to wait)
      if (S.started) { if (hr.first || (d && d.rj)) hostRejoinHello(W, from, d, hr); }
      else if (hr.first && S.sendRoom) S.sendRoom();       // C-MODE: the newcomer reads the host's team-mode pick
    }
    if (S.paintRoster && !S.started) S.paintRoster();
    return;
  }
  if (t === "room") {
    // C-MODE, lobby: the host's team-mode pick (display only - the start carries what is played)
    if (!S.started && !S.net.isHost() && d && startFromHost(from, null)) { S.roomTm = normTeamMode(d.tm); if (S.paintMode) S.paintMode(); }
    return;
  }
  if (t === "rejoin" && !S.started) {
    // LC-49, the page that asked for its slot back: only the host's answer addressed to this peer counts
    if (!d || d.to !== S.net.id) return;
    if (!startFromHost(from, d.start)) { reject(t, from, "rejoin not from the host"); return; }
    onRejoinAnswer(W, from, d);
    return;
  }
  if (t === "start" && !S.started) {
    // VERSION GUARD: the host's start carries its world version next to the seed (none = version 1, every build before the guard).
    // A different generator would build different ground and colliders from this seed - refuse instead of starting.
    const j = S.hs.judgeStart(d);
    if (j) { refuseRoom(W, j, from); return; }
    // LC-11: only the room's host starts a match. The host said so in its hello (host: 1); a room whose host we never heard from falls back to
    // "the sender put itself in slot 0 of the roster it sent".
    if (!startFromHost(from, d)) { reject(t, from, "start not from the host"); return; }
    // remove the lobby only if we actually got a slot — beginOnlineMatch writes
    // the "room is full" message into the lobby that is still on screen
    if (beginOnlineMatch(W, d) !== false && S && S.root) S.root.remove();
    return;
  }
  // REMATCH (parity LC-18): the host of the match that just ended starts the next one in the same room (net.rematch on its side). A guest
  // follows it: at once when its own match is over, else as soon as it is (update() / rematch()).
  if (t === "start" && S.started) {
    if (!d || !d.rematch || !S.cfg || !Array.isArray(S.cfg.roster) || !S.cfg.roster[0] || S.cfg.roster[0].peerId !== from) { reject(t, from, "start mid-match"); return; }
    if (S.hs.judgeStart(d)) { reject(t, from, "rematch on another world version"); return; }
    if ((d.rematch | 0) <= (S.rematchN | 0)) return;          // a repeat of one we already took
    S.pendingRematch = { d, at: performance.now() };
    tryFollowRematch(W);
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
    if (S.silentTake) delete S.silentTake[r.id];          // LC-49: a squad-mate on another world never reclaims its body
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
  // LC-11 SENDER BINDING: every message below acts inside a match, on an actor - the sender must be in this match's roster and may only speak
  // for its own slot (the host also for its bots). See senderMay.
  {
    const why = senderMay(t, d, from, { roster: S.cfg && S.cfg.roster, isHost: S.net.isHost(), actor: (id) => W.actorById && W.actorById.get(id), K: W.SIM,
      selfId: W.player ? W.player.id : null });
    if (why) { reject(t, from, why); return; }
  }
  const fromHost = slotOfPeer(S.cfg && S.cfg.roster, from) === 0;
  if (t === "state") {
    // lazy mesh negotiation: the first state we SEE from a peer starts the
    // DataChannel handshake for that pair (both sides converge on it)
    if (S.rtc && from) S.rtc.ensurePeer(from);
    // LC-49 ORDER: q is the sender's packet counter. A copy we already applied (the DataChannel AND the relay both delivered it) is dropped
    // whole; a packet that arrives after a newer one is LATE - its positions / HP / clock / bot snapshots would pull bodies backwards, so only
    // the events riding it (chat, chests, pickups... never sent twice) and the proof of life are kept.
    const order = (S.rxGate = S.rxGate || new SeqGate()).accept(from, d.q);
    if (order === "dup") return;
    const a = W.actorById.get(d.id);
    if (order === "old") {
      if (a && a.netRemote) { S.lastSeen = S.lastSeen || {}; S.lastSeen[d.id] = performance.now(); (S.everSeen = S.everSeen || {})[d.id] = true; }
      if (!S.net.isHost() && fromHost) S.hostSeen = performance.now();
      if (d.evs) { for (const m of d.evs) if (m && m.t !== "ev") onMsg(W, { from, t: m.t, d: m.d }); }
      return;
    }
    // LC-49 RECONNECT: the host's watchdog handed this guest's body to a bot because the guest went SILENT (a stalled tab, a dropped socket),
    // and now that same peer speaks again inside REJOIN_MS: the body is the human's again (its page never stopped owning it). Without this the
    // host's bot and the guest's page both drove s<N> for the rest of the match (split brain), and the guest's knocks, throws and revives
    // were dropped on the host because the body was no longer netRemote.
    if (a && S.net.isHost() && !a.netRemote && a !== W.player) reclaimSilentBody(W, a, from, d);
    if (a && a.netRemote) { applyRemoteState(W, a, d); S.lastSeen = S.lastSeen || {}; S.lastSeen[d.id] = performance.now(); (S.everSeen = S.everSeen || {})[d.id] = true; }
    // OUTSIDE the actor guard on purpose: the match clock rides the host's own
    // state packet, and a packet whose actor has not been created yet (or has
    // been removed) must still deliver the clock.
    if (d.t != null && !S.net.isHost() && fromHost) {
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
    if (d.bots && !S.net.isHost() && fromHost && Array.isArray(d.bots)) {
      for (const b of d.bots) {
        if (!b) continue;
        const ba = W.actorById.get(b.id);
        if (ba && ba.netRemote) { if (b.q == null) b.q = d.q; if (b.t == null) b.t = d.t; applyRemoteState(W, ba, b); }   // a bot is stamped by the envelope
      }
    }
    if (d.evs) { for (const m of d.evs) if (m && m.t !== "ev") onMsg(W, { from, t: m.t, d: m.d }); }
    return;
  }
  if (t === "bots" && !S.net.isHost()) {
    S.hostSeen = performance.now();          // bot snapshots only ever come from the host (senderMay: "bots" is host-only)
    for (const b of d.list || []) {
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
  if (t === "heal" || t === "rld") {
    // LC-09: a remote actor's heal / reload, replayed through the local events so audio.js voices it at the actor (FX only, no state)
    const a = W.actorById.get(d.id);
    if (!a || !a.netRemote || !a.alive) return;
    if (t === "heal") {
      const c = W.SIM && W.SIM.CONSUMABLES ? W.SIM.CONSUMABLES[d.c] : null;
      if (!c) return;
      W.events.emit("healStart", a, d.c, c.useS);
    } else {
      if (!W.SIM || !W.SIM.WEAPONS || !W.SIM.WEAPONS[d.w]) return;
      W.events.emit("reloadStart", a, { id: d.w });
    }
    (S.relayIn = S.relayIn || {})[t] = ((S.relayIn && S.relayIn[t]) || 0) + 1;
    return;
  }
  if (t === "boom") {
    // LC-14: a blast simulated on another client - drawn and voiced here, never relayed again ({ net: true }), no damage (that is hitYou's)
    const ok = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 5000;
    if (!ok(d.x) || !ok(d.y) || !ok(d.z)) return;
    W.events.emit("explosion", { x: d.x, y: d.y, z: d.z }, Math.max(0.5, Math.min(12, +d.r || 3.5)), { net: true });
    (S.relayIn = S.relayIn || {}).boom = ((S.relayIn && S.relayIn.boom) || 0) + 1;
    return;
  }
  if (t === "ping") {
    // LC-07: a squad-mate's ping. Team-filtered (only a sender on OUR team is shown) and rate-limited per sender (PingLimiter) on this side
    // too, so a client that ignores its own limit cannot flood the HUD. hud.js draws it (netPing).
    const a = W.actorById.get(d.id);
    if (!a || !W.player || a === W.player) return;
    if (!pingTeamOk(W.player.teamId, a.teamId)) { reject(t, from, "ping from another team"); return; }
    const p = normPing(d, W.map && W.map.size ? W.map.size / 2 + 50 : 2000);
    if (!p) { reject(t, from, "malformed ping"); return; }
    // Per sender AND per stream (world ping / map pin), like the sender's own gate; a map pin over the rate is held and shown when the
    // limit frees (newest wins), a world ping over the rate is dropped.
    const box = S.pingIn = S.pingIn || new PingOutbox(PING_MIN_MS - 150);     // a little slack for jitter on the sender's 1/s
    const r = box.offer(d.id + ":" + p.src, p, performance.now(), p.src === "m");
    if (r.now) { W.events.emit("netPing", Object.assign({ owner: d.id }, r.now)); return; }
    if (r.wait != null) { setTimeout(() => flushPingIn(W, box, true), r.wait + 5); return; }
    reject(t, from, "ping rate");
    return;
  }
  if (t === "revive") { onRevive(W, from, d); return; }
  if (t === "smoke") {
    // LC-14 / C-SMOKE: a smoke cloud thrown on another client joins W.smokes here, so fx.js draws it and maps.js losBlocked (the host's bots)
    // respects it; marked _net so it is never relayed back. At most SMOKE_MAX_PER_THROWER alive per thrower (`by`, D12), SMOKE_MAX_RELAYED in all.
    const s = normSmoke(d, W.map && W.map.size ? W.map.size / 2 + 50 : 2000);
    if (!s) { reject(t, from, "malformed smoke"); return; }
    if (!Array.isArray(W.smokes)) W.smokes = [];
    const full = smokeRelayRoom(W.smokes, d.by, W.t);
    if (full) { reject(t, from, full); return; }
    W.smokes.push(Object.assign(s, { _net: from, by: d.by }));
    W.events.emit("smokeNet", s);
    (S.relayIn = S.relayIn || {}).smoke = ((S.relayIn && S.relayIn.smoke) || 0) + 1;
    return;
  }
  if (t === "nade") {
    // LC-14: a remote actor's throw - cosmetic only (see the grenadeThrown relay in init)
    const a = W.actorById.get(d.id);
    const fin = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 5000;
    if (!a || !a.netRemote || !a.alive || ![d.x, d.y, d.z, d.vx, d.vy, d.vz].every(fin)) return;
    a.lastThrowT = W.t;
    W.events.emit("grenadeThrown", a, d.w, { x: d.x, y: d.y, z: d.z }, { x: d.vx, y: d.vy, z: d.vz }, { net: true });
    (S.relayIn = S.relayIn || {}).nade = ((S.relayIn && S.relayIn.nade) || 0) + 1;
    return;
  }
  if (t === "rejoin") { onRejoinInMatch(W, from, d); return; }
  if (t === "drop") { W.netSpawnItem && W.netSpawnItem(d); return; }
  if (t === "chest") { W.netOpenChest(d.id); return; }
  if (t === "take") { W.netTakeItem(d.id); if (isChestItem(d.id)) deferTakes([d.id]); return; }   // (its chest may not be open here yet)
  if (t === "died") {
    const a = W.actorById.get(d.slot);
    if (a && a.alive) { a.hp = 0; a.shield = 0; W.killActor(a, d.killer, d.weapon); }
    return;
  }
  if (t === "bye") {
    // a guest left mid-match: host re-attaches a bot brain so the slot fights on
    const a = W.actorById.get(d.slot);
    { const sl = slotOfPeer(S.cfg && S.cfg.roster, from); if (sl > 0 && d.slot === "s" + sl) { markGone(sl); if (S.silentTake) delete S.silentTake[d.slot]; } }   // LC-49: the rejoin window opens (a bye is not a silence)
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
    // late-join / drift correction from host. (LC-49) A sync addressed to a rejoining peer (`to`) is for that peer only.
    if (d.to && d.to !== S.net.id) return;
    if (typeof d.t === "number" && Number.isFinite(d.t)) W.t = d.t;
    // opened BEFORE taken (applyLootSync): items taken from a chest never come back as ghosts when it opens here
    deferTakes(applyLootSync(d.loot, W.netOpenChest, W.netTakeItem));
    // LC-49: the actors that died before this page (re)joined fall quietly - the right alive count, no kill-feed flood, no body in the sky
    if (Array.isArray(d.dead)) for (const row of d.dead.slice(0, 64)) quietDeath(W, Array.isArray(row) ? row[0] : row, Array.isArray(row) ? row[1] : null);
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
  a.sprinting = !!(f & 128);   // LC-09 (see pack)
  // C-DBNO: downed (crawling, bleeding out) + the bleed pool while it lasts; player.js / hud.js read these off a remote like off a local actor
  const dn = !!(f & F_DOWNED);
  if (dn && !a.downed) a.downedT = W.t;
  a.downed = dn;
  // (pack: while downed the hp field IS the bleed pool; a downed actor's own hp is 0)
  if (dn) { a.downedHp = typeof d.hp === "number" && Number.isFinite(d.hp) ? Math.max(0, d.hp) : a.downedHp; a.hp = 0; }
  else a.downedHp = 0;
  // LC-49: the packet's sequence number and the sender's match-clock stamp (player.js may interpolate on them; net.js orders by q)
  if (typeof d.q === "number") a.netQ = d.q;
  if (typeof d.t === "number") a.netT = d.t;
  a.netRx = performance.now();
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
  clearRejoin();               // LC-49: the room is gone
  const converted = convertRemotesToBots(W);
  try { S.rtc && S.rtc.close(); } catch (e) {}
  try { S.net && S.net.leave && S.net.leave(); } catch (e) {}
  W.net = null;                                 // frame gates (hitstop etc.) read this
  W.events.emit("hostLost", converted);
  console.warn(`[net] host lost — converted ${converted} remote actors to bots, continuing offline`);
}

export function leave(W) {
  hideWaitCard();
  clearRejoin();               // LC-49: a player who LEAVES (main menu) is not coming back for the slot
  if (S) {
    try { S.rtc && S.rtc.close(); } catch (e) {}
    try { S.net.leave(); } catch (e) {}
    S = null;
  }
  W.net = null;
}

/** Per-match session fields (LC-18): a rematch keeps the room, the peers, the RTC mesh and the handshake, and starts these from scratch. */
function resetMatchState() {
  if (!S) return;
  S.lastSeen = {}; S.everSeen = {}; S.absentSince = {}; S.tookOver = {};
  S.hostSeen = null; S.hostSlot = null; S.matchLiveAt = null;
  S.pendingBots = null; S.evQ = []; S.lastState = 0; S.lastBots = 0; S.botsTick = 0;
  S.pendingTakeovers = null; S.hostGone = false; S.mapFails = null; S.pendingNotices = null;
  S.pendingRematch = null; S.wantRematch = false;
  S.pingIn = null; S.pingOut = null;
  // P23: the receive order gate, the revive book, the rejoin book and the relayed smokes belong to the match that ended (txSeq keeps counting)
  S.rxGate = null; S.reviveIn = null; S.reviveOut = null; S.goneAt = null; S.rejoined = null; S.rejoin = null; S.slotKeys = null;
  S.teamCheck = null; S.rjSavedAt = 0; S.silentTake = null; S.reclaimed = null; S.lootDefer = null;
}
/** Keep chest-item takes until their chest opens on this client (the chestOpened listener in init applies them). */
function deferTakes(ids) {
  if (!S || !ids || !ids.length) return;
  const set = S.lootDefer = S.lootDefer || new Set();
  for (const id of ids) { set.delete(id); set.add(id); }
  while (set.size > LOOT_DEFER_MAX) set.delete(set.values().next().value);
}

let _waitCard = null;
function hideWaitCard() { if (_waitCard) { try { _waitCard.remove(); } catch (e) {} _waitCard = null; } }
/** GUEST, after "Run it back": the host decides when the next match starts. Says so, with a way out (MAIN MENU = opts.onMenu). Same look as
 *  the squad panel (game fonts, glass panel). textContent only. */
function showWaitCard(W, opts) {
  hideWaitCard();
  ensureNetStyles();
  const root = document.createElement("div");
  root.setAttribute("data-net-rematch-wait", "");
  root.className = "lcn-veil";
  const box = document.createElement("div");
  box.className = "lcn-box";
  const t = document.createElement("div"); t.className = "lcn-title"; t.textContent = "RUN IT BACK";
  const d = document.createElement("div"); d.className = "lcn-sub";
  d.textContent = "Waiting for the host to start the next match. Your squad stays together.";
  const row = document.createElement("div"); row.className = "lcn-row";
  const b = document.createElement("button"); b.className = "lcn-btn"; b.textContent = "MAIN MENU";
  b.setAttribute("data-net-rematch-menu", "");
  b.onclick = () => { hideWaitCard(); leave(W); if (opts && typeof opts.onMenu === "function") opts.onMenu(); };
  row.appendChild(b);
  box.append(t, d, row);
  root.appendChild(box);
  (W.kernel && W.kernel.parent ? W.kernel.parent : document.body).appendChild(root);
  _waitCard = root;
  return root;
}

/** GUEST: a rematch "start" from the host is waiting (S.pendingRematch). Take it once this client's own match is over (post-match), or right
 *  away when the player already pressed Run it back. Called from onMsg, rematch() and update(). */
function tryFollowRematch(W) {
  if (!S || !S.pendingRematch) return false;
  const pr = S.pendingRematch;
  if (performance.now() - pr.at > 120000) { S.pendingRematch = null; return false; }   // stale
  if (!(S.wantRematch || W.phase === "over" || W.phase === "menu")) return false;
  S.pendingRematch = null;
  hideWaitCard();
  if (W._overT) { try { clearTimeout(W._overT); } catch (e) {} W._overT = null; }   // the post-match panel must not open over the next load
  return beginOnlineMatch(W, pr.d) !== false;
}

/** LC-18 "Run it back" for a squad: the next match in the SAME room. Returns true when the squad handles it (the caller must not start a solo
 *  match), false when there is no live squad session (the caller starts the solo match it always did).
 *    host  -> a new seed and map, a roster of the peers still in the room, a "start" { rematch: n } - and its own match begins at once;
 *    guest -> the host's rematch start if it already arrived, else a "waiting for the host" card (MAIN MENU = opts.onMenu) until it does.
 *  opts = { mapId, mode, onMenu }. */
export function rematch(W, opts) {
  opts = opts || {};
  // no live squad (never had one, the host was lost, this page refused or left on a map fallback): tidy up and let the caller go solo
  if (!S || !S.started || !S.net || S._hostLostRan || S.refused || S.fallbackDone || !W.net) { leave(W); return false; }
  if (S.net.isHost()) {
    const plan = S.hs.planStart(S.peers, MAX_GUESTS, performance.now());
    if (plan.roster.length < 2) { leave(W); return false; }   // everybody else left: a solo match, the room has nobody to keep
    S.rematchN = (S.rematchN | 0) + 1;
    const mode = opts.mode || (S.cfg && S.cfg.mode) || "standard";
    const pace = mode === "practice" ? "standard" : mode;
    // C-MODE / D5: the room keeps its team-mode PICK (re-resolved for who is still here): a pick of SQUADS stays SQUADS, AUTO stays AUTO (the
    // boot passes the mode the last match RESOLVED to, which for an AUTO room is not a pick); a start without teamWant (older host) -> opts
    const want = rematchTeamWant(S.cfg, opts.teamMode);
    const teamMode = resolveTeamMode(want === "solo" ? null : want, plan.roster.length, pace, W.SIM);
    const cfg = S.hs.startMsg({
      seed: (Math.random() * 0xffffffff) >>> 0,
      mapId: opts.mapId || (W.randomMap ? W.randomMap() : (S.cfg && S.cfg.mapId)),
      mode: pace, teamMode, teamWant: want && want !== "solo" ? want : "auto", roster: rosterWithTeams(plan.roster, teamMode, W.SIM), rematch: S.rematchN,
    });
    send("start", cfg);
    return beginOnlineMatch(W, cfg) !== false;
  }
  // GUEST: the host of the match that ended has to still be in the room, or there will be no next match to follow
  const hostPeer = S.cfg && Array.isArray(S.cfg.roster) && S.cfg.roster[0] ? S.cfg.roster[0].peerId : null;
  if (!S.pendingRematch && hostPeer && !S.hs.isPresent(hostPeer, performance.now())) { leave(W); return false; }
  S.wantRematch = true;
  if (tryFollowRematch(W)) return true;
  showWaitCard(W, opts);
  return true;
}

export function onMatchStart(W) {
  if (!S) return;
  S.matchLiveAt = performance.now();        // the never-seen watchdog counts from here (update())
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
  // C-MODE cross-check: the teams the boot built must be the ones the start named (a disagreement is logged, never acted on - it would mean
  // the boot's team rule and resolveTeamMode / humanTeamId drifted apart)
  if (S.cfg && normTeamMode(S.cfg.teamMode) && Array.isArray(S.cfg.roster)) {
    const rows = [];
    for (const r of S.cfg.roster) { const a = W.actorById && W.actorById.get("s" + r.slot); if (a && r.teamId) rows.push([a.id, a.teamId || null, r.teamId]); }
    const bad = teamPartitionDiff(rows);
    S.teamCheck = { mode: S.cfg.teamMode, ok: !bad.length, bad, rows };
    if (bad.length) console.warn("[net] C-MODE: the built teams group the humans differently from the start's roster teamIds:", JSON.stringify(rows));
  }
  // LC-49 REJOIN: the match is built - ask the host for the body back
  if (S.rejoin && S.rejoin.state === "loading") {
    S.rejoin.state = "ready"; S.rejoin.readyAt = performance.now(); S.rejoin.tries = 1;
    send("rejoin", { k: "ready", slot: S.rejoin.slot });
  }
}

export function update(W, dt) {
  if (!S || !S.started || !W.player) return;
  if (S.pendingRematch && tryFollowRematch(W)) return;      // LC-18: the host started the next match and ours is over
  if (S.mapFallback && !S.fallbackDone) { leaveForFallback(W, detectMapFallback(W, S.gv, S.mapFallback)); return; }   // (onMatchStart normally got there first)
  if (S.pendingTakeovers || S.hostGone) drainPending(W);
  if (S.pingOut && S.pingOut.pending) flushPingOut(W, S.pingOut);   // LC-07: a held map pin goes out as soon as its 1/s frees
  if (S.pingIn && S.pingIn.pending) flushPingIn(W, S.pingIn);
  const now = performance.now();
  // LC-49 REJOIN, the returning page: "ready" is repeated every 3 s until the host hands the body back ("back")
  if (S.rejoin && S.rejoin.state === "ready" && now - S.rejoin.readyAt > 3000 && S.rejoin.tries < 6) {
    S.rejoin.readyAt = now; S.rejoin.tries++;
    send("rejoin", { k: "ready", slot: S.rejoin.slot });
  }
  // ...and every guest keeps its rejoin record (secret + kit) fresh for a reload, every 2 s (one small storage write)
  if (!S.net.isHost() && !S.rejoin && W.player.alive && now - (S.rjSavedAt || 0) > 2000) { S.rjSavedAt = now; saveRejoin(W); }
  // LC-14 / C-SMOKE: a smoke cloud made here (weapons.js pushed it into W.smokes) goes to the room once
  if (Array.isArray(W.smokes) && W.smokes.length) relaySmokes(W);
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
  // (LC-49: a page that is getting its slot back sends no state of its own until the host has handed the body back - until then its
  // W.player is a fresh spawn in the sky, and the host's bot brain still drives the real body)
  if (now - S.lastState > stateMs && !(S.rejoin && S.rejoin.state !== "back")) {
    S.lastState = now;
    // MATCH CLOCK rides the packet that already goes out — zero extra messages.
    // W.t starts at 0 per client (ffg_royale3d.js:218) and free-runs at :366;
    // the only other carrier of `t` is the one-shot "sync" from onMatchStart,
    // so across the 735 s of a standard match the clients drift apart without
    // limit and each one draws the storm somewhere else. Host stamps, guests slew.
    // LC-49: EVERY sender now stamps t (its slewed clock: the server-time stamp) and q (its packet counter); only the host's t moves clocks.
    S.txSeq = (S.txSeq | 0) + 1;
    const st = pack(W.player, { q: S.txSeq, t: +W.t.toFixed(2) });
    // EVS RIDE THE STATE TICK (was a separate 10 Hz "ev" stream). Same
    // over-budget shedding: drop the PURE-FX half (tracer/emote — invisible a
    // second later), keep the world-state half (take/chest/drop — a missing
    // one leaves a ghost item every other client can still try to pick up).
    if (S.evQ && S.evQ.length) {
      let list = S.evQ;
      S.evQ = [];
      if (sendBudgetLeft() <= 0) {
        // the pure-FX relays (gunfire, emotes, LC-09 heal / reload foley, LC-14 remote blasts) go first; pings, chat and world state stay
        const kept = list.filter((m) => m.t !== "fire" && m.t !== "emote" && m.t !== "heal" && m.t !== "rld" && m.t !== "boom");
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
    if (S.rxGate) W._netStats.order = S.rxGate.n; // LC-49: state packets in order / late (positions dropped) / duplicate (dropped)
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
  // (it calls the take-over directly: a "bye" is bound to its sender's own slot now, LC-11)
  if (S.net.isHost() && S.lastSeen && (W.phase === "match" || W.phase === "drop")) {
    for (const id in S.lastSeen) {
      if (now - S.lastSeen[id] > 12000) {
        delete S.lastSeen[id];
        if (hostTakeOver(W, id)) (S.silentTake = S.silentTake || {})[id] = now;   // LC-49: reclaimable if the peer speaks again
      }
    }
  }
  // host: NEVER-SEEN watchdog (LC-11). The watchdog above only iterated S.lastSeen, i.e. guests that had sent at least one state packet; a
  // guest whose tab closed or crashed while its match was loading never got there, so its body hung in the sky forever, immortal (the storm
  // skips netRemote actors) and keeping the squad's team alive - the match could not end. A rostered guest that has sent nothing is handed to
  // a bot once its presence has been gone for 2 s, or after NEVER_SEEN_MS from the moment this match went live (a slow load is not a crash).
  if (S.net.isHost() && S.cfg && Array.isArray(S.cfg.roster) && S.matchLiveAt && (W.phase === "match" || W.phase === "drop")) {
    S.absentSince = S.absentSince || {};
    S.tookOver = S.tookOver || {};
    for (const r of S.cfg.roster) {
      if (!r || r.slot === 0) continue;
      const id = "s" + r.slot;
      if (S.tookOver[id] || (S.everSeen && S.everSeen[id])) continue;
      const gone = !S.hs.isPresent(r.peerId, now);
      if (!gone) S.absentSince[id] = 0;
      else if (!S.absentSince[id]) S.absentSince[id] = now;
      if ((gone && now - S.absentSince[id] > 2000) || now - S.matchLiveAt > NEVER_SEEN_MS) {
        if (hostTakeOver(W, id)) {
          S.tookOver[id] = { at: Math.round(now - S.matchLiveAt), why: gone ? "left the room" : "never sent state" };
          if (!gone) (S.silentTake = S.silentTake || {})[id] = now;        // LC-49: a slow load that finally arrives gets its body back
        }
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
function pack(a, stamp) {
  const st = {
    id: a.id,
    x: +a.pos.x.toFixed(2), y: +a.pos.y.toFixed(2), z: +a.pos.z.toFixed(2),
    yw: +a.yaw.toFixed(3), pt: +a.pitch.toFixed(2),
    // C-DBNO: while the downed bit is set, `hp` carries the BLEED POOL (a downed actor's hp is 0 by rule, player.js knockActor), so the
    // packet keeps the same keys downed or up - no extra field, per-tick bytes unchanged (plan P3 "one spare flag bit")
    hp: Math.round(a.downed ? Math.max(0, a.downedHp || 0) : a.hp), sh: Math.round(a.shield),
    gl: a.gliding ? 1 : 0, wp: a.weapon ? a.weapon.id : null,
    // bits 32/64: mantle + hit-react — transient states, but 0.25-0.5 s spans
    // 2-6 packets at 5-12 Hz so remotes catch them; older peers ignore
    // unknown bits (sweep findings: both were invisible to other clients)
    f: (a.crouching ? 1 : 0) | (a.input.ads ? 2 : 0) |
       (a.weapon && a.weapon.state === "reloading" ? 4 : 0) |
       (a.swimming ? 8 : 0) | (a.chute ? 16 : 0) |
       (a.mantleT != null ? 32 : 0) | (a.hitReactT > 0 ? 64 : 0) |
       // bit 128: SPRINTING (parity LC-09). audio.js picks the footstep row (crouch 11 m / walk 22 m / sprint 34 m) and hud.js the sound-ring
       // radius off a.sprinting, which a remote actor never had - every remote enemy fell to the walk row. Older peers ignore the bit.
       (a.sprinting ? 128 : 0) |
       // bit 256: DOWNED (C-DBNO). The stance byte was at most 255 (3 digits) and is at most 511 now (3 digits): a normal packet is
       // byte-identical, and while the bit is set `hp` above is the bleed pool (applyRemoteState: downedHp = hp, hp = 0).
       (a.downed ? F_DOWNED : 0),
  };
  // LC-49: the envelope's own packet (not each bot in it) carries q = the sender's packet counter and t = its match clock - the host's clock,
  // which every guest slews to, i.e. the server-time stamp (on the host's packet it is also the clock guests slew from, as before)
  if (stamp) { st.q = stamp.q; st.t = stamp.t; }
  return st;
}
