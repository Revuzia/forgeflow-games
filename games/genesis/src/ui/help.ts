// GENESIS — the controls card (F1 or ?): the Touch and the mouse, the camera's modes (follow, cinematic, walking,
// photo) with the mouse in each, every keyboard action with its current key (from the keybind registry, so a rebinding
// shows here at once — the photo and walking layers included), the gamepad (its camera-mode buttons too), worlds, saves
// and mods, the living world (prayers, prophets, signs, wrath) and the sigils with the miracles they cast. Generated,
// never a picture that can go stale.

import type { UiHost } from './host.ts';
import { ACTIONS, comboLabel } from './keybinds.ts';
import { mouseRows, cameraRows, worldRows, livingRows, padRows, PAD_FIXED, CAMERA_MODE_IDS } from './controlstext.ts';
import { Panel } from './panel.ts';
import { sigilGrid } from './gestures.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';

export class Help {
  readonly panel: Panel;
  private host: UiHost;

  constructor(parent: HTMLElement, host: UiHost) {
    this.host = host;
    this.panel = new Panel(parent, { name: 'help', title: 'Controls', subtitle: 'every power, anywhere, now — and if it is not in a list, say it', icon: 'help', place: 'wide', veil: true });
    this.panel.onOpen = () => this.render();
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  open(): void { this.panel.open(); }
  close(): void { this.panel.close(); }
  toggle(): void { this.panel.toggle(); }

  private render(): void {
    const b = this.panel.body;
    clear(b);
    const kb = this.host.keybinds;
    const col = (title: string, ic: string, ...rows: HTMLElement[]) => h('div', { class: 'gn-help-col' }, h('div', { class: 'gn-help-h' }, h('span', { html: icon(ic) }), title), ...rows);
    const row = (k: string, v: string) => h('div', { class: 'gn-help-r' }, h('kbd', { text: k }), h('span', { text: v }));
    const slap = comboLabel(kb.keysOf('hand.slapMod')[0] ?? 'Alt');
    const mouse = col('The Touch', 'touch', ...mouseRows((id) => kb.hint(id), slap).map(([k, v]) => row(k, v)));
    const cams = col('Camera modes', 'camera', ...cameraRows((id) => kb.hint(id)).map(([k, v]) => row(k, v)));
    const worlds = col('Worlds, saves, mods', 'save', ...worldRows((id) => kb.hint(id)).map(([k, v]) => row(k, v)));
    const living = col('The people and their god', 'regard', ...livingRows((id) => kb.hint(id)).map(([k, v]) => row(k, v)));
    const groups = new Map<string, HTMLElement[]>();
    for (const a of ACTIONS) {
      // (the camera's modes have their own column above, with what each does: their keys are not listed twice)
      if (CAMERA_MODE_IDS.has(a.id)) continue;
      const keys = kb.keysOf(a.id).map(comboLabel);
      const l = groups.get(a.group) ?? [];
      l.push(row(keys.length ? keys.join(' · ') : a.id === 'hand.primary' ? 'left button' : '—', a.label));
      groups.set(a.group, l);
    }
    const GROUP_ICON: Record<string, string> = { Camera: 'eye', Time: 'hourglass', Powers: 'radial', Touch: 'touch', 'The god': 'regard', 'Photo mode': 'camera', Walking: 'walk' };
    const keyCols = [...groups.entries()].filter(([, rows]) => rows.length).map(([g, rows]) => col(g, GROUP_ICON[g] ?? 'menu', ...rows));
    const pad = col('Gamepad', 'gamepad', ...[...PAD_FIXED, ...padRows((id) => kb.padOf(id))].map(([k, v]) => row(k, v)));
    const gest = h('div', { class: 'gn-help-col gn-help-gest' }, h('div', { class: 'gn-help-h' }, h('span', { html: icon('gesture') }), `Sigils (hold ${kb.hint('ui.gesture') || 'G'} or the middle button, draw one stroke)`));
    gest.append(sigilGrid(this.host.powers.sigils()));
    const words = h('div', { class: 'gn-help-words' },
      h('div', { class: 'gn-help-quote', text: '“Make it rain blood over Aru for three days.” “Introduce chocolate.” “Set gravity to 3.” “Teach them writing.”' }),
      h('div', { text: `Press ${kb.hint('ui.freeform') || 'Enter'} and say it: anything not in a list, the world will try — and tell you what it can do instead. ${kb.hint('ui.palette') || '/'} searches every power, law, place and person.` }));
    b.append(h('div', { class: 'gn-help-grid' }, mouse, living, cams, worlds, ...keyCols, pad), gest, words);
  }
}
