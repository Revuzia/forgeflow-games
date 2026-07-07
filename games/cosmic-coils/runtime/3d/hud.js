/**
 * Cosmic Coils — runtime/3d/hud.js
 * DOM overlay: length/kills, live leaderboard, boost meter, weather chip,
 * kill feed, toasts, circular minimap (azimuthal projection around the player),
 * death screen and pause menu. All pointer-events:none except real controls.
 */
const V = new URL(import.meta.url).search;
const S = await import("../sim/serpent.js" + V);
const { SKINS, ranking, angDist, CONST } = S;

const css = `
.cc-hud{position:absolute;inset:0;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;color:#eaf6ff;user-select:none;overflow:hidden}
.cc-panel{background:rgba(5,10,24,0.55);border:1px solid rgba(120,200,255,0.22);border-radius:12px;backdrop-filter:blur(5px)}
.cc-score{position:absolute;top:12px;left:12px;padding:10px 16px;line-height:1.25}
.cc-score .len{font-size:26px;font-weight:900;letter-spacing:1px;text-shadow:0 0 12px rgba(90,240,255,0.75)}
.cc-score .sub{font-size:12px;opacity:.8}
.cc-lb{position:absolute;top:12px;right:12px;padding:8px 12px;min-width:190px}
.cc-lb h4{font-size:11px;letter-spacing:2px;opacity:.7;margin-bottom:5px}
.cc-lb .row{display:flex;gap:6px;font-size:12.5px;line-height:1.55;align-items:center}
.cc-lb .row .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-lb .row .ln{font-weight:700;font-variant-numeric:tabular-nums}
.cc-lb .row.me{color:#7dffce;font-weight:800;text-shadow:0 0 8px rgba(80,255,190,.6)}
.cc-lb .dot{width:7px;height:7px;border-radius:50%;flex:none}
.cc-weather{position:absolute;top:12px;left:50%;transform:translateX(-50%);padding:7px 16px;font-size:13px;font-weight:700;letter-spacing:1px;display:flex;gap:8px;align-items:center;transition:box-shadow .5s, border-color .5s}
.cc-weather.active{border-color:rgba(255,220,120,.6);box-shadow:0 0 18px rgba(255,200,80,.25);animation:ccpulse 2s infinite}
@keyframes ccpulse{50%{box-shadow:0 0 26px rgba(255,200,80,.45)}}
.cc-boost{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:230px;padding:7px 10px 9px}
.cc-boost .bar{height:9px;border-radius:5px;background:rgba(255,255,255,0.08);overflow:hidden}
.cc-boost .fill{height:100%;border-radius:5px;background:linear-gradient(90deg,#39f0ff,#ff54d8);transition:width .12s;box-shadow:0 0 10px rgba(120,220,255,.7)}
.cc-boost .lbl{font-size:10px;letter-spacing:2px;opacity:.7;text-align:center;margin-top:4px}
.cc-feed{position:absolute;right:12px;top:225px;display:flex;flex-direction:column;gap:4px;align-items:flex-end}
.cc-feed .k{font-size:12px;padding:4px 10px;border-radius:8px;background:rgba(5,10,24,0.6);border:1px solid rgba(255,120,120,0.25);animation:ccfeed 4.5s forwards}
@keyframes ccfeed{0%{opacity:0;transform:translateX(18px)}8%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}
.cc-toasts{position:absolute;left:50%;top:26%;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center}
.cc-toast{font-size:17px;font-weight:800;letter-spacing:1px;padding:7px 18px;border-radius:10px;background:rgba(5,10,24,0.55);border:1px solid rgba(120,255,200,0.3);text-shadow:0 0 10px rgba(120,255,200,.8);animation:cctoast 2.6s forwards}
.cc-toast.warn{border-color:rgba(255,200,90,.45);text-shadow:0 0 10px rgba(255,200,90,.8)}
.cc-toast.bad{border-color:rgba(255,90,90,.45);text-shadow:0 0 12px rgba(255,90,90,.9)}
@keyframes cctoast{0%{opacity:0;transform:scale(.85)}10%{opacity:1;transform:scale(1)}75%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}
.cc-map{position:absolute;left:12px;bottom:12px;width:158px;height:158px}
.cc-map canvas{width:100%;height:100%}
.cc-hint{position:absolute;bottom:64px;left:50%;transform:translateX(-50%);font-size:12px;letter-spacing:1px;opacity:.65;text-align:center;transition:opacity 1s}
.cc-big{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:rgba(3,6,16,0.72);pointer-events:auto;z-index:30}
.cc-big h1{font-size:44px;font-weight:900;letter-spacing:4px;text-shadow:0 0 30px rgba(255,80,120,0.8)}
.cc-big .info{font-size:15px;opacity:.85;line-height:1.7;text-align:center}
.cc-btn{pointer-events:auto;cursor:pointer;border:none;border-radius:12px;padding:13px 34px;font-size:16px;font-weight:900;letter-spacing:2px;color:#02121a;background:linear-gradient(135deg,#3af2ff,#6dffb0);box-shadow:0 0 22px rgba(80,230,255,0.45);transition:transform .1s}
.cc-btn:hover{transform:scale(1.05)}
.cc-btn.ghost{background:rgba(255,255,255,0.1);color:#cfe8ff;box-shadow:none;border:1px solid rgba(160,220,255,0.3)}
.cc-btn:disabled{opacity:.4;cursor:default;transform:none}
.cc-pause-row{display:flex;gap:10px;align-items:center;font-size:13px;letter-spacing:1px}
.cc-pause-row input[type=range]{width:160px;accent-color:#3af2ff}
@media (max-width:700px){.cc-lb{display:none}.cc-map{width:110px;height:110px}.cc-score .len{font-size:20px}}
`;

const WICON = { calm: "☾", rain: "🌧", fireflies: "✨", ashstorm: "🌪", emberrain: "☄", blizzard: "🌨", aurora: "🌌", sandstorm: "🌵", heatwave: "🔥", sporestorm: "🍄", voidstorm: "⚡" };

export class HUD {
  constructor(container, audio) {
    this.audio = audio;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this._style = style;

    this.root = document.createElement("div");
    this.root.className = "cc-hud";
    container.appendChild(this.root);
    this.root.innerHTML = `
      <div class="cc-panel cc-score"><div class="len">0</div><div class="sub">☠ <span class="kills">0</span> · best <span class="best">0</span> · rank <span class="rank">-</span></div></div>
      <div class="cc-panel cc-weather"><span class="wi">☾</span><span class="wt">CALM SKIES</span></div>
      <div class="cc-panel cc-lb"><h4>LONGEST COILS</h4><div class="rows"></div></div>
      <div class="cc-feed"></div>
      <div class="cc-toasts"></div>
      <div class="cc-panel cc-boost"><div class="bar"><div class="fill" style="width:100%"></div></div><div class="lbl">BOOST</div></div>
      <div class="cc-hint">steer: mouse or <b>A</b>/<b>D</b> · boost (builds up, burns mass): hold <b>W</b>/<b>LMB</b>/<b>SPACE</b> · slow: <b>S</b>/<b>RMB</b> · zoom: wheel · <b>don't cross your own body!</b></div>
      <div class="cc-map cc-panel"><canvas width="316" height="316"></canvas></div>
    `;
    this.$ = (q) => this.root.querySelector(q);
    this.lenEl = this.$(".len"); this.killsEl = this.$(".kills"); this.bestEl = this.$(".best"); this.rankEl = this.$(".rank");
    this.lbRows = this.$(".cc-lb .rows");
    this.weatherEl = this.$(".cc-weather"); this.wiEl = this.$(".wi"); this.wtEl = this.$(".wt");
    this.fillEl = this.$(".cc-boost .fill");
    this.feedEl = this.$(".cc-feed");
    this.toastsEl = this.$(".cc-toasts");
    this.hintEl = this.$(".cc-hint");
    this.mapCv = this.$(".cc-map canvas");
    this.mapCtx = this.mapCv.getContext("2d");
    this._lbT = 0;
    this._hintT = 0;
    this._lastWeather = "calm";
    this.deathEl = null;
    this.pauseEl = null;
    this.hide();
  }

  show() { this.root.style.display = "block"; this._hintT = 0; }
  hide() { this.root.style.display = "none"; }

  toast(text, cls = "") {
    const d = document.createElement("div");
    d.className = "cc-toast " + cls;
    d.textContent = text;
    this.toastsEl.appendChild(d);
    setTimeout(() => d.remove(), 2700);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
  }
  killFeed(killerName, victimName) {
    const d = document.createElement("div");
    d.className = "k";
    d.innerHTML = `<b>${esc(killerName)}</b> ⚔ ${esc(victimName)}`;
    this.feedEl.appendChild(d);
    setTimeout(() => d.remove(), 4600);
    while (this.feedEl.children.length > 5) this.feedEl.firstChild.remove();
  }

  update(dt, W, mySlot, weather, onlineHumans, sessionBest) {
    const me = W.snakes.find((s) => s.slot === mySlot);
    this._hintT += dt;
    if (this._hintT > 9) this.hintEl.style.opacity = "0";

    if (me) {
      this.lenEl.textContent = Math.round(me.mass * 2.4); // presented "length"
      this.killsEl.textContent = me.kills || 0;
      this.bestEl.textContent = Math.round(Math.max(sessionBest || 0, me.mass) * 2.4);
      const boostable = Math.max(0, me.mass - CONST.BOOST_MIN_MASS);
      const frac = Math.min(1, boostable / Math.max(1, me.mass * 0.65));
      this.fillEl.style.width = (frac * 100).toFixed(0) + "%";
    }

    // weather chip
    const wk = weather.kind;
    const approaching = wk === "calm" && weather.phase > 0.82 && weather.next;
    if (approaching) {
      this.wiEl.textContent = WICON[weather.next] || "☁";
      this.wtEl.textContent = (weather.next || "").toUpperCase() + " APPROACHING…";
      this.weatherEl.classList.add("active");
    } else {
      this.wiEl.textContent = WICON[wk] || "☾";
      this.wtEl.textContent = wk === "calm" ? "CALM SKIES" : wk.toUpperCase();
      this.weatherEl.classList.toggle("active", wk !== "calm");
    }
    if (wk !== this._lastWeather) {
      if (wk !== "calm") this.toast((WICON[wk] || "") + " " + wk.toUpperCase() + " — food surge!", "warn");
      this._lastWeather = wk;
    }

    // leaderboard (throttled)
    this._lbT += dt;
    if (this._lbT > 0.4) {
      this._lbT = 0;
      const rank = ranking(W);
      let html = "";
      const top = rank.slice(0, 8);
      for (let i = 0; i < top.length; i++) {
        const s = top[i];
        const skin = SKINS[s.skinId % SKINS.length];
        const isMe = s.slot === mySlot;
        const human = onlineHumans && onlineHumans.has(s.slot);
        html += `<div class="row ${isMe ? "me" : ""}"><span>${i === 0 ? "👑" : (i + 1)}</span><span class="dot" style="background:#${skin.glow.toString(16).padStart(6, "0")}"></span><span class="nm">${esc(s.name)}${human ? " ●" : ""}</span><span class="ln">${Math.round(s.mass * 2.4)}</span></div>`;
      }
      const myRank = rank.findIndex((s) => s.slot === mySlot);
      this.rankEl.textContent = myRank >= 0 ? `${myRank + 1}/${rank.length}` : "-";
      if (myRank >= 8 && me) {
        const skin = SKINS[me.skinId % SKINS.length];
        html += `<div class="row me"><span>${myRank + 1}</span><span class="dot" style="background:#${skin.glow.toString(16).padStart(6, "0")}"></span><span class="nm">${esc(me.name)}</span><span class="ln">${Math.round(me.mass * 2.4)}</span></div>`;
      }
      this.lbRows.innerHTML = html;
    }

    this._drawMap(W, me);
  }

  _drawMap(W, me) {
    const c = this.mapCtx, cv = this.mapCv;
    const R2 = cv.width / 2;
    c.clearRect(0, 0, cv.width, cv.height);
    c.save();
    c.beginPath(); c.arc(R2, R2, R2 - 4, 0, 6.2832); c.clip();
    c.fillStyle = "rgba(4,10,22,0.85)";
    c.fillRect(0, 0, cv.width, cv.height);
    // rings
    c.strokeStyle = "rgba(120,200,255,0.14)";
    for (const rr of [0.33, 0.66, 1]) { c.beginPath(); c.arc(R2, R2, (R2 - 6) * rr, 0, 6.2832); c.stroke(); }
    if (me) {
      // player frame: forward = up on map
      const up = me.u, fwd = me.t;
      const right = { x: fwd.y * up.z - fwd.z * up.y, y: fwd.z * up.x - fwd.x * up.z, z: fwd.x * up.y - fwd.y * up.x };
      const proj = (u) => {
        const d = angDist(me.u, u); // 0..π
        // direction: project u onto tangent plane
        const k = u.x * up.x + u.y * up.y + u.z * up.z;
        let tx = u.x - up.x * k, ty = u.y - up.y * k, tz = u.z - up.z * k;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const fx = tx * fwd.x + ty * fwd.y + tz * fwd.z;
        const rx = tx * right.x + ty * right.y + tz * right.z;
        const rr = (d / Math.PI) * (R2 - 8);
        return [R2 + rx * rr, R2 - fx * rr];
      };
      // essence hotspots
      for (const f of W.food.values()) {
        if (f.tier !== 9 && f.tier !== 3) continue;
        const [x, y] = proj(f.u);
        c.fillStyle = f.tier === 9 ? "rgba(170,255,110,0.8)" : "rgba(255,90,220,0.8)";
        c.beginPath(); c.arc(x, y, 2.2, 0, 6.2832); c.fill();
      }
      // snakes
      for (const s of W.snakes) {
        if (!s.alive) continue;
        const skin = SKINS[s.skinId % SKINS.length];
        const [x, y] = proj(s.u);
        c.fillStyle = "#" + skin.glow.toString(16).padStart(6, "0");
        const rr = s.slot === me.slot ? 5 : 3 + Math.min(3, s.mass / 200);
        c.beginPath(); c.arc(x, y, rr, 0, 6.2832); c.fill();
      }
      // player heading arrow
      c.strokeStyle = "#7dffce"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(R2, R2); c.lineTo(R2, R2 - 12); c.stroke();
      c.beginPath(); c.moveTo(R2 - 4, R2 - 8); c.lineTo(R2, R2 - 14); c.lineTo(R2 + 4, R2 - 8); c.stroke();
    }
    c.restore();
    c.strokeStyle = "rgba(120,200,255,0.35)";
    c.beginPath(); c.arc(R2, R2, R2 - 4, 0, 6.2832); c.stroke();
  }

  showDeath({ killedBy, length, best, kills }, onRespawn, onMenu) {
    this.hideDeath();
    const d = document.createElement("div");
    d.className = "cc-big";
    d.innerHTML = `
      <h1 style="color:#ff6a8a">COILED!</h1>
      <div class="info">${killedBy ? `slain by <b>${esc(killedBy)}</b><br>` : ""}final length <b>${length}</b> · kills <b>${kills}</b> · session best <b>${best}</b><br><span style="opacity:.7;font-size:12.5px">your glowing essence now feeds the planet…</span></div>
      <div style="display:flex;gap:12px"><button class="cc-btn" data-a="respawn">RESPAWN</button><button class="cc-btn ghost" data-a="menu">MENU</button></div>`;
    d.querySelector('[data-a="respawn"]').onclick = () => { this.audio.ui(); onRespawn(); };
    d.querySelector('[data-a="menu"]').onclick = () => { this.audio.ui(); onMenu(); };
    this.root.appendChild(d);
    this.deathEl = d;
  }
  hideDeath() { if (this.deathEl) { this.deathEl.remove(); this.deathEl = null; } }

  showPause(vols, onResume, onMenu, sens, onSens) {
    this.hidePause();
    const d = document.createElement("div");
    d.className = "cc-big";
    d.innerHTML = `
      <h1 style="color:#7de0ff;text-shadow:0 0 30px rgba(90,220,255,.8)">PAUSED</h1>
      <div class="cc-pause-row">MUSIC <input type="range" min="0" max="1" step="0.05" value="${vols.music}" data-a="mv"></div>
      <div class="cc-pause-row">SFX <input type="range" min="0" max="1" step="0.05" value="${vols.sfx}" data-a="sv"></div>
      ${onSens ? `<div class="cc-pause-row">MOUSE SENS <input type="range" min="0.5" max="2.5" step="0.05" value="${sens}" data-a="sens"> <b data-a="sensval" style="width:36px">${Number(sens).toFixed(2)}</b></div>` : ""}
      <div style="display:flex;gap:12px;margin-top:8px"><button class="cc-btn" data-a="resume">RESUME</button><button class="cc-btn ghost" data-a="menu">QUIT TO MENU</button></div>`;
    d.querySelector('[data-a="resume"]').onclick = () => { this.audio.ui(); onResume(); };
    d.querySelector('[data-a="menu"]').onclick = () => { this.audio.ui(); onMenu(); };
    d.querySelector('[data-a="mv"]').oninput = (e) => this.audio.setMusicVol(parseFloat(e.target.value));
    d.querySelector('[data-a="sv"]').oninput = (e) => this.audio.setSfxVol(parseFloat(e.target.value));
    if (onSens) d.querySelector('[data-a="sens"]').oninput = (e) => {
      const v = parseFloat(e.target.value);
      d.querySelector('[data-a="sensval"]').textContent = v.toFixed(2);
      onSens(v);
    };
    this.root.appendChild(d);
    this.pauseEl = d;
  }
  hidePause() { if (this.pauseEl) { this.pauseEl.remove(); this.pauseEl = null; } }

  dispose() { this.root.remove(); this._style.remove(); }
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
