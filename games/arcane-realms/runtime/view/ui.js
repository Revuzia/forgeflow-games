// Arcane Realms TCG — DOM UI layer: menu, deck builder, collection, settings,
// match HUD (hero plates, phase bar, banners, floaters, arrow, tooltips).

import { CARDS, COLLECTIBLE, REALMS, KEYWORD_INFO, cardById } from '../sim/cards.js?v=22';
import { STARTER_DECKS, validateDeck, DECK_SIZE, MAX_COPIES, MAX_LEGENDARY_COPIES } from '../sim/decks.js?v=22';
import { DIFFICULTIES } from '../sim/ai.js?v=22';
import { drawCard, cardThumb, CARD_W, CARD_H } from './cardtex.js?v=22';
import { Audio2 } from './audio.js?v=22';

// ── persistence ─────────────────────────────────────────────────
const LS_KEY = 'arcane_realms_save_v1';
export const Store = {
  data: null,
  load() {
    try { this.data = JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch { this.data = {}; }
    this.data.settings = Object.assign(
      { music: 0.6, sfx: 0.8, particles: true, shake: true, fastAnim: false, tips: true, glowColor: '#4fd0e8' },
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
.menu-inner{position:relative;margin:auto;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;padding:24px 24px 42px;max-height:100%;overflow-y:auto;scrollbar-width:none}
.menu-inner::-webkit-scrollbar{display:none}
.game-title{font-size:clamp(40px,7vw,84px);font-weight:800;letter-spacing:.12em;line-height:.95;
  background:linear-gradient(180deg,#fff3c9 8%,#f0b93a 45%,#8a5a13 92%);-webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 2px 0 rgba(0,0,0,.0);filter:drop-shadow(0 4px 18px rgba(212,149,43,.45))}
.game-sub{letter-spacing:.55em;color:#c9b8ec;text-transform:uppercase;font-size:clamp(11px,1.6vw,16px);margin-top:-6px;text-shadow:0 2px 8px #000}
/* ── main-menu plaque buttons ─────────────────────────────── */
.mdiv{display:flex;align-items:center;gap:14px;color:var(--gold);opacity:.9;margin:4px 0 2px;font-size:13px}
.mdiv::before,.mdiv::after{content:'';height:1px;width:118px}
.mdiv::before{background:linear-gradient(90deg,transparent,rgba(212,149,43,.8))}
.mdiv::after{background:linear-gradient(270deg,transparent,rgba(212,149,43,.8))}
.menu-panel{position:relative;display:flex;flex-direction:column;align-items:center;gap:11px;padding:26px 30px 24px;
  background:linear-gradient(180deg,rgba(21,14,40,.68),rgba(12,8,24,.78));
  border:1px solid rgba(212,149,43,.30);border-radius:18px;backdrop-filter:blur(7px);
  box-shadow:0 20px 55px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,233,168,.07)}
.menu-panel .mcorn{position:absolute;width:20px;height:20px;pointer-events:none;border:solid var(--gold);opacity:.85}
.menu-panel .mcorn.tl{top:-1px;left:-1px;border-width:2px 0 0 2px;border-radius:18px 0 0 0}
.menu-panel .mcorn.tr{top:-1px;right:-1px;border-width:2px 2px 0 0;border-radius:0 18px 0 0}
.menu-panel .mcorn.bl{bottom:-1px;left:-1px;border-width:0 0 2px 2px;border-radius:0 0 0 18px}
.menu-panel .mcorn.br{bottom:-1px;right:-1px;border-width:0 2px 2px 0;border-radius:0 0 18px 0}
@keyframes mIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.mbtn{pointer-events:auto;cursor:pointer;user-select:none;position:relative;display:flex;align-items:center;gap:14px;
  width:min(400px,78vw);height:58px;padding:0 20px;font-family:inherit;font-size:19px;letter-spacing:.1em;color:var(--text);
  background:linear-gradient(180deg,#2c2150,#191231);border:1px solid rgba(212,149,43,.5);border-radius:12px;overflow:hidden;
  box-shadow:0 6px 18px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.09), inset 0 -9px 18px rgba(0,0,0,.28);
  transition:transform .16s, box-shadow .16s, border-color .16s;
  animation:mIn .5s cubic-bezier(.2,.7,.3,1) backwards}
.mbtn .mi{flex:0 0 40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:19px;border-radius:50%;
  background:radial-gradient(circle at 50% 36%,#3f2e70,#241840 74%);border:1px solid rgba(212,149,43,.55);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16), 0 2px 6px rgba(0,0,0,.4)}
.mbtn .ml{flex:1;text-align:center;padding-right:54px;white-space:nowrap}
.mbtn::after{content:'';position:absolute;top:0;left:-65%;width:45%;height:100%;transform:skewX(-18deg);
  background:linear-gradient(105deg,transparent,rgba(255,233,168,.16),transparent);transition:left .5s ease}
.mbtn:hover{transform:translateY(-2px);border-color:var(--gold-hi);
  box-shadow:0 10px 28px rgba(212,149,43,.32), inset 0 1px 0 rgba(255,255,255,.13)}
.mbtn:hover::after{left:118%}
.mbtn:active{transform:translateY(1px)}
.mbtn.primary{height:64px;font-size:21px;font-weight:700;color:#241503;border-color:#ffe9a8;
  background:linear-gradient(180deg,#ffd86e,#cf8f2c 55%,#9d6517);text-shadow:0 1px 0 rgba(255,240,190,.55);
  box-shadow:0 8px 26px rgba(240,185,58,.35), inset 0 1px 0 rgba(255,255,255,.5), inset 0 -10px 20px rgba(122,74,10,.4)}
.mbtn.primary .mi{background:radial-gradient(circle at 50% 36%,#fff3cd,#e3ab3e 76%);border-color:#8a5a13;text-shadow:none}
.mbtn.primary:hover{box-shadow:0 12px 34px rgba(240,185,58,.5);border-color:#fff3cd}
.mbtn.primary::after{background:linear-gradient(105deg,transparent,rgba(255,255,255,.35),transparent)}
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
.deck-pick-btns{display:flex;gap:12px;justify-content:center;align-items:stretch;margin-top:4px}
.deck-pick-btns .btn{min-width:170px;flex:0 0 170px;justify-content:center}
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
.cardcell{position:relative;cursor:pointer;transition:transform .14s;border-radius:10px}
.cardcell:hover{transform:translateY(-16px) scale(1.52);z-index:20}
.cardcell canvas{width:100%;height:auto;display:block;border-radius:10px;box-shadow:0 6px 16px rgba(0,0,0,.55)}
.cardcell .cnt{position:absolute;top:6px;right:6px;background:var(--gold);color:#1a1005;font-weight:700;font-size:14px;border-radius:12px;padding:2px 9px;box-shadow:0 2px 6px rgba(0,0,0,.6)}
.cardcell.dim canvas{filter:grayscale(.7) brightness(.55)}
.cardcell.locked canvas{filter:grayscale(1) brightness(.38)}
.cardcell.locked:hover{transform:translateY(-6px) scale(1.2)}
.cardcell .lockico{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);font-size:34px;filter:drop-shadow(0 3px 6px #000)}
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
/* stat nameplate overlay — HTML orbs + badges below each 3D creature */
#np-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:Georgia,serif}
.np-orb{position:absolute;transform:translate(-50%,-50%);width:28px;height:28px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:#fff;
  border:2px solid rgba(0,0,0,.6);box-shadow:0 2px 6px rgba(0,0,0,.65), inset 0 2px 3px rgba(255,255,255,.35);
  text-shadow:0 1px 2px rgba(0,0,0,.9);line-height:1}
.np-orb.atk[data-s=atk]{background:radial-gradient(circle at 38% 32%,#ff6a5a,#c8392e 60%,#5a140d)}
.np-orb.atk[data-s=atkBuff]{background:radial-gradient(circle at 38% 32%,#ffb37a,#ff7a3d 60%,#8a3a10);border-color:#ffd7a8}
.np-orb.hp[data-s=hp]{background:radial-gradient(circle at 38% 32%,#5fd07a,#2e8f3f 60%,#123f18)}
.np-orb.hp[data-s=hpBuff]{background:radial-gradient(circle at 38% 32%,#8fe6a0,#54d06a 60%,#1d6b2c);border-color:#bff0c9}
.np-orb.hp[data-s=hpHurt]{background:radial-gradient(circle at 38% 32%,#ff7a7a,#d43f3f 60%,#5a1010);border-color:#ffc2c2}
.np-badge{position:absolute;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-size:12px;
  background:rgba(10,8,18,.9);border:2px solid #888;box-shadow:0 1px 4px rgba(0,0,0,.6)}
/* coach tips — dismissible one-time hints for new players */
#coachtip{position:absolute;top:16px;left:50%;transform:translateX(-50%);z-index:40;pointer-events:auto;
  display:flex;align-items:center;gap:12px;max-width:min(560px,86vw);padding:11px 16px;
  background:linear-gradient(180deg,rgba(34,25,58,.96),rgba(20,14,38,.96));
  border:1px solid rgba(212,149,43,.65);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,233,168,.12);
  font-size:15px;line-height:1.45;color:#efe6ff;animation:mIn .4s cubic-bezier(.2,.7,.3,1)}
#coachtip .ci{flex:0 0 auto;font-size:19px}
#coachtip button{pointer-events:auto;cursor:pointer;flex:0 0 auto;font-family:inherit;font-size:13px;letter-spacing:.08em;
  color:#1a1005;background:linear-gradient(180deg,#ffe9a8,#d4952b);border:none;border-radius:8px;padding:7px 14px;font-weight:700}
#coachtip button:hover{filter:brightness(1.1)}
/* how-to-play tutorial */
.tut{width:min(92vw,690px)}
.tut .tut-body{min-height:300px;text-align:left;font-size:15.5px;line-height:1.62;color:#e2d9f5;padding:8px 4px 2px}
.tut .tut-body b{color:#ffe9a8}
.tut .tut-body p{margin:0 0 10px}
.tut .kwrow{display:flex;gap:11px;align-items:baseline;margin:4px 0}
.tut .kwg{flex:0 0 24px;text-align:center;color:#ffd45f}
.tut .tut-tip{margin-top:12px;padding:9px 13px;border-left:3px solid var(--gold);background:rgba(212,149,43,.09);border-radius:0 8px 8px 0;font-size:14px;color:#cbbfe8;font-style:italic}
.tut .tut-nav{display:flex;align-items:center;justify-content:space-between;margin-top:16px;gap:12px}
.tut .dots{display:flex;gap:7px}
.tut .dots i{width:9px;height:9px;border-radius:50%;background:#2c2150;border:1px solid #4a3a78}
.tut .dots i.on{background:linear-gradient(180deg,#ffe9a8,#d4952b);border-color:#ffe9a8}
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
@keyframes arcflow{to{stroke-dashoffset:-54}}
.arc-flow{animation:arcflow .9s linear infinite}
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
/* short viewports (hub iframe, laptops): compact menu, no footer overlap */
@media (max-height:760px){
  .game-title{font-size:clamp(24px,7vh,50px)}
  .game-sub{font-size:10px;letter-spacing:.4em;margin-top:-8px}
  .mdiv{display:none}
  .menu-inner{gap:7px;padding:10px 12px 6px}
  .menu-panel{padding:10px 20px 9px;gap:6px;border-radius:14px}
  .mbtn{height:clamp(34px,5.6vh,46px);font-size:clamp(13px,2.2vh,16px);width:min(360px,80vw);border-radius:10px}
  .mbtn .mi{flex-basis:28px;height:28px;font-size:14px}
  .mbtn .ml{padding-right:42px}
  .mbtn.primary{height:clamp(38px,6.2vh,52px);font-size:clamp(14px,2.4vh,18px)}
  .menu-foot{display:none}
}
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

  availableDecks() {
    return [...STARTER_DECKS, ...this.store.decks.filter((d) => validateDeck(d.cards).ok)];
  }
  isOwned(cardId) {
    return this.isOwnedFn ? this.isOwnedFn(cardId) : true;
  }

  show(name) {
    for (const s of this.root.querySelectorAll('.screen')) s.classList.remove('on');
    this.root.querySelector('#scr-' + name)?.classList.add('on');
    if (name === 'menu') {
      Audio2.playMusic('menu');
      const foot = this.root.querySelector('#scr-menu .menu-foot');
      if (foot) {
        const rec = this.store.record;
        foot.textContent = `${COLLECTIBLE.length} cards · 5 realms · Record ${rec.wins}W–${rec.losses}L · ForgeFlow Games · v1.3`;
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
    inner.append(this.el('div', 'mdiv', '❖'));
    const panel = this.el('div', 'menu-panel');
    for (const c of ['tl', 'tr', 'bl', 'br']) panel.append(this.el('span', 'mcorn ' + c));
    const mk = (icon, label, fn, primary) => {
      const b = this.el('button', 'mbtn' + (primary ? ' primary' : ''));
      b.innerHTML = `<span class="mi">${icon}</span><span class="ml">${label}</span>`;
      b.style.animationDelay = (panel.querySelectorAll('.mbtn').length * 60) + 'ms';
      b.onclick = () => { Audio2.ensure(); Audio2.resume(); Audio2.sfx('click'); fn(); };
      panel.append(b);
      return b;
    };
    mk('⚔', 'Play vs AI', () => this.openSetup(), true);
    mk('🏰', 'Campaign', () => this.onCampaign && this.onCampaign());
    mk('🌐', 'Play vs Other Players', () => this.openOnline());
    mk('🛠', 'Deck Builder', () => this.openBuilder());
    mk('📖', 'Collection', () => this.openCollection());
    mk('📜', 'How to Play', () => this.openTutorial());
    mk('⚙', 'Settings', () => this.show('settings'));
    inner.append(panel);
    const rec = this.store.record;
    const foot = this.el('div', 'menu-foot',
      `${COLLECTIBLE.length} cards · 5 realms · Record ${rec.wins}W–${rec.losses}L · ForgeFlow Games · v1.3`);
    s.append(bg, veil, inner, foot);
    this.root.append(s);
  }

  buildSetup() {
    const s = this.el('div', 'screen');
    s.id = 'scr-setup';
    this.root.append(s);
  }

  // ═══════════════ new-player coach tips ═══════════════
  // one-time contextual hints; toggle lives in Settings ("Gameplay tips")
  coach(key, text) {
    if (!this.store.settings.tips) return;
    this.store.tipsSeen = this.store.tipsSeen || [];
    if (this.store.tipsSeen.includes(key)) return;
    this.store.tipsSeen.push(key);
    Store.save();
    this._coachQ = this._coachQ || [];
    this._coachQ.push(text);
    if (!this._coachOn) this._nextCoach();
  }

  _nextCoach() {
    const q = this._coachQ;
    if (!q || !q.length) { this._coachOn = false; return; }
    this._coachOn = true;
    const text = q.shift();
    const tip = this.el('div');
    tip.id = 'coachtip';
    tip.innerHTML = `<span class="ci">💡</span><span>${text}</span>`;
    const ok = this.el('button', null, 'Got it');
    let t = null;
    const done = () => { tip.remove(); clearTimeout(t); setTimeout(() => this._nextCoach(), 400); };
    ok.onclick = () => { Audio2.sfx('click'); done(); };
    tip.append(ok);
    (this.root.querySelector('#hud') || this.root).append(tip);
    t = setTimeout(done, 15000);
  }

  // ═══════════════ how-to-play tutorial ═══════════════
  openTutorial() {
    const s = this.root.querySelector('#scr-setup');
    s.innerHTML = '';
    const bg = this.el('div', 'menu-bg');
    bg.style.backgroundImage = 'url(assets/ui/menu_bg.jpg)';
    s.append(bg, this.el('div', 'menu-veil'));
    const wrap = this.el('div', 'modal-wrap');
    wrap.style.background = 'transparent';
    const m = this.el('div', 'modal tut');
    const KWG = { guard: '🛡', swift: '»', flying: '≋', stealth: '◍', ward: '◇', lifesteal: '❤', venomous: '☠', cleave: '⚔', piercing: '➹', regenerate: '✚', frenzy: '🔥' };
    const kwRows = Object.entries(KEYWORD_INFO).map(([k, txt]) => {
      const [name, rest] = txt.split(' — ');
      return `<div class="kwrow"><span class="kwg">${KWG[k] || '•'}</span><span><b>${name}</b> — ${rest}</span></div>`;
    }).join('');
    const PAGES = [
      { t: 'THE GOAL', h: `
        <p>Both heroes start at <b>30 Health</b>. Bring the enemy hero to <b>0</b> before they do it to you.</p>
        <p>Every turn you <b>draw a card</b> and gain a <b>Mana crystal 💎</b>. Mana refills at the start of each of your turns and grows by one every turn (up to 10) — spend it freely on creatures and spells.</p>
        <p>When you're done, press <b>End Turn</b> (or SPACE).</p>
        <div class="tut-tip">Hover any card to read it — right-click for a closer look.</div>` },
      { t: 'PLAYING CARDS', h: `
        <p>Cards cost the mana shown in their top-left gem. Cards you can't afford are <b>dimmed</b>.</p>
        <p><b>🐉 Creatures</b> — click or drag one onto the table (up to 6). They fight for you every turn after.</p>
        <p><b>✨ Spells</b> — click the card; a golden arrow appears — click your target to cast. Spells with no target resolve instantly.</p>
        <p><b>⧗ Traps</b> — set face-down (up to 3). They spring automatically on your opponent's turn when their trigger is met.</p>` },
      { t: 'ATTACKING', h: `
        <p><b>Click one of your creatures</b>, then click an enemy creature — or their hero — to strike. Attackers and defenders deal their damage to each other at the same time.</p>
        <p>Fresh summons are drowsy for one turn (<b>summoning sickness</b>) unless they have <b>Swift »</b>.</p>
        <p>After attacking, a creature is <b>exhausted 💤</b> — it dims and rests until your next turn, and it can no longer protect Flying allies.</p>
        <p>If an enemy has <b>Guard 🛡</b>, you must break through it first.</p>` },
      { t: 'ORDER MATTERS', h: `
        <p>Your turn has two halves: <b>summoning, then combat</b>.</p>
        <p>The moment one of your creatures attacks, your turn moves into combat — you can still cast <b>spells</b>, but you can't summon <b>new creatures</b> until next turn.</p>
        <p>So the golden rule: <b>play your cards first, attack second.</b></p>
        <div class="tut-tip">The game handles this for you — just know that attacking closes the door on summoning.</div>` },
      { t: 'KEYWORDS', h: kwRows },
      { t: 'GROW YOUR LEGEND', h: `
        <p><b>🏰 Campaign</b> — battle across five realms. Every victory earns <b>gold</b> and unlocks new cards for your collection; bosses grant card backs.</p>
        <p><b>🃏 Arcane Packs</b> — spend gold in the Collection on packs weighted toward cards you don't own yet.</p>
        <p><b>🛠 Deck Builder</b> — craft 30-card decks from up to <b>two realms</b> (plus Neutral). Smart Fill finishes a deck for you.</p>
        <p><b>🌐 Play vs Other Players</b> — duel a friend live with a room code.</p>` },
    ];
    let page = 0;
    const title = this.el('h3', null, '');
    const body = this.el('div', 'tut-body');
    const nav = this.el('div', 'tut-nav');
    const prev = this.el('button', 'btn small', '← Back');
    const dots = this.el('div', 'dots');
    PAGES.forEach(() => dots.append(this.el('i')));
    const next = this.el('button', 'btn small primary', 'Next →');
    nav.append(prev, dots, next);
    const render = () => {
      const p = PAGES[page];
      title.innerHTML = `📜 ${p.t} <span style="color:#6f5f96;font-size:13px;letter-spacing:.1em">&nbsp;${page + 1} / ${PAGES.length}</span>`;
      body.innerHTML = p.h;
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i === page));
      prev.textContent = page === 0 ? '← Menu' : '← Back';
      next.textContent = page === PAGES.length - 1 ? '⚔ To Battle' : 'Next →';
    };
    prev.onclick = () => { Audio2.sfx('click'); if (page === 0) this.show('menu'); else { page--; render(); } };
    next.onclick = () => { Audio2.sfx('click'); if (page === PAGES.length - 1) this.openSetup(); else { page++; render(); } };
    render();
    m.append(title, body, nav);
    wrap.append(m);
    s.append(wrap);
    this.show('setup');
  }

  openSetup() {
    const s = this.root.querySelector('#scr-setup');
    s.innerHTML = '';
    const bg = this.el('div', 'menu-bg');
    bg.style.backgroundImage = 'url(assets/ui/menu_bg.jpg)';
    s.append(bg, this.el('div', 'menu-veil'));
    const wrap = this.el('div', 'modal-wrap');
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
      const owned = this.isOwned(c.id);
      if (!owned) {
        cell.classList.add('locked');
        cell.append(this.el('div', 'lockico', '🔒'));
        cell.onclick = () => { Audio2.sfx('error'); this.toast(`${c.name} — unlock it in the Campaign or an Arcane Pack!`); };
        cell.oncontextmenu = (e) => { e.preventDefault(); this.showInspect(c.id); };
        grid.append(cell);
        continue;
      }
      const n = counts[c.id] || 0;
      if (n) cell.append(this.el('div', 'cnt', '×' + n));
      // collection view: flag cards you hold spare copies of (sellable duplicates)
      if (!this.working && this.copiesOf) {
        const cp = this.copiesOf(c.id);
        if (cp >= 2) cell.append(this.el('div', 'dupe-badge', '×' + cp));
      }
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
        cell.onclick = () => { Audio2.sfx('click'); this.showInspect(c.id, null, { sellable: true }); };
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
    const pool = COLLECTIBLE.filter((c) => this.isOwned(c.id))
      .filter((c) => c.realm === 'neutral' || realms.has(c.realm) || (realms.size < 2 && c.realm !== 'neutral'))
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
    const title = this.collectionTitle ? this.collectionTitle() : `COLLECTION — ${COLLECTIBLE.length} CARDS`;
    top.append(this.el('h2', null, title));
    if (this.campaignStrip) top.append(this.campaignStrip());
    top.append(back);
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
    toggle('💡 Gameplay tips for new players', 'tips', (on) => {
      if (on) { this.store.tipsSeen = []; Store.save(); this.toast('Tips reset — they\'ll show again in your next match.'); }
    });
    // playable-card highlight color
    {
      const row = this.el('div', 'set-row');
      const sw = this.el('div');
      sw.style.cssText = 'display:flex;gap:9px';
      const COLORS = ['#4fd0e8', '#4fc06a', '#f0b93a', '#b47bff', '#ff6f8f', '#e8e0f5'];
      const dots = {};
      for (const c of COLORS) {
        const d = this.el('div');
        d.style.cssText = `width:24px;height:24px;border-radius:50%;cursor:pointer;background:${c};` +
          `border:2px solid ${st.glowColor === c ? '#fff' : 'transparent'};box-shadow:0 0 8px ${c}88`;
        d.onclick = () => {
          st.glowColor = c; Store.save(); Audio2.sfx('click');
          for (const [k, el] of Object.entries(dots)) el.style.borderColor = k === c ? '#fff' : 'transparent';
        };
        dots[c] = d; sw.append(d);
      }
      row.append(this.el('label', null, '🎨 Highlight color'), sw);
      wrap.append(row);
    }
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
    wrap.append(reset, this.el('div', 'hint', 'Right-click any card for a closer look. SPACE ends your turn.'));
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
    // buttons — no phase strip: attacking auto-enters combat, coach tips
    // teach the ordering rule instead
    const btns = this.el('div');
    btns.id = 'turnbtns';
    // multi-attack is now gang-up (pick attackers, click one target) — no button
    this.endBtn = this.el('button', 'btn small primary', 'End Turn');
    this.endBtn.onclick = () => this.match?.endTurn();
    btns.append(this.endBtn);
    // tools
    const tools = this.el('div');
    tools.id = 'matchtools';
    const gear = this.el('div', 'tool', '⚙');
    gear.onclick = () => this.matchSettings();
    const flag = this.el('div', 'tool', '🏳');
    flag.title = 'Concede';
    flag.onclick = () => this.confirmBox('Concede this match?', () => this.match?.concede());
    tools.append(gear, flag);
    // overlays
    this.floatLayer = this.el('div');
    this.bannerEl = this.el('div'); this.bannerEl.id = 'banner';
    this.cardBannerEl = this.el('div'); this.cardBannerEl.id = 'cardbanner';
    this.toastEl = this.el('div'); this.toastEl.id = 'toasts';
    // premium targeting arrow — solid glowing arc with an ornate head
    this.arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrowSvg.id = 'arrow-svg';
    this.arrowSvg.innerHTML = `
      <defs>
        <linearGradient id="arcGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">
          <stop offset="0" stop-color="#ffe9a8"/>
          <stop offset="1" stop-color="#ffb43d"/>
        </linearGradient>
        <filter id="arcGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="7"/>
        </filter>
      </defs>
      <g id="arcGroup" visibility="hidden">
        <path id="arcGlowPath" fill="none" stroke="#ffb43d" stroke-width="16" stroke-linecap="round" opacity="0.4" filter="url(#arcGlow)"/>
        <path id="arcCore" fill="none" stroke="url(#arcGrad)" stroke-width="5.5" stroke-linecap="round"/>
        <path id="arcFlow" class="arc-flow" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.75" stroke-dasharray="3 24"/>
        <g id="arcHead">
          <polygon class="ah-main" points="0,-13 22,0 0,13 6,0" fill="#ffe9a8" stroke="#8a5a13" stroke-width="1.5"/>
          <polygon points="-6,-5 0,0 -6,5 -3,0" fill="#ffd45f" opacity="0.9"/>
        </g>
      </g>`;
    this.arcGroup = this.arrowSvg.querySelector('#arcGroup');
    this.arcGlowPath = this.arrowSvg.querySelector('#arcGlowPath');
    this.arcCore = this.arrowSvg.querySelector('#arcCore');
    this.arcFlow = this.arrowSvg.querySelector('#arcFlow');
    this.arcHead = this.arrowSvg.querySelector('#arcHead');
    this.arcGrad = this.arrowSvg.querySelector('#arcGrad');
    this.inspectEl = this.el('div'); this.inspectEl.id = 'inspect';
    const insCanvas = document.createElement('canvas');
    this.inspectCanvas = insCanvas;
    this.inspectKws = this.el('div', 'kws');
    this.inspectEl.append(insCanvas, this.inspectKws);
    hud.append(this.plateMe, this.plateFoe, btns, tools, this.bannerEl, this.cardBannerEl, this.toastEl, this.arrowSvg, this.inspectEl, this.floatLayer);
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
      plate.querySelector('.zhand').textContent = ''; // hand-count ✋ removed (owner)
      plate.querySelector('.ztrap').textContent = pl.traps.length ? `⧗ ${pl.traps.length}` : '';
    };
    upd(this.plateMe, mySide);
    upd(this.plateFoe, 1 - mySide);
    // buttons
    const myTurn = state.active === mySide && state.winner === null && !match.busy;
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

  // mode: 'attack' (ember gold) | 'spell' (arcane gold→cyan). Solid glowing arc.
  showArrow(x1, y1, x2, y2, mode = 'attack') {
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.min(150, dist * 0.24) - 26;
    const d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
    this.arcGlowPath.setAttribute('d', d);
    this.arcCore.setAttribute('d', d);
    this.arcFlow.setAttribute('d', d);
    this.arcGrad.setAttribute('x1', x1); this.arcGrad.setAttribute('y1', y1);
    this.arcGrad.setAttribute('x2', x2); this.arcGrad.setAttribute('y2', y2);
    const stops = this.arcGrad.querySelectorAll('stop');
    const head = this.arcHead.querySelector('.ah-main');
    if (mode === 'spell') {
      stops[0].setAttribute('stop-color', '#ffe9a8');
      stops[1].setAttribute('stop-color', '#6fd8ff');
      this.arcGlowPath.setAttribute('stroke', '#5fc0f0');
      head.setAttribute('fill', '#bfeaff');
    } else {
      stops[0].setAttribute('stop-color', '#ffe9a8');
      stops[1].setAttribute('stop-color', '#ffb43d');
      this.arcGlowPath.setAttribute('stroke', '#ffb43d');
      head.setAttribute('fill', '#ffe9a8');
    }
    const ang = Math.atan2(y2 - my, x2 - mx) * 180 / Math.PI;
    this.arcHead.setAttribute('transform', `translate(${x2} ${y2}) rotate(${ang})`);
    this.arcGroup.setAttribute('visibility', 'visible');
  }
  hideArrow() { this.arcGroup.setAttribute('visibility', 'hidden'); }

  // ── multi-attack: persistent "committed" arrows for queued attacks ──
  addQueuedArrow(qid, x1, y1, x2, y2) {
    const NS = 'http://www.w3.org/2000/svg';
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.min(150, dist * 0.24) - 26;
    const d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
    const g = document.createElementNS(NS, 'g');
    g.dataset.qid = qid;
    const glow = document.createElementNS(NS, 'path');
    glow.setAttribute('d', d); glow.setAttribute('fill', 'none');
    glow.setAttribute('stroke', '#ff5f3d'); glow.setAttribute('stroke-width', '11');
    glow.setAttribute('stroke-linecap', 'round'); glow.setAttribute('opacity', '0.35');
    glow.setAttribute('filter', 'url(#arcGlow)');
    const core = document.createElementNS(NS, 'path');
    core.setAttribute('d', d); core.setAttribute('fill', 'none');
    core.setAttribute('stroke', '#ff8a3d'); core.setAttribute('stroke-width', '4');
    core.setAttribute('stroke-linecap', 'round');
    const ang = Math.atan2(y2 - my, x2 - mx) * 180 / Math.PI;
    const head = document.createElementNS(NS, 'polygon');
    head.setAttribute('points', '0,-11 20,0 0,11 5,0');
    head.setAttribute('fill', '#ffcf6a'); head.setAttribute('stroke', '#8a3a10'); head.setAttribute('stroke-width', '1.5');
    head.setAttribute('transform', `translate(${x2} ${y2}) rotate(${ang})`);
    g.append(glow, core, head);
    this.arrowSvg.append(g);
  }
  clearQueuedArrows() {
    for (const g of this.arrowSvg.querySelectorAll('g[data-qid]')) g.remove();
  }
  showAttackButton(n) {
    if (!this.attackBtn) return;
    this.attackBtn.style.display = n > 0 ? '' : 'none';
    this.attackBtn.textContent = `⚔ Attack (${n})`;
  }

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

  showInspect(cardId, unit, opts = {}) {
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
    // ── collection: copies owned + sell a duplicate for gold ──
    if (opts.sellable && this.copiesOf) {
      const n0 = this.copiesOf(cardId);
      const info = this.el('div', null, `You own <b style="color:#ffe9a8">×${n0}</b>`);
      info.style.cssText = 'font-size:13px;color:#c4b4e4;margin-top:2px';
      right.append(info);
      if (this.sellCard && def.rarity !== 'token') {
        const val = this.sellValueOf ? this.sellValueOf(def.rarity) : 0;
        const sell = this.el('button', 'sell-btn');
        const label = (n) => n >= 2 ? `Sell duplicate · +${val}g` : 'No duplicates to sell';
        sell.textContent = label(n0); sell.disabled = n0 < 2;
        sell.onclick = () => {
          const r = this.sellCard(cardId);
          if (!r.ok) { Audio2.sfx('error'); this.toast(r.reason); return; }
          Audio2.sfx('coin');
          this.toast(`Sold a duplicate ${def.name} for ${r.gold}g.`);
          const nn = this.copiesOf(cardId);
          info.innerHTML = `You own <b style="color:#ffe9a8">×${nn}</b>`;
          sell.textContent = label(nn); sell.disabled = nn < 2;
          if (this.onGoldChange) this.onGoldChange();
          if (this.gridEl) this.renderGrid();
        };
        right.append(sell);
      }
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

  // in-DOM confirm — native confirm() is blocked in the embedded hub iframe,
  // which is why Concede / Main Menu appeared to "do nothing"
  confirmBox(msg, onYes) {
    const wrap = this.el('div', 'modal-wrap');
    wrap.style.zIndex = 200;
    const m = this.el('div', 'modal');
    m.style.cssText = 'max-width:min(92vw,460px);width:max-content;overflow:visible';
    m.append(this.el('div', null, `<div style="font-size:16px;line-height:1.5;color:#efe9fb;margin-bottom:18px;text-align:center">${msg}</div>`));
    const row = this.el('div');
    row.style.cssText = 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap';
    const yes = this.el('button', 'btn small primary', 'Yes');
    yes.onclick = () => { Audio2.sfx('click'); wrap.remove(); onYes(); };
    const no = this.el('button', 'btn small', 'Cancel');
    no.onclick = () => { Audio2.sfx('click'); wrap.remove(); };
    row.append(yes, no);
    m.append(row);
    wrap.append(m);
    this.root.append(wrap);
  }

  matchSettings() {
    const wrap = this.el('div', 'modal-wrap');
    const m = this.el('div', 'modal');
    m.append(this.el('h3', null, '⏸ PAUSED'));
    const st = this.store.settings;
    const mkSlide = (label, key, apply) => {
      const row = this.el('div', 'set-row');
      const inp = this.el('input');
      inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.05; inp.value = st[key];
      inp.oninput = () => { st[key] = parseFloat(inp.value); apply(st[key]); Store.save(); };
      row.append(this.el('label', null, label), inp);
      m.append(row);
    };
    const mkToggle = (label, key, apply) => {
      const row = this.el('div', 'set-row');
      const sw = this.el('div', 'switch' + (st[key] ? ' on' : ''), '<i></i>');
      sw.onclick = () => { st[key] = !st[key]; sw.classList.toggle('on', st[key]); apply && apply(st[key]); Store.save(); Audio2.sfx('click'); };
      row.append(this.el('label', null, label), sw);
      m.append(row);
    };
    mkSlide('🎵 Music', 'music', (v) => Audio2.setMusicVolume(v));
    mkSlide('🔊 Effects', 'sfx', (v) => { Audio2.setSfxVolume(v); Audio2.sfx('impact'); });
    const speed = () => this.onSpeedChange && this.onSpeedChange();
    mkToggle('✨ Rich particles', 'particles', speed);
    mkToggle('📳 Screen shake', 'shake', speed);
    mkToggle('⚡ Fast animations', 'fastAnim', speed);
    mkToggle('💡 Gameplay tips', 'tips', () => {});
    // ── action row: Resume / Concede / Main Menu ──
    const row = this.el('div');
    row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:20px';
    const resume = this.el('button', 'btn small primary', '▶ Resume');
    resume.onclick = () => { Audio2.sfx('click'); wrap.remove(); };
    const concede = this.el('button', 'btn small danger', '🏳 Concede');
    concede.onclick = () => this.confirmBox('Concede this match?', () => { wrap.remove(); this.match?.concede(); });
    const menu = this.el('button', 'btn small', '🏠 Main Menu');
    menu.onclick = () => this.confirmBox('Quit to the main menu? This forfeits the current match.', () => {
      Audio2.sfx('click'); wrap.remove();
      this.match?.destroy(); this.match = null;
      window.__ARC__.leaveMatch();
      this.show('menu');
    });
    row.append(resume, concede, menu);
    m.append(row);
    m.append(this.el('div', 'hint', 'Right-click any card for a closer look · SPACE ends your turn'));
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
    const diffLabel = stats.online ? 'Online Duel' : (DIFFICULTIES[stats.difficulty]?.label || stats.difficulty);
    w.append(this.el('div', 'gstats',
      `${won ? 'The realms sing your name.' : 'The realms will remember your stand.'}<br>` +
      `Turns: ${stats.turns} · Damage dealt: ${stats.dmg} · Cards played: ${stats.played} · Mode: ${diffLabel}<br>` +
      `Record: ${rec.wins}W – ${rec.losses}L`));
    const row = this.el('div');
    row.style.cssText = 'display:flex;gap:12px';
    if (this.afterMatch) { try { this.afterMatch(won); } catch { /* achievements sweep */ } }
    if (stats.campaign) {
      const retry = this.el('button', 'btn primary', '↺ Retry Battle');
      retry.onclick = () => { Audio2.sfx('click'); s.classList.remove('on'); this._campaignRetry && this._campaignRetry(); };
      const camp = this.el('button', 'btn', '🏰 Campaign Map');
      camp.onclick = () => { Audio2.sfx('click'); s.classList.remove('on'); this.match?.destroy(); this.match = null; window.__ARC__.leaveMatch(); this.onCampaign(); };
      row.append(retry, camp);
    } else if (!stats.online) {
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
