// Arcane Realms TCG — Campaign screens: chapter map, NPC dialogue bubbles,
// rewards reveal, achievements panel, card-back gallery.

import { CHAPTERS, CARDBACK_INFO, PACK_COST } from '../campaign/campaign_data.js?v=24';
import { battleState, campaignSummary, achievementList, buyPack, buyCardback, dupeCount } from '../campaign/progression.js?v=24';
import { REALMS, cardById } from '../sim/cards.js?v=24';
import { drawCard } from './cardtex.js?v=24';
import { Audio2 } from './audio.js?v=24';
import { openPackReveal } from './packreveal.js?v=24';

// compact arcane booster-pack icon for the store button
const PACK_SVG = `<svg viewBox="0 0 40 48" fill="none" xmlns="http://www.w3.org/2000/svg" width="30" height="36">
<defs><linearGradient id="pkg" x1="0" y1="0" x2="40" y2="48" gradientUnits="userSpaceOnUse">
<stop stop-color="#8a5cf0"/><stop offset=".55" stop-color="#4a2a8c"/><stop offset="1" stop-color="#241246"/></linearGradient></defs>
<rect x="4" y="3" width="32" height="42" rx="5" fill="url(#pkg)" stroke="#ffd45f" stroke-width="2"/>
<path d="M4 12 L36 12" stroke="#ffd45f" stroke-width="1.5" opacity=".7"/>
<path d="M20 6 L23 10 L20 8 L17 10 Z" fill="#ffe9a8"/>
<g transform="translate(20 27)" fill="#ffe9a8">
<path d="M0 -9 L2.2 -2.2 L9 0 L2.2 2.2 L0 9 L-2.2 2.2 L-9 0 L-2.2 -2.2 Z"/>
<circle cx="0" cy="0" r="2.4" fill="#fff6d8"/></g>
<circle cx="10" cy="38" r="1.3" fill="#c9a6ff" opacity=".8"/>
<circle cx="30" cy="38" r="1.3" fill="#c9a6ff" opacity=".8"/></svg>`;

// battle-node positions on the world map (percent of the 16:9 artwork)
const MAP_POS = {
  ch1b1: [7, 55], ch1b2: [13, 37], ch1b3: [22, 24], ch1b4: [30, 33],
  ch2b1: [12, 72], ch2b2: [20, 84], ch2b3: [30, 89], ch2b4: [38, 72],
  ch3b1: [41, 55], ch3b2: [46, 39], ch3b3: [52, 23], ch3b4: [55, 40],
  ch4b1: [57, 62], ch4b2: [63, 81], ch4b3: [74, 89], ch4b4: [69, 65],
  ch5b1: [77, 50], ch5b2: [83, 38], ch5b3: [88, 27], ch5b4: [93, 15],
  // ch6 — descent from the spires into the Nexus core; converges on the map's heart
  ch6b1: [72, 33], ch6b2: [61, 44], ch6b3: [52, 40], ch6b4: [50, 53],
};
const MAP_LABEL = {
  ch1: [15, 10], ch2: [17, 62], ch3: [47, 9], ch4: [63, 51], ch5: [82, 60],
  ch6: [50, 65],
};

const CSS = `
/* campaign world map */
#scr-campaign .cwrap{flex:1;overflow-y:auto;padding:18px 22px 30px}
.mapstage{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;padding:10px;background:radial-gradient(ellipse at center,#17102a 0%,#0b0714 80%)}
.mapwrap{position:relative;aspect-ratio:16/9;max-height:100%;max-width:100%;width:auto;height:100%;border-radius:16px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.75), 0 0 0 1px #3a2a5c}
.mapimg{position:absolute;inset:0;background-size:cover;background-position:center}
.mapveil{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,transparent 55%,rgba(8,5,16,.5) 100%)}
.mappath{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.mnode{position:absolute;transform:translate(-50%,-50%);width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:16px;font-weight:800;cursor:pointer;pointer-events:auto;user-select:none;transition:all .15s;z-index:3;
  background:radial-gradient(circle at 35% 30%,#4a3a78,#241a3a);border:2.5px solid #6b5a9c;color:#cbbce8;box-shadow:0 4px 14px rgba(0,0,0,.7)}
.mnode:hover{transform:translate(-50%,-50%) scale(1.22)}
.mnode.open{border-color:#ffe9a8;color:#ffe9a8;box-shadow:0 0 18px rgba(255,212,95,.65),0 4px 14px rgba(0,0,0,.7);animation:nodepulse 1.6s ease-in-out infinite}
@keyframes nodepulse{50%{box-shadow:0 0 30px rgba(255,212,95,.95),0 4px 14px rgba(0,0,0,.7)}}
.mnode.won{background:radial-gradient(circle at 35% 30%,#2f5c3a,#14231a);border-color:#4fc06a;color:#8ae0a0}
.mnode.locked{opacity:.55;cursor:default;filter:grayscale(.7)}
.mnode.locked:hover{transform:translate(-50%,-50%)}
.mnode.boss{width:52px;height:52px;font-size:22px}
.mnode.boss.open{border-color:#ff9d5f;box-shadow:0 0 22px rgba(255,120,60,.8)}
.mnode .ntip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(14,9,26,.96);
  border:1px solid #4a3a78;border-radius:8px;padding:5px 12px;font-size:12.5px;font-weight:600;color:#e8e0f5;opacity:0;pointer-events:none;transition:opacity .12s}
.mnode:hover .ntip{opacity:1}
.mlabel{position:absolute;transform:translate(-50%,-50%);pointer-events:none;z-index:2;text-align:center;
  font-size:clamp(11px,1.3vw,16px);font-weight:800;letter-spacing:.22em;color:#ffe9a8;text-transform:uppercase;
  text-shadow:0 2px 6px #000,0 0 18px rgba(0,0,0,.9)}
.mlabel small{display:block;font-size:.68em;letter-spacing:.14em;color:#c9b8ec;text-transform:none;font-weight:600}
.chapter{border:1px solid #3a2a5c;border-radius:14px;margin-bottom:16px;overflow:hidden;background:#150f26}
.chapter .chead{display:flex;align-items:center;gap:14px;padding:12px 16px;background:linear-gradient(90deg,rgba(0,0,0,.35),transparent)}
.chapter .cportrait{width:64px;height:64px;border-radius:50%;background-size:cover;background-position:center;border:2px solid var(--gold);flex:none}
.chapter .cname{font-size:20px;font-weight:700;letter-spacing:.08em}
.chapter .ccommander{font-size:13px;color:var(--dim)}
.chapter .cblurb{font-size:13px;color:#a894cc;font-style:italic;margin-top:3px}
.chapter .cbattles{display:flex;gap:10px;padding:12px 16px 16px;flex-wrap:wrap}
.bnode{pointer-events:auto;cursor:pointer;border:1px solid #3a2a5c;border-radius:10px;padding:10px 16px;background:#1b1330;min-width:170px;transition:all .12s;position:relative}
.bnode:hover{border-color:var(--gold-hi);transform:translateY(-2px)}
.bnode.locked{opacity:.42;cursor:default;filter:grayscale(.6)}
.bnode.locked:hover{transform:none;border-color:#3a2a5c}
.bnode.won{border-color:#3f7a4a}
.bnode .bname{font-size:15px;font-weight:700}
.bnode .bstate{font-size:11.5px;letter-spacing:.14em;margin-top:4px;color:var(--dim);text-transform:uppercase}
.bnode.won .bstate{color:#6ae08a}
.bnode.boss .bname{color:#ffd45f}
.bnode .bboss{position:absolute;top:-9px;right:-6px;font-size:17px;filter:drop-shadow(0 2px 3px #000)}
.goldchip{display:inline-flex;align-items:center;gap:6px;background:#241a3a;border:1px solid #6b4d12;color:#ffd45f;border-radius:18px;padding:5px 14px;font-size:15px;font-weight:700}
.pack-btn{display:inline-flex;align-items:center;gap:9px;cursor:pointer;border:none;border-radius:14px;padding:6px 16px 6px 9px;position:relative;overflow:hidden;
  background:linear-gradient(135deg,#7a3fd4,#4a2a8c 55%,#2a1a52);color:#fff;font-family:inherit;
  box-shadow:0 4px 16px rgba(120,60,220,.42),inset 0 1px 0 rgba(255,255,255,.16);transition:transform .12s,box-shadow .12s}
.pack-btn:hover{transform:translateY(-2px);box-shadow:0 9px 26px rgba(150,90,240,.55),inset 0 1px 0 rgba(255,255,255,.22)}
.pack-btn:active{transform:translateY(0)}
.pack-btn.aether{background:linear-gradient(135deg,#e0b64a,#8a3fd4 56%,#2a1a52)}
.pack-grid{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:16px}
.pack-tile{flex:1 1 260px;max-width:300px;background:linear-gradient(180deg,#1f1740,#150f28);border:1px solid #4a3a78;border-radius:16px;padding:20px 18px 18px;display:flex;flex-direction:column;align-items:center;transition:border-color .15s,transform .15s}
.pack-tile:hover{border-color:#ffd45f;transform:translateY(-3px)}
.pack-tile.aether{border-color:#8a5cc0;background:linear-gradient(180deg,#2a1f48,#170f2c)}
.pack-tile-ico{width:56px;height:66px;filter:drop-shadow(0 3px 8px rgba(0,0,0,.55))}
.pack-tile-name{font-family:Georgia,serif;font-size:20px;font-weight:700;color:#f4eeff;margin-top:8px}
.pack-tile-tag{font-family:'Courier New',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#ffd45f;margin-top:3px}
.pack-tile-desc{font-size:13px;color:#b9a9df;line-height:1.5;margin-top:10px;flex:1}
.cb-sec{font-family:'Segoe UI',system-ui,sans-serif;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#8d78b8;margin:16px 0 2px;font-weight:800}
.pack-btn:disabled{filter:grayscale(.6) brightness(.7);cursor:default;transform:none;box-shadow:0 4px 16px rgba(0,0,0,.3)}
.pack-btn .pack-ico{width:30px;height:36px;flex:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
.pack-btn .pack-lbl{display:flex;flex-direction:column;line-height:1.12;font-size:14.5px;font-weight:800;letter-spacing:.03em;text-align:left}
.pack-btn .pack-lbl b{font-size:11.5px;color:#ffe08a;font-weight:800;letter-spacing:.08em}
.pack-btn::after{content:'';position:absolute;top:0;left:-60%;width:38%;height:100%;pointer-events:none;
  background:linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent);transform:skewX(-18deg);animation:packsheen 3.6s ease-in-out infinite}
@keyframes packsheen{0%,62%{left:-60%}82%,100%{left:130%}}
.sell-btn{background:linear-gradient(180deg,#3a2c12,#241a0a);border:1px solid #6b4d12;color:#ffd45f;border-radius:10px;padding:9px 15px;font-weight:800;cursor:pointer;transition:all .12s}
.sell-btn:hover{border-color:#ffd45f;box-shadow:0 0 12px rgba(240,185,58,.32);transform:translateY(-1px)}
.sell-btn:disabled{opacity:.4;cursor:default;box-shadow:none;transform:none}
.dupe-badge{position:absolute;top:6px;left:6px;background:linear-gradient(180deg,#7a5a16,#4a3410);border:1px solid #ffd45f;color:#ffe9a8;
  font-size:12px;font-weight:800;border-radius:8px;padding:1px 7px;box-shadow:0 2px 8px rgba(0,0,0,.6);z-index:3}
/* dialogue */
#dlg-overlay{position:absolute;inset:0;background:rgba(5,3,10,.82);display:flex;align-items:flex-end;justify-content:center;z-index:70;pointer-events:auto}
#dlg-box{width:min(860px,94vw);margin-bottom:7vh;background:linear-gradient(180deg,#221a3c,#150f26);border:1px solid #4a3a78;border-radius:16px;padding:20px 24px;box-shadow:0 18px 60px rgba(0,0,0,.8)}
#dlg-row{display:flex;gap:18px;align-items:flex-start;min-height:96px}
#dlg-portrait{width:86px;height:86px;border-radius:50%;background-size:cover;background-position:center;border:3px solid var(--gold);flex:none;box-shadow:0 6px 18px rgba(0,0,0,.6)}
#dlg-portrait.pv{border-color:#4f8fe8}
#dlg-name{font-size:15px;letter-spacing:.12em;color:var(--gold-hi);margin-bottom:6px;font-weight:700}
#dlg-text{font-size:18px;line-height:1.55;color:#efe9fb}
#dlg-controls{display:flex;justify-content:space-between;margin-top:14px;align-items:center}
#dlg-hint{color:#6f5f96;font-size:12.5px;letter-spacing:.08em}
/* rewards */
#rw-overlay{position:absolute;inset:0;background:rgba(5,3,10,.86);display:flex;align-items:center;justify-content:center;z-index:72;pointer-events:auto}
#rw-box{text-align:center;max-width:min(94vw,900px);max-height:92vh;overflow-y:auto;padding:10px}
#rw-title{font-size:44px;font-weight:800;letter-spacing:.2em;background:linear-gradient(180deg,#fff3c9,#f0b93a 60%,#8a5a13);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 4px 16px rgba(212,149,43,.45))}
#rw-sub{color:#c9b8ec;margin:6px 0 18px;font-size:16px}
#rw-cards{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin:10px 0 8px}
.rw-card{width:172px;animation:rwpop .5s cubic-bezier(.2,1.6,.4,1) backwards}
.rw-card canvas{width:100%;border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.75)}
.rw-card .rw-tag{margin-top:6px;font-size:12.5px;letter-spacing:.12em;color:#6ae08a;text-transform:uppercase}
.rw-card .rw-tag.back{color:#ffd45f}
@keyframes rwpop{0%{opacity:0;transform:translateY(26px) scale(.7)}100%{opacity:1;transform:none}}
.rw-backimg{width:172px;border-radius:12px;border:2px solid var(--gold);box-shadow:0 12px 34px rgba(0,0,0,.75)}
/* achievements */
.ach-row{display:flex;align-items:center;gap:14px;border:1px solid #2c2148;border-radius:10px;padding:10px 16px;margin-bottom:8px;background:#1b1330}
.ach-row.done{border-color:#3f7a4a;background:#14231a}
.ach-ico{font-size:26px;width:38px;text-align:center}
.ach-name{font-weight:700;font-size:15.5px}
.ach-desc{font-size:12.5px;color:var(--dim)}
.ach-rw{margin-left:auto;font-size:12.5px;color:#ffd45f;text-align:right;white-space:nowrap}
/* card backs gallery */
.cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;padding:6px}
.cb-tile{pointer-events:auto;cursor:pointer;text-align:center}
.cb-tile img{width:100%;border-radius:12px;border:2px solid #3a2a5c;transition:all .12s}
.cb-tile:hover img{transform:translateY(-4px)}
.cb-tile.sel img{border-color:var(--gold-hi);box-shadow:0 0 0 2px var(--gold-hi),0 10px 26px rgba(212,149,43,.3)}
.cb-tile.locked{opacity:.4;cursor:default}
.cb-tile.locked:hover img{transform:none}
.cb-name{font-size:13px;margin-top:6px;color:#d8ccf2}
.cb-hint{font-size:11px;color:var(--dim)}
`;

export class CampaignUI {
  constructor(ui, store, { onBattle }) {
    this.ui = ui;
    this.store = store;
    this.onBattle = onBattle;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const s = ui.el('div', 'screen');
    s.id = 'scr-campaign';
    ui.root.append(s);
  }

  open() {
    const ui = this.ui;
    const s = ui.root.querySelector('#scr-campaign');
    s.innerHTML = '';
    const top = ui.el('div', 'topbar');
    const back = ui.el('button', 'btn small', '← Menu');
    back.onclick = () => { Audio2.sfx('click'); ui.show('menu'); };
    const sum = campaignSummary(this.store);
    const gold = ui.el('div', 'goldchip', `🪙 ${sum.gold}`);
    const prog = ui.el('div', 'goldchip', `⚑ ${sum.cleared}/${sum.total}`);
    const ach = ui.el('button', 'btn small', '🏆 Achievements');
    ach.onclick = () => { Audio2.sfx('click'); this.openAchievements(); };
    const backs = ui.el('button', 'btn small', '🂠 Card Backs');
    backs.onclick = () => { Audio2.sfx('click'); this.openCardbacks(); };
    top.append(ui.el('h2', null, '🏰 CAMPAIGN — TRIALS OF THE REALMS'), gold, prog, ach, backs, back);

    // ── world map ──
    const stage = ui.el('div', 'mapstage');
    const wrap = ui.el('div', 'mapwrap');
    const img = ui.el('div', 'mapimg');
    img.style.backgroundImage = 'url(assets/ui/worldmap.jpg)';
    wrap.append(img, ui.el('div', 'mapveil'));

    // the winding trail (SVG in map-percent space)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'mappath');
    svg.setAttribute('viewBox', '0 0 100 56.25');
    svg.setAttribute('preserveAspectRatio', 'none');
    const allB = CHAPTERS.flatMap((ch, ci) => ch.battles.map((b, bi) => ({ ch, ci, b, bi })));
    let solid = '';
    let dotted = '';
    for (let i = 0; i < allB.length - 1; i++) {
      const a = MAP_POS[allB[i].b.id];
      const c = MAP_POS[allB[i + 1].b.id];
      if (!a || !c) continue;
      const seg = `M ${a[0]} ${a[1] * 0.5625} Q ${(a[0] + c[0]) / 2} ${((a[1] + c[1]) / 2) * 0.5625 - 2} ${c[0]} ${c[1] * 0.5625} `;
      const done = this.store.data.battlesWon[allB[i].b.id];
      if (done) solid += seg; else dotted += seg;
    }
    svg.innerHTML =
      `<path d="${solid}" fill="none" stroke="#ffd45f" stroke-width="0.42" stroke-linecap="round" opacity="0.85"/>` +
      `<path d="${solid}" fill="none" stroke="#fff3c9" stroke-width="0.14" stroke-linecap="round" opacity="0.9"/>` +
      `<path d="${dotted}" fill="none" stroke="#cbbce8" stroke-width="0.3" stroke-dasharray="0.9 1.1" stroke-linecap="round" opacity="0.55"/>`;
    wrap.append(svg);

    // chapter region labels
    CHAPTERS.forEach((ch, ci) => {
      const lp = MAP_LABEL[ch.id];
      if (!lp) return;
      const lab = ui.el('div', 'mlabel', `${ch.name}<small>${ch.commander.name}</small>`);
      lab.style.left = lp[0] + '%';
      lab.style.top = lp[1] + '%';
      wrap.append(lab);
    });

    // battle nodes
    CHAPTERS.forEach((ch, ci) => {
      ch.battles.forEach((b, bi) => {
        const pos = MAP_POS[b.id];
        if (!pos) return;
        const st = battleState(this.store, ci, bi);
        const node = ui.el('div', `mnode ${st}${b.boss ? ' boss' : ''}`);
        node.style.left = pos[0] + '%';
        node.style.top = pos[1] + '%';
        node.innerHTML = (st === 'won' ? '✓' : b.boss ? '👑' : String(bi + 1)) +
          `<span class="ntip">${b.name} — ${st === 'won' ? 'Conquered (replay)' : st === 'locked' ? 'Locked' : b.boss ? 'Boss Battle' : 'Available'}</span>`;
        if (st !== 'locked') {
          node.onclick = () => { Audio2.sfx('click'); this.startBattle(ch, b); };
        }
        wrap.append(node);
      });
    });

    stage.append(wrap);
    s.append(top, stage);
    ui.show('campaign');
  }

  startBattle(chapter, battle) {
    this.showDialogue(chapter, battle, () => {
      // deck pick, then launch
      this.pickDeck((deckDef) => this.onBattle(chapter, battle, deckDef));
    });
  }

  pickDeck(cb) {
    const ui = this.ui;
    const wrap = ui.el('div', 'modal-wrap');
    const m = ui.el('div', 'modal');
    m.append(ui.el('h3', null, 'CHOOSE YOUR DECK'));
    const grid = ui.el('div', 'deck-pick');
    const decks = ui.availableDecks();
    let selected = null;
    const tiles = [];
    const launch = () => { if (!selected) return; Audio2.sfx('click'); wrap.remove(); cb(selected); };
    for (const d of decks) {
      const t = ui.el('div', 'deck-tile');
      t.append(ui.el('div', 'dname', d.name), ui.el('div', 'dreal', d.desc || 'Custom deck'));
      t.onclick = () => {
        Audio2.sfx('hover');
        selected = d;
        tiles.forEach((x) => x.classList.remove('sel'));
        t.classList.add('sel');
        battle.disabled = false;
      };
      t.ondblclick = launch;               // power-user shortcut: pick + go
      tiles.push(t);
      grid.append(t);
    }
    // two-step: select a deck (highlights), THEN press Battle — no accidental launch
    const btns = ui.el('div', 'deck-pick-btns');
    const battle = ui.el('button', 'btn primary', '⚔ Battle');
    battle.disabled = true;
    battle.onclick = launch;
    const cancel = ui.el('button', 'btn', 'Cancel'); // same base size as Battle (equal-width via CSS)
    cancel.onclick = () => wrap.remove();
    btns.append(battle, cancel);
    m.append(grid, btns);
    wrap.append(m);
    ui.root.append(wrap);
  }

  // ── dialogue overlay: portrait speech bubbles, click to advance ──
  showDialogue(chapter, battle, onDone, lines = null, doneLabel = '⚔ To Battle') {
    const ui = this.ui;
    const seq = lines || battle.dialogue || [];
    if (!seq.length) { onDone(); return; }
    const overlay = ui.el('div');
    overlay.id = 'dlg-overlay';
    const box = ui.el('div');
    box.id = 'dlg-box';
    const row = ui.el('div');
    row.id = 'dlg-row';
    const portrait = ui.el('div');
    portrait.id = 'dlg-portrait';
    const col = ui.el('div');
    const name = ui.el('div'); name.id = 'dlg-name';
    const text = ui.el('div'); text.id = 'dlg-text';
    col.append(name, text);
    row.append(portrait, col);
    const controls = ui.el('div');
    controls.id = 'dlg-controls';
    const hint = ui.el('div', null, 'Click to continue…');
    hint.id = 'dlg-hint';
    const skip = ui.el('button', 'btn small', 'Skip ➤');
    controls.append(hint, skip);
    box.append(row, controls);
    overlay.append(box);
    ui.root.append(overlay);

    const myHero = this.store.data.lastHero || 'ember';
    let i = 0;
    const showLine = () => {
      const line = seq[i];
      const who = line.who;
      const isPlayer = who === 'pv';
      let img, nm, col;
      if (who === 'goon' && battle.goon) {
        img = `assets/art/${battle.goon.portrait}.jpg`; // goon = this battle's minion (card art)
        nm = battle.goon.name;
        col = '#ff9a4d';                                 // orange — a lieutenant, not the boss
      } else if (isPlayer) {
        img = `assets/ui/hero_${myHero}.jpg`;
        nm = 'You';
        col = '#8ac4ff';
      } else { // 'cm' — the chapter boss/commander
        img = `assets/ui/${chapter.commander.portrait}.jpg`;
        nm = chapter.commander.name;
        col = '#ffd45f';
      }
      portrait.className = isPlayer ? 'pv' : '';
      portrait.style.backgroundImage = `url(${img})`;
      name.textContent = nm;
      name.style.color = col;
      text.textContent = line.text;
      hint.textContent = i === seq.length - 1 ? doneLabel : 'Click to continue…';
      Audio2.sfx('click');
    };
    const advance = () => {
      i++;
      if (i >= seq.length) { overlay.remove(); onDone(); }
      else showLine();
    };
    overlay.onclick = advance;
    skip.onclick = (e) => { e.stopPropagation(); overlay.remove(); onDone(); };
    showLine();
  }

  // ── rewards reveal ──
  showRewards(chapter, battle, result, onDone) {
    const ui = this.ui;
    Audio2.sfx('legendary');
    const overlay = ui.el('div');
    overlay.id = 'rw-overlay';
    const box = ui.el('div');
    box.id = 'rw-box';
    box.append(ui.el('div', null, `<span id="rw-title">${result.firstClear ? 'REALM CONQUERED' : 'VICTORY'}</span>`));
    const winLine = result.firstClear && battle.winLine ? battle.winLine + '<br>' : '';
    box.append(ui.el('div', null, `<div id="rw-sub">${winLine}🪙 +${result.gold} gold</div>`));
    const cardsRow = ui.el('div');
    cardsRow.id = 'rw-cards';
    const reveal = [...(result.newCards || []), ...(result.packCards || [])];
    reveal.forEach((id, i) => {
      const cell = ui.el('div', 'rw-card');
      cell.style.animationDelay = (0.15 + i * 0.18) + 's';
      const cv = document.createElement('canvas');
      drawCard(cv, id);
      cell.append(cv, ui.el('div', 'rw-tag', 'New card!'));
      cardsRow.append(cell);
    });
    if (result.cardback) {
      const cell = ui.el('div', 'rw-card');
      cell.style.animationDelay = (0.15 + reveal.length * 0.18) + 's';
      const img = document.createElement('img');
      img.className = 'rw-backimg';
      img.src = `assets/ui/${CARDBACK_INFO[result.cardback].file}`;
      cell.append(img, ui.el('div', 'rw-tag back', `Card back: ${CARDBACK_INFO[result.cardback].name}`));
      cardsRow.append(cell);
    }
    box.append(cardsRow);
    if (!reveal.length && !result.cardback) {
      box.append(ui.el('div', 'hint', 'Replay reward — first clears grant new cards.'));
    }
    const cont = ui.el('button', 'btn primary', 'Continue');
    cont.style.marginTop = '18px';
    cont.onclick = () => { Audio2.sfx('click'); overlay.remove(); onDone && onDone(); };
    box.append(cont);
    overlay.append(box);
    ui.root.append(overlay);
  }

  // achievement toasts + optional reveal
  announceAchievements(unlocked) {
    for (const a of unlocked) {
      this.ui.toast(`🏆 Achievement: ${a.name}! ${a.cards.length ? '+' + a.cards.length + ' card(s)' : ''} +${a.gold}g`);
    }
  }

  openAchievements() {
    const ui = this.ui;
    const wrap = ui.el('div', 'modal-wrap');
    const m = ui.el('div', 'modal');
    m.style.minWidth = 'min(92vw,640px)';
    m.append(ui.el('h3', null, '🏆 ACHIEVEMENTS'));
    for (const a of achievementList(this.store)) {
      const row = ui.el('div', 'ach-row' + (a.done ? ' done' : ''));
      const rw = [];
      if (a.rewards.gold) rw.push(`🪙 ${a.rewards.gold}`);
      if (a.rewards.cards?.length) rw.push(a.rewards.cards.map((id) => cardById(id).name).join(', '));
      if (a.rewards.cardback) rw.push(`back: ${CARDBACK_INFO[a.rewards.cardback].name}`);
      row.append(
        ui.el('div', 'ach-ico', a.done ? '✅' : '🔒'),
        (() => { const c = ui.el('div'); c.append(ui.el('div', 'ach-name', a.name), ui.el('div', 'ach-desc', a.desc)); return c; })(),
        ui.el('div', 'ach-rw', rw.join('<br>')),
      );
      m.append(row);
    }
    const close = ui.el('button', 'btn small primary', 'Close');
    close.style.cssText = 'display:block;margin:14px auto 0';
    close.onclick = () => wrap.remove();
    m.append(close);
    wrap.append(m);
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    ui.root.append(wrap);
  }

  openCardbacks() {
    const ui = this.ui;
    const d = this.store.data;
    const wrap = ui.el('div', 'modal-wrap');
    const m = ui.el('div', 'modal');
    m.style.minWidth = 'min(94vw,760px)';
    const head = ui.el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap';
    const goldChip = ui.el('div', 'goldchip', `🪙 ${d.gold}`);
    head.append(ui.el('h3', null, '🂠 CARD BACKS'), goldChip);
    m.append(head);
    m.append(ui.el('div', 'hint', 'Your equipped back shows on your deck and hand in every mode. Earn some through the Campaign; buy the rest with gold.'));
    const tiles = [];
    const equip = (id, t) => {
      Audio2.sfx('click'); d.cardback = id; this.store.save();
      tiles.forEach((x) => x.classList.remove('sel')); t.classList.add('sel');
      t.querySelector('.cb-hint').textContent = 'Equipped';
      this.ui.toast(`Card back equipped: ${CARDBACK_INFO[id].name}`);
    };
    const mkTile = (id, info) => {
      const ownedBack = !!d.cardbacks[id];
      const shop = !!info.price;
      const t = ui.el('div', 'cb-tile' + (d.cardback === id ? ' sel' : '') + (ownedBack ? '' : ' locked'));
      const img = document.createElement('img'); img.src = `assets/ui/${info.file}`;
      const hintTxt = ownedBack ? (d.cardback === id ? 'Equipped' : 'Click to equip') : (shop ? `🪙 ${info.price}` : '🔒 ' + (info.hint || 'Locked'));
      t.append(img, ui.el('div', 'cb-name', info.name), ui.el('div', 'cb-hint', hintTxt));
      if (ownedBack) t.onclick = () => equip(id, t);
      else if (shop) {
        const buy = ui.el('button', 'sell-btn', `Buy · ${info.price}g`);
        buy.style.marginTop = '6px';
        buy.onclick = (e) => {
          e.stopPropagation();
          const r = buyCardback(this.store, id);
          if (!r.ok) { Audio2.sfx('error'); this.ui.toast(r.reason); return; }
          Audio2.sfx('coin'); this.ui.toast(`Purchased: ${info.name}`);
          goldChip.textContent = `🪙 ${d.gold}`;
          if (this.refreshGold) this.refreshGold();
          t.classList.remove('locked'); buy.remove();
          t.querySelector('.cb-hint').textContent = 'Click to equip';
          t.onclick = () => equip(id, t);
        };
        t.append(buy);
      }
      tiles.push(t); return t;
    };
    const earned = ui.el('div', 'cb-grid'); earned.style.marginTop = '8px';
    const shopGrid = ui.el('div', 'cb-grid'); shopGrid.style.marginTop = '8px';
    for (const [id, info] of Object.entries(CARDBACK_INFO)) (info.price ? shopGrid : earned).append(mkTile(id, info));
    m.append(ui.el('div', 'cb-sec', 'EARNED'), earned, ui.el('div', 'cb-sec', 'GOLD SHOP'), shopGrid);
    const close = ui.el('button', 'btn small primary', 'Close');
    close.style.cssText = 'display:block;margin:16px auto 0';
    close.onclick = () => wrap.remove();
    m.append(close);
    wrap.append(m);
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    ui.root.append(wrap);
  }

  // gold + a single "Open Packs" entry point for the Collection screen
  collectionStrip() {
    const ui = this.ui;
    const d = this.store.data;
    const strip = ui.el('div');
    strip.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    const gold = ui.el('div', 'goldchip', `🪙 ${d.gold}`);
    this._goldEl = gold;
    const buy = ui.el('button', 'pack-btn');
    buy.innerHTML = `<span class="pack-ico">${PACK_SVG}</span><span class="pack-lbl">Open Packs<b>ARCANE · AETHERBOUND</b></span>`;
    buy.onclick = () => this.openPackChooser();
    strip.append(gold, buy);
    return strip;
  }

  // choose which pack to buy — each with its own art + info
  openPackChooser() {
    const ui = this.ui;
    const d = this.store.data;
    const wrap = ui.el('div', 'modal-wrap');
    wrap.style.zIndex = 210;
    const m = ui.el('div', 'modal');
    m.style.cssText = 'max-width:min(94vw,700px);text-align:center';
    const head = ui.el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap';
    const goldChip = ui.el('div', 'goldchip', `🪙 ${d.gold}`);
    head.append(ui.el('h3', null, '📦 OPEN A PACK'), goldChip);
    m.append(head, ui.el('div', 'hint', `Each pack contains 5 cards for ${PACK_COST} gold, weighted toward cards you don’t own yet. Pick a set to open.`));
    const grid = ui.el('div', 'pack-grid');
    const PACKS = [
      { which: 'arcane', name: 'Arcane Pack', tag: 'The Founding Set', cls: '', desc: 'Cards across the five realms — Emberforge, Tidecall, Wildgrove, Dawnward &amp; Gravemire.' },
      { which: 'aetherbound', name: 'Aetherbound Pack', tag: 'The Ten Pacts', cls: 'aether', desc: '60 dual-realm cards that fuse two elements each — plus a chance at <b style="color:#ffe9a8">✦ golden</b> foils.' },
    ];
    for (const p of PACKS) {
      const tile = ui.el('div', 'pack-tile' + (p.cls ? ' ' + p.cls : ''));
      tile.innerHTML = `<div class="pack-tile-ico">${PACK_SVG}</div>` +
        `<div class="pack-tile-name">${p.name}</div>` +
        `<div class="pack-tile-tag">${p.tag}</div>` +
        `<div class="pack-tile-desc">${p.desc}</div>`;
      const buy = ui.el('button', 'btn primary', `Open · ${PACK_COST} 🪙`);
      buy.style.cssText = 'margin-top:12px;width:100%';
      buy.onclick = () => { wrap.remove(); this.openPack(p.which); };
      tile.append(buy);
      grid.append(tile);
    }
    m.append(grid);
    const close = ui.el('button', 'btn small', 'Close');
    close.style.cssText = 'display:block;margin:14px auto 0';
    close.onclick = () => wrap.remove();
    m.append(close);
    wrap.append(m);
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    ui.root.append(wrap);
  }

  openPack(which) {
    const ui = this.ui;
    const d = this.store.data;
    const res = buyPack(this.store, which);
    if (!res.ok) { Audio2.sfx('error'); ui.toast(res.reason); return; }
    this.refreshGold();
    const done = () => {
      if (ui.gridEl) ui.renderGrid();
      const hdr = ui.root.querySelector('#scr-collection .topbar h2');
      if (hdr) hdr.textContent = ui.collectionTitle();
    };
    // cinematic 3D open; fall back to the flat DOM reveal if WebGL is unavailable
    try {
      const st = this.store.settings || {};
      openPackReveal(res.cards, {
        onDone: done,
        cardbackFile: (CARDBACK_INFO[d.cardback] || CARDBACK_INFO.default).file,
        shake: st.shake !== false,
        particles: st.particles !== false,
      });
    } catch (e) {
      Audio2.sfx('legendary');
      this.showRewards(null, { winLine: '' }, { firstClear: true, gold: 0, newCards: res.cards.filter((c) => c.isNew).map((c) => c.id), packCards: res.cards.filter((c) => !c.isNew).map((c) => c.id), cardback: null }, done);
    }
  }

  refreshGold() {
    if (this._goldEl) this._goldEl.textContent = `🪙 ${this.store.data.gold}`;
  }
}
