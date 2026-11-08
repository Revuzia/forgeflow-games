// GENESIS — ARC §1.4: how the UI shows a town's heart. Pure helpers shared by the HUD name chip, the Hearts map layer
// and the inspector: the glyph and its tooltip, share words ("about half"), the layer's colours per palette (§8.1 M5
// asks ΔE ≥ 15 between the four kinds and the proud rim) and the layer's hover line. All sacred text (captions, mood
// lines, memory phrases) is composed by the sim; the captions here are only the fallback for an empty `caption`.

import type { DefyKind, HeartKind, SettlementView } from '../sim/types.ts';
import type { CvdPalette } from './prefs.ts';

export type TownHeart = NonNullable<SettlementView['heart']>;
export const HEART_KINDS: readonly Exclude<HeartKind, 'quiet'>[] = ['devoted', 'fearful', 'restless', 'defiant'];

/** §1.4 captions (scripture.json `caption.*` carries the same words; the sim sends them in `heart.caption`) */
export const HEART_CAPTION: Record<HeartKind | 'proud', string> = {
  devoted: 'They bow at dusk', fearful: 'They watch the sky', restless: 'They murmur', defiant: 'They raise their fists',
  quiet: 'They go about their days', proud: 'They boast',
};

/** the inspector's share-bar labels */
export const HEART_LABEL: Record<Exclude<HeartKind, 'quiet'>, string> = { devoted: 'Devoted', fearful: 'Afraid', restless: 'Restless', defiant: 'Defiant' };

/** a share 0..1 in words, never a number */
export function shareWords(x: number): string {
  if (!(x > 0.04)) return 'hardly any';
  if (x < 0.15) return 'a few';
  if (x < 0.28) return 'some';
  if (x < 0.42) return 'about a third';
  if (x < 0.62) return 'about half';
  if (x < 0.85) return 'most';
  return 'nearly all';
}

/** the person card's one line above the bars (§1.4): "Hesh raises a fist at the sky" */
export function personHeartLine(name: string, kind: unknown): string {
  const n = name || 'They';
  switch (kind) {
    case 'defiant': return `${n} raises a fist at the sky`;
    case 'fearful': return `${n} is afraid of the sky`;
    case 'devoted': return `${n} loves the god`;
    case 'restless': return `${n} murmurs against the god`;
    case 'quiet': return `${n} goes about the day`;
  }
  return '';
}

/** why they are proud, in words (the hover on the Pride bar): "rich, long unpunished, little faith" */
export function prideWhyWords(w: { P: number; T: number; U: number; L: number; F: number } | null | undefined): string {
  if (!w) return '';
  const parts: [number, string][] = [[w.P, 'rich'], [w.T, 'skilled'], [w.U, 'many towns of one speech'], [w.L, 'long unpunished'], [w.F, 'little faith']];
  return parts.filter(([v]) => v >= 0.5).sort((a, b) => b[0] - a[0]).map(([, t]) => t).join(', ');
}

export const captionOf = (h: TownHeart): string => h.caption || HEART_CAPTION[h.kind] || '';
export const shareOf = (h: TownHeart): number => (h.kind === 'quiet' ? 0 : h[h.kind]);

/** ARC §3.4: a defiant act in plain words, for the chip's tooltip ("Aru: they threw stones at the storm") */
export const DEFY_WORDS: Record<DefyKind, string> = {
  curse: 'they cursed the sky', hurl: 'they threw stones at the storm', burn: 'they burned the shrine', idol: 'they carved a god of their own',
};

/**
 * ARC §3.3: the first toast of each kind of act per town, present tense, in the voice ("In Aru they are throwing stones
 * at your storm"). Its only button is "Look". `count` is how many took part (words up to twelve, §0.3 rule 8).
 */
export function defyToastText(kind: string, where: string): string {
  switch (kind) {
    case 'curse': return `At dusk in ${where} they are cursing the sky.`;
    case 'hurl': return `In ${where} they are throwing stones at your storm.`;
    case 'burn': return `${where} is burning your shrine.`;
    case 'idol': return `${where} has carved a god of its own and set it in the square.`;
  }
  return `In ${where} they raise their fists at the sky.`;
}

/** ARC §3.3: the god's answer to a defiant act as it was read (the fallback when no chronicle line came with it) */
export function defyAnsweredText(how: string, where: string): string {
  switch (how) {
    case 'wrath': return `The god answered the stones of ${where} with fire.`;
    case 'mercy': return `They threw stones, and the god was kind to ${where}.`;
    case 'sign': return `A sign came over ${where}, after the stones.`;
    case 'patience': return `The sky did not answer ${where}.`;
  }
  return `The god answered ${where}.`;
}

/**
 * the name chip's glyph: shown when the town's heart is not quiet, or when it is proud (§1.4). A defiant act in the
 * open (`SettlementView.defiant`, <= 2 days old, §3.4) shows the fist whatever the town's heart, and says what they did.
 */
export function heartGlyph(s: Pick<SettlementView, 'name' | 'heart' | 'defiant'>): { icon: string | null; proud: boolean; title: string; defiantTick: number } | null {
  const h = s.heart, act = s.defiant;
  if (!act && (!h || (h.kind === 'quiet' && !h.proud))) return null;
  const parts: string[] = [];
  if (h && h.kind !== 'quiet') parts.push(captionOf(h));
  if (h?.proud) parts.push(HEART_CAPTION.proud.toLowerCase());
  if (act && DEFY_WORDS[act.kind]) parts.push(DEFY_WORDS[act.kind]);
  const title = `${s.name}: ${parts.join(' · ')}`;
  const icon = act ? 'heart-defiant' : h && h.kind !== 'quiet' ? `heart-${h.kind}` : null;
  return { icon, proud: !!h?.proud, title, defiantTick: act ? act.tick : -1 };
}

/** "9 of 40 came at dusk" (dusk is the share that came; population the grown count the sim measured against) */
export function duskWords(h: TownHeart, population: number): string {
  const of = Math.max(0, Math.round(population));
  const came = Math.max(0, Math.min(of, Math.round(h.dusk * of)));
  return `${came} of ${of} came at dusk`;
}

/** the Hearts layer's hover line, in words: "Aru · They watch the sky (about half) · proud · 9 of 40 came at dusk" */
export function heartHover(s: Pick<SettlementView, 'name' | 'heart' | 'population'>): string {
  const h = s.heart;
  if (!h) return s.name;
  const bits = [s.name, h.kind === 'quiet' ? captionOf(h) : `${captionOf(h)} (${shareWords(shareOf(h))})`];
  if (h.proud) bits.push('proud');
  bits.push(duskWords(h, s.population));
  return bits.join(' · ');
}

// ── the Hearts layer's colours (§1.4): devoted warm gold, fearful cold violet, restless ochre, defiant crimson; the
//    proud rim a thin bright line. One table per overlay palette, colour-blind ones included (tests check ΔE ≥ 15). ──
export type RGB = [number, number, number];
export const HEART_COLORS: Record<CvdPalette, Record<Exclude<HeartKind, 'quiet'> | 'proud', RGB>> = {
  standard: { devoted: [242, 196, 82], fearful: [124, 92, 214], restless: [196, 132, 46], defiant: [204, 34, 52], proud: [250, 248, 236] },
  // red-green safe: blue / orange / yellow / dark magenta axes (Okabe-Ito leaning)
  deuteranopia: { devoted: [240, 228, 66], fearful: [0, 114, 178], restless: [230, 159, 0], defiant: [150, 30, 110], proud: [255, 255, 255] },
  protanopia: { devoted: [240, 228, 66], fearful: [0, 114, 178], restless: [213, 140, 40], defiant: [120, 40, 140], proud: [255, 255, 255] },
  // blue-yellow safe: red / teal / pink / dark axes
  tritanopia: { devoted: [235, 120, 110], fearful: [0, 150, 150], restless: [210, 170, 190], defiant: [150, 10, 30], proud: [255, 255, 255] },
  // no hue: five clearly separate greys (the legend's words carry the kinds)
  monochrome: { devoted: [196, 196, 196], fearful: [84, 84, 84], restless: [138, 138, 138], defiant: [30, 30, 30], proud: [255, 255, 255] },
};

/** a colour as CSS (the legend's swatches) */
export const heartCss = (rgb: RGB): string => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

/** fill alpha for a town of this heart: 0.35 + 0.5 × share; quiet towns are unshaded */
export const heartAlpha = (h: TownHeart): number => (h.kind === 'quiet' ? 0 : 0.35 + 0.5 * Math.max(0, Math.min(1, shareOf(h))));

/** CIE76 ΔE between two sRGB colours (the M5 check) */
export function deltaE(a: RGB, b: RGB): number {
  const lab = (c: RGB): [number, number, number] => {
    const lin = c.map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    const X = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047;
    const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    const Z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
