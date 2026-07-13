/**
 * LuminaScape Together — co-op visiting over the shared FFG NetPlay relay
 * (Supabase Realtime Broadcast/Presence — same $0 transport as Dungeon Forge's
 * forgenet). Reads game internals ONLY through the window.__LS__ bridge.
 *
 * What v1 gives you:
 *  • HOST your world with a 8-char room code, or JOIN a friend's code,
 *    or QUICK MATCH with a stranger from the lobby.
 *  • The host streams a full world keyframe (gzip + chunked) to every joiner —
 *    guests literally walk around the host's world.
 *  • Everyone sees everyone in real time: Play-mode explorers appear as the
 *    helmet character with a name tag; builders appear as a drifting firefly
 *    at their camera focus. Positions sync at 10 Hz, host world re-syncs when
 *    the host edits (debounced).
 *  • Guest edits are LOCAL ONLY in v1 (clearly toasted) — the visited world
 *    belongs to the host; your own worlds are untouched and restored on Leave.
 */

const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

const VISIT_KEY = "ls_coop_visit";
const NAMES = ["Fern", "Moss", "Wren", "Brook", "Sage", "Ivy", "Reed", "Dew", "Cedar", "Lark"];
const PEER_TINTS = [0x6ee7b7, 0xfbbf24, 0x93c5fd, 0xf0abfc, 0xfda4af, 0x67e8f9];

const LS = () => window.__LS__;

/* ── tiny helpers ─────────────────────────────────────────────────────── */
const b64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => {
  const bin = atob(s), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

async function packWorld(str) {
  let bytes = new TextEncoder().encode(str), gz = 0;
  if ("CompressionStream" in window) {
    try {
      const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
      bytes = new Uint8Array(await new Response(cs).arrayBuffer());
      gz = 1;
    } catch (e) { gz = 0; bytes = new TextEncoder().encode(str); }
  }
  const parts = [];
  const b = b64(bytes);
  for (let i = 0; i < b.length; i += 60000) parts.push(b.slice(i, i + 60000));
  return { gz, parts, bytes: bytes.length };
}

async function unpackWorld(partsJoined, gz) {
  const bytes = unb64(partsJoined);
  if (!gz) return new TextDecoder().decode(bytes);
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(ds).text();
}

/* ── remote peer visuals ──────────────────────────────────────────────── */
function makeNameTag(THREE, name, tint) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.font = "700 34px Trebuchet MS, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "rgba(8,20,14,0.7)";
  const w = Math.min(240, g.measureText(name).width + 36);
  g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 22); g.fill();
  g.fillStyle = "#" + tint.toString(16).padStart(6, "0");
  g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(3.2, 0.8, 1);
  return spr;
}

class RemotePeer {
  constructor(session, id, name) {
    this.s = session; this.id = id;
    this.name = name || "Traveler";
    this.tint = PEER_TINTS[session.tintIdx++ % PEER_TINTS.length];
    this.mode = "build";
    this.cur = null;            // {x,y,z,yaw}
    this.tgt = null;
    this.avatar = null;         // helmet char (play mode)
    this.orb = null;            // firefly (build mode)
    this.label = null;
  }
  _ensureAvatar() {
    if (this.avatar) return;
    const THREE = LS().THREE;
    try {
      this.avatar = LS().makePlayer();
      this.avatar.visible = true;
      this.label = makeNameTag(THREE, this.name, this.tint);
      const bb = new THREE.Box3().setFromObject(this.avatar);
      this._foot = -bb.min.y;
      this.label.position.y = (bb.max.y - bb.min.y) + 0.9;
      this.avatar.add(this.label);
      // peer-tint ring at the feet so travelers are tellable apart
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.75, 28),
        new THREE.MeshBasicMaterial({ color: this.tint, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08;
      this.avatar.add(ring);
      LS().scene.add(this.avatar);
    } catch (e) { console.warn("[lumina-net] avatar", e); }
  }
  _ensureOrb() {
    if (this.orb) return;
    const THREE = LS().THREE;
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12),
      new THREE.MeshBasicMaterial({ color: this.tint }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 12),
      new THREE.MeshBasicMaterial({ color: this.tint, transparent: true, opacity: 0.25, depthWrite: false }));
    g.add(core, halo);
    this.orbLabel = makeNameTag(THREE, this.name + " ✦ building", this.tint);
    this.orbLabel.position.y = 1.5;
    g.add(this.orbLabel);
    this.orb = g;
    LS().scene.add(g);
  }
  setName(n) {
    if (!n || n === this.name) return;
    this.name = n;
    // rebuild tags lazily next mode switch
    if (this.label && this.avatar) { this.avatar.remove(this.label); this.label = null; const THREE = LS().THREE; this.label = makeNameTag(THREE, n, this.tint); const bb = new THREE.Box3().setFromObject(this.avatar); this.label.position.y = (bb.max.y - bb.min.y) + 0.9; this.avatar.add(this.label); }
  }
  onState(d) {
    this.mode = d.m || "play";
    this.tgt = { x: d.x, y: d.y, z: d.z, yaw: d.yaw || 0 };
    if (!this.cur) this.cur = { ...this.tgt };
    this.walking = !!d.w;
  }
  update(dt, t) {
    if (!this.tgt || !this.cur) return;
    const k = 1 - Math.exp(-10 * dt);
    this.cur.x += (this.tgt.x - this.cur.x) * k;
    this.cur.y += (this.tgt.y - this.cur.y) * k;
    this.cur.z += (this.tgt.z - this.cur.z) * k;
    let dy = (this.tgt.yaw - (this.cur.yaw || 0));
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.cur.yaw = (this.cur.yaw || 0) + dy * k;
    if (this.mode === "play") {
      if (this.orb) this.orb.visible = false;
      this._ensureAvatar();
      if (this.avatar) {
        this.avatar.visible = true;
        this.avatar.position.set(this.cur.x, this.cur.y, this.cur.z);
        this.avatar.rotation.y = this.cur.yaw;
      }
    } else {
      if (this.avatar) this.avatar.visible = false;
      this._ensureOrb();
      this.orb.visible = true;
      // firefly bobs above the builder's camera focus
      this.orb.position.set(this.cur.x, this.cur.y + 3.2 + Math.sin(t * 2.2) * 0.35, this.cur.z);
    }
  }
  dispose() {
    try { if (this.avatar) LS().scene.remove(this.avatar); } catch (e) {}
    try { if (this.orb) LS().scene.remove(this.orb); } catch (e) {}
    this.avatar = this.orb = null;
  }
}

/* ── session ──────────────────────────────────────────────────────────── */
class Session {
  constructor() {
    this.net = null;
    this.peers = new Map();
    this.tintIdx = 0;
    this.myName = localStorage.getItem("ls_coop_name") ||
      NAMES[(Math.random() * NAMES.length) | 0] + "-" + ((Math.random() * 90 + 10) | 0);
    this.active = false;
    this.hosting = false;      // "I own the world being visited"
    this.origKey = null;       // guest: my own world key to restore on leave
    this._kfBuf = null;
    this._kfSending = false;
    this._lastKfAt = 0;
    this._warnedLocalEdit = false;
    this._iv = [];
  }

  isHost() {
    if (!this.net) return false;
    const ids = [this.net.id, ...this.peers.keys()].sort();
    return ids[0] === this.net.id;
  }

  async _mkNet() {
    const { NetPlay } = await import("./ffg_netplay.js");
    this.net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, "luminascape");
    this.net.on("msg", (m) => { try { this._onMsg(m.from, m.t, m.d); } catch (e) { console.error("[lumina-net]", e); } });
    this.net.on("peer", (p) => this._onPeerCount(p));
    return this.net;
  }

  async host() {
    await this._mkNet();
    const code = Math.random().toString(36).slice(2, 6).toUpperCase() +
                 Math.random().toString(36).slice(2, 6).toUpperCase();
    await this.net.joinRoom(code, true);
    this.active = true;
    this.hosting = true;
    this._begin();
    return this.net.room;
  }

  async join(code) {
    if (!code || code.trim().length < 4) return null;
    await this._mkNet();
    this.origKey = LS().activeKey();
    await this.net.joinRoom(code.trim().toUpperCase(), false);
    this.active = true;
    this.hosting = false;
    this._begin();
    this._say("hello", { name: this.myName, wantWorld: 1 });
    return this.net.room;
  }

  async quickMatch() {
    await this._mkNet();
    this.origKey = LS().activeKey();
    const res = await this.net.quickMatch(20000);
    if (!res) { try { this.net.leave(); } catch (e) {} this.net = null; return null; }
    this.active = true;
    this.hosting = !!res.host;          // lower id hosts their world
    if (!this.hosting) { /* keep origKey for restore */ } else { this.origKey = null; }
    this._begin();
    this._say("hello", { name: this.myName, wantWorld: this.hosting ? 0 : 1 });
    return res.room;
  }

  _say(t, d) { try { this.net?.send(t, d); } catch (e) {} }

  _begin() {
    // presence/state pump — 10 Hz out, 30 Hz interp in
    this._iv.push(setInterval(() => this._sendState(), 100));
    let last = performance.now();
    this._iv.push(setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const p of this.peers.values()) p.update(dt, now / 1000);
    }, 33));
    // host: re-sync world when it changed (debounced ≥8s)
    this._iv.push(setInterval(() => {
      if (!this.active || !this.isHost() || !this.hosting) return;
      if (LS().dirty && Date.now() - this._lastKfAt > 8000 && this.peers.size) this.sendKeyframe();
    }, 4000));
    // guest local-edit warning (v1: visitor edits don't sync)
    this._iv.push(setInterval(() => {
      if (!this.active || this.hosting || this._warnedLocalEdit) return;
      if (LS().dirty) { this._warnedLocalEdit = true; LS().toast("✏ Visitor mode — your edits stay on YOUR copy only"); }
    }, 2500));
    this._say("hello", { name: this.myName });
  }

  _onPeerCount(p) {
    ui.setPeers(this.peers.size + 1, this.net?.room);
    // prune ghosts: presence count dropped → drop peers not re-hello'ing soon
    if (!p.present && this.peers.size) {
      for (const [id, peer] of this.peers) { peer.dispose(); this.peers.delete(id); }
      ui.setPeers(1, this.net?.room);
      LS().toast("🌙 Your co-explorer left");
    }
    // re-announce so late joiners learn us
    this._say("hello", { name: this.myName });
  }

  _peer(id, name) {
    let p = this.peers.get(id);
    if (!p) { p = new RemotePeer(this, id, name); this.peers.set(id, p); ui.setPeers(this.peers.size + 1, this.net?.room); }
    if (name) p.setName(name);
    return p;
  }

  _onMsg(from, t, d) {
    if (t === "hello") {
      const isNew = !this.peers.has(from);
      this._peer(from, d?.name);
      if (isNew) LS().toast("🌱 " + (d?.name || "A traveler") + " is here");
      if (this.isHost() && this.hosting && (isNew || d?.wantWorld)) this.sendKeyframe();
      return;
    }
    if (t === "st") { this._peer(from).onState(d); return; }
    if (t === "kf0") { this._kfBuf = { gz: d.gz, n: d.n, got: 0, parts: new Array(d.n) }; return; }
    if (t === "kfp") {
      if (!this._kfBuf || this.hosting) return;
      if (this._kfBuf.parts[d.i] == null) { this._kfBuf.parts[d.i] = d.d; this._kfBuf.got++; }
      ui.status("Receiving world… " + Math.round((this._kfBuf.got / this._kfBuf.n) * 100) + "%");
      return;
    }
    if (t === "kfz") { this._applyKeyframe(); return; }
  }

  async sendKeyframe() {
    if (this._kfSending) return;
    this._kfSending = true;
    try {
      ui.status("Sending world…");
      await LS().saveWorld();
      let blob = null;
      try { blob = await LS().idbGet(LS().activeKey()); } catch (e) {}
      if (!blob) { try { blob = localStorage.getItem(LS().activeKey()); } catch (e) {} }
      if (!blob) { ui.status("Nothing to send yet — save your world once"); return; }
      const { gz, parts, bytes } = await packWorld(blob);
      this._say("kf0", { gz, n: parts.length, bytes });
      for (let i = 0; i < parts.length; i++) {
        this._say("kfp", { i, d: parts[i] });
        await new Promise((r) => setTimeout(r, 60)); // stay under relay rate limits
      }
      this._say("kfz", {});
      this._lastKfAt = Date.now();
      ui.status("World shared ✓");
    } catch (e) {
      console.error("[lumina-net] keyframe", e);
      ui.status("World share failed — see console");
    } finally { this._kfSending = false; }
  }

  async _applyKeyframe() {
    const buf = this._kfBuf;
    this._kfBuf = null;
    if (!buf || buf.got !== buf.n) { ui.status("World transfer incomplete — ask the host to resend"); return; }
    try {
      ui.status("Growing the host's world…");
      const json = await unpackWorld(buf.parts.join(""), buf.gz);
      await LS().idbSet(VISIT_KEY, json);
      try { localStorage.setItem("ls_active", VISIT_KEY); } catch (e) {}
      const ok = await LS().loadWorld();
      if (ok) {
        LS().enterPlay();
        LS().toast("🌍 Welcome to your host's world — explore!");
        ui.status("In the host's world ✓");
      } else ui.status("World apply failed");
    } catch (e) {
      console.error("[lumina-net] apply", e);
      ui.status("World apply failed — see console");
    }
  }

  _sendState() {
    if (!this.active || !this.net) return;
    const L = LS();
    try {
      if (L.playMode && L.player) {
        const p = L.player.position;
        this._say("st", { m: "play", x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +(+L.playerYaw || 0).toFixed(3), w: 1 });
      } else if (L.camTgt) {
        const c = L.camTgt;
        this._say("st", { m: "build", x: +c.x.toFixed(1), y: +(L.getHeight(c.x, c.z) || 0).toFixed(1), z: +c.z.toFixed(1), yaw: 0, w: 0 });
      }
    } catch (e) {}
  }

  async leave() {
    this.active = false;
    for (const iv of this._iv) clearInterval(iv);
    this._iv = [];
    for (const [, p] of this.peers) p.dispose();
    this.peers.clear();
    try { this.net?.leave(); } catch (e) {}
    this.net = null;
    // guest: restore own world
    if (!this.hosting && this.origKey) {
      try { localStorage.setItem("ls_active", this.origKey); } catch (e) {}
      try { await LS().loadWorld(); LS().toast("🏡 Back in your own world"); } catch (e) {}
    }
    this.hosting = false;
    this.origKey = null;
    ui.reset();
  }
}

/* ── UI ───────────────────────────────────────────────────────────────── */
const ui = {
  el: null, panel: null, statusEl: null, codeEl: null, peersEl: null,
  build() {
    const css = document.createElement("style");
    css.textContent = `
      #lsnet-btn{position:fixed;left:12px;top:52px;z-index:60;font:700 13px Trebuchet MS,sans-serif;
        background:linear-gradient(160deg,rgba(10,30,20,.92),rgba(6,18,12,.94));color:#bff5d8;border:1px solid rgba(110,231,183,.5);
        border-radius:999px;padding:10px 16px;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.35)}
      #lsnet-btn:hover{border-color:#6ee7b7;box-shadow:0 0 18px rgba(110,231,183,.35)}
      #lsnet{position:fixed;left:12px;top:96px;z-index:61;width:270px;max-width:86vw;font:14px Trebuchet MS,sans-serif;color:#dcfce7;
        background:linear-gradient(165deg,rgba(9,26,17,.96),rgba(5,14,9,.97));border:1px solid rgba(110,231,183,.45);
        border-radius:16px;padding:14px;display:none;box-shadow:0 14px 44px rgba(0,0,0,.5)}
      #lsnet h3{margin:0 0 8px;font-size:15px;color:#6ee7b7;letter-spacing:.04em}
      #lsnet .row{display:flex;gap:6px;margin:6px 0}
      #lsnet button{flex:1;font:700 12.5px Trebuchet MS,sans-serif;background:rgba(110,231,183,.12);color:#bff5d8;
        border:1px solid rgba(110,231,183,.4);border-radius:10px;padding:8px 6px;cursor:pointer}
      #lsnet button:hover{background:rgba(110,231,183,.22)}
      #lsnet input{flex:1;min-width:0;background:rgba(0,0,0,.35);border:1px solid rgba(110,231,183,.3);border-radius:10px;
        color:#eafff3;padding:8px;font:13px Trebuchet MS,sans-serif;letter-spacing:.08em}
      #lsnet .code{font:800 22px/1.2 Consolas,monospace;color:#fbbf24;text-align:center;letter-spacing:.18em;margin:6px 0}
      #lsnet .st{font-size:12px;color:#86efac;opacity:.85;min-height:16px;margin-top:6px}
      #lsnet .peers{font-size:12px;color:#a7f3d0;margin-top:2px}
      #lsnet .note{font-size:11px;color:#86efac;opacity:.6;margin-top:8px;line-height:1.35}`;
    document.head.appendChild(css);

    const btn = document.createElement("button");
    btn.id = "lsnet-btn";
    btn.textContent = "🌐 Together";
    btn.onclick = () => { this.panel.style.display = this.panel.style.display === "block" ? "none" : "block"; };
    document.body.appendChild(btn);

    const p = document.createElement("div");
    p.id = "lsnet";
    p.innerHTML = `
      <h3>Play Together</h3>
      <div class="row"><input id="lsnet-name" maxlength="14" title="Your traveler name"/></div>
      <div class="row"><button id="lsnet-host">Host World</button><button id="lsnet-qm">Quick Match</button></div>
      <div class="row"><input id="lsnet-code" placeholder="ROOM CODE" maxlength="8"/><button id="lsnet-join" style="flex:0 0 64px">Join</button></div>
      <div class="code" id="lsnet-roomcode"></div>
      <div class="peers" id="lsnet-peers"></div>
      <div class="st" id="lsnet-status"></div>
      <div class="row" style="display:none" id="lsnet-leaverow"><button id="lsnet-leave">Leave Session</button></div>
      <div class="note">Host streams their world to visitors. Visitors explore + are seen live; visitor edits stay local (v1).</div>`;
    document.body.appendChild(p);
    this.panel = p;
    this.statusEl = p.querySelector("#lsnet-status");
    this.codeEl = p.querySelector("#lsnet-roomcode");
    this.peersEl = p.querySelector("#lsnet-peers");

    const nameIn = p.querySelector("#lsnet-name");
    nameIn.value = session.myName;
    nameIn.onchange = () => { session.myName = nameIn.value.trim() || session.myName; localStorage.setItem("ls_coop_name", session.myName); };

    p.querySelector("#lsnet-host").onclick = async () => {
      if (session.active) return;
      this.status("Opening room…");
      try { const code = await session.host(); this.codeEl.textContent = code; this.status("Share the code — friends join instantly"); this.showLeave(); }
      catch (e) { console.error(e); this.status("Couldn't open a room — check connection"); }
    };
    p.querySelector("#lsnet-join").onclick = async () => {
      if (session.active) return;
      const code = p.querySelector("#lsnet-code").value;
      if (!code || code.trim().length < 4) { this.status("Enter the room code first"); return; }
      this.status("Joining…");
      try { const r = await session.join(code); this.codeEl.textContent = r; this.status("Joined — receiving world…"); this.showLeave(); }
      catch (e) { console.error(e); this.status("Join failed — check the code"); }
    };
    p.querySelector("#lsnet-qm").onclick = async () => {
      if (session.active) return;
      this.status("Looking for a traveler… (20s)");
      try {
        const r = await session.quickMatch();
        if (!r) { this.status("No traveler right now — Host and share your code!"); return; }
        this.codeEl.textContent = r;
        this.status(session.hosting ? "Matched! Sharing your world…" : "Matched! Receiving their world…");
        this.showLeave();
      } catch (e) { console.error(e); this.status("Quick match failed — try again"); }
    };
    p.querySelector("#lsnet-leave").onclick = () => session.leave();
  },
  showLeave() { this.panel.querySelector("#lsnet-leaverow").style.display = "flex"; },
  status(s) { if (this.statusEl) this.statusEl.textContent = s; },
  setPeers(n, room) {
    if (this.peersEl) this.peersEl.textContent = n > 1 ? `✦ ${n} travelers in this world` : "";
    if (room && this.codeEl) this.codeEl.textContent = room;
  },
  reset() {
    if (this.codeEl) this.codeEl.textContent = "";
    if (this.peersEl) this.peersEl.textContent = "";
    this.status("Left the session");
    const lr = this.panel?.querySelector("#lsnet-leaverow");
    if (lr) lr.style.display = "none";
  },
};

/* ── boot (never break single-player) ─────────────────────────────────── */
const session = new Session();
window.__LUMINA_NET__ = { session, ui };

(function waitReady(tries) {
  try {
    if (window.__LS__ && document.body) { ui.build(); return; }
  } catch (e) { console.warn("[lumina-net] init", e); return; }
  if (tries > 120) return; // give up quietly — game still fully playable solo
  setTimeout(() => waitReady(tries + 1), 500);
})(0);
