// Input-aware wording. Hint strings in level data never name a key or a button: they carry
// {tokens}, and this module turns them into the right words for whatever the player is using
// right now (keyboard + mouse, touch, or gamepad). Pure functions, no DOM: the HUD calls them
// every time the hint is shown AND when the input method changes, and the tests call them for
// every level.
//
// Token kinds
//   noun phrases   {move} {jump}                    "Move with {move}"  ->  "Move with WASD" / "the left stick"
//   action clauses a form of any element            "{ice} to freeze"   ->  "Press 2 to freeze" / "Tap the ice button to freeze"
//                  {liquid} {ice} {steam} {film}  {ember} {blaze} {smoke} {spark}  {clay} {slip} {stone} {dust}
//                  a form's special, by its name    "{flare} in mid-air" -> "press 2 again in mid-air" / "tap the blaze button again ..."
//                  {flare} (blaze)  {shed} (stone)
//                  {restart}                        "Stuck? {restart}." ->  "Stuck? Press R."
// Action clauses already contain their verb ("press 2", "tap the ice button"), so a sentence
// reads naturally on every device. A token at the start of a sentence is capitalised for you.
// The form and special tokens are GENERATED from src/ui/elements.js (button order, button word,
// special name), so a new element gets its tokens by being listed there.

import { ELEMENT_UI, UI_ELEMENT_ORDER } from './elements.js';

export const INPUT_MODES = ['keyboard', 'touch', 'pad'];

/** Gamepad buttons of the four form slots, in order. */
export const PAD_FORM_BUTTONS = ['X', 'Y', 'B', 'RB'];

export const TOKENS = {
  move: { keyboard: 'WASD', touch: 'the left stick', pad: 'the left stick' },
  jump: { keyboard: 'Space', touch: 'the jump button', pad: 'A' },
  restart: { keyboard: 'press R', touch: 'tap pause, then Back to checkpoint', pad: 'press Back' },
};
for (const id of UI_ELEMENT_ORDER) {
  ELEMENT_UI[id].forms.forEach((f, i) => {
    const t = { keyboard: `press ${i + 1}`, touch: `tap the ${f.button} button`, pad: `press ${PAD_FORM_BUTTONS[i]}` };
    if (TOKENS[f.id]) throw new Error(`prompts: token {${f.id}} is defined twice`);
    TOKENS[f.id] = t;
    // the special: the same button, pressed again while already in that form
    if (f.special) {
      if (TOKENS[f.special]) throw new Error(`prompts: token {${f.special}} is defined twice`);
      TOKENS[f.special] = { keyboard: `${t.keyboard} again`, touch: `${t.touch} again`, pad: `${t.pad} again` };
    }
  });
}

/** How the hint card says "close me", per input method. */
export const DISMISS_LABEL = { keyboard: 'click or press H', touch: 'tap to dismiss', pad: 'fades on its own' };

/** Longest a hint may be once its tokens are filled in, in any input mode (keeps the phone card to 2-3 lines). */
export const HINT_MAX_CHARS = 118;

const TOKEN_RE = /\{(\w+)\}/g;

/** Names of the {tokens} used in a string. */
export function tokensIn(text) {
  const out = [];
  String(text).replace(TOKEN_RE, (all, name) => { out.push(name); return all; });
  return out;
}

/** Fill in a prompt's {tokens} for an input mode. Unknown tokens are left visible (and caught by the tests). */
export function resolvePrompt(text, mode = 'keyboard') {
  const m = INPUT_MODES.includes(mode) ? mode : 'keyboard';
  const str = String(text);
  return str.replace(TOKEN_RE, (all, name, offset) => {
    const t = TOKENS[name];
    if (!t) return all;
    const s = t[m];
    const startsSentence = /(^|[.!?]\s+)$/.test(str.slice(0, offset));
    return startsSentence ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  });
}

/**
 * Wording that names a physical control. None of it may appear in level data (use a token): it
 * would be wrong on at least one input method. Returns what was found, for tests and tooling.
 */
const HARD_CODED = /\b(WASD|Space(bar)?|[Aa]rrow keys?|[Kk]eyboard|[Mm]ouse|[Cc]lick|[Tt]ap|[Ss]tick|[Bb]utton|[Kk]eys?|[1-4])\b|\b[Pp]ress\s+(\d|[A-Z]\b)|\(\s*[1-4]\s*\)/g;
export function hardCodedControls(text) {
  return (String(text).replace(TOKEN_RE, '').match(HARD_CODED) || []).map((s) => s.trim());
}

/** Seconds a hint card stays up before a newer hint may take its place. */
export const HINT_MIN_READ = 2;

/**
 * What the HUD does with a hint that has just been raised. A hint belongs to the place that raised it and the player
 * keeps moving, so a card that has had its read (`age` seconds on screen) gives way to the newer hint at once instead
 * of making it wait its turn; a card that has only just appeared (two hints in one breath) is read first.
 * Returns 'show' (nothing on screen), 'replace' or 'queue'.
 */
export function hintArrival(showing, age) {
  if (!showing) return 'show';
  return age >= HINT_MIN_READ ? 'replace' : 'queue';
}

/** The hint text on screen: how long it stays before fading on its own (seconds). */
export function hintSeconds(resolved, mode) {
  const n = String(resolved).length;
  return mode === 'touch' ? Math.min(8, Math.max(4.5, 2.2 + n * 0.05)) : Math.max(7, n * 0.085);
}
