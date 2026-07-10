// Crownfire Arenas — DOM HUD + menus.
// Premium gold/purple frame language. Radial cooldowns are conic-gradient
// overlays on circular buttons. Touch joystick + ability buttons pipe into
// the shared Input object. All screens are DOM (crisp text, no canvas UI).

import { CLASSES } from "../data/abilities.js";
import { ARENAS } from "../data/arenas.js";
import { formatScore, clamp } from "../core/util.js";
import { SFX } from "../core/audio.js";

const GOLD = "#e8b83a", PURPLE = "#7a4dcf", DARKPANEL = "rgba(16,8,26,0.92)";

function el(tag, css, html) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const frameCss = `background:${DARKPANEL};border:2px solid ${GOLD};border-radius:14px;` +
  `box-shadow:0 0 18px rgba(122,77,207,.45),inset 0 0 24px rgba(122,77,207,.18);color:#f2e8d8;`;

export class HUD {
  constructor(root, input) {
    this.root = root; this.input = input;
    this.cb = {};            // callbacks set by game: onClassPick, onArenaPick, onRestart, onNextRealm, onMenu, onToggleMode
    this._buildStyles();
    this.layerMenu = el("div", "position:absolute;inset:0;pointer-events:auto;display:none;");
    this.layerGame = el("div", "position:absolute;inset:0;pointer-events:none;display:none;");
    this.layerBanner = el("div", "position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;flex-direction:column;");
    root.append(this.layerMenu, this.layerGame, this.layerBanner);
    this.touch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
    this._buildGameHud();
  }

  _buildStyles() {
    const st = document.createElement("style");
    st.textContent = `
      @keyframes cfPop { 0%{transform:scale(.3);opacity:0} 40%{transform:scale(1.15);opacity:1} 100%{transform:scale(1)} }
      @keyframes cfBannerIn { 0%{transform:scale(.4) rotate(-4deg);opacity:0} 50%{transform:scale(1.12) rotate(1deg);opacity:1} 100%{transform:scale(1) rotate(0)} }
      @keyframes cfFadeOut { to{opacity:0} }
      @keyframes cfPulse { 0%,100%{box-shadow:0 0 14px rgba(232,184,58,.5)} 50%{box-shadow:0 0 30px rgba(232,184,58,.95)} }
      @keyframes cfShimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
      .cf-btn { cursor:pointer; transition: transform .12s, box-shadow .12s; pointer-events:auto; }
      .cf-btn:hover { transform:scale(1.05); box-shadow:0 0 22px rgba(232,184,58,.8) !important; }
      .cf-btn:active { transform:scale(.97); }
      .cf-card { cursor:pointer; transition: transform .15s, box-shadow .15s; }
      .cf-card:hover { transform:translateY(-6px) scale(1.03); box-shadow:0 0 28px rgba(232,184,58,.7) !important; }
    `;
    document.head.appendChild(st);
  }

  // ============ MENUS =====================================================

  showTitle() {
    this._menu(`
      <div style="text-align:center;animation:cfPop .5s ease-out">
        <div style="font-size:15px;letter-spacing:8px;color:#b89ae0;margin-bottom:6px">FORGEFLOW GAMES</div>
        <div style="font-size:64px;font-weight:900;letter-spacing:3px;line-height:1;
          background:linear-gradient(180deg,#ffe9a8 0%,#e8b83a 45%,#a2521a 70%,#ff6a2a 100%);
          -webkit-background-clip:text;background-clip:text;color:transparent;
          text-shadow:0 0 40px rgba(255,120,40,.35);font-family:Georgia,serif">CROWNFIRE<br>ARENAS</div>
        <div style="font-size:16px;color:#cdb8ee;margin-top:14px;max-width:430px">
          Five floating realm-boards. Endless legions. One crown of fire.<br>Claim it.</div>
        <div id="cf-start" class="cf-btn" style="margin:34px auto 0;width:240px;padding:15px 0;${frameCss}
          font-size:20px;font-weight:800;text-align:center;animation:cfPulse 2s infinite">ENTER THE ARENAS</div>
        <div style="margin-top:18px;font-size:12px;color:#8a7aa8">WASD move · J / click attack · 1 2 3 abilities · TAB weapon mode (Warrior)</div>
      </div>`);
    this.layerMenu.querySelector("#cf-start").onclick = () => { SFX.unlock(); SFX.play("ui_big"); this.showClassSelect(); };
  }

  showClassSelect() {
    const cards = Object.entries(CLASSES).map(([id, c]) => `
      <div class="cf-card" data-cls="${id}" style="${frameCss}width:200px;padding:22px 16px;text-align:center;">
        <div style="font-size:52px">${c.portrait}</div>
        <div style="font-size:24px;font-weight:900;color:${c.uiColor};margin:8px 0 6px">${c.name}</div>
        <div style="font-size:12.5px;color:#cbbfe0;min-height:64px">${c.desc}</div>
        <div style="margin-top:10px;font-size:11px;color:#8a7aa8">${"❤".repeat(c.hearts)}</div>
      </div>`).join("");
    this._menu(`
      <div style="text-align:center">
        <div style="font-size:34px;font-weight:900;color:${GOLD};margin-bottom:24px;font-family:Georgia,serif">CHOOSE YOUR CHAMPION</div>
        <div style="display:flex;gap:22px;justify-content:center;flex-wrap:wrap">${cards}</div>
      </div>`);
    for (const card of this.layerMenu.querySelectorAll(".cf-card"))
      card.onclick = () => { SFX.play("ui_big"); this.showArenaSelect(card.dataset.cls); };
  }

  showArenaSelect(classId) {
    const unlocked = parseInt(localStorage.getItem("crownfire_unlocked") || "1", 10);
    const cards = ARENAS.map((a, i) => {
      const locked = a.order > unlocked;
      const col = "#" + a.accent.toString(16).padStart(6, "0");
      return `
      <div class="cf-card" data-arena="${i}" data-locked="${locked}" style="${frameCss}width:172px;padding:16px 12px;text-align:center;${locked ? "opacity:.45;filter:grayscale(.7)" : ""}">
        <div style="font-size:13px;color:#8a7aa8">REALM ${a.order}</div>
        <div style="width:74px;height:74px;margin:10px auto;border-radius:50%;border:3px solid ${col};
          background:radial-gradient(circle at 38% 32%, ${col}55, #120a1e 70%);box-shadow:0 0 16px ${col}88"></div>
        <div style="font-size:17px;font-weight:900;color:${col}">${a.name}</div>
        <div style="font-size:11px;color:#cbbfe0;min-height:42px;margin-top:5px">${locked ? "🔒 Conquer the previous realm" : a.tagline}</div>
        <div style="font-size:11px;color:#8a7aa8;margin-top:6px">${a.waves} waves</div>
      </div>`;
    }).join("");
    this._menu(`
      <div style="text-align:center;max-width:1000px">
        <div style="font-size:34px;font-weight:900;color:${GOLD};margin-bottom:20px;font-family:Georgia,serif">CHOOSE A REALM</div>
        <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">${cards}</div>
        <div id="cf-back" class="cf-btn" style="display:inline-block;margin-top:22px;padding:9px 26px;${frameCss}font-size:14px">← Champions</div>
      </div>`);
    for (const card of this.layerMenu.querySelectorAll(".cf-card")) {
      card.onclick = () => {
        if (card.dataset.locked === "true") { SFX.play("ui"); return; }
        SFX.play("ui_big");
        this.cb.onStart && this.cb.onStart(classId, parseInt(card.dataset.arena, 10));
      };
    }
    this.layerMenu.querySelector("#cf-back").onclick = () => { SFX.play("ui"); this.showClassSelect(); };
  }

  _menu(inner) {
    this.layerMenu.style.display = "flex";
    this.layerMenu.style.cssText += "align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 30%,rgba(60,20,80,.55),rgba(8,4,14,.9));";
    this.layerMenu.innerHTML = inner;
    this.layerGame.style.display = "none";
  }

  hideMenus() { this.layerMenu.style.display = "none"; this.layerGame.style.display = "block"; }

  // ============ IN-GAME HUD ===============================================

  _buildGameHud() {
    const L = this.layerGame;
    // top-left: portrait + hearts + gold
    this.elPortrait = el("div", `position:absolute;top:12px;left:12px;display:flex;gap:10px;align-items:center;`);
    this.elPortrait.innerHTML = `
      <div id="cf-face" style="width:56px;height:56px;border-radius:50%;${frameCss}display:flex;align-items:center;justify-content:center;font-size:30px">⚔️</div>
      <div><div id="cf-hearts" style="font-size:20px;letter-spacing:2px;text-shadow:0 2px 3px #000"></div>
      <div style="font-size:15px;color:${GOLD};font-weight:800;text-shadow:0 2px 3px #000">🪙 <span id="cf-gold">0</span></div></div>`;
    // top-center: score + combo
    this.elScoreWrap = el("div", "position:absolute;top:10px;left:50%;transform:translateX(-50%);text-align:center;");
    this.elScoreWrap.innerHTML = `
      <div id="cf-score" style="font-size:30px;font-weight:900;color:#fff;text-shadow:0 0 12px rgba(232,184,58,.8),0 2px 4px #000;font-family:Georgia,serif">0</div>
      <div id="cf-combo" style="font-size:22px;font-weight:900;color:#ffd24a;text-shadow:0 0 10px rgba(255,150,40,.9),0 2px 3px #000;opacity:0"></div>`;
    // top-right: wave + arena
    this.elWave = el("div", `position:absolute;top:12px;right:12px;text-align:right;${frameCss}padding:8px 14px;`);
    this.elWave.innerHTML = `<div id="cf-wavetxt" style="font-size:19px;font-weight:900">WAVE 1/5</div>
      <div id="cf-arenatxt" style="font-size:12px;color:#b89ae0"></div>`;
    // bottom-right: abilities + basic + mode toggle
    this.elAbil = el("div", "position:absolute;bottom:18px;right:16px;display:flex;gap:12px;align-items:flex-end;pointer-events:auto;");
    // bottom-left joystick zone
    this.elJoyZone = el("div", "position:absolute;bottom:0;left:0;width:45%;height:55%;pointer-events:auto;");
    this.elJoyBase = el("div", `position:absolute;width:110px;height:110px;border-radius:50%;border:2px solid rgba(232,184,58,.5);
      background:radial-gradient(circle,rgba(122,77,207,.25),rgba(20,10,32,.5));display:none;`);
    this.elJoyKnob = el("div", `position:absolute;width:48px;height:48px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe9a8,${GOLD});
      box-shadow:0 0 12px rgba(232,184,58,.8);display:none;`);
    this.elJoyZone.append(this.elJoyBase, this.elJoyKnob);
    // tutorial hint
    this.elHint = el("div", `position:absolute;bottom:120px;left:50%;transform:translateX(-50%);${frameCss}padding:9px 20px;font-size:14px;opacity:0;transition:opacity .4s;text-align:center;max-width:90vw`);
    L.append(this.elPortrait, this.elScoreWrap, this.elWave, this.elAbil, this.elJoyZone, this.elHint);
    this._bindJoystick();
    this._score = 0; this._scoreShown = 0;
  }

  /** build ability buttons for a kit; called on class pick and warrior mode swap */
  setKit(cls, kit, modeIdx, modeCount) {
    this.elAbil.innerHTML = "";
    this._btns = [];
    // mode toggle (warrior only)
    if (modeCount > 1) {
      const tog = el("div", `width:52px;height:52px;border-radius:12px;${frameCss}display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:20px;margin-bottom:6px;`, `${kit.icon}<div style="font-size:8.5px;color:#b89ae0;font-weight:700">TAB</div>`);
      tog.className = "cf-btn";
      tog.onpointerdown = (e) => { e.preventDefault(); this.input.touchToggle(); };
      const wrap = el("div", "display:flex;flex-direction:column;align-items:center;gap:4px;");
      const label = el("div", `font-size:10px;font-weight:800;color:${cls.uiColor};text-shadow:0 1px 2px #000;letter-spacing:.5px`, kit.label.toUpperCase());
      wrap.append(tog, label);
      this.elAbil.appendChild(wrap);
    }
    const mkBtn = (def, idx, big) => {
      const size = big ? 84 : 64;
      const wrap = el("div", `position:relative;width:${size}px;height:${size}px;`);
      const btn = el("div", `position:absolute;inset:0;border-radius:50%;${frameCss}display:flex;align-items:center;justify-content:center;
        font-size:${big ? 34 : 26}px;border-color:${cls.uiColor};`, def.icon || "⚔");
      btn.className = "cf-btn";
      const cd = el("div", `position:absolute;inset:0;border-radius:50%;background:conic-gradient(rgba(8,4,14,.85) 0turn, transparent 0turn);pointer-events:none;`);
      const cdTxt = el("div", `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${big ? 22 : 17}px;font-weight:900;color:#fff;text-shadow:0 0 6px #000;pointer-events:none;opacity:0`);
      const key = el("div", `position:absolute;bottom:-4px;right:-2px;background:#241436;border:1.5px solid ${GOLD};border-radius:6px;font-size:10px;font-weight:800;color:${GOLD};padding:1px 5px;pointer-events:none`, big ? "J" : String(idx + 1));
      wrap.append(btn, cd, cdTxt, key);
      const down = (e) => { e.preventDefault(); big ? this.input.touchBasic(true) : this.input.touchAbility(idx, true); };
      const up = () => { big ? this.input.touchBasic(false) : this.input.touchAbility(idx, false); };
      btn.onpointerdown = down; btn.onpointerup = up; btn.onpointerleave = up;
      this.elAbil.appendChild(wrap);
      return { cd, cdTxt, btn };
    };
    for (let i = 0; i < kit.abilities.length; i++) this._btns.push(mkBtn(kit.abilities[i], i, false));
    this._basicBtn = mkBtn(kit.basic, -1, true);
    this.elFace().textContent = cls.portrait;
  }

  elFace() { return this.elPortrait.querySelector("#cf-face"); }

  /** radial cooldown fill: remaining 0..1 (0 = ready) */
  setCooldowns(rem) {
    for (let i = 0; i < this._btns.length; i++) {
      const b = this._btns[i], r = clamp(rem[i]?.frac ?? 0, 0, 1);
      b.cd.style.background = `conic-gradient(rgba(8,4,14,.85) ${r}turn, transparent ${r}turn)`;
      b.cdTxt.style.opacity = r > 0 ? "1" : "0";
      if (r > 0) b.cdTxt.textContent = rem[i].secs >= 1 ? Math.ceil(rem[i].secs) : rem[i].secs.toFixed(1);
      b.btn.style.filter = r > 0 ? "grayscale(.6) brightness(.8)" : "none";
    }
  }

  setHearts(hp, max) {
    const full = Math.ceil(hp);
    let s = "";
    for (let i = 0; i < max; i++) s += i < full ? "❤️" : "🖤";
    this.elPortrait.querySelector("#cf-hearts").textContent = s;
  }

  setGold(g) { this.elPortrait.querySelector("#cf-gold").textContent = g; }

  setScore(s) { this._score = s; }

  setWave(n, total, arenaName, accent) {
    this.elWave.querySelector("#cf-wavetxt").textContent = `WAVE ${n}/${total}`;
    const a = this.elWave.querySelector("#cf-arenatxt");
    a.textContent = arenaName.toUpperCase();
    a.style.color = accent;
  }

  setCombo(mult, hits) {
    const c = this.elScoreWrap.querySelector("#cf-combo");
    if (mult <= 1) { c.style.opacity = "0"; return; }
    c.style.opacity = "1";
    c.textContent = `${mult}x COMBO`;
    c.style.fontSize = `${Math.min(20 + mult, 40)}px`;
  }

  comboPop(mult) {
    const c = this.elScoreWrap.querySelector("#cf-combo");
    c.style.animation = "none"; void c.offsetWidth; c.style.animation = "cfPop .35s ease-out";
  }

  hint(text, dur = 5) {
    this.elHint.innerHTML = text; this.elHint.style.opacity = "1";
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => { this.elHint.style.opacity = "0"; }, dur * 1000);
  }

  update(dt) {
    // score counts up smoothly
    if (this._scoreShown !== this._score) {
      this._scoreShown += (this._score - this._scoreShown) * Math.min(1, dt * 8);
      if (Math.abs(this._score - this._scoreShown) < 1) this._scoreShown = this._score;
      this.elScoreWrap.querySelector("#cf-score").textContent = formatScore(this._scoreShown);
    }
  }

  // ============ BANNERS / PANELS ==========================================

  banner(text, { color = GOLD, sub = "", dur = 1.6, size = 54 } = {}) {
    const b = el("div", `text-align:center;animation:cfBannerIn .45s ease-out, cfFadeOut .4s ease-in ${dur - 0.4}s forwards;pointer-events:none`);
    b.innerHTML = `<div style="font-size:${size}px;font-weight:900;color:${color};font-family:Georgia,serif;letter-spacing:3px;
      text-shadow:0 0 24px ${color}88,0 4px 8px #000">${text}</div>` +
      (sub ? `<div style="font-size:18px;color:#e8dcc8;margin-top:6px;text-shadow:0 2px 4px #000">${sub}</div>` : "");
    this.layerBanner.appendChild(b);
    setTimeout(() => b.remove(), dur * 1000 + 100);
  }

  callout(text, color = "#ffd24a") {
    const b = el("div", `position:absolute;top:26%;left:50%;transform:translateX(-50%);font-size:30px;font-weight:900;color:${color};
      font-family:Georgia,serif;letter-spacing:2px;text-shadow:0 0 16px ${color}99,0 3px 5px #000;
      animation:cfBannerIn .3s ease-out, cfFadeOut .3s ease-in .75s forwards;pointer-events:none;white-space:nowrap`, text);
    this.layerBanner.appendChild(b);
    setTimeout(() => b.remove(), 1150);
  }

  /** end-of-arena / victory / game-over panel */
  panel({ title, titleColor = GOLD, lines = [], buttons = [] }) {
    this.clearPanel();
    this._panel = el("div", `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);${frameCss}
      padding:34px 46px;text-align:center;pointer-events:auto;animation:cfBannerIn .5s ease-out;min-width:320px;max-width:92vw`);
    this._panel.innerHTML =
      `<div style="font-size:38px;font-weight:900;color:${titleColor};font-family:Georgia,serif;letter-spacing:2px;text-shadow:0 0 18px ${titleColor}66">${title}</div>` +
      lines.map((l) => `<div style="font-size:17px;color:#e8dcc8;margin-top:12px">${l}</div>`).join("") +
      `<div style="display:flex;gap:14px;justify-content:center;margin-top:26px;flex-wrap:wrap">` +
      buttons.map((b, i) => `<div class="cf-btn" data-i="${i}" style="${frameCss}padding:12px 30px;font-size:17px;font-weight:800;${i === 0 ? `animation:cfPulse 2s infinite;` : ""}">${b.label}</div>`).join("") +
      `</div>`;
    this.layerBanner.appendChild(this._panel);
    for (const btn of this._panel.querySelectorAll(".cf-btn"))
      btn.onclick = () => { SFX.play("ui_big"); buttons[parseInt(btn.dataset.i, 10)].fn(); };
  }

  clearPanel() { if (this._panel) { this._panel.remove(); this._panel = null; } }

  // ============ JOYSTICK ==================================================

  _bindJoystick() {
    let active = null, baseX = 0, baseY = 0;
    const zone = this.elJoyZone;
    const MAXR = 46;
    zone.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" && !this.touch) return;
      active = e.pointerId; baseX = e.clientX; baseY = e.clientY;
      zone.setPointerCapture(e.pointerId);
      this.elJoyBase.style.display = this.elJoyKnob.style.display = "block";
      this._joyPlace(baseX, baseY, baseX, baseY);
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== active) return;
      let dx = e.clientX - baseX, dy = e.clientY - baseY;
      const m = Math.hypot(dx, dy);
      if (m > MAXR) { dx = dx / m * MAXR; dy = dy / m * MAXR; }
      this._joyPlace(baseX, baseY, baseX + dx, baseY + dy);
      this.input.setJoystick(dx / MAXR, dy / MAXR);
    });
    const end = (e) => {
      if (e.pointerId !== active) return;
      active = null;
      this.elJoyBase.style.display = this.elJoyKnob.style.display = "none";
      this.input.setJoystick(0, 0);
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  _joyPlace(bx, by, kx, ky) {
    const r = this.root.getBoundingClientRect();
    this.elJoyBase.style.left = `${bx - r.left - 55}px`; this.elJoyBase.style.top = `${by - r.top - 55}px`;
    this.elJoyKnob.style.left = `${kx - r.left - 24}px`; this.elJoyKnob.style.top = `${ky - r.top - 24}px`;
  }
}
