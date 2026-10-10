// GENESIS — the game menu (Esc when nothing else is open, F2, the gamepad's Start, the portal bar's pause button): the
// doors to everything else — resume or pause, the chronicle, saves and new worlds, settings, controls, the laws of the
// world. The world keeps living behind it unless it is paused.

import type { UiHost } from './host.ts';
import { Panel } from './panel.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';

export class Menu {
  readonly panel: Panel;
  private host: UiHost;

  constructor(parent: HTMLElement, host: UiHost) {
    this.host = host;
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
      const btn = h('button', { class: 'gn-menu-b' }, h('span', { class: 'gn-menu-i', html: icon(ic) }), h('span', { class: 'gn-menu-l', text: label }), h('kbd', { text: hint }));
      btn.addEventListener('click', () => { this.close(); run(); });
      return btn;
    };
    const kb = this.host.keybinds;
    b.append(h('div', { class: 'gn-menu' },
      item(paused ? 'Let time run' : 'Pause the worlds', paused ? 'play' : 'pause', kb.hint('time.pause'), () => this.host.action('time.pause')),
      item('Back to the world', 'world', kb.hint('tool.cancel') || 'Esc', () => { /* closing is enough */ }),
      item('Chronicle', 'chronicle', kb.hint('ui.chronicle'), () => this.host.action('ui.chronicle')),
      item('Saves and worlds', 'save', kb.hint('ui.saves'), () => this.host.action('ui.saves')),
      item('Laws of this world', 'law', kb.hint('ui.laws'), () => this.host.action('ui.laws')),
      item('Powers', 'palette', kb.hint('ui.palette'), () => this.host.action('ui.palette')),
      item('Settings', 'settings', kb.hint('ui.settings'), () => this.host.action('ui.settings')),
      item('Controls', 'help', kb.hint('ui.help'), () => this.host.action('ui.help'))));
  }
}
