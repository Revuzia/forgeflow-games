// DYEFIELD — match HUD (CONTRACT §11, DESIGN §2 "HUD rhythm"). Chunky toy-bright DOM over the canvas,
// Lilita One + Nunito. Only the brief's strings are shown (DESIGN §1):
//   top centre    4 SUNCREW crests (◉) · timer pill 3:00 → 0:00 (pulses in the final 10) · 4 GULF CREW
//                 crests (▲); a downed crest shows ✕ plus its respawn count. A slim unlabeled tug bar
//                 under the pill shows the turf split (shape marks at its ends).
//   top right     special gauge: the kit's special icon + name (weapons.json), a fill, and at 100 % a
//                 pulse with a key badge showing the ACTUAL binding (Input.keyLabel('special'));
//                 then the kill feed `{A} washed {B}` (a sea death shows {B} with a wave icon)
//   centre        reticle + TANK pipette (dry-click flash; a tick at the sub cost); the sub
//                 chip (JELLY CHARGE icon + its key) greys out below the sub cost; NEEDLE-GLINT shows a
//                 charge ring around the reticle (bright at full charge)
//   bottom centre low-tank toast `Tank low — hold SHIFT on your color to drink`
//   bottom left   minimap (MinimapRaster → putImageData only when dirty) + the runner arrow + ally dots
//                 and seen-enemy dots (dot shape = crew mark: ◉ circle / ▲ triangle)
//   overlays      slates.ts (3 · 2 · 1, WASHED BY, victory + tally). Hit markers and the damage vignette + arc
//                 are ui/juice.ts (phase 10): the HUD no longer draws its own.
//   F1            debug panel. The pause card moved to ui/menus.ts in phase 9 (PAUSED / RESUME / SETTINGS / …).
// Every per-frame write is skipped when its value did not change.
//
// CONTRACT_FFA F3 — FREE-FOR-ALL (`mode: 'ffa'`): the same rhythm for 8 crews of one. Top centre: 4 + 4 small crests
// in each runner's FFA colour + mark (downed ✕ + count) round the timer pill, and a slim 8-colour share bar under
// it. Top left: your own share + mark, then a live TOP-3 leaderboard (colour chip, mark, name, %). The kill feed
// names take their crew colour + mark (`{A} washed {B}`), the death slate the washer's; the gauge / tank / sub /
// charge ring take the human's colour; the minimap (the raster's 8-colour palette) is north-up with every seen
// runner's dot in its crew colour and mark SHAPE (◉ circle · ▲ triangle · ■ square · ◆ diamond · ★ star · ✚ cross ·
// ⬟ pentagon · ⬢ hexagon), so it reads in colorblind modes. Teams mode is unchanged.
//
// CONTRACT_MOBILE (UI lane): touch mode (setTouchMode; it also follows html.df-touch) swaps the gauge's and the sub
// chip's keycap badges for the SPECIAL / SUB buttons' glyphs, the low-tank toast for LOW_TANK_TOAST_TOUCH and the
// countdown legend for the touch glyphs. The touch layout itself is CSS: the minimap moves right of the PAUSE button,
// the FFA panel under it, the toast above the bottom edge (top centre on a phone); the phone breakpoint (max-height:
// 500px) compacts every block and keeps at most 3 kill-feed lines, so the stick and the thumb arc stay clear.

import type { Coverage, MoveState, TeamId } from '../core/types.ts';
import { TEAMS, TEAMS_RAW, teamById } from '../core/data.ts';
import type { MinimapRaster } from '../core/paint/minimap.ts';
import { Slates, waveIcon, crewLook, touchGlyph, type CrewLook, type UiMode, type VictoryInfo } from './slates.ts';
import { touchModeOn, watchTouchMode } from './boot.ts';

export { crewLook, ffaCrews, type CrewLook, type UiMode, type FfaVictory, type FfaStanding } from './slates.ts';

export const LOW_TANK_TOAST = 'Tank low — hold SHIFT on your color to drink';
/** CONTRACT_MOBILE M4: the low-tank toast in touch mode (the brief's SHIFT line above stays exactly as it is on keyboard) */
export const LOW_TANK_TOAST_TOUCH = 'Tank low — hold SLICK on your color to drink';
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
  /** CONTRACT_FFA F3: the weighted coverage share per crew id (index 0 = neutral, 1..8 = crews); FFA only */
  shares?: ArrayLike<number> | null;
}

/** minimap dot shape per crew mark glyph (CONTRACT_FFA F3: the dot shape = the crew's mark) */
const MARK_SHAPE: Record<string, string> = { '◉': 'circle', '▲': 'tri', '■': 'sq', '◆': 'dia', '★': 'star', '✚': 'cross', '⬟': 'pent', '⬢': 'hex' };
const pct1 = (f: number): string => `${(Math.max(0, f) * 100).toFixed(1)}%`;

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

/**
 * Push teams.json colors into the CSS variables the stylesheet uses. `colorblind` (SETTINGS → colorblind
 * marks) swaps in the teams.json `colorblind` pair and sets `html.df-cb`, which adds the GULF CREW hatch.
 */
export function applyTeamCssVars(colorblind = false): void {
  const r = document.documentElement.style;
  const cb = (colorblind ? TEAMS_RAW.colorblind : null) as Record<string, { dye?: string; ui?: string }> | null;
  for (const t of TEAMS) {
    const alt = cb?.[t.key];
    r.setProperty(`--${t.key}`, alt?.ui ?? t.ui);
    r.setProperty(`--${t.key}-ink`, t.uiInk);
    r.setProperty(`--${t.key}-dye`, alt?.dye ?? t.dye);
  }
  document.documentElement.classList.toggle('df-cb', !!cb);
}

const teamKey = (t: TeamId): 'sun' | 'gulf' => (t === 2 ? 'gulf' : 'sun');

interface CrestEl { box: HTMLElement; mark: HTMLElement; num: HTMLElement; alive: boolean; n: number; ready: boolean; glyph: string }
interface DotEl { e: HTMLElement; on: boolean; tx: string }
interface FeedEntry { e: HTMLElement; t: number }
interface LeadRow { li: HTMLElement; chip: HTMLElement; name: HTMLElement; pct: HTMLElement; team: number; txt: string }

export class Hud {
  readonly root: HTMLElement;
  readonly slates: Slates;
  debugVisible = false;
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
  private readonly toast: HTMLElement;
  private readonly dots: DotEl[] = [];
  private readonly debug: HTMLElement;
  private readonly debugBody: HTMLElement;
  private readonly subKey: HTMLElement;
  private debugClock = 0;
  private lastTimer = '';
  private lastCov = '';
  private lastTank = -1;
  private lastGauge = -1;
  private toastT = 0;
  private clock = 0;
  private lastPhase = '';
  private final10 = false;
  private retSlick = false;
  private retFiring = false;
  private lastArrow = '';
  private arrowAlive = true;
  private readonly pxy: [number, number] = [0, 0];
  private lastHide = false;
  // CONTRACT_FFA F3
  readonly mode: UiMode;
  private readonly ffa: boolean;
  /** the minimap is turned 180° (a GULF CREW viewer in teams mode only) */
  private readonly flipMini: boolean;
  private readonly names = new Map<number, string>();
  private meBox: HTMLElement | null = null;
  private mePct: HTMLElement | null = null;
  private meRank: HTMLElement | null = null;
  private readonly lead: LeadRow[] = [];
  private readonly shareFills: Array<{ e: HTMLElement; team: number }> = [];
  private readonly order: number[] = [];
  private lastShareKey = '';
  private readonly ffaInfo = { me: '', rank: 0, top3: [] as Array<{ team: number; name: string; pct: string }> };
  /** CONTRACT_MOBILE M4: touch-mode prompts (M1 html.df-touch; main.ts also calls setTouchMode) */
  private touch = false;
  private touchOff: (() => void) | null = null;

  constructor(host: HTMLElement, o: { team: TeamId; minimap: MinimapRaster | null; specialName?: string; roster?: ReadonlyArray<{ id: number; name: string; team: TeamId }>; youId?: number; kit?: HudKit;
    /** CONTRACT_FFA F3: 'ffa' = the FREE-FOR-ALL HUD (default 'teams') */
    mode?: UiMode }) {
    this.team = o.team;
    this.kit = o.kit ?? null;
    this.mini = o.minimap;
    this.mode = o.mode ?? 'teams';
    this.ffa = this.mode === 'ffa';
    this.flipMini = !this.ffa && this.team === 2;
    this.root = el('div', 'df-hud');
    const sun = teamById(1), gulf = teamById(2);
    const meLook = crewLook(this.team, this.mode);
    /** the colour class of the human's own widgets: sun / gulf (teams) or me (FFA: the --me* vars below) */
    const meKey = this.ffa ? 'me' : teamKey(this.team);
    if (this.ffa) {
      this.root.classList.add('ffa');
      this.root.style.setProperty('--me', meLook.ui);
      this.root.style.setProperty('--me-dye', meLook.dye);
      this.root.style.setProperty('--me-gloss', meLook.dyeGloss);
    }

    // ── top centre: crests · timer · crests, tug bar (FFA: 4 + 4 crews of one, an 8-colour share bar)
    const top = el('div', 'df-top');
    const sunRow = el('div', 'df-crests sun');
    const gulfRow = el('div', 'df-crests gulf');
    const roster = o.roster ?? [];
    for (const r of roster) this.names.set(r.team, r.name);
    const mkCrest = (id: number, team: TeamId, name: string): CrestEl => {
      const look = this.ffa ? crewLook(team, 'ffa') : null;
      const box = el('div', `df-crest ${look ? 'ffa' : teamKey(team)}${id === (o.youId ?? 0) ? ' you' : ''}`);
      box.title = name;
      if (look) { box.style.setProperty('--c', look.ui); box.dataset.team = String(team); }
      const glyph = look ? look.markGlyph : teamById(team).markGlyph;
      const mark = el('span', 'mark', glyph);
      const num = el('span', 'num', '');
      box.append(mark, num);
      return { box, mark, num, alive: true, n: -1, ready: false, glyph };
    };
    if (this.ffa) {
      const list = roster.length ? [...roster].sort((a, b) => a.id - b.id) : [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: i, name: '', team: (i + 1) as TeamId }));
      list.forEach((r, i) => {
        const c = mkCrest(r.id, r.team, r.name);
        this.crests[r.id] = c;
        (i < Math.ceil(list.length / 2) ? sunRow : gulfRow).append(c.box);
      });
      sunRow.classList.add('ffa'); gulfRow.classList.add('ffa');
    } else {
      for (const t of [1, 2] as TeamId[]) {
        const mem = roster.filter((r) => r.team === t);
        const list = mem.length ? mem : [0, 1, 2, 3].map((i) => ({ id: (t - 1) * 4 + i, name: '', team: t }));
        for (const r of list) {
          const c = mkCrest(r.id, t, r.name);
          this.crests[r.id] = c;
          (t === 1 ? sunRow : gulfRow).append(c.box);
        }
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
    if (this.ffa) {
      tug.className = 'df-tug df-sharebar';
      for (let t = 1; t <= 8; t++) {
        const f = el('div', 'fill');
        f.style.background = crewLook(t, 'ffa').dye;
        tug.append(f);
        this.shareFills.push({ e: f, team: t });
      }
    } else {
      const tm1 = el('i', 'm sun', sun.markGlyph), tm2 = el('i', 'm gulf', gulf.markGlyph);
      tug.append(this.sunFill, this.gulfFill, tm1, tm2);
    }
    mid.append(this.timer, tug);
    top.append(sunRow, mid, gulfRow);

    // ── top left (FFA): your own share + mark, then the live top-3 leaderboard
    let ffaPanel: HTMLElement | null = null;
    if (this.ffa) {
      ffaPanel = el('div', 'df-ffa-panel');
      const me = el('div', 'df-me');
      const mk = el('i', 'mk', meLook.markGlyph);
      mk.setAttribute('aria-hidden', 'true');
      const txt = el('div', 'txt');
      txt.append(el('span', 'nm', roster.find((r) => r.id === (o.youId ?? 0))?.name ?? ''));
      this.mePct = el('b', 'pct', pct1(0));
      txt.append(this.mePct);
      this.meRank = el('span', 'rank', '');
      me.append(mk, txt, this.meRank);
      this.meBox = me;
      const ol = el('ol', 'df-lead');
      for (let i = 0; i < 3; i++) {
        const li = el('li', '');
        const chip = el('i', 'chip', '');
        chip.setAttribute('aria-hidden', 'true');
        const name = el('b', 'nm', '');
        const p = el('span', 'pct', '');
        li.append(el('span', 'rk', String(i + 1)), chip, name, p);
        li.hidden = true;
        ol.append(li);
        this.lead.push({ li, chip, name, pct: p, team: 0, txt: '' });
      }
      ffaPanel.append(me, ol);
      for (const r of roster) this.order.push(r.team);
      if (!this.order.length) for (let t = 1; t <= 8; t++) this.order.push(t);
    }

    // ── top right: special gauge + kill feed
    const right = el('div', 'df-right');
    this.gauge = el('div', `df-gauge ${meKey}`);
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
    this.miniView = el('div', 'df-mini-view' + (this.flipMini ? ' gulf' : ''));
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
    const tcol = this.ffa ? meLook : teamById(this.team === 2 ? 2 : 1);
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
      + `<circle class="charge" r="15.5" fill="none" stroke="${this.ffa ? 'var(--me)' : this.team === 2 ? 'var(--gulf)' : 'var(--sun)'}" stroke-width="3.2" stroke-linecap="round" transform="rotate(-90)" stroke-dasharray="0 ${CHARGE_C.toFixed(2)}"/></svg>`;
    this.chargeRing = this.ret.querySelector('circle.charge');
    this.tankBox = el('div', 'df-tank' + (this.ffa ? ' me' : this.team === 2 ? ' gulf' : ''));
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
    this.sub = el('div', `df-sub ${meKey} grey`);
    this.sub.innerHTML = ICONS.jelly;
    this.sub.title = this.kit?.subName ?? '';
    this.subKey = el('kbd', 'key', this.kit?.subKey ?? '');
    this.sub.append(this.subKey);
    if (!this.kit) this.sub.hidden = true;

    // ── low-tank toast
    this.toast = el('div', 'df-toast', LOW_TANK_TOAST);
    this.toast.hidden = true;
    this.toast.setAttribute('role', 'status');

    // ── debug panel
    this.debug = el('div', 'df-debug');
    this.debug.hidden = true;
    this.debug.append(el('h4', '', 'DEBUG · F1'));
    this.debugBody = el('table');
    this.debug.append(this.debugBody);

    this.root.append(top, right, miniBox, this.ret, this.tankBox, tankLabel, this.sub, this.toast, this.debug);
    if (ffaPanel) this.root.insertBefore(ffaPanel, this.debug);
    host.append(this.root);
    this.slates = new Slates(host);
    this.slates.mode = this.mode;
    this.redrawMinimap(true);
    this.setTouchMode(touchModeOn());
    this.touchOff = watchTouchMode((on) => this.setTouchMode(on));
  }

  /**
   * CONTRACT_MOBILE M4 / M12 platform prompts. Touch: the special gauge's and the sub chip's keycap badges show the
   * SPECIAL / SUB buttons' glyphs, the low-tank toast reads LOW_TANK_TOAST_TOUCH, the countdown legend shows the touch
   * glyphs. The compact layout that keeps the thumb zones clear is CSS (html.df-touch, @media (max-height: 500px)).
   */
  setTouchMode(on: boolean): void {
    this.touch = on;
    this.root.classList.toggle('touch', on);
    const t = on ? LOW_TANK_TOAST_TOUCH : LOW_TANK_TOAST;
    if (this.toast.textContent !== t) this.toast.textContent = t;
    this.renderBadges();
    this.slates.setTouchMode(on);
  }

  /** the gauge / sub badges: the binding's keycap (kbm) or the touch button's glyph (touch) */
  private renderBadges(): void {
    const sk = this.kit?.specialKey ?? '';
    if (this.touch) {
      this.gaugeKey.innerHTML = `<i class="tg">${ICONS[this.kit?.specialId ?? ''] ?? touchGlyph('special')}</i>`;
      this.gaugeKey.classList.add('touch');
      this.gaugeKey.setAttribute('aria-label', 'tap SPECIAL');
      this.gaugeKey.hidden = !this.kit;
      this.subKey.innerHTML = `<i class="tg">${ICONS.jelly}</i>`;
      this.subKey.classList.add('touch');
      this.subKey.setAttribute('aria-label', 'tap SUB');
      return;
    }
    this.gaugeKey.classList.remove('touch');
    this.gaugeKey.textContent = sk;
    this.gaugeKey.setAttribute('aria-label', `press ${sk}`);
    this.gaugeKey.hidden = !sk;
    this.subKey.classList.remove('touch');
    this.subKey.textContent = this.kit?.subKey ?? '';
    this.subKey.removeAttribute('aria-label');
  }

  /** a crew's look in this HUD's mode (teams: the CSS-var palette classes carry colorblind) */
  look(team: number): CrewLook { return crewLook(team, this.mode); }

  /** remove every DOM node this HUD added (a match session ends) */
  dispose(): void {
    this.touchOff?.();
    this.touchOff = null;
    this.root.remove();
    this.slates.root.remove();
  }

  /** SETTINGS rebind mid-match: the special / sub key badges show the new keys (touch mode keeps the glyphs) */
  setKeys(specialKey: string, subKey: string): void {
    if (this.kit) { this.kit.specialKey = specialKey; this.kit.subKey = subKey; }
    if (this.touch) return;
    this.gaugeKey.textContent = specialKey;
    this.gaugeKey.setAttribute('aria-label', `press ${specialKey}`);
    this.gaugeKey.hidden = !specialKey;
    this.subKey.textContent = subKey;
  }

  /** the minimap colours changed (colorblind marks): repaint it now */
  redrawMinimapNow(): void { this.redrawMinimap(true); }

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

  // ───────────────────────────── events ─────────────────────────────
  /** kill feed: `{A} washed {B}`; a sea death (a = null) shows {B} with the wave icon */
  killFeed(a: { name: string; team: TeamId } | null, b: { name: string; team: TeamId }): void {
    const e = el('div', 'df-feed-item');
    const who = (p: { name: string; team: TeamId }): HTMLElement => {
      if (this.ffa) {
        // CONTRACT_FFA F3: each name in its crew colour + mark
        const c = crewLook(p.team, 'ffa');
        const s = el('span', 'who ffa');
        s.style.setProperty('--c', c.ui);
        s.dataset.team = String(p.team);
        const m = el('i', '', c.markGlyph);
        m.setAttribute('aria-hidden', 'true');
        s.append(m, el('b', '', p.name));
        return s;
      }
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
    // CONTRACT_MOBILE M6: a phone held sideways (the max-height 500px breakpoint) keeps 3 lines, everything else 5
    let max = 5;
    try { if (matchMedia('(max-height: 500px)').matches) max = 3; } catch { /* keep 5 */ }
    while (this.feedItems.length > max) this.feedItems.pop()!.e.remove();
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

  showDeath(name: string | null, team: TeamId | null, seconds: number): void { this.slates.showDeath(name, team, seconds); }
  hideDeath(): void { this.slates.hideDeath(); }
  showVictory(v: VictoryInfo, onAgain: () => void, onLobby?: () => void): void { this.slates.showVictory(v, onAgain, onLobby); }
  hideVictory(): void { this.slates.hideVictory(); }

  /** clear transient state (match restart) */
  reset(): void {
    for (const f of this.feedItems) f.e.remove();
    this.feedItems.length = 0;
    this.toastT = 0; this.toast.hidden = true;
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
        ce.mark.textContent = c.alive ? ce.glyph : '✕';
      }
      const n = c.alive ? -1 : Math.max(0, Math.ceil(c.respawnIn - 1e-3));
      if (n !== ce.n) { ce.n = n; ce.num.textContent = n >= 0 ? String(n) : ''; }
      const ready = c.alive && c.special >= 1;
      if (ready !== ce.ready) { ce.ready = ready; ce.box.classList.toggle('ready', ready); }
    }

    // tug bar (FFA: the share bar, own share and the top-3 leaderboard)
    if (this.ffa) this.updateFfa(f.shares ?? null);
    else {
      const cov = f.coverage;
      const key = `${(cov.sun * 1000).toFixed(0)}|${(cov.gulf * 1000).toFixed(0)}`;
      if (key !== this.lastCov) {
        this.lastCov = key;
        const w = coverageBar(cov.sun, cov.gulf);
        this.sunFill.style.width = `${(w.sun * 100).toFixed(2)}%`;
        this.gulfFill.style.width = `${(w.gulf * 100).toFixed(2)}%`;
      }
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

    if (this.toastT > 0) {
      this.toastT -= dt;
      // the final horn ends every nag: the victory slate never sits over a low-tank toast
      if (this.toastT <= 0 || f.slick || f.phase === 'ended') { this.toastT = 0; this.toast.hidden = true; }
    }


    // death slate ring · victory tally
    if (this.slates.deathVisible) this.slates.updateDeath(f.respawnIn);
    this.slates.update(dt);

    // minimap + arrow + dots
    this.redrawMinimap(false);
    if (this.mini) {
      const gulf = this.flipMini;
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
          const cls = this.ffa ? `df-dot ffa ${MARK_SHAPE[crewLook(info.team, 'ffa').markGlyph] ?? 'circle'}${info.team !== this.team ? ' foe' : ''}`
            : `df-dot ${teamKey(info.team)}${info.team !== this.team ? ' foe' : ''}`;
          if (d.e.className !== cls) {
            d.e.className = cls;
            if (this.ffa) d.e.style.setProperty('--c', crewLook(info.team, 'ffa').ui);
          }
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
    const gulf = this.flipMini;
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
        key: this.gaugeKey.hidden ? null : (this.touch ? 'SPECIAL' : this.gaugeKey.textContent), icon: this.kit?.specialId ?? null },
      sub: { ready: this.lastSub === true, grey: this.sub.classList.contains('grey'), key: this.kit?.subKey ?? null, cost: this.kit?.subCost ?? null },
      touch: this.touch,
      charge: this.kit?.fire === 'charge' ? Math.max(0, this.lastCharge) : null,
      tank: this.lastTank,
      dots: this.dots.filter((d) => d.on).length,
      mode: this.mode,
      ...(this.ffa ? {
        ffa: { me: this.ffaInfo.me, rank: this.ffaInfo.rank, top3: this.ffaInfo.top3.map((r) => ({ ...r })),
          crests: this.crests.filter(Boolean).map((c) => ({ team: Number(c.box.dataset.team), alive: c.alive, mark: c.glyph })),
          feedCrews: this.feedItems.map((f) => [...f.e.querySelectorAll<HTMLElement>('.who')].map((w) => Number(w.dataset.team))) },
      } : {}),
      ...this.slates.text(),
    };
  }

  /**
   * FFA (CONTRACT_FFA F3): the 8-colour share bar under the timer (∛ of the painted total, split by share), your own
   * share + rank, and the top 3 (share desc, a tie → the lower crew id: the sim's deterministic order). DOM writes
   * only when a shown number changes.
   */
  private updateFfa(shares: ArrayLike<number> | null): void {
    if (!shares) return;
    const ord = this.order;
    let key = '';
    for (const t of ord) key += `${Math.round((shares[t] ?? 0) * 1000)}|`;
    if (key === this.lastShareKey) return;
    this.lastShareKey = key;
    ord.sort((a, b) => ((shares[b] ?? 0) - (shares[a] ?? 0)) || (a - b));
    let painted = 0;
    for (const t of ord) painted += Math.max(0, shares[t] ?? 0);
    const total = painted > 0 ? Math.min(1, Math.cbrt(Math.min(1, painted))) : 0;
    for (const f of this.shareFills) {
      const s = Math.max(0, shares[f.team] ?? 0);
      f.e.style.width = painted > 0 ? `${((total * s / painted) * 100).toFixed(2)}%` : '0%';
    }
    const mine = Math.max(0, shares[this.team] ?? 0);
    const me = pct1(mine);
    const rank = ord.indexOf(this.team) + 1;
    this.ffaInfo.me = me;
    this.ffaInfo.rank = rank;
    if (this.mePct && this.mePct.textContent !== me) this.mePct.textContent = me;
    // no rank while the human has no turf yet (an all-zero board would tie-break the human to #1 in the countdown)
    if (this.meRank) { const r = rank > 0 && mine > 0 ? `#${rank}` : ''; if (this.meRank.textContent !== r) this.meRank.textContent = r; }
    this.meBox?.classList.toggle('lead', rank === 1 && mine > 0);
    this.ffaInfo.top3.length = 0;
    for (let i = 0; i < this.lead.length; i++) {
      const row = this.lead[i];
      const t = ord[i];
      const s = t !== undefined ? Math.max(0, shares[t] ?? 0) : 0;
      const on = t !== undefined && s > 0;
      if (row.li.hidden === on) row.li.hidden = !on;
      if (!on) continue;
      const name = this.names.get(t) ?? '';
      const p = pct1(s);
      this.ffaInfo.top3.push({ team: t, name, pct: p });
      if (row.team !== t) {
        row.team = t;
        const c = crewLook(t, 'ffa');
        row.chip.textContent = c.markGlyph;
        row.chip.style.background = c.dye;
        row.name.textContent = name;
        row.li.classList.toggle('you', t === this.team);
      }
      if (row.txt !== p) { row.txt = p; row.pct.textContent = p; }
    }
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
