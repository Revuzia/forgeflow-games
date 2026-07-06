// DOM UI: menus, HUD, panels, results, achievements. One overlay root over the canvas.
import { TOWERS, TOWER_ORDER, upgradeCost, isTowerUnlocked, SELL_REFUND } from '../data/towers.js';
import { BIOMES } from '../data/biomes.js';
import { ENEMIES } from '../data/enemies.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { loadProfile, starsFor, isBiomeUnlocked, isLevelUnlocked, isEndlessUnlocked, biomeStars, totalStars } from '../core/save.js';
import { levelDef } from '../data/levels.js';
import { TARGET_MODES } from '../sim/sim.js';

const CSS = `
.br-ui{position:absolute;inset:0;pointer-events:none;font-family:'Segoe UI',system-ui,sans-serif;color:#e8e4d8;
  --gold:#d8b04a;--panel:rgba(10,16,28,0.92);--panel2:rgba(16,24,40,0.94);--edge:rgba(216,176,74,0.35);user-select:none;-webkit-user-select:none}
.br-ui *{box-sizing:border-box}
.br-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  pointer-events:auto;background:radial-gradient(ellipse at 50% 30%,rgba(12,20,36,0.55),rgba(6,10,20,0.88))}
.br-title{font-size:min(9vw,84px);font-weight:800;letter-spacing:0.14em;color:#f0e6c8;
  text-shadow:0 0 40px rgba(216,176,74,0.5),0 4px 0 #493a12,0 8px 24px rgba(0,0,0,0.8);margin-bottom:4px}
.br-sub{font-size:min(3vw,19px);letter-spacing:0.42em;color:var(--gold);margin-bottom:44px;text-transform:uppercase}
.br-btn{pointer-events:auto;background:linear-gradient(180deg,#243654,#16223a);border:1px solid var(--edge);color:#f0e6c8;
  font-size:19px;letter-spacing:0.12em;padding:13px 54px;margin:7px;border-radius:8px;cursor:pointer;text-transform:uppercase;
  transition:all .15s;font-weight:600;min-width:280px;text-align:center}
.br-btn:hover{border-color:var(--gold);box-shadow:0 0 24px rgba(216,176,74,0.35);transform:translateY(-1px)}
.br-btn.primary{background:linear-gradient(180deg,#7a5f1e,#4a3810);border-color:var(--gold);font-size:22px}
.br-btn.small{min-width:0;padding:8px 20px;font-size:14px;margin:4px}
.br-btn:disabled{opacity:0.4;cursor:default;transform:none;box-shadow:none}
.br-cards{display:flex;gap:18px;flex-wrap:wrap;justify-content:center;max-width:1200px}
.br-card{pointer-events:auto;width:200px;background:var(--panel);border:1px solid var(--edge);border-radius:12px;
  padding:18px 14px;cursor:pointer;transition:all .18s;text-align:center;position:relative}
.br-card:hover:not(.locked){transform:translateY(-4px);box-shadow:0 8px 30px rgba(0,0,0,0.5),0 0 20px var(--bcol,rgba(216,176,74,0.3))}
.br-card.locked{opacity:0.45;cursor:default;filter:grayscale(0.8)}
.br-card h3{font-size:17px;letter-spacing:0.08em;margin:6px 0;color:#f0e6c8}
.br-card .tag{font-size:11.5px;color:#9aa4b8;font-style:italic;min-height:30px}
.br-card .stars{color:var(--gold);font-size:13px;margin-top:8px}
.br-card .bswatch{width:100%;height:64px;border-radius:8px;margin-bottom:8px;border:1px solid rgba(255,255,255,0.12)}
.br-lvlgrid{display:grid;grid-template-columns:repeat(3,110px);gap:14px;margin:10px 0 22px}
.br-lvl{pointer-events:auto;width:110px;height:92px;background:var(--panel);border:1px solid var(--edge);border-radius:10px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;position:relative}
.br-lvl:hover:not(.locked){border-color:var(--gold);box-shadow:0 0 16px rgba(216,176,74,0.3)}
.br-lvl.locked{opacity:0.4;cursor:default}
.br-lvl .num{font-size:26px;font-weight:800;color:#f0e6c8}
.br-lvl .nm{font-size:9.5px;color:#9aa4b8;text-align:center;padding:0 6px;line-height:1.15;margin-top:2px}
.br-lvl .st{color:var(--gold);font-size:12px;margin-top:3px}
.br-lvl .boss-tag{position:absolute;top:-8px;right:-8px;background:#7a2020;font-size:9px;padding:2px 7px;border-radius:8px;letter-spacing:0.1em;border:1px solid #c05050}
.br-back{position:absolute;top:22px;left:22px}
h2.br-h2{font-size:34px;letter-spacing:0.2em;color:#f0e6c8;margin-bottom:6px;text-transform:uppercase;text-shadow:0 2px 12px rgba(0,0,0,0.8)}
.br-h2sub{color:var(--gold);letter-spacing:0.24em;font-size:13px;margin-bottom:30px;text-transform:uppercase}

/* HUD */
.br-hud-top{position:absolute;top:0;left:0;right:0;display:flex;justify-content:center;pointer-events:none;z-index:5}
.br-hud-bar{display:flex;gap:22px;align-items:center;background:var(--panel);border:1px solid var(--edge);border-top:none;
  border-radius:0 0 14px 14px;padding:8px 26px;pointer-events:auto;box-shadow:0 4px 24px rgba(0,0,0,0.5)}
.br-stat{display:flex;align-items:center;gap:7px;font-size:18px;font-weight:700;letter-spacing:0.03em}
.br-stat .ico{font-size:19px}
.br-stat.gold{color:#ffd76a}.br-stat.lives{color:#ff8a7a}.br-stat.wave{color:#9adcff}
.br-speed{display:flex;gap:4px;margin-left:8px}
.br-speed button,.br-pausebtn{pointer-events:auto;background:#1a2438;border:1px solid var(--edge);color:#cfd8e8;border-radius:6px;
  padding:4px 11px;cursor:pointer;font-size:14px;font-weight:700}
.br-speed button.on{background:#7a5f1e;color:#ffe9b0;border-color:var(--gold)}
.br-hud-bottom{position:absolute;bottom:0;left:50%;transform:translateX(-50%);display:flex;align-items:flex-end;gap:8px;
  background:var(--panel);border:1px solid var(--edge);border-bottom:none;border-radius:14px 14px 0 0;padding:10px 14px 8px;pointer-events:auto;z-index:5}
.br-tcard{width:86px;background:var(--panel2);border:1px solid rgba(255,255,255,0.14);border-radius:9px;padding:7px 4px 5px;
  cursor:pointer;text-align:center;transition:all .12s;position:relative}
.br-tcard:hover:not(.na):not(.locked){border-color:var(--gold);transform:translateY(-3px)}
.br-tcard.sel{border-color:var(--gold);box-shadow:0 0 14px rgba(216,176,74,0.5)}
.br-tcard.na{opacity:0.45}
.br-tcard.locked{opacity:0.32;cursor:default}
.br-tcard canvas{width:40px;height:40px}
.br-tcard .tn{font-size:9.5px;letter-spacing:0.02em;color:#cfd8e8;line-height:1.1;height:21px}
.br-tcard .tc{font-size:12px;color:#ffd76a;font-weight:700}
.br-tcard .hk{position:absolute;top:2px;left:5px;font-size:9px;color:#6a7690}
.br-tcard .lock{position:absolute;top:2px;right:5px;font-size:10px}
/* selection panel */
.br-selpanel{position:absolute;right:14px;top:70px;width:240px;background:var(--panel);border:1px solid var(--edge);
  border-radius:12px;padding:14px;pointer-events:auto;z-index:6;display:none}
.br-selpanel h3{color:#f0e6c8;font-size:17px;letter-spacing:0.05em;margin-bottom:2px}
.br-selpanel .lvl{color:var(--gold);font-size:12px;margin-bottom:8px;letter-spacing:0.15em}
.br-selpanel .strow{display:flex;justify-content:space-between;font-size:12.5px;color:#aeb8cc;padding:2.5px 0}
.br-selpanel .strow b{color:#e8e4d8}
.br-selpanel button{width:100%;margin-top:7px}
.br-selpanel .modebtn{background:#1a2438;font-size:12px;padding:7px}
.br-wavebox{position:absolute;left:14px;top:70px;background:var(--panel);border:1px solid var(--edge);border-radius:12px;
  padding:12px 14px;pointer-events:auto;max-width:230px;z-index:6}
.br-wavebox .wtitle{font-size:12px;letter-spacing:0.18em;color:#9aa4b8;text-transform:uppercase;margin-bottom:7px}
.br-chip{display:inline-flex;align-items:center;gap:5px;background:#1a2438;border:1px solid rgba(255,255,255,0.13);
  border-radius:14px;padding:2.5px 10px;font-size:11.5px;margin:2px;color:#cfd8e8}
.br-chip.fly::after{content:'✈';font-size:9px;color:#9adcff}
.br-chip.boss{border-color:#c05050;color:#ff9a8a}
.br-startbtn{margin-top:9px;width:100%;background:linear-gradient(180deg,#7a5f1e,#4a3810);border:1px solid var(--gold);
  color:#ffe9b0;font-weight:700;letter-spacing:0.1em;padding:9px;border-radius:8px;cursor:pointer;font-size:14px}
.br-startbtn:hover{box-shadow:0 0 18px rgba(216,176,74,0.4)}
.br-startbtn:disabled{opacity:0.4;cursor:default;box-shadow:none}
.br-bossbar{position:absolute;top:56px;left:50%;transform:translateX(-50%);width:min(520px,60vw);display:none;z-index:6}
.br-bossbar .bname{text-align:center;font-size:13px;letter-spacing:0.2em;color:#ff9a8a;text-transform:uppercase;text-shadow:0 2px 8px #000}
.br-bossbar .btrack{height:13px;background:rgba(10,14,20,0.9);border:1px solid #c05050;border-radius:7px;overflow:hidden;margin-top:3px}
.br-bossbar .bfill{height:100%;background:linear-gradient(90deg,#c03030,#ff7a50);width:100%;transition:width .12s}
.br-banner{position:absolute;top:32%;left:50%;transform:translate(-50%,-50%) scale(0.9);font-size:44px;font-weight:800;
  letter-spacing:0.22em;color:#f0e6c8;text-shadow:0 0 30px rgba(216,176,74,0.7),0 4px 16px #000;opacity:0;transition:all .4s;
  pointer-events:none;text-transform:uppercase;z-index:8;text-align:center}
.br-banner.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
.br-banner .sub{display:block;font-size:16px;letter-spacing:0.3em;color:#d8b04a;margin-top:6px}
.br-toasts{position:absolute;bottom:130px;right:16px;display:flex;flex-direction:column;gap:8px;z-index:9;pointer-events:none}
.br-toast{background:var(--panel);border:1px solid var(--edge);border-radius:10px;padding:10px 16px;font-size:13.5px;
  color:#e8e4d8;animation:brtoast 3.6s forwards;max-width:290px;box-shadow:0 6px 20px rgba(0,0,0,0.5)}
.br-toast b{color:var(--gold)}
.br-toast.achieve{border-color:var(--gold);background:linear-gradient(180deg,rgba(60,46,12,0.95),rgba(20,16,8,0.95))}
@keyframes brtoast{0%{opacity:0;transform:translateX(40px)}8%{opacity:1;transform:none}82%{opacity:1}100%{opacity:0;transform:translateY(-8px)}}
.br-hazard{position:absolute;top:110px;left:50%;transform:translateX(-50%);background:rgba(60,20,14,0.92);border:1px solid #c05050;
  color:#ffb0a0;border-radius:10px;padding:7px 20px;font-size:14px;letter-spacing:0.08em;display:none;z-index:7}
.br-hazard.good{background:rgba(20,44,20,0.92);border-color:#50c050;color:#b0ffb0}
/* overlays */
.br-overlay{position:absolute;inset:0;background:rgba(4,8,16,0.82);display:flex;flex-direction:column;align-items:center;
  justify-content:center;pointer-events:auto;z-index:20}
.br-panelbox{background:var(--panel);border:1px solid var(--edge);border-radius:16px;padding:34px 44px;text-align:center;
  max-width:min(600px,92vw);max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.7)}
.br-panelbox h2{font-size:30px;letter-spacing:0.16em;color:#f0e6c8;margin-bottom:18px;text-transform:uppercase}
.br-setrow{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:13px 0;min-width:320px}
.br-setrow label{font-size:15px;letter-spacing:0.06em;color:#cfd8e8}
.br-setrow input[type=range]{width:170px;accent-color:var(--gold)}
.br-setrow select{background:#1a2438;color:#e8e4d8;border:1px solid var(--edge);border-radius:6px;padding:5px 10px}
.br-results-stars{font-size:52px;letter-spacing:0.2em;margin:10px 0 4px;color:#3a4356}
.br-results-stars .lit{color:var(--gold);text-shadow:0 0 24px rgba(216,176,74,0.8)}
.br-resstats{display:grid;grid-template-columns:1fr 1fr;gap:5px 30px;margin:16px 0;text-align:left;font-size:14px;color:#aeb8cc}
.br-resstats b{color:#e8e4d8;float:right}
.br-achgrid{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow-y:auto;padding-right:6px;min-width:min(460px,80vw)}
.br-ach{display:flex;align-items:center;gap:13px;background:var(--panel2);border:1px solid rgba(255,255,255,0.1);
  border-radius:9px;padding:9px 13px;text-align:left}
.br-ach.earned{border-color:var(--gold)}
.br-ach .medal{font-size:23px;filter:grayscale(1);opacity:0.4}
.br-ach.earned .medal{filter:none;opacity:1}
.br-ach .an{font-size:14.5px;color:#f0e6c8;font-weight:600}
.br-ach .ad{font-size:12px;color:#8a94a8}
.br-vignette{position:absolute;inset:0;pointer-events:none;z-index:4;
  background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,0.42) 100%)}
.br-dmgflash{position:absolute;inset:0;pointer-events:none;z-index:10;background:radial-gradient(ellipse at center,transparent 50%,rgba(200,30,20,0.35) 100%);opacity:0;transition:opacity .5s}
`;

const ICONS = {
  bolt(ctx, s) { arrow(ctx, s, '#e8c46a'); },
  sniper(ctx, s) { // crosshair
    ctx.strokeStyle = '#a8cfe0'; ctx.lineWidth = s * 0.07;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2); ctx.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(s / 2 + dx * s * 0.18, s / 2 + dy * s * 0.18);
      ctx.lineTo(s / 2 + dx * s * 0.44, s / 2 + dy * s * 0.44);
      ctx.stroke();
    }
    ctx.fillStyle = '#a8cfe0';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.06, 0, Math.PI * 2); ctx.fill();
  },
  storm(ctx, s) { // zigzag bolt
    ctx.fillStyle = '#78d8ff';
    ctx.beginPath();
    ctx.moveTo(s * 0.58, s * 0.08); ctx.lineTo(s * 0.28, s * 0.55); ctx.lineTo(s * 0.47, s * 0.55);
    ctx.lineTo(s * 0.38, s * 0.92); ctx.lineTo(s * 0.74, s * 0.42); ctx.lineTo(s * 0.53, s * 0.42);
    ctx.closePath(); ctx.fill();
  },
  ember(ctx, s) { // flame
    ctx.fillStyle = '#ff8c3a';
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.06);
    ctx.bezierCurveTo(s * 0.72, s * 0.34, s * 0.82, s * 0.5, s * 0.74, s * 0.68);
    ctx.bezierCurveTo(s * 0.68, s * 0.86, s * 0.32, s * 0.86, s * 0.26, s * 0.68);
    ctx.bezierCurveTo(s * 0.18, s * 0.5, s * 0.3, s * 0.36, s * 0.5, s * 0.06);
    ctx.fill();
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.66, s * 0.15, 0, Math.PI * 2); ctx.fill();
  },
  frost(ctx, s) { // snowflake
    ctx.strokeStyle = '#b8ecff'; ctx.lineWidth = s * 0.06; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(s / 2, s / 2);
      ctx.lineTo(s / 2 + Math.cos(a) * s * 0.4, s / 2 + Math.sin(a) * s * 0.4); ctx.stroke();
      const bx = s / 2 + Math.cos(a) * s * 0.26, by = s / 2 + Math.sin(a) * s * 0.26;
      for (const da of [-0.6, 0.6]) {
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a + da) * s * 0.12, by + Math.sin(a + da) * s * 0.12); ctx.stroke();
      }
    }
  },
  venom(ctx, s) { // droplet
    ctx.fillStyle = '#9ade3a';
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.08);
    ctx.bezierCurveTo(s * 0.78, s * 0.45, s * 0.76, s * 0.66, s * 0.64, s * 0.8);
    ctx.bezierCurveTo(s * 0.55, s * 0.9, s * 0.45, s * 0.9, s * 0.36, s * 0.8);
    ctx.bezierCurveTo(s * 0.24, s * 0.66, s * 0.22, s * 0.45, s * 0.5, s * 0.08);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(s * 0.42, s * 0.62, s * 0.08, 0, Math.PI * 2); ctx.fill();
  },
  cannon(ctx, s) { // bomb
    ctx.fillStyle = '#8a8f9a';
    ctx.beginPath(); ctx.arc(s * 0.48, s * 0.6, s * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6a6f7a'; ctx.lineWidth = s * 0.06;
    ctx.beginPath(); ctx.moveTo(s * 0.6, s * 0.36); ctx.quadraticCurveTo(s * 0.72, s * 0.2, s * 0.82, s * 0.22); ctx.stroke();
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.arc(s * 0.84, s * 0.2, s * 0.07, 0, Math.PI * 2); ctx.fill();
  },
  banner(ctx, s) { // flag
    ctx.strokeStyle = '#c8a86a'; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s * 0.3, s * 0.1); ctx.lineTo(s * 0.3, s * 0.9); ctx.stroke();
    ctx.fillStyle = '#e0b64f';
    ctx.beginPath();
    ctx.moveTo(s * 0.34, s * 0.14); ctx.lineTo(s * 0.82, s * 0.26); ctx.lineTo(s * 0.34, s * 0.44);
    ctx.closePath(); ctx.fill();
  },
};
function arrow(ctx, s, color) {
  ctx.strokeStyle = color; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(s * 0.2, s * 0.8); ctx.lineTo(s * 0.74, s * 0.26); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(s * 0.82, s * 0.18); ctx.lineTo(s * 0.6, s * 0.24); ctx.lineTo(s * 0.76, s * 0.4);
  ctx.closePath(); ctx.fill();
  for (const t of [0.32, 0.44]) {
    ctx.beginPath();
    ctx.moveTo(s * (0.2 + t * 0.54 / 1), s * (0.8 - t * 0.54));
    ctx.lineTo(s * (0.1 + t * 0.54), s * (0.7 - t * 0.54));
    ctx.stroke();
  }
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function iconCanvas(type, size = 40) {
  const c = document.createElement('canvas');
  c.width = size * 2; c.height = size * 2;
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  ICONS[type]?.(ctx, size);
  return c;
}
const fmt = (n) => Math.round(n * 10) / 10;

export function createUI(container, handlers) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = el('div', 'br-ui');
  container.appendChild(root);

  const layers = {};
  function screen(name) {
    if (layers[name]) { layers[name].remove(); }
    const s = el('div', 'br-screen');
    s.dataset.name = name;
    layers[name] = s;
    root.appendChild(s);
    return s;
  }
  function clearScreens() {
    for (const k of Object.keys(layers)) { layers[k].remove(); delete layers[k]; }
  }

  const ui = {
    root,
    // ---------------- MENU ----------------
    showMenu() {
      clearScreens();
      const s = screen('menu');
      s.append(
        el('div', 'br-title', 'BASTION REALMS'),
        el('div', 'br-sub', 'Hold the line across five realms'),
      );
      const play = el('button', 'br-btn primary', totalStars() > 0 ? 'CONTINUE' : 'PLAY');
      play.onclick = () => { handlers.sfx('ui_click'); ui.showRealms(); };
      const ach = el('button', 'br-btn', `ACHIEVEMENTS <span style="color:#8a94a8;font-size:13px">${Object.keys(loadProfile().achievements).length}/${ACHIEVEMENTS.length}</span>`);
      ach.onclick = () => { handlers.sfx('ui_click'); ui.showAchievements(() => ui.showMenu()); };
      const set = el('button', 'br-btn', 'SETTINGS');
      set.onclick = () => { handlers.sfx('ui_click'); ui.showSettings(() => {}); };
      s.append(play, ach, set);
      s.append(el('div', '', `<div style="margin-top:36px;font-size:11.5px;color:#5a6478;letter-spacing:0.12em">A FORGEFLOW GAMES PRODUCTION · ⭐ ${totalStars()}/135</div>`));
      handlers.music('menu');
    },

    // ---------------- REALM SELECT ----------------
    showRealms() {
      clearScreens();
      const s = screen('realms');
      const back = el('button', 'br-btn small br-back', '← BACK');
      back.onclick = () => { handlers.sfx('ui_back'); ui.showMenu(); };
      s.append(back, el('h2', 'br-h2', 'Choose a Realm'), el('div', 'br-h2sub', `⭐ ${totalStars()} / 135`));
      const cards = el('div', 'br-cards');
      BIOMES.forEach((b, bi) => {
        const unlocked = isBiomeUnlocked(bi);
        const card = el('div', 'br-card' + (unlocked ? '' : ' locked'));
        const cssColor = '#' + b.ground.base.toString(16).padStart(6, '0');
        const skyColor = '#' + b.sky.toString(16).padStart(6, '0');
        card.style.setProperty('--bcol', cssColor + '88');
        card.innerHTML = `
          <div class="bswatch" style="background:linear-gradient(160deg,${skyColor},${cssColor})"></div>
          <h3>${b.name}</h3>
          <div class="tag">${b.tagline}</div>
          <div class="stars">${unlocked ? `⭐ ${biomeStars(bi)}/27` : '🔒 Clear the previous realm'}</div>`;
        if (unlocked) card.onclick = () => { handlers.sfx('ui_click'); ui.showLevels(bi); };
        cards.appendChild(card);
      });
      s.appendChild(cards);
      handlers.music('menu');
    },

    // ---------------- LEVEL SELECT ----------------
    showLevels(bi) {
      clearScreens();
      const b = BIOMES[bi];
      const s = screen('levels');
      const back = el('button', 'br-btn small br-back', '← REALMS');
      back.onclick = () => { handlers.sfx('ui_back'); ui.showRealms(); };
      s.append(back, el('h2', 'br-h2', b.name), el('div', 'br-h2sub', b.tagline));
      const grid = el('div', 'br-lvlgrid');
      for (let li = 0; li < 9; li++) {
        const lv = levelDef(bi, li);
        const unlocked = isLevelUnlocked(bi, li);
        const isBossLvl = li === 2 || li === 5 || li === 8;
        const node = el('div', 'br-lvl' + (unlocked ? '' : ' locked'));
        const st = starsFor(bi, li);
        node.innerHTML = `
          ${isBossLvl ? '<div class="boss-tag">BOSS</div>' : ''}
          <div class="num">${li + 1}</div>
          <div class="nm">${lv.name}</div>
          <div class="st">${unlocked ? '★'.repeat(st) + '<span style="color:#3a4356">' + '★'.repeat(3 - st) + '</span>' : '🔒'}</div>`;
        if (unlocked) node.onclick = () => { handlers.sfx('ui_confirm'); handlers.startLevel(bi, li, false); };
        grid.appendChild(node);
      }
      s.appendChild(grid);
      const endless = el('button', 'br-btn' + (isEndlessUnlocked(bi) ? '' : ''),
        isEndlessUnlocked(bi)
          ? `♾ ENDLESS MODE <span style="color:#8a94a8;font-size:13px">best: wave ${loadProfile().endlessBest[bi] || 0}</span>`
          : '♾ ENDLESS — clear level 9 to unlock');
      endless.disabled = !isEndlessUnlocked(bi);
      endless.onclick = () => { handlers.sfx('ui_confirm'); handlers.startLevel(bi, 8, true); };
      s.appendChild(endless);
      handlers.music('menu');
    },

    // ---------------- HUD ----------------
    hud: null,
    showHud(ctx) { // ctx: {bi, li, endless, level}
      clearScreens();
      ui.hideHud();          // remove any previous level's HUD
      ui.closeOverlay();
      const h = {};
      ui.hud = h;
      h.wrap = el('div');
      h.wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      root.appendChild(h.wrap);

      h.wrap.appendChild(el('div', 'br-vignette'));
      h.flash = el('div', 'br-dmgflash');
      h.wrap.appendChild(h.flash);

      // top bar
      const top = el('div', 'br-hud-top');
      const bar = el('div', 'br-hud-bar');
      bar.innerHTML = `
        <div class="br-stat gold"><span class="ico">🪙</span><span id="br-gold">0</span></div>
        <div class="br-stat lives"><span class="ico">❤️</span><span id="br-lives">20</span></div>
        <div class="br-stat wave"><span class="ico">🌊</span><span id="br-wave">–</span></div>`;
      const speed = el('div', 'br-speed');
      for (const sp of [1, 2, 3]) {
        const btn = el('button', sp === 1 ? 'on' : '', sp + '×');
        btn.onclick = () => { handlers.setSpeed(sp); handlers.sfx('ui_select'); [...speed.children].forEach((c, i) => c.classList.toggle('on', i === sp - 1)); };
        speed.appendChild(btn);
      }
      bar.appendChild(speed);
      const pauseBtn = el('button', 'br-pausebtn', '⏸');
      pauseBtn.onclick = () => handlers.pause();
      bar.appendChild(pauseBtn);
      top.appendChild(bar);
      h.wrap.appendChild(top);
      h.gold = bar.querySelector('#br-gold');
      h.lives = bar.querySelector('#br-lives');
      h.wave = bar.querySelector('#br-wave');

      // build bar
      const bb = el('div', 'br-hud-bottom');
      h.cards = {};
      TOWER_ORDER.forEach((tid, i) => {
        const d = TOWERS[tid];
        const unlocked = ctx.endless || isTowerUnlocked(tid, ctx.bi, ctx.li);
        const card = el('div', 'br-tcard' + (unlocked ? '' : ' locked'));
        card.title = d.desc + (unlocked ? '' : '\n(Unlocks later in the campaign)');
        card.appendChild(el('div', 'hk', String(i + 1)));
        if (!unlocked) card.appendChild(el('div', 'lock', '🔒'));
        card.appendChild(iconCanvas(d.icon));
        card.append(el('div', 'tn', d.name), el('div', 'tc', '🪙' + d.cost));
        if (unlocked) {
          card.onclick = () => handlers.selectBuild(tid);
        }
        bb.appendChild(card);
        h.cards[tid] = { card, unlocked };
      });
      h.wrap.appendChild(bb);

      // wave box
      h.wavebox = el('div', 'br-wavebox');
      h.wavebox.innerHTML = `<div class="wtitle">Next Wave</div><div id="br-chips"></div>`;
      h.startBtn = el('button', 'br-startbtn', '⚔ START WAVE');
      h.startBtn.onclick = () => handlers.startWave();
      h.wavebox.appendChild(h.startBtn);
      h.wrap.appendChild(h.wavebox);
      h.chips = h.wavebox.querySelector('#br-chips');

      // selection panel
      h.sel = el('div', 'br-selpanel');
      h.wrap.appendChild(h.sel);

      // boss bar
      h.boss = el('div', 'br-bossbar');
      h.boss.innerHTML = `<div class="bname"></div><div class="btrack"><div class="bfill"></div></div>`;
      h.wrap.appendChild(h.boss);

      // banner + hazard + toasts
      h.banner = el('div', 'br-banner');
      h.wrap.appendChild(h.banner);
      h.hazard = el('div', 'br-hazard');
      h.wrap.appendChild(h.hazard);
      h.toasts = el('div', 'br-toasts');
      h.wrap.appendChild(h.toasts);
    },

    hideHud() { ui.hud?.wrap.remove(); ui.hud = null; },

    updateHud(sim, selection) {
      const h = ui.hud;
      if (!h) return;
      h.gold.textContent = sim.gold;
      h.lives.textContent = sim.lives;
      h.wave.textContent = sim.endless
        ? `${sim.waveIdx + 1}`
        : `${Math.min(sim.waveIdx + 1, sim.waveTotal)}/${sim.waveTotal}`;
      // affordability
      for (const [tid, c] of Object.entries(h.cards)) {
        if (!c.unlocked) continue;
        c.card.classList.toggle('na', sim.gold < TOWERS[tid].cost);
        c.card.classList.toggle('sel', selection.buildType === tid);
      }
      // wave box — only meaningful before a wave starts
      const preview = sim.nextWavePreview();
      const waitingPhase = sim.phase === 'idle' || sim.phase === 'prep';
      if (!waitingPhase || !preview.length) {
        h.wavebox.style.display = 'none';
      } else {
        h.wavebox.style.display = 'block';
        const chips = preview.map((p) =>
          `<span class="br-chip${p.flying ? ' fly' : ''}${p.boss ? ' boss' : ''}" title="${enemyTip(p.type)}">${p.count}× ${p.name}</span>`).join('');
        if (h.chips.innerHTML !== chips) h.chips.innerHTML = chips;
        h.startBtn.textContent = sim.phase === 'prep'
          ? `⚔ SEND EARLY +🪙${Math.floor(Math.max(0, sim.prepT) * 2)} (${Math.ceil(sim.prepT)}s)`
          : '⚔ START WAVE';
      }
      // selection panel
      ui.updateSelPanel(sim, selection);
      // boss bar
      const boss = sim.enemies.find((e) => e.boss);
      if (boss) {
        h.boss.style.display = 'block';
        h.boss.querySelector('.bname').textContent = (boss.empowered ? '☠ EMPOWERED ' : '☠ ') + boss.def.name;
        h.boss.querySelector('.bfill').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
      } else h.boss.style.display = 'none';
    },

    updateSelPanel(sim, selection) {
      const h = ui.hud;
      if (!h) return;
      const tw = selection.towerId ? sim.towers.find((t) => t.id === selection.towerId) : null;
      if (!tw) { h.sel.style.display = 'none'; return; }
      h.sel.style.display = 'block';
      const d = tw.def;
      const lvl = tw.level;
      const canUp = lvl < 2;
      const upCost = canUp ? upgradeCost(tw.type, lvl) : 0;
      const refund = Math.floor(tw.invested * SELL_REFUND);
      const rows = [];
      if (d.kind !== 'support') {
        rows.push(['Damage', fmt(sim.effDmg(tw)) + (canUp ? ` <span style="color:#7dc86a">→ ${fmt(d.dmg[lvl + 1] * (1 + (tw.buffs?.dmg || 0)))}</span>` : '')]);
        rows.push(['Fire rate', fmt(sim.effRate(tw)) + '/s' + (canUp ? ` <span style="color:#7dc86a">→ ${fmt(d.rate[lvl + 1])}</span>` : '')]);
      } else {
        rows.push(['Rate buff', '+' + Math.round(d.buffRate[lvl] * 100) + '%' + (canUp ? ` <span style="color:#7dc86a">→ +${Math.round(d.buffRate[lvl + 1] * 100)}%</span>` : '')]);
        rows.push(['Damage buff', '+' + Math.round(d.buffDmg[lvl] * 100) + '%' + (canUp ? ` <span style="color:#7dc86a">→ +${Math.round(d.buffDmg[lvl + 1] * 100)}%</span>` : '')]);
      }
      rows.push(['Range', fmt(sim.effRange(tw)) + (canUp ? ` <span style="color:#7dc86a">→ ${fmt(d.range[lvl + 1])}</span>` : '')]);
      rows.push(['Kills', tw.kills], ['Damage dealt', Math.round(tw.dmgDealt)]);
      if (tw.buffs) rows.push(['Banner buff', '⚑ active']);
      h.sel.innerHTML = `
        <h3>${d.name}</h3>
        <div class="lvl">${'●'.repeat(lvl + 1)}${'○'.repeat(2 - lvl)} LEVEL ${lvl + 1}</div>
        ${rows.map(([k, v]) => `<div class="strow">${k} <b>${v}</b></div>`).join('')}`;
      if (d.kind !== 'support') {
        const mode = el('button', 'br-btn small modebtn', `🎯 Target: ${tw.mode.toUpperCase()}`);
        mode.style.width = '100%';
        mode.onclick = () => {
          const next = TARGET_MODES[(TARGET_MODES.indexOf(tw.mode) + 1) % TARGET_MODES.length];
          handlers.setTargetMode(tw.id, next);
        };
        h.sel.appendChild(mode);
      }
      if (canUp) {
        const up = el('button', 'br-startbtn', `⬆ UPGRADE 🪙${upCost}`);
        up.disabled = sim.gold < upCost;
        up.onclick = () => handlers.upgrade(tw.id);
        h.sel.appendChild(up);
      }
      const sell = el('button', 'br-btn small', `💰 SELL +🪙${refund}`);
      sell.style.cssText = 'width:100%;background:#3a2020;border-color:#7a4040';
      sell.onclick = () => handlers.sell(tw.id);
      h.sel.appendChild(sell);
    },

    banner(text, sub = '', dur = 2.2) {
      const h = ui.hud; if (!h) return;
      h.banner.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : '');
      h.banner.classList.add('show');
      clearTimeout(h.bannerT);
      h.bannerT = setTimeout(() => h.banner.classList.remove('show'), dur * 1000);
    },
    hazardNotice(text, good = false, dur = 3) {
      const h = ui.hud; if (!h) return;
      h.hazard.textContent = text;
      h.hazard.classList.toggle('good', good);
      h.hazard.style.display = 'block';
      clearTimeout(h.hazardT);
      h.hazardT = setTimeout(() => { h.hazard.style.display = 'none'; }, dur * 1000);
    },
    toast(html, achieve = false) {
      const h = ui.hud;
      const target = h ? h.toasts : null;
      if (!target) return;
      const t = el('div', 'br-toast' + (achieve ? ' achieve' : ''), html);
      target.appendChild(t);
      setTimeout(() => t.remove(), 3700);
    },
    damageFlash() {
      const h = ui.hud; if (!h) return;
      h.flash.style.opacity = '1';
      clearTimeout(h.flashT);
      h.flashT = setTimeout(() => { h.flash.style.opacity = '0'; }, 120);
    },

    // ---------------- OVERLAYS ----------------
    overlay: null,
    closeOverlay() { ui.overlay?.remove(); ui.overlay = null; },
    showPause(onResume) {
      ui.closeOverlay();
      const o = el('div', 'br-overlay');
      ui.overlay = o;
      const box = el('div', 'br-panelbox');
      box.appendChild(el('h2', '', '⏸ Paused'));
      const resume = el('button', 'br-btn primary', 'RESUME');
      resume.onclick = () => { ui.closeOverlay(); onResume(); };
      const restart = el('button', 'br-btn', 'RESTART LEVEL');
      restart.onclick = () => { ui.closeOverlay(); handlers.restart(); };
      const settings = el('button', 'br-btn', 'SETTINGS');
      settings.onclick = () => ui.showSettings(() => ui.showPause(onResume));
      const quit = el('button', 'br-btn', 'QUIT TO MAP');
      quit.onclick = () => { ui.closeOverlay(); handlers.quitToMap(); };
      box.append(resume, restart, settings, quit);
      o.appendChild(box);
      root.appendChild(o);
    },

    showSettings(onBack) {
      ui.closeOverlay();
      const p = loadProfile();
      const o = el('div', 'br-overlay');
      ui.overlay = o;
      const box = el('div', 'br-panelbox');
      box.appendChild(el('h2', '', '⚙ Settings'));
      const mkSlider = (label, val, cb) => {
        const row = el('div', 'br-setrow');
        row.innerHTML = `<label>${label}</label>`;
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.05; inp.value = val;
        inp.oninput = () => cb(parseFloat(inp.value));
        row.appendChild(inp);
        return row;
      };
      box.appendChild(mkSlider('Music volume', p.settings.music, (v) => handlers.setMusicVol(v)));
      box.appendChild(mkSlider('SFX volume', p.settings.sfx, (v) => handlers.setSfxVol(v)));
      const qrow = el('div', 'br-setrow');
      qrow.innerHTML = '<label>Quality</label>';
      const qsel = document.createElement('select');
      for (const q of ['high', 'low']) {
        const opt = document.createElement('option');
        opt.value = q; opt.textContent = q === 'high' ? 'High (shadows)' : 'Low (fast)';
        if (p.settings.quality === q) opt.selected = true;
        qsel.appendChild(opt);
      }
      qsel.onchange = () => handlers.setQuality(qsel.value);
      qrow.appendChild(qsel);
      box.appendChild(qrow);
      const closeB = el('button', 'br-btn primary', 'DONE');
      closeB.onclick = () => { handlers.saveSettings(); ui.closeOverlay(); onBack(); };
      const reset = el('button', 'br-btn small', 'Reset all progress');
      reset.style.cssText = 'background:#3a2020;border-color:#7a4040;margin-top:18px';
      reset.onclick = () => {
        if (reset.dataset.arm) { handlers.resetProgress(); ui.closeOverlay(); }
        else { reset.dataset.arm = '1'; reset.textContent = 'Click again to CONFIRM reset'; }
      };
      box.append(closeB, reset);
      o.appendChild(box);
      root.appendChild(o);
    },

    showAchievements(onBack) {
      ui.closeOverlay();
      const p = loadProfile();
      const o = el('div', 'br-overlay');
      ui.overlay = o;
      const box = el('div', 'br-panelbox');
      box.appendChild(el('h2', '', '🏆 Achievements'));
      const grid = el('div', 'br-achgrid');
      for (const a of ACHIEVEMENTS) {
        const earned = !!p.achievements[a.id];
        grid.appendChild(el('div', 'br-ach' + (earned ? ' earned' : ''), `
          <div class="medal">🏅</div>
          <div><div class="an">${a.name}</div><div class="ad">${a.desc}</div></div>`));
      }
      box.appendChild(grid);
      const closeB = el('button', 'br-btn primary', 'BACK');
      closeB.onclick = () => { ui.closeOverlay(); onBack(); };
      box.appendChild(closeB);
      o.appendChild(box);
      root.appendChild(o);
    },

    showResults({ won, stars, sim, endless, bestWave, onNext, onReplay, onMap }) {
      ui.closeOverlay();
      const o = el('div', 'br-overlay');
      ui.overlay = o;
      const box = el('div', 'br-panelbox');
      if (endless) {
        box.appendChild(el('h2', '', '♾ The Line Broke'));
        box.appendChild(el('div', '', `<div style="font-size:20px;color:#ffd76a;margin-bottom:8px">Reached wave <b>${sim.waveIdx + 1}</b>${bestWave ? ` · best ${bestWave}` : ''}</div>`));
      } else {
        box.appendChild(el('h2', '', won ? '🏆 Victory!' : '💀 Defeat'));
        if (won) {
          const st = el('div', 'br-results-stars');
          st.innerHTML = [1, 2, 3].map((i) => `<span class="${i <= stars ? 'lit' : ''}">★</span>`).join('');
          box.appendChild(st);
          box.appendChild(el('div', '', `<div style="color:#8a94a8;font-size:13px">${stars === 3 ? 'Flawless! 18+ lives kept.' : stars === 2 ? 'Solid defense — 10+ lives kept.' : 'A narrow hold.'}</div>`));
        }
      }
      const s = sim.stats;
      box.appendChild(el('div', 'br-resstats', `
        <div>Enemies slain <b>${s.kills}</b></div><div>Leaks <b>${s.leaks}</b></div>
        <div>Gold earned <b>${s.goldEarned}</b></div><div>Towers built <b>${s.built}</b></div>
        <div>Upgrades <b>${s.upgrades}</b></div><div>Waves cleared <b>${s.wavesCleared}</b></div>`));
      if (won && onNext) {
        const next = el('button', 'br-btn primary', 'NEXT LEVEL →');
        next.onclick = () => { ui.closeOverlay(); onNext(); };
        box.appendChild(next);
      }
      const replay = el('button', 'br-btn', won ? 'REPLAY' : 'TRY AGAIN');
      replay.onclick = () => { ui.closeOverlay(); onReplay(); };
      const map = el('button', 'br-btn', 'BACK TO MAP');
      map.onclick = () => { ui.closeOverlay(); onMap(); };
      box.append(replay, map);
      o.appendChild(box);
      root.appendChild(o);
    },
  };

  return ui;
}

function enemyTip(type) {
  const d = ENEMIES[type];
  const bits = [d.name];
  if (d.flying) bits.push('FLYING — Cannon/Venom cannot hit');
  if (d.armor) bits.push(`Armor ${Math.round(d.armor * 100)}% vs physical`);
  if (d.warding) bits.push(`Warded ${Math.round(d.warding * 100)}% vs magic`);
  if (d.regen) bits.push('Regenerates (fire stops it)');
  if (d.shield) bits.push('Shielded (lightning shreds shields)');
  if (d.boss) bits.push('BOSS');
  return bits.join('\n');
}
