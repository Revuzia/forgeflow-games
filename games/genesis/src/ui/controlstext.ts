// GENESIS — the controls as words, from one source: the F1 card (help.ts), the site listing's controls lines
// (public/game_meta.json controls_keyboard / controls_gamepad) and CONTROLS.md are all built from the keybind registry
// (keybinds.ts ACTIONS) and the rows below, so none of them can drift from the keys the game really reads.
// DOM-free at import (tests/ui-meta.test.ts checks the shipped meta and CONTROLS.md against these generators;
// `node _harness/gen-controls.ts` rewrites them after a binding changes).

import { ACTIONS, ACTION_BY_ID, SPEED_KEYS, comboLabel } from './keybinds.ts';

/** an action's first key as people read it ("" when unbound) */
export type Hint = (id: string) => string;

/** the default bindings' hint (what a fresh player has) */
export const defaultHint: Hint = (id) => {
  const k = ACTION_BY_ID.get(id)?.keys[0];
  return k ? comboLabel(k) : '';
};

/** the mouse and the Touch, with the keys that go with them as they are bound now */
export function mouseRows(hint: Hint, slap: string): [string, string][] {
  const size = [hint('tool.smaller'), hint('tool.bigger')].filter(Boolean).join(' ');
  const strength = [hint('tool.weaker'), hint('tool.stronger')].filter(Boolean).join(' ');
  return [
    ['drag the land', 'turn the world under you'],
    ['wheel', 'descend / rise'],
    ['Ctrl + wheel', `brush size${size ? ` (keys: ${size})` : ''}`],
    ['Alt + wheel', `brush strength${strength ? ` (keys: ${strength})` : ''}`],
    ['right-drag', 'turn and tilt the view'],
    ['click', 'inspect a person, a building, a town, a herd, the ground…'],
    ['drag someone', 'lift them in the Touch — flick and let go to hurl'],
    [hint('hand.throw') || '⇧ E', 'while carrying: hold to aim a hurl at the cursor, let go to hurl'],
    ['rub someone', 'soothe: comfort them, heal a little — they feel it'],
    [`${slap} + click`, 'rebuke: a sharp blow (hurts a person, cracks a wall; the modifier is rebindable)'],
    ['long press', 'the radial menu at that spot'],
    ['middle-drag', 'draw a sigil'],
    ['power armed', `click / drag on the ground to use it · right-click or ${hint('tool.cancel') || 'Esc'} puts it away`],
  ];
}

/** the camera actions the "Camera modes" rows explain (left out of the Camera keys list) */
export const CAMERA_MODE_IDS = new Set(['cam.menu', 'cam.follow', 'cam.dolly', 'cam.walk', 'cam.photo', 'cam.fly', 'cam.system', 'cam.home']);

/** the camera's modes: where each comes from, what the mouse does there, how to leave (keys are the bound ones) */
export function cameraRows(hint: Hint): [string, string][] {
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
export function worldRows(hint: Hint): [string, string][] {
  const k = (id: string, d: string) => hint(id) || d;
  return [
    ['the opening', 'a key or a click lights the star · any key goes straight to the world · Esc: the scenario menu (stay, or another world) · “hush” ends the whispers'],
    [k('ui.newWorld', 'F3'), 'a new world: the barren world, two worlds, a living system, the sandbox, your own system — with a seed'],
    [k('ui.saves', 'F6'), 'saves: slots with a picture and the date, export to a file, import one, autosave'],
    [`${k('ui.quicksave', 'F5')} · ${k('ui.quickload', 'F9')}`, 'quicksave · quickload'],
    [k('ui.mods', 'F8'), 'mods: load a content pack (JSON) from a file or an address; ?mod=<address> at start'],
  ];
}

/** the people and their god (LIVING §3): what the player can do for them and through them */
export function livingRows(hint: Hint): [string, string][] {
  const k = (id: string, d: string) => hint(id) || d;
  return [
    [k('ui.god', 'F4'), 'The god: how the people hold you (feared · awed · trusted — their faith, fear, trust and loyalty), open prayers, prophets, wrath, what is holy · the card under the worlds opens it too'],
    [k('god.answer', '⇧ F4'), 'answer the most pressing prayer (a lamp over a town is a prayer: its card, its toast and The god answer it too)'],
    ['a prophet', 'select a grown person · Make them your prophet · Foretell what you will do, then make it true: they are believed, and the town with them'],
    [k('ui.signs', 'F7'), 'send a sign: an eclipse, a comet, a rainbow, the sun standing still… — a trusting town reads favour, a fearful one anger'],
    ['wrath', 'how hard your harm falls: survivable by default (The god) · say “a gentle storm” or “a huge meteor” for one act'],
    ['holy things', 'hallow a spring, a grove or a peak · a town\'s sacred animal on its card · the Signs ring of the radial has them all'],
    ['invent', 'a material or a plant from Ideas / Life (a form: name, kind, traits, uses) · Seed a vein lays ore in the ground'],
  ];
}

/** the sticks and menu navigation (not rebindable); the buttons come from the keybind registry */
export const PAD_FIXED: [string, string][] = [
  ['left stick', 'the cursor (push to the edge to pan) · walking: walk · photo: move'],
  ['right stick', 'turn and tilt the view · points in the radial · following: circle them · walking and photo: look'],
  ['LB · RB', 'rise · descend · following: farther · nearer · walking: to and from eye level · photo: wider · longer lens'],
  ['D-pad / A / B', 'in a menu or panel: move, press, back'],
  ['Start', 'the game menu: The god, Send a sign, saves, settings, the title'],
];

/** the gamepad rows of the registry's bound buttons: [buttons, what] (a held button says so once, on the button) */
export function padRows(padOf: (id: string) => string[]): [string, string][] {
  const rows: [string, string][] = [];
  for (const a of ACTIONS) {
    const pads = padOf(a.id);
    if (!pads.length) continue;
    const where = a.context === 'photo' ? ' (photo mode)' : a.context === 'walk' ? ' (walking)' : '';
    const label = a.hold ? a.label.replace(/\s*\(hold\)/i, '') : a.label;
    rows.push([pads.map((p) => (a.hold && !/hold/i.test(label) ? `${p} (hold)` : p)).join(' · '), `${label}${where}`]);
  }
  return rows;
}

const defaultPad = (id: string) => ACTION_BY_ID.get(id)?.pad ?? [];
/** the speed steps on the number row: "1–0" and "1× … 3000×" */
function speedSpan(): { keys: string; speeds: string } {
  const first = SPEED_KEYS[0]!, last = SPEED_KEYS[SPEED_KEYS.length - 1]!;
  return { keys: `${comboLabel(first[1])}–${comboLabel(last[1])}`, speeds: `${first[0]}× … ${last[0]}×` };
}

/** the site listing's keyboard line (game_meta.json controls_keyboard): the main actions at their default keys */
export function metaKeyboard(): string {
  const k = defaultHint;
  const sp = speedSpan();
  return [
    'Drag the land: turn the world',
    'wheel: descend / rise',
    'right-drag: turn and tilt',
    `${k('cam.forward')} ${k('cam.left')} ${k('cam.back')} ${k('cam.right')} pan`,
    `${k('cam.turnLeft')} / ${k('cam.turnRight')} turn`,
    `${k('cam.tiltUp')} / ${k('cam.tiltDown')} tilt`,
    'click: inspect',
    'drag someone: the Touch lifts them (flick to hurl)',
    `${k('hand.take')} lift / set down`,
    `hold ${k('ui.gesture')} (or middle-drag) and draw a sigil`,
    `hold ${k('ui.radial')}: radial menu`,
    `${k('ui.palette')} every power`,
    `${k('ui.freeform')} say it in words`,
    `${sp.keys} speed (${sp.speeds})`,
    `${k('time.pause')} pause`,
    `${k('ui.god')} The god (prayers, prophets, wrath)`,
    `${k('ui.signs')} send a sign`,
    `${k('ui.chronicle')} chronicle`,
    `${k('cam.system')} system view`,
    `${k('cam.walk')} walk among them`,
    `${k('cam.photo')} photo mode`,
    `${k('ui.hide')} hide the interface`,
    `${k('ui.help')} every control`,
  ].join(' · ');
}

/** the site listing's gamepad line (game_meta.json controls_gamepad): sticks, then every world button at its default */
export function metaGamepad(): string {
  const parts = ['Standard-mapping pad', 'left stick: cursor (push to the edge to pan)', 'right stick: turn and tilt the view'];
  for (const a of ACTIONS) {
    const pads = defaultPad(a.id);
    if (!pads.length || a.context) continue;
    const label = a.label.replace(/\s*\([^)]*\)/g, '').replace(/…$/, '');
    const what = /^Touch\b/.test(label) ? `the ${label}` : `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    parts.push(`${pads.join(' / ')}${a.hold ? ' (hold)' : ''} ${what}`);
  }
  parts.push('photo mode and walking have their own buttons (F1 lists them)');
  return parts.join(' · ');
}

const mdCell = (s: string) => s.replace(/\|/g, '\\|');
function mdTable(head: [string, string], rows: [string, string][]): string {
  return [`| ${head[0]} | ${head[1]} |`, '|---|---|', ...rows.map(([a, b]) => `| ${mdCell(a)} | ${mdCell(b)} |`)].join('\n');
}

/** CONTROLS.md: every control at its default binding (the same rows as the F1 card) */
export function controlsMarkdown(): string {
  const k = defaultHint;
  const slap = comboLabel(ACTION_BY_ID.get('hand.slapMod')?.keys[0] ?? 'Alt');
  const out: string[] = [
    '# GENESIS — controls',
    '',
    'Every control at its default binding. Keys are rebindable in Settings → Controls; the in-game card (F1) always shows',
    'the keys as they are bound now. This file is generated from `src/ui/keybinds.ts` and `src/ui/controlstext.ts`',
    '(`node _harness/gen-controls.ts`; `tests/ui-meta.test.ts` fails when it goes stale).',
    '',
    '## The Touch and the mouse',
    '',
    'The Touch is the god\'s presence on the land: light where the people trust you, storm-dark where they fear you.',
    '',
    mdTable(['mouse', 'what it does'], mouseRows(k, slap)),
    '',
    '## The people and their god',
    '',
    mdTable(['key', 'what it does'], livingRows(k)),
    '',
    '## Camera modes',
    '',
    mdTable(['key', 'mode'], cameraRows(k)),
    '',
    '## Worlds, saves, mods',
    '',
    mdTable(['key', 'what it does'], worldRows(k)),
    '',
  ];
  const groups = new Map<string, [string, string][]>();
  for (const a of ACTIONS) {
    if (CAMERA_MODE_IDS.has(a.id)) continue;
    const keys = a.keys.map(comboLabel);
    const l = groups.get(a.group) ?? [];
    l.push([keys.length ? keys.join(' · ') : a.id === 'hand.primary' ? 'left button' : '—', a.label]);
    groups.set(a.group, l);
  }
  for (const [g, rows] of groups) out.push(`## ${g}`, '', mdTable(['key', 'action'], rows), '');
  out.push('## Gamepad', '', 'A standard-mapping pad (Xbox / PlayStation layout); the left stick moves a cursor that the Touch and every power use like a mouse.', '',
    mdTable(['button', 'action'], [...PAD_FIXED, ...padRows(defaultPad)]), '');
  out.push('## Sigils', '',
    `Hold ${k('ui.gesture')} (or the middle mouse button) and draw one stroke: each sigil is an original glyph that casts one miracle.`,
    'The F1 card draws every sigil with the miracle it casts.', '',
    '## Words', '',
    `Press ${k('ui.freeform')} and say it — “Make it rain over Aru for three days.”, “Teach them writing.”, “Set gravity to 3.”.`,
    'Anything not in a list, the world will try, and tell you what it can do instead.', '');
  return out.join('\n');
}
