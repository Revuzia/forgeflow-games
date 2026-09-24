// DYEFIELD — HUD (CONTRACT §5.1 ui/hud.ts). Chunky toy-bright DOM over the canvas:
//   top centre   coverage bar  ◉ SUNCREW % | tug-of-war bar | ▲ GULF CREW %  (see coverageBar())
//   bottom left  minimap canvas (MinimapRaster.rgba → putImageData only when dirty) + player arrow
//   centre       reticle + tank pipette
//   bottom centre the phase-2 dev hint
//   F1           debug panel (coverage, tank, map, fps, move state, atlas, draw calls, triangles)
//   pause        PAUSED + RESUME overlay
// The minimap is rendered in the SUNCREW orientation (screen-up = +Z, screen-right = −X — CONTRACT
// §4.7) and rotated 180° for a GULF CREW viewer. The arrow is a separate element, so the canvas
// pixels under the runner stay pure paint state (the harness reads them back).

import type { Coverage, MoveState, TeamId } from '../core/types.ts';
import { TEAMS, teamById } from '../core/data.ts';
import type { MinimapRaster } from '../core/paint/minimap.ts';

export const DEV_HINT = 'HOLD LMB — dye the tiles under your feet · WASD move · SPACE jump · F1 debug';

export interface HudDebug {
  coverage: Coverage; tank: number; mapId: string; fps: number; state: MoveState; grounded: boolean;
  atlasSize: number; atlasCount: number; overlaps: number; calls: number; triangles: number;
  programs: number; tick: number; x: number; y: number; z: number; flips: number; speed: number;
  anim: string; pointerLock: boolean;
  /** adaptive render resolution (view/renderer.ts) */
  scale: number; scaleMin: number; scaleMax: number; quality: string; buffer: [number, number];
  p90: number; targetMs: number;
}

/**
 * Tug-of-war widths (fractions of the bar) for the weighted coverage fractions. SUNCREW fills from
 * the left, GULF CREW from the right, the unpainted middle stays neutral. The two fills keep the
 * exact ratio of the teams' coverage (the comparison stays honest); their combined length is the
 * cube root of the painted fraction, so small coverage is still visible (one 6 m brushed trail ≈ 0.35 %
 * painted → 15 % of the bar, 1 % → 22 %, 10 % → 46 %, 50 % → 79 %, all painted → the full bar) and the
 * neutral middle keeps shrinking visibly through a whole match. Any non-zero team gets at least 2 %.
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

const pct = (f: number): string => {
  const v = Math.max(0, f * 100);
  return v >= 10 ? `${v.toFixed(0)}%` : `${v.toFixed(1)}%`;
};

/** push teams.json colors into the CSS variables the stylesheet uses */
export function applyTeamCssVars(): void {
  const r = document.documentElement.style;
  for (const t of TEAMS) {
    r.setProperty(`--${t.key}`, t.ui);
    r.setProperty(`--${t.key}-ink`, t.uiInk);
    r.setProperty(`--${t.key}-dye`, t.dye);
  }
}

export class Hud {
  readonly root: HTMLElement;
  debugVisible = false;
  private readonly team: TeamId;
  private readonly mini: MinimapRaster | null;
  private readonly miniCanvas: HTMLCanvasElement;
  private readonly miniCtx: CanvasRenderingContext2D | null;
  private readonly miniImage: ImageData | null;
  private readonly miniView: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly miniScale: number;
  private readonly sunPct: HTMLElement;
  private readonly gulfPct: HTMLElement;
  private readonly sunFill: HTMLElement;
  private readonly gulfFill: HTMLElement;
  private readonly covBar: HTMLElement;
  private readonly tankFill: HTMLElement;
  private readonly tankBox: HTMLElement;
  private readonly ret: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly debugBody: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly pauseMsg: HTMLElement;
  private debugClock = 0;
  private lastCov = '';
  private lastTank = -1;

  constructor(host: HTMLElement, o: { team: TeamId; minimap: MinimapRaster | null }) {
    this.team = o.team;
    this.mini = o.minimap;
    this.root = el('div', 'df-hud');
    const sun = teamById(1), gulf = teamById(2);

    // ── coverage bar
    const cov = el('div', 'df-cov');
    const sunTag = el('div', 'df-cov-team sun');
    const sunMark = el('span', 'mark', sun.markGlyph); sunMark.setAttribute('aria-hidden', 'true');
    this.sunPct = el('span', 'pct', '0%');
    sunTag.append(sunMark, el('span', 'name', sun.name), this.sunPct);
    const gulfTag = el('div', 'df-cov-team gulf');
    const gulfMark = el('span', 'mark', gulf.markGlyph); gulfMark.setAttribute('aria-hidden', 'true');
    this.gulfPct = el('span', 'pct', '0%');
    gulfTag.append(gulfMark, el('span', 'name', gulf.name), this.gulfPct);
    const bar = el('div', 'df-cov-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${sun.name} 0% · ${gulf.name} 0%`);
    this.covBar = bar;
    this.sunFill = el('div', 'df-cov-fill sun');
    this.gulfFill = el('div', 'df-cov-fill gulf');
    // the crews' shape marks ride the leading edge of each fill (colorblind-safe: shape + color)
    const sunTip = el('span', 'tip', sun.markGlyph); sunTip.setAttribute('aria-hidden', 'true');
    const gulfTip = el('span', 'tip', gulf.markGlyph); gulfTip.setAttribute('aria-hidden', 'true');
    this.sunFill.append(sunTip);
    this.gulfFill.append(gulfTip);
    bar.append(this.sunFill, this.gulfFill, el('div', 'df-cov-mid'));
    cov.append(sunTag, bar, gulfTag);

    // ── minimap
    const miniBox = el('div', 'df-mini');
    this.miniView = el('div', 'df-mini-view' + (this.team === 2 ? ' gulf' : ''));
    this.miniCanvas = el('canvas');
    this.miniCanvas.id = 'df-minimap';
    const w = this.mini?.w ?? 180, h = this.mini?.h ?? 264;
    this.miniCanvas.width = w;
    this.miniCanvas.height = h;
    const maxW = 190, maxH = 250;
    this.miniScale = Math.min(maxW / w, maxH / h);
    this.miniView.style.width = `${Math.round(w * this.miniScale)}px`;
    this.miniView.style.height = `${Math.round(h * this.miniScale)}px`;
    this.miniCtx = this.miniCanvas.getContext('2d', { willReadFrequently: true });
    this.miniImage = this.mini && this.miniCtx ? new ImageData(this.mini.rgba as unknown as Uint8ClampedArray<ArrayBuffer>, this.mini.w, this.mini.h) : null;
    this.arrow = el('div', 'df-mini-arrow');
    const tcol = teamById(this.team === 2 ? 2 : 1);
    this.arrow.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 L17.5 17.5 L10 13.2 L2.5 17.5 Z" fill="${tcol.ui}" stroke="#14203a" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
    this.miniView.append(this.miniCanvas, this.arrow);
    miniBox.append(this.miniView);

    // ── reticle + tank pipette
    this.ret = el('div', 'df-ret');
    this.ret.innerHTML = '<svg viewBox="-17 -17 34 34" aria-hidden="true">'
      + '<circle class="ring" r="11" fill="none" stroke="#fff8ec" stroke-width="3.2"/>'
      + '<circle r="11" fill="none" stroke="#14203a" stroke-width="1.2" opacity=".75"/>'
      + '<circle r="2.6" fill="#fff8ec" stroke="#14203a" stroke-width="1.2"/></svg>';
    this.tankBox = el('div', 'df-tank' + (this.team === 2 ? ' gulf' : ''));
    this.tankFill = el('div', 'df-tank-fill');
    this.tankBox.append(this.tankFill);
    const tankLabel = el('div', 'df-tank-label', 'TANK');

    // ── dev hint
    const hint = el('div', 'df-hint');
    hint.id = 'df-hint';
    hint.textContent = DEV_HINT;

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
    this.onResume = null;
    resume.addEventListener('click', (e) => { e.stopPropagation(); this.onResume?.(); });

    this.root.append(cov, miniBox, this.ret, this.tankBox, tankLabel, hint, this.debug);
    host.append(this.root, this.pause);
    this.redrawMinimap(true);
  }

  onResume: (() => void) | null;

  show(on: boolean): void { this.root.classList.toggle('on', on); }

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

  /** per rendered frame */
  update(dt: number, s: { coverage: Coverage; tank: number; x: number; z: number; yaw: number; brushing: boolean }, dbg: () => HudDebug): void {
    const c = s.coverage;
    const key = `${pct(c.sun)}|${pct(c.gulf)}`;
    if (key !== this.lastCov) {
      this.lastCov = key;
      this.sunPct.textContent = pct(c.sun);
      this.gulfPct.textContent = pct(c.gulf);
      const w = coverageBar(c.sun, c.gulf);
      this.sunFill.style.width = `${(w.sun * 100).toFixed(2)}%`;
      this.gulfFill.style.width = `${(w.gulf * 100).toFixed(2)}%`;
      // the mark shows once its fill is wide enough to hold it
      this.sunFill.classList.toggle('wide', w.sun >= 0.07);
      this.gulfFill.classList.toggle('wide', w.gulf >= 0.07);
      this.covBar.setAttribute('aria-label', `${teamById(1).name} ${pct(c.sun)} · ${teamById(2).name} ${pct(c.gulf)}`);
    }
    const tank = Math.round(Math.max(0, Math.min(100, s.tank)));
    if (tank !== this.lastTank) { this.lastTank = tank; this.tankFill.style.height = `${tank}%`; }
    this.ret.classList.toggle('brushing', s.brushing);

    this.redrawMinimap(false);
    if (this.mini) {
      const [px, py] = this.mini.worldToPixel(s.x, s.z);
      const gulf = this.team === 2;
      const vx = gulf ? this.mini.w - px : px;
      const vy = gulf ? this.mini.h - py : py;
      const rot = -s.yaw + (gulf ? Math.PI : 0);
      this.arrow.style.transform = `translate(${(vx * this.miniScale).toFixed(1)}px, ${(vy * this.miniScale).toFixed(1)}px) rotate(${rot.toFixed(3)}rad)`;
    }

    if (this.debugVisible) {
      this.debugClock += dt;
      if (this.debugClock >= 0.2) {
        this.debugClock = 0;
        this.renderDebug(dbg());
      }
    }
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

  private renderDebug(d: HudDebug): void {
    const rows: Array<[string, string]> = [
      ['coverage', `◉ ${(d.coverage.sun * 100).toFixed(2)}%  ▲ ${(d.coverage.gulf * 100).toFixed(2)}%`],
      ['tank', `${d.tank.toFixed(0)} / 100`],
      ['map', d.mapId],
      ['fps', d.fps.toFixed(0)],
      ['render scale', `${d.scale.toFixed(2)}× ${d.quality} (${d.scaleMin.toFixed(2)}–${d.scaleMax.toFixed(2)}) · ${d.buffer[0]}×${d.buffer[1]}`],
      ['frame p90', d.p90 > 0 ? `${d.p90.toFixed(1)} ms · target ${d.targetMs.toFixed(1)} ms` : `— · target ${d.targetMs.toFixed(1)} ms`],
      ['move', `${d.state}${d.grounded ? ' · grounded' : ''} · ${d.speed.toFixed(1)} m/s`],
      ['anim', d.anim],
      ['atlas', `${d.atlasSize}² · ${d.atlasCount.toLocaleString('en-US')} texels`],
      ['overlaps', `${d.overlaps.toLocaleString('en-US')}`],
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
