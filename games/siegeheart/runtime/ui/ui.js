// Stronghold UI — iron & parchment war-room skin. Menus, world/level select,
// HUD with the Bastion health bar, build bar w/ road-placement badges,
// selection panel, results, achievements, settings.
import { TOWERS, TOWER_ORDER, upgradeCost, isTowerUnlocked, SELL_REFUND } from '../data/towers.js';
import { WORLDS } from '../data/worlds.js';
import { ENEMIES } from '../data/enemies.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { loadProfile, starsFor, isBiomeUnlocked, isLevelUnlocked, isEndlessUnlocked, biomeStars, totalStars } from '../core/save.js';
import { levelDef, roadsFor } from '../data/levels.js';
import { TARGET_MODES } from '../sim/sim.js';

const CSS = `
.bs-ui{position:absolute;inset:0;pointer-events:none;font-family:Georgia,'Times New Roman',serif;color:#e8dcc0;
  --crimson:#c03040;--iron:#2a2622;--parch:#e8dcc0;--panel:rgba(24,20,16,0.93);--panel2:rgba(34,29,24,0.95);
  --edge:rgba(192,120,64,0.4);--goldt:#d8a850;user-select:none}
.bs-ui *{box-sizing:border-box}
.bs-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  pointer-events:auto;background:radial-gradient(ellipse at 50% 30%,rgba(30,24,18,0.5),rgba(12,9,6,0.9))}
.bs-title{font-size:min(8vw,72px);font-weight:700;letter-spacing:0.1em;color:#f0e2c0;
  text-shadow:0 0 36px rgba(192,48,64,0.55),0 4px 0 #4a1418,0 8px 22px rgba(0,0,0,0.85)}
.bs-title small{display:block;font-size:min(3vw,26px);letter-spacing:0.5em;color:var(--crimson);margin-top:2px}
.bs-sub{font-size:min(2.6vw,17px);letter-spacing:0.4em;color:#b89868;margin:10px 0 40px;text-transform:uppercase}
.bs-btn{pointer-events:auto;background:linear-gradient(180deg,#3c3026,#241d16);border:1px solid var(--edge);color:#f0e2c0;
  font-family:inherit;font-size:18px;letter-spacing:0.14em;padding:13px 52px;margin:7px;border-radius:4px;cursor:pointer;
  text-transform:uppercase;transition:all .15s;font-weight:700;min-width:300px;text-align:center;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.06)}
.bs-btn:hover{border-color:var(--crimson);box-shadow:0 0 22px rgba(192,48,64,0.35);transform:translateY(-1px)}
.bs-btn.primary{background:linear-gradient(180deg,#7a2830,#4a161c);border-color:var(--crimson);font-size:21px}
.bs-btn.small{min-width:0;padding:8px 20px;font-size:13px;margin:4px}
.bs-btn:disabled{opacity:0.4;cursor:default;transform:none;box-shadow:none}
.bs-cards{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;max-width:1240px}
.bs-card{pointer-events:auto;width:206px;background:var(--panel);border:1px solid var(--edge);border-radius:6px;
  padding:16px 13px;cursor:pointer;transition:all .18s;text-align:center;position:relative}
.bs-card:hover:not(.locked){transform:translateY(-4px);box-shadow:0 8px 30px rgba(0,0,0,0.6),0 0 18px rgba(192,48,64,0.3)}
.bs-card.locked{opacity:0.45;cursor:default;filter:grayscale(0.85)}
.bs-card h3{font-size:16.5px;letter-spacing:0.06em;margin:8px 0 4px;color:#f0e2c0}
.bs-card .tag{font-size:11.5px;color:#a08e6a;font-style:italic;min-height:30px}
.bs-card .stars{color:var(--goldt);font-size:13px;margin-top:8px}
.bs-card .swatch{width:100%;height:60px;border-radius:4px;border:1px solid rgba(255,255,255,0.12)}
.bs-lvlgrid{display:grid;grid-template-columns:repeat(3,112px);gap:13px;margin:8px 0 20px}
.bs-lvl{pointer-events:auto;width:112px;height:94px;background:var(--panel);border:1px solid var(--edge);border-radius:6px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;position:relative}
.bs-lvl:hover:not(.locked){border-color:var(--crimson);box-shadow:0 0 14px rgba(192,48,64,0.3)}
.bs-lvl.locked{opacity:0.4;cursor:default}
.bs-lvl .num{font-size:25px;font-weight:700;color:#f0e2c0}
.bs-lvl .nm{font-size:9.5px;color:#a08e6a;text-align:center;padding:0 6px;line-height:1.15;margin-top:2px}
.bs-lvl .st{color:var(--goldt);font-size:12px;margin-top:3px}
.bs-lvl .boss-tag{position:absolute;top:-8px;right:-8px;background:#6a1420;font-size:9px;padding:2px 7px;border-radius:3px;
  letter-spacing:0.1em;border:1px solid var(--crimson)}
h2.bs-h2{font-size:32px;letter-spacing:0.18em;color:#f0e2c0;margin-bottom:4px;text-transform:uppercase;
  text-shadow:0 2px 12px rgba(0,0,0,0.9)}
.bs-h2sub{color:#b89868;letter-spacing:0.24em;font-size:12.5px;margin-bottom:26px;text-transform:uppercase}
.bs-back{position:absolute;top:20px;left:20px}
/* HUD */
.bs-hud-top{position:absolute;top:0;left:0;right:0;display:flex;justify-content:center;pointer-events:none;z-index:5}
.bs-hud-bar{display:flex;gap:20px;align-items:center;background:var(--panel);border:1px solid var(--edge);border-top:none;
  border-radius:0 0 10px 10px;padding:8px 24px;pointer-events:auto;box-shadow:0 4px 24px rgba(0,0,0,0.6)}
.bs-stat{display:flex;align-items:center;gap:7px;font-size:17.5px;font-weight:700}
.bs-stat.gold{color:#ffd76a}.bs-stat.wave{color:#c8a8ff}
.coin{display:inline-block;width:0.82em;height:0.82em;border-radius:50%;background:radial-gradient(circle at 34% 30%,#ffe9a6,#eab63c 58%,#b07d1c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.4),0 0 0 1px #7c5410;vertical-align:-0.04em;margin:0 1px}
.bs-bastion{display:flex;flex-direction:column;gap:2px;min-width:210px}
.bs-bastion .lbl{font-size:10px;letter-spacing:0.22em;color:#b89868;display:flex;justify-content:space-between}
.bs-bastion .track{height:13px;background:#161210;border:1px solid var(--edge);border-radius:3px;overflow:hidden}
.bs-bastion .fill{height:100%;background:linear-gradient(90deg,#b03040,#e07050);transition:width .2s}
.bs-speed{display:flex;gap:4px}
.bs-speed button,.bs-pausebtn{pointer-events:auto;background:#241d16;border:1px solid var(--edge);color:#d8c8a8;border-radius:4px;
  padding:4px 11px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit}
.bs-speed button.on{background:#6a2830;color:#ffd8c0;border-color:var(--crimson)}
.bs-hud-bottom{position:absolute;bottom:0;left:50%;transform:translateX(-50%);display:flex;align-items:flex-end;gap:7px;
  background:var(--panel);border:1px solid var(--edge);border-bottom:none;border-radius:10px 10px 0 0;padding:10px 13px 7px;pointer-events:auto;z-index:5}
.bs-tcard{width:88px;background:var(--panel2);border:1px solid rgba(216,168,80,0.25);border-radius:6px;padding:6px 4px 5px;
  cursor:pointer;text-align:center;transition:all .12s;position:relative}
.bs-tcard:hover:not(.na):not(.locked){border-color:var(--goldt);transform:translateY(-3px)}
.bs-tcard.sel{border-color:var(--crimson);box-shadow:0 0 14px rgba(192,48,64,0.55)}
.bs-tcard.na{opacity:0.45}
.bs-tcard.locked{opacity:0.3;cursor:default}
.bs-tcard canvas{width:38px;height:38px}
.bs-tcard .tn{font-size:9.5px;color:#d8c8a8;line-height:1.1;height:21px}
.bs-tcard .tc{font-size:12px;color:#ffd76a;font-weight:700}
.bs-tcard .hk{position:absolute;top:2px;left:5px;font-size:9px;color:#8a7a5c}
.bs-tcard .lock{position:absolute;top:2px;right:5px;font-size:10px}
.bs-tcard .road{position:absolute;top:-7px;left:50%;transform:translateX(-50%);background:#5a4a20;color:#ffe9a0;
  font-size:8px;letter-spacing:0.12em;padding:1px 6px;border-radius:3px;border:1px solid #8a7030}
.bs-selpanel{position:absolute;right:14px;top:74px;width:242px;background:var(--panel);border:1px solid var(--edge);
  border-radius:8px;padding:14px;pointer-events:auto;z-index:6;display:none}
.bs-selpanel h3{color:#f0e2c0;font-size:17px;margin-bottom:2px}
.bs-selpanel .lvl{color:var(--goldt);font-size:12px;margin-bottom:8px;letter-spacing:0.15em}
.bs-selpanel .strow{display:flex;justify-content:space-between;font-size:12.5px;color:#b8a888;padding:2.5px 0}
.bs-selpanel .strow b{color:#e8dcc0}
.bs-selpanel .pbtn{display:block;width:100%;margin-top:8px;padding:10px 8px;border-radius:5px;cursor:pointer;font-family:inherit;
  font-weight:700;font-size:13px;letter-spacing:0.08em;border:1px solid var(--edge);background:#241d16;color:#d8c8a8;
  text-transform:uppercase;transition:all .12s}
.bs-selpanel .pbtn:hover:not(:disabled){border-color:var(--goldt)}
.bs-selpanel .pbtn.gold{background:linear-gradient(180deg,#6a5218,#443410);border-color:var(--goldt);color:#ffe9b0}
.bs-selpanel .pbtn.red{background:#3a1a1a;border-color:#7a3a3a;color:#e8b8b0}
.bs-selpanel .pbtn:disabled{opacity:0.4;cursor:default}
.bs-wavebox{position:absolute;left:14px;top:74px;background:var(--panel);border:1px solid var(--edge);border-radius:8px;
  padding:12px 14px;pointer-events:auto;max-width:236px;z-index:6}
.bs-wavebox .wtitle{font-size:11px;letter-spacing:0.2em;color:#b89868;text-transform:uppercase;margin-bottom:7px}
.bs-chip{display:inline-flex;align-items:center;gap:5px;background:#241d16;border:1px solid rgba(216,168,80,0.25);
  border-radius:3px;padding:2.5px 9px;font-size:11.5px;margin:2px;color:#d8c8a8}
.bs-chip.fly::after{content:'✈';font-size:9px;color:#9adcff}
.bs-chip.boss{border-color:var(--crimson);color:#ff9a8a}
.bs-startbtn{margin-top:9px;width:100%;background:linear-gradient(180deg,#7a2830,#4a161c);border:1px solid var(--crimson);
  color:#ffd8c0;font-family:inherit;font-weight:700;letter-spacing:0.1em;padding:9px;border-radius:5px;cursor:pointer;font-size:13.5px}
.bs-startbtn:hover{box-shadow:0 0 18px rgba(192,48,64,0.4)}
.bs-banner{position:absolute;top:30%;left:50%;transform:translate(-50%,-50%) scale(0.9);font-size:42px;font-weight:700;
  letter-spacing:0.22em;color:#f0e2c0;text-shadow:0 0 30px rgba(192,48,64,0.7),0 4px 16px #000;opacity:0;transition:all .4s;
  pointer-events:none;text-transform:uppercase;z-index:8;text-align:center}
.bs-banner.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
.bs-banner .sub{display:block;font-size:15px;letter-spacing:0.3em;color:#d8a850;margin-top:6px}
.bs-toasts{position:absolute;bottom:132px;right:16px;display:flex;flex-direction:column;gap:8px;z-index:9;pointer-events:none}
.bs-toast{background:var(--panel);border:1px solid var(--edge);border-radius:6px;padding:10px 16px;font-size:13.5px;
  color:#e8dcc0;animation:bstoast 3.6s forwards;max-width:290px}
.bs-toast b{color:var(--goldt)}
.bs-toast.achieve{border-color:var(--goldt);background:linear-gradient(180deg,rgba(64,50,16,0.95),rgba(24,18,8,0.95))}
@keyframes bstoast{0%{opacity:0;transform:translateX(40px)}8%{opacity:1;transform:none}82%{opacity:1}100%{opacity:0;transform:translateY(-8px)}}
.bs-hazard{position:absolute;top:112px;left:50%;transform:translateX(-50%);background:rgba(70,22,16,0.94);border:1px solid var(--crimson);
  color:#ffb0a0;border-radius:6px;padding:7px 20px;font-size:13.5px;display:none;z-index:7}
.bs-hazard.good{background:rgba(22,48,24,0.94);border-color:#4a8a3a;color:#b0e8a0}
.bs-overlay{position:absolute;inset:0;background:rgba(8,6,4,0.85);display:flex;flex-direction:column;align-items:center;
  justify-content:center;pointer-events:auto;z-index:20}
.bs-panelbox{background:var(--panel);border:1px solid var(--edge);border-radius:10px;padding:32px 42px;text-align:center;
  max-width:min(620px,92vw);max-height:88vh;overflow-y:auto;overflow-x:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.8)}
.bs-panelbox .bs-btn{max-width:100%;min-width:min(300px,80%)}
.bs-panelbox h2{font-size:28px;letter-spacing:0.16em;color:#f0e2c0;margin-bottom:16px;text-transform:uppercase}
.bs-setrow{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:13px 0;min-width:320px}
.bs-setrow label{font-size:14.5px;color:#d8c8a8}
.bs-setrow input[type=range]{width:170px;accent-color:var(--crimson)}
.bs-setrow select{background:#241d16;color:#e8dcc0;border:1px solid var(--edge);border-radius:4px;padding:5px 10px;font-family:inherit}
.bs-results-stars{font-size:50px;letter-spacing:0.2em;margin:8px 0 4px;color:#3c332a}
.bs-results-stars .lit{color:var(--goldt);text-shadow:0 0 24px rgba(216,168,80,0.8)}
.bs-resstats{display:grid;grid-template-columns:1fr 1fr;gap:5px 30px;margin:16px 0;text-align:left;font-size:13.5px;color:#b8a888}
.bs-resstats b{color:#e8dcc0;float:right}
.bs-achgrid{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow-y:auto;padding-right:6px;min-width:min(470px,80vw)}
.bs-ach{display:flex;align-items:center;gap:13px;background:var(--panel2);border:1px solid rgba(255,255,255,0.08);
  border-radius:6px;padding:9px 13px;text-align:left}
.bs-ach.earned{border-color:var(--goldt)}
.bs-ach .medal{font-size:22px;filter:grayscale(1);opacity:0.4}
.bs-ach.earned .medal{filter:none;opacity:1}
.bs-ach .an{font-size:14.5px;color:#f0e2c0;font-weight:700}
.bs-ach .ad{font-size:12px;color:#8a7a60}
.bs-vignette{position:absolute;inset:0;pointer-events:none;z-index:4;
  background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,0.45) 100%)}
.bs-dmgflash{position:absolute;inset:0;pointer-events:none;z-index:10;
  background:radial-gradient(ellipse at center,transparent 45%,rgba(200,40,30,0.4) 100%);opacity:0;transition:opacity .5s}
`;

const ICONS = {
  ballista(ctx, s) { // crossed-arm bolt thrower
    ctx.strokeStyle = '#e0b070'; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.85); ctx.lineTo(s * 0.5, s * 0.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.2, s * 0.45); ctx.quadraticCurveTo(s * 0.5, s * 0.7, s * 0.8, s * 0.45); ctx.stroke();
    ctx.fillStyle = '#e0b070';
    ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.08); ctx.lineTo(s * 0.42, s * 0.26); ctx.lineTo(s * 0.58, s * 0.26); ctx.closePath(); ctx.fill();
  },
  spire(ctx, s) { // crystal spire
    ctx.fillStyle = '#c89aff';
    ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.06); ctx.lineTo(s * 0.68, s * 0.5); ctx.lineTo(s * 0.5, s * 0.94); ctx.lineTo(s * 0.32, s * 0.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.12); ctx.lineTo(s * 0.58, s * 0.5); ctx.lineTo(s * 0.5, s * 0.5); ctx.closePath(); ctx.fill();
  },
  cauldron(ctx, s) {
    ctx.fillStyle = '#4a4440';
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.58, s * 0.3, 0.2, Math.PI - 0.2, false); ctx.closePath(); ctx.fill();
    ctx.fillRect(s * 0.22, s * 0.42, s * 0.56, s * 0.14);
    ctx.fillStyle = '#ff9a3a';
    ctx.beginPath(); ctx.ellipse(s * 0.5, s * 0.42, s * 0.26, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    for (const [dx, r] of [[-0.12, 0.05], [0.05, 0.04], [0.15, 0.05]]) {
      ctx.beginPath(); ctx.arc(s * (0.5 + dx), s * 0.3, s * r, 0, Math.PI * 2); ctx.fill();
    }
  },
  thorn(ctx, s) {
    ctx.strokeStyle = '#8fd435'; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s * 0.15, s * 0.8); ctx.quadraticCurveTo(s * 0.5, s * 0.55, s * 0.85, s * 0.8); ctx.stroke();
    for (const t of [0.25, 0.5, 0.75]) {
      const x = s * (0.15 + t * 0.7), y = s * (0.8 - Math.sin(t * Math.PI) * 0.24);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - s * 0.05, y - s * 0.22); ctx.stroke();
    }
  },
  crossbow(ctx, s) {
    ctx.strokeStyle = '#c8b890'; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s * 0.18, s * 0.35); ctx.quadraticCurveTo(s * 0.5, s * 0.12, s * 0.82, s * 0.35); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.16); ctx.lineTo(s * 0.5, s * 0.88); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.18, s * 0.35); ctx.lineTo(s * 0.82, s * 0.35); ctx.stroke();
  },
  beacon(ctx, s) {
    ctx.fillStyle = '#ffe9a0';
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.34, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = s * 0.05; ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(s * 0.5 + Math.cos(a) * s * 0.24, s * 0.34 + Math.sin(a) * s * 0.24);
      ctx.lineTo(s * 0.5 + Math.cos(a) * s * 0.36, s * 0.34 + Math.sin(a) * s * 0.36);
      ctx.stroke();
    }
    ctx.fillStyle = '#d8c8a0'; ctx.fillRect(s * 0.42, s * 0.52, s * 0.16, s * 0.36);
  },
  rune(ctx, s) {
    ctx.strokeStyle = '#5ad8e8'; ctx.lineWidth = s * 0.06;
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.5, s * 0.34, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.2); ctx.lineTo(s * 0.76, s * 0.65); ctx.lineTo(s * 0.24, s * 0.65); ctx.closePath(); ctx.stroke();
  },
  storm(ctx, s) {
    ctx.fillStyle = '#78d8ff';
    ctx.beginPath();
    ctx.moveTo(s * 0.58, s * 0.08); ctx.lineTo(s * 0.28, s * 0.55); ctx.lineTo(s * 0.47, s * 0.55);
    ctx.lineTo(s * 0.38, s * 0.92); ctx.lineTo(s * 0.74, s * 0.42); ctx.lineTo(s * 0.53, s * 0.42);
    ctx.closePath(); ctx.fill();
  },
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function iconCanvas(type, size = 38) {
  const c = document.createElement('canvas');
  c.width = size * 2; c.height = size * 2;
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  ICONS[type]?.(ctx, size);
  return c;
}
const fmt = (n) => Math.round(n * 10) / 10;
const cssHex = (n) => '#' + n.toString(16).padStart(6, '0');

export function createUI(container, handlers) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = el('div', 'bs-ui');
  container.appendChild(root);

  const layers = {};
  function screen(name) {
    if (layers[name]) layers[name].remove();
    const s = el('div', 'bs-screen');
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
    showMenu() {
      clearScreens();
      ui.hideHud();
      const s = screen('menu');
      s.append(el('div', 'bs-title', 'SIEGEHEART<small>DEFEND THE HEART</small>'));
      s.append(el('div', 'bs-sub', 'The enemy comes from every road. The keep must stand.'));
      const play = el('button', 'bs-btn primary', totalStars() > 0 ? 'CONTINUE THE DEFENSE' : 'BEGIN THE DEFENSE');
      play.onclick = () => { handlers.sfx('uiTap'); ui.showWorlds(); };
      const ach = el('button', 'bs-btn', `ACHIEVEMENTS <span style="color:#8a7a60;font-size:13px">${Object.keys(loadProfile().achievements).length}/${ACHIEVEMENTS.length}</span>`);
      ach.onclick = () => { handlers.sfx('uiTap'); ui.showAchievements(() => ui.showMenu()); };
      const set = el('button', 'bs-btn', 'SETTINGS');
      set.onclick = () => { handlers.sfx('uiTap'); ui.showSettings(() => {}); };
      const how = el('button', 'bs-btn', 'HOW TO PLAY');
      how.onclick = () => { handlers.sfx('uiTap'); ui.showHowTo(() => ui.showMenu()); };
      s.append(play, ach, how, set);
      s.append(el('div', '', `<div style="margin-top:34px;font-size:11px;color:#6a5c48;letter-spacing:0.12em">A FORGEFLOW GAMES PRODUCTION · ⭐ ${totalStars()}/135</div>`));
      handlers.music('menu');
    },

    showWorlds() {
      clearScreens();
      const s = screen('worlds');
      const back = el('button', 'bs-btn small bs-back', '← BACK');
      back.onclick = () => { handlers.sfx('uiBack'); ui.showMenu(); };
      s.append(back, el('h2', 'bs-h2', 'Choose a Front'), el('div', 'bs-h2sub', `⭐ ${totalStars()} / 135`));
      const cards = el('div', 'bs-cards');
      WORLDS.forEach((w, wi) => {
        const unlocked = isBiomeUnlocked(wi);
        const card = el('div', 'bs-card' + (unlocked ? '' : ' locked'));
        card.innerHTML = `
          <div class="swatch" style="background:linear-gradient(160deg,${cssHex(w.palette.sky)},${cssHex(w.palette.ground)})"></div>
          <h3>${w.name}</h3>
          <div class="tag">${w.tagline}</div>
          <div class="stars">${unlocked ? `⭐ ${biomeStars(wi)}/27` : '🔒 Clear the previous front'}</div>`;
        if (unlocked) card.onclick = () => { handlers.sfx('uiTap'); ui.showLevels(wi); };
        cards.appendChild(card);
      });
      s.appendChild(cards);
      handlers.music('menu');
    },

    showLevels(wi) {
      clearScreens();
      const w = WORLDS[wi];
      const s = screen('levels');
      const back = el('button', 'bs-btn small bs-back', '← FRONTS');
      back.onclick = () => { handlers.sfx('uiBack'); ui.showWorlds(); };
      s.append(back, el('h2', 'bs-h2', w.name), el('div', 'bs-h2sub', w.tagline));
      const grid = el('div', 'bs-lvlgrid');
      for (let li = 0; li < 9; li++) {
        const lv = levelDef(wi, li);
        const unlocked = isLevelUnlocked(wi, li);
        const isBossLvl = li === 2 || li === 5 || li === 8;
        const node = el('div', 'bs-lvl' + (unlocked ? '' : ' locked'));
        const st = starsFor(wi, li);
        node.innerHTML = `
          ${isBossLvl ? '<div class="boss-tag">BOSS</div>' : ''}
          <div class="num">${li + 1}</div>
          <div class="nm">${lv.name}</div>
          <div class="nm" style="color:#c08a6a">${roadsFor(wi, li)} roads in</div>
          <div class="st">${unlocked ? '★'.repeat(st) + '<span style="color:#3c332a">' + '★'.repeat(3 - st) + '</span>' : '🔒'}</div>`;
        if (unlocked) node.onclick = () => { handlers.sfx('uiTap'); handlers.startLevel(wi, li, false); };
        grid.appendChild(node);
      }
      s.appendChild(grid);
      const endless = el('button', 'bs-btn',
        isEndlessUnlocked(wi)
          ? `♾ ENDLESS SIEGE <span style="color:#8a7a60;font-size:13px">best: wave ${loadProfile().endlessBest[wi] || 0}</span>`
          : '♾ ENDLESS — clear level 9 to unlock');
      endless.disabled = !isEndlessUnlocked(wi);
      endless.onclick = () => { handlers.sfx('uiTap'); handlers.startLevel(wi, 8, true); };
      s.appendChild(endless);
      handlers.music('menu');
    },

    hud: null,
    showHud(ctx) {
      clearScreens();
      ui.hideHud();
      ui.closeOverlay();
      const h = {};
      ui.hud = h;
      // per-world assault flavor (icon + prep call-to-action) — no repeats across the campaign
      const WAVE_THEME = {
        colosseum: { icon: '📯', verb: 'SOUND THE HORN' },
        gothic:    { icon: '🦇', verb: 'TOLL THE BELL' },
        sky:       { icon: '🌪️', verb: 'CALL THE GALE' },
        crystal:   { icon: '💠', verb: 'STRIKE THE CHIME' },
        dwarven:   { icon: '⚒️', verb: 'STOKE THE FORGE' },
      };
      const wt = WAVE_THEME[ctx.level?.world?.id] || { icon: '⚔️', verb: 'SEND THE WAVE' };
      h.waveIcon = wt.icon; h.waveVerb = wt.verb;
      h.wrap = el('div');
      h.wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      root.appendChild(h.wrap);
      h.wrap.appendChild(el('div', 'bs-vignette'));
      h.flash = el('div', 'bs-dmgflash');
      h.wrap.appendChild(h.flash);

      const top = el('div', 'bs-hud-top');
      const bar = el('div', 'bs-hud-bar');
      bar.innerHTML = `
        <div class="bs-stat gold"><span class="coin"></span><span id="bs-gold">0</span></div>
        <div class="bs-bastion">
          <div class="lbl"><span>🏰 KEEP</span><span id="bs-hpnum">100/100</span></div>
          <div class="track"><div class="fill" id="bs-hpfill" style="width:100%"></div></div>
        </div>
        <div class="bs-stat wave" title="Assaults">${wt.icon} <span id="bs-wave">–</span><span id="bs-next" style="color:#c08a6a;font-size:11px;margin-left:6px"></span></div>`;
      const speed = el('div', 'bs-speed');
      for (const sp of [1, 2, 3]) {
        const btn = el('button', sp === 1 ? 'on' : '', sp + '×');
        btn.onclick = () => { handlers.setSpeed(sp); handlers.sfx('uiTap'); [...speed.children].forEach((c, i) => c.classList.toggle('on', i === sp - 1)); };
        speed.appendChild(btn);
      }
      bar.appendChild(speed);
      const pauseBtn = el('button', 'bs-pausebtn', '⏸');
      pauseBtn.onclick = () => handlers.pause();
      bar.appendChild(pauseBtn);
      top.appendChild(bar);
      h.wrap.appendChild(top);
      h.gold = bar.querySelector('#bs-gold');
      h.hpnum = bar.querySelector('#bs-hpnum');
      h.hpfill = bar.querySelector('#bs-hpfill');
      h.wave = bar.querySelector('#bs-wave');

      const bb = el('div', 'bs-hud-bottom');
      h.cards = {};
      TOWER_ORDER.forEach((tid, i) => {
        const d = TOWERS[tid];
        const unlocked = ctx.endless || isTowerUnlocked(tid, ctx.wi, ctx.li);
        const card = el('div', 'bs-tcard' + (unlocked ? '' : ' locked'));
        card.title = d.desc + (unlocked ? '' : '\n(Unlocks later in the campaign)');
        if (d.placement === 'road') card.appendChild(el('div', 'road', 'ROAD'));
        card.appendChild(el('div', 'hk', String(i + 1)));
        if (!unlocked) card.appendChild(el('div', 'lock', '🔒'));
        card.appendChild(iconCanvas(d.icon));
        card.append(el('div', 'tn', d.name), el('div', 'tc', '<span class="coin"></span>' + d.cost));
        if (unlocked) card.onclick = () => handlers.selectBuild(tid);
        bb.appendChild(card);
        h.cards[tid] = { card, unlocked };
      });
      h.wrap.appendChild(bb);

      h.wavebox = el('div', 'bs-wavebox');
      h.wavebox.innerHTML = `<div class="wtitle">Next Assault</div><div id="bs-chips"></div>`;
      h.startBtn = el('button', 'bs-startbtn', '⚔ SOUND THE HORN');
      h.startBtn.onclick = () => handlers.startWave();
      h.wavebox.appendChild(h.startBtn);
      h.wrap.appendChild(h.wavebox);
      h.chips = h.wavebox.querySelector('#bs-chips');

      h.sel = el('div', 'bs-selpanel');
      h.wrap.appendChild(h.sel);
      h.banner = el('div', 'bs-banner');
      h.wrap.appendChild(h.banner);
      h.hazard = el('div', 'bs-hazard');
      h.wrap.appendChild(h.hazard);
      h.toasts = el('div', 'bs-toasts');
      h.wrap.appendChild(h.toasts);
    },

    hideHud() { ui.hud?.wrap.remove(); ui.hud = null; },

    updateHud(sim, selection) {
      const h = ui.hud;
      if (!h) return;
      h.gold.textContent = sim.gold;
      h.hpnum.textContent = `${Math.ceil(sim.bastionHp)}/${sim.bastionMax}`;
      h.hpfill.style.width = (sim.bastionHp / sim.bastionMax * 100) + '%';
      h.wave.textContent = sim.endless ? `${sim.waveIdx + 1}` : `${Math.min(sim.waveIdx + 1, sim.waveTotal)}/${sim.waveTotal}`;
      for (const [tid, c] of Object.entries(h.cards)) {
        if (!c.unlocked) continue;
        c.card.classList.toggle('na', sim.gold < TOWERS[tid].cost);
        c.card.classList.toggle('sel', selection.buildType === tid);
      }
      const preview = sim.nextWavePreview();
      if (!preview.length) {
        h.wavebox.style.display = 'none';
      } else {
        h.wavebox.style.display = 'block';
        const chips = preview.map((p) =>
          `<span class="bs-chip${p.flying ? ' fly' : ''}${p.boss ? ' boss' : ''}" title="${enemyTip(p.type)}">${p.count}× ${p.name}</span>`).join('');
        if (h.chips.innerHTML !== chips) h.chips.innerHTML = chips;
        h.startBtn.textContent = sim.phase === 'prep' ? `⚔ ${h.waveVerb} (${Math.ceil(sim.prepT)}s)`
          : sim.phase === 'wave' ? `${h.waveIcon} CALL THE NEXT WAVE` : `⚔ ${h.waveVerb}`;
      }
      const nextEl = document.getElementById('bs-next');
      if (nextEl) {
        const t = sim.phase === 'wave' && isFinite(sim.autoNextAt) && preview.length
          ? Math.max(0, Math.ceil(sim.autoNextAt - sim.time)) : null;
        const txt = t !== null ? `next ${t}s` : '';
        if (nextEl.textContent !== txt) nextEl.textContent = txt;
      }
      ui.updateSelPanel(sim, selection);
    },

    updateSelPanel(sim, selection) {
      const h = ui.hud;
      if (!h) return;
      const tw = selection.towerId ? sim.towers.find((t) => t.id === selection.towerId) : null;
      if (!tw) { h.sel.style.display = 'none'; h.selSig = null; return; }
      h.sel.style.display = 'block';
      const d = tw.def;
      const lvl = tw.level;
      const canUp = lvl < 2;
      const upCost = canUp ? upgradeCost(tw.type, lvl) : 0;
      const afford = sim.gold >= upCost;
      const refund = Math.floor(tw.invested * SELL_REFUND);
      const sig = [tw.id, lvl, tw.mode, canUp, afford, refund].join('|');
      if (h.selSig !== sig) {
        h.selSig = sig;
        const rows = [];
        if (d.kind === 'aura') {
          rows.push(['Aura damage/s', d.auraDps[lvl] + (canUp ? ` <span style="color:#9c6">→ ${d.auraDps[lvl + 1]}</span>` : '')]);
          rows.push(['Keep repair/s', d.repair[lvl] + (canUp ? ` <span style="color:#9c6">→ ${d.repair[lvl + 1]}</span>` : '')]);
        } else if (d.kind === 'roadThorn') {
          rows.push(['Slow', Math.round(d.slowPct[lvl] * 100) + '%' + (canUp ? ` <span style="color:#9c6">→ ${Math.round(d.slowPct[lvl + 1] * 100)}%</span>` : '')]);
          rows.push(['Thorn damage/s', d.thornDps[lvl] + (canUp ? ` <span style="color:#9c6">→ ${d.thornDps[lvl + 1]}</span>` : '')]);
        } else if (d.kind === 'roadRune') {
          rows.push(['Blast damage', d.dmg[lvl] + (canUp ? ` <span style="color:#9c6">→ ${d.dmg[lvl + 1]}</span>` : '')]);
          rows.push(['Re-arm', d.rearm[lvl] + 's' + (canUp ? ` <span style="color:#9c6">→ ${d.rearm[lvl + 1]}s</span>` : '')]);
        } else {
          rows.push(['Damage', fmt(sim.effDmg(tw)) + (canUp ? ` <span style="color:#9c6">→ ${fmt(d.dmg[lvl + 1])}</span>` : '')]);
          rows.push(['Fire rate', fmt(sim.effRate(tw)) + '/s' + (canUp ? ` <span style="color:#9c6">→ ${fmt(d.rate[lvl + 1])}</span>` : '')]);
        }
        rows.push(['Range', fmt(d.range[lvl]) + (canUp ? ` <span style="color:#9c6">→ ${fmt(d.range[lvl + 1])}</span>` : '')]);
        rows.push(['Kills', `<b id="bs-selkills">${tw.kills}</b>`, true]);
        rows.push(['Damage dealt', `<b id="bs-seldmg">${Math.round(tw.dmgDealt)}</b>`, true]);
        h.sel.innerHTML = `
          <h3>${d.name}</h3>
          <div class="lvl">${'●'.repeat(lvl + 1)}${'○'.repeat(2 - lvl)} LEVEL ${lvl + 1}</div>
          ${rows.map(([k, v, raw]) => `<div class="strow">${k} ${raw ? v : `<b>${v}</b>`}</div>`).join('')}`;
        if (!['roadThorn', 'roadRune', 'aura'].includes(d.kind)) {
          const mode = el('button', 'pbtn', `🎯 Target: ${tw.mode.toUpperCase()}`);
          mode.onclick = () => {
            const next = TARGET_MODES[(TARGET_MODES.indexOf(tw.mode) + 1) % TARGET_MODES.length];
            handlers.setTargetMode(tw.id, next);
          };
          h.sel.appendChild(mode);
        }
        if (canUp) {
          const up = el('button', 'pbtn gold', `⬆ Upgrade <span class="coin"></span>${upCost}`);
          up.disabled = !afford;
          up.onclick = () => handlers.upgrade(tw.id);
          h.sel.appendChild(up);
        } else {
          h.sel.appendChild(el('div', 'lvl', '★ MAX LEVEL'));
        }
        const sell = el('button', 'pbtn red', `💰 Sell +<span class="coin"></span>${refund}`);
        sell.onclick = () => handlers.sell(tw.id);
        h.sel.appendChild(sell);
        h.selKills = h.sel.querySelector('#bs-selkills');
        h.selDmg = h.sel.querySelector('#bs-seldmg');
      } else {
        if (h.selKills) h.selKills.textContent = tw.kills;
        if (h.selDmg) h.selDmg.textContent = Math.round(tw.dmgDealt);
      }
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
      if (!h) return;
      const t = el('div', 'bs-toast' + (achieve ? ' achieve' : ''), html);
      h.toasts.appendChild(t);
      setTimeout(() => t.remove(), 3700);
    },
    damageFlash() {
      const h = ui.hud; if (!h) return;
      h.flash.style.opacity = '1';
      clearTimeout(h.flashT);
      h.flashT = setTimeout(() => { h.flash.style.opacity = '0'; }, 140);
    },

    overlay: null,
    closeOverlay() { ui.overlay?.remove(); ui.overlay = null; },
    showPause(onResume) {
      ui.closeOverlay();
      const o = el('div', 'bs-overlay');
      ui.overlay = o;
      const box = el('div', 'bs-panelbox');
      box.appendChild(el('h2', '', '⏸ Ceasefire'));
      const resume = el('button', 'bs-btn primary', 'RESUME');
      resume.onclick = () => { ui.closeOverlay(); onResume(); };
      const restart = el('button', 'bs-btn', 'RESTART LEVEL');
      restart.onclick = () => { ui.closeOverlay(); handlers.restart(); };
      const settings = el('button', 'bs-btn', 'SETTINGS');
      settings.onclick = () => ui.showSettings(() => ui.showPause(onResume));
      const how = el('button', 'bs-btn', 'HOW TO PLAY');
      how.onclick = () => ui.showHowTo(() => ui.showPause(onResume));
      const quit = el('button', 'bs-btn', 'ABANDON THE FIELD');
      quit.onclick = () => { ui.closeOverlay(); handlers.quitToMap(); };
      box.append(resume, restart, settings, how, quit);
      o.appendChild(box);
      root.appendChild(o);
    },

    // ---------------- HOW TO PLAY ----------------
    // Keys mirror the real bindings in game.js — they were undiscoverable before.
    showHowTo(onBack) {
      ui.closeOverlay();
      const o = el('div', 'bs-overlay');
      ui.overlay = o;
      const box = el('div', 'bs-panelbox');
      box.appendChild(el('h2', '', '📖 How to Play'));
      box.appendChild(el('div', '', `
        <div style="text-align:left;font-size:13.5px;line-height:1.75;color:#e2d8c6;max-width:460px">
          <b style="color:#e8b83a">Goal</b> — defend your KEEP at the center: every road leads to it. If the keep falls, the siege is lost.<br><br>
          <b style="color:#e8b83a">Build</b> — pick a tower (click a card or press <b>1–8</b>), then click a build pad. <b>Esc</b> cancels the pick.<br>
          <b style="color:#e8b83a">Waves</b> — press <b>SPACE</b> (or the button) to call the next wave early for bonus gold.<br>
          <b style="color:#e8b83a">Towers</b> — click one to select it · <b>U</b> upgrade · <b>X</b> sell · <b>Esc</b> deselect.<br>
          <b style="color:#e8b83a">Camera</b> — drag to orbit · wheel to zoom · <b>R</b> resets the view.<br>
          <b style="color:#e8b83a">Pause</b> — <b>Esc</b> (with nothing selected) opens the pause menu.
        </div>`));
      const closeB = el('button', 'bs-btn primary', 'GOT IT');
      closeB.onclick = () => { handlers.sfx('uiTap'); ui.closeOverlay(); onBack(); };
      box.appendChild(closeB);
      o.appendChild(box);
      root.appendChild(o);
    },

    showSettings(onBack) {
      ui.closeOverlay();
      const p = loadProfile();
      const o = el('div', 'bs-overlay');
      ui.overlay = o;
      const box = el('div', 'bs-panelbox');
      box.appendChild(el('h2', '', '⚙ Settings'));
      const mkSlider = (label, val, cb) => {
        const row = el('div', 'bs-setrow');
        row.innerHTML = `<label>${label}</label>`;
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.05; inp.value = val;
        inp.oninput = () => cb(parseFloat(inp.value));
        row.appendChild(inp);
        return row;
      };
      box.appendChild(mkSlider('Music volume', p.settings.music, (v) => handlers.setMusicVol(v)));
      box.appendChild(mkSlider('SFX volume', p.settings.sfx, (v) => handlers.setSfxVol(v)));
      const qrow = el('div', 'bs-setrow');
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
      const closeB = el('button', 'bs-btn primary', 'DONE');
      closeB.onclick = () => { handlers.saveSettings(); ui.closeOverlay(); onBack(); };
      const reset = el('button', 'bs-btn small', 'Reset all progress');
      reset.style.cssText = 'background:#3a1a1a;border-color:#7a3a3a;margin-top:18px';
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
      const o = el('div', 'bs-overlay');
      ui.overlay = o;
      const box = el('div', 'bs-panelbox');
      box.appendChild(el('h2', '', '🏆 Achievements'));
      const grid = el('div', 'bs-achgrid');
      for (const a of ACHIEVEMENTS) {
        const earned = !!p.achievements[a.id];
        grid.appendChild(el('div', 'bs-ach' + (earned ? ' earned' : ''), `
          <div class="medal">🎖️</div>
          <div><div class="an">${a.name}</div><div class="ad">${a.desc}</div></div>`));
      }
      box.appendChild(grid);
      const closeB = el('button', 'bs-btn primary', 'BACK');
      closeB.onclick = () => { ui.closeOverlay(); onBack(); };
      box.appendChild(closeB);
      o.appendChild(box);
      root.appendChild(o);
    },

    showResults({ won, stars, sim, endless, bestWave, onNext, onReplay, onMap }) {
      ui.closeOverlay();
      const o = el('div', 'bs-overlay');
      ui.overlay = o;
      const box = el('div', 'bs-panelbox');
      if (endless) {
        box.appendChild(el('h2', '', '♾ The Keep Has Fallen'));
        box.appendChild(el('div', '', `<div style="font-size:19px;color:#ffd76a;margin-bottom:8px">Held for <b>${sim.waveIdx + 1}</b> waves${bestWave ? ` · best ${bestWave}` : ''}</div>`));
      } else {
        box.appendChild(el('h2', '', won ? '🏰 The Keep Stands!' : '💥 The Keep Falls'));
        if (won) {
          const st = el('div', 'bs-results-stars');
          st.innerHTML = [1, 2, 3].map((i) => `<span class="${i <= stars ? 'lit' : ''}">★</span>`).join('');
          box.appendChild(st);
          box.appendChild(el('div', '', `<div style="color:#8a7a60;font-size:13px">${
            stars === 3 ? 'Not one stone out of place — 90%+ walls remaining.' :
            stars === 2 ? 'Scorched but standing — 50%+ walls remaining.' : 'It held. Barely.'}</div>`));
        }
      }
      const s = sim.stats;
      box.appendChild(el('div', 'bs-resstats', `
        <div>Constructs destroyed <b>${s.kills}</b></div><div>Breaches <b>${s.breaches}</b></div>
        <div>Gold earned <b>${s.goldEarned}</b></div><div>Towers built <b>${s.built}</b></div>
        <div>HP repaired <b>${Math.round(s.repairs)}</b></div><div>Waves held <b>${s.wavesCleared}</b></div>`));
      if (won && onNext) {
        const next = el('button', 'bs-btn primary', 'NEXT LEVEL →');
        next.onclick = () => { ui.closeOverlay(); onNext(); };
        box.appendChild(next);
      }
      const replay = el('button', 'bs-btn', won ? 'REPLAY' : 'TRY AGAIN');
      replay.onclick = () => { ui.closeOverlay(); onReplay(); };
      const map = el('button', 'bs-btn', 'BACK TO THE MAP');
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
  if (d.flying) bits.push('FLYING — Cauldron and road traps cannot touch it');
  if (d.armor) bits.push(`Armor ${Math.round(d.armor * 100)}% vs physical`);
  if (d.warding) bits.push(`Warded ${Math.round(d.warding * 100)}% vs magic`);
  if (d.shield) bits.push('Shielded — absorbs hits');
  if ((d.traits || []).includes('splitter')) bits.push('SPLITS when destroyed');
  if ((d.traits || []).includes('detonator')) bits.push('💣 DETONATOR — massive Keep damage');
  if ((d.traits || []).includes('siege')) bits.push('Siege engine — double Keep damage');
  if (d.boss) bits.push('BOSS');
  bits.push(`💔 ${d.siegeDmg} Keep damage on breach`);
  return bits.join('\n');
}
