// GENESIS — the camera modes as the player sees them (CONTRACT.md §15.8, §16): what the camera is doing and how to stop.
//   follow     a chip at the top: "Following Shudak" — Stop, or the follow key / Esc
//   cinematic  the interface steps aside, letterbox bars draw in, the place's name rises like a film title and fades;
//              a drag (or Esc) takes the camera back
//   walk       a chip with the walking keys (W A S D, Shift runs, drag to look, the key that rises), fading to a short
//              reminder; a small crosshair while the gamepad drives (powers land where you look)
//   menu       the camera modes in one list (the ` key, the gamepad's View button): orbit, follow, cinematic, walk, photo,
//              free flight, the system — each with its key, the ones that need a selection greyed without one
// Photo mode has its own panel (src/ui/photo.ts). This module only draws; the modes themselves are the App's
// (src/ui/host.ts CameraHost).

import type { UiHost, InspectRef, CameraModeName } from './host.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';

export interface CameraUiDeps {
  host: UiHost;
  /** a thing's name as people read it ("Shudak", "Aru by the Lake") */
  nameOf(ref: InspectRef): string | null;
  uiVisible(): boolean;
  /** run an action by id (the menu's rows) */
  action(id: string): void;
}

interface MenuItem { id: string; label: string; icon: string; action: string; ok: boolean; why?: string }

export class CameraUi {
  readonly layer: HTMLDivElement;
  private deps: CameraUiDeps;
  private host: UiHost;
  private chip: HTMLDivElement;
  private bars: HTMLDivElement[];
  private title: HTMLDivElement;
  private cross: HTMLDivElement;
  readonly menu: HTMLDivElement;
  private mode: CameraModeName = 'orbit';
  private since = 0;
  private revealUntil = 0;
  private subjectKey = '';
  private menuSel = 0;
  private items: MenuItem[] = [];

  constructor(parent: HTMLElement, deps: CameraUiDeps) {
    this.deps = deps;
    this.host = deps.host;
    this.layer = h('div', { class: 'gn-ui gn-cam-layer' });
    this.bars = [h('div', { class: 'gn-cine-bar gn-cine-top' }), h('div', { class: 'gn-cine-bar gn-cine-bottom' })];
    this.title = h('div', { class: 'gn-cine-title' });
    this.chip = h('div', { class: 'gn-panel gn-cam-chip', role: 'status', aria: { live: 'polite' } });
    this.chip.hidden = true;
    this.cross = h('div', { class: 'gn-cam-cross' });
    this.cross.hidden = true;
    this.menu = h('div', { class: 'gn-panel gn-cam-menu', role: 'menu', aria: { label: 'Camera modes' } });
    this.menu.hidden = true;
    this.menu.addEventListener('keydown', (e) => this.menuKey(e));
    this.layer.append(...this.bars, this.title, this.chip, this.cross, this.menu);
    parent.appendChild(this.layer);
    document.addEventListener('pointerdown', (e) => { if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.closeMenu(); }, true);
  }

  get menuOpen(): boolean { return !this.menu.hidden; }

  /** the pointer moved: the cinematic's hint shows again for a moment */
  pointerMoved(): void {
    if (this.mode === 'dolly') this.revealUntil = performance.now() + 2500;
  }

  // ───────────────────────────── per frame ─────────────────────────────

  frame(padActive: boolean): void {
    const cam = this.host.cam;
    if (!cam) return;
    const mode = cam.mode();
    const now = performance.now();
    const sub = cam.subject();
    const key = `${mode}|${sub ? `${sub.kind}:${sub.id}` : ''}`;
    if (key !== this.subjectKey) {
      this.subjectKey = key;
      if (mode !== this.mode) { this.mode = mode; this.since = now; }
      this.renderChip(mode, sub);
      if (mode === 'dolly') this.renderTitle(sub);
    }
    const cine = mode === 'dolly';
    this.layer.classList.toggle('gn-cine', cine);
    // the title rises, holds and fades; the hint under it comes back when the pointer moves
    const t = (now - this.since) / 1000;
    this.title.classList.toggle('gn-on', cine && (t < 6 || now < this.revealUntil));
    this.title.classList.toggle('gn-cine-hint-only', cine && t >= 6);
    const showChip = mode === 'follow' || mode === 'walk';
    this.chip.hidden = !showChip || !this.deps.uiVisible();
    // the walking chip shortens after a while
    this.chip.classList.toggle('gn-cam-chip-short', mode === 'walk' && t > 9);
    // the crosshair: where powers land while the gamepad drives the walking eye
    this.cross.hidden = !(mode === 'walk' && padActive);
  }

  private renderChip(mode: CameraModeName, sub: InspectRef | null): void {
    clear(this.chip);
    const kb = this.host.keybinds;
    const name = sub ? this.deps.nameOf(sub) : null;
    if (mode === 'follow') {
      const stop = h('button', { class: 'gn-btn', text: 'Stop', on: { click: () => this.host.follow(null) } });
      this.chip.append(h('span', { class: 'gn-cam-ic', html: icon('follow') }), h('span', { class: 'gn-cam-k', text: 'Following' }), h('span', { class: 'gn-cam-n', text: name ?? '…' }),
        h('span', { class: 'gn-cam-keys' }, h('kbd', { text: kb.hint('cam.follow') || 'L' }), ' or ', h('kbd', { text: 'Esc' }), ' stops'), stop);
    } else if (mode === 'walk') {
      const k = (id: string, d: string) => kb.hint(id) || d;
      const leave = h('button', { class: 'gn-btn', text: 'Rise', on: { click: () => this.host.cam?.walk(null, true) } });
      this.chip.append(h('span', { class: 'gn-cam-ic', html: icon('walk') }), h('span', { class: 'gn-cam-k', text: 'Walking among them' }),
        h('span', { class: 'gn-cam-keys gn-cam-long' },
          h('kbd', { text: `${k('cam.forward', 'W')} ${k('cam.left', 'A')} ${k('cam.back', 'S')} ${k('cam.right', 'D')}` }), ' walk · ', h('kbd', { text: '⇧' }), ' run · drag to look · ',
          h('kbd', { text: `${k('cam.turnLeft', 'Z')} ${k('cam.turnRight', 'X')}` }), ' turn · your powers work here too · '),
        h('span', { class: 'gn-cam-keys' }, h('kbd', { text: k('walk.exit', 'K') }), ' or ', h('kbd', { text: 'Esc' }), ' rises'), leave);
    }
  }

  private renderTitle(sub: InspectRef | null): void {
    clear(this.title);
    const v = this.host.view;
    const name = sub ? this.deps.nameOf(sub) : null;
    const pv = v.planet(sub?.planet ?? this.host.primary());
    const st = sub && sub.kind === 'settlement' && pv ? pv.settlements.find((s) => s.id === sub.id) : null;
    const c = pv ? v.calendar(pv) : null;
    const era = st?.era ? `${st.era.charAt(0).toUpperCase()}${st.era.slice(1)} age` : '';
    const line = [pv?.name, c ? `Year ${c.year}` : '', era, st ? `${st.population} souls` : ''].filter(Boolean).join(' · ');
    this.title.append(h('div', { class: 'gn-cine-name', text: name ?? pv?.name ?? '' }), h('div', { class: 'gn-cine-line', text: line }),
      h('div', { class: 'gn-cine-hint', text: 'drag to take the camera back · Esc' }));
  }

  // ───────────────────────────── the menu ─────────────────────────────

  private menuItems(): MenuItem[] {
    const host = this.host;
    const sel = host.selected();
    const followable = !!sel && ['agent', 'animal', 'creature', 'disaster', 'ship', 'weather'].includes(sel.kind);
    const pv = host.view.planet(host.primary());
    const towns = pv ? pv.settlements.some((s) => !(s.flags & 2)) : false;
    const mode = host.cam?.mode() ?? 'orbit';
    return [
      { id: 'orbit', label: 'Orbit this world', icon: 'world', action: 'cam.home', ok: true },
      { id: 'follow', label: mode === 'follow' ? 'Stop following' : 'Follow the selection', icon: 'follow', action: 'cam.follow', ok: followable || mode === 'follow', why: 'select a person, a herd, a creature or a ship first' },
      { id: 'dolly', label: mode === 'dolly' ? 'End the cinematic' : 'Cinematic', icon: 'film', action: 'cam.dolly', ok: towns || mode === 'dolly', why: 'there is no settlement on this world yet' },
      { id: 'walk', label: mode === 'walk' ? 'Rise from the ground' : 'Walk among them', icon: 'walk', action: 'cam.walk', ok: !!pv },
      { id: 'photo', label: 'Photo mode', icon: 'camera', action: 'cam.photo', ok: true },
      { id: 'fly', label: 'Free flight', icon: 'eye', action: 'cam.fly', ok: true },
      { id: 'system', label: 'The whole system', icon: 'orbit', action: 'cam.system', ok: true },
    ];
  }

  openMenu(): void {
    this.items = this.menuItems();
    const mode = this.host.cam?.mode() ?? 'orbit';
    this.menuSel = Math.max(0, this.items.findIndex((x) => x.id === mode));
    this.renderMenu();
    this.menu.hidden = false;
    this.host.sound('ui.open');
    (this.menu.querySelectorAll('button')[this.menuSel] as HTMLButtonElement | undefined)?.focus();
  }

  closeMenu(): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.host.sound('ui.close');
  }

  toggleMenu(): void { if (this.menuOpen) this.closeMenu(); else this.openMenu(); }

  private renderMenu(): void {
    clear(this.menu);
    const kb = this.host.keybinds;
    this.menu.append(h('div', { class: 'gn-cam-mh', text: 'Camera' }));
    this.items.forEach((it, i) => {
      const b = h('button', { class: `gn-cam-mi${i === this.menuSel ? ' gn-sel' : ''}`, role: 'menuitem', disabled: !it.ok, title: it.ok ? '' : it.why ?? '' },
        h('span', { class: 'gn-cam-ic', html: icon(it.icon) }), h('span', { class: 'gn-cam-ml', text: it.label }), h('kbd', { text: kb.hint(it.action) || '' }));
      b.addEventListener('click', () => this.pick(i));
      b.addEventListener('pointerenter', () => { this.menuSel = i; this.mark(); });
      this.menu.append(b);
    });
  }

  private mark(): void {
    this.menu.querySelectorAll('.gn-cam-mi').forEach((b, i) => b.classList.toggle('gn-sel', i === this.menuSel));
  }

  private pick(i: number): void {
    const it = this.items[i];
    if (!it || !it.ok) { this.host.sound('ui.error'); return; }
    this.closeMenu();
    this.deps.action(it.action);
  }

  /** move the menu's selection (the pad's D-pad, arrow keys) */
  move(d: number): void {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const j = (this.menuSel + d * k + n * 4) % n;
      if (this.items[j].ok) { this.menuSel = j; break; }
    }
    this.mark();
    (this.menu.querySelectorAll('button')[this.menuSel] as HTMLButtonElement | undefined)?.focus();
    this.host.sound('ui.tick');
  }

  accept(): void { this.pick(this.menuSel); }

  private menuKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); this.move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this.move(-1); }
  }

  state(): Record<string, unknown> {
    return { mode: this.mode, chip: !this.chip.hidden, chipText: this.chip.textContent, cinematic: this.layer.classList.contains('gn-cine'), title: this.title.textContent, menu: this.menuOpen, menuItems: this.items.map((x) => `${x.id}${x.ok ? '' : ' (off)'}`) };
  }
}
