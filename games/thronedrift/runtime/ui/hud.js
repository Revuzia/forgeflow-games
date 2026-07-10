// Thronedrift — DOM HUD + menus.
// Premium gold/purple frame language. Radial cooldowns are conic-gradient
// overlays on circular buttons. Touch joystick + ability buttons pipe into
// the shared Input object. All screens are DOM (crisp text, no canvas UI).

import { CLASSES } from "../data/abilities.js";
import { ARENAS } from "../data/arenas.js";
import { ALL_TYPES } from "../data/enemies.js";
import { formatScore, clamp, save } from "../core/util.js";
import { SFX } from "../core/audio.js";
import { Music } from "../core/music.js";

const TITLE = "THRONEDRIFT";
const TAGLINE = "Five drifting thrones. One champion. Endless waves.";
const BESTIARY_FACES = {
  imp: "👺", skeleton: "💀", brute: "🧌",
  slime: "🟢", bat: "🦇", yeti: "🦍",
  spider: "🕷️", gargoyle: "🗿", wisp: "💠",
  zombie: "🧟", skull: "☠️", ghost: "👻",
  orc: "👹", myconid: "🍄", cyclops: "👁️",
  vulkar: "👿", boreas: "🧊", skalvyrn: "🐲",
  zhymoth: "🐙", aurex: "🥷",
};

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
      @keyframes cfKenBurns { 0%{transform:scale(1)} 100%{transform:scale(1.07)} }
      @keyframes cfToastIn { 0%{transform:translate(-50%,-16px);opacity:0} 12%{transform:translate(-50%,0);opacity:1} 85%{transform:translate(-50%,0);opacity:1} 100%{transform:translate(-50%,-10px);opacity:0} }
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
    // transparent menu over the LIVE 3D champion showcase — click a champion
    // card (aligned under each hero) to enter; no separate PLAY step
    const cards = Object.entries(CLASSES).map(([id, c]) => {
      const kitLine = c.modes
        ? "Two-Handed \u21C4 Sword & Shield \u00B7 true Block"
        : Object.values(c.kits)[0].abilities.map((a) => a.name).join(" \u00B7 ");
      return `
      <div class="cf-card" data-cls="${id}" style="${frameCss}width:min(240px,29vw);padding:12px 12px 14px;text-align:center;background:rgba(14,7,22,.72)">
        <div style="font-size:20px;font-weight:900;color:${c.uiColor}">${c.portrait} ${c.name.toUpperCase()}</div>
        <div style="font-size:11.5px;color:#cbbfe0;min-height:34px;margin-top:5px">${kitLine}</div>
        <div style="font-size:11px;color:#8a7aa8;margin-top:4px">${"\u2764".repeat(c.hearts)}</div>
        <div style="margin-top:7px;font-size:12px;font-weight:800;color:#ffd24a;letter-spacing:1px;animation:cfPulse 2s infinite;border:1.5px solid #e8b83a;border-radius:8px;padding:5px 0">ENTER THE DRIFT</div>
      </div>`;
    }).join("");
    this._menuClear(`
      <div style="position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:space-between;height:100%;width:100%;padding:18px 10px 16px;box-sizing:border-box">
        <div style="text-align:center;animation:cfPop .5s ease-out">
          <div style="font-size:13px;letter-spacing:7px;color:#cdb8ee;text-shadow:0 2px 6px #000">FORGEFLOW GAMES</div>
          <div style="font-size:min(52px,10.5vw);font-weight:900;letter-spacing:4px;line-height:1;
            background:linear-gradient(180deg,#ffe9a8 0%,#e8b83a 45%,#c88a3a 70%,#9a5dff 115%);
            -webkit-background-clip:text;background-clip:text;color:transparent;
            filter:drop-shadow(0 4px 14px rgba(0,0,0,.9));font-family:Georgia,serif">${TITLE}</div>
          <div style="font-size:14px;color:#e8dcc8;margin-top:6px;text-shadow:0 2px 5px #000">${TAGLINE}</div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap;max-width:94vw">
            <div id="cf-bestiary" class="cf-btn" style="padding:8px 16px;${frameCss}font-size:12.5px;font-weight:700">\uD83D\uDCD6 BESTIARY</div>
            <div id="cf-howto" class="cf-btn" style="padding:8px 16px;${frameCss}font-size:12.5px;font-weight:700">\uD83C\uDFAE HOW TO PLAY</div>
            <div id="cf-settings" class="cf-btn" style="padding:8px 16px;${frameCss}font-size:12.5px;font-weight:700">\u2699\uFE0F SETTINGS</div>
          </div>
        </div>
        <div style="width:100%;max-width:900px;display:flex;justify-content:space-between;gap:10px;align-items:flex-end">
          ${cards}
        </div>
      </div>`);
    for (const card of this.layerMenu.querySelectorAll(".cf-card"))
      card.onclick = () => { SFX.unlock(); SFX.play("ui_big"); this.showArenaSelect(card.dataset.cls); };
    this.layerMenu.querySelector("#cf-bestiary").onclick = () => { SFX.unlock(); SFX.play("ui"); this.showBestiary(); };
    this.layerMenu.querySelector("#cf-howto").onclick = () => { SFX.unlock(); SFX.play("ui"); this.showHowTo(); };
    this.layerMenu.querySelector("#cf-settings").onclick = () => { SFX.unlock(); SFX.play("ui"); this.showSettings(); };
  }

  showSettings() {
    const vol = Math.round((save.get("set_vol", 0.5)) * 100);
    const shake = save.get("set_shake", true), dmg = save.get("set_dmgnum", true);
    const tog = (id, label, on) => `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
        <span style="font-size:15px;color:#e8dcc8">${label}</span>
        <div id="${id}" class="cf-btn" data-on="${on}" style="${frameCss}padding:6px 18px;font-size:13px;font-weight:800;color:${on ? "#7dff9a" : "#8a7aa8"}">${on ? "ON" : "OFF"}</div>
      </div>`;
    this._menu(`
      <div style="${frameCss}width:min(420px,90vw);padding:26px 30px;position:relative;z-index:2">
        <div style="font-size:28px;font-weight:900;color:${GOLD};text-align:center;font-family:Georgia,serif;margin-bottom:8px">SETTINGS</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
          <span style="font-size:15px;color:#e8dcc8">Sound volume</span>
          <input id="cf-vol" type="range" min="0" max="100" value="${vol}" style="width:150px;accent-color:#e8b83a">
        </div>
        ${tog("cf-shake", "Screen shake", shake)}
        ${tog("cf-dmg", "Damage numbers", dmg)}
        <div id="cf-reset" class="cf-btn" style="margin-top:22px;text-align:center;${frameCss}padding:9px 0;font-size:13px;font-weight:800;color:#ff8a8a;border-color:#a04040">RESET PROGRESS</div>
        <div id="cf-back" class="cf-btn" style="display:block;margin:16px auto 0;width:130px;text-align:center;padding:9px 0;${frameCss}font-size:14px;font-weight:700">\u2190 BACK</div>
      </div>`);
    const M = this.layerMenu;
    M.querySelector("#cf-vol").oninput = (e) => { const v = e.target.value / 100; save.set("set_vol", v); SFX.setVolume(v); Music.setVolume(v); SFX.play("ui"); };
    const wireTog = (id, key) => {
      const b = M.querySelector(id);
      b.onclick = () => {
        const on = !(b.dataset.on === "true");
        b.dataset.on = String(on); b.textContent = on ? "ON" : "OFF"; b.style.color = on ? "#7dff9a" : "#8a7aa8";
        save.set(key, on); this.cb.onSettings && this.cb.onSettings(key.replace("set_", "") === "shake" ? "shake" : "dmgNum", on);
        SFX.play("ui");
      };
    };
    wireTog("#cf-shake", "set_shake");
    wireTog("#cf-dmg", "set_dmgnum");
    const rst = M.querySelector("#cf-reset");
    rst.onclick = () => {
      if (rst.dataset.armed) {
        for (const k of ["unlocked", "hiscore", "bestiary"]) save.set(k, k === "unlocked" ? 1 : k === "hiscore" ? 0 : []);
        rst.textContent = "PROGRESS RESET"; rst.dataset.armed = ""; SFX.play("ui_big");
      } else { rst.dataset.armed = "1"; rst.textContent = "CLICK AGAIN TO CONFIRM"; SFX.play("ui"); }
    };
    M.querySelector("#cf-back").onclick = () => { SFX.play("ui"); this.showTitle(); };
  }

  showBestiary() {
    const discovered = new Set(save.get("bestiary", []));
    const cards = Object.entries(ALL_TYPES).map(([id, d]) => {
      const known = discovered.has(id);
      const portrait = known && this.cb.portrait ? this.cb.portrait(id) : null;
      const face = portrait
        ? `<img src="${portrait}" style="width:92px;height:92px;border-radius:12px;border:2px solid rgba(232,184,58,.4);object-fit:cover">`
        : `<div style="font-size:40px">${BESTIARY_FACES[id] || "❔"}</div>`;
      return known ? `
        <div style="${frameCss}width:196px;padding:14px 12px;text-align:center">
          ${face}
          <div style="font-size:16px;font-weight:900;color:${d.boss ? "#ff6a8a" : "#ffd24a"};margin-top:4px">${d.name}</div>
          <div style="font-size:11px;letter-spacing:1.5px;color:${d.boss ? "#ff9ab0" : "#b89ae0"}">${d.role.toUpperCase()} · REALM ${d.realm}</div>
          <div style="font-size:11.5px;color:#cbbfe0;font-style:italic;min-height:56px;margin-top:7px">"${d.lore}"</div>
          <div style="display:flex;justify-content:space-around;margin-top:8px;font-size:11px;color:#e8dcc8">
            <span>❤️ ${d.hp}</span><span>⚔️ ${d.dmg}</span><span>👟 ${d.speed}</span></div>
        </div>` : `
        <div style="${frameCss}width:196px;padding:14px 12px;text-align:center;opacity:.5;filter:grayscale(.8)">
          <div style="font-size:40px">❔</div>
          <div style="font-size:17px;font-weight:900;color:#8a7aa8;margin-top:4px">???</div>
          <div style="font-size:11px;letter-spacing:1.5px;color:#6a5a88">UNDISCOVERED</div>
          <div style="font-size:11.5px;color:#8a7aa8;font-style:italic;min-height:56px;margin-top:7px">Face this foe in the arenas to record it.</div>
          <div style="height:16px"></div>
        </div>`;
    }).join("");
    this._menu(`
      <div style="text-align:center;max-width:1100px;position:relative;z-index:2">
        <div style="font-size:34px;font-weight:900;color:${GOLD};margin-bottom:6px;font-family:Georgia,serif">BESTIARY</div>
        <div style="font-size:13px;color:#b89ae0;margin-bottom:18px">${discovered.size} / ${Object.keys(ALL_TYPES).length} foes recorded · 3 foes + 1 boss per realm</div>
        <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;max-height:62vh;overflow-y:auto;padding:4px">${cards}</div>
        <div id="cf-back" class="cf-btn" style="display:inline-block;margin-top:20px;padding:10px 30px;${frameCss}font-size:15px;font-weight:700">← BACK</div>
      </div>`);
    this.layerMenu.querySelector("#cf-back").onclick = () => { SFX.play("ui"); this.showTitle(); };
  }

  showHowTo() {
    this._menu(`
      <div style="${frameCss}max-width:560px;padding:26px 34px;position:relative;z-index:2">
        <div style="font-size:28px;font-weight:900;color:${GOLD};text-align:center;font-family:Georgia,serif;margin-bottom:14px">HOW TO PLAY</div>
        <div style="font-size:14px;line-height:1.9;color:#e8dcc8">
          <b style="color:#ffd24a">Move</b> — WASD / arrows, or the left touch joystick<br>
          <b style="color:#ffd24a">Attack</b> — J / Space / Left-click (spam away — click also aims)<br>
          <b style="color:#ffd24a">Abilities</b> — 1 · 2 · 3, or the buttons bottom-right<br>
          <b style="color:#ffd24a">Warrior mode swap</b> — TAB: Two-Handed ⇄ Sword & Shield<br>
          <b style="color:#ffd24a">Block</b> — HOLD 3 in Sword & Shield · perfect timing = stun pulse<br>
          <b style="color:#ffd24a">Camera</b> — scroll to zoom · right-drag to rotate<br>
          <b style="color:#ffd24a">Pause</b> — ESC
          <hr style="border-color:rgba(232,184,58,.25);margin:10px 0">
          <b style="color:#b0a0ff">SHOCK</b> stuns · <b style="color:#ff8a3a">BURN</b> melts over time · <b style="color:#8ae0ff">FROST</b> slows.
          Fire and frost linger on the ground — herd enemies through them.
          Chain hits fast to grow your <b style="color:#ffd24a">combo multiplier</b> up to 32×.
          Clear every wave, conquer all five thrones, claim the crown.
        </div>
        <div id="cf-back" class="cf-btn" style="display:block;margin:18px auto 0;width:140px;text-align:center;padding:10px 0;${frameCss}font-size:15px;font-weight:700">← BACK</div>
      </div>`);
    this.layerMenu.querySelector("#cf-back").onclick = () => { SFX.play("ui"); this.showTitle(); };
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
    const unlocked = save.get("unlocked", 1);
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

  _menuClear(inner) {
    // transparent menu: light vignette only — the live 3D scene shows through
    this.layerMenu.style.display = "flex";
    this.layerMenu.style.cssText += "align-items:center;justify-content:center;";
    this.layerMenu.innerHTML = `
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 42%,transparent 34%,rgba(8,4,14,.62) 100%)"></div>` + inner;
    this.layerGame.style.display = "none";
  }

  _menu(inner) {
    this.layerMenu.style.display = "flex";
    this.layerMenu.style.cssText += "align-items:center;justify-content:center;";
    // house menu pattern: full-bleed key art + Ken Burns drift + radial/linear scrim
    this.layerMenu.innerHTML = `
      <div style="position:absolute;inset:0;background:url(menu_bg.png?v=4) center/cover no-repeat,
        radial-gradient(ellipse at 50% 30%,#2a1038,#0b0710 75%);animation:cfKenBurns 36s ease-in-out infinite alternate"></div>
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(8,4,14,.28) 0%,rgba(8,4,14,.82) 100%),
        linear-gradient(rgba(10,6,20,.30),rgba(10,6,20,.72))"></div>` + inner;
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
    // bottom-right: ability cluster (industry-standard diamond: big basic in the
    // corner, three specials arced around it — NOT a flat row)
    this.elAbil = el("div", "position:absolute;bottom:48px;right:14px;width:196px;height:196px;pointer-events:auto;"); // 48px clears the game_controls bar (fullscreen/mute) in the corner
    // bottom-left: warrior weapon-mode toggle lives by the movement thumb
    this.elToggle = el("div", "position:absolute;bottom:170px;left:18px;pointer-events:auto;display:none;");
    // toast (bestiary discoveries etc.)
    this.elToast = el("div", "position:absolute;top:74px;left:50%;transform:translateX(-50%);pointer-events:none;");
    // bottom-left joystick zone
    this.elJoyZone = el("div", "position:absolute;bottom:0;left:0;width:45%;height:55%;pointer-events:auto;");
    this.elJoyBase = el("div", `position:absolute;width:110px;height:110px;border-radius:50%;border:2px solid rgba(232,184,58,.5);
      background:radial-gradient(circle,rgba(122,77,207,.25),rgba(20,10,32,.5));display:none;`);
    this.elJoyKnob = el("div", `position:absolute;width:48px;height:48px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe9a8,${GOLD});
      box-shadow:0 0 12px rgba(232,184,58,.8);display:none;`);
    this.elJoyZone.append(this.elJoyBase, this.elJoyKnob);
    // tutorial hint
    this.elHint = el("div", `position:absolute;bottom:120px;left:50%;transform:translateX(-50%);${frameCss}padding:9px 20px;font-size:14px;opacity:0;transition:opacity .4s;text-align:center;max-width:90vw`);
    L.append(this.elPortrait, this.elScoreWrap, this.elWave, this.elAbil, this.elToggle, this.elToast, this.elJoyZone, this.elHint);
    this._bindJoystick();
    this._score = 0; this._scoreShown = 0;
  }

  /** build ability buttons for a kit; called on class pick and warrior mode swap */
  setKit(cls, kit, modeIdx, modeCount) {
    this.elAbil.innerHTML = "";
    this._btns = [];
    // diamond cluster positions (px from the container's bottom-right)
    const SLOTS = [{ r: 104, b: 0 }, { r: 88, b: 88 }, { r: 0, b: 104 }];
    const mkBtn = (def, idx, big) => {
      const size = big ? 86 : 62;
      const pos = big ? { r: 0, b: 0 } : SLOTS[idx];
      const wrap = el("div", `position:absolute;right:${pos.r}px;bottom:${pos.b}px;width:${size}px;height:${size}px;`);
      const btn = el("div", `position:absolute;inset:0;border-radius:50%;${frameCss}display:flex;align-items:center;justify-content:center;
        font-size:${big ? 36 : 25}px;border-color:${cls.uiColor};`, def.icon || "⚔");
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
    // weapon-mode toggle: bottom-LEFT, by the movement thumb (warrior only)
    if (modeCount > 1) {
      this.elToggle.style.display = "block";
      this.elToggle.innerHTML = "";
      const tog = el("div", `width:58px;height:58px;border-radius:14px;${frameCss}display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:22px;border-color:${cls.uiColor}`, `${kit.icon}<div style="font-size:8.5px;color:#b89ae0;font-weight:700">TAB</div>`);
      tog.className = "cf-btn";
      tog.onpointerdown = (e) => { e.preventDefault(); this.input.touchToggle(); };
      const label = el("div", `margin-top:4px;text-align:center;font-size:10px;font-weight:800;color:${cls.uiColor};text-shadow:0 1px 2px #000;letter-spacing:.5px`, kit.label.toUpperCase());
      this.elToggle.append(tog, label);
    } else this.elToggle.style.display = "none";
    this.elFace().textContent = cls.portrait;
  }

  /** short top toast (bestiary discoveries, etc.) */
  toast(text, color = "#8ae0ff") {
    const t = el("div", `${frameCss}padding:8px 18px;font-size:14px;font-weight:800;color:${color};white-space:nowrap;
      position:absolute;left:50%;animation:cfToastIn 2.6s ease forwards;`, text);
    this.elToast.appendChild(t);
    setTimeout(() => t.remove(), 2700);
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
    // hearts DRAIN smoothly (animated fill, no stepped halves): persistent
    // spans whose colored overlay width transitions on every change
    const elH = this.elPortrait.querySelector("#cf-hearts");
    if (!this._heartFills || this._heartFills.length !== max) {
      elH.innerHTML = "";
      this._heartFills = [];
      for (let i = 0; i < max; i++) {
        const wrap = document.createElement("span");
        wrap.style.cssText = "position:relative;display:inline-block;width:22px";
        wrap.innerHTML = `<span style="filter:grayscale(1) brightness(.35)">❤️</span>`;
        const fill = document.createElement("span");
        fill.style.cssText = "position:absolute;left:0;top:0;overflow:hidden;width:100%;white-space:nowrap;transition:width .45s ease";
        fill.textContent = "❤️";
        wrap.appendChild(fill);
        elH.appendChild(wrap);
        this._heartFills.push(fill);
      }
    }
    for (let i = 0; i < max; i++)
      this._heartFills[i].style.width = `${Math.round(clamp(hp - i, 0, 1) * 100)}%`;
    if (elH.dataset.prev && parseFloat(elH.dataset.prev) > hp) {
      elH.style.animation = "none"; void elH.offsetWidth; elH.style.animation = "cfPop .3s ease-out";
    }
    elH.dataset.prev = String(hp);
  }

  /** boss health bar (top-center, under the score) — null hides it */
  setBoss(name, frac) {
    if (!this._bossBar) {
      this._bossBar = el("div", `position:absolute;top:78px;left:50%;transform:translateX(-50%);width:min(460px,72vw);display:none;text-align:center;`);
      this._bossBar.innerHTML = `<div id="cf-bossname" style="font-size:14px;font-weight:900;color:#ff9ab0;letter-spacing:2px;text-shadow:0 2px 4px #000"></div>
        <div style="height:12px;border:2px solid #e8b83a;border-radius:7px;background:rgba(10,4,16,.8);overflow:hidden;margin-top:3px">
        <div id="cf-bossfill" style="height:100%;width:100%;background:linear-gradient(90deg,#ff2a4a,#ff7a3a);transition:width .2s"></div></div>`;
      this.layerGame.appendChild(this._bossBar);
    }
    if (name == null) { this._bossBar.style.display = "none"; return; }
    this._bossBar.style.display = "block";
    this._bossBar.querySelector("#cf-bossname").textContent = name.toUpperCase();
    this._bossBar.querySelector("#cf-bossfill").style.width = `${Math.round(clamp(frac, 0, 1) * 100)}%`;
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
