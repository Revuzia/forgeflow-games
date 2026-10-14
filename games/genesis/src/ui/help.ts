// GENESIS — the controls card (F1 or ?): the hand and the mouse, the camera's modes (follow, cinematic, walking,
// photo) with the mouse in each, every keyboard action with its current key (from the keybind registry, so a rebinding
// shows here at once — the photo and walking layers included), the gamepad (its camera-mode buttons too), worlds, saves
// and mods, and the gesture shapes with the miracles they cast. Generated, never a picture that can go stale.

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
    ['click', 'inspect a person, a building, a town, a herd, the ground…'],
    ['drag someone', 'pick them up — flick and let go to throw'],
    [hint('hand.throw') || '⇧ E', 'while carrying: hold to aim a throw at the cursor, let go to throw'],
    ['rub someone', 'stroke: comfort them, heal a little — they feel it'],
    [`${slap} + click`, 'slap: punish (the modifier is rebindable)'],
    ['long press', 'the radial menu at that spot'],
    ['middle-drag', 'draw a gesture'],
    ['power armed', `click / drag on the ground to use it · right-click or ${hint('tool.cancel') || 'Esc'} puts it away`],
  ];
}

/** the camera actions the "Camera modes" column explains (left out of the Camera keys column) */
const CAMERA_MODE_IDS = new Set(['cam.menu', 'cam.follow', 'cam.dolly', 'cam.walk', 'cam.photo', 'cam.fly', 'cam.system', 'cam.home']);

/** the sticks and menu navigation (not rebindable); the buttons come from the keybind registry */
const PAD_FIXED: [string, string][] = [
  ['left stick', 'the cursor (push to the edge to pan) · walking: walk · photo: move'],
  ['right stick', 'turn and tilt the view · points in the radial · following: circle them · walking and photo: look'],
  ['LB · RB', 'rise · descend · following: farther · nearer · walking: to and from eye level · photo: wider · longer lens'],
  ['D-pad / A / B', 'in a menu or panel: move, press, back'],
];

/** the camera's modes: where each comes from, what the mouse does there, how to leave (keys are the bound ones) */
function cameraRows(hint: (id: string) => string): [string, string][] {
  const k = (id: string, d: string) => hint(id) || d;
  const move = `${k('cam.forward', 'W')} ${k('cam.left', 'A')} ${k('cam.back', 'S')} ${k('cam.right', 'D')}`;
  return [
    [k('cam.menu', '`'), 'every camera mode in one list (gamepad: Back / View, then the D-pad and A)'],
    [k('cam.follow', 'L'), 'follow the selection (the inspector\'s Follow) · drag circles them, wheel nearer / farther · Esc stops'],
    [k('cam.dolly', 'J'), 'cinematic: circle the selected settlement (the inspector\'s Cinematic) · drag or Esc ends it'],
    [k('cam.walk', 'K'), `walk among them, at the selection or the cursor (the inspector's Walk) · ${move} walk, ⇧ runs, drag looks, ${k('walk.float', 'R')} jumps and floats, ${k('walk.sink', 'F')} comes down, wheel to eye level · ${k('walk.exit', 'K')} or Esc rises`],
    [k('cam.photo', 'P'), `photo mode: the interface goes, time stands still · drag looks, ${move} ${k('photo.rise', 'R')} ${k('photo.sink', 'F')} move, wheel zooms, click focuses · ${k('photo.capture', 'Space')} takes the picture`],
    [k('cam.fly', 'V'), 'free flight · ' + k('cam.system', 'M') + ' the whole system · ' + k('cam.home', 'Home') + ' back to orbit'],
  ];
}

/** worlds, saves and mods */
function worldRows(hint: (id: string) => string): [string, string][] {
  const k = (id: string, d: string) => hint(id) || d;
  return [
    ['the opening', 'a key or a click lights the star · any key goes straight to the world · Esc: the scenario menu (stay, or another world) · “hush” ends the whispers'],
    [k('ui.newWorld', 'F3'), 'a new world: the barren world, two worlds, a living system, the sandbox, your own system — with a seed'],
    [k('ui.saves', 'F6'), 'saves: slots with a picture and the date, export to a file, import one, autosave'],
    [`${k('ui.quicksave', 'F5')} · ${k('ui.quickload', 'F9')}`, 'quicksave · quickload'],
    [k('ui.mods', 'F8'), 'mods: load a content pack (JSON) from a file or an address; ?mod=<address> at start'],
  ];
}

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
    const cams = col('Camera modes', 'camera', ...cameraRows((id) => kb.hint(id)).map(([k, v]) => row(k, v)));
    const worlds = col('Worlds, saves, mods', 'save', ...worldRows((id) => kb.hint(id)).map(([k, v]) => row(k, v)));
    const groups = new Map<string, HTMLElement[]>();
    for (const a of ACTIONS) {
      // (the camera's modes have their own column above, with what each does: their keys are not listed twice)
      if (CAMERA_MODE_IDS.has(a.id)) continue;
      const keys = kb.keysOf(a.id).map(comboLabel);
      const l = groups.get(a.group) ?? [];
      l.push(row(keys.length ? keys.join(' · ') : a.id === 'hand.primary' ? 'left button' : '—', a.label));
      groups.set(a.group, l);
    }
    const GROUP_ICON: Record<string, string> = { Camera: 'eye', Time: 'hourglass', Powers: 'radial', Hand: 'open-hand', 'Photo mode': 'camera', Walking: 'walk' };
    const keyCols = [...groups.entries()].filter(([, rows]) => rows.length).map(([g, rows]) => col(g, GROUP_ICON[g] ?? 'menu', ...rows));
    const padRows = PAD_FIXED.map(([k, v]) => row(k, v));
    for (const a of ACTIONS) {
      const pads = kb.padOf(a.id);
      const where = a.context === 'photo' ? ' (photo mode)' : a.context === 'walk' ? ' (walking)' : '';
      // (a held button says so once, on the button)
      const label = a.hold ? a.label.replace(/\s*\(hold\)/i, '') : a.label;
      if (pads.length) padRows.push(row(pads.map((p) => (a.hold && !/hold/i.test(label) ? `${p} (hold)` : p)).join(' · '), `${label}${where}`));
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
    b.append(h('div', { class: 'gn-help-grid' }, mouse, cams, worlds, ...keyCols, pad), gest, words);
  }
}
