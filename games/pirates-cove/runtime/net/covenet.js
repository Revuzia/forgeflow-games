/**
 * Pirate's Cove — runtime/net/covenet.js — COVE ARENA (online PVP).
 *
 * Three match types over the shared FFG NetPlay relay (Supabase Realtime,
 * same $0 transport as Dungeon Forge / Cosmic Coils):
 *   • DUEL   — 1v1, first sink wins
 *   • TEAMS  — 2v2, last team afloat
 *   • ARMADA — 10-ship free-for-all, last ship afloat
 *
 * The arena is a COMPACT ring (far smaller than the open sea) placed on a
 * clear patch of water. Remote ships + bot ships ride the sandbox's own
 * npcs[] pipeline as pvp-flagged entries — broadsides, selection, ramming
 * and the minimap all Just Work against them. Empty slots are filled by
 * host-simulated bots so ARMADA is always a 10-ship brawl.
 *
 * Authority: each captain owns their OWN hp (shooter sends `hit`, victim
 * applies + rebroadcasts). Bots are owned by the host. Host also owns the
 * win check. Host leaving voids the match (no migration in v1).
 */

const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

const MODES = {
  duel:  { label: "Duel — 1v1",           slots: 2,  teams: 0, R: 220 },
  teams: { label: "Broadside Brothers — 2v2", slots: 4, teams: 2, R: 260 },
  ffa:   { label: "Armada — 10-ship free-for-all", slots: 10, teams: 0, R: 320 },
};
const PIRATE_NAMES = ["Rook", "Marrow", "Tess", "Flint", "Ivory", "Gull", "Sable", "Pike", "Moray", "Cutter", "Bones", "Vane"];
const TEAM_COLOR = [0xc62828, 0x2f6fc6];
const TEAM_NAME = ["Crimson", "Cobalt"];
const BOT_DMG = 13, BOT_HP = 120, SHIP_HP = 150;

const A = () => window.__PC_ARENA__;

function nameTag(THREE, text, colorHex) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 56;
  const g = c.getContext("2d");
  g.font = "700 30px 'Segoe UI', sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "rgba(6,10,16,0.72)";
  const w = Math.min(244, g.measureText(text).width + 30);
  g.beginPath(); g.roundRect(128 - w / 2, 6, w, 44, 18); g.fill();
  g.fillStyle = "#" + colorHex.toString(16).padStart(6, "0");
  g.fillText(text, 128, 27);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(26, 5.7, 1);
  spr.position.y = 26;
  return spr;
}

class Match {
  constructor() {
    this.net = null;
    this.myName = localStorage.getItem("pc_arena_name") || PIRATE_NAMES[(Math.random() * PIRATE_NAMES.length) | 0] + "-" + ((Math.random() * 90 + 10) | 0);
    this.modeId = "duel";
    this.state = "idle";        // idle | lobby | live | over
    this.roster = [];           // [{id,name,bot,team}]
    this.peersHere = new Map(); // live peer ids → name (lobby presence)
    this.center = { x: 0, z: 0 };
    this.meDead = false;
    this.aliveMap = new Map();  // id → alive
    this.entries = new Map();   // id → npc-shaped pvp entry (remote players + bots)
    this.buoys = [];
    this._iv = [];
    this._botAI = new Map();    // botId → ai state (host only)
    this._endGuard = false;
  }

  amHost() {
    if (!this.net) return true;
    const ids = [this.net.id, ...this.peersHere.keys()].sort();
    return ids[0] === this.net.id;
  }

  async _mkNet(lobbyMode) {
    const { NetPlay } = await import("./ffg_netplay.js");
    // Per-mode quick-match lobbies; code rooms share one namespace (host's mode wins)
    this.net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, lobbyMode ? "pirates-cove-" + this.modeId : "pirates-cove");
    this.net.on("msg", (m) => { try { this._onMsg(m.from, m.t, m.d); } catch (e) { console.error("[covenet]", e); } });
    this.net.on("peer", (p) => this._onPeers(p));
  }

  async host() {
    await this._mkNet(false);
    const code = Math.random().toString(36).slice(2, 6).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    await this.net.joinRoom(code, true);
    this.state = "lobby";
    this._say("hello", { name: this.myName });
    return code;
  }

  async join(code) {
    await this._mkNet(false);
    await this.net.joinRoom(String(code).trim().toUpperCase(), false);
    this.state = "lobby";
    this._say("hello", { name: this.myName, wantCfg: 1 });
    return this.net.room;
  }

  async quickMatch() {
    await this._mkNet(true);
    const res = await this.net.quickMatch(15000);
    if (!res) { try { this.net.leave(); } catch (e) {} this.net = null; return null; }
    this.state = "lobby";
    this._say("hello", { name: this.myName, wantCfg: 1 });
    // In quick match the paired host auto-starts shortly (bots fill)
    if (res.host) setTimeout(() => { if (this.state === "lobby") this.start(); }, 2500);
    return res.room;
  }

  _say(t, d) { try { this.net && this.net.send(t, d); } catch (e) {} }

  _onPeers() {
    ui.lobbyRender();
    // Host vanished mid-match → void it (v1: no host migration)
    if (this.state === "live" && this._hostId && ![this.net.id, ...this.peersHere.keys()].includes(this._hostId)) {
      A().banner("🏳 The host struck their colors — match void");
      this.end(null, true);
    }
  }

  _onMsg(from, t, d) {
    const api = A();
    if (t === "hello") {
      if (!this.peersHere.has(from)) {
        this.peersHere.set(from, d && d.name || "Captain");
        api.banner("🏴‍☠️ " + (d && d.name || "A captain") + " joined the cove");
        this._say("hello", { name: this.myName });          // re-announce for late joiners
        if (this.amHost() && d && d.wantCfg) this._say("cfg", { mode: this.modeId });
      } else if (d && d.name) this.peersHere.set(from, d.name);
      ui.lobbyRender();
      return;
    }
    if (t === "cfg") { if (!this.amHost()) { this.modeId = d.mode || "duel"; ui.lobbyRender(); } return; }
    if (t === "start") { this._applyStart(from, d); return; }
    if (t === "st") { this._onPeerState(from, d); return; }
    if (t === "bst") { if (from === this._hostId) for (const b of d.list || []) this._onBotState(b); return; }
    if (t === "bfire") { if (from === this._hostId) this._renderBotFire(d); return; }
    if (t === "hit") { if (d.to === this.net.id) this._takeHit(d); return; }
    if (t === "phit") { if (this.amHost()) this._botTakeHit(d); return; }
    if (t === "sunk") { this._peerSunk(from); return; }
    if (t === "bsunk") { this._botSunk(d.bot); return; }
    if (t === "end") { this._applyEnd(d); return; }
  }

  /* ── match start ─────────────────────────────────────────────────────── */
  start() {
    if (!this.amHost() || this.state !== "lobby") return;
    const cfg = MODES[this.modeId];
    const humans = [this.net.id, ...this.peersHere.keys()].sort();
    if (humans.length > cfg.slots) { A().banner("⚠ Too many captains for this mode"); return; }
    const roster = humans.map((id, i) => ({ id, name: id === this.net.id ? this.myName : (this.peersHere.get(id) || "Captain"), bot: false, team: cfg.teams ? i % cfg.teams : -1 }));
    for (let b = 0; roster.length < cfg.slots; b++) {
      roster.push({ id: "b" + b, name: PIRATE_NAMES[(b + 3) % PIRATE_NAMES.length] + " (bot)", bot: true, team: cfg.teams ? roster.length % cfg.teams : -1 });
    }
    const center = this._pickCenter(cfg.R);
    const payload = { mode: this.modeId, center, roster };
    this._say("start", payload);
    this._applyStart(this.net.id, payload);
  }

  _pickCenter(R) {
    const api = A();
    const isles = api.islandsXZR;
    for (let t = 0; t < 60; t++) {
      const a = Math.random() * Math.PI * 2, r = 500 + Math.random() * (api.SEA - R - 560);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      let clear = true;
      for (const is of isles) if (Math.hypot(is.x - x, is.z - z) < is.r + R + 90) { clear = false; break; }
      if (clear) return { x: Math.round(x), z: Math.round(z) };
    }
    return { x: 0, z: -Math.min(900, A().SEA - R - 60) };   // fallback lane south of town
  }

  _applyStart(fromId, d) {
    const api = A();
    this._hostId = fromId;
    this.modeId = d.mode;
    this.center = d.center;
    this.roster = d.roster;
    this.state = "live";
    this.meDead = false;
    this._endGuard = false;
    this.aliveMap.clear();
    for (const r of this.roster) this.aliveMap.set(r.id, true);

    api.startGame();
    api.pvp.active = true;
    api.pvp.hooks = this._hooks();
    api.hideSandboxShips();
    api.removePvpEntries();
    this.entries.clear();
    this._botAI.clear();

    const cfg = MODES[this.modeId];
    const meIdx = this.roster.findIndex((r) => r.id === this.net.id);
    const spawnOf = (i) => {
      const n = this.roster.length;
      let ang;
      if (cfg.teams) {  // teams: one arc per side, facing each other
        const r = this.roster[i];
        const teamIdx = this.roster.filter((q) => q.team === r.team).findIndex((q) => q.id === r.id);
        const spread = 0.5;
        ang = (r.team === 0 ? Math.PI : 0) + (teamIdx - 0.5) * spread;
      } else ang = (i / n) * Math.PI * 2;
      return { x: this.center.x + Math.cos(ang) * cfg.R * 0.72, z: this.center.z + Math.sin(ang) * cfg.R * 0.72, yaw: Math.atan2(this.center.x - (this.center.x + Math.cos(ang) * cfg.R * 0.72), this.center.z - (this.center.z + Math.sin(ang) * cfg.R * 0.72)) };
    };

    // ME (arena stats are a level playing field; sandbox hpMax restored on exit)
    const my = spawnOf(meIdx);
    const p = api.player;
    if (this._prevHpMax == null) this._prevHpMax = p.hpMax;
    p.x = my.x; p.z = my.z; p.yaw = my.yaw; p.speed = 0; p.throttle = 0;
    p.hpMax = SHIP_HP; p.hp = p.hpMax;
    if (p.mesh) { p.mesh.visible = true; p.mesh.position.set(p.x, 0, p.z); p.mesh.rotation.y = p.yaw; }

    // EVERYONE ELSE (players + bots) as pvp entries in npcs[]
    for (let i = 0; i < this.roster.length; i++) {
      const r = this.roster[i];
      if (r.id === this.net.id) continue;
      const sp = spawnOf(i);
      const mesh = api.makeShip(r.bot ? "small" : "medium", false);
      mesh.position.set(sp.x, 0, sp.z);
      api.scene.add(mesh);
      const color = cfg.teams ? TEAM_COLOR[r.team] : (r.bot ? 0x9aa2ad : 0xffd769);
      mesh.add(nameTag(api.THREE, r.name, color));
      this._tintFlags(mesh, color);
      const e = {
        pvp: true, peerId: r.bot ? null : r.id, botId: r.bot ? r.id : null, team: r.team,
        x: sp.x, z: sp.z, yaw: sp.yaw, speed: 0, mesh,
        hp: r.bot ? BOT_HP : SHIP_HP, hpMax: r.bot ? BOT_HP : SHIP_HP,
        alive: true, hostile: false, level: 3, dmg: r.bot ? BOT_DMG : 16, evasion: 1,
        type: r.bot ? "Corsair (bot)" : "Captain " + r.name, reloadT: 2 + Math.random() * 2,
        rIn: 0, rOut: 0, idx: i, bob: Math.random() * 6, hullMats: mesh.userData.hullMats,
        _tx: sp.x, _tz: sp.z, _tyaw: sp.yaw, _tspeed: 0,
      };
      this.entries.set(r.id, e);
      api.npcs.push(e);
      if (r.bot && this.amHost()) this._botAI.set(r.id, { fireT: 3 + Math.random() * 3, wobble: Math.random() * 6 });
    }

    this._buildBuoys(cfg.R);
    this._iv.push(setInterval(() => this._sendState(), 100));
    if (this.amHost()) this._iv.push(setInterval(() => this._broadcastBots(), 125));
    const label = cfg.teams ? "You sail for team " + TEAM_NAME[this.roster[meIdx].team] + "!" : MODES[this.modeId].label;
    api.banner("⚔ COVE ARENA — " + label + " — FIGHT!");
    ui.matchRender();
  }

  _tintFlags(mesh, color) {
    mesh.traverse((n) => {
      if (n.name && /^flag-/.test(n.name)) n.traverse((q) => { if (q.isMesh && q.material && q.material.color) { q.material.color.setHex(color); q.material.needsUpdate = true; } });
    });
  }

  _buildBuoys(R) {
    const api = A(), THREE = api.THREE;
    this._clearBuoys();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 9, 6), new THREE.MeshStandardMaterial({ color: 0x30251a, roughness: 0.8 }));
      pole.position.y = 3.5;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 10), new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff6a1a, emissiveIntensity: 1.4 }));
      lamp.position.y = 9;
      g.add(pole, lamp);
      g.position.set(this.center.x + Math.cos(a) * R, 0, this.center.z + Math.sin(a) * R);
      api.scene.add(g);
      this.buoys.push(g);
    }
  }
  _clearBuoys() {
    const api = A();
    for (const b of this.buoys) { api.scene.remove(b); b.traverse((o) => { if (o.isMesh) { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); } }); }
    this.buoys = [];
  }

  /* ── per-frame (called from the game's onUpdate via pvp.hooks.step) ───── */
  _hooks() {
    return {
      step: (dt) => this._step(dt),
      localHit: (tgt, res) => {   // my broadside landed on an arena ship
        if (this._friendly(tgt)) return;   // 2v2: no friendly fire
        if (tgt.peerId) this._say("hit", { to: tgt.peerId, dmg: res.dmg, crit: !!res.crit });
        else if (tgt.botId) { if (this.amHost()) this._botTakeHit({ bot: tgt.botId, dmg: res.dmg }); else this._say("phit", { bot: tgt.botId, dmg: res.dmg }); }
      },
      localRam: (tgt, dmg) => {
        if (this._friendly(tgt)) return;
        if (tgt.peerId) this._say("hit", { to: tgt.peerId, dmg, crit: false, ram: true });
        else if (tgt.botId) { if (this.amHost()) this._botTakeHit({ bot: tgt.botId, dmg }); else this._say("phit", { bot: tgt.botId, dmg }); }
      },
      meSunk: () => this._meSunk(),
      pvpEntrySunk: () => {},     // sinks are event-driven; local hp never kills an arena entry
    };
  }

  _friendly(tgt) {
    if (!MODES[this.modeId].teams) return false;
    const mine = (this.roster.find((r) => r.id === this.net.id) || {}).team;
    return tgt.team === mine;
  }

  _step(dt) {
    const api = A(), p = api.player, cfg = MODES[this.modeId];
    // Soft arena bounds for ME
    const dx = p.x - this.center.x, dz = p.z - this.center.z, d = Math.hypot(dx, dz);
    if (d > cfg.R) {
      const k = cfg.R / d;
      p.x = this.center.x + dx * k; p.z = this.center.z + dz * k;
      p.speed *= 0.85;
      this._boundT = (this._boundT || 0) - dt;
      if (this._boundT <= 0) { this._boundT = 2.4; api.banner("🛟 The buoy line — turn back!"); }
    }
    // Interp remote ships toward their targets; bots (host) get real AI
    for (const [id, e] of this.entries) {
      if (!e.alive) continue;
      if (e.botId && this.amHost()) this._botStep(e, dt);
      else {
        const k = 1 - Math.exp(-8 * dt);
        e.x += (e._tx - e.x) * k; e.z += (e._tz - e.z) * k;
        let dy = e._tyaw - e.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        e.yaw += dy * k; e.speed = e._tspeed;
      }
      if (e.mesh) { e.mesh.position.set(e.x, Math.sin(performance.now() / 700 + e.bob) * 0.5, e.z); api.faceYaw(e.mesh, e.yaw); e.mesh.visible = true; }
    }
    // Lamp pulse
    const t = performance.now() / 1000;
    for (let i = 0; i < this.buoys.length; i++) { const lamp = this.buoys[i].children[1]; if (lamp) lamp.material.emissiveIntensity = 1.1 + Math.sin(t * 2.4 + i) * 0.5; }
    if (this.amHost()) this._winCheck();
  }

  _sendState() {
    if (this.state !== "live" || !this.net) return;
    const p = A().player;
    this._say("st", { x: +p.x.toFixed(1), z: +p.z.toFixed(1), yaw: +p.yaw.toFixed(3), sp: +p.speed.toFixed(1), hp: Math.max(0, Math.round(p.hp)), dead: this.meDead ? 1 : 0 });
  }

  _onPeerState(from, d) {
    const e = this.entries.get(from);
    if (!e || !e.alive) return;
    e._tx = d.x; e._tz = d.z; e._tyaw = d.yaw; e._tspeed = d.sp;
    e.hp = d.hp;
    if (d.dead && this.aliveMap.get(from)) this._peerSunk(from);
  }

  _takeHit(d) {
    const api = A(), p = api.player;
    if (this.meDead || this.state !== "live") return;
    p.hp -= d.dmg;
    api.damageFlash(p); api.addShake(d.crit ? 1.0 : 0.55);
    api.burst(p.x, p.z, true, !!d.crit); api.sfxAt("hit", p.x, p.z, d.crit ? 1 : 0.85);
    if (p.hp <= 0) { p.hp = 0; api.sinkPlayer(); }   // guarded → hooks.meSunk
  }

  _meSunk() {
    if (this.meDead) return;
    this.meDead = true;
    this.aliveMap.set(this.net.id, false);
    const api = A(), p = api.player;
    api.playSfx("sink", 1, 0.9); api.sinkSplash(p.x, p.z, true);
    if (p.mesh) p.mesh.visible = false;
    p.speed = 0; p.throttle = 0;
    api.banner("💀 You were sunk — spectating…");
    this._say("sunk", {});
    ui.matchRender();
  }

  _peerSunk(id) {
    const e = this.entries.get(id);
    this.aliveMap.set(id, false);
    if (e && e.alive) {
      e.alive = false;
      const api = A();
      api.sinkSplash(e.x, e.z, true); api.sfxAt("sink", e.x, e.z, 1);
      if (e.mesh) e.mesh.visible = false;
      api.banner("☠ " + (this.roster.find((r) => r.id === id) || {}).name + " went down!");
    }
    ui.matchRender();
    if (this.amHost()) this._winCheck();
  }

  /* ── bots (host-simulated) ───────────────────────────────────────────── */
  _botTargets() {
    const out = [];
    const p = A().player;
    if (!this.meDead) out.push({ id: this.net.id, x: p.x, z: p.z, yaw: p.yaw, speed: p.speed, team: (this.roster.find((r) => r.id === this.net.id) || {}).team });
    for (const [id, e] of this.entries) if (e.alive && e.peerId) out.push({ id, x: e.x, z: e.z, yaw: e.yaw, speed: e.speed, team: e.team });
    return out;
  }

  _botStep(e, dt) {
    const api = A(), cfg = MODES[this.modeId], ai = this._botAI.get(e.botId);
    if (!ai) return;
    const targets = this._botTargets().filter((t) => !(cfg.teams && t.team === e.team));
    let tgt = null, best = 1e9;
    for (const t of targets) { const d = Math.hypot(t.x - e.x, t.z - e.z); if (d < best) { best = d; tgt = t; } }
    const speedMax = 30;
    if (tgt) {
      const orbitR = 95;
      const bear = Math.atan2(tgt.x - e.x, tgt.z - e.z);
      const spiral = Math.max(-0.6, Math.min(0.6, (best - orbitR) / orbitR));
      const want = bear + (e.idx % 2 ? 1 : -1) * (Math.PI / 2 - spiral);
      let dy = want - e.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      e.yaw += Math.max(-1.1 * dt, Math.min(1.1 * dt, dy));
      e.speed += (speedMax * 0.85 - e.speed) * Math.min(1, dt * 0.8);
      ai.fireT -= dt;
      if (ai.fireT <= 0 && best < api.FIRE_RANGE) {
        const off = Math.abs(api.relBearing(e.x, e.z, e.yaw, tgt.x, tgt.z));
        if (Math.abs(off - Math.PI / 2) < 0.5) {
          ai.fireT = 3.4 + Math.random() * 2.2;
          this._say("bfire", { bot: e.botId, tgt: tgt.id, fx: +e.x.toFixed(1), fz: +e.z.toFixed(1) });
          this._renderBotFire({ bot: e.botId, tgt: tgt.id, fx: e.x, fz: e.z });
        } else ai.fireT = 0.6;
      }
    } else { e.speed += (10 - e.speed) * Math.min(1, dt * 0.5); e.yaw += 0.15 * dt; }
    // keep bots inside the ring
    const dx = e.x - this.center.x, dz = e.z - this.center.z, d = Math.hypot(dx, dz);
    if (d > cfg.R * 0.94) { e.yaw = Math.atan2(this.center.x - e.x, this.center.z - e.z); }
    e.x += Math.sin(e.yaw) * e.speed * dt; e.z += Math.cos(e.yaw) * e.speed * dt;
  }

  _broadcastBots() {
    if (this.state !== "live") return;
    const list = [];
    for (const [id, e] of this.entries) if (e.botId && e.alive) list.push({ id, x: +e.x.toFixed(1), z: +e.z.toFixed(1), yaw: +e.yaw.toFixed(3), sp: +e.speed.toFixed(1), hp: Math.round(e.hp) });
    if (list.length) this._say("bst", { list });
  }

  _onBotState(b) {
    const e = this.entries.get(b.id);
    if (!e || !e.alive) return;
    e._tx = b.x; e._tz = b.z; e._tyaw = b.yaw; e._tspeed = b.sp; e.hp = b.hp;
  }

  _renderBotFire(d) {
    const api = A();
    const e = this.entries.get(d.bot);
    if (!e || !e.alive) return;
    api.muzzle(d.fx, d.fz, e.x, e.z);
    api.sfxAt("fire", d.fx, d.fz, 0.6);
    // The TARGET rolls + applies its own damage (self-authoritative)
    if (d.tgt === this.net.id && !this.meDead) {
      const p = api.player;
      const res = api.rollShot(BOT_DMG, p.evasion, Math.hypot(p.x - d.fx, p.z - d.fz) / api.FIRE_RANGE);
      api.fireBall(d.fx, d.fz, p, res,
        () => { this._takeHit({ dmg: res.dmg, crit: res.crit }); },
        (ax, az) => { api.burst(ax, az, false, false); api.sfxAt("miss", ax, az, 0.7); });
    } else {
      // cosmetic ball toward the target's current entry
      const t = d.tgt === this.net.id ? api.player : this.entries.get(d.tgt);
      if (t) api.fireBall(d.fx, d.fz, t, { hit: false, crit: false, dmg: 0 }, () => {}, (ax, az) => api.burst(ax, az, false, false));
    }
  }

  _botTakeHit(d) {   // host authority
    const e = this.entries.get(d.bot);
    if (!e || !e.alive) return;
    e.hp -= d.dmg;
    if (e.hp <= 0) { this._say("bsunk", { bot: d.bot }); this._botSunk(d.bot); }
  }

  _botSunk(botId) {
    const e = this.entries.get(botId);
    this.aliveMap.set(botId, false);
    if (e && e.alive) {
      e.alive = false;
      const api = A();
      api.sinkSplash(e.x, e.z, false); api.sfxAt("sink", e.x, e.z, 0.9);
      if (e.mesh) e.mesh.visible = false;
    }
    ui.matchRender();
    if (this.amHost()) this._winCheck();
  }

  /* ── win / end ───────────────────────────────────────────────────────── */
  _winCheck() {
    if (this.state !== "live" || this._endGuard) return;
    const cfg = MODES[this.modeId];
    const alive = this.roster.filter((r) => this.aliveMap.get(r.id));
    if (cfg.teams) {
      const teams = new Set(alive.map((r) => r.team));
      if (teams.size <= 1) {
        this._endGuard = true;
        const w = teams.size ? [...teams][0] : -1;
        const d = { winner: w < 0 ? null : { team: w, label: TEAM_NAME[w] + " team" } };
        this._say("end", d); this._applyEnd(d);
      }
    } else if (alive.length <= 1) {
      this._endGuard = true;
      const w = alive[0] || null;
      const d = { winner: w ? { id: w.id, label: w.name } : null };
      this._say("end", d); this._applyEnd(d);
    }
  }

  _applyEnd(d) {
    if (this.state !== "live") return;
    this.state = "over";
    const api = A();
    let msg;
    if (!d.winner) msg = "🌊 The cove claims all — draw!";
    else if (d.winner.id === this.net.id) msg = "🏆 VICTORY — the cove is yours!";
    else if (d.winner.team != null) {
      const mine = (this.roster.find((r) => r.id === this.net.id) || {}).team;
      msg = d.winner.team === mine ? "🏆 VICTORY — " + d.winner.label + " takes the cove!" : "☠ Defeat — " + d.winner.label + " takes the cove";
    } else msg = "☠ " + d.winner.label + " rules the cove";
    api.banner(msg);
    ui.showResult(msg, this.amHost());
  }

  end(_, silent) {
    // full cleanup back to sandbox
    for (const iv of this._iv) clearInterval(iv);
    this._iv = [];
    const api = A();
    api.pvp.active = false;
    api.pvp.hooks = null;
    api.removePvpEntries();
    api.restoreSandboxShips();
    this._clearBuoys();
    this.entries.clear();
    this._botAI.clear();
    const p = api.player;
    if (this._prevHpMax != null) { p.hpMax = this._prevHpMax; this._prevHpMax = null; }
    p.hp = p.hpMax; p.speed = 0;
    p.x = api.townPos.x + 60; p.z = api.townPos.z + 170; p.yaw = Math.PI;   // back by the harbor
    if (p.mesh) { p.mesh.visible = true; p.mesh.position.set(p.x, 0, p.z); }
    this.meDead = false;
    this.state = this.net ? "lobby" : "idle";
    if (!silent) api.banner("⚓ Back to the open cove");
    ui.reset();
  }

  rematch() { if (this.amHost() && (this.state === "over" || this.state === "lobby")) { this.end(null, true); this.start(); } }

  async leaveAll() {
    if (this.state === "live" || this.state === "over") this.end(null, true);
    try { this.net && this.net.leave(); } catch (e) {}
    this.net = null;
    this.peersHere.clear();
    this.state = "idle";
    ui.reset();
  }
}

/* ── UI ─────────────────────────────────────────────────────────────────── */
const ui = {
  panel: null, body: null,
  build() {
    const css = document.createElement("style");
    css.textContent = `
      #pcnet{position:fixed;right:14px;top:64px;z-index:75;width:280px;font:14px 'Segoe UI',sans-serif;color:#eaf4ff;
        background:linear-gradient(165deg,rgba(8,22,34,.96),rgba(4,12,20,.97));border:1px solid rgba(127,215,255,.5);
        border-radius:16px;padding:14px;display:none;box-shadow:0 14px 44px rgba(0,0,0,.55)}
      #pcnet h3{margin:0 0 8px;font-size:15px;color:#7fd7ff;letter-spacing:.05em}
      #pcnet .row{display:flex;gap:6px;margin:6px 0}
      #pcnet button{flex:1;font:700 12.5px 'Segoe UI',sans-serif;background:rgba(127,215,255,.12);color:#d5efff;
        border:1px solid rgba(127,215,255,.42);border-radius:10px;padding:8px 6px;cursor:pointer}
      #pcnet button:hover{background:rgba(127,215,255,.24)}
      #pcnet button.sel{background:rgba(127,215,255,.32);border-color:#7fd7ff}
      #pcnet input{flex:1;min-width:0;background:rgba(0,0,0,.4);border:1px solid rgba(127,215,255,.3);border-radius:10px;
        color:#fff;padding:8px;font:13px 'Segoe UI',sans-serif;letter-spacing:.08em}
      #pcnet .code{font:800 21px/1.2 Consolas,monospace;color:#ffd769;text-align:center;letter-spacing:.16em;margin:6px 0;min-height:26px}
      #pcnet .st{font-size:12px;color:#9fd8ff;opacity:.9;min-height:16px;margin-top:4px}
      #pcnet .who{font-size:12px;color:#cde9ff;line-height:1.5;margin:4px 0}
      #pcnet .x{position:absolute;top:8px;right:12px;background:none;border:none;color:#9fd8ff;font-size:16px;cursor:pointer;flex:0}
      `;
    document.head.appendChild(css);
    const p = document.createElement("div");
    p.id = "pcnet";
    p.innerHTML = `
      <button class="x" id="pcn-close">✕</button>
      <h3>⚔ COVE ARENA</h3>
      <div class="row" id="pcn-modes">
        <button data-m="duel">1v1</button><button data-m="teams">2v2</button><button data-m="ffa">10-Ship</button>
      </div>
      <div class="row"><input id="pcn-name" maxlength="14" title="Captain name"/></div>
      <div class="row"><button id="pcn-host">Host (code)</button><button id="pcn-qm">Quick Match</button></div>
      <div class="row"><input id="pcn-code" placeholder="ROOM CODE" maxlength="8"/><button id="pcn-join" style="flex:0 0 60px">Join</button></div>
      <div class="code" id="pcn-roomcode"></div>
      <div class="who" id="pcn-who"></div>
      <div class="row" id="pcn-hostrow" style="display:none"><button id="pcn-start">⚔ START (bots fill empty ships)</button></div>
      <div class="row" id="pcn-endrow" style="display:none"><button id="pcn-rematch">Rematch</button><button id="pcn-return">Return to Cove</button></div>
      <div class="row"><button id="pcn-leave">Leave Arena</button></div>
      <div class="st" id="pcn-status">Pick a mode, then Host / Join / Quick Match. Solo? Host + START = practice vs bots.</div>`;
    document.body.appendChild(p);
    this.panel = p;
    p.querySelector("#pcn-close").onclick = () => (p.style.display = "none");
    const nameIn = p.querySelector("#pcn-name");
    nameIn.value = match.myName;
    nameIn.onchange = () => { match.myName = nameIn.value.trim() || match.myName; localStorage.setItem("pc_arena_name", match.myName); };
    p.querySelectorAll("#pcn-modes button").forEach((b) => {
      b.onclick = () => { if (match.state === "live") return; match.modeId = b.dataset.m; this.modeRender(); if (match.net && match.amHost()) match._say("cfg", { mode: match.modeId }); };
    });
    p.querySelector("#pcn-host").onclick = async () => {
      if (match.net) return this.status("Already in a room — Leave first");
      this.status("Opening the cove…");
      try { const code = await match.host(); p.querySelector("#pcn-roomcode").textContent = code; this.status("Share the code — START when ready"); this.lobbyRender(); }
      catch (e) { console.error(e); this.status("Couldn't open a room"); }
    };
    p.querySelector("#pcn-join").onclick = async () => {
      if (match.net) return this.status("Already in a room — Leave first");
      const code = p.querySelector("#pcn-code").value;
      if (!code || code.trim().length < 4) return this.status("Enter the room code");
      this.status("Boarding…");
      try { const r = await match.join(code); p.querySelector("#pcn-roomcode").textContent = r; this.status("Aboard — waiting for the host to START"); this.lobbyRender(); }
      catch (e) { console.error(e); this.status("Join failed — check the code"); }
    };
    p.querySelector("#pcn-qm").onclick = async () => {
      if (match.net) return this.status("Already in a room — Leave first");
      this.status("Scanning the horizon… (15s)");
      try {
        const r = await match.quickMatch();
        if (!r) return this.status("No captains about — Host and share your code, or START solo vs bots");
        p.querySelector("#pcn-roomcode").textContent = r;
        this.status("Matched! Battle starts in a moment…");
        this.lobbyRender();
      } catch (e) { console.error(e); this.status("Quick match failed"); }
    };
    p.querySelector("#pcn-start").onclick = () => match.start();
    p.querySelector("#pcn-rematch").onclick = () => match.rematch();
    p.querySelector("#pcn-return").onclick = () => { match.end(); };
    p.querySelector("#pcn-leave").onclick = () => match.leaveAll();
    this.modeRender();
  },
  open() { this.panel.style.display = "block"; this.modeRender(); },
  modeRender() {
    this.panel.querySelectorAll("#pcn-modes button").forEach((b) => b.classList.toggle("sel", b.dataset.m === match.modeId));
    this.lobbyRender();
  },
  lobbyRender() {
    const who = this.panel.querySelector("#pcn-who");
    const cfg = MODES[match.modeId];
    const names = match.net ? [match.myName + " (you)", ...match.peersHere.values()] : [];
    who.innerHTML = match.net
      ? `<b>${cfg.label}</b><br>${names.map((n) => "🏴‍☠️ " + n).join("<br>")}<br><span style="opacity:.65">${Math.max(0, cfg.slots - names.length)} slot(s) → bots</span>`
      : `<b>${cfg.label}</b> — ${cfg.slots} ships`;
    this.panel.querySelector("#pcn-hostrow").style.display = match.net && match.amHost() && match.state === "lobby" ? "flex" : "none";
    this.panel.querySelector("#pcn-endrow").style.display = "none";
  },
  matchRender() {
    if (match.state !== "live" && match.state !== "over") return;
    const alive = match.roster.filter((r) => match.aliveMap.get(r.id)).length;
    this.status("⚔ Ships afloat: " + alive + "/" + match.roster.length + (match.meDead ? " — you sank (spectating)" : ""));
  },
  showResult(msg, isHost) {
    this.panel.style.display = "block";
    this.status(msg);
    this.panel.querySelector("#pcn-endrow").style.display = "flex";
    this.panel.querySelector("#pcn-rematch").style.display = isHost ? "block" : "none";
  },
  status(s) { const el = this.panel && this.panel.querySelector("#pcn-status"); if (el) el.textContent = s; },
  reset() {
    if (!this.panel) return;
    this.panel.querySelector("#pcn-roomcode").textContent = match.net ? (match.net.room || "") : "";
    this.panel.querySelector("#pcn-endrow").style.display = "none";
    this.lobbyRender();
  },
};

/* ── boot ───────────────────────────────────────────────────────────────── */
const match = new Match();
(function waitReady(tries) {
  try {
    if (window.__PC_ARENA__ && window.__PC_ARENA__.pvp && document.body) {
      ui.build();
      window.__PC_ARENA__.openMenu = () => ui.open();
      window.__PC_ARENA__.match = match;
      window.__PC_ARENA__.ui = ui;
      return;
    }
  } catch (e) { console.warn("[covenet] init", e); return; }
  if (tries > 150) return;   // module quietly absent — sandbox unaffected
  setTimeout(() => waitReady(tries + 1), 400);
})(0);
