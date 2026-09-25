// DYEFIELD — match HUD (CONTRACT §11, DESIGN §2 "HUD rhythm"). Chunky toy-bright DOM over the canvas,
// Lilita One + Nunito. Only the brief's strings are shown (DESIGN §1):
//   top centre    4 SUNCREW crests (◉) · timer pill 3:00 → 0:00 (pulses in the final 10) · 4 GULF CREW
//                 crests (▲); a downed crest shows ✕ plus its respawn count. A slim unlabeled tug bar
//                 under the pill shows the turf split (shape marks at its ends).
//   top right     special gauge: the kit's special icon + name (weapons.json), a fill, and at 100 % a
//                 pulse with a key badge showing the ACTUAL binding (Input.keyLabel('special'));
//                 then the kill feed `{A} washed {B}` (a sea death shows {B} with a wave icon)
//   centre        reticle + TANK pipette (dry-click flash; a tick at the sub cost), hit marker; the sub
//                 chip (JELLY CHARGE icon + its key) greys out below the sub cost; NEEDLE-GLINT shows a
//                 charge ring around the reticle (bright at full charge)
//   bottom centre low-tank toast `Tank low — hold SHIFT on your color to drink`
//   bottom left   minimap (MinimapRaster → putImageData only when dirty) + the runner arrow + ally dots
//                 and seen-enemy dots (dot shape = crew mark: ◉ circle / ▲ triangle)
//   overlays      damage vignette (enemy dye at the edges) · slates.ts (3 · 2 · 1, WASHED BY, victory)
//   F1            debug panel · pause card (PAUSED / RESUME)
// Every per-frame write is skipped when its value did not change.

import type { Coverage, MoveState, TeamId } from '../core/types.ts';
import { TEAMS, teamById } from '../core/data.ts';
import type { MinimapRaster } from '../core/paint/minimap.ts';
import { Slates, waveIcon, type VictoryInfo } from './slates.ts';

export const LOW_TANK_TOAST = 'Tank low — hold SHIFT on your color to drink';
export const FEED_VERB = 'washed';

export interface HudDebug {
  coverage: Coverage; tank: number; mapId: string; fps: number; state: MoveState; grounded: boolean;
  atlasSize: number; atlasCount: number; overlaps: number; calls: number; triangles: number;
  programs: number; tick: number; x: number; y: number; z: number; flips: number; speed: number;
  anim: string; pointerLock: boolean;
  /** adaptive render resolution (view/renderer.ts) */
  scale: number; scaleMin: number; scaleMax: number; quality: string; buffer: [number, number];
  p90: number; targetMs: number;
  /** match (phases 3–5) */
  match?: string; hp?: number; projectiles?: number; particles?: number; runners?: string;
}

/** the human's kit, for the gauge / sub chip / charge ring (main.ts builds it from weapons.json + Input) */
export interface HudKit {
  /** weapons.json fire.type: stream | roll | charge | burst */
  fire: string;
  specialId: string; specialName: string;
  /** keycap label of the special binding (e.g. 'Q') */
  specialKey: string;
  subName: string; subCost: number;
  /** keycap label of the sub binding (e.g. 'E') */
  subKey: string;
}

const ICONS: Record<string, string> = {
  cloudburst: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 14.6a3.6 3.6 0 0 1 .3-7.2 5 5 0 0 1 9.4-1.3 4.1 4.1 0 0 1 1.3 8.5z" fill="#fff8ec" stroke="#14203a" stroke-width="1.6" stroke-linejoin="round"/>'
    + '<path d="M8.2 17.4l-1 2.8M12.2 17.4l-1 2.8M16.2 17.4l-1 2.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  wellspring: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="18.2" rx="9.4" ry="3.4" fill="none" stroke="currentColor" stroke-width="2.4"/>'
    + '<ellipse cx="12" cy="18.2" rx="4.6" ry="1.6" fill="none" stroke="#fff8ec" stroke-width="1.6"/>'
    + '<path d="M12 14.6V3.6M7.8 7.8L12 3.6l4.2 4.2" fill="none" stroke="#fff8ec" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  jelly: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 16.2c0-5.2 3.8-9.4 8.4-9.4s8.4 4.2 8.4 9.4c0 1.8-3.8 3.2-8.4 3.2s-8.4-1.4-8.4-3.2z" fill="currentColor" stroke="#14203a" stroke-width="1.7"/>'
    + '<ellipse cx="12" cy="15.4" rx="3.2" ry="2.2" fill="#fff8ec" opacity=".85"/><path d="M7.6 11c1-1.5 2.4-2.2 3.8-2.3" stroke="#fff8ec" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>',
};
const CHARGE_C = 2 * Math.PI * 15.5;

export interface CrestInfo { id: number; name: string; team: TeamId; alive: boolean; respawnIn: number; special: number; you: boolean }
export interface DotInfo { x: number; z: number; team: TeamId; show: boolean }

export interface HudFrame {
  phase: 'countdown' | 'live' | 'ended';
  timeLeft: number;
  countdown: number;
  coverage: Coverage;
  tank: number;
  hp: number;
  alive: boolean;
  /** SLICK form: the reticle dims (no firing) */
  slick: boolean;
  firing: boolean;
  x: number; z: number; yaw: number;
  special: number;
  crests: readonly CrestInfo[];
  dots: readonly DotInfo[];
  /** seconds until the human respawns (death slate ring) */
  respawnIn: number;
  /** phase 6: NEEDLE-GLINT charge 0..1 · the special is ready (meter full + 'ready' fired) · the sub can be thrown */
  charge?: number;
  specialReady?: boolean;
  subReady?: boolean;
}

/**
 * Tug-of-war widths (fractions of the bar) for the weighted coverage fractions: the two fills keep the
 * exact ratio of the crews' coverage; their combined length is ∛painted, so small coverage is still
 * visible. Any non-zero crew gets at least 2 %.
 */
export function coverageBar(sun: number, gulf: number): { sun: number; gulf: number } {
  const s = Math.max(0, sun), g = Math.max(0, gulf);
  const painted = s + g;
  if (!(painted > 0)) return { sun: 0, gulf: 0 };
  const total = Math.min(1, Math.cbrt(Math.min(1, painted)));
  let ws = total * (s / painted), wg = total * (g / painted);
  const MIN = 0.02;
  if (s > 0 && ws < MIN) ws = MIN;
  if (g > 0 && wg < MIN) wg = MIN;
  const over = ws + wg - 1;
  if (over > 0) { if (ws >= wg) ws -= over; else wg -= over; }
  return { sun: ws, gulf: wg };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** push teams.json colors into the CSS variables the stylesheet uses */
export function applyTeamCssVars(): void {
  const r = document.documentElement.style;
  for (const t of TEAMS) {
    r.setProperty(`--${t.key}`, t.ui);
    r.setProperty(`--${t.key}-ink`, t.uiInk);
    r.setProperty(`--${t.key}-dye`, t.dye);
  }
}

const teamKey = (t: TeamId): 'sun' | 'gulf' => (t === 2 ? 'gulf' : 'sun');

interface CrestEl { box: HTMLElement; mark: HTMLElement; num: HTMLElement; alive: boolean; n: number; ready: boolean }
interface DotEl { e: HTMLElement; on: boolean; tx: string }
interface FeedEntry { e: HTMLElement; t: number }

export class Hud {
  readonly root: HTMLElement;
  readonly slates: Slates;
  debugVisible = false;
  onResume: (() => void) | null = null;
  private readonly team: TeamId;
  private readonly mini: MinimapRaster | null;
  private readonly miniCanvas: HTMLCanvasElement;
  private readonly miniCtx: CanvasRenderingContext2D | null;
  private readonly miniImage: ImageData | null;
  private readonly miniView: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly miniScale: number;
  private readonly timer: HTMLElement;
  private readonly timerText: HTMLElement;
  private readonly crests: CrestEl[] = [];
  private readonly sunFill: HTMLElement;
  private readonly gulfFill: HTMLElement;
  private readonly gauge: HTMLElement;
  private readonly gaugeFill: HTMLElement;
  private readonly gaugeKey: HTMLElement;
  private readonly kit: HudKit | null;
  private readonly sub: HTMLElement;
  private readonly chargeRing: SVGCircleElement | null;
  private lastReady = false;
  private lastSub: boolean | null = null;
  private lastCharge = -1;
  private readonly feed: HTMLElement;
  private readonly feedItems: FeedEntry[] = [];
  private readonly tankFill: HTMLElement;
  private readonly tankBox: HTMLElement;
  private readonly ret: HTMLElement;
  private readonly hitMark: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly dots: DotEl[] = [];
  private readonly debug: HTMLElement;
  private readonly debugBody: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly pauseMsg: HTMLElement;
  private debugClock = 0;
  private lastTimer = '';
  private lastCov = '';
  private lastTank = -1;
  private lastGauge = -1;
  private toastT = 0;
  private hitT = 0;
  private hurt = 0;
  private lastVig = -1;
  private clock = 0;
  private lastPhase = '';
  private final10 = false;
  private retSlick = false;
  private retFiring = false;
  private lastHpLow = false;
  private lastArrow = '';
  private arrowAlive = true;
  private readonly pxy: [number, number] = [0, 0];
  private lastHide = false;

  constructor(host: HTMLElement, o: { team: TeamId; minimap: MinimapRaster | null; specialName?: string; roster?: ReadonlyArray<{ id: number; name: string; team: TeamId }>; youId?: number; kit?: HudKit }) {
    this.team = o.team;
    this.kit = o.kit ?? null;
    this.mini = o.minimap;
    this.root = el('div', 'df-hud');
    const sun = teamById(1), gulf = teamById(2);

    // ── top centre: crests · timer · crests, tug bar
    const top = el('div', 'df-top');
    const sunRow = el('div', 'df-crests sun');
    const gulfRow = el('div', 'df-crests gulf');
    const roster = o.roster ?? [];
    const mkCrest = (id: number, team: TeamId, name: string): CrestEl => {
      const box = el('div', `df-crest ${teamKey(team)}${id === (o.youId ?? 0) ? ' you' : ''}`);
      box.title = name;
      const mark = el('span', 'mark', teamById(team).markGlyph);
      const num = el('span', 'num', '');
      box.append(mark, num);
      return { box, mark, num, alive: true, n: -1, ready: false };
    };
    for (const t of [1, 2] as TeamId[]) {
      const mem = roster.filter((r) => r.team === t);
      const list = mem.length ? mem : [0, 1, 2, 3].map((i) => ({ id: (t - 1) * 4 + i, name: '', team: t }));
      for (const r of list) {
        const c = mkCrest(r.id, t, r.name);
        this.crests[r.id] = c;
        (t === 1 ? sunRow : gulfRow).append(c.box);
      }
    }
    this.timer = el('div', 'df-timer');
    this.timerText = el('span', '', '3:00');
    this.timer.append(this.timerText);
    const mid = el('div', 'df-top-mid');
    const tug = el('div', 'df-tug');
    tug.setAttribute('aria-hidden', 'true');
    this.sunFill = el('div', 'fill sun');
    this.gulfFill = el('div', 'fill gulf');
    const tm1 = el('i', 'm sun', sun.markGlyph), tm2 = el('i', 'm gulf', gulf.markGlyph);
    tug.append(this.sunFill, this.gulfFill, tm1, tm2);
    mid.append(this.timer, tug);
    top.append(sunRow, mid, gulfRow);

    // ── top right: special gauge + kill feed
    const right = el('div', 'df-right');
    this.gauge = el('div', `df-gauge ${teamKey(this.team)}`);
    this.gaugeFill = el('b', 'fill');
    const gIcon = el('i', 'icon');
    gIcon.innerHTML = ICONS[this.kit?.specialId ?? ''] ?? '';
    const gLabel = el('span', 'label', this.kit?.specialName ?? o.specialName ?? '');
    this.gaugeKey = el('kbd', 'key', this.kit?.specialKey ?? '');
    this.gaugeKey.setAttribute('aria-label', `press ${this.kit?.specialKey ?? ''}`);
    this.gauge.append(this.gaugeFill, gIcon, gLabel, this.gaugeKey);
    if (!this.kit?.specialKey) this.gaugeKey.hidden = true;
    this.feed = el('div', 'df-feed');
    this.feed.setAttribute('aria-live', 'polite');
    right.append(this.gauge, this.feed);

    // ── minimap
    const miniBox = el('div', 'df-mini');
    this.miniView = el('div', 'df-mini-view' + (this.team === 2 ? ' gulf' : ''));
    this.miniCanvas = el('canvas');
    this.miniCanvas.id = 'df-minimap';
    const w = this.mini?.w ?? 180, h = this.mini?.h ?? 264;
    this.miniCanvas.width = w;
    this.miniCanvas.height = h;
    this.miniScale = Math.min(190 / w, 250 / h);
    this.miniView.style.width = `${Math.round(w * this.miniScale)}px`;
    this.miniView.style.height = `${Math.round(h * this.miniScale)}px`;
    this.miniCtx = this.miniCanvas.getContext('2d', { willReadFrequently: true });
    this.miniImage = this.mini && this.miniCtx ? new ImageData(this.mini.rgba as unknown as Uint8ClampedArray<ArrayBuffer>, this.mini.w, this.mini.h) : null;
    const dotLayer = el('div', 'df-mini-dots');
    for (let i = 0; i < 8; i++) {
      const e = el('i', 'df-dot');
      e.hidden = true;
      dotLayer.append(e);
      this.dots.push({ e, on: false, tx: '' });
    }
    this.arrow = el('div', 'df-mini-arrow');
    const tcol = teamById(this.team === 2 ? 2 : 1);
    this.arrow.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 L17.5 17.5 L10 13.2 L2.5 17.5 Z" fill="${tcol.ui}" stroke="#14203a" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
    this.miniView.append(this.miniCanvas, dotLayer, this.arrow);
    miniBox.append(this.miniView);

    // ── reticle + tank pipette + hit marker
    this.ret = el('div', 'df-ret');
    this.ret.innerHTML = '<svg viewBox="-17 -17 34 34" aria-hidden="true">'
      + '<circle class="ring" r="11" fill="none" stroke="#fff8ec" stroke-width="3.2"/>'
      + '<circle r="11" fill="none" stroke="#14203a" stroke-width="1.2" opacity=".75"/>'
      + '<circle r="2.6" fill="#fff8ec" stroke="#14203a" stroke-width="1.2"/>'
      + '<circle class="charge-bg" r="15.5" fill="none" stroke="rgba(20,32,58,.55)" stroke-width="5"/>'
      + `<circle class="charge" r="15.5" fill="none" stroke="${this.team === 2 ? 'var(--gulf)' : 'var(--sun)'}" stroke-width="3.2" stroke-linecap="round" transform="rotate(-90)" stroke-dasharray="0 ${CHARGE_C.toFixed(2)}"/></svg>`;
    this.chargeRing = this.ret.querySelector('circle.charge');
    this.hitMark = el('div', 'df-hitmark');
    this.hitMark.innerHTML = '<svg viewBox="-20 -20 40 40" aria-hidden="true"><path d="M-14 -14 L-6 -6 M14 -14 L6 -6 M-14 14 L-6 6 M14 14 L6 6" stroke="#fff8ec" stroke-width="4.2" stroke-linecap="round"/>'
      + '<path d="M-14 -14 L-6 -6 M14 -14 L6 -6 M-14 14 L-6 6 M14 14 L6 6" stroke="#14203a" stroke-width="1.4" stroke-linecap="round" opacity=".6"/></svg>';
    this.tankBox = el('div', 'df-tank' + (this.team === 2 ? ' gulf' : ''));
    this.tankFill = el('div', 'df-tank-fill');
    const tankLine = el('div', 'df-tank-low');
    this.tankBox.append(this.tankFill, tankLine);
    if (this.kit && this.kit.subCost > 0 && this.kit.subCost < 100) {
      const subLine = el('div', 'df-tank-sub');
      subLine.style.bottom = `${this.kit.subCost}%`;
      this.tankBox.append(subLine);
    }
    const tankLabel = el('div', 'df-tank-label', 'TANK');
    // sub chip (JELLY CHARGE): greys out below the sub cost
    this.sub = el('div', `df-sub ${teamKey(this.team)} grey`);
    this.sub.innerHTML = ICONS.jelly;
    this.sub.title = this.kit?.subName ?? '';
    const subKey = el('kbd', 'key', this.kit?.subKey ?? '');
    this.sub.append(subKey);
    if (!this.kit) this.sub.hidden = true;

    // ── low-tank toast
    this.toast = el('div', 'df-toast', LOW_TANK_TOAST);
    this.toast.hidden = true;
    this.toast.setAttribute('role', 'status');

    // ── damage vignette
    this.vignette = el('div', 'df-vignette');

    // ── debug panel
    this.debug = el('div', 'df-debug');
    this.debug.hidden = true;
    this.debug.append(el('h4', '', 'DEBUG · F1'));
    this.debugBody = el('table');
    this.debug.append(this.debugBody);

    // ── pause overlay
    this.pause = el('div', 'df-pause');
    this.pause.hidden = true;
    const pc = el('div', 'df-pause-card');
    const resume = el('button', 'df-btn', 'RESUME');
    resume.type = 'button';
    resume.id = 'df-resume';
    this.pauseMsg = el('p', '', '');
    pc.append(el('h2', '', 'PAUSED'), resume, this.pauseMsg);
    this.pause.append(pc);
    resume.addEventListener('click', (e) => { e.stopPropagation(); this.onResume?.(); });

    this.root.append(this.vignette, top, right, miniBox, this.ret, this.hitMark, this.tankBox, tankLabel, this.sub, this.toast, this.debug);
    host.append(this.root);
    this.slates = new Slates(host);
    host.append(this.pause);
    this.redrawMinimap(true);
  }

  show(on: boolean): void {
    this.root.classList.toggle('on', on);
    this.slates.root.classList.toggle('on', on);
  }

  toggleDebug(force?: boolean): boolean {
    this.debugVisible = force ?? !this.debugVisible;
    this.debug.hidden = !this.debugVisible;
    this.debugClock = 1e9;
    return this.debugVisible;
  }

  setPaused(on: boolean, msg = ''): void {
    this.pause.hidden = !on;
    this.pauseMsg.textContent = msg;
    this.pauseMsg.hidden = !msg;
  }

  // ───────────────────────────── events ─────────────────────────────
  /** kill feed: `{A} washed {B}`; a sea death (a = null) shows {B} with the wave icon */
  killFeed(a: { name: string; team: TeamId } | null, b: { name: string; team: TeamId }): void {
    const e = el('div', 'df-feed-item');
    const who = (p: { name: string; team: TeamId }): HTMLElement => {
      const s = el('span', `who ${teamKey(p.team)}`);
      const m = el('i', '', teamById(p.team).markGlyph);
      m.setAttribute('aria-hidden', 'true');
      s.append(m, el('b', '', p.name));
      return s;
    };
    if (a) e.append(who(a), el('span', 'verb', FEED_VERB), who(b));
    else { e.classList.add('sea'); e.append(waveIcon('df-wave'), who(b)); }
    this.feed.prepend(e);
    this.feedItems.unshift({ e, t: this.clock });
    while (this.feedItems.length > 5) this.feedItems.pop()!.e.remove();
  }

  lowTank(): void {
    this.toastT = 2.6;
    if (this.toast.hidden) {
      this.toast.hidden = false;
      this.toast.classList.remove('in'); void this.toast.offsetWidth; this.toast.classList.add('in');
    }
  }

  /** the empty-tank click: the pipette flashes, the reticle shakes, the toast shows */
  dry(): void {
    for (const e of [this.tankBox, this.ret]) { e.classList.remove('dry'); void e.offsetWidth; e.classList.add('dry'); }
    this.lowTank();
  }

  /** the special just became ready: a pop on the gauge (the pulse + key badge follow from the frame) */
  specialReady(): void {
    this.gauge.classList.remove('pop'); void this.gauge.offsetWidth; this.gauge.classList.add('pop');
  }

  hitMarker(washed = false): void {
    this.hitT = washed ? 0.4 : 0.2;
    this.hitMark.classList.toggle('big', washed);
    this.hitMark.classList.remove('on'); void this.hitMark.offsetWidth; this.hitMark.classList.add('on');
  }

  /** the human took a hit from `team`'s dye */
  damaged(team: TeamId): void {
    this.hurt = 1;
    this.vignette.dataset.team = teamKey(team);
  }

  showDeath(name: string | null, team: TeamId | null, seconds: number): void { this.slates.showDeath(name, team, seconds); }
  hideDeath(): void { this.slates.hideDeath(); }
  showVictory(v: VictoryInfo, onAgain: () => void): void { this.slates.showVictory(v, onAgain); }
  hideVictory(): void { this.slates.hideVictory(); }

  /** clear transient state (match restart) */
  reset(): void {
    for (const f of this.feedItems) f.e.remove();
    this.feedItems.length = 0;
    this.toastT = 0; this.toast.hidden = true;
    this.hurt = 0; this.hitT = 0;
    this.hideDeath();
    this.hideVictory();
    this.lastPhase = '';
    this.redrawMinimap(true);
  }

  // ───────────────────────────── per frame ─────────────────────────────
  update(dt: number, f: HudFrame, dbg: () => HudDebug): void {
    this.clock += dt;
    // timer pill
    const shown = f.phase === 'ended' ? 0 : Math.max(0, Math.ceil(f.timeLeft - 1e-6));
    const txt = `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
    if (txt !== this.lastTimer) {
      this.lastTimer = txt;
      this.timerText.textContent = txt;
      const fin = f.phase === 'live' && f.timeLeft <= 10;
      if (fin !== this.final10) { this.final10 = fin; this.timer.classList.toggle('final', fin); }
      if (fin) { this.timer.classList.remove('tick'); void this.timer.offsetWidth; this.timer.classList.add('tick'); }
    }
    if (f.phase !== this.lastPhase) {
      this.lastPhase = f.phase;
      this.root.dataset.phase = f.phase;
    }
    this.slates.countdown(f.phase === 'countdown' ? Math.ceil(f.countdown - 1e-6) : 0);

    // crests
    for (const c of f.crests) {
      const ce = this.crests[c.id];
      if (!ce) continue;
      if (c.alive !== ce.alive) {
        ce.alive = c.alive;
        ce.box.classList.toggle('down', !c.alive);
        ce.mark.textContent = c.alive ? teamById(c.team).markGlyph : '✕';
      }
      const n = c.alive ? -1 : Math.max(0, Math.ceil(c.respawnIn - 1e-3));
      if (n !== ce.n) { ce.n = n; ce.num.textContent = n >= 0 ? String(n) : ''; }
      const ready = c.alive && c.special >= 1;
      if (ready !== ce.ready) { ce.ready = ready; ce.box.classList.toggle('ready', ready); }
    }

    // tug bar
    const cov = f.coverage;
    const key = `${(cov.sun * 1000).toFixed(0)}|${(cov.gulf * 1000).toFixed(0)}`;
    if (key !== this.lastCov) {
      this.lastCov = key;
      const w = coverageBar(cov.sun, cov.gulf);
      this.sunFill.style.width = `${(w.sun * 100).toFixed(2)}%`;
      this.gulfFill.style.width = `${(w.gulf * 100).toFixed(2)}%`;
    }

    // special gauge: fill; at 100 % (ready) a pulse + the key badge
    const g = Math.round(Math.max(0, Math.min(1, f.special)) * 100);
    if (g !== this.lastGauge) {
      this.lastGauge = g;
      this.gaugeFill.style.width = `${g}%`;
    }
    const ready = (f.specialReady ?? g >= 100) && g >= 100;
    if (ready !== this.lastReady) {
      this.lastReady = ready;
      this.gauge.classList.toggle('full', ready);
    }

    // sub chip: grey below the sub cost (or while the throw cools down / washed)
    const subOk = !!f.subReady && f.alive && f.phase !== 'ended';
    if (subOk !== this.lastSub) { this.lastSub = subOk; this.sub.classList.toggle('grey', !subOk); }

    // NEEDLE-GLINT charge ring
    if (this.chargeRing && this.kit?.fire === 'charge') {
      const c = Math.round(Math.max(0, Math.min(1, f.charge ?? 0)) * 100);
      if (c !== this.lastCharge) {
        this.lastCharge = c;
        this.chargeRing.setAttribute('stroke-dasharray', `${((c / 100) * CHARGE_C).toFixed(2)} ${CHARGE_C.toFixed(2)}`);
        this.ret.classList.toggle('charging', c > 0);
        this.ret.classList.toggle('charged', c >= 100);
      }
    }

    // kill feed ageing
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const it = this.feedItems[i];
      const age = this.clock - it.t;
      if (age > 6) { it.e.remove(); this.feedItems.splice(i, 1); }
      else if (age > 5 && !it.e.classList.contains('out')) it.e.classList.add('out');
    }

    // tank pipette + reticle
    const tank = Math.round(Math.max(0, Math.min(100, f.tank)));
    if (tank !== this.lastTank) {
      this.lastTank = tank;
      this.tankFill.style.height = `${tank}%`;
      this.tankBox.classList.toggle('low', tank <= 20);
    }
    if (f.slick !== this.retSlick) { this.retSlick = f.slick; this.ret.classList.toggle('slick', f.slick); this.tankBox.classList.toggle('drink', f.slick); }
    if (f.firing !== this.retFiring) { this.retFiring = f.firing; this.ret.classList.toggle('firing', f.firing); }
    const hidden = !f.alive || f.phase === 'ended';
    if (hidden !== this.lastHide) {
      this.lastHide = hidden;
      this.ret.classList.toggle('off', hidden);
      this.tankBox.classList.toggle('off', hidden);
      this.sub.classList.toggle('off', hidden);
    }

    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.hitMark.classList.remove('on'); }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0 || f.slick) { this.toastT = 0; this.toast.hidden = true; }
    }

    // damage vignette: a hit flash + low HP
    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    const lowHp = f.alive ? Math.max(0, 1 - f.hp / 100) : 0;
    const vig = Math.round(Math.min(1, Math.max(this.hurt * 0.85, lowHp * 0.55)) * 100) / 100;
    if (vig !== this.lastVig) { this.lastVig = vig; this.vignette.style.opacity = String(vig); }
    const hpLow = f.alive && f.hp < 60;
    if (hpLow !== this.lastHpLow) { this.lastHpLow = hpLow; this.vignette.classList.toggle('pulse', hpLow); }

    // death slate ring
    if (this.slates.deathVisible) this.slates.updateDeath(f.respawnIn);

    // minimap + arrow + dots
    this.redrawMinimap(false);
    if (this.mini) {
      const gulf = this.team === 2;
      this.place(f.x, f.z);
      const rot = -f.yaw + (gulf ? Math.PI : 0);
      const at = `translate(${this.pxy[0].toFixed(1)}px, ${this.pxy[1].toFixed(1)}px) rotate(${rot.toFixed(2)}rad)`;
      if (at !== this.lastArrow) { this.lastArrow = at; this.arrow.style.transform = at; }
      if (f.alive !== this.arrowAlive) { this.arrowAlive = f.alive; this.arrow.classList.toggle('dead', !f.alive); }
      for (let i = 0; i < this.dots.length; i++) {
        const d = this.dots[i];
        const info = f.dots[i];
        const on = !!info && info.show;
        if (on) {
          this.place(info.x, info.z);
          const tx = `translate(${this.pxy[0].toFixed(0)}px, ${this.pxy[1].toFixed(0)}px)`;
          if (tx !== d.tx) { d.tx = tx; d.e.style.transform = tx; }
          const cls = `df-dot ${teamKey(info.team)}${info.team !== this.team ? ' foe' : ''}`;
          if (d.e.className !== cls) d.e.className = cls;
        }
        if (on !== d.on) { d.on = on; d.e.hidden = !on; }
      }
    }

    if (this.debugVisible) {
      this.debugClock += dt;
      if (this.debugClock >= 0.2) {
        this.debugClock = 0;
        this.renderDebug(dbg());
      }
    }
  }

  /** world (x, z) → minimap CSS px (SUNCREW orientation; rotated 180° for a GULF CREW viewer) → this.pxy */
  private place(x: number, z: number): void {
    const m = this.mini!;
    const [px, py] = m.worldToPixel(x, z);
    const gulf = this.team === 2;
    this.pxy[0] = (gulf ? m.w - px : px) * this.miniScale;
    this.pxy[1] = (gulf ? m.h - py : py) * this.miniScale;
  }

  private redrawMinimap(force: boolean): void {
    if (!this.mini || !this.miniCtx || !this.miniImage) return;
    if (!force && !this.mini.dirty) return;
    this.miniCtx.putImageData(this.miniImage, 0, 0);
    this.mini.dirty = false;
  }

  /** RGBA of the DOM minimap canvas pixel under a world point (harness read-back). */
  minimapPixel(x: number, z: number): { px: number; py: number; rgba: number[] } | null {
    if (!this.mini || !this.miniCtx) return null;
    const [px, py] = this.mini.worldToPixel(x, z);
    const ix = Math.max(0, Math.min(this.mini.w - 1, Math.floor(px)));
    const iy = Math.max(0, Math.min(this.mini.h - 1, Math.floor(py)));
    const d = this.miniCtx.getImageData(ix, iy, 1, 1).data;
    return { px: ix, py: iy, rgba: [d[0], d[1], d[2], d[3]] };
  }

  /** visible HUD text (harness read-back): timer, toast, feed, slates, crest states */
  readback(): Record<string, unknown> {
    return {
      timer: this.timerText.textContent,
      final10: this.final10,
      toast: this.toast.hidden ? null : this.toast.textContent,
      feed: this.feedItems.map((f) => f.e.textContent),
      crests: this.crests.filter(Boolean).map((c) => ({ alive: c.alive, text: c.box.textContent })),
      gauge: this.lastGauge,
      special: { pct: this.lastGauge, ready: this.gauge.classList.contains('full'), name: this.kit?.specialName ?? null,
        key: this.gaugeKey.hidden ? null : this.gaugeKey.textContent, icon: this.kit?.specialId ?? null },
      sub: { ready: this.lastSub === true, grey: this.sub.classList.contains('grey'), key: this.kit?.subKey ?? null, cost: this.kit?.subCost ?? null },
      charge: this.kit?.fire === 'charge' ? Math.max(0, this.lastCharge) : null,
      tank: this.lastTank,
      dots: this.dots.filter((d) => d.on).length,
      ...this.slates.text(),
    };
  }

  private renderDebug(d: HudDebug): void {
    const rows: Array<[string, string]> = [
      ['match', d.match ?? '—'],
      ['coverage', `◉ ${(d.coverage.sun * 100).toFixed(2)}%  ▲ ${(d.coverage.gulf * 100).toFixed(2)}%`],
      ['tank · hp', `${d.tank.toFixed(0)} / 100 · ${(d.hp ?? 100).toFixed(0)} hp`],
      ['map', d.mapId],
      ['fps', d.fps.toFixed(0)],
      ['render scale', `${d.scale.toFixed(2)}× ${d.quality} (${d.scaleMin.toFixed(2)}–${d.scaleMax.toFixed(2)}) · ${d.buffer[0]}×${d.buffer[1]}`],
      ['frame p90', d.p90 > 0 ? `${d.p90.toFixed(1)} ms · target ${d.targetMs.toFixed(1)} ms` : `— · target ${d.targetMs.toFixed(1)} ms`],
      ['move', `${d.state}${d.grounded ? ' · grounded' : ''} · ${d.speed.toFixed(1)} m/s`],
      ['anim', d.anim],
      ['runners', d.runners ?? '—'],
      ['projectiles', String(d.projectiles ?? 0)],
      ['particles', (d.particles ?? 0).toLocaleString('en-US')],
      ['atlas', `${d.atlasSize}² · ${d.atlasCount.toLocaleString('en-US')} texels`],
      ['flips', d.flips.toLocaleString('en-US')],
      ['draw calls', String(d.calls)],
      ['triangles', d.triangles.toLocaleString('en-US')],
      ['programs', String(d.programs)],
      ['tick', String(d.tick)],
      ['pos', `${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)}`],
      ['pointer', d.pointerLock ? 'locked' : 'free'],
    ];
    const frag = document.createDocumentFragment();
    for (const [k, v] of rows) {
      const tr = el('tr');
      tr.append(el('td', '', k), el('td', '', v));
      frag.append(tr);
    }
    this.debugBody.replaceChildren(frag);
  }
}
