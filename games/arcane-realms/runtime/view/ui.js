// Arcane Realms TCG — DOM UI layer: menu, deck builder, collection, settings,
// match HUD (hero plates, phase bar, banners, floaters, arrow, tooltips).

import { CARDS, COLLECTIBLE, REALMS, KEYWORD_INFO, cardById } from '../sim/cards.js?v=2';
import { STARTER_DECKS, validateDeck, DECK_SIZE, MAX_COPIES, MAX_LEGENDARY_COPIES } from '../sim/decks.js?v=2';
import { DIFFICULTIES } from '../sim/ai.js?v=2';
import { drawCard, cardThumb, CARD_W, CARD_H } from './cardtex.js?v=2';
import { Audio2 } from './audio.js?v=2';

// ── persistence ─────────────────────────────────────────────────
const LS_KEY = 'arcane_realms_save_v1';
export const Store = {
  data: null,
  load() {
    try { this.data = JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch { this.data = {}; }
    this.data.settings = Object.assign(
      { music: 0.6, sfx: 0.8, particles: true, shake: true, fastAnim: false },
      this.data.settings || {});
    this.data.decks = this.data.decks || [];
    this.data.record = this.data.record || { wins: 0, losses: 0 };
    return this.data;
  },
  save() { try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch { /* full */ } },
};

const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

// ── styles ──────────────────────────────────────────────────────
const CSS = `
:root{
  --gold:#d4952b; --gold-hi:#ffe9a8; --bg:#0b0714; --panel:#171226; --panel2:#211838;
  --text:#e8e0f5; --dim:#8d78b8; --red:#d43f3f; --green:#4fc06a; --blue:#4f8fe8;
}
#arc-ui{position:absolute;inset:0;pointer-events:none;font-family:Georgia,'Times New Roman',serif;color:var(--text);overflow:hidden}
#arc-ui .screen{position:absolute;inset:0;pointer-events:auto;display:none;flex-direction:column;background:var(--bg)}
#arc-ui .screen.on{display:flex}
.menu-bg{position:absolute;inset:0;background-size:cover;background-position:center;filter:saturate(1.05)}
.menu-veil{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 42%,rgba(11,7,20,.08) 0%,rgba(11,7,20,.78) 78%),linear-gradient(180deg,rgba(11,7,20,.42),rgba(11,7,20,.16) 30%,rgba(11,7,20,.88))}
.menu-inner{position:relative;margin:auto;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;padding:24px}
.game-title{font-size:clamp(40px,7vw,84px);font-weight:800;letter-spacing:.12em;line-height:.95;
  background:linear-gradient(180deg,#fff3c9 8%,#f0b93a 45%,#8a5a13 92%);-webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 2px 0 rgba(0,0,0,.0);filter:drop-shadow(0 4px 18px rgba(212,149,43,.45))}
.game-sub{letter-spacing:.55em;color:#c9b8ec;text-transform:uppercase;font-size:clamp(11px,1.6vw,16px);margin-top:-6px;text-shadow:0 2px 8px #000}
.btn{pointer-events:auto;cursor:pointer;user-select:none;border:1px solid rgba(212,149,43,.55);color:var(--text);
  background:linear-gradient(180deg,#2a1f47,#1a1230);padding:13px 34px;font-size:19px;font-family:inherit;letter-spacing:.08em;
  border-radius:10px;min-width:280px;text-align:center;transition:all .15s;box-shadow:0 4px 16px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08)}
.btn:hover{border-color:var(--gold-hi);background:linear-gradient(180deg,#3a2b60,#241840);transform:translateY(-1px);box-shadow:0 8px 22px rgba(212,149,43,.28)}
.btn:active{transform:translateY(1px)}
.btn.small{min-width:0;padding:8px 18px;font-size:15px}
.btn.primary{border-color:var(--gold-hi);background:linear-gradient(180deg,#8a5f16,#5c3d0c);color:#ffe9a8}
.btn.primary:hover{background:linear-gradient(180deg,#a87821,#6e4a10)}
.btn.danger{border-color:#a83a3a;color:#ffb8b8}
.btn:disabled{opacity:.45;cursor:default;transform:none}
.menu-foot{position:absolute;bottom:14px;width:100%;text-align:center;color:#6f5f96;font-size:13px;letter-spacing:.1em}
/* top bar for sub-screens */
.topbar{display:flex;align-items:center;gap:14px;padding:12px 18px;background:linear-gradient(180deg,#181028,#120c20);border-bottom:1px solid #2c2148;z-index:5}
.topbar h2{font-size:22px;letter-spacing:.14em;color:var(--gold-hi);font-weight:700;margin-right:auto}
/* modal */
.modal-wrap{position:absolute;inset:0;background:rgba(5,3,10,.72);display:flex;align-items:center;justify-content:center;z-index:60;pointer-events:auto}
.modal{background:linear-gradient(180deg,#221a3c,#150f26);border:1px solid #4a3a78;border-radius:14px;padding:26px 30px;max-width:min(92vw,760px);max-height:88vh;overflow:auto;box-shadow:0 18px 60px rgba(0,0,0,.7)}
.modal h3{color:var(--gold-hi);letter-spacing:.12em;font-size:22px;margin-bottom:14px;text-align:center}
/* setup */
.deck-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin:10px 0 18px}
.deck-tile{pointer-events:auto;cursor:pointer;border:1px solid #3a2a5c;border-radius:10px;padding:12px 14px;background:#1b1330;transition:all .12s}
.deck-tile:hover{border-color:var(--gold)}
.deck-tile.sel{border-color:var(--gold-hi);background:#2a1f47;box-shadow:0 0 0 1px var(--gold-hi), 0 6px 18px rgba(212,149,43,.25)}
.deck-tile .dname{font-size:17px;font-weight:700;color:var(--text)}
.deck-tile .dreal{font-size:12.5px;color:var(--dim);margin-top:3px}
.deck-tile .ddesc{font-size:12.5px;color:#a894cc;margin-top:6px;font-style:italic;line-height:1.35}
.diff-row{display:flex;gap:10px;justify-content:center;margin:8px 0 20px;flex-wrap:wrap}
.diff-tile{cursor:pointer;border:1px solid #3a2a5c;border-radius:10px;padding:10px 20px;background:#1b1330;text-align:center;min-width:150px}
.diff-tile:hover{border-color:var(--gold)}
.diff-tile.sel{border-color:var(--gold-hi);background:#2a1f47}
.diff-tile b{display:block;font-size:17px;color:var(--gold-hi);letter-spacing:.06em}
.diff-tile span{font-size:12px;color:var(--dim)}
/* builder + collection */
.build-wrap{flex:1;display:flex;min-height:0}
.col-side{flex:1;display:flex;flex-direction:column;min-width:0}
.filters{display:flex;gap:8px;align-items:center;padding:10px 16px;flex-wrap:wrap;background:#140e24;border-bottom:1px solid #251b40}
.filters input[type=text]{background:#1e1535;border:1px solid #3a2a5c;color:var(--text);padding:7px 12px;border-radius:8px;font-family:inherit;font-size:14px;width:190px}
.chip{cursor:pointer;border:1px solid #3a2a5c;color:var(--dim);border-radius:20px;padding:4px 13px;font-size:13.5px;user-select:none;letter-spacing:.03em}
.chip:hover{border-color:var(--gold)}
.chip.on{color:#fff;border-color:currentColor}
.grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:14px;padding:16px;align-content:start}
.cardcell{position:relative;cursor:pointer;transition:transform .12s;border-radius:10px}
.cardcell:hover{transform:translateY(-4px) scale(1.03);z-index:2}
.cardcell canvas{width:100%;height:auto;display:block;border-radius:10px;box-shadow:0 6px 16px rgba(0,0,0,.55)}
.cardcell .cnt{position:absolute;top:6px;right:6px;background:var(--gold);color:#1a1005;font-weight:700;font-size:14px;border-radius:12px;padding:2px 9px;box-shadow:0 2px 6px rgba(0,0,0,.6)}
.cardcell.dim canvas{filter:grayscale(.7) brightness(.55)}
.deck-side{width:320px;display:flex;flex-direction:column;background:#140e24;border-left:1px solid #2c2148}
.deck-side .dhead{padding:12px 14px;border-bottom:1px solid #251b40}
.deck-side input{width:100%;background:#1e1535;border:1px solid #3a2a5c;color:var(--text);padding:8px 12px;border-radius:8px;font-family:inherit;font-size:15px}
.deck-meta{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:13.5px;color:var(--dim)}
.deck-list{flex:1;overflow-y:auto;padding:8px}
.drow{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;cursor:pointer;border:1px solid transparent}
.drow:hover{background:#241840;border-color:#3a2a5c}
.drow .dcost{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex:none;box-shadow:inset 0 -2px 4px rgba(0,0,0,.5)}
.drow .dnm{flex:1;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.drow .dx{color:var(--gold-hi);font-size:13.5px}
.drow.leg .dnm{color:var(--gold-hi)}
.curve{display:flex;align-items:flex-end;gap:3px;height:44px;padding:8px 14px 4px}
.curve .bar{flex:1;background:linear-gradient(180deg,#7a5cb8,#3a2a5c);border-radius:3px 3px 0 0;min-height:2px;position:relative}
.curve .bar i{position:absolute;top:-15px;width:100%;text-align:center;font-size:10.5px;color:var(--dim);font-style:normal}
.curve .bar u{position:absolute;bottom:-16px;width:100%;text-align:center;font-size:10px;color:#5c4d80;text-decoration:none}
.deck-actions{display:flex;gap:8px;padding:10px 14px 14px;border-top:1px solid #251b40;flex-wrap:wrap}
/* match HUD */
#hud{position:absolute;inset:0;pointer-events:none;z-index:10}
.plate{position:absolute;left:14px;display:flex;align-items:center;gap:12px;pointer-events:auto}
.plate.me{bottom:16px}.plate.foe{top:16px}
.plate .portrait{width:78px;height:78px;border-radius:50%;border:3px solid var(--gold);background-size:cover;background-position:center;box-shadow:0 4px 18px rgba(0,0,0,.65)}
.plate.hit .portrait{animation:hitflash .45s}
@keyframes hitflash{0%{box-shadow:0 0 0 6px rgba(212,63,63,.9)}100%{box-shadow:0 4px 18px rgba(0,0,0,.65)}}
.plate .pcol{display:flex;flex-direction:column;gap:5px}
.plate .pname{font-size:15px;letter-spacing:.08em;color:#cbbCE8;color:#cbbce8}
.hporb{display:flex;align-items:center;gap:6px}
.hporb .orb{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px;color:#fff;
  background:radial-gradient(circle at 34% 30%,#ff9d9d,#c02a2a 62%,#5c0f0f);border:2px solid #7a1d1d;box-shadow:0 3px 10px rgba(0,0,0,.6)}
.manabar{display:flex;gap:3px;align-items:center}
.mana{width:15px;height:15px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#9fd4ff,#2f7fe8 60%,#123a78);border:1px solid #123a78;box-shadow:0 0 6px rgba(79,143,232,.6)}
.mana.spent{background:#241d3d;box-shadow:none;border-color:#3a2a5c}
.manatext{font-size:12.5px;color:#9fc4ff;margin-left:4px}
.zinfo{font-size:12px;color:var(--dim);display:flex;gap:10px}
/* phase bar + buttons */
#phasebar{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:6px;pointer-events:none}
#phasebar .ph{padding:5px 16px;border-radius:16px;font-size:12.5px;letter-spacing:.18em;color:#6f5f96;border:1px solid #2c2148;background:rgba(20,14,36,.8)}
#phasebar .ph.on{color:#1a1005;background:linear-gradient(180deg,#ffe9a8,#d4952b);border-color:#ffe9a8;font-weight:700}
#turnbtns{position:absolute;right:18px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:10px;pointer-events:auto}
#matchtools{position:absolute;top:14px;right:16px;display:flex;gap:8px;pointer-events:auto}
.tool{cursor:pointer;width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid #3a2a5c;background:rgba(23,18,38,.9);font-size:17px;color:var(--dim)}
.tool:hover{border-color:var(--gold);color:var(--gold-hi)}
/* floaters, banners, toasts */
.floater{position:absolute;transform:translate(-50%,-50%);font-weight:800;font-size:26px;pointer-events:none;z-index:40;
  text-shadow:0 2px 4px rgba(0,0,0,.9);animation:floatup 1.15s ease-out forwards}
.floater.dmg{color:#ff6a5f}.floater.heal{color:#6ae08a}.floater.bad{color:#e8a03a;font-size:19px}
.floater.info{color:#8ac4ff;font-size:19px}.floater.purple{color:#c98aff;font-size:20px}
.floater.big{font-size:38px}.floater.huge{color:#ffe9a8;font-size:44px;letter-spacing:.1em}
@keyframes floatup{0%{opacity:0;margin-top:6px}12%{opacity:1}72%{opacity:1}100%{opacity:0;margin-top:-56px}}
#banner{position:absolute;top:38%;width:100%;text-align:center;pointer-events:none;z-index:45}
#banner .btext{display:inline-block;font-size:52px;font-weight:800;letter-spacing:.3em;padding:10px 60px;color:var(--gold-hi);
  background:linear-gradient(90deg,transparent,rgba(20,12,34,.92) 18%,rgba(20,12,34,.92) 82%,transparent);
  text-shadow:0 0 30px rgba(212,149,43,.6);opacity:0}
#banner .btext.play{animation:bansweep 1.25s ease-in-out forwards}
#banner .btext.enemy{color:#ff8a7a;text-shadow:0 0 30px rgba(212,63,63,.6)}
@keyframes bansweep{0%{opacity:0;transform:scale(.86)}18%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(1.04)}}
#cardbanner{position:absolute;top:20%;width:100%;display:flex;justify-content:center;pointer-events:none;z-index:45}
#cardbanner .cb{display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,transparent,rgba(24,14,40,.95) 15%,rgba(24,14,40,.95) 85%,transparent);
  padding:10px 46px;opacity:0;animation:bansweep 1.5s ease-in-out forwards}
#cardbanner .rar{font-size:13px;letter-spacing:.4em;text-transform:uppercase}
#cardbanner .nm{font-size:30px;font-weight:800;letter-spacing:.08em}
#toasts{position:absolute;bottom:120px;width:100%;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:44}
.toast{background:rgba(23,16,40,.94);border:1px solid #4a3a78;color:#d8ccf2;padding:8px 22px;border-radius:22px;font-size:15px;animation:toastin 2.6s forwards}
@keyframes toastin{0%{opacity:0;transform:translateY(8px)}10%{opacity:1;transform:none}78%{opacity:1}100%{opacity:0}}
/* arrow svg */
#arrow-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:35}
/* floating hover-preview card — always on top */
#hovercard{position:fixed;width:292px;pointer-events:none;z-index:90;display:none;filter:drop-shadow(0 18px 44px rgba(0,0,0,.85))}
#hovercard canvas{width:100%;border-radius:14px;display:block}
#hovercard .hstat{margin-top:6px;text-align:center;background:rgba(14,9,26,.95);border:1px solid #4a3a78;border-radius:9px;padding:6px 10px;font-size:13.5px;color:#ffd45f;letter-spacing:.03em}
/* inspect */
#inspect{position:absolute;right:14px;top:50%;transform:translateY(-50%);width:262px;pointer-events:none;z-index:38;display:none}
#inspect canvas{width:100%;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.8)}
#inspect .kws{margin-top:8px;background:rgba(18,12,32,.94);border:1px solid #3a2a5c;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#c4b4e4;line-height:1.5}
#inspect .kws b{color:var(--gold-hi)}
/* game over */
#gameover{height:100%}
#gameover .gwrap{margin:auto;text-align:center;display:flex;flex-direction:column;gap:18px;align-items:center}
#gameover .gtitle{font-size:88px;font-weight:800;letter-spacing:.2em}
#gameover .gtitle.win{background:linear-gradient(180deg,#fff3c9,#f0b93a 55%,#8a5a13);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 24px rgba(212,149,43,.5))}
#gameover .gtitle.lose{color:#8d78b8;filter:drop-shadow(0 6px 24px rgba(90,60,140,.5))}
#gameover .gstats{color:var(--dim);font-size:17px;letter-spacing:.06em;line-height:1.7}
/* settings rows */
.set-row{display:flex;align-items:center;justify-content:space-between;gap:26px;padding:12px 4px;border-bottom:1px solid #251b40;min-width:420px}
.set-row label{font-size:16.5px;letter-spacing:.04em}
.set-row input[type=range]{width:210px;accent-color:var(--gold)}
.switch{cursor:pointer;width:52px;height:26px;border-radius:14px;background:#241d3d;border:1px solid #3a2a5c;position:relative;transition:background .15s}
.switch.on{background:#5c3d0c;border-color:var(--gold)}
.switch i{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#8d78b8;transition:all .15s}
.switch.on i{left:28px;background:var(--gold-hi)}
.hint{color:#6f5f96;font-size:13px;text-align:center;letter-spacing:.05em}
@media (max-width:900px){ .deck-side{width:260px} .game-title{letter-spacing:.06em} #inspect{display:none!important} }
`;

export class UI {
  constructor(container, { onPlay, onSpeedChange }) {
    this.container = container;
    this.onPlay = onPlay;
    this.onSpeedChange = onSpeedChange;
    this.match = null;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'arc-ui';
    container.appendChild(this.root);
    this.store = Store.load();
    Audio2.musicVolume = this.store.settings.music;
    Audio2.sfxVolume = this.store.settings.sfx;
    this.buildScreens();
    this.hoverTimer = null;
  }

  el(tag, cls, html) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  show(name) {
    for (const s of this.root.querySelectorAll('.screen')) s.classList.remove('on');
    this.root.querySelector('#scr-' + name)?.classList.add('on');
    if (name === 'menu') {
      Audio2.playMusic('menu');
      const foot = this.root.querySelector('#scr-menu .menu-foot');
      if (foot) {
        const rec = this.store.record;
        foot.textContent = `${COLLECTIBLE.length} cards · 5 realms · Record ${rec.wins}W–${rec.losses}L · ForgeFlow Games · v1.0`;
      }
    }
  }

  // ═══════════════ screens ═══════════════
  buildScreens() {
    this.buildMenu();
    this.buildSetup();
    this.buildBuilder();
    this.buildCollection();
    this.buildSettings();
    this.buildHud();
    this.buildGameOver();
    this.show('menu');
  }

  buildMenu() {
    const s = this.el('div', 'screen', '');
    s.id = 'scr-menu';
    const bg = this.el('div', 'menu-bg');
    bg.style.backgroundImage = 'url(assets/ui/menu_bg.jpg)';
    const veil = this.el('div', 'menu-veil');
    const inner = this.el('div', 'menu-inner');
    inner.append(
      this.el('div', 'game-title', 'ARCANE REALMS'),
      this.el('div', 'game-sub', 'Trading Card Game'),
    );
    const spacer = this.el('div'); spacer.style.height = '22px';
    inner.append(spacer);
    const mk = (label, fn, primary) => {
      const b = this.el('button', 'btn' + (primary ? ' primary' : ''), label);
      b.onclick = () => { Audio2.ensure(); Audio2.resume(); Audio2.sfx('click'); fn(); };
      inner.append(b);
      return b;
    };
    mk('⚔ &nbsp;Play vs AI', () => this.openSetup(), true);
    mk('🌐 &nbsp;Play vs Other Players', () => this.openOnline());
    mk('🛠 &nbsp;Deck Builder', () => this.openBuilder());
    mk('📖 &nbsp;Collection', () => this.openCollection());
    mk('⚙ &nbsp;Settings', () => this.show('settings'));
    const rec = this.store.record;
    const foot = this.el('div', 'menu-foot',
      `${COLLECTIBLE.length} cards · 5 realms · Record ${rec.wins}W–${rec.losses}L · ForgeFlow Games · v1.0`);
    s.append(bg, veil, inner, foot);
    this.root.append(s);
  }

  buildSetup() {
    const s = this.el('div', 'screen');
    s.id = 'scr-setup';
    this.root.append(s);
  }

  openSetup() {
    const s = this.root.querySelector('#scr-setup');
    s.innerHTML = '';
    const bg = this.el('div', 'menu-bg');
    bg.style.backgroundImage = 'url(assets/ui/menu_bg.jpg)';
    s.append(bg, this.el('div', 'menu-veil'));
    const wrap = this.el('div', 'modal-wrap');
    wrap.style.position = 'relative';
    wrap.style.background = 'transparent';
    const m = this.el('div', 'modal');
    m.append(this.el('h3', null, 'CHOOSE YOUR DECK'));
    const grid = this.el('div', 'deck-pick');
    const decks = [...STARTER_DECKS, ...this.store.decks.filter((d) => validateDeck(d.cards).ok)];
    let selDeck = decks[0];
    let selDiff = this.store.lastDiff || 'knight';
    const tiles = [];
    for (const d of decks) {
      const t = this.el('div', 'deck-tile');
      const realms = (d.realms || validateDeck(d.cards).realms).map((r) => REALMS[r]?.name).filter(Boolean).join(' + ') || 'Neutral';
      t.append(
        this.el('div', 'dname', d.name),
        this.el('div', 'dreal', realms + (d.id?.startsWith('starter') ? '' : ' · custom')),
        this.el('div', 'ddesc', d.desc || ''),
      );
      t.onclick = () => { Audio2.sfx('click'); selDeck = d; tiles.forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); };
      tiles.push(t);
      grid.append(t);
    }
    tiles[0].classList.add('sel');
    m.append(grid, this.el('h3', null, 'DIFFICULTY'));
    const dr = this.el('div', 'diff-row');
    const dtiles = {};
    const DIFF_DESC = { squire: 'Learns the ropes with you', knight: 'A worthy strategist', archmage: 'Reads two moves ahead' };
    for (const [k, v] of Object.entries(DIFFICULTIES)) {
      const t = this.el('div', 'diff-tile', `<b>${v.label}</b><span>${DIFF_DESC[k]}</span>`);
      t.onclick = () => { Audio2.sfx('click'); selDiff = k; Object.values(dtiles).forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); };
      dtiles[k] = t;
      dr.append(t);
    }
    dtiles[selDiff]?.classList.add('sel');
    m.append(dr);
    const row = this.el('div');
    row.style.cssText = 'display:flex;gap:12px;justify-content:center';
    const back = this.el('button', 'btn small', '← Back');
    back.onclick = () => { Audio2.sfx('click'); this.show('menu'); };
    const go = this.el('button', 'btn primary', '⚔ &nbsp;TO BATTLE');
    go.onclick = () => {
      Audio2.sfx('click');
      this.store.lastDiff = selDiff;
      Store.save();
      this.onPlay(selDeck, selDiff);
    };
    row.append(back, go);
    m.append(row);
    wrap.append(m);
    s.append(wrap);
    this.show('setup');
  }

  // ═══════════════ online lobby ═══════════════
  openOnline() {
    const s = this.root.querySelector('#scr-setup');
    s.innerHTML = '';
    const bg = this.el('div', 'menu-bg');
    bg.style.backgroundImage = 'url(assets/ui/menu_bg.jpg)';
    s.append(bg, this.el('div', 'menu-veil'));
    const wrap = this.el('div', 'modal-wrap');
    wrap.style.position = 'relative';
    wrap.style.background = 'transparent';
    const m = this.el('div', 'modal');
    m.append(this.el('h3', null, '🌐 PLAY VS OTHER PLAYERS'));

    m.append(this.el('h3', null, 'YOUR DECK'));
    const grid = this.el('div', 'deck-pick');
    const decks = [...STARTER_DECKS, ...this.store.decks.filter((d) => validateDeck(d.cards).ok)];
    let selDeck = decks[0];
    const tiles = [];
    for (const d of decks) {
      const t = this.el('div', 'deck-tile');
      const realms = (d.realms || validateDeck(d.cards).realms).map((r) => REALMS[r]?.name).filter(Boolean).join(' + ') || 'Neutral';
      t.append(this.el('div', 'dname', d.name), this.el('div', 'dreal', realms));
      t.onclick = () => { Audio2.sfx('click'); selDeck = d; tiles.forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); };
      tiles.push(t);
      grid.append(t);
    }
    tiles[0].classList.add('sel');
    m.append(grid);

    const statusEl = this.el('div', 'hint', 'Pick how to find your opponent.');
    statusEl.style.cssText += ';margin:8px 0 14px;font-size:15px;color:#c9b8ec;min-height:22px';

    const row = this.el('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:12px';
    const quick = this.el('button', 'btn primary', '⚡ Quick Match');
    const create = this.el('button', 'btn', '🏰 Create Room');
    const joinWrap = this.el('div');
    joinWrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    const codeIn = this.el('input');
    codeIn.placeholder = 'CODE';
    codeIn.maxLength = 8;
    codeIn.style.cssText = 'width:110px;text-transform:uppercase;background:#1e1535;border:1px solid #3a2a5c;color:#ffe9a8;padding:11px 12px;border-radius:8px;font-family:inherit;font-size:17px;letter-spacing:.2em;text-align:center';
    const join = this.el('button', 'btn', 'Join Room');
    joinWrap.append(codeIn, join);
    row.append(quick, create, joinWrap);
    m.append(row, statusEl);

    const back = this.el('button', 'btn small', '← Back');
    back.style.cssText = 'display:block;margin:0 auto';
    m.append(back);
    wrap.append(m);
    s.append(wrap);
    this.show('setup');

    let session = null;
    const lock = (on) => { [quick, create, join].forEach((b) => (b.disabled = on)); };
    const go = (mode) => {
      const code = codeIn.value.trim().toUpperCase();
      if (mode === 'join' && !code) { statusEl.textContent = 'Enter the room code first.'; return; }
      Audio2.ensure(); Audio2.resume(); Audio2.sfx('click');
      lock(true);
      session = this.onOnline(selDeck, mode, code, (msg) => { statusEl.textContent = msg; }, (err) => {
        statusEl.textContent = '⚠ ' + err;
        lock(false);
        session = null;
      });
    };
    quick.onclick = () => go('quick');
    create.onclick = () => go('create');
    join.onclick = () => go('join');
    back.onclick = () => {
      Audio2.sfx('click');
      if (session) { try { session.cancel(); } catch { /* closed */ } }
      this.show('menu');
    };
  }

  // ═══════════════ deck builder ═══════════════
  buildBuilder() {
    const s = this.el('div', 'screen');
    s.id = 'scr-builder';
    this.root.append(s);
  }

  openBuilder(deck) {
    this.working = deck ? JSON.parse(JSON.stringify(deck)) : null;
    const s = this.root.querySelector('#scr-builder');
    s.innerHTML = '';
    if (!this.working) {
      // deck list first
      const top = this.el('div', 'topbar');
      const back = this.el('button', 'btn small', '← Menu');
      back.onclick = () => { Audio2.sfx('click'); this.show('menu'); };
      top.append(this.el('h2', null, 'DECK BUILDER'), back);
      const grid = this.el('div', 'deck-pick');
      grid.style.padding = '20px';
      const mkTile = (d, custom) => {
        const t = this.el('div', 'deck-tile');
        const v = validateDeck(d.cards);
        const realms = (v.realms || []).map((r) => REALMS[r]?.name).join(' + ') || 'Neutral';
        t.append(
          this.el('div', 'dname', d.name),
          this.el('div', 'dreal', `${realms} · ${d.cards.length}/30${v.ok ? '' : ' · ⚠ invalid'}`),
          this.el('div', 'ddesc', custom ? 'Click to edit' : (d.desc || '') + ' · click to copy & edit'),
        );
        t.onclick = () => {
          Audio2.sfx('click');
          if (custom) this.openBuilder(d);
          else this.openBuilder({ id: 'deck_' + Date.now(), name: d.name + ' (copy)', cards: d.cards.slice(), hero: d.hero });
        };
        return t;
      };
      const fresh = this.el('div', 'deck-tile');
      fresh.append(this.el('div', 'dname', '✚ New Deck'), this.el('div', 'ddesc', 'Start from scratch'));
      fresh.onclick = () => { Audio2.sfx('click'); this.openBuilder({ id: 'deck_' + Date.now(), name: 'New Deck', cards: [], hero: 'neutral' }); };
      grid.append(fresh);
      for (const d of this.store.decks) grid.append(mkTile(d, true));
      for (const d of STARTER_DECKS) grid.append(mkTile(d, false));
      s.append(top, grid);
      this.show('builder');
      return;
    }
    // editor
    const top = this.el('div', 'topbar');
    const back = this.el('button', 'btn small', '← Decks');
    back.onclick = () => { Audio2.sfx('click'); this.openBuilder(); };
    top.append(this.el('h2', null, 'DECK EDITOR'), back);
    const wrap = this.el('div', 'build-wrap');
    const colSide = this.el('div', 'col-side');
    const deckSide = this.el('div', 'deck-side');
    wrap.append(colSide, deckSide);
    s.append(top, wrap);
    this.filterState = { search: '', realm: null, cost: null, type: null, rarity: null };
    this.buildFilters(colSide, () => this.renderGrid());
    this.gridEl = this.el('div', 'grid');
    colSide.append(this.gridEl);
    // deck panel
    const dh = this.el('div', 'dhead');
    const nameIn = this.el('input');
    nameIn.value = this.working.name;
    nameIn.oninput = () => { this.working.name = nameIn.value; };
    const meta = this.el('div', 'deck-meta');
    this.deckMetaEl = meta;
    dh.append(nameIn, meta);
    this.curveEl = this.el('div', 'curve');
    this.deckListEl = this.el('div', 'deck-list');
    const actions = this.el('div', 'deck-actions');
    const save = this.el('button', 'btn small primary', '💾 Save');
    save.onclick = () => {
      Audio2.sfx('click');
      const i = this.store.decks.findIndex((d) => d.id === this.working.id);
      const v = validateDeck(this.working.cards);
      this.working.realms = v.realms;
      this.working.hero = v.realms[0] || 'neutral';
      if (i >= 0) this.store.decks[i] = this.working; else this.store.decks.push(this.working);
      Store.save();
      this.toast(v.ok ? 'Deck saved — battle ready!' : 'Saved (not battle-legal yet: ' + v.errors[0] + ')');
    };
    const fill = this.el('button', 'btn small', '✨ Smart Fill');
    fill.onclick = () => { Audio2.sfx('click'); this.smartFill(); };
    const clear = this.el('button', 'btn small', 'Clear');
    clear.onclick = () => { Audio2.sfx('click'); this.working.cards = []; this.renderDeckPanel(); this.renderGrid(); };
    const del = this.el('button', 'btn small danger', 'Delete');
    del.onclick = () => {
      Audio2.sfx('click');
      this.store.decks = this.store.decks.filter((d) => d.id !== this.working.id);
      Store.save();
      this.openBuilder();
    };
    actions.append(save, fill, clear, del);
    deckSide.append(dh, this.curveEl, this.deckListEl, actions);
    this.renderGrid();
    this.renderDeckPanel();
    this.show('builder');
  }

  buildFilters(parent, onChange) {
    const bar = this.el('div', 'filters');
    const search = this.el('input');
    search.type = 'text';
    search.placeholder = '🔎 Search cards…';
    search.oninput = () => { this.filterState.search = search.value.toLowerCase(); onChange(); };
    bar.append(search);
    const mkChips = (key, items) => {
      for (const [val, label, color] of items) {
        const c = this.el('div', 'chip', label);
        if (color) c.style.color = color;
        c.onclick = () => {
          Audio2.sfx('click');
          this.filterState[key] = this.filterState[key] === val ? null : val;
          bar.querySelectorAll(`.chip[data-k="${key}"]`).forEach((x) => x.classList.remove('on'));
          if (this.filterState[key] === val) c.classList.add('on');
          onChange();
        };
        c.dataset.k = key;
        bar.append(c);
      }
    };
    mkChips('realm', Object.entries(REALMS).map(([id, r]) => [id, r.name, r.css]));
    mkChips('type', [['creature', 'Creatures'], ['spell', 'Spells'], ['trap', 'Traps']]);
    mkChips('rarity', [['common', 'C'], ['uncommon', 'U'], ['rare', 'R'], ['epic', 'E', '#b44fe8'], ['legendary', 'L', '#f0b93a']]);
    mkChips('cost', [[0, '0-2'], [3, '3-4'], [5, '5-6'], [7, '7+']]);
    parent.append(bar);
  }

  filteredCards() {
    const f = this.filterState;
    return COLLECTIBLE.filter((c) => {
      if (f.search && !(c.name.toLowerCase().includes(f.search) || (c.text || '').toLowerCase().includes(f.search) || (c.tribe || '').toLowerCase().includes(f.search))) return false;
      if (f.realm && c.realm !== f.realm) return false;
      if (f.type && c.type !== f.type) return false;
      if (f.rarity && c.rarity !== f.rarity) return false;
      if (f.cost != null) {
        if (f.cost === 0 && c.cost > 2) return false;
        if (f.cost === 3 && (c.cost < 3 || c.cost > 4)) return false;
        if (f.cost === 5 && (c.cost < 5 || c.cost > 6)) return false;
        if (f.cost === 7 && c.cost < 7) return false;
      }
      return true;
    }).sort((a, b) => a.cost - b.cost || (RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]) || a.name.localeCompare(b.name));
  }

  renderGrid() {
    const grid = this.gridEl;
    grid.innerHTML = '';
    const counts = {};
    if (this.working) for (const id of this.working.cards) counts[id] = (counts[id] || 0) + 1;
    const deckRealms = this.working ? new Set(this.working.cards.map((id) => CARDS[id].realm).filter((r) => r !== 'neutral')) : new Set();
    for (const c of this.filteredCards()) {
      const cell = this.el('div', 'cardcell');
      cell.append(cardThumb(c.id, 210));
      cell.onmouseenter = (e) => this.hoverPreview(c.id, null, e.clientX, e.clientY, 'grid');
      cell.onmousemove = (e) => this.hoverPreview(c.id, null, e.clientX, e.clientY, 'grid');
      cell.onmouseleave = () => this.hoverPreview(null);
      const n = counts[c.id] || 0;
      if (n) cell.append(this.el('div', 'cnt', '×' + n));
      if (this.working) {
        const cap = c.rarity === 'legendary' ? MAX_LEGENDARY_COPIES : MAX_COPIES;
        const realmLocked = c.realm !== 'neutral' && deckRealms.size >= 2 && !deckRealms.has(c.realm);
        if (n >= cap || realmLocked || this.working.cards.length >= DECK_SIZE) cell.classList.add('dim');
        cell.onclick = () => {
          if (this.working.cards.length >= DECK_SIZE) return this.toast('Deck is full (30).');
          if (n >= cap) return this.toast(`Max ${cap} cop${cap > 1 ? 'ies' : 'y'} of ${c.name}.`);
          if (realmLocked) return this.toast('Two realms already chosen — only those + Neutral allowed.');
          Audio2.sfx('click');
          this.working.cards.push(c.id);
          this.renderDeckPanel();
          this.renderGrid();
        };
        cell.oncontextmenu = (e) => { e.preventDefault(); this.showInspect(c.id); };
      } else {
        cell.onclick = () => { Audio2.sfx('click'); this.showInspect(c.id); };
      }
      grid.append(cell);
    }
  }

  renderDeckPanel() {
    const d = this.working;
    const v = validateDeck(d.cards);
    this.deckMetaEl.innerHTML = `<span>${d.cards.length}/${DECK_SIZE} cards</span><span>${(v.realms || []).map((r) => `<b style="color:${REALMS[r].css}">${REALMS[r].name}</b>`).join(' + ') || 'No realm yet'}</span>`;
    // curve
    const buckets = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const id of d.cards) buckets[Math.min(7, CARDS[id].cost)]++;
    const mx = Math.max(3, ...buckets);
    this.curveEl.innerHTML = '';
    buckets.forEach((b, i) => {
      const bar = this.el('div', 'bar', `<i>${b || ''}</i><u>${i === 7 ? '7+' : i}</u>`);
      bar.style.height = Math.max(4, (b / mx) * 34) + 'px';
      this.curveEl.append(bar);
    });
    // list
    const agg = new Map();
    for (const id of d.cards) agg.set(id, (agg.get(id) || 0) + 1);
    const rows = [...agg.entries()].sort((a, b) => CARDS[a[0]].cost - CARDS[b[0]].cost || CARDS[a[0]].name.localeCompare(CARDS[b[0]].name));
    this.deckListEl.innerHTML = '';
    for (const [id, n] of rows) {
      const c = CARDS[id];
      const row = this.el('div', 'drow' + (c.rarity === 'legendary' ? ' leg' : ''));
      const cost = this.el('div', 'dcost', c.cost);
      cost.style.background = `radial-gradient(circle at 35% 30%, ${REALMS[c.realm].css}, #1a1226 130%)`;
      row.append(cost, this.el('div', 'dnm', c.name), this.el('div', 'dx', '×' + n));
      row.onclick = () => {
        Audio2.sfx('click');
        const i = d.cards.indexOf(id);
        if (i >= 0) d.cards.splice(i, 1);
        this.renderDeckPanel(); this.renderGrid();
      };
      row.oncontextmenu = (e) => { e.preventDefault(); this.showInspect(id); };
      this.deckListEl.append(row);
    }
  }

  smartFill() {
    const d = this.working;
    const realms = new Set(d.cards.map((id) => CARDS[id].realm).filter((r) => r !== 'neutral'));
    if (realms.size === 0) { realms.add(['ember', 'tide', 'grove', 'dawn', 'grave'][Math.floor(Math.random() * 5)]); }
    const pool = COLLECTIBLE.filter((c) => c.realm === 'neutral' || realms.has(c.realm) || (realms.size < 2 && c.realm !== 'neutral'))
      .sort((a, b) => a.cost - b.cost);
    const counts = {};
    for (const id of d.cards) counts[id] = (counts[id] || 0) + 1;
    // target curve: favor 2-4 cost
    const want = (cost) => (cost <= 1 ? 4 : cost <= 4 ? 14 : cost <= 6 ? 8 : 4);
    let guard = 0;
    while (d.cards.length < DECK_SIZE && guard++ < 900) {
      const buckets = [0, 0, 0, 0, 0, 0, 0, 0];
      for (const id of d.cards) buckets[Math.min(7, CARDS[id].cost)]++;
      const cands = pool.filter((c) => {
        const cap = c.rarity === 'legendary' ? 1 : 2;
        if ((counts[c.id] || 0) >= cap) return false;
        const r = new Set([...realms]);
        if (c.realm !== 'neutral') r.add(c.realm);
        return r.size <= 2;
      });
      if (!cands.length) break;
      // pick the card whose cost bucket is furthest under target
      cands.sort((a, b) => {
        const ba = buckets[Math.min(7, a.cost)] / want(a.cost);
        const bb = buckets[Math.min(7, b.cost)] / want(b.cost);
        return ba - bb || Math.random() - 0.5;
      });
      const pick = cands[Math.floor(Math.random() * Math.min(4, cands.length))];
      d.cards.push(pick.id);
      counts[pick.id] = (counts[pick.id] || 0) + 1;
      if (pick.realm !== 'neutral') realms.add(pick.realm);
    }
    this.renderDeckPanel(); this.renderGrid();
    this.toast('Deck filled — tune it to taste.');
  }

  // ═══════════════ collection ═══════════════
  buildCollection() {
    const s = this.el('div', 'screen');
    s.id = 'scr-collection';
    this.root.append(s);
  }
  openCollection() {
    const s = this.root.querySelector('#scr-collection');
    s.innerHTML = '';
    const top = this.el('div', 'topbar');
    const back = this.el('button', 'btn small', '← Menu');
    back.onclick = () => { Audio2.sfx('click'); this.show('menu'); };
    top.append(this.el('h2', null, `COLLECTION — ${COLLECTIBLE.length} CARDS`), back);
    const col = this.el('div', 'col-side');
    this.working = null;
    this.filterState = { search: '', realm: null, cost: null, type: null, rarity: null };
    this.buildFilters(col, () => this.renderGrid());
    this.gridEl = this.el('div', 'grid');
    this.gridEl.style.gridTemplateColumns = 'repeat(auto-fill,minmax(178px,1fr))';
    col.append(this.gridEl);
    s.append(top, col);
    this.renderGrid();
    this.show('collection');
  }

  // ═══════════════ settings ═══════════════
  buildSettings() {
    const s = this.el('div', 'screen');
    s.id = 'scr-settings';
    const top = this.el('div', 'topbar');
    const back = this.el('button', 'btn small', '← Menu');
    back.onclick = () => { Audio2.sfx('click'); Store.save(); this.show('menu'); };
    top.append(this.el('h2', null, 'SETTINGS'), back);
    const wrap = this.el('div');
    wrap.style.cssText = 'margin:auto;display:flex;flex-direction:column;gap:2px;padding:20px';
    const st = this.store.settings;
    const slider = (label, key, apply) => {
      const row = this.el('div', 'set-row');
      const inp = this.el('input');
      inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.05; inp.value = st[key];
      inp.oninput = () => { st[key] = parseFloat(inp.value); apply(st[key]); Store.save(); };
      row.append(this.el('label', null, label), inp);
      wrap.append(row);
    };
    const toggle = (label, key, apply) => {
      const row = this.el('div', 'set-row');
      const sw = this.el('div', 'switch' + (st[key] ? ' on' : ''), '<i></i>');
      sw.onclick = () => {
        st[key] = !st[key];
        sw.classList.toggle('on', st[key]);
        apply && apply(st[key]);
        Store.save();
        Audio2.sfx('click');
      };
      row.append(this.el('label', null, label), sw);
      wrap.append(row);
    };
    slider('🎵 Music volume', 'music', (v) => Audio2.setMusicVolume(v));
    slider('🔊 Effects volume', 'sfx', (v) => { Audio2.setSfxVolume(v); Audio2.sfx('impact'); });
    toggle('✨ Rich particles', 'particles', () => this.onSpeedChange && this.onSpeedChange());
    toggle('📳 Screen shake', 'shake', () => this.onSpeedChange && this.onSpeedChange());
    toggle('⚡ Fast animations', 'fastAnim', () => this.onSpeedChange && this.onSpeedChange());
    const reset = this.el('button', 'btn small danger', 'Reset all data (decks + record)');
    reset.style.marginTop = '22px';
    reset.onclick = () => {
      if (this._resetArmed) {
        localStorage.removeItem(LS_KEY);
        this.store = Store.load();
        this.toast('All data reset.');
        this._resetArmed = false;
        reset.textContent = 'Reset all data (decks + record)';
      } else {
        this._resetArmed = true;
        reset.textContent = 'Click again to CONFIRM reset';
        setTimeout(() => { this._resetArmed = false; reset.textContent = 'Reset all data (decks + record)'; }, 3200);
      }
    };
    wrap.append(reset, this.el('div', 'hint', 'Right-click any card for a closer look. SPACE advances the phase.'));
    s.append(top, wrap);
    this.root.append(s);
  }

  // ═══════════════ match HUD ═══════════════
  buildHud() {
    const s = this.el('div', 'screen');
    s.id = 'scr-match';
    s.style.background = 'transparent';
    s.style.pointerEvents = 'none';
    const hud = this.el('div');
    hud.id = 'hud';
    // plates
    const mkPlate = (cls) => {
      const p = this.el('div', 'plate ' + cls);
      p.innerHTML = `
        <div class="portrait"></div>
        <div class="pcol">
          <div class="pname"></div>
          <div class="hporb"><div class="orb">30</div><div class="manabar"></div></div>
          <div class="zinfo"><span class="zdeck"></span><span class="zhand"></span><span class="ztrap"></span></div>
        </div>`;
      return p;
    };
    this.plateMe = mkPlate('me');
    this.plateFoe = mkPlate('foe');
    // phase bar
    const pb = this.el('div');
    pb.id = 'phasebar';
    for (const ph of ['DRAW', 'MAIN', 'COMBAT', 'END']) {
      const d = this.el('div', 'ph', ph);
      d.dataset.ph = ph.toLowerCase();
      pb.append(d);
    }
    // buttons
    const btns = this.el('div');
    btns.id = 'turnbtns';
    this.combatBtn = this.el('button', 'btn small', '⚔ To Combat');
    this.combatBtn.onclick = () => this.match?.toCombat();
    this.endBtn = this.el('button', 'btn small primary', 'End Turn');
    this.endBtn.onclick = () => this.match?.endTurn();
    btns.append(this.combatBtn, this.endBtn);
    // tools
    const tools = this.el('div');
    tools.id = 'matchtools';
    const gear = this.el('div', 'tool', '⚙');
    gear.onclick = () => this.matchSettings();
    const flag = this.el('div', 'tool', '🏳');
    flag.title = 'Concede';
    flag.onclick = () => { if (confirm('Concede this match?')) this.match?.concede(); };
    tools.append(gear, flag);
    // overlays
    this.floatLayer = this.el('div');
    this.bannerEl = this.el('div'); this.bannerEl.id = 'banner';
    this.cardBannerEl = this.el('div'); this.cardBannerEl.id = 'cardbanner';
    this.toastEl = this.el('div'); this.toastEl.id = 'toasts';
    this.arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrowSvg.id = 'arrow-svg';
    this.arrowSvg.innerHTML = `<defs><marker id="ah" markerWidth="9" markerHeight="7" refX="7" refY="3.5" orient="auto"><polygon points="0 0, 9 3.5, 0 7" fill="context-stroke"/></marker></defs><line x1="0" y1="0" x2="0" y2="0" stroke-width="5" stroke-dasharray="10 6" marker-end="url(#ah)" visibility="hidden"/>`;
    this.arrowLine = this.arrowSvg.querySelector('line');
    this.inspectEl = this.el('div'); this.inspectEl.id = 'inspect';
    const insCanvas = document.createElement('canvas');
    this.inspectCanvas = insCanvas;
    this.inspectKws = this.el('div', 'kws');
    this.inspectEl.append(insCanvas, this.inspectKws);
    hud.append(this.plateMe, this.plateFoe, pb, btns, tools, this.bannerEl, this.cardBannerEl, this.toastEl, this.arrowSvg, this.inspectEl, this.floatLayer);
    s.append(hud);
    this.root.append(s);
  }

  attachMatch(match, heroes) {
    this.match = match;
    this.plateMe.querySelector('.portrait').style.backgroundImage = `url(assets/ui/hero_${heroes[0]}.jpg)`;
    this.plateFoe.querySelector('.portrait').style.backgroundImage = `url(assets/ui/hero_${heroes[1]}.jpg)`;
    this.show('match');
  }

  hudUpdate(state, match) {
    if (!state) return;
    const mySide = match.mySide ?? 0;
    const upd = (plate, p) => {
      const pl = state.players[p];
      const tag = p !== mySide
        ? (match.mode === 'online' ? ' · online' : ` · ${DIFFICULTIES[match.difficulty].label}`)
        : '';
      plate.querySelector('.pname').textContent = pl.name + tag;
      plate.querySelector('.orb').textContent = Math.max(0, pl.hp);
      const mb = plate.querySelector('.manabar');
      mb.innerHTML = '';
      for (let i = 0; i < pl.manaMax; i++) {
        mb.append(this.el('div', 'mana' + (i < pl.mana ? '' : ' spent')));
      }
      const mt = this.el('div', 'manatext', `${pl.mana}/${pl.manaMax}`);
      mb.append(mt);
      plate.querySelector('.zdeck').textContent = `🂠 ${pl.deck.length}`;
      plate.querySelector('.zhand').textContent = `✋ ${pl.hand.length}`;
      plate.querySelector('.ztrap').textContent = pl.traps.length ? `⧗ ${pl.traps.length}` : '';
    };
    upd(this.plateMe, mySide);
    upd(this.plateFoe, 1 - mySide);
    // phase
    const phase = state.winner !== null ? 'end' : (state.phase === 'main' ? 'main' : 'combat');
    for (const d of this.root.querySelectorAll('#phasebar .ph')) {
      d.classList.toggle('on', d.dataset.ph === phase && state.active === mySide);
    }
    // buttons
    const myTurn = state.active === mySide && state.winner === null && !match.busy;
    this.combatBtn.style.display = myTurn && state.phase === 'main' ? '' : 'none';
    this.endBtn.disabled = !myTurn;
    this.endBtn.textContent = state.active === mySide ? 'End Turn' : (match.mode === 'online' ? 'Opponent…' : 'Enemy Turn…');
  }

  heroHit(p) {
    const plate = p === 0 ? this.plateMe : this.plateFoe;
    plate.classList.remove('hit');
    void plate.offsetWidth;
    plate.classList.add('hit');
  }

  banner(text, mine = true) {
    const b = this.el('div', 'btext play' + (mine ? '' : ' enemy'), text);
    this.bannerEl.innerHTML = '';
    this.bannerEl.append(b);
    return new Promise((r) => setTimeout(r, 900));
  }

  cardBanner(def) {
    const colors = { epic: '#c76bff', legendary: '#ffd45f' };
    const cb = this.el('div', 'cb',
      `<span class="rar" style="color:${colors[def.rarity]}">${def.rarity}</span><span class="nm" style="color:${colors[def.rarity]}">${def.name}</span>`);
    this.cardBannerEl.innerHTML = '';
    this.cardBannerEl.append(cb);
  }

  floatText(x, y, text, cls = '') {
    const f = this.el('div', 'floater ' + cls, text);
    f.style.left = x + 'px';
    f.style.top = y + 'px';
    this.floatLayer.append(f);
    setTimeout(() => f.remove(), 1200);
  }

  toast(text) {
    const t = this.el('div', 'toast', text);
    this.toastEl.append(t);
    setTimeout(() => t.remove(), 2600);
    while (this.toastEl.children.length > 3) this.toastEl.firstChild.remove();
  }

  showArrow(x1, y1, x2, y2, color) {
    this.arrowLine.setAttribute('visibility', 'visible');
    this.arrowLine.setAttribute('x1', x1); this.arrowLine.setAttribute('y1', y1);
    this.arrowLine.setAttribute('x2', x2); this.arrowLine.setAttribute('y2', y2);
    this.arrowLine.setAttribute('stroke', color);
  }
  hideArrow() { this.arrowLine.setAttribute('visibility', 'hidden'); }

  hoverUnit(cardId, unit, x, y) {
    clearTimeout(this.hoverTimer);
    if (!cardId) { this.inspectEl.style.display = 'none'; return; }
    this.hoverTimer = setTimeout(() => this.showInspectPanel(cardId, unit), 420);
  }

  // floating hover-preview card — renders IN FRONT of everything, follows the
  // hovered element (hand / board / traps / grids). Crisp DOM canvas.
  hoverPreview(cardId, unit, x, y, zone) {
    clearTimeout(this._hpTimer);
    if (!cardId) {
      if (this._hpEl) this._hpEl.style.display = 'none';
      this._hpCard = null;
      return;
    }
    const delay = zone === 'grid' ? 60 : zone === 'hand' ? 260 : 130;
    this._hpTimer = setTimeout(() => {
      if (!this._hpEl) {
        this._hpEl = this.el('div');
        this._hpEl.id = 'hovercard';
        this._hpCanvas = document.createElement('canvas');
        this._hpStatus = this.el('div', 'hstat');
        this._hpEl.append(this._hpCanvas, this._hpStatus);
        this.root.append(this._hpEl);
      }
      if (this._hpCard !== cardId) {
        drawCard(this._hpCanvas, cardId);
        this._hpCard = cardId;
      }
      // live unit status lines (buffs / states) under the card
      let status = '';
      if (unit) {
        const def = cardById(cardId);
        const bits = [];
        if (unit.atk !== def.atk || unit.maxHp !== def.hp) bits.push(`Now ${unit.atk}/${unit.hp}`);
        else if (unit.hp < unit.maxHp) bits.push(`${unit.hp}/${unit.maxHp} HP`);
        if (unit.silenced) bits.push('Silenced');
        if (unit.frozen) bits.push('Frozen');
        if (unit.sick && !(def.kw || []).includes('swift')) bits.push('Summoning sickness');
        if (unit.tapped && !unit.frozen) bits.push('Tapped');
        if (unit.ward) bits.push('Ward active');
        if (unit.stealth) bits.push('Stealthed');
        status = bits.join(' · ');
      }
      this._hpStatus.textContent = status;
      this._hpStatus.style.display = status ? '' : 'none';
      const el = this._hpEl;
      el.style.display = 'block';
      // place beside the cursor, clamped to viewport; above hand cards
      const W = 292, H = 470;
      const vw = window.innerWidth, vh = window.innerHeight;
      let px = x + 26;
      if (px + W > vw - 10) px = x - W - 26;
      let py = zone === 'hand' ? vh - H - 190 : y - H / 2;
      py = Math.max(10, Math.min(vh - H - 10, py));
      el.style.left = Math.max(8, px) + 'px';
      el.style.top = py + 'px';
    }, delay);
  }

  showInspectPanel(cardId, unit) {
    drawCard(this.inspectCanvas, cardId);
    const def = cardById(cardId);
    let html = '';
    const kws = new Set([...(def.kw || []), ...((unit && !unit.silenced ? unit.kw : []) || [])]);
    for (const k of kws) if (KEYWORD_INFO[k]) html += `<div><b>${k[0].toUpperCase() + k.slice(1)}</b> — ${KEYWORD_INFO[k].split('— ')[1]}</div>`;
    if (def.rally) html += `<div><b>Rally</b> — effect when played from hand.</div>`;
    if (def.rites) html += `<div><b>Last Rites</b> — effect when it dies.</div>`;
    if (unit) {
      if (unit.silenced) html += `<div><b>Silenced</b> — keywords and abilities removed.</div>`;
      if (unit.frozen) html += `<div><b>Frozen</b> — skips its next untap.</div>`;
      if (unit.sick && !(def.kw || []).includes('swift')) html += `<div><b>Summoning sickness</b> — cannot attack this turn.</div>`;
    }
    this.inspectKws.innerHTML = html || '<div>No keywords.</div>';
    this.inspectEl.style.display = 'block';
  }

  showInspect(cardId, unit) {
    // modal version (right-click / collection click)
    const wrap = this.el('div', 'modal-wrap');
    const m = this.el('div', 'modal');
    m.style.display = 'flex';
    m.style.gap = '22px';
    const cv = document.createElement('canvas');
    drawCard(cv, cardId);
    cv.style.width = '300px';
    cv.style.borderRadius = '14px';
    const right = this.el('div');
    right.style.cssText = 'max-width:300px;display:flex;flex-direction:column;gap:9px;font-size:14px;color:#c4b4e4';
    const def = cardById(cardId);
    right.append(this.el('h3', null, def.name));
    const kws = new Set(def.kw || []);
    let kwHtml = '';
    for (const k of kws) if (KEYWORD_INFO[k]) kwHtml += `<div>· ${KEYWORD_INFO[k]}</div>`;
    if (def.rally) kwHtml += `<div>· <b style="color:#ffe9a8">Rally</b> — effect when played from hand.</div>`;
    if (def.rites) kwHtml += `<div>· <b style="color:#c98aff">Last Rites</b> — effect when it dies.</div>`;
    if (def.trap) kwHtml += `<div>· <b style="color:#e8b93a">Trap</b> — set face-down; triggers on the enemy's turn.</div>`;
    right.append(this.el('div', null, kwHtml || 'A straightforward card — no keywords.'));
    if (def.flavor) {
      const fl = this.el('div', null, '“' + def.flavor + '”');
      fl.style.cssText = 'font-style:italic;color:#8d78b8;margin-top:6px';
      right.append(fl);
    }
    const close = this.el('button', 'btn small', 'Close');
    close.style.marginTop = 'auto';
    close.onclick = () => wrap.remove();
    right.append(close);
    m.append(cv, right);
    wrap.append(m);
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    this.root.append(wrap);
  }

  matchSettings() {
    const wrap = this.el('div', 'modal-wrap');
    const m = this.el('div', 'modal');
    m.append(this.el('h3', null, 'SETTINGS'));
    const st = this.store.settings;
    const mkSlide = (label, key, apply) => {
      const row = this.el('div', 'set-row');
      const inp = this.el('input');
      inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.05; inp.value = st[key];
      inp.oninput = () => { st[key] = parseFloat(inp.value); apply(st[key]); Store.save(); };
      row.append(this.el('label', null, label), inp);
      m.append(row);
    };
    mkSlide('🎵 Music', 'music', (v) => Audio2.setMusicVolume(v));
    mkSlide('🔊 Effects', 'sfx', (v) => Audio2.setSfxVolume(v));
    const close = this.el('button', 'btn small primary', 'Resume');
    close.style.marginTop = '16px';
    close.onclick = () => wrap.remove();
    m.append(close);
    wrap.append(m);
    this.root.append(wrap);
  }

  buildGameOver() {
    const s = this.el('div', 'screen');
    s.id = 'scr-gameover';
    s.style.background = 'rgba(7,4,14,.88)';
    this.root.append(s);
  }

  showGameOver(won, stats) {
    const rec = this.store.record;
    if (won) rec.wins++; else rec.losses++;
    Store.save();
    const s = this.root.querySelector('#scr-gameover');
    s.id = 'scr-gameover';
    s.innerHTML = '<div id="gameover" style="display:flex;width:100%"><div class="gwrap"></div></div>';
    const w = s.querySelector('.gwrap');
    w.append(this.el('div', 'gtitle ' + (won ? 'win' : 'lose'), won ? 'VICTORY' : 'DEFEAT'));
    w.append(this.el('div', 'gstats',
      `${won ? 'The realms sing your name.' : 'The realms will remember your stand.'}<br>` +
      `Turns: ${stats.turns} · Damage dealt: ${stats.dmg} · Cards played: ${stats.played} · Difficulty: ${DIFFICULTIES[stats.difficulty].label}<br>` +
      `Record: ${rec.wins}W – ${rec.losses}L`));
    const row = this.el('div');
    row.style.cssText = 'display:flex;gap:12px';
    if (!stats.online) {
      const again = this.el('button', 'btn primary', '⚔ Play Again');
      again.onclick = () => { Audio2.sfx('click'); s.classList.remove('on'); this.onPlay(this._lastDeck, this._lastDiff, true); };
      row.append(again);
    } else {
      const again = this.el('button', 'btn primary', '🌐 New Online Duel');
      again.onclick = () => { Audio2.sfx('click'); s.classList.remove('on'); this.match?.destroy(); this.match = null; window.__ARC__.leaveMatch(); this.openOnline(); };
      row.append(again);
    }
    const menu = this.el('button', 'btn', 'Main Menu');
    menu.onclick = () => { Audio2.sfx('click'); s.classList.remove('on'); this.match?.destroy(); this.match = null; window.__ARC__.leaveMatch(); };
    row.append(menu);
    w.append(row);
    s.classList.add('on'); // overlay on top of match screen
  }
}
