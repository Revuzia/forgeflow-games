// HIT PARADE - the broadcast package (lane UI; CONTRACT section 8, 16). Pattern: blocktooth/src/ui/broadcast.ts.
//   buildBug   the show bug: HIT PARADE logo + red LIVE pill (blinking dot) + an episode line. Used by the HUD, the title
//              and the slates.
//   sweep      a full-width banner band (ROUND 1, FIGHT!, K.O., TIME OVER, PERFECT, <NAME> WINS). Queued and sequential;
//              non-blocking; resolves when that sweep is gone. CHANGED(fixer) D1: `cut: true` drops the showing sweep and
//              everything queued (their promises resolve) and plays at once - the HUD cuts on every sim phase change
//              (KO / TIME OVER / ROUND_INTRO / FIGHT) so a banner never outlives the phase it belongs to (a fixed-duration
//              queue used to play '<NAME> WINS', 'ROUND 2' and 'FIGHT!' up to 3 s into the live round). `onStart` runs
//              when that sweep actually starts (host captions paced to their banner).
//   strap      the stage manager's lower third (RATINGS SPIKE, MATCH POINT, PHASE TWO ...). Queued, deduped by key,
//              urgent ones jump the queue, at most 3 waiting.
//   caption    the host's caption card (RICKY MARQUEE). Lines come from data/captions.json pools by event; a line never
//              repeats back-to-back in a pool; a minimum gap keeps him from talking over himself; a higher-priority line
//              replaces a showing lower one.
//   slate      a modal freeze-frame (halftone + scanlines + viewfinder + bug + lower third) that resolves on any key /
//              click / tap / pad button after a short arm delay.
//   clear      drop every queue and banner and resolve an open slate. Deferred work is guarded by an epoch (doctrine
//              section 4): a timer or animation from before a clear() never touches the DOM after it.

import captionsJson from '../../../data/captions.json' with { type: 'json' };
import { el, div, svg, ICON, flashesReduced, pulse } from './dom.ts';
import { fill, t } from './strings.ts';

export type CaptionEvent =
  | 'round_start' | 'final_round' | 'match_point' | 'first_blood' | 'counter' | 'punish' | 'perfect_parry' | 'throw_escape'
  | 'wall_splat' | 'super' | 'stage_fright' | 'comeback' | 'ko' | 'time_over' | 'perfect_round' | 'round_end' | 'match_end'
  | 'draw' | 'boss_phase2'
  /** CHANGED(fix_ui_stage): EV3D.BACK_HIT (CONTRACT 35.20) */
  | 'back_hit';

interface CaptionsFile { host?: string; minGapMs?: number; showMs?: number; priority?: Record<string, number>; pools?: Record<string, string[]> }
const CAP = captionsJson as CaptionsFile;
const CAP_GAP = typeof CAP.minGapMs === 'number' ? CAP.minGapMs : 2600;
const CAP_SHOW = typeof CAP.showMs === 'number' ? CAP.showMs : 2800;

export type SweepTone = 'round' | 'fight' | 'ko' | 'time' | 'win';
const SWEEP_MS: Record<SweepTone, number> = { round: 1150, fight: 800, ko: 1500, time: 1400, win: 1700 };
const STRAP_MS = 2600;
const STRAP_QUEUE_MAX = 3;

export function buildBug(line = ''): HTMLElement {
  const b = el('div', 'hpb-bug');
  const logo = el('span', 'logo');
  logo.append(el('span', '', t('show.name')));
  const live = el('span', 'live');
  const ls = el('span');
  ls.append(el('i'), document.createTextNode(t('show.live')));
  live.append(ls);
  const ln = el('span', 'line');
  if (line) ln.append(el('span', '', line));
  b.append(logo, live, ln);
  return b;
}
/** replace the bug's episode line (empty hides it) */
export function setBugLine(bug: HTMLElement, line: string): void {
  const ln = bug.querySelector('.line');
  if (!ln) return;
  const cur = ln.textContent ?? '';
  if (cur === line) return;
  ln.replaceChildren();
  if (line) ln.append(el('span', '', line));
}

interface Strap { key: string; title: string; sub: string; urgent: boolean }
interface SweepJob { text: string; sub: string; tone: SweepTone; ms: number; done: () => void; onStart: (() => void) | null }
export interface SweepOpts { tone?: SweepTone; sub?: string; ms?: number; cut?: boolean; onStart?: () => void }

export class Broadcast {
  readonly root: HTMLElement;
  private epoch = 0;
  // sweep
  private readonly sweepEl: HTMLElement;
  private readonly sweepText: HTMLElement;
  private readonly sweepSub: HTMLElement;
  private sweeps: SweepJob[] = [];
  private sweeping: SweepJob | null = null;
  private sweepAnim: Animation | null = null;
  // straps
  private readonly strapEl: HTMLElement;
  private readonly strapTitle: HTMLElement;
  private readonly strapSub: HTMLElement;
  private straps: Strap[] = [];
  private strapShowing: Strap | null = null;
  private strapAnim: Animation | null = null;
  // captions
  private readonly capEl: HTMLElement;
  private readonly capText: HTMLElement;
  private capAnim: Animation | null = null;
  private capShowing: { pri: number; until: number } | null = null;
  private capLast = -1e9;
  private readonly lastPick = new Map<string, number>();
  private capTimer = 0;
  /** read-back: every caption line shown (newest last, 20 kept) */
  readonly log: Array<{ ev: string; text: string }> = [];
  // slate
  private readonly slateEl: HTMLElement;
  private readonly slKick: HTMLElement;
  private readonly slHead: HTMLElement;
  private readonly slSub: HTMLElement;
  private readonly slBug: HTMLElement;
  private slateDone: (() => void) | null = null;
  private slateOff: (() => void) | null = null;

  constructor(host: HTMLElement) {
    const R = this.root = div('hpb-layer', host);
    R.id = 'hp-broadcast';

    this.sweepEl = div('hpb-sweep', R);
    this.sweepEl.setAttribute('aria-live', 'assertive');
    this.sweepText = el('b');
    this.sweepSub = el('small');
    this.sweepEl.append(this.sweepText, this.sweepSub);

    this.strapEl = div('hpb-strap', R);
    this.strapEl.append(el('span', 'tag', t('strap.tag')));
    const st = div('txt', this.strapEl);
    this.strapTitle = el('b', 't');
    this.strapSub = el('span', 's');
    st.append(this.strapTitle, this.strapSub);

    this.capEl = div('hpb-cap', R);
    this.capEl.setAttribute('aria-live', 'polite');
    const who = div('who', this.capEl);
    who.append(svg(ICON.mic));
    const card = div('card', this.capEl);
    const nm = el('div', 'nm');
    nm.append(document.createTextNode(CAP.host ?? t('caption.host')), el('span', '', t('caption.role')));
    this.capText = el('div', 'tx');
    card.append(nm, this.capText);

    const S = this.slateEl = div('hpb-slate', R);
    S.setAttribute('role', 'dialog');
    div('tint', S);
    div('scan', S);
    const vf = div('vf', S);
    for (const c of ['tl', 'tr', 'bl', 'br']) vf.append(el('i', c));
    this.slBug = buildBug('');
    S.append(this.slBug);
    const lt = div('lt', S);
    this.slKick = el('span', 'kick');
    this.slHead = el('div', 'head');
    this.slSub = el('div', 'sub');
    lt.append(this.slKick, this.slHead, this.slSub);
    div('any', S, t('slate.any'));
  }

  // ─────────────────────────── sweeps ───────────────────────────
  sweep(text: string, o: SweepOpts = {}): Promise<void> {
    const tone = o.tone ?? 'round';
    if (o.cut) this.cutSweeps();
    return new Promise<void>((done) => {
      const ms = Math.max(200, Math.round(o.ms ?? SWEEP_MS[tone]));
      this.sweeps.push({ text, sub: o.sub ?? '', tone, ms, done, onStart: o.onStart ?? null });
      this.pumpSweep();
    });
  }

  /** CHANGED(fixer) D1: drop the showing sweep and the queue now (their promises resolve); straps / captions stay */
  cutSweeps(): void {
    const pending = [...this.sweeps];
    if (this.sweeping) pending.unshift(this.sweeping);
    this.sweeps = [];
    this.sweeping = null;
    if (this.sweepAnim) { this.sweepAnim.onfinish = null; this.sweepAnim.cancel(); this.sweepAnim = null; }
    this.sweepEl.classList.remove('on');
    for (const j of pending) j.done();
  }

  private pumpSweep(): void {
    if (this.sweeping || !this.sweeps.length) return;
    const job = this.sweeps.shift() as SweepJob;
    const ep = this.epoch;
    this.sweeping = job;
    if (job.onStart) { try { job.onStart(); } catch (e) { console.warn('[hit-parade] sweep onStart', e); } }
    this.sweepText.textContent = job.text;
    this.sweepSub.textContent = job.sub;
    this.sweepEl.dataset.tone = job.tone;
    this.sweepEl.classList.add('on');
    const reduced = flashesReduced();
    const frames: Keyframe[] = reduced
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
      : job.tone === 'fight' || job.tone === 'ko'
        ? [
          { opacity: 0, transform: 'scaleY(0.1)' },
          { opacity: 1, transform: 'scaleY(1.08)', offset: 0.1 },
          { opacity: 1, transform: 'scaleY(1)', offset: 0.16 },
          { opacity: 1, transform: 'scaleY(1)', offset: 0.84 },
          { opacity: 0, transform: 'scaleY(0.05)' },
        ]
        : [
          { opacity: 1, clipPath: 'inset(0 100% 0 0)' },
          { opacity: 1, clipPath: 'inset(0 0% 0 0)', offset: 0.14 },
          { opacity: 1, clipPath: 'inset(0 0% 0 0)', offset: 0.84 },
          { opacity: 1, clipPath: 'inset(0 0 0 100%)' },
        ];
    if (!reduced) {
      pulse(this.sweepText, job.tone === 'fight' || job.tone === 'ko'
        ? [{ transform: 'scale(2.2) rotate(-4deg)', opacity: 0 }, { transform: 'scale(.94) rotate(-4deg)', opacity: 1, offset: 0.22 }, { transform: 'scale(1) rotate(-4deg)' }]
        : [{ transform: 'translateX(-30%) skewX(-12deg)', letterSpacing: '.3em' }, { transform: 'translateX(0) skewX(-12deg)', letterSpacing: '.03em', offset: 0.3 }, { transform: 'translateX(2%) skewX(-12deg)' }],
      job.ms, 'cubic-bezier(.2,.9,.2,1)');
    }
    let anim: Animation | null = null;
    try { anim = this.sweepEl.animate(frames, { duration: job.ms, easing: 'cubic-bezier(.6,0,.3,1)', fill: 'both' }); } catch { anim = null; }
    this.sweepAnim = anim;
    const finish = (): void => {
      if (ep !== this.epoch || this.sweeping !== job) return;
      this.sweepEl.classList.remove('on');
      if (this.sweepAnim) { this.sweepAnim.cancel(); this.sweepAnim = null; }
      this.sweeping = null;
      job.done();
      this.pumpSweep();
    };
    if (anim) anim.onfinish = finish; else window.setTimeout(finish, job.ms);
  }

  // ─────────────────────────── straps ───────────────────────────
  strap(key: string, title: string, sub = '', urgent = false): void {
    if (this.strapShowing?.key === key || this.straps.some((s) => s.key === key)) return;
    const s: Strap = { key, title, sub, urgent };
    if (urgent) this.straps.unshift(s); else this.straps.push(s);
    while (this.straps.length > STRAP_QUEUE_MAX) {
      let drop = -1;
      for (let i = this.straps.length - 1; i >= 0; i--) if (!this.straps[i].urgent) { drop = i; break; }
      this.straps.splice(drop >= 0 ? drop : this.straps.length - 1, 1);
    }
    this.pumpStrap();
  }

  private pumpStrap(): void {
    if (this.strapShowing || !this.straps.length) return;
    const s = this.straps.shift() as Strap;
    const ep = this.epoch;
    this.strapShowing = s;
    this.strapTitle.textContent = s.title;
    this.strapSub.textContent = s.sub;
    this.strapEl.classList.add('on');
    const reduced = flashesReduced();
    const frames: Keyframe[] = reduced
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }]
      : [
        { opacity: 1, transform: 'translateX(-110%)' },
        { opacity: 1, transform: 'translateX(3%)', offset: 0.1 },
        { opacity: 1, transform: 'translateX(0)', offset: 0.14 },
        { opacity: 1, transform: 'translateX(0)', offset: 0.88 },
        { opacity: 0, transform: 'translateX(-6%)' },
      ];
    let anim: Animation | null = null;
    try { anim = this.strapEl.animate(frames, { duration: STRAP_MS, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'both' }); } catch { anim = null; }
    this.strapAnim = anim;
    const finish = (): void => {
      if (ep !== this.epoch || this.strapShowing !== s) return;
      this.strapEl.classList.remove('on');
      if (this.strapAnim) { this.strapAnim.cancel(); this.strapAnim = null; }
      this.strapShowing = null;
      window.setTimeout(() => { if (ep === this.epoch) this.pumpStrap(); }, 220);
    };
    if (anim) anim.onfinish = finish; else window.setTimeout(finish, STRAP_MS);
  }

  // ─────────────────────────── host captions ───────────────────────────
  /** pick a line from the event's pool and show it; false when the gap / priority rules held it back */
  caption(ev: CaptionEvent, vars: Readonly<Record<string, string | number>> = {}): boolean {
    const pool = CAP.pools?.[ev];
    if (!pool || !pool.length) return false;
    const pri = CAP.priority?.[ev] ?? 1;
    const now = performance.now();
    if (this.capShowing && now < this.capShowing.until && pri <= this.capShowing.pri) return false;
    if (!this.capShowing && pri < 4 && now - this.capLast < CAP_GAP) return false;
    const last = this.lastPick.get(ev) ?? -1;
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && i === last) i = (i + 1) % pool.length;
    this.lastPick.set(ev, i);
    this.say(fill(pool[i], vars), pri, ev);
    return true;
  }

  /** show a raw caption line (the integrator may cue its own) */
  say(text: string, pri = 3, ev = 'say'): void {
    const ep = this.epoch;
    const now = performance.now();
    this.capLast = now;
    this.capShowing = { pri, until: now + CAP_SHOW };
    this.capText.textContent = text;
    this.fitCaption();
    this.log.push({ ev, text });
    if (this.log.length > 20) this.log.shift();
    this.capEl.classList.add('on');
    if (this.capAnim) this.capAnim.cancel();
    const reduced = flashesReduced();
    try {
      const touch = document.documentElement.classList.contains('hp-touch');
      const tx = touch ? '' : 'translateX(-50%) ';
      // CHANGED(UI) P2 (D6): the top-band ticker drops in from above; the touch subtitle rises from below
      const from = touch ? 'translateY(40%)' : 'translateY(-60%)';
      this.capAnim = this.capEl.animate(reduced
        ? [{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }]
        : [
          { opacity: 0, transform: `${tx}${from}` },
          { opacity: 1, transform: `${tx}translateY(0)`, offset: 0.07 },
          { opacity: 1, transform: `${tx}translateY(0)`, offset: 0.92 },
          { opacity: 0, transform: `${tx}${from}` },
        ], { duration: CAP_SHOW, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'both' });
    } catch { this.capAnim = null; }
    window.clearTimeout(this.capTimer);
    this.capTimer = window.setTimeout(() => {
      if (ep !== this.epoch) return;
      this.capEl.classList.remove('on');
      if (this.capAnim) { this.capAnim.cancel(); this.capAnim = null; }
      this.capShowing = null;
    }, CAP_SHOW);
  }

  /** CHANGED(UI) P2 (D6): the one-line ticker shrinks a long line to fit (1 px steps, never below 12 px), then ellipsizes */
  private fitCaption(): void {
    const e = this.capText;
    e.style.fontSize = '';
    if (!e.clientWidth) return;
    let fs = parseFloat(getComputedStyle(e).fontSize) || 16;
    for (let i = 0; i < 10 && e.scrollWidth > e.clientWidth + 1 && fs > 12; i++) { fs -= 1; e.style.fontSize = `${fs}px`; }
  }

  // ─────────────────────────── slate (modal) ───────────────────────────
  /** the freeze-frame slate; resolves on any key / click / tap / pad button once armed (armMs) */
  slate(p: { kicker: string; head: string; sub?: string; line?: string }, armMs = 450): Promise<void> {
    this.closeSlate();
    const ep = this.epoch;
    this.slKick.textContent = p.kicker;
    this.slHead.textContent = p.head;
    this.slSub.textContent = p.sub ?? '';
    setBugLine(this.slBug, p.line ?? '');
    this.slateEl.classList.add('on');
    const reduced = flashesReduced();
    pulse(this.slateEl, [{ opacity: 0 }, { opacity: 1 }], 180);
    if (!reduced) pulse(this.slateEl.querySelector('.lt'), [{ transform: 'translateX(-105%)' }, { transform: 'translateX(2%)', offset: 0.75 }, { transform: 'translateX(0)' }], 560, 'cubic-bezier(.2,.9,.2,1)');
    return new Promise<void>((resolve) => {
      const t0 = performance.now();
      let raf = 0;
      let padPrev: boolean[] = [];
      const armed = (): boolean => performance.now() - t0 >= armMs;
      const go = (): void => { if (ep === this.epoch && armed()) this.closeSlate(); };
      const onKey = (e: KeyboardEvent): void => { if (e.repeat) return; e.preventDefault(); e.stopPropagation(); go(); };
      const onPtr = (e: Event): void => { e.preventDefault(); go(); };
      const poll = (): void => {
        const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
        const now: boolean[] = [];
        for (const g of pads) if (g && g.connected) g.buttons.forEach((b, i) => { now[i] = now[i] || b.pressed; });
        if (now.some((v, i) => v && !padPrev[i])) go();
        padPrev = now;
        raf = requestAnimationFrame(poll);
      };
      window.addEventListener('keydown', onKey, true);
      this.slateEl.addEventListener('pointerdown', onPtr);
      raf = requestAnimationFrame(poll);
      this.slateOff = () => {
        window.removeEventListener('keydown', onKey, true);
        this.slateEl.removeEventListener('pointerdown', onPtr);
        cancelAnimationFrame(raf);
      };
      this.slateDone = resolve;
    });
  }

  get slateOpen(): boolean { return this.slateEl.classList.contains('on'); }

  private closeSlate(): void {
    if (this.slateOff) { this.slateOff(); this.slateOff = null; }
    this.slateEl.classList.remove('on');
    const d = this.slateDone;
    this.slateDone = null;
    if (d) d();
  }

  // ─────────────────────────── clear ───────────────────────────
  clear(): void {
    this.epoch++;
    this.cutSweeps();
    this.straps = [];
    this.strapShowing = null;
    if (this.strapAnim) { this.strapAnim.cancel(); this.strapAnim = null; }
    this.strapEl.classList.remove('on');
    window.clearTimeout(this.capTimer);
    if (this.capAnim) { this.capAnim.cancel(); this.capAnim = null; }
    this.capEl.classList.remove('on');
    this.capShowing = null;
    this.capLast = -1e9;
    this.closeSlate();
  }

  readback(): Record<string, unknown> {
    return {
      sweep: this.sweeping ? this.sweeping.text : null, sweepQueue: this.sweeps.map((s) => s.text),
      strap: this.strapShowing ? this.strapShowing.title : null, strapQueue: this.straps.map((s) => s.title),
      caption: this.capShowing ? this.capText.textContent : null, captions: this.log.slice(-6), slate: this.slateOpen,
    };
  }

  dispose(): void { this.clear(); this.root.remove(); }
}
