/**
 * Cosmic Coils — runtime/3d/menu.js
 * Main menu overlay drawn above the LIVE attract-mode planet (the real scene
 * idles behind it). Name + skin customization (canvas-drawn coil previews),
 * Practice / Online / Records / How-to panels, biome chips. Profile persists
 * in localStorage.
 */
const V = new URL(import.meta.url).search;
const S = await import("../sim/serpent.js" + V);
const { SKINS, BIOMES } = S;

const css = `
.cc-menu{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;color:#eaf6ff;z-index:40;pointer-events:auto;background:radial-gradient(ellipse at center, rgba(4,8,20,0.25) 0%, rgba(3,5,14,0.78) 100%)}
.cc-card{width:min(560px, 94vw);max-height:94vh;overflow:auto;background:rgba(6,11,26,0.82);border:1px solid rgba(120,200,255,0.25);border-radius:20px;padding:26px 30px;backdrop-filter:blur(10px);box-shadow:0 0 60px rgba(40,140,255,0.18);text-align:center}
.cc-title{font-size:46px;font-weight:900;letter-spacing:6px;background:linear-gradient(90deg,#3af2ff,#a06bff,#ff54d8,#ffd94a);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 18px rgba(120,120,255,0.55))}
.cc-tag{font-size:13px;letter-spacing:3px;opacity:.75;margin:2px 0 18px}
.cc-name{display:flex;gap:10px;justify-content:center;margin-bottom:14px}
.cc-name input{pointer-events:auto;background:rgba(0,0,0,0.45);border:1px solid rgba(140,210,255,0.35);color:#fff;border-radius:10px;padding:10px 14px;font-size:15px;font-weight:700;letter-spacing:1px;text-align:center;width:220px;outline:none}
.cc-name input:focus{border-color:#3af2ff;box-shadow:0 0 12px rgba(58,242,255,0.35)}
.cc-skins{display:flex;align-items:center;gap:12px;justify-content:center;margin-bottom:6px}
.cc-skins canvas{border-radius:14px;background:rgba(0,0,0,0.35);border:1px solid rgba(140,210,255,0.25)}
.cc-arrow{cursor:pointer;border:none;border-radius:10px;width:42px;height:42px;font-size:20px;color:#cfe8ff;background:rgba(255,255,255,0.1)}
.cc-arrow:hover{background:rgba(255,255,255,0.22)}
.cc-skin-name{font-size:13px;font-weight:800;letter-spacing:2px;margin-bottom:14px;opacity:.9}
.cc-modes{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
.cc-mode{cursor:pointer;border:none;border-radius:14px;padding:15px;font-size:17px;font-weight:900;letter-spacing:2px;color:#02121a;background:linear-gradient(135deg,#3af2ff,#6dffb0);box-shadow:0 0 20px rgba(80,230,255,0.35);transition:transform .1s}
.cc-mode:hover{transform:scale(1.03)}
.cc-mode.alt{background:linear-gradient(135deg,#a06bff,#ff54d8);color:#fff;box-shadow:0 0 20px rgba(200,90,255,0.35)}
.cc-mode.ghost{background:rgba(255,255,255,0.08);color:#cfe8ff;box-shadow:none;border:1px solid rgba(160,220,255,0.25);font-size:13px;padding:10px}
.cc-biomes{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:12px}
.cc-biome{font-size:11px;letter-spacing:1px;padding:5px 10px;border-radius:20px;border:1px solid rgba(140,210,255,0.25);opacity:.85}
.cc-foot{font-size:10.5px;opacity:.5;letter-spacing:1px;line-height:1.6}
.cc-sub{position:relative}
.cc-back{position:absolute;left:0;top:0;background:none;border:none;color:#9fd4ff;font-size:14px;cursor:pointer;letter-spacing:1px}
.cc-records{margin:12px 0;text-align:left;font-size:13.5px;line-height:1.9}
.cc-records .r{display:flex;gap:10px}
.cc-records .r span:first-child{width:26px;opacity:.6}
.cc-records .r b{flex:1}
.cc-howto{text-align:left;font-size:13.5px;line-height:1.9;margin:12px 0}
.cc-howto b{color:#7dffce}
`;

function drawSkinPreview(cv, skin) {
  const c = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  c.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2 + 6;
  const A = hexCss(skin.a), B = hexCss(skin.b), GL = hexCss(skin.glow);
  // coiled spiral of orbs
  const n = 22;
  for (let i = n - 1; i >= 0; i--) {
    const t = i / n;
    const ang = 3.6 * Math.PI * t - Math.PI / 2;
    const rad = 8 + t * 34;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad * 0.8;
    const r = 9 - t * 4.5;
    const k = 0.5 + 0.5 * Math.sin(i * 0.8);
    c.beginPath();
    c.fillStyle = mix(A, B, k);
    c.shadowColor = GL; c.shadowBlur = 14;
    c.arc(x, y, r, 0, 6.2832); c.fill();
  }
  // head + eyes
  c.shadowBlur = 18; c.shadowColor = GL;
  c.beginPath(); c.fillStyle = A; c.arc(cx, cy - 2, 11, 0, 6.2832); c.fill();
  c.shadowBlur = 0;
  c.fillStyle = "#fff";
  c.beginPath(); c.arc(cx - 4.5, cy - 6, 3.4, 0, 6.2832); c.fill();
  c.beginPath(); c.arc(cx + 4.5, cy - 6, 3.4, 0, 6.2832); c.fill();
  c.fillStyle = "#101018";
  c.beginPath(); c.arc(cx - 4, cy - 6.6, 1.7, 0, 6.2832); c.fill();
  c.beginPath(); c.arc(cx + 5, cy - 6.6, 1.7, 0, 6.2832); c.fill();
}
function hexCss(n) { return "#" + n.toString(16).padStart(6, "0"); }
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

export function loadRecords() {
  try { return JSON.parse(localStorage.getItem("cc_records") || "[]"); } catch (e) { return []; }
}
export function saveRecord(rec) {
  const list = loadRecords();
  list.push(rec);
  list.sort((a, b) => b.len - a.len);
  const top = list.slice(0, 10);
  try { localStorage.setItem("cc_records", JSON.stringify(top)); } catch (e) {}
  return top;
}

export class Menu {
  constructor(container, audio, handlers) {
    this.audio = audio;
    this.h = handlers;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this._style = style;
    this.root = document.createElement("div");
    this.root.className = "cc-menu";
    container.appendChild(this.root);
    this.profile = {
      name: localStorage.getItem("cc_name") || "",
      skinId: parseInt(localStorage.getItem("cc_skin") || "0", 10) % SKINS.length,
    };
    this._page = "main";
    this.render();
  }

  getProfile() {
    const name = (this.profile.name || "").trim() || "Serpent-" + Math.floor(Math.random() * 900 + 100);
    return { name: name.slice(0, 14), skinId: this.profile.skinId };
  }

  show(page = "main") { this._page = page; this.root.style.display = "flex"; this.render(); }
  hide() { this.root.style.display = "none"; }

  render() {
    const p = this._page;
    if (p === "main") this._renderMain();
    else if (p === "records") this._renderRecords();
    else if (p === "settings") this._renderSettings();
    else if (p === "how") this._renderHow();
  }

  _renderSettings() {
    const st = this.h.getSettings ? this.h.getSettings() : { sens: 1.3, invert: false, quality: "high" };
    this.root.innerHTML = `
      <div class="cc-card cc-sub">
        <button class="cc-back" data-a="back">‹ BACK</button>
        <div class="cc-title" style="font-size:30px">SETTINGS</div>
        <div class="cc-tag">SAVED ON THIS DEVICE</div>
        <div style="text-align:left;display:flex;flex-direction:column;gap:16px;margin:14px 4px">
          <label style="display:flex;align-items:center;gap:12px;font-size:13px;letter-spacing:1px">
            MOUSE SENSITIVITY
            <input type="range" min="0.5" max="2.5" step="0.05" value="${st.sens}" data-a="sens" style="flex:1;accent-color:#3af2ff">
            <b data-a="sensval" style="width:38px;text-align:right">${Number(st.sens).toFixed(2)}</b>
          </label>
          <label style="display:flex;align-items:center;gap:12px;font-size:13px;letter-spacing:1px;cursor:pointer">
            <input type="checkbox" ${st.invert ? "checked" : ""} data-a="invert" style="accent-color:#3af2ff;width:17px;height:17px">
            INVERT STEERING (mouse + touch)
          </label>
          <div style="display:flex;align-items:center;gap:12px;font-size:13px;letter-spacing:1px">
            GRAPHICS
            <button class="cc-mode ghost" style="flex:1;padding:8px;${st.quality === "low" ? "border-color:#3af2ff;color:#3af2ff" : ""}" data-a="qlow">LOW</button>
            <button class="cc-mode ghost" style="flex:1;padding:8px;${st.quality === "medium" ? "border-color:#3af2ff;color:#3af2ff" : ""}" data-a="qmed">MEDIUM</button>
            <button class="cc-mode ghost" style="flex:1;padding:8px;${st.quality !== "low" && st.quality !== "medium" ? "border-color:#3af2ff;color:#3af2ff" : ""}" data-a="qhigh">HIGH</button>
          </div>
          <label style="display:flex;align-items:center;gap:12px;font-size:13px;letter-spacing:1px">
            MUSIC
            <input type="range" min="0" max="1" step="0.05" value="${this.audio.musicVol}" data-a="mv" style="flex:1;accent-color:#3af2ff">
          </label>
          <label style="display:flex;align-items:center;gap:12px;font-size:13px;letter-spacing:1px">
            SFX
            <input type="range" min="0" max="1" step="0.05" value="${this.audio.sfxVol}" data-a="sv" style="flex:1;accent-color:#3af2ff">
          </label>
        </div>
        <div style="font-size:11px;opacity:.55;line-height:1.7;text-align:left">Higher sensitivity = the snake turns at full rate with the cursor closer to the center of the screen. Keyboard A/D always steers at full rate.</div>
      </div>`;
    this.root.querySelector('[data-a="back"]').onclick = () => { this.audio.ui(); this.show("main"); };
    const sensEl = this.root.querySelector('[data-a="sens"]');
    sensEl.oninput = (e) => {
      const v = parseFloat(e.target.value);
      this.root.querySelector('[data-a="sensval"]').textContent = v.toFixed(2);
      if (this.h.onSettings) this.h.onSettings({ sens: v });
    };
    this.root.querySelector('[data-a="invert"]').onchange = (e) => { if (this.h.onSettings) this.h.onSettings({ invert: e.target.checked }); };
    this.root.querySelector('[data-a="qhigh"]').onclick = () => { this.audio.ui(); if (this.h.onSettings) this.h.onSettings({ quality: "high" }); this.render(); };
    this.root.querySelector('[data-a="qmed"]').onclick = () => { this.audio.ui(); if (this.h.onSettings) this.h.onSettings({ quality: "medium" }); this.render(); };
    this.root.querySelector('[data-a="qlow"]').onclick = () => { this.audio.ui(); if (this.h.onSettings) this.h.onSettings({ quality: "low" }); this.render(); };
    this.root.querySelector('[data-a="mv"]').oninput = (e) => this.audio.setMusicVol(parseFloat(e.target.value));
    this.root.querySelector('[data-a="sv"]').oninput = (e) => this.audio.setSfxVol(parseFloat(e.target.value));
  }

  _renderMain() {
    const skin = SKINS[this.profile.skinId];
    this.root.innerHTML = `
      <div class="cc-card">
        <div class="cc-title">COSMIC COILS</div>
        <div class="cc-tag">EAT · GROW · RULE THE PLANET</div>
        <div class="cc-name"><input maxlength="14" placeholder="your serpent's name" value="${esc(this.profile.name)}"></div>
        <div class="cc-skins">
          <button class="cc-arrow" data-a="prev">‹</button>
          <canvas width="120" height="120"></canvas>
          <button class="cc-arrow" data-a="next">›</button>
        </div>
        <div class="cc-skin-name">${esc(skin.name).toUpperCase()} <span style="opacity:.5">· skin ${this.profile.skinId + 1}/${SKINS.length}</span></div>
        <div class="cc-modes">
          <button class="cc-mode" data-a="practice">▶ &nbsp;PRACTICE VS AI</button>
          <button class="cc-mode alt" data-a="online">🌐 &nbsp;PLAY ONLINE</button>
          <div style="display:flex;gap:10px">
            <button class="cc-mode ghost" style="flex:1" data-a="records">🏆 RECORDS</button>
            <button class="cc-mode ghost" style="flex:1" data-a="settings">⚙️ SETTINGS</button>
            <button class="cc-mode ghost" style="flex:1" data-a="how">❓ HOW TO</button>
          </div>
        </div>
        <div class="cc-biomes">${BIOMES.map((b) => `<span class="cc-biome">${{ verdant: "🌿 Verdant", ember: "🌋 Ember", glacier: "❄️ Glacier", dune: "🏜️ Dune", abyss: "🔮 Abyss" }[b]}</span>`).join("")}</div>
        <div class="cc-foot">every match spawns on a random living planet · dynamic weather · real online multiplayer<br>original xAI-generated worlds · fully procedural score · a ForgeFlow Games original</div>
      </div>`;
    const cv = this.root.querySelector("canvas");
    drawSkinPreview(cv, skin);
    this.root.querySelector("input").oninput = (e) => {
      this.profile.name = e.target.value;
      localStorage.setItem("cc_name", this.profile.name);
    };
    this.root.querySelector('[data-a="prev"]').onclick = () => this._cycleSkin(-1);
    this.root.querySelector('[data-a="next"]').onclick = () => this._cycleSkin(1);
    this.root.querySelector('[data-a="practice"]').onclick = () => { this.audio.start(); this.audio.ui(); this.h.onPractice(); };
    this.root.querySelector('[data-a="online"]').onclick = () => { this.audio.start(); this.audio.ui(); this.h.onOnline(); };
    this.root.querySelector('[data-a="records"]').onclick = () => { this.audio.ui(); this.show("records"); };
    this.root.querySelector('[data-a="settings"]').onclick = () => { this.audio.ui(); this.show("settings"); };
    this.root.querySelector('[data-a="how"]').onclick = () => { this.audio.ui(); this.show("how"); };
  }

  _cycleSkin(d) {
    this.audio.ui();
    this.profile.skinId = (this.profile.skinId + d + SKINS.length) % SKINS.length;
    localStorage.setItem("cc_skin", String(this.profile.skinId));
    this.render();
  }

  _renderRecords() {
    const recs = loadRecords();
    this.root.innerHTML = `
      <div class="cc-card cc-sub">
        <button class="cc-back" data-a="back">‹ BACK</button>
        <div class="cc-title" style="font-size:30px">RECORDS</div>
        <div class="cc-tag">YOUR LONGEST COILS (THIS DEVICE)</div>
        <div class="cc-records">${recs.length ? recs.map((r, i) => `<div class="r"><span>${i + 1}.</span><b>${esc(r.name)}</b><span>${r.len}</span><span style="opacity:.55">${{ verdant: "🌿", ember: "🌋", glacier: "❄️", dune: "🏜️", abyss: "🔮" }[r.biome] || ""} ${r.mode === "online" ? "🌐" : "🤖"}</span></div>`).join("") : `<div style="opacity:.6;text-align:center">no records yet — go grow a legend</div>`}</div>
      </div>`;
    this.root.querySelector('[data-a="back"]').onclick = () => { this.audio.ui(); this.show("main"); };
  }

  _renderHow() {
    this.root.innerHTML = `
      <div class="cc-card cc-sub">
        <button class="cc-back" data-a="back">‹ BACK</button>
        <div class="cc-title" style="font-size:30px">HOW TO PLAY</div>
        <div class="cc-howto">
          🐍 <b>Steer with the mouse</b> — your serpent always slithers forward, curving around a tiny planet. <b>A/D</b> also steer.<br>
          💎 <b>Eat glowing gems</b> to grow longer and thicker. Gold and pink gems are worth more.<br>
          ⚡ <b>Hold W, LMB or SPACE to boost</b> — speed builds up the longer you hold, burning mass and leaking pellets. Too small to burn? No boost — grow first.<br>
          🐌 <b>S or RMB eases you down</b> for tight maneuvers · <b>mouse wheel zooms</b> the camera · tune mouse feel in ⚙️ SETTINGS.<br>
          ☠️ <b>Head-first into ANY body = death — including your own coils.</b> Cut rivals off so THEY hit YOU. Fallen serpents burst into glowing essence — feast on it.<br>
          🌦 <b>Weather is real</b>: storms shrink visibility, change handling, and shower the planet with bonus gems.<br>
          🛡 You spawn with a 3s shield. New planet, new weather, every match.<br>
          🌐 <b>Online</b>: share a room code or join the public arena — joining players take over AI serpents live.
        </div>
      </div>`;
    this.root.querySelector('[data-a="back"]').onclick = () => { this.audio.ui(); this.show("main"); };
  }

  dispose() { this.root.remove(); this._style.remove(); }
}
