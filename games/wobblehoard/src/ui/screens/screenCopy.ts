// The words and the row list of the later-* screens (UI.md 6, 8 B4b): Settings, How to play, Credits. PURE data (no DOM, no CSS): the node probes read it
// (_harness/probe_screens.ts), so a row cannot be added to the panel without the probe seeing it. Kind wording; plain words, no dB.
import type { IconName } from '../icons.ts';
import { PRIVACY_LINE } from '../../portal/copy.ts';

// ---------------------------------------------------------------------------------------------------------------- Settings
export type SliderKey = 'volume' | 'music' | 'squishBoost' | 'shake' | 'chatter' | 'ambience';
export type SwitchKey = 'uiSounds' | 'extraSquish' | 'haptics' | 'calm' | 'skipAnimations' | 'fastOpen' | 'shortcuts' | 'autonomy';
export type SegKey = 'quality';

export interface SegOption { value: string; label: string; icon?: IconName }
export type SettingRow =
  | { kind: 'slider'; id: string; key: SliderKey; label: string; hint?: string }
  | { kind: 'switch'; id: string; key: SwitchKey; label: string; hint?: string; needs?: 'vibrate' }
  | { kind: 'seg'; id: string; key: SegKey; label: string; options: readonly SegOption[]; hint?: string }
  | { kind: 'link'; id: string; label: string; icon: IconName; to: 'howto' };
export interface SettingGroup { id: 'sound' | 'feel' | 'motion' | 'other'; title: string; rows: readonly SettingRow[] }

/** Quality has four faces (UI.md 6: a 4-way segmented control); `auto` lets the game choose. */
export const QUALITY_OPTIONS: readonly SegOption[] = [
  { value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'med', label: 'Medium' }, { value: 'high', label: 'High' },
];
/** Settings keys that have NO row here because their control lives somewhere else. Gravity (Table | Float) moved to the toolbar on 2026-10-09 (the owner: "float/table should be in
 *  the toolbar, not in settings"; UI.md 1.8; `ui/toolbar.ts` GRAVITY_MODES): the setting and its stored value stay, only the row left. The probe pins both halves. */
export const TOOLBAR_SETTING_KEYS = ['gravity'] as const;

/** The keyboard line under Other. It names every key the game answers (the keys of input/keyboard.ts): the probe compares it with the How to play key table. */
export const KEYS_LINE = 'Keys: Tab to the squishy · Space pokes · arrows look around · + / − zoom · G gravity · M sound · H Hoard · 1 2 3 tools · C cut · S snap · F full screen · P Menu · ? How to play · [ ] switch squishy · Shift + drag pulls both sides · Shift while stretched fully locks a pull; Esc lets go · right-drag turns the view · Esc closes';
export const SAVED_LINE = 'Saved on this device.';

/** Sound, Feel, Motion, Other (UI.md 6). The labels keep the words the game already used (Volume, Louder squish, Fast open, ...): plain, no dB. Every key of
 *  `SETTING_KEYS` (core/settings.ts) has exactly one row here, except `TOOLBAR_SETTING_KEYS` (Gravity: the toolbar's Table | Float): the probe checks it. */
export const SETTINGS_GROUPS: readonly SettingGroup[] = [
  { id: 'sound', title: 'Sound', rows: [
    { kind: 'slider', id: 'wh-volume', key: 'volume', label: 'Volume' },
    { kind: 'slider', id: 'wh-music', key: 'music', label: 'Music' },
    // PLAYGROUND (PLAYGROUND_BUILD 11.9, D-28): the squishies' little voices and each place's own sounds, each on its own slider
    { kind: 'slider', id: 'wh-chatter', key: 'chatter', label: 'Voices' },
    { kind: 'slider', id: 'wh-ambience', key: 'ambience', label: 'Place sounds' },
    { kind: 'switch', id: 'wh-uisounds', key: 'uiSounds', label: 'Button sounds', hint: 'Soft taps and chimes when you press things.' },
    { kind: 'slider', id: 'wh-boost', key: 'squishBoost', label: 'Louder squish' },
  ] },
  { id: 'feel', title: 'Feel', rows: [
    { kind: 'switch', id: 'wh-extra', key: 'extraSquish', label: 'Extra squish', hint: 'Presses go deeper.' },
    { kind: 'switch', id: 'wh-haptics', key: 'haptics', label: 'Haptics', needs: 'vibrate' },
    { kind: 'seg', id: 'wh-quality', key: 'quality', label: 'Quality', options: QUALITY_OPTIONS },
  ] },
  { id: 'motion', title: 'Motion', rows: [
    { kind: 'switch', id: 'wh-calm', key: 'calm', label: 'Calm effects', hint: 'No camera moves, flashes or shake; fewer sparkles.' },
    { kind: 'slider', id: 'wh-shake', key: 'shake', label: 'Screen shake' },
    { kind: 'switch', id: 'wh-skip', key: 'skipAnimations', label: 'Skip animations', hint: 'Go straight to what came out.' },
    { kind: 'switch', id: 'wh-fast', key: 'fastOpen', label: 'Fast open', hint: 'Quick pop for repeats.' },
  ] },
  { id: 'other', title: 'Other', rows: [
    // PLAYGROUND (11.9, LIFE.md 5.6): autonomy, on by default; the help line is the spec's word for word
    { kind: 'switch', id: 'wh-autonomy', key: 'autonomy', label: 'Squishies move on their own', hint: 'When off, they stay where you put them. They still look around and chirp, and play when you ask.' },
    { kind: 'switch', id: 'wh-keys', key: 'shortcuts', label: 'Keyboard shortcuts', hint: 'G gravity, M sound, H Hoard, 1 2 3 tools (C cut, S snap), [ ] switch squishy.' },
    { kind: 'link', id: 'wh-howto-link', label: 'How to play', icon: 'help', to: 'howto' },
  ] },
];

/** The Voices switch (the pets update; UI.md 1.7): built only when `FEATURES.voices` is true AND the shell gives the panel a place to keep it. */
export const VOICES_ROW = { id: 'wh-voices', label: 'Voices', hint: 'Squishies can make little sounds.' } as const;

// ---------------------------------------------------------------------------------------------------------------- How to play
export type GuideArt = 'squish' | 'stretch' | 'capsule' | 'tools' | 'hoard';
export interface GuideCard { id: GuideArt; title: string; text: string }
export const GUIDE_TITLE = 'How to play';
/** Five cards (UI.md 6). Each line is something the game really does (hint.ts, cut bar, merge pad); none names a price or a loss. */
export const GUIDE_CARDS: readonly GuideCard[] = [
  { id: 'squish', title: 'Squish', text: 'Tap to poke. Press and hold to squash it flat, then let go and watch it spring back.' },
  { id: 'stretch', title: 'Stretch', text: 'Press on the squishy and drag away to pull it long. Two fingers, or Shift and a drag, pull both sides at once.' },
  { id: 'capsule', title: 'Capsules', text: 'Squishing and stretching fills the ring. When it is full, a capsule drops in. Press Open, or hold the capsule, to see who is inside.' },
  { id: 'tools', title: 'Tools', text: 'Hand squishes. Cut splits the squishy into pieces, and Reconnect all joins them again. Snap takes a photo with a backdrop you pick. Table lets it rest on the mat; Float lets it drift in the air.' },
  { id: 'hoard', title: 'Hoard and merge', text: 'The Hoard keeps every squishy you find. Got two spare copies of one kind? Press and hold Merge to turn them into something that can come out rarer.' },
];
export interface KeyRow { keys: readonly string[]; does: string }
export const GUIDE_KEYS_TITLE = 'Keyboard';
/** The key table: the keys of input/keyboard.ts plus the pointer ones. The probe checks that every letter and symbol KEYS_LINE names is a row here. */
export const GUIDE_KEYS: readonly KeyRow[] = [
  { keys: ['Space'], does: 'Poke. Hold to squish.' },
  { keys: ['Arrow keys'], does: 'Look around' },
  { keys: ['+', '−'], does: 'Zoom' },
  { keys: ['1'], does: 'Hand' },
  { keys: ['2', 'C'], does: 'Cut' },
  { keys: ['3', 'S'], does: 'Snap' },
  { keys: ['H'], does: 'Hoard' },
  { keys: ['J'], does: 'Journal' },   // (PLAYGROUND round 5: the J key, once the Journal has come)
  { keys: ['[', ']'], does: 'Switch squishy' },
  { keys: ['G'], does: 'Gravity: table or float' },
  { keys: ['M'], does: 'Sound on or off' },
  { keys: ['F'], does: 'Full screen' },
  { keys: ['P'], does: 'Menu' },
  { keys: ['?'], does: 'This screen' },
  { keys: ['Esc'], does: 'Close, or back to the Hand' },
  { keys: ['Shift', 'drag'], does: 'Pull both sides' },
  { keys: ['Shift'], does: 'Lock a pull that is stretched all the way. Press the lobe, or Esc, to let go.' },
  { keys: ['Right-drag'], does: 'Turn the view' },
];

// ---------------------------------------------------------------------------------------------------------------- Credits
export const CREDITS_TITLE = 'Credits';
export const CREDITS_MADE_BY = 'A ForgeFlow Games game.';
/** UI.md 6, word for word. */
export const CREDITS_CRAFT = 'All sound is synthesised in your browser. All art is drawn in code.';
export const CREDITS_PRIVACY = PRIVACY_LINE;
export interface Credit { name: string; licence: string; what: string }
export const CREDITS_BUILT_WITH: readonly Credit[] = [
  { name: 'three.js', licence: 'MIT', what: 'Draws the 3D jelly.' },
  { name: 'Vite', licence: 'MIT', what: 'Builds the game.' },
  { name: 'TypeScript', licence: 'Apache-2.0', what: 'The language it is written in.' },
];
export const CREDITS_LICENCES_TITLE = 'Licences';
export const CREDITS_LICENCE_NAME = 'three.js: The MIT License';
/** The three.js licence text as shipped in the package (node_modules/three/LICENSE, r186): the MIT terms ask that the notice travels with the code. */
export const THREE_LICENCE = [
  'The MIT License',
  'Copyright © 2010-2026 three.js authors',
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
] as const;
