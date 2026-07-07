/**
 * Dungeon Forge — runtime/3d/menu.js
 * Main menu + meta-game glue: profile (name/skin), My Dungeons (localStorage),
 * featured sample dungeons, share dialog (URL code + cloud publish),
 * leaderboard reporting, and the multiplayer lobby (create/join room for
 * co-building and co-op escapes).
 */
const V = new URL(import.meta.url).search;
const D = await import("../sim/dungeon.js" + V);
const { Cloud } = await import("../net/cloud.js" + V);
const { Session } = await import("../net/forgenet.js" + V);
const { fmtTime } = await import("./escape.js" + V);

const LS = "df_";

export class Menu {
  constructor(game) {
    this.g = game;
    this.cloud = new Cloud();
    this.root = null;
    this._checkedHash = false;
  }

  profile() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(LS + "profile")); } catch (e) {}
    if (!p) p = { name: "Forger" + Math.floor(Math.random() * 900 + 100), skin: Math.floor(Math.random() * 4) };
    return p;
  }
  saveProfile(p) { localStorage.setItem(LS + "profile", JSON.stringify(p)); }

  myDungeons() {
    try { return JSON.parse(localStorage.getItem(LS + "dungeons")) || []; } catch (e) { return []; }
  }
  saveDungeon(d) {
    const list = this.myDungeons();
    const json = D.serialize(d);
    const i = list.findIndex((x) => x.name === d.name);
    const entry = { name: d.name, theme: d.theme, difficulty: d.difficulty, json, savedAt: Date.now(), cloudId: (i >= 0 && list[i].cloudId) || null };
    if (i >= 0) list[i] = entry; else list.unshift(entry);
    localStorage.setItem(LS + "dungeons", JSON.stringify(list.slice(0, 40)));
  }
  bestTimes() { try { return JSON.parse(localStorage.getItem(LS + "best")) || {}; } catch (e) { return {}; } }
  saveBest(key, t) {
    const b = this.bestTimes();
    if (b[key] == null || t < b[key]) { b[key] = t; localStorage.setItem(LS + "best", JSON.stringify(b)); return true; }
    return false;
  }

  // ── show/hide ───────────────────────────────────────────────────────────────
  show(payload) {
    this.hide();
    const prof = this.profile();
    this.root = el(`<div class="dfm">
      <div class="dfm-bg"></div>
      <div class="dfm-bgshade"></div>
      <div class="dfm-card">
        <div class="dfm-title">DUNGEON<span> FORGE</span></div>
        <div class="dfm-tag">Build dungeons with friends. Then try to escape them.</div>
        <div class="dfm-btns">
          <button class="dfm-big" data-a="build">⚒️ &nbsp;BUILD A DUNGEON</button>
          <button class="dfm-big alt" data-a="play">▶ &nbsp;PLAY &amp; ESCAPE</button>
          <button class="dfm-big online" data-a="online">🌐 &nbsp;PLAY WITH FRIENDS</button>
        </div>
        <div class="dfm-profile">
          <input data-a="name" maxlength="14" value="${esc(prof.name)}" title="Your name">
          <button class="dfm-skin" data-a="gear" title="Settings">⚙️</button>
        </div>
        <div class="dfm-classhead">CHOOSE YOUR CLASS</div>
        <div class="dfm-classes">${[
          { i: 0, ic: "🛡️", n: "Knight", d: "Sword & shield · block + shield bash" },
          { i: 1, ic: "🪓", n: "Barbarian", d: "Two-handed axe · heavy crushing combos" },
          { i: 2, ic: "🔮", n: "Sorceress", d: "Fire & frost bolts · burn / slow" },
          { i: 3, ic: "🗡️", n: "Rogue", d: "Dual daggers · fast, stacking poison" },
        ].map((c) => `<button class="dfm-class ${c.i === prof.skin ? "on" : ""}" data-skin="${c.i}">
          <span class="ci">${c.ic}</span><span class="cn">${c.n}</span><span class="cd">${c.d}</span></button>`).join("")}</div>
        <div class="dfm-foot">
          <button data-a="how" class="dfm-link">How to play</button> ·
          <button data-a="credits" class="dfm-link">Credits</button>
        </div>
      </div>
    </div>`);
    this.g.container.appendChild(this.root);
    const q = (s) => this.root.querySelector(s);
    q('[data-a="name"]').onchange = (e) => { const p = this.profile(); p.name = e.target.value.slice(0, 14) || p.name; this.saveProfile(p); };
    this.root.querySelectorAll(".dfm-class").forEach((b) => b.onclick = () => {
      const p = this.profile(); p.skin = +b.dataset.skin; this.saveProfile(p);
      this.root.querySelectorAll(".dfm-class").forEach((x) => x.classList.toggle("on", x === b));
      this.g.audio.sfx("ui");
    });
    q('[data-a="build"]').onclick = () => { this.g.audio.sfx("confirm"); this.buildFlow(); };
    q('[data-a="play"]').onclick = () => { this.g.audio.sfx("confirm"); this.playFlow(); };
    q('[data-a="online"]').onclick = () => { this.g.audio.sfx("confirm"); this.onlineFlow(); };
    q('[data-a="how"]').onclick = () => this.howTo();
    q('[data-a="credits"]').onclick = () => this.credits();
    q('[data-a="gear"]').onclick = () => { this.g.audio.sfx("ui"); this.g.showSettings(); };

    if (payload && payload.toast) this.g.hud.toast(payload.toast, "info");
    // share links: #d=DF1....
    if (!this._checkedHash) { this._checkedHash = true; this._checkHash(); }
  }
  hide() { if (this.root) { this.root.remove(); this.root = null; } this.g.hud.closeModal(); }
  update() {}

  async _checkHash() {
    const m = location.hash.match(/#d=(DF1\.[A-Za-z0-9_-]+)/);
    if (!m) return;
    const d = await D.decodeShare(m[1]);
    history.replaceState(null, "", location.pathname + location.search);
    if (d) {
      this.g.hud.modal(`<h3>Shared dungeon</h3>
        <div class="df-lb">「<b>${esc(d.name)}</b>」 by ${esc(d.author)} · ${d.theme === "scifi" ? "🤖 sci-fi" : "🏰 fantasy"} · ${d.floors.length} floor(s)</div>
        <div class="df-selrow">
          <button data-a="p" class="df-btn accent">▶ Play it</button>
          <button data-a="e" class="df-btn">⚒ Open in builder</button>
        </div>`, (mm) => {
        mm.querySelector('[data-a="p"]').onclick = () => { this.g.hud.closeModal(); this.startEscape(d, "menu"); };
        mm.querySelector('[data-a="e"]').onclick = () => { this.g.hud.closeModal(); this.g.setMode("build", { dungeon: d }); };
      });
    }
  }

  // ── flows ───────────────────────────────────────────────────────────────────
  buildFlow() {
    const mine = this.myDungeons();
    const rows = mine.map((m, i) => `
      <div class="dfm-row">
        <span>${m.theme === "scifi" ? "🤖" : "🏰"} <b>${esc(m.name)}</b></span>
        <span class="dfm-rowbtns">
          <button data-edit="${i}" class="df-btn">⚒ Edit</button>
          <button data-del="${i}" class="df-btn danger">🗑</button>
        </span>
      </div>`).join("");
    this.g.hud.modal(`<h3>⚒️ Build</h3>
      <div class="df-selrow" style="margin-bottom:14px">
        <button data-a="newf" class="df-btn accent" style="flex:1">＋ New 🏰 Fantasy</button>
        <button data-a="news" class="df-btn accent" style="flex:1">＋ New 🤖 Sci-Fi</button>
      </div>
      ${mine.length ? `<div class="dfm-listhead">MY DUNGEONS</div>${rows}` : `<div class="df-lb">No saved dungeons yet — forge your first!</div>`}
      <div class="df-selrow"><input data-a="code" placeholder="paste a share code (DF1.…)" style="flex:1" class="df-name"><button data-a="imp" class="df-btn">Import</button></div>`,
      (m) => {
        m.querySelector('[data-a="newf"]').onclick = () => { this.g.hud.closeModal(); this.g.setMode("build", { dungeon: D.starterDungeon("fantasy") }); };
        m.querySelector('[data-a="news"]').onclick = () => { this.g.hud.closeModal(); this.g.setMode("build", { dungeon: D.starterDungeon("scifi") }); };
        m.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
          const d = D.sanitize(mine[+b.dataset.edit].json);
          if (d) { this.g.hud.closeModal(); this.g.setMode("build", { dungeon: d }); }
        });
        m.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
          mine.splice(+b.dataset.del, 1);
          localStorage.setItem(LS + "dungeons", JSON.stringify(mine));
          this.g.hud.closeModal(); this.buildFlow();
        });
        m.querySelector('[data-a="imp"]').onclick = async () => {
          const code = m.querySelector('[data-a="code"]').value.trim();
          const d = code.startsWith("DF1.") ? await D.decodeShare(code) : await this.cloud.fetchDungeon(code);
          if (d) { this.g.hud.closeModal(); this.g.setMode("build", { dungeon: d }); }
          else this.g.hud.toast("Couldn't read that code", "warn");
        };
      });
  }

  playFlow() {
    const mine = this.myDungeons();
    const best = this.bestTimes();
    const row = (label, meta, best_, attrs) => `
      <div class="dfm-row">
        <span>${label}<br><span class="dim">${meta}${best_ != null ? ` · best ${fmtTime(best_)}` : ""}</span></span>
        <span class="dfm-rowbtns"><button ${attrs} class="df-btn accent">▶ Play</button></span>
      </div>`;
    const rows = mine.map((m, i) => row(
      `${m.theme === "scifi" ? "🤖" : "🏰"} <b>${esc(m.name)}</b>`,
      `${m.theme} · diff ${m.difficulty}`, best["local:" + m.name], `data-play="${i}"`)).join("");
    this.g.hud.modal(`<h3>▶ Escape a dungeon</h3>
      <div class="dfm-listhead">FEATURED</div>
      ${row("🏰 <b>The Forge Trials</b>", "fantasy · 2 floors · locked doors", best["sample:fantasy"], 'data-s="fantasy"')}
      ${row("🤖 <b>Meltdown Facility</b>", "sci-fi · 2 floors · turrets", best["sample:scifi"], 'data-s="scifi"')}
      ${mine.length ? `<div class="dfm-listhead">MY DUNGEONS</div>${rows}` : ""}
      <div class="df-selrow" style="margin-top:8px"><input data-a="code" placeholder="dungeon code (from a friend)" style="flex:1" class="df-name"><button data-a="go" class="df-btn">Load</button></div>`,
      (m) => {
        m.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => { this.g.hud.closeModal(); this.startEscape(sampleDungeon(b.dataset.s), "menu", "sample:" + b.dataset.s); });
        m.querySelectorAll("[data-play]").forEach((b) => b.onclick = () => {
          const entry = mine[+b.dataset.play];
          const d = D.sanitize(entry.json);
          if (!d) return;
          const v = D.validate(d);
          if (!v.ok) { this.g.hud.toast("This dungeon isn't playable: " + v.problems[0].msg, "warn"); return; }
          this.g.hud.closeModal();
          this.startEscape(d, "menu", entry.cloudId ? "cloud:" + entry.cloudId : "local:" + d.name, entry.cloudId);
        });
        m.querySelector('[data-a="go"]').onclick = async () => {
          const code = m.querySelector('[data-a="code"]').value.trim();
          const d = code.startsWith("DF1.") ? await D.decodeShare(code) : await this.cloud.fetchDungeon(code);
          if (d) { this.g.hud.closeModal(); this.startEscape(d, "menu", code.startsWith("DF1.") ? null : "cloud:" + code.toUpperCase(), code.startsWith("DF1.") ? null : code.toUpperCase()); }
          else this.g.hud.toast("Couldn't load that code", "warn");
        };
      });
  }

  startEscape(d, returnTo, scoreKey, cloudId) {
    const v = D.validate(d);
    if (!v.ok) { this.g.hud.toast("Unplayable dungeon: " + v.problems[0].msg, "warn"); return; }
    const prof = this.profile();
    this.g.setMode("escape", {
      dungeon: d, returnTo, scoreKey: scoreKey || null, cloudId: cloudId || null,
      playerName: prof.name, skin: prof.skin,
    });
  }

  testPlay(d) {
    const v = D.validate(d);
    if (!v.ok) { this.g.hud.showValidate(v); return; }
    this.saveDungeon(d);
    if (this.g.session && this.g.session.phase === "build") {
      this.g.session.hostStartPlaytest(d);
      return;
    }
    const prof = this.profile();
    this.g.setMode("escape", { dungeon: D.sanitize(D.serialize(d)), returnTo: "build", editDungeon: d, playerName: prof.name, skin: prof.skin });
  }

  replayRun(escMode) {
    const o = escMode.opts;
    this.g.setMode("escape", Object.assign({}, o, { dungeon: escMode.d, runSeed: ((Math.random() * 0xffffffff) >>> 0) }));
  }
  afterRun(escMode) {
    if (this.g.session) { this.g.session.backToLobbyOrBuild(); return; }
    if (escMode.returnTo === "build" && escMode.opts.editDungeon) this.g.setMode("build", { dungeon: escMode.opts.editDungeon });
    else this.g.setMode("menu");
  }
  confirmQuitRun() {
    this.g.hud.modal(`<h3>Leave the run?</h3><div class="df-selrow">
      <button data-a="y" class="df-btn danger">Leave</button><button data-a="n" class="df-btn accent">Keep playing</button></div>`, (m) => {
      m.querySelector('[data-a="y"]').onclick = () => { this.g.hud.closeModal(); this.afterRun(this.g.escape); };
      m.querySelector('[data-a="n"]').onclick = () => this.g.hud.closeModal();
    });
  }

  /** Esc during a run → standard pause menu (resume / settings / quit). */
  pauseOverlay(escMode) {
    this.g.hud.modal(`<h3>⏸ Paused</h3>
      <div class="df-lb">The dungeon waits for no one — enemies keep prowling${this.g.session ? " (multiplayer keeps running)" : ""}.</div>
      <div class="df-selrow" style="flex-direction:column;gap:8px">
        <button data-a="resume" class="df-btn accent">▶ Resume</button>
        <button data-a="set" class="df-btn">⚙ Settings</button>
        <button data-a="quit" class="df-btn danger">Leave run</button>
      </div>`, (m) => {
      m.querySelector('[data-a="resume"]').onclick = () => {
        this.g.hud.closeModal();
        this.g.renderer.domElement.requestPointerLock();
      };
      m.querySelector('[data-a="set"]').onclick = () => this.g.showSettings(() => this.pauseOverlay(escMode));
      m.querySelector('[data-a="quit"]').onclick = () => { this.g.hud.closeModal(); this.afterRun(escMode); };
    });
  }
  confirmLeaveBuilder() {
    const b = this.g.builder;
    this.saveDungeon(b.d);
    if (this.g.session) {
      this.g.hud.modal(`<h3>Leave the co-build room?</h3><div class="df-selrow">
        <button data-a="y" class="df-btn danger">Leave room</button><button data-a="n" class="df-btn accent">Stay</button></div>`, (m) => {
        m.querySelector('[data-a="y"]').onclick = () => { this.g.hud.closeModal(); this.leaveSession(); this.g.setMode("menu"); };
        m.querySelector('[data-a="n"]').onclick = () => this.g.hud.closeModal();
      });
      return;
    }
    this.g.setMode("menu", { toast: "Dungeon saved 💾" });
  }

  async reportScore(escMode, res, elLb) {
    const me = escMode.me();
    const t = res.time;
    const key = escMode.opts.scoreKey;
    let html = "";
    if (key) {
      const isNew = this.saveBest(key, t);
      if (isNew) html += `🏅 <b>New personal best!</b><br>`;
      else html += `Personal best: <b>${fmtTime(this.bestTimes()[key])}</b><br>`;
    }
    if (elLb) elLb.innerHTML = html || "…";
    // cloud leaderboard
    if (escMode.opts.cloudId) {
      const prof = this.profile();
      await this.cloud.submitScore(escMode.opts.cloudId, prof.name, Math.round(t * 1000), me ? me.deaths : 0);
      const rows = await this.cloud.topScores(escMode.opts.cloudId, 5);
      if (rows && rows.length && elLb) {
        html += `<div class="dfm-listhead" style="margin-top:8px">FASTEST ESCAPES</div>` +
          rows.map((r, i) => `${["🥇", "🥈", "🥉", "4.", "5."][i]} ${esc(r.player)} — <b>${fmtTime(r.time_ms / 1000)}</b>`).join("<br>");
        elLb.innerHTML = html;
      }
    } else if (elLb && !html) elLb.innerHTML = "";
  }

  async shareDialog(d) {
    this.saveDungeon(d);
    const v = D.validate(d);
    const code = await D.encodeShare(d);
    const url = location.origin + location.pathname + "#d=" + code;
    this.g.hud.modal(`<h3>🔗 Share “${esc(d.name)}”</h3>
      ${v.ok ? "" : `<div class="df-vbad">⚠ Not solvable yet — friends can open it in the builder but not beat it.</div>`}
      <div class="dfm-listhead">LINK (works anywhere)</div>
      <div class="df-selrow"><input class="df-name" style="flex:1" readonly value="${esc(url)}"><button data-a="cp" class="df-btn">Copy</button></div>
      <div class="dfm-listhead" style="margin-top:10px">CLOUD CODE + LEADERBOARD</div>
      <div class="df-lb" data-a="cloud">Publish to get a short code friends can type in, plus a global fastest-escape leaderboard.</div>
      <div class="df-selrow"><button data-a="pub" class="df-btn accent" ${v.ok ? "" : "disabled"}>☁ Publish</button></div>`,
      (m) => {
        m.querySelector('[data-a="cp"]').onclick = (e) => { navigator.clipboard.writeText(url).catch(() => {}); e.target.textContent = "Copied!"; };
        m.querySelector('[data-a="pub"]').onclick = async (e) => {
          e.target.disabled = true; e.target.textContent = "Publishing…";
          const prof = this.profile();
          d.author = prof.name;
          const r = await this.cloud.publishDungeon(d);
          const box = m.querySelector('[data-a="cloud"]');
          if (r && r.code) {
            const list = this.myDungeons();
            const i = list.findIndex((x) => x.name === d.name);
            if (i >= 0) { list[i].cloudId = r.code; localStorage.setItem(LS + "dungeons", JSON.stringify(list)); }
            box.innerHTML = `Code: <b style="font-size:22px;letter-spacing:4px">${r.code}</b><br>Friends: PLAY → enter this code. Fastest times go on its leaderboard.`;
            e.target.textContent = "Published ✔";
          } else {
            box.innerHTML = "☁ Cloud publish unavailable right now — the share LINK above still works!";
            e.target.textContent = "☁ Publish";
            e.target.disabled = false;
          }
        };
      });
  }

  // ── multiplayer ─────────────────────────────────────────────────────────────
  onlineFlow() {
    const mine = this.myDungeons();
    this.g.hud.modal(`<h3>🌐 Play with friends</h3>
      <div class="df-lb">One of you hosts a room and shares the 4-letter code. Build together in real time, then playtest the dungeon co-op — or straight up co-op an escape.</div>
      <div class="dfm-listhead">HOST</div>
      <div class="df-selrow" style="margin-bottom:8px">
        <button data-a="hbuildf" class="df-btn" style="flex:1">⚒ Co-build 🏰</button>
        <button data-a="hbuilds" class="df-btn" style="flex:1">⚒ Co-build 🤖</button>
      </div>
      ${mine.length ? `<div class="df-selrow" style="margin-bottom:8px">
        <select data-a="pick" class="df-diff" style="flex:1">${mine.map((m, i) => `<option value="${i}">${esc(m.name)} (${m.theme})</option>`).join("")}</select>
        <button data-a="hplay" class="df-btn">▶ Co-op escape</button>
      </div>` : ""}
      <div class="df-selrow" style="margin-bottom:8px">
        <button data-a="hsample" class="df-btn" style="flex:1">▶ Co-op the Forge Trials (sample)</button>
      </div>
      <div class="dfm-listhead">JOIN</div>
      <div class="df-selrow"><input data-a="code" class="df-name" maxlength="4" placeholder="CODE" style="flex:1;text-align:center;letter-spacing:6px;text-transform:uppercase"><button data-a="join" class="df-btn accent">JOIN</button></div>`,
      (m) => {
        const start = (mode, dungeon) => { this.g.hud.closeModal(); this.hostRoom(mode, dungeon); };
        m.querySelector('[data-a="hbuildf"]').onclick = () => start("build", D.starterDungeon("fantasy"));
        m.querySelector('[data-a="hbuilds"]').onclick = () => start("build", D.starterDungeon("scifi"));
        if (m.querySelector('[data-a="hplay"]')) m.querySelector('[data-a="hplay"]').onclick = () => {
          const entry = mine[+m.querySelector('[data-a="pick"]').value];
          const d = D.sanitize(entry.json);
          const v = d && D.validate(d);
          if (!d || !v.ok) { this.g.hud.toast("That dungeon isn't solvable yet", "warn"); return; }
          start("play", d);
        };
        m.querySelector('[data-a="hsample"]').onclick = () => start("play", sampleDungeon("fantasy"));
        m.querySelector('[data-a="join"]').onclick = () => {
          const code = m.querySelector('[data-a="code"]').value.trim().toUpperCase();
          if (code.length >= 3) { this.g.hud.closeModal(); this.joinRoom(code); }
        };
      });
  }

  async hostRoom(mode, dungeon) {
    const prof = this.profile();
    const sess = new Session(this.g, prof);
    this.g.session = sess;
    const code = randCode();
    await sess.host(code, mode, dungeon);
    if (mode === "build") this.g.setMode("build", { dungeon, session: sess });
    else sess.hostStartPlay(dungeon);
    this.g.hud.toast("Room " + code + " — share this code!", "info");
  }

  async joinRoom(code) {
    const prof = this.profile();
    const sess = new Session(this.g, prof);
    this.g.session = sess;
    const ok = await sess.join(code);
    if (!ok) {
      this.g.hud.toast("Nobody home in room " + code, "warn");
      this.leaveSession();
      this.g.setMode("menu");
    }
    // session drives mode changes on keyframe
  }

  leaveSession() {
    if (this.g.session) { this.g.session.leave(); this.g.session = null; }
  }

  howTo() {
    this.g.hud.modal(`<h3>How to play</h3><div class="df-lb" style="max-width:440px">
      <b>⚒ Builder:</b> paint floor tiles (drag), stamp rooms, then drop doors, chests, keys, enemies, traps, lights and decorations. Click a door to toggle its <b>🔒 lock</b> — locked doors need a 🗝️ key, so place one on the floor, in a chest, or on an enemy. Stairs auto-cut a landing on the floor above (5 floors max). The ✔ chip tells you live whether your dungeon is solvable.<br><br>
      <b>▶ Escape:</b> WASD + mouse. <b>LMB</b> combo attack (chain 1→2→3!) · <b>RMB/F</b> class ability · <b>R</b> frost (Sorceress) · <b>E</b> interact · <b>Q</b> potion · <b>Shift</b> sprint · <b>V</b> first/third person. Find keys, open the way, survive the guardians, reach the 🌀 portal. Fastest time wins the leaderboard.<br><br>
      <b>⚔ Classes:</b> Knight (sword + shield block + bash) · Barbarian (2-handed axe, crushing blows) · Sorceress (fire burns + frost slows) · Rogue (dual daggers, stacking poison). Pick on the main menu.<br><br>
      <b>🌐 Friends:</b> host shares a 4-letter code. Everyone builds the same dungeon live, and PLAYTEST launches a co-op escape for the whole room.</div>
      <div class="df-selrow"><button data-a="ok" class="df-btn accent">Got it</button></div>`,
      (m) => m.querySelector('[data-a="ok"]').onclick = () => this.g.hud.closeModal());
  }

  credits() {
    this.g.hud.modal(`<h3>Credits</h3><div class="df-lb" style="max-width:430px">
      A ForgeFlow Games original.<br><br>
      <b>3D kits:</b> Kenney (kenney.nl) Modular Dungeon + Space kits, Graveyard, Pirate & Platformer kits — CC0.<br>
      <b>Creatures:</b> Quaternius Ultimate Monsters (CC0) · Poly Pizza community models — Spider &amp; Rat by Quaternius, Skeleton/Zombie/Slime (CC0), “Animated Robot” &amp; “Mech” (CC0), “Bot Drone” by Luke Sanderson (CC-BY), “Plasma Turret” by Kai Bracher (CC-BY), “Sci Fi Crate” (CC0), “Desktop computer” (CC-BY).<br>
      <b>Characters:</b> Quaternius Universal Base Characters (CC0).<br>
      <b>Props:</b> BitGem Cube World & dungeon assets (Unity asset packs).<br>
      <b>Music:</b> OpenGameArt / Jamendo tracks (CC) · SFX: Kenney RPG/Impact/Interface packs (CC0) + procedural WebAudio.<br>
      Full list in CREDITS.md.</div>
      <div class="df-selrow"><button data-a="ok" class="df-btn accent">Close</button></div>`,
      (m) => m.querySelector('[data-a="ok"]').onclick = () => this.g.hud.closeModal());
  }
}

// ── sample dungeons (featured) ────────────────────────────────────────────────
export function sampleDungeon(theme) {
  const d = D.newDungeon({ name: theme === "scifi" ? "Meltdown Facility" : "The Forge Trials", theme, difficulty: 2, author: "ForgeFlow", seed: theme === "scifi" ? 777001 : 777000 });
  const F = (f, x, z, w, h) => D.stampRoom(d, f, x, z, w, h);
  const O = (f, kind, x, z, props) => D.applyOp(d, { t: "obj+", f, o: Object.assign({ kind, x, z }, props) });
  const E1 = theme === "scifi" ? { grunt: "robot", fast: "drone", heavy: "mech", rng: "turret", boss: "alien" } : { grunt: "skeleton", fast: "spider", heavy: "orc", rng: "zombie", boss: "demon" };

  const L = (f, x, z, ct) => D.applyOp(d, { t: "cell+", f, x, z, ct }); // terrain paint

  // floor 0: entry hall → corridor with door → guard room (key on enemy) → locked door → stairs room
  F(0, 20, 20, 6, 5);                    // entry 20..25 × 20..24
  O(0, "spawn", 22, 21, { rot: 0 });
  O(0, "torch", 20, 20); O(0, "torch", 25, 20); O(0, "torch", 20, 24); O(0, "torch", 25, 24);
  O(0, "decor", 21, 24, { dtype: theme === "scifi" ? "crate" : "barrel" });
  F(0, 22, 25, 2, 3);                    // corridor north 25..27
  O(0, "door", 22, 26, { rot: 0 });      // unlocked door mid-corridor (breaks LOS)
  O(0, "trap", 23, 26, { ttype: "spikes" });
  F(0, 19, 28, 8, 6);                    // guard room 19..26 × 28..33
  L(0, 19, 29, 3); L(0, 19, 30, 3); L(0, 20, 29, 3); L(0, 20, 30, 3); // WATER pool (wading slows)
  O(0, "torch", 19, 28); O(0, "torch", 26, 28); O(0, "torch", 19, 33); O(0, "torch", 26, 33);
  O(0, "enemy", 21, 30, { etype: E1.grunt });
  O(0, "enemy", 24, 31, { etype: E1.fast });
  O(0, "key", 24, 31);                   // fast enemy carries key #1
  O(0, "chest", 19, 31, { rot: 1 });
  O(0, "decor", 26, 29, { dtype: theme === "scifi" ? "terminal" : "bookshelf", rot: 3 });
  F(0, 27, 30, 4, 2);                    // corridor east 27..30 × 30..31
  O(0, "door", 28, 30, { rot: 1, locked: true }); // LOCKED — needs key #1
  O(0, "trap", 30, 31, { ttype: "vent" });
  F(0, 31, 28, 6, 6);                    // stairs room 31..36 × 28..33
  L(0, 35, 29, 2); L(0, 35, 30, 2); L(0, 35, 31, 2); // LAVA strip — burn or go around
  L(0, 36, 30, 4); L(0, 36, 31, 4);       // RAISED ledge beside it (auto steps)
  O(0, "torch", 31, 28); O(0, "torch", 36, 33);
  O(0, "enemy", 34, 30, { etype: E1.rng });
  O(0, "chest", 36, 28, { rot: 2 });
  O(0, "key", 36, 28);                   // key #2 in chest (for floor 2's locked door)
  O(0, "stairs", 33, 32, { rot: 0 });    // landing at 33,33 on floor 1
  O(0, "light", 33, 29, { color: theme === "scifi" ? "#ff3d81" : "#8f6bff" });

  // floor 1: landing hall → boss lair behind locked door → exit
  D.applyOp(d, { t: "floor+" });
  F(1, 31, 28, 6, 8);                    // hall 31..36 × 28..35 (landing 33,33 inside)
  L(1, 35, 29, 4); L(1, 36, 29, 4); L(1, 35, 30, 4); L(1, 36, 30, 4); // raised treasure ledge
  O(1, "chest", 36, 29, { rot: 3 });     // bonus chest up the little steps
  O(1, "torch", 31, 28); O(1, "torch", 36, 28); O(1, "torch", 31, 35); O(1, "torch", 36, 35);
  O(1, "enemy", 32, 34, { etype: E1.grunt });
  O(1, "decor", 36, 34, { dtype: theme === "scifi" ? "barrier" : "pillar" });
  F(1, 33, 24, 2, 4);                    // corridor south 24..27
  O(1, "door", 33, 25, { rot: 0, locked: true }); // LOCKED — needs key #2
  F(1, 30, 17, 8, 7);                    // boss lair 30..37 × 17..23
  O(1, "torch", 30, 17); O(1, "torch", 37, 17); O(1, "torch", 30, 23); O(1, "torch", 37, 23);
  O(1, "enemy", 33, 19, { etype: E1.boss, rot: 0 });
  O(1, "enemy", 31, 21, { etype: E1.fast });
  O(1, "enemy", 36, 21, { etype: E1.fast });
  O(1, "chest", 30, 19, { rot: 1 });
  O(1, "chest", 37, 19, { rot: 3 });
  O(1, "trap", 34, 22, { ttype: "spikes" });
  O(1, "exit", 33, 17);
  O(1, "light", 33, 21, { color: theme === "scifi" ? "#59ff9c" : "#ff5566" });

  const v = D.validate(d);
  if (!v.ok) console.warn("[DF] sample dungeon invalid!", v.problems);
  return d;
}

function randCode() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// menu styles
const css = `
.dfm{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif;color:#e8ecff}
.dfm-bg{position:absolute;inset:0;background:url('${new URL("../../thumbnail.png", import.meta.url).href}') center/cover no-repeat;animation:dfmZoom 36s ease-in-out infinite alternate}
.dfm-bgshade{position:absolute;inset:0;background:radial-gradient(1100px 640px at 50% 42%,rgba(8,6,14,.30),rgba(8,6,14,.86)),linear-gradient(rgba(8,6,14,.25),rgba(8,6,14,.6))}
@keyframes dfmZoom{from{transform:scale(1)}to{transform:scale(1.07)}}
.dfm-card{position:relative;text-align:center;background:rgba(8,10,18,.82);border:1px solid rgba(150,170,255,.25);border-radius:26px;padding:38px 46px;backdrop-filter:blur(6px);max-width:92vw}
.dfm-title{font-size:52px;font-weight:900;letter-spacing:4px;text-shadow:0 0 34px var(--df-accent,#ffb347)}
.dfm-title span{color:var(--df-accent,#ffb347)}
.dfm-tag{opacity:.75;font-size:14.5px;margin:6px 0 26px;letter-spacing:.4px}
.dfm-btns{display:flex;flex-direction:column;gap:12px;margin-bottom:22px}
.dfm-big{font-size:18px;font-weight:800;letter-spacing:1px;padding:15px 30px;border-radius:16px;border:1px solid rgba(150,170,255,.3);background:linear-gradient(180deg,rgba(40,48,80,.9),rgba(24,28,48,.9));color:#fff;cursor:pointer;transition:all .15s}
.dfm-big:hover{transform:translateY(-2px);border-color:var(--df-accent,#ffb347);box-shadow:0 6px 24px rgba(0,0,0,.4)}
.dfm-big.alt{background:linear-gradient(180deg,rgba(70,45,25,.9),rgba(40,26,16,.9))}
.dfm-big.online{background:linear-gradient(180deg,rgba(25,60,55,.9),rgba(14,34,32,.9))}
.dfm-profile{display:flex;gap:10px;justify-content:center;align-items:center;margin-bottom:14px}
.dfm-profile input{background:rgba(16,20,34,.9);border:1px solid rgba(150,170,255,.3);color:#fff;border-radius:10px;padding:9px 13px;font-weight:800;text-align:center;width:150px}
.dfm-skin{width:42px;height:42px;font-size:21px;background:rgba(16,20,34,.9);border:1px solid rgba(150,170,255,.3);border-radius:10px;cursor:pointer}
.dfm-skin.on{border-color:var(--df-accent,#ffb347);box-shadow:0 0 12px rgba(255,180,70,.35)}
.dfm-classhead{font-size:10px;font-weight:800;letter-spacing:2px;opacity:.55;margin:8px 0 6px}
.dfm-classes{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:14px}
.dfm-class{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:1px;background:rgba(16,20,34,.85);border:1px solid rgba(150,170,255,.25);border-radius:12px;padding:9px 11px;cursor:pointer;transition:all .13s}
.dfm-class:hover{border-color:rgba(150,170,255,.5);transform:translateY(-1px)}
.dfm-class.on{border-color:var(--df-accent,#ffb347);box-shadow:0 0 14px rgba(255,180,70,.3);background:rgba(40,44,70,.9)}
.dfm-class .ci{font-size:22px}
.dfm-class .cn{font-size:14px;font-weight:800;letter-spacing:.4px}
.dfm-class .cd{font-size:10.5px;opacity:.72;line-height:1.3}
.dfm-foot{font-size:12.5px;opacity:.7}
.dfm-link{background:none;border:none;color:#aab6e8;cursor:pointer;font-size:12.5px;text-decoration:underline}
.dfm-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(150,170,255,.12);font-size:14px;text-align:left}
.dfm-rowbtns{display:flex;gap:6px}
.dfm-listhead{font-size:11px;font-weight:800;letter-spacing:2px;opacity:.6;margin:10px 0 4px;text-align:left}
@media (max-width:640px){ .dfm-title{font-size:34px} .dfm-card{padding:26px 20px} }
`;
const st = document.createElement("style");
st.textContent = css;
document.head.appendChild(st);
