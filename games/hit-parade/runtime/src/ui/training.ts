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

export type DummyAction = 'stand' | 'crouch' | 'jump' | 'cpu';
export type DummyGuard = 'none' | 'all' | 'first';
export type RecordMode = 'off' | 'record' | 'play';
export interface TrainingOpts {
  dummy: DummyAction; guard: DummyGuard; cpuLevel: number; record: RecordMode;
  inputs: boolean; frames: boolean; hitboxes: boolean; meter: 'normal' | 'full'; hpRefill: boolean;
}
export const TRAINING_DEFAULTS: Readonly<TrainingOpts> = Object.freeze({
  dummy: 'stand', guard: 'none', cpuLevel: 3, record: 'off', inputs: true, frames: true, hitboxes: false, meter: 'full', hpRefill: true,
});

/** in-memory training options (per session); game.ts subscribes and applies them to the dummy / overlays */
export class TrainingState {
  private v: TrainingOpts = { ...TRAINING_DEFAULTS };
  private fns = new Set<(o: TrainingOpts, action: 'change' | 'reset') => void>();
  get(): TrainingOpts { return { ...this.v }; }
  set(p: Partial<TrainingOpts>): void {
    const n = { ...this.v, ...p };
    n.cpuLevel = Math.max(1, Math.min(8, Math.round(n.cpuLevel)));
    this.v = n;
    for (const f of this.fns) f(this.get(), 'change');
  }
  /** RESET POSITIONS */
  reset(): void { for (const f of this.fns) f(this.get(), 'reset'); }
  on(fn: (o: TrainingOpts, action: 'change' | 'reset') => void): () => void { this.fns.add(fn); return () => this.fns.delete(fn); }
}

/** the rows of the TRAINING OPTIONS screen (menus.ts renders them) */
export type TrainingRow =
  | { kind: 'seg'; key: 'dummy' | 'guard' | 'record' | 'meter'; label: string; opts: ReadonlyArray<readonly [string, string]> }
  | { kind: 'level'; key: 'cpuLevel'; label: string }
  | { kind: 'toggle'; key: 'inputs' | 'frames' | 'hitboxes' | 'hpRefill'; label: string }
  | { kind: 'action'; key: 'reset'; label: string };
export function trainingRows(): TrainingRow[] {
  return [
    { kind: 'seg', key: 'dummy', label: t('tr.dummy'), opts: [['stand', t('tr.dummy.stand')], ['crouch', t('tr.dummy.crouch')], ['jump', t('tr.dummy.jump')], ['cpu', t('tr.dummy.cpu')]] },
    { kind: 'seg', key: 'guard', label: t('tr.guard'), opts: [['none', t('tr.guard.none')], ['all', t('tr.guard.all')], ['first', t('tr.guard.first')]] },
    { kind: 'level', key: 'cpuLevel', label: t('tr.cpuLevel') },
    { kind: 'seg', key: 'record', label: t('tr.record'), opts: [['off', t('tr.rec.off')], ['record', t('tr.rec.record')], ['play', t('tr.rec.play')]] },
    { kind: 'seg', key: 'meter', label: t('tr.meter'), opts: [['normal', t('tr.meter.normal')], ['full', t('tr.meter.full')]] },
    { kind: 'toggle', key: 'hpRefill', label: t('tr.hp') },
    { kind: 'toggle', key: 'inputs', label: t('tr.inputs') },
    { kind: 'toggle', key: 'frames', label: t('tr.frames') },
    { kind: 'toggle', key: 'hitboxes', label: t('tr.hitboxes') },
    { kind: 'action', key: 'reset', label: t('tr.reset') },
  ];
}

// ─────────────────────────── input word helpers (CONTRACT 4.4) ───────────────────────────
export const IN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, L: 16, M: 32, H: 64, S: 128, ASSIST: 256, THROW: 512, PARRY: 1024, IMPACT: 2048, TAUNT: 4096 } as const;

/** numpad direction of a word (screen-relative: 6 = right) */
export function numpadDir(w: number): number {
  const u = (w & IN.UP) !== 0, d = (w & IN.DOWN) !== 0, l = (w & IN.LEFT) !== 0, r = (w & IN.RIGHT) !== 0;
  const v = u && !d ? 1 : d && !u ? -1 : 0;
  const h = r && !l ? 1 : l && !r ? -1 : 0;
  return 5 + h + v * 3;
}
const BTN_BITS: ReadonlyArray<readonly [number, string]> = [
  [IN.L, 'L'], [IN.M, 'M'], [IN.H, 'H'], [IN.S, 'S'], [IN.ASSIST, 'A'], [IN.THROW, 'T'], [IN.PARRY, 'P'], [IN.IMPACT, 'I'],
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
    const w = word & 0x1fff;
    const top = this.rows[0];
    if (top && top.word === w) { top.frames++; setText(top.f, String(Math.min(99, top.frames))); return; }
    const r = el('div', 'row');
    const f = el('span', 'f', '1');
    const d = el('span', 'd');
    d.innerHTML = dirSvg(numpadDir(w));
    r.append(f, d);
    for (const [bit, label] of BTN_BITS) if (w & bit) r.append(chip(label, label === 'S' ? '' : ''));
    this.rowsBox.prepend(r);
    this.rows.unshift({ word: w, frames: 1, el: r, f });
    while (this.rows.length > this.max) { const x = this.rows.pop(); x?.el.remove(); }
  }
  dispose(): void { this.root.remove(); }
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

  static actionable(f: UiFighterSnap): boolean {
    if (typeof f.actionable === 'boolean') return f.actionable;
    return (f.stun ?? 0) <= 0 && (f.hitstop ?? 0) <= 0 && (f.moveId ?? -1) < 0;
  }

  frame(m: UiMatchSnap, f: readonly [UiFighterSnap, UiFighterSnap], ev: readonly SimEvent[]): void {
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
