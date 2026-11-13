// BLOCKTOOTH — in-play HUD (CONTRACT.md §12). ui lane.
// A local-TV broadcast package first, a game HUD second:
//   top-left   WARD-7 • LIVE bug (pulsing red dot) + broadcast clock + run timer
//   top-right  TONNAGE / BLOCKS / CRUSHED counters (v2: the objective tracker sits below, ui/tracker.ts)
//   bottom-left cream status card: titan, HP (+damage trail, shield), LV, big roman SIZE +
//              GROW bar (sizeProgress: levels to the next Size), XP bar, dash pips
//   v2 (FEATURES_V2 §4.1, lane L8): the upgrade chips column is retired in play (the ability bar +
//              pause LOADOUT show the cards); the hook dial and the kit meter (SHELL / WIRES / BLOOMS)
//              moved to the ACTIVE panel (ui/abilitybar.ts); the zoom hint moved up to 9.2u (hud_v2.css)
//   bottom     WARD-7 WIRE ticker crawl (live items injected on big moments)
//   overlay    low-HP vignette pulse, hurt edge flash, pickup / level flashes
// update() is change-only: every DOM write goes through TextSlot / VarSlot / ClassSlot.
//
// GATEKEEPERS §6.6 / §4.1 (lane K2b): while sizeLocked(w) the GROW row is overlaid by the LOCK strip — a
// hazard-stripe fill (crawling by transform only), a padlock and `SIZE LOCKED — <NAME> EN ROUTE` (pending)
// / `SIZE LOCKED — BEAT <NAME>` (the fight is alive) / `SIZE LOCKED — <BOSS> EN ROUTE · 0:nn` (the city
// boss waits for GATES.mainEarliestS; one text write per second). The "n/m LV → SIZE" value is hidden, the
// SIZE box wears a padlock chip, and a held level-up pulses the padlock instead of the notches. The strip
// is keyed by (pending, active, countdown second): its text is written only when that key changes. Wire
// lines on gateSpawn / gateDefeated (§6.7), next to bossSpawn's.

import type { GateId, SimEvent, World } from '../core/types.ts';
import { GATE_OF_SLOT } from '../core/types.ts';
import { hpReadout } from '../data/strings_hud.ts';
import { GATES, RANK_LEVELS, sizeProgress } from '../core/config.ts';
import { TITANS } from '../data/titans.ts';
import { BOSSES } from '../data/bosses.ts';
import { BIOMES } from '../data/biomes.ts';
import { STR, TICKER, RANK_SUBS } from '../data/strings.ts';
import { STR_GATE, gateName } from '../data/strings_gate.ts';
import { sizeLocked } from '../meta/gates.ts';
import { glyphSvg } from './icons.ts';
import {
  ClassSlot, TextSlot, VarSlot, clearEl, div, el, fmt, fmtClock, fmtInt, fmtTime, flashesReduced,
  keyChip, pulse, roman,
} from './dom.ts';

const LOW_HP = 0.3;
const TRAIL_HOLD_S = 0.4;
const TRAIL_RATE = 0.9;          // fraction of max HP per second the trail drains
const ZOOM_HINT_BRIGHT_S = 20;   // the zoom key hint is at full strength for this long into a run

/** GROW-bar lock styles (lane K2b owns no stylesheet: injected once; only .locked / .bt-gl* selectors). The
 *  stripes are -45 deg bands with a 1.28u perpendicular period, so a 1.28u x sqrt2 = 1.8102u horizontal
 *  period: a translateX of exactly that loops seamlessly (compositor-only). */
const LOCK_CSS = `
.bt-bar-mass { position: relative; }
.bt-gl { display: none; }
.bt-bar-mass.locked { min-height: calc(var(--u) * 1.75); }
.bt-bar-mass.locked > :not(.bt-gl) { visibility: hidden; }
.bt-bar-mass.locked .bt-gl {
  display: flex; align-items: center; position: absolute; left: 0; right: 0; top: 0; bottom: 0; overflow: hidden; z-index: 5;
  background: #1b1426; border: calc(var(--u) * .13) solid #1b1426;
}
.bt-gl-stripes {
  position: absolute; top: 0; bottom: 0; left: 0; width: calc(100% + var(--u) * 1.8102);
  background: repeating-linear-gradient(-45deg, #ffc21a 0 calc(var(--u) * .64), #1b1426 calc(var(--u) * .64) calc(var(--u) * 1.28));
  animation: bt-gl-crawl 1.2s linear infinite; will-change: transform;
}
@keyframes bt-gl-crawl { to { transform: translateX(calc(var(--u) * -1.8102)); } }
.bt-gl-lock {
  position: relative; flex: 0 0 auto; align-self: stretch; display: flex; align-items: center; justify-content: center;
  width: calc(var(--u) * 1.6); background: #ffc21a; border-right: calc(var(--u) * .13) solid #1b1426;
}
.bt-gl-lock svg { width: calc(var(--u) * 1.3); height: calc(var(--u) * 1.3); }
.bt-gl-t {
  position: relative; flex: 0 1 auto; min-width: 0; margin-left: calc(var(--u) * .3);
  font-family: var(--f-display); font-size: calc(var(--u) * .86); line-height: 1.2; letter-spacing: .03em;
  color: #1b1426; background: #ffc21a; padding: 0 calc(var(--u) * .4); border: calc(var(--u) * .1) solid #1b1426;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bt-gl-t.long { font-size: calc(var(--u) * .76); letter-spacing: .02em; }
.bt-gl-t.xlong { font-size: calc(var(--u) * .68); letter-spacing: .01em; }
.bt-size { position: relative; }
.bt-size-lock { display: none; }
.bt-size.locked .bt-size-lock {
  display: flex; align-items: center; gap: calc(var(--u) * .15); position: absolute; left: 50%; bottom: calc(var(--u) * -.72);
  transform: translateX(-50%); padding: calc(var(--u) * .08) calc(var(--u) * .3); background: #ffc21a; color: #1b1426;
  border: calc(var(--u) * .12) solid #1b1426; font-weight: 800; font-size: calc(var(--u) * .56); letter-spacing: .14em; white-space: nowrap;
}
.bt-size-lock svg { width: calc(var(--u) * .8); height: calc(var(--u) * .8); }
@media (prefers-reduced-motion: reduce) { .bt-gl-stripes { animation: none; } }
`;
let lockCssDone = false;
function ensureLockCss(): void {
  if (lockCssDone || typeof document === 'undefined') return;
  lockCssDone = true;
  const st = document.createElement('style');
  st.dataset.bt = 'gate-hud';
  st.textContent = LOCK_CSS;
  document.head.appendChild(st);
}
/** a lock label longer than these drops to the .long / .xlong size (the ~16u GROW row at 1280 × 720:
 *  `SIZE LOCKED — SWITCHBOARD-5 EN ROUTE` 36 chars, `SIZE LOCKED — IRON GULLY EN ROUTE · 16:35` 41: the
 *  longest countdown is GATES.mainEarliestS, 995 s in the 20-minute run; any two-digit-minute label is .xlong) */
const LOCK_LONG_CHARS = 32;
const LOCK_XLONG_CHARS = 37;

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
  private readonly cardLow: ClassSlot;
  private readonly pipsBox: HTMLElement;
  private pips: { node: HTMLElement; fill: VarSlot; full: ClassSlot }[] = [];
  private readonly lvFlash: HTMLElement;
  private readonly lowHpOn: ClassSlot;
  private readonly vignette: HTMLElement;
  private readonly hurtFlash: HTMLElement;
  // GATEKEEPERS: the GROW-bar lock strip + the SIZE-box padlock chip
  private readonly lockBox: HTMLElement;
  private readonly lockIcon: HTMLElement;
  private readonly lockT: TextSlot;
  private readonly lockLong: ClassSlot;
  private readonly lockXLong: ClassSlot;
  private readonly lockOn: ClassSlot;
  private readonly sizeLockOn: ClassSlot;
  private lockKey = -1;

  // derived state
  private trail = 1;
  private trailHold = 0;
  private lastHpFrac = 1;
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
    const chip = div('bt-size-lock', this.sizeBox);
    chip.insertAdjacentHTML('beforeend', glyphSvg('lock', '#1b1426', 12));
    chip.appendChild(el('span', '', STR_GATE.grow.chip));
    this.sizeLockOn = new ClassSlot(this.sizeBox, 'locked');

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
    ensureLockCss();
    const gl = this.lockBox = div('bt-gl', this.massBar);
    gl.dataset.gate = 'grow-lock';
    div('bt-gl-stripes', gl);
    this.lockIcon = div('bt-gl-lock', gl);
    this.lockIcon.innerHTML = glyphSvg('lock', '#1b1426', 16);   // an ink padlock on hazard yellow (small-size legible)
    this.lockT = new TextSlot(div('bt-gl-t', gl));
    this.lockLong = new ClassSlot(this.lockT.node, 'long');
    this.lockXLong = new ClassSlot(this.lockT.node, 'xlong');
    this.lockOn = new ClassSlot(this.massBar, 'locked');
    const xp = bar('bt-bar-xp', STR.hud.xp);
    this.xpBar = xp.row;
    this.xpFill = new VarSlot(div('bt-bar-fill', xp.track), '--p');
    xp.val.remove();
    this.cardLow = new ClassSlot(card, 'lowhp');

    const foot = div('bt-status-foot', card);
    // label line carries the key chip ("DASH [SHIFT]" over the pips); the hook moved to the v2
    // ACTIVE panel (ui/abilitybar.ts)
    const dash = div('bt-dash', foot);
    const dl = div('bt-foot-line', dash);
    div('bt-foot-lbl', dl, STR.hud.dash);
    dl.appendChild(keyChip(STR.hud.keyDash));
    this.pipsBox = div('bt-pips', dash);

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

  /** ONLINE VS (B-VIEW): the followed seat changed (spectate / follow the killer): re-read the titan card on the next update */
  rebind(): void { this.world = null; }

  // ─────────────────────────────── per frame ───────────────────────────────

  update(w: World, dt: number): void {
    if (w !== this.world) this.bind(w);
    if (!this.shown) return;
    const T = w.titan;
    const d = Math.min(0.1, Math.max(0, dt || 0));

    // bug (VS: the run timer is the MATCH clock; the counters are the VIEW seat's own credited slice)
    const vs = w.mode === 'vs' && !!w.vs;
    const R = vs ? w.pl.run : w.run;
    this.clock.set(fmtClock((STR.clockStart[w.biomeId] ?? 14 * 60) + w.t / 60));
    this.runT.set(STR.hud.runPrefix + fmtTime(vs ? Math.max(0, w.t - w.vs!.startT) : w.t));

    // counters
    const tons = Math.max(0, R.tonnage);
    if (Math.abs(tons - this.tonsShown) < 0.5) this.tonsShown = tons;
    else this.tonsShown += (tons - this.tonsShown) * Math.min(1, d * 7);
    this.tonsVal.set(fmtInt(this.tonsShown));
    if (R.blocksLeveled !== this.lastBlocks) {
      if (this.lastBlocks >= 0 && R.blocksLeveled > this.lastBlocks) {
        pulse(this.blocksBox, [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], 380);
        this.pushWire(fmt(STR.hud.wire.block, { n: R.blocksLeveled }));
      }
      this.lastBlocks = R.blocksLeveled;
      this.blocksVal.set(fmtInt(R.blocksLeveled));
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
    this.hpVal.set(hpReadout(T.hp, T.maxHp));
    this.lowHpOn.set(T.alive && hpF < LOW_HP);
    this.cardLow.set(T.alive && hpF < LOW_HP);

    // SIZE progress by level: XP toward the level that breaches the next Size (GATEKEEPERS: the lock strip
    // replaces it while a Size gate is pending or its fight is alive)
    const locked = this.updateLock(w);
    if (locked) {
      this.massFill.set(1);
    } else if (T.rank < 4) {
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

    // dash pips
    this.updatePips(w);

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
          // GATEKEEPERS §6.6: a held level-up (the Size is locked) pulses the padlock, not the notches
          if (sizeLocked(w)) pulse(this.lockIcon, [
            { transform: 'scale(1.55) rotate(-14deg)', background: '#e63946' },
            { transform: 'scale(.92) rotate(8deg)', offset: 0.45 },
            { transform: 'scale(1) rotate(0deg)' },
          ], 560);
          else pulse(this.massBar, [{ filter: 'brightness(1.6) saturate(1.3)', transform: 'scaleY(1.25)' }, { filter: 'none', transform: 'none' }], 520);
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
        // ── GATEKEEPERS §6.7: wire lines (the GROW-bar lock itself re-keys in update()) ──
        case 'gateSpawn': {
          const name = gateName(e.gate);
          this.pushWire(e.rematch
            ? fmt(STR_GATE.wire.rematchSpawn, { name, n: roman(w.titan.rank) })
            : fmt(STR_GATE.wire.spawn, { name, n: roman(Math.max(0, e.slot - 1)) }));
          break;
        }
        case 'gateDefeated':
          this.pushWire(e.rematch
            ? fmt(STR_GATE.wire.rematchDefeated, { name: gateName(e.gate) })
            : fmt(STR_GATE.wire.defeated, { n: roman(e.slot) }));
          break;
        case 'gateEscalate':
          this.pushWire(STR_GATE.wire.escalate);
          break;
        // REPAIR CREWS (city/citysim.ts rebuild): the first crew of the run, then every 8th building topped out
        case 'rebuild':
          if (e.stage === 'start' && e.n === 1) this.pushWire(STR.hud.wire.crews);
          else if (e.stage === 'done' && e.n > 0 && e.n % 8 === 0) {
            const L = STR.hud.wire.rebuilt;
            this.pushWire(fmt(L[Math.floor(e.n / 8 - 1) % L.length], { n: e.n }));
          }
          break;
        default:
          break;
      }
    }
  }

  // ─────────────────────────────── internals ───────────────────────────────

  /** The name on the lock strip for slot s: the gatekeeper (1..3) or this city's boss (4). */
  private slotName(w: World, s: number): string {
    if (s >= 1 && s <= 3) return gateName(GATE_OF_SLOT[s] as GateId);
    const b = w.boss;
    if (b && b.alive && b.role === 'main' && BOSSES[b.id]) return BOSSES[b.id].name;
    const id = BIOMES[w.biomeId]?.boss;
    return id && BOSSES[id] ? BOSSES[id].name : '';
  }

  /** GROW-bar lock (§6.6): returns sizeLocked(w). Re-keys on (pending, active, countdown second) and writes
   *  the strip only when the key changes (so the countdown is one text write per second). */
  private updateLock(w: World): boolean {
    const G = w.gates;
    const locked = !!G && sizeLocked(w);
    let secs = 0;
    // the city boss's floor wait (§4.1): a whole-second countdown while its dueT sits past the summon delay
    if (locked && G.pending === 4 && G.active === 0 && Number.isFinite(G.dueT) && G.dueT > G.lockT + GATES.summonDelayS + 0.01
        && G.dueT > w.t) {
      secs = Math.max(1, Math.ceil(G.dueT - w.t - 1e-6));
    }
    const key = locked ? 1 + (G.pending << 1) + (G.active << 4) + (secs << 8) : 0;
    if (key === this.lockKey) return locked;
    this.lockKey = key;
    this.lockOn.set(locked);
    this.sizeLockOn.set(locked);
    if (!locked) return false;
    let txt: string;
    if (G.active > 0) txt = fmt(STR_GATE.grow.beat, { name: this.slotName(w, G.active) });
    else if (secs > 0) txt = fmt(STR_GATE.grow.enRouteT, { name: this.slotName(w, G.pending), t: fmtTime(secs) });
    else txt = fmt(STR_GATE.grow.enRoute, { name: this.slotName(w, G.pending) });
    this.lockT.set(txt);
    this.lockLong.set(txt.length > LOCK_LONG_CHARS && txt.length <= LOCK_XLONG_CHARS);
    this.lockXLong.set(txt.length > LOCK_XLONG_CHARS);
    this.lockBox.dataset.text = txt;
    return true;
  }

  /** New run (or first frame): reset every cache so nothing from the last run leaks. */
  private bind(w: World): void {
    this.world = w;
    const def = TITANS[w.titanId];
    this.nameT.set(def ? def.name : w.titanId.toUpperCase());
    this.roleT.set(def ? def.role : '');
    this.card.style.setProperty('--titan', def ? def.colors.primary : '#3fae7f');
    this.card.style.setProperty('--titan-2', def ? def.colors.secondary : '#1f6f55');
    this.trail = 1; this.trailHold = 0; this.lastHpFrac = 1;
    this.lastRank = -1; this.lastLevel = -1; this.lastBlocks = -1; this.lastCrushed = -1; this.tickSpan = -1;
    this.tonsShown = Math.max(0, (w.mode === 'vs' ? w.pl.run : w.run).tonnage);
    for (const s of [this.clock, this.runT, this.tonsVal, this.blocksVal, this.crushVal, this.lvT, this.sizeT, this.hpVal, this.massVal]) s.reset();
    for (const v of [this.hpFill, this.hpTrail, this.hpShield, this.massFill, this.xpFill]) v.reset();
    for (const c of [this.lowHpOn, this.cardLow, this.zoomDim]) c.reset();
    this.lockKey = -1;
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
