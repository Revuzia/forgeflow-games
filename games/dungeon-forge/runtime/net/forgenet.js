/**
 * Dungeon Forge — runtime/net/forgenet.js
 * Room session over the NetPlay Supabase-Realtime relay (same transport as
 * Cosmic Coils / Last Circle — pure broadcast, $0). One room hosts BOTH
 * activities: real-time co-BUILDING (edit ops relayed, everyone converges)
 * and co-op ESCAPE runs (each client owns its player @10Hz; the host — lowest
 * peer id — owns enemies @7Hz and relays authoritative world events).
 * Late joiners get a keyframe: full dungeon JSON in build, or run snapshot
 * (doors/chests/keys/enemy hp) in play, so drop-in always works.
 */
const V = new URL(import.meta.url).search;
const { NetPlay } = await import("./ffg_netplay.js" + V);
const D = await import("../sim/dungeon.js" + V);

const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

const PEER_COLORS = [0xffb347, 0x59ff9c, 0x37e0ff, 0xff3d81, 0x8f6bff, 0xffd769];

export class Session {
  constructor(game, profile) {
    this.g = game;
    this.me = { name: profile.name, skin: profile.skin };
    this.net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, "dungeon-forge");
    this.peers = new Map();        // peerId → {name, skin, color}
    this.phase = "lobby";          // lobby | build | play
    this.builder = null;
    this.escape = null;
    this.dungeon = null;
    this.playSeed = 0;
    this._tPst = 0; this._tEn = 0; this._tCur = 0;
    this._gotKf = false;
    this.net.on("msg", (m) => { try { this.onMsg(m.from, m.t, m.d); } catch (e) { console.error("[forgenet]", e); } });
    this.net.on("peer", (p) => this._onPeers(p));
  }

  id() { return this.net.id; }
  isHost() {
    const ids = [this.net.id, ...this.peers.keys()].sort();
    return ids[0] === this.net.id;
  }
  roomCode() { return this.net.room; }
  /** Warn once when a peer runs a different build — a stale cached client
   *  silently rejects op kinds it doesn't know (props/NPCs/stairs vanish for
   *  them), which looks like "my friend can't see what I place". */
  _checkVersion(remoteV, who) {
    if (remoteV === undefined || remoteV === V || this._verWarned) return;
    this._verWarned = true;
    this.g.hud.toast("⚠ " + (who || "A teammate") + " is on a different game version — EVERYONE hard-refresh (Ctrl+F5) or builds won't sync fully", "warn");
  }

  roster() {
    const list = [{ id: this.net.id, name: this.me.name, skin: this.me.skin }];
    for (const [pid, p] of this.peers) list.push({ id: pid, name: p.name, skin: p.skin });
    return list;
  }
  peerColor(pid) {
    const ids = [this.net.id, ...this.peers.keys()].sort();
    return PEER_COLORS[Math.max(0, ids.indexOf(pid)) % PEER_COLORS.length];
  }

  // ── room lifecycle ──────────────────────────────────────────────────────────
  async host(code, phase, dungeon) {
    this.phase = phase;
    this.dungeon = dungeon;
    await this.net.joinRoom(code, true);
    this.send("hello", { name: this.me.name, skin: this.me.skin, v: V });
    this._updateRoomChip();
  }

  async join(code) {
    await this.net.joinRoom(code, null);
    this.send("hello", { name: this.me.name, skin: this.me.skin, v: V });
    this.g.hud.toast("Joining room " + code + "…", "info");
    // wait for a keyframe from the host
    const ok = await new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (this._gotKf) { clearInterval(iv); res(true); }
        else if (performance.now() - t0 > 6000) { clearInterval(iv); res(false); }
      }, 100);
    });
    return ok;
  }

  leave() {
    try { this.send("bye", {}); } catch (e) {}
    this.net.leave();
    if (this.g.session === this) this.g.session = null;
    this._updateRoomChip(true);
  }

  send(t, d) { this.net.send(t, d); }

  bindBuilder(b) { this.builder = b; this._updateRoomChip(); }
  bindEscape(e) { this.escape = e; this._updateRoomChip(); }

  _onPeers() {
    // presence change → host greets with a keyframe so late joiners sync
    if (this.isHost()) this._sendKeyframe();
    this.g.hud.toast(this.peers.size ? "" : "", "info");
  }

  _updateRoomChip(hide) {
    const chip = document.querySelector('[data-a="room"]');
    if (chip) {
      chip.style.display = hide || !this.net.room ? "none" : "";
      chip.textContent = "🌐 " + (this.net.room || "") + " · " + (this.peers.size + 1);
    }
  }

  _sendKeyframe() {
    if (this.phase === "build" && this.builder) {
      this.send("kf", { phase: "build", d: D.serialize(this.builder.d), roster: this.roster() });
    } else if (this.phase === "play" && this.escape) {
      const st = this.escape.run;
      this.send("kf", {
        phase: "play", d: D.serialize(this.escape.d), seed: st.runSeed, roster: this.rosterPlay(),
        world: {
          doors: [...st.openDoors], unlocked: [...st.unlockedDoors],
          chests: [...st.openedChests], taken: [...st.takenItems],
          enemies: st.enemies.map((e) => [e.id, +e.x.toFixed(1), +e.z.toFixed(1), Math.round(e.hp), e.alive ? 1 : 0]),
          time: +st.time.toFixed(2),
        },
      });
    } else if (this.phase === "lobby" && this.dungeon) {
      this.send("kf", { phase: "build", d: D.serialize(this.dungeon), roster: this.roster() });
    }
  }

  rosterPlay() {
    // players actually in the current run
    return this.escape ? this.escape.run.players.map((p) => ({ id: p.id, name: p.name, skin: p.skin })) : this.roster();
  }

  // ── build phase ─────────────────────────────────────────────────────────────
  sendOp(op) { if (this.phase === "build") this.send("op", { op }); }
  sendCursor(f, x, z) {
    const now = performance.now();
    if (now - this._tCur < 180) return;
    this._tCur = now;
    if (this.phase === "build") this.send("cur", { f, x, z });
  }

  hostStartPlaytest(dungeon) {
    // host launches a co-op run for the whole room from the builder
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const roster = this.roster();
    this.send("startPlay", { d: D.serialize(dungeon), seed, roster });
    this._startPlay(dungeon, seed, roster, "build");
  }
  hostStartPlay(dungeon) {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const roster = this.roster();
    this.send("startPlay", { d: D.serialize(dungeon), seed, roster });
    this._startPlay(dungeon, seed, roster, "menu");
  }

  _startPlay(dungeon, seed, roster, returnTo) {
    this.phase = "play";
    this.dungeon = dungeon;
    this.playSeed = seed;
    const d = D.sanitize(typeof dungeon === "string" ? dungeon : D.serialize(dungeon));
    const players = roster.map((r) => ({ id: r.id, name: r.name, skin: r.skin, remote: r.id !== this.net.id }));
    this.g.setMode("escape", {
      dungeon: d, session: this, returnTo: returnTo || "menu", runSeed: seed,
      players, myId: this.net.id,
      editDungeon: returnTo === "build" ? this.dungeon : null,
      scoreKey: null, cloudId: null,
    });
  }

  backToLobbyOrBuild() {
    // after a run: host returns the room to build (if a builder dungeon exists)
    if (this.isHost()) {
      this.phase = "build";
      this.send("backBuild", { d: D.serialize(this.dungeon) });
      this.g.setMode("build", { dungeon: D.sanitize(D.serialize(this.dungeon)) ? this.dungeon : this.dungeon, session: this });
    } else {
      this.g.hud.toast("Waiting for the host…", "info");
      // guests wait for backBuild / startPlay; if host gone, leave
      setTimeout(() => {
        if (this.phase === "play" && this.isHost()) this.backToLobbyOrBuild();
      }, 1500);
    }
  }

  // ── play phase ──────────────────────────────────────────────────────────────
  sendPlayerState(p) {
    const now = performance.now();
    if (now - this._tPst < 100) return;
    this._tPst = now;
    this.send("pst", {
      x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(2), f: p.f,
      hp: Math.round(p.hp), a: p.alive ? 1 : 0, esc: p.escaped ? 1 : 0,
      mv: Math.hypot(p.input.mx, p.input.mz) > 0.01 ? 1 : 0, sp: p.input.sprint ? 1 : 0,
      wt: p.weaponTier || 0, at: p.armorTier || 0,
    });
  }

  relayEvent(ev, myId) {
    if (this.phase !== "play") return;
    const MINE = ["door", "unlock", "chest", "keyTake", "swing", "bolt", "potion", "escape", "respawn"];
    const HOST = ["edied", "ehit", "eattack", "eshoot", "aggro", "phit", "pdied"];
    const t = ev.type;
    const isMine = MINE.includes(t) && (ev.by === myId || ev.id === myId);
    const meleeMine = (t === "ehit" || t === "edied") && ev.by === myId;
    const hostAuth = this.isHost() && HOST.includes(t) && !meleeMine;
    if (isMine || meleeMine || hostAuth) this.send("ev", { ev });
  }

  frame() {
    // host streams enemies at 7Hz during play
    if (this.phase === "play" && this.escape && this.isHost()) {
      const now = performance.now();
      if (now - this._tEn > 140) {
        this._tEn = now;
        const list = this.escape.packEnemies();
        if (list.length) this.send("en", { list });
      }
    }
  }

  // ── inbound ─────────────────────────────────────────────────────────────────
  onMsg(from, t, d) {
    if (t === "hello") {
      if (!this.peers.has(from)) {
        this.peers.set(from, { name: d.name, skin: d.skin });
        this.g.hud.toast("👋 " + d.name + " joined the room", "info");
        this.g.audio.sfx("confirm");
      }
      this._checkVersion(d.v, d.name);
      this._updateRoomChip();
      if (this.isHost()) {
        this._sendKeyframe();
        // mid-run drop-in: add them as a new player
        if (this.phase === "play" && this.escape && !this.escape.run.players.some((p) => p.id === from)) {
          const np = { id: from, name: d.name, skin: d.skin };
          this.send("pjoin", np);
          this._addRunPlayer(np);
        }
      }
      return;
    }
    if (t === "bye") {
      const p = this.peers.get(from);
      if (p) { this.g.hud.toast(p.name + " left", "warn"); this.peers.delete(from); }
      this._updateRoomChip();
      return;
    }
    if (t === "kf" && !this._gotKf) {
      this._gotKf = true;
      for (const r of d.roster || []) if (r.id !== this.net.id) this.peers.set(r.id, { name: r.name, skin: r.skin });
      if (d.phase === "build") {
        const dungeon = D.sanitize(d.d);
        if (dungeon) { this.phase = "build"; this.dungeon = dungeon; this.g.setMode("build", { dungeon, session: this }); }
      } else if (d.phase === "play") {
        const dungeon = D.sanitize(d.d);
        if (dungeon) {
          this.phase = "play";
          this.dungeon = dungeon;
          const roster = d.roster.some((r) => r.id === this.net.id) ? d.roster : [...d.roster, { id: this.net.id, name: this.me.name, skin: this.me.skin }];
          this._startPlay(dungeon, d.seed, roster, "menu");
          // apply world snapshot once the mode is up
          setTimeout(() => this._applySnapshot(d.world), 400);
        }
      }
      return;
    }
    if (t === "op") {
      if (this.builder) this.builder.applyRemoteOp(d.op);
      else if (this.dungeon) D.applyOp(this.dungeon, d.op);
      return;
    }
    if (t === "cur") {
      const p = this.peers.get(from);
      if (this.builder && p) this.builder.showPeerCursor(from, p.name, d.f, d.x, d.z, this.peerColor(from));
      return;
    }
    if (t === "startPlay") {
      const dungeon = D.sanitize(d.d);
      if (dungeon) this._startPlay(dungeon, d.seed, d.roster, this.builder ? "build" : "menu");
      return;
    }
    if (t === "backBuild") {
      const dungeon = D.sanitize(d.d);
      if (dungeon) {
        this.phase = "build";
        this.dungeon = dungeon;
        this.g.hud.closeModal();
        this.g.setMode("build", { dungeon, session: this });
      }
      return;
    }
    if (t === "pjoin") {
      this._addRunPlayer(d);
      return;
    }
    if (t === "pst") {
      if (this.escape) this.escape.netPlayerState(from, d);
      return;
    }
    if (t === "en") {
      if (this.escape && !this.isHost()) this.escape.netEnemies(d.list);
      return;
    }
    if (t === "ev") {
      if (this.escape) this.escape.netEvent(d.ev);
      return;
    }
  }

  _addRunPlayer(np) {
    if (!this.escape || this.escape.run.players.some((p) => p.id === np.id)) return;
    const E = this.escape;
    import("../sim/escape_sim.js" + V).then((sim) => {
      const p = sim.addPlayer(E.run, { id: np.id, name: np.name, skin: np.skin, remote: np.id !== this.net.id });
      E._makeActor(p);
      this.g.hud.toast("⚔ " + np.name + " joined the run!", "loot");
    });
  }

  _applySnapshot(w) {
    if (!w || !this.escape) return;
    const st = this.escape.run;
    for (const id of w.doors || []) { st.openDoors.add(id); this.escape._setDoorVisual(id, true); }
    for (const id of w.unlocked || []) {
      st.unlockedDoors.add(id);
      const dl = this.escape.doorLeafs.get(id);
      if (dl) { if (dl.bars) dl.bars.visible = false; if (dl.lock) dl.lock.visible = false; }
    }
    for (const id of w.chests || []) {
      st.openedChests.add(id);
      const m = this.escape.objMeshes.get(id);
      if (m && m.userData.lid) m.userData.lid.rotation.x = -0.6;
    }
    for (const id of w.taken || []) {
      st.takenItems.add(id);
      const m = this.escape.itemMeshes.get(id);
      if (m) m.visible = false;
    }
    for (const [id, x, z, hp, alive] of w.enemies || []) {
      const e = st.enemies.find((en) => en.id === id);
      if (!e) continue;
      e.x = x; e.z = z; e.hp = hp;
      if (!alive && e.alive) { e.alive = false; if (e.key) { e.droppedKey = e.key; e.key = null; } this.escape.enemies.onDeath({ id: e.id, x: e.x, z: e.z, f: e.f, key: e.droppedKey }); }
    }
    if (w.time) st.time = w.time;
  }
}
