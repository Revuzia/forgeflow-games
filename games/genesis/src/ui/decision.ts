// GENESIS — ARC §2.5: the Decision card. The one canonical placement and timing for the arc's great choices (the
// tower now; the covenant's vow in §4 reuses it). Top-centre, 380 px wide, at most 170 px tall, under the HUD's top
// row; never over the time controls, the selection or the inspector (with the inspector open it sits under the time
// panel instead). Not modal: the world keeps running and stays clickable.
//
// Timing: the sim opens a choice (TowerView.choiceOpen, at 25 % of the goal and once more at 75 %); the card opens
// on each new opening. "Decide later" or Esc collapses it to a pill ("The tower at Kel-Amar") that reopens it and lasts
// while the choice is open. Keys 1-4 choose while the card has focus. "Slow down for great moments" (prefs
// game.slowGreat): a card opening above 30x eases the speed to 10x; the previous speed comes back on an answer or on
// "Decide later". The tower's inspector card can reopen it on a standing tower (`openFor`).
//
// Split for tests: `towerChoice` (pure: TowerView + names -> the card's words and buttons) and `DecisionState` (pure:
// which choice is open or pilled, and the speed to ease to / restore); `DecisionCard` is the DOM.

import type { Command, CommandResult, EntityRef, SettlementView, TowerView } from '../sim/types.ts';
import { h, clear } from './dom.ts';

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** numbers in words up to twelve, digits above (ARC §0.3 rule 8) */
export const numWords = (n: number): string => (n >= 0 && n <= 12 && Number.isInteger(n) ? NUM[n] : String(Math.round(n)));

export interface ChoiceOption {
  key: string;            // '1'..'4'
  id: string;             // 'confuse' | 'strike' | 'warn' | 'let' (or a vow)
  label: string;
  says: string;
  cmd: Command;
  disabled?: string;      // the reason, when it cannot be chosen now
}
export interface Choice {
  id: string;             // 'tower:<id>'
  pill: string;           // "The tower at Kel-Amar"
  title: string;          // "A tower rises at Kel-Amar"
  meta: string;           // "year two of the work · 38 m of about 80 · three towns of one speech"
  why: string;
  options: ChoiceOption[];
  look?: EntityRef;
}

/** the tower's choice (§2.5 content); `names` maps settlement id -> view (for names and the league's prophet) */
export function towerChoice(t: TowerView, planet: number, names: Map<number, Pick<SettlementView, 'name' | 'prophet'>>, workYear: number): Choice {
  const host = names.get(t.host)?.name ?? 'their town';
  const towns = t.league.length;
  const goal = Math.max(10, Math.round(t.goal / 10) * 10);
  const meta = [`year ${numWords(Math.max(1, workYear))} of the work`, `${Math.round(t.height)} m of about ${goal}`,
    towns > 1 ? `${numWords(towns)} towns of one speech` : 'one town alone'].join(' · ');
  const can = new Set(t.canAnswer);
  let prophet = '';
  for (const id of t.league) { const p = names.get(id)?.prophet; if (p?.name) { prophet = p.name; break; } }
  const base = { planet, tower: t.id };
  const opt = (key: string, id: 'confuse' | 'strike' | 'warn' | 'let', label: string, says: string, why?: string): ChoiceOption => ({
    key, id, label, says, cmd: { k: `tower.${id}`, ...base } as Command,
    disabled: can.has(id) ? undefined : (why || 'Not now'),
  });
  return {
    id: `tower:${t.id}`,
    pill: `The tower at ${host}`,
    title: `A tower rises at ${host}`,
    meta,
    why: 'The towns say they want it seen from everywhere, and their name never forgotten.',
    options: [
      opt('1', 'confuse', 'Confuse their tongues', 'they will scatter, and speak apart for generations.'),
      opt('2', 'strike', 'Strike it down', 'they will fear you; some will hate you.'),
      opt('3', 'warn', 'Send a prophet to warn them', prophet && can.has('warn') ? `${prophet} will go. They may listen.` : 'they may listen.',
        t.warnBlocked || (prophet ? '' : "No prophet speaks for you among the builders. Call one first ('make Hesh my prophet').")),
      opt('4', 'let', 'Let it stand', 'they will be great, and need you less.'),
    ],
    look: { kind: 'building', id: -1, planet } as EntityRef,
  };
}

/** which choice shows as a card and which as a pill; the speed to ease to and to restore (pure, for tests) */
export class DecisionState {
  /** the card shown now (a choice id) */
  open: string | null = null;
  /** choices put off: they show as pills while still offered */
  later = new Set<string>();
  /** the speed before the card eased it (restored on answer / later) */
  prevSpeed: number | null = null;
  private seen = new Set<string>();
  private forced: string | null = null;

  /**
   * one HUD frame: `offered` = choices the sim holds open now (in order), `answerable` = choices that could still be
   * answered (a standing tower), `speed` now, `slow` the pref. Returns the speed to set, or null.
   */
  step(offered: string[], answerable: string[], speed: number, slow: boolean): number | null {
    const on = new Set(offered), can = new Set(answerable);
    let setTo: number | null = null;
    // a choice newly offered opens the card (each fresh offer once: 25 %, then 75 %)
    for (const id of offered) if (!this.seen.has(id)) {
      this.seen.add(id);
      this.later.delete(id);
      if (this.open !== id) { this.open = id; if (slow && speed > 30 && this.prevSpeed == null) { this.prevSpeed = speed; setTo = 10; } }
    }
    for (const id of [...this.seen]) if (!on.has(id)) this.seen.delete(id); // closed: a later reopening is fresh
    for (const id of [...this.later]) if (!on.has(id)) this.later.delete(id);
    if (this.open && !on.has(this.open) && !(this.forced === this.open && can.has(this.open))) {
      // the choice expired (answered elsewhere, finished): the card goes, and the speed comes back
      this.open = null; this.forced = null;
      if (this.prevSpeed != null) { setTo = this.prevSpeed; this.prevSpeed = null; }
    }
    return setTo;
  }

  /** "Decide later" / Esc: the card becomes a pill; returns the speed to restore */
  putOff(): number | null {
    if (!this.open) return null;
    if (this.forced !== this.open) this.later.add(this.open);
    this.open = null; this.forced = null;
    const p = this.prevSpeed; this.prevSpeed = null;
    return p;
  }

  /** an answer was sent and taken: the card closes; returns the speed to restore */
  answered(): number | null {
    if (this.open) this.later.delete(this.open);
    this.open = null; this.forced = null;
    const p = this.prevSpeed; this.prevSpeed = null;
    return p;
  }

  /** the pill (or the tower's card) reopens a choice */
  reopen(id: string, force = false): void {
    this.later.delete(id);
    this.open = id;
    if (force) this.forced = id;
  }
}

export interface DecisionDeps {
  cmd(c: Command): Promise<CommandResult>;
  speed(): number;
  setSpeed(x: number): void;
  slowGreat(): boolean;
  lookAt(planet: number, pos: ArrayLike<number>): void;
  toast?(text: string, ok: boolean): void;
}

/** the DOM: the card and its pills (mounted in the HUD root) */
export class DecisionCard {
  readonly root: HTMLDivElement;
  readonly pills: HTMLDivElement;
  readonly state = new DecisionState();
  private choices = new Map<string, Choice>();
  private towers = new Map<string, { planet: number; t: TowerView }>();
  private drawn = '';
  private busy = false;
  private note = '';

  private deps: DecisionDeps;

  constructor(parent: HTMLElement, deps: DecisionDeps) {
    this.deps = deps;
    this.root = h('div', { class: 'gn-panel gn-decision', role: 'dialog', aria: { modal: 'false', label: 'A great choice' } });
    this.root.tabIndex = -1;
    this.root.hidden = true;
    this.pills = h('div', { class: 'gn-decision-pills' });
    parent.append(this.root, this.pills);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.later(); return; }
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); void this.chooseKey(e.key); }
    });
  }

  /** each HUD frame, from the primary planet's towers */
  update(planet: number, towers: readonly TowerView[] | undefined | null, settlements: readonly SettlementView[], yearOf: (tick: number) => number, tick: number): void {
    const names = new Map(settlements.map((s) => [s.id, s]));
    const offered: string[] = [], answerable: string[] = [];
    this.choices.clear(); this.towers.clear();
    for (const t of towers ?? []) {
      const c = towerChoice(t, planet, names, yearOf(tick) - yearOf(t.begun) + 1);
      this.choices.set(c.id, c);
      this.towers.set(c.id, { planet, t });
      if (t.choiceOpen && t.canAnswer.length) offered.push(c.id);
      if (t.canAnswer.length) answerable.push(c.id);
    }
    const sp = this.state.step(offered, answerable, this.deps.speed(), this.deps.slowGreat());
    if (sp != null) this.deps.setSpeed(sp);
    this.draw();
  }

  /** the tower's inspector card: open its choice now (while it can be answered) */
  openFor(towerId: number): boolean {
    const id = `tower:${towerId}`;
    if (!this.choices.has(id)) return false;
    this.state.reopen(id, true);
    this.draw(true);
    return true;
  }

  later(): void {
    const sp = this.state.putOff();
    if (sp != null) this.deps.setSpeed(sp);
    this.draw();
  }

  async choose(o: ChoiceOption): Promise<CommandResult | null> {
    if (o.disabled || this.busy) return null;
    this.busy = true;
    try {
      const r = await this.deps.cmd(o.cmd);
      this.deps.toast?.(r.msg || (r.ok ? `${o.label}.` : 'It could not be done.'), r.ok);
      if (r.ok) { const sp = this.state.answered(); if (sp != null) this.deps.setSpeed(sp); this.note = ''; }
      else this.note = r.msg || '';
      return r;
    } finally { this.busy = false; this.drawn = ''; this.draw(); }
  }

  /** choose an option of the open card by its key ('1'..'4'), as the keyboard does */
  chooseKey(key: string): Promise<CommandResult | null> {
    const c = this.state.open ? this.choices.get(this.state.open) : undefined;
    const o = c?.options.find((x) => x.key === key);
    return o ? this.choose(o) : Promise.resolve(null);
  }

  /** test surface */
  info(): { open: string | null; pills: string[]; options: { key: string; label: string; disabled: string | null }[] } {
    const c = this.state.open ? this.choices.get(this.state.open) : undefined;
    return { open: this.state.open, pills: [...this.state.later], options: (c?.options ?? []).map((o) => ({ key: o.key, label: o.label, disabled: o.disabled ?? null })) };
  }

  private draw(focus = false): void {
    const id = this.state.open;
    const c = id ? this.choices.get(id) : undefined;
    const pills = [...this.state.later].filter((p) => this.choices.has(p));
    const sig = `${id}|${c ? `${c.meta}|${c.options.map((o) => o.disabled ?? '').join(',')}` : ''}|${pills.join(',')}|${this.note}|${this.busy}`;
    if (sig === this.drawn) return;
    const wasOpen = !this.root.hidden;
    this.drawn = sig;
    clear(this.pills);
    for (const p of pills) {
      const pc = this.choices.get(p)!;
      this.pills.append(h('button', { class: 'gn-btn gn-decision-pill', title: 'Reopen the choice', text: pc.pill, on: { click: () => { this.state.reopen(p); this.draw(true); } } }));
    }
    clear(this.root);
    if (!c) { this.root.hidden = true; return; }
    this.root.hidden = false;
    this.root.dataset.choice = c.id;
    this.root.append(
      h('div', { class: 'gn-decision-h' }, h('b', { text: c.title }), h('span', { class: 'gn-decision-meta', text: ` · ${c.meta}` })),
      h('div', { class: 'gn-decision-why', text: c.why }),
    );
    const list = h('div', { class: 'gn-decision-opts' });
    for (const o of c.options) {
      const b = h('button', { class: 'gn-btn gn-decision-opt', title: o.disabled ?? `${o.label}: ${o.says}`, data: { opt: o.id } });
      b.disabled = !!o.disabled || this.busy;
      b.append(h('span', { class: 'gn-decision-k', text: o.key }), h('b', { text: o.label }), h('span', { class: 'gn-decision-says', text: `: ${o.disabled && o.id === 'warn' ? o.disabled : o.says}` }));
      b.addEventListener('click', () => void this.choose(o));
      list.append(b);
    }
    this.root.append(list);
    if (this.note) this.root.append(h('div', { class: 'gn-decision-note', text: this.note }));
    const tw = this.towers.get(c.id);
    const foot = h('div', { class: 'gn-decision-foot' });
    if (tw) foot.append(h('button', { class: 'gn-btn', text: 'Look at it', on: { click: () => this.deps.lookAt(tw.planet, tw.t.pos) } }));
    foot.append(h('button', { class: 'gn-btn', text: 'Decide later', title: 'Esc', on: { click: () => this.later() } }));
    this.root.append(foot);
    this.layout();
    // focus for keys 1-4, unless the player is typing somewhere
    const ae = document.activeElement as HTMLElement | null;
    if ((focus || !wasOpen) && (!ae || ae === document.body || ae.closest?.('.gn-decision'))) this.root.focus({ preventScroll: true });
  }

  /** top-centre under the top row; under the time panel when the inspector would be covered */
  private layout(): void {
    const insp = document.querySelector<HTMLElement>('.gn-insp:not([hidden])');
    const ir = insp && insp.offsetParent ? insp.getBoundingClientRect() : null;
    const w = 380, cx = window.innerWidth / 2;
    this.root.classList.toggle('gn-decision-left', !!ir && ir.width > 0 && cx + w / 2 > ir.left - 8);
  }
}
