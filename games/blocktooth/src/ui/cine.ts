// BLOCKTOOTH v2 — the cinematic opening's DOM overlay: the WARD-7 STREET CAM (FEATURES_V2 §11). UI.
//
// A camcorder viewfinder over the 3D shots (render/cinecam.ts drives the camera; game.ts calls
// setShot(cineCam.shot) every frame). Everything here is driven by the shot clock, never by its own
// timers, so a hitch slows the overlay exactly as it slows the camera. Layers, back to front:
//   grade      a per-biome CSS tint (data/cine.ts: warm GRID-EAST, cool WHITE STACKS, magenta LOCKWATER)
//   lens       frost vignette (WHITE STACKS) / rain streaks on the glass (LOCKWATER) / clean
//   static     SIGNAL (0–0.35 s): video static, then the viewfinder snaps on (a flat grey fade under
//              reduced flashing)
//   viewfinder 4 corner brackets, a centre cross, a top-centre OSD line (● REC · timecode · battery),
//              all cream Space Mono; SIGNAL ACQUIRED centre-bottom. The brackets expand off-screen over
//              the last 0.8 s of the crane. No letterbox bars, no top-corner tabs (§0.7).
//   bug        the HUD's own WARD-7 • LIVE bug in its HUD place (top-left), fading in with the lower third
//   lower third the legacy slate's block, same classes and copy (BREAKING · place · clock / headline /
//              SUBJECT chip + sighting line / sub strap), sliding in at beats.lowerThird and collapsing
//              into the bug (translate + scale to the top-left) over the last 0.4 s of the crane
//   skip hint  SKIP ▸ ANY KEY, bottom-right, after 0.8 s
//   veil       the cut: a navy dip for a skip (0.1 s in, then out while the camera lands) and for the
//              reduce-motion hand-off (a 0.4 s dissolve with the camera cut at its middle)
//
// Input: runModal + UiKeys (armMs 350 — the shared guard): ANY key / pad button / click skips.
// play() resolves 'skipped' on a skip, 'done' when the app calls setShot(null) after CineCam hands back,
// 'aborted' on clear().

import type { Input } from '../core/input.ts';
import type { BiomeId, TitanDef } from '../core/types.ts';
import type { CineInfo, CineOverlayApi, CinePlan, CineShot } from '../v2types.ts';
import { BIOMES } from '../data/biomes.ts';
import { TITANS } from '../data/titans.ts';
import { CINE } from '../data/cine.ts';
import { RANK_SUBS, STR } from '../data/strings.ts';
import { type ModalSession, div, el, flashesReduced, fmt, fmtClock, onTap, pickOne, runModal } from './dom.ts';
import { buildBug } from './menus.ts';

const CSS_ID = 'bt2-cine-css';
const CSS = `
.bt2c { z-index: 40; overflow: hidden; cursor: pointer; }
.bt2c > div { position: absolute; }
.bt2c-grade { inset: 0; pointer-events: none; }
.bt2c-lens { inset: 0; pointer-events: none; }
.bt2c-lens.frost { background:
  radial-gradient(ellipse at 0% 0%, rgba(236,246,255,.55), transparent 32%),
  radial-gradient(ellipse at 100% 0%, rgba(236,246,255,.5), transparent 30%),
  radial-gradient(ellipse at 0% 100%, rgba(236,246,255,.6), transparent 34%),
  radial-gradient(ellipse at 100% 100%, rgba(236,246,255,.55), transparent 32%); }
.bt2c-rain { position: absolute; inset: -100% 0 0 0; pointer-events: none; opacity: .55;
  background:
    repeating-linear-gradient(102deg, transparent 0 calc(var(--u) * 3.1), rgba(200,225,255,.16) calc(var(--u) * 3.1) calc(var(--u) * 3.18), transparent calc(var(--u) * 3.18) calc(var(--u) * 7.3)),
    repeating-linear-gradient(98deg, transparent 0 calc(var(--u) * 5.3), rgba(255,160,235,.10) calc(var(--u) * 5.3) calc(var(--u) * 5.36), transparent calc(var(--u) * 5.36) calc(var(--u) * 9.1));
  will-change: transform; }
.bt2c-static { position: absolute; left: 0; top: 0; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; pointer-events: none; }
.bt2c-vf { inset: calc(var(--u) * 2.6); pointer-events: none; will-change: transform, opacity; }
.bt2c-vf .bt-vf { border-color: rgba(244,236,216,.92); }
.bt2c-cross { position: absolute; left: 50%; top: 50%; width: calc(var(--u) * 2.2); height: calc(var(--u) * 2.2); transform: translate(-50%, -50%); opacity: .8; }
.bt2c-cross::before, .bt2c-cross::after { content: ''; position: absolute; background: rgba(244,236,216,.9); }
.bt2c-cross::before { left: 0; right: 0; top: 50%; height: calc(var(--u) * .14); transform: translateY(-50%); }
.bt2c-cross::after { top: 0; bottom: 0; left: 50%; width: calc(var(--u) * .14); transform: translateX(-50%); }
.bt2c-osd { position: absolute; left: 50%; top: calc(var(--u) * .5); transform: translateX(-50%); display: flex; align-items: center; gap: calc(var(--u) * 1.2);
  font-family: var(--f-mono); font-weight: 700; font-size: calc(var(--u) * 1.05); letter-spacing: .08em; color: var(--cream);
  text-shadow: 0 0 calc(var(--u) * .3) rgba(8,12,30,.8); white-space: nowrap; }
.bt2c-rec { display: flex; align-items: center; gap: calc(var(--u) * .4); }
.bt2c-rec i { width: calc(var(--u) * .8); height: calc(var(--u) * .8); border-radius: 50%; background: var(--red); display: inline-block; }
.bt2c-batt { display: inline-flex; align-items: center; }
.bt2c-batt b { width: calc(var(--u) * 2.2); height: calc(var(--u) * 1); border: calc(var(--u) * .14) solid var(--cream); padding: calc(var(--u) * .1); display: flex; gap: calc(var(--u) * .1); }
.bt2c-batt b s { flex: 1; background: var(--cream); }
.bt2c-batt u { width: calc(var(--u) * .2); height: calc(var(--u) * .45); background: var(--cream); }
.bt2c-sig { position: absolute; left: 50%; bottom: calc(var(--u) * 1.2); transform: translateX(-50%); font-family: var(--f-mono); font-weight: 700;
  font-size: calc(var(--u) * 1.2); letter-spacing: .3em; color: var(--cream); background: rgba(20,33,61,.55);
  padding: calc(var(--u) * .25) calc(var(--u) * 1); white-space: nowrap; }
.bt2c-skip { right: calc(var(--u) * 3.4); bottom: calc(var(--u) * 3.2); font-family: var(--f-mono); font-weight: 700;
  font-size: calc(var(--u) * .95); letter-spacing: .14em; color: var(--cream); background: rgba(20,33,61,.7);
  border: calc(var(--u) * .12) solid rgba(244,236,216,.6); padding: calc(var(--u) * .25) calc(var(--u) * .7); white-space: nowrap; }
.bt2c .bt-lt { will-change: transform, opacity; transform-origin: 0 0; }
.bt2c .bt-bug { will-change: opacity; }
.bt2c-veil { inset: 0; background: #0c1426; pointer-events: none; }
.bt2c-veil::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(244,236,216,.05) 0 1px, transparent 1px 3px); }
`;

function ensureCss(): void {
  if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
  const st = document.createElement('style');
  st.id = CSS_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => { const u = sat(v); return u * u * (3 - 2 * u); };
const easeOut = (v: number): number => { const u = sat(v); return 1 - Math.pow(1 - u, 3); };

/** writes a style property only when the value changes (no per-frame DOM churn) */
class StyleCache {
  private readonly last = new Map<string, string>();
  set(e: HTMLElement, key: 'opacity' | 'transform' | 'display', v: string): void {
    const id = (e.dataset.sc ??= String(Math.random()).slice(2, 9)) + key;
    if (this.last.get(id) === v) return;
    this.last.set(id, v);
    e.style[key] = v;
  }
  reset(): void { this.last.clear(); }
}

export class CineOverlay implements CineOverlayApi {
  private readonly input: Input;
  private readonly layer: HTMLDivElement;
  private readonly grade: HTMLDivElement;
  private readonly lens: HTMLDivElement;
  private readonly rain: HTMLDivElement;
  private readonly staticCv: HTMLCanvasElement;
  private readonly staticCtx: CanvasRenderingContext2D | null;
  private readonly staticImg: ImageData | null;
  private readonly vf: HTMLDivElement;
  private readonly tc: HTMLElement;
  private readonly sig: HTMLDivElement;
  private readonly skipHint: HTMLDivElement;
  private readonly bug: HTMLDivElement;
  private readonly lt: HTMLDivElement;
  private readonly ltPlace: HTMLElement;
  private readonly ltClock: HTMLElement;
  private readonly ltHead: HTMLElement;
  private readonly ltSub: HTMLElement;
  private readonly ltName: HTMLElement;
  private readonly ltRole: HTMLElement;
  private readonly ltSwatch: HTMLElement;
  private readonly ltRank: HTMLElement;
  private readonly veil: HTMLDivElement;
  private readonly sc = new StyleCache();

  private plan: CinePlan | null = null;
  private info: CineInfo | null = null;
  private session: ModalSession<'done' | 'skipped'> | null = null;
  private resolveAbort: ((v: 'aborted') => void) | null = null;
  private skipping = false;
  private skipAt = 0;
  private veilTimer = 0;
  private collapse: { dx: number; dy: number; s: number } | null = null;
  private calm = false;

  constructor(root: HTMLElement, input: Input) {
    ensureCss();
    this.input = input;
    const L = this.layer = div('bt-layer bt-screen bt2c bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', 'WARD-7 STREET CAM');
    L.dataset.v2 = 'cine';
    this.grade = div('bt2c-grade', L);
    this.lens = div('bt2c-lens', L);
    this.rain = div('bt2c-rain', this.lens);
    const cv = this.staticCv = el('canvas', 'bt2c-static');
    cv.width = 128; cv.height = 72;
    L.appendChild(cv);
    this.staticCtx = cv.getContext('2d');
    this.staticImg = this.staticCtx ? this.staticCtx.createImageData(cv.width, cv.height) : null;
    div('bt-scanlines', L);

    const vf = this.vf = div('bt2c-vf', L);
    for (const c of ['tl', 'tr', 'bl', 'br']) div(`bt-vf ${c}`, vf);
    div('bt2c-cross', vf);
    const osd = div('bt2c-osd', vf);
    const rec = div('bt2c-rec', osd);
    rec.appendChild(el('i'));
    rec.appendChild(el('span', '', 'REC'));
    this.tc = el('span', 'bt2c-tc', '00:00:00:00');
    osd.appendChild(this.tc);
    osd.appendChild(el('span', '', 'WARD-7 STREET CAM'));
    const batt = div('bt2c-batt', osd);
    const cell = el('b');
    for (let i = 0; i < 3; i++) cell.appendChild(el('s'));
    batt.appendChild(cell);
    batt.appendChild(el('u'));
    this.sig = div('bt2c-sig', vf, 'SIGNAL ACQUIRED');

    this.bug = buildBug(L);

    // the legacy slate's lower third (ui/broadcast.ts), same classes and copy
    const lt = this.lt = div('bt-lt', L);
    const ltTop = div('bt-lt-top', lt);
    ltTop.appendChild(el('span', 'bt-lt-breaking', STR.slate.breaking));
    this.ltPlace = el('span', 'bt-lt-place');
    ltTop.appendChild(this.ltPlace);
    this.ltClock = el('span', 'bt-lt-clock');
    ltTop.appendChild(this.ltClock);
    const ltMain = div('bt-lt-main', lt);
    div('bt-lt-net', ltMain, STR.network);
    this.ltHead = div('bt-lt-head', ltMain);
    const ltSubRow = div('bt-lt-subrow', lt);
    const chip = div('bt-lt-chip', ltSubRow);
    this.ltSwatch = div('bt-lt-swatch', chip);
    const chipTxt = div('bt-lt-chip-txt', chip);
    chipTxt.appendChild(el('small', '', STR.slate.subject));
    this.ltName = el('b', '');
    chipTxt.appendChild(this.ltName);
    this.ltRole = el('span', 'bt-lt-role');
    chipTxt.appendChild(this.ltRole);
    this.ltSub = div('bt-lt-sub', ltSubRow);
    this.ltRank = div('bt-lt-rank', lt);

    this.skipHint = div('bt2c-skip', L, 'SKIP ▸ ANY KEY');
    this.veil = div('bt2c-veil', L);
    onTap(L, () => this.skip());
  }

  play(plan: CinePlan, info: CineInfo): Promise<'done' | 'skipped' | 'aborted'> {
    this.clear();
    this.plan = plan;
    this.info = info;
    this.skipping = false;
    this.collapse = null;
    this.calm = !!info.reduceFlash || flashesReduced();
    this.sc.reset();
    this.fill(plan, info);
    const L = this.layer;
    L.classList.remove('bt-hidden');
    this.frame(0);
    const abort = new Promise<'aborted'>((r) => { this.resolveAbort = r; });
    const { promise, session } = runModal<'done' | 'skipped'>(L, this.input, () => this.skip(), {
      armMs: 350,
      onClose: () => { if (!this.skipping) this.hide(); },
    });
    this.session = session;
    return Promise.race([promise, abort]);
  }

  setShot(s: CineShot | null): void {
    const P = this.plan;
    if (!P || !this.session || this.session.done) {
      if (s === null && this.skipping) this.endVeil();
      return;
    }
    if (s === null) { this.session.finish('done'); return; }
    const sh = P.shots.find((x) => x.id === s.id);
    const T = (sh ? sh.start : 0) + s.t;
    this.frame(T);
  }

  skip(): void {
    const s = this.session;
    if (!s || s.done || this.skipping) return;
    this.skipping = true;
    this.skipAt = performance.now();
    // the cut: a quick navy dip; the promise resolves under it, the camera lands, the veil lifts
    for (const e of [this.vf, this.lt, this.bug, this.skipHint, this.grade, this.lens, this.staticCv]) this.sc.set(e, 'opacity', '0');
    this.veil.style.transition = 'opacity 100ms linear';
    this.veil.style.opacity = '1';
    s.finish('skipped', 110);
    window.clearTimeout(this.veilTimer);
    this.veilTimer = window.setTimeout(() => this.endVeil(), 380);
  }

  clear(): void {
    window.clearTimeout(this.veilTimer);
    const s = this.session;
    this.session = null;
    if (s && !s.done) s.abort();
    const r = this.resolveAbort;
    this.resolveAbort = null;
    if (r) r('aborted');
    this.skipping = false;
    this.plan = null;
    this.hide();
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private hide(): void {
    this.layer.classList.add('bt-hidden');
    this.veil.style.transition = '';
    this.veil.style.opacity = '0';
    this.sc.reset();
  }

  private endVeil(): void {
    window.clearTimeout(this.veilTimer);
    if (!this.skipping) return;
    this.veil.style.transition = 'opacity 200ms linear';
    this.veil.style.opacity = '0';
    this.veilTimer = window.setTimeout(() => { this.skipping = false; this.resolveAbort = null; this.hide(); }, 220);
  }

  private fill(plan: CinePlan, info: CineInfo): void {
    const biome = (Object.keys(BIOMES) as BiomeId[]).find((id) => BIOMES[id].slate === info.place) ?? null;
    const titan: TitanDef | undefined = Object.values(TITANS).find((t) => t.name === info.titanName);
    const cfg = biome ? CINE[biome] : null;
    const copy = biome ? STR.slates[biome] : null;
    this.ltPlace.textContent = copy ? copy.place : info.place;
    this.ltClock.textContent = fmtClock(biome ? (STR.clockStart[biome] ?? 14 * 60) : 14 * 60);
    this.ltHead.textContent = info.place;
    const tpl = info.sub || (copy && copy.subs.length ? pickOne(copy.subs) : '{name}');
    this.ltSub.textContent = fmt(tpl, { name: info.titanName, species: titan ? titan.species.toUpperCase() : '' });
    this.ltName.textContent = info.titanName;
    this.ltRole.textContent = titan ? titan.role : '';
    if (titan) {
      this.ltSwatch.style.background = `linear-gradient(135deg, ${titan.colors.primary} 0 55%, ${titan.colors.secondary} 55% 100%)`;
      this.lt.style.setProperty('--titan', titan.colors.primary);
    }
    this.ltRank.textContent = (cfg && cfg.sub) || (RANK_SUBS[0] ?? '');
    // grade + lens
    this.grade.style.background = cfg ? cfg.grade.tint : 'transparent';
    this.grade.style.opacity = cfg ? String(cfg.grade.alpha) : '0';
    this.lens.className = 'bt2c-lens' + (cfg && cfg.lens === 'frost' ? ' frost' : '');
    this.rain.style.display = cfg && cfg.lens === 'rain' ? '' : 'none';
    this.layer.dataset.variant = plan.variant;
    this.veil.style.transition = '';
    this.veil.style.opacity = '0';
    this.lt.style.transform = 'translateX(-110%)';
    this.lt.style.opacity = '0';
  }

  /** lay out every layer for plan time T (s) */
  private frame(T: number): void {
    const P = this.plan;
    if (!P) return;
    const sc = this.sc, calm = this.calm, reduced = P.variant === 'reduced';
    const sig = P.shots.find((s) => s.id === 'signal');
    const crane = P.shots.find((s) => s.id === 'crane');
    const hand = P.shots.find((s) => s.id === 'handoff');
    // SIGNAL: static, then the viewfinder snaps on
    const sigEnd = sig ? sig.start + sig.dur : 0;
    const staticA = sig ? (T < sigEnd - 0.1 ? 1 : 1 - sat((T - (sigEnd - 0.1)) / 0.1)) : 0;
    sc.set(this.staticCv, 'opacity', staticA > 0 ? (calm ? String(0.85 * staticA) : String(staticA)) : '0');
    if (staticA > 0) this.drawStatic(calm);
    const vfOn = !sig || T >= sigEnd - 0.05;
    // brackets expand off-screen over the last 0.8 s of the crane (fade under reduce motion)
    let vfScale = 1, vfA = vfOn ? 1 : 0;
    if (crane) {
      const u = sat((T - (crane.start + crane.dur - 0.8)) / 0.8);
      vfScale = 1 + 0.45 * easeOut(u);
      vfA *= 1 - smooth(u);
    }
    if (hand && T >= hand.start) vfA = reduced ? vfA * (1 - smooth((T - hand.start) / (hand.dur * 0.5))) : 0;
    sc.set(this.vf, 'opacity', vfA.toFixed(3));
    sc.set(this.vf, 'transform', `scale(${vfScale.toFixed(4)})`);
    sc.set(this.sig, 'opacity', sig && T < sigEnd + 0.9 ? (calm ? '1' : (Math.floor(T * 4) % 2 === 0 ? '1' : '0.35')) : '0');
    // timecode (30 fps frames)
    const f = Math.floor(T * 30) % 30, s = Math.floor(T);
    this.tc.textContent = `00:00:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
    // grade + lens stay up until the hand-off
    const endA = hand && T >= hand.start ? 1 - smooth((T - hand.start) / hand.dur) : crane ? 1 - 0.6 * smooth((T - crane.start) / crane.dur) : 1;
    sc.set(this.lens, 'opacity', endA.toFixed(3));
    if (this.rain.style.display !== 'none' && !calm) sc.set(this.rain, 'transform', `translateY(${((T * 38) % 50).toFixed(2)}%)`);
    // lower third: slides in at beats.lowerThird (a fade under reduce motion), collapses into the bug
    const lt0 = P.beats.lowerThird;
    const ltIn = sat((T - lt0) / 0.56);
    let ltA = T >= lt0 ? 1 : 0;
    let ltTf = reduced ? 'translateX(0)' : `translateX(${(-105 * (1 - easeOut(ltIn))).toFixed(2)}%)`;
    if (reduced) ltA = smooth(ltIn);
    const colEnd = crane ? crane.start + crane.dur : hand ? hand.start + hand.dur : P.total;
    const colT = sat((T - (colEnd - 0.4)) / 0.4);
    if (colT > 0) {
      if (!this.collapse) this.collapse = this.measureCollapse();
      const c = this.collapse;
      const u = easeOut(colT);
      if (c && !reduced) ltTf = `translate(${(c.dx * u).toFixed(1)}px, ${(c.dy * u).toFixed(1)}px) scale(${(1 + (c.s - 1) * u).toFixed(4)})`;
      ltA *= 1 - smooth((colT - 0.35) / 0.65);
    }
    if (hand && T >= hand.start + (reduced ? hand.dur * 0.5 : 0)) ltA = 0;
    sc.set(this.lt, 'opacity', ltA.toFixed(3));
    sc.set(this.lt, 'transform', ltTf);
    // the WARD-7 bug fades in with the lower third and stays until the HUD takes over
    sc.set(this.bug, 'opacity', smooth((T - lt0) / 0.4).toFixed(3));
    // skip hint after 0.8 s
    sc.set(this.skipHint, 'opacity', T >= 0.8 && !(hand && T >= hand.start) ? '1' : '0');
    // reduce-motion hand-off: a dissolve through the veil, the camera cuts at its middle
    if (!this.skipping) {
      const va = reduced && hand && T >= hand.start ? 1 - Math.abs(2 * sat((T - hand.start) / hand.dur) - 1) : 0;
      this.veil.style.transition = '';
      sc.set(this.veil, 'opacity', va.toFixed(3));
    }
  }

  /** where the lower third goes when it collapses: onto the WARD-7 bug (one layout read, once) */
  private measureCollapse(): { dx: number; dy: number; s: number } | null {
    try {
      const a = this.lt.getBoundingClientRect(), b = this.bug.getBoundingClientRect();
      if (!(a.width > 0) || !(b.width > 0)) return null;
      // the current transform is translateX(0) by now: a is the rest rect
      return { dx: b.left - a.left, dy: b.top - a.top, s: Math.max(0.05, b.height / Math.max(1, a.height)) };
    } catch { return null; }
  }

  private drawStatic(calm: boolean): void {
    const ctx = this.staticCtx, img = this.staticImg;
    if (!ctx || !img) return;
    const d = img.data;
    if (calm) {
      for (let i = 0; i < d.length; i += 4) { d[i] = 70; d[i + 1] = 74; d[i + 2] = 88; d[i + 3] = 255; }
    } else {
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 200) | 0;
        d[i] = v; d[i + 1] = v; d[i + 2] = v + 18 > 255 ? 255 : v + 18; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
