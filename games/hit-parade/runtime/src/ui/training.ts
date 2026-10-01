// HIT PARADE - TRAINING (lane UI; CONTRACT section 8): the dummy options model the pause-menu TRAINING OPTIONS screen edits,
// the input display and the frame-advantage readout the HUD hosts in training bouts.
//
// Frame advantage: when an attack connects (HIT or BLOCK event; a = the attacker), the readout watches both fighters and
// stamps the first frame each is actionable again; advantage = defender's frame - attacker's frame (+ = attacker acts
// first). "Actionable" = FighterSnap.actionable when the sim provides it (CHANGED(UI) request), else the fallback
// `stun <= 0 && hitstop <= 0 && moveId < 0`. Startup = the attacker's moveFrame on the contact frame; damage = the
// victim's HP drop; COMBO = HP lost since the combo began.

import type { SimEvent, UiFighterSnap, UiMatchSnap } from './types.ts';
import { EV } from './ev.ts';
import { chip, dirSvg, div, el, setText } from './dom.ts';
import { t } from './strings.ts';
import type { ResetWhere, ScreenBox } from './trainopts.ts';

export { TrainingState, TRAINING_DEFAULTS, RECORD_TICKS } from './trainopts.ts';
export type { DummyAction, DummyGuard, RecordMode, ResetWhere, TrainingOpts, ScreenBox } from './trainopts.ts';

/** the rows of the TRAINING OPTIONS screen (menus.ts renders them) */
export type TrainingRow =
  | { kind: 'seg'; key: 'dummy' | 'guard' | 'record' | 'meter'; label: string; opts: ReadonlyArray<readonly [string, string]> }
  | { kind: 'level'; key: 'cpuLevel'; label: string }
  | { kind: 'toggle'; key: 'inputs' | 'frames' | 'hitboxes'; label: string }
  | { kind: 'reset'; label: string; opts: ReadonlyArray<readonly [ResetWhere, string]> };
export function trainingRows(): TrainingRow[] {
  return [
    // CHANGED(UI3D): SIDESTEPS / CIRCLES - the dummy steps off the line or circle-walks (practise HOMING vs LINEAR moves)
    { kind: 'seg', key: 'dummy', label: t('tr.dummy'), opts: [['stand', t('tr.dummy.stand')], ['crouch', t('tr.dummy.crouch')], ['jump', t('tr.dummy.jump')], ['sidesteps', t('tr.dummy.sidesteps')], ['circles', t('tr.dummy.circles')], ['cpu', t('tr.dummy.cpu')]] },
    { kind: 'seg', key: 'guard', label: t('tr.guard'), opts: [['none', t('tr.guard.none')], ['all', t('tr.guard.all')], ['first', t('tr.guard.first')], ['random', t('tr.guard.random')]] },
    { kind: 'level', key: 'cpuLevel', label: t('tr.cpuLevel') },
    { kind: 'seg', key: 'record', label: t('tr.record'), opts: [['off', t('tr.rec.off')], ['record', t('tr.rec.record')], ['play', t('tr.rec.play')]] },
    { kind: 'seg', key: 'meter', label: t('tr.meter'), opts: [['normal', t('tr.meter.normal')], ['full', t('tr.meter.full')]] },
    { kind: 'toggle', key: 'inputs', label: t('tr.inputs') },
    { kind: 'toggle', key: 'frames', label: t('tr.frames') },
    { kind: 'toggle', key: 'hitboxes', label: t('tr.hitboxes') },
    { kind: 'reset', label: t('tr.reset'), opts: [['mid', t('tr.reset.mid')], ['corner', t('tr.reset.corner')], ['cornered', t('tr.reset.cornered')]] },
  ];
}

// ─────────────────────────── input word helpers (CONTRACT 4.4) ───────────────────────────
export const IN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, L: 16, M: 32, H: 64, S: 128, ASSIST: 256, THROW: 512, PARRY: 1024, IMPACT: 2048, TAUNT: 4096, STEP_IN: 8192, STEP_OUT: 16384 } as const;

/** numpad direction of a word (screen-relative: 6 = right) */
export function numpadDir(w: number): number {
  const u = (w & IN.UP) !== 0, d = (w & IN.DOWN) !== 0, l = (w & IN.LEFT) !== 0, r = (w & IN.RIGHT) !== 0;
  const v = u && !d ? 1 : d && !u ? -1 : 0;
  const h = r && !l ? 1 : l && !r ? -1 : 0;
  return 5 + h + v * 3;
}
const BTN_BITS: ReadonlyArray<readonly [number, string]> = [
  [IN.L, 'L'], [IN.M, 'M'], [IN.H, 'H'], [IN.S, 'S'], [IN.ASSIST, 'A'], [IN.THROW, 'T'], [IN.PARRY, 'P'], [IN.IMPACT, 'I'],
  // CHANGED(UI3D): the STEP bits (CONTRACT §35.2) as IN / OUT chips
  [IN.STEP_IN, 'IN'], [IN.STEP_OUT, 'OUT'],
];

export class InputDisplay {
  readonly root: HTMLElement;
  private readonly rowsBox: HTMLElement;
  private rows: Array<{ word: number; frames: number; el: HTMLElement; f: HTMLElement }> = [];
  private readonly max = 14;
  constructor(host: HTMLElement) {
    this.root = div('hp-inputs', host);
    this.root.append(el('div', 'ttl', t('tr.inputsTitle')));
    this.rowsBox = div('rows', this.root);
  }
  push(word: number, _frame: number): void {
    const w = word & 0x7fff;           // CHANGED(UI3D): incl. the STEP bits
    const top = this.rows[0];
    if (top && top.word === w) { top.frames++; setText(top.f, String(Math.min(99, top.frames))); return; }
    const r = el('div', 'row');
    const f = el('span', 'f', '1');
    const d = el('span', 'd');
    d.innerHTML = dirSvg(numpadDir(w));
    r.append(f, d);
    for (const [bit, label] of BTN_BITS) if (w & bit) r.append(chip(label, bit >= IN.STEP_IN ? 'step' : ''));
    this.rowsBox.prepend(r);
    this.rows.unshift({ word: w, frames: 1, el: r, f });
    while (this.rows.length > this.max) { const x = this.rows.pop(); x?.el.remove(); }
    this.pushes++;
  }
  /** read-back: input changes shown so far */
  get count(): number { return this.pushes; }
  private pushes = 0;
  dispose(): void { this.root.remove(); }
}

const BOX_STYLE: Readonly<Record<ScreenBox['kind'], [string, string]>> = {
  hurt: ['rgba(47, 134, 255, .22)', '#5aa2ff'],
  hit: ['rgba(255, 43, 58, .30)', '#ff4b5a'],
  push: ['rgba(255, 245, 220, .06)', 'rgba(255, 245, 220, .85)'],
  proj: ['rgba(255, 210, 26, .28)', '#ffd21a'],
};

/** CHANGED(UI) P2: the HITBOX overlay canvas over the bout (training; CONTRACT 27.1) */
export class BoxOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  count = 0;
  constructor(host: HTMLElement) {
    this.canvas = el('canvas', 'hp-boxes');
    this.canvas.setAttribute('aria-hidden', 'true');
    host.prepend(this.canvas);
    this.g = this.canvas.getContext('2d');
  }
  draw(list: ReadonlyArray<ScreenBox>): void {
    const c = this.canvas;
    const w = c.clientWidth, h = c.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = this.g;
    c.hidden = false;
    this.count = list.length;
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.lineWidth = 2;
    for (const k of ['push', 'hurt', 'proj', 'hit'] as const) {
      const [fill, line] = BOX_STYLE[k];
      g.fillStyle = fill;
      g.strokeStyle = line;
      g.setLineDash(k === 'push' ? [5, 4] : []);
      for (const b of list) {
        if (b.kind !== k) continue;
        const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), bw = Math.abs(b.x1 - b.x0), bh = Math.abs(b.y1 - b.y0);
        if (k !== 'push') g.fillRect(x, y, bw, bh);
        g.strokeRect(x + 0.5, y + 0.5, bw, bh);
      }
    }
  }
  clear(): void { this.count = 0; this.canvas.hidden = true; this.g?.clearRect(0, 0, this.canvas.width, this.canvas.height); }
}

interface Watch { atk: 0 | 1; block: boolean; t0: number; tA: number | null; tD: number | null }

export class FrameReadout {
  readonly root: HTMLElement;
  private readonly adv: HTMLElement;
  private readonly advLbl: HTMLElement;
  private readonly startup: HTMLElement;
  private readonly damage: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly rec: HTMLElement;
  private watch: Watch | null = null;
  private prevHp: [number, number] = [-1, -1];
  private comboStart: [number, number] = [-1, -1];
  /** read-back: the last measured advantage */
  last: { adv: number; block: boolean; startup: number; damage: number } | null = null;

  constructor(host: HTMLElement) {
    this.root = div('hp-frames', host);
    this.root.append(el('div', 'ttl', t('tr.framesTitle')));
    const kv = (label: string, cls = ''): [HTMLElement, HTMLElement] => {
      const r = div(`kv ${cls}`.trim(), this.root);
      const l = el('span', '', label);
      const v = el('b', '', t('misc.none'));
      r.append(l, v);
      return [l, v];
    };
    [this.advLbl, this.adv] = kv(t('tr.adv'), 'adv');
    this.startup = kv(t('tr.startup'))[1];
    this.damage = kv(t('tr.damage'))[1];
    this.combo = kv(t('tr.combo'))[1];
    this.rec = el('span', 'rec', '');
    this.root.append(this.rec);
  }

  setRecord(s: 'off' | 'record' | 'play'): void {
    setText(this.rec, s === 'record' ? t('tr.recording') : s === 'play' ? t('tr.playing') : '');
    this.rec.classList.toggle('play', s === 'play');
  }

  /** CHANGED(UI) P2: the training driver measures per SIM TICK (exact) and hands its numbers in; from then on the
   *  readout shows those and stops sampling at render frames (which can be a frame off when two ticks share a frame) */
  private external = false;
  setExact(r: { adv: number | null; block: boolean; startup: number; damage: number; combo: number }): void {
    this.external = true;
    setText(this.advLbl, r.block ? `${t('tr.adv')} ${t('tr.onBlock')}` : `${t('tr.adv')} ${t('tr.onHit')}`);
    setText(this.startup, r.startup > 0 ? `${r.startup}F` : t('misc.none'));
    setText(this.damage, String(Math.max(0, r.damage)));
    setText(this.combo, String(Math.max(0, r.combo)));
    if (r.adv === null) { setText(this.adv, '...'); this.adv.className = ''; return; }
    setText(this.adv, r.adv > 0 ? `+${r.adv}` : String(r.adv));
    this.adv.className = r.adv > 0 ? 'plus' : r.adv < 0 ? 'minus' : 'zero';
    this.last = { adv: r.adv, block: r.block, startup: r.startup, damage: r.damage };
  }

  static actionable(f: UiFighterSnap): boolean {
    if (typeof f.actionable === 'boolean') return f.actionable;
    return (f.stun ?? 0) <= 0 && (f.hitstop ?? 0) <= 0 && (f.moveId ?? -1) < 0;
  }

  frame(m: UiMatchSnap, f: readonly [UiFighterSnap, UiFighterSnap], ev: readonly SimEvent[]): void {
    if (this.external) return;
    for (const e of ev) {
      if (e.type !== EV.HIT && e.type !== EV.BLOCK) continue;
      const atk = e.a === 1 ? 1 : 0;
      const vic = 1 - atk;
      this.watch = { atk, block: e.type === EV.BLOCK, t0: e.frame, tA: null, tD: null };
      setText(this.startup, typeof f[atk].moveFrame === 'number' && (f[atk].moveFrame ?? 0) > 0 ? `${f[atk].moveFrame}F` : t('misc.none'));
      const before = this.prevHp[vic] >= 0 ? this.prevHp[vic] : f[vic].hp;
      const dmg = Math.max(0, before - f[vic].hp);
      setText(this.damage, String(dmg));
      if (f[vic].combo <= 1 || this.comboStart[vic] < 0) this.comboStart[vic] = before;
      setText(this.combo, String(Math.max(0, this.comboStart[vic] - f[vic].hp)));
      setText(this.advLbl, e.type === EV.BLOCK ? `${t('tr.adv')} ${t('tr.onBlock')}` : `${t('tr.adv')} ${t('tr.onHit')}`);
      setText(this.adv, '...');
      this.adv.className = '';
    }
    const w = this.watch;
    if (w && m.frame > w.t0) {
      const vic = (1 - w.atk) as 0 | 1;
      if (w.tA === null && FrameReadout.actionable(f[w.atk])) w.tA = m.frame;
      if (w.tD === null && FrameReadout.actionable(f[vic])) w.tD = m.frame;
      if (w.tA !== null && w.tD !== null) {
        const adv = w.tD - w.tA;
        setText(this.adv, adv > 0 ? `+${adv}` : String(adv));
        this.adv.className = adv > 0 ? 'plus' : adv < 0 ? 'minus' : 'zero';
        this.last = { adv, block: w.block, startup: Number.parseInt(this.startup.textContent ?? '0', 10) || 0, damage: Number(this.damage.textContent) || 0 };
        this.watch = null;
      } else if (m.frame - w.t0 > 240) this.watch = null;           // a juggle / knockdown loop: give up quietly
    }
    this.prevHp = [f[0].hp, f[1].hp];
    for (let i = 0; i < 2; i++) if (f[i].combo === 0 && !this.watch) this.comboStart[i] = -1;
  }

  dispose(): void { this.root.remove(); }
}
