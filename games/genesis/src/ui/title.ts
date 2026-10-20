// GENESIS — the front door (the parity audit's A1; the owner's "a proper menu"): a title over the slowly turning world.
//   Continue        the newest kept moment (a slot or the autosave), opened in place; after "Quit to title" it is the
//                   world just left, as it was
//   New world       the scenario picker (src/ui/newworld.ts): the barren world plays the opening, the others begin
//   Load            the saves (src/ui/saves.ts): slots, import a file
//   Settings · Controls · Credits & licences
// A returning player's cold load shows it (src/app.ts decides: a first visit goes straight into the opening; a page
// opened with a scenario, a save or the harness's switches goes straight into that world). The world behind it is
// scenery: the camera turns slowly round it, the interface steps aside (the site's bar stays), and nothing on the world
// takes a click. Windows opened from the title draw over it and give it back when they close.
// Keys: ↑ ↓ (or the D-pad) move, Enter (or A) chooses; Esc closes a window opened from it.

import type { UiHost } from './host.ts';
import type { SaveMeta } from './saves.ts';
import { scenarioName } from './saves.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';

export interface TitleDeps {
  host: UiHost;
  /** the kept moments, newest first */
  list(): Promise<SaveMeta[]>;
  /** open a kept moment in place (the page reloads for one that needs a fresh simulation); true when it opened */
  load(id: string): Promise<boolean>;
  openWindow(which: 'newWorld' | 'saves' | 'settings' | 'help' | 'credits'): void;
  /** the slow turn of the camera round the world behind the title */
  camera(on: boolean): void;
  /** the interface behind the title: stepped aside, or back */
  setHud(titled: boolean): void;
}

interface Item { id: string; label: string; sub: string; icon: string; run: () => void; disabled?: boolean }

export class Title {
  readonly root: HTMLDivElement;
  private deps: TitleDeps;
  private menu: HTMLDivElement;
  private foot: HTMLDivElement;
  private newest: SaveMeta | null = null;
  private listed = false;
  private busy: string | null = null;
  /** shown after "Quit to title": Continue returns to the world behind it, as it is */
  private fromGame = false;
  private worldName = '';
  /** what the title was closed by (test surface) */
  last: string | null = null;
  /** told when the title closes (the shell gives the world its speed back) */
  onClose: ((how: string) => void) | null = null;

  constructor(parent: HTMLElement, deps: TitleDeps) {
    this.deps = deps;
    this.menu = h('div', { class: 'gn-title-menu', role: 'menu', aria: { label: 'GENESIS' } });
    this.foot = h('div', { class: 'gn-title-foot' });
    this.root = h('div', { class: 'gn-title', role: 'dialog', aria: { label: 'GENESIS — title' } },
      h('div', { class: 'gn-title-shade' }),
      h('div', { class: 'gn-title-col' },
        h('div', { class: 'gn-title-mark', text: 'GENESIS' }),
        h('div', { class: 'gn-title-sub', text: 'You poured water on a dead rock. Now they have a word for you.' }),
        this.menu),
      this.foot);
    this.root.hidden = true;
    this.root.addEventListener('keydown', (e) => this.key(e));
    this.root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    parent.appendChild(this.root);
  }

  get isOpen(): boolean { return !this.root.hidden; }

  /** show the title (`fromGame`: the player quit to it from a world, which stays behind it as it was) */
  open(o: { fromGame?: boolean } = {}): void {
    this.fromGame = !!o.fromGame;
    this.worldName = this.deps.host.view.planet(this.deps.host.primary())?.name ?? '';
    this.root.hidden = false;
    this.root.classList.remove('gn-title-out');
    this.deps.setHud(true);
    this.deps.camera(true);
    this.listed = false;
    this.render();
    void this.refresh();
    requestAnimationFrame(() => (this.menu.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.focus({ preventScroll: true }));
  }

  /** put the title away (a world chosen, continued or loaded) */
  close(how = 'close'): void {
    if (!this.isOpen) return;
    this.last = how;
    this.root.classList.add('gn-title-out');
    this.root.hidden = true;
    this.deps.camera(false);
    this.deps.setHud(false);
    this.onClose?.(how);
  }

  private async refresh(): Promise<void> {
    try { this.newest = (await this.deps.list())[0] ?? null; } catch { this.newest = null; }
    this.listed = true;
    if (this.isOpen) this.render();
  }

  private items(): Item[] {
    const n = this.newest;
    const cont: Item = this.fromGame
      ? { id: 'continue', label: 'Continue', sub: `Return to ${this.worldName || 'the world'}`, icon: 'play', run: () => this.close('continue') }
      : {
        id: 'continue', label: 'Continue', icon: 'play', disabled: !n,
        sub: !this.listed ? 'Looking for your worlds…' : n ? `${n.name}${n.world ? ` · ${n.world}` : ''}${n.calendar ? ` · ${n.calendar.replace(/ · \d\d:\d\d$/, '')}` : ''}` : 'Nothing kept yet: begin a new world',
        run: () => void this.continueNewest(),
      };
    return [
      cont,
      { id: 'new', label: 'New world', sub: 'A barren rock and its opening, two worlds, a living system, the sandbox, your own', icon: 'new-world', run: () => this.deps.openWindow('newWorld') },
      { id: 'load', label: 'Load', sub: 'Your kept moments, or a file', icon: 'save', run: () => this.deps.openWindow('saves') },
      { id: 'settings', label: 'Settings', sub: 'The look, the sound, the keys', icon: 'settings', run: () => this.deps.openWindow('settings') },
      { id: 'controls', label: 'Controls', sub: 'Every key, button and sigil', icon: 'keyboard', run: () => this.deps.openWindow('help') },
      { id: 'credits', label: 'Credits & licences', sub: 'Who made it, and what it is made with', icon: 'credits', run: () => this.deps.openWindow('credits') },
    ];
  }

  private render(): void {
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.id ?? null;
    clear(this.menu);
    for (const it of this.items()) {
      const busy = this.busy === it.id;
      const b = h('button', { class: `gn-title-b${it.id === 'continue' ? ' gn-title-main' : ''}`, role: 'menuitem', data: { id: it.id }, disabled: it.disabled || !!this.busy },
        h('span', { class: 'gn-title-i', html: icon(it.icon) }),
        h('span', { class: 'gn-title-t' }, h('span', { class: 'gn-title-l', text: busy ? 'Returning…' : it.label }), h('small', { text: it.sub })));
      b.addEventListener('click', () => { if (!this.busy) { this.deps.host.sound('ui.confirm'); it.run(); } });
      this.menu.append(b);
    }
    if (focused) (this.menu.querySelector(`[data-id="${focused}"]`) as HTMLButtonElement | null)?.focus({ preventScroll: true });
    clear(this.foot);
    const n = this.newest;
    this.foot.append(
      h('span', { text: 'a ForgeFlow game' }),
      h('span', { class: 'gn-sep', text: '·' }),
      h('span', { text: n && !this.fromGame ? `last kept ${new Date(n.date).toLocaleDateString()} · ${scenarioName(n.scenario)}` : 'a living world on a small planet' }),
    );
  }

  /** Continue: the newest kept moment, opened here */
  private async continueNewest(): Promise<void> {
    const n = this.newest;
    if (!n || this.busy) return;
    this.busy = 'continue';
    this.render();
    try {
      const ok = await this.deps.load(n.id);
      if (ok) this.close('continue');
    } finally {
      this.busy = null;
      if (this.isOpen) this.render();
    }
  }

  /** ↑ ↓ move between the doors (Enter presses the focused one, as any button) */
  private key(e: KeyboardEvent): void {
    if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
    const items = Array.from(this.menu.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.code === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }

  /** test surface */
  state(): { open: boolean; fromGame: boolean; newest: string | null; items: { id: string; disabled: boolean; sub: string }[]; last: string | null } {
    return { open: this.isOpen, fromGame: this.fromGame, newest: this.newest?.name ?? null, items: this.items().map((i) => ({ id: i.id, disabled: !!i.disabled, sub: i.sub })), last: this.last };
  }

  /** the door with this id, pressed (test surface: the same click a player makes) */
  press(id: string): boolean {
    const b = this.menu.querySelector<HTMLButtonElement>(`[data-id="${id}"]`);
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }
}

/**
 * Should a cold load show the title? Not for a page opened into a world (a scenario, a save, the harness's switches),
 * and not on the first visit ever (that goes straight into the opening); yes for a returning player. `?title=1` / `0`
 * force it.
 */
export function wantTitle(search: string, returning: boolean): boolean {
  const p = new URLSearchParams(search);
  const t = p.get('title');
  if (t === '1') return true;
  if (t === '0') return false;
  for (const k of ['scenario', 'load', 'intro', 'cam', 'source', 'mods', 'mod', 'star', 'worlds', 'hour']) if (p.has(k)) return false;
  if (p.get('ui') === '0') return false;
  return returning;
}

/** the mark a visit leaves: the next cold load is a returning player's */
const PLAYED_KEY = 'genesis.played.v1';
export function hasPlayed(): boolean {
  try { return localStorage.getItem(PLAYED_KEY) === '1'; } catch { return false; }
}
export function markPlayed(): void {
  try { localStorage.setItem(PLAYED_KEY, '1'); } catch { /* a private window: every visit is a first one */ }
}
