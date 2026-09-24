// BLOCKTOOTH — WARD-7 broadcast package (CONTRACT.md §1, §12). ui lane.
//   openSlate  FREEZE-FRAME over the paused first frame: halftone + scanlines, viewfinder corners,
//              WARD-7 • LIVE bug, big lower third (BREAKING · biome slate · titan sighting line),
//              PRESS ANY KEY — resolves on any key / click / pad button.
//   sizeUp     full-width MASS BREACH banner sweep (~2.2 s, non-blocking) + rank sub-line.
//   alert      WARD-7 ALERT (queued, non-blocking, deduped, urgent keys first): boss / elite /
//              phase keys = a content-sized strap across the upper third; the rest = a compact
//              toast under the bug.
//   tabloid    THE WARD SEVEN WITNESS front page: masthead, date line, THE CITY GOT SMALLER.,
//              the freeze-frame photo, stats (+ NEW RECORD stamps), the record book,
//              RETRY / CHANGE TITAN / TITLE.
//   clear      drop every banner/queue and close an open slate (resolved) or tabloid (abandoned).
// Deferred work is guarded by an epoch (doctrine §4): a timer from a cleared run no-ops.

import type { Input } from '../core/input.ts';
import type { AlertKey, BiomeDef, RankIndex, TitanDef, World } from '../core/types.ts';
import { bestKey, loadBest } from '../core/save.ts';
import { BIOMES } from '../data/biomes.ts';
import { BOSSES } from '../data/bosses.ts';
import { TITANS } from '../data/titans.ts';
import { ALERTS, RANK_SUBS, STR } from '../data/strings.ts';
import {
  type ModalSession, type UiPress, clearEl, div, el, fmt, fmtClock, fmtInt, fmtTime, keyChip, onTap, pickOne,
  pickSeeded, pulse, roman, runModal, wrapIndex, flashesReduced,
} from './dom.ts';
import { buildBug } from './menus.ts';

type TabloidChoice = 'retry' | 'select' | 'title';

const ALERT_MS = 2900;
const TOAST_MS = 3600;          // a toast is small and carries a how-to line: it stays a little longer
const ALERT_GAP_MS = 260;
const SIZEUP_MS = 2300;
const ALERT_QUEUE_MAX = 4;
const URGENT: ReadonlySet<AlertKey> = new Set<AlertKey>(['boss', 'bossPhase2', 'bossPhase3', 'elite']);
const ALERT_TONE: Partial<Record<AlertKey, string>> = {
  boss: 'red', bossPhase2: 'red', bossPhase3: 'red', elite: 'red', lowHp: 'coral', chest: 'teal',
};
const TABLOID_ITEMS: readonly TabloidChoice[] = ['retry', 'select', 'title'];

// ─────────────────────────────── run figures (one generator) ───────────────────────────────

/** The personal-best stats a run files, in `bestKey(titan, biome, <stat>)` terms. */
export const BEST_STATS = ['tonnage', 'blocks', 'kills', 'level', 'peakRank', 'survivedS', 'clearS'] as const;

/**
 * Seconds on air, the ONE rounding rule for every time the paper prints: whole seconds, floored
 * (the broadcast clock never shows a second that has not finished). TIME ON AIR and the record
 * book's LONGEST ON AIR both come from here, so the same run can never read 0:18 and 0:19.
 */
export function onAirSeconds(w: World): number {
  const t = w.run.endT >= 0 ? w.run.endT : w.t;
  return Math.max(0, Math.floor(Number.isFinite(t) ? t : 0));
}

/**
 * This run's record figures — the single source for what the app SAVES (game.ts recordBests)
 * and what the tabloid COMPARES and PRINTS. clearS keeps tenths (a tie-break between clears) but
 * is floored too, so it always prints the same m:ss as TIME ON AIR.
 */
export function runFigures(w: World, result: 'clear' | 'dead'): Record<string, number> {
  const t = w.run.endT >= 0 ? w.run.endT : w.t;
  const out: Record<string, number> = {
    tonnage: Math.round(w.run.tonnage), blocks: w.run.blocksLeveled, kills: w.titan.kills, level: w.titan.level,
    peakRank: w.run.peakRank, survivedS: onAirSeconds(w),
  };
  if (result === 'clear') out.clearS = Math.floor((Number.isFinite(t) ? t : 0) * 10) / 10;
  return out;
}

export class Broadcast {
  private readonly root: HTMLElement;
  private readonly input: Input | null;
  private epoch = 0;

  // slate
  private readonly slate: HTMLDivElement;
  private readonly slPlace: HTMLElement;
  private readonly slClock: HTMLElement;
  private readonly slHead: HTMLElement;
  private readonly slSub: HTMLElement;
  private readonly slChipName: HTMLElement;
  private readonly slChipRole: HTMLElement;
  private readonly slChipSwatch: HTMLElement;
  private readonly slRank: HTMLElement;
  private readonly slTc: HTMLElement;
  private slateSession: ModalSession<void> | null = null;
  private slateTimer = 0;

  // size-up + alerts
  private readonly bannerLayer: HTMLDivElement;
  private readonly sizeBox: HTMLDivElement;
  private readonly suNum: HTMLElement;
  private readonly suSub: HTMLElement;
  private readonly alertBox: HTMLDivElement;
  private readonly alTitle: HTMLElement;
  private readonly alSub: HTMLElement;
  private queue: AlertKey[] = [];
  private showing: AlertKey | null = null;
  private sizeUntil = 0;
  private alertAnim: Animation | null = null;
  private sizeAnim: Animation | null = null;

  // tabloid
  private readonly tab: HTMLDivElement;
  private readonly paper: HTMLDivElement;
  private readonly tabButtons: HTMLButtonElement[] = [];
  private tabSel = 0;
  private tabSession: ModalSession<TabloidChoice> | null = null;
  /** Personal bests as they stood BEFORE the current run: handed over by the app at runEnd
   *  (`priorBests`, read right before it saves this run's figures); cleared with every run. */
  private bestSnap: Record<string, number> | null = null;

  constructor(root: HTMLElement, input?: Input) {
    this.root = root;
    this.input = input ?? null;

    // ── slate (modal freeze-frame) ─────────────────────────────────────────
    const S = this.slate = div('bt-layer bt-screen bt-slate bt-hidden', root);
    S.setAttribute('role', 'dialog');
    div('bt-slate-tint', S);
    div('bt-halftone', S);
    div('bt-scanlines', S);
    div('bt-slate-vig', S);
    const vf = div('bt-viewfinder', S);
    for (const c of ['tl', 'tr', 'bl', 'br']) div(`bt-vf ${c}`, vf);
    buildBug(S);
    const ff = div('bt-slate-freeze', S);
    ff.appendChild(el('span', 'bt-ff-icon'));
    ff.appendChild(el('b', '', STR.slate.freeze));
    ff.appendChild(el('span', 'bt-ff-cam', STR.slate.cam));
    this.slTc = el('span', 'bt-ff-tc', '00:00:00:00');
    ff.appendChild(this.slTc);
    div('bt-slate-footage', S, STR.slate.footage);

    const lt = div('bt-lt', S);
    const ltTop = div('bt-lt-top', lt);
    ltTop.appendChild(el('span', 'bt-lt-breaking', STR.slate.breaking));
    this.slPlace = el('span', 'bt-lt-place');
    ltTop.appendChild(this.slPlace);
    this.slClock = el('span', 'bt-lt-clock');
    ltTop.appendChild(this.slClock);
    const ltMain = div('bt-lt-main', lt);
    div('bt-lt-net', ltMain, STR.network);
    this.slHead = div('bt-lt-head', ltMain);
    const ltSub = div('bt-lt-subrow', lt);
    const chip = div('bt-lt-chip', ltSub);
    this.slChipSwatch = div('bt-lt-swatch', chip);
    const chipTxt = div('bt-lt-chip-txt', chip);
    chipTxt.appendChild(el('small', '', STR.slate.subject));
    this.slChipName = el('b', '');
    chipTxt.appendChild(this.slChipName);
    this.slChipRole = el('span', 'bt-lt-role');
    chipTxt.appendChild(this.slChipRole);
    this.slSub = div('bt-lt-sub', ltSub);
    this.slRank = div('bt-lt-rank', lt);
    const any = div('bt-slate-any', S);
    any.appendChild(el('span', '', STR.slate.any));
    onTap(S, () => this.dismissSlate());

    // ── banners (non-blocking) ─────────────────────────────────────────────
    const B = this.bannerLayer = div('bt-layer bt-banners', root);
    const su = this.sizeBox = div('bt-sizeup', B);
    div('bt-su-stripes', su);
    const suIn = div('bt-su-inner', su);
    const suSize = div('bt-su-size', suIn);
    suSize.appendChild(el('small', '', STR.sizeUp.size));
    this.suNum = el('b', '', 'II');
    suSize.appendChild(this.suNum);
    const suTxt = div('bt-su-txt', suIn);
    div('bt-su-tag', suTxt, STR.sizeUp.tag);
    div('bt-su-title', suTxt, STR.sizeUp.title);
    this.suSub = div('bt-su-sub', su);

    const al = this.alertBox = div('bt-alert', B);
    const alTag = div('bt-alert-tag', al);
    alTag.appendChild(el('span', 'bt-alert-icon', '!'));
    alTag.appendChild(el('span', '', STR.alertTag));
    const alTxt = div('bt-alert-txt', al);
    this.alTitle = div('bt-alert-title', alTxt);
    this.alSub = div('bt-alert-sub', alTxt);
    div('bt-alert-hz l', al);
    div('bt-alert-hz r', al);

    // ── tabloid (modal) ────────────────────────────────────────────────────
    const T = this.tab = div('bt-layer bt-screen bt-tabloid bt-hidden', root);
    T.setAttribute('role', 'dialog');
    T.setAttribute('aria-label', STR.tabloid.masthead);
    div('bt-tab-desk', T);
    this.paper = div('bt-paper', T);
    const acts = div('bt-tab-actions', T);
    const mkBtn = (id: TabloidChoice, label: string, key: string, i: number) => {
      const b = el('button', `bt-tab-btn b-${id}`);
      b.type = 'button';
      b.tabIndex = -1;
      b.appendChild(keyChip(key));
      b.appendChild(el('span', '', label));
      acts.appendChild(b);
      b.addEventListener('mouseenter', () => this.tabSelect(i));
      onTap(b, () => { this.tabSelect(i); this.tabFinish(id); });
      this.tabButtons.push(b);
    };
    mkBtn('retry', STR.tabloid.retry, STR.tabloid.keyRetry, 0);
    mkBtn('select', STR.tabloid.select, STR.tabloid.keySelect, 1);
    mkBtn('title', STR.tabloid.title, STR.tabloid.keyTitle, 2);
    const hint = div('bt-tab-hint', acts);
    hint.appendChild(keyChip('↑ ↓'));
    hint.appendChild(keyChip('ENTER'));
  }

  // ─────────────────────────────── slate ───────────────────────────────

  openSlate(biome: BiomeDef, titan: TitanDef): Promise<void> {
    if (this.slateSession && !this.slateSession.done) this.slateSession.abort();
    const ep = this.epoch;
    const S = this.slate;
    S.dataset.biome = biome.id;
    const copy = STR.slates[biome.id];
    this.slPlace.textContent = copy ? copy.place : biome.name;
    this.slClock.textContent = fmtClock(STR.clockStart[biome.id] ?? 14 * 60);
    this.slHead.textContent = biome.slate || (copy ? copy.headline : biome.name);
    const tpl = copy && copy.subs.length ? pickOne(copy.subs) : '{name}';
    this.slSub.textContent = fmt(tpl, { name: titan.name, species: titan.species.toUpperCase() });
    this.slChipName.textContent = titan.name;
    this.slChipRole.textContent = titan.role;
    this.slChipSwatch.style.background = `linear-gradient(135deg, ${titan.colors.primary} 0 55%, ${titan.colors.secondary} 55% 100%)`;
    this.slRank.textContent = RANK_SUBS[0] ?? '';
    S.style.setProperty('--titan', titan.colors.primary);

    S.classList.remove('bt-hidden');
    const reduced = flashesReduced();
    const lt = S.querySelector('.bt-lt') as HTMLElement;
    pulse(S, [{ opacity: 0 }, { opacity: 1 }], 180);
    if (!reduced) pulse(S.querySelector('.bt-slate-tint') as HTMLElement, [{ opacity: 1, background: '#fff' }, { opacity: 1 }], 260, 'ease-out');
    pulse(lt, [
      { transform: 'translateX(-105%)' },
      { transform: 'translateX(2%)', offset: 0.75 },
      { transform: 'translateX(0)' },
    ], 560, 'cubic-bezier(.2,.9,.2,1)');

    // running timecode (cosmetic)
    const t0 = performance.now();
    window.clearInterval(this.slateTimer);
    this.slateTimer = window.setInterval(() => {
      if (ep !== this.epoch) { window.clearInterval(this.slateTimer); return; }
      const ms = performance.now() - t0;
      const f = Math.floor((ms / 1000) * 30) % 30, s = Math.floor(ms / 1000);
      this.slTc.textContent = `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
    }, 50);

    const { promise, session } = runModal<void>(S, this.input, () => this.dismissSlate(), {
      armMs: 450,
      onClose: () => {
        window.clearInterval(this.slateTimer);
        S.classList.add('bt-hidden');
        this.slateSession = null;
      },
    });
    this.slateSession = session;
    return promise;
  }

  private dismissSlate(): void {
    const s = this.slateSession;
    if (!s || s.done) return;
    const lt = this.slate.querySelector('.bt-lt') as HTMLElement;
    pulse(lt, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-8%)', opacity: 0 }], 200, 'ease-in');
    pulse(this.slate, [{ opacity: 1 }, { opacity: 0 }], 220, 'ease-in');
    s.finish(undefined, 200);
  }

  // ─────────────────────────────── size-up ───────────────────────────────

  sizeUp(rank: RankIndex): void {
    const ep = this.epoch;
    const r = Math.max(0, Math.min(4, rank | 0));
    this.suNum.textContent = roman(r);
    this.suSub.textContent = RANK_SUBS[r] ?? '';
    this.sizeBox.dataset.rank = String(r);
    // a size-up pre-empts a showing alert (it re-queues at the front)
    if (this.showing) {
      this.queue.unshift(this.showing);
      this.showing = null;
      if (this.alertAnim) { this.alertAnim.cancel(); this.alertAnim = null; }
      this.alertBox.classList.remove('on');
    }
    if (this.sizeAnim) this.sizeAnim.cancel();
    this.sizeBox.classList.add('on');
    this.sizeUntil = performance.now() + SIZEUP_MS;
    const reduced = flashesReduced();
    const inner = this.sizeBox.querySelector('.bt-su-inner') as HTMLElement;
    this.sizeAnim = this.sizeBox.animate(reduced
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }]
      : [
        { clipPath: 'inset(0 100% 0 0)', transform: 'skewX(-8deg)' },
        { clipPath: 'inset(0 0% 0 0)', transform: 'skewX(0deg)', offset: 0.11 },
        { clipPath: 'inset(0 0% 0 0)', transform: 'skewX(0deg)', offset: 0.86 },
        { clipPath: 'inset(0 0 0 100%)', transform: 'skewX(8deg)' },
      ], { duration: SIZEUP_MS, easing: 'cubic-bezier(.6,0,.3,1)', fill: 'both' });
    if (!reduced) pulse(inner, [
      { transform: 'scale(1.35)', letterSpacing: '0.2em' },
      { transform: 'scale(0.97)', offset: 0.18 },
      { transform: 'scale(1)' },
    ], 900);
    const anim = this.sizeAnim;
    anim.onfinish = () => {
      if (ep !== this.epoch || this.sizeAnim !== anim) return;
      this.sizeBox.classList.remove('on');
      this.sizeAnim = null;
      this.pumpAlerts();
    };
  }

  // ─────────────────────────────── alerts ───────────────────────────────

  alert(key: AlertKey): void {
    if (!ALERTS[key]) return;
    if (this.showing === key || this.queue.includes(key)) return;
    if (URGENT.has(key)) {
      // an urgent banner jumps the queue; a superseded boss phase alert is dropped
      if (key === 'bossPhase3') this.queue = this.queue.filter((k) => k !== 'bossPhase2');
      this.queue.unshift(key);
    } else this.queue.push(key);
    while (this.queue.length > ALERT_QUEUE_MAX) {
      let drop = -1;
      for (let i = this.queue.length - 1; i >= 0; i--) if (!URGENT.has(this.queue[i])) { drop = i; break; }
      this.queue.splice(drop >= 0 ? drop : this.queue.length - 1, 1);
    }
    this.pumpAlerts();
  }

  private pumpAlerts(): void {
    if (this.showing || !this.queue.length) return;
    if (this.sizeAnim && performance.now() < this.sizeUntil) return;
    const key = this.queue.shift() as AlertKey;
    const a = ALERTS[key];
    const ep = this.epoch;
    this.showing = key;
    this.alTitle.textContent = a.title;
    this.alSub.textContent = a.sub;
    this.alertBox.dataset.tone = ALERT_TONE[key] ?? 'navy';
    // urgent (boss / elite / phase) = content-sized strap across the upper third; the rest = a
    // compact toast under the bug. Both are content-sized, so no empty slab ever crosses the
    // screen: the strap wipes in from the left and collapses to its centre line on exit.
    const urgent = URGENT.has(key);
    this.alertBox.classList.toggle('urgent', urgent);
    this.alertBox.classList.toggle('toast', !urgent);
    this.alertBox.classList.add('on');
    const reduced = flashesReduced();
    const frames: Keyframe[] = reduced
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }]
      : urgent
        ? [
          { clipPath: 'inset(0 100% 0 0)', transform: 'translateX(-3%)', opacity: 1 },
          { clipPath: 'inset(0 0% 0 0)', transform: 'translateX(0.6%)', opacity: 1, offset: 0.09 },
          { clipPath: 'inset(0 0% 0 0)', transform: 'translateX(0)', opacity: 1, offset: 0.13 },
          { clipPath: 'inset(0 0% 0 0)', transform: 'scaleY(1)', opacity: 1, offset: 0.9 },
          { clipPath: 'inset(50% 0% 50% 0)', transform: 'scaleY(0.2)', opacity: 0.6 },
        ]
        : [
          { opacity: 0, transform: 'translateY(-35%)', clipPath: 'inset(0 100% 0 0)' },
          { opacity: 1, transform: 'translateY(0)', clipPath: 'inset(0 0% 0 0)', offset: 0.07 },
          { opacity: 1, transform: 'translateY(0)', clipPath: 'inset(0 0% 0 0)', offset: 0.9 },
          { opacity: 0, transform: 'translateY(-20%)', clipPath: 'inset(0 0% 0 0)' },
        ];
    const anim = this.alertBox.animate(frames, {
      duration: urgent ? ALERT_MS : TOAST_MS, easing: 'cubic-bezier(.55,0,.35,1)', fill: 'both',
    });
    this.alertAnim = anim;
    anim.onfinish = () => {
      if (ep !== this.epoch || this.alertAnim !== anim) return;
      this.alertBox.classList.remove('on');
      anim.cancel();              // drop the fill: a finished toast must not leave opacity 0 under the next banner
      this.alertAnim = null;
      this.showing = null;
      setTimeout(() => { if (ep === this.epoch) this.pumpAlerts(); }, ALERT_GAP_MS);
    };
  }

  // ─────────────────────────────── tabloid ───────────────────────────────

  tabloid(w: World, photo: string): Promise<TabloidChoice> {
    if (this.tabSession && !this.tabSession.done) this.tabSession.abort();
    this.clearBanners();
    this.buildPaper(w, photo);
    this.tab.classList.remove('bt-hidden');
    this.tabSelect(0);
    const reduced = flashesReduced();
    pulse(this.paper, reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
        { transform: 'translate(-50%, -50%) rotate(-700deg) scale(.06)', opacity: 0 },
        { transform: 'translate(-50%, -50%) rotate(-10deg) scale(1.06)', opacity: 1, offset: 0.78 },
        { transform: 'translate(-50%, -50%) rotate(-1.4deg) scale(1)', opacity: 1 },
      ], reduced ? 250 : 950, 'cubic-bezier(.2,.7,.2,1)');
    const acts = this.tab.querySelector('.bt-tab-actions') as HTMLElement;
    pulse(acts, [{ opacity: 0, transform: 'translateX(30%)' }, { opacity: 0, transform: 'translateX(30%)', offset: 0.6 }, { opacity: 1, transform: 'none' }], reduced ? 300 : 1300);

    const { promise, session } = runModal<TabloidChoice>(this.tab, this.input, (p) => this.tabPress(p), {
      armMs: reduced ? 400 : 1000,
      onClose: () => { this.tab.classList.add('bt-hidden'); this.tabSession = null; },
    });
    this.tabSession = session;
    return promise;
  }

  private tabPress(p: UiPress): void {
    if (p.act === 'reroll' || p.key === 'r') { this.tabSelect(0); this.tabFinish('retry'); return; }
    if (p.key === 'c') { this.tabSelect(1); this.tabFinish('select'); return; }
    if (p.key === 't') { this.tabSelect(2); this.tabFinish('title'); return; }
    switch (p.act) {
      case 'up': case 'left': this.tabSelect(wrapIndex(this.tabSel - 1, 3)); break;
      case 'down': case 'right': this.tabSelect(wrapIndex(this.tabSel + 1, 3)); break;
      case 'confirm': this.tabFinish(TABLOID_ITEMS[this.tabSel]); break;
      case 'pick1': this.tabSelect(0); this.tabFinish('retry'); break;
      case 'pick2': this.tabSelect(1); this.tabFinish('select'); break;
      case 'pick3': this.tabSelect(2); this.tabFinish('title'); break;
      default: break;
    }
  }

  private tabSelect(i: number): void {
    this.tabSel = i;
    this.tabButtons.forEach((b, j) => b.classList.toggle('is-sel', j === i));
  }

  private tabFinish(v: TabloidChoice): void {
    const s = this.tabSession;
    if (!s || s.done) return;
    const b = this.tabButtons[TABLOID_ITEMS.indexOf(v)];
    if (b) pulse(b, [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], 160);
    s.finish(v, 140);
  }

  private buildPaper(w: World, photo: string): void {
    const P = this.paper;
    clearEl(P);
    const T = w.titan;
    const def = TITANS[w.titanId];
    const name = def ? def.name : w.titanId.toUpperCase();
    const result = w.run.result === 'clear' ? 'clear' : 'dead';
    P.dataset.result = result;
    const seed = (w.seed >>> 0) + w.tick;
    const endT = onAirSeconds(w);
    const boss = w.boss;
    const bossName = boss ? (BOSSES[boss.id]?.name ?? boss.id.toUpperCase()) : (BOSSES[w.biomeId === 'whitestacks' ? 'irongully' : 'caisson4']?.name ?? '');
    const vars = {
      name, boss: bossName, time: fmtTime(endT), tons: fmtInt(w.run.tonnage), blocks: fmtInt(w.run.blocksLeveled),
      size: roman(w.run.peakRank),
    };

    // ears + masthead
    const top = div('bt-np-top', P);
    const earL = div('bt-np-ear l', top);
    earL.appendChild(el('b', 'bt-np-extra', STR.tabloid.extra));
    earL.appendChild(el('span', '', STR.tabloid.edition));
    div('bt-np-mast', top, STR.tabloid.masthead);
    const earR = div('bt-np-ear r', top);
    earR.appendChild(el('b', '', STR.tabloid.price));
    earR.appendChild(el('span', '', pickSeeded(STR.tabloid.weather, seed)));
    div('bt-np-motto', P, STR.tabloid.motto);

    const dl = div('bt-np-dateline', P);
    dl.appendChild(el('span', '', fmt(STR.tabloid.vol, { n: 100 + (seed % 900) })));
    dl.appendChild(el('span', '', dateLine()));
    dl.appendChild(el('span', '', STR.tabloid.onlyPaper));

    div('bt-np-headline', P, STR.tabloid.headline);
    div('bt-np-subhead', P, pickSeeded(result === 'clear' ? STR.tabloid.subClear : STR.tabloid.subDead, seed));

    const grid = div('bt-np-grid', P);
    // photo
    const fig = el('figure', 'bt-np-photo');
    grid.appendChild(fig);
    const frame = div('bt-np-frame', fig);
    if (photo) {
      const img = el('img', 'bt-np-img');
      img.alt = fmt(STR.tabloid.caption, vars);
      img.src = photo;
      img.decoding = 'async';
      frame.appendChild(img);
    } else {
      frame.classList.add('empty');
      div('bt-np-nophoto', frame, STR.tabloid.noPhoto);
    }
    div('bt-np-dots', frame);
    div(`bt-np-stamp ${result}`, frame, result === 'clear' ? STR.tabloid.stampClear : STR.tabloid.stampDead);
    const cap = el('figcaption', 'bt-np-caption', fmt(STR.tabloid.caption, vars));
    fig.appendChild(cap);

    // by the numbers
    const nums = div('bt-np-numbers', grid);
    div('bt-np-numbers-title', nums, STR.tabloid.numbersTitle);
    const L = STR.tabloid.stats;
    let bossLine: string = STR.tabloid.bossAbsent;
    if (boss) {
      const pct = boss.maxHp > 0 ? Math.max(0, Math.ceil((boss.hp / boss.maxHp) * 100)) : 0;
      bossLine = !boss.alive || boss.hp <= 0 ? fmt(STR.tabloid.bossBeaten, { boss: bossName }) : fmt(STR.tabloid.bossStanding, { boss: bossName, pct });
    }
    const rec = this.records(w, result);
    const rows: [string, string, string][] = [
      [L.time, fmtTime(endT), result === 'clear' ? 'clearS' : 'survivedS'],
      [L.size, `${STR.sizeUp.size} ${roman(w.run.peakRank)}`, 'peakRank'],
      [L.level, String(T.level), 'level'],
      [L.tonnage, `${fmtInt(w.run.tonnage)} T`, 'tonnage'],
      [L.floors, fmtInt(T.floorsEaten), ''],
      [L.buildings, fmtInt(T.buildingsLeveled), ''],
      [L.blocks, fmtInt(w.run.blocksLeveled), 'blocks'],
      [L.crushed, fmtInt(T.crushed), ''],
      [L.kills, fmtInt(T.kills), 'kills'],
    ];
    const tbl = div('bt-np-stats', nums);
    for (const [k, v, key] of rows) {
      const r = div('bt-np-stat', tbl);
      r.appendChild(el('span', 'k', k));
      if (key && rec.fell.has(key)) r.appendChild(el('span', 'bt-np-new', STR.tabloid.record.newTag));
      r.appendChild(el('span', 'dots'));
      r.appendChild(el('span', 'v', v));
    }

    // record book: the bests on file for this titan + zone, this run's broken ones stamped
    const book = div('bt-np-record', nums);
    const bh = div('bt-np-record-head', book);
    bh.appendChild(el('b', '', STR.tabloid.record.title));
    bh.appendChild(el('span', '', fmt(STR.tabloid.record.sub, { name, biome: BIOMES[w.biomeId]?.name ?? w.biomeId.toUpperCase() })));
    const RR = STR.tabloid.record.rows;
    const timeKey = result === 'clear' || rec.now.clearS !== undefined ? 'clearS' : 'survivedS';
    const bookRows: [string, string][] = [
      ['tonnage', RR.tonnage], ['blocks', RR.blocks], ['peakRank', RR.peakRank], ['kills', RR.kills],
      [timeKey, timeKey === 'clearS' ? RR.clearS : RR.survivedS],
    ];
    for (const [key, label] of bookRows) {
      const r = div('bt-np-record-row', book);
      r.appendChild(el('span', 'k', label));
      r.appendChild(el('span', 'dots'));
      const val = rec.now[key];
      r.appendChild(el('span', 'v', val === undefined ? STR.tabloid.record.none : fmtRecord(key, val)));
      if (rec.fell.has(key)) { r.classList.add('fell'); r.appendChild(el('span', 'bt-np-new sm', STR.tabloid.record.newShort)); }
    }
    div('bt-np-record-note', book, rec.first ? STR.tabloid.record.first
      : rec.fell.size === 0 ? STR.tabloid.record.held
        : rec.fell.size === 1 ? STR.tabloid.record.fellOne : fmt(STR.tabloid.record.fell, { n: rec.fell.size }));
    const bl = div(`bt-np-boss ${boss && (!boss.alive || boss.hp <= 0) ? 'beaten' : ''}`, nums);
    bl.appendChild(el('small', '', L.boss));
    bl.appendChild(el('b', '', bossLine));

    // story column
    const story = div('bt-np-story', grid);
    div('bt-np-byline', story, STR.tabloid.byline);
    const body = result === 'clear' ? STR.tabloid.bodyClear : STR.tabloid.bodyDead;
    const blocksN = w.run.blocksLeveled, tonsN = Math.round(w.run.tonnage);
    const alt = STR.tabloid.bodyAlt;
    body.forEach((p, i) => {
      // a figure that would read wrong ("0 blocks can be listed as a view") swaps its whole line
      let tpl: string = p;
      if (tpl.includes('{blocks}') && blocksN <= 1) tpl = blocksN === 1 ? alt.blocks1 : alt.blocks0;
      else if (tpl.includes('{tons}') && tonsN < 1) tpl = alt.tons0;
      const para = el('p', i === 0 ? 'lead' : '', fmt(tpl, vars));
      story.appendChild(para);
    });

    const quote = pickSeeded(STR.tabloid.quotes, seed >>> 3);
    const pq = div('bt-np-quote', story);
    pq.appendChild(el('b', '', `“${quote.q}”`));
    pq.appendChild(el('small', '', `— ${quote.who}`));
    const inside = div('bt-np-inside', story);
    inside.appendChild(el('b', '', STR.tabloid.insideTitle));
    for (const line of STR.tabloid.inside) inside.appendChild(el('span', '', line));

    const side = div('bt-np-side', P);
    for (const s of STR.tabloid.sidebar) side.appendChild(el('span', '', s));
  }

  /**
   * This run's figures against the bests on file before it. Mirrors App.recordBests (game.ts):
   * higher wins, except clearS (lower wins, clears only). `now` = the record after this run.
   */
  private records(w: World, result: 'clear' | 'dead'): { now: Record<string, number>; fell: Set<string>; first: boolean } {
    const t = w.titanId, b = w.biomeId;
    // without the app's hand-over (a harness calling tabloid() directly) the stored bests already
    // include this run: print them, but no record can be called broken
    const known = this.bestSnap !== null;
    const prev = this.bestSnap ?? loadBest();
    const run = runFigures(w, result);
    const now: Record<string, number> = {};
    const fell = new Set<string>();
    let any = false;
    for (const k of BEST_STATS) {
      const p = prev[bestKey(t, b, k)];
      const v = run[k];
      if (p !== undefined) any = true;
      if (v === undefined || !Number.isFinite(v)) { if (p !== undefined) now[k] = p; continue; }
      const lower = k === 'clearS';
      const better = p === undefined || (lower ? v < p : v > p);
      now[k] = better ? v : p;
      // stamp only when a record that EXISTED fell (the first broadcast sets records, it breaks none);
      // a clear is timed by clearS, so its survivedS is kept but never stamped (it is not on the page)
      if (known && p !== undefined && better && (lower || v > 0) && !(result === 'clear' && k === 'survivedS')) fell.add(k);
    }
    return { now, fell, first: known && !any };
  }

  // ─────────────────────────────── clear / dismiss ───────────────────────────────

  /**
   * The app hands over the personal bests as they stood BEFORE this run (read at runEnd right
   * before it files the run's figures), so the tabloid can stamp exactly the records that fell.
   * Not a CONTRACT §12 export — an app ↔ broadcast hand-off inside the ui/app lanes.
   */
  priorBests(prev: Record<string, number>): void {
    this.bestSnap = { ...prev };
  }

  /** Drop banners + queue; close an open slate (resolved) and an open tabloid (abandoned). */
  clear(): void {
    this.epoch++;
    this.bestSnap = null;
    this.clearBanners();
    window.clearInterval(this.slateTimer);
    if (this.slateSession && !this.slateSession.done) this.slateSession.finish(undefined, 0);
    if (this.tabSession && !this.tabSession.done) this.tabSession.abort();
  }

  /** Harness convenience (not a contract export): dismiss an open slate / tabloid ('retry'). */
  dismiss(): boolean {
    if (this.slateSession && !this.slateSession.done) { this.dismissSlate(); return true; }
    if (this.tabSession && !this.tabSession.done) { this.tabFinish('retry'); return true; }
    return false;
  }

  /** true while a modal (slate / tabloid) is open */
  get busy(): boolean {
    return !!((this.slateSession && !this.slateSession.done) || (this.tabSession && !this.tabSession.done));
  }

  private clearBanners(): void {
    this.queue = [];
    this.showing = null;
    if (this.alertAnim) { this.alertAnim.cancel(); this.alertAnim = null; }
    if (this.sizeAnim) { this.sizeAnim.cancel(); this.sizeAnim = null; }
    this.alertBox.classList.remove('on');
    this.sizeBox.classList.remove('on');
    this.sizeUntil = 0;
  }
}

function fmtRecord(key: string, v: number): string {
  if (key === 'peakRank') return `${STR.sizeUp.size} ${roman(Math.max(0, Math.min(4, Math.round(v))))}`;
  if (key === 'survivedS' || key === 'clearS') return fmtTime(v);
  if (key === 'tonnage') return `${fmtInt(v)} T`;
  return fmtInt(v);
}

/** "WEDNESDAY, SEPTEMBER 23" (cosmetic; UI may read the clock). */
function dateLine(): string {
  const d = new Date();
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}
