// BLOCKTOOTH — in-play HUD (CONTRACT.md §12). ui lane.
// A local-TV broadcast package first, a game HUD second:
//   top-left   WARD-7 • LIVE bug (pulsing red dot) + broadcast clock + run timer
//   top-right  TONNAGE / BLOCKS / CRUSHED counters, upgrade chips column below
//   bottom-left cream status card: titan, HP (+damage trail, shield), LV, big roman SIZE +
//              GROW bar (sizeProgress: levels to the next Size), XP bar, dash pips, hook cooldown dial with key hint
//   bottom     WARD-7 WIRE ticker crawl (live items injected on big moments)
//   overlay    low-HP vignette pulse, hurt edge flash, pickup / level flashes
// update() is change-only: every DOM write goes through TextSlot / VarSlot / ClassSlot.

import type { SimEvent, World } from '../core/types.ts';
import { RANK_LEVELS, sizeProgress } from '../core/config.ts';
import { TITANS } from '../data/titans.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';
import { BOSSES } from '../data/bosses.ts';
import { STR, TICKER, RANK_SUBS } from '../data/strings.ts';
import {
  ClassSlot, TextSlot, VarSlot, clearEl, div, el, fmt, fmtClock, fmtInt, fmtTime, flashesReduced,
  keyChip, pulse, roman,
} from './dom.ts';

const LOW_HP = 0.3;
const TRAIL_HOLD_S = 0.4;
const TRAIL_RATE = 0.9;          // fraction of max HP per second the trail drains
const MAX_CHIPS = 14;
const WIRE_CAP = 6;              // VOLT-KITE live-wire cap (CONTRACT §8)
const ZOOM_HINT_BRIGHT_S = 20;   // the zoom key hint is at full strength for this long into a run

/** CSS unit (--u) in px, mirrored from styles.css: max(8px, min(1vw, 1.7778vh)). */
function unitPx(): number { return Math.max(8, Math.min(window.innerWidth / 100, (window.innerHeight * 1.7778) / 100)); }

interface TickerItem { node: HTMLElement; w: number; }

export class Hud {
  private readonly root: HTMLElement;
  private readonly layer: HTMLDivElement;
  private world: World | null = null;
  private shown = false;

  // bug
  private readonly clock: TextSlot;
  private readonly runT: TextSlot;
  // counters
  private readonly tonsVal: TextSlot;
  private readonly blocksVal: TextSlot;
  private readonly crushVal: TextSlot;
  private readonly tonsBox: HTMLElement;
  private readonly blocksBox: HTMLElement;
  private readonly crushBox: HTMLElement;
  private tonsShown = 0;
  private lastBlocks = -1;
  private lastCrushed = -1;
  // chips
  private readonly chipsWrap: HTMLElement;
  private readonly chipsList: HTMLElement;
  private chipSig = '';
  // status card
  private readonly card: HTMLElement;
  private readonly nameT: TextSlot;
  private readonly roleT: TextSlot;
  private readonly lvT: TextSlot;
  private readonly lvBox: HTMLElement;
  private readonly sizeT: TextSlot;
  private readonly sizeBox: HTMLElement;
  private readonly hpFill: VarSlot;
  private readonly hpTrail: VarSlot;
  private readonly hpShield: VarSlot;
  private readonly hpVal: TextSlot;
  private readonly hpBar: HTMLElement;
  private readonly massFill: VarSlot;
  private readonly massVal: TextSlot;
  private readonly massBar: HTMLElement;
  private readonly zoomHint: HTMLElement;
  private readonly zoomDim: ClassSlot;
  private readonly xpFill: VarSlot;
  private readonly xpBar: HTMLElement;
  private readonly shellRow: HTMLElement;
  private readonly shellFill: VarSlot;
  private readonly shellOn: ClassSlot;
  private readonly shellLbl: TextSlot;
  private readonly shellVal: TextSlot;
  private readonly cardLow: ClassSlot;
  private readonly pipsBox: HTMLElement;
  private pips: { node: HTMLElement; fill: VarSlot; full: ClassSlot }[] = [];
  private readonly hookDial: VarSlot;
  private readonly hookCdT: TextSlot;
  private readonly hookReady: ClassSlot;
  private readonly hookName: TextSlot;
  private readonly hookBox: HTMLElement;
  private readonly lvFlash: HTMLElement;
  private readonly lowHpOn: ClassSlot;
  private readonly vignette: HTMLElement;
  private readonly hurtFlash: HTMLElement;

  // derived state
  private trail = 1;
  private trailHold = 0;
  private lastHpFrac = 1;
  private hookMax = 1;
  private lastHookCd = 0;
  private lastRank = -1;
  private lastLevel = -1;
  private lastPickupFx = 0;
  private lastHurtFx = 0;
  private tickSpan = -1;

  // ticker
  private readonly tkWin: HTMLElement;
  private readonly tkStrip: HTMLElement;
  private tkItems: TickerItem[] = [];
  private tkOffset = 0;
  private tkWidth = 0;
  private tkDeck: string[] = [];
  private tkLive: string[] = [];
  private u = unitPx();
  private tkWinW = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    const L = this.layer = div('bt-layer bt-hud bt-hidden', root);

    this.vignette = div('bt-vignette', L);
    this.hurtFlash = div('bt-hurtflash', L);
    this.lowHpOn = new ClassSlot(this.vignette, 'on');

    // ── bug (top-left)
    const bug = div('bt-bug', L);
    const net = div('bt-bug-net', bug);
    div('bt-dot', net);
    net.appendChild(el('b', '', STR.network));
    net.appendChild(el('i', '', '•'));
    net.appendChild(el('span', '', STR.live));
    const clk = div('bt-bug-clock', bug);
    this.clock = new TextSlot(el('span', 'bt-clock'));
    clk.appendChild(this.clock.node);
    this.runT = new TextSlot(el('span', 'bt-runt'));
    clk.appendChild(this.runT.node);

    // ── counters (top-right)
    const ctr = div('bt-counters', L);
    const mk = (label: string, unit?: string) => {
      const box = div('bt-counter', ctr);
      box.appendChild(el('span', 'bt-counter-lbl', label));
      const v = el('span', 'bt-counter-val', '0');
      box.appendChild(v);
      if (unit) box.appendChild(el('span', 'bt-counter-unit', unit));
      return { box, slot: new TextSlot(v) };
    };
    const t = mk(STR.hud.tonnage, STR.hud.tons); this.tonsBox = t.box; this.tonsVal = t.slot;
    const b = mk(STR.hud.blocks); this.blocksBox = b.box; this.blocksVal = b.slot;
    const c = mk(STR.hud.crushed); this.crushBox = c.box; this.crushVal = c.slot;

    // ── upgrade chips (right column)
    this.chipsWrap = div('bt-chips bt-hidden', L);
    div('bt-chips-head', this.chipsWrap, STR.hud.mutations);
    this.chipsList = div('bt-chips-list', this.chipsWrap);

    // ── status card (bottom-left)
    const card = this.card = div('bt-status', L);
    const head = div('bt-status-head', card);
    this.nameT = new TextSlot(el('span', 'bt-status-name'));
    head.appendChild(this.nameT.node);
    this.roleT = new TextSlot(el('span', 'bt-status-role'));
    head.appendChild(this.roleT.node);
    this.lvBox = div('bt-status-lv', head);
    this.lvBox.appendChild(el('small', '', STR.hud.lv));
    this.lvT = new TextSlot(el('b', ''));
    this.lvBox.appendChild(this.lvT.node);

    const body = div('bt-status-body', card);
    this.sizeBox = div('bt-size', body);
    div('bt-size-lbl', this.sizeBox, STR.hud.size);
    this.sizeT = new TextSlot(div('bt-size-num', this.sizeBox, 'I'));

    const bars = div('bt-bars', body);
    const bar = (cls: string, label: string) => {
      const row = div(`bt-bar ${cls}`, bars);
      div('bt-bar-lbl', row, label);
      const track = div('bt-bar-track', row);
      const val = div('bt-bar-val', row);
      return { row, track, val };
    };
    const hp = bar('bt-bar-hp', STR.hud.hp);
    this.hpBar = hp.row;
    this.hpShield = new VarSlot(div('bt-bar-shield', hp.track), '--p');
    this.hpTrail = new VarSlot(div('bt-bar-trail', hp.track), '--p');
    this.hpFill = new VarSlot(div('bt-bar-fill', hp.track), '--p');
    div('bt-bar-ticks', hp.track);
    this.hpVal = new TextSlot(hp.val);
    // SIZE progress by LEVEL (growth is level-driven): fill = XP toward the next Size's level,
    // value = levels gained / levels in this Size → the next Size
    const ms = bar('bt-bar-mass', STR.hud.grow);
    this.massBar = ms.row;
    this.massFill = new VarSlot(div('bt-bar-fill', ms.track), '--p');
    div('bt-bar-lvticks', ms.track);
    this.massVal = new TextSlot(ms.val);
    const xp = bar('bt-bar-xp', STR.hud.xp);
    this.xpBar = xp.row;
    this.xpFill = new VarSlot(div('bt-bar-fill', xp.track), '--p');
    xp.val.remove();
    const sh = bar('bt-bar-shell', STR.hud.shell);
    this.shellRow = sh.row;
    this.shellFill = new VarSlot(div('bt-bar-fill', sh.track), '--p');
    this.shellLbl = new TextSlot(sh.row.firstElementChild as HTMLElement);
    this.shellVal = new TextSlot(sh.val);
    this.shellOn = new ClassSlot(this.shellRow, 'on');
    this.cardLow = new ClassSlot(card, 'lowhp');

    const foot = div('bt-status-foot', card);
    // label line carries the key chip ("DASH [SHIFT]" over the pips, "HOOK [SPACE]" over the
    // hook name) so a long hook name can never push a chip out of the card
    const dash = div('bt-dash', foot);
    const dl = div('bt-foot-line', dash);
    div('bt-foot-lbl', dl, STR.hud.dash);
    dl.appendChild(keyChip(STR.hud.keyDash));
    this.pipsBox = div('bt-pips', dash);

    const hook = this.hookBox = div('bt-hook', foot);
    const dial = div('bt-dial', hook);
    this.hookDial = new VarSlot(dial, '--p', 0.005);
    this.hookCdT = new TextSlot(div('bt-dial-cd', dial));
    this.hookReady = new ClassSlot(hook, 'ready');
    const htxt = div('bt-hook-txt', hook);
    const hl = div('bt-foot-line', htxt);
    div('bt-foot-lbl', hl, STR.hud.hook);
    hl.appendChild(keyChip(STR.hud.keyHook));
    this.hookName = new TextSlot(div('bt-hook-name', htxt));

    this.lvFlash = div('bt-lvflash', card, STR.hud.levelUp);

    // ── camera zoom key hints (bottom-right, above the ticker)
    const zh = this.zoomHint = div('bt-zoomhint', L);
    div('bt-zoomhint-lbl', zh, STR.hud.zoom);
    zh.appendChild(keyChip(STR.hud.keyZoomWheel));
    zh.appendChild(keyChip(STR.hud.keyZoomIn));
    zh.appendChild(keyChip(STR.hud.keyZoomOut));
    div('bt-zoomhint-gap', zh);
    zh.appendChild(keyChip(STR.hud.keyZoomReset));
    div('bt-zoomhint-lbl', zh, STR.hud.zoomReset);
    this.zoomDim = new ClassSlot(zh, 'dim');

    // ── ticker (bottom)
    const tk = div('bt-ticker', L);
    div('bt-ticker-label', tk, STR.hud.tickerLabel);
    this.tkWin = div('bt-ticker-win', tk);
    this.tkStrip = div('bt-ticker-strip', this.tkWin);

    window.addEventListener('resize', () => { this.u = unitPx(); this.tkWinW = 0; this.remeasureTicker(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.remeasureTicker()).catch(() => {});
  }

  show(on: boolean): void {
    this.shown = on;
    this.layer.classList.toggle('bt-hidden', !on);
  }

  // ─────────────────────────────── per frame ───────────────────────────────

  update(w: World, dt: number): void {
    if (w !== this.world) this.bind(w);
    if (!this.shown) return;
    const T = w.titan;
    const d = Math.min(0.1, Math.max(0, dt || 0));

    // bug
    this.clock.set(fmtClock((STR.clockStart[w.biomeId] ?? 14 * 60) + w.t / 60));
    this.runT.set(STR.hud.runPrefix + fmtTime(w.t));

    // counters
    const tons = Math.max(0, w.run.tonnage);
    if (Math.abs(tons - this.tonsShown) < 0.5) this.tonsShown = tons;
    else this.tonsShown += (tons - this.tonsShown) * Math.min(1, d * 7);
    this.tonsVal.set(fmtInt(this.tonsShown));
    if (w.run.blocksLeveled !== this.lastBlocks) {
      if (this.lastBlocks >= 0 && w.run.blocksLeveled > this.lastBlocks) {
        pulse(this.blocksBox, [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], 380);
        this.pushWire(fmt(STR.hud.wire.block, { n: w.run.blocksLeveled }));
      }
      this.lastBlocks = w.run.blocksLeveled;
      this.blocksVal.set(fmtInt(w.run.blocksLeveled));
    }
    if (T.crushed !== this.lastCrushed) {
      if (this.lastCrushed >= 0 && T.crushed > this.lastCrushed) pulse(this.crushBox, [{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], 260);
      this.lastCrushed = T.crushed;
      this.crushVal.set(fmtInt(T.crushed));
    }

    // level + size
    if (T.level !== this.lastLevel) { this.lastLevel = T.level; this.lvT.set(String(T.level)); }
    if (T.rank !== this.lastRank) {
      const grew = this.lastRank >= 0 && T.rank > this.lastRank;
      this.lastRank = T.rank;
      this.sizeT.set(roman(T.rank));
      this.sizeBox.dataset.rank = String(T.rank);
      if (grew) pulse(this.sizeBox, [{ transform: 'scale(1.45) rotate(-4deg)' }, { transform: 'scale(0.94)' }, { transform: 'scale(1)' }], 700);
    }

    // HP + trail + shield
    const maxHp = Math.max(1, T.maxHp);
    const hpF = Math.max(0, Math.min(1, T.hp / maxHp));
    if (hpF >= this.trail) { this.trail = hpF; this.trailHold = 0; }
    else if (this.trailHold > 0) this.trailHold -= d;
    else this.trail = Math.max(hpF, this.trail - TRAIL_RATE * d);
    if (hpF < this.lastHpFrac - 1e-4) this.trailHold = Math.max(this.trailHold, TRAIL_HOLD_S);
    this.lastHpFrac = hpF;
    this.hpFill.set(hpF);
    this.hpTrail.set(this.trail);
    this.hpShield.set(Math.max(0, Math.min(1, (w.upgrades.shield || 0) / maxHp)));
    this.hpVal.set(`${Math.ceil(Math.max(0, T.hp))} / ${Math.round(maxHp)}`);
    this.lowHpOn.set(T.alive && hpF < LOW_HP);
    this.cardLow.set(T.alive && hpF < LOW_HP);

    // SIZE progress by level: XP toward the level that breaches the next Size
    if (T.rank < 4) {
      const L0 = RANK_LEVELS[T.rank], L1 = RANK_LEVELS[T.rank + 1];
      const span = Math.max(1, L1 - L0);
      this.massFill.set(sizeProgress(T.rank, T.level, T.xp));
      this.massVal.set(fmt(STR.hud.growVal, { n: Math.max(0, Math.min(span, T.level - L0)), of: span, size: roman(T.rank + 1) }));
      if (span !== this.tickSpan) { this.tickSpan = span; this.massBar.style.setProperty('--lvticks', String(span)); }
    } else {
      this.massFill.set(1);
      this.massVal.set(STR.hud.massMax);
      if (this.tickSpan !== 0) { this.tickSpan = 0; this.massBar.style.setProperty('--lvticks', '1'); }
    }

    // zoom hint: full strength for the first seconds of a run, then it steps back
    this.zoomDim.set(w.t > ZOOM_HINT_BRIGHT_S);

    // XP
    this.xpFill.set(T.xpToNext > 0 ? Math.max(0, Math.min(1, T.xp / T.xpToNext)) : 0);

    // kit meter: HEARTHBACK shell (kit.stored / kit.cap) · VOLT-KITE live wires · BRIARWICK blooms
    this.updateKitRow(w);

    // dash pips
    this.updatePips(w);

    // hook dial: learn the cooldown length from the value it jumps to
    const cd = Math.max(0, T.abilityCd || 0);
    if (cd > this.lastHookCd + 0.05) this.hookMax = Math.max(0.1, cd);
    if (cd <= 0 && this.lastHookCd > 0) pulse(this.hookBox, [{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }], 320);
    this.lastHookCd = cd;
    this.hookDial.set(cd <= 0 ? 1 : 1 - Math.min(1, cd / this.hookMax));
    this.hookCdT.set(cd <= 0 ? '' : cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1));
    this.hookReady.set(cd <= 0);

    // chips (signature changes only on drafts)
    this.updateChips(w);

    // ticker crawl
    this.stepTicker(d);
  }

  onEvents(w: World, ev: readonly SimEvent[]): void {
    if (w !== this.world) this.bind(w);
    const now = performance.now();
    for (const e of ev) {
      switch (e.type) {
        case 'titanHurt':
          if (now - this.lastHurtFx > 120 && e.dmg > 0) {
            this.lastHurtFx = now;
            const big = e.dmg > w.titan.maxHp * 0.08;
            pulse(this.card, big
              ? [{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,3px)' }, { transform: 'translate(5px,-2px)' }, { transform: 'translate(-2px,1px)' }, { transform: 'translate(0,0)' }]
              : [{ transform: 'translate(0,0)' }, { transform: 'translate(-3px,1px)' }, { transform: 'translate(0,0)' }], big ? 320 : 180);
            const peak = flashesReduced() ? 0.18 : big ? 0.75 : 0.4;
            pulse(this.hurtFlash, [{ opacity: peak }, { opacity: 0 }], big ? 420 : 260, 'ease-out');
          }
          break;
        case 'pickup':
          if (e.kind === 'heal') pulse(this.hpBar, [{ filter: 'brightness(1.8) saturate(1.4)' }, { filter: 'none' }], 500);
          else if (now - this.lastPickupFx > 90) {
            this.lastPickupFx = now;
            pulse(this.xpBar, [{ filter: 'brightness(1.7)' }, { filter: 'none' }], 220);
          }
          break;
        case 'levelUp':
          pulse(this.massBar, [{ filter: 'brightness(1.6) saturate(1.3)', transform: 'scaleY(1.25)' }, { filter: 'none', transform: 'none' }], 520);
          pulse(this.lvBox, [{ transform: 'scale(1.6)', color: '#ff6f5e' }, { transform: 'scale(1)' }], 520);
          pulse(this.lvFlash, [
            { opacity: 0, transform: 'translate(-50%, 30%) scale(.6) rotate(-6deg)' },
            { opacity: 1, transform: 'translate(-50%, -20%) scale(1.08) rotate(-4deg)', offset: 0.2 },
            { opacity: 1, transform: 'translate(-50%, -30%) scale(1) rotate(-4deg)', offset: 0.75 },
            { opacity: 0, transform: 'translate(-50%, -70%) scale(1) rotate(-4deg)' },
          ], 1100);
          break;
        case 'rankUp':
          this.pushWire(fmt(STR.hud.wire.rankUp, { size: roman(e.rank) }) + ' — ' + (RANK_SUBS[e.rank] ?? '').replace(/^SIZE [IV]+ CONFIRMED — /, ''));
          break;
        case 'eliteSpawn':
          this.pushWire(STR.hud.wire.elite);
          break;
        case 'bossSpawn': {
          const def = BOSSES[e.boss];
          this.pushWire(fmt(STR.hud.wire.boss, { boss: def ? def.name : e.boss.toUpperCase() }));
          break;
        }
        case 'chest':
          this.pushWire(STR.hud.wire.chest);
          break;
        default:
          break;
      }
    }
  }

  // ─────────────────────────────── internals ───────────────────────────────

  /** New run (or first frame): reset every cache so nothing from the last run leaks. */
  private bind(w: World): void {
    this.world = w;
    const def = TITANS[w.titanId];
    this.nameT.set(def ? def.name : w.titanId.toUpperCase());
    this.roleT.set(def ? def.role : '');
    this.hookName.set(def ? def.hook.name : STR.hud.hook);
    this.card.style.setProperty('--titan', def ? def.colors.primary : '#3fae7f');
    this.card.style.setProperty('--titan-2', def ? def.colors.secondary : '#1f6f55');
    this.trail = 1; this.trailHold = 0; this.lastHpFrac = 1;
    this.hookMax = 1; this.lastHookCd = 0; this.kitKind = '';
    this.lastRank = -1; this.lastLevel = -1; this.lastBlocks = -1; this.lastCrushed = -1; this.tickSpan = -1;
    this.tonsShown = Math.max(0, w.run.tonnage);
    this.chipSig = '#';
    for (const s of [this.clock, this.runT, this.tonsVal, this.blocksVal, this.crushVal, this.lvT, this.sizeT, this.hpVal, this.massVal, this.hookCdT, this.shellLbl, this.shellVal]) s.reset();
    for (const v of [this.hpFill, this.hpTrail, this.hpShield, this.massFill, this.xpFill, this.shellFill, this.hookDial]) v.reset();
    for (const c of [this.lowHpOn, this.shellOn, this.hookReady, this.cardLow, this.zoomDim]) c.reset();
    this.pips = [];
    clearEl(this.pipsBox);
    this.tkLive = [];
    this.resetTicker();
  }

  private updatePips(w: World): void {
    const T = w.titan;
    const max = Math.max(1, Math.round(T.stats ? T.stats.dashCharges : 1));
    if (this.pips.length !== max) {
      clearEl(this.pipsBox);
      this.pips = [];
      for (let i = 0; i < max; i++) {
        const n = div('bt-pip', this.pipsBox);
        const f = div('bt-pip-fill', n);
        this.pips.push({ node: n, fill: new VarSlot(f, '--p', 0.01), full: new ClassSlot(n, 'full') });
      }
    }
    const have = Math.max(0, Math.min(max, Math.floor(T.dashCharges + 1e-6)));
    // titansim: dashRecharge counts UP toward DASH_RECHARGE_S (3 s) × max(0.35, dashCooldown)
    const total = 3 * Math.max(0.35, T.stats ? T.stats.dashCooldown : 1);
    const re = Math.max(0, T.dashRecharge || 0);
    const partial = Math.max(0, Math.min(1, re / total));
    for (let i = 0; i < max; i++) {
      const p = this.pips[i];
      if (i < have) { p.full.set(true); p.fill.set(1); }
      else if (i === have) { p.full.set(false); p.fill.set(re > 0 ? partial : 0); }
      else { p.full.set(false); p.fill.set(0); }
    }
  }

  private kitKind = '';

  private updateKitRow(w: World): void {
    const T = w.titan, K = T.kit || {};
    let kind = '', frac = 0, val = '';
    if (w.titanId === 'hearthback' && (K.cap || 0) > 0) {
      kind = 'shell'; frac = (K.stored || 0) / K.cap; val = `${Math.floor(Math.max(0, Math.min(1, frac)) * 100)}%`;
    } else if (w.titanId === 'voltkite') {
      const n = Math.max(0, Math.round(K.wires || 0));
      kind = 'wires'; frac = n / WIRE_CAP; val = `${n}/${WIRE_CAP}`;
    } else if (w.titanId === 'briarwick') {
      const cap = Math.max(1, Math.round(T.stats ? T.stats.turretCap : 4));
      const n = Math.max(0, Math.round(K.turrets || 0));
      kind = 'blooms'; frac = n / cap; val = `${n}/${cap}`;
    }
    this.shellOn.set(kind !== '');
    if (!kind) return;
    if (kind !== this.kitKind) {
      this.kitKind = kind;
      this.shellLbl.set(kind === 'shell' ? STR.hud.shell : kind === 'wires' ? STR.hud.wires : STR.hud.blooms);
      this.shellRow.dataset.kit = kind;
    }
    this.shellFill.set(Math.max(0, Math.min(1, frac)));
    this.shellVal.set(val);
  }

  private updateChips(w: World): void {
    const U = w.upgrades;
    let sig = '';
    for (const id of U.order) sig += id + ':' + (U.owned[id] || 0) + '|';
    if (sig === this.chipSig) return;
    const prev = this.chipSig;
    this.chipSig = sig;
    clearEl(this.chipsList);
    const ids = U.order.filter((id, i) => U.order.indexOf(id) === i);
    this.chipsWrap.classList.toggle('bt-hidden', ids.length === 0);
    const shown = ids.slice(-MAX_CHIPS);
    if (ids.length > shown.length) div('bt-chip bt-chip-more', this.chipsList, `+${ids.length - shown.length}`);
    for (const id of shown) {
      const def = UPGRADE_BY_ID[id];
      const name = def ? def.name : id;
      const chip = div(`bt-chip r-${def ? def.rarity : 'common'}`, this.chipsList);
      chip.appendChild(el('span', 'bt-chip-ab', abbrev(name)));
      chip.appendChild(el('span', 'bt-chip-nm', name.toUpperCase()));
      const st = U.owned[id] || 1;
      chip.appendChild(el('span', 'bt-chip-st', st > 1 ? `×${st}` : ''));
      if (prev !== '#' && !prev.includes(id + ':' + st + '|')) {
        pulse(chip, [{ transform: 'translateX(40%)', opacity: 0 }, { transform: 'translateX(-6%)', opacity: 1 }, { transform: 'translateX(0)' }], 420);
      }
    }
  }

  // ── ticker: JS crawl (one transform write per frame), items appended/recycled as they scroll

  private resetTicker(): void {
    clearEl(this.tkStrip);
    this.tkItems = [];
    this.tkOffset = 0;
    this.tkWidth = 0;
    this.tkDeck = [];
  }

  private remeasureTicker(): void {
    let sum = 0;
    for (const it of this.tkItems) { it.w = it.node.offsetWidth; sum += it.w; }
    this.tkWidth = sum;
  }

  private pushWire(text: string): void {
    if (this.tkLive.length < 6) this.tkLive.push(text);
  }

  private nextHeadline(): { text: string; live: boolean } {
    if (this.tkLive.length) return { text: this.tkLive.shift() as string, live: true };
    if (!this.tkDeck.length) {
      this.tkDeck = TICKER.slice();
      for (let i = this.tkDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = this.tkDeck[i]; this.tkDeck[i] = this.tkDeck[j]; this.tkDeck[j] = t;
      }
    }
    return { text: this.tkDeck.pop() as string, live: false };
  }

  private appendTickerItem(): void {
    const { text, live } = this.nextHeadline();
    const n = el('span', live ? 'bt-tk-item live' : 'bt-tk-item');
    n.appendChild(el('i', 'bt-tk-sep', '◆'));
    if (live) n.appendChild(el('b', 'bt-tk-live', STR.hud.tickerLive));
    n.appendChild(document.createTextNode(text));
    this.tkStrip.appendChild(n);
    const w = n.offsetWidth;
    this.tkItems.push({ node: n, w });
    this.tkWidth += w;
  }

  private stepTicker(dt: number): void {
    if (this.tkWinW <= 0) this.tkWinW = this.tkWin.clientWidth || window.innerWidth;   // cached; reset on resize
    const winW = this.tkWinW;
    let guard = 0;
    while (this.tkOffset + this.tkWidth < winW * 1.4 && guard++ < 12) this.appendTickerItem();
    this.tkOffset -= this.u * 5.5 * dt;
    // recycle items that have fully left the window
    while (this.tkItems.length && this.tkOffset + this.tkItems[0].w < 0) {
      const it = this.tkItems.shift() as TickerItem;
      this.tkOffset += it.w;
      this.tkWidth -= it.w;
      it.node.remove();
    }
    this.tkStrip.style.transform = `translate3d(${this.tkOffset.toFixed(1)}px,0,0)`;
  }
}

/** "Rebar Molars" → "RM"; single word → first two letters. */
function abbrev(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 \-]/g, '').split(/[\s\-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || '?').slice(0, 2).toUpperCase();
}
