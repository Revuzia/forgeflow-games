// B2 page: the JELLY GLYPH SHEET (UI.md 5, gate R08). The owner approves the lettering here before the title card, the lockup or any
// panel heading is built on it. Everything shown is the real renderer (src/ui/jelly) on the real tokens; nothing here is drawn twice.
// Review modes (query): ?big=ABC&cap=150&ground=panel shows just those glyphs large; ?chars=S8 picks the anatomy rows.
import '../../../src/ui/jelly/jelly.css';
import { h } from '../../../src/ui/dom.ts';
import { jelly, jellyWidth } from '../../../src/ui/jelly/jelly.ts';
import type { JellyToneId } from '../../../src/ui/jelly/jelly.ts';
import { GLYPHS, SET_ALPHA, SET_DIGITS, SET_PUNCT } from '../../../src/ui/jelly/glyphs.ts';
import { MEDAL_IDS, TIER_IDS } from '../../../src/ui/theme.ts';
import { sub } from './types.ts';
import type { KitSection } from './types.ts';

/** The widest a jelly word may be on this viewport (stage padding and the page gutter taken off). fitJelly will do this in the product (floor 14). */
const avail = (): number => Math.max(120, Math.min(innerWidth - 64, 1200));
/** A jelly word at an exact cap height in px (24 uses the small optical size, 36 and up the full five passes); shrunk only if it would not fit. */
export function jc(text: string, cap: number, tone: JellyToneId = 'amber', bounce = 0): HTMLElement {
  const fitted = Math.floor(avail() / ((jellyWidth(text) + 12) / 100));
  const px = Math.min(cap, Math.max(14, fitted));
  const el = jelly(text, { size: px <= 24 ? 'sm' : 'md', tone, bounce });
  el.style.setProperty('--jl-cap', `${px}px`);
  return el;
}
/** The lockup cap: the xl token (clamp(64px, 12vw, 120px)) evaluated here. */
const capXl = (): number => Math.min(120, Math.max(64, Math.round(innerWidth * 0.12)));
/** A phrase as one jelly element per word, so a line can wrap between words. */
const phrase = (text: string, cap: number, tone: JellyToneId = 'amber', bounce = 0): HTMLElement[] => text.split(' ').map((w) => jc(w, cap, tone, bounce));
const fig = (caption: string, el: Node): HTMLElement => h('figure', { class: 'kp-cell kp-fig' }, el, h('figcaption', { text: caption }));
const line = (...kids: Node[]): HTMLElement => h('div', { class: 'kp-line' }, ...kids);
const groups = (s: string, n: number): string[] => { const o: string[] = []; for (let i = 0; i < s.length; i += n) o.push(s.slice(i, i + n)); return o; };

const alpha: KitSection = {
  id: 'jelly-alpha', title: 'Jelly alphabet: A-Z, 0-9 and punctuation at caps 24 / 36 / 64',
  note: `${Object.keys(GLYPHS).length} glyphs, one centre-line path each. Cap 24 is the small optical size (3 passes, flat); 36 and 64 draw all five passes.`,
  build(host) {
    for (const cap of [24, 36, 64]) {
      host.append(sub(`Cap ${cap} px`));
      const per = cap <= 24 ? 13 : cap <= 36 ? 9 : 6;
      host.append(h('div', { class: 'kp-stage kp-stage--col kp-type' },
        line(...groups(SET_ALPHA, per).map((g) => jc(g, cap))),
        line(...groups(SET_DIGITS, cap <= 36 ? 10 : 5).map((g) => jc(g, cap, 'lagoon'))),
        line(...groups(SET_PUNCT, cap <= 36 ? 14 : 7).map((g) => jc(g, cap, 'coral')))));
    }
  },
};

const words: KitSection = {
  id: 'jelly-words', title: 'Words the UI sets in jelly',
  note: 'Lockup, panel headings, tier names and numerals. Rarity names wear their tier tone. Big numerals are tabular (every digit has the same advance). On a narrow screen a long word is shrunk to fit (the product does this with fitJelly).',
  build(host) {
    host.append(sub('Lockup (cap 120 fluid), the optional bounce, and headings (cap 56)'));
    host.append(h('div', { class: 'kp-stage kp-stage--col kp-type' },
      line(...phrase('SQUISH KEEPER', capXl())),
      line(...phrase('SQUISH KEEPER', capXl(), 'amber', 1.2), h('span', { class: 'kp-dim', text: 'same lockup with the optional bounce (a fixed tilt and lift per letter)' })),
      line(jc('HOARD', 56, 'cream'), jc('SETTINGS', 56, 'lagoon')),
      line(jc('TROPHIES', 56, 'gold'), jc('MENU', 56, 'plum')),
      line(...phrase('WAKE IT UP', 56, 'amber'))));
    host.append(sub('Rarity names at cap 56 and at cap 24'));
    host.append(h('div', { class: 'kp-stage kp-stage--col kp-type' },
      line(...TIER_IDS.map((t) => jc(t.toUpperCase(), 56, t))),
      line(...TIER_IDS.map((t) => jc(t.toUpperCase(), 24, t)))));
    host.append(sub('Big numerals (cap 120 fluid) and counters (cap 36 / 24)'));
    host.append(h('div', { class: 'kp-stage kp-stage--col kp-type' },
      line(...groups(SET_DIGITS, 5).map((g) => jc(g, capXl(), 'amber'))),
      line(...['14 / 50', '6 / 20', '+10 XP', '#1'].map((t, i) => jc(t, 36, (['cream', 'gold', 'lagoon', 'coral'] as const)[i]))),
      line(...['14 / 50', '6 / 20', '+10 XP', '#1'].map((t, i) => jc(t, 24, (['cream', 'gold', 'lagoon', 'coral'] as const)[i])), ...phrase("WHAT'S NEW? (2) 3 & 4 50%", 24, 'plum'))));
  },
};

const big: KitSection = {
  id: 'jelly-big', title: 'Every glyph at cap 96, on white (the hardest ground) and on the panel',
  note: 'Caption = the character and its width w (glyph units, advance = w + 10). White ground first, then the panel.',
  build(host) {
    const q = new URLSearchParams(location.search);
    const pick = q.get('big');
    const chars = pick ? [...pick] : [...SET_ALPHA, ...SET_DIGITS, ...SET_PUNCT];
    const cap = pick ? Number(q.get('cap') ?? 150) : 96;
    for (const ground of pick ? [q.get('ground') === 'panel' ? 'panel' : 'white'] as const : ['white', 'panel'] as const) {
      host.append(sub(`On ${ground}`));
      const stage = h('div', { class: `kp-stage kp-type kp-big${ground === 'white' ? ' kp-stage--white' : ''}` });
      for (const ch of chars) stage.append(fig(`${ch}  w ${GLYPHS[ch][0]}`, jc(ch, cap, 'amber')));
      host.append(stage);
    }
  },
};

const tones: KitSection = {
  id: 'jelly-tones', title: 'Tones: 5 jelly tones, 6 rarity tiers, 4 medals, on panel and on white',
  note: 'The ink outline carries the contrast on any ground (every tone is at least 3:1 against ink, see CONTRAST_PAIRS).',
  build(host) {
    const ids: JellyToneId[] = ['amber', 'cream', 'coral', 'lagoon', 'plum', ...TIER_IDS, ...MEDAL_IDS];
    for (const ground of ['panel', 'white'] as const) {
      host.append(sub(`On ${ground} (cap 36)`));
      const stage = h('div', { class: `kp-stage kp-stage--col kp-type${ground === 'white' ? ' kp-stage--white' : ''}` });
      stage.append(line(...ids.map((id) => fig(id, jc('SQUISH 42', 36, id)))));
      host.append(stage);
    }
  },
};

const anatomy: KitSection = {
  id: 'jelly-anatomy', title: 'Anatomy: the five passes, one at a time (cap 120, on white)',
  note: 'contact shadow, + ink outline, + darker shade, + body (gradient), + gloss. The small size (cap 24) keeps only outline, flat body, gloss.',
  build(host) {
    const pick = new URLSearchParams(location.search).get('chars');
    const cap = Math.min(120, Math.floor(avail() / 5.4));
    for (const ch of (pick ? [...pick] : ['S', 'B', 'A', '8'])) {
      const row = h('div', { class: 'kp-stage kp-type kp-stage--white' });
      for (let k = 1; k <= 5; k++) {
        const el = jc(ch, cap);
        [...el.querySelectorAll('.jl-svg g')].slice(k).forEach((g) => g.remove());
        row.append(el);
      }
      host.append(row);
    }
  },
};

const spacing: KitSection = {
  id: 'jelly-spacing', title: 'Spacing and pairs (cap 36, on the felt)',
  note: 'Straight next to round, round next to round, diagonals (AV, LT, RY), and the narrow I. Looking for the same visual gap everywhere.',
  build(host) {
    const strs = ['HOHOH OOOO HHHH', 'DODO BOBO PSPS', 'AVATAR TAVA', 'LTRY LYRT WAVY', 'AXKXA VWVW', 'ILLINOIS UNIT', 'QUEEN JAZZ', 'SQUISH KEEPER'];
    host.append(h('div', { class: 'kp-stage kp-stage--col kp-type kp-stage--felt' }, ...strs.map((s) => line(...phrase(s, 36, 'cream')))));
    host.append(sub('Look-alikes at cap 36 and 24: O 0 Q, I 1, S 5, B 8, Z 2, G 6, U V, E F, D O'));
    const twins = 'O0Q I1 S5 B8 Z2 G6 UV EF DO CG MN WM RP 69 3B 7T';
    host.append(h('div', { class: 'kp-stage kp-stage--col kp-type' }, line(...phrase(twins, 36, 'amber')), line(...phrase(twins, 24, 'amber'))));
  },
};

export function b2Sections(): KitSection[] { return [words, alpha, big, tones, anatomy, spacing]; }
