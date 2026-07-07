// Arcane Realms TCG — Campaign screens: chapter map, NPC dialogue bubbles,
// rewards reveal, achievements panel, card-back gallery.

import { CHAPTERS, CARDBACK_INFO, PACK_COST } from '../campaign/campaign_data.js?v=3';
import { battleState, campaignSummary, achievementList, buyPack } from '../campaign/progression.js?v=3';
import { REALMS, cardById } from '../sim/cards.js?v=3';
import { drawCard } from './cardtex.js?v=3';
import { Audio2 } from './audio.js?v=3';

const CSS = `
/* campaign map */
#scr-campaign .cwrap{flex:1;overflow-y:auto;padding:18px 22px 30px}
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
    const wrap = ui.el('div', 'cwrap');
    CHAPTERS.forEach((ch, ci) => {
      const box = ui.el('div', 'chapter');
      box.style.borderColor = REALMS[ch.realm].css + '55';
      const head = ui.el('div', 'chead');
      const port = ui.el('div', 'cportrait');
      port.style.backgroundImage = `url(assets/ui/${ch.commander.portrait}.jpg)`;
      const col = ui.el('div');
      col.append(
        ui.el('div', 'cname', `Chapter ${ci + 1} — ${ch.name}`),
        ui.el('div', 'ccommander', `Commander: ${ch.commander.name}`),
        ui.el('div', 'cblurb', ch.blurb),
      );
      head.append(port, col);
      const row = ui.el('div', 'cbattles');
      ch.battles.forEach((b, bi) => {
        const st = battleState(this.store, ci, bi);
        const node = ui.el('div', 'bnode ' + st + (b.boss ? ' boss' : ''));
        node.append(ui.el('div', 'bname', b.name));
        node.append(ui.el('div', 'bstate', st === 'won' ? '✓ Conquered' : st === 'locked' ? '🔒 Locked' : b.boss ? '☠ Boss Battle' : 'Available'));
        if (b.boss) node.append(ui.el('div', 'bboss', '👑'));
        if (st !== 'locked') {
          node.onclick = () => {
            Audio2.sfx('click');
            this.startBattle(ch, b);
          };
        }
        row.append(node);
      });
      box.append(head, row);
      wrap.append(box);
    });
    s.append(top, wrap);
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
    for (const d of decks) {
      const t = ui.el('div', 'deck-tile');
      t.append(ui.el('div', 'dname', d.name), ui.el('div', 'dreal', d.desc || 'Custom deck'));
      t.onclick = () => { Audio2.sfx('click'); wrap.remove(); cb(d); };
      grid.append(t);
    }
    const cancel = ui.el('button', 'btn small', 'Cancel');
    cancel.style.cssText = 'display:block;margin:8px auto 0';
    cancel.onclick = () => wrap.remove();
    m.append(grid, cancel);
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
      const isCm = line.who === 'cm';
      portrait.className = isCm ? '' : 'pv';
      portrait.style.backgroundImage = isCm
        ? `url(assets/ui/${chapter.commander.portrait}.jpg)`
        : `url(assets/ui/hero_${myHero}.jpg)`;
      name.textContent = isCm ? chapter.commander.name : 'You';
      name.style.color = isCm ? '#ffd45f' : '#8ac4ff';
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
    m.style.minWidth = 'min(92vw,720px)';
    m.append(ui.el('h3', null, '🂠 CARD BACKS'));
    m.append(ui.el('div', 'hint', 'Earn card backs by conquering Campaign chapters and achievements. Your choice shows on your deck and hand in every mode.'));
    const grid = ui.el('div', 'cb-grid');
    grid.style.marginTop = '14px';
    const tiles = [];
    for (const [id, info] of Object.entries(CARDBACK_INFO)) {
      const ownedBack = !!d.cardbacks[id];
      const t = ui.el('div', 'cb-tile' + (d.cardback === id ? ' sel' : '') + (ownedBack ? '' : ' locked'));
      const img = document.createElement('img');
      img.src = `assets/ui/${info.file}`;
      t.append(img, ui.el('div', 'cb-name', info.name), ui.el('div', 'cb-hint', ownedBack ? (d.cardback === id ? 'Equipped' : 'Click to equip') : '🔒 ' + info.hint));
      if (ownedBack) {
        t.onclick = () => {
          Audio2.sfx('click');
          d.cardback = id;
          this.store.save();
          tiles.forEach((x) => x.classList.remove('sel'));
          t.classList.add('sel');
          t.querySelector('.cb-hint').textContent = 'Equipped';
          this.ui.toast(`Card back equipped: ${info.name}`);
        };
      }
      tiles.push(t);
      grid.append(t);
    }
    m.append(grid);
    const close = ui.el('button', 'btn small primary', 'Close');
    close.style.cssText = 'display:block;margin:16px auto 0';
    close.onclick = () => wrap.remove();
    m.append(close);
    wrap.append(m);
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    ui.root.append(wrap);
  }

  // gold + pack purchase strip for the Collection screen
  collectionStrip() {
    const ui = this.ui;
    const d = this.store.data;
    const strip = ui.el('div');
    strip.style.cssText = 'display:flex;gap:10px;align-items:center';
    const gold = ui.el('div', 'goldchip', `🪙 ${d.gold}`);
    const buy = ui.el('button', 'btn small primary', `📦 Arcane Pack (${PACK_COST}g)`);
    buy.onclick = () => {
      const res = buyPack(this.store);
      if (!res.ok) { Audio2.sfx('error'); ui.toast(res.reason); return; }
      Audio2.sfx('legendary');
      gold.textContent = `🪙 ${d.gold}`;
      this.showRewards(null, { winLine: '' }, { firstClear: true, gold: 0, newCards: res.cards, packCards: [], cardback: null }, () => {
        if (ui.gridEl) ui.renderGrid();
        const hdr = ui.root.querySelector('#scr-collection .topbar h2');
        if (hdr) hdr.textContent = ui.collectionTitle();
      });
    };
    strip.append(gold, buy);
    return strip;
  }
}
