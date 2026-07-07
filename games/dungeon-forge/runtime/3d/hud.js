/**
 * Dungeon Forge — runtime/3d/hud.js
 * All in-game DOM: builder top bar + tool palette + selection panel (with the
 * door LOCK toggle), validation modal, escape HUD (health/mana, keys, gold,
 * timer, minimap with explored fog, interact prompt), toasts, results screen.
 */
const V = new URL(import.meta.url).search;
const D = await import("../sim/dungeon.js" + V);
const E = await import("../sim/escape_sim.js" + V);
const { TOOLS } = await import("./builder.js" + V);
const { fmtTime } = await import("./escape.js" + V);

export class Hud {
  constructor(game) {
    this.g = game;
    this.modalOpen = false;
    injectStyle();
    this.root = el(`<div class="df-hud"></div>`);
    game.container.appendChild(this.root);
    this.toasts = el(`<div class="df-toasts"></div>`);
    this.root.appendChild(this.toasts);
  }

  toast(msg, kind = "info") {
    const t = el(`<div class="df-toast df-${kind}">${esc(msg)}</div>`);
    this.toasts.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, kind === "loot" ? 3400 : 2600);
    while (this.toasts.children.length > 5) this.toasts.firstChild.remove();
  }

  // ═══════════════════════════ BUILDER ═══════════════════════════
  showBuilder(b) {
    this.b = b;
    this.bWrap = el(`<div class="df-build"></div>`);
    this.root.appendChild(this.bWrap);

    // top bar
    this.bTop = el(`<div class="df-topbar">
      <button data-a="back" class="df-btn ghost">‹ MENU</button>
      <input data-a="name" name="dungeonName" class="df-name" maxlength="40" value="${esc(b.d.name)}" title="Dungeon name">
      <span class="df-chip" data-a="theme">${b.d.theme === "scifi" ? "🤖 SCI-FI" : "🏰 FANTASY"}</span>
      <select data-a="diff" class="df-diff" title="Difficulty">
        <option value="1">Easy</option><option value="2">Normal</option><option value="3">Deadly</option>
      </select>
      <span class="df-grow"></span>
      <span class="df-chip df-room" data-a="room" style="display:none"></span>
      <button data-a="gear" class="df-btn ghost" title="Settings">⚙</button>
      <button data-a="validate" class="df-btn">✔ VALIDATE</button>
      <button data-a="save" class="df-btn">💾 SAVE</button>
      <button data-a="share" class="df-btn">🔗 SHARE</button>
      <button data-a="test" class="df-btn accent">▶ PLAYTEST</button>
    </div>`);
    this.bWrap.appendChild(this.bTop);
    this.bTop.querySelector('[data-a="back"]').onclick = () => { this.g.audio.sfx("ui"); this.g.menu.confirmLeaveBuilder(); };
    this.bTop.querySelector('[data-a="name"]').onchange = (e) => b.applyLocal({ t: "meta", p: { name: e.target.value } });
    const diffSel = this.bTop.querySelector('[data-a="diff"]');
    diffSel.value = String(b.d.difficulty || 1);
    diffSel.onchange = (e) => b.applyLocal({ t: "meta", p: { difficulty: +e.target.value } });
    this.bTop.querySelector('[data-a="gear"]').onclick = () => { this.g.audio.sfx("ui"); this.g.showSettings(); };
    this.bTop.querySelector('[data-a="validate"]').onclick = () => { this.g.audio.sfx("ui"); this.showValidate(b.validateNow()); };
    this.bTop.querySelector('[data-a="save"]').onclick = () => { this.g.audio.sfx("confirm"); this.g.menu.saveDungeon(b.d); this.toast("Saved to My Dungeons 💾", "info"); };
    this.bTop.querySelector('[data-a="share"]').onclick = () => { this.g.audio.sfx("ui"); this.g.menu.shareDialog(b.d); };
    this.bTop.querySelector('[data-a="test"]').onclick = () => { this.g.audio.sfx("confirm"); this.g.menu.testPlay(b.d); };

    // tool palette
    this.bPal = el(`<div class="df-palette"></div>`);
    this.bWrap.appendChild(this.bPal);
    for (const t of TOOLS) {
      const btn = el(`<button class="df-tool" data-tool="${t.id}" title="${t.label}"><span class="ico">${t.icon}</span><span class="lbl">${t.label}</span></button>`);
      btn.onclick = () => { this.g.audio.sfx("ui"); b.setTool(t.id); };
      this.bPal.appendChild(btn);
    }
    // sub-options row (enemy type / trap type / decor type / light color)
    this.bSub = el(`<div class="df-subopts"></div>`);
    this.bWrap.appendChild(this.bSub);

    // floor switcher + hints
    this.bSide = el(`<div class="df-floors"></div>`);
    this.bWrap.appendChild(this.bSide);
    this.bHint = el(`<div class="df-hint">LMB place · drag paint · RMB orbit · MMB/Shift pan · wheel zoom · R rotate · Tab floor · Del delete</div>`);
    this.bWrap.appendChild(this.bHint);
    this.bValid = el(`<div class="df-validchip" data-a="vchip"></div>`);
    this.bWrap.appendChild(this.bValid);
    this.bValid.onclick = () => this.showValidate(b.validateNow());

    this.refreshBuilder(b);
    this.refreshValidate(b);
  }

  hideBuilder() { if (this.bWrap) { this.bWrap.remove(); this.bWrap = null; } this.hideSelection(); }

  refreshBuilder(b) {
    if (!this.bWrap) return;
    // keep the name/difficulty in sync (co-build peers can change them)
    const nameInput = this.bTop.querySelector('[data-a="name"]');
    if (nameInput && document.activeElement !== nameInput && nameInput.value !== b.d.name) nameInput.value = b.d.name;
    const diffSel2 = this.bTop.querySelector('[data-a="diff"]');
    if (diffSel2 && diffSel2.value !== String(b.d.difficulty || 1)) diffSel2.value = String(b.d.difficulty || 1);
    this.bPal.querySelectorAll(".df-tool").forEach((btn) => btn.classList.toggle("on", btn.dataset.tool === b.tool));
    // sub options
    const sub = this.bSub;
    sub.innerHTML = "";
    const mkOpts = (list, cur, fmt, onpick) => {
      for (const it of list) {
        const o = el(`<button class="df-sub ${it === cur ? "on" : ""}">${fmt(it)}</button>`);
        o.onclick = () => { this.g.audio.sfx("ui"); onpick(it); this.refreshBuilder(b); };
        sub.appendChild(o);
      }
    };
    if (b.tool === "enemy") {
      const roster = D.ENEMIES[b.d.theme];
      mkOpts(Object.keys(roster), b.toolOpt.etype || Object.keys(roster)[0],
        (k) => `${roster[k].boss ? "👑 " : ""}${roster[k].label}`, (k) => b.setTool("enemy", { etype: k }));
    } else if (b.tool === "trap") {
      mkOpts(D.TRAPS, b.toolOpt.ttype || "spikes", (k) => k === "spikes" ? "⚙ Spikes" : (b.d.theme === "scifi" ? "🔴 Laser vent" : "🔥 Flame vent"), (k) => b.setTool("trap", { ttype: k }));
    } else if (b.tool === "decor") {
      mkOpts(D.DECOR[b.d.theme], b.toolOpt.dtype || D.DECOR[b.d.theme][0], (k) => k, (k) => b.setTool("decor", { dtype: k }));
    } else if (b.tool === "light") {
      const cols = b.d.theme === "scifi" ? ["#37e0ff", "#ff3d81", "#59ff9c", "#ffd769"] : ["#ff9a3c", "#8f6bff", "#59ff9c", "#ff5566"];
      mkOpts(cols, b.toolOpt.color || cols[0], (c) => `<span class="swatch" style="background:${c}"></span>`, (c) => b.setTool("light", { color: c }));
    } else if (b.tool === "torch") {
      sub.appendChild(el(`<span class="df-subnote">${b.d.theme === "scifi" ? "Neon emitter" : "Standing torch"} — lights the room</span>`));
    } else if (b.tool === "key") {
      sub.appendChild(el(`<span class="df-subnote">Drop on the floor, on a 🧰 chest (hides inside) or on a 👹 enemy (they carry it)</span>`));
    } else if (b.tool === "door") {
      sub.appendChild(el(`<span class="df-subnote">Place in a corridor · click the door afterwards to toggle its 🔒 lock</span>`));
    }

    // floors
    this.bSide.innerHTML = "";
    for (let f = b.d.floors.length - 1; f >= 0; f--) {
      const btn = el(`<button class="df-floor ${f === b.floor ? "on" : ""}">${f + 1}</button>`);
      btn.onclick = () => { this.g.audio.sfx("ui"); b.setFloor(f); };
      this.bSide.appendChild(btn);
    }
    if (b.d.floors.length < D.MAX_FLOORS) {
      const add = el(`<button class="df-floor add">＋</button>`);
      add.onclick = () => { this.g.audio.sfx("ui"); b.addFloor(); };
      this.bSide.insertBefore(add, this.bSide.firstChild);
    }
  }

  refreshValidate(b) {
    if (!this.bValid || !this.bWrap) return;
    clearTimeout(this._vT);
    this._vT = setTimeout(() => {
      const v = b.validateNow();
      this.bValid.className = "df-validchip " + (v.ok ? "good" : "bad");
      this.bValid.innerHTML = v.ok ? "✔ Solvable" : "⚠ " + esc(v.problems[0].msg);
    }, 150);
  }

  showSelection(b, hit) {
    this.hideSelection();
    if (!hit) return;
    const o = hit.obj;
    const kindLabel = { door: "Door", chest: "Chest", key: "Key", enemy: "Enemy", trap: "Trap", torch: "Light", light: "Light orb", decor: "Decoration", spawn: "Spawn", exit: "Exit portal", stairs: "Stairs" }[o.kind] || o.kind;
    let extra = "";
    if (o.kind === "door") {
      extra = `<button data-a="lock" class="df-btn ${o.locked ? "danger" : ""}" title="Locked doors need a key">${o.locked ? "🔒 LOCKED — needs key" : "🔓 Unlocked"}</button>
        <div class="df-selnote">${o.locked ? "Remember to place at least one 🗝️ key the players can reach!" : "Click to require a key"}</div>`;
    }
    if (o.kind === "enemy") {
      const roster = D.ENEMIES[b.d.theme];
      extra = `<select data-a="etype" class="df-diff">${Object.keys(roster).map((k) => `<option value="${k}" ${k === o.etype ? "selected" : ""}>${roster[k].label}</option>`).join("")}</select>`;
    }
    if (o.kind === "trap") {
      extra = `<select data-a="ttype" class="df-diff">${D.TRAPS.map((k) => `<option value="${k}" ${k === o.ttype ? "selected" : ""}>${k}</option>`).join("")}</select>`;
    }
    this.selPanel = el(`<div class="df-selpanel">
      <div class="df-selhead">${kindLabel} <span class="dim">· cell ${o.x},${o.z}</span></div>
      ${extra}
      <div class="df-selrow">
        <button data-a="rot" class="df-btn">⟳ Rotate</button>
        <button data-a="del" class="df-btn danger">🗑 Delete</button>
      </div>
    </div>`);
    this.root.appendChild(this.selPanel);
    const q = (s) => this.selPanel.querySelector(s);
    if (q('[data-a="lock"]')) q('[data-a="lock"]').onclick = () => { b.toggleLock(); };
    if (q('[data-a="etype"]')) q('[data-a="etype"]').onchange = (e) => b._editSel({ etype: e.target.value });
    if (q('[data-a="ttype"]')) q('[data-a="ttype"]').onchange = (e) => b._editSel({ ttype: e.target.value });
    q('[data-a="rot"]').onclick = () => b.rotateSelected();
    q('[data-a="del"]').onclick = () => b.deleteSelected();
  }
  hideSelection() { if (this.selPanel) { this.selPanel.remove(); this.selPanel = null; } }

  showValidate(v) {
    const list = v.ok
      ? `<div class="df-vgood">✔ This dungeon is solvable!<br><span class="dim">${v.solvability ? `${v.solvability.totalKeys} key(s) placed · ${v.solvability.keysUsed} needed for locked doors` : ""}</span></div>`
      : v.problems.map((p) => `<div class="df-vbad">⚠ ${esc(p.msg)}</div>`).join("");
    this.modal(`<h3>Dungeon check</h3>${list}<div class="df-selrow"><button data-a="ok" class="df-btn accent">OK</button></div>`,
      (m) => { m.querySelector('[data-a="ok"]').onclick = () => this.closeModal(); });
  }

  modal(html, wire) {
    this.closeModal();
    this.modalOpen = true;
    this._modal = el(`<div class="df-modalback"><div class="df-modal">${html}</div></div>`);
    this.root.appendChild(this._modal);
    this._modal.addEventListener("pointerdown", (e) => { if (e.target === this._modal) this.closeModal(); });
    if (wire) wire(this._modal.querySelector(".df-modal"));
  }
  closeModal() { if (this._modal) { this._modal.remove(); this._modal = null; } this.modalOpen = false; }

  // ═══════════════════════════ ESCAPE ═══════════════════════════
  showEscape(esc_) {
    this.e = esc_;
    this.eWrap = el(`<div class="df-play">
      <div class="df-vitals">
        <div class="df-bar hp"><div class="fill" data-a="hp"></div><span data-a="hptxt"></span></div>
        <div class="df-bar mana"><div class="fill" data-a="mana"></div></div>
        <div class="df-inv">
          <span class="df-slot" data-a="keys" title="Keys">🗝️ 0</span>
          <span class="df-slot" data-a="gold" title="Gold">💰 0</span>
          <span class="df-slot" data-a="potions" title="Q to drink">🧪 1</span>
          <span class="df-slot" data-a="charms" title="Damage charms" style="display:none">✨ 0</span>
          <span class="df-slot tier" data-a="wt" title="Weapon tier" style="display:none">⚔ I</span>
          <span class="df-slot tier" data-a="at" title="Armor tier" style="display:none">🛡 I</span>
        </div>
      </div>
      <div class="df-topright">
        <span class="df-chip" data-a="timer">0.0s</span>
        <span class="df-chip" data-a="floorN">Floor 1</span>
        <button class="df-btn ghost" data-a="settings" title="Settings">⚙</button>
        <button class="df-btn ghost" data-a="quit">✕</button>
      </div>
      <div class="df-targetplate" data-a="tplate" style="display:none">
        <div class="df-tname" data-a="tname"></div>
        <div class="df-bar thp"><div class="fill" data-a="thp"></div><span data-a="thptxt"></span></div>
      </div>
      <canvas class="df-minimap" data-a="map" width="180" height="180"></canvas>
      <div class="df-prompt" data-a="prompt" style="display:none"></div>
      <div class="df-abilities" data-a="abilities"></div>
      <div class="df-crosshair">·</div>
      <div class="df-vignette" data-a="vig"></div>
      <div class="df-objective" data-a="obj"></div>
    </div>`);
    this.root.appendChild(this.eWrap);
    this.eWrap.querySelector('[data-a="quit"]').onclick = () => { this.g.audio.sfx("ui"); this.g.menu.confirmQuitRun(); };
    this.eWrap.querySelector('[data-a="settings"]').onclick = () => { this.g.audio.sfx("ui"); this.g.showSettings(); };
    this.mapCtx = this.eWrap.querySelector('[data-a="map"]').getContext("2d");
    this.explored = new Set();
    const obj = this.eWrap.querySelector('[data-a="obj"]');
    obj.innerHTML = "🌀 Find the exit portal" + (D.findAll(esc_.d, "door").some((h) => h.obj.locked) ? " — locked doors need 🗝️ keys" : "");
    setTimeout(() => obj.classList.add("out"), 5200);
    this._mapT = 0;
  }
  hideEscape() { if (this.eWrap) { this.eWrap.remove(); this.eWrap = null; } this.closeModal(); }

  setFloor(n, total) {
    if (!this.eWrap) return;
    this.eWrap.querySelector('[data-a="floorN"]').textContent = "Floor " + n + (total > 1 ? "/" + total : "");
    this.explored = new Set(); // new floor, new fog
  }

  /** D&D-style target plate: the soft-locked enemy's name + health. */
  setTarget(e, d) {
    if (!this.eWrap) return;
    const plate = this.eWrap.querySelector('[data-a="tplate"]');
    if (!e) { if (plate.style.display !== "none") plate.style.display = "none"; this._tId = null; return; }
    plate.style.display = "";
    const K = e.K || {};
    if (this._tId !== e.id) {
      this._tId = e.id;
      this.eWrap.querySelector('[data-a="tname"]').innerHTML =
        `${K.boss ? "👑 " : ""}${esc(K.label || e.etype)}${K.boss ? " 👑" : ""}`;
    }
    const maxHp = K.hp * (0.85 + 0.15 * ((d && d.difficulty) || 1));
    const frac = Math.max(0, e.hp / maxHp);
    this.eWrap.querySelector('[data-a="thp"]').style.width = (frac * 100) + "%";
    this.eWrap.querySelector('[data-a="thptxt"]').textContent = Math.max(0, Math.round(e.hp)) + " / " + Math.round(maxHp);
  }

  damageFlash() {
    if (!this.eWrap) return;
    const v = this.eWrap.querySelector('[data-a="vig"]');
    v.classList.remove("hurt"); void v.offsetWidth; v.classList.add("hurt");
  }

  /** Brief camera-punch feel via a canvas transform (impact hits). */
  shake(amount) {
    const cv = this.g.renderer.domElement;
    this._shakeAmt = Math.min(1, (this._shakeAmt || 0) + (amount || 0.3));
    if (this._shaking) return;
    this._shaking = true;
    const t0 = performance.now();
    const step = () => {
      const e = (performance.now() - t0) / 260;
      if (e >= 1 || !this.g.renderer) { cv.style.transform = ""; this._shaking = false; this._shakeAmt = 0; return; }
      const m = this._shakeAmt * (1 - e) * 10;
      cv.style.transform = `translate(${(Math.random() - .5) * m}px, ${(Math.random() - .5) * m}px)`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  updateEscape(esc_, p) {
    if (!this.eWrap) return;
    const q = (s) => this.eWrap.querySelector(s);
    q('[data-a="hp"]').style.width = Math.max(0, p.hp) + "%";
    q('[data-a="hptxt"]').textContent = Math.max(0, Math.round(p.hp)) + " HP";
    q('[data-a="mana"]').style.width = Math.max(0, (p.mana / E.PLAYER.mana) * 100) + "%";
    q('[data-a="keys"]').textContent = "🗝️ " + p.keys;
    q('[data-a="gold"]').textContent = "💰 " + p.gold;
    q('[data-a="potions"]').textContent = "🧪 " + p.potions;
    const ch = q('[data-a="charms"]');
    ch.style.display = p.charms ? "" : "none"; ch.textContent = "✨ " + p.charms;
    const ROM = ["", "I", "II", "III"];
    const wt = q('[data-a="wt"]'); wt.style.display = p.weaponTier ? "" : "none"; wt.textContent = "⚔ " + ROM[p.weaponTier || 0];
    const at = q('[data-a="at"]'); at.style.display = p.armorTier ? "" : "none"; at.textContent = "🛡 " + ROM[p.armorTier || 0];
    q('[data-a="timer"]').textContent = fmtTime(esc_.run.time);
    // class ability bar (special + combo pips)
    const ab = q('[data-a="abilities"]');
    if (ab) {
      const cls = E.CLASSES[p.cls] || E.CLASSES.knight;
      const sName = { bash: "Shield Bash", crush: "Crush", fire: "Fire Bolt", knife: "Poison Knife" }[cls.special && cls.special.kind] || "Special";
      const sCd = cls.special ? cls.special.cd : 1;
      const sReady = (p.specialT || 0) <= 0;
      const comboOn = (esc_.run.time - (p.comboT || 0)) < 1.4 && p.combo > 0;
      let html = `<span class="df-ab ${sReady ? "" : "cd"}"><b>RMB</b> ${sName}${sReady ? "" : " " + (p.specialT).toFixed(1) + "s"}</span>`;
      if (cls.frost) { const fReady = (p.frostT || 0) <= 0; html += `<span class="df-ab ${fReady ? "" : "cd"}"><b>R</b> Frost${fReady ? "" : " " + (p.frostT).toFixed(1) + "s"}</span>`; }
      html += `<span class="df-combo ${comboOn ? "on" : ""}">${comboOn ? "COMBO ×" + p.combo : ""}</span>`;
      ab.innerHTML = html;
    }
    // interact prompt
    const hint = p.alive && !p.escaped ? E.interactHint(esc_.run, p) : null;
    const pr = q('[data-a="prompt"]');
    if (hint) {
      pr.style.display = "";
      pr.innerHTML = hint.need ? `🔒 ${esc(hint.verb)}` : `<b>E</b> ${esc(hint.verb)}`;
      pr.classList.toggle("need", !!hint.need);
    } else pr.style.display = "none";
    // minimap ~8Hz
    this._mapT -= 1;
    if (this._mapT <= 0) { this._mapT = 8; this._drawMap(esc_, p); }
  }

  _drawMap(esc_, p) {
    const ctx = this.mapCtx;
    const fl = esc_.d.floors[p.f];
    if (!fl) return;
    const R = 15; // cells radius shown
    const px = E.w2c(p.x), pz = E.w2c(p.z);
    // mark explored
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) this.explored.add(D.ck(px + dx, pz + dz));
    ctx.clearRect(0, 0, 180, 180);
    ctx.fillStyle = "rgba(6,8,14,.78)";
    ctx.fillRect(0, 0, 180, 180);
    const s = 180 / (R * 2 + 1);
    const draw = (x, z, color) => {
      const mx = (x - px + R) * s, mz = (z - pz + R) * s;
      if (mx < -s || mz < -s || mx > 180 || mz > 180) return;
      ctx.fillStyle = color;
      ctx.fillRect(mx, 180 - mz - s, s, s);
    };
    for (const k of Object.keys(fl.cells)) {
      if (!this.explored.has(k)) continue;
      const [x, z] = k.split(",").map(Number);
      const ct = fl.cells[k] | 0;
      draw(x, z, ct === 2 ? "rgba(255,90,30,.75)" : ct === 3 ? "rgba(60,140,220,.6)" : ct === 4 ? "rgba(170,180,215,.65)" : "rgba(120,130,170,.5)");
    }
    for (const o of fl.objects) {
      if (!this.explored.has(D.ck(o.x, o.z))) continue;
      if (o.kind === "door") draw(o.x, o.z, esc_.run.openDoors.has(o.id) ? "#59ff9c" : (o.locked && !esc_.run.unlockedDoors.has(o.id) ? "#ff5566" : "#c9a24a"));
      if (o.kind === "exit") draw(o.x, o.z, "#8f6bff");
      if (o.kind === "stairs") draw(o.x, o.z, "#4ac3ff");
      if (o.kind === "chest" && !esc_.run.openedChests.has(o.id)) draw(o.x, o.z, "#ffd769");
    }
    // teammates
    for (const pl of esc_.run.players) {
      if (pl.f !== p.f || pl.id === p.id) continue;
      draw(E.w2c(pl.x), E.w2c(pl.z), "#59ff9c");
    }
    // me: arrow
    ctx.save();
    ctx.translate(90, 90);
    ctx.rotate(-(p.yaw || 0));
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.4, 5); ctx.lineTo(-4.4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  showResults(esc_, res) {
    const rows = res.players
      .slice().sort((a, b) => (b.escaped ? 1 : 0) - (a.escaped ? 1 : 0) || a.deaths - b.deaths)
      .map((p) => `<tr><td>${p.escaped ? "🏆" : "💀"} ${esc(p.name)}</td><td>${p.deaths} deaths</td><td>💰 ${p.gold}</td></tr>`).join("");
    const t = fmtTime(res.time);
    this.modal(`<h3>ESCAPED! 🎉</h3>
      <div class="df-bigtime">${t}</div>
      <table class="df-restable">${rows}</table>
      <div class="df-lb" data-a="lb">…</div>
      <div class="df-selrow">
        <button data-a="again" class="df-btn">↻ Run it again</button>
        <button data-a="done" class="df-btn accent">${esc_.returnTo === "build" ? "🔧 Back to builder" : "🏰 Menu"}</button>
      </div>`, (m) => {
      m.querySelector('[data-a="again"]').onclick = () => { this.closeModal(); this.g.menu.replayRun(esc_); };
      m.querySelector('[data-a="done"]').onclick = () => { this.closeModal(); this.g.menu.afterRun(esc_); };
      this.g.menu.reportScore(esc_, res, m.querySelector('[data-a="lb"]'));
    });
  }
}

// ── util ──────────────────────────────────────────────────────────────────────
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

let _styled = false;
function injectStyle() {
  if (_styled) return; _styled = true;
  const css = `
  .df-hud{position:absolute;inset:0;pointer-events:none;font-family:'Segoe UI',system-ui,sans-serif;color:#e8ecff;--acc:var(--df-accent,#ffb347);--acc2:var(--df-accent2,#7d5fff);z-index:20}
  .df-hud *{box-sizing:border-box}
  .df-hud button{cursor:pointer;pointer-events:auto}
  .df-btn{background:rgba(16,20,34,.85);border:1px solid rgba(150,170,255,.28);color:#e8ecff;border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;letter-spacing:.4px;transition:all .15s}
  .df-btn:hover{border-color:var(--acc);color:var(--acc)}
  .df-btn.accent{background:var(--acc);color:#0a0c14;border-color:transparent}
  .df-btn.accent:hover{filter:brightness(1.12);color:#0a0c14}
  .df-btn.danger{border-color:rgba(255,90,110,.6);color:#ff8296}
  .df-btn.ghost{background:rgba(10,12,20,.55)}
  .df-chip{background:rgba(16,20,34,.85);border:1px solid rgba(150,170,255,.22);border-radius:9px;padding:7px 12px;font-size:12px;font-weight:700;letter-spacing:.6px}
  .df-toasts{position:absolute;top:64px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;z-index:60}
  .df-toast{background:rgba(12,16,28,.92);border:1px solid rgba(150,170,255,.3);border-radius:12px;padding:9px 18px;font-size:14px;font-weight:600;animation:dfIn .25s ease;max-width:70vw;text-align:center}
  .df-toast.df-warn{border-color:rgba(255,120,90,.55)} .df-toast.df-loot{border-color:rgba(255,215,105,.55)}
  .df-toast.out{opacity:0;transform:translateY(-8px);transition:all .4s}
  @keyframes dfIn{from{opacity:0;transform:translateY(8px)}to{opacity:1}}
  /* builder */
  .df-topbar{position:absolute;top:0;left:0;right:0;display:flex;gap:8px;align-items:center;padding:10px 12px;background:linear-gradient(rgba(5,7,12,.92),rgba(5,7,12,.5) 80%,transparent);pointer-events:auto}
  .df-name{background:rgba(16,20,34,.85);border:1px solid rgba(150,170,255,.28);color:#fff;border-radius:10px;padding:8px 12px;font-weight:800;font-size:14px;width:220px;letter-spacing:.4px}
  .df-diff{background:rgba(16,20,34,.85);border:1px solid rgba(150,170,255,.28);color:#fff;border-radius:10px;padding:8px;font-weight:700;font-size:12px;pointer-events:auto}
  .df-grow{flex:1}
  .df-room{border-color:var(--acc);color:var(--acc);letter-spacing:2px}
  .df-palette{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:6px;background:rgba(10,13,22,.88);border:1px solid rgba(150,170,255,.25);border-radius:16px;padding:8px;pointer-events:auto;flex-wrap:wrap;justify-content:center;max-width:96vw}
  .df-tool{display:flex;flex-direction:column;align-items:center;gap:2px;background:transparent;border:1px solid transparent;border-radius:12px;padding:7px 9px;color:#cfd6f4;min-width:58px}
  .df-tool .ico{font-size:21px} .df-tool .lbl{font-size:10px;font-weight:700;letter-spacing:.4px;opacity:.8}
  .df-tool:hover{border-color:rgba(150,170,255,.4)}
  .df-tool.on{background:rgba(90,110,220,.25);border-color:var(--acc);color:#fff}
  .df-subopts{position:absolute;bottom:96px;left:50%;transform:translateX(-50%);display:flex;gap:6px;pointer-events:auto;flex-wrap:wrap;justify-content:center;max-width:92vw}
  .df-sub{background:rgba(10,13,22,.88);border:1px solid rgba(150,170,255,.25);color:#cfd6f4;border-radius:10px;padding:6px 12px;font-size:12px;font-weight:700}
  .df-sub.on{border-color:var(--acc);color:var(--acc)}
  .df-sub .swatch{display:inline-block;width:22px;height:14px;border-radius:4px}
  .df-subnote{background:rgba(10,13,22,.8);border-radius:10px;padding:6px 12px;font-size:12px;opacity:.85}
  .df-floors{position:absolute;right:14px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px;pointer-events:auto}
  .df-floor{width:44px;height:40px;background:rgba(10,13,22,.88);border:1px solid rgba(150,170,255,.3);border-radius:10px;color:#cfd6f4;font-weight:800;font-size:15px}
  .df-floor.on{border-color:var(--acc);color:var(--acc)} .df-floor.add{opacity:.7}
  .df-hint{position:absolute;bottom:2px;left:10px;font-size:11px;opacity:.5}
  .df-validchip{position:absolute;top:60px;left:12px;pointer-events:auto;cursor:pointer;border-radius:10px;padding:7px 12px;font-size:12px;font-weight:800;border:1px solid}
  .df-validchip.good{background:rgba(20,60,40,.75);border-color:rgba(90,255,160,.5);color:#7dffb0}
  .df-validchip.bad{background:rgba(70,25,25,.8);border-color:rgba(255,110,110,.5);color:#ffa0a0}
  .df-selpanel{position:absolute;left:12px;top:110px;width:250px;background:rgba(10,13,22,.94);border:1px solid rgba(150,170,255,.3);border-radius:14px;padding:14px;pointer-events:auto;display:flex;flex-direction:column;gap:10px}
  .df-selhead{font-weight:800;font-size:15px} .dim{opacity:.55;font-weight:600;font-size:12px}
  .df-selrow{display:flex;gap:8px} .df-selrow .df-btn{flex:1}
  .df-selnote{font-size:11.5px;opacity:.75;line-height:1.45}
  /* modal */
  .df-modalback{position:absolute;inset:0;background:rgba(3,5,10,.6);display:flex;align-items:center;justify-content:center;pointer-events:auto;z-index:70}
  .df-modal{background:rgba(12,15,26,.97);border:1px solid rgba(150,170,255,.35);border-radius:18px;padding:22px 26px;min-width:330px;max-width:520px;max-height:80vh;overflow:auto}
  .df-modal h3{margin:0 0 14px;font-size:19px;letter-spacing:.5px}
  .df-vgood{color:#7dffb0;font-weight:700;line-height:1.6;margin-bottom:12px}
  .df-vbad{color:#ffa0a0;font-weight:600;margin:6px 0}
  .df-bigtime{font-size:44px;font-weight:900;color:var(--acc);text-align:center;margin:6px 0 14px;text-shadow:0 0 24px var(--acc)}
  .df-restable{width:100%;border-collapse:collapse;margin-bottom:12px}
  .df-restable td{padding:6px 8px;border-bottom:1px solid rgba(150,170,255,.12);font-size:14px}
  .df-lb{font-size:13px;opacity:.9;margin-bottom:14px;line-height:1.7}
  .df-lb b{color:var(--acc)}
  /* escape hud */
  .df-vitals{position:absolute;left:16px;bottom:16px;display:flex;flex-direction:column;gap:7px;width:270px}
  .df-bar{position:relative;height:22px;background:rgba(8,10,18,.8);border:1px solid rgba(150,170,255,.3);border-radius:11px;overflow:hidden}
  .df-bar.mana{height:10px;border-radius:6px}
  .df-bar .fill{position:absolute;inset:0;width:100%;transition:width .18s}
  .df-bar.hp .fill{background:linear-gradient(90deg,#ff4455,#ff7a55)}
  .df-bar.mana .fill{background:linear-gradient(90deg,#3d7bff,#37e0ff)}
  .df-bar span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;text-shadow:0 1px 3px #000}
  .df-inv{display:flex;gap:7px}
  .df-slot{background:rgba(8,10,18,.8);border:1px solid rgba(150,170,255,.25);border-radius:9px;padding:5px 10px;font-size:13px;font-weight:800}
  .df-topright{position:absolute;top:12px;right:12px;display:flex;gap:8px;align-items:center}
  .df-minimap{position:absolute;top:56px;right:12px;border:1px solid rgba(150,170,255,.3);border-radius:12px}
  .df-prompt{position:absolute;left:50%;top:58%;transform:translateX(-50%);background:rgba(10,13,22,.92);border:1px solid var(--acc);border-radius:12px;padding:9px 18px;font-size:15px;font-weight:700}
  .df-prompt b{color:var(--acc);border:1px solid var(--acc);border-radius:6px;padding:1px 7px;margin-right:6px}
  .df-prompt.need{border-color:#ff5566;color:#ffb0b8}
  .df-abilities{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center}
  .df-ab{background:rgba(8,10,18,.82);border:1px solid rgba(150,170,255,.3);border-radius:9px;padding:5px 11px;font-size:12px;font-weight:700}
  .df-ab b{color:var(--acc);border:1px solid var(--acc);border-radius:5px;padding:0 5px;margin-right:5px;font-size:11px}
  .df-ab.cd{opacity:.5;border-color:rgba(120,130,160,.3)}
  .df-ab.cd b{color:#8894b8;border-color:#8894b8}
  .df-combo{font-size:15px;font-weight:900;letter-spacing:1px;color:#ffcf5a;text-shadow:0 0 8px rgba(255,180,70,.6);min-width:70px;opacity:0;transition:opacity .1s}
  .df-combo.on{opacity:1}
  .df-crosshair{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:22px;opacity:.65;text-shadow:0 0 4px #000}
  .df-vignette{position:absolute;inset:0;pointer-events:none;opacity:0}
  .df-vignette.hurt{animation:dfHurt .5s ease}
  @keyframes dfHurt{0%{opacity:.9}100%{opacity:0}}
  .df-vignette{box-shadow:inset 0 0 140px 40px rgba(255,30,40,.55)}
  .df-objective{position:absolute;top:14%;left:50%;transform:translateX(-50%);font-size:17px;font-weight:800;letter-spacing:.4px;background:rgba(10,13,22,.85);border:1px solid rgba(150,170,255,.3);border-radius:12px;padding:10px 20px;transition:opacity .8s}
  .df-objective.out{opacity:0}
  .df-targetplate{position:absolute;top:14px;left:50%;transform:translateX(-50%);width:300px;background:rgba(10,13,22,.88);border:1px solid rgba(255,90,110,.5);border-radius:12px;padding:8px 12px}
  .df-tname{font-size:14px;font-weight:800;letter-spacing:.6px;text-align:center;margin-bottom:5px;color:#ffb8c0}
  .df-bar.thp{height:14px;border-radius:7px;border-color:rgba(255,90,110,.4)}
  .df-bar.thp .fill{background:linear-gradient(90deg,#c22,#f55)}
  .df-bar.thp span{font-size:10.5px}
  .df-slot.tier{border-color:rgba(255,215,105,.5);color:#ffe9b0}
  .df-setrow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0;font-size:14px;font-weight:600}
  .df-setrow input[type=range]{flex:1;max-width:200px;accent-color:var(--acc)}
  .df-setrow .df-toggle{width:46px;height:24px;border-radius:12px;background:rgba(90,100,140,.4);border:1px solid rgba(150,170,255,.3);position:relative;cursor:pointer;pointer-events:auto}
  .df-setrow .df-toggle.on{background:var(--acc)}
  .df-setrow .df-toggle::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}
  .df-setrow .df-toggle.on::after{left:24px}
  .df-fps{position:absolute;bottom:8px;right:10px;font:700 13px monospace;color:#7dffb0;background:rgba(8,10,16,.7);padding:4px 9px;border-radius:8px;z-index:50;pointer-events:none}
  @media (max-width:820px){ .df-tool .lbl{display:none} .df-tool{min-width:44px} .df-name{width:130px} .df-minimap{width:120px;height:120px} }
  `;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
}
