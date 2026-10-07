// VALE UI — key labels for KeyboardEvent.code values (layout-independent binds, session/settings.ts)
// and mouse buttons ('Mouse0'..'Mouse4').

const NAMED: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', CapsLock: 'Caps',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
  MetaLeft: 'L Meta', MetaRight: 'R Meta', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn',
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
};

export function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

/** short label for a keycap chip (≤ 5 chars) */
export function keyShort(code: string | undefined): string {
  const l = keyLabel(code);
  return l.replace('Left click', 'LMB').replace('Right click', 'RMB').replace('Middle click', 'MMB');
}

/** action → display name for Settings › Controls (session/settings.ts action vocabulary) */
export const ACTION_LABELS: Record<string, string> = {
  a1: 'Ability 1', a2: 'Ability 2', a3: 'Ability 3', ult: 'Ultimate', spell1: 'Battle spell 1', spell2: 'Battle spell 2',
  item1: 'Item slot 1', item2: 'Item slot 2', item3: 'Item slot 3', item4: 'Item slot 4', item5: 'Item slot 5', item6: 'Item slot 6',
  recall: 'Recall', shop: 'Open shop', scoreboard: 'Scoreboard (hold)', ping: 'Ping', attackMove: 'Attack-move', stop: 'Stop',
  cameraLock: 'Camera lock', centerCamera: 'Centre camera (hold)', selfCastMod: 'Self-cast modifier',
};
export const ACTION_GROUPS: { title: string; actions: string[] }[] = [
  { title: 'Abilities', actions: ['a1', 'a2', 'a3', 'ult', 'spell1', 'spell2'] },
  { title: 'Items', actions: ['item1', 'item2', 'item3', 'item4', 'item5', 'item6'] },
  { title: 'Commands', actions: ['attackMove', 'stop', 'recall', 'shop', 'ping', 'scoreboard'] },
  { title: 'Camera', actions: ['cameraLock', 'centerCamera'] },
];
