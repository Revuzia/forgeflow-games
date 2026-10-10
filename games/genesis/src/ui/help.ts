// GENESIS — the controls card (F1 or ?): the hand and the mouse, every keyboard action with its current key (from the
// keybind registry, so a rebinding shows here at once), the gamepad, and the gesture shapes with the miracles they
// cast. Generated, never a picture that can go stale.

import type { UiHost } from './host.ts';
import { ACTIONS, comboLabel } from './keybinds.ts';
import { Panel } from './panel.ts';
import { shapePolyline } from './unistroke.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';

/** the mouse and the hand, with the keys that go with them as they are bound now */
function mouseRows(hint: (id: string) => string, slap: string): [string, string][] {
  const size = [hint('tool.smaller'), hint('tool.bigger')].filter(Boolean).join(' ');
  const strength = [hint('tool.weaker'), hint('tool.stronger')].filter(Boolean).join(' ');
  return [
    ['drag the land', 'turn the world under you'],
    ['wheel', 'descend / rise'],
    ['Ctrl + wheel', `brush size${size ? ` (keys: ${size})` : ''}`],
    ['Alt + wheel', `brush strength${strength ? ` (keys: ${strength})` : ''}`],
    ['right-drag', 'turn and tilt the view'],
    ['click', 'inspect a person, a building, a town, a creature…'],
    ['drag someone', 'pick them up — flick and let go to throw'],
    [hint('hand.throw') || '⇧ E', 'while carrying: hold to aim a throw at the cursor, let go to throw'],
    ['rub someone', 'stroke: comfort, heal, reward the creature'],
    [`${slap} + click`, 'slap: punish (the modifier is rebindable)'],
    ['long press', 'the radial menu at that spot'],
    ['middle-drag', 'draw a gesture'],
    ['power armed', `click / drag on the ground to use it · right-click or ${hint('tool.cancel') || 'Esc'} puts it away`],
  ];
}

/** the sticks and menu navigation (not rebindable); the buttons come from the keybind registry */
const PAD_FIXED: [string, string][] = [
  ['left stick', 'the cursor (push to the edge to pan)'],
  ['right stick', 'turn and tilt the view · points in the radial'],
  ['D-pad / A / B', 'in a menu or panel: move, press, back'],
];

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
    const mouse = col('The hand', 'open-hand', ...mouseRows((id) => kb.hint(id), slap).map(([k, v]) => row(k, v)));
    const groups = new Map<string, HTMLElement[]>();
    for (const a of ACTIONS) {
      const keys = kb.keysOf(a.id).map(comboLabel);
      const l = groups.get(a.group) ?? [];
      l.push(row(keys.length ? keys.join(' · ') : a.id === 'hand.primary' ? 'left button' : '—', a.label));
      groups.set(a.group, l);
    }
    const keyCols = [...groups.entries()].map(([g, rows]) => col(g, g === 'Camera' ? 'eye' : g === 'Time' ? 'hourglass' : g === 'Powers' ? 'radial' : g === 'Hand' ? 'open-hand' : 'menu', ...rows));
    const padRows = PAD_FIXED.map(([k, v]) => row(k, v));
    for (const a of ACTIONS) {
      const pads = kb.padOf(a.id);
      if (pads.length) padRows.push(row(pads.map((p) => (a.hold && !/hold/i.test(a.label) ? `${p} (hold)` : p)).join(' · '), a.label));
    }
    const pad = col('Gamepad', 'gamepad', ...padRows);
    const gest = h('div', { class: 'gn-help-col gn-help-gest' }, h('div', { class: 'gn-help-h' }, h('span', { html: icon('gesture') }), `Gestures (hold ${kb.hint('ui.gesture') || 'G'} or the middle button, draw)`));
    const grid = h('div', { class: 'gn-gest-grid' });
    for (const [shape, p] of this.host.powers.gestures()) {
      const poly = shapePolyline(shape, 30, 3);
      grid.append(h('div', { class: 'gn-gest-item', title: p.desc },
        h('span', { class: 'gn-gest-shape', html: poly ? `<svg viewBox="0 0 30 30"><polyline points="${poly}"/></svg>` : '' }),
        h('span', { class: 'gn-gest-name', text: p.name }), h('span', { class: 'gn-gest-sh', text: shape.replace('-', ' ') })));
    }
    gest.append(grid);
    const words = h('div', { class: 'gn-help-words' },
      h('div', { class: 'gn-help-quote', text: '“Make it rain blood over Aru for three days.” “Introduce chocolate.” “Set gravity to 3.” “Teach them writing.”' }),
      h('div', { text: `Press ${kb.hint('ui.freeform') || 'Enter'} and say it: anything not in a list, the world will try — and tell you what it can do instead. ${kb.hint('ui.palette') || '/'} searches every power, law, place and person.` }));
    b.append(h('div', { class: 'gn-help-grid' }, mouse, ...keyCols, pad), gest, words);
  }
}
