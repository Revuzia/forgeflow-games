// HIT PARADE - CHARACTER SELECT (lane UI; CONTRACT section 8).
//
// Grid: RANDOM (first column, both rows) + the playable roster in two rows + the bosses (THE FREAK over RICKY MARQUEE) in
// the last column. Bosses are LOCKED until a Season clear (save.unlocks); a locked slot can be hovered, never picked.
// Centre: the 3D Showcase region (VIEW's Showcase draws the hovered fighter there; showcaseRect() reports the CSS rect).
// Sides: P1 / P2 cards - name, persona, archetype, difficulty stars, HP, colour swatches, SIMPLE / CLASSIC pick.
//
// Each player steps FIGHTER -> COLOR -> CONTROLS -> READY (a CPU or training dummy skips CONTROLS). ESC / pad B steps back;
// on the first step it leaves the screen. Picking is sequential (P1, then P2 / the CPU pick / the dummy pick) with the
// keyboard or one pad; with two pads in a 2P versus both pick at once (pad 0 = P1, pad 1 = P2). Mirror matches bump the
// second pick's colour. Online is blind: the opponent's side shows nothing until the net layer reports both locked.

import type { Rect, Scheme, UiGameData, UiSave } from './types.ts';
import { btn, div, el, svg, ICON, setText, pulse } from './dom.ts';
import { archetypeLabel, colorsOf, difficulty, fighter, fighterIds, fillPortrait, isBoss, isUnlocked, BOSSES } from './data.ts';
import { t } from './strings.ts';

export type CsMode = 'season' | 'versus' | 'training' | 'online';
export type CsOpponent = 'human' | 'cpu' | 'dummy' | 'none';
export type CsAct = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';
type Step = 'fighter' | 'color' | 'scheme' | 'ready' | 'wait';

export interface CsPick { fighter: string; color: number; scheme: Scheme }
export interface CsResult { p1: CsPick; p2: CsPick | null }

interface Slot { id: string; col: number; row: number; span: number; el: HTMLButtonElement; locked: boolean }
interface PState {
  kind: 'human' | 'cpu' | 'dummy' | 'none';
  cursor: number; step: Step; fighter: string | null; color: number; scheme: Scheme;
}
interface SideEl {
  root: HTMLElement; tag: HTMLElement; step: HTMLElement; name: HTMLElement; persona: HTMLElement; arch: HTMLElement;
  stars: HTMLElement; hp: HTMLElement; colors: HTMLElement; schemeBox: HTMLElement; schemeBtns: [HTMLButtonElement, HTMLButtonElement];
  portrait: HTMLElement; ready: HTMLElement;
}

export interface CsHooks {
  done(r: CsResult): void;
  back(): void;
  /** the fighter the showcase should show changed (active picker's cursor or pick) */
  show(fighterId: string | null, color: number, pose: 'idle' | 'intro' | 'win'): void;
  sound(cue: 'move' | 'select' | 'back' | 'error' | 'start'): void;
  /** the scheme a human player last used (settings.controls[p].scheme) */
  defaultScheme(p: 0 | 1): Scheme;
}

export class CharSelect {
  readonly root: HTMLElement;
  private readonly data: UiGameData;
  private readonly hooks: CsHooks;
  private readonly grid: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly stageName: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly note: HTMLElement;
  private readonly sides: [SideEl, SideEl];
  private slots: Slot[] = [];
  private cells = new Map<string, number>();
  private p: [PState, PState] = [this.blank('human'), this.blank('none')];
  private mode: CsMode = 'versus';
  private simultaneous = false;
  private blindReveal = false;
  private save: UiSave = {};
  private lastShown = '';

  constructor(screen: HTMLElement, data: UiGameData, hooks: CsHooks) {
    this.data = data;
    this.hooks = hooks;
    this.root = div('hpm-cs', screen);
    this.banner = div('hpm-cs-banner', this.root, '');
    const mid = div('hpm-cs-mid', this.root);
    const s1 = this.mkSide(0);
    this.stage = div('hpm-cs-stage', mid);
    this.stage.id = 'hpm-showcase';
    this.stage.setAttribute('aria-hidden', 'true');
    this.stageName = div('hpm-cs-stagename', this.stage, '');
    const s2 = this.mkSide(1);
    mid.prepend(s1.root);
    mid.append(s2.root);
    this.sides = [s1, s2];
    this.grid = div('hpm-cs-grid', this.root);
    this.grid.setAttribute('role', 'listbox');
    this.note = div('hpm-cs-note', this.root, '');
    this.note.setAttribute('role', 'status');
  }

  private blank(kind: PState['kind']): PState { return { kind, cursor: 0, step: 'fighter', fighter: null, color: 0, scheme: 0 }; }

  private mkSide(i: 0 | 1): SideEl {
    const root = el('div', `hpm-cs-side p${i + 1}`);
    const head = div('hpm-cs-head', root);
    const tag = el('span', 'tag', i === 0 ? t('cs.p1') : t('cs.p2'));
    const step = el('span', 'step', '');
    head.append(tag, step);
    const portrait = div('hp-portrait hpm-cs-portrait', root);
    const name = div('hpm-cs-name', root, '');
    const persona = div('hpm-cs-persona', root, '');
    const facts = div('hpm-cs-facts', root);
    const arch = el('span', 'arch', '');
    const stars = el('span', 'stars');
    const hp = el('span', 'hp', '');
    facts.append(arch, stars, hp);
    const colors = div('hpm-cs-colors', root);
    const schemeBox = div('hpm-cs-scheme', root);
    const mk = (s: Scheme): HTMLButtonElement => {
      const b = btn('hpm-segbtn', '', false);
      b.append(el('b', '', s === 0 ? t('cs.simple') : t('cs.classic')), el('small', '', s === 0 ? t('cs.simple.sub') : t('cs.classic.sub')));
      b.addEventListener('click', () => { const st = this.p[i]; if (st.step === 'scheme' || st.step === 'ready') { st.scheme = s; this.hooks.sound('move'); this.render(); } });
      schemeBox.append(b);
      return b;
    };
    const schemeBtns: [HTMLButtonElement, HTMLButtonElement] = [mk(0), mk(1)];
    const ready = div('hpm-cs-ready', root, t('cs.ready'));
    return { root, tag, step, name, persona, arch, stars, hp, colors, schemeBox, schemeBtns, portrait, ready };
  }

  // ─────────────────────────── setup ───────────────────────────
  open(mode: CsMode, opponent: CsOpponent, save: UiSave, o: { pads?: number; preset?: Partial<CsResult> } = {}): void {
    this.mode = mode;
    this.save = save;
    this.blindReveal = false;
    this.buildGrid();
    const p2kind: PState['kind'] = mode === 'season' || mode === 'online' ? 'none' : opponent === 'human' ? 'human' : opponent === 'dummy' ? 'dummy' : 'cpu';
    this.p = [this.blank('human'), this.blank(p2kind)];
    this.p[0].scheme = this.hooks.defaultScheme(0);
    this.p[1].scheme = this.hooks.defaultScheme(1);
    const first = this.slots.findIndex((s) => s.id !== 'random');
    this.p[0].cursor = Math.max(0, first);
    this.p[1].cursor = Math.max(0, this.slots.findIndex((s, k) => k > first && s.id !== 'random' && !isBoss(s.id)));
    if (o.preset?.p1) this.applyPreset(0, o.preset.p1);
    if (o.preset?.p2) this.applyPreset(1, o.preset.p2);
    this.simultaneous = p2kind === 'human' && (o.pads ?? 0) >= 2;
    if (p2kind !== 'none' && !this.simultaneous) this.p[1].step = 'wait';
    this.root.dataset.mode = mode;
    this.root.dataset.p2 = p2kind;
    setText(this.banner, mode === 'online' ? t('cs.blind') : '');
    this.banner.hidden = mode !== 'online';
    this.flashNote('');
    this.render();
    this.showActive();
  }

  private applyPreset(i: 0 | 1, pk: CsPick): void {
    const k = this.slots.findIndex((s) => s.id === pk.fighter);
    if (k >= 0) this.p[i].cursor = k;
    this.p[i].color = pk.color;
    this.p[i].scheme = pk.scheme;
  }

  private buildGrid(): void {
    const ids = fighterIds(this.data);
    const regular = ids.filter((id) => !isBoss(id));
    const bosses = ids.filter((id) => isBoss(id)).sort((a, b) => (BOSSES[a] === 'miniboss' ? -1 : 1) - (BOSSES[b] === 'miniboss' ? -1 : 1));
    const perRow = Math.max(1, Math.ceil(regular.length / 2));
    this.slots = [];
    this.cells.clear();
    this.grid.replaceChildren();
    const add = (id: string, col: number, row: number, span: number): void => {
      const locked = id !== 'random' && !isUnlocked(this.save, id);
      const b = btn('hpm-slot', '', false);
      b.dataset.id = id;
      b.id = `hpm-slot-${id}`;
      b.setAttribute('role', 'option');
      b.style.gridColumn = String(col + 1);
      b.style.gridRow = span > 1 ? `${row + 1} / span ${span}` : String(row + 1);
      const pic = div('hp-portrait', b);
      fillPortrait(pic, this.data, id);
      const nm = el('span', 'nm', id === 'random' ? t('cs.random') : (fighter(this.data, id)?.name ?? id.toUpperCase()));
      b.append(nm);
      if (isBoss(id)) b.append(el('span', 'boss', BOSSES[id] === 'boss' ? t('cs.boss') : t('cs.miniboss')));
      if (locked) { b.classList.add('locked'); b.append(svg(ICON.lock, 'lock')); b.title = t('cs.lockedHint'); }
      b.append(el('i', 'cur c1', t('cs.p1')), el('i', 'cur c2', t('cs.p2')));
      const idx = this.slots.length;
      b.addEventListener('click', () => this.onClick(idx));
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.onHover(idx); });
      this.grid.append(b);
      this.slots.push({ id, col, row, span, el: b, locked });
      for (let r = row; r < row + span; r++) this.cells.set(`${col},${r}`, idx);
    };
    add('random', 0, 0, 2);
    regular.forEach((id, k) => add(id, 1 + (k % perRow), Math.floor(k / perRow), 1));
    bosses.slice(0, 2).forEach((id, k) => add(id, 1 + perRow, k, 1));
    this.grid.style.setProperty('--cols', String(2 + perRow));
  }

  // ─────────────────────────── input ───────────────────────────
  /** the player the keyboard (or a single pad) drives right now */
  activePlayer(): 0 | 1 {
    if (this.simultaneous) return 0;
    const p1 = this.p[0];
    if (p1.step !== 'ready') return 0;
    return this.p[1].kind === 'none' ? 0 : 1;
  }

  input(who: 0 | 1 | 'active', act: CsAct): void {
    const i: 0 | 1 = who === 'active' ? this.activePlayer() : who;
    const st = this.p[i];
    if (st.kind === 'none' || st.step === 'wait') return;
    switch (st.step) {
      case 'fighter':
        if (act === 'confirm') this.pickFighter(i);
        else if (act === 'back') this.backFrom(i);
        else this.moveCursor(i, act);
        break;
      case 'color': {
        const n = colorsOf(fighter(this.data, st.fighter ?? '')).length;
        if (act === 'left' || act === 'up') { st.color = (st.color + n - 1) % n; this.hooks.sound('move'); }
        else if (act === 'right' || act === 'down') { st.color = (st.color + 1) % n; this.hooks.sound('move'); }
        else if (act === 'confirm') { st.step = st.kind === 'human' ? 'scheme' : 'ready'; this.hooks.sound('select'); if (st.step === 'ready') this.onReady(i); }
        else if (act === 'back') { st.step = 'fighter'; st.fighter = null; this.hooks.sound('back'); }
        break;
      }
      case 'scheme':
        if (act === 'left' || act === 'right' || act === 'up' || act === 'down') { st.scheme = st.scheme === 0 ? 1 : 0; this.hooks.sound('move'); }
        else if (act === 'confirm') { st.step = 'ready'; this.hooks.sound('select'); this.onReady(i); }
        else if (act === 'back') { st.step = 'color'; this.hooks.sound('back'); }
        break;
      case 'ready':
        if (act === 'back') { st.step = st.kind === 'human' ? 'scheme' : 'color'; this.hooks.sound('back'); if (!this.simultaneous && i === 0 && this.p[1].kind !== 'none') this.p[1].step = 'wait'; }
        break;
      default: break;
    }
    this.render();
    this.showActive();
  }

  private backFrom(i: 0 | 1): void {
    if (i === 1 && !this.simultaneous) {
      // the second pick steps back into P1's last step
      this.p[1].step = 'wait';
      this.p[0].step = this.p[0].kind === 'human' ? 'scheme' : 'color';
      this.hooks.sound('back');
      return;
    }
    this.hooks.sound('back');
    this.hooks.back();
  }

  private moveCursor(i: 0 | 1, act: CsAct): void {
    const st = this.p[i];
    const s = this.slots[st.cursor];
    if (!s) return;
    let col = s.col, row = s.row;
    const cols = Math.max(...this.slots.map((x) => x.col)) + 1;
    if (act === 'left') col = (col - 1 + cols) % cols;
    else if (act === 'right') col = (col + 1) % cols;
    else if (act === 'up') row = row === 0 ? 1 : 0;
    else if (act === 'down') row = row === 1 ? 0 : 1;
    let k = this.cells.get(`${col},${row}`);
    if (k === undefined) k = this.cells.get(`${col},0`);
    if (k === undefined || k === st.cursor) {
      if (act === 'up' || act === 'down') return;
      // a hole in the grid: keep going the same way
      for (let step = 0; step < cols && k === undefined; step++) {
        col = act === 'left' ? (col - 1 + cols) % cols : (col + 1) % cols;
        k = this.cells.get(`${col},${row}`) ?? this.cells.get(`${col},0`);
      }
      if (k === undefined) return;
    }
    st.cursor = k;
    this.hooks.sound('move');
  }

  private pickFighter(i: 0 | 1): void {
    const st = this.p[i];
    const s = this.slots[st.cursor];
    if (!s) return;
    if (s.locked) { this.hooks.sound('error'); this.flashNote(t('cs.lockedHint')); pulse(s.el, [{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], 180); return; }
    let id = s.id;
    if (id === 'random') {
      const pool = this.slots.filter((x) => x.id !== 'random' && !x.locked && !isBoss(x.id)).map((x) => x.id);
      id = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
    }
    st.fighter = id;
    const other = this.p[1 - i];
    const n = colorsOf(fighter(this.data, id)).length;
    st.color = 0;
    if (other.fighter === id && other.color === 0 && n > 1) st.color = 1;          // mirror match: never the same colours
    st.step = 'color';
    this.hooks.sound('select');
  }

  private onReady(i: 0 | 1): void {
    const st = this.p[i];
    this.hooks.show(st.fighter, st.color, 'win');
    if (!this.simultaneous && i === 0 && this.p[1].kind !== 'none' && this.p[1].step === 'wait') {
      this.p[1].step = 'fighter';
      if (this.p[1].kind === 'cpu') this.flashNote(t('cs.pickCpu'));
      else if (this.p[1].kind === 'dummy') this.flashNote(t('cs.pickDummy'));
    }
    const allReady = this.p.every((p) => p.kind === 'none' || p.step === 'ready');
    if (allReady) {
      this.hooks.sound('start');
      const pick = (p: PState): CsPick => ({ fighter: p.fighter ?? 'johnny', color: p.color, scheme: p.scheme });
      const r: CsResult = { p1: pick(this.p[0]), p2: this.p[1].kind === 'none' ? null : pick(this.p[1]) };
      window.setTimeout(() => this.hooks.done(r), 380);
    }
  }

  private onClick(idx: number): void {
    const i = this.activePlayer();
    const st = this.p[i];
    if (st.step !== 'fighter') {
      // a tap on another slot while picking colour / controls re-opens the fighter pick
      if (st.step === 'color' || st.step === 'scheme') { st.step = 'fighter'; st.fighter = null; } else return;
    }
    st.cursor = idx;
    this.pickFighter(i);
    this.render();
    this.showActive();
  }

  private onHover(idx: number): void {
    const i = this.activePlayer();
    const st = this.p[i];
    if (st.step !== 'fighter' || st.cursor === idx) return;
    st.cursor = idx;
    this.hooks.sound('move');
    this.render();
    this.showActive();
  }

  /** the net layer revealed the opponent's pick (online blind select) */
  reveal(p2: CsPick): void {
    this.blindReveal = true;
    this.p[1] = { kind: 'human', cursor: Math.max(0, this.slots.findIndex((s) => s.id === p2.fighter)), step: 'ready', fighter: p2.fighter, color: p2.color, scheme: p2.scheme };
    this.render();
  }

  private flashNote(s: string): void { setText(this.note, s); this.note.classList.toggle('on', !!s); }

  private showActive(): void {
    const i = this.activePlayer();
    const st = this.p[i];
    const id = st.fighter ?? this.slots[st.cursor]?.id ?? null;
    const shown = id === 'random' ? null : id;
    const key = `${shown}|${st.color}|${st.step}`;
    if (key === this.lastShown) return;
    this.lastShown = key;
    setText(this.stageName, shown ? (fighter(this.data, shown)?.name ?? '') : t('cs.random'));
    this.hooks.show(shown, st.color, st.step === 'ready' ? 'win' : 'idle');
  }

  // ─────────────────────────── render ───────────────────────────
  private render(): void {
    const active = this.activePlayer();
    this.slots.forEach((s, k) => {
      // a cursor sits on its slot while picking; once a fighter is picked (RANDOM included) it marks that fighter
      const on = (p: PState): boolean => (p.step === 'fighter' ? p.cursor === k : p.fighter === s.id);
      const c1 = this.p[0].kind !== 'none' && on(this.p[0]);
      const c2 = this.p[1].kind !== 'none' && this.p[1].step !== 'wait' && (this.mode !== 'online' || this.blindReveal) && on(this.p[1]);
      s.el.classList.toggle('c1', c1);
      s.el.classList.toggle('c2', c2);
      s.el.classList.toggle('picked', this.p.some((p) => p.fighter === s.id && p.step !== 'fighter'));
      s.el.setAttribute('aria-selected', String(c1 || c2));
    });
    for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) this.renderSide(i, i === active);
  }

  private renderSide(i: 0 | 1, active: boolean): void {
    const S = this.sides[i];
    const st = this.p[i];
    S.root.hidden = st.kind === 'none';
    if (st.kind === 'none') return;
    S.root.classList.toggle('active', active && st.step !== 'ready');
    const hidden = this.mode === 'online' && i === 1 && !this.blindReveal;
    setText(S.tag, st.kind === 'cpu' ? t('cs.cpu') : st.kind === 'dummy' ? t('cs.dummy') : i === 0 ? t('cs.p1') : t('cs.p2'));
    const stepKey = st.step === 'wait' ? 'cs.step.wait' : `cs.step.${st.step}`;
    setText(S.step, t(stepKey));
    const id = hidden ? null : (st.fighter ?? this.slots[st.cursor]?.id ?? null);
    const f = id && id !== 'random' ? fighter(this.data, id) : null;
    const colors = colorsOf(f);
    const col = colors[Math.min(st.color, colors.length - 1)];
    fillPortrait(S.portrait, this.data, id, st.step === 'fighter' ? null : (col?.tint ?? null));
    setText(S.name, hidden ? t('ladder.mystery') : id === 'random' ? t('cs.random') : (f?.name ?? ''));
    setText(S.persona, f?.persona ?? '');
    setText(S.arch, archetypeLabel(f));
    S.stars.replaceChildren();
    if (f) {
      const d = difficulty(f);
      S.stars.title = `${t('cs.difficulty')} ${d}/3`;
      for (let k = 0; k < 3; k++) S.stars.append(svg(ICON.star, k < d ? 'star on' : 'star'));
    }
    setText(S.hp, f?.hp ? `${t('cs.hp')} ${f.hp.toLocaleString('en-US')}` : '');
    // colour swatches (visible from the COLOR step on)
    S.colors.replaceChildren();
    S.colors.hidden = !f || st.step === 'fighter' || st.step === 'wait';
    if (f) colors.forEach((c, k) => {
      const sw = el('span', `sw${k === st.color ? ' on' : ''}`);
      sw.style.setProperty('--c', c.tint ?? '#ffd21a');
      sw.title = c.name;
      if (!c.tint) sw.classList.add('orig');
      S.colors.append(sw);
    });
    if (f && !S.colors.hidden) S.colors.append(el('span', 'swname', col?.name ?? ''));
    S.schemeBox.hidden = st.kind !== 'human' || (st.step !== 'scheme' && st.step !== 'ready');
    S.schemeBtns.forEach((b, k) => { const on = k === st.scheme; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    S.ready.hidden = st.step !== 'ready';
    S.root.dataset.step = st.step;
  }

  /** portraits arrived (setPortraits): re-fill every slot and the side cards */
  refreshPortraits(): void {
    for (const s of this.slots) { const pic = s.el.querySelector<HTMLElement>('.hp-portrait'); if (pic) fillPortrait(pic, this.data, s.id); }
    this.render();
  }

  showcaseRect(): Rect | null {
    const r = this.stage.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  readback(): Record<string, unknown> {
    return {
      mode: this.mode, simultaneous: this.simultaneous, active: this.activePlayer(),
      p: this.p.map((s) => ({ kind: s.kind, step: s.step, cursor: this.slots[s.cursor]?.id ?? null, fighter: s.fighter, color: s.color, scheme: s.scheme })),
      locked: this.slots.filter((s) => s.locked).map((s) => s.id), slots: this.slots.map((s) => s.id),
    };
  }
}
