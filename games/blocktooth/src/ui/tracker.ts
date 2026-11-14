// BLOCKTOOTH v2 — the objective tracker (top-right) (FEATURES_V2 §4.6), the power-up pickup burst and the
// RED LIGHT screen tint (§6.3). Lane L8. UI.
//
// Up to 6 rows of 2.2u, pooled at mount: one per live objective (glyph · name · distance `2.4 BLK` · a
// life bar), one per active power-up timer (`RED LIGHT 4.1s`), and one for the most-advanced run-scope
// goal (`GOAL · CROWD CONTROL` + `412 / 1000`, only while ≥ 25 % complete; re-ranked at 1 Hz). Rows
// enter / exit with 0.2 s transform + opacity slides; text is written at most at 4 Hz per row; the life
// bar is a scaleX transform. It replaces the v1 upgrade-chips column (removed from hud.ts).
// objectiveDone → the row is stamped (`LOAD SHED`, `CRATES OPEN`, `FILES SEIZED`) and held 1.4 s.
// Test hook (§13.3): [data-v2="tracker-row"] on visible rows.

import './hud_v2.css';
import type { GoalDef, ObjectiveKind, PowerUpKind, Profile, SimEvent, World } from '../core/types.ts';
import type { GlyphId, TrackerApi } from '../v2types.ts';
import { CITY, POWERUPS } from '../core/config.ts';
import { OBJECTIVE_NAMES, OBJECTIVE_STAMP } from '../data/objectives.ts';
import { POWERUP_NAMES } from '../data/powerups.ts';
import { GOALS } from '../data/goals.ts';
import { goalParts, goalProgress } from '../meta/goals.ts';
import { emptyProfile } from '../meta/profile.ts';
import { loadProfile } from '../core/save.ts';
import { HUD2 } from '../data/strings_hud.ts';
import { ClassSlot, TextSlot, VarSlot, div, flashesReduced, fmtInt, pulse } from './dom.ts';
import { glyphSvg } from './icons.ts';

const ROWS = 6;
const TEXT_HZ = 4;
const GOAL_PERIOD_S = 1;
const GOAL_MIN_FRAC = 0.25;
const STAMP_HOLD_S = 1.4;
const EXIT_MS = 220;
const STEP_S = 0.1;

export const OBJECTIVE_GLYPH: Record<ObjectiveKind, GlyphId> = { overloadSite: 'overload', reliefDepot: 'bandage', recordsAnnex: 'annex' };
export const OBJECTIVE_COLOR: Record<ObjectiveKind, string> = { overloadSite: '#ffd166', reliefDepot: '#4fb3b0', recordsAnnex: '#ff6f5e' };
export const POWERUP_GLYPH: Record<PowerUpKind, GlyphId> = { cleanup: 'magnet', demolition: 'notice', redLight: 'trafficLight', rushHour: 'rush', backPay: 'coin' };
export const POWERUP_COLOR: Record<PowerUpKind, string> = { cleanup: '#4fb3b0', demolition: '#ff8a3d', redLight: '#e63946', rushHour: '#ffd166', backPay: '#7bd389' };

interface Row {
  root: HTMLDivElement;
  g: HTMLDivElement;
  name: TextSlot;
  val: TextSlot;
  bar: VarSlot;
  stamp: HTMLDivElement;
  done: ClassSlot;
  key: string;              // '' = free
  glyph: string;
  textAcc: number;
  exitTimer: number;
}

interface Want { key: string; glyph: GlyphId; color: string; name: string; val: string; frac: number; goal: boolean; done: boolean }

export class ObjectiveTracker implements TrackerApi {
  private readonly layer: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly rows: Row[] = [];
  private readonly burst: HTMLDivElement;
  private readonly burstG: HTMLDivElement;
  private readonly burstT: HTMLDivElement;
  private readonly tint: ClassSlot;
  private shown = false;
  private world: World | null = null;
  private profile: Profile | null = null;
  private goal: GoalDef | null = null;
  private goalName = '';
  private goalVal = '';
  private goalFrac = 0;
  private goalAcc = GOAL_PERIOD_S;
  private readonly doneUntil = new Map<string, { t: number; kind: ObjectiveKind }>();
  private readonly want: Want[] = [];
  private readonly wantPool: Want[] = [];
  private clock = 0;
  private stepAcc = 1;
  private readonly empty = emptyProfile();

  constructor(root: HTMLElement) {
    const L = this.layer = div('bt-layer bt-v2track bt-hidden', root);
    const tint = div('bt-redlight', L);
    this.tint = new ClassSlot(tint, 'on');
    this.box = div('bt-trk', L);
    for (let i = 0; i < ROWS; i++) {
      const r = div('bt-trow off', this.box);
      const g = div('bt-trow-g', r);
      const t = div('bt-trow-t', r);
      const name = new TextSlot(div('bt-trow-n', t));
      const bw = div('bt-trow-bar', t);
      const bar = new VarSlot(document.createElement('i'), '--p', 0.004);
      bw.appendChild(bar.node);
      const val = new TextSlot(div('bt-trow-v', r));
      const stamp = div('bt-trow-stamp', r);
      this.rows.push({ root: r, g, name, val, bar, stamp, done: new ClassSlot(r, 'done'), key: '', glyph: '', textAcc: 0, exitTimer: 0 });
    }
    for (let i = 0; i < ROWS + 4; i++) this.wantPool.push({ key: '', glyph: 'star', color: '', name: '', val: '', frac: 0, goal: false, done: false });
    this.burst = div('bt-pu-burst', L);
    this.burstG = div('bt-pu-burst-g', this.burst);
    this.burstT = div('bt-pu-burst-t', this.burst);
  }

  show(on: boolean): void {
    this.shown = on;
    this.layer.classList.toggle('bt-hidden', !on);
  }

  update(w: World, dt: number): void {
    if (w !== this.world) this.bind(w);
    if (!this.shown) return;
    const d = Math.min(0.1, Math.max(0, dt || 0));
    this.clock += d;
    this.goalAcc += d;
    if (this.goalAcc >= GOAL_PERIOD_S) { this.goalAcc = 0; this.pickGoal(w); }
    this.tint.set(!!w.map && w.map.redLightT > 0);
    // rows, bars and text refresh at 10 Hz (a 75 s life bar and a 0.1 s timer need no more; §4.7 budget)
    this.stepAcc += d;
    if (this.stepAcc < STEP_S) return;
    const sd = this.stepAcc;
    this.stepAcc = 0;
    this.collect(w);
    this.apply(sd);
  }

  onEvents(w: World, ev: readonly SimEvent[]): void {
    if (w !== this.world) this.bind(w);
    for (const e of ev) {
      if (e.type === 'objectiveDone') {
        this.doneUntil.set('o' + e.id, { t: this.clock + STAMP_HOLD_S, kind: e.kind });
      } else if (e.type === 'powerup') {
        this.powerBurst(e.kind);
      }
    }
  }

  // ─────────────────────────────── internals ───────────────────────────────

  private bind(w: World): void {
    this.world = w;
    try { this.profile = loadProfile(); } catch { this.profile = null; }
    this.goal = null;
    this.goalAcc = GOAL_PERIOD_S;
    this.doneUntil.clear();
    this.clock = 0;
    this.stepAcc = 1;
    for (const r of this.rows) this.freeRow(r, true);
    this.tint.reset();
  }

  private next(): Want | null {
    if (this.want.length >= this.wantPool.length) return null;
    const x = this.wantPool[this.want.length];
    this.want.push(x);
    return x;
  }

  /** the desired rows this frame (≤ ROWS), in display order: objectives, power-up timers, goal */
  private collect(w: World): void {
    this.want.length = 0;
    const T = w.titan;
    const M = w.map;
    if (M) {
      for (const o of M.objectives) {
        if (this.want.length >= ROWS - 1) break;
        const key = 'o' + o.id;
        const done = this.doneUntil.get(key);
        if (!o.alive && !(done && done.t > this.clock)) continue;
        const x = this.next(); if (!x) break;
        x.key = key; x.glyph = OBJECTIVE_GLYPH[o.kind]; x.color = OBJECTIVE_COLOR[o.kind];
        x.name = OBJECTIVE_NAMES[o.kind];
        x.val = (Math.hypot(o.x - T.x, o.z - T.z) / CITY.pitch).toFixed(1) + ' ' + HUD2.blk;
        x.frac = o.life > 0 ? Math.max(0, 1 - o.t / o.life) : 1;
        x.goal = false; x.done = !!done && !o.alive;
      }
      // stamped rows whose objective was already compacted away
      for (const [key, v] of this.doneUntil) {
        if (v.t <= this.clock) { this.doneUntil.delete(key); continue; }
        if (this.want.some((x) => x.key === key)) continue;
        if (this.want.length >= ROWS - 1) break;
        const x = this.next(); if (!x) break;
        x.key = key; x.glyph = OBJECTIVE_GLYPH[v.kind]; x.color = OBJECTIVE_COLOR[v.kind];
        x.name = OBJECTIVE_NAMES[v.kind]; x.val = ''; x.frac = 0; x.goal = false; x.done = true;
      }
      const bossUp = !!w.boss && w.boss.alive;
      if (M.redLightT > 0 && this.want.length < ROWS) this.timerRow('redLight', M.redLightT, bossUp);
      if (M.rushHourT > 0 && this.want.length < ROWS) this.timerRow('rushHour', M.rushHourT, bossUp);
    }
    const g = this.goal;
    if (g && this.want.length < ROWS) {
      const x = this.next();
      if (x) {
        x.key = 'goal:' + g.id; x.glyph = 'ribbon'; x.color = '#ff6f5e';
        x.name = this.goalName; x.val = this.goalVal; x.frac = this.goalFrac; x.goal = true; x.done = false;
      }
    }
  }

  private timerRow(kind: 'redLight' | 'rushHour', t: number, bossUp: boolean): void {
    const x = this.next(); if (!x) return;
    const total = Math.max(t, kind === 'redLight' ? (bossUp ? POWERUPS.redLightBossS : POWERUPS.redLightS) : POWERUPS.rushHourS);
    x.key = 'p:' + kind; x.glyph = POWERUP_GLYPH[kind]; x.color = POWERUP_COLOR[kind];
    x.name = POWERUP_NAMES[kind]; x.val = t.toFixed(1) + 's';
    x.frac = Math.max(0, Math.min(1, t / total)); x.goal = false; x.done = false;
  }

  /** 1 Hz: the run-scope goal closest to done (≥ 25 %, not on file, matching titan / city). */
  private pickGoal(w: World): void {
    this.goal = null;
    if (!w.tally) return;
    const P = this.profile;
    const ctx = { titan: w.titanId, biome: w.biomeId, result: w.run.result, endT: w.run.endT };
    let best = GOAL_MIN_FRAC, pick: GoalDef | null = null;
    for (const g of GOALS) {
      if (g.scope !== 'run' || g.lowerIsBetter || g.target <= 0) continue;
      if (g.titan && g.titan !== w.titanId) continue;
      if (g.biome && g.biome !== w.biomeId) continue;
      if (P && P.done[g.id] !== undefined) continue;
      let v = 0;
      try { v = goalProgress(g, this.empty, w.tally, ctx); } catch { continue; }
      const fr = v / g.target;
      if (fr >= 1) continue;
      if (fr >= best) { best = fr; pick = g; }
    }
    this.goal = pick;
    if (pick) {
      const parts = goalParts(pick, this.empty, w.tally, ctx);
      this.goalName = HUD2.goalPrefix + ' · ' + pick.name;
      this.goalVal = fmtInt(parts.x) + ' / ' + fmtInt(parts.y);
      this.goalFrac = Math.max(0, Math.min(1, best));
    }
  }

  private apply(d: number): void {
    // release rows no longer wanted
    for (const r of this.rows) {
      if (!r.key || r.exitTimer) continue;
      if (!this.want.some((x) => x.key === r.key)) this.exitRow(r);
    }
    for (const x of this.want) {
      let r = this.rows.find((q) => q.key === x.key);
      if (!r) {
        r = this.rows.find((q) => !q.key);
        if (!r) continue;
        this.enterRow(r, x);
      }
      r.bar.set(x.frac);
      r.done.set(x.done);
      r.textAcc -= d;
      if (r.textAcc <= 1e-6) {
        r.textAcc = 1 / TEXT_HZ;
        r.name.set(x.name);
        r.val.set(x.done ? '' : x.val);
      }
    }
  }

  private enterRow(r: Row, x: Want): void {
    if (r.exitTimer) { clearTimeout(r.exitTimer); r.exitTimer = 0; }
    r.key = x.key;
    r.textAcc = 0;
    r.name.reset(); r.val.reset(); r.bar.reset(); r.done.reset();
    if (r.glyph !== x.glyph + x.color) { r.glyph = x.glyph + x.color; r.g.innerHTML = glyphSvg(x.glyph, x.color); }
    r.root.style.setProperty('--kc', x.color);
    const kind = x.key.startsWith('o') ? this.kindOf(x.key) : null;
    r.stamp.textContent = kind ? OBJECTIVE_STAMP[kind] : '';
    r.root.className = 'bt-trow out' + (x.goal ? ' goal' : '');
    r.root.dataset.v2 = 'tracker-row';
    // keep display order = want order
    this.box.appendChild(r.root);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (r.key === x.key && !r.exitTimer) r.root.classList.remove('out'); }));
  }

  private kindOf(key: string): ObjectiveKind | null {
    const d = this.doneUntil.get(key);
    if (d) return d.kind;
    const w = this.world;
    if (!w || !w.map) return null;
    const id = Number(key.slice(1));
    const o = w.map.objectives.find((q) => q.id === id);
    return o ? o.kind : null;
  }

  private exitRow(r: Row): void {
    r.root.classList.add('out');
    r.exitTimer = window.setTimeout(() => { r.exitTimer = 0; this.freeRow(r, false); }, EXIT_MS);
  }

  private freeRow(r: Row, now: boolean): void {
    if (now && r.exitTimer) { clearTimeout(r.exitTimer); r.exitTimer = 0; }
    r.key = '';
    r.root.className = 'bt-trow off';
    delete r.root.dataset.v2;
  }

  private powerBurst(kind: PowerUpKind): void {
    if (!this.shown) return;
    this.burstG.innerHTML = glyphSvg(POWERUP_GLYPH[kind], POWERUP_COLOR[kind]);
    this.burstT.textContent = POWERUP_NAMES[kind] + HUD2.bang;
    this.burst.style.setProperty('--kc', POWERUP_COLOR[kind]);
    const calm = flashesReduced();
    pulse(this.burst, [
      { opacity: 0, transform: `translate(-50%, 0) scale(${calm ? 0.9 : 0.4}) rotate(-6deg)` },
      { opacity: 1, transform: 'translate(-50%, 0) scale(1.1) rotate(-3deg)', offset: 0.16 },
      { opacity: 1, transform: 'translate(-50%, 0) scale(1) rotate(-3deg)', offset: 0.72 },
      { opacity: 0, transform: 'translate(-50%, -40%) scale(1) rotate(-3deg)' },
    ], 1400);
  }
}
