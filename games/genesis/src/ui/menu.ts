// GENESIS — the game menu (Esc when nothing else is open, F2, the gamepad's Start, the site bar's Pause — which also
// stops time, src/ui/embed.ts): the doors to everything else — resume or pause, the chronicle, the god's window and
// a sign to send (the gamepad's way to them), saves, a new world,
// mods, photo mode, the laws of the world, powers, settings, controls, credits, and quitting to the title (the world is
// kept as the autosave first). The world keeps living behind it unless it is paused. Below ~600 px of height (the
// site's 888 × 500 frame) its doors stand in two columns (styles.css), so all of them show without scrolling.

import type { UiHost } from './host.ts';
import { Panel } from './panel.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';

export interface MenuDeps {
  /** keep the world as the autosave and show the title over it */
  quitToTitle(): void;
}

export class Menu {
  readonly panel: Panel;
  private host: UiHost;
  private deps: MenuDeps;

  constructor(parent: HTMLElement, host: UiHost, deps: MenuDeps) {
    this.host = host;
    this.deps = deps;
    this.panel = new Panel(parent, { name: 'menu', title: 'GENESIS', subtitle: 'You poured water on a dead rock. Now they have a word for you.', icon: 'world', place: 'center', veil: true });
    this.panel.onOpen = () => this.render();
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  open(): void { this.panel.open(); (this.panel.body.querySelector('button') as HTMLButtonElement | null)?.focus(); }
  close(): void { this.panel.close(); }
  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

  private render(): void {
    const b = this.panel.body;
    clear(b);
    const paused = this.host.view.speed === 0;
    const item = (label: string, ic: string, hint: string, run: () => void) => {
      const btn = h('button', { class: 'gn-menu-b' }, h('span', { class: 'gn-menu-i', html: icon(ic) }), h('span', { class: 'gn-menu-l', text: label }), hint ? h('kbd', { text: hint }) : h('span'));
      btn.addEventListener('click', () => { this.close(); run(); });
      return btn;
    };
    const kb = this.host.keybinds;
    b.append(h('div', { class: 'gn-menu' },
      item(paused ? 'Let time run' : 'Pause the worlds', paused ? 'play' : 'pause', kb.hint('time.pause'), () => this.host.action('time.pause')),
      item('Back to the world', 'world', kb.hint('tool.cancel') || 'Esc', () => { /* closing is enough */ }),
      item('Chronicle', 'chronicle', kb.hint('ui.chronicle'), () => this.host.action('ui.chronicle')),
      item('The god', 'regard', kb.hint('ui.god'), () => this.host.action('ui.god')),
      item('Send a sign', 'sign', kb.hint('ui.signs'), () => this.host.action('ui.signs')),
      item('Saves', 'save', kb.hint('ui.saves'), () => this.host.action('ui.saves')),
      item('A new world', 'new-world', kb.hint('ui.newWorld'), () => this.host.action('ui.newWorld')),
      item('Mods', 'mods', kb.hint('ui.mods'), () => this.host.action('ui.mods')),
      item('Photo mode', 'camera', kb.hint('cam.photo'), () => this.host.action('cam.photo')),
      item('Laws of this world', 'law', kb.hint('ui.laws'), () => this.host.action('ui.laws')),
      item('Powers', 'palette', kb.hint('ui.palette'), () => this.host.action('ui.palette')),
      item('Settings', 'settings', kb.hint('ui.settings'), () => this.host.action('ui.settings')),
      item('Controls', 'help', kb.hint('ui.help'), () => this.host.action('ui.help')),
      item('Credits & licences', 'credits', '', () => this.host.action('ui.credits')),
      item('Quit to title', 'title', '', () => this.deps.quitToTitle())));
  }
}
