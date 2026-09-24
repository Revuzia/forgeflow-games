// BLOCKTOOTH — F1 debug overlay (CONTRACT.md §14).
//
// A translucent monospace panel: frame timing (fps / p50 / p99 / max / sim cost), renderer
// counters, titan, entity counts, director, boss, run phase — plus a 120-frame frame-time
// sparkline with 16.7 ms and 33.3 ms guide lines.
//
// Cost when hidden: update() returns on its first line (no DOM, no sorting, no allocation).
// When visible the text rows refresh at ~5 Hz and only rows whose text changed touch the DOM;
// the sparkline redraws every frame (120 fillRects on a tiny canvas).

import type { EnemyKind, World } from './types.ts';
import { ENEMY_KINDS } from './types.ts';
import type { RenderStats } from '../render/renderer.ts';
import { RANKS, RANK_LEVELS, levelsToNextSize, sizeProgress } from './config.ts';
import { frameStats, frameTimeHistory } from './loop.ts';

/** what the app passes per frame — `frameStats()` from loop.ts satisfies it */
export interface DebugFrameInfo {
  fps: number;
  p99: number;
  simMs: number;
  p50?: number;
  max?: number;
  simTickMs?: number;
  frameCpuMs?: number;
}

const SPARK_N = 120;          // frames in the sparkline
const SPARK_BAR = 2;          // css px per frame
const SPARK_H = 44;           // css px
const SPARK_MAX_MS = 50;      // top of the scale
const TEXT_EVERY_MS = 200;

const INK_BG = 'rgba(18, 13, 28, 0.80)';
const COL_TEXT = '#eaf3ee';
const COL_DIM = '#8fa3a0';
const COL_GOOD = '#7fe0a6';
const COL_WARN = '#ffd166';
const COL_BAD = '#ff6f5e';

type RowKey =
  | 'frame' | 'sim' | 'gpu' | 'titan' | 'mass' | 'hp' | 'pose'
  | 'enemies' | 'combat' | 'director' | 'boss' | 'run' | 'drafts';

const ROWS: readonly [RowKey, string][] = [
  ['frame', 'FRAME'], ['sim', 'SIM'], ['gpu', 'GPU'],
  ['titan', 'TITAN'], ['mass', 'GROW'], ['hp', 'HP'], ['pose', 'POSE'],
  ['enemies', 'FOES'], ['combat', 'LIVE'], ['director', 'DIRECTOR'], ['boss', 'BOSS'],
  ['run', 'RUN'], ['drafts', 'DRAFTS'],
];

function f1(v: number): string { return Number.isFinite(v) ? v.toFixed(1) : String(v); }
function f2(v: number): string { return Number.isFinite(v) ? v.toFixed(2) : String(v); }
function i0(v: number): string { return Number.isFinite(v) ? String(Math.round(v)) : String(v); }
function kfmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.round(v));
}
/** seconds-from-now for an absolute sim time (Infinity → '—') */
function tAt(abs: number, now: number): string {
  if (!Number.isFinite(abs)) return '—';
  const d = abs - now;
  return d >= 0 ? `${f1(abs)}s (in ${f1(d)})` : `${f1(abs)}s`;
}

export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly panel: HTMLDivElement;
  private readonly spark: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D | null;
  private readonly values = new Map<RowKey, HTMLSpanElement>();
  private readonly cache = new Map<RowKey, string>();
  private readonly history = new Float64Array(SPARK_N);
  private readonly kindCount: Record<EnemyKind, number>;
  private _visible = false;
  private lastText = -Infinity;
  private sparkDpr = 0;
  // fallback sparkline source: intervals between this overlay's own visible update() calls.
  // Used when loop.ts's ring is empty for this module instance (e.g. the page loaded loop.ts
  // under a second URL, or drives frames without GameLoop).
  private readonly own = new Float64Array(SPARK_N);
  private ownHead = 0;
  private ownCount = 0;
  private lastUpdateAt = -1;

  constructor(root: HTMLElement) {
    this.root = root;
    const doc = root.ownerDocument;
    const kc = {} as Record<EnemyKind, number>;
    for (const k of ENEMY_KINDS) kc[k] = 0;
    this.kindCount = kc;

    const panel = doc.createElement('div');
    panel.className = 'bt-debug';
    panel.setAttribute('aria-hidden', 'true');
    const ps = panel.style;
    ps.position = 'fixed';
    ps.left = '12px';
    ps.top = '64px';
    ps.zIndex = '9000';
    ps.pointerEvents = 'none';
    ps.display = 'none';
    ps.boxSizing = 'border-box';
    ps.width = 'min(600px, calc(100vw - 24px))';
    ps.padding = '8px 10px 8px 10px';
    ps.background = INK_BG;
    ps.border = '1px solid rgba(255,255,255,0.14)';
    ps.borderRadius = '6px';
    ps.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
    ps.color = COL_TEXT;
    ps.font = "11px/1.4 'Space Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace";
    ps.letterSpacing = '0';
    ps.whiteSpace = 'pre';
    ps.userSelect = 'none';
    ps.backdropFilter = 'blur(2px)';

    const head = doc.createElement('div');
    head.textContent = 'DEBUG · F1';
    head.style.color = COL_WARN;
    head.style.fontWeight = '700';
    head.style.marginBottom = '4px';
    panel.appendChild(head);

    for (const [key, label] of ROWS) {
      const row = doc.createElement('div');
      // long rows wrap under the value column (hanging indent = label width)
      row.style.whiteSpace = 'pre-wrap';
      row.style.paddingLeft = '9ch';
      row.style.textIndent = '-9ch';
      const l = doc.createElement('span');
      l.textContent = label.padEnd(9, ' ');
      l.style.color = COL_DIM;
      const v = doc.createElement('span');
      v.textContent = '';
      row.appendChild(l);
      row.appendChild(v);
      panel.appendChild(row);
      this.values.set(key, v);
    }

    const spark = doc.createElement('canvas');
    spark.style.display = 'block';
    spark.style.marginTop = '6px';
    spark.style.width = `${SPARK_N * SPARK_BAR}px`;
    spark.style.height = `${SPARK_H}px`;
    spark.style.borderTop = '1px solid rgba(255,255,255,0.10)';
    panel.appendChild(spark);
    this.spark = spark;
    let c: CanvasRenderingContext2D | null = null;
    try { c = spark.getContext('2d'); } catch { c = null; }
    this.ctx2d = c;

    root.appendChild(panel);
    this.panel = panel;
  }

  get visible(): boolean { return this._visible; }
  set visible(on: boolean) {
    const v = !!on;
    if (v === this._visible) return;
    this._visible = v;
    this.panel.style.display = v ? 'block' : 'none';
    if (v) {
      this.lastText = -Infinity;
      this.cache.clear();
      this.ownHead = 0; this.ownCount = 0; this.lastUpdateAt = -1;
    }
  }

  toggle(): void { this.visible = !this._visible; }

  /** Remove the panel from the DOM. */
  dispose(): void {
    if (this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
  }

  update(w: World | null, r: RenderStats, frame: DebugFrameInfo): void {
    if (!this._visible) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (this.lastUpdateAt >= 0) {
      const d = now - this.lastUpdateAt;
      if (d > 0 && d < 1000) {
        this.own[this.ownHead] = d;
        this.ownHead = (this.ownHead + 1) % SPARK_N;
        if (this.ownCount < SPARK_N) this.ownCount++;
      }
    }
    this.lastUpdateAt = now;
    this.drawSpark();
    if (now - this.lastText < TEXT_EVERY_MS) return;
    this.lastText = now;
    this.writeText(w, r, frame);
  }

  // ─────────────────────────────── text ───────────────────────────────
  private set(key: RowKey, text: string, color?: string): void {
    const bad = text.includes('NaN') || text.includes('Infinity');
    const col = bad ? COL_BAD : (color ?? COL_TEXT);
    const cacheKey = col + '|' + text;
    if (this.cache.get(key) === cacheKey) return;
    this.cache.set(key, cacheKey);
    const span = this.values.get(key);
    if (!span) return;
    span.textContent = text;
    span.style.color = col;
  }

  private writeText(w: World | null, r: RenderStats, frame: DebugFrameInfo): void {
    const ring = frameStats();
    const p50 = frame.p50 ?? ring.p50;
    const max = frame.max ?? ring.max;
    const tickMs = frame.simTickMs ?? ring.simTickMs;
    const cpu = frame.frameCpuMs ?? ring.frameCpuMs;
    const fpsCol = frame.p99 <= 17.5 ? COL_GOOD : frame.p99 <= 22 ? COL_WARN : COL_BAD;
    this.set('frame', `${f1(frame.fps)} fps · p50 ${f1(p50)} · p99 ${f1(frame.p99)} · max ${f1(max)} ms`, fpsCol);
    this.set('sim', `${f2(frame.simMs)} ms/frame · ${f2(tickMs)} ms/tick · cpu ${f2(cpu)} ms`,
      tickMs > 4 ? COL_BAD : undefined);
    if (r) {
      this.set('gpu', `draws ${i0(r.draws)} · tris ${kfmt(r.tris)} · prog ${i0(r.programs)} · geo ${i0(r.geometries)} · tex ${i0(r.textures)}`,
        r.draws > 450 ? COL_BAD : undefined);
    } else {
      this.set('gpu', '—', COL_DIM);
    }

    if (!w) {
      for (const [key] of ROWS) if (key !== 'frame' && key !== 'sim' && key !== 'gpu') this.set(key, '—', COL_DIM);
      return;
    }

    const T = w.titan;
    const rank = RANKS[T.rank] ?? RANKS[0];
    this.set('titan', `${w.titanId.toUpperCase()} · SIZE ${rank.name} · H ${f2(T.height)} m · r ${f2(T.radius)} · LV ${T.level} · xp ${f1(T.xp)}/${i0(T.xpToNext)}` +
      (T.growT > 0 ? ' · GROWING' : ''));

    const next = RANKS[T.rank + 1];
    this.set('mass', next
      ? `${f1(100 * sizeProgress(T.rank, T.level, T.xp))} % · ${levelsToNextSize(T.rank, T.level)} LV to ${next.name} (LV ${RANK_LEVELS[T.rank + 1]})`
      : 'max size');

    const hpPct = T.maxHp > 0 ? (100 * T.hp) / T.maxHp : 0;
    const hpExtra = (w.upgrades.shield > 0 ? ` · shield ${f1(w.upgrades.shield)}` : '') +
      (T.iframeT > 0 ? ' · IFRAMES' : '') + (T.alive ? '' : ' · DEAD') + (w.cheats.god ? ' · GOD' : '');
    this.set('hp', `${f1(T.hp)}/${i0(T.maxHp)} (${i0(hpPct)}%)${hpExtra}`,
      hpPct < 25 ? COL_BAD : hpPct < 50 ? COL_WARN : undefined);

    const hdg = ((T.heading * 180) / Math.PI) % 360;
    this.set('pose', `x ${f1(T.x)} z ${f1(T.z)} · hdg ${i0(hdg < 0 ? hdg + 360 : hdg)}° · v ${f1(T.speed)} m/s · dash ${T.dashCharges}/${i0(T.stats.dashCharges)} · hook ${T.abilityCd > 0 ? f1(T.abilityCd) + 's' : 'READY'}` +
      (T.leash ? ' · LEASHED' : '') + (T.slowT > 0 ? ' · SLOWED' : ''));

    // entity counts
    const kc = this.kindCount;
    for (const k of ENEMY_KINDS) kc[k] = 0;
    let alive = 0;
    for (let i = 0; i < w.enemies.length; i++) {
      const e = w.enemies[i];
      if (!e.alive) continue;
      alive++;
      kc[e.kind] = (kc[e.kind] ?? 0) + 1;
    }
    let kinds = '';
    for (const k of ENEMY_KINDS) if (kc[k] > 0) kinds += ` · ${k} ${kc[k]}`;
    this.set('enemies', `${alive} alive${kinds}`);

    let proj = 0, tg = 0, hz = 0, pk = 0;
    for (let i = 0; i < w.projectiles.length; i++) if (w.projectiles[i].alive) proj++;
    for (let i = 0; i < w.telegraphs.length; i++) if (w.telegraphs[i].alive) tg++;
    for (let i = 0; i < w.hazards.length; i++) if (w.hazards[i].alive) hz++;
    for (let i = 0; i < w.pickups.length; i++) if (w.pickups[i].alive) pk++;
    this.set('combat', `proj ${proj} · telegraphs ${tg} · hazards ${hz} · pickups ${pk} · ev ${w.events.length}`);

    const d = w.director;
    this.set('director', `wave ${d.wave} · budget ${f1(d.spawnBudget)} · next ${tAt(d.nextWaveT, w.t)} · elite ${tAt(d.eliteT, w.t)} · boss ${tAt(d.bossT, w.t)}` +
      (w.cheats.noSpawns ? ' · NO SPAWNS' : ''));

    const b = w.boss;
    if (b) {
      this.set('boss', `${b.id.toUpperCase()} P${b.phase} · ${i0(b.hp)}/${i0(b.maxHp)} · meter ${i0(b.meter * 100)}%` +
        ` · atk ${b.attack ?? 'idle'}` + (b.introT > 0 ? ' · INTRO' : '') + (b.staggerT > 0 ? ' · STAGGER' : '') + (b.alive ? '' : ' · DOWN'),
        b.staggerT > 0 ? COL_WARN : undefined);
    } else {
      this.set('boss', '—', COL_DIM);
    }

    const run = w.run;
    this.set('run', `${run.phase} · t ${f1(w.t)}s · tick ${w.tick} · seed ${w.seed} · ${w.biomeId}` +
      (run.result ? ` · ${run.result.toUpperCase()}` : ''));

    const u = w.upgrades;
    this.set('drafts', `pending ${u.pendingDrafts} · chest ${u.chestDrafts} · offer ${u.offer ? u.offer.length : 0} · owned ${u.order.length} · buffs ${u.buffs.length}`);
  }

  // ─────────────────────────────── sparkline ───────────────────────────────
  private drawSpark(): void {
    const c = this.ctx2d;
    if (!c) return;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const W = SPARK_N * SPARK_BAR, H = SPARK_H;
    if (dpr !== this.sparkDpr) {
      this.sparkDpr = dpr;
      this.spark.width = Math.round(W * dpr);
      this.spark.height = Math.round(H * dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    let n = frameTimeHistory(this.history);
    if (n === 0 && this.ownCount > 0) {
      // loop ring unavailable → own measured intervals, oldest first
      n = this.ownCount;
      let idx = (this.ownHead - n + SPARK_N) % SPARK_N;
      for (let i = 0; i < n; i++) { this.history[i] = this.own[idx]; idx = (idx + 1) % SPARK_N; }
    }
    const x0 = W - n * SPARK_BAR;         // newest frame at the right edge
    const yOf = (ms: number) => H - (Math.min(ms, SPARK_MAX_MS) / SPARK_MAX_MS) * (H - 2);
    for (let i = 0; i < n; i++) {
      const ms = this.history[i];
      c.fillStyle = ms <= 17.5 ? COL_GOOD : ms <= 34 ? COL_WARN : COL_BAD;
      const y = yOf(ms);
      c.fillRect(x0 + i * SPARK_BAR, y, SPARK_BAR - 0.5, H - y);
    }

    // guide lines: 60 fps and 30 fps budgets
    c.lineWidth = 1;
    c.font = "9px 'Space Mono', ui-monospace, Consolas, monospace";
    c.textBaseline = 'bottom';
    const guides: readonly [number, string][] = [[1000 / 60, '16.7'], [1000 / 30, '33.3']];
    for (const [ms, label] of guides) {
      const y = Math.round(yOf(ms)) + 0.5;
      c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.fillText(label, 2, y - 1);
    }
  }
}
