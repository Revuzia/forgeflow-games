/**
 * Cosmic Coils — runtime/net/coilnet.js
 * Real-time online play over Supabase Realtime WebSockets (NetPlay transport —
 * the same proven relay Last Circle uses; pure broadcast, no Postgres).
 *
 * Model (owner-authority, mirrors Last Circle):
 *   · every human simulates ONLY their own serpent, broadcasting its head at
 *     10Hz; everyone else rebuilds the body from the head trail (slither model
 *     makes this exact: body = head history)
 *   · the HOST also simulates all AI serpents (bot stream 8Hz) and owns the
 *     food economy (delta packets 4Hz + keyframes every 12s / on join)
 *   · deaths are decided by the DYING client only (no rollback arguments);
 *     essence ids are deterministic (e<slot>_<death>_<i>) so pickups dedup
 *   · drop-in joins: a joining player takes over a live AI serpent (slot,
 *     body and all); leavers hand their serpent back to an AI brain
 *   · host migration: lowest peer id present is always the host
 *
 * Rooms: 4-letter private codes, or the shared "PUBLIC" arena room.
 */
const V = new URL(import.meta.url).search;
const S = await import("../sim/serpent.js" + V);
const { NetPlay } = await import("./ffg_netplay.js" + V);

const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

const Q = 10000; // unit-vector quantization
const pk = (v) => Math.round(v * Q);
const upk = (v) => v / Q;

class Session {
  constructor(game, net) {
    this.game = game;
    this.net = net;
    this.peers = new Map();   // peerId → {name, skinId, slot}
    this.started = false;
    this.cfg = null;
    this.mySlot = null;
    this.interp = new Map();  // slot → {a:{u,t,m,b,at}, b:{...}} packet pair
    this.lastSeen = new Map();// slot → perf.now()
    this._tState = 0; this._tBots = 0; this._tFood = 0; this._tRoster = 0; this._tKey = 0;
    this._foodRm = []; this._foodAdd = [];
    this._hostFlag = null;
  }
  isHost() {
    // dynamic: lowest peer id currently present (self counts)
    const ids = [this.net.id, ...this.peers.keys()].sort();
    return ids[0] === this.net.id;
  }
  humanSlots() {
    const set = new Set();
    if (this.mySlot != null) set.add(this.mySlot);
    for (const p of this.peers.values()) if (p.slot != null) set.add(p.slot);
    return set;
  }
  debug() {
    return { room: this.net.room, host: this.isHost(), peers: this.peers.size, mySlot: this.mySlot, started: this.started };
  }
  send(t, d) { this.net.send(t, d); }
  leave() {
    try { if (this.started && this.mySlot != null) this.send("bye", { slot: this.mySlot }); } catch (e) {}
    this.net.leave();
    if (this.game.net === this) this.game.net = null;
  }

  // ── outbound ───────────────────────────────────────────────────────────────
  packMe() {
    const W = this.game.W;
    const me = S.snakeBySlot(W, this.mySlot);
    if (!me) return null;
    return {
      s: this.mySlot,
      x: pk(me.u.x), y: pk(me.u.y), z: pk(me.u.z),
      tx: pk(me.t.x), ty: pk(me.t.y), tz: pk(me.t.z),
      m: +me.mass.toFixed(1), b: me.boosting ? 1 : 0, a: me.alive ? 1 : 0,
    };
  }

  simTick(dt) { /* sim-rate hooks unused; wall-clock rates live in frame() */ }

  frame(dt) {
    if (!this.started) return;
    const now = performance.now();
    const W = this.game.W;

    // interpolate remote serpents between their packets
    for (const [slot, ib] of this.interp) {
      const sn = S.snakeBySlot(W, slot);
      if (!sn || !sn.alive || !sn.netRemote || !ib.b) continue;
      const span = Math.max(40, ib.b.at - (ib.a ? ib.a.at : ib.b.at - 100));
      let k = (now - ib.b.at) / span; // 0 at packet arrival → 1 at next expected
      k = Math.min(1.6, Math.max(0, k)); // mild extrapolation
      const from = ib.a || ib.b, to = ib.b;
      const u = slerpU(from.u, to.u, Math.min(1, k + (ib.a ? 1 : 0) * 0));
      S.remoteFeed(W, sn, u, to.t, to.m, to.b);
    }

    // own state 10Hz
    if (now - this._tState > 100) {
      this._tState = now;
      const p = this.packMe();
      if (p) this.send("st", p);
    }

    const host = this.isHost();
    if (host !== this._hostFlag) this._becomeHost(host);

    if (host) {
      // bot stream 8Hz
      if (now - this._tBots > 125) {
        this._tBots = now;
        const list = [];
        for (const sn of W.snakes) {
          if (!sn.isBot || sn.netRemote || !sn.alive) continue;
          list.push([sn.slot, pk(sn.u.x), pk(sn.u.y), pk(sn.u.z), pk(sn.t.x), pk(sn.t.y), pk(sn.t.z), +sn.mass.toFixed(1), sn.boosting ? 1 : 0]);
        }
        if (list.length) this.send("bots", { list });
      }
      // food deltas 4Hz
      if (now - this._tFood > 250 && (this._foodRm.length || this._foodAdd.length)) {
        this._tFood = now;
        this.send("food", { rm: this._foodRm.splice(0), add: this._foodAdd.splice(0, 80) });
      }
      // roster + time sync 0.7Hz
      if (now - this._tRoster > 1400) {
        this._tRoster = now;
        this.send("roster", { t: +W.time.toFixed(2), list: this.rosterList() });
      }
      // food keyframe every 12s
      if (now - this._tKey > 12000) {
        this._tKey = now;
        this.send("key", { t: +W.time.toFixed(2), food: this.foodKey() });
      }
      // silent-guest watchdog → bot takeover
      for (const [slot, at] of this.lastSeen) {
        if (now - at > 10000) {
          this.lastSeen.delete(slot);
          this._adoptSlot(slot);
        }
      }
    }
  }

  rosterList() {
    const list = [{ peer: this.net.id, slot: this.mySlot, name: this.myName, skin: this.mySkin }];
    for (const [pid, p] of this.peers) list.push({ peer: pid, slot: p.slot, name: p.name, skin: p.skinId });
    return list;
  }
  foodKey() {
    const W = this.game.W, out = [];
    for (const f of W.food.values()) out.push([f.id, pk(f.u.x), pk(f.u.y), pk(f.u.z), f.tier, +f.value.toFixed(2)]);
    return out;
  }

  onSimEvent(ev) {
    const W = this.game.W;
    if (!this.started) return;
    if (ev.type === "eat" && ev.slot === this.mySlot) {
      // my eat is authoritative for that gem
      return; // foodDel event follows and carries the send
    }
    if (ev.type === "foodDel") {
      if (ev.eatenBy === this.mySlot) this.send("take", { id: ev.id });
      // host owns every OTHER removal: bot eats, TTL expiry — batch into rm
      else if (this.isHost()) this._foodRm.push(ev.id);
      return;
    }
    if (ev.type === "foodAdd") {
      const f = ev.f;
      if (this.isHost()) {
        if (!String(f.id).startsWith("e")) this._foodAdd.push([f.id, pk(f.u.x), pk(f.u.y), pk(f.u.z), f.tier, +f.value.toFixed(2)]);
      } else if (f.tier === 0) {
        // guests own only their boost pellets
        this.send("fadd", { f: [f.id, pk(f.u.x), pk(f.u.y), pk(f.u.z), f.tier, +f.value.toFixed(2), f.ttl] });
      }
      return;
    }
    if (ev.type === "death") {
      const sn = S.snakeBySlot(W, ev.slot);
      const mine = ev.slot === this.mySlot || (this.isHost() && sn && sn.isBot && !sn.netRemote);
      if (mine) this.send("died", { slot: ev.slot, killer: ev.killer, mass: +ev.mass.toFixed(1), dn: ev.deathN });
      return;
    }
  }

  sendSpawn(sn) {
    this.send("spawned", {
      slot: sn.slot, name: sn.name, skin: sn.skinId,
      x: pk(sn.u.x), y: pk(sn.u.y), z: pk(sn.u.z), tx: pk(sn.t.x), ty: pk(sn.t.y), tz: pk(sn.t.z),
    });
  }

  // ── inbound ────────────────────────────────────────────────────────────────
  onMsg(from, t, d) {
    const G = this.game;
    const W = G.W;
    if (t === "hello") {
      this.peers.set(from, { name: d.name, skinId: d.skin, slot: d.slot != null ? d.slot : null });
      // host in-lobby: assign slots as people arrive (before start)
      if (!this.started && this.isHost()) this._lobbySync();
      // host mid-match: a late joiner announces with late:1
      if (this.started && d.late && this.isHost()) this._assignLate(from, d);
      return;
    }
    if (t === "lobby" && !this.started) {
      this.lobbyState = d; // {list} for UI
      if (this.onLobby) this.onLobby(d);
      return;
    }
    if (t === "start" && !this.started) {
      const me = d.roster.find((r) => r.peer === this.net.id);
      if (!me) return;
      this._beginMatch(d.cfg, d.roster, me.slot);
      return;
    }
    if (t === "assign" && !this.started && d.peer === this.net.id) {
      this._beginMatch(d.cfg, d.roster, d.slot, d);
      return;
    }
    if (!this.started || !W) return;

    if (t === "st") {
      const sn = S.snakeBySlot(W, d.s);
      if (!sn) return;
      const p = this.peers.get(from);
      if (p) { p.slot = d.s; this.lastSeen.set(d.s, performance.now()); }
      if (!sn.netRemote) return; // never let a packet drive a snake I own
      if (d.a === 0) return;     // their death announcement handles it
      if (!sn.alive) this._reviveRemote(sn, d);
      let ib = this.interp.get(d.s);
      if (!ib) { ib = { a: null, b: null }; this.interp.set(d.s, ib); }
      ib.a = ib.b;
      ib.b = { u: { x: upk(d.x), y: upk(d.y), z: upk(d.z) }, t: { x: upk(d.tx), y: upk(d.ty), z: upk(d.tz) }, m: d.m, b: !!d.b, at: performance.now() };
      return;
    }
    if (t === "bots") {
      if (this.isHost()) return;
      for (const b of d.list) {
        const [slot, x, y, z, tx, ty, tz, m, bo] = b;
        const sn = S.snakeBySlot(W, slot);
        if (!sn || !sn.netRemote || !sn.isBot) continue;
        if (!sn.alive) this._reviveRemote(sn, { x, y, z, tx, ty, tz });
        let ib = this.interp.get(slot);
        if (!ib) { ib = { a: null, b: null }; this.interp.set(slot, ib); }
        ib.a = ib.b;
        ib.b = { u: { x: upk(x), y: upk(y), z: upk(z) }, t: { x: upk(tx), y: upk(ty), z: upk(tz) }, m, b: !!bo, at: performance.now() };
      }
      return;
    }
    if (t === "food") {
      for (const id of d.rm || []) S.removeFood(W, id);
      for (const a of d.add || []) this._foodFromNet(a);
      // adds/removes here are authoritative echoes; drain matching local events quietly
      S.drainEvents(W).forEach((ev) => this._reEmitLocal(ev));
      return;
    }
    if (t === "fadd") { this._foodFromNet(d.f, d.f[6]); S.drainEvents(W).forEach((ev) => this._reEmitLocal(ev)); return; }
    if (t === "take") {
      const f = W.food.get(d.id);
      if (f) {
        S.removeFood(W, d.id);
        S.drainEvents(W).forEach((ev) => this._reEmitLocal(ev));
      }
      return;
    }
    if (t === "died") {
      const sn = S.snakeBySlot(W, d.slot);
      if (!sn || !sn.alive) return;
      sn.mass = d.mass;
      W.deathCounts[d.slot] = (d.dn || 1) - 1; // keep essence ids in lockstep
      S.killSnake(W, sn, d.killer);
      for (const ev of S.drainEvents(W)) G._onEvent(ev); // FX + feed on this client
      return;
    }
    if (t === "spawned") {
      const sn = S.snakeBySlot(W, d.slot);
      const wasMine = d.slot === this.mySlot;
      if (wasMine) return;
      this.game._audit("net:spawned slot=" + d.slot);
      const ns = S.spawnSnake(W, d.slot, { isBot: false, netRemote: true, name: d.name, skinId: d.skin });
      S.remoteFeed(W, ns, { x: upk(d.x), y: upk(d.y), z: upk(d.z) }, { x: upk(d.tx), y: upk(d.ty), z: upk(d.tz) }, null, false);
      S.drainEvents(W);
      const p = this.peers.get(from);
      if (p) p.slot = d.slot;
      return;
    }
    if (t === "roster") {
      // time/weather sync + names/slots + scoreboard glue
      if (Math.abs(W.time - d.t) > 1.5) W.time = d.t;
      for (const r of d.list) {
        if (r.peer === this.net.id) continue;
        this.peers.set(r.peer, { name: r.name, skinId: r.skin, slot: r.slot });
        const sn = r.slot != null ? S.snakeBySlot(W, r.slot) : null;
        if (sn && sn.netRemote) { sn.name = r.name; sn.skinId = r.skin; }
      }
      return;
    }
    if (t === "key") {
      if (this.isHost()) return;
      if (Math.abs(W.time - d.t) > 1.5) W.time = d.t;
      const seen = new Set();
      for (const a of d.food) { seen.add(a[0]); if (!W.food.has(a[0])) this._foodFromNet(a); }
      for (const id of Array.from(W.food.keys())) if (!seen.has(id)) S.removeFood(W, id);
      S.drainEvents(W).forEach((ev) => this._reEmitLocal(ev));
      return;
    }
    if (t === "takeover") {
      const sn = S.snakeBySlot(W, d.slot);
      if (sn && d.slot !== this.mySlot) { sn.isBot = true; sn.netRemote = !this.isHost(); if (this.isHost()) S.attachBrain(W, sn); }
      return;
    }
    if (t === "possess") {
      // a late joiner took over a bot: on everyone else it becomes a remote human
      const sn = S.snakeBySlot(W, d.slot);
      if (sn && d.slot !== this.mySlot) {
        sn.isBot = false; sn.netRemote = true; sn.name = d.name; sn.skinId = d.skin;
        sn.ai = null;
      }
      const p = this.peers.get(d.peer);
      if (p) p.slot = d.slot;
      return;
    }
    if (t === "bye") {
      if (this.isHost()) this._adoptSlot(d.slot);
      return;
    }
  }

  _reEmitLocal(ev) {
    // net-applied food changes still need FX (but no re-broadcast): reuse game handler minus net
    const net = this.game.net;
    this.game.net = null;
    try { this.game._onEvent(ev); } finally { this.game.net = net; }
  }

  _foodFromNet(a, ttl) {
    const W = this.game.W;
    const [id, x, y, z, tier, value] = a;
    if (W.food.has(id)) return;
    S.spawnFood(W, { x: upk(x), y: upk(y), z: upk(z) }, tier, value, ttl != null ? ttl : (tier === 9 ? S.CONST.ESSENCE_TTL : tier === 0 ? S.CONST.PELLET_TTL : null), id);
  }

  _reviveRemote(sn, d) {
    const W = this.game.W;
    this.game._audit("net:reviveRemote slot=" + sn.slot);
    const ns = S.spawnSnake(W, sn.slot, { isBot: sn.isBot, netRemote: true, name: sn.name, skinId: sn.skinId });
    S.remoteFeed(W, ns, { x: upk(d.x), y: upk(d.y), z: upk(d.z) }, d.tx != null ? { x: upk(d.tx), y: upk(d.ty), z: upk(d.tz) } : null, d.m, false);
    S.drainEvents(W);
  }

  _adoptSlot(slot) {
    const W = this.game.W;
    const sn = S.snakeBySlot(W, slot);
    if (sn && sn.netRemote) {
      S.attachBrain(W, sn);
      // a leaver who was DEAD would otherwise stay dead forever — the bot
      // respawn loop only picks up snakes with respawnAt set at death time
      if (!sn.alive && sn.respawnAt == null) sn.respawnAt = W.time + 4;
      this.interp.delete(slot);
      this.send("takeover", { slot });
      this.game.hud.toast("a serpent returned to the wild", "warn");
    }
    for (const [pid, p] of this.peers) if (p.slot === slot) this.peers.delete(pid);
  }

  _becomeHost(nowHost) {
    const wasNull = this._hostFlag === null;
    this._hostFlag = nowHost;
    if (wasNull || !this.started) return;
    const W = this.game.W;
    if (nowHost) {
      // adopt every simulated-nowhere snake (bots the old host ran)
      W.simulateBots = true;
      for (const sn of W.snakes) {
        if (sn.isBot && sn.netRemote) { S.attachBrain(W, sn); this.interp.delete(sn.slot); }
      }
      this.game.hud.toast("you are now the host", "warn");
    }
  }

  // ── lobby/match flow ───────────────────────────────────────────────────────
  _lobbySync() {
    // host assigns lobby slots: host 0, others in join order
    let next = 1;
    for (const [, p] of this.peers) { p.slot = next++; }
    this.send("lobby", { list: this.rosterList() });
    if (this.onLobby) this.onLobby({ list: this.rosterList() });
  }

  hostStart() {
    const cfg = {
      seed: (Math.random() * 0xffffffff) >>> 0,
      biome: S.BIOMES[Math.floor(Math.random() * S.BIOMES.length)],
    };
    this.mySlot = 0;
    let next = 1;
    const roster = [{ peer: this.net.id, slot: 0, name: this.myName, skin: this.mySkin }];
    for (const [pid, p] of this.peers) { p.slot = next; roster.push({ peer: pid, slot: next, name: p.name, skin: p.skinId }); next++; if (next >= 12) break; }
    this.send("start", { cfg, roster });
    this._beginMatch(cfg, roster, 0);
  }

  _beginMatch(cfg, roster, mySlot, assignExtra) {
    this.started = true;
    this.cfg = cfg;
    this.mySlot = mySlot;
    for (const r of roster) {
      if (r.peer === this.net.id) continue;
      this.peers.set(r.peer, { name: r.name, skinId: r.skin, slot: r.slot });
    }
    this.game.startOnlineMatch({
      seed: cfg.seed, biome: cfg.biome, mySlot,
      roster: roster.map((r) => ({ slot: r.slot, name: r.name, skinId: r.skin })),
    }, this);
    // late joiner extras: seed food + my takeover body, then announce possession
    if (assignExtra) {
      const W = this.game.W;
      for (const a of assignExtra.key || []) this._foodFromNet(a);
      const sn = S.snakeBySlot(W, mySlot);
      if (sn && assignExtra.path && assignExtra.path.length >= 6) {
        S.seedPath(W, sn, assignExtra.path.map(upk));
        sn.mass = assignExtra.mass || sn.mass;
        if (assignExtra.t != null) W.time = assignExtra.t;
      }
      S.drainEvents(W);
      this.send("possess", { peer: this.net.id, slot: mySlot, name: this.myName, skin: this.mySkin });
    }
    if (this.onStarted) this.onStarted();
  }

  _assignLate(peerId, hello) {
    const W = this.game.W;
    // pick a live bot (longest-lived vibe: lowest slot), else any dead bot slot
    let pick = null;
    for (const sn of W.snakes) if (sn.isBot && !sn.netRemote && sn.alive) { pick = sn; break; }
    if (!pick) { for (const sn of W.snakes) if (sn.isBot && !sn.netRemote) { pick = sn; break; } }
    if (!pick) return;
    if (!pick.alive) { S.spawnSnake(W, pick.slot, { isBot: true }); S.drainEvents(W); }
    const p = this.peers.get(peerId) || { name: hello.name, skinId: hello.skin };
    p.slot = pick.slot;
    this.peers.set(peerId, p);
    // hand over: stop simulating it here
    pick.isBot = false; pick.netRemote = true; pick.ai = null;
    pick.name = hello.name; pick.skinId = hello.skin;
    // compact path: every 2nd point, quantized
    const path = [];
    const tmp = { x: 0, y: 0, z: 0 };
    const n = Math.min(pick.segN, 300);
    for (let i = n - 1; i >= 0; i -= 2) {
      path.push(pk(pick.segs[i * 3]), pk(pick.segs[i * 3 + 1]), pk(pick.segs[i * 3 + 2]));
    }
    const roster = this.rosterList().map((r) => ({ peer: r.peer, slot: r.slot, name: r.name, skin: r.skin }));
    this.send("assign", {
      peer: peerId, slot: pick.slot, cfg: this.cfg, roster,
      key: this.foodKey(), path, mass: +pick.mass.toFixed(1), t: +W.time.toFixed(2),
    });
  }
}

// leaving the page mid-match: tell the room instantly so the host hands this
// serpent to a bot without waiting for the 10s silence watchdog.
// pagehide too — beforeunload does not fire when an embedding page removes an
// iframe, and pagehide is also the reliable mobile-Safari path.
const _ccBye = () => {
  try {
    const g = window.__CC__ && window.__CC__.game;
    if (g && g.net && g.net.started) g.net.leave();
  } catch (e) {}
};
window.addEventListener("beforeunload", _ccBye);
window.addEventListener("pagehide", _ccBye);

function slerpU(a, b, t) {
  const d = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  const ang = Math.acos(d);
  if (ang < 1e-5) return b;
  const sa = Math.sin((1 - t) * ang) / Math.sin(ang), sb = Math.sin(t * ang) / Math.sin(ang);
  return { x: a.x * sa + b.x * sb, y: a.y * sa + b.y * sb, z: a.z * sa + b.z * sb };
}

// ── lobby UI ─────────────────────────────────────────────────────────────────
export function openLobby(game) {
  const prof = game.menu.getProfile();
  const root = document.createElement("div");
  root.className = "cc-menu";
  root.style.zIndex = 60;
  game.container.appendChild(root);
  const card = document.createElement("div");
  card.className = "cc-card";
  root.appendChild(card);

  const render = (state, statusHtml) => {
    card.innerHTML = `
      <div class="cc-title" style="font-size:30px">PLAY ONLINE</div>
      <div class="cc-tag">REAL SERPENTS · DROP-IN ARENA</div>
      <div style="font-size:13px;opacity:.8;margin-bottom:14px;line-height:1.6">${statusHtml || "Join the public arena, or share a private room code with friends.<br>Joining players take over AI serpents — matches never wait."}</div>
      <div class="cc-modes">
        <button class="cc-mode" data-a="public">🌍 &nbsp;PUBLIC ARENA</button>
        <div style="display:flex;gap:10px">
          <button class="cc-mode alt" style="flex:1" data-a="create">CREATE ROOM</button>
          <input data-a="code" maxlength="4" placeholder="CODE" style="width:110px;text-align:center;letter-spacing:4px;font-weight:900;font-size:16px;background:rgba(0,0,0,.45);border:1px solid rgba(140,210,255,.35);color:#fff;border-radius:12px;text-transform:uppercase">
          <button class="cc-mode ghost" style="flex:.6" data-a="join">JOIN</button>
        </div>
        <button class="cc-mode ghost" data-a="cancel">‹ BACK</button>
      </div>
      <div data-a="room"></div>`;
    card.querySelector('[data-a="public"]').onclick = () => enter("PUBLIC");
    card.querySelector('[data-a="create"]').onclick = () => enter(randCode());
    card.querySelector('[data-a="join"]').onclick = () => {
      const code = card.querySelector('[data-a="code"]').value.trim().toUpperCase();
      if (code.length >= 2) enter(code);
    };
    card.querySelector('[data-a="cancel"]').onclick = () => { cleanup(); };
  };

  let sess = null;
  const cleanup = (keep) => {
    if (!keep && sess) { sess.leave(); sess = null; }
    root.remove();
  };

  async function enter(code) {
    game.audio.ui();
    const net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, "cosmic-coils");
    sess = new Session(game, net);
    sess.myName = prof.name;
    sess.mySkin = prof.skinId;
    game.net = sess;
    net.on("msg", (m) => { try { sess.onMsg(m.from, m.t, m.d); } catch (e) { console.error("[coilnet]", e); } });
    net.on("peer", () => { if (!sess.started && sess.isHost()) sess._lobbySync(); });
    sess.onStarted = () => cleanup(true);
    render(null, `Connecting to <b>${code === "PUBLIC" ? "the public arena" : "room " + code}</b>…`);

    await net.joinRoom(code, null);
    sess.send("hello", { name: prof.name, skin: prof.skinId, late: 1 });

    // room view
    const roomBox = () => card.querySelector('[data-a="room"]');
    const showRoom = () => {
      if (!sess || sess.started) return;
      const n = sess.peers.size + 1;
      const host = sess.isHost();
      const listHtml = [{ name: prof.name + " (you)" }, ...sess.peers.values()]
        .map((p) => `<div style="font-size:13px;letter-spacing:1px;opacity:.9">🐍 ${escq(p.name)}</div>`).join("");
      roomBox().innerHTML = `
        <div class="cc-panel" style="margin-top:6px;padding:14px;border-radius:14px">
          <div style="font-size:13px;letter-spacing:2px;margin-bottom:8px">ROOM <b style="letter-spacing:5px;color:#7dffce">${sess.net.room}</b> · ${n} connected</div>
          ${listHtml}
          <div style="margin-top:12px">${host
            ? `<button class="cc-btn" data-a="go">START MATCH${n === 1 ? " (bots fill in)" : ""}</button>`
            : `<span style="font-size:12px;opacity:.7">waiting for the host to start…</span>`}</div>
        </div>`;
      const go = roomBox().querySelector('[data-a="go"]');
      if (go) go.onclick = () => { game.audio.ui(); sess.hostStart(); };
    };
    sess.onLobby = showRoom;
    net.on("peer", showRoom);
    showRoom();

    // public arena: if nobody else shows up in 2.5s and we're host → auto-start;
    // if a match is running, the host answers our late-hello with "assign".
    if (code === "PUBLIC") {
      setTimeout(() => {
        if (sess && !sess.started && sess.isHost() && sess.peers.size === 0) sess.hostStart();
      }, 2500);
    }
  }

  render();
}

function randCode() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function escq(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
